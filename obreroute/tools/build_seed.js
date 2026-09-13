#!/usr/bin/env node
/**
 * build_seed.js — regenerates the sample route set in data/demo.json for the DaBound MVP.
 * (The app itself ships empty: data/seed.json holds only searchable destinations.)
 *
 * Route geometry is fetched from the public OSRM router so that demo route
 * polylines follow real Davao roads instead of straight lines. If the network
 * is unavailable the builder falls back to straight-line interpolation.
 *
 * Run:  node tools/build_seed.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'demo.json');
const OSRM = 'https://router.project-osrm.org';

// --- Demo places (approximate real Davao City coordinates) -------------------
const P = {
  usepObrero:      { name: 'USeP Obrero',           lat: 7.085773, lng: 125.616083 },
  victoriaPlaza:   { name: 'Victoria Plaza',        lat: 7.086623, lng: 125.611763 },
  abreeza:         { name: 'Abreeza Mall',          lat: 7.090399, lng: 125.611129 },
  bajadaFlyover:   { name: 'Bajada Flyover',        lat: 7.095171, lng: 125.615267 },
  bajada:          { name: 'Bajada',                lat: 7.099530, lng: 125.610100 },
  smLanang:        { name: 'SM Lanang Premier',     lat: 7.098973, lng: 125.630765 },
  lanang:          { name: 'Lanang',                lat: 7.098316, lng: 125.634662 },
  acacia:          { name: 'Acacia Hotel',          lat: 7.099341, lng: 125.628168 },
  roxasNightMkt:   { name: 'Roxas Night Market',    lat: 7.070415, lng: 125.613373 },
  peoplesPark:     { name: "People's Park",         lat: 7.071040, lng: 125.609000 },
  cityHall:        { name: 'Davao City Hall',       lat: 7.064454, lng: 125.607715 },
  doctorsHospital: { name: 'Davao Doctors Hospital',lat: 7.070439, lng: 125.604410 },
  gaisanoMall:     { name: 'Gaisano Mall of Davao', lat: 7.077625, lng: 125.614147 },
  matinaTownSq:    { name: 'Matina Town Square',    lat: 7.063788, lng: 125.596625 },
  smEcoland:       { name: 'SM City Davao (Ecoland)',lat: 7.048753, lng: 125.588808 },
  sasaWharf:       { name: 'Sasa Wharf',            lat: 7.126527, lng: 125.662711 },
};

// --- Demo route blueprints --------------------------------------------------
// `role` is one of: start | stop | landmark | endpoint
const ROUTE_BLUEPRINTS = [
  {
    id: 'r-obrero-bajada',
    name: 'Obrero - Bajada',
    active: true,
    points: [
      { role: 'start',    place: 'usepObrero' },
      { role: 'landmark', place: 'victoriaPlaza' },
      { role: 'landmark', place: 'abreeza' },
      { role: 'stop',     place: 'bajadaFlyover' },
      { role: 'endpoint', place: 'bajada' },
    ],
  },
  {
    id: 'r-route-4',
    name: 'Route 4',
    active: true,
    points: [
      { role: 'start',    place: 'peoplesPark' },
      { role: 'stop',     place: 'cityHall' },
      { role: 'landmark', place: 'victoriaPlaza' },
      { role: 'endpoint', place: 'smLanang' },
    ],
  },
  {
    id: 'r-ecoland',
    name: 'Ecoland',
    active: true,
    points: [
      { role: 'start',    place: 'cityHall' },
      { role: 'landmark', place: 'matinaTownSq' },
      { role: 'endpoint', place: 'smEcoland' },
    ],
  },
  {
    id: 'r-acacia',
    name: 'Acacia',
    active: true,
    points: [
      { role: 'start',    place: 'roxasNightMkt' },
      { role: 'landmark', place: 'doctorsHospital' },
      { role: 'stop',     place: 'gaisanoMall' },
      { role: 'endpoint', place: 'acacia' },
    ],
  },
  {
    id: 'r-sasa-rcastillo',
    name: 'Sasa via R. Castillo',
    active: true,
    points: [
      { role: 'start',    place: 'roxasNightMkt' },
      { role: 'stop',     place: 'gaisanoMall' },
      { role: 'landmark', place: 'bajadaFlyover' },
      { role: 'stop',     place: 'lanang' },
      { role: 'endpoint', place: 'sasaWharf' },
    ],
  },
  {
    // Loop-capable route: endPoint == startPoint (spec §31). No loop-specific logic.
    id: 'r-bajada-loop',
    name: 'Bajada Loop',
    active: true,
    points: [
      { role: 'start',    place: 'victoriaPlaza' },
      { role: 'landmark', place: 'abreeza' },
      { role: 'stop',     place: 'acacia' },
      { role: 'stop',     place: 'smLanang' },
      { role: 'landmark', place: 'bajadaFlyover' },
      { role: 'endpoint', place: 'victoriaPlaza' },
    ],
  },
];

const DESTINATIONS = [
  { id: 'd-abreeza', place: 'abreeza', routes: ['r-obrero-bajada', 'r-bajada-loop'] },
  { id: 'd-sm-lanang', place: 'smLanang', routes: ['r-route-4', 'r-bajada-loop'] },
  { id: 'd-victoria', place: 'victoriaPlaza', routes: ['r-obrero-bajada', 'r-route-4', 'r-bajada-loop'] },
  { id: 'd-roxas', place: 'roxasNightMkt', routes: ['r-acacia', 'r-sasa-rcastillo'] },
  { id: 'd-peoples-park', place: 'peoplesPark', routes: ['r-route-4'] },
  { id: 'd-city-hall', place: 'cityHall', routes: ['r-route-4', 'r-ecoland'] },
  { id: 'd-smdavao', place: 'smEcoland', routes: ['r-ecoland'] },
  { id: 'd-matina', place: 'matinaTownSq', routes: ['r-ecoland'] },
  { id: 'd-acacia', place: 'acacia', routes: ['r-acacia', 'r-bajada-loop'] },
  { id: 'd-gaisano', place: 'gaisanoMall', routes: ['r-acacia', 'r-sasa-rcastillo'] },
  { id: 'd-doctors', place: 'doctorsHospital', routes: ['r-acacia'] },
  { id: 'd-sasa', place: 'sasaWharf', routes: ['r-sasa-rcastillo'] },
  { id: 'd-lanang', place: 'lanang', routes: ['r-sasa-rcastillo'] },
  { id: 'd-usep', place: 'usepObrero', routes: ['r-obrero-bajada'] },
  { id: 'd-bajada', place: 'bajada', routes: ['r-obrero-bajada'] },
  { id: 'd-bajada-flyover', place: 'bajadaFlyover', routes: ['r-obrero-bajada', 'r-bajada-loop', 'r-sasa-rcastillo'] },
];

// Devices — the MVP needs one; the data model supports many (spec §38-39).
const DEVICES = [
  { id: 'dev-01', name: 'Jeepney 01', routeId: 'r-obrero-bajada', type: 'Traditional', active: true, simulate: true },
  { id: 'dev-02', name: 'Jeepney 02', routeId: 'r-route-4', type: 'Traditional', active: true, simulate: false },
  { id: 'dev-03', name: 'Jeepney 03', routeId: 'r-sasa-rcastillo', type: 'Modern', active: true, simulate: false },
  { id: 'dev-04', name: 'Jeepney 04', routeId: 'r-bajada-loop', type: 'Traditional', active: false, simulate: false },
];

// --- geometry helpers -------------------------------------------------------
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function osrmLeg(from, to) {
  const url = `${OSRM}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.[0]) throw new Error(json.code || 'no route');
    const coords = json.routes[0].geometry.coordinates.map(([lng, lat]) => ({
      lat: +lat.toFixed(6),
      lng: +lng.toFixed(6),
    }));
    return { coords, road: true };
  } catch (e) {
    console.warn(`   ! OSRM failed (${e.message}) — straight line fallback`);
    return { coords: [from, to], road: false };
  }
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.lat - p.lat) > 1e-6 || Math.abs(last.lng - p.lng) > 1e-6) out.push(p);
  }
  return out;
}

(async function main() {
  const routes = [];
  for (const bp of ROUTE_BLUEPRINTS) {
    const stops = bp.points.map((p, i) => {
      const place = P[p.place];
      return {
        id: `${bp.id}-s${i + 1}`,
        routeId: bp.id,
        name: place.name,
        latitude: place.lat,
        longitude: place.lng,
        order: i + 1,
        type: p.role,
      };
    });

    const path = [];
    console.log(`• ${bp.name}`);
    for (let i = 0; i < stops.length - 1; i++) {
      const from = { lat: stops[i].latitude, lng: stops[i].longitude };
      const to = { lat: stops[i + 1].latitude, lng: stops[i + 1].longitude };
      const leg = await osrmLeg(from, to);
      leg.coords.forEach((c, idx) => {
        // keep the exact stop coordinates at leg boundaries
        if (idx === 0 || idx === leg.coords.length - 1) return;
        path.push(c);
      });
      path.push({ lat: to.lat, lng: to.lng });
      await new Promise((r) => setTimeout(r, 350));
    }
    const trimmed = dedupe([{ lat: stops[0].latitude, lng: stops[0].longitude }, ...path]);

    let distanceM = 0;
    for (let i = 1; i < trimmed.length; i++) distanceM += haversine(trimmed[i - 1], trimmed[i]);

    routes.push({
      id: bp.id,
      name: bp.name,
      active: bp.active,
      startPoint: { lat: stops[0].latitude, lng: stops[0].longitude, name: stops[0].name },
      endPoint: {
        lat: stops[stops.length - 1].latitude,
        lng: stops[stops.length - 1].longitude,
        name: stops[stops.length - 1].name,
      },
      stops,
      path: trimmed,
      distanceM: Math.round(distanceM),
      isLoop:
        Math.abs(stops[0].latitude - stops[stops.length - 1].latitude) < 1e-5 &&
        Math.abs(stops[0].longitude - stops[stops.length - 1].longitude) < 1e-5,
      createdAt: new Date().toISOString(),
    });
    console.log(`   ${stops.length} stops · ${trimmed.length} path pts · ${(distanceM / 1000).toFixed(2)} km${routes[routes.length - 1].isLoop ? ' · LOOP' : ''}`);
  }

  const destinations = DESTINATIONS.map((d) => {
    const place = P[d.place];
    return {
      id: d.id,
      name: place.name,
      address: 'Davao City',
      latitude: place.lat,
      longitude: place.lng,
      routeIds: d.routes,
    };
  });

  const seed = {
    generatedAt: new Date().toISOString(),
    routes,
    destinations,
    devices: DEVICES,
  };
  fs.writeFileSync(OUT, JSON.stringify(seed, null, 1));
  console.log(`\n✓ wrote ${OUT} (${routes.length} routes, ${destinations.length} destinations, ${DEVICES.length} devices)`);
})();
