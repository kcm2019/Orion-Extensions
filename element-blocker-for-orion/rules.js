/* rules.js — rule store shape, dedupe, import validation/merge. Pure. */
(function (global) {
  'use strict';

  function emptyStore() { return { version: 1, hosts: {} }; }

  function isValidRule(r) {
    return !!r && typeof r.selector === 'string' && r.selector.length > 0 &&
      r.selector.length <= 2000 && r.fingerprint && typeof r.fingerprint === 'object';
  }

  function normalizeStore(obj) {
    var out = emptyStore();
    if (!obj || typeof obj !== 'object') return out;
    var hosts = obj.hosts || obj.rules || {};
    Object.keys(hosts).forEach(function (host) {
      if (!Array.isArray(hosts[host])) return;
      var list = hosts[host].filter(isValidRule).map(function (r) {
        return {
          id: String(r.id || ('r' + Math.random().toString(36).slice(2, 10))),
          selector: r.selector,
          extraSelectors: Array.isArray(r.extraSelectors) ? r.extraSelectors.filter(function (s) { return typeof s === 'string' && s.length <= 2000; }) : [],
          fingerprint: r.fingerprint,
          created: Number(r.created) || 0,
          hits: Number(r.hits) || 0
        };
      });
      if (list.length) out.hosts[host] = list;
    });
    return out;
  }

  function addRule(store, host, rule) {
    store = normalizeStore(store);
    if (!host || !isValidRule(rule)) return store;
    var list = store.hosts[host] || (store.hosts[host] = []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].selector === rule.selector) return store; // dedupe
    }
    list.push({
      id: String(rule.id || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
      selector: rule.selector,
      extraSelectors: Array.isArray(rule.extraSelectors) ? rule.extraSelectors : [],
      fingerprint: rule.fingerprint,
      created: Number(rule.created) || Date.now(),
      hits: Number(rule.hits) || 0
    });
    return store;
  }

  function removeRule(store, host, id) {
    store = normalizeStore(store);
    if (store.hosts[host]) {
      store.hosts[host] = store.hosts[host].filter(function (r) { return r.id !== id; });
      if (!store.hosts[host].length) delete store.hosts[host];
    }
    return store;
  }

  function validateImport(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'Not valid JSON: ' + e.message }; }
    if (!obj || typeof obj !== 'object' || (!obj.hosts && !obj.rules)) {
      return { ok: false, error: 'File has no hosts/rules object — not an Element Blocker backup.' };
    }
    var store = normalizeStore(obj);
    var count = 0;
    Object.keys(store.hosts).forEach(function (h) { count += store.hosts[h].length; });
    if (!count) return { ok: false, error: 'No valid rules found in file.' };
    return { ok: true, store: store, count: count };
  }

  function mergeStores(base, incoming) {
    var out = normalizeStore(base);
    var inc = normalizeStore(incoming);
    Object.keys(inc.hosts).forEach(function (host) {
      inc.hosts[host].forEach(function (r) { out = addRule(out, host, r); });
    });
    return out;
  }

  function countRules(store) {
    var n = 0;
    var s = (store && store.hosts) || {};
    Object.keys(s).forEach(function (h) { n += s[h].length; });
    return n;
  }

  global.EBRules = {
    emptyStore: emptyStore,
    normalizeStore: normalizeStore,
    addRule: addRule,
    removeRule: removeRule,
    validateImport: validateImport,
    mergeStores: mergeStores,
    countRules: countRules,
    isValidRule: isValidRule
  };
})(typeof window !== 'undefined' ? window : globalThis);
