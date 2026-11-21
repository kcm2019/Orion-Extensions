// v1.19.0: article translation (Google gtx engine) + extras
// A (auto-translate on open), B (per-article cache), C (Saved
// articles). fetch is stubbed with a fake gtx endpoint that
// wraps each chunk in ⟦ ⟧ and reports a configurable detected
// language, so the whole pipeline — chunking, job alignment,
// progressive DOM swaps, the translated clone, cache hits,
// same-language detection — runs end to end offline.
const fs = require('fs');
const { JSDOM } = require('/tmp/brtest/node_modules/jsdom');
const core = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
let _r = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
const _i = _r.lastIndexOf('})();');
const reader = _r.slice(0, _i) + 'window.__BR = S;window.__translateCurrent = translateCurrent;window.__showOriginal = showOriginal;window.__openReader = openReader;window.__openSaved = openSavedArticle;window.__closeReader = closeReader;' + _r.slice(_i);
let fail = 0;
const chk = (n, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 5000)) { if (fn()) return true; await sleep(50); }
  return false;
}

const P1 = 'El nuevo tren de alta velocidad conectó la capital con la costa en menos de dos horas, un trayecto que antes tomaba casi cinco en autobús por la carretera de montaña. Los primeros pasajeros describieron el viaje como silencioso y estable, y la compañía anunció que agregará tres frecuencias diarias antes del verano para atender la demanda de los fines de semana largos.';
const P2 = 'La obra costó más de cuatro mil millones y empleó a seis mil trabajadores durante siete años, incluyendo dos túneles que atraviesan la cordillera y un viaducto de novecientos metros sobre el río. Los ingenieros explicaron que el trazado evita las zonas de deslizamientos que cada invierno obligaban a cerrar la ruta antigua durante semanas enteras, dejando aisladas a decenas de comunidades pequeñas.';
const LONG = ('El ministerio publicó además un informe detallado sobre el impacto ambiental del proyecto y las medidas de compensación adoptadas en cada tramo de la línea. ').repeat(9);
const html = `<!DOCTYPE html><html><head><title>El tren nuevo | Diario</title>
<meta property="og:title" content="El tren nuevo conecta la capital con la costa">
</head><body>
<article>
<h1>El tren nuevo conecta la capital con la costa</h1>
<p>${P1}</p>
<p>${P2}</p>
<p>${LONG}</p>
<ul><li>Primera frecuencia a las seis de la mañana</li><li>Boletos desde veinte dólares</li></ul>
<figure><img src="https://images.example.com/tren.jpg" width="800" height="450"><figcaption>El viaducto sobre el río Bravo</figcaption></figure>
</article>
</body></html>`;
const URL = 'https://www.diario.example/tren-nuevo';

function makePage(pageHtml, url, detected) {
  const dom = new JSDOM(pageHtml, { url: url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  const state = { calls: 0 };
  w.__fetchState = state;
  w.fetch = (u) => {
    const s = String(u);
    if (s.indexOf('translate.googleapis.com') >= 0) {
      state.calls++;
      const q = decodeURIComponent((s.match(/[?&]q=([^&]*)/) || [])[1] || '');
      return Promise.resolve({ ok: true, json: () => Promise.resolve([[['⟦' + q + '⟧', q, null, null, 1]], null, detected]) });
    }
    return Promise.reject(new Error('offline'));
  };
  w.eval(core); w.eval(reader);
  return w;
}
function openViaPill(w) {
  const pill = w.document.querySelector('#br-pill');
  pill.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  pill.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, cancelable: true }));
}

(async () => {
  // ---- Manual translate, flip back, cache hit ----
  const w = makePage(html, URL, 'es');
  chk('pill appears', await waitFor(() => !!w.document.querySelector('#br-pill')));
  await waitFor(() => !!w.__BR.settings);
  openViaPill(w);
  chk('reader opens', await waitFor(() => w.__BR.open === true));
  const bodyText0 = w.document.querySelector('#br-reader .br-body').textContent;
  chk('original Spanish shown first', bodyText0.indexOf('El nuevo tren') >= 0);
  const status = await w.__translateCurrent({});
  chk('manual translate resolves ok', status === 'ok');
  chk('showing translation', w.__BR.showingTranslation === true);
  chk('source language recorded', w.__BR.translatedSource === 'es');
  const title = w.document.querySelector('#br-reader .br-title').textContent;
  chk('title translated', title.indexOf('⟦') === 0);
  const bodyText1 = w.document.querySelector('#br-reader .br-body').textContent;
  chk('paragraphs translated', bodyText1.indexOf('⟦El nuevo tren') >= 0);
  chk('list items translated', bodyText1.indexOf('⟦Primera frecuencia') >= 0);
  chk('caption translated', bodyText1.indexOf('⟦El viaducto') >= 0);
  const callsAfterFirst = w.__fetchState.calls;
  chk('long paragraph was chunked (calls > jobs)', callsAfterFirst >= 8);
  chk('cache stored under url|en', !!w.__BR.translations[URL + '|en']);
  chk('original article untouched', w.__BR.current.blocks.some(b => b.type === 'paragraph' && b.text.indexOf('El nuevo tren') === 0));
  w.__showOriginal();
  chk('flip back clears the flag', w.__BR.showingTranslation === false);
  const bodyText2 = w.document.querySelector('#br-reader .br-body').textContent;
  chk('original text restored', bodyText2.indexOf('El nuevo tren') >= 0 && bodyText2.indexOf('⟦') < 0);
  const status2 = await w.__translateCurrent({});
  chk('second translate is a cache hit', status2 === 'cached');
  chk('cache hit made no network calls', w.__fetchState.calls === callsAfterFirst);

  // ---- A: auto-translate on open, served from the cache (B) ----
  w.__showOriginal();
  w.__closeReader();
  await sleep(150);
  w.__BR.settings.translateAuto = true;
  w.__BR.trAutoTried = '';
  const callsBeforeAuto = w.__fetchState.calls;
  w.__openReader();
  chk('auto-translate applies on reopen', await waitFor(() => w.__BR.showingTranslation === true));
  chk('auto-translate used the cache (no new calls)', w.__fetchState.calls === callsBeforeAuto);

  // ---- C: a Saved (library) article translates too ----
  const w2 = makePage(html, 'https://www.diario.example/otra', 'es');
  await waitFor(() => !!w2.__BR.settings);
  w2.__BR.settings.translateAuto = true;
  w2.__openSaved({
    title: 'El tren nuevo conecta la capital con la costa', subtitle: '', byline: '', date: '',
    site: 'diario.example', url: 'https://www.diario.example/guardado', hero: '', heroVideo: null, favicon: '',
    blocks: [
      { type: 'paragraph', text: P1 }, { type: 'paragraph', text: P2 }, { type: 'paragraph', text: P1 + ' ' + P2 }
    ],
    wordCount: 220, imgCache: {}
  });
  chk('saved article auto-translates on open', await waitFor(() => w2.__BR.showingTranslation === true));
  chk('saved article fetched translations', w2.__fetchState.calls >= 4);
  chk('saved article cached under its own url', !!w2.__BR.translations['https://www.diario.example/guardado|en']);

  // ---- Same language: probe detects en == target, no swap ----
  const enHtml = html.replace(/El tren nuevo/g, 'The new train').replace('El nuevo tren de alta velocidad', 'The brand new high speed train');
  const w3 = makePage(`<!DOCTYPE html><html><head><title>The new train</title></head><body><article>
<h1>The new train connects the capital with the coast</h1>
<p>The brand new high speed train connected the capital with the coast in under two hours, a trip that used to take almost five by bus over the mountain road. The first passengers described the ride as quiet and smooth, and the company announced three more daily departures before the summer to meet demand on long weekends across the region.</p>
<p>The project cost more than four billion and employed six thousand workers over seven years, including two tunnels through the mountain range and a nine hundred metre viaduct over the river. Engineers explained that the route avoids the landslide zones that used to close the old road for weeks every winter, leaving dozens of small communities cut off from the rest of the country.</p>
<p>Tickets went on sale on Monday morning and the first weekend departures sold out within hours, according to the operator, which said it is studying whether to add a night service during the summer season for travellers heading to the coast.</p>
</article></body></html>`, 'https://www.news.example/train', 'en');
  chk('pill appears (en page)', await waitFor(() => !!w3.document.querySelector('#br-pill')));
  await waitFor(() => !!w3.__BR.settings);
  w3.__BR.settings.translateAuto = true;
  openViaPill(w3);
  await sleep(1200);
  chk('same-language article is not translated', w3.__BR.showingTranslation === false);
  chk('same-language probe stopped early', w3.__fetchState.calls > 0 && w3.__fetchState.calls <= 2);
  chk('same-language marked so it will not retry', w3.__BR.trSameLang === 'https://www.news.example/train|en');
  const stSame = await w3.__translateCurrent({});
  chk('manual translate on same-language resolves same', stSame === 'same');

  console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILURES');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
