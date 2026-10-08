import React, { useMemo } from 'react'
import { Card, Stat, EmptyNote } from '../components/Primitives.jsx'
import { LineChart } from '../components/t7charts.jsx'
import TestDetailView from './TestDetailView.jsx'
import { ALL_TEST_TYPES, FIELD_TEST_TYPES } from '../lib/testtypes.js'
import { kpis, fullDischargeCycles, compareFirmwareNewest, avgCurveBy, maxOf, explainEmpty, plottedMaxHour } from '../lib/t7cycles.js'
import { BUILD_COLOR, SERIES_VARS, MAX_SERIES } from '../lib/palette.js'
import { fmtInt, fmtNum, fmtHours, fmtPct, fmtTemp, fmtRate, fmtHourTick, fmtDate, compareSerial } from '../lib/fmt.js'

export default function OverviewView({ cycles, onPickTestType, onFilter, testType = '__all__', allSerials = [] }) {
  if (testType !== '__all__') {
    return <TestDetailView cycles={cycles} testType={testType} allSerials={allSerials} />
  }
  return <AllTestsOverview cycles={cycles} onPickTestType={onPickTestType} onFilter={onFilter} />
}

/** Cycle counts per distinct value of a field, biggest first. */
function countsBy(cycles, key) {
  const rows = new Map()
  for (const c of cycles) {
    const v = c[key]
    if (v == null || v === '' || v === 'Unknown') continue
    rows.set(v, (rows.get(v) ?? 0) + 1)
  }
  return [...rows.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([label, value]) => ({ label, value }))
}

/** Distinct values of a field, with the placeholders left out. */
function inventory(cycles, key) {
  const seen = new Set()
  let unlabelled = 0
  for (const c of cycles) {
    const v = c[key]
    if (v == null || v === '' || v === 'Unknown') unlabelled++
    else seen.add(v)
  }
  return { values: [...seen].sort(key === 'firmware' ? compareFirmwareNewest : undefined), unlabelled }
}

/**
 * Small multiples: one panel per test type, each showing mean battery % per
 * elapsed hour, one line per hardware build. Every panel shares the same y
 * domain (0-100%), so the panels are directly comparable.
 *
 * The stat row describes what the full dataset covers. Selecting a test type
 * switches OverviewView to the full TestDetailView above.
 */
function AllTestsOverview({ cycles, onPickTestType, onFilter }) {
  const k = useMemo(() => kpis(cycles), [cycles])
  const fullDrain = useMemo(() => fullDischargeCycles(cycles), [cycles])

  const inv = useMemo(() => ({
    build: inventory(cycles, 'build'),
    firmware: inventory(cycles, 'firmware'),
    os: inventory(cycles, 'android'),
  }), [cycles])

  /* Each headline number opens on what it is made of. Where a filter exists
     for that field, clicking a row applies it — the breakdown answers "which
     ones?" and the click acts on the answer. */
  const breakdowns = useMemo(() => {
    const rows = (list, onPick) => list.map((r) => ({
      id: String(r.label),
      label: String(r.label),
      value: r.value,
      display: fmtInt(r.value),
      onClick: onPick ? () => onPick(r.label) : undefined,
    }))

    const byDate = countsBy(cycles, 'date')
      .sort((a, b) => String(b.label).localeCompare(String(a.label)))

    return {
      testType: rows(countsBy(cycles, 'testType'), (v) => onPickTestType(v)),
      serial: rows(countsBy(cycles, 'serial')
        .sort((a, b) => compareSerial(a.label, b.label)),
        (v) => onFilter?.({ serials: [v] })),
      date: byDate.map((r) => ({
        id: String(r.label),
        label: fmtDate(r.label),
        value: r.value,
        display: fmtInt(r.value),
        onClick: onFilter ? () => onFilter({ date: r.label }) : undefined,
      })),
      build: rows(countsBy(cycles, 'build'), (v) => onFilter?.({ build: v })),
      firmware: rows(countsBy(cycles, 'firmware')
        .sort((a, b) => compareFirmwareNewest(a.label, b.label)),
        (v) => onFilter?.({ firmware: v })),
      os: rows(countsBy(cycles, 'android'), (v) => onFilter?.({ android: v })),
    }
  }, [cycles, onPickTestType, onFilter])

  const panels = useMemo(() => ALL_TEST_TYPES.map((tt) => {
    const own = cycles.filter((c) => c.testType === tt)
    // Field cycles carry no build — group those by wireless-pad state, which is
    // the dimension their data actually distinguishes.
    const groupKey = FIELD_TEST_TYPES.has(tt) ? 'padState' : 'build'
    const curves = avgCurveBy(own, groupKey)
    const maxHour = plottedMaxHour(own)
    return {
      testType: tt,
      cycles: own,
      k: kpis(own),
      maxHour: Math.ceil(maxHour),
      groupKey,
      charging: tt === 'Charging Cycle' || tt === 'Field Charging',
      series: curves.slice(0, MAX_SERIES).map((c, i) => ({
        id: `${tt}-${c.label}`,
        label: c.label.replace(' Build', ''),
        sub: `${fmtInt(c.count)} cycle${c.count === 1 ? '' : 's'}`,
        color: groupKey === 'build'
          ? (BUILD_COLOR[c.label] ?? SERIES_VARS[i % MAX_SERIES])
          : SERIES_VARS[i % MAX_SERIES],
        points: c.points,
      })),
    }
  }).filter((p) => p.cycles.length), [cycles])

  if (!cycles.length) return <EmptyNote>No cycles match the current filters.</EmptyNote>

  return (
    <div className="view-stack">
      <div className="stat-row stat-row-lg">
            <Stat label="Total cycles" value={fmtInt(k.totalCycles)} hero
              foot={<strong>Battery cycles: {fmtNum(fullDrain.cycles, 2)}</strong>}
              breakdown={breakdowns.testType} breakdownLabel="Cycles per test" />
            <Stat label="Total devices" value={fmtInt(k.serials)}
              breakdown={breakdowns.serial} breakdownLabel="Cycles per device" />
            <Stat label="Test days" value={fmtInt(k.dates)}
              breakdown={breakdowns.date} breakdownLabel="Cycles per test day" />
            <Stat label="HW build" value={fmtInt(inv.build.values.length)}
              breakdown={breakdowns.build} breakdownLabel="Cycles per build" />
            <Stat label="FW version" value={fmtInt(inv.firmware.values.length)}
              breakdown={breakdowns.firmware} breakdownLabel="Cycles per firmware" />
            <Stat label="OS version" value={fmtInt(inv.os.values.length)}
              breakdown={breakdowns.os} breakdownLabel="Cycles per OS version" />
      </div>

      <div className="grid grid-2">
        {panels.map((p) => (
          <Card expandable key={p.testType}
            title={p.testType}
            sub={`${p.cycles.length} cycle${p.cycles.length === 1 ? '' : 's'} · ${p.k.serials} devices · mean battery by ${p.groupKey === 'build' ? 'build' : 'pad state'}`}
            right={
              <button className="btn btn-sm" onClick={() => onPickTestType(p.testType)}>
                Open ›
              </button>
            }>
            <LineChart
              series={p.series}
              xDomain={[0, p.maxHour]}
              yDomain={[0, 100]}
              formatX={fmtHourTick}
              formatY={(v) => `${v}%`}
              xLabel="elapsed time"
              xUnit="h"
              height={212}
              emptyState={explainEmpty(p.cycles, (c) => c.series.length, 'a battery reading')}
              caption={`Mean battery percentage over elapsed hours for ${p.testType}`}
              tableColumns={[
                { key: 'build', label: p.groupKey === 'build' ? 'Build' : 'Pad state' },
                { key: 'n', label: 'Cycles' },
                { key: 'dur', label: 'Avg run time' },
                { key: 'drop', label: p.charging ? 'Avg charge rate' : 'Avg drain' },
                { key: 'end', label: p.charging ? 'Avg charged to' : 'Avg end battery' },
                { key: 'temp', label: 'Peak temp' },
              ]}
              tableRows={[...new Set(p.cycles.map((c) => c[p.groupKey]))].map((b) => {
                const own = p.cycles.filter((c) => c[p.groupKey] === b)
                const kk = kpis(own)
                return {
                  build: b,
                  n: fmtInt(kk.totalCycles),
                  dur: fmtHours(kk.avgDuration),
                  drop: fmtRate(kk.avgDropPerHr),
                  end: fmtPct(kk.avgEndBattery),
                  temp: fmtTemp(maxOf(own.map((c) => c.maxTemp))),
                }
              })}
            />
          </Card>
        ))}
      </div>
    </div>
  )
}
