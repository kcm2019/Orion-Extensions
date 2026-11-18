/* uBlock for Orion — content script (document_start, all frames).
 * Layers applied here, all independent of the background page:
 *  - cosmetic filters as grouped <style> rules, re-applied if a site strips them
 *  - scriptlets: page-world ones via page-hook.js, DOM ones (remove-attr,
 *    remove-class, href-sanitizer) directly here
 *  - fallback element blocking (I): MutationObserver removes script/img/
 *    iframe elements pointing at ||domain^ hosts before most of them load
 *    (parser-inserted scripts can still race it — same class of gap as the
 *    Popup Blocker's iframe race, logged honestly in the README)
 *  - per-site switches (C): noLargeMedia (click-to-play), noJS
 *    (beforescriptexecute + script stripping), plus the page-side switches
 *    handed to the hook
 *  - YouTube fixes (J)
 *  - shield pill + per-site panel (top frame only; the dashboard is a tab,
 *    because browser_action popups do not render on Kurt's Orion)
 * Everything is counted and batched into the shared Logger (B).
 */
(function () {
  'use strict';
  var E = self.UBOEngine, S = self.UBOStore, R = self.UBOResources;
  var api = (typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null));
  var host = location.hostname;
  var isTop = window.top === window;
  // K stealth: per-page random element IDs — no fixed fingerprint for a
  // detector script to query.
  var RAND = Math.random().toString(36).slice(2, 9);
  var counts = { cosmetic: 0, scriptlets: 0, fallback: 0, elements: 0, ytAds: 0, switchBlocked: 0, redirects: 0 };
  var pendingLog = [], logTimer = null;

  function log(layer, action, detail, url) {
    pendingLog.push({ t: Date.now(), layer: layer, action: action, url: url || location.href, host: host, detail: detail || '' });
    if (pendingLog.length >= 20) flushLog();
    else if (!logTimer) logTimer = setTimeout(flushLog, 5000);
  }
  function flushLog() {
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    if (!pendingLog.length) return;
    var entries = pendingLog; pendingLog = [];
    S.appendLog(entries).catch(function () {});
    updatePill();
  }
  window.addEventListener('ubo-orion-event', function (ev) {
    var msg; try { msg = JSON.parse(ev.detail); } catch (e) { return; }
    if (msg.kind === 'fallback-block') { counts.fallback++; log('fallback', 'blocked', 'page-world request hook', msg.detail); }
    else if (msg.kind === 'redirect-stub') { counts.redirects++; log('fallback', 'redirected', msg.detail); }
    else if (msg.kind === 'switch-block') { counts.switchBlocked++; log('switch', 'blocked', msg.detail); }
    else if (msg.kind === 'scriptlet') log('scriptlet', 'applied', msg.detail);
    else if (msg.kind === 'scriptlet-unsupported') log('scriptlet', 'unsupported', msg.detail);
    else if (msg.kind === 'scriptlet-error') log('scriptlet', 'error', msg.detail);
    updatePill();
  });

  function hostInSet(set, h) {
    var parts = h.split('.');
    for (var i = 0; i < parts.length; i++) if (set[parts.slice(i).join('.')]) return true;
    return false;
  }

  S.getSettings().then(function (settings) {
    var site = S.perSiteFor(settings, host);
    var disabled = !settings.enabled || !!site.disabled;
    return S.getLarge('compiled').then(function (compiled) {
      return { settings: settings, site: site, disabled: disabled, compiled: compiled };
    }).catch(function () {
      return { settings: settings, site: site, disabled: disabled, compiled: null };
    });
  }).then(function (ctx) {
    var settings = ctx.settings, site = ctx.site, compiled = ctx.compiled;
    if (isTop) buildPill(ctx);
    if (ctx.disabled) { log('content', 'info', 'disabled for this site'); return; }
    if (!compiled) {
      if (isTop) log('content', 'info', 'no filter lists downloaded yet — open the dashboard to fetch them');
      return;
    }

    var scriptlets = E.scriptletsFor(compiled, host);
    var domScriptlets = scriptlets.filter(function (c) {
      return ['remove-attr', 'remove-class', 'href-sanitizer'].indexOf(c.name) !== -1;
    });
    var pageScriptlets = scriptlets.filter(function (c) {
      return ['remove-attr', 'remove-class', 'href-sanitizer'].indexOf(c.name) === -1;
    });
    // v1.2.3: the v1.2 built-in duplicate YouTube scriptlets are REMOVED.
    // The lists already carry these exact scriptlets (v1.1 proved the
    // list-only set works — ads gone, site intact); the duplicates
    // double-wrapped YouTube's JSON/fetch handling and are a prime
    // suspect in the black-screen app shell. The seek/skip handler
    // (the actual v1.2 fix) stays.
    // v1.2.4 LIGHT-TOUCH platforms (Kurt's call: "less aggressive"):
    // YouTube stayed a black shell and X is the same class of fragile,
    // JSON-driven app — so on YouTube / X / Twitter, NO page-world
    // scriptlets run at all (no json-prune / trusted-replace /
    // set-constant rewriting of the app's own data). What remains:
    // network-layer ad-domain blocking, cosmetics, the element
    // fallback, and on YouTube the seek/skip ad handler — the parts
    // that cannot corrupt the app's data path.
    var LIGHT_TOUCH = /(^|\.)youtube(-nocookie)?\.com$/.test(host) || /(^|\.)(x\.com|twitter\.com)$/.test(host);
    if (LIGHT_TOUCH) {
      pageScriptlets = [];
      log('content', 'info', 'light-touch platform: page scriptlets off for ' + host);
    }
    counts.scriptlets = scriptlets.length;

    // ---- inject page hook with config ----
    var blockSet = {};
    compiled.blockDomains.forEach(function (d) { blockSet[d] = 1; });
    // K: page-world stub serving for the best-known detector scripts
    var redirectStubs = [];
    if (R) {
      [['fuckadblock', 'fuckadblock'], ['blockadblock', 'fuckadblock'],
       ['adsbygoogle', 'adsbygoogle'], ['ima3.js', 'google-ima']].forEach(function (pair) {
        var st = R.stubFor(pair[1], 'script');
        if (st) redirectStubs.push({ needle: pair[0], key: st.key, text: st.text, mime: st.mime });
      });
    }
    try {
      var cfgEl = document.createElement('script');
      cfgEl.id = 'c-' + RAND;
      cfgEl.setAttribute('data-ubo-cfg', '1');
      cfgEl.type = 'application/json';
      cfgEl.textContent = JSON.stringify({
        blockDomains: compiled.blockDomains,
        scriptlets: pageScriptlets,
        redirectStubs: redirectStubs,
        switches: { noPopups: !!site.noPopups, noRemoteFonts: !!site.noRemoteFonts },
        host: host
      });
      var hook = document.createElement('script');
      hook.src = api.runtime.getURL('page-hook.js');
      (document.documentElement || document).appendChild(cfgEl);
      (document.documentElement || document).appendChild(hook);
      hook.addEventListener('load', function () { hook.remove(); });
    } catch (e) { log('content', 'error', 'page-hook inject: ' + e.message); }

    // ---- cosmetics ----
    var sels = E.cosmeticsFor(compiled, host);
    // v1.2.4: on YouTube, generic cosmetics are dropped too — only
    // selectors written specifically for YouTube apply (plus our own
    // YT_COSMETICS below). One over-broad generic selector hiding a
    // structural container is the other black-screen shape.
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
      var excAll = {};
      (compiled.cosExcGeneric || []).forEach(function (s) { excAll[s] = 1; });
      E.hostSuffixes(host).forEach(function (sfx) {
        (compiled.cosExcSpecific[sfx] || []).forEach(function (s) { excAll[s] = 1; });
      });
      var specOnly = [];
      E.hostSuffixes(host).forEach(function (sfx) {
        (compiled.cosSpecific[sfx] || []).forEach(function (s) {
          if (!excAll[s] && !E.targetsRoot(s)) specOnly.push(s);
        });
      });
      sels = specOnly;
    }
    if (settings.ytFixes && /(^|\.)youtube\.com$/.test(host)) sels = sels.concat(YT_COSMETICS);
    counts.cosmetic = sels.length;
    applyCosmetics(sels);

    // ---- observers: fallback elements, DOM scriptlets, switches ----
    var observer = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes && Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType === 1) scanNode(n, blockSet, site, domScriptlets);
        });
      });
      runDomScriptlets(domScriptlets);
    });
    function startObservers() {
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        scanNode(document.documentElement, blockSet, site, domScriptlets);
        runDomScriptlets(domScriptlets);
      }
    }
    if (document.documentElement) startObservers();
    else document.addEventListener('DOMContentLoaded', startObservers);

    // C: noJS — Firefox's beforescriptexecute plus stripping
    if (site.noJS) {
      document.addEventListener('beforescriptexecute', function (ev) {
        ev.preventDefault(); counts.switchBlocked++;
        log('switch', 'blocked', 'noJS: script execution prevented');
      }, true);
    }

    // J: YouTube ad handling on top of the Quick Fixes list
    if (settings.ytFixes && /(^|\.)youtube\.com$/.test(host)) startYouTubeFixes();

    // diagnostics for the dashboard: which layers were live on this page
    if (isTop) {
      S.set('diag:lastPage', {
        t: Date.now(), host: host, counts: counts,
        scriptlets: scriptlets.length, cosmetics: sels.length,
        blockDomains: compiled.blockDomains.length
      }).catch(function () {});
    }
    log('content', 'info', 'layers on: cosmetics ' + sels.length + ', scriptlets ' + scriptlets.length + ', fallback domains ' + compiled.blockDomains.length);
  }).catch(function (err) {
    // never break the page because the blocker failed
    try { console.warn('[uBlock for Orion] content init failed:', err); } catch (e) {}
  });

  /* ---------------- cosmetics ---------------- */
  var styleEl = null;
  function applyCosmetics(sels) {
    if (!sels.length) return;
    var css = '';
    for (var i = 0; i < sels.length; i += 250) {
      css += sels.slice(i, i + 250).join(',\n') + ' { display: none !important; }\n';
    }
    function insert() {
      if (styleEl && styleEl.isConnected) return;
      styleEl = document.createElement('style');
      styleEl.id = 's-' + RAND;
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    if (document.documentElement) insert();
    document.addEventListener('DOMContentLoaded', insert);
    setInterval(insert, 3000); // sites that strip blocker styles get them back
  }

  /* ---------------- per-node work ---------------- */
  function scanNode(node, blockSet, site, domScriptlets) {
    var nodes = [node];
    if (node.querySelectorAll) nodes = nodes.concat(Array.prototype.slice.call(node.querySelectorAll('script,img,iframe,video,audio,source,link')));
    nodes.forEach(function (n) {
      var tag = n.tagName;
      if (!tag) return;
      var url = n.src || n.href || '';
      // I: fallback element blocking. v1.2.3: LINK elements are never
      // removed (a domain-only match cannot tell a site's stylesheet
      // from an ad — this is what stripped GitHub's CSS), and neither
      // is anything served from the page's own party (its CDN hosts
      // included).
      if (url && ['SCRIPT', 'IMG', 'IFRAME', 'SOURCE'].indexOf(tag) !== -1) {
        try {
          var h = new URL(url, location.href).hostname;
          if (h && h !== host && !E.samePartyHost(h, host) && hostInSet(blockSet, h)) {
            n.remove(); counts.elements++; counts.fallback++;
            log('fallback', 'blocked', 'element <' + tag.toLowerCase() + '> removed', url);
            return;
          }
        } catch (e) {}
      }
      // C: noJS element side
      if (site.noJS && tag === 'SCRIPT') { n.remove(); counts.switchBlocked++; return; }
      // C: noLargeMedia — click-to-play
      if (site.noLargeMedia && (tag === 'VIDEO' || tag === 'AUDIO') && !n.__uboHeld) {
        n.__uboHeld = true;
        try { n.pause(); } catch (e) {}
        n.removeAttribute('autoplay'); n.preload = 'none';
        n.title = 'Held by uBlock for Orion (no large media) — tap to play';
        n.addEventListener('click', function () { try { n.play(); } catch (e) {} }, { once: true });
        counts.switchBlocked++;
        log('switch', 'blocked', 'noLargeMedia: media held for click');
      }
    });
  }
  function runDomScriptlets(calls) {
    calls.forEach(function (call) {
      try {
        if (call.name === 'remove-attr') {
          var attr = call.args[0], sel = call.args[1] || '*';
          document.querySelectorAll(sel).forEach(function (el) { el.removeAttribute(attr); });
        } else if (call.name === 'remove-class') {
          var cls = call.args[0], sel2 = call.args[1] || '*';
          document.querySelectorAll(sel2).forEach(function (el) { el.classList.remove(cls); });
        } else if (call.name === 'href-sanitizer') {
          var param = (call.args[0] || '').replace(/^\?/, ''), sel3 = call.args[1] || 'a[href]';
          document.querySelectorAll(sel3).forEach(function (a) {
            try {
              var u = new URL(a.href);
              if (param && u.searchParams.has(param)) { u.searchParams.delete(param); a.href = u.toString(); }
            } catch (e) {}
          });
        }
      } catch (e) {}
    });
  }

  /* ---------------- YouTube (J) ---------------- */
  var YT_COSMETICS = [
    'ytd-ad-slot-renderer', 'ytd-display-ad-renderer', 'ytd-promoted-sparkles-web-renderer',
    'ytd-in-feed-ad-layout-renderer', '#player-ads', '.ytp-ad-overlay-container',
    'ytd-banner-promo-renderer', 'ytd-mealbar-promo-renderer', '#masthead-ad'
  ];
  var SKIP_SELECTORS = [
    '.ytp-skip-ad-button', 'button.ytp-ad-skip-button-modern', '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button', '.ytp-skip-ad-button-container button',
    '[class*="ytp-ad-skip"] button', 'button[class*="skip-ad"]'
  ];
  function fullClick(el) {
    // YouTube's player listens for the full pointer/mouse sequence on some
    // builds; a bare .click() on the container is ignored. Fire everything,
    // on the innermost button.
    try {
      var rect = el.getBoundingClientRect();
      var opts = { bubbles: true, cancelable: true, view: window,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      if (window.PointerEvent) {
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
      }
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      el.click();
    } catch (e) { try { el.click(); } catch (e2) {} }
  }
  function findSkipButton() {
    for (var i = 0; i < SKIP_SELECTORS.length; i++) {
      var els = document.querySelectorAll(SKIP_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        // the countdown ("Skip in 5…") element matches some selectors but
        // is not yet a button — visibility + enabled checks sort that out
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        if (el.clientWidth === 0 && el.clientHeight === 0) continue;
        if ((el.textContent || '').match(/skip in/i)) continue;
        return el;
      }
    }
    return null;
  }
  function startYouTubeFixes() {
    var adState = null;      // {rate, muted} of the main video, pre-ad
    var adKey = null;        // identifies the current ad segment (src+duration)
    var adSince = 0, clickedAt = 0, seekedKey = null;
    function tick() {
      var player = document.querySelector('.ad-showing, .ad-interrupting');
      var video = document.querySelector('#movie_player video, .html5-video-player video');
      if (!player || !video) {
        if (adState && video) {
          video.playbackRate = adState.rate; video.muted = adState.muted;
        }
        adState = null; adKey = null; clickedAt = 0;
        return;
      }
      if (!adState) adState = { rate: video.playbackRate || 1, muted: video.muted };
      video.muted = true;
      var key = (video.currentSrc || video.src || '') + '|' + (isFinite(video.duration) ? Math.round(video.duration) : '?');
      if (key !== adKey) { adKey = key; adSince = Date.now(); clickedAt = 0; }
      counts.ytAds++;

      // 1) Seek to the end of the ad first — for the great majority of
      //    pre/mid-roll ads this ends the ad immediately, skippable or
      //    not, without waiting out the "Skip in 5" countdown. (v1.1
      //    waited for the skip button and only fast-forwarded the rest,
      //    which is why some ads still demanded a manual Skip.)
      if (isFinite(video.duration) && video.duration > 0 && video.duration <= 900) {
        video.playbackRate = 16;
        if (video.duration - video.currentTime > 0.35) {
          try { video.currentTime = video.duration - 0.2; } catch (e) {}
          if (seekedKey !== key) {
            seekedKey = key;
            log('youtube', 'blocked', 'ad seeked to end (' + Math.round(video.duration) + 's ad)');
          }
          return;
        }
      } else {
        video.playbackRate = 16;
      }
      // 2) Skip button as the verified second punch: click it properly,
      //    and if the ad is somehow still up 1.2s later, click again.
      var skip = findSkipButton();
      if (skip && Date.now() - clickedAt > 1200) {
        clickedAt = Date.now();
        fullClick(skip);
        log('youtube', 'blocked', 'ad skip button clicked');
      }
    }
    setInterval(tick, 250);
    // React the moment the player flips into an ad, not up to 250ms later.
    var mo = new MutationObserver(function () { tick(); });
    function armObserver() {
      var p = document.querySelector('#movie_player, .html5-video-player');
      if (p) mo.observe(p, { attributes: true, attributeFilter: ['class'] });
      else setTimeout(armObserver, 1000);
    }
    armObserver();
  }

  /* ---------------- shield pill + panel (top frame) ---------------- */
  var pillEl = null, pillCount = null, panelEl = null;
  function totalCount() { return counts.fallback + counts.elements + counts.ytAds + counts.switchBlocked + counts.redirects; }
  function updatePill() { if (pillCount) pillCount.textContent = String(totalCount()); }
  function buildPill(ctx) {
    if (!ctx.settings.pill) return;
    var rootEl = document.createElement('div');
    rootEl.id = 'p-' + RAND;
    // closed shadow root: page scripts cannot inspect the pill's internals
    var shadow = rootEl.attachShadow ? rootEl.attachShadow({ mode: 'closed' }) : rootEl;
    shadow.innerHTML =
      '<style>' +
      '.pill{position:fixed;right:10px;bottom:86px;z-index:2147483647;background:rgba(20,20,24,.88);color:#fff;' +
      'border-radius:999px;padding:7px 11px;font:600 13px -apple-system,system-ui,sans-serif;display:flex;gap:6px;align-items:center;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;-webkit-backdrop-filter:blur(8px)}' +
      '.pill.off{opacity:.55}.n{background:#e74c3c;border-radius:999px;padding:0 6px;font-size:12px}' +
      '.panel{position:fixed;right:10px;bottom:130px;z-index:2147483647;width:270px;background:rgba(24,24,30,.97);color:#fff;' +
      'border-radius:14px;padding:14px;font:14px -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)}' +
      '.panel h3{margin:0 0 4px;font-size:15px}.panel .host{opacity:.7;font-size:12px;margin-bottom:10px;word-break:break-all}' +
      '.row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,.12)}' +
      '.panel button{background:#0a84ff;color:#fff;border:0;border-radius:8px;padding:7px 10px;font-size:13px;width:100%;margin-top:10px}' +
      '.panel button.ghost{background:rgba(255,255,255,.14)}' +
      'input[type=checkbox]{width:20px;height:20px;accent-color:#0a84ff}' +
      '.stat{font-size:12px;opacity:.8;line-height:1.5}' +
      '</style>' +
      '<div class="pill" id="pill">🛡️<span class="n" id="n">0</span></div>' +
      '<div class="panel" id="panel" style="display:none"></div>';
    function mount() { (document.body || document.documentElement).appendChild(rootEl); }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    pillEl = shadow.getElementById('pill'); pillCount = shadow.getElementById('n'); panelEl = shadow.getElementById('panel');
    if (ctx.disabled) pillEl.classList.add('off');
    pillEl.addEventListener('click', function () { togglePanel(ctx); });
    updatePill();
  }
  function togglePanel(ctx) {
    if (!panelEl) return;
    if (panelEl.style.display !== 'none') { panelEl.style.display = 'none'; return; }
    S.getSettings().then(function (settings) {
      var site = S.perSiteFor(settings, host);
      var rows = [
        ['enabled', 'Block on this site', !site.disabled],
        ['noPopups', 'No popups', !!site.noPopups],
        ['noLargeMedia', 'No large media', !!site.noLargeMedia],
        ['noRemoteFonts', 'No remote fonts', !!site.noRemoteFonts],
        ['noJS', 'Disable JavaScript', !!site.noJS]
      ];
      panelEl.innerHTML = '<h3>uBlock for Orion</h3><div class="host">' + host + '</div>' +
        rows.map(function (r) {
          return '<label class="row"><span>' + r[1] + '</span><input type="checkbox" data-k="' + r[0] + '"' + (r[2] ? ' checked' : '') + '></label>';
        }).join('') +
        '<div class="stat">This page: ' + totalCount() + ' blocked · cosmetics ' + counts.cosmetic + ' · scriptlets ' + counts.scriptlets + '</div>' +
        '<button id="dash">Open dashboard</button>' +
        '<button class="ghost" id="close">Close</button>';
      panelEl.style.display = 'block';
      panelEl.querySelectorAll('input[type=checkbox]').forEach(function (input) {
        input.addEventListener('change', function () {
          var key = input.getAttribute('data-k'), checked = input.checked;
          S.getSettings().then(function (s2) {
            s2.perSite = s2.perSite || {};
            var entry = Object.assign({}, s2.perSite[host] || {});
            if (key === 'enabled') entry.disabled = !checked; else entry[key] = checked;
            s2.perSite[host] = entry;
            return S.saveSettings(s2);
          }).then(function () { location.reload(); });
        });
      });
      panelEl.querySelector('#dash').addEventListener('click', function () {
        try { api.runtime.sendMessage({ kind: 'openDashboard' }); } catch (e) {}
        try { window.open(api.runtime.getURL('dashboard.html'), '_blank'); } catch (e) {}
      });
      panelEl.querySelector('#close').addEventListener('click', function () { panelEl.style.display = 'none'; });
    });
  }
})();
