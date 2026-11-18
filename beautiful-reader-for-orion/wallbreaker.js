/* wallbreaker.js — Beautiful Reader v1.10.0: the Element Blocker
 * Wall Breaker, ported in. Runs at document_start on every page and
 * polices the PAGE itself (the reader's own sweep only patrols while
 * the reader is open):
 *   - document_start CSS pre-hides known wall iframes
 *     (error-report.com / getadmiral.com / admiral.digital);
 *   - a scanner hides full-screen "allow ads" walls on sight
 *     (phrase + coverage scoring) and releases the scroll lock,
 *     re-killing re-inserts via observer + timed sweeps;
 *   - a page-world hook (br-page-hook.js) suppresses the wall's
 *     native confirm/alert/prompt fallback and its reload/redirect
 *     follow-through;
 *   - forced navigations to wall hosts are cancelled in the
 *     background (br-background.js, webRequest);
 *   - anti-blank: on pages proven hostile, opaque textless veils
 *     are hidden, a force-hidden page is re-shown, and a wiped
 *     article is restored from a snapshot.
 * Everything stands down while the reader is open (#br-reader in
 * the DOM) — the extracted article is already safe there, and the
 * reader's own sweep is in charge. Toggle: the Wall Breaker switch
 * in the popup's Reader Defaults (settings.wallBreaker, default on).
 * Pure scoring is exported as BRWall for tests.
 */
(function (global) {
  'use strict';

  /* ---------------- pure scoring (shared with tests) -------------- */
  var KNOWN_SRC = ['error-report.com', 'getadmiral.com', 'admiral.digital', 'fuckadblock', 'blockadblock'];
  var STRONG = ['allow ads to continue', 'please allow ads', 'allow ads on this site',
    'disable your adblock', 'disable your ad blocker', 'turn off your adblock',
    'turn off your ad blocker', 'adblock detected', 'ad blocker detected',
    'using an adblocker', 'using an ad blocker', 'whitelist this site', 'allowlist this site'];
  var WEAK = ['adblock', 'ad blocker', 'ad-blocker', 'allow ads', 'whitelist', 'allowlist',
    'disable adblock', 'pause your ad', 'ads help keep', 'supported by ads'];

  function phraseHits(text, list) {
    var t = String(text || '').toLowerCase();
    return list.filter(function (p) { return t.indexOf(p) !== -1; });
  }
  function knownSrc(src) {
    if (!src) return '';
    var s = String(src).toLowerCase();
    for (var i = 0; i < KNOWN_SRC.length; i++) {
      if (s.indexOf(KNOWN_SRC[i]) !== -1) return KNOWN_SRC[i];
    }
    return '';
  }
  function wallScore(info) {
    var reasons = [];
    var strong = phraseHits(info.text, STRONG);
    var weak = phraseHits(info.text, WEAK);
    var ks = info.tag === 'iframe' ? knownSrc(info.src) : '';
    if (ks) reasons.push('known wall iframe src: ' + ks);
    if (strong.length) reasons.push('strong phrase: ' + strong.join(' | '));
    if (weak.length >= 2) reasons.push('weak phrases x' + weak.length);
    var wall = false;
    if (ks && (info.coverPct || 0) >= 40) wall = true;
    if (!wall && info.positioned && (info.coverPct || 0) >= 85 && (info.textLen || 0) <= 1500) {
      if (strong.length >= 1 || weak.length >= 2) wall = true;
    }
    if (!wall && info.positioned && (info.coverPct || 0) >= 70 && (info.textLen || 0) <= 900 && strong.length >= 1) {
      wall = true;
    }
    return { wall: wall, strong: strong, weak: weak, knownSrc: ks, reasons: reasons };
  }
  function isVeil(info) {
    return !!info.positioned && (info.coverPct || 0) >= 92 &&
      (info.textLen || 0) <= 20 && !info.hasInteractive && !!info.bgOpaque;
  }
  /* Blank decision, pure (ported from Element Blocker v1.8.0):
   * restore while restores are cheap; escalate to the sanctuary
   * when the wiper keeps winning. */
  function blankVerdict(s) {
    if (!s.snapText) return 'none';
    var blanked = !s.hasBody || s.bodyChildren === 0 ||
      (s.curText || 0) < Math.max(200, s.snapText * 0.08);
    if (!blanked) return 'none';
    return (s.restores || 0) < 2 ? 'restore' : 'sanctuary';
  }
  /* The sanctuary's raw material: the article inside a snapshot,
   * with everything fightable stripped out (Element Blocker
   * v1.8.0's sanctuaryArticleHTML). Needs DOMParser. */
  function sanctuaryArticleHTML(html, parser) {
    try {
      var doc = parser.parseFromString(html, 'text/html');
      if (!doc || !doc.body) return '';
      doc.querySelectorAll('script, iframe, form, style, link, noscript, [data-br-wall]').forEach(function (n) { n.remove(); });
      var best = null, bestLen = 0;
      doc.querySelectorAll('article, main, [role="main"], section, div').forEach(function (n) {
        var len = (n.textContent || '').length;
        if (len > bestLen) { best = n; bestLen = len; }
      });
      var root = (best && bestLen > 400) ? best : doc.body;
      return root.innerHTML || '';
    } catch (e) { return ''; }
  }
  var PREHIDE_CSS =
    'iframe[src*="error-report.com"],iframe[src*="getadmiral.com"],iframe[src*="admiral.digital"]' +
    '{display:none !important;}';

  global.BRWall = {
    wallScore: wallScore, isVeil: isVeil, knownSrc: knownSrc,
    phraseHits: phraseHits, PREHIDE_CSS: PREHIDE_CSS,
    blankVerdict: blankVerdict, sanctuaryArticleHTML: sanctuaryArticleHTML
  };

  if (typeof document === 'undefined' || !document.documentElement) return;

  /* ---------------- engine ---------------------------------------- */
  var LOG_KEY = 'br.wallLog.v1';
  var SETTINGS_KEY = 'br.settings.v1';
  var logLines = [];
  var logSaveTimer = null;
  function log(kind, msg) {
    var line = '[' + new Date().toISOString().slice(11, 19) + '] ' + kind + ': ' + msg;
    logLines.push(line);
    if (logLines.length > 140) logLines.splice(0, logLines.length - 140);
    clearTimeout(logSaveTimer);
    logSaveTimer = setTimeout(function () {
      try {
        if (global.browser && browser.storage && browser.storage.local) {
          var o = {}; o[LOG_KEY] = logLines.slice();
          browser.storage.local.set(o);
        }
      } catch (e) {}
    }, 600);
  }
  function readerOpen() { return !!document.getElementById('br-reader'); }
  function isBrOwned(el) {
    return !!(el.closest && el.closest('[id^="br-"]'));
  }
  function describeEl(el) {
    if (!el || !el.tagName) return '?';
    var d = el.tagName.toLowerCase();
    if (el.id) d += '#' + el.id;
    var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) d += '.' + cls.join('.');
    return d;
  }

  var enabled = true; // until settings say otherwise
  var styleEl = null;
  function applyPrehide() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'br-wall-style';
    }
    styleEl.textContent = enabled ? PREHIDE_CSS : '';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  applyPrehide();

  function storageGet(key) {
    return new Promise(function (resolve) {
      try {
        if (global.browser && browser.storage && browser.storage.local) {
          browser.storage.local.get(key).then(function (o) { resolve(o && o[key]); }, function () { resolve(null); });
          return;
        }
        if (global.chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(key, function (o) { resolve(o && o[key]); });
          return;
        }
      } catch (e) {}
      resolve(null);
    });
  }
  storageGet(SETTINGS_KEY).then(function (s) {
    if (s && s.wallBreaker === false) {
      enabled = false;
      applyPrehide();
      log('wall', 'Wall Breaker disabled in settings — standing down');
    } else {
      log('wall', 'Wall Breaker active on ' + location.hostname);
    }
  });

  /* Page-world dialog hook. */
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || !e.data.__br) return;
    log(e.data.__br === 'dialog' ? 'dialog' : 'hook', e.data.msg || '');
    if (e.data.__br === 'dialog') { markHostile(); scheduleSnapshot(); }
  });
  (function injectHook() {
    var url = null;
    try { url = browser.runtime.getURL('br-page-hook.js'); } catch (e) {
      try { url = chrome.runtime.getURL('br-page-hook.js'); } catch (e2) {}
    }
    if (!url) { log('hook', 'no runtime.getURL — page hook NOT injected'); return; }
    var sc = document.createElement('script');
    sc.src = url;
    sc.async = false;
    (document.head || document.documentElement).appendChild(sc);
    sc.onload = function () { try { sc.remove(); } catch (e) {} };
  })();

  /* Wall scan + break. */
  var wallKills = 0, wallBroken = [], wallScanTimer = null;
  var WALL_KILL_CAP = 12;
  function scheduleWallScan(delay) {
    if (!enabled) return;
    clearTimeout(wallScanTimer);
    wallScanTimer = setTimeout(wallScan, delay || 300);
  }
  function maybeUnlockScroll(except) {
    try {
      [document.documentElement, document.body].forEach(function (el) {
        if (!el) return;
        var cs = getComputedStyle(el);
        if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.position === 'fixed') && !hasOtherOverlay(except)) {
          if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
          if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
          log('wall', 'scroll lock released on ' + el.tagName.toLowerCase());
        }
      });
    } catch (e) {}
  }
  function hasOtherOverlay(except) {
    return false; // the broken wall was the overlay; keep it simple
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
    if (!root || root.getAttribute('data-br-wall')) return;
    wallBroken.push({ el: root,
      disp: root.style.getPropertyValue('display'), dispP: root.style.getPropertyPriority('display') });
    root.setAttribute('data-br-wall', '1');
    root.style.setProperty('display', 'none', 'important');
    wallKills++;
    markHostile();
    scheduleSnapshot();
    log('wall', 'BROKE ' + describeEl(root) + ' :: ' + verdict.reasons.join('; '));
    maybeUnlockScroll(root);
  }
  function wallScan() {
    if (!enabled || !document.body || readerOpen() || wallKills >= WALL_KILL_CAP) return;
    try {
      var mr = document.querySelector('meta[http-equiv="refresh" i]');
      if (mr) {
        var mc = mr.getAttribute('content') || '';
        if (/error-report\.com|getadmiral|admiral\.digital/i.test(mc)) {
          mr.remove();
          log('wall', 'meta refresh to wall REMOVED: ' + mc.slice(0, 140));
        }
      }
    } catch (e) {}
    var els;
    try { els = document.body.querySelectorAll('*'); } catch (e) { return; }
    var n = Math.min(els.length, 3000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (isBrOwned(el) || (el.getAttribute && el.getAttribute('data-br-wall'))) continue;
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
      var verdict = wallScore({
        tag: el.tagName.toLowerCase(),
        src: (el.getAttribute && el.getAttribute('src')) || '',
        coverPct: cover,
        positioned: positioned || isIframe,
        text: text.slice(0, 2000),
        textLen: isIframe ? 0 : text.trim().length
      });
      if (verdict.wall) {
        log('wall', 'detected candidate ' + describeEl(el) + ' :: ' + verdict.reasons.join('; '));
        breakWall(wallRootFor(el), verdict);
        if (wallKills >= WALL_KILL_CAP) { log('wall', 'kill cap reached — stopping for this page'); break; }
      }
    }
  }

  /* Anti-blank (hostile pages only; stands down while reader open). */
  function markHostile() { try { sessionStorage.setItem('br_hostile', '1'); } catch (e) {} }
  function isHostile() {
    if (wallKills > 0) return true;
    try { return sessionStorage.getItem('br_hostile') === '1'; } catch (e) { return false; }
  }
  var pageSnapshot = null, snapshotArmed = false, sanctuaryAsked = false;
  /* The restore count survives reloads (v1.14.0): a wall that
   * force-reloads the page between blanks used to reset the
   * fight to zero every time, so the sanctuary escalation —
   * and with it the page kill — never accumulated. A healthy
   * observation resets it; a recovered page carries no debt. */
  var blankRestores = 0;
  try { blankRestores = parseInt(sessionStorage.getItem('br_restores') || '0', 10) || 0; } catch (e) {}
  function persistRestores() {
    try {
      if (blankRestores > 0) sessionStorage.setItem('br_restores', String(blankRestores));
      else sessionStorage.removeItem('br_restores');
    } catch (e) {}
  }
  function scheduleSnapshot() {
    if (snapshotArmed) return;
    snapshotArmed = true;
    setTimeout(takeSnapshot, 1200);
    setTimeout(takeSnapshot, 4000);
  }
  /* Element Blocker v1.8.0's core lesson: snapshot EARLY, on
   * every article-like page — v1.7 only snapshotted after a
   * wall broke, 1.2 s later, and on gamesradar the blank lands
   * inside that gap, leaving nothing to restore. takeSnapshot
   * itself keeps only text-rich, size-sane bodies. */
  [900, 3000, 7000].forEach(function (t) { setTimeout(takeSnapshot, t); });
  function takeSnapshot() {
    if (!document.body || readerOpen()) return;
    try {
      var t = (document.body.innerText || '').length;
      if (t > 800 && document.body.innerHTML.length < 4000000) {
        if (!pageSnapshot || t > pageSnapshot.textLen * 1.2) {
          pageSnapshot = { html: document.body.innerHTML, textLen: t };
          log('blank', 'article snapshot taken (' + t + ' chars)');
        }
      }
    } catch (e) {}
  }
  function restoreSnapshot() {
    if (!pageSnapshot || blankRestores >= 3) return;
    blankRestores++;
    persistRestores();
    try {
      if (!document.body) document.documentElement.appendChild(document.createElement('body'));
      document.body.innerHTML = pageSnapshot.html;
      log('blank', 'PAGE WAS BLANKED — article restored from snapshot (restore #' + blankRestores + ')');
      scheduleWallScan(300);
    } catch (e) { log('blank', 'restore failed: ' + e.message); }
  }
  function bodyStyleGuard() {
    [document.documentElement, document.body].forEach(function (el) {
      if (!el) return;
      try {
        var cs = getComputedStyle(el);
        if (cs.display === 'none') { el.style.setProperty('display', 'block', 'important'); log('blank', 'forced ' + el.tagName + ' display back on'); }
        if (cs.visibility === 'hidden') { el.style.setProperty('visibility', 'visible', 'important'); log('blank', 'forced ' + el.tagName + ' visibility back on'); }
        if (parseFloat(cs.opacity) === 0) { el.style.setProperty('opacity', '1', 'important'); log('blank', 'forced ' + el.tagName + ' opacity back on'); }
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
      if (isBrOwned(el) || (el.getAttribute && el.getAttribute('data-br-wall'))) continue;
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
      if (isVeil({ coverPct: cover, positioned: true, textLen: text.trim().length, hasInteractive: interactive, bgOpaque: bgOpaque })) {
        log('blank', 'VEIL detected ' + describeEl(el) + ' bg=' + bg + ' cover=' + Math.round(cover) + '%');
        breakWall(el, { reasons: ['blank veil: opaque, textless, full-screen, no interactive content'] });
        return;
      }
    }
  }
  /* When restoring keeps losing, stop playing in the wiper's
   * reach: hand the article to the reader, whose overlay is
   * the sanctuary (its own DOM, its own watchdog). The
   * sanitized snapshot article rides along as a fallback for
   * when the reader's own extraction has nothing cached. */
  function askSanctuary() {
    if (sanctuaryAsked) return;
    sanctuaryAsked = true;
    try { sessionStorage.setItem('br_sanctuary', '1'); } catch (e) {}
    try {
      var html = sanctuaryArticleHTML(pageSnapshot.html, new DOMParser());
      if (html && html.length <= 2000000) sessionStorage.setItem('br_sanctuary_html', html);
    } catch (e) {}
    log('blank', 'SANCTUARY requested — page stayed blank after ' + blankRestores + ' restores; the reader takes the article from here');
  }
  var watchdogTicks = 0;
  setInterval(function () {
    watchdogTicks++;
    if (watchdogTicks > 160 || !enabled) return;
    if (readerOpen()) return;
    // Blank handling runs whenever a snapshot exists (v1.8:
    // the hostile gate left v1.7 with nothing to restore on
    // gamesradar). The guards below stay hostile-only.
    if (pageSnapshot && !sanctuaryAsked) {
      var cur = 0, kids = -1;
      try { cur = document.body ? (document.body.innerText || '').length : 0; } catch (e) {}
      try { kids = document.body ? document.body.children.length : -1; } catch (e) {}
      var verdict = blankVerdict({ hasBody: !!document.body, bodyChildren: kids, curText: cur, snapText: pageSnapshot.textLen, restores: blankRestores });
      if (verdict === 'restore') restoreSnapshot();
      else if (verdict === 'sanctuary') askSanctuary();
      else if (blankRestores > 0) { blankRestores = 0; persistRestores(); } // page healthy again — debt forgiven
    }
    if (!isHostile() || !document.body) return;
    bodyStyleGuard();
    if (watchdogTicks % 2 === 0) veilScan();
  }, 750);

  /* Sweeps + observer. */
  function armSweeps() {
    [400, 1200, 2500, 5000, 9000, 15000, 25000, 40000].forEach(function (t) {
      setTimeout(wallScan, t);
    });
    try {
      var obsTimer = null;
      var observer = new MutationObserver(function () {
        clearTimeout(obsTimer);
        obsTimer = setTimeout(function () { scheduleWallScan(400); }, 350);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.body) armSweeps();
  else document.addEventListener('DOMContentLoaded', armSweeps);
})(typeof window !== 'undefined' ? window : globalThis);
