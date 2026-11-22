// v1.20.1: the global blocklist. Kurt's spec: a
// global list of sites where the reader never opens,
// managed from the reader itself (Aa → This Site →
// Never Open Reader on This Site) and from the
// extension menu (unblock + list); the list OVERRIDES
// the popup's force-enable (Reader Mode) toggle.
// Seeded once with youtube.com and wsj.com; entries
// cover subdomains. An emptied list stays empty.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;window.__open = openReader;window.__force = forceOpenReader;window.__isBlocked = isBlockedHost;' + _r.slice(_i);
const popupJs = fs.readFileSync(__dirname + '/../popup.js', 'utf8');
const popupHtml = fs.readFileSync(__dirname + '/../popup.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BODY = 'The city council met for nine hours on Tuesday to debate the proposal, with residents lining up around the block to speak against the plan and organizers presenting a petition with tens of thousands of signatures from neighbors across the south side of the city who use the forest every week.';
const TAILS = ['The hearing adjourned without a vote.', 'Reporters gathered outside in the rain.', 'A second session is scheduled for Friday.', 'The mayor declined to comment afterward.', 'Organizers promised to return in force.'];
const articleHtml = `<!DOCTYPE html><html><head><title>A Long Article About The Forest Fight</title></head><body><article>
<h1>A Long Article About The Forest Fight</h1>
${TAILS.map(t => '<p>' + t + ' ' + BODY + '</p>').join('\n')}
</article></body></html>`;

async function runReader(url) {
  const dom = new JSDOM(articleHtml, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  await sleep(2600);
  return w;
}

(async () => {
  // Seeded blocks: YouTube (incl. subdomains) and WSJ.
  const yt = await runReader('https://www.youtube.com/watch?v=abc123');
  chk('youtube: seeded list present', JSON.stringify(yt.__BR.blocklist) === JSON.stringify(['youtube.com', 'wsj.com']));
  chk('youtube: no pill', !yt.document.querySelector('#br-pill'));
  yt.__force();
  await sleep(200);
  chk('youtube: force-open refused (blocklist overrides force enable)', !yt.__BR.open);
  yt.__open();
  await sleep(200);
  chk('youtube: openReader refused', !yt.__BR.open);
  const myt = await runReader('https://m.youtube.com/watch?v=abc123');
  chk('m.youtube.com: blocked via subdomain match', !myt.document.querySelector('#br-pill') && myt.__isBlocked('m.youtube.com'));
  const wsj = await runReader('https://www.wsj.com/articles/some-story-123');
  chk('wsj: no pill', !wsj.document.querySelector('#br-pill'));

  // A normal site is untouched; blocking it live closes the gates.
  const ex = await runReader('https://example.com/forest-story/');
  chk('example: pill appears', !!ex.document.querySelector('#br-pill'));
  ex.__open();
  await sleep(500);
  chk('example: reader opens', !!ex.__BR.open);
  ex.__BR.blocklist.push('example.com');
  ex.__open === null;
  const S = ex.__BR;
  // Simulate the post-block state: close + try to reopen.
  S.open = false;
  ex.__force();
  await sleep(200);
  chk('example: after blocking, force-open refused', !S.open);

  // Popup side: blocked current site disables Reader Mode; unblock restores it.
  const store = { 'br.autoSites.v1': [], 'br.blocklist.v1': ['youtube.com', 'wsj.com'] };
  const dom = new JSDOM(popupHtml, { url: 'moz-extension://abc/popup.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.browser = {
    storage: { local: {
      get: (k) => Promise.resolve({ [k]: store[k] }),
      set: (o) => { Object.assign(store, o); return Promise.resolve(); }
    } },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: 'https://www.wsj.com/articles/x' }]),
      sendMessage: () => Promise.resolve({ open: false, detected: false })
    }
  };
  w.eval(core); w.eval(popupJs);
  await sleep(700);
  const doc = w.document, P = w.__BRPOPUP;
  chk('popup: wsj reported blocked', P.isBlocked('wsj.com') === true);
  chk('popup: blocked row visible', doc.getElementById('blocked-row').hidden === false);
  chk('popup: Reader Mode toggle disabled while blocked', doc.getElementById('reader-toggle').disabled === true);
  chk('popup: blocked section lists both seeds', doc.getElementById('blocked-list').textContent.includes('youtube.com') && doc.getElementById('blocked-list').textContent.includes('wsj.com'));
  P.unblockCurrent();
  await sleep(60);
  chk('popup: unblock removes wsj, keeps youtube', !P.state.blocklist.includes('wsj.com') && P.state.blocklist.includes('youtube.com'));
  chk('popup: unblock saved to storage', !store['br.blocklist.v1'].includes('wsj.com'));
  chk('popup: Reader Mode toggle re-enabled', doc.getElementById('reader-toggle').disabled === false);
  console.log(fail ? ('FAILURES: ' + fail) : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); process.exit(1); });
