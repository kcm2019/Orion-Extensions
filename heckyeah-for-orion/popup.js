/* HeckYeah popup — the whole app in the toolbar popup: Continue
 * Watching + the 12 FMHY categories, shelves parsed live from
 * fmhy.net. Browsing stays in the popup; tapping a site opens it in
 * a tab, armed for tracking exactly like a tap in the app view. */
'use strict';
var H = window.HYO;
var store = null;
var viewEl = document.getElementById('view');
var backBtn = document.getElementById('back');
var headsub = document.getElementById('headsub');
var currentCat = null;

var SEED_CATS = [
  { name: 'AI', path: '/ai' },
  { name: 'Streaming', path: '/video' },
  { name: 'Listening', path: '/audio' },
  { name: 'Gaming', path: '/gaming' },
  { name: 'Reading', path: '/reading' },
  { name: 'Downloading', path: '/downloading' },
  { name: 'Torrenting', path: '/torrenting' },
  { name: 'Educational', path: '/educational' },
  { name: 'Android / iOS', path: '/android-ios' },
  { name: 'Linux / macOS', path: '/linux-macos' },
  { name: 'Non-English', path: '/non-english' },
  { name: 'Miscellaneous', path: '/miscellaneous' }
];

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
  currentCat = null;
  backBtn.style.display = 'none';
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
  viewEl.appendChild(el('div', 'sect', 'CATEGORIES'));
  var grid = el('div', 'cats');
  viewEl.appendChild(grid);
  paintCats(grid, SEED_CATS);
  fetch('https://fmhy.net/')
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var cats = parseHome(html);
      if (cats.length >= 6) paintCats(grid, cats);
    })
    .catch(function () { /* seed grid stays */ });
}
function paintCats(grid, cats) {
  grid.innerHTML = '';
  cats.forEach(function (c) {
    var b = el('button', 'cat', c.name);
    b.addEventListener('click', function () { renderCategory(c); });
    grid.appendChild(b);
  });
}
function parseHome(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var out = [];
  var cards = doc.querySelectorAll('a.VPFeature');
  for (var i = 0; i < cards.length; i++) {
    var a = cards[i];
    var href = a.getAttribute('href') || '';
    var t = a.querySelector('.title');
    var name = t ? t.textContent.trim() : a.textContent.trim();
    if (!name || !href || href === '/') continue;
    out.push({ name: name, path: new URL(href, 'https://fmhy.net').pathname });
  }
  return out;
}

/* ---------- category ---------- */
function renderCategory(cat) {
  currentCat = cat;
  backBtn.style.display = '';
  headsub.textContent = cat.name;
  viewEl.innerHTML = '';
  viewEl.appendChild(el('div', 'loading', 'Loading ' + cat.name + '…'));
  fetch('https://fmhy.net' + cat.path)
    .then(function (r) { return r.text(); })
    .then(function (html) {
      if (currentCat !== cat) return;
      var sections = parseCategory(html);
      viewEl.innerHTML = '';
      if (!sections.length) {
        viewEl.appendChild(el('div', 'empty', 'Could not read this page. Use Open full app below.'));
        return;
      }
      sections.forEach(function (s) {
        viewEl.appendChild(el('div', 'sect', s.title.toUpperCase()));
        var list = el('div', 'tiles');
        s.items.slice(0, 60).forEach(function (it) {
          var b = el('button', 'tile');
          b.appendChild(el('div', 'tname', it.name));
          b.appendChild(el('div', 'thost', hostOf(it.url)));
          b.addEventListener('click', function () { launch(it.url, it.name); });
          list.appendChild(b);
        });
        viewEl.appendChild(list);
      });
      viewEl.scrollTop = 0;
      document.body.scrollTop = 0;
    })
    .catch(function () {
      if (currentCat !== cat) return;
      viewEl.innerHTML = '';
      viewEl.appendChild(el('div', 'empty', 'Could not load ' + cat.name + ' \u2014 check your connection, or use Open full app below.'));
    });
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
  var cur = { title: 'Sites', items: [] };
  sections.push(cur);
  var nodes = vp.querySelectorAll('h2, h3, ul');
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.tagName === 'H2' || node.tagName === 'H3') {
      var t = cleanHeader(node);
      if (t) { cur = { title: t, items: [] }; sections.push(cur); }
    } else if (node.tagName === 'UL') {
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
backBtn.addEventListener('click', renderHome);
document.getElementById('openapp').addEventListener('click', function () {
  openTab(currentCat ? 'https://fmhy.net' + currentCat.path : 'https://fmhy.net/');
});
var apBtn = document.getElementById('airplay');
function paintAp() {
  apBtn.textContent = '\ud83d\udce1 AirPlay: ' + (store && store.airplayForce === false ? 'Off' : 'Forced');
}
apBtn.addEventListener('click', function () {
  if (!store) return;
  store.airplayForce = store.airplayForce === false;
  H.saveStore(store);
  paintAp();
});

H.loadStore().then(function (s) {
  store = s;
  paintAp();
  renderHome();
});
