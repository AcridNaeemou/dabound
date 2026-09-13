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

  function jeepIcon(device, selected) {
    var col = jeepColor(device);
    var status = device.status === 'offline' ? ' offline' : device.status === 'connecting' ? ' connecting' : '';
    if (!selected) {
      return L.divIcon({
        className: 'mk',
        html: '<div class="mk-jeep-dot' + status + '" style="--mk:' + col + '"><span class="mk-dot"></span></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
    }
    var route = window.Store && window.Store.routeById ? window.Store.routeById(device.routeId) : null;
    var name = route ? route.name : device.name;
    return L.divIcon({
      className: 'mk',
      html:
        '<div class="mk-jeep-dot selected' + status + '" style="--mk:' + col + '">' +
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
    if (type === 'start') return L.divIcon({ className: 'mk', html: '<div class="mk-start">S</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
    if (type === 'endpoint') return L.divIcon({ className: 'mk', html: '<div class="mk-end">E</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
    if (type === 'landmark') return L.divIcon({ className: 'mk', html: '<div class="mk-landmark"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    return L.divIcon({ className: 'mk', html: '<div class="mk-stop"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  function userIcon() {
    return L.divIcon({
      className: 'mk',
      html: '<div class="mk-user-wrap"><span class="mk-user"></span><span class="mk-user-label">You are here</span></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  function destIcon() {
    return L.divIcon({ className: 'mk', html: '<div class="mk-dest">' + window.Icons.pinFilled(30, 'style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))"') + '</div>', iconSize: [30, 30], iconAnchor: [15, 29] });
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

    var corridorLayer = L.layerGroup().addTo(map);
    var routeLayer = L.layerGroup().addTo(map);
    var stopLayer = L.layerGroup().addTo(map);
    var deviceLayer = L.layerGroup().addTo(map);
    var userLayer = L.layerGroup().addTo(map);
    var destLayer = L.layerGroup().addTo(map);   // the destination pin lives alone
    var userMarker = null;
    var destMarker = null;
    var drawLayer = L.layerGroup().addTo(map);
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

      /** Draw a route: yellow casing + navy line, stops as differentiated markers (§111) */
      drawRoute: function (route, o) {
        o = o || {};
        routeLayer.clearLayers();
        stopLayer.clearLayers();
        if (!route || !route.path || route.path.length < 2) return;
        var pts = route.path.map(function (p) { return [p.lat, p.lng]; });
        if (o.casing !== false) {
          L.polyline(pts, { color: YELLOW, weight: 10, opacity: o.dim ? 0.28 : 0.6, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
        }
        L.polyline(pts, { color: o.color || NAVY, weight: o.weight || 5, opacity: o.dim ? 0.4 : 0.92, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
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

      /**
       * Route corridor polygon (spec 40-44): translucent navy area + navy boundary,
       * yellow draggable handles while the admin is editing it.
       */
      drawCorridor: function (points, o) {
        o = o || {};
        corridorLayer.clearLayers();
        if (!points || points.length < 3) {
          if (points && points.length === 2) {
            L.polyline(points.map(function (p) { return [p.lat, p.lng]; }), { color: NAVY, weight: 2, dashArray: '6 6', opacity: .8 }).addTo(corridorLayer);
          }
          return;
        }
        var latlngs = points.map(function (p) { return [p.lat, p.lng]; });
        L.polygon(latlngs, {
          color: o.color || NAVY,
          weight: o.weight || 2,
          opacity: o.dim ? 0.4 : 0.85,
          fillColor: o.fillColor || NAVY,
          fillOpacity: o.dim ? 0.06 : 0.14,
          interactive: false,
        }).addTo(corridorLayer);
        if (o.handles) {
          points.forEach(function (pt, i) {
            var m = L.marker([pt.lat, pt.lng], {
              icon: L.divIcon({ className: 'mk', html: '<div class="mk-corner"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
              draggable: true,
              zIndexOffset: 700,
            });
            m.bindTooltip('Area point ' + (i + 1), { direction: 'top', offset: [0, -10] });
            if (o.onDragEnd) m.on('dragend', function () { o.onDragEnd(i, m.getLatLng()); });
            if (o.onMarkerTap) m.on('click', function () { o.onMarkerTap(m.getLatLng()); });
            m.addTo(corridorLayer);
          });
        }
      },

      clearCorridor: function () { corridorLayer.clearLayers(); },

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
          existing.setIcon(jeepIcon(device, o.selected));
          tweenTo(existing, pos, 900);
          if (existing.getTooltip()) existing.setTooltipContent(tooltipFor(device));
        } else {
          var m = L.marker([pos.lat, pos.lng], { icon: jeepIcon(device, o.selected), zIndexOffset: o.selected ? 600 : 300, title: device.name });
          m.bindTooltip(tooltipFor(device), { direction: 'top', offset: [0, -20] });
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

      setUserLocation: function (latlng, label) {
        if (!latlng) { userLayer.clearLayers(); userMarker = null; return null; }
        var text = label || 'You are here';
        if (!userMarker) {
          userMarker = L.marker([latlng.lat, latlng.lng], { icon: userIcon(), title: text })
            .bindTooltip(text, { direction: 'top', offset: [0, -10] })
            .addTo(userLayer);
        } else {
          userMarker.setLatLng([latlng.lat, latlng.lng]);   // one dot, always the latest fix
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
            p.type === 'start' ? stopIcon('start') : p.type === 'endpoint' ? stopIcon('endpoint') : p.type === 'landmark' ? stopIcon('landmark') : stopIcon('stop');
          var m = L.marker([p.lat, p.lng], { icon: icon, draggable: true, zIndexOffset: 400 });
          m.bindTooltip((i + 1) + '. ' + (p.name || p.type), { direction: 'top', offset: [0, -12] });
          if (activePoint && activePoint.onDragEnd) m.on('dragend', function () { activePoint.onDragEnd(i, m.getLatLng()); });
          if (activePoint && activePoint.onMarkerTap) m.on('click', function () { activePoint.onMarkerTap(m.getLatLng()); });
          m.addTo(drawLayer);
        });
      },

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
