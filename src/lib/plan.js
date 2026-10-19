// Cycle plan — the declared test-type schedule.
//
// This file is the answer to the one thing MDM telemetry cannot tell us: WHICH TEST a
// run was. The lab's CSV exports carried the test type in the filename; the MDM carries
// no equivalent, and there is no endpoint to add one (the API is read-only and out of
// scope — see CLAUDE.md). So instead of recovering the type after the fact, it is
// DECLARED up front: a date window, a device group and a test type. Every MDM row that
// lands inside that window is stamped with the declared type on the way in.
//
// Resolution order for a calendar day, first match wins:
//   1. an explicit declaration covering the date
//   2. the standing weekly rota entry for that weekday
//   3. inferred — telemetry shows a counted cycle but nothing claimed it
//   4. unclassified — nothing declared and nothing ran
//
// Stored in localStorage, per group, exactly like shared/runs.js: the MDM API is
// read-only, so declarations are per-browser until a shared store is agreed. Everything
// above goes through loadDecls/saveDecls and loadRota/saveRota, so moving them to the
// backend is a change to those four functions and nothing else.
const DKEY = g => `cyclePlan:decls:v1:${g}`;
const RKEY = g => `cyclePlan:rota:v1:${g}`;

// The lab's tests, in the fixed order the categorical palette is assigned in
// (--tt-1 … --tt-8 in t7.css). Never reorder for display: colour follows the test, and
// the palette was validated on this adjacency; a new test goes at the end. `expect` is what
// the telemetry should look like, which is how a device is judged conforming or drifting.
// `frequent`: the lab's everyday tests (Restaurant Case, WLC on Load, Ads only), listed first in
// the Cycle plan form.
// `about` is how the lab runs it (from the lab, Oct 2026) — shown in the Cycle plan form.
// "Load" = something placed on the T7's wireless pad, which the T7 charges.
// Plans store the id, never the name, so a rename (Discharging on Ads -> Ads only) keeps old plans.
export const TEST_TYPES = [
  { id: 'charging',   code: 'CC', name: 'Charging Cycle',         expect: 'charge',
    about: 'The T7 charges on its charger; measured: time to 50 / 80 / 95 / 100 %.' },
  { id: 'wlc_phone',  code: 'WP', name: 'WLC on Phone',           expect: 'discharge',
    about: 'A phone on the wireless pad; the result is how long the phone takes to charge fully, so it depends on the phone.' },
  { id: 'wlc_load',   code: 'WL', name: 'WLC on Load',            expect: 'discharge', frequent: true,
    about: 'A load on the wireless pad with ads running, until the T7 powers off (10 % to 0 %).' },
  { id: 'disch_ads',  code: 'DA', name: 'Ads only',               expect: 'discharge', frequent: true,
    about: 'Only ads, no load on the pad, until the T7 powers off (0 %).' },
  { id: 'wlc_disch',  code: 'WD', name: 'WLC + Discharge on Ads', expect: 'discharge',
    about: 'Ads running, a load on the pad for the first 3 h, then ads only until the T7 powers off (0 %).' },
  { id: 'burnin',     code: 'BI', name: 'Burn-in Test',           expect: 'discharge',
    about: 'Production only: 4K video played continuously (no ads).' },
  { id: 'restaurant', code: 'RC', name: 'Restaurant Case',        expect: 'discharge', frequent: true, hours: 14,
    about: 'A load on the pad for 3 h; the cycle runs 14 h in all.' },
  { id: 'load_only',  code: 'LO', name: 'Discharge on Load only', expect: 'discharge',
    about: 'Only a load on the wireless pad, no ads, until the T7 powers off (0 %).' },
];
export const testType = id => TEST_TYPES.find(t => t.id === id) || null;
export const ttSlot = id => Math.max(0, TEST_TYPES.findIndex(t => t.id === id)) + 1;

// ── local calendar-day helpers ────────────────────────────────────────────────
// Local days throughout, never UTC: a calibration booked for the 9th is the 9th on the bench.
const p2 = n => String(n).padStart(2, '0');
export const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
export const todayKey = () => dayKey(Date.now());
export const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dowIndex = k => (keyToDate(k).getDay() + 6) % 7; // Mon = 0
export const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
export const dayLabel = k => keyToDate(k).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
export const dayLong = k => keyToDate(k).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
// 'HH:MM' on a given day → ms. An empty time means the start / end of that day.
export function timeOn(key, hhmm, endOfDay = false) {
  const d = keyToDate(key);
  // Beware Number('') === 0: an unset time has to be detected on the string, not on the
  // parsed hour, or "no time given" silently becomes midnight and an open-ended window
  // collapses to zero length.
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return endOfDay ? d.getTime() + 86400e3 - 1 : d.getTime();
  d.setHours(+m[1], +m[2], 0, 0);
  return d.getTime();
}

// A plan's time window as real times. A run can start in the afternoon and finish after
// midnight (10:00 → 04:00), so an end at or before the start means the next day: the run
// still belongs to the day it started. Without times the window is the whole day.
export function windowOn(key, src) {
  const startMs = timeOn(key, src && src.startTime);
  // spanDays: how many days after its start day the cycle ends (set by the form's End date).
  // Older plans have none: an end at or before the start then means the next morning.
  const span = Number.isInteger(src?.spanDays) && src.spanDays >= 0 ? src.spanDays : null;
  let endMs = timeOn(span ? addDays(key, span) : key, src && src.endTime, true);
  if (endMs <= startMs) endMs += 86400e3;
  const overnight = dayKey(endMs - 1) !== key;
  return { startMs, endMs, overnight };
}
export const addDays = (key, n) => { const d = keyToDate(key); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
export const daysBetween = (a, b) => Math.round((keyToDate(b) - keyToDate(a)) / 86400e3);

// ── storage ───────────────────────────────────────────────────────────────────
const validDecl = d => d && typeof d.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.from) && testType(d.testType);
// Plans saved by the first form had From / To dates and one start and end time. In use,
// From..To meant one continuous cycle (Oct 10 07:00 -> Oct 11 03:00), not the same window
// repeated each day, so a plan without spanDays reads that way: the end date is To.
function fromOldForm(d) {
  const to = d.to || d.from;
  if (Number.isInteger(d.spanDays) || d.repeat === 'weekly' || to <= d.from) return { ...d, to };
  return { ...d, spanDays: daysBetween(d.from, to), to: d.from };
}
export function loadDecls(group) {
  try {
    const raw = JSON.parse(localStorage.getItem(DKEY(group)) || '[]');
    return (Array.isArray(raw) ? raw : []).filter(validDecl).map(fromOldForm).sort((a, b) => a.from < b.from ? -1 : 1);
  } catch (e) { return []; }
}
export function saveDecls(group, decls) {
  // stamp `mod` on what this save changed, so a merge with the shared copy keeps the newer of
  // each entry (the server's Auto plan updates entries too)
  const before = new Map(rawPlan(group).decls.map(d => [d.id, JSON.stringify({ ...d, mod: 0 })]));
  const now = Date.now();
  const out = decls.filter(validDecl).map(d => (before.get(d.id) === JSON.stringify({ ...d, mod: 0 }) ? d : { ...d, mod: now }));
  try { localStorage.setItem(DKEY(group), JSON.stringify(out)); } catch (e) {}
  planSink?.(group);
}
export function loadRota(group) {
  try { const r = JSON.parse(localStorage.getItem(RKEY(group)) || '{}'); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}
export function saveRota(group, rota) { try { localStorage.setItem(RKEY(group), JSON.stringify(rota)); } catch (e) {} planSink?.(group); }
// The browser copy above is a cache; planSync.js (when a backend is present) registers a
// sink here so every save also goes to the shared copy on the server, and writes what the
// server holds back into these keys. Raw strings, so nothing is reinterpreted on the way.
let planSink = null;
export const setPlanSink = fn => { planSink = fn; };
export const rawPlan = group => {
  let decls = [], rota = {};
  try { decls = JSON.parse(localStorage.getItem(DKEY(group)) || '[]'); } catch (e) {}
  try { rota = JSON.parse(localStorage.getItem(RKEY(group)) || '{}'); } catch (e) {}
  return { decls: Array.isArray(decls) ? decls : [], rota: rota && typeof rota === 'object' ? rota : {} };
};
export const writeRawPlan = (group, { decls, rota }) => {
  try { localStorage.setItem(DKEY(group), JSON.stringify(decls || [])); localStorage.setItem(RKEY(group), JSON.stringify(rota || {})); } catch (e) {}
};

// Ids must be unique across browsers now that the plan is shared, so not a per-browser
// counter (two browsers would both make "D-001"): time + random.
export function newDecl(decls, d) {
  let id; do { id = 'D-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); } while (decls.some(x => x.id === id));
  return { id, at: Date.now(), repeat: 'none', ...d, to: d.to || d.from };
}

// ── which days a declaration covers ───────────────────────────────────────────
export function declCovers(decl, key) {
  if (key < decl.from || key > (decl.to || decl.from)) return false;
  if (decl.repeat === 'weekly') return dowIndex(key) === dowIndex(decl.from);
  return true;
}
// The declaration that owns a day: the most recently declared one that covers it, so a
// later correction beats an earlier standing booking.
export const declOn = (decls, key) => decls.filter(d => declCovers(d, key)).sort((a, b) => (a.at || 0) - (b.at || 0)).pop() || null;

// ── several cycles on one day ─────────────────────────────────────────────────
// A day can hold more than one cycle: one that ran overnight from yesterday ends at 04:00
// and the next starts at 14:00. Each declaration is one cycle with its own window.
const prevKey = key => { const d = keyToDate(key); d.setDate(d.getDate() - 1); return dayKey(d.getTime()); };
/** Every cycle declared on a day, earliest start first, each with its real window. */
export function cyclesOn(decls, key) {
  return decls.filter(d => declCovers(d, key)).map(d => ({ decl: d, key, ...windowOn(key, d) }))
    .sort((a, b) => a.startMs - b.startMs || (a.decl.at || 0) - (b.decl.at || 0));
}
/** Earlier days' cycles still running into this day (overnight, or several days long). */
export function carriedInto(decls, key) {
  const dayStart = keyToDate(key).getTime(), out = [];
  for (let n = 1; n <= 7; n++) out.push(...cyclesOn(decls, addDays(key, -n)).filter(c => c.endMs > dayStart));
  return out.sort((a, b) => a.startMs - b.startMs);
}
/** The cycle whose window holds time t — today's, or yesterday's still running overnight —
 *  or, failing that, one starting up to EARLY_START_H later (a run started a bit early).
 *  Overlaps go to the most recently declared, so a correction beats the earlier booking. */
export const EARLY_START_H = 2; // devices are often taken off the charger a little before the planned start
export function cycleAt(decls, t) {
  const key = dayKey(t), latest = list => list.sort((a, b) => (a.decl.at || 0) - (b.decl.at || 0)).pop() || null;
  const all = [...carriedInto(decls, key), ...cyclesOn(decls, key)];
  // inside a cycle's window first; else a cycle starting within EARLY_START_H after t
  return latest(all.filter(c => t >= c.startMs && t <= c.endMs))
    || latest(all.filter(c => t < c.startMs && c.startMs - t <= EARLY_START_H * 3600e3));
}
/** Start and end times for the next cycle on a day: it starts where the last one ending on
 *  that day stops, and runs as long as that one did. */
export function nextCycleTimes(decls, key) {
  const dayStart = keyToDate(key).getTime(), dayEnd = dayStart + 86400e3;
  const ends = [...carriedInto(decls, key), ...cyclesOn(decls, key)].filter(c => c.endMs > dayStart && c.endMs < dayEnd);
  const last = ends.sort((a, b) => a.endMs - b.endMs).pop();
  if (!last) return { startTime: '07:00', endTime: '19:00', fromLast: false };
  const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  return { startTime: hhmm(last.endMs), endTime: hhmm(last.endMs + (last.endMs - last.startMs)), fromLast: true };
}

// ── resolving a day ───────────────────────────────────────────────────────────
// `ran` is a count of counted cycles that ended on the day (telemetry's own evidence).
// Status: declared (claimed, not yet past) · confirmed (claimed and telemetry agrees) ·
// inferred (telemetry only, nobody claimed it) · unclassified (nothing) · none (no run).
export function resolveDay(key, { decls, rota, ran = 0, devices = 0 }) {
  const past = key < todayKey();
  const cycles = cyclesOn(decls, key), d = cycles.length ? cycles[0].decl : null;
  if (d) return { key, testType: d.testType, decl: d, cycles, devices: d.devices || devices, source: 'declared', status: past ? (ran ? 'confirmed' : 'declared') : 'declared', ran };
  const r = rota[dowIndex(key)];
  if (r && testType(r.testType)) return { key, testType: r.testType, decl: null, rota: r, devices: r.devices || devices, source: 'rota', status: past ? (ran ? 'confirmed' : 'unclassified') : 'declared', ran };
  if (ran) return { key, testType: null, decl: null, devices, source: 'telemetry', status: 'inferred', ran };
  return { key, testType: null, decl: null, devices: 0, source: null, status: past ? 'unclassified' : 'none', ran: 0 };
}

export const STATUS = {
  declared:     { glyph: '◆', label: 'Planned' },
  confirmed:    { glyph: '●', label: 'Planned & ran' },
  inferred:     { glyph: '▨', label: 'Ran, no test set' },
  unclassified: { glyph: '○', label: 'No test, no cycle' },
  none:         { glyph: '',  label: 'No cycle' },
};

// ── device group on a declaration ─────────────────────────────────────────────
// { kind:'all' } · { kind:'group', name } (an MDM group) · { kind:'serials', serials }
export function groupSerials(g, DEV) {
  if (!g || g.kind === 'all') return DEV.map(d => d.serial);
  if (g.kind === 'group') return DEV.filter(d => (d.snap?.groups || []).includes(g.name)).map(d => d.serial);
  return (g.serials || []).filter(s => DEV.some(d => d.serial === s));
}
export const groupLabel = (g, DEV) => !g || g.kind === 'all' ? `All devices (${DEV.length})`
  : g.kind === 'group' ? `${g.name} (${groupSerials(g, DEV).length})` : `${(g.serials || []).length} selected`;

/** Pairs of cycles on a day (including one carried over from last night) whose windows
 *  overlap on at least one shared device. A run starting in the overlap goes to the more
 *  recently set cycle (cycleAt), so the plan should not leave it ambiguous. */
export function overlapsOn(decls, key, DEV, extra = null) {
  const list = [...carriedInto(decls, key), ...cyclesOn(decls, key)]
  if (extra) list.push({ decl: extra, key, ...windowOn(key, extra) })
  const out = []
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]
    if (a.decl.id && a.decl.id === b.decl.id) continue
    const from = Math.max(a.startMs, b.startMs), to = Math.min(a.endMs, b.endMs)
    if (from >= to) continue
    const sa = new Set(groupSerials(a.decl.group, DEV)), shared = groupSerials(b.decl.group, DEV).filter(x => sa.has(x))
    if (!shared.length && DEV.length) continue
    const later = (b.decl.at || Infinity) >= (a.decl.at || Infinity) ? b : a
    out.push({ a, b, from, to, shared: shared.length, winner: later })
  }
  return out
}

// ── devices taken out of a cycle ──────────────────────────────────────────────
// Someone borrows a device mid-cycle: it leaves the cycle from that moment, with a reason
// on record. Kept on the declaration ({ serial, at, reason, note, by }), so the plan
// remembers who left, when and why; "put back" removes the record.
export const TAKE_OUT_REASONS = [
  'Testing FW', 'Testing MDM', 'Taken for automation', 'Taken for debugging', 'Hardware fault',
  'Firmware update / reflash', 'Battery or charger swap', 'Other',
];
// Reasons typed before that are offered under a fixed name instead (a misspelling, a one-off
// version string), or not offered at all (null). The saved take-outs keep what was typed.
const REASON_ALIASES = {
  'testing v2.1.031': 'Testing FW', 'Taken for testing': 'Testing FW',
  'Taken for automatioion': 'Taken for automation', 'Taken for a demo / customer': null,
};
/** The reasons offered when taking a device out: the fixed ones, then every other reason typed
 *  under "Other" before (newest first), read from the shared plan so the whole lab gets them. */
export function takeOutReasons(decls) {
  const seen = new Set(TAKE_OUT_REASONS), own = [];
  const all = decls.flatMap(d => d.removed || []).sort((a, b) => b.at - a.at);
  for (const r of all) {
    let text = (r.reason === 'Other' ? r.note : r.reason || '').trim();
    if (text in REASON_ALIASES) text = REASON_ALIASES[text];
    if (text && !seen.has(text)) { seen.add(text); own.push(text); }
  }
  return [...TAKE_OUT_REASONS.slice(0, -1), ...own, 'Other'];
}
export const removedFrom = (decl, t = Infinity) => (decl?.removed || []).filter(r => r.at <= t);
/** Devices taken out of the planned cycle a run that started at `start` belongs to, oldest
 *  first — only those taken out while that cycle ran (a repeating plan keeps every day's). */
export function takenOutOf(decls, start) {
  const c = cycleAt(decls, start);
  if (!c) return [];
  return (c.decl.removed || []).filter(r => r.at >= Math.min(start, c.startMs) && r.at <= c.endMs).sort((a, b) => a.at - b.at);
}
/** "AT070AABU00387 taken out 02:49 PM — Other: testing v2.1.031 (Tariq)" */
export const takenOutText = r => {
  const d = new Date(r.at), t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${r.serial} taken out ${t} — ${r.reason || 'no reason given'}${r.note ? `: ${r.note}` : ''}${r.by ? ` (${r.by})` : ''}`;
};
/** The cycle's devices still in it at time t. */
export function activeSerials(decl, DEV, t = Date.now()) {
  const out = new Set(removedFrom(decl, t).map(r => r.serial));
  return groupSerials(decl?.group, DEV).filter(s => !out.has(s));
}
/** Was this run cut short by the device being taken out of its cycle? */
export const takenOutDuring = (decl, serial, end) => (decl?.removed || []).some(r => r.serial === serial && r.at < end);
export function takeOut(group, declId, rec) {
  const decls = loadDecls(group).map(d => d.id !== declId ? d
    : { ...d, removed: [...(d.removed || []).filter(r => r.serial !== rec.serial), { at: Date.now(), ...rec }] });
  saveDecls(group, decls); return decls;
}
export function putBack(group, declId, serial) {
  const decls = loadDecls(group).map(d => d.id !== declId ? d : { ...d, removed: (d.removed || []).filter(r => r.serial !== serial) });
  saveDecls(group, decls); return decls;
}

// ── month grid ────────────────────────────────────────────────────────────────
// Six weeks covering `month` (0-11), Monday-first, so the calendar never reflows.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1), lead = (first.getDay() + 6) % 7, tk = todayKey(), cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i), key = dayKey(d);
    cells.push({ key, date: d.getTime(), dayNum: d.getDate(), inMonth: d.getMonth() === month, isToday: key === tk });
  }
  return cells;
}
