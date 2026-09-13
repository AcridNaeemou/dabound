/* brand.js — the DaBound-family visual identity.
 *
 * Wordmark: jeepney line glyph + navy letters + yellow map-pin standing in for
 * the lowercase "o" + yellow full stop, exactly like the reference design page.
 *
 * The product name is a one-line switch: change BRAND_NAME below (or call
 * Brand.setName('DaBound')) to present the original brand while keeping the rest
 * of the design system identical.
 */
(function () {
  var BRAND_NAME = 'DaBound';

  function pinGlyph(size, color) {
    return (
      '<svg class="wm-pin-svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 23.2s8-7.4 8-13A8 8 0 0 0 4 10.2c0 5.6 8 13 8 13z" fill="' + color + '"/>' +
      '<circle cx="12" cy="10" r="3.1" fill="#fff"/>' +
      '</svg>'
    );
  }

  function jeepGlyph(size, color) {
    return (
      '<svg class="wm-jeep-svg" width="' + size + '" height="' + size + '" viewBox="0 0 48 48" aria-hidden="true" ' +
      'fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="7" y="14" width="34" height="17" rx="3.5"/>' +
      '<path d="M7 20h34"/>' +
      '<path d="M14 14v6M21 14v6M28 14v6M35 14v6"/>' +
      '<circle cx="15.5" cy="33.5" r="4"/><circle cx="32.5" cy="33.5" r="4"/>' +
      '<path d="M9.5 24.5h3M35.5 24.5h3"/>' +
      '</svg>'
    );
  }

  /** The wordmark. The pin replaces the first lowercase "o" of the name. */
  function mark(name, size) {
    var nm = name || BRAND_NAME;
    var textSize = size || 30;
    var idx = nm.indexOf('o');
    if (idx < 0) idx = nm.length; // no "o": fall back to a trailing pin
    var before = nm.slice(0, idx);
    var after = nm.slice(idx + 1);
    return (
      '<span class="wordmark" style="font-size:' + textSize + 'px">' +
      '<span class="wm-jeep">' + jeepGlyph(Math.round(textSize * 0.92), '#173B5C') + '</span>' +
      '<span class="wm-text">' + before +
      '<span class="wm-pin">' + pinGlyph(Math.round(textSize * 0.8), '#F9C74F') + '</span>' + after +
      '</span>' +
      '<span class="wm-dot"></span>' +
      '</span>'
    );
  }

  /**
   * Colourful side-view jeepney illustration used inside the circular avatars of
   * the route/jeepney pill rows (red / blue / pink / grey in the reference).
   */
  function jeepArt(color, size, opts) {
    opts = opts || {};
    var c = color || '#D7263D';
    var s = size || 46;
    var muted = opts.muted;
    var body = muted ? '#ADB5BD' : c;
    var roof = muted ? '#98A2AC' : shade(c, -0.16);
    var stripe = muted ? '#C7CDD3' : '#F9C74F';
    var glass = muted ? '#E4E8EB' : '#D8EFFB';
    return (
      '<svg class="jeep-art-svg" width="' + s + '" height="' + s + '" viewBox="0 0 72 50" aria-hidden="true">' +
      '<ellipse cx="36" cy="44" rx="24" ry="3" fill="rgba(23,59,92,.14)"/>' +
      // roof + cabin
      '<path d="M13 19v-6a4 4 0 0 1 4-4h38a4 4 0 0 1 4 4v6z" fill="' + roof + '"/>' +
      // window band
      '<rect x="19" y="10" width="39" height="8" rx="1.6" fill="' + glass + '"/>' +
      '<path d="M29 10v8M39 10v8M49 10v8" stroke="' + roof + '" stroke-width="1.6"/>' +
      // windshield
      '<path d="M13 19v-6.5l6-3.4v9.9z" fill="' + glass + '" opacity=".95"/>' +
      // body
      '<rect x="8" y="19" width="56" height="16" rx="3" fill="' + body + '"/>' +
      // chrome front + grille
      '<rect x="4.5" y="21" width="6" height="12" rx="2" fill="#CFD6DD"/>' +
      '<path d="M6 24h3.5M6 27h3.5M6 30h3.5" stroke="#9AA4AE" stroke-width="1.1"/>' +
      '<rect x="2.5" y="30.5" width="9" height="3.6" rx="1.8" fill="#B9C2CB"/>' +
      '<circle cx="7.4" cy="24.4" r="1.9" fill="#FFF6D8" stroke="#B9C2CB" stroke-width=".8"/>' +
      // yellow stripe
      '<rect x="8" y="28.4" width="56" height="3.2" fill="' + stripe + '"/>' +
      // wheels
      '<circle cx="20" cy="37" r="6.4" fill="#25313C"/><circle cx="20" cy="37" r="2.6" fill="#CFD6DD"/>' +
      '<circle cx="55" cy="37" r="6.4" fill="#25313C"/><circle cx="55" cy="37" r="2.6" fill="#CFD6DD"/>' +
      '</svg>'
    );
  }

  function shade(hex, amount) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var f = function (v) {
      return Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
    };
    return '#' + [f(r), f(g), f(b)].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  /** Circular avatar holding the illustration — the reference's list-row motif. */
  function jeepAvatar(color, size, opts) {
    var s = size || 48;
    return (
      '<span class="jeep-avatar" style="width:' + s + 'px;height:' + s + 'px">' +
      jeepArt(color, Math.round(s * 0.86), opts) +
      '</span>'
    );
  }

  var PALETTE = ['#D7263D', '#2D6CDF', '#C2185B', '#0E9F6E', '#F9A825', '#6D28D9'];

  /* keep the document title in sync with the brand constant */
  try { document.title = BRAND_NAME + ' \u2014 Davao jeepney tracker'; } catch (e) { /* noop */ }

  window.Brand = {
    name: BRAND_NAME,
    setName: function (n) {
      BRAND_NAME = n;
      try { document.title = n + ' \u2014 Davao jeepney tracker'; } catch (e) { /* noop */ }
    },
    mark: mark,
    jeepArt: jeepArt,
    jeepAvatar: jeepAvatar,
    jeepGlyph: jeepGlyph,
    pinGlyph: pinGlyph,
    palette: PALETTE,
    colorFor: function (seed) {
      var s = String(seed || '');
      var h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
      return PALETTE[h % PALETTE.length];
    },
  };
})();
