// Notifications: a device of a running cycle behaving unlike the rest of its cycle.
//
// The devices of one cycle are set up alike, so one or two that differ from all the others
// are worth a look: still on charge while the rest run on battery, no load on the wireless
// pad while the rest have one, silent while the rest report, a battery far from the rest,
// running much hotter. Read from the live snapshot (every 30 s), so the bell works on every
// screen without the 7-day reading window.
//
// The log (what was raised, when, whether it was read) is per browser, in localStorage:
// "read" is one person's state, not the lab's.
import { cycleAt, benchDecls, activeSerials, testType, loadDecls } from './plan.js';
import { SPAN, SPAN_LABEL, stateCode } from './hostApp.js';
import { padLoad } from './pad.js';

const KEY = 'alertsLog';
const KEEP_MS = 3 * 86400e3, MAX = 80;
const MIN_DEVICES = 3;      // fewer than this and there is no "rest" to differ from
const BATTERY_GAP = 15;     // points from the cycle's median battery
const TEMP_GAP = 8, TEMP_FLOOR = 40; // °C above the median, and hot in its own right
// A fixed-time test (Restaurant Case, 14 h): a device back on charge more than this before the
// cycle's time is a short cycle — alarming whether one device does it or the whole bench (the
// lab, 21 Oct 2026). Same margin as adapt.js FULL_CYCLE_MARGIN_H; from 1 h in, so a device
// still being unplugged at the start is not one.
const SHORT_MARGIN_H = 0.5, SHORT_FROM_H = 1;
// A test that runs ads (TEST_TYPES ads: true): a device whose host app has not been on screen for
// this long is raised, one device or the whole bench (the lab, 26 Oct 2026). From the MDM's
// host-app list, so only devices on client 1.11.0+.
const ADS_OFF_MIN = 5;

/** How many may differ and still be "the odd ones": 1 or 2, or a fifth of a big cycle. */
export const oddLimit = n => Math.max(2, Math.floor(n * 0.2));

const extraOf = s => {
  const e = s?.extra;
  if (!e) return {};
  if (typeof e === 'string') { try { return JSON.parse(e) || {}; } catch (err) { return {}; } }
  return e;
};

// Two-state behaviours. `get` returns true / false, or null when the device does not report it.
export const FEATURES = [
  { kind: 'charging', get: s => (s.charging == null ? null : !!s.charging),
    say: v => (v ? 'on charge' : 'on battery') },
  { kind: 'wlc-load', get: s => padLoad(extraOf(s).wlc_status),
    say: v => (v ? 'load on the wireless pad' : 'no load on the wireless pad') },
  { kind: 'wlc-pad', get: s => { const v = extraOf(s).wlc_charging; return typeof v === 'boolean' ? v : null; },
    say: v => (v ? 'wireless pad on' : 'wireless pad off') },
];

// reporting = checked in within 15 min of `now` (like device.js, but at the time asked about)
const onlineAt = (d, now) => !!d.snap && now - Date.parse(d.snap.last_seen_at) < 15 * 60e3;

const median = xs => { const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Every device of the cycle running now that differs from the rest. */
export function findOddOnes(decls, DEV, now = Date.now(), hostApp = null) {
  const cyc = cycleAt(benchDecls(decls), now);
  if (!cyc || now < cyc.startMs) return null; // not started yet (cycleAt also returns one about to start)
  const serials = new Set(activeSerials(cyc.decl, DEV, now));
  const mine = DEV.filter(d => serials.has(d.serial) && d.snap);
  const live = mine.filter(d => onlineAt(d, now));
  const out = [], n = live.length;

  // short cycle: back on charge well before a fixed-time test's end, any number of devices
  const tt = testType(cyc.decl.testType), inH = (now - cyc.startMs) / 3600e3;
  const short = new Set();
  if (tt?.hours && inH >= SHORT_FROM_H && inH < tt.hours - SHORT_MARGIN_H) for (const d of live) {
    if (!d.snap.charging) continue;
    short.add(d.serial);
    const h = Math.floor(inH), m = Math.round((inH - h) * 60);
    out.push({ serial: d.serial, kind: 'short', title: `short cycle: on charge ${h}h ${m}m into the ${tt.hours} h cycle`,
      others: `a complete cycle runs at least ${tt.hours - SHORT_MARGIN_H} h` });
  }
  // ads stopped: the host app off screen for ADS_OFF_MIN in a test that runs ads (not once on charge)
  if (tt?.ads && hostApp && inH >= 0.25) for (const d of live) {
    const x = hostApp.get(d.serial);
    if (!x || d.snap.charging || short.has(d.serial)) continue;
    const code = stateCode(x), since = Date.parse(x.since);
    if (code === SPAN.on || code === SPAN.noReport || code === SPAN.offline || !(now - since >= ADS_OFF_MIN * 60e3)) continue;
    const t = new Date(since), hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    out.push({ serial: d.serial, kind: `ads:${code}`, title: `ads stopped: ${SPAN_LABEL[code].toLowerCase()} since ${hh}`,
      others: `${tt.name} runs ads the whole time` });
  }
  if (n < MIN_DEVICES) return { cyc, live: n, odd: out };

  for (const f of FEATURES) {
    const vals = live.map(d => ({ d, v: f.get(d.snap) })).filter(x => x.v != null);
    if (vals.length < MIN_DEVICES) continue;
    const yes = vals.filter(x => x.v), no = vals.filter(x => !x.v);
    const [few, most] = yes.length < no.length ? [yes, no] : [no, yes];
    if (!few.length || few.length > oddLimit(vals.length)) continue;
    for (const { d, v } of few) if (!(f.kind === 'charging' && short.has(d.serial))) out.push({ serial: d.serial, kind: `${f.kind}:${v ? 'on' : 'off'}`,
      title: f.say(v), others: `${f.say(!v)} (${most.length} of ${vals.length})` });
  }

  // silent while the rest report
  const silent = mine.filter(d => !onlineAt(d, now));
  if (silent.length && silent.length <= oddLimit(mine.length)) for (const d of silent) {
    const mins = Math.round((now - Date.parse(d.snap.last_seen_at)) / 60e3);
    out.push({ serial: d.serial, kind: 'silent', title: 'stopped reporting',
      others: `last seen ${mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago · ${n} of ${mine.length} still reporting` });
  }

  const pcts = live.map(d => d.snap.battery_pct).filter(v => typeof v === 'number');
  if (pcts.length >= MIN_DEVICES) {
    const med = median(pcts);
    const far = live.filter(d => typeof d.snap.battery_pct === 'number' && Math.abs(d.snap.battery_pct - med) >= BATTERY_GAP);
    if (far.length && far.length <= oddLimit(pcts.length)) for (const d of far) {
      const low = d.snap.battery_pct < med;
      out.push({ serial: d.serial, kind: `battery:${low ? 'low' : 'high'}`, title: `battery ${d.snap.battery_pct}% (${low ? 'well below' : 'well above'} the rest)`,
        others: `the rest around ${Math.round(med)}%` });
    }
  }

  const temps = live.map(d => d.snap.battery_temp_c).filter(v => typeof v === 'number' && v > 0);
  if (temps.length >= MIN_DEVICES) {
    const med = median(temps);
    const hot = live.filter(d => d.snap.battery_temp_c >= Math.max(TEMP_FLOOR, med + TEMP_GAP));
    if (hot.length && hot.length <= oddLimit(temps.length)) for (const d of hot)
      out.push({ serial: d.serial, kind: 'hot', title: `running hot, ${d.snap.battery_temp_c.toFixed(1)} °C`, others: `the rest around ${med.toFixed(1)} °C` });
  }
  return { cyc, live: n, odd: out };
}

/** Fold what is odd now into the log: new ones are added unread, ones that stopped are
 *  marked resolved. Only the current cycle's are kept: while a cycle runs, anything from an
 *  earlier cycle is dropped; with none running, today's stay until the day is over (a cycle
 *  that runs past midnight keeps its own until it ends). Pure — returns a new log. */
export function mergeAlerts(log, found, now = Date.now()) {
  const d = new Date(now), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const keepFrom = found ? found.cyc.startMs : today;
  const out = log.filter(a => a.title && now - a.at < KEEP_MS && a.cycleStart >= keepFrom).map(a => ({ ...a }));
  const cur = new Set();
  if (found && found.odd.length) {
    const test = testType(found.cyc.decl.testType)?.name || 'the cycle';
    for (const o of found.odd) {
      const id = `${found.cyc.decl.id}@${found.cyc.startMs}:${o.serial}:${o.kind}`;
      cur.add(id);
      const had = out.find(a => a.id === id);
      if (!had) out.push({ id, ...o, test, cycleStart: found.cyc.startMs, at: now, read: false });
      else { had.title = o.title; had.others = o.others; if (had.resolvedAt) { delete had.resolvedAt; had.read = false; } }
    }
  }
  for (const a of out) if (!cur.has(a.id) && !a.resolvedAt) a.resolvedAt = now;
  return out.sort((a, b) => b.at - a.at).slice(0, MAX);
}

export const loadAlerts = () => { try { return (JSON.parse(localStorage.getItem(KEY)) || []).filter(a => a.title); } catch (e) { return []; } };
export const saveAlerts = log => { try { localStorage.setItem(KEY, JSON.stringify(log)); } catch (e) { /* private window */ } };

/** One pass: read the plan, check the fleet, update and return the stored log. */
export function checkAlerts(group, DEV, now = Date.now(), hostApp = null) {
  const log = mergeAlerts(loadAlerts(), findOddOnes(loadDecls(group), DEV, now, hostApp), now);
  saveAlerts(log);
  return log;
}
