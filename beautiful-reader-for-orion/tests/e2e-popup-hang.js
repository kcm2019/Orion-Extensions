// v1.18.8: the popup must populate even when the storage
// API hangs. A wedged extension context can leave
// browser.storage.local.get pending forever; the popup now
// caps the wait and falls back, so init completes and the
// menu renders with defaults instead of sitting blank.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
const popupHtml = fs.readFileSync(__dirname + '/../popup.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
const popupJs = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(popupHtml, { url: 'moz-extension://test/popup.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.browser = {
  storage: { local: {
    get: () => new Promise(() => {}), // never settles — the wedge
    set: () => Promise.resolve()
  } },
  tabs: {
    query: () => Promise.resolve([{ id: 7, url: 'https://www.theverge.com/news/story' }]),
    sendMessage: () => Promise.resolve({ open: false, detected: true })
  },
  runtime: {}
};
w.eval(core);
w.eval(popupJs);

(async () => {
  await sleep(2600); // storage cap is 1500 ms
  chk('popup initialized despite hanging storage', !!w.__BRPOPUP);
  const at = w.document.getElementById('all-toggle');
  chk('controls rendered with defaults', !!at && at.checked === false);
  chk('current-site row populated', (w.document.getElementById('cur-host') || {}).textContent === 'theverge.com');
  console.log(fail ? fail + ' FAILURES' : 'ALL POPUP-HANG PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
