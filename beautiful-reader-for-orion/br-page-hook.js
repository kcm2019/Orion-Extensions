/* br-page-hook.js — runs in the PAGE world (injected by content.js at
 * document_start). Layer 2 of the wall: when the overlay is killed,
 * Admiral-style scripts fall back to a native confirm() —
 *   "Please allow ads on this site. Click OK to learn more."
 * OK would redirect to the wall page; Cancel makes their script
 * reload the page. Both branches are poison, so for wall-matching
 * dialogs this hook:
 *   - confirm/prompt: THROWS, aborting the caller's script before
 *     either branch can run;
 *   - alert: silently swallows (nothing branches on alert's return);
 *   - swallows location.reload() for 15 s after a suppressed dialog
 *     (in case their code catches the throw and reloads anyway);
 *   - blocks location.assign/replace to known wall domains.
 * Non-matching dialogs pass through to the real browser UI untouched.
 */
(function () {
  'use strict';
  if (window.__brHookInstalled) return;
  window.__brHookInstalled = true;

  var PHRASES = ['allow ads', 'adblock', 'ad blocker', 'ad-blocker',
    'disable your ad', 'turn off your ad', 'whitelist this site',
    'allowlist this site', 'please allow ads'];
  var WALL_HOSTS = ['error-report.com', 'getadmiral.com', 'admiral.digital'];

  function isWallDialog(msg) {
    var t = String(msg == null ? '' : msg).toLowerCase();
    if (!t) return '';
    for (var i = 0; i < PHRASES.length; i++) {
      if (t.indexOf(PHRASES[i]) !== -1) return PHRASES[i];
    }
    return '';
  }
  function isWallUrl(u) {
    var s = String(u || '').toLowerCase();
    for (var i = 0; i < WALL_HOSTS.length; i++) {
      if (s.indexOf(WALL_HOSTS[i]) !== -1) return WALL_HOSTS[i];
    }
    return '';
  }
  function report(kind, msg) {
    try { window.postMessage({ __br: kind, msg: String(msg || '').slice(0, 220) }, '*'); } catch (e) {}
  }

  var origConfirm = window.confirm;
  var origAlert = window.alert;
  var origPrompt = window.prompt;

  window.confirm = function (msg) {
    var hit = isWallDialog(msg);
    if (hit) {
      window.__brWallDialogAt = Date.now();
      report('dialog', 'confirm SUPPRESSED (phrase "' + hit + '"), throwing to abort caller: ' + msg);
      throw new Error('Beautiful Reader: wall dialog suppressed');
    }
    return origConfirm.apply(this, arguments);
  };
  window.alert = function (msg) {
    var hit = isWallDialog(msg);
    if (hit) {
      window.__brWallDialogAt = Date.now();
      report('dialog', 'alert SUPPRESSED (phrase "' + hit + '"): ' + msg);
      return undefined;
    }
    return origAlert.apply(this, arguments);
  };
  window.prompt = function (msg) {
    var hit = isWallDialog(msg);
    if (hit) {
      window.__brWallDialogAt = Date.now();
      report('dialog', 'prompt SUPPRESSED (phrase "' + hit + '"), throwing to abort caller: ' + msg);
      throw new Error('Beautiful Reader: wall dialog suppressed');
    }
    return origPrompt.apply(this, arguments);
  };

  /* Navigation guards (best effort — Location is exotic; every patch
   * is attempted in try/catch and the result is reported). */
  var patched = [];
  try {
    var proto = Object.getPrototypeOf(window.location);
    if (proto && proto.reload) {
      var origReload = proto.reload;
      Object.defineProperty(proto, 'reload', {
        configurable: true, writable: true,
        value: function () {
          if (window.__brWallDialogAt && Date.now() - window.__brWallDialogAt < 15000) {
            report('dialog', 'location.reload SWALLOWED (within 15s of a suppressed wall dialog)');
            return undefined;
          }
          return origReload.apply(window.location, arguments);
        }
      });
      patched.push('reload');
    }
    ['assign', 'replace'].forEach(function (name) {
      try {
        if (proto && proto[name]) {
          var orig = proto[name];
          Object.defineProperty(proto, name, {
            configurable: true, writable: true,
            value: function (url) {
              var host = isWallUrl(url);
              if (host) {
                report('dialog', 'location.' + name + ' BLOCKED to wall host ' + host + ': ' + url);
                return undefined;
              }
              return orig.apply(window.location, arguments);
            }
          });
          patched.push(name);
        }
      } catch (e) { report('hook', 'location.' + name + ' patch failed: ' + e.message); }
    });
  } catch (e) {
    report('hook', 'location patch failed: ' + e.message);
  }

  /* The href setter is how most forced redirects happen
   * (location.href = wallUrl). It may be unforgeable — the attempt is
   * in try/catch and the outcome is reported either way. */
  try {
    var desc = Object.getOwnPropertyDescriptor(proto, 'href');
    if (desc && desc.set && desc.configurable) {
      var origSet = desc.set, origGet = desc.get;
      Object.defineProperty(proto, 'href', {
        configurable: true, enumerable: desc.enumerable, get: origGet,
        set: function (url) {
          var host = isWallUrl(url);
          if (host) {
            report('dialog', 'location.href BLOCKED to wall host ' + host + ': ' + url);
            return;
          }
          return origSet.call(window.location, url);
        }
      });
      patched.push('href');
    } else {
      report('hook', 'location.href not patchable (desc=' + (desc ? 'set:' + !!desc.set + ' cfg:' + desc.configurable : 'none') + ')');
    }
  } catch (e) { report('hook', 'location.href patch failed: ' + e.message); }

  /* The kill command (v1.13.0): when the blanking fight has
   * been lost twice, the content side stops restoring and
   * orders the page dead. Every pending page timer is cleared
   * by id sweep (browser timer ids are a shared sequential
   * pool, so the newest id bounds them all), loading stops,
   * and the scheduling functions are neutered so the wall's
   * scripts cannot re-arm. Already-running code keeps its
   * closures but loses its future; the reader then purges the
   * DOM around its own overlay. */
  if (window.addEventListener) {
    window.addEventListener('message', function (e) {
      if (e.source !== window || !e.data || e.data.__br_cmd !== 'kill') return;
      if (window.__brKilled) return;
      window.__brKilled = true;
      try {
        var id = window.setTimeout(function () {}, 0);
        while (id > 0) { window.clearTimeout(id); window.clearInterval(id); id--; }
      } catch (err) {}
      try { window.stop(); } catch (err) {}
      try { window.setTimeout = function () { return 0; }; } catch (err) {}
      try { window.setInterval = function () { return 0; }; } catch (err) {}
      try { window.requestAnimationFrame = function () { return 0; }; } catch (err) {}
      try {
        window.MutationObserver = function () {
          return { observe: function () {}, disconnect: function () {}, takeRecords: function () { return []; } };
        };
      } catch (err) {}
      report('hook', 'page KILLED on sanctuary escalation — timers cleared, scheduling neutered');
    });
  }

  report('hook', 'page hook installed; location patches: ' + (patched.join(',') || 'none'));
  window.__brHook = { isWallDialog: isWallDialog, isWallUrl: isWallUrl };
})();
