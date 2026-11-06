// Firmware tests: which devices run a test firmware, from when, and what part of it is being tested (the user, 6 Nov 2026).
// While a device is on one it is not part of the bench: left out of Today's cycle, of Auto's benches and of the Charging Cycle.
// Stored on the lab laptop (server/fwTests.mjs, data/fw-tests.json). Plain JS: the server's Auto plan uses the rules below too.

/** Was this device on a firmware test at moment t? */
export const onFwTest = (tests, serial, t) => (tests || []).some(x => (x.serials || []).includes(serial) && t >= x.startedAt && (x.endedAt == null || t <= x.endedAt));
/** runsBySerial without the runs that started on a firmware test. */
export const withoutFwRuns = (runsBySerial, tests) => Object.fromEntries(Object.entries(runsBySerial).map(([sn, runs]) => [sn, (runs || []).filter(r => !onFwTest(tests, sn, r.start))]));

// ── the browser's copy ── (the last copy kept in localStorage, so Today picks the right devices on its first draw)
const KEY = 'fwTests';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
let tests = read(), loaded = false;
const subs = new Set();
const snap = { get v() { return tests; } };
const setTests = (next) => {
  loaded = true;
  if (JSON.stringify(next) === JSON.stringify(tests)) { subs.forEach(f => f()); return; }
  tests = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
  subs.forEach(f => f());
};
export const subscribeFw = (f) => { subs.add(f); return () => subs.delete(f); };
export const getFw = () => snap.v;
export const fwLoaded = () => loaded;
const pull = () => fetch('/api/fw-tests', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => { if (j?.tests) setTests(j.tests); }).catch(() => {});
export function startFwSync() {
  pull();
  const t = setInterval(pull, 60e3);
  return () => clearInterval(t);
}
/** Add ({ add: {...} }), edit ({ edit: id, ...fields }) or remove ({ remove: id }). */
export async function saveFw(body) {
  const r = await fetch('/api/fw-tests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) {}
  if (r.ok && j?.tests) setTests(j.tests);
  return { ok: r.ok, http: r.status, ...(j || {}) };
}
