import React, { useEffect, useMemo, useSyncExternalStore } from 'react'
import { loadWindow, subscribeWindow, getWindow, buckets, dayStats, conform, temp, WINDOW_HOURS } from '../lib/window.js'
import { testType, ttSlot, resolveDay, STATUS, groupSerials, todayKey, dayKey, dayLong, dayLabel, timeOn, loadDecls, loadRota } from '../lib/plan.js'
import { TEMP_WARN, TEMP_LIMIT } from '../lib/profile.js'
import { fmtDur } from '../lib/cycles.js'
import { median, pctl, hm, ago, MIN } from '../lib/format.js'
import { online, status } from '../lib/device.js'
import { GROUP } from '../lib/fleet.js'
import { MultiLineChart, Sparkline } from '../components/charts.jsx'

const CSTATE = { conforming: ['b-ok', 'Conforming'], drifting: ['b-warn', 'Drifting'], silent: ['b-off', 'Not reporting'], untyped: ['b-off', 'No test declared'] }
const statusBadge = st => <span className={`badge ${{ declared: 'b-run', confirmed: 'b-ok', inferred: 'b-warn', unclassified: 'b-off', none: 'b-off' }[st]}`}>{STATUS[st].glyph} {STATUS[st].label}</span>

export default function TodayView({ fleet, inspect }) {
  const { DEV, allCycles, opts } = fleet
  const win = useSyncExternalStore(subscribeWindow, getWindow)
  useEffect(() => { loadWindow(DEV) }, [DEV])

  const key = todayKey(), now = Date.now()
  const T = useMemo(() => {
    const ran = allCycles.filter(c => dayKey(c.end) === key).length
    const r = resolveDay(key, { decls: DECLS(), rota: ROTA(), ran, devices: DEV.length })
    const src = r.decl || r.rota || null
    return { ...r, tt: testType(r.testType), src, ran,
      serials: groupSerials(src && src.group, DEV),
      startMs: timeOn(key, src && src.startTime), endMs: timeOn(key, src && src.endTime, true) }
  }, [DEV, allCycles, win.at2, key])

  const winTo = Math.min(now, T.endMs)
  const elapsed = Math.max(0, winTo - T.startMs), expected = T.endMs - T.startMs
  const conf = useMemo(() => T.serials.map(s => conform(s, T.tt, T.startMs, winTo)), [T, win.at2])
  const reporting = conf.filter(c => c.state !== 'silent')
  const conforming = conf.filter(c => c.state === 'conforming')
  const drifting = conf.filter(c => c.state === 'drifting')
  const firstRow = Math.min(...reporting.map(c => Date.parse(c.rows[0].timestamp)).filter(isFinite))
  const p50 = useMemo(() => buckets(T.serials, T.startMs, winTo, temp, median), [T, win.at2])
  const p95 = useMemo(() => buckets(T.serials, T.startMs, winTo, temp, a => pctl(a, .95)), [T, win.at2])

  useEffect(() => { inspect(<TodayInspector T={T} conforming={conforming} drifting={drifting} reporting={reporting} />) },
    [T.testType, conforming.length, drifting.length, reporting.length])

  const lastOf = c => c.rows[c.rows.length - 1].battery_pct
  const lo = conforming.length ? conforming.reduce((a, b) => lastOf(b) < lastOf(a) ? b : a) : null
  const hi = conforming.length ? conforming.reduce((a, b) => lastOf(b) > lastOf(a) ? b : a) : null
  const series = [
    ...conforming.map(c => ({ id: c.serial, pts: c.rows.map(r => ({ x: Date.parse(r.timestamp), y: r.battery_pct })), color: 'var(--tt-1)', width: 1.4, opacity: .5, endLabel: (c === lo || c === hi) ? `${lastOf(c)}%` : null, labelColor: 'var(--text-2)' })),
    ...drifting.map(c => ({ id: c.serial, pts: c.rows.map(r => ({ x: Date.parse(r.timestamp), y: r.battery_pct })), color: 'var(--warn)', width: 1.8, dash: '5 3', endLabel: `${lastOf(c)}%`, labelColor: 'var(--warn)' })),
  ]

  return (
    <div className="stack">
      <div className="panel" style={{ borderLeft: `3px solid ${T.tt ? `var(--tt-${ttSlot(T.tt.id)})` : 'var(--border-strong)'}` }}>
        <div className="panel-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, letterSpacing: '.04em', color: 'var(--text-3)', fontWeight: 600 }}>
            {dayLong(key)} {statusBadge(T.status)}
            <span className={`badge ${reporting.length ? 'b-run live' : 'b-off'}`}>Live · {reporting.length} device{reporting.length === 1 ? '' : 's'} reporting</span>
          </div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 26, lineHeight: 1.15 }}>{T.tt ? T.tt.name : 'No test declared'}</h1>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {T.tt ? <>{T.source === 'rota' ? 'From the standing weekly rota' : <>Declared{T.src?.by ? <> by <b>{T.src.by}</b></> : null}{T.src?.at ? ` at ${hm(T.src.at)}` : ''}</>}
              {' '}· {T.serials.length} devices · window {hm(T.startMs)}–{hm(T.endMs)} · every MDM row from these serials today is stamped with this test type.</>
              : <>Telemetry cannot say which test this is — the MDM carries no test type. <a className="link" href="#/nx/plan">Declare one on the Cycle plan</a> and today's rows are stamped with it.</>}
          </div>
        </div>
      </div>

      <div className="panel"><div className="metrics">
        <Metric label="Elapsed" value={<>{fmtDur(elapsed)}<span className="muted" style={{ fontSize: 13 }}> of ~{fmtDur(expected)}</span></>}
          delta={T.tt ? `started ${hm(T.startMs)}${isFinite(firstRow) ? ` · first row ${hm(firstRow)}` : ''}` : ''} />
        <Metric label="Conforming to plan" color={T.tt && conforming.length ? 'var(--ok)' : null}
          value={<>{conforming.length}<span className="muted" style={{ fontSize: 13 }}> / {T.serials.length}</span></>}
          delta={T.tt ? 'telemetry matches the declared test' : 'nothing to match against'} />
        <Metric label="Drifting" color={drifting.length ? 'var(--warn)' : null} value={drifting.length}
          delta={drifting.length ? 'label will drop to Unclassified' : T.tt ? 'every reporting device matches' : ''} />
        <Metric label="Not reporting" value={T.serials.length - reporting.length} delta="no rows in the window" />
        <Metric label="Cycles finished today" value={T.ran} delta="counted cycles" />
      </div></div>

      {!win.at ? <Stale win={win} n={DEV.length} /> : <>
        <div className="panel">
          <div className="panel-head"><h2>T7 battery, today</h2><span className="muted">live from MDM · 5-minute rows</span></div>
          <div className="panel-body">
            <div className="slegend" style={{ marginBottom: 8 }}>
              <span><i style={{ borderColor: 'var(--tt-1)' }} />Conforming ({conforming.length})</span>
              {drifting.length ? <span><i style={{ borderColor: 'var(--warn)', borderTopStyle: 'dashed' }} />Drifting ({drifting.length}) — {drifting.map(d => d.serial.slice(-4)).join(', ')}</span> : null}
              <span className="muted">labels mark the lowest and highest</span>
            </div>
            <MultiLineChart series={series} h={230} yMax={100} yFmt={v => v + '%'} xFmt={hm} x0={T.startMs} x1={winTo}
              tip={(t, hits) => { const top = hits.filter(x => x.p).sort((a, b) => a.p.y - b.p.y).slice(0, 4)
                return `<b>${hm(t)}</b><br>${top.map(({ s, p }) => `${s.id.slice(-5)} ${p.y}%`).join('<br>')}${hits.length > 4 ? `<br><span style="opacity:.7">+${hits.length - 4} more</span>` : ''}` }} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Battery temperature, today</h2><span className="muted">fleet median and 95th percentile · °C</span></div>
          <div className="panel-body">
            <div className="slegend" style={{ marginBottom: 8 }}>
              <span><i style={{ borderColor: 'var(--tt-1)' }} />Median</span>
              <span><i style={{ borderColor: 'var(--tt-2)', borderTopStyle: 'dashed' }} />95th percentile</span>
              <span><i style={{ borderColor: 'var(--warn)', borderTopStyle: 'dashed' }} />{TEMP_LIMIT} °C review threshold</span>
            </div>
            <MultiLineChart h={230} yMax={60} yFmt={v => v.toFixed(0) + '°'} xFmt={hm} x0={T.startMs} x1={winTo}
              refs={[{ v: TEMP_LIMIT, label: `${TEMP_LIMIT} °C review threshold`, color: 'var(--warn)' }]}
              series={[
                { id: 'p50', pts: p50, color: 'var(--tt-1)', width: 2, endLabel: p50.length ? `p50 ${p50[p50.length - 1].y.toFixed(0)}°` : null },
                { id: 'p95', pts: p95, color: 'var(--tt-2)', width: 2, dash: '5 3', endLabel: p95.length ? `p95 ${p95[p95.length - 1].y.toFixed(0)}°` : null },
              ]}
              tip={(t, hits) => `<b>${hm(t)}</b><br>${hits.map(({ s, p }) => `${s.id} ${p.y.toFixed(1)} °C`).join('<br>')}`} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Devices today</h2><span className="muted">{reporting.length} reporting</span></div>
          <div className="scroll-x"><table>
            <thead><tr><th>Device</th><th>Against plan</th><th className="r">Battery</th><th className="r">At window start</th><th className="r">Change</th><th className="r">Temp now</th><th className="r">Peak today</th><th className="r">≥{TEMP_LIMIT} °C</th><th className="r">Today</th></tr></thead>
            <tbody>
              {conf.slice().sort((a, b) => (a.state === 'drifting' ? -1 : 0) - (b.state === 'drifting' ? -1 : 0)).map(c => {
                const d = fleet.DMAP.get(c.serial); if (!d) return null
                const st = status(d), s = dayStats(c.serial, T.startMs), cs = CSTATE[c.state]
                return <tr className="row" key={c.serial} onClick={() => inspect(<DeviceDay d={d} from={T.startMs} />)}>
                  <td className="mono">{c.serial}</td>
                  <td><span className={`badge ${cs[0]}`}>{cs[1]}</span></td>
                  <td className="r">{st.pct != null ? <span className="batt num">{st.pct}%<span className={`bar ${st.pct < 20 ? 'warn' : st.k === 'ready' ? 'ok' : 'run'}`}><i style={{ width: `${st.pct}%` }} /></span></span> : <span className="muted">—</span>}</td>
                  <td className="r num">{c.rows?.length ? c.rows[0].battery_pct + '%' : <span className="muted">—</span>}</td>
                  <td className="r num" style={{ color: c.state === 'drifting' ? 'var(--warn)' : 'inherit' }}>{c.delta != null ? (c.delta > 0 ? '+' : '') + c.delta + '%' : <span className="muted">—</span>}</td>
                  <td className="r num" style={{ color: online(d) && d.snap.battery_temp_c >= TEMP_LIMIT ? 'var(--bad)' : online(d) && d.snap.battery_temp_c >= TEMP_WARN ? 'var(--warn)' : 'inherit' }}>{online(d) && d.snap.battery_temp_c ? d.snap.battery_temp_c.toFixed(1) + ' °C' : <span className="muted">—</span>}</td>
                  <td className="r num" style={{ color: s?.maxTemp >= TEMP_LIMIT ? 'var(--bad)' : s?.maxTemp >= TEMP_WARN ? 'var(--warn)' : 'inherit' }}>{s?.maxTemp != null ? s.maxTemp.toFixed(1) + ' °C' : <span className="muted">—</span>}</td>
                  <td className="r num" style={{ color: s?.minAbove45 ? 'var(--bad)' : 'inherit' }}>{s?.minAbove45 ? fmtDur(s.minAbove45 * MIN) : <span className="muted">—</span>}</td>
                  <td className="r">{s ? <Sparkline vals={s.battPts.map(p => p.y)} /> : <span className="muted">—</span>}</td>
                </tr>
              })}
            </tbody>
          </table></div>
        </div>
      </>}
    </div>
  )
}

// plan.js stores per cycles-group; these keep the group name in one place.
const DECLS = () => loadDecls(GROUP)
const ROTA = () => loadRota(GROUP)

const Metric = ({ label, value, delta, color }) => (
  <div className="metric"><small>{label}</small><b className="num" style={color ? { color } : undefined}>{value}</b><span className="delta">{delta}</span></div>
)
const Stale = ({ win, n }) => (
  <div className="callout">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" /></svg>
    <div>{win.loading ? <><span className="spin" /> Reading the last {WINDOW_HOURS} h of history for {n} devices…</> : win.err ? `Could not read recent history: ${win.err}` : 'No recent history loaded yet.'}</div>
  </div>
)
function DeviceDay({ d, from }) {
  const s = dayStats(d.serial, from), st = status(d)
  return <>
    <h3 className="mono">{d.serial}</h3>
    <div className="isub">{(d.snap?.device_class || 'device').toUpperCase()} · {st.label} · seen {ago(Date.parse(d.snap.last_seen_at))}</div>
    <div className="big num">{st.pct != null ? st.pct + '%' : '—'}<small>{online(d) && d.snap.battery_temp_c ? d.snap.battery_temp_c.toFixed(1) + ' °C now' : st.label.toLowerCase()}</small></div>
    {!s ? <div className="empty">No readings in this window.</div> : <>
      <hr /><h4>Today</h4>
      <dl className="kv">
        <dt>At window start</dt><dd className="num">{s.startPct}%</dd>
        <dt>Drained</dt><dd className="num">{s.drained.toFixed(0)}%</dd>
        <dt>Peak temperature</dt><dd className="num" style={{ color: s.maxTemp >= TEMP_LIMIT ? 'var(--bad)' : s.maxTemp >= TEMP_WARN ? 'var(--warn)' : 'inherit' }}>{s.maxTemp != null ? s.maxTemp.toFixed(1) + ' °C' : '—'}</dd>
        <dt>Average temperature</dt><dd className="num">{s.avgTemp != null ? s.avgTemp.toFixed(1) + ' °C' : '—'}</dd>
        <dt>Over {TEMP_LIMIT} °C</dt><dd className="num" style={{ color: s.minAbove45 ? 'var(--bad)' : 'inherit' }}>{s.minAbove45 ? fmtDur(s.minAbove45 * MIN) : '—'}</dd>
        <dt>Samples</dt><dd className="num">{s.n}</dd>
      </dl>
    </>}
  </>
}
function TodayInspector({ T, conforming, drifting, reporting }) {
  return <>
    <h3>{T.tt ? T.tt.name : 'No test declared'}</h3>
    <div className="isub">{dayLabel(T.key)} · {STATUS[T.status].label}</div>
    <div className="big num">{T.serials.length ? Math.round(conforming.length / T.serials.length * 100) : 0}%<small>conforming to plan</small></div>
    <hr /><h4>Against the declaration</h4>
    <dl className="kv">
      <dt>Declared devices</dt><dd className="num">{T.serials.length}</dd>
      <dt>Reporting</dt><dd className="num">{reporting.length}</dd>
      <dt>Conforming</dt><dd className="num" style={{ color: 'var(--ok)' }}>{conforming.length}</dd>
      <dt>Drifting</dt><dd className="num" style={{ color: drifting.length ? 'var(--warn)' : 'inherit' }}>{drifting.length}</dd>
      <dt>Window</dt><dd className="num">{hm(T.startMs)}–{hm(T.endMs)}</dd>
      <dt>Expectation</dt><dd>{T.tt ? (T.tt.expect === 'charge' ? 'battery rising' : 'battery draining, off charge') : '—'}</dd>
    </dl>
    {drifting.length ? <>
      <hr /><h4>Drifting</h4>
      {drifting.map(c => <div className="list-item" key={c.serial} style={{ paddingLeft: 0, paddingRight: 0 }}>
        <span className="grow mono">{c.serial}</span><span className="num">{(c.delta > 0 ? '+' : '') + c.delta}%</span></div>)}
      <div className="help">These rows will not be stamped with the declared test type — they fall through to Unclassified.</div>
    </> : null}
    <div className="acts"><a className="btn" href="#/nx/plan">Open Cycle plan</a></div>
  </>
}
