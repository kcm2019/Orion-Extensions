// v1.9.0 part 2: gated-page notice + text-only mode.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) +
  'window.__BR = S; window.__EX = extractArticle; window.__render = renderCurrent; window.__build = buildReader;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

// --- gated: short gated DOM + subscribe furniture ---
{
  const body = 'word '.repeat(1600);
  const html = `<!DOCTYPE html><html><head><title>Gated Story</title>
  <meta property="og:title" content="Gated Story">
  <script type="application/ld+json">{"@type":"NewsArticle","headline":"Gated Story","articleBody":"${body}"}</script>
  </head><body><main><article>
  <h1>Gated Story</h1>
  <p>A short teaser paragraph that is all the site shows before the wall comes down on the rest of the reporting.</p>
  <p>Subscribe to read the full story and support our journalism.</p>
  </article></main></body></html>`;
  const dom = new JSDOM(html, { url: 'https://gated.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const art = w.__EX(w.document, 'https://gated.example.com/story');
  chk('gated page flagged', !!art && art.gated === true);
  const S = w.__BR;
  S.current = art; S.current.fromLibrary = false;
  w.__build(); w.__render();
  chk('gate notice rendered in reader', !!w.document.querySelector('.br-gatenote'));
}

// --- text-only: saved setting hides all media ---
{
  const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
  const html = `<!DOCTYPE html><html><head><title>Text Only Story</title>
  <meta property="og:title" content="Text Only Story">
  <meta property="og:image" content="https://images.example.com/hero.jpg">
  </head><body><main><article>
  <h1>Text Only Story</h1>
  ${P('Alpha lede paragraph opens the story.')}
  <figure><img src="https://images.example.com/body.jpg" width="1200" height="800"><figcaption>A body photo.</figcaption></figure>
  ${P('Bravo second paragraph continues.')}
  ${P('Charlie third paragraph adds background.')}
  ${P('Delta fourth paragraph closes the piece.')}
  </article></main></body></html>`;
  const dom = new JSDOM(html, { url: 'https://text.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.localStorage.setItem('br:br.settings.v1', JSON.stringify({ textOnly: true }));
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const S = w.__BR;
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (!S.settings && Date.now() - t0 < 3000) return;
    clearInterval(iv);
    chk('settings loaded with textOnly', !!S.settings && S.settings.textOnly === true);
    const art = w.__EX(w.document, 'https://text.example.com/story');
    S.current = art; S.current.fromLibrary = false;
    w.__build(); w.__render();
    chk('text-only: no magazine header', !w.document.querySelector('.br-mag'));
    chk('text-only: no images in body', w.document.querySelectorAll('.br-body figure, .br-body img').length === 0);
    chk('text-only: paragraphs still render', w.document.querySelectorAll('.br-body p').length >= 4);
    console.log(fail ? ('FAILURES: ' + fail) : 'ALL V19B PASS');
    process.exit(fail ? 1 : 0);
  }, 60);
}
