import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { labDevices } from '../lib/data.js'
import { labChanges, onBenchAt, byBenchOrder, online, fullSerial, keepDevice } from '../lib/device.js'
import { ago } from '../lib/format.js'

// The lab's device list, changed here (the user, 13 Nov 2026: "remove 281 … or add a section in Summary to add a device, then show
// that device on Today from that day on"). Removing takes a device off Today and the bell from that day; its past cycles stay.
// Adding a serial the MDM knows shows it on Today from that day. Every change is logged here and as a note on the device.
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
const day = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })

export default function LabDevices({ fleet }) {
  const [changes, setChanges] = useState(labChanges())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [serial, setSerial] = useState('')
  const [note, setNote] = useState('')
  const [arm, setArm] = useState(null), armT = useRef(null)
  useEffect(() => { labDevices().then(j => { if (j.ok) setChanges(j.changes) }).catch(() => {}); return () => clearTimeout(armT.current) }, [])
  const send = async (body, done) => {
    setErr(''); setBusy(true)
    try { const j = await labDevices({ ...body, by: by() }); if (j.ok) { setChanges(j.changes); done?.() } else setErr(j.error || `HTTP ${j.http}`) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // a click arms Remove for 5 s; a second click removes (no pop-up: a blocked confirm() says no silently)
  const remove = sn => {
    if (arm !== sn) { setArm(sn); clearTimeout(armT.current); armT.current = setTimeout(() => setArm(null), 5000); return }
    setArm(null); send({ remove: sn, note })
  }
  const now = Date.now()
  const all = [...(fleet?.DEV || [])]
  const onBench = all.filter(d => onBenchAt(d.serial, now)).sort((a, b) => byBenchOrder(a.serial, b.serial))
  const off = [...new Set(changes.map(c => c.serial))].filter(sn => !onBenchAt(sn, now) && keepDevice({ serial_number: sn }))
  const since = sn => { const c = [...changes].reverse().find(x => x.serial === sn && x.action === 'add'); return c ? `added ${day(c.at)}` : 'from the start' }
  const removedOn = sn => { const c = [...changes].reverse().find(x => x.serial === sn && x.action === 'remove'); return c ? day(c.at) : '—' }
  const add = () => { const sn = fullSerial(serial); if (!sn) { setErr('Type a serial, e.g. 00281 or AT070AABU00281'); return } send({ add: sn, note }, () => { setSerial(''); setNote('') }) }
  return (
    <Card title={`Lab devices · ${onBench.length} on the bench`} collapsible
      sub="The devices Today shows. Removing one takes it off Today from today on — its past cycles stay; adding one shows it from today on.">
      <div className="lab-devices">
        <div className="lab-add">
          <input className="control mono" placeholder="Serial (00281 or AT070AABU00281)" value={serial} onChange={e => setSerial(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }} aria-label="Serial to add" />
          <input className="control" placeholder="Why (optional, goes on the device's notes)" value={note} onChange={e => setNote(e.target.value)} aria-label="Why" />
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !serial.trim()} onClick={add}>Add to the bench</button>
          {err && <span className="error-text">{err}</span>}
        </div>
        <div className="scroll-x"><SortTable caption="Devices on the bench" head={[{ label: 'Device' }, { label: 'Battery', className: 'r' }, { label: 'Last seen', className: 'r' }, { label: 'On the bench' }, { label: '', sortable: false }]}>
          {onBench.map(d => (
            <tr key={d.serial}>
              <td className="mono"><a className="link-btn plain-link mono" href={`#/nx/device/${d.serial}`}>{d.serial}</a></td>
              <td className="r mono">{d.snap?.battery_pct != null ? `${d.snap.battery_pct}%` : '—'}</td>
              <td className={`r${online(d) ? '' : ' secondary'}`}>{d.snap?.last_seen_at ? ago(Date.parse(d.snap.last_seen_at)) : '—'}</td>
              <td className="secondary">{since(d.serial)}</td>
              <td className="r"><button type="button" className="link-btn" disabled={busy} onClick={() => remove(d.serial)}>{arm === d.serial ? 'Click again to remove from today on' : 'Remove'}</button></td>
            </tr>
          ))}
        </SortTable></div>
        {off.length > 0 && <div className="lab-off"><b>Removed</b>{off.map(sn => (
          <span key={sn}><span className="mono">{sn}</span> <span className="secondary">· since {removedOn(sn)}</span>{' '}
            <button type="button" className="link-btn" disabled={busy} onClick={() => send({ add: sn, note })}>Add back</button></span>))}</div>}
        {changes.length > 0 && <div className="lab-log secondary">{[...changes].reverse().slice(0, 12).map(c => (
          <span key={c.id}>{day(c.at)} · {c.action === 'add' ? 'added' : 'removed'} <span className="mono">{c.serial}</span>{c.by ? ` · ${c.by}` : ''}{c.note ? ` — ${c.note}` : ''}</span>))}</div>}
      </div>
    </Card>
  )
}
