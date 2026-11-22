// v1.20.0: first-class Wikipedia + collapsible sections.
// Wikipedia (measured on Stop Cop City): the title came
// out as the short description ("American social
// movement") because the visible-h1 gate demanded 15+
// chars and Wikipedia's JSON-LD headline IS the
// description; the infobox landed as a raw table with
// its photos trapped inside; hatnotes vanished; the
// in-page TOC duplicated the reader's; citation chips
// opened with raw CSS as their note (the reflist's
// <style> block scooped by textContent); the
// "Retrieved from" skin line closed the article.
// Now: h1 wins at 4+ chars, the JSON-LD headline
// becomes the subtitle on wiki pages, hatnotes /
// infobox / gallery / navbox get dedicated blocks,
// the reflist renders compact, chip notes are
// skip-aware. Sections: every heading wraps its
// content in .br-asec; tapping the heading folds it;
// folds persist in the progress record; the TOC jump
// expands the target's chain first.
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
<script type="application/ld+json">{"@type":"Article","headline":"American social movement","articleBody":"x"}</script>
</head><body>
<h1 id="firstHeading">Stop Cop City</h1>
<div id="mw-content-text">
<div id="toc"><ul><li>Background</li><li>History</li><li>References</li></ul></div>
<div class="hatnote">See also: Old Atlanta Prison Farm</div>
<table class="infobox">
<tr><th colspan="2" class="infobox-title">Stop Cop City</th></tr>
<tr><td colspan="2" class="infobox-image"><img src="https://upload.example.org/forest.jpg" width="290" height="218"><div class="infobox-caption">The forest in 2021</div></td></tr>
<tr><th>Dates</th><td>2021 – 2025</td></tr>
<tr><th>Location</th><td>Atlanta, Georgia</td></tr>
<tr><th>Caused by</th><td>Planned police training facility</td></tr>
</table>
<p>${BODY1}<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>
<h2>Background</h2>
<p>${BODY2}<sup class="reference"><a href="#cite_note-2">[2]</a></sup></p>
<h2>History</h2>
<p>${BODY3}</p>
<ul class="gallery">
<li class="gallerybox"><img src="https://upload.example.org/a.jpg" width="120" height="90"><div class="gallerytext">First photo</div></li>
<li class="gallerybox"><img src="https://upload.example.org/b.jpg" width="120" height="90"><div class="gallerytext">Second photo</div></li>
</ul>
<p><audio src="https://upload.example.org/pronunciation.ogg"></audio></p>
<h2>References</h2>
<div class="reflist"><ol class="references">
<li id="cite_note-1"><style>.cite{color:red}</style><span class="reference-text">Biello, Peter (April 29, 2025). "Cop City opens in Atlanta". Georgia Today.</span></li>
<li id="cite_note-2"><span class="reference-text">Pratt, Charles (2023). The Forest and the City. University Press.</span></li>
</ol></div>
<table class="navbox">
<tr><td class="navbox-title" colspan="2">Atlanta topics</td></tr>
<tr><th class="navbox-group">History</th><td class="navbox-list"><a href="/wiki/History_of_Atlanta">History of Atlanta</a> <a href="/wiki/Atlanta_riots">Atlanta riots</a></td></tr>
</table>
<div class="printfooter">Retrieved from "https://en.wikipedia.org/w/index.php?title=Stop_Cop_City"</div>
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

async function run(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  await waitFor(() => !!w.document.querySelector('#br-pill'), 3000);
  return w;
}

(async () => {
  // ---- Wikipedia fixture ----
  const w = await run(wikiHtml, 'https://en.wikipedia.org/wiki/Stop_Cop_City');
  const S = w.__BR, det = S.detected;
  chk('wiki: detected', !!det);
  chk('wiki: title is the h1, not the description', det && det.title === 'Stop Cop City');
  chk('wiki: subtitle is the short description', det && det.subtitle === 'American social movement');
  chk('wiki: wiki flag', det && det.wiki === true);
  const kinds = {};
  (det ? det.blocks : []).forEach(b => { kinds[b.type] = (kinds[b.type] || 0) + 1; });
  chk('wiki: hatnote block', (kinds.hatnote || 0) === 1);
  const ib = det.blocks.find(b => b.type === 'infobox');
  chk('wiki: infobox block with label rows + image', !!ib && ib.image.indexOf('forest.jpg') >= 0 && ib.rows.filter(r => r.label).length >= 3);
  const gal = det.blocks.find(b => b.type === 'gallery');
  chk('wiki: gallery block with 2 captioned images', !!gal && gal.images.length === 2 && gal.images[0].caption === 'First photo');
  const nb = det.blocks.find(b => b.type === 'navbox');
  chk('wiki: navbox block with a link group', !!nb && nb.groups.length === 1 && nb.groups[0].links.length === 2);
  const rl = det.blocks.find(b => b.type === 'list' && b.references);
  chk('wiki: reflist marked compact', !!rl && rl.items.length === 2);
  chk('wiki: no Retrieved-from junk', !det.blocks.some(b => /retrieved from/i.test(b.text || '')));
  chk('wiki: in-page TOC not in body', !det.blocks.some(b => b.type === 'list' && (b.items || []).join(' ') === 'Background History References'));
  const audioB = det.blocks.find(b => b.type === 'video' && b.audio);
  chk('wiki: pronunciation audio block', !!audioB && /pronunciation\.ogg/.test(audioB.src));
  w.__open();
  await sleep(500);
  const d = w.document, body = d.querySelector('.br-body');
  const chips = body.querySelectorAll('.br-fnref');
  chk('wiki: citation chips rendered', chips.length === 2);
  chk('wiki: chip note has no CSS', !!chips[0] && (chips[0].getAttribute('data-note') || '').indexOf('.cite') < 0 && (chips[0].getAttribute('data-note') || '').indexOf('Biello') >= 0);
  chk('wiki: infobox card rendered', !!body.querySelector('.br-infobox .br-ib-row'));
  chk('wiki: gallery rendered', !!body.querySelector('.br-gallery figure'));
  chk('wiki: reflist compact in DOM', !!body.querySelector('ol.br-reflist'));
  const nav = body.querySelector('.br-navbox');
  chk('wiki: navbox starts collapsed', !!nav && !nav.classList.contains('br-open'));
  nav.querySelector('.br-navbox-head').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('wiki: navbox header tap expands', nav.classList.contains('br-open'));
  chk('wiki: audio element rendered', !!body.querySelector('audio'));

  // ---- generic article: collapsible sections ----
  const w2 = await run(plainHtml, 'https://example.com/bridges/');
  const S2 = w2.__BR;
  chk('plain: detected', !!S2.detected);
  w2.__open();
  await sleep(500);
  const d2 = w2.document, body2 = d2.querySelector('.br-body');
  const secs = body2.querySelectorAll('.br-asec');
  chk('plain: 3 sections (Design, Materials nested, History)', secs.length === 3);
  const design = [...body2.querySelectorAll('.br-asec > h2')].find(h => h.textContent.indexOf('Design') >= 0);
  chk('plain: sections start expanded', !!design && !design.parentElement.classList.contains('br-closed'));
  design.dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('plain: heading tap folds Design (and its nested subsection body hides with it)', design.parentElement.classList.contains('br-closed'));
  const rec = S2.progress['https://example.com/bridges/'];
  chk('plain: fold persisted in the progress record', !!rec && Array.isArray(rec.collapsed) && rec.collapsed.length === 1);
  S2.saveProgress ? null : 0;
  design.dispatchEvent(new w2.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(40);
  chk('plain: second tap unfolds and unpersists', !design.parentElement.classList.contains('br-closed') && !(S2.progress['https://example.com/bridges/'] || {}).collapsed);
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
