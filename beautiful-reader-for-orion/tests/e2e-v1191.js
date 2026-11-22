// v1.19.1: two fixes.
// (1) X embeds: the Tweet.html widget fires `load` on
// Orion/WebKit and then renders nothing — a 560px empty
// card the watchdog can't catch. X posts are now native
// cards filled from the syndication JSON (the endpoint
// X's own widget uses, token computed from the tweet id).
// (2) Image viewer: a swipe's drag-fade wrote the viewer's
// inline opacity and nothing cleared it, so the next open
// sat half-faded until a tap. Open and close now clear it.
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
  while (Date.now() - t0 < (ms || 5000)) { if (fn()) return true; await sleep(50); }
  return false;
}
const isOpen = (w) => { const r = w.document.querySelector('#br-reader'); return !!r && r.classList.contains('br-open'); };

const P = (n) => 'Paragraph ' + n + ' of the report walks through the setup in considerable detail, what the hardware had to interpret in software, and why reaching the desktop took the better part of twenty minutes on the first attempt.';
const ID = '2120605420066595029';
const TWEET = {
  __typename: 'Tweet', favorite_count: 3484, conversation_count: 232,
  created_at: '2026-11-11T19:51:45.000Z', lang: 'en',
  text: 'I used Gemini 4 Carbon to get Windows 11 running on my iPhone Duo! Demo + repo: https://t.co/AbC123 and the clip: https://t.co/LVdeqvvOU1',
  display_text_range: [0, 118],
  entities: {
    urls: [{ url: 'https://t.co/AbC123', display_url: 'github.com/example/repo', expanded_url: 'https://github.com/example/repo' }],
    media: [{ url: 'https://t.co/LVdeqvvOU1', display_url: 'pic.x.com/LVdeqvvOU1' }]
  },
  user: { name: 'Ammaar Reshi', screen_name: 'ammaar', profile_image_url_https: 'https://pbs.twimg.com/profile_images/1749207435255164928/A2xzzpnT_normal.jpg' },
  mediaDetails: [{
    type: 'video', media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/2120604342247927808/img/9HwQ65Uprvpt-fIT.jpg',
    video_info: { duration_millis: 59933, variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x/pl.m3u8' },
      { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/x/480.mp4' },
      { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/x/720.mp4' },
      { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/x/360.mp4' }
    ] }
  }]
};

const bqHtml = `<!DOCTYPE html><html><head><title>iPhone Duo</title>
<meta property="og:title" content="Windows on iPhone Duo">
</head><body>
<main><article>
<h1>Windows on iPhone Duo</h1>
<p>${P(1)}</p>
<figure><img src="https://images.example.com/duo.jpg" width="900" height="600"><figcaption>The Duo unfolded</figcaption></figure>
<p>${P(2)}</p>
<blockquote class="twitter-tweet"><p lang="en">I used Gemini 4 Carbon to get Windows 11 running on my iPhone Duo!</p>— Ammaar Reshi (@ammaar) <a href="https://twitter.com/ammaar/status/${ID}">November 11, 2026</a></blockquote>
<p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p>
</article></main>
</body></html>`;

const iframeHtml = `<!DOCTYPE html><html><head><title>iPhone Duo</title>
<meta property="og:title" content="Windows on iPhone Duo">
</head><body>
<main><article>
<h1>Windows on iPhone Duo</h1>
<p>${P(1)}</p><p>${P(2)}</p>
<iframe src="https://platform.twitter.com/embed/Tweet.html?id=${ID}" width="550" height="600"></iframe>
<p>${P(3)}</p><p>${P(4)}</p><p>${P(5)}</p>
</article></main>
</body></html>`;

function makePage(pageHtml, url, syndication) {
  const dom = new JSDOM(pageHtml, { url: url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.__calls = calls;
  w.fetch = (u) => {
    const s = String(u);
    calls.push(s);
    if (s.indexOf('cdn.syndication.twimg.com/tweet-result') >= 0) {
      if (syndication === 'ok') return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(TWEET))) });
      if (syndication === 'empty') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.reject(new Error('offline'));
    }
    return Promise.reject(new Error('offline'));
  };
  w.eval(core); w.eval(reader);
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
  // ---- X card fills from the syndication JSON ----
  const w = makePage(bqHtml, 'https://www.techspot.example/iphone-duo', 'ok');
  chk('reader opens (x card)', await openViaPill(w));
  chk('no social iframe for x', !w.document.querySelector('.br-social-frame'));
  const filled = await waitFor(() => { const n = w.document.querySelector('.br-x-name'); return !!n && n.textContent === 'Ammaar Reshi'; });
  chk('card fills with the author name', filled);
  const handle = w.document.querySelector('.br-x-handle');
  chk('handle shown', !!handle && handle.textContent === '@ammaar');
  const ava = w.document.querySelector('.br-x-ava');
  chk('avatar uses the bigger image', !!ava && (ava.getAttribute('src') || '').indexOf('_bigger.') >= 0);
  const xt = w.document.querySelector('.br-x-text');
  chk('full text shown', !!xt && xt.textContent.indexOf('Gemini 4 Carbon') >= 0);
  chk('t.co link expanded to its display form', !!xt && xt.textContent.indexOf('github.com/example/repo') >= 0 && xt.textContent.indexOf('t.co/AbC123') < 0);
  chk('media t.co stripped by the display range', !!xt && xt.textContent.indexOf('LVdeqvvOU1') < 0);
  const vd = w.document.querySelector('.br-x-media video');
  chk('video renders natively', !!vd);
  chk('video picks the best mp4 under the cap', !!vd && (vd.getAttribute('src') || '').endsWith('/720.mp4'));
  chk('video poster is the tweet thumbnail', !!vd && (vd.getAttribute('poster') || '').indexOf('amplify_video_thumb') >= 0);
  const meta = w.document.querySelector('.br-x-meta');
  chk('meta line has date, likes, replies', !!meta && meta.textContent.indexOf('Nov') >= 0 && meta.textContent.indexOf('3.5K likes') >= 0 && meta.textContent.indexOf('232 replies') >= 0);
  const synCall = w.__calls.find((c) => c.indexOf('tweet-result') >= 0) || '';
  chk('syndication called with the id and a token', synCall.indexOf('id=' + ID) >= 0 && /[?&]token=[a-z0-9]+/.test(synCall));
  const link = w.document.querySelector('.br-social-link');
  chk('view link points at the post', !!link && (link.getAttribute('href') || '').indexOf('/status/' + ID) >= 0);

  // ---- Iframe-sourced post (TechSpot): id from the embed URL ----
  const w2 = makePage(iframeHtml, 'https://www.techspot.example/iphone-duo-2', 'ok');
  chk('reader opens (iframe source)', await openViaPill(w2));
  const xb2 = w2.document.querySelector('.br-x-body');
  chk('card built from the embed id', !!xb2 && xb2.getAttribute('data-xid') === ID);
  chk('iframe-source card fills too', await waitFor(() => { const n = w2.document.querySelector('.br-x-name'); return !!n && n.textContent === 'Ammaar Reshi'; }));
  const link2 = w2.document.querySelector('.br-social-link');
  chk('view link synthesized from the id', !!link2 && link2.getAttribute('href') === 'https://x.com/i/status/' + ID);

  // ---- Syndication fails: captured text stays, never a void ----
  const w3 = makePage(bqHtml, 'https://www.techspot.example/iphone-duo-3', 'fail');
  chk('reader opens (offline x)', await openViaPill(w3));
  await sleep(400);
  const xt3 = w3.document.querySelector('.br-x-text');
  chk('captured text survives a failed fetch', !!xt3 && xt3.textContent.indexOf('Gemini 4 Carbon') >= 0);
  chk('no iframe fallback sneaks back', !w3.document.querySelector('.br-social-frame'));

  // ---- Empty syndication answer on an iframe post: plain note ----
  const w4 = makePage(iframeHtml, 'https://www.techspot.example/iphone-duo-4', 'empty');
  chk('reader opens (empty x)', await openViaPill(w4));
  const noted = await waitFor(() => { const n = w4.document.querySelector('.br-x-load'); return !!n && n.textContent.indexOf('could not be loaded') >= 0; });
  chk('empty answer becomes a plain note, not a void', noted);

  // ---- Viewer: drag-fade residue must not survive ----
  const img = w.document.querySelector('#br-reader .br-body figure img');
  chk('article image present for the viewer test', !!img);
  img.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const viewer = w.document.querySelector('#br-viewer');
  chk('viewer opens on the first image', !!viewer && viewer.classList.contains('br-vis'));
  // Simulate the residue a swipe-drag leaves behind.
  viewer.style.opacity = '0.55';
  w.document.querySelector('.br-vclose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(320);
  chk('close clears the inline opacity', viewer.style.opacity === '');
  viewer.style.opacity = '0.55'; // residue somehow present again at open time
  img.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  chk('reopen clears any stale inline opacity', viewer.style.opacity === '');
  chk('viewer is visible again', viewer.classList.contains('br-vis'));

  console.log(fail ? fail + ' FAILURES' : 'ALL V1191 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
