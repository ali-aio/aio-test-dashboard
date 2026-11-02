// The iPhones on the T7s' wireless pads, read over Wi-Fi (the user, 2 Nov 2026: "this device is put on
// 790 … so its charging value shows there"). The MDM has only the T7's battery; the iPhone's was typed
// in by hand on Today. Now the lab laptop reads it itself every POLL_MIN minutes with
// server/iphone-battery.py (pymobiledevice3, a venv on the laptop — not an npm dependency) and the
// iPhone on the pad card fills each hour from the reading nearest it. A typed value still wins.
//
// Setup per iPhone (once, by cable on the lab laptop): Trust, then
//   ~/.venv-ios/bin/pymobiledevice3 lockdown pair
//   ~/.venv-ios/bin/pymobiledevice3 lockdown wifi-connections on
// and add it to data/iphones.json (gitignored, read on every poll, so no restart is needed):
//   { "phones": { "<udid>": { "t7": "AT070AABU00790", "name": "iPhone 13 Pro Max" } } }
// After a restart the phone answers only once it has been unlocked with its passcode.
//
//   GET /api/iphones → { phones: [{ udid, t7, name, last, lastOk, error }], readings: { <t7>: [[t, pct, charging]] }, at }
// Readings live in data/iphone-readings.json (gitignored), kept READ_DAYS days, stamped with the T7
// the phone was on at the time, so moving a phone to another T7 doesn't rewrite its past.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const POLL_MIN = 5, KEEP_DAYS = 120, READ_DAYS = 14;

export function createIphones(root, { python = path.join(os.homedir(), '.venv-ios', 'bin', 'python'), log = () => {} } = {}) {
  const cfgFile = path.join(root, 'data', 'iphones.json');
  const file = path.join(root, 'data', 'iphone-readings.json');
  const script = path.join(root, 'server', 'iphone-battery.py');
  let db = { readings: {}, status: {} }; // readings: udid → [[t, pct, charging, t7]]; status: udid → { lastOk, lastTry, error }
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { if (e.code !== 'ENOENT') log(`iphone-readings.json unreadable, starting empty: ${e.message}`); }
  const phones = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')).phones || {}; } catch (e) { return {}; } };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  const enabled = fs.existsSync(python);

  let busy = false;
  function poll() {
    const list = phones(), udids = Object.keys(list);
    if (busy || !enabled || !udids.length) return;
    busy = true;
    execFile(python, ['-I', script, ...udids], { timeout: 90e3 }, (err, stdout, stderr) => {
      busy = false;
      const now = Date.now();
      let got = {};
      try { got = JSON.parse(stdout || '{}'); } catch (e) { log(`iphone read: bad output ${String(stdout).slice(0, 200)}`); }
      if (err && !Object.keys(got).length) log(`iphone read failed: ${err.message.split('\n')[0]}`);
      for (const u of udids) {
        const st = db.status[u] || (db.status[u] = {});
        st.lastTry = now;
        const r = got[u];
        if (r && Number.isFinite(r.pct)) {
          (db.readings[u] ||= []).push([now, r.pct, r.charging ? 1 : 0, list[u].t7 || null]);
          st.lastOk = now; st.error = null;
        } else st.error = 'not reachable (off AIO-Office Wi-Fi, or not unlocked since it restarted)';
      }
      const cut = now - KEEP_DAYS * 86400e3;
      for (const u of Object.keys(db.readings)) db.readings[u] = db.readings[u].filter(x => x[0] >= cut);
      try { save(); } catch (e) { log(`iphone-readings.json: ${e.message}`); }
    });
  }
  if (enabled) { setTimeout(poll, 5e3).unref(); setInterval(poll, POLL_MIN * 60e3).unref(); }
  else log(`iPhone reading off: no ${python} (see server/iphones.mjs)`);

  return {
    get() {
      const list = phones(), cut = Date.now() - READ_DAYS * 86400e3, readings = {};
      for (const [u, rows] of Object.entries(db.readings))
        for (const [t, pct, ch, t7] of rows) if (t >= cut && t7) (readings[t7] ||= []).push([t, pct, ch]);
      return {
        enabled,
        phones: Object.entries(list).map(([udid, p]) => {
          const rows = db.readings[udid] || [], last = rows[rows.length - 1];
          return { udid, t7: p.t7 || null, name: p.name || 'iPhone', last: last ? { at: last[0], pct: last[1], charging: !!last[2] } : null, ...(db.status[udid] || {}) };
        }),
        readings, at: Date.now(),
      };
    },
  };
}
