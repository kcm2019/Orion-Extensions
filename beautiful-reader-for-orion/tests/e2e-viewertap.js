// v1.15.1 tap-to-view: a clean pointer tap on an image opens
// the viewer WITHOUT any click event (the device case where
// the scroll container swallows the click); a drag (scroll)
// must not open it; the classic click path still works.
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
const P = (n) => 'Paragraph ' + n + ' of the interview has Walton Goggins explaining in considerable detail how the new season stays true to the games, what the cast filmed in the desert over the winter, and why he hopes the story continues beyond it.';
const html = `<!DOCTYPE html><html><head><title>Fallout Story</title>
<meta property="og:title" content="Goggins on Fallout season 3">
<meta property="og:image" content="https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc-1200-80.jpg">
</head><body><main><article>
<h1>Goggins on Fallout season 3</h1>
<figure><img src="https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc.jpg" alt="Walton Goggins as the Ghoul"></figure>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main></body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://www.gamesradar.com/entertainment/fallout-story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const S = w.__BR;
  chk('settings init', await waitFor(() => !!S.settings));
  const pill = w.document.querySelector('#br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  chk('reader opens', await waitFor(() => S.open === true));
  const img = w.document.querySelector('#br-reader .br-hero img');
  chk('image rendered', !!img);
  const viewerOpen = () => { const v = w.document.querySelector('#br-viewer'); return !!v && v.classList.contains('br-on'); };

  // 1. drag across the image (a scroll gesture) — must NOT open
  img.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
  img.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 220 }));
  await sleep(80);
  chk('scroll drag does not open viewer', !viewerOpen());

  // 2. clean tap, pointer events only, no click — MUST open
  img.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
  img.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 102, clientY: 101 }));
  chk('pointer tap opens viewer (no click event)', await waitFor(viewerOpen, 800));
  const v = w.document.querySelector('#br-viewer');
  chk('viewer display set inline', v.style.display === 'block');
  chk('viewer shows the tapped image', v.querySelector('img').getAttribute('src').indexOf('xZaMPm6K7aM6DTh5fDuihc') >= 0);

  // 3. close via the ✕, then the classic click path still opens
  v.querySelector('.br-vclose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk('viewer closes', await waitFor(() => !viewerOpen(), 1200));
  img.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk('click still opens viewer', await waitFor(viewerOpen, 800));
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
