import React, { useMemo, useState, useEffect, useRef } from 'react'
import { Card, EmptyNote, Segmented } from '../components/Primitives.jsx'
import { LineChart, GroupedColumns } from '../components/t7charts.jsx'
import { compareBy, avgCurveBy, maxOf, explainEmpty, plottedMaxHour } from '../lib/t7cycles.js'
import { buildColorMap, MAX_SERIES, SERIES_VARS, BUILD_COLOR } from '../lib/palette.js'
import {
  fmtInt, fmtPct, fmtHours, fmtTemp, fmtRate, fmtHourTick,
} from '../lib/fmt.js'

const DIMENSIONS = [
  { id: 'firmware', label: 'Firmware' },
  { id: 'build', label: 'Build' },
  { id: 'serial', label: 'Device' },
]

/** What a group of this dimension is called when there are several of them. */
const GROUP_PLURAL = {
  firmware: 'firmware versions',
  build: 'builds',
  serial: 'devices',
}

/** How many groups to put side by side before the reader picks for themselves. */
export const DEFAULT_GROUPS = 4

/**
 * Which table columns have a good end, and which way it points. Counts are
 * left out: more cycles is not better, it is just more.
 */
const RANKED = [
  { col: 'dur', field: 'avgDuration', better: 'up' },
  { col: 'drain', field: 'avgDropPerHr', better: 'down', abs: true },
  { col: 'end', field: 'avgEndBattery', better: 'up' },
  { col: 'temp', field: 'avgPeakTemp', better: 'down' },
  { col: 'max', field: 'maxTemp', better: 'down' },
]

/**
 * Best and worst per column across the groups on screen. Returns nothing for a
 * column where fewer than two groups have a figure, or where they all match —
 * marking a winner among identical values invents a difference.
 */
export function rankColumns(groups, chargingOnly) {
  const out = {}
  for (const r of RANKED) {
    /* Take the magnitude only after the null check — Math.abs(null) is 0, and a
       group with no figure would otherwise score as zero and win the column. */
    const scored = groups
      .map((g) => ({ label: g.label, v: g[r.field] }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
      .map((x) => ({ label: x.label, v: r.abs ? Math.abs(x.v) : x.v }))
    if (scored.length < 2) continue

    const sorted = [...scored].sort((a, b) => a.v - b.v)
    const low = sorted[0]
    const high = sorted[sorted.length - 1]
    if (low.v === high.v) continue

    // Charging climbs the battery, so a faster rate is the good end there.
    const better = r.col === 'drain' && chargingOnly ? 'up' : r.better
    out[r.col] = better === 'up'
      ? { best: high.label, worst: low.label }
      : { best: low.label, worst: high.label }
  }
  return out
}

/**
 * Which groups actually go into the comparison.
 *
 * `picked` is null until the reader ticks something, and then it is the
 * explicit list. Every group is equal here — there is no reference column the
 * others are read against, so none has to be kept.
 */
export function visibleGroups(groups, picked, max = DEFAULT_GROUPS) {
  if (!groups.length) return []
  const wanted = picked ?? groups.slice(0, max).map((g) => g.label)
  const keep = new Set(wanted)
  const out = groups.filter((g) => keep.has(g.label))
  return out.length ? out : groups.slice(0, 1)
}

export default function ComparisonView({ cycles, testType }) {
  /* MDM field telemetry carries no firmware or build column, so defaulting to
     firmware would show a single "Unknown" group and nothing to compare. Start
     on whichever dimension the data in scope actually splits into the most
     groups — for a field-only import that lands on Device, which is the only
     axis that telemetry distinguishes. */
  const defaultDimension = useMemo(() => {
    let best = DIMENSIONS[0].id
    let bestCount = 0
    for (const d of DIMENSIONS) {
      const n = new Set(cycles.map((c) => c[d.id] ?? 'Unknown')).size
      if (n > bestCount) { bestCount = n; best = d.id }
    }
    // Device is a last resort: it always splits, but rarely answers the question.
    if (bestCount < 2) return DIMENSIONS[0].id
    return best === 'serial' && bestCount > 8 ? firstMeaningful(cycles) : best
  }, [cycles])

  const [dimension, setDimension] = useState(defaultDimension)
  const [touched, setTouched] = useState(false)
  /* null = "whatever the data suggests". Once the reader ticks a box this
     becomes an explicit list and stops following the data. */
  const [picked, setPicked] = useState(null)

  // Follow the data until the reader picks a dimension themselves.
  useEffect(() => {
    if (!touched) setDimension(defaultDimension)
  }, [defaultDimension, touched])

  // A different dimension means a different set of groups; start fresh.
  useEffect(() => { setPicked(null) }, [dimension])

  const groups = useMemo(() => compareBy(cycles, dimension), [cycles, dimension])

  /* Comparing 56 devices at once is a wall, not a comparison. With no explicit
     pick, show the best-evidenced few; the reader ticks more from there. */
  const visible = useMemo(() => visibleGroups(groups, picked), [groups, picked])

  const visibleLabels = useMemo(() => new Set(visible.map((g) => g.label)), [visible])

  const colorMap = useMemo(
    () => (dimension === 'build' ? null : buildColorMap(groups.map((g) => g.label))),
    [groups, dimension],
  )
  const colorFor = (label) =>
    (dimension === 'build' ? (BUILD_COLOR[label] ?? SERIES_VARS[groups.findIndex((g) => g.label === label) % MAX_SERIES]) : colorMap.get(label))

  /* A group whose cycles never land a reading on a whole hour has no curve to
     draw, so it drops out here — kept separate from the slice below, because a
     group missing from the chart has to be accounted for rather than vanish. */
  const drawable = useMemo(() => avgCurveBy(cycles, dimension)
    .filter((g) => visibleLabels.has(g.label)), [cycles, dimension, visibleLabels])

  const curves = useMemo(() => drawable
    .slice(0, MAX_SERIES)
    .map((g) => ({
      id: g.label,
      label: g.label.replace(' Build', ''),
      sub: `${fmtInt(g.count)} cycle${g.count === 1 ? '' : 's'}`,
      color: colorFor(g.label),
      points: g.points,
    })), [drawable, colorMap])

  const maxHour = useMemo(
    () => plottedMaxHour(cycles),
    [cycles],
  )

  if (!cycles.length) return <EmptyNote>No cycles match the current filters.</EmptyNote>
  if (groups.length < 2) {
    return (
      <EmptyNote>
        Only one {DIMENSIONS.find((d) => d.id === dimension)?.label.toLowerCase()} in scope — nothing
        to compare. Widen the filters, or pick another dimension.
      </EmptyNote>
    )
  }

  const chargingOnly = testType === 'Charging Cycle' || testType === 'Field Charging'
  const ranks = rankColumns(visible, chargingOnly)

  return (
    <div className="view-stack">
      <div className="row row-wrap" style={{ gap: 12 }}>
        <label className="filter-field">
          <span className="filter-label">Compare by</span>
          <Segmented ariaLabel="Comparison dimension" options={DIMENSIONS}
            value={dimension} onChange={(d) => { setTouched(true); setDimension(d) }} />
        </label>
        <label className="filter-field">
          <span className="filter-label">
            {DIMENSIONS.find((d) => d.id === dimension)?.label ?? 'Groups'} to compare
          </span>
          <GroupPicker groups={groups} selected={visible.map((g) => g.label)}
            onChange={setPicked} />
        </label>
        <span className="hint" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          {visible.length} of {groups.length} side by side.
        </span>
      </div>

      <Card expandable title="Mean battery curve by group"
        sub={`Mean battery at each whole hour${testType === '__all__' ? ' across every test type in scope' : ` · ${testType}`}`}>
        <LineChart
          series={curves}
          xDomain={[0, maxHour]}
          yDomain={[0, 100]}
          formatX={fmtHourTick}
          formatY={(v) => `${v}%`}
          xLabel="elapsed time"
          xUnit="h"
          height={320}
          emptyState={explainEmpty(cycles, (c) => c.series.length, 'a battery reading')}
          caption="Mean battery percentage over elapsed hours, by comparison group"
          valueLabel="mean battery"
          legendNote={[
            visible.length - drawable.length > 0
              ? `${visible.length - drawable.length} of the ${visible.length} selected ${GROUP_PLURAL[dimension]} logged no reading on a whole hour, so there is no curve to draw for them`
              : null,
            drawable.length > MAX_SERIES
              ? `+${drawable.length - MAX_SERIES} more ticked — the table below has them all`
              : null,
          ].filter(Boolean).join(' · ') || null}
        />
      </Card>

      <Card expandable title="Measures side by side"
        sub={`Average run time and ${chargingOnly ? 'charge' : 'drain'} rate for each group`}>
        <GroupedColumns
          groups={visible.map((g) => ({
            label: g.label.replace(' Build', ''),
            n: g.cycles,
            values: {
              duration: g.avgDuration == null ? null : Number(g.avgDuration.toFixed(2)),
              drain: g.avgDropPerHr == null ? null : Number(Math.abs(g.avgDropPerHr).toFixed(2)),
            },
          }))}
          measures={[
            { key: 'duration', label: 'Avg run time (h)', color: 'var(--series-1)' },
            { key: 'drain', label: chargingOnly ? 'Avg T7 charge rate (%/h)' : 'Avg T7 drain (%/h)', color: 'var(--series-2)' },
          ]}
          formatValue={(v) => `${v}`}
          xLabel={DIMENSIONS.find((d) => d.id === dimension)?.label}
          rotateLabels={groups.length > 5}
          height={280}
          emptyState={explainEmpty(cycles, 'duration', 'a run time')}
          caption={`Average run time and ${chargingOnly ? 'charge' : 'drain'} rate by comparison group`}
          tableSortable
          tableColumns={[
            { key: 'label', label: DIMENSIONS.find((d) => d.id === dimension)?.label ?? 'Group' },
            { key: 'n', label: 'Cycles' },
            { key: 'serials', label: 'Devices' },
            { key: 'dur', label: 'Avg run time', better: 'up' },
            { key: 'drain', label: chargingOnly ? 'Avg charge rate' : 'Avg drain', better: chargingOnly ? 'up' : 'down' },
            { key: 'start', label: 'Avg start' },
            { key: 'end', label: chargingOnly ? 'Avg charged to' : 'Avg end', better: 'up' },
            { key: 'temp', label: 'Avg peak temp', better: 'down' },
            { key: 'max', label: 'Max temp', better: 'down' },
          ]}
          tableNote={visible.length > 1 ? (
            <>
              Of the {visible.length} selected {GROUP_PLURAL[dimension]}, each column marks its
              best value <span className="rank-best">green</span> and its
              worst <span className="rank-worst">red</span>.
            </>
          ) : null}
          tableRows={visible.map((g) => {
            const mark = (col, text) => {
              const r = ranks[col]
              if (!r || (r.best !== g.label && r.worst !== g.label)) return text
              return (
                <span className={r.best === g.label ? 'rank-best' : 'rank-worst'}>{text}</span>
              )
            }
            return {
              /* Raw figures for sorting — the displayed cells are formatted
                 strings, and "9.1 h" against "11.6 h" does not compare. */
              sort: {
                label: g.label, n: g.cycles, serials: g.serials,
                dur: g.avgDuration,
                drain: g.avgDropPerHr == null ? null : Math.abs(g.avgDropPerHr),
                start: g.avgStartBattery, end: g.avgEndBattery,
                temp: g.avgPeakTemp, max: g.maxTemp,
              },
              label: g.label,
              n: fmtInt(g.cycles), serials: fmtInt(g.serials),
              dur: mark('dur', fmtHours(g.avgDuration)),
              drain: mark('drain', fmtRate(g.avgDropPerHr)),
              start: fmtPct(g.avgStartBattery),
              end: mark('end', fmtPct(g.avgEndBattery)),
              temp: mark('temp', fmtTemp(g.avgPeakTemp)),
              max: mark('max', fmtTemp(g.maxTemp)),
            }
          })}
        />
      </Card>
    </div>
  )
}

/** Prefer a dimension that says something about configuration over one that
 *  just enumerates hardware. */
function firstMeaningful(cycles) {
  for (const id of ['build', 'firmware']) {
    if (new Set(cycles.map((c) => c[id]).filter(Boolean)).size > 1) return id
  }
  return 'serial'
}

/* --------------------------------------------------------------- group picker */

/**
 * Tick which groups go into the comparison — two firmwares, three devices,
 * whatever the question is. All equal: untick any of them.
 */
function GroupPicker({ groups, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const chosen = new Set(selected)
  const shown = groups.filter((g) => g.label.toLowerCase().includes(query.toLowerCase()))

  const toggle = (label) => {
    const next = new Set(chosen)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    onChange([...next])
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn control-btn" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="listbox">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
          {selected.length} of {groups.length}
        </span>
        <span aria-hidden="true" className="muted">▾</span>
      </button>
      {open && (
        <div className="popover" style={{ width: 290 }}>
          {groups.length > 8 && (
            <input className="control" style={{ width: '100%', maxWidth: 'none', marginBottom: 6 }}
              placeholder="Filter…" value={query} autoFocus
              onChange={(e) => setQuery(e.target.value)} aria-label="Filter groups" />
          )}
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <button className="btn btn-sm" onClick={() => onChange(groups.map((g) => g.label))}
              disabled={selected.length === groups.length}>Select all</button>
            <button className="btn btn-sm" onClick={() => onChange([])}
              disabled={!selected.length}>Clear</button>
          </div>
          <div role="listbox" aria-multiselectable="true" style={{ maxHeight: 268, overflow: 'auto' }}>
            {shown.map((g) => (
              <label key={g.label} className="picker-row">
                <input type="checkbox" checked={chosen.has(g.label)}
                  onChange={() => toggle(g.label)} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {g.label}
                </span>
                <span className="hint mono">{g.cycles}</span>
              </label>
            ))}
            {!shown.length && <div className="hint" style={{ padding: 8 }}>Nothing matches.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
