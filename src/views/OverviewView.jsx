import React, { useEffect, useMemo, useSyncExternalStore } from 'react'
import { loadWindow, subscribeWindow, getWindow, buckets, temp, running, WINDOW_HOURS } from '../lib/window.js'
import { testType, ttSlot, resolveDay, STATUS, groupSerials, todayKey, dayKey, timeOn, loadDecls, loadRota } from '../lib/plan.js'
import { GROUP } from '../lib/fleet.js'
import { TEMP_WARN, TEMP_LIMIT } from '../lib/profile.js'
import { fmtDur, rt } from '../lib/cycles.js'
import { median, pctOf, signed, hoursAxis, ago, day, int, H, DAY } from '../lib/format.js'
import { online, status } from '../lib/device.js'
import { LineChart } from '../components/charts.jsx'

export default function OverviewView({ fleet }) {
  const { DEV, allCycles, opts } = fleet
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  useEffect(() => { loadWindow(DEV) }, [DEV])

  const now = Date.now(), key = todayKey()
  const T = useMemo(() => {
    const ran = allCycles.filter(c => dayKey(c.end) === key).length
    const r = resolveDay(key, { decls: loadDecls(GROUP), rota: loadRota(GROUP), ran, devices: DEV.length })
    const src = r.decl || r.rota || null
    return { ...r, tt: testType(r.testType), src, serials: groupSerials(src && src.group, DEV) }
  }, [DEV, allCycles, key])

  const run = useMemo(() => running(DEV, opts), [DEV, win.at2, opts])
  const onl = DEV.filter(online)
  const bat = DEV.filter(d => status(d).k === 'run')
  const chg = DEV.filter(d => online(d) && d.snap.charging)
  const nowB = onl.map(d => d.snap.battery_pct).filter(v => typeof v === 'number')
  const nowT = onl.map(d => d.snap.battery_temp_c).filter(v => typeof v === 'number' && v > 0)
  const c30 = allCycles.filter(c => c.start > now - 30 * DAY)
  const p30 = allCycles.filter(c => c.start <= now - 30 * DAY && c.start > now - 60 * DAY)
  const m30 = median(c30.map(rt)), delta = pctOf(m30, median(p30.map(rt)))
  const health = DEV.map(d => d.health?.health).filter(x => x != null)
  const hotNow = onl.filter(d => d.snap.battery_temp_c >= TEMP_LIMIT)
  const off = DEV.filter(d => d.snap && now - Date.parse(d.snap.last_seen_at) > 2 * DAY)
    .sort((a, b) => Date.parse(b.snap.last_seen_at) - Date.parse(a.snap.last_seen_at))
  const short = m30 ? DEV.filter(d => d.lastCycle && d.lastCycle.start > now - 14 * DAY && rt(d.lastCycle) < m30 * .9)
    .map(d => ({ d, pct: pctOf(rt(d.lastCycle), m30) })).sort((a, b) => a.pct - b.pct) : []

  const weeks = useMemo(() => {
    const out = []
    for (let w = 26; w >= 0; w--) {
      const b = now - w * 7 * DAY, c = allCycles.filter(x => x.start >= b - 7 * DAY && x.start < b)
      if (c.length >= 3) out.push({ x: b, y: median(c.map(rt)) / H, n: c.length })
    }
    return out
  }, [allCycles])

  const t0 = new Date(); t0.setHours(0, 0, 0, 0)
  const serials = DEV.map(d => d.serial)
  const battToday = useMemo(() => win.at ? buckets(serials, t0.getTime(), now, r => r.battery_pct, median) : [], [win.at2, DEV])
  const tempToday = useMemo(() => win.at ? buckets(serials, t0.getTime(), now, temp, median) : [], [win.at2, DEV])

  return (
    <div className="view-stack">
      <div className="view-head"><div><h1>Overview</h1>
        <div className="sub">{GROUP} · {DEV.length} devices · {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div></div></div>

      {T.tt ? (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="tt-chip" style={{ '--tt': `var(--series-${ttSlot(T.tt.id)})` }}>{T.tt.code}<span className="g">{STATUS[T.status].glyph}</span></span>
            <span style={{ fontWeight: 600 }}>{T.tt.name}</span>
            <span className="secondary">{STATUS[T.status].label.toLowerCase()} for today · {T.serials.length} devices{run ? ` · ${fmtDur(run.elapsedMs)} elapsed` : ''}</span>
            <span style={{ flex: 1 }} />
            <a className="btn btn-sm" href="#/nx/today">Open Today</a>
          </div>
        </div>
      ) : (
        <div className="banner">
          <span aria-hidden="true">●</span>
          <div>No test type declared for today — telemetry alone cannot say which test is running. <a className="link" href="#/nx/plan">Declare one on the Cycle plan</a>.</div>
        </div>
      )}

      <div className="card"><div className="stat-row">
        <Metric label="Devices online" value={`${onl.length} / ${DEV.length}`} delta={`${off.length} not seen for 2+ days`} />
        <Metric label="On battery" value={bat.length} delta={`${chg.length} charging`} />
        <Metric label="Fleet battery now" value={nowB.length ? median(nowB) + '%' : '—'} delta={`median of ${nowB.length} online`} />
        <Metric label="Fleet temperature now" color={nowT.length && median(nowT) >= TEMP_LIMIT ? 'var(--bad)' : nowT.length && median(nowT) >= TEMP_WARN ? 'var(--warn)' : null}
          value={nowT.length ? median(nowT).toFixed(1) + ' °C' : '—'} delta={hotNow.length ? `${hotNow.length} over ${TEMP_LIMIT} °C` : `all under ${TEMP_LIMIT} °C`} />
        <Metric label="Runtime to empty · 30d" value={m30 ? fmtDur(m30) : '—'} delta={delta != null && m30 ? `${signed(delta)} vs prior 30d` : ''} />
        <Metric label="Cycles counted · 30d" value={int(c30.length)} delta={`${int(allCycles.length)} all time`} />
        <Metric label="Fleet battery health" value={health.length ? median(health).toFixed(0) + '%' : '—'} delta={`${DEV.filter(d => d.health && d.health.health < 80).length} below 80%`} />
      </div></div>

      {!win.at ? (
        <div className="banner">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" /></svg>
          <div>{win.loading ? <><span className="spin" /> Reading the last {WINDOW_HOURS} h of history for {DEV.length} devices…</> : win.err ? `Could not read recent history: ${win.err}` : 'No recent history loaded yet.'}</div>
        </div>
      ) : (
        <div className="grid grid-2">
          <div className="card"><div className="card-head"><h2>Fleet battery today</h2><span className="secondary">median across devices</span></div>
            <div className="card-body"><LineChart pts={battToday} h={170} yMax={100} yFmt={v => v + '%'} xFmt={t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} area smooth
              tip={p => `<b>${p.y.toFixed(0)}%</b> median<br>${p.n} devices`} /></div></div>
          <div className="card"><div className="card-head"><h2>Fleet temperature today</h2><span className="secondary">median across devices</span></div>
            <div className="card-body"><LineChart pts={tempToday} h={170} yMax={60} yFmt={v => v.toFixed(0) + '°'} xFmt={t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} smooth
              refs={[{ v: TEMP_LIMIT, label: `${TEMP_LIMIT} °C limit` }, { v: TEMP_WARN, label: `${TEMP_WARN} °C` }]}
              tip={p => `<b>${p.y.toFixed(1)} °C</b> median<br>${p.n} devices`} /></div></div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
        <div className="card"><div className="card-head"><h2>Runtime to empty per week</h2><span className="secondary">median, projected from each cycle's drain</span></div>
          <div className="card-body"><LineChart pts={weeks} h={200} yMax={hoursAxis(Math.max(...weeks.map(w => w.y)))} yFmt={v => v + 'h'} xFmt={day} area
            tip={p => `<b>${fmtDur(p.y * H)}</b> to empty, median<br>week ending ${day(p.x)} · ${p.n} cycles`} /></div></div>
        <div className="card"><div className="card-head"><h2>Needs attention</h2><span className="secondary">{short.length + off.length + hotNow.length}</span></div>
          {hotNow.slice(0, 3).map(d => <div className="row-item" key={d.serial}><span className="pill pill-bad">Over {TEMP_LIMIT} °C</span><span className="grow mono">{d.serial}</span><span className="mono">{d.snap.battery_temp_c.toFixed(1)} °C</span></div>)}
          {short.slice(0, 3).map(({ d, pct }) => <div className="row-item" key={d.serial}><span className="pill pill-warn">Short runtime</span><span className="grow mono">{d.serial}</span><span className="mono">{pct.toFixed(0)}%</span></div>)}
          {off.slice(0, 3).map(d => <div className="row-item" key={d.serial}><span className="pill">Offline</span><span className="grow mono">{d.serial}</span><span className="secondary">{ago(Date.parse(d.snap.last_seen_at))}</span></div>)}
          {short.length + off.length + hotNow.length === 0 ? <div className="empty-note">Nothing needs attention.</div> : null}
        </div>
      </div>

      <div className="card"><div className="card-head"><h2>Bench</h2>
        <div className="legend">
          <span className="legend-item"><i className="legend-key-rect" style={{ background: 'color-mix(in srgb, var(--series-1) 45%, transparent)' }} />On battery</span>
          <span className="legend-item"><i className="legend-key-rect" style={{ background: 'color-mix(in srgb, var(--status-good) 45%, transparent)' }} />Charging</span>
          <span className="legend-item"><i className="legend-key-rect" style={{ background: 'color-mix(in srgb, var(--status-warning) 50%, transparent)' }} />Low</span>
          <span className="legend-item"><i className="legend-key-rect" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-strong)' }} />Off / offline</span>
        </div></div>
        <div className="card-body"><div className="bench">
          {DEV.map(d => { const s = status(d)
            return <a className={`cell s-${s.k}`} key={d.serial} title={`${d.serial} · ${s.label}`}>
              <span className="cell-fill" style={{ height: `${s.pct == null ? 0 : Math.max(3, s.pct)}%` }} />
              <span className="cell-id mono">{d.tag}</span><span className="cell-v num">{s.val}</span></a>
          })}
        </div></div></div>
    </div>
  )
}

const Metric = ({ label, value, delta, color }) => (
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
    <div className="stat-foot">{delta}</div>
  </div>
)
