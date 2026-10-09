// AIO test dashboard backend. One Node process, no dependencies:
//   · serves the repo's static files — gzip for text, ETag + 304 so a reload of the 450 KB
//     cycles import costs one round-trip and no bytes
//   · sweeps the MDM every SWEEP_MIN minutes with the same cycle detector the browser
//     uses (shared/cycles.js) and writes the result to data/topup.json
//   · proxies the two read endpoints the pages need, with a short server-side cache and one
//     shared in-flight fetch, so N open browsers cost the MDM one request per TTL, not N:
//       GET /api/devices                              (20 s cache)
//       GET /api/history/:serial?start&end&interval_sec (60 s cache, 7-day max window)
//   · GET  /api/status   → sweep state + client stats
//   · POST /api/sweep    → run a sweep now (the Settings "Check for new cycles" button)
//   · GET/PUT /api/plan  → the shared Cycle plan, data/plan.json (server/plan.mjs) — our own
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
  ratePerMin: +(process.env.RATE_PER_MIN || fileCfg.ratePerMin || 120),
};
const DEVICES_TTL = 20e3, HISTORY_TTL = 60e3, MAX_RANGE = 7 * 86400e3 + 60e3;
const mdm = createClient({ base: CFG.base, key: CFG.key, log: m => console.log(`[mdm] ${m}`) });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.md', '.txt']);

// ── sweep state ───────────────────────────────────────────────────────────────
const state = { group: CFG.group, lastSweepAt: null, lastError: null, sweeping: false, devices: 0, cycles: 0, configured: !!CFG.key };
let running = null;
function runSweep(reason) {
  if (running) return running;
  if (!CFG.key) { state.lastError = 'No API key configured on the server (server/config.json or MDM_API_KEY).'; return Promise.resolve(); }
  state.sweeping = true;
  running = sweep({ ...CFG, root: ROOT, get: url => mdm.get(url), log: msg => console.log(`[sweep] ${msg}`) })
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
function serveStatic(req, res, rel) {
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(path.join(ROOT, 'server') + path.sep) || rel.includes('/.')) { res.writeHead(404); return res.end('not found'); }
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

const plan = createPlanStore(ROOT);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (p.startsWith('/api/')) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const retry = limited(ip); if (retry) return json(req, res, 429, { error: `rate limit: ${CFG.ratePerMin} requests per minute` }, { 'retry-after': String(retry) });
    try {
      if (p === '/api/status') return json(req, res, 200, { ...state, client: mdm.stats() });
      if (p === '/api/sweep') { if (req.method !== 'POST') return json(req, res, 405, { error: 'POST' }); await runSweep('manual'); return json(req, res, state.lastError ? 502 : 200, state); }
      if (p === '/api/plan') {
        const g = (url.searchParams.get('group') || CFG.group).slice(0, 120);
        if (req.method === 'GET' || req.method === 'HEAD') return json(req, res, 200, plan.get(g));
        if (req.method !== 'PUT') return json(req, res, 405, { error: 'GET or PUT' });
        let body; try { body = await readPlanBody(req); } catch (e) { return json(req, res, 400, { error: e.message }); }
        const r = plan.put(g, body);
        return r.conflict ? json(req, res, 409, { error: 'the plan changed since you loaded it', current: r.current }) : json(req, res, 200, r);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(req, res, 405, { error: 'GET' });
      if (!CFG.key) return json(req, res, 503, { error: 'no API key configured on the server' });
      if (p === '/api/devices') {
        const g = url.searchParams.get('group') || CFG.group;
        return json(req, res, 200, await mdm.get(`/api/v1/testdata/devices?group=${encodeURIComponent(g)}`, { ttlMs: DEVICES_TTL }), { 'cache-control': `private, max-age=${DEVICES_TTL / 1000}` });
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
  serveStatic(req, res, decodeURIComponent(p));
}).listen(CFG.port, '0.0.0.0', () => console.log(`aio-test-dashboard on :${CFG.port} · group "${CFG.group}" · sweep every ${CFG.sweepMin} min · ${CFG.ratePerMin} req/min per client · key ${CFG.key ? 'set' : 'MISSING'}`));
