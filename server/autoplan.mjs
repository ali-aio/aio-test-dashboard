// Auto Cycle plan: after each sweep, read which test each bench ran from the readings and write
// it into the shared plan (data/plan.json), marked `auto` (src/lib/autoPlan.js has the rules).
// Our own files only — nothing is written to the MDM.
//
// data/autoplan.json (gitignored) keeps every device's discharges since AUTO_FROM, so a sweep
// re-reads only the last 2 days (5-min spacing: enough to time the pad's 3 h), and what Auto has
// added or changed, so an entry a person deleted or edited is not put back.
import fs from 'node:fs';
import path from 'node:path';
import { runsFrom, benchesFrom, applyAuto, AUTO_FROM } from '../src/lib/autoPlan.js';

const DAY = 86400e3, CHUNK = 7 * DAY, IV = 300;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

export async function buildAutoPlan({ root, group, devices, get, plan, now = Date.now(), log = () => {} }) {
  if (!plan) return;
  const target = path.join(root, 'data', 'autoplan.json');
  let file = readJson(target);
  if (!file || file.group !== group) file = { v: 1, group, upto: null, runs: {}, made: [], applied: {} };
  const from = file.upto ? file.upto - 2 * DAY : AUTO_FROM;
  for (const d of devices) {
    const sn = d.serial_number, rows = [];
    try {
      for (let s = from; s < now; s += CHUNK)
        rows.push(...await get(`/api/v1/testdata/devices/${encodeURIComponent(sn)}/history?start=${new Date(s).toISOString()}&end=${new Date(Math.min(s + CHUNK, now)).toISOString()}&interval_sec=${IV}`));
    } catch (e) { log(`auto plan: ${sn}: ${e.message}`); continue; }
    // runs starting in the re-read span are re-detected; older ones are kept as they were
    file.runs[sn] = [...(file.runs[sn] || []).filter(r => r.start < from), ...runsFrom(rows, now).filter(r => r.start >= from)];
  }
  file.upto = now;

  const cur = plan.get(group);
  const { decls, state, changes } = applyAuto(cur.decls, benchesFrom(file.runs), { now, state: file });
  file.made = state.made; file.applied = state.applied;
  if (changes.length) {
    const r = plan.put(group, { decls, rota: cur.rota, baseRev: cur.rev });
    if (r.conflict) { log('auto plan: plan changed meanwhile, next sweep'); return; }
    log(`auto plan: ${changes.join(' · ')}`);
  }
  fs.writeFileSync(target + '.tmp', JSON.stringify(file)); fs.renameSync(target + '.tmp', target);
}
