/**
 * qa_load.js — fleet-scale proof for the "hundreds of jeepneys per route" case.
 *
 * Drops a whole simulated fleet (default 300, override with LOAD_N) onto one
 * route, then measures what actually happens while they all drive at once:
 *
 *   • server  — /api/state latency samples, SSE "loc" cadence and payload size,
 *               and whether every simulated jeepney really keeps moving
 *   • browser — the admin live map and the passenger route detail under that
 *               load: marker count, frame rate, capped lists, console errors
 *
 * Run against an OPEN deployment (ADMIN_KEY=none), e.g.
 *   ADMIN_KEY=none node server.js &  node tools/qa_load.js
 */
const BASE = process.argv[2] && /^https?:/.test(process.argv[2]) ? process.argv[2] : 'http://127.0.0.1:8080';
const N = Math.max(10, Math.min(500, parseInt(process.env.LOAD_N || '300', 10) || 300));
const http = require('http');

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

/* one SSE connection, counting "loc" events and their wire size */
function watchStream(ms) {
  return new Promise((resolve) => {
    const events = [];
    let bytes = 0;
    const req = http.get(BASE + '/api/events', (res) => {
      res.on('data', (chunk) => {
        bytes += chunk.length;
        const s = chunk.toString();
        if (s.includes('event: loc')) events.push({ t: Date.now(), b: s.length });
      });
    });
    setTimeout(() => { req.destroy(); resolve({ events, bytes }); }, ms);
  });
}

async function main() {
  console.log(`\n═══ qa_load: ${N} simulated jeepneys on one route ═══`);

  // --- fixtures -------------------------------------------------------------
  const st0 = await api('/api/state');
  for (const r of st0.body.routes) if (r.name === 'QA Load Route') {
    await api('/api/routes/' + r.id + '/fleet', 'DELETE');
    await api('/api/routes/' + r.id, 'DELETE');
  }
  const st1 = await api('/api/state');
  for (const d of st1.body.devices) if (/^Sim \d{3} · /.test(d.name)) await api('/api/devices/' + d.id, 'DELETE');

  const LOOP = (() => {
    const c = { lat: 7.0900, lng: 125.6180 };
    const d = 0.006;
    const corners = [
      { lat: c.lat + d, lng: c.lng - d }, { lat: c.lat + d, lng: c.lng + d },
      { lat: c.lat - d, lng: c.lng + d }, { lat: c.lat - d, lng: c.lng - d },
      { lat: c.lat + d, lng: c.lng - d },
    ];
    const out = [];
    for (let i = 0; i < corners.length - 1; i++) {
      for (let s = 0; s < 15; s++) {
        const a = corners[i], b = corners[i + 1];
        out.push({ lat: +(a.lat + (b.lat - a.lat) * (s / 15)).toFixed(6), lng: +(a.lng + (b.lng - a.lng) * (s / 15)).toFixed(6) });
      }
    }
    out.push(corners[corners.length - 1]);
    return out;
  })();
  const routeRes = await api('/api/routes', 'POST', {
    name: 'QA Load Route',
    stops: [{ name: 'Load Depot', latitude: LOOP[0].lat, longitude: LOOP[0].lng, type: 'stop' }],
    path: LOOP,
  });
  const ROUTE = routeRes.body.route;
  ok('load route created', routeRes.status === 201 && !!ROUTE, 'HTTP ' + routeRes.status);

  // --- drop the fleet -------------------------------------------------------
  const tFleet = Date.now();
  const fleet = await api(`/api/routes/${ROUTE.id}/fleet`, 'POST', { count: N });
  const fleetMs = Date.now() - tFleet;
  ok(`a fleet of ${N} drops in one call`, fleet.status === 201 && fleet.body.created === N,
    `HTTP ${fleet.status}, created=${fleet.body && fleet.body.created} in ${fleetMs} ms`);
  ok('…fast enough to feel like one action', fleetMs < 4000, fleetMs + ' ms');

  const devs0 = (await api('/api/devices')).body.devices.filter((d) => d.routeId === ROUTE.id);
  ok('every fleet jeepney exists and is simulated',
    devs0.length === N && devs0.every((d) => d.simulated), devs0.length + ' devices');
  const spread = (() => {
    const ss = devs0.map((d) => d.s || 0).sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < ss.length; i++) minGap = Math.min(minGap, ss[i] - ss[i - 1]);
    return minGap;
  })();
  ok('the fleet spreads along the line instead of convoying', spread > 1, 'smallest gap ' + Math.round(spread) + ' m');

  // --- measure the server under load ---------------------------------------
  console.log('\n── server under a full fleet ──');
  const streamP = watchStream(12000);
  await sleep(1500);
  const latencies = [];
  for (let i = 0; i < 12; i++) {
    const t = Date.now();
    await api('/api/state');
    latencies.push(Date.now() - t);
    await sleep(500);
  }
  const { events, bytes } = await streamP;
  const gaps = [];
  for (let i = 1; i < events.length; i++) gaps.push(events[i].t - events[i - 1].t);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const perEvent = events.length ? Math.round(bytes / events.length / 1024) : 0;
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
  ok('the location stream keeps its cadence with a full fleet',
    events.length >= 10 && avgGap > 300 && avgGap < 1500,
    `${events.length} loc events, avg gap ${Math.round(avgGap)} ms`);
  ok('each stream update stays a sane payload', perEvent > 0 && perEvent < 600, `≈${perEvent} KB per loc event (${N} jeepneys)`);
  ok('state requests stay quick under load', p95 < 400, `p95 ${p95} ms of ${latencies.length} samples`);

  const devs1 = (await api('/api/devices')).body.devices.filter((d) => d.routeId === ROUTE.id);
  const byId0 = {};
  devs0.forEach((d) => { byId0[d.id] = d; });
  const moved = devs1.filter((d) => byId0[d.id] && Math.abs((d.s || 0) - (byId0[d.id].s || 0)) > 5).length;
  const online = devs1.filter((d) => d.status === 'online').length;
  ok('every jeepney in the fleet keeps driving', moved >= N * 0.95, `${moved}/${N} moved >5 m`);
  ok('…and stays online while doing it', online >= N * 0.95, `${online}/${N} online`);

  // --- measure the browser under load --------------------------------------
  console.log('\n── browser under a full fleet ──');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE + '/#/admin-live', { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const markerCount = await page.evaluate(() => document.querySelectorAll('.mk-jeep-dot').length);
  ok('the live map really draws the whole fleet', markerCount >= N - 2, markerCount + ' jeepney markers');
  const fpsLive = await page.evaluate(() => new Promise((res) => {
    let frames = 0;
    const t0 = performance.now();
    const loop = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else res(Math.round(frames / 3)); };
    requestAnimationFrame(loop);
  }));
  ok('the live map stays interactive with a full fleet', fpsLive >= 15, fpsLive + ' fps (headless, software GL)');

  await page.goto(BASE + '/#/route-detail/' + ROUTE.id, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const cards = await page.locator('#rd-devices [data-device]').count();
  const moreNote = await page.locator('#rd-devices .t-small', { hasText: /more live jeepneys/ }).count();
  ok('the passenger list caps itself instead of painting hundreds of cards',
    cards <= 12 && moreNote === 1, cards + ' cards + ' + moreNote + ' "…and N more" note');
  const fpsRoute = await page.evaluate(() => new Promise((res) => {
    let frames = 0;
    const t0 = performance.now();
    const loop = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else res(Math.round(frames / 3)); };
    requestAnimationFrame(loop);
  }));
  ok('the route detail stays smooth under the fleet', fpsRoute >= 15, fpsRoute + ' fps');

  await page.goto(BASE + '/#/admin-devices', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const rows0 = await page.locator('[data-device]').count();
  await page.waitForTimeout(2500);
  const rows1 = await page.locator('[data-device]').count();
  ok('the jeepney inventory lists the fleet without per-tick rebuilds', rows0 >= N && rows0 === rows1, rows0 + ' rows, stable across ticks');

  ok('no browser errors under load', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');
  await browser.close();

  // --- cleanup ---------------------------------------------------------------
  const clear = await api(`/api/routes/${ROUTE.id}/fleet`, 'DELETE');
  ok('the fleet comes off in one call', clear.status === 200 && clear.body.removed === N, 'removed=' + clear.body.removed);
  const left = (await api('/api/devices')).body.devices.filter((d) => d.routeId === ROUTE.id).length;
  ok('…and leaves nothing behind', left === 0, left + ' left');
  await api('/api/routes/' + ROUTE.id, 'DELETE');

  console.log(`\n═══ qa_load: ${passed}/${total} checks passed ═══`);
  if (failures.length) {
    console.log('\nfailed checks:');
    failures.forEach((f) => console.log('  · ' + f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error('qa_load crashed:', e); process.exit(1); });
