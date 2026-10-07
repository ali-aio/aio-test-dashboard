// The one MDM client. Every upstream call — sweep or browser proxy — goes through here, so the
// MDM sees at most `concurrency` requests in flight from this host, with `minGapMs` between
// launches, and identical requests inside `ttlMs` are answered from cache (one in-flight
// fetch is shared by everyone waiting on it). Read-only: GET with the QA key, nothing else.
export function createClient({ base, key, concurrency = 3, minGapMs = 120, log = () => {} }) {
  const cache = new Map(); // url → { at, p: Promise<json>, size }
  let inFlight = 0, lastStart = 0; const queue = [];
  const stats = { upstream: 0, cached: 0, errors: 0, queued: 0 };

  function pump() {
    while (inFlight < concurrency && queue.length) {
      const wait = Math.max(0, lastStart + minGapMs - Date.now());
      if (wait) { setTimeout(pump, wait); return; }
      const job = queue.shift(); inFlight++; lastStart = Date.now(); stats.upstream++;
      fetch(base + job.url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(30e3) })
        .then(async res => { if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${job.url}`); return res.json(); })
        .then(job.resolve, e => { stats.errors++; job.reject(e); })
        .finally(() => { inFlight--; pump(); });
    }
  }
  function get(url, { ttlMs = 0 } = {}) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) { stats.cached++; return hit.p; }
    const p = new Promise((resolve, reject) => { queue.push({ url, resolve, reject }); stats.queued = Math.max(stats.queued, queue.length); pump(); });
    if (ttlMs) { cache.set(url, { at: Date.now(), p }); p.catch(() => cache.delete(url)); }
    return p;
  }
  // forget entries older than 10 min so the map doesn't grow with every history range ever asked
  setInterval(() => { const cut = Date.now() - 600e3; for (const [k, v] of cache) if (v.at < cut) cache.delete(k); }, 60e3).unref();
  return { get, stats: () => ({ ...stats, inFlight, queue: queue.length, cacheEntries: cache.size }) };
}
