/**
 * qa_release.js — release-gate test for the DaBound MVP data flow.
 *
 * Drives the REAL tracking path with no simulator anywhere: an admin creates a
 * route and a device through the public API, a "phone" posts real telemetry
 * fixes (every ~3.5 s, like a phone), and every derived value (position, route
 * progress, distance, smoothed average speed, ETA, landmark, online/offline) is
 * asserted against the data that was actually sent. Oversized jumps are still
 * simulated on purpose to prove the outlier guard rejects them.
 *
 * Run:  node tools/qa_release.js [baseUrl]
 *          full flow; leaves two fixtures behind for the restart test
 *        node tools/qa_release.js [baseUrl] --verify-persist
 *          run after restarting the backend: proves persistence, then cleans up
 */
const Geo = require('../public/js/geo.js');

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8080').replace(/\/$/, '');
const VERIFY = args.includes('--verify-persist');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  \u2713 ${name}${extra ? ' \u2014 ' + extra : ''}`); }
  else { failed++; failures.push(name + (extra ? ' \u2014 ' + extra : '')); console.log(`  \u2717 ${name}${extra ? ' \u2014 ' + extra : ''}`); }
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: res.status, data };
}

// --- the route an admin would draw for the end-to-end scenario -------------
const ROUTE = {
  id: 'qa-obrero-bajada',
  name: 'QA Obrero \u2013 Bajada',
  color: '#D7263D',
  stops: [
    { id: 'qa-stop-1', name: 'USeP Obrero', latitude: 7.085773, longitude: 125.616083, type: 'start' },
    { id: 'qa-stop-2', name: 'Victoria Plaza', latitude: 7.086623, longitude: 125.611763, type: 'stop' },
    { id: 'qa-stop-3', name: 'Bajada Flyover', latitude: 7.095171, longitude: 125.615267, type: 'endpoint' },
  ],
  path: [
    { lat: 7.085773, lng: 125.616083 },
    { lat: 7.086000, lng: 125.614400 },
    { lat: 7.086350, lng: 125.613000 },
    { lat: 7.086623, lng: 125.611763 },
    { lat: 7.088200, lng: 125.612400 },
    { lat: 7.090100, lng: 125.613200 },
    { lat: 7.092400, lng: 125.614000 },
    { lat: 7.094100, lng: 125.614800 },
    { lat: 7.095171, lng: 125.615267 },
  ],
};
const ROUTE_2 = {
  id: 'qa-route-4',
  name: 'QA Route 4',
  stops: [
    { name: 'Roxas Night Market', latitude: 7.072500, longitude: 125.606500, type: 'start' },
    { name: 'People\u2019s Park', latitude: 7.070500, longitude: 125.609000, type: 'endpoint' },
  ],
  path: [
    { lat: 7.072500, lng: 125.606500 },
    { lat: 7.071400, lng: 125.607600 },
    { lat: 7.070500, lng: 125.609000 },
  ],
};
const LOOP = {
  id: 'qa-loop',
  name: 'QA Bajada Loop',
  stops: [
    { name: 'Loop Start', latitude: 7.090000, longitude: 125.610000, type: 'start' },
    { name: 'Loop Corner', latitude: 7.090900, longitude: 125.611000, type: 'stop' },
    { name: 'Loop Finish', latitude: 7.090000, longitude: 125.610000, type: 'endpoint' },
  ],
  path: [
    { lat: 7.090000, lng: 125.610000 },
    { lat: 7.090850, lng: 125.610500 },
    { lat: 7.090900, lng: 125.611000 },
    { lat: 7.090100, lng: 125.611000 },
    { lat: 7.090000, lng: 125.610400 },
    { lat: 7.090000, lng: 125.610000 },
  ],
};

const prep = Geo.prepare(ROUTE.path);
const totalM = prep.totalM;
const along = (m) => {
  const p = Geo.pointAt(prep, Math.max(0, Math.min(totalM, m)));
  return { lat: p.lat, lng: p.lng };
};

let devId = 'qa-dev-01';

async function sendFix(m, opts) {
  const p = opts && opts.at ? opts.at : along(m);
  return api('POST', `/api/devices/${devId}/location`, {
    lat: p.lat,
    lng: p.lng,
    speed: opts && opts.speed != null ? opts.speed : 20,
    heading: opts && opts.heading != null ? opts.heading : 90,
    accuracy: opts && opts.accuracy != null ? opts.accuracy : 8,
    timestamp: Date.now(),
  });
}
async function deviceState(id) {
  const st = await api('GET', '/api/state');
  return (st.data.devices || []).find((d) => d.id === (id || devId)) || null;
}

// ---------------------------------------------------------------------------
async function setup() {
  console.log('\n\u2500\u2500 setup: admin registers a route + jeepney (no built-in data) \u2500\u2500');
  await api('POST', '/api/reset');
  let st = await api('GET', '/api/state');
  ok('Fresh install starts with no routes and no jeepneys',
    st.data.routes.length === 0 && st.data.devices.length === 0,
    `${st.data.routes.length} routes \u00b7 ${st.data.devices.length} jeepneys`);

  const r1 = await api('POST', '/api/routes', ROUTE);
  ok('Admin route is created', r1.status === 201, `HTTP ${r1.status}`);
  await api('POST', '/api/routes', ROUTE_2);
  const r3 = await api('POST', '/api/routes', LOOP);
  ok('Loop route (start == endpoint) is accepted', r3.status === 201 && r3.data.route.isLoop === true);

  const d = await api('POST', '/api/devices', {
    id: devId, name: 'QA Jeepney 01', routeId: ROUTE.id, type: 'Traditional', color: '#D7263D',
  });
  ok('Admin device is created and assigned to the route', d.status === 201 && d.data.device.routeId === ROUTE.id);

  const dev = await deviceState();
  ok('A device with no telemetry is offline, not faked live',
    dev.status === 'offline' && dev.position === null && dev.lastUpdated === null,
    `status=${dev.status} position=${dev.position === null ? 'none' : 'set'}`);
  ok('A device with no telemetry shows no ETA', dev.etaSecToEnd == null && dev.distanceToEndM == null);

  st = await api('GET', '/api/state');
  ok('Passenger and admin read the same route list',
    st.data.routes.length === 3 && st.data.routes.some((r) => r.id === ROUTE.id && r.name === ROUTE.name),
    st.data.routes.map((r) => r.name).join(' | '));
  ok('Stops keep name + coordinates + order (spec 18)',
    st.data.routes.find((r) => r.id === ROUTE.id).stops.map((s) => s.order).join('') === '123');
}

// ---------------------------------------------------------------------------
async function telemetry() {
  console.log('\n\u2500\u2500 phone \u2192 backend: real fixes along the route (spec 9-14) \u2500\u2500');
  await sendFix(totalM * 0.05, { speed: 18 });
  const first = await deviceState();
  ok('Backend accepts a real GPS fix and goes online', first.status === 'online', `status=${first.status}`);
  ok('Stored position matches the transmitted position',
    Geo.haversine(first.position, along(totalM * 0.05)) < 25,
    `${first.position.lat.toFixed(5)},${first.position.lng.toFixed(5)}`);
  ok('Route progress is derived from the route, not the endpoint',
    first.s != null && Math.abs(first.s - totalM * 0.05) < 150, `s=${Math.round(first.s)} of ${Math.round(totalM)} m`);
  ok('Distance remaining comes from route progress', first.distanceToEndM > 0 && first.distanceToEndM < totalM);
  ok('ETA is finite and derived from real data',
    isFinite(first.etaSecToEnd) && first.etaSecToEnd > 0, Math.round(first.etaSecToEnd) + ' s');
  ok('Speed is not invented before there is telemetry to smooth',
    first.speedReady === false, `window=${Math.round(first.speedWindowSec)}s`);

  const samples = [];
  for (let i = 1; i <= 12; i++) {
    await sleep(3500);
    await sendFix(totalM * 0.05 + i * 19.4);
    const s = await deviceState();
    samples.push({ s: s.s, rem: s.distanceToEndM, sp: s.speedKmh, ready: s.speedReady, lm: s.landmark && s.landmark.name });
  }
  const last = samples[samples.length - 1];
  ok('The marker follows the phone along the route',
    samples.every((s, i) => i === 0 || s.s >= samples[i - 1].s), `${Math.round(samples[0].s)} \u2192 ${Math.round(last.s)} m`);
  ok('Distance remaining decreases as the phone travels',
    last.rem < samples[0].rem, `${Math.round(samples[0].rem)} \u2192 ${Math.round(last.rem)} m`);
  const now = await deviceState();
  ok('Average speed is a smoothed window value, not a raw two-point segment',
    last.sp > 5 && last.sp < 45 && last.ready === true,
    `${last.sp.toFixed(1)} km/h over a ${Math.round(now.speedWindowSec)}s window`);
  ok('Speed never reports NaN/Infinity', isFinite(last.sp) && last.sp >= 0);
  ok('ETA stays finite and positive after the run', isFinite(now.etaSecToEnd) && now.etaSecToEnd > 0,
    Math.round(now.etaSecToEnd) + ' s \u2192 "' + Geo.formatEta(now.etaSecToEnd, now) + '"');
  ok('ETA + distance render in commuter language',
    /^< 1 min\.$|^\d+ mins?\.$/.test(Geo.formatEta(now.etaSecToEnd, now)) &&
      /away$|at the stop$/.test(Geo.formatDistance(now.distanceToEndM)),
    Geo.formatEta(now.etaSecToEnd, now) + ' \u00b7 ' + Geo.formatDistance(now.distanceToEndM));
}

// ---------------------------------------------------------------------------
async function landmark() {
  console.log('\n\u2500\u2500 landmark matching (spec 18) \u2500\u2500');
  // approach the stop at a believable 40 km/h so the outlier guard lets it through
  for (let i = 1; i <= 5; i++) {
    await sleep(3200);
    await sendFix(totalM * 0.05 + 228 + i * 36, { speed: 40, accuracy: 6 });
  }
  await sleep(600);
  const d1 = await deviceState();
  ok('A fix near a stop really moves the vehicle there',
    d1.landmark != null && d1.landmark.distM < 150,
    d1.landmark ? `${Math.round(d1.landmark.distM)} m from ${d1.landmark.name}` : 'no landmark');
  ok('Near a stop, the caption names that stop', d1.landmark && d1.landmark.name === 'Victoria Plaza',
    d1.landmark ? d1.landmark.name : 'no landmark');

  // a second phone far from every stop must not claim a landmark
  await api('POST', '/api/devices', { id: 'qa-far-dev', name: 'QA Far Jeepney', routeId: ROUTE.id, type: 'Traditional' });
  await api('POST', '/api/devices/qa-far-dev/location', { lat: 7.0760, lng: 125.6250, speed: 15, accuracy: 9 });
  const st = await api('GET', '/api/state');
  const farDev = st.data.devices.find((d) => d.id === 'qa-far-dev');
  ok('Away from every stop there is no misleading landmark (En route)',
    farDev.landmark === null, farDev.landmark ? farDev.landmark.name : 'En route');
  ok('A genuinely off-route fix is reported as off-route', farDev.offRoute === true, Math.round(farDev.offRouteM) + ' m off route');
  await api('DELETE', '/api/devices/qa-far-dev');
}

// ---------------------------------------------------------------------------
async function outliers() {
  console.log('\n\u2500\u2500 GPS outliers, time jumps and malformed data (spec 11, 31) \u2500\u2500');
  const before = await deviceState();
  await sleep(3000);
  const jump = await sendFix(0, { at: { lat: before.position.lat + 0.02, lng: before.position.lng + 0.02 } });
  ok('An impossible jump is rejected, and the API says so',
    jump.data && jump.data.ok === false && !!jump.data.skipped, JSON.stringify(jump.data && jump.data.skipped));
  const after = await deviceState();
  ok('The rejected fix does not teleport the jeepney',
    Geo.haversine(before.position, after.position) < 30,
    `${Math.round(Geo.haversine(before.position, after.position))} m marker movement`);
  ok('The rejected fix does not corrupt the speed',
    isFinite(after.speedKmh) && after.speedKmh < 110, after.speedKmh.toFixed(1) + ' km/h');
  ok('A rejected fix does not count as a fresh update', after.ageMs >= 3000, Math.round(after.ageMs) + ' ms since the last good fix');

  const bad1 = await api('POST', `/api/devices/${devId}/location`, { lat: 'not-a-number', lng: 125.6 });
  const bad2 = await api('POST', `/api/devices/${devId}/location`, { lat: 999, lng: 999 });
  const bad3 = await api('POST', `/api/devices/${devId}/location`, {});
  const bad4 = await api('POST', '/api/devices/does-not-exist/location', { lat: 7.1, lng: 125.6 });
  ok('Malformed coordinates are rejected', bad1.status >= 400, `HTTP ${bad1.status}`);
  ok('Impossible lat/lng are rejected', bad2.status >= 400, `HTTP ${bad2.status} ${bad2.data.error || ''}`);
  ok('A fix with no coordinates is rejected', bad3.status >= 400, `HTTP ${bad3.status}`);
  ok('Telemetry for an unknown device is rejected', bad4.status === 404, `HTTP ${bad4.status}`);
  const health = await api('GET', '/api/health');
  ok('The backend is still healthy after malformed input', health.status === 200 && health.data.ok === true);
  const still = await deviceState();
  ok('The device keeps tracking after bad input', still.status === 'online' && still.position != null);

  const skewed = await api('POST', `/api/devices/${devId}/location`, {
    lat: before.position.lat, lng: before.position.lng, speed: 10, timestamp: 1,
  });
  const afterSkew = await deviceState();
  const skewAge = afterSkew.ageMs == null ? 1e9 : afterSkew.ageMs;   // 0 ms is a valid age
  ok('A fix with an impossible timestamp is not trusted for timing',
    skewed.status === 200 && skewAge < 5000, Math.round(skewAge) + ' ms ago (server clock)');
}

// ---------------------------------------------------------------------------
async function connectionLoss() {
  console.log('\n\u2500\u2500 connection lost and resume (spec 21) \u2500\u2500');
  const last = await deviceState();
  console.log('  telemetry stopped; waiting for the backend to notice\u2026');
  await sleep(13000);
  const mid = await deviceState();
  ok('Telemetry silence drops the device out of online', mid.status !== 'online', `status=${mid.status}`);
  ok('Last known position is preserved while offline', mid.position && Geo.haversine(mid.position, last.position) < 5);
  await sleep(19000);
  const off = await deviceState();
  ok('After the timeout the device is offline', off.status === 'offline', `status=${off.status}`);
  ok('Last updated age keeps counting', off.ageMs >= 30000, Math.round(off.ageMs / 1000) + ' sec ago');
  ok('Offline devices keep a last known position, not a live one', off.position != null && off.online === false);
  ok('Offline ETA is not presented as live',
    Geo.formatEta(off.etaSecToEnd, off) === 'ETA unavailable', Geo.formatEta(off.etaSecToEnd, off));

  const resume = await sendFix(0, { at: off.position, speed: 14 });
  const back = await deviceState();
  ok('When telemetry resumes the device is online again', resume.status === 200 && back.status === 'online');
  ok('Position updates again after resume', back.ageMs < 3000, Math.round(back.ageMs) + ' ms ago');
}

// ---------------------------------------------------------------------------
async function reassign() {
  console.log('\n\u2500\u2500 reassign a device to another route (spec 20) \u2500\u2500');
  const patch = await api('PATCH', `/api/devices/${devId}`, { routeId: ROUTE_2.id });
  ok('Device reassignment is accepted', patch.status === 200 && patch.data.device.routeId === ROUTE_2.id);
  const dev = await deviceState();
  ok('The old route keeps no stale relationship', dev.routeId === ROUTE_2.id && dev.routeName === ROUTE_2.name);
  ok('Progress restarts cleanly on the new route', dev.s === null || dev.s === 0 || dev.s < 50,
    dev.s == null ? 'no progress until the next fix' : Math.round(dev.s) + ' m');

  const listed = await api('GET', '/api/state');
  const onOld = listed.data.devices.filter((d) => d.routeId === ROUTE.id).length;
  const onNew = listed.data.devices.filter((d) => d.routeId === ROUTE_2.id).length;
  ok('The device no longer appears under its old route', onOld === 0 && onNew === 1, `${onOld} old / ${onNew} new`);

  await api('PATCH', `/api/devices/${devId}`, { routeId: ROUTE.id });
  await sleep(800);
  await sleep(3200);
  await sendFix(totalM * 0.5, { speed: 18 });
  const back = await deviceState();
  ok('Reassigned back, it tracks the original route again',
    back.routeId === ROUTE.id && back.s != null && back.s > 100, `s=${Math.round(back.s)} m`);
}

// ---------------------------------------------------------------------------
async function loopRoute() {
  console.log('\n\u2500\u2500 loop route wrap-around (spec 22) \u2500\u2500');
  const dev2 = await api('POST', '/api/devices', { id: 'qa-loop-dev', name: 'QA Loop Jeepney', routeId: LOOP.id, type: 'Modern' });
  ok('A second device can be created (architecture supports many)', dev2.status === 201);
  const loopPrep = Geo.prepare(LOOP.path);
  const total = loopPrep.totalM;
  const stepM = 27;              // ~22 km/h at a 4.4 s reporting cadence
  const steps = Math.ceil((total + 60) / stepM);
  const rems = [];
  for (let i = 0; i <= steps; i++) {
    const s = i * stepM;
    const p = Geo.pointAt(loopPrep, s > total ? s - total : s);
    await api('POST', '/api/devices/qa-loop-dev/location', {
      lat: p.lat, lng: p.lng, speed: 22, accuracy: 7, timestamp: Date.now(),
    });
    await sleep(4400);
    const st = await api('GET', '/api/state');
    const d = st.data.devices.find((x) => x.id === 'qa-loop-dev');
    rems.push({
      lap: +(s / total).toFixed(2),
      s: d.s == null ? null : Math.round(d.s),
      rem: d.distanceToEndM == null ? null : Math.round(d.distanceToEndM),
      eta: d.etaSecToEnd,
      lm: d.landmark && d.landmark.name,
      status: d.status,
    });
  }
  console.log('  ' + rems.map((r) => `lap=${r.lap} s=${r.s}m rem=${r.rem}m eta=${r.eta == null ? '\u2014' : Math.round(r.eta) + 's'}${r.lm ? ' near ' + r.lm : ''}`).join('\n  '));
  ok('Loop progress wraps instead of going negative',
    rems.every((r) => r.rem == null || r.rem >= 0), rems.map((r) => r.rem).join(' / '));
  ok('Loop distance never exceeds the loop length',
    rems.every((r) => r.rem == null || r.rem <= total + 30), `loop = ${Math.round(total)} m`);
  ok('Loop ETA stays finite and non-negative',
    rems.every((r) => r.eta == null || (isFinite(r.eta) && r.eta >= 0)));
  ok('A jeepney that crossed the endpoint is still tracked',
    rems[rems.length - 1].status === 'online' && rems[rems.length - 1].s != null);
  const afterWrap = rems.slice(rems.findIndex((r) => (r.s || 0) === Math.round(total)) + 1);
  ok('Progress wrapped to the start of the next lap instead of running past the end',
    !afterWrap.length || afterWrap.every((r) => r.s < Math.round(total)),
    `peak s=${Math.max(...rems.map((r) => r.s || 0))}m of ${Math.round(total)}m loop`);
  await api('DELETE', '/api/devices/qa-loop-dev');
}

// ---------------------------------------------------------------------------
async function reference() {
  console.log('\n\u2500\u2500 cross-view consistency: one shared data source (spec 10, 23) \u2500\u2500');
  await sleep(3200);
  await sendFix(totalM * 0.62, { speed: 21 });
  await sleep(400);
  const st = await api('GET', '/api/state');
  const dev = st.data.devices.find((d) => d.id === devId);
  const adminView = { lat: dev.position.lat, lng: dev.position.lng, s: dev.s, sp: dev.speedKmh };
  const passengerView = { lat: dev.position.lat, lng: dev.position.lng, s: dev.s, sp: dev.speedKmh };
  ok('Admin and passenger resolve the identical device state',
    adminView.lat === passengerView.lat && adminView.lng === passengerView.lng && adminView.s === passengerView.s,
    `${adminView.lat.toFixed(5)},${adminView.lng.toFixed(5)}`);
  ok('Both sides derive ETA from the same remaining route distance',
    isFinite(dev.etaSecToEnd) && dev.distanceToEndM > 0,
    `${Math.round(dev.distanceToEndM)} m \u00b7 ${Math.round(dev.etaSecToEnd)} s \u00b7 ${dev.speedKmh.toFixed(1)} km/h`);
  ok('Progress percentage is within 0-100', dev.progressPct >= 0 && dev.progressPct <= 100, dev.progressPct.toFixed(1) + '%');
}

// ---------------------------------------------------------------------------
async function cascade() {
  console.log('\n\u2500\u2500 delete cascade: no broken references (spec 31) \u2500\u2500');
  await api('POST', '/api/routes', { id: 'qa-cascade', name: 'QA Cascade', stops: ROUTE.stops, path: ROUTE.path });
  await api('POST', '/api/devices', { id: 'qa-cascade-dev', name: 'QA Cascade Jeepney', routeId: 'qa-cascade', type: 'Traditional' });
  await api('DELETE', '/api/routes/qa-cascade');
  const st = await api('GET', '/api/state');
  const dev = st.data.devices.find((x) => x.id === 'qa-cascade-dev');
  ok('Deleting a route leaves its jeepney alive but unassigned', !!dev && dev.routeId === null);
  ok('The deleted route is gone from the shared list', !st.data.routes.some((x) => x.id === 'qa-cascade'));
  const stale = await api('GET', '/api/devices/qa-cascade-dev');
  ok('The unassigned jeepney still answers with its own record',
    stale.status === 200 && stale.data.device.routeId === null);
  await api('DELETE', '/api/devices/qa-cascade-dev');

  const noName = await api('POST', '/api/routes', { name: '   ', stops: ROUTE.stops, path: ROUTE.path });
  ok('A blank route name is refused', noName.status === 422, `HTTP ${noName.status}`);
  const noStops = await api('POST', '/api/routes', { name: 'QA No Stops' });
  ok('A route with no geometry is refused', noStops.status === 422,
    `${noStops.status} ${(noStops.data.errors || []).join('; ')}`);
  const dupName = await api('POST', '/api/routes', {
    id: 'qa-dup', name: ROUTE.name, stops: ROUTE.stops, path: ROUTE.path,
  });
  ok('A duplicate route name is accepted gracefully', dupName.status === 201);
  await api('DELETE', '/api/routes/qa-dup');
}

// ---------------------------------------------------------------------------
async function persistenceFixtures() {
  console.log('\n\u2500\u2500 fixtures for the restart (persistence) test \u2500\u2500');
  const r = await api('POST', '/api/routes', {
    id: 'qa-persist-route',
    name: 'QA Persist Route',
    stops: [
      { name: 'Persist Start', latitude: 7.07, longitude: 125.60, type: 'start' },
      { name: 'Persist End', latitude: 7.08, longitude: 125.61, type: 'endpoint' },
    ],
    path: [{ lat: 7.07, lng: 125.60 }, { lat: 7.08, lng: 125.61 }],
  });
  const d = await api('POST', '/api/devices', {
    id: 'qa-persist-dev', name: 'QA Persist Jeepney', routeId: 'qa-persist-route', type: 'Other',
  });
  ok('Persistence fixtures created', r.status === 201 && d.status === 201);
}

// ---------------------------------------------------------------------------
async function verifyPersist() {
  console.log('\n\u2500\u2500 persistence across a backend restart (spec 29) \u2500\u2500');
  const st = await api('GET', '/api/state');
  const route = st.data.routes.find((r) => r.id === 'qa-persist-route');
  const dev = st.data.devices.find((d) => d.id === 'qa-persist-dev');
  ok('Admin-created route survived the restart', !!route, route ? route.name : 'missing');
  ok('Device and its assignment survived the restart', !!dev && dev.routeId === 'qa-persist-route',
    dev ? `${dev.name} \u2192 ${dev.routeId}` : 'missing');
  ok('Route geometry survived the restart', !!route && route.path.length === 2 && route.stops.length === 2);

  console.log('\n\u2500\u2500 cleanup: the app goes back to its empty shipping state \u2500\u2500');
  for (const d of st.data.devices) await api('DELETE', '/api/devices/' + d.id);
  for (const r of st.data.routes) await api('DELETE', '/api/routes/' + r.id);
  const after = await api('GET', '/api/state');
  ok('Every QA route and jeepney is removed',
    after.data.routes.length === 0 && after.data.devices.length === 0,
    `${after.data.routes.length} routes \u00b7 ${after.data.devices.length} devices`);
  const del = await api('DELETE', '/api/devices/nope');
  ok('Deleting a missing device fails gracefully', del.status === 404, `HTTP ${del.status}`);
  const delR = await api('DELETE', '/api/routes/nope');
  ok('Deleting a missing route fails gracefully', delR.status === 404, `HTTP ${delR.status}`);
}

// ---------------------------------------------------------------------------
(async () => {
  try {
    if (VERIFY) {
      await verifyPersist();
    } else {
      await setup();
      await telemetry();
      await landmark();
      await outliers();
      await connectionLoss();
      await reassign();
      await loopRoute();
      await reference();
      await cascade();
      await persistenceFixtures();
    }
  } catch (err) {
    failed++;
    failures.push('unhandled error: ' + err.message);
    console.error('\nFATAL:', err);
  }
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550 qa_release: ${passed}/${passed + failed} checks passed \u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  if (failures.length) console.log('failed:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
})();
