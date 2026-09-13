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

  /* Device geolocation helper — the passenger's "You are here" (§88) */
  var current = null;
  var watchers = [];
  window.GeoLoc = {
    get current() { return current; },
    request: function () {
      return new Promise(function (resolve, reject) {
        if (!navigator.geolocation) return reject(new Error('GPS unavailable. Please enable location access.'));
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            current = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
            resolve(current);
          },
          function (err) {
            reject(new Error(err && err.code === 1 ? 'GPS unavailable. Please enable location access.' : 'Could not get your location.'));
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
        );
      });
    },
  };
})();
