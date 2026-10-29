import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribePhone, getPhone, setPhoneStart, phoneStart, phoneDevices, phoneHours, setPhoneDevice, setPhonePct, cellKey } from '../lib/phoneLog.js'
import { rowsFor } from '../lib/window.js'
import { padLoad } from '../lib/pad.js'
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

// A load on this T7's pad in [a, b): two readings with one (a lone reading is a blip), or the
// latest reading when the hour is still running
const loadIn = (serial, a, b) => {
  const rows = rowsFor(serial); let n = 0
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = Date.parse(rows[i].timestamp); if (t < a) break; if (t >= b) continue
    if (padLoad(rows[i].extra?.wlc_status)) { n++; if (n >= 2 || i === rows.length - 1) return true }
  }
  return false
}

// A plain box for the iPhone's battery %: digits only (no up / down arrows), saved as soon as a
// value is typed — half a second after the last key, or at once on Enter / leaving the box (the user, 27 Oct 2026)
function Cell({ day, serial, h, value, title }) {
  const [v, setV] = useState(value ?? '')
  const timer = useRef(null)
  const typing = useRef(false)
  useEffect(() => { if (!typing.current) setV(value ?? '') }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])
  const save = (raw) => {
    clearTimeout(timer.current); typing.current = false
    const n = raw === '' ? null : Math.min(100, +raw)
    if (n !== (value ?? null)) setPhonePct(day, serial, h, n, by())
  }
  const change = e => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 3)
    setV(raw); typing.current = true
    clearTimeout(timer.current); timer.current = setTimeout(() => save(raw), 500)
  }
  return <input className="input phone-cell" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={v} placeholder="%" title={title}
    aria-label={title} onChange={change} onBlur={() => typing.current && save(v)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}

const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default function PhoneOnPad({ day, start: benchStart, end, serials, now, ownStart = () => null }) {
  const db = useSyncExternalStore(subscribePhone, getPhone, getPhone)
  const devices = phoneDevices(db, day)
  // the start: set by hand (shared), else when these T7s came off the charger (median of their own
  // starts), else the bench's — 29 Oct 2026 the bench came off at 10:00 but the iPhone T7s at 11:30 (the user)
  const own = devices.map(ownStart).filter(Number.isFinite).sort((a, b) => a - b)
  const auto = own.length ? Math.round(own[Math.floor((own.length - 1) / 2)] / 60e3) * 60e3 : benchStart
  const manual = phoneStart(db, day)
  const start = manual ?? auto
  const [editing, setEditing] = useState(false)
  const setStart = v => { // "HH:MM" on the cycle's day (the day after if before the auto start's day … kept simple: nearest to auto)
    if (!v) return
    const [hh, mm] = v.split(':').map(Number), d = new Date(auto); d.setHours(hh, mm, 0, 0)
    let t = d.getTime(); if (t - auto > 12 * H) t -= 24 * H; else if (auto - t > 12 * H) t += 24 * H
    setPhoneStart(day, t, by()); setEditing(false)
  }
  // hour 0 = the cycle's start, then one column per hour (the user, 27 Oct 2026: started at 10 → 11, 12, …).
  // The next hour is there before it comes, to type into on the hour; after hour 1 a device gets an
  // hour only if its pad had a load (the iPhone) during the hour before it, or something was typed there.
  const upTo = Math.min(Math.min(now, end ?? now), now)
  const last = Math.max(1, Math.min(24, Math.floor((upTo - start) / H) + 1))
  const typed = (sn, h) => db.cells?.[cellKey(day, sn, h)]?.pct != null
  const shownFor = sn => { const set = new Set([0, 1]); for (let h = 2; h <= last; h++) if (typed(sn, h) || loadIn(sn, start + (h - 1) * H, Math.min(start + h * H, upTo + 1))) set.add(h); return set }
  const shown = new Map(devices.map(sn => [sn, shownFor(sn)]))
  const hours = Array.from({ length: last + 1 }, (_, h) => h).filter(h => devices.some(sn => shown.get(sn).has(h)))
  const free = serials.filter(s => !devices.includes(s))
  const remove = s => {
    const has = hours.some(h => db.cells?.[cellKey(day, s, h)]?.pct != null)
    if (!has || confirm(`Take ${s} off the iPhone list? Its typed readings stay on record and come back if you add it again.`)) setPhoneDevice(day, s, false, by())
  }
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>iPhone on the pad</h2>
          <div className="card-sub">iPhone battery % each hour · gain below · T7 battery in grey · start{' '}
            {editing
              ? <input type="time" className="input phone-start" autoFocus defaultValue={hhmm(start)} aria-label="Start time of the iPhone hours"
                  onBlur={e => { setStart(e.target.value); setEditing(false) }} onKeyDown={e => { if (e.key === 'Enter') setStart(e.currentTarget.value); if (e.key === 'Escape') setEditing(false) }} />
              : <button type="button" className="link-btn" title={manual != null ? 'set by hand · click to change' : own.length ? 'when these T7s came off the charger · click to change' : 'the cycle start · click to change'}
                  onClick={() => setEditing(true)}>{hm(start)} ✎</button>}
            {manual != null && !editing && <> · <button type="button" className="link-btn" onClick={() => setPhoneStart(day, null, by())}>use {hm(auto)} (off charger)</button></>}
          </div></div>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          {/* picking a T7 adds it straight away (no Add button — the user, 27 Oct 2026) */}
          <select className="control" value="" onChange={e => { if (e.target.value) setPhoneDevice(day, e.target.value, true, by()) }} aria-label="Add a T7 with an iPhone on its pad">
            <option value="">Add a T7 with an iPhone…</option>
            {free.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </span>
      </div>
      {!devices.length ? <div className="empty">No iPhone on a pad in this cycle. Pick the T7 above to start noting the iPhone's battery each hour.</div> :
      <div className="scroll-x"><table className="data phone-table">
        <thead><tr><th>T7</th>
          {hours.map(h => <th key={h} className="r"><div>{h === 0 ? 'Start' : `${h} h`}{start + h * H > now ? <span className="secondary" style={{ fontWeight: 400 }}> · next</span> : null}</div><div className="secondary" style={{ fontWeight: 400 }}>{hm(start + h * H)}</div></th>)}
          <th className="r">Gained</th><th className="r">Per hour</th><th className="r">Full at</th><th /></tr></thead>
        <tbody>{devices.map(s => {
          const p = phoneHours(db, day, s, last)
          return <tr key={s}>
            <td className="mono">{s}</td>
            {p.rows.filter(r => hours.includes(r.h)).map(r => { const t7 = start + r.h * H > now ? null : t7At(s, start + r.h * H); if (!shown.get(s).has(r.h)) return <td key={r.h} className="r secondary" title="no load on this T7's pad in the hour before">no load</td>; return (
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
