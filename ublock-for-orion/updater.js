/* uBlock for Orion — filter list registry, fetching and auto-update.
 * Same default lists, from the same source URLs, as a stock uBlock Origin
 * install: the five uAssets lists, EasyList, EasyPrivacy, Peter Lowe's list
 * and the Online Malicious URL Blocklist. Auto-update honours each list's
 * own `! Expires:` header when present, falling back to the user's interval.
 * Runs from the dashboard AND from the background page — whichever Orion
 * actually wakes up — and both write through the same storage keys.
 */
(function (root) {
  'use strict';
  var E = root.UBOEngine, S = root.UBOStore;

  var REGISTRY = [
    { id: 'ublock-filters',    name: 'uBlock filters – Ads',          group: 'Built-in', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt' },
    { id: 'ublock-badware',    name: 'uBlock filters – Badware risks', group: 'Built-in', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt' },
    { id: 'ublock-privacy',    name: 'uBlock filters – Privacy',       group: 'Built-in', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt' },
    { id: 'ublock-quick-fixes', name: 'uBlock filters – Quick fixes',  group: 'Built-in', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt' },
    { id: 'ublock-unbreak',    name: 'uBlock filters – Unbreak',       group: 'Built-in', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt' },
    { id: 'easylist',          name: 'EasyList',                       group: 'Ads',     url: 'https://easylist.to/easylist/easylist.txt' },
    { id: 'easyprivacy',       name: 'EasyPrivacy',                    group: 'Privacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
    { id: 'urlhaus',           name: 'Online Malicious URL Blocklist', group: 'Malware', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt' },
    { id: 'antiadblockfilters', name: 'Adblock Warning Removal List', group: 'Annoyances', url: 'https://easylist-downloads.adblockplus.org/antiadblockfilters.txt' },
    { id: 'plowe',             name: "Peter Lowe's Ad and tracking server list", group: 'Multipurpose', url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext' }
  ];

  function allLists(settings) {
    var disabled = {};
    (settings.disabledLists || []).forEach(function (id) { disabled[id] = true; });
    var out = REGISTRY.map(function (l) {
      return Object.assign({}, l, { enabled: !disabled[l.id], builtin: true });
    });
    (settings.customLists || []).forEach(function (l) { out.push(Object.assign({}, l, { builtin: false })); });
    return out;
  }

  function parseExpiresHours(text) {
    var m = /!\s*Expires:\s*(\d+)\s*(hour|day)/i.exec(text || '');
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return m[2].toLowerCase() === 'day' ? n * 24 : n;
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-cache', credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function updateOne(entry) {
    return fetchText(entry.url).then(function (text) {
      var parsed = E.parseList(text, entry.id);
      var stripped = E.stripForStorage(parsed);
      return S.setLarge('parsed:' + entry.id, stripped).then(function () {
        return S.get('listsMeta').then(function (meta) {
          meta = meta || {};
          meta[entry.id] = {
            name: entry.name, url: entry.url, updatedAt: Date.now(),
            expiresHours: parseExpiresHours(text), counts: parsed.counts,
            unsupported: parsed.unsupported, bytes: text.length
          };
          return S.set('listsMeta', meta).then(function () { return meta[entry.id]; });
        });
      });
    });
  }

  function rebuildCompiled(settings) {
    var lists = allLists(settings).filter(function (l) { return l.enabled; });
    var chain = Promise.resolve(), parsedArr = [];
    lists.forEach(function (l) {
      chain = chain.then(function () {
        return S.getLarge('parsed:' + l.id).then(function (p) { if (p) parsedArr.push(p); });
      });
    });
    return chain.then(function () {
      if (settings.myFiltersEnabled && (settings.myFilters || '').trim()) {
        parsedArr.push(E.parseList(settings.myFilters, 'user'));
      }
      var compiled = E.mergeAll(parsedArr);
      var stripped = E.stripForStorage(compiled);
      return S.setLarge('compiled', stripped).then(function () {
        var meta = {
          builtAt: Date.now(), counts: compiled.counts, unsupported: compiled.unsupported,
          blockDomains: compiled.blockDomains.length, listsUsed: parsedArr.map(function (p) { return p.listId; })
        };
        return S.set('compiledMeta', meta).then(function () { return meta; });
      });
    });
  }

  // Update every enabled list that is stale (or all, when forced).
  // Returns [{id, ok, error?}] and rebuilds the compiled set if anything changed.
  function updateAll(settings, force) {
    return S.get('listsMeta').then(function (meta) {
      meta = meta || {};
      var now = Date.now(), results = [], changed = false;
      var lists = allLists(settings).filter(function (l) { return l.enabled; });
      var chain = Promise.resolve();
      lists.forEach(function (l) {
        chain = chain.then(function () {
          var m = meta[l.id];
          var ttlH = (m && m.expiresHours) || settings.updateIntervalHours || 24;
          var stale = !m || force || (now - (m.updatedAt || 0)) > ttlH * 3600 * 1000;
          if (!stale) { results.push({ id: l.id, ok: true, skipped: true }); return null; }
          return updateOne(l).then(function () {
            changed = true; results.push({ id: l.id, ok: true });
          }).catch(function (err) {
            results.push({ id: l.id, ok: false, error: String(err && err.message || err) });
          });
        });
      });
      return chain.then(function () {
        if (changed || force) {
          return rebuildCompiled(settings).then(function () { return results; })
            .catch(function (err) {
              results.push({ id: '_compile', ok: false, error: String(err && err.message || err) });
              return results;
            });
        }
        return results;
      });
    });
  }

  function purgeAll() {
    return S.getSettings().then(function (settings) {
      var lists = allLists(settings);
      var chain = Promise.resolve();
      lists.forEach(function (l) {
        chain = chain.then(function () { return S.removeLarge('parsed:' + l.id); });
      });
      return chain.then(function () {
        return S.removeLarge('compiled').then(function () { return S.set('listsMeta', {}); });
      });
    });
  }

  root.UBOUpdater = {
    REGISTRY: REGISTRY, allLists: allLists, updateOne: updateOne,
    updateAll: updateAll, rebuildCompiled: rebuildCompiled, purgeAll: purgeAll,
    parseExpiresHours: parseExpiresHours
  };
})(typeof self !== 'undefined' ? self : this);
