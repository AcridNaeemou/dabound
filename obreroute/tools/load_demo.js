/**
 * load_demo.js — dev/QA helper, NOT part of the product UI.
 *
 * The app ships with no routes and no jeepneys: everything is registered by the
 * admin. This script loads the sample dataset in data/demo.json through the
 * public API so the team can demo or regression-test the full chain without
 * hand-drawing six routes first.
 *
 * Usage:  node tools/load_demo.js [baseUrl] [--simulate]
 *         node tools/load_demo.js                # loads demo.json, stops after
 *         node tools/load_demo.js --simulate     # + starts the DEV simulators
 *         node tools/load_demo.js --clear        # deletes every route + jeepney
 *
 * Against a public deployment that was locked with ADMIN_KEY, pass the key:
 *         ADMIN_KEY=xxxx node tools/load_demo.js https://dabound.onrender.com --simulate
 *         node tools/load_demo.js --clear --key=xxxx
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SIMULATE = args.includes('--simulate');
const CLEAR = args.includes('--clear');
const KEY = (args.find((a) => a.startsWith('--key=')) || '').slice(6) || process.env.ADMIN_KEY || '';

async function api(method, p, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (KEY) headers['x-admin-key'] = KEY;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 200)}`);
  return parsed;
}

(async () => {
  const state = await api('GET', '/api/state');

  if (CLEAR) {
    for (const r of state.routes) await api('DELETE', '/api/routes/' + r.id);
    for (const d of state.devices) await api('DELETE', '/api/devices/' + d.id);
    console.log(`cleared · ${state.routes.length} routes and ${state.devices.length} jeepneys removed`);
    return;
  }

  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'demo.json'), 'utf8'));
  for (const r of demo.routes) {
    if (state.routes.some((x) => x.id === r.id)) continue;
    await api('POST', '/api/routes', {
      id: r.id, name: r.name, color: r.color, stops: r.stops, path: r.path, corridor: r.corridor,
    });
  }
  for (const d of demo.devices) {
    if (state.devices.some((x) => x.id === d.id)) continue;
    await api('POST', '/api/devices', {
      id: d.id, name: d.name, routeId: d.routeId, type: d.type, color: d.color, driver: d.driver, phone: d.phone,
    });
  }
  console.log(`loaded ${demo.routes.length} routes · ${demo.devices.length} jeepneys from data/demo.json`);

  if (SIMULATE) {
    let on = 0;
    for (const d of demo.devices.filter((x) => x.simulate)) {
      await api('POST', `/api/devices/${d.id}/simulate`, { on: true });
      on++;
    }
    console.log(`started ${on} DEV simulator${on === 1 ? '' : 's'} (tap-off per jeepney in the app)`);
  }
})().catch((err) => {
  const msg = String((err && err.message) || err);
  if (/\b401\b/.test(msg)) {
    console.error(
      'This deployment is locked (ADMIN_KEY). Re-run with the key:\n' +
      '  ADMIN_KEY=<key> node tools/load_demo.js <url> [--simulate]'
    );
  } else {
    console.error(msg);
  }
  process.exit(1);
});
