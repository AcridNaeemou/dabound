/* api.js — thin wrapper over the backend REST API (spec §46-47) */
(function () {
  function storedKey() {
    try {
      return localStorage.getItem('dabound.key') || '';
    } catch (e) {
      return '';
    }
  }

  async function req(method, url, body, retried) {
    const opts = { method: method, headers: {} };
    const key = storedKey();
    if (key) opts.headers['x-admin-key'] = key;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (res.status === 401 && data && data.adminKeyRequired && !retried && window.UI && window.UI.askAdminKey) {
      const entered = await window.UI.askAdminKey();
      if (entered) return req(method, url, body, true);   // one retry with the key
    }
    if (!res.ok) {
      const err = new Error((data && (data.error || (data.errors && data.errors[0]))) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  window.API = {
    state: () => req('GET', '/api/state'),

    routes: () => req('GET', '/api/routes'),
    createRoute: (route) => req('POST', '/api/routes', route),
    updateRoute: (id, route) => req('PUT', '/api/routes/' + id, route),
    deleteRoute: (id) => req('DELETE', '/api/routes/' + id),

    devices: () => req('GET', '/api/devices'),
    createDevice: (dev) => req('POST', '/api/devices', dev),
    updateDevice: (id, dev) => req('PUT', '/api/devices/' + id, dev),
    deleteDevice: (id) => req('DELETE', '/api/devices/' + id),

    sendLocation: (id, fix) => req('POST', '/api/devices/' + id + '/location', fix),
    setTracking: (id, on) => req('POST', '/api/devices/' + id + '/tracking', { on: on }),
    setSimulate: (id, on, seedS) => req('POST', '/api/devices/' + id + '/simulate', { on: on, seedS: seedS }),
    placeDevice: (id, frac) => req('POST', '/api/devices/' + id + '/place', { frac: frac }),
    addFleet: (routeId, count) => req('POST', '/api/routes/' + routeId + '/fleet', { count: count }),
    clearFleet: (routeId) => req('DELETE', '/api/routes/' + routeId + '/fleet'),

    destinations: () => req('GET', '/api/destinations'),
    createDestination: (d) => req('POST', '/api/destinations', d),
    updateDestination: (id, d) => req('PUT', '/api/destinations/' + id, d),
    deleteDestination: (id) => req('DELETE', '/api/destinations/' + id),

    roadRoute: (points) => req('POST', '/api/road-route', { points: points }),
    resetDemo: () => req('POST', '/api/reset', {}),

    // Authenticated ping used to unlock the admin area on entry, so a locked
    // deployment asks for the key before showing any admin screen. On a 401 the
    // shared req() wrapper prompts for the key and retries once automatically.
    verifyAdminKey: () => req('GET', '/api/admin/verify'),

    // Plain check of a typed PIN against the backend, with no stored-key retry or
    // modal, so the PIN screen can validate what the reader just entered.
    checkAdminKey: (key) =>
      fetch('/api/admin/verify', { method: 'GET', headers: { 'x-admin-key': key || '' } }).then((r) => r.ok),
  };
})();
