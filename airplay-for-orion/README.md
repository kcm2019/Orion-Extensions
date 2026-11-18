# AirPlay for Orion — v0.3.0 + AirPlay Console

**0.3.0 — the pairing device no longer needs the extension.**
`airplay-console.html` (repo root) is the whole interface as ONE
self-contained page: PeerJS and the QR library inlined, no server,
no account. Host it anywhere static and open it in **any** browser
(Safari included) — it can host a pairing (shows the QR), join one,
send (cast link, camera, screen/tab, a video file) and receive,
with the same compare-code pairing, heartbeat and 6-hour session
as the extension; the wire protocol is identical, so console ↔
extension pairings work both ways (verified by
`tests/console-sim.js`: two console instances complete the
handshake and cast both directions). In the extension panel, set
**Console link** to the hosted page's URL and every pairing QR/link
points there instead of example.com; the extension never injects
its own UI into the console page. Unset, pairing stays
extension-to-extension as before.

**0.2.2 — QR scans that land on plain example.com.** On-device:
the icon chain works (panel opens), but scanning the QR just showed
example.com. The guest console only exists *inside Orion* — a scan
that opens the link in Safari (the Camera's default when Orion
isn't the default browser) can never pair, and plain example.com is
exactly what that looks like. Fixes: the host panel now says so
under the QR and points at the in-Orion **Join** field (paste the
link there — never leaves Orion); the guest boot is idempotent and
watchdog-guarded (re-checks at 0.8 s / 2.5 s, on `hashchange` and
`pageshow`) so a late or restored page still takes over. The
discriminating test if it still fails: open example.com *in Orion*
on the scanning device — if the 📺 pill isn't there either, the
extension isn't injecting on that device at all.

**0.2.1 — the icon, fixed by changing surfaces.** 0.2.0's toolbar
popup showed *nothing* when the icon was tapped (on-device verdict:
Orion on this device does not render `browser_action` popups). The
popup is gone. Now the icon tap fires `browserAction.onClicked`,
and a minimal background script — icon clicks only, it never hosts
the pairing (HeckYeah 0.6.0's lesson) — does three things: stamps
the shared store with the click time, messages the current tab to
open the **in-page panel** (the menu, on a surface proven on this
device), and if no tab can be reached, opens a fresh tab whose page
sees the stamp and opens the panel itself. The panel's connection
log prints the last icon-click time, so if any link in that chain
is dead on your build, the next test names it instead of failing
silently. The panel also gained the popup's **Join by link** field.
The 📺 pill still opens the same panel directly.

A **simulated** AirPlay for two devices running Orion. It is *not* true
AirPlay: a WebExtension has no listening sockets and cannot advertise
Bonjour/mDNS, so these devices never appear in the iOS Control Center
AirPlay picker, and DRM/FairPlay content is out of scope — same walls
as every third-party receiver. Inside Orion, though, you get the
AirPlay shape: pair once, either device can be the source, the other
plays.

## Pair once (HeckYeah TV flow, over WebRTC)

1. Install this extension in Orion on **both** devices.
2. On the device that will play first: open any page, tap the
   **📺 AirPlay** pill (bottom right) → **Show pairing QR**.
3. Scan the QR with the other device's camera. It opens a neutral
   carrier page (`example.com` — the room id lives in the `#` fragment
   and is never sent to that server) and the extension takes over:
   it connects and *requests* pairing on its own.
4. A one-time **6-digit code (60 s)** appears on **both** screens.
   If they match, tap **Pair** on the phone or **Accept** on the host.
5. Done. The pairing persists (6 h session), roams with you across
   tabs and pages, and a returning device is re-accepted with no code.
   Connection drops are declared only by a heartbeat (4 s ping, 12 s
   tolerance) — never by a single socket event — and the guest redials
   the *same* session. (These are the hard-won HeckYeah Orion rules:
   no background-page host, no socket-event teardowns.)

## Once paired — pick a role on either device

**📤 Source can send, four ways:**
- **Cast a URL** — paste an mp4/m3u8/etc. link (or the current page);
  the player plays the URL itself at full quality. Page URLs open in
  a receiver frame (sites that refuse framing will refuse — that's
  theirs, not ours).
- **Share this page's video** — the largest `<video>` on the page,
  streamed live via `captureStream()`.
- **Share screen / tab** — via `getDisplayMedia()`. Historically
  absent on iOS WebKit; the panel's capability report says plainly
  whether *this* device has it (iOS 27 reportedly added it — this
  build is the test). Whole-device mirroring (other apps, Home
  Screen) is impossible from an extension.
- **Share camera** — front camera + mic via `getUserMedia()`.

**📺 Player** shows a "Ready to receive" screen; incoming casts and
shares open the receiver automatically — black fullscreen layout,
native-fullscreen button (⛶ uses the iOS video player), ±10 s and
play/pause. The source also gets **remote controls** for the player
(play/pause, ±10 s, fullscreen).

Every panel shows a **capability report** for the device it's on
(WebRTC / screen capture / video capture / camera) and a **connection
log** — if anything stalls, screenshot the log; it names the dead
step instead of guessing.

## Install (Orion iOS)

Per Kagi's docs: enable Firefox extensions in Orion Settings →
Extensions, then ••• → Extensions → + → Install from File, pick the
`.zip`/`.xpi`, enable it. Do it on both devices, then pair.

## Limits (honest)

- No Control Center presence, no discovery on the LAN — pairing is
  by QR, signalling via the free PeerJS cloud broker; media itself
  is peer-to-peer WebRTC and never passes through a server.
- Both devices must have Orion open (the hosting tab in front hosts;
  that's the roaming design).
- Synthetic limits don't apply here, but site framing/CSP can still
  refuse a cast page URL or a frame — the log will say so.
- Screen share is capability-gated everywhere it's offered: if the
  report says ✗, the button tells you instead of failing silently.

## Files

- `common.js` — storage (browser → chrome → localStorage, dual-write),
  pairing/URL/capability pure logic (`window.APO`, harness-tested)
- `airplay.js` — pill + pairing panel, roaming host, guest console,
  receiver, capture/call source paths, remote controls, heartbeat
- `vendor/` — PeerJS 1.5.5 + qrcode-generator 1.4.4 (from HeckYeah Orion)
- `bg.js` — background script for icon clicks only (stamp + forward
  to the tab's panel, fallback tab); never hosts the session
- `tests/harness.js` — 22 checks + console-sim (not shipped in the package)
