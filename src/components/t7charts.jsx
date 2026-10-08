/* ===========================================================================
   Chart forms: line, grouped columns, horizontal bars, histogram, scatter,
   and a sequential heatmap.

   Shared rules (see README § Colour):
     • bars capped at 24px thick, 4px rounded data-end, square at the baseline
     • a 2px surface gap between touching marks — never a stroke around them
     • labels only where they fit; the rest lives in the tooltip and the table
     • sequential encoding is one hue light->dark, always with a scale legend
     • no dual axes, ever — two measures of different scale get two charts
   =========================================================================== */

import React, { useMemo, useRef, useState } from 'react'
import {
  useMeasure, linear, niceDomain, ticksFor, GridY, AxisY, AxisX, AxisXBands, bandLabelDrop,
  Tooltip, TooltipRow, Legend, TableView, usePlotPointer, nearestPoint,
  linePath, areaPath, columnPath, barPath,
} from './chartkit.jsx'
import { seqColor, SEQ_STEPS } from '../lib/palette.js'
import { maxOf, minOf } from '../lib/t7cycles.js'
import { fmtInt } from '../lib/fmt.js'

const BAR_MAX = 24
const GAP = 2            // the surface gap — white does the separating
const MIN_BAND = 64      // narrowest a group can get before the chart scrolls instead
/**
 * Every chart shares this empty state. A bare "nothing to plot" leaves the
 * reader guessing between a filter that is too narrow and a measure the source
 * data never recorded — two problems with different fixes — so the caller
 * passes the reason and the chart shows it.
 */
export function EmptyPlot({ reason, hint }) {
  return (
    <div className="empty-plot">
      <strong>Nothing to plot here</strong>
      <span>{reason ?? 'No data in the current selection.'}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

/** What a chart falls back to when its caller has not said why. */
const empty = (empty) => <EmptyPlot reason={empty?.reason} hint={empty?.hint} />

/* ====================================================================== line */

/**
 * series: [{ id, label, color, points: [{t, v, n?}], dashed? }]
 * One y-axis. Crosshair finds the x; one tooltip lists every series there.
 */
export function LineChart({
  series, xDomain, yDomain, xTicks: xTicksProp, formatX = (v) => v, formatY = (v) => v,
  xLabel, xUnit, yLabel, valueLabel, height = 280, caption, tableColumns, tableRows, area = false,
  legendNote, legendDisclosure, selectedSeries, onToggleSeries,
  onSelectAllSeries, onClearAllSeries, markers = true, emptyState,
}) {
  const [ref, width] = useMeasure()
  const svgRef = useRef(null)

  const M = {
    left: 52,
    right: 16,
    top: 16,
    bottom: xLabel ? 50 : 34,
  }
  const plotW = Math.max(40, width - M.left - M.right)
  const plotH = Math.max(40, height - M.top - M.bottom)

  const available = series.filter((s) => s.points?.length)
  const live = available.filter((s) => selectedSeries == null || selectedSeries.has(s.id))

  const [x0, x1] = useMemo(() => {
    if (xDomain) return xDomain
    let lo = Infinity
    let hi = -Infinity
    for (const s of live) for (const p of s.points) {
      if (p.t < lo) lo = p.t
      if (p.t > hi) hi = p.t
    }
    return Number.isFinite(lo) ? [lo, hi || lo + 1] : [0, 1]
  }, [live, xDomain])

  const [y0, y1] = useMemo(() => {
    if (yDomain) return yDomain
    let lo = Infinity
    let hi = -Infinity
    for (const s of live) for (const p of s.points) {
      if (!Number.isFinite(p.v)) continue
      if (p.v < lo) lo = p.v
      if (p.v > hi) hi = p.v
    }
    if (!Number.isFinite(lo)) return [0, 1]
    return niceDomain(Math.min(lo, 0), hi, 4)
  }, [live, yDomain])

  const sx = linear(x0, x1, M.left, M.left + plotW)
  const sy = linear(y0, y1, M.top + plotH, M.top)
  const yTicks = ticksFor(y0, y1, 4)
  const xTicks = xTicksProp ?? ticksFor(x0, x1, Math.max(2, Math.floor(plotW / 70)))

  const plot = { x0: M.left, x1: M.left + plotW, y0: M.top, y1: M.top + plotH }
  const [pointer, handlers, clearPointer] = usePlotPointer(svgRef, plot)
  const hoverX = pointer ? sx.invert(pointer.px) : null

  const readings = useMemo(() => {
    if (hoverX == null) return []
    return live.map((s) => {
      const p = nearestPoint(s.points, hoverX)
      return p ? { s, p } : null
    }).filter(Boolean)
  }, [live, hoverX])

  if (!available.length) return empty(emptyState)

  const legend = <Legend items={live.map((s) => ({
    id: s.id, label: s.label, sub: s.sub, color: s.color, shape: 'line',
  }))} note={legendNote} />

  return (
    <div className="chart-shell" ref={ref}>
      {legendDisclosure && onToggleSeries ? (
        <details className="chart-legend-details">
          <summary>{legendDisclosure} ({live.length}/{available.length})</summary>
          <div className="series-legend-actions">
            <button type="button" className="btn" onClick={onSelectAllSeries}>Select all</button>
            <button type="button" className="btn" onClick={onClearAllSeries}>Clear all</button>
          </div>
          <div className="legend series-legend" role="group" aria-label={`${legendDisclosure} to show on graph`}>
            {available.map((s) => (
              <label className="series-legend-item" key={s.id}>
                <input type="checkbox" checked={selectedSeries == null || selectedSeries.has(s.id)}
                  onChange={() => onToggleSeries(s.id)} />
                <span className="legend-key-line" style={{ background: s.color }} aria-hidden="true" />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </details>
      ) : legendDisclosure && live.length > 1 ? (
        <details className="chart-legend-details">
          <summary>{legendDisclosure} ({live.length})</summary>
          {legend}
        </details>
      ) : legend}
      {!live.length && (
        <EmptyPlot reason={`No ${legendDisclosure?.toLowerCase() ?? 'series'} selected.`}
          hint={`Select ${legendDisclosure?.toLowerCase() ?? 'series'} above or choose Select all.`} />
      )}
      {live.length > 0 && width > 0 && (
        <svg ref={svgRef} height={height} viewBox={`0 0 ${width} ${height}`} style={{ marginTop: 8 }}
          role="img" aria-label={caption} {...handlers}>
          <GridY scale={sy} ticks={yTicks} x0={M.left} x1={M.left + plotW} />
          <AxisY scale={sy} ticks={yTicks} x={M.left} format={formatY} label={yLabel} />
          <AxisX scale={sx} ticks={xTicks} y={M.top + plotH} format={formatX} label={xLabel} unit={xUnit} />

          {area && live.length === 1 && (
            <path d={areaPath(live[0].points, sx, sy, M.top + plotH)}
              fill={live[0].color} opacity="0.10" />
          )}

          {live.map((s) => (
            <path key={s.id} d={linePath(s.points, sx, sy)} fill="none" stroke={s.color}
              strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              strokeDasharray={s.dashed ? '5 4' : undefined} />
          ))}

          {/* markers only when the series is sparse enough for them to read */}
          {markers && live.map((s) => (
            s.points.length <= 40 ? s.points.map((p, i) => (
              <circle key={`${s.id}-${i}`} cx={sx(p.t)} cy={sy(p.v)} r="4" fill={s.color}
                stroke="var(--surface-1)" strokeWidth="2" />
            )) : null
          ))}

          {hoverX != null && readings.length > 0 && (
            <>
              <line x1={pointer.px} x2={pointer.px} y1={M.top} y2={M.top + plotH}
                stroke="var(--text-muted)" strokeWidth="1" shapeRendering="crispEdges" />
              {readings.map(({ s, p }) => (
                <circle key={s.id} cx={sx(p.t)} cy={sy(p.v)} r="4.5" fill={s.color}
                  stroke="var(--surface-1)" strokeWidth="2" />
              ))}
            </>
          )}
        </svg>
      )}
      {pointer && readings.length > 0 && (
        <Tooltip x={pointer.px} y={pointer.py} containerWidth={width}
          interactive onPointerLeave={clearPointer}>
          <div className="tt-time">
            {formatX(readings[0].p.t)}{xUnit}{valueLabel ? ` · ${valueLabel}` : ''}
          </div>
          {readings.map(({ s, p }) => (
            <TooltipRow key={s.id} color={s.color} name={s.label} value={formatY(p.v)} />
          ))}
        </Tooltip>
      )}
      {tableColumns && <TableView columns={tableColumns} rows={tableRows} caption={caption} />}
    </div>
  )
}

/* ========================================================== grouped columns */

/**
 * groups: [{ label, values: { key: number } }]
 * measures: [{ key, label, color }]
 * Two measures on ONE axis. If they ever need different scales, that is two
 * charts, not two y-axes.
 */
export function GroupedColumns({
  groups, measures, formatValue = (v) => String(v), yLabel, xLabel, xUnit,
  height = 260, caption, tableColumns, tableRows, tableNote, tableSortable = false,
  rotateLabels = false, emptyState, onSelectGroup, selectedGroup,
}) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState(null)
  const [pt, setPt] = useState({ x: 0, y: 0 })
  const labelDrop = bandLabelDrop(groups.map((g) => g.label), rotateLabels)
  const M = {
    left: 52,
    right: 14,
    top: 14,
    bottom: Math.max(46, labelDrop + (xLabel || xUnit ? 24 : 10)),
  }
  /* Past a certain count the bands are slivers, so the chart grows and scrolls
     sideways rather than compressing — the table beside it already does. */
  const contentW = Math.max(width, M.left + M.right + groups.length * MIN_BAND)
  const plotW = Math.max(40, contentW - M.left - M.right)
  const plotH = Math.max(30, height - M.top - M.bottom)

  const all = groups.flatMap((g) => measures.map((m) => g.values[m.key]).filter((v) => v != null))
  const [lo, hi] = niceDomain(Math.min(0, minOf(all, 0)), Math.max(0, maxOf(all, 0)), 4)
  const sy = linear(lo, hi, M.top + plotH, M.top)
  const yTicks = ticksFor(lo, hi, 4)
  const zeroY = sy(0)

  const bandW = plotW / Math.max(1, groups.length)
  const barW = Math.min(BAR_MAX, (bandW - 16) / measures.length - GAP)

  const bands = groups.map((g, i) => ({
    label: g.label, x0: M.left + i * bandW, x1: M.left + (i + 1) * bandW,
  }))

  if (!groups.length) return empty(emptyState)

  return (
    <div className="chart-shell" ref={ref}>
      <Legend items={measures.map((m) => ({ id: m.key, label: m.label, color: m.color, shape: 'rect' }))} />
      {width > 0 && (
        <div className={contentW > width ? 'chart-scroll' : undefined}>
        <svg height={height} viewBox={`0 0 ${contentW} ${height}`}
          style={{ marginTop: 8, width: contentW, maxWidth: 'none' }}
          role="img" aria-label={caption}
          onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPt({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
          onPointerLeave={() => setHover(null)}>
          <GridY scale={sy} ticks={yTicks} x0={M.left} x1={M.left + plotW} />
          <AxisY scale={sy} ticks={yTicks} x={M.left} format={formatValue} label={yLabel} />

          {groups.map((g, gi) => {
            const groupW = measures.length * barW + (measures.length - 1) * GAP
            const startX = M.left + gi * bandW + (bandW - groupW) / 2
            return measures.map((m, mi) => {
              const v = g.values[m.key]
              if (v == null) return null
              const x = startX + mi * (barW + GAP)
              const top = Math.min(sy(v), zeroY)
              const h = Math.abs(sy(v) - zeroY)
              const on = hover && hover.g === gi && hover.m === m.key
              const picked = selectedGroup != null && selectedGroup === g.label
              return (
                <g key={`${gi}-${m.key}`}
                  onPointerEnter={() => setHover({ g: gi, m: m.key, group: g, measure: m, value: v })}
                  tabIndex={0} onFocus={() => setHover({ g: gi, m: m.key, group: g, measure: m, value: v })}
                  onBlur={() => setHover(null)}
                  role={onSelectGroup ? 'button' : undefined}
                  aria-label={onSelectGroup ? `${g.label}: ${m.label}` : undefined}
                  style={onSelectGroup ? { cursor: 'pointer' } : undefined}
                  onClick={onSelectGroup ? () => onSelectGroup(g) : undefined}
                  onKeyDown={onSelectGroup ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectGroup(g) }
                  } : undefined}>
                  {/* hit target is bigger than the mark */}
                  <rect x={x - GAP} y={M.top} width={barW + GAP * 2} height={plotH} fill="transparent" />
                  <path d={v >= 0 ? columnPath(x, top, barW, h) : columnPath(x, top, barW, h)}
                    fill={m.color} opacity={picked || on ? 1 : selectedGroup != null ? 0.45 : 0.9} />
                </g>
              )
            })
          })}

          <AxisXBands bands={bands} y={zeroY} width={contentW} label={xLabel} unit={xUnit} rotate={rotateLabels} />
        </svg>
        </div>
      )}
      {hover && (
        <Tooltip x={pt.x} y={pt.y} containerWidth={contentW}>
          <div className="tt-time">{hover.group.label}{hover.group.n != null
            ? ` · ${fmtInt(hover.group.n)} cycle${hover.group.n === 1 ? '' : 's'}` : ''}</div>
          {measures.map((m) => (
            hover.group.values[m.key] != null && (
              <TooltipRow key={m.key} color={m.color} name={m.label}
                value={formatValue(hover.group.values[m.key])} />
            )
          ))}
        </Tooltip>
      )}
      {tableColumns && <TableView columns={tableColumns} rows={tableRows} caption={caption}
        note={tableNote} sortable={tableSortable} />}
    </div>
  )
}

/* ======================================================== horizontal bars */

/** One series, one colour — never a value-ramp across nominal categories. */
export function BarRows({
  rows, color = 'var(--series-1)', unit = '', max, labelWidth = 150,
  caption, tableColumns, tableRows, formatValue, emptyState,
}) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState(null)
  const rowH = 30
  const plotX0 = labelWidth
  const plotW = Math.max(40, width - labelWidth - 68)
  const domainMax = max ?? Math.max(1, maxOf(rows.map((r) => r.value), 0))
  const sx = linear(0, domainMax, plotX0, plotX0 + plotW)
  const height = rows.length * rowH + 26

  if (!rows.length) return empty(emptyState)

  return (
    <div className="chart-shell" ref={ref}>
      {width > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption}>
          {ticksFor(0, domainMax, 4).map((v) => (
            <g key={v}>
              <line x1={sx(v)} x2={sx(v)} y1={0} y2={rows.length * rowH}
                stroke="var(--gridline)" strokeWidth="1" shapeRendering="crispEdges" />
              <text x={sx(v)} y={rows.length * rowH + 14} textAnchor="middle" fontSize="10"
                fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {v}{unit === 'h' ? '' : unit}
              </text>
            </g>
          ))}
          {unit === 'h' && (
            <text x={plotX0 + plotW + 12} y={rows.length * rowH + 14}
              textAnchor="start" fontSize="10" fill="var(--text-muted)">h</text>
          )}
          {rows.map((r, i) => {
            const barH = Math.min(BAR_MAX, rowH - 10)
            const y = i * rowH + (rowH - barH) / 2
            const w = Math.max(0, sx(r.value) - plotX0)
            const on = hover === r.id
            return (
              <g key={r.id} onPointerEnter={() => setHover(r.id)} onPointerLeave={() => setHover(null)}
                tabIndex={0} onFocus={() => setHover(r.id)} onBlur={() => setHover(null)}
                style={{ outline: 'none' }}>
                <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" />
                {on && <rect x={0} y={i * rowH} width={width} height={rowH} rx="3" fill="var(--wash)" />}
                <text x={plotX0 - 10} y={y + barH / 2} dy="0.32em" textAnchor="end" fontSize="11.5"
                  fill="var(--text-secondary)">{r.label}</text>
                <path d={barPath(plotX0, y, w, barH)} fill={r.color || color} opacity={on ? 1 : 0.9} />
                <text x={plotX0 + w + 7} y={y + barH / 2} dy="0.32em" fontSize="11"
                  fill="var(--text-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {r.display ?? (formatValue ? formatValue(r.value) : r.value)}
                </text>
              </g>
            )
          })}
        </svg>
      )}
      {tableColumns && <TableView columns={tableColumns} rows={tableRows} caption={caption} />}
    </div>
  )
}

/* ================================================================ histogram */

export function Histogram({
  bins, total, color = 'var(--series-1)', xLabel, formatBin, caption, height = 190, yMax,
  emptyState,
}) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState(null)
  const [pt, setPt] = useState({ x: 0, y: 0 })
  const M = { left: 46, right: 12, top: 10, bottom: xLabel ? 42 : 28 }
  const plotW = Math.max(40, width - M.left - M.right)
  const plotH = Math.max(30, height - M.top - M.bottom)
  const maxN = Math.max(1, yMax ?? maxOf(bins.map((b) => b.n), 0))
  const [, niceMax] = niceDomain(0, maxN, 4)
  const sy = linear(0, niceMax, M.top + plotH, M.top)
  const slot = plotW / Math.max(1, bins.length)
  const stride = Math.max(1, Math.ceil(bins.length / 8))

  if (!bins.length) return empty(emptyState)

  return (
    <div className="chart-shell" ref={ref}>
      {width > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption}
          onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPt({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
          onPointerLeave={() => setHover(null)}>
          <GridY scale={sy} ticks={ticksFor(0, niceMax, 4)} x0={M.left} x1={M.left + plotW} />
          <AxisY scale={sy} ticks={ticksFor(0, niceMax, 4)} x={M.left}
            format={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
          {bins.map((b, i) => {
            const w = Math.max(0, Math.min(BAR_MAX, slot - GAP))
            const x = M.left + i * slot + (slot - w) / 2
            const h = M.top + plotH - sy(b.n)
            return (
              <g key={i} onPointerEnter={() => setHover(i)} tabIndex={0}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <rect x={M.left + i * slot} y={M.top} width={slot} height={plotH} fill="transparent" />
                {b.n > 0 && <path d={columnPath(x, sy(b.n), w, h)} fill={color} opacity={hover === i ? 1 : 0.88} />}
              </g>
            )
          })}
          <line x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH}
            stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
          {bins.map((b, i) => (i % stride === 0 ? (
            <text key={i} x={M.left + i * slot + slot / 2} y={M.top + plotH + 15} textAnchor="middle"
              fontSize="10" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatBin ? formatBin(b) : b.lo}
            </text>
          ) : null))}
          {xLabel && (
            <text x={M.left + plotW / 2} y={height - 4} textAnchor="middle" fontSize="10.5"
              fill="var(--text-muted)">{xLabel}</text>
          )}
        </svg>
      )}
      {hover != null && bins[hover] && (
        <Tooltip x={pt.x} y={pt.y} containerWidth={width}>
          <div className="tt-time">
            {formatBin ? formatBin(bins[hover]) : bins[hover].lo} – {formatBin ? formatBin({ lo: bins[hover].hi }) : bins[hover].hi}
          </div>
          <TooltipRow color={color} name="Count" value={bins[hover].n.toLocaleString('en-US')} />
          <TooltipRow color="var(--text-muted)" name="Share" muted
            value={`${((bins[hover].n / Math.max(1, total)) * 100).toFixed(1)}%`} />
        </Tooltip>
      )}
    </div>
  )
}

/* ================================================================== scatter */

/**
 * series: [{ id, label, color, points: [{x, y, meta}] }]
 * Capped at three colour series by the all-pairs rule — marks here can land
 * next to each other in any order, and no four-hue set clears those floors.
 * Past three, the caller folds the tail into one neutral "Other" series.
 */
export function ScatterChart({
  series, xLabel, yLabel, formatX = (v) => v, formatY = (v) => v,
  height = 280, caption, tableColumns, tableRows, xDomain, yDomain, emptyState,
}) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState(null)
  const [pt, setPt] = useState({ x: 0, y: 0 })
  const M = { left: 52, right: 16, top: 32, bottom: 46 }
  const plotW = Math.max(40, width - M.left - M.right)
  const plotH = Math.max(40, height - M.top - M.bottom)

  const pts = series.flatMap((s) => s.points.map((p) => ({ ...p, s })))
  const [x0, x1] = xDomain ?? niceDomain(minOf(pts.map((p) => p.x), 0), maxOf(pts.map((p) => p.x), 1), 4)
  const [y0, y1] = yDomain ?? niceDomain(minOf(pts.map((p) => p.y), 0), maxOf(pts.map((p) => p.y), 1), 4)
  const sx = linear(x0, x1, M.left, M.left + plotW)
  const sy = linear(y0, y1, M.top + plotH, M.top)

  /* Nearest-point hit testing: a reader only has to get closest, not land
     dead-centre on an 8px dot. */
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    setPt({ x: mx, y: my })
    let best = null
    let bestD = 36 ** 2
    for (const p of pts) {
      const dx = sx(p.x) - mx
      const dy = sy(p.y) - my
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = p }
    }
    setHover(best)
  }

  if (!pts.length) return empty(emptyState)

  return (
    <div className="chart-shell" ref={ref}>
      <Legend items={series.map((s) => ({ id: s.id, label: s.label, color: s.color, shape: 'rect' }))} />
      {width > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`} style={{ marginTop: 8 }}
          role="img" aria-label={caption} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <GridY scale={sy} ticks={ticksFor(y0, y1, 4)} x0={M.left} x1={M.left + plotW} />
          <AxisY scale={sy} ticks={ticksFor(y0, y1, 4)} x={M.left} format={formatY} />
          {yLabel && (
            <text x={M.left} y={M.top - 12} textAnchor="start" fontSize="10.5"
              fill="var(--text-muted)" aria-hidden="true">{yLabel}</text>
          )}
          <AxisX scale={sx} ticks={ticksFor(x0, x1, Math.max(2, Math.floor(plotW / 70)))}
            y={M.top + plotH} format={formatX} label={xLabel} />
          {pts.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={hover === p ? 6 : 4.5}
              fill={p.s.color} fillOpacity={hover === p ? 1 : 0.72}
              stroke="var(--surface-1)" strokeWidth="2" />
          ))}
        </svg>
      )}
      {hover && (
        <Tooltip x={pt.x} y={pt.y} containerWidth={width}>
          <div className="tt-time">{hover.meta ?? hover.s.label}</div>
          <TooltipRow color={hover.s.color} name={xLabel ?? 'x'} value={formatX(hover.x)} />
          <TooltipRow color={hover.s.color} name={yLabel ?? 'y'} value={formatY(hover.y)} />
        </Tooltip>
      )}
      {tableColumns && <TableView columns={tableColumns} rows={tableRows} caption={caption} />}
    </div>
  )
}

/* ================================================================== heatmap */

/** Sequential magnitude grid — one hue light->dark, with its scale legend. */
export function Heatmap({
  rows, cols, cells, lo, hi, formatValue, colLabel, caption, unit = '',
  cellH = 24, labelW = 140, colUnit, tableColumns, tableRows, emptyState,
}) {
  const [ref, width] = useMeasure()
  const [hover, setHover] = useState(null)
  const [pt, setPt] = useState({ x: 0, y: 0 })
  const plotW = Math.max(60, width - labelW - 10)
  const cellW = plotW / Math.max(1, cols.length)
  const height = rows.length * cellH + 32
  const stride = Math.max(1, Math.ceil(cols.length / 12))

  const lookup = useMemo(() => {
    const m = new Map()
    for (const c of cells) m.set(`${c.row}|${c.col}`, c)
    return m
  }, [cells])

  if (!rows.length || !cols.length) return empty(emptyState)

  return (
    <div className="chart-shell" ref={ref}>
      {width > 0 && (
        <svg height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption}
          onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPt({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
          onPointerLeave={() => setHover(null)}>
          {rows.map((r, ri) => (
            <text key={r} x={labelW - 10} y={ri * cellH + cellH / 2} dy="0.32em" textAnchor="end"
              fontSize="11" fill="var(--text-secondary)">{r}</text>
          ))}
          {rows.map((r, ri) => cols.map((c, ci) => {
            const cell = lookup.get(`${r}|${c}`)
            const norm = cell && Number.isFinite(cell.value) ? (cell.value - lo) / (hi - lo || 1) : NaN
            const on = hover && hover.row === r && hover.col === c
            return (
              <rect key={`${r}-${c}`} x={labelW + ci * cellW + GAP / 2} y={ri * cellH + GAP / 2}
                width={Math.max(0, cellW - GAP)} height={cellH - GAP} rx="2"
                fill={Number.isFinite(norm) ? seqColor(norm) : 'var(--surface-2)'}
                stroke={on ? 'var(--text-primary)' : 'none'} strokeWidth="1.5"
                onPointerEnter={() => setHover({ row: r, col: c, cell })}
                tabIndex={0} onFocus={() => setHover({ row: r, col: c, cell })} onBlur={() => setHover(null)} />
            )
          }))}
          {cols.map((c, ci) => (ci % stride === 0 ? (
            <text key={c} x={labelW + ci * cellW + cellW / 2} y={rows.length * cellH + 14}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}>{c}</text>
          ) : null))}
          {colLabel && (
            <text x={labelW + plotW / 2} y={height - 2} textAnchor="middle" fontSize="10.5"
              fill="var(--text-muted)">{colLabel}</text>
          )}
          {colUnit && (
            <text x={labelW + plotW} y={height - 2} textAnchor="end" fontSize="10.5"
              fill="var(--text-muted)">{colUnit}</text>
          )}
        </svg>
      )}
      <ScaleLegend lo={lo} hi={hi} formatValue={formatValue} unit={unit} />
      {hover?.cell && (
        <Tooltip x={pt.x} y={pt.y} containerWidth={width}>
          <div className="tt-time">{hover.row} · {hover.col}</div>
          <TooltipRow color={seqColor((hover.cell.value - lo) / (hi - lo || 1))} name="Value"
            value={formatValue ? formatValue(hover.cell.value) : hover.cell.value.toFixed(1)} />
          {hover.cell.n != null && (
            <TooltipRow color="var(--text-muted)" name="Cycles" muted value={hover.cell.n} />
          )}
        </Tooltip>
      )}
      {tableColumns && <TableView columns={tableColumns} rows={tableRows} caption={caption} />}
    </div>
  )
}

/** A continuous scale always ships its legend — colour alone never carries a value. */
export function ScaleLegend({ lo, hi, formatValue, unit = '', label }) {
  return (
    <div className="row" style={{ gap: 8, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
      {label && <span>{label}</span>}
      <span className="mono">{formatValue ? formatValue(lo) : lo.toFixed(1)}{unit}</span>
      <span style={{
        display: 'flex', borderRadius: 'var(--radius-xs)', overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        {SEQ_STEPS.map((c, i) => <span key={i} style={{ width: 13, height: 11, background: c }} />)}
      </span>
      <span className="mono">{formatValue ? formatValue(hi) : hi.toFixed(1)}{unit}</span>
    </div>
  )
}
