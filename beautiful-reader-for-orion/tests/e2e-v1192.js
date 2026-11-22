// v1.19.2: PC Gamer — two extraction killers on script-heavy,
// modal-littered publisher templates (Future plc).
// 1. candidateStats counted <script>/<style> text as loose
//    paragraphs: embedded JSON/config blobs (39k chars inside
//    PC Gamer's <article>) are full of 'consent'/'privacy',
//    so boilerRatio hit 0.61, every candidate failed the
//    boiler gate, and the page got no pill at all.
// 2. The walk's article-rescue could override a skip for a
//    HIDDEN subtree: the newsletter confirmation modal is
//    text-heavy enough to look article-like, so its pitch
//    ('You are now subscribed', 'Join the club') was rescued
//    past its newsletter/modal name match and harvested as
//    the article's opening paragraphs.
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

const P1 = 'Comcast revealed that the launch drove the biggest internet traffic day in the history of its network, with the new release accounting for nearly a quarter of all traffic at its peak. The company shared the figures in a post celebrating the scale of the event, noting that millions of subscribers downloaded the game in the same narrow window on launch night.';
const P2 = 'The chart the company published shows a massive relative spike in activity on launch day, dwarfing the usual evening peaks that streaming video produces. The graph is unlabeled except for the date, but the shape of the curve makes the point clearly enough: for a few hours, one game effectively became a measurable fraction of the entire network.';
const P3 = 'That does come with a caveat, since one provider network and the entire internet are two different things, and the figures describe traffic on a single network during a single event. Regardless, it remains a striking statistic, another example of the outsized footprint of what may be the largest entertainment launch of the decade by any reasonable measure.';

// A JSON/config blob stuffed with legal markers, sized like
// the real page's in-article scripts (~30k chars).
const legalSentence = 'We use cookies and similar tracking technologies to process your data; see our privacy notice and cookie policy for how we collect personal data, personal information, consent choices, data protection rights, gdpr and ccpa disclosures, do not sell my info, your privacy rights, advertising partners, and how we share your information with third parties. ';
const blob = legalSentence.repeat(55);

const modalPitch = 'Join the club and get full access to premium articles, exclusive features and a growing list of member rewards delivered every single week. Members also receive our editor newsletter, early access to community events, and a growing library of guides, interviews and behind-the-scenes stories from the whole team, all for less than the price of a coffee each month, cancel any time with no questions asked at all. ';

const html = `<!DOCTYPE html><html><head><title>Comcast: at peak, a game accounted for nearly a quarter of all internet traffic</title>
<meta property="og:title" content="Comcast: at peak, a game accounted for nearly a quarter of all internet traffic">
</head><body>
<div id="main">
  <div class="hidden fixed inset-0">
    <div class="absolute centered">
      <div id="newsletter-modal-confirmation" class="hidden">
        <p>You are now subscribed</p>
        <p>${modalPitch}</p>
        <p>${modalPitch}</p>
      </div>
    </div>
  </div>
  <article>
    <script type="application/json">${JSON.stringify({ consent: blob })}</script>
    <style>.promo { color: red; }</style>
    <h1>Comcast: at peak, a game accounted for nearly a quarter of all internet traffic</h1>
    <div class="widget-area">
      <div id="content" class="widget widget-content">
        <p>${P1}</p>
        <p>${P2}</p>
        <p>${P3}</p>
      </div>
    </div>
    <script>var config = ${JSON.stringify(blob)};</script>
  </article>
</div>
</body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://www.pcgamer.com/games/test-story/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  chk('pill appears despite in-article script blobs', await waitFor(() => !!w.document.querySelector('#br-pill')));
  const S = w.__BR;
  chk('article detected', !!S.detected);
  if (S.detected) {
    chk('detected readable', S.detected.readable === true);
    const texts = S.detected.blocks.filter(b => b.type === 'paragraph').map(b => b.text);
    chk('story has its 3 paragraphs', texts.length === 3);
    chk('first paragraph is the story lede', texts.length > 0 && texts[0].indexOf('Comcast revealed') === 0);
    const all = texts.join('\n');
    chk('no modal pitch in the article', all.indexOf('Join the club') < 0 && all.indexOf('You are now subscribed') < 0);
    chk('no script blob in the article', all.indexOf('tracking technologies') < 0);
  }
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
