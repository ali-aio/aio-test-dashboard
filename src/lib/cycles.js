// Battery-cycle detection from /testdata/devices/{serial}/history rows.
// Pure functions, no DOM, no fetch — used by live runs and by the one-off history import.
//
// Team definition of a cycle (a run-down test): the device starts FULL (>= fullPct),
// discharges, and ends when it DIES — its last reading is below `deadPct` and then it
// stops checking in (an offline gap of at least `offlineMin`, or no data since). The
// cycle's length is full → last check-in, i.e. the battery's real runtime.
//
// Real history also shows devices hitting 0–1% and being put straight back on charge
// (silent for only ~20–40 min, then reporting again from 0–2% and climbing). That is
// the same run-down, so it counts too; `endedBy` records which way it ended.
//
// A check-in gap above deadPct does NOT end a discharge if the device comes back at the
// same or lower charge and not charging — it kept running and only its Wi-Fi/reporting
// dropped (most "offline" gaps in real history are this). Those gaps are counted on the
// cycle (`gaps`, `gapMs`) so a reader knows part of it wasn't observed.
//
// The lab's everyday test is time-boxed, not run-to-dead: devices come off the charger
// around 10:30 and go back on around 00:30, at 15–25%. Those count too, as a `timed` cycle,
// when the discharge ran at least `minHours` before being recharged (0 turns this off).
// Every counted cycle carries `fullMs`, the projected runtime to empty
// (elapsed ÷ % drained × 100; for a run-down it is simply the elapsed time) — that is the
// number to compare across cycles, since a 14 h / 80% run and a 26 h / 98% run are the
// same battery.
//
// Anything else that starts from full is reported as an `interrupted` discharge, never
// counted: it went silent above deadPct and never came back discharging, or it was put
// back on charge too early. Dips shallower than `minDepth` points are noise (charger
// top-up flicker) and are dropped entirely.
export const DEFAULTS = { fullPct: 95, deadPct: 5, offlineMin: 30, minDepth: 10, minHours: 8 };
const H = 3600e3;
// Thresholds the user set in Settings (localStorage `cycleOpts`), over the defaults.
export function loadOpts() {
  let o = {}; try { o = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('cycleOpts')) || '{}') || {}; } catch (e) {}
  const r = { ...DEFAULTS }; for (const k of Object.keys(DEFAULTS)) if (typeof o[k] === 'number' && isFinite(o[k])) r[k] = o[k];
  return r;
}
export const projected = c => { const drain = c.startPct - c.endPct; return c.reason === 'died' || drain <= 0 ? c.durationMs : Math.round(c.durationMs / drain * 100); };

// History buckets carry the previous sample forward (`sample_at` older than the bucket's
// `timestamp`), which would hide the moment a device goes silent. Key rows by the real
// sample time, drop repeats and the `empty` gap placeholders, and keep only the fields
// the detectors read. Used by the browser and by server/sweep.mjs.
export function normalize(rows) {
  const out = []; let prev = '';
  for (const r of rows) {
    if (r.empty) continue;
    const t = r.sample_at || r.timestamp;
    if (t === prev) continue; prev = t;
    out.push({ timestamp: t, battery_pct: r.battery_pct, build_id: r.build_id, extra: { charging: r.extra?.charging, battery_temp_c: r.extra?.battery_temp_c, charger_type: r.extra?.charger_type, wlc_status: r.extra?.wlc_status } });
  }
  return out;
}

function parse(rows) {
  const pts = [];
  for (const r of rows) {
    if (r.empty) continue; // placeholder rows: battery_pct is a meaningless 0 (see CLAUDE.md)
    let extra = {};
    try { extra = typeof r.extra === 'string' ? JSON.parse(r.extra) : (r.extra || {}); } catch (e) {}
    const temp = extra.battery_temp_c ?? extra.battery_temp ?? null;
    pts.push({ t: new Date(r.timestamp).getTime(), v: r.battery_pct, temp: typeof temp === 'number' ? temp : null, charging: !!extra.charging });
  }
  return pts.sort((a, b) => a.t - b.t);
}

function summarize(pts, s, e, reason, endedBy, gapLimit) {
  const seg = pts.slice(s, e + 1);
  const temps = seg.map(p => p.temp).filter(x => x != null && x > 0);
  let gaps = 0, gapMs = 0;
  for (let i = 1; i < seg.length; i++) { const d = seg[i].t - seg[i - 1].t; if (d >= gapLimit) { gaps++; gapMs += d; } }
  const c = {
    start: pts[s].t, end: pts[e].t, durationMs: pts[e].t - pts[s].t,
    startPct: pts[s].v, endPct: pts[e].v, samples: seg.length,
    maxTemp: temps.length ? Math.max(...temps) : null,
    avgTemp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    gaps, gapMs,
    reason, // 'died' | 'timed' (both counted) | 'offline' | 'recharged' (interrupted)
    endedBy, // for 'died': 'shutdown' (went silent) | 'recharged' (plugged in at empty)
  };
  c.fullMs = projected(c);
  return c;
}
// Apply the thresholds to already-detected lists (the static import, the server's sweep),
// so changing `minHours` in Settings reclassifies history without refetching anything.
export function reclassify(cycles, interrupted, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, C = [], I = [];
  for (const x of [...cycles, ...interrupted]) {
    const c = { ...x }, depth = c.startPct - c.endPct;
    if (c.reason === 'died') { c.fullMs = projected(c); C.push(c); continue; }
    if ((c.reason === 'recharged' || c.reason === 'timed') && o.minHours > 0 && c.durationMs >= o.minHours * H && depth >= o.minDepth) { c.reason = 'timed'; c.fullMs = projected(c); C.push(c); continue; }
    if (c.reason === 'timed') c.reason = 'recharged';
    if (depth >= o.minDepth) I.push(c);
  }
  const byStart = (a, b) => a.start - b.start;
  return { cycles: C.sort(byStart), interrupted: I.sort(byStart) };
}

// rows: history rows for one device. nowMs: "now", to decide whether a device whose data
// simply stops has gone silent long enough to count as dead (defaults to Date.now()).
// Returns { cycles, interrupted, inProgress }.
export function detectCycles(rows, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = o.nowMs ?? Date.now();
  const gap = o.offlineMin * 60000;
  const pts = parse(rows);
  const cycles = [], interrupted = [];
  let start = -1; // index of the last full reading before the current discharge

  const close = (e, reason, endedBy) => {
    const c = summarize(pts, start, e, reason, endedBy, gap);
    if (reason === 'died') cycles.push(c);
    else if (reason === 'recharged' && o.minHours > 0 && c.durationMs >= o.minHours * H && c.startPct - c.endPct >= o.minDepth) { c.reason = 'timed'; c.fullMs = projected(c); cycles.push(c); }
    else if (c.startPct - c.endPct >= o.minDepth) interrupted.push(c);
    start = -1;
  };

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], next = pts[i + 1];
    if (start >= 0 && i > start && (p.charging || p.v > pts[i - 1].v + 2) && p.v < o.fullPct) {
      // back on charge: from empty it ran down fully (counts); otherwise it was cut short
      if (pts[i - 1].v < o.deadPct) close(i - 1, 'died', 'recharged'); else close(i - 1, 'recharged');
    }
    if (p.v >= o.fullPct) {
      // Anchor = first full reading off the charger. Keep sliding while it's still charging
      // or still climbing, so a cycle measures from the top, not from where it crossed 95%.
      if (start < 0 || p.charging || pts[start].charging || p.v > pts[start].v) start = i;
      continue;
    }
    if (start < 0) continue;
    const silentAfter = next ? next.t - p.t >= gap : now - p.t >= gap;
    if (!silentAfter) continue;
    if (p.v < o.deadPct) close(i, 'died', 'shutdown');
    else if (next && !next.charging && next.v <= p.v + 1) continue; // reporting gap, still discharging
    else close(i, 'offline');
  }
  const last = pts[pts.length - 1];
  const inProgress = start >= 0 && last
    ? { start: pts[start].t, startPct: pts[start].v, nowPct: last.v, lastSeen: last.t, elapsedMs: last.t - pts[start].t }
    : null;
  return { cycles, interrupted, inProgress };
}

// Runtime statistics are over the projected full runtime (`fullMs`), so timed runs and
// run-downs compare; `medianElapsedMs` is the raw elapsed median for display.
export const rt = c => c.fullMs ?? projected(c);
export function aggregate(cycleLists) {
  const all = cycleLists.flat();
  const d = all.map(rt).sort((a, b) => a - b), e = all.map(c => c.durationMs).sort((a, b) => a - b);
  const temps = all.map(c => c.maxTemp).filter(x => x != null);
  return {
    count: all.length,
    avgDurationMs: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
    medianDurationMs: d.length ? d[Math.floor(d.length / 2)] : 0,
    medianElapsedMs: e.length ? e[Math.floor(e.length / 2)] : 0,
    minDurationMs: d.length ? d[0] : 0,
    maxDurationMs: d.length ? d[d.length - 1] : 0,
    timed: all.filter(c => c.reason === 'timed').length,
    maxTemp: temps.length ? Math.max(...temps) : null,
  };
}

export const fmtDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
