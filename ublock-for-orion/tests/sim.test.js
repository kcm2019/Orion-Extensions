/* Simulated Orion runtime: localStorage-backed storage, stub fetch serving
 * a sample list for every registry URL. Exercises updater -> chunked storage
 * -> compiled set -> matcher, plus dashboard-side storage reads. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const store = new Map();
const sandbox = {
  console, URL, JSON, Object, Array, Promise, Date, Math, Set, Map, RegExp, Error, TypeError,
  fetch: (url) => Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve(
      '! Expires: 2 days\n||ads.example.com^\nexample.com##.ad-banner\n##+js(set-constant, ads.on, false)\n')
  }),
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  }
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['engine.js', 'storage.js', 'updater.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
}

(async () => {
  const { UBOUpdater: U, UBOStore: S, UBOEngine: E } = sandbox;
  const settings = S.defaultSettings();
  const results = await U.updateAll(settings, true);
  const failed = results.filter(r => !r.ok);
  assert.strictEqual(failed.length, 0, 'all list updates ok: ' + JSON.stringify(failed));

  const meta = await S.get('compiledMeta');
  const N = U.REGISTRY.length;
  assert.ok(meta && meta.counts.network >= N, 'compiled has one network rule per list, got ' + JSON.stringify(meta));
  assert.ok(meta.listsUsed.length === N, 'all default lists used');

  const compiled = await S.getLarge('compiled');
  const m = E.createMatcher(compiled);
  const hit = m.match({ url: 'https://ads.example.com/x.js', host: 'ads.example.com', type: 'script', docHost: 'news.com' });
  assert.strictEqual(hit.blocked, true, 'matcher blocks sample rule after storage round-trip');
  assert.ok(E.cosmeticsFor(compiled, 'example.com').includes('.ad-banner'), 'cosmetic survives round-trip');
  assert.ok(E.scriptletsFor(compiled, 'any.com').some(c => c.name === 'set-constant'), 'scriptlet survives round-trip');

  // auto-update freshness: second run with force=false skips everything (Expires: 2 days)
  const again = await U.updateAll(settings, false);
  assert.ok(again.every(r => r.skipped), 'fresh lists skipped on second check');

  // logger ring works through the same storage
  await S.appendLog([{ t: Date.now(), layer: 'test', action: 'blocked', url: 'https://ads.example.com', host: 'news.com', detail: 'x' }]);
  const log = await S.getLog();
  assert.strictEqual(log.length, 1, 'logger round-trip');

  // diagnostics storage keys used by background/dashboard exist in the API
  await S.set('diag:background', { fired: 3, cancelled: 1 });
  assert.strictEqual((await S.get('diag:background')).cancelled, 1, 'diag round-trip');

  console.log('simulation tests: ALL PASS (' + N + ' lists, compiled network=' + meta.counts.network +
    ', storage keys=' + store.size + ')');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
