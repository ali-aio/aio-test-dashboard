import React, { useMemo } from 'react'
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

      {!mine.length ? <EmptyNote>No finished cycles recorded for this device yet.</EmptyNote> : <>
        <div className="stat-row">
          <Stat label="Cycles" value={fmtInt(mine.length)} foot={`${tests.length} test type${tests.length === 1 ? '' : 's'}`} />
          <Stat label="Test days" value={fmtInt(days)} foot={`${fmtDate(mine[mine.length - 1].date)} → ${fmtDate(mine[0].date)}`} />
          <Stat label="Avg cycle time" value={fmtNum(k.avgDuration, 1)} unit="h" foot="per cycle" />
          <Stat label="Avg drain" value={fmtRate(k.avgDropPerHr)} foot="battery per hour" />
          <Stat label="Hottest cycle" value={fmtNum(peakRun?.maxTemp, 1)} unit="°C" foot={peakRun ? `${peakRun.testType} · ${fmtDate(peakRun.date)}` : 'no temperature'} />
        </div>

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
