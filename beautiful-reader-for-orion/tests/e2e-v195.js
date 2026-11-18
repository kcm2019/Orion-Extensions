// v1.9.5: three device-reported fixes.
// (1) Auto-scroll never moved: at 40 px/s each frame adds
//     ~0.67 px and engines that quantise scrollTop discarded
//     it. The loop now accumulates and steps in whole pixels.
// (2) The flow chip gains play/pause for auto-scroll.
// (3) The Verge renders its dek as a plain leading paragraph;
//     extraction must promote it to the subtitle (the pasted
//     device report showed the meta description instead).
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) +
  'window.__BR = S; window.__EX = extractArticle; window.__scrollStart = scrollStart; ' +
  'window.__scrollStop = scrollStop; window.__flow = flowState;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose for the detection gates. '.repeat(3)}</p>`;
const html = `<!DOCTYPE html><html><head><title>Scroll Story</title>
<meta property="og:title" content="Scroll Story"></head><body><main><article>
<h1>Scroll Story</h1>
${P('Alpha lede paragraph opens the story.')}
${P('Bravo second paragraph continues the account.')}
${P('Charlie third paragraph adds background and reaction.')}
${P('Delta fourth paragraph closes the piece.')}
</article></main></body></html>`;

(async () => {
  // --- (3) Verge fixture: paragraph dek promoted ---
  {
    const fixture = fs.readFileSync(__dirname + '/fixtures/verge-duet.html', 'utf8');
    const dom = new JSDOM(fixture, { url: 'https://www.theverge.com/ai-artificial-intelligence/1032518/claude-duet-ai-agent-hands-on', pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window;
    w.fetch = () => Promise.reject(new Error('offline'));
    w.eval(core); w.eval(reader);
    const art = w.__EX(w.document, w.location.href);
    chk('verge subtitle is the on-page dek', !!art && art.subtitle === 'Duet is a decent helper, if a little jumpy at times.');
    chk('dek paragraph left the body', !!art && art.blocks[0].type === 'image');
    chk('verge images extracted', !!art && art.blocks.filter((b) => b.type === 'image').length >= 2);
  }

  // --- (1)+(2) auto-scroll motion + chip ---
  {
    const dom = new JSDOM(html, { url: 'https://scroll.example.com/story', pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window;
    const doc = w.document;
    w.fetch = () => Promise.reject(new Error('offline'));
    w.eval(core); w.eval(reader);
    const S = w.__BR;
    let pill = null;
    for (let i = 0; i < 50 && !pill; i++) { await wait(80); pill = doc.getElementById('br-pill'); }
    const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
    pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
    await wait(300);
    chk('reader open', S.open === true);
    Object.defineProperty(S.reader, 'scrollHeight', { value: 8000, configurable: true });
    Object.defineProperty(S.reader, 'clientHeight', { value: 700, configurable: true });
    S.reader.scrollTop = 0;
    w.__scrollStart();
    await wait(1000);
    const moved = S.reader.scrollTop;
    chk('auto-scroll actually moves (was 0 before the fix)', moved >= 15);
    const chip = S.flowChip;
    chk('chip visible while scrolling', !!chip && chip.classList.contains('br-on') && chip.textContent.includes('Auto-scroll'));
    const buttons = chip ? Array.from(chip.querySelectorAll('button')) : [];
    chk('chip has play/pause and stop', buttons.length === 2 && buttons[0].textContent === '⏸' && buttons[1].textContent === '✕');
    buttons[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    chk('pause toggles state', w.__flow().scrollPaused === true);
    const atPause = S.reader.scrollTop;
    await wait(450);
    chk('paused means no motion', S.reader.scrollTop === atPause);
    const buttons2 = Array.from(chip.querySelectorAll('button'));
    chk('chip shows play while paused', buttons2[0].textContent === '▶');
    buttons2[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(450);
    chk('resume moves again', S.reader.scrollTop > atPause);
    w.__scrollStop();
    chk('stop clears state', w.__flow().scrollOn === false);
  }

  console.log(fail ? ('FAILURES: ' + fail) : 'ALL V195 PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR', e && e.stack || e); process.exit(1); });
