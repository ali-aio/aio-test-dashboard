import React, { useRef, useState, useLayoutEffect, useMemo, useEffect } from 'react'

// One axis, recessive grid, crosshair + tooltip. Both charts apply a moving-average
// smoothing before drawing: raw battery readings are jittery enough to look broken
// otherwise (see CLAUDE.md). Never a second y-scale — two measures mean two charts.

function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
const smoothY = (pts, on) => on
  ? pts.map((p, i) => { const w = pts.slice(Math.max(0, i - 1), i + 2); return w.reduce((a, q) => a + q.y, 0) / w.length })
  : pts.map(p => p.y)

// T7's tooltip (.chart-tooltip with .tt-time / .tt-row), so hovering reads the same as on
// the Overview. Placed beside the crosshair, flipped to the left near the right edge.
function Tip({ x, y, html, width }) {
  if (!html) return null
  const right = x > width - 200
  return <div className="chart-tooltip" style={{ left: right ? undefined : x + 14, right: right ? width - x + 14 : undefined, top: Math.max(0, y - 20) }}
    dangerouslySetInnerHTML={{ __html: html }} />
}

/** T7 tooltip markup from rows of { color, name, value }. */
export const tooltipHtml = (title, rows) =>
  `<div class="tt-time">${title}</div>` + rows.map(r =>
    `<div class="tt-row"><span class="tt-key" style="background:${r.color}"></span><span class="tt-name">${r.name}</span><span class="tt-val">${r.value}</span></div>`).join('')

export function LineChart({ pts, h = 180, yMax = 100, yFmt = v => v, xFmt, tip, refs = [], area = false, smooth = false, empty = 'No samples yet.' }) {
  const [ref, W] = useWidth()
  const [hit, setHit] = useState(null)
  if (!pts.length) return <div className="chart" ref={ref}><div className="empty">{empty}</div></div>
  const pl = 38, pr = 8, pt = 8, pb = 22
  const x0 = pts[0].x, dx = (pts[pts.length - 1].x - x0) || 1
  const X = x => pl + (x - x0) / dx * (W - pl - pr)
  const Y = v => pt + (1 - Math.min(v, yMax) / yMax) * (h - pt - pb)
  const ys = smoothY(pts, smooth)
  const d = ys.map((v, i) => `${i ? 'L' : 'M'}${X(pts[i].x).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const xt = (W < 420 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map(f => x0 + f * dx)
  const pick = px => { const xv = x0 + (px - pl) / (W - pl - pr) * dx; let b = 0, bd = Infinity; pts.forEach((p, i) => { const dd = Math.abs(p.x - xv); if (dd < bd) { bd = dd; b = i } }); return b }
  const i = hit
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${h}`} style={{ height: h }}>
        {[0, .5, 1].map(f => <g key={f}>
          <line x1={pl} x2={W - pr} y1={Y(yMax * f)} y2={Y(yMax * f)} stroke="var(--grid)" />
          <text x={pl - 6} y={Y(yMax * f) + 3} textAnchor="end">{yFmt(yMax * f)}</text>
        </g>)}
        {xt.map((x, k) => <text key={k} x={X(x)} y={h - 4} textAnchor={k === 0 ? 'start' : k === xt.length - 1 ? 'end' : 'middle'}>{xFmt(x)}</text>)}
        {refs.map((r, k) => <g key={k}>
          <line x1={pl} x2={W - pr} y1={Y(r.v)} y2={Y(r.v)} stroke={r.color || 'var(--text-3)'} strokeDasharray="3 3" />
          <text x={W - pr} y={Y(r.v) - 4} textAnchor="end" fill={r.color || 'var(--text-3)'}>{r.label}</text>
        </g>)}
        {area && <path className="area" d={`${d}L${X(x0 + dx)},${Y(0)}L${X(x0)},${Y(0)}Z`} fill="var(--series-soft)" />}
        <path className="draw" pathLength="1" d={d} fill="none" stroke="var(--series)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {i != null && <line y1={pt} y2={h - pb} x1={X(pts[i].x)} x2={X(pts[i].x)} stroke="var(--border-strong)" />}
        <rect x={pl} y={0} width={W - pl - pr} height={h} fill="transparent" className="hit"
          onMouseMove={e => setHit(pick(e.clientX - e.currentTarget.getBoundingClientRect().left + pl))}
          onMouseLeave={() => setHit(null)} />
      </svg>
      {i != null && <div className="hdot" style={{ opacity: 1, left: X(pts[i].x), top: Y(ys[i]) }} />}
      {i != null && <Tip x={X(pts[i].x)} y={Y(ys[i])} html={tip(pts[i])} width={W} />}
    </div>
  )
}

// Many lines, one y-axis. Each series carries its own colour/dash; `endLabel` direct-labels
// it at the right edge, nudged apart so labels never collide (identity is never colour
// alone — the legend above the chart names every series).
// y2 (optional): a second, right-hand axis { min, max, fmt, color } for series marked
// `axis: 'right'` — two measures on one chart (battery % left, temperature right).
export function MultiLineChart({ series, h = 220, yMax = 100, yMin = 0, yFmt = v => v, xFmt, refs = [], tip, smooth = true, x0, x1, empty = 'No readings in this window yet.', y2 = null }) {
  const [ref, W] = useWidth()
  const [hitX, setHitX] = useState(null)
  // the pointer at most once per screen frame (each update re-renders the crosshair and tooltip)
  const frame = useRef(0), lastX = useRef(null)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const live = useMemo(() => series.filter(s => s.pts.length > 1), [series])
  // the smoothed line of every series, worked out once per data / size change, not on every
  // pointer move (24 devices x hundreds of readings made hovering on Today lag, Oct 2026)
  const smoothed = useMemo(() => new Map(live.map(s => [s, smoothY(s.pts, smooth && s.smooth !== false)])), [live, smooth])
  const pl = 38, pr = 54, pt = 10, pb = 22
  const xa = x0 ?? (live.length ? Math.min(...live.map(s => s.pts[0].x)) : 0)
  const xb = x1 ?? (live.length ? Math.max(...live.map(s => s.pts[s.pts.length - 1].x)) : 1)
  const dx = (xb - xa) || 1, span = (yMax - yMin) || 1
  const X = v => pl + (v - xa) / dx * (W - pl - pr)
  const Y = v => pt + (1 - (Math.min(Math.max(v, yMin), yMax) - yMin) / span) * (h - pt - pb)
  const y2min = y2?.min ?? 0, span2 = y2 ? ((y2.max - y2min) || 1) : 1
  const Y2 = v => pt + (1 - (Math.min(Math.max(v, y2min), y2?.max ?? 1) - y2min) / span2) * (h - pt - pb)
  const Yof = s => (y2 && s.axis === 'right' ? Y2 : Y)
  // a series can opt out (`smooth: false`): a two-point projection averaged with itself goes flat
  const path = s => { const ys = smoothed.get(s), Ys = Yof(s); return ys.map((v, i) => `${i ? 'L' : 'M'}${X(s.pts[i].x).toFixed(1)},${Ys(v).toFixed(1)}`).join('') }
  const xt = (W < 460 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map(f => xa + f * dx)
  const labs = live.filter(s => s.endLabel).map(s => ({ s, y: Yof(s)(s.pts[s.pts.length - 1].y) })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12
  // nearest reading by binary search (the points are in time order)
  const near = (s, t) => { const a = s.pts; let lo = 0, hi = a.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].x < t) lo = m + 1; else hi = m }
    return lo > 0 && Math.abs(a[lo - 1].x - t) <= Math.abs(a[lo].x - t) ? a[lo - 1] : a[lo] }
  // the lines, rebuilt only when the data or the size changes (not on hover)
  const lanes = useMemo(() => live.map((s, k) => <path key={s.id ?? k} className="lane" d={path(s)} stroke={s.color} strokeWidth={s.width || 1.6}
    opacity={s.opacity ?? 1} strokeDasharray={s.dash || undefined} />), [live, smoothed, W, h, yMax, yMin, xa, xb, y2])
  if (!live.length) return <div className="chart" ref={ref}><div className="empty">{empty}</div></div>
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${h}`} style={{ height: h }}>
        {[0, .5, 1].map(f => { const v = yMin + f * span; return <g key={f}>
          <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
          <text x={pl - 6} y={Y(v) + 3} textAnchor="end" fill={y2?.leftColor}>{yFmt(v)}</text>
          {y2 && <text x={W - pr + 6} y={Y(v) + 3} textAnchor="start" fill={y2.color}>{(y2.fmt || (x => x))(y2min + f * span2)}</text>}
        </g> })}
        {xt.map((x, k) => <text key={k} x={X(x)} y={h - 4} textAnchor={k === 0 ? 'start' : k === xt.length - 1 ? 'end' : 'middle'}>{xFmt(x)}</text>)}
        {refs.map((r, k) => <g key={k}>
          <line x1={pl} x2={W - pr} y1={Y(r.v)} y2={Y(r.v)} stroke={r.color || 'var(--text-3)'} strokeDasharray="4 3" />
          <text x={pl + 4} y={Y(r.v) - 4} fill={r.color || 'var(--text-3)'}>{r.label}</text>
        </g>)}
        {lanes}
        {/* a series with onLabel makes its end label a button (Today: highest / middle / lowest device) */}
        {labs.map(({ s, y }, k) => <text key={k} className={`endlab${s.onLabel ? ' is-link' : ''}`} x={W - pr + 6} y={y + 3} fill={s.labelColor || s.color}
          onClick={s.onLabel || undefined} role={s.onLabel ? 'button' : undefined}>{s.labelTitle ? <title>{s.labelTitle}</title> : null}{s.endLabel}</text>)}
        {hitX != null && <line y1={pt} y2={h - pb} x1={X(hitX)} x2={X(hitX)} stroke="var(--border-strong)" />}
        <rect x={pl} y={0} width={W - pl - pr} height={h} fill="transparent" className="hit"
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect(); lastX.current = xa + (e.clientX - r.left) / (W - pl - pr) * dx
            if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (lastX.current != null) setHitX(lastX.current) })
          }}
          onMouseLeave={() => { lastX.current = null; setHitX(null) }} />
      </svg>
      {hitX != null && tip && (() => {
        // A line only answers for times it covers (10 min of slack): the projection starts
        // now, so hovering at 1 PM must not report its first point as a 1 PM reading.
        const slack = 10 * 60e3
        const covering = live.filter(s => hitX >= s.pts[0].x - slack && hitX <= s.pts[s.pts.length - 1].x + slack)
        if (!covering.length) return null
        return <Tip x={X(hitX)} y={Yof(covering[0])(near(covering[0], hitX).y)} html={tip(hitX, covering.map(s => ({ s, p: near(s, hitX) })))} width={W} />
      })()}
    </div>
  )
}

export function Sparkline({ vals }) {
  if (vals.length < 2) return <span className="muted">—</span>
  const mn = Math.min(...vals), mx = Math.max(...vals), sp = (mx - mn) || 1
  const P = vals.map((v, i) => [2 + i / (vals.length - 1) * 80, 19 - (v - mn) / sp * 16])
  return (
    <svg className="spark" viewBox="0 0 84 22">
      <polyline points={P.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')} fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={P[P.length - 1][0]} cy={P[P.length - 1][1]} r="2.5" fill="var(--series)" />
    </svg>
  )
}

// Catmull-Rom through the points as cubic Béziers (the same spline shared/chart.js draws),
// clamped to the plot so an overshoot never pokes past 0 or 100 %.
const spline = (P, lo, hi) => {
  if (P.length < 3) return P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  const c = v => Math.min(hi, Math.max(lo, v))
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${c(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${c(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
// Split a time series where readings stop (device offline): a line across a gap would
// invent readings that never happened.
const splitGaps = (pts, gap) => {
  const out = []; let cur = []
  for (const p of pts) { if (cur.length && p.x - cur[cur.length - 1].x > gap) { out.push(cur); cur = [] } cur.push(p) }
  if (cur.length) out.push(cur)
  return out
}
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880].map(m => m * 60e3)

/** One device's battery over time, the MDM's look: a line with a soft fill under it, and a
 *  strip under the plot — green while charging, grey on battery. Temperature, when given and
 *  switched on, is a thin dashed line on its own right-hand scale. */
export function BatteryAreaChart({ batt, temp = [], charging = [], x0, x1, h = 300, showTemp = true, tMax = 60, empty = 'No readings in this span.' }) {
  const [ref, W] = useWidth()
  const [hitX, setHitX] = useState(null)
  const gid = React.useId().replace(/:/g, '')
  if (batt.length < 2) return <div className="chart" ref={ref}><div className="empty">{empty}</div></div>
  const withT = showTemp && temp.length > 1
  const pl = 44, pr = withT ? 44 : 14, pt = 12, stripH = 6, pb = 26, plotB = h - pb - stripH - 10
  const dx = (x1 - x0) || 1
  const X = v => pl + (v - x0) / dx * (W - pl - pr)
  const Y = v => pt + (1 - Math.min(100, Math.max(0, v)) / 100) * (plotB - pt)
  const YT = v => pt + (1 - Math.min(tMax, Math.max(0, v)) / tMax) * (plotB - pt)
  // a gap is three missed readings, never less than 20 min
  const steps = batt.slice(1).map((p, i) => p.x - batt[i].x).sort((a, b) => a - b)
  const gap = Math.max(20 * 60e3, 3 * (steps[steps.length >> 1] || 0))
  const segs = splitGaps(batt, gap).filter(s => s.length > 1)
  const ys = s => smoothY(s, true)
  const line = s => spline(s.map((p, i) => [X(p.x), Y(ys(s)[i])]), pt, plotB)
  const area = s => `${line(s)}L${X(s[s.length - 1].x).toFixed(1)},${plotB}L${X(s[0].x).toFixed(1)},${plotB}Z`
  const tSegs = withT ? splitGaps(temp, gap).filter(s => s.length > 1) : []
  // x ticks on round local times, as many as fit ~110 px apart
  const step = TICK_STEPS.find(s => dx / s <= Math.max(2, (W - pl - pr) / 110)) || TICK_STEPS[TICK_STEPS.length - 1]
  const off = new Date(x0).getTimezoneOffset() * 60e3
  // on round local times: (t − off) is local wall-clock ms
  const ticks = []
  for (let t = Math.ceil((x0 - off) / step) * step + off; t <= x1; t += step) ticks.push(t)
  const fmtTick = t => {
    const d = new Date(t)
    if (step >= 864e5 || (dx > 36 * 3600e3 && d.getHours() === 0 && d.getMinutes() === 0)) return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  // the charging strip: one rect per run of the same state, broken at gaps
  const strip = []
  for (let i = 0; i < charging.length - 1; i++) {
    const a = charging[i], b = charging[i + 1]
    if (b.x - a.x > gap) continue
    const last = strip[strip.length - 1]
    if (last && last.on === a.on && last.b === a.x) last.b = b.x
    else strip.push({ a: a.x, b: b.x, on: a.on })
  }
  const near = (pts, t) => pts.reduce((b, p) => (Math.abs(p.x - t) < Math.abs(b.x - t) ? p : b), pts[0])
  const hb = hitX != null ? near(batt, hitX) : null
  const live = hb && Math.abs(hb.x - hitX) <= gap / 2
  const ht = live && withT ? near(temp, hitX) : null, hc = live && charging.length ? near(charging, hitX) : null
  const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="chart live-chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${h}`} style={{ height: h }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--series-8)" stopOpacity=".26" />
            <stop offset="1" stopColor="var(--series-8)" stopOpacity=".03" />
          </linearGradient>
        </defs>
        {[0, 20, 40, 60, 80, 100].map(v => <g key={v}>
          <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="var(--gridline)" strokeWidth="1" />
          <text x={pl - 8} y={Y(v) + 4} textAnchor="end">{v}%</text>
          {withT && <text x={W - pr + 8} y={Y(v) + 4} textAnchor="start" style={{ fill: 'var(--series-2)' }}>{Math.round(tMax * v / 100)}°</text>}
        </g>)}
        {segs.map((s, k) => <path key={'a' + k} d={area(s)} fill={`url(#${gid})`} stroke="none" />)}
        {tSegs.map((s, k) => <path key={'t' + k} d={spline(s.map((p, i) => [X(p.x), YT(smoothY(s, true)[i])]), pt, plotB)}
          fill="none" stroke="var(--series-2)" strokeWidth="1.4" strokeDasharray="4 3" opacity=".85" />)}
        {segs.map((s, k) => <path key={'l' + k} d={line(s)} fill="none" stroke="var(--series-7)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />)}
        {strip.map((r, k) => <rect key={k} x={X(r.a)} y={plotB + 8} width={Math.max(1, X(r.b) - X(r.a))} height={stripH}
          fill={r.on ? 'var(--series-3)' : 'var(--gridline)'} />)}
        {ticks.map(t => <text key={t} x={X(t)} y={h - 6} textAnchor={X(t) > W - pr - 30 ? 'end' : X(t) < pl + 30 ? 'start' : 'middle'}>{fmtTick(t)}</text>)}
        {live && <g pointerEvents="none">
          <line x1={X(hb.x)} x2={X(hb.x)} y1={pt} y2={plotB} stroke="var(--border-strong)" />
          <circle cx={X(hb.x)} cy={Y(hb.y)} r="4" fill="var(--surface-1)" stroke="var(--series-7)" strokeWidth="2" />
        </g>}
        <rect x={pl} y={0} width={W - pl - pr} height={h} fill="transparent" className="hit"
          onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHitX(x0 + (e.clientX - r.left) / (W - pl - pr) * dx) }}
          onMouseLeave={() => setHitX(null)} />
      </svg>
      {live && <Tip x={X(hb.x)} y={Y(hb.y)} width={W} html={tooltipHtml(when(hb.x), [
        { color: 'var(--series-7)', name: 'Battery', value: `${Math.round(hb.y)}%` },
        ...(ht ? [{ color: 'var(--series-2)', name: 'Temperature', value: `${ht.y.toFixed(1)} °C` }] : []),
        ...(hc ? [{ color: hc.on ? 'var(--series-3)' : 'var(--gridline)', name: hc.on ? 'Charging' : 'On battery', value: '' }] : []),
      ])} />}
    </div>
  )
}
