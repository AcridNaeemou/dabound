/* ui.js — shared UI components in the DaBound reference language.
 *
 * Passenger copy stays human: "Near Victoria Plaza", "ETA: 4 mins.", "500 m away"
 * (spec §64). Raw coordinates are never shown to passengers.
 */
(function () {
  var Geo = window.Geo;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    // keep toasts clear of stacked bottom bars (spec 137)
    try {
      var vh = window.innerHeight;
      var tops = [];
      document.querySelectorAll('.bar-stack, .bottom-nav').forEach(function (n) {
        var r = n.getBoundingClientRect();
        if (r.height > 0 && r.bottom > vh - 8) tops.push(r.top);
      });
      var offset = tops.length ? Math.round(vh - Math.min.apply(null, tops) + 14) : 88;
      host.style.bottom = Math.min(Math.round(vh * 0.62), Math.max(88, offset)) + 'px';
    } catch (e) { /* layout not ready — keep the default */ }
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = (kind === 'error' ? window.Icons.alert(15) : kind === 'success' ? window.Icons.check(15) : window.Icons.info(15)) + '<span>' + esc(message) + '</span>';
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 220ms ease, transform 220ms ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(function () { el.remove(); }, 240);
    }, 2600);
  }

  function confirmDialog(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML =
        '<div class="dialog" role="dialog" aria-modal="true">' +
        '<h3>' + esc(o.title || 'Are you sure?') + '</h3>' +
        '<p>' + esc(o.message || '') + '</p>' +
        '<div class="dialog-actions">' +
        '<button class="btn quiet" data-act="cancel">' + esc(o.cancelLabel || 'Cancel') + '</button>' +
        '<button class="btn ' + (o.danger ? 'danger' : '') + '" data-act="ok">' + esc(o.confirmLabel || 'Confirm') + '</button>' +
        '</div></div>';
      document.getElementById('screen-host').appendChild(scrim);
      scrim.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (!act && e.target !== scrim) return;
        var val = act && act.dataset.act === 'ok';
        scrim.remove();
        resolve(val);
      });
    });
  }

  /* ------------------------------------------------------------ header pill */
  function appbar(o) {
    o = o || {};
    var back =
      o.back === false
        ? ''
        : '<button class="back-chevron" data-nav="back" aria-label="Back">' + window.Icons.chevLeft(26) + '</button>';
    var titleAttrs = o.titleColor ? ' style="color:' + esc(o.titleColor) + '"' : '';
    var lead = o.icon ? '<span class="appbar-lead">' + o.icon + '<div class="appbar-title"' + titleAttrs + '>' + esc(o.title || '') + '</div></span>' : null;
    return (
      '<header class="appbar' + (o.transparent ? ' on-map' : '') + (o.bare ? ' bare' : '') + '">' +
      back +
      (lead ||
        '<div class="appbar-title"' + titleAttrs + '>' + esc(o.title || '') + (o.subtitle ? '<small>' + esc(o.subtitle) + '</small>' : '') + '</div>') +
      (o.right || '<span style="width:40px;flex:none"></span>') +
      '</header>'
    );
  }

  /* --------------------------------------------------------- status → dot */
  function statusDot(device, size) {
    var cls = device.status === 'online' ? 'online' : device.status === 'connecting' ? 'connecting' : 'offline';
    var s = size || 18;
    return '<span class="status-dot ' + cls + '" style="width:' + s + 'px;height:' + s + 'px"></span>';
  }

  function statusPill(device, opts) {
    opts = opts || {};
    var map = {
      online: { t: 'Online', c: 'online' },
      connecting: { t: 'Connecting', c: 'connecting' },
      offline: { t: 'Offline', c: 'offline' },
      inactive: { t: 'Inactive', c: 'inactive' },
    };
    var m = map[device.status] || map.offline;
    var text = opts.trackingLabel && device.status === 'online' ? 'Tracking' : opts.lostLabel && device.status !== 'online' ? 'Connection lost' : m.t;
    var onNavy = opts.onNavy ? ' on-navy' : '';
    return '<span class="pill ' + (onNavy ? '' : m.c) + onNavy + ' ' + (opts.lg ? 'lg' : '') + '"><i class="dot' + (device.status === 'online' && opts.pulse ? ' pulse' : '') + '"></i>' + text + '</span>';
  }

  /* ------------------------------------------------------------- list rows */
  /**
   * The reference's navy pill row: circular jeepney avatar (or status dot),
   * bold title, grey-ish sub line, right-aligned meta.
   */
  function pillRow(o) {
    o = o || {};
    var cls = 'pill-row' + (o.variant ? ' ' + o.variant : '');
    var lead = o.lead != null ? o.lead : o.color ? window.Brand.jeepAvatar(o.color, o.avatarSize || 50) : o.dotColor ? '<span class="status-dot" style="background:' + o.dotColor + '"></span>' : '';
    return (
      '<' + (o.href ? 'a' : 'button') + ' class="' + cls + '"' + (o.attrs || '') + (o.href ? ' href="' + esc(o.href) + '"' : ' type="button"') + '>' +
      (lead ? '<span style="flex:none;display:inline-flex">' + lead + '</span>' : '') +
      '<span class="pr-body">' +
      '<span class="pr-title nowrap">' + esc(o.title || '') + '</span>' +
      (o.sub ? '<span class="pr-sub nowrap">' + o.sub + '</span>' : '') +
      '</span>' +
      (o.meta
        ? '<span class="pr-meta">' + (o.meta.main ? '<span class="eta-main">' + o.meta.main + '</span>' : '') + (o.meta.cap ? '<span class="eta-cap">' + o.meta.cap + '</span>' : '') + '</span>'
        : '') +
      (o.chevron ? '<span class="pr-meta" style="opacity:.9">' + window.Icons.chevRight(18) + '</span>' : '') +
      '</' + (o.href ? 'a' : 'button') + '>'
    );
  }

  /** Greyed-out empty slot with the reference's dotted line. */
  function placeholderRow(o) {
    o = o || {};
    return (
      '<div class="pill-row placeholder" aria-hidden="true">' +
      (o.muted ? window.Brand.jeepAvatar('#ADB5BD', 50, { muted: true }) : '') +
      '<span class="pr-body"><span class="dotted"></span></span>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------- tracking list row */
  /** Nearby jeep row: colour/status dot • route name • distance • "ETA: x" (p-06). */
  function jeepCard(device, opts) {
    opts = opts || {};
    var route = window.Store.routeById(device.routeId);
    var ctx = tripContext(device, opts);
    var title = route ? route.name : device.name;
    var dot = device.color || (route && route.color) || window.Brand.colorFor(device.routeId || device.id);
    var dist = ctx.distanceFromUserM != null ? ctx.distanceFromUserM : ctx.distanceM;
    var sub = device.name + (dist != null ? ' \u00b7 ' + Geo.formatDistance(dist) : '');
    if (device.status !== 'online') {
      sub += ' \u00b7 ' + (device.ageMs != null ? 'last seen ' + Geo.formatRelative(device.ageMs) : 'no signal yet');
    }
    var eta = device.status !== 'online' ? 'ETA unavailable' : 'ETA: ' + Geo.formatEta(ctx.etaSec, device);
    return (
      '<button class="pill-row tinted' + (device.status === 'online' ? '' : ' dim') + '" data-device="' + esc(device.id) + '" type="button">' +
      '<span style="flex:none;display:inline-flex"><span class="status-dot" style="background:' + esc(dot) + ';width:22px;height:22px"></span></span>' +
      '<span class="pr-body">' +
      '<span class="pr-title nowrap">' + esc(title) + '</span>' +
      '<span class="pr-sub nowrap">' + esc(sub) + '</span>' +
      '</span>' +
      '<span class="pr-meta"><span class="eta-main nowrap">' + esc(eta) + '</span></span>' +
      '</button>'
    );
  }

  /** Passenger route row: circular jeepney art + name + start→end + live badge. */
  function routeCard(route, opts) {
    opts = opts || {};
    var devices = window.Store.devices({ routeId: route.id, activeOnly: true });
    var online = devices.filter(function (d) { return d.status === 'online'; }).length;
    var startN = (route.startPoint && route.startPoint.name) || 'Start';
    var endN = (route.endPoint && route.endPoint.name) || 'End';
    var km = route.distanceM ? (route.distanceM / 1000).toFixed(1) + ' km' : '';
    var sub = esc(startN) + ' → ' + esc(endN) + (km ? ' · ' + km : '') + (route.isLoop ? ' · loop' : '');
    return (
      '<button class="pill-row light" data-route="' + esc(route.id) + '" type="button" style="min-height:74px">' +
      window.Brand.jeepAvatar(opts.color || window.Brand.colorFor(route.id), 54) +
      '<span class="pr-body">' +
      '<span class="pr-title nowrap" style="font-size:17px">' + esc(route.name) + '</span>' +
      '<span class="pr-sub nowrap">' + sub + '</span>' +
      '<span style="display:block;margin-top:6px">' +
      (online
        ? '<span class="pill online"><i class="dot pulse"></i>' + online + ' live now</span>'
        : '<span class="pill offline"><i class="dot"></i>No active jeepneys</span>') +
      '</span>' +
      '</span>' +
      '<span class="pr-meta" style="color:#ADB5BD">' + window.Icons.chevRight(20) + '</span>' +
      '</button>'
    );
  }

  /* ------------------------------------------------------------ tips card */
  function tipsCard(title) {
    return (
      '<div class="tips">' +
      '<div class="tips-head">' + window.Icons.jeep(22) +
      '<span class="th-title">' + esc(title || window.Brand.name + ' Navigational Tips') + '</span></div>' +
      '<ul>' +
      '<li>Type in your Destination.</li>' +
      '<li>Tap a jeepney on the list to see its details.</li>' +
      '</ul></div>'
    );
  }

  /* ------------------------------------------------------- label/value list */
  /** Reference tracking readout: "ETA:   < 1 min." style rows. */
  function statList(rows) {
    return (
      '<div class="stat-list">' +
      rows
        .map(function (r) {
          return (
            '<div class="sl-row"><span class="sl-k">' + esc(r.k) + '</span>' +
            '<span class="sl-v' + (r.big ? ' big' : '') + '"' + (r.id ? ' id="' + r.id + '"' : '') + '>' + (r.html || esc(r.v)) + '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function emptyState(icon, title, message, actionHtml) {
    return (
      '<div class="empty">' + '<span class="em-icon">' + (icon || window.Icons.jeep(30)) + '</span>' +
      '<div class="t-card">' + esc(title) + '</div>' +
      (message ? '<div class="t-small">' + esc(message) + '</div>' : '') +
      (actionHtml || '') + '</div>'
    );
  }

  function loadingRow(text) {
    return '<div class="loading-row"><span class="spinner"></span>' + esc(text || 'Loading…') + '</div>';
  }

  /* ------------------------------------------------------------ trip maths */
  function tripContext(device, opts) {
    opts = opts || {};
    var route = window.Store.routeById(device.routeId);
    var out = { etaSec: null, etaCaption: 'eta', distanceM: null, landmarkName: device.landmark ? device.landmark.name : null, target: null };
    if (opts.destination && route && device.s != null) {
      var prep = Geo.prepare(route.path);
      var pr = Geo.project(prep, { lat: opts.destination.latitude, lng: opts.destination.longitude }, null, null);
      if (pr.offM < 400) {
        var rem = Geo.remainingTo(prep, device.s, pr.s, !!route.isLoop);
        out.etaSec = Geo.etaSec(rem, device.speedKmh);
        out.distanceM = rem;
        out.etaCaption = 'to ' + opts.destination.name;
        out.target = opts.destination.name;
      } else {
        out.etaCaption = 'destination off-route';
      }
    }
    if (out.etaSec == null) {
      if (device.distanceToNextStopM != null && device.nextStop) {
        out.etaSec = Geo.etaSec(device.distanceToNextStopM, device.speedKmh);
        out.etaCaption = 'to ' + device.nextStop.name;
        out.distanceM = device.distanceToNextStopM;
        out.target = device.nextStop.name;
      } else if (device.etaSecToEnd != null) {
        out.etaSec = device.etaSecToEnd;
        out.etaCaption = 'to route end';
        out.distanceM = device.distanceToEndM;
      }
    }
    if (opts.origin && device.position) out.distanceFromUserM = Geo.haversine(opts.origin, device.position);
    return out;
  }

  function sortForList(devices, origin) {
    var rank = { online: 0, connecting: 1, offline: 2, inactive: 3 };
    return devices.slice().sort(function (a, b) {
      var ra = rank[a.status] == null ? 4 : rank[a.status];
      var rb = rank[b.status] == null ? 4 : rank[b.status];
      if (ra !== rb) return ra - rb;
      if (!origin) return 0;
      var da = a.position ? Geo.haversine(origin, a.position) : Infinity;
      var db = b.position ? Geo.haversine(origin, b.position) : Infinity;
      return da - db;
    });
  }

  function connectivityBanner() {
    var el = document.getElementById('net-banner');
    if (!el) return;
    el.classList.toggle('show', !window.Store.state.connected);
  }

  /* A public deployment can be locked with ADMIN_KEY (server.js). The first time a
   * write is refused we ask once and remember the key on this device. */
  function askAdminKey() {
    return new Promise(function (resolve) {
      if (window.__askingKey) return resolve(null);
      window.__askingKey = true;
      var scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.innerHTML =
        '<div class="dialog" role="dialog" aria-modal="true">' +
        '<h3>Admin key needed</h3>' +
        '<p>This DaBound deployment is locked. Enter the shared admin key to keep editing routes and jeepneys.</p>' +
        '<input class="input" id="ak-input" type="password" autocomplete="off" placeholder="Admin key" />' +
        '<div class="dialog-actions">' +
        '<button class="btn quiet" data-act="cancel">Cancel</button>' +
        '<button class="btn" data-act="ok">Unlock</button>' +
        '</div></div>';
      document.getElementById('screen-host').appendChild(scrim);
      var input = scrim.querySelector('#ak-input');
      setTimeout(function () { input.focus(); }, 30);
      function finish(value) {
        window.__askingKey = false;
        scrim.remove();
        resolve(value);
      }
      scrim.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (!act && e.target !== scrim) return;
        var val = act && act.dataset.act === 'ok' && input.value.trim() ? input.value.trim() : null;
        if (val) { try { localStorage.setItem('dabound.key', val); } catch (err) { /* private mode */ } }
        finish(val);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var okBtn = scrim.querySelector('[data-act="ok"]');
          if (okBtn) okBtn.click();
        }
      });
    });
  }

  window.UI = {
    esc: esc,
    toast: toast,
    askAdminKey: askAdminKey,
    confirm: confirmDialog,
    appbar: appbar,
    statusPill: statusPill,
    statusDot: statusDot,
    pillRow: pillRow,
    placeholderRow: placeholderRow,
    jeepCard: jeepCard,
    routeCard: routeCard,
    tipsCard: tipsCard,
    statList: statList,
    tripContext: tripContext,
    sortForList: sortForList,
    emptyState: emptyState,
    loadingRow: loadingRow,
    connectivityBanner: connectivityBanner,
  };
})();
