# Element Blocker for Orion

Safari Distraction Control-style element blocking for Orion on iOS —
tap an element, it dissolves, and unlike Safari it **stays hidden**:
the rule is saved per site and re-applied on every visit.

Picks (Nov 17, 2026): Core + A B D E F G H. See SPEC.md.

## Use

1. Install the `.xpi` in Orion.
2. On any page, tap the **extension icon**. There is no in-page pill —
   picking starts immediately, over the current site. The UI sits in
   the browser top layer, above anti-adblock walls and other overlays.
3. Tap an element (blue outline) — only then do the action buttons pop
   up: **＋ Wider / － Narrower** to adjust what’s selected →
   **Hide forever** (saved for the whole site) or **Zap once** (this
   visit only). After each hide the picker **stays open** so you can
   remove the next element; it closes only via **Close** or a second
   icon tap. The bar’s **⋯ Menu** button opens the full menu (Show
   hidden, Undo, Manage all rules).
4. The element dissolves — a real pixel snapshot where the page allows
   it, palette particles where it doesn’t.
5. The icon menu also has: Show hidden on this site, Undo last hide,
   and Manage all rules.

## Manager

The icon menu’s “Manage all rules…” opens the
manager in a tab: every site and rule, editable selectors, per-rule /
per-site / all delete, hit counts, and **Export / Import backup (JSON)**.
Imports merge and dedupe; invalid files are rejected whole.

## Wall Breaker (automatic)

On by default. Anti-adblock walls (like gamesradar's Admiral /
error-report interstitial) are broken automatically — no tapping:
known wall iframes are pre-hidden by CSS, and a scanner hides any
full-screen “allow ads” container the moment it appears, releases
the page's scroll lock, and re-kills it if the site re-inserts it.
Toggle it in the menu (⋯ Menu → Wall Breaker). Turning it off
restores anything it hid during that page view.

If the wall script then pops a native browser dialog (“Please allow
ads on this site. Click OK to learn more.”), that's handled too: the
dialog is suppressed in the page itself before it can appear, its
reload follow-through is swallowed, and its redirect is blocked.
Normal dialogs on other sites are untouched.

If the site then tries to force-navigate the tab to the standalone
wall page, that navigation is cancelled at the network level — the
tab stays on the article.

If the site's last move is to blank the page — a white veil over the
article, the page force-hidden, or the article wiped from the DOM —
the blocker counters that too on pages where a wall already fired:
veils are hidden, the page is forced visible, and a wiped article is
restored from a snapshot taken right after it loaded. If the site
keeps wiping, the blocker escalates: the saved article opens in its
own protected overlay (the “sanctuary”) with a Copy-log button, so
the article — and the debug log — stay reachable no matter what
the page does.

## How permanence works

- A generated stylesheet (`display:none !important` for every saved
  selector on the host) is injected at document_start as soon as
  storage resolves — the browser hides re-inserted matches itself.
- A MutationObserver + fingerprint scan catches copies whose classes
  changed (tag + stable id/data attributes + text + position + size,
  threshold-scored so unrelated elements don’t get hidden).
- Hiding a large fixed/absolute overlay also releases the page’s
  scroll lock (when no other large overlay remains) and collapses
  empty wrapper ancestors (saved as extra selectors on the rule).

## Debugging

Menu → **Debug log…** shows a copyable log of everything the
extension did (what covered the menu, what it demoted, whether the
top layer worked). The same log is saved automatically and shown in
the manager page, in case the in-page UI can't be reached.

## Limits

No picking inside cross-origin iframes (the iframe itself can be
hidden). Fully randomised per-load class names with changing text can
defeat both selector and fingerprint. Snapshot dissolve falls back to
palette particles on CORS-tainted content.

## Tests

`node tests/test-all.js` — 27 checks: selector generation/stability
filtering, fingerprint match/veto, particle grid caps, rule dedupe,
import validation and merge. Picker, dissolve and storage on Orion
itself are device-unproven until tested there.
