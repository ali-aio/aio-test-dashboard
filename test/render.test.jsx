import React from 'react'
import { renderToString } from 'react-dom/server'
import fs from 'node:fs'
import { reclassify, DEFAULTS } from '../src/lib/cycles.js'
import { adaptAll } from '../src/lib/adapt.js'
import { filterCycles, filtersFor, distinct } from '../src/lib/t7cycles.js'
import T7Overview from '../src/views/T7Overview.jsx'
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
import { presetRange, resolve, overlaps, dayRange } from '../src/lib/range.js'

// a rota so every test type, including Restaurant Case's wireless split, gets exercised
const ROTA = JSON.stringify({0:{testType:'wlc_load'},1:{testType:'restaurant'},2:{testType:'wlc_phone'},3:{testType:'wlc_disch'},4:{testType:'charging'},5:{testType:'burnin'},6:{testType:'disch_ads'}})
globalThis.localStorage = { getItem: k => k.startsWith('cyclePlan:rota') ? ROTA : null, setItem() {}, removeItem() {} }
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
    const h = renderToString(<FilterPills filters={base} onChange={nop} onReset={nop} count={splitText(covered)} allSerials={all} />)
    want(h.includes('in scope'), 'pill missing')
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
