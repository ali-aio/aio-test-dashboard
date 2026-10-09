import React from 'react'
import { Stat } from './Primitives.jsx'
import { fmtLifetime, compareSerial } from '../lib/fmt.js'

// The MDM's own lifetime battery-cycle counter, summed over the devices ticked in the
// Serial filter. It is per device and lifetime only — the API cannot split it by test
// type, firmware or date — so it deliberately ignores those filters, and says so.
// `lifetime` is { value, rows: [{ serial, value }], devices, missing } from lifetimeOf().
// With a Test Date range set, `lifetime` comes from cyclesInRange() instead and carries
// `range` (its label) and `source` — the tile then shows the cycles inside that range.
const SOURCE = { counter: 'MDM counter', mixed: 'MDM counter + readings', readings: 'MDM battery readings' }
export default function LifetimeStat({ lifetime, hero = false }) {
  if (!lifetime) return null
  const missing = lifetime.missing.length
  const miss = missing ? ` · ${missing} device${missing === 1 ? '' : 's'} without readings` : ''
  return (
    <Stat label={lifetime.range ? 'Battery cycles (MDM)' : 'Lifetime cycles (MDM)'} value={fmtLifetime(lifetime.value)} hero={hero}
      foot={lifetime.range ? `${lifetime.range} — from ${SOURCE[lifetime.source]}${miss}` : (miss ? miss.replace(/^ · /, '') : undefined)}
      breakdownLabel={lifetime.range ? `Battery cycles per device · ${lifetime.range}` : 'Lifetime cycles per device (MDM)'} breakdownRight
      breakdown={lifetime.rows.slice().sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || compareSerial(a.serial, b.serial))
        .map((r) => ({ id: r.serial, label: r.serial, value: r.value ?? 0, display: fmtLifetime(r.value) }))} />
  )
}
