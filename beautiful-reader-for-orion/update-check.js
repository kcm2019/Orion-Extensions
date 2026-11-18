/* update-check.js — Beautiful Reader update checker (v1.17.0).
 * Discovers newer versions from a Firefox-style update feed and
 * records the find in storage; the popup (and the reader menu)
 * offer the download. The extension CANNOT install updates
 * itself — no WebExtension API does that — the offer opens the
 * new .xpi link and the user installs from file in Orion.
 *
 * Feed: FEED_URL below, overridable via storage key
 * `upd_feed_url`. The Orion-Extensions repo is PRIVATE today,
 * so an unauthenticated fetch may 404: auto checks fail
 * silently, manual checks report the failure honestly, and a
 * failed check never clears a previously found update.
 *
 * Plain MV2 script, no imports. Defensive everywhere: works
 * with `browser` or `chrome` storage, falls back to
 * localStorage / memory, and no-ops without any of them.
 * In Node it exports the pure helpers for tests. */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined') ? globalThis : this;

  var VERSION = '1.18.2';
  var ADDON_ID = 'orion-beautiful-reader@local';
  var FEED_URL = 'https://raw.githubusercontent.com/kcm2019/Orion-Extensions/main/updates.json';
  var THROTTLE_MS = 12 * 3600 * 1000;
  var K = {
    lastCheck: 'upd_last_check',
    available: 'upd_available',
    dismissed: 'upd_dismissed',
    feedUrl: 'upd_feed_url'
  };

  /* ---------- pure helpers ---------- */

  // Numeric dotted compare: -1 / 0 / 1. Missing parts count as
  // 0 ('1.2' == '1.2.0'), non-numeric parts count as 0, a
  // leading 'v' is tolerated.
  function compareVersions(a, b) {
    var pa = parseVersion(a), pb = parseVersion(b);
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  }
  function parseVersion(v) {
    if (v == null) return [0];
    var s = String(v).trim().replace(/^v/i, '');
    if (!s) return [0];
    return s.split('.').map(function (part) {
      var num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });
  }

  // Highest feed entry strictly newer than currentVersion, or
  // null. Accepts the Firefox update-manifest shape
  // {addons:{<id>:{updates:[{version,update_link}]}}} and a
  // simple {version, update_link} object for this extension.
  function pickUpdate(feed, addonId, currentVersion) {
    try {
      if (!feed || typeof feed !== 'object') return null;
      var best = null;
      function consider(entry) {
        if (!entry || typeof entry !== 'object') return;
        var v = entry.version;
        if (typeof v !== 'string' || !v.trim()) return;
        if (compareVersions(v, currentVersion) <= 0) return;
        if (!best || compareVersions(v, best.version) > 0) {
          best = { version: v, update_link: typeof entry.update_link === 'string' ? entry.update_link : '' };
        }
      }
      var addons = feed.addons;
      if (addons && typeof addons === 'object' && addonId && addons[addonId]) {
        var list = addons[addonId].updates;
        if (Array.isArray(list)) list.forEach(consider);
        return best;
      }
      if (typeof feed.version === 'string') { consider(feed); return best; }
      return null;
    } catch (e) { return null; }
  }

  /* ---------- environment (resolved per call, so tests can stub) ---------- */

  function extApi() {
    try { if (typeof browser !== 'undefined' && browser) return browser; } catch (e) {}
    try { if (root.browser) return root.browser; } catch (e) {}
    try { if (typeof chrome !== 'undefined' && chrome) return chrome; } catch (e) {}
    try { if (root.chrome) return root.chrome; } catch (e) {}
    return null;
  }
  function currentVersion() {
    try {
      var api = extApi();
      if (api && api.runtime) {
        if (typeof api.runtime.getVersion === 'function') {
          var v = api.runtime.getVersion();
          if (typeof v === 'string' && v) return v;
        }
        if (typeof api.runtime.getManifest === 'function') {
          var m = api.runtime.getManifest();
          if (m && typeof m.version === 'string' && m.version) return m.version;
        }
      }
    } catch (e) {}
    return VERSION;
  }

  /* ---------- storage: browser/chrome.storage -> localStorage -> memory ---------- */

  var memStore = {};
  function lsGet(key) {
    try {
      var v = root.localStorage.getItem('br:' + key);
      return v ? JSON.parse(v) : undefined;
    } catch (e) { return undefined; }
  }
  function lsSet(key, value) {
    try { root.localStorage.setItem('br:' + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function storageGet(key, fallback) {
    return new Promise(function (resolve) {
      var api = extApi();
      try {
        if (api && api.storage && api.storage.local) {
          var r = api.storage.local.get(key);
          if (r && typeof r.then === 'function') {
            r.then(function (o) { resolve(o && o[key] !== undefined ? o[key] : fallback); },
                   function () { resolve(lsOrMem()); });
            return;
          }
          // chrome callback style
          api.storage.local.get(key, function (o) {
            resolve(o && o[key] !== undefined ? o[key] : fallback);
          });
          return;
        }
      } catch (e) {}
      resolve(lsOrMem());
      function lsOrMem() {
        var v = lsGet(key);
        if (v !== undefined) return v;
        return memStore[key] !== undefined ? memStore[key] : fallback;
      }
    });
  }
  function storageSet(key, value) {
    return new Promise(function (resolve) {
      var api = extApi();
      var obj = {}; obj[key] = value;
      try {
        if (api && api.storage && api.storage.local) {
          var r = api.storage.local.set(obj);
          if (r && typeof r.then === 'function') {
            r.then(function () { resolve(true); }, function () { resolve(lsSet(key, value)); });
            return;
          }
          api.storage.local.set(obj, function () { resolve(true); });
          return;
        }
      } catch (e) {}
      if (!lsSet(key, value)) memStore[key] = value;
      resolve(true);
    });
  }

  /* ---------- the check ---------- */

  function doFetch(url) {
    if (typeof fetch !== 'function' && typeof root.fetch !== 'function') {
      return Promise.reject(new Error('no fetch'));
    }
    var f = (typeof fetch === 'function') ? fetch : root.fetch;
    return f.call(root, url, { cache: 'no-store' }).then(function (res) {
      if (!res || res.status !== 200) throw new Error('feed HTTP ' + (res ? res.status : 'none'));
      return res.json();
    });
  }

  function checkNow(force) {
    var cur = currentVersion();
    return Promise.all([
      storageGet(K.lastCheck, 0),
      storageGet(K.available, null),
      storageGet(K.feedUrl, '')
    ]).then(function (vals) {
      var lastCheck = vals[0] || 0;
      var prevAvailable = vals[1] || null;
      var feedUrl = (typeof vals[2] === 'string' && vals[2]) ? vals[2] : FEED_URL;
      var now = Date.now();
      if (!force && lastCheck && (now - lastCheck) < THROTTLE_MS) {
        // Throttled: report the cached find, fetch nothing.
        if (prevAvailable && compareVersions(prevAvailable.version, cur) > 0) {
          return { state: 'update', version: prevAvailable.version, update_link: prevAvailable.update_link || '', skipped: true };
        }
        return { state: 'current', skipped: true };
      }
      return doFetch(feedUrl).then(function (feed) {
        var pick = pickUpdate(feed, ADDON_ID, cur);
        var avail = pick ? { version: pick.version, update_link: pick.update_link, found_at: now } : null;
        // Write the find BEFORE the throttle stamp: a reader
        // that sees the fresh stamp must also see the find.
        return storageSet(K.available, avail).then(function () {
          return storageSet(K.lastCheck, now);
        }).then(function () {
          if (avail) return { state: 'update', version: avail.version, update_link: avail.update_link };
          return { state: 'current', version: cur };
        });
      }, function (err) {
        // Error: never clear a previously found update. Auto
        // checks still stamp lastCheck so a dead feed is not
        // hammered on every UI open.
        var done = !force ? storageSet(K.lastCheck, now) : Promise.resolve(true);
        return done.then(function () {
          return { state: 'error', error: String(err && err.message ? err.message : err) };
        });
      });
    }).catch(function (err) {
      return { state: 'error', error: String(err && err.message ? err.message : err) };
    });
  }

  function getState() {
    return Promise.all([
      storageGet(K.available, null),
      storageGet(K.dismissed, ''),
      storageGet(K.lastCheck, 0)
    ]).then(function (vals) {
      return { available: vals[0] || null, dismissed: vals[1] || '', lastCheck: vals[2] || 0, version: currentVersion() };
    });
  }
  function dismissUpdate(version) {
    return storageSet(K.dismissed, String(version || ''));
  }
  function openUpdate(url) {
    if (!url) return false;
    try {
      var api = extApi();
      if (api && api.tabs && typeof api.tabs.create === 'function') {
        var r = api.tabs.create({ url: url });
        if (r && typeof r.catch === 'function') r.catch(function () { winOpen(); });
        return true;
      }
    } catch (e) {}
    return winOpen();
    function winOpen() {
      try { if (typeof root.open === 'function') { root.open(url, '_blank'); return true; } } catch (e) {}
      return false;
    }
  }

  var api = {
    VERSION: VERSION,
    ADDON_ID: ADDON_ID,
    FEED_URL: FEED_URL,
    THROTTLE_MS: THROTTLE_MS,
    compareVersions: compareVersions,
    pickUpdate: pickUpdate,
    currentVersion: currentVersion,
    checkNow: checkNow,
    getState: getState,
    dismissUpdate: dismissUpdate,
    openUpdate: openUpdate,
    _storageGet: storageGet,
    _storageSet: storageSet
  };
  root.BRUpdate = api;
  try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch (e) {}

  // Background startup: one throttled auto check, guarded so
  // Node test loads and fetch-less environments stay silent.
  try {
    if (typeof document !== 'undefined' && extApi() && extApi().storage) {
      checkNow(false);
    }
  } catch (e) {}
})();
