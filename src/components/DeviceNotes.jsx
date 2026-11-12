import React, { useEffect, useRef, useState } from 'react'
import { Card } from './Primitives.jsx'
import { deviceNotes } from '../lib/data.js'

// Notes on one device, kept for good and shared by every browser (the user, 6 Nov 2026: "after a week or month or year, if someone
// wants to see what happened to those devices today"). Newest first, on the device page. Saved on the lab laptop (server/deviceNotes.mjs).
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function DeviceNotes({ serial }) {
  const [notes, setNotes] = useState(null)      // null while loading
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null)  // { id, text }
  const [arm, setArm] = useState(null)          // the note armed for removal: two clicks, no pop-up (a blocked confirm() says no silently)
  const armT = useRef(null)
  useEffect(() => {
    let live = true
    setNotes(null); setErr(''); setAdding(false); setEditing(null); setArm(null)
    deviceNotes(serial).then(j => { if (!live) return; if (j.ok) setNotes(j.notes); else setErr(j.error || `HTTP ${j.http}`) })
      .catch(e => { if (live) setErr(e.message) })
    return () => { live = false; clearTimeout(armT.current) }
  }, [serial])
  const send = async (body, done) => {
    setErr('')
    try {
      const j = await deviceNotes(serial, body)
      if (j.ok) { setNotes(j.notes); done?.() } else setErr(j.error || `HTTP ${j.http}`)
    } catch (e) { setErr(e.message) }
  }
  const add = () => text.trim() && send({ text, by: by() }, () => { setText(''); setAdding(false) })
  const remove = (id) => {
    if (arm !== id) { setArm(id); clearTimeout(armT.current); armT.current = setTimeout(() => setArm(null), 5000); return }
    setArm(null); send({ remove: id })
  }
  return (
    <Card title="Notes" sub="What happened to this device, kept for good"
      right={!adding && notes && <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>+ Add a note</button>}>
      {adding && <div className="cycle-note-edit" style={{ marginTop: 0, marginBottom: 10 }}>
        <textarea className="input" rows={3} autoFocus value={text} onChange={e => setText(e.target.value)} aria-label="New note" />
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={add}>Save note</button>
          <button type="button" className="btn btn-sm" onClick={() => { setText(''); setAdding(false) }}>Cancel</button></span>
      </div>}
      {err && <div className="hint app-all-bad" role="alert">Couldn’t reach the notes: {err}</div>}
      {notes === null && !err && <div className="secondary">Loading notes…</div>}
      {notes?.length === 0 && !adding && <div className="secondary">No notes on this device yet.</div>}
      {notes?.length > 0 && <div className="device-notes">
        {notes.map(n => (
          <div key={n.id} className="device-note">
            <div className="device-note-head">
              <b>{when(n.at)}</b>{n.by && <span className="secondary"> · {n.by}</span>}
              {n.mod > n.at + 1000 && <span className="secondary" title={`Edited ${when(n.mod)}`}> · edited</span>}
              <span className="device-note-tools">
                <button type="button" className="link-btn" onClick={() => setEditing({ id: n.id, text: n.text })}>✎ edit</button>
                <button type="button" className="link-btn" onClick={() => remove(n.id)}>{arm === n.id ? 'Click again to remove' : 'Remove'}</button>
              </span>
            </div>
            {editing?.id === n.id
              ? <div className="cycle-note-edit">
                  <textarea className="input" rows={3} autoFocus value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} aria-label="Edit note" />
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-sm btn-primary" disabled={!editing.text.trim()} onClick={() => send({ edit: n.id, text: editing.text }, () => setEditing(null))}>Save note</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button></span>
                </div>
              : <div className="device-note-text">{n.text}</div>}
          </div>))}
      </div>}
    </Card>
  )
}

// The notes written on a device during a cycle, shown quietly when someone clicks that device in a cycle's list (the user, 12 Nov 2026:
// "no need to highlight the notes, the user should see them by clicking on the device"). A note counts for a cycle when it was written
// from the day the cycle started to the day after it ended. Plain lines in the "Showing only" bar; all of them stay on the device page.
const DAY = 86400e3
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
export function NotesIn({ serial, windows }) {
  const [notes, setNotes] = useState([])
  useEffect(() => {
    let live = true
    setNotes([])
    deviceNotes(serial).then(j => { if (live && j.ok) setNotes(j.notes || []) }).catch(() => {})
    return () => { live = false }
  }, [serial])
  const inCycle = n => (windows || []).some(([a, b]) => n.at >= dayStart(a) && n.at < dayStart(b ?? a) + 2 * DAY)
  const shown = notes.filter(inCycle)
  if (!shown.length) return null
  return (
    <span className="pick-out">
      {shown.map(n => <span key={n.id}><b>Note on {serial.replace(/^AT070AABU/, '')} · {when(n.at)}:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{n.text}</span></span>)}
      <a className="link" href={`#/nx/device/${serial}`}>All notes on this device</a>
    </span>
  )
}
