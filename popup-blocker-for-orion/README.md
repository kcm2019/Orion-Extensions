# Popup Blocker for Orion — v1.2.0

## What's new in v1.2.0 — the update checker

- **In-extension update checker** (`update-check.js`). The
  extension now discovers newer versions by itself — see
  **Updates** below. Blocking behaviour is exactly as in v1.1;
  nothing about how popups are intercepted has changed.

Remove the old version in Orion before installing v1.2.

---

## Updates

- `update-check.js` polls a Firefox-style update manifest
  (`updates.json`) — by default
  `https://raw.githubusercontent.com/kcm2019/Orion-Extensions/main/updates.json`,
  overridable via the `upd_feed_url` key in `storage.local` —
  at most once every 12 hours (background startup + top-page
  load, throttled in storage), plus on demand.
- If a newer version is found, the expanded **Popup blocked**
  panel shows a footer row: **Update available: vX.Y.Z** with a
  **Download** button and a ✕ to dismiss that version. Download
  goes through the background script's privileged `tabs.create`
  path (the same one used for **Open** on a blocked popup), so
  the blocker never blocks its own update.
- A **Check for updates** button in the same panel footer runs a
  check immediately and reports inline: *Update available: v…*,
  *You're on the latest version (v…)*, or *Couldn't check for
  updates (feed unreachable)*.
- The checker can only *offer* an update — no WebExtension API
  lets an extension install a new version of itself. Download
  opens the new `.xpi` and you install it from file in Orion,
  as before.
- **Private-repo caveat:** the Orion-Extensions repo is private,
  so the default feed may be unreachable (404) without a login.
  Auto checks then fail silently; a manual check says so
  honestly instead of claiming you're up to date.
- Note: the panel only appears after a popup has been blocked
  on the page — if nothing was blocked, there's no panel and
  the update row / manual check aren't visible on that page.

---

## What's new in v1.1 — the click-hijack shield

Built for streaming/popunder sites, where v1.0's two intercepts
(`window.open` + real `_blank` clicks) get routed around:

- **Prototype intercepts.** `HTMLElement.prototype.click`,
  `HTMLFormElement.prototype.submit` (which fires *no* submit
  event), and `EventTarget.prototype.dispatchEvent` for anchors
  are all guarded — so popups launched from detached, never-added
  anchors or synthetic events are blocked too. Panel notes say
  which trick was used.
- **href-swap guard.** The anchor + href seen at pointerdown is
  compared at click time; if the site swapped the destination in
  between, the click is blocked in both modes ("href swapped
  after mousedown").
- **Overlay guard.** A `_blank` anchor covering ≥70% of the
  viewport — the click-anywhere popunder layer over the player —
  is blocked even in Smart mode ("full-screen overlay link").
- **Iframe patcher.** A MutationObserver + scan wraps
  `contentWindow.open` on accessible frames (helped by
  `match_about_blank`), closing the "grab a pristine
  `window.open` from a fresh about:blank iframe" trick.
- **Robust injection.** The hook is now fetched in the extension
  context and injected inline first (a strict page CSP could
  silently refuse v1.0's `<script src>`), with a `hook-ready`
  handshake and src / eval fallbacks if it doesn't check in.

Remove the old version in Orion before installing v1.1.

---

# v1.0.0 notes

Firefox MV2 extension for Orion (iOS/macOS). Blocks popups on every
site and tells you on the page itself, with a way back in.

## Core

- `page-hook.js` is injected into the page world at
  `document_start` and overrides `window.open()` before site
  scripts run. Blocked calls return `null`, exactly like a native
  popup blocker.
- A blocked attempt shows a red pill on the current page:
  **🚫 Popup blocked · N — tap to view**.
- Tapping the pill expands a panel listing every popup blocked on
  this page (newest first): domain, full URL, how it was attempted
  (`window.open` / `link` / `form`) and when. Each entry has
  **Dismiss**.

## Extras (all included, as picked)

- **A — Smart mode toggle.** Panel button switches Strict ⇄ Smart.
  Strict (default) blocks everything. Smart allows a `window.open`
  that happens while you are actually tapping/typing, and allows
  trusted `_blank` clicks, while still blocking automatic and
  synthetic ones.
- **B — Per-site allowlist.** "Always allow this site" in the panel
  saves the current hostname; popups there open normally. Tap again
  to undo. Saved in `browser.storage.local`.
- **C — `_blank` hijacks.** Links and forms with `target="_blank"`
  (or a named target) are blocked and listed the same way, not just
  `window.open()`.
- **D — Extra open modes.** Per entry: **Open** (new tab, via the
  background script's `tabs.create`; falls back to the page hook's
  one-time native open if Orion won't do `tabs.create`),
  **Current tab**, and **Copy URL**. Only http/https URLs can be
  opened — `javascript:`/`data:` popups are listed but not openable.
- **E — Sticky counter.** The pill shrinks after ~4s to a small red
  count badge that stays on screen until you leave the page or
  clear the list, so later blocks aren't missed.
- **F — `about:blank` tracking.** A blocked blank popup gets a fake
  window handle. If the site tries to navigate that handle, the
  panel entry updates from `about:blank (waiting…)` to the real
  destination and its buttons enable.

Subframe (iframe) popup attempts are forwarded to the top page's
panel and marked "via iframe <host>".

## Install (Orion iOS)

1. Download the `.zip` (don't unzip it).
2. Orion → Settings → Extensions → turn **Firefox extensions** on.
3. ••• → Extensions → **+** → Install from File → pick the `.zip`
   (or the `.xpi`), enable it, refresh the page.

## Test checklist (on device)

1. A site that auto-opens a popup on load → pill appears, count 1.
2. Tap the pill → panel lists the URL; **Open** opens it in a tab.
3. Wait on the pill without tapping → it shrinks to the count badge
   after ~4s; badge tap reopens the panel.
4. Switch to **Smart**, tap a site's own "open in new window"
   button → allowed; an auto popup on the same page → blocked.
5. **Always allow this site** → reload → popups open; undo it.
6. A `target=_blank` ad link in Strict → blocked and listed as
   `link`.
7. **Current tab** and **Copy URL** on an entry.
8. A streaming-style site that opens `about:blank` then redirects
   it → entry updates to the real URL (this is the F test — if it
   stays "waiting…", the site navigates the popup a way the fake
   handle can't see; tell me and I'll log which).

## Honest limits

- Orion iOS extension support is beta (~70% of the WebExtensions
  API). `tabs.create` and `storage` are the two APIs this build
  depends on beyond content scripts; both have fallbacks, but
  whether storage persists across Orion restarts is part of what
  the test above answers.
- A site that expects its popup handle for OAuth/payment
  postMessage traffic will break while blocked — that's what the
  per-site allowlist (B) is for.
- Popups a site opens from a service worker or via browser UI
  (not page JS) can't be intercepted by any extension.
- Build-verified only (syntax + harness) until your on-device test.
