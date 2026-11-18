const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; ' + _r.slice(_i);

const P1 = 'Regulators opened the hearing on Tuesday morning with a long statement about the state of the market and what comes next for everyone involved in it. The room was quiet as the chair laid out the timeline for the review, the evidence gathered so far, and the questions that witnesses would be asked to answer under oath during the afternoon session and into the evening hours.';
const P2 = 'Shares moved higher after the announcement, and analysts said the decision could reshape the industry over the next several years in significant ways. Investors who had been waiting on the sidelines moved quickly, and by the closing bell the sector had posted its strongest single day of gains in more than two years of trading on the exchange.';
const LINKP = 'Readers can follow <a href="/related/full-story">the complete coverage</a> from our newsroom for the background and the reaction as it develops today. Our reporters are in the room and will update this story as the testimony continues through the week ahead.';
const articleHtml = (extraImg) => `<!DOCTYPE html><html><head><title>Story — Site</title>
<meta property="og:title" content="Story">
</head><body><article>
<h1>Story</h1>
<p>${P1}</p>
${extraImg || ''}
<p>${LINKP}</p>
<p>${P2}</p>
</article></body></html>`;

function boot(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  return w;
}
function openViaPill(w) {
  const doc = w.document;
  const pill = doc.getElementById('br-pill');
  if (!pill) return false;
  const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
  pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
  return true;
}
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // A: links + print clone
  {
    const w = boot(articleHtml('<p><img src="https://cdn.example.com/photo.jpg" alt=""></p>'), 'https://site.example/news/story-1');
    await wait(3200);
    chk('A pill on article page', openViaPill(w));
    await wait(700);
    const doc = w.document;
    const a = w.__BR.current;
    chk('A block kept link html', !!(a && a.blocks.some(b => b.html && b.html.includes('<a href="https://site.example/related/full-story"'))));
    const ra = doc.querySelector('.br-body p a');
    chk('A rendered link is clickable + new tab', !!ra && ra.getAttribute('target') === '_blank');
    chk('A reader faded in (opacity 1)', w.__BR.reader.style.opacity === '1');
    chk('A rise class applied then cleaned or present', !!doc.querySelector('.br-article'));
    const gear = doc.querySelector('[data-act="aa"]');
    gear.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(500);
    // This Site section is first now
    const heads = Array.from(doc.querySelectorAll('.br-sec-head')).map(h => h.textContent.replace(/[⌄›]/g, '').trim());
    chk('A menu order: This Site first', heads[0] === 'This Site');
    const pdfBtn = Array.from(doc.querySelectorAll('.br-mrow')).find(b => b.textContent.includes('Export PDF'));
    chk('A export pdf row exists', !!pdfBtn);
    pdfBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(400);
    const print = doc.getElementById('br-print');
    chk('A print clone built', !!print);
    chk('A print clone has article + image', !!print && print.textContent.includes('Regulators opened') && !!print.querySelector('img'));
    chk('A print clone has no status/buttons', !!print && !print.querySelector('.br-status') && !print.querySelector('button'));
    chk('A print clone keeps link', !!print && !!print.querySelector('a'));
  }
  // B: homepage excluded
  {
    const w = boot(articleHtml(''), 'https://site.example/');
    await wait(3200);
    chk('B no pill on homepage', !w.document.getElementById('br-pill'));
    chk('B nothing detected', !w.__BR.detected);
  }
  // C: late image insertion
  {
    const w = boot(articleHtml('<p><img id="lateimg" alt=""></p>'), 'https://site.example/news/story-2');
    await wait(3200);
    chk('C pill', openViaPill(w));
    await wait(600);
    const doc = w.document;
    chk('C no late figure yet', !doc.querySelector('[data-brk*="late.jpg"]'));
    w.document.getElementById('lateimg').setAttribute('src', 'https://cdn.example.com/late.jpg');
    await wait(3600);
    const fig = doc.querySelector('[data-brk*="late.jpg"]');
    chk('C late image inserted', !!fig);
    if (fig) {
      const kids = Array.from(doc.querySelector('.br-body').children);
      const fi = kids.indexOf(fig);
      const before = kids[fi - 1], after = kids[fi + 1];
      chk('C inserted between the right paragraphs', !!before && before.textContent.includes('Regulators') && !!after && after.textContent.includes('complete coverage'));
    }
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(2); });
