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

// Hardware build from the serial: the MDM reports none, but the serial encodes it — "BU" in
// it means a Production unit; without it, an OTG or a Validation unit (the serial cannot
// tell those two apart, so they share one label).
export const PRODUCTION_BUILD = 'Production Build', OTG_VALIDATION_BUILD = 'OTG / Validation Build';
export const buildFromSerial = (serial) => (!serial ? null : /BU/i.test(String(serial)) ? PRODUCTION_BUILD : OTG_VALIDATION_BUILD);

// The order the lab wants Today's Devices today list in (the user, 27 Oct 2026 — the bench's own
// order). A device not on the list goes after these, by serial.
export const BENCH_ORDER = ['00142', '00077', '00226', '00089', '00429', '00387', '00044', '00122', '00172', '00100', '00442', '00281',
  '00232', '00318', '00080', '00188', '00280', '00064', '00231', '00833', '00875', '00485', '00606', '00790'].map(n => `AT070AABU${n}`);
const benchRank = new Map(BENCH_ORDER.map((s, i) => [s, i]));
export const byBenchOrder = (a, b) => (benchRank.get(a) ?? 1e9) - (benchRank.get(b) ?? 1e9) || (a < b ? -1 : a > b ? 1 : 0);

// Devices the lab does not test on: left out of the device list everywhere (every cycle, chart, plan,
// Auto plan, alert, export), browser and server alike. 30 Oct 2026: 00848 and 00854 came in with the MDM's
// HW Testing group — the user: "don't include these in any cycle".
export const EXCLUDED_SERIALS = new Set(['AT070AABU00848', 'AT070AABU00854']);
// The lab's devices: the bench list itself (BENCH_ORDER), taken from the MDM's full device list whatever group
// they are in. 30 Oct 2026: the MDM's groups changed twice in a day ("Test Lab units" → "HW Testing" → gone, the T7s
// spread over Test Cycles, San Jose Office and none), each time leaving the dashboard on a 404. A new T7 on the bench
// goes into BENCH_ORDER (in its bench place).
export const LAB_SERIALS = new Set(BENCH_ORDER);
export const keepDevice = (row) => { const sn = row?.serial_number ?? row?.serial; return LAB_SERIALS.has(sn) && !EXCLUDED_SERIALS.has(sn); };
