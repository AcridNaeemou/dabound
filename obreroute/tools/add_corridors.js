/**
 * add_corridors.js — seed helper.
 *
 * Gives every seeded route a hand-drawable "route area" polygon (spec 41-44):
 * a ~110 m wide buffer around the stored driving path, simplified to a handful
 * of corner points so an admin can drag them in the route editor.
 *
 * Run:  node tools/add_corridors.js        (writes data/demo.json in place)
 */
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'demo.json');
const WIDTH_M = 110;

function offsetPolyline(points, metres) {
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dLat = next.lat - prev.lat;
    const dLng = (next.lng - prev.lng) * Math.cos((points[i].lat * Math.PI) / 180);
    const len = Math.hypot(dLat, dLng) || 1e-9;
    const nx = -dLng / len;
    const ny = dLat / len;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((points[i].lat * Math.PI) / 180);
    const cos = Math.cos((points[i].lat * Math.PI) / 180);
    left.push({ lat: points[i].lat + (ny * metres) / mPerDegLat, lng: points[i].lng + (nx * metres) / mPerDegLng });
    right.push({ lat: points[i].lat - (ny * metres) / mPerDegLat, lng: points[i].lng - (nx * metres) / mPerDegLng });
    void cos;
  }
  return left.concat(right.reverse());
}

function simplify(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
let done = 0;
for (const route of seed.routes) {
  const path = route.path || [];
  if (path.length < 2) continue;
  const ring = route.isLoop ? path.concat([path[0]]) : path;
  const simplified = simplify(ring, route.isLoop ? 6 : 5);
  route.corridor = offsetPolyline(simplified, WIDTH_M).map((p) => ({
    lat: +p.lat.toFixed(6),
    lng: +p.lng.toFixed(6),
  }));
  done++;
}
fs.writeFileSync(SEED, JSON.stringify(seed, null, 2));
console.log('corridors written for ' + done + ' routes, ' + WIDTH_M + ' m wide');
