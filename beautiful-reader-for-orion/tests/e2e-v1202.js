// v1.20.1 (second half): link taps, footnote links,
// Wikipedia media. Kurt's reports: (1) tapping any
// link in the reader did nothing — only long-press
// worked; the v1.18.6 window.open answer was not
// enough on Orion. Links now go through openLink():
// background tabs.create first, window.open second,
// same-tab last, with a stamp deduping the pointerup
// tap path against the click path, and clean pointer
// taps on links handled like image taps (v1.15.1's
// swallowed-click lesson). (2) Footnote references
// should keep their own links clickable: chips now
// carry data-notehtml and the popup renders it.
// (3) Wikipedia audio/video: figures wrap players
// exactly like images, so figure media vanished;
// galleries and infobox cells dropped media too.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;window.__open = openReader;window.__openLink = openLink;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await sleep(50); }
  return false;
}
const BODY1 = 'The movement began in 2021 when residents and activists organized against the planned training facility, arguing it would destroy one of the largest remaining forest tracts in the metro area. Organizers built camps in the forest and gathered petition signatures across the south side of the city, and the campaign drew national attention from outlets like <a href="https://example.org/story">this report</a> and others following the fight.';
const BODY2 = 'Opponents raised concerns about destruction of the forest and associated waterways, pointing to the site history as a former prison farm and to the creek heritage of the land itself. Supporters answered that the project was necessary to fight crime and improve officer morale after a difficult year, and the city council ultimately voted to approve the lease despite the objections.';
const BODY3 = 'The state later charged several protesters under domestic terrorism statutes and indicted dozens of people on racketeering charges, a response that civil liberties groups described as an unprecedented escalation against a protest movement. Trials stretched across two years, and the cases became a national reference point for debates about protest policing.';

const html = `<!DOCTYPE html><html><head><title>Media And Links Test Article</title></head><body>
<div id="mw-content-text">
<table class="infobox">
<tr><th colspan="2" class="infobox-title">Test Topic</th></tr>
<tr><th>Anthem</th><td><audio src="https://upload.example.org/anthem.ogg"></audio></td></tr>
<tr><th>Location</th><td>Atlanta, Georgia</td></tr>
</table>
<p>${BODY1}<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p>
<figure><video poster="https://upload.example.org/poster.jpg"><source src="https://upload.example.org/clip.ogv" type="video/ogg"><source src="https://upload.example.org/clip.webm" type="video/webm"></video><figcaption>The forest clearing in 2023</figcaption></figure>
<p>${BODY2}</p>
<figure><audio src="https://upload.example.org/speech.ogg"></audio><figcaption>Remarks at the hearing</figcaption></figure>
<p>${BODY3}</p>
<ul class="gallery">
<li class="gallerybox"><img src="https://upload.example.org/a.jpg" width="120" height="90"><div class="gallerytext">Still photo</div></li>
<li class="gallerybox"><video poster="https://upload.example.org/gp.jpg"><source src="https://upload.example.org/g.webm" type="video/webm"></video><div class="gallerytext">Short clip</div></li>
</ul>
<h2>References</h2>
<div class="reflist"><ol class="references">
<li id="cite_note-1"><span class="reference-text">Biello, Peter (2025). "Cop City opens". Georgia Today. doi:<a href="https://doi.org/10.1234/example">10.1234/example</a>.</span></li>
</ol></div>
</div>
</body></html>`;

(async () => {
  const dom = new JSDOM(html, { url: 'https://en.wikipedia.org/wiki/Test_Topic', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  const opened = [];
  w.open = (url) => { opened.push(url); return {}; };
  w.eval(core); w.eval(reader);
  await waitFor(() => !!w.document.querySelector('#br-pill'), 3000);
  const S = w.__BR, det = S.detected;
  chk('detected', !!det);
  const vid = det.blocks.find(b => b.type === 'video' && !b.audio);
  chk('figure video harvested', !!vid);
  chk('webm preferred over ogv', !!vid && /clip\.webm$/.test(vid.src));
  chk('video caption carried', !!vid && vid.caption === 'The forest clearing in 2023');
  chk('video poster carried', !!vid && /poster\.jpg$/.test(vid.poster));
  const aud = det.blocks.find(b => b.type === 'video' && b.audio && /speech\.ogg$/.test(b.src));
  chk('figure audio harvested with caption', !!aud && aud.caption === 'Remarks at the hearing');
  const gal = det.blocks.find(b => b.type === 'gallery');
  chk('gallery has image + video items', !!gal && gal.images.length === 2 && !!gal.images.find(g => g.video && /g\.webm$/.test(g.video)));
  const ib = det.blocks.find(b => b.type === 'infobox');
  chk('infobox anthem row is playable media', !!ib && ib.rows.some(r => r.media && /anthem\.ogg$/.test(r.media.src)));

  w.__open();
  await sleep(600);
  const d = w.document, body = d.querySelector('.br-body');
  chk('video element rendered with caption', !!body.querySelector('video') && body.textContent.includes('The forest clearing in 2023'));
  chk('gallery video element rendered', !!body.querySelector('.br-gallery video'));
  chk('infobox audio element rendered', !!body.querySelector('.br-infobox audio'));

  // Footnote link: chip carries the HTML note; popup shows a live link.
  const chip = body.querySelector('.br-fnref');
  chk('chip carries data-notehtml with the DOI link', !!chip && (chip.getAttribute('data-notehtml') || '').includes('https://doi.org/10.1234/example'));
  chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(60);
  const pop = d.querySelector('#br-fnpop');
  const popLink = pop.querySelector('a[href="https://doi.org/10.1234/example"]');
  chk('footnote popup renders the reference link', !!popLink);
  popLink.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(30);
  chk('footnote link tap opens the DOI', opened.filter(u => u === 'https://doi.org/10.1234/example').length === 1);

  // Body link: pointer tap opens once; the following click is deduped.
  const link = [...body.querySelectorAll('a[href="https://example.org/story"]')][0];
  chk('body link present', !!link);
  link.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
  link.dispatchEvent(new w.PointerEvent('pointerup', { bubbles: true, clientX: 11, clientY: 11 }));
  await sleep(30);
  chk('clean pointer tap opens the link', opened.filter(u => u === 'https://example.org/story').length === 1);
  link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(30);
  chk('trailing click does not open a second tab', opened.filter(u => u === 'https://example.org/story').length === 1);
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
