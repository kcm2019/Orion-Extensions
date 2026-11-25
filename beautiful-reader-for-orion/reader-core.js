// Beautiful Reader for Orion — pure logic core. No DOM access.
// Loaded before reader.js; also loaded by tests/harness.js in a vm.
'use strict';
(function (root) {
  var THEMES = {
    paper: { label: 'Paper', dark: false, bg: '#FAF8F2', surface: '#FFFFFF', text: '#1D1D1F', secondary: '#6E6E73', faint: '#E7E2D6', codeBg: '#F0EBDD', mark: '#FFE98A', accent: '#0A84FF' },
    light: { label: 'Pure Light', dark: false, bg: '#FFFFFF', surface: '#FFFFFF', text: '#111111', secondary: '#6E6E73', faint: '#EDEDEF', codeBg: '#F2F2F7', mark: '#FFE98A', accent: '#0A84FF' },
    sepia: { label: 'Sepia', dark: false, bg: '#F3EAD3', surface: '#F8F1DE', text: '#43331F', secondary: '#8A7554', faint: '#E3D5B3', codeBg: '#EADFC2', mark: '#FFD964', accent: '#0A84FF' },
    slate: { label: 'Slate Dark', dark: true, bg: '#1C1C1E', surface: '#2C2C2E', text: '#F2F2F7', secondary: '#98989F', faint: '#38383A', codeBg: '#2C2C2E', mark: '#8A6D1F', accent: '#0A84FF' },
    oled: { label: 'OLED Black', dark: true, bg: '#000000', surface: '#121212', text: '#E9E9EE', secondary: '#8E8E93', faint: '#262628', codeBg: '#161618', mark: '#8A6D1F', accent: '#0A84FF' }
  };

  // Apple's Reader font list, plus Hyperlegible + Mono. 'website'
  // has no fixed stack: the reader adopts the page's own font,
  // resolved live by the content script.
  var FONTS = {
    website: { label: 'Website Font', stack: '' },
    newyork: { label: 'New York', stack: '"New York", ui-serif, Georgia, serif' },
    sanfrancisco: { label: 'San Francisco', stack: '-apple-system, system-ui, "Helvetica Neue", Arial, sans-serif' },
    charter: { label: 'Charter', stack: 'Charter, "Bitstream Charter", Georgia, serif' },
    georgia: { label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
    iowan: { label: 'Iowan', stack: '"Iowan Old Style", Palatino, Georgia, serif' },
    palatino: { label: 'Palatino', stack: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
    athelas: { label: 'Athelas', stack: 'Athelas, Charter, Georgia, serif' },
    seravek: { label: 'Seravek', stack: 'Seravek, -apple-system, system-ui, sans-serif' },
    times: { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
    hyper: { label: 'Hyperlegible', stack: '"Atkinson Hyperlegible", -apple-system, system-ui, Arial, sans-serif' },
    mono: { label: 'Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }
  };
  var LEGACY_FONTS = { serif: 'newyork', sans: 'sanfrancisco', book: 'charter' };

  var WIDTHS = { narrow: 560, standard: 680, wide: 840 };

  var DEFAULT_SETTINGS = {
    followSystem: true,
    lightTheme: 'paper',
    darkTheme: 'slate',
    lockedTheme: 'paper',
    font: 'website',
    fontSize: 19,
    lineHeight: 1.65,
    width: 'standard',
    dropCap: false,
    barPos: 'bottom',
    textOnly: false,
    ttsRate: 1,
    scrollSpeed: 40, // px per second for auto-scroll
    wallBreaker: true, // v1.10.0: page-level anti-adblock wall breaking (wallbreaker.js)
    translateTarget: 'en', // v1.19.0: article translation target language (Google engine)
    translateAuto: false, // v1.19.0: auto-translate on open when the article is in another language
    hideCitations: false, // v1.20.0: hide in-text citation chips ([12]) for clean reading; the reference list stays
    autoAll: false, // v1.18.5: auto-open the reader on ANY site with a detected article (popup toggle)
    socialBlock: true, // v1.21.0: social media sites are excluded by default — no pill, no auto-open there (popup toggle, ON by default)
    pillPos: null // {side:'left'|'right', top:number}
  };

  // Social media platforms excluded by default
  // (v1.21.0, Kurt's ask): the reader pill never
  // appears on these hosts and the reader never
  // auto-opens there — not via the per-site list and
  // not via All Sites — while settings.socialBlock is
  // on. Deliberate manual open from the popup still
  // works; the hard "never" tool remains the
  // blocklist. Suffix-matched like the blocklist, so
  // youtube.com also covers m.youtube.com.
  var SOCIAL_HOSTS = ['youtube.com', 'twitter.com', 'x.com', 'reddit.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'threads.net', 'linkedin.com', 'snapchat.com', 'pinterest.com', 'twitch.tv', 'bsky.app'];

  function isSocialHost(host) {
    if (!host) return false;
    for (var i = 0; i < SOCIAL_HOSTS.length; i++) {
      var e = SOCIAL_HOSTS[i];
      if (host === e || host.slice(-(e.length + 1)) === '.' + e) return true;
    }
    return false;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Per-site entries may override: theme, font, fontSize, lineHeight, width.
  function effectiveSettings(globalSettings, perSite) {
    var out = clone(DEFAULT_SETTINGS);
    var g = globalSettings || {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { if (g[k] !== undefined) out[k] = g[k]; });
    if (perSite) {
      ['font', 'fontSize', 'lineHeight', 'width', 'dropCap'].forEach(function (k) {
        if (perSite[k] !== undefined) out[k] = perSite[k];
      });
    }
    if (LEGACY_FONTS[out.font]) out.font = LEGACY_FONTS[out.font];
    if (!FONTS[out.font]) out.font = 'newyork';
    return out;
  }

  // Canonical identity of an image: origin + directory + filename
  // STEM — ignoring the query string, the extension, and any CDN
  // resize decorations suffixed to the stem (-1200-80, -970x546,
  // _1024x768, -320w). The same asset is routinely served under
  // several such variants at once: og:image carries one URL, the
  // in-body copy another (Future/GamesRadar, WordPress scaled
  // copies, Vox crops), and exact-path matching let the photo
  // render twice — head hero plus body block. Distinct assets
  // keep distinct stems (CDN ids are random), so this merges
  // variants of one photo, not neighbours in a gallery.
  function imageIdentity(url) {
    if (!url) return '';
    try {
      var u = new URL(url);
      var path = u.pathname.replace(/\/+$/, '');
      var slash = path.lastIndexOf('/');
      var dir = slash >= 0 ? path.slice(0, slash + 1) : '';
      var file = slash >= 0 ? path.slice(slash + 1) : path;
      var dot = file.lastIndexOf('.');
      var stem = dot > 0 ? file.slice(0, dot) : file;
      var prev = '';
      var guard = 0;
      while (stem !== prev && guard++ < 4) {
        prev = stem;
        stem = stem.replace(/[-_]\d{2,5}x\d{2,5}$/, '')
                   .replace(/[-_]\d{2,5}-\d{1,3}$/, '')
                   .replace(/[-_]\d{2,5}w$/, '')
                   .replace(/[-_]\d{2,5}h$/, '');
      }
      return u.origin + dir + stem;
    } catch (e) { return ''; }
  }

  // Alt text / captions that are really just a file name
  // ("268757_2026_gift_guides_CVirginia_DADS", "IMG_2041.jpg").
  function looksLikeFilename(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(t)) return true;
    if (!/\s/.test(t) && /_/.test(t) && t.length >= 10 && /^[\w\-./]+$/.test(t)) return true;
    return false;
  }

  // A paragraph that is nothing but a bare URL (sites embed their own
  // canonical/share link as text — it is not article content).
  function isBareUrl(text) {
    if (!text) return false;
    var t = String(text).trim();
    return /^https?:\/\/\S+$/.test(t);
  }

  // "System unless specified": a per-site theme wins over everything;
  // otherwise followSystem picks the light/dark pair, else the locked theme.
  function resolveThemeId(globalSettings, perSite, systemDark) {
    if (perSite && perSite.theme && THEMES[perSite.theme]) return perSite.theme;
    var g = globalSettings || {};
    var follow = g.followSystem !== undefined ? g.followSystem : DEFAULT_SETTINGS.followSystem;
    if (follow) {
      var id = systemDark ? (g.darkTheme || DEFAULT_SETTINGS.darkTheme) : (g.lightTheme || DEFAULT_SETTINGS.lightTheme);
      return THEMES[id] ? id : (systemDark ? 'slate' : 'paper');
    }
    var locked = g.lockedTheme || DEFAULT_SETTINGS.lockedTheme;
    return THEMES[locked] ? locked : 'paper';
  }

  function countWords(text) {
    if (!text) return 0;
    var m = String(text).trim().split(/\s+/).filter(Boolean);
    return m.length === 1 && m[0] === '' ? 0 : m.length;
  }

  function readingTimeMinutes(wordCount) {
    if (!wordCount || wordCount <= 0) return 0;
    return Math.max(1, Math.ceil(wordCount / 200));
  }

  // Detection decision from extraction stats.
  function isReadable(stats) {
    if (!stats) return false;
    var textLength = stats.textLength || 0;
    var paras = stats.paragraphCount || 0;
    var linkDensity = stats.linkDensity || 0;
    return textLength >= 900 && paras >= 3 && linkDensity <= 0.45;
  }

  // A candidate container's score: rewards long, paragraph-rich text,
  // punishes link-heavy (nav/listing) blocks.
  function scoreCandidate(stats) {
    if (!stats) return 0;
    var textLength = stats.textLength || 0;
    var paras = stats.paragraphCount || 0;
    var linkDensity = stats.linkDensity || 0;
    if (paras === 0) return 0;
    // The paragraph bonus saturates at 40 (v1.20.3): AP's
    // header wrapper holds ~394 teaser/nav <p>s, and the
    // uncapped bonus let that link farm outscore the
    // actual article 52k to 27k. Forty paragraphs of
    // bonus is all a real article needs to beat
    // furniture; beyond it, text mass decides.
    return textLength * (1 - linkDensity) + Math.min(paras, 40) * 120;
  }

  function sanitizeUrl(url, base) {
    if (!url) return '';
    try {
      var u = new URL(url, base || undefined);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.href;
    } catch (e) { return ''; }
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function getPageNumber(url) {
    try {
      var u = new URL(url);
      var q = u.searchParams.get('page') || u.searchParams.get('p') || u.searchParams.get('paged');
      if (q && /^\d+$/.test(q)) return parseInt(q, 10);
      var parts = u.pathname.split('/').filter(Boolean);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === 'page' && parts[i + 1] && /^\d+$/.test(parts[i + 1])) return parseInt(parts[i + 1], 10);
      }
      var last = parts[parts.length - 1];
      if (last && /^\d+$/.test(last) && parts.length > 1) return parseInt(last, 10);
      return 1;
    } catch (e) { return 1; }
  }

  // links: [{href (absolute), rel, text}] in document order.
  // Returns the absolute URL of the next page, or null.
  function findNextPageUrl(currentUrl, links) {
    if (!links || !links.length) return null;
    var cur = null;
    try { cur = new URL(currentUrl); } catch (e) { return null; }
    var curPage = getPageNumber(currentUrl);
    var i, l, href;
    // 1. rel="next" wins.
    for (i = 0; i < links.length; i++) {
      l = links[i];
      if (l.rel && /(^|\s)next(\s|$)/i.test(l.rel)) {
        href = sanitizeUrl(l.href, currentUrl);
        if (href && href !== cur.href) return href;
      }
    }
    // 2. A link whose page number is exactly curPage+1.
    for (i = 0; i < links.length; i++) {
      l = links[i];
      href = sanitizeUrl(l.href, currentUrl);
      if (!href || href === cur.href) continue;
      try {
        var u = new URL(href);
        if (u.origin !== cur.origin) continue;
        if (u.pathname === cur.pathname || /page/i.test(u.search + u.pathname)) {
          if (getPageNumber(href) === curPage + 1 && getPageNumber(href) !== 1) return href;
        }
      } catch (e) {}
    }
    // 3. Link text that plainly says "next".
    for (i = 0; i < links.length; i++) {
      l = links[i];
      var t = (l.text || '').trim();
      if (/^(next|next page|continue reading|›|»|→)\b/i.test(t) || /^next\b/i.test(t)) {
        href = sanitizeUrl(l.href, currentUrl);
        if (href && href !== cur.href) {
          try { if (new URL(href).origin === cur.origin) return href; } catch (e) {}
        }
      }
    }
    return null;
  }

  function escMd(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function blocksToMarkdown(blocks, meta) {
    var out = [];
    meta = meta || {};
    if (meta.title) out.push('# ' + escMd(meta.title), '');
    if (meta.subtitle) out.push('_' + escMd(meta.subtitle) + '_', '');
    var by = [];
    if (meta.byline) by.push(meta.byline);
    if (meta.date) by.push(meta.date);
    if (meta.url) by.push(meta.url);
    if (by.length) out.push('_' + by.join(' · ') + '_', '');
    (blocks || []).forEach(function (b) {
      if (!b) return;
      switch (b.type) {
        case 'heading':
          out.push(new Array(Math.min(6, (b.level || 2)) + 1).join('#') + ' ' + escMd(b.html ? htmlToMarkdown(b.html) : b.text), '');
          break;
        case 'paragraph': out.push(escMd(b.html ? htmlToMarkdown(b.html) : b.text), ''); break;
        case 'quote': out.push('> ' + escMd(b.html ? htmlToMarkdown(b.html) : b.text), ''); break;
        case 'image':
          if (b.src) { out.push('![' + escMd(b.caption || '') + '](' + b.src + ')', ''); if (b.caption) out.push('_' + escMd(b.caption) + '_', ''); }
          break;
        case 'list':
          (b.items || []).forEach(function (it, idx) {
            var ih = b.itemsHtml && b.itemsHtml[idx];
            out.push((b.ordered ? (idx + 1) + '. ' : '- ') + escMd(ih ? htmlToMarkdown(ih) : it));
          });
          out.push('');
          break;
        case 'code': out.push('```', String(b.text || ''), '```', ''); break;
        case 'social': {
          var bits = [];
          if (b.text) bits.push('> ' + escMd(b.text));
          if (b.author) bits.push('> — ' + escMd(b.author));
          if (bits.length) out.push(bits.join('\n>\n'), '');
          if (b.url) out.push('[View post on ' + (b.label || 'social media') + '](' + b.url + ')', '');
          break;
        }
        case 'video': if (b.src) out.push('[▶ Video](' + b.src + ')', ''); break;
        case 'embed': if (b.src) out.push('[▶ Video](' + b.src + ')', ''); break;
        case 'tablecaption': out.push('_' + escMd(b.text) + '_', ''); break;
        case 'table':
          (b.rows || []).forEach(function (row, ri) {
            out.push('| ' + row.map(escMd).join(' | ') + ' |');
            if (ri === 0) out.push('| ' + row.map(function () { return '---'; }).join(' | ') + ' |');
          });
          out.push('');
          break;
        case 'pagebreak': out.push('---', ''); break;
        case 'hr': out.push('---', ''); break;
      }
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function highlightsToMarkdown(highlights) {
    if (!highlights || !highlights.length) return '';
    var out = ['', '## Highlights', ''];
    highlights.forEach(function (h) {
      out.push('> ' + escMd(h.text));
      if (h.note) out.push('> — Note: ' + escMd(h.note));
      out.push('');
    });
    return out.join('\n');
  }

  function fullExport(blocks, meta, highlights) {
    return blocksToMarkdown(blocks, meta) + highlightsToMarkdown(highlights);
  }

  function slugify(title) {
    return String(title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'article';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Standalone printable HTML for the PDF export: header first (title,
  // byline, date), hero, then every block with its images referenced by
  // absolute URL so the print rendering includes them all.
  function printHtml(article, themeColors, fontStack) {
    var t = themeColors || THEMES.paper;
    var parts = [];
    parts.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml(article.title) + '</title><style>');
    parts.push('body{font-family:' + (fontStack || FONTS.newyork.stack) + ';color:#1D1D1F;background:#fff;margin:0;padding:36px 30px;line-height:1.65;font-size:17px}');
    parts.push('.wrap{max-width:680px;margin:0 auto}h1{font-size:30px;line-height:1.18;margin:0 0 10px;letter-spacing:-.01em}');
    parts.push('.meta{color:#6E6E73;font-size:13px;margin-bottom:24px;font-family:-apple-system,system-ui,sans-serif}');
    parts.push('.kick{color:#0A84FF;font:700 11px -apple-system,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}');
    parts.push('img{max-width:100%;height:auto;border-radius:10px;display:block;margin:22px auto}');
    parts.push('figcaption{color:#6E6E73;font-size:12.5px;text-align:center;margin-top:6px;font-family:-apple-system,system-ui,sans-serif}');
    parts.push('figure{margin:22px 0}h2{font-size:22px;margin:26px 0 10px}h3{font-size:19px;margin:22px 0 8px}p{margin:0 0 18px}');
    parts.push('blockquote{border-left:3px solid #0A84FF;margin:20px 0;padding-left:14px;color:#555;font-style:italic}');
    parts.push('pre{background:#F2F2F7;padding:12px;border-radius:10px;overflow-x:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap}');
    parts.push('table{border-collapse:collapse;width:100%;margin:18px 0;font-size:14px}td,th{border:1px solid #DDD;padding:6px 8px;text-align:left}');
    parts.push('.pb{text-align:center;color:#999;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin:30px 0}');
    parts.push('.hl{background:#FFE98A}');
    parts.push('</style></head><body><div class="wrap">');
    if (article.site) parts.push('<div class="kick">' + escapeHtml(article.site) + '</div>');
    parts.push('<h1>' + escapeHtml(article.title) + '</h1>');
    if (article.subtitle) parts.push('<p style="font-style:italic;color:#6E6E73;font-size:19px;line-height:1.5;margin:0 0 14px">' + escapeHtml(article.subtitle) + '</p>');
    if (article.heroVideo && article.heroVideo.src) parts.push('<p><a href="' + escapeHtml(article.heroVideo.src) + '">▶ Watch the video</a></p>');
    var metaBits = [];
    if (article.byline) metaBits.push(escapeHtml(article.byline));
    if (article.date) metaBits.push(escapeHtml(article.date));
    if (article.url) metaBits.push(escapeHtml(article.url));
    if (metaBits.length) parts.push('<div class="meta">' + metaBits.join(' · ') + '</div>');
    var heroId = imageIdentity(article.hero);
    var heroInBlocks = !!heroId && (article.blocks || []).some(function (b) { return b.type === 'image' && imageIdentity(b.src) === heroId; });
    if (article.hero && !heroInBlocks) parts.push('<figure><img src="' + escapeHtml(article.hero) + '"></figure>');
    (article.blocks || []).forEach(function (b) {
      if (!b) return;
      if (b.type === 'heading') parts.push('<h' + Math.min(6, Math.max(2, b.level || 2)) + '>' + (b.html || escapeHtml(b.text)) + '</h' + Math.min(6, Math.max(2, b.level || 2)) + '>');
      else if (b.type === 'paragraph') parts.push('<p>' + (b.html || escapeHtml(b.text)) + '</p>');
      else if (b.type === 'quote') parts.push('<blockquote>' + (b.html || escapeHtml(b.text)) + '</blockquote>');
      else if (b.type === 'image' && b.src) {
        parts.push('<figure><img src="' + escapeHtml(b.src) + '">' + (b.caption ? '<figcaption>' + escapeHtml(b.caption) + '</figcaption>' : '') + '</figure>');
      } else if (b.type === 'list') {
        parts.push(b.ordered ? '<ol>' : '<ul>');
        (b.items || []).forEach(function (it) { parts.push('<li>' + escapeHtml(it) + '</li>'); });
        parts.push(b.ordered ? '</ol>' : '</ul>');
      } else if (b.type === 'code') parts.push('<pre>' + escapeHtml(b.text) + '</pre>');
      else if ((b.type === 'video' || b.type === 'embed') && b.src) parts.push('<p><a href="' + escapeHtml(b.src) + '">▶ Watch the video</a></p>' + (b.poster ? '<figure><img src="' + escapeHtml(b.poster) + '"></figure>' : ''));
      else if (b.type === 'tablecaption') parts.push('<p style="color:#6E6E73;font-size:13.5px;text-align:center;margin:18px 0 6px;font-family:-apple-system,system-ui,sans-serif;font-weight:600">' + escapeHtml(b.text) + '</p>');
      else if (b.type === 'table') {
        parts.push('<table>');
        (b.rows || []).forEach(function (row, ri) {
          parts.push('<tr>' + row.map(function (c) { return '<' + (ri === 0 ? 'th' : 'td') + '>' + escapeHtml(c) + '</' + (ri === 0 ? 'th' : 'td') + '>'; }).join('') + '</tr>');
        });
        parts.push('</table>');
      } else if (b.type === 'pagebreak') parts.push('<div class="pb">Page ' + escapeHtml(String(b.page || '')) + '</div>');
    });
    parts.push('</div></body></html>');
    return parts.join('\n');
  }

  // Mashed UI-component text: button labels and widget copy concatenated
  // into a "paragraph" (topic-follow bars, share widgets, nav crumbs).
  // Real article sentences do not read like this.
  function isUiJunk(text) {
    if (!text) return false;
    var t = String(text);
    if (/posts from this topic|daily email digest|your homepage feed/i.test(t)) return true;
    if (t.length > 700) return false;
    var verbs = (t.match(/Close|Follow|See All|Sign Up|Sign In|Subscribe|Share This|Newsletter/gi) || []).length;
    if (verbs >= 3) return true;
    if (/FollowFollow|Close[A-Z]/.test(t) && verbs >= 2) return true;
    return false;
  }

  // Market-ribbon furniture: WSJ and friends run a strip of index
  // names, values and percent moves above/below the story, and the
  // harvester picks the pieces up as tiny standalone blocks
  // ("Nikkei", "59948.37", "-1.95 %"). A block that is ONLY a value,
  // ONLY an index label, or a label followed by nothing but numbers
  // is a ticker line, never prose. Labels must match the whole
  // block — "Gold rose for a third day" is a sentence, not a label.
  var TICKER_LABELS = /^(nikkei( 225)?|hang seng|shanghai( composite)?|bse sensex|sensex|dow( jones( industrial average)?)?|s&p 500|s&p\/tsx( composite)?|nasdaq( composite| 100)?|russell 2000|ftse 100|dax|cac 40|euro stoxx 50|stoxx 600|kospi|asx 200|tsx|vix|gold|silver|crude oil|brent( crude)?|bitcoin|ethereum|u\.s\. 10[ -]year|10[ -]year treasury)$/i;
  function isTickerLine(text) {
    if (!text) return false;
    var t = String(text).replace(/\s+/g, ' ').trim().replace(/:$/, '');
    if (!t || t.length > 60) return false;
    if (TICKER_LABELS.test(t)) return true;
    if (/^[-+−]?\d[\d,]*(\.\d+)?\s*%$/.test(t)) return true;              // -1.95 %
    if (/^[-+−]?\d{1,3}(,\d{3})*(\.\d+)$/.test(t)) return true;          // 59,948.37
    if (/^[-+−]?\d+\.\d+$/.test(t)) return true;                          // 59948.37
    if (/^[-+−]?\d{1,3}(,\d{3})+$/.test(t)) return true;                  // 59,948
    if (/^[-+−]?\d{5,}$/.test(t)) return true;                            // 82165
    var m = t.match(/^(.+?)\s+([-+−]?[\d][\d\s,.%+−]*)$/);                // Nikkei 59948.37 -1.95%
    if (m && TICKER_LABELS.test(m[1].trim())) return true;
    return false;
  }

  // Split a photo caption into its sentence and its credit, so the
  // credit ("JACQUELYN MARTIN/AP", "Photo by …") can be styled
  // quieter than the caption itself. Conservative: returns null
  // unless the tail is unmistakably a credit.
  function splitCaptionCredit(caption) {
    if (!caption) return null;
    var t = String(caption).replace(/\s+/g, ' ').trim();
    if (t.length < 12) return null;
    var m = t.match(/^(.*\S)\s*[·•|]?\s*((?:photo|photograph|image|credit)\s*(?:by|:)\s*.{2,60})$/i);
    if (m && m[1].length >= 8) return { text: m[1].replace(/[\s·•|]+$/, ''), credit: m[2] };
    m = t.match(/^(.*\S)\s*\(([^()]{3,60})\)$/);
    if (m && /photo|credit|\//i.test(m[2]) && m[1].length >= 8) return { text: m[1], credit: m[2] };
    m = t.match(/^(.*?[.!?])\s+([A-Z][A-Z0-9 .&'’\/-]{2,58})$/);
    if (m && !/[a-z]/.test(m[2]) && m[1].length >= 8) return { text: m[1], credit: m[2] };
    m = t.match(/^(.*\S)\s+([A-Z][A-Z .&'’]{1,40}\/[A-Z]{2,}(?:\s*\/\s*[A-Z]+)?)$/);
    if (m && !/[a-z]/.test(m[2]) && m[1].length >= 8) return { text: m[1], credit: m[2] };
    return null;
  }

  // A quote block that merely repeats a body paragraph is a
  // magazine pull quote, not a quotation — it earns display
  // styling instead of the bordered-quote treatment.
  function quoteDuplicatesText(quote, texts) {
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
    var q = norm(quote);
    if (q.length < 40) return false;
    for (var i = 0; i < (texts || []).length; i++) {
      var p = norm(texts[i]);
      if (p.length >= 40 && (p.indexOf(q) >= 0 || q.indexOf(p) >= 0)) return true;
    }
    return false;
  }

  // Section furniture that introduces OTHER stories, not this one:
  // module headers like "Most Popular News" or "What to Read Next".
  // Anchored and length-capped so a real sentence that merely
  // mentions the phrase survives.
  function isNavLabel(text) {
    if (!text) return false;
    var t = String(text).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60) return false;
    if (/^(what to read next|read next|conversation|recommended for you|most read|most emailed|trending now)$/i.test(t)) return true;
    if (/^most popular( news| opinion| stories| videos| articles)?$/i.test(t)) return true;
    if (/^editors'? picks?$/i.test(t)) return true;
    return false;
  }

  // Byline/date fragments that leak into the top of the body as their own
  // little paragraphs ("By", "| Video produced by", "July 5, 2026 at
  // 7:00 am ET"). They are furniture, not article text — and a drop cap
  // must never land on them.
  var DATE_ONLY_RE = /^(updated\s+|published\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(\s+(at\s+)?\d{1,2}:\d{2}\s*(am|pm)?(\s+[a-z]{2,5})?)?$/i;
  function isBylineFragment(text, byline) {
    if (!text) return true;
    var t = String(text).replace(/\s+/g, ' ').trim();
    if (t.length <= 2) return true;
    if (/^by$/i.test(t)) return true;
    if (t.charAt(0) === '|') return true;
    if (t.length <= 70 && /^by[\s:]/i.test(t)) {
      // "By Gunjan Banerji" is furniture; "By the pool, he waited" is prose.
      var rest = t.replace(/^by[\s:]+/i, '');
      var words = rest.split(/[\s,]+/).filter(Boolean);
      var namey = words.length >= 1 && words.length <= 6 && words.every(function (wd) { return wd === 'and' || wd === '&' || /^[A-Z]/.test(wd); });
      if (namey) return true;
      if (byline && rest.length >= 3 && byline.toLowerCase().indexOf(rest.toLowerCase()) !== -1) return true;
    }
    if (t.length <= 120 && /(video|photo|story|words|reporting)\s+produced by/i.test(t)) return true;
    if (t.length <= 90 && /^(photo|video|illustration|image|credit):/i.test(t)) return true;
    if (t.length <= 70 && DATE_ONLY_RE.test(t)) return true;
    if (byline && t.length >= 3 && t.length <= 90) {
      var b = String(byline).toLowerCase();
      if (b.indexOf(t.toLowerCase()) !== -1) return true;
      var names = b.split(/,| and /).map(function (s) { return s.trim(); }).filter(Boolean);
      for (var i = 0; i < names.length; i++) {
        if (t.toLowerCase() === names[i] || t.toLowerCase() === 'by ' + names[i]) return true;
      }
    }
    return false;
  }

  // Drop leading byline-furniture blocks. Leading media (hero image /
  // video) belongs to the header area, so fragments hiding just behind
  // it are still stripped — the media itself is kept.
  function stripLeadingByline(blocks, byline) {
    var out = blocks.slice();
    var i = 0;
    while (i < out.length && (out[i].type === 'image' || out[i].type === 'video' || out[i].type === 'embed' || out[i].type === 'hr')) i++;
    while (i < out.length && (out[i].type === 'paragraph' || out[i].type === 'heading') && isBylineFragment(out[i].text, byline)) {
      out.splice(i, 1);
    }
    return out;
  }

  // The article's subtitle / dek / standfirst. Sources: the page's meta
  // description, or a leading heading block that reads as a summary.
  // Returns { subtitle, blocks } with a promoted block removed.
  function pickSubtitle(blocks, meta) {
    meta = meta || {};
    var title = String(meta.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var desc = String(meta.description || '').replace(/\s+/g, ' ').trim();
    if (desc.length < 40 || desc.length > 420 || desc.toLowerCase() === title) desc = '';
    var norm = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
    var out = blocks.slice();
    for (var i = 0; i < Math.min(3, out.length); i++) {
      var b = out[i];
      if (b.type !== 'heading' && b.type !== 'paragraph') continue;
      var bt = norm(b.text);
      if (!bt || bt === title) continue;
      // The page's own dek wins over the meta description: the
      // description is often the site's tagline or a wire summary,
      // while a dek-length heading at the top of the body is the
      // standfirst the author actually wrote.
      if (b.type === 'heading' && b.text.length >= 40 && b.text.length <= 420) {
        out.splice(i, 1);
        return { subtitle: b.text, blocks: out };
      }
      if (desc && (bt === norm(desc) || bt.indexOf(norm(desc).slice(0, 60)) === 0 || norm(desc).indexOf(bt.slice(0, 60)) === 0)) {
        out.splice(i, 1);
        return { subtitle: desc, blocks: out };
      }
      // Some sites render the dek as a plain leading paragraph
      // (the Verge does): a short sentence right at the top,
      // followed by a much longer true lede. Promote it — it
      // still displays, as the subtitle, instead of duplicating
      // the meta description in the header.
      if (b.type === 'paragraph' && i <= 1 && b.text.length >= 40 && b.text.length <= 220) {
        var nxt = null;
        for (var j = i + 1; j < out.length; j++) {
          if (out[j].type === 'paragraph') { nxt = out[j]; break; }
          if (out[j].type === 'heading') break;
        }
        if (nxt && nxt.text.length >= b.text.length * 1.8) {
          out.splice(i, 1);
          return { subtitle: b.text, blocks: out };
        }
      }
      if (b.type === 'paragraph') break;
    }
    return { subtitle: desc, blocks: out };
  }

  // Index of the first block that is genuinely article text — the only
  // paragraph a drop cap may start on.
  function firstArticleParagraph(blocks, byline) {
    for (var i = 0; i < (blocks || []).length; i++) {
      var b = blocks[i];
      if (b.type === 'paragraph' && b.text && b.text.length >= 40 && !isBylineFragment(b.text, byline)) return i;
    }
    return -1;
  }

  // Our own generated inline HTML (links preserved from the article) back
  // to Markdown: <a href="U">T</a> -> [T](U), other tags stripped.
  function htmlToMarkdown(html) {
    var s = String(html || '');
    s = s.replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, u, t) {
      return '[' + t.replace(/<[^>]+>/g, '') + '](' + u + ')';
    });
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
    return s.replace(/\s+/g, ' ').trim();
  }

  // Legal boilerplate (privacy notices, cookie consent text, terms):
  // dense prose with almost no links — exactly the shape that can
  // outscore a real article. Two or more distinct legal markers in a
  // paragraph of any real length marks it as boilerplate.
  var LEGAL_MARKERS = [
    'privacy notice', 'privacy policy', 'cookie policy', 'cookie notice',
    'we use cookies', 'use of cookies', 'consent', 'personal data',
    'personal information', 'we collect', 'data protection', 'gdpr',
    'ccpa', 'do not sell', 'your privacy', 'privacy rights',
    'data subject', 'legitimate interest', 'tracking technologies',
    'advertising partners', 'share your information', 'process your data',
    'opt out of', 'opt-out', 'terms of use', 'terms and conditions',
    'california residents', 'privacy choices', 'information we collect',
    'how we use your', 'third-party cookies', 'third parties may'
  ];
  function isLegalBoilerplate(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
    if (t.length < 90) return false;
    var hits = 0;
    for (var i = 0; i < LEGAL_MARKERS.length; i++) {
      if (t.indexOf(LEGAL_MARKERS[i]) >= 0) { hits++; if (hits >= 2) return true; }
    }
    return false;
  }

  // Split a structured-data articleBody blob into paragraphs.
  // Publishers often embed the full story as one unbroken string in
  // JSON-LD (regwall sites especially); group its sentences into
  // readable paragraphs when it has no breaks of its own.
  function splitArticleBody(text) {
    var raw = String(text || '');
    var parts = raw.split(/\n\s*\n|\n/).map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(function (p) { return p.length > 0; });
    if (parts.length >= 2) return parts;
    var t = raw.replace(/\s+/g, ' ').trim();
    if (!t) return [];
    var sentences = t.match(/[^.!?]+[.!?]+["'”’)]?\s*/g) || [t];
    var paras = [], cur = '';
    sentences.forEach(function (s) {
      if (cur && cur.length >= 200 && cur.length + s.length > 420) { paras.push(cur.trim()); cur = ''; }
      cur += s;
    });
    if (cur.trim()) paras.push(cur.trim());
    return paras;
  }

  // Social posts: recognize a post URL (or an existing embed URL) and
  // produce the platform's official embed URL for the reader.
  // Returns { platform, label, embedUrl, postUrl } or null.
  function socialFromUrl(rawUrl) {
    var u = String(rawUrl || '');
    if (!u) return null;
    var m;
    // Already an embed URL — keep it as-is.
    if (/platform\.twitter\.com\/embed/i.test(u) || /syndication\.twitter\.com/i.test(u))
      return { platform: 'x', label: 'X', embedUrl: u, postUrl: '' };
    if (/instagram\.com\/(p|reel|reels)\/[^/]+\/embed/i.test(u))
      return { platform: 'instagram', label: 'Instagram', embedUrl: u, postUrl: '' };
    if (/facebook\.com\/plugins\/(post|video)\.php/i.test(u))
      return { platform: 'facebook', label: 'Facebook', embedUrl: u, postUrl: '' };
    if (/tiktok\.com\/embed/i.test(u))
      return { platform: 'tiktok', label: 'TikTok', embedUrl: u, postUrl: '' };
    // Post URLs — construct the embed.
    m = u.match(/(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+\/status\/(\d+)/i);
    if (m) return { platform: 'x', label: 'X', embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=' + m[1], postUrl: u };
    m = u.match(/instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]+)/i);
    if (m) {
      var kind = m[1].toLowerCase() === 'p' ? 'p' : 'reel';
      return { platform: 'instagram', label: 'Instagram', embedUrl: 'https://www.instagram.com/' + kind + '/' + m[2] + '/embed', postUrl: u };
    }
    m = u.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
    if (m) return { platform: 'tiktok', label: 'TikTok', embedUrl: 'https://www.tiktok.com/embed/v2/' + m[1], postUrl: u };
    if (/facebook\.com\//i.test(u) && /(\/posts\/|\/videos\/|permalink|\/watch\/?\?|story_fbid)/i.test(u))
      return { platform: 'facebook', label: 'Facebook', embedUrl: 'https://www.facebook.com/plugins/post.php?href=' + encodeURIComponent(u) + '&show_text=true', postUrl: u };
    return null;
  }

  // Site homepages are indexes, not articles — never offer the reader there.
  function isHomepagePath(pathname) {
    var p = String(pathname || '/');
    return /^\/(index|home)?(\.html?|\.php)?\/?$/i.test(p);
  }

  // Image viewer math.
  function clampScale(v) {
    if (!isFinite(v) || v < 1) return 1;
    return Math.min(4, v);
  }
  function swipeDistance(dx, dy) {
    return Math.sqrt((dx || 0) * (dx || 0) + (dy || 0) * (dy || 0));
  }
  function shouldDismissSwipe(dx, dy) {
    return swipeDistance(dx, dy) >= 90;
  }

  root.BRCore = {
    THEMES: THEMES, FONTS: FONTS, WIDTHS: WIDTHS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    effectiveSettings: effectiveSettings,
    resolveThemeId: resolveThemeId,
    countWords: countWords,
    readingTimeMinutes: readingTimeMinutes,
    isReadable: isReadable,
    scoreCandidate: scoreCandidate,
    sanitizeUrl: sanitizeUrl,
    hostOf: hostOf,
    getPageNumber: getPageNumber,
    findNextPageUrl: findNextPageUrl,
    blocksToMarkdown: blocksToMarkdown,
    highlightsToMarkdown: highlightsToMarkdown,
    fullExport: fullExport,
    slugify: slugify,
    escapeHtml: escapeHtml,
    printHtml: printHtml,
    isBareUrl: isBareUrl,
    imageIdentity: imageIdentity,
    looksLikeFilename: looksLikeFilename,
    isUiJunk: isUiJunk,
    SOCIAL_HOSTS: SOCIAL_HOSTS,
    isSocialHost: isSocialHost,
    isTickerLine: isTickerLine,
    isNavLabel: isNavLabel,
    splitCaptionCredit: splitCaptionCredit,
    quoteDuplicatesText: quoteDuplicatesText,
    htmlToMarkdown: htmlToMarkdown,
    socialFromUrl: socialFromUrl,
    isLegalBoilerplate: isLegalBoilerplate,
    splitArticleBody: splitArticleBody,
    isHomepagePath: isHomepagePath,
    isBylineFragment: isBylineFragment,
    stripLeadingByline: stripLeadingByline,
    pickSubtitle: pickSubtitle,
    firstArticleParagraph: firstArticleParagraph,
    clampScale: clampScale,
    swipeDistance: swipeDistance,
    shouldDismissSwipe: shouldDismissSwipe
  };
})(typeof window !== 'undefined' ? window : globalThis);
