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

// Shared on the lab laptop as device notes (server/deviceNotes.mjs): one note per device the event names, sharing the event's id as
// `group`, so it shows on each device's page and when the device is clicked in a cycle (the user, 16 Nov 2026: "I logged an event for a
// device in Summary and then searched the device — nothing is showing there"). Until then events lived in this browser's IndexedDB only;
// those are moved to the server the first time the list is read.
const by = () => { try { return localStorage.getItem('declaredBy') || '' } catch (e) { return '' } }
const post = async body => {
  const r = await fetch('/api/device-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
}
const textOf = e => `${e.type} (${e.severity})${e.note ? `: ${e.note}` : ''}`

export async function saveEvent(event) {
  // editing: the old notes go, the new ones take their place (same group)
  await post({ removeEvent: event.id }).catch(() => {})
  for (const serial of event.serials)
    await post({ serial, text: textOf(event), by: by(), event: { type: event.type, severity: event.severity, at: event.at, note: event.note, group: event.id } })
  return event
}

let migrated = false
async function moveLocalEvents(onServer) {
  if (migrated || !isAvailable()) return
  migrated = true
  try {
    const local = (await withStore(STORES.events, 'readonly', (store) => store.getAll())) || []
    for (const e of local) if (!onServer.has(e.id)) await saveEvent(e)
    if (local.length) await withStore(STORES.events, 'readwrite', (store) => store.clear())
  } catch (e) { migrated = false }
}

/** Every event, most recent first. */
export async function listEvents() {
  const read = async () => {
    const r = await fetch('/api/device-notes?events=1', { cache: 'no-store' })
    const j = r.ok ? await r.json() : { notes: [] }
    const groups = new Map()
    for (const n of j.notes || []) {
      const g = n.event.group || n.id
      if (!groups.has(g)) groups.set(g, { id: g, at: n.event.at, serials: [], type: n.event.type, severity: n.event.severity, note: n.event.note || '', createdAt: n.at, updatedAt: n.mod })
      groups.get(g).serials.push(n.serial)
    }
    return groups
  }
  let groups = await read()
  if (!migrated) { await moveLocalEvents(new Set(groups.keys())); groups = await read() }
  return [...groups.values()].sort((a, b) => b.at - a.at)
}

export async function removeEvent(id) {
  await post({ removeEvent: id })
}

export async function clearEvents() {
  for (const e of await listEvents()) await removeEvent(e.id)
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
