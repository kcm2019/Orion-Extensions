const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; ' + _r.slice(_i);

const L = (n) => 'Report section ' + n + ' begins here. The committee published its findings on Tuesday after a long investigation into the matter, and the report runs to several hundred pages of evidence, testimony, interviews and appendices gathered over the course of eighteen months of work by dozens of researchers and outside experts in the field. Section ' + n + ' covers the background in detail.';
const LONG = L(1);
const html = `<!DOCTYPE html><html><head><title>Story — Site</title>
<meta property="og:title" content="Story">
<meta property="og:image" content="https://cdn.example.com/hero.jpg">
</head><body><article>
<h1>Story</h1>
<p>${LONG}</p>
<p><img src="https://cdn.example.com/body.jpg" alt=""></p>
<blockquote class="twitter-tweet"><p lang="en">Big news today: the thing happened and everyone is talking about it right now.</p>&mdash; Some User (@someuser) <a href="https://twitter.com/someuser/status/1234567890123456789">November 14, 2026</a></blockquote>
<p>${L(2)}</p>
<iframe src="https://www.instagram.com/p/ABCdef123/embed" width="400" height="480"></iframe>
<p>${L(3)}</p>
<div class="fb-post" data-href="https://www.facebook.com/somepage/posts/987654321"></div>
<p>${L(4)}</p>
</article></body></html>`;

const dom = new JSDOM(html, { url: 'https://site.example/news/story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
setTimeout(() => {
  const doc = w.document;
  const pill = doc.getElementById('br-pill');
  chk('pill', !!pill);
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  setTimeout(() => {
    const a = w.__BR.current;
    const socials = a.blocks.filter(b => b.type === 'social');
    chk('3 social blocks', socials.length === 3);
    const x = socials.find(b => b.platform === 'x');
    chk('x block from blockquote', !!x && x.embedUrl.includes('platform.twitter.com/embed/Tweet.html?id=1234567890123456789'));
    chk('x block kept tweet text', !!x && x.text.includes('Big news today'));
    chk('x block kept author', !!x && x.author.includes('@someuser'));
    const ig = socials.find(b => b.platform === 'instagram');
    chk('ig block from iframe', !!ig && ig.embedUrl.includes('instagram.com/p/ABCdef123/embed'));
    const fb = socials.find(b => b.platform === 'facebook');
    chk('fb block from data-href', !!fb && fb.embedUrl.includes('facebook.com/plugins/post.php'));
    // Rendered
    const frames = Array.from(doc.querySelectorAll('.br-social-frame'));
    chk('3 social iframes rendered', frames.length === 3);
    chk('x iframe src', frames.some(f => (f.getAttribute('src') || '').includes('Tweet.html?id=1234567890123456789')));
    const heads = Array.from(doc.querySelectorAll('.br-social-head')).map(h => h.textContent);
    chk('platform headers', heads.join(' ').includes('X') && heads.join(' ').includes('Instagram') && heads.join(' ').includes('Facebook'));
    const viewLinks = Array.from(doc.querySelectorAll('.br-social-link'));
    chk('view-post links for url-backed embeds', viewLinks.length >= 2);
    // Glow
    const glows = doc.querySelectorAll('.br-hero .br-glow');
    chk('glow behind images (hero + body)', glows.length >= 2);
    const bodyGlow = Array.from(glows).some(g => (g.style.backgroundImage || '').includes('body.jpg'));
    chk('glow uses the image itself', bodyGlow);
    process.exit(fail ? 1 : 0);
  }, 800);
}, 3200);
