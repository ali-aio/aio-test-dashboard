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

// The lab's seven tests, in the fixed order the categorical palette is assigned in
// (--tt-1 … --tt-7 in app.css). Never reorder for display: colour follows the test, and
// the palette was validated on this adjacency. `expect` is what the telemetry should look
// like, which is how a device is judged conforming or drifting.
export const TEST_TYPES = [
  { id: 'charging',   code: 'CC', name: 'Charging Cycle',         expect: 'charge' },
  { id: 'wlc_phone',  code: 'WP', name: 'WLC on Phone',           expect: 'discharge' },
  { id: 'wlc_load',   code: 'WL', name: 'WLC on Load',            expect: 'discharge' },
  { id: 'disch_ads',  code: 'DA', name: 'Discharging on Ads',     expect: 'discharge' },
  { id: 'wlc_disch',  code: 'WD', name: 'WLC + Discharge on Ads', expect: 'discharge' },
  { id: 'burnin',     code: 'BI', name: 'Burn-in Test',           expect: 'discharge' },
  { id: 'restaurant', code: 'RC', name: 'Restaurant Case',        expect: 'discharge' },
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
  let endMs = timeOn(key, src && src.endTime, true);
  const overnight = endMs <= startMs;
  if (overnight) endMs += 86400e3;
  return { startMs, endMs, overnight };
}

// ── storage ───────────────────────────────────────────────────────────────────
const validDecl = d => d && typeof d.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.from) && testType(d.testType);
export function loadDecls(group) {
  try {
    const raw = JSON.parse(localStorage.getItem(DKEY(group)) || '[]');
    return (Array.isArray(raw) ? raw : []).filter(validDecl).map(d => ({ ...d, to: d.to || d.from })).sort((a, b) => a.from < b.from ? -1 : 1);
  } catch (e) { return []; }
}
export function saveDecls(group, decls) {
  try { localStorage.setItem(DKEY(group), JSON.stringify(decls.filter(validDecl))); } catch (e) {}
}
export function loadRota(group) {
  try { const r = JSON.parse(localStorage.getItem(RKEY(group)) || '{}'); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}
export function saveRota(group, rota) { try { localStorage.setItem(RKEY(group), JSON.stringify(rota)); } catch (e) {} }

export function newDecl(decls, d) {
  const n = decls.reduce((m, x) => Math.max(m, +String(x.id).slice(2) || 0), 0) + 1;
  return { id: 'D-' + String(n).padStart(3, '0'), at: Date.now(), repeat: 'none', ...d, to: d.to || d.from };
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
/** Yesterday's cycles that run past midnight into this day. */
export const carriedInto = (decls, key) => cyclesOn(decls, prevKey(key)).filter(c => c.overnight);
/** The cycle whose window holds time t — today's, or yesterday's still running overnight.
 *  Overlaps go to the most recently declared, so a correction beats the earlier booking. */
export function cycleAt(decls, t) {
  const key = dayKey(t);
  return [...carriedInto(decls, key), ...cyclesOn(decls, key)]
    .filter(c => t >= c.startMs && t <= c.endMs)
    .sort((a, b) => (a.decl.at || 0) - (b.decl.at || 0)).pop() || null;
}
/** Start and end times for the next cycle on a day: it starts where the last one ending on
 *  that day stops, and runs as long as that one did. */
export function nextCycleTimes(decls, key) {
  const dayStart = keyToDate(key).getTime(), dayEnd = dayStart + 86400e3;
  const ends = [...carriedInto(decls, key), ...cyclesOn(decls, key)].filter(c => c.endMs > dayStart && c.endMs < dayEnd);
  const last = ends.sort((a, b) => a.endMs - b.endMs).pop();
  if (!last) return { startTime: '07:00', endTime: '19:00' };
  const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  return { startTime: hhmm(last.endMs), endTime: hhmm(last.endMs + (last.endMs - last.startMs)) };
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
  unclassified: { glyph: '○', label: 'No test, no run' },
  none:         { glyph: '',  label: 'No run' },
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
  'Taken for a demo / customer', 'Taken for debugging', 'Hardware fault', 'Firmware update / reflash',
  'Battery or charger swap', 'Other',
];
export const removedFrom = (decl, t = Infinity) => (decl?.removed || []).filter(r => r.at <= t);
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
