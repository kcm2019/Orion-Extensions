// Favicon at the reader kicker: best icon link wins, /favicon.ico
// is the fallback, the kicker renders it left of the host, and it
// survives the save-for-later round trip.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

const P = (t) => `<p>${t} ${'filler words to reach a comfortable paragraph length for the scorer. '.repeat(3)}</p>`;
const body = P('Alpha opens the story with a long and detailed paragraph of reporting.') +
  P('Bravo continues with more detail and several clauses of real substance here.') +
  P('Charlie adds a third paragraph so the page reads like a genuine article page.') +
  P('Delta closes the piece with a final paragraph of context and background notes.');

function make(head, url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><title>Story — Site</title>${head}</head><body><article><h1>A Real Headline For Favicon Testing</h1>${body}</article></body></html>`,
    { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  return w;
}

const w = make('<link rel="icon" sizes="32x32" href="/f32.png"><link rel="apple-touch-icon" href="/touch.png"><link rel="mask-icon" href="/mask.svg">', 'https://news.example.com/story');
const a = w.__EX(w.document, w.location.href);
chk('apple-touch-icon (180) beats the 32px icon', a.favicon === 'https://news.example.com/touch.png');

const w2 = make('<link rel="icon" sizes="16x16" href="/f16.png"><link rel="icon" sizes="48x48" href="/f48.png">', 'https://news.example.com/story');
chk('largest declared icon wins without a touch icon', w2.__EX(w2.document, w2.location.href).favicon === 'https://news.example.com/f48.png');

const w3 = make('', 'https://plain.example.org/story');
chk('no icon links falls back to /favicon.ico', w3.__EX(w3.document, w3.location.href).favicon === 'https://plain.example.org/favicon.ico');

setTimeout(() => {
  const kick = w.document.querySelector('#br-reader .br-kicker');
  chk('pill appeared for the favicon page', !!w.document.getElementById('br-pill'));
  w.__BR.detected = a;
  // open via the pill path
  const pill = w.document.getElementById('br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 100 }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: 100 }));
  setTimeout(() => {
    const k2 = w.document.querySelector('#br-reader .br-kicker');
    const img = k2 && k2.querySelector('img.br-favicon');
    chk('kicker shows the favicon left of the host', !!img && img.getAttribute('src') === 'https://news.example.com/touch.png' && k2.textContent.includes('news.example.com'));
    chk('favicon is the first kicker child', !!k2 && k2.firstChild === img);
    process.exit(fail ? 1 : 0);
  }, 700);
}, 3200);
