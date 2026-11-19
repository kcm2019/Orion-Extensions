// v1.18.5: the popup's All Sites toggle (settings.autoAll)
// makes the reader open by itself on ANY site where an article
// is detected — the per-site list is no longer the only route.
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

const P = (n) => 'Paragraph ' + n + ' of the hearing coverage explains in considerable detail how the financing model behind the buildout entered a riskier phase, with suppliers racing to secure power, land and cooling before the winter window closes.';
const html = `<!DOCTYPE html><html><head><title>Hearing Story</title>
<meta property="og:title" content="The Hearing That Changed the Financing">
</head><body>
<main><article>
<h1>The Hearing That Changed the Financing</h1>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>
</body></html>`;
const URL = 'https://news.example.com/story/hearing';

function makePage(settings) {
  const dom = new JSDOM(html, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  if (settings) w.localStorage.setItem('br:br.settings.v1', JSON.stringify(settings));
  w.eval(core); w.eval(reader);
  return w;
}

const isOpen = (w) => { const r = w.document.querySelector('#br-reader'); return !!r && r.classList.contains('br-open'); };

(async () => {
  // --- autoAll on: opens by itself, site NOT in the list ---
  const w = makePage({ autoAll: true });
  const opened = await waitFor(() => isOpen(w));
  chk('reader auto-opens with autoAll on an unlisted site', opened);
  chk('autoOpened latched', w.__BR.autoOpened === true);

  // --- control: autoAll off: pill shows, reader stays shut ---
  const w2 = makePage(null);
  const pill = await waitFor(() => !!w2.document.querySelector('#br-pill'));
  chk('pill appears with autoAll off', pill);
  await sleep(1200);
  chk('reader stays closed with autoAll off', !isOpen(w2));

  console.log(fail ? fail + ' FAILURES' : 'ALL AUTOALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
