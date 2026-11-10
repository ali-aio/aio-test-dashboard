import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Card } from './Primitives.jsx'
import { SortTable } from './SortTable.jsx'
import { subscribeFw, getFw, saveFw } from '../lib/fwTests.js'
import AppToggle from './AppToggle.jsx'
import WlcToggle from './WlcToggle.jsx'
import { rowsFor, latestRun, drainSplit, dayStats } from '../lib/window.js'
import { byBenchOrder, online, status, lifetimeCycles } from '../lib/device.js'
import { ago, hm, MIN } from '../lib/format.js'
import { fmtLifetime } from '../lib/fmt.js'
import { fmtDur } from '../lib/cycles.js'
import { TEMP_WARN, TEMP_LIMIT } from '../lib/profile.js'
import { SPAN, SPAN_LABEL, stateCode } from '../lib/hostApp.js'
import { padLoad } from '../lib/pad.js'

// Firmware tests (the user, 6 Nov 2026). FwTestsToday: a section at the bottom of Today for each test running now, with its
// devices as they are. FwTestsLog: the record at the bottom of the Cycle plan — what was tested, on which devices.
const short = s => s.replace(/^AT070AABU/, '')
const devHref = s => `#/nx/device/${s}`
const date = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
const dayInput = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dayMs = v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d).getTime() }

const About = ({ t }) => (
  <dl className="fw-about">
    {t.firmware && <><dt>Firmware</dt><dd>{t.firmware}</dd></>}
    {t.tested && <><dt>Part tested</dt><dd>{t.tested}</dd></>}
    {t.why && <><dt>Why</dt><dd>{t.why}</dd></>}
    {t.result && <><dt>Result</dt><dd>{t.result}</dd></>}
  </dl>
)

const dash = <span className="secondary">—</span>
const rate = v => (v != null && v > 0 ? `${v.toFixed(2)} %/h` : dash)
const extraOf = d => { const e = d?.snap?.extra; if (typeof e !== 'string') return e || {}; try { return JSON.parse(e) } catch (x) { return {} } }
const clock = t => (new Date(t).toDateString() === new Date().toDateString() ? hm(t) : `${hm(t)} ${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })}`)
const APP_TEXT = code => (code === SPAN.otherApp ? 'Other app' : SPAN_LABEL[code])

// One device's row, the columns of Devices today without Drain (the user, 10 Nov 2026), timed from its own latest drain or charge; the app and WLC switches are the ones on Today's tiles.
// A plain function returning the <tr>: SortTable reads each row's cells from its props, so a component here would not sort.
function fwRow(sn, fleet) {
  const d = fleet.DMAP?.get(sn), s = d?.snap, on = !!d && online(d), st = d ? status(d) : null, e = extraOf(d)
  const rows = rowsFor(sn)
  const run = on ? latestRun(rows) : null, drain = run && !run.charging ? run : null
  const split = drain ? drainSplit(rows, drain) : null
  const stats = run ? dayStats(sn, run.t) : null
  const app = fleet.hostAppNow?.get(sn), code = app ? stateCode(app) : null
  const wlcOn = e.wlc_status != null && e.wlc_status !== '' ? +e.wlc_status !== -1 : e.wlc_charging === true
  const temp = on && s.battery_temp_c ? s.battery_temp_c : null
  const heat = v => (v >= TEMP_LIMIT ? 'var(--bad)' : v >= TEMP_WARN ? 'var(--warn)' : 'inherit')
  return (
    <tr key={sn}>
      <td className="mono"><a className="link-btn plain-link mono" href={devHref(sn)} title={`Open ${sn}`}>{sn}</a></td>
      <td><span className={`pill ${on ? 'pill-ok' : ''}`}>{!on ? 'Not reporting' : s.charging ? 'On charge' : 'On battery'}</span></td>
      <td className="r">{st?.pct != null ? <span className="batt num">{st.pct}%<span className={`bar ${st.pct < 20 ? 'warn' : st.k === 'ready' ? 'ok' : 'run'}`}><i style={{ width: `${st.pct}%` }} /></span></span> : dash}</td>
      <td className="r mono">{run ? (run.charging ? `on charge ${clock(run.t)}` : clock(run.t)) : dash}</td>
      <td className="r mono">{rate(split?.active)}</td>
      <td className="r mono">{rate(split?.none)}</td>
      <td className="r mono">{d ? fmtLifetime(lifetimeCycles(s)) : dash}</td>
      <td className="r mono" style={{ color: temp ? heat(temp) : 'inherit' }}>{temp ? `${temp.toFixed(1)} °C` : dash}</td>
      <td className="r mono" style={{ color: stats?.maxTemp != null ? heat(stats.maxTemp) : 'inherit' }}>{stats?.maxTemp != null ? `${stats.maxTemp.toFixed(1)} °C` : dash}</td>
      <td className="r mono" style={{ color: stats?.minAbove45 ? 'var(--bad)' : 'inherit' }}>{stats?.minAbove45 ? fmtDur(stats.minAbove45 * MIN) : dash}</td>
      <td className="r mono fw-nowrap">{rows?.findLast(r => r.build_id)?.build_id || dash}</td>{/* the newest reading can be the live snapshot, which has no build */}
      <td className="r fw-nowrap">{s?.last_seen_at ? ago(Date.parse(s.last_seen_at)) : dash}</td>
      <td className="fw-nowrap"><span className="fw-switch"><AppToggle serial={sn} onScreen={code === SPAN.on} /><span className="secondary">{code ? APP_TEXT(code) : 'Not reported'}</span></span></td>
      <td className="fw-nowrap"><span className="fw-switch"><WlcToggle serial={sn} enabled={wlcOn} /><span className="secondary">{wlcOn ? (padLoad(e.wlc_status) === true ? 'On · load' : 'On') : 'Off'}</span></span></td>
    </tr>
  )
}

export function FwTestsToday({ fleet }) {
  const tests = useSyncExternalStore(subscribeFw, getFw, getFw)
  const now = Date.now()
  const live = tests.filter(t => t.startedAt <= now && t.endedAt == null)
  return live.map(t => (
    <Card key={t.id} title={t.name} sub={`${t.serials.length} devices · since ${date(t.startedAt)} · not part of today's cycle`}>
      <About t={t} />
      <div className="scroll-x">
        <SortTable caption={t.name} head={[{ label: 'Device' }, { label: 'State' }, { label: 'Battery', className: 'r' }, { label: 'Off charger', className: 'r' },
          { label: 'Drain with WLC', className: 'r' }, { label: 'Drain without WLC', className: 'r' }, { label: 'Cycles', className: 'r' }, { label: 'Device temp now', className: 'r' },
          { label: 'Peak device temp', className: 'r' }, { label: `≥${TEMP_LIMIT} °C`, className: 'r' }, { label: 'Firmware now', className: 'r' }, { label: 'Last seen', className: 'r' },
          { label: 'App', sortable: false }, { label: 'WLC', sortable: false }]}>
          {[...t.serials].sort(byBenchOrder).map(sn => fwRow(sn, fleet))}
        </SortTable>
      </div>
    </Card>
  ))
}

function FwForm({ DEV, test, onDone }) {
  const [f, setF] = useState(() => ({ name: test?.name || '', firmware: test?.firmware || '', tested: test?.tested || '', why: test?.why || '', result: test?.result || '',
    day: dayInput(test?.startedAt ?? Date.now()), serials: new Set(test?.serials || []) }))
  const [err, setErr] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const all = useMemo(() => [...new Set([...DEV.map(d => d.serial), ...(test?.serials || [])])].sort(byBenchOrder), [DEV, test])
  const flip = s => { const n = new Set(f.serials); n.has(s) ? n.delete(s) : n.add(s); setF({ ...f, serials: n }) }
  const ok = f.name.trim() && f.serials.size && f.day
  const save = async () => {
    const body = { name: f.name, firmware: f.firmware, tested: f.tested, why: f.why, result: f.result, serials: [...f.serials], startedAt: dayMs(f.day) }
    const j = await saveFw(test ? { edit: test.id, ...body } : { add: { ...body, by: by() } })
    if (j.ok) onDone(); else setErr(j.error || `HTTP ${j.http}`)
  }
  return (
    <div className="fw-form">
      <label>Name<input className="input" value={f.name} onChange={set('name')} /></label>
      <label>Firmware<input className="input" value={f.firmware} onChange={set('firmware')} placeholder="version" /></label>
      <label>Started<input className="input" type="date" value={f.day} onChange={set('day')} /></label>
      <label className="fw-wide">Part tested<textarea className="input" rows={2} value={f.tested} onChange={set('tested')} /></label>
      <label className="fw-wide">Why<textarea className="input" rows={2} value={f.why} onChange={set('why')} /></label>
      <label className="fw-wide">Result<textarea className="input" rows={2} value={f.result} onChange={set('result')} /></label>
      <div className="fw-wide"><div className="fw-k">Devices ({f.serials.size})</div>
        <div className="fw-devs">{all.map(s => <label key={s} className="mono"><input type="checkbox" checked={f.serials.has(s)} onChange={() => flip(s)} /> {short(s)}</label>)}</div></div>
      {err && <div className="fw-wide hint app-all-bad" role="alert">Couldn’t save: {err}</div>}
      <div className="fw-wide" style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={!ok} onClick={save}>Save</button>
        <button type="button" className="btn btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

export function FwTestsLog({ DEV }) {
  const tests = useSyncExternalStore(subscribeFw, getFw, getFw)
  const [form, setForm] = useState(null)   // null | 'new' | a test
  const [arm, setArm] = useState(null)     // `${id}:end` / `${id}:remove`: two clicks, no pop-up
  const [err, setErr] = useState('')
  const armT = useRef(null)
  const twice = (key, act) => {
    if (arm !== key) { setArm(key); clearTimeout(armT.current); armT.current = setTimeout(() => setArm(null), 5000); return }
    setArm(null); setErr(''); saveFw(act).then(j => { if (!j.ok) setErr(j.error || `HTTP ${j.http}`) }).catch(e => setErr(e.message))
  }
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><div><h2>Firmware tests</h2>
        <div className="card-sub">Which devices tested which firmware, and what part of it</div></div>
        {!form && <button type="button" className="btn btn-sm" onClick={() => setForm('new')}>+ Add a firmware test</button>}</div>
      <div className="card-body">
        {form && <FwForm key={form === 'new' ? 'new' : form.id} DEV={DEV} test={form === 'new' ? null : form} onDone={() => setForm(null)} />}
        {err && <div className="hint app-all-bad" role="alert">Couldn’t save: {err}</div>}
        {!tests.length && !form && <p className="secondary">No firmware test recorded yet.</p>}
        <div className="fw-list">
          {tests.map(t => (
            <div key={t.id} className="fw-item">
              <div className="fw-head"><b>{t.name}</b>
                <span className="secondary"> · {date(t.startedAt)} → {t.endedAt ? date(t.endedAt) : 'running'}</span>
                <span className="device-note-tools">
                  <button type="button" className="link-btn" onClick={() => setForm(t)}>✎ edit</button>
                  {!t.endedAt && <button type="button" className="link-btn" onClick={() => twice(`${t.id}:end`, { edit: t.id, endedAt: Date.now() })}>{arm === `${t.id}:end` ? 'Click again: devices go back to the bench' : 'End test'}</button>}
                  <button type="button" className="link-btn" onClick={() => twice(`${t.id}:remove`, { remove: t.id })}>{arm === `${t.id}:remove` ? 'Click again to remove' : 'Remove'}</button>
                </span></div>
              <About t={t} />
              <div className="fw-devs-list"><span className="fw-k">Devices ({t.serials.length})</span> {[...t.serials].sort(byBenchOrder).map(s => <a key={s} className="link-btn mono" href={devHref(s)}>{short(s)}</a>)}</div>
            </div>))}
        </div>
      </div>
    </div>
  )
}
