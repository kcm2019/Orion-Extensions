// Overlay watchdog: the reader samples what is painted over it
// (elementFromPoint) and redraws itself above an intruder —
// re-append for DOM order, hide+show to re-stack in the top
// layer. With nothing over it, it must do nothing at all.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S; window.__EX = extractArticle; window.__check = overlayCheck; ' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

const P = (t) => `<p>${t} ${'with enough ordinary reporting detail to read like real article prose. '.repeat(4)}</p>`;
const story =
  P('Alpha lede paragraph opens the story with real reporting.') +
  P('Bravo second paragraph continues the account with specifics.') +
  P('Charlie third paragraph adds background and official reaction.') +
  P('Delta fourth paragraph closes the piece with wider context.');
const html = `<!DOCTYPE html><html><head><title>Story — Site</title></head><body>
<article><h1>A Headline Long Enough To Be The Title</h1>${story}</article></body></html>`;
const dom = new JSDOM(html, { url: 'https://watch.example/story', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = () => Promise.reject(new Error('offline'));
w.eval(core); w.eval(reader);
const d = w.document;

setTimeout(() => {
  const pill = d.getElementById('br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 100 }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: 100 }));
  setTimeout(() => {
    chk('reader open', w.__BR.open === true);
    const r = d.getElementById('br-reader');
    // Give the reader a working top-layer API (jsdom lacks one)
    // and record how the watchdog uses it.
    const calls = [];
    const origMatches = r.matches.bind(r);
    r.showPopover = function () { calls.push('show'); };
    r.hidePopover = function () { calls.push('hide'); };
    r.matches = function (sel) { if (sel === ':popover-open') return true; return origMatches(sel); };
    r.setAttribute('popover', 'manual');
    const intruder = d.createElement('div');
    intruder.id = 'evil-popup';

    // Phase 1: an intruder covers the sample points and the
    // reader is not last in the body → full escalation.
    d.body.appendChild(intruder);
    d.elementFromPoint = function () { return intruder; };
    w.__check();
    // v1.9.6: a popover-open reader is NOT moved (moving kills
    // the popover); the top-layer re-entry does the work.
    chk('intruder detected: reader not moved while popover-open', d.body.lastElementChild === intruder);
    chk('intruder detected: top layer re-entered (hide then show)', calls.join(',') === 'hide,show');

    // Phase 2: the points hit the reader's own content → the
    // watchdog must stand down completely.
    calls.length = 0;
    const after = d.createElement('div');
    d.body.appendChild(after);
    const innerP = r.querySelector('.br-body p');
    d.elementFromPoint = function () { return innerP; };
    w.__check();
    chk('own content on top: no re-append', d.body.lastElementChild === after);
    chk('own content on top: no top-layer churn', calls.length === 0);

    // Phase 3 (v1.9.6): the popover died (moved/removed by the
    // page) — the check re-enters the top layer immediately,
    // before any hit-testing.
    r.matches = function (sel) { if (sel === ':popover-open') return false; return origMatches(sel); };
    calls.length = 0;
    d.elementFromPoint = function () { return innerP; };
    w.__check();
    chk('dead popover re-enters the top layer', calls.join(',') === 'show');
    process.exit(fail ? 1 : 0);
  }, 800);
}, 3400);
