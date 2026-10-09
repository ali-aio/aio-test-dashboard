// CSV export: column definitions for the two kinds of export and the CSV text itself.
// Plain JS, no DOM (the dialog in components/ExportDialog.jsx does the fetching and the
// download), so it is testable in Node.
//
//   readings — the MDM's own history rows for each device (like the MDM's export):
//              /testdata/devices/{serial}/history at the chosen interval. `empty` gap rows
//              are dropped (their battery_pct is a meaningless 0 — see CLAUDE.md).
//   cycles   — one row per detected cycle, from what the dashboard already holds.

const extraOf = (r) => {
  const e = r.extra
  if (!e) return {}
  if (typeof e === 'string') { try { return JSON.parse(e) || {} } catch (err) { return {} } }
  return e
}
const iso = (t) => (t == null || !Number.isFinite(t) ? '' : new Date(t).toISOString())
const local = (t) => {
  if (t == null || !Number.isFinite(t)) return ''
  const d = new Date(t), p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const num = (v, d) => (v == null || !Number.isFinite(+v) ? '' : d == null ? +v : (+v).toFixed(d))

export const READING_COLUMNS = [
  { key: 'serial', label: 'Serial', get: (r) => r.serial_number },
  { key: 'time_local', label: 'Time (local)', get: (r) => local(Date.parse(r.sample_at || r.timestamp)) },
  { key: 'time_utc', label: 'Time (UTC, ISO)', get: (r) => r.sample_at || r.timestamp || '' },
  { key: 'battery_pct', label: 'Battery %', get: (r) => num(r.battery_pct) },
  { key: 'battery_temp_c', label: 'Battery temp °C', get: (r) => num(extraOf(r).battery_temp_c, 1) },
  { key: 'charging', label: 'Charging', get: (r) => { const v = extraOf(r).charging; return v == null ? '' : v ? 'yes' : 'no' } },
  { key: 'charger_type', label: 'Charger type', get: (r) => extraOf(r).charger_type ?? '' },
  { key: 'wlc_status', label: 'Wireless pad status', get: (r) => extraOf(r).wlc_status ?? '' },
  { key: 'wlc_charging', label: 'Wireless charging', get: (r) => { const v = extraOf(r).wlc_charging; return v == null ? '' : v ? 'yes' : 'no' } },
  { key: 'charger_voltage_mv', label: 'Charger voltage mV', get: (r) => num(extraOf(r).charger_voltage_mv) },
  { key: 'build_id', label: 'Firmware (build)', get: (r) => r.build_id ?? '' },
  { key: 'last_seen_at', label: 'Last seen (UTC)', get: (r) => r.last_seen_at ?? '' },
]
// keys the named columns already cover, so "every other MDM field" doesn't repeat them
const COVERED = new Set(['battery_temp_c', 'charging', 'charger_type', 'wlc_status', 'wlc_charging', 'charger_voltage_mv'])

export const CYCLE_COLUMNS = [
  { key: 'serial', label: 'Serial', get: (c) => c.serial },
  { key: 'testType', label: 'Test', get: (c) => c.testType ?? '' },
  { key: 'date', label: 'Date', get: (c) => c.date ?? '' },
  { key: 'start', label: 'Start (local)', get: (c) => local(c.start) },
  { key: 'end', label: 'End (local)', get: (c) => local(c.end) },
  { key: 'start_utc', label: 'Start (UTC, ISO)', get: (c) => iso(c.start) },
  { key: 'duration', label: 'Cycle time (h)', get: (c) => num(c.duration, 2) },
  { key: 'startBattery', label: 'Start battery %', get: (c) => num(c.startBattery) },
  { key: 'endBattery', label: 'End battery %', get: (c) => num(c.endBattery) },
  { key: 'dropPerHr', label: 'Drain %/h', get: (c) => num(c.dropPerHr == null ? null : Math.abs(c.dropPerHr), 2) },
  { key: 'maxTemp', label: 'Peak temp °C', get: (c) => num(c.maxTemp, 1) },
  { key: 'batteryCycles', label: 'Battery cycles', get: (c) => (c.mdmCycles != null ? num(c.mdmCycles, 2)
    : c.startBattery != null && c.endBattery != null && c.startBattery > c.endBattery ? num((c.startBattery - c.endBattery) / 100, 2) : '') },
  { key: 'cyclesSource', label: 'Battery cycles source', get: (c) => (c.mdmCycles != null ? 'MDM counter' : 'battery drop ÷ 100') },
  { key: 'firmware', label: 'Firmware', get: (c) => c.firmware ?? '' },
  { key: 'padState', label: 'Wireless pad', get: (c) => c.padState ?? '' },
]

/** One CSV field: quoted when it holds a comma, quote or line break; formula-looking text
 *  (=, +, -, @) is prefixed so a spreadsheet shows it rather than runs it. */
export function csvField(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const csvLine = (cells) => cells.map(csvField).join(',')

/** The extra MDM fields found in a set of reading rows, minus the ones with their own column. */
export function extraKeys(rows) {
  const keys = new Set()
  for (const r of rows) for (const k of Object.keys(extraOf(r))) if (!COVERED.has(k)) keys.add(k)
  return [...keys].sort()
}

/** CSV text for reading rows: chosen columns, then (optionally) every other extra field. */
export function readingsCsv(rows, chosen, withExtra = false) {
  const cols = READING_COLUMNS.filter((c) => chosen.includes(c.key))
  const extra = withExtra ? extraKeys(rows) : []
  const flat = (v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : v)
  const lines = [csvLine([...cols.map((c) => c.label), ...extra.map((k) => `extra.${k}`)])]
  for (const r of rows) { if (r.empty) continue; const e = extraOf(r); lines.push(csvLine([...cols.map((c) => c.get(r)), ...extra.map((k) => flat(e[k]))])) }
  return lines.join('\r\n') + '\r\n'
}

/** CSV text for cycles: chosen columns, oldest first. */
export function cyclesCsv(cycles, chosen) {
  const cols = CYCLE_COLUMNS.filter((c) => chosen.includes(c.key))
  const lines = [csvLine(cols.map((c) => c.label))]
  for (const c of [...cycles].sort((a, b) => a.serial.localeCompare(b.serial) || a.start - b.start)) lines.push(csvLine(cols.map((col) => col.get(c))))
  return lines.join('\r\n') + '\r\n'
}

/** Rough row count for a readings export, to warn before a huge one. */
export const estimateRows = (devices, fromMs, toMs, intervalSec) => Math.max(0, Math.round(devices * (toMs - fromMs) / (intervalSec * 1000)))
