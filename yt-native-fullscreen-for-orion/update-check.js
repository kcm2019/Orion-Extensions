/* YT Native Fullscreen for Orion — update checker (update-check.js).
 * Discovers newer versions from a Firefox-style update feed and
 * offers them. It CANNOT install updates (no WebExtension API can):
 * the offer opens the new .xpi download link and the user installs
 * from file in Orion, as today.
 *
 * Loaded before fmhy.js on fmhy.net and before popup.js in the
 * toolbar popup. NOT loaded in the tracker (<all_urls>) context.
 * Defensive everywhere: no-ops cleanly without extension storage,
 * without fetch, or in Node (pure helpers exported for tests). */
(function () {
  'use strict';

  var VERSION = '2.14.0';
  var ADDON_ID = 'yt-native-fullscreen@local';
  var FEED_URL = 'https://raw.githubusercontent.com/kcm2019/Orion-Extensions/main/updates.json';
  var THROTTLE_MS = 12 * 60 * 60 * 1000; // 12 h between auto checks

  var root = (typeof window !== 'undefined') ? window
    : (typeof globalThis !== 'undefined' ? globalThis : this);
  if (root.YTNFUpdate) return;

  /* ---------- pure helpers ---------- */

  /* Numeric dotted compare: -1 / 0 / 1. Missing parts count as 0,
   * non-numeric parts count as 0. */
  function compareVersions(a, b) {
    var pa = String(a == null ? '' : a).split('.');
    var pb = String(b == null ? '' : b).split('.');
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var na = parseInt(pa[i], 10); if (isNaN(na)) na = 0;
      var nb = parseInt(pb[i], 10); if (isNaN(nb)) nb = 0;
      if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
  }

  /* Feed shapes accepted:
   *   Firefox: { addons: { "<id>": { updates: [{version, update_link}] } } }
   *   Simple:  { version: "…", update_link: "…" }
   * Returns {version, update_link} for the highest entry strictly
   * newer than currentVersion, or null. */
  function pickUpdate(feedJson, addonId, currentVersion) {
    var best = null;
    function consider(entry) {
      if (!entry || !entry.version) return;
      if (compareVersions(entry.version, currentVersion) <= 0) return;
      if (!best || compareVersions(entry.version, best.version) > 0) {
        best = { version: String(entry.version), update_link: entry.update_link || '' };
      }
    }
    try {
      if (!feedJson || typeof feedJson !== 'object') return null;
      var addons = feedJson.addons;
      if (addons && typeof addons === 'object') {
        var rec = addons[addonId];
        if (rec && Array.isArray(rec.updates)) rec.updates.forEach(consider);
      } else if (feedJson.version) {
        consider(feedJson);
      }
    } catch (e) { return null; }
    return best;
  }

  /* ---------- runtime / storage plumbing ---------- */

  function apiRoot() {
    try { if (typeof browser !== 'undefined' && browser) return browser; } catch (e) {}
    try { if (typeof chrome !== 'undefined' && chrome) return chrome; } catch (e) {}
    return null;
  }

  /* Orion's runtime.getVersion() is unreliable (reported undefined);
   * prefer a non-empty runtime value, else the hardcoded VERSION. */
  function currentVersion() {
    try {
      var api = apiRoot();
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

  function storageGet(keys) {
    return new Promise(function (resolve) {
      var api = apiRoot();
      try {
        if (api && api.storage && api.storage.local) {
          var r = api.storage.local.get(keys, function (items) { resolve(items || {}); });
          if (r && typeof r.then === 'function') r.then(function (items) { resolve(items || {}); }, function () { resolve({}); });
          return;
        }
      } catch (e) {}
      resolve({});
    });
  }
  function storageSet(obj) {
    return new Promise(function (resolve) {
      var api = apiRoot();
      try {
        if (api && api.storage && api.storage.local) {
          var r = api.storage.local.set(obj, function () { resolve(); });
          if (r && typeof r.then === 'function') r.then(function () { resolve(); }, function () { resolve(); });
          return;
        }
      } catch (e) {}
      resolve();
    });
  }

  /* Fetch the feed JSON. Primary: fetch() with NO init object —
   * some WebKit builds throw on a cache:'no-store' init, and any
   * throw surfaces as "feed unreachable". Fallback: XMLHttpRequest.
   * Rejects with the ORIGINAL error so the UI can name the cause. */
  function fetchFeed(url) {
    function viaXhr() {
      return new Promise(function (resolve, reject) {
        try {
          if (typeof XMLHttpRequest === 'undefined') { reject(new Error('no-fetch-no-xhr')); return; }
          var x = new XMLHttpRequest();
          x.open('GET', url, true);
          x.responseType = 'json';
          x.timeout = 15000;
          x.onload = function () {
            if (x.status !== 200) { reject(new Error('xhr-http-' + x.status)); return; }
            var j = x.response;
            if (j == null) {
              try { j = JSON.parse(x.responseText); } catch (e) { reject(new Error('xhr-bad-json')); return; }
            }
            resolve(j);
          };
          x.onerror = function () { reject(new Error('xhr-network-error')); };
          x.ontimeout = function () { reject(new Error('xhr-timeout')); };
          x.send();
        } catch (e) { reject(e); }
      });
    }
    if (typeof fetch === 'undefined') return viaXhr();
    return fetch(url).then(function (res) {
      if (!res || res.status !== 200) throw new Error('http-' + (res ? res.status : 'none'));
      return res.json();
    }).catch(function (err) {
      return viaXhr().catch(function () { throw err; });
    });
  }

  /* ---------- the check ---------- */

  /* checkNow(force) -> Promise<{state:'update'|'current'|'error', ...}>.
   * Auto (non-forced) checks skip the fetch when the last check was
   * < 12 h ago and report the stored state instead. Errors never
   * clear a previously found upd_available, and still stamp
   * upd_last_check so a dead feed is not hammered. */
  function checkNow(force) {
    var now = Date.now();
    return storageGet(['upd_last_check', 'upd_available', 'upd_feed_url']).then(function (st) {
      var last = st.upd_last_check || 0;
      var prev = st.upd_available || null;
      if (!force && last && (now - last) < THROTTLE_MS) {
        if (prev && compareVersions(prev.version, currentVersion()) > 0) {
          return { state: 'update', version: prev.version, update_link: prev.update_link || '', cached: true };
        }
        return { state: 'current', version: currentVersion(), cached: true };
      }
      var url = (typeof st.upd_feed_url === 'string' && st.upd_feed_url) ? st.upd_feed_url : FEED_URL;
      return fetchFeed(url).then(function (json) {
        var found = pickUpdate(json, ADDON_ID, currentVersion());
        if (found) {
          var avail = { version: found.version, update_link: found.update_link, found_at: now };
          return storageSet({ upd_available: avail, upd_last_check: now }).then(function () {
            return { state: 'update', version: found.version, update_link: found.update_link };
          });
        }
        return storageSet({ upd_available: null, upd_last_check: now }).then(function () {
          return { state: 'current', version: currentVersion() };
        });
      }).catch(function (err) {
        return storageSet({ upd_last_check: now }).then(function () {
          return { state: 'error', error: String((err && err.message) || err) };
        });
      });
    }).catch(function (err) {
      return { state: 'error', error: String((err && err.message) || err) };
    });
  }

  function getState() {
    return storageGet(['upd_available', 'upd_dismissed', 'upd_last_check']).then(function (st) {
      var avail = st.upd_available || null;
      /* An "available" entry at or below the RUNNING version is
       * stale: it was stored before the user installed that very
       * version, and nothing cleared it — so the banner kept
       * offering an update that was already installed. Filter it
       * here (both surfaces read state through this) and clear
       * the stored entry so it stays gone. */
      if (avail && compareVersions(avail.version, currentVersion()) <= 0) {
        avail = null;
        storageSet({ upd_available: null });
      }
      return {
        available: avail,
        dismissed: st.upd_dismissed || '',
        lastCheck: st.upd_last_check || 0,
        version: currentVersion()
      };
    });
  }

  function dismiss(version) {
    return storageSet({ upd_dismissed: String(version || '') });
  }

  /* Open the .xpi link: tabs.create where the API surface allows it
   * (popup), window.open elsewhere (in-page app view). */
  function openUpdate(link) {
    if (!link) return;
    try {
      var api = apiRoot();
      if (api && api.tabs && typeof api.tabs.create === 'function') {
        var r = api.tabs.create({ url: link });
        if (r && typeof r.catch === 'function') r.catch(function () { fallbackOpen(link); });
        return;
      }
    } catch (e) {}
    fallbackOpen(link);
  }
  function fallbackOpen(link) {
    try { if (typeof window !== 'undefined' && window.open) window.open(link, '_blank'); } catch (e) {}
  }

  var apiObj = {
    VERSION: VERSION,
    ADDON_ID: ADDON_ID,
    FEED_URL: FEED_URL,
    THROTTLE_MS: THROTTLE_MS,
    compareVersions: compareVersions,
    pickUpdate: pickUpdate,
    currentVersion: currentVersion,
    checkNow: checkNow,
    getState: getState,
    dismiss: dismiss,
    openUpdate: openUpdate
  };

  root.YTNFUpdate = apiObj;
  if (typeof module !== 'undefined' && module.exports) module.exports = apiObj;
})();
