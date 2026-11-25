// v1.21.1: site-style leak shield. The reader lives
// in the page's own document, so a site's bare
// element rules paint reader elements too. IB Times
// ships figure{background-color:#fff} and
// figcaption{background-color:#f5f5f5} — invisible
// under light reader themes, but under a dark theme
// (system dark + Follow System) Kurt's screenshot
// showed the caption strip rendered white with the
// theme's light caption text washed out on top.
// Fix: #br-reader figure/figcaption/img are pinned
// background:transparent!important — the reader
// never wants a background on those elements (its
// own card/cell backgrounds live on classes).
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__open = openReader;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}
const P = (n) => 'Paragraph ' + n + ' of the fixture story carries enough ordinary prose about the committee hearing, the witnesses who testified across two long days of questioning, and the documents entered into the public record for anyone following the case in detail.';
const html = `<!DOCTYPE html><html><head><title>Leak fixture</title><style>figure{background-color:#fff}figcaption{background-color:#f5f5f5;color:#444}</style></head><body><main><article>
<h1>Leak fixture story</h1>
<figure><img src="https://example.com/hero.jpg" width="800" height="450"><figcaption>The hero caption describing the photograph and its credit line</figcaption></figure>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p>
<figure><img src="https://example.com/body.jpg" width="800" height="450"><figcaption>The body image caption that must stay on the theme background</figcaption></figure>
<p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://news.example.com/story/leak', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  chk('pill appears', await waitFor(() => !!w.document.querySelector('#br-pill')));
  w.__open();
  const opened = await waitFor(() => { const r = w.document.querySelector('#br-reader'); return !!r && r.classList.contains('br-open'); });
  chk('reader opens', opened);
  const r = w.document.querySelector('#br-reader');
  const figs = r.querySelectorAll('figure');
  chk('figures rendered', figs.length >= 2);
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';
  let figOk = true, capOk = true, imgOk = true, colOk = true;
  figs.forEach((f) => {
    if (w.getComputedStyle(f).backgroundColor !== TRANSPARENT) figOk = false;
    const im = f.querySelector('img');
    if (im && w.getComputedStyle(im).backgroundColor !== TRANSPARENT) imgOk = false;
    const cap = f.querySelector('figcaption');
    if (cap) {
      if (w.getComputedStyle(cap).backgroundColor !== TRANSPARENT) capOk = false;
      if (w.getComputedStyle(cap).color === 'rgb(68, 68, 68)') colOk = false; // the site's #444 must not win
    }
  });
  chk('figure backgrounds stay transparent under hostile site CSS', figOk);
  chk('figcaption backgrounds stay transparent', capOk);
  chk('img backgrounds stay transparent', imgOk);
  chk('caption color comes from the theme, not the site', colOk);
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
