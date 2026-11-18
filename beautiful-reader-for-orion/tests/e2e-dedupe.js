// v1.15.0 image dedupe: og:image is a path-decorated variant of the
// in-body lead photo (GamesRadar/Future pattern). The photo must
// render exactly once; a genuinely different second photo stays.
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
const LEAD = 'https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc.jpg';
const LEAD_OG = 'https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc-1200-80.jpg';
const SECOND = 'https://cdn.mos.cms.futurecdn.net/VtJQbV92qkquEtztR6tbF5.jpg';
const html = `<!DOCTYPE html><html><head><title>Fallout Story</title>
<meta property="og:title" content="Goggins on Fallout season 3">
<meta property="og:image" content="${LEAD_OG}">
</head><body>
<main><article>
<h1>Goggins on Fallout season 3</h1>
<figure><img src="${LEAD}" alt="Walton Goggins as the Ghoul"></figure>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p>
<figure><img src="${SECOND}" alt="Fallout season 2 key art"></figure>
<p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>
</body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://www.gamesradar.com/entertainment/fallout-story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const S = w.__BR;
  chk('settings init', await waitFor(() => !!S.settings));
  chk('pill appears', await waitFor(() => !!w.document.querySelector('#br-pill')));
  const pill = w.document.querySelector('#br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  chk('reader opens', await waitFor(() => S.open === true));
  const blocks = S.current.blocks.filter((b) => b.type === 'image');
  chk('extraction keeps 2 distinct image blocks', blocks.length === 2);
  chk('hero is the decorated og variant', S.current.hero === LEAD_OG);
  const imgs = Array.from(w.document.querySelectorAll('#br-reader img'));
  const leadCount = imgs.filter((im) => (im.getAttribute('src') || '').indexOf('xZaMPm6K7aM6DTh5fDuihc') >= 0).length;
  const secondCount = imgs.filter((im) => (im.getAttribute('src') || '').indexOf('VtJQbV92qkquEtztR6tbF5') >= 0).length;
  chk('lead photo renders exactly once', leadCount === 1);
  chk('second photo renders once', secondCount === 1);
  const photoImgs = imgs.filter((im) => (im.getAttribute('src') || '').indexOf('futurecdn') >= 0);
  chk('total rendered photos = 2 (favicon excluded)', photoImgs.length === 2);
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
