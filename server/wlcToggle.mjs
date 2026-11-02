// WLC toggling on a timer (the user, 2 Nov 2026: Today's WLC card, "Toggle" → every 15 min / 30 min / 1 h / custom).
// Runs on the server, so it keeps going with every browser closed: at the start and then every `everyMin` minutes it
// switches wireless charging on the listed lab T7s to the next state (off, on, off, …) through the MDM's wlc route;
// with an end time it then leaves them all in the chosen state (on / off) and stops.
// State in data/wlc-toggle.json (gitignored), so a restart picks it up again; every switch goes to data/commands.jsonl.
import fs from 'node:fs';
import path from 'node:path';

export function createWlcToggler(root, { send, keep, log = () => {} }) {
  const file = path.join(root, 'data', 'wlc-toggle.json');
  let job = null; try { job = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let busy = false;
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(job)); fs.renameSync(file + '.tmp', file); } catch (e) { log(`wlc-toggle: ${e.message}`); } };
  const run = async () => {
    if (!job?.active || busy) return;
    // the end time (optional): leave every device in the chosen state and finish
    const ending = job.endAt && Date.now() >= job.endAt;
    if (!ending && Date.now() < job.nextAt) return;
    busy = true;
    const to = ending ? job.endState : job.next, serials = job.serials.filter(sn => keep({ serial_number: sn }));
    let ok = 0; const failed = [];
    for (const sn of serials) {
      try { const r = await send(sn, to); if (r.status >= 200 && r.status < 300) ok++; else failed.push(`${sn}: ${r.json?.error || r.status}`); }
      catch (e) { failed.push(`${sn}: ${e.message}`); }
    }
    job.last = { at: Date.now(), to, ok, failed };
    if (ending) { job.active = false; job.endedAt = Date.now(); save(); busy = false; log(`wlc-toggle: ended, WLC ${to ? 'on' : 'off'} on ${ok}/${serials.length}`); return; }
    job.next = !to;
    while (job.nextAt <= Date.now()) job.nextAt += job.everyMin * 60e3;
    job.switches = (job.switches || 0) + 1;
    save(); busy = false;
    log(`wlc-toggle: WLC ${to ? 'on' : 'off'} on ${ok}/${serials.length}${failed.length ? ` (${failed.length} failed)` : ''}`);
  };
  setInterval(() => { run().catch(e => { busy = false; log(`wlc-toggle: ${e.message}`); }); }, 10e3).unref();
  return {
    get: () => job || { active: false },
    // endAt (ms, optional) / endState (true = WLC on): when to stop, and the state every device is left in then
    start: ({ serials, everyMin, first, by, endAt = null, endState = true }) => {
      job = { active: true, serials, everyMin, next: first, nextAt: Date.now(), startedAt: Date.now(), by, switches: 0, last: null, endAt, endState };
      save(); run().catch(() => {}); return job;
    },
    stop: (by) => { if (job) { job.active = false; job.stoppedAt = Date.now(); job.stoppedBy = by; save(); } return job || { active: false }; },
  };
}
