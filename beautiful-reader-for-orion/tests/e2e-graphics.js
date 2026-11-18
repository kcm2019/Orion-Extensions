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
<style>.brk-chip::before{content:'';background-color:#b58900;width:10px;height:10px;display:inline-block;margin-right:6px}</style>
</head><body style="background-color:#ffffff"><main><article>
<h1>The Missile Supply Problem</h1>
<p>${P(1)}</p><p>${P(2)}</p>
<div class="chart" id="supply-chart">
  <div style="font-weight:700;font-size:18px">Supply Chain Strain</div>
  <div class="brk-chip">1 missile</div>
  <div style="opacity:0">1.5%</div>
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
<div class="g-wrap" id="div-chart">
  <div style="font-weight:700;font-size:20px">Pentagon Suppliers</div>
  <div>Proportion of suppliers that support:</div>
  <div class="lgrow">
    <span class="lg"><span class="chip" style="background:#00616b"></span>1 missile</span>
    <span class="lg"><span class="chip" style="background:#00808f"></span>2 missiles</span>
    <span class="lg"><span class="chip" style="background:#02a3bc"></span>3 missiles</span>
    <span class="lg"><span class="chip" style="background:#88c9d7"></span>4 missiles</span>
    <span class="lg"><span class="chip" style="background:#c3e3ed"></span>5 missiles</span>
  </div>
  <div>Tier 2</div>
  <div class="bar">
    <div class="seg" style="background:#00616b;width:19%">19%</div>
    <div class="seg" style="background:#00808f;width:49%">49%</div>
    <div class="seg" style="background:#02a3bc;width:27%">27%</div>
    <div class="seg" style="background:#88c9d7;width:2%"></div>
    <div class="seg" style="background:#c3e3ed;width:3%"></div>
  </div>
  <div>Tier 3</div>
  <div class="bar">
    <div class="seg" style="background:#00616b;width:7%">7%</div>
    <div class="seg" style="background:#00808f;width:2%"></div>
    <div class="seg" style="background:#02a3bc;width:11%">11%</div>
    <div class="seg" style="background:#88c9d7;width:11%">11%</div>
    <div class="seg" style="background:#c3e3ed;width:69%">69%</div>
  </div>
  <div>Five missile systems share 69% of the suppliers in this tier</div>
</div>
<p>${P(7)}</p>
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
  // The WSJ shape (v1.18.2): a pure-div chart — no svg, no
  // canvas, no chart-ish class. jsdom has no layout, so the
  // painted-geometry scan gets stubbed layout sizes.
  const dc = w.document.getElementById('div-chart');
  Object.defineProperty(dc, 'offsetWidth', { value: 688, configurable: true });
  Object.defineProperty(dc, 'offsetHeight', { value: 420, configurable: true });
  const segW = [131, 337, 186, 14, 24, 48, 14, 76, 76, 475];
  dc.querySelectorAll('.seg').forEach((seg, i) => {
    Object.defineProperty(seg, 'offsetWidth', { value: segW[i], configurable: true });
    Object.defineProperty(seg, 'offsetHeight', { value: 40, configurable: true });
  });
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
  chk('two frozen graphics (svg chart + div chart)', gfx.length === 2);
  const divGfx = gfx.find((b) => b.html.indexOf('Pentagon Suppliers') >= 0);
  chk('pure-div chart frozen whole', !!divGfx);
  chk('div chart keeps its bar colours', !!divGfx && divGfx.html.indexOf('rgb(0, 97, 107)') >= 0 && divGfx.html.indexOf('Tier 2') >= 0);
  chk('div chart keeps its annotation', !!divGfx && divGfx.html.indexOf('Five missile systems share') >= 0);
  chk('div chart sized by layout size', !!divGfx && divGfx.w === 688 && divGfx.h === 420);
  chk('legend did not scatter into paragraphs', !blocks.some((b) => b.type === 'paragraph' && /1 missile/.test(b.text || '')));
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

  chk('frozen root carries the page ground colour', gfx.length && gfx[0].html.indexOf('background-color: rgb(255, 255, 255)') >= 0);
  chk('intentionally hidden label stays hidden', gfx.length && gfx[0].html.indexOf('1.5%') >= 0 && gfx[0].html.indexOf('opacity: 0') >= 0);
  chk('pseudo-element legend chip materialized', gfx.length && gfx[0].html.indexOf('rgb(181, 137, 0)') >= 0);

  // rendering
  const gEl = w.document.querySelector('#br-reader .br-graphic');
  chk('graphic renders in the reader', !!gEl && gEl.querySelector('svg') !== null);
  chk('graphic renders inside the scaler', !!gEl && gEl.classList.contains('br-graphic-fit') && !!gEl.querySelector('.br-graphic-scale'));
  const scaler = gEl && gEl.querySelector('.br-graphic-scale');
  chk('scaler holds the natural width', !!scaler && scaler.style.width === '640px');
  Object.defineProperty(gEl, 'clientWidth', { value: 320, configurable: true });
  w.dispatchEvent(new w.Event('resize'));
  chk('fit pass runs on resize', await waitFor(() => scaler && scaler.style.transform === 'scale(0.5)', 1500));
  chk('wrapper takes the scaled height', gEl.style.height === '150px');
  const eEls = w.document.querySelectorAll('#br-reader .br-embed iframe');
  chk('both embeds render iframes', eEls.length === 2);
  const genFrame = Array.from(eEls).find((f) => (f.getAttribute('src') || '').indexOf('graphics.example') >= 0);
  chk('graphic embed is sandboxed', !!genFrame && (genFrame.getAttribute('sandbox') || '').indexOf('allow-scripts') >= 0);
  chk('graphic embed keeps its aspect', !!genFrame && genFrame.parentElement.style.paddingTop === '50%');
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
