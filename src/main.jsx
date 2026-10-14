import React from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './t7.css'

// The group every screen (and the shared cycle plan) is scoped to is read once, when the app
// loads (GROUP in lib/fleet.js). With a backend it is always the group the server sweeps: the
// swept cycles and the shared plan exist for that group only, and this app has no Settings
// screen to pick another. A stale value in localStorage (the v1 page at `/` saves "Test
// Cycles" on its first visit) would otherwise leave a browser on the old static import with
// an empty plan. Without a backend the stored value stays. Hence App is imported only after this.
async function adoptServerGroup() {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000)
    const r = await fetch('/api/status', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t)
    const g = r.ok ? (await r.json()).group : null
    if (g) localStorage.setItem('scopeGroup', g)
  } catch (e) { /* no backend, or storage blocked: keep what is there */ }
}

adoptServerGroup().then(() => import('./App.jsx')).then(({ default: App }) => {
  // Two boundaries: this one is the backstop for the shell, and App puts another around the
  // view area so one broken chart cannot take the navigation down with it.
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary title="The dashboard could not start">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
})
