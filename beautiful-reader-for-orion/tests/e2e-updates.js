// e2e for the update checker popup UI (v1.17.0 feature; scenario shifted +1 version per release): auto check on
// open finds the feed's newer version, notice + Download +
// dismiss behave, manual check reports current / error
// honestly. Not shipped.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const dir = '/home/hatch/workspace/orion-beautiful-reader/';
const core = fs.readFileSync(dir + 'reader-core.js', 'utf8');
const upd = fs.readFileSync(dir + 'update-check.js', 'utf8');
const popupJs = fs.readFileSync(dir + 'popup.js', 'utf8');
const popupHtml = fs.readFileSync(dir + 'popup.html', 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');

const FEED_NEW = { addons: { 'orion-beautiful-reader@local': { updates: [
  { version: '1.19.0', update_link: 'https://example.com/br-1.19.0.xpi' }
] } } };
const FEED_CURRENT = { addons: { 'orion-beautiful-reader@local': { updates: [
  { version: '1.18.0', update_link: 'https://example.com/br-1.18.0.xpi' }
] } } };
let feedImpl = () => Promise.resolve({ status: 200, json: () => Promise.resolve(FEED_NEW) });

const store = { 'br.autoSites.v1': [], upd_last_check: 0 };
const tabsCreated = [];
const dom = new JSDOM(popupHtml, { url: 'moz-extension://abc/popup.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.fetch = (url, opts) => feedImpl(url, opts);
w.browser = {
  storage: { local: {
    get: (k) => Promise.resolve({ [k]: store[k] }),
    set: (o) => { Object.assign(store, o); return Promise.resolve(); }
  } },
  tabs: {
    query: () => Promise.resolve([{ id: 7, url: 'https://www.theverge.com/news/story' }]),
    sendMessage: () => Promise.resolve({ open: false }),
    create: (o) => { tabsCreated.push(o.url); return Promise.resolve({}); }
  }
};
w.eval(core); w.eval(upd); w.eval(popupJs);

let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const doc = w.document;
  await wait(900);
  chk('updates section present', !!doc.getElementById('sec-updates'));
  chk('version label shows v1.18.0', doc.getElementById('upd-version').textContent === 'v1.18.0');
  chk('auto check found the update', !!(store.upd_available && store.upd_available.version === '1.19.0'));
  chk('notice visible', doc.getElementById('upd-notice').hidden === false);
  chk('notice names the version', doc.getElementById('upd-notice-text').textContent.includes('1.19.0'));
  chk('status names the update', doc.getElementById('upd-status').textContent.includes('Update available: v1.19.0'));

  doc.getElementById('upd-download').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(100);
  chk('download opens the xpi link in a tab', tabsCreated.includes('https://example.com/br-1.19.0.xpi'));

  doc.getElementById('upd-dismiss').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(100);
  chk('dismiss hides the notice', doc.getElementById('upd-notice').hidden === true);
  chk('dismiss is stored', store.upd_dismissed === '1.19.0');

  doc.getElementById('upd-check').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  chk('manual check re-reports the update', doc.getElementById('upd-status').textContent.includes('Update available: v1.19.0'));
  chk('dismissed update stays hidden after re-check', doc.getElementById('upd-notice').hidden === true);

  feedImpl = () => Promise.resolve({ status: 200, json: () => Promise.resolve(FEED_CURRENT) });
  doc.getElementById('upd-check').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  chk('manual check reports latest honestly', doc.getElementById('upd-status').textContent.includes("You're on the latest version (v1.18.0)"));
  chk('available cleared when current', store.upd_available === null);

  feedImpl = () => Promise.reject(new Error('offline'));
  doc.getElementById('upd-check').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(300);
  chk('manual check reports unreachable feed', doc.getElementById('upd-status').textContent.includes("Couldn't check for updates (feed unreachable)"));

  console.log(fail ? ('FAILURES: ' + fail) : 'ALL UPDATES E2E PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
