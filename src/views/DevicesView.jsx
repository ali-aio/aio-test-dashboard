import { lifetimeCycles } from '../lib/device.js'
import React, { useMemo, useState } from 'react'
import { Card, Stat, Pill, EmptyNote } from '../components/Primitives.jsx'
import EventForm from '../components/EventForm.jsx'
import DataQualityCard from '../components/DataQualityCard.jsx'
import { kpis, maxOf, batteryCycles } from '../lib/t7cycles.js'
import {
  eventsBySerial, worstSeverity, SEVERITY_LEVEL, removeEvent,
} from '../lib/events.js'
import { levelFor } from '../lib/palette.js'
import {
  fmtInt, fmtPct, fmtTemp, fmtHours, fmtRate, fmtDate, fmtSerial, compareSerial, DASH, fmtBC, bcText, fmtLifetime } from '../lib/fmt.js'

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
  cycles, allSerials, events, onEventsChanged, onFilter, issues = [], files = [], snapOf = () => null }) {
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
          foot={`${fmtBC(batteryCycles(cycles))} cycles in scope`} />
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

      <Card
        title={searching || showAll ? 'Devices' : 'Devices with something logged'}
        sub={searching
          ? `${fmtInt(shown.length)} of ${fmtInt(rows.length)} device${rows.length === 1 ? '' : 's'} matching “${query.trim()}”`
          : showAll
            ? 'Every device in scope — what it has run, and what has happened to it'
            : 'Devices something has been recorded against. The rest are below.'}
        right={
          <div className="row" style={{ gap: 8 }}>
            <input className="control" placeholder="Search devices…" value={query}
              aria-label="Search devices by serial, build or firmware"
              onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
              <span aria-hidden="true">＋</span> Log an event
            </button>
          </div>
        }>

        {/* One control in one place, the caret carrying the state — a button
            that also renames itself makes the reader re-read it every time,
            and parking it below 55 rows means scrolling back to undo. It sits
            outside the list so an empty one is still a click from the rest. */}
        {!searching && (
          <div className="device-more is-above">
            <button className="btn btn-sm" onClick={() => setShowAll((s) => !s)}
              aria-expanded={showAll}>
              <span aria-hidden="true">{showAll ? '▾' : '▸'}</span>
              {' '}Show all {fmtInt(rows.length)} devices
            </button>
          </div>
        )}

        {!shown.length ? (
          <EmptyNote>
            {searching
              ? `No device matches “${query.trim()}”. The search covers serials, builds and firmware.`
              : 'Nothing has been logged against any device yet — open the full list above to find one.'}
          </EmptyNote>
        ) : (
          <div className="device-list">
            {shown.map((r) => {
              const open = expanded.has(r.serial)
              return (
                <div key={r.serial} className={`device-row${open ? ' is-open' : ''}`}>
                  <button type="button" className="device-head" onClick={() => toggle(r.serial)}
                    aria-expanded={open}>
                    <span className="device-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    <span className="device-name">{fmtSerial(r.serial)}</span>

                    {r.worst && (
                      <Pill level={SEVERITY_LEVEL[r.worst]}>
                        {r.events.length} event{r.events.length === 1 ? '' : 's'}
                      </Pill>
                    )}

                    {/* Counts only. Spelling out every firmware string here ran
                        the row off the screen; the full lists are a click away. */}
                    <span className="device-meta">
                      {r.cycles.length
                        ? <>
                            {bcText(batteryCycles(r.cycles))}
                            {r.builds.length ? ` · ${fmtInt(r.builds.length)} build${r.builds.length === 1 ? '' : 's'}` : ''}
                            {r.firmwares.length ? ` · ${fmtInt(r.firmwares.length)} firmware version${r.firmwares.length === 1 ? '' : 's'}` : ''}
                            {r.lastDate ? ` · last ran ${fmtDate(r.lastDate)}` : ''}
                          </>
                        : <span className="muted">no runs in the current filters</span>}
                      {` · ${fmtLifetime(lifetimeCycles(snapOf(r.serial)))} lifetime cycles (MDM)`}
                    </span>

                    {Number.isFinite(r.peak) && (
                      <Pill level={levelFor('peakTemp', r.peak)}>{fmtTemp(r.peak)}</Pill>
                    )}
                  </button>

                  {open && (
                    <div className="device-body">
                      {r.cycles.length > 0 ? (
                        <>
                          <dl className="device-figures">
                            <div><dt>Lifetime cycles (MDM)</dt><dd>{fmtLifetime(lifetimeCycles(snapOf(r.serial)))}</dd></div>
                            <div><dt>Runs</dt><dd>{fmtInt(r.cycles.length)}</dd></div>
                            <div><dt>Test types</dt><dd>{fmtInt(r.tests.length)}</dd></div>
                            <div><dt>Test days</dt><dd>{fmtInt(r.k.dates)}</dd></div>
                            <div><dt>First run</dt><dd>{r.firstDate ? fmtDate(r.firstDate) : DASH}</dd></div>
                            <div><dt>Last run</dt><dd>{r.lastDate ? fmtDate(r.lastDate) : DASH}</dd></div>
                            <div><dt>Avg run time</dt><dd>{fmtHours(r.k.avgDuration)}</dd></div>
                            <div><dt>Avg drain</dt><dd>{fmtRate(r.k.avgDropPerHr)}</dd></div>
                            <div><dt>Avg end battery</dt><dd>{fmtPct(r.k.avgEndBattery)}</dd></div>
                            <div><dt>Avg peak temp</dt><dd>{fmtTemp(r.k.avgPeakTemp)}</dd></div>
                            <div><dt>Hottest run</dt><dd>{Number.isFinite(r.peak) ? fmtTemp(r.peak) : DASH}</dd></div>
                          </dl>

                          <h4 className="device-sub">What it has run</h4>
                          <div className="table-wrap">
                            <table className="data">
                              <caption className="sr-only">Tests this device has run</caption>
                              <thead><tr>
                                <th style={{ textAlign: 'left' }}>Test</th>
                                <th>Runs</th>
                                <th>Avg run time</th>
                                <th>Avg drain</th>
                                <th>Avg peak temp</th>
                                <th>Hottest</th>
                                <th>Last run</th>
                              </tr></thead>
                              <tbody>
                                {r.tests.map((tst) => (
                                  <tr key={tst.testType}>
                                    <td style={{ textAlign: 'left' }}>{tst.testType}</td>
                                    <td>{fmtInt(tst.n)}</td>
                                    <td>{fmtHours(tst.k.avgDuration)}</td>
                                    <td>{fmtRate(tst.k.avgDropPerHr)}</td>
                                    <td>{fmtTemp(tst.k.avgPeakTemp)}</td>
                                    <td>{Number.isFinite(tst.peak) ? fmtTemp(tst.peak) : DASH}</td>
                                    <td>{tst.last ? fmtDate(tst.last) : DASH}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <p className="hint" style={{ margin: '0 0 10px' }}>
                          No runs for this device under the current filters.
                        </p>
                      )}

                      {(r.builds.length > 0 || r.firmwares.length > 0) && (
                        <div className="device-history">
                          <h4 className="device-sub">Builds and firmware</h4>
                          {r.builds.length > 0 && (
                            <p>
                              <span className="hint">Builds run</span>
                              {r.builds.map((b) => (
                                <span key={b} className="tag">{b.replace(' Build', '')}</span>
                              ))}
                            </p>
                          )}
                          {r.firmwares.length > 0 && (
                            <p>
                              <span className="hint">Firmware versions run</span>
                              {r.firmwares.map((f) => (
                                <span key={f} className="tag tag-fw">{f}</span>
                              ))}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                        <button className="btn btn-sm" onClick={() => setEditing({ serials: [r.serial] })}>
                          <span aria-hidden="true">＋</span> Log an event for this device
                        </button>
                        {r.cycles.length > 0 && onFilter && (
                          <button className="btn btn-sm" onClick={() => onFilter({ serials: [r.serial] })}>
                            Filter the dashboard to it
                          </button>
                        )}
                      </div>

                      {r.events.length === 0 ? (
                        <p className="hint" style={{ margin: 0 }}>Nothing logged for this device.</p>
                      ) : (
                        <ol className="event-log">
                          {r.events.map((ev) => (
                            <li key={ev.id} className="event-item">
                              <Pill level={SEVERITY_LEVEL[ev.severity]}>{ev.severity}</Pill>
                              <span className="event-main">
                                <span className="event-type">{ev.type}</span>
                                <span className="hint">{fmtWhen(ev.at)}</span>
                                {ev.note && <span className="event-note">{ev.note}</span>}
                                {ev.serials.length > 1 && (
                                  <span className="hint">
                                    also: {ev.serials.filter((s) => s !== r.serial).sort(compareSerial).join(', ')}
                                  </span>
                                )}
                              </span>
                              <span className="row" style={{ gap: 4 }}>
                                <button className="btn btn-sm" onClick={() => setEditing(ev)}>Edit</button>
                                <button className="btn btn-sm" onClick={() => onDelete(ev)}>Delete</button>
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

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
