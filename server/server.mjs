// AIO test dashboard backend. One Node process, no dependencies:
//   · serves the repo's static files (what `python3 -m http.server` used to do)
//   · sweeps the MDM every SWEEP_MIN minutes with the same cycle detector the browser
//     uses (shared/cycles.js) and writes the result to data/topup.json, so every
//     browser sees the same cycles and nobody's machine has to do the detection
//   · GET  /api/status   → sweep state
//   · POST /api/sweep    → run a sweep now (the Settings "Check for new cycles" button)
//
// Config: server/config.json (gitignored) or environment — see server/README.md.
// The MDM is only ever read (QA key, GET requests); nothing here can command a device.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweep, loadTopup } from './sweep.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgFile = path.join(ROOT, 'server', 'config.json');
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error(`config.json: ${e.message}`); }
const CFG = {
  base: (process.env.MDM_BASE || fileCfg.base || 'https://mdm.dev.aioapp.com').replace(/\/$/, ''),
  key: process.env.MDM_API_KEY || fileCfg.apiKey || '',
  group: process.env.CYCLES_GROUP || fileCfg.group || 'Test Cycles',
  port: +(process.env.PORT || fileCfg.port || 8090),
  sweepMin: +(process.env.SWEEP_MIN || fileCfg.sweepMin || 30),
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

// ── sweep state ───────────────────────────────────────────────────────────────
const state = { group: CFG.group, lastSweepAt: null, lastError: null, sweeping: false, devices: 0, cycles: 0, configured: !!CFG.key };
let running = null;
function runSweep(reason) {
  if (running) return running;
  if (!CFG.key) { state.lastError = 'No API key configured on the server (server/config.json or MDM_API_KEY).'; return Promise.resolve(); }
  state.sweeping = true;
  running = sweep({ ...CFG, root: ROOT, log: msg => console.log(`[sweep] ${msg}`) })
    .then(r => { state.lastSweepAt = r.at; state.devices = r.devices; state.cycles = r.cycles; state.lastError = null; })
    .catch(e => { state.lastError = e.message; console.error(`[sweep] failed (${reason}): ${e.message}`); })
    .finally(() => { state.sweeping = false; running = null; });
  return running;
}
{ const t = loadTopup(ROOT, CFG.group); if (t) { state.lastSweepAt = t.at; state.devices = Object.keys(t.devices).length; state.cycles = Object.values(t.devices).reduce((a, d) => a + d.cycles.length, 0); } }
runSweep('startup');
setInterval(() => runSweep('timer'), CFG.sweepMin * 60e3).unref();

// ── http ──────────────────────────────────────────────────────────────────────
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') return json(res, 200, state);
  if (url.pathname === '/api/sweep') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
    await runSweep('manual');
    return json(res, state.lastError ? 502 : 200, state);
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET' });
  // static files — never outside ROOT, never the server config
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(path.join(ROOT, 'server') + path.sep) || rel.includes('/.')) { res.writeHead(404); return res.end('not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': st.size, 'cache-control': ext === '.json' ? 'no-store' : 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}).listen(CFG.port, '0.0.0.0', () => console.log(`aio-test-dashboard on :${CFG.port} · group "${CFG.group}" · sweep every ${CFG.sweepMin} min · key ${CFG.key ? 'set' : 'MISSING'}`));
