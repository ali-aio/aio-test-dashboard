// The Cycle plan, shared by every browser: data/plan.json (gitignored, one per host).
// This is the dashboard's own file — nothing here talks to the MDM.
//
//   GET /api/plan?group=G   → { group, decls, rota, rev, at }   (rev 0 = never saved)
//   PUT /api/plan?group=G   ← { decls, rota, baseRev }          → { rev, at } | 409 { current }
//
// A PUT replaces that group's plan. baseRev is the rev the browser last saw; if someone
// else saved since, the PUT is refused with the current copy (409) and the browser merges
// and retries, so two people editing at once never silently drop each other's cycles.
// Writes go to a temp file and are renamed into place, so a crash can't leave half a file.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BODY = 1 << 20; // 1 MB — a year of cycles is a few tens of KB

export function createPlanStore(root) {
  const file = path.join(root, 'data', 'plan.json');
  let db = { groups: {} };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); if (!db || typeof db.groups !== 'object') db = { groups: {} }; }
  catch (e) { if (e.code !== 'ENOENT') console.error(`plan.json unreadable, starting empty: ${e.message}`); }

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  const get = group => {
    const g = db.groups[group];
    return g ? { group, decls: g.decls, rota: g.rota, rev: g.rev, at: g.at } : { group, decls: [], rota: {}, rev: 0, at: null };
  };
  const put = (group, body) => {
    const cur = get(group);
    if ((body.baseRev | 0) !== cur.rev) return { conflict: true, current: cur };
    const next = { decls: body.decls, rota: body.rota, rev: cur.rev + 1, at: Date.now() };
    db.groups[group] = next; save();
    return { rev: next.rev, at: next.at };
  };
  return { get, put };
}

/** Read and validate a PUT body: { decls: [...objects], rota: {}, baseRev: n }. */
export function readPlanBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('plan too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!b || !Array.isArray(b.decls) || !b.decls.every(d => d && typeof d === 'object' && typeof d.id === 'string' && typeof d.from === 'string'))
          throw new Error('decls must be a list of cycles');
        if (b.rota != null && (typeof b.rota !== 'object' || Array.isArray(b.rota))) throw new Error('rota must be an object');
        resolve({ decls: b.decls, rota: b.rota || {}, baseRev: Number.isInteger(b.baseRev) ? b.baseRev : 0 });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
