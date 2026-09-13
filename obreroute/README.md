# DaBound — MVP

**Real-time jeepney tracking and route visualisation for Davao commuters.**
Mobile-first, Poppins + navy `#173B5C` + yellow `#F9C74F`, map-centric, one smartphone as the GPS device.

The interface follows the **DaBound MVP reference deck** screen for screen (pill headers, navy search
bands, navy pill rows with circular jeepney art, grey ETA rows, label/value tracking readout, slate form
fields, red Delete + navy Save, yellow bottom-nav icons). Product name: **DaBound** — `Brand.setName(...)` in `public/js/brand.js` renames the whole UI in one line.

Answers the three questions: **Where is the jeepney? Which route is it following? When will it arrive?**

---

## Run it

```bash
cd obreroute
node server.js          # no dependencies to install
# open http://localhost:8080
```

On a phone in the same Wi-Fi, open `http://<your-computer-ip>:8080`.

| What | Where |
|---|---|
| Passenger app | open `/` → **Are you a user?** |
| Admin console | open `/` → **Are you an admin?** → **Continue as Admin** (no account in the MVP, spec §3/§144) |
| GPS phone (driver mode) | `/#/driver/dev-01` (also reachable from a jeepney's detail screen) |
| Sample data (dev/QA only) | `node tools/load_demo.js --simulate` · `node tools/load_demo.js --clear` |
| Presenter demo tools | side panel on desktop, or open `/#/demo` |
| Deep links | `/#/map` `/#/nearby` `/#/tracking/dev-01` `/#/routes` `/#/route-detail/<routeId>` `/#/admin-routes` `/#/admin-devices` `/#/admin-live` |

Environment overrides: `PORT` (default `8080`), `HOST` (default `0.0.0.0`), `DATA_DIR` (where live state is
written — point it at a mounted volume so routes/jeepneys survive restarts) and `ADMIN_KEY` (unset by default,
so the demo stays one-tap; **set it on a public deployment** and every write needs the shared key while the
passenger side stays public — DaBound asks for it once per device).

### Deploy it — making DaBound public

See **[DEPLOY.md](DEPLOY.md)** for the full walkthrough (Render, Fly.io, or your own VPS with Docker +
Caddy), domain/DNS steps, the `ADMIN_KEY` lock-down and a 5-minute go-live smoke test. The short version:
one Node process serves the API *and* the app, so it needs **HTTPS** (browsers only hand out GPS on secure
origins), a writable `DATA_DIR` for `state.json`, and outbound internet for map tiles. A `Dockerfile`,
`Procfile` and `package.json` are in the repo, and no `npm install` is required.

---

## What is implemented

### Passenger (no account required)
- Map tab (deck p-04): outlined pill header, "Type in your Destination." pill, inset map card with coloured
  jeepney dots, floating locate button, "DaBound Navigational Tips" card, yellow-icon bottom nav
- **The top box on Maps and Routes is the search field** (spec §179) — tap it and type; the Maps box
  searches destinations and drops the results over the map, the Routes box filters the route list by name
  or stop. Choosing a destination fills the box, focuses the map and lists that route's jeepneys underneath.
- Destination search ("Where to?"): outlined destination rows with a yellow pin, address and a live
  "N jeepneys en route" badge
- Nearby Jeeps (deck p-06): "To: <destination>" pill + grey rows — coloured dot → route name → distance →
  **prominent ETA**; online jeepneys sort first, offline ones dim with "last seen …"
- Live tracking (deck p-07): "Tracking…" heading, inset map with the route line in the route's colour and a
  tracked dot + heading arrow + route label, then the label/value readout `ETA:` / `Distance:` / `Average Speed:`
- **"Your ride is here! Mabuhay!"** — when the jeepney you are watching closes to within **150 m of where you
  are standing** (while it is genuinely sending GPS), a yellow banner and a toast announce it, once per
  arrival. It re-arms only after the jeepney has driven 300 m away, and it never fires for an offline
  jeepney, a low-accuracy fix or an unknown position — no fake arrivals.
- **Pick the destination off the map** — the pin button on the map turns on pick mode ("Tap the map to
  choose where you want to go"), a tap drops a pin ("Use this spot?", *Go here* / *Cancel*), and every route
  that physically passes within 400 m of that spot is matched, so a pin also works for a corridor drawn
  after the place list was made. The built-in destination suggestions stay exactly as they were.
- **Your own location** — the locate button, the nearby "near you" ordering and the arrival banner all use
  the phone's real position ("You are here" dot, refreshed about every 25 s); declining location keeps every
  screen working, it only hides the personal bits.
- **"Near Victoria Plaza"** landmark readout in the tracking subtitle — never raw coordinates
- Connection-lost state: red pill, "Connection lost. Showing the last known location.", last-known marker
  retained, **"ETA unavailable"** instead of a misleading "0 min."
- Routes tab + route detail (start / stops / landmarks / end, live jeepneys)
- Saved tab: intentionally a placeholder (out of MVP scope)

### Admin
- **One-tap admin entry** → profile/dashboard (`ADMIN 67`, stats, navy settings menu exactly as referenced)
- Route list rows (icon, name, start → endpoint, **N jeepneys · M live**, stop count) → route detail (map, Start/End box, stop list, jeepneys)
- **Route editor on a real map**: `Set Start` → `Add Stop` (named landmark) → `Set Endpoint` → `Generate Path` (snaps to real roads via OSRM) → `Save`, plus `Draw Route`, **`Draw Area` corridor polygon** (translucent navy fill, navy border, yellow draggable corner handles), snapshot **Undo/Redo**, clear area, deletable stops, draggable pins, loop routes (endpoint == start)
- **Unsaved-changes guard** — leaving a dirty editor asks *Discard changes?* first (spec §89)
- Deleting a route unassigns its jeepneys instead of deleting them, and the confirmation says so (spec §48/§130)
- Jeepney/GPS device list, detail, editor (Name / Route / Type / Active) with delete confirmation
- Assignment: GPS device → route (passengers never choose the route of a device)
- **Draw the route line by dragging on the map** — the stroke is sampled, simplified and reported
  ("Path drawn — 24 points · 1.8 km"); it snaps onto the start/endpoint when the line ends near them, and
  tapping still drops single points, so both habits work
- Live map: every active device, online/offline state, per-device detail card; picking a jeepney (list or
  map) moves the camera onto it
- Every list screen carries the reference's navy search band (white pill input with magnifier + X) and a real
  empty state for "nothing yet" / "no match" (spec §59-§62); stops are described in plain language
  ("990 m away from the start"), never coordinates
- **Demo simulators are labelled**: simulated jeepneys carry a yellow `DEV` tag in lists and a
  "DEV simulator" pill + banner in the detail/driver screens, so demo movement is never mistaken for real GPS (spec §66)
- **GPS phone mode ("DRIVER")**: streams `deviceId, lat, lng, timestamp, speed, heading` from the phone's own GPS every ~2 s

### Deliberately out of scope
Payments, booking, passenger accounts, chat, notifications, analytics, AI prediction, ratings, fleet tooling. See §3 of the spec.

---

### Final QA pass — what changed

Corrections found by the release gate and fixed (all re-verified):

* **Outlier guard hole** — fixes arriving <0.2 s apart skipped the implausible-jump test, so a rapid burst
  could teleport a jeepney 3 km. An interval too short to verify a long jump is now treated as unverifiable
  and the fix is rejected (`server.js`).
* **Dishonest telemetry response** — a rejected fix still answered `{ok:true}`. It now answers
  `{ok:false, skipped:…}`, and Driver mode shows rejected readings to the phone holder instead of counting them
  as good fixes.
* **ETA for silent devices** — `Geo.formatEta` could render a stale number for an offline jeepney; it now
  returns `ETA unavailable` for anything not online (the tracking screen already did this).
* **Cold deep links** — `#/tracking/<id>` could stay on its placeholder if the store had not loaded yet; it now
  repaints and recovers as soon as the data arrives (same pattern the other detail screens use).
* **Device timestamps** — Driver mode now sends the phone's own fix timestamp; the server records it, rejects
  clocks more than 2 minutes out, and keeps its own clock authoritative for every window and timeout.
* **Route progress continuity** — a real (non-simulated) fix now updates the device's progress estimate, so a
  loop route cannot flip between "just finished" and "just started" at the shared start/end point.
* **Unused auth surface removed** — the client never called `/api/admin/login`, so the endpoint, its helper and
  the boot-log credential line are gone; the admin area is one tap (spec §3, §4).

### Requested additions after the QA pass

**1. "Your ride is here! Mabuhay!"** (`public/js/screens-passenger.js`)

| Rule | Value |
| --- | --- |
| Announced when | straight-line distance from the reading phone to the jeepney ≤ **150 m** |
| Announced only if | device `online` **and** its fix accuracy ≤ 120 m |
| Re-arms | after the jeepney is ≥ **300 m** away, so it speaks once per arrival, not once per tick |
| Surfaces | yellow banner inside the tracking card + one `UI.toast` on the first appearance |
| Copy | "Your ride is here! Mabuhay!" / "<jeepney> is right beside you." (< 60 m) or "is about 400 m away." |

The reading phone's position comes from the browser's own GPS (`window.GeoLoc`), requested when the
tracking screen opens and refreshed at most every 25 s; if the reader declines location the banner simply
never appears, and nothing else on the screen changes.

**2. Choosing a destination on the map**

The Maps tab keeps the 16 destination suggestions (`/api/state` → `destinations`, still searched from the top
box) and adds a second map control: tap it, tap anywhere on the map, and the pin becomes the destination
("Pin on the map" + coordinates, listed as *Nearby Jeeps* like any place). Matching is physical: a route
qualifies when its geometry passes within **400 m** of the pin, using the same projected-distance maths as
the landmark reporting (`Store.devices({ servingDestination: true })`, prepared-geometry cache).

**3. Drawing a route line with a finger** — the editor's `Draw Route` tool accepts a drag: points are
sampled every ~4 m, reduced with Douglas–Peucker (6 m tolerance) and drawn live in yellow; the summary line
(`N points · M path nodes · X km`) updates as you draw.

## The demo (the whole MVP in 13 steps)

1. Landing → **Are you an admin?** → **Continue as Admin** → **Route List** → **New route**: name it `Obrero - Bajada`.
2. `Set Start` → tap USeP Obrero → `Add Stop` → name it `Victoria Plaza` → add `Abreeza Mall` → `Set Endpoint` → tap Bajada → optional `Draw Area` corridor → **Generate Path** → **Save**.
3. Back → **Jeepney Info** → **Add jeepney / GPS device** → `Jeepney 02` → route `Obrero - Bajada` → `Traditional` → **Save**.
4. Open the jeepney → **Open tracking mode** on the cohort member's phone (or press **Simulate**).
5. Passenger → **I am a user** → search `Victoria Plaza` → choose from **Nearby Jeeps** → **tracking screen**.
6. Watch the marker glide, `Near …` update, and the ETA recalculate. Nothing is refreshed by hand.
7. Press **Drop GPS** in the demo console → passenger sees **Connection lost**, `Last updated 33 sec ago`, the last known position, and `ETA unavailable`.

**The app ships empty.** There are no built-in routes and no built-in jeepneys: the admin draws every
route and registers every jeepney, and an empty install shows real first-run empty states on every screen
(`16–17` in the contact sheet). For demos and regression runs the sample dataset lives in `data/demo.json`
and is loaded through the public API on demand:

```
node tools/load_demo.js --simulate    # 6 routes (incl. loop "Bajada Loop"), 4 jeepneys, DEV simulators on
node tools/load_demo.js --clear       # wipe every route + jeepney again
```

`data/seed.json` holds only the 16 searchable destinations; `tools/uitest.js` loads the sample dataset
itself and finishes with `POST /api/reset`, so a test run always leaves the app in its empty shipping
state. The simulator stays DEV-only (spec §66): simulated jeepneys carry a `DEV` tag, and none of them
exist until a human loads the sample data.

---

## How it works

```
GPS PHONE  ──POST /api/devices/:id/location (≈2 s)──►  NODE BACKEND  ──SSE /api/events──►  PASSENGER (map, ETA, landmark)
                                                          │
                                                          └──────────────────────────►  ADMIN (live map, status)
```

- **Zero dependencies.** One Node HTTP server: REST + GPS ingest + static files.
- **Backend is the single source of truth** (§101). Live pushes patch screens in place; where a screen is rebuilt
  on a store push, the scroll offset of every scrolling container is captured and restored first, so a new GPS fix
  never yanks the reader back to the top of a list. Position smoothing, route progress, landmark matching and ETA are computed once, server-side, and pushed over Server-Sent Events. No screen ever polls manually; if the stream drops, the client falls back to polling and shows the global "Unable to connect" banner with a Retry action.
- **Shared engine:** `public/js/geo.js` is loaded by *both* the browser and Node, so client and server can never disagree on distance/ETA.
- **Landmark matching:** nearest *named stop of the jeepney's own route* within 400 m, otherwise `En route` — never a landmark from another part of the city.
- **ETA:** remaining **road** distance along the route path ÷ current average speed (fallback 18 km/h on stop-and-go), displayed "*< 1 min.* / *4 mins.*" and refreshed at most every ~20 s so it does not flicker.
- **Smoothing & animation:** fixes are lightly smoothed server-side; the map interpolates marker movement (600–2000 ms) so GPS jitter never looks like teleporting.
- **Implausible fixes are rejected**, not drawn: a reading implying > 110 km/h (and further than the accuracy circle allows) is dropped (spec §24/§29).
- **Average speed** is distance actually travelled ÷ elapsed time over a rolling ~60 s window (never a single raw segment), eased so the readout cannot jump (spec §26-§28); the first seconds report `ETA calculating…` rather than a guess.
- **Off-route warning**: if the projection onto the route path is more than 250 m away, the tracking card and the jeepney detail say the vehicle may be detouring (spec §157-§158).
- **Landmark hysteresis**: "Near X" holds until a different stop is clearly closer, so the caption does not flicker at the radius edge (spec §97).
- **Loop routes:** no special logic — the route is `A → B → C → A`, `endPoint == startPoint`, and progress wraps.
- **Persistence:** `data/state.json` (auto-created) survives restarts; delete it to return to the seed. Simulated jeepneys resume after a restart.

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state` | routes, destinations, devices (derived: ETA, landmark, progress) |
| GET | `/api/events` | SSE stream: `state`, `loc`, `devices` events |
| GET/POST | `/api/routes` | list / create route |
| GET/PUT/DELETE | `/api/routes/:id` | read / update / delete route |
| GET/POST | `/api/devices` | list / create GPS device |
| GET/PUT/DELETE | `/api/devices/:id` | read / update / delete device |
| POST | `/api/devices/:id/location` | **GPS ingest from the phone** |
| POST | `/api/devices/:id/tracking` | start/stop driver mode |
| POST | `/api/devices/:id/simulate` | start/stop the route simulator |
| POST | `/api/devices/:id/place` | jump the device to a % of its route |
| POST | `/api/road-route` | OSRM proxy used by the route editor (straight-line fallback offline) |
| GET/POST | `/api/destinations` | destination list / create |
| POST | `/api/admin/login` | admin login (MVP-level auth) |
| POST | `/api/reset` | restore the seeded demo data |

### Data model

```
Route   { id, name, active, startPoint{lat,lng,name}, endPoint{…}, stops[], path[{lat,lng}], corridor[{lat,lng}], distanceM, isLoop, createdAt }
Stop    { id, routeId, name, latitude, longitude, order, type: start|stop|landmark|endpoint }
Device  { id, name, routeId, type, active, phone, position, speedKmh, heading, lastUpdated, … }
```

### Tuning constants (top of `server.js`)

| Constant | Default | Meaning |
|---|---|---|
| `onlineMs` | 12000 | no fix within this window → **Connecting** |
| `staleMs` | 30000 | no fix within this window → **Offline** |
| `landmarkRadiusM` | 400 | "Near X" matching radius |
| `etaRefreshMs` | 20000 | how often the displayed ETA may change |
| `speedWindowMs` | 60000 | rolling window for the observed average speed |
| `maxPlausibleKmh` | 110 | faster than this = GPS outlier, dropped |
| `maxAccuracyM` | 120 | fixes worse than this never drive the maths |
| `offRouteToleranceM` | 250 | beyond this the vehicle may be off its route |

---

## Testing

```bash
node server.js &                  # keep the backend up
node tools/uitest.js              # 90-check headless walkthrough (loads the sample data itself)
node tools/qa_release.js          # 64-check data-flow gate on real telemetry, no simulator
node tools/qa_browser.js          # 71-check browser gate: two-view sync, offline, arrival, map pick, viewports
```

`tools/uitest.js` drives the real app in headless Chromium and proves: splash → role → map tiles + markers →
destination search → nearby ETA → live tracking (**marker moves with no refresh**, `Near <landmark>` shown) →
routes/route detail → saved placeholder → **one-tap admin entry (no password field)** → route list/detail →
**route creation with map taps + generated path + save** → **corridor area (3 corner points → handles → undo → redo → saved polygon)** →
**unsaved-changes guard** → **deleting a route leaves its jeepney alive and unassigned** → jeepney list/detail →
**DEV simulator labelling** → driver mode → admin live map → **connection lost with last known position** →
**empty states**, **ETA copy (`ETA calculating…` / `ETA unavailable` / `< 1 min.` / `150 m away` / `1.2 km away`)**,
**no horizontal overflow at 360/390/412 px on four screens**, **every app tap target ≥ 44 px**,
**list scroll position survives live updates (nothing snaps back to the top)**, and no unexpected JavaScript errors.
It also asserts the three new behaviours on real telemetry: the **"Your ride is here! Mabuhay!"** banner and
toast (with a negative case 3 km away), **picking a destination on the map** (pin → confirm → matching
jeepney found → the built-in search still works afterwards), and **drawing a route line by dragging**. It writes annotated screenshots (`screenshots/uit-*.png`), a machine-readable
`screenshots/uitest-report.json`, and cleans up after itself.

### Release gate (what CI should run)

| Command | What it proves |
| --- | --- |
| `node tools/uitest.js` | every screen renders, admin CRUD works, tap targets, no console errors |
| `node tools/qa_release.js` | the data chain with **no simulator**: admin creates route + jeepney → a phone posts real fixes → position/route-progress/distance/smoothed speed/ETA/landmark are asserted against what was sent, outliers and malformed frames are rejected, telemetry silence flips the device offline with its last known fix kept, resume works, reassignment leaves no stale route, loop routes wrap, delete cascades cleanly |
| `node tools/qa_release.js --verify-persist` | restart the backend, then re-run: routes, jeepneys and assignments survived; ends by wiping the fixtures |
| `node tools/qa_browser.js` | passenger and admin views show the *same* vehicle and both update with no refresh, `Connection lost` + `Last updated N sec ago` appear on both, cold deep links hydrate, the arrival banner fires at 45 m and stays silent at 3 km, a map-dropped pin is matched to the jeepneys that pass it, a dragged line becomes route geometry, five viewports (360/390/393/412/430) have no overflow or hidden content, 44 px targets, SSE subscriptions are released when leaving screens, and the app degrades to the "Unable to connect" banner with the backend down |

Both QA scripts use real telemetry posts (`/api/devices/:id/location`) and never the simulator, so a green
run means the production tracking path itself was exercised.

**Screens vs. the reference deck:** `screenshots/dabound-screens-overview.png` is the 23-screen contact sheet
(01 splash, 02 role, 03 map, 04 search, 05 nearby, 06 tracking, 07 routes tab, 08 route detail, 09 saved,
10 admin entry, 11 admin profile, 12 admin route list, 13 admin route detail, 14 admin route editor,
15 jeepney list, 16 jeepney detail, 17 live map, 18 first-run map, 19 first-run route list,
20 tracking connection lost, **21 "Your ride is here! Mabuhay!", 22 destination picked on the map,
23 route line drawn by dragging**); individual captures are `screenshots/dabound-NN-*.png`. `03–17` and
`21–23` show the app with the sample dataset loaded, `18–20` show a fresh install and the connection-lost
state. `screenshots/uit-ride-here.png`, `uit-pick-pin.png` and `uit-drawn-route.png` are the browser gate's
own captures of the three new behaviours.

Requires `playwright` (dev-only): `npm i playwright && npx playwright install chromium`.
`tools/build_seed.js` regenerates `data/seed.json` with fresh OSRM road geometry (needs internet);
`tools/add_corridors.js` writes the ~110 m corridor polygon for every seeded route into `data/seed.json`.

---

## Known limits / next steps

- **Foreground GPS only.** Driver mode must stay on screen (spec §60 allows this for the MVP); background tracking is the next step for a real deployment.
- **Map tiles and road geometry need internet.** Tiles degrade to a labelled grey canvas with a "Map tiles unavailable" note; the route editor falls back to straight-line geometry.
- **No admin account by design** (spec §3/§144): the launch screen's *Admin* button is the only gate. A real deployment needs authentication before any public use; the `POST /api/admin/login` endpoint is kept for that.
- **One-way travel on non-loop routes**: when the jeepney reaches the terminal the simulator pauses and restarts from the start; loop routes wrap naturally.
- **Destination → route mapping is admin/manual data**, not transit routing (§89).
