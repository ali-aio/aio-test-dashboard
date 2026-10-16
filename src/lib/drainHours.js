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
// Plain JS, no DOM.
import { lifetimeAt } from './drainAge.js';

const H = 3600e3, MAX_STEP = 30 * 60e3;
export const SLOT = 15 * 60e3;
export const MIN_MINUTES = 120; // a band needs 2 h of matching time, or it is a guess

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

// slot -> what was going on
const factorsOf = (x, c) => ({ load: x[3] * 2 >= x[2], ads: ADS_BY_TEST[c.testType] ?? null, temp: x[4] >= 0 ? x[4] / 10 : null, test: c.testType });
export const matches = (f, { load = 'all', ads = 'all', temp = 'all', test = 'all' } = {}) =>
  (load === 'all' || (load === 'on') === f.load)
  && (ads === 'all' || (f.ads != null && (ads === 'on') === f.ads))
  && (temp === 'all' || (f.temp != null && TEMP_BANDS.find(b => b.id === temp)?.test(f.temp)))
  && (test === 'all' || f.test === test);

/** Every device's slots inside its counted cycles, with their factors and the battery's age. */
export function tagSlots(cycles, hours, drops) {
  const bySerial = new Map();
  for (const c of cycles) {
    if (c.charging || !(c.end > c.start)) continue;
    if (!bySerial.has(c.serial)) bySerial.set(c.serial, []);
    bySerial.get(c.serial).push(c);
  }
  const out = {};
  for (const [sn, list] of bySerial) {
    const hs = hours?.[sn]?.h; if (!hs?.length) continue;
    list.sort((a, b) => a.start - b.start);
    const led = drops?.[sn], tagged = [];
    let i = 0;
    for (const x of hs) {
      const mid = x[0] + SLOT / 2;
      while (i < list.length && list[i].end < mid) i++;
      if (i >= list.length) break;
      const c = list[i];
      if (mid < c.start || !x[2]) continue;
      tagged.push({ t: x[0], drop: x[1] / 10, min: x[2], f: factorsOf(x, c), age: lifetimeAt(led, x[0]) });
    }
    out[sn] = tagged;
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
