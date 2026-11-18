/* manager.js — E (manager page) + H (export/import). */
(function () {
  'use strict';
  var STORE_KEY = 'eb_store_v1';
  var store = EBRules.emptyStore();

  function load() {
    return browser.storage.local.get(STORE_KEY).then(function (o) {
      store = EBRules.normalizeStore(o && o[STORE_KEY]);
      render();
    });
  }
  function save() {
    return browser.storage.local.set({ eb_store_v1: store });
  }
  function msg(t) { document.getElementById('msg').textContent = t || ''; }

  function fpSummary(fp) {
    if (!fp) return '';
    var bits = [fp.tag || ''];
    if (fp.id) bits.push('#' + fp.id);
    if (fp.text) bits.push('“' + fp.text.slice(0, 42) + '”');
    if (fp.pos && fp.pos !== 'static') bits.push(fp.pos);
    return bits.join(' · ');
  }

  function render() {
    var list = document.getElementById('list');
    list.innerHTML = '';
    var hosts = Object.keys(store.hosts).sort();
    var total = EBRules.countRules(store);
    var hits = 0;
    hosts.forEach(function (h) { store.hosts[h].forEach(function (r) { hits += r.hits || 0; }); });
    document.getElementById('summary').textContent =
      total + ' rule' + (total === 1 ? '' : 's') + ' on ' + hosts.length +
      ' site' + (hosts.length === 1 ? '' : 's') + ' · ' + hits + ' total hides';
    document.getElementById('empty').classList.toggle('hidden', total > 0);

    hosts.forEach(function (host) {
      var sec = document.createElement('section');
      sec.className = 'site';
      var h2 = document.createElement('h2');
      var name = document.createElement('span'); name.textContent = host;
      var delSite = document.createElement('button');
      delSite.className = 'ghost'; delSite.textContent = 'Delete site';
      delSite.addEventListener('click', function () {
        if (!confirm('Delete all ' + store.hosts[host].length + ' rules for ' + host + '?')) return;
        delete store.hosts[host]; save().then(render); msg('Deleted rules for ' + host);
      });
      h2.appendChild(name); h2.appendChild(delSite);
      sec.appendChild(h2);

      store.hosts[host].forEach(function (rule) {
        var div = document.createElement('div');
        div.className = 'rule';
        var code = document.createElement('code'); code.textContent = rule.selector;
        var meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = fpSummary(rule.fingerprint) + ' · hidden ' + (rule.hits || 0) +
          '× · added ' + (rule.created ? new Date(rule.created).toLocaleDateString() : '—') +
          ((rule.extraSelectors && rule.extraSelectors.length) ? ' · +' + rule.extraSelectors.length + ' collapsed wrapper(s)' : '');
        var input = document.createElement('input');
        input.type = 'text'; input.value = rule.selector; input.className = 'hidden';
        input.setAttribute('aria-label', 'Edit selector');
        var row = document.createElement('div'); row.className = 'row';
        var editBtn = document.createElement('button'); editBtn.className = 'ghost'; editBtn.textContent = 'Edit selector';
        var delBtn = document.createElement('button'); delBtn.className = 'ghost'; delBtn.textContent = 'Delete';
        editBtn.addEventListener('click', function () {
          var editing = input.classList.contains('hidden');
          input.classList.toggle('hidden', !editing);
          code.classList.toggle('hidden', editing);
          editBtn.textContent = editing ? 'Save selector' : 'Edit selector';
          if (!editing) {
            var v = input.value.trim();
            if (v && v !== rule.selector) {
              try { document.querySelector(v); rule.selector = v; save().then(render); msg('Selector updated for ' + host); }
              catch (e) { msg('That selector is invalid — not saved.'); input.value = rule.selector; }
            }
          }
        });
        delBtn.addEventListener('click', function () {
          store = EBRules.removeRule(store, host, rule.id);
          save().then(render); msg('Rule deleted.');
        });
        row.appendChild(editBtn); row.appendChild(delBtn);
        div.appendChild(code); div.appendChild(input); div.appendChild(meta); div.appendChild(row);
        sec.appendChild(div);
      });
      list.appendChild(sec);
    });
  }

  document.getElementById('exportBtn').addEventListener('click', function () {
    var payload = { app: 'element-blocker-orion', version: 1, exportedAt: new Date().toISOString(), hosts: store.hosts };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'element-blocker-backup.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    msg('Backup downloaded (' + EBRules.countRules(store) + ' rules).');
  });

  document.getElementById('importFile').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = EBRules.validateImport(String(reader.result || ''));
      if (!res.ok) { msg('Import failed: ' + res.error); return; }
      var before = EBRules.countRules(store);
      store = EBRules.mergeStores(store, res.store);
      var after = EBRules.countRules(store);
      save().then(render);
      msg('Imported ' + (after - before) + ' new rule(s) (' + (res.count - (after - before)) + ' duplicates skipped).');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('clearBtn').addEventListener('click', function () {
    if (!confirm('Delete ALL rules on all sites? Export a backup first if unsure.')) return;
    store = EBRules.emptyStore();
    save().then(render); msg('All rules deleted.');
  });

  function loadDebug() {
    browser.storage.local.get('eb_debug_v1').then(function (o) {
      var d = o && o.eb_debug_v1;
      var ta = document.getElementById('debugText');
      var meta = document.getElementById('debugMeta');
      if (!d || !d.text) { ta.value = ''; return; }
      meta.textContent = 'From ' + (d.host || '?') + ' · ' + new Date(d.ts).toLocaleString() + ' · ' + (d.url || '');
      ta.value = d.text;
    }).catch(function () {
      try {
        var raw = localStorage.getItem('eb_debug_v1');
        if (raw) document.getElementById('debugText').value = JSON.parse(raw).text || '';
      } catch (e) {}
    });
  }
  document.getElementById('debugCopy').addEventListener('click', function () {
    var ta = document.getElementById('debugText');
    if (!ta.value) { msg('No debug log to copy yet.'); return; }
    function done(ok) { msg(ok ? 'Debug log copied — paste it to Muse.' : 'Copy failed — long-press the text to copy it manually.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { ta.select(); done(false); });
    } else { ta.select(); try { done(document.execCommand('copy')); } catch (e) { done(false); } }
  });

  load().catch(function (err) { msg('Could not load rules: ' + err.message); });
  loadDebug();
})();
