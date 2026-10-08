import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SortTable } from '../components/SortTable.jsx'
import {
  TEST_TYPES, testType, ttSlot, loadDecls, saveDecls, loadRota, saveRota, newDecl,
  resolveDay, STATUS, groupSerials, monthGrid, dayKey, todayKey, timeOn, windowOn, WEEKDAYS, monthLabel, dayLabel,
} from '../lib/plan.js'
import { GROUP } from '../lib/fleet.js'
import { splitText } from '../lib/splitCycles.js'
import { mdmCyclesFor } from '../lib/mdmTrack.js'
import { TEMP_LIMIT } from '../lib/profile.js'
import { fmtDur, rt } from '../lib/cycles.js'
import { hm, day } from '../lib/format.js'

// This screen IS the test-type column. Declare a date window, a device group and a test
// type, and every MDM row inside that window is stamped with it. See src/lib/plan.js for
// the resolution order (declaration > weekly rota > inferred > unclassified).
export default function CyclePlanView({ fleet }) {
  const { DEV, allCycles } = fleet
  const [decls, setDecls] = useState(() => loadDecls(GROUP))
  const [rota, setRota] = useState(() => loadRota(GROUP))
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [sel, setSel] = useState(todayKey())
  // the calendar icon: a native date picker, so any month or day is one pick away
  const jumpRef = useRef(null)
  const jumpTo = (key) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return; const [y, m] = key.split('-').map(Number); setYm({ y, m: m - 1 }); setSel(key); setForm(null) }
  const openJump = () => { const el = jumpRef.current; if (!el) return; try { el.showPicker() } catch (e) { el.focus(); el.click() } }
  const [form, setForm] = useState(null)

  // a run belongs to the day it started, even when it finishes after midnight
  const ranOn = key => allCycles.filter(c => dayKey(c.start) === key).length
  // A day's amount: the MDM's recorded counter across its runs when every run is covered,
  // else the run count (src/lib/splitCycles.js). The run count above only decides
  // Confirmed / Inferred.
  const serialOf = useMemo(() => { const m = new Map(); for (const d of DEV) for (const c of d.cycles) m.set(c, d.serial); return m }, [DEV, allCycles])
  const amountOn = key => splitText(allCycles.filter(c => dayKey(c.start) === key)
    .map(c => ({ mdmCycles: mdmCyclesFor(fleet.readings, serialOf.get(c), c.start, c.end) })))
  const resolve = key => {
    const r = resolveDay(key, { decls, rota, ran: ranOn(key), devices: DEV.length })
    const src = r.decl || r.rota || null
    return { ...r, tt: testType(r.testType), src, serials: groupSerials(src && src.group, DEV),
      ...windowOn(key, src) }
  }
  const cells = monthGrid(ym.y, ym.m).map(c => ({ ...c, r: resolve(c.key) }))
  const S = resolve(sel)
  const selRan = allCycles.filter(c => dayKey(c.start) === sel)
  const inMonth = cells.filter(c => c.inMonth)
  const counts = inMonth.reduce((a, c) => { a[c.r.status] = (a[c.r.status] || 0) + 1; return a }, {})

  const commit = next => { saveDecls(GROUP, next); setDecls(loadDecls(GROUP)) }
  const openForm = (id, day = sel) => {
    const d = id && decls.find(x => x.id === id)
    let by = ''; try { by = localStorage.getItem('declaredBy') || '' } catch (e) {}
    setForm(d ? { ...d } : { testType: TEST_TYPES[0].id, from: day, to: day, group: { kind: 'all' }, startTime: '07:00', endTime: '19:00', repeat: 'none', by })
  }

  return (
    <div className="view-stack">
      <div className="view-head">
        <div><h1>Cycle plan</h1>
        </div>
      </div>

      {!decls.length && !Object.keys(rota).length && (
        <div className="banner banner-warn">
          <span aria-hidden="true">◆</span>
          <div><strong>No test types are set up yet, so no run has a test type yet.</strong>
            <div>The MDM never says which test a run was — this screen does. Pick a day on the calendar
              and set which test ran on it.</div></div>
        </div>
      )}

      <div className="cols-plan">
        <div className="card">
          <div className="card-head">
            <b>{monthLabel(ym.y, ym.m)}</b>
            <div className="plan-legend">
              <span><i className="declared" />Planned</span><span><i className="confirmed" />Planned &amp; ran</span>
              <span><i className="inferred" />Ran, no test set</span><span><i className="unclassified" />No test, no run</span>
            </div>
            <div className="plan-nav">
              <button aria-label="Previous month" onClick={() => { const d = new Date(ym.y, ym.m - 1, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }) }}>‹</button>
              <button onClick={() => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }); setSel(todayKey()); setForm(null) }}>Today</button>
              <button aria-label="Next month" onClick={() => { const d = new Date(ym.y, ym.m + 1, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }) }}>›</button>
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button aria-label="Go to a date" title="Go to a month or date" onClick={openJump}>
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
                    <rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    <rect x="4" y="9" width="2.5" height="2.5" rx=".5" fill="currentColor" />
                  </svg>
                </button>
                <input ref={jumpRef} type="date" value={sel} onChange={e => jumpTo(e.target.value)} tabIndex={-1} aria-hidden="true"
                  style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%' }} />
              </span>
            </div>
          </div>
          <div className="card-body">
            <div className="plan-dow">{WEEKDAYS.map(d => <span key={d}>{d.toUpperCase()}</span>)}</div>
            <div className="plan-grid">
              {cells.map(c => {
                const r = c.r, future = c.key >= todayKey()
                return (
                  <button key={c.key} className={`plan-day ${c.inMonth ? '' : 'out'} ${c.isToday ? 'today' : ''} ${c.key === sel ? 'sel' : ''}`}
                    title={`${dayLabel(c.key)} · ${STATUS[r.status].label}`}
                    // One rule: a click selects the day and drops any half-filled form. Only an
                    // empty day from today on (the "+ set test" cells) goes straight to the form.
                    onClick={() => {
                      setSel(c.key)
                      if (!r.tt && future && c.inMonth) openForm(null, c.key)
                      else setForm(null)
                    }}>
                    <span className="dnum">{c.dayNum}{c.isToday ? <span className="tdy">TODAY</span> : null}</span>
                    {r.tt ? <><Chip r={r} /><span className="tname">{r.tt.name}</span><span className="tdev">{r.serials.length} devices</span></>
                      : r.status === 'inferred' ? <><Chip r={r} /><span className="tname">No test set</span><span className="tdev">{amountOn(c.key)}</span></>
                      : c.inMonth ? <span className="declare">{future ? '+ set test' : 'no run'}</span> : null}
                  </button>
                )
              })}
            </div>
            <div className="banner" style={{ marginTop: 12 }}>
              <div><b>This month at a glance.</b>{' '}
                {counts.inferred || counts.confirmed ? `${counts.confirmed || 0} day${counts.confirmed === 1 ? '' : 's'} planned & ran, ${counts.inferred || 0} ran with no test set. ` : ''}
                The goal is a calendar with no <b>▨ Ran, no test set</b> and no <b>○ No test, no run</b> in it: every test set before it runs.</div>
            </div>
          </div>
        </div>

        <div className="view-stack">
          <MonthSummary ym={ym} counts={counts} inMonth={inMonth} />

          {form && <DeclForm form={form} setForm={setForm} DEV={DEV} decls={decls}
            onCancel={() => setForm(null)}
            onSave={next => {
              try { localStorage.setItem('declaredBy', next.by || '') } catch (e) {}
              const existing = decls.find(d => d.id === form.id)
              const updated = existing ? decls.map(d => d.id === form.id ? { ...d, ...next } : d) : [...decls, newDecl(decls, next)]
              commit(updated)
              const [y, m] = next.from.split('-').map(Number)
              setYm({ y, m: m - 1 }); setSel(next.from); setForm(null)
            }} />}

          {!form && <div className="card">
            <div className="card-head"><h2>{dayLabel(sel)}</h2>
              <span className={`pill ${{ declared: 'pill-run', confirmed: 'pill-ok', inferred: 'pill-warn', unclassified: '', none: '' }[S.status]}`}>{STATUS[S.status].label}</span></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Test type</dt><dd>{S.tt ? <><Chip r={S} /> {S.tt.name}</> : <span className="secondary">none set</span>}</dd>
                <dt>Source</dt><dd>{S.source === 'declared' ? 'Explicit declaration' : S.source === 'rota' ? 'Standing weekly rota' : S.source === 'telemetry' ? 'Telemetry only' : <span className="secondary">—</span>}</dd>
                <dt>Devices</dt><dd className="mono">{S.tt ? S.serials.length : '—'}</dd>
                <dt>Window</dt><dd className="mono">{S.tt ? `${hm(S.startMs)}–${hm(S.endMs)}${S.overnight ? ' next day' : ''}` : '—'}</dd>
                <dt>Cycles (MDM) or runs</dt><dd className="mono">{selRan.length ? amountOn(sel) : '—'}</dd>
              </dl>
              <div className="acts">
                {S.decl
                  ? <><button className="btn" onClick={() => openForm(S.decl.id)}>Edit</button>
                      <button className="btn" onClick={() => { if (confirm('Remove the test set for this day? It goes back to having no test set.')) commit(decls.filter(d => d.id !== S.decl.id)) }}>Delete</button></>
                  : <button className="btn btn-primary" onClick={() => openForm(null)}>+ Set a test for this day</button>}
              </div>
            </div>
          </div>}

        </div>
      </div>
    </div>
  )
}

const Chip = ({ r }) => r.tt
  ? <span className="tt-chip" style={{ '--tt': `var(--tt-${ttSlot(r.tt.id)})` }}>{r.tt.code}<span className="g">{STATUS[r.status].glyph}</span></span>
  : r.status === 'inferred' ? <span className="tt-chip inferred">?<span className="g">▨</span></span> : null

function DeclForm({ form, setForm, DEV, decls, onCancel, onSave }) {
  const editing = decls.some(d => d.id === form.id)
  const groups = [...new Set(DEV.flatMap(d => d.snap?.groups || []))].sort()
  const gv = form.group?.kind === 'group' ? `group:${form.group.name}` : 'all'
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div className="card">
      <div className="card-head"><div><h2>{editing ? 'Edit the test' : 'Set a test'}</h2><div className="card-sub">{form.from ? (form.to && form.to !== form.from ? `${dayLabel(form.from)} to ${dayLabel(form.to)}` : dayLabel(form.from)) : 'pick a date'}</div></div>
        <button className="rp-x" aria-label="Close" title="Close" style={{ marginLeft: 'auto' }} onClick={onCancel}>×</button></div>
      <div className="card-body">
        <div className="field"><label htmlFor="f-type">Test type</label>
          <span className="ver" style={{ display: 'block' }}>
            <select id="f-type" style={{ width: '100%' }} value={form.testType} onChange={e => set('testType', e.target.value)}>
              {TEST_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></span></div>
        <div className="grid grid-2">
          <div className="field"><label htmlFor="f-from">From</label><input className="input" id="f-from" type="date" value={form.from} onChange={e => set('from', e.target.value)} /></div>
          <div className="field"><label htmlFor="f-to">To</label><input className="input" id="f-to" type="date" value={form.to || form.from} onChange={e => set('to', e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="f-group">Device group</label>
          <span className="ver" style={{ display: 'block' }}>
            <select id="f-group" style={{ width: '100%' }} value={gv}
              onChange={e => set('group', e.target.value === 'all' ? { kind: 'all' } : { kind: 'group', name: e.target.value.slice(6) })}>
              <option value="all">All devices ({DEV.length})</option>
              {groups.map(g => <option key={g} value={`group:${g}`}>{g} ({DEV.filter(d => (d.snap?.groups || []).includes(g)).length})</option>)}
            </select></span></div>
        <div className="grid grid-2">
          <div className="field"><label htmlFor="f-start">Starts</label><input className="input" id="f-start" type="time" value={form.startTime || ''} onChange={e => set('startTime', e.target.value)} /></div>
          <div className="field"><label htmlFor="f-end">Ends{form.startTime && form.endTime && form.endTime <= form.startTime ? <span className="secondary" style={{ fontWeight: 400 }}> · next day</span> : null}</label><input className="input" id="f-end" type="time" value={form.endTime || ''} onChange={e => set('endTime', e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="f-repeat">Repeat</label>
          <span className="ver" style={{ display: 'block' }}>
            <select id="f-repeat" style={{ width: '100%' }} value={form.repeat || 'none'} onChange={e => set('repeat', e.target.value)}>
              <option value="none">Does not repeat</option><option value="weekly">Weekly, same weekday</option>
            </select></span></div>
        <div className="field"><label htmlFor="f-by">Set by</label><input className="input" id="f-by" value={form.by || ''} placeholder="optional" onChange={e => set('by', e.target.value)} /></div>
        <div className="help" style={{ marginBottom: 12 }}>A run belongs to the day it starts. An end time earlier than the start means the next morning (e.g. 10:00 AM → 04:00 AM), so a late run that finishes after midnight still counts here. Runs starting outside the window count as having no test set.</div>
        <div className="form-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.from} onClick={() => onSave({ ...form, to: form.to || form.from })}>{editing ? 'Save changes' : 'Save test'}</button>
        </div>
      </div>
    </div>
  )
}

function MonthSummary({ ym, counts, inMonth }) {
  const typed = inMonth.filter(c => c.r.tt).length
  const upcoming = inMonth.filter(c => c.key >= todayKey() && c.r.tt).slice(0, 5)
  return (
    <div className="card">
      <div className="card-head"><h3>{monthLabel(ym.y, ym.m)}</h3><span className="card-sub">{GROUP}</span></div>
      <div className="card-body">
        <div className="big num">{inMonth.length ? Math.round(typed / inMonth.length * 100) : 0}%<small>of days have a test set</small></div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>◆ Planned</dt><dd>{counts.declared || 0}</dd>
          <dt>● Planned &amp; ran</dt><dd style={{ color: 'var(--status-good)' }}>{counts.confirmed || 0}</dd>
          <dt>▨ Ran, no test set</dt><dd style={{ color: counts.inferred ? 'var(--status-warning)' : 'inherit' }}>{counts.inferred || 0}</dd>
          <dt>○ No test, no run</dt><dd>{counts.unclassified || 0}</dd>
        </dl>
        {upcoming.length ? (
          <div style={{ marginTop: 14 }}>
            <div className="stat-label" style={{ marginBottom: 6 }}>Coming up</div>
            {upcoming.map(c => (
              <div className="row-item" key={c.key} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <Chip r={c.r} /><span className="grow">{c.r.tt.name}</span><span className="secondary">{day(c.date)}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="help">“Ran, no test set” means the devices ran but nobody said which test — open that day and set its test to turn it into “Planned & ran”.</div>
      </div>
    </div>
  )
}
