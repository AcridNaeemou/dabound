/* app.js — router, boot sequence and the presenter demo console.
 *
 * Navigation is hash-based so the demo can be driven from links and the phone's
 * back gesture behaves naturally:
 *   #/map  #/tracking/dev-01  #/admin-routes  #/driver/dev-01
 */
(function () {
  var UI = window.UI;
  var Store = window.Store;

  var SCREENS = {
    splash: { make: window.Passenger.splash, default: true },
    role: { make: window.Passenger.role },
    map: { make: window.Passenger.map },
    search: { make: window.Passenger.search },
    nearby: { make: window.Passenger.nearby },
    tracking: { make: window.Passenger.tracking, param: 'deviceId' },
    routes: { make: window.Passenger.routes },
    'route-detail': { make: window.Passenger.routeDetail, param: 'routeId' },
    saved: { make: window.Passenger.saved },

    'admin-login': { make: window.Admin.login },
    'admin-profile': { make: window.Admin.profile },
    'admin-routes': { make: window.Admin.routeList },
    'admin-route-detail': { make: window.Admin.routeDetail, param: 'routeId' },
    'admin-route-editor': { make: window.Admin.routeEditor, param: 'routeId' },
    'admin-devices': { make: window.Admin.deviceList },
    'admin-device-detail': { make: window.Admin.deviceDetail, param: 'deviceId' },
    'admin-device-editor': { make: window.Admin.deviceEditor, param: 'deviceId' },
    'admin-live': { make: window.Admin.liveMap },
    driver: { make: window.Admin.driver, param: 'deviceId' },
  };

  var current = null;
  var currentName = null;
  var depth = 0;

  function parseHash() {
    var raw = (location.hash || '').replace(/^#\/?/, '');
    if (!raw) return null;
    if (raw === 'demo') return { name: '__demo', param: null };
    var parts = raw.split('/').filter(Boolean);
    var name = parts[0];
    var param = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (!SCREENS[name]) return null;
    return { name: name, param: param };
  }

  function hashFor(name, param) {
    return '#/' + name + (param ? '/' + encodeURIComponent(param) : '');
  }

  function render(target, param, opts) {
    opts = opts || {};
    var spec = SCREENS[target];
    if (!spec) return;
    var host = document.getElementById('screen-host');
    if (current && current.unmount) {
      try { current.unmount(); } catch (e) { console.warn(e); }
    }
    host.innerHTML = '';
    var params = {};
    if (spec.param && param) params[spec.param] = param;
    var instance = spec.make(params);
    if (instance.el.classList && opts.back) instance.el.classList.add('is-back');
    host.appendChild(instance.el);
    current = instance;
    currentName = target;
    if (instance.mount) {
      try { instance.mount(); } catch (e) { console.error('mount failed for ' + target, e); }
    }
    UI.connectivityBanner();
  }

  var Router = {
    go: function (name, params) {
      var spec = SCREENS[name];
      if (!spec) return;
      var param = spec.param && params ? params[spec.param] : null;
      var hash = hashFor(name, param);
      if (location.hash === hash) {
        render(name, param, {});
        return;
      }
      history.pushState({ obr: depth + 1 }, '', hash);
      depth++;
      render(name, param, {});
    },
    reset: function (name, params) {
      var spec = SCREENS[name];
      var param = spec && spec.param && params ? params[spec.param] : null;
      var hash = hashFor(name, param);
      history.replaceState({ obr: 0 }, '', hash);
      depth = 0;
      render(name, param, {});
    },
    back: function () {
      if (depth > 0) {
        history.back();
      } else {
        var fallback = currentName && currentName.indexOf('admin') === 0 ? 'admin-profile' : 'map';
        depth = 0;
        var spec = SCREENS[fallback];
        history.replaceState({ obr: 0 }, '', hashFor(fallback, null));
        render(fallback, null, { back: true });
        void spec;
      }
    },
    current: function () { return currentName; },
    repaint: function () { if (current) render(currentName, SCREENS[currentName] && SCREENS[currentName].param ? (parseHash() || {}).param : null, {}); },
  };
  window.Router = Router;

  window.addEventListener('popstate', function (e) {
    depth = (e.state && e.state.obr) || 0;
    var parsed = parseHash();
    if (parsed && parsed.name === '__demo') {
      DemoConsole.open();
      return;
    }
    if (parsed) render(parsed.name, parsed.param, { back: true });
    else {
      var fallback = currentName && currentName.indexOf('admin') === 0 ? 'admin-profile' : 'map';
      render(fallback, null, { back: true });
    }
  });

  /* -------------------------------------------------------------- demo console */
  var DemoConsole = (function () {
    function deviceBlock(d) {
      var route = Store.routeById(d.routeId);
      return (
        '<div class="dp-device">' +
        '<div class="dpd-head">' + window.Brand.jeepAvatar(d.color || window.Brand.colorFor(d.id), 40) +
        '<span style="flex:1;min-width:0"><span class="dpd-name nowrap" style="display:block">' + UI.esc(d.name) + '</span>' +
        '<span class="dpd-route nowrap" style="display:block">' + UI.esc(route ? route.name : 'No route') + '</span></span>' +
        UI.statusPill(d, { pulse: true }) +
        '</div>' +
        '<div class="dp-actions">' +
        '<button class="btn sm ' + (d.simulated ? 'danger' : 'secondary') + '" data-demo="sim:' + UI.esc(d.id) + '">' +
        (d.simulated ? 'Stop sim' : 'Simulate') + '</button>' +
        '<button class="btn sm quiet" data-demo="place15:' + UI.esc(d.id) + '">15%</button>' +
        '<button class="btn sm quiet" data-demo="place55:' + UI.esc(d.id) + '">55%</button>' +
        '<button class="btn sm quiet" data-demo="place90:' + UI.esc(d.id) + '">90%</button>' +
        '<button class="btn sm ghost" data-demo="offline:' + UI.esc(d.id) + '">Drop GPS</button>' +
        '<button class="btn sm ghost" data-demo="driver:' + UI.esc(d.id) + '">Driver mode</button>' +
        '</div>' +
        '</div>'
      );
    }

    function html() {
      var devices = Store.state.devices;
      var online = Store.onlineCount();
      return (
        '<h3>' + window.Icons.spark(18) + ' Demo console</h3>' +
        '<div class="dp-sub">' + (Store.state.connected ? 'Live stream connected' : 'Stream offline') +
        ' · ' + online + '/' + devices.length + ' devices online</div>' +
        '<div class="dp-actions" style="margin-bottom:14px">' +
        '<button class="btn sm" data-demo="passenger">Passenger app</button>' +
        '<button class="btn sm ghost" data-demo="admin">Admin</button>' +
        '<button class="btn sm quiet" data-demo="reset">Reset data</button>' +
        '</div>' +
        '<div class="section-label" style="margin-top:0">GPS devices</div>' +
        devices.map(deviceBlock).join('') +
        '<div class="section-label">Demo script</div>' +
        '<ol class="dp-steps">' +
        '<li><b>1.</b> Admin creates route <b>Obrero - Bajada</b> with stops USeP Obrero, Victoria Plaza, Bajada Flyover, Bajada.</li>' +
        '<li><b>2.</b> Admin registers <b>Jeepney 01</b> and assigns the route.</li>' +
        '<li><b>3.</b> Cohort member opens <b>Driver mode</b> on the GPS phone (or hit Simulate).</li>' +
        '<li><b>4.</b> Passenger picks a destination, then the jeepney.</li>' +
        '<li><b>5.</b> Marker moves, <b>Near Victoria Plaza</b> and ETA update.</li>' +
        '<li><b>6.</b> Hit <b>Drop GPS</b> → passenger sees <b>Connection lost</b> with the last known position.</li>' +
        '</ol>' +
        '<div class="t-cap" style="margin-top:10px">Inline map: type <b>#/tracking/dev-01</b> in the URL bar.</div>'
      );
    }

    function bind(root) {
      root.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-demo]');
        if (!btn) return;
        var [action, id] = btn.dataset.demo.split(':');
        try {
          if (action === 'passenger') Router.reset('map');
          else if (action === 'admin') Router.reset('admin-profile');
          else if (action === 'reset') {
            var ok = await UI.confirm({
              title: 'Restore the seeded demo data?',
              message: 'Routes, jeepneys and destinations return to their initial state.',
              confirmLabel: 'Reset',
            });
            if (ok) {
              await window.API.resetDemo();
              UI.toast('Demo data restored', 'success');
            }
          } else if (action === 'sim') {
            var d = Store.deviceById(id);
            await window.API.setSimulate(id, !d.simulated, 0.12);
          } else if (action === 'place15') await window.API.placeDevice(id, 0.15);
          else if (action === 'place55') await window.API.placeDevice(id, 0.55);
          else if (action === 'place90') await window.API.placeDevice(id, 0.9);
          else if (action === 'offline') {
            await window.API.setTracking(id, false);
            UI.toast('GPS dropped — device now offline');
          } else if (action === 'driver') Router.go('driver', { deviceId: id });
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      });
    }

    function paint() {
      var panel = document.getElementById('demo-panel');
      if (panel) panel.innerHTML = html();
      var drawer = document.getElementById('demo-drawer');
      if (drawer && drawer.classList.contains('show')) {
        DOM.qs(drawer, '.dd-sheet').innerHTML = html();
      }
    }

    return {
      init: function () {
        paint();
        var panel = document.getElementById('demo-panel');
        if (panel) bind(panel);
        bind(document.getElementById('demo-drawer'));
        document.getElementById('demo-fab').addEventListener('click', function () {
          document.getElementById('demo-drawer').classList.add('show');
          paint();
        });
        document.getElementById('demo-drawer').addEventListener('click', function (e) {
          if (e.target.id === 'demo-drawer') e.currentTarget.classList.remove('show');
        });
      },
      open: function () {
        var panel = document.getElementById('demo-panel');
        if (panel && getComputedStyle(panel).display !== 'none') {
          panel.scrollIntoView({ behavior: 'smooth' });
          return;
        }
        document.getElementById('demo-drawer').classList.add('show');
        paint();
      },
      paint: paint,
    };
  })();
  window.DemoConsole = DemoConsole;

  /* ------------------------------------------------------------ global wiring */
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    if (nav) {
      var target = nav.dataset.nav;
      if (target === 'back') return Router.back();
      var params = {};
      if (nav.dataset.driver) params.deviceId = nav.dataset.driver;
      if (nav.dataset.device) params.deviceId = nav.dataset.device;
      if (nav.dataset.route) params.routeId = nav.dataset.route;
      return Router.go(target, params);
    }
    var tab = e.target.closest('[data-tab]');
    if (tab) {
      var map = { map: 'map', routes: 'routes', saved: 'saved' };
      return Router.reset(map[tab.dataset.tab]);
    }
  });

  /* Live updates must never throw the reader back to the top of a list.
     Some screens re-render fully on a store push, so the scroll position of
     every scrolling container is captured and put back around the update. */
  var KEEP_SCROLL = '.scroll, [data-keep-scroll]';
  function snapshotScroll(root) {
    var nodes = Array.prototype.slice.call(root.querySelectorAll(KEEP_SCROLL));
    return {
      nodes: nodes,
      tops: nodes.map(function (n) { return n.scrollTop; }),
      winY: window.scrollY || 0,
    };
  }
  function restoreScroll(root, snap) {
    if (!snap) return;
    if (snap.tops.some(function (t) { return t > 0; })) {
      var after = Array.prototype.slice.call(root.querySelectorAll(KEEP_SCROLL));
      for (var i = 0; i < snap.tops.length && i < after.length; i++) {
        if (snap.tops[i] > 0) after[i].scrollTop = snap.tops[i];
      }
    }
    if (snap.winY > 0) window.scrollTo(0, snap.winY);
  }

  Store.subscribe(function (reason) {
    UI.connectivityBanner();
    if (current && current.update) {
      var host = document.getElementById('screen-host');
      var snap = host ? snapshotScroll(host) : null;
      try { current.update(reason); } catch (err) { console.error('update failed', err); }
      if (host) restoreScroll(host, snap);
    }
    DemoConsole.paint();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') Store.notify('visible');
  });

  /* ------------------------------------------------------------------- boot */
  function boot() {
    var parsed = parseHash();
    if (parsed && parsed.name === '__demo') {
      DemoConsole.open();
      history.replaceState({ obr: depth }, '', currentName ? '#/' + currentName : '#/map');
      return;
    }
    if (parsed) {
      render(parsed.name, parsed.param, {});
    } else {
      render('splash', null, {});
      setTimeout(function () {
        if (Router.current() === 'splash') Router.reset('role');
      }, 1900);
    }
    Store.boot();
    DemoConsole.init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
