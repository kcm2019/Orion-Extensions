// v1.20.3: AP News / Brightspot link farms. Kurt's
// report on a real AP article: "All of the many links
// on the site gets captured above the article text."
// Reproduced on the real page (Wayback snapshot, Nov
// 24 2026): the winning candidate was the HEADER
// wrapper (div.Page-header-stickyWrap) — candidateStats
// counted ~394 teaser/nav <p>s there, and the uncapped
// paras*120 scoring bonus let that 0.89-link-density
// wrapper outscore <main> 52k to 27k. Its nav <ul>s
// (269 links) became the reader's first two blocks,
// and Brightspot PagePromo cards threaded through the
// story body added related-story headlines as
// paragraphs ("promo" was in SKIP_RE all along, but
// camelCase "PagePromo" has no separator to match).
// Fixes: paragraph bonus saturates at 40; candidates
// over 0.6 link density are disqualified; lists whose
// items are >=75% link text are skipped (and list
// blocks dedupe); a short paragraph or loose run that
// is entirely one link is a link card, not prose;
// "promo" matches as a substring so camelCase promo
// containers skip as a unit.
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
const P1 = 'Federal agents watched the trafficking ring move pills through homes, hotels and storage units across the city for eight months, building a case they hoped would reach the organization leadership and cut off the supply at its source.';
const P2 = 'The decision to stand down fit a pattern that would play out again and again as agents allowed staggering quantities of the drug to move through the region, a tactic that has since sparked state and federal investigations into the operation.';
const P3 = 'Records reviewed by the newsroom show the agency permitted at least fourteen controlled deliveries during the probe, each one documented in surveillance logs and court filings that describe the shipments in unusual detail for an ongoing case.';
const P4 = 'Everybody involved understood the stakes of the argument, according to a former supervisor who spoke on the condition of anonymity to discuss internal deliberations about the risks the tactic posed to the surrounding community and its residents.';
const P5 = 'The agency declined to answer questions about the review, saying only that its response had not changed since the findings were first reported and that the matter remained under examination by the inspector general office in Washington.';
const teasers = Array.from({ length: 45 }, (_, i) => '<p><a href="https://apnews.com/article/t' + i + '">Teaser headline number ' + i + ' about the region</a></p>').join('');
const navItems = ['World', 'US', 'Politics', 'Sports', 'Business', 'Science', 'Health', 'Oddities', 'Climate', 'Fentanyl', 'Elections', 'Markets', 'Weather', 'Video', 'Photos'].map(s => '<li><a href="https://apnews.com/hub/' + s.toLowerCase() + '">' + s + '</a></li>').join('');
const html = `<!DOCTYPE html><html><head><title>AP investigation: The probe that let pills walk</title></head><body>
<div class="Page-header-stickyWrap"><div class="Page-header-bar"><div class="Page-header-navigation">
<ul class="MainNavigation-items hide-scrollbar">${navItems}</ul>
<div class="Header-teasers">${teasers}</div>
</div></div></div>
<main class="Page-main"><div class="Page-storyBody"><div class="RichTextStoryBody RichTextBody">
<h1>AP investigation: The probe that let pills walk</h1>
<p>${P1}</p>
<p>${P2}</p>
<div class="Enhancement"><div class="PagePromo"><img src="https://dims.apnews.com/promo.jpg" width="600" height="400"><div class="PagePromo-title"><a href="https://apnews.com/article/related-one"><span>Unrelated opioid settlement headline from another story</span></a></div></div></div>
<p>${P3}</p>
<p><a href="https://apnews.com/article/related-two">A second related headline standing in for a story</a></p>
<ul><li>The committee published its findings on Tuesday after a long review of the records</li><li>Witnesses described the operation in detail, including <a href="https://example.org/doc">the surveillance log</a> entries</li><li>No charges have been filed against the supervisors involved in the decision</li></ul>
<p>${P4}</p>
<h2>How the tactic worked</h2>
<p>${P5}</p>
</div></div></main>
</body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://apnews.com/article/probe-pills-walk', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  await waitFor(() => !!w.document.querySelector('#br-pill'), 4000);
  const S = w.__BR, det = S.detected;
  chk('article detected and readable', !!det && det.readable === true);
  chk('pill appears (header did not win)', !!w.document.querySelector('#br-pill'));
  const texts = (det.blocks || []).map(b => b.text || (b.items || []).join(' '));
  chk('no nav list captured', !texts.some(t => t.includes('World') && t.includes('Oddities')));
  chk('no teaser headlines captured', !texts.some(t => t.includes('Teaser headline number')));
  chk('first block is the lede', !!det.blocks[0] && det.blocks[0].text === P1);
  chk('promo card headline absent', !texts.some(t => t.includes('Unrelated opioid settlement headline')));
  chk('single-link paragraph card absent', !texts.some(t => t.includes('A second related headline')));
  const list = (det.blocks || []).find(b => b.type === 'list');
  chk('genuine prose list survives', !!list && list.items.length === 3 && list.items[0].includes('committee published'));
  chk('story paragraphs intact', [P2, P3, P4, P5].every(p => texts.includes(p)));
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
