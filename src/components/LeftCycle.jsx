import React, { useMemo, useState } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { LineChart } from './t7charts.jsx'
import { fmtDate, fmtHours, fmtPct, fmtSerial, fmtHourTick, compareSerial } from '../lib/fmt.js'

// Devices that left the cycle (taken out on Today, or no longer doing what the test does): their data
// up to then is the cycle's, and here each one's whole run can be opened (the user, 2 Nov 2026: "when
// device leave cycle then when this cycle open show that cycle data and also show drop down or whatever
// to view full device behaviour"). The full run comes from adapt.js `fullRun` and is never counted.
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function LeftCycle({ cycles, styleMap, onPick }) {
  const left = useMemo(() => cycles.filter((c) => c.leftCycle)
    .sort((a, b) => b.start - a.start || compareSerial(a.serial, b.serial)), [cycles])
  const [open, setOpen] = useState(null)
  if (!left.length) return null
  return (
    <Card collapsible defaultOpen={left.length <= 6} title={`Left the cycle · ${left.length} device run${left.length === 1 ? '' : 's'}`}
      sub="Taken out, or no longer running the test (the reason is beside each). Up to that moment it counts for the test and shows in the charts above; ▸ Full run shows what the device did for the rest of its run — not counted.">
      <SortTable caption="Device runs that left the cycle" head={[
        { label: 'Device', style: { textAlign: 'left' } }, { label: 'Date' }, { label: 'Started' }, { label: 'Left at' },
        { label: 'In the cycle' }, { label: 'Battery then' }, { label: 'Why', style: { textAlign: 'left' } },
        { label: 'Whole run' }, { label: '', sortable: false },
      ]}>
        {left.flatMap((c) => {
          const f = c.fullRun, isOpen = open === c.id
          const row = (
            <tr key={c.id}>
              <td style={{ textAlign: 'left' }}><button type="button" className="link-btn mono" onClick={() => onPick?.(c.serial)} title="Show only this device in the charts above">{fmtSerial(c.serial)}</button></td>
              <td>{fmtDate(c.date)}</td>
              <td>{clock(c.start)}</td>
              <td>{clock(c.leftCycle.at)}</td>
              <td>{fmtHours(c.ranH ?? c.duration)}</td>
              <td>{fmtPct(c.endBattery)}</td>
              <td style={{ textAlign: 'left' }}>{c.leftCycle.why}</td>
              <td>{f ? `${fmtHours(f.hours)} · ${fmtPct(c.startBattery)} → ${fmtPct(f.endPct)}${f.inProgress ? ' · running' : ` · to ${clock(f.end)}`}` : '—'}</td>
              <td>{f?.series?.length > 1 && <button type="button" className="btn btn-sm" aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : c.id)}>{isOpen ? '▾ Full run' : '▸ Full run'}</button>}</td>
            </tr>
          )
          if (!isOpen) return [row]
          const cutH = (c.leftCycle.at - c.start) / 3600e3
          const style = styleMap?.get(c.serial) || { color: 'var(--accent)' }
          const before = f.series.filter((p) => p.t <= cutH)
          const after = f.series.filter((p) => p.t >= cutH)
          // join the two lines at the moment it left
          const joint = { t: Math.round(cutH * 1000) / 1000, v: c.endBattery }
          const series = [
            { id: 'in', label: `In the cycle · to ${clock(c.leftCycle.at)}`, color: style.color, points: before.length ? [...before.filter((p) => p.t < cutH), joint] : [joint] },
            { id: 'after', label: 'After it left · not counted', color: 'var(--text-secondary)', dash: '5 4', points: [joint, ...after.filter((p) => p.t > cutH)] },
          ]
          return [row, (
            <tr key={`${c.id}-full`} data-attached>
              <td colSpan={9} style={{ padding: '8px 4px 16px' }}>
                <LineChart series={series} xDomain={[0, Math.max(1, Math.ceil(f.hours))]} yDomain={[0, 100]}
                  formatX={fmtHourTick} formatY={(v) => `${v}%`} xLabel="elapsed time" xUnit="h" height={220}
                  caption={`${c.serial}: its whole run, ${c.leftCycle.why} at ${clock(c.leftCycle.at)}`} />
              </td>
            </tr>
          )]
        })}
      </SortTable>
    </Card>
  )
}
