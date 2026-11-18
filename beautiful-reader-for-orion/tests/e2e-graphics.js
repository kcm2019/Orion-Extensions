// v1.18.0 custom graphics:
//  - a sizeable non-video iframe inside the article becomes a
//    LIVE graphic embed at its own aspect, sandboxed
//  - a known-provider iframe qualifies even when small
//  - an ad iframe never does
//  - an inline SVG/div chart is frozen into a graphic block:
//    scripts and handlers stripped, content preserved
//  - prose sections and link-heavy modules are NOT frozen
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
const P = (n) => 'Paragraph ' + n + ' of the defence analysis explains in considerable detail how the supplier base for missile components consolidated over two decades, leaving primes exposed when production had to surge quickly.';
const html = `<!DOCTYPE html><html><head><title>Missile Supply</title>
<meta property="og:title" content="The Missile Supply Problem">
</head><body><main><article>
<h1>The Missile Supply Problem</h1>
<p>${P(1)}</p><p>${P(2)}</p>
<div class="chart" id="supply-chart">
  <div style="font-weight:700;font-size:18px">Supply Chain Strain</div>
  <svg width="300" height="60" viewBox="0 0 300 60"><rect x="0" y="10" width="120" height="30" fill="#1f6f7a"></rect><rect x="120" y="10" width="180" height="30" fill="#7fb3bd"></rect></svg>
  <div><span style="background:#1f6f7a;color:#fff;padding:2px 8px">19%</span> <span style="background:#7fb3bd;padding:2px 8px">69%</span></div>
  <script>window.__evil = 1;</script>
  <div onclick="steal()">Tap target</div>
</div>
<p>${P(3)}</p>
<iframe src="https://graphics.example.com/embed/supply" width="640" height="320" title="chart"></iframe>
<p>${P(4)}</p>
<iframe src="https://datawrapper.dwcdn.net/abc123/1/" width="300" height="120" title="dw"></iframe>
<iframe src="https://googleads.g.doubleclick.net/pagead/html/r.html" width="728" height="90" title="ad"></iframe>
<div class="chart" id="section-with-chart">
  <svg width="200" height="80"><rect x="0" y="0" width="200" height="80" fill="#ccc"></rect></svg>
  <p>First long paragraph of a genuine article section that merely contains a chart inside it, with plenty of prose to read here.</p>
  <p>Second long paragraph of the same section, again carrying real sentences well beyond fifty characters each in length.</p>
  <p>Third long paragraph to push the prose total past the guard threshold for sections that contain graphics.</p>
</div>
<p>${P(5)}</p><p>${P(6)}</p>
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://www.wsj.com/world/missile-supply', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  // jsdom has no layout: give the chart its on-device size
  const chart = w.document.getElementById('supply-chart');
  chart.getBoundingClientRect = () => ({ width: 640, height: 300, top: 0, left: 0, right: 640, bottom: 300 });
  const section = w.document.getElementById('section-with-chart');
  section.getBoundingClientRect = () => ({ width: 640, height: 420, top: 0, left: 0, right: 640, bottom: 420 });
  w.eval(core); w.eval(reader);
  const S = w.__BR;
  chk('settings init', await waitFor(() => !!S.settings));
  const pill = w.document.querySelector('#br-pill');
  chk('pill appears', !!pill);
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  chk('reader opens', await waitFor(() => S.open === true));

  const blocks = S.current.blocks;
  const gfx = blocks.filter((b) => b.type === 'graphic');
  const embeds = blocks.filter((b) => b.type === 'embed');
  chk('exactly one frozen graphic', gfx.length === 1);
  chk('graphic html keeps the chart title', gfx.length && gfx[0].html.indexOf('Supply Chain Strain') >= 0);
  chk('graphic html keeps the svg bars', gfx.length && gfx[0].html.indexOf('<svg') >= 0 && gfx[0].html.indexOf('19%') >= 0);
  chk('graphic html has no script', gfx.length && gfx[0].html.indexOf('<script') < 0 && gfx[0].html.indexOf('__evil') < 0);
  chk('graphic html has no inline handlers', gfx.length && gfx[0].html.indexOf('onclick') < 0);
  chk('graphic html strips element ids', gfx.length && gfx[0].html.indexOf('supply-chart') < 0);
  chk('two live embeds (generic + provider)', embeds.length === 2);
  const gen = embeds.find((b) => b.src.indexOf('graphics.example.com') >= 0);
  const dw = embeds.find((b) => b.src.indexOf('datawrapper') >= 0);
  chk('generic embed flagged graphic with dims', !!gen && gen.graphic === true && gen.w === 640 && gen.h === 320);
  chk('provider embed qualifies despite small height', !!dw && dw.graphic === true);
  chk('ad iframe produced no block', !blocks.some((b) => b.src && b.src.indexOf('doubleclick') >= 0));
  chk('prose section paragraphs still extracted', blocks.filter((b) => b.type === 'paragraph').length >= 8);

  // rendering
  const gEl = w.document.querySelector('#br-reader .br-graphic');
  chk('graphic renders in the reader', !!gEl && gEl.querySelector('svg') !== null);
  const eEls = w.document.querySelectorAll('#br-reader .br-embed iframe');
  chk('both embeds render iframes', eEls.length === 2);
  const genFrame = Array.from(eEls).find((f) => (f.getAttribute('src') || '').indexOf('graphics.example') >= 0);
  chk('graphic embed is sandboxed', !!genFrame && (genFrame.getAttribute('sandbox') || '').indexOf('allow-scripts') >= 0);
  chk('graphic embed keeps its aspect', !!genFrame && genFrame.parentElement.style.paddingTop === '50%');
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
