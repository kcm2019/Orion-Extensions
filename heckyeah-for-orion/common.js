/* HeckYeah for Orion — shared data layer + pure logic (window.HYO).
 * Loaded before fmhy.js on fmhy.net and before tracker.js everywhere.
 * Pure functions are unit-tested by tests/harness.js. */
(function () {
  'use strict';
  if (window.HYO) return;

  var KEY = 'heckyeah_orion';

  function defaultStore() {
    return { v: 1, armed: {}, entries: [], visits: 0, sweepCount: 0, sweepLog: [], storageMode: 'unknown', favorites: {}, siteOrder: {} };
  }

  /* ---------- storage: browser.storage.local -> chrome.storage.local -> localStorage.
   * Dual-write: when extension storage exists we ALSO mirror to localStorage.
   * Reads prefer extension storage. This is the persistence probe: localStorage
   * is per-origin, so only extension storage can carry resume data from a
   * streaming host back to fmhy.net. ---------- */
  function extGet() {
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      function wrap(s) { return s && s[KEY] ? { data: s[KEY], mode: 'ext' } : null; }
      /* Never hang: whichever style the host implements (promise,
       * callback, both, or neither), settle within 3 s — a null
       * result just falls back to the localStorage mirror. The
       * original code called .then on the return value directly;
       * a host whose get() returns undefined (or a promise that
       * never settles in some contexts, e.g. Orion's popup) killed
       * or froze every boot that depended on loadStore(). */
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          var r = null, threw = false;
          try { r = browser.storage.local.get(KEY); } catch (e) { threw = true; }
          if (r && typeof r.then === 'function') {
            r.then(function (s) { fin(wrap(s)); }, function () { fin(null); });
            setTimeout(function () { fin(null); }, 3000);
            return;
          }
          if (threw) { fin(null); return; }
          // no promise returned — try the callback style
          try {
            browser.storage.local.get(KEY, function (s) { fin(wrap(s)); });
            setTimeout(function () { fin(null); }, 3000);
            return;
          } catch (e) { fin(null); return; }
        }
      } catch (e) { fin(null); return; }
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(KEY, function (s) { fin(wrap(s)); });
          setTimeout(function () { fin(null); }, 3000);
          return;
        }
      } catch (e) { fin(null); return; }
      fin(null);
    });
  }
  function localGet() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function loadStore() {
    return extGet().then(function (r) {
      if (r && r.data) {
        var d = Object.assign(defaultStore(), r.data);
        d.storageMode = 'ext';
        return d;
      }
      var l = localGet();
      if (l) {
        var d2 = Object.assign(defaultStore(), l);
        d2.storageMode = 'local-only';
        return d2;
      }
      var fresh = defaultStore();
      fresh.storageMode = 'none-yet';
      return fresh;
    });
  }
  function saveStore(store) {
    var payload = {};
    payload[KEY] = store;
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.set(payload);
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(payload);
      }
    } catch (e) {}
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    return Promise.resolve();
  }

  /* ---------- pure logic ---------- */

  function fmtTime(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  function relTime(ts, now) {
    now = now || Date.now();
    var d = Math.max(0, now - ts);
    var min = Math.floor(d / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }

  /* Strip site-name suffixes/prefixes and player chrome words from a page title. */
  function cleanTitle(t) {
    if (!t) return '';
    var s = String(t).replace(/\s+/g, ' ').trim();
    s = s.replace(/^(watch|stream)\s+/i, '');
    // "Title | Site", "Title - Site", "Title – Watch Free ..." (only strip a
    // trailing segment that looks like a site name: short, no episode marker)
    var parts = s.split(/\s+[|\u2013\u2014]\s+|\s+-\s+/);
    if (parts.length > 1) {
      var tail = parts[parts.length - 1];
      if (tail.length <= 30 && !/s\d+\s?e\d+|season|episode/i.test(tail)) {
        s = parts.slice(0, -1).join(' - ');
      }
    }
    s = s.replace(/\s+(online|free|in hd|hd)\s*$/i, '').trim();
    return s;
  }

  /* Turn the raw text left in an FMHY list item (after the anchor texts are
   * removed) into a clean tag list. Raw text is messy in the wild:
   * "or - 4K / External Subs / Ad-Toggle", ", , - 4K / Dual Audio / /" —
   * mirrors leave "or" and comma debris behind. Returns deduped tags. */
  function cleanTags(raw) {
    if (!raw) return [];
    var out = [];
    String(raw).split('/').forEach(function (seg) {
      var t = seg.replace(/\s+/g, ' ').trim();
      t = t.replace(/^[\-\u2013\u2014:,.\s]+/, '').trim();
      t = t.replace(/^or\b[\s\-\u2013\u2014:,]*/i, '').trim();
      t = t.replace(/[\-\u2013\u2014:,.\s]+$/, '').trim();
      if (!t || t.length > 40) return;
      if (/^or$/i.test(t)) return;
      if (out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }

  /* Clamp a pill position (its top-left x/y) so it stays on screen. */
  function clampPillPos(x, y, w, h, vw, vh) {
    var m = 6;
    return {
      x: Math.max(m, Math.min(x, Math.max(m, vw - w - m))),
      y: Math.max(m, Math.min(y, Math.max(m, vh - h - m)))
    };
  }

  /* Parse show / season / episode from a title and/or URL.
   * Returns { showTitle, showKey, epLabel, season, episode } — season/episode
   * null for movies. */
  function parseEpisode(title, url) {
    var raw = cleanTitle(title || '');
    var u = '';
    try {
      var parsedUrl = new URL(url);
      u = decodeURIComponent(parsedUrl.pathname) + ' ' + decodeURIComponent(parsedUrl.search).replace(/[?&=_]/g, ' ');
    } catch (e) { u = String(url || ''); }
    var hay = raw + ' ' + u.replace(/[-_/]/g, ' ');
    var season = null, episode = null, m;
    if ((m = hay.match(/s(\d{1,2})\s?e(\d{1,3})/i))) { season = +m[1]; episode = +m[2]; }
    else if ((m = hay.match(/\b(\d{1,2})x(\d{1,3})\b/))) { season = +m[1]; episode = +m[2]; }
    else if ((m = hay.match(/season[\s-]*(\d{1,2})[\s,.\u00b7\u2022\u2013\u2014-]*episode[\s-]*(\d{1,3})/i))) { season = +m[1]; episode = +m[2]; }
    else if ((m = hay.match(/\bs\s+(\d{1,2})\s+e\s+(\d{1,3})\b/i))) { season = +m[1]; episode = +m[2]; }
    else if ((m = hay.match(/episode[\s-]*(\d{1,3})/i))) { episode = +m[1]; }
    else if ((m = hay.match(/\bep\s+(\d{1,3})\b/i))) { episode = +m[1]; }

    var show = raw;
    if (season != null || episode != null) {
      // Show name = title text before the episode marker
      var cut = raw.search(/s\d{1,2}\s?e\d{1,3}|\b\d{1,2}x\d{1,3}\b|season\s*\d|episode\s*\d/i);
      if (cut > 0) show = raw.slice(0, cut);
      show = show.replace(/[\s:\-\u2013\u2014]+$/, '').trim();
      if (!show) {
        // fall back to the URL slug before the marker
        var slug = u.replace(/^\//, '').split('/').pop() || '';
        var sc = slug.search(/s\d{1,2}e\d{1,3}|season|episode/i);
        show = (sc > 0 ? slug.slice(0, sc) : slug).replace(/[-_]/g, ' ').trim();
      }
    }
    if (!show) show = 'Unknown title';
    var epLabel = null;
    if (season != null && episode != null) epLabel = 'S' + season + ' E' + episode;
    else if (episode != null) epLabel = 'Episode ' + episode;
    return {
      showTitle: show,
      showKey: show.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      epLabel: epLabel,
      season: season,
      episode: episode
    };
  }

  /* Structured data: pull season/episode/show out of a JSON-LD blob
   * (schema.org TVEpisode). Returns null when there's nothing usable. */
  function parseEpisodeJsonLd(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var found = null;
    function walk(node, depth) {
      if (found || !node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
      var type = node['@type'];
      var isEp = type === 'TVEpisode' || (node.episodeNumber != null && (type === 'Episode' || node.partOfSeason != null));
      if (isEp) {
        var season = null;
        var ps = node.partOfSeason;
        if (typeof ps === 'number') season = ps;
        else if (ps && typeof ps === 'object') {
          if (ps.seasonNumber != null) season = +ps.seasonNumber;
          else if (ps.position != null) season = +ps.position;
        }
        var series = node.partOfSeries;
        found = {
          season: season,
          episode: node.episodeNumber != null ? +node.episodeNumber : null,
          showTitle: (series && series.name) || node.seriesName || null
        };
        return;
      }
      Object.keys(node).forEach(function (k) { walk(node[k], depth + 1); });
    }
    walk(data, 0);
    if (!found || (found.episode == null && found.season == null)) return null;
    return found;
  }

  /* parseEpisode, but when title+URL carry no episode marker, also try
   * extra texts scraped from the page (headings, meta, episode UI). */
  function parseEpisodeEnhanced(input) {
    input = input || {};
    var base = parseEpisode(input.title || '', input.url || '');
    if (base.episode != null) return base;
    var texts = input.extraTexts || [];
    for (var i = 0; i < texts.length; i++) {
      var t = String(texts[i] || '');
      if (!t) continue;
      var p = parseEpisode(t, '');
      if (p.episode != null) {
        return {
          showTitle: base.showTitle !== 'Unknown title' ? base.showTitle : p.showTitle,
          showKey: base.showTitle !== 'Unknown title' ? base.showKey : p.showKey,
          epLabel: p.epLabel,
          season: p.season,
          episode: p.episode
        };
      }
    }
    return base;
  }

  function isFinished(e) {
    if (!e) return false;
    if (e.finished) return true;
    return !!(e.dur > 0 && e.pos != null && e.pos / e.dur >= 0.92);
  }

  /* Group entries by show. Finished entries are excluded. Groups sorted by
   * most recent activity; episodes inside sorted by season/episode, then time. */
  /* Site ordering for shelves: favorites first; inside each group,
   * the user's saved order for that shelf (store.siteOrder[key] =
   * [urls]) wins; anything unlisted keeps its original FMHY order. */
  function sortSites(items, key, store) {
    var favs = (store && store.favorites) || {};
    var order = (store && store.siteOrder && store.siteOrder[key]) || [];
    var rank = {};
    for (var i = 0; i < order.length; i++) rank[order[i]] = i;
    return (items || []).map(function (it, idx) { return { it: it, idx: idx }; })
      .sort(function (a, b) {
        var fa = favs[a.it.url] ? 0 : 1;
        var fb = favs[b.it.url] ? 0 : 1;
        if (fa !== fb) return fa - fb;
        var ra = rank[a.it.url] != null ? rank[a.it.url] : 1000000;
        var rb = rank[b.it.url] != null ? rank[b.it.url] : 1000000;
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
      })
      .map(function (w) { return w.it; });
  }
  function shelfKey(shelf) {
    if (!shelf) return '';
    return shelf.section && shelf.section !== shelf.title ? shelf.section + '|' + shelf.title : (shelf.title || '');
  }

  function groupByShow(entries) {
    var byKey = {};
    (entries || []).forEach(function (e) {
      if (isFinished(e)) return;
      var k = e.showKey || (e.showTitle || 'unknown').toLowerCase();
      if (!byKey[k]) byKey[k] = { showKey: k, showTitle: e.showTitle, episodes: [], latest: null, latestAt: 0 };
      byKey[k].episodes.push(e);
      if (e.updatedAt >= byKey[k].latestAt) { byKey[k].latestAt = e.updatedAt; byKey[k].latest = e; byKey[k].showTitle = e.showTitle; }
    });
    var groups = Object.keys(byKey).map(function (k) {
      var g = byKey[k];
      g.episodes.sort(function (a, b) {
        var sa = a.season || 0, sb = b.season || 0;
        if (sa !== sb) return sa - sb;
        var ea = a.episode || 0, eb = b.episode || 0;
        if (ea !== eb) return ea - eb;
        return a.updatedAt - b.updatedAt;
      });
      return g;
    });
    groups.sort(function (a, b) { return b.latestAt - a.latestAt; });
    return groups;
  }

  /* Pick a next-episode link from [{href, text}]. Prefer an explicit
   * "next episode" label; then a link whose episode number is current+1. */
  function pickNextEpisode(links, current) {
    var best = null;
    (links || []).forEach(function (l) {
      if (!l || !l.href) return;
      var text = (l.text || '').replace(/\s+/g, ' ').trim();
      if (/next\s*(episode|ep)\b/i.test(text) || /^next\s*›?$/.test(text.toLowerCase())) {
        if (!best) best = { url: l.href, title: text };
        return;
      }
      if (current && current.episode != null && !best) {
        var p = parseEpisode(text, l.href);
        if (p.episode === current.episode + 1 && (current.season == null || p.season == null || p.season === current.season)) {
          best = { url: l.href, title: text || p.epLabel };
        }
      }
    });
    return best;
  }

  /* ---------- sweep (G) — HeckYeah TV v1.46 rules, pure decision ---------- */
  var SWEEP_RE = /not a robot|are you a robot|confirm you'?re not a robot|verify you are human|prove you are human|human verification|scan the qr[-\s]?code/i;

  /* candidate: { hasPhrase, textLen, rectW, rectH, vw, vh, positioned,
   *              containsVideo, containsCF, isBodyOrHtml } */
  function sweepDecision(c) {
    if (!c || !c.hasPhrase) return false;
    if (c.isBodyOrHtml) return false;
    if (c.containsVideo) return false;
    if (c.containsCF) return false;
    if (c.textLen != null && c.textLen >= 3000) return false;
    if (!c.positioned) return false;
    var area = (c.rectW * c.rectH) / Math.max(1, c.vw * c.vh);
    var wide = c.rectW / Math.max(1, c.vw) >= 0.6;
    var tall = c.rectH / Math.max(1, c.vh) >= 0.6;
    return area >= 0.10 || wide || tall;
  }

  /* Armed-only tracker scope: host itself armed, or (iframe case) the
   * referrer / ancestor host armed. */
  function isArmed(host, armed, referrerHost) {
    if (!host) return false;
    armed = armed || {};
    if (armed[host]) return true;
    if (referrerHost && armed[referrerHost]) return true;
    return false;
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  window.HYO = {
    KEY: KEY,
    defaultStore: defaultStore,
    loadStore: loadStore,
    saveStore: saveStore,
    fmtTime: fmtTime,
    relTime: relTime,
    cleanTitle: cleanTitle,
    cleanTags: cleanTags,
    clampPillPos: clampPillPos,
    parseEpisode: parseEpisode,
    parseEpisodeJsonLd: parseEpisodeJsonLd,
    parseEpisodeEnhanced: parseEpisodeEnhanced,
    isFinished: isFinished,
    groupByShow: groupByShow,
    sortSites: sortSites,
    shelfKey: shelfKey,
    pickNextEpisode: pickNextEpisode,
    SWEEP_RE: SWEEP_RE,
    sweepDecision: sweepDecision,
    isArmed: isArmed,
    hostOf: hostOf
  };
})();
