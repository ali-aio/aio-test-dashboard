// Battery health per device, from MDM telemetry alone (no voltage, no mAh).
//
// Everything is scoped to ONE discharge test type, so runtimes compare like with like.
// A run is COMPARABLE when it is a counted cycle of that test on that device that started
// full (>= fullPct). Three indices, each 0–100, make the score:
//   capacity (weight 0.6)  median runtime to empty of the last 3 runs vs the first 5
//                          (fleet first-5 median when the device has fewer than 5)
//   early drain (0.1)      battery drained in the first hour, first 5 runs vs last 3;
//                          null without 3 curves — its weight then goes to capacity
//   stress (0.3)           accumulated wear against the fleet: lifetime cycles, hours
//                          >= 40 / 45 °C, hours on charger at 100 %, discharges ended < 5 %,
//                          each as a share of the fleet's 90th percentile
// Penalty events (last 30 days) — a shutdown above 5 %, a wired charge that never reached
// 100 %, a gauge jump between readings — move the grade: Good / Watch / Replace.
// Plain JS, no DOM: arrays and objects in, plain objects out, so the test can feed fixtures.
const H = 3600e3, MIN = 60e3, DAY = 86400e3;

export const WEIGHTS = { capacity: 0.6, early: 0.1, stress: 0.3 };
export const GOOD_AT = 90, REPLACE_AT = 80;              // score lines
export const MIN_RUNS = 3, BASELINE_RUNS = 5, CURRENT_RUNS = 3;
export const PENALTY_DAYS = 30;
export const GAUGE_JUMP = 5;                             // points between consecutive readings
export const GAUGE_GAP_MIN = 15;                         // readings further apart are a gap, not a jump
export const SLOW_CHARGE_X = 1.5;                        // × the fleet's median wired time to 100 %
export const CHARGE_START_MAX = 80;                      // a "charge to 100 %" starts at or below this
export const GRADE = { good: 'Good', watch: 'Watch', replace: 'Replace', few: 'Not enough runs' };
export const SHUTDOWN = 'Shutdown above 5 %', NO_FULL = 'Never reached 100 %', JUMP = 'Gauge jump';
const DEFAULTS = { fullPct: 95, deadPct: 5, offlineMin: 30 };

const ts = r => Date.parse(r.timestamp);
const rt = c => c.fullMs;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtH = ms => { const m = Math.round(ms / MIN); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };

/** True median (the mean of the middle two on an even count); null when empty. */
export const median = xs => {
  const a = xs.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
/** Nearest-rank percentile (p in 0..1); null when empty. */
export const percentile = (xs, p) => {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
};

// ── comparable runs ───────────────────────────────────────────────────────────
/** serial -> that device's comparable runs of `testType`, oldest first. */
export function comparableRuns(cycles, testType, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, by = new Map();
  for (const c of cycles) {
    if (c.testType !== testType || c.inProgress || !(c.fullMs > 0) || !(c.startBattery >= o.fullPct)) continue;
    if (!by.has(c.serial)) by.set(c.serial, []);
    by.get(c.serial).push(c);
  }
  for (const list of by.values()) list.sort((a, b) => a.start - b.start);
  return by;
}

/** The fleet's baseline runtime: the median over every device's first-5 runs, pooled. */
export const fleetBaseline = by => median([...by.values()].flatMap(runs => runs.slice(0, BASELINE_RUNS).map(rt)));

// ── capacity ──────────────────────────────────────────────────────────────────
export function capacityIndex(runs, fleet) {
  if (runs.length < MIN_RUNS) return { index: null, baseline: null, current: null, source: null };
  const own = runs.length >= BASELINE_RUNS ? median(runs.slice(0, BASELINE_RUNS).map(rt)) : null;
  const baseline = own ?? fleet, source = own != null ? 'device' : 'fleet';
  const current = median(runs.slice(-CURRENT_RUNS).map(rt));
  if (!(baseline > 0) || current == null) return { index: null, baseline, current, source };
  return { index: 100 * Math.min(1, current / baseline), baseline, current, source };
}

// ── early drain ───────────────────────────────────────────────────────────────
/** Points drained in a run's first hour, from its curve ({ t: hours, v }); null without
 *  a curve reaching 1 h from the start, and null when nothing drained in that hour — a
 *  run still flat at 100 % had not really started (devices sit idle on the bench, or the
 *  detector anchored before the test did), so it says nothing about the battery. */
export function earlyDrain(run) {
  const s = (run.series || []).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  if (s.length < 2 || s[0].t > 0.5) return null;
  const i = s.findIndex(p => p.t >= 1);
  if (i < 0) return null;
  const b = s[i], a = s[i - 1];
  const at1 = b.t === 1 ? b.v : !a ? null : a.v + (b.v - a.v) * (1 - a.t) / (b.t - a.t);
  if (at1 == null) return null;
  const start = Number.isFinite(run.startBattery) ? run.startBattery : s[0].v;
  const d = start - at1;
  return d > 0 ? d : null;
}
export function earlyIndex(runs) {
  const d = runs.map(earlyDrain).filter(x => x != null);
  if (d.length < MIN_RUNS) return { index: null, baseline: null, current: null, n: d.length };
  const baseline = median(d.slice(0, BASELINE_RUNS)), current = median(d.slice(-CURRENT_RUNS));
  const index = current <= 0 ? 100 : 100 * Math.min(1, Math.max(0, baseline) / current);
  return { index, baseline, current, n: d.length };
}

// ── stress ────────────────────────────────────────────────────────────────────
export const STRESS_FACTORS = [
  { key: 'lifetime', label: 'Lifetime battery cycles', unit: 'cycles', digits: 1 },
  { key: 'h40', label: 'Hours at ≥ 40 °C', unit: 'h', digits: 1 },
  { key: 'h45', label: 'Hours at ≥ 45 °C', unit: 'h', digits: 1 },
  { key: 'full', label: 'Hours on charger at 100 %', unit: 'h', digits: 1 },
  { key: 'deep', label: 'Discharges ended below 5 %', unit: '', digits: 0 },
];
/** Hours the device sat charging at 100 %: consecutive readings both on charge at 100,
 *  a gap counting for at most `capMin`. */
export function hoursAtFull(rows, capMin = 30) {
  let ms = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (!a.extra?.charging || !b.extra?.charging || !(a.battery_pct >= 100) || !(b.battery_pct >= 100)) continue;
    ms += Math.min(ts(b) - ts(a), capMin * MIN);
  }
  return ms / H;
}
/** One device's wear factors. `cycles` are ALL its counted cycles (every test), `rows`
 *  the readings window, `lifetime` the MDM's battery cycles (null -> 0, no penalty for
 *  not reporting). */
export function stressFactors({ lifetime, cycles = [], rows = [] }, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const hrs = k => cycles.reduce((a, c) => a + (Number.isFinite(c[k]) ? c[k] : 0), 0) / 60;
  return { lifetime: Number.isFinite(lifetime) ? lifetime : 0, h40: hrs('minAbove40'), h45: hrs('minAbove45'),
    full: hoursAtFull(rows), deep: cycles.filter(c => Number.isFinite(c.endBattery) && c.endBattery < o.deadPct).length };
}
export const fleetP90 = list => Object.fromEntries(STRESS_FACTORS.map(f => [f.key, percentile(list.map(x => x[f.key]), 0.9) ?? 0]));
export function stressIndex(f, p90) {
  const loads = Object.fromEntries(STRESS_FACTORS.map(x => [x.key, p90[x.key] > 0 ? Math.min(1, f[x.key] / p90[x.key]) : 0]));
  return { index: 100 * (1 - mean(Object.values(loads))), loads };
}

// ── penalty events ────────────────────────────────────────────────────────────
/** Discharges of this test the detector left as interrupted because the device went
 *  silent while still above deadPct (not on a charger). `interrupted` rows carry serial,
 *  testType, reason, start, end, endPct — the detector's own classification is used,
 *  never re-derived. */
export function shutdownsAbove(interrupted, testType, { deadPct = DEFAULTS.deadPct, since = -Infinity } = {}) {
  return interrupted.filter(c => c.testType === testType && c.reason === 'offline' && c.endPct > deadPct && c.end >= since)
    .map(c => ({ kind: SHUTDOWN, at: c.end, detail: `went silent at ${c.endPct}% after ${fmtH(c.end - c.start)} on battery` }));
}
/** Stretches on charge in the readings window. A segment ends when the charging flag drops
 *  (`dropped`), when the readings stop for `gapMin` (`dropped: false`), or at the window's
 *  end (`open`). `toFull`: ms from its start to the first reading at 100 %, else null. */
export function chargeSegments(rows, { gapMin = 30 } = {}) {
  const segs = []; let cur = null;
  const wired = r => !(/wireless|wlc|qi/i.test(r.extra?.charger_type || ''));
  const close = (s, dropped) => { s.end = s.last; s.dropped = dropped; s.durationMs = s.end - s.start; s.wired = s.wiredN > s.n / 2; segs.push(s); };
  for (const r of rows) {
    const t = ts(r), on = !!r.extra?.charging;
    if (!Number.isFinite(t) || typeof r.battery_pct !== 'number') continue;
    if (cur) {
      if (on && t - cur.last <= gapMin * MIN) {
        cur.last = t; cur.endPct = r.battery_pct; cur.n++; if (wired(r)) cur.wiredN++;
        if (cur.toFull == null && r.battery_pct >= 100) cur.toFull = t - cur.start;
        continue;
      }
      close(cur, !on && t - cur.last <= gapMin * MIN); cur = null;
    }
    if (on) cur = { start: t, last: t, startPct: r.battery_pct, endPct: r.battery_pct, n: 1, wiredN: wired(r) ? 1 : 0, toFull: r.battery_pct >= 100 ? 0 : null, open: false };
  }
  if (cur) { cur.open = true; close(cur, false); }
  return segs;
}
/** The fleet's median wired time to 100 %, over charges that started at or below
 *  CHARGE_START_MAX (a top-up from 97 % is not a charge). */
export const medianToFull = segs => median(segs.filter(s => s.wired && s.toFull != null && s.startPct <= CHARGE_START_MAX).map(s => s.toFull));
export function slowCharges(segs, medToFull, since = -Infinity) {
  if (!(medToFull > 0)) return [];
  return segs.filter(s => s.wired && s.dropped && s.toFull == null && s.startPct <= CHARGE_START_MAX && s.durationMs > SLOW_CHARGE_X * medToFull && s.end >= since)
    .map(s => ({ kind: NO_FULL, at: s.end, detail: `came off the cable at ${s.endPct}% after ${fmtH(s.durationMs)} (the fleet reaches 100 % in ${fmtH(medToFull)})` }));
}
/** Two consecutive readings off the charger, within GAUGE_GAP_MIN of each other, more than
 *  GAUGE_JUMP points apart. */
export function gaugeJumps(rows, { since = -Infinity } = {}) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.extra?.charging || b.extra?.charging || typeof a.battery_pct !== 'number' || typeof b.battery_pct !== 'number') continue;
    const ta = ts(a), tb = ts(b);
    if (!(tb >= since) || tb - ta > GAUGE_GAP_MIN * MIN) continue;
    if (Math.abs(b.battery_pct - a.battery_pct) > GAUGE_JUMP)
      out.push({ kind: JUMP, at: tb, detail: `${a.battery_pct}% → ${b.battery_pct}% in ${Math.max(1, Math.round((tb - ta) / MIN))} min` });
  }
  return out;
}

// ── score and grade ───────────────────────────────────────────────────────────
/** 0.6 × capacity + 0.1 × early + 0.3 × stress; with no early-drain index its weight goes
 *  to capacity. Null without capacity or stress. */
export function scoreOf(capacity, early, stress) {
  if (capacity == null || stress == null) return null;
  const wc = early == null ? WEIGHTS.capacity + WEIGHTS.early : WEIGHTS.capacity;
  return wc * capacity + (early == null ? 0 : WEIGHTS.early * early) + WEIGHTS.stress * stress;
}
/** Good: >= 90 and no penalties · Watch: 80–89, or exactly one penalty · Replace: < 80,
 *  two or more penalties, or two or more shutdowns above 5 %. Null score: not enough runs. */
export function gradeOf(score, events = []) {
  if (score == null || !Number.isFinite(score)) return GRADE.few;
  const n = events.length, shut = events.filter(e => e.kind === SHUTDOWN).length;
  if (score < REPLACE_AT || n >= 2 || shut >= 2) return GRADE.replace;
  if (score < GOOD_AT || n === 1) return GRADE.watch;
  return GRADE.good;
}

// ── the table ─────────────────────────────────────────────────────────────────
/**
 * One row per device. Input, all plain:
 *   cycles      every counted cycle (T7 shape: serial, testType, fullMs, startBattery,
 *               endBattery, start, end, series, firmware, minAbove40, minAbove45, inProgress)
 *   testType    the test the page is scoped to
 *   devices     [{ serial, lifetime }] — lifetime = the MDM's battery cycles, or null
 *   interrupted [{ serial, testType, reason, start, end, endPct }] from the detector
 *   readings    { serial: normalized rows } — the 7-day window
 *   now, opts   opts: { fullPct, deadPct }
 * Rows come back worst first: by score ascending, devices without a score last.
 */
export function healthRows({ cycles = [], testType, devices = [], interrupted = [], readings = {}, now = Date.now(), opts = {} }) {
  const o = { ...DEFAULTS, ...opts }, since = now - PENALTY_DAYS * DAY;
  const by = comparableRuns(cycles, testType, o), fleet = fleetBaseline(by);
  const own = new Map();
  for (const c of cycles) { if (c.inProgress) continue; if (!own.has(c.serial)) own.set(c.serial, []); own.get(c.serial).push(c); }
  const segs = Object.fromEntries(devices.map(d => [d.serial, chargeSegments(readings[d.serial] || [])]));
  const medFull = medianToFull(Object.values(segs).flat());
  const factors = devices.map(d => stressFactors({ lifetime: d.lifetime, cycles: own.get(d.serial) || [], rows: readings[d.serial] || [] }, o));
  const p90 = fleetP90(factors);
  const rows = devices.map((d, i) => {
    const runs = by.get(d.serial) || [], rws = readings[d.serial] || [];
    const capacity = capacityIndex(runs, fleet), early = earlyIndex(runs), stress = stressIndex(factors[i], p90);
    const penalties = [
      ...shutdownsAbove(interrupted.filter(c => c.serial === d.serial), testType, { deadPct: o.deadPct, since }),
      ...slowCharges(segs[d.serial], medFull, since),
      ...gaugeJumps(rws, { since }),
    ].sort((a, b) => b.at - a.at);
    const raw = runs.length >= MIN_RUNS ? scoreOf(capacity.index, early.index, stress.index) : null;
    const score = raw == null ? null : Math.round(raw);
    const last = runs[runs.length - 1];
    return { serial: d.serial, lifetime: d.lifetime ?? null, runs, n: runs.length, firmware: last?.firmware ?? null, lastRun: last?.start ?? null,
      capacity, early, stress, factors: factors[i], penalties, score, grade: gradeOf(score, penalties) };
  });
  rows.sort((a, b) => (a.score == null) - (b.score == null) || (a.score ?? 0) - (b.score ?? 0)
    || String(a.serial).localeCompare(String(b.serial), undefined, { numeric: true }));
  const counts = Object.fromEntries(Object.values(GRADE).map(g => [g, 0]));
  for (const r of rows) counts[r.grade]++;
  return { rows, counts, fleetBaseline: fleet, medianToFull: medFull, p90, comparable: rows.reduce((a, r) => a + r.n, 0) };
}
