# HeckYeah for Orion — v0.12.3

Back to v0.12.0 (Kurt's call): the popup is the streaming-only
home again (renderPopShelves + star toggles + drag reorder,
restored verbatim from the v0.12.0 package), undoing the
v0.12.2 revert. Postscript on the v0.12.0 popup hang: it WAS
the stale-cache mix from the first diagnosis — quitting Orion
cleared the cached old popup script and the menu loaded.
Kept from v0.12.1: the extGet storage hardening in common.js
(invisible; a storage read can never stall a boot). The
instrumented popup boot from v0.12.1 is NOT kept — popup.js is
exactly v0.12.0's. Version is 0.12.3 (not 0.12.0) so installs
and the update feed stay monotonic.

# HeckYeah for Orion — v0.12.2

Popup reverted (Kurt's request): the extension menu is back to
the v0.11.0 layout — Continue Watching + the 12-category grid
with tap-through category shelves and the back button. The
v0.12.0 popup changes (streaming-only popup home, star toggles
and drag-reorder in the popup) are undone; those features remain
in the in-page app view, which is unchanged. The AirPlay toggle
does NOT return — that feature stays removed everywhere. The
v0.12.1 storage hardening and the instrumented popup boot are
kept (they're also what the reverted popup boots through).

# HeckYeah for Orion — v0.12.1

Popup hang fix. On-device the toolbar popup sat on "Loading…"
forever (a clean reinstall did not help — the shipped popup code
was verified clean). Root cause class: the shared storage read
(extGet in common.js) called .then() directly on whatever
browser.storage.local.get() returned and had no timeout, so in
any context where that call returns undefined or a promise that
never settles, loadStore() never resolved and the popup boot
(which had no rejection handler) silently died. extGet now
settles in every case — promise style, callback style, or a 3 s
self-timeout that falls back to the localStorage mirror — and
the popup boot is instrumented: a stall or throw renders a boot
log in the popup instead of hanging. Verified in simulation
against all three broken-storage shapes.

# HeckYeah for Orion — v0.12.0

Cleaner tiles, drag-to-reorder, streaming-only popup, no AirPlay:
- The popup's home is now the same as the app view: Continue
  Watching + the Streaming shelves (fetched from /video). The
  category grid is gone there too.
- The up/down buttons are gone. Long-press any site tile
  (~260 ms, finger still) to pick it up, drag it along the shelf,
  and the other sites slide out of the way; drop to save the new
  order. Works in the app view (horizontal shelves) and the popup
  (vertical lists). The favorite star is now a small button in
  the tile's corner — the only control left on the tile.
- The AirPlay: Forced feature is removed entirely: no header
  chip, no popup toggle, and the tracker no longer touches
  disableRemotePlayback / x-webkit-airplay on videos.

# HeckYeah for Orion — v0.11.0

New: an in-extension update checker (`update-check.js`). It can
DISCOVER a newer version and offer it — it cannot install updates
itself (no WebExtension API does that); the offer opens the new
.xpi download link and you install from file in Orion, as today.

## Updates
- The checker polls a Firefox-style update feed
  (`addons → heckyeah-orion@local → updates[]`, highest version
  strictly newer than the installed one wins). Default feed:
  `https://raw.githubusercontent.com/kcm2019/Orion-Extensions/main/updates.json`
  — overridable via the `upd_feed_url` storage key.
- Caveat: that repo is PRIVATE today, so an unauthenticated fetch
  may 404. Auto-checks fail silently in that case; a manual check
  reports honestly (up to date / update available / couldn't reach
  the feed) — never a false "up to date".
- Auto check: throttled to once per 12 h, run when the app-view
  Home renders and when the popup opens.
- Notice: a slim banner at the top of the app-view Home (above
  Continue Watching) — and in the popup — when an update is found
  and not dismissed: **Download** opens the .xpi link, ✕ dismisses
  that version.
- Manual check: "Check for updates" in the app-view Home footer
  row and in the popup footer, with the result reported inline.
- The checker is loaded on fmhy.net and in the popup only — not
  in the tracker (<all_urls>) context.

# HeckYeah for Orion — v0.10.0

Home is streaming-only, and shelves are yours to arrange:
- The app view's main screen no longer shows the 12-category
  grid. Home = Continue Watching + the Streaming shelves, fetched
  from /video and parsed with the same walker as the category
  pages. (Other categories still exist on fmhy.net itself via
  🌐 Web; the popup is unchanged.)
- Every streaming-site tile now carries three controls: a ☆/★
  favorite toggle and ▲/▼ reorder buttons. Favorites sort to the
  top of their shelf; the custom order (full displayed order per
  shelf) persists in the store (favorites / siteOrder), and the
  popup's shelves honor the same sorting.

# HeckYeah for Orion — v0.9.0

New: the app lives in the toolbar popup. Clicking the extension
icon opens a compact HeckYeah: Continue Watching (grouped, with
progress + time left) and the category grid (parsed live from
fmhy.net, seed fallback offline). Tapping a category navigates
INSIDE the popup — shelves parsed live from that category page —
and tapping a site opens it in a tab, armed for tracking exactly
like a tap in the app view. Footer: Open full app + the AirPlay
toggle. Platform unknown, stated plainly: whether Orion iOS
renders browser_action popups at all is unverified (the same open
question as the Beautiful Reader popup) — this build is the test;
the in-page app view is unchanged either way.

# HeckYeah for Orion — v0.8.3

New setting: **AirPlay: Forced** (app-view header chip, default ON).
Streaming sites suppress the AirPlay button in the iOS native
player two ways — the `disableremoteplayback` attribute/property
and `x-webkit-airplay="deny"`. While forced, the tracker strips
both from every <video>, keeps stripping them when a player
re-applies them (attribute observer), and re-asserts at the
moment a video enters native fullscreen, so the system player's
AirPlay/route button is available whenever iOS permits routing.
Honest limit: the button itself is drawn by iOS, not the page —
an extension can remove every page-level block, but if WebKit
declines to offer routing for a stream (e.g. some DRM/EME
sessions), no page code can conjure the button.

# HeckYeah for Orion — v0.8.2

Persistence: an established connection was dying within seconds.
Two 0.8.1 mechanisms could tear down a healthy session, both now
removed in favor of the TV build's rule — no single socket event
may end a pairing:
- ICE 'failed'/'closed' no longer drops the connection directly.
  The phone now runs a heartbeat (ping every 4s, host answers
  pong); the ONLY drop authority is 12 straight seconds without a
  pong, which no transient blip can produce. A real death still
  reconnects to the same session automatically.
- The host never yields the stage while it is serving a live
  phone (traffic within 12s), so a tab switch can no longer murder
  an active session from the host side; handoff happens only once
  the old host has genuinely gone quiet or away.

# HeckYeah for Orion — v0.8.1

URL-switch persistence + clicks that reach real players:
- Reconnect hardening (the Fire TV v1.38 pattern): connection
  generations — a superseded socket's handlers are inert, so a
  stale close can never kill a fresh connection; ICE failed/closed
  counts as a drop (it may never fire 'close') and the phone
  redials the SAME session — the session IS the credential, the
  host re-accepts a paired phone with no new code. Host reclaim is
  fast now: 2s roam ticks, 5s stale threshold, a visible page
  probes hosting immediately (unavailable-id = stand aside), and
  visibilitychange claims the stage the moment a tab comes front.
- Clicks: players mostly live in cross-origin iframes, where a
  click on the <iframe> element goes nowhere — commands now relay
  INTO the frame under the cursor with translated coordinates.
  Clicks use the full pointer/mouse sequence with retargeting to
  the nearest clickable ancestor, and cursor moves emit throttled
  mousemove/pointermove so hover-revealed controls wake up first.
  Media commands broadcast to all frames; the frame holding the
  video answers. Honest limit: extensions can only send synthetic
  (untrusted) events — a player that hard-requires trusted input
  will still refuse; no extension can change that.

# HeckYeah for Orion — v0.8.0

Pairing rebuilt to the Fire TV v1.37 flow, exactly:
- The QR now carries ONLY the room. The phone opens it, connects,
  and REQUESTS pairing by itself (no tap needed to start).
- The host generates a one-time 6-digit code (60s, single active
  request), sends it to the phone, and POPS the pairing card on its
  own: "Pair this phone?" — the same code shows on both screens.
- Confirm from EITHER side: Pair on the phone, or Accept on the
  host card (Reject lives on the host too).
- Returning phones (session already paired) are re-accepted with
  no code; roaming/tab handoff from 0.7.0 is unchanged.
- Debugging: BOTH sides now carry a CONNECTION LOG (broker connect,
  channel open, ICE states, code issued, confirm, errors) — if it
  stalls, the last lines name the dead step. The full sequence is
  covered by a state-machine simulation (tests/sim-pairing.js).

# HeckYeah for Orion — v0.7.0

Two reversals from on-device results:
- The 0.6.0 background-page host never finished connecting on
  Orion (phone sat at "Connecting…"). The host is back in the page,
  but now it ROAMS: the session {room, code, paired} is stored, the
  visible tab hosts via a heartbeat/want-host handoff, a page that
  loads with a live paired session re-hosts the same room and
  silently re-accepts the phone, and the phone reconnects on its own
  (peer-unavailable = host mid-navigation, keep retrying). Pair once;
  tab switches and navigation no longer need a re-pair.
- In-site resume is GONE entirely. The tracker only records
  position for the app view; it never offers, seeks, or touches the
  timestamp on a streaming page. (Autoplay interference reports
  across 0.4.2–0.6.0 all traced to resume attempts.)
Also fixed: the phone remote's header rendered raw HTML as text.

# HeckYeah for Orion — v0.6.0

Persistent pairing + design round:
- The pairing host moved into a background page (background.js).
  Pairing now survives tab switches and full navigations — resume a
  video into another tab and the phone stays paired. The background
  owns the PeerJS session and routes each command to the currently
  visible tab (content scripts report visibility; no tabs permission
  needed). If the background page doesn't answer, content scripts
  fall back to the 0.5.x in-page host automatically.
- Once paired there is no expiry; the 60s countdown only guards the
  unpaired code. Host card gains a Connected state with Now Playing
  and Disconnect. The phone remote auto-reconnects (3 tries) if the
  connection drops.
- Apple-design pass on both pairing surfaces: iOS-sheet host card
  (grab handle, glass, QR tile with shadow, tabular code, status
  row) and a rebuilt phone remote — status pill, pairing card,
  Now Playing card (title + Playing/Paused, fed live by the tracker),
  glass trackpad card, round transport cluster (primary play/pause),
  wide Next / App+PiP buttons, keyboard row, Disconnect.
- background.js pair/route logic is smoke-tested in Node
  (pair, deny, exec routing, now-playing forward).

# HeckYeah for Orion — v0.5.1

Fixes from on-device testing of 0.5.0:
- QR code never appeared (a white dot): the QR library's SVG output
  has no intrinsic size and collapsed under the site's CSS. The QR
  is now drawn to a canvas from the module grid, and the pairing URL
  is printed under it as a type-it-manually fallback.
- Minimal-touch tracker: resume/next-episode toasts now render in
  the TOP frame — the tracker injects nothing into player iframes
  (a backdrop-filter toast composited over the video can stall
  players). The Resume tap now ONLY seeks (no play() call), the
  video MutationObserver disconnects at 12s instead of 30s, and a
  code audit confirms the only remaining timestamp/play touches are
  user-initiated: the Resume tap and paired-phone media buttons.

# HeckYeah for Orion — v0.5.0

New in 0.5.0:
- PiP hand-off: tapping "‹ HeckYeah app" while a video plays pops the
  video into picture-in-picture first (WebKit or standard PiP, site
  PiP blocks cleared), so playback survives the trip to the app view.
  In PiP, tapping the video gives pause and a return-to-site button
  (native iOS PiP controls).
- Resume reverted to the original: an arrival popup, "Resume at T?"
  with [Resume] / [Start over]. It never seeks on its own. (The
  play-gated auto variant from 0.4.2 broke on autoplaying sites.)
- Phone QR pairing: 📱 Remote in the app-view header, 📱 Pair phone
  in the streaming-site sheet. Scan the QR with the phone (opens in
  Orion), compare the 6-digit code on both screens, tap Pair. The
  phone becomes a remote: trackpad cursor (drag / tap / two-finger
  scroll), keyboard, play/pause, ±10s, next episode, App + PiP.
  Channel is WebRTC via the free PeerJS cloud broker — an extension
  can't run the TV app's LAN server. Vendored libs in vendor/
  (peerjs 1.5.5, qrcode-generator 1.4.4, both MIT-style licenses).

# HeckYeah for Orion — v0.4.2

New in 0.4.2: the Resume button on Continue cards is gone (clicking
a recently watched entry just opens the saved link), and the resume
prompt moved off page load entirely. Nothing is drawn and nothing
seeks while a site loads. When the video actually starts playing —
once per page — a popup appears: "Left off at 12:34" with
[Go back to 12:34] and [Start over]. The load-time prompt was
suspected of wedging some players until fullscreen + play.

# HeckYeah for Orion — v0.4.1

New in 0.4.1 (reverts the 0.4.0 default): the app interface is the
default screen on fmhy.net again — the overlay opens on launch with
Continue Watching (recently played) at the top of Home, like the
Fire TV app. Continue cards gained an explicit ▶ Resume button that
jumps straight back into the latest episode (the tracker then offers
the saved position on the site). The pill lives on streaming sites;
its "‹ HeckYeah app" button lands on this interface. On fmhy.net the
pill only appears after 🌐 Web and reopens the interface.

New in 0.3.0: category tiles fixed (fmhy.net's VitePress router was
hijacking the taps — a capture-phase handler now forces a real
navigation), and season/episode capture strengthened: URL query
params, JSON-LD TVEpisode data, a DOM scrape (og:title, headings,
season/episode UI), re-checks after metadata and a few seconds in,
and an SPA watcher that treats in-site episode changes as new pages.

New in 0.2.0: liquid-glass redesign (ambient colour orbs, glass sticky
header, section headers, one clean tag line per tile — the mirror
"or"/comma debris and the duplicated pill rows from 0.1.0 are gone);
a **draggable HeckYeah pill on streaming sites** — drag it anywhere
(position is remembered), tap it to open a Recent shows sheet with a
**‹ HeckYeah app** button back to the interface; tracking hardened
(arm on pointerdown, tracker re-checks the store for the first few
seconds, position also saved on pagehide).

The HeckYeah TV interface as an Orion extension over fmhy.net, with
Continue Watching + resume on the streaming sites you launch from it.

Locked picks (Kurt, Nov 14, 2026): tracker scope **1 (armed-only)** +
**D** progress with full timestamps, **E** next episode, **F** group by
show, **G** robot-popup sweep. Not included: search, favorites, mirror
picker, filters.

## What it does

- **fmhy.net overlay** — Home gets a Continue Watching shelf first
  (grouped by show; tap a show card to expand its episodes, ✕ removes
  one, Clear-all card at the end of the shelf), then the category tiles.
  Category pages become shelves from the page's own headers, applet
  tiles with name / description / tag pills, ★ for FMHY-starred sites.
  A 🌐 Web button exits to the stock site; if parsing fails the stock
  site is left untouched and only a 📺 pill appears (circuit breaker).
- **D — timestamps** — every Continue card and episode row shows
  `position / duration · time left` plus a progress bar. Episodes at
  ≥92% watched are marked finished and drop off the shelf.
- **Armed-only tracking** — clicking an applet on the Video page arms
  that host. The tracker runs invisibly everywhere else and exits
  instantly on unarmed hosts.
- **Resume** — on an armed site the tracker records the page once a
  `<video>` appears, saves position (throttled, and on pause/end), and
  on a later visit offers a "Resume at 12:34?" pill — tap Resume to
  seek + play. It never auto-seeks. If the player lives in an iframe,
  the tracker inside that frame keys playback to the embedding episode
  page (via referrer/ancestor origin).
- **E — Next episode** — a next-episode link found on the episode page
  is stored on the entry, shown as a badge/link in Continue Watching,
  and offered as "Play next ›" when an episode ends.
- **G — Sweep** — on armed sites' top frames, overlays carrying
  robot-check phrases ("not a robot", "scan the qr-code", …) are
  DELETED (HeckYeah TV v1.46 rules: positioned ancestor walk-up,
  ≥10% viewport area or ≥60% width/height, cap 6/page, scroll-lock and
  empty-backdrop cleanup after removal; video containers and
  Cloudflare/Turnstile frames are never touched).

## What M0 exists to answer

1. Does the overlay parse and render on the real fmhy.net in Orion?
2. Does `browser.storage.local` persist AND carry data across origins
   in Orion iOS? The overlay footer is the probe: `storage: ext` +
   the visits counter should survive an app restart, and a show you
   watched on a streaming site should appear in Continue Watching back
   on fmhy.net. If it reads `local-only`, resume still works per-site
   but the FMHY shelf can't see it — that distinction is the result.
3. Does position capture + the resume pill work on a real episode
   page, including when the player is an embedded iframe?
4. Does the sweep delete a real robot popup (movy.sx is the test case
   from the TV app)? The footer count (`sweep removals N`) is the tell.

## Install (Orion iOS)

1. Download the `.zip` (don't unzip) — it lands in Files → Downloads.
2. Orion → Settings → Extensions → turn **Firefox extensions** on.
3. ••• → Extensions → **+** → Install from File → pick the `.zip`
   (or the `.xpi`), then enable it and refresh fmhy.net.

## On-device checklist

1. Open fmhy.net → HeckYeah Home appears; footer shows visits 1.
2. Force-quit Orion, reopen fmhy.net → visits should read 2 and
   storage should say `ext`.
3. Video category → shelves render; tap an applet (e.g. Movy) — the
   site opens normally.
4. Open an episode, play a few minutes, pause, leave.
5. Back on fmhy.net → Continue Watching shows the show, grouped, with
   `pos / duration · left` and a progress bar.
6. Reopen the episode from the shelf → "Resume at …?" pill appears;
   Resume lands at the saved position.
7. If a robot popup appears on the streaming site, note whether it
   vanishes and whether the footer sweep count went up.
8. Finish an episode (>92%) → it should drop off the shelf; if a next
   episode was detected, the badge / end-of-episode prompt shows it.

## Honest limits

- Armed-only is by design (your pick): sites you open directly, not
  via the Video shelf, are never tracked.
- Resume needs a real `<video>` element; iframe players depend on
  Orion injecting content scripts into frames (`all_frames`).
- Some sites keep their own resume — ours never auto-seeks, so the
  worst case is two prompts, not a fight.
- Episode/show parsing is heuristic (title + URL patterns); odd titles
  fall back to the cleaned page title.
- Storage persistence in Orion iOS is unproven — that's M0 question 2,
  not an assumption.
