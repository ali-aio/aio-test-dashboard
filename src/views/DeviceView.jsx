import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { subscribeWindow, getWindow, rowsFor, currentCycleStart } from '../lib/window.js'
import { fetchHistoryRange } from '../lib/data.js'
import { normalize } from '../lib/cycles.js'
import { MultiLineChart, tooltipHtml } from '../components/charts.jsx'
import { Card, Stat, EmptyNote } from '../components/Primitives.jsx'
import { LineChart } from '../components/t7charts.jsx'
import { SortTable } from '../components/SortTable.jsx'
import { kpis, avgCurveBy, maxOf, plottedMaxHour } from '../lib/t7cycles.js'
import { buildStyleMap } from '../lib/palette.js'
import { status, online, lifetimeCycles } from '../lib/device.js'
import { ago } from '../lib/format.js'
import { fmtLifetime, fmtInt, fmtNum, fmtPct, fmtTemp, fmtHours, fmtRate, fmtDate, fmtHourTick, runsText, DASH } from '../lib/fmt.js'

// One device's whole history, opened from the header search (#/nx/device/<serial>):
// how it is right now, what it has run (every test, every run, newest first) and its
// battery curve per test. Filters don't apply here — this page is "everything for it".
export default function DeviceView({ serial, d, cycles, onOpenTest }) {
  const mine = useMemo(() => cycles.filter((c) => c.serial === serial).sort((a, b) => b.start - a.start), [cycles, serial])
  const k = useMemo(() => kpis(mine), [mine])
  const tests = useMemo(() => {
    const m = new Map()
    for (const c of mine) { if (!m.has(c.testType)) m.set(c.testType, []); m.get(c.testType).push(c) }
    return [...m.entries()].map(([tt, list]) => ({ tt, list, k: kpis(list), peak: maxOf(list.map((c) => c.maxTemp)), last: list[0]?.date }))
      .sort((a, b) => b.list.length - a.list.length)
  }, [mine])
  const curves = useMemo(() => {
    const styles = buildStyleMap(tests.map((t) => t.tt))
    return avgCurveBy(mine, 'testType').map((g) => ({ id: g.label, label: g.label, sub: runsText(g.count), ...(styles.get(g.label) || {}), points: g.points }))
  }, [mine, tests])
  const days = new Set(mine.map((c) => c.date)).size
  const peakRun = mine.reduce((a, c) => (c.maxTemp != null && (!a || c.maxTemp > a.maxTemp) ? c : a), null)

  if (!d) return <EmptyNote>No device {serial} in this group.</EmptyNote>
  const s = d.snap, st = status(d), on = online(d)
  const cyclesCell = (c) => (c.mdmCycles != null ? c.mdmCycles.toFixed(2)
    : c.startBattery != null && c.endBattery != null && c.startBattery > c.endBattery ? `≈ ${((c.startBattery - c.endBattery) / 100).toFixed(2)}` : DASH)

  return (
    <div className="view-stack">
      <div className="card">
        <div className="card-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div className="secondary" style={{ fontSize: 11.5, letterSpacing: '.06em', fontWeight: 600 }}>DEVICE</div>
            <h1 className="mono" style={{ margin: '4px 0 6px', fontSize: 26 }}>{serial}</h1>
            <div className="secondary" style={{ fontSize: 12.5 }}>
              <span className={`pill ${on ? 'pill-ok' : ''}`} style={{ marginRight: 8 }}>{st.label}</span>
              {s?.last_seen_at ? `last seen ${ago(Date.parse(s.last_seen_at))}` : 'never seen'}
              {s?.groups?.length ? ` · ${s.groups.join(', ')}` : ''}
            </div>
          </div>
          <div className="dev-now">
            <div><span>Battery</span><b>{s?.battery_pct != null ? `${s.battery_pct}%` : DASH}</b></div>
            <div><span>Temp</span><b>{on && s?.battery_temp_c ? `${s.battery_temp_c.toFixed(1)} °C` : DASH}</b></div>
            <div><span>{s?.charging ? 'Charging' : 'On battery'}</span><b>{s?.charging ? (s.charging_pad ? 'pad' : 'cable') : '—'}</b></div>
            <div><span>Lifetime cycles (MDM)</span><b>{fmtLifetime(lifetimeCycles(s))}</b></div>
          </div>
        </div>
      </div>

      {!mine.length ? <><LiveChart serial={serial} d={d} /><EmptyNote>No finished cycles recorded for this device yet.</EmptyNote></> : <>
        <div className="stat-row">
          <Stat label="Cycles" value={fmtInt(mine.length)} foot={`${tests.length} test type${tests.length === 1 ? '' : 's'}`} />
          <Stat label="Test days" value={fmtInt(days)} foot={`${fmtDate(mine[mine.length - 1].date)} → ${fmtDate(mine[0].date)}`} />
          <Stat label="Avg cycle time" value={fmtNum(k.avgDuration, 1)} unit="h" foot="per cycle" />
          <Stat label="Avg drain" value={fmtRate(k.avgDropPerHr)} foot="battery per hour" />
          <Stat label="Hottest cycle" value={fmtNum(peakRun?.maxTemp, 1)} unit="°C" foot={peakRun ? `${peakRun.testType} · ${fmtDate(peakRun.date)}` : 'no temperature'} />
        </div>

        <LiveChart serial={serial} d={d} />

        <Card expandable title="Battery over a cycle, by test" sub="This device’s mean battery at each whole hour, one line per test type">
          <LineChart series={curves} xDomain={[0, Math.ceil(plottedMaxHour(mine))]} yDomain={[0, 100]}
            formatX={fmtHourTick} formatY={(v) => `${v}%`} xLabel="elapsed time" xUnit="h" height={260}
            caption={`Battery per hour for ${serial}, by test type`} />
        </Card>

        <Card title="Tests it has run" sub="Click a test to open it for this device — curves, drain by hour and its cycles">
          <div className="table-wrap">
            <SortTable caption={`Tests ${serial} has run`} head={[
              { label: 'Test', style: { textAlign: 'left' } }, { label: 'Cycles' }, { label: 'Avg cycle time' },
              { label: 'Avg drain' }, { label: 'Avg peak temp' }, { label: 'Hottest' }, { label: 'Last cycle' },
            ]}>
              {tests.map((t) => (
                <tr key={t.tt} className="row-link" onClick={() => onOpenTest(serial, t.tt)}>
                  <td style={{ textAlign: 'left' }}><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); onOpenTest(serial, t.tt) }}>{t.tt} ›</button></td>
                  <td>{fmtInt(t.list.length)}</td>
                  <td>{fmtHours(t.k.avgDuration)}</td>
                  <td>{fmtRate(t.k.avgDropPerHr)}</td>
                  <td>{fmtTemp(t.k.avgPeakTemp)}</td>
                  <td>{fmtTemp(t.peak)}</td>
                  <td>{t.last ? fmtDate(t.last) : DASH}</td>
                </tr>
              ))}
            </SortTable>
          </div>
        </Card>

        <Card expandable title={`Every cycle on ${serial}`} sub={`${runsText(mine.length)} on ${fmtInt(days)} days · newest first · click a heading to sort · ≈ = from the cycle’s battery drop, before the MDM counter was recorded`}>
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <SortTable caption={`Every cycle on ${serial}`} head={[
              { label: 'Date' }, { label: 'Started' }, { label: 'Test', style: { textAlign: 'left' } }, { label: 'Cycle time' },
              { label: 'Start' }, { label: 'End' }, { label: 'Drain' }, { label: 'Peak temp' }, { label: 'Battery cycles' },
              { label: 'Firmware', style: { textAlign: 'left' } }, { label: 'Wireless pad', style: { textAlign: 'left' } },
            ]}>
              {mine.map((c) => (
                <tr key={c.id}>
                  <td>{c.date ? fmtDate(c.date) : DASH}</td>
                  <td>{new Date(c.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={{ textAlign: 'left' }}>{c.testType}</td>
                  <td>{fmtHours(c.duration)}</td>
                  <td>{fmtPct(c.startBattery)}</td>
                  <td>{fmtPct(c.endBattery)}</td>
                  <td>{fmtRate(c.dropPerHr)}</td>
                  <td>{fmtTemp(c.maxTemp)}</td>
                  <td>{cyclesCell(c)}</td>
                  <td style={{ textAlign: 'left' }}>{c.firmware ?? DASH}</td>
                  <td style={{ textAlign: 'left' }}>{c.padState ?? DASH}</td>
                </tr>
              ))}
            </SortTable>
          </div>
        </Card>
      </>}
    </div>
  )
}

// The device's readings against the clock, like the MDM's device graph: battery % and
// temperature. Opens on the cycle it is running now (from when it came off the charger);
// or last 6 h / 24 h / 7 days, or a custom span. The last 7 days come from the stored
// 5-minute window (window.js) and update as it does, plus the latest live check-in; older
// or longer spans are fetched from the MDM history for this device only.
const SPANS = [{ id: 'cycle', label: 'Current cycle' }, { id: '6h', label: 'Last 6 h', ms: 6 * 3600e3 },
  { id: '24h', label: 'Last 24 h', ms: 86400e3 }, { id: '7d', label: 'Last 7 days', ms: 7 * 86400e3 }, { id: 'custom', label: 'Custom' }]
const toInput = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 16)
const tempOf = (r) => { const t = r.extra?.battery_temp_c; return typeof t === 'number' && t > 0 ? t : null }

function LiveChart({ serial, d }) {
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const [span, setSpan] = useState(null)              // null until the cycle start is known
  const [custom, setCustom] = useState(() => ({ from: toInput(Date.now() - 2 * 86400e3), to: toInput(Date.now()) }))
  const [applied, setApplied] = useState(null)        // the custom span in effect
  const [pickerOpen, setPickerOpen] = useState(false)  // From / To panel under the Custom button
  const [fetched, setFetched] = useState({ key: null, rows: null, loading: false, err: null })

  const winRows = rowsFor(serial)
  const start = useMemo(() => currentCycleStart(winRows), [winRows, win.at2])
  useEffect(() => { if (span == null && win.at) setSpan(start ? 'cycle' : '24h') }, [start, win.at, span])

  const now = Date.now()
  const range = span === 'cycle' ? (start ? { from: start.t - 15 * 60e3, to: now } : null)
    : span === 'custom' ? applied
    : span ? { from: now - SPANS.find((x) => x.id === span).ms, to: now } : null
  // the preset spans all sit inside the stored 7-day window; only a custom span that reaches
  // further back is fetched (and only once per span — presets never fetch, so no loop)
  const windowStart = winRows.length ? Date.parse(winRows[0].timestamp) : now - 7 * 86400e3
  const fromWindow = !!range && (span !== 'custom' || range.from >= windowStart - 10 * 60e3)

  // older or longer spans: one fetch of this device's history at a spacing that keeps it small
  useEffect(() => {
    if (!range || fromWindow) return
    const key = `${range.from}-${range.to}`
    if (fetched.key === key) return
    const len = range.to - range.from, iv = len <= 2 * 86400e3 ? 300 : len <= 14 * 86400e3 ? 900 : 3600
    setFetched({ key, rows: null, loading: true, err: null })
    fetchHistoryRange(serial, range.from, range.to, iv)
      .then((rows) => setFetched({ key, rows: normalize(rows), loading: false, err: null }))
      .catch((e) => setFetched({ key, rows: [], loading: false, err: e.message }))
  }, [range?.from, range?.to, fromWindow, serial])

  let rows = range ? (fromWindow ? winRows : fetched.rows || []) : []
  rows = rows.filter((r) => { const t = Date.parse(r.timestamp); return t >= range.from && t <= range.to })
  // the latest live check-in (every 30 s), so "now" is really now between window refreshes
  const s = d?.snap
  if (range && s?.last_seen_at && (!rows.length || Date.parse(s.last_seen_at) > Date.parse(rows[rows.length - 1].timestamp)) && Date.parse(s.last_seen_at) <= range.to + 60e3)
    rows = [...rows, { timestamp: s.last_seen_at, battery_pct: s.battery_pct, extra: { battery_temp_c: s.battery_temp_c, charging: s.charging } }]
  const batt = rows.filter((r) => r.battery_pct != null).map((r) => ({ x: Date.parse(r.timestamp), y: r.battery_pct }))
  const temp = rows.map((r) => ({ x: Date.parse(r.timestamp), y: tempOf(r) })).filter((p) => p.y != null)
  const long = range && range.to - range.from > 36 * 3600e3
  const xFmt = (t) => new Date(t).toLocaleString([], long ? { month: 'short', day: 'numeric', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
  const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const tip = (t, hits) => tooltipHtml(when(t), hits.filter((h) => h.p).map(({ s: se, p }) => ({ color: se.color, name: se.label, value: se.axis === 'right' ? `${p.y.toFixed(1)} °C` : `${Math.round(p.y)}%` })))
  const tMax = Math.max(60, Math.ceil((temp.reduce((m, p) => Math.max(m, p.y), 0) + 5) / 10) * 10)
  const lastB = batt[batt.length - 1], lastT = temp[temp.length - 1]
  const loading = !win.at || (range && !fromWindow && fetched.loading)

  const sub = !range ? (span === 'custom' ? 'pick a span and apply' : 'loading readings…')
    : span === 'cycle' ? `current cycle · off the charger ${when(start.t)} at ${start.pct}% · live`
    : `${when(range.from)} → ${span === 'custom' ? when(range.to) : 'now · live'}`

  return (
    <Card expandable title="Live readings" sub={sub}
      right={<div style={{ position: 'relative' }}>
        <div className="seg" role="group" aria-label="Time span">
        {SPANS.map((x) => (
          <button key={x.id} type="button" aria-pressed={span === x.id} disabled={x.id === 'cycle' && !start}
            title={x.id === 'cycle' && !start ? 'No cycle running right now — the device is charging or still full' : undefined}
            onClick={() => {
              setSpan(x.id)
              // Custom draws at once with the span in the boxes (last 2 days); Apply redraws
              if (x.id === 'custom' && !applied) setApplied({ from: Date.parse(custom.from), to: Date.parse(custom.to) })
              setPickerOpen(x.id === 'custom' ? (o) => (span === 'custom' ? !o : true) : false)
            }}>{x.label}</button>
        ))}
      </div>
        {span === 'custom' && pickerOpen && (
          <div className="popover popover-right span-picker" role="dialog" aria-label="Custom time span">
            <label className="filter-field"><span className="filter-label">From</span>
              <input className="control" type="datetime-local" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
            <label className="filter-field"><span className="filter-label">To</span>
              <input className="control" type="datetime-local" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
            <button className="btn btn-primary" disabled={!(Date.parse(custom.to) > Date.parse(custom.from))}
              onClick={() => { setApplied({ from: Date.parse(custom.from), to: Date.parse(custom.to) }); setPickerOpen(false) }}>Apply</button>
          </div>
        )}
      </div>}>
      {span !== 'cycle' && !start && win.at && <p className="hint" style={{ margin: '0 0 8px' }}>No cycle is running on this device right now (it is charging or still full), so this opens on the last 24 hours.</p>}
      {loading ? <div className="empty"><span className="spin" /> Loading readings…</div>
        : fetched.err && !fromWindow ? <div className="empty">Could not load readings: {fetched.err}</div>
        : !range ? <div className="empty">Pick a From and To above, then Apply.</div>
        : <>
          {/* one chart, two axes: battery % on the left, temperature °C on the right */}
          <div className="legend" style={{ margin: '0 0 8px' }}>
            <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--series-1)' }} />Battery %{lastB ? <span className="secondary">&nbsp;· {lastB.y}% now</span> : null}</span>
            <span className="legend-item"><i className="legend-key-line" style={{ background: 'var(--series-2)' }} />Battery temperature °C (right axis){lastT ? <span className="secondary">&nbsp;· {lastT.y.toFixed(1)} °C now</span> : null}</span>
          </div>
          <MultiLineChart h={280} yMax={100} yFmt={(v) => v + '%'} xFmt={xFmt} x0={range.from} x1={range.to} tip={tip}
            y2={{ min: 0, max: tMax, fmt: (v) => v.toFixed(0) + '°', color: 'var(--series-2)', leftColor: 'var(--series-1)' }}
            series={[{ id: 'b', label: 'Battery', pts: batt, color: 'var(--series-1)', width: 2.2 },
              { id: 't', label: 'Temperature', axis: 'right', pts: temp, color: 'var(--series-2)', width: 2 }]}
            empty="No readings in this span." />
        </>}
    </Card>
  )
}
