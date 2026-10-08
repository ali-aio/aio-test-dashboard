import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PRESETS, presetRange, dayRange, resolve, rangeLabel } from '../lib/range.js'

// The Test Date filter: "Custom range" — quick presets for recent windows, or a span of
// days picked on a Monday-first calendar (first click = start, second = end). Presets
// apply at once; a calendar span applies with Apply. Future days cannot be picked.
// Beside the calendar, the list of test dates (days with runs, newest first): a click shows
// that day, shift-click stretches the range to it.
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const sod = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

export default function RangePicker({ value, onChange, daysWithRuns = new Map() }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const live = resolve(value)
  const [cursor, setCursor] = useState(() => { const d = new Date(live?.to ?? Date.now()); return { y: d.getFullYear(), m: d.getMonth() } })
  const [draft, setDraft] = useState(null) // { a, b } day starts while picking a span

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => { if (open) setDraft(live && !value?.preset ? { a: sod(live.from), b: sod(live.to) } : null) }, [open])

  const today = sod(Date.now())
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1), lead = (first.getDay() + 6) % 7, out = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(cursor.y, cursor.m, 1 - lead + i); const t = d.getTime()
      out.push({ t, n: d.getDate(), inMonth: d.getMonth() === cursor.m, future: t > today })
    }
    return out
  }, [cursor.y, cursor.m, today])

  const span = draft ? { from: Math.min(draft.a, draft.b ?? draft.a), to: Math.max(draft.a, draft.b ?? draft.a) } : null
  const clickDay = (t) => setDraft((d) => (!d || d.b != null ? { a: t, b: null } : { a: d.a, b: t }))
  const apply = () => { if (span) { onChange(dayRange(span.from, span.to)); setOpen(false) } }
  const pickPreset = (id) => { onChange({ preset: id }); setOpen(false) }
  const move = (k) => setCursor(({ y, m }) => { const d = new Date(y, m + k, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const dates = useMemo(() => [...daysWithRuns.entries()].sort((a, b) => b[0] - a[0]), [daysWithRuns])
  const pickDate = (t, e) => {
    const r = e.shiftKey && live ? dayRange(Math.min(sod(live.from), t), Math.max(sod(live.to), t)) : dayRange(t, t)
    onChange(r); setOpen(false)
  }
  const dateOn = (t) => live && t >= sod(live.from) && t <= live.to
  const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`btn control-btn${value ? ' is-set' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span aria-hidden="true" className="cal-glyph">▦</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rangeLabel(value)}</span>
        <span aria-hidden="true" className="muted">▾</span>
      </button>

      {open && (
        <div className="popover rp-popover" role="dialog" aria-label="Choose a date range">
          <div className="rp-head">
            <span className="rp-title">Custom range</span>
            <button type="button" className="rp-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="rp-presets">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className={`rp-preset${value?.preset === p.id ? ' is-on' : ''}`}
                onClick={() => pickPreset(p.id)}>{p.label}</button>
            ))}
          </div>
          <div className="rp-body"><div className="rp-cal">
          <div className="rp-nav">
            <button type="button" aria-label="Previous month" onClick={() => move(-1)}>‹</button>
            <strong>{MONTHS[cursor.m]} {cursor.y}</strong>
            <button type="button" aria-label="Next month" onClick={() => move(1)}
              disabled={cursor.y > new Date().getFullYear() || (cursor.y === new Date().getFullYear() && cursor.m >= new Date().getMonth())}>›</button>
          </div>
          <div className="rp-grid">
            {DOW.map((d) => <span key={d} className="rp-dow">{d}</span>)}
            {cells.map((c) => {
              const inSpan = span && c.t >= span.from && c.t <= span.to
              const edge = span && (c.t === span.from || c.t === span.to)
              return (
                <button key={c.t} type="button" disabled={c.future}
                  className={`rp-day${c.inMonth ? '' : ' is-out'}${inSpan ? ' is-in' : ''}${edge ? ' is-edge' : ''}${c.t === today ? ' is-today' : ''}${daysWithRuns.has(c.t) ? ' has-runs' : ''}`}
                  onClick={() => clickDay(c.t)} title={daysWithRuns.has(c.t) ? 'runs on this day' : undefined}>{c.n}</button>
              )
            })}
          </div>
          </div>
          <div className="rp-list" role="listbox" aria-label="Test dates">
            <div className="rp-list-head">Test dates <span className="muted">{dates.length}</span></div>
            {dates.length ? dates.map(([t, n]) => (
              <button key={t} type="button" role="option" aria-selected={!!dateOn(t)}
                className={`rp-date${dateOn(t) ? ' is-on' : ''}`} onClick={(e) => pickDate(t, e)}
                title="Click to show this day · shift-click to stretch the range to it">
                <span>{new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="rp-date-n">{n} run{n === 1 ? '' : 's'}</span>
              </button>
            )) : <div className="muted rp-list-empty">No runs yet</div>}
          </div></div>
          <div className="rp-summary">{span ? `${fmt(span.from)} to ${fmt(span.to)}` : 'Pick a start day, then an end day'}</div>
          <div className="rp-foot">
            <button type="button" className="btn btn-sm" onClick={() => { onChange(null); setOpen(false) }} disabled={!value}>All dates</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={apply} disabled={!span}>Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}
