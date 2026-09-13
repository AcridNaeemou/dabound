/* icons.js — simple line/filled transportation iconography (spec §12, §113) */
(function () {
  var svg = function (body, size, extra) {
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" ' + (extra || '') + '>' + body + '</svg>'
    );
  };

  // A jeepney-flavoured minibus: long roof, window band, two wheels.
  var JEEP =
    '<path d="M2.6 15.1V10.4c0-1 .7-1.9 1.7-2.2l7.2-2.2h3.7c1.7 0 3.1 1.3 3.2 3l.2 6.1"/>' +
    '<path d="M3.1 15.1h16.4"/>' +
    '<path d="M6.1 8.6h6.3v2.8H6.1z"/>' +
    '<path d="M14.4 6.7v4.7"/>' +
    '<circle cx="7.2" cy="17.2" r="1.9"/><circle cx="16.8" cy="17.2" r="1.9"/>';

  var I = {
    jeep: function (s, o) { return svg(JEEP, s, o); },
    jeepFilled: function (s, o) {
      return (
        '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" ' + (o || '') + '>' +
        '<path d="M3.6 10.2c0-1 .6-1.8 1.6-2.1l7.3-2.3h3.5c1.7 0 3.1 1.3 3.2 3l.2 6.1c0 .5-.4.9-.9.9H4.5c-.5 0-.9-.4-.9-.9v-4.7z"/>' +
        '<circle cx="7.4" cy="17.4" r="2.1"/><circle cx="16.8" cy="17.4" r="2.1"/>' +
        '</svg>'
      );
    },
    pin: function (s, o) {
      return svg('<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>', s, o);
    },
    pinFilled: function (s, o) {
      return (
        '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" ' + (o || '') + '>' +
        '<path d="M12 22s7.5-6.6 7.5-11.6a7.5 7.5 0 0 0-15 0C4.5 15.4 12 22 12 22zm0-8.9a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8z"/></svg>'
      );
    },
    routeIcon: function (s, o) {
      return svg('<circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><path d="M8.5 18.5h5.2a3.2 3.2 0 0 0 0-6.4H9.8a3.2 3.2 0 0 1 0-6.4h5.7"/>', s, o);
    },
    bookmark: function (s, o) { return svg('<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2L5.5 20.5v-16a1 1 0 0 1 1-1z"/>', s, o); },
    navigation: function (s, o) { return svg('<path d="m12 2.5 7.5 19-7.5-4.2L4.5 21.5z"/>', s, o); },
    crosshair: function (s, o) { return svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>', s, o); },
    gear: function (s, o) { return svg('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z"/>', s, o); },
    pencil: function (s, o) { return svg('<path d="M16.5 3.9a2.1 2.1 0 0 1 3 3L8.4 18H5.4v-3z"/>', s, o); },
    polygon: function (s, o) { return svg('<path d="M12 3.4 20.2 9.8l-3.6 9.7H7.4L3.8 9.8z"/><circle cx="12" cy="3.4" r="1.5"/><circle cx="20.2" cy="9.8" r="1.5"/><circle cx="16.6" cy="19.5" r="1.5"/><circle cx="7.4" cy="19.5" r="1.5"/><circle cx="3.8" cy="9.8" r="1.5"/>', s, o); },
    trash: function (s, o) { return svg('<path d="M3.8 6.5h16.4M8.5 6.5V4.9a1.4 1.4 0 0 1 1.4-1.4h4.2a1.4 1.4 0 0 1 1.4 1.4v1.6M18.4 6.5l-.8 12.6a1.6 1.6 0 0 1-1.6 1.5H8a1.6 1.6 0 0 1-1.6-1.5L5.6 6.5"/><path d="M10.3 10.6v6M13.7 10.6v6"/>', s, o); },
    back: function (s, o) { return svg('<path d="M19.5 12H4.8M11 5.2 4.2 12l6.8 6.8"/>', s, o); },
    search: function (s, o) { return svg('<circle cx="11" cy="11" r="6.8"/><path d="m20.5 20.5-4.2-4.2"/>', s, o); },
    x: function (s, o) { return svg('<path d="M18.5 5.5 5.5 18.5M5.5 5.5l13 13"/>', s, o); },
    chevron: function (s, o) { return svg('<path d="m9 5.5 6.5 6.5L9 18.5"/>', s, o); },
    check: function (s, o) { return svg('<path d="m4.5 12.8 4.6 4.6L19.5 7"/>', s, o); },
    plus: function (s, o) { return svg('<path d="M12 4.8v14.4M4.8 12h14.4"/>', s, o); },
    flag: function (s, o) { return svg('<path d="M5.5 21V4.2M5.5 4.6h11.6l-1.9 3.6 1.9 3.6H5.5"/>', s, o); },
    play: function (s, o) { return svg('<path d="M7.5 4.8 19 12 7.5 19.2z"/>', s, o); },
    stop: function (s, o) { return svg('<rect x="6" y="6" width="12" height="12" rx="2.4" fill="currentColor" stroke="none"/>', s, o); },
    layers: function (s, o) { return svg('<path d="m12 3 8.5 4.6L12 12.2 3.5 7.6z"/><path d="m3.5 12.6 8.5 4.6 8.5-4.6"/><path d="m3.5 16.9 8.5 4.6 8.5-4.6"/>', s, o); },
    undo: function (s, o) { return svg('<path d="M4 9.5h10.5a5 5 0 0 1 0 10H8"/><path d="M8 5.5 4 9.5l4 4"/>', s, o); },
    redo: function (s, o) { return svg('<path d="M20 9.5H9.5a5 5 0 0 0 0 10H16"/><path d="m16 5.5 4 4-4 4"/>', s, o); },
    clock: function (s, o) { return svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.2 2"/>', s, o); },
    gauge: function (s, o) { return svg('<path d="M4.2 18.5a9 9 0 1 1 15.6 0"/><path d="m12 14.5 3.6-4.2"/><circle cx="12" cy="15.6" r="1.4" fill="currentColor" stroke="none"/>', s, o); },
    user: function (s, o) { return svg('<circle cx="12" cy="8.4" r="3.9"/><path d="M4.6 20.2a7.6 7.6 0 0 1 14.8 0"/>', s, o); },
    shield: function (s, o) { return svg('<path d="M12 3.2 5 6v5.6c0 4.2 2.9 7.4 7 9.2 4.1-1.8 7-5 7-9.2V6z"/><path d="m9 12.2 2.1 2.1L15.2 10"/>', s, o); },
    map: function (s, o) { return svg('<path d="m9.5 4.6-6 2.6v13l6-2.6 5 2.4 6-2.6v-13l-6 2.6z"/><path d="M9.5 4.6v13M14.5 7.2v13"/>', s, o); },
    list: function (s, o) { return svg('<path d="M8.5 6.5h11.5M8.5 12h11.5M8.5 17.5h11.5"/><circle cx="4.6" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>', s, o); },
    info: function (s, o) { return svg('<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2M12 7.9v.1"/>', s, o); },
    alert: function (s, o) { return svg('<path d="M12 3.5 21 19.5H3z"/><path d="M12 9.5v4.2M12 16.6v.1"/>', s, o); },
    wifiOff: function (s, o) { return svg('<path d="M3 4l18 16"/><path d="M6.5 11.2a9 9 0 0 1 4-1.9M17.5 11.2a9 9 0 0 0-3.2-2"/><path d="M9.6 14.6a4.2 4.2 0 0 1 4.8 0"/><circle cx="12" cy="18.2" r="1.1" fill="currentColor" stroke="none"/>', s, o); },
    refresh: function (s, o) { return svg('<path d="M20 11.5A8 8 0 0 0 6.3 6.6L4 9"/><path d="M4 4.5V9h4.5"/><path d="M4 12.5a8 8 0 0 0 13.7 4.9L20 15"/><path d="M20 19.5V15h-4.5"/>', s, o); },
    logout: function (s, o) { return svg('<path d="M15 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4M6 12h9"/>', s, o); },
    phone: function (s, o) { return svg('<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4"/><path d="M10.6 5.6h2.8"/><circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none"/>', s, o); },
    signal: function (s, o) { return svg('<path d="M4 20v-4M9.3 20v-8M14.7 20V8M20 20V4"/>', s, o); },
    building: function (s, o) { return svg('<path d="M5 21V4.6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V21"/><path d="M15 10h3.5a1 1 0 0 1 1 1v10M3.4 21h17.2"/><path d="M8.2 7.6h1.6M8.2 11.2h1.6M8.2 14.8h1.6"/>', s, o); },
    target: function (s, o) { return svg('<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/>', s, o); },
    spark: function (s, o) { return svg('<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 16.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>', s, o); },
    eye: function (s, o) { return svg('<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="3"/>', s, o); },
    dash: function (s, o) { return svg('<path d="M5.2 12h13.6"/>', s, o); },
    bookmarkFilled: function (s, o) {
      return (
        '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" ' + (o || '') + '>' +
        '<path d="M6.6 3.2h10.8a1.2 1.2 0 0 1 1.2 1.2v16.4l-6.6-4.4-6.6 4.4V4.4a1.2 1.2 0 0 1 1.2-1.2z"/></svg>'
      );
    },
    chevLeft: function (s, o) { return svg('<path d="M15 4.5 7.4 12 15 19.5"/>', s, o); },
    chevRight: function (s, o) { return svg('<path d="M9.2 4.5 16.8 12 9.2 19.5"/>', s, o); },
    chevDown: function (s, o) { return svg('<path d="m5.5 9 6.5 6.5L18.5 9"/>', s, o); },
    undoArrow: function (s, o) { return svg('<path d="M8.5 7.5 4 12l4.5 4.5"/><path d="M4 12h10.5a5.5 5.5 0 0 1 0 11H9"/>', s, o); },
    redoArrow: function (s, o) { return svg('<path d="M15.5 7.5 20 12l-4.5 4.5"/><path d="M20 12H9.5a5.5 5.5 0 0 0 0 11H15"/>', s, o); },
    pinFilledYellow: function (s, o) {
      return (
        '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" aria-hidden="true" ' + (o || '') + '>' +
        '<path d="M12 22.5s7.5-7 7.5-12.4A7.5 7.5 0 0 0 4.5 10c0 5.4 7.5 12.4 7.5 12.4z" stroke="#173B5C" stroke-width="1.7" fill="#F9C74F"/>' +
        '<circle cx="12" cy="10" r="2.7" fill="#fff"/></svg>'
      );
    },
    dots: function (s, o) { return svg('<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>', s, o); },
  };

  I.logo = function (size) {
    var s = size || 92;
    return (
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 96 96" role="img" aria-label="DaBound">' +
      '<circle cx="48" cy="48" r="46" fill="#173B5C"/>' +
      '<circle cx="48" cy="48" r="46" fill="none" stroke="#0f2b44" stroke-width="2"/>' +
      '<path d="M20 58h56" stroke="#F9C74F" stroke-width="4" stroke-linecap="round" stroke-dasharray="9 8"/>' +
      '<g transform="translate(20 22) scale(2.3)" stroke="#FFFFFF" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      JEEP +
      '</g>' +
      '<circle cx="76" cy="30" r="7" fill="#F9C74F"/>' +
      '<path d="M73.5 30h5M76 27.5v5" stroke="#173B5C" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>'
    );
  };

  window.Icons = I;
})();
