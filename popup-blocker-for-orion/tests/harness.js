// Harness for orion-popup-blocker — page-hook + background. Not shipped.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const hookSrc = fs.readFileSync(__dirname + '/../page-hook.js', 'utf8');
const bgSrc = fs.readFileSync(__dirname + '/../background.js', 'utf8');

function makeHookEnv() {
  const posted = [];
  const nativeCalls = [];
  const docListeners = {};
  const winListeners = {};
  const intervals = [];
  function FakeHTMLElement() {}
  FakeHTMLElement.prototype.click = function () { this.__nativeClicks = (this.__nativeClicks || 0) + 1; };
  function FakeForm() {}
  FakeForm.prototype.submit = function () { this.__nativeSubmits = (this.__nativeSubmits || 0) + 1; };
  function FakeEventTarget() {}
  FakeEventTarget.prototype.dispatchEvent = function () { this.__nativeDispatches = (this.__nativeDispatches || 0) + 1; return true; };
  const env = { iframes: [] };
  const windowStub = {
    location: { href: 'https://example.com/page' },
    navigator: {},
    innerWidth: 1000, innerHeight: 800,
    HTMLElement: FakeHTMLElement, HTMLFormElement: FakeForm, EventTarget: FakeEventTarget,
    open: function (url, target) { nativeCalls.push([url, target]); return { native: true, url }; },
    postMessage: function (msg) { posted.push(msg); },
    addEventListener: function (t, fn) { (winListeners[t] ||= []).push(fn); },
  };
  const documentStub = {
    addEventListener: function (t, fn) { (docListeners[t] ||= []).push(fn); },
    querySelectorAll: function () { return env.iframes; },
  };
  const sandbox = {
    console, URL, Date, Proxy,
    window: windowStub,
    document: documentStub,
    HTMLElement: FakeHTMLElement, HTMLFormElement: FakeForm, EventTarget: FakeEventTarget,
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
  };
  env.FakeHTMLElement = FakeHTMLElement;
  env.FakeForm = FakeForm;
  env.FakeEventTarget = FakeEventTarget;
  env.intervals = intervals;
  vm.createContext(sandbox);
  vm.runInContext(hookSrc, sandbox);
  const sendConfig = (mode, allowSite) => {
    winListeners.message.forEach((fn) => fn({
      source: windowStub,
      data: { __opb: true, from: 'content', type: 'config', mode, allowSite },
    }));
  };
  const gesture = () => { (docListeners.pointerdown || []).forEach((fn) => fn({})); };
  const blocked = () => posted.filter((m) => m.type === 'blocked');
  return { windowStub, docListeners, winListeners, posted, nativeCalls, sendConfig, gesture, blocked,
           intervals, iframes: env.iframes, FakeHTMLElement, FakeForm, FakeEventTarget,
           setIframes(f) { env.iframes = f; } };
}

function protoAnchor(env, href, rect) {
  // Chain HTMLElement.prototype -> EventTarget.prototype so the
  // anchor sees both .click and .dispatchEvent, like a real anchor.
  Object.setPrototypeOf(env.FakeHTMLElement.prototype, env.FakeEventTarget.prototype);
  const a = Object.create(env.FakeHTMLElement.prototype);
  a.tagName = 'A';
  a.href = href;
  a.getAttribute = (k) => (k === 'target' ? '_blank' : href);
  if (rect) a.getBoundingClientRect = () => rect;
  return a;
}

function clickEv(anchor, isTrusted) {
  return {
    target: { closest: () => anchor },
    isTrusted,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}
const blankAnchor = {
  tagName: 'A', href: 'https://ads.example.com/pop',
  getAttribute(k) { return k === 'target' ? '_blank' : this.href; },
};

(async () => {
  // 1. Strict (default): window.open blocked, returns null, reported + resolved
  {
    const env = makeHookEnv();
    const ret = env.windowStub.open('https://ads.example.com/x?y=1', '_blank');
    assert.strictEqual(ret, null);
    assert.strictEqual(env.nativeCalls.length, 0);
    assert.strictEqual(env.blocked().length, 1);
    assert.strictEqual(env.blocked()[0].entry.url, 'https://ads.example.com/x?y=1');
    assert.strictEqual(env.blocked()[0].entry.kind, 'window.open');
    console.log('PASS 1 strict window.open blocked + reported');
  }

  // 2. Relative URL resolved against the page
  {
    const env = makeHookEnv();
    env.windowStub.open('/promo', '_blank');
    assert.strictEqual(env.blocked()[0].entry.url, 'https://example.com/promo');
    console.log('PASS 2 relative popup URL resolved');
  }

  // 3. Smart + real gesture -> allowed through native open
  {
    const env = makeHookEnv();
    env.sendConfig('smart', false);
    env.gesture();
    const ret = env.windowStub.open('https://ok.example.com/', '_blank');
    assert.ok(ret && ret.native);
    assert.strictEqual(env.nativeCalls.length, 1);
    assert.strictEqual(env.blocked().length, 0);
    console.log('PASS 3 smart allows gestured window.open');
  }

  // 4. Smart without gesture -> blocked
  {
    const env = makeHookEnv();
    env.sendConfig('smart', false);
    const ret = env.windowStub.open('https://ads.example.com/', '_blank');
    assert.strictEqual(ret, null);
    assert.strictEqual(env.blocked().length, 1);
    console.log('PASS 4 smart blocks ungestured window.open');
  }

  // 5. Allowlist wins even in strict
  {
    const env = makeHookEnv();
    env.sendConfig('strict', true);
    const ret = env.windowStub.open('https://bank.example.com/auth', '_blank');
    assert.ok(ret && ret.native);
    assert.strictEqual(env.blocked().length, 0);
    console.log('PASS 5 allowlisted site allowed in strict');
  }

  // 6. C strict: trusted _blank click blocked + swallowed
  {
    const env = makeHookEnv();
    const ev = clickEv(blankAnchor, true);
    env.docListeners.click.forEach((fn) => fn(ev));
    assert.strictEqual(ev.prevented, true);
    assert.strictEqual(env.blocked().length, 1);
    assert.strictEqual(env.blocked()[0].entry.kind, 'link');
    console.log('PASS 6 strict blocks trusted _blank click');
  }

  // 7. C smart: trusted _blank click allowed, synthetic blocked
  {
    const env = makeHookEnv();
    env.sendConfig('smart', false);
    const ev1 = clickEv(blankAnchor, true);
    env.docListeners.click.forEach((fn) => fn(ev1));
    assert.strictEqual(ev1.prevented, false);
    assert.strictEqual(env.blocked().length, 0);
    const ev2 = clickEv(blankAnchor, false);
    env.docListeners.click.forEach((fn) => fn(ev2));
    assert.strictEqual(ev2.prevented, true);
    assert.strictEqual(env.blocked().length, 1);
    console.log('PASS 7 smart: trusted _blank ok, synthetic blocked');
  }

  // 8. C strict: _blank form submit blocked
  {
    const env = makeHookEnv();
    const form = { action: 'https://ads.example.com/submit', getAttribute: (k) => (k === 'target' ? '_blank' : null) };
    const ev = { target: form, isTrusted: true, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    env.docListeners.submit.forEach((fn) => fn(ev));
    assert.strictEqual(ev.prevented, true);
    assert.strictEqual(env.blocked()[0].entry.kind, 'form');
    console.log('PASS 8 strict blocks _blank form submit');
  }

  // 9. F: about:blank returns a fake window; navigation attempts update the entry
  {
    const env = makeHookEnv();
    const fake = env.windowStub.open('', '_blank');
    assert.ok(fake && typeof fake === 'object', 'fake handle returned');
    assert.strictEqual(env.blocked()[0].entry.pendingBlank, true);
    fake.location.href = 'https://evil.example.com/landing';
    const upd = env.posted.filter((m) => m.type === 'blocked-update');
    assert.strictEqual(upd.length, 1);
    assert.strictEqual(upd[0].url, 'https://evil.example.com/landing');
    fake.location = 'https://evil2.example.com/next';
    const upd2 = env.posted.filter((m) => m.type === 'blocked-update');
    assert.strictEqual(upd2.length, 2);
    assert.strictEqual(upd2[1].url, 'https://evil2.example.com/next');
    console.log('PASS 9 about:blank fake window captures navigation');
  }

  // 10. open-now from content opens via native exactly once
  {
    const env = makeHookEnv();
    env.winListeners.message.forEach((fn) => fn({
      source: env.windowStub,
      data: { __opb: true, from: 'content', type: 'open-now', url: 'https://wanted.example.com/' },
    }));
    assert.strictEqual(env.nativeCalls.length, 1);
    assert.strictEqual(env.nativeCalls[0][0], 'https://wanted.example.com/');
    assert.strictEqual(env.blocked().length, 0);
    console.log('PASS 10 open-now uses native opener, not re-blocked');
  }

  // 11. Messages not from content are ignored (no config hijack)
  {
    const env = makeHookEnv();
    env.winListeners.message.forEach((fn) => fn({
      source: env.windowStub,
      data: { __opb: true, type: 'config', mode: 'smart', allowSite: true }, // no from:'content'
    }));
    const ret = env.windowStub.open('https://ads.example.com/', '_blank');
    assert.strictEqual(ret, null, 'still strict');
    console.log('PASS 11 foreign config message ignored');
  }

  // 12. Background: tabs.create for http, refuse javascript:
  {
    const created = [];
    let listener = null;
    const sandbox = {
      console, URL,
      browser: {
        runtime: { onMessage: { addListener(fn) { listener = fn; } } },
        tabs: { create: (o) => { created.push(o); return Promise.resolve({ id: 1 }); } },
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(bgSrc, sandbox);
    assert.ok(listener, 'bg listener registered');
    const ok = await listener({ type: 'opb-open-tab', url: 'https://ok.example.com/' }, {}, null);
    assert.ok(ok && ok.ok === true, 'tabs.create reported ok');
    assert.strictEqual(created.length, 1);
    let resp = null;
    await listener({ type: 'opb-open-tab', url: 'javascript:alert(1)' }, {}, (r) => { resp = r; });
    assert.ok(resp && resp.ok === false);
    assert.strictEqual(created.length, 1, 'javascript: never opened');
    console.log('PASS 12 background opens http tab, refuses javascript:');
  }

  // 13. v1.1: detached anchor .click() blocked in strict (no document event ever fires)
  {
    const env = makeHookEnv();
    const a = protoAnchor(env, 'https://ads.example.com/detached');
    a.click();
    assert.strictEqual(a.__nativeClicks || 0, 0, 'native click not called');
    assert.strictEqual(env.blocked().length, 1);
    assert.ok(env.blocked()[0].entry.note.includes('programmatic'), env.blocked()[0].entry.note);
    console.log('PASS 13 detached anchor .click() blocked (strict)');
  }

  // 14. v1.1: prototype .click() — smart+gesture allowed, smart without blocked
  {
    const env = makeHookEnv();
    env.sendConfig('smart', false);
    const a1 = protoAnchor(env, 'https://ads.example.com/1');
    a1.click();
    assert.strictEqual(a1.__nativeClicks || 0, 0);
    assert.strictEqual(env.blocked().length, 1);
    env.gesture();
    const a2 = protoAnchor(env, 'https://ok.example.com/2');
    a2.click();
    assert.strictEqual(a2.__nativeClicks, 1, 'gestured prototype click passes in smart');
    assert.strictEqual(env.blocked().length, 1);
    console.log('PASS 14 prototype .click() follows smart gesture rule');
  }

  // 15. v1.1: form.submit() (no submit event) blocked in strict, _self passes
  {
    const env = makeHookEnv();
    const form = Object.create(env.FakeForm.prototype);
    form.action = 'https://ads.example.com/post';
    form.getAttribute = (k) => (k === 'target' ? '_blank' : null);
    form.submit();
    assert.strictEqual(form.__nativeSubmits || 0, 0);
    assert.strictEqual(env.blocked().length, 1);
    assert.ok(env.blocked()[0].entry.note.includes('form.submit()'));
    const form2 = Object.create(env.FakeForm.prototype);
    form2.action = 'https://example.com/search';
    form2.getAttribute = () => '_self';
    form2.submit();
    assert.strictEqual(form2.__nativeSubmits, 1);
    console.log('PASS 15 form.submit() blocked for _blank, _self passes');
  }

  // 16. v1.1: synthetic dispatchEvent click on an anchor blocked in strict
  {
    const env = makeHookEnv();
    const a = protoAnchor(env, 'https://ads.example.com/synth');
    const ret = a.dispatchEvent({ type: 'click' });
    assert.strictEqual(ret, false);
    assert.strictEqual(a.__nativeDispatches || 0, 0);
    assert.strictEqual(env.blocked().length, 1);
    assert.ok(env.blocked()[0].entry.note.includes('synthetic'));
    console.log('PASS 16 dispatched synthetic anchor click blocked');
  }

  // 17. v1.1: href swapped between pointerdown and click blocked even in Smart
  {
    const env = makeHookEnv();
    env.sendConfig('smart', false);
    const a = protoAnchor(env, 'https://example.com/watch-real');
    const target = { closest: () => a };
    env.docListeners.pointerdown.forEach((fn) => fn({ target }));
    a.href = 'https://ads.example.com/swapped';
    const ev = clickEv(a, true);
    ev.target = target;
    env.docListeners.click.forEach((fn) => fn(ev));
    assert.strictEqual(ev.prevented, true);
    assert.strictEqual(env.blocked().length, 1);
    assert.ok(env.blocked()[0].entry.note.includes('swapped'), env.blocked()[0].entry.note);
    assert.strictEqual(env.blocked()[0].entry.url, 'https://ads.example.com/swapped');
    console.log('PASS 17 href-swap blocked in smart mode');
  }

  // 18. v1.1: full-screen overlay _blank anchor blocked even in Smart (click-anywhere popunder)
  {
    const env = makeHookEnv();
    env.sendConfig('smart', false);
    const a = protoAnchor(env, 'https://ads.example.com/overlay', { width: 1000, height: 800 });
    const ev = clickEv(a, true);
    ev.target = { closest: () => a };
    env.docListeners.click.forEach((fn) => fn(ev));
    assert.strictEqual(ev.prevented, true);
    assert.strictEqual(env.blocked().length, 1);
    assert.ok(env.blocked()[0].entry.note.includes('overlay'), env.blocked()[0].entry.note);
    console.log('PASS 18 overlay popunder link blocked in smart mode');
  }

  // 19. v1.1: iframe patcher wraps a fresh frame's pristine window.open
  {
    const env = makeHookEnv();
    const childNative = [];
    const childWin = { open: function (u) { childNative.push(u); return { native: true }; } };
    env.setIframes([{ contentWindow: childWin }]);
    env.intervals.forEach((fn) => fn()); // run scanners / re-asserts
    const ret = childWin.open('https://ads.example.com/from-frame', '_blank');
    assert.strictEqual(ret, null);
    assert.strictEqual(childNative.length, 0);
    assert.strictEqual(env.blocked().length, 1);
    assert.strictEqual(env.blocked()[0].entry.kind, 'window.open (iframe)');
    console.log('PASS 19 iframe pristine window.open patched + blocked');
  }

  // 20. Content script loads clean at document_start with no extension APIs
  {
    const contentSrc = fs.readFileSync(__dirname + '/../content.js', 'utf8');
    const el = () => ({
      style: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, appendChild(c) { return c; }, remove() {},
      set textContent(v) {}, get textContent() { return ''; },
    });
    const winStub = {
      location: { hostname: 'example.com', href: 'https://example.com/' },
      addEventListener() {},
      postMessage() {},
    };
    winStub.top = winStub;
    const sandbox = {
      console, URL, Promise,
      window: winStub,
      document: {
        head: el(), documentElement: el(), body: null,
        createElement: () => el(),
        addEventListener() {},
      },
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout: () => 0, clearTimeout: () => {},
    };
    vm.createContext(sandbox);
    vm.runInContext(contentSrc, sandbox);
    await new Promise((r) => setTimeout(r, 10));
    console.log('PASS 20 content script loads at document_start');
  }

  console.log('ALL 20 TESTS PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
