// Device state read off the latest /testdata/devices snapshot. Plain JS, no React.
import { MIN } from './format.js';
import { mdmCyclesFor } from './mdmTrack.js';
export const online = d => d.snap && Date.now() - Date.parse(d.snap.last_seen_at) < 15 * MIN;
export const isReady = d => online(d) && !d.snap.charging && d.snap.battery_pct >= 95;
export function status(d) {
  const s = d.snap; if (!s) return { k: 'off', cls: 'b-off', label: 'Unknown', pct: null, val: '—' };
  const pct = s.battery_pct;
  if (!online(d)) return pct < 5 ? { k: 'off', cls: 'b-off', label: 'Shut down', pct: null, val: 'Off' } : { k: 'off', cls: 'b-off', label: 'Offline', pct: null, val: '—' };
  if (s.charging) return { k: 'ready', cls: 'b-ok', label: pct >= 95 ? 'Charged' : 'Charging', pct, val: pct + '%' };
  if (pct < 5) return { k: 'warn', cls: 'b-warn', label: 'Low', pct, val: pct + '%' };
  return { k: 'run', cls: 'b-run', label: 'On battery', pct, val: pct + '%' };
}

// Lifetime battery cycles as the MDM counts them: discharge_total_pct ÷ 100, straight from
// GET /testdata/devices. Per device and lifetime only — the API cannot split it by test,
// firmware or date. null (shown "—", never 0) when the device does not report it.
export const lifetimeCycles = (snap) =>
  typeof snap?.discharge_total_pct === 'number' && Number.isFinite(snap.discharge_total_pct)
    ? snap.discharge_total_pct / 100 : null;

// Sum over a set of serials, keeping which ones had no reading so a total never quietly
// counts a missing device as 0.
export function lifetimeOf(serials, snapOf) {
  const rows = serials.map(serial => ({ serial, value: lifetimeCycles(snapOf(serial)) }));
  const have = rows.filter(r => r.value != null);
  return { value: have.length ? have.reduce((a, r) => a + r.value, 0) : null, rows,
    devices: have.length, missing: rows.filter(r => r.value == null).map(r => r.serial) };
}

// Battery cycles inside a date range, per device, for the Test Date filter. The MDM's own
// counter is used where the sweep has recorded it across the whole range (mdmTrack.js);
// before recording began, the same quantity is summed from the MDM's battery readings —
// every drop in battery %, ÷ 100 — from the 7-day window (all discharge) and, further
// back, the stored run curves (curves.js; discharge during runs only).
// src: { readings, rowsFor(serial) -> normalized rows, curves: { 'serial@start': curve } }
export function cyclesInRange(serials, range, src, now = Date.now()) {
  const from = range.from, to = Math.min(range.to, now);
  const bySerial = new Map();
  for (const [k, c] of Object.entries(src.curves || {})) {
    if (!c) continue;
    const at = k.lastIndexOf('@'), serial = k.slice(0, at), start = Number(k.slice(at + 1));
    if (!bySerial.has(serial)) bySerial.set(serial, []);
    bySerial.get(serial).push({ start, c });
  }
  const drops = (pts, a, b) => { // pts: [t, pct] in time order; positive drops with both ends in [a, b]
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      if (t0 >= a && t1 <= b && v1 < v0) s += v0 - v1;
    }
    return s / 100;
  };
  const rows = serials.map(serial => {
    const counter = mdmCyclesFor(src.readings, serial, from, to);
    if (counter != null) return { serial, value: counter, source: 'counter' };
    const win = (src.rowsFor?.(serial) || []).map(r => [Date.parse(r.timestamp), r.battery_pct]).filter(p => isFinite(p[0]) && typeof p[1] === 'number');
    const winStart = win.length ? win[0][0] : Infinity;
    let v = win.length ? drops(win, from, to) : 0, seen = win.length > 0;
    if (from < winStart) for (const { start, c } of bySerial.get(serial) || []) {
      const step = c.s * 60e3, end = start + (c.b.length - 1) * step;
      if (end < from || start > Math.min(to, winStart)) continue;
      v += drops(c.b.map((p, i) => [start + i * step, p]), from, Math.min(to, winStart)); seen = true;
    }
    return { serial, value: seen ? Math.round(v * 100) / 100 : null, source: 'readings' };
  });
  const have = rows.filter(r => r.value != null), counted = rows.filter(r => r.source === 'counter').length;
  return { value: have.length ? have.reduce((a, r) => a + r.value, 0) : null, rows, devices: have.length,
    missing: rows.filter(r => r.value == null).map(r => r.serial),
    source: counted === rows.length ? 'counter' : counted ? 'mixed' : 'readings' };
}
