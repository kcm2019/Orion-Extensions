// v1.15.2 reader bar: Save is the 🔖 emoji with an accent
// saved state, and the section label is a flex child confined
// to the free space between the buttons (it used to be
// absolutely centered on the whole bar and slid under them).
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
</head><body><main><article>
<h1>Goggins on Fallout season 3</h1>
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

  const bar = w.document.querySelector('.br-topbar');
  const save = bar.querySelector('[data-act="save"]');
  const section = bar.querySelector('#br-section');
  chk('save button is the bookmark emoji', save.textContent === '🔖');
  chk('save button starts unsaved', !save.classList.contains('br-saved'));
  chk('no spacer remains in the bar', !bar.querySelector('.br-spacer'));
  const kids = Array.from(bar.children).map((k) => k.id || k.getAttribute('data-act') || k.className);
  chk('bar order: close, section, save, gear', kids.join(',') === 'close,br-section,save,aa');
  const cs = w.getComputedStyle(section);
  chk('section is not absolutely positioned', cs.position !== 'absolute');
  chk('section can shrink (min-width 0)', cs.minWidth === '0px' || cs.minWidth === '0');
  chk('section truncates with ellipsis', cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden');

  // save / unsave through the real bar click delegation
  save.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  chk('tap saves the article', S.library.length === 1);
  chk('saved state shows on the button', save.classList.contains('br-saved'));
  chk('aria-label reports Saved', save.getAttribute('aria-label') === 'Saved');
  save.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  chk('second tap unsaves', S.library.length === 0 && !save.classList.contains('br-saved'));
  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
