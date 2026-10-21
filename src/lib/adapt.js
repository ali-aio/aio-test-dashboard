// MDM cycles -> T7 cycle objects.
//
// T7-Dashboard's views, charts and statistics all speak one cycle shape, built there from
// CSV rows and MDM exports. This repo has no import step — it reads the MDM live and
// detects cycles with src/lib/cycles.js — so this is where our cycles are reshaped into
// theirs. Everything downstream (t7cycles.js, the views, the chart kit) is then T7's code
// running unchanged.
//
// Three fields T7 has cannot be filled from MDM telemetry, and are left null rather than
// invented. Each one is surfaced in the UI as "not reported by the MDM":
//   · build      — the MDM reports one device_class ("t7") for the whole fleet
//   · android    — no OS/SDK field exists anywhere in the check-in payload
//   · load gain  — the MDM reports the T7's own battery, never the phone/load's
import { buildFromSerial } from './device.js';
import { TEST_TYPES, testType as ttById, resolveDay, groupSerials, dayKey, windowOn, cycleAt, loadDecls, loadRota } from './plan.js';
import { FIELD_DISCHARGE, FIELD_CHARGING } from './testtypes.js';
import { perHourRate, HOUR_SNAP } from './t7cycles.js';
import { mdmCyclesFor } from './mdmTrack.js';
import { curveKey, curveSeries, resampleRun } from './curves.js';
import { runningCycle } from './window.js';
import { TEMP_WARN, TEMP_LIMIT } from './profile.js';

const H = 3600e3;
// Planned tests count only runs from the day the Cycle plan began (the lab's choice, Oct 2026);
// everything before is Old cycles, whatever a plan entry says.
export const PLAN_FROM = new Date(2026, 8, 25).getTime();
export const ANDROID_SINCE_PLAN = 'Android 15';
// A run kept in a planned test must look like that test. A test with a fixed cycle time
// (`hours` in TEST_TYPES: Restaurant Case 14 h) allows CYCLE_SLACK_H more — a device taken off
// the charger an hour or two early, or put back late — and past that the device has left the
// cycle (16 Oct 2026: one forgotten on the bench read as 69 h). A device starting up to 3 h
// after the others still belongs to the cycle (its window, CYCLE_GAP_H); it is its own run
// time that is held to the cycle time. And a discharge test drains: a device sitting idle at
// ~1 %/h was not on it.
export const CYCLE_SLACK_H = 2;
// A fixed-time test (Restaurant Case, 14 h) that ran to within 30 min of its time is a complete cycle
// and counts as its full time (13 h 54 m -> 14 h); anything shorter is a SHORT cycle, which is
// alarming: flagged in red in the tables, left out of the average cycle time, raised on the bell
// while it happens (the lab, 21 Oct 2026: "13.55 consider 14 h, less than 13.30 is alarming").
export const FULL_CYCLE_MARGIN_H = 0.5;
const MIN_DRAIN = 2; // %/h, as the Auto plan's "not a test"
const MIN_KEPT_H = 1; // a device that left the cycle within its first hour gave the test nothing
/** Where a run stops being its test: { cutAt, why } (it left the cycle then — its data up to
 *  that moment still counts, the lab's choice, Oct 2026: devices are often taken out after a
 *  few hours), { out: true } (it never ran the test), or {} (all of it counts). */
function leftTest(cycle, name) {
  if (cycle.charging) return {};
  const h = (cycle.durationMs ?? ((cycle.end ?? cycle.start) - cycle.start)) / H;
  const tt = TEST_TYPES.find(t => t.name === name);
  let cutAt = null, why = null;
  const cut = (t, w) => { if (cutAt == null || t < cutAt) { cutAt = t; why = w; } };
  if (tt?.hours && h > tt.hours + CYCLE_SLACK_H) cut(cycle.start + (tt.hours + CYCLE_SLACK_H) * H, `ran past the ${tt.hours} h cycle`);
  // a test with a set load time (`loadHours`: Restaurant Case, WLC + Discharge — 3 h), hour by
  // hour: the WLC active in each of the first `loadHours` hours, inactive from the hour after the
  // next (hour 4 of a 3 h load is when it comes off). Hours with no pad readings are not judged.
  if (tt?.loadHours && cycle.padHours) {
    // readings for the run, but none in its load hours: the load can't be confirmed
    if (cycle.padHours.some(v => v != null) && cycle.padHours.slice(0, tt.loadHours).every(v => v == null)) return { out: true };
    for (let k = 0; k < cycle.padHours.length; k++) {
      const on = cycle.padHours[k];
      if (on === false && k < tt.loadHours) { cut(cycle.start + k * H, `no load on the pad in hour ${k + 1}`); break; }
      if (on === true && k > tt.loadHours) { cut(cycle.start + k * H, `load still on the pad in hour ${k + 1}`); break; }
    }
  }
  return cutAt == null ? {} : { cutAt, why };
}
const isNum = v => v != null && Number.isFinite(v);
const meanDrop = hs => (hs.length ? Math.round(hs.reduce((a, e) => a + e.drop, 0) / hs.length * 100) / 100 : null);
const round = (v, n = 2) => (isNum(v) ? Math.round(v * 10 ** n) / 10 ** n : null);

// Which test was this run? Whatever the Cycle plan declared for the day it started. With
// nothing declared it falls to Field Discharge / Field Charging — the same two buckets T7
// uses for telemetry it had to cut out of a continuous stream itself.
export const testTypeFor = (cycle, ctx, pctAt) => planFor(cycle, ctx, pctAt).name;
/** The run's test and, when the device left the cycle part-way (taken out on Today, or no longer
 *  doing what the test does), when it left and why: { name, cutAt?, why? }. Its data up to then
 *  counts for the test; a run that never ran the test is Old cycles. `pctAt(ms)` gives its battery
 *  at a moment (default: a straight line from start to end), for the drain check. */
export function planFor(cycle, ctx, pctAt) {
  const field = cycle.charging ? FIELD_CHARGING : FIELD_DISCHARGE;
  const { name, removedAt } = plannedTest(cycle, ctx);
  if (name === FIELD_DISCHARGE || name === FIELD_CHARGING || cycle.start < PLAN_FROM) return { name: field };
  const left = leftTest(cycle, name);
  if (left.out) return { name: field };
  let cutAt = left.cutAt ?? null, why = left.why ?? null;
  if (removedAt != null && (cutAt == null || removedAt < cutAt)) { cutAt = removedAt; why = 'taken out of the cycle'; }
  const end = cycle.end ?? cycle.start;
  if (cutAt != null && cutAt >= end) cutAt = why = null;
  const until = cutAt ?? end, keptH = (until - cycle.start) / H;
  if (cutAt != null && keptH < MIN_KEPT_H) return { name: field };
  // a discharge test drains: a device idling at ~1 %/h over the time it counts was not on it
  if (!cycle.charging && keptH >= 1 && !TEST_TYPES.find(t => t.name === name)?.idle) {
    const at = pctAt || (t => cycle.startPct + (cycle.endPct - cycle.startPct) * (t - cycle.start) / ((end - cycle.start) || 1));
    const p0 = cycle.startPct, p1 = at(until);
    if (p0 != null && p1 != null && (p0 - p1) / keptH < MIN_DRAIN) return { name: field };
  }
  return cutAt == null ? { name } : { name, cutAt, why };
}
function plannedTest(cycle, { decls, rota, DEV }) {
  // The declared cycle whose window this run started in — today's, or yesterday's still
  // running overnight. A day can hold several cycles, each with its own window. Only a cycle
  // of its own kind: a discharge never belongs to a Charging Cycle, nor a charge to a
  // discharge test (14 Oct 2026: a Charging Cycle saved to end the next morning took that
  // day's Restaurant Case, and the Charging Cycle screen showed a discharge).
  const sameKind = d => (ttById(d.testType)?.expect === 'charge') === !!cycle.charging;
  // an entry for some devices only (e.g. an Idle Cycle for two) is never another device's cycle
  const covers = d => d.group?.kind !== 'serials' || !cycle.serial || (d.group.serials || []).includes(cycle.serial);
  const hit = cycleAt((decls || []).filter(d => sameKind(d) && covers(d)), cycle.start);
  if (hit) {
    const serials = groupSerials(hit.decl.group, DEV);
    if (serials.length && !serials.includes(cycle.serial)) return { name: FIELD_DISCHARGE };
    // taken out of the cycle (Today) before this run finished: the test until then
    const out = (hit.decl.removed || []).filter(r => r.serial === cycle.serial && r.at < (cycle.end ?? cycle.start)).map(r => r.at);
    const removedAt = out.length ? Math.min(...out) : null;
    if (removedAt != null && removedAt <= cycle.start) return { name: FIELD_DISCHARGE };
    return { name: ttById(hit.decl.testType)?.name || FIELD_DISCHARGE, removedAt };
  }
  const key = dayKey(cycle.start);
  const r = resolveDay(key, { decls: [], rota, ran: 1, devices: 0 });
  const tt = r.testType ? ttById(r.testType) : null;
  if (!tt || (tt.expect === 'charge') !== !!cycle.charging) return { name: cycle.charging ? FIELD_CHARGING : FIELD_DISCHARGE };
  const src = r.rota || null;
  const serials = groupSerials(src && src.group, DEV);
  if (serials.length && !serials.includes(cycle.serial)) return { name: FIELD_DISCHARGE };
  const { startMs: from, endMs: to } = windowOn(key, src);
  if (cycle.start < from || cycle.start > to) return { name: FIELD_DISCHARGE };
  return { name: tt.name };
}

// Mean temperature in each third of a run, from its temperature curve ({ t: hours, v }).
// The Thermal view's "hot early or late" table reads it; T7 built the same from its CSVs.
export function temperaturePhases(tempSeries, duration) {
  const sums = [0, 0, 0], counts = [0, 0, 0];
  if (!(duration > 0)) return [null, null, null];
  for (const p of tempSeries || []) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.v) || p.t < 0 || p.t > duration) continue;
    const i = Math.min(2, Math.floor((p.t / duration) * 3));
    sums[i] += p.v; counts[i]++;
  }
  return sums.map((s, i) => counts[i] ? Math.round(s / counts[i] * 100) / 100 : null);
}

// A device's readings / slots, cut to one cycle's time by binary search. adaptAll runs for ~300
// cycles on every new batch of readings; scanning a device's whole 7-day window (and every 15-min
// slot since July, once per hour of every cycle) froze the page for 1–6 s each time (Oct 2026).
const TIMES = new WeakMap(); // rows -> their timestamps (ms), parsed once; null when out of order
function timesOf(rows) {
  if (TIMES.has(rows)) return TIMES.get(rows);
  let t = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) { t[i] = Date.parse(rows[i].timestamp); if (i && t[i] < t[i - 1]) { t = null; break; } }
  TIMES.set(rows, t);
  return t;
}
const firstAtOrAfter = (n, at, x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (at(m) < x) lo = m + 1; else hi = m; } return lo; };
/** The rows from `from` to `to` (inclusive); every row when they are not in time order. */
export function rowsBetween(rows, from, to) {
  if (!rows || !rows.length) return rows;
  const t = timesOf(rows);
  if (!t) return rows.filter(r => { const x = Date.parse(r.timestamp); return x >= from && x <= to; });
  const i = firstAtOrAfter(t.length, k => t[k], from), j = firstAtOrAfter(t.length, k => t[k], to + 1);
  return i === 0 && j === rows.length ? rows : rows.slice(i, j);
}

// Per-hour battery readings for one cycle, from whatever history rows we hold for it.
// `rows` are normalized samples ({ timestamp, battery_pct, extra }). Without rows the
// cycle still carries its summary, and the curve charts simply have one fewer line.
function seriesFor(rows, c) {
  if (!rows || !rows.length) return { series: [], tempSeries: [], firmware: null, wireless: false, seen: false };
  const series = [], tempSeries = [], fw = new Map(); let wireless = 0, n = 0;
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    if (t < c.start || t > c.end) continue;
    const h = round((t - c.start) / H, 3);
    series.push({ t: h, v: r.battery_pct });
    const tc = r.extra?.battery_temp_c;
    if (typeof tc === 'number' && tc > 0) tempSeries.push({ t: h, v: tc });
    if (r.build_id) fw.set(r.build_id, (fw.get(r.build_id) || 0) + 1);
    if (r.extra?.wlc_status || /wireless|wlc|qi/i.test(r.extra?.charger_type || '')) wireless++;
    n++;
  }
  // the build the device was actually on during this run, not whatever it is on now
  const firmware = [...fw.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  // A run the window only partly covers would be drawn from its first in-window reading at
  // 0 h — a line that starts mid-run in the wrong place. No line is better than that.
  const partial = !series.length || series[0].t > 1 / 3;
  return { series: partial ? [] : series, tempSeries: partial ? [] : tempSeries, firmware, wireless: n > 0 && wireless > n / 2, seen: n > 0 };
}

// Snap samples to whole hours the way T7 does, so a rate computed here and a rate
// computed there mean the same thing.
function wholeHours(series) {
  const byHour = new Map();
  for (const p of series) {
    const h = Math.round(p.t), dist = Math.abs(p.t - h);
    if (dist > HOUR_SNAP) continue;
    const prior = byHour.get(h);
    if (!prior || dist < prior.dist) byHour.set(h, { dist, v: p.v });
  }
  return new Map([...byHour].map(([h, o]) => [h, o.v]));
}

/** One of our detected cycles -> one T7 cycle. `rows` is optional history for the curve. */
export function adaptCycle(d, c0, rows, ctx) {
  const readings = ctx.readings;
  let c = c0;
  let duration = c.durationMs / H;
  if (!(duration > 0)) return null;
  // Prefer the run's stored curve (every run, even months old); fall back to the browser's
  // 7-day window for runs the sweep has not curved yet.
  // no stored curve (e.g. the cycle running now, or one newer than the last sweep): resample
  // the live readings the way the sweep does, onto an even 10-min grid, so the averaged
  // curves get a point at every whole hour instead of only where a reading happened to land
  // only this run's readings (and 20 min either side, which resampleRun checks for)
  const near = rowsBetween(rows, c.start - 30 * 60e3, c.end + 30 * 60e3);
  const stored = ctx.curves?.[curveKey(d.serial, c.start)] || (near && near.length ? resampleRun(near, c.start, c.end) : null);
  const fromWindow = seriesFor(near, c);
  let { series, tempSeries } = stored ? curveSeries(stored) : fromWindow;
  series = series || []; tempSeries = tempSeries || [];
  // a charge kept by the sweep carries its own curve: [minutes from start, battery %]
  if (!series.length && c.curve?.length) series = c.curve.map(([m, v]) => ({ t: round(m / 60, 3), v }));
  const firmware = (stored && stored.fw) || fromWindow.firmware;
  const wireless = stored ? !!stored.w : fromWindow.wireless;
  const charging = c.endPct > c.startPct;
  // a load on the pad in each hour of the run, from the sweep's 15-min slots (hours.json): on
  // when it was on for most of that hour's time on battery. Without slots for the hour, the
  // run's own pad state (on if the pad was on at any point) stands in. Restaurant Case's
  // "pad on / pad off" per hour reads this: its first 3 h on, the rest off.
  const slots = ctx.hours?.[d.serial]?.h;
  // measured: true / false from the slots, null with under 15 min of them in the hour
  // (slots are in time order: start at the hour's first by binary search, stop past its end)
  const padMeasured = h => {
    if (!slots?.length) return null;
    const a = c.start + h * H, b = a + H, half = 7.5 * 60e3; let m = 0, pad = 0;
    for (let i = firstAtOrAfter(slots.length, k => slots[k][0] + half, a); i < slots.length; i++) {
      const x = slots[i]; if (x[0] + half >= b) break; m += x[2]; pad += x[3];
    }
    return m >= 15 ? pad * 2 >= m : null;
  };
  // an hour without pad readings is not known (null) — never filled in from the run as a whole,
  // which put "WLC active" in hours 8–13 of a Restaurant Case
  const padInHour = h => padMeasured(h);
  let padHours = Array.from({ length: Math.ceil(duration) }, (_, h) => padMeasured(h));
  // battery at a moment of the run, from its curve (straight line between points)
  const pctAt = t => {
    const x = (t - c.start) / H, s = series;
    if (!s.length) return c.startPct + (c.endPct - c.startPct) * (t - c.start) / ((c.end - c.start) || 1);
    if (x <= s[0].t) return s[0].v;
    for (let i = 1; i < s.length; i++) if (s[i].t >= x) { const a = s[i - 1], b = s[i]; return a.v + (b.v - a.v) * (x - a.t) / ((b.t - a.t) || 1); }
    return s[s.length - 1].v;
  };
  const plan = planFor({ ...c, serial: d.serial, charging, padHours }, ctx, pctAt);
  // left the cycle part-way (taken out, or stopped doing what the test does): the run up to then
  if (plan.cutAt != null) {
    const cutH = (plan.cutAt - c.start) / H, endPct = Math.round(pctAt(plan.cutAt));
    series = [...series.filter(p => p.t < cutH), { t: round(cutH, 3), v: endPct }];
    tempSeries = tempSeries.filter(p => p.t <= cutH);
    padHours = padHours.slice(0, Math.ceil(cutH));
    duration = cutH;
    const drop = c.startPct - endPct;
    c = { ...c, end: plan.cutAt, durationMs: plan.cutAt - c.start, endPct, inProgress: false,
      fullMs: drop > 0 ? (plan.cutAt - c.start) / drop * 100 : null, maxTemp: undefined, avgTemp: undefined, thermal: undefined };
  }
  // complete (within FULL_CYCLE_MARGIN_H of the test's time) or short, for a fixed-time test
  const tt = TEST_TYPES.find(t => t.name === plan.name);
  const finished = !charging && !c.inProgress && tt?.hours;
  const fullTime = finished && duration >= tt.hours - FULL_CYCLE_MARGIN_H && duration < tt.hours;
  const shortRun = finished && duration < tt.hours - FULL_CYCLE_MARGIN_H;
  const hourVals = wholeHours(series);
  const linear = (c.startPct - c.endPct) / duration;
  const hourly = perHourRate(hourVals, charging ? 'gain' : 'drop');
  const built = [];
  for (const h of [...hourVals.keys()].sort((a, b) => a - b)) {
    if (hourVals.has(h + 1)) built.push({ h, drop: hourVals.get(h) - hourVals.get(h + 1), wireless: padInHour(h) });
  }
  const temps = tempSeries.map(p => p.v);
  const start = new Date(c.start);
  return {
    id: `${d.serial}@${c.start}`,
    serial: d.serial,
    testType: plan.name,
    // left the cycle part-way: when and why (its data up to then is this cycle); null otherwise
    leftCycle: plan.cutAt != null ? { at: plan.cutAt, why: plan.why, endedAt: c0.end } : null,
    build: buildFromSerial(d.serial), // from the serial ("BU" = Production), as the MDM reports no build
    // not reported by the MDM (no OS/SDK field in the payload); the lab: every device has run
    // Android 15 since the Cycle plan began (25 Sep 2026), so from then on it is that
    android: c.start >= PLAN_FROM ? ANDROID_SINCE_PLAN : null,
    firmware: firmware || c.buildId || 'Unknown',
    date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
    week: null,
    // cycle time: the test's full time for a complete fixed-time run, else what it ran (ranH)
    duration: round(fullTime ? tt.hours : duration, 3),
    ranH: round(duration, 3),
    short: !!shortRun,
    startBattery: c.startPct,
    endBattery: c.endPct,
    batteryDelta: c.endPct - c.startPct,
    dropPerHr: round(hourly != null ? hourly : linear, 3),
    rateBasis: hourly != null ? 'whole hours' : 'straight line over the cycle',
    loadGainPerHr: null,  // the MDM reports the T7's battery, never the load's
    loadType: null,
    charger: null,
    // the T7's own wireless-charging pad, active (charging a phone / tester on it) or off
    padState: wireless ? 'WLC active' : 'WLC inactive',
    // whether the pad state is known at all: neither a stored curve nor live readings -> 'WLC inactive' is only a default
    padKnown: !!stored || !!fromWindow.seen,
    maxTemp: c.maxTemp ?? (temps.length ? Math.max(...temps) : null),
    // the detector's mean; a charge (or a cycle without it) from its temperature curve
    avgTemp: c.avgTemp ?? (temps.length ? round(temps.reduce((a, x) => a + x, 0) / temps.length, 1) : null),
    minAbove40: c.thermal?.minAbove40 ?? null,
    minAbove45: c.thermal?.minAbove45 ?? null,
    series, tempSeries, hourly: built,
    // mean battery lost per hour with the WLC active / inactive (the hours above), read by
    // Restaurant Case's "Avg T7 drain · WLC active / inactive" cards
    wirelessDrainPerHr: meanDrop(built.filter(e => e.wireless === true)),
    withoutWirelessDrainPerHr: meanDrop(built.filter(e => e.wireless === false)),
    // mean temperature in each third of the run (start / middle / end), as T7 computes it
    tempPhases: temperaturePhases(tempSeries, duration),
    // T7's views iterate these unconditionally, so they must be arrays even though the MDM
    // has nothing to put in them: the load's battery is never reported, and the sweep
    // keeps no RAM curve. Empty arrays make the charts say "nothing to plot" honestly.
    loadSeries: [], ramSeries: [],
    avgRam: null, maxRam: null,
    reason: c.reason,
    inProgress: !!c.inProgress, // the discharge running now (window.js runningCycle), not finished yet
    fullMs: c.fullMs,
    // the MDM's own cycles for this run (recorded counter end − start), null before recording began
    mdmCycles: mdmCyclesFor(readings, d.serial, c.start, c.end),
    start: c.start, end: c.end,
    source: 'mdm',
  };
}

/** Every device's cycles, reshaped. `rowsFor(serial)` supplies history when we have it. */
export function adaptAll(DEV, rowsFor = () => null, readings = null, curves = null, hours = null) {
  const decls = loadDecls(CTX.group), rota = loadRota(CTX.group);
  const ctx = { decls, rota, DEV, readings, curves, hours };
  const out = [];
  for (const d of DEV) {
    const rows = rowsFor(d.serial);
    // finished cycles, plus the one running now (from the live readings) so a test in
    // progress shows on the Overview before it ends
    const run = runningCycle(rows, d.cycles[d.cycles.length - 1]);
    for (const c of run ? [...d.cycles, run] : d.cycles) {
      const a = adaptCycle(d, c, rows, ctx);
      if (a) out.push(a);
    }
    // charges (the sweep's charge segments, ≤ 30 % up to ≥ 90 %): every charge from 25 Sep on is
    // a Charging Cycle — the lab recharges after every cycle, daily, with no plan entry needed
    // (the lab's choice, Oct 2026); it shows on the Overview, not in the Cycle plan's list
    for (const s of d.charges || []) {
      if (s.start < PLAN_FROM) continue;
      const a = adaptCycle(d, { ...s, reason: 'charge', fullMs: null }, rows, ctx);
      if (a) out.push({ ...a, testType: 'Charging Cycle' });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
export const CTX = { group: 'Test Cycles' };
