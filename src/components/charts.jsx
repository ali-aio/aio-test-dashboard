import React, { useRef, useState, useLayoutEffect } from 'react'

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
export function MultiLineChart({ series, h = 220, yMax = 100, yMin = 0, yFmt = v => v, xFmt, refs = [], tip, smooth = true, x0, x1, empty = 'No readings in this window yet.' }) {
  const [ref, W] = useWidth()
  const [hitX, setHitX] = useState(null)
  const live = series.filter(s => s.pts.length > 1)
  if (!live.length) return <div className="chart" ref={ref}><div className="empty">{empty}</div></div>
  const pl = 38, pr = 54, pt = 10, pb = 22
  const xa = x0 ?? Math.min(...live.map(s => s.pts[0].x))
  const xb = x1 ?? Math.max(...live.map(s => s.pts[s.pts.length - 1].x))
  const dx = (xb - xa) || 1, span = (yMax - yMin) || 1
  const X = v => pl + (v - xa) / dx * (W - pl - pr)
  const Y = v => pt + (1 - (Math.min(Math.max(v, yMin), yMax) - yMin) / span) * (h - pt - pb)
  // a series can opt out (`smooth: false`): a two-point projection averaged with itself goes flat
  const path = s => { const ys = smoothY(s.pts, smooth && s.smooth !== false); return ys.map((v, i) => `${i ? 'L' : 'M'}${X(s.pts[i].x).toFixed(1)},${Y(v).toFixed(1)}`).join('') }
  const xt = (W < 460 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map(f => xa + f * dx)
  const labs = live.filter(s => s.endLabel).map(s => ({ s, y: Y(s.pts[s.pts.length - 1].y) })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12
  const near = (s, t) => s.pts.reduce((b, p) => Math.abs(p.x - t) < Math.abs(b.x - t) ? p : b, s.pts[0])
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${h}`} style={{ height: h }}>
        {[0, .5, 1].map(f => { const v = yMin + f * span; return <g key={f}>
          <line x1={pl} x2={W - pr} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" />
          <text x={pl - 6} y={Y(v) + 3} textAnchor="end">{yFmt(v)}</text>
        </g> })}
        {xt.map((x, k) => <text key={k} x={X(x)} y={h - 4} textAnchor={k === 0 ? 'start' : k === xt.length - 1 ? 'end' : 'middle'}>{xFmt(x)}</text>)}
        {refs.map((r, k) => <g key={k}>
          <line x1={pl} x2={W - pr} y1={Y(r.v)} y2={Y(r.v)} stroke={r.color || 'var(--text-3)'} strokeDasharray="4 3" />
          <text x={pl + 4} y={Y(r.v) - 4} fill={r.color || 'var(--text-3)'}>{r.label}</text>
        </g>)}
        {live.map((s, k) => <path key={s.id ?? k} className="lane" d={path(s)} stroke={s.color} strokeWidth={s.width || 1.6}
          opacity={s.opacity ?? 1} strokeDasharray={s.dash || undefined} />)}
        {labs.map(({ s, y }, k) => <text key={k} className="endlab" x={W - pr + 6} y={y + 3} fill={s.labelColor || s.color}>{s.endLabel}</text>)}
        {hitX != null && <line y1={pt} y2={h - pb} x1={X(hitX)} x2={X(hitX)} stroke="var(--border-strong)" />}
        <rect x={pl} y={0} width={W - pl - pr} height={h} fill="transparent" className="hit"
          onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHitX(xa + (e.clientX - r.left) / (W - pl - pr) * dx) }}
          onMouseLeave={() => setHitX(null)} />
      </svg>
      {hitX != null && tip && (() => {
        // A line only answers for times it covers (10 min of slack): the projection starts
        // now, so hovering at 1 PM must not report its first point as a 1 PM reading.
        const slack = 10 * 60e3
        const covering = live.filter(s => hitX >= s.pts[0].x - slack && hitX <= s.pts[s.pts.length - 1].x + slack)
        if (!covering.length) return null
        return <Tip x={X(hitX)} y={Y(near(covering[0], hitX).y)} html={tip(hitX, covering.map(s => ({ s, p: near(s, hitX) })))} width={W} />
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
