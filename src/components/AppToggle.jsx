import React, { useEffect, useState } from 'react'
import { appCommand, appScheduleJobs, appBulk } from '../lib/data.js'
import { pollHostApp } from '../lib/fleet.js'
import { useKeepOnScreen } from './Primitives.jsx'

// Open / close Nugget (the device's role app) on one lab tablet, from Today's "Ads on screen" drop-down (the user,
// 30 Oct 2026). ▶ opens it when it isn't on screen, ■ closes it when it is. Asks first; the server allows lab devices
// only and logs every command (data/commands.jsonl); the MDM answers within ~20 s ("opened …", "closed …").
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
// the devices report the change within ~a minute: ask the host-app list again a few times rather than once at 3 s
// (30 Oct 2026: after Open on all the card still read 0 / 22 while the MDM already had 14 on screen)
const refreshSoon = () => [3e3, 30e3, 75e3].forEach(ms => setTimeout(() => pollHostApp(true), ms))

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
      refreshSoon()
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
  // the run itself is on the lab laptop (POST /api/app-bulk), so a reload, a closed drop-down or a second browser can't cut
  // it short or start it twice (4 Nov 2026); this polls its progress every 2 s while it runs, every 20 s otherwise
  const busy = !!prog?.running
  useEffect(() => {
    let live = true, t
    const tick = () => appBulk().then(j => { if (!live) return; if (j.ok && j.startedAt) setProg(j); t = setTimeout(tick, j.running ? 2e3 : 20e3) }).catch(() => { t = setTimeout(tick, 20e3) })
    tick(); return () => { live = false; clearTimeout(t) }
  }, [])
  const run = async e => {
    e.stopPropagation()
    if (!serials.length || !confirm(`${action === 'open' ? 'Open' : 'Close'} Nugget on all ${serials.length} devices? It runs on the lab laptop.`)) return
    const j = await appBulk({ action, serials, by: by() })
    if (j.ok || j.http === 409) setProg(j)
    if (!j.ok) { alert(j.error || `HTTP ${j.http}`); return }
    setLast({ action, at: Date.now() })
    // poll fast until it ends, then refresh the list
    const wait = async () => { const k = await appBulk(); if (k.ok) setProg(k); if (k.running) setTimeout(wait, 2e3); else refreshSoon() }
    setTimeout(wait, 2e3)
  }
  const label = busy ? `${prog.action === 'open' ? 'Opening' : 'Closing'} ${prog.done} / ${prog.total}…` : `${action === 'open' ? 'Open' : 'Close'} on all ▾`
  // the last run's result, for 10 min after it ended
  const result = prog && !busy && Date.now() - (prog.endedAt || 0) < 600e3 ? `${prog.action === 'open' ? 'Opened' : 'Closed'} ${prog.ok} of ${prog.total}${prog.failed.length ? ` · ${prog.failed.length} failed` : ''}` : null
  // when: now, at a time, or every day at a time (the user, 3 Nov 2026: "tomorrow the cycle starts again") — the timed
  // ones run on the lab laptop (server/appSchedule.mjs), on the devices listed now
  const [menu, setMenu] = useState(false)
  const menuBox = useKeepOnScreen(menu)
  const [sAct, setSAct] = useState(null)       // the scheduled action; defaults to the button's
  const [time, setTime] = useState('')
  const [daily, setDaily] = useState(false)
  const [jobs, setJobs] = useState([])
  useEffect(() => {
    let live = true
    const load = () => appScheduleJobs().then(j => { if (live && j.ok) setJobs(appJobs(j)) }).catch(() => {})
    load(); const t = setInterval(load, 30e3)
    return () => { live = false; clearInterval(t) }
  }, [])
  const act = sAct || action
  const nextAt = () => { if (!time) return null; const [h, m] = time.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime() }
  const schedule = async () => {
    const at = nextAt(); if (!at || !serials.length) return
    const what = `${act === 'open' ? 'Open' : 'Close'} Nugget on all ${serials.length} devices ${daily ? `every day at ${clock(at, true)}` : `at ${clock(at)}`}`
    if (!confirm(`${what}? It runs on the lab laptop${daily ? ', until you remove it' : ''}.`)) return
    const j = await appScheduleJobs({ action: act, at, daily, serials, by: by() })
    if (j.ok) { setJobs(appJobs(j)); setMenu(false); setTime('') } else alert(`Couldn't schedule: ${j.error || j.http}`)
  }
  const drop = async (job) => {
    if (!confirm(`Remove "${jobText(job)}"?`)) return
    const j = await appScheduleJobs({ remove: job.id }); if (j.ok) setJobs(appJobs(j))
  }
  return (
    <span className="app-all" onClick={e => e.stopPropagation()}>
      {result && <span className={`hint${prog.failed.length ? ' app-all-bad' : ''}`} title={prog.failed.join('\n') || undefined}>{result}</span>}
      {jobs.map(j => (
        <span key={j.id} className="app-job" title={`${j.serials.length} devices · set by ${j.by || '—'}${j.last ? ` · last: ${j.last.ok} of ${j.last.total} at ${new Date(j.last.at).toLocaleString()}${j.last.failed?.length ? ` · failed: ${j.last.failed.join(', ')}` : ''}` : ''}`}>
          {jobText(j)}<button type="button" aria-label={`Remove ${jobText(j)}`} onClick={() => drop(j)}>×</button></span>))}
      <span className="wlc-menu-wrap">
        <button type="button" className="btn btn-sm" disabled={busy || !serials.length} aria-expanded={menu} onClick={() => setMenu(m => !m)}
          title={`${action === 'open' ? 'Open' : 'Close'} Nugget on every device in this list — now, at a time, or every day`}>
          {busy && <span className="spin" style={{ width: 11, height: 11 }} />} {label}</button>
        {menu && (
          <span ref={menuBox} className="wlc-menu" role="menu">
            <button type="button" role="menuitem" onClick={e => { setMenu(false); run(e) }}>{action === 'open' ? 'Open' : 'Close'} now</button>
            <span className="wlc-end">
              <span className="wlc-end-state" role="group" aria-label="Action">
                {['open', 'close'].map(a => <button key={a} type="button" className={act === a ? 'is-on' : ''} aria-pressed={act === a} onClick={() => setSAct(a)}>{a === 'open' ? 'Open' : 'Close'}</button>)}</span>
              <label>at <input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} aria-label="Time" /></label>
              <span className="wlc-end-state" role="group" aria-label="How often">
                <button type="button" className={!daily ? 'is-on' : ''} aria-pressed={!daily} onClick={() => setDaily(false)}>Once</button>
                <button type="button" className={daily ? 'is-on' : ''} aria-pressed={daily} onClick={() => setDaily(true)}>Every day</button></span>
              <button type="button" className="btn btn-sm" disabled={!time} onClick={schedule}>Schedule</button>
            </span>
          </span>
        )}
      </span>
    </span>
  )
}

const clock = (t, timeOnly = false) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  + (!timeOnly && new Date(t).toDateString() !== new Date().toDateString() ? ' tomorrow' : '')
const jobText = j => `${j.action === 'open' ? 'Open' : 'Close'} ${j.daily ? `daily ${clock(j.at, true)}` : clock(j.at)}`
const appJobs = j => (j.jobs || []).filter(x => x.action === 'open' || x.action === 'close')
