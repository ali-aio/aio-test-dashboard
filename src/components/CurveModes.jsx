import React, { useMemo, useState } from 'react'
import { avgCurveBy, envelopeBy } from '../lib/t7cycles.js'
import { buildStyleMap } from '../lib/palette.js'
import { compareSerial } from '../lib/fmt.js'
import { Segmented } from './Primitives.jsx'

// The "Average / Every device" switch every curve chart in v2 carries (Today has its own
// copy for clock-time charts). Built on T7's LineChart and its device picker, so the
// picker looks the same everywhere: Devices (n/N), Select all, Clear all, a swatch each.

export const CURVE_MODES = [{ id: 'avg', label: 'Average' }, { id: 'all', label: 'Every device' }]

export function ModeSwitch({ value, onChange, avgLabel = 'Average' }) {
  return <Segmented ariaLabel="Curve view" value={value} onChange={onChange}
    options={[{ id: 'avg', label: avgLabel }, { id: 'all', label: 'Every device' }]} />
}

/** One averaged curve per device. Colours come from every serial in the app, sorted, so a
 *  device has the same colour on every chart and on every tab. */
export function deviceSeries(cycles, allSerials, key = 'series') {
  const styleOf = buildStyleMap([...allSerials].sort(compareSerial))
  const src = key === 'series' ? cycles : cycles.map((c) => ({ ...c, series: c[key] || [] }))
  return avgCurveBy(src, 'serial').map((g) => ({
    id: g.label, label: g.label, sub: `${g.count} run${g.count === 1 ? '' : 's'}`,
    ...(styleOf.get(g.label) || { color: 'var(--series-1)' }), points: g.points,
  }))
}

/** Average plus the highest and lowest device at each hour, as three T7 series. */
export function envelopeSeries(cycles, key = 'series', avgLabel = 'Average') {
  const e = envelopeBy(cycles, key)
  if (!e.avg.length) return []
  return [
    { id: '__avg', label: avgLabel, sub: `${cycles.length} run${cycles.length === 1 ? '' : 's'}`, color: 'var(--series-1)', points: e.avg },
    { id: '__max', label: 'Highest', color: 'var(--series-8)', dashed: true, points: e.max },
    { id: '__min', label: 'Lowest', color: 'var(--series-3)', dashed: true, points: e.min },
  ]
}

/** The device picker's state and the LineChart props that wire it up. null = every device. */
export function useDevicePicker(series) {
  const [pick, setPick] = useState(null)
  const ids = useMemo(() => series.map((s) => s.id), [series])
  return {
    legendDisclosure: 'Devices',
    selectedSeries: pick,
    onToggleSeries: (id) => setPick((p) => {
      const n = new Set(p ?? ids); n.has(id) ? n.delete(id) : n.add(id)
      return n.size === ids.length ? null : n
    }),
    onSelectAllSeries: () => setPick(null),
    onClearAllSeries: () => setPick(new Set()),
  }
}
