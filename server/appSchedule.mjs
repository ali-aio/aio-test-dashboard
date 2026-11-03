// Open / close Nugget on a schedule (the user, 3 Nov 2026: Today's Ads on screen card — "when: now, or at a time", and
// "keep this continuously, as tomorrow the cycle starts again"). Runs on the server, so it fires with every browser
// closed. A job is { id, action: 'open'|'close', at (ms, the next run), daily, serials, by, last }; a daily job moves on
// 24 h after each run, a one-off one is dropped once run. State in data/app-schedule.json (gitignored), so a restart
// keeps it; every command goes to data/commands.jsonl through `send` (by "schedule · <who>").
import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 3600e3;

export function createAppSchedule(root, { send, keep, log = () => {} }) {
  const file = path.join(root, 'data', 'app-schedule.json');
  let jobs = []; try { jobs = JSON.parse(fs.readFileSync(file, 'utf8')).jobs || []; } catch (e) {}
  let busy = false;
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify({ jobs })); fs.renameSync(file + '.tmp', file); } catch (e) { log(e.message); } };
  const run = async () => {
    if (busy) return;
    const due = jobs.find(j => Date.now() >= j.at);
    if (!due) return;
    busy = true;
    try {
      const serials = due.serials.filter(sn => keep({ serial_number: sn }));
      let ok = 0; const failed = [];
      // three at a time, like the buttons
      const queue = [...serials];
      await Promise.all([0, 1, 2].map(async () => {
        while (queue.length) {
          const sn = queue.shift();
          try {
            const { status, out } = await send(sn, due.action, `schedule · ${due.by || ''}`.trim());
            if (status >= 200 && status < 300 && out?.status !== 'failed' && out?.status !== 'expired') ok++;
            else failed.push(`${sn}: ${out?.error || out?.output || status}`);
          } catch (e) { failed.push(`${sn}: ${e.message}`); }
        }
      }));
      due.last = { at: Date.now(), ok, total: serials.length, failed };
      // a daily job: the same time the next day (skipping any days missed while the laptop was off)
      if (due.daily) { while (due.at <= Date.now()) due.at += DAY; }
      else jobs = jobs.filter(j => j !== due);
      save();
      log(`${due.action} on ${ok}/${serials.length}${failed.length ? ` (${failed.length} failed)` : ''}${due.daily ? ' · daily' : ''}`);
    } finally { busy = false; }
  };
  setInterval(() => { run().catch(e => { busy = false; log(e.message); }); }, 15e3).unref();
  return {
    get: () => ({ jobs }),
    add: ({ action, at, daily, serials, by }) => {
      const job = { id: `S-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, action, at, daily: !!daily, serials, by, made: Date.now(), last: null };
      jobs.push(job); save(); return { jobs };
    },
    remove: (id) => { jobs = jobs.filter(j => j.id !== id); save(); return { jobs }; },
  };
}
