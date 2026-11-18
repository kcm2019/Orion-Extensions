const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; ' + _r.slice(_i);

// Shell page, Business-Insider style: headline + email gate modal,
// NO article text. The story "hydrates" ~1.4s later.
const P = (n) => 'Hydrated paragraph ' + n + ' of the story that only arrives after the page scripts run, reporting the numbers in full with quotes from the analysts who published the data and context for readers.';
const shell = `<!DOCTYPE html><html><head><title>Late Story — Site</title>
<meta property="og:title" content="Late Story">
<meta property="og:image" content="https://cdn.example.com/hero.jpg">
</head><body>
<h1>Late Story</h1>
<div class="inline-backup-paywall modal" style="display:none"><span class="headline-semibold">Enter your email to continue</span><form><input type="email"></form></div>
<div id="app"></div>
</body></html>`;

const dom = new JSDOM(shell, { url: 'https://www.businessinsider.com/late-story-2026-11', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

setTimeout(() => {
  chk('no pill on the empty shell', !w.document.getElementById('br-pill'));
  // Hydration: the article lands in the DOM, like BI's app rendering it.
  const app = w.document.getElementById('app');
  const art = w.document.createElement('article');
  art.innerHTML = [1, 2, 3, 4, 5].map(n => '<p>' + P(n) + '</p>').join('');
  app.appendChild(art);
  setTimeout(() => {
    chk('pill appears once the article hydrates', !!w.document.getElementById('br-pill'));
    const pill = w.document.getElementById('br-pill');
    if (pill) {
      const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
      pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
      setTimeout(() => {
        chk('reader opens over the gate', w.__BR.open === true && w.document.getElementById('br-reader').classList.contains('br-open'));
        const txt = w.document.getElementById('br-reader').textContent;
        chk('reader shows the hydrated story', txt.includes('Hydrated paragraph 3'));
        process.exit(fail ? 1 : 0);
      }, 900);
    } else process.exit(1);
  }, 2600);
}, 1800);
