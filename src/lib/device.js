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
