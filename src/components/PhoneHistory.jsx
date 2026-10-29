import React, { useEffect, useSyncExternalStore } from 'react'
import { subscribePhone, getPhone, startPhoneSync, phoneDevices, phoneHours, phoneStart } from '../lib/phoneLog.js'
import { dayKey } from '../lib/plan.js'
import { hm, H } from '../lib/format.js'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'

// The iPhone readings typed in on Today (iPhone on the pad), read-only, for cycles that have ended:
// on a test screen and the device page (the user, 29 Oct 2026: "when the cycle ends, does it show the
// phone data … for the specific device"). One row per cycle day × T7 that carried an iPhone; each hour's
// iPhone battery with the gain since the entry before. The day is the cycle's start day, as on Today.
export default function PhoneHistory({ cycles }) {
  const db = useSyncExternalStore(subscribePhone, getPhone, getPhone)
  useEffect(() => startPhoneSync(), [])
  // the T7s with an iPhone on each cycle day, among these cycles
  const byDay = new Map()
  for (const c of cycles) {
    if (c.start == null || c.endBattery > c.startBattery) continue // discharges only (the iPhone sits on a running cycle)
    const day = dayKey(c.start)
    if (!phoneDevices(db, day).includes(c.serial)) continue
    if (!byDay.has(day)) byDay.set(day, new Map())
    const m = byDay.get(day); if (!m.has(c.serial) || c.start < m.get(c.serial)) m.set(c.serial, c.start)
  }
  const rows = []
  for (const [day, m] of byDay) {
    const start = phoneStart(db, day) ?? Math.min(...m.values())
    for (const sn of m.keys()) {
      const p = phoneHours(db, day, sn, 24), got = p.rows.filter(r => r.pct != null)
      if (got.length) rows.push({ day, sn, start, p, last: got[got.length - 1].h })
    }
  }
  if (!rows.length) return null
  rows.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.sn < b.sn ? -1 : 1))
  const maxH = Math.max(...rows.map(r => r.last))
  const hours = Array.from({ length: maxH + 1 }, (_, h) => h)
  const dateOf = day => new Date(`${day}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })
  return (
    <Card expandable title="iPhone on the pad" sub="iPhone battery typed in on Today, each hour of the cycle · gain since the entry before below it · hour 0 = the start">
      <div className="scroll-x"><SortTable head={[{ label: 'Date' }, { label: 'T7' }, { label: 'Start', className: 'r' },
        ...hours.map(h => ({ label: h === 0 ? '0 h' : `${h} h`, className: 'r', sortable: false })),
        { label: 'Gained', className: 'r' }, { label: 'Per hour', className: 'r' }, { label: 'Full at', className: 'r' }]}>
        {rows.map(r => (
          <tr key={r.day + r.sn}>
            <td>{dateOf(r.day)}</td>
            <td className="mono">{r.sn}</td>
            <td className="r mono">{hm(r.start)}</td>
            {hours.map(h => { const x = r.p.rows[h]; return (
              <td key={h} className="r mono" title={`${hm(r.start + h * H)}`}>
                {x?.pct != null ? <>{x.pct}%{x.gain != null ? <div className="phone-sub"><b className={x.gain > 0 ? 'up' : x.gain < 0 ? 'down' : ''}>{x.gain > 0 ? '+' : ''}{x.gain}%</b></div> : null}</> : <span className="secondary">—</span>}
              </td>) })}
            <td className="r mono">{r.p.total != null ? `${r.p.total > 0 ? '+' : ''}${r.p.total}%` : '—'}</td>
            <td className="r mono">{r.p.perH != null ? `${r.p.perH.toFixed(1)} %/h` : '—'}</td>
            <td className="r mono">{r.p.fullAt != null ? (r.p.fullAt === 0 ? 'at start' : `${r.p.fullAt} h`) : '—'}</td>
          </tr>
        ))}
      </SortTable></div>
    </Card>
  )
}
