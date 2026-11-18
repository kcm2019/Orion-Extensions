/* Page-hook simulation: minimal page world, verifies K stub serving,
 * fallback blocking, and toString stealth. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const cfg = {
  blockDomains: ['ads.example.com'],
  scriptlets: [
    { name: 'set-constant', args: ['detector.on', 'false'] },
    { name: 'json-prune', args: ['x.*.ad x.list.[-].ad x.list[0].ad playerResponse.adPlacements'] }
  ],
  redirectStubs: [{ needle: 'fuckadblock', key: 'fuckadblock', text: 'window.__fabStub = true;', mime: 'text/javascript' }],
  switches: {},
  host: 'news.site'
};
const cfgEl = {
  textContent: JSON.stringify(cfg),
  removed: false,
  remove() { this.removed = true; }
};
const events = [];
const sandbox = {
  console, URL, JSON, Promise, Error, TypeError, Object, Array, String, Number, Boolean, RegExp, Math, Date, Set, Map,
  Response, CustomEvent, Event,
  location: { href: 'https://news.site/', hostname: 'news.site' },
  navigator: {},
  document: {
    querySelector: (sel) => (sel.includes('data-ubo-cfg') ? cfgEl : null),
    getElementById: () => null,
    currentScript: null
  },
  __origFetchCalls: 0
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.fetch = function () { sandbox.__origFetchCalls++; return Promise.resolve(new Response('real', { status: 200 })); };
sandbox.addEventListener = () => {};
sandbox.dispatchEvent = (ev) => { events.push(JSON.parse(ev.detail)); return true; };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'page-hook.js'), 'utf8'), sandbox, { filename: 'page-hook.js' });

(async () => {
  assert.ok(cfgEl.removed, 'config element removed after read (stealth)');
  // stub serving: fuckadblock via fetch returns the stub, never the network
  const res = await sandbox.fetch('https://cdn.example.net/fuckadblock.min.js');
  assert.strictEqual(await res.text(), 'window.__fabStub = true;', 'fetch stub served');
  assert.strictEqual(sandbox.__origFetchCalls, 0, 'stubbed fetch never hit original');
  // fallback blocking: ads domain fetch rejects
  await assert.rejects(() => sandbox.fetch('https://ads.example.com/tracker.js'), /blocked/, 'fallback blocks ad host');
  // normal fetch passes through
  const ok = await sandbox.fetch('https://news.site/api');
  assert.strictEqual(await ok.text(), 'real', 'normal fetch untouched');
  assert.strictEqual(sandbox.__origFetchCalls, 1, 'original fetch used once');
  // stealth: wrapped fetch reports native toString
  assert.ok(sandbox.fetch.toString().includes('[native code]'), 'fetch toString spoofed: ' + sandbox.fetch.toString());
  // scriptlet applied: detector.on is a constant false
  assert.strictEqual(sandbox.detector.on, false, 'set-constant applied');
  sandbox.detector.on = true;
  assert.strictEqual(sandbox.detector.on, false, 'set-constant resists write');
  // events were emitted for stub + block + ready
  const kinds = events.map(e => e.kind);
  assert.ok(kinds.includes('redirect-stub'), 'redirect-stub event emitted');
  assert.ok(kinds.includes('fallback-block'), 'fallback-block event emitted');
  assert.ok(kinds.includes('ready'), 'ready event emitted');
  // json-prune wildcard / index / last-element paths
  const data = sandbox.JSON.parse(JSON.stringify({
    x: { a: { ad: 1, keep: 1 }, b: { ad: 2, keep: 2 }, list: [{ ad: 3 }, { ad: 4 }, { ad: 5 }] },
    playerResponse: { adPlacements: [1], videoDetails: { id: 'v' } }
  }));
  assert.strictEqual(data.x.a.ad, undefined, 'wildcard prune');
  assert.strictEqual(data.x.b.ad, undefined, 'wildcard prune 2');
  assert.strictEqual(data.x.a.keep, 1, 'non-ad keys survive');
  assert.strictEqual(data.x.list[0].ad, undefined, '[0] prune');
  assert.strictEqual(data.x.list[2].ad, undefined, '[-] last-element prune');
  assert.strictEqual(data.x.list[1].ad, 4, 'middle element untouched');
  assert.strictEqual(data.playerResponse.adPlacements, undefined, 'plain path prune');
  assert.strictEqual(data.playerResponse.videoDetails.id, 'v', 'real content survives pruning');
  console.log('hook tests: ALL PASS (' + events.length + ' events)');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
