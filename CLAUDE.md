# AIO Test Dashboard

A standalone static dashboard for AIO's testing/QA team — battery-cycle tracking,
fleet overview, device history. **It is a separate project from the MDM.**

## Hard rule: never touch the MDM

This repo lives on its own, outside the `aio-mdm` tree, on purpose. It talks to the
MDM only through the fixed read-only HTTP API documented below.

- **Never edit, clone, or open `aio-mdm-web` or any other MDM repo from here.** If a
  feature needs a new field, a new endpoint, or a backend change, that is out of
  scope for this repo — tell the person asking, don't go implement it in the MDM
  yourself.
- **Never commit to or push a different repo.** This CLAUDE.md governs this
  directory only.
- If the existing API genuinely can't do what's being asked (a field isn't exposed,
  a filter doesn't exist), say so explicitly and stop — don't route around it by
  calling undocumented MDM endpoints or guessing at internal behavior.

## Who works here

The person extending this repo day-to-day is **not** the person who built the MDM
backend it talks to. Treat every request as: read what they're asking for, make the
UI/data change inside this repo using the API contract below, then redeploy (see
Deploying). Don't assume access to or knowledge of the MDM's internals beyond what's
written here.

## API contract (the only thing this repo may call)

Base URL — pick one, set in Settings (`settings.html`), stored in `localStorage`:

| Environment | Base URL |
|---|---|
| Live (real fleet) | `https://mdm.dev.aioapp.com` |
| Stage | `https://mdm-stage.dev.aioapp.com` |

Auth: header `X-API-Key: <key>` on every request. The key is a **QA-scoped,
read-only** key (`QA_API_KEY` on the server side) — it cannot reboot, wipe, or
otherwise command a device, only read telemetry. Get a key from whoever administers
the MDM; this repo has no way to mint one.

Every endpoint is scoped to **firmware-client devices only** (T7/Kiosk — the
`agent_kind=firmware` fleet), not DPC-agent devices, and CORS is wide open (`*`).

### `GET /api/v1/testdata/devices`

Fleet snapshot, one row per device. Optional `?group=<name>` narrows to one group
(get the list of valid names from `/testdata/filters` below) — there is no
restaurant filter, group only.

```json
[
  {
    "serial_number": "AT070AABU00231",
    "device_class": "t7",
    "restaurant_name": "",
    "groups": ["Test Cycles"],
    "last_seen_at": "2026-10-06T12:10:34Z",
    "battery_pct": 84,
    "battery_temp_c": 37.1,
    "charging": false,
    "wlc_state": "",
    "charging_pad": false,
    "ram_used_pct": 0,
    "storage_free_pct": 0,
    "discharge_total_pct": 3097,
    "discharge_backfilled": true,
    "extra": { "...": "the device's full latest check-in payload, raw" }
  }
]
```

`extra` is the device's entire last check-in JSON blob, passed through unmodified.
**New telemetry fields show up there automatically** as the MDM client starts
reporting them — that's the whole point of this field existing. Don't ask for a new
top-level field to be added for something that's already sitting in `extra`; read it
from there instead (see `shared/chart.js`'s `JSON.parse(r.extra)` pattern).

`discharge_total_pct` is the lifetime cumulative battery discharge; divide by 100
for "equivalent full cycles" — see `cycles.html`.

### `GET /api/v1/testdata/devices/{serial}/history`

Time-series for one device. Query params: `start`, `end` (RFC3339, default last 7
days), `interval_sec` (default 300), `cycles` (`true`/`false`, default false).

```json
[
  {
    "serial_number": "AT070AABU00231",
    "battery_pct": 84,
    "build_id": "...",
    "extra": { "...": "..." },
    "timestamp": "2026-10-06T12:10:00Z",
    "sample_at": "2026-10-06T12:10:00Z",
    "last_seen_at": "2026-10-06T12:10:34Z",
    "empty": false
  }
]
```

**`empty: true` rows are placeholders for a no-data gap (device offline, nothing
sampled) — `battery_pct` on those rows is a meaningless 0, not a real reading.**
Always filter `rows.filter(r => !r.empty)` before plotting anything, exactly like
`shared/chart.js` does. Forgetting this is the one bug that's bitten this repo
before (a chart "spiking to zero" on every gap) — don't reintroduce it.

### `GET /api/v1/testdata/filters`

```json
{ "groups": ["Test Cycles", "Test Lab units", "..."], "restaurants": ["..."] }
```

Used only to populate the group picker (the scope badge in every page's topbar —
see `initScopeBadge` in `shared/data.js`). Restaurant names come back too but this
repo doesn't use them — group-only scoping was a deliberate choice, not an
oversight; don't add restaurant filtering back in without being asked.

## Structure

- `index.html` + (inline module script) — **home page**, dense sortable table +
  inline sparklines + per-row history drawer. This is the default/primary view.
- `console.html` — dark three-pane layout: device list + detail chart side by side.
- `cycles.html` — the battery-cycle workflow: a "shelf" of devices (click one to
  select it) above a cycle-count/charge/temp summary + charge-timeline chart below.
  This is Fleet Wall and Cycle Lab merged into one page — clicking a device on the
  shelf *is* how you open its cycle detail, there's no separate navigation.
- `settings.html` — API base + key. Group scope is **not** set here — it's the
  dropdown badge (`#scope-badge`) present in every page's topbar.
- `shared/data.js` — all API calls, the sessionStorage cache (20s devices / 60s
  history TTL), the scope badge, config helpers. Add new API interactions here, not
  duplicated inline in a page.
- `shared/chart.js` — the shared SVG line chart (crosshair + tooltip + charge bands)
  and the sparkline renderer. Both apply a moving-average smoothing + Catmull-Rom
  spline — keep that if you add another chart, it's there because raw battery
  readings are jittery enough to look broken otherwise.
- `assets/t7-icon.png` — the T7 device glyph used in `cycles.html`'s shelf. Other
  device classes fall back to a generic outline SVG (inlined as a data URI next to
  where it's used) — there's no icon asset for kiosk/pos/etc yet.
- `demos.html`, `demos2.html`, `icon-demos.html`, `rack-demos.html` — point-in-time
  design exploration, not linked from the real nav, safe to ignore or delete when
  stale. Follow the same pattern (named options, mock data, a pros/cons note each)
  if you add a new one for a UI decision.

## Conventions

- Plain HTML + vanilla JS modules, no build step, no framework, no bundler. Keep it
  that way — this repo's whole value is "open the file, it works."
- Theming matches the MDM dashboard's tokens (coral/periwinkle brand gradient,
  light/dark via `prefers-color-scheme`) — see the `:root` block in `style.css`.
  Keep new UI inside those tokens rather than inventing new colors.
- Motion vocabulary (slidein/pop/pulse/spin/shake) is defined once in `style.css`
  and reused everywhere — reuse it rather than writing new keyframes per page.
- No restaurant scoping, no DPC-agent devices, no write actions of any kind — these
  are deliberate scope limits from how the API was designed for this team, not gaps
  to fill in without asking first.

## Deploying

Static files, no build/compile step. "Deploy" = get the latest files onto the host
that serves them and make sure the server process is serving the current code.

```bash
./deploy.sh
```

This restarts the Python static server on port 8090 so it's serving whatever is
currently on disk. Run it after pulling new changes. The page is then reachable on
the tailnet at `http://100.113.189.96:8090/` (not `localhost` — this box is reached
over Tailscale from other machines).

There is no CI/CD here and no build artifact — committing to `main` and running
`./deploy.sh` on the host is the entire release process.
