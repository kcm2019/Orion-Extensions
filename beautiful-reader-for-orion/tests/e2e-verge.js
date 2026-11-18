// End-to-end extraction test: real Verge HTML + real extension scripts in jsdom.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');

const html = fs.readFileSync('/tmp/verge.html', 'utf8');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; ' + _r.slice(_i);

const dom = new JSDOM(html, {
  url: 'https://www.theverge.com/gadgets/1024777/best-gifts-for-dad-2026',
  pretendToBeVisual: true, runScripts: 'outside-only'
});
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline in test'));
w.localStorage.setItem('br:br.autoSites.v1', JSON.stringify(['theverge.com']));
w.localStorage.setItem('br:br.settings.v1', JSON.stringify({
  themePair: { light: 'paper', dark: 'slate' }, followSystem: true, font: 'newyork',
  size: 19, line: 1.55, width: 680, pillPos: null, autoOpen: ['theverge.com'], sites: {}
}));
w.eval(core);
w.eval(reader);
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
setTimeout(() => w.document.dispatchEvent(new w.Event('DOMContentLoaded')), 400);

setTimeout(() => {
  const doc = w.document;
  const S = w.__BR;
  console.log('detected:', S && S.detected, 'autoSites:', S && JSON.stringify(S.autoSites));
  const pill = doc.getElementById('br-pill');
  console.log('pill present:', !!pill);
  const rd = doc.getElementById('br-reader');
  console.log('reader open:', !!rd && rd.classList.contains('br-on'));
  if (!rd) { console.log('FAIL: no reader'); process.exit(1); }
  const text = rd.textContent.replace(/\s+/g, ' ');
  const checks = [
    ['no daily email digest', !/daily email digest/i.test(text)],
    ['no homepage feed', !/homepage feed/i.test(text)],
    ['no FollowFollow mash', !/FollowFollow/.test(text)],
    ['no See All Gadgets mash', !/See All Gadgets/.test(text)],
    ['article lede present', /This year, why not get Dad/.test(text)],
    ['title present', /gift guide for dads/i.test(text)],
    ['author present', /Ryan Waniata/.test(text)],
    ['has product content', /DJI|dads|gift/i.test(text)]
  ];
  let fail = 0;
  for (const [name, ok] of checks) { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) fail++; }
  const imgs = Array.from(rd.querySelectorAll('.br-body img, .br-hero img'));
  const uniq = new Set(imgs.map(i => { try { const u = new w.URL(i.src); return u.origin + u.pathname; } catch (e) { return i.src; } }));
  console.log('reader images:', imgs.length, 'unique files:', uniq.size);
  console.log(imgs.length === uniq.size ? 'PASS image dedupe' : 'FAIL image dedupe');
  if (imgs.length !== uniq.size) fail++;
  process.exit(fail ? 1 : 0);
}, 6000);
