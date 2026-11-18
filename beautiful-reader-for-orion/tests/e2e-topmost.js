// Two screenshot-driven fixes:
// 1. Contrast — a site's own `p { color:#000 }` must never override
//    the reader theme (black text on the dark theme, NY Post).
//    The reader sets its text colour directly on its text elements.
// 2. Topmost — a site popup injected after the reader (same max
//    z-index) must not stay above it; the guardian re-appends the
//    reader while it is open, and stops when it closes.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; window.__close = closeReader; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose. '.repeat(4)}</p>`;
const story =
  P('Alpha lede paragraph opens the story with real reporting.') +
  P('Bravo second paragraph continues the account with specifics.') +
  P('Charlie third paragraph adds background and official reaction.') +
  P('Delta fourth paragraph closes the piece with wider context.');

const html = `<!DOCTYPE html><html><head><title>Story — Post</title>
<style>p{color:#000000} body p{color:#050505} .single__content p{color:#0a0a0a}</style>
</head><body><article><div class="single__content">
<h1>A Headline Long Enough To Be The Title</h1>${story}
</div></article></body></html>`;
const dom = new JSDOM(html, { url: 'https://nypost.example/story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
const d = w.document;

setTimeout(() => {
  const pill = d.getElementById('br-pill');
  chk('pill appears', !!pill);
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 100 }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: 100 }));
  setTimeout(() => {
    chk('reader open', w.__BR.open === true);
    const styleEl = d.getElementById('br-style');
    chk('stylesheet pins theme colour on text elements', !!styleEl && /#br-reader \.br-body p[^{]*\{color:var\(--br-text\)!important\}/.test(styleEl.textContent));
    const para = d.querySelector('#br-reader .br-body p');
    const cs = para && w.getComputedStyle(para);
    console.log('  computed paragraph colour:', cs && cs.color, '| reader --br-text:', d.getElementById('br-reader').style.getPropertyValue('--br-text'));
    chk('paragraph computed colour is not the site black', !!cs && cs.color !== 'rgb(0, 0, 0)' && cs.color !== 'rgb(5, 5, 5)' && cs.color !== 'rgb(10, 10, 10)');
    // Topmost guardian: a late popup lands after the reader…
    const popup = d.createElement('div');
    popup.id = 'site-popup';
    popup.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    d.body.appendChild(popup);
    setTimeout(() => {
      chk('reader re-asserted above the late popup', d.body.lastElementChild === d.getElementById('br-reader'));
      // Top-layer wiring: the popover override must be in the CSS,
      // and entering the top layer must no-op safely where the API
      // is missing (jsdom has no showPopover; Orion's WebKit does).
      chk('popover override in stylesheet', /#br-reader\[popover\]\{margin:0;height:100%/.test(styleEl.textContent));
      // Nested insertion: a popup landing inside a container that
      // sits after the reader must still trigger re-assertion.
      const host = d.createElement('div');
      d.body.appendChild(host);
      setTimeout(() => {
        const inner = d.createElement('div');
        inner.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
        host.appendChild(inner);
        setTimeout(() => {
          chk('reader re-asserted after nested popup insertion', d.body.lastElementChild === d.getElementById('br-reader'));
          finishClose();
        }, 350);
      }, 350);
    }, 350);
    function finishClose() {
      // …and after close, the guardian stands down.
      w.__close();
      const popup2 = d.createElement('div');
      d.body.appendChild(popup2);
      setTimeout(() => {
        chk('guardian stops when the reader closes', d.body.lastElementChild === popup2);
        process.exit(fail ? 1 : 0);
      }, 350);
    }
  }, 800);
}, 3400);
