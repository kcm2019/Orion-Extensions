// Tests for heckyeah-orion update-check.js — pure helpers + checkNow
// flows with stubbed storage/fetch. Not shipped in the package.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../update-check.js', 'utf8');
const U = require(__dirname + '/../update-check.js');

function makeEnv(opts) {
  opts = opts || {};
  const ext = Object.assign({}, opts.seed || {});
  let fetchCalls = 0;
  const sandbox = {
    console, Promise, Date, JSON, Math, Object, String, Number, Array,
    fetch: (url, o) => {
      fetchCalls++;
      sandbox.__lastFetchUrl = url;
      return opts.fetchImpl(url, o);
    },
  };
  sandbox.window = sandbox;
  sandbox.browser = {
    runtime: { getManifest: () => ({ version: '' }) },
    storage: { local: {
      get: (keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in ext) out[k] = ext[k]; });
        return Promise.resolve(out);
      },
      set: (o) => { Object.assign(ext, o); return Promise.resolve(); },
    } },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { U: sandbox.HYOUpdate, ext, sandbox, fetchCalls: () => fetchCalls };
}

function feedJson(updates, id) {
  const addons = {};
  addons[id || 'heckyeah-orion@local'] = { updates };
  return { addons };
}
function okRes(json) {
  return Promise.resolve({ status: 200, json: () => Promise.resolve(json) });
}

let pass = 0, fail = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('ok -', name); },
    (e) => { fail++; console.log('FAIL -', name, '::', e.message); });
}

(async () => {
  await test('constants: version, id, feed', () => {
    assert.strictEqual(U.VERSION, '0.12.0');
    assert.strictEqual(U.ADDON_ID, 'heckyeah-orion@local');
    assert.ok(U.FEED_URL.includes('Orion-Extensions'));
  });

  await test('compareVersions numeric dotted', () => {
    assert.strictEqual(U.compareVersions('0.11.0', '0.10.0'), 1);
    assert.strictEqual(U.compareVersions('0.10.0', '0.11.0'), -1);
    assert.strictEqual(U.compareVersions('1.2', '1.2.0'), 0);
    assert.strictEqual(U.compareVersions('1.10.0', '1.9.9'), 1);
    assert.strictEqual(U.compareVersions('2', '2.0.0'), 0);
    assert.strictEqual(U.compareVersions('1.x.3', '1.0.3'), 0);
    assert.strictEqual(U.compareVersions('', '0.0.1'), -1);
  });

  await test('pickUpdate: firefox shape picks highest strictly newer', () => {
    const feed = feedJson([
      { version: '0.10.0', update_link: 'https://x/old.xpi' },
      { version: '0.12.0', update_link: 'https://x/new.xpi' },
      { version: '0.11.5', update_link: 'https://x/mid.xpi' },
      { version: '0.11.0', update_link: 'https://x/same.xpi' },
    ]);
    const got = U.pickUpdate(feed, 'heckyeah-orion@local', '0.11.0');
    assert.strictEqual(got.version, '0.12.0');
    assert.strictEqual(got.update_link, 'https://x/new.xpi');
  });

  await test('pickUpdate: none newer, wrong id, garbage -> null', () => {
    assert.strictEqual(U.pickUpdate(feedJson([{ version: '0.10.0', update_link: 'u' }]), 'heckyeah-orion@local', '0.11.0'), null);
    assert.strictEqual(U.pickUpdate(feedJson([{ version: '9.9.9', update_link: 'u' }], 'other@local'), 'heckyeah-orion@local', '0.11.0'), null);
    assert.strictEqual(U.pickUpdate(null, 'heckyeah-orion@local', '0.11.0'), null);
    assert.strictEqual(U.pickUpdate('nope', 'heckyeah-orion@local', '0.11.0'), null);
    assert.strictEqual(U.pickUpdate({}, 'heckyeah-orion@local', '0.11.0'), null);
  });

  await test('pickUpdate: simple shape fallback', () => {
    const got = U.pickUpdate({ version: '1.0.0', update_link: 'https://x/a.xpi' }, 'heckyeah-orion@local', '0.11.0');
    assert.strictEqual(got.version, '1.0.0');
    assert.strictEqual(U.pickUpdate({ version: '0.1.0', update_link: 'u' }, 'heckyeah-orion@local', '0.11.0'), null);
  });

  await test('checkNow: update found stores upd_available + last_check', async () => {
    const env = makeEnv({ fetchImpl: () => okRes(feedJson([{ version: '0.13.0', update_link: 'https://x/new.xpi' }])) });
    const res = await env.U.checkNow(true);
    assert.strictEqual(res.state, 'update');
    assert.strictEqual(res.version, '0.13.0');
    assert.strictEqual(env.ext.upd_available.version, '0.13.0');
    assert.strictEqual(env.ext.upd_available.update_link, 'https://x/new.xpi');
    assert.ok(env.ext.upd_last_check > 0);
  });

  await test('checkNow: current clears upd_available', async () => {
    const env = makeEnv({
      seed: { upd_available: { version: '0.12.0', update_link: 'u', found_at: 1 } },
      fetchImpl: () => okRes(feedJson([{ version: '0.11.0', update_link: 'u' }])),
    });
    const res = await env.U.checkNow(true);
    assert.strictEqual(res.state, 'current');
    assert.strictEqual(env.ext.upd_available, null);
  });

  await test('checkNow: fetch error -> error state, keeps prior upd_available, stamps last_check', async () => {
    const env = makeEnv({
      seed: { upd_available: { version: '0.12.0', update_link: 'u', found_at: 1 } },
      fetchImpl: () => Promise.reject(new Error('boom')),
    });
    const res = await env.U.checkNow(true);
    assert.strictEqual(res.state, 'error');
    assert.strictEqual(env.ext.upd_available.version, '0.12.0');
    assert.ok(env.ext.upd_last_check > 0);
  });

  await test('checkNow: http 404 -> error, not a false current', async () => {
    const env = makeEnv({ fetchImpl: () => Promise.resolve({ status: 404, json: () => Promise.resolve({}) }) });
    const res = await env.U.checkNow(true);
    assert.strictEqual(res.state, 'error');
  });

  await test('checkNow: auto check throttled under 12h, force bypasses', async () => {
    const env = makeEnv({
      seed: { upd_last_check: Date.now() },
      fetchImpl: () => okRes(feedJson([{ version: '0.13.0', update_link: 'u' }])),
    });
    const res = await env.U.checkNow(false);
    assert.strictEqual(env.fetchCalls(), 0);
    assert.strictEqual(res.state, 'current');
    assert.strictEqual(res.cached, true);
    const res2 = await env.U.checkNow(true);
    assert.strictEqual(env.fetchCalls(), 1);
    assert.strictEqual(res2.state, 'update');
  });

  await test('checkNow: throttled auto check reports stored update', async () => {
    const env = makeEnv({
      seed: { upd_last_check: Date.now(), upd_available: { version: '0.13.0', update_link: 'u', found_at: 1 } },
      fetchImpl: () => { throw new Error('must not fetch'); },
    });
    const res = await env.U.checkNow(false);
    assert.strictEqual(res.state, 'update');
    assert.strictEqual(res.version, '0.13.0');
  });

  await test('checkNow: upd_feed_url override is used', async () => {
    const env = makeEnv({
      seed: { upd_feed_url: 'https://example.com/my-feed.json' },
      fetchImpl: () => okRes({ version: '0.11.0', update_link: '' }),
    });
    await env.U.checkNow(true);
    assert.strictEqual(env.sandbox.__lastFetchUrl, 'https://example.com/my-feed.json');
  });

  await test('dismiss + getState round-trip', async () => {
    const env = makeEnv({ fetchImpl: () => okRes({}) });
    await env.U.dismiss('0.12.0');
    const st = await env.U.getState();
    assert.strictEqual(st.dismissed, '0.12.0');
    assert.strictEqual(st.version, '0.12.0');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
