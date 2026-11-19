// v1.18.4: 'Website Font' mode adopts the page's HEADLINE font
// for the reader title and in-article headings, separately from
// the body font — sites that set a display face on the h1 and a
// text face on paragraphs (Patagonia: serif headline, sans body)
// should read in the reader the way they read on the page.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const P = (n) => 'Paragraph ' + n + ' of the shell guide explains in considerable detail how the waterproof membrane, the face fabric and the insulation each behave when the weather turns, and when a softer shell is the better tool for the day.';
const html = `<!DOCTYPE html><html><head><title>Shell Guide</title>
<style>
  article h1 { font-family: "Display Serif", Georgia, serif; font-weight: 500; }
  article h2 { font-family: "Body Sans", Helvetica, Arial, sans-serif; }
  article p { font-family: "Body Sans", Helvetica, Arial, sans-serif; }
</style>
</head><body>
<main><article>
<h1>Hard-Shell vs. Soft-Shell Jackets</h1>
<p>${P(1)}</p><p>${P(2)}</p>
<h2>What a hard shell does</h2>
<p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>
</body></html>`;
const URL = 'https://www.patagonia.example/stories/shell-guide';

function makePage(settings) {
  const dom = new JSDOM(html, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  if (settings) w.localStorage.setItem('br:br.settings.v1', JSON.stringify(settings));
  w.eval(core); w.eval(reader);
  return w;
}

async function openReader(w) {
  const S = w.__BR;
  await waitFor(() => S.settings);
  const pillShown = await waitFor(() => !!w.document.querySelector('#br-pill'));
  chk('pill appears', pillShown);
  const pill = w.document.querySelector('#br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
  const opened = await waitFor(() => w.document.querySelector('#br-reader').classList.contains('br-open'));
  chk('reader opens', opened);
  return S;
}

(async () => {
  chk('stylesheet gives the title the heading stack', /\.br-title\{font-family:var\(--br-font-head/.test(_r));
  chk('stylesheet gives the standfirst the heading stack', /\.br-subtitle\{font-family:var\(--br-font-head/.test(_r));
  chk('title weight follows the heading weight var', /\.br-title\{[^}]*font-weight:var\(--br-font-head-weight,800\)/.test(_r));

  // --- Website Font mode: headline face adopted separately ---
  const w = makePage({ font: 'website' });
  const S = await openReader(w);
  chk('body stack captured from the paragraphs', !!S.siteFont && S.siteFont.indexOf('Body Sans') >= 0);
  chk('heading stack captured from the h1', !!S.siteHeadFont && S.siteHeadFont.indexOf('Display Serif') >= 0);
  chk('heading weight captured from the h1', S.siteHeadWeight === 500);
  const rEl = w.document.querySelector('#br-reader');
  chk('--br-font-head carries the display face', rEl.style.getPropertyValue('--br-font-head').indexOf('Display Serif') >= 0);
  chk('--br-font-head-weight carries 500', rEl.style.getPropertyValue('--br-font-head-weight') === '500');
  chk('--br-font carries the body face', rEl.style.getPropertyValue('--br-font').indexOf('Body Sans') >= 0);

  // --- A named font: no heading override ---
  const w2 = makePage({ font: 'newyork' });
  const S2 = await openReader(w2);
  const rEl2 = w2.document.querySelector('#br-reader');
  chk('named font sets no heading override', rEl2.style.getPropertyValue('--br-font-head') === '');
  chk('named font sets no heading weight', rEl2.style.getPropertyValue('--br-font-head-weight') === '');
  chk('named font keeps its own stack', rEl2.style.getPropertyValue('--br-font').indexOf('New York') >= 0);

  console.log(fail ? fail + ' FAILURES' : 'ALL SITEFONT PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
