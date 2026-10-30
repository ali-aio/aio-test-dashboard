import React, { useState } from 'react'
import { appCommand } from '../lib/data.js'
import { pollHostApp } from '../lib/fleet.js'

// Open / close Nugget (the device's role app) on one lab tablet, from Today's "Ads on screen" drop-down (the user,
// 30 Oct 2026). ▶ opens it when it isn't on screen, ■ closes it when it is. Asks first; the server allows lab devices
// only and logs every command (data/commands.jsonl); the MDM answers within ~20 s ("opened …", "closed …").
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }

export default function AppToggle({ serial, onScreen }) {
  const [state, setState] = useState(null) // null | 'busy' | { ok, text }
  const action = onScreen ? 'close' : 'open'
  const run = async e => {
    e.stopPropagation()
    if (!confirm(`${action === 'open' ? 'Open' : 'Close'} Nugget on ${serial}?`)) return
    setState('busy')
    try {
      const r = await appCommand(serial, action, by())
      const ok = r.ok && r.status !== 'failed' && r.status !== 'expired'
      setState({ ok, text: r.output || r.error || r.status || `HTTP ${r.http}` })
      setTimeout(() => pollHostApp(true), 3000) // the host-app list catches up within a minute; ask sooner
    } catch (err) { setState({ ok: false, text: err.message }) }
    setTimeout(() => setState(null), 15000)
  }
  const busy = state === 'busy', res = state && state !== 'busy' ? state : null
  const title = busy ? `Sending "${action}" to ${serial}…` : res ? `${res.ok ? 'Done' : 'Failed'}: ${res.text}` : `${action === 'open' ? 'Open' : 'Close'} Nugget on ${serial}`
  return (
    <button type="button" className={`app-btn${res ? (res.ok ? ' is-ok' : ' is-bad') : ''}`} disabled={busy} title={title} aria-label={title} onClick={run}>
      {busy ? <span className="spin" style={{ width: 11, height: 11 }} />
        : res ? (res.ok ? '✓' : '!')
        : onScreen
          ? <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.2" fill="currentColor" /></svg>
          : <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 1.8v8.4L10.2 6z" fill="currentColor" /></svg>}
    </button>
  )
}
