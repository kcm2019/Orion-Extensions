// v1.9.2: Export PDF (with images) came out text-only on device.
// The print clone's images were fresh nodes with loading="lazy"
// inside a display:none subtree, so their loads never started
// before the print snapshot. Fix: clone images are pointed at
// the live images' URLs, forced eager, and printing waits until
// every clone image has settled (load or error, capped).
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
const html = `<!DOCTYPE html><html><head><title>Export Story</title>
<meta property="og:title" content="Export Story"></head><body><main><article>
<h1>Export Story</h1>
${P('Alpha lede paragraph opens the story.')}
<figure><img src="https://images.example.com/body-photo.jpg" width="1200" height="800"><figcaption>A photo with a caption.</figcaption></figure>
${P('Bravo second paragraph continues the account.')}
${P('Charlie third paragraph adds background and reaction.')}
${P('Delta fourth paragraph closes the piece.')}
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://export.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const doc = w.document;
  w.fetch = () => Promise.reject(new Error('offline'));
  let printed = false;
  w.print = () => { printed = true; };
  w.eval(core); w.eval(reader);
  // Wait for detection + pill, then open.
  let pill = null;
  for (let i = 0; i < 60 && !pill; i++) { await wait(100); pill = doc.getElementById('br-pill'); }
  chk('pill appears', !!pill);
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  await wait(300);
  chk('reader open', w.__BR.open === true);
  const gear = doc.querySelector('[data-act="aa"]');
  gear.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  const pdfBtn = Array.from(doc.querySelectorAll('.br-mrow')).find((b) => b.textContent.includes('Export PDF'));
  chk('export pdf row exists', !!pdfBtn);
  pdfBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(350);
  const print = doc.getElementById('br-print');
  chk('print clone built', !!print);
  const imgs = print ? Array.from(print.querySelectorAll('img')) : [];
  chk('clone carries the article image', imgs.length >= 1 && imgs.some((im) => (im.getAttribute('src') || '').includes('body-photo.jpg')));
  chk('clone images are not lazy', imgs.every((im) => im.getAttribute('loading') !== 'lazy'));
  chk('print waits for images', printed === false);
  // Simulate the images arriving.
  imgs.forEach((im) => im.dispatchEvent(new w.Event('load')));
  await wait(400);
  chk('print fires once images settle', printed === true);
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V192 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(1); });
