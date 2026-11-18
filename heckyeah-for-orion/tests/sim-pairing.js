/* Simulation of the 0.8.0 pairing state machine (host side) with
 * stub DOM + stub PeerJS. Drives the exact Fire TV v1.37 sequence:
 * panel -> session -> guest connects -> pair-request -> code issued
 * -> phone confirms -> paired -> media command executes.
 * Run: node tests/sim-pairing.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class StubEl {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this._text = '';
    this._handlers = {};
    this.parentNode = null;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(v) { if (v === '') { this.children = []; this._text = ''; } else { this._html = v; } }
  get innerHTML() { return this._html || ''; }
  setAttribute() {}
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); }
  removeEventListener() {}
  remove() {}
  click() { (this._handlers.click || []).forEach((fn) => fn({ target: this, preventDefault() {}, stopPropagation() {} })); }
  getContext() { return { fillRect() {}, fillStyle: '' }; }
  getBoundingClientRect() { return { width: 100, height: 100, left: 0, top: 0 }; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
function findByText(root, txt, out) {
  out = out || [];
  if (root._text === txt && root._handlers.click) out.push(root);
  root.children.forEach((c) => findByText(c, txt, out));
  return out;
}

class FakeConn {
  constructor() { this.handlers = {}; this.sent = []; }
  on(ev, fn) { this.handlers[ev] = fn; }
  send(m) { this.sent.push(m); }
  close() {}
}
class FakePeer {
  constructor(id) { this.id = id; this.handlers = {}; FakePeer.last = this; }
  on(ev, fn) { this.handlers[ev] = fn; }
  destroy() {}
  reconnect() {}
}

const store = { entries: [], armed: {}, visits: 0, hyoSession: null };
const body = new StubEl('body');
const win = {};
win.top = win;
win.addEventListener = () => {};
win.removeEventListener = () => {};
win.Peer = FakePeer;
win.qrcode = function () {
  return { addData() {}, make() {}, getModuleCount() { return 33; }, isDark() { return false; },
    createSvgTag() { return ''; } };
};
win.HYO = {
  loadStore: () => Promise.resolve(store),
  saveStore: () => Promise.resolve(),
  hostOf: () => '',
  Remote: null,
};
const sandbox = {
  window: win,
  document: {
    createElement: (t) => new StubEl(t),
    body,
    documentElement: new StubEl('html'),
    addEventListener() {},
    querySelectorAll: () => [],
    title: '',
  },
  location: { hash: '', href: 'https://fmhy.net/', hostname: 'fmhy.net' },
  console,
  crypto: require('crypto').webcrypto,
  setTimeout: () => 0,
  setInterval: () => 0,
  clearInterval: () => {},
  innerWidth: 1024,
  innerHeight: 768,
  Event: class { constructor(t) { this.type = t; } },
  MouseEvent: class { constructor(t) { this.type = t; } },
  KeyboardEvent: class { constructor(t) { this.type = t; } },
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../remote.js', 'utf8'), sandbox);
const R = win.HYO.Remote;
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // 1) open the panel, start a session
  R.startHostPanel();
  await tick(); await tick();
  let btns = findByText(body, 'Show pairing QR');
  assert.strictEqual(btns.length, 1, 'session start button rendered');
  btns[0].click();
  await tick(); await tick();
  assert.ok(store.hyoSession && store.hyoSession.room, 'session stored');
  assert.ok(FakePeer.last, 'host peer created');
  assert.ok(FakePeer.last.id === 'hyo-' + store.hyoSession.room, 'peer id is the room');
  FakePeer.last.handlers.open('hyo-' + store.hyoSession.room);

  // 2) guest connects and requests pairing (Fire TV: phone asks first)
  const conn = new FakeConn();
  FakePeer.last.handlers.connection(conn);
  conn.handlers.data({ t: 'pair-request' });
  await tick(); await tick();
  const codeMsg = conn.sent.find((m) => m.t === 'code');
  assert.ok(codeMsg && /^\d{6}$/.test(codeMsg.code), 'host issued a 6-digit code: ' + JSON.stringify(conn.sent));
  assert.ok(body.textContent.includes(codeMsg.code.replace(/./g, (c) => c)) || body.textContent.includes(codeMsg.code),
    'host card shows the code (pop-up state)');
  assert.ok(body.textContent.includes('Pair this phone?'), 'host asks to pair');

  // 3) phone confirms
  conn.sent = [];
  conn.handlers.data({ t: 'pair-confirm' });
  await tick(); await tick();
  assert.ok(conn.sent.some((m) => m.t === 'paired'), 'host sent paired');
  assert.strictEqual(store.hyoSession.paired, true, 'session marked paired in store');
  assert.ok(body.textContent.includes('Phone connected'), 'panel shows Connected');

  // 4) heartbeat: ping is answered with pong (and is not a command)
  conn.sent = [];
  conn.handlers.data({ t: 'ping' });
  assert.ok(conn.sent.some((m) => m.t === 'pong'), 'host answers heartbeat pings');

  // 5) commands from the paired conn execute (media -> genericMedia, no crash)
  conn.handlers.data({ t: 'media', a: 'playpause' });
  conn.handlers.data({ t: 'move', dx: 5, dy: 5 });
  await tick();

  // 5) a fresh request from a NEW conn while paired = returning phone, auto-accept
  const conn2 = new FakeConn();
  FakePeer.last.handlers.connection(conn2);
  conn2.handlers.data({ t: 'pair-request' });
  await tick(); await tick();
  assert.ok(conn2.sent.some((m) => m.t === 'paired'), 'returning phone auto-accepted without a code');

  // 6) log captured the journey
  assert.ok(body.textContent.includes('paired \u2713'), 'connection log shows pairing');
  console.log('SIM-PAIRING-OK');
})().catch((e) => { console.error('SIM FAIL:', e.message); process.exit(1); });
