// The cycle sweep: the server-side twin of topUp() in index.html. Pulls /history for every
// device in the group, runs the shared detector, and merges the result into data/topup.json
// (same shape the browser used to cache in localStorage: { at, devices: { serial: {
// cycles, interrupted, charges, thermal } } }).
//
// Window: the last 14 days, extended back to the previous sweep (or the static import)
// with 3 days of overlap, so nothing is missed if the server was down for a while.
// Cycles that start before the window are carried over from the previous file, cycles
// inside it are re-detected, so the two never overlap (they are keyed by start time).
import fs from 'node:fs';
import path from 'node:path';
import { detectCycles, normalize } from '../shared/cycles.js';
import { appendReadings } from '../src/lib/mdmTrack.js';
import { resampleRun, curveKey } from '../src/lib/curves.js';
import { chargeSegments, thermalStats } from '../shared/profile.js';

const H = 3600e3, DAY = 24 * H, CHUNK = 7 * DAY;
const OPTS = { offlineMin: 45, intervalSec: 600 }; // matches the import and the browser top-up

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
export function loadTopup(root, group) { const t = readJson(path.join(root, 'data', 'topup.json')); return t && t.group === group ? t : null; }

async function history(get, serial, from, to) {
  const out = [];
  for (let s = from; s < to; s += CHUNK) {
    const e = Math.min(s + CHUNK, to);
    out.push(...await get(`/api/v1/testdata/devices/${encodeURIComponent(serial)}/history?start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}&interval_sec=${OPTS.intervalSec}`));
  }
  return out;
}
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i]).then(v => ({ ok: true, v }), e => ({ ok: false, e })); } }));
  return results;
}

// `get(url)` is the shared MDM client (server/mdm.mjs) — limiter + cache live there, not here.
export async function sweep({ base, group, root, get, log = () => {} }) {
  const now = Date.now();
  const seed = readJson(path.join(root, 'data', 'cycles.json')), HIST = seed && seed.group === group ? seed.devices : {};
  const prev = loadTopup(root, group), PREV = prev ? prev.devices : {};
  const anchor = prev ? prev.at : seed && seed.group === group ? Date.parse(seed.generatedAt) : now;
  const from = Math.min(anchor - 3 * DAY, now - 14 * DAY);
  const devices = await get(`/api/v1/testdata/devices?group=${encodeURIComponent(group)}`);
  log(`${devices.length} devices in "${group}", history since ${new Date(from).toISOString()}`);
  recordLifetime(root, group, devices, now, log);

  const out = {}, failed = [];
  const results = await mapLimit(devices, 3, async d => {
    const serial = d.serial_number;
    const rows = normalize(await history(get, serial, from, now)), res = detectCycles(rows, { nowMs: now, offlineMin: OPTS.offlineMin });
    const h = HIST[serial] || {}, p = PREV[serial] || {};
    const lastC = h.cycles?.length ? h.cycles[h.cycles.length - 1].end : from, lastI = h.interrupted?.length ? h.interrupted[h.interrupted.length - 1].end : from;
    const keep = list => (list || []).filter(x => x.start < from);
    const cycles = [...keep(p.cycles), ...res.cycles.filter(x => x.start >= from && x.start >= lastC)];
    const interrupted = [...keep(p.interrupted), ...res.interrupted.filter(x => x.start >= from && x.start >= lastI)];
    const thermal = { ...(p.thermal || {}) };
    [...res.cycles, ...(h.cycles || []).filter(c => c.start >= from)].forEach(c => { const t = thermalStats(rows, c.start, c.end); if (t) thermal[c.start] = t; });
    const charges = [...keep(p.charges), ...chargeSegments(rows).filter(x => x.start >= from)];
    return [serial, { cycles, interrupted, charges, thermal, lastSeen: rows.length ? rows[rows.length - 1].timestamp : null, samples: rows.length }];
  });
  results.forEach((r, i) => {
    const serial = devices[i].serial_number;
    if (r.ok) out[serial] = r.v[1];
    else { failed.push(serial); if (PREV[serial]) out[serial] = PREV[serial]; log(`${serial}: ${r.e.message}`); }
  });
  if (devices.length && failed.length === devices.length) throw new Error(`every device failed, e.g. ${serialMsg(results)}`);

  const file = { at: now, group, source: base, from, method: { ...OPTS, rule: 'full (>=95%, off charger) -> last reading <5% -> no check-in for offlineMin' }, failed, devices: out };
  const target = path.join(root, 'data', 'topup.json'), tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(file)); fs.renameSync(tmp, target);
  const cycles = Object.values(out).reduce((a, d) => a + d.cycles.length, 0);
  log(`done in ${Math.round((Date.now() - now) / 1000)}s: ${cycles} cycles since the import across ${Object.keys(out).length} devices${failed.length ? `, ${failed.length} failed (kept previous)` : ''}`);
  await buildCurves({ root, devices: devices.map(d => d.serial_number), topup: out, get, log });
  return { at: now, devices: Object.keys(out).length, cycles, failed };
}
const serialMsg = results => results.find(r => !r.ok)?.e.message;

// Record every device's MDM lifetime counter (discharge_total_pct) on each sweep, so the
// dashboard can turn it into cycles per run, test and day — the API only ever reports the
// current total. Written first, before the slow history fetch, so a failed sweep still
// keeps the reading. Our own file (gitignored, like topup.json); nothing goes to the MDM.
function recordLifetime(root, group, devices, now, log) {
  try {
    const target = path.join(root, 'data', 'lifetime.json'), tmp = target + '.tmp';
    const next = appendReadings(readJson(target), group, devices, now);
    fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, target);
    log(`lifetime counter recorded for ${Object.keys(next.devices).length} devices`);
  } catch (e) { log(`lifetime counter not recorded: ${e.message}`); }
}

// Per-run curves (src/lib/curves.js) for every run the dashboard knows about — the static
// import and the sweep, matched by serial — so charts can draw runs older than the browser's
// 7-day history window. Each run's readings are fetched from the MDM once; neighbouring
// runs share one fetch. A run whose readings do not cover it is stored as 0 so it is not
// fetched again on every sweep. Saved after each device, so an interrupted first backfill
// keeps what it got. Our own gitignored file; reads from the MDM only.
export async function buildCurves({ root, devices, topup, get, log = () => {} }) {
  const target = path.join(root, 'data', 'curves.json'), tmp = target + '.tmp';
  const file = readJson(target) || { v: 1, curves: {} };
  const seed = readJson(path.join(root, 'data', 'cycles.json'));
  const save = () => { file.at = Date.now(); fs.writeFileSync(tmp, JSON.stringify(file)); fs.renameSync(tmp, target); };
  let made = 0, none = 0, calls = 0;
  await mapLimit(devices, 3, async serial => {
    const h = seed?.devices?.[serial] || {}, t = topup?.[serial] || {};
    const runs = [...(h.cycles || []), ...(h.interrupted || []), ...(t.cycles || []), ...(t.interrupted || [])]
      .filter(c => !(curveKey(serial, c.start) in file.curves)).sort((a, b) => a.start - b.start);
    if (!runs.length) return;
    // runs less than a day apart share one history fetch
    const ranges = [];
    for (const c of runs) {
      const r = ranges[ranges.length - 1];
      if (r && c.start - r.end < DAY) { r.end = Math.max(r.end, c.end); r.runs.push(c); }
      else ranges.push({ start: c.start, end: c.end, runs: [c] });
    }
    for (const r of ranges) {
      const rows = normalize(await history(get, serial, r.start - 30 * 60e3, r.end + 30 * 60e3));
      calls += Math.ceil((r.end - r.start + 60 * 60e3) / CHUNK);
      for (const c of r.runs) {
        const curve = resampleRun(rows, c.start, c.end);
        file.curves[curveKey(serial, c.start)] = curve || 0;
        curve ? made++ : none++;
      }
    }
    save();
  });
  if (made || none) log(`curves: ${made} runs drawn, ${none} without full readings, ~${calls} history calls`);
  return { made, none };
}