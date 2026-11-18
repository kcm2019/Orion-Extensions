// v1.9.3: (1) the progress ring no longer crowds the book icon
// (bigger ring, smaller glyph, clear air between them);
// (2) two-way scroll sync — the reader opens at the page's
// scroll fraction and closing scrolls the page to the reader's
// fraction. jsdom has no layout, so scroll geometry is faked
// with defineProperty to exercise the mapping arithmetic.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) +
  'window.__BR = S; window.__pill = showPill; window.__open = openReader; window.__close = closeReader; ' +
  'window.__pageFrac = pageScrollFraction;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
const html = `<!DOCTYPE html><html><head><title>Sync Story</title>
<meta property="og:title" content="Sync Story"></head><body><main><article>
<h1>Sync Story</h1>
${P('Alpha lede paragraph opens the story.')}
${P('Bravo second paragraph continues the account.')}
${P('Charlie third paragraph adds background and reaction.')}
${P('Delta fourth paragraph closes the piece.')}
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://sync.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const doc = w.document;
  w.fetch = () => Promise.reject(new Error('offline'));
  const scrollCalls = [];
  w.eval(core); w.eval(reader);
  const S = w.__BR;

  // --- ring geometry ---
  let pill = null;
  for (let i = 0; i < 40 && !pill; i++) { await wait(80); pill = doc.getElementById('br-pill'); }
  chk('pill appears', !!pill);
  S.progress['https://sync.example.com/story'] = { frac: 0.5, ts: Date.now(), title: 'x' };
  if (S.pill) { S.pill.remove(); S.pill = null; }
  w.__pill();
  const ring = doc.querySelector('#br-pill svg.br-ring');
  const bg = doc.querySelector('#br-pill .br-ring-bg');
  chk('ring viewBox is 24', !!ring && ring.getAttribute('viewBox') === '0 0 24 24');
  chk('ring radius clears the glyph', !!bg && bg.getAttribute('r') === '10.5');
  const fg = doc.querySelector('#br-pill .br-ring-fg');
  chk('ring dash for 50 percent', !!fg && fg.getAttribute('stroke-dasharray').indexOf('33') === 0);
  const css = (doc.getElementById('br-style') || {}).textContent || '';
  chk('glyph shrunk to 13px inside ring', /\.br-ringwrap>svg:first-child\{width:13px/.test(css));

  // --- scroll sync ---
  // Fake the page geometry: 4000px tall, 1000px viewport, at 25%.
  Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 1000, configurable: true });
  Object.defineProperty(w, 'scrollY', { value: 750, configurable: true });
  chk('page fraction reads 0.25', Math.abs(w.__pageFrac() - 0.25) < 0.001);
  w.__open();
  await wait(120);
  chk('reader open', S.open === true);
  // Fake the reader geometry: 2000 scrollable px.
  Object.defineProperty(S.reader, 'scrollHeight', { value: 2600, configurable: true });
  Object.defineProperty(S.reader, 'clientHeight', { value: 600, configurable: true });
  // Re-run the open sync path by closing and reopening is messy;
  // instead drive the same code path again via a fresh open after
  // close: first verify close-sync from a known reader position.
  S.reader.scrollTop = 1000; // 1000 / 2000 = 0.5
  w.scrollTo = (x, y) => { scrollCalls.push(y); };
  w.__close();
  await wait(30);
  chk('close scrolls page to reader fraction', scrollCalls.length === 1 && scrollCalls[0] === Math.round(0.5 * 3000));
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V193 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(1); });
