import React, { useState } from 'react'
import { wlcCommand } from '../lib/data.js'
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

/** Every device in the list: "WLC off on all" / "WLC on on all", by the majority now (the opposite for 2 min after
 *  one was sent). Three at a time; progress, then how many worked (failures on hover). */
export function WlcToggleAll({ serials, enabledCount }) {
  const [last, setLast] = useState(null)
  const [prog, setProg] = useState(null)
  const fresh = last && Date.now() - last.at < 120e3
  const to = fresh ? !last.to : !(enabledCount * 2 > serials.length) // most on → turn off on all
  const busy = prog && prog.done < prog.total
  const run = async e => {
    e.stopPropagation()
    if (!serials.length || !confirm(`Turn wireless charging ${to ? 'ON' : 'OFF'} on all ${serials.length} devices?`)) return
    const p = { done: 0, total: serials.length, failed: [] }; setProg({ ...p })
    const queue = [...serials], who = by()
    await Promise.all([0, 1, 2].map(async () => {
      while (queue.length) {
        const sn = queue.shift()
        try { const r = await wlcCommand(sn, to, who); if (!r.ok) p.failed.push(`${sn}: ${r.error || r.http}`) } catch (err) { p.failed.push(`${sn}: ${err.message}`) }
        p.done++; setProg({ ...p })
      }
    }))
    setLast({ to, at: Date.now() }); refreshSoon()
  }
  const label = busy ? `Switching ${prog.done} / ${prog.total}…` : `WLC ${to ? 'on' : 'off'} on all`
  const result = prog && !busy ? `${prog.total - prog.failed.length} of ${prog.total} done${prog.failed.length ? ` · ${prog.failed.length} failed` : ''}` : null
  return (
    <span className="app-all">
      {result && <span className={`hint${prog.failed.length ? ' app-all-bad' : ''}`} title={prog.failed.join('\n') || undefined}>{result}</span>}
      <button type="button" className="btn btn-sm" disabled={busy || !serials.length} onClick={run} title={`Turn wireless charging ${to ? 'on' : 'off'} on every device in this list`}>
        {busy && <span className="spin" style={{ width: 11, height: 11 }} />} {label}</button>
    </span>
  )
}
