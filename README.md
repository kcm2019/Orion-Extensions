# Orion Extensions

All of Kurt's Orion browser extensions, collected in one repository — each extension in its own folder with its full source (manifest, scripts, styles, tests, and its own README).

## Extensions

| Folder | Extension | Version | Description |
|---|---|---|---|
| [`airplay-for-orion/`](airplay-for-orion/) | AirPlay for Orion | 0.3.0 | Simulated AirPlay between two Orion devices: pair once with a QR + compare code, either device can be the source, the other plays — cast a video URL, share the video on this pag... |
| [`heckyeah-for-orion/`](heckyeah-for-orion/) | HeckYeah for Orion | 0.9.0 | The HeckYeah TV interface over fmhy.net: tvOS-style category tiles and shelves, a Continue Watching shelf grouped by show with full timestamps, playback resume and next-episode ... |
| [`beautiful-reader-for-orion/`](beautiful-reader-for-orion/) | Beautiful Reader for Orion | 1.18.6 | A beautiful reader for Orion with a built-in Wall Breaker (anti-adblock walls, dialogs and forced redirects are broken automatically): a draggable Reader pill appears on article... |
| [`element-blocker-for-orion/`](element-blocker-for-orion/) | Element Blocker for Orion | 1.8.0 | Safari-style element blocker for Orion: tap the icon (or the in-page pill), tap an element, watch it dissolve, and it stays hidden on that site forever. Wider/narrower picker, p... |
| [`popup-blocker-for-orion/`](popup-blocker-for-orion/) | Popup Blocker for Orion | 1.1.0 | Blocks popups on every site: window.open, target=_blank links/forms (including detached/programmatic ones), synthetic clicks, href-swapped and full-screen overlay popunder links... |
| [`ublock-for-orion/`](ublock-for-orion/) | uBlock for Orion | 1.2.4 | A uBlock Origin-style blocker built for Orion: same default filter lists with auto-update, network + cosmetic + scriptlet filtering, per-site switches, a logger, and a page-worl... |
| [`yt-native-fullscreen-for-orion/`](yt-native-fullscreen-for-orion/) | YT Native Fullscreen for Orion | 2.4.0 | YouTube with an Apple-style player UI: native iOS fullscreen, captions as native tracks, a centre play/skip cluster, drag scrubbing, and one settings menu holding quality, speed... |

## Installing in Orion

Each folder is a Firefox MV2 WebExtension for Orion on iOS/macOS. Build a `.xpi`/`.zip` from a folder by zipping its contents (with `manifest.json` at the zip root), then in Orion: Settings → Extensions → add the Firefox extension file.

## Notes

- Source upload only: built `.xpi`/`.zip` archives for every historical version and the PNG icon files are not in this repository upload — the GitHub connector used for this upload only accepts UTF-8 text files. The icon files are referenced by each `manifest.json` (`icons/icon48.png`, `icons/icon96.png`) and live in the local extension folders.
- Each subfolder keeps its original README with version history and install notes for that extension.
