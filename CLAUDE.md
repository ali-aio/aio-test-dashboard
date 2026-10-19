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

**The team's QA key (use it, don't ask for it again):**
`27cc4df99dbb73c4b36ab3dc7e156fc91b15094bc4cc65bd35f0a66b9b0f3654`
It goes in `server/config.json` (gitignored) for the backend sweep, and in Settings in
the browser. Live MDM, group "Test Cycles".

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
for "equivalent full cycles" — see `index.html`.

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

Used only to populate the cycles-group picker in Settings (`#/settings`, via
`fetchFilters` in `shared/data.js`). The old topbar scope badge (`initScopeBadge`) is
legacy — only `index.prev.html` still calls it. Restaurant names come back too but this
repo doesn't use them — group-only scoping was a deliberate choice, not an
oversight; don't add restaurant filtering back in without being asked.

## Structure

- `app.html` + `src/` — **the React app (v2)**, hash-routed: `src/main.jsx` ->
  `src/App.jsx` (shell, source list, status bar, inspector, v1/v2 picker, theme) ->
  `src/views/*.jsx`. Built with `npm run build` into `dist/`, served at `/dist/app.html`
  until the v1 views are ported and it takes over `/`.
- **Device search + device page** — `src/components/DeviceSearch.jsx` sits in the header on every
  screen (`/` focuses it); a match opens `#/nx/device/<serial>` (`src/views/DeviceView.jsx`): status
  now, totals, battery curve per test, tests it has run (click → that test filtered to the device)
  and every run, all tests, newest first. Filters do not apply on that page.
- **Export CSV** — header button on every screen → `src/components/ExportDialog.jsx` (rendered on
  `<body>` via a portal; inside the sticky header a fixed overlay is trapped). Readings (the MDM
  history rows per device, at a chosen interval, `empty` rows dropped) or cycles (one row each);
  devices, time span and columns are picked by checkbox. Column definitions and CSV text live in
  `src/lib/csv.js` (tested). Readings fetches retry on the proxy's 429.
- **Header tools** (`src/components/HeaderTools.jsx`): the Live pill opens the last sweep time
  (no "cycles checked" text in the bar) and a Reload button (`location.reload()`), and the
  notification bell. The bell's rule is `src/lib/alerts.js` (tested): in the planned cycle running now
  (`cycleAt`), a device is raised when it is one of the few (1–2, or up to a fifth: `oddLimit`) that differ
  from the rest — on charge / on battery, wireless load (`wlc_status`), pad on/off (`wlc_charging`), not
  reporting, battery ≥ 15 points from the median, ≥ 8 °C hotter. Re-checked on every 30 s snapshot, so it
  works on every screen. The log, with read state, is per browser (localStorage `alertsLog`) and holds only the current cycle's: the next cycle (or, with none running, the next day) clears it.
  Clicking one opens Today.
- **What "cycles" counts** (`src/lib/splitCycles.js`): a cycle is one bench run of a test — devices that
  start the same test within `CYCLE_GAP_H` (3 h) are ONE cycle (`countCycles`/`cyclesText`), so 17
  devices on WLC on Load = "1 cycle · 17 devices". A single device's entries are its cycles. Counts
  of per-device entries say "device cycles" (`deviceCyclesText`). The MDM figure reads "battery cycles".
- **Counted cycles** (`src/lib/cycles.js`): besides run-downs and >= `minHours` timed runs, a discharge
  that went on charge (or went silent) at or below `endPct` (20%) counts too — fast tests like WLC on Load
  finish in 7–8 h. A running discharge is added to the Overview from the live window (`runningCycle`,
  `inProgress: true`); cycles with no stored curve are resampled from the live readings. A run started up
  to 2 h before a planned cycle's window still belongs to it (`EARLY_START_H`, `cycleAt`).
- **The lab's tests** (`TEST_TYPES` in `src/lib/plan.js`, each with an `about` line shown in the Cycle plan form;
  from the lab, Oct 2026). "Load" = something on the T7's wireless pad, which the T7 charges. Plans store the test's
  id, so renaming a test keeps old plans; a new test goes at the end (colour follows the position).
  Run most often: **Restaurant Case, WLC on Load, Ads only** (`frequent: true`, listed first in the Cycle plan form).

  | Test (code) | How it runs |
  |---|---|
  | Charging Cycle (CC) | The T7 charges; time to 50 / 80 / 95 / 100 %. |
  | WLC on Phone (WP) | A phone on the pad; the result is how long the phone takes to charge fully (depends on the phone — the MDM reports only the T7's battery, not the phone's). |
  | WLC on Load (WL) | A load on the pad with ads running, until the T7 powers off (10 % → 0 %). |
  | Ads only (DA, was "Discharging on Ads") | Only ads, no load, until the T7 powers off (0 %). |
  | WLC + Discharge on Ads (WD) | Ads running, a load on the pad for the first 3 h, until the T7 powers off (0 %). |
  | Burn-in Test (BI) | Production only: 4K video played continuously, no ads. |
  | Restaurant Case (RC) | A load on the pad for 3 h; the cycle runs 14 h. |
  | Discharge on Load only (LO) | Only a load on the pad, no ads, until the T7 powers off (0 %). |
- **Auto Cycle plan** (`src/lib/autoPlan.js`, tested; `server/autoplan.mjs`, run at the end of every sweep): the lab no
  longer has to enter each day. The server reads each bench's test from the readings and writes it into the shared plan
  (`data/plan.json`) with `auto: { at, final, basis, was? }` and `by: 'Auto'`; the Cycle plan and Today show an **Auto**
  pill (reason on hover), everything else **By hand · name** (`src/components/PlanSource.jsx`). Rules (medians over the
  bench, ≥ 3 devices starting within 3 h): load on the pad ~3 h then ≈4 %/h → Restaurant Case if it goes back on charge
  (~14 h), WLC + Discharge on Ads if it runs to power-off; load the whole run → WLC on Load if ≤ `LOAD_ONLY_H` (10 h) to
  empty, else Discharge on Load only (ads aren't in the telemetry; the lab: WLC on Load 8–9 h, Load only 9–11 h); no load,
  ≥ 2 %/h → Ads only. Never guessed: Charging Cycle, WLC on Phone, Burn-in. "Load the whole run" = on the pad ≥ `WHOLE_RUN` (85 %) of it and still on at its end, and
  while running not before 5 h (16 Oct 2026 was called WLC on Load at 4.8 h, the pad off since 3.4 h). With a load on the
  pad the T7 can report `charging` for up to an hour while its battery falls; `runsFrom` ends a run on `charging` only
  when the battery rises (now or within 30 min), or that day's runs split in two. A running bench is added once it can be told
  (`final: false`, kept up to date). A person's entry for a different detectable test is **replaced once the run ends**
  (the lab's choice, Oct 2026), keeping `auto.was`; a several-day entry gets a one-day override instead. An entry a person
  edits (the form drops `auto`) or deletes is never touched again (`data/autoplan.json`: `made`, `applied`, plus every
  device's runs since 25 Sep so a sweep re-reads only 2 days at 5-min spacing). Every save stamps `mod`; a 409 merge in
  `planSync.js` keeps the newer copy of each entry, so a browser can't undo the server's update.
- **HW build** comes from the serial (`buildFromSerial`, `src/lib/device.js`): "BU" in it = Production
  Build, otherwise "OTG / Validation Build" (the serial can't tell those two apart).
- **Drain rate by battery age** (Summary screen, `src/components/DrainByAge.jsx` + `src/lib/drainHours.js` + `src/lib/drainAge.js`,
  tested): each device's drain (shown as % per 15 min) per **5 battery cycles** of age (0–5, 5–10, …), its last 7 days and its MDM count now,
  with pickers for **load** (pad), **ads** and **battery temperature** (and test), plus a fleet **Average by condition** table
  (each condition on its own). Worked out **per 15 minutes**, because one cycle mixes conditions (Restaurant Case: 3 h with a
  load, then none; a phone may sit on the pad for 20 min): the sweep keeps every device's 15-min slots off the charger
  (`data/hours.json` v 2, gitignored, `buildHours` in `server/sweep.mjs`: drop, minutes on battery, minutes with a load, mean
  battery temp; whole history once at 5-min readings, then extended). Only slots inside a counted cycle count (a device idle
  on a shelf does not), which also gives the slot its
  test; ads come from the test (`ADS_BY_TEST`, from the lab's descriptions; Old cycles / WLC on Phone = not known). The
  devices report the battery's temperature, not the room's — there is no external temperature in the API. Battery age at
  an hour comes from the drop ledger (`data/drops.json`, `buildDrops`): every point drained since its first reading, so
  cycles at time t = today's counter − what drained since t. Checked against the MDM: the counter's rise over 6 days matched
  the summed drops within ~2%; the counter is higher than the history's total only by what drained before the history starts.
  **Before the Cycle plan (25 Sep 2026) the test comes from the lab's own sheets** (`data/sheet-runs.json`, made by
  `scripts/sheet-runs.mjs` from the lab's CSVs + fw2's `data/hours.json`; committed). The lab calls those sheets
  inconsistent, so **this table is the only thing allowed to read them** (not the plan, Auto or Health), and a sheet run
  is kept only where the readings agree: date (day/month and month/day both tried), drain within 25 %, load on the pad
  fits the test. A plan test wins over the sheet's; a sheet run counts even where the detector counted no cycle.
  Firmware v2.0.3–v2.0.4 (July – mid Aug 2026) reported `wlc_status` 0 with a load on the pad: in a sheet run the load
  then comes from the test (Restaurant Case / WLC + Discharge: first 3 h), elsewhere a slot draining ≥ 9 %/h with no
  load reported is "load not known".
  The same slots give each test's **Every cycle** table (`TestDetailView`) two columns, **Drain with WLC / without WLC**
  (`padSplit`: %/h over the cycle's slots with a load on the pad for most of the slot / without; under 30 min = —),
  for tests that place a load (Restaurant Case, WLC on Load, WLC + Discharge, WLC on Phone, Load only) and Old cycles.
  That table's **Export CSV** opens a menu: **Overview** (one row per cycle, as shown, search applied) or **Per hour**
  (`cycleHoursCsv` in `csv.js`, tested: one row per device × cycle × hour — battery at the hour's start / end from the
  cycle's curve, drained or gained, %/h, minutes with a load on the pad from the slots, average / peak battery temp).
- **Battery health** (`#/nx/health`, nav "Health"; `src/views/HealthView.jsx` + `src/lib/health.js`, tested): one row per
  device for ONE discharge test picked at the top (the busiest by default). A run is comparable when it is a counted cycle of
  that test that started ≥ 95 %. Score = 0.6 × capacity + 0.1 × early drain + 0.3 × stress (early's weight goes to capacity
  when fewer than 3 runs have a curve). A load on the wireless pad drains ~3× faster (ads ~4 %/h, pad + ads ~13 %/h) and both
  happen under one test, so every run is judged against the baseline of its own **load class** (`loadClass`: pad on / off /
  unknown, from `padState`): capacity = each of the last 3 runs' `fullMs` as a share of its class baseline (median of the
  device's first 5 runs of that class, the fleet's first-5 median below 5), the median share capped at 100; early drain = the
  same for the points lost in the first hour (baseline ÷ now); a Load picker can narrow the page to one class. Stress = 100 −
  mean load over lifetime cycles, h ≥ 40 °C, h ≥ 45 °C, hours on charger at 100 %, discharges ended < 5 %, each as a share of
  the fleet p90. Penalties (30 days): the detector's `offline` interrupted discharge above 5 % (shutdown), a wired charge from
  ≤ 80 % that came off the cable below 100 % after > 1.5× the fleet's median time to 100 %, a > 5-point jump between readings
  ≤ 15 min apart off the charger. Good ≥ 90 and no penalty · Watch 80–89 or one penalty · Replace < 80, ≥ 2 penalties or ≥ 2
  shutdowns · "Not enough runs" < 3. All in the browser from data already loaded, only while the screen is open; nothing new
  on the server or the MDM. Single click selects a row (detail panel), the serial or a double-click opens the device page.
- **Today** shows the cycle running now; once it ends, it stays up for `RECENT_H` (6 h) as **Ended HH:MM** ("Ran for",
  "T7 battery, last cycle") until the next one starts — at 00:06 a cycle planned to 00:04 is not "No test set".
- `src/lib/window.js` — the 7-day reading window (every check-in: `interval_sec=60`, the MDM stores one per ~3 min) behind Today and the charts. It is
  kept in the browser's IndexedDB (`readings` store in `src/lib/db.js`), so a page open draws
  from the stored copy and fetches only the readings since (last stamp − 30 min). "Reload
  readings" bypasses it and refetches the full window.
- `src/components/SortTable.jsx` — every table sorts by any heading: first click highest
  first, second lowest first, third the table's own order, read from the displayed text
  ("9.1 h", "47.6 °C", "13h 45m", dates). Chart tables (`TableView`) use it by default; a
  hand-written table should be a `<SortTable head={[...]}>` rather than a bare `<table>`.
- `src/lib/plan.js` — the **declared test-type schedule**, the answer to the one thing MDM
  telemetry cannot supply. A declaration is (test type, date window, device group, time
  window); resolution order is explicit declaration > standing weekly rota > inferred from
  telemetry > unclassified. **Shared through our own backend** (owner's OK, Oct 2026): `data/plan.json`
  on fw2 (gitignored), `GET/PUT /api/plan?group=` in `server/plan.mjs`, synced by `src/lib/planSync.js`
  (pull every minute and on tab focus, push on every save, 409 + merge by id on a concurrent save,
  a browser's own plans merged in once on its first sync). localStorage is the per-browser cache;
  served without the backend it falls back to per-browser only.
  A declaration is one **cycle**: start date + time to end date + time (`spanDays` = days from
  start to end). Plans saved by the first From/To form have no `spanDays`; `loadDecls` reads them
  as one continuous cycle ending on their To date, which is how the lab used that form.
  `from`..`to` is only for repeating it (daily, or `repeat: 'weekly'`) — the form says so explicitly.
  A day can hold several cycles (`cyclesOn`); a run belongs to the cycle whose window it *started*
  in (`cycleAt`, which also checks cycles carried in from earlier days), and runs count on their
  start day. Devices are picked per cycle (all, or an explicit serial list); devices taken out
  mid-cycle are recorded on it (`removed`, with reason) and leave it from that moment.
  **Planned tests count only runs from 25 Sep 2026 on** (`PLAN_FROM` in `adapt.js`): anything earlier is Old cycles
  whatever a plan entry says, so no test's averages or per-hour charts mix in pre-plan runs. A run must also look like
  its test (`leftTest`): a test with a fixed cycle time (`hours` in `TEST_TYPES`, Restaurant Case 14 h) may run
  `CYCLE_SLACK_H` (2 h) longer, past that the device has left the cycle; one with a set load time (`loadHours`:
  Restaurant Case, WLC + Discharge — 3 h) is checked hour by hour (1 Oct 2026: 4 devices ran WLC on Load on a
  Restaurant Case bench): WLC active in each of the first `loadHours` hours and inactive from hour `loadHours + 2` on (hour 4 is when a 3 h
  load comes off), from the 15-min slots (`padHours`; an hour without readings is not judged). The lab: a device that
  behaves differently from the test is not in the cycle (one left off the charger on 16 Oct showed as
  69 h; a device starting up to 3 h after the others is still in the cycle, held to its own run time), and a
  discharge test drains ≥ 2 %/h (a device idling on the bench at ~1 %/h was not on it).
  **A device that leaves the cycle part-way keeps its data up to then** (`planFor` → `{ name, cutAt, why }`; the lab,
  Oct 2026: devices are mostly taken out after a few hours): taken out on Today (`removed`), past the cycle time, a
  load still on after the load hours, or none in one of them — `adaptCycle` cuts its curve, battery, duration and
  hours at that moment, marks it `leftCycle: { at, why }` ("· left cycle" in the tables, a CSV column), and its hours
  count for the test. Only a run that never ran the test is Old cycles: no load in hour 1, no pad readings in the load
  hours, under 1 h kept, or under 2 %/h over the hours kept.
  A run only takes a declared cycle **of its own kind** (`testTypeFor` in `adapt.js`): a discharge never becomes a
  Charging Cycle, a charge never a discharge test. The charges themselves are the sweep's charge segments (`d.charges`,
  ≤ 30 % up to ≥ 90 %, with their own curve): **every charge from 25 Sep on is a Charging Cycle** with no plan entry
  (the lab recharges after every cycle, daily; their choice, Oct 2026), shown on the Overview and its Charging Cycle
  screen as battery gained, and left out of the Cycle plan's All cycles list.
  The Cycle plan screen ends with **All cycles** (`AllCycles` in `CyclePlanView.jsx`): one row per bench
  cycle of a planned test (`benchCycles`), newest first; a click opens that test with the cycle picked
  (`openCycle` in `App.jsx` -> `initialBench` on `TestDetailView`).
- `index.html` + (inline module script) — **the previous dashboard (v1)**, one page, hash-routed:
  Overview (KPIs, weekly runtime trend, needs-attention, bench grid) · Devices (sortable
  table + inspector → device detail with runtime-per-cycle + cycle history) · Test cycles (UI label; code and routes still say "runs")
  (list → run detail) · Settings. Mac document-window shell; styles live in `app.css`
  (not `style.css`). Favicon is `assets/favicon.svg`.
- **Cycle definition** (see `shared/cycles.js`): a discharge starts ≥95% off the charger.
  It counts as a **run-down** when it drops below 5% and the device stops checking in for
  30 min, or as a **timed run** when it was recharged after at least 8 h (the lab's daily
  bench run: off the charger ~10:30, back on ~00:30 at 15–25%). Anything shorter, or lost
  above 5%, is "interrupted" and not counted. Thresholds (`fullPct`, `deadPct`, `minHours`,
  `offlineMin`) are editable in Settings (localStorage `cycleOpts`) and applied by
  `reclassify()` on the imported/swept lists, so no re-sweep is needed. Every counted cycle
  has `fullMs`, the projected runtime to empty (elapsed ÷ % drained × 100) — compare and
  chart that (`rt(c)`), never raw `durationMs`, or the 14 h timed runs and 26 h run-downs
  look like noise. One more threshold, `minDepth` (10 points), is a fixed default in
  `DEFAULTS` with no Settings input: a discharge must drop at least that far to count as
  timed or even be recorded as interrupted — shallower dips are charger wobble.
- `data/cycles.json` — static one-off import of every past cycle for the "Test Cycles"
  group (generated by a backsweep script outside the repo). Cycles since then come from
  `data/topup.json`, written by the backend sweep (below) — don't re-import just to pick
  up new cycles.
- `server/` — the backend: one dependency-free Node process that serves the static files
  (gzip, ETag/304) and sweeps the MDM every 30 min with the same `shared/cycles.js`
  detector, writing `data/topup.json` (gitignored, as is `server/config.json` holding the
  QA key). It also proxies the two read endpoints as `/api/devices` and
  `/api/history/:serial` with a 20 s / 60 s server-side cache and one shared in-flight
  fetch, so N browsers cost the MDM one request per TTL. Every upstream call goes through
  `server/mdm.mjs` (3 in flight, 120 ms apart); browsers are rate-limited per IP on
  `/api/*` (120/min, 429 + Retry-After). Still read-only against the MDM. `shared/data.js`
  picks proxy vs direct once at boot (`detectBackend()`); served without the backend, the
  pages call the MDM directly with the key from Settings and fall back to the old in-browser
  `topUp()`. Two more endpoints, both ours: `GET /api/status` (last sweep time, counts,
  last error, MDM client stats — what the app and `scripts/deploy-fw2.sh` use to check the
  backend is up) and `POST /api/sweep` (sweep now; Settings → "Check for new cycles").
  See `server/README.md`.
- **UI shell** (`index.html` + `app.css`): the "Finder / Activity Monitor" option from
  `mac-demos.html` with the no-toolbar top from `toolbar-demos.html` (option A) — no app
  name anywhere. Source list on the left: search, Views (colored glyphs), fleet filters,
  smart lists, System/Settings (test cycles are one item under Views, no separate list); the table or charts pane; an inspector on the right
  (single click selects a row into it, double-click or Enter opens); status bar below with
  the sidebar / theme / inspector toggles. System font 13 px, hairlines, alternating rows,
  coral only for selection and the
  primary button. Keep new views on this grammar: a table in the pane, details in the
  inspector via `inspect(...)`, filters as source-list items.
- `shared/profile.js` — battery health (runtime-based proxy, Apple-style 80% line), charge
  segments (time to 50/80/95%, wired vs wireless pad via `wlc_status`) and per-cycle thermal
  stats (minutes ≥40/45 °C, temp per 10% charge bucket). Fed by the same 14-day history
  top-up as cycles; the pages are `#/health`, `#/charging`, `#/thermal`.
- `shared/runs.js` — test cycles ("runs" in code) started from the UI. **Stored in localStorage only**
  (the API is read-only), so runs are per-browser, not shared. Past runs shown as `R-…`
  are recovered from history by clustering cycle starts; UI-started runs are `L-…`.
- Settings (in-app, `#/settings`): API key + **cycles group** (the one group every page
  is scoped to; default "Test Cycles"). **Live MDM only — there is no stage mode in the
  UI.** The old standalone `settings.html` and the topbar scope dropdown are no longer
  used by `index.html`.
- `shared/data.js` — all API calls, the sessionStorage cache (20s devices / 60s
  history TTL), the scope badge, config helpers. Add new API interactions here, not
  duplicated inline in a page.
- `shared/chart.js` — the shared SVG line chart (crosshair + tooltip + charge bands)
  and the sparkline renderer. Both apply a moving-average smoothing + Catmull-Rom
  spline — keep that if you add another chart, it's there because raw battery
  readings are jittery enough to look broken otherwise.
- `assets/t7-icon.png` — the T7 device glyph, from the old shelf view in
  `cycles.html` (now removed, see git history). The real app doesn't use it; only
  `rack-demos.html` still references it.
- `index.prev.html` — the dashboard before the Finder shell (top bar + scope badge, uses
  `settings.html` and `style.css`). Kept for reference; the last consumer of
  `initScopeBadge`.
- `plan-mockups/` — **design only, not wired to anything**: seven pages with mock data
  (`00-approach` … `06-device`) for tagging every cycle with a test type (the lab's CSVs
  know it, MDM doesn't). Join key is device serial + calendar day. The proposal needs a
  small write endpoint on *our own* backend (`data/plan.json`) — "no write actions" below
  means no writes to the MDM or to devices; a write to this repo's own file is a separate
  decision that needs the owner's OK. Nothing in `index.html` reads a plan yet.
- `scripts/deploy-fw2.sh` — release from another machine, see Deploying.
- Point-in-time design exploration, not linked from the real nav, safe to ignore or delete
  when stale: `mac-demos.html` (the three macOS-style directions, B chosen),
  `toolbar-demos.html`, `design-demos.html`, `app-demo.html`, `app-demo2.html`,
  `features-demo.html`, `demos.html`, `demos2.html`, `icon-demos.html`, `rack-demos.html`. Follow the same pattern (named options, mock data, a pros/cons note each)
  if you add a new one for a UI decision.

## Conventions

- **React 18 + Vite 5, JSX, no TypeScript.** The UI is React components in `.jsx`;
  everything that is not UI is plain `.js`/`.mjs`. Node runs the tooling only (`npm run
  dev`, `npm run build`) — it is not part of the frontend. This replaced the original
  vanilla-JS/no-build setup in Oct 2026, to match `/home/tariq/Projects/T7-Dashboard`.
- **Detection logic stays framework-free.** `src/lib/` is plain JS with no React import —
  cycles, profile, plan, fleet, window, format, device — so the browser and
  `server/sweep.mjs` run the same code, and it stays testable in Node. Only `src/views/`
  and `src/components/` may import React. `shared/*.js` are thin re-exports of `src/lib/`
  kept so the legacy page and the demo pages keep working; delete them once nothing
  imports `./shared/`.
- The backend (`server/`) is still plain Node with **zero npm dependencies** — the npm
  deps are build-time only (react, react-dom, vite, @vitejs/plugin-react).
- Theming matches the MDM dashboard's tokens (coral/periwinkle brand gradient,
  light/dark via `prefers-color-scheme`) — see the `:root` block in `app.css` (`style.css`
  is the old theme, still used by `settings.html` and the demo pages).
  Keep new UI inside those tokens rather than inventing new colors.
- Motion vocabulary (slidein/pop/pulse/spin/shake) is defined once in `style.css`
  and reused everywhere — reuse it rather than writing new keyframes per page.
- No restaurant scoping, no DPC-agent devices, no write actions of any kind — these
  are deliberate scope limits from how the API was designed for this team, not gaps
  to fill in without asking first.

## Deploying

There **is** a build step now, and it runs **on your machine, never on fw2** — fw2's
default `node` is v10.19.0 and Vite needs >= 18. So `dist/` is **committed on purpose**:
build locally, commit the result, and fw2 only ever serves static files.

```bash
npm test          # server-renders every view x every test type against real history
npm run build     # -> dist/ (commit it)
```

Run `npm test` before building. T7's views iterate cycle fields unconditionally, so a field
`src/lib/adapt.js` forgets is not a blank number but a crash the moment someone opens a
single test — that shipped once ("series is not iterable"). The test catches it in Node.

"Deploy" = get the latest files onto the host that serves them and make sure the server
process is serving the current code.

```bash
./deploy.sh
```

This restarts the Node backend (`server/server.mjs`) on port 8090 so it's serving
whatever is currently on disk. It needs `server/config.json` with the QA key for the
sweep to run (see `server/README.md`). Run it after pulling new changes. The page is then reachable on
the tailnet at `http://100.113.189.96:8090/` (not `localhost` — this box is reached
over Tailscale from other machines).

There is no CI/CD here. `npm run build`, commit (including `dist/`), push, then
`./deploy.sh` on the host is the entire release process. Forgetting to rebuild ships the
previous bundle, so build before you commit.

### Deploying from another machine (Tariq's PC)

The app runs on **fw2** (`hwpc02@100.113.189.96`, repo at `/home/hwpc02/aio-test-dashboard`).
A second working copy lives on Tariq's PC (`tariq@tariq-pw0bk71a`, `~/Projects/aio-test-dashboard`).
To release from there, commit and **push to `main`**, then:

```bash
scripts/deploy-fw2.sh             # fw2: git pull --ff-only origin main, then ./deploy.sh
scripts/deploy-fw2.sh --dry-run   # connection + "what would go out", changes nothing
```

- "Latest" = what is on `origin/main`. The script refuses to run with uncommitted or
  unpushed local work so nothing is assumed deployed that isn't.
- It needs passwordless SSH from that machine to fw2 (`ssh-copy-id hwpc02@100.113.189.96`,
  already done for Tariq's PC) and a repo on fw2 whose clean state can fast-forward — if fw2
  has uncommitted edits that clash with incoming changes the pull fails loudly and nothing
  restarts.
- Afterwards it checks fw2 is on the same commit as `origin/main` and that `/api/status`
  answers on :8090. Overrides: `FW2_USER`, `FW2_HOST`, `FW2_DIR`, `FW2_PORT`.
- `deploy.sh` picks a Node ≥ 20 (PATH, else the newest under `~/.nvm`) **before** stopping the
  running server. This matters over SSH: a non-interactive shell skips nvm and finds
  fw2's `/usr/bin/node` (v10), which can't run the ES-module server — an early version of
  the script stopped the app and then failed to start it. Now a bad Node aborts with the
  old server still running.
- `server/config.json` (the QA key) and `data/topup.json` are never copied between machines;
  each host keeps its own. Tariq's copy has no `config.json`, so run the backend there only
  after adding one — or just use it to edit and deploy.

- Per-hour charts count **cycles** (bench runs, `cyclesText`), never device runs: 15 Restaurant Case cycles of ~16
  devices are "15 cycles · 24 devices", not "235" (GroupedColumns takes a group's `nText` for its tooltip).
- Wording: the wireless pad with a load on it is **WLC active**, without **WLC inactive** (the lab's terms, Oct 2026) —
  `padState` values, chart legends, KPI cards and table headings ("WLC"). `loadClass` still reads the old "Pad on" too.
