# uBlock for Orion v1.2.4

A uBlock Origin-style content blocker built specifically for Orion on iOS,
after Orion's own uBlock Origin support broke. Firefox MV2, installs the
same way as the other Orion extensions in this workspace.

**Picks (locked Nov 17, 2026): Core + B, C, E, H, I, J — plus K (anti-detect
pack) added in v1.1.0 the same day.**
Not picked, therefore not in here: A element picker, D dynamic filtering,
F procedural cosmetics, G annoyances lists (the K pack's warning-removal
list is the one annoyances-class list included, because it is an
anti-detection measure).

## First run

1. Install the `.xpi` in Orion.
2. Tap the extension icon — the **dashboard opens as a tab** (toolbar
   popups do not render on Orion, so there is deliberately no popup).
   The dashboard can also be reached from Orion's extension options.
3. Lists download automatically the first time the dashboard opens
   (or tap **Update now** on the Filter lists tab). Nothing is blocked
   until the compiled set exists — the shield pill on pages will say so.
4. Open the **Diagnostics** tab and run the probe (see below). It tells
   you which blocking layer is actually alive on your Orion build.

## Same lists, same sources, auto-updating

Default set, identical to a stock uBlock Origin install:

- uBlock filters – Ads / Badware risks / Privacy / Quick fixes / Unbreak
  (`raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/…`)
- EasyList (`easylist.to/easylist/easylist.txt`)
- EasyPrivacy (`easylist.to/easylist/easyprivacy.txt`)
- Online Malicious URL Blocklist (URLhaus filter)
- Peter Lowe's Ad and tracking server list

Auto-update honours each list's own `! Expires:` header (uBlock filters
say 5 days), falling back to the dashboard interval (default 24 h). The
check runs in the background page **and** whenever the dashboard opens,
because Orion may never wake the background page. Lists are fetched,
parsed, and stored per list; a compiled set is rebuilt on any change and
kept in `storage.local` in 700 KB chunks (the dashboard shows its size —
expect a few MB).

## How blocking works — three layers

1. **webRequest (background)** — the real thing: blocking
   `webRequest.onBeforeRequest` with the compiled network matcher
   (domain-bucketed `||` rules + generic scan, `@@` exceptions,
   `$type` / `$domain=` / `$third-party` / `$important` / `$badfilter`),
   plus header-stage rules for the per-site switches. **This is the same
   API whose breakage disabled real uBO.** Diagnostics records whether
   the listener registered, whether it ever fired, and whether it ever
   cancelled. If it is dead, this layer silently does nothing and the
   layers below are your protection — the Logger labels every entry with
   the layer that produced it so you can see the truth per request.
2. **Content layer** — cosmetic filters as grouped `<style>` rules
   (re-inserted if a site strips them), DOM scriptlets, fallback element
   removal (script/img/iframe/source/link nodes pointing at pure
   `||domain^` hosts), and the per-site switch fallbacks.
3. **Page-world fallback (I)** — `page-hook.js` wraps `fetch`,
   `XMLHttpRequest`, `sendBeacon` and `WebSocket` and blocks requests to
   `||domain^` hosts, and implements the scriptlets.

## Features by pick

- **B Logger** — shared 400-entry ring in storage; dashboard Logger tab
  with text filter. Layers: webRequest / fallback / content / scriptlet /
  switch / youtube.
- **C Per-site switches** — no popups, no large media (>50 KB at the
  header stage; click-to-play for media elements in the fallback), no
  remote fonts (network type block + `FontFace` hook), disable
  JavaScript (CSP `script-src 'none'` at the header stage;
  `beforescriptexecute` + script stripping in the fallback). Set them
  from the shield pill on any page or the dashboard tab. The pill also
  carries the per-page blocked count and this-site on/off.
- **E Scriptlets** — `##+js(...)` engine with: set-constant / set,
  abort-current-inline-script, abort-on-property-read/write, aopr/aopw/
  acis/aeld aliases, no-setTimeout-if / no-setInterval-if (+ nosiif /
  nostif), no-fetch-if, no-xhr-if, json-prune, json-prune-fetch-response,
  json-prune-xhr-response, trusted-replace-xhr-response,
  trusted-replace-fetch-response (+ trusted-rpfr), set-cookie,
  remove-cookie, alert/confirm defusers, addEventListener-defuser,
  noeval, and the DOM scriptlets remove-attr, remove-class,
  href-sanitizer. Unknown scriptlets are counted in the Logger as
  unsupported rather than silently dropped.
- **H Custom lists + backup** — add any list by URL on the Filter lists
  tab; export/import all settings, switches, My Filters and custom list
  subscriptions as one JSON file.
- **I Fallback mode** — layers 2–3 above; automatic, always on, and the
  Diagnostics tab states plainly when it is the only thing working.
- **J YouTube** — the uBlock Quick Fixes + filters lists do the heavy
  lifting (including the `trusted-replace-xhr-response` adPlacements
  scriptlets, implemented in the hook for both XHR and fetch), plus
  built-in player-response pruning injected on YouTube domains regardless
  of list state (`ytInitialPlayerResponse` ad fields set to undefined,
  `json-prune` / `json-prune-fetch-response` over the ad paths — the
  prune engine handles `*`, `[n]` and `[-]` path segments since v1.2).
  For an ad that still reaches the player, the content layer now
  **seeks to the end of the ad first** (v1.2 fix: v1.1 waited for the
  skip button and only fast-forwarded the rest, which left skippable
  ads demanding a manual Skip) — muted, at 16×, jumping to
  `duration − 0.2s` — then clicks the real skip button with the full
  pointer/mouse event sequence as a verified second punch, re-clicking
  if the ad survives. A MutationObserver on the player reacts the moment
  an ad starts; the poll runs every 250 ms. Rate/volume are restored
  when the ad ends. Remaining hole, stated plainly: an ad whose
  `duration` never becomes finite (some live/VOD-inserted ads) only gets
  the 16× + mute + skip-click treatment, not the seek.

## K — anti-detect pack (v1.1.0)

- **`$redirect` / `$redirect-rule` engine.** When a blocking filter carries
  a redirect, the request is answered with an inert stub instead of a
  cancel, so detector code loads, runs, and finds no blocker. Bundled
  stubs (served as `data:` URLs by the background layer, and as synthetic
  responses by the page-world fallback for fetch/XHR): `noopjs`,
  `noopcss`, `nooptext`, `noopframe`, `empty` (type-mapped),
  `fuckadblock.js-*` (a working FuckAdBlock API whose `check()` only ever
  fires *notDetected*), `adsbygoogle.js` (defines a benign
  `window.adsbygoogle`), `google-ima.js` (IMA SDK surface that never
  errors), `noopvast-*` (empty VAST). Unsupported resources (e.g.
  `noopmp4-1s`) fall back to a plain cancel and say so in the Logger.
  Redirects appear in the Logger with action `redirected`.
- **Adblock Warning Removal List** added to the registry
  (`easylist-downloads.adblockplus.org/antiadblockfilters.txt`), on by
  default, toggleable on the Filter lists tab like any other list.
- **Stealth pass.** The pill, cosmetic `<style>` and hook config elements
  get per-page random IDs (no fixed `ubo-orion-*` fingerprints), the pill
  uses a **closed** shadow root, the config element is removed the moment
  the hook reads it, and every wrapped page function (`fetch`, XHR
  `open`/`send`, `setTimeout`, `setInterval`, `sendBeacon`, `WebSocket`,
  `window.open`, `FontFace`, `eval`) reports a native-looking
  `toString()`. Limit, stated plainly: this defeats `fn.toString()`
  checks; `Function.prototype.toString.call(fn)` source inspection can
  still reveal a wrapper — real uBO's anti-detection has the same class
  of limit against a sufficiently determined detector, and bait-element
  measurement (`display:none` geometry) remains detectable in principle,
  countered only site-by-site by the lists' scriptlets.

## Honest limits — this is not an exact uBO replica

- If Orion's `webRequest` blocking is dead, **no extension can truly
  block parser-loaded network requests** — the fallback cannot stop a
  `<script src>` that the parser executes before the MutationObserver
  microtask runs (same class of race as the Popup Blocker's iframe gap),
  and it cannot see requests made by other frames' service workers.
- **Procedural cosmetics are not applied** (F was not picked):
  `#?#` filters and `##` selectors using `:has-text()`, `:xpath()`,
  `:matches-css()`, `:remove()`, `:style()` etc. are counted in the
  dashboard status line as unsupported.
- Network actions `$removeparam=`, `$replace=`, `$csp=` are parsed but
  not applied (the YouTube `replace=` family is covered by the equivalent
  trusted-replace scriptlets in the lists themselves). `$redirect=` IS
  applied since v1.1.0 (K pack, above), for the bundled stub resources.
- HTML filtering (`##^`) and `#$#` style rules are not applied.
- The generic (non-domain-bucketed) network rules are scanned linearly
  per request in the background; with ~150k rules loaded this is the
  same trade-off every JS matcher makes, and heavy pages may feel it.
- `browser_action` badge counts depend on the background page running.

## Diagnostics probe

Dashboard → Diagnostics → **Run webRequest probe** opens
`pagead2.googlesyndication.com/pagead/js/adsbygoogle.js` (EasyList-covered)
in a new tab. Blocked tab + a `webRequest / blocked` Logger entry = the
network layer lives. Script loads and displays = it's dead, fallback only.

## Files

`engine.js` (parser/matcher), `storage.js` (chunked storage + logger +
settings), `updater.js` (registry/fetch/compile), `resources.js` ($redirect
stubs), `background.js` (webRequest + auto-update + diagnostics),
`content.js` (cosmetics, switches, YouTube, pill), `page-hook.js`
(page-world fallback + scriptlets), `dashboard.*`. Tests:
`node tests/engine.test.js`, `node tests/resources.test.js`,
`node tests/sim.test.js` (simulated runtime: updater → storage →
compiled → matcher round-trip), `node tests/hook.test.js` (simulated
page world: stub serving, fallback blocking, toString stealth).

## v1.2.1 hotfix — total page-load failure

After v1.2.0, Kurt reported no websites loading at all. A filter whose
pattern matches every URL, applied to the top-level navigation request,
cancels the page itself — and this engine (unlike desktop uBO's
hardened pipeline) let plain filters act on `main_frame` requests and
compiled ungated match-all patterns verbatim. Fixed by construction,
in three layers, so the failure class cannot recur:

1. **Compile time** — an ungated match-all pattern (bare `*`, `||`,
   separator-only) with no `$domain=` and no type restriction is
   dropped and counted as unsupported. Domain- or type-gated match-alls
   (legitimate list rules) are kept.
2. **Request time** — a top-level navigation (`main_frame`) may only
   be blocked or redirected when the matched filter explicitly carries
   the `$document` type; anything else is allowed through and logged
   (`main_frame guard`). Any matcher exception also fails open.
3. **Cosmetics** — selectors targeting the page root itself (`*`,
   `html`, `body`, `:root`) are dropped from cosmetic results.

The compiled set is rebuilt automatically on first run of the new
engine (version stamp) and on every dashboard open, so the fix applies
to already-downloaded lists without waiting for a list update.

## v1.2.2 — navigation silently ignored (the real v1.2 regression)

Kurt's clarification: typing a URL did nothing at all, "like I never typed
anything" — no error page, no load. That symptom points past the
v1.2.1 guard (which only runs *after* the matcher returns): the
matcher itself was the hang. `createMatcher` tested **every** generic
filter's regex against **every** request, synchronously, inside the
blocking `webRequest` listener — with ten lists compiled, tens of
thousands of regex tests per request on a phone CPU, so the listener
effectively never answered and Orion silently dropped the
navigation. It surfaced when the tenth list (Adblock Warning Removal)
first compiled, which is why v1.1 browsed fine and v1.2/v1.2.1 did
not.

Fixes:

1. **Navigations are never intercepted.** The listener returns for
   `main_frame` before any matching runs. `$document` filters are the
   accepted cost; subresource blocking is unchanged.
2. **Token-indexed generic matching** (what uBO itself does): each
   generic filter is indexed under its longest literal token; a
   request only regex-tests filters whose token appears in its URL,
   plus a small always-test set (regex-syntax / match-case / tokenless
   patterns). Test: 200 matches against 20,000 generic filters in 3 ms.
3. **Pathological patterns dropped at compile time**: generic-bound
   patterns with >= 3 wildcards and no literal run of 4+ chars — the
   catastrophic-backtracking shape — are counted unsupported instead
   of compiled.
4. The whole listener fails open on any exception.

The token index is built when the matcher loads, so it speeds up even
an already-stored compiled set; the compile-time drops apply on the
automatic rebuild (engine stamp / dashboard open).

## v1.2.3 — visuals-safe blocking

Kurt's screenshots: GitHub rendered with **no CSS at all** (raw HTML)
and YouTube was a black shell. Navigation itself worked again (the
v1.2.2 fix held) — the problem had moved to over-broad blocking of
sites' own assets:

- The content fallback removed `<link>` elements by domain-only
  match — a domain match cannot tell a site's stylesheet from an ad.
  **LINK elements are never removed now**, and the fallback never
  touches same-party elements at all.
- In the network layer, generic (non-domain) filters could cancel a
  site's stylesheets, fonts and same-party requests (including its
  CDN hosts, e.g. github.githubassets.com). **Visuals guards**:
  stylesheets/fonts and same-party requests can now only be blocked
  by a filter written for that exact host, or an `$important` one.
  Third-party ad/tracker blocking is unchanged. "Same party" covers
  subdomains, the same registrable domain, and CDN-style hosts whose
  SLD extends the site's (`githubassets` ⊃ `github`); lookalikes
  (`evilgithub.com`, `github.evil.com`) do not qualify — both cases
  are unit-tested.
- The page-world fallback likewise never blocks the page's own party
  (a broad rule putting a platform's own domain in the block set
  would otherwise reject its first-party API calls — the YouTube
  black-screen shape).
- The v1.2 built-in **duplicate** YouTube scriptlets are removed:
  the lists carry the same scriptlets (v1.1 proved list-only works),
  and double-wrapping YouTube's JSON/fetch handling was needless
  risk. The v1.2 seek-to-end + verified skip-click handler stays.
- Fetch response reconstruction no longer carries the original
  `content-length`/`content-encoding` into a rewritten body (a stale
  length truncates the JSON an app is reading).

## v1.2.4 — light-touch platforms + party media hosts

Kurt: GitHub fixed by v1.2.3; YouTube still a black shell; X/Twitter
videos not loading. Direction from Kurt: "less aggressive."

- **Light-touch mode** on youtube.com / x.com / twitter.com: no
  page-world scriptlets at all. The scriptlet family (json-prune,
  trusted-replace, set-constant…) rewrites these apps' own JSON/fetch
  data path — the one layer that can corrupt a fragile SPA without
  blocking a single request. What remains on those sites: network
  ad-domain blocking, cosmetics, the element fallback, and (YouTube)
  the seek/skip ad handler.
- **YouTube cosmetics are specific-only**: generic cosmetic selectors
  no longer apply on YouTube, only selectors written for YouTube
  (plus the built-in YT ad-renderer set).
- **Platform party groups**: X serves video from twimg.com, YouTube
  from googlevideo.com/ytimg.com — separate brands, same party.
  `samePartyHost` now knows the groups (X/Twitter, YouTube, Meta,
  Reddit, Twitch, Spotify, Netflix, Amazon, TikTok), and same-party
  **media** (video/image/css/font) can only be blocked by an
  `$important` filter — a broad rule against a shared media host can
  no longer kill every video on the platform, in either the network
  layer or the page-world fallback.
