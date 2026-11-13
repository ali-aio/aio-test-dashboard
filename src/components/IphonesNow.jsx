import React, { useSyncExternalStore } from 'react'
import { subscribeIphones, getIphones, padAt } from '../lib/phoneLog.js'
import { rowsFor } from '../lib/window.js'
import { hm } from '../lib/format.js'

// Today, always (any cycle, charging, no test): each iPhone's battery as the lab laptop last read it, and
// whether its T7's pad has a load now — the user, 13 Nov 2026: "Today always shows the iPhone charge, so I know
// how much charge is there" (the phones sit off the pads until they run down, then go back on 00790 / 00606 / 00485).
// Unlike the iPhone on the pad card, the % shows whether or not the phone is on the pad.
const STALE = 75 * 60e3 // the phone sends on the hour (Shortcuts) and is read every 5 min while awake

export default function IphonesNow({ now }) {
  const ip = useSyncExternalStore(subscribeIphones, getIphones, getIphones)
  const phones = ip.phones || []
  if (!phones.length) return null
  return (
    <div className="card">
      <div className="card-head"><div><h2>iPhones</h2>
        <div className="card-sub">Battery as last read by the lab laptop over Wi-Fi (every 5 min while the phone is awake)</div></div></div>
      <div className="card-body"><div className="stat-row">
        {phones.map(p => {
          const l = p.last, stale = !p.lastOk || now - p.lastOk > STALE
          const pad = p.t7 ? padAt(rowsFor(p.t7), now) : null
          return (
            <div key={p.udid} className={`stat${stale ? ' is-warn' : ''}`} title={`${p.name || 'iPhone'} · ${p.udid}${p.error ? ` · last try: ${p.error}` : ''}`}>
              <div className="stat-label">{p.key || p.name || 'iPhone'}{p.t7 ? <> · <a className="link mono" href={`#/nx/device/${p.t7}`}>{p.t7.slice(-5)}</a></> : null}</div>
              <div className="stat-value" style={stale ? { color: 'var(--status-critical)' } : undefined}>
                {l ? <>{l.pct}<span className="secondary" style={{ fontSize: 13 }}>%</span>{l.charging ? <span title="charging" style={{ fontSize: 16 }}> ⚡</span> : null}</> : '—'}</div>
              <div className="stat-foot">
                {!l ? 'not read yet' : stale ? `not heard from since ${hm(l.at)}${new Date(l.at).toDateString() !== new Date(now).toDateString() ? ` ${new Date(l.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}` : `read ${hm(l.at)} · ${l.charging ? 'charging' : 'not charging'}`}
                {pad === true ? ' · on the pad' : pad === false ? ' · off the pad' : ''}
              </div>
            </div>)
        })}
      </div></div>
    </div>
  )
}
