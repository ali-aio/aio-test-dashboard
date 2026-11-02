// Room temperature and humidity in the lab (the user, 2 Nov 2026): the T7s report only their battery's
// temperature, so an ESP32-S3 with an SHT30 (firmware/room-sensor/) sends the room's own reading to the
// lab laptop every minute: POST /api/room/report (server/room.mjs). Today shows it as the Room temp tile.
// Plain JS, no React: the server validates reports with parseReport, the browser summarises with roomSummary.

export const STALE_MIN = 10; // no reading for this long = "sensor not heard from"
export const KEEP_DAYS = 120;

const num = (v) => { const x = String(v ?? '').trim().replace(/\s*(°C|C|%)$/i, ''); const n = Number(x); return x !== '' && Number.isFinite(n) ? n : null; };

/** One report → { sensor, rows: [[t, tempC, rh]] } or { error }. Takes a single reading
 *  ({ sensor, t, rh }) or a batch held while the laptop was unreachable ({ sensor, readings: [{ t, rh, ago }] },
 *  `ago` = seconds before now). Temperatures outside −20…80 °C and humidity outside 0…100 % are refused. */
export function parseReport(q, now = Date.now()) {
  const sensor = String(q?.sensor || 'room').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!sensor) return { error: 'sensor must be letters, digits, - or _' };
  const list = Array.isArray(q?.readings) ? q.readings.slice(0, 500) : [q];
  const rows = [];
  for (const r of list) {
    const t = num(r?.t ?? r?.temp), rh = num(r?.rh ?? r?.humidity), ago = num(r?.ago) ?? 0;
    if (t == null || t < -20 || t > 80) continue;
    rows.push([Math.round(now - Math.max(0, Math.min(ago, 86400)) * 1000), Math.round(t * 10) / 10, rh != null && rh >= 0 && rh <= 100 ? Math.round(rh) : null]);
  }
  if (!rows.length) return { error: 't must be a temperature in °C (−20 … 80)' };
  rows.sort((a, b) => a[0] - b[0]);
  return { sensor, rows };
}

/** What the Today tile shows: the latest reading, and the range / average since `from` (the cycle's start).
 *  rows = [[t, tempC, rh]], oldest first. */
export function roomSummary(rows, from, now = Date.now()) {
  if (!rows?.length) return null;
  const last = rows[rows.length - 1];
  const since = rows.filter(r => r[0] >= from && r[0] <= now);
  const ts = since.map(r => r[1]);
  return {
    at: last[0], t: last[1], rh: last[2],
    stale: now - last[0] > STALE_MIN * 60e3,
    min: ts.length ? Math.min(...ts) : null, max: ts.length ? Math.max(...ts) : null,
    avg: ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length * 10) / 10 : null,
    n: since.length,
  };
}

// ---- browser side: GET /api/room every minute ----
const subs = new Set();
let room = { sensors: [] };
let timer = null;
export const subscribeRoom = f => { subs.add(f); return () => subs.delete(f); };
export const getRoom = () => room;
export async function pullRoom() {
  try { const r = await fetch('/api/room', { cache: 'no-store' }); if (r.ok) { room = await r.json(); subs.forEach(f => f()); } } catch (e) { /* keep the last copy */ }
}
export function startRoomSync() {
  if (typeof window === 'undefined') return () => {};
  if (!timer) { pullRoom(); timer = setInterval(pullRoom, 60e3); }
  const onFocus = () => pullRoom();
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}
