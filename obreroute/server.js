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
const Geo = require('./public/js/geo.js');

const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
// DATA_DIR lets a host mount a persistent volume anywhere (or point at a disk)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
// ADMIN_KEY is optional: unset -> the demo stays one-tap (spec §3). Set it on a
// public deployment and every write needs the shared key (reads stay open).
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
  const pr = Geo.project(prep, position, sHint, 1500);
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
    offRouteM: derived && derived.offRouteM != null ? Math.round(derived.offRouteM) : null,
    offRoute: !!(derived && derived.offRouteM != null && derived.offRouteM > CONFIG.offRouteToleranceM),
    s: derived ? derived.s : null,
    routeTotalM: derived ? derived.routeTotalM : route ? prepFor(route).prep.totalM : null,
    progressPct: derived && derived.routeTotalM ? Math.min(100, (derived.s / derived.routeTotalM) * 100) : null,
    offRouteM: derived ? derived.offRouteM : null,
    landmark: heldLandmark(dev, derived),
    nextStop: derived ? derived.nextStop : null,
    distanceToNextStopM: derived ? derived.remainingToNextStopM : null,
    distanceToEndM: derived ? derived.remainingToEndM : null,
    etaSecToNextStop: etaSecToNext,
    etaSecToEnd: etaSecToEnd,
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
    },
    routes: state.routes,
    destinations: state.destinations,
    devices: state.deviceOrder
      .map((id) => state.devices[id])
      .filter(Boolean)
      .map((d) => publicDevice(d, now)),
  };
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {
      savedAt: new Date().toISOString(),
      routes: state.routes,
      destinations: state.destinations,
      devices: state.deviceOrder.map((id) => {
        const d = state.devices[id];
        return {
          id: d.id, name: d.name, routeId: d.routeId, type: d.type, active: d.active,
          phone: d.phone || '', driver: d.driver || '', color: d.color || null,
          simulated: !!d.simulated, tracking: !!d.tracking,
          lastFix: d.lastFix || null, smoothed: d.smoothed || null, s: d.s || 0,
          speedKmh: d.speedKmh || 0, heading: d.heading || 0, lastUpdated: d.lastUpdated || null,
        };
      }),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 1));
  }, 800);
}

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

  state.routes = routes.map((r) => ({ ...r, stops: r.stops || [], path: r.path || [] }));
  state.routes.forEach((r) => bustRoute(r.id));
  state.destinations = destinations;

  state.devices = {};
  state.deviceOrder = [];
  devicesCfg.forEach((cfg) => {
    const dev = {
      id: cfg.id,
      name: cfg.name,
      routeId: cfg.routeId || null,
      type: cfg.type || 'Traditional',
      active: cfg.active !== false,
      phone: cfg.phone || '',
      driver: cfg.driver || '',
      color: cfg.color || null,
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
    const cfg = devicesCfg.find((c) => c.id === id);
    if (!cfg) return;
    // seed.json uses "simulate", the persisted state uses "simulated" — honour both
    if (cfg.simulate !== true && cfg.simulated !== true) return;
    const routeObj = state.routes.find((r) => r.id === cfg.routeId);
    if (!routeObj) return;
    const total = prepFor(routeObj).prep.totalM || 1;
    const seedS = saved && typeof cfg.s === 'number' ? cfg.s / total : 0.1 + Math.random() * 0.3;
    if (startSimulator(id, { seedS: Math.max(0, Math.min(0.95, seedS)) })) resumed++;
  });
  if (resumed) console.log(`resumed ${resumed} demo simulator${resumed > 1 ? 's' : ''}`);
  console.log(`loaded ${state.routes.length} routes · ${state.deviceOrder.length} devices · ${state.destinations.length} destinations`);
}

// ---------------------------------------------------------------------------
// GPS ingest — smoothing + derived state (§44, §85, §86)
// ---------------------------------------------------------------------------
function ingestFix(deviceId, fix, opts) {
  const dev = state.devices[deviceId];
  if (!dev) return { error: 'unknown device' };
  const now = Date.now();
  const raw = { lat: +fix.lat, lng: +fix.lng };
  if (!isFinite(raw.lat) || !isFinite(raw.lng)) return { error: 'invalid coordinates' };
  if (raw.lat < -90 || raw.lat > 90 || raw.lng < -180 || raw.lng > 180) {
    return { error: 'coordinates out of range' };
  }
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
  const accuracy = fix.accuracy != null && isFinite(+fix.accuracy) ? +fix.accuracy : null;
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
  } else if (fix.speed != null && isFinite(+fix.speed)) {
    const kmh = Math.min(+fix.speed, CONFIG.maxPlausibleKmh);
    dev.speedKmh = kmh > 3 ? kmh : 0;
  }
  if (fix.heading != null && isFinite(+fix.heading)) dev.heading = +fix.heading;
  if (fix.accuracy != null) dev.accuracy = +fix.accuracy;
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

  if (opts && opts.announce !== false) persist();
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

function stopSimulator(deviceId) {
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
  broadcast('devices', { devices: snapshot().devices });
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

let locBroadcastAt = 0;
function broadcastLocations(force) {
  const now = Date.now();
  if (!force && now - locBroadcastAt < 800) return; // keep the stream light
  locBroadcastAt = now;
  const s = snapshot(now);
  broadcast('loc', { serverTime: now, devices: s.devices });
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
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.woff2' ? 'public, max-age=604800' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
function slug(prefix) {
  return prefix + '-' + crypto.randomBytes(3).toString('hex');
}

function validateRoute(body) {
  const errors = [];
  if (!body.name || !String(body.name).trim()) errors.push('Route name is required.');
  const stops = Array.isArray(body.stops) ? body.stops : [];
  if (!stops.length) errors.push('Add at least one stop or landmark.');
  stops.forEach((s, i) => {
    if (!isFinite(+s.latitude) || !isFinite(+s.longitude)) errors.push(`Stop ${i + 1} has no valid coordinates.`);
    if (!s.name || !String(s.name).trim()) errors.push(`Stop ${i + 1} needs a name.`);
  });
  const path = Array.isArray(body.path) ? body.path : [];
  if (!path.length) errors.push('The route needs at least one coordinate.');
  return errors;
}

function normaliseRoute(body, existing) {
  const stops = (body.stops || []).map((s, i) => ({
    id: s.id || slug('stop'),
    routeId: existing ? existing.id : body.id,
    name: String(s.name).trim(),
    latitude: +s.latitude,
    longitude: +s.longitude,
    order: i + 1,
    type: ['start', 'stop', 'landmark', 'endpoint'].includes(s.type) ? s.type : i === 0 ? 'start' : 'stop',
  }));
  const path = (body.path || []).map((p) => ({ lat: +p.lat, lng: +p.lng }));
  const corridor = (body.corridor || []).filter((q) => q && isFinite(+q.lat) && isFinite(+q.lng)).map((q) => ({ lat: +q.lat, lng: +q.lng }));
  const startPoint = body.startPoint || (stops.length ? { lat: stops[0].latitude, lng: stops[0].longitude, name: stops[0].name } : null);
  const last = stops[stops.length - 1];
  const endPoint = body.endPoint || (last ? { lat: last.latitude, lng: last.longitude, name: last.name } : null);
  let distanceM = 0;
  for (let i = 1; i < path.length; i++) distanceM += Geo.haversine(path[i - 1], path[i]);
  const isLoop = !!(startPoint && endPoint && Math.abs(startPoint.lat - endPoint.lat) < 1e-5 && Math.abs(startPoint.lng - endPoint.lng) < 1e-5);
  return {
    id: existing ? existing.id : body.id || slug('route'),
    name: String(body.name).trim(),
    color: body.color || (existing && existing.color) || '#173B5C',
    active: body.active !== false,
    startPoint: startPoint,
    endPoint: endPoint,
    stops: stops,
    path: path,
    corridor: corridor.length >= 3 ? corridor : existing && existing.corridor ? existing.corridor : [],
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
  if (ADMIN_KEY && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const supplied = req.headers['x-admin-key'] || query.get('key') || '';
    if (supplied !== ADMIN_KEY) {
      return json(res, 401, { error: 'This DaBound deployment is locked. Enter the admin key.', adminKeyRequired: true });
    }
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
  if (route[0] === 'health') return json(res, 200, { ok: true, uptime: process.uptime(), clients: clients.size });

  // --- routes ---------------------------------------------------------------
  if (route[0] === 'routes') {
    if (method === 'GET' && route.length === 1) return json(res, 200, { routes: state.routes });
    if (method === 'POST' && route.length === 1) {
      const body = await readBody(req);
      const errors = validateRoute(body);
      if (errors.length) return json(res, 422, { errors: errors });
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
      const base = normaliseDevice(body, null);
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
      const out = ingestFix(id, body);
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
      const dest = {
        id: body.id || slug('dest'),
        name: String(body.name).trim(),
        address: body.address || 'Davao City',
        latitude: +body.latitude,
        longitude: +body.longitude,
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
      state.destinations[idx] = { ...state.destinations[idx], ...body, id: id };
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
    broadcastAll();
    return json(res, 200, { ok: true, restored: true });
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
    if (!res.headersSent) json(res, 500, { error: err.message || 'Server error' });
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

process.on('SIGTERM', () => {
  simTimers.forEach((t) => clearInterval(t));
  server.close(() => process.exit(0));
});

loadState();
server.listen(PORT, HOST, () => {
  console.log(`\n  DaBound backend ready`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  data dir: ${DATA_DIR}`);
  console.log(
    ADMIN_KEY
      ? '  writes require the ADMIN_KEY you set (reads are public)\n'
      : '  admin area: one tap, no login (spec 3)\n'
  );
});
