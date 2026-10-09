import React, { useState, useRef, useEffect, useLayoutEffect, createContext, useContext } from 'react'

/* Full screen tells the charts inside how tall they may be. A chart keeps its own height in
   the page; inside a full-screen card it grows to fill the window (minus header, legend and
   a table toggle), so "full screen" is the whole chart, not the small one on a big blank. */
const FullContext = createContext(0)
export function useChartHeight(height) {
  const avail = useContext(FullContext)
  return avail ? Math.max(height, avail) : height
}

/**
 * Keeps an open popover inside the window: after it lays out (left- or right-anchored by
 * CSS), measure it and slide it sideways by however much it crosses either edge, with a
 * 12 px gutter. Without this a right-anchored popover on the first tile of a phone-width
 * row opens off the left edge of the screen. Returns a ref for the popover element.
 */
export function useKeepOnScreen(open) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    const fit = () => {
      el.style.transform = ''
      const r = el.getBoundingClientRect(), W = document.documentElement.clientWidth, g = 12
      const dx = r.left < g ? g - r.left : r.right > W - g ? Math.max(g - r.left, W - g - r.right) : 0
      if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])
  return ref
}
import { STATUS_ICON } from '../lib/palette.js'

/**
 * Stat tile: label · value · optional foot. Proportional figures — tabular
 * numerals make a display-size number look loose at this size.
 *
 * Pass `breakdown` to make the tile open a popover showing what the number is
 * made of: [{ id, label, value, hint?, onClick? }]. The tile stays readable as
 * a plain figure; the detail is one click away rather than another six cards.
 */
export function Stat({ label, value, unit, foot, hero = false, breakdown, breakdownLabel, breakdownWide, breakdownRight }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const popRef = useKeepOnScreen(open)
  const hasMenu = Array.isArray(breakdown) && breakdown.length > 0

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}{unit && <span className="unit">{unit}</span>}
      </span>
      {foot && <span className="stat-foot">{foot}</span>}
    </>
  )

  if (!hasMenu) {
    return <div className={`stat${hero ? ' stat-hero' : ''}`}>{body}</div>
  }

  const max = breakdown.reduce((a, b) => (Number(b.value) > a ? Number(b.value) : a), 0)

  return (
    <div className="stat-wrap" ref={ref}>
      <button type="button" className={`stat is-menu${hero ? ' stat-hero' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        {body}
        {/* A chevron in the corner, present whether or not the pointer is
            over the card. A tile that opens something has to look different
            from one that does not, standing still. */}
        <span className="stat-chevron" aria-hidden="true">
          <svg viewBox="0 0 10 6" width="10" height="6">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div ref={popRef} className={`popover stat-popover${breakdownWide ? ' is-wide' : ''}${breakdownRight ? ' popover-right' : ''}`} role="dialog" aria-label={breakdownLabel ?? `${label} breakdown`}>
          <div className="files-head">
            <strong>{breakdownLabel ?? label}</strong>
            <span className="hint">{breakdown.length} group{breakdown.length === 1 ? '' : 's'}</span>
          </div>
          <div className="stat-breakdown">
            {breakdown.map((row) => {
              const Tag = row.onClick ? 'button' : 'div'
              return (
                <Tag key={row.id ?? row.label} type={row.onClick ? 'button' : undefined}
                  className={`sb-row${row.onClick ? ' is-clickable' : ''}`}
                  onClick={row.onClick ? () => { row.onClick(); setOpen(false) } : undefined}>
                  <span className="sb-label">
                    <span className="sb-main">
                      {row.label}
                      {row.hint && <span className="hint"> {row.hint}</span>}
                    </span>
                    {row.sub && <span className="sb-sub">{row.sub}</span>}
                  </span>
                  <span className="sb-bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${Math.max(0.04, Number(row.value) / Math.max(1, max))})` }} />
                  </span>
                  <span className="sb-value">{row.display ?? row.value}</span>
                </Tag>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Status pill — colour is never alone: it always ships an icon and a label. */
export function Pill({ level = 'neutral', children }) {
  return (
    <span className={`pill pill-${level}`}>
      <span className="pill-icon" aria-hidden="true">{STATUS_ICON[level]}</span>
      {children}
    </span>
  )
}

/**
 * `collapsible` turns the whole header into a toggle and keeps the body out of
 * the page until it is asked for — for the extras that are worth having but not
 * worth meeting first.
 */
export function Card({
  title, sub, right, children, flush = false, collapsible = false, expandable = false,
}) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const shown = !collapsible || open
  // room for a chart in full screen: the window, less the card header, legend and controls
  const [avail, setAvail] = useState(0)
  useEffect(() => {
    if (!full) { setAvail(0); return }
    const fit = () => setAvail(Math.max(300, window.innerHeight - 250))
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [full])

  /* Escape leaves full screen. The charts measure their own width, so growing
     the card is all it takes — they redraw to the new size on their own. */
  useEffect(() => {
    if (!full) return
    const onKey = (e) => { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [full])

  const expandButton = expandable && (
    <button type="button" className="btn btn-sm card-expand"
      onClick={() => setFull((f) => !f)} aria-pressed={full}
      title={full ? 'Leave full screen (Esc)' : 'Full screen'}>
      <span aria-hidden="true">{full ? '✕' : '⤢'}</span>
      <span className="sr-only">{full ? 'Leave full screen' : 'Show full screen'}</span>
    </button>
  )

  const heading = (
    <div style={{ minWidth: 0 }}>
      {title && <h3>{title}</h3>}
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  )

  return (
    <section className={`card${collapsible ? ' is-collapsible' : ''}${full ? ' is-fullscreen' : ''}`}>
      {collapsible ? (
        <div className="card-head card-toggle-row">
          <button type="button" className="card-toggle" aria-expanded={open}
            onClick={() => setOpen((o) => !o)}>
            <span className="card-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
            {heading}
          </button>
          <div className="header-spacer" />
          <span className="hint">{open ? 'Hide' : 'Show'}</span>
          {open && expandButton}
        </div>
      ) : (title || right || expandable) && (
        <header className="card-head">
          {heading}
          <div className="header-spacer" />
          {right}
          {expandButton}
        </header>
      )}
      {shown && <div className={`card-body${flush ? ' flush' : ''}`}><FullContext.Provider value={avail}>{children}</FullContext.Provider></div>}
    </section>
  )
}

export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id}
          onClick={() => onChange(o.id)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyNote({ children }) {
  return <div className="empty-note">{children}</div>
}
