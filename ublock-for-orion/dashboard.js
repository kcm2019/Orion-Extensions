/* uBlock for Orion — dashboard (runs as a full tab; popups don't render on Orion) */
(function () {
  'use strict';
  var E = self.UBOEngine, S = self.UBOStore, U = self.UBOUpdater;
  var $ = function (id) { return document.getElementById(id); };
  var settings = null;

  function fmtTime(t) { return t ? new Date(t).toLocaleString() : 'never'; }
  function notifyReload() {
    try {
      var api = (typeof browser !== 'undefined' ? browser : chrome);
      var p = api.runtime.sendMessage({ kind: 'reload' });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- tabs ----------
  document.querySelectorAll('#tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      ['lists', 'filters', 'logger', 'switches', 'diag', 'backup'].forEach(function (t) {
        $('tab-' + t).hidden = t !== btn.getAttribute('data-tab');
      });
      if (btn.getAttribute('data-tab') === 'logger') renderLog();
      if (btn.getAttribute('data-tab') === 'diag') renderDiag();
      if (btn.getAttribute('data-tab') === 'switches') renderSites();
    });
  });

  // ---------- status + lists ----------
  function renderStatus() {
    return Promise.all([S.get('compiledMeta'), S.get('listsMeta')]).then(function (r) {
      var meta = r[0], listsMeta = r[1] || {};
      if (!meta) {
        $('statusLine').textContent = 'No filter lists downloaded yet. Hit “Update now”.';
      } else {
        $('statusLine').textContent =
          'Compiled ' + fmtTime(meta.builtAt) + ' — ' +
          meta.counts.network.toLocaleString() + ' network, ' +
          meta.counts.cosmetic.toLocaleString() + ' cosmetic, ' +
          meta.counts.scriptlets.toLocaleString() + ' scriptlets, ' +
          (meta.counts.redirect || 0).toLocaleString() + ' redirect rules, ' +
          meta.blockDomains.toLocaleString() + ' fallback domains. ' +
          'Unsupported (not applied): ' + meta.unsupported.procedural + ' procedural, ' + meta.unsupported.style + ' style rules.';
      }
      renderListTable(listsMeta);
    });
  }
  function renderListTable(listsMeta) {
    var tbody = document.querySelector('#listTable tbody');
    tbody.innerHTML = '';
    U.allLists(settings).forEach(function (l) {
      var m = (listsMeta || {})[l.id];
      var tr = document.createElement('tr');
      var rules = m ? (m.counts.network + m.counts.cosmetic + m.counts.scriptlets).toLocaleString() : '—';
      tr.innerHTML =
        '<td><input type="checkbox" data-act="toggle"' + (l.enabled ? ' checked' : '') + '></td>' +
        '<td><b>' + esc(l.name) + '</b><br><span class="hint">' + esc(l.group || 'Custom') + ' · ' + esc(l.url) + '</span></td>' +
        '<td>' + (m ? fmtTime(m.updatedAt) : 'never') + '</td>' +
        '<td>' + rules + '</td>' +
        '<td><button class="small" data-act="update">Update</button>' +
        (l.builtin ? '' : ' <button class="small" data-act="del">Delete</button>') + '</td>';
      tr.querySelectorAll('button, input').forEach(function (el) {
        el.addEventListener('click', function () { listAction(l, el.getAttribute('data-act'), el); });
      });
      tbody.appendChild(tr);
    });
  }
  function listAction(l, act, el) {
    if (act === 'toggle') {
      var on = el.checked;
      S.getSettings().then(function (s) {
        if (l.builtin) {
          s.disabledLists = s.disabledLists || [];
          s.disabledLists = s.disabledLists.filter(function (id) { return id !== l.id; });
          if (!on) s.disabledLists.push(l.id);
        } else {
          s.customLists.forEach(function (c) { if (c.id === l.id) c.enabled = on; });
        }
        settings = s;
        return S.saveSettings(s).then(function () { return U.rebuildCompiled(s); });
      }).then(function () { notifyReload(); renderStatus(); });
    } else if (act === 'update') {
      $('updateStatus').textContent = 'Fetching ' + l.name + '…';
      U.updateOne(l).then(function () { return U.rebuildCompiled(settings); }).then(function () {
        $('updateStatus').textContent = l.name + ' updated.'; notifyReload(); renderStatus();
      }).catch(function (err) { $('updateStatus').textContent = 'Failed: ' + err.message; });
    } else if (act === 'del') {
      S.getSettings().then(function (s) {
        s.customLists = s.customLists.filter(function (c) { return c.id !== l.id; });
        settings = s;
        return S.saveSettings(s).then(function () { return S.removeLarge('parsed:' + l.id); })
          .then(function () { return U.rebuildCompiled(s); });
      }).then(function () { notifyReload(); renderStatus(); });
    }
  }

  function runUpdate(force) {
    $('updateStatus').textContent = force ? 'Updating all enabled lists…' : 'Checking for stale lists…';
    return U.updateAll(settings, force).then(function (results) {
      // v1.2.1: ALWAYS rebuild the compiled set with the running engine,
      // even when no list was stale — an engine fix (like the match-all
      // drop) must take effect on already-downloaded lists, not only on
      // the next list update.
      return U.rebuildCompiled(settings).then(function () { return results; });
    }).then(function (results) {
      var lines = results.map(function (r) {
        return (r.ok ? (r.skipped ? '• ' : '✓ ') : '✗ ') + r.id + (r.skipped ? ' (fresh)' : '') + (r.error ? ': ' + r.error : '');
      });
      $('updateStatus').textContent = lines.join('\n');
      notifyReload();
      return renderStatus();
    }).catch(function (err) { $('updateStatus').textContent = 'Update failed: ' + err.message; });
  }

  // ---------- logger ----------
  function renderLog() {
    var f = ($('logFilter').value || '').toLowerCase();
    S.getLog().then(function (entries) {
      var tbody = document.querySelector('#logTable tbody');
      tbody.innerHTML = '';
      entries.slice().reverse().filter(function (e) {
        return !f || JSON.stringify(e).toLowerCase().indexOf(f) !== -1;
      }).slice(0, 200).forEach(function (e) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + new Date(e.t).toLocaleTimeString() + '</td><td>' + esc(e.layer) +
          '</td><td>' + esc(e.action) + '</td><td>' + esc(e.host) + '</td><td>' + esc(e.detail) +
          '</td><td class="url">' + esc(e.url) + '</td>';
        tbody.appendChild(tr);
      });
    });
  }

  // ---------- per-site switches ----------
  var SWITCH_KEYS = [['disabled', 'Site off'], ['noPopups', ''], ['noLargeMedia', ''], ['noRemoteFonts', ''], ['noJS', '']];
  function renderSites() {
    var tbody = document.querySelector('#siteTable tbody');
    tbody.innerHTML = '';
    var ps = settings.perSite || {};
    Object.keys(ps).sort().forEach(function (hostKey) {
      var entry = ps[hostKey];
      var tr = document.createElement('tr');
      var cells = ['disabled', 'noPopups', 'noLargeMedia', 'noRemoteFonts', 'noJS'].map(function (k) {
        return '<td><input type="checkbox" data-k="' + k + '"' + (entry[k] ? ' checked' : '') + '></td>';
      }).join('');
      tr.innerHTML = '<td><b>' + esc(hostKey) + '</b></td>' + cells +
        '<td><button class="small" data-act="del">Delete</button></td>';
      tr.querySelectorAll('input').forEach(function (input) {
        input.addEventListener('change', function () {
          S.getSettings().then(function (s) {
            s.perSite[hostKey][input.getAttribute('data-k')] = input.checked;
            settings = s; return S.saveSettings(s);
          }).then(notifyReload);
        });
      });
      tr.querySelector('button').addEventListener('click', function () {
        S.getSettings().then(function (s) {
          delete s.perSite[hostKey]; settings = s; return S.saveSettings(s);
        }).then(renderSites);
      });
      tbody.appendChild(tr);
    });
  }

  // ---------- diagnostics ----------
  function renderDiag() {
    Promise.all([S.get('diag:background'), S.get('diag:lastPage'), S._rawGet('compiled#meta')]).then(function (r) {
      var bg = r[0], page = r[1], cmeta = (r[2] || {})['compiled#meta'];
      var lines = [];
      if (!bg) {
        lines.push('<b class="bad">Background page: no sign of life.</b> It has never written diagnostics — Orion likely never ran it. Network blocking via webRequest is therefore <b class="bad">off</b>; protection is the content/fallback layers only.');
      } else {
        lines.push('Background started: ' + fmtTime(bg.startedAt));
        lines.push('webRequest listener registered: ' + (bg.listenerRegistered ? '<b class="ok">yes</b>' : '<b class="bad">no</b>'));
        if (bg.listenerError) lines.push('Listener error: <b class="bad">' + esc(bg.listenerError) + '</b>');
        lines.push('Requests seen by listener: <b class="' + (bg.fired > 0 ? 'ok' : 'mid') + '">' + bg.fired + '</b>' +
          (bg.lastFiredAt ? ' (last ' + fmtTime(bg.lastFiredAt) + ')' : ''));
        lines.push('Requests cancelled: <b class="' + (bg.cancelled > 0 ? 'ok' : 'mid') + '">' + bg.cancelled + '</b>' +
          (bg.lastCancelledAt ? ' (last ' + fmtTime(bg.lastCancelledAt) + ')' : ''));
        if (bg.fired > 0 && bg.cancelled === 0) lines.push('<b class="mid">Listener fires but has never cancelled</b> — either no page hit a rule yet, or Orion ignores {cancel:true}. Run the probe below to decide.');
        if (bg.fired === 0) lines.push('<b class="mid">Listener registered but has never fired</b> — browse a few pages, then refresh. If it stays 0, Orion is not delivering webRequest events.');
        lines.push('Compiled lists in background: ' + (bg.listsUsed && bg.listsUsed.length ? esc(bg.listsUsed.join(', ')) : 'none loaded'));
      }
      if (page) {
        lines.push('Last page (' + esc(page.host) + ', ' + fmtTime(page.t) + '): cosmetics ' + page.cosmetics +
          ', scriptlets ' + page.scriptlets + ', fallback domains ' + page.blockDomains +
          ', blocked on page — fallback ' + page.counts.fallback + ', elements ' + page.counts.elements +
          ', YouTube ' + page.counts.ytAds + ', switches ' + page.counts.switchBlocked + '.');
      } else {
        lines.push('No content-script report yet — visit any page with the extension enabled.');
      }
      if (cmeta) lines.push('Compiled set in storage: ' + (cmeta.bytes / 1048576).toFixed(1) + ' MB in ' + cmeta.chunks + ' chunks.');
      $('diagBody').innerHTML = lines.join('<br>');
    });
  }

  // ---------- init ----------
  S.getSettings().then(function (s) {
    settings = s;
    $('globalEnabled').checked = s.enabled;
    $('autoUpdate').checked = s.autoUpdate;
    $('updateHours').value = s.updateIntervalHours;
    $('myFiltersEnabled').checked = s.myFiltersEnabled;
    $('myFilters').value = s.myFilters || '';
    return renderStatus();
  }).then(function () {
    // Fallback auto-update path: if the background never runs on Orion,
    // opening the dashboard is what keeps lists fresh.
    if (settings.autoUpdate && settings.enabled) return runUpdate(false);
  });

  $('globalEnabled').addEventListener('change', function () {
    settings.enabled = $('globalEnabled').checked;
    S.saveSettings(settings).then(notifyReload);
  });
  $('autoUpdate').addEventListener('change', function () {
    settings.autoUpdate = $('autoUpdate').checked;
    S.saveSettings(settings);
  });
  $('updateHours').addEventListener('change', function () {
    settings.updateIntervalHours = Math.max(1, parseInt($('updateHours').value, 10) || 24);
    S.saveSettings(settings);
  });
  $('updateNow').addEventListener('click', function () { runUpdate(true); });
  $('purge').addEventListener('click', function () {
    U.purgeAll().then(function () { $('updateStatus').textContent = 'All list caches purged.'; renderStatus(); });
  });
  $('addCustom').addEventListener('click', function () {
    var name = $('customName').value.trim(), url = $('customUrl').value.trim();
    if (!name || !/^https:\/\//.test(url)) { $('updateStatus').textContent = 'Custom list needs a name and an https:// URL.'; return; }
    var id = 'custom-' + Date.now().toString(36);
    settings.customLists.push({ id: id, name: name, url: url, enabled: true });
    S.saveSettings(settings).then(function () {
      $('updateStatus').textContent = 'Fetching ' + name + '…';
      return U.updateOne({ id: id, name: name, url: url });
    }).then(function () { return U.rebuildCompiled(settings); }).then(function () {
      $('updateStatus').textContent = name + ' added.'; notifyReload(); renderStatus();
    }).catch(function (err) { $('updateStatus').textContent = 'Failed: ' + err.message; });
  });
  $('saveFilters').addEventListener('click', function () {
    settings.myFilters = $('myFilters').value;
    settings.myFiltersEnabled = $('myFiltersEnabled').checked;
    S.saveSettings(settings).then(function () { return U.rebuildCompiled(settings); }).then(function () {
      $('filtersStatus').textContent = 'Saved and recompiled at ' + new Date().toLocaleTimeString() + '.';
      notifyReload(); renderStatus();
    }).catch(function (err) { $('filtersStatus').textContent = 'Failed: ' + err.message; });
  });
  $('logRefresh').addEventListener('click', renderLog);
  $('logFilter').addEventListener('input', renderLog);
  $('logClear').addEventListener('click', function () { S.clearLog().then(renderLog); });
  $('addSite').addEventListener('click', function () {
    var h = $('siteHost').value.trim().toLowerCase();
    if (!h) return;
    settings.perSite = settings.perSite || {};
    if (!settings.perSite[h]) settings.perSite[h] = {};
    S.saveSettings(settings).then(function () { $('siteHost').value = ''; renderSites(); });
  });
  $('diagRefresh').addEventListener('click', renderDiag);
  $('probeBtn').addEventListener('click', function () {
    window.open('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', '_blank');
  });
  $('exportBtn').addEventListener('click', function () {
    var payload = { app: 'ublock-for-orion', version: 1, exportedAt: new Date().toISOString(), settings: settings };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ublock-orion-backup.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    $('backupStatus').textContent = 'Backup exported.';
  });
  $('importFile').addEventListener('change', function () {
    var file = $('importFile').files[0];
    if (!file) return;
    file.text().then(function (text) {
      var data = JSON.parse(text);
      if (!data || data.app !== 'ublock-for-orion' || !data.settings) throw new Error('not a uBlock for Orion backup');
      settings = Object.assign(S.defaultSettings(), data.settings);
      return S.saveSettings(settings);
    }).then(function () { return U.rebuildCompiled(settings); }).then(function () {
      $('backupStatus').textContent = 'Backup imported and lists recompiled. Reload open pages.';
      notifyReload(); renderStatus();
    }).catch(function (err) { $('backupStatus').textContent = 'Import failed: ' + err.message; });
  });
})();
