import React from 'react'
import { renderToString } from 'react-dom/server'
import fs from 'node:fs'
import { reclassify, DEFAULTS } from '../src/lib/cycles.js'
import { adaptAll } from '../src/lib/adapt.js'
import { filterCycles, filtersFor, distinct } from '../src/lib/t7cycles.js'
import T7Overview from '../src/views/T7Overview.jsx'
import TestDetail from '../src/views/TestDetailView.jsx'
import Comparison from '../src/views/ComparisonView.jsx'
import Thermal from '../src/views/ThermalView.jsx'
import Devices from '../src/views/DevicesView.jsx'
import Today from '../src/views/TodayView.jsx'
import CyclePlan from '../src/views/CyclePlanView.jsx'
import { lifetimeOf, cyclesInRange } from '../src/lib/device.js'
import FilterBar, { FilterPills } from '../src/components/FilterBar.jsx'
import { DateList } from '../src/components/DatePicker.jsx'
import { splitText } from '../src/lib/splitCycles.js'
import RangePicker from '../src/components/RangePicker.jsx'
import { windowOn, cycleAt, nextCycleTimes, cyclesOn, activeSerials, overlapsOn, loadDecls } from '../src/lib/plan.js'
import { testTypeFor, temperaturePhases } from '../src/lib/adapt.js'
import { thermalTimingByDevice } from '../src/lib/thermal.js'
import { sortValue, compareValues, SortTable } from '../src/components/SortTable.jsx'
import { presetRange, resolve, overlaps, dayRange } from '../src/lib/range.js'

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
  thermal: [Thermal, { cycles, allSerials: all, onFilter: nop }],
  summary: [Devices, { cycles, allSerials: all, events: [], onEventsChanged: nop, onFilter: nop, issues: [], files: [] }],
}
let failed = 0
console.log('cycles', cycles.length, '| types:', tts.join(' | '))
for (const [name, [C, p]] of Object.entries(cases)) {
  try { renderToString(<C {...p} />); console.log('OK  ', name, `(${p.cycles.length})`) }
  catch (e) { failed++; console.log('FAIL', name, '->', e.message); console.log((e.stack || '').split('\n').slice(1, 5).join('\n')) }
}
// Lifetime cycles (MDM): the tile must show the real sum, and "—" (never 0) when no
// ticked device reports discharge_total_pct.
const snaps = { [all[0]]: { discharge_total_pct: 1492 }, [all[1]]: { discharge_total_pct: 9207 }, [all[2]]: {} }
const checks = [
  ['lifetime: one device = 14.92', lifetimeOf([all[0]], sn => snaps[sn]), '14.92'],
  ['lifetime: two devices summed', lifetimeOf([all[0], all[1]], sn => snaps[sn]), '106.99'],
  ['lifetime: none reporting shows —', lifetimeOf([all[2]], sn => snaps[sn]), '—'],
]
let lifeCases = 0
for (const [name, lifetime, want] of checks) {
  for (const tt of ['__all__', tts[0]]) {
    lifeCases++
    try {
      const html = renderToString(<T7Overview cycles={tt === '__all__' ? cycles : cycles.filter(c => c.testType === tt)} testType={tt} allSerials={all} onPickTestType={nop} onFilter={nop} lifetime={lifetime} />)
      const i = html.indexOf('Lifetime cycles (MDM)'), tile = html.slice(i, i + 400).replace(/<[^>]+>/g, ' ')
      if (i < 0 || !tile.includes(want)) throw new Error(`expected ${want}, tile read: ${tile.replace(/\s+/g, ' ').slice(0, 120)}`)
      if (!tile.includes('lifetime, all tests — from MDM')) throw new Error('foot text missing')
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
  const want = (cond, msg) => { if (!cond) throw new Error(msg) }
  check('runs covered -> "cycles (MDM)"', () => { const t = splitText(covered.slice(0, 20)); want(/cycles \(MDM\)$/.test(t), t) })
  check('no readings -> run count', () => { const t = splitText(bare.slice(0, 20)); want(t === '20 runs', t) })
  check('one uncovered run -> run count, never a partial sum', () => {
    const mixed = [...covered.slice(0, 5), { ...covered[5], mdmCycles: null }]; const t = splitText(mixed); want(t === '6 runs', t) })
  check('overview cards show MDM cycles when covered', () => {
    const h = renderToString(<T7Overview cycles={covered} testType="__all__" allSerials={all} onPickTestType={nop} onFilter={nop} />)
    want(h.includes('cycles (MDM)'), 'no "cycles (MDM)" on the overview')
  })
  check('overview cards show runs without readings', () => {
    const h = renderToString(<T7Overview cycles={bare} testType="__all__" allSerials={all} onPickTestType={nop} onFilter={nop} />)
    want(!h.includes('cycles (MDM)') && / runs/.test(h), 'expected run counts only')
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
    want(h.includes('Battery cycles (MDM)') && h.includes('3.50') && h.includes('Last hour'), 'tile missing')
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
    want(h.includes(`Every run on ${sn}`), 'no every-run card')
    const rows = (h.split('Every run on')[1].match(/<tr/g) || []).length - 1   // minus the heading row
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
    const early = testTypeFor({ start: at(11, 8), end: at(11, 20), serial: 'A' }, { decls, rota: {}, DEV: [] })
    want(early !== 'WLC on Load', `before window -> ${early}`)
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
  })
  check('a device taken out leaves the cycle and its cut-short run', () => {
    const at = (d, h) => new Date(2026, 9, d, h).getTime()
    const decl = { id: 'd1', at: 1, testType: 'wlc_load', from: '2026-10-11', to: '2026-10-11', startTime: '10:00', endTime: '04:00', group: { kind: 'all' },
      removed: [{ serial: 'B', at: at(11, 15), reason: 'Taken for debugging' }] }
    const DEV = [{ serial: 'A' }, { serial: 'B' }]
    want(activeSerials(decl, DEV, at(11, 12)).length === 2, 'B still in before it was taken')
    want(activeSerials(decl, DEV, at(11, 16)).join() === 'A', 'B gone after')
    const tB = testTypeFor({ start: at(11, 10), end: at(11, 20), serial: 'B' }, { decls: [decl], rota: {}, DEV })
    const tA = testTypeFor({ start: at(11, 10), end: at(11, 20), serial: 'A' }, { decls: [decl], rota: {}, DEV })
    want(tB !== 'WLC on Load' && tA === 'WLC on Load', `B ${tB} / A ${tA}`)
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
}
console.log(`\n${Object.keys(cases).length + lifeCases + mdmCases.length - failed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
