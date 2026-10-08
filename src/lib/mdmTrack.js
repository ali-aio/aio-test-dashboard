// The MDM's lifetime discharge counter, recorded over time.
//
// /testdata/devices reports discharge_total_pct — every percentage point a device has
// ever drained — but only as of now, and /history does not carry it at all. So a cycle
// count for one test, day or firmware cannot come from the MDM directly. The backend
// sweep therefore records the counter every 30 min (data/lifetime.json); a run's MDM
// cycles are then the counter at its end minus the counter at its start, ÷ 100. That
// only works for runs inside the recorded span — earlier runs return null and the UI
// shows a run count for them instead of guessing.
//
// File shape: { group, from, at, devices: { serial: [[tMs, pct], ...] } } (sorted by t).
// Plain JS, no DOM: used by server/sweep.mjs to write and by the browser to read.

const DAY = 864e5;

/** Append one reading per device. A value unchanged across three readings keeps only
 *  the first and the latest (its time moves forward), so long idle stretches cost two
 *  points, not one per sweep, and interpolation across them stays exact. */
export function appendReadings(file, group, devices, now, { keepDays = 180 } = {}) {
  const f = file && file.group === group ? file : { group, from: now, devices: {} };
  for (const d of devices) {
    const pct = d.discharge_total_pct;
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
    const rs = f.devices[d.serial_number] || (f.devices[d.serial_number] = []);
    const n = rs.length;
    if (n >= 2 && rs[n - 1][1] === pct && rs[n - 2][1] === pct) rs[n - 1][0] = now;
    else if (!n || rs[n - 1][0] < now) rs.push([now, pct]);
  }
  const cut = now - keepDays * DAY;
  for (const sn of Object.keys(f.devices)) f.devices[sn] = f.devices[sn].filter(r => r[0] >= cut);
  f.at = now;
  return f;
}

/** Counter value at time t, interpolated between readings; null outside the recorded span. */
export function counterAt(rs, t) {
  if (!rs || !rs.length || t < rs[0][0] || t > rs[rs.length - 1][0]) return null;
  let i = 1; while (i < rs.length && rs[i][0] < t) i++;
  if (i >= rs.length) return rs[rs.length - 1][1];
  const [t0, v0] = rs[i - 1], [t1, v1] = rs[i];
  return t1 === t0 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
}

/** The MDM's battery cycles between two times for one device, or null if not recorded. */
export function mdmCyclesFor(readings, serial, start, end) {
  const rs = readings?.devices?.[serial];
  const a = counterAt(rs, start), b = counterAt(rs, end);
  return a == null || b == null ? null : Math.max(0, (b - a) / 100);
}
