import React from 'react'
import { createRoot } from 'react-dom/client'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './t7.css'

// The group every screen (and the shared cycle plan) is scoped to is read once, when the app
// loads (GROUP in lib/fleet.js). A browser that never picked one in Settings takes the group
// the server sweeps, so everyone opening the link sees the same plan and cycles, not an empty
// "Test Cycles" default. Hence App is imported only after this.
async function adoptServerGroup() {
  try { if (localStorage.getItem('scopeGroup')) return } catch (e) { return }
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000)
    const r = await fetch('/api/status', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t)
    const g = r.ok ? (await r.json()).group : null
    if (g) localStorage.setItem('scopeGroup', g)
  } catch (e) { /* no backend: keep the default */ }
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
