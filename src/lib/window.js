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
import { padLoad } from './pad.js';

export const WINDOW_HOURS = 24 * 7;
const state = { rows: {}, at: 0, loading: false, err: null, failed: 0, failedSerials: [], retryIn: 0 };
// devices whose readings did not come: fetched again after WIN_RETRY_MS, up to WIN_RETRY_ROUNDS times
const WIN_RETRY_MS = 15e3, WIN_RETRY_ROUNDS = 3;
let retryRound = 0, retryTimer = null;
const subs = new Set();
let snapshot = { ...state };
const bump = () => { snapshot = { ...state, at2: Date.now() }; subs.forEach(f => f()); };
export const subscribeWindow = f => { subs.add(f); return () => subs.delete(f); };
export const getWindow = () => snapshot;
// The window refreshes at most every 5 minutes (24 devices against a slow MDM), but the fleet
// snapshot arrives every 30 s. Each device's latest check-in is added as its newest reading,
// so Today sees a device come off the charger within 30 s rather than 5–10 minutes later.
const live = {}, joined = new Map();
export function setLive(DEV) {
  let changed = false;
  for (const d of DEV) {
    const s = d.snap; if (!s?.last_seen_at || s.battery_pct == null) continue;
    if (live[d.serial]?.timestamp === s.last_seen_at) continue;
    let e = s.extra; if (typeof e === 'string') { try { e = JSON.parse(e); } catch (err) { e = {}; } }
    live[d.serial] = { timestamp: s.last_seen_at, battery_pct: s.battery_pct, live: true,
      extra: { charging: s.charging, battery_temp_c: s.battery_temp_c, wlc_status: e?.wlc_status } };
    changed = true;
  }
  if (changed) bump();
}
export const rowsFor = serial => {
  const rows = state.rows[serial] || [], l = live[serial];
  if (!l) return rows;
  const hit = joined.get(serial);
  if (hit && hit.rows === rows && hit.l === l) return hit.out; // same array while nothing changed
  const last = rows.length ? Date.parse(rows[rows.length - 1].timestamp) : 0;
  const out = Date.parse(l.timestamp) > last + 60e3 ? [...rows, l] : rows;
  joined.set(serial, { rows, l, out });
  return out;
};

// Every check-in the MDM holds (devices check in about every 3 min; 60 s spacing returns each
// one), so times, peaks and levels are the MDM's own readings, not a 5-minute sample of them.
const IV = 60;
// Re-ask for the last half hour each time: the newest buckets may have been partial.
const OVERLAP = 30 * MIN;

async function readCache(serials) {
  if (!isAvailable()) return {};
  try {
    const all = await withStore(STORES.readings, 'readonly', st => st.getAll());
    const want = new Set(serials), out = {};
    for (const r of all || []) if (want.has(r.id) && r.iv === IV) out[r.id] = r; // an older, coarser copy is re-read
    return out;
  } catch (e) { return {}; }
}
async function writeCache(rows, at) {
  if (!isAvailable()) return;
  try { await withStore(STORES.readings, 'readwrite', st => { for (const [id, list] of Object.entries(rows)) st.put({ id, at, iv: IV, rows: list }); }); }
  catch (e) { /* storage blocked or full — the next visit just fetches the full window */ }
}

let restored = false;
export async function loadWindow(DEV, force = false, retry = false) {
  if (state.loading || !DEV.length) return;
  if (!force && !retry && state.at && Date.now() - state.at < 5 * MIN) return;
  if (!retry) retryRound = 0;
  clearTimeout(retryTimer); state.retryIn = 0;
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
      const fresh = normalize(await fetchHistoryRange(d.serial, since, now, IV));
      out[d.serial] = [...old.filter(r => Date.parse(r.timestamp) < since), ...fresh];
    });
    state.failedSerials = DEV.filter(d => !out[d.serial]).map(d => d.serial); // mapLimit swallows per-device errors
    state.failed = state.failedSerials.length;
    // try the missing devices again shortly (the rest only fetch what came in since)
    if (state.failed && retryRound < WIN_RETRY_ROUNDS) {
      retryRound++; state.retryIn = Date.now() + WIN_RETRY_MS;
      retryTimer = setTimeout(() => loadWindow(DEV, false, true), WIN_RETRY_MS);
    }
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
// `ended`: the cycle is over, so a device back on charge at its end did what the test does.
export function conform(serial, tt, from, to, { ended = false } = {}) {
  const rows = rowsFor(serial).filter(r => { const t = Date.parse(r.timestamp); return t >= from && t <= to; });
  if (rows.length < 2) return { serial, state: 'silent', rows };
  const a = rows[0].battery_pct, b = rows[rows.length - 1].battery_pct, chg = !!rows[rows.length - 1].extra?.charging;
  const delta = b - a;
  if (!tt) return { serial, state: 'untyped', delta, rows };
  const ok = tt.expect === 'charge' ? (delta >= 3 || chg) : (-delta >= 3 && (ended || !chg));
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
// Elapsed time, drain rate and the chart's left edge should all count from the moment it
// came off the charger, not from the window. The run is found where the level drops 2+
// points below its peak (one point is charger wobble); its start is then the moment the
// charging flag went off before that drop — a device pulled at 100% reads 100% for a good
// while (875: unplugged 09:46, still 100% at 10:10). Without a charging flag to go by, the
// LAST sample at the peak.
// The switch-off lies between the last check-in on charge and the first one off it — and a
// device can go 10 minutes without checking in (232: on charge 10:01:25, next check-in 10:11:30,
// off). The MDM records nothing in between, so the run is dated from the LAST check-in on
// charge: the lab pulls the devices right after it. Both stamps are kept (`after`, `firstOff`)
// so the screen can show the gap.
const offAt = (on, off) => ({ t: Date.parse(on.timestamp), pct: off.battery_pct, after: Date.parse(on.timestamp), firstOff: Date.parse(off.timestamp) });
export function runStartOf(rows) {
  if (!rows || rows.length < 2) return null;
  let peak = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].battery_pct >= rows[peak].battery_pct) peak = i;
    else if (rows[peak].battery_pct - rows[i].battery_pct >= 2) {
      let j = peak;
      while (j > 0 && rows[j - 1].extra?.charging === false) j--;
      const flag = j > 0 && rows[j - 1].extra?.charging === true && rows[j].extra?.charging === false;
      return flag ? offAt(rows[j - 1], rows[j]) : { t: Date.parse(rows[peak].timestamp), pct: rows[peak].battery_pct };
    }
  }
  // No drop yet, but it is off the charger now (a device pulled at 100% reads 100% for 10–15
  // minutes): the run starts at the switch-off, as long as it has stayed off since.
  let k = rows.length - 1;
  while (k >= 0 && rows[k].extra?.charging === false) k--;
  if (k >= 0 && k < rows.length - 1 && rows[k].extra?.charging === true) return offAt(rows[k], rows[k + 1]);
  return null; // still on charge, or never fell far enough to call it a run
}

// The window holds every check-in (about every 3 min), and the newest reading can be the live
// snapshot, so the switch-off can still sit in a gap of a few minutes. Narrow it down: fetch just
// that gap and take the first reading off the charger. One small request per device and run,
// remembered for the session.
const refined = new Map(), tried = new Map(); // tried: when a lookup last came back empty
const RETRY_MS = 2 * MIN;
// Keyed on the last reading still on charge: it stays put while the newest (live) reading moves.
const rkey = (serial, start) => `${serial}@${start.after ?? start.t}`;
export const refinedStart = (serial, start) => (start ? refined.get(rkey(serial, start)) || null : null);
export async function refineStarts(list) {
  const now = Date.now();
  const todo = list.filter(({ serial, start }) => start?.after && !refined.has(rkey(serial, start)) && !(now - (tried.get(rkey(serial, start)) || 0) < RETRY_MS));
  await mapLimit(todo, 4, async ({ serial, start }) => {
    const key = rkey(serial, start);
    try {
      // between the last on-charge reading we hold and the first one off: any check-ins the
      // window does not have yet (the newest reading may be the live snapshot)
      const rows = normalize(await fetchHistoryRange(serial, start.after, (start.firstOff ?? start.t) + 60e3, 60))
        .filter(r => Date.parse(r.timestamp) >= start.after && Date.parse(r.timestamp) <= (start.firstOff ?? start.t));
      const i = rows.findIndex(r => r.extra?.charging === false);
      // an empty answer (history not written yet) is asked again after RETRY_MS, not every 30 s
      if (i > 0 && rows[i - 1].extra?.charging === true) refined.set(key, { ...start, ...offAt(rows[i - 1], rows[i]) });
      else if (i === 0) refined.set(key, start);
      else tried.set(key, Date.now());
    } catch (e) { tried.set(key, Date.now()); }
  });
  return todo.length;
}

// When the cycle a device is running NOW began: walk back from its newest reading while the
// battery keeps falling (1 point of noise allowed) and it was off the charger. Null when it
// is charging, or has not dropped at least 2 points — i.e. no cycle is running.
export function currentCycleStart(rows) {
  if (!rows || rows.length < 2) return null;
  const last = rows[rows.length - 1];
  if (last.extra?.charging) return null;
  let i = rows.length - 1;
  while (i > 0 && !rows[i - 1].extra?.charging && rows[i - 1].battery_pct >= rows[i].battery_pct - 1) i--;
  return rows[i].battery_pct - last.battery_pct >= 2 ? { t: Date.parse(rows[i].timestamp), pct: rows[i].battery_pct } : null;
}

// The discharge a device is running now, shaped like a detected cycle so the Overview can
// show a test in progress: from when it came off the charger full to its latest reading.
// Only when it started full (>= 95%), reported in the last hour, and is not a cycle that
// has already been detected (the last finished one ends before it starts).
export function runningCycle(rows, lastFinished, now = Date.now()) {
  if (!rows || rows.length < 2) return null;
  const st = currentCycleStart(rows);
  if (!st || st.pct < 95) return null;
  const last = rows[rows.length - 1], lastT = Date.parse(last.timestamp);
  if (now - lastT > 3600e3) return null;
  if (lastFinished && lastFinished.end >= st.t) return null;
  const durationMs = lastT - st.t, drained = st.pct - last.battery_pct;
  return { start: st.t, end: lastT, startPct: st.pct, endPct: last.battery_pct, durationMs, reason: 'running', inProgress: true,
    fullMs: drained >= 1 ? durationMs / drained * 100 : null };
}

// The same run split by what the T7 was doing, in points per hour: WLC active (a load on its
// wireless pad, wlc_status ≠ 0), WLC inactive (the pad on, wlc_charging, but no load) and ads only
// (the pad off). Ads run in all three. Each gap between two readings off the charger, ≤ 30 min apart,
// counts for the state of its first reading; a state needs 20 min of readings, else null.
// Restaurant Case: 3 h with the load, then without — one number for both hides each (the user, Oct 2026).
export function drainSplit(rows, start) {
  const acc = { active: [0, 0], inactive: [0, 0], ads: [0, 0] };
  if (!start || !rows) return { active: null, inactive: null, ads: null };
  const rs = rows.filter((r) => !r.empty && Date.parse(r.timestamp) >= start.t);
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1], b = rs[i], dt = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    if (dt <= 0 || dt > 30 * 60e3 || a.extra?.charging || b.extra?.charging) continue;
    const k = padLoad(a.extra?.wlc_status) ? 'active' : a.extra?.wlc_charging === true ? 'inactive' : 'ads';
    acc[k][0] += a.battery_pct - b.battery_pct; acc[k][1] += dt;
  }
  const rate = ([d, ms]) => (ms >= 20 * 60e3 ? d / (ms / H) : null);
  return { active: rate(acc.active), inactive: rate(acc.inactive), ads: rate(acc.ads) };
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
