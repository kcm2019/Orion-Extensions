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
6. **Live-element transport** (v2.5) — YouTube swaps the <video>
   element when a new video is picked from the current one (Up
   Next, end screen, queue jump), which used to leave the overlay
   talking to a detached element: the pause button went dead.
   Every control now resolves the live element first, a subtree
   observer + 1s poll adopt swaps within a second, all transport
   listeners re-wire on adoption, and the settings UI builds as
   soon as the player exists — it no longer waits for the caption
   response, which could lag a navigation and freeze the controls.
   Also in v2.5: the hide timer re-validates before firing (no
   more vanishing while paused), the play button shows a replay
   glyph at the end, live streams show LIVE instead of a broken
   remaining time, scrubbing shows a time bubble with the target
   and delta while the bar follows your finger (seeks throttled,
   exact seek on release), and buttons get press feedback.
7. **Pill layout + Liquid Glass** (v2.6, rearranged v2.7) — the
   overlay uses Apple's player arrangement in both glass modes:
   upper-left pill = Fullscreen, PiP, AirPlay; upper right =
   volume (drag to set, tap the speaker to mute); lower-right
   pill = Miniplayer, Settings, floating clear above a time bar
   that carries only the times and the scrubber. The
   settings-menu **Liquid Glass UI** toggle switches only the
   glass: on = a dark liquid glass (backdrop-filter re-samples
   the live content behind each element every frame, so the
   video shows through in real time; dark-tinted since v2.7 so
   the white icons stay readable over bright scenes — true edge
   refraction is native-only); off = the classic frosted glass.
   The AirPlay button calls WebKit's playback-target picker
   where available.
8. **Drag + glass fixes** (v2.16) — the queue drag no longer
   strands a row hovering: YouTube's reorder now gets the full
   drag lifecycle in one shot at release, cleanup is
   unconditional (plus a watchdog and a delayed sweep), the
   Queue panel wears the player's true Liquid Glass when the
   toggle is on, the per-item ⋮ menus are glass too, and the
   toast fades in/out like the player's chrome.
9. **Native-iPad pass** (v2.15) — the toast moved up clear of
   the scrub bar (centred, padded, Liquid Glass); the Settings
   Queue page is GONE (YouTube's own Queue panel below the
   player is the queue now — its rows are encapsulated cards
   and rows drag with the finger, iOS-style, with YouTube's own
   reorder committing on release; the Autoplay toggle moved to
   the main Settings page); the title / channel / description
   block is one grouped card with the description as an inset
   card inside it.
9. **The big round** (v2.14) — the below-player UI was
   rebuilt (the v2.12 glass fought the components: blur over a
   scrolling list, internals forced transparent; it is now a
   near-solid iOS grouped card — one hairline, 12px radius,
   internals untouched, blue-tinted current queue row), plus:
   a sleep timer (durations or end-of-video), built-in
   SponsorBlock skipping (hash-prefix API lookup, per-category
   toggles), ad handling (the overlay steps aside during ads
   so YouTube's own Skip button is reachable, and auto-skips
   when allowed), hold-to-2x on the video, chapters with scrub
   markers and storyboard thumbnails in the scrub bubble, an
   update checker fed from the Orion-Extensions repo, and a
   Copy Debug Log row in Settings.
9. **AirPlay active glow** (v2.13) — while playback is
   wireless, the AirPlay glyph turns system blue (#0A84FF)
   with a soft halo, matching the native iOS player; it
   returns to white when AirPlay disconnects. Driven by
   WebKit's own wireless-playback state on the video element.
9. **Below-the-player glass, applied from inside** (v2.12) —
   v2.11 styled the description and Queue box from the
   stylesheet, but the description lives inside
   ytd-watch-metadata's shadow DOM, which page CSS cannot
   reach, so it never applied. The extension now injects the
   glass stylesheet directly into the shadow roots of the
   metadata and queue-panel components (plus inline styles on
   the panel host) and re-applies it as YouTube rebuilds the
   page.
9. **Centre tap + below-the-player UI** (v2.11) — with the
   controls hidden, tapping the centre of the video (where the
   play/pause button would be) toggles playback and brings the
   UI up; taps elsewhere still only show the UI. The glass now
   extends below the player: the description box and YouTube's
   Queue box are glass panels too (paint-only CSS). Queue
   ordering gets touch-first controls: our Queue page has
   up/down buttons on every entry, and drags that start on a
   Queue-box item's handle are translated into the drag events
   YouTube's own mouse reorder listens for, so the reorder goes
   through YouTube's model. (Also fixed: the centre cluster's
   centring, which the v2.10 motion transform had overwritten.)
9. **Miniplayer-restore fix + motion** (v2.10) — pausing in the
   miniplayer and restoring used to leave the play button dead:
   the controls were resolving a leftover video element. The
   player is now re-resolved from the document on every sync,
   restoring from the miniplayer re-syncs immediately, and the
   play button verifies its play took — escalating to a fresh
   element retry and YouTube's own playVideo() API if not.
   Theater Mode gets the same verify-and-fallback treatment
   (size-button click, verified, then YouTube's 't' shortcut).
   Motion: the chrome fades and drifts (centre cluster scales
   in, bars slide from their edges, visibility flips only after
   the fade), and the settings menu rises in with its rows
   cascading, then fades out. The PiP button uses Apple's
   pip.enter glyph and the fullscreen button is a drawn SVG
   with strokes matching the other icons.
9. **Panel behaviour** (v2.9) — while the settings menu is open
   the lower-right button pill hides; tapping anywhere outside
   the menu (in the player or elsewhere on the page) dismisses
   it; and touch gestures that start on the menu are stopped at
   the panel, so swiping down on it no longer drags the player
   into the miniplayer (the menu's own scrolling still works).
9. **Queue sources** (v2.9) — the Queue page's add list is
   scraped from YouTube's queue panel
   (ytd-playlist-panel-video-renderer) and the current lockup
   view-model Up Next cards as well as the classic compact
   renderers, so it works when watching from a queue.
10. **Resume After PiP / Fullscreen** (v2.9) — closing PiP or
    exiting the native fullscreen player pauses the video by
    default; with this on (the default) the extension resumes
    playback instead. Turn it off in settings for stock
    behaviour.
11. **Tap Screen to Pause toggle** (v2.8) — a tap on the video
   toggles only the overlay and never pauses (the whole gesture —
   pointerdown, touchstart, click — is swallowed in the capture
   phase for any non-interactive surface inside the player,
   including the touch-feedback layer touch devices actually
   tap). Settings → **Tap Screen to Pause** restores YouTube's
   stock tap-to-pause.
9. **Auto PiP on Scroll** (v2.4) — scrolling down to the comments
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

1. Download `yt-native-fullscreen-orion-2.16.0.zip` to your iPhone
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

## On-device checks for v2.16.0

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
10. **The v2.5 check**: play a video, then tap a different video
    (Up Next sidebar, end screen, or a queued jump) — on the new
    video the centre pause button, ±10s skips and scrubber must
    all work immediately, the times must belong to the new video,
    and pausing must keep the UI up.
11. **v2.16 checks**: drag a queue row — it should land and
    STAY (no hovering, no tap needed); with Liquid Glass on,
    the Queue box should look like the player's glass; open a
    queue row's ⋮ menu — glass; toasts fade in and out.
12. **v2.15 checks**: toasts float above the scrub bar, never
    touching it; Settings has no Queue row (Autoplay sits on
    the main page); in YouTube's Queue box, press a row's grip
    and drag — the row should ride your finger and the order
    should stick on release; title + description read as one
    card with the description inset.
12. **v2.14.1 fixes**: during hold-to-2x, YouTube's own 2x
    indicator should NOT appear (only our chip); scrubbing a
    video should show a real preview thumbnail in the bubble
    (v2.14.0's storyboard parse used the wrong field layout,
    so the sheet URL was invalid and nothing loaded).
12. **v2.14 round**: description + Queue box should read as
    clean dark cards (no blur, no bleed-through); set a 5-min
    sleep timer and confirm playback pauses; on a video with a
    sponsor segment, confirm it skips with a toast; hold your
    finger on the video for 2x, release to return to normal;
    scrub a chaptered video and check the bubble shows the
    chapter name + a thumbnail; during an ad, confirm our UI
    disappears and YouTube's Skip works (and auto-skips).
12. **AirPlay glow (v2.13)**: start AirPlay from our button,
    then reopen the controls — the AirPlay glyph should be
    blue and glowing while you're connected, and white again
    after you disconnect.
12. **Below the player (v2.12)**: the description box and the
    Queue box should now actually wear the glass — translucent,
    blurred, hairline border. Expand the description and
    collapse/reopen the queue to confirm it survives both.
12. **Centre tap + queue touch (v2.11)**: let the controls
    hide, then tap the middle of the video — it should pause
    (and tap again to resume); the centre buttons must sit dead
    centre. In our Queue page, reorder with the ↑/↓ buttons. In
    YouTube's Queue box, drag an item by its left handle to
    reorder. Check the description and Queue box wear the glass.
12. **Miniplayer + theater + motion (v2.10)**: pause in the
    miniplayer, restore to full size — the centre play button
    must unpause first try. Open ⚙︎ → Theater Mode — the page
    must widen (and narrow again on a second pick). Watch the
    chrome and menu animate in/out; check the PiP icon matches
    Apple's and the fullscreen corners look as heavy as the
    other icons.
12. **Menu + queue + resume (v2.9)**: open ⚙︎ — the
    Miniplayer/Settings pill should vanish; tap the video — the
    menu closes and the controls stay up; swipe down on the menu
    — the player must NOT drop into the miniplayer. Watching
    from a queue, the Queue page should offer the rail videos to
    add. Play in PiP, close PiP — playback should continue; same
    after exiting native fullscreen. ⚙︎ → Resume After PiP /
    Fullscreen off restores the stock pause.
12. **Tap behaviour (v2.8)**: with the video playing, tap the
    picture (not a button) — the controls should toggle and the
    video must keep playing, every time. Then ⚙︎ → Tap Screen to
    Pause on, and confirm taps pause again like stock YouTube.
12. **Layout + Liquid Glass (v2.7)**: check the arrangement —
    Fullscreen/PiP/AirPlay upper left, volume upper right,
    Miniplayer/Settings lower right with clear space above the
    time bar. Drag the volume slider, tap the speaker (slash is
    white now), tap AirPlay (picker should open). Toggle ⚙︎ →
    Liquid Glass UI on/off: only the glass should change (dark
    liquid vs classic frosted), the layout must not move, and
    over a bright scene the liquid elements must stay readable.

## Files

- `manifest.json` — MV2, permissions: `storage` + `*.youtube.com`
- `content.js` — the whole extension, no dependencies
- `player.css` — v1.3 paint-only reskin of YouTube's own panels
  (settings popup etc.); the v2.0 overlay itself is built by JS
- `icons/` — toolbar icons
