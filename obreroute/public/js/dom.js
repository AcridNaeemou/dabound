/* dom.js — tiny DOM helpers */
(function () {
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }
  function qs(root, sel) { return (root || document).querySelector(sel); }
  function qsa(root, sel) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(root, evt, sel, fn) {
    root.addEventListener(evt, function (e) {
      var t = e.target.closest(sel);
      if (t && root.contains(t)) fn(e, t);
    });
  }
  window.DOM = { el: el, qs: qs, qsa: qsa, on: on };

  /* Device geolocation helper — the passenger's "You are here" (§88).
   *
   * Getting a fix is not one call: high-accuracy GPS often times out on a laptop
   * or indoors, permissions get blocked, and the page may not be secure at all.
   * So we try properly, fall back to a cheap network fix, and always hand the
   * caller a sentence that tells the reader what to actually do next. */
  var current = null;
  var currentAt = 0;

  function position(options) {
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          current = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          currentAt = Date.now();
          resolve(current);
        },
        function (err) { reject(err || { code: 2 }); },
        options
      );
    });
  }

  function inFrame() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  function frameBlocksGeo() {
    try {
      var fp = document.permissionsPolicy || document.featurePolicy;
      return !!(fp && fp.allowsFeature && !fp.allowsFeature('geolocation'));
    } catch (e) { return false; }
  }

  function explain(err) {
    if (!navigator.geolocation) return 'This browser cannot share a location.';
    // A page shown inside another page only gets location if the host allowed it —
    // the browser reports that as a plain refusal, which sends people hunting for a
    // padlock that will never help. Say what is actually wrong instead.
    if (inFrame() && (frameBlocksGeo() || (err && err.code === 1)))
      return 'This page is embedded in another page, which blocks location. Open DaBound in its own tab (or in your phone browser) and allow location there.';
    if (!window.isSecureContext) return 'Location needs a secure page — open DaBound over https:// or on localhost.';
    if (err && err.code === 1) return 'Location is blocked for DaBound. Allow it in your browser (padlock in the address bar → Location), then try again. If the app is embedded in another page, open it in its own tab.';
    if (err && err.code === 3) return 'The location fix took too long. Step outside or try again in a moment.';
    return 'Your device could not get a location. Check that Location services are switched on, then try again.';
  }

  window.GeoLoc = {
    get current() { return current; },
    ageMs: function () { return current ? Date.now() - currentAt : null; },
    request: function () {
      if (!navigator.geolocation) return Promise.reject(new Error(explain(null)));
      if (!window.isSecureContext) return Promise.reject(new Error(explain(null)));
      var first = { enableHighAccuracy: true, timeout: 9000, maximumAge: 5000 };
      var second = { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }; // Wi-Fi/cell fix is fine for "near me"
      return position(first).catch(function (err) {
        if (err && err.code === 1) throw new Error(explain(err));   // a refusal is final
        return position(second).catch(function (err2) { throw new Error(explain(err2)); });
      });
    },
  };
})();
