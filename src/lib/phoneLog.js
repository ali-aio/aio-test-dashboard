import { padLoad } from './pad.js';
// Today's shared notes in data/phone.json: the iPhone on the pad, and take-outs made before the
// cycle's test is known (pendingOuts).
//
// iPhone on the pad (the lab, 27 Oct 2026: "on some devices we will place an iPhone instead of the
// load, and we need to note the iPhone's battery gain each hour"). The MDM has only the T7's battery,
// so the phone's is typed in on Today, per T7 and per hour of the cycle, and shared through our own
// backend (server/phone.mjs, data/phone.json). Plain JS: the server merges with the same code.
//
// Keys: devices "<cycle day>|<serial>", cells "<cycle day>|<serial>|<hour>" (hour 0 = the cycle's
// start, 1 = an hour later, …). The cycle day is Today's T.key, so a cycle that runs past midnight
// keeps one set of rows.

export const devKey = (day, serial) => `${day}|${serial}`;
export const cellKey = (day, serial, h) => `${day}|${serial}|${h}`;

/** Keep only well-formed entries of a POST body. */
export function cleanPhone(b) {
  const out = { devices: {}, cells: {}, outs: {}, starts: {}, notes: {} };
  for (const [k, v] of Object.entries(b?.devices || {}))
    if (/^\d{4}-\d\d-\d\d\|[\w-]{3,40}$/.test(k) && v && Number.isFinite(v.mod)) out.devices[k] = { on: !!v.on, by: String(v.by || '').slice(0, 60), mod: v.mod };
  for (const [k, v] of Object.entries(b?.cells || {})) {
    if (!/^\d{4}-\d\d-\d\d\|[\w-]{3,40}\|\d{1,2}$/.test(k) || !v || !Number.isFinite(v.mod)) continue;
    const pct = v.pct == null || v.pct === '' ? null : Math.round(+v.pct);
    if (pct != null && !(pct >= 0 && pct <= 100)) continue;
    out.cells[k] = { pct, by: String(v.by || '').slice(0, 60), mod: v.mod };
  }
  // take-outs made on Today before the cycle's test is known (no plan entry to hold them yet):
  // "<cycle day>|<serial>" → { on, reason, note, by, at, mod }; moved onto the plan entry once there is one
  for (const [k, v] of Object.entries(b?.outs || {}))
    if (/^\d{4}-\d\d-\d\d\|[\w-]{3,40}$/.test(k) && v && Number.isFinite(v.mod))
      out.outs[k] = { on: !!v.on, reason: String(v.reason || '').slice(0, 80), note: String(v.note || '').slice(0, 200), by: String(v.by || '').slice(0, 60), at: Number.isFinite(v.at) ? v.at : v.mod, mod: v.mod };
  // the iPhone card's start time for a cycle day, set by hand: "<cycle day>" → { at (ms, null = back to the devices' own), by, mod }
  for (const [k, v] of Object.entries(b?.starts || {}))
    if (/^\d{4}-\d\d-\d\d$/.test(k) && v && Number.isFinite(v.mod)) out.starts[k] = { at: Number.isFinite(v.at) ? v.at : null, by: String(v.by || '').slice(0, 60), mod: v.mod };
  // a cycle note written before the cycle's test is known (the user, 4 Nov 2026): "<cycle day>" → { text, by, mod };
  // moved onto the plan entry once one names the cycle, like the held take-outs
  for (const [k, v] of Object.entries(b?.notes || {}))
    if (/^\d{4}-\d\d-\d\d$/.test(k) && v && Number.isFinite(v.mod)) out.notes[k] = { text: String(v.text || '').slice(0, 2000), by: String(v.by || '').slice(0, 60), mod: v.mod };
  return out;
}

/** Merge b into a, entry by entry: the newer mod wins. */
export function mergePhone(a, b) {
  const pick = (x = {}, y = {}) => { const o = { ...x }; for (const [k, v] of Object.entries(y)) if (!o[k] || v.mod >= o[k].mod) o[k] = v; return o; };
  return { ...a, devices: pick(a?.devices, b?.devices), cells: pick(a?.cells, b?.cells), outs: pick(a?.outs, b?.outs), starts: pick(a?.starts, b?.starts), notes: pick(a?.notes, b?.notes) };
}

/** Take-outs held for a cycle day whose test isn't known yet: [{ serial, reason, note, by, at }]. */
export const pendingOuts = (db, day) => Object.entries(db?.outs || {})
  .filter(([k, v]) => v.on && k.startsWith(day + '|')).map(([k, v]) => ({ serial: k.slice(day.length + 1), reason: v.reason, note: v.note, by: v.by, at: v.at }));

/** The T7s with an iPhone in this cycle, in the order they were added. */
export const phoneDevices = (db, day) => Object.entries(db?.devices || {})
  .filter(([k, v]) => v.on && k.startsWith(day + '|')).sort((x, y) => x[1].mod - y[1].mod).map(([k]) => k.slice(day.length + 1));

/** One T7's iPhone readings for a cycle: [{ h, pct }] by hour, and each hour's gain from the one before.
 *  `auto(h)` (optional) gives the hour's reading taken from the iPhone itself over Wi-Fi (server/iphones.mjs);
 *  a typed value wins over it, and a row filled from it is marked `auto`. */
export function phoneHours(db, day, serial, hours, auto = null) {
  const rows = [];
  for (let h = 0; h <= hours; h++) {
    const c = db?.cells?.[cellKey(day, serial, h)], typed = c?.pct ?? null, a = typed == null && auto ? auto(h) : null;
    rows.push({ h, pct: typed ?? a?.pct ?? null, auto: typed == null && a?.pct != null ? a : null });
  }
  let prev = null;
  for (const r of rows) { r.gain = r.pct != null && prev != null ? r.pct - prev.pct : null; r.per = r.gain != null ? r.gain / (r.h - prev.h) : null; if (r.pct != null) prev = r; }
  const got = rows.filter(r => r.pct != null);
  const total = got.length > 1 ? got[got.length - 1].pct - got[0].pct : null;
  const perH = got.length > 1 && got[got.length - 1].h > got[0].h ? total / (got[got.length - 1].h - got[0].h) : null;
  const full = got.find(r => r.pct >= 100);
  return { rows, total, perH, fullAt: full ? full.h : null };
}

// ---- the iPhones read over Wi-Fi by the lab laptop (GET /api/iphones, server/iphones.mjs) ----
export const AUTO_TOL = 10 * 60e3; // a reading counts for an hour mark within 10 min of it (the laptop reads every 5 min)

/** The iPhone's battery at time t from rows [[t, pct, charging]] (oldest first), not after `now`:
 *  the reading within `tol` of t, else a straight line between the readings either side when they are
 *  at most SPAN apart — the iPhones send theirs on the clock hour (Shortcuts), while a cycle's hours
 *  start whenever the bench came off the charger (10:32 → 11:32, 12:32 …). { at, pct, charging, est? } or null. */
export const SPAN = 75 * 60e3;
export function readingAt(rows, t, now = Infinity, tol = AUTO_TOL) {
  if (!rows?.length || t > now + 60e3) return null;
  let lo = 0, hi = rows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m][0] < t) lo = m + 1; else hi = m; }
  const a = rows[lo - 1], b = rows[lo];
  let best = null;
  for (const r of [a, b]) if (r && Math.abs(r[0] - t) <= tol && (!best || Math.abs(r[0] - t) < Math.abs(best[0] - t))) best = r;
  if (best) return { at: best[0], pct: best[1], charging: !!best[2] };
  if (a && b && b[0] - a[0] <= SPAN && b[0] > a[0]) {
    const pct = Math.round(a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]));
    return { at: t, pct, charging: !!(a[2] && b[2]), est: { from: a[0], to: b[0], a: a[1], b: b[1] } };
  }
  return null;
}

/** Whether the T7 had a load on its pad around time t, from its MDM readings (oldest first, each with
 *  `timestamp` and `extra.wlc_status`): true when a reading within `win` of t has one (padLoad), false
 *  when there are readings there and none has, null when there are none (not known — kept, not hidden).
 *  The iPhone IS the load: once it is off the pad its readings are not this T7's (the user, 2 Nov 2026:
 *  "if device removed from load then don't show iPhone reading"). */
export const PAD_WIN = 15 * 60e3;
export function padAt(rows, t, win = PAD_WIN) {
  if (!rows?.length) return null;
  let lo = 0, hi = rows.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (Date.parse(rows[m].timestamp) < t - win) lo = m + 1; else hi = m; }
  let seen = null;
  for (let i = lo; i < rows.length; i++) {
    if (Date.parse(rows[i].timestamp) > t + win) break;
    const v = padLoad(rows[i].extra?.wlc_status);
    if (v) return true; if (v === false) seen = false;
  }
  return seen;
}

/** The iPhone's reading at t (readingAt), only while it is on the pad: the iPhone charging, and the T7's pad with a load
 *  then (padAt not false). A load on the pad alone may be the lab's own load in the iPhone's place (the user, 13 Nov 2026: the
 *  iPhones hadn't drained, a load went on 00790 / 00606 / 00485, and the card filled the hours from the phones lying beside
 *  them — "start these readings once the iPhone is placed on the pad"). */
export const onPadAt = (phoneRows, t7Rows, t, now = Infinity) => {
  const r = readingAt(phoneRows, t, now);
  return r && r.charging && padAt(t7Rows, t) !== false ? r : null;
};

/** When the iPhone on this T7 finished, from its own readings since `from` (rows [[t, pct, charging]], oldest first):
 *  the first reading at 100 % (`why: 'full'`), or the moment it came off the pad — it stopped charging after charging
 *  and the T7's pad showed no load in between (`why: 'removed'`, at = that pad reading, pct = its level then). A reading that merely says "not charging" with the pad still loaded (a Shortcuts report carries no
 *  charging flag) is not a removal. { at, pct, why } or null (the user, 4 Nov 2026: replace the "next" hour with
 *  the time the iPhone came off charge or reached 100). */
export function iphoneEnd(rows, t7Rows, from) {
  let lastCh = null;
  for (const [t, pct, ch] of rows || []) {
    if (t < from) continue;
    if (pct >= 100) return { at: t, pct, why: 'full' };
    if (ch) { lastCh = [t, pct]; continue; }
    if (!lastCh) continue;
    // the T7's first reading without a load between the last charging reading and 10 min after this one
    let off = null;
    for (const r of t7Rows || []) {
      const rt = Date.parse(r.timestamp); if (rt < lastCh[0] - 5 * 60e3) continue; if (rt > t + 10 * 60e3) break;
      if (padLoad(r.extra?.wlc_status) === false) { off = rt; break; }
    }
    // the level then: the first reading off charge when it came within 10 min (it reads what the phone had banked), else the last charging one
    if (off != null) return { at: Math.min(off, t), pct: t - off <= 10 * 60e3 ? Math.max(pct, lastCh[1]) : lastCh[1], why: 'removed' };
  }
  return null;
}

/** The T7s whose iPhone was read at least twice in [a, b) while on the pad — charging, the pad with a load (`rowsOf(t7)` = its MDM readings). */
export const readT7s = (ip, a, b, rowsOf = () => null) => Object.entries(ip?.readings || {})
  .filter(([t7, rows]) => rows.filter(r => r[0] >= a && r[0] < b && r[2] && padAt(rowsOf(t7), r[0]) !== false).length >= 2).map(([t7]) => t7);

const ipSubs = new Set();
let ip = { phones: [], readings: {} };
export const subscribeIphones = f => { ipSubs.add(f); return () => ipSubs.delete(f); };
export const getIphones = () => ip;
export async function pullIphones() {
  try { const r = await fetch('/api/iphones', { cache: 'no-store' }); if (r.ok) { ip = await r.json(); ipSubs.forEach(f => f()); } } catch (e) { /* keep the last copy */ }
}

// ---- browser side: the shared copy, kept in step with the server ----
const LS = 'phoneLog:v1';
const subs = new Set();
const inBrowser = typeof window !== 'undefined'; // the server imports this file for mergePhone only
let db = (() => { if (!inBrowser) return { devices: {}, cells: {} }; try { return JSON.parse(localStorage.getItem(LS)) || { devices: {}, cells: {} }; } catch (e) { return { devices: {}, cells: {} }; } })();
let backend = true, timer = null;
const emit = () => { if (inBrowser) try { localStorage.setItem(LS, JSON.stringify(db)); } catch (e) {} subs.forEach(f => f()); };
export const subscribePhone = f => { subs.add(f); return () => subs.delete(f); };
export const getPhone = () => db;

export async function pullPhone() {
  try {
    const r = await fetch('/api/phone', { cache: 'no-store' });
    if (!r.ok) { backend = r.status !== 404; return; }
    db = mergePhone(db, await r.json()); emit();
  } catch (e) { /* offline: keep this browser's copy */ }
}
async function push(patch) {
  if (!backend) return;
  try {
    const r = await fetch('/api/phone', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    if (r.ok) { db = mergePhone(db, await r.json()); emit(); } else if (r.status === 404) backend = false;
  } catch (e) { /* the next pull sends nothing back; the cell stays in this browser and is re-sent on the next edit */ }
}
// a change always wins over what is there, whatever the clocks say (4 Nov 2026: Put back on a take-out made from a
// computer whose clock ran ahead was "older" and ignored): its mod is bumped past the entry it replaces
export const bumpPast = (cur, patch) => {
  const out = {};
  for (const sec of ['devices', 'cells', 'outs', 'starts', 'notes']) {
    if (!patch?.[sec]) continue;
    out[sec] = {};
    for (const [k, v] of Object.entries(patch[sec])) { const old = cur?.[sec]?.[k]; out[sec][k] = old && old.mod >= v.mod ? { ...v, mod: old.mod + 1 } : v; }
  }
  return out;
};
const change = patch => { patch = bumpPast(db, patch); db = mergePhone(db, patch); emit(); push(patch); };
export const setPhoneDevice = (day, serial, on, by = '') => change({ devices: { [devKey(day, serial)]: { on, by, mod: Date.now() } } });
export const setPendingOut = (day, serial, rec) => change({ outs: { [devKey(day, serial)]: rec ? { on: true, ...rec, at: rec.at ?? Date.now(), mod: Date.now() } : { on: false, mod: Date.now() } } });
export const setPhoneStart = (day, at, by = '') => change({ starts: { [day]: { at, by, mod: Date.now() } } });
/** The note held for a cycle day whose test isn't known yet ('' = none). */
export const pendingNote = (db, day) => db?.notes?.[day]?.text || '';
export const setPendingNote = (day, text, by = '') => change({ notes: { [day]: { text: String(text || '').trim(), by, mod: Date.now() } } });
export const phoneStart = (db, day) => db?.starts?.[day]?.at ?? null;
export const setPhonePct = (day, serial, h, pct, by = '') => change({ cells: { [cellKey(day, serial, h)]: { pct: pct === '' || pct == null ? null : Math.round(+pct), by, mod: Date.now() } } });
/** Pull now, every minute and on returning to the tab, while a screen that shows it is open. */
export function startPhoneSync() {
  const pull = () => { pullPhone(); pullIphones(); };
  pull();
  timer = setInterval(pull, 60e3);
  const vis = () => { if (document.visibilityState === 'visible') pull(); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
}
