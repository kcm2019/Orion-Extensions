/* AirPlay for Orion — shared data layer + pure logic (window.APO).
 * Pure functions are unit-tested by tests/harness.js.
 * NOT true AirPlay: a WebExtension has no listening sockets and cannot
 * advertise mDNS/Bonjour, so this device never appears in the iOS
 * Control Center picker. Pairing + media run over WebRTC (PeerJS
 * cloud broker for signalling only; media is peer-to-peer). */
(function () {
  'use strict';
  if (window.APO) return;

  var KEY = 'airplay_orion';
  var CARRIER = 'https://example.com/';

  function defaultStore() {
    return {
      v: 1,
      deviceName: '',
      storageMode: 'unknown',
      visits: 0,
      lastIconClick: null, /* bg stamps this on every icon tap (diagnostic) */
      openPanelAt: null,   /* bg stamps this when the icon wants the panel open */
      consoleUrl: '',      /* hosted airplay-console.html URL; '' = extension-only pairing */
      session: null /* { room, paired, createdAt, hostBeat, wantHost, remoteName, remotePeerId } */
    };
  }

  /* ---------- storage: browser.storage.local -> chrome.storage.local
   * -> localStorage, dual-write to localStorage (same layered pattern
   * as HeckYeah Orion: extension storage is the only store that can
   * carry a session across origins). ---------- */
  function extGet() {
    return new Promise(function (resolve) {
      try {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
          browser.storage.local.get(KEY).then(function (s) {
            resolve(s && s[KEY] ? { data: s[KEY], mode: 'ext' } : null);
          }, function () { resolve(null); });
          return;
        }
      } catch (e) {}
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(KEY, function (s) {
            resolve(s && s[KEY] ? { data: s[KEY], mode: 'ext' } : null);
          });
          return;
        }
      } catch (e) {}
      resolve(null);
    });
  }
  function localGet() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function loadStore() {
    return extGet().then(function (r) {
      if (r && r.data) {
        var d = Object.assign(defaultStore(), r.data);
        d.storageMode = 'ext';
        return d;
      }
      var l = localGet();
      if (l) {
        var d2 = Object.assign(defaultStore(), l);
        d2.storageMode = 'local-only';
        return d2;
      }
      var fresh = defaultStore();
      fresh.storageMode = 'none-yet';
      return fresh;
    });
  }
  function saveStore(store) {
    var payload = {};
    payload[KEY] = store;
    try {
      if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
        browser.storage.local.set(payload);
      } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(payload);
      }
    } catch (e) {}
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    return Promise.resolve();
  }

  /* ---------- pure logic ---------- */
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function randomRoom(rand) {
    var out = '';
    var bytes = null;
    if (!rand) {
      try {
        bytes = new Uint8Array(14);
        crypto.getRandomValues(bytes);
      } catch (e) { bytes = null; }
    }
    for (var i = 0; i < 14; i++) {
      var n = bytes ? bytes[i] : Math.floor((rand ? rand() : Math.random()) * 256);
      out += ALPHABET[n % ALPHABET.length];
    }
    return out;
  }
  function randomCode(rand) {
    var n;
    if (!rand) {
      try {
        var buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        n = buf[0] % 1000000;
      } catch (e) { n = Math.floor(Math.random() * 1000000); }
    } else {
      n = Math.floor(rand() * 1000000);
    }
    return ('000000' + n).slice(-6);
  }
  function hostPeerId(room) { return 'apo-' + room; }
  /* v0.3.0: when the user has hosted the standalone console page
   * (airplay-console.html — the extension-free interface) and pasted
   * its URL into the panel, pairing links point there and open in
   * ANY browser. Unset → the example.com carrier, extension-only. */
  function consoleBase(s) {
    return s && s.consoleUrl ? String(s.consoleUrl).trim() : '';
  }
  function pairUrl(room, base) { return (base || CARRIER) + '#apo-cast=' + room; }
  function parsePairHash(hash) {
    var m = String(hash || '').match(/apo-cast=([A-Za-z0-9]+)/);
    return m ? { room: m[1] } : null;
  }

  /* Only http(s) media/page URLs may be cast. Everything else
   * (javascript:, data:, file:, blob: from another origin…) is refused
   * so a paired device can never be handed a script URL to load. */
  function validateCastUrl(u) {
    if (!u || typeof u !== 'string') return null;
    var s = u.trim();
    if (!s) return null;
    var parsed;
    try { parsed = new URL(s); } catch (e) { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  }
  function isDirectMediaUrl(u) {
    var clean = validateCastUrl(u);
    if (!clean) return false;
    return /\.(mp4|m4v|mov|webm|m3u8|mp3|m4a|aac|ogg)(\?|#|$)/i.test(clean);
  }

  function fmtTime(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  function defaultDeviceName(ua) {
    ua = String(ua || '');
    if (/iPad/.test(ua)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Android/.test(ua)) return 'Android';
    return 'This device';
  }

  /* Capability probe — the M0 question. Returns booleans only, so the
   * UI can print an honest report instead of failing silently:
   *  - rtc:        RTCPeerConnection (via PeerJS or raw)
   *  - display:    getDisplayMedia (screen/tab capture — historically
   *                ABSENT on iOS WebKit; reported added in Safari 27)
   *  - userMedia:  getUserMedia (camera/mic — works on iOS)
   *  - vidCapture: HTMLVideoElement.captureStream (share a page video)
   *  - peerJs:     the vendored PeerJS library loaded on this page */
  function probeCapabilities(env) {
    env = env || {};
    var nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
    var win = env.window || (typeof window !== 'undefined' ? window : {});
    var md = nav.mediaDevices || {};
    var videoProto = win.HTMLVideoElement && win.HTMLVideoElement.prototype;
    return {
      rtc: typeof win.RTCPeerConnection === 'function' || typeof win.webkitRTCPeerConnection === 'function',
      display: typeof md.getDisplayMedia === 'function',
      userMedia: typeof md.getUserMedia === 'function',
      vidCapture: !!(videoProto && (typeof videoProto.captureStream === 'function' || typeof videoProto.webkitCaptureStream === 'function')),
      peerJs: typeof win.Peer === 'function'
    };
  }

  var SESSION_TTL = 6 * 60 * 60 * 1000;  /* paired session: 6h */
  var ROOM_TTL = 10 * 60 * 1000;         /* unpaired room: 10 min */
  var CODE_TTL = 60 * 1000;              /* one pairing code: 60s */
  function sessionAlive(sess, now) {
    if (!sess || !sess.room) return false;
    var age = (now || Date.now()) - (sess.createdAt || 0);
    return sess.paired ? age < SESSION_TTL : age < ROOM_TTL;
  }

  window.APO = {
    KEY: KEY,
    CARRIER: CARRIER,
    defaultStore: defaultStore,
    loadStore: loadStore,
    saveStore: saveStore,
    randomRoom: randomRoom,
    randomCode: randomCode,
    hostPeerId: hostPeerId,
    consoleBase: consoleBase,
    pairUrl: pairUrl,
    parsePairHash: parsePairHash,
    validateCastUrl: validateCastUrl,
    isDirectMediaUrl: isDirectMediaUrl,
    fmtTime: fmtTime,
    defaultDeviceName: defaultDeviceName,
    probeCapabilities: probeCapabilities,
    sessionAlive: sessionAlive,
    SESSION_TTL: SESSION_TTL,
    ROOM_TTL: ROOM_TTL,
    CODE_TTL: CODE_TTL
  };
})();
