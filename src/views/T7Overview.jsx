import { splitText, splitBy } from '../lib/splitCycles.js'
import React, { useMemo, useState } from 'react'
import { Card, Stat, EmptyNote } from '../components/Primitives.jsx'
import { LineChart } from '../components/t7charts.jsx'
import { ModeSwitch, deviceSeries, useDevicePicker } from '../components/CurveModes.jsx'
import LifetimeStat from '../components/LifetimeStat.jsx'
import TestDetailView from './TestDetailView.jsx'
import { ALL_TEST_TYPES, FIELD_TEST_TYPES } from '../lib/testtypes.js'
import { kpis, fullDischargeCycles, compareFirmwareNewest, avgCurveBy, maxOf, explainEmpty, plottedMaxHour, batteryCycles, batteryCyclesBy } from '../lib/t7cycles.js'
import { BUILD_COLOR, SERIES_VARS, MAX_SERIES } from '../lib/palette.js'
import { fmtLifetime, fmtBC, bcText, runsText, fmtInt, fmtNum, fmtHours, fmtPct, fmtTemp, fmtRate, fmtHourTick, fmtDate, compareSerial } from '../lib/fmt.js'

export default function OverviewView({ cycles, onPickTestType, onFilter, onOpenDevice, testType = '__all__', allSerials = [], lifetime = null }) {
  if (testType !== '__all__') {
    return <TestDetailView cycles={cycles} testType={testType} allSerials={allSerials} lifetime={lifetime} />
  }
  return <AllTestsOverview cycles={cycles} onPickTestType={onPickTestType} onFilter={onFilter} onOpenDevice={onOpenDevice} allSerials={allSerials} lifetime={lifetime} />
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
function AllTestsOverview({ cycles, onPickTestType, onFilter, onOpenDevice, allSerials = [], lifetime = null }) {
  const k = useMemo(() => kpis(cycles), [cycles])
  // every serial in the app, not just the filtered ones, so a device's colour never shifts
  const allSerialsHere = useMemo(() => (allSerials.length ? allSerials : [...new Set(cycles.map((c) => c.serial))]), [allSerials, cycles])
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
    // Amounts per group come from the MDM's recorded counter when every run in the group
    // is covered, else they are run counts (src/lib/splitCycles.js); bars measure runs.
    const rows = (list, onPick) => list.map((r) => ({
      id: String(r.label),
      label: String(r.label),
      value: r.value,
      display: r.display,
      onClick: onPick ? () => onPick(r.label) : undefined,
    }))

    const byDate = splitBy(cycles, 'date')
      .sort((a, b) => String(b.label).localeCompare(String(a.label)))

    return {
      testType: rows(splitBy(cycles, 'testType'), (v) => onPickTestType(v)),
      serial: rows(splitBy(cycles, 'serial')
        .sort((a, b) => compareSerial(a.label, b.label)),
        (v) => onFilter?.({ serials: [v] })),
      date: byDate.map((r) => ({
        id: String(r.label),
        label: fmtDate(r.label),
        value: r.value,
        display: r.display,
        onClick: onFilter ? () => onFilter({ date: r.label }) : undefined,
      })),
      build: rows(splitBy(cycles, 'build'), (v) => onFilter?.({ build: v })),
      firmware: rows(splitBy(cycles, 'firmware')
        .sort((a, b) => compareFirmwareNewest(a.label, b.label)),
        (v) => onFilter?.({ firmware: v })),
      os: rows(splitBy(cycles, 'android'), (v) => onFilter?.({ android: v })),
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
        // charging tests drain nothing, so their legend counts runs
        sub: tt === 'Charging Cycle' || tt === 'Field Charging' ? runsText(c.count)
          : splitText(own.filter((x) => (x[groupKey] ?? 'Unknown') === c.label)),
        color: groupKey === 'build'
          ? (BUILD_COLOR[c.label] ?? SERIES_VARS[i % MAX_SERIES])
          : SERIES_VARS[i % MAX_SERIES],
        points: c.points,
      })),
    }
  }).filter((p) => p.cycles.length), [cycles])

  // The battery-cycles tile still answers with no runs in range (e.g. "Last hour" mid-run).
  if (!cycles.length) return (
    <div className="view-stack">
      <div className="stat-row stat-row-lg"><LifetimeStat lifetime={lifetime} hero average /></div>
      <EmptyNote>No finished cycles match the current filters. A cycle is listed once it ends — the one in progress is on Today.</EmptyNote>
    </div>
  )

  return (
    <div className="view-stack">
      <div className="stat-row stat-row-lg">
            <LifetimeStat lifetime={lifetime} hero average />
            <Stat label="Total devices" value={fmtInt(k.serials)}
              breakdown={(lifetime?.rows || []).slice().sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
                .map((r) => ({ id: r.serial, label: r.serial, value: r.value ?? 0, display: fmtLifetime(r.value),
                  onClick: onFilter ? () => onFilter({ serials: [r.serial] }) : undefined }))}
              breakdownLabel={lifetime?.range ? `Battery cycles per device · ${lifetime.range}` : 'Lifetime cycles per device (MDM)'} />
            <Stat label="Test days" value={fmtInt(k.dates)}
              breakdown={breakdowns.date} breakdownLabel="Battery cycles per test day" />
            <Stat label="HW build" value={fmtInt(inv.build.values.length)}
              breakdown={breakdowns.build} breakdownLabel="Battery cycles per build" />
            <Stat label="FW version" value={fmtInt(inv.firmware.values.length)}
              breakdown={breakdowns.firmware} breakdownLabel="Battery cycles per firmware" />
            <Stat label="OS version" value={fmtInt(inv.os.values.length)}
              breakdown={breakdowns.os} breakdownLabel="Battery cycles per OS version" />
      </div>

      <div className="grid grid-2">
        {panels.map((p) => <OverviewPanel key={p.testType} p={p} allSerials={allSerialsHere} onPickTestType={onPickTestType} onOpenDevice={onOpenDevice} />)}
      </div>
    </div>
  )
}

// One test-type card. Average = T7's mean curve per pad state (or build); Every device =
// one line per device with the Devices picker, colours shared with every other chart.
function OverviewPanel({ p, allSerials, onPickTestType, onOpenDevice }) {
  const [mode, setMode] = useState('avg')
  const perDevice = useMemo(() => deviceSeries(p.cycles, allSerials), [p.cycles, allSerials])
  const picker = useDevicePicker(perDevice)
  return (
    <Card expandable
      title={p.testType}
      sub={`${p.charging ? runsText(p.cycles.length) : splitText(p.cycles)} · ${p.k.serials} devices · ${mode === 'all' ? 'one line per device' : `mean battery by ${p.groupKey === 'build' ? 'build' : 'pad state'}`}`}
      right={<>
        <ModeSwitch value={mode} onChange={setMode} />
        <button className="btn btn-sm" onClick={() => onPickTestType(p.testType)}>
          Open ›
        </button>
      </>}>
      <LineChart
        series={mode === 'all' ? perDevice : p.series}
        {...(mode === 'all' ? picker : {})}
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
          mode === 'all' ? { key: 'build', label: 'Device' } : { key: 'build', label: p.groupKey === 'build' ? 'Build' : 'Pad state' },
          { key: 'n', label: 'Cycles' },
          { key: 'dur', label: 'Avg cycle time' },
          { key: 'drop', label: p.charging ? 'Avg charge rate' : 'Avg drain' },
          { key: 'end', label: p.charging ? 'Avg charged to' : 'Avg end battery' },
          { key: 'temp', label: 'Peak temp' },
        ]}
        // Average: one row per build / pad state. Every device: one row per device ticked in
        // the Devices picker, in serial order, so the table matches the lines on the chart.
        tableRows={(mode === 'all'
          ? perDevice.map((s) => s.id).filter((sn) => !picker.selectedSeries || picker.selectedSeries.has(sn)).sort(compareSerial)
          : [...new Set(p.cycles.map((c) => c[p.groupKey]))]
        ).map((b) => {
          const own = p.cycles.filter((c) => (mode === 'all' ? c.serial : c[p.groupKey]) === b)
          const kk = kpis(own)
          return {
            // a device opens this test's page for just that device: every run, by day
            build: mode === 'all' && onOpenDevice
              ? <button type="button" className="link-btn" title={`Open ${p.testType} for ${b} — every cycle`} onClick={() => onOpenDevice(b, p.testType)}>{b}</button>
              : b ?? 'Unknown',
            n: p.charging ? runsText(kk.totalCycles) : splitText(own),
            dur: fmtHours(kk.avgDuration),
            drop: fmtRate(kk.avgDropPerHr),
            end: fmtPct(kk.avgEndBattery),
            temp: fmtTemp(maxOf(own.map((c) => c.maxTemp))),
          }
        })}
      />
    </Card>
  )
}
