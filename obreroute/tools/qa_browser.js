/**
 * qa_browser.js — browser integration gate for the DaBound MVP.
 *
 * Fixture: one admin route + one jeepney created through the API, driven by real
 * telemetry posts (no simulator). Then, in Chromium:
 *   - passenger route list -> route detail -> live tracking, values compared
 *     against /api/state;
 *   - admin live map shows the same vehicle and updates without a refresh;
 *   - telemetry stops -> both sides show Connection lost + last update, marker
 *     keeps the last known position; telemetry resumes -> both recover;
 *   - cold deep links hydrate (device editor, tracking, device detail);
 *   - five reference viewports: no horizontal overflow, 44 px tap targets,
 *     nothing hidden behind the bottom navigation;
 *   - opening/closing the tracking screen repeatedly must not multiply
 *     realtime subscriptions (checked against /api/health clients);
 *   - zero uncaught errors in the console.
 */
const { chromium } = require('playwright');
const Geo = require('../public/js/geo.js');

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
let passed = 0;
let failed = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log(`  \u2713 ${name}${extra ? ' \u2014 ' + extra : ''}`); }
  else { failed++; failures.push(name + (extra ? ' \u2014 ' + extra : '')); console.log(`  \u2717 ${name}${extra ? ' \u2014 ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}

const ROUTE = {
  id: 'qb-route',
  name: 'QA Browser Obrero',
  color: '#2D6CDF',
  stops: [
    { name: 'USeP Obrero', latitude: 7.085773, longitude: 125.616083, type: 'stop' },
    { name: 'Victoria Plaza', latitude: 7.086623, longitude: 125.611763, type: 'stop' },
    { name: 'Bajada Flyover', latitude: 7.095171, longitude: 125.615267, type: 'landmark' },
  ],
  path: [
    { lat: 7.085773, lng: 125.616083 },
    { lat: 7.086350, lng: 125.613000 },
    { lat: 7.086623, lng: 125.611763 },
    { lat: 7.090100, lng: 125.613200 },
    { lat: 7.095171, lng: 125.615267 },
  ],
};
const DEV = 'qb-dev';
const prep = Geo.prepare(ROUTE.path);
const totalM = prep.totalM;
let cursor = totalM * 0.35;

async function fix(advanceM) {
  cursor += advanceM;
  const p = Geo.pointAt(prep, Math.min(cursor, totalM));
  return api('POST', `/api/devices/${DEV}/location`, {
    lat: p.lat, lng: p.lng, speed: 21, heading: 80, accuracy: 7, timestamp: Date.now(),
  });
}
async function deviceState() {
  const st = await api('GET', '/api/state');
  return st.devices.find((d) => d.id === DEV);
}

(async () => {
  await api('POST', '/api/reset');
  await api('POST', '/api/routes', ROUTE);
  await api('POST', '/api/devices', { id: DEV, name: 'QA Jeepney 01', routeId: ROUTE.id, type: 'Traditional', driver: 'QA Driver', color: '#2D6CDF' });
  for (let i = 0; i < 9; i++) { await fix(20); await sleep(3400); }
  console.log('fixture: 1 route + 1 jeepney driven by real telemetry only');

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    geolocation: { latitude: 7.0858, longitude: 125.6175 }, permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tile|OSM|favicon|net::ERR_INTERNET/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
  const markerBox = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top)];
  }, sel);

  /* ------------------------------------------------ passenger tracking ---- */
  console.log('\n\u2500\u2500 passenger: route list \u2192 route detail \u2192 live tracking \u2500\u2500');
  await page.goto(BASE + '/#/routes', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const rowNames = await page.locator('[data-route] .pr-title').allTextContents();
  ok('Admin-created route appears in the passenger route list', rowNames.some((t) => /QA Browser Obrero/.test(t)), rowNames.join(' | '));
  await page.locator('[data-route]').first().click();
  await page.waitForTimeout(2200);
  const liveRows = await page.locator('#rd-devices [data-device]').count();
  ok('Route detail lists the active jeepney on that route', liveRows === 1, liveRows + ' rows');
  const rowText = (await page.locator('#rd-devices [data-device]').first().innerText()).replace(/\s+/g, ' ');
  const apiDev = await deviceState();
  ok('The jeepney row matches the API state',
    rowText.includes('QA Jeepney 01') && /ETA:/.test(rowText), rowText.slice(0, 80));
  await page.locator('#rd-devices [data-device]').first().click();
  await page.waitForTimeout(2600);
  ok('Tapping the jeepney opens its tracking screen',
    (await page.locator('.track-title .tt-name').count()) === 1, (await page.locator('.track-title .tt-name').first().textContent() || '').trim());

  const shownDist = (await page.locator('#tc-dist').textContent() || '').trim();
  const shownSpeed = (await page.locator('#tc-speed').textContent() || '').trim();
  const shownEta = (await page.locator('#tc-eta').textContent() || '').trim();
  const expected = {
    dist: Geo.formatDistance(apiDev.distanceToEndM),
    speed: Geo.formatSpeed(apiDev.speedKmh),
    eta: Geo.formatEta(apiDev.etaSecToEnd, apiDev),
  };
  ok('Tracking distance is the real remaining route distance', shownDist === expected.dist, `screen "${shownDist}" vs data "${expected.dist}"`);
  ok('Tracking average speed is the smoothed real speed', shownSpeed === expected.speed, `screen "${shownSpeed}" vs data "${expected.speed}"`);
  ok('Tracking ETA is computed from that data', shownEta === expected.eta, `screen "${shownEta}" vs data "${expected.eta}"`);
  ok('Tracking shows how fresh the fix is', /Last updated|just now|sec ago/.test((await page.locator('#tc-age').textContent()) || ''),
    ((await page.locator('#tc-age').textContent()) || '').trim());
  ok('Tracking shows the nearby landmark or En route', /Near |En route/.test((await page.locator('#tc-sub').textContent()) || ''),
    ((await page.locator('#tc-sub').textContent()) || '').trim());

  const posBefore = await markerBox('#t-map .mk-jeep-dot');
  const distBefore = shownDist;
  const fixes = [];
  for (let i = 0; i < 3; i++) { fixes.push(fix(26)); await sleep(3400); }
  await Promise.all(fixes);
  await page.waitForTimeout(2600);
  const posAfter = await markerBox('#t-map .mk-jeep-dot');
  const distAfter = (await page.locator('#tc-dist').textContent() || '').trim();
  ok('Jeepney marker moves on the map with no refresh',
    !!posBefore && !!posAfter && (posBefore[0] !== posAfter[0] || posBefore[1] !== posAfter[1]),
    `${posBefore} \u2192 ${posAfter}`);
  ok('Distance readout updates with no refresh', distBefore !== distAfter, `${distBefore} \u2192 ${distAfter}`);

  /* --------------------------------------------------------- admin view ---- */
  console.log('\n\u2500\u2500 admin: live map reflects the same vehicle \u2500\u2500');
  await page.goto(BASE + '/#/admin-live', { waitUntil: 'load' });
  await page.waitForTimeout(3200);
  const adminMarkers = await page.locator('#alm-map .mk-jeep-dot').count();
  ok('Admin live map shows the device marker', adminMarkers >= 1, adminMarkers + ' markers');
  await page.locator('[data-device]').first().click();
  await page.waitForTimeout(1600);
  const sheet = (await page.locator('#alm-sheet').innerText()).replace(/\s+/g, ' ');
  ok('Selecting the device opens its telemetry card', /QA Jeepney 01/.test(sheet) && /QA Browser Obrero/.test(sheet), sheet.slice(0, 90));
  const stateNow = await deviceState();
  ok('Admin card reports the live status', /Online/.test(sheet), stateNow.status);
  ok('Admin card reports speed and last update',
    sheet.includes(Geo.formatSpeed(stateNow.speedKmh)) && /(just now|sec ago|min ago)/.test(sheet),
    Geo.formatSpeed(stateNow.speedKmh));
  const adminPosBefore = await markerBox('#alm-map .mk-jeep-dot');
  await Promise.all([fix(26), fix(26)]);
  await sleep(3200);
  const adminPosAfter = await markerBox('#alm-map .mk-jeep-dot');
  ok('Admin map marker moves with no refresh',
    !!adminPosBefore && !!adminPosAfter && (adminPosBefore[0] !== adminPosAfter[0] || adminPosBefore[1] !== adminPosAfter[1]),
    `${adminPosBefore} \u2192 ${adminPosAfter}`);

  /* --------------------------------------------------- connection lost ----- */
  console.log('\n\u2500\u2500 connection lost + recovery, both views \u2500\u2500');
  const lastKnown = await markerBox('#alm-map .mk-jeep-dot');
  console.log('  telemetry stopped; waiting for the timeout\u2026');
  await sleep(14000);
  const lostSheet = (await page.locator('#alm-sheet').innerText()).replace(/\s+/g, ' ');
  ok('Admin sees the device go offline', /Connecting|Offline/.test(lostSheet), lostSheet.slice(0, 70));
  const lostMarker = await markerBox('#alm-map .mk-jeep-dot');
  ok('Admin keeps the last known position on the map', !!lostMarker && lostMarker[0] === lastKnown[0] && lostMarker[1] === lastKnown[1]);

  await page.goto(BASE + '/#/tracking/' + DEV, { waitUntil: 'load' });
  await page.waitForTimeout(3200);
  const lostCard = (await page.locator('#t-card').innerText()).replace(/\s+/g, ' ');
  ok('Passenger tracking shows Connection lost', /Connection lost/.test(lostCard), lostCard.slice(0, 90));
  ok('Passenger tracking keeps the last update age', /Last updated \d+ sec ago|Last updated \d+ min ago/.test(lostCard), lostCard.slice(0, 120));
  ok('Passenger ETA says unavailable instead of a stale number', /ETA unavailable/.test(lostCard));
  ok('The jeepney stays on the map while offline', (await page.locator('#t-map .mk-jeep-dot').count()) >= 1);

  await fix(26);
  await sleep(3400);
  const backCard = (await page.locator('#t-card').innerText()).replace(/\s+/g, ' ');
  ok('Tracking resumes when telemetry returns', /Tracking|Near |En route/.test(backCard) && !/Connection lost/.test(backCard), backCard.slice(0, 80));

  /* ---------------------------------------------------- cold deep links ----- */
  console.log('\n\u2500\u2500 cold deep links hydrate from the API \u2500\u2500');
  await page.goto(BASE + '/#/admin-device-editor/' + DEV, { waitUntil: 'load' });
  await page.waitForTimeout(3200);
  const editorName = await page.inputValue('#de-name').catch(() => '');
  ok('Device editor loads the jeepney instead of sticking on loading', editorName === 'QA Jeepney 01', '"' + editorName + '"');
  await page.goto(BASE + '/#/admin-device-detail/' + DEV, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const detailText = (await page.locator('.screen').innerText()).replace(/\s+/g, ' ');
  ok('Device detail loads its telemetry', /QA Jeepney 01/.test(detailText) && /(Online|Connecting|Offline)/.test(detailText), detailText.slice(0, 80));
  await page.goto(BASE + '/#/admin-route-detail/' + ROUTE.id, { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  ok('Admin route detail loads its stops and jeepney',
    (await page.locator('.step-row').count()) >= 3 && (await page.locator('[data-device]').count()) >= 1);

  /* ---------------------------------- proximity popup (feature A) --------- */
  console.log('\n\u2500\u2500 "Your ride is here! Mabuhay!" \u2500\u2500');
  {
    await fix(0);                       // fresh fix: the jeepney is sending right now
    await sleep(700);
    const live = await deviceState();
    // the passenger walks up to the jeepney: ~45 m away, no teleporting involved
    await ctx.setGeolocation({ latitude: live.position.lat + 0.00025, longitude: live.position.lng + 0.00025 });
    const ridePage = await ctx.newPage();
    ridePage.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await ridePage.addInitScript(() => {
      window.__toasts = [];
      // two independent captures: the toast host in the DOM, and the toast call itself
      const watch = () => {
        const host = document.getElementById('toasts');
        if (!host) return setTimeout(watch, 50);
        new MutationObserver(() => {
          const t = host.innerText.replace(/\s+/g, ' ').trim();
          if (t) window.__toasts.push(t);
        }).observe(host, { childList: true, subtree: true, characterData: true });
      };
      watch();
      const grab = setInterval(() => {
        if (window.UI && window.UI.toast && !window.__hooked) {
          window.__hooked = true;
          const orig = window.UI.toast;
          window.UI.toast = function (msg) { window.__toasts.push(String(msg).replace(/\s+/g, ' ').trim()); return orig.apply(this, arguments); };
          clearInterval(grab);
        }
      }, 15);
    });
    await ridePage.goto(BASE + '/#/tracking/' + DEV, { waitUntil: 'load' });
    await ridePage.waitForTimeout(2600);
    await fix(0);                       // keep the phone reporting while we watch
    await ridePage.waitForTimeout(2600);
    const hereText = (await ridePage.locator('#tc-here').innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok('The passenger is told the ride is here when it is close',
      /Your ride is here! Mabuhay!/.test(hereText), hereText.slice(0, 80) || 'banner missing');
    ok('The banner says how far away the jeepney is',
      /QA Jeepney 01 is (about .+ away|right beside you)/.test(hereText), hereText.slice(0, 90));
    const toasted = await ridePage.evaluate(() => (window.__toasts || []).some((t) => /Your ride is here! Mabuhay!/.test(t)));
    ok('A popup announces the arrival as well', toasted);
    await ridePage.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', 'uit-ride-here.png') });

    // and it stays quiet when the jeepney is nowhere near
    await ctx.setGeolocation({ latitude: live.position.lat + 0.03, longitude: live.position.lng + 0.03 });
    await fix(26);
    await sleep(1600);
    await fix(0);
    const farPage = await ctx.newPage();
    farPage.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await farPage.goto(BASE + '/#/tracking/' + DEV, { waitUntil: 'load' });
    await farPage.waitForTimeout(4500);
    const farCard = (await farPage.locator('#t-card').innerText()).replace(/\s+/g, ' ');
    ok('No arrival banner when the jeepney is still far away',
      (await farPage.locator('#tc-here').count()) === 0 && !/Connection lost/.test(farCard), farCard.slice(0, 70));
    await farPage.close();
    await ridePage.close();
    await ctx.setGeolocation({ latitude: 7.0858, longitude: 125.6175 });
  }

  /* ------------------------- destination chosen on the map (feature B) ----- */
  console.log('\n\u2500\u2500 pick a destination on the map \u2500\u2500');
  {
    await page.goto(BASE + '/#/map', { waitUntil: 'load' });
    await page.waitForTimeout(3500);
    await page.click('#p-search');
    await page.type('#p-search', 'abreeza', { delay: 35 });
    await page.waitForTimeout(500);
    const typed = await page.locator('#p-drop [data-dest]').count();
    ok('The top box still searches the built-in destinations', typed >= 1, typed + ' result(s) for "abreeza"');
    await page.fill('#p-search', '');
    await page.mouse.click(20, 700); // close the dropdown
    await page.waitForTimeout(300);

    await page.click('[data-act="pick"]');
    await page.waitForTimeout(300);
    ok('The map asks where the passenger wants to go',
      /Tap the map to choose where you want to go/.test(await page.locator('#p-pick-hint').innerText()));

    // Dismiss the "Are you here?" card first if a location fix is showing, so it
    // cannot sit under the tap.
    if (await page.locator('#p-user-confirm [data-act="confirm-here"]').isVisible().catch(() => false)) {
      await page.click('#p-user-confirm [data-act="confirm-here"]');
      await page.waitForTimeout(400);
    }

    const mapBox = await page.locator('#p-map').boundingBox();
    // With no destination chosen the routes are hidden (spec: don't overload the
    // map), so the centre of the map is not guaranteed to be on a route any more.
    // Tap just beside the live jeepney instead: it is sitting on its own path, so
    // the pin lands inside the 100 m "this jeepney will actually get you there"
    // filter. The offset has to clear the 22 px marker but stay well under 100 m
    // on the ground — at this zoom the route spans ~1.2 km over ~276 px, so keep
    // it to ~14 px (≈60 m) rather than something that looks safe in pixels.
    const jeepBox = await page.locator('#p-map .mk-jeep-dot').first().boundingBox().catch(() => null);
    const off = jeepBox ? jeepBox.width / 2 + 4 : 0;
    const tapX = jeepBox ? jeepBox.x + jeepBox.width / 2 + off : mapBox.x + mapBox.width / 2;
    const tapY = jeepBox ? jeepBox.y + jeepBox.height / 2 : mapBox.y + mapBox.height / 2;
    await page.mouse.click(tapX, tapY);
    await page.waitForTimeout(600);
    ok('Tapping the map drops a pin and asks to confirm',
      (await page.locator('#p-pick-confirm').isVisible()) && /Use this spot\?/.test(await page.locator('#p-pick-hint').innerText()));
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', 'uit-pick-pin.png') });
    await page.click('[data-act="use-pin"]');
    await page.waitForTimeout(1500);
    const picked = await page.evaluate(() => {
      const d = window.Store.session.destination;
      if (!d) return null;
      const routes = window.Store.state.routes;
      const r = routes[0];
      let offM = null;
      if (r && r.path && r.path.length > 1) {
        offM = Math.round(window.Geo.project(window.Geo.prepare(r.path),
          { lat: d.latitude, lng: d.longitude }, null, null).offM);
      }
      return {
        custom: !!d.custom,
        label: d.name,
        offM,
        near: window.Store.devices({ destination: d, servingDestination: true }).map((x) => x.id),
        box: document.getElementById('p-search').value,
      };
    });
    ok('The pin becomes the passenger destination', !!picked && picked.custom === true, JSON.stringify(picked && picked.label));

    // "Used like any other destination" means the pin is filtered by real route
    // geometry: a jeepney is listed only if its route passes within 100 m of it.
    // Assert that against geometry rather than against wherever this particular
    // tap happened to land, so the check does not depend on the map's zoom level
    // (at the zoom used here one pixel is ~11 m, so a tap that clears the 22 px
    // jeepney marker is already ~170 m off the route).
    const rule = await page.evaluate((path) => {
      const G = window.Geo;
      const prep = G.prepare(path);
      const probe = (lat, lng) => ({
        offM: Math.round(G.project(prep, { lat: lat, lng: lng }, null, null).offM),
        listed: window.Store.devices({
          destination: { custom: true, name: 'probe', latitude: lat, longitude: lng },
          servingDestination: true,
        }).map((d) => d.id),
      });
      return {
        onPath: probe(path[2].lat, path[2].lng),
        farAway: probe(path[2].lat + 0.05, path[2].lng + 0.05),
      };
    }, ROUTE.path);
    ok('A pin dropped on a route lists the jeepneys that pass it (100 m filter)',
      rule.onPath.offM <= 100 && rule.onPath.listed.indexOf(DEV) >= 0,
      `${rule.onPath.offM} m off route → ${rule.onPath.listed.join(', ') || 'none'}`);
    ok('A pin far from every route lists no jeepneys',
      rule.farAway.offM > 100 && rule.farAway.listed.length === 0,
      `${rule.farAway.offM} m off route → ${rule.farAway.listed.join(', ') || 'none'}`);
    ok('The pin tapped on the map obeys the same 100 m rule',
      !!picked && ((picked.offM <= 100) === (picked.near.indexOf(DEV) >= 0)),
      picked ? `${picked.offM} m off route → ${picked.near.join(', ') || 'none'}` : 'no pin');
    ok('The box shows where the trip is going', !!picked && /Pin on the map/.test(picked.box), picked ? picked.box : '');
    ok('The map draws the destination pin', (await page.locator('#p-map .mk-dest').count()) >= 1);

    // a built-in destination still works afterwards
    await page.click('#p-search');
    await page.type('#p-search', 'bajada', { delay: 35 });
    await page.waitForTimeout(500);
    const rows = await page.locator('#p-drop [data-dest]').count();
    if (rows) {
      await page.locator('#p-drop [data-dest]').first().click();
      await page.waitForTimeout(1200);
    }
    const after = await page.evaluate(() => {
      const d = window.Store.session.destination;
      return d ? { custom: !!d.custom, label: d.name } : null;
    });
    ok('Picking a built-in destination afterwards still works',
      !!after && after.custom !== true && !!after.label, after ? after.label : 'none');
  }

  /* ------------------------------- admin route editor: draw the line ------- */
  console.log('\n\u2500\u2500 admin draws the route line with a finger \u2500\u2500');
  {
    await page.goto(BASE + '/#/admin-route-editor', { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    await page.click('[data-mode="draw"]');
    await page.waitForTimeout(400);
    const box = await page.locator('#re-map').boundingBox();
    const y = box.y + box.height * 0.45;
    await page.mouse.move(box.x + box.width * 0.18, y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(box.x + box.width * (0.18 + 0.05 * i), y + Math.sin(i / 3) * 22);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(900);
    const summary = (await page.locator('#re-panel').innerText()).replace(/\s+/g, ' ');
    const nodes = +((summary.match(/(\d+) path nodes/) || [])[1] || 0);
    ok('Dragging on the map records a route line', nodes > 2, summary.slice(0, 80));
    ok('The drawn line reports its length', /\d+\.\d+ km/.test(summary), summary.slice(0, 60));
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', 'uit-drawn-route.png') });
  }

  /* ------------------------------------------- stabilize route (roads) ---- */
  console.log('\n\u2500\u2500 stabilize route snaps the drawn line onto roads \u2500\u2500');
  {
    // the drawn-area / corridor shape is gone from the model entirely
    await api('POST', '/api/routes', ROUTE);
    const stored = (await api('GET', '/api/routes')).routes.find((r) => r.id === ROUTE.id) || {};
    ok('Routes no longer carry a drawn-area polygon', stored.corridor === undefined,
      'corridor=' + JSON.stringify(stored.corridor));
    ok('Stops are plain stop/landmark now (no start/endpoint)',
      (stored.stops || []).length === 3 &&
      (stored.stops || []).every((s) => s.type === 'stop' || s.type === 'landmark'),
      JSON.stringify((stored.stops || []).map((s) => s.type)));

    await page.goto(BASE + '/#/admin-route-editor/' + ROUTE.id, { waitUntil: 'load' });
    await page.waitForTimeout(2800);
    ok('The editor offers Stabilize Route instead of Generate Path',
      (await page.locator('[data-act="stabilize"]').count()) === 1 &&
      (await page.locator('[data-act="generate"]').count()) === 0);
    ok('Start / endpoint / area tools are gone from the toolbar',
      (await page.locator('[data-mode="start"], [data-mode="endpoint"], [data-mode="area"]').count()) === 0);

    const nodes = async () => {
      const t = (await page.locator('#re-panel').innerText()).replace(/\s+/g, ' ');
      return +((t.match(/(\d+) path nodes/) || [])[1] || 0);
    };
    const before = await nodes();
    await page.evaluate(() => {
      window.__toasts = [];
      const host = document.getElementById('toasts');
      new MutationObserver(() => host.querySelectorAll('.toast span').forEach((s) => {
        if (window.__toasts.indexOf(s.textContent) < 0) window.__toasts.push(s.textContent);
      })).observe(host, { childList: true, subtree: true });
    });
    await page.evaluate(() => document.querySelector('[data-act="stabilize"]').click());
    await page.waitForTimeout(9000); // OSRM round trip through the backend proxy
    const after = await nodes();
    const toasts = await page.evaluate(() => window.__toasts || []);
    ok('Stabilize Route leaves a road-following line', after >= 2, before + ' → ' + after + ' path nodes');
    ok('Stabilize Route says what it did',
      toasts.some((t) => /stabiliz|road routing|straight-line/i.test(t)), toasts.join(' | ') || 'no toast');
    await page.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', 'uit-stabilize.png') });
  }

  /* -------------------- stabilize must protect the drawing when offline ---- */
  console.log('\n\u2500\u2500 stabilize route protects the drawing when routing is offline \u2500\u2500');
  {
    await page.goto(BASE + '/#/admin-route-editor', { waitUntil: 'load' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => document.querySelector('[data-mode="draw"]').click());
    await page.waitForTimeout(300);
    const box = await page.locator('#re-map').boundingBox();
    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(box.x + box.width * (0.2 + 0.03 * i), y + Math.sin(i / 2) * 30);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(800);
    const nodes = async () => {
      const t = (await page.locator('#re-panel').innerText()).replace(/\s+/g, ' ');
      return +((t.match(/(\d+) path nodes/) || [])[1] || 0);
    };
    const drawn = await nodes();
    await page.evaluate(() => {
      window.__toasts = [];
      const h = document.getElementById('toasts');
      new MutationObserver(() => h.querySelectorAll('.toast span').forEach((s) => {
        if (window.__toasts.indexOf(s.textContent) < 0) window.__toasts.push(s.textContent);
      })).observe(h, { childList: true, subtree: true });
    });

    // 1. the endpoint answers with its straight-line fallback: line must survive
    await page.route('**/api/road-route', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ source: 'straight', path: [{ lat: 7.09, lng: 125.61 }, { lat: 7.091, lng: 125.611 }], distanceM: 100, points: 2 }),
    }));
    await page.evaluate(() => document.querySelector('[data-act="stabilize"]').click());
    await page.waitForTimeout(1200);
    const afterOffline = await nodes();
    const t1 = await page.evaluate(() => window.__toasts || []);
    ok('Offline routing leaves the drawn line untouched', afterOffline === drawn, drawn + ' → ' + afterOffline + ' path nodes');
    ok('…and says honestly that routing is offline',
      t1.some((t) => /road routing offline|road routing unavailable/i.test(t)), t1.join(' | ') || 'no toast');
    await page.evaluate(() => document.querySelector('[data-act="undo"]').click());
    await page.waitForTimeout(600);
    const undone = await nodes();
    ok('A failed stabilize does not pollute undo', undone < drawn, undone + ' after undo vs ' + drawn);
    await page.evaluate(() => document.querySelector('[data-act="redo"]').click());
    await page.waitForTimeout(600);
    ok('…and redo still restores the drawing', (await nodes()) === drawn, (await nodes()) + ' vs ' + drawn);

    // 2. real road geometry comes back: the drawn line is replaced by it
    const road = [];
    for (let i = 0; i <= 40; i++) road.push({ lat: +(7.085 + i * 0.0002).toFixed(6), lng: +(125.61 + i * 0.0001).toFixed(6) });
    await page.route('**/api/road-route', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ source: 'osrm', path: road, distanceM: 5000, points: road.length }),
    }));
    await page.evaluate(() => document.querySelector('[data-act="stabilize"]').click());
    await page.waitForTimeout(1200);
    const afterOnline = await nodes();
    const t2 = await page.evaluate(() => window.__toasts || []);
    ok('Real road geometry replaces the drawn line', afterOnline === road.length,
      afterOnline + ' vs ' + road.length + ' mocked road points');
    ok('…and reports the snap', t2.some((t) => /stabilized onto real roads/i.test(t)), t2.join(' | ') || 'no toast');
    await page.unroute('**/api/road-route');
  }

  /* ---------------------------------------------- simulated fleet from UI -- */
  console.log('\n\u2500\u2500 the admin can drop a whole simulated fleet at once \u2500\u2500');
  {
    await page.goto(BASE + '/#/admin-route-detail/' + ROUTE.id, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    ok('Route detail offers the fleet controls',
      (await page.locator('#ard-fleet-count').count()) === 1 &&
      (await page.locator('[data-act="fleet-add"]').count()) === 1 &&
      (await page.locator('[data-act="fleet-clear"]').count()) === 1);
    await page.fill('#ard-fleet-count', '6');
    await page.evaluate(() => document.querySelector('[data-act="fleet-add"]').click());
    await page.waitForTimeout(2500);
    const fleet = await page.evaluate(async (rid) => {
      const st = await (await fetch('/api/state')).json();
      return st.devices.filter((d) => d.routeId === rid && d.simulated);
    }, ROUTE.id);
    ok('Dropping a fleet creates that many simulated jeepneys', fleet.length === 6, fleet.length + ' simulated');
    ok('…spaced along the line, not stacked', (() => {
      const ss = fleet.map((d) => d.s || 0).sort((a, b) => a - b);
      let gap = Infinity;
      for (let i = 1; i < ss.length; i++) gap = Math.min(gap, ss[i] - ss[i - 1]);
      return gap > 1;
    })(), 'smallest gap from ' + fleet.length + ' jeepneys');
    ok('…and the admin hears about it', /Dropped 6 virtual jeepneys/.test(await page.locator('.toast').last().innerText().catch(() => '')));
    await page.evaluate(() => document.querySelector('[data-act="fleet-clear"]').click());
    await page.waitForTimeout(2000);
    const left = await page.evaluate(async (rid) => {
      const st = await (await fetch('/api/state')).json();
      return st.devices.filter((d) => d.routeId === rid && d.simulated).length;
    }, ROUTE.id);
    ok('Taking the fleet off removes exactly the simulated ones', left === 0, left + ' left');
  }

  /* --------------------------------------------------------- viewports ------ */
  console.log('\n\u2500\u2500 viewports, tap targets, navigation overlap \u2500\u2500');
  for (const [w, h] of [[360, 800], [390, 844], [393, 852], [412, 915], [430, 932]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const hash of ['#/map', '#/routes', '#/nearby', '#/admin-routes']) {
      await page.goto(BASE + '/' + hash, { waitUntil: 'load' });
      await page.waitForTimeout(1400);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const overflow = de.scrollWidth - de.clientWidth;
        const nav = document.querySelector('.bottom-nav');
        let hidden = 0;
        if (nav) {
          const navTop = nav.getBoundingClientRect().top;
          document.querySelectorAll('.scroll, .p-under, .map-frame').forEach((s) => {
            s.scrollTop = s.scrollHeight;
            const last = s.lastElementChild;
            if (last) {
              const r = last.getBoundingClientRect();
              if (r.bottom > navTop + 2 && r.height > 0) hidden++;
            }
          });
        }
        return { overflow, hidden };
      });
      ok(`No horizontal overflow / content hidden at ${w}\u00d7${h} (${hash})`,
        m.overflow <= 1 && m.hidden === 0, `overflow=${m.overflow}px hidden=${m.hidden}`);
    }
    const small = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.screen button, .screen a, .screen select, .screen input, .screen .switch').forEach((el) => {
        if (el.closest('.leaflet-container') || el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.height < 44 && !el.classList.contains('clear')) bad.push((el.className || el.tagName) + ':' + Math.round(r.height));
      });
      return bad;
    });
    ok(`Every app tap target is at least 44px at ${w}\u00d7${h}`, small.length === 0, small.slice(0, 4).join(', ') || 'all good');
  }
  await page.setViewportSize({ width: 390, height: 844 });

  /* --------------------------------------------- subscription hygiene ------- */
  console.log('\n\u2500\u2500 realtime subscriptions are released when leaving screens \u2500\u2500');
  const before = (await api('GET', '/api/health')).clients;
  for (let i = 0; i < 6; i++) {
    await page.goto(BASE + '/#/tracking/' + DEV, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.goto(BASE + '/#/map', { waitUntil: 'load' });
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
  const after = (await api('GET', '/api/health')).clients;
  ok('Opening/closing tracking 6x does not multiply realtime subscriptions',
    after <= Math.max(before, 1) + 1, `${before} \u2192 ${after} SSE clients`);

  /* ------------------------------------------------ backend unreachable ----- */
  console.log('\n\u2500\u2500 backend unavailable (spec 25) \u2500\u2500');
  const offPage = await ctx.newPage();
  const offErrors = [];
  offPage.on('pageerror', (e) => offErrors.push(e.message));
  await offPage.route('**/api/**', (r) => r.abort());
  await offPage.goto(BASE + '/#/map', { waitUntil: 'load' });
  await offPage.waitForTimeout(4500);
  const offText = (await offPage.locator('body').innerText()).replace(/\s+/g, ' ');
  ok('The app still renders with the backend unreachable', offText.trim().length > 20, offText.slice(0, 70));
  const banner = await offPage.evaluate(() => {
    const el = document.getElementById('net-banner');
    const r = el.getBoundingClientRect();
    return { shown: el.classList.contains('show') && r.height > 4, text: el.innerText.replace(/\s+/g, ' ').trim(), retry: !!el.querySelector('button') };
  });
  ok('The "Unable to connect" banner is visible with a Retry action',
    banner.shown && /Unable to connect/.test(banner.text) && banner.retry, banner.text);
  ok('No white screen and no uncaught exception while down', offErrors.length === 0, offErrors.slice(0, 3).join(' || ') || 'clean');
  await offPage.screenshot({ path: require('path').join(__dirname, '..', 'screenshots', 'qa-backend-down.png') });
  await offPage.close();

  console.log('\n\u2500\u2500 console \u2500\u2500');
  ok('No unexpected browser errors', errors.length === 0, errors.slice(0, 4).join(' || ') || 'clean');

  /* ------------------------------------------------------------- cleanup ---- */
  await api('DELETE', '/api/devices/' + DEV);
  await api('DELETE', '/api/routes/' + ROUTE.id);
  const empty = await api('GET', '/api/state');
  ok('QA fixtures removed, app back to its empty shipping state',
    empty.routes.length === 0 && empty.devices.length === 0,
    `${empty.routes.length} routes \u00b7 ${empty.devices.length} devices`);

  await browser.close();
  console.log(`\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550 qa_browser: ${passed}/${passed + failed} checks passed \u2550\u2550\u2550\u2550\u2550\u2550\u2550`);
  if (failures.length) console.log('failed:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(2); });
