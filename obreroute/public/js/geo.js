/**
 * geo.js — shared geospatial + ETA engine for DaBound.
 *
 * Loaded by BOTH the Node backend (require) and the browser (window.Geo) so the
 * server and the client can never disagree about distance, route progress,
 * landmark matching or ETA.
 *
 * Principles (from the spec):
 *  - ETA is distance/speed, never a straight line to a destination (§26).
 *  - Landmarks are picked from the route's own named stops only (§49).
 *  - Distances are humanised: "150 m away", "1.3 km away" (§64).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var R = 6371000;
  var rad = function (d) { return (d * Math.PI) / 180; };
  var deg = function (r) { return (r * 180) / Math.PI; };

  function haversine(a, b) {
    if (!a || !b) return 0;
    var dLat = rad(b.lat - a.lat);
    var dLng = rad(b.lng - a.lng);
    var s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function bearing(a, b) {
    var y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    var x =
      Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  // --- route path preparation ------------------------------------------------
  // A prepared path is { pts, cum } where cum[i] is the distance from the start
  // of the route to pts[i]. All route geometry maths walks this structure.
  function prepare(path) {
    var pts = (path || []).map(function (p) {
      return { lat: +p.lat, lng: +p.lng };
    });
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
    return { pts: pts, cum: cum, totalM: cum.length ? cum[cum.length - 1] : 0 };
  }

  function pointAt(prep, s) {
    if (!prep.pts.length) return null;
    if (s <= 0) return { lat: prep.pts[0].lat, lng: prep.pts[0].lng };
    if (s >= prep.totalM) {
      var last = prep.pts[prep.pts.length - 1];
      return { lat: last.lat, lng: last.lng };
    }
    var i = 1;
    while (i < prep.cum.length && prep.cum[i] < s) i++;
    var a = prep.pts[i - 1];
    var b = prep.pts[i];
    var segLen = prep.cum[i] - prep.cum[i - 1] || 1;
    var t = (s - prep.cum[i - 1]) / segLen;
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }

  function headingAt(prep, s) {
    var a = pointAt(prep, Math.max(0, s - 12));
    var b = pointAt(prep, Math.min(prep.totalM, s + 12));
    if (!a || !b) return 0;
    return bearing(a, b);
  }

  /**
   * Project a coordinate onto the path (the "current route segment", §58).
   * hintS + windowM keep the projection continuous on self-crossing and loop
   * routes: we look near the last known progress first and only widen if the
   * jeepney has genuinely moved off that stretch.
   */
  function project(prep, p, hintS, windowM) {
    if (!prep.pts.length) return { s: 0, offM: Infinity };
    if (prep.pts.length === 1) return { s: 0, offM: haversine(prep.pts[0], p) };

    var best = { s: 0, offM: Infinity };
    var pass;
    for (pass = 0; pass < 2; pass++) {
      var from = 0, to = prep.totalM;
      if (pass === 0 && typeof hintS === 'number' && isFinite(hintS)) {
        from = Math.max(0, hintS - (windowM || 1500));
        to = Math.min(prep.totalM, hintS + (windowM || 1500));
      } else if (pass === 0) {
        continue; // no hint -> single global pass
      }
      for (var i = 1; i < prep.pts.length; i++) {
        var segStart = prep.cum[i - 1], segEnd = prep.cum[i];
        if (segEnd < from || segStart > to) continue;
        var a = prep.pts[i - 1], b = prep.pts[i];
        var segLen = segEnd - segStart;
        var t = 0;
        if (segLen > 0.01) {
          // equirectangular projection is accurate enough at street scale
          var kx = Math.cos(rad((a.lat + b.lat) / 2));
          var ax = a.lng * kx, ay = a.lat, bx = b.lng * kx, by = b.lat;
          var px = p.lng * kx, py = p.lat;
          var dx = bx - ax, dy = by - ay;
          var denom = dx * dx + dy * dy;
          t = denom > 0 ? ((px - ax) * dx + (py - ay) * dy) / denom : 0;
          t = Math.max(0, Math.min(1, t));
        }
        var proj = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
        var off = haversine(proj, p);
        if (off < best.offM) best = { s: segStart + segLen * t, offM: off };
      }
      if (best.offM < Infinity && (best.offM < 120 || pass === 1)) break;
      best = { s: 0, offM: Infinity }; // widen and retry globally
    }
    return best;
  }

  /** Distance along the route for every named stop (cached by the caller). */
  function stopMetrics(route, prep) {
    var p = prep || prepare(route.path);
    var out = (route.stops || []).map(function (stop) {
      var pr = project(p, { lat: stop.latitude, lng: stop.longitude }, null, null);
      return { stop: stop, s: pr.s, offM: pr.offM };
    });
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }

  /** The next named stop ahead of the current progress (§58). */
  function nextStop(route, s, prep) {
    var metrics = stopMetrics(route, prep);
    for (var i = 0; i < metrics.length; i++) if (metrics[i].s > s + 20) return metrics[i];
    return metrics.length ? metrics[metrics.length - 1] : null;
  }

  /**
   * Nearest named landmark within `radiusM` — the route's own stops only.
   * Returns null when nothing is close, so the UI can fall back to "En route"
   * rather than naming a landmark from another part of the city (§49).
   */
  function landmarkNear(route, position, radiusM) {
    var best = null;
    (route.stops || []).forEach(function (stop) {
      var d = haversine({ lat: stop.latitude, lng: stop.longitude }, position);
      if (!best || d < best.distM) best = { stop: stop, distM: d };
    });
    if (!best) return null;
    return best.distM <= (radiusM || 320) ? best : null;
  }

  // --- ETA -------------------------------------------------------------------
  // remaining road distance / current average speed, with a conservative
  // fallback speed when the reported speed is not usable (§26).
  var DEFAULT_SPEED_KMH = 18;
  var MIN_SPEED_KMH = 4;

  function etaSec(remainingM, speedKmh, fallbackKmh) {
    if (remainingM == null || !isFinite(remainingM)) return null;
    if (remainingM <= 25) return 0;
    var kmh = +speedKmh;
    if (!isFinite(kmh) || kmh < MIN_SPEED_KMH) kmh = fallbackKmh || DEFAULT_SPEED_KMH;
    var mps = kmh / 3.6;
    return remainingM / mps;
  }

  /** Remaining distance from progress s to a target distance-along-route. */
  function remainingTo(prep, s, targetS, isLoop) {
    if (targetS == null) return null;
    var rem = targetS - s;
    if (rem < 0) rem = isLoop ? prep.totalM + rem : 0;
    if (!isLoop && rem < 0) rem = 0;
    return rem;
  }

  // --- presentation helpers (spec §27, §64) ----------------------------------
  /**
   * ETA in commuter language (spec 34, 74-77). While a vehicle is still
   * gathering its first seconds of movement we say "calculating" instead of
   * guessing, and never show NaN / 0 / Infinity.
   */
  function formatEta(sec, device) {
    if (device && device.status && device.status !== 'online') return 'ETA unavailable';
    if (sec == null || !isFinite(sec)) {
      if (device && device.status === 'online' && device.speedReady === false) return 'ETA calculating\u2026';
      return 'ETA unavailable';
    }
    if (sec < 45) return '< 1 min.';
    var mins = Math.round(sec / 60);
    if (mins <= 1) return '1 min.';
    return mins + ' mins.';
  }

  function formatDistance(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 60) return 'at the stop';
    if (m < 1000) return Math.round(m / 10) * 10 + ' m away';
    if (m < 10000) return (m / 1000).toFixed(1) + ' km away';
    return Math.round(m / 1000) + ' km away';
  }

  function formatSpeed(kmh) {
    if (kmh == null || !isFinite(kmh)) return '—';
    return Math.max(0, Math.round(kmh)) + ' km/h';
  }

  function formatRelative(ms) {
    if (ms == null) return 'never';
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 2) return 'just now';
    if (s < 60) return s + ' sec ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' hr ago';
  }

  return {
    R: R,
    haversine: haversine,
    bearing: bearing,
    prepare: prepare,
    pointAt: pointAt,
    haversine: haversine,
    headingAt: headingAt,
    project: project,
    stopMetrics: stopMetrics,
    nextStop: nextStop,
    landmarkNear: landmarkNear,
    etaSec: etaSec,
    remainingTo: remainingTo,
    formatEta: formatEta,
    formatDistance: formatDistance,
    formatSpeed: formatSpeed,
    formatRelative: formatRelative,
    DEFAULT_SPEED_KMH: DEFAULT_SPEED_KMH,
  };
});
