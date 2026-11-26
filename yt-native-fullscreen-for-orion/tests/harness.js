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
    // Caption fetches must all be WebVTT (other features may fetch
    // their own endpoints — e.g. SponsorBlock, v2.14).
    const capFetches = env.fetched.filter((u) => u.includes('timedtext'));
    assert.ok(capFetches.length >= 3, 'caption tracks were fetched');
    assert.ok(capFetches.every((u) => u.includes('fmt=vtt') && !u.includes('srv3')));
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
    assert.ok(AUI19.scrubBubbleText.textContent.includes('1:15'), 'bubble shows target time: ' + AUI19.scrubBubbleText.textContent);
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
    assert.strictEqual(mf.version, '2.15.0');
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

  // 28. Video end (v2.15): our custom queue is gone — with
  // autoplay ON we never navigate (YouTube's own queue / Up Next
  // proceeds); with autoplay OFF playback stops at the end.
  {
    const video = makeVideo();
    const env = makeEnv({
      video,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { autoplayNext: true },
    });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const before = env.sandbox.location.href;
    (video.listeners.ended || []).forEach((fn) => fn());
    assert.strictEqual(env.sandbox.location.href, before, 'no self-navigation at end (autoplay on)');
    const video2 = makeVideo();
    video2.paused = false;
    const env2 = makeEnv({
      video: video2,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { autoplayNext: false },
    });
    env2.sandbox.fetch = okFetch(env2);
    vm.runInContext(src, env2.sandbox);
    await flush();
    (video2.listeners.ended || []).forEach((fn) => fn());
    assert.strictEqual(video2.paused, true, 'autoplay off stops at the end');
    console.log('PASS 28 video end: YouTube handles next; autoplay off stops');
  }

  // 29. Settings (v2.15): no Queue page anymore; the Autoplay
  // Up Next toggle lives on the main page and persists.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    assert.strictEqual(findAll(root, (c) => c.dataset && c.dataset.page === 'queue').length, 0,
      'no Queue row in Settings');
    findAll(root, (c) => c.dataset && c.dataset.pick === 'autoplay')[0].click();
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved.autoplayNext, false, 'autoplay toggle persisted off from the main page');
    console.log('PASS 29 settings: queue page removed, autoplay on main page');
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
    // Fire EVERY registered handler, like a real event travelling
    // through all capture listeners (v2.11 added a second
    // pointerdown listener for queue drags).
    const pd = (ev) => (env.listeners.pointerdown || []).forEach((fn) => fn(ev));
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
    assert.strictEqual(AUI.center.style.transform, 'translateY(-50%)',
      'centre cluster keeps its centring transform when shown (v2.11 regression fix)');
    assert.ok(AUI.bottom.style.transition.includes('visibility 0s'), 'show flips visibility immediately');
    AUI.shownAt = Date.now() - 10000;
    AUI.lastActivity = Date.now() - 10000;
    ck(mkEv(videoTap));
    assert.strictEqual(AUI.visible, false, 'chrome hidden');
    assert.strictEqual(AUI.bottom.style.opacity, '0', 'hidden chrome faded out');
    assert.strictEqual(AUI.bottom.style.transform, 'translateY(10px)', 'bottom bar drifts down as it hides');
    assert.strictEqual(AUI.center.style.transform, 'translateY(-50%) scale(.93)',
      'centre cluster hides around its centre, not its corner');
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

  // 45. Centre tap (v2.11): with the UI hidden, a tap in the
  // centre of the video — where the play/pause button would be —
  // toggles playback and brings the UI up. Off-centre taps only
  // bring the UI up.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    assert.strictEqual(AUI.visible, false, 'UI starts hidden');
    const videoTap = { closest: (sel) => (sel.includes('#movie_player') ? {} : null) };
    const fireClick = (x, y) => {
      const ev = {
        target: videoTap, clientX: x, clientY: y, stopped: false,
        stopPropagation() { this.stopped = true; },
        preventDefault() {},
        stopImmediatePropagation() { this.stopped = true; },
      };
      (env.listeners.click || []).forEach((fn) => fn(ev));
      return ev;
    };
    // Player stub rect is 1024x576 at 0,0: (512,288) is centre.
    fireClick(512, 288);
    assert.strictEqual(video.paused, true, 'centre tap paused the playing video');
    assert.strictEqual(AUI.visible, true, 'centre tap brought the UI up');
    AUI.shownAt = Date.now() - 10000;
    AUI.lastActivity = Date.now() - 10000;
    fireClick(20, 288); // off-centre tap dismisses the UI
    assert.strictEqual(AUI.visible, false, 'UI hidden again');
    assert.strictEqual(video.paused, true, 'off-centre tap did not change playback');
    fireClick(20, 288); // off-centre with UI hidden: UI only
    assert.strictEqual(AUI.visible, true, 'off-centre tap showed the UI');
    assert.strictEqual(video.paused, true, 'off-centre tap did not unpause');
    AUI.shownAt = Date.now() - 10000;
    AUI.lastActivity = Date.now() - 10000;
    fireClick(20, 288);
    assert.strictEqual(AUI.visible, false, 'UI hidden once more');
    fireClick(512, 288); // centre tap unpauses too
    assert.strictEqual(video.paused, false, 'centre tap unpaused');
    console.log('PASS 45 centre tap toggles play/pause while the UI is hidden');
  }



  // 47. Below-the-player glass (v2.11): player.css covers the
  // Queue box + description and still obeys the paint-only rule.
  {
    const rawCss = fs.readFileSync(__dirname + '/../player.css', 'utf8');
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ''); // rules only, not comments (same as test 16)
    assert.ok(css.includes('ytd-playlist-panel-renderer'), 'queue box is glassed');
    assert.ok(css.includes('#description'), 'description is glassed');
    for (const bad of ['display:none', 'display: none', 'visibility:hidden', 'visibility: hidden', 'opacity:0;', 'opacity: 0;', 'pointer-events:none', 'pointer-events: none']) {
      assert.ok(!css.includes(bad), 'player.css stays paint-only (found ' + bad + ')');
    }
    console.log('PASS 47 player.css: description + queue glass, paint-only intact');
  }

  // 48. Queue panel touch drag (v2.15): the row lifts and rides
  // the finger, siblings shift out of the way, and on release
  // YouTube's reorder gets the synthetic drop at the target row.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.sandbox.Event = class { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } };
    const container = { children: [] };
    const mkItem = (idx) => {
      const el = {
        tagName: 'YTD-PLAYLIST-PANEL-VIDEO-RENDERER',
        _evs: [], _classes: new Set(), style: {}, parentNode: container,
        dispatchEvent(ev) { this._evs.push(ev.type); return true; },
        closest(sel) { return String(sel).includes('ytd-playlist-panel-video-renderer') ? this : null; },
        getBoundingClientRect: () => ({ left: 0, top: idx * 60, width: 300, height: 60 }),
      };
      el.classList = {
        add: (c) => el._classes.add(c),
        remove: (c) => el._classes.delete(c),
        contains: (c) => el._classes.has(c),
      };
      container.children.push(el);
      return el;
    };
    const itemA = mkItem(0);
    const itemB = mkItem(1);
    mkItem(2);
    const fire = (type, ev) => (env.listeners[type] || []).forEach((fn) => fn(ev));
    const base = { stopPropagation() {}, preventDefault() {} };
    fire('pointerdown', Object.assign({ target: itemA, clientX: 10, clientY: 10 }, base));
    fire('pointermove', Object.assign({ target: itemA, clientX: 10, clientY: 75 }, base));
    assert.ok(itemA._evs.includes('dragstart'), 'dragstart fired on the dragged item');
    assert.strictEqual(itemA.style.transform, 'translateY(65px)', 'row rides the finger');
    assert.ok(itemA._classes.has('ytnf-dragging'), 'dragged row lifted (class)');
    assert.strictEqual(itemB.style.transform, 'translateY(-60px)', 'sibling shifts out of the way');
    fire('pointerup', Object.assign({ target: itemA, clientX: 10, clientY: 75 }, base));
    assert.ok(itemB._evs.includes('drop'), 'drop fired on the target row');
    assert.ok(itemA._evs.includes('dragend'), 'dragend fired on the dragged item');
    assert.strictEqual(itemA.style.transform, '', 'transforms cleaned up');
    assert.ok(!itemA._classes.has('ytnf-dragging'), 'lift class removed');
    console.log('PASS 48 queue panel: visual touch drag + synthetic drop');
  }

  // 49. Below-player glass (v2.12): the description lives inside
  // ytd-watch-metadata's shadow root, unreachable from page CSS —
  // the glass style must be injected INTO the shadow roots, and
  // re-applying must not duplicate it.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const mkShadow = () => ({
      children: [],
      appendChild(c) { this.children.push(c); return c; },
      querySelector(sel) {
        if (String(sel).includes('data-ytnf-glass')) {
          return this.children.find((c) => c.__ytnfGlass) || null;
        }
        return null;
      },
    });
    const panelHost = { shadowRoot: mkShadow(), style: {} };
    const metaHost = { shadowRoot: mkShadow(), style: {} };
    const doc = env.sandbox.document;
    const origQS = doc.querySelector.bind(doc);
    doc.querySelector = (sel) => {
      if (sel === 'ytd-playlist-panel-renderer') return panelHost;
      if (sel === 'ytd-watch-metadata') return metaHost;
      return origQS(sel);
    };
    env.sandbox.window.__ytnfStyleBelow();
    assert.ok(panelHost.shadowRoot.children.some((c) => String(c.textContent || '').includes(':host')),
      'panel shadow glass injected');
    assert.ok(metaHost.shadowRoot.children.some((c) => String(c.textContent || '').includes('#description')),
      'description shadow glass injected');
    assert.strictEqual(panelHost.style.background, 'rgba(30,30,34,.94)', 'panel host inline glass set');
    env.sandbox.window.__ytnfStyleBelow();
    assert.strictEqual(panelHost.shadowRoot.children.length, 1, 'no duplicate panel style');
    assert.strictEqual(metaHost.shadowRoot.children.length, 1, 'no duplicate metadata style');
    console.log('PASS 49 below-player glass injected into shadow roots');
  }

  // 50. AirPlay active glow (v2.13): while playback is wireless,
  // the AirPlay glyph turns system blue with a halo, like the
  // native iOS player; it returns to white when wireless ends.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const fire = (type) => (video.listeners[type] || []).forEach((fn) => fn());
    assert.ok(AUI.airplayBtn, 'airplay button exists');
    assert.ok(!AUI.airplayBtn.innerHTML.includes('#0A84FF'), 'glyph starts white');
    video.webkitCurrentPlaybackTargetIsWireless = true;
    fire('webkitcurrentplaybacktargetiswirelesschanged');
    assert.ok(AUI.airplayBtn.innerHTML.includes('#0A84FF'), 'glyph turns blue while wireless');
    assert.ok(AUI.airplayBtn.innerHTML.includes('drop-shadow'), 'glyph glows while wireless');
    video.webkitCurrentPlaybackTargetIsWireless = false;
    fire('webkitcurrentplaybacktargetiswirelesschanged');
    assert.ok(!AUI.airplayBtn.innerHTML.includes('#0A84FF'), 'glyph returns to white');
    assert.ok(!AUI.airplayBtn.innerHTML.includes('drop-shadow'), 'glow clears');
    console.log('PASS 50 AirPlay glyph glows blue while wireless');
  }

  // 51. Sleep timer (v2.14 A): picking a duration arms a persisted
  // deadline; an expired deadline pauses playback; the
  // end-of-video mode stops instead of advancing the queue.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.page === 'sleep')[0].click();
    findAll(root, (c) => c.dataset && c.dataset.pick === 'sleep:10')[0].click();
    const saved = env.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved.sleepMinutes, 10, 'sleep minutes saved');
    assert.ok(Math.abs(saved.sleepDeadline - (Date.now() + 600000)) < 5000, 'deadline ~10 min out');

    // A deadline still ahead when the page loads fires on time.
    const video2 = makeVideo();
    video2.paused = false;
    const env2 = makeEnv({
      video: video2,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { sleepMinutes: 1, sleepDeadline: Date.now() + 400 },
    });
    env2.sandbox.fetch = okFetch(env2);
    vm.runInContext(src, env2.sandbox);
    await flush();
    // The harness stubs setInterval out, so drive the tick by hand
    // once the deadline has passed in real time.
    await new Promise((r) => setTimeout(r, 600));
    env2.sandbox.window.__ytnfSleepTick();
    assert.strictEqual(video2.paused, true, 'sleep timer fires and pauses playback');

    // A deadline that expired while the page was away is cleared
    // quietly — it must not pause a freshly opened video.
    const video2b = makeVideo();
    video2b.paused = false;
    const env2b = makeEnv({
      video: video2b,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { sleepMinutes: 10, sleepDeadline: Date.now() - 1000 },
    });
    env2b.sandbox.fetch = okFetch(env2b);
    vm.runInContext(src, env2b.sandbox);
    await flush();
    assert.strictEqual(video2b.paused, false, 'stale deadline does not pause a fresh video');
    const saved2b = env2b.storageSetCalls.map((c) => c.ytnf_prefs).filter(Boolean).pop();
    assert.strictEqual(saved2b.sleepDeadline, 0, 'stale deadline cleared');

    const video3 = makeVideo();
    const env3 = makeEnv({
      video: video3,
      playerResponse: captionPR([ytTrack('en', '', 'English')]),
      initialPrefs: { sleepMinutes: -1 },
    });
    env3.sandbox.fetch = okFetch(env3);
    vm.runInContext(src, env3.sandbox);
    await flush();
    (video3.listeners.ended || []).forEach((fn) => fn());
    assert.strictEqual(video3.paused, true, 'end-of-video sleep stops playback');
    console.log('PASS 51 sleep timer: arm, expire, end-of-video');
  }

  // 52. SponsorBlock (v2.14 B): segments load for the video and
  // timeupdate seeks past them; rewinding before a segment
  // re-arms it.
  {
    const video = makeVideo();
    const pr = captionPR([ytTrack('en', '', 'English')]);
    pr.videoDetails.shortDescription = ''; // videoId stays 'abc123' (the page's id)
    const env = makeEnv({ video, playerResponse: pr });
    const vtt = okFetch(env);
    env.sandbox.fetch = (url) => {
      if (String(url).includes('sponsor.ajay.app')) {
        return Promise.resolve({ ok: true, json: async () => ([{ segment: [10, 20], category: 'sponsor', UUID: 'u1' }]) });
      }
      return vtt(url);
    };
    vm.runInContext(src, env.sandbox);
    await flush();
    const SB = env.sandbox.window.__ytnfSB();
    assert.strictEqual(SB.segments.length, 1, 'segment loaded');
    video.paused = false;
    video.currentTime = 12;
    (video.listeners.timeupdate || []).forEach((fn) => fn());
    assert.strictEqual(video.currentTime, 20, 'sponsor segment skipped');
    video.currentTime = 5;
    (video.listeners.timeupdate || []).forEach((fn) => fn());
    video.currentTime = 12;
    (video.listeners.timeupdate || []).forEach((fn) => fn());
    assert.strictEqual(video.currentTime, 20, 'segment re-arms after a rewind');
    console.log('PASS 52 SponsorBlock: load + skip + re-arm');
  }

  // 53. Ads (v2.14 C): while an ad shows, the overlay steps aside
  // (YouTube chrome incl. Skip restored) and the skip button is
  // auto-clicked; when the ad ends, the overlay returns.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    env.sandbox.MouseEvent = class { constructor(type, opts) { this.type = type; this.opts = opts; } };
    const skipBtn = { _n: 0, dispatchEvent() { this._n++; return true; } };
    const origQS = env.player.querySelector.bind(env.player);
    env.player.querySelector = (sel) => (String(sel).includes('skip-ad') ? skipBtn : origQS(sel));
    env.player.classList.add('ad-showing');
    env.sandbox.window.__ytnfAdRefresh();
    assert.strictEqual(AUI.root.style.display, 'none', 'overlay hidden during the ad');
    assert.ok(!env.player.classList.contains('ytnf-on'), 'YouTube chrome restored during the ad');
    assert.ok(skipBtn._n >= 1, 'skip button auto-clicked');
    env.player.classList.remove('ad-showing');
    env.sandbox.window.__ytnfAdRefresh();
    assert.strictEqual(AUI.root.style.display, '', 'overlay restored after the ad');
    assert.ok(env.player.classList.contains('ytnf-on'), 'our chrome back after the ad');
    console.log('PASS 53 ads: step aside + auto-skip + restore');
  }

  // 54. Hold-to-2x (v2.14 D): a held press on the video doubles
  // the rate until release; the release click is swallowed.
  {
    const video = makeVideo();
    video.paused = false;
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const AUI = env.sandbox.window.__ytnfAUI;
    const videoTap = { closest: (sel) => (sel.includes('#movie_player') ? {} : null) };
    const fireDoc = (type, ev) => (env.listeners[type] || []).forEach((fn) => fn(ev));
    const evBase = { stopPropagation() {}, preventDefault() {} };
    fireDoc('pointerdown', Object.assign({ target: videoTap, clientX: 100, clientY: 100 }, evBase));
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(video.playbackRate, 2, 'hold engaged 2x');
    assert.strictEqual(AUI.holdChip.style.display, 'block', '2x chip shown');
    fireDoc('pointerup', Object.assign({ target: videoTap, clientX: 100, clientY: 100 }, evBase));
    assert.strictEqual(video.playbackRate, 1, 'release restores the preferred speed');
    assert.strictEqual(AUI.holdChip.style.display, 'none', 'chip hidden on release');
    assert.strictEqual(AUI.swallowNextClick, true, 'release click marked for swallowing');
    fireDoc('click', Object.assign({ target: videoTap, clientX: 100, clientY: 100 }, evBase));
    assert.strictEqual(AUI.swallowNextClick, false, 'click swallowed');
    assert.strictEqual(AUI.visible, false, 'swallowed click did not toggle the UI');
    console.log('PASS 54 hold-to-2x: engage, release, swallow');
  }

  // 55. Chapters + storyboards (v2.14 E): chapters parse from the
  // description, ticks land on the scrub track, and storyboard
  // frames resolve to sheet URLs/positions.
  {
    const video = makeVideo();
    video.duration = 600;
    const pr = captionPR([ytTrack('en', '', 'English')]);
    pr.videoDetails.shortDescription =
      '0:00 Intro\n2:30 Setup\n5:00 Deep Dive\nSome links below';
    pr.storyboards = {
      playerStoryboardSpecRenderer: {
        spec: 'https://i.ytimg.com/sb/chap1/storyboard3_L$L/$N.jpg|160#90#40#5#5#10000#M$M#sighX',
      },
    };
    const env = makeEnv({ video, playerResponse: pr });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    (video.listeners.loadedmetadata || []).forEach((fn) => fn());
    const AUI = env.sandbox.window.__ytnfAUI;
    const MEDIA = env.sandbox.window.__ytnfMedia();
    assert.strictEqual(MEDIA.chapters.length, 3, 'chapters parsed');
    assert.strictEqual(env.sandbox.window.__ytnfChapterAt(200).title, 'Setup', 'chapter lookup');
    const ticks = AUI.scrubTrack.children.filter((c) => c.__ytnfTick);
    assert.strictEqual(ticks.length, 2, 'chapter ticks on the scrub track');
    assert.ok(MEDIA.board && MEDIA.board.h === 90, 'storyboard board parsed');
    const th = env.sandbox.window.__ytnfThumbAt(25);
    assert.ok(th.url.includes('storyboard3_L0/M0.jpg'), 'thumb sheet URL: ' + th.url);
    assert.ok(th.url.includes('sigh=sighX'), 'thumb sigh present');
    assert.strictEqual(th.x, 320, 'thumb frame x');
    assert.strictEqual(th.y, 0, 'thumb frame y');
    console.log('PASS 55 chapters + storyboard thumbnails');
  }

  // 56. Update checker (v2.14 G): the feed is read, a newer
  // version is picked, and content.js surfaces it in Settings.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    const vtt = okFetch(env);
    env.sandbox.fetch = (url) => {
      if (String(url).includes('raw.githubusercontent.com')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ addons: { 'yt-native-fullscreen@local': { updates: [{ version: '2.16.0', update_link: 'https://example.com/yt-2.16.0.xpi' }] } } }),
        });
      }
      return vtt(url);
    };
    const updSrc = fs.readFileSync(__dirname + '/../update-check.js', 'utf8');
    vm.runInContext(updSrc, env.sandbox);
    vm.runInContext(src, env.sandbox);
    await flush();
    await flush();
    const UPD = env.sandbox.window.YTNFUpdate;
    assert.ok(UPD, 'update checker loaded');
    assert.strictEqual(UPD.compareVersions('2.14.0', '2.9.0'), 1, 'version compare');
    const AUI = env.sandbox.window.__ytnfAUI;
    assert.ok(AUI.updateAvail && AUI.updateAvail.version === '2.16.0', 'newer version surfaced');
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    assert.ok(findAll(root, (c) => c.dataset && c.dataset.pick === 'update').length === 1,
      'update row in Settings');
    console.log('PASS 56 update checker: feed, pick, settings row');
  }

  // 57. Diagnostics (v2.14 I): the debug log snapshot carries the
  // version, state and the ring-buffer log.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const d = env.sandbox.window.__ytnfDiag();
    assert.ok(d.includes('Version: 2.15.0'), 'diag version');
    assert.ok(d.includes('Prefs:'), 'diag prefs');
    assert.ok(d.includes('--- log ---'), 'diag log section');
    const root = env.player.children.find((c) => c.id === 'ytnf-apple');
    findAll(root, (c) => c.dataset && c.dataset.act === 'menu')[0].click();
    assert.ok(findAll(root, (c) => c.dataset && c.dataset.pick === 'diag').length === 1,
      'Copy Debug Log row in Settings');
    console.log('PASS 57 diagnostics snapshot + settings row');
  }

  // 58. Below-player rebuild (v2.14): near-solid grouped cards,
  // no backdrop blur, no forced-transparent internals; manifest
  // loads the update checker and allows the SponsorBlock API.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const bg = env.sandbox.window.__ytnfBelowGlass;
    assert.ok(bg.panel.includes('rgba(30,30,34'), 'panel is the near-solid card');
    assert.ok(!bg.panel.includes('backdrop-filter'), 'no blur over the scrolling queue');
    assert.ok(!bg.panel.includes('#items'), 'panel internals not forced transparent');
    assert.ok(bg.metadata.includes('#description'), 'description styled');
    assert.ok(!bg.metadata.includes('backdrop-filter'), 'description has no blur');
    const css = fs.readFileSync(__dirname + '/../player.css', 'utf8');
    assert.ok(css.includes('rgba(10, 132, 255, 0.16)'), 'selected queue row is blue-tinted');
    const mf = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
    assert.ok(mf.content_scripts[0].js.includes('update-check.js'), 'manifest loads update-check.js first');
    assert.ok(mf.permissions.includes('*://sponsor.ajay.app/*'), 'manifest allows the SponsorBlock API');
    console.log('PASS 58 below-player rebuild values + manifest');
  }

  // 59. Hold-to-2x hides YouTube's own 2x indicator (v2.14.1, Kurt):
  // the player carries ytnf-hold2x only while our hold is engaged,
  // and the injected chrome style kills the speedmaster overlay +
  // bezel text under that class.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    video.paused = false;
    // The harness stub doesn't retain the injected <style> in
    // head children, so the rule itself is asserted on the source;
    // the class toggling below is the behavioural half.
    assert.ok(src.includes('ytp-speedmaster-overlay'), 'speedmaster rule present');
    assert.ok(src.includes('#movie_player.ytnf-hold2x'), 'hold-scoped rule present');
    assert.strictEqual(env.player.classList.contains('ytnf-hold2x'), false, 'no hold class at rest');
    const videoTap = { closest: (sel) => (sel.includes('#movie_player') ? {} : null) };
    const fireDoc = (type, ev) => (env.listeners[type] || []).forEach((fn) => fn(ev));
    const evBase = { stopPropagation() {}, preventDefault() {} };
    fireDoc('pointerdown', Object.assign({ target: videoTap, clientX: 100, clientY: 100 }, evBase));
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(video.playbackRate, 2, 'hold engaged');
    assert.strictEqual(env.player.classList.contains('ytnf-hold2x'), true, 'hold class hides YouTube indicator');
    fireDoc('pointerup', Object.assign({ target: videoTap, clientX: 100, clientY: 100 }, evBase));
    await flush();
    assert.strictEqual(env.player.classList.contains('ytnf-hold2x'), false, 'hold class removed on release');
    console.log('PASS 59 hold hides YouTube 2x indicator');
  }

  // 60. Toast (v2.15, Kurt): centred, padded clear above the
  // scrub bar, Liquid Glass styling.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    env.sandbox.window.__ytnfToast('Hello toast', 1000);
    const toast = env.player.children.find((c) => c.id === 'ytnf-toast');
    assert.ok(toast, 'toast attached to the player');
    assert.ok(toast.style.cssText.includes('bottom:124px'), 'padded above the scrub bar');
    assert.ok(toast.style.cssText.includes('translateX(-50%)'), 'centred');
    assert.ok(toast.style.cssText.includes('blur(24px)'), 'glass blur');
    assert.ok(toast.style.cssText.includes('padding:11px 18px'), 'padded');
    console.log('PASS 60 toast above the scrub bar, liquid glass');
  }

  // 61. Metadata card (v2.15, Kurt): the title / channel /
  // description block is one grouped card; the description is
  // the inset card inside it.
  {
    const video = makeVideo();
    const env = makeEnv({ video, playerResponse: captionPR([ytTrack('en', '', 'English')]) });
    env.sandbox.fetch = okFetch(env);
    vm.runInContext(src, env.sandbox);
    await flush();
    const metaHost = { shadowRoot: null, style: {} };
    const doc = env.sandbox.document;
    const origQS = doc.querySelector.bind(doc);
    doc.querySelector = (sel) => (sel === 'ytd-watch-metadata' ? metaHost : origQS(sel));
    env.sandbox.window.__ytnfStyleBelow();
    assert.strictEqual(metaHost.style.background, 'rgba(30,30,34,.94)', 'metadata host is the grouped card');
    assert.strictEqual(metaHost.style.borderRadius, '16px', 'card radius');
    const bg = env.sandbox.window.__ytnfBelowGlass;
    assert.ok(bg.metadata.includes('rgba(255,255,255,.07)'), 'description is the inset card');
    console.log('PASS 61 metadata grouped card + inset description');
  }

  console.log('ALL 59 TESTS PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
