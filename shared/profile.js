// Battery health, charge profile and thermal profile — pure functions over history rows
// (normalized: { timestamp, battery_pct, extra: { charging, battery_temp_c, charger_type,
// wlc_status } }) and over the cycle objects from cycles.js. No DOM, no fetch.
const MIN = 60e3, H = 3600e3;
const ts = r => Date.parse(r.timestamp);
const temp = r => { const t = r.extra?.battery_temp_c; return typeof t === 'number' && t > 0 ? t : null; };

// JEITA / IEC 62133 derived limits used across the dashboard.
export const TEMP_WARN = 40, TEMP_LIMIT = 45;

// ── Battery health ────────────────────────────────────────────────────────────
// Apple reports capacity as % of new and flags 80%. We don't get mAh from the client, so
// the proxy is runtime: median of the last 3 counted cycles vs the first 3. Fade/cycle is a
// least-squares slope on normalized runtime; the 80% crossing is projected from it.
// Outliers (idle drains > 1.5× the device median, aborted runs < 0.5×) are dropped first;
// the baseline is the device's best 3-cycle median, so health never exceeds ~100%.
export function batteryHealth(allCycles) {
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const m0 = allCycles.length ? med(allCycles.map(c => c.durationMs)) : 0;
  const cycles = allCycles.filter(c => c.durationMs > m0 * .5 && c.durationMs < m0 * 1.5);
  if (cycles.length < 6) return null;
  let base = 0; for (let i = 0; i + 3 <= cycles.length; i++) base = Math.max(base, med(cycles.slice(i, i + 3).map(c => c.durationMs)));
  const ys = cycles.map(c => c.durationMs / base * 100), n = ys.length, xs = ys.map((_, i) => i + 1);
  const mx = (n + 1) / 2, my = ys.reduce((a, b) => a + b) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const health = med(ys.slice(-3));
  const at80 = slope < -0.05 ? Math.round(n + (health - 80) / -slope) : null; // cycle index where it crosses 80%
  return { health, slope, n, at80, series: ys, baseMs: base, used: cycles.length, dropped: allCycles.length - cycles.length };
}

// ── Charge profile ────────────────────────────────────────────────────────────
// A charge segment = a stretch where the battery is rising (or `charging` is set) from
// ≤ startMax up to ≥ endMin. Older firmware has no `charging` flag, so rising level alone
// is enough. Times to 50/80/95% are interpolated between samples.
export function chargeSegments(rows, { startMax = 30, endMin = 90 } = {}) {
  const segs = []; let s = -1;
  const rising = i => rows[i].battery_pct > rows[i - 1].battery_pct || (rows[i].extra?.charging && rows[i].battery_pct >= rows[i - 1].battery_pct);
  for (let i = 1; i <= rows.length; i++) {
    const up = i < rows.length && rising(i) && ts(rows[i]) - ts(rows[i - 1]) < 2 * H;
    if (up && s < 0) s = i - 1;
    if (!up && s >= 0) {
      const e = i - 1, a = rows[s], b = rows[e];
      if (a.battery_pct <= startMax && b.battery_pct >= endMin) {
        const full = rows.slice(s, e + 1).findIndex(r => r.battery_pct >= 95), e2 = full >= 0 ? s + full : e, bb = rows[e2];
        const seg = rows.slice(s, e2 + 1), t0 = ts(a), at = p => { // ms from start to first crossing of p%
          for (let k = 1; k < seg.length; k++) if (seg[k].battery_pct >= p) { const q = seg[k - 1], f = (p - q.battery_pct) / (seg[k].battery_pct - q.battery_pct || 1); return ts(q) + f * (ts(seg[k]) - ts(q)) - t0; }
          return null;
        };
        const temps = seg.map(temp).filter(x => x != null), types = {}; seg.forEach(r => { const t = r.extra?.charger_type || (r.extra?.wlc_status ? 'wireless' : null); if (t) types[t] = (types[t] || 0) + 1; });
        const type = Object.entries(types).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
        segs.push({ start: t0, end: ts(bb), durationMs: ts(bb) - t0, startPct: a.battery_pct, endPct: bb.battery_pct, t50: at(50), t80: at(80), t95: at(95),
          wireless: /wireless|wlc|qi/i.test(type || '') || seg.some(r => r.extra?.wlc_status), type, maxTemp: temps.length ? Math.max(...temps) : null,
          curve: seg.filter((_, k) => k % Math.max(1, Math.floor(seg.length / 40)) === 0 || k === seg.length - 1).map(r => [Math.round((ts(r) - t0) / MIN), r.battery_pct]) });
      }
      s = -1;
    }
  }
  return segs;
}

// ── Thermal profile ───────────────────────────────────────────────────────────
// For one cycle window: minutes spent at/above the warn and limit temperatures, and the
// mean temperature per 10% state-of-charge bucket (index 0 = 90–100%, 9 = 0–10%).
export function thermalStats(rows, start, end) {
  const seg = rows.filter(r => ts(r) >= start && ts(r) <= end && temp(r) != null);
  if (seg.length < 2) return null;
  let above40 = 0, above45 = 0, max = -Infinity, sum = 0; const buckets = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < seg.length; i++) {
    const t = temp(seg[i]), dt = i ? Math.min(ts(seg[i]) - ts(seg[i - 1]), 30 * MIN) : 0;
    if (t >= TEMP_WARN) above40 += dt; if (t >= TEMP_LIMIT) above45 += dt; if (t > max) max = t; sum += t;
    buckets[Math.min(9, Math.floor((100 - seg[i].battery_pct) / 10))].push(t);
  }
  return { minAbove40: Math.round(above40 / MIN), minAbove45: Math.round(above45 / MIN), maxTemp: max, avgTemp: sum / seg.length,
    socTemps: buckets.map(b => b.length ? +(b.reduce((a, c) => a + c) / b.length).toFixed(1) : null) };
}
