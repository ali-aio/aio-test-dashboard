// Keeps this browser's Cycle plan in step with the shared copy on the dashboard server
// (server/plan.mjs, data/plan.json), so every device and person sees the same plan and
// the same take-out records. Plain JS, no React; views subscribe to the version number.
//
//   pull  — on start, every minute and on returning to the tab: the server copy replaces
//           the browser copy when it is newer (rev changed).
//   push  — every save (plan.js calls the sink): the browser copy goes up with the rev it
//           was based on. If someone else saved in between (409), their cycles and ours
//           are merged by id — ours win for the ids we just changed — and sent again.
//   first — a server that has never stored this group's plan takes this browser's, so
//           plans made before sharing existed are not lost.
// Served without the backend (no /api/plan), it stays per browser, exactly as before.
import { setPlanSink, rawPlan, writeRawPlan, mergeDecl3 } from './plan.js';
// group -> Map(id -> the entry as last seen on the server): the common copy a 409 merges both saves against
const bases = new Map();
const setBase = (group, decls) => bases.set(group, new Map((decls || []).map(d => [d.id, JSON.parse(JSON.stringify(d))])));
// groups with a save not yet on the server (its push failed, e.g. the server was restarting): a pull must not replace it
// (the user, 12 Nov 2026: a take-out "got back in by itself" — the failed save was overwritten by the next minute's pull)
const dirty = new Set();
/** The server's copy with this browser's unsaved changes laid over it, entry by entry (mergeDecl3). */
function overlay(group, srv) {
  const local = rawPlan(group), theirs = new Map(srv.decls.map(d => [d.id, d])), base = bases.get(group) || new Map();
  const mine = new Set(local.decls.map(d => d.id));
  return { decls: [...srv.decls.filter(d => !mine.has(d.id)),
    ...local.decls.map(d => (theirs.has(d.id) ? mergeDecl3(base.get(d.id), d, theirs.get(d.id)) : d))], rota: { ...srv.rota, ...local.rota } };
}

const state = { v: 0, status: 'local', at: null, error: null };
const subs = new Set();
// group -> server rev this browser's copy is based on. Kept in localStorage: a browser that
// has never synced merges its own plans into the shared copy once; after that the shared
// copy wins, so an old browser cannot bring back cycles someone deleted.
const REVKEY = g => `cyclePlan:rev:v1:${g}`;
const revs = {
  get: g => { try { const v = localStorage.getItem(REVKEY(g)); return v == null ? undefined : +v; } catch (e) { return undefined; } },
  set: (g, v) => { try { localStorage.setItem(REVKEY(g), String(v)); } catch (e) {} },
};
let snapshot = { ...state };
const bump = () => { state.v++; snapshot = { ...state }; subs.forEach(f => f()); };
export const subscribePlan = f => { subs.add(f); return () => subs.delete(f); };
export const getPlanSync = () => snapshot;

const url = group => `/api/plan?group=${encodeURIComponent(group)}`;
const set = (patch) => { Object.assign(state, patch); snapshot = { ...state }; subs.forEach(f => f()); };

export async function pullPlan(group) {
  let srv;
  try {
    const r = await fetch(url(group), { cache: 'no-store' });
    if (!r.ok) { if (r.status === 404) set({ status: 'local' }); return; }
    srv = await r.json();
  } catch (e) { set({ status: 'offline', error: e.message }); return; }
  if (srv.rev === 0) {
    // nothing shared yet: offer this browser's plan, if it has one
    const local = rawPlan(group);
    revs.set(group, 0);
    if (local.decls.length || Object.keys(local.rota).length) await pushPlan(group);
    else set({ status: 'synced', at: Date.now(), error: null });
    return;
  }
  if (revs.get(group) === undefined) {
    // first time this browser meets the shared plan: add its own cycles the server lacks
    // same id + same cycle = already shared; same id but a different cycle (two browsers
    // both numbered theirs D-001) = keep both, renaming ours
    const local = rawPlan(group), byId = new Map(srv.decls.map(d => [d.id, d]))
    const same = (a, b) => a.from === b.from && a.testType === b.testType && a.startTime === b.startTime
    const extra = local.decls.filter(d => !byId.has(d.id) || !same(byId.get(d.id), d))
      .map(d => (byId.has(d.id) ? { ...d, id: `${d.id}-${Math.random().toString(36).slice(2, 6)}` } : d))
    writeRawPlan(group, { decls: [...srv.decls, ...extra], rota: { ...local.rota, ...srv.rota } });
    revs.set(group, srv.rev); bump();
    if (extra.length) await pushPlan(group);
    else set({ status: 'synced', at: Date.now(), error: null });
    return;
  }
  if (revs.get(group) !== srv.rev && dirty.has(group)) {
    // a save of ours never reached the server: keep it on top of the newer copy and send it again
    writeRawPlan(group, overlay(group, srv)); setBase(group, srv.decls);
    revs.set(group, srv.rev); bump();
    await pushPlan(group);
    return;
  }
  if (revs.get(group) !== srv.rev) {
    writeRawPlan(group, srv); setBase(group, srv.decls);
    revs.set(group, srv.rev);
    set({ status: 'synced', at: Date.now(), error: null });
    bump();
  } else if (dirty.has(group)) await pushPlan(group); // the server has nothing newer, but our last save didn't arrive: send it again
  else set({ status: 'synced', at: Date.now(), error: null });
}

let pushing = Promise.resolve();
export function pushPlan(group) {
  // one save at a time, in order
  pushing = pushing.then(() => doPush(group)).catch(() => {});
  return pushing;
}
async function doPush(group, retry = true) {
  const local = rawPlan(group);
  try {
    const r = await fetch(url(group), { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...local, baseRev: revs.get(group) || 0 }) });
    if (r.status === 409 && retry) {
      const { current } = await r.json();
      // both saves kept, field by field (take-outs and reboot counts per device), against the copy both started from
      // (mergeDecl3; without one, the newer copy of the entry wins); entries only we have are kept
      writeRawPlan(group, overlay(group, current)); setBase(group, current.decls);
      revs.set(group, current.rev);
      bump();
      return doPush(group, false);
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const { rev } = await r.json();
    revs.set(group, rev); setBase(group, local.decls); dirty.delete(group);
    set({ status: 'synced', at: Date.now(), error: null });
  } catch (e) { set({ status: 'error', error: e.message }); }
}

/** Start syncing one group: pull now, every minute and on tab focus; push on every save. */
export function startPlanSync(group) {
  setPlanSink(g => { dirty.add(g); bump(); pushPlan(g); });
  pullPlan(group);
  const t = setInterval(() => { if (!document.hidden) pullPlan(group); }, 60e3);
  const vis = () => { if (!document.hidden) pullPlan(group); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); setPlanSink(null); };
}
