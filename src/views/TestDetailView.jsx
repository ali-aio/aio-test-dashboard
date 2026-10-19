import { splitText, splitBy, cyclesText, deviceCyclesText, countCycles, benchCycles } from '../lib/splitCycles.js'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SortTable } from '../components/SortTable.jsx'
import { loadDecls, takenOutOf, takenOutText } from '../lib/plan.js'
import { CTX } from '../lib/adapt.js'
import { cycleTableCsv, cycleHoursCsv, downloadCsv } from '../lib/csv.js'
import { Card, Stat, EmptyNote, Segmented } from '../components/Primitives.jsx'
import { LineChart, GroupedColumns, BarRows } from '../components/t7charts.jsx'
import { LOAD_TEST_TYPES, FIELD_TEST_TYPES, FIELD_CHARGING } from '../lib/testtypes.js'
import { padSplit } from '../lib/drainHours.js'
import PickDevicesDialog from '../components/PickDevicesDialog.jsx'
import {
  kpis, fullDischargeCycles, batteryCycles, batteryCyclesBy, batteryBySerial, avgCurveBy, dropGainByLoadType, hourlyProfile,
  hourContributors, compareBy, mean, maxOf,
  explainEmpty, explainNoRate, plottedMaxHour } from '../lib/t7cycles.js'
import { buildColorMap, buildStyleMap, MAX_SERIES, SERIES_VARS, BUILD_COLOR, MEASURE_COLOR } from '../lib/palette.js'
import {
  fmtBC, bcText, runsText, fmtInt, fmtNum, fmtPct, fmtHours, fmtTemp, fmtRate, fmtSigned, fmtHourTick, fmtDate, fmtSerial, compareSerial, fmtEnded } from '../lib/fmt.js'

const BENCH_CURVE_MODES = [
  { id: 'serial', label: 'Per device' },
  { id: 'build', label: 'Mean by build' },
  { id: 'firmware', label: 'Mean by firmware' },
]

/* Field cycles come from MDM telemetry, which carries no build or firmware
   column — pad state is the dimension that data actually distinguishes. */
const FIELD_CURVE_MODES = [
  { id: 'serial', label: 'Per device' },
  { id: 'padState', label: 'Mean by WLC' },
]

/* A device usually ran the test several times. Showing its longest run alone
   answered neither "what does this device do" nor "how consistent is it", so
   the reader says which of the two they are after. */
const DEVICE_VIEWS = [
  { id: 'average', label: 'Average per device' },
  { id: 'all', label: 'Every cycle' },
]

export default function TestDetailView({ cycles: allCycles, testType, allSerials, lifetime = null, initialBench = null, hours = null }) {
  // A device clicked in the Every cycle table narrows the charts and tiles above to it (as
  // on Today); the table keeps every device so another can be picked, and Show all restores.
  const [focus, setFocus] = useState(null)
  const [tableQ, setTableQ] = useState('') // search inside the Every cycle table
  // one bench cycle picked from the Cycles tile: charts, tiles and the table show only its runs
  const [bench, setBench] = useState(initialBench)
  const chartsRef = useRef(null)
  // a new test (or a cycle opened from the Cycle plan's list) starts from that cycle, else all
  useEffect(() => { setFocus(null); setBench(initialBench) }, [testType, initialBench])
  const benches = useMemo(() => benchCycles(allCycles), [allCycles])
  const benchSel = bench ? benches.find((b) => b.key === bench) : null
  const inBench = useMemo(() => (benchSel ? benchSel.list : allCycles), [allCycles, benchSel])
  const cycles = useMemo(() => (focus ? inBench.filter((c) => c.serial === focus) : inBench), [inBench, focus])
  // Picking a device also switches the battery chart to Per device with only it ticked, so
  // its picker reads "1/22" and the other devices of the cycle stay a tick away.
  const pickDevice = (sn) => {
    const on = focus !== sn
    setFocus(on ? sn : null)
    if (on) setMode('serial')
    setDeviceChoice({ testType, selected: on ? new Set([sn]) : null })
    chartsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const clearPick = () => { setFocus(null); setBench(null); setDeviceChoice({ testType, selected: null }) }
  const tableSerials = [...new Set(inBench.map((c) => c.serial))]
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
  // drain with / without a load on the wireless pad, per cycle: tests that place a load, and
  // field cycles (which may have had one)
  const isField = FIELD_TEST_TYPES.has(testType)
  const isCharging = testType === 'Charging Cycle' || testType === FIELD_CHARGING
  const isRestaurant = testType === 'Restaurant Case'
  const showSecondaryChart = ![
    'Charging Cycle', 'Restaurant Case', 'Ads only', 'WLC + Discharge on Ads',
    'Burn-in Test', 'WLC on Load', 'WLC on Phone', 'Discharge on Load only',
  ].includes(testType)
  const drainLabel = testType === 'Ads only'
    ? 'Avg T7 drain · ads only, no load'
    : testType === 'WLC + Discharge on Ads'
      ? 'Avg T7 drain · ads, load on the pad for 3 h'
      : testType === 'Discharge on Load only'
        ? 'Avg T7 drain · load only, no ads'
        : 'Avg T7 drain'

  /* Colour follows the serial across the whole app, so filtering a device out
     never repaints the others. */
  const styleMap = useMemo(() => buildStyleMap([...allSerials].sort(compareSerial)), [allSerials])

  const bySerial = useMemo(() => batteryBySerial(inBench), [inBench])
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
      const inScope = inBench.filter((c) => c.series.length
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
        sub: `${fmtInt(g.count)} cycle${g.count === 1 ? '' : 's'}`,
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
      sub: isCharging ? cyclesText(cycles.filter((c) => (c[key] ?? 'Unknown') === g.label)) : splitText(cycles.filter((c) => (c[key] ?? 'Unknown') === g.label)),
      color: key === 'build'
        ? (BUILD_COLOR[g.label] ?? SERIES_VARS[i])
        : groupColors.get(g.label),
      points: g.points,
    }))
  }, [activeMode, deviceView, selectedDevices, bySerial, cycles, inBench, styleMap])
  // The axis ends at the furthest point actually drawn. "Every cycle" plots every sample,
  // not just whole hours, so sizing it like the averaged views let lines cycle off the edge.
  const curveMaxHour = useMemo(() => {
    let m = 0
    for (const sr of curveSeries) for (const p of sr.points) if (p.t > m) m = p.t
    return Math.max(1, Math.ceil(m || maxHour))
  }, [curveSeries, maxHour])
  /* Which tick-list the chart is showing, so the three pickers share one set
     of Select all / Clear all buttons without each testing the mode again. */
  const picker = activeMode === 'firmware' ? 'firmware'
    : activeMode === 'serial' ? (deviceView === 'all' ? 'cycles' : 'devices')
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
    else if (picker === 'cycles') setRunChoice({ testType, selected })
    else setDeviceChoice({ testType, selected })
  }
  const selectAllSeries = () => setAllSeries(null)
  const clearAllSeries = () => setAllSeries(new Set())

  const dropGain = useMemo(() => dropGainByLoadType(cycles), [cycles])
  // devices ticked in the battery chart's Per device picker: Drain by hour follows them, and the
  // bar above says so (ticking a device = picking it, as clicking it in the table does)
  const ticked = activeMode === 'serial' && selectedDevices && selectedDevices.size < tableSerials.length ? selectedDevices : null
  const hourSrc = useMemo(() => (ticked ? cycles.filter((c) => ticked.has(c.serial)) : cycles), [cycles, ticked])
  const hourly = useMemo(() => hourlyProfile(hourSrc), [hourSrc])
  const devicesText = (n) => `${fmtInt(n)} device${n === 1 ? '' : 's'}`
  // each hour's count in bench cycles (one run of the test on the bench), not device runs
  const hourCycles = useMemo(() => new Map(hourly.map((h) => {
    const runs = hourContributors(hourSrc, h.h), n = new Set(runs.map((r) => r.serial)).size
    return [h.h, `${cyclesText(runs)} · ${fmtInt(n)} device${n === 1 ? '' : 's'}`]
  })), [hourly, hourSrc])
  const hourRuns = useMemo(
    () => (hourPick == null ? [] : hourContributors(hourSrc, hourPick)),
    [hourSrc, hourPick],
  )
  const secondary = useMemo(() => compareBy(cycles, isField ? 'padState' : 'build'), [cycles, isField])
  // "cycles" on this page always means battery cycles; these look them up per group.
  const splitByGroup = useMemo(() => new Map(splitBy(cycles, isField ? 'padState' : 'build').map((r) => [r.label, r.display])), [cycles, isField])
  // a group's amount: bench cycles (devices running together count once), or its MDM figure
  const groupCount = (label) => {
    const own = cycles.filter((c) => (c[isField ? 'padState' : 'build'] ?? 'Unknown') === label)
    return isCharging ? cyclesText(own) : splitByGroup.get(label) ?? cyclesText(own)
  }
  const peakBreakdown = useMemo(() => cycles
    .filter((c) => c.maxTemp != null)
    .sort((a, b) => b.maxTemp - a.maxTemp
      || compareSerial(a.serial, b.serial)
      || String(a.date ?? '').localeCompare(String(b.date ?? '')))
    .map((c, i) => ({
      id: c.id ?? `${c.serial}-${c.date}-${i}`,
      label: c.serial,
      value: c.maxTemp,
      display: fmtTemp(c.maxTemp),
      sub: [c.date ? fmtDate(c.date) : null,
        c.duration != null ? `${fmtNum(c.duration, 1)} h cycle` : null]
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
    return <EmptyNote>No {testType} cycles match the current filters.</EmptyNote>
  }

  /* --- the second KPI row, which depends on what the test measures -------- */
  const loadKpis = isLoadTest ? ['iPhone 1', 'iPhone 2', 'iPhone 3'].map((lt) => {
    const own = cycles.filter((c) => c.loadType === lt)
    return { lt, n: own.length, gain: mean(own.map((c) => c.loadGainPerHr)), drop: mean(own.map((c) => c.dropPerHr)) }
  }).filter((x) => x.n) : []
  const restaurantRates = isRestaurant ? [
    { label: 'Avg drain · WLC active', rateKey: 'wirelessDrainPerHr' },
    { label: 'Avg drain · WLC inactive', rateKey: 'withoutWirelessDrainPerHr' },
  ].map((mode) => {
    const rated = cycles.filter((c) => c[mode.rateKey] != null)
    return {
      ...mode,
      rate: mean(rated.map((c) => c[mode.rateKey])),
    }
  }) : []

  const serialsHere = [...new Set(cycles.map((c) => c.serial))]

  // the Every cycle table's rows as shown: the search matches the serial, the firmware or the date
  const tableRows = [...inBench].filter((c) => { const q = tableQ.trim().toLowerCase(); return !q
    || [c.serial, c.firmware, c.date ? fmtDate(c.date) : ''].some((v) => String(v ?? '').toLowerCase().includes(q)) })
    .sort((a, b) => b.start - a.start)
  const showPad = !isCharging && (isLoadTest || isField || ['WLC on Load', 'Discharge on Load only'].includes(testType))
  const padOf = (c) => (showPad ? padSplit(hours?.[c.serial]?.h, c.start, c.end) : null)
  // Export: the table as shown (Overview), or every device's cycles hour by hour (Per hour)
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef(null)
  useEffect(() => {
    if (!exportOpen) return
    const onDoc = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [exportOpen])
  // Per hour first asks which devices (all ticked by default)
  const [hoursPick, setHoursPick] = useState(false)
  const exportTable = (kind, serials = null) => {
    setExportOpen(false)
    if (kind === 'hours' && !serials) { setHoursPick(true); return }
    setHoursPick(false)
    const d = new Date(benchSel ? benchSel.start : Date.now()), p = (n) => String(n).padStart(2, '0')
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${benchSel ? `_${p(d.getHours())}${p(d.getMinutes())}` : ''}`
    const one = serials && serials.size === 1 ? [...serials][0] : focus
    const name = `aio-${String(testType).replace(/[^\w-]+/g, '-')}_${benchSel ? 'cycle' : 'all-cycles'}${kind === 'hours' ? '_per-hour' : ''}_${when}${one ? `_${one}` : ''}.csv`
    downloadCsv(kind === 'hours'
      ? cycleHoursCsv(tableRows.filter((c) => serials.has(c.serial)), { charging: isCharging, slotsOf: (sn) => hours?.[sn]?.h })
      : cycleTableCsv(tableRows, { charging: isCharging, pad: isField, wlc: showPad ? padOf : null }), name)
  }

  return (
    <div className="view-stack">
      <div className="stat-row">
        {/* this test only: bench cycles of it (devices running together count once), the
            devices in them and the battery used — MDM counter where recorded, else drop ÷ 100 */}
        {(() => {
          const n = countCycles(cycles)
          const day = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace('Sept', 'Sep')
          const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          return <Stat hero label="Cycles" value={fmtInt(n)}
            breakdownLabel={`${testType} — every cycle, newest first · click one to show only it`} breakdownNoun="cycle" breakdownWide
            breakdown={[...benches].reverse().map((b) => {
              const nd = new Set(b.list.map((c) => c.serial)).size, avg = b.list.reduce((a, c) => a + (c.duration || 0), 0) / b.list.length
              const running = b.list.some((c) => c.inProgress)
              return { id: b.key, label: day(b.start), sub: `off the charger ${hm(b.start)} · ${running ? 'running now' : `avg ${avg.toFixed(1)} h`}`,
                value: nd, display: `${nd} device${nd === 1 ? '' : 's'}`, highlight: b.key === bench,
                onClick: () => { setBench((k) => (k === b.key ? null : b.key)); setFocus(null); setDeviceChoice({ testType, selected: null }) } }
            })} />
        })()}
        <Stat label="Avg cycle time" value={fmtNum(k.avgDuration, 1)} unit="h"
          foot="per cycle" />
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
          foot="at cycle end" />
        {/* The average of the peaks hides the worst one, which is the figure a
            thermal problem actually shows up in. */}
        <Stat label="Avg peak temp" value={fmtNum(k.avgPeakTemp, 1)} unit="°C"
          foot={hottestRun == null
            ? 'no temperature recorded'
            : `hottest cycle ${fmtTemp(hottestRun)}`}
          breakdown={peakBreakdown} breakdownWide breakdownRight
          breakdownLabel="Cycle peak temperatures · hottest first" />
      </div>

      {isField && (
        <div className="stat-row">
          <Stat label="Avg RAM used" value={fmtPct(mean(cycles.map((c) => c.avgRam)), 1)}
            foot="recorded only by MDM telemetry" />
          <Stat label="Peak RAM used" value={fmtPct(maxOf(cycles.map((c) => c.maxRam)), 1)} />
          <Stat label="Cycles on a misplaced pad"
            value={fmtInt(cycles.filter((c) => c.padState === 'Pad misplaced').length)}
            foot="pad reported a misplaced device for most of the cycle" />
          <Stat label="Cycles rated by straight line"
            value={fmtInt(cycles.filter((c) => c.rateBasis === 'straight line over the cycle').length)}
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
              } · ${deviceCyclesText(x.n)}`} />
          ))}
        </div>
      )}

      {(focus || benchSel || ticked) && (
        <div className="pick-bar">
          <span>Showing only {benchSel ? <>the cycle of <b>{new Date(benchSel.start).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b> ({new Set(benchSel.list.map((c) => c.serial)).size} devices)</> : null}
            {benchSel && focus ? ', ' : ''}{focus ? <><b className="mono">{focus}</b>{benchSel ? '' : <> — its {cyclesText(cycles)} of {testType}</>}</> : null}
            {!focus && ticked ? <>{benchSel ? ', ' : ''}{ticked.size <= 3 ? [...ticked].sort(compareSerial).map((sn, i) => <React.Fragment key={sn}>{i ? ', ' : ''}<b className="mono">{sn}</b></React.Fragment>) : <b>{ticked.size} devices</b>}
              {' '}— {ticked.size === 1 ? 'its' : 'their'} {cyclesText(hourSrc)} of {testType}, in the battery chart and Drain by hour</> : null}
            {/* devices taken out of this cycle on the Today screen: they left it, so they are not in its charts */}
            {benchSel && (() => { const out = takenOutOf(loadDecls(CTX.group), benchSel.start); return out.length ? <span className="pick-out">
              <b>{out.length} taken out of this cycle:</b>{out.map((r) => <span key={r.serial + r.at}>{takenOutText(r)}</span>)}</span> : null })()}</span>
          <button type="button" className="btn btn-sm" onClick={clearPick}>× Clear selection</button>
        </div>
      )}
      <div ref={chartsRef} style={{ scrollMarginTop: 80 }} className={showSecondaryChart ? 'grid grid-2 detail-charts-with-secondary' : 'grid grid-2'}>
      <Card expandable
        title="T7 battery over elapsed time"
        sub={activeMode === 'serial'
          ? (deviceView === 'all'
            ? 'One line per cycle, each in its own colour and pattern — tick cycles in the list to compare a few'
            : "One line per device, averaging that device's cycles at each whole hour")
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
            : picker === 'cycles' ? 'Cycles'
              : picker === 'firmware' ? 'Firmware' : null}
          selectedSeries={picker === 'devices' ? selectedDevices
            : picker === 'cycles' ? selectedRuns
              : picker === 'firmware' ? selectedFirmwares : null}
          onToggleSeries={picker === 'devices' ? toggleDevice
            : picker === 'cycles' ? toggleRun
              : picker === 'firmware' ? toggleFirmware : undefined}
          onSelectAllSeries={selectAllSeries}
          onClearAllSeries={clearAllSeries}
          // the table says what the lines are: Every cycle -> one row per cycle; otherwise one row
          // per device, averaged over all of its cycles (it used to show only the device's longest
          // cycle, which read as "only the last cycle is counted")
          tableColumns={deviceView === 'all' && activeMode === 'serial' ? [
            { key: 'serial', label: 'Serial' },
            { key: 'date', label: 'Date' },
            { key: 'build', label: 'Build' },
            { key: 'fw', label: 'Firmware' },
            { key: 'dur', label: 'Cycle time' },
            { key: 'start', label: 'Start' },
            { key: 'end', label: isCharging ? 'Charged to' : 'End' },
            { key: 'drop', label: isCharging ? 'Charge rate' : 'Drain' },
          ] : [
            { key: 'serial', label: 'Serial' },
            { key: 'n', label: 'Cycles' },
            { key: 'dates', label: 'Dates' },
            { key: 'fw', label: 'Firmware' },
            { key: 'dur', label: 'Avg cycle time' },
            { key: 'start', label: 'Avg start' },
            { key: 'end', label: isCharging ? 'Avg charged to' : 'Avg end' },
            { key: 'drop', label: isCharging ? 'Avg charge rate' : 'Avg drain' },
          ]}
          // only the devices (or cycles) ticked in the picker, so the table matches the lines drawn
          tableRows={(() => {
            const limit = bySerial.medianDuration ? bySerial.medianDuration * 3 : null
            const shown = inBench.filter((c) => c.series.length && (limit == null || c.duration == null || c.duration <= limit))
              // the devices ticked apply in both per-device views (Every cycle keeps them too, as the lines do)
              .filter((c) => activeMode !== 'serial' || selectedDevices == null || selectedDevices.has(c.serial))
            if (deviceView === 'all' && activeMode === 'serial') {
              return shown.filter((c) => selectedRuns == null || selectedRuns.has(c.id))
                .sort((a, b) => compareSerial(a.serial, b.serial) || a.start - b.start)
                .map((c) => ({ serial: c.serial, date: fmtDate(c.date), build: c.build, fw: c.firmware,
                  dur: fmtHours(c.duration), start: fmtPct(c.startBattery), end: fmtPct(c.endBattery), drop: fmtRate(c.dropPerHr) }))
            }
            const by = new Map()
            for (const c of shown) { if (!by.has(c.serial)) by.set(c.serial, []); by.get(c.serial).push(c) }
            return [...by.keys()].sort(compareSerial).map((sn) => {
              const cs = by.get(sn).sort((a, b) => a.start - b.start), avg = (k) => mean(cs.map((c) => c[k]).filter(Number.isFinite))
              const first = cs[0].date, last = cs[cs.length - 1].date
              return { serial: sn, n: fmtInt(cs.length), dates: first === last ? fmtDate(first) : `${fmtDate(first)} – ${fmtDate(last)}`,
                fw: [...new Set(cs.map((c) => c.firmware))].join(', '), dur: fmtHours(avg('duration')),
                start: fmtPct(avg('startBattery') == null ? null : Math.round(avg('startBattery'))),
                end: fmtPct(avg('endBattery') == null ? null : Math.round(avg('endBattery'))), drop: fmtRate(avg('dropPerHr')) }
            })
          })()}
        />
        {activeMode === 'serial' && bySerial.dropped > 0 && (
          <p className="hint" style={{ marginTop: 8 }}>
            {bySerial.dropped} cycle{bySerial.dropped === 1 ? '' : 's'} ran more than three times the
            median length ({fmtHours(bySerial.medianDuration)}) and {bySerial.dropped === 1 ? 'was' : 'were'} left
            out of this chart, so one stray long cycle cannot flatten the rest. They are still counted
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
                { key: 'n', label: 'Cycles' },
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
          // A few bars: a full-width strip, not a half-width box beside the taller hourly chart.
          <div className="span-all"><Card expandable title={isField ? 'Cycle time by pad state' : 'Cycle time by build'}
            sub="Mean hours per cycle">
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
              emptyState={explainEmpty(cycles, 'duration', 'a cycle time')}
              caption={`Mean cycle time by ${isField ? 'pad state' : 'hardware build'}`}
              tableColumns={[
                { key: 'build', label: isField ? 'Pad state' : 'Build' },
                { key: 'n', label: 'Cycles' },
                { key: 'dur', label: 'Avg cycle time' },
                { key: 'drop', label: isCharging ? 'Avg charge rate' : 'Avg drain' },
                { key: 'temp', label: 'Avg peak temp' },
              ]}
              tableRows={secondary.map((b) => ({
                build: b.label, n: groupCount(b.label, b.cycles), dur: fmtHours(b.avgDuration),
                drop: fmtRate(isCharging && b.avgDropPerHr != null ? -b.avgDropPerHr : b.avgDropPerHr),
                temp: fmtTemp(b.avgPeakTemp),
              }))}
            />
          </Card></div>
        ))}

        <div className={showSecondaryChart && !isLoadTest ? 'span-all' : undefined}><Card expandable title={testType === 'WLC on Phone'
          ? 'T7 drain and load gain by hour of the cycle'
          : isCharging ? 'Battery gained by hour of the cycle' : 'Drain by hour of the cycle'}
          sub={isCharging
            ? 'How many battery percentage points the T7 gains in each whole hour, averaged across charging cycles.'
            : isRestaurant
              ? undefined // no subtitle on Restaurant Case (the lab's choice, Oct 2026)
              : testType === 'WLC on Phone'
                ? 'Mean T7 battery lost and load battery gained in each whole hour. Both use percentage points on one axis; load-type averages are shown above.'
              : 'Average battery lost during each hour of a cycle.'}>
          <GroupedColumns
            onSelectGroup={(g) => setHourPick((cur) => (cur === g.h ? null : g.h))}
            selectedGroup={hourPick == null ? null
              : hourly.find((h) => h.h === hourPick)?.label ?? null}
            groups={hourly.map((h) => ({
              label: h.label, n: h.n, h: h.h, nText: hourCycles.get(h.h),
              // Restaurant Case: how many devices are behind each side of the hour
              counts: isRestaurant ? { wireless: devicesText(h.wirelessDevices), withoutWireless: devicesText(h.withoutWirelessDevices) } : undefined,
              values: isRestaurant
                ? { wireless: h.wirelessDrop, withoutWireless: h.withoutWirelessDrop }
                : isCharging ? { charge: h.drop == null ? null : -h.drop }
                  : isLoadTest ? { drop: h.drop, gain: h.gain } : { drop: h.drop },
            }))}
            measures={isRestaurant ? [
              { key: 'wireless', label: 'WLC active', color: MEASURE_COLOR.wireless },
              { key: 'withoutWireless', label: 'WLC inactive', color: MEASURE_COLOR.withoutWireless },
            ] : isCharging ? [
              { key: 'charge', label: 'T7 battery gained (% points)', color: MEASURE_COLOR.gain },
            ] : isLoadTest ? [
              { key: 'drop', label: 'T7 battery lost (% points)', color: MEASURE_COLOR.drop },
              { key: 'gain', label: 'Load battery gained (% points)', color: MEASURE_COLOR.gain },
            ] : [
              { key: 'drop', label: 'T7 battery lost (% points)', color: MEASURE_COLOR.drop },
            ]}
            formatValue={(v) => `${v}%`}
            xLabel="hour of the cycle"
            xUnit="h"
            rotateLabels={false}
            height={280}
            emptyState={explainNoRate(cycles, isCharging ? 'a charge rate' : 'a drain rate')}
            caption={isCharging ? 'Mean T7 battery gained per hour window'
              : isRestaurant ? 'Mean T7 drain per hour, WLC active and WLC inactive'
                : testType === 'WLC on Phone' ? 'Mean T7 drain and load gain by hour of the cycle'
                  : 'Mean battery change per hour window'}
            // no table view: it repeated the bars (the lab, Oct 2026); a click on a bar lists its cycles below
          />

          {/* A bar is a mean, which is a dead end when it looks wrong: these
              rows say whether every device did that or one cycle dragged it. */}
          {hourPick == null ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Click a bar to list the cycles behind it.
            </p>
          ) : (
            <div className="hour-detail">
              <div className="hour-detail-head">
                <strong>
                  Hour {hourly.find((h) => h.h === hourPick)?.label ?? hourPick}
                  {' · '}{cyclesText(hourRuns)} · {fmtInt(new Set(hourRuns.map((r) => r.serial)).size)} device
                  {new Set(hourRuns.map((r) => r.serial)).size === 1 ? '' : 's'} · {fmtInt(hourRuns.length)} rows (one per device per cycle)
                </strong>
                <button className="btn btn-sm" onClick={() => setHourPick(null)}>Close</button>
              </div>
              {hourRuns.length === 0 ? (
                <EmptyNote>No cycle has readings at both ends of this hour.</EmptyNote>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 300 }}>
                  <SortTable caption="Cycles contributing to this hour" head={[
                    { label: 'Device', style: { textAlign: 'left' } }, { label: 'Date' }, { label: 'Build', style: { textAlign: 'left' } },
                    { label: 'Battery at start' }, { label: 'Battery at end' }, { label: isCharging ? 'Gained' : 'Lost' },
                    // the MDM never reports the load's own battery, so "Load gained" was always —;
                    // in its place, whether the WLC was active (a load on the pad) in this hour
                    ...(showPad ? [{ label: 'WLC', style: { textAlign: 'left' } }] : []), { label: 'Cycle length' },
                  ]}>
                      {hourRuns.map((r) => (
                        <tr key={r.id}>
                          <td className="serial" style={{ textAlign: 'left' }}>{fmtSerial(r.serial)}</td>
                          <td>{r.date ? fmtDate(r.date) : '—'}</td>
                          <td style={{ textAlign: 'left' }}>{r.build?.replace(' Build', '') ?? '—'}</td>
                          <td>{fmtPct(r.from)}</td>
                          <td>{fmtPct(r.to)}</td>
                          <td>{isCharging ? fmtSigned(-r.drop, 2, '%') : `${r.drop}%`}</td>
                          {showPad && <td style={{ textAlign: 'left' }}>{r.wireless == null ? '—' : r.wireless ? 'WLC active' : 'WLC inactive'}</td>}
                          <td>{fmtHours(r.duration)}</td>
                        </tr>
                      ))}
                    </SortTable>
                </div>
              )}
            </div>
          )}
        </Card></div>
      </div>

      {/* Every cycle in scope, one row each — with one device picked (Summary → a test row),
          this is that device's history for the test: which days it ran and how each went. */}
      <Card expandable title={tableSerials.length === 1 ? `Every cycle on ${tableSerials[0]}` : 'Every cycle'}
        sub={`${cyclesText(inBench)} on ${fmtInt(new Set(inBench.map((c) => c.date)).size)} days`
          + `${tableSerials.length === 1 ? '' : ` across ${fmtInt(tableSerials.length)} devices`} · newest first · click a device to show only it in the charts above · click a heading to sort${showPad ? ' · with / without WLC = drain while a load sat on the wireless pad / while it was empty, from 15-min slots (firmware v2.0.3–2.0.4 did not report the pad)' : ''} · ≈ = worked out from the cycle’s battery drop, before the MDM counter was recorded · left cycle = taken out, or no longer running the test (hover for why): counted up to then`}
        right={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="control" type="search" placeholder="Search… (e.g. 044, v2.1.030, 12 Oct)" value={tableQ}
            onChange={(e) => setTableQ(e.target.value)} style={{ width: 250 }} aria-label="Search the Every cycle table" />
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button type="button" className="btn btn-sm" disabled={!tableRows.length} onClick={() => setExportOpen((o) => !o)}
              aria-haspopup="menu" aria-expanded={exportOpen} title={`Download these ${tableRows.length} cycles as a CSV file (the search applies)`}>
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 12.8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {' '}Export CSV</button>
            {exportOpen && (
              <div className="popover popover-right export-menu" role="menu" aria-label="Export CSV">
                <button type="button" role="menuitem" className="export-opt" onClick={() => exportTable('overview')}>
                  <b>Overview</b><span>One row per cycle, as in this table ({tableRows.length} rows)</span></button>
                <button type="button" role="menuitem" className="export-opt" onClick={() => exportTable('hours')}>
                  <b>Per hour</b><span>Every device's cycles hour by hour: battery at the start and end of each hour, {isCharging ? 'gained' : 'drained'}, minutes with a load on the wireless pad, temperature</span></button>
              </div>)}
          </div>
        </div>}>
        {hoursPick && (
          <PickDevicesDialog title="Export CSV · per hour" sub={`${testType} · the devices of the cycles in this table`}
            counts={tableRows.reduce((m, c) => m.set(c.serial, (m.get(c.serial) || 0) + 1), new Map())}
            onExport={(picked) => exportTable('hours', picked)} onClose={() => setHoursPick(false)} />)}
        <div className="table-wrap" style={{ maxHeight: 460 }}>
          <SortTable caption={`Every ${testType} cycle`} head={[
            ...(tableSerials.length === 1 ? [] : [{ label: 'Device', style: { textAlign: 'left' } }]), { label: 'Date' }, { label: 'Started' }, { label: 'Ended' },
            { label: 'Cycle time' }, { label: 'Start' }, { label: isCharging ? 'Charged to' : 'End' },
            { label: isCharging ? 'Charge rate' : 'Drain' },
            ...(showPad ? [{ label: 'Drain with WLC' }, { label: 'Drain without WLC' }] : []),
            { label: 'Peak temp' }, { label: 'Battery cycles' },
            { label: 'Firmware', style: { textAlign: 'left' } }, ...(isField ? [{ label: 'WLC', style: { textAlign: 'left' } }] : []),
          ]}>
            {/* the search matches the serial, the firmware or the date as shown */}
            {tableRows.map((c) => (
              <tr key={c.id} className={tableSerials.length > 1 ? `row-link${focus === c.serial ? ' is-selected' : ''}` : undefined}
                onClick={tableSerials.length > 1 ? () => pickDevice(c.serial) : undefined}>
                {tableSerials.length !== 1 && <td style={{ textAlign: 'left' }}><button type="button" className="link-btn plain-link mono" onClick={(e) => { e.stopPropagation(); pickDevice(c.serial) }}>{fmtSerial(c.serial)}</button></td>}
                <td>{c.date ? fmtDate(c.date) : '—'}</td>
                <td>{c.start != null ? new Date(c.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td title={c.leftCycle ? `Left the cycle at ${fmtEnded(c)}: ${c.leftCycle.why}. Counted up to then.` : undefined}>{fmtEnded(c)}{c.leftCycle ? <span className="left-cycle"> · left cycle</span> : null}</td>
                <td>{fmtHours(c.duration)}</td>
                <td>{fmtPct(c.startBattery)}</td>
                <td>{fmtPct(c.endBattery)}</td>
                <td>{fmtRate(c.dropPerHr)}</td>
                {showPad && (() => { const p = padOf(c), cell = (x, what) => <td title={x ? `${fmtHours(x.hours)} ${what}` : `under 30 min ${what}`}>{x ? fmtRate(x.rate) : '—'}</td>
                  return <>{cell(p?.on, 'with a load on the pad')}{cell(p?.off, 'with the pad empty')}</> })()}
                <td>{fmtTemp(c.maxTemp)}</td>
                {/* the MDM counter where it was recorded; before that, the cycle's own battery drop ÷ 100 (≈) */}
                <td title={c.mdmCycles != null ? 'From the MDM cycle counter' : 'From this cycle’s readings: battery drop ÷ 100 (the MDM counter was not recorded yet)'}>
                  {c.mdmCycles != null ? c.mdmCycles.toFixed(2)
                    : c.startBattery != null && c.endBattery != null && c.startBattery > c.endBattery ? `≈ ${((c.startBattery - c.endBattery) / 100).toFixed(2)}` : '—'}</td>
                <td style={{ textAlign: 'left' }}>{c.firmware ?? '—'}</td>
                {isField && <td style={{ textAlign: 'left' }}>{c.padState ?? '—'}</td>}
              </tr>
            ))}
          </SortTable>
        </div>
      </Card>
    </div>
  )
}
