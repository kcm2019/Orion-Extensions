const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__force = forceOpenReader; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

function make(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  return w;
}

// A short wire story: real text, but below the automatic thresholds.
const short = `<!DOCTYPE html><html><head><title>Wire Brief — Site</title>
<meta property="og:title" content="Wire Brief"><meta property="og:image" content="https://cdn.example.com/h.jpg">
</head><body><article><h1>Wire Brief</h1>
<p>Nov 15 (Reuters) - The chief executive discussed the plan with allies this week, according to people familiar with the matter who spoke on condition of anonymity.</p>
<p>The talks remain private and no decision has been made, the people said, adding that the timeline could still shift.</p>
</article></body></html>`;
const w = make(short, 'https://www.reuters.com/world/wire-brief');
setTimeout(() => {
  chk('no pill for the short story (below threshold)', !w.document.getElementById('br-pill'));
  w.__force();
  setTimeout(() => {
    chk('force opens the reader', w.__BR.open === true);
    const txt = w.document.getElementById('br-reader').textContent;
    chk('forced reader shows the story', txt.includes('chief executive discussed the plan'));
    // Empty page: toast instead of silence
    const w2 = make('<!DOCTYPE html><html><head><title>Blank</title></head><body><div>Hi</div></body></html>', 'https://example.com/blank');
    setTimeout(() => {
      w2.__force();
      const toast = w2.document.getElementById('br-toast');
      chk('empty page gets a toast', !!toast && /No readable text/.test(toast.textContent) && toast.classList.contains('br-toast-on'));
      process.exit(fail ? 1 : 0);
    }, 1200);
  }, 700);
}, 3200);
