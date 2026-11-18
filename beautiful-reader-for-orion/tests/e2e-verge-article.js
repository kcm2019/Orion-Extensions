const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; ' + _r.slice(_i);
const html = fs.readFileSync('/tmp/verge2.html', 'utf8');
const dom = new JSDOM(html, { url: 'https://www.theverge.com/tech/1033781/x', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
setTimeout(() => {
  const doc = w.document;
  const pill = doc.getElementById('br-pill');
  console.log('pill:', !!pill);
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  setTimeout(() => {
    const imgs = Array.from(doc.querySelectorAll('#br-reader img')).map(im => im.getAttribute('src') || '');
    console.log('rendered reader imgs:', imgs.length);
    console.log('getty rendered:', imgs.some(s => s.includes('2194622930')));
    console.log('getty count:', imgs.filter(s => s.includes('2194622930')).length);
    const firstP = doc.querySelector('.br-body p');
    const gettyImg = Array.from(doc.querySelectorAll('#br-reader img')).find(im => (im.getAttribute('src')||'').includes('2194622930'));
    console.log('hero before first paragraph:', !!(firstP && gettyImg && (gettyImg.compareDocumentPosition(firstP) & 4)));
    process.exit(0);
  }, 800);
}, 3200);
