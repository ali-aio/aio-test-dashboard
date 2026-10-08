// The recent-history window the Today and Overview screens read.
//
// The 30-min sweep is too coarse for "temperature today", so these screens pull a 48 h
// window per device at the 5-min interval. 48 h, not 24, because a bench run can start
// before midnight and an in-progress discharge has to be found from its start.
//
// The window is kept in the browser (IndexedDB, src/lib/db.js), so opening the page draws
// straight from the last copy and then asks the MDM only for the readings since — one
// short request per device instead of seven days' worth every time.
import { fetchHistoryRange, mapLimit } from './data.js';
import { STORES, withStore, isAvailable } from './db.js';
import { normalize, detectCycles } from './cycles.js';
import { TEMP_WARN, TEMP_LIMIT } from './profile.js';
import { H, MIN, median } from './format.js';

export const WINDOW_HOURS = 24 * 7;
const state = { rows: {}, at: 0, loading: false, err: null, failed: 0 };
const subs = new Set();
let snapshot = { ...state };
const bump = () => { snapshot = { ...state, at2: Date.now() }; subs.forEach(f => f()); };
export const subscribeWindow = f => { subs.add(f); return () => subs.delete(f); };
export const getWindow = () => snapshot;
export const rowsFor = serial => state.rows[serial] || [];

// Re-ask for the last half hour each time: the newest buckets may have been partial.
const OVERLAP = 30 * MIN;

async function readCache(serials) {
  if (!isAvailable()) return {};
  try {
    const all = await withStore(STORES.readings, 'readonly', st => st.getAll());
    const want = new Set(serials), out = {};
    for (const r of all || []) if (want.has(r.id)) out[r.id] = r;
    return out;
  } catch (e) { return {}; }
}
async function writeCache(rows, at) {
  if (!isAvailable()) return;
  try { await withStore(STORES.readings, 'readwrite', st => { for (const [id, list] of Object.entries(rows)) st.put({ id, at, rows: list }); }); }
  catch (e) { /* storage blocked or full — the next visit just fetches the full window */ }
}

let restored = false;
export async function loadWindow(DEV, force = false) {
  if (state.loading || !DEV.length) return;
  if (!force && state.at && Date.now() - state.at < 5 * MIN) return;
  state.loading = true; state.err = null;
  try {
    // Read the stored copy before announcing the load, so a return visit never shows the
    // "reading history" banner for the moment the copy takes to come out of IndexedDB.
    const cache = force ? {} : await readCache(DEV.map(d => d.serial));
    bump();
    // Paint the stored copy first, so the charts are up before the network is asked anything.
    if (!restored && Object.keys(cache).length) {
      restored = true;
      state.rows = Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, v.rows]));
      state.at = Math.min(...Object.values(cache).map(v => v.at)); bump();
    }
    const now = Date.now(), from = now - WINDOW_HOURS * H, out = {};
    await mapLimit(DEV, 3, async d => {
      const old = (cache[d.serial]?.rows || []).filter(r => Date.parse(r.timestamp) >= from);
      const last = old.length ? Date.parse(old[old.length - 1].timestamp) : 0;
      const since = last ? Math.max(from, last - OVERLAP) : from;
      const fresh = normalize(await fetchHistoryRange(d.serial, since, now, 300));
      out[d.serial] = [...old.filter(r => Date.parse(r.timestamp) < since), ...fresh];
    });
    state.failed = DEV.filter(d => !out[d.serial]).length; // mapLimit swallows per-device errors
    if (state.failed === DEV.length) throw new Error('history unavailable for every device');
    // a device whose request failed keeps the copy it had rather than going blank
    for (const d of DEV) if (!out[d.serial] && state.rows[d.serial]) out[d.serial] = state.rows[d.serial];
    state.rows = out; state.at = now;
    writeCache(out, now);
  } catch (e) { state.err = e.message; }
  finally { state.loading = false; bump(); }
}

export const temp = r => { const t = r.extra?.battery_temp_c; return typeof t === 'number' && t > 0 ? t : null; };

// A statistic across devices per 10-min bucket, so one device going offline doesn't put
// a step in the line.
export function buckets(serials, from, to, pick, stat) {
  const step = 10 * MIN, b = new Map();
  for (const s of serials) for (const r of rowsFor(s)) {
    const t = Date.parse(r.timestamp); if (t < from || t > to) continue;
    const v = pick(r); if (v == null || !isFinite(v)) continue;
    const k = Math.floor((t - from) / step);
    if (!b.has(k)) b.set(k, []);
    b.get(k).push(v);
  }
  return [...b.keys()].sort((x, y) => x - y).map(k => ({ x: from + k * step, y: stat(b.get(k)), n: b.get(k).length }));
}

export function dayStats(serial, from) {
  const rows = rowsFor(serial).filter(r => Date.parse(r.timestamp) >= from);
  if (rows.length < 2) return null;
  const temps = rows.map(temp).filter(t => t != null);
  let m40 = 0, m45 = 0, drained = 0;
  for (let i = 1; i < rows.length; i++) {
    const t = temp(rows[i]), gap = Math.min(Date.parse(rows[i].timestamp) - Date.parse(rows[i - 1].timestamp), 30 * MIN);
    if (t != null && t >= TEMP_WARN) m40 += gap;
    if (t != null && t >= TEMP_LIMIT) m45 += gap;
    const drop = rows[i - 1].battery_pct - rows[i].battery_pct;
    if (drop > 0) drained += drop;
  }
  return { n: rows.length, startPct: rows[0].battery_pct, endPct: rows[rows.length - 1].battery_pct, drained,
    maxTemp: temps.length ? Math.max(...temps) : null, avgTemp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    minAbove40: Math.round(m40 / MIN), minAbove45: Math.round(m45 / MIN),
    battPts: rows.map(r => ({ x: Date.parse(r.timestamp), y: r.battery_pct })),
    tempPts: rows.filter(r => temp(r) != null).map(r => ({ x: Date.parse(r.timestamp), y: temp(r) })) };
}

// Does a device's telemetry look like the declared test? A discharge test wants the
// battery going down and the device off charge; a charging test the reverse. The 3-point
// floor is the one the T7 dashboard uses to decide a run moved the battery at all.
export function conform(serial, tt, from, to) {
  const rows = rowsFor(serial).filter(r => { const t = Date.parse(r.timestamp); return t >= from && t <= to; });
  if (rows.length < 2) return { serial, state: 'silent', rows };
  const a = rows[0].battery_pct, b = rows[rows.length - 1].battery_pct, chg = !!rows[rows.length - 1].extra?.charging;
  const delta = b - a;
  if (!tt) return { serial, state: 'untyped', delta, rows };
  const ok = tt.expect === 'charge' ? (delta >= 3 || chg) : (-delta >= 3 && !chg);
  return { serial, state: ok ? 'conforming' : 'drifting', delta, charging: chg, rows };
}

// The discharge the bench is in the middle of, from the same detector the rest of the app
// uses: every device with an in-progress discharge, clustered into one run.
export function running(DEV, opts) {
  const now = Date.now(), ips = [];
  for (const d of DEV) {
    const rows = rowsFor(d.serial); if (rows.length < 2) continue;
    let res; try { res = detectCycles(rows, { nowMs: now, ...opts }); } catch (e) { continue; }
    if (res.inProgress) ips.push({ d, ip: res.inProgress });
  }
  if (!ips.length) return null;
  const start = Math.min(...ips.map(x => x.ip.start));
  return { devices: ips.sort((a, b) => a.ip.start - b.ip.start), start, elapsedMs: now - start,
    drained: median(ips.map(x => x.ip.startPct - x.ip.nowPct)) };
}

// When did this device's run actually start? The declared window opens at, say, 07:00,
// but devices sit full on the charger until someone pulls them — 11:00 on a typical day.
// Elapsed time, drain rate and the chart's left edge should all count from the moment
// the battery started to fall, not from the window. That moment is the LAST sample at
// the run's peak before the level dropped by 2+ points (one point is charger wobble).
export function runStartOf(rows) {
  if (!rows || rows.length < 2) return null;
  let peak = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].battery_pct >= rows[peak].battery_pct) peak = i;
    else if (rows[peak].battery_pct - rows[i].battery_pct >= 2) {
      return { t: Date.parse(rows[peak].timestamp), pct: rows[peak].battery_pct };
    }
  }
  return null; // still full, or never fell far enough to call it a run
}

// Drain since the run started, in percentage points per hour, from the device's own
// first and latest readings. Null until the run is at least 20 minutes old — before that
// the rate is two samples of noise.
export function drainSince(rows, start) {
  if (!start || !rows || !rows.length) return null;
  const last = rows[rows.length - 1], h = (Date.parse(last.timestamp) - start.t) / H;
  if (h < 1 / 3) return null;
  return (start.pct - last.battery_pct) / h;
}
