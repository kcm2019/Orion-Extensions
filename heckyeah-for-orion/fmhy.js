/* HeckYeah for Orion — FMHY overlay (fmhy.net only).
 * Home: Continue Watching (grouped by show) + category tiles.
 * Category pages: shelves scaffolded by the page's own h2/h3 headers.
 * Video-category applet clicks arm the tracker (scope 1, armed-only).
 * Any parse failure leaves the stock site untouched (circuit breaker)
 * and shows only the floating pill. */
(function () {
  'use strict';
  if (window.__hyoFmhy) return;
  window.__hyoFmhy = true;
  var H = window.HYO;
  if (!H) return;

  var FALLBACK_CATS = [
    { path: '/ai', title: 'Artificial Intelligence', desc: 'Explore the world of AI and machine learning.' },
    { path: '/video', title: 'Streaming', desc: 'Stream, download, torrent and binge all your favourite movies and shows!' },
    { path: '/audio', title: 'Listening', desc: 'Stream, download and torrent songs, podcasts and more!' },
    { path: '/gaming', title: 'Gaming', desc: 'Download and play all your favourite games or emulate some old but gold ones!' },
    { path: '/reading', title: 'Reading', desc: "Whether you're a bookworm, otaku or comic book fan, you'll be able to find your favourite pieces of literature here!" },
    { path: '/downloading', title: 'Downloading', desc: 'Download all your favourite software, movies, shows, music, games and more!' },
    { path: '/torrenting', title: 'Torrenting', desc: 'Download your favourite media using the BitTorrent protocol.' },
    { path: '/educational', title: 'Educational', desc: 'Educational content for all ages.' },
    { path: '/mobile', title: 'Android / iOS', desc: 'All forms of content for Android and iOS.' },
    { path: '/linux-macos', title: 'Linux / macOS', desc: 'The $HOME of Linux and macOS.' },
    { path: '/non-english', title: 'Non-English', desc: 'Content in languages other than English.' },
    { path: '/misc', title: 'Miscellaneous', desc: 'Various topics like food, travel, news, shopping, fun sites and more!' }
  ];
  var CAT_PATHS = {};
  FALLBACK_CATS.forEach(function (c) { CAT_PATHS[c.path] = true; });
  CAT_PATHS['/privacy'] = true; // FMHY features this card on Home too

  var path = location.pathname.replace(/\/$/, '') || '/';
  var isHome = path === '/';
  var isCategory = !!CAT_PATHS[path];
  if (!isHome && !isCategory) return;
  var isVideo = path === '/video';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- parsing ---------- */
  function parseHomeCats() {
    var out = [];
    var cards = document.querySelectorAll('a.VPFeature');
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i];
      var t = a.querySelector('.title');
      var d = a.querySelector('.details');
      var p = '';
      try { p = new URL(a.href).pathname.replace(/\/$/, ''); } catch (e) {}
      if (p && t) out.push({ path: p, title: t.textContent.trim(), desc: d ? d.textContent.trim() : '' });
    }
    return out.length >= 6 ? out : FALLBACK_CATS;
  }

  function headingTitle(h) {
    var s = '';
    for (var i = 0; i < h.childNodes.length; i++) {
      var n = h.childNodes[i];
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1 && !n.classList.contains('header-anchor')) s += n.textContent;
    }
    return s.replace(/\u200b/g, '').trim();
  }

  function parseLi(li) {
    var anchors = li.querySelectorAll('a');
    if (!anchors.length) return null;
    var primary = anchors[0];
    var name = primary.textContent.trim();
    if (!name || !/^https?:\/\//i.test(primary.href)) return null;
    var text = (li.textContent || '').replace(/\s+/g, ' ');
    // remove every anchor's text from the description text
    for (var i = 0; i < anchors.length; i++) {
      var at = anchors[i].textContent.trim();
      if (at) text = text.split(at).join(' ');
    }
    var tags = H.cleanTags(text).slice(0, 6);
    return {
      name: name,
      url: primary.href,
      desc: tags.join(' \u00b7 '),
      tags: tags,
      mirrors: anchors.length - 1,
      starred: li.classList.contains('starred')
    };
  }

  /* Walk h2/h3/ul in document order inside .vp-doc. Each h3 (or h2 with no
   * h3 yet) starts a shelf; each ul contributes its entries to it. */
  function parseShelves() {
    var docEl = document.querySelector('.vp-doc');
    if (!docEl) return [];
    var nodes = docEl.querySelectorAll('h2, h3, ul');
    var shelves = [];
    var current = null;
    var section = '';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.tagName === 'H2') {
        section = headingTitle(n);
        current = null;
      } else if (n.tagName === 'H3') {
        current = { title: headingTitle(n), section: section, items: [] };
        shelves.push(current);
      } else if (n.tagName === 'UL') {
        if (n.parentElement && n.parentElement.closest && n.parentElement.closest('li')) continue; // nested list
        if (!current) {
          current = { title: section || 'Links', section: section, items: [] };
          shelves.push(current);
        }
        var lis = n.querySelectorAll(':scope > li');
        for (var j = 0; j < lis.length; j++) {
          var item = parseLi(lis[j]);
          if (item) current.items.push(item);
        }
      }
    }
    return shelves.filter(function (s) { return s.items.length > 0; });
  }

  /* ---------- overlay build ---------- */
  var store = null;

  function tsLine(e) {
    if (e.dur > 0 && e.pos != null) {
      var left = Math.max(0, e.dur - e.pos);
      return H.fmtTime(e.pos) + ' / ' + H.fmtTime(e.dur) + ' \u00b7 ' + H.fmtTime(left) + ' left';
    }
    return 'No position saved yet';
  }
  function pct(e) {
    if (e.dur > 0 && e.pos != null) return Math.min(100, Math.round((e.pos / e.dur) * 100));
    return 0;
  }

  function renderContinue(root) {
    var groups = H.groupByShow(store.entries);
    if (!groups.length) return;
    root.appendChild(el('div', 'hyo-shelf-title', 'Continue Watching'));
    var row = el('div', 'hyo-row');
    groups.forEach(function (g) {
      var latest = g.latest;
      var card = el('div', 'hyo-card');
      card.appendChild(el('div', 'hyo-t', g.showTitle));
      var sub = (latest.epLabel ? latest.epLabel + ' \u00b7 ' : '') + (latest.applet || latest.host) + ' \u00b7 ' + H.relTime(latest.updatedAt);
      card.appendChild(el('div', 'hyo-sub', sub));
      card.appendChild(el('div', 'hyo-ts', tsLine(latest)));
      var bar = el('div', 'hyo-bar');
      var fill = el('i', '');
      fill.style.width = pct(latest) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
      if (latest.nextUrl) card.appendChild(el('span', 'hyo-badge', 'Next episode ready \u203a'));
      var epsBox = el('div', 'hyo-eps');
      epsBox.style.display = 'none';
      card.addEventListener('click', function () {
        if (epsBox.style.display === 'none') { buildEps(epsBox, g); epsBox.style.display = 'block'; }
        else epsBox.style.display = 'none';
      });
      row.appendChild(card);
      // episode list renders in a full-width strip under the row
      card.__epsBox = epsBox;
      card.__group = g;
    });
    root.appendChild(row);
    // attach one eps strip per group, after the row
    groups.forEach(function (g, idx) {
      var card = row.children[idx];
      if (card && card.__epsBox) root.appendChild(card.__epsBox);
    });
    var clear = el('div', 'hyo-clear', 'Clear all');
    clear.addEventListener('click', function (ev) {
      ev.stopPropagation();
      store.entries = [];
      H.saveStore(store).then(rebuild);
    });
    row.appendChild(clear);
  }

  function buildEps(box, g) {
    box.innerHTML = '';
    g.episodes.slice().reverse().forEach(function (e) {
      var rowEl = el('div', 'hyo-ep');
      var a = el('a', '');
      a.href = e.url;
      var t = el('div', 'hyo-t', (e.epLabel ? e.epLabel + ' \u2014 ' : '') + e.title);
      var ts = el('div', 'hyo-ts', tsLine(e) + ' \u00b7 ' + H.relTime(e.updatedAt));
      a.appendChild(t);
      a.appendChild(ts);
      rowEl.appendChild(a);
      if (e.nextUrl) {
        var nx = el('a', '');
        nx.href = e.nextUrl;
        nx.textContent = 'Next \u203a';
        nx.style.flex = '0 0 auto';
        nx.style.color = '#0a84ff';
        nx.style.fontWeight = '600';
        rowEl.appendChild(nx);
      }
      var x = el('button', 'hyo-x', '\u2715');
      x.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        store.entries = store.entries.filter(function (en) { return en.url !== e.url; });
        H.saveStore(store).then(rebuild);
      });
      rowEl.appendChild(x);
      box.appendChild(rowEl);
    });
  }

  function renderCats(root) {
    root.appendChild(el('div', 'hyo-shelf-title', 'Browse'));
    var grid = el('div', 'hyo-grid');
    parseHomeCats().forEach(function (c) {
      var a = el('a', 'hyo-cat');
      a.href = c.path;
      a.setAttribute('data-hyo-cat', c.path);
      a.appendChild(el('div', 'hyo-t', c.title));
      if (c.desc) a.appendChild(el('div', 'hyo-sub', c.desc));
      grid.appendChild(a);
    });
    root.appendChild(grid);
  }

  function renderShelves(root) {
    var shelves = parseShelves();
    if (shelves.length < 1) throw new Error('no shelves parsed');
    var lastSection = null;
    shelves.forEach(function (s) {
      if (s.section && s.section !== lastSection && s.section !== s.title) {
        root.appendChild(el('div', 'hyo-section', s.section));
        lastSection = s.section;
      }
      root.appendChild(el('div', 'hyo-shelf-title', s.title));
      var row = el('div', 'hyo-row');
      var CAP = 20;
      s.items.forEach(function (item, idx) {
        var a = el('a', 'hyo-tile');
        a.href = item.url;
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noreferrer');
        a.setAttribute('data-hyo-applet', item.name);
        if (idx >= CAP) a.style.display = 'none';
        a.appendChild(el('div', 'hyo-t', (item.starred ? '\u2605 ' : '') + item.name));
        if (item.desc) a.appendChild(el('div', 'hyo-d', item.desc));
        row.appendChild(a);
      });
      if (s.items.length > CAP) {
        var hiddenCount = s.items.length - CAP;
        var more = el('div', 'hyo-more', '+' + hiddenCount + ' more');
        more.addEventListener('click', function () {
          var tiles = row.querySelectorAll('.hyo-tile');
          var expanding = more.textContent.indexOf('more') !== -1;
          for (var i = CAP; i < tiles.length; i++) tiles[i].style.display = expanding ? '' : 'none';
          more.textContent = expanding ? 'Show less' : '+' + hiddenCount + ' more';
        });
        row.appendChild(more);
      }
      root.appendChild(row);
    });
  }

  var overlay = null;

  /* Draggable pill: drag moves it (position saved as viewport fractions
   * in the shared store); a tap without drag runs onTap. */
  function makeDraggable(elm, onTap) {
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;
    function applySaved() {
      if (store && store.pillPos) {
        var r = elm.getBoundingClientRect();
        var x = store.pillPos.fx * (innerWidth - r.width);
        var y = store.pillPos.fy * (innerHeight - r.height);
        var c = H.clampPillPos(x, y, r.width, r.height, innerWidth, innerHeight);
        elm.style.left = c.x + 'px';
        elm.style.top = c.y + 'px';
        elm.style.right = 'auto';
        elm.style.bottom = 'auto';
      }
    }
    elm.addEventListener('pointerdown', function (ev) {
      dragging = true; moved = false;
      sx = ev.clientX; sy = ev.clientY;
      var r = elm.getBoundingClientRect();
      ox = r.left; oy = r.top;
      try { elm.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    elm.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
      if (!moved) return;
      var r = elm.getBoundingClientRect();
      var c = H.clampPillPos(ox + dx, oy + dy, r.width, r.height, innerWidth, innerHeight);
      elm.style.left = c.x + 'px';
      elm.style.top = c.y + 'px';
      elm.style.right = 'auto';
      elm.style.bottom = 'auto';
    });
    elm.addEventListener('pointerup', function (ev) {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        var r = elm.getBoundingClientRect();
        H.loadStore().then(function (s) {
          s.pillPos = {
            fx: innerWidth - r.width > 0 ? r.left / (innerWidth - r.width) : 0,
            fy: innerHeight - r.height > 0 ? r.top / (innerHeight - r.height) : 0
          };
          if (store) store.pillPos = s.pillPos;
          return H.saveStore(s);
        });
      } else if (onTap) {
        onTap(ev);
      }
    });
    elm.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); }, true);
    setTimeout(applySaved, 0);
    return elm;
  }

  function showPill() {
    if (document.getElementById('hyo-pill')) return;
    var pill = el('button', '', '\ud83d\udcfa HeckYeah');
    pill.id = 'hyo-pill';
    makeDraggable(pill, function () {
      pill.remove();
      if (overlay) overlay.style.display = '';
      else build();
    });
    document.body.appendChild(pill);
  }

  function build() {
    try {
      var root = el('div', '');
      root.id = 'hyo-overlay';
      var head = el('div', 'hyo-head');
      var brand = el('div', 'hyo-brand');
      brand.innerHTML = 'Heck<span>Yeah</span>';
      head.appendChild(brand);
      var web = el('button', 'hyo-webbtn', '\ud83c\udf10 Web');
      web.addEventListener('click', function () {
        root.style.display = 'none';
        showPill();
      });
      head.appendChild(web);
      if (H.Remote) {
        var pairBtn = el('button', 'hyo-webbtn', '\ud83d\udcf1 Remote');
        pairBtn.addEventListener('click', function () { H.Remote.startHostPanel(); });
        head.appendChild(pairBtn);
      }
      var apBtn = el('button', 'hyo-webbtn', '');
      function paintAp() {
        var on = store.airplayForce !== false;
        apBtn.textContent = '\ud83d\udce1 AirPlay: ' + (on ? 'Forced' : 'Off');
        apBtn.style.color = on ? '#0a84ff' : '';
        apBtn.style.fontWeight = on ? '700' : '';
      }
      paintAp();
      apBtn.addEventListener('click', function () {
        store.airplayForce = store.airplayForce === false;
        H.saveStore(store);
        paintAp();
      });
      head.appendChild(apBtn);
      root.appendChild(head);

      if (isHome) {
        renderContinue(root);
        renderCats(root);
      } else {
        renderShelves(root);
      }

      var diag = el('div', 'hyo-diag',
        'HeckYeah for Orion 0.9.0 \u00b7 storage: ' + store.storageMode +
        ' \u00b7 visits ' + store.visits +
        ' \u00b7 tracked ' + store.entries.length +
        ' \u00b7 sweep removals ' + (store.sweepCount || 0));
      root.appendChild(diag);

      document.body.appendChild(root);
      overlay = root;
    } catch (e) {
      // circuit breaker: stock site stays fully usable
      if (overlay) { overlay.remove(); overlay = null; }
      showPill();
    }
  }

  function rebuild() {
    if (overlay) { overlay.remove(); overlay = null; }
    build();
  }

  /* ---------- arming (video category only) ---------- */
  if (isVideo) {
    var armHandler = function (ev) {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[data-hyo-applet]') : null;
      if (!a) return;
      var host = H.hostOf(a.href);
      if (!host) return;
      // re-read then write, so we never clobber tracker updates
      H.loadStore().then(function (s) {
        s.armed[host] = { applet: a.getAttribute('data-hyo-applet') || host, ts: Date.now() };
        return H.saveStore(s);
      });
    };
    // pointerdown fires before the new tab/page starts loading, so the
    // arm write lands before the tracker's first store read over there
    document.addEventListener('pointerdown', armHandler, true);
    document.addEventListener('click', armHandler, true);
  }

  /* ---------- category navigation ----------
   * fmhy.net is a VitePress SPA: its router puts a click handler on the
   * window that hijacks EVERY same-origin link click in the document —
   * including our overlay tiles — preventDefault()s it and swaps the
   * page content underneath our overlay, so the tap looked dead.
   * A capture-phase delegated handler runs long before that bubble-phase
   * router handler: stop it, then do a real full navigation so the
   * content script rebuilds the overlay for the category. */
  if (isHome) {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[data-hyo-cat]') : null;
      if (!a) return;
      ev.preventDefault();
      ev.stopPropagation();
      location.href = a.href;
    }, true);
  }

  /* ---------- boot ----------
   * If this page load carries a pairing fragment (the phone scanned
   * the QR), it becomes the phone remote instead of the app view. */
  if (H.Remote && H.Remote.isRemoteHash()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { H.Remote.guestBoot(); });
    } else {
      H.Remote.guestBoot();
    }
    return;
  }
  /* The app interface IS the default screen on fmhy.net: the overlay
   * opens on its own with Continue Watching (recently played +
   * resume) at the top of Home, like the Fire TV app. The pill only
   * appears after 🌐 Web or a parse failure, and reopens it. */
  H.loadStore().then(function (s) {
    store = s;
    store.visits = (store.visits || 0) + 1;
    return H.saveStore(store);
  }).then(function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
  });
})();
