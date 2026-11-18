'use strict';
/* Popup Blocker for Orion — page-world hook (v1.1.0)
 *
 * v1.0 caught window.open and real _blank clicks. Streaming /
 * popunder sites route around both:
 *   1. They create an <a target=_blank> that is NEVER attached to
 *      the document (or is removed instantly) and call .click() on
 *      it — no document click listener ever fires.
 *   2. They call form.submit(), which by spec fires NO submit
 *      event, so a submit listener sees nothing.
 *   3. They dispatch synthetic click events with dispatchEvent().
 *   4. They swap an anchor's href between mousedown and click, so
 *      the link you pressed is not the link that opens.
 *   5. They cover the player with a giant transparent _blank
 *      overlay — your "click on the video" is a click on their ad
 *      link (popunder / click-anywhere).
 *   6. They grab a pristine window.open from a freshly created
 *      about:blank / srcdoc iframe before any blocker patches it.
 *
 * v1.1 counters, all in this hook:
 *   - Prototype intercepts: HTMLElement.prototype.click,
 *     HTMLFormElement.prototype.submit, and
 *     EventTarget.prototype.dispatchEvent for anchor clicks —
 *     these fire no matter where the element lives.
 *   - href-swap guard: the anchor + href seen at pointerdown is
 *     compared at click; a changed href is blocked in BOTH modes
 *     and reported as swapped.
 *   - Overlay guard: a _blank anchor covering >= 70% of the
 *     viewport is treated as a click-anywhere popunder and
 *     blocked even in Smart mode.
 *   - Iframe patcher: a MutationObserver + 750ms scan wraps
 *     contentWindow.open on every accessible frame (about:blank
 *     and srcdoc frames included), closing the clean-open grab.
 *   - Posts 'hook-ready' so content.js can verify the hook is
 *     alive on this page and retry injection another way if not.
 *
 * Config (from content.js): { mode: 'strict'|'smart', allowSite }.
 * Default before config arrives: strict, not allowlisted.
 */
(function () {
  if (window.__opbHooked) return;
  window.__opbHooked = true;

  var config = { mode: 'strict', allowSite: false };
  var seq = 0;
  var lastGestureAt = 0;
  var allowNext = null; // { url, expires }
  var lastDown = null; // { el, href, time } for the href-swap guard

  function resolve(raw) {
    if (raw == null || raw === '') return 'about:blank';
    try { return new URL(String(raw), window.location.href).href; }
    catch (e) { return String(raw); }
  }
  function post(msg) {
    try { msg.__opb = true; window.postMessage(msg, '*'); } catch (e) {}
  }
  function reportBlocked(kind, rawUrl, targetName, note) {
    seq += 1;
    var id = 'opb-' + Date.now().toString(36) + '-' + seq;
    var url = resolve(rawUrl);
    post({
      type: 'blocked',
      entry: {
        id: id, kind: kind, url: url,
        pendingBlank: url === 'about:blank',
        target: targetName || '', note: note || '', time: Date.now(),
      },
    });
    return id;
  }
  function reportUpdate(id, url) {
    post({ type: 'blocked-update', id: id, url: url });
  }

  /* ---------------- gesture tracking ---------------- */
  ['pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach(function (type) {
    try {
      document.addEventListener(type, function (e) {
        lastGestureAt = Date.now();
        var a = anchorOf(e && e.target);
        if (a) {
          lastDown = { el: a, href: a.href || '', time: Date.now() };
        }
      }, true);
    } catch (e) {}
  });
  try {
    document.addEventListener('click', function () { lastGestureAt = Date.now(); }, true);
  } catch (e) {}

  function hasGesture() {
    try {
      if (window.navigator && window.navigator.userActivation &&
          window.navigator.userActivation.isActive) return true;
    } catch (e) {}
    return Date.now() - lastGestureAt < 1000;
  }
  function tokenAllows(url) {
    if (!allowNext) return false;
    if (Date.now() > allowNext.expires) { allowNext = null; return false; }
    if (allowNext.url === url || allowNext.url === resolve(url)) {
      allowNext = null;
      return true;
    }
    return false;
  }

  /* ---------------- shared anchor helpers ---------------- */
  function anchorOf(node) {
    if (!node) return null;
    try { if (node.tagName === 'A') return node; } catch (e) {}
    if (typeof node.closest === 'function') {
      try { return node.closest('a'); } catch (e) {}
    }
    return null;
  }
  function targetOf(el) {
    if (!el) return '';
    var t = '';
    try { t = el.getAttribute ? (el.getAttribute('target') || '') : (el.target || ''); }
    catch (e) {}
    return String(t);
  }
  function isPopupTarget(t) {
    if (!t) return false;
    if (String(t).toLowerCase() === '_blank') return true;
    return String(t).charAt(0) !== '_' && String(t).length > 0;
  }
  function hrefOf(a) {
    var h = '';
    try { h = a.href || (a.getAttribute ? a.getAttribute('href') : '') || ''; } catch (e) {}
    return String(h);
  }
  function isJunkHref(h) {
    if (!h || h === '#') return true;
    try { return new URL(h, window.location.href).protocol === 'javascript:'; }
    catch (e) { return false; }
  }
  function coversViewport(a) {
    try {
      if (!a || typeof a.getBoundingClientRect !== 'function') return false;
      var r = a.getBoundingClientRect();
      var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      if (!r || !vw || !vh) return false;
      return (r.width * r.height) >= 0.7 * vw * vh;
    } catch (e) { return false; }
  }
  function hrefSwapped(a) {
    if (!lastDown || lastDown.el !== a) return false;
    if (Date.now() - lastDown.time > 2000) return false;
    var now = hrefOf(a);
    return !!now && !!lastDown.href && now !== lastDown.href;
  }

  // Decide for a navigation attempt through an anchor.
  // ctx: { via: 'event'|'prototype'|'dispatch', isTrusted: bool }
  // Returns '' to allow, or a note string when blocked.
  function anchorBlockReason(a, ctx) {
    if (config.allowSite) return '';
    if (!isPopupTarget(targetOf(a))) return '';
    var href = hrefOf(a);
    if (isJunkHref(href)) return '';
    if (hrefSwapped(a)) return 'href swapped after mousedown';
    if (coversViewport(a)) return 'full-screen overlay link';
    if (config.mode === 'smart') {
      if (ctx.via === 'event' && ctx.isTrusted) return '';
      if (ctx.via !== 'event' && hasGesture()) return '';
      return 'no user gesture';
    }
    return 'strict mode';
  }

  /* ---------------- F: fake window for about:blank ---------------- */
  function makeFakeWindow(id, name) {
    var current = 'about:blank';
    var closedFlag = false;
    function captureNav(v) {
      var dest = resolve(v);
      if (dest && dest !== 'about:blank') {
        current = dest;
        reportUpdate(id, dest);
      }
    }
    var loc = {};
    try {
      Object.defineProperty(loc, 'href', {
        get: function () { return current; },
        set: function (v) { captureNav(v); },
        enumerable: true,
      });
    } catch (e) { loc.href = current; }
    loc.assign = function (v) { captureNav(v); };
    loc.replace = function (v) { captureNav(v); };
    loc.reload = function () {};
    loc.toString = function () { return current; };
    var doc = {
      location: loc, URL: current,
      write: function () {}, writeln: function () {},
      open: function () {}, close: function () {},
    };
    var base = {
      name: name || '', closed: false, length: 0, opener: window,
      location: loc, document: doc,
      focus: function () {}, blur: function () {},
      close: function () { closedFlag = true; try { base.closed = true; } catch (e) {} },
      postMessage: function () {},
      addEventListener: function () {}, removeEventListener: function () {},
      resizeTo: function () {}, moveTo: function () {},
    };
    if (typeof Proxy === 'function') {
      var proxy = new Proxy(base, {
        get: function (t, p) {
          if (p === 'location') return loc;
          if (p === 'document') return doc;
          if (p === 'closed') return closedFlag;
          if (p === 'window' || p === 'self') return proxy;
          if (p in t) return t[p];
          return undefined;
        },
        set: function (t, p, v) {
          if (p === 'location') { captureNav(v); return true; }
          if (p === 'closed') { closedFlag = !!v; return true; }
          try { t[p] = v; } catch (e) {}
          return true;
        },
      });
      return proxy;
    }
    try {
      Object.defineProperty(base, 'location', {
        get: function () { return loc; },
        set: function (v) { captureNav(v); },
      });
    } catch (e) {}
    return base;
  }

  /* ---------------- Core: window.open, per-window ---------------- */
  function installOpenOn(win, label) {
    try {
      if (!win || win.__opbHookedOpen) return false;
      var native = win.open;
      if (typeof native !== 'function') return false;
      var wrapped = function (url, target, features) {
        var raw = url == null ? '' : String(url);
        var resolved = resolve(raw);
        if (tokenAllows(raw)) return native.apply(win, arguments);
        var blocked = !config.allowSite &&
          (config.mode !== 'smart' || !hasGesture());
        if (!blocked) return native.apply(win, arguments);
        var id = reportBlocked(
          label === 'iframe' ? 'window.open (iframe)' : 'window.open',
          raw, target || '');
        if (resolved === 'about:blank') return makeFakeWindow(id, target || '');
        return null;
      };
      win.open = wrapped;
      try { Object.defineProperty(win, '__opbHookedOpen', { value: wrapped }); }
      catch (e) { win.__opbHookedOpen = wrapped; }
      if (win === window) {
        // Sites sometimes overwrite window.open later to dodge
        // blockers; re-assert ours on a cheap 1s check.
        try {
          setInterval(function () {
            try { if (window.open !== wrapped) window.open = wrapped; } catch (e) {}
          }, 1000);
        } catch (e) {}
      }
      return true;
    } catch (e) { return false; }
  }
  installOpenOn(window, 'top');

  /* ---------------- C+: real _blank clicks (event route) ---------------- */
  function onClickLike(e) {
    var a = anchorOf(e.target);
    if (!a) return;
    var reason = anchorBlockReason(a, { via: 'event', isTrusted: e.isTrusted });
    if (!reason) return;
    try { e.preventDefault(); } catch (err) {}
    try { e.stopPropagation(); } catch (err) {}
    if (typeof e.stopImmediatePropagation === 'function') {
      try { e.stopImmediatePropagation(); } catch (err) {}
    }
    reportBlocked('link', hrefOf(a), targetOf(a), reason);
  }
  try {
    document.addEventListener('click', onClickLike, true);
    document.addEventListener('auxclick', onClickLike, true);
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form) return;
      if (!isPopupTarget(targetOf(form))) return;
      if (config.allowSite) return;
      if (config.mode === 'smart' && e.isTrusted) return;
      try { e.preventDefault(); } catch (err) {}
      try { e.stopPropagation(); } catch (err) {}
      reportBlocked('form', form.action || '', targetOf(form), 'submit event');
    }, true);
  } catch (e) {}

  /* ---------------- v1.1: prototype intercepts ---------------- */
  // HTMLElement.prototype.click — fires for detached anchors too,
  // which no document listener can ever see. Real user clicks do
  // NOT pass through this JS method, so anything arriving here is
  // programmatic by definition.
  try {
    var HE = window.HTMLElement || (typeof HTMLElement !== 'undefined' ? HTMLElement : null);
    if (HE && HE.prototype && typeof HE.prototype.click === 'function') {
      var nativeElClick = HE.prototype.click;
      HE.prototype.click = function () {
        try {
          if (this && this.tagName === 'A') {
            var reason = anchorBlockReason(this, { via: 'prototype', isTrusted: false });
            if (reason) {
              reportBlocked('link', hrefOf(this), targetOf(this),
                'programmatic anchor click — ' + reason);
              return undefined;
            }
          }
        } catch (e) {}
        return nativeElClick.apply(this, arguments);
      };
    }
  } catch (e) {}

  // HTMLFormElement.prototype.submit — spec says it fires no
  // submit event, so v1.0's listener was blind to it.
  try {
    var HF = window.HTMLFormElement || (typeof HTMLFormElement !== 'undefined' ? HTMLFormElement : null);
    if (HF && HF.prototype && typeof HF.prototype.submit === 'function') {
      var nativeFormSubmit = HF.prototype.submit;
      HF.prototype.submit = function () {
        try {
          if (isPopupTarget(targetOf(this)) && !config.allowSite &&
              config.mode !== 'smart') {
            reportBlocked('form', this.action || '', targetOf(this),
              'form.submit() (no submit event)');
            return undefined;
          }
          if (isPopupTarget(targetOf(this)) && !config.allowSite &&
              config.mode === 'smart' && !hasGesture()) {
            reportBlocked('form', this.action || '', targetOf(this),
              'form.submit() without gesture');
            return undefined;
          }
        } catch (e) {}
        return nativeFormSubmit.apply(this, arguments);
      };
    }
  } catch (e) {}

  // EventTarget.prototype.dispatchEvent — synthetic anchor clicks.
  // Again, real user clicks never travel this JS API.
  try {
    var ET = window.EventTarget || (typeof EventTarget !== 'undefined' ? EventTarget : null);
    if (ET && ET.prototype && typeof ET.prototype.dispatchEvent === 'function') {
      var nativeDispatch = ET.prototype.dispatchEvent;
      ET.prototype.dispatchEvent = function (ev) {
        try {
          if (this && this.tagName === 'A' && ev && ev.type === 'click') {
            var reason = anchorBlockReason(this, { via: 'dispatch', isTrusted: false });
            if (reason) {
              reportBlocked('link', hrefOf(this), targetOf(this),
                'synthetic dispatched click — ' + reason);
              return false;
            }
          }
        } catch (e) {}
        return nativeDispatch.apply(this, arguments);
      };
    }
  } catch (e) {}

  /* ---------------- v1.1: iframe clean-open patcher ---------------- */
  function scanFrames() {
    var frames;
    try { frames = document.querySelectorAll('iframe, frame'); } catch (e) { return; }
    if (!frames) return;
    for (var i = 0; i < frames.length; i++) {
      var cw = null;
      try { cw = frames[i].contentWindow; } catch (e) {}
      if (cw && cw !== window) installOpenOn(cw, 'iframe');
    }
  }
  try {
    if (typeof MutationObserver === 'function' && document.documentElement) {
      var mo = new MutationObserver(function () { scanFrames(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch (e) {}
  try { setInterval(scanFrames, 750); } catch (e) {}
  scanFrames();

  /* ---------------- config / open requests ---------------- */
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.__opb !== true || d.from !== 'content') return;
    if (d.type === 'config') {
      if (d.mode === 'smart' || d.mode === 'strict') config.mode = d.mode;
      config.allowSite = !!d.allowSite;
    } else if (d.type === 'open-now') {
      allowNext = { url: resolve(d.url), expires: Date.now() + 5000 };
      try { window.open(d.url, '_blank'); } catch (err) {}
    }
  });

  post({ type: 'need-config' });
  post({ type: 'hook-ready' });
})();
