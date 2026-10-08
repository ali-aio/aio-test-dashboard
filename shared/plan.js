// Cycle calibration plans — the schedule the lab *intends* to run. The MDM knows nothing
// about it (it only reports what already happened), so, exactly like shared/runs.js and for
// the same reason — the API is read-only — a plan lives in this browser's localStorage, per
// group. It is NOT shared with teammates' browsers. Swapping this for a shared store means
// replacing loadPlans/savePlans only; nothing above them reads localStorage directly.
//
// A plan is { id, date: 'YYYY-MM-DD', time: 'HH:MM', name, serials, note }. Dates are local
// calendar days, never UTC — a calibration booked for the 9th is the 9th on the bench.
const KEY = g => `cyclePlan:v1:${g}`;

// ── local calendar-day helpers ────────────────────────────────────────────────
const p2 = n => String(n).padStart(2, '0');
export const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
export const todayKey = () => dayKey(Date.now());
// 'YYYY-MM-DD' + 'HH:MM' → ms. A plan with no time sits at the start of its day.
export function planMs(p) {
  const [y, m, d] = (p.date || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const [hh, mm] = (p.time || '').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}
const byWhen = (a, b) => planMs(a) - planMs(b);
const valid = p => p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date);

// ── storage ───────────────────────────────────────────────────────────────────
export function loadPlans(group) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(group)) || '[]');
    return (Array.isArray(raw) ? raw : []).filter(valid).sort(byWhen);
  } catch (e) { return []; }
}
export function savePlans(group, plans) {
  try { localStorage.setItem(KEY(group), JSON.stringify([...plans].filter(valid).sort(byWhen))); } catch (e) {}
}
export function newPlan(plans, { date, time = '', name = '', serials = [], note = '' }) {
  const n = plans.reduce((m, p) => Math.max(m, +String(p.id).slice(2) || 0), 0) + 1;
  return { id: 'P-' + String(n).padStart(3, '0'), date, time, name: name || 'Cycle calibration', serials, note };
}
export const plansOn = (plans, key) => plans.filter(p => p.date === key);

// ── month grid ────────────────────────────────────────────────────────────────
// Six weeks of cells covering `month` (0-11), Monday-first, so the calendar never
// reflows between months. Each cell: { key, date, dayNum, inMonth, isToday }.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1), lead = (first.getDay() + 6) % 7; // Mon = 0
  const tk = todayKey(), cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i), key = dayKey(d);
    cells.push({ key, date: d.getTime(), dayNum: d.getDate(), inMonth: d.getMonth() === month, isToday: key === tk });
  }
  return cells;
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
export const dayLabel = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
