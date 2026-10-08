/* One filter row, above everything it scopes. Every chart, KPI and table in
   every view re-renders against this same slice, so the numbers always agree. */

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ALL_TEST_TYPES, LOAD_TEST_TYPES } from '../lib/testtypes.js'
import { cascadeOptions, pruneFilters } from '../lib/t7cycles.js'
import { fmtDate, fmtWeek, fmtBC } from '../lib/fmt.js'
import DatePicker from './DatePicker.jsx'

export default function FilterBar({ cycles, filters, onChange, onReset, allSerials = [], declaredTypes = [] }) {
  /* Every change is pruned: narrowing one control can strand a selection
     further down the bar, and a stranded selection means an empty dashboard
     with no explanation. */
  const set = (patch) => {
    const next = pruneFilters(cycles, { ...filters, ...patch }, allSerials)
    // A test type declared on the Cycle plan stays selectable even before it has a finished
    // cycle — pruning would otherwise snap it straight back to "All tests".
    if (patch.testType && declaredTypes.includes(patch.testType)) next.testType = patch.testType
    onChange(next)
  }

  /* Each control offers only what is reachable given the controls before it. */
  const { options, dateCounts } = useMemo(
    () => cascadeOptions(cycles, filters, allSerials),
    [cycles, filters, allSerials],
  )

  const builds = options.build
  const firmwares = options.firmware
  const androids = options.android
  const weeks = options.week
  const serials = options.serials
  const dates = options.date
  const loadTypes = options.loadType
  const chargers = options.charger

  const showLoad = LOAD_TEST_TYPES.has(filters.testType) && loadTypes.length > 1
  const showCharger = filters.testType === 'Charging Cycle' && chargers.length > 1

  // Every type that has cycles in reach, plus every type declared on the Cycle plan (a day
  // or the weekly rota) — a test that is planned or running today belongs in the list
  // before its first cycle has finished.
  const availableTypes = useMemo(
    () => ALL_TEST_TYPES.filter((t) => options.testType.includes(t) || declaredTypes.includes(t)),
    [options.testType, declaredTypes.join('|')],
  )
  const typeCounts = useMemo(() => {
    const m = new Map(); for (const c of cycles) m.set(c.testType, (m.get(c.testType) || 0) + 1); return m
  }, [cycles])

  return (
    <div className="filter-bar">
      <Field label="Test type">
        <select className="control" value={filters.testType}
          onChange={(e) => set({ testType: e.target.value, loadType: '', charger: '' })}>
          <option value="__all__">All tests</option>
          {availableTypes.map((t) => <option key={t} value={t}>{t}{typeCounts.get(t) ? '' : ' — no runs yet'}</option>)}
        </select>
      </Field>

      <Field label="Build">
        <select className="control" value={filters.build} onChange={(e) => set({ build: e.target.value })}>
          <option value="">All builds</option>
          {builds.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Field>

      <Field label="Firmware">
        <select className="control" value={filters.firmware} onChange={(e) => set({ firmware: e.target.value })}>
          <option value="">All firmware</option>
          {firmwares.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>

      <Field label="OS version">
        <select className="control" value={filters.android} onChange={(e) => set({ android: e.target.value })}>
          <option value="">All OS versions</option>
          {androids.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Field>

      <Field label="Serial">
        <SerialPicker serials={serials} selected={filters.serials}
          onChange={(serialsNext) => set({ serials: serialsNext })} />
      </Field>

      {showLoad && (
        <Field label="Load">
          <select className="control" value={filters.loadType} onChange={(e) => set({ loadType: e.target.value })}>
            <option value="">All loads</option>
            {loadTypes.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
      )}

      {showCharger && (
        <Field label="Charger">
          <select className="control" value={filters.charger} onChange={(e) => set({ charger: e.target.value })}>
            <option value="">All chargers</option>
            {chargers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      )}

      {weeks.length > 1 && (
        <Field label="Batch">
          <select className="control" value={filters.week} onChange={(e) => set({ week: e.target.value })}>
            <option value="">All batches</option>
            {weeks.map((w) => <option key={w} value={w}>{fmtWeek(w)}</option>)}
          </select>
        </Field>
      )}

      <Field label="Test date">
        <DatePicker dates={dates} counts={dateCounts} value={filters.date}
          onChange={(d) => set({ date: d })} />
      </Field>

      <div className="header-spacer" />
      <button className="btn btn-sm btn-reset" onClick={onReset}>Reset filters</button>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="filter-field">
      <span className="filter-label">{label}</span>
      {children}
    </label>
  )
}

/* ------------------------------------------------------------ serial picker */

function SerialPicker({ serials, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const shown = serials.filter((s) => s.toLowerCase().includes(query.toLowerCase()))

  /* The selection is explicit: this list IS the devices on screen. Nothing
     ticked means nothing charted, and the dashboard says so rather than
     quietly showing everything — which is what made the old "Clear" read as a
     contradiction, since clearing it filled the screen with all 52. */
  /* `selected` is the whole fleet selection; `serials` is only what the
     filters above leave reachable. The counts shown have to be about the
     reachable set, or picking a build would make the label read "56 of 18". */
  const reachable = new Set(serials)
  const visible = selected.filter((sn) => reachable.has(sn))
  const everything = visible.length === serials.length && serials.length > 0
  const none = visible.length === 0
  const label = everything ? `All ${serials.length}`
    : none ? 'None'
    : visible.length === 1 ? visible[0]
    : `${visible.length} of ${serials.length}`

  const toggle = (s) =>
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s])

  /* Select all takes in everything reachable, keeping any selection upstream
     filters are currently hiding. Clear empties the selection outright: leaving
     hidden leftovers behind would make a deliberate Clear look identical to a
     selection stranded by an upstream change, and those two need opposite
     treatment. */
  const selectAll = () => onChange([...new Set([...selected, ...serials])])
  const clearVisible = () => onChange([])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`btn control-btn${everything ? '' : ' is-set'}${none ? ' is-warn' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{label}</span>
        <span aria-hidden="true" className="muted">▾</span>
      </button>
      {open && (
        <div className="popover">
          <input className="control" style={{ width: '100%', maxWidth: 'none', marginBottom: 6 }}
            placeholder="Filter serials…" value={query} autoFocus
            onChange={(e) => setQuery(e.target.value)} aria-label="Filter serials" />
          <div className={`picker-state${none ? ' is-empty' : ''}`}>
            <span>
              {none
                ? 'No devices selected — select at least one'
                : `${visible.length} of ${serials.length} device${serials.length === 1 ? '' : 's'} selected`}
            </span>
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <button className="btn btn-sm" onClick={selectAll} disabled={everything}>
              Select all
            </button>
            <button className="btn btn-sm" onClick={clearVisible} disabled={none}>
              Clear
            </button>
            {query && (
              <span className="hint">
                {shown.length} match{shown.length === 1 ? 'es' : ''}
              </span>
            )}
          </div>
          <div role="listbox" aria-multiselectable="true" style={{ maxHeight: 260, overflow: 'auto' }}>
            {shown.map((s) => (
              <label key={s} className="picker-row">
                <input type="checkbox" checked={selected.includes(s)}
                  onChange={() => toggle(s)} />
                <span className="mono">{s}</span>
              </label>
            ))}
            {!shown.length && <div className="hint" style={{ padding: 8 }}>No serials match.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- active pills */

export function FilterPills({ filters, onChange, onReset, count, allSerials = [] }) {
  const totalSerials = allSerials.length
  const chips = []
  const clear = (patch) => onChange({ ...filters, ...patch })

  if (filters.testType !== '__all__') chips.push({ k: 'tt', text: filters.testType, onX: () => clear({ testType: '__all__', loadType: '', charger: '' }) })
  if (filters.build) chips.push({ k: 'b', text: `Build: ${filters.build}`, onX: () => clear({ build: '' }) })
  if (filters.firmware) chips.push({ k: 'f', text: `Firmware: ${filters.firmware}`, onX: () => clear({ firmware: '' }) })
  if (filters.android) chips.push({ k: 'os', text: `OS: ${filters.android}`, onX: () => clear({ android: '' }) })
  // The serial pill is only news when it is a subset; "all devices" is the resting state.
  if (filters.serials.length && filters.serials.length !== totalSerials) {
    chips.push({
      k: 's',
      text: filters.serials.length === 1 ? filters.serials[0] : `${filters.serials.length} devices`,
      onX: () => clear({ serials: allSerials }),
    })
  }
  if (filters.loadType) chips.push({ k: 'l', text: `Load: ${filters.loadType}`, onX: () => clear({ loadType: '' }) })
  if (filters.charger) chips.push({ k: 'c', text: `Charger: ${filters.charger}`, onX: () => clear({ charger: '' }) })
  if (filters.week) chips.push({ k: 'w', text: `Batch: ${fmtWeek(filters.week)}`, onX: () => clear({ week: '' }) })
  if (filters.date) chips.push({ k: 'd', text: `Date: ${fmtDate(filters.date)}`, onX: () => clear({ date: '' }) })

  return (
    <div className="row row-wrap" style={{ gap: 6, minHeight: 26 }}>
      <span className="pill pill-neutral">
        <strong className="mono">{fmtBC(count)}</strong>&nbsp;cycles in scope
      </span>
      {chips.map((c) => (
        <span key={c.k} className="pill pill-filter">
          {c.text}
          <button className="pill-x" onClick={c.onX} aria-label={`Remove filter ${c.text}`}>×</button>
        </span>
      ))}
      {chips.length > 0 && (
        <button className="btn btn-sm btn-reset" onClick={onReset}>Clear all</button>
      )}
    </div>
  )
}
