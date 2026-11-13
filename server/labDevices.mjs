// The lab's device list, changed from the Summary screen (the user, 13 Nov 2026: "remove 281 … or add a section in Summary to add a
// device, then show that device on Today from that day on"). BENCH_ORDER (src/lib/device.js) is the list as it was; this file holds
// every change since, so a device removed on a day is off Today from that day and its past cycles stay. data/lab-devices.json
// (gitignored, like the plan); the dashboard's own file — the MDM is only read, to check that an added serial exists.
//   GET  /api/lab-devices → { changes: [{ id, serial, action: 'add' | 'remove', at, by, note }] }, oldest first
//   POST /api/lab-devices ← { add: serial, by, note } | { remove: serial, by, note } → the same | { error }
import fs from 'node:fs';
import path from 'node:path';
import { setLabChanges, onBenchAt, EXCLUDED_SERIALS, fullSerial } from '../src/lib/device.js';

export function createLabDevices(root, { exists, note }) {
  const file = path.join(root, 'data', 'lab-devices.json');
  let changes = [];
  try { changes = JSON.parse(fs.readFileSync(file, 'utf8')).changes || []; }
  catch (e) { if (e.code !== 'ENOENT') { console.error(`lab-devices.json unreadable: ${e.message}`); throw e; } }
  setLabChanges(changes);
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ changes }, null, 1));
    fs.renameSync(file + '.tmp', file);
    setLabChanges(changes);
  };
  return {
    list: () => ({ changes }),
    post: async (b) => {
      const action = b.add ? 'add' : b.remove ? 'remove' : null;
      if (!action) return { error: 'add or remove a serial' };
      const serial = fullSerial(b.add || b.remove);
      if (!serial) return { error: 'not a serial' };
      if (EXCLUDED_SERIALS.has(serial)) return { error: `${serial} is left out of every cycle (00848 / 00854)` };
      const now = Date.now(), on = onBenchAt(serial, now);
      if (action === 'add' && on) return { error: `${serial} is already on the bench` };
      if (action === 'remove' && !on) return { error: `${serial} is not on the bench` };
      if (action === 'add' && !(await exists(serial))) return { error: `${serial} is not in the MDM's device list` };
      const by = String(b.by || '').slice(0, 60), text = String(b.note || '').trim().slice(0, 500);
      changes.push({ id: `L-${now.toString(36)}`, serial, action, at: now, by, note: text });
      save();
      const day = new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      note(serial, `${day}: ${action === 'add' ? 'added to' : 'removed from'} the lab's device list${by ? ` by ${by}` : ''}${text ? ` — ${text}` : ''}. ${action === 'add' ? 'Shown on Today from this day.' : 'Off Today from this day; its past cycles stay.'}`, by);
      return { changes };
    },
  };
}
