import { lifetimeCycles } from '../lib/device.js'
import React, { useMemo, useState } from 'react'
import { SortTable } from '../components/SortTable.jsx'
import { Card, Stat, Pill, EmptyNote } from '../components/Primitives.jsx'
import EventForm from '../components/EventForm.jsx'
import DataQualityCard from '../components/DataQualityCard.jsx'
import { kpis, maxOf, batteryCycles } from '../lib/t7cycles.js'
import {
  eventsBySerial, worstSeverity, SEVERITY_LEVEL, removeEvent,
} from '../lib/events.js'
import { levelFor } from '../lib/palette.js'
import {
  fmtInt, fmtPct, fmtTemp, fmtHours, fmtRate, fmtDate, fmtSerial, compareSerial, DASH, fmtBC, bcText, runsText, fmtLifetime } from '../lib/fmt.js'

const fmtWhen = (ms) => {
  const d = new Date(ms)
  const date = fmtDate(d.toISOString().slice(0, 10))
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${date} · ${time}`
}

/**
 * Everything about one device in one place: what it has run, and what has
 * happened to it.
 *
 * The CSVs record what a device did. This view is where the other half goes —
 * that it was dropped on the 12th, that its charging went odd in March — which
 * is usually the explanation for whatever the numbers show.
 */
export default function DevicesView({
  cycles, allSerials, events, onEventsChanged, onFilter, onOpenTest, issues = [], files = [], snapOf = () => null }) {
  const [editing, setEditing] = useState(null)   // an event, {} for new, or null
  const [expanded, setExpanded] = useState(() => new Set())
  /* Only the devices something has been logged against, by default. A list of
     55 rows that are almost all uneventful buries the few that are not. */
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')

  const byDevice = useMemo(() => eventsBySerial(events), [events])

  const rows = useMemo(() => {
    const present = new Set(cycles.map((c) => c.serial))
    // Devices with events but no cycles in scope still belong here: the record
    // of a dropped device should not vanish because a filter excluded it.
    const serials = [...new Set([...present, ...byDevice.keys()])].sort(compareSerial)
    return serials.map((serial) => {
      const own = cycles.filter((c) => c.serial === serial)
      const own7 = byDevice.get(serial) ?? []
      const dates = own.map((c) => c.date).filter(Boolean).sort()

      /* What this device has actually been put through, test by test — the
         headline averages mix regimes, so "3 cycles" alone says very little. */
      const byTest = new Map()
      for (const c of own) {
        if (!byTest.has(c.testType)) byTest.set(c.testType, [])
        byTest.get(c.testType).push(c)
      }

      return {
        serial,
        cycles: own,
        k: kpis(own),
        events: own7,
        worst: worstSeverity(own7),
        peak: maxOf(own.map((c) => c.maxTemp)),
        firstDate: dates[0] ?? null,
        lastDate: dates[dates.length - 1] ?? null,
        tests: [...byTest.entries()]
          .map(([testType, list]) => ({
            testType,
            n: list.length,
            k: kpis(list),
            peak: maxOf(list.map((c) => c.maxTemp)),
            last: list.map((c) => c.date).filter(Boolean).sort().pop() ?? null,
          }))
          .sort((a, b) => b.n - a.n || a.testType.localeCompare(b.testType)),
        // MDM runs carry build: null (the API reports no hardware build) — not a build to list
        builds: [...new Set(own.map((c) => c.build).filter((b) => b != null && b !== 'Unknown'))],
        firmwares: [...new Set(own.map((c) => c.firmware).filter((f) => f !== 'Unknown'))],
      }
    })
  }, [cycles, byDevice])

  /* Searching the build and firmware alongside the serial means "which devices
     ran V-1.62" is answerable here too, not only by going back to the filters.
     A search looks at every device: someone typing a serial wants that device,
     whether or not anything has been logged against it. */
  const searching = query.trim().length > 0
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (!q) return showAll || r.events.length > 0
      return [r.serial, ...r.builds, ...r.firmwares]
        .some((v) => v && String(v).toLowerCase().includes(q))
    })
  }, [rows, showAll, query])

  const withEvents = rows.filter((r) => r.events.length).length
  const criticalDevices = rows.filter((r) => r.worst === 'critical').length

  const toggle = (serial) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(serial)) next.delete(serial)
    else next.add(serial)
    return next
  })

  const onDelete = async (ev) => {
    const when = fmtWhen(ev.at)
    if (!window.confirm(`Delete the "${ev.type}" event on ${when}?\n\nThis cannot be undone.`)) return
    await removeEvent(ev.id)
    onEventsChanged()
  }

  if (!rows.length) return <EmptyNote>No devices in scope.</EmptyNote>

  return (
    <div className="view-stack">
      <div className="stat-row">
        <Stat label="Devices" value={fmtInt(rows.length)} hero
          foot={`${fmtLifetime(rows.reduce((a, r) => { const v = lifetimeCycles(snapOf(r.serial)); return v == null ? a : (a ?? 0) + v }, null))} lifetime cycles (MDM)`} />
        <Stat label="With a recorded event" value={fmtInt(withEvents)}
          foot={<Pill level={withEvents ? 'warning' : 'good'}>
            {withEvents ? `${((withEvents / rows.length) * 100).toFixed(0)}% of devices` : 'none logged'}
          </Pill>} />
        <Stat label="Critical events" value={fmtInt(criticalDevices)}
          foot={<Pill level={criticalDevices ? 'critical' : 'good'}>
            {criticalDevices ? 'devices needing attention' : 'none recorded'}
          </Pill>} />
        <Stat label="Events logged" value={fmtInt(events.length)}
          foot="across every device" />
      </div>

      {/* the device list moved to the bottom of the Overview (components/DeviceTable.jsx) */}

      <DataQualityCard issues={issues} files={files} />

      {editing && (
        <EventForm
          event={editing}
          allSerials={allSerials}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onEventsChanged() }}
        />
      )}
    </div>
  )
}
