// Harness for yt-orion-native-fullscreen/content.js v1.2 — not shipped.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../content.js', 'utf8');
const RealURL = URL;
const RealSetTimeout = setTimeout;
let blobCounter = 0;
function FakeURL(...args) { return new RealURL(...args); }
FakeURL.createObjectURL = () => 'blob:fake-' + (++blobCounter);
FakeURL.revokeObjectURL = () => {};
const flush = () => new Promise((r) => RealSetTimeout(r, 40));

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], style: {}, dataset: {}, attrs: {}, _ls: {}, _text: '', id: '',
    set textContent(v) { this._text = v; this.children = []; },
    get textContent() { return this._text; },
    append(...xs) { xs.forEach((x) => this.appendChild(x)); },
    appendChild(x) {
      // Real DOM appendChild MOVES the node out of its old parent.
      if (x && x._parent && x._parent.children) {
        const i = x._parent.children.indexOf(x);
        if (i >= 0) x._parent.children.splice(i, 1);
      }
      if (x) x._parent = this;
      this.children.push(x);
      return x;
    },
    addEventListener(t, fn) { (this._ls[t] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    remove() { this.removed = true; },
    click() { (this._ls.click || []).forEach((f) => f({ stopPropagation() {}, preventDefault() {} })); },
  };
  el._classes = new Set();
  el.classList = {
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    contains: (c) => el._classes.has(c),
    toggle: (c) => (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c)),
  };
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 44, right: 200, bottom: 44 });
  el.closest = () => null;
  el._dispatched = [];
  el.dispatchEvent = (ev) => { el._dispatched.push(ev); return true; };
  return el;
}

function makeTrackEl() {
  const el = makeEl('track');
  el.track = { mode: 'disabled' };
  el.default = false;
  return el;
}

function makeVideo() {
  return {
    readyState: 4,
    playbackRate: 1,
    paused: false,
    ended: false,
    currentTime: 0,
    duration: 100,
    play() { this.paused = false; },
    pause() { this.paused = true; },
    disablePictureInPicture: true,
    volume: 0.8,
    muted: false,
    webkitPresentationMode: 'inline',
    pickerCalls: 0,
    webkitShowPlaybackTargetPicker() { this.pickerCalls++; },
    webkitDisplayingFullscreen: false,
    webkitPresentationMode: 'inline',
    entered: 0,
    pipCalls: [],
    children: [],
    listeners: {},
    webkitEnterFullscreen() { this.entered++; },
    webkitExitFullscreen() {},
    webkitSupportsPresentationMode(m) { return m === 'picture-in-picture'; },
    webkitSetPresentationMode(m) { this.pipCalls.push(m); this.webkitPresentationMode = m; },
    removeAttribute() { this.disablePictureInPicture = false; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(el) {
      this.children.push(el);
      // Real DOM remove() detaches from the parent; mirror that.
      if (el && el.dataset) {
        const parent = this;
        const orig = el.remove;
        el.remove = () => {
          const i = parent.children.indexOf(el);
          if (i >= 0) parent.children.splice(i, 1);
          if (orig) orig.call(el);
        };
      }
      return el;
    },
    querySelectorAll(sel) {
      if (sel.includes('track')) return this.children.filter((c) => c.dataset && c.dataset.ytnf);
      return [];
    },
    get textTracks() {
      return this.children.filter((c) => c.track).map((c) => ({ label: c.label, mode: c.track.mode }));
    },
  };
}

function makeEnv({ hostname = 'www.youtube.com', video = null, playerResponse = null, selectedLang = null, fetchImpl = null, initialPrefs = null, levels = [] } = {}) {
  const listeners = {};
  const injected = [];
  const store = {};
  const fetched = [];
  const storageData = initialPrefs ? { ytnf_prefs: initialPrefs } : {};
  const storageSetCalls = [];

  const holder = { current: video };
  const player = {
    id: 'movie_player',
    children: [],
    qualityCalls: [],
    dataset: {},
    _w: 1024,
    getBoundingClientRect() { return { left: 0, top: 0, width: this._w, height: 576, right: this._w, bottom: 576 }; },
    _ls: {},
    _classes: new Set(),
    addEventListener(t, fn) { (this._ls[t] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute() {},
    classList: null,
    appendChild(el) { this.children.push(el); return el; },
    querySelector() { return holder.current; },
    getOption() { return selectedLang ? { languageCode: selectedLang } : null; },
    getAvailableQualityLevels() { return levels; },
    setPlaybackQualityRange(code) { this.qualityCalls.push(code); },
    setPlaybackQuality(code) { this.qualityCalls.push(code); },
  };
  player.classList = {
    add: (c) => player._classes.add(c),
    remove: (c) => player._classes.delete(c),
    contains: (c) => player._classes.has(c),
  };

  const documentStub = {
    documentElement: makeEl('html'),
    head: { appendChild(el) { injected.push(el._text || el.textContent); } },
    body: makeEl('body'),
    hidden: false,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    createElement(tag) {
      if (tag === 'track') return makeTrackEl();
      return makeEl(tag);
    },
    querySelector() { return holder.current; },
    querySelectorAll() { return []; },
    getElementById(id) {
      if (id === 'movie_player') return player;
      return null;
    },
  };
  documentStub.documentElement.appendChild = (el) => { injected.push(el._text || el.textContent); };

  const wrapped = { document: documentStub };
  if (playerResponse) wrapped.ytInitialPlayerResponse = playerResponse;

  const sandbox = {
    console,
    URL: FakeURL,
    URLSearchParams,
    Blob,
    Date,
    Intl,
    navigator: { language: 'en-US' },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => RealSetTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    browser: {
      storage: {
        local: {
          get: () => Promise.resolve(storageData),
          set: (obj) => { storageSetCalls.push(obj); Object.assign(storageData, obj); return Promise.resolve(); },
        },
      },
    },
    localStorage: {
      _m: {},
      getItem(k) { return k in this._m ? this._m[k] : null; },
      setItem(k, v) { this._m[k] = String(v); },
    },
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: {
      hostname,
      pathname: '/watch',
      search: '?v=abc123',
      href: `https://${hostname}/watch?v=abc123`,
      replaced: null,
      replace(u) { this.replaced = u; },
    },
    document: documentStub,
    window: { addEventListener(type, fn) { (listeners['win:' + type] ||= []).push(fn); } },
    fetch: fetchImpl || ((u) => { fetched.push(u); return Promise.reject(new Error('no fetch in this env')); }),
  };
  sandbox.window.document = documentStub;
  sandbox.window.wrappedJSObject = wrapped;
  sandbox.window.Element = function Element() {};
  vm.createContext(sandbox);
  return { sandbox, listeners, injected, store, fetched, player, storageData, storageSetCalls, swapVideo(v) { holder.current = v; } };
}

function clickEvent(target) {
  return {
    target, stopped: false, prevented: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}
function findAll(el, pred, out = []) {
  if (!el || !el.children) return out;
  for (const c of el.children) {
    if (c && pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}
const fsBtnTarget = { closest(sel) { return sel.includes('ytp-fullscreen-button') ? {} : null; } };

function captionPR(tracks) {
  return {
    videoDetails: { videoId: 'abc123' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
  };
}
const ytTrack = (lang, kind, label) => ({
  baseUrl: `https://www.youtube.com/api/timedtext?v=abc123&lang=${lang}&fmt=srv3`,
  name: { simpleText: label },
  languageCode: lang,
  kind: kind || '',
  vssId: '.' + lang,
});
const okFetch = (env) => (u) => {
  env.fetched.push(u);
  return Promise.resolve({ ok: true, text: () => Promise.resolve('WEBVTT\n\n00:00.000 --> 00:01.000\nHello') });
};

(async () => {
  // 1. Fullscreen-button click -> native player, event swallowed
  {
    const video = makeVideo();
    const { sandbox, listeners } = makeEnv({ video });
    vm.runInContext(src, sandbox);
    const ev = clickEvent(fsBtnTarget);
    listeners.click.slice().forEach((fn) => fn(ev));
    assert.strictEqual(video.entered, 1);
    assert.strictEqual(ev.prevented, true);
    console.log('PASS 1 fullscreen button -> native player');
  }

  // 2. Non-fullscreen click -> untouched
  {
    const video = makeVideo();
    const { sandbox, listeners } = makeEnv({ video });
    vm.runInContext(src, sandbox);
    const ev = clickEvent({ closest() { return null; } });
    listeners.click.slice().forEach((fn) => fn(ev));
    assert.strictEqual(video.entered, 0);
    assert.strictEqual(ev.prevented, false);
    console.log('PASS 2 unrelated click untouched');
  }

  // 3. No webkitEnterFullscreen (desktop) -> click NOT swallowed
  {
    const video = makeVideo();
    delete video.webkitEnterFullscreen;
    const { sandbox, listeners } = makeEnv({ video });
    vm.runInContext(src, sandbox);
    const ev = clickEvent(fsBtnTarget);
    listeners.click.slice().forEach((fn) => fn(ev));
    assert.strictEqual(ev.prevented, false);
    console.log('PASS 3 desktop falls through');
  }

  // 4. m.youtube.com redirects to www exactly once per session
  {
    const env = makeEnv({ hostname: 'm.youtube.com', video: makeVideo() });
    vm.runInContext(src, env.sandbox);
    assert.strictEqual(env.sandbox.location.replaced, 'https://www.youtube.com/watch?v=abc123');
    const env2 = makeEnv({ hostname: 'm.youtube.com', video: makeVideo() });
    env2.sandbox.sessionStorage.getItem = (k) => (k in env.store ? env.store[k] : null);
    env2.sandbox.sessionStorage.setItem = (k, v) => { env.store[k] = String(v); };
    vm.runInContext(src, env2.sandbox);
    assert.strictEqual(env2.sandbox.location.replaced, null);
    console.log('PASS 4 m -> www redirect + loop guard');
  }

  // 5. Page patch reroutes container requestFullscreen to the video
  {
    const video = makeVideo();
    const { sandbox, injected } = makeEnv({ video });
    vm.runInContext(src, sandbox);
    const code = injected.find((t) => t && t.includes('__ytnfPatched'));
    assert.ok(code, 'patch injected');
    const origCalls = [];
    function FakeElement() {}
    FakeElement.prototype.requestFullscreen = function () { origCalls.push(this); return 'orig'; };
    const container = Object.create(FakeElement.prototype);
    container.tagName = 'DIV'; container.id = 'movie_player';
    container.classList = { contains: () => false };
    container.querySelector = () => video;
    const pageWin = { Element: FakeElement, Promise };
    const pageCtx = vm.createContext({ window: pageWin });
    pageWin.window = pageWin;
    vm.runInContext(code, pageCtx);
    container.requestFullscreen();
    assert.strictEqual(video.entered, 1);
    assert.strictEqual(origCalls.length, 0);
    console.log('PASS 5 page patch reroutes player requestFullscreen');
  }

  // 6. Captions attach, preferred = YouTube-selected, default + hidden
  {
    const video = makeVideo();
    const tracks = [ytTrack('es', '', 'Spanish'), ytTrack('en', '', 'English'), ytTrack('en', 'asr', 'English')];
    const env = makeEnv({ video, playerResponse: captionPR(tracks), selectedLang: 'en' });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.strictEqual(video.children.length, 3, 'all 3 tracks attached');
    assert.ok(env.fetched.every((u) => u.includes('fmt=vtt') && !u.includes('srv3')));
    const pref = video.children.find((c) => c.default === true || 'default' in c.attrs);
    assert.ok(pref && pref.srclang === 'en' && pref.track.mode === 'hidden');
    console.log('PASS 6 caption tracks attached, preferred=default+hidden');
  }

  // 7. Fullscreen begin/end flips preferred track mode
  // (begin only here — end now also triggers auto-PiP, tested in 14)
  {
    const video = makeVideo();
    const tracks = [ytTrack('en', '', 'English'), ytTrack('es', '', 'Spanish')];
    const env = makeEnv({ video, playerResponse: captionPR(tracks) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const pref = video.children.find((c) => c.default === true || 'default' in c.attrs);
    assert.strictEqual(pref.track.mode, 'hidden');
    env.listeners.webkitbeginfullscreen.forEach((fn) => fn({ target: video }));
    assert.strictEqual(pref.track.mode, 'showing');
    console.log('PASS 7 mode flips hidden -> showing on fullscreen begin');
  }

  // 8. Cap at 14 tracks
  {
    const video = makeVideo();
    const langs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'sv', 'no', 'da', 'fi', 'tr', 'id'];
    const env = makeEnv({ video, playerResponse: captionPR(langs.map((l) => ytTrack(l, '', l))) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.strictEqual(video.children.length, 14);
    console.log('PASS 8 track cap at 14');
  }

  // 9. No captions -> status none
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.strictEqual(video.children.length, 0);
    assert.strictEqual(env.sandbox.document.documentElement.attrs['data-ytnf-captions'], 'none');
    console.log('PASS 9 no-caption video handled');
  }

  // 10. Bad VTT rejected
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve('<html>nope</html>') });
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.strictEqual(video.children.length, 0);
    assert.strictEqual(env.sandbox.document.documentElement.attrs['data-ytnf-captions'], 'error:all-fetches-failed');
    console.log('PASS 10 bad VTT rejected');
  }

  // 11. A: quality lock applies nearest at-or-below the saved quality
  {
    const video = makeVideo();
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { quality: 'hd1080', speed: 1, captionLang: null },
      levels: ['hd720', 'large', 'medium'],
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.deepStrictEqual(env.player.qualityCalls, ['hd720'], 'want hd1080, applied hd720: ' + env.player.qualityCalls);
    console.log('PASS 11 quality lock nearest-below');
  }

  // 12. B: saved speed applied to the video
  {
    const video = makeVideo();
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { quality: 'auto', speed: 1.5, captionLang: null },
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.strictEqual(video.playbackRate, 1.5);
    console.log('PASS 12 persistent speed applied');
  }

  // 13. C: caption language pref with no native track -> auto-translate job
  {
    const video = makeVideo();
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { quality: 'auto', speed: 1, captionLang: 'fr' },
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    assert.strictEqual(video.children.length, 2, 'translated + native tracks');
    assert.ok(env.fetched.some((u) => u.includes('tlang=fr') && u.includes('fmt=vtt')), 'translate fetch: ' + env.fetched.join(' | '));
    const pref = video.children.find((c) => c.default === true || 'default' in c.attrs);
    assert.strictEqual(pref.srclang, 'fr');
    assert.ok(pref.label.includes('auto-translated'), pref.label);
    console.log('PASS 13 auto-translate caption for preferred language');
  }

  // 14. F REMOVED (v1.2.1): fullscreen exit + tab hide must make NO PiP
  // calls and must not touch disablePictureInPicture.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.listeners.webkitendfullscreen.forEach((fn) => fn({ target: video }));
    (env.listeners.visibilitychange || []).forEach((fn) => fn({ target: video }));
    assert.deepStrictEqual(video.pipCalls, [], 'no presentation-mode calls');
    assert.strictEqual(video.disablePictureInPicture, true, 'PiP attribute untouched');
    assert.ok(!env.listeners.visibilitychange, 'no visibilitychange listener registered');
    assert.ok(!env.listeners.webkitpresentationmodechanged, 'no presentationmode listener registered');
    console.log('PASS 14 feature F fully removed (no PiP activity)');
  }

  // 15. C via the single settings menu: gear -> Captions page ->
  // picking Spanish persists the pref and re-preferences tracks.
  {
    const video = makeVideo();
    const tracks = [ytTrack('en', '', 'English'), ytTrack('es', '', 'Spanish')];
    const env = makeEnv({ video, playerResponse: captionPR(tracks) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    assert.ok(root, 'Apple UI mounted');
    const gear = findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0];
    assert.ok(gear, 'single settings button present');
    gear.click(); // panel opens on main page
    const ccRow = findAll(root, (c) => c.dataset && c.dataset.page === 'cc')[0];
    assert.ok(ccRow, 'Captions row on the main menu page');
    ccRow.click(); // drill into Captions page
    const spanish = findAll(root, (c) => c.dataset && c.dataset.pick === 'caption:es')[0];
    assert.ok(spanish, 'Spanish listed on the Captions page');
    spanish.click();
    await flush();
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.ok(saved && saved.captionLang === 'es', 'pref persisted: ' + JSON.stringify(saved));
    const pref = video.children.find((c) => c.default === true || 'default' in c.attrs);
    assert.strictEqual(pref.srclang, 'es', 'Spanish now the preferred native track');
    console.log('PASS 15 settings menu -> Captions pick persists + re-preferences');
  }

  // 17. Menu proxies YouTube's own lower-right controls: the
  // Miniplayer row clicks the real .ytp-miniplayer-button.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const mini = { clicks: 0, click() { this.clicks++; } };
    env.sandbox.document.querySelector = (sel) => (sel === '.ytp-miniplayer-button' ? mini : null);
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    const row = findAll(root, (c) => c.dataset && c.dataset.action === 'miniplayer')[0];
    assert.ok(row, 'Miniplayer row present when the button exists');
    row.click();
    assert.strictEqual(mini.clicks, 1, 'real YouTube miniplayer button clicked');
    console.log('PASS 17 menu row proxies the real YouTube button');
  }

  // 18. Centre cluster: tap shows it; play toggles; skips seek ±10s.
  {
    const video = makeVideo();
    video.currentTime = 50; video.duration = 200; video.paused = true;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const center = root.children[0];
    const tapHandlers = env.player._ls.click || [];
    tapHandlers[tapHandlers.length - 1]({ target: { closest: () => null }, stopPropagation() {}, preventDefault() {} });
    assert.strictEqual(center.style.visibility, 'visible', 'tap shows the centre cluster');
    findAll(root, (c) => c.dataset && c.dataset.act === 'play')[0].click();
    assert.strictEqual(video.paused, false, 'centre button plays');
    findAll(root, (c) => c.dataset && c.dataset.act === 'back')[0].click();
    assert.strictEqual(video.currentTime, 40, 'skip back 10s');
    findAll(root, (c) => c.dataset && c.dataset.act === 'fwd')[0].click();
    assert.strictEqual(video.currentTime, 50, 'skip forward 10s');
    console.log('PASS 18 centre cluster: play + ±10s skips');
  }

  // 19. Apple-style scrub: drag seeks live, pauses while scrubbing,
  // resumes on release.
  {
    const video = makeVideo();
    video.duration = 100; video.currentTime = 0; video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const scrub = findAll(root, (c) => c.dataset && c.dataset.act === 'scrub')[0];
    assert.ok(scrub, 'scrub track present');
    scrub._ls.pointerdown[0]({ clientX: 50, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(video.currentTime, 25, 'pointerdown seeks to 25%');
    assert.strictEqual(video.paused, true, 'playback pauses while scrubbing');
    (env.listeners.pointermove || []).forEach((fn) => fn({ clientX: 150 }));
    // v2.5: mid-drag seeks are throttled (~90ms) but the bar follows
    // the finger optimistically, with the time bubble showing the
    // target; the exact seek lands on release.
    const AUI19 = env.sandbox.window.__ytnfAUI;
    assert.strictEqual(AUI19.scrubFill.style.width, '75.00%', 'bar follows the finger mid-drag');
    assert.ok(AUI19.scrubBubble.textContent.includes('1:15'), 'bubble shows target time: ' + AUI19.scrubBubble.textContent);
    (env.listeners.pointerup || []).forEach((fn) => fn({}));
    assert.strictEqual(video.currentTime, 75, 'release lands the exact seek at 75%');
    assert.strictEqual(video.paused, false, 'release resumes playback');
    console.log('PASS 19 drag scrubbing seeks live and resumes');
  }

  // 20. SponsorBlock: when its player button is in the DOM, the menu
  // gets a SponsorBlock row that clicks it.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const sbBtn = { clicks: 0, click() { this.clicks++; } };
    const sbImg = { id: 'sbSkipIconControlBarImage', className: '', closest: () => sbBtn };
    env.sandbox.document.querySelector = (sel) => (sel === '#sbSkipIconControlBarImage' ? sbImg : null);
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    const row = findAll(root, (c) => c.dataset && c.dataset.action === 'sponsorblock')[0];
    assert.ok(row, 'SponsorBlock row present when detected');
    row.click();
    assert.strictEqual(sbBtn.clicks, 1, 'SponsorBlock button clicked through the menu');
    console.log('PASS 20 SponsorBlock row appears when installed and proxies its button');
  }

  // 16. Reskin guard (v1.3.0): player.css is paint-only — glass +
  // accent present, and NOTHING that hides/removes a YouTube control.
  {
    const rawCss = fs.readFileSync(__dirname + '/../player.css', 'utf8');
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ''); // rules only, not comments
    assert.ok(css.includes('backdrop-filter'), 'glass blur present');
    assert.ok(css.includes('#0A84FF'), 'system blue accent present');
    assert.ok(css.includes('.ytp-played'), 'progress bar restyled');
    assert.ok(css.includes('.ytp-panel'), 'menus restyled');
    for (const banned of ['display:none', 'display: none', 'visibility:hidden',
      'visibility: hidden', 'opacity:0;', 'opacity: 0;', 'opacity:0}',
      'opacity: 0}', 'pointer-events:none', 'pointer-events: none']) {
      assert.ok(!css.includes(banned), 'paint-only rule violated: ' + banned);
    }
    const mf = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
    assert.ok(mf.content_scripts[0].css.includes('player.css'), 'manifest loads player.css');
    assert.strictEqual(mf.version, '2.10.0');
    console.log('PASS 16 reskin is paint-only, no YouTube control hidden or removed');
  }

  // 21. v2.1.0: SVG settings icon, wider skip spacing, lighter
  // glass, and the Quality page falls back to the full ladder when
  // the player API returns no levels.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const gear = findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0];
    assert.ok(String(gear.innerHTML || '').includes('<svg'), 'settings button uses an SVG gear icon');
    const center = root.children[0];
    assert.ok(String(center.style.cssText).includes('gap:56px'), 'skip buttons spaced at 56px');
    const bottom = root.children[1];
    assert.ok(String(bottom.style.cssText).includes('rgba(28,28,30,.28)'), 'glass cranked to .28 alpha');
    gear.click();
    findAll(root, (c) => c.dataset && c.dataset.page === 'quality')[0].click();
    const picks = findAll(root, (c) => c.dataset && String(c.dataset.pick || '').startsWith('quality:'));
    assert.ok(picks.some((p) => p.dataset.pick === 'quality:hd1080'), 'fallback ladder offers 1080p');
    assert.ok(picks.some((p) => p.dataset.pick === 'quality:hd720'), 'fallback ladder offers 720p');
    assert.ok(picks.length >= 8, 'full ladder present (Auto + 8): ' + picks.length);
    console.log('PASS 21 v2.1.0 icon/spacing/glass + quality fallback ladder');
  }

  // 22. Tap rule (v2.1.0): a tap on the video toggles ONLY the UI —
  // the event is stopped in capture so YouTube never click-pauses.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const center = root.children[0];
    const capClicks = env.listeners.click || [];
    const tapHandler = capClicks[capClicks.length - 1];
    const videoTarget = {
      closest(sel) {
        if (sel.includes('#ytnf-apple')) return null;
        if (sel.includes('#movie_player')) return {};
        if (sel.includes('html5-video-container') || sel.includes('video')) return {};
        return null;
      },
    };
    const ev = {
      target: videoTarget, stopped: false, prevented: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    tapHandler(ev);
    assert.strictEqual(ev.stopped, true, 'tap stopped before YouTube handlers (no click-pause)');
    assert.strictEqual(ev.__ytnfTap, true, 'tap marked handled');
    assert.strictEqual(center.style.visibility, 'visible', 'tap brought the UI up');
    assert.strictEqual(video.paused, false, 'video kept playing');
    const ev2 = { target: videoTarget, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {}, stopImmediatePropagation() {} };
    tapHandler(ev2);
    assert.strictEqual(center.style.visibility, 'visible',
      'immediate second tap keeps the UI up (anti-race guard)');
    console.log('PASS 22 tap toggles UI only, never pauses');
  }

  // 23. v2.1.1 proxy firing: rows dispatch the full pointer/mouse
  // sequence (not a bare .click()) and unhide YouTube's chrome for
  // the duration of the proxied action.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.sandbox.MouseEvent = class { constructor(type, opts) { this.type = type; this.opts = opts; } };
    const mini = {
      events: [], clicks: 0,
      dispatchEvent(ev) { this.events.push(ev.type); return true; },
      click() { this.clicks++; },
    };
    env.sandbox.document.querySelector = (sel) => (sel === '.ytp-miniplayer-button' ? mini : null);
    assert.strictEqual(env.player._classes.has('ytnf-on'), true, 'chrome hidden while overlay runs');
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    const row = findAll(root, (c) => c.dataset && c.dataset.action === 'miniplayer')[0];
    assert.ok(row, 'Miniplayer row present');
    row.click();
    assert.deepStrictEqual(mini.events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
      'full event sequence fired: ' + mini.events.join(','));
    assert.strictEqual(mini.clicks, 0, 'no bare .click() fallback when dispatch works');
    assert.strictEqual(env.player._classes.has('ytnf-on'), false, 'chrome unhidden for the proxied action');
    console.log('PASS 23 proxy rows fire full event sequence + unhide chrome');
  }

  // 24. Minimum-up-time model (v2.1.2): shownAt is stamped, a hide
  // timer is armed, a tap dismisses only once the UI has been up
  // a moment, and hover brings it back.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    assert.ok(AUI, 'debug handle exposed');
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const center = root.children[0];
    const capClicks = env.listeners.click || [];
    const tapHandler = capClicks[capClicks.length - 1];
    const videoTarget = {
      closest(sel) {
        if (sel.includes('#ytnf-apple')) return null;
        if (sel.includes('#movie_player')) return {};
        if (sel.includes('html5-video-container') || sel.includes('video')) return {};
        return null;
      },
    };
    const mkEv = () => ({ target: videoTarget, stopPropagation() {}, preventDefault() {}, stopImmediatePropagation() {} });
    tapHandler(mkEv());
    assert.strictEqual(AUI.visible, true, 'UI up after tap');
    assert.ok(AUI.shownAt > 0, 'shownAt stamped');
    assert.ok(AUI.hideTimer !== null && AUI.hideTimer !== undefined, 'auto-hide timer armed');
    AUI.shownAt = Date.now() - 10000; // UI has been up well past the guard window
    tapHandler(mkEv());
    assert.strictEqual(AUI.visible, false, 'tap dismisses once the UI has been up a while');
    assert.strictEqual(center.style.visibility, 'hidden');
    const mm = env.player._ls.mousemove || [];
    mm[mm.length - 1]();
    assert.strictEqual(AUI.visible, true, 'hover brings the UI back up');
    console.log('PASS 24 minimum-up-time visibility model');
  }

  // 25. Miniplayer BAR button: proxies the real button with the
  // full event sequence when it exists.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.sandbox.MouseEvent = class { constructor(type, opts) { this.type = type; this.opts = opts; } };
    const mini = { events: [], dispatchEvent(ev) { this.events.push(ev.type); return true; }, click() { this.events.push('bare-click'); } };
    env.sandbox.document.querySelector = (sel) => (sel === '.ytp-miniplayer-button' ? mini : null);
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const order = findAll(root, (c) => c.dataset && c.dataset.act).map((c) => c.dataset.act);
    assert.ok(order.indexOf('fs') < order.indexOf('pip') &&
      order.indexOf('mini') === order.indexOf('menu') - 1,
      'v2.7 homes: FS before PiP (upper left), Miniplayer right before Settings (lower right): ' + order.join(','));
    findAll(root, (c) => c.dataset && c.dataset.act === 'mini')[0].click();
    assert.deepStrictEqual(mini.events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
      'miniplayer fired via full sequence: ' + mini.events.join(','));
    console.log('PASS 25 miniplayer bar button proxies the real button');
  }

  // 26. Miniplayer fallback sends the "i" hotkey when the button is
  // absent; PiP bar button toggles presentation mode on tap only.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.sandbox.KeyboardEvent = class { constructor(type, opts) { this.type = type; this.key = opts && opts.key; this.code = opts && opts.code; } };
    env.sandbox.document.querySelector = () => null; // no miniplayer button in DOM
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'mini')[0].click();
    const keys = env.sandbox.document.body._dispatched;
    assert.deepStrictEqual(keys.map((k) => k.type), ['keydown', 'keypress', 'keyup'],
      'i-key sequence dispatched: ' + keys.map((k) => k.type).join(','));
    assert.strictEqual(keys[0].key, 'i');
    findAll(root, (c) => c.dataset && c.dataset.act === 'pip')[0].click();
    assert.deepStrictEqual(video.pipCalls, ['picture-in-picture'], 'PiP starts on tap');
    assert.strictEqual(video.disablePictureInPicture, false, 'YouTube PiP block lifted for the explicit tap');
    findAll(root, (c) => c.dataset && c.dataset.act === 'pip')[0].click();
    assert.deepStrictEqual(video.pipCalls, ['picture-in-picture', 'inline'], 'second tap exits PiP');
    console.log('PASS 26 miniplayer i-key fallback + manual PiP toggle');
  }

  // 27. Compact layout: at miniplayer width the cluster shrinks and
  // the settings/miniplayer buttons + remaining time drop out.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const play = findAll(root, (c) => c.dataset && c.dataset.act === 'play')[0];
    const gear = findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0];
    env.player._w = 360;
    AUI.refreshLayout();
    assert.strictEqual(AUI.compact, true, 'compact at 360px wide');
    assert.strictEqual(play.style.width, '56px', 'centre play shrinks');
    assert.strictEqual(root.children[0].style.gap, '18px', 'cluster tightens');
    assert.strictEqual(gear.style.display, 'none', 'settings button hidden in miniplayer');
    env.player._w = 1024;
    AUI.refreshLayout();
    assert.strictEqual(AUI.compact, false, 'full layout restored');
    assert.strictEqual(play.style.width, '78px');
    assert.strictEqual(gear.style.display, '');
    console.log('PASS 27 miniplayer compact layout');
  }

  // 28. Queue rule: at video end, the queue plays first (and the
  // played item is consumed + persisted).
  {
    const video = makeVideo();
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { quality: 'auto', speed: 1, captionLang: null, queue: [{ id: 'next1', title: 'Next One' }], autoplayNext: true },
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    (video.listeners.ended || []).forEach((fn) => fn());
    assert.strictEqual(env.sandbox.location.href, 'https://www.youtube.com/watch?v=next1',
      'advanced to the queued video: ' + env.sandbox.location.href);
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.ok(saved && Array.isArray(saved.queue) && saved.queue.length === 0, 'queue consumed + persisted');
    console.log('PASS 28 queue plays first at video end');
  }

  // 29. Queue page: Up Next entries can be added; the autoplay
  // toggle flips the stored pref (and gates Up Next only).
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const fakeAnchor = {
      getAttribute: (k) => (k === 'href' ? '/watch?v=up42abcd&list=WL' : (k === 'title' ? 'Up Next Vid' : null)),
      closest: () => null,
    };
    env.sandbox.document.querySelectorAll = (sel) =>
      (String(sel).includes('ytd-compact-video-renderer') ? [fakeAnchor] : []);
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.page === 'queue')[0].click();
    const add = findAll(root, (c) => c.dataset && c.dataset.qadd === 'up42abcd')[0];
    assert.ok(add, 'Up Next entry offered on the Queue page');
    add.click();
    let saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.ok(saved.queue.some((q) => q.id === 'up42abcd'), 'video added to the stored queue');
    findAll(root, (c) => c.dataset && c.dataset.pick === 'autoplay')[0].click();
    saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved.autoplayNext, false, 'autoplay toggle persisted off');
    console.log('PASS 29 queue page: add from Up Next + autoplay toggle');
  }

  // 30. Auto-PiP on scroll: fires once when the player drops below
  // half visible while playing; won't refight a manual PiP close;
  // never fires while paused.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    AUI.onPlayerVisibility(0.3);
    assert.deepStrictEqual(video.pipCalls, ['picture-in-picture'], 'PiP fired at <50% visible');
    AUI.onPlayerVisibility(0.2);
    assert.strictEqual(video.pipCalls.length, 1, 'no repeat while still scrolled away');
    video.webkitPresentationMode = 'inline'; // user closed the PiP manually
    AUI.onPlayerVisibility(0.2);
    assert.strictEqual(video.pipCalls.length, 1, 'manual close is respected (not re-armed)');
    AUI.onPlayerVisibility(0.9); // player back in view -> re-arm
    AUI.onPlayerVisibility(0.3);
    assert.strictEqual(video.pipCalls.length, 2, 'fires again after returning to view and scrolling away');
    video.webkitPresentationMode = 'inline';
    video.paused = true;
    AUI.onPlayerVisibility(0.9);
    AUI.onPlayerVisibility(0.3);
    assert.strictEqual(video.pipCalls.length, 2, 'never fires while paused');
    console.log('PASS 30 auto-PiP on scroll: fire once, respect manual close, paused-safe');
  }

  // 31. Auto-PiP respects the stored off preference.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { quality: 'auto', speed: 1, captionLang: null, autoPipScroll: false },
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.sandbox.window.__ytnfAUI.onPlayerVisibility(0.3);
    assert.deepStrictEqual(video.pipCalls, [], 'no PiP when the preference is off');
    console.log('PASS 31 auto-PiP off via preference');
  }

  // 32. THE v2.5 BUG: YouTube swaps the <video> element when a new
  // video is picked from the current one. The overlay must adopt
  // the new element — pause, state and readouts follow it, and the
  // detached old element is never touched again.
  {
    const video1 = makeVideo();
    video1.paused = false;
    const env = makeEnv({ video: video1, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const playBtn = findAll(root, (c) => c.dataset && c.dataset.act === 'play')[0];
    playBtn.click();
    assert.strictEqual(video1.paused, true, 'pause works on the first video');
    playBtn.click();
    assert.strictEqual(video1.paused, false, 'resume works on the first video');

    const video2 = makeVideo();
    video2.paused = false; video2.currentTime = 30; video2.duration = 300;
    env.swapVideo(video2);
    AUI.syncVideo(); // the same entry point the observer + 1s poll use
    playBtn.click();
    assert.strictEqual(video2.paused, true, 'pause hits the NEW element after a swap');
    assert.strictEqual(video1.paused, false, 'the detached element is untouched');
    assert.strictEqual(playBtn.textContent, '▶︎', 'icon reflects the new element (paused)');
    video2.currentTime = 150;
    (video2.listeners.timeupdate || []).forEach((fn) => fn());
    assert.strictEqual(AUI.tElapsed.textContent, '2:30', 'readouts follow the new element');
    video2.paused = false;
    (video2.listeners.play || []).forEach((fn) => fn());
    assert.strictEqual(playBtn.textContent, '❙❙', 'play state syncs from the new element');
    console.log('PASS 32 video element swap: pause + transport adopt the new element');
  }

  // 33. A hide timer armed while playing must not fire after the
  // video has paused — it re-validates at fire time.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const tapHandlers = env.player._ls.click || [];
    tapHandlers[tapHandlers.length - 1]({ target: { closest: () => null }, stopPropagation() {}, preventDefault() {} });
    assert.strictEqual(AUI.visible, true, 'UI up after tap');
    video.paused = true; // state changes without the event reaching us
    await flush(); // the armed timer fires here
    assert.strictEqual(AUI.visible, true, 'stale timer does not hide the UI while paused');
    video.paused = false;
    (video.listeners.play || []).forEach((fn) => fn());
    await flush();
    assert.strictEqual(AUI.visible, false, 'timer still hides the UI while playing');
    console.log('PASS 33 hide timer re-validates at fire time');
  }

  // 34. The overlay must build (and pause must work) even when the
  // player response never matches the new video — captions wait,
  // controls don't.
  {
    const video = makeVideo();
    video.paused = false;
    const pr = captionPR([ytTrack('en', '', 'English')]);
    pr.videoDetails.videoId = 'someone-elses-video';
    const env = makeEnv({ video, playerResponse: pr });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    assert.ok(root, 'overlay built despite the lagging player response');
    const playBtn = findAll(root, (c) => c.dataset && c.dataset.act === 'play')[0];
    playBtn.click();
    assert.strictEqual(video.paused, true, 'pause works with no caption response yet');
    console.log('PASS 34 UI builds before the player response catches up');
  }

  // 35. v2.7 layout: the pill arrangement is the layout in BOTH
  // modes (upper left FS/PiP/AirPlay, upper right volume, lower
  // right Miniplayer/Settings); the toggle switches only glass.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    assert.strictEqual(AUI.mode, 'classic', 'classic glass by default');
    assert.deepStrictEqual(AUI.topPillL.children.map((c) => c.dataset.act),
      ['fs', 'pip', 'airplay'], 'upper left: Fullscreen, PiP, AirPlay');
    assert.deepStrictEqual(AUI.gearPill.children.map((c) => c.dataset.act),
      ['mini', 'menu'], 'lower right: Miniplayer, Settings');
    assert.ok(!findAll(AUI.bottom, (c) => c.dataset && ['fs', 'pip', 'airplay', 'mini', 'menu'].includes(c.dataset.act))[0],
      'the time bar carries no buttons');
    assert.strictEqual(AUI.topBar.style.display, 'flex', 'top bar shown in classic too');
    assert.strictEqual(AUI.gearPill.style.bottom, '92px', 'lower-right pill clears the classic bar');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.pick === 'liquid')[0].click();
    assert.strictEqual(AUI.mode, 'liquid', 'liquid glass on');
    assert.strictEqual(AUI.bottom.style.borderRadius, '999px', 'liquid time bar is a slim pill');
    assert.strictEqual(AUI.gearPill.style.bottom, '82px', 'lower-right pill clears the liquid bar');
    assert.deepStrictEqual(AUI.topPillL.children.map((c) => c.dataset.act),
      ['fs', 'pip', 'airplay'], 'homes unchanged by the glass toggle');
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved.liquidGlass, true, 'preference persisted');
    console.log('PASS 35 v2.7 layout: pills in both modes, toggle switches glass only');
  }

  // 36. Volume pill + AirPlay button drive the live element.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    (video.listeners.volumechange || []).forEach((fn) => fn());
    assert.strictEqual(AUI.volFill.style.width, '80%', 'volume fill mirrors the element');
    AUI.volBtn.click();
    assert.strictEqual(video.muted, true, 'speaker button mutes');
    AUI.volBtn.click();
    assert.strictEqual(video.muted, false, 'speaker button unmutes');
    AUI.volTrack._ls.pointerdown[0]({ clientX: 100, preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(video.volume, 0.5, 'volume drag sets the element volume');
    AUI.airplayBtn.click();
    assert.strictEqual(video.pickerCalls, 1, 'AirPlay button opens the playback target picker');
    console.log('PASS 36 volume pill + AirPlay drive the live element');
  }

  // 37. Toggling the glass off keeps the v2.7 layout; only the
  // glass + bar shape revert to classic.
  {
    const video = makeVideo();
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { quality: 'auto', speed: 1, captionLang: null, liquidGlass: true },
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    assert.strictEqual(AUI.mode, 'liquid', 'stored preference applies liquid at build');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.pick === 'liquid')[0].click();
    assert.strictEqual(AUI.mode, 'classic', 'back to classic glass');
    assert.strictEqual(AUI.topBar.style.display, 'flex', 'top bar stays — layout is permanent');
    assert.strictEqual(AUI.bottom.style.borderRadius, '18px', 'classic bar shape restored');
    assert.deepStrictEqual(AUI.gearPill.children.map((c) => c.dataset.act),
      ['mini', 'menu'], 'lower-right pill keeps Miniplayer + Settings');
    console.log('PASS 37 glass off: layout stays, classic glass restored');
  }

  // 38. Tap-to-pause (v2.8): the whole gesture is swallowed for
  // ANY non-interactive player target (touch layers included);
  // the settings toggle restores stock tap-to-pause.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    // A touch-feedback-style layer: inside the player, but NOT the
    // video / container / bezel the v2.1 scope required.
    const touchLayer = {
      closest(sel) {
        if (sel.includes('#ytnf-apple')) return null;
        if (sel.includes('#movie_player')) return {};
        return null;
      },
    };
    const mkEv = (t) => ({
      target: t, stopped: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() {},
      stopImmediatePropagation() { this.stopped = true; },
    });
    const pd = (env.listeners.pointerdown || []).slice(-1)[0];
    const ck = (env.listeners.click || []).slice(-1)[0];
    const evPd = mkEv(touchLayer); pd(evPd);
    assert.strictEqual(evPd.stopped, true, 'pointerdown on the touch layer is swallowed');
    const evCk = mkEv(touchLayer); ck(evCk);
    assert.strictEqual(evCk.stopped, true, 'click on the touch layer is swallowed (no pause)');
    assert.strictEqual(AUI.visible, true, 'the tap still toggles our UI');
    // Toggle stock behaviour back on from the settings menu.
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.pick === 'tap')[0].click();
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved.tapToPause, true, 'tap-to-pause preference persisted');
    const evPd2 = mkEv(touchLayer); pd(evPd2);
    assert.strictEqual(evPd2.stopped, false, 'with the toggle on, pointerdown flows through');
    const evCk2 = mkEv(touchLayer); ck(evCk2);
    assert.strictEqual(evCk2.stopped, false, 'with the toggle on, the click reaches YouTube (stock pause)');
    assert.strictEqual(evCk2.__ytnfTap, true, 'tap still marked so the UI toggles exactly once');
    console.log('PASS 38 tap-to-pause: gesture swallowed by default, toggle restores stock');
  }

  // 39. Panel behaviour (v2.9): the lower-right pill hides while
  // the menu is up, a tap outside dismisses the menu (chrome
  // stays up), taps inside the panel don't, and the panel shields
  // touch gestures so a swipe-down can't drag the player into
  // the miniplayer.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    assert.ok((AUI.panel._ls.touchmove || []).length >= 1 &&
      (AUI.panel._ls.touchstart || []).length >= 1, 'panel shields touch gestures');
    assert.ok(String(AUI.panel.style.cssText).includes('touch-action:pan-y'), 'panel keeps its own scrolling');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    assert.strictEqual(AUI.panelOpen, true, 'menu open');
    assert.strictEqual(AUI.gearPill.style.visibility, 'hidden', 'lower-right pill hidden while the menu is up');
    const ck = (env.listeners.click || []).slice(-1)[0];
    const videoTap = {
      closest(sel) {
        if (sel.includes('#movie_player')) return {};
        return null;
      },
    };
    const mkEv = (t) => ({
      target: t, stopped: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() {},
      stopImmediatePropagation() { this.stopped = true; },
    });
    ck(mkEv(videoTap));
    assert.strictEqual(AUI.panelOpen, false, 'tap elsewhere in the player dismisses the menu');
    assert.strictEqual(AUI.visible, true, 'the dismissal tap leaves the chrome up');
    assert.strictEqual(AUI.gearPill.style.visibility, 'visible', 'lower-right pill is back');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    assert.strictEqual(AUI.panelOpen, true, 'menu reopened');
    const inPanel = { closest: (sel) => (sel.includes('.ytnf-panel') ? {} : null) };
    ck(mkEv(inPanel));
    assert.strictEqual(AUI.panelOpen, true, 'taps inside the panel do not dismiss it');
    console.log('PASS 39 panel: pill hides, outside tap dismisses, gestures shielded');
  }

  // 40. Queue scrape (v2.9): the queue panel renderers and the
  // lockup view-model cards are sources too, not just the classic
  // compact renderers.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const panelAnchor = {
      getAttribute: (k) => (k === 'href' ? '/watch?v=queue99x' : null),
      closest: (sel) => (String(sel).includes('ytd-playlist-panel-video-renderer')
        ? { querySelector: () => ({ getAttribute: () => 'Queued Panel Vid', textContent: 'Queued Panel Vid' }) }
        : null),
      textContent: '',
    };
    const lockupAnchor = {
      getAttribute: (k) => (k === 'href' ? '/watch?v=lock88y' : (k === 'title' ? 'Lockup Vid' : null)),
      closest: () => null,
      textContent: '',
    };
    env.sandbox.document.querySelectorAll = (sel) => {
      const q = String(sel);
      if (q.includes('ytd-playlist-panel-video-renderer') && q.includes('a[href')) return [panelAnchor];
      if (q.includes('yt-lockup-view-model')) return [lockupAnchor];
      return [];
    };
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.page === 'queue')[0].click();
    const addPanel = findAll(root, (c) => c.dataset && c.dataset.qadd === 'queue99x')[0];
    const addLockup = findAll(root, (c) => c.dataset && c.dataset.qadd === 'lock88y')[0];
    assert.ok(addPanel, 'queue-panel video offered on the Queue page');
    assert.ok(addLockup, 'lockup-card video offered on the Queue page');
    addPanel.click();
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.ok(saved.queue.some((q) => q.id === 'queue99x' && q.title === 'Queued Panel Vid'),
      'queue-panel video added with its real title');
    console.log('PASS 40 queue scrape: playlist-panel + lockup sources');
  }

  // 41. Resume-after-exit (v2.9): closing PiP or exiting native
  // fullscreen resumes a video that was playing; the toggle
  // turns the behaviour off.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const fire = (type) => (video.listeners[type] || []).forEach((fn) => fn());
    video.paused = false;
    fire('timeupdate'); // establishes "was playing"
    video.webkitPresentationMode = 'picture-in-picture';
    fire('webkitpresentationmodechanged');
    video.paused = true; // the system pauses as PiP closes
    video.webkitPresentationMode = 'inline';
    fire('webkitpresentationmodechanged');
    assert.strictEqual(video.paused, false, 'closing PiP resumes playback');
    video.paused = true; // the system pauses as fullscreen exits
    fire('webkitendfullscreen');
    assert.strictEqual(video.paused, false, 'exiting fullscreen resumes playback');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.pick === 'resume')[0].click();
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved.resumeOnExit, false, 'resume preference persisted off');
    video.paused = true;
    fire('webkitendfullscreen');
    assert.strictEqual(video.paused, true, 'with the toggle off, the exit pause stands (stock)');
    console.log('PASS 41 resume-after-exit: PiP/fullscreen exits resume, toggle disables');
  }

  const sleep = (ms) => new Promise((r) => RealSetTimeout(r, ms));

  // 42. Miniplayer-restore unpause (v2.10): if the element our
  // controls resolve to is a held leftover, the play button
  // escalates — fresh re-resolve, then YouTube's own playVideo()
  // API (the channel the miniplayer's unpause uses). And when
  // the player query starts returning the real element again,
  // syncVideo adopts it immediately.
  {
    const stale = makeVideo();
    stale.paused = true;
    stale.play = function () { this.playCalls = (this.playCalls || 0) + 1; /* detached: never unpauses */ };
    const env = makeEnv({ video: stale, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    const fresh = makeVideo();
    fresh.paused = true; // paused in the miniplayer
    env.player.querySelector = () => stale; // scoped query still hits the leftover
    env.player.playVideo = function () { fresh.paused = false; };
    findAll(root, (c) => c.dataset && c.dataset.act === 'play')[0].click();
    await sleep(260);
    assert.strictEqual(fresh.paused, false, 'escalation unpaused the real video via the player API');
    // Restore: the player query now returns the real element.
    env.player.querySelector = () => fresh;
    fresh.paused = true;
    findAll(root, (c) => c.dataset && c.dataset.act === 'play')[0].click();
    assert.strictEqual(fresh.paused, false, 'after restore the play button drives the live element directly');
    assert.strictEqual(AUI.syncVideo(), fresh, 'syncVideo adopted the fresh element');
    console.log('PASS 42 miniplayer-restore unpause: fresh resolve + API escalation');
  }

  // 43. Motion (v2.10): chrome fades with a drift and a delayed
  // visibility flip; the panel rises in and fades out before
  // leaving layout; icons are the new Apple PiP + thick-stroke
  // fullscreen SVGs.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    assert.ok(AUI.fsBtn.innerHTML.includes('stroke-width="2.3"'), 'fullscreen icon has the thicker strokes');
    assert.ok(AUI.pipBtn.innerHTML.includes('M5.6 8.2'), 'PiP icon is Apple pip.enter (arrow into the window)');
    const ck = (env.listeners.click || []).slice(-1)[0];
    const videoTap = { closest: (sel) => (sel.includes('#movie_player') ? {} : null) };
    const mkEv = (t) => ({
      target: t, stopped: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() {},
      stopImmediatePropagation() { this.stopped = true; },
    });
    ck(mkEv(videoTap));
    assert.strictEqual(AUI.visible, true, 'chrome shown');
    assert.strictEqual(AUI.bottom.style.transform, '', 'shown chrome has no drift offset');
    assert.ok(AUI.bottom.style.transition.includes('visibility 0s'), 'show flips visibility immediately');
    AUI.shownAt = Date.now() - 10000;
    AUI.lastActivity = Date.now() - 10000;
    ck(mkEv(videoTap));
    assert.strictEqual(AUI.visible, false, 'chrome hidden');
    assert.strictEqual(AUI.bottom.style.opacity, '0', 'hidden chrome faded out');
    assert.strictEqual(AUI.bottom.style.transform, 'translateY(10px)', 'bottom bar drifts down as it hides');
    assert.ok(AUI.bottom.style.transition.includes('linear'), 'hide delays the visibility flip until the fade ends');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    assert.strictEqual(AUI.panel.style.display, 'block', 'panel in layout on open');
    await flush(); await flush();
    assert.strictEqual(AUI.panel.style.opacity, '1', 'panel faded in');
    assert.strictEqual(AUI.panel.style.transform, 'translateY(0) scale(1)', 'panel settled into place');
    ck(mkEv(videoTap));
    assert.strictEqual(AUI.panelOpen, false, 'panel dismissed');
    assert.strictEqual(AUI.panel.style.opacity, '0', 'panel fading out');
    assert.strictEqual(AUI.panel.style.pointerEvents, 'none', 'panel stops eating taps while it fades');
    await sleep(260);
    assert.strictEqual(AUI.panel.style.display, 'none', 'panel leaves layout after the fade');
    console.log('PASS 43 motion: chrome fade/drift, panel rise + fade, new icons');
  }

  // 44. Theater Mode (v2.10): the proxied size-button click is
  // verified; if the state didn't flip, YouTube's 't' shortcut
  // fires as the fallback channel. If the click works, no key.
  {
    const mkTheaterEnv = async (clickWorks) => {
      const video = makeVideo();
      const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
      env.sandbox.fetch = okFetch(env);
      vm.runInContext(src, env.sandbox);
      await flush();
      const state = { on: false };
      const sizeBtn = {
        events: [],
        dispatchEvent(ev) { this.events.push(ev.type); if (ev.type === 'click' && clickWorks) state.on = true; return true; },
        click() { this.events.push('bare-click'); if (clickWorks) state.on = true; },
      };
      const flexy = { hasAttribute: (a) => (a === 'theater' ? state.on : false) };
      env.sandbox.document.querySelector = (sel) =>
        (sel === '.ytp-size-button' ? sizeBtn : (sel === 'ytd-watch-flexy' ? flexy : null));
      env.sandbox.KeyboardEvent = class { constructor(type, opts) { this.type = type; this.opts = opts; } };
      return { env, state, sizeBtn };
    };
    // Case A: the button click does nothing -> 't' fallback fires.
    {
      const { env } = await mkTheaterEnv(false);
      const root = env.player.children.find((c) => c.id === 'ytnf-apple');
      findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
      const row = findAll(root, (c) => c.dataset && c.dataset.action === 'theater')[0];
      assert.ok(row, 'theater row offered');
      row.click();
      await sleep(320);
      const keys = (env.sandbox.document.body._dispatched || []).filter((e) => e.type === 'keydown');
      assert.ok(keys.some((e) => e.opts && e.opts.key === 't'), "'t' shortcut fired after the dead click");
      console.log('PASS 44a theater: dead button click falls back to the t shortcut');
    }
    // Case B: the click flips theater -> no fallback key.
    {
      const { env } = await mkTheaterEnv(true);
      const root = env.player.children.find((c) => c.id === 'ytnf-apple');
      findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
      findAll(root, (c) => c.dataset && c.dataset.action === 'theater')[0].click();
      await sleep(320);
      const keys = (env.sandbox.document.body._dispatched || []).filter((e) => e.type === 'keydown');
      assert.ok(!keys.some((e) => e.opts && e.opts.key === 't'), 'no fallback key when the click works');
      console.log('PASS 44b theater: working click needs no fallback');
    }
  }

  console.log('ALL 44 TESTS PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
