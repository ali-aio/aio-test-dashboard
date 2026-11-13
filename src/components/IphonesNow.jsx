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
  const down = phones.filter(p => !p.lastOk || now - p.lastOk > STALE || (!!p.error && p.lastTry > p.lastOk)).length
  return (
    <div className="card">
      <div className="card-head"><div><h2>iPhones</h2>
        <div className="card-sub">Battery as last read by the lab laptop over Wi-Fi (every 5 min while the phone is awake){down ? <> · <b style={{ color: 'var(--status-critical)' }}>{down} disconnected</b> — unlock {down === 1 ? 'it' : 'them'} and keep {down === 1 ? 'it' : 'them'} on the laptop's Wi-Fi</> : null}</div></div></div>
      <div className="card-body"><div className="stat-row">
        {phones.map(p => {
          // disconnected = the lab laptop's latest try didn't reach it (and nothing came since): the tile is highlighted at once
          // (the user, 13 Nov 2026: "if the phone is disconnected then highlight that card"), not after the 75 min of the On the pad card
          const l = p.last, stale = !p.lastOk || now - p.lastOk > STALE || (!!p.error && p.lastTry > p.lastOk)
          const pad = p.t7 ? padAt(rowsFor(p.t7), now) : null
          return (
            <div key={p.udid} className={`stat${stale ? ' is-down' : ''}`} title={`${p.name || 'iPhone'} · ${p.udid}${p.error ? ` · last try: ${p.error}` : ''}`}>
              <div className="stat-label">{p.key || p.name || 'iPhone'}{p.t7 ? <> · <a className="link mono" href={`#/nx/device/${p.t7}`}>{p.t7.slice(-5)}</a></> : null}</div>
              <div className="stat-value" style={stale ? { color: 'var(--text-muted)' } : undefined}>
                {l ? <>{l.pct}<span className="secondary" style={{ fontSize: 13 }}>%</span>{l.charging ? <span title="charging" style={{ fontSize: 16 }}> ⚡</span> : null}</> : '—'}</div>
              <div className="stat-foot">
                {!l ? 'not read yet' : stale ? `disconnected · last read ${hm(l.at)}${new Date(l.at).toDateString() !== new Date(now).toDateString() ? ` ${new Date(l.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}` : `read ${hm(l.at)} · ${l.charging ? 'charging' : 'not charging'}`}
                {/* the T7's pad having a load doesn't mean it's the iPhone (13 Nov: a load in its place): on the pad = the phone charging and the pad loaded */}
                {!l || stale ? '' : l.charging && pad !== false ? ' · on the pad' : l.charging ? ' · on a charger, not the pad' : ' · off the pad'}
              </div>
            </div>)
        })}
      </div></div>
    </div>
  )
}
