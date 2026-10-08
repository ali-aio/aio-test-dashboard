import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { fmtDate, bcText, fmtBC } from '../lib/fmt.js'

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export const iso = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * One month's grid: leading blanks to line the 1st up under its weekday, then
 * a cell per day. UTC throughout — these are calendar dates, not instants, and
 * building them in local time shifts the whole month for anyone east of GMT.
 */
export function monthCells(year, month, available, counts = new Map()) {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const out = []
  for (let i = 0; i < firstDay; i++) out.push(null)
  for (let d = 1; d <= total; d++) {
    const key = iso(year, month, d)
    out.push({ day: d, key, has: available.has(key), n: counts.get(key) ?? 0 })
  }
  return out
}

const MODE_KEY = 't7-date-mode'

function readMode() {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'list' ? 'list' : 'calendar'
  } catch {
    return 'calendar'
  }
}

/**
 * Test-date filter, in two views.
 *
 * CALENDAR shows the shape of the campaign — which days have runs, how many,
 * and where the gaps are. It is the default because a flat list of dates says
 * nothing about any of that.
 *
 * LIST is the plain run-down: every test date in one scrollable column, newest
 * first. Faster when you already know the date you want and would rather not
 * navigate months to reach it.
 *
 * Either way, only days that actually hold runs are selectable, so the filter
 * can never be set to something that matches nothing. The chosen view is
 * remembered between visits.
 */
export default function DatePicker({ dates, counts, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(readMode)
  const ref = useRef(null)
  const listRef = useRef(null)

  const chooseMode = useCallback((next) => {
    setMode(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* private mode */ }
  }, [])

  const available = useMemo(() => new Set(dates), [dates])
  const maxCount = useMemo(() => {
    let m = 0
    for (const n of counts.values()) if (n > m) m = n
    return m
  }, [counts])

  const latest = dates.length ? dates[dates.length - 1] : null
  const earliest = dates.length ? dates[0] : null

  // Open on the month holding the selection, else the most recent data.
  const anchor = value || latest
  const [cursor, setCursor] = useState(() => {
    const [y, m] = (anchor ?? '2026-01-01').split('-').map(Number)
    return { year: y, month: m - 1 }
  })

  useEffect(() => {
    if (!open) return
    const [y, m] = (anchor ?? '2026-01-01').split('-').map(Number)
    setCursor({ year: y, month: m - 1 })
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Open the list on the selected date rather than at the top.
  useEffect(() => {
    if (!open || mode !== 'list') return
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'center' })
  }, [open, mode])

  /** Newest first — when you are reaching for a date by name it is usually a
      recent one, and the calendar already covers chronological browsing. */
  const listDates = useMemo(() => [...dates].reverse(), [dates])

  /** Months that hold at least one run, so the arrows can skip empty ones. */
  const monthsWithData = useMemo(() => {
    const set = new Set()
    for (const d of dates) set.add(d.slice(0, 7))
    return [...set].sort()
  }, [dates])

  const step = useCallback((dir) => {
    const current = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
    const next = dir > 0
      ? monthsWithData.find((m) => m > current)
      : [...monthsWithData].reverse().find((m) => m < current)
    if (next) {
      const [y, m] = next.split('-').map(Number)
      setCursor({ year: y, month: m - 1 })
    }
  }, [cursor, monthsWithData])

  const currentKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const hasPrev = monthsWithData.some((m) => m < currentKey)
  const hasNext = monthsWithData.some((m) => m > currentKey)

  const cells = useMemo(
    () => monthCells(cursor.year, cursor.month, available, counts),
    [cursor, available, counts],
  )

  const monthTotal = cells.reduce((a, c) => a + (c?.n ?? 0), 0)
  const monthDays = cells.filter((c) => c?.has).length

  const pick = (key) => { onChange(key); setOpen(false) }

  const label = value ? fmtDate(value) : `All ${dates.length} date${dates.length === 1 ? '' : 's'}`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`btn control-btn${value ? ' is-set' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span aria-hidden="true" className="cal-glyph">▦</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span aria-hidden="true" className="muted">▾</span>
      </button>

      {open && (
        <div className="popover cal-popover" role="dialog" aria-label="Choose a test date">
          <div className="seg cal-modes" role="group" aria-label="Date view">
            <button type="button" aria-pressed={mode === 'calendar'}
              onClick={() => chooseMode('calendar')}>Calendar</button>
            <button type="button" aria-pressed={mode === 'list'}
              onClick={() => chooseMode('list')}>List</button>
          </div>

          {mode === 'list' ? (
            <DateList dates={listDates} counts={counts} value={value} maxCount={maxCount}
              listRef={listRef}
              onPick={pick}
              onClear={() => { onChange(''); setOpen(false) }} />
          ) : (
          <>
          <div className="cal-head">
            <button type="button" className="btn btn-icon btn-sm" onClick={() => step(-1)}
              disabled={!hasPrev} aria-label="Previous month with data">‹</button>
            <div className="cal-title">
              <strong>{MONTH_NAMES[cursor.month]} {cursor.year}</strong>
              <span className="hint">
                {monthDays ? `${monthDays} test day${monthDays === 1 ? '' : 's'} · ${bcText(monthTotal)}` : 'no runs this month'}
              </span>
            </div>
            <button type="button" className="btn btn-icon btn-sm" onClick={() => step(1)}
              disabled={!hasNext} aria-label="Next month with data">›</button>
          </div>

          <div className="cal-grid" role="grid">
            {DAY_NAMES.map((d) => (
              <div key={d} className="cal-dow" role="columnheader">{d}</div>
            ))}
            {cells.map((c, i) => (
              c === null
                ? <div key={`pad-${i}`} className="cal-day is-empty" />
                : (
                  <button
                    key={c.key}
                    type="button"
                    role="gridcell"
                    className={`cal-day${c.has ? ' has-data' : ''}${value === c.key ? ' is-selected' : ''}`}
                    disabled={!c.has}
                    aria-pressed={value === c.key}
                    aria-label={c.has
                      ? `${fmtDate(c.key)} — ${bcText(c.n)}`
                      : `${fmtDate(c.key)} — no runs`}
                    title={c.has ? bcText(c.n) : undefined}
                    onClick={() => pick(c.key)}
                  >
                    <span className="cal-num">{c.day}</span>
                    {c.has && (
                      <span className="cal-bar" aria-hidden="true"
                        style={{ transform: `scaleX(${Math.max(0.18, c.n / Math.max(1, maxCount))})` }} />
                    )}
                  </button>
                )
            ))}
          </div>
          </>
          )}

          <div className="cal-foot">
            <button type="button" className="btn btn-sm" onClick={() => { onChange(''); setOpen(false) }}
              disabled={!value}>
              Clear
            </button>
            <span className="header-spacer" />
            {earliest && (
              <button type="button" className="btn btn-sm" onClick={() => pick(earliest)}
                disabled={value === earliest}>First</button>
            )}
            {latest && (
              <button type="button" className="btn btn-sm" onClick={() => pick(latest)}
                disabled={value === latest}>Latest</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The list view: every test date in one column, newest first, grouped under
 * sticky month headers. The bar carries the cycle count the same way the
 * calendar does — width for magnitude, not a second colour.
 */
export function DateList({ dates, counts, value, maxCount, onPick, onClear, listRef }) {
  if (!dates.length) {
    return <div className="hint" style={{ padding: 10 }}>No dated runs in scope.</div>
  }
  return (
    <div className="date-list" ref={listRef} role="listbox" aria-label="Test dates">
      <button type="button" role="option" aria-selected={!value}
        className={`date-row is-all${!value ? ' is-selected' : ''}`}
        data-selected={!value} onClick={onClear}>
        <span className="dr-label">All dates</span>
        <span className="dr-count">{dates.length}</span>
      </button>
      {dates.map((d, i) => {
        const month = d.slice(0, 7)
        const newMonth = i === 0 || dates[i - 1].slice(0, 7) !== month
        const n = counts.get(d) ?? 0
        return (
          <React.Fragment key={d}>
            {newMonth && (
              <div className="date-month">
                {MONTH_NAMES[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
              </div>
            )}
            <button type="button" role="option" aria-selected={value === d}
              className={`date-row${value === d ? ' is-selected' : ''}`}
              data-selected={value === d} onClick={() => onPick(d)}
              aria-label={`${fmtDate(d)} — ${bcText(n)}`}>
              <span className="dr-label">{fmtDate(d)}</span>
              <span className="dr-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${Math.max(0.08, n / Math.max(1, maxCount))})` }} />
              </span>
              <span className="dr-count">{fmtBC(n)}</span>
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}
