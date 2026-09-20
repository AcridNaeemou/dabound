#!/usr/bin/env node
/**
 * DaBound backend — zero-dependency Node.js server.
 *
 * Responsibilities (spec §44-48, §101):
 *   • REST CRUD for routes, GPS devices/jeepneys and destinations
 *   • GPS ingest endpoint for the cohort member's smartphone
 *   • Server-side position smoothing + route progress + landmark + ETA
 *   • Server-Sent Events push so passengers and admin receive the latest
 *     position WITHOUT refreshing — the backend is the single source of truth
 *   • A built-in route simulator so the demo works even without a second phone
 *
 * Run:  node server.js            (PORT env overrides, default 8080)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const Geo = require('./public/js/geo.js');

/* Minimal .env loader — the app has no dependencies, so it does not pull in
 * dotenv. Existing environment variables always win, which keeps host-level
 * config (Render, Fly, Docker) authoritative over a local file. */
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch (e) {
    return; // no .env is normal — everything can come from the real environment
  }
  text.split(/\r?\n/).forEach((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) return;
    const key = m[1];
    if (process.env[key] != null && process.env[key] !== '') return;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  });
})();

const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// DATA_DIR lets a host mount a persistent volume anywhere (or point at a disk)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
// The admin area is unlocked with a simple shared PIN. It defaults to ObreRoute so
// every deployment is PIN-protected out of the box; ADMIN_KEY overrides it, and
// ADMIN_KEY=none opens the demo back up to one-tap admin (spec §3) for local work.
// Reads stay public either way; writes and admin entry need the PIN.
const RAW_ADMIN_KEY = process.env.ADMIN_KEY || '';
const ADMIN_KEY = RAW_ADMIN_KEY === 'none' ? '' : (RAW_ADMIN_KEY || 'ObreRoute');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* Durable storage (optional). With SUPABASE_URL + SUPABASE_SERVICE_KEY set, every
 * change is mirrored into Postgres through Supabase's REST API, so routes, jeepneys
 * and destinations survive a redeploy, a free-tier spin-down or a wiped disk.
 * Without them the app keeps using the JSON file in DATA_DIR (local development).
 * The service_role key stays on the server: the browser never talks to Supabase. */
const SB_URL = (process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const SB_ON = !!(SB_URL && SB_KEY);
const SB_TABLES = { routes: 'routes', devices: 'jeepneys', destinations: 'destinations' };
const storage = {
  driver: SB_ON ? 'supabase' : 'file',
  ok: true, loaded: false, dirty: false, pending: 0,
  lastError: null, lastWriteAt: null, lastLoadAt: null,
};

// --- tunables (§44, §56, §87) -----------------------------------------------
const CONFIG = {
  onlineMs: 12000,       // no fix within this window -> connecting
  staleMs: 30000,        // no fix within this window -> offline
  speedWindowMs: 60000,  // rolling window for the observed average speed (spec 28)
  maxPlausibleKmh: 110,  // faster than this = GPS outlier, not a jeepney (spec 29)
  maxAccuracyM: 120,     // fixes worse than this only move the marker, never the maths
  offRouteToleranceM: 250, // beyond this the vehicle may be off its route (spec 157)
  landmarkRadiusM: 400,  // "Near X" matching radius
  serverTickMs: 1000,
  simulatorTickMs: 1000,
  etaRefreshMs: 20000,
};

// --- numeric input hygiene ---------------------------------------------------
// `+null`, `+''`, `+false` and `+[]` all coerce to 0, and 0 is a perfectly valid
// latitude/longitude. Reading a coordinate that way let a blank GPS frame place a
// jeepney at "Null Island" (0,0) in the Gulf of Guinea — ~13,000 km off its route —
// because the implausible-jump guard only runs when a previous fix exists.
// num() returns NaN for anything that is not a real number or a numeric string.
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return +v;
  return NaN;
}

/** True when lat/lng are finite numbers inside the real-world coordinate range. */
function coordsOk(lat, lng) {
  return (
    isFinite(lat) && isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/** Heading in [0,360). Anything else would spin the map marker to a random angle. */
function normHeading(v) {
  const h = num(v);
  if (!isFinite(h)) return null;
  return ((h % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
let state = {
  routes: [],
  destinations: [],
  devices: {},
  deviceOrder: [],
  locationHistory: {}, // deviceId -> last N fixes (kept tiny, §47)
  meta: { seamSeeded: false },
};

const preparedCache = new Map(); // routeId -> {prep, metrics, rev}
const routeRev = new Map();
const roadCache = new Map(); // road-route request key -> geometry

function prepFor(route) {
  const cached = preparedCache.get(route.id);
  if (cached && cached.rev === routeRev.get(route.id)) return cached;
  const prep = Geo.prepare(route.path || []);
  const metrics = Geo.stopMetrics(route, prep);
  const entry = { prep: prep, metrics: metrics, rev: routeRev.get(route.id) };
  preparedCache.set(route.id, entry);
  return entry;
}

function bustRoute(id) {
  routeRev.set(id, (routeRev.get(id) || 0) + 1);
}

function heldLandmark(dev, derived) {
  if (dev.landmarkId) {
    const route = state.routes.find((r) => r.id === dev.routeId);
    const stop = route && (route.stops || []).find((st) => st.id === dev.landmarkId);
    const pos = dev.smoothed || dev.lastFix;
    if (stop && pos) {
      return {
        id: stop.id,
        name: stop.name,
        distM: Math.round(Geo.haversine({ lat: stop.latitude, lng: stop.longitude }, pos)),
        type: stop.type,
      };
    }
  }
  return derived ? derived.landmark : null;
}

function computeDerived(route, position, sHint, isLoop) {
  const { prep, metrics } = prepFor(route);
  const total = prep.totalM || 0;
  const pr = Geo.project(prep, position, sHint, 1500, isLoop);
  let s = pr.s;
  if (isLoop && total > 0) s = Math.min(s, total);
  const ahead = metrics.filter((m) => m.s > s + 20);
  const next = ahead.length
    ? ahead[0]
    : isLoop && metrics.length
    ? { stop: metrics[0].stop, s: metrics[0].s + total }
    : metrics.length
    ? metrics[metrics.length - 1]
    : null;
  const remaining = next ? Math.max(0, next.s - s) : Math.max(0, total - s);
  const landmark = Geo.landmarkNear(route, position, CONFIG.landmarkRadiusM);
  return {
    s: s,
    offRouteM: pr.offM,
    routeTotalM: total,
    nextStop: next ? { id: next.stop.id, name: next.stop.name, s: next.s } : null,
    remainingToNextStopM: remaining,
    remainingToEndM: isLoop ? (total - s) : Math.max(0, total - s),
    landmark: landmark ? { id: landmark.stop.id, name: landmark.stop.name, distM: landmark.distM, type: landmark.stop.type } : null,
    stats: metrics.map((m) => ({ stop: m.stop, s: m.s })),
  };
}

function statusFor(device, now) {
  if (!device.active) return 'inactive';
  if (!device.lastUpdated) return 'offline';
  const age = now - device.lastUpdated;
  if (age <= CONFIG.onlineMs) return 'online';
  if (age <= CONFIG.staleMs) return 'connecting';
  return 'offline';
}

function publicDevice(dev, now) {
  now = now || Date.now();
  const route = state.routes.find((r) => r.id === dev.routeId) || null;
  const status = statusFor(dev, now);
  const position = dev.smoothed || dev.lastFix || null;
  let derived = null;
  if (route && position) {
    try {
      derived = computeDerived(route, position, dev.s, !!route.isLoop);
    } catch (e) {
      derived = null;
    }
  }
  const speedKmh = dev.speedKmh || 0;
  const etaSecToNext =
    derived && derived.remainingToNextStopM != null
      ? Geo.etaSec(derived.remainingToNextStopM, speedKmh)
      : null;
  const etaSecToEnd =
    derived && derived.remainingToEndM != null ? Geo.etaSec(derived.remainingToEndM, speedKmh) : null;
  return {
    id: dev.id,
    name: dev.name,
    routeId: dev.routeId,
    routeName: route ? route.name : null,
    type: dev.type,
    driver: dev.driver || '',
    color: dev.color || null,
    color2: dev.color2 || null,
    active: dev.active,
    status: status,
    online: status === 'online',
    tracking: !!dev.tracking,
    simulated: !!dev.simulated,
    phone: dev.phone || '',
    position: position,
    rawPosition: dev.lastFix || null,
    speedKmh: speedKmh,
    heading: dev.heading != null ? dev.heading : derived ? Geo.headingAt(prepFor(route).prep, derived.s) : 0,
    accuracy: dev.accuracy != null ? dev.accuracy : null,
    lastUpdated: dev.lastUpdated || null,
    ageMs: dev.lastUpdated ? now - dev.lastUpdated : null,
    speedWindowSec: dev.speedWindowSec || 0,
    speedReady: (dev.speedWindowSec || 0) >= 8,
    offRouteM: derived && derived.offRouteM != null && isFinite(derived.offRouteM) ? Math.round(derived.offRouteM) : null,
    offRoute: !!(derived && isFinite(derived.offRouteM) && derived.offRouteM > CONFIG.offRouteToleranceM),
    s: derived && isFinite(derived.s) ? Math.round(derived.s) : null,
    routeTotalM: derived ? Math.round(derived.routeTotalM) : route ? Math.round(prepFor(route).prep.totalM) : null,
    progressPct: derived && derived.routeTotalM ? Math.round(Math.min(100, (derived.s / derived.routeTotalM) * 100) * 10) / 10 : null,
    landmark: heldLandmark(dev, derived),
    nextStop: derived ? derived.nextStop : null,
    distanceToNextStopM: derived && isFinite(derived.remainingToNextStopM) ? Math.round(derived.remainingToNextStopM) : null,
    distanceToEndM: derived && isFinite(derived.remainingToEndM) ? Math.round(derived.remainingToEndM) : null,
    etaSecToNextStop: etaSecToNext != null && isFinite(etaSecToNext) ? Math.round(etaSecToNext) : null,
    etaSecToEnd: etaSecToEnd != null && isFinite(etaSecToEnd) ? Math.round(etaSecToEnd) : null,
    arrived: !!(derived && derived.remainingToEndM != null && derived.remainingToEndM < 30 && status === 'online'),
  };
}

function snapshot(now) {
  now = now || Date.now();
  return {
    serverTime: now,
    config: {
      onlineMs: CONFIG.onlineMs,
      staleMs: CONFIG.staleMs,
      landmarkRadiusM: CONFIG.landmarkRadiusM,
      etaRefreshMs: CONFIG.etaRefreshMs,
      hasSimulator: true,
      adminKeyRequired: !!ADMIN_KEY,
      storage: storagePublic(),
    },
    routes: state.routes,
    destinations: state.destinations,
    devices: state.deviceOrder
      .map((id) => state.devices[id])
      .filter(Boolean)
      .map((d) => publicDevice(d, now)),
  };
}

function deviceProjection(d) {
  return {
    id: d.id, name: d.name, routeId: d.routeId, type: d.type, active: d.active,
    phone: d.phone || '', driver: d.driver || '', color: d.color || null, color2: d.color2 || null,
    simulated: !!d.simulated, tracking: !!d.tracking,
    lastFix: d.lastFix || null, smoothed: d.smoothed || null, s: d.s || 0,
    speedKmh: d.speedKmh || 0, heading: d.heading || 0, lastUpdated: d.lastUpdated || null,
  };
}

function writeStateFile() {
  const out = {
    savedAt: new Date().toISOString(),
    routes: state.routes,
    destinations: state.destinations,
    devices: state.deviceOrder.map((id) => deviceProjection(state.devices[id])),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 1));
  } catch (err) {
    // a read-only or full disk must not take the live app down: it keeps
    // serving from memory and says so once per failure (hosting safety net)
    console.error('state save failed (still serving from memory):', err.message);
  }
}

let saveTimer = null, cfgTimer = null, posTimer = null;
let saveQueuedAt = 0, posQueuedAt = 0;

/* persist() is the single write point of the app: the local file is always kept as
 * a cache, and the database mirror piggybacks on it — configuration is written a
 * moment later, the GPS stream only refreshes the last known position.
 *
 * The debounce has a hard cap. A pure reset-on-every-call debounce never fires
 * while a big fleet keeps reporting (fixes arrive faster than the delay), which
 * would keep everything — including an admin's route edits made mid-run — off
 * the disk for as long as the traffic flows. Once a write has waited longer
 * than the cap it is scheduled immediately instead of being pushed again. */
const SAVE_DELAY_MS = 800;
const SAVE_CAP_MS = 5000;
const POS_DELAY_MS = 9000;
const POS_CAP_MS = 30000;

function persist(opts) {
  const now = Date.now();
  if (!saveQueuedAt) saveQueuedAt = now;
  clearTimeout(saveTimer);
  if (now - saveQueuedAt >= SAVE_CAP_MS) {
    saveQueuedAt = 0;
    saveTimer = setTimeout(writeStateFile, 0);
  } else {
    saveTimer = setTimeout(() => { saveQueuedAt = 0; writeStateFile(); }, SAVE_DELAY_MS);
  }
  if (!SB_ON) return;
  if (opts && opts.positions) {
    if (!posQueuedAt) posQueuedAt = now;
    clearTimeout(posTimer);
    if (now - posQueuedAt >= POS_CAP_MS) {
      posQueuedAt = 0;
      posTimer = setTimeout(sdSyncPositions, 0);
    } else {
      posTimer = setTimeout(() => { posQueuedAt = 0; sdSyncPositions(); }, POS_DELAY_MS);
    }
    return;
  }
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(sdSyncConfig, 700);
}

/* ---------------------------------------------------------------------------
 * Supabase mirror (PostgREST over plain fetch — no npm dependencies)
 * ------------------------------------------------------------------------- */
function sbErrText(err) { return String((err && err.message) || err).slice(0, 220); }

async function sbReq(method, path, opts) {
  opts = opts || {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(SB_URL + '/rest/v1/' + path, {
      method: method,
      signal: ctrl.signal,
      headers: Object.assign(
        { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
        opts.prefer ? { Prefer: opts.prefer } : {}
      ),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(method + ' /' + path.split('?')[0] + ' -> HTTP ' + res.status + ' ' + text.slice(0, 160));
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

const sbList = async (table) => (await sbReq('GET', SB_TABLES[table] + '?select=id,data')) || [];

async function sbUpsert(table, rows) {
  if (!rows.length) return;
  await sbReq('POST', SB_TABLES[table], { body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
}

async function sbDeleteMissing(table, keepIds) {
  const filter = keepIds.length
    ? '?id=not.in.(' + keepIds.map((id) => '"' + String(id).replace(/["(),]/g, '') + '"').join(',') + ')'
    : '?id=not.is.null';
  await sbReq('DELETE', SB_TABLES[table] + filter, { prefer: 'return=minimal' });
}

const stamp = () => new Date().toISOString();
const routeRow = (r) => ({ id: r.id, name: r.name || '', data: r, updated_at: stamp() });
const destinationRow = (d) => ({ id: d.id, name: d.name || '', data: d, updated_at: stamp() });
const deviceRow = (d) => ({ id: d.id, name: d.name || '', route_id: d.routeId || null, active: d.active !== false, data: deviceProjection(d), updated_at: stamp() });
const myDeviceRows = () => state.deviceOrder.map((id) => state.devices[id]).filter(Boolean).map(deviceRow);

let lastStatusKey = '';
function noteStorageChange() {
  const key = storage.driver + '|' + storage.ok + '|' + (storage.lastError || '') + '|' + storage.pending;
  if (key === lastStatusKey) return;
  lastStatusKey = key;
  broadcastAll();
}

/* Write the whole configuration (routes, jeepneys, destinations). Rows deleted in
 * the app are deleted here too, so the database never drifts from the app. */
async function sdSyncConfig() {
  if (!SB_ON || storage.pending) return;
  if (!storage.loaded) { storage.dirty = true; return; } // never write before we know what the database holds
  storage.pending++;
  try {
    await sbUpsert('destinations', state.destinations.map(destinationRow));
    await sbDeleteMissing('destinations', state.destinations.map((d) => d.id));
    await sbUpsert('routes', state.routes.map(routeRow));
    await sbDeleteMissing('routes', state.routes.map((r) => r.id));
    await sbUpsert('devices', myDeviceRows());
    await sbDeleteMissing('devices', state.deviceOrder.slice());
    storage.ok = true; storage.lastError = null; storage.dirty = false; storage.lastWriteAt = Date.now();
  } catch (err) {
    storage.ok = false; storage.lastError = sbErrText(err); storage.dirty = true;
    console.error('supabase write failed (changes kept in memory, retrying):', storage.lastError);
  } finally {
    storage.pending--;
    noteStorageChange();
  }
}

/* The GPS stream only refreshes the last known position of each jeepney, so a
 * restart shows where they were last seen instead of an empty map. */
async function sdSyncPositions() {
  if (!SB_ON || !storage.loaded) return;
  try {
    await sbUpsert('devices', myDeviceRows());
    storage.ok = true; storage.lastError = null; storage.dirty = false; storage.lastWriteAt = Date.now();
  } catch (err) {
    storage.ok = false; storage.lastError = sbErrText(err);
  }
  noteStorageChange();
}

async function sdLoad() {
  const [routes, devices, destinations] = await Promise.all([sbList('routes'), sbList('devices'), sbList('destinations')]);
  return {
    routes: routes.map((r) => r.data).filter(Boolean),
    devices: devices.map((r) => r.data).filter(Boolean),
    destinations: destinations.map((d) => d.data).filter(Boolean),
  };
}

async function sdSeedDestinations() {
  if (!state.destinations.length) return 0;
  await sbUpsert('destinations', state.destinations.map(destinationRow));
  return state.destinations.length;
}

async function sdReset() {
  if (!SB_ON) return;
  await sbReq('DELETE', SB_TABLES.routes + '?id=not.is.null', { prefer: 'return=minimal' });
  await sbReq('DELETE', SB_TABLES.devices + '?id=not.is.null', { prefer: 'return=minimal' });
  await sbReq('DELETE', SB_TABLES.destinations + '?id=not.is.null', { prefer: 'return=minimal' });
  await sdSeedDestinations();
}

const storagePublic = () => ({
  driver: storage.driver, ok: storage.ok, loaded: storage.loaded,
  pending: storage.pending, lastError: storage.lastError, lastWriteAt: storage.lastWriteAt,
});

function loadState() {
  // The shipped seed is the source of the 16 destinations. A host that mounts an
  // empty disk at DATA_DIR still gets them from the copy inside the app folder.
  const seedPath = fs.existsSync(SEED_FILE) ? SEED_FILE : path.join(ROOT, 'data', 'seed.json');
  let seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  let saved = null;
  if (fs.existsSync(STATE_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.warn('state.json unreadable — falling back to seed');
    }
  }
  // seed.json ships EMPTY: routes and jeepneys are registered by the admin, so an
  // empty saved state is a legitimate state, not a reason to fall back to the seed.
  const routes = saved && Array.isArray(saved.routes) && saved.routes.length ? saved.routes : seed.routes || [];
  const destinations = saved && saved.destinations ? saved.destinations : seed.destinations || [];
  const devicesCfg =
    saved && Array.isArray(saved.devices) && saved.devices.length ? saved.devices : seed.devices || [];

  return mountState(routes, destinations, devicesCfg, { source: 'loaded' });
}

/* Mount a complete state — used by the boot path (local file / seed) and by the
 * Supabase load, so both produce exactly the same shape in memory. */
function mountState(routesCfg, destinationsCfg, devicesCfg, opts) {
  state.routes = (routesCfg || []).map((r) => ({ ...r, stops: r.stops || [], path: r.path || [] }));
  state.routes.forEach((r) => bustRoute(r.id));
  state.destinations = (destinationsCfg || []).slice();

  state.devices = {};
  state.deviceOrder = [];
  (devicesCfg || []).forEach((cfg) => {
    const dev = {
      id: cfg.id,
      name: cfg.name,
      routeId: cfg.routeId || null,
      type: cfg.type || 'Traditional',
      active: cfg.active !== false,
      phone: cfg.phone || '',
      driver: cfg.driver || '',
      color: cfg.color || null,
      color2: cfg.color2 || null,
      tracking: false,
      simulated: false,
      speedKmh: cfg.speedKmh || 0,
      heading: cfg.heading || 0,
      lastFix: cfg.lastFix || null,
      smoothed: cfg.smoothed || cfg.lastFix || null,
      s: cfg.s || 0,
      lastUpdated: null, // a reboot means "no live fix yet" -> offline until data arrives
      simState: null,
    };
    state.devices[dev.id] = dev;
    state.deviceOrder.push(dev.id);
    state.locationHistory[dev.id] = [];
  });
  // Auto-start the demo simulator for flagged devices so the demo is alive on
  // first load AND survives a backend restart (e.g. Jeepney 01 on Obrero - Bajada).
  let resumed = 0;
  state.deviceOrder.forEach((id) => {
    const cfg = (devicesCfg || []).find((c) => c.id === id);
    if (!cfg) return;
    // seed.json uses "simulate", the persisted state uses "simulated" — honour both
    if (cfg.simulate !== true && cfg.simulated !== true) return;
    const routeObj = state.routes.find((r) => r.id === cfg.routeId);
    if (!routeObj) return;
    const total = prepFor(routeObj).prep.totalM || 1;
    const seedS = typeof cfg.s === 'number' ? cfg.s / total : 0.1 + Math.random() * 0.3;
    if (startSimulator(id, { seedS: Math.max(0, Math.min(0.95, seedS)) })) resumed++;
  });
  if (resumed) console.log(`resumed ${resumed} demo simulator${resumed > 1 ? 's' : ''}`);
  console.log(
    `${(opts && opts.source) || 'loaded'}: ${state.routes.length} routes · ${state.deviceOrder.length} devices · ${state.destinations.length} destinations`
  );
}

// ---------------------------------------------------------------------------
// GPS ingest — smoothing + derived state (§44, §85, §86)
// ---------------------------------------------------------------------------
function ingestFix(deviceId, fix, opts) {
  const dev = state.devices[deviceId];
  if (!dev) return { error: 'unknown device' };
  const now = Date.now();
  const raw = { lat: num(fix.lat), lng: num(fix.lng) };
  if (!isFinite(raw.lat) || !isFinite(raw.lng)) return { error: 'invalid coordinates' };
  if (!coordsOk(raw.lat, raw.lng)) return { error: 'coordinates out of range' };
  // GPS chipsets commonly report 0,0 when they have no fix. It is never a real
  // jeepney position, and without this check a first (unverifiable) reading would
  // drop the vehicle into the ocean.
  if (raw.lat === 0 && raw.lng === 0) return { error: 'coordinates out of range' };
  // A phone also reports when it took the fix. The server clock stays
  // authoritative for every window/timeout calculation; the device clock is
  // only trusted when it is sane, and is kept for traceability (spec 9, 31).
  const clientTs = fix.timestamp != null && isFinite(+fix.timestamp) ? +fix.timestamp : null;
  const clockSkewMs = clientTs ? Math.abs(clientTs - now) : null;
  const usableTs = clientTs && clockSkewMs <= 120000 ? clientTs : null;

  const prev = dev.smoothed;
  const jump = prev ? Geo.haversine(prev, raw) : 0;
  const dtSec = dev.lastUpdated ? (now - dev.lastUpdated) / 1000 : null;

  // --- reject implausible readings instead of corrupting the track (spec 24, 29)
  const accRaw = num(fix.accuracy);
  const accuracy = isFinite(accRaw) && accRaw >= 0 ? accRaw : null;
  if (prev) {
    const tooFar = jump > Math.max(120, (accuracy || 0) * 6);
    // An interval that is too short (or missing) cannot vouch for a long jump:
    // treat the implied speed as unverifiable and reject rather than teleport.
    const usableDt = dtSec != null && dtSec > 0.2 ? dtSec : null;
    const impliedKmh = usableDt ? (jump / usableDt) * 3.6 : Infinity;
    if (tooFar && impliedKmh > CONFIG.maxPlausibleKmh) {
      return {
        ok: false,
        skipped:
          'implausible jump' +
          (usableDt ? ' (' + Math.round(impliedKmh) + ' km/h)' : ' (interval too short to verify)'),
        distanceM: Math.round(jump),
      };
    }
  }
  // Light smoothing kills GPS jitter without the marker lagging behind (§85).
  // Big jumps (first fix, simulator reset) snap instead of sliding.
  let alpha = 0.75;
  if (!prev || jump > 400) alpha = 1;
  else if (jump < 3) alpha = 0.35;
  dev.smoothed = prev
    ? { lat: prev.lat + (raw.lat - prev.lat) * alpha, lng: prev.lng + (raw.lng - prev.lng) * alpha }
    : raw;

  // --- observed speed: distance actually travelled / elapsed time (spec 26-28)
  const track = dev.track || (dev.track = []);
  track.push({ t: now, lat: dev.smoothed.lat, lng: dev.smoothed.lng });
  while (track.length > 2 && now - track[0].t > CONFIG.speedWindowMs) track.shift();

  let travelledM = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0) || dt > 20) continue;                       // invalid interval
    const seg = Geo.haversine(a, b);
    if (seg < 3) continue;                                    // standing still / jitter
    if ((seg / dt) * 3.6 > CONFIG.maxPlausibleKmh) continue;  // outlier segment
    travelledM += seg;
  }
  const windowSec = track.length > 1 ? (track[track.length - 1].t - track[0].t) / 1000 : 0;
  if (windowSec >= 8) {
    const observed = (travelledM / windowSec) * 3.6;
    dev.speedKmh = dev.speedKmh ? dev.speedKmh + (observed - dev.speedKmh) * 0.5 : observed;
    if (dev.speedKmh < 1.5) dev.speedKmh = 0;
  } else if (isFinite(num(fix.speed))) {
    const kmh = Math.max(0, Math.min(num(fix.speed), CONFIG.maxPlausibleKmh));
    dev.speedKmh = kmh > 3 ? kmh : 0;
  }
  const hdg = normHeading(fix.heading);
  if (hdg != null) dev.heading = hdg;
  // An accuracy that is negative, absurd or unparseable is not a measurement: keep
  // the last good value rather than storing nonsense the arrival banner trusts
  // (its "genuine GPS" gate is `accuracy <= 120`, which -9999 happily satisfies).
  if (accuracy != null && accuracy <= 10000) dev.accuracy = accuracy;
  dev.lastFix = raw;
  dev.lastUpdated = now;
  dev.tracking = true;
  dev.speedWindowSec = windowSec || 0;

  // Landmark with hysteresis (spec 97): keep the current "Near X" until the
  // jeepney is clearly closer to a different stop, so the caption does not flicker.
  const lmRoute = state.routes.find((r) => r.id === dev.routeId);
  if (lmRoute && Array.isArray(lmRoute.stops) && lmRoute.stops.length) {
    const cand = Geo.landmarkNear(lmRoute, dev.smoothed, CONFIG.landmarkRadiusM);
    const held = dev.landmarkId ? lmRoute.stops.find((st) => st.id === dev.landmarkId) : null;
    let keep = false;
    if (held) {
      const heldDist = Geo.haversine({ lat: held.latitude, lng: held.longitude }, dev.smoothed);
      if (!cand || cand.stop.id === held.id) keep = heldDist <= CONFIG.landmarkRadiusM * 1.35;
      else keep = heldDist <= CONFIG.landmarkRadiusM * 1.35 && cand.distM > heldDist - 80;
    }
    if (!keep) {
      dev.landmarkId = cand ? cand.stop.id : null;
      dev.landmarkSince = cand ? now : null;
    }
  }

  // Keep the route-progress estimate on the device: it is the hint for the next
  // map-match (so a loop route does not flip between s=0 and s=total near the
  // shared start/end point) and it makes progress available to every view.
  if (dev.routeId) {
    const route = state.routes.find((r) => r.id === dev.routeId);
    if (route) {
      try {
        const derived = computeDerived(route, dev.smoothed, dev.s, !!route.isLoop);
        if (derived && isFinite(derived.s)) dev.s = derived.s;
      } catch (e) { /* keep the previous s on bad geometry */ }
    }
  }

  const history = state.locationHistory[deviceId] || (state.locationHistory[deviceId] = []);
  history.push({
    lat: raw.lat,
    lng: raw.lng,
    speed: dev.speedKmh,
    heading: dev.heading,
    accuracy: dev.accuracy != null ? dev.accuracy : null,
    timestamp: now,
    deviceTimestamp: usableTs,
    clockSkewMs: clockSkewMs,
  });
  while (history.length > 60) history.shift();

  if (opts && opts.announce !== false) persist({ positions: true });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Simulator — one virtual jeepney driving its assigned route (§63, §109)
// ---------------------------------------------------------------------------
const simTimers = new Map();

function startSimulator(deviceId, opts) {
  const dev = state.devices[deviceId];
  if (!dev) return false;
  const route = state.routes.find((r) => r.id === dev.routeId);
  if (!route) return false;
  stopSimulator(deviceId);
  const { prep } = prepFor(route);
  if (!prep.totalM) return false;

  const startFrac = opts && typeof opts.seedS === 'number' ? opts.seedS : dev.s / (prep.totalM || 1);
  dev.s = Math.max(0, Math.min(prep.totalM - 1, startFrac * prep.totalM));
  dev.simulated = true;
  dev.tracking = true;
  dev.active = true;
  let s = dev.s;
  let targetSpeed = 22 + Math.random() * 6; // km/h

  const tick = () => {
    if (!dev.simulated) return;
    const dt = CONFIG.simulatorTickMs / 1000;
    if (Math.random() < 0.06) targetSpeed = 14 + Math.random() * 16; // traffic wobble
    const speed = Math.max(5, targetSpeed + (Math.random() - 0.5) * 3);
    s += (speed / 3.6) * dt;
    const total = prep.totalM;
    let wrapped = false;
    if (s >= total) {
      if (route.isLoop) {
        s = s - total;
        wrapped = true;
      } else {
        s = total - 0.5; // brief dwell at the terminal, then the next run starts (§57)
        dev.simHoldTicks = (dev.simHoldTicks || 0) + 1;
        if (dev.simHoldTicks > 3) {
          dev.simHoldTicks = 0;
          s = 0;
        }
      }
    }
    dev.s = s;
    const pos = Geo.pointAt(prep, s);
    const heading = Geo.headingAt(prep, s);
    // a phone never reports a perfectly frozen point: a couple of metres of drift
    const drift = dev.simHoldTicks ? 0.00003 : 0.00001;
    ingestFix(
      deviceId,
      {
        lat: pos.lat + (Math.random() - 0.5) * drift,
        lng: pos.lng + (Math.random() - 0.5) * drift,
        speed: dev.simHoldTicks ? 2 : speed,
        heading: heading,
        accuracy: 6,
      },
      { announce: false }
    );
    dev.lastUpdated = Date.now();
    broadcastLocations();
  };
  const timer = setInterval(tick, CONFIG.simulatorTickMs);
  simTimers.set(deviceId, timer);
  tick();
  return true;
}

function stopSimulator(deviceId, quiet) {
  const t = simTimers.get(deviceId);
  if (t) clearInterval(t);
  simTimers.delete(deviceId);
  const dev = state.devices[deviceId];
  if (dev) {
    dev.simulated = false;
    if (!dev.lastUpdated || Date.now() - dev.lastUpdated > 4000) {
      // no real phone is feeding this device -> it goes offline
      dev.lastUpdated = Date.now() - CONFIG.staleMs - 1000;
    }
  }
  // quiet: bulk operations (fleet clear) announce once at the end, not per device
  if (!quiet) broadcast('devices', { devices: snapshot().devices });
}

// ---------------------------------------------------------------------------
// SSE hub (§45, §48)
// ---------------------------------------------------------------------------
const clients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (e) {
      clients.delete(res);
    }
  }
}

/* The per-tick stream carries only what moves. Identity fields (name, type,
 * colours, route) arrive in the full snapshot and the client merges these
 * partial updates over them — with a few hundred jeepneys on one route the
 * difference is a third of the wire size on every single tick. */
function locDevice(d) {
  return {
    id: d.id,
    active: d.active,
    status: d.status,
    online: d.online,
    tracking: d.tracking,
    simulated: d.simulated,
    position: d.position,
    rawPosition: d.rawPosition,
    speedKmh: d.speedKmh,
    heading: d.heading,
    accuracy: d.accuracy,
    lastUpdated: d.lastUpdated,
    ageMs: d.ageMs,
    speedWindowSec: d.speedWindowSec,
    speedReady: d.speedReady,
    offRouteM: d.offRouteM,
    offRoute: d.offRoute,
    s: d.s,
    routeTotalM: d.routeTotalM,
    progressPct: d.progressPct,
    landmark: d.landmark,
    nextStop: d.nextStop,
    distanceToNextStopM: d.distanceToNextStopM,
    distanceToEndM: d.distanceToEndM,
    etaSecToNextStop: d.etaSecToNextStop,
    etaSecToEnd: d.etaSecToEnd,
    arrived: d.arrived,
  };
}

let locBroadcastAt = 0;
function broadcastLocations(force) {
  const now = Date.now();
  if (!force && now - locBroadcastAt < 800) return; // keep the stream light
  locBroadcastAt = now;
  const s = snapshot(now);
  broadcast('loc', { serverTime: now, devices: s.devices.map(locDevice) });
}

function broadcastAll() {
  broadcast('state', snapshot());
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    // A malformed % escape (e.g. "/%zz") is a bad request, not a server fault —
    // it used to escape as a 500 "URI malformed" and a line in the error log.
    return json(res, 400, { error: 'malformed URL' });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  // Compare against PUBLIC_DIR + separator: a bare prefix test would also accept a
  // sibling directory whose name merely starts with "public" (e.g. "public_backup").
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return json(res, 403, { error: 'forbidden' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(html);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    // Every asset index.html references carries ?v=N, and N changes whenever a
    // file changes, so those URLs never serve stale bytes: let browsers keep
    // them forever instead of revalidating 14 files on every single load.
    const versioned = req.url.includes('?v=');
    const cacheControl = versioned
      ? 'public, max-age=31536000, immutable'
      : ext === '.woff2' ? 'public, max-age=604800' : 'no-cache';
    const compressible = ext === '.js' || ext === '.css' || ext === '.svg' || ext === '.json' || ext === '.html';
    const wantsGzip = compressible && /gzip/i.test(req.headers['accept-encoding'] || '');
    const hit = assetCache.get(filePath);
    const entry = hit && hit.mtimeMs === stat.mtimeMs ? hit : null;
    if (entry) return sendAsset(res, entry, ext, cacheControl, wantsGzip);
    fs.readFile(filePath, (err, raw) => {
      if (err) return json(res, 404, { error: 'not found' });
      const fresh = { mtimeMs: stat.mtimeMs, raw: raw, gz: compressible ? zlib.gzipSync(raw) : null };
      if (assetCache.size > 40) assetCache.clear();
      assetCache.set(filePath, fresh);
      sendAsset(res, fresh, ext, cacheControl, wantsGzip);
    });
  });
}

/* Serve a cached asset buffer, gzipped when the client accepts it and the
 * compressed form is actually smaller. Vary keeps shared caches honest. */
function sendAsset(res, entry, ext, cacheControl, wantsGzip) {
  const useGz = !!(wantsGzip && entry.gz && entry.gz.length < entry.raw.length);
  const body = useGz ? entry.gz : entry.raw;
  const head = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheControl,
    'Content-Length': body.length,
  };
  if (entry.gz) head.Vary = 'Accept-Encoding';
  if (useGz) head['Content-Encoding'] = 'gzip';
  res.writeHead(200, head);
  res.end(body);
}

const assetCache = new Map(); // filePath -> { mtimeMs, raw, gz }

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
function slug(prefix) {
  return prefix + '-' + crypto.randomBytes(3).toString('hex');
}

function validateRoute(body) {
  const errors = [];
  if (!body || typeof body !== 'object') { errors.push('A route object is required.'); return errors; }
  if (!body.name || !String(body.name).trim()) errors.push('Route name is required.');
  const stops = Array.isArray(body.stops) ? body.stops : [];
  stops.forEach((s, i) => {
    // A null/short entry used to throw a TypeError inside the validator, which
    // surfaced as an HTTP 500 leaking internal text instead of a 422.
    if (!s || typeof s !== 'object') { errors.push(`Stop ${i + 1} is not a valid stop.`); return; }
    const lat = num(s.latitude), lng = num(s.longitude);
    if (!isFinite(lat) || !isFinite(lng)) errors.push(`Stop ${i + 1} has no valid coordinates.`);
    else if (!coordsOk(lat, lng)) errors.push(`Stop ${i + 1} is outside the map (latitude -90…90, longitude -180…180).`);
    if (!s.name || !String(s.name).trim()) errors.push(`Stop ${i + 1} needs a name.`);
  });
  // A route is defined by its drawn line; named stops / landmarks are optional
  // extras that give passengers "Near X" context. Start / end points are no longer
  // a thing — routes are drawn freely and usually loop back on themselves.
  const path = Array.isArray(body.path) ? body.path : [];
  if (path.length < 2) errors.push('Draw the route line — at least two points.');
  path.forEach((p, i) => {
    if (!p || typeof p !== 'object') { errors.push(`Path point ${i + 1} is not a coordinate.`); return; }
    const lat = num(p.lat), lng = num(p.lng);
    if (!coordsOk(lat, lng)) errors.push(`Path point ${i + 1} has no valid coordinates.`);
  });
  // Optional, but when the caller does send them they must be usable: an explicit
  // {lat:null,lng:null} used to be stored verbatim and pushed NaN into the maths.
  [['startPoint', body.startPoint], ['endPoint', body.endPoint]].forEach(([label, pt]) => {
    if (pt == null) return;
    if (typeof pt !== 'object') { errors.push(`${label} is not a coordinate.`); return; }
    if (!coordsOk(num(pt.lat), num(pt.lng))) errors.push(`${label} has no valid coordinates.`);
  });
  return errors;
}

function normaliseRoute(body, existing) {
  const stops = (Array.isArray(body.stops) ? body.stops : [])
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => ({
    id: s.id || slug('stop'),
    routeId: existing ? existing.id : body.id,
    name: String(s.name == null ? '' : s.name).trim(),
    latitude: num(s.latitude),
    longitude: num(s.longitude),
    order: i + 1,
      type: ['stop', 'landmark'].includes(s.type) ? s.type : 'stop',
    }));
  // filter, not just map: `+null` is 0, so an unfiltered map turns a blank point
  // into a real coordinate at (0,0) — the same trap the GPS ingest had.
  const validPoint = (p) => p && typeof p === 'object' && coordsOk(num(p.lat), num(p.lng));
  const path = (Array.isArray(body.path) ? body.path : []).filter(validPoint).map((p) => ({ lat: num(p.lat), lng: num(p.lng) }));
  const givenStart = body.startPoint && typeof body.startPoint === 'object' && coordsOk(num(body.startPoint.lat), num(body.startPoint.lng)) ? body.startPoint : null;
  const givenEnd = body.endPoint && typeof body.endPoint === 'object' && coordsOk(num(body.endPoint.lat), num(body.endPoint.lng)) ? body.endPoint : null;
  // Start / end are no longer declared by the admin: they fall out of the drawn
  // line's two ends, named after a stop that sits basically on top of them so a
  // loop that begins and ends at the depot still reads sensibly.
  const nearestStopName = (pt) => {
    let best = null;
    let bestD = 60;
    stops.forEach((s) => {
      // stops carry latitude/longitude, path points carry lat/lng — haversine
      // only reads the short names, so hand it a point in its own shape.
      const d = Geo.haversine({ lat: s.latitude, lng: s.longitude }, pt);
      if (d < bestD) { bestD = d; best = s.name; }
    });
    return best;
  };
  const firstP = path[0];
  const lastP = path[path.length - 1];
  const startPoint = givenStart || (firstP ? { lat: firstP.lat, lng: firstP.lng, name: nearestStopName(firstP) } : null);
  const endPoint = givenEnd || (lastP ? { lat: lastP.lat, lng: lastP.lng, name: nearestStopName(lastP) } : null);
  let distanceM = 0;
  for (let i = 1; i < path.length; i++) distanceM += Geo.haversine(path[i - 1], path[i]);
  // Routes are drawn freeform and almost always come back around, so a loop is
  // detected from the two ends of the drawn line being close together (150 m —
  // a hand-drawn loop never closes to the metre).
  const isLoop = !!(startPoint && endPoint && Geo.haversine(startPoint, endPoint) <= 150);
  return {
    id: existing ? existing.id : body.id || slug('route'),
    name: String(body.name).trim(),
    color: body.color || (existing && existing.color) || '#173B5C',
    // second colour of a two-tone route; null means a single solid colour
    color2: body.color2 || (existing && existing.color2) || null,
    active: body.active !== false,
    startPoint: startPoint,
    endPoint: endPoint,
    stops: stops,
    path: path,
    distanceM: Math.round(distanceM),
    isLoop: isLoop,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normaliseDevice(body, existing) {
  return {
    id: existing ? existing.id : body.id || slug('dev'),
    name: String(body.name || '').trim(),
    routeId: body.routeId || null,
    type: body.type || 'Traditional',
    driver: body.driver != null ? String(body.driver).trim() : (existing && existing.driver) || '',
    color: body.color || (existing && existing.color) || null,
    color2: body.color2 || (existing && existing.color2) || null,
    active: body.active !== false,
    phone: body.phone || '',
  };
}

async function handleApi(req, res, urlPath, query) {
  const parts = urlPath.split('/').filter(Boolean); // ['api', ...]
  const method = req.method.toUpperCase();
  const route = parts.slice(1);

  // A public deployment can be locked with ADMIN_KEY: reads (state, events, list
  // endpoints) stay public so passengers need nothing, writes need the header.
  //
  // The driver's phone is the exception. It posts GPS from /#/driver/<id> and has
  // no way to hold the admin key, so telemetry ingest and the tracking toggle must
  // stay open or locking the deployment silently stops every jeepney reporting.
  const isDriverTelemetry =
    route[0] === 'devices' && route.length >= 3 && (route[2] === 'location' || route[2] === 'tracking');

  if (ADMIN_KEY && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !isDriverTelemetry) {
    const supplied = req.headers['x-admin-key'] || query.get('key') || '';
    if (supplied !== ADMIN_KEY) {
      return json(res, 401, { error: 'This DaBound deployment is locked. Enter the admin key.', adminKeyRequired: true });
    }
  }

  // Entry gate for the admin UI. The write-gate above only asks for the key when
  // something is saved, which let anyone open the admin screens and read them.
  // This authenticated ping lets the client demand the key before it shows any
  // admin screen at all. Public when no ADMIN_KEY is set (spec §3 one-tap).
  if (route[0] === 'admin' && route[1] === 'verify') {
    if (!ADMIN_KEY) return json(res, 200, { ok: true, locked: false });
    const supplied = req.headers['x-admin-key'] || query.get('key') || '';
    return supplied === ADMIN_KEY
      ? json(res, 200, { ok: true, locked: true })
      : json(res, 401, { error: 'This DaBound deployment is locked. Enter the admin key.', adminKeyRequired: true });
  }

  // --- realtime stream ------------------------------------------------------
  if (route[0] === 'events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 2000\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (e) {
        /* closed */
      }
    }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (route[0] === 'state' && method === 'GET') return json(res, 200, snapshot());

  // Road-following geometry for the route editor (§34): the browser cannot call
  // OSRM directly (CORS), so the backend proxies it and falls back to straight
  // legs when the routing service is unreachable.
  if (route[0] === 'road-route' && method === 'POST') {
    const body = await readBody(req);
    const points = (body.points || []).filter((p) => isFinite(+p.lat) && isFinite(+p.lng));
    if (points.length < 2) return json(res, 422, { error: 'At least two points are required.' });
    const key = points.map((p) => `${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)}`).join(';');
    if (roadCache.has(key)) return json(res, 200, { ...roadCache.get(key), cached: true });

    const coords = points.map((p) => `${+p.lng},${+p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    let path = null;
    let source = 'straight';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'DaBound-MVP/0.1' } });
      clearTimeout(timer);
      const data = await resp.json();
      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        path = data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) }));
        source = 'osrm';
      }
    } catch (e) {
      console.warn('road-route: routing service unavailable —', e.message);
    }
    if (!path) {
      // straight-line fallback so the editor still works offline (§26 fallback)
      path = [];
      for (let i = 1; i < points.length; i++) {
        const a = { lat: +points[i - 1].lat, lng: +points[i - 1].lng };
        const b = { lat: +points[i].lat, lng: +points[i].lng };
        const steps = 24;
        if (!path.length) path.push(a);
        for (let s = 1; s <= steps; s++) {
          path.push({ lat: a.lat + ((b.lat - a.lat) * s) / steps, lng: a.lng + ((b.lng - a.lng) * s) / steps });
        }
      }
    }
    let distanceM = 0;
    for (let i = 1; i < path.length; i++) distanceM += Geo.haversine(path[i - 1], path[i]);
    const result = { path, distanceM: Math.round(distanceM), source, points: path.length };
    if (roadCache.size > 40) roadCache.clear();
    roadCache.set(key, result);
    return json(res, 200, result);
  }
  if (route[0] === 'health')
    return json(res, 200, { ok: true, uptime: process.uptime(), clients: clients.size, storage: storagePublic() });

  // Force a write and report where the data lives — handy for troubleshooting a
  // deployment (behind the ADMIN_KEY guard when one is set).
  if (route[0] === 'storage' && method === 'POST') {
    await sdSyncConfig();
    await sdSyncPositions();
    return json(res, 200, { ok: storage.ok, storage: storagePublic() });
  }

  // --- routes ---------------------------------------------------------------
  if (route[0] === 'routes') {
    if (method === 'GET' && route.length === 1) return json(res, 200, { routes: state.routes });
    if (method === 'POST' && route.length === 1) {
      const body = await readBody(req);
      const errors = validateRoute(body);
      if (errors.length) return json(res, 422, { errors: errors });
      const known = body.id ? state.routes.findIndex((r) => r.id === body.id) : -1;
      if (known >= 0) {
        // Same id twice (a retry, a double-tap on Save) updates the route
        // instead of creating a twin with the same identity.
        const updated = normaliseRoute(body, state.routes[known]);
        state.routes[known] = updated;
        bustRoute(updated.id);
        persist();
        broadcastAll();
        return json(res, 200, { route: updated });
      }
      const created = normaliseRoute(body, null);
      state.routes.push(created);
      bustRoute(created.id);
      persist();
      broadcastAll();
      return json(res, 201, { route: created });
    }
    const id = route[1];
    const idx = state.routes.findIndex((r) => r.id === id);
    if (idx < 0) return json(res, 404, { error: 'Route unavailable.' });
    if (method === 'GET') return json(res, 200, { route: state.routes[idx] });
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req);
      const merged = { ...state.routes[idx], ...body };
      const errors = validateRoute(merged);
      if (errors.length) return json(res, 422, { errors: errors });
      const updated = normaliseRoute(merged, state.routes[idx]);
      state.routes[idx] = updated;
      bustRoute(updated.id);
      persist();
      broadcastAll();
      return json(res, 200, { route: updated });
    }
    /* ------------------------------------------------- simulated fleet -----
     * A route in real life carries hundreds of jeepneys, so the demo can drop
     * a whole fleet of virtual ones onto the line at once — evenly spaced with
     * a little jitter so they drive like traffic, not like a convoy — and take
     * them all back off when the run is over. */
    if (route[2] === 'fleet') {
      const r = state.routes[idx];
      const { prep } = prepFor(r);
      if (!prep.totalM) return json(res, 422, { error: 'This route has no drawn line to drive on.' });
      if (method === 'POST') {
        const body = await readBody(req);
        const count = Math.floor(num(body.count));
        if (!isFinite(count) || count < 1) return json(res, 422, { error: 'How many jeepneys? Pick a number from 1 to 500.' });
        if (count > 500) return json(res, 422, { error: 'Up to 500 jeepneys per drop.' });
        if (state.deviceOrder.length + count > 2000) return json(res, 422, { error: 'That would put more than 2000 jeepneys on this server.' });
        const made = [];
        for (let i = 0; i < count; i++) {
          const dev = {
            ...normaliseDevice({ name: 'Sim ' + String(i + 1).padStart(3, '0') + ' · ' + r.name, type: 'Traditional', routeId: r.id }, null),
            tracking: false,
            simulated: false,
            speedKmh: 0,
            heading: 0,
            lastFix: null,
            smoothed: null,
            s: 0,
            lastUpdated: null,
            simState: null,
          };
          state.devices[dev.id] = dev;
          state.deviceOrder.push(dev.id);
          state.locationHistory[dev.id] = [];
          const frac = Math.min(0.999, (i + Math.random() * 0.6) / count);
          startSimulator(dev.id, { seedS: frac });
          made.push(dev.id);
        }
        persist();
        broadcastAll();
        return json(res, 201, { ok: true, created: made.length, devices: made });
      }
      if (method === 'DELETE') {
        let removed = 0;
        state.deviceOrder = state.deviceOrder.filter((did) => {
          const d = state.devices[did];
          if (d && d.routeId === r.id && d.simulated) {
            stopSimulator(did, true);
            delete state.devices[did];
            delete state.locationHistory[did];
            removed++;
            return false;
          }
          return true;
        });
        persist();
        broadcastAll();
        return json(res, 200, { ok: true, removed: removed });
      }
    }
    if (method === 'DELETE') {
      const removed = state.routes.splice(idx, 1)[0];
      state.deviceOrder.forEach((did) => {
        if (state.devices[did].routeId === removed.id) state.devices[did].routeId = null;
      });
      preparedCache.delete(removed.id);
      persist();
      broadcastAll();
      return json(res, 200, { ok: true, removedId: removed.id });
    }
  }

  // --- devices --------------------------------------------------------------
  if (route[0] === 'devices') {
    if (method === 'GET' && route.length === 1) return json(res, 200, { devices: snapshot().devices });
    if (method === 'POST' && route.length === 1) {
      const body = await readBody(req);
      const errors = [];
      if (!String(body.name || '').trim()) errors.push('Name is required.');
      if (!body.routeId) errors.push('Assign a route to this jeepney.');
      if (!body.type) errors.push('Type is required.');
      if (errors.length) return json(res, 422, { errors: errors });
      const existing = body.id && state.devices[body.id] ? state.devices[body.id] : null;
      const base = normaliseDevice(body, existing);
      if (existing) {
        // Same id twice: update the jeepney, keep its telemetry (and keep it once
        // in deviceOrder) unless the assignment really changed.
        const routeChanged = base.routeId !== existing.routeId;
        Object.assign(existing, base);
        if (routeChanged) {
          existing.s = 0;
          existing.smoothed = null;
          existing.lastFix = null;
          existing.lastUpdated = null;
        }
        persist();
        broadcastAll();
        return json(res, 200, { device: publicDevice(existing) });
      }
      const dev = {
        ...base,
        tracking: false,
        simulated: false,
        speedKmh: 0,
        heading: 0,
        lastFix: null,
        smoothed: null,
        s: 0,
        lastUpdated: null,
        simState: null,
      };
      state.devices[dev.id] = dev;
      state.deviceOrder.push(dev.id);
      state.locationHistory[dev.id] = [];
      persist();
      broadcastAll();
      return json(res, 201, { device: publicDevice(dev) });
    }
    const id = route[1];
    const dev = state.devices[id];
    if (!dev) return json(res, 404, { error: 'Device not found.' });
    const sub = route[2];

    if (method === 'POST' && sub === 'location') {
      const body = await readBody(req);
      // announce: a real phone fix must schedule the write — otherwise the last
      // known position never reaches the disk or the database.
      const out = ingestFix(id, body, { announce: true });
      if (out.error) return json(res, 400, out);
      broadcastLocations(true);
      if (out.skipped) {
        return json(res, 200, { ok: false, skipped: out.skipped, distanceM: out.distanceM, device: publicDevice(dev) });
      }
      return json(res, 200, { ok: true, device: publicDevice(dev) });
    }
    if (method === 'POST' && sub === 'tracking') {
      const body = await readBody(req);
      if (body.on === false) {
        stopSimulator(id);
        dev.tracking = false;
        dev.lastUpdated = Date.now() - CONFIG.staleMs - 1; // immediately offline
        persist();
        broadcastAll();
        return json(res, 200, { ok: true, device: publicDevice(dev) });
      }
      dev.tracking = true;
      dev.active = true;
      persist();
      broadcastAll();
      return json(res, 200, { ok: true, device: publicDevice(dev) });
    }
    if (method === 'POST' && sub === 'simulate') {
      const body = await readBody(req);
      if (body.on === false) {
        stopSimulator(id);
      } else {
        const ok = startSimulator(id, { seedS: typeof body.seedS === 'number' ? body.seedS : undefined });
        if (!ok) return json(res, 422, { error: 'Assign a route with path data first.' });
      }
      persist();
      broadcastAll();
      return json(res, 200, { ok: true, device: publicDevice(dev) });
    }
    if (method === 'POST' && sub === 'place') {
      const body = await readBody(req);
      const routeObj = state.routes.find((r) => r.id === dev.routeId);
      if (!routeObj) return json(res, 422, { error: 'Assign a route first.' });
      const { prep } = prepFor(routeObj);
      const frac = Math.max(0, Math.min(1, typeof body.frac === 'number' ? body.frac : 0));
      dev.s = frac * prep.totalM;
      const pos = Geo.pointAt(prep, dev.s);
      dev.smoothed = { lat: pos.lat, lng: pos.lng };
      dev.lastFix = { lat: pos.lat, lng: pos.lng };
      dev.lastUpdated = Date.now();
      dev.heading = Geo.headingAt(prep, dev.s);
      persist();
      broadcastLocations(true);
      return json(res, 200, { ok: true, device: publicDevice(dev) });
    }
    if (method === 'GET' && !sub) return json(res, 200, { device: publicDevice(dev), history: state.locationHistory[id] || [] });
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req);
      const merged = { ...dev, ...body };
      const errors = [];
      if (!String(merged.name || '').trim()) errors.push('Name is required.');
      if (!merged.routeId) errors.push('Assign a route to this jeepney.');
      if (!merged.type) errors.push('Type is required.');
      if (errors.length) return json(res, 422, { errors: errors });
      const routeChanged = merged.routeId !== dev.routeId;
      Object.assign(dev, normaliseDevice(merged, dev));
      if (routeChanged) {
        dev.s = 0;
        dev.smoothed = null;
        dev.lastFix = null;
        dev.lastUpdated = null;
      }
      persist();
      broadcastAll();
      return json(res, 200, { device: publicDevice(dev) });
    }
    if (method === 'DELETE') {
      stopSimulator(id);
      delete state.devices[id];
      delete state.locationHistory[id];
      state.deviceOrder = state.deviceOrder.filter((d) => d !== id);
      persist();
      broadcastAll();
      return json(res, 200, { ok: true, removedId: id });
    }
  }

  // --- destinations ---------------------------------------------------------
  if (route[0] === 'destinations') {
    if (method === 'GET' && route.length === 1) return json(res, 200, { destinations: state.destinations });
    if (method === 'POST' && route.length === 1) {
      const body = await readBody(req);
      if (!String(body.name || '').trim()) return json(res, 422, { errors: ['Destination name is required.'] });
      const lat = +body.latitude;
      const lng = +body.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(res, 422, { errors: ['A valid latitude and longitude are required.'] });
      }
      const dest = {
        id: body.id || slug('dest'),
        name: String(body.name).trim(),
        address: body.address || 'Davao City',
        latitude: lat,
        longitude: lng,
        routeIds: Array.isArray(body.routeIds) ? body.routeIds : [],
      };
      state.destinations.push(dest);
      persist();
      broadcast('destinations', { destinations: state.destinations });
      return json(res, 201, { destination: dest });
    }
    const id = route[1];
    const idx = state.destinations.findIndex((d) => d.id === id);
    if (idx < 0) return json(res, 404, { error: 'Destination not found.' });
    if (method === 'PUT') {
      const body = await readBody(req);
      const next = { ...state.destinations[idx], ...body, id: id };
      // Never let a bad coordinate clobber a good one.
      if (body.latitude != null && !Number.isFinite(+body.latitude)) next.latitude = state.destinations[idx].latitude;
      if (body.longitude != null && !Number.isFinite(+body.longitude)) next.longitude = state.destinations[idx].longitude;
      state.destinations[idx] = next;
      persist();
      broadcast('destinations', { destinations: state.destinations });
      return json(res, 200, { destination: state.destinations[idx] });
    }
    if (method === 'DELETE') {
      const [removed] = state.destinations.splice(idx, 1);
      persist();
      broadcast('destinations', { destinations: state.destinations });
      return json(res, 200, { ok: true, removedId: removed.id });
    }
  }

  if (route[0] === 'reset' && method === 'POST') {
    simTimers.forEach((t) => clearInterval(t));
    simTimers.clear();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    preparedCache.clear();
    Object.keys(state.devices).forEach((k) => delete state.devices[k]);
    loadState();
    if (SB_ON) {
      try {
        await sdReset();
        storage.ok = true; storage.lastError = null; storage.lastWriteAt = Date.now();
      } catch (err) {
        storage.ok = false; storage.lastError = sbErrText(err);
      }
    }
    broadcastAll();
    return json(res, 200, { ok: true, restored: true, storage: storagePublic() });
  }

  return json(res, 404, { error: 'Unknown endpoint.' });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname, url.searchParams);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error('request failed:', err);
    // The detail is already in the server log; sending err.message to the client
    // leaked internals (e.g. "Cannot read properties of null (reading 'latitude')").
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
    else res.end();
  }
});

// housekeeping: recompute status transitions (connecting/offline) once a second
setInterval(() => {
  const now = Date.now();
  let changed = false;
  state.deviceOrder.forEach((id) => {
    const dev = state.devices[id];
    if (!dev) return;
    const st = statusFor(dev, now);
    if (st !== dev._lastStatus) {
      dev._lastStatus = st;
      changed = true;
    }
  });
  if (changed || clients.size) broadcastLocations(true);
}, CONFIG.serverTickMs);

/* A redeploy (or a Render spin-down) sends SIGTERM: flush whatever the write
 * debounces still hold so the last save is never dropped on the floor. */
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  simTimers.forEach((t) => clearInterval(t));
  simTimers.clear();
  try {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeStateFile(); }
  } catch (err) {
    console.error('final local write failed:', err.message);
  }
  if (SB_ON && storage.loaded) {
    const flush = (async () => {
      if (cfgTimer) { clearTimeout(cfgTimer); cfgTimer = null; }
      if (posTimer) { clearTimeout(posTimer); posTimer = null; }
      await sdSyncConfig();
      await sdSyncPositions();
    })();
    await Promise.race([flush.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function boot() {
  loadState(); // instant local start: the file/seed is always available offline

  if (SB_ON) {
    try {
      const db = await sdLoad();
      if (!db.routes.length && !db.devices.length && !db.destinations.length) {
        storage.loaded = true;
        const n = await sdSeedDestinations();
        console.log(`supabase: empty database — wrote the ${n} destination suggestions`);
      } else {
        mountState(db.routes, db.destinations, db.devices, { source: 'supabase' });
        storage.loaded = true;
        writeStateFile(); // keep the local cache in step with the database
      }
      storage.ok = true; storage.lastError = null; storage.lastLoadAt = Date.now();
    } catch (err) {
      storage.ok = false; storage.lastError = sbErrText(err); storage.loaded = false;
      console.error('supabase unreachable — serving from the local state file instead:', storage.lastError);
      console.error('  (check SUPABASE_URL / SUPABASE_SERVICE_KEY; the app keeps working in memory until it answers)');
    }
  }

  server.listen(PORT, HOST, () => {
  console.log(`\n  DaBound backend ready`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  data dir: ${DATA_DIR}`);
  console.log(
    SB_ON
      ? `  storage: supabase — ${storage.ok ? 'connected' : 'NOT connected'} (${SB_URL})`
      : '  storage: local file (set SUPABASE_URL + SUPABASE_SERVICE_KEY to keep data in Postgres)'
  );
  console.log(
    ADMIN_KEY
      ? '  admin area is PIN-locked (reads are public); writes need the PIN\n'
      : '  admin area: one tap, no login (spec 3)\n'
  );
  });
}

boot();

// if the database was unreachable at boot, keep trying to come back to it
setInterval(() => {
  if (!SB_ON || storage.loaded) return;
  sdLoad()
    .then((db) => {
      const empty = !db.routes.length && !db.devices.length && !db.destinations.length;
      if (!empty) {
        mountState(db.routes, db.destinations, db.devices, { source: 'supabase (reconnected)' });
        console.warn('supabase became reachable again — the database is now the source of truth');
      } else {
        console.warn('supabase became reachable again — writing this session\'s data into it');
      }
      storage.loaded = true; storage.ok = true; storage.lastError = null;
      return empty ? sdSeedDestinations() : null;
    })
    .then(() => { storage.dirty = true; return sdSyncConfig(); })
    .then(() => broadcastAll())
    .catch(() => {});
}, 20000);

// and keep retrying a failed write until it lands
setInterval(() => {
  if (SB_ON && storage.loaded && (storage.dirty || !storage.ok)) sdSyncConfig();
}, 15000);
