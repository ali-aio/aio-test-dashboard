import React, { useMemo, useState, useSyncExternalStore } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { drainByAge, liveLedgers } from '../lib/drainAge.js'
import { rowsFor, subscribeWindow, getWindow } from '../lib/window.js'
import { CHARGING_TEST_TYPES } from '../lib/testtypes.js'
import { fmtRate, fmtSerial, compareSerial, DASH } from '../lib/fmt.js'

const ALL = '__all__'
const isLoad = (c) => /^Pad on/.test(c.padState || '')
const loadText = (c) => (!c.padKnown ? 'load not known' : isLoad(c) ? 'load placed' : 'no load')
const when = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace('Sept', 'Sep')

/** Each device's drain rate at its 10th, 20th, 30th… lifetime battery cycle, and its latest.
 *  The age of a cycle comes from the drop ledger (src/lib/drainAge.js). Charging tests have
 *  no drain, so they are left out; a test picker keeps the comparison to one kind of run. */
export default function DrainByAge({ cycles, drops: stored, snapOf = () => null }) {
  // up to the last check-in, not the last sweep: the live readings and counter on top of the file
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const drops = useMemo(() => liveLedgers(stored, rowsFor, snapOf), [stored, win.at2, cycles])
  const types = useMemo(() => {
    const n = new Map()
    for (const c of cycles) if (!CHARGING_TEST_TYPES.has(c.testType) && c.dropPerHr != null) n.set(c.testType, (n.get(c.testType) || 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [cycles])
  const [pick, setPick] = useState(ALL)
  const tt = pick !== ALL && types.includes(pick) ? pick : ALL
  // a load on the T7's wireless pad drains it much faster: compare like with like, or see it marked
  const [load, setLoad] = useState(ALL)
  const loadOk = (c) => load === ALL || (c.padKnown && (load === 'on') === isLoad(c))
  const { marks, rows } = useMemo(() => drainByAge(cycles.filter((c) => !CHARGING_TEST_TYPES.has(c.testType) && (tt === ALL || c.testType === tt) && loadOk(c)), drops),
    [cycles, drops, tt, load])
  const sorted = rows.slice().sort((a, b) => compareSerial(a.serial, b.serial))
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null }
  const cell = (x) => x
    ? <span title={`${x.c.testType} · ${loadText(x.c)} · ${when(x.c.start)}${x.age != null ? ` · started at ${x.age.toFixed(1)} battery cycles` : ''}`}>
      {fmtRate(x.rate)}{load === ALL && x.c.padKnown && isLoad(x.c) ? <span className="load-tag" aria-label="load placed">L</span> : null}</span>
    : DASH

  return (
    <Card title="Drain rate by battery age"
      right={<div style={{ display: 'flex', gap: 8 }}>
        <select className="control" value={load} onChange={(e) => setLoad(e.target.value)} aria-label="Load on the wireless pad">
          <option value={ALL}>With and without load</option>
          <option value="on">Load placed</option>
          <option value="off">No load</option>
        </select>
        {types.length > 1 && (
          <select className="control" value={tt} onChange={(e) => setPick(e.target.value)} aria-label="Test type for drain by battery age">
            <option value={ALL}>All discharge tests</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>)}
      </div>}>
      {!drops ? <p className="secondary">The server has not built the battery-cycle history yet (it reads every device's readings once, on its next check of the MDM). This fills in after that.</p>
        : !rows.length ? <p className="secondary">No discharge cycles in scope.</p> : (
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <SortTable caption="Drain rate by battery age" head={[{ label: 'Device', style: { textAlign: 'left' } },
              ...marks.map((m) => ({ label: `${m} cycles` })), { label: 'Latest' }, { label: 'Latest started at' }, { label: 'Cycles now' }]}>
              {sorted.map((r) => (
                <tr key={r.serial}>
                  <td className="mono" style={{ textAlign: 'left' }}>{fmtSerial(r.serial)}</td>
                  {marks.map((m) => <td key={m}>{cell(r.at[m])}</td>)}
                  <td>{cell(r.now)}</td>
                  <td>{r.now?.age != null ? `${r.now.age.toFixed(1)} cycles` : DASH}</td>
                  {/* the MDM counter at the device's last check-in */}
                  <td title={drops?.[r.serial]?.anchor ? `MDM counter at ${new Date(drops[r.serial].anchor[0]).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : undefined}>
                    {drops?.[r.serial]?.anchor ? `${(drops[r.serial].anchor[1] / 100).toFixed(1)} cycles` : DASH}</td>
                </tr>
              ))}
              <tr data-pinned className="row-total">
                <td style={{ textAlign: 'left' }}><b>Average</b></td>
                {marks.map((m) => { const a = avg(sorted.map((r) => r.at[m]?.rate)); return <td key={m}><b>{a == null ? DASH : fmtRate(a)}</b></td> })}
                <td><b>{(() => { const a = avg(sorted.map((r) => r.now?.rate)); return a == null ? DASH : fmtRate(a) })()}</b></td>
                <td />
                <td />
              </tr>
            </SortTable>
          </div>)}
      <p className="hint" style={{ marginTop: 8 }}>{load === ALL ? <><span className="load-tag">L</span> = a load was on the wireless pad for most of that cycle (it drains faster); pick Load placed or No load to compare like with like. </> : null}A column holds the first cycle that started between that count and the next (e.g. 20–30). Blank: no cycle of that test there, or the device's readings start later.</p>
    </Card>
  )
}
