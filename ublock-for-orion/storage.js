/* uBlock for Orion — storage wrapper + settings.
 * Works over browser.storage.local, chrome.storage.local (callback), or
 * localStorage (dashboard opened as a plain page / tests).
 * Large values (parsed lists, the compiled set) are JSON-chunked across keys
 * because a single storage item holding ~150k filters is exactly the kind of
 * thing Orion's partial WebExtension layer is likely to choke on — chunking
 * also lets the dashboard report precisely which write failed.
 */
(function (root) {
  'use strict';
  var CHUNK = 700000;

  function rawGet(keys) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get(keys).then(resolve, reject); return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, function (res) {
            if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res || {});
          }); return;
        }
        var out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
          var v = localStorage.getItem('ubo:' + k); if (v !== null) out[k] = JSON.parse(v);
        });
        resolve(out);
      } catch (e) { reject(e); }
    });
  }
  function rawSet(obj) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.set(obj).then(resolve, reject); return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(obj, function () {
            if (chrome.runtime && chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          }); return;
        }
        Object.keys(obj).forEach(function (k) { localStorage.setItem('ubo:' + k, JSON.stringify(obj[k])); });
        resolve();
      } catch (e) { reject(e); }
    });
  }
  function rawRemove(keys) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.remove(keys).then(resolve, reject); return;
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.remove(keys, function () { resolve(); }); return;
        }
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { localStorage.removeItem('ubo:' + k); });
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function get(key) { return rawGet(key).then(function (r) { return r[key]; }); }
  function set(key, val) { var o = {}; o[key] = val; return rawSet(o); }
  function remove(key) { return rawRemove(key); }

  function setLarge(key, obj) {
    var str = JSON.stringify(obj);
    var chunks = root.UBOEngine.chunkString(str, CHUNK);
    var meta = {}; meta[key + '#meta'] = { chunks: chunks.length, bytes: str.length };
    return rawSet(meta).then(function () {
      var chain = Promise.resolve();
      chunks.forEach(function (c, i) {
        chain = chain.then(function () { var o = {}; o[key + '#' + i] = c; return rawSet(o); });
      });
      return chain;
    });
  }
  function getLarge(key) {
    return rawGet(key + '#meta').then(function (r) {
      var meta = r[key + '#meta'];
      if (!meta) return null;
      var keys = [];
      for (var i = 0; i < meta.chunks; i++) keys.push(key + '#' + i);
      return rawGet(keys).then(function (parts) {
        var str = '';
        for (var i = 0; i < meta.chunks; i++) {
          if (typeof parts[key + '#' + i] !== 'string') throw new Error('missing chunk ' + i + ' of ' + key);
          str += parts[key + '#' + i];
        }
        return JSON.parse(str);
      });
    });
  }
  function removeLarge(key) {
    return rawGet(key + '#meta').then(function (r) {
      var meta = r[key + '#meta']; var keys = [key + '#meta'];
      if (meta) for (var i = 0; i < meta.chunks; i++) keys.push(key + '#' + i);
      return rawRemove(keys);
    });
  }

  // ---- logger (B): one shared ring in storage so content, background and
  // the dashboard all write/read the same log even if background messaging
  // is dead on Orion. Entries: {t, layer, action, url, host, detail}
  var LOG_KEY = 'logEntries', LOG_CAP = 400, logQueue = Promise.resolve();
  function appendLog(entries) {
    if (!entries || !entries.length) return Promise.resolve();
    logQueue = logQueue.then(function () {
      return get(LOG_KEY).then(function (cur) {
        cur = Array.isArray(cur) ? cur : [];
        cur = cur.concat(entries).slice(-LOG_CAP);
        return set(LOG_KEY, cur);
      }).catch(function () {});
    });
    return logQueue;
  }
  function getLog() { return get(LOG_KEY).then(function (v) { return Array.isArray(v) ? v : []; }); }
  function clearLog() { return set(LOG_KEY, []); }

  function defaultSettings() {
    return {
      v: 1, enabled: true, autoUpdate: true, updateIntervalHours: 24,
      myFiltersEnabled: true, myFilters: '',
      customLists: [],           // [{id, name, url, enabled}]
      disabledLists: [],         // registry ids toggled off
      perSite: {},               // host -> {disabled, noPopups, noLargeMedia, noRemoteFonts, noJS}
      pill: true,
      ytFixes: true              // J
    };
  }
  function getSettings() {
    return get('settingsV1').then(function (s) {
      return Object.assign(defaultSettings(), s || {});
    });
  }
  function saveSettings(s) { return set('settingsV1', s); }

  // per-site entry lookup with parent-domain inheritance
  function perSiteFor(settings, host) {
    var ps = settings.perSite || {};
    var parts = String(host || '').toLowerCase().split('.');
    for (var i = 0; i < parts.length; i++) {
      var key = parts.slice(i).join('.');
      if (ps[key]) return Object.assign({ _key: key }, ps[key]);
    }
    return {};
  }

  root.UBOStore = {
    get: get, set: set, remove: remove,
    setLarge: setLarge, getLarge: getLarge, removeLarge: removeLarge,
    appendLog: appendLog, getLog: getLog, clearLog: clearLog,
    defaultSettings: defaultSettings, getSettings: getSettings, saveSettings: saveSettings,
    perSiteFor: perSiteFor, _rawGet: rawGet
  };
})(typeof self !== 'undefined' ? self : this);
