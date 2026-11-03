import React, { useEffect, useState } from 'react'
import { wlcCommand, wlcToggleJob } from '../lib/data.js'
import { poll } from '../lib/fleet.js'

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
      {busy && <span className="hint"><span className="spin" style={{ width: 10, height: 10 }} /> {prog.done} / {prog.total}…</span>}
      {[[true, offCount > 0, `${offCount} with WLC off`], [false, enabledCount > 0, `${enabledCount} with WLC on`]].map(([to, show, why]) => show && (
        <span key={String(to)} className="wlc-menu-wrap">
          <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={hold === (to ? 'on' : 'off')} title={`${why}: turn it ${to ? 'on' : 'off'} on every device in this list`}
            onClick={() => { setMenu(false); setHold(h => h === (to ? 'on' : 'off') ? null : to ? 'on' : 'off') }}>WLC {to ? 'on' : 'off'} ▾</button>
          {hold === (to ? 'on' : 'off') && <ForMenu to={to} onPick={min => startHold(to, min)} onAlways={e => { setHold(null); all(to, e) }} />}
        </span>))}
      <span className="wlc-menu-wrap">
        <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={menu} onClick={() => { setHold(null); setMenu(m => !m) }}>Toggle ▾</button>
        {menu && (
          <span className="wlc-menu" role="menu">
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
function ForMenu({ to, onPick, onAlways }) {
  const [custom, setCustom] = useState('')
  return (
    <span className="wlc-menu" role="menu">
      {[15, 30, 60].map(m => <button key={m} type="button" role="menuitem" onClick={() => onPick(m)}>For {fmtEvery(m)}</button>)}
      <button type="button" role="menuitem" onClick={onAlways}>Until I turn it {to ? 'off' : 'on'}</button>
      <span className="wlc-custom">
        <input className="input" inputMode="numeric" placeholder="min" value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={e => { if (e.key === 'Enter' && +custom >= 1) onPick(Math.min(1440, +custom)) }} aria-label="Custom time in minutes" />
        <button type="button" className="btn btn-sm" disabled={!(+custom >= 1)} onClick={() => onPick(Math.min(1440, +custom))}>Custom</button>
      </span>
    </span>
  )
}
const fmtEvery = m => (m % 60 === 0 ? `${m / 60} h` : `${m} min`)
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (new Date(t).toDateString() !== new Date().toDateString() ? ' tomorrow' : '')
