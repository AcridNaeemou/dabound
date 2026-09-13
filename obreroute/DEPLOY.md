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
3. **Environment → Add Environment Variable:** `ADMIN_KEY` = a long random string
   (`openssl rand -hex 16`).
4. **Create Web Service.** You get `https://<name>.onrender.com` with a valid certificate in ~2 minutes.
5. **Persistence (recommended):** the free plan has an **ephemeral disk** — routes and jeepneys
   disappear on every restart/redeploy (destinations come back from the seed). To keep them:
   upgrade the instance and add a **Disk** with mount path `/var/data`, then set `DATA_DIR=/var/data`.

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

## 6. Things worth knowing

* **Map tiles** come from OpenStreetMap's public tile server. Fine for a class/cohort deployment;
  if traffic grows, switch to your own tiles or a paid tile provider (the attribution is already in
  the map corner).
* **GPS needs the page to stay in the foreground.** A locked phone stops reporting — the connection
  state is honest about it (that is the MVP scope).
* **Free tiers sleep.** Render's free plan spins down after ~15 minutes idle, so the first hit is slow.
  Wake it before a demo.
* **`state.json` is the single source of truth.** Back it up (`docker cp dabound:/app/data/state.json .`
  or a volume snapshot) if the data matters. Swapping to Postgres/Supabase later only touches
  `loadState()` / `persist()` in `server.js` — nothing else in the app knows where the bytes live.
* **Do not ship `node_modules/`.** It is only there for the Playwright test gates; `.gitignore` and
  `.dockerignore` already exclude it.

---

## 7. The whole thing in six commands (Fly track)

```bash
git init && git add -A && git commit -m "DaBound MVP"      # in /home/user/obreroute
fly launch --no-deploy                                     # region: sin
fly volumes create dabound_data --size 1 --region sin       # + [mounts]/[env] block in fly.toml
fly secrets set ADMIN_KEY="$(openssl rand -hex 16)"
fly deploy
fly open                                                   # share this HTTPS link
```
