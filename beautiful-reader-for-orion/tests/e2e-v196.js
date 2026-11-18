// v1.9.6: (1) the guardian no longer moves a popover-open
// reader (the move itself was closing the reader on ad-heavy
// pages — Mac Observer video); (2) a foreign overlay that
// paints over the open reader is swept — hidden while the
// reader is open, restored on close — with shape rules that
// spare small furniture like cookie bars.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__check = overlayCheck; window.__close = closeReader; window.__tick = sweepTick;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
const html = `<!DOCTYPE html><html><head><title>Wall Story</title>
<meta property="og:title" content="Wall Story"></head><body><main><article>
<h1>Wall Story</h1>
${P('Alpha lede paragraph opens the story.')}
${P('Bravo second paragraph continues the account.')}
${P('Charlie third paragraph adds background and reaction.')}
${P('Delta fourth paragraph closes the piece.')}
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://wall.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const doc = w.document;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const S = w.__BR;
  let pill = null;
  for (let i = 0; i < 50 && !pill; i++) { await wait(80); pill = doc.getElementById('br-pill'); }
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  await wait(300);
  chk('reader open', S.open === true);

  // The anti-adblock wall: a fixed full-screen overlay.
  const wall = doc.createElement('div');
  wall.id = 'adwall';
  wall.setAttribute('style', 'position:fixed;inset:0;z-index:9999');
  const inner = doc.createElement('span');
  inner.textContent = 'An ad blocker is preventing this page from loading';
  wall.appendChild(inner);
  doc.body.appendChild(wall);
  wall.getBoundingClientRect = () => ({ width: 1024, height: 768, top: 0, left: 0, right: 1024, bottom: 768 });
  doc.elementFromPoint = () => inner;
  w.__check();
  chk('wall swept while reader open', wall.getAttribute('data-br-swept') === '1');
  chk('wall hidden with important', wall.style.display === 'none' && wall.style.getPropertyPriority('display') === 'important');
  chk('sweep recorded for restore', Array.isArray(S.swept) && S.swept.length === 1);

  // A small fixed cookie bar is furniture, not a wall.
  const bar = doc.createElement('div');
  bar.id = 'cookiebar';
  bar.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0');
  const barInner = doc.createElement('span');
  bar.appendChild(barInner);
  doc.body.appendChild(bar);
  bar.getBoundingClientRect = () => ({ width: 1024, height: 110, top: 658, left: 0, right: 1024, bottom: 768 });
  doc.elementFromPoint = () => barInner;
  w.__check();
  chk('cookie bar spared', bar.getAttribute('data-br-swept') === null && bar.style.display === '');

  // The Mac Observer shape: the fixed full-screen layer is
  // nested inside a STATIC, collapsed wrapper — v1.9.6 checked
  // only the root and missed it; the chain check catches it.
  const wrap = doc.createElement('div');
  wrap.id = 'wallwrapper';
  const fixedInner = doc.createElement('div');
  fixedInner.setAttribute('style', 'position:fixed;inset:0');
  const deep = doc.createElement('span');
  deep.textContent = 'Please disable your ad blocker';
  fixedInner.appendChild(deep);
  wrap.appendChild(fixedInner);
  doc.body.appendChild(wrap);
  fixedInner.getBoundingClientRect = () => ({ width: 1024, height: 768, top: 0, left: 0, right: 1024, bottom: 768 });
  doc.elementFromPoint = () => deep;
  w.__check();
  chk('nested wall swept by its wrapper root', wrap.getAttribute('data-br-swept') === '1' && wrap.style.display === 'none');

  // A wall that never intersects the sample points is still
  // caught by its signature text.
  const wrap2 = doc.createElement('div');
  wrap2.id = 'textwall';
  const tw = doc.createElement('div');
  tw.setAttribute('style', 'position:absolute;inset:0');
  tw.textContent = 'An ad blocker is preventing this page from loading. Failed to load website properly since html-load.com is blocked.';
  wrap2.appendChild(tw);
  doc.body.appendChild(wrap2);
  doc.elementFromPoint = () => null;
  w.__check();
  chk('signature-text wall swept without a hit', wrap2.getAttribute('data-br-swept') === '1');

  // The ten-second sweep window is running after open.
  chk('sweep window active after open', !!S.sweepTimer && S.sweepUntil > Date.now());

  // The wall's script un-hides its layer: enforcement re-hides
  // it, and a second un-hide gets it removed from the document.
  wall.style.setProperty('display', 'block', 'important');
  w.__tick();
  chk('un-hidden wall re-hidden by enforcement', wall.style.display === 'none' && wall.isConnected);
  wall.style.setProperty('display', 'block', 'important');
  w.__tick();
  chk('repeat offender removed from the document', !wall.isConnected);

  // Closing the reader restores the wall exactly.
  w.__close();
  chk('wall restored on close', wall.getAttribute('data-br-swept') === null && wall.style.display === '');
  chk('nested walls restored too', wrap.getAttribute('data-br-swept') === null && wrap2.getAttribute('data-br-swept') === null);
  chk('removed wall re-inserted on close', wall.isConnected && wall.getAttribute('data-br-swept') === null);
  chk('sweep window stopped on close', !S.sweepTimer);
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V196 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(1); });
