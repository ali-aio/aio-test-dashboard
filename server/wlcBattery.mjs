// WLC by battery level (the user, 3 Nov 2026: "when the device reaches a specific percentage, e.g. 15 %, disable WLC").
// A rule { id, pct, enabled (the state to set: false = WLC off), serials, by, made, armed: {serial: bool}, fired: {serial: {at, pct, status}} }
// is checked every minute against the MDM's device list: each device on battery at or below `pct` gets the switch once;
// it re-arms when its battery is back above pct + REARM (recharged), so the rule holds for every cycle until removed.
// Runs on the lab laptop; state in data/wlc-battery.json (gitignored); every switch goes to data/commands.jsonl via `send`.
import fs from 'node:fs';
import path from 'node:path';

const REARM = 10;

export function createWlcBattery(root, { devices, send, keep, log = () => {} }) {
  const file = path.join(root, 'data', 'wlc-battery.json');
  let rules = []; try { rules = JSON.parse(fs.readFileSync(file, 'utf8')).rules || []; } catch (e) {}
  let busy = false;
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify({ rules })); fs.renameSync(file + '.tmp', file); } catch (e) { log(e.message); } };
  const run = async () => {
    if (busy || !rules.length) return;
    busy = true;
    try {
      const rows = new Map((await devices()).map(d => [d.serial_number, d]));
      let changed = false;
      for (const rule of rules) {
        rule.armed ||= {}; rule.fired ||= {};
        for (const sn of rule.serials) {
          if (!keep({ serial_number: sn })) continue;
          const d = rows.get(sn), b = d?.battery_pct;
          if (d == null || b == null) continue;
          if (b > rule.pct + REARM && rule.armed[sn] === false) { rule.armed[sn] = true; changed = true; }
          if (rule.armed[sn] === false || d.charging || b > rule.pct) continue;
          const r = await send(sn, rule.enabled, `battery ≤ ${rule.pct}% · ${rule.by || ''}`.trim());
          rule.armed[sn] = false;
          rule.fired[sn] = { at: Date.now(), pct: b, status: r.status };
          changed = true;
          log(`${sn} at ${b}%: WLC ${rule.enabled ? 'on' : 'off'} → ${r.status}`);
        }
      }
      if (changed) save();
    } finally { busy = false; }
  };
  setInterval(() => { run().catch(e => { busy = false; log(e.message); }); }, 60e3).unref();
  return {
    get: () => ({ rules }),
    add: ({ pct, enabled, serials, by }) => {
      rules.push({ id: `B-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, pct, enabled: !!enabled, serials, by, made: Date.now(), armed: {}, fired: {} });
      save(); run().catch(() => {}); return { rules };
    },
    remove: (id) => { rules = rules.filter(r => r.id !== id); save(); return { rules }; },
  };
}
