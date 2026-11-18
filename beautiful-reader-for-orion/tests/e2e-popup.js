const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
const popupJs = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/popup.js', 'utf8');
const popupHtml = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/popup.html', 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');

const store = { 'br.autoSites.v1': ['wired.com'] };
let sentMessages = 0;
const sentLog = [];
const dom = new JSDOM(popupHtml, { url: 'moz-extension://abc/popup.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.browser = {
  storage: { local: {
    get: (k) => Promise.resolve({ [k]: store[k] }),
    set: (o) => { Object.assign(store, o); return Promise.resolve(); }
  } },
  tabs: {
    query: () => Promise.resolve([{ id: 7, url: 'https://www.theverge.com/news/story' }]),
    sendMessage: (id, msg) => { sentMessages++; sentLog.push(msg); if (msg && msg.type === 'br:getReaderState') return Promise.resolve({ open: true, detected: true }); return Promise.resolve(); }
  }
};
w.eval(core); w.eval(popupJs);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
setTimeout(() => {
  const doc = w.document, P = w.__BRPOPUP;
  chk('current host from tab', doc.getElementById('cur-host').textContent === 'theverge.com');
  chk('existing site listed', doc.getElementById('site-list').textContent.includes('wired.com'));
  chk('toggle off for unlisted current site', doc.getElementById('cur-toggle').checked === false);
  // Add via API (URL form, www, path)
  chk('addSite normalizes URL', P.addSite('https://www.NYTimes.com/section/x?y=1') === true && P.state.autoSites.includes('nytimes.com'));
  chk('addSite rejects junk', P.addSite('not a site') === false);
  chk('addSite dedupes', P.addSite('nytimes.com') === true && P.state.autoSites.filter(h => h === 'nytimes.com').length === 1);
  chk('sites saved to shared storage', Array.isArray(store['br.autoSites.v1']) && store['br.autoSites.v1'].includes('nytimes.com'));
  // Toggle current site on
  const tgl = doc.getElementById('cur-toggle');
  tgl.checked = true; tgl.dispatchEvent(new w.Event('change', { bubbles: true }));
  chk('toggle adds current site', P.state.autoSites.includes('theverge.com'));
  chk('tab notified of changes', sentMessages >= 2);
  // Remove via API
  P.removeSite('wired.com');
  chk('removeSite works', !P.state.autoSites.includes('wired.com') && !store['br.autoSites.v1'].includes('wired.com'));
  // Defaults render + set
  chk('font select populated', doc.getElementById('set-font').options.length >= 10);
  chk('theme select populated', doc.getElementById('set-light').options.length === 5);
  P.setSetting('fontSize', 22);
  chk('setting saved', store['br.settings.v1'] && store['br.settings.v1'].fontSize === 22);
  chk('size label updates', doc.getElementById('size-val').textContent === '22 pt');
  // v1.9.7: the force button is now a Reader Mode toggle that
  // reflects the page's live state and sends on/off commands.
  chk('force button replaced by reader toggle', !!doc.getElementById('reader-toggle') && !doc.getElementById('force-btn'));
  chk('toggle reflects open reader', doc.getElementById('reader-toggle').checked === true);
  const rt = doc.getElementById('reader-toggle');
  rt.checked = false; rt.dispatchEvent(new w.Event('change', { bubbles: true }));
  chk('flipping off sends toggleReader off', sentLog.some(m => m && m.type === 'br:toggleReader' && m.on === false));
  process.exit(fail ? 1 : 0);
}, 600);
