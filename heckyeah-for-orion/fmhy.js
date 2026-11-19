/* HeckYeah for Orion — FMHY overlay (fmhy.net only).
 * Home: Continue Watching (grouped by show) + the Streaming
 * shelves only (fetched from /video) — no other categories.
 * Category pages: shelves scaffolded by the page's own h2/h3 headers.
 * Shelf tiles carry a favorite toggle (favorites sort first) and
 * up/down reorder buttons; both persist in the shared store.
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
   * h3 yet) starts a shelf; each ul contributes its entries to it.
   * `container` lets Home parse a fetched /video document the same way. */
  function parseShelves(container) {
    var docEl = container || document.querySelector('.vp-doc');
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

  /* Home is streaming-only now: the /video shelves, fetched and
   * parsed with the same walker the category pages use. */
  function renderHomeVideo(root) {
    var holder = el('div', '');
    holder.appendChild(el('div', 'hyo-diag', 'Loading streaming sites\u2026'));
    root.appendChild(holder);
    fetch('/video')
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var vp = doc.querySelector('.vp-doc');
        var shelves = vp ? parseShelves(vp) : [];
        holder.innerHTML = '';
        if (!shelves.length) {
          holder.appendChild(el('div', 'hyo-diag', 'Could not load the streaming shelves \u2014 tap \ud83c\udf10 Web to browse fmhy.net directly.'));
          return;
        }
        renderShelves(holder, shelves);
      })
      .catch(function () {
        holder.innerHTML = '';
        holder.appendChild(el('div', 'hyo-diag', 'Could not load the streaming shelves \u2014 tap \ud83c\udf10 Web to browse fmhy.net directly.'));
      });
  }

  function renderShelves(root, shelvesArg) {
    var shelves = shelvesArg || parseShelves();
    if (shelves.length < 1) throw new Error('no shelves parsed');
    if (!store.favorites) store.favorites = {};
    if (!store.siteOrder) store.siteOrder = {};
    var lastSection = null;
    shelves.forEach(function (s) {
      if (s.section && s.section !== lastSection && s.section !== s.title) {
        root.appendChild(el('div', 'hyo-section', s.section));
        lastSection = s.section;
      }
      root.appendChild(el('div', 'hyo-shelf-title', s.title));
      var row = el('div', 'hyo-row');
      var CAP = 20;
      var key = H.shelfKey(s);
      var items = H.sortSites(s.items, key, store);
      items.forEach(function (item, idx) {
        var tile = el('div', 'hyo-tile');
        tile.setAttribute('data-hyo-applet', item.name);
        tile.setAttribute('data-hyo-url', item.url);
        if (idx >= CAP) tile.style.display = 'none';
        var isFav = !!store.favorites[item.url];
        tile.appendChild(el('div', 'hyo-t', (item.starred ? '\u2605 ' : '') + item.name));
        if (item.desc) tile.appendChild(el('div', 'hyo-d', item.desc));
        var fav = el('button', 'hyo-fav' + (isFav ? ' on' : ''), isFav ? '\u2605' : '\u2606');
        fav.setAttribute('aria-label', 'Favorite');
        fav.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
        fav.addEventListener('click', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          if (store.favorites[item.url]) delete store.favorites[item.url];
          else store.favorites[item.url] = true;
          H.saveStore(store).then(rebuild);
        });
        tile.appendChild(fav);
        tile.addEventListener('click', function () {
          if (tile.__hyoSuppress) { tile.__hyoSuppress = false; return; }
          window.open(item.url, '_blank');
        });
        attachTileDrag(tile, row, key);
        row.appendChild(tile);
      });
      if (items.length > CAP) {
        var hiddenCount = items.length - CAP;
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

  /* ---------- drag-to-reorder (replaces the up/down buttons) ----------
   * Long-press a tile (~260 ms, finger still) to pick it up; drag
   * sideways and the other tiles slide out of the way (FLIP-style
   * transforms, DOM order untouched until the drop). On drop the new
   * order is written to store.siteOrder[key] and the DOM is settled
   * in place — no rebuild, no scroll jump. A quick tap still opens
   * the site; a swipe still scrolls the row (movement before the
   * long-press fires cancels the pickup). While dragging, a
   * non-passive touchmove preventer stops the row/page scrolling. */
  function attachTileDrag(tile, row, key) {
    var timer = 0, pending = false, dragging = false;
    var sx = 0, sy = 0, pid = null;
    var tiles = [], homes = [], pitch = 208, startIdx = 0, targetIdx = 0;

    function blockScroll(ev) { ev.preventDefault(); }
    function endListeners() {
      document.removeEventListener('touchmove', blockScroll, { passive: false });
    }
    function clearTransforms() {
      tiles.forEach(function (t) { t.style.transform = ''; t.style.transition = ''; });
      tile.style.zIndex = '';
      tile.classList.remove('hyo-drag');
    }
    function activate(ev) {
      pending = false; dragging = true;
      tiles = [];
      var all = row.querySelectorAll('.hyo-tile');
      for (var i = 0; i < all.length; i++) if (all[i].style.display !== 'none') tiles.push(all[i]);
      startIdx = tiles.indexOf(tile);
      if (startIdx < 0 || tiles.length < 2) { dragging = false; return; }
      homes = tiles.map(function (t) { return t.offsetLeft; });
      pitch = tiles.length > 1 ? (homes[1] - homes[0]) : 208;
      if (!pitch || pitch < 10) pitch = 208;
      targetIdx = startIdx;
      tile.classList.add('hyo-drag');
      tile.style.transition = 'none';
      tile.style.zIndex = '60';
      try { tile.setPointerCapture(pid); } catch (e) {}
      document.addEventListener('touchmove', blockScroll, { passive: false });
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    }
    function onMove(ev) {
      if (pending) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 10) {
          pending = false; clearTimeout(timer);
        }
        return;
      }
      if (!dragging) return;
      ev.preventDefault();
      var dx = ev.clientX - sx;
      var min = homes[0] - homes[startIdx], max = homes[homes.length - 1] - homes[startIdx];
      if (dx < min) dx = min; if (dx > max) dx = max;
      tile.style.transform = 'translateX(' + dx + 'px)';
      var t = startIdx + Math.round(dx / pitch);
      if (t < 0) t = 0; if (t > tiles.length - 1) t = tiles.length - 1;
      if (t !== targetIdx) {
        targetIdx = t;
        tiles.forEach(function (tl, i) {
          if (tl === tile) return;
          var shift = 0;
          if (startIdx < targetIdx && i > startIdx && i <= targetIdx) shift = -pitch;
          else if (targetIdx < startIdx && i >= targetIdx && i < startIdx) shift = pitch;
          tl.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
        });
      }
    }
    function onUp(commit) {
      if (pending) { pending = false; clearTimeout(timer); return; }
      if (!dragging) return;
      dragging = false;
      endListeners();
      if (commit && targetIdx !== startIdx) {
        tile.__hyoSuppress = true;
        setTimeout(function () { tile.__hyoSuppress = false; }, 120);
        var order = tiles.slice();
        order.splice(startIdx, 1);
        order.splice(targetIdx, 0, tile);
        var anchor = null;
        var all = row.querySelectorAll('.hyo-tile');
        for (var i = 0; i < all.length; i++) if (all[i].style.display === 'none') { anchor = all[i]; break; }
        if (!anchor) anchor = row.querySelector('.hyo-more');
        order.forEach(function (t) { row.insertBefore(t, anchor); });
        var urls = order.map(function (t) { return t.getAttribute('data-hyo-url'); });
        for (var j = 0; j < all.length; j++) {
          if (all[j].style.display === 'none') urls.push(all[j].getAttribute('data-hyo-url'));
        }
        if (!store.siteOrder) store.siteOrder = {};
        store.siteOrder[key] = urls;
        H.saveStore(store);
      } else if (commit) {
        tile.__hyoSuppress = true;
        setTimeout(function () { tile.__hyoSuppress = false; }, 120);
      }
      clearTransforms();
    }
    tile.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      pending = true; sx = ev.clientX; sy = ev.clientY; pid = ev.pointerId;
      clearTimeout(timer);
      timer = setTimeout(function () { if (pending) activate(ev); }, 260);
    });
    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', function () { onUp(true); });
    tile.addEventListener('pointercancel', function () { onUp(false); });
    tile.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  }

  /* ---------- update checker (v0.11.0) ----------
   * Banner + footer live on Home only. Auto check is throttled
   * (12 h) inside update-check.js; the banner shows only a found,
   * undismissed update. Download opens the .xpi link — installing
   * stays a manual Install-from-File step in Orion. */
  var U = window.HYOUpdate || null;
  var updBanner = null, updStatus = null, updAvail = null;

  function paintUpdBanner() {
    if (!updBanner) return;
    if (updAvail) {
      updBanner.style.display = '';
      var t = updBanner.querySelector('.hyo-upd-text');
      if (t) t.textContent = 'Update available: v' + updAvail.version;
    } else {
      updBanner.style.display = 'none';
    }
  }
  function refreshUpdFromStore() {
    if (!U) return;
    try {
      U.getState().then(function (st) {
        updAvail = (st.available && st.available.version !== st.dismissed) ? st.available : null;
        paintUpdBanner();
      }, function () {});
    } catch (e) {}
  }
  function runUpdCheck(force) {
    if (!U) {
      if (updStatus) updStatus.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
      return;
    }
    if (updStatus && force) updStatus.textContent = 'Checking\u2026';
    try {
      U.checkNow(force).then(function (res) {
        if (updStatus) {
          if (res.state === 'update') updStatus.textContent = 'Update available: v' + res.version;
          else if (res.state === 'current') updStatus.textContent = 'You\u2019re on the latest version (v' + U.currentVersion() + ')';
          else updStatus.textContent = 'Couldn\u2019t check for updates (' + (res.error || 'feed unreachable') + ')';
        }
        refreshUpdFromStore();
      }, function () {
        if (updStatus) updStatus.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
      });
    } catch (e) {
      if (updStatus) updStatus.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
    }
  }
  function buildUpdBanner() {
    var b = el('div', 'hyo-upd');
    b.style.display = 'none';
    b.appendChild(el('span', 'hyo-upd-text', ''));
    var dl = el('button', 'hyo-upd-dl', 'Download');
    dl.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (updAvail && U) U.openUpdate(updAvail.update_link);
    });
    b.appendChild(dl);
    var x = el('button', 'hyo-upd-x', '\u2715');
    x.setAttribute('aria-label', 'Dismiss update notice');
    x.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (updAvail && U) { try { U.dismiss(updAvail.version); } catch (e) {} }
      updAvail = null;
      paintUpdBanner();
    });
    b.appendChild(x);
    updBanner = b;
    return b;
  }
  function buildUpdFoot() {
    var f = el('div', 'hyo-upd-foot');
    var btn = el('button', 'hyo-upd-check', 'Check for updates');
    btn.addEventListener('click', function () { runUpdCheck(true); });
    f.appendChild(btn);
    updStatus = el('span', 'hyo-upd-status', '');
    f.appendChild(updStatus);
    return f;
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
      root.appendChild(head);

      updBanner = null; updStatus = null;
      if (isHome && U) root.appendChild(buildUpdBanner());

      if (isHome) {
        renderContinue(root);
        renderHomeVideo(root);
      } else {
        renderShelves(root);
      }

      var diag = el('div', 'hyo-diag',
        'HeckYeah for Orion 0.12.5 \u00b7 storage: ' + store.storageMode +
        ' \u00b7 visits ' + store.visits +
        ' \u00b7 tracked ' + store.entries.length +
        ' \u00b7 sweep removals ' + (store.sweepCount || 0));
      root.appendChild(diag);

      if (isHome && U) root.appendChild(buildUpdFoot());

      document.body.appendChild(root);
      overlay = root;
      if (isHome && U) { refreshUpdFromStore(); runUpdCheck(false); }
    } catch (e) {
      // circuit breaker: stock site stays fully usable
      if (overlay) { overlay.remove(); overlay = null; }
      showPill();
    }
  }

  function rebuild() {
    var st = overlay ? overlay.scrollTop : 0;
    if (overlay) { overlay.remove(); overlay = null; }
    build();
    if (overlay && st) overlay.scrollTop = st;
  }

  /* ---------- arming (streaming shelves: /video page + Home) ---------- */
  if (isVideo || isHome) {
    var armHandler = function (ev) {
      var t = ev.target;
      var a = t && t.closest ? t.closest('[data-hyo-applet]') : null;
      if (!a) return;
      var host = H.hostOf(a.getAttribute('data-hyo-url') || a.href || '');
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
