import React, { useState } from 'react'
import { useKeepOnScreen } from './Primitives.jsx'

// One plain form for Today's WLC and Ads on screen cards (the user, 5 Nov 2026: "start at 10 for 3 hours and then off — the
// menus confuse users"): what to do · when to start · for how long · once or every day, with the whole plan read back as a
// sentence before the button. "Now" and "until I change it" is the plain switch (onNow); anything with a time or a length is
// a schedule on the lab laptop (onPlan → server/appSchedule.mjs, which switches back when the time is up).
//   actions: [{ id, label, verb, back }] — e.g. { id: 'wlc_on', label: 'WLC on', verb: 'Turn WLC on', back: 'WLC off' }
const LENGTHS = [[null, 'Until I change it'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [180, '3 h'], ['custom', 'Custom…']]
const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export const fmtLen = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)

export default function ActionPlanner({ actions, defaultAction, count, onNow, onPlan, extra = null }) {
  const box = useKeepOnScreen(true)
  const [act, setAct] = useState(defaultAction || actions[0].id)
  const [start, setStart] = useState('now')      // 'now' | 'at'
  const [time, setTime] = useState('')
  const [len, setLen] = useState(null)           // null | minutes | 'custom'
  const [ch, setCh] = useState(''), [cm, setCm] = useState('')
  const [daily, setDaily] = useState(false)
  const a = actions.find(x => x.id === act) || actions[0]
  const minutes = len === 'custom' ? (+ch || 0) * 60 + (+cm || 0) : len
  const at = (() => { if (start !== 'at' || !time) return null; const [h, m] = time.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime() })()
  const ready = (start === 'now' || at) && (len !== 'custom' || minutes >= 1) && (!minutes || minutes <= 1440)
  const day = t => (new Date(t).toDateString() === new Date().toDateString() ? '' : ' tomorrow')
  const sentence = !ready ? (start === 'at' && !time ? 'Pick a start time.' : 'Set how long.')
    : `${a.verb} ${a.prep || 'on'} all ${count} devices ${start === 'now' ? 'now' : `at ${hm(at)}${daily ? '' : day(at)}`}`
      + (minutes ? ` for ${fmtLen(minutes)}, then ${a.back}${start === 'now' ? ` at ${hm(Date.now() + minutes * 60e3)}` : ` at ${hm(at + minutes * 60e3)}`}` : '')
      + (daily && start === 'at' ? ' — every day' : '') + '.'
  const go = () => {
    if (!ready) return
    if (start === 'now' && !minutes) return onNow(act)
    onPlan({ action: act, at: start === 'now' ? Date.now() : at, daily: start === 'at' && daily, durationMin: minutes || null, sentence })
  }
  const Seg = ({ value, set, opts }) => (
    <span className="plan-seg" role="group">{opts.map(([v, l]) => <button key={String(v)} type="button" className={value === v ? 'is-on' : ''} aria-pressed={value === v} onClick={() => set(v)}>{l}</button>)}</span>)
  return (
    <span ref={box} className="wlc-menu plan-menu" role="dialog" aria-label="Plan">
      <span className="plan-row"><span className="plan-k">Do</span><Seg value={act} set={setAct} opts={actions.map(x => [x.id, x.label])} /></span>
      <span className="plan-row"><span className="plan-k">Start</span>
        <Seg value={start} set={setStart} opts={[['now', 'Now'], ['at', 'At a time']]} />
        {start === 'at' && <input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} aria-label="Start time" />}</span>
      <span className="plan-row plan-wrap"><span className="plan-k">For</span>
        <Seg value={len} set={setLen} opts={LENGTHS} />
        {len === 'custom' && <span className="plan-custom">
          <input className="input" inputMode="numeric" placeholder="h" value={ch} onChange={e => setCh(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="Hours" /> h
          <input className="input" inputMode="numeric" placeholder="min" value={cm} onChange={e => setCm(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label="Minutes" /> min</span>}</span>
      {start === 'at' && <span className="plan-row"><span className="plan-k">Repeat</span><Seg value={daily} set={setDaily} opts={[[false, 'Once'], [true, 'Every day']]} /></span>}
      <span className="plan-say">{sentence}</span>
      <button type="button" className="btn btn-sm btn-primary plan-go" disabled={!ready} onClick={go}>{start === 'now' && !minutes ? `${a.label} now` : 'Set it'}</button>
      {extra}
    </span>
  )
}
