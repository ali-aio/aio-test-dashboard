// Cycle analysis — ported from T7-Dashboard's src/lib/cycles.js, the half that works
// ON cycles (stats, filters, curves). Its other half parses CSV and MDM exports; this
// repo reads the MDM live instead, so src/lib/adapt.js builds the same cycle objects
// straight from our own detector's output. Keep the two in step: the views and the chart
// kit below are T7's, and they expect T7's cycle shape.
//
// Plain JS, no React — same rule as the rest of src/lib.

/* Spreading into Math.min/Math.max blows the call stack somewhere north of
   ~100k arguments, and a month of fleet telemetry is 660k rows. Always reduce. */

import { compareSerial } from './fmt.js';
import { TEST_TYPE_NAMES, FIELD_DISCHARGE, FIELD_CHARGING, LOAD_TEST_TYPES } from './testtypes.js';

const HOUR_SNAP = 0.05;   // how close to an integer hour a row must sit to count
const isNum = (v) => v != null && Number.isFinite(v);
export { HOUR_SNAP, isNum, perHourRate };

export function maxOf(values, fallback = null) {
  let best = -Infinity
  for (const v of values) if (isNum(v) && v > best) best = v
  return best === -Infinity ? fallback : best
}


export function minOf(values, fallback = null) {
  let best = Infinity
  for (const v of values) if (isNum(v) && v < best) best = v
  return best === Infinity ? fallback : best
}


export function mean(values) {
  const nums = values.filter(isNum)
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}


export function median(values) {
  const nums = values.filter(isNum).sort((a, b) => a - b)
  if (!nums.length) return null
  const mid = nums.length >> 1
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

const round = (v, n = 2) => (isNum(v) ? Math.round(v * 10 ** n) / 10 ** n : null)

/** Mean temperature in each third of a run, using every source reading. */
function temperaturePhases(from, to, duration, timeAt, tempAt) {
  const sums = [0, 0, 0]
  const counts = [0, 0, 0]
  if (!(duration > 0)) return [null, null, null]
  for (let i = from; i <= to; i++) {
    const t = timeAt(i)
    const temp = tempAt(i)
    if (!isNum(t) || !isNum(temp) || t < 0 || t > duration) continue
    const phase = Math.min(2, Math.floor((t / duration) * 3))
    sums[phase] += temp
    counts[phase]++
  }
  return sums.map((sum, i) => counts[i] ? round(sum / counts[i], 2) : null)
}

const firstOf = (rows, key) => {
  for (const r of rows) {
    const v = r[key]
    if (v != null && String(v).trim() !== '') return v
  }
  return null
}

/* ------------------------------------------------------------- run splitting */

/** Split rows (in file order) wherever Time (Hrs) goes backwards. */
function splitRuns(rows) {
  const runs = []
  let current = []
  let prev = null
  for (const r of rows) {
    const t = r.time
    if (!isNum(t)) { current.push(r); continue }
    if (prev != null && t <= prev - 0.001 && prev > 0) {
      if (current.length) runs.push(current)
      current = [r]
    } else current.push(r)
    prev = t
  }
  if (current.length) runs.push(current)
  return runs
}

/**
 * {integer hour -> value}, taking for each hour the row closest to it.
 * The per-hour rates are computed across these true integer boundaries, so a
 * stray off-grid reading cannot masquerade as an hour's worth of drain.
 */
function hourMap(rows, key) {
  const best = new Map()
  for (const r of rows) {
    const t = r.time
    const v = r[key]
    if (!isNum(t) || !isNum(v)) continue
    const h = Math.round(t)
    const dist = Math.abs(t - h)
    if (dist > HOUR_SNAP) continue
    const prior = best.get(h)
    if (!prior || dist < prior.dist) best.set(h, { dist, v })
  }
  const out = new Map()
  for (const [h, { v }] of best) out.set(h, v)
  return out
}

/** Mean change per hour across consecutive integer boundaries. */
function perHourRate(map, mode) {
  const hours = [...map.keys()].sort((a, b) => a - b)
  const diffs = []
  for (let i = 0; i < hours.length - 1; i++) {
    const h0 = hours[i]
    const h1 = hours[i + 1]
    if (h1 - h0 !== 1) continue
    const v0 = map.get(h0)
    const v1 = map.get(h1)
    diffs.push(mode === 'drop' ? v0 - v1 : v1 - v0)
  }
  return diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null
}

/** Restaurant Case logs the load mode on the reading that starts each hour. */
function restaurantDrainRates(rows) {
  const closest = new Map()
  for (const row of rows) {
    if (!isNum(row.time) || !isNum(row.battery)) continue
    const h = Math.round(row.time)
    const distance = Math.abs(row.time - h)
    if (distance > HOUR_SNAP) continue
    const prior = closest.get(h)
    if (!prior || distance < prior.distance) closest.set(h, { row, distance })
  }

  const withWireless = []
  const withoutWireless = []
  const windows = []
  for (const [h, { row }] of closest) {
    const next = closest.get(h + 1)?.row
    if (!next) continue
    const load = row.loadType
    const wireless = !!(load && load !== 'No Load')
    const drop = row.battery - next.battery
    const target = wireless ? withWireless : withoutWireless
    target.push(drop)
    windows.push({ h, drop, wireless })
  }
  return {
    wirelessDrainPerHr: round(mean(withWireless), 2),
    withoutWirelessDrainPerHr: round(mean(withoutWireless), 2),
    wirelessHours: withWireless.length,
    withoutWirelessHours: withoutWireless.length,
    windows,
  }
}

/* ----------------------------------------------------------- cycle building */

/* ------------------------------------------------------------------ filtering */

/**
 * The resting state of every filter EXCEPT the device list, which has no
 * sensible default without knowing the data: `serials` is explicit, so `[]`
 * means "no devices" and would show nothing. Build real filters with
 * `filtersFor(serials)` and keep this for spreading.
 */
export const EMPTY_FILTERS = {
  testType: '__all__', build: '', serials: [], firmware: '', android: '',
  loadType: '', charger: '', date: '', week: '',
}

/** Everything unfiltered: all filters at rest, every device ticked. */

/** Everything unfiltered: all filters at rest, every device ticked. */
export const filtersFor = (serials) => ({ ...EMPTY_FILTERS, serials: [...serials] })

/**
 * Keep an explicit device selection in step as files come and go.
 *
 *   • first load (nothing seen before) -> every device ticked
 *   • the selection already covered everything -> new devices join it
 *   • a deliberate subset -> left alone, minus any device that disappeared
 *   • a deliberate empty selection -> stays empty, so Clear is not undone
 *
 * The middle two are the ones that matter: importing a second file should not
 * silently widen a "just these three devices" selection, and should not leave
 * a new device invisible when the reader had everything ticked.
 */

/**
 * Keep an explicit device selection in step as files come and go.
 *
 *   • first load (nothing seen before) -> every device ticked
 *   • the selection already covered everything -> new devices join it
 *   • a deliberate subset -> left alone, minus any device that disappeared
 *   • a deliberate empty selection -> stays empty, so Clear is not undone
 *
 * The middle two are the ones that matter: importing a second file should not
 * silently widen a "just these three devices" selection, and should not leave
 * a new device invisible when the reader had everything ticked.
 */
export function reconcileSerials(selected, available, previouslyAvailable) {
  if (!previouslyAvailable.length) return [...available]
  const coveredAll = selected.length >= previouslyAvailable.length
  if (coveredAll) return [...available]
  const stillHere = new Set(available)
  return selected.filter((s) => stillHere.has(s))
}


export function filterCycles(cycles, f) {
  return cycles.filter((c) => {
    if (f.testType !== '__all__' && c.testType !== f.testType) return false
    if (f.build && c.build !== f.build) return false
    if (f.firmware && c.firmware !== f.firmware) return false
    if (f.android && c.android !== f.android) return false
    if (f.week && c.week !== f.week) return false
    if (f.date && c.date !== f.date) return false
    // Explicit: the list IS the devices shown. An empty list shows nothing,
    // and the app prompts for a pick rather than quietly showing everything.
    if (!f.serials.includes(c.serial)) return false
    /* Context filters only bite on the test types where they mean something.
       There is no pad filter: the hardware ships one pad now, so filtering by
       which pad was used has nothing to separate. Both pad fields are still
       carried on every cycle, shown in the Cycles table and written to the CSV
       export, and pad state is still available as a grouping. */
    if (f.loadType && LOAD_TEST_TYPES.has(f.testType) && c.loadType !== f.loadType) return false
    if (f.charger && f.testType === 'Charging Cycle' && c.charger !== f.charger) return false
    return true
  })
}

/** Compare the firmware version numbers in full labels, newest first. */

/** Compare the firmware version numbers in full labels, newest first. */
export function compareFirmwareNewest(a, b) {
  const version = (value) => {
    const label = String(value)
    if (label === 'Unknown') return null
    const firmwareAt = label.toLowerCase().indexOf('firmware')
    const afterFirmware = firmwareAt >= 0 ? label.slice(firmwareAt + 'firmware'.length) : ''
    const match = afterFirmware.match(/\d+(?:\.\d+)*/)
      ?? label.match(/(?:^|[\s_-])v(?:ersion)?[-\s]?(\d+(?:\.\d+)*)/i)
      ?? label.match(/(?:^|[^\d])(\d+(?:\.\d+)+)(?!\d)/)
      ?? label.match(/^\s*(\d+)\b/)
    return match ? (match[1] ?? match[0]).split('.').map(Number) : null
  }
  const av = version(a)
  const bv = version(b)
  if (av && !bv) return -1
  if (!av && bv) return 1
  if (av && bv) {
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const difference = (bv[i] ?? 0) - (av[i] ?? 0)
      if (difference) return difference
    }
  }
  if (a === 'Unknown') return b === 'Unknown' ? 0 : 1
  if (b === 'Unknown') return -1
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}


export function distinct(cycles, key) {
  const values = [...new Set(cycles.map((c) => c[key]).filter((v) => v != null && v !== ''))]
  return values.sort(key === 'firmware' ? compareFirmwareNewest : key === 'serial' ? compareSerial : undefined)
}


/* ---------------------------------------------------------- cascading options

   Each control offers only what is still reachable given the controls before
   it: pick OTG and the firmware list shows only firmwares that shipped on OTG;
   pick V-1.31 on top and the device list shows only devices that ran that
   combination, and the calendar only lights the days they ran on.

   The order below is the order of the filter bar, and it is the whole
   specification — a control narrows everything downstream of it and nothing
   upstream, so its own list never collapses to the single value you just
   chose. */

const CASCADE = ['testType', 'build', 'firmware', 'android', 'serials', 'loadType', 'charger', 'week', 'date']

function applyOne(cycles, key, filters, allSerials) {
  const v = filters[key]
  switch (key) {
    case 'testType':
      return v === '__all__' ? cycles : cycles.filter((c) => c.testType === v)
    case 'serials': {
      // "every device" is not a restriction, so it narrows nothing downstream.
      if (!v || v.length === allSerials.length) return cycles
      const set = new Set(v)
      return cycles.filter((c) => set.has(c.serial))
    }
    case 'loadType':
      return v ? cycles.filter((c) => c.loadType === v) : cycles
    case 'charger':
      return v ? cycles.filter((c) => c.charger === v) : cycles
    default:
      return v ? cycles.filter((c) => c[key] === v) : cycles
  }
}

/**
 * The option list each control should offer, plus per-date cycle counts for
 * the calendar. Every list is drawn from the cycles surviving the filters
 * *above* it in the bar.
 */

/**
 * The option list each control should offer, plus per-date cycle counts for
 * the calendar. Every list is drawn from the cycles surviving the filters
 * *above* it in the bar.
 */
export function cascadeOptions(cycles, filters, allSerials) {
  const field = {
    testType: 'testType', build: 'build', firmware: 'firmware', android: 'android',
    serials: 'serial', loadType: 'loadType', charger: 'charger', week: 'week', date: 'date',
  }

  const options = {}
  const upstream = {}
  let acc = cycles

  for (const key of CASCADE) {
    upstream[key] = acc
    options[key] = distinct(acc, field[key])
    acc = applyOne(acc, key, filters, allSerials)
  }

  const dateCounts = new Map()
  for (const c of upstream.date) {
    // runs that day — the bar length; the label is the MDM figure when covered (FilterBar)
    if (c.date) dateCounts.set(c.date, (dateCounts.get(c.date) ?? 0) + 1)
  }

  return { options, dateCounts, upstream }
}

/**
 * Clear any selection the cascade has made unreachable.
 *
 * Narrowing an upstream control can strand a downstream one — pick a firmware,
 * then a build that never ran it, and the firmware now matches nothing. Rather
 * than silently showing an empty dashboard, the stranded value is dropped and
 * the reader keeps the change they just made.
 */

/**
 * Clear any selection the cascade has made unreachable.
 *
 * Narrowing an upstream control can strand a downstream one — pick a firmware,
 * then a build that never ran it, and the firmware now matches nothing. Rather
 * than silently showing an empty dashboard, the stranded value is dropped and
 * the reader keeps the change they just made.
 */
export function pruneFilters(cycles, filters, allSerials) {
  let next = filters
  // Two passes: dropping one value can widen what is reachable below it.
  for (let i = 0; i < 2; i++) {
    const { options } = cascadeOptions(cycles, next, allSerials)
    const patch = {}
    for (const key of CASCADE) {
      if (key === 'serials') {
        const kept = next.serials.filter((sn) => allSerials.includes(sn))

        /* An upstream change can strand the device selection: tick one device,
           then pick a build it never ran, and nothing is reachable — an empty
           dashboard caused by a filter two controls away. The device filter
           follows the cascade instead, taking in whatever is now reachable.

           An EMPTY selection is left alone: that one is deliberate (Clear),
           and the dashboard says so with its own prompt. */
        const reachable = options.serials
        const stranded = kept.length > 0 && reachable.length > 0
          && !kept.some((sn) => reachable.includes(sn))

        if (stranded) patch.serials = [...new Set([...kept, ...reachable])]
        else if (kept.length !== next.serials.length) patch.serials = kept
        continue
      }
      const v = next[key]
      if (key === 'testType') {
        if (v !== '__all__' && !options.testType.includes(v)) patch.testType = '__all__'
        continue
      }
      if (v && !options[key].includes(v)) patch[key] = ''
    }
    if (!Object.keys(patch).length) break
    next = { ...next, ...patch }
  }
  return next
}

/* --------------------------------------------------------------------- KPIs */

/* --------------------------------------------------------------------- KPIs */

export function kpis(cycles) {
  return {
    totalCycles: cycles.length,
    avgDuration: mean(cycles.map((c) => c.duration)),
    avgStartBattery: mean(cycles.map((c) => c.startBattery)),
    avgEndBattery: mean(cycles.map((c) => c.endBattery)),
    avgPeakTemp: mean(cycles.map((c) => c.maxTemp)),
    avgDropPerHr: mean(cycles.map((c) => c.dropPerHr)),
    avgGainPerHr: mean(cycles.map((c) => c.loadGainPerHr)),
    serials: new Set(cycles.map((c) => c.serial)).size,
    dates: new Set(cycles.map((c) => c.date).filter(Boolean)).size,
    builds: new Set(cycles.map((c) => c.build)).size,
    firmwares: new Set(cycles.map((c) => c.firmware).filter((f) => f !== 'Unknown')).size,
    testTypes: new Set(cycles.map((c) => c.testType)).size,
  }
}

/** Observed battery loss expressed as equivalent 100%-to-0% discharges. */

/** Observed battery loss expressed as equivalent 100%-to-0% discharges. */
export function fullDischargeCycles(cycles) {
  let points = 0
  let count = 0
  for (const c of cycles) {
    if (c.testType === 'Charging Cycle' || c.testType === FIELD_CHARGING) continue
    const delta = isNum(c.batteryDelta) ? c.batteryDelta
      : isNum(c.startBattery) && isNum(c.endBattery) ? c.endBattery - c.startBattery : null
    if (delta == null || delta >= 0) continue
    points += -delta
    count++
  }
  return { cycles: points / 100, points, count }
}


/* ------------------------------------------------------------- empty states

   "Nothing to plot" is the least useful thing a chart can say. There are only
   a few reasons a chart comes up empty, and each one has a different fix, so
   it is worth naming which it is. */

/**
 * Why is there nothing to draw?
 *
 * @param cycles  the cycles in scope
 * @param needs   what the chart needs from each one: a field name, a series
 *                name, or a predicate
 * @param label   how to name that in prose, e.g. "a temperature reading"
 * @returns { reason, hint } — both plain sentences, never jargon
 */

/**
 * Why is there nothing to draw?
 *
 * @param cycles  the cycles in scope
 * @param needs   what the chart needs from each one: a field name, a series
 *                name, or a predicate
 * @param label   how to name that in prose, e.g. "a temperature reading"
 * @returns { reason, hint } — both plain sentences, never jargon
 */
export function explainEmpty(cycles, needs, label) {
  if (!cycles || cycles.length === 0) {
    return {
      reason: 'No cycles match the current filters.',
      hint: 'Widen a filter, or reset them to see everything again.',
    }
  }

  const has = typeof needs === 'function'
    ? needs
    : (c) => {
        const v = c[needs]
        if (Array.isArray(v)) return v.length > 0
        return v != null && Number.isFinite(Number(v))
      }

  const withIt = cycles.filter(has).length
  const n = cycles.length
  const plural = n === 1 ? 'cycle' : 'cycles'

  if (withIt === 0) {
    return {
      reason: `None of the ${n} ${plural} in scope record ${label}.`,
      hint: 'That measure is missing from the source data, not hidden by a filter.',
    }
  }

  // Something has it, yet the chart still came up empty — say so plainly
  // rather than inventing a cause.
  return {
    reason: `${withIt} of the ${n} ${plural} in scope record ${label}, but not enough to draw this chart.`,
    hint: 'A chart needs at least two points to show a shape.',
  }
}

/** Why a per-hour rate could not be computed for this set. */

/** Why a per-hour rate could not be computed for this set. */
export function explainNoRate(cycles, label = 'a drain rate') {
  if (!cycles?.length) return explainEmpty(cycles, 'dropPerHr', label)
  const tooShort = cycles.filter((c) => c.duration != null && c.duration < 1).length
  if (tooShort === cycles.length) {
    return {
      reason: `Every cycle in scope is shorter than an hour.`,
      hint: 'A per-hour rate is measured across whole-hour boundaries, so a cycle has to span at least two of them.',
    }
  }
  return explainEmpty(cycles, 'dropPerHr', label)
}

/* ------------------------------------------------------------- chart shaping */

/**
 * One line per serial: that serial's longest cycle.
 * Cycles running far past the median duration are dropped first — a single
 * stray long run otherwise stretches the x-axis and flattens everything else.
 */

/* ------------------------------------------------------------- chart shaping */

/**
 * One line per serial: that serial's longest cycle.
 * Cycles running far past the median duration are dropped first — a single
 * stray long run otherwise stretches the x-axis and flattens everything else.
 */
export function batteryBySerial(cycles, { outlierFactor = 3 } = {}) {
  const med = median(cycles.map((c) => c.duration))
  const limit = med ? med * outlierFactor : null
  const best = new Map()
  const order = []
  let dropped = 0
  for (const c of cycles) {
    if (c.duration == null || !c.series.length) continue
    if (limit != null && c.duration > limit) { dropped++; continue }
    const prior = best.get(c.serial)
    if (!prior) { order.push(c.serial); best.set(c.serial, c) }
    else if (c.duration > prior.duration) best.set(c.serial, c)
  }
  return { serials: order.sort(compareSerial), bySerial: best, dropped, medianDuration: med }
}

/** Mean battery % at each integer hour, one series per group (build, firmware…). */

/** Mean battery % at each integer hour, one series per group (build, firmware…). */
export function avgCurveBy(cycles, key) {
  const groups = new Map()
  for (const c of cycles) {
    const g = c[key] ?? 'Unknown'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(c)
  }
  const out = []
  for (const [label, list] of groups) {
    const byHour = new Map()
    for (const c of list) {
      for (const p of c.series) {
        if (p.t !== Math.round(p.t)) continue
        if (!byHour.has(p.t)) byHour.set(p.t, [])
        byHour.get(p.t).push(p.v)
      }
    }
    // An average only means something where enough runs reached that hour: past it, the
    // line is a handful of long (often partly offline) runs and swings wildly. Keep hours
    // reached by at least 5% of the group's runs, and at least 3 — the same cut the axis uses.
    const need = minRunsFor(list.length)
    const points = [...byHour.entries()]
      .map(([t, vals]) => ({ t, v: round(mean(vals), 1), n: vals.length }))
      .filter((p) => p.n >= need)
      .sort((a, b) => a.t - b.t)
    if (points.length) out.push({ label, points, count: list.length })
  }
  return out.sort(key === 'firmware'
    ? (a, b) => compareFirmwareNewest(a.label, b.label)
    : key === 'serial' ? (a, b) => compareSerial(a.label, b.label)
      : (a, b) => b.count - a.count)
}

/** Grouped bars: per load type, mean T7 drop/hr against mean load gain/hr. */

/** Grouped bars: per load type, mean T7 drop/hr against mean load gain/hr. */
export function dropGainByLoadType(cycles) {
  const groups = new Map()
  for (const c of cycles) {
    const lt = c.loadType ?? 'No Load'
    if (!groups.has(lt)) groups.set(lt, { drop: [], gain: [] })
    if (c.dropPerHr != null) groups.get(lt).drop.push(c.dropPerHr)
    if (c.loadGainPerHr != null) groups.get(lt).gain.push(c.loadGainPerHr)
  }
  return [...groups.entries()].map(([label, v]) => ({
    label,
    drop: round(mean(v.drop), 2),
    gain: round(mean(v.gain), 2),
    n: Math.max(v.drop.length, v.gain.length),
  }))
}

/** Mean drop (and load gain) at each hour boundary, across the cycle set. */

/** Mean drop (and load gain) at each hour boundary, across the cycle set. */
export function hourlyProfile(cycles) {
  const drop = new Map()
  const gain = new Map()
  const wirelessDrop = new Map()
  const withoutWirelessDrop = new Map()
  for (const c of cycles) {
    const bh = hourMapFromSeries(c.series)
    const lh = hourMapFromSeries(c.loadSeries)
    for (const [h, v] of bh) {
      if (!bh.has(h + 1)) continue
      if (!drop.has(h)) drop.set(h, [])
      drop.get(h).push(v - bh.get(h + 1))
    }
    for (const [h, v] of lh) {
      if (!lh.has(h + 1)) continue
      if (!gain.has(h)) gain.set(h, [])
      gain.get(h).push(lh.get(h + 1) - v)
    }
    if (c.testType === 'Restaurant Case') {
      for (const entry of c.hourly) {
        const target = entry.wireless ? wirelessDrop : withoutWirelessDrop
        if (!target.has(entry.h)) target.set(entry.h, [])
        target.get(entry.h).push(entry.drop)
      }
    }
  }
  const hours = [...new Set([
    ...drop.keys(), ...gain.keys(), ...wirelessDrop.keys(), ...withoutWirelessDrop.keys(),
  ])].sort((a, b) => a - b)
  return hours.map((h) => ({
    h,
    label: String(h + 1),
    drop: round(mean(drop.get(h) ?? []), 2),
    gain: round(mean(gain.get(h) ?? []), 2),
    wirelessDrop: round(mean(wirelessDrop.get(h) ?? []), 2),
    withoutWirelessDrop: round(mean(withoutWirelessDrop.get(h) ?? []), 2),
    wirelessN: (wirelessDrop.get(h) ?? []).length,
    withoutWirelessN: (withoutWirelessDrop.get(h) ?? []).length,
    n: (drop.get(h) ?? []).length,
  }))
}

/**
 * The individual runs behind one bar of the hourly profile.
 *
 * `hourlyProfile` averages these away, which is the right summary but a dead
 * end when the bar looks wrong: "hour 6 lost 9 points" says nothing about
 * whether that is every device or one bad run dragging the mean. Same
 * whole-hour pairing as the average, so the rows always reconcile with it.
 */

/**
 * The individual runs behind one bar of the hourly profile.
 *
 * `hourlyProfile` averages these away, which is the right summary but a dead
 * end when the bar looks wrong: "hour 6 lost 9 points" says nothing about
 * whether that is every device or one bad run dragging the mean. Same
 * whole-hour pairing as the average, so the rows always reconcile with it.
 */
export function hourContributors(cycles, h) {
  const rows = []
  for (const c of cycles) {
    const bh = hourMapFromSeries(c.series)
    const lh = hourMapFromSeries(c.loadSeries)
    const from = bh.get(h)
    const to = bh.get(h + 1)
    if (from == null || to == null) continue

    const loadFrom = lh.get(h)
    const loadTo = lh.get(h + 1)
    rows.push({
      id: c.id ?? `${c.serial}-${c.date}-${h}`,
      serial: c.serial,
      date: c.date ?? null,
      build: c.build,
      firmware: c.firmware,
      duration: c.duration,
      from,
      to,
      drop: round(from - to, 2),
      gain: loadFrom != null && loadTo != null ? round(loadTo - loadFrom, 2) : null,
    })
  }
  return rows.sort((a, b) => b.drop - a.drop
    || compareSerial(a.serial, b.serial))
}

function hourMapFromSeries(series) {
  const m = new Map()
  for (const p of series) {
    if (Math.abs(p.t - Math.round(p.t)) > HOUR_SNAP) continue
    const h = Math.round(p.t)
    if (!m.has(h)) m.set(h, p.v)
  }
  return m
}

/**
 * Compare cycle sets grouped by a field (firmware, build, …) across the
 * measures that matter for a regression verdict.
 */

/**
 * Compare cycle sets grouped by a field (firmware, build, …) across the
 * measures that matter for a regression verdict.
 */
export function compareBy(cycles, key) {
  const groups = new Map()
  for (const c of cycles) {
    const g = c[key] ?? 'Unknown'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(c)
  }
  return [...groups.entries()].map(([label, list]) => {
    const peaks = list.map((c) => c.maxTemp).filter(isNum)
    return {
      label,
      cycles: list.length,
      serials: new Set(list.map((c) => c.serial)).size,
      avgDuration: mean(list.map((c) => c.duration)),
      avgDropPerHr: mean(list.map((c) => c.dropPerHr)),
      avgDrop10: mean(list.map((c) => c.dropPer10Min)),
      avgGainPerHr: mean(list.map((c) => c.loadGainPerHr)),
      avgStartBattery: mean(list.map((c) => c.startBattery)),
      avgEndBattery: mean(list.map((c) => c.endBattery)),
      avgPeakTemp: mean(peaks),
      maxTemp: maxOf(peaks),
      dates: [...new Set(list.map((c) => c.date).filter(Boolean))].sort(),
    }
  }).sort(key === 'firmware'
    ? (a, b) => compareFirmwareNewest(a.label, b.label)
    : key === 'serial' ? (a, b) => compareSerial(a.label, b.label)
      : (a, b) => b.cycles - a.cycles)
}

/** Equal-width histogram over a list of numbers. */

/** Equal-width histogram over a list of numbers. */
export function histogramOf(values, binWidth, lo, hi) {
  const count = Math.max(1, Math.ceil((hi - lo) / binWidth))
  const bins = Array.from({ length: count }, (_, i) => ({
    lo: lo + i * binWidth, hi: lo + (i + 1) * binWidth, n: 0,
  }))
  let total = 0
  for (const v of values) {
    if (!isNum(v)) continue
    const i = Math.min(count - 1, Math.max(0, Math.floor((v - lo) / binWidth)))
    bins[i].n++
    total++
  }
  return { bins, total }
}

/**
 * Values that are the same once punctuation and case are ignored. Used to
 * point at typos rather than to merge them — merging would hide a real
 * difference if the two spellings turn out to mean different things.
 */

/**
 * The x extent (hours) of what a curve chart will actually draw: the furthest sample in
 * the cycles' own series, rounded up. T7 sized these axes by the longest cycle's
 * duration, which works for bench runs that are all sampled to the end — but an MDM
 * cycle can span weeks of offline time while its curve covers a day, which squeezed
 * every line against the left edge of an 800-hour axis. Falls back to duration only
 * when nothing in scope has a curve, so an empty chart still gets a sensible frame.
 */
export function plottedMaxHour(cycles, key = 'series') {
  // avgCurveBy plots only samples sitting exactly on a whole hour (`p.t === Math.round(p.t)`,
  // not the looser HOUR_SNAP), so use the identical rule: the axis ends at the last point
  // that is actually drawn, not at a stray sample the curve itself ignores.
  // the last whole hour each run reached; the axis ends at the hour enough runs reached
  const reach = []
  for (const c of cycles) {
    let m = -1
    for (const p of c[key] || []) if (p.t === Math.round(p.t) && p.t > m) m = p.t
    if (m >= 0) reach.push(m)
  }
  if (!reach.length) return Math.max(1, Math.ceil(maxOf(cycles.map((c) => c.duration), 0) || 1))
  reach.sort((a, b) => b - a)
  return Math.max(1, Math.ceil(reach[Math.min(reach.length, minRunsFor(reach.length)) - 1]))
}

/**
 * Average, lowest and highest at each whole hour across a set of cycles — the "Average"
 * view of a curve chart, with the spread kept visible so one fast-draining device is not
 * hidden inside the mean. `key` picks the curve ('series' battery, 'tempSeries' temperature);
 * same exact-whole-hour rule as avgCurveBy, so the two views line up point for point.
 */
export function envelopeBy(cycles, key = 'series') {
  const byHour = new Map()
  for (const c of cycles) {
    for (const p of c[key] || []) {
      if (p.t !== Math.round(p.t)) continue
      if (!byHour.has(p.t)) byHour.set(p.t, [])
      byHour.get(p.t).push(p.v)
    }
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b)
  const pts = (f) => hours.map((t) => ({ t, v: round(f(byHour.get(t)), 1), n: byHour.get(t).length }))
  return { avg: pts(mean), min: pts((a) => Math.min(...a)), max: pts((a) => Math.max(...a)) }
}

/** Battery cycles in a set of T7-shaped cycles: total % drained ÷ 100 (charging excluded). */
export const batteryCycles = (cycles) => fullDischargeCycles(cycles).cycles

/** Battery cycles per distinct value of a field, biggest first — the replacement for a
 *  plain count wherever the dashboard says "cycles". */
export function batteryCyclesBy(cycles, key) {
  const groups = new Map()
  for (const c of cycles) {
    const v = c[key]
    if (v == null || v === '' || v === 'Unknown') continue
    if (!groups.has(v)) groups.set(v, [])
    groups.get(v).push(c)
  }
  return [...groups.entries()].map(([label, list]) => ({ label, value: batteryCycles(list), runs: list.length }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)))
}


/** How many runs an hour needs before an averaged curve plots it (and the axis reaches it):
 *  5% of the runs, at least 3 — or every run when there are fewer than 3. */
export function minRunsFor(n) {
  return n < 3 ? 1 : Math.max(3, Math.ceil(n * 0.05))
}
