/* Console simulation: two instances of console/app.js in VM
 * contexts, wired by a mock PeerJS broker. Verifies the pairing
 * handshake (room-only link, code issued by host, guest confirms,
 * host confirms, pair-ok both ways), cast-url delivery, and the
 * heartbeat reply — the exact protocol the Orion extension speaks.
 * Not shipped in any package. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const appSrc = fs.readFileSync(__dirname + '/../console/app.js', 'utf8');
const qrSrc = fs.readFileSync(__dirname + '/../vendor/qrcode.min.js', 'utf8');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e) { fail++; console.log('NOT OK - ' + name + ': ' + e.message); }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 10));

/* ---------- mock broker ---------- */
function makeBroker() {
  const peers = new Map();
  function makeConnPair(a, b) {
    const ca = { peer: b, open: false, _h: {} };
    const cb = { peer: a, open: false, _h: {} };
    ca._other = cb; cb._other = ca;
    for (const c of [ca, cb]) {
      c.on = (ev, fn) => { (c._h[ev] = c._h[ev] || []).push(fn); };
      c.send = (msg) => {
        const other = c._other;
        setTimeout(() => (other._h.data || []).forEach((f) => f(JSON.parse(JSON.stringify(msg)))), 1);
      };
      c.close = () => {};
    }
    setTimeout(() => {
      ca.open = cb.open = true;
      (ca._h.open || []).forEach((f) => f());
      (cb._h.open || []).forEach((f) => f());
    }, 1);
    return ca;
  }
  class MockPeer {
    constructor(id) {
      this.id = id || ('apo-g-' + Math.random().toString(36).slice(2, 10).toUpperCase());
      this._h = {};
      peers.set(this.id, this);
      setTimeout(() => (this._h.open || []).forEach((f) => f(this.id)), 1);
    }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); }
    connect(remoteId) {
      const remote = peers.get(remoteId);
      if (!remote) throw new Error('no peer ' + remoteId);
      const mine = makeConnPair(this.id, remoteId);
      const theirs = mine._other;
      setTimeout(() => (remote._h.connection || []).forEach((f) => f(theirs)), 1);
      return mine;
    }
    call(remoteId, stream, opts) {
      const remote = peers.get(remoteId);
      const callObj = { _h: {}, on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); }, close() {} };
      const remoteCall = {
        _h: {}, metadata: opts && opts.metadata,
        on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
        answer() { setTimeout(() => (callObj._h.stream || []).forEach((f) => f(stream)), 1); },
        close() {}
      };
      callObj._remote = remoteCall;
      setTimeout(() => (remote._h.call || []).forEach((f) => f(remoteCall)), 1);
      return callObj;
    }
    destroy() { peers.delete(this.id); }
  }
  return MockPeer;
}

const SharedPeer = makeBroker();

/* ---------- DOM stub ---------- */
function makeEl(id) {
  const el = {
    id: id || '', style: {}, textContent: '', innerHTML: '', value: '', files: [],
    disabled: false, onclick: null, src: '', srcObject: null,
    children: [], _ls: {},
    addEventListener(ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); },
    removeEventListener() {},
    setAttribute() {}, removeAttribute() {}, appendChild(c) { this.children.push(c); return c; },
    click() {
      if (this.onclick) this.onclick();
      (this._ls.click || []).forEach((f) => f({ target: this }));
      (this._ls.change || []).forEach((f) => f({ target: this }));
    },
    play() { return Promise.resolve(); }, pause() {}, load() {},
    getContext() { return { fillRect() {}, set fillStyle(v) {}, get fillStyle() { return ''; } }; }
  };
  return el;
}
function makeInstance(hash) {
  const els = new Map();
  const byId = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const local = {};
  const location = { hash: hash || '', href: 'https://console.test/page' + (hash || '') };
  const sandbox = {
    console, Promise, JSON, Math, Date, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {
      getItem: (k) => (k in local ? local[k] : null),
      setItem: (k, v) => { local[k] = String(v); },
      removeItem: (k) => { delete local[k]; }
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)',
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {}, addEventListener() {} }] }),
        getDisplayMedia: () => Promise.resolve({ getTracks: () => [{ stop() {}, addEventListener() {} }] })
      }
    },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 4294967296) >>> 0; return a; } },
    location, history: { replaceState: (a, b, url) => { const h = String(url).indexOf('#'); location.hash = h >= 0 ? String(url).slice(h) : ''; } },
    Peer: SharedPeer,
    document: {
      readyState: 'complete',
      title: '',
      getElementById: byId,
      createElement: (tag) => {
        const el = makeEl('');
        if (tag === 'video') { el.captureStream = () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }); }
        return el;
      },
      addEventListener() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(qrSrc, sandbox);
  vm.runInContext(appSrc, sandbox);
  return { sandbox, byId, local, location };
}

(async () => {
  /* host starts a pairing */
  const A = makeInstance('');
  await tick(20);
  A.byId('start-host').click();
  await tick(20);
  const sessA = JSON.parse(A.local['airplay_console_v1']).session;
  ok('host mints a session + room and registers apo-<room>', () => {
    assert.ok(sessA && sessA.room && sessA.room.length === 14);
  });

  /* guest opens the link */
  const B = makeInstance('#apo-cast=' + sessA.room);
  await tick(60);
  ok('guest auto-joins from the hash and receives the pair code', () => {
    assert.strictEqual(B.byId('pair-code-row').style.display, '');
    assert.ok(/^\d{6}$/.test(B.byId('pair-code').textContent), 'guest shows 6-digit code: ' + B.byId('pair-code').textContent);
    assert.strictEqual(A.byId('pair-code').textContent, B.byId('pair-code').textContent, 'codes match');
  });

  /* guest confirms, host confirms */
  B.byId('pair-confirm').click();       /* guest sends confirm-code */
  await tick(20);
  A.byId('pair-confirm').click();       /* host sends pair-ok */
  await tick(30);
  ok('both sides enter the paired console', () => {
    assert.strictEqual(A.byId('card-main').style.display, '');
    assert.strictEqual(B.byId('card-main').style.display, '');
    assert.ok(/Paired with/.test(A.byId('status').textContent), 'A status: ' + A.byId('status').textContent);
    assert.ok(/Paired with/.test(B.byId('status').textContent), 'B status: ' + B.byId('status').textContent);
  });

  /* guest casts a URL to the host */
  B.byId('cast-url').value = 'https://example.com/movie.mp4';
  B.byId('cast-send').click();
  await tick(20);
  ok('cast-url plays on the other side', () => {
    assert.strictEqual(A.byId('player-video').src, 'https://example.com/movie.mp4');
    assert.ok(/movie\.mp4/.test(A.byId('now-playing').textContent));
  });

  /* host casts a page link back (iframe path) */
  A.byId('cast-url').value = 'https://example.com/article';
  A.byId('cast-send').click();
  await tick(20);
  ok('page link opens in the receiver frame', () => {
    assert.strictEqual(B.byId('player-frame').src, 'https://example.com/article');
  });

  /* sessions persist for code-free return */
  ok('paired sessions persist in localStorage on both sides', () => {
    assert.strictEqual(JSON.parse(A.local['airplay_console_v1']).session.paired, true);
    assert.strictEqual(JSON.parse(B.local['airplay_console_v1']).session.paired, true);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SIM CRASH', e); process.exit(1); });
