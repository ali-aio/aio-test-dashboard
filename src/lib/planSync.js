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
import { setPlanSink, rawPlan, writeRawPlan } from './plan.js';

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
  if (revs.get(group) !== srv.rev) {
    writeRawPlan(group, srv);
    revs.set(group, srv.rev);
    set({ status: 'synced', at: Date.now(), error: null });
    bump();
  } else set({ status: 'synced', at: Date.now(), error: null });
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
      const mine = new Set(local.decls.map(d => d.id));
      const merged = [...current.decls.filter(d => !mine.has(d.id)), ...local.decls];
      writeRawPlan(group, { decls: merged, rota: { ...current.rota, ...local.rota } });
      revs.set(group, current.rev);
      bump();
      return doPush(group, false);
    }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const { rev } = await r.json();
    revs.set(group, rev);
    set({ status: 'synced', at: Date.now(), error: null });
  } catch (e) { set({ status: 'error', error: e.message }); }
}

/** Start syncing one group: pull now, every minute and on tab focus; push on every save. */
export function startPlanSync(group) {
  setPlanSink(g => { bump(); pushPlan(g); });
  pullPlan(group);
  const t = setInterval(() => { if (!document.hidden) pullPlan(group); }, 60e3);
  const vis = () => { if (!document.hidden) pullPlan(group); };
  document.addEventListener('visibilitychange', vis);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); setPlanSink(null); };
}
