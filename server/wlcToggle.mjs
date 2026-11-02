// WLC toggling on a timer (the user, 2 Nov 2026: Today's WLC card, "Toggle" → every 15 min / 30 min / 1 h / custom).
// Runs on the server, so it keeps going with every browser closed: at the start and then every `everyMin` minutes it
// switches wireless charging on the listed lab T7s to the next state (off, on, off, …) through the MDM's wlc route.
// State in data/wlc-toggle.json (gitignored), so a restart picks it up again; every switch goes to data/commands.jsonl.
import fs from 'node:fs';
import path from 'node:path';

export function createWlcToggler(root, { send, keep, log = () => {} }) {
  const file = path.join(root, 'data', 'wlc-toggle.json');
  let job = null; try { job = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  let busy = false;
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(job)); fs.renameSync(file + '.tmp', file); } catch (e) { log(`wlc-toggle: ${e.message}`); } };
  const run = async () => {
    if (!job?.active || busy || Date.now() < job.nextAt) return;
    busy = true;
    const to = job.next, serials = job.serials.filter(sn => keep({ serial_number: sn }));
    let ok = 0; const failed = [];
    for (const sn of serials) {
      try { const r = await send(sn, to); if (r.status >= 200 && r.status < 300) ok++; else failed.push(`${sn}: ${r.json?.error || r.status}`); }
      catch (e) { failed.push(`${sn}: ${e.message}`); }
    }
    job.last = { at: Date.now(), to, ok, failed };
    job.next = !to;
    while (job.nextAt <= Date.now()) job.nextAt += job.everyMin * 60e3;
    job.switches = (job.switches || 0) + 1;
    save(); busy = false;
    log(`wlc-toggle: WLC ${to ? 'on' : 'off'} on ${ok}/${serials.length}${failed.length ? ` (${failed.length} failed)` : ''}`);
  };
  setInterval(() => { run().catch(e => { busy = false; log(`wlc-toggle: ${e.message}`); }); }, 10e3).unref();
  return {
    get: () => job || { active: false },
    start: ({ serials, everyMin, first, by }) => {
      job = { active: true, serials, everyMin, next: first, nextAt: Date.now(), startedAt: Date.now(), by, switches: 0, last: null };
      save(); run().catch(() => {}); return job;
    },
    stop: (by) => { if (job) { job.active = false; job.stoppedAt = Date.now(); job.stoppedBy = by; save(); } return job || { active: false }; },
  };
}
