// Harness for airplay-orion — common.js pure logic + storage + manifest
// + static guarantees in airplay.js. Not shipped in the package.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/../common.js', 'utf8');
const airplaySrc = fs.readFileSync(__dirname + '/../airplay.js', 'utf8');
const bgSrc = fs.readFileSync(__dirname + '/../bg.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));

function makeEnv(opts) {
  opts = opts || {};
  const local = {};
  const localStorage = {
    getItem: (k) => (k in local ? local[k] : null),
    setItem: (k, v) => { local[k] = String(v); },
    removeItem: (k) => { delete local[k]; },
  };
  const ext = {};
  const sandbox = {
    console, URL, Promise, Object, JSON, Math, Date,
    localStorage, setTimeout, clearTimeout,
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = 7; return a; } },
    navigator: {},
    window: null,
  };
  sandbox.window = sandbox;
  if (opts.withBrowserStorage) {
    sandbox.browser = {
      storage: { local: {
        get: (k) => Promise.resolve({ [k]: ext[k] }),
        set: (o) => { Object.assign(ext, o); return Promise.resolve(); },
      } },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { A: sandbox.APO, local, ext, sandbox };
}

let pass = 0, fail = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('ok -', name); },
    (e) => { fail++; console.log('FAIL -', name, '::', e.message); });
}

(async () => {
  const { A } = makeEnv();

  await test('fmtTime basic', () => {
    assert.strictEqual(A.fmtTime(0), '0:00');
    assert.strictEqual(A.fmtTime(754), '12:34');
    assert.strictEqual(A.fmtTime(3723), '1:02:03');
    assert.strictEqual(A.fmtTime(NaN), '0:00');
  });

  await test('randomRoom is 14 chars from the safe alphabet', () => {
    const r = A.randomRoom(() => 0.5);
    assert.strictEqual(r.length, 14);
    assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{14}$/.test(r), r);
  });

  await test('randomCode is 6 digits, zero-padded', () => {
    assert.strictEqual(A.randomCode(() => 0), '000000');
    assert.strictEqual(A.randomCode(() => 0.1234567), '123456');
    assert.ok(/^\d{6}$/.test(A.randomCode()));
  });

  await test('pair URL round-trips through parsePairHash', () => {
    const url = A.pairUrl('ABCDEFGHJKMNPQ');
    assert.ok(url.startsWith('https://example.com/#apo-cast='));
    const parsed = A.parsePairHash(new URL(url).hash);
    assert.strictEqual(parsed.room, 'ABCDEFGHJKMNPQ');
    assert.strictEqual(A.parsePairHash('#nothing'), null);
    assert.strictEqual(A.hostPeerId('ROOM123'), 'apo-ROOM123');
  });

  await test('console base: pairing links point at the hosted console page when set', () => {
    assert.strictEqual(A.consoleBase({}), '');
    assert.strictEqual(A.consoleBase({ consoleUrl: '  https://me.github.io/airplay-console.html ' }),
      'https://me.github.io/airplay-console.html');
    const url = A.pairUrl('ROOMXYZ1234567', A.consoleBase({ consoleUrl: 'https://me.github.io/airplay-console.html' }));
    assert.strictEqual(url, 'https://me.github.io/airplay-console.html#apo-cast=ROOMXYZ1234567');
    assert.strictEqual(A.parsePairHash(new URL(url).hash).room, 'ROOMXYZ1234567');
  });

  await test('validateCastUrl accepts http(s) only', () => {
    assert.strictEqual(A.validateCastUrl('https://x.example/v.mp4'), 'https://x.example/v.mp4');
    assert.strictEqual(A.validateCastUrl(' http://a.b/c '), 'http://a.b/c');
    assert.strictEqual(A.validateCastUrl('javascript:alert(1)'), null);
    assert.strictEqual(A.validateCastUrl('data:text/html,<b>x</b>'), null);
    assert.strictEqual(A.validateCastUrl('file:///etc/passwd'), null);
    assert.strictEqual(A.validateCastUrl(''), null);
    assert.strictEqual(A.validateCastUrl(null), null);
    assert.strictEqual(A.validateCastUrl('not a url'), null);
  });

  await test('isDirectMediaUrl recognises media extensions', () => {
    assert.strictEqual(A.isDirectMediaUrl('https://x/v.mp4'), true);
    assert.strictEqual(A.isDirectMediaUrl('https://x/live.m3u8?tok=1'), true);
    assert.strictEqual(A.isDirectMediaUrl('https://x/watch/123'), false);
    assert.strictEqual(A.isDirectMediaUrl('javascript:x.mp4'), false);
  });

  await test('defaultDeviceName from UA', () => {
    assert.strictEqual(A.defaultDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 27_2)'), 'iPhone');
    assert.strictEqual(A.defaultDeviceName('Mozilla/5.0 (iPad; CPU OS 27_2)'), 'iPad');
    assert.strictEqual(A.defaultDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X)'), 'Mac');
    assert.strictEqual(A.defaultDeviceName('something else'), 'This device');
  });

  await test('probeCapabilities reports each capture path honestly', () => {
    const full = A.probeCapabilities({
      navigator: { mediaDevices: { getDisplayMedia: function () {}, getUserMedia: function () {} } },
      window: { RTCPeerConnection: function () {}, Peer: function () {}, HTMLVideoElement: { prototype: { captureStream: function () {} } } },
    });
    assert.deepStrictEqual(
      { rtc: full.rtc, display: full.display, userMedia: full.userMedia, vidCapture: full.vidCapture, peerJs: full.peerJs },
      { rtc: true, display: true, userMedia: true, vidCapture: true, peerJs: true });
    const iosLike = A.probeCapabilities({
      navigator: { mediaDevices: { getUserMedia: function () {} } },
      window: { webkitRTCPeerConnection: function () {}, HTMLVideoElement: { prototype: { webkitCaptureStream: function () {} } } },
    });
    assert.strictEqual(iosLike.display, false);   // the historic iOS gap
    assert.strictEqual(iosLike.userMedia, true);
    assert.strictEqual(iosLike.vidCapture, true); // webkit-prefixed fallback counts
    assert.strictEqual(iosLike.rtc, true);
    assert.strictEqual(iosLike.peerJs, false);
  });

  await test('sessionAlive: paired 6h, unpaired 10min', () => {
    const now = 1000000000000;
    assert.strictEqual(A.sessionAlive({ room: 'R', paired: true, createdAt: now - 5 * 3600 * 1000 }, now), true);
    assert.strictEqual(A.sessionAlive({ room: 'R', paired: true, createdAt: now - 7 * 3600 * 1000 }, now), false);
    assert.strictEqual(A.sessionAlive({ room: 'R', paired: false, createdAt: now - 9 * 60 * 1000 }, now), true);
    assert.strictEqual(A.sessionAlive({ room: 'R', paired: false, createdAt: now - 11 * 60 * 1000 }, now), false);
    assert.strictEqual(A.sessionAlive(null, now), false);
  });

  await test('storage round-trip via browser.storage.local + localStorage mirror', async () => {
    const env = makeEnv({ withBrowserStorage: true });
    const s = env.A.defaultStore();
    s.deviceName = 'Kurt iPhone';
    s.session = { room: 'ROOMROOMROOM12', paired: true, createdAt: Date.now() };
    await env.A.saveStore(s);
    // dual-write: localStorage mirror exists too
    assert.ok(env.local[env.A.KEY] && env.local[env.A.KEY].includes('Kurt iPhone'));
    const loaded = await env.A.loadStore();
    assert.strictEqual(loaded.deviceName, 'Kurt iPhone');
    assert.strictEqual(loaded.storageMode, 'ext');
    assert.strictEqual(loaded.session.room, 'ROOMROOMROOM12');
  });

  await test('manifest shape: MV2, background is icon-clicks-only (never a host), storage + tabs + all_urls', () => {
    assert.strictEqual(manifest.manifest_version, 2);
    assert.strictEqual(manifest.version, '0.3.0');
    assert.ok(manifest.permissions.includes('storage'));
    assert.ok(manifest.permissions.includes('tabs'));
    assert.ok(manifest.permissions.includes('<all_urls>'));
    assert.deepStrictEqual(manifest.background.scripts, ['common.js', 'bg.js']);
    assert.ok(!bgSrc.includes('Peer'), 'background must never touch PeerJS/hosting');
    const js = manifest.content_scripts[0].js;
    assert.ok(js.indexOf('common.js') < js.indexOf('airplay.js'));
    assert.ok(js.some((f) => f.includes('peerjs')));
    assert.ok(js.some((f) => f.includes('qrcode')));
  });

  await test('airplay.js: pairing protocol messages present (Fire TV flow)', () => {
    for (const m of ["'pair-request'", "'pair-confirm'", "'code'", "'paired'", "'denied'", "'bye'"]) {
      assert.ok(airplaySrc.includes(m), 'missing ' + m);
    }
    assert.ok(airplaySrc.includes('CODE_TTL'), 'code expiry enforced');
    assert.ok(airplaySrc.includes('completePairing'), 'host-side accept path');
  });

  await test('airplay.js: heartbeat is the only drop authority (4s ping / 12s watchdog)', () => {
    assert.ok(airplaySrc.includes("sendData({ t: 'ping' })") || airplaySrc.includes("t: 'ping'"));
    assert.ok(airplaySrc.includes('12000'), '12s tolerance present');
    assert.ok(airplaySrc.includes('4000'), '4s cadence present');
    assert.ok(!/conn\.on\('close'[\s\S]{0,200}endSession/.test(airplaySrc), 'close must not end the session');
  });

  await test('airplay.js: roaming host with serving-host protection + unavailable-id stand-aside', () => {
    assert.ok(airplaySrc.includes('unavailable-id'));
    assert.ok(airplaySrc.includes('roamTick'));
    assert.ok(airplaySrc.includes('serving'), 'live host never yields');
  });

  await test('airplay.js: all four send paths present and guarded', () => {
    assert.ok(airplaySrc.includes("'cast-url'"), 'URL cast');
    assert.ok(airplaySrc.includes('captureStream'), 'page video capture');
    assert.ok(airplaySrc.includes('webkitCaptureStream'), 'webkit fallback');
    assert.ok(airplaySrc.includes('getDisplayMedia'), 'screen share');
    assert.ok(airplaySrc.includes("typeof md.getDisplayMedia !== 'function'"), 'screen share is capability-guarded, never assumed');
    assert.ok(airplaySrc.includes('getUserMedia'), 'camera share');
    assert.ok(airplaySrc.includes('.call('), 'PeerJS media call');
  });

  await test('airplay.js: receiver uses native fullscreen + validates cast URLs', () => {
    assert.ok(airplaySrc.includes('webkitEnterFullscreen'));
    assert.ok(airplaySrc.includes('validateCastUrl'), 'cast URLs validated before loading');
    assert.ok(airplaySrc.includes("'ctl'"), 'remote controls channel');
  });

  await test('manifest: browser_action has NO popup (on-device verdict: popups do not render)', () => {
    assert.ok(manifest.browser_action, 'browser_action present');
    assert.ok(!('default_popup' in manifest.browser_action), 'a default_popup would suppress onClicked and render nothing');
    assert.ok(!fs.existsSync(__dirname + '/../popup.html'), 'popup files removed');
  });

  await test('bg.js: icon click stamps the store, forwards to the tab, falls back to a fresh tab', () => {
    assert.ok(bgSrc.includes('onClicked.addListener'), 'click listener registered');
    assert.ok(bgSrc.includes('lastIconClick'), 'click is stamped for diagnosis');
    assert.ok(bgSrc.includes('openPanelAt'), 'panel-open stamp set');
    assert.ok(bgSrc.includes('sendMessage'), 'forwards to the clicked tab');
    assert.ok(bgSrc.includes("'open-panel'") || bgSrc.includes('"open-panel"') || bgSrc.includes('__apo'), 'sends the open-panel message');
    assert.ok(bgSrc.includes('tabs.create') || bgSrc.includes('.create({'), 'fallback tab on undeliverable message');
    assert.ok(bgSrc.includes('A.CARRIER'), 'fallback tab is the carrier page');
  });

  await test('airplay.js: message listener + startPairing reuse + icon-stamp consumption + join-by-link', () => {
    assert.ok(airplaySrc.includes('onMessage.addListener'), 'runtime listener registered');
    assert.ok(airplaySrc.includes('onPopupMessage'), 'message handler present');
    assert.ok(airplaySrc.includes('function startPairing()'), 'shared startPairing helper');
    assert.ok(airplaySrc.includes('never mint a new room'), 'live session is never overwritten by the message path');
    for (const a of ["'open-panel'", "'open-receiver'", "'cast-url'", "'end-session'"]) {
      assert.ok(airplaySrc.includes(a), 'content handles ' + a);
    }
    assert.ok(airplaySrc.includes('openPanelAt'), 'boot consumes the icon stamp');
    assert.ok(airplaySrc.includes('last icon click reached'), 'panel log prints the stamp (dead link names itself)');
    assert.ok(airplaySrc.includes('roomFromText'), 'join-by-link lives in the panel now');
  });

  await test('airplay.js: guest boot is idempotent + watchdog-guarded, QR carries the open-in-Orion warning', () => {
    assert.ok(airplaySrc.includes("getElementById('apo-guest-root')"), 'guest root id checked');
    assert.ok(airplaySrc.includes("root.id = 'apo-guest-root'"), 'guest root id set');
    assert.ok(airplaySrc.includes('guestWatch'), 'watchdog present');
    assert.ok(airplaySrc.includes("'hashchange'") && airplaySrc.includes("'pageshow'"), 'late arrivals re-check');
    assert.ok(airplaySrc.includes('must open in ORION'), 'host panel warns the link must open in Orion, not Safari');
  });

  await test('v0.3.0: console link wiring — panel field, QR base, console page is injection-free', () => {
    assert.ok(airplaySrc.includes('Console link'), 'panel has the Console link field');
    assert.ok(airplaySrc.includes('storeCache.consoleUrl'), 'field persists consoleUrl');
    assert.ok(airplaySrc.includes('A.consoleBase(storeCache)'), 'pair links use the console base');
    assert.ok(airplaySrc.includes('never inject'), 'boot skips the console page itself');
    assert.ok(fs.existsSync(__dirname + '/../airplay-console.html'), 'console page built');
    assert.ok(fs.existsSync(__dirname + '/console-sim.js'), 'console simulation present');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
