import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { loadWindow, subscribeWindow, getWindow, buckets, dayStats, conform, temp, runStartOf, drainSince, WINDOW_HOURS } from '../lib/window.js'
import { testType, ttSlot, resolveDay, STATUS, groupSerials, todayKey, dayKey, dayLong, dayLabel, timeOn, loadDecls, loadRota } from '../lib/plan.js'
import { TEMP_WARN, TEMP_LIMIT } from '../lib/profile.js'
import { fmtDur } from '../lib/cycles.js'
import { median, pctl, hm, dt, ago, MIN, H } from '../lib/format.js'
import { online, status } from '../lib/device.js'
import { GROUP } from '../lib/fleet.js'
import { MultiLineChart, Sparkline } from '../components/charts.jsx'
import { buildColorMap } from '../lib/palette.js'

const CSTATE = { conforming: ['pill-ok', 'Conforming'], drifting: ['pill-warn', 'Drifting'], silent: ['', 'Not reporting'], untyped: ['', 'No test declared'] }
const statusBadge = st => <span className={`pill ${{ declared: 'pill-run', confirmed: 'pill-ok', inferred: 'pill-warn', unclassified: '', none: '' }[st]}`}>{STATUS[st].label}</span>

export default function TodayView({ fleet }) {
  const { DEV, allCycles, opts } = fleet
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
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
  const conf = useMemo(() => T.serials.map(s => conform(s, T.tt, T.startMs, winTo)), [T, win.at2])
  const reporting = conf.filter(c => c.state !== 'silent')
  const conforming = conf.filter(c => c.state === 'conforming')
  const drifting = conf.filter(c => c.state === 'drifting')

  // Each device's own run: when it came off the charger and how fast it is draining. The
  // window opens when the plan says (07:00); the run starts when someone pulls the devices.
  const runs = useMemo(() => new Map(conf.filter(c => c.rows?.length).map(c => {
    const start = runStartOf(c.rows)
    return [c.serial, { start, rate: drainSince(c.rows, start), now: c.rows[c.rows.length - 1].battery_pct }]
  })), [conf])
  const all = [...runs.values()], started = all.filter(r => r.start)
  const runStart = started.length ? median(started.map(r => r.start.t)) : null
  const nows = all.map(r => r.now), medNow = nows.length ? median(nows) : null
  const rates = started.map(r => r.rate).filter(v => v != null && v > 0)
  const rate = rates.length ? median(rates) : null
  // The lab's daily run goes back on charge at 15–25%, so 20% is "the run is done".
  const END_BAND = 20
  const etaEnd = rate && medNow > END_BAND ? now + (medNow - END_BAND) / rate * H : null
  const etaEmpty = rate && medNow > 0 ? now + medNow / rate * H : null
  const when = t => (dayKey(t) === key ? hm(t) : dt(t))
  // Start the charts half an hour before the run so the drop-off is visible, not four
  // hours of a flat line at 100% while the devices sat on the charger.
  const chartFrom = runStart ? Math.max(T.startMs, runStart - 30 * MIN) : T.startMs

  const p50 = useMemo(() => buckets(T.serials, chartFrom, winTo, temp, median), [T, win.at2, chartFrom])
  const p95 = useMemo(() => buckets(T.serials, chartFrom, winTo, temp, a => pctl(a, .95)), [T, win.at2, chartFrom])

  // Which devices the two charts show. null = every device (the default); a Set narrows
  // both charts at once. Colours come from the full sorted list, so a device keeps its
  // colour whatever else is ticked — the same rule T7's own device picker follows.
  const [picked, setPicked] = useState(null)
  const sorted = useMemo(() => [...T.serials].sort(), [T.serials.join(',')])
  const colorOf = useMemo(() => buildColorMap(sorted), [sorted])
  const isOn = sn => picked == null || picked.has(sn)
  const toggle = sn => setPicked(p => {
    const n = new Set(p ?? sorted); n.has(sn) ? n.delete(sn) : n.add(sn)
    return n.size === sorted.length ? null : n
  })
  const shown = conf.filter(c => c.rows?.length && isOn(c.serial))
  const few = shown.length <= 4 // few enough to label every line by name

  const lastOf = c => c.rows[c.rows.length - 1].battery_pct
  const lo = shown.length ? shown.reduce((a, b) => lastOf(b) < lastOf(a) ? b : a) : null
  const hi = shown.length ? shown.reduce((a, b) => lastOf(b) > lastOf(a) ? b : a) : null
  const ptsOf = (c, pick = r => r.battery_pct) => c.rows.filter(r => Date.parse(r.timestamp) >= chartFrom && pick(r) != null)
    .map(r => ({ x: Date.parse(r.timestamp), y: pick(r) }))
  // The projection follows whatever is ticked: the median of the picked devices.
  const selRuns = shown.map(c => runs.get(c.serial)).filter(Boolean)
  const selNow = selRuns.length ? median(selRuns.map(r => r.now)) : null
  const selRates = selRuns.filter(r => r.start && r.rate > 0).map(r => r.rate)
  const selRate = selRates.length ? median(selRates) : null
  const selEmpty = selRate && selNow > 0 ? now + selNow / selRate * H : null
  const projTo = selRate && selNow != null && T.endMs > now ? Math.min(T.endMs, selEmpty || T.endMs) : null
  const projection = projTo ? [{ x: now, y: selNow }, { x: projTo, y: Math.max(0, selNow - selRate * (projTo - now) / H) }] : []
  const series = [
    ...shown.map(c => {
      const drift = c.state === 'drifting'
      return { id: c.serial, pts: ptsOf(c), color: colorOf.get(c.serial), width: drift ? 1.9 : 1.5, opacity: few ? 1 : .75,
        dash: drift ? '5 3' : undefined,
        endLabel: few ? `${c.serial.slice(-4)} ${lastOf(c)}%` : (c === lo || c === hi) ? `${lastOf(c)}%` : null }
    }),
    ...(projection.length ? [{ id: 'projected', pts: projection, color: 'var(--text-3)', width: 1.6, dash: '2 4', smooth: false, endLabel: `${Math.round(projection[1].y)}%`, labelColor: 'var(--text-3)' }] : []),
  ]
  // Temperature: the fleet's median and 95th percentile while every device is shown;
  // narrowed to a few, each device's own line in its own colour, so the hot one is visible.
  const tempSeries = picked == null
    ? [
        { id: 'p50', pts: p50, color: 'var(--tt-1)', width: 2, endLabel: p50.length ? `p50 ${p50[p50.length - 1].y.toFixed(0)}°` : null },
        { id: 'p95', pts: p95, color: 'var(--tt-2)', width: 2, dash: '5 3', endLabel: p95.length ? `p95 ${p95[p95.length - 1].y.toFixed(0)}°` : null },
      ]
    : shown.map(c => {
        const pts = ptsOf(c, temp), last = pts[pts.length - 1]
        return { id: c.serial, pts, color: colorOf.get(c.serial), width: 1.6,
          endLabel: last && (few || last.y >= TEMP_WARN) ? `${c.serial.slice(-4)} ${last.y.toFixed(0)}°` : null }
      })
  const picker = <DevicePicker serials={sorted} picked={picked} colorOf={colorOf} drifting={new Set(drifting.map(d => d.serial))}
    onToggle={toggle} onAll={() => setPicked(null)} onNone={() => setPicked(new Set())} />
  const noneTicked = picked != null && picked.size === 0
  const silent = T.serials.length - reporting.length

  return (
    <div className="view-stack">
      <div className="card" style={{ borderLeft: `3px solid ${T.tt ? `var(--tt-${ttSlot(T.tt.id)})` : 'var(--border-strong)'}` }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, letterSpacing: '.04em', color: 'var(--text-3)', fontWeight: 600 }}>
            {dayLong(key)} {statusBadge(T.status)}
            <span className={`pill ${reporting.length ? 'pill-run pill-live' : ''}`}>Live · {reporting.length} device{reporting.length === 1 ? '' : 's'} reporting</span>
          </div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 26, lineHeight: 1.15 }}>{T.tt ? T.tt.name : 'No test declared'}</h1>
          <div className="secondary" style={{ fontSize: 12.5 }}>
            {T.tt ? <>{T.source === 'rota' ? 'From the standing weekly rota' : <>Declared{T.src?.by ? <> by <b>{T.src.by}</b></> : null}{T.src?.at ? ` at ${hm(T.src.at)}` : ''}</>}
              {' '}· {T.serials.length} devices · window {hm(T.startMs)}–{hm(T.endMs)} · every MDM row from these serials today is stamped with this test type.</>
              : <>Telemetry cannot say which test this is — the MDM carries no test type. <a className="link" href="#/nx/plan">Declare one on the Cycle plan</a> and today's rows are stamped with it.</>}
          </div>
        </div>
      </div>

      <div className="stat-row">
        <Metric label="Run time"
          value={runStart ? <>{fmtDur(now - runStart)}<span className="secondary" style={{ fontSize: 13 }}> of ~{fmtDur(T.endMs - runStart)}</span></> : 'Not started'}
          delta={runStart ? `off charger ${hm(runStart)} · window opened ${hm(T.startMs)}`
            : `${started.length} of ${all.length} devices off charger · window ${hm(T.startMs)}–${hm(T.endMs)}`} />
        <Metric label="Battery now" value={medNow != null ? `${medNow}%` : '—'}
          delta={nows.length ? `median · range ${Math.min(...nows)}–${Math.max(...nows)}%` : 'no readings yet'} />
        <Metric label="Drain rate" value={rate ? <>{rate.toFixed(2)}<span className="secondary" style={{ fontSize: 13 }}> %/h</span></> : '—'}
          delta={rate ? `${(rate / 6).toFixed(2)}% per 10 min · median of ${rates.length}` : 'needs 20 min of running'} />
        <Metric label={`Reaches ${END_BAND}%`} value={etaEnd ? when(etaEnd) : medNow != null && medNow <= END_BAND ? 'Done' : '—'}
          delta={etaEnd ? `${fmtDur(etaEnd - now)} from now${etaEmpty ? ` · empty ≈ ${when(etaEmpty)}` : ''}` : medNow != null && medNow <= END_BAND ? 'median is in the end band' : 'at the current rate'} />
        <Metric label="Conforming to plan" color={T.tt && conforming.length === T.serials.length ? 'var(--ok)' : drifting.length ? 'var(--warn)' : null}
          value={<>{conforming.length}<span className="secondary" style={{ fontSize: 13 }}> / {T.serials.length}</span></>}
          delta={!T.tt ? 'nothing declared to match' : drifting.length || silent
            ? [drifting.length && `${drifting.length} drifting`, silent && `${silent} not reporting`].filter(Boolean).join(' · ')
            : 'every device matches the declared test'} />
      </div>

      {drifting.length > 0 && <Drifters drifting={drifting} tt={T.tt} />}

      {!win.at ? <Stale win={win} n={DEV.length} /> : <>
        <div className="card">
          <div className="card-head"><h2>T7 battery, today</h2><span className="secondary">from {hm(chartFrom)} · live from MDM · 5-minute rows</span></div>
          <div className="card-body">
            {picker}
            <div className="legend" style={{ margin: '8px 0 10px' }}>
              {drifting.length ? <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--status-warning)' }} />dashed = drifting</span> : null}
              {projection.length ? <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--text-3)' }} />Projected median{picked != null ? ' of the ticked devices' : ''}, at {selRate.toFixed(1)} %/h</span> : null}
              <span className="legend-item secondary">{few ? 'every line is labelled' : 'labels mark the lowest and highest'}</span>
            </div>
            {noneTicked ? <div className="empty">No devices ticked — pick some above, or choose Select all.</div> :
            <MultiLineChart series={series} h={230} yMax={100} yFmt={v => v + '%'} xFmt={hm} x0={chartFrom} x1={projTo || winTo}
              tip={(t, hits) => { const top = hits.filter(x => x.p).sort((a, b) => a.p.y - b.p.y).slice(0, 4)
                return `<b>${hm(t)}</b><br>${top.map(({ s, p }) => `${s.id.slice(-5)} ${p.y}%`).join('<br>')}${hits.length > 4 ? `<br><span style="opacity:.7">+${hits.length - 4} more</span>` : ''}` }} />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Battery temperature, today</h2><span className="secondary">{picked == null ? 'fleet median and 95th percentile' : `${shown.length} ticked device${shown.length === 1 ? '' : 's'}`} · °C</span></div>
          <div className="card-body">
            {picker}
            <div className="legend" style={{ margin: '8px 0 10px' }}>
              {picked == null ? <>
                <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--series-1)' }} />Median</span>
                <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--series-2)' }} />95th percentile</span>
              </> : <span className="legend-item secondary">one line per ticked device, colours as in the list</span>}
              <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--status-warning)' }} />{TEMP_LIMIT} °C review threshold</span>
            </div>
            {noneTicked ? <div className="empty">No devices ticked — pick some above, or choose Select all.</div> :
            <MultiLineChart h={230} yMax={60} yFmt={v => v.toFixed(0) + '°'} xFmt={hm} x0={chartFrom} x1={winTo}
              refs={[{ v: TEMP_LIMIT, label: `${TEMP_LIMIT} °C review threshold`, color: 'var(--warn)' }]}
              series={tempSeries}
              tip={(t, hits) => `<b>${hm(t)}</b><br>${hits.sort((a, b) => b.p.y - a.p.y).slice(0, 6).map(({ s, p }) => `${s.id.length > 4 ? s.id.slice(-5) : s.id} ${p.y.toFixed(1)} °C`).join('<br>')}`} />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Devices today</h2><span className="secondary">{reporting.length} reporting</span></div>
          <div className="scroll-x"><table className="data">
            <thead><tr><th>Device</th><th>Against plan</th><th className="r">Battery</th><th className="r">Off charger</th><th className="r">Drain</th><th className="r">Temp now</th><th className="r">Peak today</th><th className="r">≥{TEMP_LIMIT} °C</th><th className="r">Today</th></tr></thead>
            <tbody>
              {conf.slice().sort((a, b) => ((b.state === 'drifting') - (a.state === 'drifting')) || ((fleet.DMAP.get(a.serial)?.snap?.battery_pct ?? 999) - (fleet.DMAP.get(b.serial)?.snap?.battery_pct ?? 999))).map(c => {
                const r = runs.get(c.serial)
                const d = fleet.DMAP.get(c.serial); if (!d) return null
                const st = status(d), s = dayStats(c.serial, T.startMs), cs = CSTATE[c.state]
                return <tr key={c.serial}>
                  <td className="mono">{c.serial}</td>
                  <td><span className={`pill ${cs[0]}`}>{cs[1]}</span></td>
                  <td className="r">{st.pct != null ? <span className="batt num">{st.pct}%<span className={`bar ${st.pct < 20 ? 'warn' : st.k === 'ready' ? 'ok' : 'run'}`}><i style={{ width: `${st.pct}%` }} /></span></span> : <span className="secondary">—</span>}</td>
                  <td className="r mono">{r?.start ? hm(r.start.t) : <span className="secondary">still full</span>}</td>
                  <td className="r mono" style={{ color: c.state === 'drifting' ? 'var(--warn)' : 'inherit' }}>{r?.rate != null ? r.rate.toFixed(2) + ' %/h' : <span className="secondary">—</span>}</td>
                  <td className="r mono" style={{ color: online(d) && d.snap.battery_temp_c >= TEMP_LIMIT ? 'var(--bad)' : online(d) && d.snap.battery_temp_c >= TEMP_WARN ? 'var(--warn)' : 'inherit' }}>{online(d) && d.snap.battery_temp_c ? d.snap.battery_temp_c.toFixed(1) + ' °C' : <span className="secondary">—</span>}</td>
                  <td className="r mono" style={{ color: s?.maxTemp >= TEMP_LIMIT ? 'var(--bad)' : s?.maxTemp >= TEMP_WARN ? 'var(--warn)' : 'inherit' }}>{s?.maxTemp != null ? s.maxTemp.toFixed(1) + ' °C' : <span className="secondary">—</span>}</td>
                  <td className="r mono" style={{ color: s?.minAbove45 ? 'var(--bad)' : 'inherit' }}>{s?.minAbove45 ? fmtDur(s.minAbove45 * MIN) : <span className="secondary">—</span>}</td>
                  <td className="r">{s ? <Sparkline vals={s.battPts.map(p => p.y)} /> : <span className="secondary">—</span>}</td>
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
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
    <div className="stat-foot">{delta}</div>
  </div>
)
const Stale = ({ win, n }) => (
  <div className="banner">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" /></svg>
    <div>{win.loading ? <><span className="spin" /> Reading the last {WINDOW_HOURS} h of history for {n} devices…</> : win.err ? `Could not read recent history: ${win.err}` : 'No recent history loaded yet.'}</div>
  </div>
)
function DeviceDay({ d, from }) {
  const s = dayStats(d.serial, from), st = status(d)
  return <>
    <h3 className="mono">{d.serial}</h3>
    <div className="sub">{(d.snap?.device_class || 'device').toUpperCase()} · {st.label} · seen {ago(Date.parse(d.snap.last_seen_at))}</div>
    <div className="big num">{st.pct != null ? st.pct + '%' : '—'}<small>{online(d) && d.snap.battery_temp_c ? d.snap.battery_temp_c.toFixed(1) + ' °C now' : st.label.toLowerCase()}</small></div>
    {!s ? <div className="empty-note">No readings in this window.</div> : <>
      <hr /><h4>Today</h4>
      <dl className="kv">
        <dt>At window start</dt><dd className="mono">{s.startPct}%</dd>
        <dt>Drained</dt><dd className="mono">{s.drained.toFixed(0)}%</dd>
        <dt>Peak temperature</dt><dd className="mono" style={{ color: s.maxTemp >= TEMP_LIMIT ? 'var(--bad)' : s.maxTemp >= TEMP_WARN ? 'var(--warn)' : 'inherit' }}>{s.maxTemp != null ? s.maxTemp.toFixed(1) + ' °C' : '—'}</dd>
        <dt>Average temperature</dt><dd className="mono">{s.avgTemp != null ? s.avgTemp.toFixed(1) + ' °C' : '—'}</dd>
        <dt>Over {TEMP_LIMIT} °C</dt><dd className="mono" style={{ color: s.minAbove45 ? 'var(--bad)' : 'inherit' }}>{s.minAbove45 ? fmtDur(s.minAbove45 * MIN) : '—'}</dd>
        <dt>Samples</dt><dd className="mono">{s.n}</dd>
      </dl>
    </>}
  </>
}
function Drifters({ drifting, tt }) {
  return (
    <div className="card">
      <div className="card-head"><h3>Drifting</h3><span className="card-sub">{drifting.length} device{drifting.length === 1 ? '' : 's'}</span></div>
      {drifting.length ? <>
        {drifting.map(c => (
          <div className="row-item" key={c.serial}>
            <span className="grow mono">{c.serial}</span>
            <span className="mono" style={{ color: 'var(--status-warning)' }}>{(c.delta > 0 ? '+' : '') + c.delta}%</span>
          </div>
        ))}
        <div className="card-body"><div className="help">These rows will not be stamped with the declared test type — they fall through to Unclassified.</div></div>
      </> : <div className="empty">{tt ? 'Every reporting device matches the declared test.' : 'Nothing declared for today, so nothing can drift.'}</div>}
    </div>
  )
}

// T7's own device picker markup (chart-legend-details / series-legend), so it looks and
// behaves like the one on the Overview's single-test view. Drifting devices are marked.
function DevicePicker({ serials, picked, colorOf, drifting, onToggle, onAll, onNone }) {
  const n = picked == null ? serials.length : picked.size
  return (
    <details className="chart-legend-details">
      <summary>Devices ({n}/{serials.length})</summary>
      <div className="series-legend-actions">
        <button type="button" className="btn" onClick={onAll}>Select all</button>
        <button type="button" className="btn" onClick={onNone}>Clear all</button>
      </div>
      <div className="legend series-legend" role="group" aria-label="Devices to show on the charts">
        {serials.map(sn => (
          <label className="series-legend-item" key={sn}>
            <input type="checkbox" checked={picked == null || picked.has(sn)} onChange={() => onToggle(sn)} />
            <span className="legend-key-line" style={{ background: colorOf.get(sn) }} aria-hidden="true" />
            <span>{sn}{drifting.has(sn) ? <span className="secondary"> · drifting</span> : null}</span>
          </label>
        ))}
      </div>
    </details>
  )
}
