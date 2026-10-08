/* ===========================================================================
   Chart primitives shared by every view.

   The chrome rules live here so no chart can drift from them:
     • gridlines and axes are solid hairlines one step off the surface
     • 2px lines, >=8px markers, area fills at ~10% opacity
     • a crosshair plus one tooltip listing every series at that x
     • a table-view twin, so no value is reachable only by hovering
   =========================================================================== */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'

/* ---------------------------------------------------------------- measuring */

/**
 * Width of the element this ref lands on.
 *
 * A callback ref, not an effect reading `ref.current`. Every chart returns its
 * empty state *before* rendering the measured box, so on a selection with no
 * data the box never mounts — and a mount-once effect would then never fire
 * again when data came back. The chart stayed at width 0 and silently drew
 * nothing: switch to a test type with no readings, switch back, no chart.
 * React calls this on every attach and detach, so a remount re-measures.
 */
export function useMeasure() {
  const [width, setWidth] = useState(0)
  const observer = useRef(null)

  const ref = useCallback((el) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    })
    ro.observe(el)
    observer.current = ro
    setWidth(el.getBoundingClientRect().width)
  }, [])

  return [ref, width]
}

/* ------------------------------------------------------------------ scales */

export function linear(d0, d1, r0, r1) {
  const span = d1 - d0 || 1
  const fn = (v) => r0 + ((v - d0) / span) * (r1 - r0)
  fn.invert = (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * span
  fn.domain = [d0, d1]
  fn.range = [r0, r1]
  return fn
}

function tickStep(min, max, count) {
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const norm = raw / mag
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag
}

/** Round a domain out to clean tick values. */
export function niceDomain(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) { min -= 1; max += 1 }
  const step = tickStep(min, max, count)
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step]
}

/** Clean tick values across a domain — rounded numbers, never raw data points. */
export function ticksFor(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]
  const step = tickStep(min, max, count)
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : Math.round(v * 1e6) / 1e6)
  }
  return out
}

/** Whole-hour ticks for an elapsed-time axis, thinned to fit the width. */
export function hourTicks(maxHours, pxWidth) {
  const want = Math.max(2, Math.floor(pxWidth / 52))
  const step = Math.max(1, Math.ceil((maxHours || 1) / want))
  const out = []
  for (let h = 0; h <= maxHours + 1e-6; h += step) out.push(h)
  return out
}

/* --------------------------------------------------------------- SVG defs */

export function ChartDefs({ id }) {
  return (
    <defs>
      {/* 45 degrees and its 135 mirror only — never horizontal or vertical,
          which read as gridlines. Opt-in, never decorative. */}
      <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--surface-2)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-muted)" strokeWidth="1.3" />
      </pattern>
    </defs>
  )
}

/* ------------------------------------------------------------------- axes */

export function GridY({ scale, ticks, x0, x1 }) {
  return (
    <g aria-hidden="true">
      {ticks.map((v) => (
        <line key={v} x1={x0} x2={x1} y1={scale(v)} y2={scale(v)}
          stroke="var(--gridline)" strokeWidth="1" shapeRendering="crispEdges" />
      ))}
    </g>
  )
}

export function AxisY({ scale, ticks, x, format = (v) => v, label }) {
  return (
    <g aria-hidden="true">
      {ticks.map((v) => (
        <text key={v} x={x - 8} y={scale(v)} dy="0.32em" textAnchor="end"
          fontSize="10.5" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {format(v)}
        </text>
      ))}
      {label && (
        <text x={x} y={scale(scale.domain[1]) - 10} textAnchor="start" fontSize="10.5"
          fill="var(--text-muted)">{label}</text>
      )}
    </g>
  )
}

/** Numeric x-axis. `ticks` are domain values; `format` turns them into labels. */
export function AxisX({ scale, ticks, y, format = (v) => v, label, unit }) {
  return (
    <g aria-hidden="true">
      <line x1={scale.range[0]} x2={scale.range[1]} y1={y} y2={y}
        stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
      {ticks.map((v) => (
        <g key={v} transform={`translate(${scale(v)},${y})`}>
          <line y1="0" y2="4" stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
          <text y="15" textAnchor="middle" fontSize="10.5" fill="var(--text-muted)"
            style={{ fontVariantNumeric: 'tabular-nums' }}>{format(v)}</text>
        </g>
      ))}
      {label && (
        <text x={(scale.range[0] + scale.range[1]) / 2} y={y + 30} textAnchor="middle"
          fontSize="10.5" fill="var(--text-muted)">{label}</text>
      )}
      {unit && (
        <text x={scale.range[1]} y={y + 30} textAnchor="end" fontSize="10.5"
          fill="var(--text-muted)">{unit}</text>
      )}
    </g>
  )
}

/**
 * How far rotated band labels hang below the axis. A -28° label drops by its
 * own width × sin 28°, so a fixed offset either overlaps the long ones or
 * strands the short ones — the axis title has to be placed past the longest.
 */
export function bandLabelDrop(labels, rotate) {
  if (!rotate) return 22
  const longest = labels.reduce((n, l) => Math.max(n, String(l).length), 0)
  return 12 + longest * 5.9 * 0.47
}

/** Category x-axis for bar charts — labels centred under each band. */
export function AxisXBands({ bands, y, width, label, unit, rotate = false }) {
  const titleY = y + bandLabelDrop(bands.map((b) => b.label), rotate) + 14
  return (
    <g aria-hidden="true">
      <line x1={bands[0]?.x0 ?? 0} x2={bands[bands.length - 1]?.x1 ?? width} y1={y} y2={y}
        stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
      {bands.map((b) => (
        <text key={b.label} x={(b.x0 + b.x1) / 2} y={y + (rotate ? 12 : 15)}
          textAnchor={rotate ? 'end' : 'middle'} fontSize="10.5" fill="var(--text-secondary)"
          transform={rotate ? `rotate(-28 ${(b.x0 + b.x1) / 2} ${y + 12})` : undefined}>
          {b.label}
        </text>
      ))}
      {label && (
        <text x={width / 2} y={titleY} textAnchor="middle" fontSize="10.5"
          fill="var(--text-muted)">{label}</text>
      )}
      {unit && (
        <text x={bands[bands.length - 1]?.x1 ?? width} y={titleY}
          textAnchor="end" fontSize="10.5" fill="var(--text-muted)">{unit}</text>
      )}
    </g>
  )
}

/* ---------------------------------------------------------------- tooltip */

export function Tooltip({ x, y, containerWidth, children, interactive = false, onPointerLeave }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ w: 150, h: 60 })
  useEffect(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    }
  }, [children])
  const flip = x + size.w + 18 > containerWidth
  return (
    <div ref={ref} className={`chart-tooltip${interactive ? ' is-interactive' : ''}`} role="status"
      onPointerLeave={onPointerLeave}
      style={{
        left: Math.max(2, flip ? x - size.w - 12 : x + 12),
        top: Math.max(2, y - size.h / 2),
      }}>
      {children}
    </div>
  )
}

/** Value leads, label follows — here the reader has the series and wants the number. */
export function TooltipRow({ color, name, value, muted }) {
  return (
    <div className="tt-row">
      <span className="tt-key" style={{ background: color || 'var(--text-muted)' }} />
      <span className="tt-name">{name}</span>
      <span className="tt-val" style={muted ? { color: 'var(--text-secondary)', fontWeight: 500 } : undefined}>
        {value}
      </span>
    </div>
  )
}

/* ----------------------------------------------------------------- legend */

/** Always present for two or more series; a single series needs none. */
export function Legend({ items, onToggle, hidden, note }) {
  if (!items || items.length < 2) return null
  return (
    <div className="legend" role="list">
      {items.map((it) => {
        const off = hidden?.has(it.id)
        const Tag = onToggle ? 'button' : 'span'
        return (
          <Tag key={it.id} role="listitem" type={onToggle ? 'button' : undefined}
            className={`legend-item${onToggle ? ' clickable' : ''}${off ? ' is-off' : ''}`}
            onClick={onToggle ? () => onToggle(it.id) : undefined}
            aria-pressed={onToggle ? !off : undefined}
            title={onToggle ? `Toggle ${it.label}` : undefined}>
            {it.shape === 'rect'
              ? <span className="legend-key-rect" style={{ background: it.color }} />
              : <span className="legend-key-line" style={{ background: it.color }} />}
            {it.label}
            {it.sub && <span className="muted"> {it.sub}</span>}
          </Tag>
        )
      })}
      {note && <span className="hint">{note}</span>}
    </div>
  )
}

/* ------------------------------------------------- the table-view twin */

/**
 * Every chart ships one of these: the WCAG-clean equivalent. Same numbers,
 * reachable without hover and without relying on colour.
 */
export function TableView({
  columns, rows, caption, maxHeight = 320, label = 'table view', note, sortable = false,
}) {
  const [open, setOpen] = useState(false)
  /* null until a heading is clicked; `worst` flips the good end to the bottom. */
  const [sort, setSort] = useState(null)

  /**
   * Best first, not merely highest first — less drain is better while a longer
   * run is better, so the column says which end is the good one. A column with
   * no good end (a count, a name) just sorts biggest or A-Z first.
   */
  const ordered = useMemo(() => {
    if (!sortable || !sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const raw = (r) => r.sort?.[sort.key]
    const flip = sort.mode === 'worst' ? -1 : 1
    // A row with nothing recorded is neither best nor worst; it sits at the end.
    const missing = (v) => v == null || (typeof v === 'number' && !Number.isFinite(v))

    return [...rows].sort((a, b) => {
      const av = raw(a)
      const bv = raw(b)
      if (missing(av) && missing(bv)) return 0
      if (missing(av)) return 1
      if (missing(bv)) return -1
      if (typeof av === 'string' || typeof bv === 'string') {
        return flip * String(av).localeCompare(String(bv))
      }
      // 'up' means a bigger number is the good end.
      return flip * (col.better === 'down' ? av - bv : bv - av)
    })
  }, [rows, sort, sortable, columns])

  if (!rows?.length) return null

  const onSort = (key) => setSort((s) => (
    s?.key === key && s.mode === 'best' ? { key, mode: 'worst' } : { key, mode: 'best' }
  ))

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {open ? 'Hide' : 'Show'} {label}
      </button>
      {open && note && <p className="hint" style={{ margin: '8px 0 0' }}>{note}</p>}
      {open && sortable && (
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Click a heading to put its best at the top, again for its worst.
        </p>
      )}
      {open && (
        <div className="table-wrap" style={{
          marginTop: 8, maxHeight, border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <table className="data">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr>{columns.map((c) => (
                <th key={c.key}
                  onClick={sortable ? () => onSort(c.key) : undefined}
                  style={{ cursor: sortable ? 'pointer' : 'default' }}
                  aria-sort={sort?.key === c.key
                    ? (sort.mode === 'best' ? 'descending' : 'ascending') : 'none'}>
                  {c.label}
                  {sortable && sort?.key === c.key && (
                    <span className="sort-caret" aria-hidden="true">
                      {sort.mode === 'best' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {ordered.map((r, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key}>{r[c.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ interaction */

/** Pointer position inside the plot box, or null when outside it. */
export function usePlotPointer(svgRef, plot) {
  const [pointer, setPointer] = useState(null)
  const onPointerMove = useCallback((e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (px < plot.x0 - 6 || px > plot.x1 + 6 || py < plot.y0 - 10 || py > plot.y1 + 10) {
      setPointer(null)
      return
    }
    setPointer({ px: Math.min(plot.x1, Math.max(plot.x0, px)), py })
  }, [svgRef, plot.x0, plot.x1, plot.y0, plot.y1])
  const clearPointer = useCallback(() => setPointer(null), [])
  const onPointerLeave = useCallback((e) => {
    if (e.relatedTarget?.closest?.('.chart-tooltip.is-interactive')) return
    setPointer(null)
  }, [])
  return [pointer, { onPointerMove, onPointerLeave }, clearPointer]
}

/** Nearest point in a sorted-by-x list. */
export function nearestPoint(points, x) {
  if (!points.length) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < x) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - x) <= Math.abs(points[lo].t - x)) return points[lo - 1]
  return points[lo]
}

/* ------------------------------------------------------------------- paths */

export function linePath(points, sx, sy) {
  if (!points.length) return ''
  let d = ''
  for (let i = 0; i < points.length; i++) {
    d += `${i === 0 ? 'M' : 'L'}${sx(points[i].t).toFixed(2)},${sy(points[i].v).toFixed(2)}`
  }
  return d
}

export function areaPath(points, sx, sy, baseY) {
  if (!points.length) return ''
  let d = `M${sx(points[0].t).toFixed(2)},${baseY.toFixed(2)}`
  for (const p of points) d += `L${sx(p.t).toFixed(2)},${sy(p.v).toFixed(2)}`
  d += `L${sx(points[points.length - 1].t).toFixed(2)},${baseY.toFixed(2)}Z`
  return d
}

/** Column: 4px rounded cap, square at the baseline. */
export function columnPath(x, y, w, h, r = 4) {
  if (h <= 0.5 || w <= 0.5) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h}Z`
}

/** Horizontal bar: 4px rounded data-end, square at the baseline. */
export function barPath(x, y, w, h, r = 4) {
  if (w <= 0.5 || h <= 0.5) return ''
  const rr = Math.min(r, w, h / 2)
  return `M${x},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}H${x}Z`
}
