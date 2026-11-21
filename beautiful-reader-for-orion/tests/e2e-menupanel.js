// v1.18.8: the menu's second door. Orion intermittently
// swallows the toolbar popup until the browser restarts, so
// long-pressing the pill opens the same popup UI in an
// in-page panel (popup.html in an iframe). If the iframe
// never announces itself, native fallback controls appear
// instead — the menu comes up either way.
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
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const P = (n) => 'Paragraph ' + n + ' of the transit hearing coverage explains in considerable detail how the financing model behind the buildout entered a riskier phase, with suppliers racing to secure power, land and cooling before the winter window closes on the project.';
const html = `<!DOCTYPE html><html><head><title>Transit Hearing</title>
<meta property="og:title" content="The Hearing That Changed the Financing">
</head><body>
<main><article>
<h1>The Hearing That Changed the Financing</h1>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>
</body></html>`;
const URL = 'https://news.example.com/story/hearing';

function makePage() {
  const dom = new JSDOM(html, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.browser = { runtime: { getURL: (p) => 'moz-extension://test/' + p } };
  w.eval(core); w.eval(reader);
  w.__BR.menuReadyMs = 150;
  return w;
}

async function longPress(w) {
  const pill = await waitFor(() => w.document.querySelector('#br-pill'));
  if (!pill) return false;
  const p = w.document.querySelector('#br-pill');
  p.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  await sleep(850); // the long-press timer is 650 ms
  p.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
  return true;
}

(async () => {
  // --- ready path: the framed popup announces itself ---
  const w = makePage();
  chk('long-press lands', await longPress(w));
  const panel = w.document.querySelector('#br-menupanel');
  chk('panel opens on long-press', !!panel && panel.classList.contains('br-on'));
  const frame = w.document.querySelector('#br-menuframe');
  chk('panel hosts popup.html', !!frame && frame.getAttribute('src') === 'moz-extension://test/popup.html');
  w.dispatchEvent(new w.MessageEvent('message', { data: 'br:popup-ready' }));
  await sleep(450); // past the 150 ms watchdog
  chk('ready popup is kept (no fallback)', !!w.document.querySelector('#br-menuframe') && !w.document.querySelector('.br-menu-fb'));
  w.document.querySelector('#br-menuback').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk('backdrop tap closes the panel', !w.document.querySelector('#br-menupanel').classList.contains('br-on'));

  // --- fallback path: silence from the iframe ---
  const w2 = makePage();
  chk('long-press lands (2)', await longPress(w2));
  await sleep(500); // watchdog fires at 150 ms
  chk('fallback controls appear', !!w2.document.querySelector('.br-menu-fb'));
  const rows = Array.from(w2.document.querySelectorAll('.br-menu-row'));
  const siteRow = rows.find(r => r.textContent.indexOf('Always use Reader') >= 0);
  chk('fallback has the This Site row', !!siteRow);
  const sw = siteRow.querySelector('input[type="checkbox"]');
  sw.checked = true;
  sw.dispatchEvent(new w2.Event('change', { bubbles: true }));
  chk('fallback toggle adds the site', w2.__BR.autoSites.indexOf('news.example.com') >= 0);
  const allRow = rows.find(r => r.textContent.indexOf('All Sites') >= 0);
  const sw2 = allRow.querySelector('input[type="checkbox"]');
  sw2.checked = true;
  sw2.dispatchEvent(new w2.Event('change', { bubbles: true }));
  chk('fallback All Sites toggle saves', w2.__BR.settings.autoAll === true);

  console.log(fail ? fail + ' FAILURES' : 'ALL MENUPANEL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
