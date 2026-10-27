// The iPhone readings the lab types in on Today: an iPhone on a T7's wireless pad (in place of
// the usual load) and its battery % each hour of the cycle. The MDM reports only the T7's own
// battery, so this is the only record of the phone's. data/phone.json (gitignored, one per host);
// the dashboard's own file — nothing here talks to the MDM.
//
//   GET  /api/phone         → { devices, cells, at }
//   POST /api/phone         ← { devices?, cells? }  → the same, merged
//
// devices: "<cycle day>|<serial>" → { on, by, mod }        (which T7s carry an iPhone that cycle)
// cells:   "<cycle day>|<serial>|<hour>" → { pct, by, mod } (pct null = cleared)
// Each entry is merged on its own and the newer `mod` wins (mergePhone in src/lib/phoneLog.js),
// so two people typing into different cells never overwrite each other.
import fs from 'node:fs';
import path from 'node:path';
import { mergePhone, cleanPhone } from '../src/lib/phoneLog.js';

const MAX_BODY = 256 << 10;

export function createPhoneStore(root) {
  const file = path.join(root, 'data', 'phone.json');
  let db = { devices: {}, cells: {}, at: null };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { if (e.code !== 'ENOENT') console.error(`phone.json unreadable, starting empty: ${e.message}`); }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  return {
    get: () => db,
    post: body => { db = { ...mergePhone(db, cleanPhone(body)), at: Date.now() }; save(); return db; },
  };
}

export function readPhoneBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
