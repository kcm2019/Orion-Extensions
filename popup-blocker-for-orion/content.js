'use strict';
/* Popup Blocker for Orion v1.1.0 (Firefox MV2) — content script.
 *
 * Jobs:
 *  1. Inject page-hook.js into the page world at document_start
 *     (it overrides window.open and watches _blank links/forms).
 *  2. Hold the settings (mode + per-site allowlist) in
 *     browser.storage.local (chrome.storage / localStorage
 *     fallbacks, same layered pattern as the YT extension) and
 *     push them to the hook.
 *  3. Top frame only: the in-page UI — a "Popup blocked" pill that
 *     shrinks to a sticky count badge (E), expanding on tap into a
 *     panel listing every blocked popup for this page, each with
 *     Open (new tab) / Open in current tab / Copy URL / Dismiss (D).
 *     Subframes forward their blocked attempts to the top frame so
 *     they land in the same panel.
 *
 * Opening a blocked popup: primary route is the background script
 * (browser.tabs.create — extension-privileged, so no popup blocker
 * can stop it). If Orion doesn't answer there, fall back to asking
 * the page hook to use its one-time allowance with the native
 * opener.
 */
(function () {
  var api = null;
  try { if (typeof browser !== 'undefined') api = browser; } catch (e) {}
  if (!api) { try { if (typeof chrome !== 'undefined') api = chrome; } catch (e) {} }

  var IS_TOP = false;
  try { IS_TOP = window.top === window; } catch (e) { IS_TOP = true; }

  var SETTINGS = { mode: 'strict', allowlist: [] };
  var settingsLoaded = false;

  /* ---------------- storage (layered) ---------------- */
  function storageGet() {
    return new Promise(function (resolve) {
      try {
        if (api && api.storage && api.storage.local) {
          var p = api.storage.local.get(['opb_mode', 'opb_allowlist']);
          if (p && typeof p.then === 'function') {
            p.then(function (s) { resolve(s || {}); }, function () { resolve(localFallback()); });
          } else {
            // chrome callback form
            api.storage.local.get(['opb_mode', 'opb_allowlist'], function (s) { resolve(s || {}); });
          }
          return;
        }
      } catch (e) {}
      resolve(localFallback());
      function localFallback() {
        try {
          return {
            opb_mode: localStorage.getItem('opb_mode') || undefined,
            opb_allowlist: JSON.parse(localStorage.getItem('opb_allowlist') || '[]'),
          };
        } catch (err) { return {}; }
      }
    });
  }
  function storageSet() {
    var data = { opb_mode: SETTINGS.mode, opb_allowlist: SETTINGS.allowlist };
    try {
      if (api && api.storage && api.storage.local) { api.storage.local.set(data); return; }
    } catch (e) {}
    try {
      localStorage.setItem('opb_mode', data.opb_mode);
      localStorage.setItem('opb_allowlist', JSON.stringify(data.opb_allowlist));
    } catch (e) {}
  }
  function loadSettings() {
    return storageGet().then(function (s) {
      if (s.opb_mode === 'smart' || s.opb_mode === 'strict') SETTINGS.mode = s.opb_mode;
      if (Array.isArray(s.opb_allowlist)) SETTINGS.allowlist = s.opb_allowlist;
      settingsLoaded = true;
      pushConfig();
      renderControls();
    });
  }

  function siteAllowed() {
    try { return SETTINGS.allowlist.indexOf(window.location.hostname) !== -1; }
    catch (e) { return false; }
  }

  function pushConfig() {
    try {
      window.postMessage({
        __opb: true, from: 'content', type: 'config',
        mode: SETTINGS.mode, allowSite: siteAllowed(),
      }, '*');
    } catch (e) {}
  }

  /* ---------------- inject the page hook ---------------- */
  function hookUrl() {
    try { if (api && api.runtime && api.runtime.getURL) return api.runtime.getURL('page-hook.js'); }
    catch (e) {}
    return null;
  }
  // v1.1 injection: v1.0 loaded the hook by <script src>, which a
  // strict page CSP (common on streaming sites) can refuse without
  // firing onerror. Now: fetch the hook in the extension context
  // (not subject to page CSP) and inject it as inline text first,
  // via wrappedJSObject when Firefox/Orion offers it. The hook
  // posts 'hook-ready'; if that doesn't arrive, retry with the src
  // element, then with a wrappedJSObject eval.
  var hookReady = false;
  var hookCode = null;

  function inlineScript(code) {
    try {
      var w = window.wrappedJSObject;
      if (w && w.document) {
        var sv = w.document.createElement('script');
        sv.textContent = code;
        (w.document.head || w.document.documentElement).appendChild(sv);
        sv.remove();
        return true;
      }
    } catch (e) {}
    try {
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      return true;
    } catch (e) {}
    return false;
  }
  function injectViaSrc(url) {
    var parent = document.head || document.documentElement;
    if (!parent || !url) return;
    try {
      var s = document.createElement('script');
      s.src = url;
      parent.appendChild(s);
      setTimeout(function () { try { s.remove(); } catch (e) {} }, 1000);
    } catch (e) {}
  }
  function injectHook() {
    var url = hookUrl();
    if (!url) return;
    var done = false;
    function useCode(code) {
      if (done) return;
      done = true;
      hookCode = code;
      inlineScript(code);
      setTimeout(function () {
        if (!hookReady) injectViaSrc(url);
      }, 700);
      setTimeout(function () {
        if (!hookReady && hookCode) {
          try {
            var w = window.wrappedJSObject;
            if (w && typeof w.eval === 'function') w.eval(hookCode);
            else inlineScript(hookCode);
          } catch (e) {}
        }
      }, 1600);
    }
    if (typeof fetch === 'function') {
      fetch(url).then(function (r) { return r.text(); }).then(useCode)
        .catch(function () { injectViaSrc(url); });
    } else {
      injectViaSrc(url);
    }
  }
  injectHook();

  /* ---------------- blocked entries ---------------- */
  var entries = []; // newest last
  var MAX_ENTRIES = 50;

  function addEntry(entry, frameHost) {
    if (!entry || !entry.id) return;
    if (entries.some(function (x) { return x.id === entry.id; })) return;
    entry.frameHost = frameHost || '';
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    onNewBlock();
  }
  function updateEntry(id, url) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) {
        entries[i].url = url;
        entries[i].pendingBlank = false;
        renderList();
        return;
      }
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__opb !== true) return;
    if (d.type === 'need-config') { pushConfig(); return; }
    if (d.type === 'hook-ready') { if (e.source === window) hookReady = true; return; }
    if (d.type === 'blocked') {
      if (e.source !== window && d.from !== 'frame') return;
      if (IS_TOP) {
        addEntry(d.entry, d.from === 'frame' ? d.frameHost : '');
      }
      return;
    }
    if (d.type === 'blocked-update') {
      if (IS_TOP) updateEntry(d.id, d.url);
      return;
    }
    if (d.type === 'blocked-forward' && IS_TOP) {
      addEntry(d.entry, d.frameHost);
    }
  });

  // Subframe: forward blocks to the top frame's panel.
  if (!IS_TOP) {
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      var d = e.data;
      if (!d || d.__opb !== true || d.from === 'content') return;
      if (d.type === 'blocked' || d.type === 'blocked-update') {
        try {
          window.top.postMessage({
            __opb: true, from: 'frame',
            type: d.type === 'blocked' ? 'blocked-forward' : 'blocked-update',
            entry: d.entry, id: d.id, url: d.url,
            frameHost: window.location.hostname,
          }, '*');
        } catch (err) {}
      }
    });
  }

  /* ---------------- opening blocked popups ---------------- */
  function isOpenable(url) {
    try {
      var p = new URL(url).protocol;
      return p === 'http:' || p === 'https:';
    } catch (e) { return false; }
  }

  function pageHookOpen(url) {
    try {
      window.postMessage({ __opb: true, from: 'content', type: 'open-now', url: url }, '*');
    } catch (e) {}
  }

  function openInNewTab(entry) {
    if (!isOpenable(entry.url)) { setStatus('That URL can\'t be opened safely (' + entry.url.slice(0, 40) + '…)'); return; }
    var sent = false;
    try {
      if (api && api.runtime && api.runtime.sendMessage) {
        var p = api.runtime.sendMessage({ type: 'opb-open-tab', url: entry.url });
        sent = true;
        if (p && typeof p.then === 'function') {
          p.then(function (resp) {
            if (!resp || !resp.ok) { pageHookOpen(entry.url); setStatus('Opened via page (tabs API unavailable in Orion)'); }
          }, function () { pageHookOpen(entry.url); });
        }
      }
    } catch (e) {}
    if (!sent) pageHookOpen(entry.url);
  }

  function openInCurrentTab(entry) {
    if (!isOpenable(entry.url)) { setStatus('That URL can\'t be opened safely'); return; }
    window.location.href = entry.url;
  }

  function copyUrl(entry) {
    function done() { setStatus('URL copied'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(entry.url).then(done, function () { legacyCopy(); });
        return;
      }
    } catch (e) {}
    legacyCopy();
    function legacyCopy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = entry.url;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
        document.documentElement.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (err) { setStatus('Copy failed — long-press the URL to copy it'); }
    }
  }

  /* ---------------- UI (top frame only) ---------------- */
  var ui = null; // { host, shadow, pill, badge, panel, list, status, modeBtn, allowBtn, title }
  var uiState = 'hidden'; // hidden | pill | badge | panel
  var shrinkTimer = null;

  var CSS = [
    ':host { position: fixed; top: 0; right: 0; z-index: 2147483647; }',
    '.wrap { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 10px); right: 10px;',
    '  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;',
    '  font-family: -apple-system, system-ui, sans-serif; pointer-events: none; }',
    'button { pointer-events: auto; cursor: pointer; }',
    '.pill { background: #c62828; color: #fff; border: 0; border-radius: 999px;',
    '  padding: 9px 14px; font-size: 13px; font-weight: 600;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,.35); }',
    '.badge { background: #c62828; color: #fff; border: 0; border-radius: 999px;',
    '  width: 30px; height: 30px; font-size: 12px; font-weight: 700;',
    '  box-shadow: 0 2px 10px rgba(0,0,0,.3); padding: 0; }',
    '.panel { pointer-events: auto; width: min(340px, 92vw); max-height: 62vh;',
    '  display: flex; flex-direction: column; background: rgba(22,22,24,.97); color: #f2f2f7;',
    '  border-radius: 14px; box-shadow: 0 10px 34px rgba(0,0,0,.45); overflow: hidden; }',
    '.phead { display: flex; align-items: center; justify-content: space-between;',
    '  padding: 10px 12px 6px; font-size: 13px; font-weight: 700; }',
    '.x { background: transparent; border: 0; color: #f2f2f7; font-size: 17px; padding: 2px 6px; }',
    '.controls { display: flex; gap: 6px; padding: 2px 12px 8px; flex-wrap: wrap; }',
    '.ctl { background: #2c2c2e; color: #f2f2f7; border: 0; border-radius: 8px;',
    '  padding: 6px 9px; font-size: 11.5px; }',
    '.list { overflow-y: auto; padding: 0 8px; }',
    '.entry { background: #1c1c1e; border: 1px solid #333336; border-radius: 10px;',
    '  padding: 8px 9px; margin: 0 0 8px; }',
    '.dom { font-size: 12.5px; font-weight: 700; word-break: break-all; }',
    '.url { font-size: 11px; color: #aeaeb2; word-break: break-all; margin: 2px 0; user-select: text; }',
    '.meta { font-size: 10.5px; color: #8e8e93; margin-bottom: 6px; }',
    '.row { display: flex; gap: 5px; flex-wrap: wrap; }',
    '.act { background: #0a84ff; color: #fff; border: 0; border-radius: 7px; padding: 6px 9px; font-size: 11.5px; font-weight: 600; }',
    '.act.secondary { background: #3a3a3c; font-weight: 400; }',
    '.act:disabled { opacity: .45; }',
    '.status { font-size: 11px; color: #ffd60a; padding: 0 12px 8px; min-height: 0; }',
    '.foot { padding: 0 12px 10px; }',
    '.clear { background: transparent; border: 0; color: #ff453a; font-size: 12px; padding: 4px 0; }',
    '.hidden { display: none !important; }',
  ].join('\n');

  function buildUi() {
    if (ui || !document.documentElement) return;
    var host = document.createElement('div');
    host.id = 'orion-popup-blocker-host';
    var shadow;
    try { shadow = host.attachShadow({ mode: 'open' }); }
    catch (e) { return; }
    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'wrap';

    var pill = document.createElement('button');
    pill.className = 'pill hidden';
    pill.addEventListener('click', function () { setUiState('panel'); });

    var badge = document.createElement('button');
    badge.className = 'badge hidden';
    badge.addEventListener('click', function () { setUiState('panel'); });

    var panel = document.createElement('div');
    panel.className = 'panel hidden';

    var head = document.createElement('div');
    head.className = 'phead';
    var title = document.createElement('span');
    var closeBtn = document.createElement('button');
    closeBtn.className = 'x';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () { setUiState(entries.length ? 'badge' : 'hidden'); });
    head.appendChild(title);
    head.appendChild(closeBtn);

    var controls = document.createElement('div');
    controls.className = 'controls';
    var modeBtn = document.createElement('button');
    modeBtn.className = 'ctl';
    modeBtn.addEventListener('click', function () {
      SETTINGS.mode = SETTINGS.mode === 'strict' ? 'smart' : 'strict';
      storageSet(); pushConfig(); renderControls();
      setStatus(SETTINGS.mode === 'smart'
        ? 'Smart: popups from your own tap are allowed'
        : 'Strict: every popup is blocked');
    });
    var allowBtn = document.createElement('button');
    allowBtn.className = 'ctl';
    allowBtn.addEventListener('click', function () {
      var hostName = '';
      try { hostName = window.location.hostname; } catch (e) {}
      if (!hostName) return;
      var i = SETTINGS.allowlist.indexOf(hostName);
      if (i === -1) SETTINGS.allowlist.push(hostName); else SETTINGS.allowlist.splice(i, 1);
      storageSet(); pushConfig(); renderControls();
      setStatus(i === -1 ? 'Popups now allowed on ' + hostName : 'Allowlist removed for ' + hostName);
    });
    controls.appendChild(modeBtn);
    controls.appendChild(allowBtn);

    var status = document.createElement('div');
    status.className = 'status';

    var list = document.createElement('div');
    list.className = 'list';

    var foot = document.createElement('div');
    foot.className = 'foot';
    var clearBtn = document.createElement('button');
    clearBtn.className = 'clear';
    clearBtn.textContent = 'Clear all';
    clearBtn.addEventListener('click', function () {
      entries = [];
      renderList();
      setUiState('hidden');
    });
    foot.appendChild(clearBtn);

    panel.appendChild(head);
    panel.appendChild(controls);
    panel.appendChild(status);
    panel.appendChild(list);
    panel.appendChild(foot);

    wrap.appendChild(pill);
    wrap.appendChild(badge);
    wrap.appendChild(panel);
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);

    ui = { host: host, shadow: shadow, pill: pill, badge: badge, panel: panel,
           list: list, status: status, modeBtn: modeBtn, allowBtn: allowBtn, title: title };
    renderControls();
  }

  function setStatus(msg) {
    if (!ui) return;
    ui.status.textContent = msg || '';
  }

  function renderControls() {
    if (!ui) return;
    ui.modeBtn.textContent = 'Mode: ' + (SETTINGS.mode === 'smart' ? 'Smart' : 'Strict');
    ui.allowBtn.textContent = siteAllowed()
      ? '✓ Allowed on this site (tap to undo)'
      : 'Always allow this site';
    ui.title.textContent = 'Blocked popups (' + entries.length + ')';
  }

  function setUiState(state) {
    buildUi();
    if (!ui) return;
    uiState = state;
    if (shrinkTimer) { clearTimeout(shrinkTimer); shrinkTimer = null; }
    ui.pill.classList.toggle('hidden', state !== 'pill');
    ui.badge.classList.toggle('hidden', state !== 'badge');
    ui.panel.classList.toggle('hidden', state !== 'panel');
    if (state === 'pill') {
      ui.pill.textContent = '🚫 Popup blocked · ' + entries.length + ' — tap to view';
      shrinkTimer = setTimeout(function () {
        if (uiState === 'pill') setUiState(entries.length ? 'badge' : 'hidden');
      }, 4000);
    }
    if (state === 'badge') ui.badge.textContent = String(entries.length);
    if (state === 'panel') renderList();
    renderControls();
  }

  function onNewBlock() {
    if (!IS_TOP) return;
    if (!document.body && !document.documentElement) return;
    buildUi();
    if (!ui) {
      // DOM not ready yet; retry when it is.
      document.addEventListener('DOMContentLoaded', function () { onNewBlock(); }, { once: true });
      return;
    }
    if (uiState === 'panel') { renderList(); renderControls(); }
    else setUiState('pill');
  }

  function fmtTime(t) {
    try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
    catch (e) { return ''; }
  }
  function hostOf(url) {
    try { return new URL(url).hostname || url; } catch (e) { return url; }
  }

  function renderList() {
    if (!ui) return;
    ui.list.textContent = '';
    // newest first
    entries.slice().reverse().forEach(function (entry) {
      var box = document.createElement('div');
      box.className = 'entry';

      var dom = document.createElement('div');
      dom.className = 'dom';
      dom.textContent = entry.pendingBlank ? 'about:blank (waiting…)' : hostOf(entry.url);
      box.appendChild(dom);

      var urlEl = document.createElement('div');
      urlEl.className = 'url';
      urlEl.textContent = entry.url;
      box.appendChild(urlEl);

      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = entry.kind + ' · ' + fmtTime(entry.time) +
        (entry.note ? ' · ' + entry.note : '') +
        (entry.frameHost ? ' · via iframe ' + entry.frameHost : '');
      box.appendChild(meta);

      var row = document.createElement('div');
      row.className = 'row';

      var openBtn = document.createElement('button');
      openBtn.className = 'act';
      openBtn.textContent = 'Open';
      openBtn.disabled = entry.pendingBlank || !isOpenable(entry.url);
      openBtn.addEventListener('click', function () { openInNewTab(entry); });
      row.appendChild(openBtn);

      var curBtn = document.createElement('button');
      curBtn.className = 'act secondary';
      curBtn.textContent = 'Current tab';
      curBtn.disabled = entry.pendingBlank || !isOpenable(entry.url);
      curBtn.addEventListener('click', function () { openInCurrentTab(entry); });
      row.appendChild(curBtn);

      var copyBtn = document.createElement('button');
      copyBtn.className = 'act secondary';
      copyBtn.textContent = 'Copy URL';
      copyBtn.addEventListener('click', function () { copyUrl(entry); });
      row.appendChild(copyBtn);

      var disBtn = document.createElement('button');
      disBtn.className = 'act secondary';
      disBtn.textContent = 'Dismiss';
      disBtn.addEventListener('click', function () {
        entries = entries.filter(function (x) { return x.id !== entry.id; });
        renderList(); renderControls();
        if (!entries.length) setUiState('hidden');
      });
      row.appendChild(disBtn);

      box.appendChild(row);
      ui.list.appendChild(box);
    });
  }

  loadSettings();
})();
