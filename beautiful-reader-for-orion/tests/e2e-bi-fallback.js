const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; window.__close = closeReader; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

// Part 1: the real BI page — DOM is a shell, JSON-LD carries the story
{
  const html = fs.readFileSync('/tmp/bi.html', 'utf8');
  const dom = new JSDOM(html, { url: 'https://www.businessinsider.com/reddit-traffic-down-13-percent-similarweb-google-ai-overviews-2026-11', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const a = w.__EX(w.document, w.location.href);
  const text = a.blocks.map(b => b.text || '').join(' ');
  chk('BI fallback makes it readable', a.readable === true);
  chk('BI story text present', text.includes('Reddit') && text.includes('Similarweb'));
  chk('BI story ends naturally', text.includes('Reddit Reviews'));
  chk('BI multiple paragraphs', a.blocks.filter(b => b.type === 'paragraph').length >= 3);
}

// Part 2: auto-open, close, pill must come back
const P = (n) => 'Auto story paragraph ' + n + ' tells the whole tale in enough detail to count as a real article body for the reader to open automatically on this site today, with names, dates, figures and quotes all included for completeness.';
const html2 = `<!DOCTYPE html><html><head><title>Auto Story — Site</title>
<meta property="og:title" content="Auto Story"><meta property="og:image" content="https://cdn.example.com/h.jpg">
</head><body><article><h1>Auto Story</h1>${[1, 2, 3, 4, 5].map(n => '<p>' + P(n) + '</p>').join('')}</article></body></html>`;
const dom2 = new JSDOM(html2, { url: 'https://site.example/news/auto-story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w2 = dom2.window;
w2.fetch = () => Promise.reject(new Error('offline'));
w2.localStorage.setItem('br:br.autoSites.v1', JSON.stringify(['site.example']));
w2.eval(core); w2.eval(reader);
setTimeout(() => {
  chk('auto-open fired', w2.__BR.open === true);
  chk('no pill while auto-opened', !w2.document.getElementById('br-pill'));
  w2.__close();
  setTimeout(() => {
    chk('reader closed', w2.__BR.open === false);
    chk('pill appears after closing auto-opened reader', !!w2.document.getElementById('br-pill'));
    process.exit(fail ? 1 : 0);
  }, 700);
}, 3200);
