// Open / close Nugget on a schedule (the user, 3 Nov 2026: Today's Ads on screen card — "when: now, or at a time", and
// "keep this continuously, as tomorrow the cycle starts again"). Runs on the server, so it fires with every browser
// closed. A job is { id, action: open|close|wlc_on|wlc_off, at (ms, the next run), daily, durationMin?, serials, by, last }; with
// durationMin it adds a one-off opposite job that long after it ran (`endOf` = its id); a daily job moves on
// 24 h after each run, a one-off one is dropped once run. State in data/app-schedule.json (gitignored), so a restart
// keeps it; every command goes to data/commands.jsonl through `send` (by "schedule · <who>").
import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 3600e3;
const OPPOSITE = { open: 'close', close: 'open', wlc_on: 'wlc_off', wlc_off: 'wlc_on' };

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
      // "for 3 h": the opposite on the same devices once the time is up (the user, 5 Nov 2026: "start at 10 for 3 hours, then off")
      if (due.durationMin > 0) jobs.push({ id: `${due.id}-end-${Date.now().toString(36)}`, action: OPPOSITE[due.action], at: Date.now() + due.durationMin * 60e3,
        daily: false, serials: due.serials, by: due.by, made: Date.now(), last: null, endOf: due.id, startedAt: Date.now() });
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
    add: ({ action, at, daily, serials, by, durationMin = null }) => {
      const job = { id: `S-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, action, at, daily: !!daily, serials, by, made: Date.now(), last: null, durationMin };
      jobs.push(job); save(); return { jobs };
    },
    // removing a job also drops the end it has waiting (removing only the end leaves the devices as they are)
    remove: (id) => { jobs = jobs.filter(j => j.id !== id && j.endOf !== id); save(); return { jobs }; },
  };
}
