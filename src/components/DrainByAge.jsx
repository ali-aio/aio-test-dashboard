import React, { useMemo, useState } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { drainByAge } from '../lib/drainAge.js'
import { CHARGING_TEST_TYPES } from '../lib/testtypes.js'
import { fmtRate, fmtSerial, compareSerial, DASH } from '../lib/fmt.js'

const ALL = '__all__'
const when = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace('Sept', 'Sep')

/** Each device's drain rate at its 10th, 20th, 30th… lifetime battery cycle, and its latest.
 *  The age of a cycle comes from the drop ledger (src/lib/drainAge.js). Charging tests have
 *  no drain, so they are left out; a test picker keeps the comparison to one kind of run. */
export default function DrainByAge({ cycles, drops }) {
  const types = useMemo(() => {
    const n = new Map()
    for (const c of cycles) if (!CHARGING_TEST_TYPES.has(c.testType) && c.dropPerHr != null) n.set(c.testType, (n.get(c.testType) || 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [cycles])
  const [pick, setPick] = useState(ALL)
  const tt = pick !== ALL && types.includes(pick) ? pick : ALL
  const { marks, rows } = useMemo(() => drainByAge(cycles.filter((c) => !CHARGING_TEST_TYPES.has(c.testType) && (tt === ALL || c.testType === tt)), drops),
    [cycles, drops, tt])
  const sorted = rows.slice().sort((a, b) => compareSerial(a.serial, b.serial))
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null }
  const cell = (x) => x
    ? <span title={`${x.c.testType} · ${when(x.c.start)}${x.age != null ? ` · started at ${x.age.toFixed(1)} battery cycles` : ''}`}>{fmtRate(x.rate)}</span>
    : DASH

  return (
    <Card title="Drain rate by battery age"
      sub={`Each device's drain rate at its 10th, 20th, 30th… battery cycle (MDM counter) and its latest cycle · ${tt === ALL ? 'all discharge tests — the test changes the rate, hover a value to see which' : tt} · hover a value for the date and exact cycle count`}
      right={types.length > 1 && (
        <select className="control" value={tt} onChange={(e) => setPick(e.target.value)} aria-label="Test type for drain by battery age">
          <option value={ALL}>All discharge tests</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>)}>
      {!drops ? <p className="secondary">The server has not built the battery-cycle history yet (it reads every device's readings once, on its next check of the MDM). This fills in after that.</p>
        : !rows.length ? <p className="secondary">No discharge cycles in scope.</p> : (
          <div className="table-wrap" style={{ maxHeight: 560 }}>
            <SortTable caption="Drain rate by battery age" head={[{ label: 'Device', style: { textAlign: 'left' } },
              ...marks.map((m) => ({ label: `${m} cycles` })), { label: 'Latest' }, { label: 'Latest at' }]}>
              {sorted.map((r) => (
                <tr key={r.serial}>
                  <td className="mono" style={{ textAlign: 'left' }}>{fmtSerial(r.serial)}</td>
                  {marks.map((m) => <td key={m}>{cell(r.at[m])}</td>)}
                  <td>{cell(r.now)}</td>
                  <td>{r.now?.age != null ? `${r.now.age.toFixed(1)} cycles` : DASH}</td>
                </tr>
              ))}
              <tr data-pinned className="row-total">
                <td style={{ textAlign: 'left' }}><b>Average</b></td>
                {marks.map((m) => { const a = avg(sorted.map((r) => r.at[m]?.rate)); return <td key={m}><b>{a == null ? DASH : fmtRate(a)}</b></td> })}
                <td><b>{(() => { const a = avg(sorted.map((r) => r.now?.rate)); return a == null ? DASH : fmtRate(a) })()}</b></td>
                <td />
              </tr>
            </SortTable>
          </div>)}
      <p className="hint" style={{ marginTop: 8 }}>A column holds the first cycle that started between that count and the next (e.g. 20–30). Blank: no cycle of that test there, or the device's readings start later.</p>
    </Card>
  )
}
