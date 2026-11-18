// WSJ round 2, from Kurt's Nov 15 screenshots:
//  (1) the markets ribbon (Nikkei 59948.37 -1.95 % …) and the
//      section rail (Conversation / What to Read Next / Most
//      Popular News …) leak into the reader as text — as list
//      items AND as standalone paragraphs;
//  (2) the caption line under a photo ("Nico Caprez is vice
//      president … JACQUELYN MARTIN/AP") never reaches the
//      reader, because WSJ marks it up as a plain div inside
//      the figure, not a <figcaption> — plus the sibling
//      variant, a caption div trailing the image's wrapper.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__EX = extractArticle; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose, said the people familiar with the matter. '.repeat(3)}</p>`;
const CAP1 = 'Nico Caprez is vice president of global AI infrastructure growth at Nvidia. JACQUELYN MARTIN/AP';
const CAP2 = 'The second photo, taken during the Taipei briefing earlier this week.';
const html = `<!DOCTYPE html><html><head><title>Nvidia Story - WSJ</title>
<meta property="og:title" content="Nvidia Story"></head><body>
<main><article>
<h1>Nvidia’s Days as an Open Checkbook Are Numbered</h1>
${P('Alpha lede paragraph opens the story with real reporting about the financing program.')}
${P('Bravo second paragraph continues the account with specifics and named sources.')}
<figure><img src="https://images.wsj.net/im-111/photo.jpg" width="1200" height="800"><div class="media-caption">${CAP1}</div></figure>
${P('Charlie third paragraph adds background and official reaction to the reporting.')}
<div class="media-wrap"><img src="https://images.wsj.net/im-222/photo2.jpg" width="1200" height="800"><div class="image-caption-text">${CAP2}</div></div>
${P('Delta fourth paragraph closes the piece with wider context on the sector.')}
<p>Gold rose for a third day as investors weighed the most popular model in the survey against a basket of rival forecasts.</p>
<ul><li>First real list item with a complete thought in it.</li><li>Second real list item, also genuine content.</li></ul>
<div class="markets-ribbon"><p>Nikkei</p><p>59948.37</p><p>-1.95 %</p></div>
<ul class="markets-list"><li>Hang Seng</li><li>23835.44</li><li>0.84 %</li><li>Shanghai</li><li>3620.00</li><li>-0.39 %</li><li>BSE Sensex</li><li>82165.05</li></ul>
<ul class="rail"><li>Conversation</li><li>What to Read Next</li><li>Most Popular News</li><li>Most Popular Opinion</li></ul>
</article></main>
</body></html>`;
const dom = new JSDOM(html, { url: 'https://www.wsj.com/tech/ai/nvidia-story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
const art = w.__EX(w.document, 'https://www.wsj.com/tech/ai/nvidia-story');
chk('article readable', !!art && art.readable === true);
const allText = (art.blocks || []).map(b => b.type === 'list' ? (b.items || []).join(' ') : (b.text || '')).join('\n');
chk('prose survives', /Alpha lede paragraph/.test(allText) && /Delta fourth paragraph/.test(allText));
chk('no ticker values', !/59948|23835|3620\.00|82165|-1\.95|0\.84 %|-0\.39/.test(allText));
chk('no ticker labels standing alone', !art.blocks.some(b => /^(Nikkei|Hang Seng|Shanghai|BSE Sensex)$/.test((b.text || '').trim())));
chk('no rail labels', !/Most Popular|What to Read Next|Conversation/.test(allText));
chk('real prose mentioning most popular survives', /most popular model in the survey/.test(allText));
chk('gold sentence survives', /Gold rose for a third day/.test(allText));
chk('real list survives', art.blocks.some(b => b.type === 'list' && (b.items || []).some(i => /First real list item/.test(i))));
const imgs = art.blocks.filter(b => b.type === 'image');
chk('two images harvested', imgs.length === 2);
chk('figure div caption captured', !!imgs[0] && imgs[0].caption.indexOf('Nico Caprez is vice president') === 0);
chk('sibling caption captured', !!imgs[1] && imgs[1].caption === CAP2);
chk('captions not duplicated as text', !art.blocks.some(b => b.type === 'paragraph' && /Nico Caprez is vice president/.test(b.text || '')) &&
    !art.blocks.some(b => b.type === 'paragraph' && /second photo, taken during/.test(b.text || '')));
process.exit(fail ? 1 : 0);
