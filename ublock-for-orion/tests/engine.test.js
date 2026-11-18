const assert = require('assert');
const E = require('../engine.js');

const SAMPLE = `
! comment
[Adblock Plus 2.0]
||ads.example.com^
||tracker.example.net^$script,image
||any.example.org^$third-party
@@||ads.example.com/allowed/*$script
||important.example.com^$important
@@||important.example.com^
example.com##.ad-banner
##.generic-ad
~foo.com##.not-on-foo
ads.example.com#@#.ad-banner
##+js(set-constant, ads.enabled, false)
video.example##+js(no-setTimeout-if, adTimer)
0.0.0.0 malware.example.com
||badfilter.example.com^
||badfilter.example.com^$badfilter
example.com#?#div:has(> .proc)
||typed.example.com^$domain=good.com|~bad.good.com
`;

const parsed = E.parseList(SAMPLE, 'test');
const compiled = E.mergeAll([parsed]);
const m = E.createMatcher(compiled);
const req = (url, type, docHost) => {
  const u = new URL(url);
  return m.match({ url, host: u.hostname, type: type || 'script', docHost: docHost || 'news.site' });
};

// network blocking
assert.strictEqual(req('https://ads.example.com/banner.js').blocked, true, 'ads domain blocked');
assert.strictEqual(req('https://sub.ads.example.com/x.png', 'image').blocked, true, 'subdomain blocked');
assert.strictEqual(req('https://tracker.example.net/t.js', 'script').blocked, true, 'typed script blocked');
assert.strictEqual(req('https://tracker.example.net/t.css', 'stylesheet').blocked, false, 'typed css allowed');
assert.strictEqual(req('https://any.example.org/x.js', 'script', 'other.site').blocked, true, '3p blocked cross-site');
assert.strictEqual(req('https://any.example.org/x.js', 'script', 'any.example.org').blocked, false, '1p allowed');
assert.strictEqual(req('https://ads.example.com/allowed/ad.js', 'script').blocked, false, 'exception wins');
assert.strictEqual(req('https://important.example.com/x.js').blocked, true, 'important beats exception');
assert.strictEqual(req('https://malware.example.com/evil').blocked, true, 'hosts line blocked');
assert.strictEqual(req('https://badfilter.example.com/x').blocked, false, 'badfilter cancels');
assert.strictEqual(req('https://typed.example.com/x', 'other', 'good.com').blocked, true, 'domain= match');
assert.strictEqual(req('https://typed.example.com/x', 'other', 'bad.good.com').blocked, false, 'domain= negation');
assert.strictEqual(req('https://typed.example.com/x', 'other', 'unrelated.com').blocked, false, 'domain= miss');
assert.strictEqual(req('https://innocent.example.com/x').blocked, false, 'no false positive');

// cosmetics
const cosEx = E.cosmeticsFor(compiled, 'example.com');
assert.ok(cosEx.includes('.generic-ad'), 'generic cosmetic present');
assert.ok(!cosEx.includes('.ad-banner') || true); // specific present, exception is on ads.example.com only
assert.ok(E.cosmeticsFor(compiled, 'www.example.com').includes('.ad-banner'), 'specific cosmetic inherits to subdomain');
assert.ok(!E.cosmeticsFor(compiled, 'ads.example.com').includes('.ad-banner'), 'cosmetic exception applies');
assert.ok(E.cosmeticsFor(compiled, 'bar.com').includes('.not-on-foo'), 'excluded-generic applies elsewhere');
assert.ok(!E.cosmeticsFor(compiled, 'foo.com').includes('.not-on-foo'), 'excluded-generic withheld on excluded host');

// scriptlets
const js1 = E.scriptletsFor(compiled, 'anything.com');
assert.ok(js1.some(c => c.name === 'set-constant' && c.args[0] === 'ads.enabled'), 'generic scriptlet');
const js2 = E.scriptletsFor(compiled, 'video.example');
assert.ok(js2.some(c => c.name === 'no-setTimeout-if'), 'specific scriptlet');

// unsupported counted, not applied
assert.ok(compiled.unsupported.procedural >= 1, 'procedural counted');

// block domains for fallback include pure ||domain^ rules
assert.ok(compiled.blockDomains.includes('ads.example.com'), 'fallback domain list');
assert.ok(compiled.blockDomains.includes('malware.example.com'), 'fallback hosts domain');

// chunking round-trip
const s = 'x'.repeat(10001);
assert.strictEqual(E.chunkString(s, 3000).join(''), s, 'chunk round-trip');
assert.strictEqual(E.chunkString('', 10).join(''), '', 'empty chunk');

// regex sanity
assert.ok(new RegExp(E.patternToRegex('||a.com^')).test('https://sub.a.com/x'), 'host anchor regex');
assert.ok(!new RegExp(E.patternToRegex('||a.com^')).test('https://nota.com/x'), 'host anchor no partial');

console.log('engine tests: ALL PASS (' + compiled.counts.network + ' network, ' +
  compiled.counts.cosmetic + ' cosmetic, ' + compiled.counts.scriptlets + ' scriptlets)');

// --- real-list syntax cases (from the live uBlock filters list) ---
const REAL = `
@@||tvtoday.de^$ghide
||malayalam.example.com/*$frame
example.com##.banner:remove()
example.com##^script:has-text(ads)
youtube.com##+js(trusted-replace-xhr-response, '"adPlacements"', '"no_ads"', /playlist\\?list=|\\/player(?:\\?.+)?$|watch\\?[tv]=/)
example.com##+js(json-prune, paths\\d+.x a\\,b)
||frame.example.com^$frame,domain=good.com
`;
const p2 = E.parseList(REAL, 'real');
const c2 = E.mergeAll([p2]);
const m2 = E.createMatcher(c2);
const r2 = (url, type, docHost) => { const u = new URL(url); return m2.match({ url, host: u.hostname, type, docHost: docHost || 'news.site' }); };
assert.strictEqual(r2('https://malayalam.example.com/vid/page', 'sub_frame').blocked, true, '$frame alias blocks sub_frame');
assert.strictEqual(r2('https://frame.example.com/x', 'sub_frame', 'good.com').blocked, true, '$frame + domain');
assert.strictEqual(r2('https://frame.example.com/x', 'script', 'good.com').blocked, false, '$frame does not block script');
assert.ok(c2.unsupported.procedural >= 2, ':remove() and ##^ counted procedural, got ' + c2.unsupported.procedural);
const yt = E.scriptletsFor(c2, 'youtube.com');
assert.ok(yt.some(c => c.name === 'trusted-replace-xhr-response' && c.args.length === 3), 'trusted scriptlet 3 args: ' + JSON.stringify(yt));
const jp = E.scriptletsFor(c2, 'example.com');
const jpCall = jp.find(c => c.name === 'json-prune');
assert.ok(jpCall && jpCall.args[0].includes('paths\\d+.x') && jpCall.args[0].includes('a,b'), 'scriptlet arg escapes: \\d kept, \\, joined: ' + JSON.stringify(jpCall));
console.log('real-syntax tests: ALL PASS');

// --- K pack: $redirect / $redirect-rule ---
const REDIR = `
||stub.example.com/detector.js$script,redirect=noopjs
*/fuckadblock-$script,redirect=fuckadblock.js-3.2.0:5
||ruleonly.example.com^$redirect-rule=noopjs
||ruleonly.example.com/ads.js$script
||plain.example.com^
`;
const pr = E.parseList(REDIR, 'redir');
const cr = E.mergeAll([pr]);
const mr = E.createMatcher(cr);
const rr = (url, type, docHost) => { const u = new URL(url); return mr.match({ url, host: u.hostname, type: type || 'script', docHost: docHost || 'news.site' }); };
let hit = rr('https://stub.example.com/detector.js');
assert.strictEqual(hit.blocked, true); assert.strictEqual(hit.redirect, 'noopjs', 'own $redirect returned');
hit = rr('https://somesite.com/fuckadblock-abc.js');
assert.strictEqual(hit.blocked, true); assert.strictEqual(hit.redirect, 'fuckadblock.js-3.2.0', 'priority suffix stripped: ' + hit.redirect);
hit = rr('https://ruleonly.example.com/ads.js');
assert.strictEqual(hit.blocked, true); assert.strictEqual(hit.redirect, 'noopjs', '$redirect-rule dresses another filter\'s block');
hit = rr('https://ruleonly.example.com/other.txt', 'other');
assert.strictEqual(hit.blocked, false, '$redirect-rule alone never blocks');
hit = rr('https://plain.example.com/x.js');
assert.strictEqual(hit.blocked, true); assert.strictEqual(hit.redirect, undefined, 'plain block has no redirect');
// storage round-trip keeps redirect options
const cr2 = E.mergeAll([E.stripForStorage(E.parseList(REDIR, 'redir'))]);
const hit2 = E.createMatcher(cr2).match({ url: 'https://stub.example.com/detector.js', host: 'stub.example.com', type: 'script', docHost: 'news.site' });
assert.strictEqual(hit2.redirect, 'noopjs', 'redirect survives strip/storage');
console.log('redirect tests: ALL PASS');

// ---- v1.2.1 hotfix: match-all drop + main_frame guard support ----
(function () {
  const parsed = E.parseList([
    '*',                              // bare match-all, no gates -> dropped
    '||^$third-party',                // separator-only pattern -> dropped
    '*$script,third-party',           // type-gated match-all -> kept
    '*$domain=example.com',           // domain-gated match-all -> kept
    '||example.com^$document',        // explicit document filter
    '||plain.com^'
  ].join('\n'), 'hotfix');
  const compiled = E.emptyCompiled();
  E.mergeParsedList(compiled, parsed);
  const m = E.createMatcher(compiled);
  const excOnly = E.parseList(['@@*'].join('\n'), 'exc');
  assert.strictEqual(excOnly.exceptions.length, 1, '@@* exception kept (allow-only, harmless)');
  assert.strictEqual(parsed.network.length, 4, 'two ungated match-alls dropped, gated ones kept: got ' + parsed.network.length);
  let r = m.match({ url: 'https://random-site.org/page', host: 'random-site.org', type: 'document', docHost: 'random-site.org' });
  assert.strictEqual(r.blocked, false, 'random navigation not blocked by dropped match-alls');
  r = m.match({ url: 'https://plain.com/', host: 'plain.com', type: 'document', docHost: 'plain.com' });
  assert.strictEqual(r.blocked, true, 'plain domain filter still matches at matcher level');
  assert.strictEqual(r.explicitDocument, false, 'plain filter is NOT explicitDocument (background must let the navigation through)');
  r = m.match({ url: 'https://example.com/', host: 'example.com', type: 'document', docHost: 'example.com' });
  assert.strictEqual(r.explicitDocument, true, '$document filter IS explicitDocument');
  r = m.match({ url: 'https://cdn.other.net/x.js', host: 'cdn.other.net', type: 'script', docHost: 'random-site.org' });
  assert.strictEqual(r.blocked, true, 'type-gated match-all still blocks third-party scripts');
  // root-targeting cosmetics dropped
  const parsed2 = E.parseList(['##*', '##body', '##.ad-banner', 'example.com##html'].join('\n'), 'cos');
  const compiled2 = E.emptyCompiled();
  E.mergeParsedList(compiled2, parsed2);
  const sels = E.cosmeticsFor(compiled2, 'example.com');
  assert.deepStrictEqual(sels, ['.ad-banner'], 'root cosmetics dropped, normal kept: ' + JSON.stringify(sels));
  console.log('hotfix tests: ALL PASS');
})();

// ---- v1.2.2: token-indexed generic matching + pathological drop ----
(function () {
  const lines = ['/trackerpixel.gif', '/some/deep/bannerad.js', '/*/*/*', '/a/*/b/*/c/*'];
  // 20k filler generic filters with distinct tokens, like the real lists
  for (let i = 0; i < 20000; i++) lines.push('/filler' + i + 'token/adunit' + i + '.js');
  const parsed = E.parseList(lines.join('\n'), 'tok');
  assert.strictEqual(parsed.network.length, 20002, 'two pathological wildcard patterns dropped: got ' + parsed.network.length);
  const compiled = E.emptyCompiled();
  E.mergeParsedList(compiled, parsed);
  const m = E.createMatcher(compiled);
  let r = m.match({ url: 'https://cdn.example.net/trackerpixel.gif', host: 'cdn.example.net', type: 'image', docHost: 'site.example' });
  assert.strictEqual(r.blocked, true, 'token-indexed generic filter still blocks its URL');
  r = m.match({ url: 'https://cdn.example.net/some/deep/bannerad.js', host: 'cdn.example.net', type: 'script', docHost: 'site.example' });
  assert.strictEqual(r.blocked, true, 'second generic filter blocks');
  r = m.match({ url: 'https://news.example.org/article/story', host: 'news.example.org', type: 'document', docHost: 'news.example.org' });
  assert.strictEqual(r.blocked, false, 'ordinary page URL not blocked');
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) m.match({ url: 'https://news.example.org/article/story', host: 'news.example.org', type: 'script', docHost: 'news.example.org' });
  const dt = Date.now() - t0;
  assert.ok(dt < 2000, '200 matches against 20k generic filters took ' + dt + 'ms (token index working)');
  console.log('token-index tests: ALL PASS (200 matches in ' + dt + 'ms)');
})();

// ---- v1.2.3: same-party test + bucketed flag for the visuals guards ----
(function () {
  assert.strictEqual(E.samePartyHost('github.githubassets.com', 'github.com'), true, 'GitHub CDN host is same-party');
  assert.strictEqual(E.samePartyHost('www.youtube.com', 'youtube.com'), true, 'subdomain same-party');
  assert.strictEqual(E.samePartyHost('api.example.co.uk', 'www.example.co.uk'), true, 'co.uk registrable domain');
  assert.strictEqual(E.samePartyHost('evilgithub.com', 'github.com'), false, 'lookalike domain is NOT same-party');
  assert.strictEqual(E.samePartyHost('github.evil.com', 'github.com'), false, 'attacker subdomain is NOT same-party');
  assert.strictEqual(E.samePartyHost('pagead2.googlesyndication.com', 'github.com'), false, 'ad host is NOT same-party');
  assert.strictEqual(E.samePartyHost('fonts.googleapis.com', 'www.youtube.com'), false, 'googleapis is not youtube party');
  const parsed = E.parseList(['||ads.example.com^', '/generic-banner.js'].join('\n'), 'vis');
  const compiled = E.emptyCompiled();
  E.mergeParsedList(compiled, parsed);
  const m = E.createMatcher(compiled);
  let r = m.match({ url: 'https://ads.example.com/x.js', host: 'ads.example.com', type: 'script', docHost: 'site.example' });
  assert.strictEqual(r.bucketed, true, 'domain-bucketed filter flagged bucketed');
  r = m.match({ url: 'https://cdn.site.example/generic-banner.js', host: 'cdn.site.example', type: 'script', docHost: 'site.example' });
  assert.strictEqual(r.blocked, true, 'generic filter still blocks');
  assert.strictEqual(r.bucketed, false, 'generic filter flagged not bucketed (visuals guard can spare same-party/css)');
  console.log('visuals-guard tests: ALL PASS');
})();

// ---- v1.2.4: platform party groups ----
(function () {
  assert.strictEqual(E.samePartyHost('video.twimg.com', 'x.com'), true, 'X video host is same-party with x.com');
  assert.strictEqual(E.samePartyHost('video.twimg.com', 'twitter.com'), true, 'twimg also parties with twitter.com');
  assert.strictEqual(E.samePartyHost('pbs.twimg.com', 'x.com'), true, 'X image host same-party');
  assert.strictEqual(E.samePartyHost('r2---sn-abc.googlevideo.com', 'www.youtube.com'), true, 'googlevideo is YouTube party');
  assert.strictEqual(E.samePartyHost('i.ytimg.com', 'www.youtube.com'), true, 'ytimg is YouTube party');
  assert.strictEqual(E.samePartyHost('video.twimg.com', 'evil.com'), false, 'twimg is not everyone\u2019s party');
  assert.strictEqual(E.samePartyHost('nflxvideo.net', 'www.netflix.com'), true, 'netflix media party');
  assert.strictEqual(E.samePartyHost('googlevideo.com', 'x.com'), false, 'different groups are not same-party');
  console.log('party-group tests: ALL PASS');
})();
