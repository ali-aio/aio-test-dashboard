// Auto-detected Cycle plan: which test a bench ran, read from the devices' own readings, so the
// lab no longer has to enter every day by hand. The server sweep (server/autoplan.mjs) runs this
// every 30 min and writes the result into the shared plan (data/plan.json), marked `auto`.
//
// What the readings show for each test (checked on the lab's runs, 25 Sep – 15 Oct 2026):
//   Restaurant Case         load on the pad ~3 h (≈12 %/h), then ≈4 %/h; back on charge at ~14 h, ~18 %
//   WLC + Discharge on Ads  the same first 3 h, but it runs on until the device powers off
//   WLC on Load             load on the pad the whole run, 8–9 h to empty (≈10–15 %/h)
//   Discharge on Load only  load the whole run, no ads: 9–11 h to empty (the lab's figures)
//   Ads only                no load at all, ≈4 %/h, until the device powers off
// Ads themselves are not in the telemetry, so the two "load the whole run" tests are told apart
// by time to empty only (LOAD_ONLY_H). Charging Cycle (the lab recharges every night anyway),
// WLC on Phone (pad time depends on the phone) and Burn-in (production only) are never guessed.
// Plain JS, no DOM: the server runs it, test/render.test.jsx checks it.
import { cycleAt, dayKey, daysBetween } from './plan.js';

const H = 3600e3;
const GAP = 45 * 60e3;          // no check-in for this long: the run stopped (powered off / taken away)
const STEP_CAP = 15 * 60e3;     // a reading counts for at most this long when summing pad time
const CHARGE_CHECK = 30 * 60e3; // "charging" counts only if the battery stops falling within this long
export const WHOLE_RUN = 0.85;  // load on the pad for this share of the run = load the whole run
export const AUTO_FROM = new Date(2026, 8, 25).getTime(); // first day filled in (the lab's choice)
export const BENCH_GAP_H = 3;   // devices starting within 3 h are one bench (same as CYCLE_GAP_H)
export const MIN_DEVICES = 3;   // fewer is someone's own test, not a bench run
export const LOAD_ONLY_H = 10;  // load all run: ≤ 10 h to empty = WLC on Load, more = Load only
// the tests the readings can tell apart; only these are ever replaced on a person's entry
export const DETECTABLE = new Set(['wlc_load', 'load_only', 'disch_ads', 'wlc_disch', 'restaurant']);

const round = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;
const median = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** One device's discharges off the charger from ≥ 95 %, with how long a load sat on its pad.
 *  rows: history rows (normalize()d or raw), any order; `empty` rows are skipped.
 *  With a load on the pad the T7 sometimes reports `charging` for minutes to an hour while its
 *  battery keeps falling (16 Oct 2026: 8 of 19 devices). That is not a charge: one ends a run
 *  only when the battery has risen, or stops falling (rises or holds) within CHARGE_CHECK. */
export function runsFrom(rows, now = Date.now()) {
  const pts = rows.filter(r => !r.empty && typeof r.battery_pct === 'number')
    .map(r => ({ t: Date.parse(r.sample_at || r.timestamp), b: r.battery_pct, ch: r.extra?.charging, pad: !!r.extra?.wlc_status }))
    .filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  // a real charge: the battery rises, or holds — the flag on and no later reading (within
  // CHARGE_CHECK, on charge) lower. On the pad's flicker the battery keeps falling. At 20 % a
  // bench put on charge at 00:04 held its level for a while (20 Oct 2026), so "rises" alone
  // kept the run open and the cycle's end moved with every sweep.
  const rises = i => {
    let seen = 0;
    for (let k = i + 1; k < pts.length && pts[k].t - pts[i].t <= CHARGE_CHECK; k++) {
      if (pts[k].b > pts[i].b) return true;
      if (pts[k].b < pts[i].b) return false;
      if (pts[k].ch === true) seen++;
    }
    return seen >= 2;
  };
  const runs = []; let cur = null;
  const close = ended => {
    const p = cur.pts, s = p[0], e = p[p.length - 1], durH = (e.t - s.t) / H, drop = s.b - e.b;
    let padH = 0, pad5H = 0;
    for (let i = 0; i < p.length - 1; i++) {
      if (!p[i].pad) continue;
      const dt = Math.min(p[i + 1].t - p[i].t, STEP_CAP) / H;
      padH += dt; if (p[i].t - s.t < 5 * H) pad5H += dt;
    }
    // the pad at the end: still on, or taken off in the last half hour
    const padEnd = p.some(x => x.pad && e.t - x.t <= 30 * 60e3);
    if (ended === 'silent' && e.b <= 10) ended = 'off';
    if (ended === 'running' || (durH >= 1 && drop >= 5))
      runs.push({ start: s.t, end: e.t, startPct: s.b, endPct: e.b, ended, durH: round(durH, 2), rate: durH > 0 ? round(drop / durH, 2) : null,
        padH: round(padH, 2), pad5H: round(pad5H, 2), padEnd });
    cur = null;
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[i - 1];
    const charging = typeof p.ch === 'boolean' ? p.ch && (!cur || p.b > cur.last.b || rises(i)) : !!prev && p.b > prev.b;
    if (cur) {
      if (p.t - cur.last.t > GAP) close('silent');
      else if (charging) close('charge');
      else { cur.pts.push(p); cur.last = p; continue; }
    }
    if (!charging && p.b >= 95) cur = { pts: [p], last: p };
  }
  if (cur) close(now - cur.last.t > GAP ? 'silent' : 'running');
  return runs;
}

/** Runs of several devices that started within BENCH_GAP_H of each other: one bench each. */
export function benchesFrom(runsBySerial, { minDevices = MIN_DEVICES } = {}) {
  const all = Object.entries(runsBySerial).flatMap(([serial, runs]) => (runs || []).map(r => ({ ...r, serial })))
    .sort((a, b) => a.start - b.start);
  const out = []; let cur = null;
  for (const r of all) {
    if (!cur || r.start - cur.start > BENCH_GAP_H * H) { cur = { start: r.start, runs: [] }; out.push(cur); }
    if (!cur.runs.some(x => x.serial === r.serial)) cur.runs.push(r);
  }
  // the bench's start and end are its devices' medians: one device taken off early, or left
  // running a day longer, must not stretch the cycle over the next day's
  return out.filter(b => b.runs.length >= minDevices)
    .map(b => ({ ...b, start: median(b.runs.map(r => r.start)), end: median(b.runs.map(r => r.end)) }));
}

/** Which test a bench ran: { tt, final, basis, endMs } or { tt: null, why }. `final` is false
 *  while it is still running and the call may change (Restaurant Case vs WLC + Discharge on Ads
 *  is only settled by how it ends). */
export function classifyBench(bench, now = Date.now()) {
  const runs = bench.runs, n = runs.length, most = f => runs.filter(f).length > n / 2;
  // running = most devices still on it: one or two left off the charger (not on the test) don't keep it open
  const running = most(r => r.ended === 'running');
  const elapsed = running ? (now - bench.start) / H : median(runs.map(r => r.durH));
  const rate = median(runs.map(r => r.rate)), toEmpty = rate ? 100 / rate : null;
  const end = bench.end;
  const pad = median(runs.map(r => r.padH)), endPct = median(runs.map(r => r.endPct));
  const say = s => `${s} (median of ${n} devices${running ? ', still running' : ''})`;
  const projEnd = h => Math.max(now, bench.start + h * H);

  // load the whole run: still on the pad at its end (a run stored before padEnd existed counts as on);
  // while running, not before 5 h — a Restaurant Case's 3 h load can run a little long
  if (most(r => r.durH >= 0.5 && r.padH >= WHOLE_RUN * r.durH && r.padEnd !== false)) {
    if (running && elapsed < 5) return { tt: null, why: 'load on the pad so far: too early to tell' };
    const tt = toEmpty <= LOAD_ONLY_H ? 'wlc_load' : 'load_only';
    return { tt, final: !running, endMs: running ? projEnd(toEmpty) : end,
      basis: say(`load on the pad the whole run, ${round(rate)} %/h = ${round(toEmpty)} h to empty (${tt === 'wlc_load' ? '≤' : '>'} ${LOAD_ONLY_H} h)`) };
  }
  if (most(r => r.pad5H >= 1.5 && r.padH - r.pad5H < 1 && (r.padH < WHOLE_RUN * r.durH || r.padEnd === false))) {
    const off = most(r => r.ended === 'off' || r.endPct <= 5);
    const tt = off || (running && elapsed > 15.5) ? 'wlc_disch' : 'restaurant';
    return { tt, final: !running, endMs: running ? projEnd(tt === 'restaurant' ? 14 : elapsed + endPct / 4) : end,
      basis: say(`load on the pad ${round(pad)} h, then about 4 %/h; ${running ? `${round(elapsed)} h so far` : off ? 'ran until the device powered off' : `back on charge after ${round(elapsed)} h at ${round(endPct, 0)} %`}`) };
  }
  if (most(r => r.padH < 0.3)) {
    if (!(rate >= 2)) return { tt: null, why: 'no load and hardly draining: not a test' };
    if (running && elapsed < 1) return { tt: null, why: 'too early to tell' };
    return { tt: 'disch_ads', final: !running, endMs: running ? projEnd(toEmpty) : end,
      basis: say(`no load on the pad, ${round(rate)} %/h`) };
  }
  return { tt: null, why: 'the devices did not run the same way' };
}

/** Put the detected benches into the plan. Returns { decls, state, changes }.
 *  - no entry for that time: a new one, `auto` set (shown as "Auto").
 *  - an entry Auto made: kept up to date (test, end time, devices) while it runs.
 *  - a person's entry for another detectable test: replaced once the run has finished (the lab's
 *    choice), recording what it was; a person's entry spanning several days gets a one-day
 *    override instead, so their other days stay as they are.
 *  - an entry Auto made or changed that a person has since edited (no `auto` on it any more), or
 *    deleted: left alone for good.
 *  state: { made: [{ start, id }], applied: { declId: testType } } — kept by the server. */
export function applyAuto(decls, benches, { now = Date.now(), state = {}, from = AUTO_FROM } = {}) {
  const made = [...(state.made || [])], applied = { ...(state.applied || {}) };
  let list = decls.slice(); const changes = [];
  const ids = () => new Set(list.map(d => d.id));
  for (const b of benches) {
    if (b.start < from) continue;
    const c = classifyBench(b, now);
    if (!c.tt) continue;
    const startMs = Math.floor(b.start / 300e3) * 300e3, key = dayKey(startMs), endKey = dayKey(c.endMs);
    const serials = b.runs.map(r => r.serial).sort();
    const auto = { at: now, final: c.final, basis: c.basis };
    const fields = { testType: c.tt, from: key, to: key, startTime: hm(startMs), endTime: hm(c.endMs), spanDays: Math.max(0, daysBetween(key, endKey)),
      repeat: 'none', group: { kind: 'serials', serials } };
    // a Charging Cycle window (often overnight into the morning) never holds a discharge bench
    // an entry for only some of the bench's devices (e.g. an Idle Cycle for two) is not its entry
    const coversBench = d => d.group?.kind !== 'serials' || serials.filter(s => (d.group.serials || []).includes(s)).length * 2 > serials.length;
    const hit = cycleAt(list.filter(d => d.testType !== 'charging' && coversBench(d)), b.start)?.decl;
    if (hit && hit.auto) {
      // ours: refresh while it runs; a person's later edit removes `auto` and ends this
      // on a person's entry Auto replaced, only the test is Auto's: their times and devices stay
      const next = { ...hit, ...(hit.auto.was ? { testType: c.tt } : fields), auto: { ...hit.auto, ...auto } };
      const same = ['testType', 'startTime', 'endTime', 'spanDays'].every(k => next[k] === hit[k]) && JSON.stringify(next.group) === JSON.stringify(hit.group)
        && next.auto.final === hit.auto.final;
      if (!same) { list = list.map(d => (d.id === hit.id ? { ...next, mod: now } : d)); applied[hit.id] = c.tt; changes.push(`${key}: ${c.tt} updated`); }
      continue;
    }
    if (hit) {
      if (hit.testType === c.tt || !c.final || !DETECTABLE.has(hit.testType) || applied[hit.id]) continue;
      const was = { testType: hit.testType, by: hit.by || '' };
      if (hit.repeat === 'none' && (hit.to || hit.from) === hit.from) {
        list = list.map(d => (d.id === hit.id ? { ...d, testType: c.tt, auto: { ...auto, was }, mod: now } : d));
        applied[hit.id] = c.tt; changes.push(`${key}: ${hit.testType} replaced by ${c.tt}`);
        continue;
      }
      // a several-day plan: override just this day (the newest entry wins the day)
      const id = `A-${startMs.toString(36)}`;
      if (ids().has(id) || made.some(m => m.id === id)) continue;
      list.push({ id, at: now, mod: now, by: 'Auto', ...fields, auto: { ...auto, was } });
      made.push({ start: b.start, id }); applied[id] = c.tt; changes.push(`${key}: ${c.tt} over ${hit.testType}`);
      continue;
    }
    // nothing planned: add it, unless Auto added one here before and a person deleted it
    if (made.some(m => Math.abs(m.start - b.start) <= BENCH_GAP_H * H)) continue;
    const id = `A-${startMs.toString(36)}`;
    list.push({ id, at: now, mod: now, by: 'Auto', ...fields, auto });
    made.push({ start: b.start, id }); applied[id] = c.tt; changes.push(`${key}: ${c.tt} added`);
  }
  return { decls: list, state: { made, applied }, changes };
}
