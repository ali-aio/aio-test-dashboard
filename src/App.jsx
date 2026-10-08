import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, boot, startPolling, GROUP } from './lib/fleet.js'
import { initThemeToggle } from './lib/theme.js'
import { online, status } from './lib/device.js'
import { TEMP_LIMIT } from './lib/profile.js'
import { ago, int } from './lib/format.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import OverviewView from './views/OverviewView.jsx'
import TodayView from './views/TodayView.jsx'
import CyclePlanView from './views/CyclePlanView.jsx'
import LegacyView from './views/LegacyView.jsx'

// The shell is T7-Dashboard's: a sticky header carrying the brand, the view tabs and the
// right-hand controls, then one centred column of cards. No source list and no inspector —
// in T7 everything a selection would show lives in a card in the flow, which is why the
// views below fold what used to be inspector content into the page.
const VIEWS = [
  { id: 'nx-overview', hash: '#/nx', label: 'Overview' },
  { id: 'nx-today', hash: '#/nx/today', label: 'Today' },
  { id: 'nx-plan', hash: '#/nx/plan', label: 'Cycle plan' },
]

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
  const hash = useHash()
  const [ver, setVer] = useState(() => { try { return localStorage.getItem('ui:ver') === 'v1' ? 'v1' : 'v2' } catch (e) { return 'v2' } })

  useEffect(() => { boot(); return startPolling() }, [])
  useEffect(() => { try { localStorage.setItem('ui:ver', ver) } catch (e) {} }, [ver])

  const { DEV, allCycles, ready, error } = fleet
  const view = hash.startsWith('#/nx/today') ? 'nx-today'
    : hash.startsWith('#/nx/plan') ? 'nx-plan'
    : hash.startsWith('#/nx') ? 'nx-overview' : 'legacy'

  const on = DEV.filter(online).length
  const hot = DEV.filter(d => online(d) && d.snap.battery_temp_c >= TEMP_LIMIT).length

  const body = error ? <ErrorPanel error={error} />
    : !ready ? <div className="empty-note">Loading the fleet from the MDM…</div>
    : view === 'nx-today' ? <TodayView fleet={fleet} />
    : view === 'nx-plan' ? <CyclePlanView fleet={fleet} />
    : view === 'nx-overview' ? <OverviewView fleet={fleet} />
    : <LegacyView />

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span><span className="brand-accent">AIO</span> T7</span>
          <span className="brand-sub">test dashboard</span>
        </div>

        {ver === 'v2' && (
          <nav className="tabs" role="tablist" aria-label="Dashboard views">
            {VIEWS.map(v => (
              <button key={v.id} role="tab" className="tab" aria-selected={view === v.id}
                onClick={() => { location.hash = v.hash }}>{v.label}</button>
            ))}
          </nav>
        )}

        <div className="header-spacer" />

        {ready && (
          <span className="hint nowrap">
            {int(allCycles.length)} cycles · {DEV.length} devices · {on} online
            {hot ? <> · <span style={{ color: 'var(--status-critical)' }}>{hot} over {TEMP_LIMIT} °C</span></> : null}
          </span>
        )}
        <span className="hint nowrap" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`pill ${error ? 'pill-bad' : ready ? 'pill-ok pill-live' : ''}`}>{error ? 'Disconnected' : ready ? 'Live' : 'Connecting'}</span>
          {fleet.server?.lastSweepAt ? <>sweep {ago(fleet.server.lastSweepAt)}</> : null}
        </span>

        <span className="ver-pick">
          <select value={ver} aria-label="Dashboard version"
            onChange={e => { setVer(e.target.value); location.hash = e.target.value === 'v2' ? '#/nx' : '#/v1' }}>
            <option value="v1">v1</option><option value="v2">v2</option>
          </select>
        </span>
        <ThemeButton />
      </header>

      <main className="app-main">
        <ErrorBoundary title="This view could not be drawn">{body}</ErrorBoundary>
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
  <div className="banner banner-bad">
    <span aria-hidden="true">●</span>
    <div><strong>{error}</strong>
      <div>The dashboard keeps showing the last snapshot it had. Check the backend with <span className="mono">/api/status</span>.</div></div>
  </div>
)
