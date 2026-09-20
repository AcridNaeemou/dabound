/* store.js — client-side source of truth mirror.
 *
 * The backend owns device state (§101). This store subscribes to the SSE stream
 * and keeps the latest snapshot, so no screen ever needs to refresh manually
 * (§48). If the stream drops it falls back to polling and surfaces a global
 * "Unable to connect" state (§96).
 */
(function () {
  var listeners = [];
  var session = {
    destination: null, // {id,name,address,latitude,longitude,routeIds}
    showRoutes: true,
    showJeeps: true,
    mark: null, // last map tap, used by the route editor handoff
  };

  var state = {
    routes: [],
    destinations: [],
    devices: [],
    config: {},
    serverTime: 0,
    ready: false,
    connected: false,
    lastMessageAt: 0,
  };

  var source = null;
  var pollTimer = null;
  var retries = 0;
  var deviceIndex = new Map();
  var prepCache = {};   // prepared route geometry, reused while the path is unchanged

  function reindex() {
    deviceIndex = new Map();
    state.devices.forEach(function (d) { deviceIndex.set(d.id, d); });
  }

  function notify(reason) {
    state.lastMessageAt = Date.now();
    listeners.forEach(function (fn) {
      try { fn(reason); } catch (e) { console.error(e); }
    });
  }

  function setConnected(v) {
    if (state.connected === v) return;
    state.connected = v;
    notify('connection');
  }

  function applySnapshot(snap) {
    if (snap.routes) state.routes = snap.routes;
    if (snap.destinations) state.destinations = snap.destinations;
    if (snap.config) state.config = snap.config;
    if (snap.serverTime) state.serverTime = snap.serverTime;
    if (snap.devices) { state.devices = snap.devices; reindex(); }
    state.ready = true;
  }

  function mergeDevices(devices) {
    if (!Array.isArray(devices)) return;
    devices.forEach(function (d) {
      var idx = state.devices.findIndex(function (x) { return x.id === d.id; });
      if (idx >= 0) {
        // the per-tick stream sends partial updates (only what moves); merge
        // them over the full object from the last snapshot instead of clobbering it
        Object.assign(state.devices[idx], d);
      } else {
        state.devices.push(d);
      }
    });
    reindex();
  }

  var watchdog = null;
  var sawStream = false;

  function armWatchdog() {
    clearTimeout(watchdog);
    // If a proxy buffers the SSE stream we may never see an event: fall back to
    // polling so the map still moves. Any real event cancels the fallback.
    watchdog = setTimeout(function () {
      if (sawStream) return;
      console.warn('live stream silent — switching to polling');
      setConnected(false);
      startPolling();
    }, 5000);
  }

  function markStreamAlive() {
    sawStream = true;
    clearTimeout(watchdog);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connect() {
    if (source) source.close();
    try {
      source = new EventSource('/api/events');
    } catch (e) {
      startPolling();
      return;
    }
    armWatchdog();
    source.addEventListener('open', function () { retries = 0; setConnected(true); armWatchdog(); });
    source.addEventListener('state', function (ev) {
      markStreamAlive();
      applySnapshot(JSON.parse(ev.data));
      setConnected(true);
      notify('full');
    });
    source.addEventListener('loc', function (ev) {
      markStreamAlive();
      var payload = JSON.parse(ev.data);
      if (payload.serverTime) state.serverTime = payload.serverTime;
      mergeDevices(payload.devices);
      setConnected(true);
      notify('loc');
    });
    source.addEventListener('destinations', function (ev) {
      var payload = JSON.parse(ev.data);
      state.destinations = payload.destinations || state.destinations;
      notify('destinations');
    });
    source.addEventListener('devices', function (ev) {
      var payload = JSON.parse(ev.data);
      mergeDevices(payload.devices);
      notify('devices');
    });
    source.addEventListener('error', function () {
      retries++;
      if (retries >= 2) {
        setConnected(false);
        startPolling();
      }
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async function () {
      try {
        var snap = await window.API.state();
        applySnapshot(snap);
        setConnected(true);
        notify('poll');
      } catch (e) {
        setConnected(false);
      }
    }, 3000);
  }

  async function boot() {
    try {
      var snap = await window.API.state();
      applySnapshot(snap);
      setConnected(true);
      notify('full');
    } catch (e) {
      console.warn('initial state failed', e);
      setConnected(false);
    }
    connect();
  }

  var Store = {
    state: state,
    session: session,
    boot: boot,
    notify: notify,
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
      };
    },
    routeById: function (id) { return state.routes.find(function (r) { return r.id === id; }) || null; },
    deviceById: function (id) { return deviceIndex.get(id) || null; },
    devices: function (opts) {
      opts = opts || {};
      return state.devices.filter(function (d) {
        if (opts.routeId && d.routeId !== opts.routeId) return false;
        if (opts.activeOnly && !d.active) return false;
        if (opts.onlineOnly && d.status !== 'online') return false;
        if (opts.servingDestination && opts.destination) {
          var dest = opts.destination;
          var dp = { lat: dest.latitude, lng: dest.longitude };
          var r = d.routeId ? state.routes.find(function (x) { return x.id === d.routeId; }) : null;
          var serving;
          if (r && r.path && r.path.length > 1) {
            // Geometric truth: does this route actually pass the destination?
            var prep = prepCache[r.id];
            if (!prep || prep.len !== r.path.length) {
              prep = window.Geo.prepare(r.path);
              prep.len = r.path.length;
              prepCache[r.id] = prep;
            }
            serving = window.Geo.project(prep, dp, null, null).offM <= (opts.nearM || 100);
          } else {
            // No geometry to test (a route with a single point) — fall back to the
            // curated list an admin attached to the destination.
            serving = (dest.routeIds || []).indexOf(d.routeId) >= 0;
          }
          if (!serving) return false;
        }
        return true;
      });
    },
    onlineCount: function () {
      return state.devices.filter(function (d) { return d.status === 'online'; }).length;
    },
    statusOf: function (d) { return d.status; },
    /** ms since the last position fix for a device */
    ageOf: function (d) {
      if (!d.lastUpdated) return null;
      return Math.max(0, Date.now() - d.lastUpdated);
    },
  };

  window.Store = Store;
})();
