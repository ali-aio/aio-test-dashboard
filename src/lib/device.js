// Device state read off the latest /testdata/devices snapshot. Plain JS, no React.
import { MIN } from './format.js';
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
