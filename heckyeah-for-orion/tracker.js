/* HeckYeah for Orion — tracker (all sites, all frames).
 * ARMED-ONLY (scope 1): exits instantly unless this host — or, inside an
 * iframe, the host that embedded it — was launched from the HeckYeah
 * Video shelf on fmhy.net. The store is re-checked a few times in the
 * first seconds, in case the arm write from the fmhy.net tab lands
 * just after this page's first read.
 * Jobs: record episode/movie visits, save playback position
 * (read-only — never seeks or resumes in-site), detect the
 * next-episode link, show the draggable
 * HeckYeah pill + Recent shows sheet (top frame), and sweep
 * robot-check overlays (top frame, HeckYeah TV v1.46 rules). */
(function () {
  'use strict';
  if (window.__hyoTracker) return;
  window.__hyoTracker = true;
  var H = window.HYO;
  if (!H) return;
  if (!/^https?:$/.test(location.protocol)) return;
  var host = location.hostname;
  if (!host || /(^|\.)fmhy\.net$/.test(host)) return;

  var isTop = window.top === window;
  var refHost = '';
  try { refHost = H.hostOf(document.referrer); } catch (e) {}
  var ancHost = '';
  try {
    if (location.ancestorOrigins && location.ancestorOrigins.length) {
      ancHost = H.hostOf(location.ancestorOrigins[0]);
    }
  } catch (e) {}

  var started = false;
  function attempt(n) {
    H.loadStore().then(function (store) {
      if (started) return;
      var armedHere = H.isArmed(host, store.armed, null);
      var armedViaEmbed = !isTop && (H.isArmed(host, store.armed, refHost) || H.isArmed(host, store.armed, ancHost));
      if (!armedHere && !armedViaEmbed) {
        if (n < 3) setTimeout(function () { attempt(n + 1); }, [800, 2000, 4000][n]);
        return; // not ours — stay invisible
      }
      started = true;
      var embedHost = refHost && store.armed[refHost] ? refHost : (ancHost && store.armed[ancHost] ? ancHost : '');
      var appletName = armedHere ? (store.armed[host].applet || host)
        : (embedHost ? (store.armed[embedHost].applet || embedHost) : host);
      start(store, armedHere, embedHost, appletName);
    });
  }
  attempt(0);

  function start(store, armedHere, embedHost, appletName) {
    /* Page this frame's playback belongs to: in an iframe player, the
     * embedding episode page (referrer), else our own URL. */
    var pageUrl = (!isTop && embedHost && document.referrer) ? document.referrer : location.href;

    var saveTimer = 0;
    function saveSoon() {
      if (saveTimer) return;
      saveTimer = setTimeout(function () { saveTimer = 0; H.saveStore(store); }, 400);
    }

    function upsertEntry(patch) {
      var e = null;
      for (var i = 0; i < store.entries.length; i++) {
        if (store.entries[i].url === pageUrl) { e = store.entries[i]; break; }
      }
      if (!e) {
        var parsed = H.parseEpisode(isTop ? document.title : '', pageUrl);
        e = {
          url: pageUrl,
          title: H.cleanTitle(isTop ? document.title : '') || parsed.showTitle,
          showTitle: parsed.showTitle,
          showKey: parsed.showKey,
          epLabel: parsed.epLabel,
          season: parsed.season,
          episode: parsed.episode,
          applet: appletName,
          host: embedHost || host,
          pos: 0, dur: 0,
          updatedAt: Date.now(),
          nextUrl: null, nextTitle: null,
          finished: false
        };
        store.entries.unshift(e);
      }
      Object.assign(e, patch || {});
      e.updatedAt = Date.now();
      if (H.isFinished(e)) e.finished = true;
      store.entries = store.entries.filter(function (en) { return en === e || !H.isFinished(en); });
      store.entries.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      store.entries = store.entries.slice(0, 24);
      saveSoon();
      return e;
    }

    function currentEntry() {
      for (var i = 0; i < store.entries.length; i++) {
        if (store.entries[i].url === pageUrl) return store.entries[i];
      }
      return null;
    }

    /* ---------- toast (resume / next-episode prompts, this frame) ---------- */
    function toast(text, buttons) {
      var old = document.getElementById('hyo-toast');
      if (old) old.remove();
      var box = document.createElement('div');
      box.id = 'hyo-toast';
      box.setAttribute('style', 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:2147483600;' +
        'background:rgba(18,22,34,0.94);color:#fff;border:1px solid rgba(255,255,255,0.22);border-radius:999px;' +
        'padding:10px 12px 10px 18px;font:14px -apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;' +
        'display:flex;align-items:center;gap:10px;' +
        'max-width:92vw;box-shadow:0 10px 30px rgba(0,0,0,0.45)');
      var label = document.createElement('span');
      label.textContent = text;
      box.appendChild(label);
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.textContent = b.text;
        btn.setAttribute('style', 'background:#0a84ff;color:#fff;border:none;border-radius:999px;' +
          'padding:7px 14px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap');
        btn.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          box.remove();
          b.onTap && b.onTap();
        });
        box.appendChild(btn);
      });
      var x = document.createElement('button');
      x.textContent = '\u2715';
      x.setAttribute('style', 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;flex:0 0 auto');
      x.addEventListener('click', function () { box.remove(); });
      box.appendChild(x);
      (document.body || document.documentElement).appendChild(box);
      setTimeout(function () { if (box.parentNode) box.remove(); }, 12000);
      return box;
    }

    /* Toasts render in the TOP frame only. Injecting UI into the
     * player iframe — especially anything composited over the video —
     * can stall playback on some players, so iframe instances forward
     * the request and receive the button tap back. From 0.5.1 the
     * tracker injects NOTHING into player iframes. */
    var toastSeq = 0;
    var pendingToasts = {};
    function queueToast(text, buttons) {
      if (isTop) { toast(text, buttons); return; }
      var id = 't' + (++toastSeq) + '-' + Math.floor(Math.random() * 1e6);
      pendingToasts[id] = buttons;
      try {
        window.top.postMessage({ __hyo: 'toast', id: id, text: text, labels: buttons.map(function (b) { return b.text; }) }, '*');
      } catch (e) {}
      setTimeout(function () { delete pendingToasts[id]; }, 60000);
    }
    if (isTop) {
      window.addEventListener('message', function (ev) {
        if (!ev.data || ev.data.__hyo !== 'toast') return;
        var src = ev.source;
        var id = ev.data.id;
        var btns = (ev.data.labels || []).map(function (label, idx) {
          return { text: label, onTap: function () { try { src.postMessage({ __hyo: 'toast-tap', id: id, idx: idx }, '*'); } catch (e) {} } };
        });
        toast(ev.data.text, btns);
      });
    }
    window.addEventListener('message', function (ev) {
      if (!ev.data || ev.data.__hyo !== 'toast-tap') return;
      var btns = pendingToasts[ev.data.id];
      if (btns && btns[ev.data.idx] && btns[ev.data.idx].onTap) btns[ev.data.idx].onTap();
      delete pendingToasts[ev.data.id];
    });

    /* ---------- picture-in-picture hand-off ----------
     * Going to the app view (fmhy.net) with a video playing should pop
     * the video into PiP, not kill playback. The actual <video> usually
     * lives in a child player iframe, so the top frame broadcasts a
     * request and every frame with a playing video tries to PiP it. */
    function tryPiP(v) {
      if (!v) return false;
      try { if (v.disablePictureInPicture) v.disablePictureInPicture = false; } catch (e) {}
      try {
        if (typeof v.webkitSetPresentationMode === 'function' &&
            typeof v.webkitSupportsPresentationMode === 'function' &&
            v.webkitSupportsPresentationMode('picture-in-picture')) {
          v.webkitSetPresentationMode('picture-in-picture');
          return true;
        }
      } catch (e) {}
      try {
        if (typeof v.requestPictureInPicture === 'function') {
          var pr = v.requestPictureInPicture();
          if (pr && pr.catch) pr.catch(function () {});
          return true;
        }
      } catch (e) {}
      return false;
    }
    window.addEventListener('message', function (ev) {
      if (!ev.data || ev.data.__hyo !== 'pip') return;
      var v = video || findVideo();
      if (v && !v.paused && !v.ended) tryPiP(v);
    });
    function requestPiPEverywhere() {
      var v = video || findVideo();
      if (v && !v.paused && !v.ended) tryPiP(v);
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        try { frames[i].contentWindow.postMessage({ __hyo: 'pip' }, '*'); } catch (e) {}
      }
    }

    /* phone-remote media commands act on THIS page's playback */
    if (H.Remote) {
      H.Remote.setMediaHandler(function (action) {
        if (action === 'next') {
          var e = currentEntry();
          if (e && e.nextUrl) { try { window.top.location.href = e.nextUrl; } catch (err) { location.href = e.nextUrl; } }
          return;
        }
        if (action === 'app') {
          requestPiPEverywhere();
          setTimeout(function () { location.href = 'https://fmhy.net/'; }, 450);
          return;
        }
        var v = video || findVideo();
        if (!v) return;
        if (action === 'playpause') { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); }
        else if (action === 'back') { try { v.currentTime = Math.max(0, v.currentTime - 10); } catch (err) {} }
        else if (action === 'fwd') { try { v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10); } catch (err) {} }
      });
    }

    /* ---------- now-playing push for the phone remote ---------- */
    function pushNow() {
      if (!H.Remote || !H.Remote.reportNow) return;
      var e = currentEntry();
      var title = e ? ((e.epLabel ? e.epLabel + ' \u2014 ' : '') + (e.showTitle || e.title || '')) : (isTop ? document.title : '');
      if (!title) return;
      H.Remote.reportNow({ title: title, paused: video ? !!video.paused : true });
    }

    /* ---------- video tracking + resume ---------- */
    var video = null;
    var lastSave = 0;

    function findVideo() {
      var vids = document.querySelectorAll('video');
      var bestEl = null, bestArea = -1;
      for (var i = 0; i < vids.length; i++) {
        var r = vids[i].getBoundingClientRect();
        var area = Math.max(0, r.width) * Math.max(0, r.height);
        if (area > bestArea) { bestArea = area; bestEl = vids[i]; }
      }
      return bestEl;
    }

    function wireVideo(v) {
      if (!v || v.__hyoWired) return;
      v.__hyoWired = true;
      video = v;
      upsertEntry({});
      v.addEventListener('loadedmetadata', function () {
        upsertEntry({ dur: v.duration || 0 });
        applyEpisodeInfo();
        pushNow();
        /* NO resume in-site (Kurt's rule, final form 0.7.0): the
         * tracker never offers, seeks, or otherwise touches the
         * timestamp on a streaming page. It only RECORDS position
         * for the app view's Continue Watching display. */
      });
      v.addEventListener('timeupdate', function () {
        var now = Date.now();
        if (now - lastSave < 5000) return;
        lastSave = now;
        upsertEntry({ pos: v.currentTime || 0, dur: v.duration || 0 });
      });
      v.addEventListener('pause', function () {
        upsertEntry({ pos: v.currentTime || 0, dur: v.duration || 0 });
        pushNow();
      });
      v.addEventListener('play', function () { pushNow(); });
      v.addEventListener('ended', function () {
        var e = upsertEntry({ pos: v.duration || v.currentTime || 0, dur: v.duration || 0, finished: true });
        if (e.nextUrl) {
          var nu = e.nextUrl;
          queueToast('Episode finished. Next episode?', [
            { text: 'Play next \u203a', onTap: function () {
                try { window.top.location.href = nu; } catch (err) { location.href = nu; }
              } }
          ]);
        }
      });
    }

    window.addEventListener('pagehide', function () {
      if (video) {
        upsertEntry({ pos: video.currentTime || 0, dur: video.duration || 0 });
        H.saveStore(store);
      }
    });

    /* ---------- season/episode scraping (top frame) ----------
     * Title+URL often carry no S/E marker (movy.sx's SVU page didn't).
     * Dig in order: JSON-LD (schema.org TVEpisode) -> og:title / h1 ->
     * season/episode UI (selects, data-* attrs, active episode item). */
    function scrapeEpisodeInfo() {
      if (!isTop) return null;
      try {
        var lds = document.querySelectorAll('script[type="application/ld+json"]');
        for (var i = 0; i < lds.length; i++) {
          var hit = H.parseEpisodeJsonLd(lds[i].textContent || '');
          if (hit) return hit;
        }
      } catch (e) {}
      var texts = [];
      try {
        var og = document.querySelector('meta[property="og:title"]');
        if (og && og.getAttribute('content')) texts.push(og.getAttribute('content'));
        var h1 = document.querySelector('h1');
        if (h1) texts.push(h1.textContent || '');
        var h2 = document.querySelector('h2');
        if (h2) texts.push(h2.textContent || '');
        var sels = document.querySelectorAll('select');
        for (var s = 0; s < sels.length && s < 6; s++) {
          var so = sels[s].selectedOptions && sels[s].selectedOptions[0];
          if (so) texts.push(so.textContent || '');
          texts.push(sels[s].value || '');
        }
        var dataEls = document.querySelectorAll('[data-season], [data-episode]');
        for (var d = 0; d < dataEls.length && d < 10; d++) {
          var ds = dataEls[d].dataset || {};
          if (ds.season || ds.episode) texts.push('season ' + (ds.season || '') + ' episode ' + (ds.episode || ''));
        }
        var cand = document.querySelectorAll('[class*="episode" i], [class*="season" i], [class*="ep-info" i], [class*="title" i]');
        for (var c = 0; c < cand.length && c < 30; c++) {
          var tx = (cand[c].textContent || '').replace(/\s+/g, ' ').trim();
          if (tx && tx.length <= 160) texts.push(tx);
        }
      } catch (e) {}
      var p = H.parseEpisodeEnhanced({ title: document.title, url: location.href, extraTexts: texts });
      if (p.episode == null && p.season == null) return null;
      return { season: p.season, episode: p.episode, showTitle: p.showTitle, epLabel: p.epLabel };
    }

    function applyEpisodeInfo() {
      var info = scrapeEpisodeInfo();
      if (!info) return;
      var cur = currentEntry();
      var patch = {};
      if (info.episode != null && (!cur || cur.episode !== info.episode)) patch.episode = info.episode;
      if (info.season != null && (!cur || cur.season !== info.season)) patch.season = info.season;
      if (info.epLabel && (!cur || cur.epLabel !== info.epLabel)) patch.epLabel = info.epLabel;
      if (info.showTitle && info.showTitle !== 'Unknown title' && (!cur || !cur.epLabel)) {
        patch.showTitle = info.showTitle;
        patch.showKey = info.showTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      }
      if (Object.keys(patch).length) upsertEntry(patch);
    }

    /* ---------- next-episode detection (top frame) ---------- */
    function scanNext() {
      if (!isTop) return;
      var nodes = document.querySelectorAll('a, button');
      var links = [];
      for (var i = 0; i < nodes.length; i++) {
        links.push({ href: nodes[i].href || '', text: nodes[i].textContent || '' });
      }
      var cur = currentEntry();
      var parsed = H.parseEpisode(document.title, location.href);
      var next = H.pickNextEpisode(links, { episode: cur ? cur.episode : parsed.episode, season: cur ? cur.season : parsed.season });
      if (next && next.url !== location.href) {
        upsertEntry({ nextUrl: next.url, nextTitle: next.title });
      }
    }

    var watched = setInterval(function () {
      var v = findVideo();
      if (v) wireVideo(v);
    }, 1500);
    setTimeout(function () { clearInterval(watched); }, 30000);
    if (isTop) {
      var p = H.parseEpisode(document.title, location.href);
      if (p.episode != null) upsertEntry({});
      setTimeout(scanNext, 2500);
      setTimeout(applyEpisodeInfo, 2500);
      setTimeout(applyEpisodeInfo, 7000);
      /* SPA sites change episode without a reload: watch the URL and
       * treat a change as a new page (new entry, fresh resume state). */
      var lastHref = location.href;
      setInterval(function () {
        if (location.href === lastHref) return;
        lastHref = location.href;
        pageUrl = location.href;
        lastSave = 0;
        var v = findVideo();
        if (v) wireVideo(v);
        setTimeout(scanNext, 1500);
        setTimeout(applyEpisodeInfo, 1500);
      }, 2000);
    }
    var mo = new MutationObserver(function () {
      var v = findVideo();
      if (v) wireVideo(v);
    });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    setTimeout(function () { try { mo.disconnect(); } catch (e) {} }, 12000);

    /* ---------- draggable pill + Recent shows sheet (top frame) ---------- */
    /* The pill is on EVERY page now (v0.12.6): Orion sometimes
     * swallows the toolbar-icon tap so the popup never appears
     * until a refresh, and on un-armed pages the popup was the
     * only door to the menu. Tap = Recent sheet; LONG-PRESS =
     * the full menu as an in-page panel (openMenuPanel). */
    if (isTop) buildSitePill();

    function buildSitePill() {
      if (document.getElementById('hyo-site-pill')) return;
      var pillEl = document.createElement('button');
      pillEl.id = 'hyo-site-pill';
      pillEl.textContent = '\ud83d\udcfa HeckYeah' + (store.entries.length ? ' \u00b7 ' + H.groupByShow(store.entries).length : '');
      pillEl.setAttribute('style', 'position:fixed;right:14px;bottom:18px;z-index:2147483500;' +
        'background:rgba(22,26,42,0.55);color:#fff;border:1px solid rgba(255,255,255,0.22);border-radius:999px;' +
        'padding:11px 17px;font:550 14px -apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;cursor:pointer;' +
        'backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);' +
        'box-shadow:0 10px 28px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.16);' +
        'touch-action:none;-webkit-user-select:none;user-select:none');
      makeDraggable(pillEl, openSheet, openMenuPanel);
      document.body.appendChild(pillEl);
      function fsCheck() {
        var fs = document.fullscreenElement || document.webkitFullscreenElement;
        pillEl.style.display = fs ? 'none' : '';
      }
      document.addEventListener('fullscreenchange', fsCheck);
      document.addEventListener('webkitfullscreenchange', fsCheck);
      document.addEventListener('webkitbeginfullscreen', function () { pillEl.style.display = 'none'; }, true);
      document.addEventListener('webkitendfullscreen', function () { pillEl.style.display = ''; }, true);
    }

    function makeDraggable(elm, onTap, onLongPress) {
      var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;
      var lpTimer = 0, longPressed = false;
      function cancelLp() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } }
      function applySaved() {
        if (store.pillPos) {
          var r = elm.getBoundingClientRect();
          var x = store.pillPos.fx * (innerWidth - r.width);
          var y = store.pillPos.fy * (innerHeight - r.height);
          var c = H.clampPillPos(x, y, r.width, r.height, innerWidth, innerHeight);
          elm.style.left = c.x + 'px';
          elm.style.top = c.y + 'px';
          elm.style.right = 'auto';
          elm.style.bottom = 'auto';
        }
      }
      elm.addEventListener('pointerdown', function (ev) {
        dragging = true; moved = false; longPressed = false;
        sx = ev.clientX; sy = ev.clientY;
        var r = elm.getBoundingClientRect();
        ox = r.left; oy = r.top;
        try { elm.setPointerCapture(ev.pointerId); } catch (e) {}
        if (onLongPress) {
          cancelLp();
          lpTimer = setTimeout(function () {
            lpTimer = 0;
            if (dragging && !moved) {
              longPressed = true;
              try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
              onLongPress();
            }
          }, 550);
        }
      });
      elm.addEventListener('pointermove', function (ev) {
        if (!dragging) return;
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 8) { moved = true; cancelLp(); }
        if (!moved) return;
        var r = elm.getBoundingClientRect();
        var c = H.clampPillPos(ox + dx, oy + dy, r.width, r.height, innerWidth, innerHeight);
        elm.style.left = c.x + 'px';
        elm.style.top = c.y + 'px';
        elm.style.right = 'auto';
        elm.style.bottom = 'auto';
      });
      elm.addEventListener('pointerup', function () {
        if (!dragging) return;
        dragging = false;
        cancelLp();
        if (longPressed) { longPressed = false; return; }
        if (moved) {
          var r = elm.getBoundingClientRect();
          store.pillPos = {
            fx: innerWidth - r.width > 0 ? r.left / (innerWidth - r.width) : 0,
            fy: innerHeight - r.height > 0 ? r.top / (innerHeight - r.height) : 0
          };
          H.saveStore(store);
        } else if (onTap) {
          onTap();
        }
      });
      elm.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); }, true);
      setTimeout(applySaved, 0);
    }

    function openSheet() {
      if (document.getElementById('hyo-sheet')) return;
      H.loadStore().then(function (fresh) {
        store.entries = fresh.entries;
        store.pillPos = fresh.pillPos;
        var wrap = document.createElement('div');
        wrap.id = 'hyo-sheet';
        wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483550;background:rgba(4,6,12,0.45);' +
          'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
          'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif');
        var panel = document.createElement('div');
        panel.setAttribute('style', 'position:absolute;left:0;right:0;bottom:0;max-height:72vh;overflow-y:auto;' +
          '-webkit-overflow-scrolling:touch;background:rgba(16,20,34,0.72);color:#f2f4f8;' +
          'border-top:1px solid rgba(255,255,255,0.18);border-radius:24px 24px 0 0;padding:16px 16px 26px;' +
          'backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);' +
          'box-shadow:0 -14px 44px rgba(0,0,0,0.5)');
        var head = document.createElement('div');
        head.setAttribute('style', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px');
        var title = document.createElement('div');
        title.textContent = 'Recent shows';
        title.setAttribute('style', 'font-size:19px;font-weight:750');
        head.appendChild(title);
        var actions = document.createElement('div');
        actions.setAttribute('style', 'display:flex;gap:8px;align-items:center');
        var appBtn = document.createElement('button');
        appBtn.textContent = '\u2039 HeckYeah app';
        appBtn.setAttribute('style', 'background:#0a84ff;color:#fff;border:none;border-radius:999px;padding:8px 14px;font-size:13.5px;font-weight:600;cursor:pointer');
        appBtn.addEventListener('click', function () {
          // pop any playing video into PiP first so playback survives
          // the trip to the app view; give it a moment to engage
          requestPiPEverywhere();
          setTimeout(function () { location.href = 'https://fmhy.net/'; }, 450);
        });
        actions.appendChild(appBtn);
        if (H.Remote) {
          var pairPhoneBtn = document.createElement('button');
          pairPhoneBtn.textContent = '\ud83d\udcf1 Pair phone';
          pairPhoneBtn.setAttribute('style', 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:999px;padding:8px 14px;font-size:13.5px;font-weight:600;cursor:pointer');
          pairPhoneBtn.addEventListener('click', function () { H.Remote.startHostPanel(); });
          actions.appendChild(pairPhoneBtn);
        }
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.setAttribute('style', 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:50%;width:30px;height:30px;font-size:14px;cursor:pointer');
        closeBtn.addEventListener('click', function () { wrap.remove(); });
        actions.appendChild(closeBtn);
        head.appendChild(actions);
        panel.appendChild(head);

        var groups = H.groupByShow(store.entries);
        if (!groups.length) {
          var empty = document.createElement('div');
          empty.textContent = 'Nothing tracked yet \u2014 episodes you watch on sites opened from HeckYeah will show up here.';
          empty.setAttribute('style', 'color:#9fb0c9;font-size:14px;line-height:1.5;padding:8px 2px');
          panel.appendChild(empty);
        }
        groups.forEach(function (g) {
          var latest = g.latest;
          var rowEl = document.createElement('div');
          rowEl.setAttribute('style', 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);' +
            'border-radius:16px;padding:12px 13px;margin:8px 0;cursor:pointer');
          var t = document.createElement('div');
          t.textContent = g.showTitle;
          t.setAttribute('style', 'font-size:15px;font-weight:650');
          rowEl.appendChild(t);
          var sub = document.createElement('div');
          sub.textContent = (latest.epLabel ? latest.epLabel + ' \u00b7 ' : '') + (latest.applet || latest.host) + ' \u00b7 ' + H.relTime(latest.updatedAt);
          sub.setAttribute('style', 'font-size:12.5px;color:#9fb0c9;margin-top:3px');
          rowEl.appendChild(sub);
          var ts = document.createElement('div');
          ts.textContent = latest.dur > 0 && latest.pos != null
            ? H.fmtTime(latest.pos) + ' / ' + H.fmtTime(latest.dur) + ' \u00b7 ' + H.fmtTime(Math.max(0, latest.dur - latest.pos)) + ' left'
            : 'No position saved yet';
          ts.setAttribute('style', 'font-size:12.5px;color:#d7deeb;margin-top:5px;font-variant-numeric:tabular-nums');
          rowEl.appendChild(ts);
          var bar = document.createElement('div');
          bar.setAttribute('style', 'height:4px;border-radius:2px;background:rgba(255,255,255,0.16);margin-top:6px;overflow:hidden');
          var fill = document.createElement('i');
          var pctVal = latest.dur > 0 && latest.pos != null ? Math.min(100, Math.round((latest.pos / latest.dur) * 100)) : 0;
          fill.setAttribute('style', 'display:block;height:100%;background:#0a84ff;border-radius:2px;width:' + pctVal + '%');
          bar.appendChild(fill);
          rowEl.appendChild(bar);
          rowEl.addEventListener('click', function () { location.href = latest.url; });
          panel.appendChild(rowEl);
          if (g.episodes.length > 1) {
            var chips = document.createElement('div');
            chips.setAttribute('style', 'display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 6px');
            g.episodes.slice().reverse().forEach(function (e) {
              var chip = document.createElement('button');
              chip.textContent = e.epLabel || e.title;
              chip.setAttribute('style', 'background:rgba(255,255,255,0.10);color:#dbe7ff;border:1px solid rgba(255,255,255,0.14);' +
                'border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer');
              chip.addEventListener('click', function (ev) { ev.stopPropagation(); location.href = e.url; });
              chips.appendChild(chip);
            });
            panel.appendChild(chips);
          }
        });

        wrap.appendChild(panel);
        wrap.addEventListener('click', function (ev) { if (ev.target === wrap) wrap.remove(); });
        document.body.appendChild(wrap);
      });
    }

    /* ---------- the full menu as an in-page panel (v0.12.6) ----------
     * Orion sometimes swallows the toolbar-icon tap, so the native
     * popup never appears until the browser is refreshed — and no
     * extension API can force that native surface open. The second
     * door: long-press the pill and the ACTUAL popup page is embedded
     * in a panel on this page. If the embedded popup doesn't announce
     * itself within 4 s (Orion refuses the embed, or the popup context
     * is the wedged part), the panel swaps in native essentials —
     * Continue Watching + app/remote buttons — so a working menu
     * comes up either way. */
    function openMenuPanel() {
      if (document.getElementById('hyo-menu')) return;
      var wrap = document.createElement('div');
      wrap.id = 'hyo-menu';
      wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483560;background:rgba(4,6,12,0.45);' +
        'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif');
      var panel = document.createElement('div');
      panel.setAttribute('style', 'position:absolute;top:0;right:0;bottom:0;width:400px;max-width:94vw;display:flex;flex-direction:column;' +
        'background:rgba(13,16,28,0.82);color:#f2f4f8;border-left:1px solid rgba(255,255,255,0.18);' +
        'backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);' +
        'box-shadow:-14px 0 44px rgba(0,0,0,0.5)');
      var head = document.createElement('div');
      head.setAttribute('style', 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px');
      var title = document.createElement('div');
      title.textContent = '\ud83d\udcfa HeckYeah';
      title.setAttribute('style', 'font-size:17px;font-weight:750');
      head.appendChild(title);
      var closeBtn = document.createElement('button');
      closeBtn.textContent = '\u2715';
      closeBtn.setAttribute('style', 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:50%;width:30px;height:30px;font-size:14px;cursor:pointer');
      head.appendChild(closeBtn);
      panel.appendChild(head);
      var body = document.createElement('div');
      body.setAttribute('style', 'flex:1;position:relative;min-height:0');
      var note = document.createElement('div');
      note.textContent = 'Opening menu\u2026';
      note.setAttribute('style', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9fb0c9;font-size:14px');
      body.appendChild(note);
      panel.appendChild(body);
      wrap.appendChild(panel);

      var alive = false, frame = null;
      function teardown() {
        window.removeEventListener('message', onMsg);
        if (wrap.parentNode) wrap.remove();
      }
      function onMsg(ev) {
        if (frame && ev.source === frame.contentWindow && ev.data === 'hyo-popup-alive') {
          alive = true;
          if (note.parentNode) note.remove();
        }
      }
      closeBtn.addEventListener('click', teardown);
      wrap.addEventListener('click', function (ev) { if (ev.target === wrap) teardown(); });
      window.addEventListener('message', onMsg);
      document.body.appendChild(wrap);

      var url = null;
      try {
        var api = null;
        try { if (typeof browser !== 'undefined' && browser) api = browser; } catch (e) {}
        if (!api) { try { if (typeof chrome !== 'undefined' && chrome) api = chrome; } catch (e) {} }
        if (api && api.runtime && api.runtime.getURL) url = api.runtime.getURL('popup.html');
      } catch (e) {}
      if (url) {
        frame = document.createElement('iframe');
        frame.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent');
        frame.src = url;
        body.appendChild(frame);
        setTimeout(function () { if (!alive && wrap.parentNode) paintMenuFallback(body, frame, note); }, 4000);
      } else {
        paintMenuFallback(body, null, note);
      }
    }

    function paintMenuFallback(body, frame, note) {
      if (frame && frame.parentNode) frame.remove();
      if (note && note.parentNode) note.remove();
      var box = document.createElement('div');
      box.setAttribute('style', 'position:absolute;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 20px');
      var hint = document.createElement('div');
      hint.textContent = 'The embedded menu didn\u2019t load \u2014 here are the essentials.';
      hint.setAttribute('style', 'color:#9fb0c9;font-size:12.5px;line-height:1.45;margin-bottom:10px');
      box.appendChild(hint);
      var actions = document.createElement('div');
      actions.setAttribute('style', 'display:flex;gap:8px;margin-bottom:12px');
      var appBtn = document.createElement('button');
      appBtn.textContent = '\u2039 HeckYeah app';
      appBtn.setAttribute('style', 'background:#0a84ff;color:#fff;border:none;border-radius:999px;padding:8px 14px;font-size:13.5px;font-weight:600;cursor:pointer');
      appBtn.addEventListener('click', function () {
        requestPiPEverywhere();
        setTimeout(function () { location.href = 'https://fmhy.net/'; }, 450);
      });
      actions.appendChild(appBtn);
      if (H.Remote) {
        var pairBtn = document.createElement('button');
        pairBtn.textContent = '\ud83d\udcf1 Pair phone';
        pairBtn.setAttribute('style', 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:999px;padding:8px 14px;font-size:13.5px;font-weight:600;cursor:pointer');
        pairBtn.addEventListener('click', function () { H.Remote.startHostPanel(); });
        actions.appendChild(pairBtn);
      }
      box.appendChild(actions);
      body.appendChild(box);
      H.loadStore().then(function (fresh) {
        var groups = H.groupByShow((fresh.entries || []).filter(function (e) { return !H.isFinished(e); }));
        if (!groups.length) {
          var empty = document.createElement('div');
          empty.textContent = 'Nothing in Continue Watching yet.';
          empty.setAttribute('style', 'color:#9fb0c9;font-size:14px;padding:6px 2px');
          box.appendChild(empty);
          return;
        }
        var sect = document.createElement('div');
        sect.textContent = 'CONTINUE WATCHING';
        sect.setAttribute('style', 'font-size:11px;font-weight:700;letter-spacing:1.1px;color:#7d8494;margin:8px 0 4px');
        box.appendChild(sect);
        groups.forEach(function (g) {
          var e = g.latest;
          var row = document.createElement('div');
          row.setAttribute('style', 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:12px 13px;margin:8px 0;cursor:pointer');
          var t = document.createElement('div');
          t.textContent = g.showTitle;
          t.setAttribute('style', 'font-size:15px;font-weight:650');
          row.appendChild(t);
          var sub = document.createElement('div');
          sub.textContent = (e.epLabel ? e.epLabel + ' \u00b7 ' : '') + H.relTime(e.updatedAt) +
            (e.dur > 0 && e.pos != null ? ' \u00b7 ' + H.fmtTime(Math.max(0, e.dur - e.pos)) + ' left' : '');
          sub.setAttribute('style', 'font-size:12.5px;color:#9fb0c9;margin-top:3px');
          row.appendChild(sub);
          row.addEventListener('click', function () { location.href = e.url; });
          box.appendChild(row);
        });
      });
    }

    /* ---------- sweep (G) — top frame only, v1.46 rules ---------- */
    if (!isTop) return;
    var removals = 0;
    function cleanupAfterRemoval() {
      try {
        [document.documentElement, document.body].forEach(function (n) {
          if (!n) return;
          if (n.style) {
            if (n.style.overflow === 'hidden') n.style.overflow = '';
            if (n.style.position === 'fixed') n.style.position = '';
          }
        });
        var all = document.querySelectorAll('div,section');
        for (var i = 0; i < all.length; i++) {
          var b = all[i];
          if (b.querySelector('video, iframe')) continue;
          var cs = getComputedStyle(b);
          if (cs.position !== 'fixed') continue;
          var r = b.getBoundingClientRect();
          if (r.width * r.height >= 0.85 * innerWidth * innerHeight && (b.textContent || '').trim().length < 20) {
            b.remove();
          }
        }
      } catch (e) {}
    }
    function scanSweep() {
      if (removals >= 6) return;
      var candidates;
      try { candidates = document.querySelectorAll('div,section,aside,dialog,[role="dialog"]'); } catch (e) { return; }
      for (var i = 0; i < candidates.length && removals < 6; i++) {
        var n = candidates[i];
        if (!n.isConnected) continue;
        var text = n.textContent || '';
        var attrText = (n.getAttribute && ((n.getAttribute('alt') || '') + ' ' + (n.getAttribute('title') || '') + ' ' + (n.getAttribute('aria-label') || ''))) || '';
        var hasPhrase = (text.length < 3000 && H.SWEEP_RE.test(text)) || H.SWEEP_RE.test(attrText);
        if (!hasPhrase) continue;
        var r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        var root = n, cur = n;
        for (var up = 0; up < 10 && cur.parentElement; up++) {
          var par = cur.parentElement;
          if (par === document.body || par === document.documentElement) break;
          var pcs = getComputedStyle(par);
          if ((pcs.position === 'fixed' || pcs.position === 'absolute') &&
              (par.textContent || '').length < 3000 && H.SWEEP_RE.test(par.textContent || '')) {
            root = par; cur = par;
          } else if (pcs.position === 'fixed' || pcs.position === 'absolute') {
            cur = par;
          } else break;
        }
        var target = root;
        var tcs = getComputedStyle(target);
        var tr = target.getBoundingClientRect();
        var decision = H.sweepDecision({
          hasPhrase: true,
          textLen: (target.textContent || '').length,
          rectW: tr.width, rectH: tr.height, vw: innerWidth, vh: innerHeight,
          positioned: tcs.position === 'fixed' || tcs.position === 'absolute',
          containsVideo: !!target.querySelector('video'),
          containsCF: !!target.querySelector('iframe[src*="cloudflare"], iframe[src*="turnstile"], iframe[src*="challenges"]'),
          isBodyOrHtml: target === document.body || target === document.documentElement
        });
        if (!decision) continue;
        var what = (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        target.remove();
        removals++;
        store.sweepCount = (store.sweepCount || 0) + 1;
        store.sweepLog = store.sweepLog || [];
        store.sweepLog.unshift({ host: host, ts: Date.now(), what: what });
        store.sweepLog = store.sweepLog.slice(0, 10);
        saveSoon();
        cleanupAfterRemoval();
      }
    }
    var sweepQueued = false;
    function queueSweep() {
      if (sweepQueued) return;
      sweepQueued = true;
      setTimeout(function () { sweepQueued = false; scanSweep(); }, 500);
    }
    scanSweep();
    document.addEventListener('click', queueSweep, true);
    document.addEventListener('touchend', queueSweep, true);
    var smo = new MutationObserver(queueSweep);
    try { smo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] }); } catch (e) {}
    var sweeps = 0;
    var sweepTimer = setInterval(function () {
      sweeps++;
      scanSweep();
      if (sweeps >= 12) { clearInterval(sweepTimer); try { smo.disconnect(); } catch (e) {} }
    }, 2500);
  }
})();
