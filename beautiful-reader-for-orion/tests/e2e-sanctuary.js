// v1.12.0 Sanctuary:
//  - the Wall Breaker's br_sanctuary flag pulls the reader up
//    with the cached article (status line marks it)
//  - with nothing cached, the reader extracts from the
//    breaker's sanitized snapshot HTML
//  - a wiper that removes the reader root (or the whole body)
//    is answered by re-attachment, not silence
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) +
  'window.__BR = S; window.__check = overlayCheck; window.__sanctuary = sanctuaryCheck; window.__sweep = sweepOverlay;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const P = (n) => 'Paragraph ' + n + ' of the hearing coverage explains in considerable detail how the financing model behind the buildout entered a riskier phase, with suppliers racing to secure power, land and cooling before the winter window closes.';
const articleHtml = `<main><article>
<h1>The Hearing That Changed the Financing</h1>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>`;
const pageHtml = `<!DOCTYPE html><html><head><title>Hearing Story</title>
<meta property="og:title" content="The Hearing That Changed the Financing">
</head><body>${articleHtml}</body></html>`;
const URL = 'https://news.example.com/story/hearing';

function makePage(bodyHtml, seed) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><title>t</title></head><body>${bodyHtml}</body></html>`,
    { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  if (seed) seed(w);
  w.eval(core); w.eval(reader);
  return w;
}

(async () => {
  // --- 1. flag + cached article: sanctuary opens, marked ---
  {
    const w = makePage(articleHtml, (win) => win.sessionStorage.setItem('br_sanctuary', '1'));
    const S = w.__BR, doc = w.document;
    chk('sanctuary flag opens the reader', await waitFor(() => S.open === true));
    chk('status line marks the sanctuary copy',
      !!doc.querySelector('.br-status') && /Sanctuary copy/.test(doc.querySelector('.br-status').textContent));
    chk('sanctuary flag consumed', w.sessionStorage.getItem('br_sanctuary') === null);
  }

  // --- 2. nothing cached: extraction from the snapshot html ---
  {
    const snap = '<article><h1>Snapshot Saved The Story</h1>' +
      [1, 2, 3, 4, 5, 6].map((n) => '<p>' + P(n) + '</p>').join('') + '</article>';
    const w = makePage('<div><p>Short teaser only.</p></div>', (win) => {
      win.sessionStorage.setItem('br_sanctuary', '1');
      win.sessionStorage.setItem('br_sanctuary_html', snap);
    });
    const S = w.__BR, doc = w.document;
    // No pill-worthy article on the live page: drive the check directly.
    await waitFor(() => !!S.settings);
    chk('snapshot fallback opens the reader', w.__sanctuary() === true && S.open === true);
    chk('snapshot article title rendered',
      !!doc.querySelector('#br-reader .br-title') && /Snapshot Saved/.test(doc.querySelector('#br-reader .br-title').textContent));
  }

  // --- 3. wiper removes the reader root, then the whole body ---
  {
    const dom = new JSDOM(pageHtml, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window;
    w.fetch = () => Promise.reject(new Error('offline'));
    w.eval(core); w.eval(reader);
    const S = w.__BR, doc = w.document;
    chk('pill appears', await waitFor(() => !!doc.querySelector('#br-pill')));
    const pill = doc.querySelector('#br-pill');
    const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
    pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
    chk('reader opens', await waitFor(() => S.open === true));
    S.reader.remove();
    chk('reader root detached by the wiper', !S.reader.isConnected);
    w.__check();
    chk('guardian re-attaches the reader root', S.reader.isConnected && doc.getElementById('br-reader') === S.reader);
    doc.documentElement.removeChild(doc.body);
    chk('body wiped', !doc.body);
    w.__check();
    chk('guardian recreates the body and re-attaches', !!doc.body && S.reader.isConnected);
  }

  // --- 4. sanctuary escalation KILLS the page (v1.13.0) ---
  {
    const junk = '<div id="wall-junk"><p>Please allow ads on this site</p></div>' +
      '<iframe src="https://report.error-report.com/x"></iframe>' +
      '<script>window.__junkRan = true;</' + 'script>';
    const w = makePage(junk + articleHtml, (win) => win.sessionStorage.setItem('br_sanctuary', '1'));
    const S = w.__BR, doc = w.document;
    chk('sanctuary opens on the junk page', await waitFor(() => S.open === true));
    chk('page marked killed', S.pageKilled === true);
    chk('scripts and iframes stripped', doc.querySelectorAll('script, iframe').length === 0);
    chk('wall junk and article DOM purged', !doc.getElementById('wall-junk') && !doc.querySelector('main'));
    const foreign = Array.prototype.filter.call(doc.body.children, (k) =>
      k !== S.reader && k !== S.pill && !(k.id && k.id.indexOf('br-') === 0));
    chk('only BR-owned nodes remain in body', foreign.length === 0);
    const zombie = doc.createElement('div');
    zombie.id = 'zombie';
    doc.body.appendChild(zombie);
    chk('re-inserted junk purged by the kill watch', await waitFor(() => !doc.getElementById('zombie'), 2500));
  }

  // --- 5. kill on open: hostile page, reader up, page dies (v1.14.0) ---
  {
    const dom = new JSDOM(`<!DOCTYPE html><html><head><title>t</title><meta http-equiv="refresh" content="5; url=https://report.error-report.com/x"></head><body><div id="junk5">ad junk</div>${articleHtml}</body></html>`,
      { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window;
    w.fetch = () => Promise.reject(new Error('offline'));
    w.sessionStorage.setItem('br_hostile', '1');
    w.eval(core); w.eval(reader);
    const S = w.__BR, doc = w.document;
    chk('hostile page race-opens', await waitFor(() => S.open === true));
    chk('kill fires at open on a hostile page', S.pageKilled === true);
    chk('junk purged at open', !doc.getElementById('junk5'));
    chk('meta refresh removed by the purge', !doc.querySelector('meta[http-equiv]'));
  }

  // --- 6. in-read fight triggers: sweep on hostile page kills;
  //         the same sweep on a calm page does not ---
  {
    const w = makePage(articleHtml, null);
    const S = w.__BR, doc = w.document;
    chk('pill appears (calm)', await waitFor(() => !!doc.querySelector('#br-pill')));
    const pill = doc.querySelector('#br-pill');
    const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
    pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
    chk('reader opens (calm)', await waitFor(() => S.open === true));
    const ov1 = doc.createElement('div');
    doc.body.appendChild(ov1);
    w.__sweep(ov1);
    chk('sweep on a calm page does not kill', !S.pageKilled);
    w.sessionStorage.setItem('br_hostile', '1'); // wall arrives mid-read
    const ov2 = doc.createElement('div');
    doc.body.appendChild(ov2);
    w.__sweep(ov2);
    chk('sweep on a now-hostile page kills it', S.pageKilled === true);
  }

  console.log(fail === 0 ? 'ALL SANCTUARY PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})();
