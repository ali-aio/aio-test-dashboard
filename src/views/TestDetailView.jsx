import { splitText, splitBy } from '../lib/splitCycles.js'
import React, { useMemo, useState } from 'react'
import LifetimeStat from '../components/LifetimeStat.jsx'
import { Card, Stat, EmptyNote, Segmented } from '../components/Primitives.jsx'
import { LineChart, GroupedColumns, BarRows } from '../components/t7charts.jsx'
import { LOAD_TEST_TYPES, FIELD_TEST_TYPES, FIELD_CHARGING } from '../lib/testtypes.js'
import {
  kpis, fullDischargeCycles, batteryCycles, batteryCyclesBy, batteryBySerial, avgCurveBy, dropGainByLoadType, hourlyProfile,
  hourContributors, compareBy, mean, maxOf,
  explainEmpty, explainNoRate, plottedMaxHour } from '../lib/t7cycles.js'
import { buildColorMap, buildStyleMap, MAX_SERIES, SERIES_VARS, BUILD_COLOR, MEASURE_COLOR } from '../lib/palette.js'
import {
  fmtBC, bcText, runsText, fmtInt, fmtNum, fmtPct, fmtHours, fmtTemp, fmtRate, fmtSigned, fmtHourTick, fmtDate, fmtSerial, compareSerial,
} from '../lib/fmt.js'

const BENCH_CURVE_MODES = [
  { id: 'serial', label: 'Per device' },
  { id: 'build', label: 'Mean by build' },
  { id: 'firmware', label: 'Mean by firmware' },
]

/* Field cycles come from MDM telemetry, which carries no build or firmware
   column — pad state is the dimension that data actually distinguishes. */
const FIELD_CURVE_MODES = [
  { id: 'serial', label: 'Per device' },
  { id: 'padState', label: 'Mean by pad state' },
]

/* A device usually ran the test several times. Showing its longest run alone
   answered neither "what does this device do" nor "how consistent is it", so
   the reader says which of the two they are after. */
const DEVICE_VIEWS = [
  { id: 'average', label: 'Average per device' },
  { id: 'all', label: 'Every run' },
]

export default function TestDetailView({ cycles, testType, allSerials, lifetime = null }) {
  /* null until the reader picks one, so the default can follow the data rather
     than being baked in — a grouped mean is the first useful read, and the
     per-device tangle is a step you take once you know what to look for. */
  const [mode, setMode] = useState(null)
  const [deviceView, setDeviceView] = useState('average')
  /* Which hourly bar the reader opened, as the hour index behind it. */
  const [hourPick, setHourPick] = useState(null)
  const [deviceChoice, setDeviceChoice] = useState({ testType, selected: null })
  const [runChoice, setRunChoice] = useState({ testType, selected: null })
  const [firmwareChoice, setFirmwareChoice] = useState({ testType, selected: null })
  const k = useMemo(() => kpis(cycles), [cycles])
  const fullDrain = useMemo(() => fullDischargeCycles(cycles), [cycles])
  const isLoadTest = LOAD_TEST_TYPES.has(testType)
  const isField = FIELD_TEST_TYPES.has(testType)
  const isCharging = testType === 'Charging Cycle' || testType === FIELD_CHARGING
  const isRestaurant = testType === 'Restaurant Case'
  const showSecondaryChart = ![
    'Charging Cycle', 'Restaurant Case', 'Discharging on Ads', 'WLC+Discharge on Ads',
    'Burn-in Test', 'WLC on Load', 'WLC on Phone',
  ].includes(testType)
  const drainLabel = testType === 'Discharging on Ads'
    ? 'Avg T7 drain · without wireless'
    : testType === 'WLC+Discharge on Ads'
      ? 'Avg T7 drain · with wireless'
      : 'Avg T7 drain'

  /* Colour follows the serial across the whole app, so filtering a device out
     never repaints the others. */
  const styleMap = useMemo(() => buildStyleMap([...allSerials].sort(compareSerial)), [allSerials])

  const bySerial = useMemo(() => batteryBySerial(cycles), [cycles])
  const selectedDevices = deviceChoice.testType === testType ? deviceChoice.selected : null
  const toggleDevice = (serial) => setDeviceChoice((current) => {
    const previous = current.testType === testType ? current.selected : null
    const next = previous ? new Set(previous) : new Set(bySerial.serials)
    if (next.has(serial)) next.delete(serial)
    else next.add(serial)
    return { testType, selected: next }
  })

  const maxHour = useMemo(
    () => plottedMaxHour(cycles),
    [cycles],
  )

  const curveModes = isField ? FIELD_CURVE_MODES : BENCH_CURVE_MODES
  // Field telemetry has no build column, so pad state is its grouped mean.
  const defaultMode = isField ? 'padState' : 'build'
  const activeMode = curveModes.some((m) => m.id === mode) ? mode : defaultMode

  const curveSeries = useMemo(() => {
    if (activeMode === 'serial') {
      /* Both per-device views drop the same outliers the longest-run view did:
         one run at several times the median stretches the hour axis and
         flattens everything else into the left margin. */
      const limit = bySerial.medianDuration ? bySerial.medianDuration * 3 : null
      const inScope = cycles.filter((c) => c.series.length
        && (limit == null || c.duration == null || c.duration <= limit))

      if (deviceView === 'all') {
        /* Every run gets its own colour + dash, so runs can be told apart even when they
           all come from one device (colouring by device made them one colour). Styles
           are assigned over every run in scope, so ticking runs never restyles the rest. */
        const runStyle = buildStyleMap(inScope.map((c, i) => c.id ?? `${c.serial}-${c.date}-${i}`))
        return inScope
          .filter((c) => selectedDevices == null || selectedDevices.has(c.serial))
          .sort((a, b) => compareSerial(a.serial, b.serial)
            || String(a.date ?? '').localeCompare(String(b.date ?? '')))
          .map((c, i) => ({
            id: c.id ?? `${c.serial}-${c.date}-${i}`,
            label: `${fmtSerial(c.serial)}${c.date ? ` · ${fmtDate(c.date)}` : ''}`,
            ...(runStyle.get(c.id ?? `${c.serial}-${c.date}-${i}`) ?? { color: SERIES_VARS[i % MAX_SERIES] }),
            points: c.series,
          }))
      }
      const perDevice = avgCurveBy(inScope, 'serial')
      return perDevice.map((g, i) => ({
        id: g.label,
        label: fmtSerial(g.label),
        sub: `${fmtInt(g.count)} run${g.count === 1 ? '' : 's'}`,
        ...(styleMap.get(g.label) ?? { color: SERIES_VARS[i % MAX_SERIES] }),
        points: g.points,
      }))
    }
    const key = activeMode
    const curves = avgCurveBy(cycles, key)
    // One map for the whole group list, so a group keeps its colour when the
    // filters shrink the set — not rebuilt per row.
    const groupColors = buildColorMap(curves.map((x) => x.label))
    const plottedCurves = key === 'firmware' ? curves : curves.slice(0, MAX_SERIES)
    return plottedCurves.map((g, i) => ({
      id: g.label,
      label: g.label.replace(' Build', ''),
      sub: isCharging ? runsText(g.count) : splitText(cycles.filter((c) => (c[key] ?? 'Unknown') === g.label)),
      color: key === 'build'
        ? (BUILD_COLOR[g.label] ?? SERIES_VARS[i])
        : groupColors.get(g.label),
      points: g.points,
    }))
  }, [activeMode, deviceView, selectedDevices, bySerial, cycles, styleMap])
  // The axis ends at the furthest point actually drawn. "Every run" plots every sample,
  // not just whole hours, so sizing it like the averaged views let lines run off the edge.
  const curveMaxHour = useMemo(() => {
    let m = 0
    for (const sr of curveSeries) for (const p of sr.points) if (p.t > m) m = p.t
    return Math.max(1, Math.ceil(m || maxHour))
  }, [curveSeries, maxHour])
  /* Which tick-list the chart is showing, so the three pickers share one set
     of Select all / Clear all buttons without each testing the mode again. */
  const picker = activeMode === 'firmware' ? 'firmware'
    : activeMode === 'serial' ? (deviceView === 'all' ? 'runs' : 'devices')
      : null

  const selectedRuns = runChoice.testType === testType ? runChoice.selected : null
  const toggleRun = (id) => setRunChoice((current) => {
    const previous = current.testType === testType ? current.selected : null
    const next = previous ? new Set(previous) : new Set(curveSeries.map((s) => s.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { testType, selected: next }
  })

  const selectedFirmwares = firmwareChoice.testType === testType ? firmwareChoice.selected : null
  const toggleFirmware = (firmware) => setFirmwareChoice((current) => {
    const previous = current.testType === testType ? current.selected : null
    const next = previous ? new Set(previous) : new Set(curveSeries.map((s) => s.id))
    if (next.has(firmware)) next.delete(firmware)
    else next.add(firmware)
    return { testType, selected: next }
  })
  const setAllSeries = (selected) => {
    if (picker === 'firmware') setFirmwareChoice({ testType, selected })
    else if (picker === 'runs') setRunChoice({ testType, selected })
    else setDeviceChoice({ testType, selected })
  }
  const selectAllSeries = () => setAllSeries(null)
  const clearAllSeries = () => setAllSeries(new Set())

  const dropGain = useMemo(() => dropGainByLoadType(cycles), [cycles])
  const hourly = useMemo(() => hourlyProfile(cycles), [cycles])
  const hourRuns = useMemo(
    () => (hourPick == null ? [] : hourContributors(cycles, hourPick)),
    [cycles, hourPick],
  )
  const secondary = useMemo(() => compareBy(cycles, isField ? 'padState' : 'build'), [cycles, isField])
  // "cycles" on this page always means battery cycles; these look them up per group.
  const splitByGroup = useMemo(() => new Map(splitBy(cycles, isField ? 'padState' : 'build').map((r) => [r.label, r.display])), [cycles, isField])
  const groupCount = (label, runs) => (isCharging ? runsText(runs) : splitByGroup.get(label) ?? runsText(runs))
  const peakBreakdown = useMemo(() => cycles
    .filter((c) => c.maxTemp != null)
    .sort((a, b) => compareSerial(a.serial, b.serial)
      || String(a.date ?? '').localeCompare(String(b.date ?? ''))
      || b.maxTemp - a.maxTemp)
    .map((c, i) => ({
      id: c.id ?? `${c.serial}-${c.date}-${i}`,
      label: c.serial,
      value: c.maxTemp,
      display: fmtTemp(c.maxTemp),
      sub: [c.date ? fmtDate(c.date) : null,
        c.duration != null ? `${fmtNum(c.duration, 1)} h run` : null]
        .filter(Boolean).join(' · '),
      onClick: bySerial.bySerial.has(c.serial) ? () => {
        setMode('serial')
        setDeviceChoice({ testType, selected: new Set([c.serial]) })
      } : undefined,
    })), [cycles, bySerial, testType])

  const hottestRun = useMemo(() => {
    const peaks = cycles.map((c) => c.maxTemp).filter((v) => v != null)
    return peaks.length ? maxOf(peaks) : null
  }, [cycles])

  if (!cycles.length) {
    return <EmptyNote>No {testType} runs match the current filters.</EmptyNote>
  }

  /* --- the second KPI row, which depends on what the test measures -------- */
  const loadKpis = isLoadTest ? ['iPhone 1', 'iPhone 2', 'iPhone 3'].map((lt) => {
    const own = cycles.filter((c) => c.loadType === lt)
    return { lt, n: own.length, gain: mean(own.map((c) => c.loadGainPerHr)), drop: mean(own.map((c) => c.dropPerHr)) }
  }).filter((x) => x.n) : []
  const restaurantRates = isRestaurant ? [
    { label: 'Avg T7 drain · with wireless (WLC)', rateKey: 'wirelessDrainPerHr' },
    { label: 'Avg T7 drain · without wireless', rateKey: 'withoutWirelessDrainPerHr' },
  ].map((mode) => {
    const rated = cycles.filter((c) => c[mode.rateKey] != null)
    return {
      ...mode,
      rate: mean(rated.map((c) => c[mode.rateKey])),
    }
  }) : []

  return (
    <div className="view-stack">
      <div className="stat-row">
        <LifetimeStat lifetime={lifetime} hero />
        <Stat label="Avg run time" value={fmtNum(k.avgDuration, 1)} unit="h"
          foot="per run" />
        {isRestaurant ? restaurantRates.map((mode) => (
          <Stat key={mode.rateKey} label={mode.label} value={fmtRate(mode.rate)}
            foot={mode.rate != null
              ? `${Math.abs(mode.rate / 6).toFixed(2)}% per 10 min`
              : 'needs consecutive hourly readings in this mode'} />
        )) : (
          <Stat label={isCharging ? 'Avg charge rate' : drainLabel} value={fmtRate(k.avgDropPerHr)}
            foot={k.avgDropPerHr != null
              ? `${Math.abs(k.avgDropPerHr / 6).toFixed(2)}% per 10 min`
              : 'needs two whole-hour readings'} />
        )}
        <Stat label="Avg start battery" value={fmtPct(k.avgStartBattery)} />
        <Stat label={isCharging ? 'Avg charged to' : 'Avg end battery'} value={fmtPct(k.avgEndBattery)}
          foot="at run end" />
        {/* The average of the peaks hides the worst one, which is the figure a
            thermal problem actually shows up in. */}
        <Stat label="Avg peak battery temp" value={fmtNum(k.avgPeakTemp, 1)} unit="°C"
          foot={hottestRun == null
            ? 'no temperature recorded'
            : `hottest run reached ${fmtTemp(hottestRun)}`}
          breakdown={peakBreakdown} breakdownWide breakdownRight
          breakdownLabel="Cycle peak temperatures · serial ascending" />
      </div>

      {isField && (
        <div className="stat-row">
          <Stat label="Avg RAM used" value={fmtPct(mean(cycles.map((c) => c.avgRam)), 1)}
            foot="recorded only by MDM telemetry" />
          <Stat label="Peak RAM used" value={fmtPct(maxOf(cycles.map((c) => c.maxRam)), 1)} />
          <Stat label="Runs on a misplaced pad"
            value={fmtInt(cycles.filter((c) => c.padState === 'Pad misplaced').length)}
            foot="pad reported a misplaced device for most of the run" />
          <Stat label="Runs rated by straight line"
            value={fmtInt(cycles.filter((c) => c.rateBasis === 'straight line over the run').length)}
            foot="shorter than two whole hours" />
        </div>
      )}

      {loadKpis.length > 0 && (
        <div className="stat-row">
          {loadKpis.map((x) => (
            <Stat key={x.lt} label={`${x.lt} gain`} value={fmtSigned(x.gain, 2, '%/h')}
              foot={`${x.drop == null
                ? 'T7 loss not measurable'
                : `T7 loses ${Math.abs(x.drop / 6).toFixed(2)}% per 10 min`
              } · ${runsText(x.n)}`} />
          ))}
        </div>
      )}

      <div className={showSecondaryChart ? 'grid grid-2 detail-charts-with-secondary' : 'grid grid-2'}>
      <Card expandable
        title="T7 battery over elapsed time"
        sub={activeMode === 'serial'
          ? (deviceView === 'all'
            ? 'One line per run, each in its own colour and pattern — tick runs in the list to compare a few'
            : "One line per device, averaging that device's runs at each whole hour")
          : `Mean battery at each whole hour, grouped by ${activeMode === 'padState' ? 'pad state' : activeMode}`}
        right={<Segmented ariaLabel="Curve grouping" options={curveModes} value={activeMode} onChange={setMode} />}>
        {/* Below the header, not beside it: two segmented controls in one card
            header squeeze the title until it wraps a word per line. */}
        {activeMode === 'serial' && (
          <div className="chart-subcontrol">
            <Segmented ariaLabel="Per-device detail" options={DEVICE_VIEWS}
              value={deviceView} onChange={setDeviceView} />
          </div>
        )}
        <LineChart
          series={curveSeries}
          xDomain={[0, curveMaxHour]}
          yDomain={[0, 100]}
          formatX={fmtHourTick}
          formatY={(v) => `${v}%`}
          xLabel="elapsed time"
          xUnit="h"
          height={330}
          emptyState={explainEmpty(cycles, (c) => c.series.length, 'a battery reading')}
          caption={`T7 battery percentage over elapsed hours for ${testType}`}
          legendDisclosure={picker === 'devices' ? 'Devices'
            : picker === 'runs' ? 'Runs'
              : picker === 'firmware' ? 'Firmware' : null}
          selectedSeries={picker === 'devices' ? selectedDevices
            : picker === 'runs' ? selectedRuns
              : picker === 'firmware' ? selectedFirmwares : null}
          onToggleSeries={picker === 'devices' ? toggleDevice
            : picker === 'runs' ? toggleRun
              : picker === 'firmware' ? toggleFirmware : undefined}
          onSelectAllSeries={selectAllSeries}
          onClearAllSeries={clearAllSeries}
          tableColumns={[
            { key: 'serial', label: 'Serial' },
            { key: 'date', label: 'Date' },
            { key: 'build', label: 'Build' },
            { key: 'fw', label: 'Firmware' },
            { key: 'dur', label: 'Run time' },
            { key: 'start', label: 'Start' },
            { key: 'end', label: isCharging ? 'Charged to' : 'End' },
            { key: 'drop', label: isCharging ? 'Charge rate' : 'Drain' },
          ]}
          tableRows={bySerial.serials.map((sn) => {
            const c = bySerial.bySerial.get(sn)
            return {
              serial: sn, date: fmtDate(c.date), build: c.build, fw: c.firmware,
              dur: fmtHours(c.duration), start: fmtPct(c.startBattery), end: fmtPct(c.endBattery),
              drop: fmtRate(c.dropPerHr),
            }
          })}
        />
        {activeMode === 'serial' && bySerial.dropped > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            {bySerial.dropped} cycle{bySerial.dropped === 1 ? '' : 's'} ran more than three times the
            median length ({fmtHours(bySerial.medianDuration)}) and {bySerial.dropped === 1 ? 'was' : 'were'} left
            out of this chart, so one stray long run cannot flatten the rest. They are still counted
            in every figure above and listed in the Cycles table.
          </p>
        )}
      </Card>

        {showSecondaryChart && (isLoadTest ? (
          <Card expandable title="T7 drain against load gain"
            sub="Mean per hour, by load type — both measures are percentage-points per hour, so they share one axis">
            <GroupedColumns
              groups={dropGain.map((d) => ({
                label: d.label, n: d.n, values: { drop: d.drop, gain: d.gain },
              }))}
              measures={[
                { key: 'drop', label: 'T7 drain (%/h)', color: MEASURE_COLOR.drop },
                { key: 'gain', label: 'Load gain (%/h)', color: MEASURE_COLOR.gain },
              ]}
              formatValue={(v) => `${v}%/h`}
              height={280}
              emptyState={explainNoRate(cycles)}
              caption="Mean T7 drain and load gain per hour, by load type"
              tableColumns={[
                { key: 'load', label: 'Load type' },
                { key: 'n', label: 'Runs' },
                { key: 'drop', label: 'T7 drain' },
                { key: 'gain', label: 'Load gain' },
              ]}
              tableRows={dropGain.map((d) => ({
                load: d.label, n: fmtInt(d.n),
                drop: d.drop != null ? `${d.drop}%/h` : '—',
                gain: d.gain != null ? `+${d.gain}%/h` : '—',
              }))}
            />
            {dropGain.some((d) => d.gain == null) && (
              <p className="hint" style={{ marginTop: 8 }}>
                A missing gain bar means Load % was never recorded for that load type — the
                5W WLC Tester in particular logs no charge-received figure.
              </p>
            )}
          </Card>
        ) : (
          <Card expandable title={isField ? 'Run time by pad state' : 'Run time by build'}
            sub="Mean hours per run">
            <BarRows
              rows={secondary.map((b) => ({
                id: b.label,
                label: b.label.replace(' Build', ''),
                value: b.avgDuration ?? 0,
                color: isField ? 'var(--series-1)' : (BUILD_COLOR[b.label] ?? 'var(--series-1)'),
                display: `${fmtNum(b.avgDuration, 1)} h · ${groupCount(b.label, b.cycles)}`,
              }))}
              unit="h"
              labelWidth={isField ? 124 : 100}
              emptyState={explainEmpty(cycles, 'duration', 'a run time')}
              caption={`Mean run time by ${isField ? 'pad state' : 'hardware build'}`}
              tableColumns={[
                { key: 'build', label: isField ? 'Pad state' : 'Build' },
                { key: 'n', label: 'Cycles (MDM) or runs' },
                { key: 'dur', label: 'Avg run time' },
                { key: 'drop', label: isCharging ? 'Avg charge rate' : 'Avg drain' },
                { key: 'temp', label: 'Avg peak temp' },
              ]}
              tableRows={secondary.map((b) => ({
                build: b.label, n: groupCount(b.label, b.cycles), dur: fmtHours(b.avgDuration),
                drop: fmtRate(isCharging && b.avgDropPerHr != null ? -b.avgDropPerHr : b.avgDropPerHr),
                temp: fmtTemp(b.avgPeakTemp),
              }))}
            />
          </Card>
        ))}

        <Card expandable title={testType === 'WLC on Phone'
          ? 'T7 drain and load gain by hour of the run'
          : isCharging ? 'Battery gained by hour of the run' : 'Drain by hour of the run'}
          sub={isCharging
            ? 'How many battery percentage points the T7 gains in each whole hour, averaged across charging runs.'
            : isRestaurant
              ? 'Mean T7 battery loss in each hour, split by whether a wireless load was recorded at the start of that hour.'
              : testType === 'WLC on Phone'
                ? 'Mean T7 battery lost and load battery gained in each whole hour. Both use percentage points on one axis; load-type averages are shown above.'
              : 'Average battery lost during each hour of a run.'}>
          <GroupedColumns
            onSelectGroup={(g) => setHourPick((cur) => (cur === g.h ? null : g.h))}
            selectedGroup={hourPick == null ? null
              : hourly.find((h) => h.h === hourPick)?.label ?? null}
            groups={hourly.map((h) => ({
              label: h.label, n: h.n, h: h.h,
              values: isRestaurant
                ? { wireless: h.wirelessDrop, withoutWireless: h.withoutWirelessDrop }
                : isCharging ? { charge: h.drop == null ? null : -h.drop }
                  : isLoadTest ? { drop: h.drop, gain: h.gain } : { drop: h.drop },
            }))}
            measures={isRestaurant ? [
              { key: 'wireless', label: 'With wireless (WLC)', color: MEASURE_COLOR.wireless },
              { key: 'withoutWireless', label: 'Without wireless', color: MEASURE_COLOR.withoutWireless },
            ] : isCharging ? [
              { key: 'charge', label: 'T7 battery gained (% points)', color: MEASURE_COLOR.gain },
            ] : isLoadTest ? [
              { key: 'drop', label: 'T7 battery lost (% points)', color: MEASURE_COLOR.drop },
              { key: 'gain', label: 'Load battery gained (% points)', color: MEASURE_COLOR.gain },
            ] : [
              { key: 'drop', label: 'T7 battery lost (% points)', color: MEASURE_COLOR.drop },
            ]}
            formatValue={(v) => `${v}%`}
            xLabel="hour of the run"
            xUnit="h"
            rotateLabels={hourly.length > 10}
            height={280}
            emptyState={explainNoRate(cycles, isCharging ? 'a charge rate' : 'a drain rate')}
            caption={isCharging ? 'Mean T7 battery gained per hour window'
              : isRestaurant ? 'Mean T7 drain per hour, with and without wireless'
                : testType === 'WLC on Phone' ? 'Mean T7 drain and load gain by hour of the run'
                  : 'Mean battery change per hour window'}
            tableColumns={[
              { key: 'window', label: 'Hour' },
              { key: 'n', label: 'Runs' },
              ...(isRestaurant ? [
                { key: 'wireless', label: 'With wireless (WLC)' },
                { key: 'withoutWireless', label: 'Without wireless' },
              ] : isCharging ? [
                { key: 'charge', label: 'Battery gained' },
              ] : [
                { key: 'drop', label: 'Battery lost' },
                ...(isLoadTest ? [{ key: 'gain', label: 'Load battery gained' }] : []),
              ]),
            ]}
            tableRows={hourly.map((h) => ({
              window: h.label, n: fmtInt(h.n),
              drop: h.drop != null ? `${h.drop}%` : '—',
              charge: h.drop != null ? fmtSigned(-h.drop, 2, '%') : '—',
              gain: h.gain != null ? `+${h.gain}%` : '—',
              wireless: h.wirelessDrop != null ? `${h.wirelessDrop}% · ${runsText(h.wirelessN)}` : '—',
              withoutWireless: h.withoutWirelessDrop != null
                ? `${h.withoutWirelessDrop}% · ${runsText(h.withoutWirelessN)}` : '—',
            }))}
          />

          {/* A bar is a mean, which is a dead end when it looks wrong: these
              rows say whether every device did that or one run dragged it. */}
          {hourPick == null ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Click a bar to list the runs behind it.
            </p>
          ) : (
            <div className="hour-detail">
              <div className="hour-detail-head">
                <strong>
                  Hour {hourly.find((h) => h.h === hourPick)?.label ?? hourPick}
                  {' · '}{fmtInt(hourRuns.length)} run{hourRuns.length === 1 ? '' : 's'}
                  {' across '}{fmtInt(new Set(hourRuns.map((r) => r.serial)).size)} device
                  {new Set(hourRuns.map((r) => r.serial)).size === 1 ? '' : 's'}
                </strong>
                <button className="btn btn-sm" onClick={() => setHourPick(null)}>Close</button>
              </div>
              {hourRuns.length === 0 ? (
                <EmptyNote>No run has readings at both ends of this hour.</EmptyNote>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 300 }}>
                  <table className="data">
                    <caption className="sr-only">Runs contributing to this hour</caption>
                    <thead><tr>
                      <th style={{ textAlign: 'left' }}>Device</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'left' }}>Build</th>
                      <th>Battery at start</th>
                      <th>Battery at end</th>
                      <th>{isCharging ? 'Gained' : 'Lost'}</th>
                      {isLoadTest && <th>Load gained</th>}
                      <th>Run length</th>
                    </tr></thead>
                    <tbody>
                      {hourRuns.map((r) => (
                        <tr key={r.id}>
                          <td className="serial" style={{ textAlign: 'left' }}>{fmtSerial(r.serial)}</td>
                          <td>{r.date ? fmtDate(r.date) : '—'}</td>
                          <td style={{ textAlign: 'left' }}>{r.build?.replace(' Build', '') ?? '—'}</td>
                          <td>{fmtPct(r.from)}</td>
                          <td>{fmtPct(r.to)}</td>
                          <td>{isCharging ? fmtSigned(-r.drop, 2, '%') : `${r.drop}%`}</td>
                          {isLoadTest && <td>{r.gain == null ? '—' : `+${r.gain}%`}</td>}
                          <td>{fmtHours(r.duration)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
