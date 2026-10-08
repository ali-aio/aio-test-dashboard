// The Test Date filter as a time range: quick presets (last hour … last 30 days) or a span
// of calendar days. A run is in range if any part of it falls inside — "Last hour" means
// runs that were running in the last hour, not only runs that started in it. Local days
// throughout. Plain JS, no DOM.
const H = 3600e3, DAY = 24 * H;
const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export const PRESETS = [
  { id: '1h', label: 'Last hour' }, { id: '6h', label: 'Last 6h' }, { id: '24h', label: 'Last 24h' },
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

/** { from, to, preset } for a preset id, relative to `now`. Presets stay relative: the
 *  range is recomputed on each use, so "Last 24h" keeps moving with the clock. */
export function presetRange(id, now = Date.now()) {
  switch (id) {
    case '1h': return { from: now - H, to: now, preset: id };
    case '6h': return { from: now - 6 * H, to: now, preset: id };
    case '24h': return { from: now - DAY, to: now, preset: id };
    case 'today': return { from: sod(now), to: now, preset: id };
    case 'yesterday': return { from: sod(now) - DAY, to: sod(now) - 1, preset: id };
    case '7d': return { from: sod(now) - 6 * DAY, to: now, preset: id };
    case '30d': return { from: sod(now) - 29 * DAY, to: now, preset: id };
    default: return null;
  }
}
/** Whole local days from a to b (either order), inclusive. */
export function dayRange(a, b) {
  const [x, y] = a <= b ? [a, b] : [b, a];
  return { from: sod(x), to: sod(y) + DAY - 1, preset: null };
}
/** The live bounds of a stored range (a preset is re-evaluated against the clock). */
export const resolve = (r, now = Date.now()) => (!r ? null : r.preset ? presetRange(r.preset, now) : r);
export const overlaps = (c, r) => c.start <= r.to && (c.end ?? c.start) >= r.from;

const fmtDay = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export function rangeLabel(r) {
  if (!r) return 'All dates';
  if (r.preset) return PRESETS.find(p => p.id === r.preset)?.label || 'Custom range';
  return `${fmtDay(r.from)} to ${fmtDay(r.to)}`;
}
/** A single calendar day as a range — what a "pick this day" click in a breakdown means. */
export const isoDayRange = iso => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d).getTime(); return dayRange(t, t); };
