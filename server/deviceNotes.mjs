// Notes kept on a device for good (the user, 6 Nov 2026: "after a week or month or year, if someone wants to see what happened
// to those devices today, they see these notes"). data/device-notes.json (gitignored, like the plan); the dashboard's own file —
// nothing here talks to the MDM. Removing only hides a note (`removed`), so a slip of the hand can be undone from the file.
//   GET  /api/device-notes?serial=S → { notes: [{ id, serial, at, text, by, mod }] }, newest first
//   POST /api/device-notes          ← { serial, text, by } | { serial, edit: id, text } | { serial, remove: id }
import fs from 'node:fs';
import path from 'node:path';

const MAX_TEXT = 4000;

export function createDeviceNotes(root) {
  const file = path.join(root, 'data', 'device-notes.json');
  let notes = [];
  try { notes = JSON.parse(fs.readFileSync(file, 'utf8')).notes || []; }
  catch (e) { if (e.code !== 'ENOENT') { console.error(`device-notes.json unreadable: ${e.message}`); throw e; } } // never start empty over real notes
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ notes }, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const list = serial => ({ notes: notes.filter(n => n.serial === serial && !n.removed).sort((a, b) => b.at - a.at) });
  return {
    list,
    // a device event logged on the Summary screen (src/lib/events.js) is a note with `event` { type, severity, at, note, group };
    // one event naming several devices is one note per device sharing `group` (the user, 16 Nov 2026: an event logged on Summary
    // showed nowhere — it lived in that browser only)
    events: () => ({ notes: notes.filter(n => n.event && !n.removed).sort((a, b) => b.event.at - a.event.at) }),
    removeEvent: group => { const now = Date.now(); let n = 0; for (const x of notes) if (x.event?.group === group && !x.removed) { x.removed = now; n++; } if (n) save(); return n ? { ok: true } : { error: 'no such event' }; },
    post: (serial, { text, by, edit, remove, event }) => {
      const now = Date.now();
      if (remove || edit) {
        const n = notes.find(x => x.id === (remove || edit) && x.serial === serial);
        if (!n) return { error: 'no such note' };
        if (remove) n.removed = now;
        else {
          const t = String(text || '').trim().slice(0, MAX_TEXT);
          if (!t) return { error: 'a note needs text' };
          n.text = t; n.mod = now;
        }
      } else {
        const t = String(text || '').trim().slice(0, MAX_TEXT);
        if (!t) return { error: 'a note needs text' };
        const ev = event && typeof event === 'object' ? { type: String(event.type || 'Other').slice(0, 40), severity: String(event.severity || 'minor').slice(0, 20),
          at: Number.isFinite(+event.at) ? +event.at : now, note: String(event.note || '').slice(0, MAX_TEXT), group: String(event.group || '').slice(0, 80) } : undefined;
        notes.push({ id: `N-${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, serial, at: now, text: t, by: String(by || '').slice(0, 60), mod: now, ...(ev ? { event: ev } : {}) });
      }
      save();
      return list(serial);
    },
  };
}
