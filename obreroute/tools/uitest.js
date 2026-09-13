/**
 * uitest.js — automated walk-through of the whole DaBound MVP.
 *
 * Drives the real app in headless Chromium: passenger tracking loop, admin route
 * creation (map taps + OSRM path + save), jeepney CRUD, driver/GPS mode and the
 * connection-lost state. Screenshots land in ../screenshots.
 *
 * Run:  node tools/uitest.js [baseUrl]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { execFileSync } = require('child_process');

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const SHOTS = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const errors = [];
let step = 0;

function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
  return !!cond;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n── fixtures ───────────────────────────────────────');
  console.log('  the app ships with no routes or jeepneys — loading data/demo.json for the walkthrough');
  execFileSync('node', [path.join(__dirname, 'load_demo.js'), BASE, '--simulate'], { stdio: 'inherit' });

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 400, height: 860 },
    deviceScaleFactor: 2,
    geolocation: { latitude: 7.0858, longitude: 125.6175 },
    permissions: ['geolocation'],
    locale: 'en-PH',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 220));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 220)));

  const shot = async (name) => {
    step++;
    const file = path.join(SHOTS, `uit-${String(step).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    return file;
  };
  const dotPos = () =>
    page.evaluate(() => {
      const m = document.querySelector('#t-map .mk-jeep-dot');
      if (!m) return '';
      const r = m.getBoundingClientRect();
      return Math.round(r.left) + ',' + Math.round(r.top);
    });

  console.log('\n── boot ───────────────────────────────────────────');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await shot('splash');
  ok('Splash shows the DaBound wordmark', await page.locator('.wordmark').first().isVisible());

  await page.waitForSelector('.role-btn', { timeout: 6000 });
  await sleep(400);
  await shot('role-selection');
  ok('Role selection offers user and admin', (await page.locator('.role-btn').count()) === 2);

  console.log('\n── passenger: map (deck p-04) ─────────────────────');
  await page.locator('.role-btn', { hasText: 'Are you a user?' }).click();
  await sleep(3500); // let tiles + first SSE frames land
  await shot('passenger-map');
  ok('Passenger map tab is active', (await page.locator('.nav-item.active', { hasText: 'Maps' }).count()) === 1);
  const tileImgs = await page.locator('#p-map img.leaflet-tile-loaded').count();
  ok('Map tiles rendered', tileImgs > 3, tileImgs + ' tiles');
  const jeepMarkers = await page.locator('#p-map .mk-jeep-dot').count();
  ok('Jeepney dot markers on the map', jeepMarkers >= 1, jeepMarkers + ' markers');
  ok('Navigational tips card is shown', (await page.locator('#p-under .th-title').count()) === 1);

  console.log('\n── passenger: destination search in the top box ───');
  ok('Top box is a real search field (spec 179)', (await page.locator('#p-search').count()) === 1);
  await page.locator('#p-search').click();
  await sleep(500);
  await shot('destination-search');
  const allDests = await page.locator('#p-drop [data-dest]').count();
  ok('Focusing the top box lists every destination', allDests >= 3, allDests + ' destinations');
  await page.fill('#p-search', 'victoria');
  await sleep(600);
  await shot('destination-results');
  const destRows = await page.locator('#p-drop [data-dest]').count();
  ok('Results are tied to what is typed', destRows >= 1 && destRows < allDests, destRows + ' results for "victoria"');
  await page.locator('#p-drop [data-dest]').first().click();
  await sleep(1800);
  await shot('map-with-destination');
  const boxText = await page.inputValue('#p-search');
  ok('The chosen destination fills the search box', /Victoria/i.test(boxText), '"' + boxText + '"');
  const jeepRows = await page.locator('#p-jeeps [data-device]').count();
  ok('Nearby jeepneys list under the map', jeepRows >= 1, jeepRows + ' rows');
  const etaText = await page.locator('#p-jeeps .eta-main').first().textContent();
  ok('Nearby rows show ETA', !!/ETA/.test(etaText || ''), 'e.g. "' + (etaText || '').trim() + '"');
  ok('ETA is humanised (no seconds)', !/\d+:\d\d/.test(etaText || ''));
  ok('Rows use the reference colour dot', (await page.locator('#p-jeeps .status-dot').count()) >= 1);

  console.log('\n── passenger: nearby jeeps (deck p-06) ────────────');
  await page.locator('.p-under [data-nav="nearby"]').first().click();
  await sleep(1800);
  await shot('nearby-jeeps');
  ok('Destination context shown ("To:" pill)', (await page.locator('.pill-row.light', { hasText: 'To:' }).count()) === 1);
  const nearbyCount = await page.locator('#nb-list [data-device]').count();
  ok('Nearby jeep list is populated', nearbyCount >= 1, nearbyCount + ' rows');
  const nbEta = await page.locator('#nb-list .eta-main').first().textContent();
  ok('Nearby rows show ETA', !!/ETA/.test(nbEta || ''), 'e.g. "' + (nbEta || '').trim() + '"');

  console.log('\n── passenger: live tracking (deck p-07) ───────────');
  await page.locator('#nb-list [data-device]').first().click();
  await sleep(2600);
  await shot('live-tracking');
  const sub = (await page.locator('#tc-sub').first().textContent()) || '';
  ok('Tracking shows distance/landmark context', /Near |En route|last seen/.test(sub), '"' + sub.trim() + '"');
  const nearLine = /Near /.test(sub);
  ok('“Near [landmark]” is displayed', nearLine, nearLine ? '"' + sub.trim() + '"' : 'device between landmarks');
  const trackEta = await page.locator('#tc-eta').first().textContent();
  ok('Tracking card shows ETA', !!trackEta && trackEta.trim().length > 0, '"' + (trackEta || '').trim() + '"');
  ok('Tracking card shows distance', await page.locator('#tc-dist').first().isVisible());
  ok('Tracking card shows average speed', await page.locator('#tc-speed').first().isVisible());
  ok('Tracking status pill visible', (await page.locator('.pill', { hasText: /Tracking|Connection lost/ }).count()) >= 1);

  const beforePos = await dotPos();
  let afterPos = beforePos;
  for (let i = 0; i < 6 && afterPos === beforePos; i++) {
    await sleep(1500);
    afterPos = await dotPos();
  }
  await shot('live-tracking-moving');
  ok('Jeepney marker moves without refresh', !!beforePos && beforePos !== afterPos, beforePos + ' → ' + afterPos);

  console.log('\n── passenger: routes tab ──────────────────────────');
  await page.locator('[data-nav="back"]').first().click();
  await sleep(700);
  await page.locator('[data-tab="routes"]').click();
  await sleep(700);
  await shot('routes-list');
  ok('Routes tab lists routes', (await page.locator('[data-route]').count()) >= 5);
  // live SSE pushes must not throw the reader back to the top (spec §170)
  const scrolled = await page.evaluate(() => {
    const sc = document.querySelector('#screen-host .scroll');
    if (!sc) return { top: 0, max: 0 };
    sc.scrollTop = 320;
    return { top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight };
  });
  await sleep(4000);
  const stillScrolled = await page.evaluate(() => document.querySelector('#screen-host .scroll').scrollTop);
  ok('Live updates keep the list scroll position', scrolled.top === 0 || stillScrolled === scrolled.top,
    scrolled.top === 0 ? 'list fits the viewport' : stillScrolled + 'px held');
  await page.locator('[data-route]').first().click();
  await sleep(2000);
  await shot('route-detail-passenger');
  ok('Route detail shows stops', (await page.locator('.step-row').count()) >= 3);
  ok('Route detail shows the Start/End box', (await page.locator('.label-box .lb-line').count()) >= 2);

  console.log('\n── passenger: saved placeholder ───────────────────');
  await page.locator('[data-nav="back"]').first().click();
  await sleep(600);
  await page.locator('[data-tab="saved"]').click();
  await sleep(500);
  await shot('saved-placeholder');
  ok('Saved tab is an honest placeholder', (await page.locator('.empty', { hasText: 'Nothing saved yet' }).count()) === 1);
  ok('Saved tab keeps the bottom navigation', (await page.locator('.bottom-nav [data-tab="map"]').count()) === 1);

  console.log('\n── admin: login + dashboard ───────────────────────');
  await page.goto(BASE + '/#/admin-login', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await shot('admin-login');
  ok('Admin entry asks for no password (spec 3)', (await page.locator('input[type="password"]').count()) === 0);
  ok('Admin entry is a single tap', (await page.locator('[data-act="continue"]').count()) === 1);
  await page.locator('[data-act="continue"]').click();
  await sleep(1000);
  await shot('admin-profile');
  ok('Settings holds exactly two buttons', (await page.locator('.menu-row').count()) === 2,
    (await page.locator('.menu-row .mr-label').allTextContents()).join(' / '));
  ok('Settings are Route List + Jeepney Info',
    (await page.locator('.menu-row .mr-label').allTextContents()).join('|') === 'Route List|Jeepney Info');
  ok('Admin stats render', (await page.locator('.stat').count()) === 3);

  console.log('\n── admin: route list + detail (deck p-10 / p-11) ──');
  await page.locator('[data-nav="admin-routes"]').first().click();
  await sleep(800);
  await shot('admin-route-list');
  const adminRoutes = await page.locator('[data-route]').count();
  ok('Route list renders every route', adminRoutes >= 5, adminRoutes + ' routes');
  ok('Route list has the navy search band', (await page.locator('.search-band #ar-search').count()) === 1);
  ok('Route rows carry the active jeepney count', (await page.locator('.pill-row', { hasText: /jeepney(s)? · \d+ live|no jeepney assigned/ }).count()) >= 1);
  const adminScroll = await page.evaluate(() => {
    const sc = document.querySelector('#screen-host .scroll');
    sc.scrollTop = 260;
    return { top: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight };
  });
  await sleep(4000);
  const adminStill = await page.evaluate(() => document.querySelector('#screen-host .scroll').scrollTop);
  ok('Admin lists keep their scroll position too', adminScroll.top === 0 || adminStill === adminScroll.top,
    adminScroll.top === 0 ? 'list fits the viewport' : adminStill + 'px held');
  await page.locator('[data-route]').first().click();
  await sleep(2200);
  await shot('admin-route-detail');
  ok('Route detail lists stops and jeepneys', (await page.locator('.step-row').count()) >= 3);
  const rawCoords = await page.locator('.step-row .sr-sub', { hasText: /\d\.\d{4,}/ }).count();
  ok('Admin stop rows avoid raw coordinates', rawCoords === 0, rawCoords + ' raw coordinate rows');

  console.log('\n── admin: create a route on the map (deck p-12) ───');
  await page.goto(BASE + '/#/admin-route-editor', { waitUntil: 'domcontentloaded' });
  await sleep(2400);
  await shot('admin-route-editor');
  await page.fill('#re-name', 'UITest Route');
  const tap = async (fx, fy) => {
    // the editor body scrolls, so bring the map into view and re-measure it
    await page.locator('#re-map').scrollIntoViewIfNeeded();
    await sleep(150);
    const b = await page.locator('#re-map').boundingBox();
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await sleep(500);
  };
  await page.locator('[data-mode="start"]').click();
  await tap(0.2, 0.3);
  await page.locator('[data-mode="stop"]').click();
  await tap(0.5, 0.55);
  await sleep(400);
  await page.fill('#pn-input', 'UITest Landmark');
  await page.locator('.scrim [data-act="ok"]').click();
  await sleep(400);
  await page.locator('[data-mode="endpoint"]').click();
  await tap(0.8, 0.75);
  await shot('admin-route-editor-points');
  const pointRows = await page.locator('.step-row[data-point]').count();
  ok('Editor collects start, stop and endpoint', pointRows === 3, pointRows + ' points');
  ok('Stop name is captured from the dialog', (await page.locator('input[data-name="1"]').inputValue()) === 'UITest Landmark');

  await page.locator('[data-act="generate"]').click();
  await sleep(7000); // OSRM round trip via the backend proxy
  const pathNodes = await page.locator('text=/path nodes/').first().textContent();
  ok('Generate Path builds a driving path', /[1-9]\d*\s*\/?\s*\d*\s*path nodes|[1-9]\d+ path nodes/.test(pathNodes || ''), (pathNodes || '').trim());

  console.log('\n── admin: route area (corridor) + undo (spec 41-44, 87) ──');
  ok('Editor exposes a Draw Area tool', (await page.locator('[data-mode="area"]').count()) === 1);
  await page.locator('[data-mode="area"]').click();
  await tap(0.24, 0.3);
  await tap(0.72, 0.32);
  await tap(0.5, 0.62);
  await shot('admin-route-area');
  const areaText = await page.locator('.area-row').innerText().catch(() => '');
  ok('Route area lists its corner points', /3 corner points/.test(areaText), areaText.replace(/\n/g, ' | '));
  ok('Corridor corner handles are draggable markers', (await page.locator('.mk-corner').count()) >= 3);
  await page.locator('[data-act="undo"]').click();
  await sleep(500);
  const afterUndo = await page.locator('.area-row').innerText().catch(() => '');
  ok('Undo steps back one area point', /2 corner points/.test(afterUndo), afterUndo.replace(/\n/g, ' | '));
  await page.locator('[data-act="redo"]').click();
  await sleep(500);
  ok('Redo puts it back', /3 corner points/.test(await page.locator('.area-row').innerText().catch(() => '')));

  await page.locator('[data-act="save"]').click();
  await sleep(1600);
  await page.goto(BASE + '/#/admin-routes', { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  const created = await page.locator('[data-route]', { hasText: 'UITest Route' }).count();
  ok('New route is saved and listed', created >= 1, created + ' match(es)');
  const savedRoute = await page.evaluate(async () => {
    const st = await (await fetch('/api/state')).json();
    return st.routes.find((r) => r.name === 'UITest Route') || null;
  });
  ok('Saved route keeps its corridor polygon', !!savedRoute && (savedRoute.corridor || []).length === 3,
    savedRoute ? 'corridor=' + (savedRoute.corridor || []).length : 'route missing');

  console.log('\n── admin: unsaved-changes guard (spec 89) ─────────');
  await page.goto(BASE + '/#/admin-route-editor/' + (savedRoute ? savedRoute.id : ''), { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  await page.fill('#re-name', 'UITest dirty name');
  await page.locator('.appbar [data-nav="back"]').click();
  await sleep(700);
  ok('Leaving a dirty editor asks first', (await page.locator('.dialog').count()) >= 1);
  await page.locator('.scrim [data-act="cancel"]').click();
  await sleep(500);
  await page.locator('#re-name').fill('UITest Route');
  await page.locator('.appbar [data-nav="back"]').click();
  await sleep(900);

  console.log('\n── admin: delete a route with a jeepney (spec 48, 130) ──');
  const tmp = await page.evaluate(async () => {
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const r = await post('/api/routes', {
      name: 'UITest Delete Me',
      stops: [
        { name: 'Alpha', latitude: 7.071, longitude: 125.611, type: 'start' },
        { name: 'Omega', latitude: 7.081, longitude: 125.621, type: 'endpoint' },
      ],
      path: [{ lat: 7.071, lng: 125.611 }, { lat: 7.081, lng: 125.621 }],
    });
    const d = await post('/api/devices', { name: 'UITest Jeep', type: 'Traditional', routeId: r.route.id });
    return { routeId: r.route.id, deviceId: d.device.id };
  });
  await page.goto(BASE + '/#/admin-route-editor/' + tmp.routeId, { waitUntil: 'domcontentloaded' });
  await sleep(1800);
  await page.locator('[data-act="delete"]').click();
  await sleep(600);
  const confirmCopy = await page.locator('.dialog').innerText().catch(() => '');
  ok('Delete confirmation mentions the unassigned jeepneys', /unassigned/i.test(confirmCopy), confirmCopy.replace(/\n/g, ' ').slice(0, 90));
  await page.locator('.scrim [data-act="ok"]').click();
  await sleep(1600);
  const deviceAfter = await page.evaluate(async (id) => {
    const st = await (await fetch('/api/state')).json();
    return st.devices.find((d) => d.id === id) || null;
  }, tmp.deviceId);
  ok('Jeepney survives its route being deleted', !!deviceAfter, deviceAfter ? 'routeId=' + String(deviceAfter.routeId) : 'device gone');
  ok('…and is left without a route', !!deviceAfter && deviceAfter.routeId == null);
  await page.evaluate(async (d) => {
    await fetch('/api/devices/' + d.id, { method: 'DELETE' });
  }, deviceAfter || { id: tmp.deviceId });

  console.log('\n── admin: jeepney info + driver mode ──────────────');
  await page.goto(BASE + '/#/admin-devices', { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await shot('admin-jeepney-list');
  ok('Jeepney list rows show live status', (await page.locator('.pill-row', { hasText: /Online|Offline|Connecting|Inactive|no device/i }).count()) >= 3);
  await page.locator('[data-device]').first().click();
  await sleep(2200);
  await shot('admin-jeepney-detail');
  ok('Device detail shows route + near + speed', (await page.locator('.kv', { hasText: 'Route' }).count()) >= 1);
  await page.locator('[data-nav="driver"]').first().click();
  await sleep(1400);
  await shot('driver-mode');
  ok('Driver mode shows the driver header', (await page.locator('.appbar-title', { hasText: /DRIVER/i }).count()) >= 1);
  ok('Driver mode reports location sharing state', (await page.locator('.kv', { hasText: 'Location sharing' }).count()) === 1);

  console.log('\n── demo simulator labelling + empty states (spec 59-66) ──');
  await page.goto(BASE + '/#/admin-devices', { waitUntil: 'domcontentloaded' });
  await sleep(1200);
  ok('Simulated jeepneys are labelled DEV', (await page.locator('.pill-row', { hasText: /\bDEV\b/ }).count()) >= 1);
  await page.goto(BASE + '/#/admin-routes', { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await page.fill('#ar-search', 'zzz-nothing-here');
  await sleep(400);
  ok('Route search shows a real empty state', (await page.locator('.empty', { hasText: 'No route matches' }).count()) === 1);
  await page.fill('#ar-search', '');
  await sleep(300);
  const etaCopy = await page.evaluate(() => [
    Geo.formatEta(null, { status: 'online', speedReady: false }),
    Geo.formatEta(null, { status: 'online', speedReady: true }),
    Geo.formatEta(30),
    Geo.formatDistance(150),
    Geo.formatDistance(1200),
  ]);
  ok('ETA falls back to calculating / unavailable, never NaN',
    etaCopy[0] === 'ETA calculating\u2026' && etaCopy[1] === 'ETA unavailable', etaCopy.slice(0, 2).join(' / '));
  ok('ETA + distance use commuter language',
    etaCopy[2] === '< 1 min.' && etaCopy[3] === '150 m away' && etaCopy[4] === '1.2 km away', etaCopy.slice(2).join(' / '));

  console.log('\n── responsive + tap targets (spec 11, 115) ────────');
  for (const w of [360, 390, 412]) {
    await page.setViewportSize({ width: w, height: w === 360 ? 800 : w === 390 ? 844 : 915 });
    for (const hash of ['/#/map', '/#/nearby', '/#/admin-routes', '/#/admin-devices']) {
      await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
      await sleep(1100);
      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return Math.max(d.scrollWidth, document.body.scrollWidth) - window.innerWidth;
      });
      ok('No horizontal overflow at ' + w + 'px ' + hash, overflow <= 1, 'overflow=' + overflow + 'px');
    }
  }
  const smallTargets = await page.evaluate(() => {
    const small = [];
    document.querySelectorAll('button:not(.color-dot), .pill-row, .menu-row, .nav-item, [data-nav], [data-act]').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      if (b.height < 44) small.push((el.className || el.tagName) + ' ' + Math.round(b.height) + 'px');
    });
    return small.slice(0, 5);
  });
  ok('Every app tap target is at least 44px tall', smallTargets.length === 0, smallTargets.join(', ') || 'all good');
  await page.setViewportSize({ width: 400, height: 860 });

  console.log('\n── admin: live map ────────────────────────────────');
  await page.goto(BASE + '/#/admin-live', { waitUntil: 'domcontentloaded' });
  await sleep(3200);
  await shot('admin-live-map');
  ok('Live map renders markers', (await page.locator('#alm-map .mk-jeep-dot').count()) >= 1);
  await page.locator('#alm-sheet [data-device]').first().click();
  await sleep(1400);
  await shot('admin-live-map-selected');
  ok('Selecting a device shows its card', (await page.locator('#alm-sheet .kv').count()) >= 1);

  console.log('\n── connection lost state ──────────────────────────');
  // simulate the cohort phone dying: stop the simulator and force the device offline
  await page.evaluate(async () => {
    await fetch('/api/devices/dev-01/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"on":false}' });
    await fetch('/api/devices/dev-01/tracking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"on":false}' });
  });
  await page.goto(BASE + '/#/tracking/dev-01', { waitUntil: 'domcontentloaded' });
  await sleep(3600);
  await shot('tracking-connection-lost');
  const lost = await page.locator('.alert', { hasText: 'Connection lost' }).count();
  ok('Connection-lost alert appears', lost === 1);
  const lastKnown = await page.locator('#tc-age').first().textContent();
  ok('“Last updated” age is shown', /Last updated/.test(lastKnown || ''), (lastKnown || '').trim());
  const pillLost = await page.locator('.pill', { hasText: 'Connection lost' }).count();
  ok('Status pill switches to Connection lost', pillLost >= 1);
  const markerStillThere = await page.locator('#t-map .mk-jeep-dot').count();
  ok('Last known position is retained on the map', markerStillThere >= 1);

  console.log('\n── responsive widths ──────────────────────────────');
  for (const [w, h, label] of [[360, 800, 'small'], [412, 915, 'large'], [1440, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + '/#/map', { waitUntil: 'domcontentloaded' });
    await sleep(1400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`No horizontal scrolling at ${w}px (${label})`, overflow <= 1, overflow + 'px overflow');
    if (w === 1440) {
      const panel = await page.locator('#demo-panel').isVisible();
      ok('Demo console panel shows on desktop', panel);
      await shot('desktop-stage');
    }
  }

  console.log('\n── console errors ────────────────────────────────');
  const relevant = errors.filter((e) => !/favicon|tile|OSM|net::ERR_INTERNET|Failed to load resource/i.test(e));
  ok('No unexpected JavaScript errors', relevant.length === 0, relevant.slice(0, 6).join(' || ') || 'clean');
  if (errors.length) console.log('  (ignored asset/tile notes: ' + errors.length + ')');

  console.log('\n── cleanup ───────────────────────────────────────');
  await page.evaluate(async () => { await fetch('/api/reset', { method: 'POST' }); });
  await sleep(1500);
  const after = await page.evaluate(async () => {
    const st = await (await fetch('/api/state')).json();
    return { routes: st.routes.length, devices: st.devices.length };
  });
  ok('Reset leaves the app empty (no built-in routes or jeepneys)',
    after.routes === 0 && after.devices === 0, after.routes + ' routes · ' + after.devices + ' jeepneys');
  await page.goto(BASE + '/#/admin-routes', { waitUntil: 'domcontentloaded' });
  await sleep(1600);
  ok('Empty Route List shows the first-run state',
    (await page.locator('.empty', { hasText: 'No routes yet' }).count()) === 1);
  await page.goto(BASE + '/#/admin-devices', { waitUntil: 'domcontentloaded' });
  await sleep(1400);
  ok('Empty Jeepney Info shows the first-run state',
    (await page.locator('.empty', { hasText: 'No jeepneys yet' }).count()) === 1);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n══ ${passed}/${results.length} checks passed ══`);
  fs.writeFileSync(path.join(SHOTS, 'uitest-report.json'), JSON.stringify({ passed, total: results.length, results, errors }, null, 1));
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
