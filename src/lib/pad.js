// A load on the T7's wireless pad, from a reading's `wlc_status`: 1 / 2 = something on the pad (2 =
// being charged). 0 = nothing, and NEGATIVE values (-1, seen 19 Oct 2026 on 00485 while idle) are
// the pad reporting an error / not known — not a load. Every place that reads wlc_status uses this.
//   true / false, or null when the reading has no wlc_status at all
export const padLoad = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v > 0)

/** The same over time-ordered points with `pad` set from padLoad: a load on one reading alone,
 *  between two readings without one, is a blip (someone brushing the pad, 19 Oct 2026: 00606 showed
 *  6 min of "load" from two lone readings while idle) and is cleared. Changes the points in place. */
export function dropLoneLoads(pts) {
  for (let i = 1; i < pts.length - 1; i++)
    if (pts[i].pad && pts[i - 1].pad === false && pts[i + 1].pad === false) pts[i].pad = false
  return pts
}
