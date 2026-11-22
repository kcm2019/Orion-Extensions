// v1.20.1: in-article Contents box. Kurt's spec: a
// table of contents section below the opening
// paragraph and the usual summary info box (the
// infobox), ALWAYS collapsed by default, extending
// only when the user clicks its header. Placement:
// after the infobox when one sits near the top,
// otherwise after the first paragraph; needs 3+
// headings. Entries mirror the reader's own heading
// registry; tapping one expands any folded ancestor
// sections and jumps, like the Contents sheet.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;window.__open = openReader;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}
const BODY1 = 'The movement began in 2021 when residents and activists organized against the planned training facility, arguing it would destroy one of the largest remaining forest tracts in the metro area and deepen the harms of militarized policing. Organizers built camps in the forest, held weekly assemblies, and gathered tens of thousands of petition signatures from neighbors across the south side of the city.';
const BODY2 = 'Opponents of the facility raised concerns about destruction of the forest and associated waterways, pointing to the site history as a former prison farm and to the muscogee creek heritage of the land itself. Supporters answered that the project was necessary to fight crime and improve officer morale after a difficult year, and the city council ultimately voted to approve the lease.';
const BODY3 = 'The state later charged several protesters under domestic terrorism statutes and indicted dozens of people on racketeering charges, a response that civil liberties groups described as an unprecedented escalation against a protest movement. Trials stretched across two years, and the cases became a national reference point for debates about protest policing and environmental defense.';

const wikiHtml = `<!DOCTYPE html><html><head><title>Stop Cop City - Wikipedia</title>
<script type="application/ld+json">{"@type":"Article","headline":"American social movement"}</script>
</head><body>
<h1 id="firstHeading">Stop Cop City</h1>
<div id="mw-content-text">
<table class="infobox">
<tr><th colspan="2" class="infobox-title">Stop Cop City</th></tr>
<tr><td colspan="2" class="infobox-image"><img src="https://upload.example.org/forest.jpg" width="290" height="218"><div class="infobox-caption">The forest in 2021</div></td></tr>
<tr><th>Dates</th><td>2021 – 2025</td></tr>
<tr><th>Location</th><td>Atlanta, Georgia</td></tr>
<tr><th>Caused by</th><td>Planned police training facility</td></tr>
</table>
<p>${BODY1}</p>
<h2>Background</h2>
<p>${BODY2}</p>
<h2>History</h2>
<p>${BODY3}</p>
<h2>References</h2>
<p>${BODY1}</p>
</div>
</body></html>`;

const plainHtml = `<!DOCTYPE html><html><head><title>A Plain Long Article About Bridges</title></head><body>
<article>
<h1>A Plain Long Article About Bridges</h1>
<p>${BODY1}</p>
<h2>Design</h2>
<p>${BODY2}</p>
<h3>Materials</h3>
<p>${BODY3}</p>
<h2>History</h2>
<p>${BODY1}</p>
</article>
</body></html>`;

const shortHtml = `<!DOCTYPE html><html><head><title>Two Sections Only, A Short Piece</title></head><body>
<article>
<h1>Two Sections Only, A Short Piece</h1>
<p>${BODY1}</p>
<h2>First</h2>
<p>${BODY2}</p>
<h2>Second</h2>
<p>${BODY3}</p>
</article>
</body></html>`;

async function run(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  await waitFor(() => !!w.document.querySelector('#br-pill'), 3000);
  w.__open();
  await sleep(500);
  return w;
}
function order(parent, a, b) {
  const kids = [...parent.querySelectorAll('*')];
  return kids.indexOf(a) >= 0 && kids.indexOf(b) >= 0 && kids.indexOf(a) < kids.indexOf(b);
}

(async () => {
  // ---- Wikipedia: box below lede + infobox ----
  const w = await run(wikiHtml, 'https://en.wikipedia.org/wiki/Stop_Cop_City');
  const d = w.document, body = d.querySelector('.br-body');
  const box = body.querySelector('.br-tocbox');
  chk('wiki: Contents box exists', !!box);
  const ib = body.querySelector('.br-infobox');
  const firstH2 = body.querySelector('.br-asec > h2');
  chk('wiki: box sits below the infobox', !!box && !!ib && order(body, ib, box));
  chk('wiki: box sits above the first section', !!box && !!firstH2 && order(body, box, firstH2));
  chk('wiki: starts collapsed', !!box && !box.classList.contains('br-open'));
  const items = box ? box.querySelectorAll('.br-tocitem') : [];
  chk('wiki: one entry per heading (3)', items.length === 3);
  box.querySelector('.br-tocbox-head').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('wiki: header tap expands', box.classList.contains('br-open'));
  box.querySelector('.br-tocbox-head').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('wiki: second header tap collapses again', !box.classList.contains('br-open'));

  // ---- Plain article: after the first paragraph, jump expands folded ancestors ----
  const w2 = await run(plainHtml, 'https://example.com/bridges/');
  const d2 = w2.document, body2 = d2.querySelector('.br-body');
  const box2 = body2.querySelector('.br-tocbox');
  chk('plain: Contents box exists without an infobox', !!box2);
  const firstP = body2.querySelector('p');
  chk('plain: box below the opening paragraph', !!box2 && !!firstP && order(body2, firstP, box2));
  chk('plain: starts collapsed', !!box2 && !box2.classList.contains('br-open'));
  const design = [...body2.querySelectorAll('.br-asec > h2')].find(h => h.textContent.indexOf('Design') >= 0);
  design.dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('plain: Design folded (Materials hidden inside)', design.parentElement.classList.contains('br-closed'));
  const matItem = [...box2.querySelectorAll('.br-tocitem')].find(b => b.textContent.indexOf('Materials') >= 0);
  matItem.dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('plain: Contents jump unfolds the ancestor section', !design.parentElement.classList.contains('br-closed'));

  // ---- Short article: no box ----
  const w3 = await run(shortHtml, 'https://example.com/short/');
  chk('short: no Contents box under 3 headings', !w3.document.querySelector('.br-tocbox'));
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
