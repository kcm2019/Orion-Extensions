/* uBlock for Orion — background: blocking webRequest layer + auto-update.
 * This is the layer that may be dead on Orion (it is the same API whose
 * breakage disabled real uBlock Origin). Everything here therefore writes
 * diagnostics to storage: the dashboard's Diagnostics tab shows whether the
 * listener registered, whether it ever fired, and whether a cancel ever
 * happened. If it never fires, the content-layer fallback (I) is what is
 * actually protecting pages, and the Logger says so per entry.
 */
(function () {
  'use strict';
  var E = self.UBOEngine, S = self.UBOStore, U = self.UBOUpdater, R = self.UBOResources;
  var api = (typeof browser !== 'undefined' && browser.webRequest) ? browser
          : (typeof chrome !== 'undefined' ? chrome : null);

  var matcher = null, settings = null, counts = {};
  var diag = {
    startedAt: Date.now(), listenerRegistered: false, listenerError: null,
    headersRegistered: false, fired: 0, cancelled: 0,
    lastFiredAt: null, lastCancelledAt: null, compiledAt: null, listsUsed: []
  };
  var logBuf = [], logTimer = null;

  function saveDiag() { S.set('diag:background', diag).catch(function () {}); }
  function bufferLog(entry) {
    logBuf.push(entry);
    if (logBuf.length >= 25) flushLog();
    else if (!logTimer) logTimer = setTimeout(flushLog, 4000);
  }
  function flushLog() {
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    if (!logBuf.length) return;
    var entries = logBuf; logBuf = [];
    S.appendLog(entries).catch(function () {});
  }
  function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

  function reload() {
    return S.getSettings().then(function (s) {
      settings = s;
      return S.getLarge('compiled').then(function (compiled) {
        if (compiled) {
          matcher = E.createMatcher(compiled);
          return S.get('compiledMeta').then(function (m) {
            diag.compiledAt = m && m.builtAt; diag.listsUsed = (m && m.listsUsed) || [];
            saveDiag();
          });
        }
        matcher = null;
      }).catch(function (err) { diag.listenerError = 'compiled load: ' + err.message; saveDiag(); });
    });
  }

  function docHostOf(details) {
    return hostOf(details.originUrl || details.documentUrl || details.initiator || '');
  }

  // v1.2.2: top-level navigations are NEVER intercepted — the wrapper
  // returns before any matching happens, so no filter, matcher bug or
  // slow regex can ever stop a page the user asked for (the v1.2/1.2.1
  // "navigation silently does nothing" failure). $document-type
  // filters are the accepted cost. Any error anywhere else in the
  // listener also fails open.
  function onBeforeRequest(details) {
    if (details && details.type === 'main_frame') return {};
    try { return onBeforeRequestInner(details); }
    catch (e) { return {}; }
  }
  function onBeforeRequestInner(details) {
    diag.fired++; diag.lastFiredAt = Date.now();
    if (diag.fired % 50 === 0) saveDiag();
    if (!settings || !settings.enabled || !matcher) return {};
    if (details.url.indexOf('moz-extension:') === 0 || details.url.indexOf('chrome-extension:') === 0) return {};
    var docHost = docHostOf(details);
    var site = S.perSiteFor(settings, docHost);
    if (site.disabled) return {};
    var type = E.mapType(details.type || 'other');
    // C: per-site switches handled at the network layer when available
    if (site.noRemoteFonts && type === 'font') {
      noteBlock(details, docHost, 'switch:noRemoteFonts');
      return { cancel: true };
    }
    var res;
    try {
      res = matcher.match({
        url: details.url, host: hostOf(details.url), type: details.type || 'other', docHost: docHost
      });
    } catch (e) { return {}; } // v1.2.1: fail OPEN on any matcher error
    // v1.2.1 hotfix: a top-level navigation may only be blocked or
    // redirected by a filter that explicitly carries the $document type.
    // A plain filter matching the page's own URL must never stop the
    // page itself from loading (the v1.2 total-breakage class).
    if (res.blocked && details.type === 'main_frame' && !res.explicitDocument) {
      bufferLog({ t: Date.now(), layer: 'webRequest', action: 'allowed', url: details.url, host: docHost, detail: 'main_frame guard: ' + res.filter });
      return {};
    }
    // v1.2.3 visuals guards: generic (non-domain) filters were breaking
    // sites' own assets — GitHub rendered with no CSS at all. A site's
    // stylesheets/fonts and its same-party requests (incl. its CDN
    // hosts) may now only be blocked by a filter written for that exact
    // host, or an $important one. Third-party ad/tracker requests are
    // unaffected.
    if (res.blocked && !res.important) {
      var reqHost = hostOf(details.url);
      var mapped = E.mapType(details.type || 'other');
      if ((mapped === 'stylesheet' || mapped === 'font') && !res.bucketed) {
        bufferLog({ t: Date.now(), layer: 'webRequest', action: 'allowed', url: details.url, host: docHost, detail: 'visuals guard (generic filter vs ' + mapped + '): ' + res.filter });
        return {};
      }
      if (docHost && E.samePartyHost(reqHost, docHost)) {
        // v1.2.4: same-party MEDIA (video/image/css/font) is protected
        // even from domain-bucketed filters — platforms serve media
        // from shared branded hosts (video.twimg.com, googlevideo)
        // where one broad list rule otherwise kills every video.
        // Other same-party types still need a non-bucketed filter to
        // be spared.
        var mediaLike = ['media', 'image', 'stylesheet', 'font'].indexOf(mapped) !== -1;
        if (mediaLike || !res.bucketed) {
          bufferLog({ t: Date.now(), layer: 'webRequest', action: 'allowed', url: details.url, host: docHost, detail: 'visuals guard (same-party' + (mediaLike ? ' media' : '') + '): ' + res.filter });
          return {};
        }
      }
    }
    if (res.blocked) {
      // K: $redirect — serve an inert stub instead of cancelling, so the
      // page's detector code loads something and sees no blocker.
      if (res.redirect) {
        var du = R && R.dataUrl(res.redirect, type);
        if (du) {
          noteBlock(details, docHost, res.filter + ' → $redirect=' + res.redirect, 'redirected');
          return { redirectUrl: du };
        }
        noteBlock(details, docHost, res.filter + ' ($redirect resource unsupported: ' + res.redirect + ')');
        return { cancel: true };
      }
      noteBlock(details, docHost, res.filter);
      return { cancel: true };
    }
    return {};
  }
  function noteBlock(details, docHost, filter, action) {
    diag.cancelled++; diag.lastCancelledAt = Date.now(); saveDiag();
    if (details.tabId >= 0) {
      counts[details.tabId] = (counts[details.tabId] || 0) + 1;
      try {
        api.browserAction.setBadgeText({ tabId: details.tabId, text: String(counts[details.tabId]) });
        api.browserAction.setBadgeBackgroundColor({ color: '#c0392b' });
      } catch (e) {}
    }
    bufferLog({
      t: Date.now(), layer: 'webRequest', action: action || 'blocked',
      url: details.url, host: docHost, detail: filter
    });
  }

  function onHeadersReceived(details) {
    if (!settings || !settings.enabled) return {};
    var docHost = docHostOf(details) || hostOf(details.url);
    var site = S.perSiteFor(settings, docHost);
    var out = {};
    // C: no large media — cancel big media/image responses at the header stage
    if (site.noLargeMedia && ['media', 'image'].indexOf(E.mapType(details.type || '')) !== -1) {
      var len = 0;
      (details.responseHeaders || []).forEach(function (h) {
        if (h.name.toLowerCase() === 'content-length') len = parseInt(h.value, 10) || 0;
      });
      if (len > 51200) {
        bufferLog({ t: Date.now(), layer: 'webRequest', action: 'blocked', url: details.url, host: docHost, detail: 'switch:noLargeMedia ' + len + 'B' });
        return { cancel: true };
      }
    }
    // C: disable JavaScript — CSP on the main document
    if (site.noJS && details.type === 'main_frame') {
      var headers = (details.responseHeaders || []).filter(function (h) {
        return h.name.toLowerCase() !== 'content-security-policy';
      });
      headers.push({ name: 'Content-Security-Policy', value: "script-src 'none'" });
      out.responseHeaders = headers;
      bufferLog({ t: Date.now(), layer: 'webRequest', action: 'blocked', url: details.url, host: docHost, detail: 'switch:noJS (CSP)' });
    }
    return out;
  }

  function register() {
    if (!api || !api.webRequest) { diag.listenerError = 'webRequest API not exposed'; saveDiag(); return; }
    try {
      api.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ['<all_urls>'] }, ['blocking']);
      diag.listenerRegistered = true;
    } catch (e) { diag.listenerError = 'onBeforeRequest: ' + e.message; }
    try {
      api.webRequest.onHeadersReceived.addListener(onHeadersReceived, { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders']);
      diag.headersRegistered = true;
    } catch (e) { diag.listenerError = (diag.listenerError ? diag.listenerError + '; ' : '') + 'onHeadersReceived: ' + e.message; }
    saveDiag();
  }

  function openDashboard() {
    var url = (api.runtime.getURL ? api.runtime.getURL('dashboard.html') : 'dashboard.html');
    if (api.tabs && api.tabs.create) api.tabs.create({ url: url });
  }

  function init() {
    register();
    if (api && api.browserAction && api.browserAction.onClicked) {
      // No default_popup on purpose: popups do not render on Kurt's Orion.
      api.browserAction.onClicked.addListener(openDashboard);
    }
    if (api && api.storage && api.storage.onChanged) {
      api.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        var keys = Object.keys(changes);
        if (keys.some(function (k) { return k === 'settingsV1' || k.indexOf('compiled') === 0; })) reload();
      });
    }
    if (api && api.tabs && api.tabs.onRemoved) {
      api.tabs.onRemoved.addListener(function (tabId) { delete counts[tabId]; });
    }
    if (api && api.runtime && api.runtime.onMessage) {
      api.runtime.onMessage.addListener(function (msg) {
        if (!msg) return;
        if (msg.kind === 'reload') reload();
        if (msg.kind === 'openDashboard') openDashboard();
      });
    }
    reload().then(function () {
      // v1.2.1: if the compiled set was built by an older engine, rebuild
      // it once from the stored lists so engine fixes apply immediately.
      S.localGet(['engineStamp']).then(function (o) {
        if (o.engineStamp !== '1.2.4' && settings) {
          U.rebuildCompiled(settings).then(function () {
            return S.localSet({ engineStamp: '1.2.4' });
          }).then(function () { reload(); }).catch(function () {});
        }
      }).catch(function () {});
      // Auto-update: background path. The dashboard repeats this check when
      // opened, because this page may never run on Orion.
      if (settings && settings.autoUpdate && settings.enabled) {
        U.updateAll(settings, false).then(function (results) {
          var did = results.some(function (r) { return r.ok && !r.skipped; });
          if (did) reload();
        }).catch(function () {});
      }
    });
    saveDiag();
  }

  init();
})();
