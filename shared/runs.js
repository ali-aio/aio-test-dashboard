// Cycle runs started from the dashboard. The MDM API is read-only, so a run lives in this
// browser's localStorage (per group) — it is NOT shared with teammates' browsers. A run is
// just { name, startedAt, serials }; everything else is re-derived from /history with the
// same detector the historical import used (shared/cycles.js).
import { fetchHistoryRange, mapLimit } from './data.js';
import { detectCycles, normalize } from './cycles.js';

const KEY = g => `cycleRuns:v1:${g}`;
const MIN = 60e3;
const rowsMem = new Map(); // `${runId}:${serial}` → history rows, in memory only (for charts)

export function loadRuns(group) { try { return JSON.parse(localStorage.getItem(KEY(group))) || []; } catch (e) { return []; } }
export function saveRuns(group, runs) { try { localStorage.setItem(KEY(group), JSON.stringify(runs)); } catch (e) {} }
export const runRows = (run, serial) => rowsMem.get(`${run.id}:${serial}`) || null;

export { normalize };

export function newRun(runs, { name, group, serials }) {
  const n = runs.reduce((m, r) => Math.max(m, +r.id.slice(2) || 0), 0) + 1;
  return { id: 'L-' + String(n).padStart(3, '0'), name, group, startedAt: Date.now(), endedAt: null, status: 'running', devices: serials.map(serial => ({ serial, state: 'waiting' })) };
}

// Device states: waiting (no discharge from full seen yet) · discharging · confirming
// (<5%, waiting out the silence) · done (counted cycle) · interrupted · nodata.
// Returns true when this call completed the run.
export async function evaluateRun(run) {
  if (run.status !== 'running') return false;
  const now = Date.now();
  await mapLimit(run.devices, 4, async x => {
    if (x.state === 'done') return;
    const key = `${run.id}:${x.serial}`; let rows = rowsMem.get(key) || [];
    const from = rows.length ? Date.parse(rows[rows.length - 1].timestamp) - 10 * MIN : run.startedAt - 60 * MIN; // 1h lead-in to catch the full reading
    const fresh = normalize(await fetchHistoryRange(x.serial, from, now, 300));
    rows = rows.filter(r => Date.parse(r.timestamp) < from).concat(fresh); rowsMem.set(key, rows);
    const res = detectCycles(rows, { nowMs: now, offlineMin: 30 });
    const last = rows[rows.length - 1];
    x.last = last ? { t: Date.parse(last.timestamp), pct: last.battery_pct, temp: last.extra.battery_temp_c ?? null } : null;
    const cycle = res.cycles.find(c => c.end > run.startedAt);
    const intr = [...res.interrupted].reverse().find(c => c.end > run.startedAt);
    x.intr = null;
    if (cycle) { x.state = 'done'; x.cycle = cycle; }
    else if (!last || x.last.t < run.startedAt - 30 * MIN) x.state = 'nodata'; // silent since before the run began
    else if (res.inProgress) x.state = last.battery_pct >= 95 ? 'waiting' : last.battery_pct < 5 ? 'confirming' : 'discharging';
    else if (intr) { x.state = 'interrupted'; x.intr = intr; }
    else x.state = 'waiting';
  });
  const active = run.devices.filter(x => ['discharging', 'confirming', 'done'].includes(x.state));
  if (active.length && active.every(x => x.state === 'done')) { run.status = 'complete'; run.endedAt = Math.max(...active.map(x => x.cycle.end)); return true; }
  return false;
}
