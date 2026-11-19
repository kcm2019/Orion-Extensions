// v1.18.6: social embeds + link taps.
// - Embed iframes get their src only AFTER the reader is up
//   and any page-kill has run (a load that meets window.stop()
//   sits blank forever), and the purge no longer removes the
//   reader's own frames.
// - If a social frame never loads, the captured post text
//   replaces it — never an empty card.
// - Tapping an in-article link opens it deliberately (new
//   tab, else this tab) instead of relying on target=_blank
//   activation inside the popover, which Orion swallows.
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
const isOpen = (w) => { const r = w.document.querySelector('#br-reader'); return !!r && r.classList.contains('br-open'); };

const P = (n) => 'Paragraph ' + n + ' of the entertainment coverage explains in considerable detail how the cameo came together, what the cast said about filming it, and why the hundredth episode was the moment the producers had been saving it for.';
const html = `<!DOCTYPE html><html><head><title>Rizzler Cameo</title>
<meta property="og:title" content="'The Rizzler' Makes 'Abbott Elementary' Cameo">
</head><body>
<div id="ad-slot"><iframe src="https://ads.example.com/banner"></iframe></div>
<main><article>
<h1>'The Rizzler' Makes 'Abbott Elementary' Cameo</h1>
<p>${P(1)}</p>
<p>Paragraph 2 links out to <a href="https://example.com/linked-story">this earlier report</a> for the full background on how the appearance was arranged.</p>
<blockquote class="twitter-tweet"><p lang="en">The Rizzler just changed television forever. What a cameo. #AbbottElementary</p>— The Big Lead (@thebiglead) <a href="https://twitter.com/thebiglead/status/1850000000000000000">November 19, 2026</a></blockquote>
<p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p><p>${P(6)}</p>
</article></main>
</body></html>`;
const URL = 'https://www.thebiglead.example/rizzler-cameo';

function makePage(opts) {
  opts = opts || {};
  const dom = new JSDOM(html, { url: URL, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  if (opts.hostile) w.sessionStorage.setItem('br_hostile', '1');
  w.eval(core); w.eval(reader);
  if (opts.embedLoadMs) w.__BR.embedLoadMs = opts.embedLoadMs;
  return w;
}

async function openViaPill(w) {
  await waitFor(() => w.__BR.settings);
  const pillShown = await waitFor(() => !!w.document.querySelector('#br-pill'));
  if (!pillShown) return isOpen(w);
  const pill = w.document.querySelector('#br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
  return waitFor(() => isOpen(w));
}

(async () => {
  // --- A: calm page — embed activates with the platform URL ---
  const w = makePage();
  chk('reader opens (calm)', await openViaPill(w));
  const frame = w.document.querySelector('.br-social-frame');
  chk('social frame rendered', !!frame);
  chk('frame src is the official tweet embed', !!frame && (frame.getAttribute('src') || '').indexOf('platform.twitter.com/embed/Tweet.html?id=1850000000000000000') >= 0);
  chk('no deferred embeds left', w.document.querySelectorAll('#br-reader iframe[data-src]').length === 0);

  // --- D: link taps (same calm page) ---
  const opened = [];
  w.open = function (url) { opened.push(url); return {}; };
  const link = w.document.querySelector('#br-reader .br-body a[href="https://example.com/linked-story"]');
  chk('article link rendered with its href', !!link);
  const notPrevented = link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  chk('link tap is intercepted', notPrevented === false);
  chk('link tap opens the URL', opened.length === 1 && opened[0] === 'https://example.com/linked-story');
  const para = w.document.querySelector('#br-reader .br-body p');
  para.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk('plain paragraph tap opens nothing', opened.length === 1);

  // --- B: hostile page — kill runs, reader embed survives ---
  const w2 = makePage({ hostile: true });
  const openedB = await waitFor(() => isOpen(w2));
  chk('reader opens (hostile)', openedB);
  await sleep(1700); // several purge ticks
  const frame2 = w2.document.querySelector('.br-social-frame');
  chk('social frame survives the purge', !!frame2);
  chk('surviving frame carries its src', !!frame2 && (frame2.getAttribute('src') || '').indexOf('Tweet.html?id=1850000000000000000') >= 0);
  chk('page ad iframe was purged', !w2.document.querySelector('#ad-slot iframe'));

  // --- C: embed never loads — captured text takes its place ---
  const w3 = makePage({ embedLoadMs: 60 });
  chk('reader opens (watchdog)', await openViaPill(w3));
  await sleep(500);
  chk('dead frame replaced', !w3.document.querySelector('.br-social-frame'));
  const st = w3.document.querySelector('.br-social-text');
  chk('fallback shows the tweet text', !!st && st.textContent.indexOf('Rizzler just changed television') >= 0);
  chk('fallback keeps the view link', !!w3.document.querySelector('.br-social-link'));

  console.log(fail ? fail + ' FAILURES' : 'ALL EMBEDS PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
