import React, { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, PARTS } from '../lib/fleet.js'
import { subscribeProgress, getProgress } from '../lib/window.js'

// A thin progress bar along the bottom of the header while the latest data is still being
// fetched: the readings (devices done / devices) and the data files (PARTS). Until it is gone,
// what the page shows may be the copy stored in this browser. The user, 26 Oct 2026: a chart
// showed an old picture for a few seconds, then changed — "show reloading (progress bar)".
export default function SyncBar() {
  const p = useSyncExternalStore(subscribeProgress, getProgress, getProgress)
  const fleet = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const parts = Object.entries(fleet.parts || {})
  const partsLoading = parts.filter(([, x]) => x.state === 'loading')
  if (!p.loading && !partsLoading.length) return null
  const total = (p.loading ? p.total : 0) + parts.length
  const done = (p.loading ? p.done : 0) + parts.length - partsLoading.length
  const pct = total ? Math.max(4, Math.round(done / total * 100)) : 4
  const text = p.loading
    ? `Fetching the latest readings · ${p.done} / ${p.total} devices`
    : `Loading the ${partsLoading.map(([n]) => PARTS[n]?.label || n).join(', ')}`
  return (
    <div className="sync-bar" role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="sync-bar-fill" style={{ width: `${pct}%` }} />
      {/* the label only on the page's first fetch; the 5-minute top-ups just move the bar */}
      {(p.first || !p.loading) && <div className="sync-bar-label"><span className="spin" aria-hidden="true" /> {text}…</div>}
    </div>
  )
}
