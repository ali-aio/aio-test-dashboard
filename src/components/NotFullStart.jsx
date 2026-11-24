import React from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { fmtDate, fmtHours, fmtPct, fmtSerial, compareSerial } from '../lib/fmt.js'

// Devices that ran with the cycle's bench but came off the charger below 95 % (the user, 24 Nov 2026: "there should be a separate
// drop-down for devices that weren't in the cycle"): in the cycle, listed here apart from Every cycle, never in its averages.
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function NotFullStart({ cycles, onPick }) {
  const rows = cycles.filter((c) => c.partialStart != null).sort((a, b) => b.start - a.start || compareSerial(a.serial, b.serial))
  if (!rows.length) return null
  return (
    <Card collapsible defaultOpen={false} title={`Not fully charged at the start · ${rows.length} device run${rows.length === 1 ? '' : 's'}`}
      sub="Ran with the bench but came off the charger below 95 %, so not a full cycle: shown here, not in Every cycle or the averages. A device opens it in the charts above.">
      <SortTable caption="Device runs that started below 95 %" head={[
        { label: 'Device', style: { textAlign: 'left' } }, { label: 'Date' }, { label: 'Off charger' }, { label: 'Battery then' },
        { label: 'Ran' }, { label: 'End battery' }, { label: 'Ended' },
      ]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td style={{ textAlign: 'left' }}><button type="button" className="link-btn mono" onClick={() => onPick?.(c.serial)} title="Show only this device in the charts above">{fmtSerial(c.serial)}</button></td>
            <td>{fmtDate(c.date)}</td>
            <td>{clock(c.start)}</td>
            <td>{fmtPct(c.partialStart)}</td>
            <td>{fmtHours(c.ranH ?? c.duration)}</td>
            <td>{fmtPct(c.endBattery)}</td>
            <td>{c.inProgress ? 'running' : clock(c.end)}</td>
          </tr>
        ))}
      </SortTable>
    </Card>
  )
}
