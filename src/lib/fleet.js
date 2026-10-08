// Fleet store — all the loading and deriving, with no React in it (the same split T7
// uses: src/lib is plain JS, the components only read it). A tiny subscribe/snapshot
// surface lets React bind to it with useSyncExternalStore.
//
// History = data/cycles.json (the one-off static import) + everything since, which comes
// from the backend's sweep (data/topup.json) or, served without the backend, from a
// per-browser top-up cached for 6 h. Live state = /testdata/devices, polled every 30 s.
import { fetchDevices, fetchHistoryRange, mapLimit, detectBackend, hasConfig, scopeGroup } from './data.js';
import { detectCycles, aggregate, reclassify, loadOpts } from './cycles.js';
import { batteryHealth, chargeSegments, thermalStats } from './profile.js';
import { loadRuns, normalize } from './runs.js';

const H = 3600e3, DAY = 24 * H;

export const GROUP = scopeGroup() || 'Test Cycles';
const TOPKEY = `histTopup:v3:${GROUP}`;

const state = {
  DEV: [], DMAP: new Map(), allCycles: [], runs: [], cycleRun: new Map(),
  meta: null, server: null, ready: false, error: null, opts: loadOpts(), backend: false, seed: null, sweep: null,
};
let snapshot = { ...state }, HIST = {}, TOP = {}, local = loadRuns(GROUP);
const subs = new Set();
const bump = () => { snapshot = { ...state, at: Date.now() }; subs.forEach(f => f()); };

export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const getSnapshot = () => snapshot;
export const device = serial => state.DMAP.get(serial) || null;
export const setOpts = o => { state.opts = o; derive(); bump(); };

const stub = serial => ({ serial, tag: serial.slice(-5), snap: null, cycles: [], interrupted: [], charges: [], health: null, agg: aggregate([[]]), lastCycle: null });

function setDevices(rows) {
  const old = state.DMAP; state.DMAP = new Map();
  state.DEV = rows.map(r => { const d = old.get(r.serial_number) || stub(r.serial_number); d.snap = r; state.DMAP.set(d.serial, d); return d; })
    .sort((a, b) => a.serial < b.serial ? -1 : 1);
}

// Rebuild everything derived from history: per-device aggregates and the runs list. Past
// runs are recovered from history (>= 6 devices starting a counted cycle within 2 h),
// except where a run started from this dashboard already covers that time.
function derive() {
  const O = state.opts;
  for (const d of state.DEV) {
    const h = HIST[d.serial] || {}, t = TOP[d.serial] || {};
    ({ cycles: d.cycles, interrupted: d.interrupted } = reclassify([...(h.cycles || []), ...(t.cycles || [])], [...(h.interrupted || []), ...(t.interrupted || [])], O));
    const th = t.thermal || {}; d.cycles.forEach(c => { if (th[c.start]) c.thermal = th[c.start]; });
    d.charges = t.charges || []; d.health = batteryHealth(d.cycles);
    d.agg = aggregate([d.cycles]); d.lastCycle = d.cycles[d.cycles.length - 1] || null;
  }
  state.allCycles = state.DEV.flatMap(d => d.cycles);
  state.cycleRun = new Map();
  const ev = state.DEV.flatMap(d => d.cycles.map(c => ({ d, c }))).sort((a, b) => a.c.start - b.c.start), clusters = [];
  let cur = null;
  for (const e of ev) { if (cur && e.c.start - cur.t0 <= 2 * H && !cur.items.some(i => i.d === e.d)) cur.items.push(e); else clusters.push(cur = { t0: e.c.start, items: [e] }); }
  const recovered = []; let n = 0;
  for (const c of clusters) {
    if (c.items.length < 6) continue;
    const mine = local.find(r => Math.abs(r.startedAt - c.t0) < 3 * H);
    if (mine) { c.items.forEach(x => state.cycleRun.set(x.c, mine.id)); continue; }
    const id = 'R-' + String(++n).padStart(3, '0');
    recovered.push({ id, name: 'Test cycle', startedAt: c.t0, endedAt: Math.max(...c.items.map(x => x.c.end)), status: 'complete', historical: true,
      devices: c.items.map(({ d, c }) => ({ serial: d.serial, state: 'done', cycle: c })).sort((a, b) => a.serial < b.serial ? -1 : 1) });
    c.items.forEach(x => state.cycleRun.set(x.c, id));
  }
  state.runs = [...local, ...recovered].sort((a, b) => b.startedAt - a.startedAt);
}

// Cycles detected since the static import. Preferred source: data/topup.json, written by
// the backend sweep and shared by every browser; otherwise one /history call per device.
async function topUpFromServer(force) {
  try {
    if (force) { const r = await fetch('/api/sweep', { method: 'POST' }); state.server = await r.json(); if (!r.ok) throw new Error(state.server.lastError || r.statusText); }
    else if (!state.server) { const r = await fetch('/api/status', { cache: 'no-store' }); if (!r.ok) return false; state.server = await r.json(); }
    const r = await fetch('/data/topup.json', { cache: 'no-store' });
    if (!r.ok) { if (state.server.sweeping) { setTimeout(() => topUpFromServer(false).catch(() => {}), 30e3); return true; } return !!state.server.lastError; }
    const t = await r.json();
    // Same rule as the static import: merge per device, not per group label. The sweep may
    // be scoped to a different group than this browser; whatever devices it covers that are
    // also in scope here are still this device's own history. Anything it does not cover
    // falls through to the in-browser top-up below.
    const covered = state.DEV.filter(d => t.devices?.[d.serial]).length;
    state.sweep = { group: t.group, covered, fleet: state.DEV.length };
    if (!covered) return false;
    TOP = t.devices; derive(); bump(); return true;
  } catch (e) { if (force) throw e; return false; }
}
export async function topUp(force = false) {
  if (await topUpFromServer(force)) return;
  let c = null; try { c = JSON.parse(localStorage.getItem(TOPKEY)); } catch (e) {}
  if (c) { TOP = c.devices; derive(); bump(); }
  if (c && !force && Date.now() - c.at < 6 * H) return;
  const now = Date.now(), base = state.meta ? Date.parse(state.meta.generatedAt) : now;
  const from = Math.min(base - 3 * DAY, now - 14 * DAY), out = {};
  await mapLimit(state.DEV, 3, async d => {
    const rows = normalize(await fetchHistoryRange(d.serial, from, now, 600)), res = detectCycles(rows, { nowMs: now, ...state.opts, offlineMin: 45 });
    const h = HIST[d.serial] || {}, lastC = h.cycles?.length ? h.cycles[h.cycles.length - 1].end : from, lastI = h.interrupted?.length ? h.interrupted[h.interrupted.length - 1].end : from;
    const thermal = {}; [...res.cycles, ...(h.cycles || []).filter(c => c.start >= from)].forEach(c => { const t = thermalStats(rows, c.start, c.end); if (t) thermal[c.start] = t; });
    out[d.serial] = { cycles: res.cycles.filter(x => x.start >= lastC), interrupted: res.interrupted.filter(x => x.start >= lastI), charges: chargeSegments(rows), thermal };
  });
  if (Object.keys(out).length < state.DEV.length) return; // a partial sweep would under-report; keep the old cache
  TOP = out; try { localStorage.setItem(TOPKEY, JSON.stringify({ at: now, devices: out })); } catch (e) {}
  derive(); bump();
}

export async function boot() {
  state.ready = false; state.error = null; bump();
  state.backend = await detectBackend();
  if (!hasConfig()) { state.error = 'No API key configured.'; bump(); return; }
  try {
    const [rows, hist] = await Promise.all([
      fetchDevices({ fresh: true }),
      fetch('/data/cycles.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    // The static import is most of the history (364 cycles against the sweep's ~20). It was
    // generated for the "Test Cycles" group, but a cycle is a fact about a DEVICE, not about
    // a group — so it is merged per serial, for whichever of its devices are in scope now,
    // rather than only when the file's group label matches. Devices in the current group
    // that the import never covered simply have no history before the sweep started.
    setDevices(rows);
    if (!hist) state.seed = { ok: false, why: 'data/cycles.json did not load' };
    else {
      state.meta = hist; HIST = hist.devices;
      const mine = state.DEV.filter(d => HIST[d.serial]);
      state.seed = {
        ok: mine.length > 0, group: hist.group, covered: mine.length, fleet: state.DEV.length,
        cycles: mine.reduce((n, d) => n + (HIST[d.serial].cycles?.length || 0), 0),
        missing: state.DEV.filter(d => !HIST[d.serial]).map(d => d.serial),
        why: mine.length ? null : `data/cycles.json covers none of the ${state.DEV.length} devices in "${GROUP}"`,
      };
    }
    try { TOP = JSON.parse(localStorage.getItem(TOPKEY))?.devices || {}; } catch (e) {}
    derive(); state.ready = true; bump();
    topUp().catch(e => console.warn('history top-up failed:', e));
  } catch (e) {
    state.error = e.message === 'Failed to fetch' ? 'Network error — the MDM is unreachable from this machine.' : `The MDM answered ${e.message}.`;
    bump();
  }
}

export async function poll() {
  if (!state.ready || document.hidden) return;
  try { setDevices(await fetchDevices({ fresh: true })); derive(); state.error = null; bump(); } catch (e) { /* keep the last snapshot on screen */ }
}
export function startPolling() {
  const t = setInterval(poll, 30e3);
  const vis = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
}
