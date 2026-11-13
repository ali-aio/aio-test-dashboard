import React, { useSyncExternalStore } from 'react'
import { subscribeIphones, getIphones, padAt } from '../lib/phoneLog.js'
import { rowsFor } from '../lib/window.js'
import { hm } from '../lib/format.js'

// Today, always (any cycle, charging, no test): each iPhone's battery as the lab laptop last read it, and
// whether it is on its T7's pad — the user, 13 Nov 2026: "Today always shows the iPhone charge, so I know
// how much charge is there". In a discharge cycle these tiles head the iPhone on the pad card (PhoneOnPad.jsx),
// whose hourly table shows under them once a phone is on a pad; otherwise IphonesNow is a card of its own.
const STALE = 75 * 60e3 // the phone sends on the hour (Shortcuts) and is read every 5 min while awake

// disconnected = the lab laptop's latest try didn't reach it (and nothing came since): highlighted at once
// (the user, 13 Nov 2026: "if the phone is disconnected then highlight that card"), or nothing for 75 min
const isDown = (p, now) => !p.lastOk || now - p.lastOk > STALE || (!!p.error && p.lastTry > p.lastOk)

export function useIphones(now) {
  const ip = useSyncExternalStore(subscribeIphones, getIphones, getIphones)
  const phones = ip.phones || []
  return { phones, down: phones.filter(p => isDown(p, now)).length }
}

export const IphonesSub = ({ down }) => (
  <div className="card-sub">Battery as last read by the lab laptop over Wi-Fi (every 5 min while the phone is awake)
    {down ? <> · <b style={{ color: 'var(--status-critical)' }}>{down} disconnected</b> — unlock {down === 1 ? 'it' : 'them'} and keep {down === 1 ? 'it' : 'them'} on the laptop's Wi-Fi</> : null}</div>
)

export function IphoneTiles({ phones, now }) {
  return (
    <div className="stat-row">
      {phones.map(p => {
        const l = p.last, down = isDown(p, now)
        const pad = p.t7 ? padAt(rowsFor(p.t7), now) : null
        return (
          <div key={p.udid} className={`stat${down ? ' is-down' : ''}`} title={`${p.name || 'iPhone'} · ${p.udid}${p.error ? ` · last try: ${p.error}` : ''}`}>
            <div className="stat-label">{p.key || p.name || 'iPhone'}{p.t7 ? <> · <a className="link mono" href={`#/nx/device/${p.t7}`}>{p.t7.slice(-5)}</a></> : null}</div>
            <div className="stat-value" style={down ? { color: 'var(--text-muted)' } : undefined}>
              {l ? <>{l.pct}<span className="secondary" style={{ fontSize: 13 }}>%</span>{l.charging ? <span title="charging" style={{ fontSize: 16 }}> ⚡</span> : null}</> : '—'}</div>
            <div className="stat-foot">
              {!l ? 'not read yet' : down ? `disconnected · last read ${hm(l.at)}${new Date(l.at).toDateString() !== new Date(now).toDateString() ? ` ${new Date(l.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}` : `read ${hm(l.at)} · ${l.charging ? 'charging' : 'not charging'}`}
              {/* the T7's pad having a load doesn't mean it's the iPhone (13 Nov: a load in its place): on the pad = the phone charging and the pad loaded */}
              {!l || down ? '' : l.charging && pad !== false ? ' · on the pad' : l.charging ? ' · on a charger, not the pad' : ' · off the pad'}
            </div>
          </div>)
      })}
    </div>
  )
}

export default function IphonesNow({ now }) {
  const { phones, down } = useIphones(now)
  if (!phones.length) return null
  return (
    <div className="card">
      <div className="card-head"><div><h2>iPhones</h2><IphonesSub down={down} /></div></div>
      <div className="card-body"><IphoneTiles phones={phones} now={now} /></div>
    </div>
  )
}
