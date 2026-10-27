import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribePhone, getPhone, startPhoneSync, phoneDevices, phoneHours, setPhoneDevice, setPhonePct, cellKey } from '../lib/phoneLog.js'
import { rowsFor } from '../lib/window.js'
import { hm, H } from '../lib/format.js'

// Today: the T7s carrying an iPhone on the wireless pad in place of the load, and the iPhone's
// battery typed in by the lab each hour of the cycle, with each hour's gain (the lab, 27 Oct 2026).
// The MDM has only the T7's battery — beside each entry, in grey, is the T7's at that time.
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
const t7At = (serial, t) => {
  const rows = rowsFor(serial); let best = null
  for (let i = rows.length - 1; i >= 0; i--) { const ts = Date.parse(rows[i].timestamp); if (ts <= t + 10 * 60e3) { if (t - ts < 30 * 60e3) best = rows[i]; break } }
  return best?.battery_pct ?? null
}

function Cell({ day, serial, h, value, title }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  const save = () => { const n = v === '' ? null : Math.max(0, Math.min(100, Math.round(+v))); if (n !== (value ?? null) && (n == null || Number.isFinite(n))) setPhonePct(day, serial, h, n, by()) }
  return <input className="input phone-cell" type="number" min="0" max="100" inputMode="numeric" value={v} placeholder="%" title={title}
    aria-label={title} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}

export default function PhoneOnPad({ day, start, end, serials, now }) {
  const db = useSyncExternalStore(subscribePhone, getPhone, getPhone)
  useEffect(() => startPhoneSync(), [])
  const [adding, setAdding] = useState('')
  const devices = phoneDevices(db, day)
  // hour 0 = the cycle's start; a column for every hour reached so far
  const last = Math.max(0, Math.min(24, Math.floor((Math.min(now, end ?? now) - start) / H)))
  const hours = Array.from({ length: last + 1 }, (_, h) => h)
  const free = serials.filter(s => !devices.includes(s))
  const add = () => { if (adding) { setPhoneDevice(day, adding, true, by()); setAdding('') } }
  const remove = s => {
    const has = hours.some(h => db.cells?.[cellKey(day, s, h)]?.pct != null)
    if (!has || confirm(`Take ${s} off the iPhone list? Its typed readings stay on record and come back if you add it again.`)) setPhoneDevice(day, s, false, by())
  }
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>iPhone on the pad</h2>
          <div className="card-sub">iPhone battery typed in each hour (the MDM reports only the T7's) · gain per hour below each entry · T7 battery in grey</div></div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="control" value={adding} onChange={e => setAdding(e.target.value)} aria-label="T7 with an iPhone on its pad">
            <option value="">Add a T7 with an iPhone…</option>
            {free.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="btn btn-sm" disabled={!adding} onClick={add}>Add</button>
        </span>
      </div>
      {!devices.length ? <div className="empty">No iPhone on a pad in this cycle. Pick the T7 above to start noting the iPhone's battery each hour.</div> :
      <div className="scroll-x"><table className="data phone-table">
        <thead><tr><th>T7</th>
          {hours.map(h => <th key={h} className="r"><div>{h === 0 ? 'Start' : `${h} h`}</div><div className="secondary" style={{ fontWeight: 400 }}>{hm(start + h * H)}</div></th>)}
          <th className="r">Gained</th><th className="r">Per hour</th><th className="r">Full at</th><th /></tr></thead>
        <tbody>{devices.map(s => {
          const p = phoneHours(db, day, s, last)
          return <tr key={s}>
            <td className="mono">{s}</td>
            {p.rows.map(r => { const t7 = t7At(s, start + r.h * H); return (
              <td key={r.h} className="r">
                <Cell day={day} serial={s} h={r.h} value={r.pct} title={`iPhone battery on ${s} at ${hm(start + r.h * H)} (${r.h === 0 ? 'cycle start' : `hour ${r.h}`})`} />
                <div className="phone-sub">{r.gain != null ? <b className={r.gain > 0 ? 'up' : r.gain < 0 ? 'down' : ''}>{r.gain > 0 ? '+' : ''}{r.gain}%</b> : null}
                  {t7 != null ? <span className="secondary" title="the T7's own battery at that time (MDM)">T7 {t7}%</span> : null}</div>
              </td>) })}
            <td className="r mono">{p.total != null ? `${p.total > 0 ? '+' : ''}${p.total}%` : '—'}</td>
            <td className="r mono">{p.perH != null ? `${p.perH.toFixed(1)} %/h` : '—'}</td>
            <td className="r mono">{p.fullAt != null ? (p.fullAt === 0 ? 'at start' : `${p.fullAt} h`) : '—'}</td>
            <td className="r"><button type="button" className="btn btn-sm" title={`Take ${s} off this list`} onClick={() => remove(s)}>×</button></td>
          </tr>
        })}</tbody>
      </table></div>}
    </div>
  )
}
