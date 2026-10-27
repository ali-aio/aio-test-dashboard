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
  const out = { devices: {}, cells: {} };
  for (const [k, v] of Object.entries(b?.devices || {}))
    if (/^\d{4}-\d\d-\d\d\|[\w-]{3,40}$/.test(k) && v && Number.isFinite(v.mod)) out.devices[k] = { on: !!v.on, by: String(v.by || '').slice(0, 60), mod: v.mod };
  for (const [k, v] of Object.entries(b?.cells || {})) {
    if (!/^\d{4}-\d\d-\d\d\|[\w-]{3,40}\|\d{1,2}$/.test(k) || !v || !Number.isFinite(v.mod)) continue;
    const pct = v.pct == null || v.pct === '' ? null : Math.round(+v.pct);
    if (pct != null && !(pct >= 0 && pct <= 100)) continue;
    out.cells[k] = { pct, by: String(v.by || '').slice(0, 60), mod: v.mod };
  }
  return out;
}

/** Merge b into a, entry by entry: the newer mod wins. */
export function mergePhone(a, b) {
  const pick = (x = {}, y = {}) => { const o = { ...x }; for (const [k, v] of Object.entries(y)) if (!o[k] || v.mod >= o[k].mod) o[k] = v; return o; };
  return { ...a, devices: pick(a?.devices, b?.devices), cells: pick(a?.cells, b?.cells) };
}

/** The T7s with an iPhone in this cycle, in the order they were added. */
export const phoneDevices = (db, day) => Object.entries(db?.devices || {})
  .filter(([k, v]) => v.on && k.startsWith(day + '|')).sort((x, y) => x[1].mod - y[1].mod).map(([k]) => k.slice(day.length + 1));

/** One T7's iPhone readings for a cycle: [{ h, pct }] by hour, and each hour's gain from the one before. */
export function phoneHours(db, day, serial, hours) {
  const rows = [];
  for (let h = 0; h <= hours; h++) { const c = db?.cells?.[cellKey(day, serial, h)]; rows.push({ h, pct: c?.pct ?? null }); }
  let prev = null;
  for (const r of rows) { r.gain = r.pct != null && prev != null ? r.pct - prev.pct : null; r.per = r.gain != null ? r.gain / (r.h - prev.h) : null; if (r.pct != null) prev = r; }
  const got = rows.filter(r => r.pct != null);
  const total = got.length > 1 ? got[got.length - 1].pct - got[0].pct : null;
  const perH = got.length > 1 && got[got.length - 1].h > got[0].h ? total / (got[got.length - 1].h - got[0].h) : null;
  const full = got.find(r => r.pct >= 100);
  return { rows, total, perH, fullAt: full ? full.h : null };
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
const change = patch => { db = mergePhone(db, patch); emit(); push(patch); };
export const setPhoneDevice = (day, serial, on, by = '') => change({ devices: { [devKey(day, serial)]: { on, by, mod: Date.now() } } });
export const setPhonePct = (day, serial, h, pct, by = '') => change({ cells: { [cellKey(day, serial, h)]: { pct: pct === '' || pct == null ? null : Math.round(+pct), by, mod: Date.now() } } });
/** Pull now, every minute and on returning to the tab, while a screen that shows it is open. */
export function startPhoneSync() {
  pullPhone();
  timer = setInterval(pullPhone, 60e3);
  const vis = () => { if (document.visibilityState === 'visible') pullPhone(); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); };
}
