# Beautiful Reader for Orion — v1.21.1

## What's new in v1.21.1

Site-style leak shield. Kurt's screenshot on IB
Times: under a dark reader theme, the hero image's
caption strip rendered as a white band with the
caption text washed out on top of it. Root cause,
verified in IB Times' own page CSS: the site ships
bare element rules figure{background-color:#fff}
and figcaption{background-color:#f5f5f5}. The
reader lives in the page's document, so those
rules painted the reader's figure and caption too
— the reader set the caption's text color from its
theme but never set a background, so the site's
white won. Invisible under light reader themes;
glaring under dark ones, which is why it only
showed up sometimes (dark system + Follow System).

Fix: the reader's figure, figcaption and img
elements are pinned background:transparent at ID
specificity with !important, so no site stylesheet
can paint them. These are elements the reader
never backgrounds itself (its card and table-cell
backgrounds live on classes and are untouched).

Verified against the real IB Times article (the
caption in the screenshot is its body image) and
with the site's exact rules in a fixture: figure,
caption and image backgrounds now compute to
transparent and the caption takes the theme color.
New suite e2e-leakshield.js (7 checks); full
battery 42 suites green.


## What's new in v1.21.0

Social media sites are excluded by default
(Kurt's ask). A new popup toggle, "Skip Social
Media Sites" — in the extension icon menu, ON by
default — covers YouTube, Twitter/X, Reddit,
Instagram, Facebook, TikTok, Threads, LinkedIn,
Snapchat, Pinterest, Twitch and Bluesky, including
their subdomains (m.youtube.com, old.reddit.com).

While it is on, those sites get no reader pill and
no auto-open — not via the per-site Always Use
Reader list and not via the All Sites toggle. The
exclusion is total, not cosmetic: detection never
runs there, the fast-draw extraction cache is
dropped, and the wall race / sanctuary auto-open
paths stand down too. Deliberate manual open from
the popup's Reader Mode toggle still works — the
hard "never" tool remains the blocklist (YouTube
stays on that seeded list as well, so it is doubly
covered). The popup shows a short note when the
current tab is a covered social site. Turn the
toggle off and social sites behave like any other
site again.

New suite e2e-social.js (21 checks): host matcher
(subdomains, lookalike domains), no pill / no
auto-open on Reddit and m.youtube.com under
defaults and under All Sites, release when the
toggle is off, and the popup toggle + note wiring.
Full battery 41 suites green.


## What's new in v1.20.3

AP News (and every Brightspot-CMS site) fixed.
Kurt's report on an AP investigation: "All of the
many links on the site gets captured above the
article text." Reproduced on the real page and
measured: the extractor's winning candidate was
the page HEADER wrapper — it holds ~394 teaser and
nav <p>s, and the scoring formula's uncapped
paragraph bonus (paras x 120) let that wrapper,
at 89% link density, outscore the actual <main>
52,577 to 26,856. Its 269-link section nav became
the reader's first two blocks; the article also
reported readable: false (link density 0.888).

Five fixes, all general:
- The paragraph bonus in scoreCandidate saturates
  at 40 paragraphs; beyond that, text mass decides.
- A candidate over 0.6 link density is furniture
  by definition and is disqualified outright.
- Lists whose items are >=75% link text are
  skipped (navigation, link rails); reference
  lists exempt. List blocks also dedupe now — the
  AP nav appeared twice.
- A short paragraph or loose run that is entirely
  one link is a link card, not prose (AP threads
  related-story headlines through the body).
- "promo" now matches as a substring in the skip
  check: camelCase classes like Brightspot's
  PagePromo defeated the separator-bounded pattern,
  so promo cards (thumbnail + headline) walked in.
  They now skip as a unit.

Verified on the real AP page (archived snapshot):
the reader now opens on the lede, link density
0.015, readable, no nav, no promo headlines, story
intact at 1,662 words. New regression suite
e2e-apnews.js (9 checks) replicates the template;
full battery 40 suites green.


## What's new in v1.20.2

Two refinements from Kurt's first v1.20.1 session
(Nov 22):

Contents box placement. The in-article Contents
card now sits ABOVE the first paragraph (v1.20.1
had it below the opening paragraph, per the
original spec; Kurt reversed it after seeing it
live). On Wikipedia the infobox still renders
above it, since the infobox block precedes the
first paragraph. Everything else about the box is
unchanged: 3+ headings, always starts collapsed,
header tap opens it, entry taps unfold folded
sections on the way.

Disclosure chevrons, redrawn. The section collapse
button was a text ▾ glyph sitting small and
off-center inside a heavy dark circle (Kurt's
screenshot). All three disclosure chevrons — the
section buttons, the Contents header, the navbox
header — are now one shared stroked SVG chevron,
properly centered in a smaller, lighter 28px
circle (section buttons), pointing down when
open and rotating to point right when closed.

Verified: e2e-v1201 updated for the new placement
(15 checks, incl. box above the first paragraph on
both fixtures and the SVG in the section button);
full battery 39 suites green.


## What's new in v1.20.1

Four follow-ups to the Wikipedia release, all Kurt's
asks from Nov 22:

Contents box. Every article with 3+ headings gets an
in-article Contents card below the opening paragraph
and the infobox (the "summary info box") when one
sits up top — always collapsed by default, opening
only when its header is tapped. Entries mirror the
heading registry; tapping one expands any folded
ancestor sections and jumps, like the Contents sheet.

Link taps actually open links. Kurt: tapping any
link in the reader did nothing (long-press only) —
the v1.18.6 window.open answer was not enough on
Orion. Taps now go through openLink(): the
background page opens a real tab via tabs.create
(br-background.js answers br:openTab), window.open
is the second door, same-tab navigation the last.
Clean pointer taps on links are also handled on
pointerup, like image taps since v1.15.1, with a
900 ms stamp keeping the two paths to one tab.

Footnote links. Citation chips now also carry the
note as sanitized HTML (data-notehtml, captured by
re-running inlineHtml on the target with fragment
backlinks unwrapped and a recursion guard); the
footnote popup renders it, so a reference's own
links — DOIs, source links — are tappable and go
through openLink() too.

Wikipedia media, hardened. Figures wrap Wikipedia's
audio/video files exactly like images, and figure
media used to vanish outright; now media wins the
figure, with its caption. Galleries include video
and audio files as players with posters; infobox
cells holding media (an anthem, a spoken sample)
render a playable row; a video whose format WebKit
cannot decode (ogv-only files) falls back to its
poster with a watch-on-the-original-page note.

Global blocklist. br.blocklist.v1: sites where the
reader never activates — no pill, no auto-open, and
openReader/forceOpenReader refuse. The list
OVERRIDES the popup's force-enable (Reader Mode)
toggle, per spec. Seeded once with youtube.com and
wsj.com; entries cover subdomains (m.youtube.com).
Block a site from inside the reader (Aa → This
Site → Never Open Reader on This Site — closes the
reader, drops the pill, removes the site from
Always Open); manage it in the extension menu,
which shows a Blocked Sites section, disables
Reader Mode on blocked sites, and unblocks.
(Consequence: the WSJ extraction suite now empties
the list up front to keep testing extraction.)

Verified: new suites e2e-v1201.js (13 checks),
e2e-v1202.js (17 checks), e2e-blocklist.js (17
checks, content + popup); full battery 39 suites
green.


## What's new in v1.20.0

First-class Wikipedia, and collapsible sections
everywhere. Kurt's picks: Core + A B C D E, with the
collapsible-headings design as proposed (start
expanded, tap to fold, folds remembered per article).

Wikipedia mode (auto-detected on Wikimedia hosts
and any MediaWiki page):
- Title fixed: the visible-h1 gate dropped from 15
  to 4 chars — "Stop Cop City" (13) used to fall
  back to the JSON-LD headline, which on Wikipedia
  is the short DESCRIPTION, so articles were titled
  things like "American social movement". That text
  is now the subtitle, where it belongs.
- Hatnotes kept as styled note lines; the infobox
  renders as a card (title, photo, caption,
  label/value rows, section headers, map images)
  instead of a raw table with its photos trapped
  inside; Wikipedia's own TOC list no longer leaks
  into the body (the reader's TOC covers it);
  "Retrieved from..." and print-footer junk stripped.
- Citations: the chips already existed, but their
  note text was scooped with raw textContent and
  opened with the reflist's CSS block as the "note"
  — notes are now skip-aware text. The reference
  list itself renders compact (.br-reflist).
- A: galleries become swipeable snap rows with
  captions. B: audio/video in flow — multi-source
  elements pick the most playable file (mp4 > webm
  > ogv), audio (pronunciations) renders as a
  player, and media riding inside a paragraph is
  harvested instead of vanishing with it.
  C: data tables get a styled, sideways-scrolling
  treatment (header row, striping). D: navboxes
  become one collapsed "Browse related" card.
  E: a Hide Citations switch (Aa menu, next to
  Text Only) hides the [12] chips; the reference
  list stays.

Collapsible headings (all articles): each heading
wraps its section in .br-asec; tapping the heading
or its chevron folds everything under it until the
next same-level heading (subsections nest). Folds
persist per article in the progress record
(saveProgress and saveCollapsed preserve each
other's fields), and a TOC jump expands the
target's ancestor chain before scrolling.
insertLateImages now searches descendants for
data-brk anchors and inserts within the right
section, since blocks no longer sit at the top
level of the article body.

Verified: new suite tests/e2e-v1200.js (26 checks)
plus a 17-point check against the real Stop Cop
City HTML (title/subtitle, infobox 12 rows + image,
134 clean chips, fold + persistence on the rendered
DOM). Full battery: 36 suites green.


## What's new in v1.19.3

Business Insider opened with no article body at all
— byline, slogan headings and the author bio, but
not one story paragraph. Diagnosed on the article's
actual HTML:

- **The rescue walk's trigger was too weak.** BI
  wraps the whole story in a <div class="image-modal">,
  which the first walk prunes by name. What it
  harvested instead — 149 words of furniture — still
  passed the readability gates, so the rescue walk
  (which only ran below 400 harvested chars) and
  the JSON-LD fallback (which only runs when the
  result is NOT readable) both stayed off. The
  trigger is now relative: if the walk kept less
  than half the paragraph text the winning
  candidate's own stats counted, a major subtree
  was pruned and the rescue walk runs, descending
  into skipped containers that are themselves
  article-like (the image-modal div's stats are:
  7k chars, 3% links, no boilerplate). On the real
  page: 149 words of junk -> 1,145 words, the full
  story from the 2 a.m. lede to the closing
  no-comment line, headings and images intact.
- **Card rails pruned by name, repeated headings
  dropped.** 'read-next' joins the skip names, and
  the cleanup pass now drops a heading whose text
  exactly repeats an earlier heading — BI's
  read-next touts carry the site slogan as their
  <h3> placeholder four times over; a real story
  never repeats a section heading verbatim.

New regression suite: tests/e2e-v1193.js (7 checks;
fails detection entirely on the v1.19.2 code).
Rest of the battery green, including e2e-rescue
and e2e-bi-late.


## What's new in v1.19.2

PC Gamer (and the whole Future plc template family)
got no pill at all — the page read as a white screen
with no reader. Diagnosed on the article's actual
HTML, two extraction bugs:

- **Script text poisoned the article scoring.**
  candidateStats counted <script>/<style> text as
  loose paragraphs. PC Gamer embeds ~39k chars of
  JSON/config inside its <article>; those blobs are
  full of 'consent'/'privacy', so 26.6k chars were
  flagged as legal boilerplate, boilerRatio hit
  0.61, and every candidate on the page failed the
  boiler gate — no detection, no pill. Raw-text
  elements (script/style/noscript/template) are no
  longer treated as prose containers. After the
  fix the article extracts cleanly: hero image,
  all six story paragraphs in order, second image,
  author bio.
- **A hidden modal was rescued into the article.**
  The walk's article-rescue (for mislabeled article
  containers) could override a skip on a subtree the
  page itself hides; PC Gamer's newsletter
  confirmation modal is text-heavy enough to look
  article-like, so 'You are now subscribed' /
  'Join the club' opened the extracted story. A
  declared-hidden element (hidden attribute, or
  the 'hidden' display:none utility class) is now
  a hard skip, and the rescue also refuses
  visually-hidden subtrees.

New regression suite: tests/e2e-v1192.js (7 checks;
fails 3 on the v1.19.1 code, passes on this one).
The rest of the battery's failure profile is
unchanged from the shipped v1.19.1 in the same
environment (verified side by side).


## What's new in v1.19.1

Two fixes from Kurt's Nov 21 reports:

- **X embeds actually show the post.** The card used
  X's Tweet.html widget in an iframe; on Orion/WebKit
  the widget's document loads — so the blank-embed
  watchdog stayed quiet — and then renders nothing,
  leaving a tall empty box (Instagram's embed, which
  renders server-side, worked). TechSpot embeds the
  post as a bare iframe, so there wasn't even captured
  text to fall back on. X posts are now **native
  cards**: the reader fetches the tweet from X's
  syndication JSON (the same endpoint the widget uses,
  with the widget's id-derived token — verified live
  against the TechSpot article's post) and renders
  author + avatar, the full text with t.co links
  expanded, photos whole, videos as native players
  (best MP4 ≤ 2.5 Mbps with the tweet's thumbnail as
  poster), a quoted-post box, and date/like/reply
  counts. If the fetch fails (deleted/protected post,
  no network), the card keeps whatever text was
  captured at extraction, or a plain "could not be
  loaded" note — never a void. Instagram/Facebook/
  TikTok keep the iframe + watchdog path.
- **Image viewer no longer opens half-faded.** While
  a swipe-to-dismiss drag is tracked, the viewer
  writes its own inline opacity; nothing cleared it,
  so the next image opened stuck at that partial fade
  with the reader showing through — until a tap reset
  it. First opens were always clean, which is why it
  looked intermittent. Open and close now both clear
  the stale inline opacity.

## What's new in v1.19.0

**Article translation** (Google engine — no key, no
signup), in a new **Translate** section of the gear menu:

- **Translate to …** — title, subtitle, paragraphs,
  headings, quotes, list items, table cells and image
  captions are sent to Google's translate endpoint in
  sentence-sized chunks and swapped in progressively as
  each piece lands; the source language is auto-detected.
  Blocks keep their place; links inside a translated
  paragraph are dropped (the original is one tap away).
- **Show Original** flips back instantly; the translation
  stays in memory, so flipping is free both ways.
- **17 target languages** — English, Spanish, French,
  German, Italian, Portuguese, Dutch, Polish, Russian,
  Ukrainian, Turkish, Swedish, Arabic, Hindi, Japanese,
  Korean, Chinese (Simplified).
- **(A) Auto-Translate** — when on, opening an article in
  another language translates it automatically; a probe
  of the first chunks detects "already in your language"
  and stops (and remembers, per article + language).
- **(B) Cache** — translations are stored per article +
  language (`br.translations.v1`, last 10), so re-reads
  never touch the network again.
- **(C) Saved articles** — library items translate (and
  auto-translate) exactly like live ones.

Nothing is sent anywhere until a translation runs.
Honest limits: the engine is Google's unofficial endpoint
— if it ever rate-limits or changes, translation fails
with a toast rather than silently; the table of contents
keeps the original headings until the next re-render.

## What's new in v1.18.8

**The menu gets a second door.** Orion intermittently
swallows extension toolbar popups — tap the icon and no
menu appears until the browser is restarted. The popup
webview is Orion's surface and no extension can force it
open, so the menu now also lives somewhere the extension
fully controls:

- **Long-press the pill** and the same popup menu opens
  in an in-page panel — the actual `popup.html`, embedded
  in an iframe (it's web-accessible for exactly this), so
  it's the full menu: This Site, All Sites, the Always
  Use Reader list, defaults, Saved, History. Tap outside
  or ✕ to close. (Long-press used to open Saved Articles
  directly; Saved is a tab in the panel now.)
- **If the embed doesn't come up** — the framed popup
  announces itself when it's alive; if there's no word
  within ~2.5 seconds, the panel swaps in native controls
  for the essentials (Open/Close Reader, this site's
  Always-use toggle, All Sites) instead of sitting blank.
- **The popup itself is hang-proofed.** A wedged
  extension context can leave storage calls pending
  forever, which made the native menu open blank or not
  populate. Storage and tab lookups in the popup now cap
  their wait and fall back to defaults, so the menu
  always renders.
- The page purge now exempts anything inside any
  Beautiful Reader UI surface (it already spared the
  reader's embeds), so a hostile page can't strip the
  panel's iframe either.

## What's new in v1.18.7

**Loose-text articles are detected and read.** A
TechPowerUp story got no pill, and forcing the reader
open showed the title with no body. The live page
explained why: its body is ~1,900 characters in three
paragraphs with **zero `<p>` tags** — bare text nodes
inside the `<article>` element, paragraphs separated
by `<br><br>`, inline links interspersed. Detection
counted only `<p>` text (so the page scored zero) and
the walker only visited element children (so the text
was never harvested). Both now understand loose text:

- A container's direct inline content is grouped into
  runs — a run ends at a block-level child or a double
  `<br>` — and runs of 40+ characters count as
  paragraphs in candidate stats and are harvested as
  paragraph blocks, inline links and formatting kept.
  Short runs stay furniture (dates, bylines, "Sources:"
  lines).
- Skipped subtrees (comments, related, share) stay out,
  and the skip matcher now catches plurals too —
  `class="comments"` previously slipped past the
  `comment` pattern and could leak comment text into
  the body.

A link-dense page of loose headlines still gets no
pill (verified by test), so index pages are unaffected.

## What's new in v1.18.6

**Embeds load on the reader's terms, and link taps work.**
Two field reports from the same article (thebiglead): an X
card that rendered as an empty outline, and article links
that ignored taps (long-press still worked).

- **Embed loading is deferred until the reader is safe.**
  Social and video iframes used to start loading during
  the render — and on a hostile page the kill that follows
  (`window.stop()` plus the DOM purge) aborted or outright
  removed them. The purge also had a plain bug: it removed
  every iframe in the document, including the reader's
  own. Now frames are rendered without a src, the purge
  exempts anything inside the reader, and srcs are
  assigned only after the kill has run. The embed URLs
  were already built by the reader from the post links
  (the platform's official embed endpoints), so content
  now loads from the platform directly, whatever state
  the page underneath is in.
- **No more empty social cards.** If a social frame
  hasn't loaded after ~9 seconds, it's swapped for the
  post text and author captured at extraction, with the
  View-on-platform link kept — the card always shows the
  post, one way or the other.
- **Link taps navigate.** In-article links wear
  `target="_blank"`, and a tap on one inside the reader's
  top-layer popover doesn't navigate on Orion. Taps are
  now handled deliberately: open in a new tab when the
  browser allows it, in the current tab when it doesn't.

## What's new in v1.18.5

**Auto-open everywhere, plus a tidier popup.** Two popup
changes, both in the Settings tab:

- **All Sites toggle** — a new switch in the This Site
  card, right below Reader Mode. When it's on, the reader
  opens by itself on any site where an article is
  detected, not just the sites in the Always Use Reader
  list (the list still works alongside it). It's a global
  default (`autoAll` in the shared settings), off by
  default; closing an auto-opened reader still leaves
  that page alone.
- **Always Use Reader folds up** — tap its header to
  collapse or expand the section (the chevron shows the
  state, and the popup remembers it). The add-a-site box
  moved to the top of the section, above the list.

## What's new in v1.18.4

**Website Font mode now adopts the headline's font too.**
It used to copy only the article paragraphs' font, so on
sites that set a display face on the headline and a text
face on the body — Patagonia is the reported case: a
"Copernicus" serif headline over a "Ridgeway Sans" body —
the reader title came out in the body sans. The mode now
also captures the article h1's computed font stack and
weight, and applies them to the reader's title and
standfirst (the elements that mirror the page's own
header). In-article headings keep the body stack, and
named fonts are untouched. Because the reader lives in
the same document, the site's own loaded webfont is what
renders — no substitute face. One catch to know: the
setting only takes effect when the font choice is
Website Font (globally, or per-site in the gear menu).

## What's new in v1.18.3

**Full revert to the v1.16.2 build.** The custom-graphics
experiment (v1.18.0–v1.18.2: live embeds, frozen snapshots,
scale-to-fit, div-chart detection) is scrapped, and the
v1.17.0 update checker goes with it, since both arrived
after v1.16.2. The reader code is byte-identical to the
v1.16.2 package; the version number is higher only so
Orion accepts the install over the newer builds.

## What's new in v1.16.2

**The fluid-menu experiment is reverted.** The v1.16.x
sheet morph never animated on device (the card faded, then
snapped), so the menus are back to exactly their v1.15.2
behaviour — instant view swaps, the original section
animation and sheet entrance. The reader code is
byte-identical to the v1.15.2 package; everything else from
v1.15.x (image dedupe, tap-to-view, the 🔖 save button and
the fenced section label) is untouched.

## What's new in v1.16.1

**The morph actually animates now.** On device, v1.16.0
faded the old view out and then snapped to the new height —
the inline CSS height transition never ran in Orion's
WebKit for this element. The height is now driven by the
Web Animations API (with the CSS path kept as a fallback),
and Reduced Motion no longer disables the morph outright —
Control Center still expands with it on, so the morph now
just runs shorter and without the content rise, matching
that behaviour.

## What's new in v1.16.0

**Fluid menus, modelled on the Control Center expansion.**
Switching views inside the sheet — Reader Options →
Contents, Saved Articles, Highlights, and the re-renders
when you pick an option — no longer swaps content with a
snap while the card jumps to its new height. The old view
fades, the new view is built inside the card locked at the
old height, and the card then grows or shrinks to the new
view's natural height over 380 ms on the iOS-style easing
curve while the new content rises and fades in. Closing the
menu mid-animation cancels cleanly. Section expand/collapse
was retimed to the same curve (and its bottom padding moved
inside the clipped area, so it animates with the rows
instead of fighting them), the sheet's own entrance is a
touch softer (scale .94), and everything honours
prefers-reduced-motion with instant swaps.

## What's new in v1.15.2

**Bar polish.** The Save button is now the 🔖 bookmark emoji
(matching the menu's Save Article row); when the article is
saved, the button lights up with the accent pill so the state
still reads at a glance. And the section label in the middle
of the bar can no longer slide under the buttons: it used to
be absolutely centered on the whole bar, so a long section
name ran underneath Save and the gear. It is now a flex child
living exactly in the free space between the close button and
the Save button, truncating with an ellipsis when it's long.

## What's new in v1.15.1

**Image tapping works again.** The fullscreen viewer used to
open from the article's click handler alone, and on device
that click can be swallowed by the scroll container before it
ever arrives — the tap simply did nothing. The viewer now
also opens from a clean pointer tap (press and release within
600 ms and 12 px, so scrolling past a photo never triggers
it), anywhere on the photo's figure, caption included. The
viewer's display is additionally set inline when it opens and
its stacking raised, so it cannot open invisibly.

## What's new in v1.15.0

**The doubled lead photo is fixed.** Sites like GamesRadar
(Future's CDN) serve the same photo under several URLs at once —
the og:image copy carries a resize decoration the in-body copy
doesn't (`…fDuihc-1200-80.jpg` vs `…fDuihc.jpg`). Image identity
is now the filename stem with the query, the extension and any
CDN resize suffixes (`-1200-80`, `-970x546`, `_1024x768`,
`-320w`) stripped, so every variant of one photo dedupes to a
single render — head hero vs body block, body block vs body
block, stitching and the late-image watch all use the same
identity. Genuinely different photos keep different stems and
are untouched. The extraction report now also lists the hero
URL and every image block URL, so any future double shows its
own evidence.

## What's new in v1.10.0

**The Wall Breaker is built in** — ported from the Element
Blocker extension (where it beat the gamesradar Admiral wall on
device) so Beautiful Reader now polices the page itself, whether
or not the reader is open. The reader's own sweep (v1.9.8) only
patrols during a read; this patrols always:

- **Walls:** a document_start stylesheet pre-hides wall iframes
  from error-report.com / getadmiral / admiral.digital, and a
  scanner hides any full-screen “allow ads” overlay the moment it
  appears, releases the scroll lock, and re-kills re-inserts.
- **Dialogs:** the wall's native “Please allow ads… Click OK”
  confirm fallback is suppressed inside the page — it never
  appears, and neither its OK redirect nor its Cancel reload runs.
- **Redirects:** forced navigations to the standalone wall page
  are cancelled at the network layer (new background script +
  webRequest); the tab stays on the article.
- **Blanking:** on pages where a wall already fired, an opaque
  textless veil is hidden, a force-hidden page is re-shown, and a
  wiped article is restored from a snapshot taken after load.

It stands down while the reader is open (the extracted article is
already safe, and the reader's sweep is in charge there), and it
can be switched off in the popup under Reader Defaults → Wall
Breaker. Guards keep cookie banners, paywalls, video promos and
article-length pages untouched (all covered by tests).

Verified: harness 38/38; new wallbreaker suite 16/16; page-hook
suite 16/16; topmost + watchdog e2e green.

Remove the old version in Orion before installing v1.10.0.

---

# Beautiful Reader for Orion — v1.14.0

## What's new in v1.14.0 — Kill on open

Kurt's gamesradar video showed why v1.13.0's kill never
fired: the page loads, the article flashes, then white —
and the fight resets before it can be lost twice. The
restore counter lived in page memory, so a wall that
force-reloads (or a fight that spans loads) starts every
round at zero, and the sanctuary kill waited at the end of
a road the page kept erasing. The kill no longer waits:

- **Kill on open.** When the reader goes up on a page
  already proven hostile (a wall was broken or a wall
  dialog suppressed there), the page is killed in the same
  moment — loading stopped, page timers cleared and
  scheduling neutered via the hook, DOM purged, purge watch
  armed. There is no living page left underneath to blank,
  reload or re-wall around the reader.
- **In-read triggers.** If the page throws an overlay at
  the open reader on a hostile page (a sweep has to fire),
  or a wipe detaches the reader's own root, the kill fires
  then — whoever escalates, loses the page.
- **The fight survives reloads.** The Wall Breaker's
  restore count now persists in session storage, so blanks
  accumulate across force-reloads toward the sanctuary
  escalation instead of resetting; a page observed healthy
  again has its count forgiven.
- **The purge also removes meta-refresh tags** — a reload
  timer that lives in markup, beyond the hook's reach.

Calm pages are untouched: no hostility, no kill, and a
sweep on a calm page kills nothing (both directions are
covered by tests). On hostile pages, closing the reader
now leaves the stopped page, as with the sanctuary before
— reload to get the site back.

Verified: harness 38/38; sanctuary suite 23/23 (kill on
open incl. meta-refresh removal, calm sweep vs hostile
sweep, plus all v1.12/v1.13 checks); wallbreaker 27/27;
hook 24/24; fast / v19 / v196 / watchdog / topmost / popup
suites green.

Remove the old version in Orion before installing v1.14.0.

---

# v1.13.0 notes

## What's new in v1.13.0 — Kill the page

Kurt's verdict on v1.12.0: the sanctuary works, but the
blank-out keeps fighting the reader from the living page
underneath. His rule, now implemented: **after the second
lost fight, the page dies.** The sanctuary escalation no
longer just opens the reader — it kills the page around it:

- **Loading stops** (`window.stop()`), and the page hook —
  already resident in the page world — executes the kill
  order: **every pending page timer is cleared** by id
  sweep, and `setTimeout` / `setInterval` /
  `requestAnimationFrame` / `MutationObserver` are neutered
  so the wall's scripts cannot re-arm. (The reader's and
  breaker's own timers live in their isolated worlds and
  are untouched.)
- **The DOM is purged**: all scripts and iframes stripped,
  and every body child that isn't the reader's own removed
  — article source included; the reader already holds its
  copy. A 12-second purge watch follows, removing anything
  the page's surviving observers manage to re-insert.
- What's left is the saved article in reader mode, alone
  on an empty stage — the status line now reads "Sanctuary
  copy · page stopped". Closing the reader leaves the dead
  page behind; a reload brings the site back.

The kill fires only at the sanctuary escalation (two
failed restores). The earlier stages are unchanged: walls
are broken, pages that blank once or twice are restored,
and the race-open on wall pages doesn't kill anything.

Verified: harness 38/38; hook suite 24/24 (kill clears a
live interval and a pending timeout by id sweep, neuters
scheduling, reports for the log); sanctuary suite 17/17
(kill purges scripts/iframes/junk, only reader-owned nodes
remain, re-inserted junk is purged by the watch);
wallbreaker 27/27; fast / v19 / v196 / watchdog / topmost
/ popup suites green.

Remove the old version in Orion before installing v1.13.0.

---

# v1.12.0 notes

## What's new in v1.12.0 — Sanctuary

Kurt's ask: port Element Blocker v1.8.0's improved
blank-out protection, and give the reader a sanctuary page
to pull the article up from. Both halves are in:

**The anti-blank port (wallbreaker.js)** — v1.10.0 carried
Element Blocker v1.7's design, including the two bugs
v1.8.0 was built to fix:

- **Snapshots are now taken early on every article-like
  page** (~1 s / 3 s / 7 s after load, plus at the moment a
  wall breaks). Before, snapshotting only started after a
  wall broke — and on gamesradar the blank lands inside
  that gap, leaving nothing to restore.
- **Blank handling no longer waits for a "hostile" verdict**
  — it runs whenever a snapshot exists. A pure verdict
  decides: restore while restores are cheap (two), then
  escalate instead of fighting the wiper forever.

**The sanctuary (reader.js)** — on escalation the breaker
flags the page and hands over its snapshot, and **the
reader itself pulls up as the sanctuary page**: the article
opens inside the reader's own overlay (from the cached
extraction when there is one, otherwise extracted from the
breaker's sanitized snapshot — scripts, iframes and walls
stripped), with the status line reading "Sanctuary copy ·
this page blanked itself". The page's scripts have
nothing left in there to fight.

**The reader defends itself the same way** (the other
v1.8.0 lesson): if a wiper removes the reader's root — or
the whole body — the guardian now re-attaches it (and
recreates the body) before touching the top layer, instead
of calling showPopover on a detached node and swallowing
the throw. That silent throw was the dead-end behind the
Element Blocker's unopenable menu.

Verified: harness 38/38; wallbreaker suite 27/27 (blank
verdict thresholds + sanctuary stripping); new sanctuary
suite 11/11 (flag opens the reader, status marked,
snapshot-fallback extraction, root/body wipe recovery);
fast / v19 / v196 / watchdog / topmost / popup suites
green.

Remove the old version in Orion before installing v1.12.0.

---

# v1.11.0 notes

## What's new in v1.11.0 — Fast Draw

Kurt's ask: pull the reader up faster, fast enough to beat
the anti-adblock popups — the Element Blocker fight, in the
reader. Three changes:

- **The reader script now loads at document_start** (was
  document_idle, which on ad-heavy pages can lag seconds
  behind the page's own wall scripts), and **extraction runs
  the moment the DOM is ready** — before settings storage
  resolves. The finished article is cached in memory up
  front; later detection passes reuse the cache and may only
  replace it with an equal-or-longer extraction, never a
  shorter one. A page the wall wipes after that point has
  already lost: the article is ours.
- **Wall-triggered instant open.** When the Wall Breaker
  breaks a wall on a page (hides the overlay, suppresses the
  dialog), it marks the page hostile; the reader checks that
  mark on detection and polls for it every 500 ms for 20 s.
  If it appears and an article is in hand, **the reader
  opens on its own** — no tap to win, and because the text
  was extracted before the wall escalated, the blanking
  fallback has nothing to take. Once per page, and only
  while the Wall Breaker toggle is on.
- **Quicker entrance**: the content rise-in stagger is
  trimmed (28 ms steps, first 14 blocks, done in ~1.3 s).

Verified: harness 38/38; new fast suite 13/13 (document_
start manifest, cache survives a simulated page wipe,
upgrade never shrinks the cache, hostile-before-load and
hostile-after-load both race-open, Wall Breaker off means
no race open); wallbreaker 16/16, page-hook 16/16, v19 /
v196 / watchdog / topmost / popup suites green.

Remove the old version in Orion before installing v1.11.0.

---

# v1.9.9 notes

## What's new in v1.9.9

**The magazine header is gone** (Kurt's call). The mode
added in v1.9.0 — hero image full-bleed at the top with
the title overlaid on it — is removed entirely, code and
CSS. Every article again opens with the classic header
stack, as before v1.9.0: site kicker, title, subtitle,
meta row, then the hero under the meta.

Why the titles were vanishing (about half of articles,
per Kurt's Gizmodo screenshot): the magazine header's
parallax faded the overlaid title's opacity from the
reader's scroll position, and scroll sync (v1.9.4) often
opens the reader already scrolled — so the title rendered
at opacity 0 from the first frame. Removing the mode
removes the failure with it.

Verified: harness 38/38; v19 suite re-pointed at the
stacked header (no `.br-mag`, kicker + title in flow,
hero under the meta row); v19b / v195 / v196 suites green.

Remove the old version in Orion before installing v1.9.9.

---

# v1.9.8 notes

## What's new in v1.9.8

**The ten-second sweep window** (Kurt's suggestion): the
Mac Observer wall survived v1.9.7 too, and it pops up on a
delay — after the open-time pass has already run. Now,
enabling the reader starts ten seconds of active sweeping:
the full overlay check (point sampling, ancestor-chain
eligibility, signature-text scan) re-runs every 400 ms,
and the sweep fights back when the wall's own script does:

- A swept overlay that gets **un-hidden** by the page is
  re-hidden on the next tick.
- One that has to be re-hidden **twice is removed from the
  document** entirely — and re-inserted, like everything
  swept, when the reader closes.
- A replacement node reusing the removed wall's id is
  swept as the wall reborn.
- The signature-text scan's size guard relaxes during the
  window for subtrees whose total text is still
  wall-plausible (a wall that replaced the article area has
  few words spread over many ad nodes).

After the ten seconds, the standing watchdog (mutation
triggers + 1.5 s interval, running since v1.8.6) keeps
watch for the rest of the read, as before.

Verified: harness 38/38; sweep suite 13/13 (window active
after open, re-hide, removal on the second offence,
re-insertion on close, window stopped on close, plus all
the v1.9.6/1.9.7 shapes); watchdog / topmost / popup /
auto-scroll suites green.

Remove the old version in Orion before installing v1.9.8.

---

# v1.9.7 notes

## What's new in v1.9.7

- **The toolbar popup has a Reader Mode toggle.** The old
  "Use Reader Mode on this page" button only opened the
  reader; the switch that replaces it reflects the page's
  live state (on while the reader is open in the tab) and
  turns it off as well as on — including force-opening on
  pages where the Reader pill never appears.
- **The wall sweep looks deeper.** v1.9.6's sweep judged
  only the covering element's body-level root — its own
  position and size. The Mac Observer wall survived, and the
  likely shape is why: the fixed full-screen layer nested
  inside a static, collapsed wrapper, so the root looked
  harmless. The check now walks the whole ancestor chain —
  any dialog / popover / iframe, or any layer positioned
  over most of the viewport, condemns the root. Walls are
  also caught by their own words: while the reader is open,
  top-level subtrees whose text matches the anti-adblock
  signature ("ad blocker", "html-load", "disable your ad…",
  "whitelist us…") and which contain an overlay node are
  swept even if the point sampling never touches them, and
  a sweep pass now runs ~0.6 s after the reader opens so a
  wall that was already up is put away promptly.

Honest limit, stated plainly: the wall never appears in a
browser without an ad blocker, and the page refuses
non-browser fetches, so its exact element still couldn't be
replayed here — the sweep was hardened against the shapes
that explain the miss, and the same Mac Observer link is
the verdict.

Verified: harness 38/38; sweep suite 9/9 (direct wall,
nested-wrapper wall, signature-text wall, cookie bar
spared, all restored on close); popup suite 17/17 with the
toggle's state reflection and off command; watchdog /
topmost / v1.9 suites green.

Remove the old version in Orion before installing v1.9.7.

---

# v1.9.6 notes

## What's new in v1.9.6

From Kurt's screen recording on a Mac Observer story, where
an anti-adblock wall ("An ad blocker is preventing this page
from loading") kept taking over, and the reader kept opening
and then closing by itself:

- **The reader was closing itself.** While open, a guardian
  keeps the reader last in the page so late popups can't
  paint over it — but moving an element that is shown in the
  browser's top layer **closes it**. On ad-heavy pages whose
  scripts constantly add nodes, the guardian kept yanking the
  reader out of the top layer; it then had to be rescued,
  and in the gap the site's wall won. The guardian no longer
  moves a top-layer reader at all (stacking there doesn't
  depend on page order), and if the reader ever falls out of
  the top layer for any reason, the watchdog re-enters it
  immediately instead of waiting to spot a covering element.
- **Popups over the reader are now put away, not out-shouted.**
  While the reader is open, any foreign overlay that manages
  to paint over it — a modal dialog, a rival popover, an
  iframe, or a fixed/absolute layer covering most of the
  screen — is hidden for as long as the reader stays open,
  and restored exactly as it was when the reader closes.
  Shape rules spare ordinary furniture (a cookie bar in the
  tests is untouched), the sweep is capped, and our own UI
  is never eligible.

Verified: harness 38/38; watchdog suite updated for the new
guardian behaviour (no move while in the top layer, dead
popover re-enters); new sweep suite 7/7 (wall hidden with
!important, cookie bar spared, wall restored on close);
menu / v1.9 / PDF / viewer / auto-scroll suites green. The
actual Mac Observer wall is an on-device check — the page
refuses non-browser fetches, so its exact overlay shape
couldn't be replayed here.

Remove the old version in Orion before installing v1.9.6.

---

# v1.9.5 notes

## What's new in v1.9.5

Three device reports from the Verge Duet story, fixed:

- **Auto-scroll never moved.** At the default 40 px/s each
  animation frame adds ~0.67 px, and engines that quantise
  `scrollTop` discarded it — every frame, forever. The loop
  now accumulates fractional distance and steps in whole
  pixels. The floating chip also gains the requested
  **play/pause button** next to stop (⏸ / ▶), and the
  enabled state is remembered: reopening the reader with
  Auto-Scroll on starts it scrolling.
- **Images would no longer open.** v1.9.4's viewer fade
  depended on `requestAnimationFrame` to raise opacity; where
  rAF is throttled the viewer sat invisible at opacity 0
  forever. The fade is now class-based (shown → forced style
  flush → visible class) with no rAF anywhere in the path.
- **Wrong subtitle on the Verge** (visible in the pasted
  extraction report): the Verge renders its dek as a plain
  leading paragraph, which the dek-first rule didn't claim,
  so the header fell back to the meta description. A short
  leading paragraph followed by a much longer lede is now
  promoted to subtitle — "Duet is a decent helper, if a
  little jumpy at times." — verified against the live page.

Verified: harness 38/38 (new paragraph-dek test + guard),
new v1.9.5 suite (Verge fixture dek + images, auto-scroll
motion ≥15 px/s at default speed, chip play/pause/resume),
viewer suite reworked for the class-based fade, menu /
v1.9 / Verge / PDF suites green.

Remove the old version in Orion before installing v1.9.5.

---

# v1.9.4 notes

## What's new in v1.9.4

Four refinements, from Kurt's screenshots of the Verge Duet
story and two follow-up requests:

- **The pill's progress ring no longer crowds the book icon.**
  The ring sat at the glyph's own size, drawn right on top of
  it. It's now a 25 px circle (radius 10.5) around a smaller
  13 px book — clear air between glyph and arc.
- **Two-way scroll sync with the page.** The reader opens at
  the same scroll fraction the page was at — scroll halfway
  down an article, tap Reader, you're halfway through the
  reader view. Closing hands the position back: the page
  scrolls to the fraction you reached in the reader.
  (Fractions, not pixels — the documents differ in height.)
  The opening jump never overwrites your saved position by
  itself; saving resumes with your first real scroll.
  Saved-library articles don't sync — the page under them is
  a different page.
- **Menu sections animate.** This Site / Appearance / Text /
  Layout / Listen & Scroll now expand and collapse with a
  smooth height-and-fade motion, and the chevron rotates
  instead of swapping glyphs. Engines that can't animate the
  technique fall back to the old instant toggle.
- **The image viewer fades.** Tapping a photo fades the
  full-screen viewer in; closing it (✕ or tap) fades it out
  before it hides. The swipe-to-close fling already faded
  and still does.

Verified: harness 37/37; ring + scroll-sync suite 8/8,
viewer-fade suite 8/8, menu suite 14/14 (it also caught and
fixed its own stale four-section expectation from before
Listen & Scroll existed), PDF export suite green. The
open-side scroll jump and the animations are layout effects
— the suites verify the state and geometry behind them; the
motion itself is an on-device check.

Remove the old version in Orion before installing v1.9.4.

---

# v1.9.2 notes

## What's new in v1.9.2

**Export PDF (with images) actually includes the images.**
Reported on device: the exported PDF was text-only. The print
clone's `<img>` elements were fresh nodes carrying
`loading="lazy"` inside a `display:none` subtree — the browser
never started those loads, so the print snapshot had nothing
to draw. The export now:

- points each clone image at the already-loaded live image's
  URL (so it resolves from cache),
- forces eager loading and re-kicks the load,
- **waits until every clone image has settled** (loaded or
  failed, capped at ~7 s) before calling print,
- and the print stylesheet no longer lets the magazine
  header's parallax transform shift the hero, and keeps
  figures from splitting across pages.

Verified: new v1.9.2 suite 8/8 (clone carries the image,
images not lazy, print waits, print fires after they settle),
harness 37/37, v1.9 / v1.9.1 suites green.

Remove the old version in Orion before installing v1.9.2.

---

# v1.9.1 notes

## What's new in v1.9.1

Caption legibility, from Kurt's screenshot of the Verge
Claude Duet story: the photo credit ("PHOTO: ALLISON JOHNSON /
THE VERGE") rendered in the theme's faint colour — nearly
invisible on light themes — and captions were centred.

- Credits now use the secondary text colour at 12 px semibold
  — still quieter than the caption sentence, but readable —
  and they may wrap instead of being forced onto one line.
- Image captions (and the video-poster caption) are
  left-aligned, like the article text they belong to.

Verified: new v1.9.1 suite 6/6 (CSS rules + the Verge credit
form splitting and rendering), harness 37/37, v1.9 suites and
WSJ caption suite green.

Remove the old version in Orion before installing v1.9.1.

---

# v1.9.0 notes

## What's new in v1.9.0

The four known gaps, retried — plus the feature batch A B C D
E F I J K L M N.

**Known gaps**
- **Multi-paragraph highlights re-wrap on reopen.** The old
  restore searched inside single text nodes, so a highlight
  spanning paragraphs could never be found again. Highlights
  now save 40 characters of anchor context on each side, and
  restore searches the article's whole text (whitespace-
  normalised, with a node map) — the combined context string
  first, then the passage itself, using the context to pick
  between repeated passages.
- **Saved articles are genuinely offline.** Saving now also
  fetches the article's images (hero + body, up to 6), shrinks
  them to at most 1100 px wide JPEG, and stores them with the
  article (~1.8 MB budget). The library marks articles
  "Offline ✓" when every image was cached, "(text)" when only
  some were — a host that refuses the fetch leaves that image
  online-only; the text is offline either way.
- **The page's own dek beats the meta description.** A
  dek-length heading at the top of the body is now the
  subtitle; the description (often a site tagline) is only the
  fallback.
- **Gated pages say so.** When a page carries sign-in /
  subscribe furniture and the readable text is short — or the
  structured data quietly holds far more story than the page
  shows — the reader opens with a "Possibly truncated" notice
  instead of presenting a stub as the article. The gear menu
  gains **Copy Extraction Report**: URL, readability, text
  length, block census, JSON-LD size and the gated flag as
  copyable plain text for one-message bug reports.

**New**
- **A · Read Aloud** — gear menu → Listen & Scroll. Speaks the
  article block by block, highlighting and following the
  current passage; voice speed 0.9×–1.5×; a floating chip
  pauses / resumes / stops.
- **B · Find in Article** — the overlay used to swallow the
  browser's find; the reader has its own now, with match
  count and ↑/↓ jumping.
- **C · Footnotes** — a superscript reference whose note
  exists on the page becomes a tappable chip; the note opens
  in a glass card instead of teleporting you to the bottom.
- **D · Text Only** — Appearance switch hides every image,
  video, embed and social card, keeping your scroll place.
- **E · Highlight colours + Highlights view** — the selection
  bar is now four colour dots (yellow, green, blue, pink)
  plus Note; existing highlights can be recoloured, and the
  menu's Highlights entry lists this article's highlights —
  tap one to jump to it with a flash.
- **F · Auto-Scroll** — hands-free scrolling at Slow /
  Normal / Brisk; touching or wheeling pauses it for a few
  seconds instead of fighting you.
- **I · Magazine header** — when the article has a hero, the
  header is now full-bleed with the kicker, title and dek
  over a gradient scrim at the photo's foot (the photo is
  still shown whole, never cropped), a gentle parallax on
  scroll, and the byline row underneath.
- **J · Caption / credit split** — "JACQUELYN MARTIN/AP" and
  its kin now render smaller, quieter and uppercase beside
  the caption sentence instead of as part of it.
- **K · Pull quotes** — a quote block that merely repeats a
  body paragraph renders as large centred display type with
  an accent quote mark, not as a bordered quotation.
- **L · Section indicator** — the menu bar quietly shows the
  section heading you're currently reading.
- **M · Motion polish** — theme changes crossfade; a shimmer
  skeleton marks where a stitched next page will land.
- **N · Pill progress ring** — the Reader pill wears a ring
  showing how much of this article you've already read, and
  its label becomes "Resume N%".

Verified: harness 37/37 (new core tests for the dek rule,
caption splitting, pull-quote detection), new v1.9 suites
24/24 + 6/6 (multi-paragraph re-wrap, magazine header,
caption credit, pull quote, footnote chip, find, pill ring,
gated notice, text-only), every earlier suite green.
Read-aloud, auto-scroll, parallax and the section indicator
are construction-verified in jsdom (no speech engine or real
layout there) — they rest on the on-device verdict, like the
top layer before them.

Remove the old version in Orion before installing v1.9.0.

---

# v1.8.7 notes

## What's new in v1.8.7

WSJ support, from Kurt's screenshots of the Nvidia story:

- **Markets ribbon and section rail eliminated.** The index
  strip (Nikkei / 59948.37 / -1.95 %, Hang Seng, Shanghai, BSE
  Sensex…) and the rail headers (Conversation, What to Read
  Next, Most Popular News, Most Popular Opinion) no longer leak
  into the article. Two holes closed: the cleanup filter never
  looked at list blocks at all (the rail travels as a list),
  and nothing recognised ticker furniture. New core checks —
  `isTickerLine` (a block that is only a market value, only an
  index label, or a label plus numbers) and `isNavLabel`
  (anchored, length-capped module headers) — now apply to
  paragraphs, headings, quotes and list items alike. Both are
  deliberately narrow: a sentence like "Gold rose for a third
  day…" or "…the most popular model in the survey…" survives.
- **Captions under photos are captured even when they aren't
  metadata.** WSJ puts the line under a photo in a plain div
  inside the figure — only a real `<figcaption>` was read
  before, so those captions vanished entirely. Figures now
  fall back to a caption/credit-classed descendant, then to
  any short text child of the figure; and a caption-classed
  element trailing an image under the same wrapper is attached
  to that image instead of being dropped or shown as stray
  text. Captions render under the photo as before.

Verified: new WSJ suite 12/12 (both leaks reproduced from the
screenshots, both fixed, prose guards intact), WSJ fixture
15/15, harness 33/33, every other suite green.

Remove the old version in Orion before installing v1.8.7.

---

# v1.8.6 notes

## What's new in v1.8.6

- **Overlay watchdog — the reader detects being covered and
  redraws above it.** While the reader is open it samples what
  is actually painted at nine points across the screen
  (elementFromPoint). DOM insertions and class/style reveals
  trigger an immediate check (~180 ms); a 1.5 s interval catches
  animation-only reveals. The moment a foreign element is found
  on top, the reader escalates: re-appended to win DOM order,
  and re-entered into the top layer (hide + show re-stacks it
  above top-layer entries that arrived later — including a
  popup that used the top layer itself). When nothing covers
  it, the watchdog does nothing at all — no churn.
  Verified: watchdog suite 5/5 (escalation on a real intruder,
  complete stand-down over its own content), harness 33/33,
  all suites green. The geometric check needs
  document.elementFromPoint; where that's unavailable the
  v1.8.5 defences still apply.

Remove the old version in Orion before installing v1.8.6.

---

# v1.8.5 notes

## What's new in v1.8.5

- **The reader now uses the popups' own method: the browser's
  top layer.** The v1.8.4 guardian won DOM-order ties, but a
  popup could still win by landing inside a container that
  already sat above the reader, or by using the top layer
  itself. So the reader now enters the top layer while open
  (shown as a manual popover): nothing in the page — no
  z-index, no stacking context, no late injection — can paint
  above a top-layer element. It leaves the top layer when the
  reader closes, and briefly during PDF export (whose print
  stylesheet needs normal flow; it re-enters afterwards).
  The selection bar moved inside the reader so the top layer
  carries it too. The DOM-order guardian stays as the fallback
  for engines without the Popover API, and now also watches
  nested insertions.

Honest limits: a site element that itself enters the top
layer AFTER the reader (a native modal dialog opened later)
can still cover it — that's the platform's own stacking rule
for the top layer, and it's rare in practice. The Popover API
itself needs Safari/WebKit 17+; on older engines the guardian
fallback applies. jsdom has no Popover API, so the top-layer
path is verified by construction + on-device verdict, while
the guardian path is covered by the automated suite (8/8).

Remove the old version in Orion before installing v1.8.5.

---

# v1.8.4 notes

## What's new in v1.8.4

Both from Kurt's NY Post screenshot (which also confirmed the
v1.8.3 rescue works on-device — the story extracted in full):

- **Contrast is now guaranteed.** The reader's body text was
  inheriting its colour from the reader container — and a site's
  own `p { color: #000 }` rule beats inheritance, so NY Post's
  text rendered black on the dark theme. The reader now pins
  its theme text colour directly on its text elements
  (paragraphs, list items, headings, table cells, the title)
  with `!important`: reader text always wears the theme's
  colours, in dark and light themes alike. Links keep the
  accent colour.
- **The reader stays topmost.** It already sat at the maximum
  z-index, but a site popup injected after it with the same
  z-index wins the tie. While the reader is open, a guardian
  watches the page: if anything lands after the reader in the
  document, the reader is moved back to the end (scroll
  position preserved), so late popups and sticky bars stay
  underneath. The guardian stands down when the reader closes.

Verified: topmost/contrast suite 6/6 — including a computed-
style check where the paragraph renders in the theme colour
despite three hostile site rules — harness 33/33, all suites
green.

Remove the old version in Orion before installing v1.8.4.

---

# v1.8.3 notes

## What's new in v1.8.3

- **Rescue harvest — fixes NY Post, and the class of failure
  behind it.** Root cause, reproduced against the real NY Post
  page: the article column sits inside a layout wrapper classed
  `layout layout--sidebar` (the class means "layout that HAS a
  sidebar"). The extractor's skip rules pruned that wrapper's
  whole subtree — article included — whenever the winning
  container was one of its ancestors, so the harvest came back
  empty and only metadata (title/dek/hero) survived.
  Now: if a harvest comes back nearly empty while the page
  plainly holds a story (900+ chars of paragraph text), the
  extractor re-walks the page and may descend into skipped
  containers that are themselves article-like (700+ chars of
  prose, link density ≤ 0.5, not legal boilerplate). Real
  sidebars and consent boxes fail those tests and stay pruned —
  verified by dedicated guard scenarios, and the Verge
  privacy-notice defenses still pass.
  On the real NY Post article: before — 0 blocks, not readable;
  after — readable, 10 story paragraphs, pill appears.
- Reuters may share this trap (its pages use similar layout
  wrappers). Retest the same Reuters story on v1.8.3 — both the
  automatic pill and the force button. If it still returns
  title-only, its text genuinely isn't in the page (registration
  gate) and the parked browser-takeover inspection is the
  remaining route.

Verified: rescue suite 8/8 (trap + both guards + control),
real-page NY Post diagnostic, harness 33/33, all suites green.

Remove the old version in Orion before installing v1.8.3.

---

# v1.8.2 notes

## What's new in v1.8.2

- **Site favicon at the top of the reader.** The kicker line
  (TREYARCH.COM in the screenshot) now shows the site's favicon
  at its left: the best icon the page declares (apple-touch-icon
  or the largest `rel=icon`), falling back to `/favicon.ico`.
  16px, rounded corners; if the icon fails to load it hides
  itself rather than showing a broken image. Saved articles
  keep their favicon too.
- The Reuters body-text investigation continues separately:
  force-open returns title/dek/hero only, and Reuters blocks
  every automated inspection route (DataDome) — the fix waits
  on inspecting the real rendered page via a browser takeover.

Verified: favicon end-to-end 6/6; harness 33/33; all suites
green.

Remove the old version in Orion before installing v1.8.2.

---

# v1.8.1 notes

## What's new in v1.8.1

- **"Use Reader Mode on this page" button** in the popup's This
  Site section. Some pages never earn the Reader pill on their
  own — short wire briefs and registration-truncated articles
  fall under the automatic thresholds even though they hold real
  text. The button forces the reader open with whatever the page
  offers (including the structured-data text, with a lower bar
  in force mode). If a page genuinely has no readable text, you
  get a small "No readable text found on this page" toast
  instead of silence.
- Prompted by a Reuters story that never shows the pill.
  Reuters itself couldn't be inspected from here — it blocks
  automated access outright (DataDome) — so the exact on-page
  cause is unverified; the force button is the practical answer
  either way, and its result is diagnostic: if it opens, the
  text was simply below the automatic thresholds; if you get
  the toast, the page isn't handing the text to the browser at
  all (bot/consent wall).

Verified: force-open end-to-end 4/4; harness 33/33; all suites
green.

Remove the old version in Orion before installing v1.8.1.

---

# v1.8.0 notes

## What's new in v1.8

- **The toolbar popup is tabbed now: Settings / Saved /
  History.**
  - *Saved* lists everything in your save-for-later library.
    Tap one and it opens in the reader on the current tab
    (offline text and all); ✕ removes it.
  - *History* is new: every article you open in the reader is
    recorded — title, site, when, and how far you got (progress
    bar and %, or "Finished ✓"). Tap an entry to jump back in:
    same tab if you're already on that page, otherwise the tab
    navigates there. Your existing in-progress articles were
    carried over from your saved reading positions. Capped at
    100 entries.
  - *Clear History* with time frames — Last hour, Last 24
    hours, Last 7 days, or All time — with a tap-again-to-
    confirm button so it can't fire by accident. Clearing the
    list never touches Saved articles or your reading positions.
- **The reader's default font is now the website's own font.**
  A new "Website Font" choice sits at the top of the font list
  and is the default: the reader adopts the font the site uses
  for its article text, resolved live from the page. Pick any
  fixed font instead whenever you prefer one. (If your menu
  still shows New York after updating, that's your previously
  saved choice — switch it to Website Font once and it sticks.)

Verified: harness 33/33; popup tabs + history + font end-to-end
16/16 (including history recorded on open, progress updated on
close, clear-last-hour keeping older entries); all earlier
suites green.

Remove the old version in Orion before installing v1.8.

---

# v1.7.2 notes

## What's new in v1.7.2

- **Structured-data fallback for gated pages.** Business
  Insider's page defeated the v1.7.1 watcher on device, so the
  reader now takes a second path that doesn't depend on the
  page's own rendering at all: publishers embed the complete
  story text in the page's JSON-LD structured data
  (`articleBody`) for search engines — BI's shell HTML contains
  the full 2,186-character story even while its app is still
  deciding what to show you. When the visible page doesn't yield
  a readable article but the structured data carries a full
  text, the reader uses that (sentence-grouped into paragraphs).
  Normal pages are untouched — the DOM always wins when it reads
  cleanly. Verified against the real BI page: the shell now
  extracts as the complete Reddit/Similarweb story.
- **The pill comes back.** If the reader opened automatically
  (site on your always-open list), closing it used to leave you
  with no way back in — the pill was never created on that path.
  Closing the reader now restores/creates the pill whenever an
  article was detected, so you can re-open at will.

Verified: harness 32/32; BI fallback + auto-open/close/pill
scenario 8/8; late-hydration scenario 4/4; all earlier suites
green.

Remove the old version in Orion before installing v1.7.2.

---

# v1.7.1 notes

## What's new in v1.7.1

- **Reader now activates on late-loading articles.** Some sites
  (Business Insider is the example) serve an empty shell with an
  email-entry popup on top, and the article text only appears
  seconds later when their app finishes rendering — by which time
  the reader had already checked three times, found nothing, and
  given up, so the pill never appeared. Detection now keeps
  watching the page for up to ~45 seconds: when article text
  actually lands in the DOM, the pill appears (and sites on your
  always-open list open the reader then, over the popup).
  Watching stops the moment an article is found, you dismiss the
  pill, or the window expires — and it only re-reads the page
  when the text on it has actually changed.

Verified: new end-to-end scenario (empty shell + email gate →
article hydrates late → pill appears → reader opens with the
story) 4/4; harness 31/31; all earlier suites green.

Remove the old version in Orion before installing v1.7.1.

---

# v1.7.0 notes

## What's new in v1.7

- **Privacy notices can no longer pose as the article.** Legal
  boilerplate (privacy/cookie/consent text) is dense, link-free
  prose — exactly what used to outscore a real story. Now:
  candidates dominated by legal text (>35% of their paragraphs)
  are disqualified; hidden containers (consent preference centers
  parked in the DOM) can't win; the semantic `<article>`/`<main>`
  container and the one holding the headline get a scoring bonus;
  consent frameworks (OneTrust & friends, dialog-role overlays)
  are skipped outright; and a cluster of legal paragraphs woven
  into an otherwise real article is dropped. Verified against a
  simulated consent wall bigger than the article, and the real
  Verge Cybercab story (the page that showed the bug) still
  extracts whole.
- **Toolbar popup — global settings.** Tap Beautiful Reader in
  Orion's extension toolbar/menu and you get a settings popup:
  the current site's "Always use Reader" switch, the full
  always-use-Reader list (add any site by typing its domain,
  remove with ✕), and all the global defaults — Follow System,
  light/dark/locked themes, font, text size, line spacing,
  column width, menu bar position, drop cap. It writes to the
  same storage as the in-reader menu and pings the open tab, so
  a reader that's already open refreshes immediately.

Verified: harness 31/31; popup end-to-end 13/13; boilerplate
scenarios 6/6; all earlier suites green. One unknown: whether
Orion iOS renders extension popups — if tapping the toolbar
entry does nothing on your build, tell me and I'll wire the
same screen as an in-page panel instead.

Remove the old version in Orion before installing v1.7.

---

# v1.6.0 notes

## What's new in v1.6

- **Ambient colour glow.** Every image now carries a soft halo of
  its own colours: a blurred, saturated copy of the image sits
  behind it, slightly larger, so the picture seems to expand past
  its borders and bleed into the page — like the fire photo
  glowing orange into the dark theme. Applies to the hero, body
  images, and late-inserted images. (Not in PDF exports.)
- **Social embeds, properly formatted.** Embedded posts are no
  longer flattened into plain quotes. X/Twitter, Instagram,
  Facebook and TikTok embeds become a framed card with the
  platform's own live embed inside — the real post, tappable and
  scrollable — plus a "View on X ↗" link. Detected from embed
  iframes, `twitter-tweet` / `instagram-media` blockquotes, and
  Facebook `fb-post` elements. When a post can't be embedded
  (rare), the card shows the post text and author with the link
  instead. Note: Instagram/Facebook occasionally answer embeds
  with a login wall — that's their call, not the reader's; the
  View link always works. Markdown export includes the post text
  and link.

Verified: harness 30/30; jsdom end-to-end 13/13 (X blockquote,
Instagram iframe, Facebook data-href → correct embeds, text and
author preserved, glow present behind hero + body images, embeds
in the right positions); all earlier suites green.

Remove the old version in Orion before installing v1.6.

---

# v1.5.1 notes

## What's new in v1.5.1

- **Fixed: the top image of an article could vanish.** Found on
  the Verge's Jensen Huang story, reproduced against the real
  page: the photo WAS extracted, but the header skipped it
  ("it's already in the body") while the body render filtered it
  out ("it's the hero") — both sides deferred to the other, so it
  rendered nowhere. The hero now renders exactly once: in the
  header when it isn't part of the body, otherwise in place in
  the body where it belongs. This affected any article whose
  main photo is also its first body image — i.e. most of them;
  other images were unaffected, which is why some went through.
- **Slower, softer animations.** The reader fade is now 0.6s;
  the staggered text rise runs ~0.95s per block with a 75ms
  stagger and a gentle blur-to-sharp settle; late images expand
  over 0.9s; closing fades over ~0.5s.

Remove the old version in Orion before installing v1.5.1.

---

# v1.5.0 notes

## What's new in v1.5

- **PDF export is the reader view.** "Export PDF (with images)"
  now prints a clone of the reader exactly as you're looking at
  it — your theme, font, size and width, header, subtitle, images
  and links — and a print stylesheet hides the web page entirely.
  (The old version printed a hidden iframe, which Orion rendered
  as the underlying web page instead.)
- **Links work.** Links inside the article are preserved: tap one
  in the reader and it opens in a new tab. Markdown export renders
  them as real `[text](url)` links.
- **Late images slide in.** The reader still grabs the text
  instantly, but for ~20 seconds after opening it watches the
  page: if an image loads late and would have been part of the
  article, it's inserted at its correct position with a smooth
  expand-and-fade animation, and the text below glides down.
- **Homepages excluded.** A site's homepage (root path) is an
  index, not an article — the Reader pill no longer appears there
  (e.g. theverge.com), and auto-open won't fire there either.
- **This Site moved to the top** of the settings menu, above
  Appearance / Text / Layout, and starts expanded.
- **Entrance animation.** The reader fades in, and the article
  content rises in staggered order — headline first, then the
  paragraphs in sequence — the way chat responses stream in.
  (Respects Reduce Motion.)

Verified: harness 29/29; jsdom end-to-end 17/17 (links rendered
+ exported, print clone contents, homepage exclusion, late-image
insertion position, menu order); WSJ fixture 15/15 and Verge
regression clean.

Remove the old version in Orion before installing v1.5.

---

# v1.4.0 notes

## What's new in v1.4

- **The real headline wins.** The header title is now the headline
  printed on the page (the visible H1). WSJ and others serve a
  different SEO/social title in the metadata ("…Trump and His Elon
  Musk Feud") that never appears on the page — the reader no longer
  uses it when a real headline exists.
- **Subtitle support.** The article's dek/standfirst is detected
  (meta description, or a leading summary heading like WSJ's) and
  rendered *italic* under the title in the header, instead of as a
  giant bold body heading. Included in Markdown and PDF exports.
- **Drop cap discipline.** Byline fragments at the top of the body
  ("By", "| Video produced by", "July 5, 2026 at 7:00 am ET") are
  stripped — even when they hide behind a hero image or video — and
  the drop cap can only start on the first real article paragraph
  (≥40 characters, never a byline fragment). Prose that merely
  starts with "By the…" is safe.
- **Video passthrough.** Videos in the article play in the reader:
  direct `<video>` files inline with controls, YouTube/Vimeo/
  Dailymotion/Twitch/Brightcove embeds in a 16:9 frame, and a
  page's main video (og:video / JSON-LD VideoObject / Twitter
  player) becomes a playable hero under the header. Custom JS/DRM
  players with no direct stream still show their poster with a
  "watch on the original page" note.
- **Menu bar position.** Settings → Layout → Menu Bar: **Bottom**
  (new default) or Top. At the bottom, the ✕ / Save / ⚙ bar pins
  to the foot of the screen and the settings menu opens upward
  from it.
- **Settings menu, reorganized.** The long list is now four
  collapsible categories — **Appearance** (theme, Follow System),
  **Text** (size, font, line spacing, drop cap), **Layout**
  (column width, menu bar), **This Site** (scope, auto-open,
  reset). Tap a category header to expand or collapse it; the
  menu remembers what's open. Quick actions (Hide Reader,
  Contents, Save, Saved, Exports) stay at the top.
- Tiny declared icon images (like the WSJ checkmark badge that
  rendered screen-size) are no longer extracted as photos.

Verified: harness 27/27; jsdom end-to-end on a WSJ-structure
fixture 15/15 (title, subtitle, drop-cap target, video, bottom
bar); menu test 10/10; Verge regression clean.

Remove the old version in Orion before installing v1.4.

---

# v1.3.1 notes

## What's new in v1.3.1

- **Site chrome no longer leaks into the article.** On The Verge,
  the topic-follow bars above the article are hidden popovers
  (`<aside aria-hidden>`) nested inside breadcrumb list items, and
  the list walker used to scoop each item's full text — buttons,
  popover copy and all — into the reader as mashed "paragraphs"
  ("GadgetsCloseGadgetsPosts from this topic…"). Fixes:
  - Text extraction now honors the skip rules *inside* blocks:
    list items, paragraphs, headings and quotes gather text with
    nav/aside/button/form/aria-hidden subtrees excluded.
  - A UI-junk detector drops mashed widget text (follow bars,
    share widgets) wherever it appears.
  - Verified end-to-end in a DOM against the real Verge page:
    zero digest/follow text in the output, article intact
    (103 blocks: 36 paragraphs, 32 product headings, 33 images).

Remove the old version in Orion before installing v1.3.1.

---

# v1.3.0 notes

## What's new in v1.3

- **Image shadows.** Every image (hero and in-article) now sits on
  a soft layered shadow, so photos lift off the page instead of
  lying flat against the background.
- **Tap any image to view it.** Images are selectable: tap one and
  it opens in a full-screen viewer (inside the reader overlay).
  - **Zoom:** pinch (1×–4×) or double-tap to toggle 2.5×; mouse
    wheel works on desktop. Drag to pan while zoomed.
  - **Caption with the image:** the image's caption text is shown
    in a bar at the bottom of the viewer.
  - **Swipe away in any direction:** at 1×, drag the image — it
    follows your finger and the backdrop fades — and release past
    ~90px in any direction to dismiss it. Short drags snap back.
    ✕ closes it too.
- **Tables:** confirmed supported end-to-end (they have been since
  v1.0): extraction keeps rows/cells, the reader renders a styled
  table (bold header row, horizontal scroll when wide), Markdown
  export emits pipe tables, and the PDF print view includes them.
  New in v1.3: a table's `<caption>` is carried through as a
  caption line above the table in all outputs.

Remove the old version in Orion before installing v1.3.

---

# v1.2.1 notes

## What's new in v1.2.1 — image duplication fix (The Verge)

Verified against the live page HTML of the Verge gift guide Kurt
reported: the page contains **84 `<img>` srcs for only 39 distinct
image files**. Every product image is embedded 2–3 times in sibling
containers (wrapped in the same affiliate link), each copy with
different CDN crop/width/quality query parameters — so exact-URL
dedupe could never catch them, and the hero collage (also the
og:image) reappeared in the body on top of that.

- **Images now dedupe by canonical identity** (origin + path,
  ignoring all query parameters) at extraction, in the header/hero
  check, in the PDF print view, and when stitching pages. One
  file = one image, first occurrence wins.
- **Hidden responsive variants are skipped** on the live page via
  computed style (an image, or a near ancestor, that CSS hides at
  this width is never extracted).
- **File-name captions are gone.** Captions come only from a real
  `<figcaption>`; alt text is no longer used as a caption, and a
  caption that looks like a file name
  (`268757_2026_gift_guides_CVirginia_DADS`) is dropped.
- The Verge's topic-follow widget text ("Posts from this topic
  will be added to your daily email digest…") is stripped.

Remove the old version in Orion before installing v1.2.1.

---

# v1.2.0 notes

## What's new in v1.2

From Kurt's screenshot + the Safari Reader video:

- **The gear button works now.** Root cause found: the menu panel
  was a sibling of the reader overlay in the page, and the reader
  sits at the maximum z-index — so the menu rendered *underneath*
  the reader in both v1.0 and v1.1. Tapping ⚙ opened an invisible
  menu (which is also why font changes "didn't work" in v1.0: the
  settings were never reachable). The panel now lives **inside**
  the reader overlay, the gear has its own direct tap handler
  (tap again to close), and if the menu ever fails to build it
  shows the error in the panel instead of failing silently.
- **Close is just ✕.** No "Close" text.
- **Menu rebuilt as Apple's Reader Options.** Header row
  "Aa Reader Options ⌄", then list rows with checkmarks:
  Hide Reader, Contents, Save Article, Saved Articles, Export
  Markdown, Export PDF; a Text Size stepper (A− / A+); **Theme**
  radio rows with colour dots (Paper, Pure Light, Sepia, Slate
  Dark, OLED Black); **Font** rows each rendered in its own font;
  Line Spacing and Column Width checkmark rows; Follow System and
  Drop Cap switches; Apply Settings To (All Sites / This Site
  Only); per-site auto-open and reset. Selections update in place.
- **Apple's font list.** New York (default), San Francisco,
  Charter, Georgia, Iowan, Palatino, Athelas, Seravek,
  Times New Roman, plus Hyperlegible and Mono. Settings saved by
  v1.0/v1.1 (Serif/Sans/Book Serif) migrate automatically.
- **Cleanup:** bare-URL paragraphs (the WSJ canonical link that
  appeared as body text under the hero) are stripped.

Remove the old version in Orion before installing v1.2.

---

# v1.1.0 notes

## What's new in v1.1

From Kurt's on-device video (WSJ article):

- **One gear menu.** The top bar is now just ✕ Close, Save, and a
  ⚙ gear at the top right. The gear expands a glass menu anchored
  under it with an iOS-style spring animation (scales/fades in from
  the top-right corner) containing *everything*: Contents, Saved
  articles, Save, Export, themes, Follow System, Drop cap, fonts,
  text size, line spacing, column width, per-site scope, auto-open,
  and site reset.
- **No more float.** The reader is locked to the device width
  (100vw max, horizontal overflow hidden, vertical-pan only, long
  URLs wrap). The old bug — article sliding sideways and text
  clipped at the left edge — came from unbreakable long strings
  widening the page; that's contained now. Settings changes also
  no longer rebuild the menu, so it can't flicker or jump.
- **Font changes fixed, verifiably.** Typography is now applied
  both as CSS variables *and* as inline styles directly on the
  article body, and the menu shows a live sample line in the
  selected font. Menu selections update in place.
- **Always starts at the header.** Opening the reader lands at
  the top: kicker, title, then **author + publication date** under
  the heading (now pulled from JSON-LD first, then meta tags,
  byline elements, and `<time>`), then the hero image. Byline
  fragments ("By" / "and") and junk blocks ("What To Read Next",
  reprint/copyright notices) are stripped from the body. A saved
  reading position no longer auto-jumps — it appears as a
  tappable **Resume at N% ↓** pill.
- **Export format choice.** Export as **Markdown (.md)** as
  before, or **PDF (with images)**: a print rendering of the full
  article — header, byline/date, hero and every image — opens in
  the system print dialog; use Share / Save to Files there to
  keep the PDF.
- **Drop cap.** New appearance toggle: the first letter of the
  article's first paragraph renders large with the text wrapped
  around it. Works globally and per-site like other typography.

Remove the old version in Orion before installing v1.1.

---

# v1.0.0 notes

Firefox MV2 extension for Orion (iOS/macOS). A reader built around
typography: calm themes, real font control, and nothing competing
with the text.

## Core

- **Detection.** On every page, the article is extracted and scored
  (text length, paragraph count, link density). Only genuinely
  article-like pages qualify — homepages, listings, search results,
  and checkouts stay untouched.
- **Draggable Reader pill.** When a page qualifies, a liquid-glass
  **Reader** pill appears at the upper right. Drag it anywhere — it
  snaps to the nearest edge, and its position is remembered
  **globally**, across all sites. It shrinks to a book icon after
  ~4s. Tap to open, ✕ dismisses it for that page, long-press opens
  your Saved library.
- **Reader view (overlay).** Full-screen overlay on the same page:
  close it and you're back exactly where you were. Site kicker,
  title, byline / date / read-time, hero image shown whole (never
  cropped), ~65-character measure, generous line spacing, and a
  thin #0A84FF reading-progress bar up top.
- **Auto-open, per site only.** In Aa settings, "Always open Reader
  on this site" adds the site to your list; listed sites open the
  reader automatically as soon as the text has loaded and settled.
  There is deliberately no auto-open-for-everything mode.
- **Themes & fonts.** Five themes — Paper, Pure Light, Sepia,
  Slate Dark, OLED True Black — and five fonts: Serif, Sans,
  Book Serif, Hyperlegible, Mono. Text size (16–24), line spacing
  (Tight / Cozy / Airy), column width (Narrow / Standard / Wide).

## Your picks, built in

- **A — Multi-page stitching.** Paginated articles ("page 1 of 6")
  are fetched and merged into one continuous read, up to 5 pages,
  with "Page N" dividers and an end note saying how many pages
  were combined. Duplicate paragraphs across pages are dropped.
- **B — Resume + progress.** Your place is saved per article; reopen
  it and a "Resumed at N%" pill confirms you're back where you
  stopped. Progress bar is always visible while reading.
- **C — Contents.** ☰ Contents lists the article's headings; tap
  one to jump to it.
- **D — Highlights, notes, export.** Select text in the reader →
  **Highlight** or **Highlight + Note**. Tap a highlight to edit
  its note or remove it. Highlights are restored when you reopen
  the article, and **Export** downloads the clean article as
  Markdown with your highlights and notes appended.
- **G — Per-site typography.** Aa settings can apply to **All
  sites** or **This site only** — font, size, spacing, width, and
  theme. A site's own settings override the global ones, and can
  be reset in one tap.
- **H — Save for later.** **Save** keeps a clean copy (text,
  images, structure) in the extension, up to 20 articles, readable
  offline from the **Saved** list — no network needed.

## Theme rule (your Q4 answer)

**Follow system light / dark** is a toggle in Aa settings, on by
default: light mode uses your chosen light theme, dark mode your
chosen dark theme (tap a theme swatch to assign it to whichever
mode it belongs to). Turn the toggle off to lock one theme —
unless a site has its own theme set, which always wins.

## Install (Orion iOS)

1. Download the `.zip` (don't unzip it).
2. Orion → Settings → Extensions → turn **Firefox extensions** on.
3. ••• → Extensions → **+** → Install from File → pick the `.zip`
   (or the `.xpi`), enable it, refresh the page.

## Test checklist (on device)

1. Open a news article → Reader pill appears upper right; drag it
   to the left edge, open another article on another site → pill
   is still on the left (global position).
2. Tap the pill → reader opens; scroll → progress bar fills;
   close, reopen → "Resumed at N%".
3. Aa → change font, size, spacing; switch theme swatches in
   light and dark system modes → reader follows system until you
   turn Follow System off.
4. Aa → "This site only" → set Sepia + Book Serif → reopen: this
   site uses them, other sites don't. Reset the site's settings.
5. Aa → "Always open Reader on this site" → revisit an article
   there → reader opens on its own. Other sites still just show
   the pill.
6. A paginated article → reader end note says pages combined.
7. Select a sentence → Highlight + Note → close/reopen → highlight
   and note are back; Export downloads the .md with them.
8. Save an article → open Saved → turn on Airplane Mode → the
   saved copy still reads.
9. Long-press the pill on any article page → Saved library opens.

## Honest limits

- Build-verified only (syntax + harness) until your on-device test.
- Extraction is a built-in scorer/extractor in the spirit of
  Readability, not Mozilla's library itself — most article pages
  extract cleanly; heavily script-built or paywalled pages may
  extract partially or not trigger the pill at all.
- Stitching (A) can only fetch pages the site serves without extra
  interaction; if a fetch fails, the reader simply ends at the
  current page and says so.
- A highlight that spans several paragraphs may not re-wrap on
  reopen (it is still saved and included in exports).
- Storage uses `browser.storage.local` with localStorage fallback;
  whether Orion persists it across restarts is part of the test.
- Saved copies store extracted text/images-by-URL; images in a
  saved article still load from the network — the text is what
  works offline.
