// AIO test dashboard backend. One Node process, no dependencies:
//   · serves the repo's static files — gzip for text, ETag + 304 so a reload of the 450 KB
//     cycles import costs one round-trip and no bytes
//   · sweeps the MDM every SWEEP_MIN minutes with the same cycle detector the browser
//     uses (shared/cycles.js) and writes the result to data/topup.json
//   · proxies the two read endpoints the pages need, with a short server-side cache and one
//     shared in-flight fetch, so N open browsers cost the MDM one request per TTL, not N:
//       GET /api/devices                              (20 s cache)
//       GET /api/history/:serial?start&end&interval_sec (60 s cache, 7-day max window)
//       GET /api/host-app?range=6h|24h|7d             (30 s cache) the host app on screen now
//   · GET  /api/status   → sweep state + client stats
//   · POST /api/sweep    → run a sweep now (the Settings "Check for new cycles" button)
//   · GET/PUT /api/plan  → the shared Cycle plan, data/plan.json (server/plan.mjs) — our own
//   · GET/POST /api/phone → iPhone battery typed in on Today, data/phone.json (server/phone.mjs) — our own
//   · GET /api/iphones   → the iPhones on the pads, read over Wi-Fi every 5 min (server/iphones.mjs) — our own
//   · GET|POST /api/iphones/report?phone=&pct= → an iPhone sending its own battery (a Shortcuts automation)
//   · GET /api/room, GET|POST /api/room/report → room temp / humidity from the lab's ESP32-S3 + SHT30 on this machine's USB
//     (server/roomSerial.mjs) or over Wi-Fi (server/room.mjs) — our own
//   · POST /api/app/:serial/open|close → open / close Nugget on a lab tablet (MDM testdata app routes), logged in data/commands.jsonl
//   · POST /api/wlc/:serial {enabled} → wireless charging on the pad on / off (MDM testdata wlc route), logged the same way
//     file, the one thing a browser can write; never anything on the MDM
//
// Every upstream call goes through server/mdm.mjs (3 in flight, 120 ms apart, coalesced).
// Browsers are rate-limited per IP on /api/* (RATE_PER_MIN, default 120) — 429 + Retry-After.
// Config: server/config.json (gitignored) or environment — see server/README.md.
// The MDM is only ever read (QA key, GET requests); nothing here can command a device.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { sweep, loadTopup } from './sweep.mjs';
import { createClient } from './mdm.mjs';
import { createPlanStore, readPlanBody } from './plan.mjs';
import { keepDevice } from '../src/lib/device.js';
import { createPhoneStore, readPhoneBody } from './phone.mjs';
import { createWlcToggler } from './wlcToggle.mjs';
import { createAppSchedule } from './appSchedule.mjs';
import { createWlcBattery } from './wlcBattery.mjs';
import { createDeviceNotes } from './deviceNotes.mjs';
import { createFwTests } from './fwTests.mjs';
import { createIphones } from './iphones.mjs';
import { createRoom } from './room.mjs';
import { createRoomSerial } from './roomSerial.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgFile = path.join(ROOT, 'server', 'config.json');
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error(`config.json: ${e.message}`); }
// MDM groups renamed since (30 Oct 2026: "Test Lab units" → "HW Testing"); browsers map it the same way (src/lib/data.js)
const GROUP_RENAMED = { 'Test Lab units': 'HW Testing' };
const renamed = g => GROUP_RENAMED[g] || g;
const CFG = {
  base: (process.env.MDM_BASE || fileCfg.base || 'https://mdm.dev.aioapp.com').replace(/\/$/, ''),
  key: process.env.MDM_API_KEY || fileCfg.apiKey || '',
  group: renamed(process.env.CYCLES_GROUP || fileCfg.group || 'Test Cycles'),
  port: +(process.env.PORT || fileCfg.port || 8090),
  t7Port: +(process.env.T7_PORT || fileCfg.t7Port || 8091),
  sweepMin: +(process.env.SWEEP_MIN || fileCfg.sweepMin || 30),
  ratePerMin: +(process.env.RATE_PER_MIN || fileCfg.ratePerMin || 120),
};
const DEVICES_TTL = 20e3, HISTORY_TTL = 60e3, HOSTAPP_TTL = 30e3, MAX_RANGE = 7 * 86400e3 + 60e3;
const mdm = createClient({ base: CFG.base, key: CFG.key, log: m => console.log(`[mdm] ${m}`) });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.md', '.txt']);

// the shared Cycle plan (server/plan.mjs); the sweep's auto plan writes into it too
const plan = createPlanStore(ROOT);
// the iPhone readings typed in on Today (server/phone.mjs)
const phone = createPhoneStore(ROOT);
const deviceNotes = createDeviceNotes(ROOT);
const fwTests = createFwTests(ROOT, { keep: keepDevice });
// WLC toggling on a timer (server/wlcToggle.mjs): every switch through the MDM, logged like a button press
const wlcToggler = createWlcToggler(ROOT, {
  keep: keepDevice,
  log: msg => console.log(`[wlc] ${msg}`),
  send: async (serial, enabled) => {
    const r = await mdm.command(`/api/v1/testdata/devices/${serial}/wlc`, { enabled });
    try { fs.appendFileSync(path.join(ROOT, 'data', 'commands.jsonl'), JSON.stringify({ at: Date.now(), serial, action: enabled ? 'wlc on' : 'wlc off', by: 'toggle timer', status: r.status, result: r.json }) + '\n'); } catch (e) {}
    return r;
  },
});
// Open / close Nugget on one lab tablet through the MDM, logged; used by the buttons and the schedule.
async function appCmd(serial, action, by = '', ip = '') {
  // Open always opens the lab's build, aio.app.nugget.uatv2 (the user, 2 Nov 2026: the host-app list sometimes named
  // plain aio.app.nugget, and "Open on all" opened that on some tablets, uatv2 on others). Close stops uatv2 and also
  // the Nugget the host-app list names for the device, if that is another one, so a tablet left on it can be closed.
  const LAB_PKG = 'aio.app.nugget.uatv2';
  let listed = null;
  if (action === 'close') { try { const ha = await mdm.get('/api/v1/testdata/host-app?range=6h', { ttlMs: HOSTAPP_TTL }); listed = (ha.devices || []).find(x => x.serial_number === serial)?.package || null; } catch (e) {} }
  const pkgs = [LAB_PKG, ...(listed && listed !== LAB_PKG && /^aio\.app\.nugget/.test(listed) ? [listed] : [])];
  const log = (pkg, r) => { try { fs.appendFileSync(path.join(ROOT, 'data', 'commands.jsonl'), JSON.stringify({ at: Date.now(), serial, action, package: pkg, by, ip, status: r.status, result: r.json }) + '\n'); } catch (e) {} };
  // open wakes the screen and clears the lock screen itself (MDM guide, 2 Nov 2026), so no separate "screen on" first
  const results = [];
  for (const pkg of pkgs) {
    let r;
    // the MDM sometimes answers 502 / 503 / 504 with no body in a burst (2 Nov 2026: 3 of 22 in one Open on all): try again twice
    for (let t = 0; t < 3; t++) {
      if (t) await new Promise(ok => setTimeout(ok, 2000 * t));
      try { r = await mdm.command(`/api/v1/testdata/devices/${serial}/app/${action}?wait=true`, { package: pkg }); }
      catch (e) { r = { status: 504, json: { error: `MDM did not answer (${e.message})` } }; }
      log(pkg, r);
      if (![502, 503, 504].includes(r.status)) break;
    }
    // 202 = the MDM's 20 s wait ran out while the tablet was still on it: follow the command until it is done (up to
    // 60 s more), so "running" / "queued" isn't read as done (4 Nov 2026: Close on all left 00232 / 00833 "running")
    for (let k = 0; r.status === 202 && r.json?.command_id && !r.json?.done && k < 20; k++) {
      await new Promise(ok => setTimeout(ok, 3000));
      try { const c = await mdm.get(`/api/v1/testdata/commands/${r.json.command_id}`); if (c?.done) { r = { status: 200, json: c }; log(pkg, r); } }
      catch (e) {}
    }
    if (r.status === 202 && !r.json?.done) r = { status: 202, json: { ...(r.json || {}), error: `still ${r.json?.status || 'running'} on the tablet after 80 s` } };
    results.push(r);
    if (r.status === 409) break; // offline: the second would answer the same
  }
  const ok = results.find(x => x.status === 200 && x.json?.done !== false && !['failed', 'expired'].includes(x.json?.status));
  const r = ok || results[0];
  const out = r.json || { error: `MDM answered ${r.status}` };
  // 409 = the tablet is offline (not queued): say so plainly
  if (r.status === 409 && !out.output) out.error = `${serial} is offline${out.last_seen_at ? ` (last seen ${out.last_seen_at})` : ''} — not sent`;
  return { status: r.status, out };
}
// Open / Close on all, run here rather than in the browser (4 Nov 2026: a restart of this server and a second click cut a
// browser-side run short — 10 devices never got the close). One run at a time; any browser sees its progress.
let appBulk = null; // { action, by, total, done, ok, failed: [], startedAt, endedAt, running }
async function runAppBulk(action, serials, by) {
  appBulk = { action, by, total: serials.length, done: 0, ok: 0, failed: [], startedAt: Date.now(), endedAt: null, running: true };
  const job = appBulk, queue = [...serials];
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const sn = queue.shift();
      try { const { status, out } = await appCmd(sn, action, by, 'all'); if (status === 200 && !['failed', 'expired'].includes(out?.status)) job.ok++; else job.failed.push(`${sn}: ${out?.error || out?.output || status}`); }
      catch (e) { job.failed.push(`${sn}: ${e.message}`); }
      job.done++;
    }
  }));
  job.running = false; job.endedAt = Date.now();
}
// Open / close on a schedule, once at a time or every day (server/appSchedule.mjs; the user, 3 Nov 2026)
const appSchedule = createAppSchedule(ROOT, {
  keep: keepDevice,
  log: msg => console.log(`[app-schedule] ${msg}`),
  send: async (serial, action, by) => {
    // WLC on / off at a time or every day too (the user, 3 Nov 2026), through the same MDM route as the ⚡ buttons
    if (action === 'wlc_on' || action === 'wlc_off') {
      const enabled = action === 'wlc_on';
      const r = await mdm.command(`/api/v1/testdata/devices/${serial}/wlc`, { enabled });
      try { fs.appendFileSync(path.join(ROOT, 'data', 'commands.jsonl'), JSON.stringify({ at: Date.now(), serial, action: enabled ? 'wlc on' : 'wlc off', by: by || 'schedule', ip: 'schedule', status: r.status, result: r.json }) + '\n'); } catch (e) {}
      return { status: r.status, out: r.json || { error: `MDM answered ${r.status}` } };
    }
    return appCmd(serial, action, by || 'schedule', 'schedule');
  },
});
// WLC on / off when a device's battery reaches a level (server/wlcBattery.mjs; the user, 3 Nov 2026)
const wlcBattery = createWlcBattery(ROOT, {
  keep: keepDevice,
  log: msg => console.log(`[wlc-battery] ${msg}`),
  devices: () => mdm.get('/api/v1/testdata/devices', { ttlMs: DEVICES_TTL }),
  send: async (serial, enabled, by) => {
    const r = await mdm.command(`/api/v1/testdata/devices/${serial}/wlc`, { enabled });
    try { fs.appendFileSync(path.join(ROOT, 'data', 'commands.jsonl'), JSON.stringify({ at: Date.now(), serial, action: enabled ? 'wlc on' : 'wlc off', by, ip: 'battery rule', status: r.status, result: r.json }) + '\n'); } catch (e) {}
    return r;
  },
});
// the iPhones' own battery, read over Wi-Fi by the lab laptop (server/iphones.mjs)
const iphones = createIphones(ROOT, { python: process.env.IOS_PYTHON || fileCfg.iosPython || undefined, log: m => console.log(`[iphone] ${m}`) });

// the room's temperature / humidity, sent by the lab's ESP32-S3 + SHT30 (server/room.mjs)
const room = createRoom(ROOT, { log: m => console.log(`[room] ${m}`) });
// …plugged into this machine's USB (server/roomSerial.mjs); "roomSerial": false in config.json turns it off
const roomCfg = process.env.ROOM_SERIAL ?? fileCfg.roomSerial;
const roomSerial = roomCfg === false || roomCfg === 'off' ? null
  : createRoomSerial(ROOT, room, { port: typeof roomCfg === 'string' ? roomCfg : null, log: m => console.log(`[room] ${m}`) });

// ── sweep state ───────────────────────────────────────────────────────────────
const state = { group: CFG.group, lastSweepAt: null, lastError: null, sweeping: false, devices: 0, cycles: 0, configured: !!CFG.key };
let running = null;
function runSweep(reason) {
  if (running) return running;
  if (!CFG.key) { state.lastError = 'No API key configured on the server (server/config.json or MDM_API_KEY).'; return Promise.resolve(); }
  state.sweeping = true;
  running = sweep({ ...CFG, root: ROOT, plan, get: url => mdm.get(url), log: msg => console.log(`[sweep] ${msg}`) })
    .then(r => { state.lastSweepAt = r.at; state.devices = r.devices; state.cycles = r.cycles; state.lastError = null; })
    .catch(e => { state.lastError = e.message; console.error(`[sweep] failed (${reason}): ${e.message}`); })
    .finally(() => { state.sweeping = false; running = null; });
  return running;
}
{ const t = loadTopup(ROOT, CFG.group); if (t) { state.lastSweepAt = t.at; state.devices = Object.keys(t.devices).length; state.cycles = Object.values(t.devices).reduce((a, d) => a + d.cycles.length, 0); } }
runSweep('startup');
setInterval(() => runSweep('timer'), CFG.sweepMin * 60e3).unref();

// ── per-client rate limit on /api/* (sliding one-minute window per IP) ────────
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = (hits.get(ip) || []).filter(t => now - t < 60e3);
  win.push(now); hits.set(ip, win);
  return win.length > CFG.ratePerMin ? Math.ceil((60e3 - (now - win[0])) / 1000) : 0;
}
setInterval(() => { const cut = Date.now() - 60e3; for (const [ip, w] of hits) if (!w.some(t => t > cut)) hits.delete(ip); }, 30e3).unref();

// ── http ──────────────────────────────────────────────────────────────────────
const wantsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');
function send(req, res, code, body, headers) {
  const h = { 'cache-control': 'no-store', vary: 'accept-encoding', ...headers };
  if (wantsGzip(req) && body.length > 1024) { body = zlib.gzipSync(body); h['content-encoding'] = 'gzip'; }
  h['content-length'] = body.length; res.writeHead(code, h); res.end(req.method === 'HEAD' ? undefined : body);
}
const json = (req, res, code, obj, headers = {}) => send(req, res, code, Buffer.from(JSON.stringify(obj)), { 'content-type': 'application/json; charset=utf-8', ...headers });
const RFC = s => { const t = Date.parse(s || ''); return isNaN(t) ? null : t; };

// gzip'd static files are kept in memory keyed by path+mtime — the repo is a few MB at most
const gz = new Map();
function serveStatic(req, res, rel, root = ROOT) {
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root + path.sep) || file.startsWith(path.join(ROOT, 'server') + path.sep) || rel.includes('/.')) { res.writeHead(404); return res.end('not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase(), etag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
    const h = { 'content-type': MIME[ext] || 'application/octet-stream', etag, 'last-modified': st.mtime.toUTCString(), 'cache-control': ext === '.json' ? 'no-cache' : 'no-cache, max-age=0', vary: 'accept-encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    if (TEXT.has(ext) && wantsGzip(req) && st.size > 1024) {
      const k = file + etag; let buf = gz.get(k);
      if (!buf) { buf = zlib.gzipSync(fs.readFileSync(file)); gz.set(k, buf); for (const old of gz.keys()) if (old.startsWith(file) && old !== k) gz.delete(old); }
      h['content-encoding'] = 'gzip'; h['content-length'] = buf.length; res.writeHead(200, h); return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    h['content-length'] = st.size; res.writeHead(200, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}


http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (p.startsWith('/api/')) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const retry = limited(ip); if (retry) return json(req, res, 429, { error: `rate limit: ${CFG.ratePerMin} requests per minute` }, { 'retry-after': String(retry) });
    try {
      if (p === '/api/status') return json(req, res, 200, { ...state, t7Port: CFG.t7Port, client: mdm.stats() });
      if (p === '/api/sweep') { if (req.method !== 'POST') return json(req, res, 405, { error: 'POST' }); await runSweep('manual'); return json(req, res, state.lastError ? 502 : 200, state); }
      if (p === '/api/plan') {
        const g = renamed(url.searchParams.get('group') || CFG.group).slice(0, 120);
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, plan.get(g));
        if (req.method !== 'PUT') return json(req, res, 405, { error: 'GET or PUT' });
        let body; try { body = await readPlanBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        const r = plan.put(g, body);
        return r.conflict ? json(req, res, 409, { error: 'the plan changed since you loaded it', current: r.current }) : json(req, res, 200, r);
      }
      if (p === '/api/iphones') return json(req, res, 200, iphones.get());
      // an iPhone sending its own battery (its Shortcuts automation; server/iphones.mjs)
      if (p === '/api/iphones/report') {
        let q = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') { try { q = { ...q, ...(await readPhoneBody(req)) }; } catch (e) { return json(req, res, 400, { error: 'body must be JSON' }); } }
        else if (req.method !== 'GET') return json(req, res, 405, { error: 'GET or POST' });
        const r = iphones.report(q);
        return json(req, res, r.ok ? 200 : r.code, r);
      }
      if (p === '/api/room') {
        const n = k => +url.searchParams.get(k) || 0;
        return json(req, res, 200, { ...room.get({ hours: n('hours') || 24, from: n('from') || null, to: n('to') || null, step: n('step') }), usb: roomSerial?.status() || null });
      }
      // the ESP32-S3 + SHT30 in the lab sending the room's reading (firmware/room-sensor/)
      if (p === '/api/room/report') {
        let q = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') { try { q = { ...q, ...(await readPhoneBody(req)) }; } catch (e) { return json(req, res, 400, { error: 'body must be JSON' }); } }
        else if (req.method !== 'GET') return json(req, res, 405, { error: 'GET or POST' });
        const r = room.report(q);
        return json(req, res, r.ok ? 200 : r.code, r);
      }
      if (p === '/api/fw-tests') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, fwTests.list());
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        const r = fwTests.post(body);
        return json(req, res, r.error ? 400 : 200, r);
      }
      if (p === '/api/device-notes') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, deviceNotes.list(url.searchParams.get('serial')));
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        const serial = String(body.serial || '');
        if (!keepDevice({ serial_number: serial })) return json(req, res, 403, { error: `${serial} is not a lab device` });
        const r = deviceNotes.post(serial, body);
        return json(req, res, r.error ? 400 : 200, r);
      }
      if (p === '/api/phone') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, phone.get());
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        return json(req, res, 200, phone.post(body));
      }
      // Open / close Nugget on a lab tablet (the user, 30 Oct 2026, Today's "Ads on screen" card). Lab devices only
      // (LAB_SERIALS), only open / close, Nugget uatv2 (see below); every command is logged.
      const am = p.match(/^\/api\/app\/([A-Za-z0-9]{6,32})\/(open|close)$/);
      if (am) {
        if (req.method !== 'POST') return json(req, res, 405, { error: 'POST' });
        if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
        const [, serial, action] = am;
        if (!keepDevice({ serial_number: serial })) return json(req, res, 403, { error: `${serial} is not a lab device` });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) {}
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        const { status, out } = await appCmd(serial, action, String(body.by || '').slice(0, 60), ip);
        return json(req, res, status, out);
      }
      // Open / Close on all (runAppBulk): GET the run, POST { action, serials, by } to start one (409 while one runs)
      if (p === '/api/app-bulk') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, appBulk || { running: false });
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        if (appBulk?.running) return json(req, res, 409, { ...appBulk, error: `a ${appBulk.action} on all is already running (${appBulk.done} / ${appBulk.total})` });
        const serials = (Array.isArray(body.serials) ? body.serials : []).filter(sn => typeof sn === 'string' && keepDevice({ serial_number: sn }));
        if (!serials.length) return json(req, res, 400, { error: 'no lab devices given' });
        if (!['open', 'close'].includes(body.action)) return json(req, res, 400, { error: 'action must be open or close' });
        if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
        runAppBulk(body.action, [...new Set(serials)], String(body.by || '').slice(0, 60)).catch(e => console.log(`[app-bulk] ${e.message}`));
        return json(req, res, 200, appBulk);
      }
      // Open / close on a schedule (server/appSchedule.mjs): GET the jobs, POST { action, at, daily, serials, by } to add one,
      // POST { remove: id } to drop one (the user, 3 Nov 2026)
      if (p === '/api/app-schedule') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, appSchedule.get());
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        if (body.remove) return json(req, res, 200, appSchedule.remove(String(body.remove)));
        const serials = (Array.isArray(body.serials) ? body.serials : []).filter(sn => typeof sn === 'string' && keepDevice({ serial_number: sn }));
        const at = +body.at;
        if (!serials.length) return json(req, res, 400, { error: 'no lab devices given' });
        if (!['open', 'close', 'wlc_on', 'wlc_off'].includes(body.action)) return json(req, res, 400, { error: 'action must be open, close, wlc_on or wlc_off' });
        if (!(Number.isFinite(at) && at > Date.now() - 60e3 && at - Date.now() < 48 * 3600e3)) return json(req, res, 400, { error: 'at must be within the next 48 h' });
        if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
        const durationMin = body.durationMin == null ? null : Math.round(+body.durationMin);
        if (durationMin != null && !(durationMin >= 1 && durationMin <= 1440)) return json(req, res, 400, { error: 'durationMin must be 1 – 1440' });
        return json(req, res, 200, appSchedule.add({ action: body.action, at, daily: body.daily === true, serials, by: String(body.by || '').slice(0, 60), durationMin }));
      }
      // WLC by battery level (server/wlcBattery.mjs): GET the rules, POST { pct, enabled, serials, by } / { remove: id }
      if (p === '/api/wlc-battery') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, wlcBattery.get());
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        if (body.remove) return json(req, res, 200, wlcBattery.remove(String(body.remove)));
        const serials = (Array.isArray(body.serials) ? body.serials : []).filter(sn => typeof sn === 'string' && keepDevice({ serial_number: sn }));
        const pct = Math.round(+body.pct);
        if (!serials.length) return json(req, res, 400, { error: 'no lab devices given' });
        if (!(pct >= 1 && pct <= 99)) return json(req, res, 400, { error: 'pct must be 1 – 99' });
        if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
        return json(req, res, 200, wlcBattery.add({ pct, enabled: body.enabled === true, serials, by: String(body.by || '').slice(0, 60) }));
      }
      // WLC toggling on a timer, run by this server (server/wlcToggle.mjs): GET the job, POST { serials, everyMin, first,
      // by } to start, POST { stop: true } to stop
      if (p === '/api/wlc-toggle') {
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, wlcToggler.get());
        if (req.method !== 'POST') return json(req, res, 405, { error: 'GET or POST' });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        if (body.stop) return json(req, res, 200, wlcToggler.stop(String(body.by || '').slice(0, 60)));
        const serials = (Array.isArray(body.serials) ? body.serials : []).filter(sn => typeof sn === 'string' && keepDevice({ serial_number: sn }));
        const hold = body.hold === true, everyMin = hold ? null : Math.round(+body.everyMin);
        const endAt = Number.isFinite(+body.endAt) && +body.endAt > Date.now() ? +body.endAt : null;
        if (!serials.length) return json(req, res, 400, { error: 'no lab devices given' });
        if (!hold && !(everyMin >= 1 && everyMin <= 24 * 60)) return json(req, res, 400, { error: 'everyMin must be 1 – 1440' });
        // hold (WLC on / off for a while, the user, 2 Nov 2026): needs an end time, at most 24 h ahead
        if (hold && !(endAt && endAt - Date.now() <= 24 * 3600e3 + 60e3)) return json(req, res, 400, { error: 'a hold needs an end time within 24 h' });
        if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
        return json(req, res, 200, wlcToggler.start({ serials, everyMin, first: !!body.first, by: String(body.by || '').slice(0, 60),
          endAt, endState: body.endState !== false, hold }));
      }
      // Wireless charging on a lab T7's pad on / off (the user, 2 Nov 2026, Today's "WLC · load placed" card): MDM
      // POST /devices/{serial}/wlc {enabled} answers at once {serial, enabled, connected}; lab devices only, logged.
      const wm = p.match(/^\/api\/wlc\/([A-Za-z0-9]{6,32})$/);
      if (wm) {
        if (req.method !== 'POST') return json(req, res, 405, { error: 'POST' });
        if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
        const serial = wm[1];
        if (!keepDevice({ serial_number: serial })) return json(req, res, 403, { error: `${serial} is not a lab device` });
        let body = {}; try { body = await readPhoneBody(req); } catch (e) {}
        if (typeof body.enabled !== 'boolean') return json(req, res, 400, { error: 'enabled must be true or false' });
        const r = await mdm.command(`/api/v1/testdata/devices/${serial}/wlc`, { enabled: body.enabled });
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
        try { fs.appendFileSync(path.join(ROOT, 'data', 'commands.jsonl'), JSON.stringify({ at: Date.now(), serial, action: body.enabled ? 'wlc on' : 'wlc off', by: String(body.by || '').slice(0, 60), ip, status: r.status, result: r.json }) + '\n'); } catch (e) {}
        const out = r.json || { error: `MDM answered ${r.status}` };
        if (r.status === 409 && !out.output) out.error = out.error || `${serial} has no charging pad, or is offline`;
        return json(req, res, r.status, out);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(req, res, 405, { error: 'GET' });
      if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
      if (p === '/api/devices') {
        // the lab's own device list (LAB_SERIALS in src/lib/device.js), not an MDM group: the groups keep changing
        return json(req, res, 200, (await mdm.get('/api/v1/testdata/devices', { ttlMs: DEVICES_TTL })).filter(keepDevice), { 'cache-control': `private, max-age=${DEVICES_TTL / 1000}` });
      }
      // which tablets have the host app (the ads) on screen now — Today and the bell
      if (p === '/api/host-app') {
        const r = ['6h', '24h', '7d'].includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '6h';
        return json(req, res, 200, await mdm.get(`/api/v1/testdata/host-app?range=${r}`, { ttlMs: HOSTAPP_TTL }), { 'cache-control': `private, max-age=${HOSTAPP_TTL / 1000}` });
      }
      const m = p.match(/^\/api\/history\/([A-Za-z0-9_-]{1,64})$/);
      if (m) {
        const end = RFC(url.searchParams.get('end')) ?? Date.now(), start = RFC(url.searchParams.get('start')) ?? end - 7 * 86400e3, iv = Math.max(60, Math.min(86400, +url.searchParams.get('interval_sec') || 300));
        if (end - start > MAX_RANGE || end < start) return json(req, res, 400, { error: 'window must be 0–7 days' });
        // bucket the window to the interval so two browsers asking "last 24 h" seconds apart hit the same cache entry
        const q = iv * 1000, s0 = Math.floor(start / q) * q, e0 = Math.ceil(end / q) * q;
        const u = `/api/v1/testdata/devices/${m[1]}/history?start=${new Date(s0).toISOString()}&end=${new Date(e0).toISOString()}&interval_sec=${iv}${url.searchParams.get('cycles') === 'true' ? '&cycles=true' : ''}`;
        return json(req, res, 200, await mdm.get(u, { ttlMs: HISTORY_TTL }), { 'cache-control': `private, max-age=${HISTORY_TTL / 1000}` });
      }
      return json(req, res, 404, { error: 'not found' });
    } catch (e) { return json(req, res, 502, { error: e.message }); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  // the React app is the dashboard at `/`; the old addresses (the v1 page, /dist/app.html) send
  // the browser there, which keeps the #/nx/… part of the link
  if (p === '/') return serveStatic(req, res, '/dist/app.html');
  if (p === '/index.html' || p === '/dist/' || p === '/dist/app.html') { res.writeHead(302, { location: '/' + url.search }); return res.end(); }
  serveStatic(req, res, decodeURIComponent(p));
}).listen(CFG.port, '0.0.0.0', () => console.log(`aio-test-dashboard on :${CFG.port} · group "${CFG.group}" · sweep every ${CFG.sweepMin} min · ${CFG.ratePerMin} req/min per client · key ${CFG.key ? 'set' : 'MISSING'}`));

// the old T7-Dashboard (the lab's CSV imports), a copy of its built dist/ in t7-dashboard/, on its own port:
// its bundle asks for /assets/… at the root, and its browser storage stays apart from this app's
const T7_ROOT = path.join(ROOT, 't7-dashboard');
http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, decodeURIComponent(new URL(req.url, 'http://x').pathname), T7_ROOT);
}).listen(CFG.t7Port, '0.0.0.0', () => console.log(`T7-Dashboard (old data) on :${CFG.t7Port}`));
