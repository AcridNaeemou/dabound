/**
 * qa_release.js — the release gate for the data chain (spec §10–§36).
 *
 * It drives the app the way a phone does: the admin creates a route and a
 * jeepney, then REAL telemetry is posted to /api/devices/:id/location — the
 * simulator is never used. Everything the passenger sees (position, landmark,
 * distance left, average speed, ETA, connection state) is asserted against what
 * was actually sent, so a hard-coded or faked value fails the run.
 *
 * Run:  node tools/qa_release.js                 # the full chain
 *       node tools/qa_release.js --verify-persist  # after restarting the server
 */
const BASE = process.argv[2] && /^https?:/.test(process.argv[2]) ? process.argv[2] : 'http://127.0.0.1:8080';
const VERIFY = process.argv.includes('--verify-persist');

let total = 0;
let passed = 0;
const failures = [];
function ok(name, cond, extra) {
  total++;
  if (cond) passed++;
  else failures.push(name + (extra ? ' — ' + extra : ''));
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, method, body) {
  const res = await fetch(BASE + path, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  return { status: res.status, body: json };
}
const state = () => api('/api/state').then((r) => r.body);
const dev = (s, id) => s.devices.find((d) => d.id === id);
const finite = (v) => typeof v === 'number' && isFinite(v);

/* a small walker: metres along a polyline -> a coordinate */
function walk(path, meters) {
  let left = meters;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = haversine(a, b);
    if (left <= seg) {
      const t = seg ? left / seg : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    left -= seg;
  }
  return { lat: path[path.length - 1].lat, lng: path[path.length - 1].lng };
}
function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLength = (p) => p.reduce((sum, pt, i) => (i ? sum + haversine(p[i - 1], pt) : 0), 0);

/* the road the admin draws: USeP Obrero -> Victoria Plaza -> Bajada Flyover */
const LEGS = [
  [7.085773, 125.616083],
  [7.086000, 125.614900],
  [7.086623, 125.611763],
  [7.089000, 125.612400],
  [7.092000, 125.614000],
  [7.095171, 125.615267],
];
const PATH = (() => {
  const out = [];
  for (let i = 0; i < LEGS.length - 1; i++) {
    const a = LEGS[i];
    const b = LEGS[i + 1];
    for (let s = 0; s < 12; s++) out.push({ lat: +(a[0] + (b[0] - a[0]) * (s / 12)).toFixed(6), lng: +(a[1] + (b[1] - a[1]) * (s / 12)).toFixed(6) });
  }
  out.push({ lat: LEGS[LEGS.length - 1][0], lng: LEGS[LEGS.length - 1][1] });
  return out;
})();
const STOPS = [
  { name: 'USeP Obrero', latitude: 7.085773, longitude: 125.616083, order: 1, type: 'stop' },
  { name: 'Victoria Plaza', latitude: 7.086623, longitude: 125.611763, order: 2, type: 'stop' },
  { name: 'Bajada Flyover', latitude: 7.095171, longitude: 125.615267, order: 3, type: 'landmark' },
];

/* the loop the admin draws: a closed square (start == end) */
const LOOP_PATH = (() => {
  const c = { lat: 7.0900, lng: 125.6180 };
  const d = 0.0045;
  const corners = [
    { lat: c.lat + d, lng: c.lng - d },
    { lat: c.lat + d, lng: c.lng + d },
    { lat: c.lat - d, lng: c.lng + d },
    { lat: c.lat - d, lng: c.lng - d },
    { lat: c.lat + d, lng: c.lng - d },
  ];
  const out = [];
  for (let i = 0; i < corners.length - 1; i++) {
    for (let s = 0; s < 10; s++) {
      out.push({
        lat: +(corners[i].lat + (corners[i + 1].lat - corners[i].lat) * (s / 10)).toFixed(6),
        lng: +(corners[i].lng + (corners[i + 1].lng - corners[i].lng) * (s / 10)).toFixed(6),
      });
    }
  }
  out.push({ ...corners[corners.length - 1] });
  return out;
})();

async function sendFix(id, point, opts) {
  return api(`/api/devices/${id}/location`, 'POST', {
    lat: point.lat, lng: point.lng,
    speed: (opts && opts.speed) || 20,
    heading: (opts && opts.heading) || 70,
    accuracy: (opts && opts.accuracy) || 8,
    timestamp: Date.now(),
  });
}

const QA = { route: 'QA Obrero - Bajada', device: 'QA Jeepney 01', route2: 'QA Route Two', loop: 'QA Loop Route', persistRoute: 'QA Persist Route', persistDevice: 'QA Persist Jeepney', loopDevice: 'QA Loop Jeepney', bare: 'QA Bare Line', bareLoop: 'QA Bare Loop' };

async function cleanup() {
  const s = await state();
  for (const d of s.devices) if (d.name.startsWith('QA ') || d.name === QA.persistDevice) await api('/api/devices/' + d.id, 'DELETE');
  for (const r of s.routes) if (r.name.startsWith('QA ')) await api('/api/routes/' + r.id, 'DELETE');
}

/* the numbers the passenger reads, checked against what was sent */
function assertSane(where, d) {
  const nums = {
    speedKmh: d.speedKmh, s: d.s, routeTotalM: d.routeTotalM, progressPct: d.progressPct,
    distanceToEndM: d.distanceToEndM, distanceToNextStopM: d.distanceToNextStopM,
    etaSecToEnd: d.etaSecToEnd, etaSecToNextStop: d.etaSecToNextStop, offRouteM: d.offRouteM,
  };
  const bad = Object.keys(nums).filter((k) => nums[k] != null && (!finite(nums[k]) || nums[k] < 0));
  ok(`${where}: every number is finite and non-negative`, bad.length === 0, bad.map((k) => `${k}=${nums[k]}`).join(' '));
  ok(`${where}: progress stays inside the route`, d.progressPct == null || (d.progressPct >= 0 && d.progressPct <= 100), `progressPct=${d.progressPct}`);
  if (isFinite(d.distanceToEndM) && isFinite(d.routeTotalM)) {
    ok(`${where}: distance left never exceeds the route length`, d.distanceToEndM <= d.routeTotalM + 1, `${Math.round(d.distanceToEndM)} of ${Math.round(d.routeTotalM)} m`);
  }
}

(async () => {
  if (VERIFY) {
    console.log('\n── restart: did the data come back? (§3) ──');
    const s = await state();
    const r = s.routes.find((x) => x.name === QA.persistRoute);
    const d = s.devices.find((x) => x.name === QA.persistDevice);
    ok('the route the admin created is still there after the restart', !!r, r ? `id ${r.id}` : 'missing');
    ok('the jeepney is still there after the restart', !!d, d ? `id ${d.id}` : 'missing');
    ok('the assignment survived', !!(r && d && d.routeId === r.id), d && d.routeId);
    ok('the route geometry survived', !!(r && r.stops && r.stops.length === 3 && r.path && r.path.length > 10));
    console.log('\n── cleanup ──');
    await cleanup();
    const after = await state();
    ok('every QA route and jeepney is removed', after.routes.filter((x) => x.name.startsWith('QA ')).length === 0 && after.devices.filter((x) => x.name.startsWith('QA ')).length === 0);
    ok('the app is back to an empty shipping state', after.routes.length === 0 && after.devices.length === 0, `${after.routes.length} routes · ${after.devices.length} jeepneys`);
    console.log(`\n═══ qa_release: ${passed}/${total} checks passed ═══\n`);
    process.exit(passed === total ? 0 : 1);
    return;
  }

  console.log('\n── clean start (§5) ──');
  await api('/api/reset', 'POST');
  let s = await state();
  ok('a fresh install has no routes and no jeepneys', s.routes.length === 0 && s.devices.length === 0);
  ok('the destination suggestions are the only content', s.destinations.length >= 5, `${s.destinations.length} destinations`);
  ok('nothing is reported online without telemetry', s.devices.length === 0);

  console.log('\n── admin draws a route (§6, §8, §20, §21) ──');
  const created = await api('/api/routes', 'POST', { name: QA.route, stops: STOPS, path: PATH });
  ok('the route is created', created.status === 201, 'HTTP ' + created.status);
  const R1 = created.body.route;
  const drawn = pathLength(PATH);
  ok('stops are stored with name, coordinates and order', R1.stops.length === 3 && R1.stops[1].name === 'Victoria Plaza' && isFinite(R1.stops[1].latitude) && R1.stops[1].order === 2);
  ok('the distance matches the road that was drawn (not invented)', Math.abs(R1.distanceM - drawn) / drawn < 0.03, `${R1.distanceM} m vs ${Math.round(drawn)} m drawn`);
  const sN = R1.startPoint || {};
  const eN = R1.endPoint || {};
  ok('start/end fall out of the drawn line instead of being declared',
    Math.abs((sN.lat ?? NaN) - PATH[0].lat) < 1e-6 && Math.abs((eN.lat ?? NaN) - PATH[PATH.length - 1].lat) < 1e-6,
    `${sN.lat},${sN.lng} → ${eN.lat},${eN.lng}`);
  ok('the derived ends are named after the nearest stop',
    sN.name === 'USeP Obrero' && eN.name === 'Bajada Flyover', `${sN.name} → ${eN.name}`);

  console.log('\n── freeform route: a drawn line needs no stops at all ──');
  const bareRes = await api('/api/routes', 'POST', { name: QA.bare, path: PATH });
  ok('a bare drawn line is a valid route', bareRes.status === 201, 'HTTP ' + bareRes.status);
  const BARE = bareRes.body.route || {};
  ok('…it stores zero stops', (BARE.stops || []).length === 0, (BARE.stops || []).length + ' stops');
  ok('…its ends stay unnamed when no stop sits on them',
    (BARE.startPoint || {}).name === null && (BARE.endPoint || {}).name === null,
    `${(BARE.startPoint || {}).name} → ${(BARE.endPoint || {}).name}`);
  ok('…and it is not called a loop when the ends are apart', BARE.isLoop === false, 'isLoop=' + BARE.isLoop);
  const noPathRes = await api('/api/routes', 'POST', { name: QA.bare + ' 2', path: [{ lat: 7.09, lng: 125.61 }] });
  ok('a line shorter than two points is rejected', noPathRes.status === 422,
    'HTTP ' + noPathRes.status + ' ' + JSON.stringify((noPathRes.body || {}).errors || ''));
  const closedRes = await api('/api/routes', 'POST', { name: QA.bareLoop, path: LOOP_PATH });
  ok('a closed drawn line counts as a loop with no stops at all',
    closedRes.status === 201 && closedRes.body.route.isLoop === true,
    'isLoop=' + ((closedRes.body.route || {}).isLoop));
  await api('/api/routes/' + ((closedRes.body.route || {}).id || 'x'), 'DELETE');
  await api('/api/routes/' + (BARE.id || 'x'), 'DELETE');

  s = await state();
  ok('the route reaches the shared state every screen reads', s.routes.some((r) => r.id === R1.id));

  console.log('\n── the route creator refuses junk (§32) ──');
  ok('a blank name is refused', (await api('/api/routes', 'POST', { name: '   ', stops: STOPS, path: PATH })).status === 422);
  const noGeo = await api('/api/routes', 'POST', { name: 'QA No Geometry' });
  ok('a route with no stops and no path is refused', noGeo.status === 422, JSON.stringify(noGeo.body).slice(0, 80));

  console.log('\n── admin registers a jeepney and assigns it (§7, §22) ──');
  const devRes = await api('/api/devices', 'POST', { name: QA.device, routeId: R1.id, type: 'Traditional' });
  ok('the jeepney is created', devRes.status === 201, 'HTTP ' + devRes.status);
  const D1 = devRes.body.device;
  ok('it is assigned to the route', D1.routeId === R1.id && D1.routeName === QA.route);
  ok('it has no position before any GPS arrives', !D1.position, JSON.stringify(D1.position));
  ok('it is not reported as live', D1.online === false && !D1.lastUpdated, `status=${D1.status}`);

  console.log('\n── a phone reports real GPS (§9, §10, §13, §14) ──');
  const routeTotalM = pathLength(PATH);
  const startM = routeTotalM * 0.42;                       // just short of Victoria Plaza
  const stepM = 20;                                  // ~20 m every 3.2 s ~= 22 km/h
  const sent = [];
  let lastDev = null;
  let landmarkHit = null;
  for (let i = 0; i < 11; i++) {
    const point = walk(PATH, startM + i * stepM);
    sent.push(point);
    const res = await sendFix(D1.id, point, { speed: 22, heading: 75 });
    if (i === 0) {
      ok('the first fix is accepted', res.status === 200 && res.body.ok === true, JSON.stringify(res.body).slice(0, 80));
      ok('the marker lands where the phone said (within GPS noise)', haversine(point, res.body.device.position) < 30, Math.round(haversine(point, res.body.device.position)) + ' m off');
    }
    lastDev = res.body.device;
    if (lastDev.landmark && !landmarkHit) landmarkHit = lastDev.landmark;
    if (i < 10) await sleep(3200);
  }
  ok('the jeepney reads as online while fixes arrive', lastDev.online === true && lastDev.status === 'online', `status=${lastDev.status}`);
  ok('it is matched to the nearest stop ("Near X")', !!landmarkHit && landmarkHit.name === 'Victoria Plaza', landmarkHit ? landmarkHit.name + ' at ' + Math.round(landmarkHit.distM) + ' m' : 'no landmark');
  assertSane('telemetry', lastDev);
  const travelled = haversine(sent[0], sent[sent.length - 1]) > 0;
  ok('it really moved along the road it was sent down', lastDev.s > routeTotalM * 0.42 && lastDev.s < routeTotalM * 0.75 && travelled, `s=${Math.round(lastDev.s)} of ${Math.round(routeTotalM)} m`);

  const measuredKmh = ((stepM * 10) / ((11 - 1) * 3.2)) * 3.6;
  ok('average speed comes from the observed movement, not a constant', lastDev.speedReady === true && Math.abs(lastDev.speedKmh - measuredKmh) / measuredKmh < 0.35, `reported ${lastDev.speedKmh.toFixed(1)} km/h, measured ${measuredKmh.toFixed(1)} km/h`);
  const expectEta = lastDev.distanceToEndM / (lastDev.speedKmh / 3.6);
  ok('ETA is remaining distance ÷ that average speed', Math.abs(lastDev.etaSecToEnd - expectEta) / expectEta < 0.2, `ETA ${Math.round(lastDev.etaSecToEnd)} s vs ${Math.round(expectEta)} s`);
  ok('the speed window is the ~60 s rolling window', lastDev.speedWindowSec >= 25 && lastDev.speedWindowSec <= 62, `${lastDev.speedWindowSec.toFixed(1)} s of history`);

  console.log('\n── a bad fix must never teleport the jeepney (§24, §29) ──');
  const before = (await state()).devices.find((d) => d.id === D1.id);
  const jump = { lat: before.position.lat + 0.03, lng: before.position.lng + 0.03 };
  const jumpRes = await sendFix(D1.id, jump, { speed: 400 });
  ok('an impossible jump is rejected', jumpRes.body.ok === false && /implausible/.test(jumpRes.body.skipped || ''), jumpRes.body.skipped);
  const after = (await state()).devices.find((d) => d.id === D1.id);
  ok('the jeepney stays where it was', haversine(before.position, after.position) < 1, Math.round(haversine(before.position, after.position)) + ' m moved');

  console.log('\n── malformed frames are refused, not crashed on (§25, §33) ──');
  ok('non-numeric coordinates', (await api(`/api/devices/${D1.id}/location`, 'POST', { lat: 'abc', lng: 125.6 })).status === 400);
  ok('out-of-range coordinates', (await api(`/api/devices/${D1.id}/location`, 'POST', { lat: 91, lng: 125.6 })).status === 400);
  ok('a missing coordinate', (await api(`/api/devices/${D1.id}/location`, 'POST', { lat: 7.09 })).status === 400);
  ok('an unknown device', (await api('/api/devices/does-not-exist/location', 'POST', { lat: 7.09, lng: 125.6 })).status >= 400);
  ok('the backend is still healthy after all that', (await api('/api/health')).body.ok === true);

  console.log('\n── the vehicle goes quiet (§26, §10) ──');
  await sleep(14000);
  let quiet = (await state()).devices.find((d) => d.id === D1.id);
  ok('it stops reading as online once fixes stop', quiet.online === false, `status=${quiet.status}, age ${Math.round(quiet.ageMs / 1000)} s`);
  ok('the last known position is retained', !!quiet.position && haversine(quiet.position, after.position) < 1);
  await sleep(19000);
  quiet = (await state()).devices.find((d) => d.id === D1.id);
  ok('after the timeout it reads as offline', quiet.status === 'offline' && quiet.ageMs >= 30000, `${quiet.status}, last updated ${Math.round(quiet.ageMs / 1000)} s ago`);
  assertSane('connection lost', quiet);

  console.log('\n── tracking resumes (§27) ──');
  const resumePoint = walk(PATH, startM + 12 * stepM);
  const resumed = await sendFix(D1.id, resumePoint, { speed: 21 });
  ok('the next fix brings it back online', resumed.body.ok === true && resumed.body.device.online === true);
  ok('the new position is used (not the stale one)', haversine(resumePoint, resumed.body.device.position) < 30);
  const dev1 = resumed.body.device;
  ok('route progress kept going instead of resetting', dev1.s > lastDev.s, `s ${Math.round(lastDev.s)} → ${Math.round(dev1.s)}`);
  ok('the ETA was recomputed from the new position', dev1.etaSecToEnd !== lastDev.etaSecToEnd);

  console.log('\n── reassignment leaves no stale link (§28) ──');
  const R2res = await api('/api/routes', 'POST', { name: QA.route2, stops: [...STOPS].reverse().map((st, i) => ({ ...st, order: i + 1 })), path: [...PATH].reverse() });
  const R2 = R2res.body.route;
  await api('/api/devices/' + D1.id, 'PATCH', { routeId: R2.id });
  s = await state();
  let moved = dev(s, D1.id);
  ok('the jeepney now belongs to the second route', moved.routeId === R2.id && moved.routeName === QA.route2);
  ok('the old route no longer lists it', s.devices.filter((d) => d.routeId === R1.id).length === 0);
  ok('progress is reset instead of carrying the old route\'s numbers', !moved.s || moved.s === 0, 's=' + moved.s);
  const afterMove = await sendFix(D1.id, walk(PATH, routeTotalM * 0.6), { speed: 20 });
  ok('its new numbers are measured on the new route', afterMove.body.device.progressPct > 0 && afterMove.body.device.routeTotalM > 0);
  await api('/api/devices/' + D1.id, 'PATCH', { routeId: R1.id });

  console.log('\n── loop route: the wrap stays honest (§15, §18) ──');
  const loopRes = await api('/api/routes', 'POST', { name: QA.loop, stops: [{ name: 'Loop Start', latitude: LOOP_PATH[0].lat, longitude: LOOP_PATH[0].lng, order: 1, type: 'stop' }], path: LOOP_PATH, isLoop: true });
  const LOOP = loopRes.body.route;
  ok('a loop route (start = end) is accepted', loopRes.status === 201 && LOOP.isLoop === true);
  const loopDev = (await api('/api/devices', 'POST', { name: QA.loopDevice, routeId: LOOP.id, type: 'Modern' })).body.device;
  const loopTotal = pathLength(LOOP_PATH);
  // walk up to the seam and across it at a believable speed (20 m every 3.2 s)
  const offsets = [loopTotal - 100, loopTotal - 80, loopTotal - 60, loopTotal - 40, loopTotal - 20, 20, 40];
  const seen = [];
  let allAccepted = true;
  for (let i = 0; i < offsets.length; i++) {
    const res = await sendFix(loopDev.id, walk(LOOP_PATH, offsets[i]), { speed: 24 });
    if (!(res.body.ok === true)) allAccepted = false;
    seen.push(res.body.device);
    if (i < offsets.length - 1) await sleep(3200);
  }
  const beforeSeam = seen[4];
  const wrap = seen[5];
  ok('every fix around the seam is accepted', allAccepted, seen.map((d, i) => `${offsets[i]}m→s=${Math.round(d.s)}`).join(' '));
  ok('the jeepney is near the end before the seam', beforeSeam.s > loopTotal * 0.9, `s=${Math.round(beforeSeam.s)} of ${Math.round(loopTotal)} m`);
  ok('crossing the start/end point wraps to the beginning', wrap.s < loopTotal * 0.25 && wrap.s >= 0, `s=${Math.round(wrap.s)} of ${Math.round(loopTotal)} m`);
  ok('the distance left resets to nearly the whole loop', wrap.distanceToEndM > loopTotal * 0.9, `${Math.round(wrap.distanceToEndM)} m left`);
  ok('progress never goes negative or past the route', seen.every((d) => d.s >= 0 && d.s <= loopTotal + 1 && d.progressPct >= 0 && d.progressPct <= 100));
  ok('the distance left stays inside the loop', seen.every((d) => d.distanceToEndM >= 0 && d.distanceToEndM <= loopTotal + 1));
  assertSane('loop', seen[seen.length - 1]);

  console.log('\n── deletes cascade cleanly (§30, §31) ──');
  await api('/api/devices/' + loopDev.id, 'DELETE');
  await api('/api/routes/' + LOOP.id, 'DELETE');
  await api('/api/routes/' + R2.id, 'DELETE');
  s = await state();
  ok('the deleted route is gone', !s.routes.some((r) => r.id === LOOP.id || r.id === R2.id));
  ok('no device points at a deleted route', s.devices.every((d) => !d.routeId || s.routes.some((r) => r.id === d.routeId)));
  ok('deleting something twice fails gracefully', (await api('/api/routes/' + LOOP.id, 'DELETE')).status === 404);

  console.log('\n── fixtures for the restart test (§3) ──');
  const pr = await api('/api/routes', 'POST', { name: QA.persistRoute, stops: STOPS, path: PATH });
  const pd = await api('/api/devices', 'POST', { name: QA.persistDevice, routeId: pr.body.route.id, type: 'Traditional' });
  ok('persistence fixtures created', pr.status === 201 && pd.status === 201);
  await sleep(900); // let the write land before the process is restarted

  console.log(`\n═══ qa_release: ${passed}/${total} checks passed ═══`);
  if (failures.length) {
    console.log('\nfailed checks:');
    failures.forEach((f) => console.log('  · ' + f));
  }
  console.log('\nnext: restart the backend, then run  node tools/qa_release.js --verify-persist\n');
  process.exit(passed === total ? 0 : 1);
})();
