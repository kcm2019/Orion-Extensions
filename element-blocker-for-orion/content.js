/* content.js — Element Blocker for Orion.
 * No in-page pill and no browser_action popup (popups don't render on
 * Kurt's Orion). The toolbar icon click (via background) toggles the
 * menu overlay over the current page. Rules persist per hostname and
 * are re-applied on every load via a generated stylesheet + a
 * fingerprint observer. */
(function () {
  'use strict';
  if (window.__ebLoaded) return;
  window.__ebLoaded = true;

  var HOST = location.hostname || '';
  var STORE_KEY = 'eb_store_v1';
  var store = EBRules.emptyStore();
  var hostRules = [];
  var revealAll = false;
  var styleEl = null;
  var saveTimer = null;
  var fpHidden = [];   // elements hidden by fingerprint matching
  var zapEls = [];     // elements zapped this session
  var lastAction = null;
  var countedThisLoad = {};

  /* ---------------- storage (browser -> chrome -> localStorage) ------- */
  function storageGet() {
    return new Promise(function (resolve) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get(STORE_KEY).then(function (o) { resolve(o && o[STORE_KEY]); }, function () { fallback(); });
          return;
        }
      } catch (e) {}
      fallback();
      function fallback() {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(STORE_KEY, function (o) { resolve(o && o[STORE_KEY]); });
            return;
          }
        } catch (e) {}
        try { resolve(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); }
        catch (e) { resolve(null); }
      }
    });
  }
  function storageSet(value) {
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.set({ eb_store_v1: value }); return;
      }
    } catch (e) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ eb_store_v1: value }); return;
      }
    } catch (e) {}
    try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch (e) {}
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { storageSet(store); }, 250);
  }

  /* ---------------- debug log (v1.3.0) --------------------------------
   * Ring buffer, persisted to storage as eb_debug_v1 so the manager
   * page can show/copy it even when the in-page UI is unreachable.
   * Kurt pastes this back for debugging. */
  var EBLog = {
    lines: [],
    t0: Date.now(),
    log: function (tag, msg) {
      var line = '[' + ((Date.now() - this.t0) / 1000).toFixed(2) + 's] ' + tag + ': ' + msg;
      this.lines.push(line);
      if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
      try { console.log('[EB] ' + line); } catch (e) {}
    },
    text: function () {
      return 'Element Blocker debug log v1.8.0\n' +
        'url: ' + location.href + '\n' +
        'host: ' + HOST + '\n' +
        'ua: ' + navigator.userAgent + '\n' +
        'popoverApi: ' + (typeof document.createElement('div').showPopover === 'function') + '\n' +
        'rulesOnHost: ' + hostRules.length + '\n' +
        '---\n' + this.lines.join('\n');
    },
    persist: function () {
      var snap = { ts: Date.now(), url: location.href, host: HOST, text: this.text() };
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.set({ eb_debug_v1: snap }); return;
        }
      } catch (e) {}
      try { localStorage.setItem('eb_debug_v1', JSON.stringify(snap)); } catch (e) {}
    }
  };
  var persistLogTimer = null;
  function persistLogSoon() {
    clearTimeout(persistLogTimer);
    persistLogTimer = setTimeout(function () { EBLog.persist(); }, 600);
  }
  /* ---------------- prefs (v1.4.0) ----------------------------------- */
  var PREFS_KEY = 'eb_prefs_v1';
  var prefs = { wallBreaker: true };
  function prefsGet() {
    return new Promise(function (resolve) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get(PREFS_KEY).then(function (o) { resolve(o && o[PREFS_KEY]); }, function () { resolve(null); });
          return;
        }
      } catch (e) {}
      try { resolve(JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')); } catch (e) { resolve(null); }
    });
  }
  function prefsSave() {
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.set({ eb_prefs_v1: prefs }); return;
      }
    } catch (e) {}
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  window.addEventListener('error', function (e) {
    EBLog.log('error', (e && e.message) || 'unknown window error');
    persistLogSoon();
  });

  /* Page-world hook (v1.5.0): suppresses wall confirm/alert/prompt
   * dialogs and their reload/redirect follow-through. Injected at
   * document_start so it is installed before site scripts call them. */
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || !e.data.__eb) return;
    EBLog.log(e.data.__eb === 'dialog' ? 'dialog' : 'hook', e.data.msg || '');
    if (e.data.__eb === 'dialog') { markHostile(); scheduleSnapshot(); persistLogSoon(); }
  });
  (function injectHook() {
    var url = null;
    try { url = browser.runtime.getURL('page-hook.js'); } catch (e) {
      try { url = chrome.runtime.getURL('page-hook.js'); } catch (e2) {}
    }
    if (!url) { EBLog.log('hook', 'no runtime.getURL — page hook NOT injected'); return; }
    var sc = document.createElement('script');
    sc.src = url;
    sc.async = false;
    (document.head || document.documentElement).appendChild(sc);
    sc.onload = function () { try { sc.remove(); } catch (e) {} };
    EBLog.log('hook', 'page hook injected');
  })();

  /* ---------------- permanent hiding --------------------------------- */
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.createElement('style');
    styleEl.id = 'eb-hide-style';
    (document.documentElement || document.head || document.body).appendChild(styleEl);
    return styleEl;
  }
  function applyStyle() {
    if (!HOST) return;
    hostRules = (store.hosts && store.hosts[HOST]) || [];
    var sels = [];
    hostRules.forEach(function (r) {
      sels.push(r.selector);
      (r.extraSelectors || []).forEach(function (s) { sels.push(s); });
    });
    var css = '';
    if (sels.length) css += sels.join(',\n') + '{display:none !important;}';
    css += '\n[data-eb-zap="1"]{display:none !important;}';
    if (prefs.wallBreaker) css += '\n' + EBWall.PREHIDE_CSS;
    var el = ensureStyle();
    el.textContent = css;
    el.disabled = revealAll;
  }

  function noteHit(rule) {
    if (countedThisLoad[rule.id]) return;
    countedThisLoad[rule.id] = true;
    rule.hits = (rule.hits || 0) + 1;
    save();
  }

  /* Fingerprint scan (D): hide copies whose selector no longer matches
   * (classes changed) but whose fingerprint still scores >= threshold. */
  var scanning = false, lastScan = 0;
  function scanFingerprints() {
    if (revealAll || !hostRules.length || !document.body) return;
    var now = Date.now();
    if (scanning || now - lastScan < 700) return;
    scanning = true; lastScan = now;
    try {
      var candidates = document.querySelectorAll('div,section,aside,header,footer,nav,a,button,span,p,li,form,iframe,img,figure,article,[role="dialog"],[aria-modal="true"]');
      var n = Math.min(candidates.length, 1600);
      for (var i = 0; i < n; i++) {
        var el = candidates[i];
        if (el.closest && el.closest('#eb-pill-host')) continue;
        var matchedBySelector = false;
        for (var j = 0; j < hostRules.length; j++) {
          var r = hostRules[j];
          var isSel = false;
          try { isSel = el.matches(r.selector); } catch (e) {}
          if (isSel) { matchedBySelector = true; noteHit(r); break; }
        }
        if (matchedBySelector) continue;
        if (el.getAttribute('data-eb-fp')) continue;
        var cs, rect;
        try { cs = getComputedStyle(el); rect = el.getBoundingClientRect(); } catch (e) { continue; }
        if (cs.display === 'none' || !rect.width || !rect.height) continue;
        var candFp = EBSelector.makeFingerprint(el, {
          position: cs.position,
          wPct: Math.round(rect.width / innerWidth * 100),
          hPct: Math.round(rect.height / innerHeight * 100)
        });
        // Cheap pre-filter: only score elements sharing tag with a rule.
        for (var k = 0; k < hostRules.length; k++) {
          var rule = hostRules[k];
          if (!rule.fingerprint || rule.fingerprint.tag !== candFp.tag) continue;
          var score = EBSelector.fingerprintScore(rule.fingerprint, candFp);
          if (score >= EBSelector.MATCH_THRESHOLD) {
            el.setAttribute('data-eb-fp', rule.id);
            el.style.setProperty('display', 'none', 'important');
            fpHidden.push(el);
            noteHit(rule);
            break;
          }
        }
      }
    } catch (e) {}
    scanning = false;
  }

  var observer = null, obsTimer = null;
  function startObserver() {
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver(function () {
      clearTimeout(obsTimer);
      obsTimer = setTimeout(function () { scanFingerprints(); scheduleWallScan(400); }, 350);
    });
    function arm() {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      else setTimeout(arm, 200);
    }
    arm();
  }

  /* ---------------- G: scroll unlock + collapse ---------------------- */
  var LOCK_CLASSES = ['modal-open', 'no-scroll', 'overflow-hidden', 'scroll-locked', 'has-modal', 'dialog-open'];
  function coversViewport(el) {
    try {
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      return (r.width * r.height) >= 0.3 * innerWidth * innerHeight;
    } catch (e) { return false; }
  }
  function maybeUnlockScroll(hiddenEl) {
    if (!coversViewport(hiddenEl)) return;
    // Any other large visible overlay left? Then leave the lock alone.
    var others = document.querySelectorAll('body > *, body > * > *');
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (o === hiddenEl || (hiddenEl.contains && hiddenEl.contains(o))) continue;
      if (o.closest && o.closest('#eb-pill-host')) continue;
      try {
        var cs = getComputedStyle(o);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (coversViewport(o)) return;
      } catch (e) {}
    }
    [document.documentElement, document.body].forEach(function (n) {
      if (!n) return;
      if (n.style && (n.style.overflow === 'hidden' || n.style.overflowY === 'hidden')) {
        n.style.removeProperty('overflow'); n.style.removeProperty('overflow-y');
      }
      LOCK_CLASSES.forEach(function (c) { if (n.classList) n.classList.remove(c); });
    });
  }
  function emptyWrappers(el) {
    var out = [];
    var node = el.parentElement;
    var hops = 0;
    while (node && hops < 3 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      var text = (node.textContent || '').trim();
      if (text) break;
      var hasVisibleChild = false;
      for (var i = 0; i < node.children.length; i++) {
        var ch = node.children[i];
        if (ch === el || out.indexOf(ch) !== -1) continue;
        try {
          var cs = getComputedStyle(ch);
          if (cs.display !== 'none' && ch.getBoundingClientRect().height > 0 && (ch.textContent || '').trim()) hasVisibleChild = true;
          else if (cs.display !== 'none' && ch.children.length) hasVisibleChild = true;
        } catch (e) {}
      }
      if (hasVisibleChild) break;
      out.push(node);
      el = node; node = node.parentElement; hops++;
    }
    return out;
  }

  /* ---------------- Wall Breaker (v1.4.0) ------------------------------
   * Automatic: no UI interaction, so the stacking war doesn't matter.
   * A document_start CSS rule pre-hides known wall iframes; this scan
   * catches the rest (phrase + coverage scoring in wb.js), hides the
   * wall root, releases the scroll lock, and re-kills re-inserts via
   * the mutation observer + timed sweeps. Session-broken walls are
   * restored if the breaker is switched off. */
  var wallKills = 0, wallBroken = [], wallScanTimer = null;
  var WALL_KILL_CAP = 12;
  function scheduleWallScan(delay) {
    if (!prefs.wallBreaker) return;
    clearTimeout(wallScanTimer);
    wallScanTimer = setTimeout(wallScan, delay || 300);
  }
  function wallRootFor(el) {
    var node = el;
    while (node.parentElement && node.parentElement !== document.body &&
           node.parentElement !== document.documentElement) {
      var p = node.parentElement;
      try {
        var r = p.getBoundingClientRect();
        var cs = getComputedStyle(p);
        var cover = (r.width * r.height) / (innerWidth * innerHeight) * 100;
        if (cover >= 80 && (cs.position === 'fixed' || cs.position === 'absolute')) { node = p; continue; }
      } catch (e) {}
      break;
    }
    return node;
  }
  function breakWall(root, verdict) {
    if (!root || root.getAttribute('data-eb-wall')) return;
    takeSnapshot();
    wallBroken.push({ el: root,
      disp: root.style.getPropertyValue('display'), dispP: root.style.getPropertyPriority('display') });
    root.setAttribute('data-eb-wall', '1');
    root.style.setProperty('display', 'none', 'important');
    wallKills++;
    markHostile();
    scheduleSnapshot();
    EBLog.log('wall', 'BROKE ' + describeEl(root) + ' :: ' + verdict.reasons.join('; '));
    maybeUnlockScroll(root);
    persistLogSoon();
  }
  function restoreWalls() {
    wallBroken.forEach(function (rec) {
      try {
        rec.el.removeAttribute('data-eb-wall');
        if (rec.disp) rec.el.style.setProperty('display', rec.disp, rec.dispP || '');
        else rec.el.style.removeProperty('display');
      } catch (e) {}
    });
    if (wallBroken.length) EBLog.log('wall', 'restored ' + wallBroken.length + ' wall(s) (breaker off)');
    wallBroken = [];
  }
  function wallScan() {
    if (!prefs.wallBreaker || !document.body || wallKills >= WALL_KILL_CAP) return;
    try {
      var mr = document.querySelector('meta[http-equiv="refresh" i]');
      if (mr) {
        var mc = mr.getAttribute('content') || '';
        if (/error-report\.com|getadmiral|admiral\.digital/i.test(mc)) {
          mr.remove();
          EBLog.log('wall', 'meta refresh to wall REMOVED: ' + mc.slice(0, 140));
          persistLogSoon();
        }
      }
    } catch (e) {}
    var els;
    try { els = document.body.querySelectorAll('*'); } catch (e) { return; }
    var n = Math.min(els.length, 3000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (el === pillHost || (el.closest && el.closest('#eb-pill-host'))) continue;
      if (el.getAttribute && el.getAttribute('data-eb-wall')) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!r.width || !r.height) continue;
      var cover = (r.width * r.height) / (innerWidth * innerHeight) * 100;
      if (cover < 40) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var isIframe = el.tagName === 'IFRAME';
      var positioned = cs.position === 'fixed' || cs.position === 'absolute' || el.tagName === 'DIALOG';
      if (!isIframe && !positioned) continue;
      var text = '';
      if (!isIframe) { try { text = (el.innerText || el.textContent || ''); } catch (e) {} }
      var verdict = EBWall.wallScore({
        tag: el.tagName.toLowerCase(),
        src: (el.getAttribute && el.getAttribute('src')) || '',
        coverPct: cover,
        positioned: positioned || isIframe,
        text: text.slice(0, 2000),
        textLen: isIframe ? 0 : text.trim().length
      });
      if (verdict.wall) {
        EBLog.log('wall', 'detected candidate ' + describeEl(el) + ' :: ' + verdict.reasons.join('; '));
        breakWall(wallRootFor(el), verdict);
        if (wallKills >= WALL_KILL_CAP) { EBLog.log('wall', 'kill cap reached — stopping for this page'); break; }
      }
    }
  }

  /* ---------------- dissolve + hide ---------------------------------- */
  function fadeOut(el) {
    try {
      el.style.transition = 'opacity .35s ease, filter .35s ease';
      el.style.opacity = '0.3';
      el.style.filter = 'blur(3px)';
      el.style.pointerEvents = 'none';
    } catch (e) {}
  }
  function doHide(el, permanent) {
    try { el.setAttribute('data-eb-hiding', '1'); } catch (e) {}
    var wasLarge = coversViewport(el);
    var wrappers = emptyWrappers(el);
    fadeOut(el);
    EBDissolve.animate(el, document, window, function () {
      if (permanent) {
        var rect = el.getBoundingClientRect();
        var cs = {};
        try { cs = getComputedStyle(el); } catch (e) {}
        var rule = {
          selector: EBSelector.generateSelector(el, document),
          extraSelectors: wrappers.map(function (w) { return EBSelector.generateSelector(w, document); }),
          fingerprint: EBSelector.makeFingerprint(el, {
            position: cs.position || '',
            wPct: Math.round(rect.width / innerWidth * 100),
            hPct: Math.round(rect.height / innerHeight * 100)
          }),
          created: Date.now(), hits: 1
        };
        EBLog.log('hide', 'PERMANENT ' + rule.selector + ' fp=' + JSON.stringify(rule.fingerprint).slice(0, 160));
        countedThisLoad[rule.id || ''] = true;
        store = EBRules.addRule(store, HOST, rule);
        hostRules = store.hosts[HOST] || [];
        var saved = hostRules.filter(function (r) { return r.selector === rule.selector; })[0];
        lastAction = { type: 'permanent', ruleId: saved && saved.id, selector: rule.selector };
        if (saved) countedThisLoad[saved.id] = true;
        save(); applyStyle();
        // The stylesheet now hides it; clear the fade inline styles via removal of element flow is done by CSS.
        scanFingerprints();
      } else {
        EBLog.log('hide', 'ZAP ' + describeEl(el));
        el.setAttribute('data-eb-zap', '1');
        zapEls.push(el);
        wrappers.forEach(function (w) { w.setAttribute('data-eb-zap', '1'); zapEls.push(w); });
        lastAction = { type: 'zap', el: el, wrappers: wrappers };
        applyStyle();
      }
      if (wasLarge) maybeUnlockScroll(el);
    });
  }
  function undoLast() {
    if (!lastAction) return;
    if (lastAction.type === 'permanent' && lastAction.ruleId) {
      store = EBRules.removeRule(store, HOST, lastAction.ruleId);
      save(); applyStyle();
    } else if (lastAction.type === 'zap' && lastAction.el) {
      [lastAction.el].concat(lastAction.wrappers || []).forEach(function (n) {
        n.removeAttribute('data-eb-zap');
        n.style.opacity = ''; n.style.filter = '';
      });
    }
    lastAction = null;
  }

  /* ---------------- menu + picker UI (icon-triggered) -------------- */
  var pillHost, shadow, menuEl, barEl, highlightEl, logEl;
  var mode = 'idle'; // idle | menu | picker
  var selChain = [], selIndex = 0, selected = null;

  function buildUI() {
    if (pillHost || !document.body) return;
    pillHost = document.createElement('div');
    pillHost.id = 'eb-pill-host';
    // One overlay root carrying the top stacking level: full-viewport,
    // max z-index, last in DOM, and (where WebKit allows) in the
    // browser top layer via the popover API — a site's anti-adblock
    // wall (same max z-index, inserted later) must not cover the menu.
    // Popover attr ONLY if the API exists: with the attribute but no
    // way to open it, the UA stylesheet hides the element outright.
    if (typeof pillHost.showPopover === 'function') {
      pillHost.setAttribute('popover', 'manual');
      EBLog.log('ui', 'popover API available — top layer will be used');
    } else {
      EBLog.log('ui', 'popover API NOT available — DOM-order + demotion only');
    }
    pillHost.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;pointer-events:none;z-index:2147483647;';
    try { pillHost.style.setProperty('z-index', '2147483647', 'important'); } catch (e) {}
    shadow = pillHost.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      ':host{font-family:-apple-system,system-ui,sans-serif;}' +
      '.wrap{position:absolute;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:flex-end;pointer-events:auto;}' +
      '.hl{position:absolute;pointer-events:none;border:2px solid #0a84ff;background:rgba(10,132,255,.10);border-radius:4px;display:none;}' +
      'button{font:inherit;cursor:pointer;border:none;}' +
      '.panel{background:rgba(22,22,27,.96);color:#fff;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:16px;padding:8px;box-shadow:0 8px 28px rgba(0,0,0,.45);min-width:210px;}' +
      '.panel button{display:block;width:100%;text-align:left;background:transparent;color:#fff;padding:10px 10px;font-size:14px;border-radius:10px;}' +
      '.panel button:active{background:rgba(255,255,255,.14);}' +
      '.panel .sub{font-size:11px;color:#9a9aa2;padding:4px 10px 8px;}' +
      '.bar{background:rgba(22,22,27,.96);color:#fff;border-radius:16px;padding:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);max-width:86vw;}' +
      '.bar .desc{font-size:12px;color:#c9c9d1;padding:0 2px 8px;word-break:break-all;}' +
      '.bar .row{display:flex;gap:6px;flex-wrap:wrap;}' +
      '.bar .row button{flex:1;background:rgba(255,255,255,.12);color:#fff;padding:9px 6px;font-size:13px;border-radius:10px;white-space:nowrap;}' +
      '.bar .row button.primary{background:#0a84ff;font-weight:700;}' +
      '.bar .row button.danger{background:rgba(255,69,58,.85);}' +
      '.logtext{width:78vw;max-width:520px;height:38vh;background:rgba(255,255,255,.08);color:#e8e8ee;border:1px solid rgba(255,255,255,.2);border-radius:10px;font-family:ui-monospace,monospace;font-size:10px;padding:8px;box-sizing:border-box;}' +
      '.hidden{display:none !important;}' +
      '</style>' +
      '<div class="hl" id="hl"></div>' +
      '<div class="wrap">' +
      '<div class="panel hidden" id="menu">' +
      '  <div class="sub" id="menuSub"></div>' +
      '  <button id="mPick">Hide an element…</button>' +
      '  <button id="mZapPick">Zap an element (this visit)…</button>' +
      '  <button id="mReveal">Show hidden on this site</button>' +
      '  <button id="mUndo">Undo last hide</button>' +
      '  <button id="mManager">Manage all rules…</button>' +
      '  <button id="mWall">Wall Breaker: On</button>' +
      '  <button id="mLog">Debug log…</button>' +
      '  <button id="mClose">Close</button>' +
      '</div>' +
      '<div class="bar hidden" id="bar">' +
      '  <div class="desc" id="barDesc">Tap an element to select it</div>' +
      '  <div class="row hidden" id="rowSize">' +
      '    <button id="bWider">＋ Wider</button>' +
      '    <button id="bNarrower">－ Narrower</button>' +
      '  </div>' +
      '  <div class="row hidden" id="rowAct" style="margin-top:6px;">' +
      '    <button class="primary" id="bHide">Hide forever</button>' +
      '    <button id="bZap">Zap once</button>' +
      '  </div>' +
      '  <div class="row" style="margin-top:6px;">' +
      '    <button id="bMenu">⋯ Menu</button>' +
      '    <button class="danger" id="bClose">Close</button>' +
      '  </div>' +
      '</div>' +
      '<div class="panel hidden" id="logPanel">' +
      '  <div class="sub">Debug log — Copy, then paste it to Muse</div>' +
      '  <textarea class="logtext" id="logText" readonly></textarea>' +
      '  <div class="row" style="display:flex;gap:6px;margin-top:6px;">' +
      '    <button id="bLogCopy" style="flex:1;">Copy log</button>' +
      '    <button id="bLogRefresh" style="flex:1;">Refresh</button>' +
      '    <button id="bLogBack" style="flex:1;">Back</button>' +
      '  </div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(pillHost);

    menuEl = shadow.getElementById('menu');
    barEl = shadow.getElementById('bar');
    logEl = shadow.getElementById('logPanel');
    highlightEl = shadow.getElementById('hl');

    shadow.getElementById('mClose').addEventListener('click', function () { setMode('idle'); });
    shadow.getElementById('mPick').addEventListener('click', function () { zapIntent = false; setMode('picker'); });
    shadow.getElementById('mZapPick').addEventListener('click', function () { zapIntent = true; setMode('picker'); });
    shadow.getElementById('mReveal').addEventListener('click', function () {
      revealAll = !revealAll;
      applyStyle();
      fpHidden.forEach(function (el) {
        if (revealAll) el.style.removeProperty('display');
      });
      if (!revealAll) { fpHidden = []; scanFingerprints(); }
      this.textContent = revealAll ? 'Re-hide on this site' : 'Show hidden on this site';
      // Stay in the menu — it closes only via Close / the icon.
    });
    shadow.getElementById('mUndo').addEventListener('click', function () { undoLast(); });
    shadow.getElementById('mManager').addEventListener('click', openManager);
    shadow.getElementById('mWall').addEventListener('click', function () {
      prefs.wallBreaker = !prefs.wallBreaker;
      prefsSave(); applyStyle();
      this.textContent = 'Wall Breaker: ' + (prefs.wallBreaker ? 'On' : 'Off');
      EBLog.log('wall', 'breaker toggled ' + (prefs.wallBreaker ? 'ON' : 'OFF'));
      if (prefs.wallBreaker) scheduleWallScan(100); else restoreWalls();
    });
    shadow.getElementById('mLog').addEventListener('click', function () { setMode('log'); });
    shadow.getElementById('bLogBack').addEventListener('click', function () { setMode('menu'); });
    shadow.getElementById('bLogRefresh').addEventListener('click', function () {
      shadow.getElementById('logText').value = EBLog.text();
    });
    shadow.getElementById('bLogCopy').addEventListener('click', function () {
      var ta = shadow.getElementById('logText');
      ta.value = EBLog.text();
      EBLog.persist();
      function done(ok) { EBLog.log('log', 'copy via clipboard ' + (ok ? 'OK' : 'FAILED — text is selected, long-press to copy')); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { ta.select(); done(false); });
      } else { ta.select(); try { done(document.execCommand('copy')); } catch (e) { done(false); } }
    });
    shadow.getElementById('bWider').addEventListener('click', function () { moveSelection(1); });
    shadow.getElementById('bNarrower').addEventListener('click', function () { moveSelection(-1); });
    shadow.getElementById('bMenu').addEventListener('click', function () { setMode('menu'); });
    shadow.getElementById('bClose').addEventListener('click', function () { setMode('idle'); });
    // Hide / Zap act, clear the selection, and STAY in the picker so
    // more elements can be removed — the session ends only on Close.
    shadow.getElementById('bHide').addEventListener('click', function () {
      if (selected) { var t = selected; clearSelection(); doHide(t, true); }
    });
    shadow.getElementById('bZap').addEventListener('click', function () {
      if (selected) { var t = selected; clearSelection(); doHide(t, false); }
    });
  }
  var zapIntent = false;

  function openManager() {
    var url = null;
    try { url = browser.runtime.getURL('manager.html'); } catch (e) {
      try { url = chrome.runtime.getURL('manager.html'); } catch (e2) {}
    }
    var sent = false;
    try {
      var p = browser.runtime.sendMessage({ type: 'eb-open-manager' });
      sent = true;
      if (p && p.catch) p.catch(function () { if (url) window.open(url, '_blank'); });
    } catch (e) {}
    if (!sent && url) window.open(url, '_blank');
  }

  /* ---------------- fight engine (v1.3.0) ---------------------------
   * Proven lessons applied (Beautiful Reader, Nov 16):
   *  - NEVER DOM-move a :popover-open element — the move kills it.
   *  - A popover attr with no open popover = UA display:none.
   * Probe: elementFromPoint at the visible panel's centre. If a
   * foreign element wins, escalate, logging every step:
   *  1. popover: re-enter the top layer (hide+show, no DOM move)
   *     not popover: move host to last child of <html>
   *  2. demote the occluder's root competitor (z-index max-1
   *     !important, recorded and restored on close)
   *  3. if the occluder is itself top-layer (dialog/popover), hide
   *     it for the session (display:none !important, restored)
   */
  var demoted = [];   // {el, z, zp, disp, dispP}
  var fightTicks = 0, onTopLogged = false, lastOccluderKey = '', lastOcclLogAt = 0;

  function popoverOpen() {
    try { return !!(pillHost && pillHost.matches(':popover-open')); } catch (e) { return false; }
  }
  function hasPopover() {
    return !!(pillHost && pillHost.hasAttribute && pillHost.hasAttribute('popover') && pillHost.showPopover);
  }
  function describeEl(el) {
    if (!el || !el.tagName) return String(el);
    var d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    var cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) d += '.' + cls.join('.');
    try {
      var cs = getComputedStyle(el);
      var r = el.getBoundingClientRect();
      d += ' [' + cs.position + ' z=' + cs.zIndex + ' disp=' + cs.display + ' ' +
        Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) + ']';
      var po = false; try { po = el.matches(':popover-open'); } catch (e) {}
      if (po) d += ' TOPLAYER-POPOVER';
      if (el.tagName === 'DIALOG' && el.open) d += ' DIALOG-OPEN';
    } catch (e) {}
    return d;
  }
  function rootCompetitor(el) {
    var node = el;
    while (node && node.parentElement &&
           node.parentElement !== document.documentElement &&
           node.parentElement !== document.body) {
      node = node.parentElement;
    }
    return node || el;
  }
  function recordDemote(el, apply) {
    for (var i = 0; i < demoted.length; i++) if (demoted[i].el === el) { apply(); return; }
    var rec = { el: el,
      z: el.style.getPropertyValue('z-index'), zp: el.style.getPropertyPriority('z-index'),
      disp: el.style.getPropertyValue('display'), dispP: el.style.getPropertyPriority('display') };
    demoted.push(rec); apply();
  }
  function restoreDemoted() {
    demoted.forEach(function (rec) {
      try {
        if (rec.z) rec.el.style.setProperty('z-index', rec.z, rec.zp || ''); else rec.el.style.removeProperty('z-index');
        if (rec.disp) rec.el.style.setProperty('display', rec.disp, rec.dispP || ''); else rec.el.style.removeProperty('display');
      } catch (e) {}
    });
    if (demoted.length) EBLog.log('fight', 'restored ' + demoted.length + ' demoted/hidden element(s) on close');
    demoted = [];
  }
  function demoteZ(el, why) {
    if (!el || el === pillHost || el === document.body || el === document.documentElement) return;
    recordDemote(el, function () { el.style.setProperty('z-index', '2147483646', 'important'); });
    EBLog.log('fight', 'demoted z-index of ' + describeEl(el) + ' (' + why + ')');
  }
  function hideForSession(el, why) {
    if (!el || el === pillHost) return;
    recordDemote(el, function () { el.style.setProperty('display', 'none', 'important'); });
    EBLog.log('fight', 'hid top-layer occluder for session: ' + describeEl(el) + ' (' + why + ')');
  }
  function assertTopmost() {
    if (!pillHost) return;
    if (hasPopover()) {
      if (mode !== 'idle' && !popoverOpen()) {
        try { pillHost.showPopover(); EBLog.log('fight', 'showPopover OK — UI in top layer'); }
        catch (e) { EBLog.log('fight', 'showPopover FAILED: ' + e.message); }
      }
      if (mode === 'idle' && popoverOpen()) {
        try { pillHost.hidePopover(); } catch (e) {}
      }
      return; // never DOM-move a popover host
    }
    // No popover: DOM-order guardian at the <html> level.
    try {
      var de = document.documentElement;
      if (mode !== 'idle' && de && de.lastElementChild !== pillHost) {
        de.appendChild(pillHost);
        EBLog.log('fight', 'moved UI host to last child of <html>');
      }
    } catch (e) {}
  }
  function visiblePanelRect() {
    var el = mode === 'menu' ? menuEl : (mode === 'log' ? logEl : barEl);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return r;
  }
  function fightTick() {
    if (mode === 'idle' || !pillHost) return;
    fightTicks++;
    assertTopmost();
    // Safety: popover attr present but host computed display:none and
    // not open — the UA is hiding us; strip the attr and log it.
    try {
      var hd = getComputedStyle(pillHost).display;
      if (hd === 'none' && !popoverOpen()) {
        if (hasPopover()) {
          try { pillHost.showPopover(); } catch (e) {}
          if (getComputedStyle(pillHost).display === 'none') {
            pillHost.removeAttribute('popover');
            EBLog.log('fight', 'host was display:none with popover attr — STRIPPED attr, DOM-order mode now');
          }
        } else {
          EBLog.log('fight', 'WARNING host computed display:none (no popover attr) — page CSS may be hiding it');
        }
      }
    } catch (e) {}
    var r = visiblePanelRect();
    if (!r) return;
    var hit = null;
    try { hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } catch (e) {}
    if (!hit) return;
    if (hit === pillHost) {
      if (!onTopLogged) {
        onTopLogged = true;
        EBLog.log('probe', 'ON TOP confirmed at panel centre after ' + fightTicks + ' tick(s), popoverOpen=' + popoverOpen());
        persistLogSoon();
      }
      return;
    }
    onTopLogged = false;
    var key = describeEl(hit);
    var now = Date.now();
    if (key !== lastOccluderKey || now - lastOcclLogAt > 1500) {
      lastOccluderKey = key; lastOcclLogAt = now;
      EBLog.log('probe', 'OCCLUDED by ' + key);
      EBLog.log('probe', '  root competitor: ' + describeEl(rootCompetitor(hit)));
      EBLog.log('probe', '  host: parent=' + (pillHost.parentElement ? pillHost.parentElement.tagName : '?') +
        ' popoverOpen=' + popoverOpen() + ' hasPopover=' + hasPopover());
      persistLogSoon();
    }
    // Escalate.
    var hitTopLayer = false;
    try { hitTopLayer = hit.matches(':popover-open') || (hit.tagName === 'DIALOG' && hit.open); } catch (e) {}
    if (hitTopLayer) {
      // Re-enter the top layer AFTER it (no DOM move), then hide it
      // for the session if we still lose next ticks.
      if (hasPopover() && popoverOpen()) {
        try { pillHost.hidePopover(); pillHost.showPopover(); EBLog.log('fight', 're-entered top layer after occluder'); } catch (e) {}
      }
      hideForSession(hit, 'top-layer occluder over the panel');
      return;
    }
    if (hasPopover() && popoverOpen()) {
      try { pillHost.hidePopover(); pillHost.showPopover(); EBLog.log('fight', 're-entered top layer (occluder not top-layer?)'); } catch (e) {}
    }
    var rc = rootCompetitor(hit);
    demoteZ(rc !== document.body && rc !== document.documentElement ? rc : hit, 'root competitor over the panel');
    if (rc !== hit) demoteZ(hit, 'occluder itself');
  }
  setInterval(fightTick, 250);

  function clearSelection() {
    selected = null; selChain = []; selIndex = 0;
    if (highlightEl) highlightEl.style.display = 'none';
    if (!shadow) return;
    var rs = shadow.getElementById('rowSize');
    var ra = shadow.getElementById('rowAct');
    if (rs) rs.classList.add('hidden');
    if (ra) ra.classList.add('hidden');
    shadow.getElementById('barDesc').textContent = 'Tap an element to select it';
  }

  function setMode(m) {
    var prev = mode;
    mode = m;
    EBLog.log('mode', prev + ' -> ' + m);
    if (m !== 'idle') { fightTicks = 0; onTopLogged = false; lastOccluderKey = ''; }
    if (m === 'idle') { restoreDemoted(); persistLogSoon(); }
    if (!shadow) return;
    menuEl.classList.toggle('hidden', m !== 'menu');
    barEl.classList.toggle('hidden', m !== 'picker');
    if (logEl) logEl.classList.toggle('hidden', m !== 'log');
    if (m === 'log') shadow.getElementById('logText').value = EBLog.text();
    if (m === 'menu') {
      var n = hostRules.length;
      shadow.getElementById('menuSub').textContent = HOST + ' — ' + n + ' permanent rule' + (n === 1 ? '' : 's');
      var mw = shadow.getElementById('mWall');
      if (mw) mw.textContent = 'Wall Breaker: ' + (prefs.wallBreaker ? 'On' : 'Off');
    }
    if (m !== 'picker') clearSelection();
    else clearSelection(); // picker always starts awaiting a selection
    assertTopmost();
  }

  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = EBSelector.stableClasses(el).slice(0, 2).map(function (c) { return '.' + c; }).join('');
    var r = el.getBoundingClientRect();
    return tag + id + cls + ' — ' + Math.round(r.width) + '×' + Math.round(r.height);
  }
  function showHighlight(el) {
    var r = el.getBoundingClientRect();
    highlightEl.style.display = 'block';
    highlightEl.style.left = r.left + 'px';
    highlightEl.style.top = r.top + 'px';
    highlightEl.style.width = r.width + 'px';
    highlightEl.style.height = r.height + 'px';
  }
  function selectEl(el) {
    if (!el || el === pillHost) return;
    if (el.closest && el.closest('#eb-pill-host')) return;
    if (el.closest && el.closest('[data-eb-hiding]')) return; // mid-dissolve
    selChain = EBSelector.ancestors(el);
    selIndex = 0;
    selected = el;
    EBLog.log('pick', 'selected ' + describeEl(el));
    showHighlight(el);
    shadow.getElementById('rowSize').classList.remove('hidden');
    shadow.getElementById('rowAct').classList.remove('hidden');
    shadow.getElementById('bHide').classList.toggle('primary', !zapIntent);
    shadow.getElementById('bZap').classList.toggle('primary', zapIntent);
    shadow.getElementById('barDesc').textContent = describe(el) +
      (zapIntent ? ' — Zap removes it for this visit only' : '');
  }
  function moveSelection(d) {
    if (!selChain.length) return;
    selIndex = Math.max(0, Math.min(selChain.length - 1, selIndex + d));
    selected = selChain[selIndex];
    if (selected) {
      showHighlight(selected);
      shadow.getElementById('barDesc').textContent = describe(selected);
    }
  }

  document.addEventListener('click', function (e) {
    if (mode !== 'picker') return;
    if (e.target === pillHost || (e.target.closest && e.target.closest('#eb-pill-host'))) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    selectEl(e.target);
  }, true);
  document.addEventListener('touchend', function (e) {
    if (mode !== 'picker') return;
    // click will follow and do the selection; just block page activation.
    if (e.target !== pillHost) { /* selection handled on click */ }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mode !== 'idle') setMode('idle');
  }, true);
  window.addEventListener('scroll', function () {
    if (selected && mode === 'picker') showHighlight(selected);
  }, true);

  /* Icon click (via background): selection first. The picker opens
   * over this page awaiting a tap; the action buttons appear only
   * after an element is selected, and the session stays up (picker
   * or menu) until Close / a second icon click. The full menu is one
   * tap away via the bar's ⋯ Menu button. */
  try {
    var rt = (typeof browser !== 'undefined' && browser.runtime) ||
             (typeof chrome !== 'undefined' && chrome.runtime);
    if (rt && rt.onMessage) {
      rt.onMessage.addListener(function (msg) {
        if (!msg || msg.type !== 'eb-toggle-menu') return;
        EBLog.log('icon', 'toggle message received (mode was ' + mode + ')');
        if (!document.body) { try { document.documentElement.appendChild(document.createElement('body')); } catch (e) {} }
        if ((!pillHost || !pillHost.isConnected) && document.body) {
          if (pillHost) EBLog.log('icon', 'UI host was detached (page wipe?) — rebuilding UI');
          pillHost = null; shadow = null; mode = 'idle';
          buildUI();
        }
        if (!shadow) return;
        if (mode !== 'idle') setMode('idle');
        else { zapIntent = false; setMode('picker'); }
      });
    }
  } catch (e) {}

  /* ---------------- anti-blank (v1.7.0) --------------------------------
   * The wall's last fallback: blank the article. Three shapes, three
   * counters — all only on pages already proven hostile (a wall was
   * broken or a wall dialog suppressed here):
   *  1. an opaque, textless, full-screen VEIL over the article;
   *  2. body/html forced display:none / visibility:hidden / opacity:0;
   *  3. the article DOM wiped outright — countered from a snapshot
   *     taken once the article had loaded (restores capped at 3).
   * The watchdog also re-attaches our own UI host if a wipe removed
   * it (which is why the menu stopped opening). */
  function markHostile() { try { sessionStorage.setItem('eb_hostile', '1'); } catch (e) {} }
  function isHostile() {
    if (wallKills > 0) return true;
    try { return sessionStorage.getItem('eb_hostile') === '1'; } catch (e) { return false; }
  }
  var pageSnapshot = null, snapshotArmed = false, blankRestores = 0;
  function scheduleSnapshot() {
    if (snapshotArmed) return;
    snapshotArmed = true;
    setTimeout(takeSnapshot, 1200);
    setTimeout(takeSnapshot, 4000);
  }
  function takeSnapshot() {
    if (!document.body) return;
    try {
      var t = (document.body.innerText || '').length;
      if (t > 800 && document.body.innerHTML.length < 4000000) {
        if (!pageSnapshot || t > pageSnapshot.textLen * 1.2) {
          pageSnapshot = { html: document.body.innerHTML, textLen: t };
          EBLog.log('blank', 'article snapshot taken (' + t + ' chars)');
        }
      }
    } catch (e) {}
  }
  function restoreSnapshot() {
    if (!pageSnapshot || blankRestores >= 3) return;
    blankRestores++;
    try {
      if (!document.body) {
        var nb = document.createElement('body');
        document.documentElement.appendChild(nb);
      }
      document.body.innerHTML = pageSnapshot.html;
      // The snapshot cannot carry live shadow DOM: drop its dead host
      // and style copies, then re-attach the live ones.
      document.querySelectorAll('#eb-pill-host, #eb-style').forEach(function (n) { n.remove(); });
      if (pillHost) document.body.appendChild(pillHost);
      applyStyle();
      EBLog.log('blank', 'PAGE WAS BLANKED — article restored from snapshot (restore #' + blankRestores + ')');
      persistLogSoon();
      scheduleWallScan(300);
    } catch (e) { EBLog.log('blank', 'restore failed: ' + e.message); }
  }
  function bodyStyleGuard() {
    [document.documentElement, document.body].forEach(function (el) {
      if (!el) return;
      try {
        var cs = getComputedStyle(el);
        if (cs.display === 'none') { el.style.setProperty('display', 'block', 'important'); EBLog.log('blank', 'forced ' + el.tagName + ' display back on'); }
        if (cs.visibility === 'hidden') { el.style.setProperty('visibility', 'visible', 'important'); EBLog.log('blank', 'forced ' + el.tagName + ' visibility back on'); }
        if (parseFloat(cs.opacity) === 0) { el.style.setProperty('opacity', '1', 'important'); EBLog.log('blank', 'forced ' + el.tagName + ' opacity back on'); }
      } catch (e) {}
    });
  }
  function veilScan() {
    if (!document.body || wallKills >= WALL_KILL_CAP) return;
    var els;
    try { els = document.body.querySelectorAll('*'); } catch (e) { return; }
    var n = Math.min(els.length, 3000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (el === pillHost || (el.closest && el.closest('#eb-pill-host'))) continue;
      if (el.getAttribute && el.getAttribute('data-eb-wall')) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!r.width || !r.height) continue;
      var cover = (r.width * r.height) / (innerWidth * innerHeight) * 100;
      if (cover < 92) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      var bg = cs.backgroundColor || '';
      var bgOpaque = bg && bg !== 'transparent' && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg);
      var text = '';
      try { text = (el.innerText || el.textContent || ''); } catch (e) {}
      var interactive = false;
      try { interactive = !!el.querySelector('video, iframe, button, a[href], input, select, textarea, [role="button"]'); } catch (e) {}
      if (EBWall.isVeil({ coverPct: cover, positioned: true, textLen: text.trim().length, hasInteractive: interactive, bgOpaque: bgOpaque })) {
        EBLog.log('blank', 'VEIL detected ' + describeEl(el) + ' bg=' + bg + ' cover=' + Math.round(cover) + '%');
        breakWall(el, { reasons: ['blank veil: opaque, textless, full-screen, no interactive content'] });
        return;
      }
    }
  }
  /* ---------------- sanctuary (v1.8.0) ---------------------------------
   * When the wiper keeps winning, stop restoring into its reach:
   * show the saved article inside OUR OWN overlay (same armour as
   * the menu — max z-index, watchdog re-attachment). The saved copy
   * is static (scripts/iframes/walls stripped), so there's nothing
   * left for the site to fight. The bar carries a Copy-log button:
   * the log is reachable exactly when the page is blanked, which is
   * when it's needed. */
  var sanctuaryHost = null, sanctuaryOpen = false;
  function sanctuaryArticleHTML(html) {
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc || !doc.body) return '';
      doc.querySelectorAll('script, iframe, form, style, link, noscript, #eb-pill-host, #eb-style, [data-eb-wall]').forEach(function (n) { n.remove(); });
      var best = null, bestLen = 0;
      doc.querySelectorAll('article, main, [role="main"], section, div').forEach(function (n) {
        var len = (n.textContent || '').length;
        if (len > bestLen) { best = n; bestLen = len; }
      });
      var root = (best && bestLen > 400) ? best : doc.body;
      return root.innerHTML || '';
    } catch (e) { return ''; }
  }
  function showSanctuary(reason) {
    if (sanctuaryOpen || !pageSnapshot) return;
    var article = sanctuaryArticleHTML(pageSnapshot.html);
    if (!article) { EBLog.log('blank', 'sanctuary: no article extractable from snapshot'); return; }
    sanctuaryOpen = true;
    sanctuaryHost = document.createElement('div');
    sanctuaryHost.id = 'eb-sanctuary';
    sanctuaryHost.style.setProperty('position', 'fixed', 'important');
    sanctuaryHost.style.setProperty('inset', '0', 'important');
    sanctuaryHost.style.setProperty('z-index', '2147483647', 'important');
    sanctuaryHost.style.setProperty('display', 'block', 'important');
    var sh = sanctuaryHost.attachShadow({ mode: 'open' });
    sh.innerHTML =
      '<style>' +
      '.page{position:absolute;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch;background:#fff;color:#16181d;' +
      'font:17px/1.68 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:74px 20px 48px;}' +
      '.page img{max-width:100%;height:auto}.page a{color:#0a84ff}.page h1,.page h2,.page h3{line-height:1.25}' +
      '.bar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:10px 12px;' +
      'background:rgba(20,22,28,.92);color:#fff;font:13px/1.3 -apple-system,sans-serif;z-index:2}' +
      '.bar b{flex:1;font-weight:600}.bar button{appearance:none;border:0;border-radius:999px;padding:7px 12px;' +
      'background:#0a84ff;color:#fff;font:600 13px -apple-system,sans-serif}' +
      '.bar button.ghost{background:rgba(255,255,255,.18)}' +
      '</style>' +
      '<div class="bar"><b>Saved copy — this site blanked the page</b>' +
      '<button id="sCopy" class="ghost">Copy log</button><button id="sClose">Close</button></div>' +
      '<div class="page"></div>';
    sh.querySelector('.page').innerHTML = article;
    sh.getElementById('sClose').addEventListener('click', function () {
      sanctuaryOpen = false;
      if (sanctuaryHost) sanctuaryHost.remove();
      EBLog.log('blank', 'sanctuary closed by user');
      persistLogSoon();
    });
    sh.getElementById('sCopy').addEventListener('click', function () {
      var btn = this;
      function done() { btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy log'; }, 1600); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(EBLog.text()).then(done, done);
      } else { done(); }
    });
    (document.documentElement || document.body).appendChild(sanctuaryHost);
    EBLog.log('blank', 'SANCTUARY OPEN — ' + reason);
    persistLogSoon();
  }

  var watchdogTicks = 0;
  setInterval(function () {
    watchdogTicks++;
    if (watchdogTicks > 160) return; // ~2 minutes of guarding per page
    // Our own UI must survive wipes too — that's the dead menu.
    try {
      if (pillHost && !pillHost.isConnected && document.body) {
        document.body.appendChild(pillHost);
        EBLog.log('blank', 'UI host was removed by the page — re-attached');
        persistLogSoon();
      }
    } catch (e) {}
    // Sanctuary, once open, is defended like the menu host.
    try {
      if (sanctuaryOpen && sanctuaryHost && !sanctuaryHost.isConnected) {
        (document.documentElement || document.body).appendChild(sanctuaryHost);
        EBLog.log('blank', 'sanctuary was removed by the page — re-attached');
        persistLogSoon();
      }
    } catch (e) {}
    // Blank handling runs whenever a snapshot exists (v1.8: the
    // hostile gate left v1.7 with nothing to restore on gamesradar).
    if (pageSnapshot && !sanctuaryOpen) {
      var cur = 0, kids = -1;
      try { cur = document.body ? (document.body.innerText || '').length : 0; } catch (e) {}
      try { kids = document.body ? document.body.children.length : -1; } catch (e) {}
      var verdict = EBWall.blankVerdict({
        hasBody: !!document.body, bodyChildren: kids, curText: cur,
        snapText: pageSnapshot.textLen, restores: blankRestores
      });
      if (verdict === 'restore') restoreSnapshot();
      else if (verdict === 'sanctuary') showSanctuary('page stayed blank after ' + blankRestores + ' restores');
    }
    if (!isHostile() || !document.body) return;
    bodyStyleGuard();
    if (watchdogTicks % 2 === 0) veilScan();
  }, 750);

  /* ---------------- boot ---------------------------------------------- */
  EBLog.log('boot', 'content script up, popoverApi=' + (typeof document.createElement('div').showPopover === 'function'));
  storageGet().then(function (saved) {
    store = EBRules.normalizeStore(saved || undefined);
    EBLog.log('boot', 'storage loaded, rules on this host: ' + ((store.hosts && store.hosts[HOST]) || []).length);
    applyStyle();
    scanFingerprints();
    startObserver();
  });
  [900, 3000, 7000].forEach(function (t) { setTimeout(takeSnapshot, t); });
  prefsGet().then(function (p) {
    if (p && typeof p.wallBreaker === 'boolean') prefs.wallBreaker = p.wallBreaker;
    EBLog.log('boot', 'wallBreaker=' + prefs.wallBreaker);
    applyStyle();
    [400, 1200, 2500, 5000, 9000, 15000, 25000, 40000].forEach(function (t) {
      setTimeout(wallScan, t);
    });
  });
  if (document.body) buildUI();
  else document.addEventListener('DOMContentLoaded', function () { buildUI(); scanFingerprints(); });
  document.addEventListener('DOMContentLoaded', function () { scanFingerprints(); });
})();
