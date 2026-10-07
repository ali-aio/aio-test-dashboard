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

Starts the Node backend on `:8090` (static files + a 30-min cycle sweep that writes
`data/topup.json`; see `server/README.md` — it wants `server/config.json` with the
QA key). Open `http://100.113.189.96:8090/`, go to Settings, and set the QA API key.

## Pages

- `index.html` — the dashboard, one page: KPI row (devices, total cycles, avg per
  device, online, hottest), cycles-per-device and temperature charts, a sortable
  device table with sparklines, and a detail panel (cycles, charge + temp history)
  for the selected device
- `settings.html` — API base/key; group scope is the dropdown badge in every page's topbar
