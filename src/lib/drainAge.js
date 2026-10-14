// Drain rate by battery age: how fast a device drained at its 10th, 20th, 30th… battery cycle.
//
// The MDM reports a device's lifetime discharge counter (discharge_total_pct) only as of now,
// and /history does not carry it. But the MDM built that counter from the battery readings
// (discharge_backfilled), so it can be rebuilt for any moment: today's counter minus every
// percentage point drained since then. The backend sweep keeps that running sum per device —
// a "drop ledger", data/drops.json — built once from the whole history, then extended on
// every sweep.
//
// File shape: { v, group, at, devices: { serial: { from, last: [tMs, pct], cum, pts: [[tMs, cum], ...],
//   anchor: [tMs, discharge_total_pct] } } } — cum is the drop summed from the device's first
// reading; pts keeps one point per hour in which it moved.
// Plain JS, no DOM: server/sweep.mjs writes it, the browser reads it.

const HOUR = 3600e3;

/** Fold readings ([[tMs, pct]], oldest first) into a device's ledger. Readings at or before
 *  the last one already counted are skipped, so overlapping fetches never count twice. */
export function extendLedger(led, readings) {
  const l = led ? { ...led, pts: led.pts.slice() } : { from: null, last: null, cum: 0, pts: [] };
  for (const [t, pct] of readings) {
    if (!Number.isFinite(t) || typeof pct !== 'number') continue;
    if (l.last && t <= l.last[0]) continue;
    if (l.from == null) { l.from = t; l.pts.push([t, 0]); }
    if (l.last && pct < l.last[1]) l.cum += l.last[1] - pct;
    l.last = [t, pct];
    const p = l.pts[l.pts.length - 1];
    if (l.cum !== p[1]) { if (Math.floor(t / HOUR) === Math.floor(p[0] / HOUR) && l.pts.length > 1) l.pts[l.pts.length - 1] = [t, l.cum]; else l.pts.push([t, l.cum]); }
  }
  return l;
}

/** The drop summed up to time t (the last point at or before it); null before the ledger starts. */
export function cumAt(led, t) {
  if (!led?.pts?.length || t < led.from) return null;
  let lo = 0, hi = led.pts.length - 1;
  if (t >= led.pts[hi][0]) return led.last && t >= led.last[0] ? led.cum : led.pts[hi][1];
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (led.pts[m][0] <= t) lo = m; else hi = m - 1; }
  return led.pts[lo][1];
}

/** Lifetime battery cycles at time t: the MDM counter at the anchor, less what drained since. */
export function lifetimeAt(led, t) {
  if (!led?.anchor) return null;
  const a = cumAt(led, led.anchor[0]), b = cumAt(led, t);
  if (a == null || b == null) return null;
  return Math.max(0, (led.anchor[1] - (a - b)) / 100);
}

/** One row per device: its drain rate (%/h) at each checkpoint (10, 20, 30… cycles) and now.
 *  A checkpoint holds the first cycle that started with the battery between N and N + step
 *  lifetime cycles; none there -> null. `cycles` are one test type's, so the rates compare. */
export function drainByAge(cycles, drops, { step = 10 } = {}) {
  const by = new Map()
  for (const c of cycles) {
    const rate = c.dropPerHr == null ? null : Math.abs(c.dropPerHr);
    if (rate == null || !Number.isFinite(rate)) continue;
    const age = lifetimeAt(drops?.[c.serial], c.start);
    if (!by.has(c.serial)) by.set(c.serial, []);
    by.get(c.serial).push({ c, rate, age });
  }
  let top = 0;
  const rows = [...by].map(([serial, list]) => {
    list.sort((a, b) => a.c.start - b.c.start);
    const aged = list.filter((x) => x.age != null);
    for (const x of aged) top = Math.max(top, x.age);
    const at = {};
    for (const x of aged) { const k = Math.floor(x.age / step) * step; if (k >= step && !(k in at)) at[k] = x; }
    return { serial, at, now: list[list.length - 1], unaged: list.length - aged.length };
  });
  const marks = [];
  for (let k = step; k <= top; k += step) marks.push(k);
  return { marks, rows };
}
