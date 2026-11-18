// v1.9.0: known-gap fixes + A B C D E F I J K L M N.
//  - multi-paragraph highlights re-wrap on reopen (context anchors)
//  - dek-first subtitle, caption/credit split, pull quotes (render)
//  - magazine header, gated-page notice, find-in-article,
//    footnote chips, highlights sheet, pill resume ring, text-only
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) +
  'window.__BR = S; window.__EX = extractArticle; window.__restore = restoreHighlights; ' +
  'window.__find = showFindBar; window.__hlSheet = openHighlightsSheet; window.__pill = showPill; ' +
  'window.__render = renderCurrent; window.__build = buildReader;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const P1 = 'Senators opened the hearing on Tuesday with a warning that the financing model behind the AI buildout had entered a new and riskier phase, according to people familiar with the matter who spoke about the closed session in detail.';
const P2 = 'The second phase of the program will stretch across three continents and involve dozens of suppliers, each of them racing to secure power, land, and cooling capacity before the winter construction window closes for the season.';
const P3 = 'The committee published its findings alongside the full transcript of the session for the record and for reporters covering the story from the gallery above the chamber floor during the long afternoon of testimony and questions.';
const P4 = 'Analysts who follow the sector said the shift marked the end of an era in which capital was effectively unlimited, and the beginning of a period in which every project would have to justify itself against stricter returns.';
const P5 = 'By evening the chair had adjourned the hearing until the following week, promising a fuller accounting of the numbers and a public session at which the companies involved would be asked to testify under oath on the record.';
const DEK = 'The era of blank checks is ending as lenders start asking harder questions about returns.';
const NOTE = 'The findings were adopted by a vote of nine to two, with the dissenters asking for a further review of the cost estimates before the next session convenes in the spring term.';
const CAP = 'The hearing room photographed from the gallery level on Tuesday. JACQUELYN MARTIN/AP';

const html = `<!DOCTYPE html><html><head><title>Hearing Story</title>
<meta property="og:title" content="The Hearing That Changed the Financing">
<meta property="og:description" content="News, analysis and comment from our newsroom, the world\u2019s leading source of business coverage and insight.">
<meta property="og:image" content="https://images.example.com/hero-wide.jpg">
</head><body>
<main><article>
<h1>The Hearing That Changed the Financing</h1>
<h2>${DEK}</h2>
<p>${P1}</p>
<p>${P2}</p>
<blockquote>The second phase of the program will stretch across three continents and involve dozens of suppliers</blockquote>
<p>The committee published its findings<sup><a href="#fn1">1</a></sup> alongside the full transcript of the session for the record and for reporters covering the story from the gallery above the chamber floor during the long afternoon of testimony and questions.</p>
<figure><img src="https://images.example.com/room.jpg" width="1200" height="800"><figcaption>${CAP}</figcaption></figure>
<p>${P4}</p>
<p>${P5}</p>
<div class="footnotes"><ol><li id="fn1">${NOTE}</li></ol></div>
</article></main>
</body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://news.example.com/story/hearing', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  const S = w.__BR;
  const doc = w.document;

  // --- extraction level ---
  const art = w.__EX(doc, 'https://news.example.com/story/hearing');
  chk('readable', !!art && art.readable === true);
  chk('dek beats tagline description', art.subtitle === DEK);
  const quote = (art.blocks || []).find((b) => b.type === 'quote');
  chk('duplicated quote marked as pull quote', !!quote && quote.pull === true);
  const pWithFn = (art.blocks || []).find((b) => b.type === 'paragraph' && (b.html || '').includes('br-fnref'));
  chk('footnote ref becomes a chip in the html', !!pWithFn);
  chk('footnote chip carries the note text', !!pWithFn && pWithFn.html.includes('adopted by a vote of nine to two'));

  // --- pill resume ring ---
  chk('pill appears', await waitFor(() => !!doc.querySelector('#br-pill')));
  S.progress['https://news.example.com/story/hearing'] = { frac: 0.4, ts: Date.now(), title: 'x' };
  if (S.pill) { S.pill.remove(); S.pill = null; }
  w.__pill();
  const fg = doc.querySelector('#br-pill .br-ring-fg');
  chk('pill ring shows 40 percent', !!fg && fg.getAttribute('stroke-dasharray').indexOf('26.4') === 0);
  chk('pill label says Resume 40%', !!doc.querySelector('#br-pill .br-pill-label') && doc.querySelector('#br-pill .br-pill-label').textContent === 'Resume 40%');

  // --- open the reader ---
  const pill = doc.querySelector('#br-pill');
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  chk('reader opens', await waitFor(() => S.open === true));

  // --- header: classic stack (magazine header removed v1.9.9) ---
  chk('no magazine header', !doc.querySelector('.br-mag'));
  chk('stacked header: kicker + title in flow', !!doc.querySelector('.br-head > .br-kicker') && !!doc.querySelector('.br-head > h1.br-title'));
  chk('stacked title text', !!doc.querySelector('.br-head > h1.br-title') && doc.querySelector('.br-head > h1.br-title').textContent.includes('Financing'));
  chk('hero figure under the meta row', !!doc.querySelector('.br-head figure.br-hero img'));

  // --- caption / credit split in the rendered body ---
  const credit = doc.querySelector('.br-body figcaption .br-credit');
  chk('credit span rendered', !!credit && credit.textContent === 'JACQUELYN MARTIN/AP');
  chk('caption sentence kept', !!credit && credit.parentNode.textContent.indexOf('hearing room photographed') >= 0);

  // --- pull quote styling ---
  chk('pull quote class rendered', !!doc.querySelector('.br-body blockquote.br-pull'));

  // --- footnote chip rendered ---
  chk('footnote chip rendered', !!doc.querySelector('.br-body sup.br-fnref'));

  // --- multi-paragraph highlight restore ---
  const needle = P1.slice(-50) + P2.slice(0, 50);
  S.highlights['https://news.example.com/story/hearing'] = [{
    id: 'hlT1', text: needle, note: 'cross-para', color: 'green',
    pre: P1.slice(-90, -50), post: P2.slice(50, 90), ts: 1
  }];
  w.__restore();
  const mark = doc.querySelector('mark[data-hid="hlT1"]');
  chk('multi-paragraph highlight re-wraps', !!mark);
  chk('highlight carries its colour', !!mark && mark.className.includes('br-hl-green'));
  chk('wrapped mark spans both paragraphs', !!mark && mark.textContent.includes(P2.slice(0, 30)) && mark.textContent.includes(P1.slice(-30)));

  // --- highlights sheet ---
  w.__hlSheet();
  await sleep(30);
  chk('highlights sheet lists the highlight', doc.querySelectorAll('.br-hlrow').length === 1);
  const sheet = doc.querySelector('.br-sheet');
  if (sheet) sheet.classList.remove('br-on');

  // --- find in article ---
  w.__find();
  const input = doc.querySelector('#br-findbar input');
  chk('find bar shows', !!doc.querySelector('#br-findbar.br-on') && !!input);
  input.value = 'financing';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(300);
  const finds = doc.querySelectorAll('mark.br-find');
  chk('find marks matches', finds.length === 1);
  chk('find count reads 1/1', doc.querySelector('#br-findbar .br-fcount').textContent === '1/1');
  chk('find current match highlighted', !!doc.querySelector('mark.br-find.br-find-cur'));

  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V19 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(1); });
