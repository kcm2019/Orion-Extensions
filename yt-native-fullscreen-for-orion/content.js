'use strict';
/* YT Native Fullscreen for Orion v2.15.0 (Firefox MV2)
 *
 * v1.0: fullscreen a YouTube video -> iOS native player, via
 *   video.webkitEnterFullscreen() called synchronously in the tap.
 * v1.1: YouTube's caption tracks attached as native WebVTT <track>s,
 *   so the native player's subtitles menu has something to show.
 * v1.2 — the "arrive pre-configured" set, A+B+C (F removed in v1.2.1):
 *   A. Quality lock: a quality chosen once is applied to every video
 *      (nearest available at-or-below the choice) via the player API,
 *      because the native player has no quality menu inside.
 *   B. Persistent speed: chosen speed applied to every video and
 *      re-enforced when YouTube resets it.
 *   C. Caption language: chosen language becomes the preferred native
 *      track on every video; if a video has no track in that language,
 *      one is auto-translated into it (timedtext `tlang`) from the
 *      best source track, labelled "(auto-translated)".
 *   F. Auto-PiP: REMOVED in v1.2.1 at Kurt's direction — it was
 *      suspected of breaking background playback when PiP wasn't
 *      already enabled (its visibilitychange trigger fired exactly
 *      when the app was backgrounded). This build does not touch
 *      presentation mode anywhere: no webkitSetPresentationMode
 *      calls, no presentation-mode listeners, no removing YouTube's
 *      disablePictureInPicture. A/B/C are unchanged from v1.2.0.
 *
 * Where preferences live: A/B/C need a way to be chosen, so three
 * small buttons (quality, speed, CC) sit top-right on the INLINE
 * player — the same UI pattern as the Oct 2025 build. Choices are
 * stored (browser.storage.local, with chrome.storage and
 * localStorage fallbacks for Orion's partial API coverage).
 * `CC: Auto` = v1.1 behaviour (YouTube's selected > browser language
 * > English). Choosing a language in the CC menu sets the preference.
 *
 * The native player is a one-way door: everything above is prepared
 * before entry, or acts on the <video> from page JS, which keeps
 * working inside it.
 *
 * v1.3.0: Apple-style reskin. player.css repaints YouTube's INLINE
 * player — glass chrome, white progress, iOS menus/switches, SF
 * type, #0A84FF accents — with a hard paint-only rule: no hiding,
 * no removing, no repositioning of any YouTube control, so every
 * button and function stays intact. This file's own bar, menus and
 * toast use the same liquid-glass system. The fullscreen native
 * player is already Apple's own UI and is untouched.
 */

(function () {
  var TAG = '[YTNativeFS]';
  var MAX_TRACKS = 14;
  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  var QUALITY_ORDER = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  var QUALITY_LABELS = {
    hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p',
    large: '480p', medium: '360p', small: '240p', tiny: '144p',
  };

  var VERSION = '2.15.0';
  var LOGBUF = [];
  function log() {
    var msg = '';
    try { msg = [].slice.call(arguments).join(' '); } catch (e) {}
    try {
      LOGBUF.push(new Date().toISOString().substr(11, 8) + ' ' + msg);
      if (LOGBUF.length > 120) LOGBUF.splice(0, LOGBUF.length - 120);
    } catch (e) {}
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }

  /* ---------------- force desktop site ---------------- */
  try {
    if (location.hostname === 'm.youtube.com') {
      var key = 'ytnf_desktop_attempt:' + location.pathname + location.search;
      var attempted = false;
      try {
        attempted = sessionStorage.getItem(key) === '1';
        if (!attempted) sessionStorage.setItem(key, '1');
      } catch (e) {}
      if (!attempted) {
        var url = new URL(location.href);
        url.hostname = 'www.youtube.com';
        location.replace(url.toString());
        return;
      }
    }
  } catch (e) {}

  /* ---------------- helpers ---------------- */
  function findPlayer() {
    return document.getElementById ? document.getElementById('movie_player') : null;
  }
  function findVideo() {
    return document.querySelector(
      '#movie_player video.html5-main-video, ' +
      '.html5-video-player video, ytd-player video, ' +
      'video.html5-main-video, video'
    );
  }
  function isWatchPage() {
    return /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname === '/watch';
  }
  function currentVideoId() {
    try { return new URLSearchParams(location.search).get('v'); } catch (e) { return null; }
  }
  function langName(code) {
    try {
      if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
      }
    } catch (e) {}
    return code;
  }

  /* ================================================================
   * Preferences (A/B/C) with layered storage
   * ================================================================ */
  var PREFS = {
    quality: 'auto', speed: 1, captionLang: null, // captionLang: null=Auto, 'off', or a language code
    queue: [], // our own queue: [{id, title}] — plays first at video end (Kurt's locked rule, Nov 5)
    autoplayNext: true, // gates Up Next only, never the queue
    autoPipScroll: true, // PiP when the player scrolls halfway out of view (Nov 14, separate from removed feature F)
    liquidGlass: false, // v2.6: "true liquid glass" styling; the pill layout itself is permanent since v2.7
    tapToPause: false, // v2.8: tapping the video pauses it (YouTube's stock behaviour). Off (default): a tap toggles ONLY our UI.
    resumeOnExit: true, // v2.9: keep playing when PiP closes or native fullscreen exits (both pause the video by default). Toggle disables it.
    sleepMinutes: 0, // v2.14 (A): 0 = off, >0 = minutes, -1 = pause at end of video
    sleepDeadline: 0, // v2.14 (A): epoch ms when the sleep timer fires (persisted so it survives navigation)
    sponsorBlock: true, // v2.14 (B): built-in SponsorBlock segment skipping
    sbCats: null, // v2.14 (B): per-category switches; null = defaults (all true)
    autoSkipAds: true, // v2.14 (C): click YouTube's Skip button the moment it appears
  };
  var SB_CAT_LABELS = {
    sponsor: 'Sponsor', selfpromo: 'Self-promotion', interaction: 'Interaction reminder',
    intro: 'Intro', outro: 'Outro', music_offtopic: 'Non-music section',
  };
  var SB_CATS = Object.keys(SB_CAT_LABELS);
  function sbCatOn(cat) {
    if (!PREFS.sponsorBlock) return false;
    if (!PREFS.sbCats) return true;
    return PREFS.sbCats[cat] !== false;
  }
  var prefsLoaded = false;

  function storageGet() {
    return new Promise(function (resolve) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get('ytnf_prefs').then(function (s) {
            resolve(s && s.ytnf_prefs ? s.ytnf_prefs : null);
          }, function () { resolve(localFallback()); });
          return;
        }
      } catch (e) {}
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get('ytnf_prefs', function (s) {
            resolve(s && s.ytnf_prefs ? s.ytnf_prefs : localFallback());
          });
          return;
        }
      } catch (e) {}
      resolve(localFallback());
    });
    function localFallback() {
      try {
        var raw = localStorage.getItem('ytnf_prefs');
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
  }
  function storageSet() {
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.set({ ytnf_prefs: PREFS });
        return;
      }
    } catch (e) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ ytnf_prefs: PREFS });
        return;
      }
    } catch (e) {}
    try { localStorage.setItem('ytnf_prefs', JSON.stringify(PREFS)); } catch (e) {}
  }
  function loadPrefs() {
    if (prefsLoaded) return Promise.resolve();
    return storageGet().then(function (p) {
      if (p) {
        if (QUALITY_ORDER.indexOf(p.quality) !== -1 || p.quality === 'auto') PREFS.quality = p.quality;
        if (SPEEDS.indexOf(p.speed) !== -1) PREFS.speed = p.speed;
        if (p.captionLang === null || p.captionLang === 'off' || typeof p.captionLang === 'string') PREFS.captionLang = p.captionLang;
        if (Array.isArray(p.queue)) {
          PREFS.queue = p.queue.filter(function (q) {
            return q && typeof q.id === 'string' && q.id;
          }).map(function (q) { return { id: q.id, title: String(q.title || q.id) }; }).slice(0, 50);
        }
        if (typeof p.autoplayNext === 'boolean') PREFS.autoplayNext = p.autoplayNext;
        if (typeof p.autoPipScroll === 'boolean') PREFS.autoPipScroll = p.autoPipScroll;
        if (typeof p.liquidGlass === 'boolean') PREFS.liquidGlass = p.liquidGlass;
        if (typeof p.tapToPause === 'boolean') PREFS.tapToPause = p.tapToPause;
        if (typeof p.resumeOnExit === 'boolean') PREFS.resumeOnExit = p.resumeOnExit;
        if (typeof p.sleepMinutes === 'number') PREFS.sleepMinutes = p.sleepMinutes;
        if (typeof p.sleepDeadline === 'number') PREFS.sleepDeadline = p.sleepDeadline;
        if (typeof p.sponsorBlock === 'boolean') PREFS.sponsorBlock = p.sponsorBlock;
        if (p.sbCats && typeof p.sbCats === 'object') PREFS.sbCats = p.sbCats;
        if (typeof p.autoSkipAds === 'boolean') PREFS.autoSkipAds = p.autoSkipAds;
      }
      prefsLoaded = true;
      armSleepTimer();
      log('prefs loaded:', JSON.stringify(PREFS));
    });
  }
  function savePrefs() { storageSet(); }

  /* ================================================================
   * Feature 1: fullscreen -> iOS native player
   * ================================================================ */
  var lastActivation = 0;

  function activateNativeFullscreen() {
    var video = findVideo();
    if (!video) return false;
    if (video.webkitDisplayingFullscreen) {
      try { video.webkitExitFullscreen(); } catch (e) {}
      return true;
    }
    if (typeof video.webkitEnterFullscreen !== 'function') return false;
    var now = Date.now();
    if (now - lastActivation < 500) return true;
    lastActivation = now;
    try {
      video.webkitEnterFullscreen();
      log('webkitEnterFullscreen() called, readyState=' + video.readyState +
          ', captionTracks=' + CAP.tracks.length + ' (' + CAP.status + ')' +
          ', quality=' + PREFS.quality + ', speed=' + PREFS.speed);
    } catch (err) {
      log('webkitEnterFullscreen() threw:', err && err.message);
      try {
        video.addEventListener('loadedmetadata', function onMeta() {
          video.removeEventListener('loadedmetadata', onMeta);
          try { video.webkitEnterFullscreen(); } catch (e) {}
        });
      } catch (e) {}
    }
    return true;
  }

  function isFullscreenButton(node) {
    if (!node || typeof node.closest !== 'function') return false;
    var btn = node.closest(
      '.ytp-fullscreen-button, .ytm-fullscreen-button, ' +
      'button[data-title-no-tooltip="Full screen"], ' +
      'button[data-title-no-tooltip="Exit full screen"]'
    );
    if (btn) return true;
    var labelled = node.closest('button[aria-label], [role="button"][aria-label]');
    if (labelled) {
      var label = (labelled.getAttribute('aria-label') || '').toLowerCase();
      if (label.indexOf('full screen') !== -1 || label.indexOf('fullscreen') !== -1) return true;
    }
    return false;
  }

  document.addEventListener('click', function (e) {
    if (!isFullscreenButton(e.target)) return;
    if (activateNativeFullscreen()) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('dblclick', function (e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest('#movie_player, .html5-video-player, ytd-player')) return;
    if (activateNativeFullscreen()) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!findVideo()) return;
    if (activateNativeFullscreen()) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
  }, true);

  /* ---------------- page-world requestFullscreen patch ---------------- */
  function pagePatch() {
    if (window.__ytnfPatched) return;
    window.__ytnfPatched = true;
    function videoIn(root) {
      if (!root || typeof root.querySelector !== 'function') return null;
      return root.querySelector('video.html5-main-video, video');
    }
    function goNative(el) {
      var video = (el && el.tagName === 'VIDEO') ? el : videoIn(el);
      if (!video || typeof video.webkitEnterFullscreen !== 'function') return false;
      if (video.webkitDisplayingFullscreen) {
        try { video.webkitExitFullscreen(); } catch (e) {}
        return true;
      }
      try { video.webkitEnterFullscreen(); return true; } catch (e) { return false; }
    }
    function looksLikePlayer(el) {
      if (!el) return false;
      if (el.tagName === 'VIDEO') return true;
      if (el.id === 'movie_player' || el.id === 'player-container-id') return true;
      if (typeof el.classList !== 'undefined' && el.classList &&
          (el.classList.contains('html5-video-player') || el.classList.contains('ytp-player-content'))) return true;
      return !!videoIn(el) && (el.id === 'movie_player' || !!el.querySelector('#movie_player, .html5-video-player'));
    }
    var proto = window.Element && window.Element.prototype;
    if (!proto) return;
    ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen'].forEach(function (name) {
      var original = proto[name];
      if (typeof original !== 'function') return;
      proto[name] = function () {
        if (looksLikePlayer(this) && goNative(this)) {
          return window.Promise ? window.Promise.resolve() : undefined;
        }
        return original.apply(this, arguments);
      };
    });
  }

  function injectPagePatch() {
    var code = '(' + pagePatch.toString() + ')();';
    try {
      var w = window.wrappedJSObject;
      if (w && w.document) {
        var scriptViaWrapper = w.document.createElement('script');
        scriptViaWrapper.textContent = code;
        (w.document.head || w.document.documentElement).appendChild(scriptViaWrapper);
        scriptViaWrapper.remove();
        return;
      }
    } catch (e) {}
    try {
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}
  }

  /* ================================================================
   * Feature 2 + C: YouTube captions -> native <track> elements,
   * with a persistent language preference and auto-translate.
   * ================================================================ */
  var CAP = {
    gen: 0,
    video: null,
    player: null,
    pr: null,
    videoId: null,
    tracks: [],
    blobUrls: [],
    status: 'idle',
    observer: null,
    toastTimer: null,
    toastedFor: null,
  };

  function getPlayerResponse() {
    try {
      var w = window.wrappedJSObject;
      if (w && w.ytInitialPlayerResponse) {
        return JSON.parse(JSON.stringify(w.ytInitialPlayerResponse));
      }
    } catch (e) {}
    try {
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var txt = scripts[i].textContent || '';
        var idx = txt.indexOf('ytInitialPlayerResponse');
        if (idx < 0) continue;
        var eq = txt.indexOf('=', idx);
        var json = extractBalanced(txt, eq + 1);
        if (json) return JSON.parse(json);
      }
    } catch (e) {}
    return null;
  }

  function extractBalanced(s, from) {
    var i = s.indexOf('{', from);
    if (i < 0) return null;
    var depth = 0, inStr = false, esc = false;
    for (var j = i; j < s.length; j++) {
      var c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return s.slice(i, j + 1); }
      }
    }
    return null;
  }

  function getCaptionTrackList(pr) {
    try {
      var tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      return Array.isArray(tracks) ? tracks : [];
    } catch (e) { return []; }
  }
  function trackKey(t) {
    return (t.languageCode || 'und') + (t.kind === 'asr' ? '-auto' : '');
  }
  function trackLabel(t) {
    try {
      if (t.name && t.name.simpleText) return t.name.simpleText;
      if (t.name && Array.isArray(t.name.runs)) return t.name.runs.map(function (r) { return r.text; }).join('');
    } catch (e) {}
    return t.languageCode || 'Unknown';
  }
  function baseLang(code) { return String(code || '').toLowerCase().split('-')[0]; }
  function vttUrl(base) {
    var u = String(base).replace(/&fmt=[^&]*/g, '').replace(/&tlang=[^&]*/g, '');
    u += (u.indexOf('?') === -1 ? '?' : '&') + 'fmt=vtt';
    return u;
  }
  function youTubeSelectedLang(player) {
    try {
      if (player && typeof player.getOption === 'function') {
        var t = player.getOption('captions', 'track');
        if (t && t.languageCode) return t.languageCode;
      }
    } catch (e) {}
    return null;
  }

  // A job is one <track> to attach: a native track, or an
  // auto-translated one built from a source track + tlang.
  function buildJobs(list, selectedLang) {
    var pref = PREFS.captionLang; // null | 'off' | code
    var jobs = [];
    var seen = {}, uniq = [];
    list.forEach(function (t, i) {
      var k = trackKey(t) + '|' + (t.vssId || '');
      if (seen[k] || !t.baseUrl) return;
      seen[k] = 1;
      uniq.push({ t: t, idx: i });
    });

    var nav = '';
    try { nav = (navigator.language || '').toLowerCase(); } catch (e) {}
    function score(u) {
      var lang = (u.t.languageCode || '').toLowerCase();
      var base = baseLang(lang);
      var asr = u.t.kind === 'asr';
      if (pref && pref !== 'off') {
        if (lang === pref.toLowerCase()) return asr ? 108 : 110;
        if (base === baseLang(pref)) return asr ? 104 : 106;
      }
      if (selectedLang && lang === String(selectedLang).toLowerCase()) return 100;
      if (nav && lang === nav) return 90;
      if (nav && base === baseLang(nav)) return 80;
      if (lang === 'en' && !asr) return 70;
      if (base === 'en' && !asr) return 65;
      if (base === 'en' && asr) return 60;
      return asr ? 20 : 40;
    }
    uniq.sort(function (a, b) { return (score(b) - score(a)) || (a.idx - b.idx); });

    // C: auto-translate when the preferred language has no native track.
    var hasPrefNative = pref && pref !== 'off' &&
      uniq.some(function (u) { return baseLang(u.t.languageCode) === baseLang(pref); });
    if (pref && pref !== 'off' && !hasPrefNative && uniq.length) {
      var source = uniq.filter(function (u) { return baseLang(u.t.languageCode) === 'en' && u.t.kind !== 'asr' })[0] ||
                   uniq.filter(function (u) { return baseLang(u.t.languageCode) === 'en' })[0] ||
                   uniq.filter(function (u) { return u.t.kind !== 'asr'; })[0] || uniq[0];
      jobs.push({
        source: source.t,
        url: vttUrl(source.t.baseUrl) + '&tlang=' + encodeURIComponent(pref),
        label: langName(pref) + ' (auto-translated)',
        lang: pref,
        key: pref + '-xlate',
        translated: true,
      });
      log('caption pref ' + pref + ' has no native track; auto-translating from ' + source.t.languageCode);
    }

    uniq.slice(0, MAX_TRACKS - jobs.length).forEach(function (u) {
      jobs.push({
        source: u.t,
        url: vttUrl(u.t.baseUrl),
        label: trackLabel(u.t) + (u.t.kind === 'asr' ? ' (auto)' : ''),
        lang: u.t.languageCode || '',
        key: trackKey(u.t),
        translated: false,
      });
    });
    return jobs;
  }

  function setMode(entry, mode) {
    try { if (entry.el && entry.el.track) entry.el.track.mode = mode; } catch (e) {}
  }
  function preferredEntry() {
    if (PREFS.captionLang === 'off') return null;
    for (var i = 0; i < CAP.tracks.length; i++) if (CAP.tracks[i].preferred) return CAP.tracks[i];
    return null;
  }
  function applyInlineMode() {
    var pref = preferredEntry();
    CAP.tracks.forEach(function (tr) { setMode(tr, tr === pref ? 'hidden' : 'disabled'); });
  }
  function applyFullscreenMode() {
    var pref = preferredEntry();
    CAP.tracks.forEach(function (tr) { setMode(tr, tr === pref ? 'showing' : 'disabled'); });
  }

  // Mark one attached track as the preferred (default) one.
  function makePreferred(entry) {
    CAP.tracks.forEach(function (tr) {
      tr.preferred = tr === entry;
      try {
        if (tr.preferred) tr.el.setAttribute('default', '');
        else tr.el.removeAttribute('default');
      } catch (e) {}
      try { tr.el.default = !!tr.preferred; } catch (e) {}
    });
    applyInlineMode();
    refreshPanel();
  }

  document.addEventListener('webkitbeginfullscreen', function () {
    applyFullscreenMode();
    try {
      var v = findVideo();
      var modes = [];
      if (v && v.textTracks) {
        for (var i = 0; i < v.textTracks.length; i++) modes.push(v.textTracks[i].label + ':' + v.textTracks[i].mode);
      }
      log('webkitbeginfullscreen, textTracks=[' + modes.join(', ') + ']');
    } catch (e) {}
  }, true);

  document.addEventListener('webkitendfullscreen', function () {
    applyInlineMode();
    log('webkitendfullscreen, preferred track back to hidden');
  }, true);

  function setStatus(status, detail) {
    CAP.status = status;
    try {
      document.documentElement.setAttribute('data-ytnf-captions', status + (detail ? ':' + detail : ''));
    } catch (e) {}
  }

  function showToast(msg, ms) {
    try {
      var old = document.getElementById('ytnf-toast');
      if (old) old.remove();
      var host = findPlayer() || document.body;
      if (!host) return;
      var el = document.createElement('div');
      el.id = 'ytnf-toast';
      el.textContent = msg;
      // v2.15 (Kurt): the toast used to sit at bottom:64px and
      // clipped into the scrub bar. It is now centred and padded
      // well clear above the bar, in the same Liquid Glass as the
      // rest of the overlay (dark sheen when Liquid Glass is on).
      var toastGlass = PREFS.liquidGlass
        ? 'linear-gradient(135deg,rgba(255,255,255,.20),rgba(255,255,255,.05) 45%,rgba(255,255,255,.02)),' +
          'linear-gradient(rgba(22,22,27,.44),rgba(22,22,27,.44))'
        : 'rgba(28,28,30,.42)';
      el.style.cssText =
        'position:absolute;left:50%;transform:translateX(-50%);bottom:124px;z-index:2147483646;' +
        'background:' + toastGlass + ';color:#fff;padding:11px 18px;text-align:center;' +
        '-webkit-backdrop-filter:blur(24px) saturate(200%);backdrop-filter:blur(24px) saturate(200%);' +
        'border:1px solid rgba(255,255,255,.16);box-shadow:0 10px 30px rgba(0,0,0,.4);' +
        'border-radius:14px;font:13px -apple-system,system-ui,sans-serif;font-weight:500;' +
        'pointer-events:none;max-width:86%;line-height:1.35;';
      if (host === document.body) el.style.position = 'fixed';
      host.appendChild(el);
      if (CAP.toastTimer) clearTimeout(CAP.toastTimer);
      CAP.toastTimer = setTimeout(function () { try { el.remove(); } catch (e) {} }, ms || 5000);
    } catch (e) {}
  }

  function clearCaptionTracks() {
    if (CAP.video) {
      try {
        var olds = CAP.video.querySelectorAll('track[data-ytnf]');
        for (var i = 0; i < olds.length; i++) olds[i].remove();
      } catch (e) {}
    }
    CAP.blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    CAP.blobUrls = [];
    CAP.tracks = [];
  }

  function loadCaptions(video, player, pr) {
    var gen = CAP.gen;
    var list = getCaptionTrackList(pr);
    if (!list.length) {
      setStatus('none');
      if (CAP.toastedFor !== CAP.videoId) {
        CAP.toastedFor = CAP.videoId;
        showToast('No caption tracks on this video — nothing to add to the native player.');
      }
      log('no caption tracks in player response');
      refreshPanel();
      return Promise.resolve();
    }
    var jobs = buildJobs(list, youTubeSelectedLang(player));
    setStatus('loading', jobs.length + '/' + list.length);
    log('caption jobs: ' + jobs.map(function (j) { return j.label + (j.translated ? ' [xlate]' : ''); }).join(', '));

    if (typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') {
      setStatus('error', 'no-fetch');
      log('fetch/createObjectURL unavailable; captions skipped');
      return Promise.resolve();
    }

    return Promise.all(jobs.map(function (job) {
      return fetch(job.url, { credentials: 'include' })
        .then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.text(); })
        .then(function (text) {
          if (!text || text.trimStart().indexOf('WEBVTT') !== 0) throw new Error('not vtt');
          return { job: job, blobUrl: URL.createObjectURL(new Blob([text], { type: 'text/vtt' })) };
        })
        .catch(function () { return null; });
    })).then(function (results) {
      if (gen !== CAP.gen || CAP.video !== video) return;
      clearCaptionTracks();
      var made = 0;
      results.forEach(function (r) {
        if (!r) return;
        CAP.blobUrls.push(r.blobUrl);
        var el = document.createElement('track');
        el.kind = 'captions';
        el.label = r.job.label;
        el.srclang = r.job.lang;
        el.src = r.blobUrl;
        el.dataset.ytnf = '1';
        try { video.appendChild(el); } catch (e) { return; }
        var entry = {
          key: r.job.key, label: r.job.label, lang: r.job.lang,
          translated: r.job.translated, preferred: false, el: el,
        };
        CAP.tracks.push(entry);
        try {
          el.addEventListener('load', function () { if (CAP.gen === gen) applyInlineMode(); });
        } catch (e) {}
        made++;
      });
      if (!made) {
        setStatus('error', 'all-fetches-failed');
        log('every caption fetch failed');
        refreshPanel();
        return;
      }
      // Preferred = the translated track if present, else the first
      // job (buildJobs ordered them by preference).
      var firstKey = jobs.filter(function (j) {
        return CAP.tracks.some(function (tr) { return tr.key === j.key; });
      }).map(function (j) { return j.key; })[0];
      var prefEntry = CAP.tracks.filter(function (tr) { return tr.key === firstKey; })[0] || CAP.tracks[0];
      if (PREFS.captionLang !== 'off') makePreferred(prefEntry);
      else applyInlineMode();
      setStatus('ready', String(made));
      refreshPanel();
      log('caption tracks attached: ' + CAP.tracks.map(function (tr) {
        return tr.label + (tr.preferred ? '*' : '');
      }).join(', '));
      if (CAP.toastedFor !== CAP.videoId) {
        CAP.toastedFor = CAP.videoId;
        var pref = preferredEntry();
        showToast(pref
          ? 'Captions ready for the native player: ' + pref.label + (made > 1 ? ' +' + (made - 1) + ' more' : '') + ' — fullscreen, then use the subtitles menu.'
          : 'Caption tracks attached (' + made + '), none auto-selected (CC is Off).');
      }
    });
  }

  /* ================================================================
   * A: quality lock.  B: persistent speed.
   * ================================================================ */
  var settingRate = false;

  function enforceSpeed() {
    var v = CAP.video || findVideo();
    if (!v) return;
    try {
      if (Math.abs(v.playbackRate - PREFS.speed) > 0.001) {
        settingRate = true;
        v.playbackRate = PREFS.speed;
      }
    } catch (e) { settingRate = false; }
  }

  function wireSpeed(video) {
    try {
      video.addEventListener('ratechange', function () {
        if (settingRate) { settingRate = false; return; }
        enforceSpeed(); // YouTube reset it; put the preference back
      });
      video.addEventListener('loadedmetadata', enforceSpeed);
    } catch (e) {}
  }

  function nearestQuality(want, levels) {
    if (!levels.length) return null;
    if (levels.indexOf(want) !== -1) return want;
    var wi = QUALITY_ORDER.indexOf(want);
    for (var i = wi + 1; i < QUALITY_ORDER.length; i++) {
      if (levels.indexOf(QUALITY_ORDER[i]) !== -1) return QUALITY_ORDER[i]; // nearest below
    }
    for (var j = wi - 1; j >= 0; j--) {
      if (levels.indexOf(QUALITY_ORDER[j]) !== -1) return QUALITY_ORDER[j]; // else smallest above
    }
    return levels[0];
  }

  function safeSetQuality(player, code) {
    try {
      if (typeof player.setPlaybackQualityRange === 'function') player.setPlaybackQualityRange(code);
      else if (typeof player.setPlaybackQuality === 'function') player.setPlaybackQuality(code);
    } catch (e) {}
  }

  function getQualityLevels() {
    // Longest list wins across every element that might expose the
    // player API (on Kurt's iPad build the page's first lookup came
    // back empty and the Quality menu showed only "Auto").
    var best = [];
    var candidates = [CAP.player, (typeof AUI !== 'undefined' ? AUI.player : null)];
    try {
      var mp = document.getElementById && document.getElementById('movie_player');
      if (mp) candidates.push(mp);
    } catch (e) {}
    candidates.forEach(function (p) {
      if (!p || typeof p.getAvailableQualityLevels !== 'function') return;
      var lv = [];
      try { lv = p.getAvailableQualityLevels() || []; } catch (e) {}
      lv = lv.filter(function (l) { return QUALITY_ORDER.indexOf(l) !== -1; });
      if (lv.length > best.length) best = lv;
    });
    return best;
  }

  function applyQuality(player, gen) {
    if (PREFS.quality === 'auto') { refreshPanel(); return; }
    var tries = 0;
    (function tick() {
      if (gen !== CAP.gen) return;
      var levels = getQualityLevels();
      refreshPanel();
      if (levels.length) {
        var target = nearestQuality(PREFS.quality, levels);
        if (target) {
          safeSetQuality(player, target);
          log('quality lock: want ' + PREFS.quality + ', applied ' + target);
        }
        return;
      }
      if (++tries < 20) setTimeout(tick, 500);
    })();
  }

  /* ================================================================
   * v2.0.0: Apple-style player UI (modelled on the iOS PiP window in
   * Kurt's screenshot: centre transport cluster, slim bottom scrub
   * bar, corner glass buttons).
   *
   * - Tap the video: centre cluster appears — skip back 10s, big
   *   glass play/pause, skip forward 10s. The tap ONLY toggles this
   *   UI (v2.1.0, Kurt's rule): YouTube's click-to-pause is stopped
   *   in the capture phase, so playback changes solely via the
   *   centre play/pause button.
   * - Bottom floating glass bar: elapsed time, a drag-to-scrub
   *   track (pointer events, live seeking, 44px touch target),
   *   remaining time, ONE settings button, and a fullscreen button
   *   that stays OUTSIDE the settings menu (per Kurt).
   * - The settings menu collapses everything that used to sit in
   *   YouTube's lower-right corner into one list: Captions /
   *   Quality / Playback Speed (drill-in pages, our existing
   *   features A/B/C), then proxied rows for YouTube's own
   *   Miniplayer, Theater Mode, Play on TV and Settings gear —
   *   each row clicks the real YouTube button, so the function is
   *   YouTube's own. SponsorBlock gets a row too IF its player
   *   button is detected in the DOM ("if possible" — best effort,
   *   its markup is another extension's moving target).
   * - YouTube's own chrome is hidden ONLY after this overlay has
   *   mounted (a class on the player + an injected style), so if
   *   this code ever fails, stock YouTube remains fully usable.
   *   Nothing is removed from the DOM; every hidden button is
   *   still there and is what the menu rows actually click.
   * ================================================================ */
  var AUI = {
    root: null, center: null, bottom: null, panel: null,
    holdChip: null, holdSpeed: false, swallowNextClick: false,
    updateAvail: null, scrubThumb: null, scrubBubbleText: null,
    playBtn: null, backBtn: null, fwdBtn: null, gearBtn: null, fsBtn: null,
    scrub: null, scrubFill: null, scrubKnob: null, hairFill: null,
    tElapsed: null, tRemain: null,
    visible: false, hideTimer: null, scrubbing: false, wasPlaying: false,
    page: 'main', player: null, panelOpen: false,
    shownAt: 0, lastActivity: 0, compact: false, mode: 'classic',
    topBar: null, topPillL: null, topPillR: null, volPill: null,
    volTrack: null, volFill: null, volKnob: null, volBtn: null,
    airplayBtn: null, airplayWireless: false,
    gearPill: null, scrubTrack: null, scrubBubble: null,
    volScrubbing: false, lastPlayingAt: 0, resumeGuardUntil: 0,
  };

  var MIN_VISIBLE_MS = 5000; // Kurt's rule: once up, the UI stays up at least 5s
  var GLASS =
    'background:rgba(28,28,30,.28);-webkit-backdrop-filter:blur(26px) saturate(200%);' +
    'backdrop-filter:blur(26px) saturate(200%);border:1px solid rgba(255,255,255,.24);' +
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 8px 28px rgba(0,0,0,.32);color:#fff;';
  var FONT = 'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;';

  function fmtTime(sec) {
    if (!isFinite(sec) || sec == null || sec < 0) sec = 0;
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    var ss = String(s).padStart(2, '0');
    return (h > 0 ? h + ':' : '') + mm + ':' + ss;
  }
  function fmtSpeed(s) { return (Number.isInteger(s) ? s.toFixed(0) : String(s)) + 'x'; }
  function qualityLabel(code) { return code === 'auto' ? 'Auto' : (QUALITY_LABELS[code] || code); }
  function captionPrefLabel() {
    return PREFS.captionLang === null ? 'Auto' :
      PREFS.captionLang === 'off' ? 'Off' : langName(baseLang(PREFS.captionLang));
  }

  function setCaptionPref(val) {
    PREFS.captionLang = val;
    savePrefs();
    if (val === 'off') {
      CAP.tracks.forEach(function (tr) {
        tr.preferred = false;
        try { tr.el.removeAttribute('default'); } catch (e) {}
      });
      applyInlineMode();
    } else if (CAP.video && CAP.player && CAP.pr) {
      loadCaptions(CAP.video, CAP.player, CAP.pr);
    }
    if (val) showToast('Caption language: ' + langName(baseLang(val)) +
      ' — auto-translated when a video lacks it', 2600);
  }

  function fireRealClick(el) {
    // A bare el.click() was NOT enough on Kurt's build (v2.0.0 menu
    // rows for Theater / Play on TV / SponsorBlock / YouTube
    // Settings did nothing): those handlers key off the full
    // pointer/mouse sequence. Dispatch the whole thing, in order,
    // and fall back to .click() only if dispatch is unavailable.
    if (!el) return false;
    try {
      var opts = { bubbles: true, cancelable: true, composed: true, view: window };
      var types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        var Ctor = (type.indexOf('pointer') === 0 && typeof PointerEvent === 'function')
          ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      }
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (err) { return false; }
    }
  }

  var proxyWatchTimer = null;
  function beginProxySession() {
    // Unhide YouTube's chrome BEFORE firing a proxied button: the
    // button is rendered (so position-sensitive handlers and
    // popups anchor correctly), and if the function still doesn't
    // trigger, the real button is right there to tap. A poll
    // re-hides the chrome once no YouTube popup (.ytp-popup) is
    // visible any more (900ms grace for popup-less actions like
    // Theater; 60s hard cap).
    var player = findPlayer() || AUI.player;
    if (!player) return;
    try { if (player.classList) player.classList.remove('ytnf-on'); } catch (e) {}
    if (proxyWatchTimer) { clearInterval(proxyWatchTimer); proxyWatchTimer = null; }
    var started = Date.now();
    proxyWatchTimer = setInterval(function () {
      var open = false;
      try {
        var list = player.querySelectorAll ? player.querySelectorAll('.ytp-popup') : [];
        for (var i = 0; i < list.length; i++) {
          var el = list[i];
          var hidden = (el.style && el.style.display === 'none') ||
            (el.classList && el.classList.contains('ytp-hidden'));
          if (!hidden) { open = true; break; }
        }
      } catch (e) {}
      var elapsed = Date.now() - started;
      if ((!open && elapsed > 900) || elapsed > 60000) {
        clearInterval(proxyWatchTimer); proxyWatchTimer = null;
        try { if (player.classList) player.classList.add('ytnf-on'); } catch (e) {}
      }
    }, 400);
  }

  function pressKeyI() {
    // YouTube's miniplayer hotkey is the "i" key. Used only when
    // the miniplayer button itself isn't in the DOM (YouTube drops
    // it in some states — the case that hid the menu row earlier).
    try {
      var opts = { key: 'i', code: 'KeyI', keyCode: 73, which: 73, bubbles: true, cancelable: true };
      var target = document.body || document;
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        target.dispatchEvent(new KeyboardEvent(t, opts));
      });
      return true;
    } catch (e) { return false; }
  }

  function activateMiniplayer() {
    if (clickYtDetect('.ytp-miniplayer-button')) {
      beginProxySession();
      return clickYtButton(['.ytp-miniplayer-button']);
    }
    return pressKeyI();
  }

  function togglePiP() {
    // MANUAL PiP only — a deliberate tap on this button. This is
    // not the removed auto-PiP (feature F): nothing here fires on
    // fullscreen exit or app backgrounding, so background playback
    // is untouched. Because the tap is an explicit request for
    // PiP, YouTube's disablePictureInPicture is lifted for it.
    var v = syncVideo();
    if (!v) { showToast('No video yet'); return; }
    try {
      if (typeof v.webkitSetPresentationMode !== 'function' ||
        (typeof v.webkitSupportsPresentationMode === 'function' &&
          !v.webkitSupportsPresentationMode('picture-in-picture'))) {
        showToast('Picture in Picture is not available for this video');
        return;
      }
      if (v.disablePictureInPicture) {
        try { v.removeAttribute('disablepictureinpicture'); } catch (e) {}
        try { v.disablePictureInPicture = false; } catch (e) {}
      }
      var target = v.webkitPresentationMode === 'picture-in-picture'
        ? 'inline' : 'picture-in-picture';
      v.webkitSetPresentationMode(target);
      log('manual PiP toggle -> ' + target);
    } catch (e) { showToast('Picture in Picture failed'); }
  }

  /* -------- auto-PiP on scroll (Nov 14, Kurt's ask) --------
   * NOT the removed feature F: F fired on fullscreen-exit and on
   * app backgrounding (visibilitychange), which is what broke
   * background playback. This one fires ONLY on an in-page scroll
   * that takes the player halfway out of view, in the foreground,
   * while playing. It never fires on tab hide / app background
   * (explicit document.hidden guard), never when paused, never
   * in native fullscreen or the miniplayer, and it re-arms only
   * after the player is at least half visible again — so if you
   * close the PiP yourself while still scrolled down, it won't
   * fight you and re-open. Toggle lives in the settings menu. */
  var SPIP = { observer: null, armed: true };
  function handlePlayerVisibility(ratio) {
    if (ratio >= 0.5) { SPIP.armed = true; return; }
    if (!SPIP.armed) return;
    SPIP.armed = false;
    maybeAutoPipScroll();
  }
  function maybeAutoPipScroll() {
    var v = syncVideo();
    if (!v || !PREFS.autoPipScroll) return;
    try { if (document.hidden) return; } catch (e) {}
    if (v.paused || v.ended) return;
    if (v.webkitDisplayingFullscreen) return;
    if (v.webkitPresentationMode === 'picture-in-picture') return;
    if (AUI.compact) return;
    if (typeof v.webkitSetPresentationMode !== 'function') return;
    if (typeof v.webkitSupportsPresentationMode === 'function' &&
      !v.webkitSupportsPresentationMode('picture-in-picture')) return;
    if (v.disablePictureInPicture) {
      try { v.removeAttribute('disablepictureinpicture'); } catch (e) {}
      try { v.disablePictureInPicture = false; } catch (e) {}
    }
    try {
      v.webkitSetPresentationMode('picture-in-picture');
      log('auto-PiP: player scrolled halfway out of view');
    } catch (e) {}
  }
  function wireScrollPip(player) {
    AUI.onPlayerVisibility = handlePlayerVisibility;
    if (typeof IntersectionObserver !== 'function' || !player) return;
    if (SPIP.observer) { try { SPIP.observer.disconnect(); } catch (e) {} SPIP.observer = null; }
    try {
      SPIP.observer = new IntersectionObserver(function (entries) {
        if (entries && entries[0]) handlePlayerVisibility(entries[0].intersectionRatio);
      }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      SPIP.observer.observe(player);
    } catch (e) {}
  }

  function pressKeyT() {
    try {
      if (typeof KeyboardEvent !== 'function') return false;
      var opts = { key: 't', code: 'KeyT', keyCode: 84, which: 84, bubbles: true, cancelable: true };
      var target = document.body || document;
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        target.dispatchEvent(new KeyboardEvent(t, opts));
      });
      return true;
    } catch (e) { return false; }
  }
  function theaterIsOn() {
    try {
      var f = document.querySelector('ytd-watch-flexy');
      if (f && typeof f.hasAttribute === 'function') return f.hasAttribute('theater');
    } catch (e) {}
    return false;
  }
  function toggleTheater() {
    // v2.10 (Kurt: "theatre mode doesn't work either"): the
    // proxied size-button click didn't take on his build. Click
    // it, VERIFY the theater state actually flipped, and if it
    // didn't, use YouTube's own 't' shortcut — the same trick
    // that backs up the miniplayer button. If neither lands, say
    // so instead of failing silently.
    var was = theaterIsOn();
    clickYtButton(['.ytp-size-button']);
    setTimeout(function () {
      if (theaterIsOn() !== was) return;
      pressKeyT();
      setTimeout(function () {
        if (theaterIsOn() === was) {
          showToast('Theater Mode did not respond on this page', 2400);
        }
      }, 350);
    }, 250);
    return true;
  }

  function clickYtButton(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var b = null;
      try { b = document.querySelector(selectors[i]); } catch (e) {}
      if (b && b !== CAP.video && typeof b.click === 'function') {
        if (fireRealClick(b)) return true;
      }
    }
    return false;
  }

  function findSponsorBlockButton() {
    // SponsorBlock (a separate extension) injects a button into
    // YouTube's right controls; known shapes include an <img> with
    // id sbSkipIconControlBarImage and nodes named *sponsorBlock*.
    var sels = ['#sbSkipIconControlBarImage', '[id*="sponsorBlock" i]',
      '[class*="sponsorBlock" i]', '[id*="SponsorBlock"]', '[class*="SponsorBlock"]'];
    for (var i = 0; i < sels.length; i++) {
      var el = null;
      try { el = document.querySelector(sels[i]); } catch (e) {}
      if (!el || el === CAP.video) continue;
      var idc = String((el.id || '') + ' ' + (el.className || '')).toLowerCase();
      if (el.id === 'sbSkipIconControlBarImage' || idc.indexOf('sponsor') !== -1) {
        var btn = el;
        try { if (typeof el.closest === 'function') btn = el.closest('button') || el; } catch (e) {}
        if (btn && (typeof btn.click === 'function' || typeof btn.dispatchEvent === 'function')) return btn;
        if (typeof el.click === 'function' || typeof el.dispatchEvent === 'function') return el;
      }
    }
    return null;
  }

  /* ---------------- transport / scrub readouts ---------------- */
  function updateTransport() {
    var v = CAP.video;
    if (!v || !AUI.playBtn) return;
    AUI.playBtn.textContent = v.ended ? '↺' : (v.paused ? '▶︎' : '❙❙');
    var dur = v.duration, ct = v.currentTime || 0;
    var frac = (isFinite(dur) && dur > 0) ? Math.min(1, Math.max(0, ct / dur)) : 0;
    if (!isFinite(dur)) {
      // Live stream: position inside the seekable window instead.
      try {
        if (v.seekable && v.seekable.length) {
          var s0 = v.seekable.start(0), s1 = v.seekable.end(0);
          if (s1 > s0) frac = Math.min(1, Math.max(0, (ct - s0) / (s1 - s0)));
        }
      } catch (e) {}
    }
    if (AUI.scrubbing) return; // the finger owns the bar right now
    if (AUI.scrubFill) AUI.scrubFill.style.width = (frac * 100).toFixed(2) + '%';
    if (AUI.scrubKnob) AUI.scrubKnob.style.left = (frac * 100).toFixed(2) + '%';
    if (AUI.hairFill) AUI.hairFill.style.width = (frac * 100).toFixed(2) + '%';
    if (AUI.tElapsed) AUI.tElapsed.textContent = fmtTime(ct);
    if (AUI.tRemain) AUI.tRemain.textContent = isFinite(dur) ? '-' + fmtTime(dur - ct) : 'LIVE';
  }

  // Chrome motion (v2.10, Kurt's ask): elements fade AND drift —
  // the centre cluster scales up out of a slight shrink, the bars
  // slide a few px from their edges. Hiding keeps the element
  // "visible" until the fade finishes (visibility flips on a
  // delay), so the fade-out is actually seen instead of the old
  // instant vanish.
  // Each element's RESTING transform matters: the centre cluster
  // is centred with translateY(-50%), and the v2.10 motion code
  // overwrote it with its scale — the cluster rendered
  // half-a-height too low ("no longer centered", Kurt Nov 25).
  // Shown/hidden transforms are now pairs that both keep it.
  function chromeTransforms(el) {
    if (el === AUI.center) return ['translateY(-50%)', 'translateY(-50%) scale(.93)'];
    if (el === AUI.bottom) return ['', 'translateY(10px)'];
    if (el === AUI.topBar) return ['', 'translateY(-10px)'];
    if (el === AUI.gearPill) return ['', 'translateY(10px) scale(.94)'];
    return ['', ''];
  }
  function applyChromeState(el, vis) {
    if (!el) return;
    el.style.transition = vis
      ? 'opacity .26s ease, transform .3s cubic-bezier(.2,.9,.3,1.15), visibility 0s'
      : 'opacity .22s ease, transform .22s ease, visibility 0s linear .22s';
    el.style.opacity = vis ? '1' : '0';
    el.style.visibility = vis ? 'visible' : 'hidden';
    var pair = chromeTransforms(el);
    el.style.transform = vis ? pair[0] : pair[1];
  }
  function setChrome(vis) {
    [AUI.center, AUI.bottom, AUI.topBar, AUI.gearPill].forEach(function (el) {
      applyChromeState(el, vis);
    });
  }
  function showUI() {
    if (!AUI.root) return;
    if (!AUI.visible) AUI.shownAt = Date.now();
    AUI.visible = true;
    AUI.lastActivity = Date.now();
    setChrome(true);
    updateTransport();
    scheduleHide();
  }
  function toggleUI() {
    // A tap dismisses the UI only if it has been up a moment;
    // a tap landing right after something else (e.g. the synthetic
    // mousemove a touchscreen fires just before click) brought it
    // up must not instantly take it down again — that race was the
    // "sometimes it stays up, sometimes it goes straight down" bug.
    if (AUI.visible && Date.now() - (AUI.shownAt || 0) >= 700) hideUI();
    else showUI();
  }
  function hideUI() {
    if (!AUI.root) return;
    if (AUI.scrubbing) return;
    AUI.visible = false;
    closePanel();
    setChrome(false);
  }
  function scheduleHide() {
    if (AUI.hideTimer) { clearTimeout(AUI.hideTimer); AUI.hideTimer = null; }
    if (AUI.panelOpen || AUI.scrubbing) return;
    var v = CAP.video;
    if (!v || v.paused || v.ended) return; // paused: UI stays up
    var base = Math.max(AUI.shownAt || 0, AUI.lastActivity || 0);
    var delay = Math.max(0, base + MIN_VISIBLE_MS - Date.now());
    AUI.hideTimer = setTimeout(function () {
      AUI.hideTimer = null;
      // Re-validate at fire time: the state that justified hiding
      // may be gone (video paused meanwhile, panel opened, a scrub
      // started). Hiding anyway was a real "UI vanished while
      // paused" path.
      if (AUI.panelOpen || AUI.scrubbing) return;
      var vv = CAP.video;
      if (!vv || vv.paused || vv.ended) return;
      hideUI();
    }, delay);
  }

  /* ---------------- live-element wiring ----------------
   * THE v2.5 FIX. YouTube swaps the <video> element when a new
   * video is picked from the current one (Up Next, end screen,
   * queue jump, ad transitions) — sometimes with no navigation
   * event at all. Everything used to trust the element captured
   * at build time: the replacement observer watched the player
   * with subtree:false while the <video> lives one level deeper
   * (inside .html5-video-container), so it usually never fired,
   * CAP.video kept pointing at a detached element, and the
   * overlay's pause button called pause() on a dead node.
   * Now: every transport action resolves the LIVE element first
   * (syncVideo), adoption re-wires all per-element listeners and
   * resets per-video UI state, and a 1s poll + a subtree
   * observer guarantee adoption happens even if a swap is
   * missed by both navigation hooks. */
  function wireTransport(v) {
    if (!v || typeof v.addEventListener !== 'function' || v.__ytnfWired) return;
    v.__ytnfWired = true;
    wireSpeed(v);
    wireEnded(v);
    v.addEventListener('timeupdate', updateTransport);
    v.addEventListener('play', function () {
      updateTransport(); AUI.lastActivity = Date.now(); scheduleHide();
    });
    v.addEventListener('pause', function () { updateTransport(); showUI(); });
    v.addEventListener('loadedmetadata', updateTransport);
    v.addEventListener('loadedmetadata', function () { renderChapterTicks(); });
    v.addEventListener('timeupdate', function () { checkSponsorBlock(v); });
    v.addEventListener('seeking', updateTransport);
    v.addEventListener('volumechange', function () { updateVolumeUI(); });
    // Resume-after-exit (v2.9): track "was playing" continuously,
    // catch PiP-close / fullscreen-exit, and undo the pause those
    // exits cause — whether it lands before or after the exit
    // event (a short guard window replays pauses that arrive
    // late). Our own pause button clears the guard, so a
    // deliberate pause right after exiting still sticks.
    v.addEventListener('timeupdate', function () {
      if (!v.paused) AUI.lastPlayingAt = Date.now();
    });
    v.addEventListener('pause', function () {
      if (PREFS.resumeOnExit && AUI.resumeGuardUntil &&
          Date.now() < AUI.resumeGuardUntil && !v.ended) {
        try { v.play(); } catch (e) {}
      }
    });
    v.addEventListener('webkitpresentationmodechanged', function () {
      var mode = v.webkitPresentationMode || 'inline';
      var prev = v.__ytnfMode || 'inline';
      v.__ytnfMode = mode;
      if (mode === 'inline' && prev === 'picture-in-picture') onPresentationExit(v);
    });
    v.addEventListener('webkitendfullscreen', function () { onPresentationExit(v); });
    v.addEventListener('ended', function () { updateTransport(); showUI(); });
    // AirPlay active state (v2.13): WebKit reports wireless
    // playback on the element; the native player turns its
    // AirPlay glyph blue and glowing while it's live — so do we.
    v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', function () {
      updateAirPlayUI(v);
    });
    updateAirPlayUI(v);
  }

  function updateAirPlayUI(v) {
    var btn = AUI.airplayBtn;
    if (!btn) return;
    var wireless = false;
    try { wireless = !!(v && v.webkitCurrentPlaybackTargetIsWireless); } catch (err) {}
    if (wireless === AUI.airplayWireless) return;
    AUI.airplayWireless = wireless;
    try { btn.innerHTML = airplaySVG(wireless); } catch (err) {}
  }

  function adoptVideo(v) {
    if (!v || v === CAP.video) return false;
    CAP.video = v;
    wireTransport(v);
    enforceSpeed();
    // Per-video UI state: a settings page or panel left open for
    // the previous video must not linger over the new one.
    if (AUI.panelOpen) closePanel();
    AUI.page = 'main';
    updateTransport();
    scheduleHide();
    log('adopted live video element');
    return true;
  }

  function syncVideo() {
    var v = null;
    try {
      // v2.10: re-resolve #movie_player from the document EVERY
      // time. The miniplayer cycle relocates/rebuilds player
      // internals; the element captured at build time can end up
      // pointing at a leftover shell whose <video> is not the one
      // on screen — which is exactly how the play button went
      // dead after pausing in the miniplayer and restoring
      // (Kurt, Nov 25): it faithfully played a detached element.
      var fresh = findPlayer();
      if (fresh) AUI.player = fresh;
      var p = AUI.player;
      if (p && p.querySelector) v = p.querySelector('video.html5-main-video, video');
    } catch (e) {}
    if (!v) v = findVideo();
    if (v) adoptVideo(v);
    return CAP.video;
  }

  /* ---------------- autoplay sync ----------------
   * v2.15 (Kurt): our custom Settings queue is gone — YouTube's
   * own Queue panel below the player is the queue now (restyled +
   * touch-draggable, see the panel code). What remains here is the
   * autoplay preference: ON lets YouTube's Up Next proceed at the
   * end; OFF stops playback there. */
  function ensureYouTubeAutoplay(wantOn) {
    var b = null;
    try { b = document.querySelector('.ytp-autonav-toggle-button'); } catch (e) {}
    if (!b || b === CAP.video) return;
    var on = null;
    try {
      var ac = b.getAttribute && b.getAttribute('aria-checked');
      if (ac === 'true') on = true;
      else if (ac === 'false') on = false;
      else {
        var lbl = ((b.getAttribute && b.getAttribute('aria-label')) || '').toLowerCase();
        if (lbl.indexOf('autoplay is on') !== -1) on = true;
        else if (lbl.indexOf('autoplay is off') !== -1) on = false;
      }
    } catch (e) {}
    if (on !== null && on !== wantOn) {
      fireRealClick(b);
      log('synced YouTube autonav ->', wantOn);
    }
  }

  function onVideoEnded() {
    if (PREFS.sleepMinutes === -1) {
      PREFS.sleepMinutes = 0;
      savePrefs();
      try { if (CAP.video) CAP.video.pause(); } catch (e) {}
      showToast('Sleep timer — stopped at the end of video', 2600);
      log('sleep timer: stopped at end of video');
      return;
    }
    if (!PREFS.autoplayNext) {
      ensureYouTubeAutoplay(false);
      try { if (CAP.video) CAP.video.pause(); } catch (e) {}
      log('autoplay off: stopping at end');
    }
    // Autoplay on: YouTube's own queue / Up Next proceeds.
  }

  function wireEnded(v) {
    try {
      if (!v || v.__ytnfEnded) return;
      v.__ytnfEnded = true;
      v.addEventListener('ended', onVideoEnded);
    } catch (e) {}
  }

  /* ================================================================
   * v2.14 feature engines
   * ================================================================ */

  /* ---- A: sleep timer ---- */
  var sleepInt = null;
  function sleepRemainingMs() {
    return PREFS.sleepDeadline ? Math.max(0, PREFS.sleepDeadline - Date.now()) : 0;
  }
  function sleepLabel() {
    if (PREFS.sleepMinutes === -1) return 'End of video';
    if (!PREFS.sleepMinutes) return 'Off';
    var ms = sleepRemainingMs();
    if (ms > 0) return Math.ceil(ms / 60000) + ' min left';
    return PREFS.sleepMinutes + ' min';
  }
  function armSleepTimer() {
    if (sleepInt || !PREFS.sleepDeadline) return;
    if (PREFS.sleepDeadline <= Date.now()) {
      // Expired while the page was away: clear it quietly rather
      // than pausing a video the user has only just opened.
      PREFS.sleepDeadline = 0;
      PREFS.sleepMinutes = 0;
      savePrefs();
      return;
    }
    sleepInt = setInterval(sleepTick, 1000);
  }
  function sleepTick() {
    if (!PREFS.sleepDeadline) {
      if (sleepInt) { clearInterval(sleepInt); sleepInt = null; }
      return;
    }
    if (Date.now() < PREFS.sleepDeadline) return;
    PREFS.sleepDeadline = 0;
    PREFS.sleepMinutes = 0;
    savePrefs();
    if (sleepInt) { clearInterval(sleepInt); sleepInt = null; }
    var v = syncVideo();
    if (v) { try { v.pause(); } catch (e) {} }
    showToast('Sleep timer — playback paused', 2600);
    log('sleep timer fired');
  }
  function setSleep(minutes) {
    PREFS.sleepMinutes = minutes;
    PREFS.sleepDeadline = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    savePrefs();
    if (sleepInt) { clearInterval(sleepInt); sleepInt = null; }
    armSleepTimer();
  }
  try { window.__ytnfSleepTick = sleepTick; } catch (e) {}
  try { window.__ytnfToast = showToast; } catch (e) {}

  /* ---- B: SponsorBlock (built in) ---- */
  var SB = { videoId: null, segments: [], skipped: {} };
  function sbFetchFor(pr) {
    if (!PREFS.sponsorBlock) return;
    var id = null;
    try { id = pr && pr.videoDetails && pr.videoDetails.videoId; } catch (e) {}
    if (!id || id === SB.videoId) return;
    SB.videoId = id; SB.segments = []; SB.skipped = {};
    var cats = SB_CATS.filter(sbCatOn);
    if (!cats.length) return;
    var apply = function (list) {
      if (SB.videoId !== id || !Array.isArray(list)) return;
      SB.segments = list.filter(function (sg) {
        return sg && Array.isArray(sg.segment) && sg.segment.length === 2;
      }).map(function (sg) {
        return { start: +sg.segment[0], end: +sg.segment[1], category: sg.category || 'sponsor', uuid: sg.UUID || '' };
      }).filter(function (sg) { return isFinite(sg.start) && isFinite(sg.end) && sg.end > sg.start; });
      log('sponsorblock:', SB.segments.length, 'segments for', id);
    };
    var plain = function () {
      try {
        fetch('https://sponsor.ajay.app/api/skipSegments?videoID=' + encodeURIComponent(id) +
          '&categories=' + encodeURIComponent(JSON.stringify(cats)))
          .then(function (r) { return r && r.ok ? r.json() : []; })
          .then(apply, function () {});
      } catch (e) {}
    };
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest && typeof TextEncoder === 'function') {
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)).then(function (buf) {
          var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('');
          return fetch('https://sponsor.ajay.app/api/skipSegments/' + hex.slice(0, 4));
        }).then(function (r) { return r && r.ok ? r.json() : []; }).then(function (arr) {
          if (!Array.isArray(arr)) { plain(); return; }
          var hit = null;
          arr.forEach(function (e2) { if (e2 && e2.videoID === id) hit = e2; });
          if (hit) apply(hit.segments || []); else plain();
        }, plain);
      } else plain();
    } catch (e) { plain(); }
  }
  function checkSponsorBlock(v) {
    if (!PREFS.sponsorBlock || !SB.segments.length || !v) return;
    if (AUI.scrubbing || v.seeking || v.paused) return;
    var t = v.currentTime || 0;
    for (var i = 0; i < SB.segments.length; i++) {
      var sg = SB.segments[i];
      if (!sbCatOn(sg.category)) continue;
      var key = sg.uuid || (sg.start + '-' + sg.end);
      if (t < sg.start - 1 && SB.skipped[key]) { delete SB.skipped[key]; continue; }
      if (SB.skipped[key]) continue;
      if (t >= sg.start && t < sg.end - 0.05) {
        SB.skipped[key] = true;
        try { v.currentTime = sg.end; } catch (e) {}
        showToast('Skipped ' + (SB_CAT_LABELS[sg.category] || 'segment'), 1800);
        log('sponsorblock: skipped', sg.category, sg.start, '->', sg.end);
      }
    }
  }
  try { window.__ytnfSB = function () { return SB; }; } catch (e) {}

  /* ---- C: ads — step aside so YouTube's own ad UI (incl. the
   * Skip button our bar used to cover) is fully reachable, and
   * auto-click Skip the moment it appears (toggleable). ---- */
  var adState = { showing: false, skipTriedAt: 0 };
  function attemptAdSkip(player) {
    var now = Date.now();
    if (adState.skipTriedAt && now - adState.skipTriedAt < 4000) return;
    var btn = null;
    try {
      btn = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button-modern');
    } catch (e) {}
    if (!btn) return;
    adState.skipTriedAt = now;
    fireRealClick(btn);
    log('ad: auto-skip clicked');
  }
  function refreshAdState() {
    var player = findPlayer();
    if (!player || !player.classList) return;
    var showing = false;
    try { showing = !!player.classList.contains('ad-showing'); } catch (e) {}
    if (showing && PREFS.autoSkipAds) attemptAdSkip(player);
    if (showing === adState.showing) return;
    adState.showing = showing;
    if (!AUI.root) return;
    if (showing) {
      adState.skipTriedAt = 0;
      AUI.root.style.display = 'none';
      try { player.classList.remove('ytnf-on'); } catch (e) {}
      log('ad showing — overlay stepped aside');
    } else {
      AUI.root.style.display = '';
      try { player.classList.add('ytnf-on'); } catch (e) {}
      log('ad ended — overlay restored');
    }
  }
  try { window.__ytnfAdRefresh = refreshAdState; } catch (e) {}

  /* ---- D: hold-to-2x ---- */
  var holdState = null;
  function wireHoldSpeed() {
    document.addEventListener('pointerdown', function (e) {
      if (AUI.panelOpen || holdState) return;
      if (!isVideoTapTarget(e && e.target)) return;
      var v = syncVideo();
      if (!v || v.paused || v.ended) return;
      var st = { x: e.clientX, y: e.clientY, active: false, timer: null };
      st.timer = setTimeout(function () {
        if (holdState !== st) return;
        st.active = true;
        AUI.holdSpeed = true;
        // Hide YouTube's own 2x indicator (its speedmaster overlay
        // and bezel text react to the rate change / the hold) —
        // our chip is the only indicator (Kurt, Nov 26).
        try {
          var pl = findPlayer();
          if (pl && pl.classList) pl.classList.add('ytnf-hold2x');
        } catch (err) {}
        try { v.playbackRate = 2; } catch (err) {}
        if (AUI.holdChip) AUI.holdChip.style.display = 'block';
        log('hold-to-2x engaged');
      }, 380);
      holdState = st;
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!holdState || holdState.active) return;
      if (Math.abs(e.clientX - holdState.x) > 12 || Math.abs(e.clientY - holdState.y) > 12) {
        clearTimeout(holdState.timer);
        holdState = null;
      }
    }, true);
    function release() {
      if (!holdState) return;
      clearTimeout(holdState.timer);
      var wasActive = holdState.active;
      holdState = null;
      if (!wasActive) return;
      AUI.holdSpeed = false;
      AUI.swallowNextClick = true;
      try {
        var pl2 = findPlayer();
        if (pl2 && pl2.classList) pl2.classList.remove('ytnf-hold2x');
      } catch (err) {}
      enforceSpeed();
      if (AUI.holdChip) AUI.holdChip.style.display = 'none';
      log('hold-to-2x released');
    }
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
  }

  /* ---- E: chapters (from the description) + storyboard thumbs ---- */
  var MEDIA = { chapters: [], board: null, ticks: [] };
  function parseChapters(pr) {
    MEDIA.chapters = [];
    var desc = '';
    try { desc = (pr && pr.videoDetails && pr.videoDetails.shortDescription) || ''; } catch (e) {}
    if (!desc) return;
    var out = [];
    desc.split('\n').forEach(function (ln) {
      var m = ln.match(/^\s*(?:\(|\[)?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\)|\])?\s+(?:[-\u2013\u2014:]\s*)?(.{2,80})$/);
      if (!m) return;
      var parts = m[1].split(':').map(function (x) { return parseInt(x, 10); });
      var t = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      var title = m[2].replace(/\s+https?:\/\/\S+$/, '').trim();
      if (title) out.push({ t: t, title: title });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    if (out.length >= 2 && out[0].t <= 5) MEDIA.chapters = out;
  }
  function chapterAt(t) {
    var cur = null;
    for (var i = 0; i < MEDIA.chapters.length; i++) {
      if (MEDIA.chapters[i].t <= t) cur = MEDIA.chapters[i]; else break;
    }
    return cur;
  }
  function parseStoryboard(pr) {
    MEDIA.board = null;
    try {
      var spec = pr && pr.storyboards && pr.storyboards.playerStoryboardSpecRenderer &&
        pr.storyboards.playerStoryboardSpecRenderer.spec;
      if (!spec) return;
      var parts = String(spec).split('|');
      var base = parts[0];
      var best = null;
      for (var i = 1; i < parts.length; i++) {
        var f = parts[i].split('#');
        // Real board format (yt-dlp's parse, verified Nov 26):
        // width#height#frameCount#cols#rows#intervalMs#nameTemplate#sigh.
        // v2.15.0 read cols as the interval and the interval as the
        // sigh, so every sheet URL failed and no preview ever loaded.
        if (f.length !== 8) continue;
        var b = {
          w: +f[0], h: +f[1], count: +f[2], cols: +f[3], rows: +f[4],
          interval: +f[5], name: f[6], sigh: f[7], level: i - 1,
        };
        if (!b.w || !b.h || !b.count || !b.cols || !b.rows ||
            !b.interval || !b.name || !b.sigh) continue;
        if (!best) best = b;
        else if (best.h > 90 && b.h < best.h) best = b;
        else if (b.h <= 90 && b.h > best.h) best = b;
      }
      if (!best) return;
      best.base = base;
      best.perSheet = best.cols * best.rows;
      MEDIA.board = best;
      log('storyboard:', best.w + 'x' + best.h, 'every', best.interval + 'ms,',
        best.cols + 'x' + best.rows, 'grid');
    } catch (e) {}
  }
  function boardThumbAt(t) {
    var b = MEDIA.board;
    if (!b) return null;
    var idx = Math.floor((t * 1000) / b.interval);
    if (idx >= b.count) idx = b.count - 1;
    if (idx < 0) idx = 0;
    var page = Math.floor(idx / b.perSheet);
    var pos = idx % b.perSheet;
    return {
      url: b.base.replace('$L', String(b.level))
          .replace('$N', b.name.replace('$M', String(page))) +
        (b.base.indexOf('?') >= 0 ? '&' : '?') + 'sigh=' + b.sigh,
      x: (pos % b.cols) * b.w,
      y: Math.floor(pos / b.cols) * b.h,
      w: b.w, h: b.h,
      sheetW: b.cols * b.w,
      sheetH: b.rows * b.h,
    };
  }
  function renderChapterTicks() {
    var track = AUI.scrubTrack;
    if (!track || !track.children) return;
    (MEDIA.ticks || []).forEach(function (el) {
      try { el.remove(); } catch (e) {}
      var p = el.parentNode || el._parent;
      if (p && p.children) {
        var i = p.children.indexOf(el);
        if (i >= 0) p.children.splice(i, 1);
      }
    });
    MEDIA.ticks = [];
    var v = CAP.video;
    var dur = v && isFinite(v.duration) ? v.duration : 0;
    if (!dur || MEDIA.chapters.length < 2) return;
    MEDIA.chapters.forEach(function (ch) {
      if (ch.t <= 0) return;
      var tick = document.createElement('div');
      tick.__ytnfTick = true;
      tick.style.cssText = 'position:absolute;top:0;height:100%;width:2px;background:rgba(0,0,0,.45);left:' +
        (ch.t / dur * 100).toFixed(2) + '%;pointer-events:none;';
      track.appendChild(tick);
      MEDIA.ticks.push(tick);
    });
  }
  function onPlayerResponse(pr) {
    parseChapters(pr);
    parseStoryboard(pr);
    renderChapterTicks();
    sbFetchFor(pr);
  }
  try { window.__ytnfMedia = function () { return MEDIA; }; } catch (e) {}
  try { window.__ytnfChapterAt = chapterAt; } catch (e) {}
  try { window.__ytnfThumbAt = boardThumbAt; } catch (e) {}

  /* ---- G: update checker hookup (update-check.js) ---- */
  var UPD = (typeof window !== 'undefined' && window.YTNFUpdate) || null;
  function checkForUpdates(force) {
    if (!UPD || typeof UPD.checkNow !== 'function') {
      if (force) showToast('Update checker unavailable', 2000);
      return;
    }
    try {
      UPD.checkNow(!!force).then(function (res) {
        if (res && res.state === 'update') {
          AUI.updateAvail = { version: res.version, update_link: res.update_link || '' };
          log('update available:', res.version);
          if (force) showToast('Update available: v' + res.version + ' — see the Settings menu', 2600);
          if (AUI.panelOpen && AUI.page === 'main') renderPanel('main');
        } else if (force) {
          showToast(res && res.state === 'error'
            ? 'Update check failed'
            : 'You are on the latest version (v' + VERSION + ')', 2200);
        }
      }, function () { if (force) showToast('Update check failed', 2000); });
    } catch (e) {}
  }

  /* ---- I: diagnostics ---- */
  function buildDiagnostics() {
    var v = null;
    try { v = syncVideo(); } catch (e) {}
    var lines = [];
    lines.push('YT Native Fullscreen for Orion — debug log');
    lines.push('Version: ' + VERSION);
    try { lines.push('UA: ' + navigator.userAgent); } catch (e) {}
    try { lines.push('Page: ' + location.pathname + location.search); } catch (e) {}
    lines.push('Video: ' + (v
      ? 'paused=' + v.paused + ' t=' + (v.currentTime || 0).toFixed(1) + '/' +
        (isFinite(v.duration) ? v.duration.toFixed(1) : 'live') + ' rate=' + v.playbackRate +
        ' wireless=' + !!v.webkitCurrentPlaybackTargetIsWireless
      : 'none'));
    lines.push('Chapters: ' + MEDIA.chapters.length +
      ' | Storyboard: ' + (MEDIA.board ? MEDIA.board.w + 'x' + MEDIA.board.h : 'none') +
      ' | SB segments: ' + SB.segments.length +
      ' | Ad showing: ' + adState.showing);
    try {
      lines.push('Prefs: ' + JSON.stringify({
        quality: PREFS.quality, speed: PREFS.speed, captionLang: PREFS.captionLang,
        liquidGlass: PREFS.liquidGlass, tapToPause: PREFS.tapToPause,
        resumeOnExit: PREFS.resumeOnExit, autoPipScroll: PREFS.autoPipScroll,
        sponsorBlock: PREFS.sponsorBlock, autoSkipAds: PREFS.autoSkipAds,
        sleepMinutes: PREFS.sleepMinutes, queue: PREFS.queue.length,
        autoplayNext: PREFS.autoplayNext,
      }));
    } catch (e) {}
    lines.push('--- log ---');
    lines.push(LOGBUF.slice(-60).join('\n'));
    return lines.join('\n');
  }
  function copyDiagnostics() {
    var text = buildDiagnostics();
    var done = function () { showToast('Debug log copied', 2000); };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          showToast('Copy failed — clipboard unavailable', 2200);
        });
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) { showToast('Copy failed', 2000); }
  }
  try { window.__ytnfDiag = buildDiagnostics; } catch (e) {}

  /* ---------------- settings panel (single menu) ---------------- */
  function panelRow(label, value, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    if (opts.page) b.dataset.page = opts.page;
    if (opts.pick) b.dataset.pick = opts.pick;
    if (opts.action) b.dataset.action = opts.action;
    b.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;' +
      'background:transparent;border:0;border-radius:10px;color:#fff;min-height:46px;' +
      'padding:10px 12px;font-size:15px;' + FONT + 'cursor:pointer;text-align:left;';
    var l = document.createElement('span');
    l.textContent = label + (opts.active ? '  ✓' : '');
    if (opts.active) l.style.cssText = 'font-weight:600;';
    b.appendChild(l);
    if (value != null) {
      var r = document.createElement('span');
      r.textContent = value;
      r.style.cssText = 'color:rgba(255,255,255,.6);font-size:14px;white-space:nowrap;';
      b.appendChild(r);
    }
    b.addEventListener('click', function (e) {
      try { e.stopPropagation(); } catch (err) {}
      if (opts.onPick) opts.onPick();
    });
    return b;
  }
  function panelDivider() {
    var d = document.createElement('div');
    d.style.cssText = 'height:1px;background:rgba(255,255,255,.14);margin:5px 10px;';
    return d;
  }
  function panelHeader(title, back) {
    var h = document.createElement('div');
    h.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px 8px;';
    if (back) {
      var bb = document.createElement('button');
      bb.type = 'button';
      bb.textContent = '‹';
      bb.style.cssText = 'background:rgba(255,255,255,.12);border:0;color:#fff;width:30px;height:30px;' +
        'border-radius:50%;font-size:19px;line-height:1;cursor:pointer;';
      bb.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        renderPanel('main');
      });
      h.appendChild(bb);
    }
    var t = document.createElement('span');
    t.textContent = title;
    t.style.cssText = 'font-size:15px;font-weight:600;' + FONT;
    h.appendChild(t);
    return h;
  }

  function renderPanel(page) {
    var panel = AUI.panel;
    if (!panel) return;
    AUI.page = page;
    panel.textContent = '';
    var player = AUI.player || CAP.player;
    if (page === 'main') {
      panel.appendChild(panelHeader('Settings', false));
      panel.appendChild(panelRow('Captions', captionPrefLabel(), {
        page: 'cc', onPick: function () { renderPanel('cc'); },
      }));
      panel.appendChild(panelRow('Quality', qualityLabel(PREFS.quality), {
        page: 'quality', onPick: function () { renderPanel('quality'); },
      }));
      panel.appendChild(panelRow('Playback Speed', fmtSpeed(PREFS.speed), {
        page: 'speed', onPick: function () { renderPanel('speed'); },
      }));
      panel.appendChild(panelRow('Autoplay Up Next', PREFS.autoplayNext ? 'On' : 'Off', {
        pick: 'autoplay', active: PREFS.autoplayNext,
        onPick: function () {
          PREFS.autoplayNext = !PREFS.autoplayNext;
          savePrefs();
          ensureYouTubeAutoplay(PREFS.autoplayNext);
          showToast(PREFS.autoplayNext
            ? 'Autoplay on — YouTube plays what is next'
            : 'Autoplay off — playback stops at the end', 2200);
          renderPanel('main');
        },
      }));
      panel.appendChild(panelRow('Liquid Glass UI', PREFS.liquidGlass ? 'On' : 'Off', {
        pick: 'liquid', active: PREFS.liquidGlass,
        onPick: function () {
          PREFS.liquidGlass = !PREFS.liquidGlass;
          savePrefs();
          applyLayoutMode();
          showToast(PREFS.liquidGlass
            ? 'Liquid Glass on'
            : 'Liquid Glass off — classic glass', 2200);
          renderPanel('main');
        },
      }));
      panel.appendChild(panelRow('Tap Screen to Pause', PREFS.tapToPause ? 'On' : 'Off', {
        pick: 'tap', active: PREFS.tapToPause,
        onPick: function () {
          PREFS.tapToPause = !PREFS.tapToPause;
          savePrefs();
          showToast(PREFS.tapToPause
            ? 'Tap screen to pause on — stock behaviour'
            : 'Tap screen to pause off — taps toggle the controls only', 2200);
          renderPanel('main');
        },
      }));
      panel.appendChild(panelRow('Resume After PiP / Fullscreen', PREFS.resumeOnExit ? 'On' : 'Off', {
        pick: 'resume', active: PREFS.resumeOnExit,
        onPick: function () {
          PREFS.resumeOnExit = !PREFS.resumeOnExit;
          savePrefs();
          showToast(PREFS.resumeOnExit
            ? 'Resume on: closing PiP or fullscreen keeps the video playing'
            : 'Resume off: closing PiP or fullscreen pauses (stock)', 2200);
          renderPanel('main');
        },
      }));
      panel.appendChild(panelRow('Auto PiP on Scroll', PREFS.autoPipScroll ? 'On' : 'Off', {
        pick: 'autopip', active: PREFS.autoPipScroll,
        onPick: function () {
          PREFS.autoPipScroll = !PREFS.autoPipScroll;
          savePrefs();
          showToast(PREFS.autoPipScroll
            ? 'Auto PiP on scroll: on — PiP when the player scrolls halfway away'
            : 'Auto PiP on scroll: off', 2400);
          renderPanel('main');
        },
      }));
      if (AUI.updateAvail) {
        panel.appendChild(panelRow('Update Available', 'v' + AUI.updateAvail.version, {
          pick: 'update', active: true,
          onPick: function () {
            if (UPD && typeof UPD.openUpdate === 'function' && AUI.updateAvail.update_link) {
              UPD.openUpdate(AUI.updateAvail.update_link);
            } else {
              showToast('Update v' + AUI.updateAvail.version + ' is available', 2400);
            }
          },
        }));
      }
      panel.appendChild(panelRow('Sleep Timer', sleepLabel(), {
        page: 'sleep', onPick: function () { renderPanel('sleep'); },
      }));
      panel.appendChild(panelRow('SponsorBlock', PREFS.sponsorBlock ? 'On' : 'Off', {
        page: 'sponsorblock', onPick: function () { renderPanel('sponsorblock'); },
      }));
      panel.appendChild(panelRow('Auto-Skip Ads', PREFS.autoSkipAds ? 'On' : 'Off', {
        pick: 'autoskip', active: PREFS.autoSkipAds,
        onPick: function () {
          PREFS.autoSkipAds = !PREFS.autoSkipAds;
          savePrefs();
          showToast(PREFS.autoSkipAds ? 'Auto-skip ads on' : 'Auto-skip ads off', 2000);
          renderPanel('main');
        },
      }));
      panel.appendChild(panelDivider());
      panel.appendChild(panelRow('Check for Updates', 'v' + VERSION, {
        pick: 'updcheck',
        onPick: function () { checkForUpdates(true); },
      }));
      panel.appendChild(panelRow('Copy Debug Log', null, {
        pick: 'diag',
        onPick: function () { copyDiagnostics(); },
      }));
      // YouTube's own lower-right controls, proxied.
      var actions = [];
      if (clickYtDetect('.ytp-miniplayer-button')) actions.push(['Miniplayer', 'miniplayer', ['.ytp-miniplayer-button']]);
      if (clickYtDetect('.ytp-size-button')) actions.push(['Theater Mode', 'theater', ['.ytp-size-button']]);
      if (clickYtDetect('.ytp-remote-button')) actions.push(['Play on TV', 'tv', ['.ytp-remote-button']]);
      var sb = findSponsorBlockButton();
      if (sb) actions.push(['SponsorBlock', 'sponsorblock', null, sb]);
      if (clickYtDetect('.ytp-settings-button')) actions.push(['YouTube Settings', 'ytsettings', ['.ytp-settings-button']]);
      if (actions.length) {
        panel.appendChild(panelDivider());
        actions.forEach(function (a) {
          panel.appendChild(panelRow(a[0], null, {
            action: a[1],
            onPick: function () {
              closePanel(); hideUI();
              beginProxySession();
              if (a[3]) fireRealClick(a[3]);
              else if (a[1] === 'theater') toggleTheater();
              else clickYtButton(a[2]);
            },
          }));
        });
      }
    } else if (page === 'sleep') {
      panel.appendChild(panelHeader('Sleep Timer', true));
      [[0, 'Off'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'],
       [30, '30 minutes'], [45, '45 minutes'], [60, '60 minutes'],
       [-1, 'End of this video']].forEach(function (opt) {
        panel.appendChild(panelRow(opt[1], null, {
          pick: 'sleep:' + opt[0], active: PREFS.sleepMinutes === opt[0],
          onPick: function () {
            setSleep(opt[0]);
            showToast(opt[0] === 0 ? 'Sleep timer off'
              : opt[0] === -1 ? 'Sleep timer: pause at the end of this video'
              : 'Sleep timer: ' + opt[0] + ' minutes', 2200);
            renderPanel('sleep');
          },
        }));
      });
    } else if (page === 'sponsorblock') {
      panel.appendChild(panelHeader('SponsorBlock', true));
      panel.appendChild(panelRow('Skip Segments', PREFS.sponsorBlock ? 'On' : 'Off', {
        pick: 'sbmaster', active: PREFS.sponsorBlock,
        onPick: function () {
          PREFS.sponsorBlock = !PREFS.sponsorBlock;
          savePrefs();
          SB.videoId = null;
          if (PREFS.sponsorBlock && CAP.pr) sbFetchFor(CAP.pr);
          renderPanel('sponsorblock');
        },
      }));
      SB_CATS.forEach(function (cat) {
        panel.appendChild(panelRow(SB_CAT_LABELS[cat], sbCatOn(cat) ? 'Skip' : 'Off', {
          pick: 'sbcat:' + cat, active: sbCatOn(cat),
          onPick: function () {
            if (!PREFS.sbCats) PREFS.sbCats = {};
            SB_CATS.forEach(function (c2) {
              if (PREFS.sbCats[c2] === undefined) PREFS.sbCats[c2] = true;
            });
            PREFS.sbCats[cat] = !sbCatOn(cat);
            savePrefs();
            SB.videoId = null;
            if (PREFS.sponsorBlock && CAP.pr) sbFetchFor(CAP.pr);
            renderPanel('sponsorblock');
          },
        }));
      });
    } else if (page === 'speed') {
      panel.appendChild(panelHeader('Playback Speed', true));
      SPEEDS.forEach(function (s) {
        panel.appendChild(panelRow(fmtSpeed(s), null, {
          pick: 'speed:' + s, active: PREFS.speed === s,
          onPick: function () {
            PREFS.speed = s; savePrefs(); enforceSpeed();
            showToast('Speed: ' + fmtSpeed(s) + ' on every video', 2200);
            renderPanel('main');
          },
        }));
      });
    } else if (page === 'quality') {
      panel.appendChild(panelHeader('Quality', true));
      var levels = getQualityLevels();
      var usingFallback = levels.length === 0;
      if (usingFallback) {
        // The video's own list didn't come back — offer the full
        // standard ladder as lock targets anyway (applyQuality
        // resolves each to the nearest available at-or-below), and
        // re-render once shortly in case the real list lands late.
        levels = QUALITY_ORDER.slice();
        var retryKey = (CAP.videoId || '') + ':' + CAP.gen;
        if (AUI.qRetryFor !== retryKey) {
          AUI.qRetryFor = retryKey;
          setTimeout(function () {
            if (AUI.panelOpen && AUI.page === 'quality') renderPanel('quality');
          }, 700);
        }
      }
      panel.appendChild(panelRow('Auto', null, {
        pick: 'quality:auto', active: PREFS.quality === 'auto',
        onPick: function () {
          PREFS.quality = 'auto'; savePrefs(); renderPanel('main');
          log('quality lock off (Auto)');
        },
      }));
      levels.forEach(function (l) {
        panel.appendChild(panelRow(QUALITY_LABELS[l], null, {
          pick: 'quality:' + l, active: PREFS.quality === l,
          onPick: function () {
            PREFS.quality = l; savePrefs();
            if (CAP.player) applyQuality(CAP.player, CAP.gen);
            showToast('Quality locked: ' + QUALITY_LABELS[l] + ' (or nearest available)', 2400);
            renderPanel('main');
          },
        }));
      });
    } else if (page === 'cc') {
      panel.appendChild(panelHeader('Captions', true));
      panel.appendChild(panelRow('Auto', null, {
        pick: 'caption:auto', active: PREFS.captionLang === null,
        onPick: function () { setCaptionPref(null); renderPanel('main'); },
      }));
      panel.appendChild(panelRow('Off', null, {
        pick: 'caption:off', active: PREFS.captionLang === 'off',
        onPick: function () { setCaptionPref('off'); renderPanel('main'); },
      }));
      var list = CAP.pr ? getCaptionTrackList(CAP.pr) : [];
      var seen = {};
      list.forEach(function (t) {
        var lang = t.languageCode || '';
        if (!lang || seen[lang]) return;
        seen[lang] = 1;
        panel.appendChild(panelRow(langName(lang), null, {
          pick: 'caption:' + lang, active: PREFS.captionLang === lang,
          onPick: function () { setCaptionPref(lang); renderPanel('main'); },
        }));
      });
      if (PREFS.captionLang && PREFS.captionLang !== 'off' && !seen[PREFS.captionLang]) {
        panel.appendChild(panelRow(langName(PREFS.captionLang) + ' (auto-translated here)', null, {
          pick: 'caption:' + PREFS.captionLang, active: true, onPick: function () {},
        }));
      }
    }
  
    // v2.10: rows cascade in — a short fade/rise, staggered a
    // few ms per row, capped so long pages (Queue) don't drag.
    try {
      var kids = panel.children || [];
      for (var ri = 0; ri < kids.length; ri++) {
        kids[ri].style.animation = 'ytnfRowIn .28s cubic-bezier(.2,.8,.3,1) both';
        kids[ri].style.animationDelay = Math.min(ri * 16, 160) + 'ms';
      }
    } catch (e) {}
}
  function clickYtDetect(sel) {
    var b = null;
    try { b = document.querySelector(sel); } catch (e) {}
    return !!(b && b !== CAP.video &&
      (typeof b.click === 'function' || typeof b.dispatchEvent === 'function'));
  }
  function openPanel() {
    if (!AUI.panel) return;
    renderPanel('main');
    AUI.panelOpen = true;
    // v2.10 menu animation: rise + settle from just below its
    // resting spot, fading in. The starting state is applied with
    // transitions off, then the end state a frame later.
    var token = (AUI.panelAnim = (AUI.panelAnim || 0) + 1);
    AUI.panel.style.display = 'block';
    AUI.panel.style.pointerEvents = 'auto';
    AUI.panel.style.transition = 'none';
    AUI.panel.style.opacity = '0';
    AUI.panel.style.transform = 'translateY(12px) scale(.96)';
    setTimeout(function () {
      if (!AUI.panelOpen || AUI.panelAnim !== token) return;
      AUI.panel.style.transition =
        'opacity .2s ease, transform .26s cubic-bezier(.2,.9,.3,1.1)';
      AUI.panel.style.opacity = '1';
      AUI.panel.style.transform = 'translateY(0) scale(1)';
    }, 20);
    // Kurt (Nov 25): the lower-right buttons disappear while the
    // menu is up — they sit right where the panel opens.
    applyChromeState(AUI.gearPill, false);
    if (AUI.hideTimer) { clearTimeout(AUI.hideTimer); AUI.hideTimer = null; }
  }
  function closePanel() {
    AUI.panelOpen = false;
    if (AUI.panel) {
      // Fade/slide out, then take it out of layout once the
      // motion is done (unless it was reopened in the meantime).
      var token = (AUI.panelAnim = (AUI.panelAnim || 0) + 1);
      AUI.panel.style.pointerEvents = 'none';
      AUI.panel.style.transition =
        'opacity .18s ease, transform .18s ease';
      AUI.panel.style.opacity = '0';
      AUI.panel.style.transform = 'translateY(8px) scale(.97)';
      var p = AUI.panel;
      setTimeout(function () {
        if (!AUI.panelOpen && AUI.panelAnim === token) p.style.display = 'none';
      }, 190);
    }
    // Bring the lower-right pill back with the rest of the chrome.
    setChrome(AUI.visible);
  }
  function refreshPanel() {
    // Called by the caption/quality pipelines when their data lands;
    // if the menu is open, re-render the page the user is looking at.
    if (AUI.panelOpen) renderPanel(AUI.page || 'main');
  }

  /* ---------------- scrubbing (Apple-style drag) ---------------- */
  function scrubTo(clientX, final) {
    var v = syncVideo();
    if (!v || !AUI.scrub) return;
    var rect = null;
    try { rect = AUI.scrub.getBoundingClientRect(); } catch (e) {}
    if (!rect || !rect.width) return;
    AUI.scrubX = clientX;
    var frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (!isFinite(v.duration) || v.duration <= 0) return;
    var target = frac * v.duration;
    // The bar follows the finger immediately (optimistic readout);
    // the actual seek is throttled to ~90ms during the drag so a
    // long swipe doesn't fire hundreds of seeks, with one exact
    // final seek on release.
    if (AUI.scrubFill) AUI.scrubFill.style.width = (frac * 100).toFixed(2) + '%';
    if (AUI.scrubKnob) AUI.scrubKnob.style.left = (frac * 100).toFixed(2) + '%';
    if (AUI.hairFill) AUI.hairFill.style.width = (frac * 100).toFixed(2) + '%';
    if (AUI.tElapsed) AUI.tElapsed.textContent = fmtTime(target);
    if (AUI.tRemain) AUI.tRemain.textContent = '-' + fmtTime(v.duration - target);
    if (AUI.scrubBubble) {
      var delta = target - (v.currentTime || 0);
      var ch = chapterAt(target);
      if (AUI.scrubBubbleText) {
        AUI.scrubBubbleText.textContent = fmtTime(target) +
          (delta >= 1 ? '  (+' + fmtTime(delta) + ')' :
            delta <= -1 ? '  (-' + fmtTime(-delta) + ')' : '') +
          (ch ? ' · ' + ch.title : '');
      }
      var thumbShown = false;
      if (AUI.scrubThumb) {
        var th = boardThumbAt(target);
        if (th) {
          var scale = Math.min(1, 160 / th.w);
          AUI.scrubThumb.style.display = 'block';
          AUI.scrubThumb.style.width = Math.round(th.w * scale) + 'px';
          AUI.scrubThumb.style.height = Math.round(th.h * scale) + 'px';
          AUI.scrubThumb.style.backgroundImage = 'url("' + th.url + '")';
          AUI.scrubThumb.style.backgroundSize =
            Math.round(th.sheetW * scale) + 'px ' + Math.round(th.sheetH * scale) + 'px';
          AUI.scrubThumb.style.backgroundPosition =
            '-' + Math.round(th.x * scale) + 'px -' + Math.round(th.y * scale) + 'px';
          thumbShown = true;
        } else {
          AUI.scrubThumb.style.display = 'none';
        }
      }
      var half = thumbShown ? 86 : 42;
      AUI.scrubBubble.style.left =
        Math.min(rect.width - half, Math.max(half, frac * rect.width)) + 'px';
    }
    var now = Date.now();
    if (final || !AUI.lastSeekAt || now - AUI.lastSeekAt >= 90) {
      AUI.lastSeekAt = now;
      try { v.currentTime = target; } catch (e) {}
    }
  }

  /* ---------------- compact layout (miniplayer) ----------------
   * The overlay lives inside #movie_player, so it follows the
   * player into YouTube's miniplayer — where the full-size chrome
   * is oversized (Kurt's screenshot, Nov 14). When the player is
   * miniplayer-width, shrink the cluster, tighten the bar, and
   * drop the buttons that don't belong there (settings menu,
   * miniplayer itself, remaining-time). Width is used because
   * it's true regardless of which class/attribute YouTube's
   * current build puts on the miniplayer. */
  var layoutPollStarted = false;
  function setBtnSize(b, px, fs) {
    if (!b) return;
    b.style.width = px + 'px'; b.style.height = px + 'px'; b.style.fontSize = fs + 'px';
  }
  function refreshLayout() {
    if (!AUI.player || !AUI.root) return;
    var w = 0;
    try {
      var r = AUI.player.getBoundingClientRect && AUI.player.getBoundingClientRect();
      w = r ? r.width : (AUI.player.offsetWidth || 0);
    } catch (e) {}
    var compact = w > 0 && w <= 480;
    if (compact === AUI.compact) { syncTopChrome(); return; }
    AUI.compact = compact;
    syncTopChrome();
    if (!AUI.center || !AUI.bottom) return;
    if (compact) {
      AUI.center.style.gap = '18px';
      setBtnSize(AUI.playBtn, 56, 22);
      setBtnSize(AUI.backBtn, 44, 13);
      setBtnSize(AUI.fwdBtn, 44, 13);
      if (AUI.gearBtn) AUI.gearBtn.style.display = 'none';
      if (AUI.miniBtn) AUI.miniBtn.style.display = 'none';
      if (AUI.tRemain) AUI.tRemain.style.display = 'none';
      closePanel();
    } else {
      AUI.center.style.gap = '56px';
      setBtnSize(AUI.playBtn, 78, 30);
      setBtnSize(AUI.backBtn, 58, 17);
      setBtnSize(AUI.fwdBtn, 58, 17);
      if (AUI.gearBtn) AUI.gearBtn.style.display = '';
      if (AUI.miniBtn) AUI.miniBtn.style.display = '';
      if (AUI.tRemain) AUI.tRemain.style.display = '';
      // v2.10: this branch runs only on the compact -> full
      // transition, i.e. the moment the miniplayer restores.
      // Re-resolve the live element right away so the transport
      // (and its paused state) is correct from the first frame
      // back, not up to a second later at the next poll.
      syncVideo();
      updateTransport();
    }
    log('layout:', compact ? 'compact (miniplayer)' : 'full', w + 'px');
  }

  /* ---------------- Liquid Glass mode (v2.6, Kurt's ask) ----------------
   * A settings toggle switches the overlay to an Apple-player
   * layout: PiP + AirPlay pill and a volume pill in the upper
   * right, miniplayer + fullscreen top left, the settings button
   * in a pill floating above a slim pill-shaped time bar that
   * carries nothing but the times and the scrubber.
   * The "glass" is backdrop-filter: the browser re-samples the
   * live content behind each element every frame, so the video
   * genuinely shows through, moving, in real time — lighter blur
   * + a bright specular top edge + a diagonal sheen gets as close
   * to Apple's Liquid Glass as web tech allows (true optical
   * refraction at the edges is native-only). Toggle off restores
   * the classic layout exactly. */
  function applyGlass(el, liquid, dark) {
    if (!el) return;
    if (liquid) {
      // Dark liquid glass (Nov 25, Kurt's screenshot): the white
      // sheen blew out over bright scenes and the white icons
      // vanished into it. Every liquid element now sits on a dark
      // tint — the live video still shows through the blur, but
      // the chrome stays readable in any scene. The centre
      // buttons (dark) go a shade deeper still.
      el.style.background = dark
        ? 'linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,.03) 50%,rgba(255,255,255,.01)),linear-gradient(rgba(18,18,22,.55),rgba(18,18,22,.55))'
        : 'linear-gradient(135deg,rgba(255,255,255,.20),rgba(255,255,255,.05) 45%,rgba(255,255,255,.02)),linear-gradient(rgba(22,22,27,.44),rgba(22,22,27,.44))';
      el.style.backdropFilter = 'blur(16px) saturate(180%) brightness(1.05)';
      el.style.webkitBackdropFilter = 'blur(16px) saturate(180%) brightness(1.05)';
      el.style.border = '1px solid rgba(255,255,255,.38)';
      el.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.5),inset 0 -10px 18px rgba(255,255,255,.07),0 10px 32px rgba(0,0,0,.30)';
    } else {
      el.style.background = 'rgba(28,28,30,.28)';
      el.style.backdropFilter = 'blur(26px) saturate(200%)';
      el.style.webkitBackdropFilter = 'blur(26px) saturate(200%)';
      el.style.border = '1px solid rgba(255,255,255,.24)';
      el.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.28),0 8px 28px rgba(0,0,0,.32)';
    }
  }

  function airplaySVG(active) {
    var c = active ? '#0A84FF' : '#fff';
    var glow = active
      ? ' style="filter:drop-shadow(0 0 5px rgba(10,132,255,.95)) drop-shadow(0 0 12px rgba(10,132,255,.45));"'
      : '';
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + c + '" ' +
      'stroke-width="1.8" aria-hidden="true"' + glow + '>' +
      '<rect x="3" y="4.5" width="18" height="12" rx="2.5"/>' +
      '<path d="M8 20.6 12 15.8l4 4.8z" fill="' + c + '" stroke="none"/></svg>';
  }
  function speakerSVG(level) {
    var waves = '';
    if (level > 0) {
      waves = '<path d="M15.5 9.8a3.2 3.2 0 0 1 0 4.4"/>';
      if (level >= 0.5) waves += '<path d="M18.2 7.2a7 7 0 0 1 0 9.6"/>';
    }
    var slash = level <= 0 ? '<path d="M4.5 4.5l15 15"/>' : '';
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 9.5v5h3.5L12 18.6V5.4L7.5 9.5H4z" fill="#fff" stroke="none"/>' +
      waves + slash + '</svg>';
  }

  function updateVolumeUI() {
    if (!AUI.volFill) return;
    var v = CAP.video;
    var vol = 0, muted = true;
    if (v) {
      vol = typeof v.volume === 'number' ? v.volume : 0;
      muted = !!v.muted || vol <= 0;
    }
    var pct = muted ? 0 : Math.round(vol * 100);
    AUI.volFill.style.width = pct + '%';
    if (AUI.volKnob) AUI.volKnob.style.left = pct + '%';
    if (AUI.volBtn) AUI.volBtn.innerHTML = speakerSVG(muted ? 0 : vol);
  }

  function togglePlayPause() {
    AUI.resumeGuardUntil = 0; // a deliberate pause always sticks
    var v = syncVideo(); if (!v) return;
    var wantPlay = v.paused || v.ended;
    try { if (wantPlay) v.play(); else v.pause(); } catch (err) {}
    if (wantPlay) {
      // v2.10: verify the play actually took. After a miniplayer
      // pause + restore, element.play() can land on a player the
      // miniplayer left in a held state — re-resolve the live
      // element and retry, and if it's still stuck, go through
      // YouTube's own player API (playVideo is the channel the
      // miniplayer's own unpause button uses).
      setTimeout(function () {
        var lv = syncVideo();
        if (!lv || !lv.paused || lv.ended) return;
        try { lv.play(); } catch (err) {}
        try {
          var pl = findPlayer();
          if (pl && typeof pl.playVideo === 'function') pl.playVideo();
        } catch (err) {}
        updateTransport();
      }, 160);
    }
    updateTransport();
  }

  function onPresentationExit(v) {
    if (!PREFS.resumeOnExit) return;
    if (!v || v.ended) return;
    var wasPlaying = !v.paused ||
      (AUI.lastPlayingAt && Date.now() - AUI.lastPlayingAt < 1500);
    if (!wasPlaying) return;
    AUI.resumeGuardUntil = Date.now() + 800;
    try { if (v.paused) v.play(); } catch (e) {}
    setTimeout(function () {
      if (PREFS.resumeOnExit && v.paused && !v.ended) {
        try { v.play(); } catch (e) {}
      }
    }, 300);
    log('resume-after-exit: keeping playback going');
  }

  function setVolumeFromX(clientX) {
    var v = syncVideo();
    if (!v || !AUI.volTrack) return;
    var rect = null;
    try { rect = AUI.volTrack.getBoundingClientRect(); } catch (e) {}
    if (!rect || !rect.width) return;
    var frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try {
      v.volume = frac;
      if (frac > 0 && v.muted) v.muted = false;
    } catch (e) {}
    updateVolumeUI();
  }

  function syncTopChrome() {
    // v2.7: the pill layout is the layout in BOTH modes (Kurt:
    // "bring the layout changes back to the original UI") — the
    // toggle now switches only the glass. Hidden in the
    // miniplayer, where there's no room for it.
    var show = !AUI.compact;
    if (AUI.topBar) AUI.topBar.style.display = show ? 'flex' : 'none';
    if (AUI.gearPill) AUI.gearPill.style.display = show ? 'flex' : 'none';
  }

  function applyLayoutMode() {
    var liquid = !!PREFS.liquidGlass;
    AUI.mode = liquid ? 'liquid' : 'classic';
    if (!AUI.root || !AUI.bottom) return;
    var b = AUI.bottom;
    // Permanent homes (v2.7, Kurt's order): upper left pill =
    // Fullscreen, PiP, AirPlay; upper right = volume only;
    // lower right pill = Miniplayer, Settings. The bottom bar
    // carries only the times + scrubber in both modes.
    if (AUI.topPillL) {
      AUI.topPillL.appendChild(AUI.fsBtn);
      AUI.topPillL.appendChild(AUI.pipBtn);
      AUI.topPillL.appendChild(AUI.airplayBtn);
    }
    if (AUI.gearPill) {
      AUI.gearPill.appendChild(AUI.miniBtn);
      AUI.gearPill.appendChild(AUI.gearBtn);
    }
    if (liquid) {
      b.style.borderRadius = '999px';
      b.style.padding = '6px 16px';
      b.style.left = '10px'; b.style.right = '10px'; b.style.bottom = '10px';
      b.style.gap = '10px';
      if (AUI.scrubTrack) AUI.scrubTrack.style.height = '3.5px';
      if (AUI.scrubKnob) { AUI.scrubKnob.style.width = '12px'; AUI.scrubKnob.style.height = '12px'; }
      if (AUI.tElapsed) AUI.tElapsed.style.fontSize = '12.5px';
      if (AUI.tRemain) AUI.tRemain.style.fontSize = '12.5px';
      if (AUI.gearPill) AUI.gearPill.style.bottom = '82px';
    } else {
      b.style.borderRadius = '18px';
      b.style.padding = '8px 12px';
      b.style.left = '12px'; b.style.right = '12px'; b.style.bottom = '12px';
      b.style.gap = '12px';
      if (AUI.scrubTrack) AUI.scrubTrack.style.height = '5px';
      if (AUI.scrubKnob) { AUI.scrubKnob.style.width = '15px'; AUI.scrubKnob.style.height = '15px'; }
      if (AUI.tElapsed) AUI.tElapsed.style.fontSize = '13px';
      if (AUI.tRemain) AUI.tRemain.style.fontSize = '13px';
      if (AUI.gearPill) AUI.gearPill.style.bottom = '92px';
    }
    [AUI.bottom, AUI.panel, AUI.topPillL, AUI.topPillR, AUI.volPill, AUI.gearPill,
     AUI.gearBtn, AUI.miniBtn, AUI.pipBtn, AUI.fsBtn, AUI.airplayBtn, AUI.volBtn,
    ].forEach(function (el) { applyGlass(el, liquid, false); });
    [AUI.playBtn, AUI.backBtn, AUI.fwdBtn].forEach(function (el) { applyGlass(el, liquid, true); });
    syncTopChrome();
    setChrome(AUI.visible);
    updateVolumeUI();
    log('layout mode:', AUI.mode);
  }

  /* ---------------- build ---------------- */
  function circleBtn(size, fontSize, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = GLASS + FONT +
      'width:' + size + 'px;height:' + size + 'px;border-radius:50%;flex:none;' +
      'font-size:' + fontSize + 'px;line-height:1;display:flex;align-items:center;justify-content:center;' +
      'cursor:pointer;pointer-events:auto;padding:0;';
    return b;
  }

  function buildAppleUI(player) {
    try {
      var old = document.getElementById('ytnf-apple');
      if (old) old.remove();
      if (AUI.hideTimer) { clearTimeout(AUI.hideTimer); AUI.hideTimer = null; }
      AUI.player = player;
      AUI.page = 'main';
      AUI.panelOpen = false;

      var root = document.createElement('div');
      root.id = 'ytnf-apple';
      root.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;z-index:58;pointer-events:none;' + FONT;

      /* centre transport cluster */
      var center = document.createElement('div');
      center.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
        'display:flex;justify-content:center;align-items:center;gap:56px;' +
        'opacity:0;visibility:hidden;transition:opacity .25s ease;pointer-events:none;';
      var backBtn = circleBtn(58, 17, '↺10');
      backBtn.dataset.act = 'back';
      backBtn.title = 'Back 10 seconds';
      var playBtn = circleBtn(78, 30, '▶︎');
      playBtn.dataset.act = 'play';
      playBtn.title = 'Play / pause';
      var fwdBtn = circleBtn(58, 17, '10↻');
      fwdBtn.dataset.act = 'fwd';
      fwdBtn.title = 'Forward 10 seconds';
      backBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        var v = syncVideo(); if (!v) return;
        try { v.currentTime = Math.max(0, (v.currentTime || 0) - 10); } catch (err) {}
        updateTransport(); showUI();
      });
      playBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        togglePlayPause();
        showUI();
      });
      fwdBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        var v = syncVideo(); if (!v) return;
        try {
          var d = isFinite(v.duration) ? v.duration : (v.currentTime || 0) + 10;
          v.currentTime = Math.min(d, (v.currentTime || 0) + 10);
        } catch (err) {}
        updateTransport(); showUI();
      });
      center.appendChild(backBtn); center.appendChild(playBtn); center.appendChild(fwdBtn);
      root.appendChild(center);

      /* floating bottom bar */
      var bottom = document.createElement('div');
      bottom.style.cssText = GLASS + FONT +
        'position:absolute;left:12px;right:12px;bottom:12px;border-radius:18px;' +
        'display:flex;align-items:center;gap:12px;padding:8px 12px;' +
        'opacity:0;visibility:hidden;transition:opacity .25s ease;pointer-events:none;';
      var tElapsed = document.createElement('span');
      tElapsed.style.cssText = 'font-size:13px;font-weight:500;font-variant-numeric:tabular-nums;min-width:42px;text-align:right;';
      tElapsed.textContent = '0:00';
      var scrub = document.createElement('div');
      scrub.dataset.act = 'scrub';
      scrub.style.cssText = 'position:relative;flex:1;height:44px;pointer-events:auto;touch-action:none;cursor:pointer;';
      var track = document.createElement('div');
      track.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:5px;' +
        'border-radius:999px;background:rgba(255,255,255,.3);';
      var fill = document.createElement('div');
      fill.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:0%;border-radius:999px;background:#fff;';
      track.appendChild(fill);
      var knob = document.createElement('div');
      knob.style.cssText = 'position:absolute;top:50%;left:0%;width:15px;height:15px;border-radius:50%;' +
        'background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.55);transform:translate(-50%,-50%);';
      scrub.appendChild(track); scrub.appendChild(knob);
      var bubble = document.createElement('div');
      bubble.style.cssText = GLASS + FONT +
        'position:absolute;bottom:54px;left:36px;transform:translateX(-50%);' +
        'display:none;flex-direction:column;align-items:center;gap:5px;' +
        'padding:7px 9px;border-radius:14px;';
      var bThumb = document.createElement('div');
      bThumb.style.cssText = 'display:none;border-radius:8px;background-repeat:no-repeat;background-color:rgba(255,255,255,.08);';
      var bLabel = document.createElement('span');
      bLabel.style.cssText = 'font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;';
      bubble.appendChild(bThumb);
      bubble.appendChild(bLabel);
      scrub.appendChild(bubble);
      var tRemain = document.createElement('span');
      tRemain.style.cssText = 'font-size:13px;font-weight:500;font-variant-numeric:tabular-nums;min-width:46px;color:rgba(255,255,255,.85);';
      var gearBtn = circleBtn(44, 19, '');
      gearBtn.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
      gearBtn.dataset.act = 'menu';
      gearBtn.title = 'Settings';
      var fsBtn = circleBtn(44, 0, '');
      fsBtn.innerHTML =
        // Drawn corners instead of the ⛶ text glyph (Kurt,
        // Nov 25): the glyph rendered hairline-thin next to the
        // other icons; 2.3px strokes match their weight.
        '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
        'stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M8.5 3.8H5A1.2 1.2 0 0 0 3.8 5v3.5M15.5 3.8H19A1.2 1.2 0 0 1 20.2 5v3.5' +
        'M8.5 20.2H5A1.2 1.2 0 0 1 3.8 19v-3.5M15.5 20.2H19a1.2 1.2 0 0 0 1.2-1.2v-3.5"/></svg>';
      fsBtn.dataset.act = 'fs';
      fsBtn.title = 'Full screen (native player)';
      gearBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        if (AUI.panelOpen) { closePanel(); scheduleHide(); }
        else { showUI(); openPanel(); }
      });
      var miniBtn = circleBtn(44, 0, '');
      miniBtn.innerHTML =
        '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
        'stroke-width="2" aria-hidden="true">' +
        '<rect x="2.5" y="4.5" width="19" height="15" rx="3.5"/>' +
        '<rect x="12.5" y="12" width="6.5" height="5" rx="1.2" fill="#fff" stroke="none"/></svg>';
      miniBtn.dataset.act = 'mini';
      miniBtn.title = 'Miniplayer (i)';
      miniBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        hideUI();
        activateMiniplayer();
      });
      var pipBtn = circleBtn(44, 0, '');
      pipBtn.innerHTML =
        // Apple's pip.enter glyph (Kurt, Nov 25): wide rounded
        // outline, small filled window bottom-right, and the
        // arrow in the upper left pointing INTO the small window.
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="2" y="5.5" width="20" height="13" rx="3"/>' +
        '<rect x="13" y="11.5" width="6.5" height="4.8" rx="1.3" fill="#fff" stroke="none"/>' +
        '<path d="M5.6 8.2 10.4 13M7.2 13h3.2V9.8" stroke-width="1.7"/></svg>';
      pipBtn.dataset.act = 'pip';
      pipBtn.title = 'Picture in Picture';
      pipBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        togglePiP();
        showUI();
      });
      fsBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        activateNativeFullscreen();
      });
      bottom.appendChild(tElapsed); bottom.appendChild(scrub); bottom.appendChild(tRemain);
      bottom.appendChild(gearBtn); bottom.appendChild(miniBtn); bottom.appendChild(pipBtn);
      bottom.appendChild(fsBtn);
      root.appendChild(bottom);

      /* settings panel */
      var panel = document.createElement('div');
      panel.id = 'ytnf-panel';
      panel.style.cssText = GLASS + FONT +
        'touch-action:pan-y;' +
        'display:none;position:absolute;right:12px;bottom:84px;width:288px;max-width:86%;' +
        'max-height:62%;overflow:auto;border-radius:16px;padding:8px;pointer-events:auto;' +
        'transform-origin:bottom right;opacity:0;';
      panel.addEventListener('click', function (e) { try { e.stopPropagation(); } catch (err) {} });
      // Kurt (Nov 25): swiping down on the menu dragged the whole
      // player into the miniplayer — YouTube's drag-down gesture
      // listens on the player, and the panel floats above it. The
      // gesture dies at the panel: touch/pointer starts and moves
      // never propagate past it, while touch-action:pan-y keeps
      // the panel's own vertical scrolling working.
      ['touchstart', 'touchmove', 'pointerdown'].forEach(function (type) {
        panel.addEventListener(type, function (e) { try { e.stopPropagation(); } catch (err) {} });
      });
      try { panel.classList.add('ytnf-panel'); } catch (err) {}
      root.appendChild(panel);

      /* always-on hairline progress (PiP-style sliver) */
      var hair = document.createElement('div');
      hair.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.18);pointer-events:none;';
      var hairFill = document.createElement('div');
      hairFill.style.cssText = 'height:100%;width:0%;background:rgba(255,255,255,.85);';
      hair.appendChild(hairFill);
      root.appendChild(hair);

      /* ---- Liquid-mode chrome (built always, shown only in liquid
         mode; the buttons are the SAME elements reparented by
         applyLayoutMode, so their handlers never change) ---- */
      function pillEl(extra) {
        var p = document.createElement('div');
        p.style.cssText = GLASS + FONT +
          'display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;pointer-events:auto;' +
          (extra || '');
        return p;
      }
      var airplayBtn = circleBtn(44, 0, '');
      airplayBtn.innerHTML = airplaySVG(!!AUI.airplayWireless);
      airplayBtn.dataset.act = 'airplay';
      airplayBtn.title = 'AirPlay';
      airplayBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        var v = syncVideo(); if (!v) return;
        if (typeof v.webkitShowPlaybackTargetPicker === 'function') {
          try { v.webkitShowPlaybackTargetPicker(); }
          catch (err) { showToast('AirPlay picker failed'); }
        } else {
          showToast('AirPlay is not available for this video in the browser');
        }
        showUI();
      });
      var volBtn = circleBtn(34, 0, '');
      volBtn.innerHTML = speakerSVG(0.8);
      volBtn.dataset.act = 'volbtn';
      volBtn.title = 'Mute / unmute';
      volBtn.addEventListener('click', function (e) {
        try { e.stopPropagation(); } catch (err) {}
        var v = syncVideo(); if (!v) return;
        try {
          v.muted = !v.muted;
          if (!v.muted && (v.volume || 0) <= 0) v.volume = 0.5;
        } catch (err) {}
        updateVolumeUI();
        showUI();
      });
      var volTrack = document.createElement('div');
      volTrack.dataset.act = 'vol';
      volTrack.style.cssText = 'position:relative;width:92px;height:36px;flex:none;' +
        'pointer-events:auto;touch-action:none;cursor:pointer;';
      var volRail = document.createElement('div');
      volRail.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
        'height:4px;border-radius:999px;background:rgba(255,255,255,.32);';
      var volFill = document.createElement('div');
      volFill.style.cssText = 'position:absolute;left:0;top:0;height:100%;width:80%;' +
        'border-radius:999px;background:#fff;';
      volRail.appendChild(volFill);
      var volKnob = document.createElement('div');
      volKnob.style.cssText = 'position:absolute;top:50%;left:80%;width:12px;height:12px;' +
        'border-radius:50%;background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.5);transform:translate(-50%,-50%);';
      volTrack.appendChild(volRail); volTrack.appendChild(volKnob);
      volTrack.addEventListener('pointerdown', function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
        try { if (e.pointerId != null && volTrack.setPointerCapture) volTrack.setPointerCapture(e.pointerId); } catch (err) {}
        AUI.volScrubbing = true;
        setVolumeFromX(e.clientX);
        showUI();
      });
      var topPillL = pillEl('');
      var topPillR = pillEl('');
      var volPill = pillEl('gap:8px;padding:4px 12px 4px 5px;');
      volPill.appendChild(volBtn); volPill.appendChild(volTrack);
      var rightGroup = document.createElement('div');
      rightGroup.style.cssText = 'display:flex;align-items:center;gap:10px;pointer-events:none;';
      rightGroup.appendChild(volPill);
      var topBar = document.createElement('div');
      topBar.style.cssText = 'position:absolute;left:12px;right:12px;top:10px;display:none;' +
        'justify-content:space-between;align-items:flex-start;pointer-events:none;' +
        'opacity:0;visibility:hidden;transition:opacity .25s ease;' + FONT;
      topBar.appendChild(topPillL); topBar.appendChild(rightGroup);
      root.appendChild(topBar);
      var gearPill = pillEl('position:absolute;right:12px;bottom:68px;display:none;' +
        'opacity:0;visibility:hidden;transition:opacity .25s ease;');
      root.appendChild(gearPill);

      root.addEventListener('click', function (e) { try { e.stopPropagation(); } catch (err) {} });

      /* scrub wiring: pointerdown on the track, move/up on document.
         The document handlers register ONCE (they read AUI state at
         event time) — re-registering on every rebuild stacked
         duplicate handlers across navigations. */
      scrub.addEventListener('pointerdown', function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
        var v = syncVideo(); if (!v) return;
        try { if (e.pointerId != null && scrub.setPointerCapture) scrub.setPointerCapture(e.pointerId); } catch (err) {}
        AUI.scrubbing = true;
        AUI.wasPlaying = !v.paused && !v.ended;
        if (AUI.wasPlaying) { try { v.pause(); } catch (err) {} }
        knob.style.transform = 'translate(-50%,-50%) scale(1.35)';
        if (AUI.scrubBubble) AUI.scrubBubble.style.display = 'flex';
        scrubTo(e.clientX);
        showUI();
      });
      if (!scrubDocWired) {
        scrubDocWired = true;
        document.addEventListener('pointermove', function (e) {
          if (AUI.scrubbing) scrubTo(e.clientX);
          if (AUI.volScrubbing) setVolumeFromX(e.clientX);
        });
        document.addEventListener('pointerup', function () {
          if (AUI.volScrubbing) AUI.volScrubbing = false;
          if (!AUI.scrubbing) return;
          AUI.scrubbing = false;
          if (AUI.scrubKnob) AUI.scrubKnob.style.transform = 'translate(-50%,-50%)';
          if (AUI.scrubBubble) AUI.scrubBubble.style.display = 'none';
          if (AUI.scrubX != null) scrubTo(AUI.scrubX, true); // exact final seek
          var v = syncVideo();
          if (v && AUI.wasPlaying) { try { v.play(); } catch (err) {} }
          AUI.wasPlaying = false;
          AUI.lastActivity = Date.now();
          updateTransport();
          scheduleHide();
        });
        document.addEventListener('pointercancel', function () {
          if (!AUI.scrubbing) return;
          AUI.scrubbing = false;
          if (AUI.scrubKnob) AUI.scrubKnob.style.transform = 'translate(-50%,-50%)';
          if (AUI.scrubBubble) AUI.scrubBubble.style.display = 'none';
          var v = syncVideo();
          if (v && AUI.wasPlaying) { try { v.play(); } catch (err) {} }
          AUI.wasPlaying = false;
          updateTransport();
          scheduleHide();
        });
      }

      /* tap on the video toggles our chrome (YouTube still handles
         play/pause on the same tap) */
      if (typeof player.addEventListener === 'function' && !player.__ytnfUiWired) {
        player.__ytnfUiWired = true;
        player.addEventListener('click', function (e) {
          if (e && e.__ytnfTap) return; // capture-phase tap already handled it
          var t = e && e.target;
          if (t && typeof t.closest === 'function' && t.closest('#ytnf-apple')) return;
          toggleUI();
        });
        player.addEventListener('mousemove', function () { if (!AUI.visible) showUI(); });
      }
      var vid = CAP.video;
      if (vid) wireTransport(vid);

      AUI.root = root; AUI.center = center; AUI.bottom = bottom; AUI.panel = panel;
      AUI.playBtn = playBtn; AUI.backBtn = backBtn; AUI.fwdBtn = fwdBtn;
      AUI.gearBtn = gearBtn; AUI.fsBtn = fsBtn; AUI.miniBtn = miniBtn; AUI.pipBtn = pipBtn;
      AUI.scrub = scrub; AUI.scrubFill = fill; AUI.scrubKnob = knob; AUI.hairFill = hairFill;
      AUI.scrubBubble = bubble; AUI.scrubTrack = track;
      AUI.scrubThumb = bThumb; AUI.scrubBubbleText = bLabel;
      AUI.topBar = topBar; AUI.topPillL = topPillL; AUI.topPillR = topPillR;
      AUI.volPill = volPill; AUI.volTrack = volTrack; AUI.volFill = volFill;
      var holdChip = document.createElement('div');
      holdChip.textContent = '2×';
      holdChip.style.cssText = GLASS + FONT +
        'position:absolute;top:64px;left:50%;transform:translateX(-50%);' +
        'padding:6px 14px;border-radius:999px;font-size:14px;font-weight:700;display:none;pointer-events:none;';
      root.appendChild(holdChip);
      AUI.holdChip = holdChip;
      AUI.volKnob = volKnob; AUI.volBtn = volBtn; AUI.airplayBtn = airplayBtn;
      AUI.gearPill = gearPill;
      AUI.tElapsed = tElapsed; AUI.tRemain = tRemain;
      AUI.visible = false;
      AUI.shownAt = 0; AUI.lastActivity = 0;
      try { window.__ytnfAUI = AUI; } catch (e) {}
      AUI.refreshLayout = refreshLayout;
      AUI.syncVideo = syncVideo;
      wireScrollPip(player);
      if (!layoutPollStarted && typeof setInterval === 'function') {
        layoutPollStarted = true;
        setInterval(function () { refreshLayout(); syncVideo(); refreshAdState(); }, 1000);
      }
      refreshLayout();
      applyLayoutMode();

      player.appendChild(root);
      wireTapToggle();
      wireHoldSpeed();
      wireQueueTouchDrag();
      ensureBelowPlayerGlass();
      try { if (player.classList) player.classList.add('ytnf-on'); } catch (e) {}
      injectChromeHideStyle();
      updateTransport();
      log('Apple-style UI mounted');
    } catch (e) { log('Apple UI failed:', e && e.message); }
  }

  var scrubDocWired = false;
  var tapWired = false;
  // Is this event a tap on the video surface (as opposed to a tap
  // on something interactive inside the player)? v2.8 broadened
  // the scope: the old check required the target to be the video,
  // its container or the bezel, but on touch screens YouTube
  // receives the tap on overlay layers above the video (the
  // touch-feedback layer and friends), so taps slipped past the
  // v2.1 rule and still paused. Now: anything inside the player
  // that is not our overlay and not YouTube interactive chrome
  // (buttons, links, menus, the control bars, cards, endscreen)
  // counts as a video tap.
  var YT_INTERACTIVE =
    'a, button, input, textarea, select, [role="button"], ' +
    '.ytp-chrome-bottom, .ytp-chrome-top, .ytp-popup, .ytp-panel, ' +
    '.ytp-menuitem, .ytp-watermark, .ytp-pause-overlay, ' +
    '.ytp-cards, .ytp-celebration, .ytp-endscreen-content, ' +
    '.ytp-suggested-action, .iv-drawer, .ytp-info-panel';
  function isVideoTapTarget(t) {
    if (!t || typeof t.closest !== 'function') return false;
    if (t.closest('#ytnf-apple')) return false; // our own UI handles itself
    if (!t.closest('#movie_player, .html5-video-player')) return false;
    if (t.closest(YT_INTERACTIVE)) return false;
    return true;
  }
  function isCenterTap(e) {
    if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return false;
    var p = AUI.player;
    if (!p || typeof p.getBoundingClientRect !== 'function') return false;
    var r = null;
    try { r = p.getBoundingClientRect(); } catch (err) {}
    if (!r || !r.width || !r.height) return false;
    var fx = (e.clientX - r.left) / r.width;
    var fy = (e.clientY - r.top) / r.height;
    return fx >= 0.36 && fx <= 0.64 && fy >= 0.30 && fy <= 0.70;
  }
  function wireTapToggle() {
    if (tapWired) return;
    tapWired = true;
    // Swallow the whole gesture in the capture phase — pointerdown
    // and touchstart as well as click — so no YouTube handler at
    // any stage can turn the tap into a pause. (Settings toggle
    // "Tap Screen to Pause" re-enables the stock behaviour.)
    ['pointerdown', 'touchstart'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (PREFS.tapToPause) return;
        if (!AUI.root) return; // overlay not mounted: stock behaviour
        if (isVideoTapTarget(e && e.target)) {
          try { e.stopPropagation(); } catch (err) {}
        }
      }, true);
    });
    document.addEventListener('click', function (e) {
      if (!AUI.root) return; // overlay not mounted: stock YouTube behaviour
      if (AUI.swallowNextClick) {
        // The click that ends a hold-to-2x gesture: it belongs to
        // the hold, not to the tap system.
        AUI.swallowNextClick = false;
        e.__ytnfTap = true;
        try { e.stopPropagation(); } catch (err) {}
        try { e.preventDefault(); } catch (err) {}
        return;
      }
      // Menu open? A tap anywhere outside the panel — elsewhere in
      // the player or anywhere else on the page — puts the menu
      // away (Kurt, Nov 25). The gear button is exempt: it toggles
      // the panel itself. A dismissal tap on the video surface is
      // consumed as the dismissal (chrome stays up, no toggle).
      if (AUI.panelOpen) {
        var pt = e && e.target;
        var inPanel = !!(pt && typeof pt.closest === 'function' &&
          (pt.closest('.ytnf-panel') || pt.closest('[data-act="menu"]')));
        if (!inPanel) {
          closePanel();
          if (isVideoTapTarget(pt)) {
            e.__ytnfTap = true;
            if (!PREFS.tapToPause) {
              try { e.stopPropagation(); } catch (err) {}
              try { e.preventDefault(); } catch (err) {}
            }
            showUI();
          }
          return;
        }
      }
      if (!isVideoTapTarget(e && e.target)) return;
      // v2.11 (Kurt): with the UI hidden, a tap in the CENTRE of
      // the video — where the play/pause button would be — acts
      // as that button: it toggles playback (and brings the UI up
      // for feedback). Taps elsewhere just bring the UI up, as
      // before. Only when tap-to-pause is off; with it on,
      // YouTube's stock tap behaviour owns every tap.
      if (!AUI.visible && !PREFS.tapToPause && isCenterTap(e)) {
        e.__ytnfTap = true;
        try { e.stopPropagation(); } catch (err) {}
        try { e.preventDefault(); } catch (err) {}
        togglePlayPause();
        showUI();
        return;
      }
      // The tap toggles ONLY our UI. With tap-to-pause off (the
      // default) the click is also stopped here, in the capture
      // phase, before YouTube's own handlers can pause; with it
      // on, the click flows through and YouTube pauses as stock.
      e.__ytnfTap = true;
      if (!PREFS.tapToPause) {
        try { e.stopPropagation(); } catch (err) {}
        try { e.preventDefault(); } catch (err) {}
      }
      toggleUI();
    }, true);
  }

  var chromeStyleInjected = false;
  function injectChromeHideStyle() {
    if (chromeStyleInjected) return;
    chromeStyleInjected = true;
    try {
      var st = document.createElement('style');
      st.id = 'ytnf-apple-hide';
      st.textContent =
        '#ytnf-apple button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;' +
        'transition:transform .12s ease,opacity .25s ease}' +
        '#ytnf-apple button:active{transform:scale(.92)}' +
        '#movie_player.ytnf-on .ytp-chrome-bottom,' +
        '#movie_player.ytnf-on .ytp-chrome-top,' +
        '#movie_player.ytnf-on .ytp-gradient-bottom,' +
        '#movie_player.ytnf-on .ytp-gradient-top,' +
        '#movie_player.ytnf-on .ytp-large-play-button{display:none!important}' +
        '#movie_player.ytnf-hold2x .ytp-speedmaster-overlay,' +
        '#movie_player.ytnf-hold2x .ytp-bezel-text-wrapper,' +
        '#movie_player.ytnf-hold2x .ytp-bezel-text{display:none!important}' +
        '@keyframes ytnfRowIn{from{opacity:0;transform:translateY(5px)}' +
        'to{opacity:1;transform:translateY(0)}}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  /* ---------------- queue panel touch drag (v2.15) ----------------
   * Kurt: encapsulate YouTube's own Queue box and make dragging
   * its rows work with a touchscreen. v2.11 only translated the
   * gesture into drag events — YouTube's model got them, but the
   * row itself never moved under the finger, so it felt broken.
   * Now the drag is OURS visually (iOS-style: the row lifts, rides
   * the finger, siblings slide out of the way) and on release we
   * hand the result to YouTube's own reorder handler as a
   * synthesized dragstart/dragover/drop/dragend sequence aimed at
   * the row the finger ended on, so YouTube's model commits the
   * new order. Drags start from the row's grip zone (or an
   * explicit drag handle); the rest of the row still taps to play
   * and scrolls the list. */
  var qdWired = false;
  var qd = null;
  function makeDataTransfer() {
    var data = {};
    return {
      setData: function (k, v) { data[k] = String(v); },
      getData: function (k) { return data[k] || ''; },
      clearData: function () { data = {}; },
      types: [], files: [], items: [],
      dropEffect: 'move', effectAllowed: 'move',
      setDragImage: function () {},
    };
  }
  function fireDrag(el, type, e, dt) {
    try {
      var ev = null;
      if (typeof DragEvent === 'function') {
        ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY });
      } else if (typeof Event === 'function') {
        ev = new Event(type, { bubbles: true, cancelable: true });
      } else return;
      try { ev.dataTransfer = dt; } catch (err) {}
      try { Object.defineProperty(ev, 'dataTransfer', { value: dt }); } catch (err) {}
      el.dispatchEvent(ev);
    } catch (err) {}
  }
  function qdRows(item) {
    var rows = [];
    try {
      var p = item.parentNode;
      var kids = p && p.children ? p.children : [item];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k && k.tagName &&
            String(k.tagName).toLowerCase() === 'ytd-playlist-panel-video-renderer') rows.push(k);
      }
    } catch (e) {}
    return rows.length ? rows : [item];
  }
  function qdCleanup() {
    if (!qd) return;
    try {
      (qd.rows || []).forEach(function (r) {
        try { r.style.transform = ''; r.style.transition = ''; } catch (e) {}
      });
      qd.item.classList.remove('ytnf-dragging');
      qd.item.style.transform = '';
      qd.item.style.zIndex = '';
      qd.item.style.position = '';
    } catch (e) {}
    qd = null;
  }
  function wireQueueTouchDrag() {
    if (qdWired) return;
    qdWired = true;
    document.addEventListener('pointerdown', function (e) {
      var t = e && e.target;
      if (!t || typeof t.closest !== 'function') return;
      var item = null;
      try { item = t.closest('ytd-playlist-panel-video-renderer'); } catch (err) {}
      if (!item) return;
      var rect = null;
      try { rect = item.getBoundingClientRect(); } catch (err) {}
      if (!rect) return;
      var onHandle = false;
      try { onHandle = !!t.closest('[class*="drag"], [id*="drag"]'); } catch (err) {}
      if (!onHandle && e.clientX - rect.left > 56) return;
      // A press on the grip is a tap-that-does-nothing or a drag —
      // never a list scroll.
      try { e.preventDefault(); } catch (err) {}
      qd = { item: item, x: e.clientX, y: e.clientY, active: false, dt: null,
             rows: null, index: -1, target: -1, rowH: rect.height || 0 };
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!qd) return;
      if (!qd.active) {
        if (Math.abs(e.clientY - qd.y) < 9 && Math.abs(e.clientX - qd.x) < 9) return;
        qd.active = true;
        qd.rows = qdRows(qd.item);
        qd.index = qd.rows.indexOf(qd.item);
        qd.target = qd.index;
        if (!qd.rowH) {
          try { qd.rowH = qd.item.getBoundingClientRect().height || 0; } catch (err) {}
        }
        qd.dt = makeDataTransfer();
        fireDrag(qd.item, 'dragstart', e, qd.dt);
        try {
          qd.item.classList.add('ytnf-dragging');
          qd.item.style.position = 'relative';
          qd.item.style.zIndex = '30';
          qd.rows.forEach(function (r) {
            if (r !== qd.item) r.style.transition = 'transform .18s ease';
          });
        } catch (err) {}
      }
      var dy = e.clientY - qd.y;
      var maxUp = -qd.index * qd.rowH;
      var maxDown = (qd.rows.length - 1 - qd.index) * qd.rowH;
      if (dy < maxUp) dy = maxUp;
      if (dy > maxDown) dy = maxDown;
      try { qd.item.style.transform = 'translateY(' + dy + 'px)'; } catch (err) {}
      var target = qd.index;
      if (qd.rowH > 0) {
        target = qd.index + Math.round(dy / qd.rowH);
        if (target < 0) target = 0;
        if (target > qd.rows.length - 1) target = qd.rows.length - 1;
      }
      qd.target = target;
      qd.rows.forEach(function (r, p) {
        if (r === qd.item) return;
        var shift = 0;
        if (target > qd.index && p > qd.index && p <= target) shift = -qd.rowH;
        if (target < qd.index && p < qd.index && p >= target) shift = qd.rowH;
        try { r.style.transform = shift ? 'translateY(' + shift + 'px)' : ''; } catch (err) {}
      });
      var over = qd.rows[target];
      if (over && over !== qd.item) fireDrag(over, 'dragover', e, qd.dt);
      try { e.preventDefault(); } catch (err) {}
    }, true);
    function endDrag(e, cancelled) {
      if (!qd) return;
      var wasActive = qd.active;
      var item = qd.item, rows = qd.rows, index = qd.index,
        target = qd.target, dt = qd.dt;
      if (wasActive) {
        if (!cancelled && rows && target !== index && rows[target]) {
          fireDrag(rows[target], 'dragover', e, dt);
          fireDrag(rows[target], 'drop', e, dt);
        }
        fireDrag(item, 'dragend', e, dt);
      }
      qdCleanup();
    }
    document.addEventListener('pointerup', function (e) { endDrag(e, false); }, true);
    document.addEventListener('pointercancel', function (e) { endDrag(e, true); }, true);
  }

  /* ---------------- below-the-player glass (v2.12) ----------------
   * v2.11 tried to glass the Queue box and the description from
   * player.css alone, and on-device NEITHER ever applied (Kurt).
   * Live inspection of a watch page (Nov 25) showed why: the
   * description box is a #description element inside
   * ytd-watch-metadata's SHADOW ROOT — page CSS cannot select
   * into a shadow tree at all — and the queue panel's paint is
   * governed from inside ytd-playlist-panel-renderer's own
   * shadow tree. So the glass now goes in from here: a <style>
   * injected INTO each component's shadow root (the one place
   * that can reach the elements painting those boxes), plus
   * inline styles on the panel host as a second layer. A slow
   * re-check re-applies it whenever YouTube rebuilds the nodes. */
  var BELOW_GLASS = {
    panel:
      ':host { background: rgba(30,30,34,.94) !important;' +
      ' border: 1px solid rgba(255,255,255,.10) !important;' +
      ' border-radius: 12px !important; }' +
      ' #header { background: rgba(30,30,34,.94) !important;' +
      ' border-bottom: 1px solid rgba(255,255,255,.07) !important;' +
      ' font-weight: 600; letter-spacing: -.01em; }',
    metadata:
      // v2.15: the host is the grouped card now (inline, below);
      // the description sits inside it as a lighter inset card,
      // iOS grouped-list style.
      '#description { background: rgba(255,255,255,.07) !important;' +
      ' border-radius: 10px !important; }' +
      ' #title h1 { font-weight: 600; letter-spacing: -.01em; }',
  };
  function injectShadowGlass(host, cssText) {
    if (!host) return false;
    var root = null;
    try { root = host.shadowRoot; } catch (err) {}
    if (!root || typeof root.appendChild !== 'function') return false;
    try {
      if (typeof root.querySelector === 'function' &&
          root.querySelector('style[data-ytnf-glass]')) return true;
    } catch (err) {}
    if (root.children) {
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i] && root.children[i].__ytnfGlass) return true;
      }
    }
    try {
      var st = document.createElement('style');
      try { st.setAttribute('data-ytnf-glass', '1'); } catch (err) {}
      st.__ytnfGlass = true;
      st.textContent = cssText;
      root.appendChild(st);
      return true;
    } catch (err) { return false; }
  }
  function styleBelowPlayer() {
    try {
      var panel = document.querySelector('ytd-playlist-panel-renderer');
      if (panel) {
        try {
          panel.style.background = 'rgba(30,30,34,.94)';
          panel.style.backdropFilter = '';
          panel.style.webkitBackdropFilter = '';
          panel.style.border = '1px solid rgba(255,255,255,.10)';
          panel.style.borderRadius = '12px';
        } catch (err) {}
        injectShadowGlass(panel, BELOW_GLASS.panel);
      }
      var meta = document.querySelector('ytd-watch-metadata');
      if (meta) {
        // v2.15 (Kurt): the whole title / channel / description
        // block becomes one grouped card, native-iPad style; the
        // description is the inset card inside it (shadow CSS).
        try {
          meta.style.background = 'rgba(30,30,34,.94)';
          meta.style.border = '1px solid rgba(255,255,255,.10)';
          meta.style.borderRadius = '16px';
          meta.style.padding = '14px 16px';
          meta.style.boxSizing = 'border-box';
        } catch (err) {}
        injectShadowGlass(meta, BELOW_GLASS.metadata);
      }
    } catch (err) {}
  }
  var belowGlassTimer = null;
  function ensureBelowPlayerGlass() {
    styleBelowPlayer();
    if (belowGlassTimer) return;
    try { belowGlassTimer = setInterval(styleBelowPlayer, 2500); } catch (err) {}
  }
  try { window.__ytnfStyleBelow = styleBelowPlayer; } catch (err) {}
  try { window.__ytnfBelowGlass = BELOW_GLASS; } catch (err) {}

  /* ================================================================
   * Watch-page setup / navigation
   * ================================================================ */
  function watchVideoReplacement(player) {
    if (typeof MutationObserver !== 'function' || !player) return;
    if (CAP.observer) { try { CAP.observer.disconnect(); } catch (e) {} }
    var obs = new MutationObserver(function () {
      // subtree:true — the <video> sits inside .html5-video-container,
      // one level below the player; the old subtree:false watch
      // almost never saw a swap. syncVideo() adopts + re-wires.
      var before = CAP.video;
      var v = syncVideo();
      if (v && v !== before && CAP.pr) loadCaptions(v, player, CAP.pr);
    });
    try { obs.observe(player, { childList: true, subtree: true }); } catch (e) {}
    CAP.observer = obs;
  }

  var setupForId = null; // videoId the live overlay was built for
  function setupWatch() {
    armSleepTimer();
    checkForUpdates(false);
    var vid = isWatchPage() ? currentVideoId() : null;
    // One navigation fires setupWatch up to three times (document +
    // window yt-navigate-finish, plus the href poll). If the overlay
    // already serves this video and the player is alive, a duplicate
    // run only tears state down — coalesce it into a re-sync.
    if (vid && setupForId === vid && AUI.root && findPlayer()) { syncVideo(); return; }
    CAP.gen++;
    var gen = CAP.gen;
    clearCaptionTracks();
    if (CAP.observer) { try { CAP.observer.disconnect(); } catch (e) {} CAP.observer = null; }
    CAP.pr = null;
    setStatus('idle');
    if (!isWatchPage()) { setupForId = null; return; }
    CAP.videoId = vid;
    loadPrefs().then(function () {
      if (gen !== CAP.gen) return;
      var tries = 0;
      (function tick() {
        if (gen !== CAP.gen) return;
        var player = findPlayer();
        var video = findVideo();
        // The UI builds as soon as player + video exist. It used to
        // ALSO wait for the player response to match the new video;
        // on SPA navigation that global can lag or never match, and
        // while it waited CAP.video sat null — a live-looking
        // overlay whose pause button did nothing. Captions and
        // quality now wait for the response in their own loop.
        if (video && player) {
          CAP.player = player;
          adoptVideo(video);
          if (!PREFS.autoplayNext) ensureYouTubeAutoplay(false);
          buildAppleUI(player);
          watchVideoReplacement(player);
          setupForId = vid;
          waitForResponse(gen, player);
          return;
        }
        if (++tries < 24) setTimeout(tick, 500);
        else setStatus('error', 'player-timeout');
      })();
    });
  }

  function waitForResponse(gen, player) {
    var tries = 0;
    (function tick() {
      if (gen !== CAP.gen) return;
      var pr = getPlayerResponse();
      var prId = null;
      try { prId = pr && pr.videoDetails && pr.videoDetails.videoId; } catch (e) {}
      if (pr && (!CAP.videoId || !prId || prId === CAP.videoId)) {
        CAP.pr = pr;
        var v = syncVideo();
        if (v) loadCaptions(v, player, pr);
        onPlayerResponse(pr);
        applyQuality(player, gen);
        return;
      }
      if (++tries < 24) setTimeout(tick, 500);
    })();
  }

  /* ---------------- navigation wiring ---------------- */
  if (document.documentElement) injectPagePatch();
  document.addEventListener('yt-navigate-finish', function () { injectPagePatch(); setupWatch(); });
  window.addEventListener('yt-navigate-finish', function () { injectPagePatch(); setupWatch(); });
  var lastHref = location.href;
  if (typeof setInterval === 'function') {
    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        injectPagePatch();
        setupWatch();
      }
    }, 1000);
  }
  setupWatch();
})();
