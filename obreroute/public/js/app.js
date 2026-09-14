/* app.js — router and boot sequence.
 *
 * Navigation is hash-based so screens can be linked and the phone's back
 * gesture behaves naturally:
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
    'admin-places': { make: window.Admin.placeList },
    'admin-place-editor': { make: window.Admin.placeEditor, param: 'placeId' },
    'admin-live': { make: window.Admin.liveMap },
    driver: { make: window.Admin.driver, param: 'deviceId' },
  };

  var current = null;
  var currentName = null;
  var depth = 0;

  function parseHash() {
    var raw = (location.hash || '').replace(/^#\/?/, '');
    if (!raw) return null;
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
    if (parsed) render(parsed.name, parsed.param, { back: true });
    else {
      var fallback = currentName && currentName.indexOf('admin') === 0 ? 'admin-profile' : 'map';
      render(fallback, null, { back: true });
    }
  });

  /* ------------------------------------------------------------ global wiring */
  document.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-nav]');
    if (nav) {
      var target = nav.dataset.nav;
      if (target === 'back') return Router.back();
      // "exit" leaves the passenger or admin side and clears the history stack,
      // so the phone's back gesture cannot wander back into the app.
      if (target === 'exit') return Router.reset('role');
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
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') Store.notify('visible');
  });

  /* ------------------------------------------------------------------- boot */
  /* A refresh should land the reader back on the launch screen rather than
   * dropping them mid-journey. A genuine reload is distinguishable from a fresh
   * navigation, so deep links (/#/driver/dev-01, a shared /#/tracking/… URL) keep
   * working — only F5 / pull-to-refresh resets. */
  function isReload() {
    try {
      var entries = performance.getEntriesByType && performance.getEntriesByType('navigation');
      var nav = entries && entries[0];
      if (nav && nav.type) return nav.type === 'reload';
      if (performance.navigation) return performance.navigation.type === 1; // legacy fallback
    } catch (e) { /* performance API unavailable — treat as a fresh navigation */ }
    return false;
  }

  function startAtLaunch() {
    // drop the stale hash so the address bar matches what is on screen
    try { history.replaceState({ obr: 0 }, '', location.pathname + location.search); } catch (e) { /* file:// */ }
    depth = 0;
    render('splash', null, {});
    setTimeout(function () {
      if (Router.current() === 'splash') Router.reset('role');
    }, 1900);
  }

  function boot() {
    // A reload always starts over; any other load honours a deep link if present.
    var parsed = isReload() ? null : parseHash();
    if (parsed) render(parsed.name, parsed.param, {});
    else startAtLaunch();
    Store.boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
