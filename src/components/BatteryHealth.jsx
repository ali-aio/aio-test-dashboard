import React, { useMemo, useState, useSyncExternalStore } from 'react'
import PartStatus from './PartStatus.jsx'
import { SortTable } from './SortTable.jsx'
import { Card, Stat, Pill, EmptyNote } from './Primitives.jsx'
import { LineChart } from './t7charts.jsx'
import { subscribeWindow, getWindow, rowsFor } from '../lib/window.js'
import { GROUP } from '../lib/fleet.js'
import { TEST_TYPES, loadDecls, loadRota } from '../lib/plan.js'
import { FIELD_DISCHARGE } from '../lib/testtypes.js'
import { testTypeFor } from '../lib/adapt.js'
import { lifetimeCycles, buildFromSerial } from '../lib/device.js'
import { healthRows, loadClass, runRatio, earlyDrain, LOAD, GRADE, STRESS_FACTORS, WEIGHTS, GOOD_AT, REPLACE_AT, PENALTY_DAYS, SHUTDOWN, NO_FULL, JUMP, GAUGE_JUMP, GAUGE_GAP_MIN, SLOW_CHARGE_X, CHARGE_START_MAX, MIN_RUNS, BASELINE_RUNS, CURRENT_RUNS } from '../lib/health.js'
import { fmtHours, fmtInt, fmtNum, fmtLifetime, fmtSerial, DASH } from '../lib/fmt.js'

const H = 3600e3, DAY = 86400e3
// every load / discharge test; the charging tests have no runtime to compare
const DISCHARGE_TYPES = [...TEST_TYPES.filter((t) => t.expect === 'discharge').map((t) => t.name), FIELD_DISCHARGE]
const LEVEL = { [GRADE.good]: 'good', [GRADE.watch]: 'warning', [GRADE.replace]: 'critical', [GRADE.few]: 'neutral' }
const when = (t) => (t == null ? DASH : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace('Sept', 'Sep'))
const whenAt = (t) => `${when(t)} · ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
const pct = (v) => (v == null || !Number.isFinite(v) ? DASH : String(Math.round(v)))
const hrs = (ms) => fmtHours(ms == null ? null : ms / H)

// one sentence per column, on the heading's hover
const COLS = [
  ['Serial', 'The device; click the serial to open its page', { textAlign: 'left' }],
  ['HW build', 'From the serial: BU in it = Production Build, otherwise OTG / Validation Build', { textAlign: 'left' }],
  ['Firmware', 'The firmware the device was on during its latest comparable run', { textAlign: 'left' }],
  ['Grade', `Good: score ≥ ${GOOD_AT} and no penalties · Watch: ${REPLACE_AT}–${GOOD_AT - 1}, or exactly one penalty · Replace: below ${REPLACE_AT}, two or more penalties, or two shutdowns above 5 %`, { textAlign: 'left' }],
  ['Score', `${WEIGHTS.capacity} × capacity + ${WEIGHTS.early} × early drain + ${WEIGHTS.stress} × stress; early drain's weight goes to capacity when it cannot be measured`],
  ['Capacity', `Each of the last ${CURRENT_RUNS} comparable runs' runtime to empty as a share of the baseline of its load class (WLC active / WLC inactive): the median of the device's first ${BASELINE_RUNS} runs of that class, or the fleet's first-${BASELINE_RUNS} median when it has fewer. The median share, capped at 100`],
  ['Early drain', `Points drained in the first hour, each of the last ${CURRENT_RUNS} runs against its load class's baseline (baseline ÷ now, so faster now = lower), the median capped at 100; blank when fewer than ${MIN_RUNS} runs have a curve`],
  ['Stress', '100 minus the mean load over five wear factors, each as a share of the fleet\'s 90th percentile: lifetime battery cycles, hours ≥ 40 °C, hours ≥ 45 °C, hours on charger at 100 %, discharges ended below 5 %'],
  ['Lifetime cycles', 'The MDM\'s lifetime battery cycles for the device (discharge counter ÷ 100)'],
  ['h ≥ 40 °C', 'Hours at or above 40 °C summed over the device\'s counted cycles, every test'],
  ['Penalties', `Events in the last ${PENALTY_DAYS} days: a shutdown above 5 %, a wired charge that never reached 100 %, a gauge jump of more than ${GAUGE_JUMP} points between readings`],
  ['Runs', `Comparable runs: counted cycles of this test on this device that started at 95 % or more (${MIN_RUNS} needed for a score); L = with a load on the wireless pad`],
  ['Last run', 'Start date of the latest comparable run'],
]
const head = COLS.map(([label, title, style]) => ({ label: <span title={title}>{label}</span>, style }))

/**
 * Battery health, one row per device of the group, for one discharge test at a time. The
 * figures are all from src/lib/health.js over data the app already holds: the counted
 * cycles, the MDM's lifetime counter, the 7-day readings window and the detector's
 * interrupted discharges. Computed here, only while the Summary screen is open (its last card;
 * it was its own Health screen until Oct 2026).
 */
export default function BatteryHealth({ fleet, cycles, open = false }) {
  const { DEV, opts } = fleet
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const now = Date.now()

  // the tests on offer: every discharge test with a counted cycle, the busiest first
  const types = useMemo(() => {
    const n = new Map()
    for (const c of cycles) if (DISCHARGE_TYPES.includes(c.testType) && !c.inProgress) n.set(c.testType, (n.get(c.testType) || 0) + 1)
    return DISCHARGE_TYPES.filter((t) => n.has(t)).sort((a, b) => n.get(b) - n.get(a))
  }, [cycles])
  const [pick, setPick] = useState(null)
  // a load on the pad drains ~3× faster: compare each run with its own class, or look at one class only
  const [load, setLoad] = useState('all')
  const testType = pick && types.includes(pick) ? pick : types[0] || null
  const [selected, setSelected] = useState(null)

  // the detector's interrupted discharges of the last month, with the test each was part of
  const interrupted = useMemo(() => {
    const decls = loadDecls(GROUP), rota = loadRota(GROUP), ctx = { decls, rota, DEV }, since = now - (PENALTY_DAYS + 2) * DAY
    return DEV.flatMap((d) => (d.interrupted || []).filter((c) => c.reason === 'offline' && c.end >= since)
      .map((c) => ({ ...c, serial: d.serial, testType: testTypeFor({ ...c, serial: d.serial, charging: false }, ctx) })))
  }, [DEV, fleet.at])

  const health = useMemo(() => {
    if (!testType) return null
    return healthRows({
      cycles, testType, interrupted, now, opts, load,
      devices: DEV.map((d) => ({ serial: d.serial, lifetime: lifetimeCycles(d.snap) })),
      readings: Object.fromEntries(DEV.map((d) => [d.serial, rowsFor(d.serial)])),
    })
  }, [cycles, testType, interrupted, DEV, win.at2, opts, load])

  const openDevice = (sn) => { location.hash = `#/nx/device/${encodeURIComponent(sn)}`; window.scrollTo(0, 0) }
  const row = health?.rows.find((r) => r.serial === selected) || null

  return (
    <>
      <Card title={`Battery health${testType ? ` · ${testType}` : ''}`} collapsible defaultOpen={open}
        sub={health?.comparable ? `${fmtInt(health.rows.length)} devices · ${fmtInt(health.comparable)} comparable runs · worst first · click a row for its detail, the serial for its page · capacity = runtime vs the unit's first runs; ${REPLACE_AT} % is the replace line` : undefined}
        right={
          <div className="row row-wrap" style={{ gap: 8 }}>
            {health && Object.values(GRADE).map((g) => <Pill key={g} level={LEVEL[g]}>{g} {fmtInt(health.counts[g])}</Pill>)}
            <select className="control" value={testType || ''} onChange={(e) => { setPick(e.target.value); setSelected(null) }} aria-label="Test type for battery health" disabled={!types.length}>
              {!types.length && <option value="">No discharge tests yet</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="control" value={load} onChange={(e) => setLoad(e.target.value)} aria-label="Load on the wireless pad" title="Each run is compared with runs of its own load class; pick one class to see only those runs">
              <option value="all">With and without load</option>
              <option value="load">Load placed</option>
              <option value="none">No load</option>
            </select>
          </div>
        }>
        <PartStatus window DEV={DEV} />
        {!health || !health.comparable ? (
          <EmptyNote>{testType ? `No comparable runs of ${testType} yet — a run counts once it is a finished cycle that started at ${opts?.fullPct ?? 95} % or more.`
            : 'No finished discharge cycles in this group yet.'}</EmptyNote>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 620 }}>
            <SortTable caption={`Battery health per device, ${testType}`} head={head}>
              {health.rows.map((r) => (
                <tr key={r.serial} className={`row-link${selected === r.serial ? ' is-selected' : ''}`} aria-selected={selected === r.serial}
                  onClick={() => setSelected((s) => (s === r.serial ? null : r.serial))} onDoubleClick={() => openDevice(r.serial)}>
                  <td className="mono" style={{ textAlign: 'left' }}>
                    <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); openDevice(r.serial) }} title={`Open ${r.serial}`}>{fmtSerial(r.serial)}</button>
                  </td>
                  <td style={{ textAlign: 'left' }}>{buildFromSerial(r.serial) ?? DASH}</td>
                  <td style={{ textAlign: 'left' }}>{r.firmware ?? DASH}</td>
                  <td style={{ textAlign: 'left' }}><Pill level={LEVEL[r.grade]}>{r.grade}</Pill></td>
                  <td>{pct(r.score)}</td>
                  <td>{pct(r.capacity.index)}</td>
                  <td>{pct(r.early.index)}</td>
                  <td>{pct(r.stress.index)}</td>
                  <td>{fmtLifetime(r.lifetime)}</td>
                  <td>{fmtNum(r.factors.h40, 1)}</td>
                  <td>{fmtInt(r.penalties.length)}</td>
                  <td>{fmtInt(r.n)}{r.loads.load ? <span className="load-tag" title={`${r.loads.load} with a load on the pad`}>{r.loads.load} L</span> : null}</td>
                  <td>{when(r.lastRun)}</td>
                </tr>
              ))}
            </SortTable>
          </div>
        )}
      </Card>

      {row && <Detail row={row} testType={testType} fleet={health} />}
    </>
  )
}

function Detail({ row, testType, fleet }) {
  const runs = row.runs, classes = row.capacity.classes
  const x0 = runs.length ? runs[0].start - DAY : 0, x1 = runs.length ? runs[runs.length - 1].start + DAY : 1
  // one line per load class, each run as a share of ITS class's baseline, so pad-on and
  // pad-off runs sit on one scale; 100 % and the replace line are the dashed references
  const byClass = {}
  for (const r of runs) { const k = loadClass(r), v = runRatio(r, classes); if (v != null) (byClass[k] = byClass[k] || []).push({ t: r.start, v: v * 100, h: r.fullMs / H }) }
  const COLOR = { none: 'var(--series-1)', load: 'var(--series-2)', unknown: 'var(--series-7)' }
  const series = [
    ...Object.entries(byClass).map(([k, points]) => ({ id: k, label: LOAD[k], sub: classes[k] ? `baseline ${hrs(classes[k].baseline)} (${classes[k].source})` : undefined, color: COLOR[k], points })),
    { id: 'base', label: 'Baseline', color: 'var(--text-muted)', dashed: true, points: [{ t: x0, v: 100 }, { t: x1, v: 100 }] },
    { id: 'line80', label: `${REPLACE_AT} % line`, color: 'var(--status-critical)', dashed: true, points: [{ t: x0, v: REPLACE_AT }, { t: x1, v: REPLACE_AT }] },
  ]
  const yTop = Math.max(120, ...Object.values(byClass).flat().map((p) => p.v)) 
  // date ticks: about five, on local midnights
  const ticks = []
  if (runs.length) {
    const step = Math.max(DAY, Math.ceil((x1 - x0) / 5 / DAY) * DAY)
    for (let t = new Date(x0).setHours(0, 0, 0, 0) + DAY; t <= x1; t += step) ticks.push(t)
  }
  const top = STRESS_FACTORS.map((f) => ({ f, load: row.stress.loads[f.key] })).sort((a, b) => b.load - a.load)[0]
  const classText = (cl, fmt) => Object.entries(cl).map(([k, c]) => `${LOAD[k].toLowerCase()} ${fmt(c.baseline)} ${c.source}`).join(' · ')
  const lastRuns = runs.slice(-CURRENT_RUNS)

  return (
    <Card title={`${row.serial} · ${testType}`}
      sub={`${row.grade}${row.score != null ? ` · score ${row.score}` : ''} · ${fmtInt(row.n)} comparable run${row.n === 1 ? '' : 's'}${row.loads.load ? ` (${row.loads.load} with a load)` : ''}${row.lastRun ? ` · last ${when(row.lastRun)}` : ''}`}>
      <div className="view-stack" style={{ gap: 16 }}>
        <div className="stat-row">
          <Stat label="Score" value={pct(row.score)} foot={row.score == null ? `needs ${MIN_RUNS} comparable runs` : `${WEIGHTS.capacity} capacity · ${row.early.index == null ? '0' : WEIGHTS.early} early · ${WEIGHTS.stress} stress`} />
          <Stat label="Capacity" value={pct(row.capacity.index)}
            foot={row.capacity.index == null ? `needs ${MIN_RUNS} comparable runs` : `last ${lastRuns.length}: ${lastRuns.map((r) => hrs(r.fullMs)).join(', ')} · ${Math.round(row.capacity.current * 100)} % of baseline (${classText(classes, hrs)})`} />
          <Stat label="Early drain" value={pct(row.early.index)}
            foot={row.early.index == null ? `${row.early.n} of ${row.n} runs have a curve (${MIN_RUNS} needed) — weight moved to capacity`
              : `first hour, last ${CURRENT_RUNS}: ${runs.filter((r) => earlyDrain(r) != null).slice(-CURRENT_RUNS).map((r) => `${fmtNum(earlyDrain(r), 1)} pts`).join(', ')} · baseline ${classText(row.early.classes, (v) => `${fmtNum(v, 1)} pts`)}`} />
          <Stat label="Stress" value={pct(row.stress.index)} foot={top ? `heaviest: ${top.f.label.toLowerCase()} at ${Math.round(top.load * 100)} % of the fleet's p90` : undefined} />
        </div>

        {Object.keys(byClass).length ? (
          <LineChart series={series} xDomain={[x0, x1]} yDomain={[0, Math.ceil(yTop / 20) * 20]} xTicks={ticks} formatX={when} formatY={(v) => `${Math.round(v)} %`} height={240}
            valueLabel="runtime vs baseline" caption={`Runtime to empty per comparable run of ${testType} on ${row.serial}, as a share of its load class's baseline, with the ${REPLACE_AT} % line`}
            legendNote="each run as a share of the baseline of its own load class" />
        ) : <EmptyNote>No comparable runs of {testType} on this device{runs.length ? ' with a baseline yet' : ''}.</EmptyNote>}

        <div className="grid grid-2">
          <div>
            <h4 style={{ margin: '0 0 8px' }}>Penalty events · last {PENALTY_DAYS} days</h4>
            {!row.penalties.length ? <p className="secondary" style={{ margin: 0 }}>None.</p> : (
              <div className="table-wrap">
                <SortTable caption={`Penalty events on ${row.serial}`} head={[{ label: 'When' }, { label: 'Event', style: { textAlign: 'left' } }, { label: 'Detail', style: { textAlign: 'left' } }]}>
                  {row.penalties.map((p, i) => (
                    <tr key={i}>
                      <td className="nowrap">{whenAt(p.at)}</td>
                      <td style={{ textAlign: 'left' }}><Pill level={p.kind === SHUTDOWN ? 'critical' : 'warning'}>{p.kind}</Pill></td>
                      <td style={{ textAlign: 'left' }}>{p.detail}</td>
                    </tr>
                  ))}
                </SortTable>
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>{SHUTDOWN}: the detector's interrupted discharge of this test that went silent above 5 % off the charger.
              {' '}{NO_FULL}: a wired charge from ≤ {CHARGE_START_MAX} % that came off the cable below 100 % after more than {SLOW_CHARGE_X}× the fleet's median time to 100 %{fleet.medianToFull ? ` (${hrs(fleet.medianToFull)})` : ''}.
              {' '}{JUMP}: two readings off the charger within {GAUGE_GAP_MIN} min more than {GAUGE_JUMP} points apart.</p>
          </div>
          <div>
            <h4 style={{ margin: '0 0 8px' }}>Stress factors</h4>
            <div className="table-wrap">
              <SortTable caption={`Stress factors for ${row.serial}`} head={[{ label: 'Factor', style: { textAlign: 'left' } }, { label: 'This device' }, { label: 'Fleet p90' }, { label: 'Load' }]}>
                {STRESS_FACTORS.map((f) => (
                  <tr key={f.key}>
                    <td style={{ textAlign: 'left' }}>{f.label}</td>
                    <td>{fmtNum(row.factors[f.key], f.digits)}{f.unit ? ` ${f.unit}` : ''}</td>
                    <td>{fmtNum(fleet.p90[f.key], f.digits)}{f.unit ? ` ${f.unit}` : ''}</td>
                    <td>{Math.round(row.stress.loads[f.key] * 100)}%</td>
                  </tr>
                ))}
              </SortTable>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>Load = the device's value as a share of the fleet's 90th percentile, capped at 100 %. Stress = 100 − the mean load.</p>
          </div>
        </div>
      </div>
    </Card>
  )
}
