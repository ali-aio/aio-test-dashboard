import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  EVENT_TYPES, EVENT_SEVERITIES, SEVERITY_LEVEL, makeEvent, saveEvent,
} from '../lib/events.js'
import { Pill } from './Primitives.jsx'
import { compareSerial } from '../lib/fmt.js'

/** An epoch in the shape a datetime-local input wants, in local time. */
function toInput(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const fromInput = (value) => {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : NaN
}

/**
 * Log or edit a device event.
 *
 * One event can name several devices, because a dropped tray or an overheating
 * rack is one incident, not twelve — typing the same note a dozen times is how
 * logs stop getting written.
 */
export default function EventForm({ event, allSerials, onClose, onSaved }) {
  const isNew = !event?.id
  const dialogRef = useRef(null)

  const [at, setAt] = useState(() => toInput(event?.at ?? Date.now()))
  const [serials, setSerials] = useState(() => event?.serials ?? [])
  const [type, setType] = useState(() => event?.type ?? EVENT_TYPES[0])
  const [severity, setSeverity] = useState(() => event?.severity ?? 'minor')
  const [note, setNote] = useState(() => event?.note ?? '')
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    dialogRef.current?.querySelector('input, select, textarea')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(
    () => allSerials.filter((s) => s.toLowerCase().includes(query.toLowerCase())).sort(compareSerial),
    [allSerials, query],
  )

  const toggle = (sn) => setSerials((prev) =>
    prev.includes(sn) ? prev.filter((x) => x !== sn) : [...prev, sn])

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const { event: built, error: problem } = makeEvent({
      id: event?.id,
      createdAt: event?.createdAt,
      at: fromInput(at),
      serials,
      type,
      severity,
      note,
    })
    if (problem) { setError(problem); return }
    setSaving(true)
    try {
      await saveEvent(built)
      onSaved()
    } catch (err) {
      setError(`Could not save: ${err.message}`)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form ref={dialogRef} className="modal card" role="dialog" aria-modal="true"
        aria-label={isNew ? 'Log a device event' : 'Edit device event'} onSubmit={submit}>
        <header className="card-head">
          <h3>{isNew ? 'Log a device event' : 'Edit event'}</h3>
          <div className="header-spacer" />
          <button type="button" className="files-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="card-body modal-body">
          <div className="form-grid">
            <label className="filter-field">
              <span className="filter-label">When</span>
              <input className="control" type="datetime-local" value={at}
                onChange={(e) => setAt(e.target.value)} required />
            </label>

            <label className="filter-field">
              <span className="filter-label">What happened</span>
              <select className="control" value={type} onChange={(e) => setType(e.target.value)}>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-label">Severity</span>
              <div className="seg" role="group" aria-label="Severity">
                {EVENT_SEVERITIES.map((s) => (
                  <button key={s} type="button" aria-pressed={severity === s}
                    onClick={() => setSeverity(s)}>{s}</button>
                ))}
              </div>
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <span className="filter-label">
              Devices{serials.length > 0 ? ` · ${serials.length} selected` : ''}
            </span>
            {serials.length > 0 && (
              <div className="row row-wrap" style={{ gap: 6, margin: '6px 0' }}>
                {[...serials].sort(compareSerial).map((sn) => (
                  <span key={sn} className="file-chip">
                    {sn}
                    <button type="button" onClick={() => toggle(sn)} aria-label={`Remove ${sn}`}>×</button>
                  </span>
                ))}
              </div>
            )}
            <input className="control" style={{ width: '100%', maxWidth: 'none', margin: '6px 0' }}
              placeholder="Filter serials…" value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label="Filter serials" />
            <div className="event-serials" role="group" aria-label="Choose devices">
              {shown.map((sn) => (
                <label key={sn} className="picker-row">
                  <input type="checkbox" checked={serials.includes(sn)} onChange={() => toggle(sn)} />
                  <span className="mono">{sn}</span>
                </label>
              ))}
              {!shown.length && <div className="hint" style={{ padding: 8 }}>No serials match.</div>}
            </div>
          </div>

          <label className="filter-field" style={{ marginTop: 14 }}>
            <span className="filter-label">
              Note{type === 'Other' ? ' — required for "Other"' : ' (optional)'}
            </span>
            <textarea className="control" rows={3} value={note}
              style={{ width: '100%', maxWidth: 'none', resize: 'vertical' }}
              placeholder="What happened, and anything worth knowing when reading this device's numbers later."
              onChange={(e) => setNote(e.target.value)} />
          </label>

          {error && (
            <div className="banner banner-bad" style={{ marginTop: 12 }}>
              <span aria-hidden="true">■</span>
              <div>{error}</div>
            </div>
          )}
        </div>

        <div className="card-foot row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <span className="hint" style={{ flex: 1 }}>
            Stored in this browser only — <Pill level={SEVERITY_LEVEL[severity]}>{severity}</Pill>
          </span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Log event' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
