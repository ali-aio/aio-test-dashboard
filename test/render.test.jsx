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
console.log(`\n${Object.keys(cases).length - failed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
