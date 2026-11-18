'use strict';
/* Popup Blocker for Orion — update checker (v1.2.0)
 *
 * Discovers a newer version from a Firefox-style update manifest
 * feed and records it in storage; the in-page panel (content.js)
 * offers the download. This module can NOT install anything —
 * no WebExtension API lets an extension replace its own code.
 * The offer opens the new .xpi link and the user installs it
 * from file in Orion, as before.
 *
 * Feed (default): the Orion-Extensions repo's updates.json.
 * That repo is PRIVATE, so an unauthenticated fetch may 404 —
 * auto checks fail silently, manual checks report the failure
 * honestly (never a false "up to date"). Override the feed URL
 * by setting `upd_feed_url` in storage.local.
 *
 * Defensive everywhere: no-ops without a storage/fetch API, and
 * exports its pure helpers for Node unit tests.
 */
(function () {
  var VERSION = '1.2.0';
  var ADDON_ID = 'orion-popup-blocker@local';
  var FEED_URL = 'https://raw.githubusercontent.com/kcm2019/Orion-Extensions/main/updates.json';
  var THROTTLE_MS = 12 * 60 * 60 * 1000; // 12 h between auto checks

  /* ---------------- pure helpers (unit-tested) ---------------- */
  function parseParts(v) {
    return String(v == null ? '' : v).split('.').map(function (p) {
      var n = parseInt(p, 10);
      return isNaN(n) ? 0 : n;
    });
  }
  function compareVersions(a, b) {
    var pa = parseParts(a), pb = parseParts(b);
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  }
  // Highest update strictly newer than currentVersion, or null.
  // Accepts the Firefox manifest shape
  //   {addons:{<id>:{updates:[{version,update_link},…]}}}
  // and a simple {version, update_link} object for this add-on.
  function pickUpdate(feedJson, addonId, currentVersion) {
    var entries = null;
    try {
      if (feedJson && feedJson.addons && feedJson.addons[addonId] &&
          Array.isArray(feedJson.addons[addonId].updates)) {
        entries = feedJson.addons[addonId].updates;
      } else if (feedJson && typeof feedJson.version === 'string') {
        entries = [feedJson];
      }
    } catch (e) {}
    if (!entries) return null;
    var best = null;
    entries.forEach(function (en) {
      if (!en || typeof en.version !== 'string') return;
      if (compareVersions(en.version, currentVersion) <= 0) return;
      if (!best || compareVersions(en.version, best.version) > 0) {
        best = { version: en.version, update_link: typeof en.update_link === 'string' ? en.update_link : '' };
      }
    });
    return best;
  }

  /* ---------------- API + storage (layered, defensive) ---------------- */
  function getApi() {
    try { if (typeof browser !== 'undefined' && browser) return browser; } catch (e) {}
    try { if (typeof chrome !== 'undefined' && chrome) return chrome; } catch (e) {}
    return null;
  }
  var memStore = {};
  function memGet(keys) {
    var out = {};
    keys.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(memStore, k)) { out[k] = memStore[k]; return; }
      try {
        var v = localStorage.getItem(k);
        if (v != null) out[k] = JSON.parse(v);
      } catch (e) {}
    });
    return out;
  }
  function memSet(data) {
    Object.keys(data).forEach(function (k) {
      memStore[k] = data[k];
      try { localStorage.setItem(k, JSON.stringify(data[k])); } catch (e) {}
    });
  }
  function storageGet(keys) {
    return new Promise(function (resolve) {
      try {
        var api = getApi();
        if (api && api.storage && api.storage.local) {
          var r = api.storage.local.get(keys);
          if (r && typeof r.then === 'function') {
            r.then(function (s) { resolve(s || {}); }, function () { resolve(memGet(keys)); });
          } else {
            api.storage.local.get(keys, function (s) { resolve(s || {}); });
          }
          return;
        }
      } catch (e) {}
      resolve(memGet(keys));
    });
  }
  function storageSet(data) {
    return new Promise(function (resolve) {
      try {
        var api = getApi();
        if (api && api.storage && api.storage.local) {
          var r = api.storage.local.set(data);
          if (r && typeof r.then === 'function') {
            r.then(function () { resolve(true); }, function () { memSet(data); resolve(false); });
          } else {
            api.storage.local.set(data, function () { resolve(true); });
          }
          return;
        }
      } catch (e) {}
      memSet(data);
      resolve(false);
    });
  }

  function currentVersion() {
    try {
      var api = getApi();
      if (api && api.runtime) {
        if (typeof api.runtime.getVersion === 'function') {
          var v = api.runtime.getVersion();
          if (v) return String(v);
        }
        if (typeof api.runtime.getManifest === 'function') {
          var m = api.runtime.getManifest();
          if (m && m.version) return String(m.version);
        }
      }
    } catch (e) {}
    return VERSION;
  }

  /* ---------------- the check ---------------- */
  function checkNow(force) {
    return storageGet(['upd_last_check', 'upd_available', 'upd_feed_url']).then(function (s) {
      var now = Date.now();
      var last = typeof s.upd_last_check === 'number' ? s.upd_last_check : 0;
      if (!force && last && (now - last) < THROTTLE_MS) {
        if (s.upd_available && s.upd_available.version) {
          return { state: 'update', version: s.upd_available.version,
                   update_link: s.upd_available.update_link || '', throttled: true };
        }
        return { state: 'current', throttled: true };
      }
      var url = (typeof s.upd_feed_url === 'string' && s.upd_feed_url) ? s.upd_feed_url : FEED_URL;
      if (typeof fetch !== 'function') {
        return onError(new Error('no-fetch'), force);
      }
      return fetch(url, { cache: 'no-store' }).then(function (resp) {
        if (!resp || resp.status !== 200) throw new Error('http-' + (resp ? resp.status : 'none'));
        return resp.json();
      }).then(function (json) {
        var picked = pickUpdate(json, ADDON_ID, currentVersion());
        var data = { upd_last_check: Date.now(), upd_available: null };
        var result;
        if (picked) {
          data.upd_available = { version: picked.version, update_link: picked.update_link, found_at: Date.now() };
          result = { state: 'update', version: picked.version, update_link: picked.update_link };
        } else {
          result = { state: 'current', version: currentVersion() };
        }
        return storageSet(data).then(function () { return result; });
      }).catch(function (err) {
        return onError(err, force);
      });
      function onError(err, wasForced) {
        var done = function () {
          return { state: 'error', error: String(err && err.message || err) };
        };
        // Auto checks stamp the throttle even on error, so a dead
        // feed isn't hammered on every page load. A previously
        // found upd_available is never cleared by an error.
        if (!wasForced) {
          return storageSet({ upd_last_check: Date.now() }).then(done);
        }
        return done();
      }
    }).catch(function (err) {
      return { state: 'error', error: String(err && err.message || err) };
    });
  }

  function getState() {
    return storageGet(['upd_available', 'upd_dismissed', 'upd_last_check']).then(function (s) {
      return {
        available: s.upd_available || null,
        dismissed: typeof s.upd_dismissed === 'string' ? s.upd_dismissed : null,
        lastCheck: typeof s.upd_last_check === 'number' ? s.upd_last_check : 0,
      };
    });
  }
  function dismiss(version) {
    return storageSet({ upd_dismissed: String(version || '') });
  }

  var apiObj = {
    VERSION: VERSION,
    ADDON_ID: ADDON_ID,
    FEED_URL: FEED_URL,
    compareVersions: compareVersions,
    pickUpdate: pickUpdate,
    checkNow: checkNow,
    getState: getState,
    dismiss: dismiss,
    currentVersion: currentVersion,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = apiObj;
  try {
    var g = typeof globalThis !== 'undefined' ? globalThis : this;
    if (g) g.OrionUpdateCheck = apiObj;
  } catch (e) {}
})();
