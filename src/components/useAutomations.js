import { useEffect, useState } from 'react'
import { wlcToggleJob, appScheduleJobs, wlcBatteryRules } from '../lib/data.js'

// What the lab laptop is running on its own right now — WLC toggling / a WLC hold, scheduled open / close / WLC, WLC battery
// rules — as short lines for Today's WLC and Ads on screen tiles (the user, 3 Nov 2026: "when any process is running, show it").
// Polled every 30 s; the drop-downs keep their own lists with the × to remove.
const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const every = m => (m % 60 === 0 ? `${m / 60} h` : `${m} min`)

export function useAutomations() {
  const [s, setS] = useState({ toggle: null, jobs: [], rules: [] })
  useEffect(() => {
    let live = true
    const load = () => Promise.all([wlcToggleJob().catch(() => null), appScheduleJobs().catch(() => null), wlcBatteryRules().catch(() => null)])
      .then(([t, j, r]) => { if (live) setS({ toggle: t?.ok && t.active ? t : null, jobs: j?.ok ? j.jobs || [] : [], rules: r?.ok ? r.rules || [] : [] }) })
    load(); const id = setInterval(load, 30e3)
    return () => { live = false; clearInterval(id) }
  }, [])
  const wlc = [], app = []
  const t = s.toggle
  if (t) wlc.push(t.hold ? `WLC ${t.endState ? 'off' : 'on'} until ${hm(t.endAt)}` : `toggling every ${every(t.everyMin)}${t.endAt ? ` until ${hm(t.endAt)}` : ''}`)
  for (const r of s.rules) wlc.push(`WLC ${r.enabled ? 'on' : 'off'} at ≤${r.pct}%`)
  for (const j of s.jobs) {
    const when = j.daily ? `daily ${hm(j.at)}` : hm(j.at)
    if (j.action.startsWith('wlc_')) wlc.push(`WLC ${j.action === 'wlc_on' ? 'on' : 'off'} ${when}`)
    else app.push(`${j.action === 'open' ? 'open' : 'close'} ${when}`)
  }
  return { wlc, app, rules: s.rules }
}
