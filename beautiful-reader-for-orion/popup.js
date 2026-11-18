/* Beautiful Reader — toolbar popup: global settings + the
   always-use-Reader site list. Shares storage with the content
   script (same keys), so changes apply everywhere. No background
   page: the popup talks to storage directly and pings the active
   tab so an open reader refreshes live. */
(function () {
  'use strict';
  var C = window.BRCore;
  var K = { settings: 'br.settings.v1', autoSites: 'br.autoSites.v1', library: 'br.library.v1', history: 'br.history.v1' };
  var P = {
    settings: JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS)),
    autoSites: [],
    library: [],
    history: [],
    tabId: null,
    tabHost: '',
    tabUrl: ''
  };

  function storageGet(key, fallback) {
    return new Promise(function (resolve) {
      try {
        if (window.browser && browser.storage && browser.storage.local) {
          browser.storage.local.get(key).then(function (o) { resolve(o && o[key] !== undefined ? o[key] : fallback); }, function () { lsGet(); });
          return;
        }
        if (window.chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(key, function (o) { resolve(o && o[key] !== undefined ? o[key] : fallback); });
          return;
        }
      } catch (e) {}
      lsGet();
      function lsGet() {
        try { var v = localStorage.getItem('br:' + key); resolve(v ? JSON.parse(v) : fallback); }
        catch (e) { resolve(fallback); }
      }
    });
  }
  function storageSet(key, value) {
    try {
      if (window.browser && browser.storage && browser.storage.local) { browser.storage.local.set(obj(key, value)); return; }
      if (window.chrome && chrome.storage && chrome.storage.local) { chrome.storage.local.set(obj(key, value)); return; }
    } catch (e) {}
    try { localStorage.setItem('br:' + key, JSON.stringify(value)); } catch (e) {}
    function obj(k, v) { var o = {}; o[k] = v; return o; }
  }
  function notifyTab() {
    if (P.tabId == null) return;
    try {
      if (window.browser && browser.tabs && browser.tabs.sendMessage) {
        var p = browser.tabs.sendMessage(P.tabId, { type: 'br:settingsChanged' });
        if (p && p.catch) p.catch(function () {});
      } else if (window.chrome && chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(P.tabId, { type: 'br:settingsChanged' }, function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}
  }
  function saveSettings() { storageSet(K.settings, P.settings); notifyTab(); }
  function saveSites() { storageSet(K.autoSites, P.autoSites); notifyTab(); }

  function normalizeHost(raw) {
    var h = String(raw || '').trim().toLowerCase();
    if (!h) return '';
    h = h.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split('#')[0].split(':')[0];
    h = h.replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return '';
    return h;
  }

  function addSite(raw) {
    var h = normalizeHost(raw);
    if (!h) return false;
    if (P.autoSites.indexOf(h) < 0) { P.autoSites.push(h); P.autoSites.sort(); saveSites(); }
    renderSites();
    return true;
  }
  function removeSite(h) {
    P.autoSites = P.autoSites.filter(function (x) { return x !== h; });
    saveSites(); renderSites();
  }
  function setSetting(key, value) {
    P.settings[key] = value;
    saveSettings(); renderDefaults();
  }

  function el(id) { return document.getElementById(id); }
  function fillSelect(sel, pairs, value) {
    sel.innerHTML = '';
    pairs.forEach(function (pr) {
      var o = document.createElement('option');
      o.value = pr[0]; o.textContent = pr[1];
      if (pr[0] === value) o.selected = true;
      sel.appendChild(o);
    });
  }

  function renderSites() {
    el('cur-host').textContent = P.tabHost || 'No web page in this tab';
    el('cur-toggle').checked = !!P.tabHost && P.autoSites.indexOf(P.tabHost) >= 0;
    el('cur-toggle').disabled = !P.tabHost;
    var list = el('site-list');
    list.innerHTML = '';
    if (!P.autoSites.length) {
      var d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'No sites yet. Add one below, or flip the switch for the site you are on.';
      list.appendChild(d);
      return;
    }
    P.autoSites.forEach(function (h) {
      var row = document.createElement('div');
      row.className = 'row';
      var grow = document.createElement('div');
      grow.className = 'grow';
      var hd = document.createElement('div');
      hd.className = 'host'; hd.textContent = h;
      grow.appendChild(hd);
      var rm = document.createElement('button');
      rm.className = 'plain'; rm.textContent = '✕'; rm.title = 'Remove ' + h;
      rm.addEventListener('click', function () { removeSite(h); });
      row.appendChild(grow); row.appendChild(rm);
      list.appendChild(row);
    });
  }

  function renderDefaults() {
    var s = P.settings;
    el('set-follow').checked = !!s.followSystem;
    el('set-wallbreaker').checked = s.wallBreaker !== false;
    var themePairs = Object.keys(C.THEMES).map(function (k) { return [k, C.THEMES[k].label]; });
    fillSelect(el('set-light'), themePairs, s.lightTheme);
    fillSelect(el('set-dark'), themePairs, s.darkTheme);
    fillSelect(el('set-locked'), themePairs, s.lockedTheme);
    var fontPairs = Object.keys(C.FONTS).map(function (k) { return [k, C.FONTS[k].label]; });
    fillSelect(el('set-font'), fontPairs, s.font);
    el('size-val').textContent = s.fontSize + ' pt';
    fillSelect(el('set-lh'), [['1.5', 'Compact'], ['1.65', 'Normal'], ['1.85', 'Relaxed']], String(s.lineHeight));
    fillSelect(el('set-width'), [['narrow', 'Narrow'], ['standard', 'Standard'], ['wide', 'Wide']], s.width);
    fillSelect(el('set-bar'), [['bottom', 'Bottom of screen'], ['top', 'Top of screen']], s.barPos);
    el('set-dropcap').checked = !!s.dropCap;
  }

  function wire() {
    el('reader-toggle').addEventListener('change', function (ev) {
      sendToTab({ type: 'br:toggleReader', on: !!ev.target.checked });
      closePopup();
    });
    el('cur-toggle').addEventListener('change', function (ev) {
      if (!P.tabHost) return;
      if (ev.target.checked) addSite(P.tabHost); else removeSite(P.tabHost);
    });
    el('add-btn').addEventListener('click', function () {
      if (addSite(el('add-input').value)) el('add-input').value = '';
      else el('add-input').focus();
    });
    el('add-input').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') el('add-btn').click();
    });
    el('set-follow').addEventListener('change', function (ev) { setSetting('followSystem', ev.target.checked); });
    el('set-wallbreaker').addEventListener('change', function (ev) { setSetting('wallBreaker', ev.target.checked); });
    el('set-light').addEventListener('change', function (ev) { setSetting('lightTheme', ev.target.value); });
    el('set-dark').addEventListener('change', function (ev) { setSetting('darkTheme', ev.target.value); });
    el('set-locked').addEventListener('change', function (ev) { setSetting('lockedTheme', ev.target.value); });
    el('set-font').addEventListener('change', function (ev) { setSetting('font', ev.target.value); });
    el('size-down').addEventListener('click', function () { setSetting('fontSize', Math.max(16, P.settings.fontSize - 1)); });
    el('size-up').addEventListener('click', function () { setSetting('fontSize', Math.min(24, P.settings.fontSize + 1)); });
    el('set-lh').addEventListener('change', function (ev) { setSetting('lineHeight', parseFloat(ev.target.value)); });
    el('set-width').addEventListener('change', function (ev) { setSetting('width', ev.target.value); });
    el('set-bar').addEventListener('change', function (ev) { setSetting('barPos', ev.target.value); });
    el('set-dropcap').addEventListener('change', function (ev) { setSetting('dropCap', ev.target.checked); });
  }

  function sendToTabWithReply(msg) {
    return new Promise(function (resolve) {
      if (P.tabId == null) { resolve(null); return; }
      try {
        if (window.browser && browser.tabs && browser.tabs.sendMessage) {
          var p = browser.tabs.sendMessage(P.tabId, msg);
          if (p && p.then) { p.then(function (r) { resolve(r || null); }, function () { resolve(null); }); return; }
        }
        if (window.chrome && chrome.tabs && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(P.tabId, msg, function (r) { void chrome.runtime.lastError; resolve(r || null); });
          return;
        }
      } catch (e) {}
      resolve(null);
    });
  }
  // Reflect the page's actual reader state in the toggle: on
  // when the reader is open in this tab. If the page can't
  // answer (no content script there), the toggle stays usable
  // — turning it on still tries to open the reader.
  function queryReaderState() {
    var tgl = el('reader-toggle');
    if (P.tabId == null) { tgl.disabled = true; return; }
    sendToTabWithReply({ type: 'br:getReaderState' }).then(function (st) {
      if (st && typeof st.open === 'boolean') tgl.checked = st.open;
    });
  }
  function sendToTab(msg) {
    if (P.tabId == null) return;
    try {
      if (window.browser && browser.tabs && browser.tabs.sendMessage) {
        var p = browser.tabs.sendMessage(P.tabId, msg);
        if (p && p.catch) p.catch(function () {});
      } else if (window.chrome && chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs.sendMessage(P.tabId, msg, function () { void chrome.runtime.lastError; });
      }
    } catch (e) {}
  }
  function navigateTab(url) {
    if (P.tabId == null) return;
    try {
      if (window.browser && browser.tabs && browser.tabs.update) {
        var p = browser.tabs.update(P.tabId, { url: url });
        if (p && p.catch) p.catch(function () {});
      } else if (window.chrome && chrome.tabs && chrome.tabs.update) {
        chrome.tabs.update(P.tabId, { url: url });
      }
    } catch (e) {}
  }
  function closePopup() { try { window.close(); } catch (e) {} }

  function relTime(ts) {
    var d = Date.now() - (ts || 0);
    if (d < 90 * 1000) return 'just now';
    if (d < 3600 * 1000) return Math.max(1, Math.round(d / 60000)) + 'm ago';
    if (d < 86400 * 1000) return Math.round(d / 3600000) + 'h ago';
    if (d < 7 * 86400 * 1000) return Math.round(d / 86400000) + 'd ago';
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }

  function artRow(title, meta, onOpen, onRemove) {
    var row = document.createElement('div');
    row.className = 'art';
    var grow = document.createElement('div');
    grow.className = 'grow';
    var t = document.createElement('div');
    t.className = 't'; t.textContent = title || 'Untitled';
    grow.appendChild(t);
    if (meta) { var m = document.createElement('div'); m.className = 'm'; m.textContent = meta; grow.appendChild(m); }
    row.appendChild(grow);
    row.addEventListener('click', function () { onOpen(); });
    if (onRemove) {
      var rm = document.createElement('button');
      rm.className = 'plain'; rm.textContent = '✕';
      rm.addEventListener('click', function (ev) { ev.stopPropagation(); onRemove(); });
      row.appendChild(rm);
    }
    return { row: row, grow: grow };
  }

  function renderSaved() {
    var list = el('saved-list');
    list.innerHTML = '';
    if (!P.library.length) {
      var d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Nothing saved yet. Open an article in the reader and tap Save.';
      list.appendChild(d);
      return;
    }
    P.library.forEach(function (item) {
      var meta = (item.site || '') + (item.savedAt ? ' · Saved ' + fmtDate(item.savedAt) : '');
      var r = artRow(item.title, meta, function () {
        sendToTab({ type: 'br:openSaved', url: item.url });
        closePopup();
      }, function () { removeSaved(item.url); });
      list.appendChild(r.row);
    });
  }
  function removeSaved(url) {
    P.library = P.library.filter(function (it) { return it.url !== url; });
    storageSet(K.library, P.library);
    notifyTab();
    renderSaved();
  }

  function renderHistory() {
    var list = el('history-list');
    list.innerHTML = '';
    if (!P.history.length) {
      var d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Nothing here yet. Articles you open in the reader will show up.';
      list.appendChild(d);
      return;
    }
    P.history.forEach(function (h) {
      var meta = (h.site || '') + ' · ' + relTime(h.ts);
      var r = artRow(h.title, meta, function () {
        if (h.url === P.tabUrl) { sendToTab({ type: 'br:openReader' }); }
        else navigateTab(h.url);
        closePopup();
      }, null);
      if (h.done) {
        var dn = document.createElement('div');
        dn.className = 'm done'; dn.textContent = 'Finished ✓';
        r.grow.appendChild(dn);
      } else if (h.progress > 0) {
        var bar = document.createElement('div');
        bar.className = 'bar';
        var fill = document.createElement('i');
        fill.style.width = Math.round(h.progress * 100) + '%';
        bar.appendChild(fill);
        r.grow.appendChild(bar);
        var pc = document.createElement('div');
        pc.className = 'm'; pc.textContent = Math.round(h.progress * 100) + '% read';
        r.grow.appendChild(pc);
      }
      list.appendChild(r.row);
    });
  }

  var CLEAR_WINDOWS = { hour: 3600 * 1000, day: 86400 * 1000, week: 7 * 86400 * 1000 };
  function clearHistory(range) {
    if (range === 'all') P.history = [];
    else {
      var cutoff = Date.now() - (CLEAR_WINDOWS[range] || 0);
      P.history = P.history.filter(function (h) { return (h.ts || 0) < cutoff; });
    }
    storageSet(K.history, P.history);
    notifyTab();
    renderHistory();
  }

  /* ---------- updates (v1.17.0, update-check.js) ---------- */
  var U = window.BRUpdate || null;
  var updState = { available: null, dismissed: '' };
  function renderUpdates() {
    if (!U) return;
    el('upd-version').textContent = 'v' + U.currentVersion();
    var av = updState.available;
    var show = !!(av && av.version && av.version !== updState.dismissed);
    el('upd-notice').hidden = !show;
    if (show) el('upd-notice-text').textContent = 'Update available: v' + av.version;
  }
  function updStatus(text) { el('upd-status').textContent = text; }
  function applyCheckResult(r, manual) {
    if (!U || !r) return;
    if (r.state === 'update') {
      updState.available = { version: r.version, update_link: r.update_link || '' };
      renderUpdates();
      updStatus('Update available: v' + r.version + ' — tap Download, then install from file in Orion.');
    } else if (manual && r.state === 'current') {
      updState.available = null;
      renderUpdates();
      updStatus("You're on the latest version (v" + U.currentVersion() + ').');
    } else if (manual && r.state === 'error') {
      updStatus("Couldn't check for updates (feed unreachable).");
    }
  }
  function wireUpdates() {
    if (!U) { var sec = el('sec-updates'); if (sec) sec.hidden = true; return; }
    el('upd-version').textContent = 'v' + U.currentVersion();
    el('upd-check').addEventListener('click', function () {
      var btn = el('upd-check');
      btn.disabled = true;
      updStatus('Checking…');
      U.checkNow(true).then(function (r) { btn.disabled = false; applyCheckResult(r, true); });
    });
    el('upd-download').addEventListener('click', function () {
      if (updState.available) U.openUpdate(updState.available.update_link);
    });
    el('upd-dismiss').addEventListener('click', function () {
      if (!updState.available) return;
      updState.dismissed = updState.available.version;
      U.dismissUpdate(updState.available.version);
      renderUpdates();
    });
    U.getState().then(function (st) {
      updState.available = st.available;
      updState.dismissed = st.dismissed;
      renderUpdates();
      // Auto check when the popup opens — throttled inside
      // checkNow, so this fetches at most once per 12 h.
      // Re-sync from storage afterwards: a check that was
      // already in flight (background startup) may have
      // stored its find after our first read.
      U.checkNow(false).then(function (r) {
        applyCheckResult(r, false);
        return U.getState();
      }).then(function (st2) {
        if (st2 && st2.available) {
          updState.available = st2.available;
          updState.dismissed = st2.dismissed;
          renderUpdates();
          if (st2.available.version !== st2.dismissed) {
            updStatus('Update available: v' + st2.available.version + ' — tap Download, then install from file in Orion.');
          }
        }
      });
    });
  }

  function wireTabs() {
    var btns = document.querySelectorAll('#tabs button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.toggle('on', x === b); });
        ['settings', 'saved', 'history'].forEach(function (name) {
          el('tab-' + name).hidden = name !== b.getAttribute('data-tab');
        });
      });
    });
    var clearBtn = el('clear-btn');
    var armed = null;
    clearBtn.addEventListener('click', function () {
      if (!armed) {
        armed = setTimeout(function () {
          armed = null;
          clearBtn.textContent = 'Clear history';
          clearBtn.classList.remove('armed');
        }, 2600);
        clearBtn.textContent = 'Tap again to confirm';
        clearBtn.classList.add('armed');
        return;
      }
      clearTimeout(armed); armed = null;
      clearBtn.textContent = 'Clear history';
      clearBtn.classList.remove('armed');
      clearHistory(el('clear-range').value);
    });
  }

  function activeTab() {
    return new Promise(function (resolve) {
      try {
        if (window.browser && browser.tabs && browser.tabs.query) {
          browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) { resolve(tabs && tabs[0]); }, function () { resolve(null); });
          return;
        }
        if (window.chrome && chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { resolve(tabs && tabs[0]); });
          return;
        }
      } catch (e) {}
      resolve(null);
    });
  }

  function init() {
    Promise.all([storageGet(K.settings, null), storageGet(K.autoSites, []), activeTab(), storageGet(K.library, []), storageGet(K.history, [])]).then(function (vals) {
      if (vals[0]) {
        Object.keys(C.DEFAULT_SETTINGS).forEach(function (k) {
          if (vals[0][k] !== undefined) P.settings[k] = vals[0][k];
        });
      }
      P.autoSites = Array.isArray(vals[1]) ? vals[1] : [];
      var tab = vals[2];
      if (tab) {
        P.tabId = tab.id;
        P.tabUrl = tab.url || '';
        P.tabHost = tab.url ? C.hostOf(tab.url) : '';
      }
      P.library = Array.isArray(vals[3]) ? vals[3] : [];
      P.history = Array.isArray(vals[4]) ? vals[4] : [];
      wire();
      wireTabs();
      wireUpdates();
      queryReaderState();
      renderSites();
      renderDefaults();
      renderSaved();
      renderHistory();
    });
  }

  window.__BRPOPUP = { state: P, addSite: addSite, removeSite: removeSite, setSetting: setSetting, normalizeHost: normalizeHost, removeSaved: removeSaved, clearHistory: clearHistory, renderSaved: renderSaved, renderHistory: renderHistory };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
