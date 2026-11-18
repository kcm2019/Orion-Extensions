/* Wall Breaker scoring tests for Beautiful Reader (wallbreaker.js). */
'use strict';
const fs = require('fs');
const vm = require('vm');
let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log('FAIL: ' + n); } }
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../wallbreaker.js', 'utf8'), sandbox);
const W = sandbox.BRWall;
ok(!!W, 'BRWall exported');
ok(W.wallScore({ tag: 'iframe', src: 'https://report.error-report.com/engage', coverPct: 100, positioned: true, text: '', textLen: 0 }).wall, 'error-report iframe is a wall');
ok(W.wallScore({ tag: 'div', src: '', coverPct: 100, positioned: true, text: 'Please allow ads on this site. Allow Ads to Continue', textLen: 52 }).wall, 'phrase wall div is a wall');
ok(!W.wallScore({ tag: 'div', src: '', coverPct: 18, positioned: true, text: 'We use cookies. Accept cookies to continue', textLen: 42 }).wall, 'cookie banner is NOT a wall');
ok(!W.wallScore({ tag: 'div', src: '', coverPct: 100, positioned: true, text: 'Subscribe to continue reading. Unlimited access for $1 a week.', textLen: 60 }).wall, 'paywall is NOT a wall');
ok(!W.wallScore({ tag: 'div', src: '', coverPct: 95, positioned: true, text: 'Please allow ads '.repeat(120), textLen: 2100 }).wall, 'article-length text is NOT a wall');
ok(W.isVeil({ coverPct: 100, positioned: true, textLen: 0, hasInteractive: false, bgOpaque: true }), 'opaque textless layer is a veil');
ok(!W.isVeil({ coverPct: 100, positioned: true, textLen: 0, hasInteractive: true, bgOpaque: true }), 'interactive layer is NOT a veil');
ok(W.PREHIDE_CSS.includes('error-report.com'), 'prehide CSS present');
const mf = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
ok(mf.version === '1.16.2', 'manifest version 1.16.2');
ok(mf.content_scripts[0].run_at === 'document_start' && mf.content_scripts[0].js[0] === 'wallbreaker.js', 'wallbreaker runs at document_start');
ok(mf.content_scripts[1].js.join() === 'reader-core.js,reader.js', 'reader scripts unchanged, still document_idle');
ok(mf.permissions.includes('webRequestBlocking'), 'webRequestBlocking permission present');
ok(mf.background.scripts[0] === 'br-background.js', 'background registered');
const bg = fs.readFileSync(__dirname + '/../br-background.js', 'utf8');
ok(bg.includes('onBeforeRequest') && bg.includes('cancel: true'), 'background cancels wall-host loads');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
ok(core.includes('wallBreaker: true'), 'wallBreaker defaults on in settings');
ok(mf.content_scripts[1].run_at === 'document_start', 'reader script runs at document_start (fast draw)');
/* v1.14.0: blank verdict + sanctuary material (Element Blocker v1.8.0 port) */
ok(typeof W.blankVerdict === 'function', 'blankVerdict exported');
ok(W.blankVerdict({ snapText: 0, hasBody: true, bodyChildren: 3, curText: 0, restores: 0 }) === 'none', 'no snapshot -> none');
ok(W.blankVerdict({ snapText: 5000, hasBody: true, bodyChildren: 3, curText: 4800, restores: 0 }) === 'none', 'healthy page -> none');
ok(W.blankVerdict({ snapText: 5000, hasBody: true, bodyChildren: 3, curText: 100, restores: 0 }) === 'restore', 'blanked, no restores yet -> restore');
ok(W.blankVerdict({ snapText: 5000, hasBody: true, bodyChildren: 3, curText: 100, restores: 1 }) === 'restore', 'blanked, one restore -> restore');
ok(W.blankVerdict({ snapText: 5000, hasBody: true, bodyChildren: 3, curText: 100, restores: 2 }) === 'sanctuary', 'blanked after two restores -> sanctuary');
ok(W.blankVerdict({ snapText: 5000, hasBody: false, bodyChildren: -1, curText: 0, restores: 0 }) === 'restore', 'body gone -> blanked');
ok(W.blankVerdict({ snapText: 5000, hasBody: true, bodyChildren: 0, curText: 0, restores: 3 }) === 'sanctuary', 'empty body after restores -> sanctuary');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const parser = new (new JSDOM('').window.DOMParser)();
const snapHtml = '<div id="ad"><p>tiny</p></div><article><h1>Saved Story</h1>' +
  '<p>' + 'The saved article text runs long enough to be the obvious main content of the snapshot page. '.repeat(8) + '</p>' +
  '<script>alert(1)</script><iframe src="https://report.error-report.com/x"></iframe></article>';
const sanc = W.sanctuaryArticleHTML(snapHtml, parser);
ok(sanc.includes('Saved Story'), 'sanctuary html keeps the article');
ok(!sanc.includes('<script') && !sanc.includes('<iframe'), 'sanctuary html strips scripts and iframes');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
