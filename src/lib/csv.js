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
  { key: 'padState', label: 'WLC', get: (c) => c.padState ?? '' },
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

/** CSV text for the test page's Every cycle table: its rows as shown (already filtered and in
 *  table order), its columns; times local, HH:MM. */
export function cycleTableCsv(cycles, { charging = false, pad = false, wlc = null } = {}) {
  const cols = [
    ['Device', (c) => c.serial],
    ['Test', (c) => c.testType ?? ''],
    ['Date', (c) => c.date ?? ''],
    // date and time in separate short columns: a CSV cannot set column widths, and Excel shows
    // a full date + time as ##### in its default width
    ['Started', (c) => local(c.start).slice(11, 16)],
    ['Ended date', (c) => (c.inProgress ? '' : local(c.end).slice(0, 10))],
    ['Ended', (c) => (c.inProgress ? 'running' : local(c.end).slice(11, 16))],
    ['Cycle time (h)', (c) => num(c.duration, 2)],
    ['Start battery %', (c) => num(c.startBattery)],
    [charging ? 'Charged to %' : 'End battery %', (c) => num(c.endBattery)],
    [charging ? 'Charge rate %/h' : 'Drain %/h', (c) => num(c.dropPerHr == null ? null : Math.abs(c.dropPerHr), 2)],
    // wlc(c) -> { on, off } (drainHours.js padSplit): drain with / without a load on the pad
    ...(wlc ? [['Drain with WLC %/h', (c) => num(wlc(c)?.on?.rate, 2)], ['Drain without WLC %/h', (c) => num(wlc(c)?.off?.rate, 2)]] : []),
    ['Peak temp °C', (c) => num(c.maxTemp, 1)],
    ...CYCLE_COLUMNS.filter((c) => c.key === 'batteryCycles' || c.key === 'cyclesSource')
      .map((col) => [col.label, (c) => (CYCLE_COLUMNS.find((x) => x.key === 'batteryCycles').get(c) === '' ? '' : col.get(c))]),
    ['Firmware', (c) => c.firmware ?? ''],
    ...(pad ? [['WLC', (c) => c.padState ?? '']] : []),
  ]
  return [csvLine(cols.map((c) => c[0])), ...cycles.map((c) => csvLine(cols.map((col) => col[1](c))))].join('\r\n') + '\r\n'
}

/** Every cycle hour by hour: one row per device, cycle and hour of the cycle (the last one may be
 *  shorter), sorted by device. Battery from the cycle's curve (`series`, hours from its start,
 *  linear between points); temperature from `tempSeries`; minutes with a load on the wireless pad
 *  from `slotsOf(serial)` (hours.json 15-min slots: [start, drop×10, min on battery, min with a
 *  load, temp×10]), blank where there are none (a charge, or before the sweep kept them). */
export function cycleHoursCsv(cycles, { charging = false, slotsOf = () => null } = {}) {
  const at = (s, t) => {
    if (!s.length || t < s[0].t - 0.1 || t > s[s.length - 1].t + 0.1) return null
    let i = s.findIndex((p) => p.t >= t); if (i < 0) return s[s.length - 1].v; if (i === 0) return s[0].v
    const a = s[i - 1], b = s[i]; return a.v + (b.v - a.v) * (t - a.t) / ((b.t - a.t) || 1)
  }
  const head = ['Device', 'Test', 'Date', 'Cycle started', 'Hour', 'From', 'To', 'Battery at start %', 'Battery at end %',
    charging ? 'Gained %' : 'Drained %', charging ? 'Charge rate %/h' : 'Drain %/h', 'Load on wireless pad (min)', 'Avg battery temp °C', 'Peak battery temp °C']
  const r1 = (v) => (v == null ? '' : +v.toFixed(1)) // 88 and 87.5, not 88.0
  const rows = []
  for (const c of [...cycles].sort((a, b) => String(a.serial).localeCompare(String(b.serial)) || a.start - b.start)) {
    const s = (c.series || []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
    const dur = c.duration ?? (c.end - c.start) / 3600e3
    if (!s.length || !(dur > 0)) continue
    const slots = slotsOf(c.serial)
    for (let h = 0; h < dur - 0.01; h++) {
      const to = Math.min(h + 1, dur), b0 = at(s, h), b1 = at(s, to), from = c.start + h * 3600e3, until = c.start + to * 3600e3
      const temps = (c.tempSeries || []).filter((p) => p.t >= h && p.t <= to).map((p) => p.v)
      let pad = null
      if (slots?.length) for (const x of slots) { const mid = x[0] + 450e3; if (mid >= from && mid < until) pad = (pad || 0) + x[3] }
      const moved = b0 == null || b1 == null ? null : charging ? b1 - b0 : b0 - b1
      rows.push([c.serial, c.testType ?? '', c.date ?? '', local(c.start).slice(11, 16), h + 1, local(from).slice(11, 16),
        c.inProgress && to === dur ? 'running' : local(until).slice(11, 16), r1(b0), r1(b1), r1(moved),
        num(moved == null ? null : moved / (to - h), 2), num(pad, 0),
        r1(temps.length ? temps.reduce((a, x) => a + x, 0) / temps.length : null), r1(temps.length ? Math.max(...temps) : null)])
    }
  }
  return [csvLine(head), ...rows.map(csvLine)].join('\r\n') + '\r\n'
}

/** Save CSV text as a file (browser only); the BOM makes Excel read it as UTF-8. */
export function downloadCsv(text, name) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Rough row count for a readings export, to warn before a huge one. */
export const estimateRows = (devices, fromMs, toMs, intervalSec) => Math.max(0, Math.round(devices * (toMs - fromMs) / (intervalSec * 1000)))

/** A readable name for an MDM field: "storage_free_gb" -> "Storage free gb". */
export const fieldLabel = (k) => { const t = String(k).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1) }
