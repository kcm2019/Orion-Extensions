// v1.19.3: Business Insider — the story wrapped in a
// skip-named container. BI puts the whole body inside
// <div class="image-modal">; the first walk prunes it,
// harvests 149 words of byline/slogan/author-bio
// furniture instead — which PASSED the readability
// gates, so neither the rescue walk (trigger: <400
// chars harvested) nor the JSON-LD fallback (trigger:
// not readable) ever fired. The reader opened with no
// article body at all.
// Fix: the rescue trigger is relative — if the walk
// kept less than half the paragraph text the winning
// candidate's own stats counted, a major subtree was
// pruned and the rescue walk runs. Plus: 'read-next'
// joins the skip names (card rails), and repeated
// identical headings are dropped as template
// furniture (BI's read-next touts carry the site
// slogan as their <h3> placeholder, four times over).
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

const S1 = 'At 2 a.m., Daniel Camilo fired up his PlayStation 5 with anticipation. It was Thursday, and the wait was finally over. The game he had been tracking for years, through delays and leaks and endless rumor cycles, was at last sitting on his console, downloaded through a gray-market account registered in another country entirely, because his own country does not sell it.';
const S2 = 'Beijing tightly controls national licensing for games, and censors titles that promote violence, unlawfulness, or content it deems harmful to public morals. Naturally, no entry in this particular series has ever been approved for sale, and regulators have given no indication that this one will be treated any differently from its predecessors.';
const S3 = 'That has not stopped millions of gamers from finding workarounds. Players rely on the gray market, using foreign accounts, imported discs, and virtual private networks to reach storefronts in Hong Kong, Japan, and the United States, then share the games across households with friends who split the cost of a single copy between them.';
const S4 = 'Some analyst firms estimate that the country has between 280 million and 320 million PC gamers, many of whom play free titles on domestic platforms. Even a small conversion rate among them would translate into millions of copies sold in the first week alone, a figure no publisher can afford to ignore for very long.';
const S5 = 'The national press and publication administration did not immediately respond to a request for comment on whether the game could ever be licensed. For now, the gray market remains the only market, and players like Camilo say they will keep using it for as long as the official door stays closed to them and to everyone they play with.';
const BIO = 'Matthew is a senior reporter at the Singapore bureau, where he covers the defense industry, military affairs, and the business of games across Asia. He has reported from three continents and still answers reader email personally whenever the news cycle allows it.';

const html = `<!DOCTYPE html><html><head><title>China isn't selling the game, but gamers are buying it anyway</title>
<meta property="og:title" content="China isn't selling the game, but gamers are buying it anyway">
</head><body>
<section class="post-page-container">
  <section class="post-page-grid">
    <p>By Matthew Loh — You're currently following this author! Click to unsubscribe from email alerts about his stories and analysis.</p>
    <img src="https://i.example.com/hero.jpg" width="700" height="400">
    <section id="post-body" class="post-body">
      <div class="image-modal">
        <section class="post-body-content">
          <p>${S1}</p>
          <p>${S2}</p>
          <p>${S3}</p>
          <p>${S4}</p>
          <p>${S5}</p>
        </section>
      </div>
    </section>
    <section class="post-bottom-more">
      <section class="read-next">
        <div class="read-next-list">
          <article class="tout"><h3>Example News tells the innovative stories you want to know</h3></article>
          <article class="tout"><h3>Example News tells the innovative stories you want to know</h3></article>
          <article class="tout"><h3>Example News tells the innovative stories you want to know</h3></article>
        </div>
      </section>
      <p>${BIO}</p>
    </section>
  </section>
</section>
</body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://www.businessinsider.com/test-story/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  chk('pill appears', await waitFor(() => !!w.document.querySelector('#br-pill')));
  const S = w.__BR;
  chk('article detected', !!S.detected);
  if (S.detected) {
    chk('detected readable', S.detected.readable === true);
    const paras = S.detected.blocks.filter(b => b.type === 'paragraph').map(b => b.text);
    chk('story lede is grabbed', paras.some(t => t.indexOf('Daniel Camilo fired up') >= 0));
    chk('story runs to its final paragraph', paras.some(t => t.indexOf('did not immediately respond') >= 0));
    chk('word count is the story, not the furniture', S.detected.wordCount > 250);
    const heads = S.detected.blocks.filter(b => b.type === 'heading').map(b => b.text);
    chk('no slogan tout headings leak', !heads.some(t => t.indexOf('innovative stories') >= 0));
  }
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
