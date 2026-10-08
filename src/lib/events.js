/* ===========================================================================
   Device events
   ---------------------------------------------------------------------------
   The hand-written half of the record: a device was dropped, a device started
   behaving oddly, a battery was swapped. The CSVs say what the device did;
   this says what happened TO it, which is often the explanation.

   These are typed by a person and exist nowhere else — unlike an import,
   which can always be re-dropped. So they are exportable, and the UI never
   deletes one without asking.
   =========================================================================== */

import { STORES, withStore, isAvailable } from './db.js'

export { isAvailable }

/** Fixed list, so events can be counted and filtered rather than only read. */
export const EVENT_TYPES = [
  'Dropped',
  'Abnormal behaviour',
  'Overheated',
  'Repaired',
  'Battery replaced',
  'Firmware flashed',
  'Other',
]

export const EVENT_SEVERITIES = ['minor', 'serious', 'critical']

/** Severity maps onto the dashboard's existing status levels. */
export const SEVERITY_LEVEL = {
  minor: 'warning',
  serious: 'serious',
  critical: 'critical',
}

const newId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch { /* not available */ }
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Normalise whatever the form produced into a storable event.
 * Returns `{ event }` or `{ error }` — the caller shows the error rather than
 * storing something it cannot render later.
 */
export function makeEvent(input) {
  const serials = [...new Set((input.serials ?? []).filter(Boolean))]
  if (!serials.length) return { error: 'Choose at least one device.' }

  const at = Number(input.at)
  if (!Number.isFinite(at)) return { error: 'Give the event a date and time.' }

  const type = EVENT_TYPES.includes(input.type) ? input.type : 'Other'
  const severity = EVENT_SEVERITIES.includes(input.severity) ? input.severity : 'minor'
  const note = String(input.note ?? '').trim()

  if (type === 'Other' && !note) {
    return { error: 'An "Other" event needs a note saying what happened.' }
  }

  return {
    event: {
      id: input.id || newId(),
      at,
      serials,
      type,
      severity,
      note,
      createdAt: input.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    },
  }
}

/* --------------------------------------------------------------------- API */

export async function saveEvent(event) {
  await withStore(STORES.events, 'readwrite', (store) => store.put(event))
  return event
}

/** Every event, most recent first. */
export async function listEvents() {
  const all = await withStore(STORES.events, 'readonly', (store) => store.getAll())
  return (all ?? []).sort((a, b) => b.at - a.at)
}

export async function removeEvent(id) {
  await withStore(STORES.events, 'readwrite', (store) => store.delete(id))
}

export async function clearEvents() {
  await withStore(STORES.events, 'readwrite', (store) => store.clear())
}

/** Restore from an export file, keeping anything already stored. */
export async function importEvents(events) {
  let added = 0
  for (const raw of events) {
    const { event } = makeEvent(raw)
    if (!event) continue
    await saveEvent(event)
    added++
  }
  return added
}

/* ------------------------------------------------------------------ shaping */

/** serial -> its events, newest first. One event can name several devices. */
export function eventsBySerial(events) {
  const map = new Map()
  for (const e of events) {
    for (const sn of e.serials) {
      if (!map.has(sn)) map.set(sn, [])
      map.get(sn).push(e)
    }
  }
  for (const list of map.values()) list.sort((a, b) => b.at - a.at)
  return map
}

/**
 * The worst severity recorded against a device, for the flag shown beside its
 * serial in tables. Null when the device has no events.
 */
export function worstSeverity(events) {
  let worst = null
  for (const e of events) {
    if (e.severity === 'critical') return 'critical'
    if (e.severity === 'serious') worst = 'serious'
    else if (!worst) worst = 'minor'
  }
  return worst
}

/** A one-line summary for a tooltip. */
export function describeEvents(events) {
  if (!events?.length) return ''
  const counts = new Map()
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, n]) => (n > 1 ? `${type} ×${n}` : type))
    .join(' · ')
}

/** Events that fall on or before a given calendar day, for cycle context. */
export function eventsUpTo(events, isoDate) {
  if (!isoDate) return events
  const cutoff = Date.parse(`${isoDate}T23:59:59Z`)
  if (Number.isNaN(cutoff)) return events
  return events.filter((e) => e.at <= cutoff)
}
