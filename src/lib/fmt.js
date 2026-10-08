/* Formatting helpers — one place, so every view agrees. */

export const DASH = '—'

const isNum = (v) => v != null && Number.isFinite(v)

export const fmtNum = (v, d = 1) => (isNum(v) ? v.toFixed(d) : DASH)
export const fmtInt = (v) => (isNum(v) ? Math.round(v).toLocaleString('en-US') : DASH)
export const fmtPct = (v, d = 0) => (isNum(v) ? `${v.toFixed(d)}%` : DASH)
export const fmtTemp = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)} °C` : DASH)
export const fmtHours = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)} h` : DASH)

/** Signed, for a rate that can go either way (drain vs charge). */
export const fmtSigned = (v, d = 2, unit = '%') =>
  (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}${unit}` : DASH)

/** A drain rate reads better as a positive magnitude with the sign in words. */
export const fmtRate = (v, d = 2) => (isNum(v) ? `${Math.abs(v).toFixed(d)}%/h` : DASH)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-06-16" -> "16 Jun 2026". Dates are plain calendar days, not instants. */
export function fmtDate(iso) {
  if (!iso) return DASH
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(iso)
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

export function fmtDateLong(iso) {
  if (!iso) return DASH
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(iso)
  const full = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${full[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

/** A week folder name ("22nd_June_26") made readable. */
export const fmtWeek = (w) => String(w || '').replace(/_/g, ' ')

/** Numeric hour ticks; charts mark the axis unit once at its end. */
// Ticks can fall on half hours on a short axis; rounding those printed "1 1 2 2".
export const fmtHourTick = (h) => { const r = Math.round(h * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1) }

/**
 * Serials are shown in full everywhere.
 *
 * Charts used to show only the last seven characters, which is unambiguous for
 * the data seen so far — every serial shares the "AT070AA" prefix and the
 * tails are unique. But a truncated id is not what you paste into a ticket or
 * search for in the MDM, and the uniqueness holds only as long as the prefix
 * does. Charts make room for the whole string instead.
 */
export const fmtSerial = (sn) => (sn ? String(sn) : DASH)

/** One natural ascending order for device IDs throughout the dashboard. */
export const compareSerial = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })

// Battery cycles — the dashboard's one meaning of "cycles": total % drained ÷ 100. A run
// that drains 78 points is 0.78 of a cycle. Counts of runs say "runs", never "cycles".
export const fmtBC = (v) => (v == null || !Number.isFinite(v) ? DASH
  : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
export const bcText = (v) => `${fmtBC(v)} cycle${v === 1 ? '' : 's'}`
export const runsText = (n) => `${fmtInt(n)} run${n === 1 ? '' : 's'}`

// The MDM's lifetime battery cycles for one device, two decimals ("—" when not reported).
export const fmtLifetime = (v) => (v == null || !Number.isFinite(v) ? DASH
  : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
