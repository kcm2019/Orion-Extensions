// Harness for orion-beautiful-reader — reader-core pure logic + reader.js load smoke. Not shipped.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const coreSrc = fs.readFileSync(__dirname + '/../reader-core.js', 'utf8');
const sandbox = { console, URL };
vm.createContext(sandbox);
vm.runInContext(coreSrc, sandbox);
const C = sandbox.BRCore;
assert.ok(C, 'BRCore exported');

// 1. Theme: follow system picks light/dark pair
{
  const s = { followSystem: true, lightTheme: 'paper', darkTheme: 'oled', lockedTheme: 'sepia' };
  assert.strictEqual(C.resolveThemeId(s, null, false), 'paper');
  assert.strictEqual(C.resolveThemeId(s, null, true), 'oled');
  console.log('PASS 1 follow-system theme pair');
}
// 2. Theme: follow off -> locked theme regardless of system
{
  const s = { followSystem: false, lightTheme: 'paper', darkTheme: 'oled', lockedTheme: 'sepia' };
  assert.strictEqual(C.resolveThemeId(s, null, false), 'sepia');
  assert.strictEqual(C.resolveThemeId(s, null, true), 'sepia');
  console.log('PASS 2 locked theme when follow-system off');
}
// 3. Theme: per-site theme wins over system and lock ("unless specified")
{
  const s = { followSystem: true, lightTheme: 'paper', darkTheme: 'slate', lockedTheme: 'paper' };
  assert.strictEqual(C.resolveThemeId(s, { theme: 'sepia' }, true), 'sepia');
  const s2 = { followSystem: false, lockedTheme: 'light' };
  assert.strictEqual(C.resolveThemeId(s2, { theme: 'oled' }, false), 'oled');
  console.log('PASS 3 per-site theme overrides system/lock');
}
// 4. effectiveSettings: defaults + global + per-site typography merge (G)
{
  const e1 = C.effectiveSettings(null, null);
  assert.strictEqual(e1.font, 'website'); assert.strictEqual(e1.fontSize, 19); assert.strictEqual(e1.width, 'standard');
  const e2 = C.effectiveSettings({ font: 'georgia', fontSize: 20 }, { font: 'iowan', fontSize: 22 });
  assert.strictEqual(e2.font, 'iowan'); assert.strictEqual(e2.fontSize, 22);
  const e3 = C.effectiveSettings({ font: 'georgia' }, { width: 'wide' });
  assert.strictEqual(e3.font, 'georgia'); assert.strictEqual(e3.width, 'wide');
  console.log('PASS 4 per-site typography merges over global');
}
// 5. Detection thresholds
{
  assert.strictEqual(C.isReadable({ textLength: 4000, paragraphCount: 12, linkDensity: 0.1 }), true);
  assert.strictEqual(C.isReadable({ textLength: 300, paragraphCount: 12, linkDensity: 0.1 }), false);
  assert.strictEqual(C.isReadable({ textLength: 4000, paragraphCount: 2, linkDensity: 0.1 }), false);
  assert.strictEqual(C.isReadable({ textLength: 4000, paragraphCount: 12, linkDensity: 0.8 }), false);
  console.log('PASS 5 isReadable thresholds');
}
// 6. Candidate scoring punishes link density, rewards paragraphs
{
  const good = C.scoreCandidate({ textLength: 5000, paragraphCount: 15, linkDensity: 0.05 });
  const nav = C.scoreCandidate({ textLength: 5000, paragraphCount: 15, linkDensity: 0.9 });
  assert.ok(good > nav);
  assert.strictEqual(C.scoreCandidate({ textLength: 5000, paragraphCount: 0, linkDensity: 0 }), 0);
  console.log('PASS 6 candidate scoring');
}
// 7. Reading time + word count
{
  assert.strictEqual(C.countWords('one two  three\nfour'), 4);
  assert.strictEqual(C.countWords(''), 0);
  assert.strictEqual(C.readingTimeMinutes(200), 1);
  assert.strictEqual(C.readingTimeMinutes(201), 2);
  assert.strictEqual(C.readingTimeMinutes(0), 0);
  console.log('PASS 7 reading time / word count');
}
// 8. Next page: rel=next wins
{
  const links = [
    { href: 'https://ex.com/story', rel: '', text: 'Home' },
    { href: 'https://ex.com/story/2', rel: 'next', text: '' }
  ];
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story', links), 'https://ex.com/story/2');
  console.log('PASS 8 rel=next wins');
}
// 9. Next page: page-number increment (query + path forms)
{
  const links = [{ href: 'https://ex.com/story?page=3', rel: '', text: '3' }, { href: 'https://ex.com/other', rel: '', text: 'x' }];
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story?page=2', links), 'https://ex.com/story?page=3');
  const links2 = [{ href: 'https://ex.com/story/page/2/', rel: '', text: '2' }];
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story/page/1/', links2), 'https://ex.com/story/page/2/');
  console.log('PASS 9 next page by number increment');
}
// 10. Next page: "Next" text fallback, same-origin only, null when none
{
  const links = [{ href: 'https://ex.com/story-p2', rel: '', text: 'Next ›' }];
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story', links), 'https://ex.com/story-p2');
  const cross = [{ href: 'https://ads.com/story-p2', rel: '', text: 'Next' }];
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story', cross), null);
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story', [{ href: 'https://ex.com/about', rel: '', text: 'About' }]), null);
  assert.strictEqual(C.findNextPageUrl('https://ex.com/story', []), null);
  console.log('PASS 10 next-text fallback + origin guard + null');
}
// 11. getPageNumber forms
{
  assert.strictEqual(C.getPageNumber('https://ex.com/a?page=4'), 4);
  assert.strictEqual(C.getPageNumber('https://ex.com/a/page/3/'), 3);
  assert.strictEqual(C.getPageNumber('https://ex.com/a/2'), 2);
  assert.strictEqual(C.getPageNumber('https://ex.com/a'), 1);
  console.log('PASS 11 getPageNumber');
}
// 12. Markdown export: structure
{
  const md = C.blocksToMarkdown([
    { type: 'heading', level: 2, text: 'Section One' },
    { type: 'paragraph', text: 'Hello   world.' },
    { type: 'image', src: 'https://ex.com/i.jpg', caption: 'A photo' },
    { type: 'list', ordered: false, items: ['one', 'two'] },
    { type: 'list', ordered: true, items: ['first'] },
    { type: 'quote', text: 'Wise words' },
    { type: 'code', text: 'const x = 1;' },
    { type: 'table', rows: [['A', 'B'], ['1', '2']] },
    { type: 'pagebreak', page: 2 }
  ], { title: 'My Article', byline: 'Jane', url: 'https://ex.com/a' });
  assert.ok(md.startsWith('# My Article'));
  assert.ok(md.includes('## Section One'));
  assert.ok(md.includes('Hello world.'));
  assert.ok(md.includes('![A photo](https://ex.com/i.jpg)'));
  assert.ok(md.includes('- one'));
  assert.ok(md.includes('1. first'));
  assert.ok(md.includes('> Wise words'));
  assert.ok(md.includes('```\nconst x = 1;\n```'));
  assert.ok(md.includes('| A | B |'));
  assert.ok(md.includes('| --- | --- |'));
  console.log('PASS 12 markdown structure');
}
// 13. Full export appends highlights + notes (D)
{
  const md = C.fullExport([{ type: 'paragraph', text: 'Body.' }], { title: 'T' },
    [{ text: 'key sentence', note: 'remember this' }, { text: 'plain one', note: '' }]);
  assert.ok(md.includes('## Highlights'));
  assert.ok(md.includes('> key sentence'));
  assert.ok(md.includes('— Note: remember this'));
  assert.ok(md.includes('> plain one'));
  assert.strictEqual(C.highlightsToMarkdown([]), '');
  console.log('PASS 13 export includes highlights/notes');
}
// 14. sanitizeUrl / hostOf / slugify
{
  assert.strictEqual(C.sanitizeUrl('javascript:alert(1)', 'https://ex.com/'), '');
  assert.strictEqual(C.sanitizeUrl('/rel/path', 'https://ex.com/a'), 'https://ex.com/rel/path');
  assert.strictEqual(C.sanitizeUrl('data:image/png;base64,x', 'https://ex.com/'), '');
  assert.strictEqual(C.hostOf('https://www.nytimes.com/2026/x'), 'nytimes.com');
  assert.strictEqual(C.slugify('Hello, World! 2026'), 'hello-world-2026');
  console.log('PASS 14 sanitize/host/slug');
}
// 15. Themes/fonts sanity: 5 themes, dark flags correct, accent is #0A84FF everywhere
{
  const ids = Object.keys(C.THEMES);
  assert.strictEqual(ids.length, 5);
  assert.strictEqual(C.THEMES.slate.dark, true);
  assert.strictEqual(C.THEMES.oled.dark, true);
  assert.strictEqual(C.THEMES.paper.dark, false);
  ids.forEach((id) => assert.strictEqual(C.THEMES[id].accent, '#0A84FF'));
  assert.ok(C.FONTS.newyork && C.FONTS.sanfrancisco && C.FONTS.charter && C.FONTS.georgia && C.FONTS.iowan && C.FONTS.palatino && C.FONTS.athelas && C.FONTS.seravek && C.FONTS.times && C.FONTS.hyper && C.FONTS.mono);
  assert.strictEqual(C.WIDTHS.standard, 680);
  console.log('PASS 15 theme/font tables');
}
// 16. reader.js loads clean with document still loading (no DOM touched at load)
{
  const src = fs.readFileSync(__dirname + '/../reader.js', 'utf8');
  const listeners = {};
  const sb = {
    console, URL, Promise, setTimeout: () => 0, clearTimeout: () => {},
    BRCore: C,
    document: { readyState: 'loading', addEventListener: (t, fn) => { listeners[t] = fn; } },
    location: { href: 'https://ex.com/article' }
  };
  sb.window = sb;
  sb.window.top = sb.window; sb.window.self = sb.window;
  vm.createContext(sb);
  vm.runInContext(coreSrc, sb);
  vm.runInContext(src, sb);
  assert.ok(listeners.DOMContentLoaded, 'init deferred to DOMContentLoaded');
  console.log('PASS 16 reader.js load smoke');
}

// 17. Drop cap: default off, global on, per-site override wins
{
  assert.strictEqual(C.effectiveSettings(null, null).dropCap, false);
  assert.strictEqual(C.effectiveSettings({ dropCap: true }, null).dropCap, true);
  assert.strictEqual(C.effectiveSettings({ dropCap: true }, { dropCap: false }).dropCap, false);
  assert.strictEqual(C.effectiveSettings({ dropCap: false }, { dropCap: true }).dropCap, true);
  console.log('PASS 17 drop cap setting merge');
}
// 18. printHtml (PDF export): header first, byline + date, all images, hero deduped
{
  const html = C.printHtml({
    title: 'Big Story', byline: 'Jane Doe, John Roe', date: 'November 14, 2026',
    site: 'wsj.com', url: 'https://wsj.com/x', hero: 'https://ex.com/hero.jpg',
    blocks: [
      { type: 'paragraph', text: 'First para.' },
      { type: 'image', src: 'https://ex.com/hero.jpg', caption: '' },
      { type: 'image', src: 'https://ex.com/chart.png', caption: 'A chart' },
      { type: 'heading', level: 2, text: 'Section' }
    ]
  }, C.THEMES.paper, C.FONTS.newyork.stack);
  assert.ok(html.indexOf('<h1>Big Story</h1>') > -1);
  assert.ok(html.indexOf('Jane Doe, John Roe') > -1);
  assert.ok(html.indexOf('November 14, 2026') > -1);
  assert.ok(html.indexOf('<h1>Big Story</h1>') < html.indexOf('First para.'), 'header before body');
  assert.strictEqual((html.match(/hero\.jpg/g) || []).length, 1, 'hero appears once');
  assert.ok(html.includes('https://ex.com/chart.png'), 'body image included');
  assert.ok(html.includes('A chart'));
  console.log('PASS 18 printHtml header/images');
}
// 19. escapeHtml used by print path
{
  assert.strictEqual(C.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  const html = C.printHtml({ title: 'A <script> B', blocks: [{ type: 'paragraph', text: 'x < y' }] }, null, '');
  assert.ok(!html.includes('<script> B'));
  assert.ok(html.includes('x &lt; y'));
  console.log('PASS 19 escapeHtml');
}

// 20. Legacy font keys migrate; bare-URL paragraphs detected
{
  assert.strictEqual(C.effectiveSettings({ font: 'serif' }, null).font, 'newyork');
  assert.strictEqual(C.effectiveSettings({ font: 'sans' }, null).font, 'sanfrancisco');
  assert.strictEqual(C.effectiveSettings({ font: 'book' }, null).font, 'charter');
  assert.strictEqual(C.effectiveSettings({ font: 'nonsense' }, null).font, 'newyork');
  assert.strictEqual(C.isBareUrl('https://www.wsj.com/tech/jensen-huang-a5e4499d'), true);
  assert.strictEqual(C.isBareUrl('Read more at https://ex.com/x'), false);
  assert.strictEqual(C.isBareUrl('A normal paragraph.'), false);
  console.log('PASS 20 legacy fonts + bare URL');
}

// 21. imageIdentity: CDN variants of one file share an identity (Verge fix)
{
  const a = C.imageIdentity('https://platform.theverge.com/wp-content/uploads/2026/11/drone.jpg?quality=90&strip=all&crop=0,0,100,100');
  const b = C.imageIdentity('https://platform.theverge.com/wp-content/uploads/2026/11/drone.jpg?quality=90&strip=all&crop=10,0,80,100&w=1200');
  const c = C.imageIdentity('https://platform.theverge.com/wp-content/uploads/2026/11/other.jpg?quality=90');
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.strictEqual(C.imageIdentity('not a url'), '');
  assert.strictEqual(C.imageIdentity(''), '');
  console.log('PASS 21 imageIdentity dedupes CDN variants');
}
// 21b. imageIdentity: path-decorated variants of one asset share an
// identity (v1.15.0 — GamesRadar/Future og-vs-body double); distinct
// assets and numbered siblings stay distinct.
{
  const bare = C.imageIdentity('https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc.jpg');
  assert.strictEqual(C.imageIdentity('https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc-1200-80.jpg'), bare);
  assert.strictEqual(C.imageIdentity('https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc-970x546.jpg'), bare);
  assert.strictEqual(C.imageIdentity('https://cdn.mos.cms.futurecdn.net/xZaMPm6K7aM6DTh5fDuihc.webp'), bare);
  assert.notStrictEqual(C.imageIdentity('https://cdn.mos.cms.futurecdn.net/VtJQbV92qkquEtztR6tbF5.jpg'), bare);
  const wp = C.imageIdentity('https://example.com/uploads/photo.jpg');
  assert.strictEqual(C.imageIdentity('https://example.com/uploads/photo-1024x576.jpg'), wp);
  assert.strictEqual(C.imageIdentity('https://example.com/uploads/photo_800x600.jpg'), wp);
  assert.notStrictEqual(C.imageIdentity('https://example.com/uploads/photo-1.jpg'), C.imageIdentity('https://example.com/uploads/photo-2.jpg'));
  assert.notStrictEqual(C.imageIdentity('https://example.com/uploads/season-3.jpg'), C.imageIdentity('https://example.com/uploads/season-4.jpg'));
  console.log('PASS 21b imageIdentity merges decorated variants only');
}
// 22. looksLikeFilename: file-name captions dropped, real captions kept
{
  assert.strictEqual(C.looksLikeFilename('268757_2026_gift_guides_CVirginia_DADS'), true);
  assert.strictEqual(C.looksLikeFilename('IMG_2041.jpg'), true);
  assert.strictEqual(C.looksLikeFilename('photo-final_v2.webp'), true);
  assert.strictEqual(C.looksLikeFilename('A dad opening his gift'), false);
  assert.strictEqual(C.looksLikeFilename('The Antigravity A1 drone in flight'), false);
  assert.strictEqual(C.looksLikeFilename(''), false);
  console.log('PASS 22 filename caption detection');
}

// 23. Viewer math: zoom clamp + any-direction swipe dismiss
{
  assert.strictEqual(C.clampScale(0.5), 1);
  assert.strictEqual(C.clampScale(2.5), 2.5);
  assert.strictEqual(C.clampScale(99), 4);
  assert.strictEqual(C.clampScale(NaN), 1);
  assert.strictEqual(C.swipeDistance(30, 40), 50);
  assert.strictEqual(C.shouldDismissSwipe(100, 0), true);
  assert.strictEqual(C.shouldDismissSwipe(0, -95), true);
  assert.strictEqual(C.shouldDismissSwipe(-64, 64), true);
  assert.strictEqual(C.shouldDismissSwipe(40, 30), false);
  console.log('PASS 23 viewer zoom/swipe math');
}
// 24. Table caption flows into Markdown export
{
  const md = C.blocksToMarkdown([
    { type: 'tablecaption', text: 'Results by year' },
    { type: 'table', rows: [['Year', 'Sales'], ['2026', '10']] }
  ], { title: 'T' });
  assert.ok(md.includes('_Results by year_'));
  assert.ok(md.includes('| Year | Sales |'));
  console.log('PASS 24 table caption in export');
}

// 25. UI-junk detection: mashed widget/nav text vs real sentences
{
  assert.strictEqual(C.isUiJunk('GadgetsCloseGadgetsPosts from this topic will be added to your daily email digest and your homepage feed.FollowFollowSee All Gadgets'), true);
  assert.strictEqual(C.isUiJunk('Verge ShoppingCloseVerge ShoppingPosts from this topic will be added to your daily email digest and your homepage feed.FollowFollowSee All Verge Shopping'), true);
  assert.strictEqual(C.isUiJunk('This year, why not get Dad a gift or two he won’t expect?'), false);
  assert.strictEqual(C.isUiJunk('You can follow the link to see all of the photos from the trip in the gallery.'), false);
  assert.strictEqual(C.isUiJunk(''), false);
  console.log('PASS 25 UI-junk detection');
}

// 26. Byline fragments + leading strip + drop-cap target
{
  const by = 'Gunjan Banerji, Nikki Walker';
  assert.strictEqual(C.isBylineFragment('By', by), true);
  assert.strictEqual(C.isBylineFragment('| Video produced by', by), true);
  assert.strictEqual(C.isBylineFragment('July 5, 2026 at 7:00 am ET', by), true);
  assert.strictEqual(C.isBylineFragment('Gunjan Banerji', by), true);
  assert.strictEqual(C.isBylineFragment('I didn’t expect Vinod Khosla to get excited about the paper towel dispensers in his office bathrooms.', by), false);
  const blocks = [
    { type: 'paragraph', text: 'By' },
    { type: 'paragraph', text: '| Video produced by' },
    { type: 'paragraph', text: 'July 5, 2026 at 7:00 am ET' },
    { type: 'paragraph', text: 'I didn’t expect Vinod Khosla to get excited about the paper towel dispensers in his office bathrooms.' },
    { type: 'paragraph', text: 'We sat down for the interview at his office in Menlo Park, California, to talk about taxes and risk.' }
  ];
  const stripped = C.stripLeadingByline(blocks, by);
  assert.strictEqual(stripped.length, 2);
  assert.strictEqual(C.firstArticleParagraph(stripped, by), 0);
  assert.strictEqual(C.firstArticleParagraph(blocks, by), 3);
  // Fragments hiding behind a leading video/image are still stripped;
  // the media stays. And "By the pool…" is prose, not a byline.
  assert.strictEqual(C.isBylineFragment('By the pool, he waited for the others to arrive.', by), false);
  assert.strictEqual(C.isBylineFragment('By Gunjan Banerji', by), true);
  const withMedia = [
    { type: 'video', src: 'https://x/v.mp4', poster: '' },
    { type: 'paragraph', text: 'By' },
    { type: 'paragraph', text: 'July 5, 2026 at 7:00 am ET' },
    { type: 'paragraph', text: 'I didn’t expect Vinod Khosla to get excited about the paper towel dispensers in his office bathrooms.' }
  ];
  const sm = C.stripLeadingByline(withMedia, by);
  assert.strictEqual(sm.length, 2);
  assert.strictEqual(sm[0].type, 'video');
  console.log('PASS 26 byline fragments / strip / first paragraph');
}
// 27. Subtitle picking: meta description match, heading promotion, none
{
  const dek = 'The early OpenAI investor explains his qualms with America’s tax system and how AI will change our economy';
  const b1 = [
    { type: 'heading', level: 2, text: dek },
    { type: 'paragraph', text: 'I didn’t expect Vinod Khosla to get excited about the paper towel dispensers in his office bathrooms.' }
  ];
  const r1 = C.pickSubtitle(b1, { description: dek, title: 'Tech Billionaire Vinod Khosla Wants to Pay More Taxes' });
  assert.strictEqual(r1.subtitle, dek);
  assert.strictEqual(r1.blocks.length, 1);
  const r2 = C.pickSubtitle(b1, { description: '', title: 'T' });
  assert.strictEqual(r2.subtitle, dek);
  assert.strictEqual(r2.blocks.length, 1);
  const b3 = [{ type: 'paragraph', text: 'A perfectly normal opening paragraph that is not a subtitle at all, just prose.' }];
  const r3 = C.pickSubtitle(b3, { description: '', title: 'T' });
  assert.strictEqual(r3.subtitle, '');
  assert.strictEqual(r3.blocks.length, 1);
  console.log('PASS 27 subtitle picking');
}

// 28: htmlToMarkdown — preserved links become Markdown links, text intact
{
  const html = 'Read <a href="https://example.com/story" target="_blank" rel="noopener noreferrer">the full story</a> &amp; enjoy <b>this</b> part.';
  const md = C.htmlToMarkdown(html);
  assert.strictEqual(md, 'Read [the full story](https://example.com/story) & enjoy this part.');
  const blocks = [{ type: 'paragraph', text: 'Read the full story & enjoy this part.', html }];
  assert.ok(C.blocksToMarkdown(blocks, {}).includes('[the full story](https://example.com/story)'));
  console.log('PASS 28 htmlToMarkdown');
}

// 29: isHomepagePath — site roots are indexes, not articles
{
  assert.strictEqual(C.isHomepagePath('/'), true);
  assert.strictEqual(C.isHomepagePath(''), true);
  assert.strictEqual(C.isHomepagePath('/index.html'), true);
  assert.strictEqual(C.isHomepagePath('/tech/ai/some-story'), false);
  assert.strictEqual(C.isHomepagePath('/gadgets/'), false);
  console.log('PASS 29 isHomepagePath');
}

// 30: socialFromUrl — post URLs become official embeds; embeds pass through
{
  const x = C.socialFromUrl('https://x.com/someuser/status/1234567890123456789');
  assert.strictEqual(x.platform, 'x');
  assert.strictEqual(x.embedUrl, 'https://platform.twitter.com/embed/Tweet.html?id=1234567890123456789');
  const tw = C.socialFromUrl('https://twitter.com/a/status/42');
  assert.strictEqual(tw.embedUrl, 'https://platform.twitter.com/embed/Tweet.html?id=42');
  const ig = C.socialFromUrl('https://www.instagram.com/p/ABCdef123_-/');
  assert.strictEqual(ig.embedUrl, 'https://www.instagram.com/p/ABCdef123_-/embed');
  const reel = C.socialFromUrl('https://www.instagram.com/reel/XYZ789/');
  assert.strictEqual(reel.embedUrl, 'https://www.instagram.com/reel/XYZ789/embed');
  const tt = C.socialFromUrl('https://www.tiktok.com/@user/video/7300000000000000000');
  assert.strictEqual(tt.embedUrl, 'https://www.tiktok.com/embed/v2/7300000000000000000');
  const fb = C.socialFromUrl('https://www.facebook.com/somepage/posts/987654321');
  assert.strictEqual(fb.platform, 'facebook');
  assert.ok(fb.embedUrl.startsWith('https://www.facebook.com/plugins/post.php?href='));
  const emb = C.socialFromUrl('https://platform.twitter.com/embed/Tweet.html?id=7');
  assert.strictEqual(emb.embedUrl, 'https://platform.twitter.com/embed/Tweet.html?id=7');
  assert.strictEqual(C.socialFromUrl('https://example.com/some/article'), null);
  assert.strictEqual(C.socialFromUrl('https://www.youtube.com/watch?v=abc'), null);
  const md = C.blocksToMarkdown([{ type: 'social', platform: 'x', label: 'X', url: 'https://x.com/u/status/1', text: 'Hello world', author: 'User (@u)' }], {});
  assert.ok(md.includes('[View post on X](https://x.com/u/status/1)'));
  console.log('PASS 30 socialFromUrl');
}

// 31: isLegalBoilerplate — consent/privacy text flagged, journalism not
{
  const notice = 'This Privacy Notice describes how we collect and use your personal information. We use cookies and similar tracking technologies to personalize content and ads, and by clicking Accept you consent to our use of cookies as described in our Cookie Policy.';
  assert.strictEqual(C.isLegalBoilerplate(notice), true);
  const notice2 = 'Under the GDPR and CCPA, California residents have rights regarding their personal data, including the right to opt out of the sale of personal information to third parties and advertising partners who process your data.';
  assert.strictEqual(C.isLegalBoilerplate(notice2), true);
  const article = 'Tesla is doubling down on its bold claims of an autonomous future. The price of a Cybercab is listed at $29,990, plus a mandatory $299-a-month subscription that owners must keep paying if they want the car to drive itself around the city.';
  assert.strictEqual(C.isLegalBoilerplate(article), false);
  const short = 'See our Privacy Policy for details.';
  assert.strictEqual(C.isLegalBoilerplate(short), false); // too short to judge
  console.log('PASS 31 isLegalBoilerplate');
}

// 32: splitArticleBody — blob becomes paragraphs, breaks respected
{
  const blob = 'First sentence of the story is here now. Second sentence follows with more detail about the numbers involved. Third sentence adds a quote from the chief executive of the company. Fourth sentence explains the background of the dispute in full. Fifth sentence describes what analysts said on Tuesday morning. Sixth sentence notes the market reaction was muted overall. Seventh sentence looks ahead to what happens next quarter. Eighth sentence wraps up the whole account neatly.';
  const paras = C.splitArticleBody(blob);
  assert.ok(paras.length >= 2, 'blob splits into multiple paragraphs, got ' + paras.length);
  assert.ok(paras.join(' ').includes('Eighth sentence wraps up'));
  const broken = C.splitArticleBody('Para one is here.\n\nPara two is here.\n\nPara three is here.');
  assert.strictEqual(broken.length, 3);
  assert.strictEqual(C.splitArticleBody('').length, 0);
  console.log('PASS 32 splitArticleBody');
}

// 33: website font is the default and survives settings resolution
{
  assert.strictEqual(C.DEFAULT_SETTINGS.font, 'website');
  assert.ok(C.FONTS.website && C.FONTS.website.label === 'Website Font');
  assert.strictEqual(C.effectiveSettings({}, null, false).font, 'website');
  assert.strictEqual(C.effectiveSettings({ font: 'georgia' }, null, false).font, 'georgia');
  assert.strictEqual(Object.keys(C.FONTS)[0], 'website'); // listed first
  console.log('PASS 33 website font default');
}

// 34: pickSubtitle — the page's own dek beats a differing meta description
{
  const dek = 'The chip giant is tightening the purse strings after years of writing blank checks for the AI buildout.';
  const blocks = [
    { type: 'heading', level: 2, text: dek },
    { type: 'paragraph', text: 'First paragraph of the story proper, which goes on at some length about the numbers and the people involved in the decision.' }
  ];
  const r = C.pickSubtitle(blocks, { title: 'Nvidia Tightens Up', description: 'News, analysis and comment from the Financial Times, the world\u2019s leading global business publication.' });
  assert.strictEqual(r.subtitle, dek);
  assert.strictEqual(r.blocks.length, 1); // dek lifted out of the body
  // No dek: the meta description is still used.
  const r2 = C.pickSubtitle([{ type: 'paragraph', text: 'Body text starts immediately here without any heading in front of it at all, just prose.' }],
    { title: 'T', description: 'A perfectly good summary of the article that a reader would recognise as the standfirst text.' });
  assert.strictEqual(r2.subtitle, 'A perfectly good summary of the article that a reader would recognise as the standfirst text.');
  console.log('PASS 34 pickSubtitle dek-first');
}

// 35: splitCaptionCredit — credits split off, prose left alone
{
  const s = C.splitCaptionCredit('Nico Caprez is vice president of global AI infrastructure growth at Nvidia. JACQUELYN MARTIN/AP');
  assert.ok(s, 'WSJ-style caption splits');
  assert.strictEqual(s.credit, 'JACQUELYN MARTIN/AP');
  assert.ok(s.text.startsWith('Nico Caprez is vice president'));
  const s2 = C.splitCaptionCredit('The dam at dawn, before the crews arrived for the day. Photo by Jane Cooper');
  assert.ok(s2 && /Jane Cooper/.test(s2.credit), 'Photo by form splits: ' + JSON.stringify(s2));
  assert.strictEqual(C.splitCaptionCredit('The rocket lifted off from NASA on Tuesday morning carrying a crew of four.'), null);
  assert.strictEqual(C.splitCaptionCredit('He works at the FBI building downtown.'), null);
  assert.strictEqual(C.splitCaptionCredit('Short.'), null);
  console.log('PASS 35 splitCaptionCredit');
}

// 36: quoteDuplicatesText — pull quotes detected, real quotes not
{
  const paras = ['The minister said the plan would create thousands of jobs across the region over the next five years, and that the funding was already secured in the budget.'];
  assert.strictEqual(C.quoteDuplicatesText('The plan would create thousands of jobs across the region over the next five years', paras), true);
  assert.strictEqual(C.quoteDuplicatesText('We are absolutely not going to raise taxes this year, whatever happens next', paras), false);
  assert.strictEqual(C.quoteDuplicatesText('Too short', paras), false);
  console.log('PASS 36 quoteDuplicatesText');
}

// 37: new playback/view defaults exist
{
  assert.strictEqual(C.DEFAULT_SETTINGS.textOnly, false);
  assert.strictEqual(C.DEFAULT_SETTINGS.ttsRate, 1);
  assert.strictEqual(C.DEFAULT_SETTINGS.scrollSpeed, 40);
  console.log('PASS 37 v1.9 defaults');
}

// 38: pickSubtitle — a short leading PARAGRAPH dek (the Verge
// renders its dek as a plain paragraph) is promoted over the
// meta description when a much longer lede follows; a normal
// opening paragraph is left alone.
{
  const dek = 'Duet is a decent helper, if a little jumpy at times.';
  const lede = 'Normally, the products I test do not offer to help me write up my experience with them, but this one is different in almost every way that matters.';
  const blocks = [
    { type: 'paragraph', text: dek },
    { type: 'image', src: 'https://img.example/x.jpg' },
    { type: 'paragraph', text: lede },
    { type: 'paragraph', text: lede + ' More.' }
  ];
  const r = C.pickSubtitle(blocks, { title: 'Some Story', description: 'A wire summary that differs from the dek the author wrote for the page itself, at length.' });
  assert.strictEqual(r.subtitle, dek);
  assert.strictEqual(r.blocks.length, 3);
  assert.strictEqual(r.blocks[0].type, 'image');
  // Guard: two comparable paragraphs — no promotion.
  const plain = [
    { type: 'paragraph', text: 'The city council voted on Tuesday night to approve the new budget after a long and heated public debate.' },
    { type: 'paragraph', text: 'Residents who spoke at the meeting were split, with some praising the plan and others warning about costs.' }
  ];
  const r2 = C.pickSubtitle(plain, { title: 'T', description: '' });
  assert.strictEqual(r2.subtitle, '');
  assert.strictEqual(r2.blocks.length, 2);
  console.log('PASS 38 pickSubtitle paragraph dek');
}

console.log('ALL 38 TESTS PASS');
