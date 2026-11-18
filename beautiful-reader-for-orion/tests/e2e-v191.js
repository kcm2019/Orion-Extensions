// v1.9.1: caption legibility — credits use the secondary colour
// (the faint colour was unreadable on light themes) and image
// captions are left-aligned, from Kurt's Verge screenshot.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__open = openReader;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
const html = `<!DOCTYPE html><html><head><title>Caption Story</title>
<meta property="og:title" content="Caption Story"></head><body><main><article>
<h1>Caption Story</h1>
${P('Alpha lede paragraph opens the story.')}
<figure><img src="https://images.example.com/phone.jpg" width="1200" height="800"><figcaption>Let's get to work. Photo: Allison Johnson / The Verge</figcaption></figure>
${P('Bravo second paragraph continues the account.')}
${P('Charlie third paragraph adds background and reaction.')}
${P('Delta fourth paragraph closes the piece.')}
</article></main></body></html>`;
const dom = new JSDOM(html, { url: 'https://www.theverge.com/story/caption', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
setTimeout(() => {
  w.__open();
  const css = (w.document.getElementById('br-style') || {}).textContent || '';
  const capRule = (css.match(/\.br-hero figcaption[^{]*\{[^}]*\}/) || [''])[0];
  chk('figcaption rule left-aligns', /text-align:left/.test(capRule));
  const creditRule = (css.match(/\.br-credit\{[^}]*\}/) || [''])[0];
  chk('credit uses secondary colour', /color:var\(--br-secondary\)/.test(creditRule));
  chk('credit is not faint', !/--br-faint/.test(creditRule));
  chk('credit can wrap', !/nowrap/.test(creditRule));
  // The Verge credit form splits and renders.
  const credit = w.document.querySelector('.br-body figcaption .br-credit');
  chk('verge credit splits', !!credit && /ALLISON JOHNSON/i.test(credit.textContent) || !!credit && /Allison Johnson/.test(credit.textContent));
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V191 PASS');
  process.exit(fail ? 1 : 0);
}, 700);
