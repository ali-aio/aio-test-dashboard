// Notifications: a device of a running cycle behaving unlike the rest of its cycle.
//
// Today the one case is "still on charge": the cycle has started (most of its reporting
// devices are off the charger) but one or two are still charging — left on the charger when
// the others were pulled, or put back on early. Read from the live snapshot (every 30 s), so
// the bell works on every screen without the 7-day reading window.
//
// The log (what was raised, when, whether it was read) is per browser, in localStorage:
// "read" is one person's state, not the lab's.
import { cycleAt, activeSerials, testType, loadDecls } from './plan.js';
import { online } from './device.js';

const KEY = 'alertsLog';
const KEEP_MS = 3 * 86400e3, MAX = 60;

/** The running cycle's devices that are still charging while most of it is on battery. */
export function chargingOddOnes(decls, DEV, now = Date.now()) {
  const cyc = cycleAt(decls, now);
  if (!cyc || now < cyc.startMs) return null; // not started yet (cycleAt also returns one about to start)
  const serials = new Set(activeSerials(cyc.decl, DEV, now));
  const live = DEV.filter(d => serials.has(d.serial) && online(d));
  const charging = live.filter(d => d.snap.charging), onBattery = live.length - charging.length;
  // started = more than half of the reporting devices off the charger
  if (!live.length || onBattery <= live.length / 2 || !charging.length) return { cyc, live: live.length, onBattery, odd: [] };
  return { cyc, live: live.length, onBattery, odd: charging.map(d => d.serial) };
}

/** Fold the current odd ones into the log: new ones are added unread, ones that stopped are
 *  marked resolved (and stay listed until read or old). Pure — returns a new log. */
export function mergeAlerts(log, found, now = Date.now()) {
  const out = log.filter(a => now - a.at < KEEP_MS).map(a => ({ ...a }));
  const cur = new Set();
  if (found && found.odd.length) {
    const tt = testType(found.cyc.decl.testType)?.name || 'the cycle';
    for (const serial of found.odd) {
      const id = `${found.cyc.decl.id}@${found.cyc.startMs}:${serial}:charging`;
      cur.add(id);
      const had = out.find(a => a.id === id);
      if (!had) out.push({ id, serial, kind: 'charging', test: tt, cycleStart: found.cyc.startMs, onBattery: found.onBattery, live: found.live, at: now, read: false });
      else { had.onBattery = found.onBattery; had.live = found.live; if (had.resolvedAt) { delete had.resolvedAt; had.read = false; } }
    }
  }
  for (const a of out) if (!cur.has(a.id) && !a.resolvedAt) a.resolvedAt = now;
  return out.sort((a, b) => b.at - a.at).slice(0, MAX);
}

export const loadAlerts = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
export const saveAlerts = log => { try { localStorage.setItem(KEY, JSON.stringify(log)); } catch (e) { /* private window */ } };

/** One pass: read the plan, check the fleet, update and return the stored log. */
export function checkAlerts(group, DEV, now = Date.now()) {
  const log = mergeAlerts(loadAlerts(), chargingOddOnes(loadDecls(group), DEV, now), now);
  saveAlerts(log);
  return log;
}
