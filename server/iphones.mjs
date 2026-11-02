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
//   { "phones": { "<udid>": { "t7": "AT070AABU00790", "name": "iPhone 13 Pro Max", "ip": "<optional first address>" } } }
// (after the first read the phone's own last address is kept and tried first; Bonjour is the fallback)
// After a restart the phone answers only once it has been unlocked with its passcode.
//
// A locked iPhone puts its Wi-Fi to sleep and stops answering (2 Nov 2026: 00790's went off the network
// minutes after it locked), so each phone also SENDS its battery itself: a Shortcuts "Time of Day"
// automation per hour (runs while locked) calls
//   GET|POST /api/iphones/report?phone=<key>&pct=<Battery Level>[&charging=1]   (or a JSON body)
// <key> is the phone's "key" in data/iphones.json (iphone1, iphone2, …), so moving a phone to another T7
// means changing only that file, not its shortcuts.
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
    // each phone's last address goes along, tried before a Bonjour search (see iphone-battery.py)
    const args = udids.map(u => { const ip = db.status[u]?.ip || list[u].ip; return ip ? `${u}=${ip}` : u; });
    execFile(python, ['-I', script, ...args], { timeout: 150e3 }, (err, stdout, stderr) => {
      busy = false;
      const now = Date.now();
      let got = {};
      try { got = JSON.parse(stdout || '{}'); } catch (e) { log(`iphone read: bad output ${String(stdout).slice(0, 200)}`); }
      if (err && !Object.keys(got).length) log(`iphone read failed: ${err.message.split('\n')[0]}`);
      if (stderr) log(`iphone read: ${String(stderr).trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`);
      for (const u of udids) {
        const st = db.status[u] || (db.status[u] = {});
        st.lastTry = now;
        const r = got[u];
        if (r && Number.isFinite(r.pct)) {
          (db.readings[u] ||= []).push([now, r.pct, r.charging ? 1 : 0, list[u].t7 || null]);
          st.lastOk = now; st.error = null; st.ip = r.ip || st.ip;
        } else st.error = 'not reachable over Wi-Fi (locked and asleep, off AIO-Office, or not unlocked since it restarted)';
      }
      const cut = now - KEEP_DAYS * 86400e3;
      for (const u of Object.keys(db.readings)) db.readings[u] = db.readings[u].filter(x => x[0] >= cut);
      try { save(); } catch (e) { log(`iphone-readings.json: ${e.message}`); }
    });
  }
  if (enabled) { setTimeout(poll, 5e3).unref(); setInterval(poll, POLL_MIN * 60e3).unref(); }
  else log(`iPhone reading off: no ${python} (see server/iphones.mjs)`);

  // a reading sent by the phone itself (its Shortcuts automation)
  function report({ phone, pct, charging }) {
    const list = phones(), key = String(phone || '').trim().toLowerCase();
    const udid = Object.keys(list).find(u => String(list[u].key || '').toLowerCase() === key);
    if (!udid) return { ok: false, code: 404, error: `unknown phone "${key}" — add "key" to it in data/iphones.json` };
    const n = Math.round(+String(pct).replace('%', ''));
    if (!(n >= 0 && n <= 100) || String(pct).trim() === '') return { ok: false, code: 400, error: 'pct must be 0–100' };
    const now = Date.now(), ch = /^(1|true|yes|on)$/i.test(String(charging ?? '')) ? 1 : 0;
    (db.readings[udid] ||= []).push([now, n, ch, list[udid].t7 || null]);
    const st = db.status[udid] || (db.status[udid] = {});
    st.lastOk = now; st.lastSent = now; st.error = null;
    try { save(); } catch (e) { log(`iphone-readings.json: ${e.message}`); }
    return { ok: true, phone: key, t7: list[udid].t7 || null, pct: n, at: now };
  }

  return {
    report,
    get() {
      const list = phones(), cut = Date.now() - READ_DAYS * 86400e3, readings = {};
      for (const [u, rows] of Object.entries(db.readings))
        for (const [t, pct, ch, t7] of rows) if (t >= cut && t7) (readings[t7] ||= []).push([t, pct, ch]);
      return {
        enabled,
        phones: Object.entries(list).map(([udid, p]) => {
          const rows = db.readings[udid] || [], last = rows[rows.length - 1];
          return { udid, key: p.key || null, t7: p.t7 || null, name: p.name || 'iPhone', last: last ? { at: last[0], pct: last[1], charging: !!last[2] } : null, ...(db.status[udid] || {}) };
        }),
        readings, at: Date.now(),
      };
    },
  };
}
