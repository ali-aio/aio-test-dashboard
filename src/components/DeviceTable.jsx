import React, { useMemo, useState } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { kpis, maxOf } from '../lib/t7cycles.js'
import { status, lifetimeCycles } from '../lib/device.js'
import { fmtInt, fmtHours, fmtRate, fmtTemp, fmtDate, fmtLifetime, compareSerial, DASH } from '../lib/fmt.js'

// Every device in scope, one row each, at the bottom of the Overview: how it is now and
// what its cycles in scope add up to. Search narrows it, every heading sorts, a serial
// opens the device's own page (its whole history).
export default function DeviceTable({ cycles, serials, snapOf, onOpen }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => serials.slice().sort(compareSerial).map((sn) => {
    const own = cycles.filter((c) => c.serial === sn), k = kpis(own)
    const dates = [...new Set(own.map((c) => c.date).filter(Boolean))].sort()
    return { sn, own, k, days: dates.length, last: dates[dates.length - 1], peak: maxOf(own.map((c) => c.maxTemp)) }
  }), [cycles, serials])
  const shown = rows.filter((r) => r.sn.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <Card title="Devices" sub={`${fmtInt(serials.length)} in scope · click a serial for its whole history · click a heading to sort`}
      right={<input className="control" type="search" placeholder="Search devices… (e.g. 044)" value={q}
        onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="Search the device list" />}>
      {shown.length ? (
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <SortTable caption="Every device in scope" head={[
            { label: 'Device', style: { textAlign: 'left' } }, { label: 'Status', style: { textAlign: 'left' } }, { label: 'Battery now' },
            { label: 'Cycles' }, { label: 'Test days' }, { label: 'Last cycle' }, { label: 'Avg cycle time' }, { label: 'Avg drain' },
            { label: 'Hottest' }, { label: 'Lifetime cycles (MDM)' },
          ]}>
            {shown.map((r) => {
              const snap = snapOf(r.sn), st = status({ snap })
              return (
                <tr key={r.sn} className="row-link" onClick={() => onOpen(r.sn)}>
                  <td style={{ textAlign: 'left' }}><button type="button" className="link-btn plain-link mono" onClick={(e) => { e.stopPropagation(); onOpen(r.sn) }}>{r.sn}</button></td>
                  <td style={{ textAlign: 'left' }}><span className={`pill ${st.k === 'run' ? 'pill-run' : st.k === 'ready' ? 'pill-ok' : st.k === 'warn' ? 'pill-warn' : ''}`}>{st.label}</span></td>
                  <td>{st.pct != null ? `${st.pct}%` : DASH}</td>
                  <td>{fmtInt(r.own.length)}</td>
                  <td>{fmtInt(r.days)}</td>
                  <td>{r.last ? fmtDate(r.last) : DASH}</td>
                  <td>{fmtHours(r.k.avgDuration)}</td>
                  <td>{fmtRate(r.k.avgDropPerHr)}</td>
                  <td>{fmtTemp(r.peak)}</td>
                  <td>{fmtLifetime(lifetimeCycles(snap))}</td>
                </tr>
              )
            })}
          </SortTable>
        </div>
      ) : <div className="empty">No device matches “{q.trim()}”.</div>}
    </Card>
  )
}
