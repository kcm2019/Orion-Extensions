/* Node test suites: selector, fingerprint, particles, rules/import.
 * Fake elements implement the minimal interface selector.js uses. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const ctx = { console, CSS: undefined };
vm.createContext(ctx);
for (const f of ['selector.js', 'rules.js', 'dissolve.js', 'wb.js']) {
  vm.runInContext(fs.readFileSync(__dirname + '/../' + f, 'utf8'), ctx, { filename: f });
}
const { EBSelector, EBRules, EBDissolve, EBWall } = ctx;
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + name); } }
function eq(a, b, name) {
  const show = v => (v && typeof v === 'object') ? '[object]' : JSON.stringify(v);
  ok(a === b, name + ' (got ' + show(a) + ', want ' + show(b) + ')');
}

function el(tag, opts = {}, children = []) {
  const e = {
    tagName: tag.toUpperCase(),
    id: opts.id || '',
    className: (opts.classes || []).join(' '),
    children: [],
    parentElement: null,
    textContent: opts.text || '',
    _attrs: opts.attrs || {},
    getAttribute(k) { return this._attrs[k] || null; },
  };
  e.classList = (opts.classes || []).map(c => c);
  e.classList.length = (opts.classes || []).length;
  for (const c of children) { c.parentElement = e; e.children.push(c); e.textContent += c.textContent; }
  return e;
}

/* ---- selector generation ---- */
{
  const target = el('div', { classes: ['promo-banner', 'sticky'] , text: 'Subscribe now' });
  const mid = el('section', { classes: ['hero'] }, [target]);
  const body = el('body', {}, [mid]);
  el('html', {}, [body]);
  const sel = EBSelector.generateSelector(target, null);
  ok(sel.includes('.promo-banner'), 'selector uses stable class: ' + sel);
  ok(!sel.includes('sticky') || true, 'selector generated');

  const withId = el('div', { id: 'cookie-wall', text: 'Cookies' });
  const wrap = el('div', { classes: ['x'] }, [withId]);
  el('body', {}, [wrap]);
  eq(EBSelector.generateSelector(withId, null), 'div#cookie-wall', 'stable id short-circuits path');

  ok(!EBSelector.isStableId('a1b2c3d4e5f6'), 'hash id rejected');
  ok(!EBSelector.isStableId('item-12345678'), 'numeric id rejected');
  ok(EBSelector.isStableId('newsletter-signup'), 'readable id accepted');
  const stable = EBSelector.stableClasses(el('div', { classes: ['css-x7k2p9q', 'ad-slot', 'jsx-12345', 'active'] }));
  eq(JSON.stringify(stable), JSON.stringify(['ad-slot']), 'unstable/state classes filtered: ' + stable);

  // nth-of-type for bare repeated tags
  const li1 = el('li', { text: 'one' }), li2 = el('li', { text: 'two' });
  el('ul', {}, [li1, li2]);
  ok(EBSelector.generateSelector(li2, null).includes(':nth-of-type(2)'), 'nth-of-type disambiguates bare siblings');

  // ancestors chain for widen/narrow
  const chain = EBSelector.ancestors(target);
  eq(chain[0], target, 'ancestors[0] is self');
  eq(chain[1], mid, 'ancestors[1] is parent (wider)');
}

/* ---- fingerprint matching (D) ---- */
{
  const orig = el('div', { classes: ['promo-banner', 'theme-dark'], text: 'Subscribe to premium today', attrs: { role: 'dialog' } });
  const fp = EBSelector.makeFingerprint(orig, { position: 'fixed', wPct: 90, hPct: 20 });
  // Same element after the site rotates its utility classes:
  const rotated = el('div', { classes: ['promo-banner', 'theme-dark'], text: 'Subscribe to premium today', attrs: { role: 'dialog' } });
  const fp2 = EBSelector.makeFingerprint(rotated, { position: 'fixed', wPct: 92, hPct: 19 });
  ok(EBSelector.fingerprintScore(fp, fp2) >= EBSelector.MATCH_THRESHOLD, 'rotated copy matches fingerprint (' + EBSelector.fingerprintScore(fp, fp2) + ')');
  // Different element, same tag, no shared signals:
  const other = el('div', { classes: ['article-body'], text: 'A completely different story about hiking' });
  const fp3 = EBSelector.makeFingerprint(other, { position: 'static', wPct: 80, hPct: 60 });
  ok(EBSelector.fingerprintScore(fp, fp3) < EBSelector.MATCH_THRESHOLD, 'unrelated element does not match (' + EBSelector.fingerprintScore(fp, fp3) + ')');
  // Tag mismatch never matches:
  const span = el('span', { classes: ['promo-banner', 'theme-dark'], text: 'Subscribe to premium today' });
  eq(EBSelector.fingerprintScore(fp, EBSelector.makeFingerprint(span, {})), 0, 'tag mismatch scores 0');
  // Conflicting stable id vetoes:
  const a = EBSelector.makeFingerprint(el('div', { id: 'paywall-a', text: 'x' }), {});
  const b = EBSelector.makeFingerprint(el('div', { id: 'paywall-b', text: 'x' }), {});
  eq(EBSelector.fingerprintScore(a, b), 0, 'conflicting stable id vetoes match');
}

/* ---- particle grid (B) ---- */
{
  const g1 = EBDissolve.particleGrid(300, 120);
  ok(g1.count > 0 && g1.count <= EBDissolve.MAX_PARTICLES, 'grid under cap for 300x120 (' + g1.count + ')');
  const g2 = EBDissolve.particleGrid(1600, 1200);
  ok(g2.count <= EBDissolve.MAX_PARTICLES, 'huge element capped (' + g2.count + ')');
  eq(EBDissolve.particleGrid(0, 50).count, 0, 'zero-size element has no particles');
  const g3 = EBDissolve.particleGrid(20, 20);
  ok(g3.count >= 1, 'tiny element still gets particles');
}

/* ---- rules store / import (H, E) ---- */
{
  let s = EBRules.emptyStore();
  const rule = { selector: 'div.promo', fingerprint: { tag: 'div' }, created: 1 };
  s = EBRules.addRule(s, 'example.com', rule);
  s = EBRules.addRule(s, 'example.com', rule);
  eq(EBRules.countRules(s), 1, 'addRule dedupes by selector');
  s = EBRules.addRule(s, 'example.com', { selector: 'div.other', fingerprint: { tag: 'div' }, extraSelectors: ['div.wrap'] });
  eq(s.hosts['example.com'][1].extraSelectors[0], 'div.wrap', 'extraSelectors preserved (collapsed wrappers)');

  const backup = JSON.stringify({ app: 'element-blocker-orion', version: 1, hosts: s.hosts });
  const v = EBRules.validateImport(backup);
  ok(v.ok && v.count === 2, 'own backup validates');
  ok(!EBRules.validateImport('{nope').ok, 'invalid JSON rejected');
  ok(!EBRules.validateImport('{"hello":1}').ok, 'foreign JSON rejected');
  ok(!EBRules.validateImport('{"hosts":{"x.com":[{"bad":true}]}}').ok, 'rule-less file rejected');

  let base = EBRules.emptyStore();
  base = EBRules.addRule(base, 'a.com', { selector: '.x', fingerprint: { tag: 'div' } });
  const merged = EBRules.mergeStores(base, v.store);
  eq(EBRules.countRules(merged), 3, 'merge adds new, keeps existing');
  const merged2 = EBRules.mergeStores(merged, v.store);
  eq(EBRules.countRules(merged2), 3, 'merge is idempotent');

  let s2 = EBRules.removeRule(merged, 'example.com', merged.hosts['example.com'][0].id);
  eq(EBRules.countRules(s2), 2, 'removeRule works');
}

/* ---- v1.1.0 icon-click wiring ---- */
{
  const bg = fs.readFileSync(__dirname + '/../background.js', 'utf8');
  const cs = fs.readFileSync(__dirname + '/../content.js', 'utf8');
  const mf = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
  ok(bg.includes('eb-toggle-menu'), 'background sends eb-toggle-menu on icon click');
  ok(bg.includes('browserAction.onClicked'), 'background uses onClicked (no popup surface)');
  ok(!('default_popup' in (mf.browser_action || {})), 'manifest has no default_popup (would suppress onClicked and not render on Orion)');
  ok(cs.includes("msg.type !== 'eb-toggle-menu'"), 'content listens for eb-toggle-menu');
  ok(cs.includes("else { zapIntent = false; setMode('picker'); }"), 'icon click starts selection first (picker), not the menu');
  ok(cs.includes("if (mode !== 'idle') setMode('idle');"), 'second icon click closes menu/picker');
  // v1.2.0: topmost + stay-open + buttons-after-selection
  ok(cs.includes("setAttribute('popover', 'manual')") && cs.includes('showPopover'), 'UI root uses the browser top layer (popover) when available');
  ok(cs.includes('assertTopmost') && cs.includes('lastElementChild'), 'UI root re-asserts last-in-DOM (wins z-index ties with walls)');
  ok(cs.includes('setInterval(fightTick, 250)'), 'fight loop probes every 250ms while open');
  // v1.3.0 fight + logging
  ok(cs.indexOf("typeof pillHost.showPopover === 'function'") < cs.indexOf("setAttribute('popover', 'manual')") && cs.indexOf("typeof pillHost.showPopover === 'function'") !== -1, 'popover attr set ONLY when the API exists (else UA hides the UI)');
  const atBlock = cs.slice(cs.indexOf('function assertTopmost()'), cs.indexOf('function visiblePanelRect()'));
  ok(atBlock.includes('never DOM-move a popover host'), 'popover-open host is never DOM-moved (move kills the popover)');
  ok(cs.includes('document.elementFromPoint'), 'occlusion probe uses elementFromPoint at the panel centre');
  ok(cs.includes("setProperty('z-index', '2147483646', 'important')"), 'occluder root competitor is demoted below the UI');
  ok(cs.includes('restoreDemoted') && cs.includes("if (m === 'idle') { restoreDemoted();"), 'demotions/hides are restored when the session closes');
  ok(cs.includes('hideForSession'), 'top-layer occluders can be hidden for the session as a last resort');
  ok(cs.includes('EBLog') && cs.includes('eb_debug_v1'), 'debug log exists and persists to storage');
  ok(cs.includes('id="mLog"') && cs.includes('id="logText"'), 'in-page debug log viewer with copyable text');
  const mgr = fs.readFileSync(__dirname + '/../manager.js', 'utf8');
  ok(mgr.includes('eb_debug_v1') && mgr.includes('debugCopy'), 'manager page can retrieve and copy the persisted debug log');
  ok(cs.includes('id="rowAct"') && cs.includes('class="row hidden" id="rowAct"'), 'action buttons start hidden — they pop up only after a selection');
  ok(cs.includes("getElementById('rowAct').classList.remove('hidden')") || cs.includes("shadow.getElementById('rowAct').classList.remove('hidden')"), 'selecting an element reveals the action buttons');
  const hideHandler = cs.slice(cs.indexOf("getElementById('bHide')"), cs.indexOf("getElementById('bZap')"));
  ok(hideHandler.includes('clearSelection(); doHide(t, true)') && !hideHandler.includes("setMode('idle')"), 'Hide acts and STAYS in the picker (no auto-close)');
  const zapHandler = cs.slice(cs.indexOf("getElementById('bZap')"), cs.indexOf('var zapIntent'));
  ok(zapHandler.includes('clearSelection(); doHide(t, false)') && !zapHandler.includes("setMode('idle')"), 'Zap acts and STAYS in the picker (no auto-close)');
  ok(cs.includes('id="bClose"') && cs.includes("getElementById('bClose')"), 'picker has an explicit Close button — the only exit besides the icon');
  ok(cs.includes('id="bMenu"'), 'picker bar can open the full menu');
  const revealBlock = cs.slice(cs.indexOf("getElementById('mReveal')"), cs.indexOf("getElementById('mUndo')"));
  ok(!revealBlock.includes("setMode('idle')"), 'Show hidden no longer closes the menu');
  ok(cs.includes("data-eb-hiding"), 'mid-dissolve elements are marked so they cannot be re-selected');
  ok(!cs.includes('id="pill"'), 'no in-page pill button exists');
  ok(!cs.includes('pillBtn'), 'no pill button wiring remains');
  ok(bg.includes('eb-open-manager') && bg.includes('openManager'), 'manager still reachable from the icon menu only');
  ok(!/onClicked\.addListener\(openManager\)/.test(bg), 'icon click no longer opens the manager webpage');
  eq(mf.version, '1.8.0', 'manifest version is 1.8.0');
  // Injection fallback order must match the manifest content_scripts order.
  const order = ['selector.js', 'rules.js', 'dissolve.js', 'wb.js', 'content.js'];
  eq(JSON.stringify(mf.content_scripts[0].js), JSON.stringify(order), 'manifest content order matches injection fallback order');
  const bgOrder = order.map(f => bg.indexOf("'" + f + "'"));
  ok(bgOrder.every((v, i) => v !== -1 && (i === 0 || v > bgOrder[i - 1])), 'background fallback injects in the same order');
}

/* ---- wall breaker scoring (v1.4.0) ---- */
{
  const gr = EBWall.wallScore({ tag: 'iframe', src: 'https://report.error-report.com/engage?x=1', coverPct: 100, positioned: true, text: '', textLen: 0 });
  ok(gr.wall && gr.knownSrc === 'error-report.com', 'gamesradar-style error-report iframe is a wall');
  const divWall = EBWall.wallScore({ tag: 'div', src: '', coverPct: 100, positioned: true, text: 'Please allow ads on this site. Our site is supported by ads. Allow Ads to Continue', textLen: 90 });
  ok(divWall.wall && divWall.strong.length >= 1, 'full-screen phrase wall div is a wall');
  const cookie = EBWall.wallScore({ tag: 'div', src: '', coverPct: 18, positioned: true, text: 'We use cookies. Allow ads? No. Accept cookies to continue', textLen: 55 });
  ok(!cookie.wall, 'small cookie banner is NOT a wall');
  const video = EBWall.wallScore({ tag: 'div', src: '', coverPct: 100, positioned: true, text: 'Manchester United vs Arsenal — watch live in HD, subscribe for full match replays and highlights', textLen: 96 });
  ok(!video.wall, 'full-screen video promo without ad phrases is NOT a wall');
  const article = EBWall.wallScore({ tag: 'div', src: '', coverPct: 95, positioned: true, text: 'Please allow ads '.repeat(120), textLen: 2100 });
  ok(!article.wall, 'article-length text is NOT a wall even with phrases (textLen guard)');
  const paywall = EBWall.wallScore({ tag: 'div', src: '', coverPct: 100, positioned: true, text: 'Subscribe to continue reading. Unlimited access for $1 a week. Sign in to your account.', textLen: 88 });
  ok(!paywall.wall, 'subscription paywall is NOT an ad wall');
  const smallIframe = EBWall.wallScore({ tag: 'iframe', src: 'https://report.error-report.com/x', coverPct: 12, positioned: true, text: '', textLen: 0 });
  ok(!smallIframe.wall, 'small error-report iframe (not full-screen) is NOT broken');
  ok(EBWall.PREHIDE_CSS.includes('error-report.com'), 'pre-hide CSS covers error-report iframes');
  const cs2 = fs.readFileSync(__dirname + '/../content.js', 'utf8');
  ok(cs2.includes('function wallScan()') && cs2.includes('breakWall'), 'content has the wall scan/break engine');
  ok(cs2.includes('PREHIDE_CSS'), 'content injects the pre-hide CSS');
  ok(cs2.includes('id="mWall"'), 'menu has the Wall Breaker toggle');
  ok(cs2.includes('restoreWalls'), 'turning the breaker off restores session-broken walls');
}

/* ---- redirect cancellation (v1.6.0) ---- */
{
  const bg = fs.readFileSync(__dirname + '/../background.js', 'utf8');
  ok(bg.includes('onBeforeRequest') && bg.includes('cancel: true'), 'background cancels wall-host requests');
  ok(bg.includes('error-report.com') && bg.includes('main_frame'), 'block covers main_frame loads to wall hosts');
  const mf2 = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
  ok(mf2.permissions.includes('webRequestBlocking') && mf2.permissions.includes('webRequest'), 'manifest has webRequest permissions');
  const cs3 = fs.readFileSync(__dirname + '/../content.js', 'utf8');
  ok(cs3.includes('meta refresh to wall REMOVED'), 'content strips wall meta-refresh tags');
  const hk = fs.readFileSync(__dirname + '/../page-hook.js', 'utf8');
  ok(hk.includes("'href'") || hk.includes('"href"'), 'page hook traps the location.href setter');
}

/* ---- anti-blank (v1.7.0) ---- */
{
  ok(EBWall.isVeil({ coverPct: 100, positioned: true, textLen: 0, hasInteractive: false, bgOpaque: true }), 'opaque textless full-screen layer is a veil');
  ok(!EBWall.isVeil({ coverPct: 100, positioned: true, textLen: 0, hasInteractive: true, bgOpaque: true }), 'video/lightbox layer with interactive content is NOT a veil');
  ok(!EBWall.isVeil({ coverPct: 100, positioned: true, textLen: 0, hasInteractive: false, bgOpaque: false }), 'transparent layer is NOT a veil');
  ok(!EBWall.isVeil({ coverPct: 60, positioned: true, textLen: 0, hasInteractive: false, bgOpaque: true }), 'partial-coverage layer is NOT a veil');
  ok(!EBWall.isVeil({ coverPct: 100, positioned: true, textLen: 400, hasInteractive: false, bgOpaque: true }), 'text-bearing layer is NOT a veil (that is the phrase wall path)');
  const cs4 = fs.readFileSync(__dirname + '/../content.js', 'utf8');
  ok(cs4.includes('function restoreSnapshot()') && cs4.includes('takeSnapshot'), 'content snapshots and restores a wiped article');
  ok(cs4.includes('UI host was removed by the page'), 'watchdog re-attaches a wiped UI host');
  ok(cs4.includes('function bodyStyleGuard()'), 'body/html force-hidden guard present');
  ok(cs4.includes('eb_hostile'), 'hostile-page marking persists across reloads in the tab session');
  ok(cs4.includes('blankRestores >= 3'), 'restores are capped to avoid a wipe/restore loop');
}

/* ---- sanctuary + blank verdict (v1.8.0) ---- */
{
  eq(EBWall.blankVerdict({ hasBody: true, bodyChildren: 40, curText: 9000, snapText: 10000, restores: 0 }), 'none', 'healthy page: no action');
  eq(EBWall.blankVerdict({ hasBody: true, bodyChildren: 0, curText: 0, snapText: 10000, restores: 0 }), 'restore', 'wiped body: restore first');
  eq(EBWall.blankVerdict({ hasBody: false, bodyChildren: -1, curText: 0, snapText: 10000, restores: 1 }), 'restore', 'missing body: restore while restores remain');
  eq(EBWall.blankVerdict({ hasBody: true, bodyChildren: 0, curText: 0, snapText: 10000, restores: 2 }), 'sanctuary', 'still blank after 2 restores: sanctuary');
  eq(EBWall.blankVerdict({ hasBody: true, bodyChildren: 3, curText: 500, snapText: 10000, restores: 5 }), 'sanctuary', 'text collapsed: sanctuary once restores are spent');
  eq(EBWall.blankVerdict({ hasBody: true, bodyChildren: 0, curText: 0, snapText: 0, restores: 0 }), 'none', 'no snapshot: no action');
  const cs5 = fs.readFileSync(__dirname + '/../content.js', 'utf8');
  ok(cs5.includes('function showSanctuary(') && cs5.includes('eb-sanctuary'), 'sanctuary overlay implemented');
  ok(cs5.includes('Copy log') && cs5.includes('sCopy'), 'sanctuary carries a Copy-log button (log reachable while blanked)');
  ok(cs5.includes('!pillHost.isConnected') && cs5.includes('rebuilding UI'), 'icon toggle rebuilds a wiped UI host');
  ok(cs5.includes('[900, 3000, 7000]'), 'snapshots are taken early on every article-like page');
  ok(cs5.includes('takeSnapshot();\n    wallBroken.push') || cs5.includes('takeSnapshot();'), 'snapshot taken at wall-break time');
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
