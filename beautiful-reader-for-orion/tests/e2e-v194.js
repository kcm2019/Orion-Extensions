// v1.9.5 (viewer part): the image viewer fades in on open and
// fades out on close instead of snapping. v1.9.4 drove the
// fade with rAF + inline opacity and the viewer never appeared
// where rAF was throttled; v1.9.5 is class-based (br-on shows,
// br-vis carries opacity 1 after a forced style flush). jsdom
// asserts that state machine.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__V = V;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
const html = `<!DOCTYPE html><html><head><title>Viewer Story</title>
<meta property="og:title" content="Viewer Story"></head><body><main><article>
<h1>Viewer Story</h1>
${P('Alpha lede paragraph opens the story.')}
<figure><img src="https://images.example.com/tap-photo.jpg" width="1200" height="800"><figcaption>A tappable photo.</figcaption></figure>
${P('Bravo second paragraph continues the account.')}
${P('Charlie third paragraph adds background and reaction.')}
${P('Delta fourth paragraph closes the piece.')}
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://viewer.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const doc = w.document;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  let pill = null;
  for (let i = 0; i < 50 && !pill; i++) { await wait(80); pill = doc.getElementById('br-pill'); }
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  await wait(300);
  const img = doc.querySelector('.br-body figure img');
  chk('article image rendered', !!img);
  img.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const viewer = doc.getElementById('br-viewer');
  chk('viewer shown', !!viewer && viewer.classList.contains('br-on'));
  chk('viewer visible class set (fade in)', !!viewer && viewer.classList.contains('br-vis'));
  const css = (doc.getElementById('br-style') || {}).textContent || '';
  chk('viewer has opacity transition', /#br-viewer\{[^}]*transition:opacity/.test(css));
  chk('visible class carries opacity 1', /#br-viewer\.br-vis\{opacity:1\}/.test(css));
  viewer.querySelector('.br-vclose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  chk('close starts the fade out', !viewer.classList.contains('br-vis') && viewer.classList.contains('br-on'));
  await wait(320);
  chk('viewer hides after the fade', !viewer.classList.contains('br-on'));
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V194 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(1); });
