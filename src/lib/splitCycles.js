// What a set of runs (one test, day, firmware, group…) shows as its amount.
//
// Cycles come only from the MDM. The MDM's counter is per device and lifetime, so a
// split figure is the sum of each run's recorded counter difference (mdmCycles, set in
// adapt.js from data/lifetime.json). If every run in the set is covered, that sum is the
// figure; if any is not — the run predates the recording — the set shows its run count
// instead. Never a partial sum: it would quietly undercount and look exact.
import { fmtLifetime, runsText } from './fmt.js';

export function splitCycles(cycles) {
  const runs = cycles.length;
  const covered = runs > 0 && cycles.every(c => c.mdmCycles != null);
  return { runs, mdm: covered ? cycles.reduce((a, c) => a + c.mdmCycles, 0) : null };
}
export const splitText = cycles => {
  const { runs, mdm } = splitCycles(cycles);
  return mdm != null ? `${fmtLifetime(mdm)} battery cycles (MDM)` : runsText(runs);
};

/** Rows per distinct value of a field: bar length = runs (one unit for every row, so bars
 *  stay comparable), label = the MDM figure when the whole group is covered, else runs. */
export function splitBy(cycles, key) {
  const groups = new Map();
  for (const c of cycles) {
    const v = c[key];
    if (v == null || v === '' || v === 'Unknown') continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(c);
  }
  return [...groups.entries()].map(([label, list]) => ({ label, value: list.length, display: splitText(list), cycles: list }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
}
