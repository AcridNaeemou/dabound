/**
 * qa_storage.js — proves the Supabase storage path without a Supabase account.
 *
 * It starts tools/mock_supabase.js (a PostgREST stand-in), runs the real backend
 * against it, and then does the thing that matters for a Render free-tier deploy:
 * it wipes the app's disk and restarts, to prove the routes and jeepneys come back
 * from the database instead of from the file. It also proves the app keeps working
 * — and says so honestly — while the database is unreachable.
 *
 * Run:  node tools/qa_storage.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOCK_PORT = 54321;
const MOCK_KEY = 'test-service-key';
const APP_PORT = 8093;
const SB_URL = `http://127.0.0.1:${MOCK_PORT}`;
const DEMO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0;
let passed = 0;
function ok(name, cond, extra) {
  total++;
  if (cond) passed++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

async function http(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { status: res.status, body };
}
const api = (p, method, body) =>
  http(`http://127.0.0.1:${APP_PORT}${p}`, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
const storeDump = () => http(`http://127.0.0.1:${MOCK_PORT}/__store`).then((r) => r.body);

function startMock() {
  const c = spawn('node', [path.join(__dirname, 'mock_supabase.js')], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  c.stdout.on('data', (d) => (log += d));
  c.stderr.on('data', (d) => (log += d));
  c.log = () => log;
  return c;
}

function startApp(dataDir) {
  const c = spawn('node', [path.join(ROOT, 'server.js')], {
    // ADMIN_KEY=none keeps this harness on the open one-tap admin path; the
    // PIN-locked behaviour is covered by the targeted gate tests instead.
    env: { ...process.env, ADMIN_KEY: 'none', PORT: String(APP_PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, SUPABASE_URL: SB_URL, SUPABASE_SERVICE_KEY: MOCK_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  c.stdout.on('data', (d) => (log += d));
  c.stderr.on('data', (d) => (log += d));
  c.log = () => log;
  return c;
}

async function waitForHealth(tries) {
  for (let i = 0; i < (tries || 40); i++) {
    try {
      const r = await api('/api/health');
      if (r.status === 200) return r.body;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  return null;
}
async function waitForMock(tries) {
  for (let i = 0; i < (tries || 40); i++) {
    try {
      const r = await http(`http://127.0.0.1:${MOCK_PORT}/__store`);
      if (r.status === 200) return true;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  return false;
}
const kill = async (child) => {
  if (!child) return;
  child.kill('SIGTERM');
  await sleep(600);
};

(async () => {
  console.log('\n── storage: Supabase mirror ───────────────────────');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dabound-qa-store-'));
  let mock = null;
  let app = null;

  try {
    mock = startMock();
    ok('mock Supabase answers', await waitForMock());

    /* ---------------------------------------------------------- first boot */
    app = startApp(dataDir);
    const health = await waitForHealth();
    ok('the app starts with Supabase configured', !!health, health ? `driver=${health.storage.driver}` : 'no answer');
    ok('it reports Supabase as the storage driver', health && health.storage.driver === 'supabase');
    ok('it connected and loaded', health && health.storage.ok === true && health.storage.loaded === true);
    ok('the boot log says so', /storage: supabase — connected/.test(app.log()));

    let dump = await storeDump();
    ok('an empty project gets the 16 destination suggestions', dump.destinations.length === 16, `${dump.destinations.length} rows`);
    ok('but no routes or jeepneys are invented', dump.routes.length === 0 && dump.jeepneys.length === 0);

    /* ------------------------------------------------- create real records */
    const routeBody = { ...DEMO.routes[0], name: 'QA Storage Route' };
    delete routeBody.id;
    delete routeBody.createdAt;
    const created = await api('/api/routes', 'POST', routeBody);
    ok('admin creates a route', created.status === 201, 'HTTP ' + created.status);
    const routeId = created.body.route.id;

    const devBody = { name: 'QA Storage Jeepney', type: 'Traditional', routeId: routeId };
    const devRes = await api('/api/devices', 'POST', devBody);
    ok('admin registers a jeepney on it', devRes.status === 201, 'HTTP ' + devRes.status);
    const devId = devRes.body.device.id;

    await sleep(1600); // the write is debounced by a moment on purpose
    dump = await storeDump();
    ok('the route is in the database', dump.routes.some((r) => r.id === routeId && r.name === 'QA Storage Route'));
    ok('the jeepney is in the database, attached to that route', dump.jeepneys.some((j) => j.id === devId && j.route_id === routeId));
    ok('the row keeps the full route (stops + road geometry)', (() => {
      const row = dump.routes.find((r) => r.id === routeId);
      return !!(row && row.data.stops && row.data.stops.length && row.data.path && row.data.path.length > 10);
    })());

    /* ------------------------------------------------------- live position */
    const p = DEMO.routes[0].path[12];
    await api(`/api/devices/${devId}/location`, 'POST', {
      lat: p.lat, lng: p.lng, timestamp: Date.now(), speedKmh: 18, heading: 90, accuracy: 8,
    });
    await sleep(10500); // positions are written on a slower beat than config
    dump = await storeDump();
    const posRow = dump.jeepneys.find((j) => j.id === devId);
    ok('the last known GPS position is written to the jeepney row',
      !!(posRow && posRow.data.lastFix && Math.abs(posRow.data.lastFix.lat - p.lat) < 0.001),
      posRow && posRow.data.lastFix ? `${posRow.data.lastFix.lat.toFixed(5)}, ${posRow.data.lastFix.lng.toFixed(5)}` : 'no position');

    /* ------------------------------- the Render case: disk gone, restart -- */
    console.log('\n── the free-tier case: the disk is wiped, the database is not ──');
    await kill(app);
    fs.rmSync(dataDir, { recursive: true, force: true });
    ok('the app disk no longer exists', !fs.existsSync(dataDir), dataDir);

    app = startApp(dataDir);
    const health2 = await waitForHealth();
    ok('it starts again on an empty disk', !!health2);
    ok('and loads from the database', /supabase: 1 routes · 1 devices · 16 destinations/.test(app.log()), (app.log().match(/supabase: .*/) || [''])[0].trim());

    const state = (await api('/api/state')).body;
    ok('the route came back', state.routes.some((r) => r.id === routeId && r.name === 'QA Storage Route'), `${state.routes.length} route(s)`);
    ok('the jeepney came back, still assigned', state.devices.some((d) => d.id === devId && d.routeId === routeId));
    ok('its last known position survived too', state.devices.some((d) => d.id === devId && d.position && Math.abs(d.position.lat - p.lat) < 0.01));
    ok('the destinations are still there', state.destinations.length === 16);

    /* ------------------------------------------------- database unreachable */
    console.log('\n── the database goes away: honest degradation ──');
    await kill(mock);
    const outage = await api('/api/routes', 'POST', { ...routeBody, name: 'QA Offline Route' });
    ok('the admin can still create a route while the database is down', outage.status === 201, 'HTTP ' + outage.status);
    // force a real write instead of guessing how long the debounce needs
    await api('/api/storage', 'POST');
    const health3 = (await api('/api/health')).body;
    ok('the app reports the database as not connected', health3.storage.ok === false);
    ok('and says why', /HTTP|fetch|abort/i.test(health3.storage.lastError || ''), (health3.storage.lastError || '').slice(0, 60));
    const state3 = (await api('/api/state')).body;
    ok('the route is still served from memory (nothing lost silently)', state3.routes.length === 2);

    await kill(app);
    app = startApp(dataDir);
    const health4 = await waitForHealth();
    ok('a restart with the database down still boots and serves', !!health4 && health4.ok === true);
    ok('it is honest about not being connected', health4.storage.ok === false && health4.storage.loaded === false);
    const state4 = (await api('/api/state')).body;
    ok('both routes are still there (local cache)', state4.routes.length === 2, state4.routes.map((r) => r.name).join(', '));

    /* ------------------------------------------- database comes back ------- */
    console.log('\n── the database comes back ──');
    mock = startMock();
    await waitForMock();
    await sleep(22000); // the app retries on a timer
    const health5 = (await api('/api/health')).body;
    ok('the app reconnects on its own', health5.storage.ok === true && health5.storage.loaded === true);
    dump = await storeDump();
    ok('and writes this session\'s data into the empty database', dump.routes.length === 2 && dump.jeepneys.length === 1, `${dump.routes.length} routes · ${dump.jeepneys.length} jeepneys in the database`);
  } catch (err) {
    ok('run completed without a harness error', false, String(err && err.message).slice(0, 140));
  } finally {
    await kill(app);
    await kill(mock);
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log(`\n═══ qa_storage: ${passed}/${total} checks passed ═══\n`);
    process.exit(passed === total ? 0 : 1);
  }
})();
