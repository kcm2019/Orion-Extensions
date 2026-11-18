// Harness for heckyeah-orion — common.js pure logic + storage layer + manifest.
// Not shipped in the package.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../common.js', 'utf8');

function makeEnv(opts) {
  opts = opts || {};
  const local = {};
  const localStorage = {
    getItem: (k) => (k in local ? local[k] : null),
    setItem: (k, v) => { local[k] = String(v); },
    removeItem: (k) => { delete local[k]; },
  };
  const ext = {};
  const sandbox = {
    console, URL, Promise, Object, JSON, Math, Date,
    localStorage,
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  if (opts.withBrowserStorage) {
    sandbox.browser = {
      storage: { local: {
        get: (k) => Promise.resolve({ [k]: ext[k] }),
        set: (o) => { Object.assign(ext, o); return Promise.resolve(); },
      } },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { H: sandbox.HYO, local, ext, sandbox };
}

let pass = 0, fail = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('ok -', name); },
    (e) => { fail++; console.log('FAIL -', name, '::', e.message); });
}

(async () => {
  const { H } = makeEnv();

  await test('fmtTime basic', () => {
    assert.strictEqual(H.fmtTime(0), '0:00');
    assert.strictEqual(H.fmtTime(754), '12:34');
    assert.strictEqual(H.fmtTime(3723), '1:02:03');
    assert.strictEqual(H.fmtTime(65), '1:05');
    assert.strictEqual(H.fmtTime(NaN), '0:00');
  });

  await test('parseEpisode from S01E03 title', () => {
    const p = H.parseEpisode('Dark Matter S01E03 Entanglement', 'https://movy.sx/watch/123');
    assert.strictEqual(p.showTitle, 'Dark Matter');
    assert.strictEqual(p.season, 1);
    assert.strictEqual(p.episode, 3);
    assert.strictEqual(p.epLabel, 'S1 E3');
  });

  await test('parseEpisode from season-episode URL', () => {
    const p = H.parseEpisode('Watch Severance', 'https://x.example/tv/severance-season-2-episode-5');
    assert.strictEqual(p.season, 2);
    assert.strictEqual(p.episode, 5);
  });

  await test('parseEpisode 1x03 form', () => {
    const p = H.parseEpisode('The Expanse 1x03 Remember the Cant', 'https://x.example/a');
    assert.strictEqual(p.season, 1);
    assert.strictEqual(p.episode, 3);
    assert.strictEqual(p.showTitle, 'The Expanse');
  });

  await test('parseEpisode movie fallback strips site suffix', () => {
    const p = H.parseEpisode('Dune: Part Two | Movy', 'https://movy.sx/movie/dune-part-two');
    assert.strictEqual(p.episode, null);
    assert.strictEqual(p.showTitle, 'Dune: Part Two');
    assert.strictEqual(p.epLabel, null);
  });

  await test('isFinished boundary', () => {
    assert.strictEqual(H.isFinished({ pos: 919, dur: 1000 }), false);
    assert.strictEqual(H.isFinished({ pos: 920, dur: 1000 }), true);
    assert.strictEqual(H.isFinished({ finished: true, pos: 1, dur: 100 }), true);
    assert.strictEqual(H.isFinished({ pos: 50, dur: 0 }), false);
  });

  await test('groupByShow groups, orders by recency, excludes finished', () => {
    const now = Date.now();
    const entries = [
      { url: 'u1', title: 'Show A S1 E1', showTitle: 'Show A', showKey: 'show a', epLabel: 'S1 E1', season: 1, episode: 1, pos: 10, dur: 100, updatedAt: now - 3000 },
      { url: 'u2', title: 'Show A S1 E2', showTitle: 'Show A', showKey: 'show a', epLabel: 'S1 E2', season: 1, episode: 2, pos: 20, dur: 100, updatedAt: now - 1000 },
      { url: 'u3', title: 'Show B S1 E1', showTitle: 'Show B', showKey: 'show b', epLabel: 'S1 E1', season: 1, episode: 1, pos: 5, dur: 100, updatedAt: now - 2000 },
      { url: 'u4', title: 'Show A S1 E3', showTitle: 'Show A', showKey: 'show a', epLabel: 'S1 E3', season: 1, episode: 3, pos: 99, dur: 100, updatedAt: now },
    ];
    const groups = H.groupByShow(entries);
    assert.strictEqual(groups.length, 2);
    // u4 is finished (99%) and excluded, so Show A's latest is u2 (now-1000) -> first
    assert.strictEqual(groups[0].showTitle, 'Show A');
    assert.strictEqual(groups[0].latest.url, 'u2');
    assert.strictEqual(groups[1].showTitle, 'Show B');
  });

  await test('groupByShow latest is newest unfinished episode', () => {
    const now = Date.now();
    const entries = [
      { url: 'u1', title: 'A E1', showTitle: 'Show A', showKey: 'show a', season: 1, episode: 1, pos: 10, dur: 100, updatedAt: now - 3000 },
      { url: 'u2', title: 'A E2', showTitle: 'Show A', showKey: 'show a', season: 1, episode: 2, pos: 20, dur: 100, updatedAt: now - 1000 },
      { url: 'u4', title: 'A E3', showTitle: 'Show A', showKey: 'show a', season: 1, episode: 3, pos: 99, dur: 100, updatedAt: now },
    ];
    const groups = H.groupByShow(entries);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].episodes.length, 2);
    assert.strictEqual(groups[0].latest.url, 'u2');
    assert.strictEqual(groups[0].episodes.map(e => e.url).join(','), 'u1,u2');
  });

  await test('pickNextEpisode finds labelled link, ignores Previous', () => {
    const links = [
      { href: 'https://x.example/ep4', text: 'Previous Episode' },
      { href: 'https://x.example/ep6', text: 'Next Episode' },
    ];
    const n = H.pickNextEpisode(links, { episode: 5, season: 1 });
    assert.ok(n);
    assert.strictEqual(n.url, 'https://x.example/ep6');
  });

  await test('pickNextEpisode by episode number increment', () => {
    const links = [{ href: 'https://x.example/show-s01e06', text: 'S01E06' }];
    const n = H.pickNextEpisode(links, { episode: 5, season: 1 });
    assert.ok(n);
    assert.strictEqual(n.url, 'https://x.example/show-s01e06');
  });

  await test('sweepDecision movy-shaped robot card removed', () => {
    const vw = 1000, vh = 800;
    const d = H.sweepDecision({ hasPhrase: true, textLen: 120, rectW: 0.35 * vw, rectH: 0.9 * vh, vw, vh, positioned: true, containsVideo: false, containsCF: false, isBodyOrHtml: false });
    assert.strictEqual(d, true);
  });

  await test('sweepDecision spares video containers, CF, in-flow text', () => {
    const vw = 1000, vh = 800;
    const base = { hasPhrase: true, textLen: 120, rectW: 900, rectH: 700, vw, vh, positioned: true, containsVideo: false, containsCF: false, isBodyOrHtml: false };
    assert.strictEqual(H.sweepDecision(Object.assign({}, base, { containsVideo: true })), false);
    assert.strictEqual(H.sweepDecision(Object.assign({}, base, { containsCF: true })), false);
    assert.strictEqual(H.sweepDecision(Object.assign({}, base, { positioned: false })), false);
    assert.strictEqual(H.sweepDecision(Object.assign({}, base, { rectW: 100, rectH: 50 })), false);
    assert.strictEqual(H.sweepDecision(Object.assign({}, base, { textLen: 5000 })), false);
    assert.strictEqual(H.sweepDecision(Object.assign({}, base, { isBodyOrHtml: true })), false);
  });

  await test('isArmed direct + referrer + unarmed', () => {
    const armed = { 'movy.sx': { applet: 'Movy', ts: 1 } };
    assert.strictEqual(H.isArmed('movy.sx', armed, null), true);
    assert.strictEqual(H.isArmed('player.example', armed, 'movy.sx'), true);
    assert.strictEqual(H.isArmed('random.example', armed, null), false);
    assert.strictEqual(H.isArmed('random.example', armed, 'other.example'), false);
  });

  await test('storage: browser.storage used and mirrored to localStorage', async () => {
    const env = makeEnv({ withBrowserStorage: true });
    const s = env.H.defaultStore();
    s.visits = 7;
    await env.H.saveStore(s);
    assert.strictEqual(env.ext.heckyeah_orion.visits, 7);
    assert.ok(env.local.heckyeah_orion, 'mirror written');
    const loaded = await env.H.loadStore();
    assert.strictEqual(loaded.visits, 7);
    assert.strictEqual(loaded.storageMode, 'ext');
  });

  await test('storage: localStorage fallback when no extension storage', async () => {
    const env = makeEnv({ withBrowserStorage: false });
    const s = env.H.defaultStore();
    s.visits = 3;
    await env.H.saveStore(s);
    const loaded = await env.H.loadStore();
    assert.strictEqual(loaded.visits, 3);
    assert.strictEqual(loaded.storageMode, 'local-only');
  });

  await test('cleanTags strips mirror debris from screenshot cases', () => {
    assert.deepStrictEqual(
      Array.from(H.cleanTags('or - 4K / External Subs / Ad-Toggle')),
      ['4K', 'External Subs', 'Ad-Toggle']);
    assert.deepStrictEqual(
      Array.from(H.cleanTags(', , - 4K / Dual Audio / External Subs / Ad-Toggle / /')),
      ['4K', 'Dual Audio', 'External Subs', 'Ad-Toggle']);
    assert.deepStrictEqual(
      Array.from(H.cleanTags('1080p / Dual Audio / Popup + Redirect Free')),
      ['1080p', 'Dual Audio', 'Popup + Redirect Free']);
    assert.deepStrictEqual(Array.from(H.cleanTags('')), []);
    assert.deepStrictEqual(Array.from(H.cleanTags('4K / 4K / Dual Audio')), ['4K', 'Dual Audio']);
  });

  await test('clampPillPos keeps the pill on screen', () => {
    const c1 = H.clampPillPos(-50, 9999, 120, 44, 1000, 800);
    assert.strictEqual(c1.x, 6);
    assert.strictEqual(c1.y, 800 - 44 - 6);
    const c2 = H.clampPillPos(500, 300, 120, 44, 1000, 800);
    assert.strictEqual(c2.x, 500);
    assert.strictEqual(c2.y, 300);
  });

  await test('parseEpisode from URL query params (movy-style)', () => {
    const p = H.parseEpisode('Law & Order: Special Victims Unit', 'https://movy.sx/tv/123?season=27&episode=4');
    assert.strictEqual(p.season, 27);
    assert.strictEqual(p.episode, 4);
    assert.strictEqual(p.showTitle, 'Law & Order: Special Victims Unit');
    const q = H.parseEpisode('Some Show', 'https://x.example/watch/9?s=3&e=9');
    assert.strictEqual(q.season, 3);
    assert.strictEqual(q.episode, 9);
  });

  await test('parseEpisodeJsonLd extracts TVEpisode', () => {
    const hit = H.parseEpisodeJsonLd(JSON.stringify({
      '@context': 'https://schema.org', '@type': 'TVEpisode', episodeNumber: 4,
      partOfSeason: { '@type': 'TVSeason', seasonNumber: 27 },
      partOfSeries: { '@type': 'TVSeries', name: 'Law & Order: Special Victims Unit' },
    }));
    assert.ok(hit);
    assert.strictEqual(hit.season, 27);
    assert.strictEqual(hit.episode, 4);
    assert.strictEqual(hit.showTitle, 'Law & Order: Special Victims Unit');
    const graph = H.parseEpisodeJsonLd(JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'TVEpisode', episodeNumber: 2, partOfSeason: 5 }] }));
    assert.ok(graph);
    assert.strictEqual(graph.season, 5);
    assert.strictEqual(graph.episode, 2);
    assert.strictEqual(H.parseEpisodeJsonLd('not json'), null);
    assert.strictEqual(H.parseEpisodeJsonLd(JSON.stringify({ '@type': 'Movie', name: 'Dune' })), null);
  });

  await test('parseEpisodeEnhanced falls back to scraped texts', () => {
    const p = H.parseEpisodeEnhanced({
      title: 'Law & Order: Special Victims Unit',
      url: 'https://movy.sx/tv/123',
      extraTexts: ['Watch free in HD', 'Season 27 \u00b7 Episode 4 \u2014 Pure as the Driven Snow'],
    });
    assert.strictEqual(p.season, 27);
    assert.strictEqual(p.episode, 4);
    assert.strictEqual(p.showTitle, 'Law & Order: Special Victims Unit');
    const none = H.parseEpisodeEnhanced({ title: 'Some Movie', url: 'https://x.example/m/1', extraTexts: ['A great film'] });
    assert.strictEqual(none.episode, null);
  });

  await test('shelf tiles marked for arming + episode scraping present in sources', () => {
    const fmhy = fs.readFileSync(__dirname + '/../fmhy.js', 'utf8');
    assert.ok(fmhy.includes('data-hyo-applet'), 'shelf tiles marked for arming');
    assert.ok(fmhy.includes('stopPropagation'), 'control taps stop propagation');
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(trk.includes('application/ld+json'), 'JSON-LD scrape');
    assert.ok(trk.includes('applyEpisodeInfo'), 'episode info applied');
    assert.ok(trk.includes('lastHref'), 'SPA watcher');
  });

  await test('app interface is the default on fmhy, Continue first, no Resume button', () => {
    const fmhy = fs.readFileSync(__dirname + '/../fmhy.js', 'utf8');
    assert.ok(fmhy.includes('document.addEventListener(\'DOMContentLoaded\', build)'), 'overlay auto-builds on load');
    assert.ok(!fmhy.includes('openSheet'), 'fmhy sheet removed (pill menu lives on streaming sites)');
    assert.ok(fmhy.indexOf('renderContinue(root)') < fmhy.indexOf('renderHomeVideo(root)'), 'Continue Watching renders before the streaming shelves');
    assert.ok(!fmhy.includes('hyo-resume'), 'Resume button removed — entries just open the saved link');
  });

  await test('no in-site resume at all: tracker never touches the timestamp', () => {
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(!trk.includes('Resume at '), 'arrival popup removed');
    assert.ok(!trk.includes('Left off at '), 'play-gated variant removed');
    assert.ok(!trk.includes('resumeOffered'), 'resume state gone');
    const seeks = trk.match(/currentTime\s*=/g) || [];
    assert.ok(seeks.length <= 2, 'only phone-remote seek commands remain, found ' + seeks.length);
  });

  await test('PiP hand-off to the app view', () => {
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(trk.includes('requestPiPEverywhere'), 'broadcast helper');
    assert.ok(trk.includes('webkitSetPresentationMode'), 'WebKit PiP path');
    assert.ok(trk.includes('requestPictureInPicture'), 'standard PiP path');
    assert.ok(trk.includes('disablePictureInPicture = false'), 'site PiP block cleared');
  });

  await test('phone remote: Fire TV v1.37 pairing flow + commands wired', () => {
    const rem = fs.readFileSync(__dirname + '/../remote.js', 'utf8');
    assert.ok(rem.includes('hyo-remote='), 'QR carries the room fragment');
    assert.ok(!rem.includes('&c='), 'code is NOT in the QR — it is issued per request');
    assert.ok(rem.includes("msg.t === 'pair-request'"), 'phone requests pairing first');
    assert.ok(rem.includes("msg.t === 'pair-confirm'"), 'phone confirms');
    assert.ok(rem.includes('completePairing'), 'either side can confirm');
    assert.ok(rem.includes('Pair this phone?'), 'host card pops on request');
    assert.ok(rem.includes('setTimeout(connect, 400)'), 'phone auto-connects on open');
    assert.ok(rem.includes('CONNECTION LOG'), 'diagnostics log on both sides');
    assert.ok(rem.includes('getModuleCount'), 'QR rendered locally (canvas)');
    assert.ok(rem.includes("case 'move'") && rem.includes("case 'key'") && rem.includes("case 'text'"), 'cursor + keyboard commands');
    assert.ok(rem.includes('guestBoot'), 'phone remote UI');
    const fmhy = fs.readFileSync(__dirname + '/../fmhy.js', 'utf8');
    assert.ok(fmhy.includes('isRemoteHash'), 'fmhy boots remote mode from hash');
    assert.ok(fmhy.includes('startHostPanel'), 'pairing entry in overlay header');
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(trk.includes('setMediaHandler'), 'tracker serves media commands');
    assert.ok(fs.existsSync(__dirname + '/../vendor/peerjs.min.js'), 'peerjs vendored');
    assert.ok(fs.existsSync(__dirname + '/../vendor/qrcode.min.js'), 'qrcode vendored');
  });

  await test('remote room/code generators are sane', () => {
    const src = fs.readFileSync(__dirname + '/../remote.js', 'utf8');
    assert.ok(/function randomCode\(\)/.test(src), 'code generator present');
    assert.ok(src.includes('hyo-'), 'peer id prefix');
  });

  await test('QR renders to canvas; tracker injects nothing into player iframes', () => {
    const rem = fs.readFileSync(__dirname + '/../remote.js', 'utf8');
    assert.ok(rem.includes('getModuleCount') && rem.includes("getContext('2d')"), 'canvas QR');
    assert.ok(!rem.includes('createSvgTag'), 'collapsed-SVG path removed');
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(trk.includes('__hyo: \'toast\''), 'toasts forwarded to top frame');
    assert.ok(trk.includes('queueToast'), 'toast routing helper');
    assert.ok(!trk.includes('backdrop-filter:blur(18px)'), 'no blur composited over video');
  });

  await test('pairing roams: session in store, re-host + yield, no background page', () => {
    const m = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
    assert.ok(!m.background, 'background host removed (never connected on Orion)');
    const rem = fs.readFileSync(__dirname + '/../remote.js', 'utf8');
    assert.ok(rem.includes('hyoSession'), 'session persisted in the store');
    assert.ok(rem.includes('roamTick'), 'takeover watch');
    assert.ok(rem.includes('wantHost'), 'visible tab can claim hosting');
    assert.ok(rem.includes('hostBeat'), 'host heartbeat');
    assert.ok(rem.includes('unavailable-id'), 'stand aside when another tab hosts');
    assert.ok(rem.includes('peer-unavailable'), 'guest quietly retries while host roams');
    assert.ok(rem.includes('reportNow'), 'now-playing push');
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(trk.includes('pushNow'), 'tracker reports now playing');
  });

  await test('pairing survives URL switches + clicks reach iframe players', () => {
    const rem = fs.readFileSync(__dirname + '/../remote.js', 'utf8');
    assert.ok(rem.includes('handleDrop'), 'ICE failure treated as a drop, not a hang');
    assert.ok(rem.includes('same session'), 'guest redials the same session');
    assert.ok(rem.includes('myGen !== gen'), 'superseded-socket handlers are inert');
    assert.ok(rem.includes('lastHostTry'), 'visible page probes hosting immediately');
    assert.ok(rem.includes('visibilitychange'), 'claim on becoming visible');
    assert.ok(rem.includes('hyo-relay'), 'commands relay into iframes');
    assert.ok(rem.includes('clickAtPoint'), 'coordinate clicks inside frames');
    assert.ok(rem.includes('clickableTarget'), 'click retargets to the button');
    assert.ok(rem.includes('pointerdown'), 'full pointer sequence');
  });

  await test('connection persists: heartbeat is the only drop authority', () => {
    const rem = fs.readFileSync(__dirname + '/../remote.js', 'utf8');
    assert.ok(rem.includes("t: 'ping'") && rem.includes("t: 'pong'"), 'ping/pong heartbeat');
    assert.ok(rem.includes('startHeartbeat'), 'heartbeat starts on pairing');
    assert.ok(rem.includes('heartbeat lost'), 'watchdog drops only on 12s of silence');
    assert.ok(!rem.includes("handleDrop(myGen, 'ice"), 'ICE events never tear down directly');
    assert.ok(rem.includes('serving'), 'a host serving a live phone never yields');
    assert.ok(rem.includes('lastTraffic'), 'host tracks live traffic');
  });

  await test('AirPlay feature removed everywhere (Kurt, v0.12.0)', () => {
    const trk = fs.readFileSync(__dirname + '/../tracker.js', 'utf8');
    assert.ok(!trk.includes('disableRemotePlayback'), 'no remote-playback stripping');
    assert.ok(!trk.includes('airplayForce'), 'setting no longer read');
    const fmhy = fs.readFileSync(__dirname + '/../fmhy.js', 'utf8');
    assert.ok(!fmhy.includes('AirPlay: '), 'no toggle chip in the app view');
    const popHtml = fs.readFileSync(__dirname + '/../popup.html', 'utf8');
    assert.ok(!popHtml.includes('airplay'), 'no toggle in the popup footer');
    const pop = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
    assert.ok(!pop.includes('airplay'), 'no airplay code in the popup');
  });

  await test('toolbar popup: the app in a popup, navigable', () => {
    const m = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
    assert.ok(m.browser_action && m.browser_action.default_popup === 'popup.html', 'browser_action popup declared');
    assert.ok(fs.existsSync(__dirname + '/../popup.html'), 'popup.html exists');
    assert.ok(fs.existsSync(__dirname + '/../popup.css'), 'popup.css exists');
    const pop = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
    assert.ok(pop.includes('tabs.create'), 'sites open in tabs');
    assert.ok(pop.includes('store.armed[host]'), 'launches arm the tracker like the app view');
    assert.ok(pop.includes('fmhy.net/video'), 'popup home is the streaming shelves');
    assert.ok(!pop.includes('SEED_CATS'), 'category grid gone from the popup');
    assert.ok(pop.includes('parseCategory'), 'shelves parsed in the popup');
    assert.ok(pop.includes('groupByShow'), 'continue watching grouped like the app');
  });

  await test('sortSites: favorites first, then saved order, then FMHY order', () => {
    const items = [
      { name: 'A', url: 'https://a.example' },
      { name: 'B', url: 'https://b.example' },
      { name: 'C', url: 'https://c.example' },
      { name: 'D', url: 'https://d.example' }
    ];
    const store = {
      favorites: { 'https://c.example': true },
      siteOrder: { 'S|T': ['https://d.example', 'https://b.example', 'https://a.example', 'https://c.example'] }
    };
    const out = H.sortSites(items, 'S|T', store).map((i) => i.name);
    assert.deepStrictEqual(out, ['C', 'D', 'B', 'A']);
    const plain = H.sortSites(items, 'S|T', {}).map((i) => i.name);
    assert.deepStrictEqual(plain, ['A', 'B', 'C', 'D']);
    assert.strictEqual(H.shelfKey({ section: 'S', title: 'T' }), 'S|T');
    assert.strictEqual(H.shelfKey({ section: '', title: 'T' }), 'T');
  });

  await test('home is streaming-only; tiles carry favorite + drag reorder', () => {
    const fmhy = fs.readFileSync(__dirname + '/../fmhy.js', 'utf8');
    assert.ok(fmhy.includes('renderHomeVideo'), 'home renders the /video shelves');
    assert.ok(!fmhy.includes('renderCats(root)'), 'category grid no longer rendered');
    assert.ok(fmhy.includes("fetch('/video')"), 'shelves fetched from /video');
    assert.ok(fmhy.includes('hyo-fav'), 'favorite toggle on tiles');
    assert.ok(!fmhy.includes('moveSite'), 'up/down buttons removed');
    assert.ok(fmhy.includes('attachTileDrag'), 'long-press drag reorder in the app view');
    assert.ok(fmhy.includes('store.siteOrder[key]'), 'order saved per shelf');
    assert.ok(fmhy.includes('isVideo || isHome'), 'arming covers home shelves');
    const pop = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
    assert.ok(pop.includes('attachPopDrag'), 'drag reorder in the popup too');
    assert.ok(pop.includes('renderPopShelves'), 'popup renders streaming shelves');
  });

  await test('update checker: wired into app view + popup, not the tracker', () => {
    const m = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
    const fmhyList = m.content_scripts[0].js;
    const trackerList = m.content_scripts[1].js;
    assert.ok(fmhyList.includes('update-check.js'), 'update-check in fmhy list');
    assert.ok(fmhyList.indexOf('update-check.js') < fmhyList.indexOf('fmhy.js'), 'loads before fmhy.js');
    assert.ok(!trackerList.includes('update-check.js'), 'not loaded in tracker context');
    const popHtml = fs.readFileSync(__dirname + '/../popup.html', 'utf8');
    assert.ok(popHtml.includes('update-check.js'), 'popup loads update-check.js');
    assert.ok(popHtml.indexOf('update-check.js') < popHtml.indexOf('popup.js'), 'popup: loads before popup.js');
    const fmhy = fs.readFileSync(__dirname + '/../fmhy.js', 'utf8');
    assert.ok(fmhy.includes('HYOUpdate'), 'app view uses the checker');
    assert.ok(fmhy.includes('hyo-upd'), 'app view banner present');
    assert.ok(fmhy.includes('Check for updates'), 'app view manual check present');
    const pop = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
    assert.ok(pop.includes('HYOUpdate'), 'popup uses the checker');
    assert.ok(pop.includes('checkNow'), 'popup manual/auto check wired');
    assert.ok(fs.existsSync(__dirname + '/../update-check.js'), 'update-check.js exists');
  });

  await test('extGet can never hang a boot: promise/callback/timeout all settle', () => {
    const common = fs.readFileSync(__dirname + '/../common.js', 'utf8');
    assert.ok(common.includes("typeof r.then === 'function'"), 'promise return checked before use');
    assert.ok(common.includes('fin(null); }, 3000'), 'storage read self-resolves after 3 s');
    const pop = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
    assert.ok(pop.includes('bootSteps'), 'popup boot is instrumented');
    assert.ok(pop.includes('bootFail'), 'popup renders boot failures instead of hanging');
  });

  await test('manifest parses, version 0.12.1, files exist', () => {
    const m = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
    assert.strictEqual(m.version, '0.12.1');
    assert.strictEqual(m.manifest_version, 2);
    m.content_scripts.forEach((cs) => {
      (cs.js || []).forEach((f) => assert.ok(fs.existsSync(__dirname + '/../' + f), f));
      (cs.css || []).forEach((f) => assert.ok(fs.existsSync(__dirname + '/../' + f), f));
    });
    assert.ok(m.permissions.includes('storage'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
