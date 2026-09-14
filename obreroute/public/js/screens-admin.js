/* screens-admin.js — Admin login, profile (p-09), route list (p-10),
 * route detail (p-11), route editor (p-12), jeepney list (p-13),
 * jeepney detail (p-14), jeepney editor (p-15), live map and GPS phone mode.
 */
(function () {
  var Geo = window.Geo;
  var UI = window.UI;
  var Store = window.Store;

  function colorOf(deviceOrRoute) {
    if (!deviceOrRoute) return '#ADB5BD';
    return deviceOrRoute.color || window.Brand.colorFor(deviceOrRoute.id);
  }

  function adminSession() {
    try {
      return JSON.parse(sessionStorage.getItem('dabound.admin') || 'null') || { name: 'ADMIN 67' };
    } catch (e) {
      return { name: 'ADMIN 67' };
    }
  }

  /** Reference jeepney row: circular illustration + "Jeep: Obrero" + "Driver: Manong". */
  function adminDeviceRow(device) {
    var route = Store.routeById(device.routeId);
    var muted = !device.active;
    var sub =
      'Driver: ' + UI.esc(device.driver || '—') +
      (device.status === 'online' && device.landmark ? ' · Near ' + UI.esc(device.landmark.name) : '');
    return UI.pillRow({
      variant: muted ? 'placeholder' : '',
      attrs: ' data-device="' + UI.esc(device.id) + '"',
      lead: window.Brand.jeepAvatar(colorOf(device), 54, { muted: muted, color2: muted ? null : device.color2 || null }),
      title: 'Jeep: ' + device.name.replace(/^Jeepney\s*/i, ''),
      sub:
        '<span>' + sub + '</span>' +
        '<span style="display:block;margin-top:4px;color:' +
        (muted ? 'var(--text2)' : device.status === 'online' ? '#8ef0b4' : device.status === 'connecting' ? '#ffd977' : '#ffb3b3') + ';font-weight:600">' +
        UI.esc(route ? route.name : 'No route assigned') + ' · ' +
        UI.esc(device.status === 'online' ? 'Online' : device.status === 'connecting' ? 'Connecting' : device.status === 'inactive' ? 'Inactive' : 'Offline') +
        (device.simulated ? ' · <span style="color:#ffd977">DEV</span>' : '') +
        '</span>',
      chevron: !muted,
    });
  }

  /* --------------------------------------------------------------- login */
  function adminLoginScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var renderedLocked = null;

    function locked() {
      return !!(Store.state && Store.state.config && Store.state.config.adminKeyRequired);
    }

    function openAdmin() {
      sessionStorage.setItem('dabound.admin', JSON.stringify({ name: 'ADMIN 67' }));
      window.Router.reset('admin-profile');
    }

    function render() {
      // Remember what we drew so a live store push only re-renders when the lock
      // state actually flips — re-rendering on every push would wipe a half-typed
      // PIN and any "wrong PIN" message.
      renderedLocked = locked();
      var head =
        '<div style="display:flex;justify-content:center;padding:26px 0 6px">' + window.Brand.mark(null, 30) + '</div>';
      if (!locked()) {
        el.innerHTML =
          head +
          '<div class="screen-title">Admin tools</div>' +
          '<div class="scroll pad" style="padding-top:0">' +
            '<div class="card">' +
              '<div class="t-body" style="margin-bottom:16px">Create routes, assign jeepneys, watch the map.</div>' +
              '<button class="bar-action" data-act="continue">' + window.Icons.shield(18) + ' Continue as Admin</button>' +
            '</div>' +
          '</div>';
        return;
      }
      el.innerHTML =
        head +
        '<div class="screen-title">Admin PIN</div>' +
        '<div class="scroll pad" style="padding-top:0">' +
          '<div class="card" style="padding:18px 16px 16px">' +
            '<div class="t-body" style="margin-bottom:14px">Enter the shared admin PIN to unlock routes, jeepneys and places.</div>' +
            '<input class="input plain" id="al-pin" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"' +
              ' placeholder="Admin PIN" aria-label="Admin PIN" style="text-align:center;letter-spacing:1px" />' +
            '<div id="al-err"></div>' +
            '<button class="bar-action" data-act="unlock" style="margin-top:12px">' + window.Icons.shield(18) + ' Unlock</button>' +
          '</div>' +
        '</div>';
    }

    function fail(msg) {
      var err = DOM.qs(el, '#al-err');
      var input = DOM.qs(el, '#al-pin');
      if (err) err.innerHTML = '<div class="alert" style="margin-top:10px">' + window.Icons.alert(16) + '<span>' + UI.esc(msg) + '</span></div>';
      if (input) { input.value = ''; input.focus(); }
    }

    function tryUnlock() {
      var input = DOM.qs(el, '#al-pin');
      var pin = input ? (input.value || '').trim() : '';
      if (!pin) { fail('Type the admin PIN first.'); return; }
      window.API.checkAdminKey(pin)
        .then(function (ok) {
          if (!ok) { fail('Wrong PIN — try again.'); return; }
          try { localStorage.setItem('dabound.key', pin); } catch (e) { /* private mode */ }
          openAdmin();
        })
        .catch(function () { fail('Could not reach the server. Try again.'); });
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="continue"]')) openAdmin();
          if (e.target.closest('[data-act="unlock"]')) tryUnlock();
        });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && e.target.id === 'al-pin') tryUnlock();
        });
        setTimeout(function () { var p = DOM.qs(el, '#al-pin'); if (p) p.focus(); }, 60);
      },
      update: function () { if (locked() !== renderedLocked) render(); },
    };
  }

  /* ---------------------------------------------- profile / dashboard (p-09) */
  function adminProfileScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var admin = adminSession();

    function render() {
      var online = Store.onlineCount();
      el.innerHTML =
        '<div class="scroll">' +
          '<div style="display:flex;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 0">' +
            '<button class="back-chevron" data-act="exit-admin" aria-label="Back to the launch screen">' + window.Icons.chevLeft(26) + '</button>' +
            '<span style="flex:1;display:flex;justify-content:center">' + window.Brand.mark(null, 30) + '</span>' +
            '<span style="width:40px;flex:none"></span>' +
          '</div>' +
          '<div class="screen-title">Admin\'s Profile</div>' +
          '<div style="padding:0 16px">' +
            '<div class="profile-pill">' +
              '<span class="pp-avatar">' + window.Icons.user(38) + '</span>' +
              '<span style="flex:1;min-width:0">' +
                '<span class="pp-name">' + UI.esc(admin.name || 'ADMIN 67') + '</span>' +
                '<span class="pp-sub">Personal info</span>' +
              '</span>' +
              '<button class="icon-btn" data-act="refresh" aria-label="Refresh" style="color:#fff">' + window.Icons.refresh(20) + '</button>' +
            '</div>' +
            '<div class="stat-strip">' +
              '<div class="stat"><span class="s-v">' + Store.state.routes.length + '</span><span class="s-k">Routes</span></div>' +
              '<div class="stat"><span class="s-v">' + Store.state.devices.length + '</span><span class="s-k">Jeepneys</span></div>' +
              '<div class="stat"><span class="s-v">' + online + '</span><span class="s-k">Online</span></div>' +
            '</div>' +
            '<div class="section-label">Settings</div>' +
            '<div class="menu-shell">' +
              '<button class="menu-row" data-nav="admin-routes">' +
                '<span class="mr-icon">' + window.Icons.pinFilled(22) + '</span>' +
                '<span class="mr-label">Route List</span>' +
                '<span class="mr-chev">' + window.Icons.chevRight(20) + '</span>' +
              '</button>' +
              '<button class="menu-row" data-nav="admin-devices">' +
                '<span class="mr-icon">' + window.Icons.jeep(24) + '</span>' +
                '<span class="mr-label">Jeepney Info</span>' +
                '<span class="mr-chev">' + window.Icons.chevRight(20) + '</span>' +
              '</button>' +
              '<button class="menu-row" data-nav="admin-places">' +
                '<span class="mr-icon">' + window.Icons.building(22) + '</span>' +
                '<span class="mr-label">Places</span>' +
                '<span class="mr-chev">' + window.Icons.chevRight(20) + '</span>' +
              '</button>' +
            '</div>' +
            '<div style="height:16px"></div>' +
          '</div>' +
        '</div>';

    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="exit-admin"]')) {
            window.Router.reset('role');
            return;
          }
          if (e.target.closest('[data-act="refresh"]')) { render(); UI.toast('Refreshed'); }
        });
      },
      update: render,
    };
  }

  /* ---------------------------------------------------------- route list */
  function adminRouteListScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var q = '';

    function render() {
      var routes = Store.state.routes.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
      el.innerHTML =
        UI.appbar({
          bare: true,
          title: '',
          right: '<button class="icon-btn" data-nav="admin-live" aria-label="Show all routes on the map">' + window.Icons.navigation(20) + '</button>',
        }) +
        '<div class="search-band">' +
          '<div class="search">' +
            '<span class="search-icon">' + window.Icons.search(20) + '</span>' +
            '<input id="ar-search" placeholder="Search routes" value="' + UI.esc(q) + '" aria-label="Search routes" />' +
            '<button class="clear" data-act="clear-search" aria-label="Clear">' + window.Icons.x(20) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="scroll" style="padding:16px 14px">' +
          (routes.length
            ? '<div class="pill-list flush">' +
              routes.map(function (r) {
                var devs = Store.devices({ routeId: r.id });
                var online = devs.filter(function (d) { return d.status === 'online'; }).length;
                return UI.pillRow({
                  attrs: ' data-route="' + UI.esc(r.id) + '"',
                  lead: window.Brand.jeepAvatar(colorOf(r), 56, { color2: r.color2 || null }),
                  title: r.name,
                  sub:
                    '<span>' + UI.esc((r.startPoint && r.startPoint.name) + ' → ' + (r.endPoint && r.endPoint.name)) + '</span>' +
                    '<span style="display:block;margin-top:4px">' +
                    '<span style="color:' + (devs.length ? '#8ef0b4' : '#ffb3b3') + ';font-weight:600">' +
                    (devs.length ? devs.length + (devs.length > 1 ? ' jeepneys' : ' jeepney') + ' · ' + online + ' live' : 'no jeepney assigned') +
                    '</span>' +
                    ' · ' + ((r.stops || []).length) + ' stops' +
                    (r.isLoop ? ' · loop' : '') +
                    (r.corridor && r.corridor.length >= 3 ? ' · area' : '') + '</span>',
                });
              }).join('') +
              '</div>'
            : q
            ? UI.emptyState(window.Icons.search(28), 'No route matches "' + UI.esc(q) + '".', 'Try another name, or clear the search.')
            : UI.emptyState(window.Icons.routeIcon(28), 'No routes yet.', 'Create your first route, then assign a jeepney to it.')) +
          '<div style="height:8px"></div>' +
        '</div>' +
        '<div class="bar-stack over-map">' +
          '<button class="bar-action" data-nav="admin-route-editor">' + window.Icons.plus(19) + ' New route</button>' +
        '</div>';

      var input = DOM.qs(el, '#ar-search');
      input.addEventListener('input', function () {
        q = input.value;
        render();
        var again = DOM.qs(el, '#ar-search');
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      });
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="clear-search"]')) { q = ''; render(); return; }
          var card = e.target.closest('[data-route]');
          if (card) window.Router.go('admin-route-detail', { routeId: card.dataset.route });
        });
      },
      update: render,
    };
  }

  /* -------------------------------------------------------- route detail */
  function adminRouteDetailScreen(params) {
    var routeId = params.routeId;
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;

    function devicesBlock(devices) {
      return devices.length
        ? devices.map(function (d) { return adminDeviceRow(d); }).join('')
        : UI.emptyState(window.Icons.jeep(26), 'No jeepneys assigned.', 'Assign a GPS device to this route.');
    }

    function render() {
      var route = Store.routeById(routeId);
      if (!route) {
        el.innerHTML =
          UI.appbar({ title: 'Route' }) +
          (Store.state.routes.length
            ? UI.emptyState(window.Icons.alert(26), 'Route unavailable.', 'It may have been deleted by another admin.')
            : UI.emptyState(window.Icons.routeIcon(26), 'Loading route\u2026', 'Fetching the latest route data.'));
        return;
      }
      var devices = Store.devices({ routeId: routeId });
      var stops = (route.stops || []).slice().sort(function (a, b) { return a.order - b.order; });
      var startN = (route.startPoint && route.startPoint.name) || '—';
      var endN = (route.endPoint && route.endPoint.name) || '—';
      el.innerHTML =
        UI.appbar({ title: 'Route', bare: true }) +
        '<button class="bar-action" data-act="edit" style="border-radius:0;min-height:48px;font-size:var(--f-card)">Edit</button>' +
        '<div class="scroll" style="padding:14px 14px 16px">' +
          '<div class="map-frame" style="height:200px;flex:none"><div class="map" id="ard-map"></div></div>' +
          '<div class="title-pill" style="margin:14px 0 12px">' + UI.esc(route.name) + '</div>' +
          '<div class="label-box" style="margin-bottom:14px">' +
            '<div class="lb-line">Start: ' + UI.esc(startN) + '</div>' +
            '<div class="lb-line">End: ' + UI.esc(endN) + '</div>' +
          '</div>' +
          '<div id="ard-pills" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
            (route.isLoop ? '<span class="pill navy">Loop route</span>' : '') +
            '<span class="pill">' + stops.length + ' stops</span>' +
            (route.distanceM ? '<span class="pill">' + (route.distanceM / 1000).toFixed(1) + ' km</span>' : '') +
            (route.active ? '<span class="pill online"><i class="dot"></i>Active</span>' : '<span class="pill offline"><i class="dot"></i>Inactive</span>') +
          '</div>' +
          '<div class="section-label" style="margin-top:0">Stops &amp; landmarks</div>' +
          '<div class="container pad">' +
            stops.map(function (s, i) {
              var tag = s.type === 'start' ? 'Start' : s.type === 'endpoint' ? 'End' : s.type === 'landmark' ? 'Landmark' : 'Stop';
              var metrics = Geo.stopMetrics(route);
              var mine = null;
              metrics.forEach(function (m) { if (m.stop === s) mine = m; });
              var along = mine && mine.s > 40
                ? Geo.formatDistance(mine.s) + ' from the start'
                : tag === 'Start' ? 'Starting point' : tag === 'Landmark' ? 'Landmark on this route' : 'Stop on this route';
              return (
                '<div class="step-row">' +
                '<span class="step-num">' + (i + 1) + '</span>' +
                '<span class="sr-body"><span class="sr-title">' + UI.esc(s.name) + '</span>' +
                '<span class="sr-sub">' + UI.esc(along) + '</span></span>' +
                '<span class="tag ' + s.type + '">' + tag + '</span>' +
                '</div>'
              );
            }).join('') +
          '</div>' +
          '<div class="section-label">Jeepneys on this route</div>' +
          '<div class="pill-list flush" id="ard-devices">' + devicesBlock(devices) + '</div>' +
          '<div class="btn-row" style="margin-top:18px">' +
            '<button class="bar-action danger" data-act="delete">' + window.Icons.trash(18) + ' Delete</button>' +
            '<button class="bar-action" data-act="edit2">' + window.Icons.pencil(18) + ' Edit route</button>' +
          '</div>' +
          '<div style="height:12px"></div>' +
        '</div>';

      requestAnimationFrame(function () {
        if (kit) kit.destroy();
        kit = window.MapKit.create(DOM.qs(el, '#ard-map'), { zoom: 13 });
        kit.drawRoute(route, { showStops: true });
        kit.fitRoute(route, [26, 26]);
      });
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', async function (e) {
          if (e.target.closest('[data-act="edit"]') || e.target.closest('[data-act="edit2"]')) {
            window.Router.go('admin-route-editor', { routeId: routeId });
            return;
          }
          if (e.target.closest('[data-act="delete"]')) {
            var route = Store.routeById(routeId);
            var ok = await UI.confirm({
              title: 'Delete ' + (route ? route.name : 'route') + '?',
              message: 'This cannot be undone. Jeepneys assigned to it will be left without a route.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            try {
              await window.API.deleteRoute(routeId);
              UI.toast('Route deleted', 'success');
              window.Router.back();
            } catch (err) { UI.toast(err.message, 'error'); }
          }
        });
      },
      update: function () {
        var route = Store.routeById(routeId);
        // first store payload after a cold deep link: build the whole screen
        if (!route || !DOM.qs(el, '#ard-devices')) { render(); return; }
        var devices = Store.devices({ routeId: routeId });
        var host = DOM.qs(el, '#ard-devices');
        if (host) host.innerHTML = devicesBlock(devices);
        var pills = DOM.qs(el, '#ard-pills');
        var online = devices.filter(function (d) { return d.status === 'online'; }).length;
        if (pills) {
          pills.innerHTML =
            (route.isLoop ? '<span class="pill navy">Loop route</span>' : '') +
            '<span class="pill">' + (route.stops || []).length + ' stops</span>' +
            (route.distanceM ? '<span class="pill">' + (route.distanceM / 1000).toFixed(1) + ' km</span>' : '') +
            (route.active ? '<span class="pill online"><i class="dot"></i>Active</span>' : '<span class="pill offline"><i class="dot"></i>Inactive</span>') +
            '<span class="pill">' + online + ' live</span>';
        }
      },
      unmount: function () { if (kit) kit.destroy(); kit = null; },
    };
  }

  /* -------------------------------------------------------- route editor */
  function adminRouteEditorScreen(params) {
    var routeId = params && params.routeId ? params.routeId : null;
    var editing = routeId ? Store.routeById(routeId) : null;
    var started = false;
    var draft = {
      name: editing ? editing.name : '',
      color: (editing && editing.color) || window.Brand.colorFor('route-' + Math.random().toString(36).slice(2, 7)),
      color2: (editing && editing.color2) || null,
      points: editing
        ? (editing.stops || []).slice().sort(function (a, b) { return a.order - b.order; }).map(function (s) {
            return { lat: s.latitude, lng: s.longitude, name: s.name, type: s.type };
          })
        : [],
      path: editing ? (editing.path || []).slice() : [],
      corridor: editing && editing.corridor ? editing.corridor.slice() : [],
      mode: null,
    };
    var history = [];
    var future = [];
    var baseline = null;
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;

    function pathDistance() {
      var d = 0;
      for (var i = 1; i < draft.path.length; i++) d += Geo.haversine(draft.path[i - 1], draft.path[i]);
      return draft.path.length > 1 ? d : 0;
    }

    /* Which segment of the line a distance-along-path `s` falls inside, so a new
     * vertex can be squeezed in between the right pair of existing points. */
    function segmentIndexAt(prep, s) {
      for (var i = 1; i < prep.cum.length; i++) {
        if (s <= prep.cum[i]) return i - 1;
      }
      return Math.max(0, prep.cum.length - 2);
    }

    function hintText() {
      if (draft.mode === 'start') return 'Tap the map to place the route start.';
      if (draft.mode === 'stop') return 'Tap the map to add a stop / landmark.';
      if (draft.mode === 'endpoint') return 'Tap the map to place the endpoint (same as start = loop route).';
      if (draft.mode === 'draw') return 'Drag on the map to draw the road line, or tap to drop single points.';
      if (draft.mode === 'edit') return 'Drag the red handles to reshape the line, or tap the line to squeeze a new point in between.';
      if (draft.mode === 'erase') return 'Tap the line where a section is wrong — only that part is removed, the rest of the line stays.';
      if (draft.mode === 'area') return 'Tap around the edges of the route area. Three or more points close the shaded corridor.';
      return 'Choose a tool below, then tap the map. Generate Path snaps the route to real roads.';
    }

    /* --- undo / redo -------------------------------------------------------
       Every edit snapshots the whole draft, so undo always steps back exactly
       one action (spec 45, 87, 91). */
    function snap() { return JSON.stringify({ name: draft.name, color: draft.color, color2: draft.color2, points: draft.points, path: draft.path, corridor: draft.corridor }); }
    function restore(json) {
      var d = JSON.parse(json);
      draft.name = d.name; draft.color = d.color; draft.color2 = d.color2 || null; draft.points = d.points;
      draft.path = d.path; draft.corridor = d.corridor;
      var nameInput = DOM.qs(el, '#re-name');
      if (nameInput && nameInput.value !== d.name) nameInput.value = d.name;
      paintColorDot();
    }
    function pushHistory() {
      history.push(snap());
      if (history.length > 60) history.shift();
      future.length = 0;
    }
    function dirty() { return baseline != null && snap() !== baseline; }
    function commit() { history.length = 0; future.length = 0; baseline = snap(); }

    /* ---- route colour: toolbar dot opens the picker panel ---- */
    function paintColorDot() {
      var dot = DOM.qs(el, '[data-act="color"]');
      if (!dot) return;
      var tone = window.Brand.toneFor({ color: draft.color, color2: draft.color2 }, draft.name);
      dot.style.background = tone.color2
        ? 'linear-gradient(90deg,' + tone.color + ' 0 50%,' + tone.color2 + ' 50% 100%)'
        : tone.color;
    }

    var cpApi = null;
    function toggleColorPanel() {
      var panel = DOM.qs(el, '#re-colors');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      var dot = DOM.qs(el, '[data-act="color"]');
      if (dot) dot.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      if (!panel.hidden && !cpApi) {
        cpApi = UI.wireColorPicker(
          panel,
          function (v) {
            pushHistory();
            draft.color = v.color;
            draft.color2 = v.color2;
            paintColorDot();
            paintMap();
          },
          function (v) {
            // live preview: how the route line and its jeepneys will look
            return window.Brand.jeepAvatar(v.color, 54, { color2: v.color2 });
          }
        );
      }
      if (cpApi) cpApi.set(draft.color, draft.color2);
    }

    function buildShell() {
      var tone = window.Brand.toneFor({ color: draft.color, color2: draft.color2 }, draft.name);
      el.innerHTML =
        UI.appbar({ title: editing ? 'Edit Route' : 'New Route', bare: true }) +
        '<div class="editor-toolbar">' +
          '<button class="et-btn" data-act="undo" aria-label="Undo">' + window.Icons.undoArrow(22) + '</button>' +
          '<button class="et-btn" data-act="redo" aria-label="Redo">' + window.Icons.redoArrow(22) + '</button>' +
          '<div style="flex:1;display:flex;justify-content:center">' +
            '<button class="color-dot" data-act="color" aria-label="Route colour" aria-expanded="false" style="' +
              (tone.color2
                ? 'background:linear-gradient(90deg,' + tone.color + ' 0 50%,' + tone.color2 + ' 50% 100%)'
                : 'background:' + tone.color) + '"></button>' +
          '</div>' +
          '<button class="et-save" data-act="save">Save</button>' +
        '</div>' +
        '<div class="color-panel" id="re-colors" hidden>' +
          '<div class="cp-title">Route colour</div>' +
          UI.colorPickerHtml({ id: 'route', color: draft.color, color2: draft.color2 }) +
        '</div>' +
        '<div style="padding:10px 14px 0">' +
          '<div class="field" style="margin-bottom:8px">' +
            '<label for="re-name">Route name</label>' +
            '<input class="input" id="re-name" placeholder="Type here" value="' + UI.esc(draft.name) + '" />' +
          '</div>' +
        '</div>' +
        '<div class="scroll" style="padding:0 14px 18px">' +
          '<div class="map-frame" style="height:300px;flex:none"><div class="map" id="re-map"></div></div>' +
          '<div id="re-panel" style="padding:10px 0 0"></div>' +
          '<div class="bar-stack inline">' +
          '<button class="bar-action" data-mode="start">' + window.Icons.play(17) + ' Set Start</button>' +
          '<button class="bar-action" data-mode="stop">' + window.Icons.plus(17) + ' Add Stop / Landmark</button>' +
          '<button class="bar-action" data-mode="endpoint">' + window.Icons.flag(17) + ' Set Endpoint</button>' +
          '<button class="bar-action" data-mode="draw">' + window.Icons.pencil(17) + ' Draw Route</button>' +
          '<button class="bar-action" data-mode="edit">' + window.Icons.target(17) + ' Edit Line</button>' +
          '<button class="bar-action" data-mode="erase">' + window.Icons.trash(17) + ' Erase Part</button>' +
          '<button class="bar-action" data-mode="area">' + window.Icons.polygon(17) + ' Draw Area</button>' +
            '<button class="bar-action quiet" data-act="generate">' + window.Icons.routeIcon(17) + ' Generate Path</button>' +
          '</div>' +
        '</div>';

      kit = window.MapKit.create(DOM.qs(el, '#re-map'), { zoom: 13, center: [7.0858, 125.6175] });
      kit.onTap(handleTap);
      wireFreehand();
      paintTools();
      paintPoints();
      paintMap();
    }

    /* ------------------------------------------------ freehand path drawing
     * With the Draw Route tool active, dragging a finger along the road records a
     * stroke; it is simplified (Douglas-Peucker) on release and becomes the route
     * path. Tapping still drops single points, so both habits work (spec 51, 52).
     */
    function wireFreehand() {
      var stroke = null;

      function simplify(pts, tolM) {
        if (pts.length < 3) return pts.slice();
        var keep = {};
        keep[0] = keep[pts.length - 1] = true;
        var stack = [[0, pts.length - 1]];
        while (stack.length) {
          var seg = stack.pop();
          var a = pts[seg[0]];
          var b = pts[seg[1]];
          var maxD = -1;
          var maxI = -1;
          for (var i = seg[0] + 1; i < seg[1]; i++) {
            var p = pts[i];
            var t = 0;
            var dx = b.lng - a.lng;
            var dy = b.lat - a.lat;
            var den = dx * dx + dy * dy;
            if (den > 0) t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / den));
            var proj = { lat: a.lat + dy * t, lng: a.lng + dx * t };
            var d = window.Geo.haversine(proj, p);
            if (d > maxD) { maxD = d; maxI = i; }
          }
          if (maxD > tolM && maxI > 0) {
            keep[maxI] = true;
            stack.push([seg[0], maxI]);
            stack.push([maxI, seg[1]]);
          }
        }
        return pts.filter(function (p, i) { return keep[i]; });
      }

      function preview() {
        if (!stroke) return;
        // show what is already drawn plus the line being dragged, so a second
        // stroke visibly continues the first instead of replacing it
        var all = (draft.path || []).concat(stroke);
        kit.drawRoute({ path: all }, { showStops: false, labels: false, color: '#F9C74F' });
      }

      /* Join a freshly drawn stroke onto the path that is already there. Drawing a
       * route is not one continuous gesture — roads bend, the finger lifts, the
       * admin re-centres the map — so each stroke extends the previous one. */
      function joinStrokes(base, add) {
        if (!base || !base.length) return add;
        if (!add || !add.length) return base;
        var TOL = 25;                       // metres: close enough to be one junction
        var head = base[0], tail = base[base.length - 1];
        var a0 = add[0], a1 = add[add.length - 1];
        if (window.Geo.haversine(tail, a0) <= TOL) return base.concat(add.slice(1));
        if (window.Geo.haversine(head, a1) <= TOL) return add.concat(base.slice(1));
        if (window.Geo.haversine(head, a0) <= TOL) return add.reverse().concat(base.slice(1));
        if (window.Geo.haversine(tail, a1) <= TOL) return base.concat(add.slice(0, add.length - 1).reverse());
        return base.concat(add);            // a separate leg: keep both
      }

      function distanceNow() {
        var m = 0;
        for (var i = 1; i < draft.path.length; i++) m += window.Geo.haversine(draft.path[i - 1], draft.path[i]);
        return m;
      }

      kit.map.on('mousedown', function (e) {
        if (draft.mode !== 'draw') return;
        stroke = [{ lat: e.latlng.lat, lng: e.latlng.lng }];
        kit.map.dragging.disable();
      });
      kit.map.on('mousemove', function (e) {
        if (!stroke) return;
        var p = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (window.Geo.haversine(stroke[stroke.length - 1], p) < 4) return;
        stroke.push(p);
        preview();
      });
      function endStroke() {
        if (!stroke) return;
        if (draft.mode !== 'draw') kit.map.dragging.enable();
        var drawn = stroke;
        stroke = null;
        if (drawn.length < 2) { paintMap(); return; }
        pushHistory();
        var seg = simplify(drawn, 6);
        // snap the drawn ends onto the start/endpoint when they are close by
        var start = draft.points[0];
        var end = draft.points[draft.points.length - 1];
        if (start && start.type === 'start' && window.Geo.haversine(seg[0], start) < 60) seg[0] = { lat: start.lat, lng: start.lng };
        if (end && end.type === 'endpoint' && window.Geo.haversine(seg[seg.length - 1], end) < 60) {
          seg[seg.length - 1] = { lat: end.lat, lng: end.lng };
        }
        // extend what is already drawn rather than starting over each stroke
        var added = draft.path && draft.path.length ? seg.length - 1 : seg.length;
        draft.path = joinStrokes(draft.path || [], seg);
        paintPoints();
        paintMap();
        UI.toast(
          (draft.path.length > seg.length ? 'Stroke added — ' : 'Path drawn — ') +
          added + ' new points · ' + draft.path.length + ' total · ' +
          (distanceNow() / 1000).toFixed(1) + ' km'
        );
      }

      kit.map.on('mouseup', endStroke);
      // a finger lifted off the edge of the map (or a cancelled touch) still ends
      // the line — the listeners live on the map container and die with it
      var host = kit.map.getContainer();
      host.addEventListener('mouseleave', endStroke);
      host.addEventListener('touchend', endStroke);
      host.addEventListener('touchcancel', endStroke);
    }

    function paintTools() {
      if (kit) {
        if (draft.mode === 'draw') kit.map.dragging.disable();
        else kit.map.dragging.enable();
      }
      DOM.qsa(el, '[data-mode]').forEach(function (b) {
        b.classList.remove('on');
      });
      var active = DOM.qs(el, '[data-mode="' + draft.mode + '"]');
      if (active) active.classList.add('on');
      var hint = DOM.qs(el, '#re-hint');
      if (hint) hint.textContent = hintText();
    }

    function paintPoints() {
      var panel = DOM.qs(el, '#re-panel');
      if (!panel) return;
      var rows = draft.points.length
        ? draft.points.map(function (p, i) {
            var isStart = i === 0;
            var isEnd = i === draft.points.length - 1 && draft.points.length > 1;
            var tag = isStart ? 'Start' : isEnd ? 'End' : p.type === 'landmark' ? 'Landmark' : 'Stop';
            return (
              '<div class="step-row" data-point="' + i + '">' +
              '<span class="step-num">' + (i + 1) + '</span>' +
              '<span class="sr-body">' +
              '<input class="input plain" style="padding:10px 10px;font-size:13px" data-name="' + i + '" value="' + UI.esc(p.name || '') + '" placeholder="Landmark name" />' +
              '<span class="sr-sub">' + UI.esc(pointHint(draft.points, i)) + '</span>' +
              '</span>' +
              '<span style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
              '<span class="tag ' + (isStart ? 'start' : isEnd ? 'endpoint' : p.type) + '">' + tag + '</span>' +
              (isStart || isEnd
                ? '<button class="icon-btn muted" data-remove="' + i + '" aria-label="Remove point" style="color:var(--mid)">' + window.Icons.x(16) + '</button>'
                : '<span style="display:flex;gap:4px;align-items:center">' +
                  '<select class="select" style="padding:9px 22px 9px 10px;font-size:11.5px;width:104px;border-radius:12px" data-type="' + i + '">' +
                    '<option value="stop"' + (p.type === 'stop' ? ' selected' : '') + '>Stop</option>' +
                    '<option value="landmark"' + (p.type === 'landmark' ? ' selected' : '') + '>Landmark</option>' +
                  '</select>' +
                  '<button class="icon-btn muted" data-remove="' + i + '" aria-label="Remove point" style="color:var(--mid)">' + window.Icons.x(16) + '</button>' +
                  '</span>') +
              '</span>' +
              '</div>'
            );
          }).join('')
        : '<div class="t-small" style="padding:4px 0 8px">No points yet. Use <b>Set Start</b>, then tap the map.</div>';

      panel.innerHTML =
        '<div class="t-cap" style="margin:0 0 8px;display:flex;gap:8px;align-items:flex-start">' +
          '<span style="flex:none;display:inline-flex;color:var(--navy);margin-top:1px">' + window.Icons.info(15) + '</span>' +
          '<span id="re-hint">' + UI.esc(hintText()) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<span class="t-card">' + draft.points.length + ' points · ' + draft.path.length + ' path nodes' +
          (draft.path.length ? ' · ' + (pathDistance() / 1000).toFixed(1) + ' km' : '') + '</span>' +
          (editing ? '<button class="icon-btn muted" data-act="delete" aria-label="Delete route">' + window.Icons.trash(19) + '</button>' : '') +
        '</div>' +
        (draft.corridor.length
          ? '<div class="area-row">' +
            '<span class="area-chip">' + window.Icons.polygon(14) + '</span>' +
            '<span class="sr-body"><b>Route area</b><span class="sr-sub">' +
            (draft.corridor.length >= 3
              ? draft.corridor.length + ' corner points · shaded corridor on the map'
              : draft.corridor.length + ' corner point' + (draft.corridor.length > 1 ? 's' : '') + ' · add ' + (3 - draft.corridor.length) + ' more to close') +
            '</span></span>' +
            '<button class="icon-btn muted" data-act="clear-area" aria-label="Clear area" style="color:var(--mid)">' + window.Icons.trash(16) + '</button>' +
            '</div>'
          : '') +
        rows;
    }

    function paintMap() {
      if (!kit) return;
      var editingArea = draft.mode === 'area';
      kit.drawCorridor(draft.corridor, {
        handles: editingArea,
        dim: false,
        onMarkerTap: handleTap,
        onDragEnd: function (i, latlng) {
          pushHistory();
          draft.corridor[i].lat = latlng.lat;
          draft.corridor[i].lng = latlng.lng;
          paintPoints();
          paintMap();
        },
      });
      kit.drawDraft(draft.points, draft.path, {
        onMarkerTap: handleTap,
        onDragEnd: function (i, latlng) {
          pushHistory();
          draft.points[i].lat = latlng.lat;
          draft.points[i].lng = latlng.lng;
          paintPoints();
        },
      });
      // In Edit Line mode every vertex of the drawn line gets a draggable handle,
      // so the line itself can be pulled into shape (not just the stops).
      if (draft.mode === 'edit' && draft.path.length) {
        kit.drawPathHandles(draft.path, {
          onDragEnd: function (i, latlng) {
            pushHistory();
            draft.path[i].lat = latlng.lat;
            draft.path[i].lng = latlng.lng;
            paintPoints();
            paintMap();
          },
        });
      } else if (kit.clearPathHandles) {
        kit.clearPathHandles();
      }
    }

    function fitDraft() {
      if (!kit) return;
      if (kit.resize) kit.resize();
      var all = draft.points.concat(draft.corridor || []);
      if (all.length) kit.fitPoints(all, [30, 50]);
      else kit.map.setView([7.0858, 125.6175], 13);
    }

    function handleTap(latlng) {
      if (!draft.mode) {
        UI.toast('Pick a tool first — Set Start, Add Stop, Set Endpoint, Draw Route or Draw Area');
        return;
      }
      if (draft.mode === 'area') {
        pushHistory();
        draft.corridor.push({ lat: latlng.lat, lng: latlng.lng });
        paintPoints();
        paintMap();
        if (draft.corridor.length === 3) UI.toast('Area closed — keep tapping to refine the corridor, drag handles to adjust');
        return;
      }
      if (draft.mode === 'edit') {
        if (draft.path.length < 2) { UI.toast('Draw the line first, then edit it'); return; }
        // Snap the tap onto the line (nearest point along it) rather than using the
        // raw tap, so the squeezed-in vertex lands exactly on the stroke instead of
        // a few pixels off it.
        var prepE = Geo.prepare(draft.path);
        var prE = Geo.project(prepE, latlng, null, null);
        var ptE = Geo.pointAt(prepE, prE.s);
        var at = segmentIndexAt(prepE, prE.s);
        pushHistory();
        draft.path.splice(at + 1, 0, { lat: ptE.lat, lng: ptE.lng });
        paintPoints();
        paintMap();
        UI.toast('Point squeezed in — drag the red handles to shape it');
        return;
      }
      if (draft.mode === 'erase') {
        if (draft.path.length < 2) { UI.toast('There is no line to erase yet'); return; }
        // A brush measured ALONG the line, not a per-point delete: one tap lifts the
        // whole run of vertices around it, so a wrong wiggle goes without redrawing
        // the route. The ends are always kept so the route stays a route.
        var BRUSH_M = 45;
        var prep = Geo.prepare(draft.path);
        var s0 = Geo.project(prep, latlng, null, null).s;
        // Centre the brush on the nearer end-vertex of the tapped segment, so a tap
        // anywhere on a stroke always lifts that vertex (and any neighbours inside
        // the brush) instead of falling harmlessly between two sparse points.
        var seg = segmentIndexAt(prep, s0);
        var sC = (s0 - prep.cum[seg]) <= (prep.cum[seg + 1] - s0) ? prep.cum[seg] : prep.cum[seg + 1];
        var keep = [];
        var removed = 0;
        for (var vi = 0; vi < draft.path.length; vi++) {
          var isEnd = vi === 0 || vi === draft.path.length - 1;
          if (!isEnd && Math.abs(prep.cum[vi] - sC) <= BRUSH_M) { removed++; continue; }
          keep.push(draft.path[vi]);
        }
        if (!removed) { UI.toast('Nothing within ' + BRUSH_M + ' m of that tap along the line'); return; }
        if (keep.length < 2) { UI.toast('That would erase the whole line — the rest of the route is kept instead'); return; }
        pushHistory();
        draft.path = keep;
        paintPoints();
        paintMap();
        UI.toast('Removed ' + removed + ' point' + (removed > 1 ? 's' : '') + ' — Undo brings them back');
        return;
      }
      pushHistory();
      if (draft.mode === 'start') {
        var first = draft.points[0];
        if (first && first.type === 'start') { first.lat = latlng.lat; first.lng = latlng.lng; }
        else draft.points.unshift({ lat: latlng.lat, lng: latlng.lng, name: 'Start point', type: 'start' });
      } else if (draft.mode === 'endpoint') {
        var last = draft.points[draft.points.length - 1];
        if (last && last.type === 'endpoint') { last.lat = latlng.lat; last.lng = latlng.lng; }
        else draft.points.push({ lat: latlng.lat, lng: latlng.lng, name: 'Endpoint', type: 'endpoint' });
      } else if (draft.mode === 'stop') {
        var insertAt = draft.points.length && draft.points[draft.points.length - 1].type === 'endpoint' ? draft.points.length - 1 : draft.points.length;
        promptName('Name this stop or landmark', '').then(function (name) {
          if (name == null) { history.pop(); return; }
          draft.points.splice(Math.max(1, insertAt), 0, {
            lat: latlng.lat,
            lng: latlng.lng,
            name: name || 'Stop ' + (draft.points.length + 1),
            type: 'stop',
          });
          paintPoints();
          paintMap();
          UI.toast('Stop added');
        });
        return;
      } else if (draft.mode === 'draw') {
        draft.path.push({ lat: latlng.lat, lng: latlng.lng });
      }
      paintPoints();
      paintMap();
    }

    function promptName(title, value) {
      return new Promise(function (resolve) {
        var scrim = DOM.el(
          '<div class="scrim"><div class="dialog">' +
          '<h3>' + UI.esc(title) + '</h3>' +
          '<div class="field"><input class="input plain" id="pn-input" placeholder="e.g. Victoria Plaza" value="' + UI.esc(value || '') + '" /></div>' +
          '<div class="t-cap" style="margin:-6px 0 14px">Named landmarks power the "Near …" readout for passengers.</div>' +
          '<div class="dialog-actions"><button class="btn quiet" data-act="cancel">Cancel</button><button class="btn" data-act="ok">Save</button></div>' +
          '</div></div>'
        );
        el.appendChild(scrim);
        var input = DOM.qs(scrim, '#pn-input');
        setTimeout(function () { input.focus(); }, 30);
        function finish(val) { scrim.remove(); resolve(val); }
        scrim.addEventListener('click', function (e) {
          if (e.target === scrim || e.target.closest('[data-act="cancel"]')) finish(null);
          else if (e.target.closest('[data-act="ok"]')) finish(input.value.trim());
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') finish(input.value.trim());
          if (e.key === 'Escape') finish(null);
        });
      });
    }

    async function generatePath() {
      pushHistory();
      if (draft.points.length < 2) {
        UI.toast('Add at least a start and an endpoint first', 'error');
        return;
      }
      var tool = DOM.qs(el, '[data-act="generate"]');
      if (tool) tool.innerHTML = '<span class="spinner" style="border-top-color:#fff"></span> Building…';
      try {
        var res = await window.API.roadRoute(draft.points.map(function (p) { return { lat: p.lat, lng: p.lng }; }));
        draft.path = res.path || [];
        UI.toast(res.source === 'osrm' ? 'Route generated along real roads' : 'Straight-line preview (routing service offline)', res.source === 'osrm' ? 'success' : undefined);
      } catch (e) {
        draft.path = [];
        for (var i = 1; i < draft.points.length; i++) {
          var a = draft.points[i - 1], b = draft.points[i];
          if (!draft.path.length) draft.path.push({ lat: a.lat, lng: a.lng });
          for (var s = 1; s <= 24; s++) draft.path.push({ lat: a.lat + ((b.lat - a.lat) * s) / 24, lng: a.lng + ((b.lng - a.lng) * s) / 24 });
        }
        UI.toast('Routing service unavailable — straight-line preview used', 'error');
      }
      if (tool) tool.innerHTML = window.Icons.routeIcon(17) + ' Generate Path';
      paintPoints();
      paintMap();
    }

    function undo() {
      if (!history.length) { UI.toast('Nothing to undo'); return; }
      future.push(snap());
      restore(history.pop());
      paintPoints();
      paintTools();
      paintMap();
      UI.toast('Undone');
    }

    function redo() {
      if (!future.length) { UI.toast('Nothing to redo'); return; }
      history.push(snap());
      restore(future.pop());
      paintPoints();
      paintTools();
      paintMap();
      UI.toast('Redone');
    }

    async function save() {
      var name = DOM.qs(el, '#re-name').value.trim();
      if (!name) { UI.toast('Route name is required', 'error'); return; }
      if (draft.points.length < 2) { UI.toast('Add a start and an endpoint (at least two points)', 'error'); return; }
      if (!draft.path.length) await generatePath();
      if (!draft.path.length) { UI.toast('Could not build a path — try Generate Path again', 'error'); return; }

      var stops = draft.points.map(function (p, i) {
        var type = i === 0 ? 'start' : i === draft.points.length - 1 ? 'endpoint' : p.type === 'landmark' ? 'landmark' : 'stop';
        return { name: p.name || 'Stop ' + (i + 1), latitude: p.lat, longitude: p.lng, type: type, order: i + 1 };
      });
      var payload = {
        name: name,
        color: draft.color,
        color2: draft.color2 || null,
        stops: stops,
        path: draft.path,
        corridor: draft.corridor.length >= 3 ? draft.corridor : [],
        startPoint: { lat: stops[0].latitude, lng: stops[0].longitude, name: stops[0].name },
        endPoint: {
          lat: stops[stops.length - 1].latitude,
          lng: stops[stops.length - 1].longitude,
          name: stops[stops.length - 1].name,
        },
        active: true,
      };
      try {
        if (editing) await window.API.updateRoute(editing.id, payload);
        else await window.API.createRoute(payload);
        commit();
        UI.toast(editing ? 'Route saved' : 'Route created', 'success');
        window.Router.back();
      } catch (e) {
        var msg = e.payload && e.payload.errors ? e.payload.errors[0] : e.message;
        UI.toast(msg, 'error');
      }
    }

    return {
      el: el,
      mount: function () {
        if (routeId && !editing) {
          // cold deep link: the store has not arrived yet, so say so instead of
          // opening an empty "New Route" form for an existing route
          el.innerHTML =
            UI.appbar({ title: 'Edit Route', bare: true }) +
            UI.emptyState(window.Icons.routeIcon(26), 'Loading route\u2026', 'Fetching the latest route data.');
          return;
        }
        start();
      },
      update: function () {
        if (started || !routeId) return;
        var r = Store.routeById(routeId);
        if (!r) return;
        editing = r;
        draft.name = r.name || '';
        draft.color = r.color || draft.color;
        draft.color2 = r.color2 || null;
        draft.points = (r.stops || []).slice().sort(function (a, b) { return a.order - b.order; }).map(function (st) {
          return { lat: st.latitude, lng: st.longitude, name: st.name, type: st.type };
        });
        draft.path = (r.path || []).slice();
        draft.corridor = r.corridor ? r.corridor.slice() : [];
        start();
      },
      unmount: function () { if (kit) kit.destroy(); kit = null; },
    };

    function start() {
      started = true;
      buildShell();
        // the map box is measured a frame later, so fit after it has a size
        requestAnimationFrame(function () {
          fitDraft();
          setTimeout(function () { fitDraft(); if (kit) kit.invalidate(); }, 150);
        });
        commit();
        // Unsaved-changes guard (spec 89) — the back chevron asks first.
        el.addEventListener(
          'click',
          function (e) {
            if (!e.target.closest('[data-nav="back"]') || !dirty()) return;
            e.stopPropagation();
            e.preventDefault();
            UI.confirm({
              title: 'Discard changes?',
              message: 'You have unsaved changes to this route.',
              confirmLabel: 'Discard',
              danger: true,
            }).then(function (ok) { if (ok) window.Router.back(); });
          },
          true
        );
        el.addEventListener('click', async function (e) {
          var modeBtn = e.target.closest('[data-mode]');
          if (modeBtn) {
            draft.mode = draft.mode === modeBtn.dataset.mode ? null : modeBtn.dataset.mode;
            paintTools();
            paintMap();
            // The panel above the map changes height as tools come and go; without
            // a resize pass Leaflet keeps a stale container rect and tap->latlng
            // drifts away from where the line visibly is.
            if (kit && kit.invalidate) kit.invalidate();
            // bring the map back into view so the next tap lands on it
            var frame = DOM.qs(el, '.map-frame');
            if (frame && draft.mode) {
              var box = frame.getBoundingClientRect();
              if (box.top < 60 || box.bottom > window.innerHeight) {
                frame.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }
            }
            return;
          }
          var remove = e.target.closest('[data-remove]');
          if (remove) {
            pushHistory();
            draft.points.splice(+remove.dataset.remove, 1);
            paintPoints();
            paintMap();
            return;
          }
          if (e.target.closest('[data-act="color"]')) {
            toggleColorPanel();
            return;
          }
          if (e.target.closest('[data-act="generate"]')) return generatePath();
          if (e.target.closest('[data-act="undo"]')) return undo();
          if (e.target.closest('[data-act="redo"]')) return redo();

          if (e.target.closest('[data-act="clear-area"]')) {
            pushHistory();
            draft.corridor = [];
            paintPoints();
            paintMap();
            UI.toast('Route area cleared');
            return;
          }
          if (e.target.closest('[data-act="save"]')) return save();
          if (e.target.closest('[data-act="delete"]')) {
            var yes = await UI.confirm({
              title: 'Delete route?',
              message: 'This cannot be undone. Any jeepneys on this route are unassigned — their devices stay in the list.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!yes) return;
            try {
              await window.API.deleteRoute(editing.id);
              UI.toast('Route deleted', 'success');
              window.Router.reset('admin-routes');
            } catch (err) { UI.toast(err.message, 'error'); }
          }
        });
        el.addEventListener('input', function (e) {
          if (e.target.id === 're-name') draft.name = e.target.value;
          var nameAttr = e.target.dataset && e.target.dataset.name;
          if (nameAttr != null && draft.points[+nameAttr]) draft.points[+nameAttr].name = e.target.value;
        });
        el.addEventListener('change', function (e) {
          var typeAttr = e.target.dataset && e.target.dataset.type;
          if (typeAttr != null && draft.points[+typeAttr]) {
            pushHistory();
            draft.points[+typeAttr].type = e.target.value;
            paintPoints();
          }
        });
    }
  }

  /* -------------------------------------------------------- device list */
  function adminDeviceListScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var q = '';

    function render() {
      var devices = Store.state.devices.filter(function (d) {
        if (!q) return true;
        var route = Store.routeById(d.routeId);
        return d.name.toLowerCase().indexOf(q.toLowerCase()) >= 0 ||
          (d.driver || '').toLowerCase().indexOf(q.toLowerCase()) >= 0 ||
          (route && route.name.toLowerCase().indexOf(q.toLowerCase()) >= 0);
      });
      el.innerHTML =
        UI.appbar({ bare: true, title: '' }) +
        '<div class="search-band">' +
          '<div class="search">' +
            '<span class="search-icon">' + window.Icons.search(20) + '</span>' +
            '<input id="ad-search" placeholder="Search jeepneys" value="' + UI.esc(q) + '" aria-label="Search jeepneys" />' +
            '<button class="clear" data-act="clear-search" aria-label="Clear">' + window.Icons.x(20) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="scroll" style="padding:16px 14px">' +
          (devices.length
            ? '<div class="pill-list flush">' + devices.map(adminDeviceRow).join('') + '</div>'
            : q
            ? UI.emptyState(window.Icons.search(28), 'No jeepney matches "' + UI.esc(q) + '".', 'Try another name, or clear the search.')
            : UI.emptyState(window.Icons.jeep(28), 'No jeepneys yet.', 'Add a jeepney, assign it a route, then hand the driver mode to its phone.')) +
          '<div style="height:8px"></div>' +
        '</div>' +
        '<div class="bar-stack over-map">' +
          '<button class="bar-action" data-nav="admin-device-editor">' + window.Icons.plus(19) + ' Add jeepney / GPS device</button>' +
        '</div>';

      var input = DOM.qs(el, '#ad-search');
      input.addEventListener('input', function () {
        q = input.value;
        render();
        var again = DOM.qs(el, '#ad-search');
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      });
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="clear-search"]')) { q = ''; render(); return; }
          var card = e.target.closest('[data-device]');
          if (card) window.Router.go('admin-device-detail', { deviceId: card.dataset.device });
        });
      },
      update: render,
    };
  }

  /** Humane hint for an editor point: distance from the previous point. */
  function pointHint(points, i) {
    if (i === 0) return 'Starting point';
    var a = points[i - 1];
    var b = points[i];
    var m = Geo.haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    return Geo.formatDistance(m) + ' from point ' + i;
  }

  /* ------------------------------------------------------ device detail (p-14) */
  function adminDeviceDetailScreen(params) {
    var deviceId = params.deviceId;
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;

    function pills(d) {
      return (
        UI.statusPill(d, { pulse: true, lg: true }) +
        '<span class="pill">' + UI.esc(d.type || 'Traditional') + '</span>' +
        (d.simulated ? '<span class="pill navy">DEV simulator</span>' : '') +
        (d.active ? '' : '<span class="pill inactive">Inactive</span>')
      );
    }

    function facts(d, route) {
      return (
        '<div class="kv"><span class="k">Route</span><span class="v">' + UI.esc(route ? route.name : 'Not assigned') + '</span></div>' +
        '<div class="kv"><span class="k">Driver</span><span class="v">' + UI.esc(d.driver || '—') + '</span></div>' +
        '<div class="kv"><span class="k">Near</span><span class="v">' + UI.esc(d.landmark ? d.landmark.name : d.status === 'online' ? 'En route' : '—') + '</span></div>' +
        '<div class="kv"><span class="k">Speed</span><span class="v">' + Geo.formatSpeed(d.speedKmh) + '</span></div>' +
        '<div class="kv"><span class="k">Distance to next stop</span><span class="v">' + (d.distanceToNextStopM != null ? Geo.formatDistance(d.distanceToNextStopM) : '—') + '</span></div>' +
        '<div class="kv"><span class="k">Last update</span><span class="v">' + (d.ageMs != null ? Geo.formatRelative(d.ageMs) : 'no signal yet') + '</span></div>' +
        '<div class="kv"><span class="k">Route progress</span><span class="v">' + (d.progressPct != null ? d.progressPct.toFixed(0) + '%' : '—') + '</span></div>' +
        (d.offRouteM != null && d.offRoute
          ? '<div class="alert" style="margin-top:10px">' + window.Icons.alert(16) + '<span>Off route by about ' + Math.round(d.offRouteM) + ' m — the jeepney may be detouring, or the GPS fix drifted.</span></div>'
          : '') +
        (d.position ? '<div class="kv"><span class="k">GPS (admin view)</span><span class="v">' + d.position.lat.toFixed(5) + ', ' + d.position.lng.toFixed(5) + '</span></div>' : '')
      );
    }

    function render() {
      var d = Store.deviceById(deviceId);
      if (!d) {
        el.innerHTML =
          UI.appbar({ title: 'Jeepney Info' }) +
          (Store.state.devices.length
            ? UI.emptyState(window.Icons.alert(26), 'Jeepney not found.', 'It may have been removed.')
            : UI.emptyState(window.Icons.jeep(26), 'Loading jeepneys\u2026', 'Fetching the latest device data.'));
        return;
      }
      var route = Store.routeById(d.routeId);
      el.innerHTML =
        UI.appbar({ title: 'Jeepney Info', bare: true }) +
        '<div class="scroll" style="padding:14px 16px 16px">' +
          '<div style="display:flex;justify-content:center;margin-bottom:10px">' + window.Brand.jeepAvatar(colorOf(d), 88, { color2: d.color2 || null }) + '</div>' +
          '<div id="addv-pills" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:16px">' + pills(d) + '</div>' +
          '<div class="field"><label>Name:</label><div class="input" style="display:flex;align-items:center;justify-content:center">' + UI.esc(d.name) + '</div></div>' +
          '<div class="field"><label>Route:</label><div class="input" style="display:flex;align-items:center;justify-content:center">' + UI.esc(route ? route.name : 'Not assigned') + '</div></div>' +
          '<div class="field"><label>Type:</label><div class="input" style="display:flex;align-items:center;justify-content:center">' + UI.esc(d.type || 'Traditional') + '</div></div>' +
          '<div class="map-frame" style="height:170px;flex:none;margin:6px 0 14px"><div class="map" id="add-map"></div></div>' +
          '<div class="container pad" id="addv-kv">' + facts(d, route) + '</div>' +
          '<div class="section-label">Demo controls</div>' +
          '<div class="card">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
              '<span style="flex:1"><span class="t-card" style="display:block">Simulate movement</span><span class="t-small">Drive this jeepney along its route automatically</span></span>' +
              '<button class="switch' + (d.simulated ? ' on' : '') + '" data-act="simulate" role="switch" aria-checked="' + !!d.simulated + '"><span class="switch-track"></span></button>' +
            '</div>' +
            '<div class="t-cap" style="margin-bottom:6px">Place on route</div>' +
            '<div class="btn-row">' +
              '<button class="btn sm quiet" data-place="0.15">15%</button>' +
              '<button class="btn sm quiet" data-place="0.5">50%</button>' +
              '<button class="btn sm quiet" data-place="0.85">85%</button>' +
            '</div>' +
            '<div style="height:10px"></div>' +
            '<button class="bar-action quiet" data-nav="driver" data-driver="' + UI.esc(d.id) + '">' + window.Icons.phone(17) + ' Open tracking mode</button>' +
          '</div>' +
          '<div class="bar-stack" style="padding:16px 0 0">' +
            '<button class="bar-action" data-act="edit">Edit</button>' +
            '<button class="bar-action danger" data-act="delete">Delete</button>' +
          '</div>' +
          '<div style="height:10px"></div>' +
        '</div>';

      requestAnimationFrame(function () {
        if (kit) kit.destroy();
        kit = window.MapKit.create(DOM.qs(el, '#add-map'), { zoom: 14 });
        if (route) kit.drawRoute(route, { showStops: true, dim: true, casing: false, weight: 4 });
        if (d.position) {
          kit.upsertDevice(d, { selected: true });
          if (route && route.path && route.path.length) {
            var pts = route.path.map(function (p) { return { lat: p.lat, lng: p.lng }; });
            pts.push(d.position);
            kit.fitPoints(pts, [26, 34]);
          } else kit.panTo(d.position, 15);
        }
      });
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', async function (e) {
          var d = Store.deviceById(deviceId);
          if (!d) return;
          if (e.target.closest('[data-act="edit"]')) return void window.Router.go('admin-device-editor', { deviceId: deviceId });
          var sw = e.target.closest('[data-act="simulate"]');
          if (sw) {
            try {
              await window.API.setSimulate(deviceId, !d.simulated, 0.1);
              UI.toast(!d.simulated ? 'Simulated movement started' : 'Simulated movement stopped');
            } catch (err) { UI.toast(err.message, 'error'); }
            return;
          }
          var place = e.target.closest('[data-place]');
          if (place) {
            try {
              await window.API.placeDevice(deviceId, +place.dataset.place);
              UI.toast('Jeepney placed at ' + Math.round(+place.dataset.place * 100) + '% of the route');
            } catch (err) { UI.toast(err.message, 'error'); }
            return;
          }
          if (e.target.closest('[data-act="delete"]')) {
            var ok = await UI.confirm({ title: 'Delete ' + d.name + '?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            try {
              await window.API.deleteDevice(deviceId);
              UI.toast('Jeepney deleted', 'success');
              window.Router.back();
            } catch (err) { UI.toast(err.message, 'error'); }
          }
        });
      },
      update: function () {
        var d = Store.deviceById(deviceId);
        if (!d || !DOM.qs(el, '#addv-kv')) { render(); return; }
        var route = Store.routeById(d.routeId);
        var pillsHost = DOM.qs(el, '#addv-pills');
        if (pillsHost) pillsHost.innerHTML = pills(d);
        var kv = DOM.qs(el, '#addv-kv');
        if (kv) kv.innerHTML = facts(d, route);
        var sw = DOM.qs(el, '[data-act="simulate"]');
        if (sw) sw.classList.toggle('on', !!d.simulated);
        if (kit && d.position) kit.upsertDevice(d, { selected: true });
      },
      unmount: function () { if (kit) kit.destroy(); kit = null; },
    };
  }

  /* ------------------------------------------------------ device editor (p-15) */
  function adminDeviceEditorScreen(params) {
    var deviceId = params && params.deviceId ? params.deviceId : null;
    var editing = deviceId ? Store.deviceById(deviceId) : null;
    var el = DOM.el('<div class="screen plain"></div>');

    function render() {
      var routes = Store.state.routes;
      el.innerHTML =
        UI.appbar({ title: editing ? 'Edit Jeepney Info' : 'Add Jeepney', bare: true }) +
        '<div class="scroll" style="padding:14px 16px 16px">' +
          '<div id="de-preview" style="display:flex;justify-content:center;margin-bottom:12px"></div>' +
          '<div class="field"><label for="de-name">Name:</label>' +
            '<input class="input" id="de-name" placeholder="Type here" value="' + UI.esc(editing ? editing.name : '') + '" /></div>' +
          '<div class="field"><label for="de-driver">Driver:</label>' +
            '<input class="input" id="de-driver" placeholder="Type here" value="' + UI.esc(editing ? editing.driver || '' : '') + '" />' +
            '<div class="hint">Shown to admins only — never to passengers.</div></div>' +
          '<div class="field"><label for="de-route">Route:</label>' +
            '<select class="select" id="de-route">' +
              '<option value="">Type here</option>' +
              routes.map(function (r) {
                return '<option value="' + UI.esc(r.id) + '"' + (editing && editing.routeId === r.id ? ' selected' : '') + '>' + UI.esc(r.name) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field"><label for="de-type">Type:</label>' +
            '<select class="select" id="de-type">' +
              ['Traditional', 'Modern', 'Other'].map(function (t) {
                return '<option' + (editing && editing.type === t ? ' selected' : '') + '>' + t + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field"><label for="de-phone">Phone / device identifier</label>' +
            '<input class="input" id="de-phone" placeholder="Type here" value="' + UI.esc(editing ? editing.phone || '' : '') + '" /></div>' +
          '<div class="card tight" style="display:flex;align-items:center;gap:12px">' +
            '<span style="flex:1"><span class="t-card" style="display:block">Tracking enabled</span><span class="t-small">Inactive jeepneys are hidden from passengers</span></span>' +
            '<button class="switch' + (!editing || editing.active ? ' on' : '') + '" id="de-active" role="switch"><span class="switch-track"></span></button>' +
          '</div>' +
          '<div class="t-cap" style="text-align:center;margin-top:8px">Colour</div>' +
          '<div id="de-colors" style="display:flex;gap:10px;justify-content:center;margin-top:6px"></div>' +
          '<div id="de-error"></div>' +
          '<div class="bar-stack" style="padding:16px 0 0">' +
            '<button class="bar-action" data-act="save">Save</button>' +
            (editing ? '<button class="bar-action danger" data-act="delete">Delete</button>' : '') +
          '</div>' +
        '</div>';

      var color = editing ? colorOf(editing) : window.Brand.palette[0];
      var color2 = (editing && editing.color2) || null;
      var host = DOM.qs(el, '#de-colors');
      host.innerHTML = UI.colorPickerHtml({ id: 'jeep', color: color, color2: color2 });
      var preview = DOM.qs(el, '#de-preview');
      var sw = DOM.qs(el, '#de-active');
      sw.addEventListener('click', function () { sw.classList.toggle('on'); });
      UI.wireColorPicker(
        host,
        function (v) { color = v.color; color2 = v.color2; },
        function (v) { return window.Brand.jeepAvatar(v.color, 84, { color2: v.color2 }); }
      );
      el._color = function () { return color; };
      el._color2 = function () { return color2; };
    }

    return {
      el: el,
      mount: function () {
        if (deviceId && !editing) {
          el.innerHTML =
            UI.appbar({ title: 'Edit Jeepney Info', bare: true }) +
            UI.emptyState(window.Icons.jeep(26), 'Loading jeepney\u2026', 'Fetching the latest device data.');
          return;
        }
        render();
        el.addEventListener('click', async function (e) {
          if (e.target.closest('[data-act="save"]')) {
            var payload = {
              name: DOM.qs(el, '#de-name').value.trim(),
              driver: DOM.qs(el, '#de-driver').value.trim(),
              routeId: DOM.qs(el, '#de-route').value || null,
              type: DOM.qs(el, '#de-type').value,
              phone: DOM.qs(el, '#de-phone').value.trim(),
              color: el._color(),
              color2: el._color2 ? el._color2() : null,
              active: DOM.qs(el, '#de-active').classList.contains('on'),
            };
            var errs = [];
            if (!payload.name) errs.push('Name is required.');
            if (!payload.routeId) errs.push('Assign a route to this jeepney.');
            if (errs.length) {
              DOM.qs(el, '#de-error').innerHTML = '<div class="alert" style="margin-top:12px">' + window.Icons.alert(16) + '<span>' + UI.esc(errs[0]) + '</span></div>';
              return;
            }
            try {
              if (editing) await window.API.updateDevice(editing.id, payload);
              else await window.API.createDevice(payload);
              UI.toast(editing ? 'Jeepney updated' : 'Jeepney added', 'success');
              window.Router.back();
            } catch (err) {
              var msg = err.payload && err.payload.errors ? err.payload.errors[0] : err.message;
              DOM.qs(el, '#de-error').innerHTML = '<div class="alert" style="margin-top:12px">' + window.Icons.alert(16) + '<span>' + UI.esc(msg) + '</span></div>';
            }
            return;
          }
          if (e.target.closest('[data-act="delete"]')) {
            var ok = await UI.confirm({ title: 'Delete ' + editing.name + '?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
            if (!ok) return;
            try {
              await window.API.deleteDevice(editing.id);
              UI.toast('Jeepney deleted', 'success');
              window.Router.reset('admin-devices');
            } catch (err) { UI.toast(err.message, 'error'); }
          }
        });
      },
      update: function () {
        if (!deviceId) return;
        var d = Store.deviceById(deviceId);
        if (!d) return;                       // still waiting for the store
        editing = d;
        render();
      },
    };
  }

  /* ------------------------------------------------------------ live map */
  function adminLiveMapScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;
    var selected = null;

    function sheetHtml() {
      var devices = Store.state.devices;
      var online = devices.filter(function (d) { return d.status === 'online'; });
      var sel = selected ? Store.deviceById(selected) : null;
      var body = '';
      if (sel) {
        var route = Store.routeById(sel.routeId);
        body +=
          '<div class="container bordered-navy" style="margin:2px 14px 12px">' +
          '<div class="container-title" style="font-size:var(--f-section)">' + UI.esc(sel.name) + '</div>' +
          '<div class="container-body">' +
          '<div class="kv"><span class="k">Route</span><span class="v">' + UI.esc(route ? route.name : '—') + '</span></div>' +
          '<div class="kv"><span class="k">GPS</span><span class="v">' + (sel.status === 'online' ? 'Online' : sel.status === 'connecting' ? 'Connecting' : 'Offline') + '</span></div>' +
          '<div class="kv"><span class="k">Near</span><span class="v">' + UI.esc(sel.landmark ? sel.landmark.name : '—') + '</span></div>' +
          '<div class="kv"><span class="k">Speed</span><span class="v">' + Geo.formatSpeed(sel.speedKmh) + '</span></div>' +
          '<div class="kv"><span class="k">Last update</span><span class="v">' + (sel.ageMs != null ? Geo.formatRelative(sel.ageMs) : 'never') + '</span></div>' +
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn sm ghost" data-open="' + UI.esc(sel.id) + '">Device details</button>' +
            '<button class="btn sm quiet" data-act="clear-select">Close</button>' +
          '</div></div></div>';
      }
      body +=
        '<div class="t-cap" style="padding:0 18px 8px">' + online.length + ' online · ' + devices.length + ' devices</div>' +
        '<div class="pill-list" style="padding:0 14px 14px">' +
        (devices.length ? devices.map(adminDeviceRow).join('') : UI.emptyState(window.Icons.jeep(26), 'No GPS devices yet.')) +
        '</div>';
      return body;
    }

    function renderSheet() {
      var host = DOM.qs(el, '#alm-sheet');
      if (!host) return;
      var top = host.scrollTop;               // keep the reader's place in the list
      host.innerHTML = sheetHtml();
      if (top) host.scrollTop = top;
    }

    function renderMap() {
      if (!kit) return;
      kit.clearRoute();
      kit.clearCorridor();
      Store.state.routes.forEach(function (r) {
        if (!Store.devices({ routeId: r.id, activeOnly: true }).length) return;
        // corridor first, then the route line on top of it (spec 49)
        if (r.corridor && r.corridor.length >= 3) kit.drawCorridor(r.corridor, { dim: true, fillColor: colorOf(r) === '#ADB5BD' ? '#173B5C' : colorOf(r) });
        kit.drawRoute(r, { dim: true, showStops: false, casing: false, weight: 4, color: colorOf(r) === '#ADB5BD' ? '#173B5C' : colorOf(r) });
      });
      var visible = Store.devices({ activeOnly: true });
      kit.keepOnlyDevices(visible.map(function (d) { return d.id; }));
      visible.forEach(function (d) {
        kit.upsertDevice(d, {
          selected: d.id === selected,
          onClick: function (id) {
            selected = id;
            var picked = Store.deviceById(id);
            if (kit && picked && picked.position) kit.panTo(picked.position, 15);
            renderSheet();
            renderMap();
          },
        });
      });
    }

    return {
      el: el,
      mount: function () {
        el.innerHTML =
          UI.appbar({
            title: 'Live Map',
            icon: '<span style="display:inline-flex">' + window.Icons.navigation(20) + '</span>',
            right: '<button class="icon-btn" data-act="fit" aria-label="Fit all">' + window.Icons.target(20) + '</button>',
          }) +
          '<div class="map-frame" style="padding:0 0 0 0"><div class="map" id="alm-map" style="inset:0 0 46% 0;border-radius:0;border:none"></div></div>' +
          '<div data-keep-scroll style="position:absolute;left:0;right:0;bottom:0;top:52%;z-index:460;background:#fff;border-top-left-radius:22px;border-top-right-radius:22px;box-shadow:0 -6px 24px rgba(23,59,92,.14);overflow-y:auto" id="alm-sheet"></div>';
        kit = window.MapKit.create(DOM.qs(el, '#alm-map'), { center: [7.0858, 125.6175], zoom: 13 });
        renderMap();
        renderSheet();
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="fit"]')) {
            var pts = [];
            Store.state.routes.forEach(function (r) {
              if (Store.devices({ routeId: r.id, activeOnly: true }).length && r.path) pts = pts.concat(r.path);
            });
            if (pts.length) kit.fitPoints(pts, [26, 60]);
            return;
          }
          if (e.target.closest('[data-act="clear-select"]')) { selected = null; renderSheet(); renderMap(); return; }
          var open = e.target.closest('[data-open]');
          if (open) return void window.Router.go('admin-device-detail', { deviceId: open.dataset.open });
          var card = e.target.closest('[data-device]');
          if (card) {
            selected = card.dataset.device;
            var d = Store.deviceById(selected);
            if (d && d.position) kit.panTo(d.position, 15);
            renderSheet();
            renderMap();
          }
        });
      },
      update: function () { renderMap(); renderSheet(); },
      unmount: function () { if (kit) kit.destroy(); kit = null; },
    };
  }

  /* -------------------------------------------- driver / GPS phone mode */
  function driverScreen(params) {
    var deviceId = params.deviceId;
    var el = DOM.el('<div class="screen plain"></div>');
    var watchId = null;
    var lastSent = 0;
    var sendCount = 0;
    var skippedCount = 0;
    var lastError = null;

    function render() {
      var d = Store.deviceById(deviceId);
      if (!d) {
        el.innerHTML =
          UI.appbar({ title: 'Driver mode' }) +
          (Store.state.devices.length
            ? UI.emptyState(window.Icons.alert(26), 'Jeepney not found.', 'Pick another device from Jeepney info.')
            : UI.emptyState(window.Icons.jeep(26), 'Loading jeepneys\u2026', 'Fetching the latest device data.'));
        return;
      }
      var route = Store.routeById(d.routeId);
      var active = watchId != null;
      el.innerHTML =
        UI.appbar({ title: window.Brand.name.toUpperCase() + ' DRIVER' }) +
        '<div class="scroll" style="padding:14px 16px 16px">' +
          '<div style="display:flex;justify-content:center;margin-bottom:12px">' + window.Brand.jeepAvatar(colorOf(d), 92, { color2: d.color2 || null }) + '</div>' +
          '<div class="title-pill" style="margin-bottom:12px">' + UI.esc(d.name) + '</div>' +
          '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:14px">' +
            '<span class="pill ' + (active ? 'online' : 'offline') + ' lg"><i class="dot' + (active ? ' pulse' : '') + '"></i>' + (active ? 'GPS ACTIVE' : 'GPS STOPPED') + '</span>' +
            UI.statusPill(d, { pulse: true }) +
          '</div>' +
          (d.simulated
            ? '<div class="alert" style="margin-bottom:12px">' + window.Icons.info(16) + '<span><b>DEV simulator.</b> This jeepney moves on a demo path — no real phone is reporting GPS. Turn the simulator off to use a phone.</span></div>'
            : '') +
          (lastError ? '<div class="alert" style="margin-bottom:12px">' + window.Icons.alert(16) + '<span>' + UI.esc(lastError) + '</span></div>' : '') +
          '<div class="container pad">' +
            '<div class="kv"><span class="k">Route</span><span class="v">' + UI.esc(route ? route.name : 'Not assigned') + '</span></div>' +
            '<div class="kv"><span class="k">Location sharing</span><span class="v">' + (active ? 'Active' : 'Off') + '</span></div>' +
            '<div class="kv"><span class="k">Last update</span><span class="v">' + (d.ageMs != null ? Geo.formatRelative(d.ageMs) : 'waiting') + '</span></div>' +
            '<div class="kv"><span class="k">Fixes sent</span><span class="v">' + sendCount + (skippedCount ? ' (' + skippedCount + ' rejected)' : '') + '</span></div>' +
            '<div class="kv"><span class="k">Speed</span><span class="v">' + Geo.formatSpeed(d.speedKmh) + '</span></div>' +
            '<div class="kv"><span class="k">Near</span><span class="v">' + UI.esc(d.landmark ? d.landmark.name : d.status === 'online' ? 'En route' : '—') + '</span></div>' +
            '<div class="kv"><span class="k">Coordinates (admin view)</span><span class="v">' + (d.position ? d.position.lat.toFixed(5) + ', ' + d.position.lng.toFixed(5) : '—') + '</span></div>' +
          '</div>' +
          '<div class="bar-stack" style="padding:14px 0 0">' +
            (active
              ? '<button class="bar-action danger" data-act="stop">Stop sharing location</button>'
              : '<button class="bar-action" data-act="start">Start sharing location</button>') +
          '</div>' +
          '<div class="card" style="margin-top:16px">' +
            '<span class="t-card" style="display:block;margin-bottom:4px">DEV only — the simulator</span>' +
            '<span class="t-small">For development and demos when no second phone is available: it walks this jeepney along its assigned route so landmark matching and ETA can be demonstrated. It never runs unless you start it, it is labelled <b>DEV</b> everywhere it appears, and real tracking always comes from a phone above.</span>' +
            '<div class="btn-row" style="margin-top:12px">' +
              '<button class="btn sm ' + (d.simulated ? 'danger' : 'secondary') + '" data-act="simulate">' + (d.simulated ? 'Stop simulator' : 'Start simulator') + '</button>' +
              '<button class="btn sm quiet" data-place="0.1">Place at 10%</button>' +
            '</div>' +
          '</div>' +
          '<div class="alert info" style="margin-top:14px">' + window.Icons.info(15) +
            '<span>Foreground tracking only. Keep this screen open while the demo runs (spec 60).</span></div>' +
          '<div style="height:16px"></div>' +
        '</div>';
    }

    function start() {
      if (!navigator.geolocation) { lastError = 'GPS unavailable. Please enable location access.'; render(); return; }
      lastError = null;
      watchId = navigator.geolocation.watchPosition(
        function (pos) {
          var now = Date.now();
          if (now - lastSent < 2000) return;
          lastSent = now;
          sendCount++;
          window.API.sendLocation(deviceId, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : undefined,
            heading: pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : undefined,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
          }).then(function (res) {
            if (res && res.ok === false) {
              skippedCount++;
              lastError = 'A GPS reading was rejected as implausible (' + (res.skipped || 'bad fix') + '). Check that the phone has a clear view of the sky.';
            } else if (lastError && lastError.indexOf('rejected') >= 0) {
              lastError = null;
            }
            render();
          }).catch(function (e) { lastError = 'Upload failed — ' + e.message; render(); });
          if (sendCount % 2 === 0) render();
        },
        function (err) {
          lastError = err && err.code === 1 ? 'GPS unavailable. Please enable location access.' : 'Waiting for GPS…';
          render();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
      );
      render();
    }

    function stop() {
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      window.API.setTracking(deviceId, false).catch(function () {});
      render();
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('click', async function (e) {
          if (e.target.closest('[data-act="start"]')) { start(); UI.toast('Sharing location from this phone'); return; }
          if (e.target.closest('[data-act="stop"]')) { stop(); UI.toast('Location sharing stopped'); return; }
          var d = Store.deviceById(deviceId);
          if (e.target.closest('[data-act="simulate"]')) {
            try {
              await window.API.setSimulate(deviceId, !d.simulated, 0.1);
              UI.toast(!d.simulated ? 'Simulator running' : 'Simulator stopped');
            } catch (err) { UI.toast(err.message, 'error'); }
            return;
          }
          if (e.target.closest('[data-place]')) {
            try { await window.API.placeDevice(deviceId, +e.target.closest('[data-place]').dataset.place); }
            catch (err) { UI.toast(err.message, 'error'); }
          }
        });
      },
      update: render,
      unmount: function () {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
      },
    };
  }

  /* ---------------------------------------------------------- places list */
  /* Destinations are the places passengers can search for. They ship as a small
   * curated Davao list, but an admin can grow or trim it here so the product is
   * never dependent on baked-in content. */
  function adminPlaceListScreen() {
    var el = DOM.el('<div class="screen plain"></div>');
    var q = '';

    function matches() {
      var s = q.trim().toLowerCase();
      return Store.state.destinations.filter(function (d) {
        return !s ||
          d.name.toLowerCase().indexOf(s) >= 0 ||
          (d.address || '').toLowerCase().indexOf(s) >= 0;
      });
    }

    function row(d) {
      var n = (d.routeIds || []).length;
      return (
        '<button class="line-row" data-place="' + UI.esc(d.id) + '">' +
          '<span style="flex:none;display:inline-flex;color:var(--yellow)">' + window.Icons.pinFilled(24) + '</span>' +
          '<span class="lr-body">' +
            '<span class="lr-title nowrap">' + UI.esc(d.name) + '</span>' +
            '<span class="lr-sub nowrap">' + UI.esc(d.address || 'Davao City') + '</span>' +
          '</span>' +
          '<span class="t-small" style="flex:none;color:var(--text2)">' +
            (n ? n + ' route' + (n > 1 ? 's' : '') : 'no routes') +
          '</span>' +
        '</button>'
      );
    }

    function render() {
      var list = matches();
      el.innerHTML =
        UI.appbar({
          bare: true,
          title: '',
          right: '<button class="icon-btn" data-act="add" aria-label="Add a place">' + window.Icons.plus(22) + '</button>',
        }) +
        '<div class="search-band">' +
          '<div class="search">' +
            '<span class="search-icon">' + window.Icons.search(20) + '</span>' +
            '<input id="pl-search" placeholder="Search places" value="' + UI.esc(q) + '" aria-label="Search places" />' +
            '<button class="clear" data-act="clear-search" aria-label="Clear">' + window.Icons.x(20) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="scroll">' +
          '<div class="section-label">Places passengers can search · ' + Store.state.destinations.length + '</div>' +
          '<div class="card list">' +
            (list.length
              ? list.map(row).join('')
              : UI.emptyState(window.Icons.pinFilled(28), 'No places yet', 'Add the malls, schools and landmarks passengers search for')) +
          '</div>' +
          '<div style="height:16px"></div>' +
        '</div>';
    }

    return {
      el: el,
      mount: function () {
        render();
        el.addEventListener('input', function (e) {
          if (e.target.id === 'pl-search') { q = e.target.value; render(); DOM.qs(el, '#pl-search').focus(); }
        });
        el.addEventListener('click', function (e) {
          if (e.target.closest('[data-act="add"]')) { window.Router.go('admin-place-editor'); return; }
          if (e.target.closest('[data-act="clear-search"]')) { q = ''; render(); return; }
          var rowEl = e.target.closest('[data-place]');
          if (rowEl) window.Router.go('admin-place-editor', { placeId: rowEl.dataset.place });
        });
      },
      update: render,
    };
  }

  /* -------------------------------------------------------- place editor */
  function adminPlaceEditorScreen(params) {
    var placeId = params && params.placeId ? params.placeId : null;
    var editing = placeId ? Store.state.destinations.find(function (d) { return d.id === placeId; }) || null : null;
    var el = DOM.el('<div class="screen plain"></div>');
    var kit = null;
    var dirty = false;
    var pos = editing
      ? { lat: editing.latitude, lng: editing.longitude }
      : { lat: 7.0730, lng: 125.6120 };   // Davao City centre

    function alertHtml(msg) {
      return '<div class="alert" style="margin-top:12px">' + window.Icons.alert(16) + '<span>' + UI.esc(msg) + '</span></div>';
    }

    function readForm() {
      return {
        name: (DOM.qs(el, '#pl-name').value || '').trim(),
        address: (DOM.qs(el, '#pl-address').value || '').trim() || 'Davao City',
        latitude: +DOM.qs(el, '#pl-lat').value,
        longitude: +DOM.qs(el, '#pl-lng').value,
        routeIds: Array.prototype.slice.call(el.querySelectorAll('[data-route-link]:checked'))
          .map(function (c) { return c.dataset.routeLink; }),
      };
    }

    function paintPin() {
      if (!kit) return;
      kit.clearDestination();
      kit.setDestination(pos, readForm().name || 'Place');
      var lat = DOM.qs(el, '#pl-lat');
      var lng = DOM.qs(el, '#pl-lng');
      if (lat) lat.value = (+pos.lat).toFixed(6);
      if (lng) lng.value = (+pos.lng).toFixed(6);
    }

    function render() {
      var routes = Store.state.routes;
      el.innerHTML =
        UI.appbar({ bare: true, title: editing ? 'Edit Place' : 'Add Place' }) +
        '<div class="scroll" style="padding:14px 16px 16px">' +
          '<div class="field"><label for="pl-name">Name:</label>' +
            '<input class="input" id="pl-name" placeholder="Type here" value="' + UI.esc(editing ? editing.name : '') + '" /></div>' +
          '<div class="field"><label for="pl-address">Address:</label>' +
            '<input class="input" id="pl-address" placeholder="Type here" value="' + UI.esc(editing ? editing.address || '' : '') + '" />' +
            '<div class="hint">Shown under the name in the passenger search.</div></div>' +
          '<div class="field"><label>Position on the map</label>' +
            '<div class="map" id="pl-map" style="height:220px;border-radius:var(--r-md);border:1px solid var(--line);overflow:hidden"></div>' +
            '<div class="hint">Tap the map to drop the pin, or type exact coordinates below.</div></div>' +
          '<div style="display:flex;gap:12px">' +
            '<div class="field" style="flex:1"><label for="pl-lat">Latitude</label>' +
              '<input class="input plain" id="pl-lat" inputmode="decimal" value="' + (+pos.lat).toFixed(6) + '" /></div>' +
            '<div class="field" style="flex:1"><label for="pl-lng">Longitude</label>' +
              '<input class="input plain" id="pl-lng" inputmode="decimal" value="' + (+pos.lng).toFixed(6) + '" /></div>' +
          '</div>' +
          '<div class="section-label">Jeepney routes that stop here</div>' +
          (routes.length
            ? '<div class="card list">' + routes.map(function (r) {
                var on = editing && (editing.routeIds || []).indexOf(r.id) >= 0;
                return (
                  '<label class="line-row" style="cursor:pointer">' +
                    '<input type="checkbox" data-route-link="' + UI.esc(r.id) + '"' + (on ? ' checked' : '') + ' style="width:20px;height:20px;flex:none" />' +
                    '<span class="lr-body"><span class="lr-title nowrap">' + UI.esc(r.name) + '</span></span>' +
                  '</label>'
                );
              }).join('') + '</div>'
            : UI.emptyState(window.Icons.routeIcon(26), 'No routes yet', 'Create a route first, then link it here')) +
          '<div id="pl-error"></div>' +
          '<div class="bar-stack" style="padding:16px 0 0">' +
            '<button class="bar-action" data-act="save">Save</button>' +
            (editing ? '<button class="bar-action danger" data-act="delete">Delete</button>' : '') +
          '</div>' +
          '<div style="height:16px"></div>' +
        '</div>';
    }

    function mountMap() {
      var host = DOM.qs(el, '#pl-map');
      if (!host) return;
      kit = window.MapKit.create(host);
      kit.onTap(function (latlng) {
        pos = { lat: latlng.lat, lng: latlng.lng };
        dirty = true;
        paintPin();
      });
      kit.map.setView([pos.lat, pos.lng], editing ? 15 : 13, { animate: false });
      paintPin();
    }

    return {
      el: el,
      mount: function () {
        render();
        mountMap();
        el.addEventListener('input', function (e) {
          dirty = true;
          if (e.target.id === 'pl-lat' || e.target.id === 'pl-lng') {
            var lat = +DOM.qs(el, '#pl-lat').value;
            var lng = +DOM.qs(el, '#pl-lng').value;
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              pos = { lat: lat, lng: lng };
              if (kit) { kit.clearDestination(); kit.setDestination(pos, readForm().name || 'Place'); kit.map.setView([lat, lng], kit.map.getZoom(), { animate: true }); }
            }
          }
        });
        el.addEventListener('click', async function (e) {
          if (e.target.closest('[data-act="save"]')) {
            var f = readForm();
            var err = DOM.qs(el, '#pl-error');
            if (!f.name) { err.innerHTML = alertHtml('Give the place a name.'); return; }
            if (!Number.isFinite(f.latitude) || f.latitude < -90 || f.latitude > 90 ||
                !Number.isFinite(f.longitude) || f.longitude < -180 || f.longitude > 180) {
              err.innerHTML = alertHtml('Latitude and longitude must be valid coordinates.');
              return;
            }
            err.innerHTML = '';
            try {
              if (editing) await window.API.updateDestination(editing.id, f);
              else await window.API.createDestination(f);
              UI.toast(editing ? 'Place updated' : 'Place added', 'success');
              window.Router.reset('admin-places');
            } catch (e2) { err.innerHTML = alertHtml(e2.message); }
            return;
          }
          if (e.target.closest('[data-act="delete"]')) {
            var ok = await UI.confirm({
              title: 'Delete this place?',
              message: 'Passengers will no longer find "' + editing.name + '" in search.',
              danger: true,
              confirmLabel: 'Delete',
            });
            if (!ok) return;
            try {
              await window.API.deleteDestination(editing.id);
              UI.toast('Place deleted', 'success');
              window.Router.reset('admin-places');
            } catch (e2) { UI.toast(e2.message, 'error'); }
          }
        });
      },
      update: function () {
        if (dirty) return;                       // never wipe typing on a live update
        if (!placeId) return;
        var d = Store.state.destinations.find(function (x) { return x.id === placeId; });
        if (!d) return;
        editing = d;
        pos = { lat: d.latitude, lng: d.longitude };
        render();
        mountMap();
      },
      unmount: function () {
        if (kit) kit.destroy();
        kit = null;
      },
    };
  }

  window.Admin = {
    login: adminLoginScreen,
    profile: adminProfileScreen,
    routeList: adminRouteListScreen,
    routeDetail: adminRouteDetailScreen,
    routeEditor: adminRouteEditorScreen,
    deviceList: adminDeviceListScreen,
    deviceDetail: adminDeviceDetailScreen,
    deviceEditor: adminDeviceEditorScreen,
    liveMap: adminLiveMapScreen,
    driver: driverScreen,
    deviceRow: adminDeviceRow,
    placeList: adminPlaceListScreen,
    placeEditor: adminPlaceEditorScreen,
  };
})();
