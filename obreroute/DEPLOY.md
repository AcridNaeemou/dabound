# Deploying DaBound — go-live guide

DaBound is one Node process that serves **both** the API and the app, with **zero npm dependencies**
(the only dev dependency is Playwright for the test gates, and that never ships). So going public is
mostly about choosing a host and getting HTTPS.

---

## 0. What the app needs (so you know what to look for)

| Need | Why | How it is satisfied |
| --- | --- | --- |
| Node 18+ | runs `server.js` | any host (Dockerfile included) |
| **HTTPS** | browsers refuse GPS on plain `http://` (except `localhost`) | every host below issues it free |
| Outbound internet | OpenStreetMap tiles + the OSRM road-geometry proxy | nothing to configure |
| A writable folder | live state: routes, jeepneys, assignments → `state.json` | `DATA_DIR` env var (default `./data`) |
| One open port | the whole app on one origin (no CORS to fight) | `PORT` env var (hosts set it for you) |

Environment variables the server understands:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port (Render/Fly/Railway set this themselves) |
| `HOST` | `0.0.0.0` | bind address (leave it) |
| `DATA_DIR` | `./data` | where `state.json` is written — point this at a volume to keep data across restarts |
| `ADMIN_KEY` | *unset* | **set it before sharing the link.** Every write (`POST`/`PUT`/`DELETE`) then needs the key; reads stay public |
| `SUPABASE_URL` | *unset* | your Supabase project URL — set it **with** the key below to keep the data in Postgres (section 6) |
| `SUPABASE_SERVICE_KEY` | *unset* | the Supabase **service_role** secret. Server-side only — it never reaches a browser |

If `DATA_DIR` is empty on first boot, the 16 destinations still load from the copy inside the app
(`data/seed.json`) — verified — so a fresh volume never starts with an empty search.

---

## 1. Put the code in Git (2 minutes)

```bash
cd /home/user/obreroute
git init
git add -A
git commit -m "DaBound MVP"
```

Create an empty repo on GitHub, then:

```bash
git remote add origin git@github.com:<you>/dabound.git
git push -u origin main
```

You do not paste anything by hand: `git add -A` stages every file that `.gitignore` does not exclude.
For this project that is **65 files ≈ 15 MB** — of which only **≈ 800 KB is the actual app**; the rest is
presentation screenshots. `node_modules/` (12 MB), `data/state.json` (your live data) and the regenerable
`screenshots/uit-*.png` stay out. To leave the screenshots out too, uncomment the `screenshots/` line at the
bottom of `.gitignore`.

> You can skip Git if you use the Fly track (it deploys the folder you are standing in).

---

## 2. Pick a host

### Track A — Render (easiest, has a free tier)

1. Render dashboard → **New → Web Service** → connect the repo you just pushed.
2. Runtime **Node**, Build Command `npm install` (there are no dependencies — it finishes instantly),
   Start Command `node server.js`.
3. **Fill the form exactly like this**

| Field | Value |
| --- | --- |
| Name | `dabound` (this becomes `dabound.onrender.com`) |
| Language / Runtime | **Node** (auto-detected from `package.json`) |
| Branch | `main` |
| Root Directory | **leave empty** — unless `server.js` sits in a sub-folder of your repo, then type that folder name |
| Build Command | `npm install` (no dependencies — it finishes in seconds) |
| Start Command | `node server.js` |
| Instance Type | **Free** to try, **Starter** if you want a disk (see step 5) |
| Health Check Path | `/api/health` |
| Environment Variables | `ADMIN_KEY` = a long random string (`openssl rand -hex 16`) — recommended the moment the URL is public. Do **not** set `PORT`; Render provides it |

4. **Create Web Service.** Watch the log: `Cloning…` → `Installing dependencies…` → `DaBound backend ready`
   → *Your service is live*. Your HTTPS link is at the top of the page (takes ~2 minutes).
5. **Persistence (recommended):** the free plan has an **ephemeral disk** — routes and jeepneys
   disappear whenever the service restarts, redeploys or wakes from sleep (the 16 destinations come back
   from the seeded list). To keep real data: switch the instance to Starter, then
   **Settings → Disks → Add Disk** (Name `dabound-data`, Mount Path `/var/data`, 1 GB), add the
   environment variable `DATA_DIR=/var/data`, and save — the service redeploys and now remembers
   everything across restarts.
6. **Want the sample routes on the live site?** From your own computer:
   `ADMIN_KEY=<your key> node tools/load_demo.js https://dabound.onrender.com --simulate`
   (the simulators are the `DEV`-tagged jeepneys; tap them off per jeepney in the app).

### Track B — Fly.io (cheap, real volume, Singapore region → low latency from Davao)

> Fly has no Git requirement: `fly launch` uploads **the folder you are standing in** and builds the
> Dockerfile. If you would rather not use GitHub at all, this is the track for you.

```bash
fly launch --no-deploy                       # detects the Dockerfile, pick region sin (Singapore)
fly volumes create dabound_data --size 1 --region sin
```

Add to the generated `fly.toml`:

```toml
[mounts]
  source = "dabound_data"
  destination = "/app/data"

[env]
  DATA_DIR = "/app/data"
```

```bash
fly secrets set ADMIN_KEY=$(openssl rand -hex 16)
fly deploy
fly open                                     # https://<app>.fly.dev
```

Keep one always-on shared-cpu-1x machine (a few dollars a month) — or `fly machine stop` when idle
and `fly machine start` before a demo.

### Track C — your own VPS + Docker + Caddy (full control, own domain)

On an Ubuntu 24.04 box (DigitalOcean / Hetzner / Linode / local PH provider, ~$5/mo), after
installing Docker:

```bash
git clone <your repo> dabound && cd dabound
docker build -t dabound .
docker run -d --name dabound --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v dabound-data:/app/data \
  -e ADMIN_KEY="$(openssl rand -hex 16)" \
  dabound
```

`/etc/caddy/Caddyfile` (Caddy fetches the certificate automatically):

```caddyfile
dabound.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Firewall: allow 22, 80, 443 only. If you use nginx instead, add `proxy_buffering off;` for
`/api/events` — that is the live-position stream (SSE).

> Prefer no host at all? `./start.sh` runs it on your laptop and prints the Wi-Fi URL — fine for a
> classroom demo, but a phone can only use its GPS when the page is served over HTTPS or localhost,
> so real phone tracking needs one of the tracks above.

---

## 3. Domain name (optional, ~$10/year)

1. Buy from Namecheap / Porkbun (or `.ph` from dot.ph).
2. **Render/Fly:** dashboard → *Custom Domain* → it shows the exact `CNAME`/`A` record → create it at
   your registrar. HTTPS is issued automatically.
3. **VPS:** point an `A` record at the server IP and put the hostname in the `Caddyfile` (above).

---

## 4. Lock it down **before** you share the link

By design there are no accounts (spec §3): the admin area is one tap. On a public URL that means
**anyone who finds the app can create or delete routes**. Two ways to handle that:

| Option | What it does | How |
| --- | --- | --- |
| `ADMIN_KEY` (built in) | every write needs the key; reads (passenger side, driver telemetry aside) stay open | set the env var; the first time you press **Save** — or a phone posts its GPS in Driver mode — DaBound asks for the key once and remembers it on that device (`localStorage`) |
| Cloudflare Tunnel + Access | the whole site sits behind a login you control (free for small teams) | run `cloudflared` on the server instead of exposing port 443, protect the hostname in the Zero Trust dashboard |

Rotate the key by changing the env var — every device is asked again. `POST /api/reset` (wipe) is a
write, so it is protected too.

Verified on a locked instance (`ADMIN_KEY=letmein`):

```
GET  /api/state                → 200 (16 destinations, no key needed)
POST /api/routes   (no key)    → 401 {"error":"This DaBound deployment is locked. Enter the admin key.","adminKeyRequired":true}
POST /api/routes   (x-admin-key) → 201 created
restart with the same DATA_DIR → the created route is still there
```

---

## 5. Go-live smoke test (5 minutes, do it on the real URL)

- [ ] `https://your-url/api/health` answers `{"ok":true,…}`
- [ ] the map renders tiles and the top box finds destinations ("bajada" → results)
- [ ] Admin → **Route List → New route**, name it, `Set Start` → `Add Stop` → `Set Endpoint`,
      `Generate Path`, **Save** → the key is asked once, then the route exists
- [ ] Admin → **Jeepney Info → New jeepney**, assign that route, open it, tap **Open tracking mode**
- [ ] open the passenger view on a second phone: it asks for location → "You are here" appears and the
      jeepney moves with no refresh
- [ ] stop the driver tab for ~15 s → both sides say **Connection lost** and keep the last position
- [ ] restart the host (or redeploy): your route and jeepney are still there (that is the disk/volume)

---

## 6. Keep the data in Supabase (free tier) — optional, about 5 minutes

A host without a disk keeps `state.json` inside the container, so **everything the admin creates is lost
when it spins down or redeploys.** Supabase (hosted Postgres) fixes that. There is nothing to install:
the server talks to Supabase over plain HTTPS with `fetch`, so the app stays dependency-free.

**What you need from Supabase (one-time setup):**

1. Create a free account + project at <https://supabase.com/dashboard> — pick the **Singapore** region
   if you are in Davao (lowest latency). Any region works.
2. In the dashboard open **SQL Editor → New query**, paste the whole of
   [`tools/supabase_schema.sql`](tools/supabase_schema.sql), press **Run**. It is idempotent (safe to run
   twice) and creates three tables — `routes`, `jeepneys`, `destinations` — with row-level security on and
   **no policies**, which means only the service key (your backend) can read or write them.
3. Open **Project Settings → API** and copy two values:
   * **Project URL** — looks like `https://abcdefgh.supabase.co`
   * **service_role** secret — the long key under "Project API keys" (not the `anon` key)
4. Set them as environment variables on your host (Render → your service → **Environment**):

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | the Project URL from step 3 |
   | `SUPABASE_SERVICE_KEY` | the service_role secret from step 3 |

   Keep `ADMIN_KEY` exactly as it is. Save — the service redeploys with the database attached.
5. Check it: open `https://<your-app>/api/health`. You want
   `"storage": { "driver": "supabase", "ok": true, "loaded": true }`. If it says `"ok": false`, the
   `lastError` field tells you why (wrong key, wrong URL, or the SQL was not run).

Running locally is the same two variables before `node server.js`.

**What changes once it is on**

* **Boot:** the local file loads first (instant), then the database hydrates routes, jeepneys and
  destinations. A brand-new empty project gets the 16 destination suggestions written to it — never
  invented routes or jeepneys.
* **Writes:** every admin change (route, stop, jeepney, assignment, delete) is mirrored within about a
  second. The GPS stream only refreshes each jeepney's *last known position* (about every 9 s), so the
  tables stay tiny — one row per route / jeepney / destination.
* **Unreachable database:** the app keeps serving from memory and the local file, and reports
  `storage.ok: false` with the reason. It never pretends a save happened. When the database comes back
  it reconnects and pushes the session's data.
* **Shutdown:** on `SIGTERM` (a redeploy or a free-tier spin-down) pending writes are flushed first, so
  the last save is not lost.
* **Secrets:** the service_role key is used only by `server.js`. Browsers talk to your own backend.

Verified end-to-end against a local PostgREST stand-in (`node tools/qa_storage.js` → **29/29**): boot
hydrate, empty-project seeding, config + position writes, a wiped disk restarting from the database,
honest outage reporting, reconnect, and the shutdown flush.

**Free-tier reality check:** 500 MB database, 5 GB egress and projects pause after ~a week of no
activity (a paused project is not deleted — the app simply reports "not connected" until you wake it in
the dashboard). DaBound stores a few kilobytes, so the ceiling is nowhere near it.

---

## 7. Things worth knowing

* **Map tiles** come from OpenStreetMap's public tile server. Fine for a class/cohort deployment;
  if traffic grows, switch to your own tiles or a paid tile provider (the attribution is already in
  the map corner).
* **GPS needs the page to stay in the foreground.** A locked phone stops reporting — the connection
  state is honest about it (that is the MVP scope).
* **Free tiers sleep.** Render's free plan spins down after ~15 minutes idle, so the first hit is slow.
  Wake it before a demo.
* **Where the bytes live:** `state.json` in `DATA_DIR` (always written) plus, when `SUPABASE_URL` and
  `SUPABASE_SERVICE_KEY` are set, a Postgres mirror that is loaded back at boot (section 6). A host with
  a disk needs no database; a free host without one should use Supabase.
* **Do not ship `node_modules/`.** It is only there for the Playwright test gates; `.gitignore` and
  `.dockerignore` already exclude it.

---

## 8. The whole thing in six commands (Fly track)

```bash
git init && git add -A && git commit -m "DaBound MVP"      # in /home/user/obreroute
fly launch --no-deploy                                     # region: sin
fly volumes create dabound_data --size 1 --region sin       # + [mounts]/[env] block in fly.toml
fly secrets set ADMIN_KEY="$(openssl rand -hex 16)"
fly deploy
fly open                                                   # share this HTTPS link
```
