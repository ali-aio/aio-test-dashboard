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

One page, `index.html`, hash-routed inside a Mac Finder-style shell (source list, table
or charts pane, inspector, status bar):

- **Overview** — KPIs, weekly runtime trend, needs-attention list, bench grid
- **Devices** — sortable table; open one for runtime per cycle and cycle history
- **Test cycles** — runs detected from device history, and their detail
- **Health / Charging / Thermal** — battery health, charge segments, thermal stats
- **Settings** — QA API key and the cycles group (live MDM only)

Other files: `settings.html` and `index.prev.html` are the old top-bar version, kept for
reference. `plan-mockups/` is a design proposal for tagging cycles with a test type (not
built). The remaining `*-demos.html` / `app-demo*.html` are old design exploration.

## Releasing from another machine

`scripts/deploy-fw2.sh` pulls `origin/main` on fw2 and restarts the app; commit and push
first. Details in [CLAUDE.md](CLAUDE.md#deploying).
