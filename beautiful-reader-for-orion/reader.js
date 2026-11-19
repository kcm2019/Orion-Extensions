// Beautiful Reader for Orion — content script. Firefox MV2, no background page.
// Core + A (multi-page stitching) + B (resume/progress) + C (TOC from headings)
// + D (highlights/notes + Markdown export) + G (per-site typography)
// + H (save for later / offline library).
// Picks locked Nov 15, 2026: overlay reader; auto-open per-site list only;
// pill position remembered globally; theme follows system unless specified
// (per-site theme, or Follow System turned off), as a toggleable setting.
'use strict';
(function () {
  if (typeof window === 'undefined' || !window.BRCore) return;
  if (window.__brInstalled) return;
  window.__brInstalled = true;
  try { if (window.top !== window.self) return; } catch (e) { return; }

  var C = window.BRCore;
  var K = {
    settings: 'br.settings.v1', perSite: 'br.perSite.v1', autoSites: 'br.autoSites.v1',
    progress: 'br.progress.v1', highlights: 'br.highlights.v1', library: 'br.library.v1',
    history: 'br.history.v1'
  };

  // ---------- storage: browser.storage -> chrome.storage -> localStorage ----------
  function storageGet(key, fallback) {
    return new Promise(function (resolve) {
      try {
        if (window.browser && browser.storage && browser.storage.local) {
          browser.storage.local.get(key).then(function (o) { resolve(o && o[key] !== undefined ? o[key] : fallback); }, function () { lsGet(); });
          return;
        }
        if (window.chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(key, function (o) { resolve(o && o[key] !== undefined ? o[key] : fallback); });
          return;
        }
      } catch (e) {}
      lsGet();
      function lsGet() {
        try { var v = localStorage.getItem('br:' + key); resolve(v ? JSON.parse(v) : fallback); }
        catch (e) { resolve(fallback); }
      }
    });
  }
  function storageSet(key, value) {
    return new Promise(function (resolve) {
      var obj = {}; obj[key] = value;
      try {
        if (window.browser && browser.storage && browser.storage.local) {
          browser.storage.local.set(obj).then(function () { resolve(true); }, function () { lsSet(); });
          return;
        }
        if (window.chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(obj, function () { resolve(true); });
          return;
        }
      } catch (e) {}
      lsSet();
      function lsSet() { try { localStorage.setItem('br:' + key, JSON.stringify(value)); } catch (e) {} resolve(true); }
    });
  }

  // ---------- state ----------
  var S = {
    settings: null, perSite: {}, autoSites: [], progress: {}, highlights: {}, library: [], history: [],
    host: C.hostOf(location.href), detected: null, pill: null, pillShrunk: false,
    reader: null, content: null, articleEl: null, bar: null, statusEl: null,
    current: null, headings: [], open: false, dismissed: false, autoOpened: false,
    aaScope: 'global', stitching: false, saveTimer: null, selBar: null
  };

  function perSite() { return S.perSite[S.host] || null; }
  function eff() { return C.effectiveSettings(S.settings, perSite()); }
  function systemDark() {
    try { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }
  function themeId() { return C.resolveThemeId(S.settings, perSite(), systemDark()); }
  function theme() { return C.THEMES[themeId()]; }

  function cleanText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- CSS ----------
  var CSS = [
    '#br-toast{position:fixed;left:50%;bottom:96px;transform:translate(-50%,14px);z-index:2147483646;background:rgba(28,28,30,.93);color:#FFF;font:600 13.5px -apple-system,system-ui,sans-serif;padding:10px 17px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;max-width:86vw;text-align:center}',
    '#br-toast.br-toast-on{opacity:1;transform:translate(-50%,0)}',
    '#br-pill{position:fixed;z-index:2147483646;display:flex;align-items:center;gap:7px;',
    'padding:10px 14px;border-radius:999px;background:rgba(250,250,252,.78);color:#111;',
    '-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);',
    'box-shadow:0 8px 28px rgba(0,0,0,.22),inset 0 0 0 1px rgba(0,0,0,.06);font:600 14px -apple-system,system-ui,sans-serif;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;transition:width .25s,padding .25s,opacity .25s}',
    '#br-pill svg{flex:none}#br-pill .br-pill-x{opacity:.45;font-weight:400;padding:0 0 0 2px;font-size:15px}',
    '#br-pill.br-shrunk{padding:11px;border-radius:50%}#br-pill.br-shrunk .br-pill-label,#br-pill.br-shrunk .br-pill-x{display:none}',
    '@media (prefers-color-scheme: dark){#br-pill{background:rgba(38,38,42,.78);color:#F2F2F7;box-shadow:0 8px 28px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.12)}}',
    '#br-reader{position:fixed;inset:0;width:100%;max-width:100vw;box-sizing:border-box;z-index:2147483647;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
    'background:var(--br-bg);color:var(--br-text);font-family:var(--br-font);display:none}',
    '#br-reader.br-open{display:block}',
    /* Popover (top-layer) mode: the UA stylesheet would size the
       reader to fit-content and centre it with auto margins —
       override both so it stays a full-screen sheet. */
    '#br-reader[popover]{margin:0;height:100%;max-height:100%;border:0;padding:0}',
    '#br-progress{position:fixed;top:0;left:0;height:3px;background:#0A84FF;width:0;z-index:3;border-radius:0 2px 2px 0}',
    '.br-topbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:4px;padding:10px 12px;',
    'background:var(--br-bg);background:color-mix(in srgb,var(--br-bg) 82%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);',
    'border-bottom:1px solid var(--br-faint);font-family:-apple-system,system-ui,sans-serif}',
    '.br-tbtn{appearance:none;border:0;background:transparent;color:var(--br-text);font:600 13px -apple-system,system-ui,sans-serif;',
    'padding:8px 10px;border-radius:10px;cursor:pointer;white-space:nowrap}.br-tbtn:active{background:var(--br-faint)}',
    '.br-tbtn.br-accent{color:#0A84FF}.br-topbar .br-spacer{flex:1}',
    '.br-article{margin:0 auto;padding:28px 22px 90px;width:100%;box-sizing:border-box;max-width:var(--br-width)}',
    '.br-kicker{display:flex;align-items:center;gap:7px;font:700 12px -apple-system,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#0A84FF;margin-bottom:12px}',
    '.br-favicon{width:16px;height:16px;border-radius:4px;flex:none}',
    '.br-title{font-family:var(--br-font-head,var(--br-font));font-size:32px;line-height:1.18;font-weight:var(--br-font-head-weight,800);letter-spacing:-.01em;margin:0 0 12px}',
    '.br-meta{color:var(--br-secondary);font-size:14px;line-height:1.5;margin-bottom:26px;font-family:-apple-system,system-ui,sans-serif}',
    '.br-subtitle{font-family:var(--br-font-head,var(--br-font));font-style:italic;color:var(--br-secondary);font-size:20px;line-height:1.45;margin:0 0 14px;font-weight:500}',
    '.br-hero video{width:100%;height:auto;border-radius:14px;display:block;background:#000;box-shadow:0 14px 38px rgba(0,0,0,.22),0 3px 10px rgba(0,0,0,.14)}',
    '.br-body video{width:100%;height:auto;border-radius:12px;display:block;background:#000;box-shadow:0 12px 32px rgba(0,0,0,.20),0 2px 8px rgba(0,0,0,.12)}',
    '.br-embed{position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;background:#000;box-shadow:0 12px 32px rgba(0,0,0,.20),0 2px 8px rgba(0,0,0,.12)}',
    '.br-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}',
    '#br-reader.br-bar-bottom .br-topbar{top:auto;bottom:0;border-bottom:0;border-top:1px solid var(--br-faint);padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}',
    '#br-reader.br-bar-bottom .br-sheet{top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + 68px);transform-origin:bottom right;transform:scale(.9) translateY(10px)}',
    '#br-reader.br-bar-bottom .br-sheet.br-on{transform:none}',
    '#br-reader.br-bar-bottom .br-resume{bottom:86px}',
    '.br-hero{margin:0 0 28px}.br-hero img{width:100%;height:auto;border-radius:14px;display:block;box-shadow:0 14px 38px rgba(0,0,0,.22),0 3px 10px rgba(0,0,0,.14);cursor:zoom-in}',
    '.br-hero figcaption,.br-figcap{color:var(--br-secondary);font-size:13px;margin-top:8px;text-align:left;font-family:-apple-system,system-ui,sans-serif}',
    '.br-body{font-size:var(--br-size);line-height:var(--br-lh);overflow-wrap:break-word;max-width:100%}',
    '.br-body a{overflow-wrap:anywhere}',
    '.br-body.br-dropcap .br-firstp::first-letter{font-size:3.35em;float:left;line-height:.82;padding:7px 11px 0 0;font-weight:800;color:var(--br-text)}',
    '.br-body p{margin:0 0 1.35em}.br-body h2{font-size:1.42em;line-height:1.25;margin:1.6em 0 .6em;font-weight:750}',
    /* The reader's text ALWAYS wears the theme's colours. These are
       set directly on the text elements (not inherited from the
       container) because a site's own `p { color: ... }` rule beats
       inheritance — NY Post's black body text on the dark theme was
       exactly that: unreadable black-on-dark. */
    '#br-reader .br-body p,#br-reader .br-body li,#br-reader .br-body h1,#br-reader .br-body h2,#br-reader .br-body h3,#br-reader .br-body h4,#br-reader .br-body h5,#br-reader .br-body h6,#br-reader .br-body td,#br-reader .br-body th,#br-reader .br-title{color:var(--br-text)!important}',
    '.br-body h3{font-size:1.2em;line-height:1.3;margin:1.5em 0 .55em;font-weight:700}',
    '.br-body h4,.br-body h5,.br-body h6{font-size:1.05em;margin:1.4em 0 .5em;font-weight:700}',
    '.br-body img{max-width:100%;height:auto;border-radius:12px;display:block;margin:0 auto;box-shadow:0 12px 32px rgba(0,0,0,.20),0 2px 8px rgba(0,0,0,.12);cursor:zoom-in}',
    '#br-viewer{position:fixed;inset:0;z-index:200;background:rgba(8,8,10,.95);display:none;overflow:hidden;touch-action:none;opacity:0;transition:opacity .22s ease}',
    '#br-viewer.br-vis{opacity:1}',
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-family:-apple-system,system-ui,sans-serif}',
    '#br-viewer.br-on{display:block}',
    '#br-viewer .br-vstage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;will-change:transform}',
    '#br-viewer img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;box-shadow:0 24px 70px rgba(0,0,0,.6);border-radius:6px;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}',
    '#br-viewer .br-vclose{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);right:14px;z-index:2;width:38px;height:38px;border-radius:50%;',
    'border:0;background:rgba(255,255,255,.16);color:#fff;font-size:17px;cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}',
    '#br-viewer .br-vcap{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:16px 22px calc(env(safe-area-inset-bottom,0px) + 18px);',
    'color:#F2F2F7;font-size:14.5px;line-height:1.5;text-align:center;background:linear-gradient(transparent,rgba(0,0,0,.55))}',
    '#br-viewer .br-vhint{position:absolute;top:calc(env(safe-area-inset-top,0px) + 18px);left:0;right:0;text-align:center;color:rgba(255,255,255,.55);font-size:12.5px;z-index:1}',
    '.br-body figure{margin:1.6em 0}.br-body blockquote{margin:1.5em 0;padding:.2em 0 .2em 1em;border-left:3px solid #0A84FF;color:var(--br-secondary);font-style:italic}',
    '.br-body pre{background:var(--br-code);padding:14px;border-radius:12px;overflow-x:auto;font:13px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}',
    '.br-body ul,.br-body ol{margin:0 0 1.35em;padding-left:1.4em}.br-body li{margin:.35em 0}',
    '.br-body table{border-collapse:collapse;width:100%;margin:.4em 0 1.4em;font-size:.86em;display:block;overflow-x:auto}',
    '.br-tablecap{color:var(--br-secondary);font-size:.82em;text-align:center;margin:1.4em 0 0;font-family:-apple-system,system-ui,sans-serif;font-weight:600}',
    '.br-body td,.br-body th{border:1px solid var(--br-faint);padding:7px 9px;text-align:left}',
    '.br-body a{color:#0A84FF;text-decoration:none}',
    '.br-body mark.br-hl{background:var(--br-mark);color:inherit;border-radius:3px;padding:0 1px;cursor:pointer}',
    '.br-pagebreak{display:flex;align-items:center;gap:12px;margin:2.6em 0;color:var(--br-secondary);font:600 12px -apple-system,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}',
    '.br-pagebreak:before,.br-pagebreak:after{content:"";flex:1;height:1px;background:var(--br-faint)}',
    '.br-status{text-align:center;color:var(--br-secondary);font:500 13px -apple-system,system-ui,sans-serif;padding:26px 0 6px}',
    '.br-resume{position:sticky;bottom:18px;margin:0 auto;width:max-content;max-width:90%;background:#0A84FF;color:#fff;',
    'font:600 13px -apple-system,system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(10,132,255,.4);text-align:center}',
    '.br-backdrop{position:fixed;inset:0;z-index:5;background:rgba(0,0,0,.28);opacity:0;pointer-events:none;transition:opacity .26s ease}',
    '.br-backdrop.br-on{opacity:1;pointer-events:auto}',
    '.br-sheet{position:fixed;top:calc(env(safe-area-inset-top,0px) + 58px);right:12px;z-index:6;',
    'width:min(352px,calc(100vw - 24px));box-sizing:border-box;background:var(--br-surface);color:var(--br-text);',
    'border-radius:22px;max-height:calc(100vh - 132px);max-height:calc(100dvh - 132px);overflow-y:auto;overflow-x:hidden;padding:18px;',
    'font-family:-apple-system,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.32),inset 0 0 0 1px var(--br-faint);',
    'opacity:0;transform:scale(.9) translateY(-10px);transform-origin:top right;pointer-events:none;',
    'transition:opacity .24s ease,transform .32s cubic-bezier(.32,.72,.24,1)}',
    '.br-sheet.br-on{opacity:1;transform:none;pointer-events:auto}.br-sheet h3{margin:2px 0 14px;font-size:17px}',
    '.br-sheet h4{margin:20px 0 9px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--br-secondary)}',
    '.br-sec-head{display:flex;justify-content:space-between;align-items:center;width:100%;appearance:none;border:0;border-top:1px solid var(--br-faint);background:transparent;color:var(--br-text);font:700 15.5px -apple-system,system-ui,sans-serif;padding:15px 2px 11px;margin-top:12px;cursor:pointer;text-align:left}',
    '.br-sec-chev{color:var(--br-secondary);font-size:15px;font-weight:600;display:inline-block;transition:transform .3s ease}',
    '.br-sec-body{display:grid;grid-template-rows:1fr;padding-bottom:8px}',
    '.br-sec-body.br-anim{transition:grid-template-rows .34s cubic-bezier(.32,.72,.3,1),opacity .26s ease,padding-bottom .34s cubic-bezier(.32,.72,.3,1)}',
    '.br-sec-body.br-collapsed{grid-template-rows:0fr;opacity:0;padding-bottom:0}',
    '.br-sec-inner{overflow:hidden;min-height:0}.br-sec-inner h4:first-child{margin-top:6px}',
    // Entrance: blocks rise + fade in, staggered via inline delays.
    '@keyframes brRise{from{opacity:0;transform:translateY(16px);filter:blur(6px)}to{opacity:1;transform:none;filter:blur(0)}}',
    '.br-rise .br-head>*,.br-rise .br-body>*{animation:brRise .95s cubic-bezier(.19,.7,.22,1) both}',
    '@media (prefers-reduced-motion: reduce){.br-rise .br-head>*,.br-rise .br-body>*{animation:none}}',
    // Late-inserted images expand smoothly, pushing text down.
    '.br-img-new{max-height:0;opacity:0;transform:translateY(14px);overflow:hidden;transition:max-height .9s cubic-bezier(.22,.7,.25,1),opacity .7s ease,transform .9s cubic-bezier(.22,.7,.25,1)}',
    '.br-img-new.br-in{max-height:1400px;opacity:1;transform:none}',
    // Ambient glow: the image's own colours bleed past its borders.
    '.br-hero{position:relative}',
    '.br-glow{position:absolute;left:-4px;right:-4px;top:-2px;bottom:8px;background-size:cover;background-position:center;filter:blur(26px) saturate(1.55);opacity:.5;z-index:0;border-radius:20px;pointer-events:none}',
    '.br-hero img{position:relative;z-index:1}',
    '.br-hero figcaption{position:relative;z-index:1}',
    '@media print{.br-glow{display:none!important}}',
    // Social embeds: a framed card with the platform's own embed inside.
    '.br-social{margin:26px 0;border:1px solid var(--br-faint);border-radius:16px;overflow:hidden}',
    '.br-social-head{display:flex;gap:8px;align-items:center;padding:11px 16px;font:700 12.5px -apple-system,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--br-secondary);border-bottom:1px solid var(--br-faint)}',
    '.br-social-ic{font-size:14px;text-transform:none;letter-spacing:0}',
    '.br-social-frame{width:100%;border:0;display:block;background:transparent}',
    '.br-social-text{padding:16px 16px 6px;font-size:.96em;line-height:1.55;white-space:pre-wrap}',
    '.br-social-author{padding:2px 16px 14px;color:var(--br-secondary);font-size:.86em}',
    '.br-social-link{display:block;padding:12px 16px;border-top:1px solid var(--br-faint);color:#0A84FF;text-decoration:none;font:600 14px -apple-system,system-ui,sans-serif}',
    // PDF export: print ONLY the reader-view clone.
    '#br-print{display:none}',
    '@media print{html,body{overflow:visible!important;height:auto!important}body>*:not(#br-reader){display:none!important}#br-reader{position:static!important;overflow:visible!important;opacity:1!important;height:auto!important}#br-reader>*:not(#br-print){display:none!important}#br-print{display:block!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}#br-print .br-article{margin:0 auto}#br-print img{transform:none!important}#br-print figure{break-inside:avoid}}',
    '.br-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.br-chip{appearance:none;border:1px solid var(--br-faint);background:transparent;color:var(--br-text);',
    'font:600 13px -apple-system,system-ui,sans-serif;padding:8px 13px;border-radius:999px;cursor:pointer}',
    '.br-chip.br-sel{background:#0A84FF;border-color:#0A84FF;color:#fff}',
    '.br-swatch{width:44px;height:44px;border-radius:50%;border:2px solid var(--br-faint);cursor:pointer;padding:0}',
    '.br-swatch.br-sel{border-color:#0A84FF;box-shadow:0 0 0 2px var(--br-surface),0 0 0 4px #0A84FF}',
    '.br-switchrow{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--br-faint);font-size:15px}',
    '.br-switch{position:relative;width:50px;height:30px;flex:none}.br-switch input{opacity:0;width:100%;height:100%;position:absolute;margin:0;cursor:pointer;z-index:1}',
    '.br-switch i{position:absolute;inset:0;background:var(--br-faint);border-radius:999px;transition:.2s}',
    '.br-switch i:after{content:"";position:absolute;left:2px;top:2px;width:26px;height:26px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 2px 6px rgba(0,0,0,.25)}',
    '.br-switch input:checked + i{background:#34C759}.br-switch input:checked + i:after{transform:translateX(20px)}',
    '.br-sheet input[type=range]{width:100%;accent-color:#0A84FF}',
    '.br-tocitem{display:block;width:100%;text-align:left;appearance:none;border:0;background:transparent;color:var(--br-text);',
    'font:500 15px -apple-system,system-ui,sans-serif;padding:11px 4px;border-bottom:1px solid var(--br-faint);cursor:pointer}',
    '.br-mhead{display:flex;align-items:center;gap:9px;padding:2px 0 10px;border-bottom:1px solid var(--br-faint);cursor:pointer}',
    '.br-mhead b{font-size:16.5px}.br-mhead .br-aa-badge{font-weight:700;font-size:15px;color:var(--br-secondary)}',
    '.br-mhead .br-chev{margin-left:auto;color:var(--br-secondary);font-size:15px}',
    '.br-mrow{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;text-align:left;appearance:none;border:0;',
    'border-bottom:1px solid var(--br-faint);background:transparent;color:var(--br-text);cursor:pointer;',
    'font:500 15.5px -apple-system,system-ui,sans-serif;padding:12px 2px}',
    '.br-mrow:active{opacity:.55}.br-mrow .br-ic{width:22px;text-align:center;flex:none;font-size:15px;color:var(--br-secondary)}',
    '.br-mrow .br-ck{margin-left:auto;font-weight:700;font-size:14px;visibility:hidden}',
    '.br-mrow.br-sel .br-ck{visibility:visible}',
    '.br-mdot{width:23px;height:23px;border-radius:50%;border:1px solid var(--br-faint);flex:none;margin-left:1px}',
    '.br-stepper{margin-left:auto;display:flex;align-items:center;gap:2px}',
    '.br-stepper button{appearance:none;border:0;background:var(--br-faint);color:var(--br-text);width:44px;height:34px;cursor:pointer}',
    '.br-stepper button:first-child{border-radius:9px 0 0 9px}.br-stepper button:last-child{border-radius:0 9px 9px 0}',
    '.br-stepper .br-size-val{min-width:44px;text-align:center;font-weight:600;font-size:14px}',
    '.br-libitem{padding:13px 2px;border-bottom:1px solid var(--br-faint);cursor:pointer}',
    '.br-libitem b{font-size:15px;display:block;margin-bottom:3px}.br-libitem span{color:var(--br-secondary);font-size:12.5px}',
    '.br-libdel{float:right;color:#FF3B30;font:600 13px -apple-system,system-ui,sans-serif;background:none;border:0;cursor:pointer;padding:4px}',
    '.br-note{color:var(--br-secondary);font-size:13px;margin-top:4px}',
    '#br-selbar{position:fixed;z-index:2147483647;display:none;gap:6px;background:rgba(30,30,32,.92);padding:6px;border-radius:12px;',
    '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 8px 24px rgba(0,0,0,.35)}',
    '#br-selbar button{appearance:none;border:0;background:transparent;color:#fff;font:600 13px -apple-system,system-ui,sans-serif;padding:7px 11px;cursor:pointer}',
    '#br-selbar button.br-hlbtn{color:#FFD60A}',
    /* v1.9: motion, find, footnotes, listen/scroll, magazine head */
    '#br-reader{transition:background-color .35s ease,color .35s ease}',
    '.br-body mark.br-hl-yellow{background:rgba(255,214,10,.45)}',
    '.br-body mark.br-hl-green{background:rgba(52,199,89,.38)}',
    '.br-body mark.br-hl-blue{background:rgba(10,132,255,.32)}',
    '.br-body mark.br-hl-pink{background:rgba(255,55,95,.32)}',
    '.br-body mark.br-hl.br-flash{animation:brflash 1.1s ease}',
    '@keyframes brflash{0%,60%{box-shadow:0 0 0 3px #0A84FF}100%{box-shadow:none}}',
    '#br-selbar .br-dot{width:22px;height:22px;border-radius:50%;padding:0;border:2px solid rgba(255,255,255,.35)}',
    '#br-selbar .br-dot[data-color="yellow"]{background:#FFD60A}#br-selbar .br-dot[data-color="green"]{background:#34C759}',
    '#br-selbar .br-dot[data-color="blue"]{background:#0A84FF}#br-selbar .br-dot[data-color="pink"]{background:#FF375F}',
    '.br-hlrow{display:flex;gap:10px;align-items:flex-start;padding:11px 2px;border-bottom:1px solid var(--br-faint);cursor:pointer}',
    '.br-hlrow .br-dot{width:14px;height:14px;border-radius:50%;flex:none;margin-top:3px}',
    '.br-hlrow .br-dot-yellow{background:#FFD60A}.br-hlrow .br-dot-green{background:#34C759}.br-hlrow .br-dot-blue{background:#0A84FF}.br-hlrow .br-dot-pink{background:#FF375F}',
    '.br-hlrow p{margin:0;font-size:14px;line-height:1.4}.br-hlrow span{color:var(--br-secondary);font-size:12.5px}',
    '.br-body mark.br-find{background:rgba(255,159,10,.55);color:inherit;border-radius:2px;padding:0}',
    '.br-body mark.br-find.br-find-cur{background:#FF9F0A;box-shadow:0 0 0 2px rgba(255,159,10,.5)}',
    '#br-findbar{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));left:50%;transform:translate(-50%,-8px);z-index:6;display:none;align-items:center;gap:6px;',
    'background:rgba(30,30,32,.94);border-radius:13px;padding:7px 8px;box-shadow:0 10px 30px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);',
    'font-family:-apple-system,system-ui,sans-serif;opacity:0;transition:opacity .22s,transform .22s;max-width:94vw}',
    '#br-findbar.br-on{display:flex;opacity:1;transform:translate(-50%,0)}',
    '#br-findbar input{appearance:none;border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:8px 10px;font:500 15px -apple-system,system-ui,sans-serif;width:150px;outline:none}',
    '#br-findbar .br-fcount{color:rgba(255,255,255,.75);font-size:12.5px;min-width:38px;text-align:center}',
    '#br-findbar button{appearance:none;border:0;background:transparent;color:#fff;font-size:16px;padding:7px 9px;cursor:pointer}',
    '.br-body sup.br-fnref{color:#0A84FF;font-weight:700;cursor:pointer;padding:0 1px}',
    '#br-fnpop{position:fixed;z-index:7;display:none;max-width:min(84vw,340px);background:rgba(30,30,32,.96);color:#F2F2F7;border-radius:14px;',
    'padding:13px 15px;font:400 14px/1.5 -apple-system,system-ui,sans-serif;box-shadow:0 14px 38px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}',
    '#br-fnpop.br-on{display:block;animation:brpop .18s ease}',
    '@keyframes brpop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}',
    '#br-fnpop .br-fnlabel{display:block;font:700 10.5px -apple-system,system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#0A84FF;margin-bottom:5px}',
    '.br-speaking{background:rgba(10,132,255,.13);border-radius:6px;box-shadow:0 0 0 4px rgba(10,132,255,.13)}',
    '#br-flowchip{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:6;display:none;align-items:center;gap:4px;',
    'background:rgba(30,30,32,.94);border-radius:999px;padding:6px 10px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:-apple-system,system-ui,sans-serif}',
    '#br-reader.br-bar-top #br-flowchip{bottom:auto;top:calc(70px + env(safe-area-inset-top,0px))}',
    '#br-flowchip.br-on{display:flex}',
    '#br-flowchip button{appearance:none;border:0;background:transparent;color:#fff;font-size:15px;padding:6px 9px;cursor:pointer}',
    '#br-flowchip span{color:rgba(255,255,255,.8);font-size:12.5px;font-weight:600;padding:0 2px}',
    '.br-gatenote{margin:0 0 22px;padding:13px 16px;border-radius:13px;background:rgba(255,159,10,.14);color:var(--br-text);',
    'font:500 13.5px/1.5 -apple-system,system-ui,sans-serif;border:1px solid rgba(255,159,10,.35)}',
    '.br-gatenote b{color:#FF9F0A}',
    '.br-credit{color:var(--br-secondary);font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-left:7px}',
    '.br-body blockquote.br-pull{border-left:0;padding:.4em 8px;margin:1.7em 0;text-align:center;font-size:1.38em;line-height:1.4;font-weight:700;font-style:normal;color:var(--br-text)}',
    '.br-body blockquote.br-pull::before{content:"“";display:block;font-size:1.7em;line-height:.6;color:#0A84FF;margin-bottom:.18em}',
    '#br-section{flex:1 1 auto;min-width:0;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;',
    'font:600 12.5px -apple-system,system-ui,sans-serif;color:var(--br-secondary);opacity:0;transition:opacity .3s;pointer-events:none}',
    '.br-tbtn.br-saved{background:rgba(10,132,255,.18);box-shadow:inset 0 0 0 1px rgba(10,132,255,.45)}',
    '#br-section.br-on{opacity:1}',
    '.br-skel{padding:6px 0 2px}.br-skel div{height:13px;border-radius:6px;margin:0 0 11px;background:linear-gradient(90deg,var(--br-faint) 25%,var(--br-surface) 50%,var(--br-faint) 75%);background-size:200% 100%;animation:brshim 1.2s infinite}',
    '@keyframes brshim{from{background-position:180% 0}to{background-position:-20% 0}}',
    '.br-ringwrap{position:relative;width:25px;height:25px;flex:none;display:inline-flex;align-items:center;justify-content:center}',
    '.br-ringwrap>svg:first-child{width:13px;height:13px}',
    '.br-ringwrap svg.br-ring{position:absolute;inset:0;width:25px;height:25px;transform:rotate(-90deg)}',
    '.br-ringwrap .br-ring-bg{fill:none;stroke:rgba(128,128,140,.35);stroke-width:2.1}',
    '.br-ringwrap .br-ring-fg{fill:none;stroke:#0A84FF;stroke-width:2.1;stroke-linecap:round}',
    '#br-pill.br-shrunk .br-pill-label{display:none}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('br-style')) return;
    var st = el('style'); st.id = 'br-style'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------- extraction ----------
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, NAV: 1, HEADER: 1, FOOTER: 1, ASIDE: 1, FORM: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, INPUT: 1, SVG: 1, AUDIO: 1, CANVAS: 1 };
  var SKIP_RE = /(^|[-_\s])(ad|ads|advert|sidebar|comment|share|social|related|promo|newsletter|cookie|popup|modal|menu|nav|breadcrumb|pagination|recommend|subscribe|signup|sign-up|toolbar|widget|consent|onetrust|trustarc|sourcepoint|gdpr|ccpa)([-_\s]|$)/i;

  function meta(doc, names) {
    for (var i = 0; i < names.length; i++) {
      var m = doc.querySelector('meta[property="' + names[i] + '"], meta[name="' + names[i] + '"]');
      if (m && m.getAttribute('content')) return m.getAttribute('content');
    }
    return '';
  }

  function shouldSkip(node) {
    if (SKIP_TAGS[node.tagName]) return true;
    if (node.id && node.id.indexOf('br-') === 0) return true;
    var cls = (node.getAttribute && (node.getAttribute('class') || '')) + ' ' + (node.id || '');
    if (SKIP_RE.test(cls)) return true;
    if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return true;
    var style = (node.getAttribute && node.getAttribute('style')) || '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
    var role = node.getAttribute && node.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo' || role === 'complementary' || role === 'dialog' || role === 'alertdialog') return true;
    return false;
  }

  // Text of a node with every skippable subtree (nav, aside, button,
  // form, aria-hidden, display:none…) left out. Plain textContent scoops
  // hidden popovers and widget copy into the article — the Verge topic
  // bars leaked in exactly that way, inside breadcrumb list items.
  function textOfExcludingSkips(node) {
    var out = [];
    (function walk(n) {
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3) out.push(c.nodeValue);
        else if (c.nodeType === 1) {
          if (shouldSkip(c)) continue;
          walk(c);
        }
      }
    })(node);
    return out.join(' ');
  }

  function escapeHtmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeHtmlAttr(s) {
    return escapeHtmlText(s).replace(/"/g, '&quot;');
  }

  // Inline HTML for a block: text preserved, links kept as real <a>
  // elements (absolute hrefs, new tab), everything else flattened to
  // text, skippable subtrees excluded. Only set on blocks that contain
  // at least one link — everything else stays plain text.
  function inlineHtml(node, baseUrl) {
    var out = [], hasLink = false, hasRich = false;
    (function walk(n) {
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3) out.push(escapeHtmlText(c.nodeValue.replace(/\s+/g, ' ')));
        else if (c.nodeType === 1) {
          if (shouldSkip(c)) continue;
          if (c.tagName === 'A') {
            var rawHref = c.getAttribute('href') || '';
            var txt = cleanText(c.textContent);
            var fnHandled = false;
            // Footnote reference: a fragment link (usually inside
            // a <sup>) whose target exists on the page. Render it
            // as a tappable note chip carrying the note's text —
            // the target itself rarely survives extraction, so
            // the link would otherwise be a dead end.
            if (rawHref.charAt(0) === '#' && rawHref.length > 1 && txt) {
              var inSup = false, anc = c.parentNode;
              while (anc && anc !== node) { if (anc.tagName === 'SUP') { inSup = true; break; } anc = anc.parentNode; }
              if (inSup || /^\[?\d+\]?$/.test(txt)) {
                var tgt = null;
                try { tgt = c.ownerDocument.getElementById(rawHref.slice(1)); } catch (e) {}
                if (tgt) {
                  var noteTxt = cleanText(tgt.textContent).replace(/[↩↑]\s*/g, '').trim();
                  if (noteTxt.length >= 10) {
                    out.push('<sup class="br-fnref" data-note="' + escapeHtmlAttr(noteTxt.slice(0, 600)) + '">' + escapeHtmlText(txt) + '</sup>');
                    fnHandled = true;
                    hasRich = true;
                  }
                }
              }
            }
            if (!fnHandled) {
              var href = C.sanitizeUrl(rawHref, baseUrl);
              if (href && txt) {
                hasLink = true;
                out.push('<a href="' + escapeHtmlAttr(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtmlText(txt) + '</a>');
              } else if (txt) out.push(escapeHtmlText(txt));
            }
          } else if (c.tagName === 'BR') out.push(' ');
          else walk(c);
        }
      }
    })(node);
    return { html: out.join('').replace(/\s+/g, ' ').trim(), hasLink: hasLink, hasRich: hasRich };
  }

  // A figure whose own colours bleed past its borders: a blurred,
  // saturated copy of the image sits behind it, slightly larger.
  function glowFigure(src, captionText, brkKey) {
    var fig = el('figure'); fig.className = 'br-hero';
    if (brkKey) fig.setAttribute('data-brk', brkKey);
    var glow = el('div', 'br-glow');
    glow.style.backgroundImage = 'url("' + String(src).replace(/"/g, '%22') + '")';
    fig.appendChild(glow);
    var im = el('img'); im.src = src; im.alt = captionText || ''; im.loading = 'lazy';
    im.setAttribute('data-caption', captionText || '');
    fig.appendChild(im);
    if (captionText) {
      // Caption sentence in the normal voice, the credit
      // ("JACQUELYN MARTIN/AP") smaller and quieter beside it.
      var fc = el('figcaption');
      var split = C.splitCaptionCredit(captionText);
      if (split) {
        fc.appendChild(document.createTextNode(split.text));
        fc.appendChild(el('span', 'br-credit', split.credit));
      } else fc.textContent = captionText;
      fig.appendChild(fc);
    }
    return fig;
  }

  // Social embeds arrive as blockquotes (twitter-tweet, instagram-media,
  // fb-post) or as ready-made embed iframes. Turn them into a social
  // block with the platform's official embed URL when we can build one.
  function socialFromEmbedEl(node, baseUrl) {
    var cls = String(node.className || '');
    var postUrl = '';
    var dh = node.getAttribute && (node.getAttribute('data-href') || node.getAttribute('data-instgrm-permalink'));
    if (dh) postUrl = C.sanitizeUrl(dh, baseUrl);
    if (!postUrl) {
      var as = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
      for (var i = 0; i < as.length; i++) {
        var h = C.sanitizeUrl(as[i].getAttribute('href') || '', baseUrl);
        if (h && C.socialFromUrl(h)) { postUrl = h; break; }
      }
    }
    var soc = postUrl ? C.socialFromUrl(postUrl) : null;
    if (!soc) {
      if (/twitter-tweet/i.test(cls)) soc = { platform: 'x', label: 'X', embedUrl: '', postUrl: '' };
      else if (/instagram-media/i.test(cls)) soc = { platform: 'instagram', label: 'Instagram', embedUrl: '', postUrl: '' };
      else if (/fb-(post|video)/i.test(cls)) soc = { platform: 'facebook', label: 'Facebook', embedUrl: '', postUrl: '' };
      else if (/tiktok-embed/i.test(cls)) soc = { platform: 'tiktok', label: 'TikTok', embedUrl: '', postUrl: '' };
      else return null;
    }
    var p = node.querySelector ? node.querySelector('p') : null;
    var text = p ? cleanText(textOfExcludingSkips(p)) : '';
    var full = cleanText(textOfExcludingSkips(node));
    var author = text ? full.replace(text, '').replace(/^[—\-·\s]+/, '') : '';
    if (!text && full) text = full;
    return {
      type: 'social', platform: soc.platform, label: soc.label,
      embedUrl: soc.embedUrl || '', url: soc.postUrl || postUrl || '',
      text: text.slice(0, 600), author: author.slice(0, 140)
    };
  }

  function candidateStats(node) {
    var ps = node.querySelectorAll('p');
    var textLength = 0, boilerChars = 0;
    for (var i = 0; i < ps.length; i++) {
      var pt = cleanText(ps[i].textContent);
      textLength += pt.length;
      if (C.isLegalBoilerplate(pt)) boilerChars += pt.length;
    }
    var links = node.querySelectorAll('a');
    var linkText = 0;
    for (var j = 0; j < links.length; j++) linkText += cleanText(links[j].textContent).length;
    var total = cleanText(node.textContent).length || 1;
    return {
      textLength: textLength, paragraphCount: ps.length,
      linkDensity: Math.min(1, linkText / total),
      boilerRatio: textLength ? boilerChars / textLength : 0
    };
  }

  // A container whose class names a page feature ("layout--sidebar",
  // "page--with-menu") can wrap the whole article: the skip heuristic
  // then prunes the story along with the feature. Names lie; text
  // mass doesn't. A container holding 700+ chars of low-link-density,
  // non-boilerplate paragraph prose is an article container whatever
  // its class says, and the rescue walk may descend into it.
  function articleLikeContainer(node) {
    if (!node.querySelectorAll || SKIP_TAGS[node.tagName]) return false;
    var st = candidateStats(node);
    return st.textLength >= 700 && st.linkDensity <= 0.5 && st.boilerRatio <= 0.35;
  }

  // Caption furniture: an element whose class says caption/credit
  // and which holds no media of its own. Sites like WSJ put the
  // line under a photo in one of these instead of a <figcaption>.
  function isCaptionLike(node) {
    if (!node || node.nodeType !== 1) return false;
    var tag = node.tagName.toLowerCase();
    if (tag === 'figure' || tag === 'img' || tag === 'picture') return false;
    if (node.querySelector && node.querySelector('img, picture, video, iframe')) return false;
    return /caption|credit/i.test(String(node.className || ''));
  }

  // The caption for a figure: the <figcaption> if there is one,
  // else a caption/credit-classed descendant, else any short text
  // child riding along inside the figure. Before this, only a
  // real <figcaption> was read, so captions marked up any other
  // way vanished from the reader entirely.
  function figureCaptionText(fig, capEl) {
    if (capEl) { var ft = cleanText(capEl.textContent); if (ft) return ft; }
    var all = fig.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (isCaptionLike(all[i])) { var ct = cleanText(all[i].textContent); if (ct) return ct; }
    }
    var kids = fig.children;
    for (var j = 0; j < kids.length; j++) {
      var k = kids[j], kt = k.tagName.toLowerCase();
      if (kt === 'img' || kt === 'picture' || kt === 'source' || kt === 'figcaption') continue;
      if (k.querySelector && k.querySelector('img, picture')) continue;
      var t2 = cleanText(k.textContent);
      if (t2 && t2.length >= 8 && t2.length <= 400) return t2;
    }
    return '';
  }

  function walkBlocks(node, blocks, seen, baseUrl, titleText, rescue) {
    var children = node.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (shouldSkip(child) && !(rescue && articleLikeContainer(child))) continue;
      // A caption element trailing its image under the same
      // wrapper (not a <figcaption>): attach it to the image
      // block it follows instead of emitting it as stray text.
      if (isCaptionLike(child) && blocks.length) {
        var lastB = blocks[blocks.length - 1];
        if (lastB.type === 'image' && !lastB.caption) {
          var capT = cleanText(textOfExcludingSkips(child));
          if (capT && capT.length <= 400 && !C.looksLikeFilename(capT)) { lastB.caption = capT; continue; }
        }
      }
      var tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        var ht = cleanText(textOfExcludingSkips(child));
        if (ht && ht !== titleText) {
          var hb = { type: 'heading', level: parseInt(tag[1], 10), text: ht };
          var hh = inlineHtml(child, baseUrl);
          if (hh.hasLink || hh.hasRich) hb.html = hh.html;
          blocks.push(hb);
        }
      } else if (tag === 'p') {
        var imgs = child.querySelectorAll('img');
        for (var k = 0; k < imgs.length; k++) pushImage(imgs[k], blocks, baseUrl, '');
        var pt = cleanText(textOfExcludingSkips(child));
        if (pt.length >= 2) {
          var pb = { type: 'paragraph', text: pt };
          var ph = inlineHtml(child, baseUrl);
          if (ph.hasLink || ph.hasRich) pb.html = ph.html;
          pushTextBlock(blocks, seen, pb);
        }
      } else if (tag === 'img') {
        pushImage(child, blocks, baseUrl, '');
      } else if (tag === 'figure') {
        var fimg = child.querySelector('img');
        var cap = child.querySelector('figcaption');
        if (fimg) pushImage(fimg, blocks, baseUrl, figureCaptionText(child, cap));
      } else if (tag === 'blockquote') {
        var socb = socialFromEmbedEl(child, baseUrl);
        if (socb) {
          var skey = 'soc:' + (socb.url || socb.embedUrl || socb.text.slice(0, 40));
          if (!seen[skey]) { seen[skey] = 1; blocks.push(socb); }
        } else {
          var bt = cleanText(textOfExcludingSkips(child));
          if (bt) {
            var qb = { type: 'quote', text: bt };
            var qh = inlineHtml(child, baseUrl);
            if (qh.hasLink || qh.hasRich) qb.html = qh.html;
            pushTextBlock(blocks, seen, qb);
          }
        }
      } else if (tag === 'ul' || tag === 'ol') {
        var items = [], itemsHtml = [], anyHtml = false;
        var lis = child.children;
        for (var li = 0; li < lis.length; li++) {
          if (lis[li].tagName === 'LI') {
            var it = cleanText(textOfExcludingSkips(lis[li]));
            if (it && !C.isUiJunk(it)) {
              items.push(it);
              var lh = inlineHtml(lis[li], baseUrl);
              itemsHtml.push((lh.hasLink || lh.hasRich) ? lh.html : '');
              if (lh.hasLink || lh.hasRich) anyHtml = true;
            }
          }
        }
        if (items.length) {
          var lb = { type: 'list', ordered: tag === 'ol', items: items };
          if (anyHtml) lb.itemsHtml = itemsHtml;
          blocks.push(lb);
        }
      } else if (tag === 'video') {
        var vsrc = child.currentSrc || child.getAttribute('src') || '';
        if (!vsrc) { var so = child.querySelector('source'); if (so) vsrc = so.getAttribute('src') || ''; }
        var vabs = vsrc && !/^blob:/i.test(vsrc) ? C.sanitizeUrl(vsrc, baseUrl) : '';
        var vposter = C.sanitizeUrl(child.getAttribute('poster') || '', baseUrl);
        var vkey = 'vid:' + (vabs || vposter);
        if ((vabs || vposter) && !seen[vkey]) { seen[vkey] = 1; blocks.push({ type: 'video', src: vabs, poster: vposter }); }
      } else if (tag === 'iframe') {
        var isrc = C.sanitizeUrl(child.getAttribute('src') || '', baseUrl);
        var isoc = isrc ? C.socialFromUrl(isrc) : null;
        if (isoc && isoc.embedUrl) {
          var ikey = 'soc:' + (isoc.postUrl || isoc.embedUrl);
          if (!seen[ikey]) {
            seen[ikey] = 1;
            blocks.push({ type: 'social', platform: isoc.platform, label: isoc.label, embedUrl: isoc.embedUrl, url: isoc.postUrl || '', text: '', author: '' });
          }
        } else if (isrc && /(youtube\.com\/embed|youtu\.be|player\.vimeo\.com|dailymotion\.com\/embed|player\.twitch\.tv|player\.brightcove\.net)/i.test(isrc) && !seen['emb:' + isrc]) {
          seen['emb:' + isrc] = 1;
          blocks.push({ type: 'embed', src: isrc });
        }
      } else if (tag === 'pre') {
        var code = String(child.textContent || '').replace(/\s+$/, '');
        if (code.trim()) blocks.push({ type: 'code', text: code });
      } else if (tag === 'table') {
        var capEl = child.querySelector('caption');
        if (capEl) { var capt = cleanText(capEl.textContent); if (capt) blocks.push({ type: 'tablecaption', text: capt }); }
        var rows = [];
        var trs = child.querySelectorAll('tr');
        for (var r = 0; r < trs.length; r++) {
          var cells = [];
          var tds = trs[r].querySelectorAll('th, td');
          for (var cc = 0; cc < tds.length; cc++) cells.push(cleanText(tds[cc].textContent));
          if (cells.length) rows.push(cells);
        }
        if (rows.length) blocks.push({ type: 'table', rows: rows });
      } else if (tag === 'hr') {
        blocks.push({ type: 'hr' });
      } else if (/(fb-post|fb-video|instagram-media|twitter-tweet|tiktok-embed)/i.test(String(child.className || '')) || child.getAttribute('data-href')) {
        var socd = socialFromEmbedEl(child, baseUrl);
        if (socd) {
          var dkey = 'soc:' + (socd.url || socd.embedUrl || socd.text.slice(0, 40));
          if (!seen[dkey]) { seen[dkey] = 1; blocks.push(socd); }
        } else {
          walkBlocks(child, blocks, seen, baseUrl, titleText, rescue);
        }
      } else {
        walkBlocks(child, blocks, seen, baseUrl, titleText, rescue);
      }
    }
  }

  function pushTextBlock(blocks, seen, block) {
    var key = block.text.slice(0, 140).toLowerCase();
    if (seen[key]) return;
    seen[key] = 1;
    blocks.push(block);
  }

  // On the live page, an image (or a near ancestor) that CSS hides is a
  // responsive variant the site never shows at this width — skip it.
  function visuallyHidden(node) {
    try {
      if (!node.ownerDocument || node.ownerDocument !== document || !window.getComputedStyle) return false;
      var n = node, depth = 0;
      while (n && n.nodeType === 1 && depth < 5) {
        var cs = window.getComputedStyle(n);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
        n = n.parentElement; depth++;
      }
    } catch (e) {}
    return false;
  }

  function pushImage(img, blocks, baseUrl, caption) {
    var src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
    if (!src || src.indexOf('data:') === 0) return;
    if (/(icon|logo|avatar|sprite|pixel|tracking|spacer|blank\.|1x1)/i.test(src)) return;
    // Declared-tiny or rendered-tiny images are icons/badges, not article
    // photos — one WSJ checkmark badge otherwise renders screen-size.
    var wA = parseInt(img.getAttribute('width') || '0', 10), hA = parseInt(img.getAttribute('height') || '0', 10);
    if (wA && hA && Math.max(wA, hA) <= 64) return;
    if (img.naturalWidth && img.naturalHeight && img.naturalWidth <= 48 && img.naturalHeight <= 48) return;
    var abs = C.sanitizeUrl(src, baseUrl);
    if (!abs) return;
    if (visuallyHidden(img)) return;
    // Dedupe by canonical identity, not exact URL: the same file served
    // with different crop/width/quality params is the same image.
    var id = C.imageIdentity(abs);
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'image' && C.imageIdentity(blocks[i].src) === id) return;
    }
    // Captions come only from a real figcaption — never from alt text,
    // which on many sites is just the file name.
    var cap = cleanText(caption || '');
    if (C.looksLikeFilename(cap)) cap = '';
    blocks.push({ type: 'image', src: abs, caption: cap });
  }

  function parseJsonLd(doc) {
    var out = {};
    try {
      var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var data = null;
        try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
        var queue = Array.isArray(data) ? data.slice() : [data];
        while (queue.length) {
          var item = queue.shift();
          if (!item || typeof item !== 'object') continue;
          if (Array.isArray(item['@graph'])) item['@graph'].forEach(function (g) { queue.push(g); });
          if (!out.description && item.description) out.description = String(item.description);
          if (item.articleBody && String(item.articleBody).length > (out.articleBody || '').length) out.articleBody = String(item.articleBody);
          var isVideo = item['@type'] === 'VideoObject' || item.contentUrl || item.embedUrl;
          if (isVideo && !out.video) out.video = { src: item.contentUrl || '', embed: item.embedUrl || '', poster: (Array.isArray(item.thumbnailUrl) ? item.thumbnailUrl[0] : item.thumbnailUrl) || '' };
          if (item.headline || item.author || item.datePublished) {
            out.title = item.headline || '';
            var a = item.author;
            if (a) {
              if (typeof a === 'string') out.byline = a;
              else if (Array.isArray(a)) out.byline = a.map(function (x) { return typeof x === 'string' ? x : (x.name || ''); }).filter(Boolean).join(', ');
              else if (a.name) out.byline = a.name;
            }
            out.date = item.datePublished || item.dateCreated || '';
            if (out.title) break;
          }
        }
      }
    } catch (e) {}
    return out;
  }

  function formatDate(raw) {
    if (!raw) return '';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function extractArticle(doc, baseUrl, force) {
    var ld = parseJsonLd(doc);
    var title = '';
    var byline = cleanText(ld.byline || meta(doc, ['author', 'article:author']) || '');
    if (!byline) {
      var by = doc.querySelector('[rel="author"], .byline, .author-name, [itemprop="author"], [data-testid="byline"], address');
      if (by) { var bt = cleanText(by.textContent).replace(/^by\s+/i, ''); if (bt && bt.length < 140) byline = bt; }
    }
    var date = formatDate(ld.date || meta(doc, ['article:published_time', 'datePublished', 'date', 'publish_date']));
    if (!date) {
      var tm = doc.querySelector('time[datetime]');
      if (tm) date = formatDate(tm.getAttribute('datetime'));
    }
    var hero = C.sanitizeUrl(meta(doc, ['og:image', 'twitter:image']) || '', baseUrl);
    var favicon = '';
    try {
      var iconLinks = doc.querySelectorAll('link[rel]');
      var bestIcon = null, bestIconSize = -1;
      for (var li = 0; li < iconLinks.length; li++) {
        var rel = (iconLinks[li].getAttribute('rel') || '').toLowerCase();
        if (!/(^|\s)(apple-touch-icon|icon)(\s|$)/.test(rel)) continue;
        var szm = /(\d+)x\d+/.exec(iconLinks[li].getAttribute('sizes') || '');
        var sz = szm ? +szm[1] : (rel.indexOf('apple-touch-icon') >= 0 ? 180 : 0);
        if (sz >= bestIconSize) { bestIconSize = sz; bestIcon = iconLinks[li].getAttribute('href'); }
      }
      if (bestIcon) favicon = C.sanitizeUrl(bestIcon, baseUrl);
      if (!favicon) favicon = new URL(baseUrl).origin + '/favicon.ico';
    } catch (e) { favicon = ''; }

    var nodes = doc.querySelectorAll('article, main, [role="main"], div, section');
    var best = null, bestScore = 0, bestStats = null;
    for (var i = 0; i < nodes.length; i++) {
      if (shouldSkip(nodes[i])) continue;
      // A container that isn't rendered can't be the article the user
      // is reading (consent preference centers sit in the DOM hidden).
      if (visuallyHidden(nodes[i])) continue;
      var st = candidateStats(nodes[i]);
      // Legal/consent text is dense, link-free prose — it must never
      // outscore the article. A candidate dominated by it is a notice.
      if (st.boilerRatio > 0.35) continue;
      var score = C.scoreCandidate(st);
      // The semantic article container, or one holding the headline,
      // wins ties against stray text-heavy widgets.
      if (nodes[i].tagName === 'ARTICLE' || nodes[i].tagName === 'MAIN') score *= 1.3;
      else if (nodes[i].querySelector && nodes[i].querySelector('h1')) score *= 1.2;
      if (score > bestScore) { bestScore = score; best = nodes[i]; bestStats = st; }
    }
    if (!best) best = doc.body;
    if (!best) return null;
    if (!bestStats) bestStats = candidateStats(best);

    // Title: the headline actually printed on the page wins over the
    // SEO/social metadata title, which is often a different sentence
    // the reader never sees on the page (WSJ does this routinely).
    var h1el = best.querySelector('h1') || doc.querySelector('h1');
    var visibleTitle = h1el ? cleanText(textOfExcludingSkips(h1el)) : '';
    if (visibleTitle.length >= 15 && visibleTitle.length <= 220) title = visibleTitle;
    if (!title) title = cleanText(ld.title || meta(doc, ['og:title', 'twitter:title']) || '');
    if (!title) title = cleanText(doc.title || '').split(/\s+[|\-–—]\s+/)[0];

    var blocks = [], seen = {};
    walkBlocks(best, blocks, seen, baseUrl, title);
    // Rescue: if the winner harvested almost nothing but the page
    // plainly holds a story, a layout wrapper named for a page
    // feature (NY Post's "layout--sidebar" wraps the article
    // column) pruned the story subtree wholesale. Re-walk the body
    // allowing descent into skipped containers that are themselves
    // article-like; true sidebars and consent boxes stay pruned.
    var preText = 0;
    blocks.forEach(function (b) { if (b.text) preText += b.text.length; if (b.items) preText += b.items.join(' ').length; });
    if (preText < 400 && doc.body) {
      var bodyStats = candidateStats(doc.body);
      if (bodyStats.textLength >= 900) {
        var rb = [], rs = {};
        walkBlocks(doc.body, rb, rs, baseUrl, title, true);
        var rt = 0;
        rb.forEach(function (b) { if (b.text) rt += b.text.length; if (b.items) rt += b.items.join(' ').length; });
        if (rt > preText) { blocks = rb; seen = rs; }
      }
    }
    // Cleanup: the header (title + byline + date) is rendered separately, so
    // byline fragments and site junk must not repeat inside the body.
    var JUNK_RE = /what to read next|read next|recommended for you|more from|sign up for|newsletter|djreprints|this copy is for your personal|all rights reserved|advertisement|daily email digest|your homepage feed|posts from this topic/i;
    blocks = blocks.filter(function (b) {
      var t = b.type === 'list' ? (b.items || []).join(' ') : (b.text || '');
      if ((b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote') &&
          (JUNK_RE.test(t) || C.isUiJunk(t) || C.isTickerLine(t) || C.isNavLabel(t))) return false;
      if (b.type === 'paragraph' && C.isBareUrl(t)) return false;
      if (b.type === 'list') {
        // Ribbon furniture travels as lists too (markets strips,
        // "Most Popular" rails) and the old filter never looked at
        // list items at all. Filter item by item, keeping any
        // parallel itemsHtml aligned.
        var kept = [], keptHtml = [];
        (b.items || []).forEach(function (it, ii) {
          if (C.isTickerLine(it) || C.isNavLabel(it) || C.isUiJunk(it)) return;
          if (it.length <= 80 && JUNK_RE.test(it)) return;
          kept.push(it);
          if (b.itemsHtml) keptHtml.push(b.itemsHtml[ii] || '');
        });
        if (!kept.length) return false;
        b.items = kept;
        if (b.itemsHtml) b.itemsHtml = keptHtml;
      }
      return true;
    });
    // Notice contamination: a cluster of legal-boilerplate blocks
    // inside an otherwise real article (a privacy notice woven into
    // the page) is dropped. If the whole piece is legal text, it is
    // left alone — the user may be reading the policy itself, and
    // candidate selection already refuses notice containers.
    var legalIdx = [], legalChars = 0, totalChars = 0;
    blocks.forEach(function (b, bi) {
      var t = (b.type === 'paragraph' || b.type === 'quote' || b.type === 'heading') ? (b.text || '') : '';
      if (t) {
        totalChars += t.length;
        if (C.isLegalBoilerplate(t)) { legalIdx.push(bi); legalChars += t.length; }
      }
    });
    if (legalIdx.length >= 2 && totalChars > 0 && legalChars / totalChars < 0.5) {
      var dropL = {};
      legalIdx.forEach(function (bi) { dropL[bi] = 1; });
      blocks = blocks.filter(function (b, bi) { return !dropL[bi]; });
    }
    // Subtitle first: a promoted dek heading must not shield the byline
    // fragments behind it from the strip below.
    var description = ld.description || meta(doc, ['og:description', 'description', 'twitter:description']) || '';
    var subRes = C.pickSubtitle(blocks, { description: description, title: title });
    blocks = subRes.blocks;
    if (byline) {
      var byLow = byline.toLowerCase();
      blocks = blocks.filter(function (b) {
        return !(b.type === 'paragraph' && b.text.length <= 160 && b.text.replace(/^by\s+/i, '').toLowerCase() === byLow);
      });
    }
    blocks = C.stripLeadingByline(blocks, byline);
    // Hero video: og:video / twitter player / JSON-LD VideoObject.
    var heroVideo = null;
    var mv = meta(doc, ['og:video:secure_url', 'og:video']);
    if (mv) heroVideo = { src: C.sanitizeUrl(mv, baseUrl), poster: hero };
    else if (ld.video && (ld.video.src || ld.video.embed)) heroVideo = { src: C.sanitizeUrl(ld.video.src || '', baseUrl), embed: C.sanitizeUrl(ld.video.embed || '', baseUrl), poster: C.sanitizeUrl(ld.video.poster || '', baseUrl) || hero };
    else { var tp = meta(doc, ['twitter:player']); if (tp) heroVideo = { embed: C.sanitizeUrl(tp, baseUrl), poster: hero }; }
    if (heroVideo && heroVideo.src) {
      blocks = blocks.filter(function (b) { return !(b.type === 'video' && b.src === heroVideo.src); });
    }
    var textLength = 0, paras = 0, words = 0;
    blocks.forEach(function (b) {
      var t = '';
      if (b.type === 'paragraph' || b.type === 'quote' || b.type === 'heading') t = b.text;
      if (b.type === 'list') t = (b.items || []).join(' ');
      if (t) { textLength += t.length; words += C.countWords(t); if (b.type === 'paragraph') paras++; }
    });
    var stats = { textLength: textLength, paragraphCount: paras, linkDensity: bestStats.linkDensity };
    // Fallback: gated/JS-shell pages (Business Insider and friends)
    // often ship the whole story only as structured data. If the DOM
    // didn't yield a readable article but the JSON-LD articleBody is
    // a full text, read that instead.
    if (!C.isReadable(stats) && ld.articleBody && ld.articleBody.length >= (force ? 300 : 600)) {
      var fbParas = C.splitArticleBody(ld.articleBody);
      var fbLen = 0, fbWords = 0;
      fbParas.forEach(function (t) { fbLen += t.length; fbWords += C.countWords(t); });
      var fbStats = { textLength: fbLen, paragraphCount: fbParas.length, linkDensity: 0 };
      if (fbParas.length && (force ? fbLen >= 300 : C.isReadable(fbStats))) {
        blocks = fbParas.map(function (t) { return { type: 'paragraph', text: t }; });
        stats = fbStats;
        words = fbWords;
      }
    }
    // Pull quotes: a quote block that repeats a body paragraph is
    // display type, not a quotation.
    var paraTexts = [];
    blocks.forEach(function (b) { if (b.type === 'paragraph') paraTexts.push(b.text); });
    blocks.forEach(function (b) {
      if (b.type === 'quote' && C.quoteDuplicatesText(b.text, paraTexts)) b.pull = true;
    });
    // Gated/truncated pages: the site shows a sign-in wall and the
    // DOM (or the structured data) quietly holds more story than
    // could be read. Flag it so the reader can say so out loud
    // instead of presenting a stub as the whole article.
    var gated = false;
    try {
      var bodyText = doc.body ? String(doc.body.textContent || '') : '';
      var gateHit = /subscribe to (read|continue|view)|sign in to (read|continue)|create (a )?free account to (read|continue)|this (article|story) is for (subscribers|members)|already a subscriber|register (for free )?to (read|continue)|content is available to subscribers/i.test(bodyText.slice(0, 200000));
      if (gateHit && stats.textLength < 2500) gated = true;
      if (ld.articleBody && ld.articleBody.length > stats.textLength + 800 && ld.articleBody.length > stats.textLength * 1.8) gated = true;
    } catch (e) {}
    return {
      title: title || 'Untitled', subtitle: subRes.subtitle || '', byline: byline, date: date,
      site: C.hostOf(baseUrl), url: baseUrl, hero: hero, heroVideo: heroVideo, favicon: favicon,
      blocks: blocks, stats: stats, wordCount: words,
      readable: C.isReadable(stats), gated: gated,
      ldBodyLength: ld.articleBody ? ld.articleBody.length : 0
    };
  }

  function collectLinks(doc, baseUrl) {
    var out = [];
    var as = doc.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var href = C.sanitizeUrl(as[i].getAttribute('href') || '', baseUrl);
      if (!href) continue;
      out.push({ href: href, rel: as[i].getAttribute('rel') || '', text: cleanText(as[i].textContent).slice(0, 40) });
    }
    return out;
  }

  // ---------- pill ----------
  var BOOK_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>';

  function placePill() {
    if (!S.pill) return;
    var pos = (S.settings && S.settings.pillPos) || null;
    var top = pos && typeof pos.top === 'number' ? pos.top : 76;
    top = Math.max(8, Math.min(top, window.innerHeight - 60));
    S.pill.style.top = top + 'px';
    if (pos && pos.side === 'left') { S.pill.style.left = '12px'; S.pill.style.right = 'auto'; }
    else { S.pill.style.right = '12px'; S.pill.style.left = 'auto'; }
  }

  function showPill() {
    if (S.dismissed || S.pill) return;
    injectCSS();
    var pill = el('div'); pill.id = 'br-pill';
    pill.innerHTML = '<span class="br-ringwrap">' + BOOK_SVG +
      '<svg class="br-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="br-ring-bg" cx="12" cy="12" r="10.5"></circle>' +
      '<circle class="br-ring-fg" cx="12" cy="12" r="10.5" stroke-dasharray="0 66"></circle></svg></span>' +
      '<span class="br-pill-label">Reader</span><span class="br-pill-x" title="Dismiss">✕</span>';
    // Resume ring: how much of this article was already read.
    try {
      var rec = S.progress && S.progress[location.href];
      var pfrac = rec ? rec.frac : 0;
      if (pfrac > 0.01 && pfrac < 0.985) {
        var fg = pill.querySelector('.br-ring-fg');
        if (fg) fg.setAttribute('stroke-dasharray', (pfrac * 66).toFixed(1) + ' 66');
        pill.querySelector('.br-pill-label').textContent = 'Resume ' + Math.round(pfrac * 100) + '%';
      }
    } catch (e) {}
    document.body.appendChild(pill);
    S.pill = pill;
    placePill();
    var drag = null, moved = false, longTimer = null, longFired = false;
    pill.addEventListener('pointerdown', function (ev) {
      if (ev.target && ev.target.classList && ev.target.classList.contains('br-pill-x')) return;
      drag = { x: ev.clientX, y: ev.clientY, top: pill.offsetTop, left: pill.offsetLeft };
      moved = false; longFired = false;
      try { pill.setPointerCapture(ev.pointerId); } catch (e) {}
      longTimer = setTimeout(function () { longFired = true; openLibrary(); }, 650);
    });
    pill.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 7) { moved = true; if (longTimer) { clearTimeout(longTimer); longTimer = null; } }
      if (!moved) return;
      pill.style.left = Math.max(4, Math.min(drag.left + dx, window.innerWidth - pill.offsetWidth - 4)) + 'px';
      pill.style.right = 'auto';
      pill.style.top = Math.max(4, Math.min(drag.top + dy, window.innerHeight - 56)) + 'px';
    });
    function endDrag(ev) {
      if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      if (!drag) return;
      var wasDrag = moved, wasLong = longFired;
      drag = null;
      if (wasDrag) {
        var side = (pill.offsetLeft + pill.offsetWidth / 2) < window.innerWidth / 2 ? 'left' : 'right';
        S.settings.pillPos = { side: side, top: pill.offsetTop };
        storageSet(K.settings, S.settings);
        placePill();
      } else if (!wasLong) {
        if (ev.target && ev.target.classList && ev.target.classList.contains('br-pill-x')) { dismissPill(); return; }
        openReader();
      }
    }
    pill.addEventListener('pointerup', endDrag);
    pill.addEventListener('pointercancel', function () { drag = null; if (longTimer) clearTimeout(longTimer); });
    setTimeout(function () {
      if (S.pill && !S.open) { S.pill.classList.add('br-shrunk'); S.pillShrunk = true; }
    }, 4000);
  }

  function dismissPill() {
    S.dismissed = true;
    stopArticleWatch();
    if (S.pill) { S.pill.remove(); S.pill = null; }
  }

  // ---------- reader overlay ----------
  function buildReader() {
    if (S.reader) return;
    injectCSS();
    var r = el('div'); r.id = 'br-reader';
    var bar = el('div'); bar.className = 'br-topbar';
    bar.innerHTML =
      '<button class="br-tbtn" data-act="close" aria-label="Close reader" style="font-size:18px;padding:8px 14px">✕</button>' +
      '<span id="br-section"></span>' +
      '<button class="br-tbtn" data-act="save" aria-label="Save article" style="font-size:17px;padding:8px 12px">🔖</button>' +
      '<button class="br-tbtn" data-act="aa" aria-label="Reader settings" style="font-size:20px;padding:8px 14px;min-width:44px;min-height:40px">⚙</button>';
    var prog = el('div'); prog.id = 'br-progress';
    var art = el('div'); art.className = 'br-article';
    var backdrop = el('div'); backdrop.className = 'br-backdrop';
    var sheet = el('div'); sheet.className = 'br-sheet';
    var chip = el('div'); chip.id = 'br-flowchip';
    var findBar = el('div'); findBar.id = 'br-findbar';
    findBar.innerHTML = '<input type="text" placeholder="Find in article" autocomplete="off"><span class="br-fcount"></span>' +
      '<button data-f="prev" aria-label="Previous match">↑</button><button data-f="next" aria-label="Next match">↓</button><button data-f="close" aria-label="Close find">✕</button>';
    var fnPop = el('div'); fnPop.id = 'br-fnpop';
    r.appendChild(prog); r.appendChild(bar); r.appendChild(art);
    r.appendChild(chip); r.appendChild(findBar); r.appendChild(fnPop);
    S.flowChip = chip; S.findBar = findBar; S.fnPop = fnPop; S.sectionEl = bar.querySelector('#br-section');
    wireFindBar(findBar);
    // The menu MUST live inside the reader: the reader sits at the maximum
    // z-index, so a body-level panel renders underneath it and can never be
    // seen or tapped (the v1.0/v1.1 dead-gear bug).
    r.appendChild(backdrop);
    r.appendChild(sheet);
    document.body.appendChild(r);
    S.reader = r; S.content = art; S.bar = prog; S.sheet = sheet; S.backdrop = backdrop; S.topbar = bar;
    backdrop.addEventListener('click', closeSheet);
    // Direct listener on the gear itself (delegation is the backup).
    var gear = bar.querySelector('[data-act="aa"]');
    if (gear) gear.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (S.sheet && S.sheet.classList.contains('br-on')) closeSheet();
      else openAaSheet();
    });
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'close') closeReader();
      else if (act === 'toc') openTocSheet();
      else if (act === 'aa') openAaSheet();
      else if (act === 'save') toggleSaveCurrent(b);
      else if (act === 'lib') openLibrarySheet();
      else if (act === 'export') exportCurrent();
    });
    r.addEventListener('scroll', function () {
      var max = r.scrollHeight - r.clientHeight;
      var frac = max > 0 ? r.scrollTop / max : 0;
      S.bar.style.width = (frac * 100).toFixed(1) + '%';
      updateSectionIndicator(r);
      hideFootnote();
      if (S.current && !S.current.fromLibraryScrollSave && !S.suppressSave) {
        if (S.saveTimer) clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(function () { saveProgress(frac); }, 450);
      }
    }, { passive: true });
    // Touching or wheeling pauses auto-scroll briefly instead of
    // fighting the reader's own hand.
    ['pointerdown', 'wheel', 'touchstart'].forEach(function (evt) {
      r.addEventListener(evt, function () {
        var F = flowState();
        if (F.scrollOn) F.pauseUntil = performance.now() + 2500;
        // A real gesture ends the open-sync grace period: from
        // here the reader's position is the user's own again.
        S.suppressSave = false;
      }, { passive: true });
    });
    r.addEventListener('mouseup', maybeShowSelBar);
    r.addEventListener('touchend', function () { setTimeout(maybeShowSelBar, 60); });
    art.addEventListener('click', function (ev) {
      var fn = ev.target && ev.target.closest ? ev.target.closest('.br-fnref') : null;
      if (fn) { showFootnote(fn); return; }
      hideFootnote();
      if (ev.target && ev.target.tagName === 'MARK') openHighlightMenu(ev.target);
      else if (ev.target && ev.target.tagName === 'IMG') openViewer(ev.target);
    });
    // Tap-to-view, redundantly (v1.15.1): on device, the click a
    // tap should produce can be swallowed by the scroll
    // container before it ever reaches the article — the tap
    // then does nothing at all. A clean pointer tap (down + up
    // within 600 ms, under 12 px of travel) on an image — or
    // anywhere on its figure, caption included — opens the
    // viewer directly. A drag that scrolls the article never
    // qualifies, and when both paths fire, openViewer is
    // idempotent at open, so the second call changes nothing.
    var tapStart = null;
    art.addEventListener('pointerdown', function (ev) {
      tapStart = { x: ev.clientX, y: ev.clientY, t: Date.now() };
    }, { passive: true });
    art.addEventListener('pointerup', function (ev) {
      if (!tapStart) return;
      var dx = ev.clientX - tapStart.x, dy = ev.clientY - tapStart.y;
      var dt = Date.now() - tapStart.t;
      tapStart = null;
      if (dt > 600 || (dx * dx + dy * dy) > 144) return;
      var img = null;
      if (ev.target && ev.target.tagName === 'IMG') img = ev.target;
      else if (ev.target && ev.target.closest) {
        var fig = ev.target.closest('figure.br-hero');
        if (fig) img = fig.querySelector('img');
      }
      if (img) openViewer(img);
    }, { passive: true });
  }

  function applyAppearance() {
    if (!S.reader) return;
    var e = eff(), t = theme();
    var r = S.reader;
    r.style.setProperty('--br-bg', t.bg);
    r.style.setProperty('--br-surface', t.surface);
    r.style.setProperty('--br-text', t.text);
    r.style.setProperty('--br-secondary', t.secondary);
    r.style.setProperty('--br-faint', t.faint);
    r.style.setProperty('--br-code', t.codeBg);
    r.style.setProperty('--br-mark', t.mark);
    r.style.setProperty('--br-font', fontStackFor(e));
    // 'Website Font' also adopts the page's headline face (and
    // its weight) for the title and standfirst when it differs.
    var headStack = e.font === 'website' ? siteHeadingFontStack() : null;
    if (headStack && headStack !== fontStackFor(e)) {
      r.style.setProperty('--br-font-head', headStack);
      if (S.siteHeadWeight) r.style.setProperty('--br-font-head-weight', String(S.siteHeadWeight));
      else r.style.removeProperty('--br-font-head-weight');
    } else {
      r.style.removeProperty('--br-font-head');
      r.style.removeProperty('--br-font-head-weight');
    }
    r.style.setProperty('--br-size', (e.fontSize || 19) + 'px');
    r.style.setProperty('--br-lh', String(e.lineHeight || 1.65));
    r.style.setProperty('--br-width', (C.WIDTHS[e.width] || 680) + 'px');
    // Belt and braces: also set the type directly on the article body, so a
    // font/size change can never be lost to a CSS-variable quirk.
    if (S.articleBody) {
      S.articleBody.style.fontFamily = fontStackFor(e);
      S.articleBody.style.fontSize = (e.fontSize || 19) + 'px';
      S.articleBody.style.lineHeight = String(e.lineHeight || 1.65);
      S.articleBody.classList.toggle('br-dropcap', !!e.dropCap);
    }
    if (S.content) S.content.style.maxWidth = (C.WIDTHS[e.width] || 680) + 'px';
    // Menu bar position: bottom (default) moves the bar after the article
    // so sticky-bottom pins it to the foot of the screen; top restores it.
    var barBottom = !S.settings || S.settings.barPos !== 'top';
    r.classList.toggle('br-bar-bottom', barBottom);
    r.classList.toggle('br-bar-top', !barBottom);
    if (S.topbar && S.backdrop) {
      if (barBottom) { if (S.topbar.nextElementSibling !== S.backdrop) r.insertBefore(S.topbar, S.backdrop); }
      else if (S.topbar.nextElementSibling !== S.content) r.insertBefore(S.topbar, S.content);
    }
    if (S.sheet) {
      S.sheet.style.setProperty('--br-bg', t.bg);
      S.sheet.style.setProperty('--br-surface', t.surface);
      S.sheet.style.setProperty('--br-text', t.text);
      S.sheet.style.setProperty('--br-secondary', t.secondary);
      S.sheet.style.setProperty('--br-faint', t.faint);
    }
  }

  function renderBlocksInto(container, blocks, headingRegistry, byline) {
    var textOnly = !!eff().textOnly;
    blocks.forEach(function (b) {
      if (textOnly && (b.type === 'image' || b.type === 'video' || b.type === 'embed' || b.type === 'social')) return;
      var n = null;
      if (b.type === 'heading') {
        n = el('h' + Math.min(6, Math.max(2, b.level || 2)), '', b.text);
        if (b.html) n.innerHTML = b.html;
        n.id = 'br-h-' + headingRegistry.length;
        n.setAttribute('data-brk', 'h:' + b.text.slice(0, 60));
        headingRegistry.push({ id: n.id, level: b.level || 2, text: b.text });
      } else if (b.type === 'paragraph') {
        n = el('p', '', b.text);
        if (b.html) n.innerHTML = b.html;
        n.setAttribute('data-brk', 'p:' + b.text.slice(0, 60));
        // The drop cap may only ever start on the first REAL article
        // paragraph — never on a byline fragment or a short stub.
        if (!container.__brFirstP && b.text.length >= 40 && !C.isBylineFragment(b.text, byline)) {
          container.__brFirstP = 1; n.classList.add('br-firstp');
        }
      }
      else if (b.type === 'video') {
        var vfig = el('figure');
        if (b.src) {
          var vd = el('video');
          vd.src = b.src; vd.controls = true; vd.setAttribute('playsinline', ''); vd.preload = 'metadata';
          if (b.poster) vd.poster = b.poster;
          vfig.appendChild(vd);
        } else if (b.poster) {
          var pim = el('img'); pim.src = b.poster; pim.alt = ''; pim.setAttribute('data-caption', '');
          vfig.appendChild(pim);
          vfig.appendChild(el('figcaption', 'br-figcap', '▶ Video — watch on the original page'));
        }
        n = vfig;
      }
      else if (b.type === 'embed') {
        var ew = el('div', 'br-embed');
        var ifr = el('iframe');
        ifr.src = b.src; ifr.setAttribute('allowfullscreen', '');
        ifr.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
        ifr.loading = 'lazy';
        ew.appendChild(ifr);
        n = ew;
      }
      else if (b.type === 'quote') {
        n = el('blockquote', b.pull ? 'br-pull' : '', b.text);
        if (b.html) n.innerHTML = b.html;
      }
      else if (b.type === 'image') {
        n = glowFigure(b.src, b.caption, 'i:' + C.imageIdentity(b.src));
      }
      else if (b.type === 'social') {
        var sw = el('div', 'br-social');
        var sh = el('div', 'br-social-head');
        sh.appendChild(el('span', 'br-social-ic', b.platform === 'x' ? '𝕏' : b.platform === 'instagram' ? '◎' : b.platform === 'facebook' ? 'f' : b.platform === 'tiktok' ? '♪' : '◉'));
        sh.appendChild(el('span', '', b.label || 'Post'));
        sw.appendChild(sh);
        if (b.embedUrl) {
          var sif = el('iframe');
          sif.src = b.embedUrl; sif.loading = 'lazy';
          sif.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
          sif.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
          sif.className = 'br-social-frame';
          sif.style.height = (b.platform === 'tiktok' ? 580 : b.platform === 'x' ? 560 : b.platform === 'facebook' ? 520 : 500) + 'px';
          sw.appendChild(sif);
        } else {
          if (b.text) sw.appendChild(el('p', 'br-social-text', b.text));
          if (b.author) sw.appendChild(el('p', 'br-social-author', b.author));
        }
        if (b.url) {
          var sa = el('a', 'br-social-link', 'View on ' + (b.label || 'site') + ' ↗');
          sa.href = b.url; sa.target = '_blank'; sa.rel = 'noopener noreferrer';
          sw.appendChild(sa);
        }
        n = sw;
      } else if (b.type === 'list') {
        n = el(b.ordered ? 'ol' : 'ul');
        (b.items || []).forEach(function (it, idx) {
          var li = el('li', '', it);
          var ih = b.itemsHtml && b.itemsHtml[idx];
          if (ih) li.innerHTML = ih;
          n.appendChild(li);
        });
      } else if (b.type === 'code') { n = el('pre', '', b.text); }
      else if (b.type === 'tablecaption') { n = el('div', 'br-tablecap', b.text); }
      else if (b.type === 'table') {
        n = el('table');
        (b.rows || []).forEach(function (row, ri) {
          var tr = el('tr');
          row.forEach(function (cell) { tr.appendChild(el(ri === 0 ? 'th' : 'td', '', cell)); });
          n.appendChild(tr);
        });
      } else if (b.type === 'pagebreak') {
        n = el('div', 'br-pagebreak', 'Page ' + (b.page || ''));
      } else if (b.type === 'hr') { n = el('hr'); }
      if (n) container.appendChild(n);
    });
  }

  // Re-render after a view-mode change (text-only) without
  // losing the reader's place.
  function rerenderKeepScroll() {
    if (!S.reader || !S.current) return;
    var r = S.reader;
    var max = r.scrollHeight - r.clientHeight;
    var frac = max > 0 ? r.scrollTop / max : 0;
    renderCurrent();
    restoreHighlights();
    var max2 = r.scrollHeight - r.clientHeight;
    r.scrollTop = frac * Math.max(0, max2);
  }

  function renderCurrent() {
    var a = S.current;
    S.content.innerHTML = '';
    S.headings = [];
    var head = el('div'); head.className = 'br-head';
    var kick = el('div', 'br-kicker');
    if (a.favicon) {
      var fav = el('img', 'br-favicon'); fav.src = a.favicon; fav.alt = '';
      fav.addEventListener('error', function () { fav.style.display = 'none'; });
      kick.appendChild(fav);
    }
    kick.appendChild(document.createTextNode(a.site || S.host));
    var h1 = el('h1', 'br-title', a.title);
    var subEl = a.subtitle ? el('p', 'br-subtitle', a.subtitle) : null;
    var metaBits = [];
    if (a.byline) metaBits.push(a.byline);
    if (a.date) metaBits.push(a.date);
    if (a.wordCount) metaBits.push(C.readingTimeMinutes(a.wordCount) + ' min read');
    var textOnly = !!eff().textOnly;
    var heroInBody = a.hero && a.blocks.some(function (b) { return b.type === 'image' && C.imageIdentity(b.src) === C.imageIdentity(a.hero); });
    // The header is always the classic stack — site kicker,
    // title, subtitle, meta — as it was before v1.9.0. The
    // magazine header (hero full-bleed, title overlaid) was
    // REMOVED in v1.9.9 at Kurt's direction: its parallax
    // fade set the overlaid title's opacity from the reader's
    // scroll position, and with scroll sync the reader often
    // opens already scrolled — so the title rendered
    // invisible on about half his articles.
    head.appendChild(kick);
    head.appendChild(h1);
    if (subEl) head.appendChild(subEl);
    if (metaBits.length) head.appendChild(el('div', 'br-meta', metaBits.join('  ·  ')));
    if (textOnly) {
      // Text-only mode: no hero, no hero video.
    } else if (a.heroVideo && (a.heroVideo.src || a.heroVideo.embed)) {
      var vfig2 = el('figure'); vfig2.className = 'br-hero';
      if (a.heroVideo.src) {
        var hv = el('video');
        hv.src = a.heroVideo.src; hv.controls = true; hv.setAttribute('playsinline', ''); hv.preload = 'metadata';
        if (a.heroVideo.poster) hv.poster = a.heroVideo.poster;
        vfig2.appendChild(hv);
      } else {
        var ew2 = el('div', 'br-embed');
        var hifr = el('iframe');
        hifr.src = a.heroVideo.embed; hifr.setAttribute('allowfullscreen', '');
        hifr.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
        hifr.loading = 'lazy';
        ew2.appendChild(hifr); vfig2.appendChild(ew2);
      }
      head.appendChild(vfig2);
    } else if (a.hero) {
      // Hero already in the body renders in place; otherwise
      // it sits under the meta row, as it always has.
      if (!heroInBody) {
        head.appendChild(glowFigure(a.hero, '', 'i:' + C.imageIdentity(a.hero)));
      }
    }
    S.content.appendChild(head);
    if (a.gated && !a.fromLibrary) {
      var gn = el('div', 'br-gatenote');
      gn.innerHTML = '<b>Possibly truncated.</b> This page looks gated by the site — some of the article may be missing. The full text may need a sign-in on the original page.';
      S.content.appendChild(gn);
    }
    var body = el('div'); body.className = 'br-body';
    // The hero renders exactly once: in the head when it isn't part of
    // the body blocks, otherwise in place in the body. (Filtering it
    // out of the body as well made the top image vanish entirely.)
    renderBlocksInto(body, a.blocks, S.headings, a.byline);
    S.content.appendChild(body);
    S.articleBody = body;
    var status = el('div', 'br-status', a.sanctuary ? '— Sanctuary copy · page stopped —' : (a.fromLibrary ? '— Saved copy —' : ''));
    S.content.appendChild(status);
    S.statusEl = status;
    updateSaveButton();
    applyAppearance();
    // Entrance: content rises in, staggered, like text streaming in.
    var kids = S.content.querySelectorAll('.br-head > *, .br-body > *');
    S.content.classList.add('br-rise');
    for (var ri = 0; ri < kids.length && ri < 14; ri++) kids[ri].style.animationDelay = (ri * 28) + 'ms';
    setTimeout(function () { if (S.content) S.content.classList.remove('br-rise'); }, 1300);
  }

  function showToast(text) {
    try {
      injectCSS();
      var t = document.getElementById('br-toast');
      if (!t) { t = el('div'); t.id = 'br-toast'; document.body.appendChild(t); }
      t.textContent = text;
      t.classList.add('br-toast-on');
      setTimeout(function () { t.classList.remove('br-toast-on'); }, 2600);
    } catch (e) {}
  }

  // The popup's "Use Reader Mode on this page": open with whatever
  // the page offers, even when automatic detection said no.
  function forceOpenReader() {
    var art = null;
    try { art = extractArticle(document, location.href, true); } catch (e) { art = null; }
    var hasText = art && art.blocks && art.blocks.some(function (b) { return (b.text || '').length > 0; });
    if (!art || !hasText) { showToast('No readable text found on this page'); return; }
    S.detected = art;
    S.dismissed = false;
    openReader();
  }

  function openReader() {
    if (!S.detected) S.detected = extractArticle(document, location.href);
    if (!S.detected) return;
    // Two-way scroll sync: the reader opens where the page was
    // scrolled to (by fraction — the two documents differ in
    // height), and closing hands the position back to the page.
    var pageFrac = pageScrollFraction();
    S.current = S.detected;
    S.current.fromLibrary = false;
    buildReader();
    renderCurrent();
    showReaderShell();
    if (pageFrac > 0.005) syncReaderToFraction(pageFrac);
    if (eff().autoScroll) scrollStart();
    restoreProgressAndHighlights();
    startLateImageWatch();
    tryStitch();
    // Kill on open (v1.14.0): on a page already proven hostile,
    // the reader going up is the end of the fight — the page is
    // killed immediately instead of being left alive underneath
    // to blank, reload and re-wall around the reader (Kurt's
    // gamesradar video: article flashes, then white, because
    // v1.13.0's kill waited for two lost restore fights and a
    // reload reset the counter before they could accumulate).
    if (pageHostile()) killPage();
  }

  function openSavedArticle(item) {
    buildReader();
    // Swap in the offline image copies where they were cached.
    var cache = item.imgCache || {};
    var cachedSrc = function (src) {
      if (!src) return src;
      return cache[C.imageIdentity(src)] || src;
    };
    var blocksCopy = (item.blocks || []).map(function (b) {
      if (b.type === 'image' && cache[C.imageIdentity(b.src)]) {
        var nb = {}; for (var k in b) nb[k] = b[k];
        nb.src = cache[C.imageIdentity(b.src)];
        return nb;
      }
      return b;
    });
    S.current = {
      title: item.title, subtitle: item.subtitle || '', byline: item.byline || '', date: item.date || '',
      site: item.site || C.hostOf(item.url), url: item.url, hero: cachedSrc(item.hero || ''),
      heroVideo: item.heroVideo || null, favicon: item.favicon || '',
      blocks: blocksCopy, wordCount: item.wordCount || 0, fromLibrary: true
    };
    closeSheet();
    renderCurrent();
    showReaderShell();
    if (eff().autoScroll) scrollStart();
    restoreProgressAndHighlights();
  }

  // ---------- late-loading images ----------
  // The reader grabs the text instantly. Some sites swap real image
  // URLs in a beat later — those images were missed at extraction.
  // For ~20s after opening, re-scan the page; any image that would
  // have been included is inserted at its correct position with a
  // smooth expand/fade so the text below glides down.
  function blockKey(b) {
    if (b.type === 'image') return 'i:' + C.imageIdentity(b.src);
    if (b.type === 'paragraph') return 'p:' + b.text.slice(0, 60);
    if (b.type === 'heading') return 'h:' + b.text.slice(0, 60);
    return '';
  }
  function insertLateImages(newBlocks) {
    if (!S.articleBody || !S.current) return;
    var rendered = {};
    var kids = S.articleBody.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i].getAttribute && kids[i].getAttribute('data-brk');
      if (k) rendered[k] = kids[i];
    }
    // Identities of every image already visible anywhere in the reader
    // (head hero included) — never insert a second copy.
    var shownIds = {};
    if (S.content) {
      var cImgs = S.content.querySelectorAll('img');
      for (var ci = 0; ci < cImgs.length; ci++) {
        var cs = cImgs[ci].getAttribute('src');
        if (cs) shownIds[C.imageIdentity(cs)] = 1;
      }
    }
    newBlocks.forEach(function (b, idx) {
      if (b.type !== 'image') return;
      var key = blockKey(b);
      if (!key || rendered[key]) return;
      if (shownIds[C.imageIdentity(b.src)]) { rendered[key] = true; return; }
      var anchor = null;
      for (var j = idx + 1; j < newBlocks.length; j++) {
        var ak = blockKey(newBlocks[j]);
        if (ak && rendered[ak]) { anchor = rendered[ak]; break; }
      }
      var fig = glowFigure(b.src, b.caption, key);
      fig.classList.add('br-img-new');
      if (anchor) S.articleBody.insertBefore(fig, anchor); else S.articleBody.appendChild(fig);
      rendered[key] = fig;
      S.current.blocks.push(b);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fig.classList.add('br-in'); });
      });
      setTimeout(function () { fig.classList.remove('br-img-new'); fig.classList.remove('br-in'); }, 1400);
    });
  }
  function startLateImageWatch() {
    stopLateImageWatch();
    var tries = 0;
    S.lateTimer = setInterval(function () {
      tries++;
      if (!S.open || !S.current || S.current.fromLibrary) { stopLateImageWatch(); return; }
      try {
        var fresh = extractArticle(document, location.href);
        if (fresh && fresh.blocks) insertLateImages(fresh.blocks);
      } catch (e) {}
      if (tries >= 14) stopLateImageWatch();
    }, 1500);
  }
  function stopLateImageWatch() {
    if (S.lateTimer) { clearInterval(S.lateTimer); S.lateTimer = null; }
  }

  // Reading history for the popup's History tab: every article
  // opened is recorded; closing updates how far you got.
  function recordHistory() {
    if (!S.current || !S.current.url) return;
    var url = S.current.url, existing = null;
    S.history = S.history.filter(function (h) {
      if (h.url === url) { existing = h; return false; }
      return true;
    });
    var prog = S.progress[url];
    S.history.unshift({
      url: url, title: S.current.title || url, site: S.current.site || S.host,
      ts: Date.now(),
      progress: existing ? existing.progress : (prog ? prog.frac : 0),
      done: existing ? existing.done : (prog ? prog.frac >= 0.95 : false)
    });
    S.history = S.history.slice(0, 100);
    storageSet(K.history, S.history);
  }
  function updateHistoryProgress(frac) {
    if (!S.current || !S.current.url) return;
    for (var i = 0; i < S.history.length; i++) {
      if (S.history[i].url === S.current.url) {
        S.history[i].progress = Math.round(frac * 1000) / 1000;
        S.history[i].done = frac >= 0.95;
        S.history[i].ts = Date.now();
        storageSet(K.history, S.history);
        return;
      }
    }
  }

  function sanitizeFontStack(ff) {
    ff = String(ff || '').replace(/[;{}<>]/g, '').trim().slice(0, 300);
    return ff && /[a-zA-Z]/.test(ff) ? ff : null;
  }

  // The 'Website Font' choice: adopt the font the page itself uses
  // for its article text (computed from an article paragraph, else
  // the body), resolved once per page.
  function siteFontStack() {
    if (S.siteFont !== undefined) return S.siteFont;
    S.siteFont = null;
    try {
      if (!window.getComputedStyle) return null;
      var el = document.querySelector('article p, main p, [role="main"] p') || document.querySelector('p') || document.body;
      if (el) S.siteFont = sanitizeFontStack(window.getComputedStyle(el).fontFamily);
    } catch (e) {}
    // A capture attempted while the page is still parsing may
    // have found nothing worth keeping; don't let it stick.
    if (!S.siteFont && document.readyState === 'loading') S.siteFont = undefined;
    return S.siteFont;
  }

  // The headline's own font, for 'Website Font' mode: many sites
  // set a display face on the headline and a different text face
  // on the paragraphs (a serif headline over a sans body, say).
  // Captured from the article's h1 under the same rules, along
  // with its weight — display faces often ship a single weight,
  // and the reader's heavy title weight would be synthesized
  // from it badly. The stack drives the reader's title and
  // standfirst, the elements that mirror the page's own header;
  // in-article headings keep the body stack.
  function siteHeadingFontStack() {
    if (S.siteHeadFont !== undefined) return S.siteHeadFont;
    S.siteHeadFont = null;
    S.siteHeadWeight = null;
    try {
      if (!window.getComputedStyle) return null;
      var el = document.querySelector('article h1, main h1, [role="main"] h1') || document.querySelector('h1');
      if (el && S.reader && S.reader.contains(el)) el = null; // never the reader's own title
      if (el) {
        var cs = window.getComputedStyle(el);
        S.siteHeadFont = sanitizeFontStack(cs.fontFamily);
        var wgt = parseInt(cs.fontWeight, 10);
        if (!isNaN(wgt) && wgt >= 100 && wgt <= 900) S.siteHeadWeight = wgt;
      }
    } catch (e) {}
    if (!S.siteHeadFont && document.readyState === 'loading') { S.siteHeadFont = undefined; S.siteHeadWeight = undefined; }
    return S.siteHeadFont;
  }
  function fontStackFor(e) {
    if (e.font === 'website') return siteFontStack() || C.FONTS.newyork.stack;
    return (C.FONTS[e.font] || C.FONTS.newyork).stack;
  }

  // ---------- topmost guardian ----------
  // The reader sits at the maximum z-index, but a site popup
  // injected AFTER it with the same z-index paints on top (ties go
  // to the later element). While the reader is open, watch the
  // body's children: if anything lands after the reader, move the
  // reader back to the end — topmost again — keeping its scroll.
  var topGuard = null;
  function assertTopmost() {
    try {
      var r = S.reader;
      if (!r || !document.body) return;
      // A reader shown in the top layer must NOT be moved:
      // removing a popover-open element from the tree closes
      // its popover, so on ad-heavy pages whose scripts churn
      // the body's children, the guardian itself kept closing
      // the reader it was protecting ("opens, then closes
      // shortly after"). Top-layer stacking does not depend on
      // DOM order anyway — the move is fallback-only.
      try { if (typeof r.showPopover === 'function' && r.matches(':popover-open')) return; } catch (e) {}
      if (document.body.lastElementChild !== r) {
        var st = r.scrollTop;
        document.body.appendChild(r);
        r.scrollTop = st;
      }
    } catch (e) {}
  }
  function startTopGuard() {
    assertTopmost();
    if (topGuard || typeof MutationObserver === 'undefined') return;
    topGuard = new MutationObserver(function () {
      if (!S.open) return;
      assertTopmost();
      scheduleOverlayCheck();
    });
    if (document.body) topGuard.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    startOverlayWatch();
  }
  function stopTopGuard() {
    if (topGuard) { topGuard.disconnect(); topGuard = null; }
    stopOverlayWatch();
  }

  // The method the stubborn popups themselves use: the browser's
  // TOP LAYER. An element shown as a manual popover paints above
  // every stacking context in the page — no z-index or DOM-order
  // trick can overtake it. The reader enters the top layer while
  // open and leaves it when closed (and during PDF printing,
  // whose stylesheet needs the reader back in normal flow).
  function enterTopLayer() {
    var r = S.reader;
    if (!r) return;
    try {
      if (typeof r.showPopover !== 'function') return;
      if (!r.hasAttribute('popover')) r.setAttribute('popover', 'manual');
      if (!r.matches(':popover-open')) r.showPopover();
    } catch (e) {}
  }
  function exitTopLayer() {
    var r = S.reader;
    if (!r) return;
    try {
      if (typeof r.hidePopover === 'function' && r.matches(':popover-open')) r.hidePopover();
    } catch (e) {}
  }

  // ---------- overlay watchdog ----------
  // Detection, not just prevention: while the reader is open,
  // sample what is actually painted at several points across the
  // screen. If a foreign element sits on top at any point, the
  // reader redraws itself above it immediately — re-appended to
  // win DOM order, and re-entered into the top layer (a fresh
  // showPopover stacks above top-layer entries that came later
  // than our first entry). Triggered by DOM insertions and
  // class/style reveals via the guardian observer, plus a slow
  // interval for animation-only reveals.
  var WATCH_POINTS = [[0.5, 0.06], [0.08, 0.12], [0.92, 0.12], [0.5, 0.28], [0.5, 0.5], [0.5, 0.72], [0.08, 0.9], [0.92, 0.9], [0.5, 0.95]];
  var watchInterval = 0, watchPending = false;
  function coveringElement() {
    try {
      if (!document.elementFromPoint || !S.reader) return null;
      var w = window.innerWidth || 0, h = window.innerHeight || 0;
      if (!w || !h) return null;
      for (var i = 0; i < WATCH_POINTS.length; i++) {
        var hit = document.elementFromPoint(Math.round(w * WATCH_POINTS[i][0]), Math.round(h * WATCH_POINTS[i][1]));
        if (!hit || hit === document.documentElement || hit === document.body) continue;
        if (hit === S.reader || S.reader.contains(hit)) continue;
        if (hit.id === 'br-toast' || hit.id === 'br-pill') continue;
        return hit;
      }
    } catch (e) {}
    return null;
  }
  function reenterTopLayer() {
    var r = S.reader;
    if (!r) return;
    try {
      if (typeof r.showPopover !== 'function') return;
      if (!r.hasAttribute('popover')) { enterTopLayer(); return; }
      if (r.matches(':popover-open')) { r.hidePopover(); r.showPopover(); }
      else r.showPopover();
    } catch (e) {}
  }
  // ---------- overlay sweep ----------
  // Out-stacking a stubborn wall starts a re-show war — the
  // site re-asserts, we re-assert, the reader flickers. While
  // the reader is open, a foreign overlay that paints over it
  // is instead hidden until the reader closes, then restored
  // exactly as it was. Conservative shape rules (dialog /
  // popover / iframe, or fixed/absolute covering most of the
  // viewport) keep ordinary page furniture safe.
  // The body-level root to hide for a covering hit, or null.
  // The whole ancestor chain is examined: the Mac Observer
  // wall nests its fixed full-screen layer inside a static,
  // collapsed wrapper, so checking only the root's own
  // position and size (v1.9.6) missed it entirely.
  function overlayRootFor(hit) {
    var chain = [];
    var n = hit;
    while (n && n !== document.body && n !== document.documentElement) {
      chain.push(n);
      if (!n.parentNode || n.parentNode === document.body || n.parentNode === document.documentElement) break;
      n = n.parentNode;
    }
    var root = chain[chain.length - 1];
    if (!root || root === document.body) return null;
    if (root === S.reader || (S.reader && S.reader.contains(root))) return null;
    if (root.id && root.id.indexOf('br-') === 0) return null;
    if (root.hasAttribute && root.hasAttribute('data-br-swept')) return null;
    for (var i = 0; i < chain.length; i++) {
      var m = chain[i];
      if (m.tagName === 'DIALOG' || m.tagName === 'IFRAME' || (m.hasAttribute && m.hasAttribute('popover'))) return root;
      var pos = '';
      try { pos = window.getComputedStyle(m).position; } catch (e) {}
      if (pos === 'fixed' || pos === 'absolute') {
        var r = m.getBoundingClientRect ? m.getBoundingClientRect() : null;
        var w = window.innerWidth || 0, h = window.innerHeight || 0;
        if (!r || !w || !h) return root;
        if (r.width >= w * 0.45 && r.height >= h * 0.45) return root;
      }
    }
    return null;
  }
  // Anti-adblock walls announce themselves. While the reader
  // is open, scan the body's top-level subtrees for the
  // signature phrases and put away any that contain an overlay
  // node — even one the point sampling didn't happen to hit.
  var WALL_TEXT_RE = /ad\s?block|html-load|disable your (ad|extension)|whitelist (us|this site)|allow ads/i;
  function subtreeHasOverlayNode(root) {
    try {
      if (root.tagName === 'DIALOG' || root.tagName === 'IFRAME' || root.hasAttribute('popover')) return true;
      if (window.getComputedStyle(root).position === 'fixed' || window.getComputedStyle(root).position === 'absolute') return true;
      if (root.querySelector && root.querySelector('dialog, iframe, [popover]')) return true;
      var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var i = 0; i < Math.min(all.length, 60); i++) {
        var p = window.getComputedStyle(all[i]).position;
        if (p === 'fixed' || p === 'absolute') return true;
      }
    } catch (e) {}
    return false;
  }
  function sweepKnownWalls() {
    if (!document.body) return;
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var root = kids[i];
      if (root === S.reader || (root.id && root.id.indexOf('br-') === 0)) continue;
      if (root.hasAttribute && root.hasAttribute('data-br-swept')) continue;
      // Walls are small subtrees; the article wrapper is not.
      // During the sweep window the size guard relaxes for
      // subtrees whose total text is still wall-plausible —
      // a wall that replaced the article area has few words
      // spread over many ad nodes.
      var size = 0;
      try { size = root.querySelectorAll ? root.querySelectorAll('*').length : 0; } catch (e) {}
      var full = '';
      try { full = root.textContent || ''; } catch (e) {}
      var inWindow = S.sweepUntil && Date.now() < S.sweepUntil;
      if (size > 400 && !(inWindow && full.length <= 20000)) continue;
      var txt = full.slice(0, 4000);
      if (!txt || !WALL_TEXT_RE.test(txt)) continue;
      if (!subtreeHasOverlayNode(root)) continue;
      sweepOverlay(root);
    }
  }
  function sweepOverlay(root) {
    if (!root) return false;
    if (!S.swept) S.swept = [];
    if (S.swept.length >= 30) return false;
    try { if (root.tagName === 'DIALOG' && root.open && root.close) root.close(); } catch (e) {}
    try { if (root.hasAttribute('popover') && root.hidePopover && root.matches(':popover-open')) root.hidePopover(); } catch (e) {}
    S.swept.push({ el: root, display: root.style.display, priority: root.style.getPropertyPriority ? root.style.getPropertyPriority('display') : '', strikes: 0, removed: false, parent: null, next: null });
    root.setAttribute('data-br-swept', '1');
    root.style.setProperty('display', 'none', 'important');
    // A page that throws an overlay at the open reader on an
    // already-hostile page is still fighting — end it (v1.14.0).
    if (S.open && pageHostile()) killPage();
    return true;
  }
  function restoreSwept() {
    if (!S.swept) return;
    S.swept.forEach(function (rec) {
      try {
        if (rec.removed && rec.parent && rec.parent.isConnected) {
          rec.parent.insertBefore(rec.el, rec.next && rec.next.isConnected && rec.next.parentNode === rec.parent ? rec.next : null);
        }
        rec.el.removeAttribute('data-br-swept');
        if (rec.display) rec.el.style.setProperty('display', rec.display, rec.priority || '');
        else rec.el.style.removeProperty('display');
      } catch (e) {}
    });
    S.swept = [];
  }
  // Swept overlays fight back: the wall's script notices the
  // hide and un-hides or re-inserts its layer. While the sweep
  // window is open, re-apply the hide — and if the same root
  // has to be re-hidden twice, take it out of the document
  // entirely (restored, like everything swept, on close).
  function enforceSwept() {
    if (!S.swept) return;
    S.swept.forEach(function (rec) {
      var elx = rec.el;
      try {
        if (rec.removed) {
          // A fresh node with the same id is the wall reborn.
          if (elx.id && !document.getElementById(elx.id)) return;
          if (elx.id) { var reborn = document.getElementById(elx.id); if (reborn && reborn !== elx) sweepOverlay(reborn); }
          return;
        }
        if (!elx.isConnected) return;
        var shown = elx.style.display !== 'none';
        if (!shown) { try { shown = window.getComputedStyle(elx).display !== 'none'; } catch (e) {} }
        if (shown) {
          rec.strikes++;
          if (rec.strikes >= 2) {
            rec.parent = elx.parentNode; rec.next = elx.nextSibling; rec.removed = true;
            elx.remove();
          } else {
            elx.style.setProperty('display', 'none', 'important');
          }
        }
      } catch (e) {}
    });
  }
  // ---------- the ten-second sweep window ----------
  // Kurt's ask (Nov 16): after the reader is enabled, keep
  // sweeping hard for ten seconds — the Mac Observer wall pops
  // up on a delay, after the open-time pass has already run.
  function startSweepWindow() {
    S.sweepUntil = Date.now() + 10000;
    if (S.sweepTimer) return;
    S.sweepTimer = setInterval(sweepTick, 400);
  }
  function stopSweepWindow() {
    if (S.sweepTimer) { clearInterval(S.sweepTimer); S.sweepTimer = 0; }
    S.sweepUntil = 0;
  }
  function sweepTick() {
    if (!S.open) { stopSweepWindow(); return; }
    if (S.sweepUntil && Date.now() > S.sweepUntil) { stopSweepWindow(); return; }
    overlayCheck();
    enforceSwept();
  }

  function overlayCheck() {
    if (!S.open) return;
    var r = S.reader;
    // A wiper that takes the reader itself (Element Blocker
    // v1.8.0's dead-menu lesson, BR form): the root is detached
    // and showPopover on a detached element throws — which the
    // popover branch below used to swallow, so the reader never
    // came back. Re-attach first (recreating the body itself if
    // that's what the page wiped), re-arm the guardian on the
    // new body, then re-enter the top layer.
    if (r && !r.isConnected) {
      try {
        if (!document.body) document.documentElement.appendChild(document.createElement('body'));
        document.body.appendChild(r);
        stopTopGuard();
        startTopGuard();
      } catch (e) {}
      enterTopLayer();
      // The page put hands on the reader itself — that is the
      // fight, whoever started it. Kill the page (v1.14.0).
      killPage();
      return;
    }
    // A reader that fell out of the top layer — moved or
    // removed by the page, or by our own earlier guardian —
    // re-enters at once. That fall is what "the reader opened
    // then closed shortly after" looked like on device.
    if (r) {
      try {
        if (typeof r.showPopover === 'function' && r.hasAttribute('popover') && !r.matches(':popover-open')) { enterTopLayer(); return; }
      } catch (e) {}
    }
    sweepKnownWalls();
    var hit = coveringElement();
    if (!hit) return;
    var root = overlayRootFor(hit);
    if (root) sweepOverlay(root);
    assertTopmost();
    reenterTopLayer();
  }
  function scheduleOverlayCheck() {
    if (watchPending) return;
    watchPending = true;
    setTimeout(function () { watchPending = false; overlayCheck(); }, 180);
  }
  function startOverlayWatch() {
    if (watchInterval) return;
    watchInterval = setInterval(overlayCheck, 1500);
  }
  function stopOverlayWatch() {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = 0; }
  }

  // ---------- find in article ----------
  var findState = { marks: [], idx: -1, query: '' };
  function wireFindBar(bar) {
    var input = bar.querySelector('input');
    var timer = 0;
    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { runFind(input.value); }, 160);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); stepFind(1); }
      else if (ev.key === 'Escape') hideFindBar();
    });
    bar.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-f]') : null;
      if (!b) return;
      var act = b.getAttribute('data-f');
      if (act === 'next') stepFind(1);
      else if (act === 'prev') stepFind(-1);
      else if (act === 'close') hideFindBar();
    });
  }
  function showFindBar() {
    if (!S.findBar) return;
    closeSheet();
    S.findBar.classList.add('br-on');
    var input = S.findBar.querySelector('input');
    if (input) {
      input.value = '';
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
    }
    runFind('');
  }
  function hideFindBar() {
    if (S.findBar) S.findBar.classList.remove('br-on');
    clearFindMarks();
  }
  function clearFindMarks() {
    if (S.articleBody) {
      Array.prototype.slice.call(S.articleBody.querySelectorAll('mark.br-find')).forEach(function (m) {
        var p = m.parentNode;
        if (p) { while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); }
      });
      try { S.articleBody.normalize(); } catch (e) {}
    }
    findState.marks = []; findState.idx = -1;
    if (S.findBar) { var c = S.findBar.querySelector('.br-fcount'); if (c) c.textContent = ''; }
  }
  function runFind(q) {
    clearFindMarks();
    q = String(q || '').trim();
    findState.query = q;
    if (!S.articleBody || q.length < 2) return;
    var ql = q.toLowerCase();
    var walker = document.createTreeWalker(S.articleBody, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.parentNode && (n.parentNode.tagName === 'PRE' || n.parentNode.tagName === 'SCRIPT')) continue;
      if (n.nodeValue.toLowerCase().indexOf(ql) >= 0) nodes.push(n);
    }
    var marks = [];
    nodes.forEach(function (node) {
      var val = node.nodeValue, low = val.toLowerCase(), pos = 0, hit;
      var frag = document.createDocumentFragment();
      var any = false;
      while ((hit = low.indexOf(ql, pos)) >= 0) {
        any = true;
        if (hit > pos) frag.appendChild(document.createTextNode(val.slice(pos, hit)));
        var mk = el('mark', 'br-find', val.slice(hit, hit + q.length));
        frag.appendChild(mk); marks.push(mk);
        pos = hit + q.length;
      }
      if (!any) return;
      if (pos < val.length) frag.appendChild(document.createTextNode(val.slice(pos)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
    findState.marks = marks;
    if (marks.length) { findState.idx = 0; markCurrentFind(); }
    else updateFindCount();
  }
  function updateFindCount() {
    if (!S.findBar) return;
    var c = S.findBar.querySelector('.br-fcount');
    if (!c) return;
    if (!findState.marks.length) { c.textContent = findState.query ? '0/0' : ''; return; }
    c.textContent = (findState.idx + 1) + '/' + findState.marks.length;
  }
  function markCurrentFind() {
    findState.marks.forEach(function (m, i) { m.classList.toggle('br-find-cur', i === findState.idx); });
    var cur = findState.marks[findState.idx];
    if (cur) { try { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
    updateFindCount();
  }
  function stepFind(d) {
    if (!findState.marks.length) return;
    findState.idx = (findState.idx + d + findState.marks.length) % findState.marks.length;
    markCurrentFind();
  }

  // ---------- footnotes ----------
  function showFootnote(refEl) {
    var pop = S.fnPop;
    if (!pop) return;
    var note = refEl.getAttribute('data-note') || '';
    if (!note) return;
    pop.innerHTML = '';
    pop.appendChild(el('span', 'br-fnlabel', 'Note ' + cleanText(refEl.textContent)));
    pop.appendChild(document.createTextNode(note));
    pop.classList.add('br-on');
    var rect = refEl.getBoundingClientRect();
    var w = Math.min(window.innerWidth * 0.84, 340);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(10, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 10)) + 'px';
    pop.style.top = Math.max(64, Math.min(rect.bottom + 10, window.innerHeight - 200)) + 'px';
  }
  function hideFootnote() { if (S.fnPop) S.fnPop.classList.remove('br-on'); }

  // ---------- section indicator + magazine parallax ----------
  function updateSectionIndicator(r) {
    var sec = S.sectionEl;
    if (!sec) return;
    var label = '';
    if (r.scrollTop > 160 && S.headings && S.headings.length) {
      for (var i = 0; i < S.headings.length; i++) {
        var hEl = document.getElementById(S.headings[i].id);
        if (!hEl) continue;
        if (hEl.getBoundingClientRect().top <= 140) label = S.headings[i].text;
        else break;
      }
    }
    if (label !== S._secLabel) {
      S._secLabel = label;
      sec.textContent = label;
      sec.classList.toggle('br-on', !!label);
    }
  }


  // ---------- listen (read-aloud) + auto-scroll ----------
  function flowState() {
    if (!S.flow) S.flow = { ttsOn: false, ttsPaused: false, els: [], idx: 0, runId: 0, scrollOn: false, raf: 0, lastTs: 0, pauseUntil: 0 };
    return S.flow;
  }
  function speakables() {
    if (!S.articleBody) return [];
    var out = [];
    Array.prototype.forEach.call(S.articleBody.querySelectorAll('p, h2, h3, h4, h5, h6, blockquote, li'), function (n) {
      if (n.closest && n.closest('table')) return;
      var t = cleanText(n.textContent);
      if (t && t.length >= 2) out.push({ el: n, text: t });
    });
    return out;
  }
  function ttsStart() {
    var F = flowState();
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { showToast('Read-aloud is not available in this browser'); return; }
    F.els = speakables();
    if (!F.els.length) { showToast('Nothing to read aloud in this article'); return; }
    F.ttsOn = true; F.ttsPaused = false; F.idx = 0;
    speakCurrent();
    updateFlowChip();
  }
  function speakCurrent() {
    var F = flowState();
    if (!F.ttsOn) return;
    if (F.idx >= F.els.length) { ttsStop(); return; }
    var item = F.els[F.idx];
    F.els.forEach(function (x) { x.el.classList.remove('br-speaking'); });
    item.el.classList.add('br-speaking');
    try { item.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    var my = ++F.runId;
    var u = new SpeechSynthesisUtterance(item.text.slice(0, 900));
    u.rate = eff().ttsRate || 1;
    var advance = function () {
      if (F.runId !== my || !F.ttsOn || F.ttsPaused) return;
      F.idx++; speakCurrent();
    };
    u.onend = advance;
    u.onerror = advance;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) { ttsStop(); }
  }
  function ttsPause() {
    var F = flowState();
    if (!F.ttsOn) return;
    F.ttsPaused = true; F.runId++;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    updateFlowChip();
  }
  function ttsResume() {
    var F = flowState();
    if (!F.ttsOn) return;
    F.ttsPaused = false;
    speakCurrent();
    updateFlowChip();
  }
  function ttsStop() {
    var F = flowState();
    var was = F.ttsOn;
    F.ttsOn = false; F.ttsPaused = false; F.runId++;
    if (was) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    if (S.articleBody) Array.prototype.forEach.call(S.articleBody.querySelectorAll('.br-speaking'), function (n) { n.classList.remove('br-speaking'); });
    updateFlowChip();
  }
  function scrollStart() {
    var F = flowState();
    if (F.scrollOn || !S.reader) return;
    F.scrollOn = true; F.scrollPaused = false; F.acc = 0; F.lastTs = 0;
    var stepFn = function (ts) {
      if (!F.scrollOn) return;
      if (F.lastTs && !F.scrollPaused && ts > F.pauseUntil && S.reader) {
        var dt = Math.min(100, ts - F.lastTs);
        // Accumulate fractionally and step in whole pixels:
        // at 40 px/s a frame is ~0.67 px, and engines that
        // quantise scrollTop threw that away every frame —
        // auto-scroll simply never moved (Kurt, v1.9.4).
        F.acc = (F.acc || 0) + (eff().scrollSpeed || 40) * dt / 1000;
        var step = Math.floor(F.acc);
        if (step > 0) {
          F.acc -= step;
          S.reader.scrollTop += step;
          var max = S.reader.scrollHeight - S.reader.clientHeight;
          if (max > 0 && S.reader.scrollTop >= max - 1) { scrollStop(); return; }
        }
      }
      F.lastTs = ts;
      F.raf = requestAnimationFrame(stepFn);
    };
    F.raf = requestAnimationFrame(stepFn);
    updateFlowChip();
  }
  function scrollStop() {
    var F = flowState();
    F.scrollOn = false; F.scrollPaused = false;
    if (F.raf) cancelAnimationFrame(F.raf);
    F.raf = 0;
    updateFlowChip();
  }
  function scrollPauseToggle() {
    var F = flowState();
    if (!F.scrollOn) return;
    F.scrollPaused = !F.scrollPaused;
    updateFlowChip();
  }
  function updateFlowChip() {
    var chip = S.flowChip;
    if (!chip) return;
    var F = flowState();
    chip.innerHTML = '';
    var any = false;
    if (F.ttsOn) {
      any = true;
      chip.appendChild(el('span', '', 'Listening'));
      var pb = el('button', '', F.ttsPaused ? '▶' : '⏸');
      pb.addEventListener('click', function () { if (flowState().ttsPaused) ttsResume(); else ttsPause(); });
      var sb = el('button', '', '✕');
      sb.addEventListener('click', function () { ttsStop(); });
      chip.appendChild(pb); chip.appendChild(sb);
    }
    if (F.scrollOn) {
      any = true;
      chip.appendChild(el('span', '', 'Auto-scroll'));
      var pb2 = el('button', '', F.scrollPaused ? '▶' : '⏸');
      pb2.addEventListener('click', function () { scrollPauseToggle(); });
      var xb = el('button', '', '✕');
      xb.addEventListener('click', function () { writeGlobal({ autoScroll: false }); scrollStop(); });
      chip.appendChild(pb2); chip.appendChild(xb);
    }
    chip.classList.toggle('br-on', any);
  }

  function showReaderShell() {
    // Fade the reader in.
    S.reader.style.transition = 'opacity .6s cubic-bezier(.22,.7,.25,1)';
    S.reader.style.opacity = '0';
    S.reader.classList.add('br-open');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (S.reader) S.reader.style.opacity = '1'; });
    });
    // Always start from the article header — never mid-article.
    S.reader.scrollTop = 0;
    // An overlay that is already up (an anti-adblock wall
    // greeted the page) gets swept promptly, not at the
    // watchdog's next interval — and the sweep window keeps
    // sweeping for ten seconds against delayed popups.
    setTimeout(function () { overlayCheck(); }, 600);
    startSweepWindow();
    if (S.bar) S.bar.style.width = '0%';
    S.open = true;
    document.documentElement.style.overflow = 'hidden';
    if (document.body) document.body.style.overflow = 'hidden';
    if (S.pill) S.pill.style.display = 'none';
    recordHistory();
    startTopGuard();
    enterTopLayer();
  }

  function closeReader() {
    if (!S.reader) return;
    stopTopGuard();
    stopLateImageWatch();
    stopSweepWindow();
    if (S.killWatch) { clearInterval(S.killWatch); S.killWatch = 0; }
    restoreSwept();
    ttsStop();
    scrollStop();
    hideFindBar();
    hideFootnote();
    var max = S.reader.scrollHeight - S.reader.clientHeight;
    var cfrac = (S.current && max > 0) ? S.reader.scrollTop / max : null;
    if (cfrac !== null) { saveProgress(cfrac); updateHistoryProgress(cfrac); }
    // Fade out, then hide.
    var r = S.reader;
    r.style.opacity = '0';
    setTimeout(function () {
      if (!S.open) { r.classList.remove('br-open'); r.style.opacity = ''; exitTopLayer(); }
    }, 520);
    S.open = false;
    closeSheet();
    hideSelBar();
    document.documentElement.style.overflow = '';
    if (document.body) document.body.style.overflow = '';
    // Hand the reading position back to the page underneath —
    // but never for a saved article, whose page is a different one.
    if (cfrac !== null && S.current && !S.current.fromLibrary) scrollPageToFraction(cfrac);
    if (S.pill) S.pill.style.display = '';
    // Auto-opened readers never created a pill — bring it back on
    // close so the reader can be re-enabled without a reload.
    else if (S.detected && !S.dismissed) showPill();
  }

  // ---------- two-way scroll sync with the page ----------
  function pageScrollFraction() {
    try {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return 0;
      return Math.max(0, Math.min(1, (window.scrollY || 0) / max));
    } catch (e) { return 0; }
  }
  function scrollPageToFraction(frac) {
    try {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      window.scrollTo(0, Math.round(Math.max(0, Math.min(1, frac)) * max));
    } catch (e) {}
  }
  function syncReaderToFraction(frac) {
    if (!S.reader) return;
    // The jump is the page's position, not the reader's own
    // reading progress — don't let it overwrite the saved
    // position until the user scrolls for themselves.
    S.suppressSave = true;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!S.reader || !S.open) return;
        var max = S.reader.scrollHeight - S.reader.clientHeight;
        if (max > 0) S.reader.scrollTop = Math.round(frac * max);
      });
    });
  }

  function saveProgress(frac) {
    if (!S.current) return;
    if (frac < 0.02) delete S.progress[S.current.url];
    else S.progress[S.current.url] = { frac: Math.round(frac * 1000) / 1000, ts: Date.now(), title: S.current.title };
    var keys = Object.keys(S.progress);
    if (keys.length > 60) {
      keys.sort(function (a, b) { return (S.progress[a].ts || 0) - (S.progress[b].ts || 0); });
      keys.slice(0, keys.length - 60).forEach(function (k) { delete S.progress[k]; });
    }
    storageSet(K.progress, S.progress);
  }

  function restoreProgressAndHighlights() {
    var a = S.current;
    setTimeout(function () {
      // Start at the header, always. If there's a saved place, offer it as a
      // tappable pill instead of jumping there unasked.
      var rec = S.progress[a.url];
      if (rec && rec.frac > 0.03 && rec.frac < 0.97 && S.reader) {
        var banner = el('button', 'br-resume', 'Resume at ' + Math.round(rec.frac * 100) + '% ↓');
        banner.style.border = '0'; banner.style.cursor = 'pointer';
        banner.addEventListener('click', function () {
          var max = S.reader.scrollHeight - S.reader.clientHeight;
          if (max > 0) S.reader.scrollTo({ top: rec.frac * max, behavior: 'smooth' });
          banner.remove();
        });
        S.content.appendChild(banner);
        setTimeout(function () { if (banner.parentNode) banner.remove(); }, 9000);
      }
      restoreHighlights();
    }, 60);
  }

  // ---------- stitching (A) ----------
  function tryStitch() {
    if (S.stitching || !S.current || S.current.fromLibrary) return;
    S.stitching = true;
    var currentUrl = S.current.url;
    var seenUrls = {}; seenUrls[currentUrl.split('#')[0]] = 1;
    var links = collectLinks(document, currentUrl);
    var pages = 1;
    var seenPara = {};
    S.current.blocks.forEach(function (b) { if (b.type === 'paragraph') seenPara[b.text.slice(0, 140).toLowerCase()] = 1; });
    if (S.statusEl) S.statusEl.textContent = 'Checking for more pages…';
    // Shimmer placeholder where the next page will land.
    var skel = el('div', 'br-skel');
    skel.innerHTML = '<div style="width:92%"></div><div style="width:97%"></div><div style="width:64%"></div>';
    if (S.articleBody) S.articleBody.appendChild(skel);
    function step() {
      var next = C.findNextPageUrl(currentUrl, links);
      if (!next || seenUrls[next.split('#')[0]] || pages >= 5) { finish(); return; }
      seenUrls[next.split('#')[0]] = 1;
      fetch(next, { credentials: 'same-origin' }).then(function (res) { return res.text(); }).then(function (html) {
        var parsed = new DOMParser().parseFromString(html, 'text/html');
        var art = extractArticle(parsed, next);
        if (!art || art.stats.textLength < 400) { finish(); return; }
        var fresh = art.blocks.filter(function (b) {
          if (b.type === 'image') {
            var iid = C.imageIdentity(b.src);
            return !S.current.blocks.some(function (x) { return x.type === 'image' && C.imageIdentity(x.src) === iid; });
          }
          if (b.type !== 'paragraph') return true;
          var key = b.text.slice(0, 140).toLowerCase();
          if (seenPara[key]) return false;
          seenPara[key] = 1; return true;
        });
        if (!fresh.length) { finish(); return; }
        pages++;
        var withBreak = [{ type: 'pagebreak', page: pages }].concat(fresh);
        S.current.blocks = S.current.blocks.concat(withBreak);
        renderBlocksInto(S.articleBody, withBreak, S.headings, S.current ? S.current.byline : '');
        currentUrl = next;
        links = collectLinks(parsed, next);
        if (S.statusEl) S.statusEl.textContent = 'Loading page ' + (pages + 1) + '…';
        step();
      }).catch(function () { finish(true); });
    }
    function finish(failed) {
      S.stitching = false;
      if (skel.parentNode) skel.remove();
      if (!S.statusEl) return;
      if (S.current && S.current.sanctuary) S.statusEl.textContent = '— Sanctuary copy · page stopped —';
      else if (pages > 1) S.statusEl.textContent = '— End · ' + pages + ' pages combined —';
      else if (failed) S.statusEl.textContent = '— End —';
      else S.statusEl.textContent = '— End —';
    }
    step();
  }

  // ---------- image viewer: pinch / double-tap zoom, pan, swipe away ----------
  var V = { el: null, stage: null, img: null, cap: null, scale: 1, tx: 0, ty: 0, pointers: {}, pinchDist: 0, lastTap: 0, dragStart: null };

  function buildViewer() {
    if (V.el) return;
    var v = el('div'); v.id = 'br-viewer';
    var hint = el('div', 'br-vhint', 'Pinch or double-tap to zoom · swipe to close');
    var close = el('button', 'br-vclose', '✕');
    var stage = el('div', 'br-vstage');
    var img = el('img'); img.alt = '';
    var cap = el('div', 'br-vcap');
    stage.appendChild(img);
    v.appendChild(hint); v.appendChild(close); v.appendChild(stage); v.appendChild(cap);
    // Inside the reader overlay, like the menu — never underneath it.
    S.reader.appendChild(v);
    V.el = v; V.stage = stage; V.img = img; V.cap = cap;
    close.addEventListener('click', function () { closeViewer(0, 0); });

    function apply() {
      stage.style.transform = 'translate(' + V.tx + 'px,' + V.ty + 'px) scale(' + V.scale + ')';
    }
    V.apply = apply;
    v.addEventListener('pointerdown', function (ev) {
      V.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(V.pointers);
      if (ids.length === 1) {
        V.dragStart = { x: ev.clientX, y: ev.clientY, tx: V.tx, ty: V.ty };
      } else if (ids.length === 2) {
        var a = V.pointers[ids[0]], b = V.pointers[ids[1]];
        V.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        V.dragStart = null;
      }
      try { v.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    v.addEventListener('pointermove', function (ev) {
      if (!V.pointers[ev.pointerId]) return;
      V.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(V.pointers);
      if (ids.length === 2 && V.pinchDist > 0) {
        var a = V.pointers[ids[0]], b = V.pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        V.scale = C.clampScale(V.scale * (d / V.pinchDist));
        V.pinchDist = d;
        if (V.scale === 1) { V.tx = 0; V.ty = 0; }
        apply();
      } else if (ids.length === 1 && V.dragStart) {
        V.tx = V.dragStart.tx + (ev.clientX - V.dragStart.x);
        V.ty = V.dragStart.ty + (ev.clientY - V.dragStart.y);
        if (V.scale === 1) {
          var dist = C.swipeDistance(V.tx, V.ty);
          v.style.opacity = String(Math.max(0.35, 1 - dist / 420));
        }
        apply();
      }
    });
    function endPointer(ev) {
      var wasDrag = V.dragStart;
      delete V.pointers[ev.pointerId];
      if (Object.keys(V.pointers).length < 2) V.pinchDist = 0;
      if (Object.keys(V.pointers).length === 0) {
        V.dragStart = null;
        if (V.scale === 1 && wasDrag) {
          var dx = ev.clientX - wasDrag.x, dy = ev.clientY - wasDrag.y;
          if (C.shouldDismissSwipe(dx, dy)) { closeViewer(dx, dy); return; }
          V.tx = 0; V.ty = 0; v.style.opacity = '1';
          stage.style.transition = 'transform .22s ease';
          apply();
          setTimeout(function () { stage.style.transition = ''; }, 240);
        }
      }
    }
    v.addEventListener('pointerup', endPointer);
    v.addEventListener('pointercancel', endPointer);
    v.addEventListener('dblclick', function (ev) {
      ev.preventDefault();
      V.scale = V.scale > 1 ? 1 : 2.5;
      if (V.scale === 1) { V.tx = 0; V.ty = 0; }
      stage.style.transition = 'transform .25s ease';
      apply();
      setTimeout(function () { stage.style.transition = ''; }, 270);
    });
    v.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      V.scale = C.clampScale(V.scale * (ev.deltaY < 0 ? 1.12 : 0.89));
      if (V.scale === 1) { V.tx = 0; V.ty = 0; }
      apply();
    }, { passive: false });
  }

  function openViewer(imgEl) {
    buildReader();
    buildViewer();
    V.img.src = imgEl.currentSrc || imgEl.src;
    var cap = imgEl.getAttribute('data-caption') || '';
    if (!cap) {
      var fig = imgEl.closest ? imgEl.closest('figure') : null;
      var fc = fig ? fig.querySelector('figcaption') : null;
      if (fc) cap = cleanText(fc.textContent);
    }
    if (!cap && imgEl.alt && !C.looksLikeFilename(imgEl.alt)) cap = imgEl.alt;
    V.cap.textContent = cap || '';
    V.cap.style.display = cap ? '' : 'none';
    V.scale = 1; V.tx = 0; V.ty = 0; V.pointers = {};
    V.apply();
    // Fade in. Class-based, with a forced style flush at
    // opacity 0 before the visible class flips — depending on
    // requestAnimationFrame left the viewer invisible forever
    // wherever rAF is throttled (v1.9.4's broken image open).
    // The display is also set inline (v1.15.1) so the viewer
    // shows even if the stylesheet's .br-on rule is ever
    // overridden or slow to apply on device.
    V.el.style.display = 'block';
    V.el.classList.add('br-on');
    void V.el.offsetWidth;
    V.el.classList.add('br-vis');
  }

  function closeViewer(dx, dy) {
    if (!V.el) return;
    var v = V.el;
    if (dx || dy) {
      var d = Math.max(1, C.swipeDistance(dx, dy));
      var mx = dx / d * 340, my = dy / d * 340;
      V.stage.style.transition = 'transform .24s ease-in';
      V.tx += mx; V.ty += my;
      V.apply();
      v.classList.remove('br-vis');
      setTimeout(function () {
        v.classList.remove('br-on');
        v.style.display = '';
        V.stage.style.transition = '';
        V.scale = 1; V.tx = 0; V.ty = 0; V.apply();
      }, 250);
    } else {
      // Fade out, then hide — the mirror of the open fade.
      v.classList.remove('br-vis');
      setTimeout(function () {
        v.classList.remove('br-on');
        v.style.display = '';
        V.scale = 1; V.tx = 0; V.ty = 0; V.apply();
      }, 235);
    }
  }

  // ---------- menu panel (Apple Reader Options style) ----------
  function openSheet(htmlBuilder) {
    buildReader();
    S.sheet.innerHTML = '';
    try {
      htmlBuilder(S.sheet);
    } catch (err) {
      // Never fail silently: show what broke, in the menu itself.
      S.sheet.innerHTML = '';
      var h = el('h3', '', 'Reader Options');
      var p = el('p', 'br-note', 'Menu error: ' + (err && err.message ? err.message : err));
      S.sheet.appendChild(h); S.sheet.appendChild(p);
    }
    S.sheet.classList.add('br-on');
    S.backdrop.classList.add('br-on');
    applyAppearance();
  }
  function closeSheet() {
    if (S.sheet) S.sheet.classList.remove('br-on');
    if (S.backdrop) S.backdrop.classList.remove('br-on');
  }
  function sheetTitle(sheet, text) {
    var h = el('h3', '', text); sheet.appendChild(h);
    return h;
  }
  // One Apple-style list row: optional icon/dot, label, checkmark when selected.
  function menuRow(sheet, opts) {
    var b = el('button', 'br-mrow' + (opts.selected ? ' br-sel' : ''));
    if (opts.dataKey) b.setAttribute('data-mrow', opts.dataKey);
    if (opts.dot) {
      var d = el('span', 'br-mdot'); d.style.background = opts.dot; b.appendChild(d);
    } else if (opts.icon) {
      b.appendChild(el('span', 'br-ic', opts.icon));
    }
    var lab = el('span', '', opts.label);
    if (opts.fontStack) lab.style.fontFamily = opts.fontStack;
    b.appendChild(lab);
    b.appendChild(el('span', 'br-ck', '✓'));
    if (opts.onClick) b.addEventListener('click', opts.onClick);
    sheet.appendChild(b);
    return b;
  }
  function switchRow(sheet, label, checked, onChange) {
    var row = el('div', 'br-switchrow');
    row.appendChild(el('span', '', label));
    var sw = el('label', 'br-switch');
    var input = el('input'); input.type = 'checkbox'; input.checked = !!checked;
    var i = el('i');
    sw.appendChild(input); sw.appendChild(i);
    input.addEventListener('change', function () { onChange(input.checked); });
    row.appendChild(sw);
    sheet.appendChild(row);
    return input;
  }
  // Update checkmarks in place — the menu never rebuilds on a change.
  function refreshMenuSelections() {
    if (!S.sheet) return;
    var e = eff();
    var current = {
      theme: themeId(), font: e.font, lh: String(e.lineHeight),
      width: String(e.width), scope: S.aaScope,
      ttsRate: String(e.ttsRate), scrollSpeed: String(e.scrollSpeed)
    };
    var rows = S.sheet.querySelectorAll('[data-mrow]');
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute('data-mrow');
      var parts = key.split(':');
      var kind = parts[0], val = parts.slice(1).join(':');
      if (current[kind] !== undefined) rows[i].classList.toggle('br-sel', String(current[kind]) === val);
    }
    var sv = S.sheet.querySelector('.br-size-val');
    if (sv) sv.textContent = (e.fontSize || 19) + ' pt';
  }

  function openTocSheet() {
    openSheet(function (sheet) {
      sheetTitle(sheet, 'Contents');
      if (!S.headings.length) { sheet.appendChild(el('p', 'br-note', 'No headings in this article.')); return; }
      S.headings.forEach(function (h) {
        var b = el('button', 'br-tocitem', h.text);
        if (h.level > 2) b.style.paddingLeft = '20px';
        b.addEventListener('click', function () {
          closeSheet();
          var target = document.getElementById(h.id);
          if (target && S.reader) S.reader.scrollTop = target.offsetTop - 70;
        });
        sheet.appendChild(b);
      });
    });
  }

  // ---------- gear menu: all reader settings, Apple Reader Options style ----------
  // Global-only settings (text-only, listen, auto-scroll) ignore
  // the Aa scope toggle — they are playback/view modes, not
  // per-site typography.
  function writeGlobal(patch) {
    Object.keys(patch).forEach(function (k) { S.settings[k] = patch[k]; });
    storageSet(K.settings, S.settings);
    applyAppearance();
    refreshMenuSelections();
  }
  function writeTypography(patch) {
    if (S.aaScope === 'site') {
      var cur = S.perSite[S.host] || {};
      Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
      S.perSite[S.host] = cur;
      storageSet(K.perSite, S.perSite);
    } else {
      Object.keys(patch).forEach(function (k) { S.settings[k] = patch[k]; });
      storageSet(K.settings, S.settings);
    }
    applyAppearance();
    refreshMenuSelections();
  }

  function openAaSheet() {
    openSheet(function (sheet) {
      var e = eff();
      var scope = S.aaScope;
      // Header, like Apple's: "Aa Reader Options" + collapse chevron.
      var head = el('div', 'br-mhead');
      head.appendChild(el('span', 'br-aa-badge', 'Aa'));
      head.appendChild(el('b', '', 'Reader Options'));
      head.appendChild(el('span', 'br-chev', '⌄'));
      head.addEventListener('click', closeSheet);
      sheet.appendChild(head);

      // Actions
      menuRow(sheet, { icon: '✕', label: 'Hide Reader', onClick: function () { closeSheet(); closeReader(); } });
      menuRow(sheet, { icon: '☰', label: 'Contents', onClick: openTocSheet });
      menuRow(sheet, { icon: '⌕', label: 'Find in Article', onClick: function () { showFindBar(); } });
      menuRow(sheet, {
        icon: '✦', label: 'Highlights' + (S.current ? ' (' + highlightsFor(S.current.url).length + ')' : ''),
        onClick: openHighlightsSheet
      });
      menuRow(sheet, {
        icon: '🔖', label: S.current && isSaved(S.current.url) ? 'Saved ✓' : 'Save Article',
        onClick: function (ev) {
          toggleSaveCurrent(null);
          var lab = ev.currentTarget.querySelector('span:nth-child(2)');
          if (lab) lab.textContent = S.current && isSaved(S.current.url) ? 'Saved ✓' : 'Save Article';
        }
      });
      menuRow(sheet, { icon: '▤', label: 'Saved Articles', onClick: openLibrarySheet });
      menuRow(sheet, { icon: '⤓', label: 'Export Markdown (.md)', onClick: function () { closeSheet(); exportCurrent(); } });
      menuRow(sheet, { icon: '⤓', label: 'Export PDF (with images)', onClick: function () { closeSheet(); exportPdf(); } });
      menuRow(sheet, { icon: '⎘', label: 'Copy Extraction Report', onClick: function () { closeSheet(); copyExtractionReport(); } });

      // Collapsible setting categories — tap a header to expand/collapse.
      if (!S.openSections) S.openSections = { site: true, appearance: true, text: false, layout: false, listen: false };
      function section(id, label) {
        var hd = el('button', 'br-sec-head');
        hd.appendChild(el('span', '', label));
        var chev = el('span', 'br-sec-chev', '›');
        chev.style.transform = S.openSections[id] ? 'rotate(90deg)' : '';
        hd.appendChild(chev);
        // Animated disclosure: the body is a grid whose row
        // animates 1fr <-> 0fr around an overflow-hidden inner —
        // rows append to the inner, the animation lives on the
        // outer. Older engines that can't animate grid rows
        // simply snap, which is the old behaviour.
        var body = el('div', 'br-sec-body' + (S.openSections[id] ? '' : ' br-collapsed'));
        var inner = el('div', 'br-sec-inner');
        body.appendChild(inner);
        hd.addEventListener('click', function () {
          S.openSections[id] = !S.openSections[id];
          body.classList.toggle('br-collapsed', !S.openSections[id]);
          chev.style.transform = S.openSections[id] ? 'rotate(90deg)' : '';
        });
        sheet.appendChild(hd); sheet.appendChild(body);
        // No transition for the initial paint (the sheet itself
        // is animating in); arm it a beat later.
        setTimeout(function () { body.classList.add('br-anim'); }, 60);
        return inner;
      }
      var secSite = section('site', 'This Site');
      var secAppearance = section('appearance', 'Appearance');
      var secText = section('text', 'Text');
      var secLayout = section('layout', 'Layout');
      var secListen = section('listen', 'Listen & Scroll');
      switchRow(secListen, 'Read Aloud', flowState().ttsOn, function (on) {
        if (on) { closeSheet(); ttsStart(); } else ttsStop();
      });
      [{ v: 0.9, l: '0.9×' }, { v: 1, l: '1×' }, { v: 1.1, l: '1.1×' }, { v: 1.25, l: '1.25×' }, { v: 1.5, l: '1.5×' }].forEach(function (o) {
        menuRow(secListen, {
          icon: '♪', label: 'Voice Speed ' + o.l, dataKey: 'ttsRate:' + o.v,
          onClick: function () { writeGlobal({ ttsRate: o.v }); }
        });
      });
      switchRow(secListen, 'Auto-Scroll', flowState().scrollOn || !!eff().autoScroll, function (on) {
        writeGlobal({ autoScroll: on });
        if (on) { closeSheet(); scrollStart(); } else scrollStop();
      });
      [{ v: 20, l: 'Slow' }, { v: 40, l: 'Normal' }, { v: 70, l: 'Brisk' }].forEach(function (o) {
        menuRow(secListen, {
          icon: '↓', label: 'Scroll Speed · ' + o.l, dataKey: 'scrollSpeed:' + o.v,
          onClick: function () { writeGlobal({ scrollSpeed: o.v }); }
        });
      });

      // Text size stepper, Apple-style A- / A+
      var srow = el('div', 'br-mrow'); srow.style.cursor = 'default';
      srow.appendChild(el('span', 'br-ic', 'Aa'));
      srow.appendChild(el('span', '', 'Text Size'));
      var stepper = el('span', 'br-stepper');
      var minus = el('button', '', 'A−');
      var val = el('span', 'br-size-val', (e.fontSize || 19) + ' pt');
      var plus = el('button', '', 'A+');
      minus.style.fontSize = '12px'; plus.style.fontSize = '17px'; plus.style.fontWeight = '700';
      function step(delta) {
        var cur = eff().fontSize || 19;
        var next = Math.max(16, Math.min(24, cur + delta));
        if (next !== cur) writeTypography({ fontSize: next });
      }
      minus.addEventListener('click', function () { step(-1); });
      plus.addEventListener('click', function () { step(1); });
      stepper.appendChild(minus); stepper.appendChild(val); stepper.appendChild(plus);
      srow.appendChild(stepper);
      secText.appendChild(srow);

      // Theme — radio rows with colour dots, like Apple's White/Sepia/Gray/Night
      secAppearance.appendChild(el('h4', '', 'Theme'));
      Object.keys(C.THEMES).forEach(function (id) {
        var t = C.THEMES[id];
        menuRow(secAppearance, {
          dot: t.bg, label: t.label, selected: themeId() === id, dataKey: 'theme:' + id,
          onClick: function () {
            if (scope === 'site') { writeTypography({ theme: id }); return; }
            if (S.settings.followSystem) {
              if (t.dark) S.settings.darkTheme = id; else S.settings.lightTheme = id;
            } else S.settings.lockedTheme = id;
            storageSet(K.settings, S.settings);
            applyAppearance(); refreshMenuSelections();
          }
        });
      });
      if (scope === 'global') {
        switchRow(secAppearance, 'Follow System Light / Dark', S.settings.followSystem, function (on) {
          S.settings.followSystem = on;
          if (!on) S.settings.lockedTheme = themeId();
          storageSet(K.settings, S.settings);
          applyAppearance(); openAaSheet();
        });
      }
      switchRow(secText, 'Drop Cap', eff().dropCap, function (on) { writeTypography({ dropCap: on }); });
      switchRow(secAppearance, 'Text Only (hide images)', !!eff().textOnly, function (on) {
        writeGlobal({ textOnly: on });
        rerenderKeepScroll();
      });

      // Menu bar position (global): bottom by default, or top.
      secLayout.appendChild(el('h4', '', 'Menu Bar'));
      [{ v: 'bottom', l: 'Bottom' }, { v: 'top', l: 'Top' }].forEach(function (o) {
        menuRow(secLayout, {
          label: o.l, selected: (S.settings.barPos || 'bottom') === o.v, dataKey: 'bar:' + o.v,
          onClick: function () {
            S.settings.barPos = o.v;
            storageSet(K.settings, S.settings);
            applyAppearance(); refreshMenuSelections();
          }
        });
      });

      // Font — list rows, each set in its own font, like Apple's
      secText.appendChild(el('h4', '', 'Font'));
      Object.keys(C.FONTS).forEach(function (key) {
        var f = C.FONTS[key];
        menuRow(secText, {
          label: f.label, fontStack: f.stack, selected: eff().font === key, dataKey: 'font:' + key,
          onClick: function () { writeTypography({ font: key }); }
        });
      });

      // Line spacing + column width as checkmark rows
      secText.appendChild(el('h4', '', 'Line Spacing'));
      [{ v: 1.45, l: 'Tight' }, { v: 1.65, l: 'Cozy' }, { v: 1.85, l: 'Airy' }].forEach(function (o) {
        menuRow(secText, {
          label: o.l, selected: eff().lineHeight === o.v, dataKey: 'lh:' + o.v,
          onClick: function () { writeTypography({ lineHeight: o.v }); }
        });
      });
      secLayout.appendChild(el('h4', '', 'Column Width'));
      [{ v: 'narrow', l: 'Narrow' }, { v: 'standard', l: 'Standard' }, { v: 'wide', l: 'Wide' }].forEach(function (o) {
        menuRow(secLayout, {
          label: o.l, selected: eff().width === o.v, dataKey: 'width:' + o.v,
          onClick: function () { writeTypography({ width: o.v }); }
        });
      });

      // Scope + this site
      secSite.appendChild(el('h4', '', 'Apply Settings To'));
      [{ v: 'global', l: 'All Sites' }, { v: 'site', l: 'This Site Only' }].forEach(function (o) {
        menuRow(secSite, {
          label: o.l, selected: S.aaScope === o.v, dataKey: 'scope:' + o.v,
          onClick: function () { S.aaScope = o.v; openAaSheet(); }
        });
      });
      if (scope === 'site' && perSite()) secSite.appendChild(el('p', 'br-note', 'This site has its own settings. They override All Sites.'));
      secSite.appendChild(el('h4', '', S.host));
      switchRow(secSite, 'Always Open Reader on This Site', S.autoSites.indexOf(S.host) >= 0, function (on) {
        if (on && S.autoSites.indexOf(S.host) < 0) S.autoSites.push(S.host);
        if (!on) S.autoSites = S.autoSites.filter(function (h) { return h !== S.host; });
        storageSet(K.autoSites, S.autoSites);
      });
      if (perSite()) {
        var reset = el('button', 'br-chip', 'Reset This Site’s Settings');
        reset.style.marginTop = '12px';
        reset.addEventListener('click', function () {
          delete S.perSite[S.host];
          storageSet(K.perSite, S.perSite);
          applyAppearance(); openAaSheet();
        });
        secSite.appendChild(reset);
      }
    });
  }

  // ---------- save for later (H) + library ----------
  function isSaved(url) { return S.library.some(function (it) { return it.url === url; }); }
  function updateSaveButton() {
    if (!S.reader || !S.current) return;
    var b = S.reader.querySelector('[data-act="save"]');
    if (b) {
      // The button is the 🔖 emoji (v1.15.2); the saved state
      // reads through the accent pill behind it, not a label.
      var saved = isSaved(S.current.url);
      b.classList.toggle('br-saved', saved);
      b.setAttribute('aria-label', saved ? 'Saved' : 'Save article');
    }
  }
  function toggleSaveCurrent(btn) {
    if (!S.current) return;
    var url = S.current.url;
    if (isSaved(url)) {
      S.library = S.library.filter(function (it) { return it.url !== url; });
    } else {
      var newItem = {
        id: 'sv' + Date.now(), url: url, title: S.current.title, subtitle: S.current.subtitle || '',
        byline: S.current.byline || '',
        date: S.current.date || '', site: S.current.site || S.host, hero: S.current.hero || '',
        heroVideo: S.current.heroVideo || null, favicon: S.current.favicon || '',
        blocks: S.current.blocks, wordCount: S.current.wordCount || 0, savedAt: Date.now(),
        offline: 'none', imgCache: {}
      };
      S.library.unshift(newItem);
      S.library = S.library.slice(0, 20);
      cacheImagesFor(newItem);
    }
    storageSet(K.library, S.library);
    updateSaveButton();
  }

  // Make a saved article genuinely offline: fetch its images,
  // shrink them, and keep them with the article as data URLs.
  // Best effort by design — a host that refuses the fetch (CORS)
  // leaves that image online-only, and the text is offline
  // either way. Budgets keep storage sane: at most 6 images and
  // ~1.8 MB of data per article.
  function cacheImagesFor(item) {
    var srcs = [], seenId = {};
    function add(src) {
      if (!src || src.indexOf('data:') === 0) return;
      var id = C.imageIdentity(src);
      if (seenId[id] || srcs.length >= 6) return;
      seenId[id] = 1; srcs.push({ id: id, src: src });
    }
    add(item.hero);
    (item.blocks || []).forEach(function (b) { if (b.type === 'image') add(b.src); });
    if (!srcs.length) { item.offline = 'full'; storageSet(K.library, S.library); return; }
    var budget = 1.8 * 1024 * 1024, done = 0, cached = 0;
    srcs.forEach(function (entry) {
      fetch(entry.src).then(function (res) { return res.blob(); }).then(function (blob) {
        return downscaleImageBlob(blob);
      }).then(function (dataUrl) {
        done++;
        if (dataUrl && dataUrl.length <= budget) { item.imgCache[entry.id] = dataUrl; budget -= dataUrl.length; cached++; }
        if (done === srcs.length) {
          item.offline = cached === srcs.length ? 'full' : (cached ? 'partial' : 'none');
          storageSet(K.library, S.library);
        }
      }).catch(function () {
        done++;
        if (done === srcs.length) {
          item.offline = cached === srcs.length ? 'full' : (cached ? 'partial' : 'none');
          storageSet(K.library, S.library);
        }
      });
    });
  }
  function downscaleImageBlob(blob) {
    return new Promise(function (resolve) {
      try {
        if (!blob || blob.type === 'image/gif' || blob.size <= 60 * 1024) {
          var fr = new FileReader();
          fr.onload = function () { resolve(String(fr.result || '')); };
          fr.onerror = function () { resolve(''); };
          fr.readAsDataURL(blob);
          return;
        }
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          try {
            var scale = Math.min(1, 1100 / (img.naturalWidth || 1100));
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
            cv.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            URL.revokeObjectURL(url);
            resolve(cv.toDataURL('image/jpeg', 0.82));
          } catch (e) { URL.revokeObjectURL(url); resolve(''); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(''); };
        img.src = url;
      } catch (e) { resolve(''); }
    });
  }

  function openLibrarySheet() {
    openSheet(function (sheet) {
      sheetTitle(sheet, 'Saved for later');
      if (!S.library.length) { sheet.appendChild(el('p', 'br-note', 'Nothing saved yet. Tap Save in the reader to keep a clean copy here, readable offline.')); return; }
      S.library.forEach(function (item) {
        var row = el('div', 'br-libitem');
        var del = el('button', 'br-libdel', 'Delete');
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          S.library = S.library.filter(function (it) { return it.id !== item.id; });
          storageSet(K.library, S.library);
          openLibrarySheet();
          updateSaveButton();
        });
        row.appendChild(del);
        row.appendChild(el('b', '', item.title));
        var mins = C.readingTimeMinutes(item.wordCount || 0);
        row.appendChild(el('span', '', (item.site || '') + (mins ? ' · ' + mins + ' min' : '') + ' · saved ' + new Date(item.savedAt).toLocaleDateString() + (item.offline === 'full' ? ' · Offline ✓' : item.offline === 'partial' ? ' · Offline (text)' : '')));
        row.addEventListener('click', function () { openSavedArticle(item); });
        sheet.appendChild(row);
      });
    });
  }

  function openLibrary() {
    // Pill long-press entry point: build the shell, then show the library.
    buildReader();
    if (!S.current) {
      S.current = S.detected || { title: '', byline: '', date: '', site: S.host, url: location.href, hero: '', blocks: [], wordCount: 0, fromLibrary: true };
      renderCurrent();
    }
    showReaderShell();
    openLibrarySheet();
  }

  // ---------- highlights + notes (D) ----------
  function highlightsFor(url) { return S.highlights[url] || []; }
  function persistHighlights(url, list) {
    if (list.length) S.highlights[url] = list; else delete S.highlights[url];
    storageSet(K.highlights, S.highlights);
  }
  function wrapRange(range, id, note, color) {
    var mark = el('mark', 'br-hl br-hl-' + (color || 'yellow'));
    mark.setAttribute('data-hid', id);
    if (note) mark.title = note;
    try { range.surroundContents(mark); return mark; } catch (e) {
      try {
        var contents = range.extractContents();
        mark.appendChild(contents);
        range.insertNode(mark);
        return mark;
      } catch (e2) { return null; }
    }
  }
  function restoreHighlights() {
    if (!S.current || !S.articleBody) return;
    highlightsFor(S.current.url).forEach(function (h) { findAndWrap(h); });
  }
  // The article body's text as one string, with each text node's
  // span inside it — the map that lets a saved highlight be found
  // again even when it spans several paragraphs (the old search
  // looked inside single text nodes only, so multi-paragraph
  // highlights could never re-wrap).
  function articleTextIndex() {
    var nodes = [], parts = [], off = 0;
    if (!S.articleBody) return { text: '', nodes: nodes };
    var walker = document.createTreeWalker(S.articleBody, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (n.parentNode && (n.parentNode.tagName === 'PRE' || n.parentNode.tagName === 'MARK')) continue;
      nodes.push({ node: n, start: off, end: off + n.nodeValue.length });
      parts.push(n.nodeValue); off += n.nodeValue.length;
    }
    return { text: parts.join(''), nodes: nodes };
  }
  function normStr(s) { return String(s || '').replace(/\s+/g, ' '); }
  function findAndWrap(h) {
    if (!S.articleBody || S.articleBody.querySelector('mark[data-hid="' + h.id + '"]')) return;
    var idx = articleTextIndex();
    if (!idx.text || !h.text) return;
    // Normalised haystack (whitespace collapsed) with a map from
    // each normalised character back to its node + raw offset.
    var norm = '', map = [];
    var lastSpace = true;
    idx.nodes.forEach(function (nd) {
      var v = nd.node.nodeValue;
      for (var i = 0; i < v.length; i++) {
        var ch = v.charAt(i);
        if (/\s/.test(ch)) {
          if (!lastSpace) { norm += ' '; map.push({ nd: nd, o: i }); lastSpace = true; }
        } else { norm += ch; map.push({ nd: nd, o: i }); lastSpace = false; }
      }
    });
    var needle = normStr(h.text);
    var startN = -1;
    if (h.pre || h.post) {
      var combo = normStr(h.pre || '') + needle + normStr(h.post || '');
      var cp = norm.indexOf(combo);
      if (cp >= 0) startN = cp + normStr(h.pre || '').length;
    }
    if (startN < 0) {
      var matches = [], p = -1;
      while ((p = norm.indexOf(needle, p + 1)) >= 0) matches.push(p);
      if (matches.length === 1) startN = matches[0];
      else if (matches.length > 1) {
        // Disambiguate a repeated passage by its saved context.
        var pre = normStr(h.pre || ''), post = normStr(h.post || '');
        for (var mi = 0; mi < matches.length; mi++) {
          var mp = matches[mi];
          var preOk = !pre || norm.slice(Math.max(0, mp - pre.length), mp) === pre;
          var postOk = !post || norm.slice(mp + needle.length, mp + needle.length + post.length) === post;
          if (preOk && postOk) { startN = mp; break; }
        }
        if (startN < 0) startN = matches[0];
      }
    }
    if (startN < 0 || startN >= map.length) return;
    var endN = Math.min(startN + needle.length - 1, map.length - 1);
    var sRef = map[startN], eRef = map[endN];
    if (!sRef || !eRef) return;
    try {
      var range = document.createRange();
      range.setStart(sRef.nd.node, sRef.o);
      range.setEnd(eRef.nd.node, Math.min(eRef.o + 1, eRef.nd.node.nodeValue.length));
      wrapRange(range, h.id, h.note, h.color);
    } catch (e) {}
  }
  function maybeShowSelBar() {
    hideSelBar();
    if (!S.open || !S.current) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var text = cleanText(sel.toString());
    if (!text || text.length < 3) return;
    var range = sel.getRangeAt(0);
    if (!S.articleBody || !S.articleBody.contains(range.commonAncestorContainer)) return;
    var rect = range.getBoundingClientRect();
    var bar = el('div'); bar.id = 'br-selbar';
    // Colour dots highlight immediately in that colour; Note
    // prompts first and uses the last colour picked.
    ['yellow', 'green', 'blue', 'pink'].forEach(function (color) {
      var dot = el('button', 'br-dot');
      dot.setAttribute('data-color', color);
      dot.title = 'Highlight ' + color;
      dot.addEventListener('click', function () { S.lastHlColor = color; doHighlight('', color); });
      bar.appendChild(dot);
    });
    var nb = el('button', '', 'Highlight + Note');
    nb.addEventListener('click', function () {
      var note = window.prompt('Note for this highlight:', '') || '';
      doHighlight(note, S.lastHlColor || 'yellow');
    });
    bar.appendChild(nb);
    // Inside the reader, so the top layer carries it too — a
    // body-level bar would paint underneath a top-layer reader.
    (S.reader || document.body).appendChild(bar);
    bar.style.display = 'flex';
    bar.style.left = Math.max(6, Math.min(rect.left + rect.width / 2 - 90, window.innerWidth - 190)) + 'px';
    bar.style.top = Math.max(6, rect.top - 52) + 'px';
    S.selBar = bar;
    function doHighlight(note, color) {
      var id = 'hl' + Date.now() + Math.floor(Math.random() * 999);
      // Anchor context from the article text map, captured before
      // wrapping changes the DOM: 40 chars either side lets a
      // repeated passage be told apart on the next visit.
      var pre = '', post = '';
      try {
        var tidx = articleTextIndex(), st = -1, en = -1;
        tidx.nodes.forEach(function (nd) {
          if (nd.node === range.startContainer) st = nd.start + range.startOffset;
          if (nd.node === range.endContainer) en = nd.start + range.endOffset;
        });
        if (st >= 0) pre = tidx.text.slice(Math.max(0, st - 40), st);
        if (en >= 0) post = tidx.text.slice(en, en + 40);
      } catch (e) {}
      var mark = wrapRange(range, id, note, color);
      hideSelBar();
      if (window.getSelection) window.getSelection().removeAllRanges();
      if (!mark) return;
      var list = highlightsFor(S.current.url).slice();
      list.push({ id: id, text: text.slice(0, 2000), note: note, color: color || 'yellow', pre: pre, post: post, ts: Date.now() });
      persistHighlights(S.current.url, list);
    }
  }
  function hideSelBar() { if (S.selBar) { S.selBar.remove(); S.selBar = null; } }
  function openHighlightMenu(mark) {
    var id = mark.getAttribute('data-hid');
    var list = highlightsFor(S.current.url);
    var rec = null;
    list.forEach(function (h) { if (h.id === id) rec = h; });
    openSheet(function (sheet) {
      sheetTitle(sheet, 'Highlight');
      var q = el('p', '', rec ? '“' + rec.text + '”' : '“' + cleanText(mark.textContent) + '”');
      sheet.appendChild(q);
      if (rec && rec.note) sheet.appendChild(el('p', 'br-note', 'Note: ' + rec.note));
      var row = el('div', 'br-row');
      var edit = el('button', 'br-chip', rec && rec.note ? 'Edit note' : 'Add note');
      edit.addEventListener('click', function () {
        var note = window.prompt('Note:', rec ? (rec.note || '') : '') ;
        if (note === null) return;
        if (rec) { rec.note = note; persistHighlights(S.current.url, list); mark.title = note; }
        closeSheet();
      });
      var del = el('button', 'br-chip', 'Remove highlight');
      del.addEventListener('click', function () {
        if (rec) persistHighlights(S.current.url, list.filter(function (h) { return h.id !== id; }));
        var parent = mark.parentNode;
        if (parent) {
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          mark.remove();
        }
        closeSheet();
      });
      row.appendChild(edit); row.appendChild(del);
      sheet.appendChild(row);
      // Recolour in place.
      var crow = el('div', 'br-row');
      ['yellow', 'green', 'blue', 'pink'].forEach(function (color) {
        var cb = el('button', 'br-chip', color.charAt(0).toUpperCase() + color.slice(1));
        cb.addEventListener('click', function () {
          mark.className = 'br-hl br-hl-' + color;
          if (rec) { rec.color = color; persistHighlights(S.current.url, list); }
          closeSheet();
        });
        crow.appendChild(cb);
      });
      sheet.appendChild(crow);
    });
  }

  // All of this article's highlights in one list; tap one to
  // jump to it in the text.
  function openHighlightsSheet() {
    openSheet(function (sheet) {
      sheetTitle(sheet, 'Highlights');
      var list = highlightsFor(S.current.url);
      if (!list.length) { sheet.appendChild(el('p', 'br-note', 'No highlights in this article yet. Select any text to make one.')); return; }
      list.slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); }).forEach(function (h) {
        var row = el('div', 'br-hlrow');
        row.appendChild(el('span', 'br-dot br-dot-' + (h.color || 'yellow')));
        var cell = el('div');
        cell.appendChild(el('p', '', '“' + (h.text.length > 140 ? h.text.slice(0, 140) + '…' : h.text) + '”'));
        if (h.note) cell.appendChild(el('span', '', h.note));
        row.appendChild(cell);
        row.addEventListener('click', function () {
          closeSheet();
          var mark = S.articleBody ? S.articleBody.querySelector('mark[data-hid="' + h.id + '"]') : null;
          if (mark) {
            mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
            mark.classList.remove('br-flash');
            setTimeout(function () { mark.classList.add('br-flash'); }, 60);
            setTimeout(function () { mark.classList.remove('br-flash'); }, 1400);
          } else showToast('That highlight could not be located in the text');
        });
        sheet.appendChild(row);
      });
    });
  }

  // ---------- export (D) ----------
  // One-tap diagnostics: everything needed to reproduce an
  // extraction problem, copied as plain text.
  function copyExtractionReport() {
    var a = S.current;
    var ver = 'unknown';
    try { if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getManifest) ver = browser.runtime.getManifest().version; } catch (e) {}
    var counts = {};
    if (a) (a.blocks || []).forEach(function (b) { counts[b.type] = (counts[b.type] || 0) + 1; });
    var lines = [
      'Beautiful Reader extraction report',
      'Version: ' + ver,
      'URL: ' + (a ? a.url : location.href),
      'Host: ' + (a ? a.site : S.host),
      'Title: ' + (a ? a.title : '(none)'),
      'Readable: ' + (a ? String(a.readable) : 'n/a'),
      'Gated suspected: ' + (a ? String(!!a.gated) : 'n/a'),
      'Text length: ' + (a && a.stats ? a.stats.textLength : 0),
      'Paragraphs: ' + (a && a.stats ? a.stats.paragraphCount : 0),
      'Link density: ' + (a && a.stats ? a.stats.linkDensity : 0),
      'JSON-LD articleBody length: ' + (a ? (a.ldBodyLength || 0) : 0),
      'Blocks: ' + Object.keys(counts).map(function (k) { return k + '×' + counts[k]; }).join(', '),
      'Hero: ' + (a && a.hero ? 'yes' : 'no') + ' · Hero video: ' + (a && a.heroVideo ? 'yes' : 'no'),
      'Hero URL: ' + (a && a.hero ? a.hero : '(none)'),
      'Image blocks: ' + (a ? (a.blocks || []).filter(function (b) { return b.type === 'image'; }).map(function (b) { return b.src; }).join(' | ') || '(none)' : '(none)'),
      'Subtitle: ' + (a && a.subtitle ? a.subtitle.slice(0, 120) : '(none)'),
      'User agent: ' + navigator.userAgent
    ];
    var text = lines.join('\n');
    function done(ok) { showToast(ok ? 'Extraction report copied' : 'Copy failed — report is in the console'); if (!ok) { try { console.log(text); } catch (e) {} } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { legacy(); });
    } else legacy();
    function legacy() {
      try {
        var ta = el('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
        (S.reader || document.body).appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand('copy');
        ta.remove();
        done(!!ok);
      } catch (e) { done(false); }
    }
  }

  function exportCurrent() {
    if (!S.current) return;
    var md = C.fullExport(S.current.blocks, {
      title: S.current.title, subtitle: S.current.subtitle || '', byline: S.current.byline, date: S.current.date, url: S.current.url
    }, highlightsFor(S.current.url));
    try {
      var blob = new Blob([md], { type: 'text/markdown' });
      var a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = C.slugify(S.current.title) + '.md';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    } catch (e) {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md);
    }
  }

  // PDF export: a print rendering of the standalone article HTML (header,
  // byline/date, hero and every image). In the system print dialog, use
  // Share / Save to Files to keep it as a PDF.
  // PDF export = the reader view exactly as it looks right now.
  // A clone of the rendered article is placed inside the reader; a
  // print stylesheet hides everything else (including the web page),
  // and the top window prints. (The old hidden-iframe print printed
  // the web page instead in Orion.)
  function exportPdf() {
    if (!S.current || !S.content || !S.reader) return;
    var old = document.getElementById('br-print');
    if (old) old.remove();
    var wrap = el('div'); wrap.id = 'br-print';
    var clone = S.content.cloneNode(true);
    clone.classList.remove('br-rise');
    Array.prototype.forEach.call(clone.querySelectorAll('video'), function (v) {
      var rep;
      if (v.poster) { rep = el('img'); rep.src = v.poster; rep.alt = ''; }
      else rep = el('p', '', '▶ Video — watch on the original page');
      v.parentNode.replaceChild(rep, v);
    });
    Array.prototype.forEach.call(clone.querySelectorAll('iframe'), function (f) {
      var rep = el('p', '', '▶ Video: ' + (f.getAttribute('src') || ''));
      f.parentNode.replaceChild(rep, f);
    });
    Array.prototype.forEach.call(clone.querySelectorAll('.br-resume, .br-status, button'), function (n) { n.remove(); });
    // Images: the clone's <img> elements are new nodes with
    // loading="lazy" inside a display:none subtree — the browser
    // never starts those loads, so the PDF came out text-only.
    // Point each clone image at the already-loaded live image's
    // URL, force eager loading, and wait for every image to
    // settle before printing.
    var liveSrc = {};
    Array.prototype.forEach.call(S.content.querySelectorAll('img'), function (im) {
      var key = im.getAttribute('src') || '';
      if (key && im.currentSrc) liveSrc[key] = im.currentSrc;
    });
    var pending = [];
    Array.prototype.forEach.call(clone.querySelectorAll('img'), function (im) {
      var key = im.getAttribute('src') || '';
      if (liveSrc[key] && liveSrc[key] !== key) im.src = liveSrc[key];
      im.removeAttribute('loading');
      im.loading = 'eager';
      if (!im.complete || im.naturalWidth === 0) {
        pending.push(new Promise(function (resolve) {
          var settled = false;
          function fin() { if (!settled) { settled = true; resolve(); } }
          im.addEventListener('load', fin);
          im.addEventListener('error', fin);
          setTimeout(fin, 6000);
          // Re-kick the load now that the node is eager.
          var s = im.src; im.src = ''; im.src = s;
        }));
      }
    });
    wrap.appendChild(clone);
    S.reader.appendChild(wrap);
    var done = false;
    function cleanup() {
      if (done) return; done = true;
      wrap.remove();
      window.removeEventListener('afterprint', cleanup);
      if (S.open) enterTopLayer();
    }
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 120000);
    // The print stylesheet puts the reader back in normal flow —
    // leave the top layer before printing, re-enter in cleanup.
    exitTopLayer();
    var wait = pending.length ? Promise.all(pending) : Promise.resolve();
    var cap = new Promise(function (resolve) { setTimeout(resolve, 7000); });
    Promise.race([wait, cap]).then(function () {
      setTimeout(function () { try { window.print(); } catch (err) {} }, 60);
    });
  }

  // ---------- init / detection ----------
  // Slow pages — JS-rendered articles hiding behind an email gate
  // (Business Insider and friends) — have no article text at load:
  // the server HTML is a shell and the story hydrates seconds later,
  // underneath the popup. Keep watching the DOM for the article to
  // arrive instead of giving up after the first empty checks.
  var watchState = { obs: null, timer: 0, deadline: 0, lastLen: -1 };
  function startArticleWatch() {
    if (watchState.obs || watchState.timer) return;
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    watchState.deadline = Date.now() + 45000;
    watchState.lastLen = (document.body.textContent || '').length;
    var pending = 0;
    try {
      watchState.obs = new MutationObserver(function () {
        if (pending) return;
        pending = setTimeout(function () { pending = 0; watchRetry(); }, 700);
      });
      watchState.obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    } catch (e) { watchState.obs = null; }
    watchState.timer = setInterval(watchRetry, 4000);
  }
  function stopArticleWatch() {
    if (watchState.obs) { try { watchState.obs.disconnect(); } catch (e) {} watchState.obs = null; }
    if (watchState.timer) { clearInterval(watchState.timer); watchState.timer = 0; }
  }
  function watchRetry() {
    if (S.dismissed || S.open || S.detected) { stopArticleWatch(); return; }
    if (Date.now() > watchState.deadline) { stopArticleWatch(); return; }
    var len = document.body ? (document.body.textContent || '').length : 0;
    if (Math.abs(len - watchState.lastLen) < 200) return; // nothing new to read yet
    watchState.lastLen = len;
    detectAndMaybeAuto(true);
    if (S.detected) stopArticleWatch();
  }

  // ---------- fast draw (v1.11.0) ----------
  // The race against anti-adblock walls is won before the
  // tap: the script now loads at document_start, extraction
  // runs the moment the DOM is ready (not after storage, not
  // at document_idle), and the finished article is cached in
  // S.detected — so when a wall fires and the Wall Breaker
  // marks the page hostile, the reader opens from memory,
  // immune to the wall's blanking fallback.
  function earlyExtract() {
    if (S.detected || S.open) return;
    if (C.isHomepagePath(location.pathname)) return;
    try {
      var art = extractArticle(document, location.href);
      if (art && art.readable) S.detected = art;
    } catch (e) {}
  }
  function pageHostile() {
    try { return sessionStorage.getItem('br_hostile') === '1'; } catch (e) { return false; }
  }
  // If the Wall Breaker has broken a wall on this page, pull
  // the reader up on our own — once, and only with an article
  // already in hand. Returns true when it opened.
  function raceOpenCheck() {
    if (S.open || S.dismissed || S.raceOpened) return false;
    if (!S.settings || !S.detected || !S.detected.readable) return false;
    if (S.settings.wallBreaker === false) return false;
    if (!pageHostile()) return false;
    S.raceOpened = true;
    openReader();
    return true;
  }
  function startRacePoll() {
    if (S.racePoll) return;
    var n = 0;
    S.racePoll = setInterval(function () {
      n++;
      if (S.open || S.dismissed || n > 240) { clearInterval(S.racePoll); S.racePoll = 0; return; }
      if (!raceOpenCheck()) sanctuaryCheck();
    }, 500);
  }
  // ---------- sanctuary (v1.12.0) ----------
  // When the wall's blanking fallback beats the Wall Breaker's
  // restores (Element Blocker v1.8.0's escalation), the breaker
  // flags br_sanctuary and hands over its snapshot. The reader
  // IS the sanctuary page: it pulls the article up inside its
  // own overlay — from the cached extraction if it has one,
  // else from the breaker's sanitized snapshot — where the
  // page's scripts have nothing left to fight.
  function sanctuaryCheck() {
    if (S.open || S.dismissed || S.sanctuaryOpened) return false;
    var asked = false;
    try { asked = sessionStorage.getItem('br_sanctuary') === '1'; } catch (e) {}
    if (!asked) return false;
    try { sessionStorage.removeItem('br_sanctuary'); } catch (e) {} // one sanctuary per blanking
    if (S.settings && S.settings.wallBreaker === false) return false;
    var art = (S.detected && S.detected.readable) ? S.detected : null;
    if (!art) {
      try {
        var snapHtml = sessionStorage.getItem('br_sanctuary_html');
        if (snapHtml) {
          var pdoc = new DOMParser().parseFromString(snapHtml, 'text/html');
          var sart = extractArticle(pdoc, location.href, true);
          if (sart && sart.blocks && sart.blocks.some(function (b) { return (b.text || '').length > 0; })) art = sart;
        }
      } catch (e) {}
    }
    if (!art) { try { art = extractArticle(document, location.href, true); } catch (e) { art = null; } }
    if (!art) return false;
    S.detected = art;
    art.sanctuary = true;
    S.sanctuaryOpened = true;
    openReader();
    killPage();
    return true;
  }
  // ---------- killing the page (v1.13.0) ----------
  // Kurt's rule: after the second lost fight, stop restoring
  // and stop the page itself. The saved article stays up in
  // the reader; everything else about the page ends — loading
  // halted, page-world timers cleared and scheduling neutered
  // (via the page hook), scripts and iframes stripped, and
  // every body child that isn't ours removed. A short purge
  // watch follows: anything the page's surviving observers
  // re-insert is removed again, so the reader sits alone on
  // an empty stage. Closing the reader leaves the dead page;
  // a reload brings the site back.
  function killPage() {
    if (S.pageKilled) return;
    S.pageKilled = true;
    try { window.stop(); } catch (e) {}
    try { window.postMessage({ __br_cmd: 'kill' }, '*'); } catch (e) {}
    purgePageDom();
    var n = 0;
    S.killWatch = setInterval(function () {
      n++;
      purgePageDom();
      if (n > 24 || !S.open) { clearInterval(S.killWatch); S.killWatch = 0; }
    }, 500);
  }
  function purgePageDom() {
    try {
      var dead = document.querySelectorAll('script, iframe, object, embed');
      for (var i = 0; i < dead.length; i++) { try { dead[i].remove(); } catch (e) {} }
      // A meta refresh is a reload with a timer we cannot clear
      // from here — the tag itself has to go.
      var metas = document.querySelectorAll('meta');
      for (var m = 0; m < metas.length; m++) {
        if ((metas[m].getAttribute('http-equiv') || '').toLowerCase() === 'refresh') { try { metas[m].remove(); } catch (e) {} }
      }
      if (!document.body) return;
      var kids = Array.prototype.slice.call(document.body.children);
      for (var j = 0; j < kids.length; j++) {
        var k = kids[j];
        if (k === S.reader || k === S.pill) continue;
        if (k.id && k.id.indexOf('br-') === 0) continue;
        try { k.remove(); } catch (e) {}
      }
    } catch (e) {}
  }

  function detectAndMaybeAuto(upgrade) {
    if (S.dismissed || S.open) return;
    if (C.isHomepagePath(location.pathname)) return; // homepages are indexes, not articles
    var art = S.detected || null;
    if (!art || upgrade) {
      var fresh = null;
      try { fresh = extractArticle(document, location.href); } catch (e) { fresh = null; }
      // An upgrade pass may replace the cache, never shrink it.
      if (fresh && fresh.readable && (!art || (fresh.wordCount || 0) >= (art.wordCount || 0))) art = fresh;
    }
    if (!art || !art.readable) { startArticleWatch(); return; }
    stopArticleWatch();
    S.detected = art;
    if (raceOpenCheck()) return;
    if (sanctuaryCheck()) return;
    if (S.autoSites.indexOf(S.host) >= 0 && !S.autoOpened) {
      S.autoOpened = true;
      setTimeout(function () { if (!S.open) openReader(); }, 500);
      return;
    }
    showPill();
  }

  // The toolbar popup edits the same storage; when it pings us,
  // reload so an open reader (and the auto-open list) stays current.
  function watchExternalSettings() {
    try {
      var rt = (window.browser && browser.runtime) || (window.chrome && chrome.runtime);
      if (!rt || !rt.onMessage) return;
      rt.onMessage.addListener(function (msg) {
        if (!msg) return;
        if (msg.type === 'br:openSaved' && msg.url) {
          storageGet(K.library, []).then(function (lib) {
            S.library = lib || [];
            for (var i = 0; i < S.library.length; i++) {
              if (S.library[i].url === msg.url) { openSavedArticle(S.library[i]); return; }
            }
          });
          return;
        }
        if (msg.type === 'br:openReader') { openReader(); return; }
        if (msg.type === 'br:forceReader') { forceOpenReader(); return; }
        if (msg.type === 'br:getReaderState') {
          return Promise.resolve({ open: !!S.open, detected: !!S.detected });
        }
        if (msg.type === 'br:toggleReader') {
          if (msg.on) { if (!S.open) { if (S.detected) openReader(); else forceOpenReader(); } }
          else if (S.open) closeReader();
          return;
        }
        if (msg.type !== 'br:settingsChanged') return;
        Promise.all([storageGet(K.settings, null), storageGet(K.perSite, {}), storageGet(K.autoSites, []), storageGet(K.library, []), storageGet(K.history, [])]).then(function (vals) {
          if (vals[0]) S.settings = vals[0];
          S.perSite = vals[1] || {}; S.autoSites = vals[2] || [];
          S.library = vals[3] || []; S.history = vals[4] || [];
          if (S.open) applyAppearance();
        });
      });
    } catch (e) {}
  }

  function init() {
    // Fast draw: extract before storage resolves — the article
    // is in memory before the page's wall scripts escalate.
    earlyExtract();
    watchExternalSettings();
    Promise.all([
      storageGet(K.settings, null), storageGet(K.perSite, {}), storageGet(K.autoSites, []),
      storageGet(K.progress, {}), storageGet(K.highlights, {}), storageGet(K.library, []),
      storageGet(K.history, null)
    ]).then(function (vals) {
      S.settings = vals[0] || JSON.parse(JSON.stringify(C.DEFAULT_SETTINGS));
      S.perSite = vals[1] || {}; S.autoSites = vals[2] || [];
      S.progress = vals[3] || {}; S.highlights = vals[4] || {}; S.library = vals[5] || [];
      if (Array.isArray(vals[6])) S.history = vals[6];
      else {
        // First run: seed history from saved reading positions.
        S.history = Object.keys(S.progress).map(function (u) {
          var p = S.progress[u];
          return { url: u, title: p.title || u, site: C.hostOf(u), ts: p.ts || Date.now(), progress: p.frac || 0, done: (p.frac || 0) >= 0.95 };
        }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 100);
      }
      detectAndMaybeAuto();
      startRacePoll();
      setTimeout(function () { detectAndMaybeAuto(true); }, 2200);
      setTimeout(function () { detectAndMaybeAuto(true); }, 5000);
      try {
        if (window.matchMedia) {
          var mq = matchMedia('(prefers-color-scheme: dark)');
          if (mq.addEventListener) mq.addEventListener('change', function () { if (S.open) applyAppearance(); });
        }
      } catch (e) {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 350);
})();
