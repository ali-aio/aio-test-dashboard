/* ===========================================================================
   The browser database
   ---------------------------------------------------------------------------
   One IndexedDB holding two stores:

     files   kept CSV imports, so the dashboard opens onto data  (history.js)
     events  hand-written device incidents                        (events.js)
     readings  the 7-day MDM reading window per device            (window.js)

   Both live here because they share a database, and a database shared across
   modules needs one owner for its version and upgrade path.

   Nothing on this page may hang waiting for storage: every call is raced
   against a timeout, and `onblocked` is handled. Without that last one an
   upgrade stalls silently whenever another tab holds the database open, and
   since the app waits on this before first paint, the result is a blank page.
   =========================================================================== */

const DB_NAME = 't7-dashboard'
const DB_VERSION = 3          // v2 added the `events` store, v3 `readings`
const TIMEOUT_MS = 5000

export const STORES = { files: 'files', events: 'events', readings: 'readings' }

/** False in Node, in private windows that block storage, and in old browsers. */
export function isAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function withTimeout(promise, ms, what) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    }),
  ])
}

export function openDb() {
  return withTimeout(new Promise((resolve, reject) => {
    if (!isAvailable()) { reject(new Error('IndexedDB is not available in this browser')); return }

    let req
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err)
      return
    }

    /* Runs on a fresh database and on the v1 -> v2 upgrade alike, so each
       store is created only if it is missing. */
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORES.files)) {
        db.createObjectStore(STORES.files, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.events)) {
        db.createObjectStore(STORES.events, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.readings)) {
        db.createObjectStore(STORES.readings, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the database'))
    req.onblocked = () => reject(new Error(
      'The database is open in another tab. Close the other tabs and reload.',
    ))
  }), TIMEOUT_MS, 'Opening the database')
}

export function tx(db, store, mode, fn) {
  return withTimeout(new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const objectStore = t.objectStore(store)
    let result
    try {
      result = fn(objectStore)
    } catch (err) {
      reject(err)
      return
    }
    t.oncomplete = () => resolve(result?.result ?? result)
    t.onerror = () => reject(t.error ?? new Error('A database transaction failed'))
    t.onabort = () => reject(t.error ?? new Error('A database transaction was aborted'))
  }), TIMEOUT_MS, 'A database transaction')
}

/** Open, run, close — the shape every call in history.js and events.js takes. */
export async function withStore(store, mode, fn) {
  const db = await openDb()
  try {
    return await tx(db, store, mode, fn)
  } finally {
    db.close()
  }
}

/** Browser storage usage and quota, when the browser will tell us. */
export async function usage() {
  try {
    if (navigator?.storage?.estimate) {
      const { usage: used, quota } = await navigator.storage.estimate()
      return { used, quota }
    }
  } catch { /* not supported */ }
  return { used: null, quota: null }
}
