import React, { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, PARTS, retryPart } from '../lib/fleet.js'
import { subscribeWindow, getWindow, loadWindow } from '../lib/window.js'

// Where a part of the page draws on data that has not (fully) arrived, it says so in that
// part: a spinner while it loads (and while it is retried), "Couldn't load … · Retry" once the
// retries are spent. Nothing when everything is in. The lab, 22 Oct 2026: "when values didn't
// load completely show a loader in that specific part and try to fetch that".
//   parts:  names from PARTS in src/lib/fleet.js (curves, hours, drops, readings, sheetRuns)
//   window: true to include the 7-day readings window (devices whose readings did not come)
//   missing: what to say when the server has not written the file yet (404)
export default function PartStatus({ parts = [], window: win = false, DEV: devices = null, missing = null, style }) {
  const fleet = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const DEV = devices || fleet.DEV
  const w = useSyncExternalStore(subscribeWindow, getWindow, getWindow)
  const st = parts.map((name) => ({ name, label: PARTS[name].label, ...(fleet.parts?.[name] || { state: 'loading', tries: 1 }) }))
  const loading = st.filter((p) => p.state === 'loading')
  const failed = st.filter((p) => p.state === 'error')
  const absent = st.filter((p) => p.state === 'missing')
  const winFailed = win ? w.failed || 0 : 0
  const winLoading = win && w.loading && !Object.keys(w.rows || {}).length

  if (!loading.length && !failed.length && !absent.length && !winFailed && !winLoading) return null
  const row = (key, icon, text, action) => (
    <div key={key} className={`part-status${icon === 'bad' ? ' is-bad' : ''}`} style={style}>
      {icon === 'spin' ? <span className="spin" aria-hidden="true" /> : <span aria-hidden="true">{icon === 'bad' ? '●' : '○'}</span>}
      <span>{text}</span>{action}
    </div>
  )
  return (
    <div className="part-status-list" role="status" aria-live="polite">
      {loading.map((p) => row(p.name, 'spin', `Loading the ${p.label}${p.tries > 1 ? ` (try ${p.tries} of 3)` : ''}…`))}
      {failed.map((p) => row(p.name, 'bad', `Couldn't load the ${p.label} (${p.err}). What's shown may be incomplete.`,
        <button type="button" className="btn btn-sm" onClick={() => retryPart(p.name)}>Retry</button>))}
      {absent.map((p) => row(p.name, 'off', missing || `The server has not built the ${p.label} yet; it fills in after its next check of the MDM.`))}
      {winLoading && row('win', 'spin', 'Loading the last 7 days of readings…')}
      {winFailed > 0 && row('winf', w.retryIn ? 'spin' : 'bad',
        `Readings did not load for ${winFailed} device${winFailed === 1 ? '' : 's'}${w.retryIn ? ' · trying again' : ''}: ${w.failedSerials.map((s) => '…' + s.slice(-5)).join(', ')}`,
        !w.retryIn && DEV?.length ? <button type="button" className="btn btn-sm" onClick={() => loadWindow(DEV, false, true)}>Retry</button> : null)}
    </div>
  )
}
