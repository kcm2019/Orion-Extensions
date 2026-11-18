const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader-core.js', 'utf8');
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };

// ---------- Part 1: popup tabs (Saved / History / clear) ----------
{
  const popupJs = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/popup.js', 'utf8');
  const popupHtml = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/popup.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const now = Date.now();
  const store = {
    'br.autoSites.v1': [],
    'br.library.v1': [{ url: 'https://a.example/story', title: 'Saved Story One', site: 'a.example', savedAt: now - 86400000, blocks: [] }],
    'br.history.v1': [
      { url: 'https://b.example/recent', title: 'Recent Read', site: 'b.example', ts: now - 30 * 60000, progress: 0.5, done: false },
      { url: 'https://c.example/old', title: 'Old Finished', site: 'c.example', ts: now - 3 * 86400000, progress: 1, done: true }
    ]
  };
  const sent = [];
  const dom = new JSDOM(popupHtml, { url: 'moz-extension://abc/popup.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.browser = {
    storage: { local: {
      get: (k) => Promise.resolve({ [k]: store[k] }),
      set: (o) => { Object.assign(store, o); return Promise.resolve(); }
    } },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: 'https://www.theverge.com/news/x' }]),
      sendMessage: (id, msg) => { sent.push(msg); return Promise.resolve(); },
      update: () => Promise.resolve()
    }
  };
  w.eval(core); w.eval(popupJs);
  setTimeout(() => {
    const doc = w.document, P = w.__BRPOPUP;
    chk('saved tab lists the article', doc.getElementById('saved-list').textContent.includes('Saved Story One'));
    chk('history lists both entries', doc.getElementById('history-list').textContent.includes('Recent Read') && doc.getElementById('history-list').textContent.includes('Old Finished'));
    chk('history shows progress', doc.getElementById('history-list').textContent.includes('50% read'));
    chk('history shows finished', doc.getElementById('history-list').textContent.includes('Finished'));
    // Tab switching
    const histBtn = doc.querySelector('#tabs button[data-tab="history"]');
    histBtn.click();
    chk('history tab visible after click', doc.getElementById('tab-history').hidden === false && doc.getElementById('tab-settings').hidden === true);
    // Clear last hour: removes the 30-min-old entry, keeps the 3-day-old
    P.clearHistory('hour');
    chk('clear last hour keeps old entry', P.state.history.length === 1 && P.state.history[0].title === 'Old Finished');
    chk('clear persisted', store['br.history.v1'].length === 1);
    // Clear all
    P.clearHistory('all');
    chk('clear all empties', P.state.history.length === 0);
    // Remove saved
    P.removeSaved('https://a.example/story');
    chk('saved removal persists', store['br.library.v1'].length === 0);
    // Open saved sends the right message (re-seed first)
    store['br.library.v1'] = [{ url: 'https://a.example/story', title: 'Saved Story One', site: 'a.example', savedAt: now, blocks: [] }];
    P.state.library = store['br.library.v1']; P.renderSaved();
    doc.querySelector('#saved-list .art').click();
    chk('open saved messages the tab', sent.some(m => m.type === 'br:openSaved' && m.url === 'https://a.example/story'));
    part2();
  }, 700);
}

// ---------- Part 2: content script records history + website font ----------
function part2() {
  let _r = fs.readFileSync('/home/hatch/workspace/orion-beautiful-reader/reader.js', 'utf8');
  const _i = _r.lastIndexOf('})();');
  const reader = _r.slice(0, _i) + 'window.__BR = S; window.__close = closeReader; ' + _r.slice(_i);
  const P = (n) => 'Font story paragraph ' + n + ' carries enough of the tale to qualify as a genuine article body for the reader, with names, dates, figures and direct quotes included throughout the whole piece for the record.';
  const html = `<!DOCTYPE html><html><head><title>Font Story — Site</title>
  <meta property="og:title" content="Font Story"><meta property="og:image" content="https://cdn.example.com/h.jpg">
  <style>article p { font-family: 'Site Serif', Georgia, serif; }</style>
  </head><body><article><h1>Font Story</h1>${[1, 2, 3, 4, 5].map(n => '<p>' + P(n) + '</p>').join('')}</article></body></html>`;
  const dom = new JSDOM(html, { url: 'https://site.example/news/font-story', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('offline'));
  w.eval(core); w.eval(reader);
  setTimeout(() => {
    const pill = w.document.getElementById('br-pill');
    chk('pill appears', !!pill);
    const ev = (t) => { const e = new w.MouseEvent(t, { bubbles: true }); e.clientX = 10; e.clientY = 10; return e; };
    pill.dispatchEvent(ev('pointerdown')); pill.dispatchEvent(ev('pointerup'));
    setTimeout(() => {
      chk('reader open', w.__BR.open === true);
      const hist = JSON.parse(w.localStorage.getItem('br:br.history.v1') || '[]');
      chk('history recorded the open', hist.length === 1 && hist[0].title === 'Font Story');
      const ff = w.__BR.articleBody ? w.__BR.articleBody.style.fontFamily : '';
      chk('website font adopted (' + ff + ')', /Site Serif/.test(ff));
      // Scroll halfway and close -> history progress updates
      const r = w.__BR.reader;
      Object.defineProperty(r, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(r, 'clientHeight', { value: 1000, configurable: true });
      r.scrollTop = 500;
      w.__close();
      const hist2 = JSON.parse(w.localStorage.getItem('br:br.history.v1') || '[]');
      chk('history progress updated on close', hist2.length === 1 && Math.abs(hist2[0].progress - 0.5) < 0.01 && hist2[0].done === false);
      process.exit(fail ? 1 : 0);
    }, 900);
  }, 3200);
}
