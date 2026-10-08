// Per-run battery and temperature curves, kept by the server so every run — not only
// the last 7 days — can be drawn.
//
// The MDM keeps every reading, but fetching months of /history in every browser on every
// load is not an option, so the backend fetches each run's readings once and stores a
// compact curve per run in data/curves.json. Readings arrive at irregular check-in times;
// each run is re-sampled onto an even grid (every STEP minutes from its start) so whole
// hours line up across runs and an hourly average rests on every run that reached it.
//
// A run whose readings do not reach its start (or its end) gets no curve rather than a
// partial one: a line that begins mid-run, plotted from 0 h, says something false.
// Plain JS, no DOM: written by server/curves.mjs, read by src/lib/adapt.js.
export const STEP = 10;             // minutes between curve points
const EDGE = 20 * 60e3;             // readings must come within 20 min of the run's ends
const TEMP_GAP = 45 * 60e3;         // no temperature across a reporting gap longer than this

export const curveKey = (serial, start) => `${serial}@${start}`;

const temp = r => { const t = r.extra?.battery_temp_c; return typeof t === 'number' && t > 0 ? t : null; };

/** rows: normalized history (timestamp, battery_pct, build_id, extra). Returns null when the
 *  readings do not cover the run; otherwise { s, b: [battery], c: [temp|null], fw, w }. */
export function resampleRun(rows, start, end) {
  const seg = rows.map(r => ({ t: Date.parse(r.timestamp), r }))
    .filter(x => x.t >= start - EDGE && x.t <= end + EDGE).sort((a, b) => a.t - b.t);
  if (seg.length < 2 || seg[0].t > start + EDGE || seg[seg.length - 1].t < end - EDGE) return null;
  const b = [], c = [], fw = new Map(); let w = 0;
  for (const x of seg) {
    if (x.t < start || x.t > end) continue;
    if (x.r.build_id) fw.set(x.r.build_id, (fw.get(x.r.build_id) || 0) + 1);
    if (x.r.extra?.wlc_status || /wireless|wlc|qi/i.test(x.r.extra?.charger_type || '')) w++;
  }
  let i = 0;
  for (let t = start; t <= end; t += STEP * 60e3) {
    while (i < seg.length - 2 && seg[i + 1].t < t) i++;
    const a = seg[i], z = seg[i + 1] || seg[i];
    const f = z.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (z.t - a.t)));
    b.push(Math.round((a.r.battery_pct + (z.r.battery_pct - a.r.battery_pct) * f) * 10) / 10);
    const ta = temp(a.r), tz = temp(z.r);
    c.push(ta == null || tz == null || z.t - a.t > TEMP_GAP ? (f < 0.5 ? ta : tz) ?? null
      : Math.round((ta + (tz - ta) * f) * 10) / 10);
  }
  const inRun = seg.filter(x => x.t >= start && x.t <= end).length;
  return { s: STEP, b, c, fw: [...fw.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] || null, w: inRun && w > inRun / 2 ? 1 : 0 };
}

/** A stored curve as the T7 series the charts take: [{ t: hours from start, v }]. */
export function curveSeries(curve) {
  if (!curve) return null;
  const h = curve.s / 60;
  return {
    series: curve.b.map((v, i) => ({ t: Math.round(i * h * 1000) / 1000, v })),
    tempSeries: curve.c.map((v, i) => (v == null ? null : { t: Math.round(i * h * 1000) / 1000, v })).filter(Boolean),
  };
}
