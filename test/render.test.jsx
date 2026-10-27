import React from 'react'
import { renderToString } from 'react-dom/server'
import fs from 'node:fs'
import { reclassify, DEFAULTS, dedupeOverlapping } from '../src/lib/cycles.js'
import { adaptAll } from '../src/lib/adapt.js'
import { filterCycles, filtersFor, distinct, kpis } from '../src/lib/t7cycles.js'
import T7Overview from '../src/views/T7Overview.jsx'
import TestDetail from '../src/views/TestDetailView.jsx'
import Comparison from '../src/views/ComparisonView.jsx'
import Thermal from '../src/views/ThermalView.jsx'
import Devices from '../src/views/DevicesView.jsx'
import Today from '../src/views/TodayView.jsx'
import CyclePlan from '../src/views/CyclePlanView.jsx'
import DeviceView from '../src/views/DeviceView.jsx'
import { lifetimeOf, cyclesInRange } from '../src/lib/device.js'
import FilterBar, { FilterPills } from '../src/components/FilterBar.jsx'
import { DateList } from '../src/components/DatePicker.jsx'
import { splitText, countCycles, cyclesText, benchCycles } from '../src/lib/splitCycles.js'
import { findOddOnes, mergeAlerts } from '../src/lib/alerts.js'
import { compactSpans, mergeSpans, screenTime, adsGap } from '../src/lib/hostApp.js'
import { padLoad } from '../src/lib/pad.js'
import { loadPart, getSnapshot } from '../src/lib/fleet.js'
import { runStartOf, drainSplit } from '../src/lib/window.js'
import { takeOutReasons } from '../src/lib/plan.js'
import RangePicker from '../src/components/RangePicker.jsx'
import { mergePhone, cleanPhone, phoneDevices, phoneHours } from '../src/lib/phoneLog.js'
import { csvField, readingsCsv, cyclesCsv, extraKeys, estimateRows, cycleHoursCsv } from '../src/lib/csv.js'
import { windowOn, cycleAt, nextCycleTimes, cyclesOn, activeSerials, overlapsOn, loadDecls } from '../src/lib/plan.js'
import { testTypeFor, planFor, temperaturePhases } from '../src/lib/adapt.js'
import { thermalTimingByDevice } from '../src/lib/thermal.js'
import { sortValue, compareValues, SortTable } from '../src/components/SortTable.jsx'
import { presetRange, resolve, overlaps, dayRange } from '../src/lib/range.js'
import { extendLedger, cumAt, lifetimeAt, drainByAge, liveLedgers } from '../src/lib/drainAge.js'
import { runsFrom, benchesFrom, classifyBench, applyAuto } from '../src/lib/autoPlan.js'
import { slotBuckets, extendSlots, tagSlots, drainBands, conditionBands, padSplit } from '../src/lib/drainHours.js'
import HealthView from '../src/components/BatteryHealth.jsx'
import { healthRows, capacityIndex, earlyIndex, earlyDrain, fleetBaselines, loadClass, stressIndex, fleetP90, stressFactors, hoursAtFull, chargeSegments, medianToFull, slowCharges, gaugeJumps, shutdownsAbove, scoreOf, gradeOf, GRADE, SHUTDOWN, NO_FULL, JUMP } from '../src/lib/health.js'

// a rota so every test type, including Restaurant Case's wireless split, gets exercised
const ROTA = JSON.stringify({0:{testType:'wlc_load'},1:{testType:'restaurant'},2:{testType:'wlc_phone'},3:{testType:'wlc_disch'},4:{testType:'charging'},5:{testType:'burnin'},6:{testType:'disch_ads'}})
{ const m = new Map(); globalThis.localStorage = { getItem: k => k.startsWith('cyclePlan:rota') ? ROTA : (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) } } }
const seed = JSON.parse(fs.readFileSync('data/cycles.json'))
const DEV = Object.entries(seed.devices).map(([serial, h]) => ({ serial, snap: { groups: ['Test Cycles'] },
  cycles: reclassify(h.cycles || [], h.interrupted || [], DEFAULTS).cycles }))
const rows = s => { const c = DEV.find(x => x.serial === s).cycles.at(-1); if (!c) return null
  const out = []; for (let t = c.start; t <= c.end; t += 300e3) out.push({ timestamp: new Date(t).toISOString(), battery_pct: Math.round(c.startPct - (c.startPct - c.endPct) * (t - c.start) / (c.end - c.start)), build_id: 'v2.1.024', extra: { battery_temp_c: 38, charging: false } }); return out }
const cycles = adaptAll(DEV, rows)
const all = distinct(cycles, 'serial'), base = filtersFor(all)
const nop = () => {}
const ov = (cs, tt = '__all__') => [T7Overview, { cycles: cs, testType: tt, allSerials: all, onPickTestType: nop, onFilter: nop }]
const tts = distinct(cycles, 'testType')
const cases = {
  'overview all': ov(cycles),
  ...Object.fromEntries(tts.map(t => [`overview test=${t}`, ov(cycles.filter(c => c.testType === t), t)])),
  'overview one device': ov(filterCycles(cycles, { ...base, serials: [all[0]] })),
  'overview one date': ov(filterCycles(cycles, { ...base, date: cycles[0].date })),
  'overview one fw': ov(filterCycles(cycles, { ...base, firmware: 'v2.1.024' })),
  comparison: [Comparison, { cycles, testType: '__all__' }],
  ...Object.fromEntries(tts.flatMap(t => { const cs = cycles.filter(c => c.testType === t); return [
    [`comparison test=${t}`, [Comparison, { cycles: cs, testType: t }]],
    [`thermal test=${t}`, [Thermal, { cycles: cs, allSerials: all, onFilter: nop }]],
    [`summary test=${t}`, [Devices, { cycles: cs, allSerials: all, events: [], onEventsChanged: nop, onFilter: nop, issues: [], files: [] }]],
  ] })),
  'empty scope': ov([]),
  'declared type, no cycles yet': ov([], 'WLC on Phone'),
  // this repo's own two screens, fed the fleet shape they read
  today: [Today, { fleet: { DEV, allCycles: DEV.flatMap(d => d.cycles), DMAP: new Map(DEV.map(d => [d.serial, d])), opts: DEFAULTS }, cycles: [] }],
  'cycle plan': [CyclePlan, { fleet: { DEV, allCycles: DEV.flatMap(d => d.cycles), DMAP: new Map(DEV.map(d => [d.serial, d])), opts: DEFAULTS }, cycles: [] }],
  health: [HealthView, { fleet: { DEV, allCycles: DEV.flatMap(d => d.cycles), DMAP: new Map(DEV.map(d => [d.serial, d])), opts: DEFAULTS, at: 1 }, cycles }],
  'health, no cycles': [HealthView, { fleet: { DEV, allCycles: [], DMAP: new Map(DEV.map(d => [d.serial, d])), opts: DEFAULTS, at: 1 }, cycles: [] }],
  thermal: [Thermal, { cycles, allSerials: all, onFilter: nop }],
  summary: [Devices, { cycles, allSerials: all, events: [], onEventsChanged: nop, onFilter: nop, issues: [], files: [] }],
}
let failed = 0
console.log('cycles', cycles.length, '| types:', tts.join(' | '))
for (const [name, [C, p]] of Object.entries(cases)) {
  try { renderToString(<C {...p} />); console.log('OK  ', name, `(${p.cycles.length})`) }
  catch (e) { failed++; console.log('FAIL', name, '->', e.message); console.log((e.stack || '').split('\n').slice(1, 5).join('\n')) }
}
// Average battery cycles (the Overview's MDM tile): the real mean per device, and "—" (never 0) when no
// ticked device reports discharge_total_pct.
const snaps = { [all[0]]: { discharge_total_pct: 1492 }, [all[1]]: { discharge_total_pct: 9207 }, [all[2]]: {} }
const checks = [
  ['lifetime: one device = 14.92', lifetimeOf([all[0]], sn => snaps[sn]), '14.92'],
  ['lifetime: two devices averaged', lifetimeOf([all[0], all[1]], sn => snaps[sn]), '53.50'],
  ['lifetime: none reporting shows —', lifetimeOf([all[2]], sn => snaps[sn]), '—'],
]
let lifeCases = 0
for (const [name, lifetime, want] of checks) {
  for (const tt of ['__all__']) { // a single test's page shows that test's cycles, not the lifetime total
    lifeCases++
    try {
      const html = renderToString(<T7Overview cycles={tt === '__all__' ? cycles : cycles.filter(c => c.testType === tt)} testType={tt} allSerials={all} onPickTestType={nop} onFilter={nop} lifetime={lifetime} />)
      const i = html.indexOf('Average battery cycles'), tile = html.slice(i, i + 400).replace(/<[^>]+>/g, ' ')
      if (i < 0 || !tile.includes(want)) throw new Error(`expected ${want}, tile read: ${tile.replace(/\s+/g, ' ').slice(0, 120)}`)
      if (tile.includes('lifetime, all tests')) throw new Error('foot text should be gone')
      // cycles come from the MDM only; the run-derived tile was removed on request
      if (html.includes('Battery cycles in these runs')) throw new Error('run-based tile should be gone')
      console.log('OK  ', name, tt === '__all__' ? '(overview)' : '(test view)')
    } catch (e) { failed++; console.log('FAIL', name, '->', e.message) }
  }
}
// Split figures: MDM cycles when every run is covered by recorded counter readings,
// else a run count — never a partial MDM sum.
const mdmCases = []
{
  // readings that bracket every run of every device, rising by exactly each run's drain
  const readings = { group: 'Test Cycles', devices: {} }
  for (const d of DEV) {
    let t = 0, v = 1000; const rs = []
    for (const c of [...d.cycles].sort((a, b) => a.start - b.start)) {
      rs.push([c.start, v]); v += Math.max(0, c.startPct - c.endPct); rs.push([c.end, v])
    }
    if (rs.length) readings.devices[d.serial] = rs
  }
  const covered = adaptAll(DEV, () => null, readings), bare = adaptAll(DEV, () => null, null)
  const check = (name, fn) => { mdmCases.push(name); try { fn(); console.log('OK  ', name) } catch (e) { failed++; console.log('FAIL', name, '->', e.message) } }
  const checkAsync = async (name, fn) => { mdmCases.push(name); try { await fn(); console.log('OK  ', name) } catch (e) { failed++; console.log('FAIL', name, '->', e.message) } }
  const want = (cond, msg) => { if (!cond) throw new Error(msg) }
  check('runs covered -> "cycles (MDM)"', () => { const t = splitText(covered.slice(0, 20)); want(/cycles \(MDM\)$/.test(t), t) })
  check('no readings -> run count', () => { const t = splitText(bare.slice(0, 20)); want(t === cyclesText(bare.slice(0, 20)) && countCycles(bare.slice(0, 20)) < 20, t) })
  check('one uncovered run -> run count, never a partial sum', () => {
    const mixed = [...covered.slice(0, 5), { ...covered[5], mdmCycles: null }]; const t = splitText(mixed); want(t === cyclesText(mixed), t) })
  check('overview cards count cycles (bench runs), not battery cycles', () => {
    const h = renderToString(<T7Overview cycles={covered} testType="__all__" allSerials={all} onPickTestType={nop} onFilter={nop} />).replace(/<!-- -->/g, '')
    want(!h.includes('battery cycles (MDM) ·') && / cycles? · \d+ devices/.test(h), 'panel subtitle is not "N cycles · M devices"')
  })
  check('overview cards show runs without readings', () => {
    const h = renderToString(<T7Overview cycles={bare} testType="__all__" allSerials={all} onPickTestType={nop} onFilter={nop} />)
    want(!h.includes('cycles (MDM)') && / cycles/.test(h), 'expected cycle counts only')
  })
  check('filter bar + pill render', () => {
    renderToString(<FilterBar cycles={covered} filters={base} onChange={nop} onReset={nop} allSerials={all} declaredTypes={[]} />)
    want(renderToString(<FilterPills filters={base} onChange={nop} onReset={nop} count={splitText(covered)} allSerials={all} />) === '', 'pill row shown with no filter set')
  })
  check('range picker + range chip render', () => {
    want(renderToString(<RangePicker value={{ preset: '24h' }} onChange={nop} />).includes('Last 24h'), 'trigger label')
    const h = renderToString(<FilterPills filters={{ ...base, range: { preset: '7d' } }} onChange={nop} onReset={nop} count="3 runs" allSerials={all} />)
    want(h.includes('Last 7 days'), 'range chip missing')
  })
  check('range filter keeps runs that overlap it', () => {
    const last = covered.reduce((a, c) => (c.end > a.end ? c : a))
    const r = dayRange(last.start, last.start)
    want(covered.filter((c) => overlaps(c, r)).includes(last), 'run on that day not kept')
  })
  check('range cycles: MDM counter where recorded, readings before', () => {
    const H = 3600e3, t0 = Date.UTC(2026, 9, 1), r = { from: t0, to: t0 + 10 * H }
    const readings = { devices: { A: [[t0 - H, 1000], [t0 + 11 * H, 1250]] } }
    // B: window rows from t0+4h (100 -> 70, charge, 90 -> 80); C: a stored curve before that
    const rows = { B: [[4, 100], [5, 70], [6, 95], [7, 90], [8, 80]].map(([h, b]) => ({ timestamp: new Date(t0 + h * H).toISOString(), battery_pct: b })) }
    const curves = { [`B@${t0}`]: { s: 60, b: [100, 90, 80] } }
    const out = cyclesInRange(['A', 'B', 'Z'], r, { readings, rowsFor: (s) => rows[s] || [], curves }, t0 + 20 * H)
    const v = Object.fromEntries(out.rows.map((x) => [x.serial, x.value]))
    want(Math.abs(v.A - 2.0833) < 0.001, `A ${v.A}`)          // counter interpolated: 250 x 10/12 / 100
    want(Math.abs(v.B - 0.65) < 1e-9, `B ${v.B}`)             // 0.2 from the curve + 0.45 from the window (30+5+10)
    want(v.Z == null && out.missing.includes('Z') && out.source === 'mixed', 'missing device / source')
  })
  check('overview keeps the cycles tile when a range has no runs', () => {
    const h = renderToString(<T7Overview cycles={[]} testType="__all__" allSerials={all} onPickTestType={nop} onFilter={nop}
      lifetime={{ value: 3.5, rows: [], devices: 1, missing: [], range: 'Last hour', source: 'counter' }} />)
    want(h.includes('Average battery cycles') && h.includes('3.50') && h.includes('Last hour'), 'tile missing')
  })
  check('comparison keeps Compare by when one build is in scope', () => {
    const one = covered.map((c) => ({ ...c, build: 'EVT', firmware: 'fw1' }))
    const h = renderToString(<Comparison cycles={one} testType="__all__" allSerials={all} />)
    want(h.includes('Compare by') && /Device \(\d+\)/.test(h), 'switch hidden or no device counts')
    const solo = one.filter((c) => c.serial === one[0].serial)
    want(renderToString(<Comparison cycles={solo} testType="__all__" allSerials={all} />).includes('Compare by'), 'switch hidden with one group')
  })
  check('table sort reads displayed values', () => {
    const cases = [['9.1 h', 9.1], ['10.03%/h', 10.03], ['47.6 °C', 47.6], ['1,234 runs', 1234], ['13h 45m', 13.75], ['45m', 0.75],
      ['09:34 PM', 21 * 60 + 34], ['12:05 AM', 5], ['−2.5%', -2.5], ['—', null], ['', null]]
    for (const [t, v] of cases) want(sortValue(t) === v, `${t} -> ${sortValue(t)}`)
    want(sortValue('7 May 2026') < sortValue('3 Oct 2026'), 'dates out of order')
    const vals = ['20.6 h', '—', '35.6 h', '19.8 h'].map(sortValue)
    want(vals.slice().sort((a, b) => compareValues(a, b, 1))[0] === 35.6, 'highest not first')
    want(vals.slice().sort((a, b) => compareValues(a, b, -1))[0] === 19.8, 'lowest not first')
    want(vals.slice().sort((a, b) => compareValues(a, b, -1)).at(-1) === null, 'blank not last')
  })
  check('sort table renders clickable headings', () => {
    const h = renderToString(<SortTable head={[{ label: 'Device' }, { label: 'Temp' }]}>
      {[['A', '40 °C'], ['B', '50 °C']].map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</SortTable>)
    want(h.includes('Click for highest first') && h.includes('50 °C'), 'no sortable heading')
  })
  check('one device + one test lists every run with its day', () => {
    const sn = covered[0].serial, tt = covered[0].testType
    const mine = covered.filter((c) => c.serial === sn && c.testType === tt)
    const h = renderToString(<TestDetail cycles={mine} testType={tt} allSerials={all} />)
    want(h.includes(`Every cycle on ${sn}`), 'no every-cycle card')
    const rows = (h.split('Every cycle on')[1].match(/<tr/g) || []).length - 1   // minus the heading row
    want(rows === mine.length, `rows ${rows} vs runs ${mine.length}`)
  })
  check('overnight window: 10:00 -> 04:00 ends the next morning', () => {
    const w = windowOn('2026-10-11', { startTime: '10:00', endTime: '04:00' })
    want(w.overnight && w.endMs - w.startMs === 18 * 3600e3, `span ${(w.endMs - w.startMs) / 3600e3} h`)
    const day = windowOn('2026-10-11', { startTime: '07:00', endTime: '19:00' })
    want(!day.overnight && day.endMs - day.startMs === 12 * 3600e3, 'day window changed')
  })
  check('a run starting late belongs to its start day test', () => {
    const decls = [{ id: 'd1', testType: 'wlc_load', from: '2026-10-11', to: '2026-10-11', startTime: '10:00', endTime: '04:00', group: { kind: 'all' } }]
    const at = (d, h) => new Date(2026, 9, d, h).getTime()
    const late = testTypeFor({ start: at(11, 23), end: at(12, 4), serial: 'A' }, { decls, rota: {}, DEV: [] })
    want(late === 'WLC on Load', `late start -> ${late}`)
    // off the charger up to 2 h before the planned start still counts; 3 h early does not
    const early = testTypeFor({ start: at(11, 8), end: at(11, 20), serial: 'A' }, { decls, rota: {}, DEV: [] })
    want(early === 'WLC on Load', `2 h early -> ${early}`)
    const tooEarly = testTypeFor({ start: at(11, 7), end: at(11, 20), serial: 'A' }, { decls, rota: {}, DEV: [] })
    want(tooEarly !== 'WLC on Load', `3 h early -> ${tooEarly}`)
  })
  check('two cycles back to back: overnight, then the next one the same afternoon', () => {
    const decls = [
      { id: 'd1', at: 1, testType: 'wlc_load', from: '2026-10-11', to: '2026-10-11', startTime: '10:00', endTime: '04:00', group: { kind: 'all' } },
      { id: 'd2', at: 2, testType: 'charging', from: '2026-10-12', to: '2026-10-12', startTime: '14:00', endTime: '04:00', group: { kind: 'all' } },
    ]
    const at = (d, h) => new Date(2026, 9, d, h).getTime()
    want(cycleAt(decls, at(12, 1))?.decl.id === 'd1', '01:00 Oct 12 should still be the Oct 11 cycle')
    want(cycleAt(decls, at(12, 10)) == null, '10:00 Oct 12 is between cycles')
    want(cycleAt(decls, at(12, 15))?.decl.id === 'd2', '15:00 Oct 12 is the second cycle')
    const n = nextCycleTimes(decls.slice(0, 1), '2026-10-12')
    want(n.startTime === '04:00' && n.endTime === '22:00' && n.fromLast, `next cycle ${n.startTime}-${n.endTime}`)
    want(cyclesOn(decls, '2026-10-12').length === 1, 'own cycles on Oct 12')
    const tt = testTypeFor({ start: at(12, 1), end: at(12, 3), serial: 'A' }, { decls, rota: {}, DEV: [] })
    want(tt === 'WLC on Load', `1am run -> ${tt}`)
    // a discharge inside a Charging Cycle's window is not a charging cycle, and a charge is
    const dis = testTypeFor({ start: at(12, 15), end: at(13, 3), serial: 'A' }, { decls, rota: {}, DEV: [] })
    const chg = testTypeFor({ start: at(12, 15), end: at(12, 20), serial: 'A', charging: true }, { decls, rota: {}, DEV: [] })
    want(dis !== 'Charging Cycle' && chg === 'Charging Cycle', `discharge ${dis} / charge ${chg}`)
    want(testTypeFor({ start: at(11, 12), end: at(11, 16), serial: 'A', charging: true }, { decls, rota: {}, DEV: [] }) === 'Field Charging', 'a charge in a discharge test')
    // planned tests: nothing before 25 Sep, no 69 h Restaurant Case, no device idling on the bench
    const rcd = [{ id: 'r', at: 1, testType: 'restaurant', from: '2026-10-16', to: '2026-10-16', startTime: '14:00', endTime: '04:00', spanDays: 1, group: { kind: 'all' } },
      { id: 'o', at: 1, testType: 'restaurant', from: '2026-09-20', to: '2026-09-20', startTime: '10:00', endTime: '23:00', group: { kind: 'all' } }]
    const run = (d, h, hrs, from, to) => testTypeFor({ serial: 'A', start: at(d, h), end: at(d, h) + hrs * 3600e3, durationMs: hrs * 3600e3, startPct: from, endPct: to }, { decls: rcd, rota: {}, DEV: [] })
    want(run(16, 14, 14, 100, 18) === 'Restaurant Case', 'a real Restaurant Case')
    want(run(16, 14, 69, 100, 30) === 'Old cycles', '69 h is not a Restaurant Case')
    const plan = (d, h, hrs, from, to, more = {}) => planFor({ serial: 'A', start: at(d, h), end: at(d, h) + hrs * 3600e3, durationMs: hrs * 3600e3, startPct: from, endPct: to, ...more }, { decls: rcd, rota: {}, DEV: [] })
    // past 14 h + 2 h the device left the cycle: its first 16 h still count
    const long = plan(16, 14, 18, 100, 10)
    want(run(16, 17, 15.5, 100, 15) === 'Restaurant Case' && long.name === 'Restaurant Case' && long.cutAt === at(16, 14) + 16 * 3600e3, `14 h + 2 h, then cut: ${JSON.stringify(long)}`)
    want(run(16, 14, 10, 100, 90) === 'Old cycles', 'idle at 1 %/h: not on the test')
    const byHour = (padHours) => testTypeFor({ serial: 'A', start: at(16, 14), end: at(16, 14) + 14 * 3600e3, durationMs: 14 * 3600e3, startPct: 100, endPct: 18, padH: 3, padHours }, { decls: rcd, rota: {}, DEV: [] })
    const ok = [true, true, true, false, false, false, false, false, false, false, false, false, false, false]
    want(byHour(ok) === 'Restaurant Case' && byHour(ok.map((v, i) => (i === 3 ? true : v))) === 'Restaurant Case', 'load hours 1-3, off by hour 4 or 5')
    want(byHour(ok.map((v, i) => (i === 0 ? false : v))) === 'Old cycles', 'no load in hour 1: never in the cycle')
    // a load still on in hour 6: the device left the cycle then; hours 1-5 still count
    const late = plan(16, 14, 14, 100, 18, { padHours: ok.map((v, i) => (i === 5 ? true : v)) })
    want(late.name === 'Restaurant Case' && late.cutAt === at(16, 14) + 5 * 3600e3 && /hour 6/.test(late.why), `load in hour 6: ${JSON.stringify(late)}`)
    want(byHour(ok.map((v, i) => (i === 1 ? null : v))) === 'Restaurant Case', 'an hour without readings is not judged')
    want(byHour(ok.map((v, i) => (i < 3 ? null : v))) === 'Old cycles', 'no readings in the load hours: not confirmed')
    want(byHour(ok.map(() => null)) === 'Restaurant Case', 'no pad readings at all (not loaded yet): not judged')
    // an Idle Cycle for two devices (added later, so newest) is only theirs; idle drains ~1 %/h and still counts
    const idle = [...rcd, { id: 'i', at: 9, testType: 'idle', from: '2026-10-16', to: '2026-10-16', startTime: '14:00', endTime: '23:59', spanDays: 6, group: { kind: 'serials', serials: ['I1', 'I2'] } }]
    const on = (serial, hrs, to) => testTypeFor({ serial, start: at(16, 14) + 30 * 60e3, end: at(16, 14) + hrs * 3600e3, durationMs: hrs * 3600e3, startPct: 100, endPct: to }, { decls: idle, rota: {}, DEV: [] })
    want(on('I1', 80, 18) === 'Idle Cycle' && on('A', 14, 18) === 'Restaurant Case', `idle: ${on('I1', 80, 18)} / bench: ${on('A', 14, 18)}`)
    want(new Date(2026, 8, 20, 11).getTime() < at(16, 0) && testTypeFor({ serial: 'A', start: new Date(2026, 8, 20, 11).getTime(), end: new Date(2026, 8, 21, 1).getTime(), durationMs: 14 * 3600e3, startPct: 100, endPct: 18 }, { decls: rcd, rota: {}, DEV: [] }) === 'Old cycles', 'before 25 Sep: Old cycles')
  })
  check('Charging Cycle: every charge since 25 Sep, shown as gain', () => {
    const t0 = new Date(2026, 9, 12, 15).getTime(), H = 3600e3
    localStorage.setItem('cyclePlan:decls:v1:Test Cycles', JSON.stringify([{ id: 'c', at: 1, testType: 'charging', from: '2026-10-12', to: '2026-10-12', startTime: '14:00', endTime: '20:00', spanDays: 0, group: { kind: 'all' }, repeat: 'none' }]))
    const seg = { start: t0, end: t0 + 3 * H, durationMs: 3 * H, startPct: 20, endPct: 95, maxTemp: 40, curve: [[0, 20], [60, 45], [120, 70], [180, 95]] }
    const night = { ...seg, start: t0 + 12 * H, end: t0 + 15 * H }
    const out = adaptAll([{ serial: 'AT070AABU00001', cycles: [], charges: [seg, night] }], () => null)
    localStorage.removeItem('cyclePlan:decls:v1:Test Cycles')
    want(out.length === 2 && out.every((c) => c.testType === 'Charging Cycle'), `every charge since 25 Sep: ${out.map((c) => c.testType)}`)
    want(!adaptAll([{ serial: 'AT070AABU00001', cycles: [], charges: [{ ...seg, start: new Date(2026, 8, 20, 1).getTime(), end: new Date(2026, 8, 20, 4).getTime() }] }], () => null).length, 'not before 25 Sep')
    want(out[0].series.length === 4 && out[0].batteryDelta === 75 && out[0].hourly.every((h) => h.drop < 0), `gain per hour: ${JSON.stringify(out[0].hourly)}`)
    want('wirelessDrainPerHr' in out[0] && 'withoutWirelessDrainPerHr' in out[0], 'WLC active / inactive drain on every cycle')
  })
  check('a device taken out leaves the cycle: its run counts up to then', () => {
    const at = (d, h) => new Date(2026, 9, d, h).getTime()
    const decl = { id: 'd1', at: 1, testType: 'wlc_load', from: '2026-10-11', to: '2026-10-11', startTime: '10:00', endTime: '04:00', group: { kind: 'all' },
      removed: [{ serial: 'B', at: at(11, 15), reason: 'Taken for debugging' }] }
    const DEV = [{ serial: 'A' }, { serial: 'B' }]
    want(activeSerials(decl, DEV, at(11, 12)).length === 2, 'B still in before it was taken')
    want(activeSerials(decl, DEV, at(11, 16)).join() === 'A', 'B gone after')
    // B taken out at 15:00 after starting at 10:00: its 5 h until then are the test's
    const pB = planFor({ start: at(11, 10), end: at(11, 20), durationMs: 10 * 3600e3, startPct: 100, endPct: 10, serial: 'B' }, { decls: [decl], rota: {}, DEV })
    const tA = testTypeFor({ start: at(11, 10), end: at(11, 20), durationMs: 10 * 3600e3, startPct: 100, endPct: 10, serial: 'A' }, { decls: [decl], rota: {}, DEV })
    want(pB.name === 'WLC on Load' && pB.cutAt === at(11, 15) && /taken out/.test(pB.why) && tA === 'WLC on Load', `B ${JSON.stringify(pB)} / A ${tA}`)
    // taken out within the first hour: nothing to keep
    const early = planFor({ start: at(11, 14) + 30 * 60e3, end: at(11, 20), durationMs: 5.5 * 3600e3, startPct: 100, endPct: 40, serial: 'B' }, { decls: [decl], rota: {}, DEV })
    want(early.name === 'Old cycles', `taken out after 30 min: ${early.name}`)
  })
  check('overlapping cycles are found; back-to-back ones are not', () => {
    const DEV = [{ serial: 'A' }, { serial: 'B' }]
    const d = (id, at, s, e, group = { kind: 'all' }) => ({ id, at, testType: 'wlc_load', from: '2026-10-10', to: '2026-10-10', startTime: s, endTime: e, group })
    const o = overlapsOn([d('x', 1, '07:00', '19:00'), d('y', 2, '10:00', '04:00')], '2026-10-10', DEV)
    want(o.length === 1 && o[0].shared === 2 && o[0].winner.decl.id === 'y', 'clash not found')
    want(new Date(o[0].from).getHours() === 10 && new Date(o[0].to).getHours() === 19, 'overlap span')
    want(!overlapsOn([d('x', 1, '07:00', '13:00'), d('y', 2, '13:00', '19:00')], '2026-10-10', DEV).length, 'back to back flagged')
    want(!overlapsOn([d('x', 1, '07:00', '19:00', { kind: 'serials', serials: ['A'] }), d('y', 2, '10:00', '20:00', { kind: 'serials', serials: ['B'] })], '2026-10-10', DEV).length, 'different devices flagged')
  })
  check('a cycle with an end date: Oct 10 07:00 -> Oct 11 03:00, no copy on Oct 11', () => {
    const decls = [{ id: 'x', at: 1, testType: 'charging', from: '2026-10-10', to: '2026-10-10', startTime: '07:00', endTime: '03:00', spanDays: 1, group: { kind: 'all' } },
      { id: 'y', at: 2, testType: 'restaurant', from: '2026-10-11', to: '2026-10-11', startTime: '11:00', endTime: '22:00', spanDays: 0, group: { kind: 'all' } }]
    const w = windowOn('2026-10-10', decls[0])
    want((w.endMs - w.startMs) / 3600e3 === 20, `span ${(w.endMs - w.startMs) / 3600e3}`)
    want(!overlapsOn(decls, '2026-10-11', [{ serial: 'A' }]).length, 'should not overlap')
    const long = windowOn('2026-10-10', { startTime: '07:00', endTime: '15:00', spanDays: 2 })
    want((long.endMs - long.startMs) / 3600e3 === 56, 'two-day cycle')
    want(cycleAt([{ ...decls[0], spanDays: 2, endTime: '15:00' }], new Date(2026, 9, 12, 9).getTime())?.decl.id === 'x', 'day 3 of a long cycle')
  })
  check('overlap warning is about times, never about sharing a day', () => {
    const DEV = [{ serial: 'A' }]
    const c = (id, at, from, st, en, span) => ({ id, at, testType: 'charging', from, to: from, startTime: st, endTime: en, spanDays: span, group: { kind: 'all' } })
    const night = c('n', 1, '2026-10-10', '07:00', '03:00', 1)                    // Oct 10 07:00 -> Oct 11 03:00
    // days overlap (both on Oct 11), times do not: no warning, on either day
    for (const later of [c('a', 2, '2026-10-11', '11:00', '22:00', 0), c('b', 2, '2026-10-11', '03:00', '09:00', 0)])
      for (const day of ['2026-10-10', '2026-10-11']) want(!overlapsOn([night, later], day, DEV).length, `${later.startTime} flagged on ${day}`)
    // times overlap: 02:00-05:00 on Oct 11 clashes with the night cycle from 02:00 to 03:00
    const o = overlapsOn([night, c('x', 2, '2026-10-11', '02:00', '05:00', 0)], '2026-10-11', DEV)
    want(o.length === 1 && new Date(o[0].from).getHours() === 2 && new Date(o[0].to).getHours() === 3, 'real clash missed')
  })
  check('an old From/To plan reads as one continuous cycle', () => {
    localStorage.setItem('cyclePlan:decls:v1:T', JSON.stringify([
      { id: 'D-001', at: 1, testType: 'charging', from: '2026-10-10', to: '2026-10-11', startTime: '07:00', endTime: '03:00', group: { kind: 'all' }, repeat: 'none' },
      { id: 'D-002', at: 2, testType: 'restaurant', from: '2026-10-11', to: '2026-10-11', startTime: '11:00', endTime: '22:00', group: { kind: 'all' }, repeat: 'none' }]))
    const decls = loadDecls('T'), w = windowOn('2026-10-10', decls.find((d) => d.id === 'D-001'))
    want((w.endMs - w.startMs) / 3600e3 === 20, `span ${(w.endMs - w.startMs) / 3600e3} h`)
    want(cyclesOn(decls, '2026-10-11').length === 1, 'still a copy on Oct 11')
    want(!overlapsOn(decls, '2026-10-11', [{ serial: 'A' }]).length, 'Oct 11 still warns')
  })
  check('thermal: runs carry start / middle / end temperatures', () => {
    const ph = temperaturePhases([{ t: 0, v: 30 }, { t: 1, v: 32 }, { t: 4, v: 40 }, { t: 5, v: 42 }, { t: 8, v: 36 }], 9)
    want(ph.join() === '31,41,36', `phases ${ph}`)
    // cycles built with real history rows (covered has none, so no temperatures)
    const withTemp = cycles.filter((c) => c.tempSeries.length), withPh = withTemp.filter((c) => c.tempPhases?.every(Number.isFinite))
    want(withTemp.length && withPh.length > withTemp.length / 2, `${withPh.length} of ${withTemp.length} runs with temperatures have phases`)
    want(thermalTimingByDevice(cycles).length > 0, 'timing table empty')
  })
  check('the same run found twice (import + sweep) is kept once', () => {
    const t = (d, h, m = 0) => Date.UTC(2026, 9, d, h, m)
    const out = dedupeOverlapping([
      { start: t(5, 8, 4), end: t(6, 9), startPct: 100, endPct: 1 },      // sweep
      { start: t(5, 8, 0), end: t(6, 9), startPct: 100, endPct: 1 },      // import
      { start: t(3, 6, 1), end: t(3, 20), startPct: 100, endPct: 20 },
      { start: t(3, 6, 5), end: t(3, 20), startPct: 100, endPct: 20 },
      { start: t(6, 10), end: t(6, 22), startPct: 100, endPct: 30 },        // next run, starts after the 5 Oct one ends
    ])
    want(out.length === 3, `kept ${out.length}`)
    want(out[1].start === t(5, 8, 0) && out[0].start === t(3, 6, 1), 'kept the longer copy')
  })
  check('device page: whole history for one serial', () => {
    const sn = cycles[0].serial, d = DEV.find((x) => x.serial === sn)
    const h = renderToString(<DeviceView serial={sn} d={d} cycles={cycles} onOpenTest={nop} />)
    const n = cycles.filter((c) => c.serial === sn).length
    want(h.includes(`Every cycle on ${sn}`) && h.includes('Tests it has run'), 'sections missing')
    want((h.split(`Every cycle on ${sn}`)[2] || h.split(`Every cycle on ${sn}`)[1]).match(/<tr/g).length - 1 >= n, `fewer than ${n} run rows`)
    want(renderToString(<DeviceView serial="NOPE" d={undefined} cycles={cycles} onOpenTest={nop} />).replace(/<!-- -->/g, '').includes('No device NOPE'), 'unknown serial')
  })
  check('all tests: lifetime tile shows the average per device', () => {
    const lt = { value: 100, devices: 4, rows: [], missing: [] }
    const h = renderToString(<T7Overview cycles={covered} testType="__all__" allSerials={all} onPickTestType={nop} onFilter={nop} lifetime={lt} />).replace(/<!-- -->/g, '')
    want(h.includes('Average battery cycles') && h.includes('25.00') && !h.includes('average per device'), 'average not shown, or the foot line is back')
  })
  check('drain by battery age: drop ledger and cycle count at a past moment', () => {
    const H = 3600e3, t0 = Date.UTC(2026, 3, 1)
    // two days: 100 -> 20 (80 drained), charge to 100, 100 -> 50 (50 drained)
    const day1 = [[t0, 100], [t0 + 4 * H, 60], [t0 + 8 * H, 20], [t0 + 10 * H, 100]]
    let led = extendLedger(null, day1)
    want(led.cum === 80 && cumAt(led, t0 + 4 * H) === 40, `day 1: ${led.cum}, ${cumAt(led, t0 + 4 * H)}`)
    led = extendLedger(led, [[t0 + 10 * H, 100], [t0 + 24 * H, 100], [t0 + 30 * H, 50]]) // overlap is not counted twice
    want(led.cum === 130, `after day 2: ${led.cum}`)
    want(cumAt(led, t0 - H) === null, 'before the history: unknown')
    led.anchor = [t0 + 30 * H, 1000] // MDM says 10.00 cycles now
    want(lifetimeAt(led, t0 + 30 * H) === 10 && Math.abs(lifetimeAt(led, t0 + 24 * H) - 9.5) < 1e-9 && Math.abs(lifetimeAt(led, t0) - 8.7) < 1e-9, 'counted back from the MDM counter')
    const cyc = (start, rate) => ({ serial: 'A', start, dropPerHr: -rate, testType: 'Restaurant Case' })
    const leds = { A: { ...led, anchor: [t0 + 30 * H, 2500] } } // 25.00 now: 23.7 at t0, 24.5 on day 2
    const out = drainByAge([cyc(t0, 6), cyc(t0 + 24 * H, 7)], leds)
    want(out.marks.join() === '10,20' && out.rows[0].at[20].rate === 6 && out.rows[0].now.rate === 7, JSON.stringify(out.marks))
    // up to the last check-in: newer readings and the snapshot's counter on top of the sweep's file
    const live = liveLedgers(leds, () => [{ timestamp: new Date(t0 + 32 * H).toISOString(), battery_pct: 40 }],
      () => ({ last_seen_at: new Date(t0 + 32 * H).toISOString(), discharge_total_pct: 2510 }))
    want(live.A.cum === 140 && live.A.anchor[1] === 2510 && Math.abs(lifetimeAt(live.A, t0 + 30 * H) - 25) < 1e-9, `live: ${live.A.cum}, ${live.A.anchor}`)
    want(leds.A.cum === 130, 'the stored ledger is left as it was')
  })
  check('drain per 15 minutes: split by load, ads and temperature, in 5-cycle bands', () => {
    const H = 3600e3, M = 60e3, t0 = Date.UTC(2026, 9, 1, 10)
    // 3 h with a load at 12 %/h and 45 °C, then 4 h without at 4 %/h and 38 °C, but with a phone
    // on the pad for 20 min at 5 h; readings every 5 min
    const rows = []; let b = 100
    for (let t = t0; t <= t0 + 7 * H; t += 5 * M) {
      const pad = t < t0 + 3 * H, phone = t >= t0 + 5 * H && t < t0 + 5 * H + 20 * M
      rows.push({ timestamp: new Date(t).toISOString(), battery_pct: b, extra: { charging: false, wlc_status: pad || phone ? 1 : 0, battery_temp_c: pad ? 45 : 38 } })
      b -= pad ? 1 : 1 / 3
    }
    rows.push({ timestamp: new Date(t0 + 7 * H + 5 * M).toISOString(), battery_pct: b + 2, extra: { charging: true } })
    const hs = slotBuckets(rows)
    want(hs.length === 28 && hs[0][2] === 15 && hs[0][3] === 15 && Math.abs(hs[0][1] - 30) <= 1 && hs[0][4] === 450, `slots: ${JSON.stringify(hs.slice(0, 2))}`)
    // the 20-minute phone: its first slot (5:00-5:15) is a load slot, the one after 6:00 is not
    want(hs[20][3] === 15 && hs[24][3] === 0, `phone slots: ${JSON.stringify([hs[20], hs[21], hs[24]])}`)
    want(extendSlots(hs.slice(0, 12), rows.slice(30)).length === 28, 'extended from the first new slot (2:30), the stored ones before it kept')
    const drops = { A: { from: t0, pts: [[t0, 0], [t0 + 7 * H, 60]], last: [t0 + 7 * H, 40], cum: 60, anchor: [t0 + 7 * H, 1060] } } // 10.6 cycles now -> ~10 at start
    const tg = tagSlots([{ serial: 'A', start: t0, end: t0 + 7 * H, testType: 'Restaurant Case' }], { A: { h: hs } }, drops)
    const on = drainBands(tg, { load: 'on' }).rows[0].at[10], off = drainBands(tg, { load: 'off' }).rows[0].at[10]
    want(Math.abs(on.rate - 11.4) < 1 && Math.abs(off.rate - 4) < 0.5, `load ${on?.rate} / no load ${off?.rate}`)
    want(drainBands(tg, { ads: 'on' }).rows.length === 1 && !drainBands(tg, { ads: 'off' }).rows.length, 'restaurant case = ads running')
    want(drainBands(tg, { temp: 'hot' }).rows[0].at[10].rate > 11, 'hot slots are the loaded ones')
    const cb = conditionBands(tg)
    want(cb.marks.join() === '10' && cb.rows.find(r => r.label === 'No load').at[10].rate < 5, JSON.stringify(cb.marks))
    want(!Object.keys(tagSlots([], { A: { h: hs } }, drops)).length, 'time outside a test does not count')
    // one cycle split by the pad: 3 h with a load (+ the phone's slot), 4 h without
    const ps = padSplit(hs, t0, t0 + 7 * H)
    want(Math.abs(ps.on.rate - 11.4) < 1 && Math.abs(ps.on.hours - 3.25) < 0.01 && Math.abs(ps.off.rate - 4) < 0.5, `pad split ${JSON.stringify(ps)}`)
    want(padSplit(hs, t0, t0 + 2 * H).off === null, 'no time without a load: —')
    // the lab's sheet: names an Old cycle's test, and counts a run the detector did not
    const old = [{ serial: 'A', start: t0, end: t0 + 7 * H, testType: 'Old cycles' }]
    const sheet = [{ serial: 'A', start: t0, end: t0 + 7 * H, test: 'Restaurant Case', pad: true }]
    want(drainBands(tagSlots(old, { A: { h: hs } }, drops), { ads: 'on' }).rows.length === 0, 'an Old cycle: ads not known')
    want(drainBands(tagSlots(old, { A: { h: hs } }, drops, sheet), { ads: 'on' }).rows.length === 1, 'the sheet names its test')
    want(drainBands(tagSlots([], { A: { h: hs } }, drops, sheet), { test: 'Restaurant Case' }).rows.length === 1, 'a sheet run counts on its own')
    const planned = [{ ...old[0], testType: 'Ads only' }]
    want(tagSlots(planned, { A: { h: hs } }, drops, sheet).A.every(s => s.f.test === 'Ads only'), 'the Cycle plan wins over the sheet')
    // July firmware: no pad reported. In a sheet run the load comes from the test (first 3 h);
    // outside one, a fast slot without a reported load is "not known"
    const noPad = hs.map(x => [x[0], x[1], x[2], 0, x[4]])
    const tj = tagSlots([], { A: { h: noPad } }, drops, [{ ...sheet[0], pad: false }]).A
    want(tj.filter(s => s.f.load).length === 12 && tj.filter(s => s.f.load === false).length === 16, `load from the test: ${tj.map(s => s.f.load).join()}`)
    const tu = tagSlots(old, { A: { h: noPad } }, drops).A
    want(tu.filter(s => s.f.load === null).length === 12 && drainBands(tagSlots(old, { A: { h: noPad } }, drops), { load: 'off' }).rows[0].at[10].rate < 5, 'fast slots without a reported load: not known')
  })
  check('auto plan: the test told from the readings, and how it goes into the plan', () => {
    const H = 3600e3, M = 60e3, day = (d, h) => new Date(2026, 9, d, h).getTime()
    // one device's readings every 5 min: pad on for padH hours, rate1 %/h on the pad, rate2 after;
    // ends back on charge after `hours`, or powered off at 0 % (silence)
    const dev = (t0, { padH = 0, rate1 = 4, rate2 = 4, hours = 30, charge = false }) => {
      const rows = []; let b = 100
      for (let t = t0; t <= t0 + hours * H && b > 0; t += 5 * M) {
        rows.push({ timestamp: new Date(t).toISOString(), battery_pct: Math.round(b), extra: { charging: false, wlc_status: t - t0 < padH * H ? 1 : 0 } })
        b -= ((t - t0 < padH * H ? rate1 : rate2) * 5) / 60
      }
      if (charge) rows.push({ timestamp: new Date(t0 + hours * H + 5 * M).toISOString(), battery_pct: Math.round(b) + 1, extra: { charging: true, wlc_status: 0 } })
      return rows
    }
    const bench = (t0, o, now = t0 + 40 * H) => benchesFrom({ A: runsFrom(dev(t0, o), now), B: runsFrom(dev(t0 + 10 * M, o), now), C: runsFrom(dev(t0 + 20 * M, o), now) })[0]
    const kind = (o, now) => { const t0 = day(1, 10), b = bench(t0, o, now ?? t0 + 40 * H); return classifyBench(b, now ?? t0 + 40 * H) }
    want(kind({ padH: 3, rate1: 12, rate2: 4, hours: 14, charge: true }).tt === 'restaurant', 'restaurant case')
    want(kind({ padH: 3, rate1: 12, rate2: 4 }).tt === 'wlc_disch', 'wlc + discharge on ads (runs to power-off)')
    want(kind({ padH: 30, rate1: 11 }).tt === 'wlc_load', 'wlc on load (~9 h to empty)')
    want(kind({ padH: 30, rate1: 9.5 }).tt === 'load_only', 'load only (~10.5 h to empty)')
    want(kind({ rate2: 4 }).tt === 'disch_ads', 'ads only')
    want(kind({ rate2: 0.8, hours: 12, charge: true }).tt === null, 'idle is not a test')
    // while running: too early at 2 h, Restaurant Case (not final) at 6 h
    const t0 = day(1, 10), rc = { padH: 3, rate1: 12, rate2: 4, hours: 6 }
    want(classifyBench(bench(t0, { ...rc, hours: 2 }, t0 + 2 * H), t0 + 2 * H).tt === null, 'too early')
    const live = classifyBench(bench(t0, rc, t0 + 6 * H), t0 + 6 * H)
    want(live.tt === 'restaurant' && !live.final, `running: ${JSON.stringify(live)}`)
    // 16 Oct 2026: load off at 3.4 h, seen at 4.8 h — 71 % of the run so far, but off now: not WLC on Load
    const early = classifyBench(bench(t0, { ...rc, padH: 3.4, hours: 4.8 }, t0 + 4.8 * H), t0 + 4.8 * H)
    want(early.tt === 'restaurant', `load off at 3.4 h: ${JSON.stringify(early)}`)
    want(classifyBench(bench(t0, { padH: 30, rate1: 11, hours: 4 }, t0 + 4 * H), t0 + 4 * H).tt === null, 'load on 4 h, still on: too early')
    // two devices left off the charger, idle at ~1 %/h, still "running": the bench is over all the same
    const day16 = benchesFrom({ ...Object.fromEntries(['A', 'B', 'C'].map((s, i) => [s, runsFrom(dev(t0 + i * 10 * M, { ...rc, hours: 14, charge: true }), t0 + 19 * H)])),
      D: runsFrom(dev(t0, { rate2: 1, hours: 19 }), t0 + 19 * H), E: runsFrom(dev(t0, { rate2: 1, hours: 19 }), t0 + 19 * H) })[0]
    const c16 = classifyBench(day16, t0 + 19 * H)
    want(c16.tt === 'restaurant' && c16.final, `idle devices still running: ${JSON.stringify(c16)}`)
    // the T7 reports "charging" on the pad for an hour while its battery falls: one run, not two
    const flick = dev(t0, { ...rc, hours: 14, charge: true }).map(r => {
      const m = (Date.parse(r.timestamp) - t0) / M
      return m >= 60 && m < 120 ? { ...r, extra: { ...r.extra, charging: true } } : r
    })
    const fr = runsFrom(flick, t0 + 20 * H)
    want(fr.length === 1 && fr[0].durH > 13 && fr[0].ended === 'charge', `charging flag on the pad: ${JSON.stringify(fr)}`)
    // put on charge at 20 % and holding there a while before it rises: the run has ended (20 Oct 2026)
    const held = dev(t0, { ...rc, hours: 14 }).concat([1, 2, 3, 4].map((k) => ({ timestamp: new Date(t0 + 14 * H + k * 5 * M).toISOString(), battery_pct: 19, extra: { charging: true, wlc_status: 0 } })))
    const hr = runsFrom(held, t0 + 14 * H + 25 * M)
    want(hr.length === 1 && hr[0].ended === 'charge', `on charge, level holding: ${JSON.stringify(hr.map((r) => r.ended))}`)

    // into the plan
    const done = bench(day(2, 10), { padH: 3, rate1: 12, rate2: 4, hours: 14, charge: true }, day(3, 12))
    const now = day(3, 12), mine = { id: 'D-1', at: day(1, 9), repeat: 'none', testType: 'wlc_load', from: '2026-10-02', to: '2026-10-02', startTime: '10:00', endTime: '23:00', group: { kind: 'all' }, by: 'Ali' }
    let r = applyAuto([mine], [done], { now, from: 0 })
    const got = r.decls[0]
    want(r.decls.length === 1 && got.testType === 'restaurant' && got.auto.was.testType === 'wlc_load' && got.auto.was.by === 'Ali', `replaced: ${JSON.stringify(got)}`)
    r = applyAuto(r.decls, [done], { now, from: 0, state: r.state })
    want(!r.changes.length, 'a second sweep changes nothing')
    // a person edits it back (the form drops `auto`): Auto leaves it alone
    const edited = r.decls.map(d => ({ ...d, testType: 'wlc_load', auto: undefined }))
    want(!applyAuto(edited, [done], { now, from: 0, state: r.state }).changes.length, 'a person\'s correction stays')
    // nothing planned: added as Auto, for the bench's devices; deleted -> not put back
    r = applyAuto([], [done], { now, from: 0 })
    const a = r.decls[0]
    want(a.auto && a.by === 'Auto' && a.testType === 'restaurant' && a.from === '2026-10-02' && a.group.serials.join() === 'A,B,C', `added: ${JSON.stringify(a)}`)
    want(!applyAuto([], [done], { now, from: 0, state: r.state }).decls.length, 'deleted Auto entry is not re-added')
    // a person's entry for a test the readings can't tell (WLC on Phone) is never replaced
    want(!applyAuto([{ ...mine, testType: 'wlc_phone' }], [done], { now, from: 0 }).changes.length, 'wlc on phone kept')
  })
  check('iPhone on the pad: typed readings merge per cell, gains per hour', () => {
    const d = '2026-10-27'
    let db = mergePhone({}, cleanPhone({ devices: { [`${d}|AT070AABU00231`]: { on: true, mod: 1 } },
      cells: { [`${d}|AT070AABU00231|0`]: { pct: 20, mod: 1 }, [`${d}|AT070AABU00231|1`]: { pct: 45, mod: 1 }, [`${d}|AT070AABU00231|3`]: { pct: 100, mod: 1 },
        [`${d}|AT070AABU00231|2`]: { pct: 140, mod: 1 }, 'bad key': { pct: 5, mod: 1 } } }))
    want(Object.keys(db.cells).length === 3, 'out-of-range and bad keys dropped')
    // an older edit never overwrites a newer one; a newer one does
    db = mergePhone(db, { cells: { [`${d}|AT070AABU00231|1`]: { pct: 10, mod: 0 } } })
    want(db.cells[`${d}|AT070AABU00231|1`].pct === 45, 'older edit ignored')
    want(phoneDevices(db, d).join() === 'AT070AABU00231' && !phoneDevices(db, '2026-10-26').length, 'devices per cycle day')
    const p = phoneHours(db, d, 'AT070AABU00231', 3)
    want(p.rows[1].gain === 25 && p.rows[2].gain == null && p.rows[3].gain === 55 && p.rows[3].per === 27.5, 'gain from the last entry')
    want(p.total === 80 && Math.abs(p.perH - 80 / 3) < 1e-9 && p.fullAt === 3, 'total, per hour, full at')
  })
  check('csv per hour: each device\'s cycle hour by hour, with the pad\'s load minutes', () => {
    const t0 = Date.UTC(2026, 9, 17, 9), H = 3600e3
    // 2.5 h: 100 -> 88 in the first hour (load), then 4 %/h
    const c = (serial) => ({ serial, testType: 'Restaurant Case', date: '2026-10-17', start: t0, end: t0 + 2.5 * H, duration: 2.5,
      series: [{ t: 0, v: 100 }, { t: 1, v: 88 }, { t: 2, v: 84 }, { t: 2.5, v: 82 }], tempSeries: [{ t: 0.5, v: 45 }, { t: 1.5, v: 38 }] })
    const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => [t0 + k * 900e3, 30, 15, k < 4 ? 15 : 0, 400])
    const lines = cycleHoursCsv([c('B'), c('A')], { slotsOf: (sn) => (sn === 'A' ? slots : null) }).trim().split('\r\n')
    want(lines.length === 7 && lines[1].startsWith('A,') && lines[4].startsWith('B,'), `rows / order: ${lines.length}`)
    const f = lines[1].split(','), last = lines[3].split(',')
    want(f[4] === '100' && f[5] === '12' && f[6] === '60' && f[7] === '45', `hour 1: ${lines[1]}`)
    want(lines[0].includes(',Battery %,') && !lines[0].includes('at start'), `one battery column: ${lines[0]}`)
    want(!lines[0].includes('%/h') && !lines[0].includes('From') && !lines[0].includes('Cycle started') && lines[0].startsWith('Device,Test,Date,Time,Battery %,') && !lines[0].includes('Hour') && !lines[0].includes('Minutes'), `columns: ${lines[0]}`)
    want(f[3] !== lines[2].split(',')[3], `Time steps by the hour: ${f[3]} then ${lines[2].split(',')[3]}`)
    want(last[5] === '2' && last[6] === '0', `last half hour: ${lines[3]}`)
    want(lines[4].split(',')[6] === '', 'no slots: load minutes blank')
  })
  check('csv: escaping, gap rows dropped, extra fields, cycles', () => {
    want(csvField('a,b') === '"a,b"' && csvField('say "hi"') === '"say ""hi"""' && csvField('=SUM(A1)') === "'=SUM(A1)" && csvField(-3) === '-3', 'escaping')
    const rows = [
      { serial_number: 'A', sample_at: '2026-10-09T10:00:00Z', battery_pct: 80, build_id: 'v2', extra: { battery_temp_c: 31.5, charging: false, wlc_status: 1, foo: 'x' } },
      { serial_number: 'A', sample_at: '2026-10-09T10:05:00Z', battery_pct: 0, empty: true, extra: {} },
      { serial_number: 'A', sample_at: '2026-10-09T10:10:00Z', battery_pct: 79, extra: '{"battery_temp_c":31.7,"charging":true}' },
    ]
    const csv = readingsCsv(rows, ['serial', 'time_utc', 'battery_pct', 'battery_temp_c', 'charging', 'wlc_status'], true).trim().split('\r\n')
    want(csv.length === 3, `lines ${csv.length}`)
    want(csv[0] === 'Serial,"Time (UTC, ISO)",Battery %,Battery temp °C,Charging,Wireless pad,extra.foo', csv[0])
    want(csv[1] === 'A,2026-10-09T10:00:00Z,80,31.5,no,on,x' && csv[2] === 'A,2026-10-09T10:10:00Z,79,31.7,yes,,', csv.slice(1).join(' | '))
    want(extraKeys(rows).join() === 'foo', 'extra keys')
    const cc = cyclesCsv([{ serial: 'B', testType: 'WLC on Load', start: 1, end: 2, startBattery: 100, endBattery: 20, mdmCycles: null }], ['serial', 'testType', 'batteryCycles', 'cyclesSource']).trim().split('\r\n')
    want(cc[1] === 'B,WLC on Load,0.80,battery drop ÷ 100', cc[1])
    want(estimateRows(24, 0, 86400e3, 300) === 6912, 'estimate')
  })
  check('csv: each reading says which cycle it was in', () => {
    const t = (h) => Date.UTC(2026, 9, 9, h)
    const cyc = [{ serial: 'A', start: t(1), end: t(3), testType: 'Old run' }, { serial: 'A', start: t(10), end: t(20), testType: 'WLC on Load' }]
    const rows = [{ serial_number: 'A', sample_at: new Date(t(12)).toISOString(), battery_pct: 70, extra: {} },
      { serial_number: 'A', sample_at: new Date(t(22)).toISOString(), battery_pct: 40, extra: {} }]
    const l = readingsCsv(rows, ['serial', 'cycle_no', 'cycle_test', 'cycle_hours'], false, cyc).trim().split('\r\n')
    want(l[0] === 'Serial,Cycle #,Cycle test,Hours into cycle', l[0])
    want(l[1] === 'A,2,WLC on Load,2.00' && l[2] === 'A,,,', l.slice(1).join(' | '))
  })
  check('devices running a test together are one cycle', () => {
    const h = 3600e3, at = (d, hh) => Date.UTC(2026, 9, d, hh)
    const bench = Array.from({ length: 17 }, (_, i) => ({ serial: `S${i}`, testType: 'WLC on Load', start: at(8, 10) + i * 60e3 }))
    want(countCycles(bench) === 1 && cyclesText(bench) === '1 cycle', cyclesText(bench))
    const two = [...bench, ...bench.map((c) => ({ ...c, start: c.start + 24 * h }))]
    want(countCycles(two) === 2, `${countCycles(two)} for two days`)
    want(countCycles([{ testType: 'A', start: at(8, 10) }, { testType: 'B', start: at(8, 10) }]) === 2, 'two tests at once are two cycles')
  })
  check('bell: one or two devices that differ from the rest of the running cycle', () => {
    // noon today: a window of now ± 1 h must not cross midnight (the test failed after 23:00 and before 01:00)
    const d = new Date(), now = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const hhmm = (t) => { const x = new Date(t); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}` }
    const decl = { id: 'D-T', at: 1, repeat: 'none', testType: 'wlc_load', from: key, to: key, group: { kind: 'all' }, startTime: hhmm(now - 60 * 60e3), endTime: hhmm(Math.min(now + 60 * 60e3, new Date(key + 'T23:59').getTime())) }
    const dev = (sn, o = {}) => ({ serial: sn, snap: { last_seen_at: new Date(now - (o.silent ? 3600e3 : 30e3)).toISOString(), charging: !!o.charging,
      battery_pct: o.pct ?? 70, battery_temp_c: o.temp ?? 38, extra: { wlc_status: o.load === false ? 0 : 1, wlc_charging: true } } })
    const kinds = (devs) => findOddOnes([decl], devs, now).odd.map((o) => `${o.serial}:${o.kind}`).sort().join(' ')
    const base = ['A', 'B', 'C', 'E', 'F'].map((sn) => dev(sn))
    want(kinds([...base, dev('D', { charging: true })]) === 'D:charging:on', kinds([...base, dev('D', { charging: true })]))
    want(kinds([...base, dev('D', { load: false })]) === 'D:wlc-load:off', 'no load while the rest have one')
    want(kinds([...base, dev('D', { silent: true })]) === 'D:silent', 'stopped reporting')
    want(kinds([...base, dev('D', { pct: 40 })]) === 'D:battery:low', 'battery far below the rest')
    want(kinds([...base, dev('D', { temp: 52 })]) === 'D:hot', 'running hot')
    want(kinds(base) === '', 'all alike: nothing')
    // half the cycle differing is not "one or two odd ones"
    want(kinds([...base.slice(0, 3), dev('X', { charging: true }), dev('Y', { charging: true }), dev('Z', { charging: true })]) === '', 'a split is not an outlier')
    const f = findOddOnes([decl], [...base, dev('D', { charging: true })], now)
    let log = mergeAlerts([], f, now)
    want(log.length === 1 && !log[0].read && !log[0].resolvedAt && log[0].title === 'on charge', 'raised unread')
    log = mergeAlerts(log, f, now + 30e3)
    want(log.length === 1, 'not raised twice')
    log = mergeAlerts(log, { ...f, odd: [] }, now + 60e3)
    want(log[0].resolvedAt === now + 60e3, 'resolved when it falls back in line')
    // the next cycle clears the last one's; with no cycle running, the next day does
    const next = { ...f, cyc: { ...f.cyc, startMs: f.cyc.startMs + 6 * 3600e3, decl: { ...f.cyc.decl, id: 'D-next' } }, odd: [] }
    want(mergeAlerts(log, next, now + 6 * 3600e3).length === 0, 'next cycle clears the previous one\'s')
    want(mergeAlerts(log, null, now + 60e3).length === 1, 'kept for the rest of the day with no cycle running')
    want(mergeAlerts(log, null, now + 2 * 86400e3).length === 0, 'gone the next day')
  })
  check('Restaurant Case: complete within 30 min of 14 h, else a short cycle (table, average, bell)', () => {
    const d = new Date(), now = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const hhmm = (t) => { const x = new Date(t); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}` }
    const decl = { id: 'D-R', at: 1, repeat: 'none', testType: 'restaurant', from: key, to: key, group: { kind: 'all' }, startTime: hhmm(now - 3 * 3600e3), endTime: '23:59' }
    const dev = (sn, charging) => ({ serial: sn, snap: { last_seen_at: new Date(now - 30e3).toISOString(), charging, battery_pct: 70, battery_temp_c: 38, extra: { wlc_status: 1, wlc_charging: true } } })
    const all = findOddOnes([decl], ['A', 'B', 'C', 'D'].map((sn) => dev(sn, true)), now).odd.map((o) => o.kind)
    want(all.length === 4 && all.every((k) => k === 'short'), `the whole bench back on charge 3 h in: ${all}`)
    const one = findOddOnes([decl], [dev('A', true), dev('B', false), dev('C', false), dev('D', false)], now).odd.map((o) => `${o.serial}:${o.kind}`)
    want(one.join() === 'A:short', `one device, once (not also "on charge"): ${one}`)
    // the cycle time: 13.9 h counts as 14, 12 h is short and stays out of the average
    want(kpis([{ duration: 14, short: false }, { duration: 14.5, short: false }, { duration: 12, short: true }]).avgDuration === 14.25, 'short runs out of the average')
    // ads stopped: the host app off screen 5+ min in a test that runs ads, on battery
    const ha = new Map([['A', { state: 'off_screen', why: 'screen_off', since: new Date(now - 20 * 60e3).toISOString() }],
      ['B', { state: 'on_screen', why: 'app_in_foreground', since: new Date(now - 3 * 3600e3).toISOString() }],
      ['C', { state: 'off_screen', why: 'app_not_in_foreground', since: new Date(now - 2 * 60e3).toISOString() }]])
    const ads = findOddOnes([decl], ['A', 'B', 'C', 'D'].map((sn) => dev(sn, false)), now, ha).odd.map((o) => `${o.serial}:${o.kind}`)
    want(ads.join() === 'A:ads:off', `screen off 20 min = ads stopped; 2 min, on screen or not reported = nothing: ${ads}`)
    // 20 of 24 ran the cycle, 4 were taken out at 4 h: the averages are the 20's (the lab, 21 Oct 2026)
    const bench = [...Array.from({ length: 20 }, () => ({ duration: 14, endBattery: 20, dropPerHr: 5.7, maxTemp: 52 })),
      ...Array.from({ length: 4 }, () => ({ duration: 4, endBattery: 65, dropPerHr: 8.8, maxTemp: 45, incomplete: true }))]
    const k = kpis(bench)
    want(k.avgDuration === 14 && k.avgEndBattery === 20 && Math.abs(k.avgDropPerHr - 5.7) < 1e-9 && k.avgPeakTemp === 52, JSON.stringify(k))
  })
  await checkAsync('a data file: retried, then ok / missing / failed (the page shows each)', async () => {
    const real = globalThis.fetch, calls = []
    const answer = (list) => { globalThis.fetch = async (url) => { calls.push(url); const a = list.shift(); if (a === 'net') throw new Error('Failed to fetch'); return { ok: a === 200, status: a, json: async () => ({ curves: { k: 1 } }) } } }
    try {
      answer(['net', 500, 200]); await loadPart('curves', 1)
      want(getSnapshot().parts.curves.state === 'ok' && getSnapshot().curves?.k === 1 && calls.length === 3, `ok on the 3rd try: ${JSON.stringify(getSnapshot().parts.curves)}`)
      answer(['net', 'net', 'net']); await loadPart('curves', 1)
      want(getSnapshot().parts.curves.state === 'error' && getSnapshot().curves?.k === 1, 'failed 3 times: error, and the copy loaded before is kept')
      answer([404]); await loadPart('hours', 1)
      want(getSnapshot().parts.hours.state === 'missing', 'not written yet')
    } finally { globalThis.fetch = real }
  })
  check('host app: spans merged, a run\'s time on screen, ads stopped (and the test screen draws it)', () => {
    const t = (h, m = 0) => Date.UTC(2026, 9, 24, h, m), iso = (x) => new Date(x).toISOString()
    const api = (list) => list.map(([a, b, state, why]) => ({ from: iso(a), to: iso(b), state, why }))
    // stored: 00–05 screen off, 05–12 on; fresh window from 10:00: on until 13:00, then another app 13:00–13:40, on again
    const old = compactSpans(api([[t(0), t(5), 'off_screen', 'screen_off'], [t(5), t(12), 'on_screen', 'app_in_foreground']]))
    const fresh = compactSpans(api([[t(10), t(13), 'on_screen', 'app_in_foreground'], [t(13), t(13, 40), 'off_screen', 'app_not_in_foreground'], [t(13, 40), t(20), 'on_screen', 'app_in_foreground']]))
    const m = mergeSpans(old, fresh)
    want(m.length === 4 && m[1][0] === t(5) && m[1][1] === t(13) && m[2][2] === 'app', `merged: ${JSON.stringify(m.map((x) => [new Date(x[0]).getUTCHours(), new Date(x[1]).getUTCHours(), x[2]]))}`)
    const st = screenTime(m, t(5), t(19))
    want(st && Math.abs(st.onPct - 95.2) < 0.1 && st.longestOff.min === 40 && st.longestOff.why === 'app', JSON.stringify(st))
    want(adsGap(st) && !adsGap(screenTime(m, t(5), t(12))), '40 min off = ads stopped; none off = fine')
    want(screenTime(m, t(21), t(22)) === null, 'nothing known: null')
    // the Restaurant Case screen with host-app data: the tile and the column draw
    const rc = cycles.filter((c) => c.testType === 'Restaurant Case').slice(0, 6)
      .map((c, i) => ({ ...c, screen: { ...st, onPct: i ? 99 : 70 }, adsGap: i === 0 }))
    const h = renderToString(<TestDetail cycles={rc} testType="Restaurant Case" allSerials={all} />).replace(/<!-- -->/g, '')
    want(h.includes('Ads on screen') && h.includes('1 with ads stopped') && h.includes('70%'), 'tile and column on the test screen')
  })
  check('wireless pad: -1 is not a load, a lone reading with a load is a blip (idle 00485 / 00606, 19 Oct)', () => {
    want(padLoad(2) === true && padLoad('1') === true && padLoad(0) === false && padLoad(-1) === false && padLoad(null) === null, 'padLoad')
    const t0 = Date.UTC(2026, 9, 19, 5), row = (min, wlc) => ({ timestamp: new Date(t0 + min * 60e3).toISOString(), battery_pct: 40, extra: { charging: false, wlc_status: wlc } })
    const minutes = (rows) => slotBuckets(rows).reduce((a, x) => a + x[3], 0)
    want(minutes([0, 3, 6, 9, 12].map((m, i) => row(m, [0, 0, 2, 0, 0][i]))) === 0, 'a lone 2 between 0s: no load')
    want(minutes([0, 3, 6, 9, 12].map((m, i) => row(m, [0, -1, -1, 0, 0][i]))) === 0, '-1: no load')
    want(minutes([0, 3, 6, 9, 12].map((m, i) => row(m, [0, 2, 2, 2, 0][i]))) === 9, 'a real load still counts')
  })
  check('Today: drain split into WLC active / inactive / ads only', () => {
    const t0 = Date.UTC(2026, 9, 21, 5), row = (min, pct, wlc) => ({ timestamp: new Date(t0 + min * 60e3).toISOString(), battery_pct: pct, extra: { charging: false, wlc_status: wlc } })
    // 1 h with a load at 12 %/h (a reading every 10 min), then 1 h without at 4 %/h
    const rows = [...Array.from({ length: 7 }, (_, i) => row(i * 10, 100 - 2 * i, i < 6 ? 1 : 0)), ...Array.from({ length: 6 }, (_, i) => row(70 + i * 10, 88 - (2 * (i + 1)) / 3, 0))]
    const x = drainSplit(rows, { t: t0, pct: 100 })
    want(Math.abs(x.active - 12) < 0.01 && x.inactive === null && Math.abs(x.ads - 4) < 0.01, JSON.stringify(x))
    want(drainSplit(rows.slice(0, 3), { t: t0, pct: 100 }).ads === null, 'under 20 min in a state -> null')
  })
  check('off charger = when charging went off, not the last 100% reading', () => {
    const at = (h, m) => new Date(Date.UTC(2026, 9, 12, h, m)).toISOString()
    const row = (h, m, pct, charging) => ({ timestamp: at(h, m), battery_pct: pct, extra: { charging } })
    // 875 on 12 Oct: on charge at 100%, unplugged 09:46, still 100% until 10:14
    const rows = [row(9, 30, 100, true), row(9, 40, 100, true), row(9, 46, 100, false), row(10, 0, 100, false), row(10, 10, 100, false), row(10, 14, 98, false), row(10, 22, 97, false)]
    const s = runStartOf(rows)
    // dated from the last check-in on charge (09:40); the first one off (09:46) is kept beside it
    want(s && s.t === Date.parse(at(9, 40)) && s.firstOff === Date.parse(at(9, 46)) && s.pct === 100, s ? new Date(s.t).toISOString() : 'null')
    // no charging flag at all: falls back to the last reading at the peak
    const bare = rows.map((r) => ({ ...r, extra: {} }))
    want(runStartOf(bare).t === Date.parse(at(10, 10)), 'fallback to the last peak reading')
    // just unplugged, still at 100%: the run starts at the switch-off, no 2-point drop needed
    const fresh = [row(9, 50, 100, true), row(9, 55, 100, true), row(10, 0, 100, true), row(10, 1, 100, false), row(10, 3, 100, false)]
    const f = runStartOf(fresh)
    want(f && f.t === Date.parse(at(10, 0)) && f.firstOff === Date.parse(at(10, 1)), 'switch-off without a drop')
    want(runStartOf(fresh.slice(0, 3)) === null, 'still on charge: no run')
  })
  check('take-out reasons: the fixed list only, notes are never added to it', () => {
    const r = takeOutReasons()
    want(r[0] === 'Testing FW' && r[r.length - 1] === 'Other' && r.length === 8 && !r.includes('-'), r.join(' | '))
  })
  check('the Cycles drop-down lists each bench cycle with its devices', () => {
    const at = (d, hh) => Date.UTC(2026, 9, d, hh)
    const day = (d, n) => Array.from({ length: n }, (_, i) => ({ serial: `S${i}`, testType: 'WLC on Load', start: at(d, 10) + i * 60e3 }))
    const b = benchCycles([...day(9, 6), ...day(8, 17)])
    want(b.length === 2 && b[0].list.length === 17 && b[1].list.length === 6 && b[0].start < b[1].start, b.map((x) => x.list.length).join(','))
    want(b.length === countCycles([...day(9, 6), ...day(8, 17)]), 'same count as the tile')
  })
  check('one test: the first tile is that test\'s cycles, not the lifetime total', () => {
    const tt = covered[0].testType, mine = covered.filter((c) => c.testType === tt)
    const h = renderToString(<TestDetail cycles={mine} testType={tt} allSerials={all} lifetime={{ value: 1823.03, devices: 18, rows: [], missing: [] }} />).replace(/<!-- -->/g, '')
    want(!h.includes('1,823.03') && h.includes('>Cycles<'), 'lifetime still shown')
    want(h.includes(`>${countCycles(mine).toLocaleString('en-US')}<`), 'cycle count missing')
  })
  check('a WLC run that went on charge at 7% after 7.5 h is a cycle', () => {
    const h = 3600e3, t0 = Date.UTC(2026, 9, 9, 8)
    const r = reclassify([], [
      { start: t0, end: t0 + 7.5 * h, durationMs: 7.5 * h, startPct: 100, endPct: 7, reason: 'recharged' },
      { start: t0 + 24 * h, end: t0 + 31 * h, durationMs: 7 * h, startPct: 100, endPct: 13, reason: 'offline' },
      { start: t0 + 48 * h, end: t0 + 52 * h, durationMs: 4 * h, startPct: 100, endPct: 60, reason: 'recharged' },
    ], {})
    want(r.cycles.length === 2 && r.interrupted.length === 1, `cycles ${r.cycles.length}, interrupted ${r.interrupted.length}`)
  })
  check('range picker lists test dates', () => {
    const d = new Date(2026, 9, 6).getTime()
    const h = renderToString(<RangePicker value={null} onChange={nop} daysWithRuns={new Map([[d, 24]])} />)
    want(h.includes('All dates'), 'trigger')
  })
  check('date list renders its amounts', () => {
    const dates = [...new Set(covered.map(c => c.date))].sort().slice(-5)
    const h = renderToString(<DateList dates={dates} counts={new Map(dates.map(d => [d, 3]))} value="" maxCount={3} onPick={nop} onClear={nop}
      amount={(d) => splitText(covered.filter(c => c.date === d))} />)
    want(h.includes('cycles (MDM)'), 'list shows no MDM amounts')
  })
  check('health: baseline falls back to the fleet below 5 runs, indices cap at 100', () => {
    const run = (sn, i, h, extra = {}) => ({ serial: sn, testType: 'T', start: Date.UTC(2026, 8, 1 + i), end: Date.UTC(2026, 8, 1 + i) + h * 3600e3, fullMs: h * 3600e3, startBattery: 100, endBattery: 20, ...extra })
    // A: 6 runs 20 h then 16 h (-> 80); B: 3 runs of 30 h, baseline from the fleet
    const cycles = [...[20, 20, 20, 20, 20, 16, 16, 16].map((h, i) => run('A', i, h)), ...[30, 30, 30].map((h, i) => run('B', i, h))]
    const out = healthRows({ cycles, testType: 'T', devices: [{ serial: 'A', lifetime: 10 }, { serial: 'B', lifetime: 5 }], now: Date.UTC(2026, 8, 20) })
    const A = out.rows.find((r) => r.serial === 'A'), B = out.rows.find((r) => r.serial === 'B')
    want(A.capacity.classes.unknown.source === 'device' && A.capacity.index === 80 && A.capacity.classes.unknown.baseline === 20 * 3600e3, `A capacity ${A.capacity.index} ${JSON.stringify(A.capacity.classes)}`)
    want(B.capacity.classes.unknown.source === 'fleet' && out.fleetBaseline.unknown === 20 * 3600e3 && B.capacity.index === 100, `B capacity ${B.capacity.index} ${JSON.stringify(B.capacity.classes)}, fleet ${JSON.stringify(out.fleetBaseline)}`)
    want(A.early.index === null && A.score === Math.round(0.7 * 80 + 0.3 * A.stress.index), `no curves: early null, score ${A.score} vs reweighted`)
    want(out.rows[0].serial === 'A', 'worst first')
    want(healthRows({ cycles: cycles.slice(0, 2), testType: 'T', devices: [{ serial: 'A' }] }).rows[0].grade === GRADE.few, '2 runs -> not enough')
  })
  check('health: early drain from the curve, null below 3 curves and the weight moves', () => {
    const curve = (d) => [{ t: 0, v: 100 }, { t: 0.5, v: 100 - d / 2 }, { t: 1.5, v: 100 - d * 1.5 }, { t: 3, v: 100 - 3 * d }]
    const run = (i, d) => ({ serial: 'A', testType: 'T', start: i, fullMs: 20 * 3600e3, startBattery: 100, series: d == null ? [] : curve(d) })
    want(earlyDrain(run(0, 6)) === 6, `interpolated ${earlyDrain(run(0, 6))}`)
    want(earlyDrain({ startBattery: 100, series: [{ t: 0, v: 100 }, { t: 0.5, v: 98 }] }) === null, 'curve short of 1 h')
    want(earlyDrain({ startBattery: 100, series: [{ t: 0, v: 100 }, { t: 0.5, v: 100 }, { t: 1.5, v: 100 }, { t: 3, v: 90 }] }) === null, 'flat first hour: not a measurable start')
    const e = earlyIndex([run(0, 4), run(1, 4), run(2, 4), run(3, 4), run(4, 4), run(5, 8), run(6, 8), run(7, 8)])
    want(e.index === 50 && e.classes.unknown.baseline === 4 && e.current === 0.5, `early ${e.index} ${JSON.stringify(e.classes)} ${e.current}`)
    want(earlyIndex([run(0, 8), run(1, 8), run(2, 4)], { unknown: 8 }).index === 100, 'slower now than at first caps at 100 (fleet baseline below 5 runs)')
    want(earlyIndex([run(0, 8), run(1, 8), run(2, 4)]).index === null, 'below 5 runs and no fleet baseline: nothing to compare with')
    want(earlyIndex([run(0, 4), run(1, 4), run(2, null), run(3, null)]).index === null, '2 curves: null')
    want(scoreOf(80, null, 100) === 86 && Math.abs(scoreOf(80, 50, 100) - 83) < 1e-9 && scoreOf(null, 50, 100) === null, 'reweighting')
  })
  check('health: a run is judged against its own load class — ads at 4 %/h vs pad + ads at 13 %/h', () => {
    const curve = (d) => [{ t: 0, v: 100 }, { t: 1, v: 100 - d }, { t: 3, v: 100 - 3 * d }]
    const run = (sn, i, h, pad, d) => ({ serial: sn, testType: 'T', start: Date.UTC(2026, 8, 1 + i), fullMs: h * 3600e3, startBattery: 100, endBattery: 20, padKnown: true, padState: pad ? 'Pad on (wireless charging)' : 'Pad off', series: curve(d) })
    want(loadClass(run('A', 0, 1, true, 1)) === 'load' && loadClass(run('A', 0, 1, false, 1)) === 'none' && loadClass({ padKnown: false }) === 'unknown', 'load class')
    // A: 5 no-load runs of 24 h at 4 %/h, then 3 pad-loaded runs of 8 h at 13 %/h — not a fade
    const A = [...[0, 1, 2, 3, 4].map((i) => run('A', i, 24, false, 4)), ...[5, 6, 7].map((i) => run('A', i, 8, true, 13))]
    // B and C give the fleet its pad-loaded baseline: 8 h, 13 %/h
    const fleet = [...[0, 1, 2].map((i) => run('B', i, 8, true, 13)), ...[0, 1, 2].map((i) => run('C', i, 8, true, 13))]
    const out = healthRows({ cycles: [...A, ...fleet], testType: 'T', devices: ['A', 'B', 'C'].map((serial) => ({ serial, lifetime: 1 })), now: Date.UTC(2026, 8, 20) })
    const a = out.rows.find((r) => r.serial === 'A')
    want(out.fleetBaseline.load === 8 * 3600e3 && out.fleetBaseline.none === 24 * 3600e3, JSON.stringify(out.fleetBaseline))
    want(a.capacity.index === 100 && a.capacity.classes.none.source === 'device' && a.capacity.classes.load.source === 'fleet', `A capacity ${a.capacity.index} ${JSON.stringify(a.capacity.classes)}`)
    want(a.early.index === 100 && a.early.classes.load.baseline === 13, `A early ${a.early.index} ${JSON.stringify(a.early.classes)}`)
    want(a.loads.load === 3 && a.loads.none === 5, JSON.stringify(a.loads))
    // the same device with its last pad-loaded runs at 6 h and 17 %/h IS fading: 75 / 76
    const A2 = [...A.slice(0, 5), ...[5, 6, 7].map((i) => run('A', i, 6, true, 17))]
    const a2 = healthRows({ cycles: [...A2, ...fleet], testType: 'T', devices: ['A', 'B', 'C'].map((serial) => ({ serial, lifetime: 1 })), now: Date.UTC(2026, 8, 20) }).rows.find((r) => r.serial === 'A')
    want(a2.capacity.index === 75 && Math.round(a2.early.index) === 76, `fading: capacity ${a2.capacity.index}, early ${a2.early.index}`)
    // one class only
    const only = healthRows({ cycles: [...A, ...fleet], testType: 'T', devices: [{ serial: 'A' }], now: Date.UTC(2026, 8, 20), load: 'none' }).rows[0]
    want(only.n === 5 && only.loads.load == null, `no-load only: ${only.n} runs`)
    const fb = fleetBaselines(new Map([['A', A]]), earlyDrain)
    want(fb.none === 4 && fb.load === 13, JSON.stringify(fb))
  })
  check('health: stress against the fleet p90, 0 when the fleet p90 is 0', () => {
    const f = [{ lifetime: 10, h40: 1, h45: 0, full: 2, deep: 0 }, { lifetime: 20, h40: 2, h45: 0, full: 4, deep: 0 }, { lifetime: 40, h40: 4, h45: 0, full: 8, deep: 0 }]
    const p90 = fleetP90(f)
    want(p90.lifetime === 40 && p90.h45 === 0, JSON.stringify(p90))
    const s = stressIndex(f[0], p90)
    // loads: 0.25, 0.25, 0 (p90 0), 0.25, 0 -> mean 0.15
    want(Math.abs(s.index - 85) < 1e-9 && s.loads.h45 === 0, `stress ${s.index}`)
    want(stressIndex({ lifetime: 80, h40: 9, h45: 0, full: 9, deep: 0 }, p90).loads.lifetime === 1, 'load capped at 1')
    const at = (m, pct, chg) => ({ timestamp: new Date(Date.UTC(2026, 9, 1, 0, m)).toISOString(), battery_pct: pct, extra: { charging: chg } })
    want(hoursAtFull([at(0, 100, true), at(30, 100, true), at(60, 100, true), at(200, 100, true), at(220, 99, true), at(240, 100, false)]) === 1.5, `hours at full ${hoursAtFull([at(0, 100, true), at(30, 100, true), at(60, 100, true), at(200, 100, true)])}`)
    const sf = stressFactors({ lifetime: null, cycles: [{ minAbove40: 90, minAbove45: 30, endBattery: 3 }, { minAbove40: 30, endBattery: 20 }], rows: [] })
    want(sf.lifetime === 0 && sf.h40 === 2 && sf.h45 === 0.5 && sf.deep === 1, JSON.stringify(sf))
  })
  check('health: each penalty rule', () => {
    const T0 = Date.UTC(2026, 9, 1), H = 3600e3
    const at = (h, pct, extra = {}) => ({ timestamp: new Date(T0 + h * H).toISOString(), battery_pct: pct, extra })
    // shutdown above 5 %: the detector's offline interrupted of this test, above deadPct; not a recharged one, not another test
    const inter = [{ serial: 'A', testType: 'T', reason: 'offline', start: T0, end: T0 + 5 * H, endPct: 40 },
      { serial: 'A', testType: 'T', reason: 'offline', start: T0, end: T0 + 5 * H, endPct: 3 },
      { serial: 'A', testType: 'T', reason: 'recharged', start: T0, end: T0 + 5 * H, endPct: 40 },
      { serial: 'A', testType: 'U', reason: 'offline', start: T0, end: T0 + 5 * H, endPct: 40 },
      { serial: 'A', testType: 'T', reason: 'offline', start: T0 - 40 * 86400e3, end: T0 - 40 * 86400e3 + 5 * H, endPct: 40 }]
    const sh = shutdownsAbove(inter, 'T', { deadPct: 5, since: T0 - 30 * 86400e3 })
    want(sh.length === 1 && sh[0].kind === SHUTDOWN && sh[0].at === T0 + 5 * H, `shutdowns ${sh.length}`)
    // never reached 100 %: wired charges; the fleet's median time to 100 is 3 h, so > 4.5 h without 100 and the flag dropping is a penalty
    const chg = (h0, from, to, hours, full) => { const out = []; for (let k = 0; k <= 24; k++) out.push(at(h0 + hours * k / 24, Math.round(from + (to - from) * k / 24), { charging: true, charger_type: 'usb' })); if (full) out[out.length - 1].battery_pct = 100; out.push(at(h0 + hours + 0.1, out[out.length - 1].battery_pct, { charging: false, charger_type: 'none' })); return out }
    const rows = [...chg(0, 20, 100, 3, true), ...chg(10, 20, 100, 3, true), ...chg(20, 20, 100, 3, true), ...chg(30, 20, 97, 6, false), ...chg(40, 20, 90, 2, false), ...chg(50, 96, 99, 8, false)]
    const segs = chargeSegments(rows)
    want(segs.length === 6 && segs.filter((s) => s.toFull != null).length === 3 && segs.every((s) => s.dropped && s.wired), `segments ${segs.length}`)
    const med = medianToFull(segs)
    want(med === 3 * H, `median to full ${med / H} h`)
    const slow = slowCharges(segs, med, -Infinity)
    want(slow.length === 1 && slow[0].kind === NO_FULL && slow[0].at === segs[3].end, `slow charges ${slow.length}: ${slow.map((s) => s.detail).join('; ')}`)
    want(slowCharges(chargeSegments(rows.map((r) => ({ ...r, extra: { ...r.extra, charger_type: 'wireless' } }))), med).length === 0, 'wireless charges are not judged')
    // gauge jump: > 5 points between readings off the charger within 15 min; a gap, a 5-point step, or on charge do not count
    const g = gaugeJumps([at(0, 80), at(0.1, 72), at(0.2, 67), at(0.3, 67), at(2, 40), at(2.1, 46, { charging: true }), at(2.2, 60, { charging: true })])
    want(g.length === 1 && g[0].kind === JUMP && g[0].detail.startsWith('80% → 72%'), `jumps ${g.length}`)
    want(gaugeJumps([at(0, 80), at(0.1, 72)], { since: T0 + H }).length === 0, 'outside the 30 days')
    // all three on one device through healthRows, newest first
    const run = (i) => ({ serial: 'A', testType: 'T', start: T0 - (10 - i) * 86400e3, fullMs: 20 * H, startBattery: 100, endBattery: 20 })
    const out = healthRows({ cycles: [run(0), run(1), run(2)], testType: 'T', devices: [{ serial: 'A', lifetime: 1 }], interrupted: inter, readings: { A: [...rows, at(60, 80), at(60.1, 70)] }, now: T0 + 70 * H })
    const kinds = out.rows[0].penalties.map((p) => p.kind)
    want(kinds.join('|') === [JUMP, NO_FULL, SHUTDOWN].join('|'), kinds.join('|'))
    want(out.rows[0].grade === GRADE.replace, `3 penalties -> ${out.rows[0].grade}`)
  })
  check('health: grade boundaries', () => {
    const ev = (k) => ({ kind: k, at: 0 })
    want(gradeOf(90) === GRADE.good && gradeOf(89.9) === GRADE.watch, '90 / 89.9')
    want(gradeOf(80) === GRADE.watch && gradeOf(79.9) === GRADE.replace, '80 / 79.9')
    want(gradeOf(95, [ev(JUMP)]) === GRADE.watch, 'one penalty on a good score -> watch')
    want(gradeOf(95, [ev(JUMP), ev(NO_FULL)]) === GRADE.replace, 'two penalties -> replace')
    want(gradeOf(95, [ev(SHUTDOWN), ev(SHUTDOWN)]) === GRADE.replace, 'two shutdowns -> replace')
    want(gradeOf(85, [ev(JUMP)]) === GRADE.watch && gradeOf(79, []) === GRADE.replace, 'watch band / replace band')
    want(gradeOf(null) === GRADE.few && gradeOf(null, [ev(JUMP)]) === GRADE.few, 'no score -> not enough runs')
    const h = renderToString(<HealthView fleet={{ DEV, allCycles: DEV.flatMap(d => d.cycles), DMAP: new Map(DEV.map(d => [d.serial, d])), opts: DEFAULTS, at: 1 }} cycles={cycles} open />)
    want(h.includes('Battery health ·') && h.includes('Not enough runs') && h.includes('replace line'), 'health page did not draw its table')
  })
}
console.log(`\n${Object.keys(cases).length + lifeCases + mdmCases.length - failed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
