# AIO Test Dashboard

A standalone dashboard for AIO's testing/QA team — fleet overview, device history,
battery-cycle tracking. Plain HTML/JS, no build step, no framework.

This is a **separate project from the MDM** (`aio-mdm-web`) — it only talks to the
MDM through a fixed read-only HTTP API. See **[CLAUDE.md](CLAUDE.md)** for the full
API contract, file structure, and the ground rules for working in this repo
(short version: never modify the MDM from here).

## Running locally

```bash
./deploy.sh
```

Serves the folder on `:8090`. Open `index.html` (or `http://100.113.189.96:8090/`
if working over the tailnet), go to Settings, and set the API base + a QA API key.

## Pages

- `index.html` — home: sortable table, inline sparklines, per-row history
- `console.html` — dark list + detail split view
- `cycles.html` — device shelf + battery-cycle detail (click a device to inspect it)
- `settings.html` — API base/key; group scope is the dropdown badge in every page's topbar
