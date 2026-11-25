// v1.21.0: social media exclusion (Kurt's ask).
// Social platforms are covered by default: no reader
// pill and no auto-open on YouTube, X, Reddit,
// Instagram, Facebook, TikTok and similar — not via
// the per-site list and not via All Sites — while the
// popup's "Skip Social Media Sites" toggle is on
// (settings.socialBlock, default true). Manual open
// from the popup stays available; the blocklist
// remains the hard never. Host matching is
// suffix-based (m.youtube.com is covered).
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;' + _r.slice(_i);
const popupJs = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
const popupHtml = fs.readFileSync(__dirname + '/../popup.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}
const P = (n) => 'Paragraph ' + n + ' of the fixture story carries enough ordinary prose about the committee hearing, the witnesses who testified across two long days of questioning, and the documents entered into the public record for anyone following the case.';
const html = `<!DOCTYPE html><html><head><title>Fixture story</title></head><body><main><article>
<h1>Fixture story</h1>
<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main></body></html>`;
function makePage(url, settings) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  if (settings) w.localStorage.setItem('br:br.settings.v1', JSON.stringify(settings));
  w.eval(core); w.eval(reader);
  return w;
}
const REDDIT = 'https://www.reddit.com/r/science/comments/abc123/fixture_post/';
const MYT = 'https://m.youtube.com/watch?v=abc123';
const NEWS = 'https://news.example.com/story/hearing';
const isOpen = (w) => { const r = w.document.querySelector('#br-reader'); return !!r && r.classList.contains('br-open'); };

(async () => {
  // --- core matcher ---
  const C = (() => { const d = new JSDOM('', { runScripts: 'outside-only' }); d.window.eval(core); return d.window.BRCore; })();
  chk('matcher: reddit.com', C.isSocialHost('reddit.com') === true);
  chk('matcher: m.youtube.com subdomain', C.isSocialHost('m.youtube.com') === true);
  chk('matcher: old.reddit.com subdomain', C.isSocialHost('old.reddit.com') === true);
  chk('matcher: x.com', C.isSocialHost('x.com') === true);
  chk('matcher: notyoutube.com is not youtube', C.isSocialHost('notyoutube.com') === false);
  chk('matcher: youtube.com.evil.com is not youtube', C.isSocialHost('youtube.com.evil.com') === false);
  chk('matcher: news site not social', C.isSocialHost('news.example.com') === false);
  chk('default socialBlock is true', C.DEFAULT_SETTINGS.socialBlock === true);

  // --- content script: defaults on Reddit ---
  let w = makePage(REDDIT, null);
  await sleep(1000);
  chk('reddit + defaults: no pill', !w.document.querySelector('#br-pill'));
  chk('reddit + defaults: nothing detected', !w.__BR.detected);
  chk('reddit + defaults: reader not open', !isOpen(w));

  // --- All Sites cannot override the exclusion ---
  w = makePage(REDDIT, { autoAll: true });
  await sleep(1000);
  chk('reddit + autoAll: no pill', !w.document.querySelector('#br-pill'));
  chk('reddit + autoAll: reader not open', !isOpen(w));

  // --- subdomain coverage ---
  w = makePage(MYT, { autoAll: true });
  await sleep(1000);
  chk('m.youtube.com + autoAll: no pill', !w.document.querySelector('#br-pill'));

  // --- toggle off releases the site ---
  w = makePage(REDDIT, { autoAll: true, socialBlock: false });
  chk('reddit + socialBlock off + autoAll: auto-opens', await waitFor(() => isOpen(w)));

  // --- control: news site unaffected ---
  w = makePage(NEWS, { autoAll: true });
  chk('news site + autoAll: auto-opens', await waitFor(() => isOpen(w)));

  // --- popup: toggle present, on by default, note shows on a social tab ---
  const store = {};
  const dom = new JSDOM(popupHtml, { url: 'moz-extension://abc/popup.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const pw = dom.window;
  pw.browser = {
    storage: { local: {
      get: (k) => Promise.resolve({ [k]: store[k] }),
      set: (o) => { Object.assign(store, o); return Promise.resolve(); }
    } },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: REDDIT }]),
      sendMessage: () => Promise.resolve({ open: false, detected: false })
    }
  };
  pw.eval(core); pw.eval(popupJs);
  await sleep(300);
  const doc = pw.document;
  chk('popup: social toggle exists', !!doc.getElementById('social-toggle'));
  chk('popup: social toggle on by default', doc.getElementById('social-toggle').checked === true);
  chk('popup: social note visible on reddit tab', doc.getElementById('social-note').hidden === false);
  const tgl = doc.getElementById('social-toggle');
  tgl.checked = false;
  tgl.dispatchEvent(new pw.Event('change'));
  await sleep(100);
  chk('popup: turning it off writes socialBlock false', !!store['br.settings.v1'] && store['br.settings.v1'].socialBlock === false);
  chk('popup: social note hides when off', doc.getElementById('social-note').hidden === true);

  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
