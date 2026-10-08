import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, boot, startPolling, GROUP } from './lib/fleet.js'
import { initThemeToggle } from './lib/theme.js'
import { online, status } from './lib/device.js'
import { TEMP_LIMIT } from './lib/profile.js'
import { ago } from './lib/format.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import OverviewView from './views/OverviewView.jsx'
import TodayView from './views/TodayView.jsx'
import CyclePlanView from './views/CyclePlanView.jsx'
import LegacyView from './views/LegacyView.jsx'

const SICON = d => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" dangerouslySetInnerHTML={{ __html: d }} />

// v2 — the new dashboard. v1 is the previous one, still served by the vanilla page until
// its views are ported; the picker keeps both reachable.
const NXVIEWS = [
  ['nx-overview', '#/nx', 'Overview', '#f9674e', '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'],
  ['nx-today', '#/nx/today', 'Today', '#30b0c7', '<circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/>'],
  ['nx-plan', '#/nx/plan', 'Cycle plan', '#bf5af2', '<rect x="2" y="3.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>'],
]
const V1VIEWS = [
  ['v1-overview', 'Overview'], ['v1-devices', 'Devices'], ['v1-runs', 'Test cycles'],
  ['v1-health', 'Health'], ['v1-charging', 'Charging'], ['v1-thermal', 'Thermal'], ['v1-settings', 'Settings'],
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
  const [inspector, setInspector] = useState(null)
  const [noside, setNoside] = useState(() => { try { return localStorage.getItem('ui:noside') === '1' } catch (e) { return false } })
  const [noinsp, setNoinsp] = useState(() => { try { return localStorage.getItem('ui:noinsp') === '1' } catch (e) { return false } })

  useEffect(() => { boot(); return startPolling() }, [])
  useEffect(() => { try { localStorage.setItem('ui:ver', ver) } catch (e) {} }, [ver])
  useEffect(() => { try { localStorage.setItem('ui:noside', noside ? '1' : '0') } catch (e) {} }, [noside])
  useEffect(() => { try { localStorage.setItem('ui:noinsp', noinsp ? '1' : '0') } catch (e) {} }, [noinsp])

  const { DEV, ready, error } = fleet
  const route = hash.startsWith('#/nx/today') ? 'nx-today' : hash.startsWith('#/nx/plan') ? 'nx-plan' : hash.startsWith('#/nx') ? 'nx-overview' : 'legacy'

  const body = error ? <ErrorPanel error={error} />
    : !ready ? <Skeleton />
    : route === 'nx-today' ? <TodayView fleet={fleet} inspect={setInspector} />
    : route === 'nx-plan' ? <CyclePlanView fleet={fleet} inspect={setInspector} />
    : route === 'nx-overview' ? <OverviewView fleet={fleet} inspect={setInspector} />
    : <LegacyView />

  const on = DEV.filter(online).length
  const bat = DEV.filter(d => status(d).k === 'run').length
  const chg = DEV.filter(d => online(d) && d.snap.charging).length
  const hot = DEV.filter(d => online(d) && d.snap.battery_temp_c >= TEMP_LIMIT).length

  return (
    <div className={`app${noside ? ' noside' : ''}${noinsp ? ' noinsp' : ''}`}>
      <div className="body">
        <aside className="source">
          <div className="verbar">
            <span className="ver">
              <select value={ver} aria-label="Dashboard version" onChange={e => { setVer(e.target.value); location.hash = e.target.value === 'v2' ? '#/nx' : '#/v1' }}>
                <option value="v1">v1</option><option value="v2">v2</option>
              </select>
            </span>
            <span className="sp" />
            <ThemeButton />
          </div>
          <div>
            {ver === 'v2' ? <>
              <div className="sec">New dashboard</div>
              {NXVIEWS.map(([v, href, l, col, i]) => (
                <a key={v} className={`item ${route === v ? 'on' : ''}`} href={href}>
                  <span className="glyph" style={{ background: col }}>{SICON(i)}</span>
                  <span className="nm">{l}</span>
                </a>
              ))}
            </> : <>
              <div className="sec">Previous dashboard</div>
              {V1VIEWS.map(([v, l]) => <a key={v} className="item dim" href="#/v1"><span className="nm">{l}</span></a>)}
            </>}
          </div>
        </aside>
        <main className="pane" id="pane"><div className="content enter"><ErrorBoundary>{body}</ErrorBoundary></div></main>
        <aside className="insp">{inspector}</aside>
      </div>
      <footer className="status">
        <button className="tbtn" title="Show or hide the sidebar" onClick={() => setNoside(v => !v)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="3" width="13" height="10" rx="1.5" /><path d="M6 3v10" /></svg>
        </button>
        <span>{DEV.length ? <>{DEV.length} devices · {on} online · {bat} on battery · {chg} charging{hot ? <> · <span style={{ color: 'var(--bad)' }}>{hot} over {TEMP_LIMIT} °C</span></> : null}</> : null}</span>
        <span className="sp" />
        <span><b style={{ background: `var(--${error ? 'dot-bad' : ready ? 'dot-ok' : 'dot-off'})` }} />{error ? 'Disconnected' : ready ? 'Live' : 'Connecting'}</span>
        {fleet.server?.lastSweepAt ? <span>· sweep {ago(fleet.server.lastSweepAt)}</span> : null}
        <ThemeButton />
        <button className="tbtn" title="Show or hide the inspector" onClick={() => setNoinsp(v => !v)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="3" width="13" height="10" rx="1.5" /><path d="M10 3v10" /></svg>
        </button>
      </footer>
    </div>
  )
}

function ThemeButton() {
  const ref = React.useRef(null)
  useEffect(() => { initThemeToggle(ref.current) }, [])
  return <button className="tbtn" ref={ref} />
}

const Skeleton = () => (
  <div className="stack">
    <div className="page-head"><div className="skel" style={{ width: 180, height: 22 }} /></div>
    <div className="panel"><div className="panel-body"><div className="skel" style={{ height: 70 }} /></div></div>
    <div className="panel"><div className="panel-body"><div className="skel" style={{ height: 200 }} /></div></div>
  </div>
)
const ErrorPanel = ({ error }) => (
  <div className="stack">
    <div className="callout err">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 5v4M8 11h.01" /></svg>
      <div><b>{error}</b><div style={{ marginTop: 4 }}>The dashboard keeps showing the last snapshot it had. Check the backend with <span className="mono">/api/status</span>.</div></div>
    </div>
  </div>
)
