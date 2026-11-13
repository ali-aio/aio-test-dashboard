import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribePhone, getPhone, setPhoneStart, phoneStart, phoneDevices, phoneHours, setPhoneDevice, setPhonePct, cellKey, devKey, subscribeIphones, getIphones, onPadAt, padAt, readT7s, iphoneEnd } from '../lib/phoneLog.js'
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
// A cell with no typed value shows the iPhone's own reading (read over Wi-Fi, `auto`) in blue; typing over it saves the typed one.
function Cell({ day, serial, h, value, auto, title }) {
  const shown = value ?? auto ?? ''
  const [v, setV] = useState(shown)
  const timer = useRef(null)
  const typing = useRef(false)
  useEffect(() => { if (!typing.current) setV(shown) }, [shown])
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
  return <input className={`input phone-cell${value == null && auto != null ? ' phone-auto' : ''}`} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={v} placeholder="%" title={title}
    aria-label={title} onChange={change} onBlur={() => typing.current && save(v)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}

// Under the T7's serial: the iPhone's battery as last read over Wi-Fi, or that it isn't answering
function PhoneLive({ ph, now, onPad }) {
  // no load on the T7's pad now = the iPhone was taken off it: its battery isn't shown (the user, 2 Nov 2026)
  if (onPad === false) return <div className="phone-live off" title="the iPhone isn't charging on this T7's pad now — its battery is shown only while it is (the iPhones card below has it either way)">iPhone off the pad</div>
  // the phone sends on the hour (its Shortcuts automation) and is read over Wi-Fi while awake, so
  // its latest reading can be up to an hour old and still be on time
  const stale = !ph.lastOk || now - ph.lastOk > 75 * 60e3
  if (stale) return <div className="phone-live down" title={ph.error || 'nothing yet'}>iPhone not heard from{ph.last ? ` · last ${ph.last.pct}% at ${hm(ph.last.at)}` : ''}</div>
  return <div className="phone-live" title={`${ph.name}${ph.key ? ` (${ph.key})` : ''}: sends its battery on the hour, and is read over Wi-Fi by the lab laptop while awake`}>iPhone {ph.last.pct}%{ph.last.charging ? ' ⚡' : ''} · {hm(ph.last.at)}</div>
}

const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default function PhoneOnPad({ day, start: benchStart, end, serials, now, ownStart = () => null, maxHours = null }) {
  const db = useSyncExternalStore(subscribePhone, getPhone, getPhone)
  const ip = useSyncExternalStore(subscribeIphones, getIphones, getIphones)
  // the T7s carrying an iPhone: the ones picked by hand, and any whose iPhone the lab laptop has been
  // reading over Wi-Fi during this cycle (unless someone took it off the list with ×)
  const picked = phoneDevices(db, day)
  const devices = [...picked, ...readT7s(ip, benchStart - 2 * H, now + 60e3, rowsFor)
    .filter(sn => serials.includes(sn) && !picked.includes(sn) && db.devices?.[devKey(day, sn)]?.on !== false)]
  const phoneOn = sn => ip.phones?.find(x => x.t7 === sn)
  // the iPhone's own reading only while it is on this T7's pad (a load there): off the pad it's not this T7's
  const autoAt = sn => h => onPadAt(ip.readings?.[sn], rowsFor(sn), start + h * H, now)
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
  // a test with a set load time (Restaurant Case, WLC + Discharge: 3 h) shows only those hours — the iPhone is the load
  // (the user, 3 Nov 2026: "remove 4, 5, 6, 7 h"); readings after them stay on record, not shown or counted
  const last = Math.max(1, Math.min(maxHours || 24, Math.floor((upTo - start) / H) + 1))
  const typed = (sn, h) => db.cells?.[cellKey(day, sn, h)]?.pct != null || autoAt(sn)(h) != null
  const shownFor = sn => { const set = new Set([0, 1]); for (let h = 2; h <= last; h++) if (typed(sn, h) || loadIn(sn, start + (h - 1) * H, Math.min(start + h * H, upTo + 1))) set.add(h); return set }
  const shown = new Map(devices.map(sn => [sn, shownFor(sn)]))
  // when each iPhone finished: reached 100 %, or came off the pad (the user, 4 Nov 2026: in place of the empty "next" hour)
  const ends = new Map(devices.map(sn => [sn, iphoneEnd(ip.readings?.[sn], rowsFor(sn), start - 30 * 60e3)]))
  const allEnded = devices.length && devices.every(sn => ends.get(sn))
  const lastEnd = allEnded ? Math.max(...devices.map(sn => ends.get(sn).at)) : null
  // once every iPhone has finished, no hour after the last one is shown (no "next" hour to type into)
  const hours = Array.from({ length: last + 1 }, (_, h) => h).filter(h => devices.some(sn => shown.get(sn).has(h)) && (lastEnd == null || start + h * H <= lastEnd))
  const anyEnd = devices.some(sn => ends.get(sn))
  const dur = ms => { const m = Math.max(0, Math.round(ms / 60e3)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
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
          {anyEnd && <th className="r"><div>Full / off pad</div><div className="secondary" style={{ fontWeight: 400 }}>iPhone</div></th>}
          <th className="r">Gained</th><th className="r">Per hour</th><th className="r">Full at</th><th /></tr></thead>
        <tbody>{devices.map(s => {
          const p = phoneHours(db, day, s, last, autoAt(s)), ph = phoneOn(s), e = ends.get(s)
          // with an end, Gained / Per hour run from the first reading to it, and Full at is the time to 100 %
          const first = p.rows.find(r => r.pct != null && hours.includes(r.h))
          if (e && first) { p.total = e.pct - first.pct; const span = (e.at - (start + first.h * H)) / H; p.perH = span > 0 ? p.total / span : null }
          return <tr key={s}>
            <td className="mono">{s}{ph ? <PhoneLive ph={ph} now={now} onPad={padAt(rowsFor(s), now) === false || (ph.last && !ph.last.charging) ? false : padAt(rowsFor(s), now)} /> : null}</td>
            {p.rows.filter(r => hours.includes(r.h)).map(r => { const t7 = start + r.h * H > now ? null : t7At(s, start + r.h * H); if (e && start + r.h * H > e.at) return <td key={r.h} className="r secondary" title={`the iPhone ${e.why === 'full' ? 'reached 100 %' : 'came off the pad'} at ${hm(e.at)}`}>—</td>; if (!shown.get(s).has(r.h)) return <td key={r.h} className="r secondary" title="no load on this T7's pad in the hour before">no load</td>; return (
              <td key={r.h} className="r">
                <Cell day={day} serial={s} h={r.h} value={r.auto ? null : r.pct} auto={r.auto?.pct} title={`iPhone battery on ${s} at ${hm(start + r.h * H)} (${r.h === 0 ? 'cycle start' : `hour ${r.h}`})${r.auto ? (r.auto.est ? ` · from the iPhone: between ${r.auto.est.a}% at ${hm(r.auto.est.from)} and ${r.auto.est.b}% at ${hm(r.auto.est.to)} — type to replace` : ` · read from the iPhone at ${hm(r.auto.at)} — type to replace`) : ''}`} />
                <div className="phone-sub">{r.gain != null ? <b className={r.gain > 0 ? 'up' : r.gain < 0 ? 'down' : ''}>{r.gain > 0 ? '+' : ''}{r.gain}%</b> : null}
                  {t7 != null ? <span className="secondary" title="the T7's own battery at that time (MDM)">T7 {t7}%</span> : null}</div>
              </td>) })}
            {anyEnd && <td className="r mono" title={e ? `${e.why === 'full' ? 'reached 100 %' : 'taken off the pad (stopped charging, no load on the pad)'} at ${hm(e.at)}, ${dur(e.at - start)} after the start` : 'still on the pad'}>
              {e ? <><div>{e.pct}% · {hm(e.at)}</div><div className="secondary" style={{ fontSize: 11 }}>{e.why === 'full' ? 'full' : 'off the pad'}</div></> : '—'}</td>}
            <td className="r mono">{p.total != null ? `${p.total > 0 ? '+' : ''}${p.total}%` : '—'}</td>
            <td className="r mono">{p.perH != null ? `${p.perH.toFixed(1)} %/h` : '—'}</td>
            <td className="r mono">{e?.why === 'full' ? dur(e.at - start) : p.fullAt != null ? (p.fullAt === 0 ? 'at start' : `${p.fullAt} h`) : '—'}</td>
            <td className="r"><button type="button" className="btn btn-sm" title={`Take ${s} off this list`} onClick={() => remove(s)}>×</button></td>
          </tr>
        })}</tbody>
      </table></div>}
    </div>
  )
}
