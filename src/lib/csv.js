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
  // charger type, wireless charging and charger voltage are only in a device's *latest*
  // check-in (/testdata/devices), never in its history rows, so they are not offered here;
  // nor is last_seen_at, which history repeats on every row as the device's current value.
  { key: 'wlc_status', label: 'Wireless pad', get: (r) => { const v = extraOf(r).wlc_status; return v == null || v === '' ? '' : +v === 0 ? 'off' : +v === 1 ? 'on' : `on (status ${v})` } },
  { key: 'build_id', label: 'Firmware (build)', get: (r) => r.build_id ?? '' },
  { key: 'wifi_rssi', label: 'Wi-Fi signal dBm', get: (r) => num(extraOf(r).wifi_rssi) },
  { key: 'wifi', label: 'Wi-Fi network', get: (r) => String(extraOf(r).wifi ?? '').replace(/^"(.*)"$/, '$1') },
  { key: 'ram_used_mb', label: 'RAM used MB', get: (r) => num(extraOf(r).ram_usage_mb?.used) },
  { key: 'ram_total_mb', label: 'RAM total MB', get: (r) => num(extraOf(r).ram_usage_mb?.total) },
  { key: 'storage_free_gb', label: 'Storage free GB', get: (r) => num(extraOf(r).storage_free_gb) },
  { key: 'ip_address', label: 'IP address', get: (r) => extraOf(r).ip_address ?? '' },
  // which cycle each reading belongs to (from the dashboard's own cycles; blank between
  // cycles, e.g. while charging). Cycle # counts that device's cycles from its first.
  { key: 'cycle_no', label: 'Cycle #', cycle: true, get: (r, cy) => (cy ? cy.no : '') },
  { key: 'cycle_test', label: 'Cycle test', cycle: true, get: (r, cy) => (cy ? cy.c.testType ?? '' : '') },
  { key: 'cycle_start', label: 'Cycle start (local)', cycle: true, get: (r, cy) => (cy ? local(cy.c.start) : '') },
  { key: 'cycle_hours', label: 'Hours into cycle', cycle: true, get: (r, cy) => (cy ? num((Date.parse(r.sample_at || r.timestamp) - cy.c.start) / 3600e3, 2) : '') },
]
// keys the named columns already cover, so "every other MDM field" doesn't repeat them
const COVERED = new Set(['battery_temp_c', 'charging', 'wlc_status', 'wifi_rssi', 'wifi', 'ram_usage_mb', 'storage_free_gb', 'ip_address'])

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

/** Per device, its cycles oldest first, numbered from 1, for looking a reading up by time. */
export function cycleIndex(cycles) {
  const by = new Map()
  for (const c of cycles) { if (!by.has(c.serial)) by.set(c.serial, []); by.get(c.serial).push(c) }
  for (const [k, list] of by) by.set(k, list.sort((a, b) => a.start - b.start).map((c, i) => ({ c, no: i + 1 })))
  return by
}
const cycleAtTime = (index, serial, t) => {
  const list = index?.get(serial); if (!list || !Number.isFinite(t)) return null
  for (const x of list) if (t >= x.c.start && t <= (x.c.end ?? x.c.start)) return x
  return null
}

/** CSV text for reading rows: chosen columns, then the chosen other MDM fields (extra.*).
 *  `cycles` (all of them, any devices) lets the Cycle # / test / start / hours columns fill. */
export function readingsCsv(rows, chosen, extraWanted = [], cycles = []) {
  const cols = READING_COLUMNS.filter((c) => chosen.includes(c.key))
  const index = cols.some((c) => c.cycle) ? cycleIndex(cycles) : null
  // extraWanted: the other MDM fields to add, by name (true = every one found in the rows)
  const extra = extraWanted === true ? extraKeys(rows) : Array.isArray(extraWanted) ? extraWanted : []
  const flat = (v) => (v != null && typeof v === 'object' ? JSON.stringify(v) : v)
  const lines = [csvLine([...cols.map((c) => c.label), ...extra.map((k) => `extra.${k}`)])]
  for (const r of rows) {
    if (r.empty) continue
    const e = extraOf(r), cy = index ? cycleAtTime(index, r.serial_number, Date.parse(r.sample_at || r.timestamp)) : null
    lines.push(csvLine([...cols.map((c) => c.get(r, cy)), ...extra.map((k) => flat(e[k]))]))
  }
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

/** A readable name for an MDM field: "storage_free_gb" -> "Storage free gb". */
export const fieldLabel = (k) => { const t = String(k).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1) }
