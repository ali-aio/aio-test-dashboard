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
import { TEST_TYPES, testType as ttById, resolveDay, groupSerials, dayKey, windowOn, cycleAt, loadDecls, loadRota } from './plan.js';
import { FIELD_DISCHARGE, FIELD_CHARGING } from './testtypes.js';
import { perHourRate, HOUR_SNAP } from './t7cycles.js';
import { mdmCyclesFor } from './mdmTrack.js';
import { curveKey, curveSeries } from './curves.js';
import { TEMP_WARN, TEMP_LIMIT } from './profile.js';

const H = 3600e3;
const isNum = v => v != null && Number.isFinite(v);
const round = (v, n = 2) => (isNum(v) ? Math.round(v * 10 ** n) / 10 ** n : null);

// Which test was this run? Whatever the Cycle plan declared for the day it started. With
// nothing declared it falls to Field Discharge / Field Charging — the same two buckets T7
// uses for telemetry it had to cut out of a continuous stream itself.
export function testTypeFor(cycle, { decls, rota, DEV }) {
  // The declared cycle whose window this run started in — today's, or yesterday's still
  // running overnight. A day can hold several cycles, each with its own window.
  const hit = cycleAt(decls, cycle.start);
  if (hit) {
    const serials = groupSerials(hit.decl.group, DEV);
    if (serials.length && !serials.includes(cycle.serial)) return FIELD_DISCHARGE;
    return ttById(hit.decl.testType)?.name || FIELD_DISCHARGE;
  }
  const key = dayKey(cycle.start);
  const r = resolveDay(key, { decls: [], rota, ran: 1, devices: 0 });
  const tt = r.testType ? ttById(r.testType) : null;
  if (!tt) return cycle.charging ? FIELD_CHARGING : FIELD_DISCHARGE;
  const src = r.rota || null;
  const serials = groupSerials(src && src.group, DEV);
  if (serials.length && !serials.includes(cycle.serial)) return FIELD_DISCHARGE;
  const { startMs: from, endMs: to } = windowOn(key, src);
  if (cycle.start < from || cycle.start > to) return FIELD_DISCHARGE;
  return tt.name;
}

// Per-hour battery readings for one cycle, from whatever history rows we hold for it.
// `rows` are normalized samples ({ timestamp, battery_pct, extra }). Without rows the
// cycle still carries its summary, and the curve charts simply have one fewer line.
function seriesFor(rows, c) {
  if (!rows || !rows.length) return { series: [], tempSeries: [], firmware: null, wireless: false };
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
  return { series: partial ? [] : series, tempSeries: partial ? [] : tempSeries, firmware, wireless: n > 0 && wireless > n / 2 };
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
export function adaptCycle(d, c, rows, ctx) {
  const readings = ctx.readings;
  const duration = c.durationMs / H;
  if (!(duration > 0)) return null;
  // Prefer the run's stored curve (every run, even months old); fall back to the browser's
  // 7-day window for runs the sweep has not curved yet.
  const stored = ctx.curves?.[curveKey(d.serial, c.start)] || null;
  const fromWindow = seriesFor(rows, c);
  const { series, tempSeries } = stored ? curveSeries(stored) : fromWindow;
  const firmware = (stored && stored.fw) || fromWindow.firmware;
  const wireless = stored ? !!stored.w : fromWindow.wireless;
  const hourVals = wholeHours(series);
  const charging = c.endPct > c.startPct;
  const linear = (c.startPct - c.endPct) / duration;
  const hourly = perHourRate(hourVals, charging ? 'gain' : 'drop');
  const built = [];
  for (const h of [...hourVals.keys()].sort((a, b) => a - b)) {
    // `wireless` is per run here (the pad state), not per hour as in a bench CSV — close
    // enough for T7's Restaurant Case with/without-wireless split, and never invented.
    if (hourVals.has(h + 1)) built.push({ h, drop: hourVals.get(h) - hourVals.get(h + 1), wireless });
  }
  const temps = tempSeries.map(p => p.v);
  const start = new Date(c.start);
  return {
    id: `${d.serial}@${c.start}`,
    serial: d.serial,
    testType: testTypeFor({ ...c, serial: d.serial, charging }, ctx),
    build: null,          // not reported by the MDM — one device_class for the whole fleet
    android: null,        // not reported by the MDM — no OS/SDK field in the payload
    firmware: firmware || c.buildId || 'Unknown',
    date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
    week: null,
    duration: round(duration, 3),
    startBattery: c.startPct,
    endBattery: c.endPct,
    batteryDelta: c.endPct - c.startPct,
    dropPerHr: round(hourly != null ? hourly : linear, 3),
    rateBasis: hourly != null ? 'whole hours' : 'straight line over the run',
    loadGainPerHr: null,  // the MDM reports the T7's battery, never the load's
    loadType: null,
    charger: null,
    padState: wireless ? 'Wireless' : 'Wired',
    maxTemp: c.maxTemp ?? (temps.length ? Math.max(...temps) : null),
    avgTemp: c.avgTemp ?? null,
    minAbove40: c.thermal?.minAbove40 ?? null,
    minAbove45: c.thermal?.minAbove45 ?? null,
    series, tempSeries, hourly: built,
    // T7's views iterate these unconditionally, so they must be arrays even though the MDM
    // has nothing to put in them: the load's battery is never reported, and the sweep
    // keeps no RAM curve. Empty arrays make the charts say "nothing to plot" honestly.
    loadSeries: [], ramSeries: [],
    avgRam: null, maxRam: null,
    reason: c.reason,
    fullMs: c.fullMs,
    // the MDM's own cycles for this run (recorded counter end − start), null before recording began
    mdmCycles: mdmCyclesFor(readings, d.serial, c.start, c.end),
    start: c.start, end: c.end,
    source: 'mdm',
  };
}

/** Every device's cycles, reshaped. `rowsFor(serial)` supplies history when we have it. */
export function adaptAll(DEV, rowsFor = () => null, readings = null, curves = null) {
  const decls = loadDecls(CTX.group), rota = loadRota(CTX.group);
  const ctx = { decls, rota, DEV, readings, curves };
  const out = [];
  for (const d of DEV) {
    const rows = rowsFor(d.serial);
    for (const c of d.cycles) {
      const a = adaptCycle(d, c, rows, ctx);
      if (a) out.push(a);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
export const CTX = { group: 'Test Cycles' };
