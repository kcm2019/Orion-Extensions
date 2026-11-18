// WSJ-structure fixture: SEO title in meta, real H1 + H2 dek in the body,
// byline fragments as their own paragraphs, a <video> hero, an icon img.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');

const DEK = 'The early OpenAI investor explains his qualms with America’s tax system, the reason Silicon Valley tilted toward Trump and how AI will change our economy';
const H1 = 'Tech Billionaire Vinod Khosla Wants to Pay More Taxes. He Explained to Us Why.';
const LEDE = 'I didn’t expect Vinod Khosla to get excited about the paper towel dispensers in his office bathrooms.';

const html = `<!DOCTYPE html><html><head>
<title>Tech Billionaire Vinod Khosla on Paying More Taxes, Trump and His Elon Musk Feud - WSJ</title>
<meta property="og:title" content="Tech Billionaire Vinod Khosla on Paying More Taxes, Trump and His Elon Musk Feud">
<meta property="og:description" content="${DEK}">
<meta property="og:image" content="https://images.wsj.net/im-123456/social.jpg">
<meta name="author" content="Gunjan Banerji">
</head><body>
<header><nav><ul><li>Markets</li><li>Tech</li></ul></nav></header>
<main><article>
<h1>${H1}</h1>
<h2>${DEK}</h2>
<video poster="https://images.wsj.net/im-999/poster.jpg" width="640" height="360"><source src="https://video.wsj.net/khosla-interview.mp4" type="video/mp4"></video>
<div class="byline"><p>By</p><p>| Video produced by</p><p>July 5, 2026 at 7:00 am ET</p></div>
<img src="https://images.wsj.net/check.svg" width="24" height="24" alt="">
<p>${LEDE}</p>
<p>We sat down for The WSJ Money Interview at the Menlo Park, Calif., office of Khosla Ventures, diving into everything from his OpenAI investment to why the billionaire thinks he should pay more in taxes.</p>
<p>But he grew especially animated when we talked about the small wooden end table we had lugged outside to the backyard for the interview, and what it represented about taking risks in business and in life.</p>
<p>Khosla, who was born in India and co-founded Sun Microsystems in 1982, has become one of the most outspoken voices in Silicon Valley on the promise and the peril of artificial intelligence, arguing that the technology will upend the economy within a generation.</p>
<p>He has also been a fierce critic of the tax code, saying the wealthy should pay far more, and he has feuded publicly with Elon Musk over immigration, climate change and the future of work in a series of posts that drew millions of views online last year.</p>
</article></main>
</body></html>`;

let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; ' + _r.slice(_i);
const dom = new JSDOM(html, { url: 'https://www.wsj.com/business/venture-capitalist-vinod-khosla-wsj-money-interview-5ca5a2a5', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8'));
w.eval(reader);

setTimeout(() => {
  const a = w.__BR.detected;
  let fail = 0;
  const chk = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) fail++; };
  chk('title is the on-page H1', a.title === H1);
  chk('subtitle is the dek', a.subtitle === DEK);
  chk('dek not duplicated in blocks', !a.blocks.some(b => b.text === DEK));
  chk('first block is the video, first paragraph is the lede', a.blocks[0] && a.blocks[0].type === 'video' && (a.blocks.find(b => b.type === 'paragraph') || {}).text === LEDE);
  chk('no By fragment', !a.blocks.some(b => b.text === 'By'));
  chk('no date fragment', !a.blocks.some(b => /July 5, 2026 at/.test(b.text || '')));
  chk('video block captured', a.blocks.some(b => b.type === 'video' && /khosla-interview\.mp4/.test(b.src)));
  chk('icon image skipped', !a.blocks.some(b => b.type === 'image' && /check\.svg/.test(b.src)));
  // Render it and check the drop-cap target + subtitle element + bar position.
  w.__BR.open && 0;
  const doc = w.document;
  // open via pill click path: call internal openReader through a synthetic event is complex;
  // instead dispatch pointer events on the pill.
  const pill = doc.getElementById('br-pill');
  chk('pill present', !!pill);
  if (pill) {
    const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
    pill.dispatchEvent(ev('pointerdown'));
    pill.dispatchEvent(ev('pointerup'));
  }
  setTimeout(() => {
    const rd = doc.getElementById('br-reader');
    chk('reader open', !!rd && rd.classList.contains('br-open'));
    if (rd) {
      const sub = rd.querySelector('.br-subtitle');
      chk('subtitle rendered italic element', !!sub && sub.textContent === DEK);
      const firstp = rd.querySelector('.br-body p.br-firstp');
      chk('drop cap target is the lede', !!firstp && firstp.textContent === LEDE);
      const vid = rd.querySelector('.br-body video, .br-hero video');
      chk('video element rendered', !!vid);
      chk('bar at bottom by default', rd.classList.contains('br-bar-bottom'));
      const bar = rd.querySelector('.br-topbar');
      const art = rd.querySelector('.br-article');
      chk('bar after article in DOM', !!bar && !!art && (art.compareDocumentPosition(bar) & 4) !== 0);
    }
    process.exit(fail ? 1 : 0);
  }, 600);
}, 3000);
