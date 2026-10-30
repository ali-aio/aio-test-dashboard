import React, { useState } from 'react'
import { appCommand } from '../lib/data.js'
import { pollHostApp } from '../lib/fleet.js'

// Open / close Nugget (the device's role app) on one lab tablet, from Today's "Ads on screen" drop-down (the user,
// 30 Oct 2026). ▶ opens it when it isn't on screen, ■ closes it when it is. Asks first; the server allows lab devices
// only and logs every command (data/commands.jsonl); the MDM answers within ~20 s ("opened …", "closed …").
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }

export default function AppToggle({ serial, onScreen: live }) {
  const [state, setState] = useState(null) // null | 'busy' | { ok:false, text } (a failure stays shown for a while)
  // after a command that worked, the icon flips at once (no ✓ — the user, 30 Oct 2026), until the host-app list
  // (polled each minute) says the same or 2 min pass
  const [flip, setFlip] = useState(null)   // { on, at }
  const onScreen = flip && Date.now() - flip.at < 120e3 && flip.on !== live ? flip.on : live
  const action = onScreen ? 'close' : 'open'
  const run = async e => {
    e.stopPropagation()
    if (!confirm(`${action === 'open' ? 'Open' : 'Close'} Nugget on ${serial}?`)) return
    setState('busy')
    try {
      const r = await appCommand(serial, action, by())
      const ok = r.ok && r.status !== 'failed' && r.status !== 'expired'
      if (ok) { setFlip({ on: action === 'open', at: Date.now() }); setState(null) }
      else { setState({ ok: false, text: r.output || r.error || r.status || `HTTP ${r.http}` }); setTimeout(() => setState(null), 15000) }
      setTimeout(() => pollHostApp(true), 3000) // the host-app list catches up within a minute; ask sooner
    } catch (err) { setState({ ok: false, text: err.message }); setTimeout(() => setState(null), 15000) }
  }
  const busy = state === 'busy', res = state && state !== 'busy' ? state : null
  const title = busy ? `Sending "${action}" to ${serial}…` : res ? `Failed: ${res.text}` : `${action === 'open' ? 'Open' : 'Close'} Nugget on ${serial}`
  return (
    <button type="button" className={`app-btn${res ? ' is-bad' : ''}`} disabled={busy} title={title} aria-label={title} onClick={run}>
      {busy ? <span className="spin" style={{ width: 11, height: 11 }} />
        : res ? '!'
        : onScreen
          ? <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.2" fill="currentColor" /></svg>
          : <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 1.8v8.4L10.2 6z" fill="currentColor" /></svg>}
    </button>
  )
}

// Open / close Nugget on every device in the list at once (the user, 30 Oct 2026): "Open on all", then — once sent —
// "Close on all", by whichever fits most devices (majority). Three commands at a time; shows
// progress, then how many worked (the failures on hover).
export function AppToggleAll({ serials, onScreenCount }) {
  const [last, setLast] = useState(null)       // the last bulk action sent: { action, at }
  const [prog, setProg] = useState(null)       // { done, total, failed: [] } while running and after
  // by the majority now (the user, 30 Oct 2026): most devices with the app open → Close on all, else Open on all;
  // for 2 min after a bulk command, its opposite (the MDM's list takes up to a minute to catch up)
  const fresh = last && Date.now() - last.at < 120e3
  const action = fresh ? (last.action === 'open' ? 'close' : 'open') : onScreenCount * 2 > serials.length ? 'close' : 'open'
  const busy = prog && prog.done < prog.total
  const run = async e => {
    e.stopPropagation()
    if (!serials.length || !confirm(`${action === 'open' ? 'Open' : 'Close'} Nugget on all ${serials.length} devices?`)) return
    const p = { done: 0, total: serials.length, failed: [] }; setProg({ ...p })
    const queue = [...serials], who = by()
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length) {
        const sn = queue.shift()
        try { const r = await appCommand(sn, action, who); if (!r.ok || r.status === 'failed' || r.status === 'expired') p.failed.push(`${sn}: ${r.output || r.error || r.status || r.http}`) }
        catch (err) { p.failed.push(`${sn}: ${err.message}`) }
        p.done++; setProg({ ...p })
      }
    }))
    setLast({ action, at: Date.now() }); setTimeout(() => pollHostApp(true), 3000)
  }
  const label = busy ? `${action === 'open' ? 'Opening' : 'Closing'} ${prog.done} / ${prog.total}…` : `${action === 'open' ? 'Open' : 'Close'} on all`
  const result = prog && !busy ? `${prog.total - prog.failed.length} of ${prog.total} done${prog.failed.length ? ` · ${prog.failed.length} failed` : ''}` : null
  return (
    <span className="app-all">
      {result && <span className={`hint${prog.failed.length ? ' app-all-bad' : ''}`} title={prog.failed.join('\n') || undefined}>{result}</span>}
      <button type="button" className="btn btn-sm" disabled={busy || !serials.length} onClick={run}
        title={`${action === 'open' ? 'Open' : 'Close'} Nugget on every device in this list`}>
        {busy && <span className="spin" style={{ width: 11, height: 11 }} />} {label}</button>
    </span>
  )
}
