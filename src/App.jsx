import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, boot, startPolling, GROUP } from './lib/fleet.js'
import { loadWindow, subscribeWindow, getWindow, rowsFor, WINDOW_HOURS } from './lib/window.js'
import { adaptAll, CTX } from './lib/adapt.js'
import { loadDecls, loadRota, testType as ttById } from './lib/plan.js'
import { startPlanSync, subscribePlan, getPlanSync } from './lib/planSync.js'
import { EMPTY_FILTERS, filtersFor, filterCycles, distinct, reconcileSerials, batteryCycles } from './lib/t7cycles.js'
import { initThemeToggle } from './lib/theme.js'
import { fmtInt, fmtDateLong, fmtBC, fmtLifetime } from './lib/fmt.js'
import { ago } from './lib/format.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { HistoryStatus } from './components/historyStatus.js'
import { lifetimeOf, cyclesInRange } from './lib/device.js'
import { splitText } from './lib/splitCycles.js'
import { resolve, overlaps, isoDayRange, rangeLabel } from './lib/range.js'
import FilterBar, { FilterPills } from './components/FilterBar.jsx'
import T7Overview from './views/T7Overview.jsx'
import ComparisonView from './views/ComparisonView.jsx'
import ThermalView from './views/ThermalView.jsx'
import DevicesView from './views/DevicesView.jsx'
import DeviceView from './views/DeviceView.jsx'
import DeviceSearch from './components/DeviceSearch.jsx'
import ExportDialog from './components/ExportDialog.jsx'
import TodayView from './views/TodayView.jsx'
import CyclePlanView from './views/CyclePlanView.jsx'

CTX.group = GROUP

// T7-Dashboard's shell: a sticky header with the brand, the view tabs and the right-hand
// controls, then the filter bar and one centred column of cards. The four analysis tabs
// are T7's own views running on T7's cycle shape — src/lib/adapt.js builds that shape from
// the MDM instead of from an imported CSV. Today and Cycle plan are this repo's own.
const VIEWS = [
  { id: 'overview', hash: '#/nx', label: 'Overview' },
  { id: 'today', hash: '#/nx/today', label: 'Today' },
  { id: 'plan', hash: '#/nx/plan', label: 'Cycle plan' },
  { id: 'comparison', hash: '#/nx/comparison', label: 'Comparison' },
  { id: 'thermal', hash: '#/nx/thermal', label: 'Thermal' },
  { id: 'summary', hash: '#/nx/summary', label: 'Summary' },
]
const ROUTE = h => h.startsWith('#/nx/device/') ? 'device'
  : h.startsWith('#/nx/comparison') ? 'comparison'
  : h.startsWith('#/nx/thermal') ? 'thermal'
  : h.startsWith('#/nx/summary') ? 'summary'
  : h.startsWith('#/nx/today') ? 'today'
  : h.startsWith('#/nx/plan') ? 'plan'
  : 'overview' // v2 only now: any other address opens the Overview

function useHash() {
  const [h, setH] = useState(() => location.hash || '#/nx')
  useEffect(() => {
    const on = () => setH(location.hash || '#/nx')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return h
}

export default function App() {
  const fleet = useSyncExternalStore(subscribe, getSnapshot)
  const win = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const hash = useHash()
  const view = ROUTE(hash)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [exporting, setExporting] = useState(false) // the Export CSV dialog

  useEffect(() => { boot(); return startPolling() }, [])
  // the Cycle plan is shared through the backend (data/plan.json); without it, per browser
  const planSync = useSyncExternalStore(subscribePlan, getPlanSync, getPlanSync)
  useEffect(() => (fleet.backend ? startPlanSync(GROUP) : undefined), [fleet.backend])
  useEffect(() => { if (fleet.DEV.length) loadWindow(fleet.DEV) }, [fleet.DEV])

  const { DEV, ready, error } = fleet
  // Cycles in T7's shape. The curve on each one comes from the history window, so cycles
  // older than it carry their summary but no per-hour series — the charts say so.
  const cycles = useMemo(() => (DEV.length ? adaptAll(DEV, rowsFor, fleet.readings, fleet.curves) : []),
    [DEV, fleet.allCycles, win.at2, fleet.readings, fleet.curves, planSync.v])
  const allSerials = useMemo(() => distinct(cycles, 'serial'), [cycles])
  // The Test Date range applies first (a run is in if any part of it falls inside); the
  // rest of the bar then cascades within it. A preset like "Last 24h" is re-evaluated
  // each render, so it keeps moving with the clock.
  const range = resolve(filters.range)
  const inRange = useMemo(() => (range ? cycles.filter((c) => overlaps(c, range)) : cycles), [cycles, range?.from, range?.to])
  const scoped = useMemo(() => filterCycles(inRange, filters), [inRange, filters])

  // The device filter is an explicit selection, so it starts as "everything" the first
  // time cycles appear — an empty list means "none picked", which would show nothing.
  // After that it is tended rather than reset: devices that vanish drop out, new ones join
  // only if the selection already covered everything, and a deliberate subset is left alone.
  const prevSerials = useRef([])
  const seeded = useRef(false)
  useEffect(() => {
    if (!cycles.length) { prevSerials.current = []; return }
    // Capture the previous list NOW: the updater below runs later, during render, by which
    // time prevSerials.current has been overwritten with the new list — and "19 selected out
    // of 24 previously available" reads as a deliberate subset, stranding the 5 new devices.
    const prev = prevSerials.current
    if (!seeded.current) { seeded.current = true; setFilters(filtersFor(allSerials)) }
    else setFilters(f => ({ ...f, serials: reconcileSerials(f.serials, allSerials, prev) }))
    prevSerials.current = allSerials
  }, [cycles.length, allSerials.join(',')])

  const latestDate = useMemo(() => { const d = distinct(cycles, 'date'); return d.length ? d[d.length - 1] : null }, [cycles])
  const resetFilters = () => setFilters(filtersFor(allSerials))
  const applyFilter = patch => setFilters(f => (patch.date ? { ...f, ...patch, date: '', range: isoDayRange(patch.date) } : { ...f, ...patch }))
  const openTestType = tt => { setFilters(f => ({ ...f, testType: tt })); location.hash = '#/nx' }
  // Summary -> one device's test: that test's full page with only this device selected
  const openDeviceTest = (sn, tt) => { setFilters(f => ({ ...f, serials: [sn], testType: tt })); location.hash = '#/nx'; window.scrollTo(0, 0) }

  // Test types declared on the Cycle plan — single days and the weekly rota. Re-read on
  // every render (two small localStorage reads), so a declaration made on the Cycle plan
  // tab is in the Overview's list the moment you switch back.
  const declaredTypes = [...new Set([
    ...loadDecls(GROUP).map(d => ttById(d.testType)?.name),
    ...Object.values(loadRota(GROUP)).map(r => ttById(r?.testType)?.name),
  ].filter(Boolean))]
  // The MDM's battery cycles for the devices ticked in the Serial filter: lifetime, or with
  // a Test Date range set, the cycles inside it (counter where recorded, else the battery
  // readings — src/lib/device.js). Test type and firmware cannot narrow it.
  const lifetime = useMemo(() => (range
    ? { ...cyclesInRange(filters.serials || [], range, { readings: fleet.readings, rowsFor, curves: fleet.curves }), range: rangeLabel(filters.range) }
    : lifetimeOf(filters.serials || [], sn => fleet.DMAP.get(sn)?.snap)),
  [filters.serials, DEV, range?.from, range && Math.floor(range.to / 60e3), fleet.readings, fleet.curves, win.at2])
  const analysis = ['overview', 'comparison', 'thermal', 'summary'].includes(view)
  const body = error ? <ErrorPanel error={error} />
    : !ready ? <div className="empty-note">Loading the fleet from the MDM…</div>
    : view === 'device' ? (() => { const sn = decodeURIComponent(hash.slice('#/nx/device/'.length)); return <DeviceView key={sn} serial={sn} d={fleet.DMAP.get(sn)} cycles={cycles} onOpenTest={openDeviceTest} /> })()
    : view === 'today' ? <TodayView fleet={fleet} />
    : view === 'plan' ? <CyclePlanView fleet={fleet} />
    : (
      <div className="view-stack">
        <FilterBar cycles={inRange} allCycles={cycles} filters={filters} onChange={setFilters} onReset={resetFilters} allSerials={allSerials} declaredTypes={declaredTypes} />
        <FilterPills filters={filters} onChange={setFilters} onReset={resetFilters} count={splitText(scoped)} allSerials={allSerials} />
        {fleet.seed && !fleet.seed.ok && (
          <div className="banner banner-warn"><span aria-hidden="true">◆</span>
            <div><strong>Only the sweep's cycles are loaded — most of the history is missing.</strong>
              <div>{fleet.seed.why}. Every count, average and date here covers the last couple of weeks
                rather than the full campaign. Scope group: <span className="mono">{GROUP}</span>.</div></div></div>
        )}
        {!fleet.backend && (
          <div className="banner banner-warn"><span aria-hidden="true">◆</span>
            <div><strong>Not using the backend.</strong>
              <div>This page is talking to the MDM directly instead of through the proxy, so there is no
                shared cache and no server sweep. A stale bundle is the usual cause — reload with Ctrl+Shift+R.</div></div></div>
        )}
        {/* Only on a browser's first visit: afterwards the charts draw from the stored copy
            (src/lib/window.js) and the top-up for new readings runs quietly behind them. */}
        {win.loading && !Object.keys(win.rows || {}).length && <div className="banner"><span aria-hidden="true">●</span>
          <div><span className="spin" /> Reading {Math.round(WINDOW_HOURS / 24)} days of history for {DEV.length} devices — the curve charts fill in as it lands.</div></div>}
        <ErrorBoundary resetKey={`${view}|${JSON.stringify(filters)}`} onReset={resetFilters}>
          {view === 'overview' && <T7Overview cycles={scoped} onPickTestType={openTestType} onFilter={applyFilter} onOpenDevice={openDeviceTest} testType={filters.testType} allSerials={allSerials} lifetime={lifetime} />}
          {view === 'comparison' && <ComparisonView cycles={scoped} testType={filters.testType} allSerials={allSerials} />}
          {view === 'thermal' && <ThermalView cycles={scoped} allSerials={allSerials} onFilter={applyFilter} />}
          {view === 'summary' && <DevicesView cycles={scoped} allSerials={allSerials} events={[]} onEventsChanged={() => {}} onFilter={applyFilter} onOpenTest={openDeviceTest} issues={[]} files={[]} snapOf={sn => fleet.DMAP.get(sn)?.snap} />}
        </ErrorBoundary>
      </div>
    )

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span><span className="brand-accent">AIO</span> T7</span>
          <span className="brand-sub">Cycle Dashboard</span>
        </div>
        {(
          <nav className="tabs" role="tablist" aria-label="Dashboard views">
            {VIEWS.map(v => (
              <button key={v.id} role="tab" className="tab" aria-selected={view === v.id}
                onClick={() => { location.hash = v.hash }}>{v.label}</button>
            ))}
          </nav>
        )}
        <div className="header-spacer" />
        {ready && <DeviceSearch devices={DEV} onOpen={sn => { location.hash = `#/nx/device/${encodeURIComponent(sn)}`; window.scrollTo(0, 0) }} />}
        {ready && <button type="button" className="btn btn-sm header-export" onClick={() => setExporting(true)} title="Download readings or cycles as CSV">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Export CSV</button>}
        {exporting && <ExportDialog devices={DEV} cycles={cycles} group={GROUP} onClose={() => setExporting(false)} />}
        <span className="hint nowrap" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`pill ${error ? 'pill-bad' : ready ? 'pill-ok pill-live' : ''}`}>{error ? 'Disconnected' : ready ? 'Live' : 'Connecting'}</span>
          {fleet.server?.lastSweepAt ? <span title={`The server checks the MDM for finished cycles every 30 minutes; last check ${new Date(fleet.server.lastSweepAt).toLocaleString()}. Live device readings update every 30 seconds regardless.`}>
            {fleet.server.sweeping ? 'checking for new cycles…' : `cycles checked ${ago(fleet.server.lastSweepAt)}`}</span> : null}
        </span>
        <ThemeButton />
      </header>
      <main className="app-main">
        <HistoryStatus.Provider value={{ loading: win.loading, at: win.at, err: win.err,
          days: Math.round(WINDOW_HOURS / 24), reload: () => loadWindow(DEV, true) }}>
          <ErrorBoundary title="This view could not be drawn">{body}</ErrorBoundary>
        </HistoryStatus.Provider>
      </main>
    </div>
  )
}

function ThemeButton() {
  const ref = React.useRef(null)
  useEffect(() => { initThemeToggle(ref.current) }, [])
  return <button className="btn btn-icon" ref={ref} />
}
const ErrorPanel = ({ error }) => (
  <div className="banner banner-bad"><span aria-hidden="true">●</span>
    <div><strong>{error}</strong>
      <div>The dashboard keeps showing the last snapshot it had. Check the backend with <span className="mono">/api/status</span>.</div></div></div>
)
