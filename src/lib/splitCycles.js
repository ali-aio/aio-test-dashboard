// What a set of runs (one test, day, firmware, group…) shows as its amount.
//
// Cycles come only from the MDM. The MDM's counter is per device and lifetime, so a
// split figure is the sum of each run's recorded counter difference (mdmCycles, set in
// adapt.js from data/lifetime.json). If every run in the set is covered, that sum is the
// figure; if any is not — the run predates the recording — the set shows its run count
// instead. Never a partial sum: it would quietly undercount and look exact.
import { fmtLifetime, fmtInt } from './fmt.js';

// A cycle is one bench run of a test: the devices on it come off the charger together and
// each records its own discharge. So 17 devices running WLC on Load at once are 1 cycle,
// not 17. Entries of the same test that start within CYCLE_GAP_H of the first one are the
// same cycle. For a single device every entry is its own cycle.
export const CYCLE_GAP_H = 3;
export function countCycles(list) {
  const byTest = new Map();
  for (const c of list) { const k = c.testType ?? ''; if (!byTest.has(k)) byTest.set(k, []); byTest.get(k).push(c.start); }
  let n = 0;
  for (const starts of byTest.values()) {
    starts.sort((a, b) => a - b);
    let first = -Infinity;
    for (const t of starts) if (!(t - first <= CYCLE_GAP_H * 3600e3)) { n++; first = t; }
  }
  return n;
}
export const cyclesText = list => { const n = countCycles(list); return `${fmtInt(n)} cycle${n === 1 ? '' : 's'}`; };
/** Per-device entries (one device's share of a cycle) when only a count is at hand. */
export const deviceCyclesText = n => `${fmtInt(n)} device cycle${n === 1 ? '' : 's'}`;

export function splitCycles(cycles) {
  const runs = cycles.length;
  const covered = runs > 0 && cycles.every(c => c.mdmCycles != null);
  return { runs, mdm: covered ? cycles.reduce((a, c) => a + c.mdmCycles, 0) : null };
}
export const splitText = cycles => {
  const { runs, mdm } = splitCycles(cycles);
  return mdm != null ? `${fmtLifetime(mdm)} battery cycles (MDM)` : cyclesText(cycles);
};

/** Rows per distinct value of a field: bar length = cycles (devices running together count
 *  once), label = the MDM figure when the whole group is covered, else cycles. */
export function splitBy(cycles, key) {
  const groups = new Map();
  for (const c of cycles) {
    const v = c[key];
    if (v == null || v === '' || v === 'Unknown') continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(c);
  }
  return [...groups.entries()].map(([label, list]) => ({ label, value: countCycles(list), display: splitText(list), cycles: list }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
}
