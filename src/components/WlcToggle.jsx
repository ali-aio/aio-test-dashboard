import React, { useEffect, useState } from 'react'
import { wlcCommand, wlcToggleJob, appScheduleJobs, wlcBatteryRules } from '../lib/data.js'
import { poll } from '../lib/fleet.js'
import { useKeepOnScreen } from './Primitives.jsx'

// Wireless charging on a lab T7's pad on / off, from Today's "WLC · load placed" drop-down (the user, 2 Nov 2026).
// The MDM answers at once ({serial, enabled, connected}); a tablet that isn't connected takes the setting when it
// reconnects. Asks first; the server allows lab devices only and logs every command (data/commands.jsonl).
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
// the next check-ins (every ~30 s – 3 min) carry the new state: ask the device list again a few times
const refreshSoon = () => [5e3, 35e3, 90e3].forEach(ms => setTimeout(() => poll(), ms))

const Bolt = ({ off }) => (
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path d="M6.6 1 2.8 6.6h2.6L5 11l3.8-5.6H6.2z" fill="currentColor" opacity={off ? 0.35 : 1} />
    {off && <path d="M1.5 1.5l9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
  </svg>
)

/** One device: shows what a click does — ⚡ turn on (now off), ⚡̸ turn off (now on). */
export default function WlcToggle({ serial, enabled: live }) {
  const [state, setState] = useState(null) // null | 'busy' | { text } (a failure, shown for a while)
  const [flip, setFlip] = useState(null)   // { on, at }: the state just set, until the check-ins agree or 2 min pass
  const enabled = flip && Date.now() - flip.at < 120e3 && flip.on !== live ? flip.on : live
  const run = async e => {
    e.stopPropagation()
    const to = !enabled
    if (!confirm(`Turn wireless charging ${to ? 'ON' : 'OFF'} on ${serial}?`)) return
    setState('busy')
    try {
      const r = await wlcCommand(serial, to, by())
      if (r.ok) { setFlip({ on: to, at: Date.now() }); setState(null); refreshSoon() }
      else { setState({ text: r.error || `HTTP ${r.http}` }); setTimeout(() => setState(null), 15000) }
    } catch (err) { setState({ text: err.message }); setTimeout(() => setState(null), 15000) }
  }
  const busy = state === 'busy', fail = state && !busy ? state : null
  const title = busy ? `Switching WLC on ${serial}…` : fail ? `Failed: ${fail.text}` : `Turn WLC ${enabled ? 'off' : 'on'} on ${serial}`
  return (
    <button type="button" className={`app-btn${fail ? ' is-bad' : ''}`} disabled={busy} title={title} aria-label={title} onClick={run}>
      {busy ? <span className="spin" style={{ width: 11, height: 11 }} /> : fail ? '!' : <Bolt off={!enabled} />}
    </button>
  )
}

/** Every device in the list (the user, 2 Nov 2026): "WLC on" when some are off, "WLC off" when some are on, and
 *  "Toggle" → every 15 min / 30 min / 1 h / custom, run by the server (server/wlcToggle.mjs) until Stop. */
export function WlcToggleAll({ serials, enabledCount }) {
  const [prog, setProg] = useState(null)   // { to, done, total, failed } of an on / off on all
  const [menu, setMenu] = useState(false)
  const menuBox = useKeepOnScreen(menu)
  const [custom, setCustom] = useState('')
  const [until, setUntil] = useState('')       // "HH:MM" (optional): stop then — today, or tomorrow if that's past
  const [endOn, setEndOn] = useState(true)     // the state every device is left in at the end
  const endAt = () => { if (!until) return null; const [h, m] = until.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime() }
  const [job, setJob] = useState(null)     // the server's toggle job
  const [, tick] = useState(0)
  useEffect(() => {
    let live = true
    const load = () => wlcToggleJob().then(j => { if (live && j.ok) setJob(j) }).catch(() => {})
    load(); const t = setInterval(() => { load(); tick(n => n + 1) }, 15e3)
    return () => { live = false; clearInterval(t) }
  }, [])
  const busy = prog && prog.done < prog.total
  const offCount = serials.length - enabledCount
  const all = async (to, e) => {
    e?.stopPropagation()
    if (!serials.length || !confirm(`Turn wireless charging ${to ? 'ON' : 'OFF'} on all ${serials.length} devices?`)) return
    const p = { to, done: 0, total: serials.length, failed: [] }; setProg({ ...p })
    const queue = [...serials], who = by()
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length) {
        const sn = queue.shift()
        try { const r = await wlcCommand(sn, to, who); if (!r.ok) p.failed.push(`${sn}: ${r.error || r.http}`) } catch (err) { p.failed.push(`${sn}: ${err.message}`) }
        p.done++; setProg({ ...p })
      }
    }))
    refreshSoon()
  }
  const startToggle = async (everyMin) => {
    setMenu(false)
    if (!(everyMin >= 1)) return
    // first switch: off when most are on, else on — then it alternates
    const first = !(enabledCount * 2 > serials.length)
    const end = endAt()
    const until_ = end ? `until ${clock(end)}, then WLC ${endOn ? 'ON' : 'OFF'} on all` : 'until you press Stop'
    if (!confirm(`Toggle wireless charging on all ${serials.length} devices every ${fmtEvery(everyMin)}, ${until_}? First: WLC ${first ? 'ON' : 'OFF'} now. It runs on the lab laptop.`)) return
    const j = await wlcToggleJob({ serials, everyMin, first, by: by(), endAt: end, endState: endOn })
    if (j.ok) { setJob(j); refreshSoon() } else alert(`Couldn't start: ${j.error || j.http}`)
  }
  // WLC on / off for a while (the user, 2 Nov 2026): every device switched now, back to the other state at the end — run
  // by the lab laptop like Toggle. "Until I turn it off" is the plain switch.
  const [hold, setHold] = useState(null)       // 'on' | 'off': which menu is open
  const startHold = async (to, min) => {
    setHold(null)
    if (!(min >= 1) || !serials.length) return
    const end = Date.now() + min * 60e3
    if (!confirm(`Turn wireless charging ${to ? 'ON' : 'OFF'} on all ${serials.length} devices for ${fmtEvery(min)}, then back ${to ? 'OFF' : 'ON'} at ${clock(end)}? It runs on the lab laptop.`)) return
    const j = await wlcToggleJob({ serials, hold: true, first: to, by: by(), endAt: end, endState: !to })
    if (j.ok) { setJob(j); refreshSoon() } else alert(`Couldn't start: ${j.error || j.http}`)
  }
  const stop = async () => { const j = await wlcToggleJob({ stop: true, by: by() }); if (j.ok) setJob(j) }
  // WLC on / off at a time, once or every day (server/appSchedule.mjs, shared with the Ads card's schedule)
  const [jobs, setJobs] = useState([])
  useEffect(() => {
    let live = true
    const load = () => appScheduleJobs().then(j => { if (live && j.ok) setJobs((j.jobs || []).filter(x => x.action.startsWith('wlc_'))) }).catch(() => {})
    load(); const t = setInterval(load, 30e3)
    return () => { live = false; clearInterval(t) }
  }, [])
  const keepWlc = j => (j.jobs || []).filter(x => x.action.startsWith('wlc_'))
  const schedule = async (to, time, daily) => {
    const [h, m] = time.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    const at = d.getTime()
    if (!confirm(`Turn wireless charging ${to ? 'ON' : 'OFF'} on all ${serials.length} devices ${daily ? `every day at ${clock(at).replace(' tomorrow', '')}` : `at ${clock(at)}`}? It runs on the lab laptop${daily ? ', until you remove it' : ''}.`)) return
    const j = await appScheduleJobs({ action: to ? 'wlc_on' : 'wlc_off', at, daily, serials, by: by() })
    if (j.ok) { setJobs(keepWlc(j)); setHold(null) } else alert(`Couldn't schedule: ${j.error || j.http}`)
  }
  const dropJob = async (job) => {
    if (!confirm(`Remove "${wlcJobText(job)}"?`)) return
    const j = await appScheduleJobs({ remove: job.id }); if (j.ok) setJobs(keepWlc(j))
  }
  // WLC by battery level: each device switched once when its battery reaches the level, again after each recharge
  const [rules, setRules] = useState([])
  useEffect(() => {
    let live = true
    const load = () => wlcBatteryRules().then(j => { if (live && j.ok) setRules(j.rules || []) }).catch(() => {})
    load(); const t = setInterval(load, 30e3)
    return () => { live = false; clearInterval(t) }
  }, [])
  const addRule = async (to, pct) => {
    if (!confirm(`Turn wireless charging ${to ? 'ON' : 'OFF'} on each of the ${serials.length} devices when its own battery reaches ${pct}%? It runs on the lab laptop for every cycle until you remove it.`)) return
    const j = await wlcBatteryRules({ pct, enabled: to, serials, by: by() })
    if (j.ok) { setRules(j.rules || []); setHold(null) } else alert(`Couldn't set: ${j.error || j.http}`)
  }
  const dropRule = async (r) => {
    if (!confirm(`Remove "${ruleText(r)}"?`)) return
    const j = await wlcBatteryRules({ remove: r.id }); if (j.ok) setRules(j.rules || [])
  }
  const ruleChips = rules.map(r => { const f = Object.entries(r.fired || {})
    return <span key={r.id} className="app-job" title={`${r.serials.length} devices · set by ${r.by || '—'}${f.length ? ` · switched: ${f.map(([sn, x]) => `${sn.slice(-5)} at ${x.pct}% ${new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`).join(', ')}` : ' · none reached it yet'}`}>
      {ruleText(r)}{f.length ? ` · ${f.length}` : ''}<button type="button" aria-label={`Remove ${ruleText(r)}`} onClick={() => dropRule(r)}>×</button></span> })
  const chips = jobs.map(j => (
    <span key={j.id} className="app-job" title={`${j.serials.length} devices · set by ${j.by || '—'}${j.last ? ` · last: ${j.last.ok} of ${j.last.total} at ${new Date(j.last.at).toLocaleString()}` : ''}`}>
      {wlcJobText(j)}<button type="button" aria-label={`Remove ${wlcJobText(j)}`} onClick={() => dropJob(j)}>×</button></span>))
  const result = prog && !busy ? `WLC ${prog.to ? 'on' : 'off'}: ${prog.total - prog.failed.length} of ${prog.total}${prog.failed.length ? ` · ${prog.failed.length} failed` : ''}` : null
  if (job?.active && job.hold) {
    return (
      <span className="app-all" onClick={e => e.stopPropagation()}>
        <span className="hint" title={job.last ? `WLC ${job.last.to ? 'on' : 'off'} on ${job.last.ok} at ${new Date(job.last.at).toLocaleTimeString()}${job.last.failed?.length ? ` · failed: ${job.last.failed.join(', ')}` : ''}` : undefined}>
          <span className="spin" style={{ width: 10, height: 10 }} /> WLC {job.endState ? 'off' : 'on'} · back {job.endState ? 'on' : 'off'} at {clock(job.endAt)}</span>
        <button type="button" className="btn btn-sm" onClick={stop} title="Cancel the timer; WLC stays as it is now">Stop</button>
      </span>
    )
  }
  if (job?.active) {
    const next = new Date(job.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return (
      <span className="app-all" onClick={e => e.stopPropagation()}>
        <span className="hint" title={job.last ? `last: WLC ${job.last.to ? 'on' : 'off'} on ${job.last.ok} at ${new Date(job.last.at).toLocaleTimeString()}${job.last.failed?.length ? ` · failed: ${job.last.failed.join(', ')}` : ''}` : undefined}>
          <span className="spin" style={{ width: 10, height: 10 }} /> Toggling every {fmtEvery(job.everyMin)} · next WLC {job.next ? 'on' : 'off'} {next}
          {job.endAt ? <> · until {clock(job.endAt)}, then WLC {job.endState ? 'on' : 'off'}</> : null}</span>
        <button type="button" className="btn btn-sm" onClick={stop}>Stop</button>
      </span>
    )
  }
  return (
    <span className="app-all" onClick={e => e.stopPropagation()}>
      {result && <span className={`hint${prog.failed.length ? ' app-all-bad' : ''}`} title={prog.failed.join('\n') || undefined}>{result}</span>}
      {chips}{ruleChips}
      {busy && <span className="hint"><span className="spin" style={{ width: 10, height: 10 }} /> {prog.done} / {prog.total}…</span>}
      {[[true, offCount > 0, `${offCount} with WLC off`], [false, enabledCount > 0, `${enabledCount} with WLC on`]].map(([to, show, why]) => show && (
        <span key={String(to)} className="wlc-menu-wrap">
          <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={hold === (to ? 'on' : 'off')} title={`${why}: turn it ${to ? 'on' : 'off'} on every device in this list`}
            onClick={() => { setMenu(false); setHold(h => h === (to ? 'on' : 'off') ? null : to ? 'on' : 'off') }}>WLC {to ? 'on' : 'off'} ▾</button>
          {hold === (to ? 'on' : 'off') && <ForMenu to={to} onPick={min => startHold(to, min)} onAlways={e => { setHold(null); all(to, e) }} onSchedule={(t, d) => schedule(to, t, d)} onBattery={pct => addRule(to, pct)} />}
        </span>))}
      <span className="wlc-menu-wrap">
        <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={menu} onClick={() => { setHold(null); setMenu(m => !m) }}>Toggle ▾</button>
        {menu && (
          <span ref={menuBox} className="wlc-menu" role="menu">
            {/* when to stop (optional) and the state every device is left in then (the user, 2 Nov 2026) */}
            <span className="wlc-end">
              <label>Until <input type="time" className="input" value={until} onChange={e => setUntil(e.target.value)} aria-label="End time (optional)" /></label>
              <span className="wlc-end-state" role="group" aria-label="WLC at the end">then WLC
                <button type="button" className={endOn ? 'is-on' : ''} aria-pressed={endOn} onClick={() => setEndOn(true)}>on</button>
                <button type="button" className={!endOn ? 'is-on' : ''} aria-pressed={!endOn} onClick={() => setEndOn(false)}>off</button></span>
              {!until && <span className="hint">no end time: until Stop</span>}
            </span>
            {[15, 30, 60].map(m => <button key={m} type="button" role="menuitem" onClick={() => startToggle(m)}>Every {fmtEvery(m)}</button>)}
            <span className="wlc-custom">
              <input className="input" inputMode="numeric" placeholder="min" value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={e => { if (e.key === 'Enter') startToggle(+custom) }} aria-label="Custom interval in minutes" />
              <button type="button" className="btn btn-sm" disabled={!(+custom >= 1)} onClick={() => startToggle(+custom)}>Custom</button>
            </span>
          </span>
        )}
      </span>
    </span>
  )
}
// "WLC on ▾" / "WLC off ▾": for how long, then back
function ForMenu({ to, onPick, onAlways, onSchedule, onBattery }) {
  const [custom, setCustom] = useState('')
  const [pct, setPct] = useState('')
  const box = useKeepOnScreen(true) // never past the window's edge (3 Nov 2026: it opened half off screen)
  const [time, setTime] = useState('')
  const [daily, setDaily] = useState(false)
  return (
    <span ref={box} className="wlc-menu" role="menu">
      {/* now, and it stays so (the user, 3 Nov 2026: "add a now option, like WLC off now") */}
      <button type="button" role="menuitem" onClick={onAlways}><b>WLC {to ? 'on' : 'off'} now</b></button>
      {[15, 30, 60].map(m => <button key={m} type="button" role="menuitem" onClick={() => onPick(m)}>For {fmtEvery(m)}</button>)}
      <span className="wlc-custom">
        <input className="input" inputMode="numeric" placeholder="min" value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={e => { if (e.key === 'Enter' && +custom >= 1) onPick(Math.min(1440, +custom)) }} aria-label="Custom time in minutes" />
        <button type="button" className="btn btn-sm" disabled={!(+custom >= 1)} onClick={() => onPick(Math.min(1440, +custom))}>Custom</button>
      </span>
      {/* at a time, once or every day (the user, 3 Nov 2026: "like ads") — run on the lab laptop */}
      <span className="wlc-end" style={{ borderBottom: 0, borderTop: '1px solid var(--border)', marginTop: 4, marginBottom: 0, paddingTop: 8 }}>
        <label>WLC {to ? 'on' : 'off'} at <input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} aria-label="Time" /></label>
        <span className="wlc-end-state" role="group" aria-label="How often">
          <button type="button" className={!daily ? 'is-on' : ''} aria-pressed={!daily} onClick={() => setDaily(false)}>Once</button>
          <button type="button" className={daily ? 'is-on' : ''} aria-pressed={daily} onClick={() => setDaily(true)}>Every day</button></span>
        <button type="button" className="btn btn-sm" disabled={!time} onClick={() => onSchedule(time, daily)}>Schedule</button>
      </span>
      {/* each device on its own, when its battery reaches a level (the user, 3 Nov 2026: "at 15 % disable WLC") */}
      <span className="wlc-custom" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: 12.5 }}>When battery reaches</span>
        <input className="input" inputMode="numeric" placeholder="%" value={pct} onChange={e => setPct(e.target.value.replace(/\D/g, '').slice(0, 2))}
          onKeyDown={e => { if (e.key === 'Enter' && +pct >= 1) onBattery(+pct) }} aria-label="Battery %" style={{ width: 48 }} />
        <button type="button" className="btn btn-sm" disabled={!(+pct >= 1)} onClick={() => onBattery(+pct)}>Set</button>
      </span>
    </span>
  )
}
const fmtEvery = m => (m % 60 === 0 ? `${m / 60} h` : `${m} min`)
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (new Date(t).toDateString() !== new Date().toDateString() ? ' tomorrow' : '')
const wlcJobText = j => `WLC ${j.action === 'wlc_on' ? 'on' : 'off'} ${j.daily ? `daily ${clock(j.at).replace(' tomorrow', '')}` : clock(j.at)}`
const ruleText = r => `WLC ${r.enabled ? 'on' : 'off'} at ≤${r.pct}%`
