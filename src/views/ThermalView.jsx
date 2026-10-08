import React, { useMemo, useState } from 'react'
import { Card, Stat, EmptyNote } from '../components/Primitives.jsx'
import { ModeSwitch, envelopeSeries } from '../components/CurveModes.jsx'
import { LineChart, Heatmap } from '../components/t7charts.jsx'
import {
  kpis, mean, median, maxOf, minOf, explainEmpty, plottedMaxHour } from '../lib/t7cycles.js'
import { thermalTimingByDevice } from '../lib/thermal.js'
import {
  buildColorMap, buildStyleMap, MAX_SERIES, STATUS_ICON,
} from '../lib/palette.js'
import {
  fmtInt, fmtNum, fmtTemp, fmtHourTick, fmtDate, fmtSerial, compareSerial, DASH,
} from '../lib/fmt.js'

export default function ThermalView({ cycles, allSerials, onFilter }) {
  const withTemp = useMemo(() => cycles.filter((c) => c.tempSeries.length), [cycles])
  const k = useMemo(() => kpis(cycles), [cycles])
  const colorMap = useMemo(() => buildStyleMap([...allSerials].sort(compareSerial)), [allSerials])

  /* Every temperature reading in scope, behind the median readout. */
  const allTemps = useMemo(
    () => withTemp.flatMap((c) => c.tempSeries.map((p) => p.v)),
    [withTemp],
  )

  /* Temperature over elapsed time, one line per device (longest cycle). Every
     device is built, not just the few that fit — which ones are drawn is the
     reader's choice below. */
  const curves = useMemo(() => {
    const picked = new Map()
    const order = []
    for (const c of withTemp) {
      const prior = picked.get(c.serial)
      if (!prior) { order.push(c.serial); picked.set(c.serial, c) }
      else if ((c.duration ?? 0) > (prior.duration ?? 0)) picked.set(c.serial, c)
    }
    return order.sort(compareSerial).map((sn) => ({
      id: sn,
      label: fmtSerial(sn),
      ...(colorMap.get(sn) ?? { color: 'var(--series-1)' }),
      points: picked.get(sn).tempSeries,
    }))
  }, [withTemp, colorMap])

  /* Only so many lines stay apart by colour, so the chart opens on a subset.
     The hottest ones, since that is the question this page exists to answer —
     opening on the lowest serial numbers picked devices for no reason at all. */
  const hottestFirst = useMemo(() => {
    const peak = new Map()
    for (const c of withTemp) {
      if (c.maxTemp == null) continue
      if (!peak.has(c.serial) || c.maxTemp > peak.get(c.serial)) peak.set(c.serial, c.maxTemp)
    }
    return new Set([...peak.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SERIES)
      .map(([serial]) => serial))
  }, [withTemp])

  const [devicePick, setDevicePick] = useState(null)
  const shownDevices = devicePick ?? hottestFirst
  const toggleDevice = (serial) => setDevicePick((current) => {
    const next = new Set(current ?? hottestFirst)
    if (next.has(serial)) next.delete(serial)
    else next.add(serial)
    return next
  })

  // Every device (T7's view: the hottest few, picker to change) or the average across runs.
  const [tempMode, setTempMode] = useState('all')
  const avgTemp = useMemo(() => envelopeSeries(withTemp, 'tempSeries', 'Average temperature'), [withTemp])
  const maxHour = useMemo(
    () => plottedMaxHour(withTemp, 'tempSeries'),
    [withTemp],
  )

  /* Device x elapsed-hour mean temperature — sequential magnitude, one hue. */
  const heat = useMemo(() => {
    const acc = new Map()
    let lo = Infinity
    let hi = -Infinity
    for (const c of withTemp) {
      for (const p of c.tempSeries) {
        const h = Math.round(p.t)
        if (Math.abs(p.t - h) > 0.25) continue
        const key = `${c.serial}|${h}`
        if (!acc.has(key)) acc.set(key, { row: c.serial, col: String(h), vals: [] })
        acc.get(key).vals.push(p.v)
      }
    }
    const cells = []
    for (const v of acc.values()) {
      const m = mean(v.vals)
      if (m == null) continue
      cells.push({ row: v.row, col: v.col, value: m, n: v.vals.length })
      if (m < lo) lo = m
      if (m > hi) hi = m
    }
    const rows = [...new Set(cells.map((c) => c.row))].sort(compareSerial)
    const maxCol = Math.max(0, maxOf(cells.map((c) => Number(c.col)), 0))
    const cols = Array.from({ length: Math.min(maxCol + 1, 36) }, (_, i) => String(i))
    return {
      cells, rows, cols,
      lo: Number.isFinite(lo) ? Math.floor(lo) : 20,
      hi: Number.isFinite(hi) ? Math.ceil(hi) : 60,
    }
  }, [withTemp])

  const timing = useMemo(() => thermalTimingByDevice(withTemp), [withTemp])
  const timedCycles = timing.reduce((n, row) => n + row.cycles, 0)

  /* Hottest first on the first click, coolest on the second — a temperature
     column is read for its extremes, so neither end is a sensible default to
     bury. Names and patterns run A-Z instead, where there is no hot end. */
  const [timingSort, setTimingSort] = useState({ key: 'serial', flip: false })
  const sortTiming = (key) => setTimingSort((s) => (
    s.key === key ? { key, flip: !s.flip } : { key, flip: false }
  ))

  /* Peak temperature per device, listed by serial. */
  const peakRows = useMemo(() => {
    const byDevice = new Map()
    for (const c of cycles) {
      if (c.maxTemp == null) continue
      const prior = byDevice.get(c.serial)
      if (!prior || c.maxTemp > prior.peak) {
        byDevice.set(c.serial, { peak: c.maxTemp, cycle: c })
      }
    }
    return [...byDevice.entries()]
      .map(([serial, v]) => ({
        id: serial, label: fmtSerial(serial), value: v.peak, cycle: v.cycle,
        display: `${v.peak.toFixed(1)} °C`,
      }))
      .sort((a, b) => compareSerial(a.id, b.id))
  }, [cycles])

  const peakBySerial = useMemo(
    () => new Map(peakRows.map((r) => [r.id, r.value])),
    [peakRows],
  )

  const sortedTiming = useMemo(() => {
    const field = (row) => ({
      serial: row.serial,
      peak: peakBySerial.get(row.serial),
      start: row.phases[0], middle: row.phases[1], end: row.phases[2],
      pattern: row.pattern,
      cycles: row.cycles,
    })[timingSort.key]
    const dir = timingSort.flip ? -1 : 1

    return [...timing].sort((a, b) => {
      const av = field(a)
      const bv = field(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1          // a device with no reading sits at the end
      if (bv == null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv)
      return dir * (bv - av)            // hottest / most first
    })
  }, [timing, timingSort, peakBySerial])

  /* "59.2 °C" on its own is not actionable — these rows say which run it was,
     when, and how far into the run the peak landed, and clicking one filters
     the dashboard down to that device and date. */
  const hottestCycles = useMemo(() => {
    const withPeak = cycles.filter((c) => c.maxTemp != null)
    return [...withPeak]
      .sort((a, b) => b.maxTemp - a.maxTemp)
      .slice(0, 25)
      .map((c) => {
        const at = c.tempSeries.reduce(
          (best, p) => (best == null || p.v > best.v ? p : best), null,
        )
        const when = at ? `peaked ${fmtNum(at.t, 1)} h in` : null
        return {
          id: c.id,
          cycle: c,
          label: c.serial,
          value: c.maxTemp,
          display: fmtTemp(c.maxTemp),
          sub: [c.testType, c.date ? fmtDate(c.date) : null, when, `${fmtNum(c.duration, 1)} h run`]
            .filter(Boolean).join(' · '),
          onClick: onFilter
            ? () => onFilter({ serials: [c.serial], date: c.date ?? '' })
            : undefined,
        }
      })
  }, [cycles, onFilter])

  const rowsAbove = (threshold) => hottestCycles.filter((r) => r.value >= threshold)
  const hottest = hottestCycles.reduce((best, row) =>
    !best || row.value > best.value ? row : best, null)?.cycle ?? null

  const hotCycles = cycles.filter((c) => c.maxTemp != null && c.maxTemp >= 55).length
  const veryHot = cycles.filter((c) => c.maxTemp != null && c.maxTemp >= 60).length
  const peakOverall = maxOf(peakRows.map((row) => row.value))

  if (!cycles.length) return <EmptyNote>No finished runs match the current filters. A run is listed once it ends — the one in progress is on Today.</EmptyNote>

  if (!withTemp.length) {
    return (
      <div className="banner banner-warn">
        <span aria-hidden="true">{STATUS_ICON.warning}</span>
        <div>
          None of the {cycles.length} runs in scope carries a temperature curve, so there is nothing to
          chart. The MDM does report battery temperature, but the 30-minute sweep stores only each
          cycle's summary — the per-sample curve these charts need exists just for runs inside the
          7-day history window this page reads. Narrow the date filter to the last week, or have the
          sweep keep per-cycle temperature so older runs can be charted too.
        </div>
      </div>
    )
  }

  return (
    <div className="view-stack">
      <div className="stat-row">
        <Stat label="Hottest it ever got" value={fmtNum(peakOverall, 1)} unit="°C" hero
          foot={hottest
            ? `${hottest.serial}${hottest.date ? ` · ${fmtDate(hottest.date)}` : ''}`
            : DASH}
          breakdown={hottestCycles} breakdownWide
          breakdownLabel="Hottest runs · hottest first — click one to isolate it" />
        <Stat label="Typical hottest point" value={fmtNum(k.avgPeakTemp, 1)} unit="°C"
          foot={`averaged over ${fmtInt(withTemp.length)} runs`} />
        <Stat label="Middle of all readings" value={fmtNum(median(allTemps), 1)} unit="°C"
          foot={`half of the ${fmtInt(allTemps.length)} readings are above this`} />
        <Stat label="Runs that got hot (55 °C+)" value={fmtInt(hotCycles)}
          foot={cycles.length ? `${((hotCycles / cycles.length) * 100).toFixed(0)}% of all runs` : DASH}
          breakdown={rowsAbove(55)} breakdownWide
          breakdownLabel="Runs that reached 55 °C" />
        <Stat label="Runs that got very hot (60 °C+)" value={fmtInt(veryHot)}
          foot={veryHot ? 'worth investigating' : 'none recorded'}
          breakdown={rowsAbove(60)} breakdownWide
          breakdownLabel="Runs that reached 60 °C" />
        <Stat label="Runs with no temperature recorded" value={fmtInt(cycles.length - withTemp.length)}
          foot="left out of everything on this page" />
      </div>

      <Card expandable title={tempMode === 'avg' ? 'How hot runs get, on average' : 'How hot each device gets during a run'}
        sub={tempMode === 'avg' ? 'Mean battery temperature at each whole hour, with the hottest and coolest device'
          : 'One line per device, following its longest run that recorded temperature'}
        right={<ModeSwitch value={tempMode} onChange={setTempMode} />}>
        <LineChart
          series={tempMode === 'avg' ? avgTemp : curves}
          xDomain={[0, maxHour]}
          formatX={fmtHourTick}
          formatY={(v) => `${v}°`}
          xLabel="elapsed time"
          xUnit="h"
          yLabel="°C"
          valueLabel="board temperature"
          height={320}
          markers={false}
          legendDisclosure={tempMode === 'all' ? 'Devices' : undefined}
          selectedSeries={tempMode === 'all' ? shownDevices : null}
          onToggleSeries={tempMode === 'all' ? toggleDevice : undefined}
          onSelectAllSeries={() => setDevicePick(new Set(curves.map((s) => s.id)))}
          onClearAllSeries={() => setDevicePick(new Set())}
          legendNote={tempMode === 'all' && curves.length > shownDevices.size
            ? `Showing ${shownDevices.size} of ${curves.length} devices — the hottest by default, and only so many lines keep their own colour. Use Devices above to change which.`
            : null}
          emptyState={explainEmpty(cycles, (c) => c.tempSeries.length, 'a battery temperature curve')}
          caption="battery temperature over elapsed hours, per device"
          tableColumns={[
            { key: 'serial', label: tempMode === 'all' ? 'Serial' : 'Line' },
            { key: 'peak', label: 'Peak' },
            { key: 'avg', label: 'Mean' },
            { key: 'min', label: 'Lowest' },
          ]}
          // the table follows the chart: the ticked devices, or the average / highest / lowest lines
          tableRows={(tempMode === 'all' ? curves.filter((s) => shownDevices.has(s.id)) : avgTemp).map((s) => {
            const vals = s.points.map((p) => p.v)
            return {
              serial: tempMode === 'all' ? s.id : s.label,
              peak: fmtTemp(maxOf(vals)),
              avg: fmtTemp(mean(vals)),
              min: fmtTemp(minOf(vals)),
            }
          })}
        />
      </Card>

      <Card expandable title="Is a device hot early or late in a run?"
        sub="Every run is split into three equal parts, and this is the average temperature in each. Click a heading to sort — hottest first, click again for coolest.">
        {timing.length ? (
          <div className="table-wrap" style={{ maxHeight: 440 }}>
            <table className="data thermal-timing">
              <caption className="sr-only">Average battery temperature by device and phase of the cycle</caption>
              <thead><tr>
                {[
                  { key: 'serial', label: 'Device' },
                  { key: 'peak', label: 'Hottest it got' },
                  { key: 'start', label: 'Start' },
                  { key: 'middle', label: 'Middle' },
                  { key: 'end', label: 'End' },
                  { key: 'pattern', label: 'Pattern' },
                  { key: 'cycles', label: 'Runs' },
                ].map((col) => (
                  <th key={col.key} onClick={() => sortTiming(col.key)} style={{ cursor: 'pointer' }}
                    aria-sort={timingSort.key === col.key
                      ? (timingSort.flip ? 'ascending' : 'descending') : 'none'}>
                    {col.label}
                    {timingSort.key === col.key && (
                      <span className="sort-caret" aria-hidden="true">
                        {timingSort.flip ? ' ▼' : ' ▲'}
                      </span>
                    )}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {sortedTiming.map((row) => (
                  <tr key={row.serial}>
                    <td className="serial">{fmtSerial(row.serial)}</td>
                    <td>{fmtTemp(peakBySerial.get(row.serial))}</td>
                    {row.phases.map((v, i) => <td key={i}>{fmtTemp(v)}</td>)}
                    <td>{row.pattern}</td>
                    <td>{fmtInt(row.cycles)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyNote>No run recorded a temperature in all three parts, so there is nothing to compare.</EmptyNote>}
        <p className="hint" style={{ margin: '10px 0 0' }}>
          Every run counts once, however long it was. {fmtInt(timedCycles)} of {fmtInt(withTemp.length)}
          {' '}runs recorded a temperature in all three parts and could be used. Pick a single test above to
          compare like with like.
        </p>
      </Card>

      <Card collapsible expandable title="Which hour of a run each device is hottest"
        sub="Average temperature at each hour — the darker the square, the hotter it was">
        <Heatmap
          rows={heat.rows}
          cols={heat.cols}
          cells={heat.cells}
          lo={heat.lo}
          hi={heat.hi}
          formatValue={(v) => v.toFixed(1)}
          unit=" °C"
          colLabel="elapsed hour"
          colUnit="h"
          labelW={150}
          emptyState={explainEmpty(cycles, (c) => c.tempSeries.length, 'a battery temperature curve')}
          caption="Mean battery temperature by device and elapsed hour"
          tableColumns={[
            { key: 'serial', label: 'Serial' },
            { key: 'hottest', label: 'Hottest hour' },
            { key: 'peak', label: 'Average at that hour' },
            { key: 'swing', label: 'Hottest minus coolest' },
          ]}
          tableRows={heat.rows.map((serial) => {
            const own = heat.cells.filter((c) => c.row === serial)
            if (!own.length) return { serial, hottest: '—', peak: '—', swing: '—' }
            const hot = own.reduce((a, b) => (b.value > a.value ? b : a))
            const cold = own.reduce((a, b) => (b.value < a.value ? b : a))
            return {
              serial,
              hottest: `${hot.col}h`,
              peak: fmtTemp(hot.value),
              swing: fmtTemp(hot.value - cold.value),
            }
          })}
        />
      </Card>

    </div>
  )
}
