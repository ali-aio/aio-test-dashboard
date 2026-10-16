import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { liveLedgers } from '../lib/drainAge.js'
import { tagSlots, drainBands, conditionBands, TEMP_BANDS } from '../lib/drainHours.js'
import { rowsFor, subscribeWindow, getWindow } from '../lib/window.js'
import { CHARGING_TEST_TYPES } from '../lib/testtypes.js'
import { fmtRate, fmtSerial, compareSerial, DASH } from '../lib/fmt.js'

const ALL = 'all'
const STEP = 5
const pct = (x) => `${Math.round(x * 100)} %`

/** Each device's drain rate per 5 lifetime battery cycles, worked out per 15 minutes so it can be
 *  split by what was going on: load on the pad, ads (from the test), battery temperature
 *  (src/lib/drainHours.js). Below it, the fleet's average for each condition on its own. */
export default function DrainByAge({ cycles, drops: stored, hours, snapOf = () => null }) {
  // the battery's age up to the last check-in, not the last sweep
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const drops = useMemo(() => liveLedgers(stored, rowsFor, snapOf), [stored, win.at2, cycles])
  const discharge = useMemo(() => cycles.filter((c) => !CHARGING_TEST_TYPES.has(c.testType)), [cycles])
  const types = useMemo(() => {
    const n = new Map()
    for (const c of discharge) n.set(c.testType, (n.get(c.testType) || 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [discharge])
  const tagged = useMemo(() => tagSlots(discharge, hours, drops), [discharge, hours, drops])

  const [load, setLoad] = useState(ALL)
  const [ads, setAds] = useState(ALL)
  const [temp, setTemp] = useState(ALL)
  const [pick, setPick] = useState(ALL)
  const test = pick !== ALL && types.includes(pick) ? pick : ALL
  const { marks, rows } = useMemo(() => drainBands(tagged, { load, ads, temp, test }, { step: STEP }), [tagged, load, ads, temp, test])
  const cond = useMemo(() => conditionBands(tagged, { test }, { step: STEP }), [tagged, test])
  const sorted = rows.slice().sort((a, b) => compareSerial(a.serial, b.serial))
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null }
  const cell = (x) => x
    ? <span title={`${x.hours.toFixed(1)} h on battery · load on the pad ${pct(x.loadShare)} of it${x.temp != null ? ` · battery ${x.temp.toFixed(1)} °C on average` : ''}`}>{fmtRate(x.rate)}</span>
    : DASH
  const band = (m) => ({ label: `${m} cycles`, title: `battery at ${m} up to ${m + STEP} cycles` })
  const sel = (value, set, label, opts) => (
    <select className="control" value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>)

  return (
    <Card title="Drain rate by battery age"
      right={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {sel(load, setLoad, 'Load on the wireless pad', [[ALL, 'With and without load'], ['on', 'Load placed'], ['off', 'No load']])}
        {sel(ads, setAds, 'Ads running', [[ALL, 'With and without ads'], ['on', 'Ads running'], ['off', 'No ads']])}
        {sel(temp, setTemp, 'Battery temperature', [[ALL, 'Any battery temperature'], ...TEMP_BANDS.map((b) => [b.id, b.label])])}
        {types.length > 1 && sel(test, setPick, 'Test type for drain by battery age', [[ALL, 'All discharge tests'], ...types.map((t) => [t, t])])}
      </div>}>
      {!drops || !hours ? <p className="secondary">The server has not built the 15-minute history yet (it reads every device's readings once, on its next check of the MDM). This fills in after that.</p>
        : !rows.length ? <p className="secondary">No hours on battery match these choices.</p> : (
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <SortTable caption="Drain rate by battery age" head={[{ label: 'Device', style: { textAlign: 'left' } },
              ...marks.map(band), { label: 'Last 7 days' }, { label: 'Cycles now' }]}>
              {sorted.map((r) => (
                <tr key={r.serial}>
                  <td className="mono" style={{ textAlign: 'left' }}>{fmtSerial(r.serial)}</td>
                  {marks.map((m) => <td key={m}>{cell(r.at[m])}</td>)}
                  <td>{cell(r.latest)}</td>
                  {/* the MDM counter at the device's last check-in */}
                  <td title={drops?.[r.serial]?.anchor ? `MDM counter at ${new Date(drops[r.serial].anchor[0]).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : undefined}>
                    {drops?.[r.serial]?.anchor ? `${(drops[r.serial].anchor[1] / 100).toFixed(1)} cycles` : DASH}</td>
                </tr>
              ))}
              <tr data-pinned className="row-total">
                <td style={{ textAlign: 'left' }}><b>Average</b></td>
                {marks.map((m) => { const a = avg(sorted.map((r) => r.at[m]?.rate)); return <td key={m}><b>{a == null ? DASH : fmtRate(a)}</b></td> })}
                <td><b>{(() => { const a = avg(sorted.map((r) => r.latest?.rate)); return a == null ? DASH : fmtRate(a) })()}</b></td>
                <td />
              </tr>
            </SortTable>
          </div>)}
      {drops && hours && cond.marks.length > 0 && <>
        <h3 style={{ margin: '16px 0 6px', fontSize: 13 }}>Average by condition{test !== ALL ? ` · ${test}` : ''}</h3>
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <SortTable caption="Average drain by condition and battery age" head={[{ label: 'Condition', style: { textAlign: 'left' } },
            ...cond.marks.map(band), { label: 'Last 7 days' }]}>
            {cond.rows.map((r) => (
              <tr key={r.label}>
                <td style={{ textAlign: 'left' }}>{r.label}</td>
                {cond.marks.map((m) => <td key={m}>{r.at[m] ? <span title={`average of ${r.at[m].devices} device${r.at[m].devices === 1 ? '' : 's'}`}>{fmtRate(r.at[m].rate)}</span> : DASH}</td>)}
                <td>{r.latest ? <span title={`average of ${r.latest.devices} devices`}>{fmtRate(r.latest.rate)}</span> : DASH}</td>
              </tr>))}
          </SortTable>
        </div>
      </>}
      <p className="hint" style={{ marginTop: 8 }}>Worked out per 15 minutes over the time each device ran a test on battery: points drained ÷ hours, a column holds the hours the battery was at that many cycles up to the next column (5 cycles = 5 up to 10; a column needs 2 h). Load = a load (or phone) on the wireless pad for most of those 15 minutes. Ads come from the test (the Cycle plan); Old cycles and WLC on Phone count as not known. The devices report the battery's temperature, not the room's.</p>
    </Card>
  )
}
