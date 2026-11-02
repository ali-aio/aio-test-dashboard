// Room temperature / humidity from the lab's ESP32-S3 + SHT30 (firmware/room-sensor/), sent to the lab
// laptop every minute. Our own data, nothing to do with the MDM.
//   POST|GET /api/room/report  { sensor, t, rh }  or  { sensor, readings: [{ t, rh, ago }] }  (src/lib/room.js parseReport)
//   GET      /api/room?hours=24 → { sensors: [{ id, rows: [[t, tempC, rh]] }], at }
// Kept in data/room.jsonl (gitignored), one line per reading, appended; trimmed to KEEP_DAYS on start.
import fs from 'node:fs';
import path from 'node:path';
import { parseReport, KEEP_DAYS } from '../src/lib/room.js';

export function createRoom(root, { log = () => {} } = {}) {
  const file = path.join(root, 'data', 'room.jsonl');
  const db = new Map(); // sensor → [[t, temp, rh]]
  const cut = Date.now() - KEEP_DAYS * 86400e3;
  let kept = 0, lines = 0;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue; lines++;
      try { const [s, t, c, rh] = JSON.parse(line); if (t >= cut) { (db.get(s) || db.set(s, []).get(s)).push([t, c, rh]); kept++; } } catch (e) {}
    }
    for (const rows of db.values()) rows.sort((a, b) => a[0] - b[0]);
    if (kept < lines) { // rewrite without the old lines
      const out = [...db].flatMap(([s, rows]) => rows.map(r => JSON.stringify([s, ...r]))).join('\n');
      fs.writeFileSync(file + '.tmp', out ? out + '\n' : ''); fs.renameSync(file + '.tmp', file);
    }
  } catch (e) { if (e.code !== 'ENOENT') log(`room.jsonl: ${e.message}`); }

  return {
    report(q) {
      const r = parseReport(q);
      if (r.error) return { ok: false, code: 400, error: r.error };
      const rows = db.get(r.sensor) || db.set(r.sensor, []).get(r.sensor);
      const last = rows[rows.length - 1]?.[0] ?? 0;
      const fresh = r.rows.filter(x => x[0] > last); // a batch resent after a lost answer isn't stored twice
      rows.push(...fresh);
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); if (fresh.length) fs.appendFileSync(file, fresh.map(x => JSON.stringify([r.sensor, ...x])).join('\n') + '\n'); }
      catch (e) { log(`room.jsonl: ${e.message}`); }
      const x = rows[rows.length - 1];
      return { ok: true, sensor: r.sensor, stored: fresh.length, t: x[1], rh: x[2], at: x[0] };
    },
    get(hours = 24) {
      const from = Date.now() - Math.max(1, Math.min(hours, 24 * 14)) * 3600e3;
      return { sensors: [...db].map(([id, rows]) => ({ id, rows: rows.filter(r => r[0] >= from) })), at: Date.now() };
    },
  };
}
