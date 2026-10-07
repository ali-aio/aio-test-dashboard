# Backend

One dependency-free Node process (`node server/server.mjs`, Node ≥ 20). It:

- serves the repo as static files (what `python3 -m http.server` did before)
- every 30 min pulls `/history` for every device in the cycles group from the MDM and
  runs `shared/cycles.js` + `shared/profile.js` on it, writing `data/topup.json`
  (cycles since the static import, charge segments, per-cycle thermal stats)
- `GET /api/status` — last sweep time, counts, last error
- `POST /api/sweep` — sweep now (Settings → "Check for new cycles")

Read-only against the MDM: GET requests with the QA key, nothing else.

## Setup

```bash
cp server/config.example.json server/config.json   # paste the QA key (gitignored)
./deploy.sh
```

Environment overrides: `MDM_API_KEY`, `MDM_BASE`, `CYCLES_GROUP`, `PORT`, `SWEEP_MIN`.

Without a key the pages still work: `index.html` notices there is no sweep and falls back
to detecting cycles in the browser (per-browser, cached 6 h), as before.
