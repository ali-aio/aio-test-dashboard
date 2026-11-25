// The T7's wireless pad, from a reading's `wlc_status` (the user, 25 Nov 2026: "you are confusing load placed with
// pad misplaced"): 1 = a load placed and being charged, 2 = a load MISPLACED (on the pad but not aligned, not
// charged), 0 = nothing on the pad, -1 = not known / WLC switched off. Only 1 is a load. Until 25 Nov 2026 every
// value > 0 counted as a load, so a misplaced load read as "load placed". Every place that reads wlc_status uses these.
//   true / false, or null when the reading has no wlc_status at all
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v)
export const padLoad = (v) => { const n = num(v); return n == null ? null : n === 1 }
/** true when the pad reports a load misplaced (wlc_status 2); null without a wlc_status */
export const padMisplaced = (v) => { const n = num(v); return n == null ? null : n === 2 }
/** A short word for a wlc_status, for lists and the CSV. */
export const padText = (v) => { const n = num(v); return n == null ? '' : n === 1 ? 'load placed' : n === 2 ? 'load misplaced' : n === 0 ? 'no load' : n < 0 ? 'not known / WLC off' : `status ${n}` }

/** The same over time-ordered points with `pad` set from padLoad: a load on one reading alone,
 *  between two readings without one, is a blip (someone brushing the pad, 19 Oct 2026: 00606 showed
 *  6 min of "load" from two lone readings while idle) and is cleared. Changes the points in place. */
export function dropLoneLoads(pts) {
  for (let i = 1; i < pts.length - 1; i++)
    if (pts[i].pad && pts[i - 1].pad === false && pts[i + 1].pad === false) pts[i].pad = false
  return pts
}
