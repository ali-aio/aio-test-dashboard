// Firmware tests (the user, 6 Nov 2026): devices · firmware · what part of it is tested · why · result. data/fw-tests.json
// (gitignored); the dashboard's own file, nothing here talks to the MDM. Removing only hides a test (`removed`).
//   GET  /api/fw-tests → { tests }, newest first
//   POST /api/fw-tests ← { add: fields } | { edit: id, ...fields } | { remove: id } → { tests } | { error }
import fs from 'node:fs';
import path from 'node:path';

const clean = (v, n = 2000) => String(v ?? '').trim().slice(0, n);

export function createFwTests(root, { keep }) {
  const file = path.join(root, 'data', 'fw-tests.json');
  let tests = [];
  try { tests = JSON.parse(fs.readFileSync(file, 'utf8')).tests || []; }
  catch (e) { if (e.code !== 'ENOENT') { console.error(`fw-tests.json unreadable: ${e.message}`); throw e; } } // never start empty over real records
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ tests }, null, 1));
    fs.renameSync(file + '.tmp', file);
  };
  const list = () => ({ tests: tests.filter(t => !t.removed).sort((a, b) => b.startedAt - a.startedAt) });
  // the fields a person sets; only those given change on an edit
  const fields = (b) => {
    const out = {};
    for (const k of ['name', 'firmware', 'tested', 'why', 'result']) if (b[k] !== undefined) out[k] = clean(b[k], k === 'name' ? 120 : 2000);
    if (b.by !== undefined) out.by = clean(b.by, 60);
    if (b.serials !== undefined) out.serials = (Array.isArray(b.serials) ? b.serials : []).filter(s => typeof s === 'string' && keep({ serial_number: s }));
    if (Number.isFinite(b.startedAt)) out.startedAt = b.startedAt;
    if (b.endedAt === null || Number.isFinite(b.endedAt)) out.endedAt = b.endedAt;
    return out;
  };
  return {
    list,
    post: (b) => {
      const now = Date.now();
      if (b.remove) {
        const t = tests.find(x => x.id === b.remove); if (!t) return { error: 'no such test' };
        t.removed = now;
      } else if (b.edit) {
        const t = tests.find(x => x.id === b.edit); if (!t) return { error: 'no such test' };
        const f = fields(b);
        if (f.name === '' || (f.serials && !f.serials.length)) return { error: 'a test needs a name and devices' };
        Object.assign(t, f, { mod: now });
      } else {
        const f = fields(b.add || {});
        if (!f.name || !f.serials?.length) return { error: 'a test needs a name and devices' };
        tests.push({ id: `F-${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, firmware: '', tested: '', why: '', result: '', by: '', startedAt: now, endedAt: null, ...f, mod: now });
      }
      save();
      return list();
    },
  };
}
