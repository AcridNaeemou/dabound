/* screens-passenger.js — Splash, role selection, Maps, Search, Nearby,
 * Live tracking, Routes, Route details, Saved.
 *
 * Layouts follow the DaBound reference deck page by page:
 *   p-01 splash · p-03 role · p-04 map + navigational tips · p-05 destination
 *   search · p-06 nearby jeeps · p-07 tracking readout · bottom nav throughout.
 */
(function () {
  var Geo = window.Geo;
  var UI = window.UI;
  var Store = window.Store;

  /* ---------------------------------------------------------------- splash */
  function splashScreen() {
    var el = DOM.el(
      '<div class="screen">' +
        '<div class="center-screen">' +
          '<div class="brand-word">' + window.Brand.mark(null, 40) + '</div>' +
          '<div class="road-dots" style="margin-top:6px">' +
            '<span style="margin-right:6px;color:#F9C74F;display:inline-flex">' + window.Brand.jeepArt('#F9C74F', 58) + '</span>' +
            '<i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i>' +
          '</div>' +
          '<div class="splash-bar"><i></i></div>' +
          '<div class="t-cap">Loading routes and jeepneys…</div>' +
        '</div>' +
      '</div>'
    );
    return { el: el };
  }

  /* ------------------------------------------------------- role selection */
  function roleScreen() {
    var el = DOM.el(
      '<div class="screen">' +
        '<div class="center-screen">' +
          '<div class="brand-word" style="margin-bottom:30px">' + window.Brand.mark(null, 38) + '</div>' +
          '<button class="role-btn" data-nav="map">Are you a user?</button>' +
          '<button class="role-btn" data-nav="admin-login">Are you an admin?</button>' +
        '</div>' +
      '</div>'
    );
    return { el: el };
  }

  /* ------------------------------------------------------------ bottom nav */
  function bottomNav(active) {
    var items = [
      { id: 'map', label: 'Maps', icon: window.Icons.pinFilled(24) },
      { id: 'routes', label: 'Routes', icon: window.Icons.jeepFilled(26) },
      { id: 'saved', label: 'Saved', icon: window.Icons.bookmarkFilled(23) },
    ];
    return (
      '<nav class="bottom-nav">' +
      items
        .map(function (i) {
          return (
            '<button class="nav-item' + (i.id === active ? ' active' : '') + '" data-tab="' + i.id + '">' +
            '<span class="nav-ic-wrap">' + i.icon + '</span><span>' + i.label + '</span></button>'
          );
        })
        .join('') +
      '</nav>'
    );
  }

  /* --------------------------------------------------------------- maps tab */
  function mapScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;
    var origin = Store.session.userLocation || null;
    var q = '';          // what the reader is typing in the top box
    var open = false;    // destination results showing under the top box
    var locNote = null;  // { text, retry } shown under the map when locate fails
    var picking = false; // choosing a destination by tapping the map
    var pin = null;      // the spot the reader tapped, before they confirm it

    function destination() { return Store.session.destination; }
    function devicesForList() {
      var dest = destination();
      return Store.devices({ activeOnly: true, destination: dest, servingDestination: !!dest });
    }
    function sortOrigin() {
      if (origin) return origin;
      if (destination()) return { lat: destination().latitude, lng: destination().longitude };
      return null;
    }
    function sorted() { return UI.sortForList(devicesForList(), sortOrigin()); }
    function rowsHtml(list) {
      var dest = destination();
      return list.slice(0, 3).map(function (d) { return UI.jeepCard(d, { destination: dest, origin: origin }); }).join('');
    }

    /* ---------------------------------------------- destination search (§179) */
    function matches() {
      var s = q.trim().toLowerCase();
      return Store.state.destinations.filter(function (d) {
        if (!s) return true;
        return d.name.toLowerCase().indexOf(s) >= 0 ||
          (d.address || '').toLowerCase().indexOf(s) >= 0 ||
          (d.routeIds || []).some(function (rid) {
            var r = Store.routeById(rid);
            return r && r.name.toLowerCase().indexOf(s) >= 0;
          });
      });
    }

    function dropHtml() {
      var list = matches();
      if (!list.length) {
        return UI.emptyState(window.Icons.search(26), 'No destinations found.', 'Try another mall, school or landmark.');
      }
      return list.map(function (d) {
        var routes = (d.routeIds || []).map(function (rid) { return Store.routeById(rid); }).filter(Boolean);
        var live = 0;
        routes.forEach(function (r) { live += Store.devices({ routeId: r.id, activeOnly: true, onlineOnly: true }).length; });
        return (
          '<button class="line-row" data-dest="' + UI.esc(d.id) + '">' +
          '<span style="flex:none;display:inline-flex">' + window.Icons.pinFilledYellow(26) + '</span>' +
          '<span class="lr-body">' +
          '<span class="lr-title nowrap">' + UI.esc(d.name) + '</span>' +
          '<span class="lr-sub nowrap">' + UI.esc(d.address || routes.map(function (r) { return r.name; }).join(', ') || 'Davao City') + '</span>' +
          (live ? '<span class="pill online" style="margin-top:6px"><i class="dot"></i>' + live + ' jeep' + (live > 1 ? 's' : '') + ' en route</span>' : '') +
          '</span>' +
          '</button>'
        );
      }).join('');
    }

    function paintDrop() {
      var drop = DOM.qs(el, '#p-drop');
      if (!drop) return;
      drop.hidden = !open;
      if (open) drop.innerHTML = '<div class="drop-body">' + dropHtml() + '</div>';
      var clear = DOM.qs(el, '[data-act="clear-search"]');
      var pin = DOM.qs(el, '.search-pin');
      if (clear) clear.hidden = !(open && q);
      if (pin) pin.hidden = !!(open && q);
    }

    function closeSearch() {
      open = false;
      q = '';
      var input = DOM.qs(el, '#p-search');
      if (input) {
        var d = destination();
        input.value = d ? (d.custom ? 'Pin on the map' : d.name) : '';
        input.blur();
      }
      paintDrop();
    }

    function pick(id) {
      var dest = Store.state.destinations.find(function (d) { return d.id === id; });
      if (!dest) return;
      Store.session.destination = dest;
      open = false;
      q = '';
      var input = DOM.qs(el, '#p-search');
      if (input) {
        input.value = dest.name;
        input.blur();
      }
      if (kit) kit.map.setView([dest.latitude, dest.longitude], 14, { animate: true });
      paintDrop();
      draw();
      paintUnder();
      UI.toast('Showing jeepneys to ' + dest.name);
    }

    function render() {
      el.innerHTML =
        '<div class="search-wrap">' +
          '<header class="appbar searchable">' +
            '<span class="appbar-lead brand-lead">' + window.Brand.jeepArt('#173B5C', 30) + '</span>' +
            '<input id="p-search" class="search-field" type="search" autocomplete="off" enterkeyhint="search"' +
              ' placeholder="Type in your Destination." aria-label="Search your destination"' +
              ' value="' + UI.esc(destination() ? destination().name : '') + '" />' +
            '<button class="clear" data-act="clear-search" aria-label="Clear" hidden>' + window.Icons.x(18) + '</button>' +
            '<span class="search-pin">' + window.Icons.pinFilledYellow(20) + '</span>' +
          '</header>' +
          '<div class="search-drop" id="p-drop" hidden></div>' +
        '</div>' +
        '<div class="map-frame">' +
          '<div class="map" id="p-map"></div>' +
          '<div class="map-controls">' +
            '<button class="icon-btn" data-act="locate" aria-label="Locate me" aria-busy="false">' + window.Icons.crosshair(20) + '</button>' +
            '<button class="icon-btn' + (picking ? ' picking' : '') + '" data-act="pick" aria-label="Choose a destination on the map">' +
              (picking ? window.Icons.x(20) : window.Icons.pinFilled(20)) +
            '</button>' +
          '</div>' +
          '<div class="map-hint" id="p-pick-hint"' + (picking ? '' : ' hidden') + '>' +
            (pin ? 'Use this spot?' : 'Tap the map to choose where you want to go') +
          '</div>' +
          '<div class="map-confirm" id="p-pick-confirm"' + (picking && pin ? '' : ' hidden') + '>' +
            '<button class="bar-action" data-act="use-pin">' + window.Icons.pinFilled(17) + ' Go here</button>' +
            '<button class="bar-action quiet" data-act="cancel-pin">Cancel</button>' +
          '</div>' +
        '</div>' +
        '<div class="p-under" id="p-under"></div>' +
        bottomNav('map');
    }

    /* the strip under the map: nearby jeeps for the chosen destination, else tips */
    function locateNoteHtml() {
      if (!locNote) return '';
      return (
        '<div class="alert" style="margin:0 0 10px">' + window.Icons.alert(16) +
        '<span>' + UI.esc(locNote.text) + '</span></div>' +
        (locNote.retry ? '<button class="bar-action quiet" data-act="locate" style="margin:0 0 12px">Try again</button>' : '')
      );
    }

    function paintUnder() {
      var host = DOM.qs(el, '#p-under');
      if (!host) return;
      var note = locateNoteHtml();
      var dest = destination();
      if (!dest) {
        host.innerHTML = note + UI.tipsCard();
        return;
      }
      var list = sorted();
      if (!list.length) {
        host.innerHTML = note + UI.emptyState(window.Icons.jeep(26), 'No active jeepneys on this route.', 'Tracking starts as soon as a device sends GPS.');
        return;
      }
      host.innerHTML = note +
        '<div class="p-under-title">Nearby Jeeps</div>' +
        '<div class="pill-list flush" id="p-jeeps">' + rowsHtml(list) + '</div>' +
        '<button class="bar-action quiet" data-nav="nearby" style="margin-top:10px">See all ' + list.length +
        ' jeepney' + (list.length > 1 ? 's' : '') + '</button>';
    }

    function setLocating(on) {
      var btn = DOM.qs(el, '[data-act="locate"]');
      if (!btn) return;
      btn.classList.toggle('busy', !!on);
      btn.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    /* loud = the reader asked for it, so failures are explained on screen */
    function askForLocation(loud) {
      setLocating(true);
      if (loud) { locNote = null; paintUnder(); }
      window.GeoLoc.request()
        .then(function (loc) {
          origin = loc;
          Store.session.userLocation = loc;
          locNote = null;
          setLocating(false);
          if (kit) { kit.setUserLocation(loc, 'You are here'); kit.panTo(loc, 15); }
          var host = DOM.qs(el, '#p-jeeps');
          if (host) host.innerHTML = rowsHtml(sorted());
          paintUnder();
          UI.toast('Showing jeepneys near you');
        })
        .catch(function (err) {
          setLocating(false);
          if (!loud) return;                       // the quiet first ask never nags
          locNote = { text: err.message, retry: true };
          paintUnder();
        });
    }

    function draw() {
      if (!kit) return;
      var dest = destination();
      var list = devicesForList();
      kit.clearRoute();
      if (dest) {
        var seen = {};
        list.forEach(function (d) {
          if (!d.routeId || seen[d.routeId]) return;
          seen[d.routeId] = 1;
          var r = Store.routeById(d.routeId);
          if (r) kit.drawRoute(r, { showStops: false, color: r.color || undefined });
        });
      }
      kit.keepOnlyDevices(list.map(function (d) { return d.id; }));
      list.forEach(function (d) {
        kit.upsertDevice(d, { onClick: function (id) { window.Router.go('tracking', { deviceId: id }); } });
      });
      if (dest) kit.setDestination({ lat: dest.latitude, lng: dest.longitude }, dest.name);
      kit.setUserLocation(Store.session.userLocation || origin, 'You are here');
    }

    function paintPick() {
      var hint = DOM.qs(el, '#p-pick-hint');
      var confirm = DOM.qs(el, '#p-pick-confirm');
      var btn = DOM.qs(el, '[data-act="pick"]');
      if (hint) {
        hint.hidden = !picking;
        hint.textContent = pin ? 'Use this spot?' : 'Tap the map to choose where you want to go';
      }
      if (confirm) confirm.hidden = !(picking && pin);
      if (btn) {
        btn.classList.toggle('picking', picking);
        btn.innerHTML = picking ? window.Icons.x(20) : window.Icons.pinFilled(20);
      }
    }

    function mountMap() {
      var host = DOM.qs(el, '#p-map');
      if (!host) return;
      kit = window.MapKit.create(host, { center: [7.0858, 125.6175], zoom: 14 });
      var dest = destination();
      if (dest) kit.map.setView([dest.latitude, dest.longitude], 14, { animate: false });
      // the tap is caught on the frame itself, so a pin can also be dropped on
      // top of a marker, a label or the route line
      var frame = DOM.qs(el, '.map-frame');
      if (frame) {
        frame.addEventListener('click', function (e) {
          if (!picking) return;
          if (e.target.closest('.map-controls') || e.target.closest('.map-confirm')) return;
          var latlng = kit.map.mouseEventToLatLng(e);
          pin = { lat: latlng.lat, lng: latlng.lng };
          kit.setDestination(pin, 'Pin on the map');
          paintPick();
        }, true);
      }
      draw();
      paintPick();
      if (!Store.session.userLocation && !origin) askForLocation(false);
    }
    function unmountMap() { if (kit) { kit.destroy(); kit = null; } }

    return {
      el: el,
      mount: function () {
        render();
        mountMap();
        paintUnder();
        paintDrop();

        var input = DOM.qs(el, '#p-search');
        input.addEventListener('focus', function () {
          open = true;
          q = '';
          input.value = '';
          paintDrop();
        });
        input.addEventListener('input', function () {
          q = input.value;
          open = true;
          paintDrop();
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            var m = matches();
            if (m.length) pick(m[0].id);
          } else if (e.key === 'Escape') {
            closeSearch();
          }
        });

        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="clear-search"]')) {
            q = '';
            input.value = '';
            open = true;
            paintDrop();
            input.focus();
            return;
          }
          var hit = e.target.closest('[data-dest]');
          if (hit) { pick(hit.dataset.dest); return; }
          if (e.target.closest('[data-act="pick"]')) {
            picking = !picking;
            pin = null;
            if (picking) {
              closeSearch();
              UI.toast('Tap the map to choose your destination');
            } else if (kit) {
              draw();
            }
            paintPick();
            return;
          }
          if (e.target.closest('[data-act="cancel-pin"]')) {
            picking = false;
            pin = null;
            if (kit) draw();
            paintPick();
            return;
          }
          if (e.target.closest('[data-act="use-pin"]')) {
            if (!pin) return;
            var custom = {
              id: 'pin-' + Date.now(),
              name: 'Pin on the map',
              address: pin.lat.toFixed(5) + ', ' + pin.lng.toFixed(5),
              latitude: pin.lat,
              longitude: pin.lng,
              routeIds: [],
              custom: true,
            };
            Store.session.destination = custom;
            picking = false;
            pin = null;
            var box = DOM.qs(el, '#p-search');
            if (box) box.value = custom.name;
            paintPick();
            if (kit) kit.map.setView([custom.latitude, custom.longitude], 15, { animate: true });
            draw();
            paintUnder();
            UI.toast('Showing jeepneys that pass your pin');
            return;
          }
          if (e.target.closest('[data-act="locate"]')) {
            askForLocation(true);
            return;
          }
          var card = e.target.closest('[data-device]');
          if (card) { window.Router.go('tracking', { deviceId: card.dataset.device }); return; }
          if (open && !e.target.closest('.search-wrap')) closeSearch();
        });
      },
      update: function () {
        if (!kit) return;
        if (picking && pin) kit.setDestination(pin, 'Pin on the map');
        draw();
        paintUnder();
        if (!open) {
          var input = DOM.qs(el, '#p-search');
          if (input) input.value = destination() ? destination().name : '';
        }
      },
      unmount: unmountMap,
    };
  }

  /* ------------------------------------------------------ destination search */
  function searchScreen() {
    var el = DOM.el(
      '<div class="screen">' +
        '<header class="appbar" style="background:#eceef1;border-color:#eceef1">' +
          '<button class="back-chevron" data-nav="back" aria-label="Back">' + window.Icons.chevLeft(26) + '</button>' +
          '<div class="appbar-title" style="text-align:left">Where to?</div>' +
          '<span style="width:40px"></span>' +
        '</header>' +
        '<div style="padding:0 14px 10px">' +
          '<div class="search" style="border:1.5px solid var(--line)">' +
            '<span class="search-icon">' + window.Icons.search(20) + '</span>' +
            '<input id="d-search" type="search" placeholder="Type in your Destination." autocomplete="off" />' +
            '<button class="clear" data-act="clear-search" aria-label="Clear">' + window.Icons.x(18) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="scroll" style="padding:0 14px 16px">' +
          '<div class="container" id="d-results"></div>' +
        '</div>' +
      '</div>'
    );

    function render(q) {
      q = (q || '').trim().toLowerCase();
      var dests = Store.state.destinations.filter(function (d) {
        if (!q) return true;
        return d.name.toLowerCase().indexOf(q) >= 0 ||
          (d.address || '').toLowerCase().indexOf(q) >= 0 ||
          (d.routeIds || []).some(function (rid) {
            var r = Store.routeById(rid);
            return r && r.name.toLowerCase().indexOf(q) >= 0;
          });
      });
      var host = DOM.qs(el, '#d-results');
      if (!dests.length) {
        host.innerHTML = UI.emptyState(window.Icons.search(26), 'No destinations found.', 'Try another mall, school or landmark.');
        return;
      }
      host.innerHTML = dests
        .map(function (d) {
          var routes = (d.routeIds || []).map(function (rid) { return Store.routeById(rid); }).filter(Boolean);
          var live = 0;
          routes.forEach(function (r) { live += Store.devices({ routeId: r.id, activeOnly: true, onlineOnly: true }).length; });
          return (
            '<button class="line-row" data-dest="' + UI.esc(d.id) + '">' +
            '<span style="flex:none;display:inline-flex">' + window.Icons.pinFilledYellow(26) + '</span>' +
            '<span class="lr-body">' +
            '<span class="lr-title nowrap">' + UI.esc(d.name) + '</span>' +
            '<span class="lr-sub nowrap">' + UI.esc(d.address || routes.map(function (r) { return r.name; }).join(', ') || 'Davao City') + '</span>' +
            (live ? '<span class="pill online" style="margin-top:6px"><i class="dot"></i>' + live + ' jeep' + (live > 1 ? 's' : '') + ' en route</span>' : '') +
            '</span>' +
            '</button>'
          );
        })
        .join('');
    }

    return {
      el: el,
      mount: function () {
        var input = DOM.qs(el, '#d-search');
        render('');
        input.focus();
        input.addEventListener('input', function () { render(input.value); });
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="clear-search"]')) {
            input.value = '';
            render('');
            input.focus();
            return;
          }
          var card = e.target.closest('[data-dest]');
          if (card) {
            var dest = Store.state.destinations.find(function (d) { return d.id === card.dataset.dest; });
            if (!dest) return;
            Store.session.destination = dest;
            UI.toast('Showing jeepneys to ' + dest.name);
            window.Router.go('nearby');
          }
        });
      },
      update: function () { render(DOM.qs(el, '#d-search').value); },
    };
  }

  /* ----------------------------------------------------------- nearby jeeps */
  function nearbyScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var origin = Store.session.userLocation || null;

    function render() {
      var dest = Store.session.destination;
      var list = UI.sortForList(
        Store.devices({ activeOnly: true, destination: dest, servingDestination: !!dest }),
        origin || (dest ? { lat: dest.latitude, lng: dest.longitude } : null)
      );
      var online = list.filter(function (d) { return d.status === 'online'; });
      var devicesBlock = list.length
        ? list.map(function (d) { return UI.jeepCard(d, { destination: dest, origin: origin }); }).join('')
        : UI.emptyState(window.Icons.jeep(28), 'No active jeepneys on this route.', 'Try another destination or check back shortly.');

      el.innerHTML =
        UI.appbar({
          title: dest ? dest.name : 'Nearby Jeeps',
          titleColor: dest ? '#5B7EA1' : undefined,
          right: '<button class="icon-btn" data-nav="search" aria-label="Search">' + window.Icons.search(20) + '</button>',
        }) +
        '<div class="scroll" style="padding:0 14px 16px">' +
          (dest
            ? '<button class="pill-row light" data-nav="search" type="button" style="margin-bottom:12px">' +
                '<span style="flex:none;display:inline-flex">' + window.Icons.pinFilledYellow(26) + '</span>' +
                '<span class="pr-body">' +
                  '<span class="pr-title nowrap">To: ' + UI.esc(dest.name) + '</span>' +
                  '<span class="pr-sub nowrap">' + UI.esc(dest.address || 'Davao City') + '</span>' +
                '</span>' +
              '</button>'
            : '') +
          '<div class="container titled">' +
            '<div class="container-title">Nearby Jeeps</div>' +
            '<div class="pill-list flush" id="nb-list">' + devicesBlock + '</div>' +
          '</div>' +
          (list.length && online.length === 0
            ? '<div class="alert warn" style="margin-top:12px">' + window.Icons.alert(16) + '<span>No jeepneys are sending GPS right now. The last known positions are shown.</span></div>'
            : '') +
        '</div>' +
        bottomNav('map');
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', function (e) {
          var card = e.target.closest('[data-device]');
          if (card) window.Router.go('tracking', { deviceId: card.dataset.device });
        });
      },
      update: render,
    };
  }

  /* --------------------------------------------------------- live tracking */
  function trackingScreen(params) {
    var deviceId = params.deviceId;
    var el = DOM.el('<div class="screen"></div>');
    var kit = null;
    var lastEtaPaint = 0;
    var lastKey = '';
    var headerHost, cardHost;
    var lastLocAt = 0;      // the last time we asked the phone where it is
    var locDenied = false;  // stop asking once the reader says no

    function device() { return Store.deviceById(deviceId); }

    function paintHeader(dev) {
      var route = dev ? Store.routeById(dev.routeId) : null;
      headerHost.innerHTML = UI.appbar({
        transparent: true,
        title: 'Amping!',
        icon: '<span style="display:inline-flex">' + window.Brand.jeepArt('#173B5C', 34) + '</span>',
        right: dev ? UI.statusPill(dev, { trackingLabel: true, lostLabel: true, pulse: true }) : '<span style="width:40px"></span>',
      });
      void route;
    }

    /* The moment the jeepney you are watching gets close to where you are
     * standing we say so, once, and stay quiet until it has driven off again. */
    var ARRIVE_M = 150;
    var REARM_M = 300;

    function arrival(dev, ctx) {
      var d = ctx.distanceFromUserM;
      var flags = (Store.session.rideHere = Store.session.rideHere || {});
      if (d == null) return { show: false, justArrived: false, distanceM: null };
      if (d > REARM_M) {
        if (flags[dev.id]) delete flags[dev.id];
        return { show: false, justArrived: false, distanceM: d };
      }
      var goodFix = dev.accuracy == null || dev.accuracy <= 120;   // a wild fix must not fake an arrival
      var close = d <= ARRIVE_M && dev.status === 'online' && goodFix;
      if (!close) return { show: false, justArrived: false, distanceM: d };
      var just = !flags[dev.id];
      flags[dev.id] = true;
      return { show: true, justArrived: just, distanceM: d };
    }

    function hereText(dev, m) {
      var gap = m == null ? '' : m < 60 ? 'right beside you' : 'about ' + Geo.formatDistance(m).replace(' away', '') + ' away';
      return dev.name + (gap ? ' is ' + gap : '') + '.';
    }

    function rideHereHtml(dev, here) {
      return (
        '<div class="ride-here" id="tc-here">' +
          '<span class="rh-icon">' + window.Brand.jeepArt('#173B5C', 34) + '</span>' +
          '<span class="rh-body">' +
            '<span class="rh-title">Your ride is here! Mabuhay!</span>' +
            '<span class="rh-sub" id="tc-here-sub">' + UI.esc(hereText(dev, here.distanceM)) + '</span>' +
          '</span>' +
        '</div>'
      );
    }

    function paintCard(force) {
      var dev = device();
      if (!dev) {
        cardHost.innerHTML =
          Store.state.devices.length
            ? '<div class="alert">' + window.Icons.alert(16) + '<span>Jeepney unavailable. It may have been removed.</span></div>'
            : '<div class="alert info">' + window.Icons.info(16) + '<span>Loading jeepney\u2026</span></div>';
        return;
      }
      var route = Store.routeById(dev.routeId);
      var ctx = UI.tripContext(dev, {
        destination: Store.session.destination || null,
        origin: Store.session.userLocation || null,
      });
      var landmarkName = dev.landmark ? dev.landmark.name : null;
      var here = arrival(dev, ctx);
      var key = [dev.id, dev.routeId, landmarkName, ctx.etaCaption, dev.status, here.show].join('|');
      var now = Date.now();
      var refreshMs = (Store.state.config && Store.state.config.etaRefreshMs) || 20000;
      var etaStale = now - lastEtaPaint > refreshMs;
      var bigChange = dev._lastEtaSec != null && ctx.etaSec != null && Math.abs(ctx.etaSec - dev._lastEtaSec) > 90;
      if (!force && key === lastKey && !etaStale && !bigChange) {
        updateLiveBits(dev, ctx);
        return;
      }
      lastKey = key;
      lastEtaPaint = now;
      dev._lastEtaSec = ctx.etaSec;
      if (here.justArrived) UI.toast('Your ride is here! Mabuhay!', 'success');

      var offline = dev.status !== 'online';
      var nearLine = landmarkName ? 'Near ' + landmarkName : 'En route';
      var vehicle = dev.name + (dev.type ? ' \u00b7 ' + dev.type : '');

      cardHost.innerHTML =
        '<div class="track-panel slide-up">' +
          '<div class="track-title">' +
            '<span style="display:inline-flex">' + window.Brand.jeepArt('#F9C74F', 40) + '</span>' +
            '<span class="tt-name">' + UI.esc(route ? route.name : 'Route unavailable') + '</span>' +
          '</div>' +
          '<div class="track-sub" id="tc-sub">' + UI.esc(vehicle + ' \u00b7 ' + (offline ? 'last seen below' : nearLine)) + '</div>' +
          (!offline && dev.offRoute
            ? '<div class="alert info" style="margin:2px 0 10px">' + window.Icons.info(16) +
              '<span>This jeepney looks ' + Math.round(dev.offRouteM || 0) + ' m off its usual route — it may be on a detour.</span></div>'
            : '') +
          (offline
            ? '<div class="alert" style="margin:2px 0 10px">' + window.Icons.wifiOff(16) +
              '<span>' + (dev.lastUpdated ? 'Connection lost. Showing the last known location.' : 'Waiting for the first GPS update from this jeepney.') + '</span></div>'
            : '') +
          (here.show ? rideHereHtml(dev, here) : '') +
          UI.statList([
            { k: 'ETA:', v: offline ? 'ETA unavailable' : Geo.formatEta(ctx.etaSec, dev), big: !offline, id: 'tc-eta' },
            { k: 'Distance:', v: Geo.formatDistance(ctx.distanceM), id: 'tc-dist' },
            { k: 'Average Speed:', v: offline ? '—' : Geo.formatSpeed(dev.speedKmh), id: 'tc-speed' },
          ]) +
          '<div class="t-cap" id="tc-age" style="margin-top:10px">' +
            (dev.ageMs != null ? 'Last updated ' + Geo.formatRelative(dev.ageMs) : 'Waiting for GPS\u2026') +
          '</div>' +
        '</div>';
    }

    function updateLiveBits(dev, ctx) {
      var landmarkName = dev.landmark ? dev.landmark.name : null;
      var offline = dev.status !== 'online';
      var sub = DOM.qs(cardHost, '#tc-sub');
      if (sub) {
        sub.textContent =
          dev.name + (dev.type ? ' \u00b7 ' + dev.type : '') + ' \u00b7 ' +
          (offline ? (dev.ageMs != null ? 'last seen ' + Geo.formatRelative(dev.ageMs) : 'no signal yet') : landmarkName ? 'Near ' + landmarkName : 'En route');
      }
      var age = DOM.qs(cardHost, '#tc-age');
      if (age) age.textContent = dev.ageMs != null ? 'Last updated ' + Geo.formatRelative(dev.ageMs) : 'Waiting for GPS\u2026';
      var dist = DOM.qs(cardHost, '#tc-dist');
      if (dist) dist.textContent = Geo.formatDistance(ctx.distanceM);
      var sp = DOM.qs(cardHost, '#tc-speed');
      if (sp) sp.textContent = offline ? '\u2014' : Geo.formatSpeed(dev.speedKmh);
      var hereSub = DOM.qs(cardHost, '#tc-here-sub');
      if (hereSub && ctx.distanceFromUserM != null) hereSub.textContent = hereText(dev, ctx.distanceFromUserM);
      var eta = DOM.qs(cardHost, '#tc-eta');
      if (eta) {
        eta.textContent = offline ? 'ETA unavailable' : Geo.formatEta(ctx.etaSec, dev);
        eta.className = 'sl-v' + (offline ? '' : ' big');
      }
    }

    /* Where the reader is standing. Asked for once when the screen opens and then
     * refreshed occasionally, so walking half a block still updates the gap. */
    function refreshOwnLocation(force) {
      if (locDenied) return;
      var now = Date.now();
      if (!force && now - lastLocAt < 25000) return;
      lastLocAt = now;
      window.GeoLoc.request().then(function (loc) {
        Store.session.userLocation = loc;
        if (kit) kit.setUserLocation(loc, 'You are here');
        var shown = !!DOM.qs(cardHost, '#tc-here');
        paintCard(shown ? false : true);   // the arrival banner appears the moment we know you are close
      }).catch(function (err) {
        locDenied = true;                  // location is optional: the screen works without it
        if (force) UI.toast(err.message, 'error');
      });
    }

    function paintMap(dev) {
      if (!kit || !dev) return;
      var route = Store.routeById(dev.routeId);
      kit.clearRoute();
      if (route) kit.drawRoute(route, { showStops: false, labels: false, color: route.color || undefined });
      var peers = Store.devices({ routeId: dev.routeId, activeOnly: true });
      kit.keepOnlyDevices(peers.map(function (d) { return d.id; }));
      peers.forEach(function (d) {
        kit.upsertDevice(d, {
          selected: d.id === dev.id,
          onClick: function (id) { window.Router.go('tracking', { deviceId: id }); },
        });
      });
      if (!kit.markers[dev.id] && dev.position) {
        kit.upsertDevice(dev, { selected: true, onClick: function (id) { window.Router.go('tracking', { deviceId: id }); } });
      }
      var user = Store.session.userLocation;
      if (user) kit.setUserLocation(user, 'You are here');
      var dest = Store.session.destination;
      if (dest) kit.setDestination({ lat: dest.latitude, lng: dest.longitude }, dest.name);
    }

    return {
      el: el,
      mount: function () {
        el.innerHTML =
          '<div id="t-header"></div>' +
          '<div class="screen-title">Tracking…</div>' +
          '<div class="map-frame"><div class="map" id="t-map"></div>' +
            '<div class="map-controls">' +
              '<button class="icon-btn" data-act="center" aria-label="Center jeep">' + window.Icons.crosshair(20) + '</button>' +
            '</div></div>' +
          '<div id="t-card" style="flex:0 1 auto;min-height:0;overflow-y:auto"></div>' +
          bottomNav('map');
        headerHost = DOM.qs(el, '#t-header');
        cardHost = DOM.qs(el, '#t-card');
        kit = window.MapKit.create(DOM.qs(el, '#t-map'), { center: [7.0858, 125.6175], zoom: 15 });
        var dev = device();
        paintHeader(dev);
        paintCard(true);
        paintMap(dev);
        if (dev && dev.position) {
          kit.frameAround(Store.routeById(dev.routeId), dev, Store.session.destination, [30, 40]);
          setTimeout(function () {
            var card = DOM.qs(el, '#t-card');
            kit.frameAround(Store.routeById(dev.routeId), dev, Store.session.destination, [30, (card ? card.offsetHeight : 320) * 0.55 + 40]);
          }, 120);
        }
        if (!Store.session.userLocation) refreshOwnLocation(true);
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="center"]')) {
            var d = device();
            if (d && d.position) kit.panTo(d.position, 16);
            return;
          }
        });
        void headerHost;
      },
      update: function () {
        var dev = device();
        if (!dev) {
          // a cold deep link renders before /api/state lands: keep repainting the
          // placeholder so the screen recovers the moment the data arrives
          paintHeader(null);
          paintCard(true);
          return;
        }
        paintHeader(dev);
        paintCard(false);
        paintMap(dev);
        if (Store.session.userLocation) refreshOwnLocation(false);
        if (dev.position && !kit.map.getBounds().pad(-0.12).contains([dev.position.lat, dev.position.lng])) kit.panTo(dev.position);
      },
      unmount: function () { if (kit) kit.destroy(); kit = null; },
    };
  }

  /* -------------------------------------------------------------- routes tab */
  function routesScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var q = '';

    function filtered() {
      var s = q.trim().toLowerCase();
      return Store.state.routes.filter(function (r) {
        if (!s) return true;
        return r.name.toLowerCase().indexOf(s) >= 0 ||
          ((r.startPoint && r.startPoint.name) || '').toLowerCase().indexOf(s) >= 0 ||
          ((r.endPoint && r.endPoint.name) || '').toLowerCase().indexOf(s) >= 0 ||
          (r.stops || []).some(function (st) { return (st.name || '').toLowerCase().indexOf(s) >= 0; });
      });
    }

    function listHtml() {
      var routes = filtered();
      if (!Store.state.routes.length) {
        return UI.emptyState(window.Icons.routeIcon(28), 'No routes available.', 'An admin can add routes in the admin panel.');
      }
      if (!routes.length) {
        return UI.emptyState(window.Icons.search(28), 'No routes match "' + UI.esc(q.trim()) + '".', 'Try another route or stop name.');
      }
      return '<div class="pill-list flush">' + routes.map(function (r) { return UI.routeCard(r); }).join('') + '</div>';
    }

    function render() {
      el.innerHTML =
        '<div class="search-wrap">' +
          '<header class="appbar searchable">' +
            '<span class="appbar-lead brand-lead">' + window.Brand.jeepArt('#173B5C', 30) + '</span>' +
            '<input id="r-search" class="search-field" type="search" autocomplete="off"' +
              ' placeholder="Search a route or a stop" aria-label="Search routes"' +
              ' value="' + UI.esc(q) + '" />' +
            '<button class="clear" data-act="clear-search" aria-label="Clear"' + (q ? '' : ' hidden') + '>' + window.Icons.x(18) + '</button>' +
          '</header>' +
        '</div>' +
        '<div class="scroll" id="r-scroll" style="padding:6px 14px 16px">' +
          '<div id="r-list">' + listHtml() + '</div>' +
          '<div style="height:16px"></div>' +
          '<div class="container pad">' + UI.tipsCard('How to ride').replace('Type in your Destination.', 'Tap a route to see its stops and live jeepneys.').replace('Tap a jeepney on the list to see its details.', 'Search your destination for jeepneys that pass by it.') + '</div>' +
        '</div>' +
        bottomNav('routes');
    }

    function paintList() {
      var host = DOM.qs(el, '#r-list');
      if (!host) return;
      host.innerHTML = listHtml();
      var clear = DOM.qs(el, '[data-act="clear-search"]');
      if (clear) clear.hidden = !q;
    }

    return {
      el: el,
      mount: function () {
        render();
        var input = DOM.qs(el, '#r-search');
        input.addEventListener('input', function () {
          q = input.value;
          paintList();
        });
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="clear-search"]')) {
            q = '';
            input.value = '';
            paintList();
            input.focus();
            return;
          }
          var card = e.target.closest('[data-route]');
          if (card) window.Router.go('route-detail', { routeId: card.dataset.route });
        });
      },
      update: paintList,
    };
  }

  /* ------------------------------------------------------- route detail tab */
  function routeDetailScreen(params) {
    var routeId = params.routeId;
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;

    function paintDevices(route) {
      var host = DOM.qs(el, '#rd-devices');
      if (!host) return;
      var devices = Store.devices({ routeId: route.id, activeOnly: true });
      host.innerHTML = devices.length
        ? devices.map(function (d) { return UI.jeepCard(d, { destination: Store.session.destination }); }).join('')
        : UI.emptyState(window.Icons.jeep(26), 'No active jeepneys on this route.', 'Tracking appears here when a device starts sending GPS.');
    }

    function render() {
      var route = Store.routeById(routeId);
      if (!route) {
        el.innerHTML =
          UI.appbar({ title: 'Route' }) +
          (Store.state.routes.length
            ? UI.emptyState(window.Icons.alert(26), 'Route unavailable.', 'It may have been removed by an admin.')
            : UI.emptyState(window.Icons.routeIcon(26), 'Loading route\u2026', 'Fetching the latest route data.'));
        return;
      }
      var devices = Store.devices({ routeId: routeId, activeOnly: true });
      var online = devices.filter(function (d) { return d.status === 'online'; }).length;
      var stops = (route.stops || []).slice().sort(function (a, b) { return a.order - b.order; });
      var startN = (route.startPoint && route.startPoint.name) || '—';
      var endN = (route.endPoint && route.endPoint.name) || '—';

      el.innerHTML =
        UI.appbar({ title: route.name, subtitle: startN + ' → ' + endN }) +
        '<div class="scroll" style="padding:0 14px 16px">' +
          '<div class="map-frame" style="height:210px;flex:none"><div class="map" id="rd-map"></div></div>' +
          '<div class="title-pill" style="margin:14px 0 12px">' + UI.esc(route.name) + '</div>' +
          '<div class="label-box" style="margin-bottom:14px">' +
            '<div class="lb-line">Start: ' + UI.esc(startN) + '</div>' +
            '<div class="lb-line">End: ' + UI.esc(endN) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
            (route.isLoop ? '<span class="pill navy">Loop route</span>' : '') +
            '<span class="pill">' + (route.distanceM ? (route.distanceM / 1000).toFixed(1) + ' km' : '—') + '</span>' +
            '<span class="pill">' + stops.length + ' stops</span>' +
            (online ? '<span class="pill online"><i class="dot pulse"></i>' + online + ' live now</span>' : '<span class="pill offline"><i class="dot"></i>No live jeepneys</span>') +
          '</div>' +
          '<div class="container titled">' +
            '<div class="container-title" style="font-size:var(--f-section)">Live jeepneys on this route</div>' +
            '<div class="pill-list flush" id="rd-devices"></div>' +
          '</div>' +
          '<div class="section-label">Route stops</div>' +
          '<div class="container pad">' +
            stops
              .map(function (s, i) {
                var tag = s.type === 'start' ? 'Start' : s.type === 'endpoint' ? 'End' : s.type === 'landmark' ? 'Landmark' : 'Stop';
                return (
                  '<div class="step-row">' +
                  '<span class="step-num">' + (i + 1) + '</span>' +
                  '<span class="sr-body"><span class="sr-title">' + UI.esc(s.name) + '</span>' +
                  '<span class="sr-sub">' + (s.type === 'start' ? 'Boarding point' : s.type === 'endpoint' ? 'Terminal' : s.type === 'landmark' ? 'Named landmark' : 'Route stop') + '</span></span>' +
                  '<span class="tag ' + s.type + '">' + tag + '</span>' +
                  '</div>'
                );
              })
              .join('') +
          '</div>' +
          '<div style="height:12px"></div>' +
        '</div>' +
        bottomNav('routes');

      paintDevices(route);
      requestAnimationFrame(function () {
        if (kit) kit.destroy();
        kit = window.MapKit.create(DOM.qs(el, '#rd-map'), { zoom: 14 });
        kit.drawRoute(route, { showStops: true, labels: false });
        kit.fitRoute(route, [26, 26]);
      });
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', function (e) {
          var card = e.target.closest('[data-device]');
          if (card) window.Router.go('tracking', { deviceId: card.dataset.device });
        });
      },
      update: function () {
        var route = Store.routeById(routeId);
        if (route) paintDevices(route);
      },
      unmount: function () { if (kit) kit.destroy(); kit = null; },
    };
  }

  /* -------------------------------------------------------------- saved tab */
  function savedScreen() {
    var el = DOM.el(
      '<div class="screen plain">' +
        UI.appbar({
          back: false,
          title: 'Saved',
          icon: '<span style="display:inline-flex">' + window.Icons.bookmarkFilled(22, 'fill="#173B5C"') + '</span>',
          right: '<span style="width:40px"></span>',
        }) +
        '<div class="scroll" style="padding:0 14px 16px">' +
          UI.emptyState(window.Icons.bookmark(30), 'Nothing saved yet.') +
        '</div>' +
        bottomNav('saved') +
      '</div>'
    );
    return { el: el };
  }

  window.Passenger = {
    splash: splashScreen,
    role: roleScreen,
    map: mapScreen,
    search: searchScreen,
    nearby: nearbyScreen,
    tracking: trackingScreen,
    routes: routesScreen,
    routeDetail: routeDetailScreen,
    saved: savedScreen,
    bottomNav: bottomNav,
  };
})();
