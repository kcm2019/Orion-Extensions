# Element Blocker for Orion — SPEC

Requested Nov 17, 2026: a Safari Distraction Control / Hide Distracting
Items clone for Orion — tap an element, it dissolves — except permanent:
Safari does not permanently hide frequently-updating items and loses
private-window hides; this extension saves a selector per site and
re-hides on every load.

Picks locked Nov 17, 2026: **Core + A (widen/narrow), B (full particle
dissolve), D (re-hide dynamic copies), E (manager page), F (zap mode),
G (scroll-unlock + collapse), H (export/import backup).**
Not picked: C (per-hide scope choice — default is whole hostname, all
pages), I (build into orion-ublock — this is standalone).

## Core design

- Firefox MV2, content script at document_start, no reliance on
  browser_action popups (confirmed dead on Kurt's Orion) or on a
  background host. No in-page pill (removed in v1.1.0 at Kurt's
  direction): the toolbar icon click messages the active tab and the
  menu pops up over the current site, in a shadow root.
- Permanent rules: `{ host: [{ id, selector, fingerprint, created, hits }] }`
  in browser.storage.local (chrome.storage, then localStorage fallback).
- Re-hiding is two-layer: (1) a generated `<style>` with every saved
  selector (`display:none !important`) — the browser itself hides
  re-inserted matching nodes, no flash where timing allows; (2) a
  MutationObserver fingerprint scan (D) for copies whose classes changed.
- Picker: tap = select (blue outline, element summary), Wider/Narrower
  walk the ancestor stack (A), then Hide (permanent) or Zap (F).
- Dissolve (B): snapshot the element to canvas via SVG foreignObject;
  if that succeeds and the canvas is untainted, particles sample real
  pixels. If it fails (cross-origin images, external CSS), particles
  fall back to the element's computed colour palette in its box shape,
  over a blurring/fading clone. Auto re-hides never animate — only
  user-initiated hides dissolve.
- Zap (F): session-only, in-memory attribute + style, never written to
  storage; gone on reload.
- G: hiding a fixed/absolute element covering >=30% of the viewport
  releases body/html scroll locks (inline overflow + common lock
  classes) when no other large visible overlay remains; empty wrapper
  ancestors (no text, no visible children) are collapsed up to 3 levels.
- Manager (E): options page opened in a tab (from the icon menu).
  Rules grouped by host, selector editable, per-rule and per-site
  delete, hit counts, total counts.
- Backup (H): export all rules as JSON (download), import merges with
  dedupe by host+selector; invalid files are rejected whole.

## Honest limits

- Cannot pick inside a cross-origin iframe (top-frame elements only,
  the iframe element itself can be hidden).
- Sites that randomise class names per load break pure selectors;
  fingerprint matching (tag + stable id/data attrs + text + position +
  size) is the mitigation, threshold-tuned to avoid false positives,
  not a guarantee.
- Snapshot dissolve will fall back to palette particles on many real
  pages (CORS-tainted or external-resource content). Both paths are
  delivered; which one ran is not shown to the user.
- document_start + async storage means a first-paint flash of a hidden
  element is possible on fast loads; the style is injected as soon as
  storage resolves and the observer covers the rest.

Status: v1.0.0 built Nov 17, 2026. **v1.1.0 (Nov 17): pill removed —
toolbar icon click toggles the menu overlay over the current site
instead of opening the manager webpage; manager stays reachable from
the menu. If Orion does not fire browserAction.onClicked there, the
menu cannot open — that is the on-device question for this build.**
See README for test results.
Build/simulation-verified only until Kurt's on-device verdict.

## v1.2.0 (Nov 17, 2026) — on-device feedback round

Kurt's v1.1 verdict (screenshot, gamesradar.com Admiral anti-adblock
wall): icon click DID fire and the menu opened, but it rendered BELOW
the wall, unusable. Changes:
- UI root is now a full-viewport overlay root at max z-index, moved to
  last-in-DOM on open, re-asserted by a 500 ms watchdog while open,
  and put in the browser top layer via manual popover where WebKit
  allows — walls cannot cover it by z-index or DOM order.
- Selection-first: icon click opens the picker directly; Wider /
  Narrower / Hide / Zap buttons appear only after an element is
  selected. Full menu via the bar's ⋯ Menu button.
- Stay-open: Hide/Zap act, clear the selection, and stay in the
  picker; menu actions (Show hidden, Undo) stay in the menu. The
  session ends only on Close, Esc, or a second icon click.
- Mid-dissolve elements are marked data-eb-hiding so they can't be
  re-selected during their own animation.

## v1.3.0 (Nov 17, 2026) — still under the wall + logging

Kurt: v1.2 still not on top (gamesradar link supplied; the page 403s
non-browser fetches, so the device log is the evidence path).
Root-cause candidates found in our own v1.2 code, from the Beautiful
Reader Nov 16 lessons: (1) the watchdog DOM-moved the host while its
popover was open — moving a :popover-open element kills the popover;
(2) the popover attribute was set unconditionally — with no open
popover the UA stylesheet hides the element outright.
v1.3.0: popover attr only when showPopover exists; a popover host is
never DOM-moved (top-layer re-entry hide+show instead); no-popover
mode moves the host to last child of <html>. Fight loop (250 ms):
elementFromPoint probe at the panel centre; on occlusion it logs the
occluder + root competitor, re-enters the top layer, demotes the
root competitor to z-index 2147483646 !important, and hides a
top-layer occluder for the session — all demotions/hides recorded
and restored on close. Debug log: ring buffer (boot, mode, probe,
fight, pick, hide, errors), in-page viewer (menu → Debug log, Copy
button), persisted to storage as eb_debug_v1 and shown in the
manager with a Copy button, so Kurt can paste it back even if the
in-page UI is unreachable.

## v1.4.0 (Nov 17, 2026) — Wall Breaker (Kurt approved the plan)

Automatic anti-adblock-wall breaking, no UI interaction (the stacking
war is sidestepped): (1) document_start CSS pre-hides iframes from
error-report.com / getadmiral.com / admiral.digital; (2) a scan
(wb.js scoring: known wall iframe src at >=40% coverage, or a
positioned container at >=85% coverage — >=70% with a strong phrase —
with wall-short text <=1500 chars and ad-specific phrases) hides the
wall root, releases the scroll lock, and re-kills re-inserts via the
mutation observer + timed sweeps up to 40 s, capped at 12 kills per
page. Guards: cookie banners, full-screen video promos, subscription
paywalls and article-length text all score NOT walls (tested).
Toggle in the menu (Wall Breaker: On/Off, persisted in eb_prefs_v1);
turning it off restores session-broken walls. Every detection/break
is written to the debug log.

## v1.5.0 (Nov 17, 2026) — dialog layer

Kurt's v1.4 verdict: Wall Breaker WORKED on gamesradar ("that did
the trick"), and the picker UI now renders above the page. New layer
exposed: with the overlay dead, the wall script falls back to a
native confirm() — "Please allow ads on this site. Click OK to learn
more." OK redirects to the standalone wall page; Cancel makes the
script reload the page (loop). Fix: page-hook.js injected into the
page world at document_start wraps confirm/alert/prompt — a dialog
whose text matches wall phrases never reaches the browser UI:
confirm/prompt THROW (aborting the caller's script before either
branch runs), alert is swallowed, location.reload is swallowed for
15 s after a suppression (in case their code catches the throw), and
location.assign/replace to error-report/getadmiral hosts is blocked.
Legit dialogs pass through untouched. Every suppression is reported
to the content script and written to the debug log. Hook behavior
suite: 13/13.

## v1.6.0 (Nov 17, 2026) — redirect cancellation

Kurt's v1.5 verdict: dialog gone, but the site now force-redirects
straight to the standalone wall page. Layered cancellation:
(1) network level — background blocking webRequest cancels any
main_frame/sub_frame load to *.error-report.com, *.getadmiral.com,
*.admiral.digital (covers JS redirects and server 302s alike; the
tab stays on the article); (2) page hook now also traps the
location.href setter (best effort — reported in the log whether the
patch took); (3) content sweeps strip meta-refresh tags pointing at
wall hosts. If a redirect still lands, its address-bar URL is the
diagnostic (different host/path than assumed).

## v1.7.0 (Nov 17, 2026) — anti-blank

Kurt's v1.6 verdict: redirect cancelled, article loads, then the
page blanks to white AND the blocker menu stops opening (the wipe
removes our UI host from the DOM too). Counters, all gated on the
page being proven hostile (wall broken / dialog suppressed, flagged
in sessionStorage so they survive the tab's reloads):
(1) VEIL break — an opaque, textless, interactive-free layer
covering >=92% of the screen is hidden like a wall (wb.isVeil);
(2) body/html guard — display:none / visibility:hidden / opacity:0
forced on html/body is reverted with !important;
(3) SNAPSHOT + RESTORE — once hostile, the article body is
snapshotted after load; if the page's text later collapses below 8%
of the snapshot, the article is restored from it (max 3 restores;
restored dead host/style copies are dropped, live ones re-attached).
Watchdog (750 ms, ~2 min per page) also re-attaches the UI host
whenever a wipe removes it — the dead-menu fix.

## v1.8.0 (Nov 17, 2026) — Sanctuary

Kurt's v1.7 verdict: unblanking does not work, and no log could be
retrieved because the menu never appears on the blanked page.
Root causes found in v1.7's own code: (1) the icon toggle only
rebuilt the UI when the host was null — a wiped-but-referenced host
meant toggles landed on a detached node (the dead menu, exactly);
(2) snapshots were armed only after a wall break, 1.2 s later — on
gamesradar the blank lands first, leaving nothing to restore.
v1.8: toggle rebuilds the UI whenever the host is detached (and
recreates a wiped <body>); snapshots are taken early on EVERY
article-like page (0.9 s / 3 s / 7 s) and synchronously at
wall-break time; blank handling runs whenever a snapshot exists
(wb.blankVerdict: restore x2, then escalate). Escalation is the
SANCTUARY: the saved article (largest text block from the
snapshot, scripts/iframes/walls stripped) shown in our own
max-z-index shadow overlay, watchdog-defended like the menu. Its
bar has Close and Copy log — the log is reachable in exactly the
state where it's needed.
