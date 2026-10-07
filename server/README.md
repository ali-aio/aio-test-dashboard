# Backend

One dependency-free Node process (`node server/server.mjs`, Node ≥ 20). It:

- serves the repo as static files (what `python3 -m http.server` did before)
- every 30 min pulls `/history` for every device in the cycles group from the MDM and
  runs `shared/cycles.js` + `shared/profile.js` on it, writing `data/topup.json`
  (cycles since the static import, charge segments, per-cycle thermal stats)
- `GET /api/status` — last sweep time, counts, last error, MDM client stats
- `POST /api/sweep` — sweep now (Settings → "Check for new cycles")
- `GET /api/devices[?group=]` — proxied fleet snapshot, 20 s server cache
- `GET /api/history/:serial?start&end&interval_sec[&cycles=true]` — proxied history,
  60 s cache, window capped at 7 days, start/end bucketed to the interval so near-identical
  requests share one entry

Every upstream call goes through `mdm.mjs`: at most 3 in flight, 120 ms apart, identical
URLs coalesced and cached. Clients get 120 `/api/*` requests per minute per IP, then a
`429` with `Retry-After` (`RATE_PER_MIN` to change). Static files are gzipped and served
with an ETag, so a reload of the 450 KB cycle import is a 304.

Read-only against the MDM: GET requests with the QA key, nothing else.

## Setup

```bash
cp server/config.example.json server/config.json   # paste the QA key (gitignored)
./deploy.sh
```

Environment overrides: `MDM_API_KEY`, `MDM_BASE`, `CYCLES_GROUP`, `PORT`, `SWEEP_MIN`, `RATE_PER_MIN`.

With the backend serving the page, browsers need no API key at all — `shared/data.js`
detects it at boot and uses the proxies. Without a key on the server the pages still work:
they call the MDM directly with the key from Settings and detect cycles in the browser
(per-browser, cached 6 h), as before.
