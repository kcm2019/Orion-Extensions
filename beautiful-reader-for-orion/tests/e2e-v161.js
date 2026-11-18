const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; ' + _r.slice(_i);

const ART = (n) => 'Story paragraph ' + n + ' reports what actually happened at the hearing on Tuesday, with quotes from the people who were in the room and documents that support the account in full detail for readers following along at home today.';
const LEGAL = (n) => 'Privacy notice section ' + n + ': we collect personal information and personal data about you when you use this service. We use cookies and tracking technologies, and by continuing you consent to our processing. Under the GDPR and CCPA you have rights regarding your data, and advertising partners may share your information as described in this privacy policy and cookie notice.';
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

function extract(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  return w.__EX(w.document, w.location.href);
}

// A: a big generic legal notice (more text than the article) must not win
{
  const legalDiv = Array.from({ length: 8 }, (_, i) => '<p>' + LEGAL(i + 1) + '</p>').join('');
  const artParas = Array.from({ length: 5 }, (_, i) => '<p>' + ART(i + 1) + '</p>').join('');
  const html = `<!DOCTYPE html><html><head><title>Real Story — Site</title></head><body>
  <div class="overlay-box"><h2>Your Privacy</h2>${legalDiv}</div>
  <article><h1>Real Story</h1>${artParas}</article></body></html>`;
  const a = extract(html, 'https://site.example/news/real-story');
  const text = a.blocks.map(b => b.text || '').join(' ');
  chk('A article wins over bigger legal notice', text.includes('Story paragraph 1'));
  chk('A no legal text in body', !/Privacy notice section/.test(text));
  chk('A readable', a.readable === true);
}
// B: legal cluster woven inside the article is dropped, story kept
{
  const inner = '<p>' + ART(1) + '</p><p>' + LEGAL(1) + '</p><p>' + ART(2) + '</p><p>' + LEGAL(2) + '</p><p>' + ART(3) + '</p><p>' + ART(4) + '</p>';
  const html = `<!DOCTYPE html><html><head><title>Mixed Story — Site</title></head><body>
  <article><h1>Mixed Story</h1>${inner}</article></body></html>`;
  const a = extract(html, 'https://site.example/news/mixed');
  const text = a.blocks.map(b => b.text || '').join(' ');
  chk('B story paragraphs kept', text.includes('Story paragraph 1') && text.includes('Story paragraph 4'));
  chk('B woven legal cluster dropped', !/Privacy notice section/.test(text));
}
// C: the real Cybercab page still extracts as the Tesla article
{
  const html = fs.readFileSync('/tmp/verge3.html', 'utf8');
  const a = extract(html, 'https://www.theverge.com/transportation/1033844/tesla-personal-cybercab-orders-299-subscription-fine-print');
  const text = a.blocks.map(b => b.text || '').join(' ');
  chk('C cybercab article intact', a.readable && text.includes('Cybercab') && a.wordCount > 700);
}
process.exit(fail ? 1 : 0);
