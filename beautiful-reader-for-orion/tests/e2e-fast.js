// v1.11.0 Fast Draw:
//  - reader script runs at document_start (manifest)
//  - extraction happens at init, before storage resolves, and
//    the cached article is reused (never shrunk) by later detects
//  - when the Wall Breaker marks the page hostile, the reader
//    opens on its own from the cached article — no tap
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) +
  'window.__BR = S; window.__detect = detectAndMaybeAuto; window.__race = raceOpenCheck;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const P = (n) => 'Paragraph ' + n + ' of the hearing coverage explains in considerable detail how the financing model behind the buildout entered a riskier phase, with suppliers racing to secure power, land and cooling before the winter window closes.';
const html = `<!DOCTYPE html><html><head><title>Hearing Story</title>
<meta property="og:title" content="The Hearing That Changed the Financing">
<meta property="og:image" content="https://images.example.com/hero-wide.jpg">
</head><body>
<main><article>
<h1>The Hearing That Changed the Financing</h1>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>
</body></html>`;
const URL = 'https://news.example.com/story/hearing';

function makePage(hostile) {
  const dom = new JSDOM(html, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  if (hostile) w.sessionStorage.setItem('br_hostile', '1');
  w.eval(core); w.eval(reader);
  return w;
}

(async () => {
  // --- manifest: the reader script starts with the page ---
  const manifest = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
  const entry = manifest.content_scripts.find((cs) => cs.js.includes('reader.js'));
  chk('reader script runs at document_start', !!entry && entry.run_at === 'document_start');

  // --- 1. early extract + cache reuse ---
  {
    const w = makePage(false);
    const S = w.__BR, doc = w.document;
    chk('pill appears on a calm page', await waitFor(() => !!doc.querySelector('#br-pill')));
    chk('article extracted and cached', !!S.detected && S.detected.readable && /Hearing/.test(S.detected.title));
    chk('calm page does not auto-open', S.open !== true);
    // The wall wipes the page AFTER extraction: the cache must survive.
    const words = S.detected.wordCount;
    doc.body.innerHTML = '<div>wiped</div>';
    w.__detect();
    chk('cache survives a page wipe', !!S.detected && S.detected.wordCount === words);
    w.__detect(true);
    chk('upgrade pass never shrinks the cache', !!S.detected && S.detected.wordCount === words);
  }

  // --- 2. hostile before load: reader pulls up on its own ---
  {
    const w = makePage(true);
    const S = w.__BR, doc = w.document;
    chk('hostile page race-opens the reader', await waitFor(() => S.open === true, 4000));
    chk('race-opened reader shows the article', !!doc.querySelector('#br-reader .br-title') && /Hearing/.test(doc.querySelector('#br-reader .br-title').textContent));
  }

  // --- 3. hostile after load: the poll catches the late wall ---
  {
    const w = makePage(false);
    const S = w.__BR, doc = w.document;
    chk('pill first on the late-wall page', await waitFor(() => !!doc.querySelector('#br-pill')));
    chk('not open before the wall fires', S.open !== true);
    w.sessionStorage.setItem('br_hostile', '1'); // wall fires, breaker breaks it
    chk('late hostility race-opens via the poll', await waitFor(() => S.open === true, 4000));
  }

  // --- 4. Wall Breaker off (in stored settings): no race open ---
  {
    const dom = new JSDOM(html, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window;
    w.fetch = () => Promise.reject(new Error('offline'));
    w.eval(core);
    const off = JSON.parse(JSON.stringify(w.BRCore.DEFAULT_SETTINGS));
    off.wallBreaker = false;
    w.localStorage.setItem('br:br.settings.v1', JSON.stringify(off));
    w.sessionStorage.setItem('br_hostile', '1');
    w.eval(reader);
    const S = w.__BR, doc = w.document;
    chk('breaker-off page still shows the pill', await waitFor(() => !!doc.querySelector('#br-pill'), 4000));
    await sleep(1200); // give the race poll its chances
    chk('no race open when Wall Breaker is off', S.open !== true && w.__race() === false);
  }

  console.log(fail === 0 ? 'ALL FAST PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})();
