// Which figure stands for "many cycles": the mean, or P95 (the lab, 21 Oct 2026: "going with P95",
// both kept for now, may be reverted). One switch for the whole app (the filter bar), so going back is
// one change: the browser's choice is in localStorage `statMode`, its default is STAT_DEFAULT below.
//
// P95 is read on the bad side of each measure, so it always says "95 % of runs were at least this
// good": the 95th percentile where higher is worse (drain, time to charge, temperature) and the 5th
// where lower is worse (runtime, battery left, charge rate). Excel's PERCENTILE.INC, so the lab's
// sheet gives the same number. Plain JS (src/lib): the tests run it with the mean (the default here).

export const STAT_DEFAULT = 'p95'; // what the app opens on; 'avg' to go back to the mean
let mode = 'avg';

export const getStat = () => mode;
export function setStat(m) { mode = m === 'p95' ? 'p95' : 'avg'; }
export const isP95 = () => mode === 'p95';

/** Excel PERCENTILE.INC: p in 0..1, linear between the two nearest ranks; null when empty. */
export function percentileInc(values, p) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const r = p * (xs.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
  return xs[lo] + (xs[hi] - xs[lo]) * (r - lo);
}

const meanOf = (values) => {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

/** The figure for a set of runs: the mean, or P95 on the bad side. worse: 'high' (drain,
 *  temperature, time to charge) or 'low' (runtime, battery level, charge rate). */
export function typical(values, worse = 'high') {
  if (mode !== 'p95') return meanOf(values);
  return percentileInc(values, worse === 'low' ? 0.05 : 0.95);
}

/** Label words: "Avg" / "P95" before a measure, "Average" / "P95" on its own. */
export const statShort = () => (mode === 'p95' ? 'P95' : 'Avg');
export const statLong = () => (mode === 'p95' ? 'P95' : 'Average');
/** One line for a tooltip or a card's subtitle. */
export const statHint = () => (mode === 'p95'
  ? 'P95: 95 % of runs were at least this good (the 95th percentile of drain / temperature / time to charge, the 5th of runtime / battery / charge rate)'
  : 'Average over the runs');
