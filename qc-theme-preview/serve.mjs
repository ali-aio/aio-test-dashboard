// Preview the dashboard in the QC Center look without changing it.
// Adds qc-theme.css to the real app's pages. Every screen, number and filter is the real
// app's; only the styling differs.
//
//   node qc-theme-preview/serve.mjs              live: the lab laptop's dashboard, proxied
//   node qc-theme-preview/serve.mjs --snapshot   offline: this repo's dist/ + the saved data
//                                                 in qc-theme-preview/snapshot (21 Oct 2026)
//   then open http://localhost:8199/
//   Overrides: UPSTREAM=http://host:8090  PORT=8199
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.dirname(HERE);
const SNAP = path.join(HERE, 'snapshot');
const SNAPSHOT = process.argv.includes('--snapshot');
const UPSTREAM = new URL(process.env.UPSTREAM || 'http://100.120.184.6:8090');
const PORT = +(process.env.PORT || 8199);
const TAG = '<link rel="stylesheet" href="/__qc-theme.css">';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2' };

const inject = html => html.replace('</head>', `${TAG}</head>`);
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const file = (res, p) => fs.existsSync(p) && fs.statSync(p).isFile()
  ? send(res, 200, p.endsWith('.html') ? inject(fs.readFileSync(p, 'utf8')) : fs.readFileSync(p), TYPES[path.extname(p)] || 'application/octet-stream')
  : send(res, 404, 'not found', 'text/plain');

function snapshot(req, res) {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (p === '/api/status') return file(res, path.join(SNAP, 'status.json'));
  if (p === '/api/devices') return file(res, path.join(SNAP, 'devices.json'));
  if (p.startsWith('/api/history/')) {
    const f = path.join(SNAP, 'history', path.basename(p) + '.json');
    return fs.existsSync(f) ? file(res, f) : send(res, 200, '[]');
  }
  if (p === '/api/plan') { // read-only here: a save answers OK and is dropped
    if (req.method !== 'GET') { req.resume(); return file(res, path.join(SNAP, 'plan.json')); }
    return file(res, path.join(SNAP, 'plan.json'));
  }
  if (p.startsWith('/api/')) { req.resume(); return send(res, 200, '{}'); }
  if (p.startsWith('/data/')) {
    const f = path.join(SNAP, 'data', path.basename(p));
    return fs.existsSync(f) ? file(res, f) : file(res, path.join(REPO, p));
  }
  if (p === '/' || p === '/index.html' || p === '/dist/' || p === '/dist/app.html') return file(res, path.join(REPO, 'dist', 'app.html'));
  const f = path.normalize(path.join(REPO, p));
  return f.startsWith(REPO) ? file(res, f) : send(res, 403, 'no', 'text/plain');
}

function proxy(req, res) {
  const headers = { ...req.headers, host: UPSTREAM.host };
  delete headers['accept-encoding']; // plain text, so the page can be edited on the way through
  const up = http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers }, r => {
    const isHtml = /text\/html/.test(r.headers['content-type'] || '');
    const h = { ...r.headers };
    if (h.location) h.location = h.location.replace(UPSTREAM.origin, '');
    if (!isHtml) { res.writeHead(r.statusCode, h); return r.pipe(res); }
    const chunks = []; r.on('data', c => chunks.push(c));
    r.on('end', () => {
      delete h['content-length']; delete h.etag; h['cache-control'] = 'no-store';
      res.writeHead(r.statusCode, h); res.end(inject(Buffer.concat(chunks).toString('utf8')));
    });
  });
  up.setTimeout(20000, () => up.destroy(new Error('timed out')));
  up.on('error', e => send(res, 502, `Dashboard at ${UPSTREAM.origin} not reachable (${e.message}). Try --snapshot.`, 'text/plain'));
  req.pipe(up);
}

http.createServer((req, res) => {
  if (req.url.startsWith('/__qc-theme.css')) return file(res, path.join(HERE, 'qc-theme.css'));
  return SNAPSHOT ? snapshot(req, res) : proxy(req, res);
}).listen(PORT, '127.0.0.1', () =>
  console.log(`QC-look preview: http://localhost:${PORT}/  (${SNAPSHOT ? 'saved snapshot, 21 Oct 2026' : 'live from ' + UPSTREAM.origin})`));
