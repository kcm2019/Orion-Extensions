# YT Native Fullscreen for Orion

Firefox Manifest V2 extension for Orion on iPhone/iPad.

## Features

1. **Native fullscreen** — pressing fullscreen on YouTube opens the
   **iOS native video player** (`webkitEnterFullscreen`) instead of
   YouTube's web fullscreen.
2. **Captions in that player** (v1.1) — YouTube's caption tracks are
   attached to the video as standard WebVTT `<track>` elements, so the
   native player's subtitles menu has tracks to offer.
3. **Apple-style player UI** (v2.0) — modelled on the iOS PiP
   window: YouTube's own chrome is replaced by an overlay with a
   centre transport cluster (skip back 10s, big glass play/pause,
   skip forward 10s, shown when you tap the video), a floating
   glass bottom bar with elapsed/remaining time and a
   drag-to-scrub track (44px touch target, live seeking), ONE
   settings menu, and a fullscreen button that stays outside that
   menu. The settings menu holds Captions / Quality / Playback
   Speed plus proxied rows for YouTube's own Miniplayer, Theater
   Mode, Play on TV and Settings — each row clicks the real
   YouTube button. SponsorBlock gets a row too when its player
   button is detected. YouTube's buttons are hidden, never
   removed; the hide only applies once the overlay has mounted,
   so a failure leaves stock YouTube untouched.
4. **Arrive pre-configured** (v1.2) — because the native player has no
   quality menu and resets speed, these are set *before* you enter
   it, now from the single settings menu (quality / speed /
   captions pages). Choices persist across videos:
   - **A — Quality lock:** your chosen quality is applied to every
     video via YouTube's player API; if a video doesn't offer it, the
     nearest available quality at-or-below it is used. `Auto` = off.
   - **B — Persistent speed:** your speed is applied to every video
     and re-applied if YouTube resets it.
   - **C — Caption language:** your language becomes the preferred
     native track everywhere. If a video has no track in it, one is
     **auto-translated** into it from the best source track and
     labelled "(auto-translated)". `CC: Auto` = YouTube's selected
     language, then your browser language, then English. `Off` = no
     track is auto-shown.
   - ~~**F — Auto-PiP**~~ **removed in v1.2.1:** it was suspected of
     breaking background playback when PiP wasn't already enabled —
     its trigger fired exactly when the app was backgrounded. The
     extension no longer touches presentation mode anywhere.

5. **Miniplayer + Queue** (v2.3) — the overlay follows the player
   into YouTube's miniplayer and switches to a compact layout at
   miniplayer width (smaller cluster, no settings/miniplayer
   buttons, no remaining-time). The settings menu gains a **Queue**
   page implementing the locked rule (Nov 5): our own queue always
   plays next at video end; if it's empty, the **Autoplay Up Next**
   toggle decides whether YouTube's first Up Next plays (on) or
   playback stops (off — YouTube's own autonav is synced off too).
   The Queue page lists the watch page's Up Next entries to tap-add,
   and queued items can be played now, removed (✕), or cleared.
   The queue persists across videos and sessions.
6. **Auto PiP on Scroll** (v2.4) — scrolling down to the comments
   pops the video into Picture in Picture once the player is
   halfway out of view (playing videos only, foreground only; a
   settings-menu toggle turns it off). This is separate from the
   removed v1.2 auto-PiP, which fired on fullscreen exit and app
   backgrounding — this one never fires on backgrounding, and if
   you close the PiP manually while still scrolled down it won't
   re-open until the player has been back in view.

Preferences are stored with `browser.storage.local` (with fallbacks),
because Orion's WebExtension API coverage is partial.

Notes / trade-offs:

- Inside the native player you get the system UI only; YouTube's
  Skip Ad and endscreens are unreachable until you exit.
- The overlay lives on the **inline** player — set preferences
  once, then fullscreen as usual.
- WebKit has a history of TextTrack bugs at the native-fullscreen
  handoff, so the captions behaviour is only provable on-device.

## Install in Orion (iPhone / iPad)

1. Download `yt-native-fullscreen-orion-2.4.0.zip` to your iPhone
   (Files → Downloads). **Don't unzip it.** The `.xpi` is the same
   package. If you installed v1.0/v1.1, remove that version first.
2. Orion: **Settings → Extensions** → turn **Firefox extensions** on.
3. **••• → Extensions → + → Install from File**, pick the downloaded
   file, enable **YT Native Fullscreen**, refresh YouTube.
4. For youtube.com, turn on **Website Settings → Request Desktop
   Website** (that's what makes YouTube serve the desktop site; an
   extension can't change Orion's user agent per-site).
5. If the subtitles menu doesn't appear, check iPhone
   **Settings → Accessibility → Subtitles & Captioning →
   Closed Captions + SDH** is on.

## On-device checks for v2.4.0

1. Open a video and tap it: the centre cluster appears (↺10,
   play/pause, 10↻) plus the glass bottom bar. Tap again to
   dismiss; while playing it fades on its own after ~3s. A tap
   must ONLY toggle the UI — playback pauses solely from the
   centre pause button (v2.1.0). The glass should now be much
   more transparent, the skip buttons spaced wider, and the
   settings button a crisp gear icon. The Quality page should
   list the video's resolutions, not just Auto.
2. Drag the scrub bar: the video should seek live while you drag,
   pause during the drag, and resume on release if it was playing.
3. Bottom-right ⚙︎ opens ONE menu: Captions / Quality / Playback
   Speed pages, then Miniplayer, Theater Mode, Play on TV and
   YouTube Settings rows — each should do exactly what YouTube's
   own button does. If SponsorBlock is installed, its row should
   appear too.
4. The buttons next to ⚙︎ (outside the menu): miniplayer (acts
   like the "i" key; if YouTube's miniplayer button isn't in the
   page, the "i" hotkey itself is sent), PiP (manual toggle —
   nothing automatic), and ⛶ for the native fullscreen player,
   captions and prefs as before.
5. Set quality/speed/CC in the menu, open a *different* video:
   choices should persist and playback should start at them.
6. Background playback: unchanged behaviour expected (feature F
   is still gone).
7. Miniplayer: send a video to the miniplayer and browse Home —
   the overlay should shrink to the compact layout on the small
   player and expand back on the watch page.
8. Queue: on a watch page open ⚙︎ → Queue, add two Up Next videos,
   let the current video end — it should jump to the first queued
   video, then the second. With the queue empty and Autoplay Up
   Next off, playback should stop at the end.
9. Auto PiP on Scroll: play a video, scroll down to the comments —
   past the halfway point it should pop into PiP. Scroll back up,
   close the PiP, scroll down again — it should fire again; but
   closing the PiP while still scrolled down must not re-open it.

## Files

- `manifest.json` — MV2, permissions: `storage` + `*.youtube.com`
- `content.js` — the whole extension, no dependencies
- `player.css` — v1.3 paint-only reskin of YouTube's own panels
  (settings popup etc.); the v2.0 overlay itself is built by JS
- `icons/` — toolbar icons
