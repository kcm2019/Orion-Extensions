/* HeckYeah popup — the whole app in the toolbar popup: Continue
 * Watching + the Streaming shelves only (parsed live from
 * fmhy.net/video), mirroring the app view. Tapping a site opens it
 * in a tab, armed for tracking exactly like a tap in the app view.
 * Long-press a tile to drag-reorder it; the star toggles a
 * favorite. Both persist in the shared store. */
'use strict';
var H = window.HYO;
var store = null;
var viewEl = document.getElementById('view');
var headsub = document.getElementById('headsub');

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function openTab(url) {
  try {
    if (window.browser && browser.tabs) browser.tabs.create({ url: url });
    else if (window.chrome && chrome.tabs) chrome.tabs.create({ url: url });
  } catch (e) {}
  window.close();
}
function launch(url, appletName) {
  try {
    var host = new URL(url).hostname;
    if (host && appletName) {
      store.armed[host] = { applet: appletName, ts: Date.now() };
      H.saveStore(store);
    }
  } catch (e) {}
  openTab(url);
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

/* ---------- home ---------- */
function renderHome() {
  headsub.textContent = 'Free media, everywhere';
  viewEl.innerHTML = '';
  var entries = (store.entries || []).filter(function (e) { return !H.isFinished(e); });
  if (entries.length) {
    viewEl.appendChild(el('div', 'sect', 'CONTINUE WATCHING'));
    var groups = H.groupByShow(entries);
    groups.forEach(function (g) {
      var e = g.latest;
      var card = el('button', 'cont');
      var name = el('div', 'cname', g.showTitle || e.title || 'Untitled');
      if (g.episodes.length > 1) {
        var chip = el('span', 'chip', g.episodes.length + ' episodes');
        name.appendChild(chip);
      }
      card.appendChild(name);
      var meta = [];
      if (e.epLabel) meta.push(e.epLabel);
      else if (e.season && e.episode) meta.push('S' + e.season + ' E' + e.episode);
      if (e.dur) meta.push(H.fmtTime(e.pos || 0) + ' / ' + H.fmtTime(e.dur) + ' \u00b7 ' + H.fmtTime(Math.max(0, e.dur - (e.pos || 0))) + ' left');
      if (e.applet) meta.push(e.applet);
      card.appendChild(el('div', 'cmeta', meta.join(' \u00b7 ')));
      if (e.dur) {
        var bar = el('div', 'cbar');
        var fill = el('div', 'cfill');
        fill.style.width = Math.min(100, Math.round(100 * (e.pos || 0) / e.dur)) + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
      }
      card.addEventListener('click', function () { openTab(e.url); });
      viewEl.appendChild(card);
    });
  }
  var holder = el('div', '');
  holder.appendChild(el('div', 'loading', 'Loading streaming sites…'));
  viewEl.appendChild(holder);
  fetch('https://fmhy.net/video')
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var sections = parseCategory(html);
      holder.innerHTML = '';
      if (!sections.length) {
        holder.appendChild(el('div', 'empty', 'Could not read the streaming page. Use Open full app below.'));
        return;
      }
      renderPopShelves(holder, sections);
    })
    .catch(function () {
      holder.innerHTML = '';
      holder.appendChild(el('div', 'empty', 'Could not load streaming sites \u2014 check your connection, or use Open full app below.'));
    });
}

/* ---------- streaming shelves ---------- */
function renderPopShelves(holder, sections) {
  if (!store.favorites) store.favorites = {};
  if (!store.siteOrder) store.siteOrder = {};
  sections.forEach(function (s) {
    holder.appendChild(el('div', 'sect', s.title.toUpperCase()));
    var list = el('div', 'tiles');
    var key = H.shelfKey(s);
    H.sortSites(s.items, key, store).slice(0, 60).forEach(function (it) {
      var b = el('div', 'tile');
      b.setAttribute('data-hyo-url', it.url);
      b.appendChild(el('div', 'tname', it.name));
      b.appendChild(el('div', 'thost', hostOf(it.url)));
      var isFav = !!store.favorites[it.url];
      var fav = el('button', 'pfav' + (isFav ? ' on' : ''), isFav ? '\u2605' : '\u2606');
      fav.setAttribute('aria-label', 'Favorite');
      fav.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      fav.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (store.favorites[it.url]) delete store.favorites[it.url];
        else store.favorites[it.url] = true;
        H.saveStore(store).then(renderHome);
      });
      b.appendChild(fav);
      b.addEventListener('click', function () {
        if (b.__hyoSuppress) { b.__hyoSuppress = false; return; }
        launch(it.url, it.name);
      });
      attachPopDrag(b, list, key);
      list.appendChild(b);
    });
    holder.appendChild(list);
  });
}

/* Long-press drag-reorder for the popup's vertical lists — same
 * pattern as the app view: siblings slide out of the way via
 * transforms, the drop settles the DOM and saves the order. */
function attachPopDrag(tile, list, key) {
  var timer = 0, pending = false, dragging = false;
  var sy = 0, pid = null;
  var tiles = [], homes = [], pitch = 56, startIdx = 0, targetIdx = 0;
  function blockScroll(ev) { ev.preventDefault(); }
  function clearTransforms() {
    tiles.forEach(function (t) { t.style.transform = ''; t.style.transition = ''; });
    tile.style.zIndex = '';
    tile.classList.remove('hyo-drag');
  }
  function activate() {
    pending = false; dragging = true;
    tiles = Array.prototype.slice.call(list.querySelectorAll('.tile'));
    startIdx = tiles.indexOf(tile);
    if (startIdx < 0 || tiles.length < 2) { dragging = false; return; }
    homes = tiles.map(function (t) { return t.offsetTop; });
    pitch = tiles.length > 1 ? (homes[1] - homes[0]) : 56;
    if (!pitch || pitch < 10) pitch = 56;
    targetIdx = startIdx;
    tile.classList.add('hyo-drag');
    tile.style.transition = 'none';
    tile.style.zIndex = '60';
    try { tile.setPointerCapture(pid); } catch (e) {}
    document.addEventListener('touchmove', blockScroll, { passive: false });
  }
  tile.addEventListener('pointerdown', function (ev) {
    if (ev.button != null && ev.button !== 0) return;
    pending = true; sy = ev.clientY; pid = ev.pointerId;
    clearTimeout(timer);
    timer = setTimeout(function () { if (pending) activate(); }, 260);
  });
  tile.addEventListener('pointermove', function (ev) {
    if (pending) {
      if (Math.abs(ev.clientY - sy) > 10) { pending = false; clearTimeout(timer); }
      return;
    }
    if (!dragging) return;
    ev.preventDefault();
    var dy = ev.clientY - sy;
    var min = homes[0] - homes[startIdx], max = homes[homes.length - 1] - homes[startIdx];
    if (dy < min) dy = min; if (dy > max) dy = max;
    tile.style.transform = 'translateY(' + dy + 'px)';
    var t = startIdx + Math.round(dy / pitch);
    if (t < 0) t = 0; if (t > tiles.length - 1) t = tiles.length - 1;
    if (t !== targetIdx) {
      targetIdx = t;
      tiles.forEach(function (tl, i) {
        if (tl === tile) return;
        var shift = 0;
        if (startIdx < targetIdx && i > startIdx && i <= targetIdx) shift = -pitch;
        else if (targetIdx < startIdx && i >= targetIdx && i < startIdx) shift = pitch;
        tl.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    }
  });
  function onUp(commit) {
    if (pending) { pending = false; clearTimeout(timer); return; }
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('touchmove', blockScroll, { passive: false });
    if (commit) {
      tile.__hyoSuppress = true;
      setTimeout(function () { tile.__hyoSuppress = false; }, 120);
      if (targetIdx !== startIdx) {
        var order = tiles.slice();
        order.splice(startIdx, 1);
        order.splice(targetIdx, 0, tile);
        order.forEach(function (t) { list.appendChild(t); });
        if (!store.siteOrder) store.siteOrder = {};
        store.siteOrder[key] = order.map(function (t) { return t.getAttribute('data-hyo-url'); });
        H.saveStore(store);
      }
    }
    clearTransforms();
  }
  tile.addEventListener('pointerup', function () { onUp(true); });
  tile.addEventListener('pointercancel', function () { onUp(false); });
  tile.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
}
function cleanHeader(node) {
  var s = '';
  for (var i = 0; i < node.childNodes.length; i++) {
    var n = node.childNodes[i];
    if (n.nodeType === 1 && n.classList && n.classList.contains('header-anchor')) continue;
    s += n.textContent;
  }
  return s.replace(/[\u200b#\s]+$/, '').trim();
}
function parseCategory(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var vp = doc.querySelector('.vp-doc') || doc.body;
  var sections = [];
  var section = '';
  var cur = null;
  var nodes = vp.querySelectorAll('h2, h3, ul');
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.tagName === 'H2') {
      section = cleanHeader(node);
      cur = null;
    } else if (node.tagName === 'H3') {
      var t = cleanHeader(node);
      if (t) { cur = { title: t, section: section, items: [] }; sections.push(cur); }
    } else if (node.tagName === 'UL') {
      if (!cur) { cur = { title: section || 'Sites', section: section, items: [] }; sections.push(cur); }
      var lis = node.querySelectorAll(':scope > li');
      for (var j = 0; j < lis.length; j++) {
        var a = lis[j].querySelector('a');
        if (!a) continue;
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#') continue;
        var name = a.textContent.trim();
        if (!name) continue;
        cur.items.push({ name: name, url: new URL(href, 'https://fmhy.net').href });
      }
    }
  }
  return sections.filter(function (s) { return s.items.length; });
}

/* ---------- chrome ---------- */
document.getElementById('openapp').addEventListener('click', function () {
  openTab('https://fmhy.net/');
});

/* ---------- update checker (v0.11.0) ---------- */
var U = window.HYOUpdate || null;
var updBannerEl = document.getElementById('updbanner');
var updTextEl = document.getElementById('updtext');
var updStatusEl = document.getElementById('updstatus');
var updAvail = null;
function paintUpdBanner() {
  if (!updBannerEl) return;
  if (updAvail) {
    updBannerEl.style.display = '';
    if (updTextEl) updTextEl.textContent = 'Update available: v' + updAvail.version;
  } else {
    updBannerEl.style.display = 'none';
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
    if (updStatusEl) updStatusEl.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
    return;
  }
  if (updStatusEl && force) updStatusEl.textContent = 'Checking\u2026';
  try {
    U.checkNow(force).then(function (res) {
      if (updStatusEl) {
        if (res.state === 'update') updStatusEl.textContent = 'Update available: v' + res.version;
        else if (res.state === 'current') updStatusEl.textContent = 'You\u2019re on the latest version (v' + U.currentVersion() + ')';
        else updStatusEl.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
      }
      refreshUpdFromStore();
    }, function () {
      if (updStatusEl) updStatusEl.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
    });
  } catch (e) {
    if (updStatusEl) updStatusEl.textContent = 'Couldn\u2019t check for updates (feed unreachable)';
  }
}
document.getElementById('upddl').addEventListener('click', function () {
  if (updAvail && U) U.openUpdate(updAvail.update_link);
});
document.getElementById('updx').addEventListener('click', function () {
  if (updAvail && U) { try { U.dismiss(updAvail.version); } catch (e) {} }
  updAvail = null;
  paintUpdBanner();
});
document.getElementById('updcheck').addEventListener('click', function () { runUpdCheck(true); });

/* Boot — instrumented: if anything stalls or throws, the popup
 * shows where it stopped instead of hanging on "Loading…". */
var bootSteps = ['popup script loaded'];
var bootDone = false;
setTimeout(function () {
  if (bootDone) return;
  viewEl.innerHTML = '';
  viewEl.appendChild(el('div', 'empty', 'Still loading — boot log:'));
  bootSteps.forEach(function (s) { viewEl.appendChild(el('div', 'empty', '· ' + s)); });
}, 2500);
function bootFail(msg) {
  bootDone = true;
  viewEl.innerHTML = '';
  viewEl.appendChild(el('div', 'empty', msg));
  bootSteps.forEach(function (s) { viewEl.appendChild(el('div', 'empty', '· ' + s)); });
}
H.loadStore().then(function (s) {
  bootSteps.push('store loaded (' + (s && s.storageMode) + ')');
  store = s;
  try {
    renderHome();
    bootDone = true;
  } catch (e) {
    bootFail('Render error: ' + ((e && e.message) || e));
  }
  if (U) { refreshUpdFromStore(); runUpdCheck(false); }
}, function (err) {
  bootFail('Store failed to load: ' + ((err && err.message) || err));
});
