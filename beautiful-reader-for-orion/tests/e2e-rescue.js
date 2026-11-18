// Rescue harvest: a layout wrapper named for a page feature
// ("layout--sidebar", NY Post's real trap) must not prune the
// article it wraps — but a true link-dense sidebar and a consent
// box must stay pruned even in rescue mode.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose. '.repeat(4)}</p>`;
const story =
  P('Alpha lede paragraph opens the rescued story with real reporting.') +
  P('Bravo second paragraph continues the account with more specifics.') +
  P('Charlie third paragraph adds background and a quote from officials.') +
  P('Delta fourth paragraph closes the piece with context and reaction.');

// Case 1: NY Post shape — article column inside a "--sidebar" layout
// wrapper, under <main>/<article> ancestors that outscore it.
const html1 = `<!DOCTYPE html><html><head><title>Story — Post</title></head><body>
<main><article>
<div class="layout layout--sidebar"><div class="layout__grid">
<div class="layout__item layout__item--main"><div class="single__content entry-content">
<h1>A Headline Long Enough To Be The Title</h1>${story}
</div></div>
<aside class="rail"><p><a href="/a">Related link one</a></p><p><a href="/b">Related link two</a></p></aside>
</div></div>
</article></main></body></html>`;
const dom1 = new JSDOM(html1, { url: 'https://nypost.example/story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w1 = dom1.window;
w1.fetch = () => Promise.reject(new Error('offline'));
w1.eval(core); w1.eval(reader);
const a1 = w1.__EX(w1.document, w1.location.href);
chk('trapped article extracts readable', a1.readable === true);
chk('story paragraphs rescued', a1.blocks.filter(b => b.type === 'paragraph').length >= 4 && a1.blocks.some(b => (b.text || '').includes('Alpha lede')));
chk('rail links not harvested', !a1.blocks.some(b => (b.text || '').includes('Related link')));

// Case 2: the only other text is a true sidebar (link-dense) and a
// consent box (legal boilerplate) — rescue must leave both pruned.
const sidePs = Array.from({ length: 8 }, (_, i) => `<p><a href="/s${i}">Popular story headline number ${i} with some length</a></p>`).join('');
const legal = '<p>We use cookies and similar technologies to collect personal information, process data, and share information with our partners for advertising and analytics purposes under applicable privacy law and our cookie policy terms.</p>'.repeat(3);
const html2 = `<!DOCTYPE html><html><head><title>Thin — Site</title></head><body>
<main><div class="layout layout--sidebar"><div class="content"><p>Short stub.</p></div>
<aside class="sidebar">${sidePs}</aside>
<div class="consent-box">${legal}</div>
</div></main></body></html>`;
const dom2 = new JSDOM(html2, { url: 'https://thin.example/page', pretendToBeVisual: true, runScripts: 'outside-only' });
const w2 = dom2.window;
w2.fetch = () => Promise.reject(new Error('offline'));
w2.eval(core); w2.eval(reader);
const a2 = w2.__EX(w2.document, w2.location.href);
chk('link-dense sidebar stays pruned in rescue', !a2.blocks.some(b => (b.text || '').includes('Popular story headline')));
chk('consent text stays pruned in rescue', !a2.blocks.some(b => (b.text || '').includes('cookies and similar technologies')));
chk('thin page still not readable', a2.readable === false);

// Case 3: an ordinary article is untouched by the rescue path.
const html3 = `<!DOCTYPE html><html><head><title>Plain — Site</title></head><body>
<article><h1>A Headline Long Enough To Be The Title</h1>${story}</article></body></html>`;
const dom3 = new JSDOM(html3, { url: 'https://plain.example/story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w3 = dom3.window;
w3.fetch = () => Promise.reject(new Error('offline'));
w3.eval(core); w3.eval(reader);
const a3 = w3.__EX(w3.document, w3.location.href);
chk('ordinary article still extracts', a3.readable === true && a3.blocks.filter(b => b.type === 'paragraph').length >= 4);

setTimeout(() => { chk('pill appears on the rescued page', !!w1.document.getElementById('br-pill')); process.exit(fail ? 1 : 0); }, 3400);
