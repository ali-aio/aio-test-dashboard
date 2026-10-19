// Drain rate by battery age, split by what was going on: load on the pad or not, ads running or
// not, how hot the battery was. One cycle mixes these (Restaurant Case: 3 h with a load, 11 h
// without), and a phone may sit on the pad for only 20 minutes, so the rate is worked out per
// 15-MINUTE SLOT, not per cycle. The server keeps each device's slots (data/hours.json, v 2,
// buildHours in server/sweep.mjs, readings every 5 min):
//   [slotStartMs, drop (tenths of a point), minutes on battery, minutes with a load on the pad,
//    mean battery temp (tenths of °C, -1 none)]
// The browser joins every slot to the counted cycle it fell in (the time a test ran, so a
// device sitting unplugged on a shelf never counts) for its test, and to the drop ledger
// (drainAge.js) for the battery's age then. A band's rate = points drained ÷ hours on battery.
// Ads are not in the telemetry: they come from the test (the lab's descriptions, plan.js).
// External temperature isn't either: the battery's own is the nearest the devices report.
// Before the Cycle plan (25 Sep 2026) the test comes from the lab's own sheets, kept only where
// the readings agree (data/sheet-runs.json, scripts/sheet-runs.mjs). The lab calls those sheets
// inconsistent, so this table is the ONLY thing that reads them. A sheet run also counts where
// the cycle detector did not count one (e.g. it started below 95 %).
// Firmware v2.0.3–v2.0.4 (July – mid Aug 2026) reported no load on the pad while one was on it:
// in a sheet run from then, the load comes from the test (Restaurant Case / WLC + Discharge: the
// first 3 h); elsewhere a slot draining ≥ LOAD_RATE with no load reported counts as not known.
// Plain JS, no DOM.
import { lifetimeAt } from './drainAge.js';
import { FIELD_DISCHARGE } from './testtypes.js';

const H = 3600e3, MAX_STEP = 30 * 60e3;
export const SLOT = 15 * 60e3;
export const MIN_MINUTES = 120; // a band needs 2 h of matching time, or it is a guess
export const LOAD_RATE = 9;     // %/h: nothing but a load on the pad drains this fast

// ads running in each test (names as cycles carry them); null = not known
export const ADS_BY_TEST = {
  'WLC on Load': true, 'Ads only': true, 'WLC + Discharge on Ads': true, 'Restaurant Case': true,
  'Discharge on Load only': false, 'Burn-in Test': false,
};
export const TEMP_BANDS = [
  { id: 'cool', label: 'Battery under 35 °C', test: t => t < 35 },
  { id: 'warm', label: 'Battery 35–40 °C', test: t => t >= 35 && t < 40 },
  { id: 'hot', label: 'Battery 40 °C or more', test: t => t >= 40 },
];

/** 15-minute slots from history rows (raw or normalize()d). Only time off the charger counts: a
 *  stretch between two readings ≤ 30 min apart, on battery at its start and not rising; a stretch
 *  crossing a slot's edge is shared between the slots by time. */
export function slotBuckets(rows) {
  const pts = rows.filter(r => !r.empty && typeof r.battery_pct === 'number')
    .map(r => ({ t: Date.parse(r.sample_at || r.timestamp), b: r.battery_pct, ch: r.extra?.charging, pad: !!r.extra?.wlc_status, c: r.extra?.battery_temp_c }))
    .filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  const by = new Map();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], z = pts[i + 1], dt = z.t - a.t;
    if (dt <= 0 || dt > MAX_STEP || a.ch === true || z.b > a.b) continue;
    for (let s = Math.floor(a.t / SLOT) * SLOT; s < z.t; s += SLOT) {
      const part = Math.min(z.t, s + SLOT) - Math.max(a.t, s); if (part <= 0) continue;
      let x = by.get(s); if (!x) by.set(s, (x = { drop: 0, min: 0, pad: 0, tSum: 0, tMin: 0 }));
      const m = part / 60e3;
      x.drop += (a.b - z.b) * part / dt; x.min += m; if (a.pad) x.pad += m;
      if (typeof a.c === 'number' && a.c > 0) { x.tSum += a.c * m; x.tMin += m; }
    }
  }
  return [...by].sort((p, q) => p[0] - q[0]).map(([t, x]) => [t, Math.round(x.drop * 10), Math.round(x.min * 10) / 10, Math.round(x.pad * 10) / 10,
    x.tMin ? Math.round((x.tSum / x.tMin) * 10) : -1]);
}
/** A device's stored slots with newer readings folded in: slots from the first new reading's slot on are rebuilt. */
export function extendSlots(prev, rows) {
  const fresh = slotBuckets(rows);
  if (!fresh.length) return prev || [];
  return [...(prev || []).filter(x => x[0] < fresh[0][0]), ...fresh];
}

// a load on the pad, from the test, for a sheet run whose readings did not report the pad
const LOAD_BY_TEST = {
  'Restaurant Case': (t, s) => t < s.start + 3 * 3600e3, 'WLC + Discharge on Ads': (t, s) => t < s.start + 3 * 3600e3,
  'WLC on Load': () => true, 'Discharge on Load only': () => true, 'Ads only': () => false, 'Burn-in Test': () => false,
};
// slot -> what was going on (load null = not known)
function factorsOf(x, test, sheet) {
  const mid = x[0] + SLOT / 2;
  let load = x[3] * 2 >= x[2];
  if (sheet && !sheet.pad) load = LOAD_BY_TEST[test] ? LOAD_BY_TEST[test](mid, sheet) : null;
  else if (!load && x[1] / 10 / (x[2] / 60) >= LOAD_RATE) load = null;
  return { load, ads: ADS_BY_TEST[test] ?? null, temp: x[4] >= 0 ? x[4] / 10 : null, test };
}
export const matches = (f, { load = 'all', ads = 'all', temp = 'all', test = 'all' } = {}) =>
  (load === 'all' || (f.load != null && (load === 'on') === f.load))
  && (ads === 'all' || (f.ads != null && (ads === 'on') === f.ads))
  && (temp === 'all' || (f.temp != null && TEMP_BANDS.find(b => b.id === temp)?.test(f.temp)))
  && (test === 'all' || f.test === test);

/** One cycle's drain split by the wireless pad: %/h over its 15-min slots with a load on the pad
 *  (for most of the slot) and without. `slots` = one device's hours.json `h`. A side with under
 *  `minMin` minutes is null (Restaurant Case: ~3 h with, ~11 h without; WLC on Load: all with).
 *  Firmware v2.0.3–v2.0.4 reported no pad at all, so its cycles read as all "without". */
export function padSplit(slots, start, end, { minMin = 30 } = {}) {
  const on = { d: 0, m: 0 }, off = { d: 0, m: 0 };
  for (const x of slots || []) {
    const mid = x[0] + SLOT / 2;
    if (mid < start || mid > end || !x[2]) continue;
    const b = x[3] * 2 >= x[2] ? on : off;
    b.d += x[1] / 10; b.m += x[2];
  }
  const out = b => (b.m >= minMin ? { rate: b.d / (b.m / 60), hours: b.m / 60 } : null);
  return { on: out(on), off: out(off) };
}

/** Every device's slots inside its counted cycles (or a sheet run, see the top), with their
 *  factors and the battery's age. A Cycle plan test wins over the sheet's. */
export function tagSlots(cycles, hours, drops, sheetRuns = []) {
  const group = (list, keep) => {
    const m = new Map();
    for (const c of list || []) if (keep(c)) { if (!m.has(c.serial)) m.set(c.serial, []); m.get(c.serial).push(c); }
    for (const l of m.values()) l.sort((a, b) => a.start - b.start);
    return m;
  };
  const bySerial = group(cycles, c => !c.charging && c.end > c.start), bySheet = group(sheetRuns, r => r.end > r.start);
  const out = {};
  for (const sn of new Set([...bySerial.keys(), ...bySheet.keys()])) {
    const hs = hours?.[sn]?.h; if (!hs?.length) continue;
    const list = bySerial.get(sn) || [], sheet = bySheet.get(sn) || [];
    const led = drops?.[sn], tagged = [];
    let i = 0, j = 0;
    for (const x of hs) {
      const mid = x[0] + SLOT / 2;
      while (i < list.length && list[i].end < mid) i++;
      while (j < sheet.length && sheet[j].end < mid) j++;
      if (!x[2]) continue;
      const c = i < list.length && mid >= list[i].start ? list[i] : null;
      const s = j < sheet.length && mid >= sheet[j].start ? sheet[j] : null;
      if (!c && !s) continue;
      const fromSheet = s && (!c || c.testType === FIELD_DISCHARGE);
      const test = fromSheet ? s.test : c.testType;
      tagged.push({ t: x[0], drop: x[1] / 10, min: x[2], f: factorsOf(x, test, fromSheet ? s : null), age: lifetimeAt(led, x[0]) });
    }
    if (tagged.length) out[sn] = tagged;
  }
  return out;
}

const band = () => ({ drop: 0, min: 0, tSum: 0, tMin: 0, load: 0 });
const add = (b, h) => { b.drop += h.drop; b.min += h.min; if (h.f.temp != null) { b.tSum += h.f.temp * h.min; b.tMin += h.min; } if (h.f.load) b.load += h.min; };
const done = b => (b && b.min >= MIN_MINUTES ? { rate: b.drop / (b.min / 60), hours: b.min / 60, temp: b.tMin ? b.tSum / b.tMin : null, loadShare: b.load / b.min } : null);

/** One row per device: drain %/h in each `step`-cycle band of battery age (column 5 = 5 up to 10, …) over
 *  the hours matching `filter`, and over its last 7 days of matching time. */
export function drainBands(tagged, filter = {}, { step = 5 } = {}) {
  let top = -1;
  const rows = Object.entries(tagged).map(([serial, hs]) => {
    const at = {}, last = band(); const end = hs.length ? hs[hs.length - 1].t : 0;
    for (const h of hs) {
      if (!matches(h.f, filter)) continue;
      if (h.age != null) { const k = Math.floor(h.age / step) * step; (at[k] ||= band()); add(at[k], h); top = Math.max(top, k); }
      if (h.t > end - 7 * 24 * H) add(last, h);
    }
    const out = {}; for (const k in at) { const d = done(at[k]); if (d) out[k] = d; }
    return { serial, at: out, latest: done(last) };
  }).filter(r => Object.keys(r.at).length || r.latest);
  // columns from `step` on (5, 10, 15 …): the first cycles of a new battery are not shown
  const marks = []; for (let k = step; k <= top; k += step) if (rows.some(r => r.at[k])) marks.push(k);
  return { marks, rows };
}

/** The fleet's average drain per band for each condition on its own: load / no load, ads / no
 *  ads, battery temperature. `base` (e.g. one test) applies to every row. */
export function conditionBands(tagged, base = {}, { step = 5 } = {}) {
  const conds = [
    { label: 'Load placed', f: { load: 'on' } }, { label: 'No load', f: { load: 'off' } },
    { label: 'Ads running', f: { ads: 'on' } }, { label: 'No ads', f: { ads: 'off' } },
    ...TEMP_BANDS.map(b => ({ label: b.label, f: { temp: b.id } })),
  ];
  const mean = xs => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const all = conds.map(c => ({ ...c, t: drainBands(tagged, { ...base, ...c.f }, { step }) }));
  const marks = [...new Set(all.flatMap(c => c.t.marks))].sort((a, b) => a - b);
  return { marks, rows: all.map(c => ({ label: c.label,
    at: Object.fromEntries(marks.map(k => { const v = c.t.rows.map(r => r.at[k]?.rate).filter(x => x != null); return [k, v.length ? { rate: mean(v), devices: v.length } : null]; })),
    latest: (() => { const v = c.t.rows.map(r => r.latest?.rate).filter(x => x != null); return v.length ? { rate: mean(v), devices: v.length } : null; })() })) };
}
