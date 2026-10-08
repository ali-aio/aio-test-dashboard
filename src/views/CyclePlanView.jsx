import React, { useEffect, useState } from 'react'
import {
  TEST_TYPES, testType, ttSlot, loadDecls, saveDecls, loadRota, saveRota, newDecl,
  resolveDay, STATUS, groupSerials, monthGrid, dayKey, todayKey, timeOn, WEEKDAYS, monthLabel, dayLabel,
} from '../lib/plan.js'
import { GROUP } from '../lib/fleet.js'
import { TEMP_LIMIT } from '../lib/profile.js'
import { fmtDur, rt } from '../lib/cycles.js'
import { hm, day } from '../lib/format.js'

// This screen IS the test-type column. Declare a date window, a device group and a test
// type, and every MDM row inside that window is stamped with it. See src/lib/plan.js for
// the resolution order (declaration > weekly rota > inferred > unclassified).
export default function CyclePlanView({ fleet, inspect }) {
  const { DEV, allCycles } = fleet
  const [decls, setDecls] = useState(() => loadDecls(GROUP))
  const [rota, setRota] = useState(() => loadRota(GROUP))
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [sel, setSel] = useState(todayKey())
  const [form, setForm] = useState(null)
  const [showRota, setShowRota] = useState(false)

  const ranOn = key => allCycles.filter(c => dayKey(c.end) === key).length
  const resolve = key => {
    const r = resolveDay(key, { decls, rota, ran: ranOn(key), devices: DEV.length })
    const src = r.decl || r.rota || null
    return { ...r, tt: testType(r.testType), src, serials: groupSerials(src && src.group, DEV),
      startMs: timeOn(key, src && src.startTime), endMs: timeOn(key, src && src.endTime, true) }
  }
  const cells = monthGrid(ym.y, ym.m).map(c => ({ ...c, r: resolve(c.key) }))
  const S = resolve(sel)
  const selRan = allCycles.filter(c => dayKey(c.end) === sel)
  const inMonth = cells.filter(c => c.inMonth)
  const counts = inMonth.reduce((a, c) => { a[c.r.status] = (a[c.r.status] || 0) + 1; return a }, {})

  useEffect(() => { inspect(<PlanInspector ym={ym} counts={counts} inMonth={inMonth} />) },
    [ym.y, ym.m, decls, rota, allCycles.length])

  const commit = next => { saveDecls(GROUP, next); setDecls(loadDecls(GROUP)) }
  const openForm = id => {
    const d = id && decls.find(x => x.id === id)
    let by = ''; try { by = localStorage.getItem('declaredBy') || '' } catch (e) {}
    setForm(d ? { ...d } : { testType: TEST_TYPES[0].id, from: sel, to: sel, group: { kind: 'all' }, startTime: '07:00', endTime: '19:00', repeat: 'none', by })
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Cycle plan</h1>
          <div className="sub" style={{ maxWidth: 620 }}>This screen <i>is</i> the test-type column. Declare once — a date, a device group, a test type — and every MDM row that arrives inside that window is stamped on the way in. No import step, no filename convention, nothing to remember at the end of a run.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setShowRota(v => !v)}>Weekly rota…</button>
          <button className="btn primary" onClick={() => openForm(null)}>+ Declare a cycle</button>
        </div>
      </div>

      <div className="cols-plan">
        <div className="panel">
          <div className="panel-head">
            <b>{monthLabel(ym.y, ym.m)}</b>
            <div className="cal-legend">
              <span><i className="declared" />Declared</span><span><i className="confirmed" />Confirmed</span>
              <span><i className="inferred" />Inferred</span><span><i className="unclassified" />Unclassified</span>
            </div>
            <div className="cal-nav">
              <button aria-label="Previous month" onClick={() => { const d = new Date(ym.y, ym.m - 1, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }) }}>‹</button>
              <button onClick={() => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }); setSel(todayKey()) }}>Today</button>
              <button aria-label="Next month" onClick={() => { const d = new Date(ym.y, ym.m + 1, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }) }}>›</button>
            </div>
          </div>
          <div className="panel-body">
            <div className="cal-dow">{WEEKDAYS.map(d => <span key={d}>{d.toUpperCase()}</span>)}</div>
            <div className="cal-grid">
              {cells.map(c => {
                const r = c.r, future = c.key >= todayKey()
                return (
                  <button key={c.key} className={`cal-day ${c.inMonth ? '' : 'out'} ${c.isToday ? 'today' : ''} ${c.key === sel ? 'sel' : ''}`}
                    title={`${dayLabel(c.key)} · ${STATUS[r.status].label}`}
                    onClick={() => { setSel(c.key); if (form) setForm(f => ({ ...f, from: c.key, to: c.key })) }}>
                    <span className="dnum">{c.dayNum}{c.isToday ? <span className="tdy">TODAY</span> : null}</span>
                    {r.tt ? <><Chip r={r} /><span className="tname">{r.tt.name}</span><span className="tdev">{r.serials.length} devices</span></>
                      : r.status === 'inferred' ? <><Chip r={r} /><span className="tname">Untyped run</span><span className="tdev">{r.ran} cycle{r.ran === 1 ? '' : 's'}</span></>
                      : c.inMonth ? <span className="declare">{future ? '+ declare' : 'no run'}</span> : null}
                  </button>
                )
              })}
            </div>
            <div className="callout" style={{ marginTop: 12 }}>
              <div><b>Read the month left to right and you can see the whole problem.</b>{' '}
                {counts.inferred || counts.confirmed ? `This month carries ${counts.confirmed || 0} confirmed and ${counts.inferred || 0} inferred — history recovered after the fact. ` : ''}
                The goal is a calendar with no <b>▨ Inferred</b> and no <b>○ Unclassified</b> in it: declared before the data exists.</div>
            </div>
          </div>
        </div>

        <div className="stack">
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

          <div className="panel">
            <div className="panel-head"><h2>{dayLabel(sel)}</h2>
              <span className={`badge ${{ declared: 'b-run', confirmed: 'b-ok', inferred: 'b-warn', unclassified: 'b-off', none: 'b-off' }[S.status]}`}>{STATUS[S.status].glyph} {STATUS[S.status].label}</span></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Test type</dt><dd>{S.tt ? <><Chip r={S} /> {S.tt.name}</> : <span className="muted">none declared</span>}</dd>
                <dt>Source</dt><dd>{S.source === 'declared' ? 'Explicit declaration' : S.source === 'rota' ? 'Standing weekly rota' : S.source === 'telemetry' ? 'Telemetry only' : <span className="muted">—</span>}</dd>
                <dt>Devices</dt><dd className="num">{S.tt ? S.serials.length : '—'}</dd>
                <dt>Window</dt><dd className="num">{S.tt ? `${hm(S.startMs)}–${hm(S.endMs)}` : '—'}</dd>
                <dt>Cycles counted</dt><dd className="num">{S.ran}</dd>
              </dl>
              <div className="acts">
                {S.decl
                  ? <><button className="btn" onClick={() => openForm(S.decl.id)}>Edit</button>
                      <button className="btn" onClick={() => { if (confirm('Delete this declaration? The day falls back to the rota, or to Unclassified.')) commit(decls.filter(d => d.id !== S.decl.id)) }}>Delete</button></>
                  : <button className="btn primary" onClick={() => openForm(null)}>Declare this day</button>}
              </div>
            </div>
          </div>

          {showRota && (
            <div className="panel">
              <div className="panel-head"><h2>Standing weekly rota</h2><span className="muted">applied where no day overrides it</span></div>
              {WEEKDAYS.map((d, i) => (
                <div className="rota-row" key={d}>
                  <span className="d">{d}</span>
                  <span className="ver" style={{ display: 'block' }}>
                    <select value={rota[i]?.testType || ''} className={rota[i]?.testType ? '' : 'none'} style={{ width: '100%' }}
                      onChange={e => { const next = { ...rota }; if (e.target.value) next[i] = { testType: e.target.value }; else delete next[i]; saveRota(GROUP, next); setRota(next) }}>
                      <option value="">— no standing test —</option>
                      {TEST_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </span>
                  <span className="muted num">{rota[i]?.testType ? DEV.length : ''}</span>
                </div>
              ))}
              <div className="panel-body"><div className="help">A weekday with a standing test needs no daily declaration — the calendar shows it as Declared, and any explicit declaration for a date beats it.</div></div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head"><h2>What actually ran</h2><span className="muted">counted cycles ending on this day</span></div>
            {selRan.length ? (
              <div className="scroll-x"><table>
                <thead><tr><th>Device</th><th>Kind</th><th className="r">Runtime</th><th className="r">Drain</th><th className="r">Peak</th><th className="r">Ended</th></tr></thead>
                <tbody>{selRan.slice().sort((a, b) => a.end - b.end).map((c, i) => {
                  const d = DEV.find(x => x.cycles.includes(c))
                  return <tr className="row" key={i}>
                    <td className="mono">{d ? d.serial : '—'}</td>
                    <td><span className={`badge ${c.reason === 'died' ? 'b-ok' : 'b-run'}`}>{c.reason === 'died' ? 'Run-down' : 'Timed'}</span></td>
                    <td className="r num">{fmtDur(rt(c))}</td>
                    <td className="r num">{c.startPct}→{c.endPct}%</td>
                    <td className="r num" style={{ color: c.maxTemp >= TEMP_LIMIT ? 'var(--bad)' : 'inherit' }}>{c.maxTemp != null ? c.maxTemp.toFixed(1) + '°' : '—'}</td>
                    <td className="r muted">{hm(c.end)}</td>
                  </tr>
                })}</tbody>
              </table></div>
            ) : <div className="empty">No counted cycle ended on this day.</div>}
          </div>
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
    <div className="panel">
      <div className="panel-head"><h2>{editing ? 'Edit declaration' : 'Declare a cycle'}</h2><button className="btn" onClick={onCancel}>Cancel</button></div>
      <div className="panel-body">
        <div className="field"><label htmlFor="f-type">Test type</label>
          <span className="ver" style={{ display: 'block' }}>
            <select id="f-type" style={{ width: '100%' }} value={form.testType} onChange={e => set('testType', e.target.value)}>
              {TEST_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></span></div>
        <div className="cols-2">
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
        <div className="cols-2">
          <div className="field"><label htmlFor="f-start">Starts</label><input className="input" id="f-start" type="time" value={form.startTime || ''} onChange={e => set('startTime', e.target.value)} /></div>
          <div className="field"><label htmlFor="f-end">Ends</label><input className="input" id="f-end" type="time" value={form.endTime || ''} onChange={e => set('endTime', e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="f-repeat">Repeat</label>
          <span className="ver" style={{ display: 'block' }}>
            <select id="f-repeat" style={{ width: '100%' }} value={form.repeat || 'none'} onChange={e => set('repeat', e.target.value)}>
              <option value="none">Does not repeat</option><option value="weekly">Weekly, same weekday</option>
            </select></span></div>
        <div className="field"><label htmlFor="f-by">Declared by</label><input className="input" id="f-by" value={form.by || ''} placeholder="optional" onChange={e => set('by', e.target.value)} /></div>
        <div className="help" style={{ marginBottom: 10 }}>Rows outside the window fall through to the next rule, or to Unclassified. The window is deliberately generous — a run that starts late is still the declared test.</div>
        <button className="btn primary" style={{ width: '100%' }} disabled={!form.from} onClick={() => onSave({ ...form, to: form.to || form.from })}>{editing ? 'Save declaration' : 'Declare'}</button>
      </div>
    </div>
  )
}

function PlanInspector({ ym, counts, inMonth }) {
  const typed = inMonth.filter(c => c.r.tt).length
  const upcoming = inMonth.filter(c => c.key >= todayKey() && c.r.tt).slice(0, 5)
  return <>
    <h3>Cycle plan</h3>
    <div className="isub">{monthLabel(ym.y, ym.m)} · {GROUP}</div>
    <div className="big num">{inMonth.length ? Math.round(typed / inMonth.length * 100) : 0}%<small>of days carry a test type</small></div>
    <hr /><h4>This month</h4>
    <dl className="kv">
      <dt>◆ Declared</dt><dd className="num">{counts.declared || 0}</dd>
      <dt>● Confirmed</dt><dd className="num" style={{ color: 'var(--ok)' }}>{counts.confirmed || 0}</dd>
      <dt>▨ Inferred</dt><dd className="num" style={{ color: counts.inferred ? 'var(--warn)' : 'inherit' }}>{counts.inferred || 0}</dd>
      <dt>○ Unclassified</dt><dd className="num">{counts.unclassified || 0}</dd>
    </dl>
    {upcoming.length ? <><hr /><h4>Coming up</h4>
      {upcoming.map(c => <div className="list-item" key={c.key} style={{ paddingLeft: 0, paddingRight: 0 }}>
        <Chip r={c.r} /><span className="grow">{c.r.tt.name}</span><span className="muted">{day(c.date)}</span></div>)}
    </> : null}
    <div className="help">Inferred means telemetry found a run nobody declared — open that day and declare it to turn it into Confirmed.</div>
  </>
}
