import React from 'react'
import { Stat } from './Primitives.jsx'
import { fmtLifetime, compareSerial } from '../lib/fmt.js'

// The MDM's own lifetime battery-cycle counter, summed over the devices ticked in the
// Serial filter. It is per device and lifetime only — the API cannot split it by test
// type, firmware or date — so it deliberately ignores those filters, and says so.
// `lifetime` is { value, rows: [{ serial, value }], devices, missing } from lifetimeOf().
export default function LifetimeStat({ lifetime, hero = false }) {
  if (!lifetime) return null
  const missing = lifetime.missing.length
  return (
    <Stat label="Lifetime cycles (MDM)" value={fmtLifetime(lifetime.value)} hero={hero}
      foot={`lifetime, all tests — from MDM${missing ? ` · ${missing} device${missing === 1 ? '' : 's'} not reporting` : ''}`}
      breakdownLabel="Lifetime cycles per device (MDM)" breakdownRight
      breakdown={lifetime.rows.slice().sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || compareSerial(a.serial, b.serial))
        .map((r) => ({ id: r.serial, label: r.serial, value: r.value ?? 0, display: fmtLifetime(r.value) }))} />
  )
}
