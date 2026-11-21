// v1.18.7: loose-text articles. Some CMSs (TechPowerUp)
// serve the body as bare text nodes inside the article
// container — paragraphs split by <br><br>, inline links
// interspersed, zero <p> tags. Detection counted only <p>
// text and the walker only visited element children, so
// these pages got no pill and an empty reader. Loose runs
// now count in candidateStats and are harvested by
// walkBlocks as paragraphs, while skipped subtrees
// (comments, related, share) stay out.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const L1 = 'The PlayStation 5 has been plagued with issues caused by its liquid metal thermal interface material since the year it was launched, having prompted Sony to release revisions of the console with improved designs to mitigate issues with the liquid metal. A <a href="https://example.com/report">new report</a> claims the problems are back, with owners of certain launch models seeing the material shift when the console stands vertically for years at a time in warm rooms.';
const L2 = 'Gamers appear to be frequently encountering error CE-108255-1 while playing the new release, a crash code that has followed the console through several high-profile launches. The error shows up most often in the opening hours, during the first big set-piece sequence, and players say it arrives without warning — the screen freezes, the audio loops for a second, and then the console drops back to the dashboard with the error dialog waiting for them there.';
const L3 = 'Some gamers report that they are able to play certain games on their consoles without issue, but this particular title seems to expose the fault more reliably than anything before it, possibly because it holds the hardware at full load for long stretches. Whether the underlying cause is the thermal interface, aging power delivery, or simply a demanding engine pushing launch hardware past its limits, the pattern is consistent enough that repair shops have started naming the failure after the game itself in their intake forms.';

const html = `<!DOCTYPE html><html><head><title>GTA VI Proves Too Demanding For Some PS5 Consoles, Even at 30 FPS | TechPowerUp</title>
<meta property="og:title" content="GTA VI Proves Too Demanding For Some PS5 Consoles, Even at 30 FPS">
</head><body>
<article>
Friday, November 20th 2026
<h1>GTA VI Proves Too Demanding For Some PS5 Consoles, Even at 30 FPS</h1>
<div class="byline">by Cpt.Jank</div>
${L1}<br><br>
${L2}<br><br>
<img src="https://images.example.com/tpu/console.jpg" width="640" height="360">
${L3}
<div class="sources">Sources: Example News, Forum Thread</div>
<div class="share-tools"><a href="https://facebook.com/share">Share on Facebook</a> <a href="https://x.com/share">Share on X</a></div>
<div class="related-news"><h3>Related News</h3><a href="https://example.com/other">Another Story You Should Not See In The Reader Body</a></div>
<div class="comments"><p>This is a reader comment that must never appear in the article body, however long and paragraph-like it pretends to be.</p></div>
</article>
</body></html>`;
const URL = 'https://www.techpowerup.example/355064/gta-vi-proves-too-demanding';

function makePage(pageHtml, url) {
  const dom = new JSDOM(pageHtml, { url: url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  return w;
}

(async () => {
  const w = makePage(html, URL);
  const pill = await waitFor(() => !!w.document.querySelector('#br-pill'));
  chk('pill appears on a loose-text article', pill);
  const det = w.__BR.detected;
  chk('article detected readable', !!det && det.readable === true);
  const paras = (det ? det.blocks : []).filter(b => b.type === 'paragraph');
  chk('three loose paragraphs harvested', paras.length === 3);
  chk('paragraph order preserved', paras.length === 3 && paras[0].text.indexOf('liquid metal') >= 0 && paras[1].text.indexOf('CE-108255-1') >= 0 && paras[2].text.indexOf('repair shops') >= 0);
  chk('inline link kept as html', paras.length > 0 && !!paras[0].html && paras[0].html.indexOf('example.com/report') >= 0);
  const kinds = (det ? det.blocks : []).map(b => b.type).join(',');
  chk('image block between paragraphs', /paragraph,paragraph,image,paragraph/.test(kinds));
  const allText = (det ? det.blocks : []).map(b => b.text || '').join(' ');
  chk('comments stay out', allText.indexOf('reader comment') < 0);
  chk('related news stays out', allText.indexOf('Another Story') < 0);
  chk('share tools stay out', allText.indexOf('Share on Facebook') < 0);
  chk('word count is real', !!det && det.wordCount > 200);

  // Control: loose furniture only — short runs, link-dense.
  const junk = `<!DOCTYPE html><html><head><title>Index</title></head><body>
<div class="index">${'<a href="https://example.com/a">A link headline that is fairly long</a><br><br>'.repeat(12)}</div>
</body></html>`;
  const w2 = makePage(junk, 'https://example.com/index');
  await sleep(1800);
  chk('no pill on a link-dense loose page', !w2.document.querySelector('#br-pill'));

  console.log(fail ? fail + ' FAILURES' : 'ALL LOOSE PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
