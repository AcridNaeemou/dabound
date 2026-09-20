/* mapkit.js — Leaflet + OpenStreetMap mapping layer.
 *
 * Light basemap so navy/yellow brand geometry stands out (§72). Marker movement
 * is interpolated (500-2000 ms) so GPS jitter never looks like teleporting
 * (§85, §86) — one shared rAF loop drives every animating marker.
 */
(function () {
  var TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var NAVY = '#173B5C';
  var YELLOW = '#F9C74F';

  var animators = new Map();
  var rafRunning = false;

  /* The bundled Leaflet (1.1.1) draws vector layers on a shared <canvas> because
   * we set preferCanvas. Redraws are queued with requestAnimationFrame, so one can
   * still be pending at the instant a screen unmounts and map.remove() tears the
   * renderer down. When that frame finally fires, the 2D context is gone and
   * `_ctx.clearRect(...)` throws "Cannot read properties of undefined".
   *
   * Guard the two methods that touch the context. _redraw is deliberately left
   * alone so it still clears its own _redrawRequest bookkeeping — otherwise a
   * live renderer could stop scheduling redraws. This is a no-op in every normal
   * frame, where _ctx exists. */
  (function guardCanvasRenderer() {
    if (typeof L === 'undefined' || !L.Canvas || !L.Canvas.prototype) return;
    ['_clear', '_draw'].forEach(function (fn) {
      var proto = L.Canvas.prototype;
      if (typeof proto[fn] !== 'function' || proto[fn].__ctxGuarded) return;
      var original = proto[fn];
      var guarded = function () {
        if (!this._ctx) return;
        return original.apply(this, arguments);
      };
      guarded.__ctxGuarded = true;
      proto[fn] = guarded;
    });
  })();

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

  function tick(ts) {
    var active = false;
    animators.forEach(function (a, id) {
      var t = Math.min(1, (ts - a.start) / a.duration);
      var e = easeInOut(t);
      var lat = a.from.lat + (a.to.lat - a.from.lat) * e;
      var lng = a.from.lng + (a.to.lng - a.from.lng) * e;
      a.marker.setLatLng([lat, lng]);
      if (t < 1) active = true;
      else animators.delete(id);
    });
    if (active) requestAnimationFrame(tick);
    else rafRunning = false;
  }

  function tweenTo(marker, to, duration) {
    var key = L.Util.stamp(marker);
    var cur = marker.getLatLng();
    var rough = window.Geo.haversine({ lat: cur.lat, lng: cur.lng }, to);
    if (rough > 400) { // real jumps snap; the internet did not teleport the jeepney
      animators.delete(key);
      marker.setLatLng([to.lat, to.lng]);
      return;
    }
    animators.set(key, {
      marker: marker,
      from: { lat: cur.lat, lng: cur.lng },
      to: { lat: to.lat, lng: to.lng },
      start: performance.now(),
      duration: duration || Math.max(600, Math.min(2000, rough * 6)),
    });
    if (!rafRunning) {
      rafRunning = true;
      requestAnimationFrame(tick);
    }
  }

  function jeepColor(device) {
    if (device.color) return device.color;
    var route = window.Store && window.Store.routeById ? window.Store.routeById(device.routeId) : null;
    if (route && route.color) return route.color;
    return window.Brand ? window.Brand.colorFor(device.routeId || device.id) : '#D7263D';
  }

  /** Second colour of a two-tone route/jeepney, if one was chosen. */
  function jeepColor2(device) {
    if (device.color2) return device.color2;
    var route = window.Store && window.Store.routeById ? window.Store.routeById(device.routeId) : null;
    return route && route.color2 ? route.color2 : null;
  }

  /**
   * Split a polyline into two halves by travelled distance, so a two-colour route
   * reads as "first half this colour, second half that colour" rather than
   * alternating point by point. The junction point is duplicated in both halves
   * so the stroke stays continuous.
   */
  function splitHalf(pts) {
    if (!pts || pts.length < 2) return [pts || [], []];
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + window.Geo.haversine({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] }));
    }
    var total = cum[cum.length - 1];
    if (!(total > 0)) return [pts, []];
    var half = total / 2;
    var j = 1;
    while (j < cum.length - 1 && cum[j] < half) j++;
    // interpolate the exact midpoint so the split is not visibly lopsided
    var a = pts[j - 1], b = pts[j];
    var segLen = cum[j] - cum[j - 1] || 1;
    var t = (half - cum[j - 1]) / segLen;
    var mid = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [pts.slice(0, j).concat([mid]), [mid].concat(pts.slice(j))];
  }

  function jeepIcon(device, selected) {
    var col = jeepColor(device);
    var col2 = jeepColor2(device);
    var status = device.status === 'offline' ? ' offline' : device.status === 'connecting' ? ' connecting' : '';
    var twoTone = col2 ? ' two-tone' : '';
    var vars = '--mk:' + col + (col2 ? ';--mk2:' + col2 : '');
    if (!selected) {
      return L.divIcon({
        className: 'mk',
        html: '<div class="mk-jeep-dot' + status + twoTone + '" style="' + vars + '"><span class="mk-dot"></span></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
    }
    var route = window.Store && window.Store.routeById ? window.Store.routeById(device.routeId) : null;
    var name = route ? route.name : device.name;
    return L.divIcon({
      className: 'mk',
      html:
        '<div class="mk-jeep-dot selected' + status + twoTone + '" style="' + vars + '">' +
        (device.speedKmh > 3
          ? '<span class="mk-arrow" style="transform:rotate(' + (isFinite(+device.heading) ? Math.round(+device.heading) : 0) + 'deg)"></span>'
          : '') +
        '<span class="mk-dot"></span>' +
        '<span class="mk-name">' + window.UI.esc(name) + '</span>' +
        '</div>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
  }

  function stopIcon(type) {
    if (type === 'landmark') return L.divIcon({ className: 'mk', html: '<div class="mk-landmark"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    return L.divIcon({ className: 'mk', html: '<div class="mk-stop"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  /* A small grab-handle for one vertex of the drawn line. Deliberately plainer
   * than a stop marker so "the line's shape" and "where it stops" read differently. */
  function vertexIcon() {
    return L.divIcon({ className: 'mk', html: '<div class="mk-vertex"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
  }

  /* The reader's own position is a blue dot with a pulsing halo — the universal
   * "you are here" idiom. The destination stays a yellow teardrop pin, so the two
   * can never be mistaken for one another on a busy map. */
  function userIcon(confirmed) {
    return L.divIcon({
      className: 'mk',
      html:
        '<div class="mk-user-wrap' + (confirmed ? ' confirmed' : '') + '">' +
          '<span class="mk-user-halo"></span>' +
          '<span class="mk-user-dot"></span>' +
        '</div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function destIcon() {
    return L.divIcon({
      className: 'mk',
      html: '<div class="mk-dest"><span class="mk-dest-pin"></span><span class="mk-dest-flag">GO</span></div>',
      iconSize: [32, 42],
      iconAnchor: [16, 40],
    });
  }

  function labelIcon(text) {
    return L.divIcon({ className: 'mk', html: '<div class="mk-label">' + text + '</div>', iconSize: [0, 0], iconAnchor: [0, 0] });
  }

  function create(el, opts) {
    opts = opts || {};
    var map = L.map(el, {
      center: opts.center || [7.0858, 125.6175], // Davao City centre
      zoom: opts.zoom || 14,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      tap: true,
    });
    L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR, detectRetina: true }).addTo(map);

    var routeLayer = L.layerGroup().addTo(map);
    var stopLayer = L.layerGroup().addTo(map);
    var deviceLayer = L.layerGroup().addTo(map);
    var userLayer = L.layerGroup().addTo(map);
    var destLayer = L.layerGroup().addTo(map);   // the destination pin lives alone
    var userMarker = null;
    var destMarker = null;
    var drawLayer = L.layerGroup().addTo(map);
    var handleLayer = L.layerGroup().addTo(map);   // draggable line vertices
    var markers = {};
    var flags = { tilesBroken: false };

    map.on('tileerror', function () {
      if (flags.tilesBroken) return;
      flags.tilesBroken = true;
      var note = el.querySelector('.map-tile-warning');
      if (!note) {
        note = document.createElement('div');
        note.className = 'map-badge map-tile-warning';
        note.style.top = 'auto';
        note.style.bottom = '12px';
        note.style.left = '12px';
        note.innerHTML = window.Icons.wifiOff(13) + ' Map tiles unavailable — check connection';
        el.appendChild(note);
      }
    });

    var kit = {
      map: map,
      el: el,
      markers: markers,

      /** Draw a route: yellow casing + navy line, stops as differentiated markers (§111)
       *  Pass { append: true } to add to what is already drawn instead of replacing it. */
      drawRoute: function (route, o) {
        o = o || {};
        if (!o.append) {
          routeLayer.clearLayers();
          stopLayer.clearLayers();
        }
        if (!route || !route.path || route.path.length < 2) return;
        var pts = route.path.map(function (p) { return [p.lat, p.lng]; });
        // A two-colour route is drawn as two halves so each colour reads clearly.
        var cols = route.color2 ? splitHalf(pts) : null;
        if (o.casing !== false) {
          L.polyline(pts, { color: YELLOW, weight: 10, opacity: o.dim ? 0.28 : 0.6, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
        }
        if (cols) {
          L.polyline(cols[0], { color: o.color || NAVY, weight: o.weight || 5, opacity: o.dim ? 0.4 : 0.92, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
          L.polyline(cols[1], { color: route.color2, weight: o.weight || 5, opacity: o.dim ? 0.4 : 0.92, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
        } else {
          L.polyline(pts, { color: o.color || NAVY, weight: o.weight || 5, opacity: o.dim ? 0.4 : 0.92, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
        }
        if (o.showStops !== false) {
          (route.stops || []).forEach(function (s) {
            var m = L.marker([s.latitude, s.longitude], { icon: stopIcon(s.type), title: s.name, interactive: true });
            if (o.labels) m.bindTooltip(s.name, { direction: 'top', offset: [0, -12], className: 'stop-tip' });
            m.on('click', function () { if (o.onStopClick) o.onStopClick(s); });
            m.addTo(stopLayer);
          });
        }
      },

      clearRoute: function () { routeLayer.clearLayers(); stopLayer.clearLayers(); },


      /** Add/replace a jeepney marker; animates to the new position */
      upsertDevice: function (device, o) {
        o = o || {};
        var existing = markers[device.id];
        var pos = device.position;
        if (!pos) {
          if (existing) { deviceLayer.removeLayer(existing); delete markers[device.id]; }
          return;
        }
        if (existing) {
          /* A live map can carry hundreds of jeepneys; replacing the DOM icon
           * (heading rotation, status colour) for every marker on every tick
           * is exactly what makes a browser jank. The icon only truly changes
           * when status, selection or heading bucket changes — skip otherwise. */
          var key = device.status + '|' + (o.selected ? 1 : 0) + '|' + Math.round((device.heading || 0) / 15);
          if (existing.__iconKey !== key) {
            existing.setIcon(jeepIcon(device, o.selected));
            existing.__iconKey = key;
          }
          tweenTo(existing, pos, 900);
          var tip = tooltipFor(device);
          if (existing.__tip !== tip) {
            existing.setTooltipContent(tip);
            existing.__tip = tip;
          }
        } else {
          var m = L.marker([pos.lat, pos.lng], { icon: jeepIcon(device, o.selected), zIndexOffset: o.selected ? 600 : 300, title: device.name });
          m.__iconKey = device.status + '|' + (o.selected ? 1 : 0) + '|' + Math.round((device.heading || 0) / 15);
          m.__tip = tooltipFor(device);
          m.bindTooltip(m.__tip, { direction: 'top', offset: [0, -20] });
          m.on('click', function () { if (o.onClick) o.onClick(device.id); });
          m.addTo(deviceLayer);
          markers[device.id] = m;
        }
      },

      removeDevice: function (id) {
        if (markers[id]) {
          deviceLayer.removeLayer(markers[id]);
          delete markers[id];
        }
      },

      keepOnlyDevices: function (ids) {
        Object.keys(markers).forEach(function (id) {
          if (ids.indexOf(id) < 0) kit.removeDevice(id);
        });
      },

      clearDevices: function () {
        deviceLayer.clearLayers();
        markers = {};
        kit.markers = markers;
      },

      /**
       * The reader's own position. Draggable when `o.confirm` is set, so they can
       * correct a sloppy GPS fix ("Are you here?" → drag → confirm).
       */
      setUserLocation: function (latlng, label, o) {
        o = o || {};
        if (!latlng) { userLayer.clearLayers(); userMarker = null; return null; }
        var text = label || 'You are here';
        var icon = userIcon(!!o.confirmed);
        if (!userMarker) {
          userMarker = L.marker([latlng.lat, latlng.lng], {
            icon: icon,
            title: text,
            zIndexOffset: 800,
            draggable: !!o.draggable,
          });
          userMarker.bindTooltip(text, { direction: 'top', offset: [0, -12] });
          if (o.draggable) {
            userMarker.on('dragend', function () {
              var p = userMarker.getLatLng();
              if (o.onMove) o.onMove({ lat: p.lat, lng: p.lng });
            });
          } else if (o.onTap) {
            userMarker.on('click', function () { o.onTap(); });
          }
          userMarker.addTo(userLayer);
        } else {
          // A drag in progress must not be fought by an incoming GPS fix.
          if (!(o.draggable && userMarker.dragging && userMarker.dragging.enabled() && userMarker.dragging._draggable && userMarker.dragging._draggable._moving)) {
            userMarker.setLatLng([latlng.lat, latlng.lng]);
          }
          userMarker.setIcon(icon);
          if (userMarker.getTooltip()) userMarker.setTooltipContent(text);
          userMarker.options.title = text;
          if (!!userMarker.options.draggable !== !!o.draggable) {
            userMarker.options.draggable = !!o.draggable;
            if (userMarker.dragging) {
              if (o.draggable) userMarker.dragging.enable();
              else userMarker.dragging.disable();
            }
          }
        }
        return userMarker;
      },

      setDestination: function (latlng, name) {
        if (!latlng) { destLayer.clearLayers(); destMarker = null; return null; }
        var text = name || 'Destination';
        if (!destMarker) {
          destMarker = L.marker([latlng.lat, latlng.lng], { icon: destIcon(), zIndexOffset: 500, title: text });
          destMarker.bindTooltip(text, { direction: 'top', offset: [0, -26] });
          destMarker.addTo(destLayer);
        } else {
          destMarker.setLatLng([latlng.lat, latlng.lng]);
          if (destMarker.getTooltip()) destMarker.setTooltipContent(text);
          destMarker.options.title = text;
        }
        return destMarker;
      },

      clearDestination: function () { destLayer.clearLayers(); destMarker = null; },

      clearDraw: function () { drawLayer.clearLayers(); },

      /** Preview geometry while the admin builds a route (§34, §105) */
      drawDraft: function (points, path, activePoint) {
        drawLayer.clearLayers();
        if (path && path.length > 1) {
          L.polyline(path.map(function (p) { return [p.lat, p.lng]; }), { color: YELLOW, weight: 10, opacity: 0.5, lineJoin: 'round' }).addTo(drawLayer);
          L.polyline(path.map(function (p) { return [p.lat, p.lng]; }), { color: NAVY, weight: 5, opacity: 0.9, lineJoin: 'round' }).addTo(drawLayer);
        } else if (points && points.length > 1) {
          L.polyline(points.map(function (p) { return [p.lat, p.lng]; }), { color: NAVY, weight: 4, opacity: 0.8, dashArray: '6 6' }).addTo(drawLayer);
        }
        (points || []).forEach(function (p, i) {
          var icon =
            p.type === 'landmark' ? stopIcon('landmark') : stopIcon('stop');
          var m = L.marker([p.lat, p.lng], { icon: icon, draggable: true, zIndexOffset: 400 });
          m.bindTooltip((i + 1) + '. ' + (p.name || p.type), { direction: 'top', offset: [0, -12] });
          if (activePoint && activePoint.onDragEnd) m.on('dragend', function () { activePoint.onDragEnd(i, m.getLatLng()); });
          if (activePoint && activePoint.onMarkerTap) m.on('click', function () { activePoint.onMarkerTap(m.getLatLng()); });
          m.addTo(drawLayer);
        });
      },

      /** Draggable handles on every vertex of the drawn line, so an admin can
       *  pull the line into shape instead of re-drawing it. `onDragEnd(i, latlng)`
       *  reports which vertex moved and where it landed. */
      drawPathHandles: function (path, o) {
        o = o || {};
        handleLayer.clearLayers();
        (path || []).forEach(function (p, i) {
          var m = L.marker([p.lat, p.lng], { icon: vertexIcon(), draggable: true, zIndexOffset: 500 });
          m.on('dragend', function () { if (o.onDragEnd) o.onDragEnd(i, m.getLatLng()); });
          m.addTo(handleLayer);
        });
      },
      clearPathHandles: function () { handleLayer.clearLayers(); },

      resize: function () { map.invalidateSize(); },

      fitRoute: function (route, padding) {
        if (!route || !route.path || route.path.length < 2) return;
        map.fitBounds(route.path.map(function (p) { return [p.lat, p.lng]; }), { padding: padding || [30, 30], animate: false });
      },

      fitPoints: function (points, padding) {
        if (!points || !points.length) return;
        map.fitBounds(points.map(function (p) { return [p.lat || p.latitude, p.lng || p.longitude]; }), { padding: padding || [40, 40], animate: false });
      },

      /** Selected jeepney + route + destination framing (§54) */
      frameTracking: function (route, device, destination, padding) {
        var pts = [];
        if (route && route.path) pts = pts.concat(route.path.map(function (p) { return [p.lat, p.lng]; }));
        if (device && device.position) pts.push([device.position.lat, device.position.lng]);
        if (destination) pts.push([destination.latitude, destination.longitude]);
        if (!pts.length) return;
        map.fitBounds(pts, { padding: padding || [40, 60], animate: true, duration: 0.6 });
      },

      /**
       * Frame what matters right now: a window of the route around the jeepney
       * plus the selected jeepney, its next stop and the passenger destination
       * — never the whole city (§54).
       */
      frameAround: function (route, device, destination, padding) {
        if (!device || !device.position) return;
        var pts = [[device.position.lat, device.position.lng]];
        var s = device.s;
        if (route && route.path && route.path.length && s != null) {
          var prep = window.Geo.prepare(route.path);
          var from = Math.max(0, s - 700);
          var to = Math.min(prep.totalM, s + 1800);
          for (var d = from; d <= to; d += 120) {
            var pt = window.Geo.pointAt(prep, d);
            if (pt) pts.push([pt.lat, pt.lng]);
          }
        }
        if (device.nextStop) {
          var stop = (route.stops || []).find(function (x) { return x.id === device.nextStop.id; });
          if (stop) pts.push([stop.latitude, stop.longitude]);
        }
        if (destination) pts.push([destination.latitude, destination.longitude]);
        var bounds = L.latLngBounds(pts);
        map.fitBounds(bounds, {
          padding: padding || [40, 80],
          animate: true,
          duration: 0.55,
          maxZoom: 16.5,
        });
      },

      panTo: function (latlng, zoom) {
        if (!latlng) return;
        if (zoom) map.setView([latlng.lat, latlng.lng], zoom, { animate: true });
        else map.panTo([latlng.lat, latlng.lng], { animate: true, duration: 0.5 });
      },

      onTap: function (fn) {
        map.on('click', function (e) { fn({ lat: e.latlng.lat, lng: e.latlng.lng }); });
      },

      invalidate: function () {
        setTimeout(function () { map.invalidateSize(); }, 60);
      },

      destroy: function () {
        Object.keys(markers).forEach(function (id) {
          var m = markers[id];
          if (m) animators.delete(L.Util.stamp(m));
        });
        try { map.remove(); } catch (e) { /* already gone */ }
      },
    };

    function tooltipFor(device) {
      var bits = [device.name];
      if (device.routeName) bits.push(device.routeName);
      bits.push(device.status === 'online' ? 'Online' : device.status === 'connecting' ? 'Connecting' : 'Offline');
      return bits.join(' · ');
    }

    kit.invalidate();
    return kit;
  }

  window.MapKit = { create: create, tweenTo: tweenTo, icons: { jeepIcon: jeepIcon, stopIcon: stopIcon, userIcon: userIcon } };
})();
