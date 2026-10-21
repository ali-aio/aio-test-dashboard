#!/usr/bin/env node
// The lab's hand-kept cycle sheets (one CSV per test, a reading every hour) -> data/sheet-runs.json:
// which test each device ran, and when, before the Cycle plan existed (25 Sep 2026).
//
// USED ONLY BY "Drain rate by battery age" (src/lib/drainHours.js). The lab says the sheets are
// inconsistent, so nothing else reads this file — not the Cycle plan, not Auto, not Health.
// And a sheet run is kept only when the device's own readings agree with it:
//   - the date: the sheets mix day/month and month/day, so both are tried; the device must have
//     left the charger that day and drained on battery for most of the sheet's hours;
//   - the drain: the sheet's points per hour within 25 % of the readings' over the same hours;
//   - the test: the time with a load on the pad must fit it (Ads only / Burn-in: none; Restaurant
//     Case / WLC + Discharge on Ads: 1.5–5 h; WLC on Load: most of the run; WLC on Phone: some).
//     Firmware v2.0.3–v2.0.4 (July – mid Aug 2026) reported no load on the pad (wlc_status 0) while
//     one was on it, so where the readings show no pad time the drain decides instead: a load drains
//     ~3x faster (Restaurant Case / WLC + Discharge: the first 3 h ≥ 1.8x the rest; WLC on Load:
//     ≥ 8 %/h; Ads only / Burn-in: under 7 %/h and no such first 3 h).
// Runs from AUTO_FROM on are skipped: the Cycle plan covers those.
//
//   node scripts/sheet-runs.mjs <folder of CSVs> <hours.json from the server> [out]
import fs from 'node:fs';
import path from 'node:path';
import { AUTO_FROM } from '../src/lib/autoPlan.js';

const [dir, hoursFile, outFile = 'data/sheet-runs.json'] = process.argv.slice(2);
if (!dir || !hoursFile) { console.error('usage: node scripts/sheet-runs.mjs <csv folder> <hours.json> [out]'); process.exit(1); }
const hours = JSON.parse(fs.readFileSync(hoursFile, 'utf8')).devices;
const H = 3600e3, TZ = 5 * H; // the lab is in Asia/Karachi (UTC+5, no DST)

const LABELS = {
  Restaurant_Case: 'Restaurant Case', 'WLC+Discharge_on_Ads': 'WLC + Discharge on Ads', '24/7_Discharging_on_Ads': 'Ads only',
  WLC_on_Load: 'WLC on Load', WLC_on_Phone: 'WLC on Phone', 'Burn-in Test': 'Burn-in Test',
  _Discharging_on_Ads: null, // in the WLC + Discharge file without the "WLC+": decided by the pad below
};
const PAD_FITS = {
  'Ads only': (p) => p < 0.5, 'Burn-in Test': (p) => p < 0.5,
  'Restaurant Case': (p) => p >= 1.5 && p <= 5, 'WLC + Discharge on Ads': (p) => p >= 1.5 && p <= 5,
  'WLC on Load': (p, d) => p >= 0.7 * d, 'WLC on Phone': (p) => p >= 0.3,
};
// when the pad was not reported: r3 = %/h in the first 3 h, rest = %/h after, all = whole run
const DRAIN_FITS = {
  'Ads only': (x) => x.all < 7 && x.r3 < 1.5 * x.rest, 'Burn-in Test': (x) => x.all < 7 && x.r3 < 1.5 * x.rest,
  'Restaurant Case': (x) => x.r3 >= 1.8 * x.rest, 'WLC + Discharge on Ads': (x) => x.r3 >= 1.8 * x.rest,
  'WLC on Load': (x) => x.all >= 8, 'WLC on Phone': () => false,
};
const rateOf = (sl) => { const m = sl.reduce((t, x) => t + x[2], 0); return m >= 30 ? sl.reduce((t, x) => t + x[1] / 10, 0) / (m / 60) : null; };

// 1. every run in the sheets: file, label, serial, date -> its hourly points
const runs = new Map();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
  for (const line of fs.readFileSync(path.join(dir, f), 'latin1').split(/\r?\n/)) {
    const c = line.split(',').map((x) => x.trim()), sn = c[1];
    if (!/^AT07/.test(sn || '') || !(c[0] in LABELS) || !hours[sn]) continue;
    const date = c.slice(5).find((x) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(x));
    if (!date) continue;
    const k = [f, c[0], sn, date].join('|');
    if (!runs.has(k)) runs.set(k, { file: f, label: c[0], sn, date, pts: [] });
    const hr = Number(c[5]), pct = parseFloat(c[6]);
    if (c[5] !== '' && Number.isFinite(hr) && Number.isFinite(pct)) runs.get(k).pts.push([hr, pct]);
  }
}

// 2. the device's stretches on battery (15-min slots back to back), from its readings
const stretches = {};
for (const [sn, v] of Object.entries(hours)) {
  const out = []; let cur = null;
  for (const x of v.h || []) {
    if (x[2] < 5) continue;
    if (!cur || x[0] - cur.last > 30 * 60e3) { cur = { start: x[0], last: x[0], slots: [] }; out.push(cur); }
    cur.slots.push(x); cur.last = x[0];
  }
  stretches[sn] = out;
}
const dayStart = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? Date.UTC(y, m - 1, d) - TZ : null);

// 3. keep a run only when the readings agree with it
const why = {}, kept = [];
const no = (r, w) => { (why[w] ||= 0); why[w]++; };
for (const r of runs.values()) {
  const p = r.pts.sort((a, b) => a[0] - b[0]);
  if (p.length < 3 || p[p.length - 1][0] < 2) { no(r, 'fewer than 3 readings or under 2 h'); continue; }
  const sheetH = p[p.length - 1][0] - p[0][0], sheetRate = (p[0][1] - p[p.length - 1][1]) / sheetH;
  if (!(sheetRate > 0)) { no(r, 'battery not falling in the sheet'); continue; }
  const [a, b, y] = r.date.split('/').map(Number);
  const days = [...new Set([dayStart(y, b, a), dayStart(y, a, b)].filter((x) => x != null))];
  let best = null;
  for (const d0 of days) {
    for (const s of stretches[r.sn]) {
      if (s.start < d0 || s.start >= d0 + 24 * H) continue;
      // the readings over the sheet's hours from the stretch's start
      const end = s.start + sheetH * H;
      const sl = s.slots.filter((x) => x[0] < end);
      const min = sl.reduce((t, x) => t + x[2], 0), drop = sl.reduce((t, x) => t + x[1] / 10, 0), pad = sl.reduce((t, x) => t + x[3], 0) / 60;
      if (min < 0.75 * sheetH * 60) continue; // on battery for most of the sheet's hours
      const rate = drop / (min / 60), err = Math.abs(rate - sheetRate) / sheetRate;
      if (!best || err < best.err) best = { start: s.start, end: Math.min(end, s.last + 15 * 60e3), err, padH: pad, durH: min / 60, rate,
        drain: { all: rate, r3: rateOf(sl.filter((x) => x[0] < s.start + 3 * H)), rest: rateOf(sl.filter((x) => x[0] >= s.start + 3 * H)) ?? rate } };
    }
  }
  if (!best) { no(r, 'no stretch on battery that day'); continue; }
  if (best.err > 0.25) { no(r, 'drain differs from the readings by > 25 %'); continue; }
  if (best.start >= AUTO_FROM) { no(r, 'from 25 Sep: the Cycle plan covers it'); continue; }
  const padSeen = best.padH >= 0.3;
  const test = LABELS[r.label] ?? ((padSeen ? best.padH >= 1.5 : best.drain.r3 >= 1.8 * best.drain.rest) ? 'WLC + Discharge on Ads' : 'Ads only');
  if (padSeen ? !PAD_FITS[test](best.padH, best.durH) : !DRAIN_FITS[test](best.drain)) { no(r, `${padSeen ? 'load on the pad' : 'drain (pad not reported)'} does not fit the test`); continue; }
  kept.push({ serial: r.sn, start: best.start, end: best.end, test, pad: padSeen, sheet: `${path.basename(r.file, '.csv')} · ${r.date}` });
}
// one run per device and start (the same run written in two sheets: the first one kept)
const seen = new Set(), list = kept.sort((a, b) => a.serial.localeCompare(b.serial) || a.start - b.start)
  .filter((r) => { const k = `${r.serial}|${r.start}`; if (seen.has(k)) return false; seen.add(k); return true; });

fs.writeFileSync(outFile, JSON.stringify({ v: 1, made: new Date().toISOString(), note: 'Drain rate by battery age only; from the lab sheets, checked against the readings (scripts/sheet-runs.mjs)', runs: list }));
const by = {}; for (const r of list) by[r.test] = (by[r.test] || 0) + 1;
console.log(`sheet runs on our devices: ${runs.size} · kept ${list.length}`, by);
console.log('left out:', why);
