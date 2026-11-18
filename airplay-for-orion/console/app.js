/* AirPlay Console — the extension-free interface.
 *
 * One static page, no server, no account, no extension. Open it on
 * ANY device/browser (Safari included), pair two copies of it —
 * or one copy + the Orion extension — and share. The wire protocol
 * is byte-for-byte the extension's: PeerJS cloud broker for
 * signalling only, media peer-to-peer, QR carries the room only,
 * 6-digit compare code, heartbeat 4s ping / 12s watchdog is the
 * only drop authority, paired session 6h in localStorage.
 *
 * Roles are per-session, not per-device: whichever side starts a
 * pairing hosts it; either side can send or receive afterwards.
 */
(function () {
  'use strict';

  /* ---------------- helpers (same shapes as the extension) ---------------- */
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function rnd(n) {
    var a = new Uint32Array(1);
    var out = '';
    for (var i = 0; i < n; i++) {
      crypto.getRandomValues(a);
      out += ALPHABET[a[0] % ALPHABET.length];
    }
    return out;
  }
  function randomRoom() { return rnd(14); }
  function randomCode() {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return ('000000' + (a[0] % 1000000)).slice(-6);
  }
  function $(id) { return document.getElementById(id); }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec == null || sec < 0) return '--:--';
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' : '') + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
  }
  function parsePairHash(hash) {
    var m = /[#?&]apo-cast=([A-Za-z0-9]+)/.exec(hash || '');
    return m ? { room: m[1].toUpperCase() } : null;
  }
  function roomFromText(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var p = parsePairHash(s.indexOf('#') >= 0 ? s.slice(s.indexOf('#')) : s);
    if (p) return p.room;
    var bare = s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return bare.length >= 8 ? bare : null;
  }
  function validateCastUrl(u) {
    try {
      var url = new URL(String(u || '').trim());
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch (e) { return null; }
  }
  function isDirectMediaUrl(u) {
    return /\.(mp4|m4v|webm|mov|m3u8|mpd|mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i.test(u || '');
  }
  function defaultDeviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'Browser';
  }
  function probeCapabilities() {
    var v = document.createElement('video');
    return {
      rtc: typeof window.RTCPeerConnection === 'function',
      peerJs: typeof window.Peer === 'function',
      display: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
      vidCapture: typeof v.captureStream === 'function' || typeof v.webkitCaptureStream === 'function',
      userMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    };
  }
  function capsText(c) {
    var yn = function (b) { return b ? 'yes' : 'NO'; };
    return [
      'WebRTC ' + yn(c.rtc) + ' · PeerJS ' + yn(c.peerJs),
      'Screen/tab capture (getDisplayMedia) ' + yn(c.display),
      'Video capture (captureStream) ' + yn(c.vidCapture),
      'Camera (getUserMedia) ' + yn(c.userMedia)
    ].join('\n');
  }
  function drawQrInto(box, url) {
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var n = qr.getModuleCount();
    var cell = 5, quiet = 2;
    var px = (n + quiet * 2) * cell;
    var canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    canvas.style.cssText = 'width:180px;height:180px;display:block;border-radius:8px;';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    box.appendChild(canvas);
  }

  /* ---------------- persistent state (this browser only) ---------------- */
  var LS_KEY = 'airplay_console_v1';
  var store = { deviceName: '', session: null };
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) store = Object.assign(store, JSON.parse(raw));
  } catch (e) {}
  if (!store.deviceName) store.deviceName = defaultDeviceName();
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {} }
  function sessionAlive(s) {
    if (!s || !s.createdAt) return false;
    var age = Date.now() - s.createdAt;
    return s.paired ? age < 6 * 3600 * 1000 : age < 10 * 60 * 1000;
  }

  /* ---------------- runtime state ---------------- */
  var caps = probeCapabilities();
  var mode = 'home';           /* home | host | guest */
  var peer = null, conn = null, call = null;
  var link = { paired: false, remoteName: '', lastPong: 0, pingTimer: null, watchTimer: null, gen: 0 };
  var localStream = null, localKind = null, shareVideo = null;
  var remoteState = null;

  /* ---------------- UI plumbing ---------------- */
  var logLines = [];
  function log(msg) {
    var t = new Date();
    var ts = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
    logLines.push(ts + '  ' + msg);
    if (logLines.length > 60) logLines.shift();
    var box = $('log');
    if (box) { box.textContent = logLines.join('\n'); box.scrollTop = box.scrollHeight; }
  }
  function setStatus(text, color) {
    var s = $('status');
    if (s) { s.textContent = text; if (color) s.style.color = color; }
    var d = $('dot');
    if (d && color) d.style.background = color;
  }
  function show(id) {
    ['card-home', 'card-pair', 'card-main'].forEach(function (x) {
      var n = $(x); if (n) n.style.display = (x === id) ? '' : 'none';
    });
  }

  /* ---------------- peer plumbing (extension protocol) ---------------- */
  function sendData(msg) {
    try { if (conn && conn.open) { conn.send(msg); return true; } } catch (e) {}
    return false;
  }
  function stopHeartbeat() {
    if (link.pingTimer) { clearInterval(link.pingTimer); link.pingTimer = null; }
    if (link.watchTimer) { clearInterval(link.watchTimer); link.watchTimer = null; }
  }
  function startHeartbeat() {
    stopHeartbeat();
    link.lastPong = Date.now();
    link.pingTimer = setInterval(function () { sendData({ type: 'ping' }); }, 4000);
    var gen = link.gen;
    link.watchTimer = setInterval(function () {
      if (gen !== link.gen) return;
      if (Date.now() - link.lastPong > 12000) {
        log('watchdog: no pong for 12s — link dropped');
        onLinkDead();
      }
    }, 2000);
  }
  function teardownPeer() {
    stopHeartbeat();
    try { if (conn) conn.close(); } catch (e) {}
    try { if (call) call.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conn = null; call = null; peer = null;
  }
  function stopSharing(silent) {
    if (localStream) {
      localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      localStream = null;
    }
    if (shareVideo) {
      try { shareVideo.pause(); } catch (e) {}
      if (shareVideo.src && shareVideo.src.indexOf('blob:') === 0) { try { URL.revokeObjectURL(shareVideo.src); } catch (e) {} }
      shareVideo.removeAttribute('src'); shareVideo = null;
    }
    var pv = $('preview'); if (pv) { pv.srcObject = null; pv.style.display = 'none'; }
    localKind = null;
    if (!silent) log('sharing stopped');
    renderSendState();
  }

  /* ---------------- pairing: host mode ---------------- */
  function startHosting(resume) {
    teardownPeer();
    stopSharing(true);
    link = { paired: false, remoteName: '', lastPong: 0, pingTimer: null, watchTimer: null, gen: link.gen + 1 };
    var sess;
    if (resume && store.session && sessionAlive(store.session)) {
      sess = store.session;
    } else {
      sess = { room: randomRoom(), code: null, paired: false, createdAt: Date.now(), peerId: null };
      store.session = sess; save();
    }
    mode = 'host';
    show('card-pair');
    $('pair-title').textContent = sess.paired ? 'Resume this pairing' : 'Pair a device';
    $('pair-sub').textContent = 'On the other device — any browser, no extension — open this page\'s link, or scan:';
    var qrBox = $('qr'); qrBox.innerHTML = '';
    var url = location.href.split('#')[0] + '#apo-cast=' + sess.room;
    try { drawQrInto(qrBox, url); } catch (e) { log('QR draw failed: ' + e.message); }
    $('pair-link').textContent = url;
    $('pair-code-row').style.display = 'none';
    setStatus('Waiting for the other device…', '#ffd60a');
    log('hosting room ' + sess.room);
    peer = new Peer('apo-' + sess.room);
    peer.on('open', function () { log('broker connected (host)'); });
    peer.on('connection', function (c) { wireConn(c, true); });
    peer.on('call', function (c) { answerCall(c); });
    peer.on('error', function (err) {
      log('peer error: ' + err.type);
      if (err.type === 'unavailable-id') setStatus('That room is taken — start a fresh pairing.', '#ff453a');
    });
  }
  function hostOnPairRequest(c, msg) {
    var sess = store.session;
    if (!sess) return;
    var returning = sess.paired && sess.peerId && msg.peerId === sess.peerId;
    if (returning) {
      sess.remoteName = msg.name || sess.remoteName || 'Device';
      save();
      c.send({ type: 'pair-ok', name: store.deviceName });
      log('returning device re-accepted code-free');
      return;
    }
    sess.code = randomCode();
    sess.peerId = msg.peerId || null;
    sess.remoteName = msg.name || 'Device';
    save();
    $('pair-code').textContent = sess.code;
    $('pair-code-row').style.display = '';
    $('pair-sub').textContent = (msg.name || 'A device') + ' wants to pair. It should show the same code:';
    setStatus('Check the code matches, then tap Pair', '#ffd60a');
    c.send({ type: 'pair-code', code: sess.code });
    log('pair-request from ' + (msg.name || 'device') + ' — code issued');
  }
  function hostConfirmPair() {
    var sess = store.session;
    if (!sess) return;
    sess.paired = true; sess.code = null; save();
    sendData({ type: 'pair-ok', name: store.deviceName });
    enterPaired(sess.remoteName || 'Device');
  }

  /* ---------------- pairing: guest mode ---------------- */
  var guestTimer = null;
  function startGuest(room) {
    teardownPeer();
    stopSharing(true);
    link = { paired: false, remoteName: '', lastPong: 0, pingTimer: null, watchTimer: null, gen: link.gen + 1 };
    mode = 'guest';
    show('card-pair');
    $('pair-title').textContent = 'Pair with the host';
    $('pair-sub').textContent = 'Connecting to room ' + room + '…';
    $('qr').innerHTML = '';
    $('pair-link').textContent = '';
    $('pair-code-row').style.display = 'none';
    setStatus('Connecting…', '#ffd60a');
    peer = new Peer('apo-g-' + rnd(8));
    peer.on('open', function (id) {
      log('broker connected (guest ' + id + ')');
      connectGuest(room, id);
    });
    peer.on('call', function (c) { answerCall(c); });
    peer.on('error', function (err) { log('peer error: ' + err.type); });
  }
  function connectGuest(room, myId) {
    var c = peer.connect('apo-' + room, { reliable: true });
    wireConn(c, false);
    c.on('open', function () {
      var sess = store.session;
      var returning = sess && sess.paired && sess.room === room;
      c.send({ type: 'pair-request', name: store.deviceName, peerId: myId, returning: !!returning });
      log('pair-request sent' + (returning ? ' (returning)' : ''));
      if (guestTimer) clearTimeout(guestTimer);
      guestTimer = setTimeout(function () {
        if (!link.paired && mode === 'guest' && !conn) log('still connecting — is the host page open?');
      }, 9000);
    });
  }
  function guestConfirmPair(code) {
    sendData({ type: 'confirm-code', code: code });
    log('confirm-code sent');
  }
  function guestOnPaired(msg) {
    var room = parsePairHash(location.hash);
    store.session = {
      room: room ? room.room : (store.session && store.session.room),
      code: null, paired: true, createdAt: Date.now(), peerId: null,
      remoteName: msg.name || 'Host'
    };
    save();
    enterPaired(msg.name || 'Host');
  }

  /* ---------------- shared connection handling ---------------- */
  function wireConn(c, isHostSide) {
    conn = c;
    c.on('data', function (msg) {
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'ping': sendData({ type: 'pong' }); break;
        case 'pong': link.lastPong = Date.now(); break;
        case 'pair-request': if (isHostSide) hostOnPairRequest(c, msg); break;
        case 'pair-code':
          $('pair-code').textContent = msg.code;
          $('pair-code-row').style.display = '';
          $('pair-sub').textContent = 'The host shows a code too. If they match, tap Pair:';
          $('pair-confirm').onclick = function () { guestConfirmPair(msg.code); };
          setStatus('Check the code matches', '#ffd60a');
          log('pair-code received');
          break;
        case 'confirm-code': {
          var sess = store.session;
          if (isHostSide && sess && sess.code && msg.code === sess.code) {
            log('code confirmed by guest — tap Pair here to finish');
            setStatus('Code confirmed — tap Pair to finish', '#ffd60a');
            $('pair-confirm').onclick = hostConfirmPair;
          } else if (isHostSide) {
            c.send({ type: 'pair-denied' });
            log('confirm-code MISMATCH — denied');
          }
          break;
        }
        case 'pair-ok':
          if (!isHostSide) guestOnPaired(msg);
          else enterPaired(store.session && store.session.remoteName || 'Device');
          break;
        case 'pair-denied':
          setStatus('Pairing denied — codes did not match.', '#ff453a');
          log('pairing denied');
          break;
        case 'cast-url': playCastUrl(msg.url, msg.title); break;
        case 'cast-ctl': handleCtl(msg); break;
        case 'state': remoteState = msg; renderRemoteCtl(); break;
        case 'end': onLinkDead(); break;
      }
    });
    c.on('close', function () { log('data connection closed (watchdog decides)'); });
    c.on('error', function (e) { log('connection error: ' + (e && e.type || e)); });
  }
  function enterPaired(remoteName) {
    link.paired = true;
    link.remoteName = remoteName || 'Device';
    startHeartbeat();
    show('card-main');
    setStatus('Paired with ' + link.remoteName, '#30d158');
    $('main-sub').textContent = 'Paired with ' + link.remoteName + ' — either side can send.';
    log('PAIRED with ' + link.remoteName);
    renderSendState();
  }
  function onLinkDead() {
    if (!link.paired && mode === 'home') return;
    var wasGuest = mode === 'guest';
    var room = store.session && store.session.room;
    link.paired = false;
    stopHeartbeat();
    stopSharing(true);
    var vid = $('player-video'); if (vid) { vid.style.display = 'none'; try { vid.pause(); } catch (e) {} }
    var fr = $('player-frame'); if (fr) { fr.style.display = 'none'; fr.removeAttribute('src'); }
    $('player-idle').style.display = '';
    setStatus('Connection lost', '#ff453a');
    log('link dead');
    if (wasGuest && room && store.session && store.session.paired) {
      log('redialling the same session in 3s…');
      setTimeout(function () { if (!link.paired) startGuest(room); }, 3000);
    } else if (mode === 'host') {
      setStatus('Connection lost — this page is still hosting; the other device can rejoin.', '#ffd60a');
      teardownPeer();
      startHosting(true);
    }
  }
  function disconnectForget() {
    sendData({ type: 'end' });
    teardownPeer();
    stopSharing(true);
    store.session = null; save();
    link.paired = false;
    mode = 'home';
    history.replaceState(null, '', location.href.split('#')[0]);
    show('card-home');
    setStatus('Not paired', '#8e8e93');
    log('disconnected and forgot the pairing');
    renderHome();
  }

  /* ---------------- receiving ---------------- */
  function playCastUrl(url, title) {
    var v = $('player-video'), f = $('player-frame');
    $('player-idle').style.display = 'none';
    if (isDirectMediaUrl(url)) {
      f.style.display = 'none'; f.removeAttribute('src');
      v.style.display = '';
      v.src = url;
      v.play().catch(function () {});
    } else {
      v.style.display = 'none'; try { v.pause(); } catch (e) {}
      v.removeAttribute('src'); v.load();
      f.style.display = '';
      f.src = url;
    }
    $('now-playing').textContent = '▶ ' + (title || url);
    log('receiving cast: ' + url);
    pushState();
  }
  function answerCall(c) {
    call = c;
    c.answer();
    c.on('stream', function (stream) {
      var v = $('player-video'), f = $('player-frame');
      f.style.display = 'none'; f.removeAttribute('src');
      $('player-idle').style.display = 'none';
      v.style.display = '';
      v.srcObject = stream;
      v.play().catch(function () {});
      $('now-playing').textContent = '▶ Live share from ' + link.remoteName;
      log('receiving live stream');
      pushState();
    });
    c.on('close', function () { log('media call closed'); });
    c.on('error', function (e) { log('call error: ' + (e && e.type || e)); });
  }
  function currentPlayerVideo() {
    var v = $('player-video');
    return (v && v.style.display !== 'none') ? v : null;
  }
  function handleCtl(msg) {
    var v = currentPlayerVideo();
    if (!v) { log('remote control ignored (nothing playing here)'); return; }
    try {
      if (msg.action === 'play') v.play();
      else if (msg.action === 'pause') v.pause();
      else if (msg.action === 'seekBy') v.currentTime = Math.max(0, (v.currentTime || 0) + (msg.delta || 0));
      else if (msg.action === 'seekTo') v.currentTime = msg.time || 0;
      else if (msg.action === 'fullscreen') {
        if (v.requestFullscreen) v.requestFullscreen();
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      }
    } catch (e) { log('control failed: ' + e.message); }
    setTimeout(pushState, 60);
  }
  var stateTimer = null;
  function pushState() {
    var v = currentPlayerVideo();
    if (!v || !link.paired) return;
    sendData({
      type: 'state', playing: !v.paused && !v.ended,
      currentTime: v.currentTime || 0, duration: isFinite(v.duration) ? v.duration : 0,
      title: $('now-playing').textContent.replace(/^▶ /, '') || 'Video'
    });
  }

  /* ---------------- sending ---------------- */
  function renderSendState() {
    var b = $('stop-share');
    if (b) b.style.display = localStream ? '' : 'none';
    var cam = $('share-camera'); if (cam) cam.disabled = !caps.userMedia;
    var scr = $('share-screen'); if (scr) scr.disabled = !caps.display;
  }
  function renderRemoteCtl() {
    var row = $('remote-ctl');
    if (!remoteState || !link.paired) { row.style.display = 'none'; return; }
    row.style.display = '';
    $('remote-label').textContent =
      (remoteState.playing ? '▶ ' : '❚❚ ') + (remoteState.title || 'Video') + ' · ' +
      fmtTime(remoteState.currentTime) + ' / ' + fmtTime(remoteState.duration);
    $('remote-toggle').textContent = remoteState.playing ? '❚❚ Pause' : '▶ Play';
  }
  function startStreamSend(stream, kind, previewEl) {
    if (!peer || !conn) { log('not connected'); return; }
    localStream = stream;
    localKind = kind;
    stream.getTracks().forEach(function (t) {
      t.addEventListener('ended', function () { stopSharing(); });
    });
    var remoteId = (mode === 'host')
      ? (store.session && store.session.peerId)
      : 'apo-' + ((store.session && store.session.room) || '');
    if (!remoteId) { log('no remote peer id yet'); return; }
    call = peer.call(remoteId, stream, { metadata: { kind: kind } });
    if (call) {
      call.on('error', function (e) { log('call error: ' + (e && e.type || e)); });
    }
    if (previewEl) {
      var pv = $('preview');
      pv.style.display = '';
      pv.srcObject = stream;
      pv.play().catch(function () {});
    }
    log('sharing ' + kind + ' → ' + link.remoteName);
    renderSendState();
  }
  function sendCastUrl() {
    var url = validateCastUrl($('cast-url').value);
    if (!url) { log('cast: paste a valid http(s) link'); return; }
    if (sendData({ type: 'cast-url', url: url, title: url })) {
      $('now-playing').textContent = 'Sent to ' + link.remoteName + ': ' + url;
      log('cast URL sent');
    }
  }
  function shareCamera() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(function (s) { startStreamSend(s, 'camera', true); })
      .catch(function (e) { log('camera failed: ' + e.message); });
  }
  function shareScreen() {
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then(function (s) { startStreamSend(s, 'screen', true); })
      .catch(function (e) { log('screen share failed: ' + e.message); });
  }
  function shareFile(file) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var v = document.createElement('video');
    v.src = url;
    v.loop = true;
    v.muted = false;
    v.setAttribute('playsinline', '');
    shareVideo = v;
    v.play().then(function () {
      var cap = v.captureStream || v.webkitCaptureStream;
      if (!cap) { log('this browser cannot capture a video file'); return; }
      startStreamSend(cap.call(v), 'file', false);
      var pv = $('preview');
      pv.style.display = '';
      pv.srcObject = null;
      pv.src = url;
      pv.loop = true;
      pv.play().catch(function () {});
    }).catch(function (e) { log('file play failed: ' + e.message); });
  }

  /* ---------------- home / wiring ---------------- */
  function renderHome() {
    var sess = store.session;
    var resumeRow = $('resume-row');
    if (sess && sess.paired && sessionAlive(sess)) {
      resumeRow.style.display = '';
      $('resume-label').textContent = 'Paired session with ' + (sess.remoteName || 'a device') + ' is still alive.';
    } else {
      resumeRow.style.display = 'none';
    }
    $('caps').textContent = capsText(caps);
  }
  function init() {
    $('device-name').value = store.deviceName;
    $('device-name').addEventListener('change', function () {
      store.deviceName = $('device-name').value.trim() || defaultDeviceName();
      save(); log('device name: ' + store.deviceName);
    });
    $('start-host').addEventListener('click', function () { startHosting(false); });
    $('resume-host').addEventListener('click', function () {
      var sess = store.session;
      if (sess && sess.room) {
        if (mode === 'home') { /* host resume if we hosted, guest redial if we joined */
          if (sess.peerId) startHosting(true); else startGuest(sess.room);
        }
      }
    });
    $('join-btn').addEventListener('click', function () {
      var room = roomFromText($('join-input').value);
      if (!room) { log('join: paste the pairing link or its room code'); return; }
      history.replaceState(null, '', location.href.split('#')[0] + '#apo-cast=' + room);
      startGuest(room);
    });
    $('forget-home').addEventListener('click', disconnectForget);
    $('pair-cancel').addEventListener('click', disconnectForget);
    $('disconnect').addEventListener('click', disconnectForget);
    $('cast-send').addEventListener('click', sendCastUrl);
    $('share-camera').addEventListener('click', shareCamera);
    $('share-screen').addEventListener('click', shareScreen);
    $('share-file-btn').addEventListener('click', function () { $('share-file').click(); });
    $('share-file').addEventListener('change', function () { shareFile($('share-file').files[0]); });
    $('stop-share').addEventListener('click', function () { stopSharing(); });
    $('remote-toggle').addEventListener('click', function () {
      sendData({ type: 'cast-ctl', action: remoteState && remoteState.playing ? 'pause' : 'play' });
    });
    $('remote-back').addEventListener('click', function () { sendData({ type: 'cast-ctl', action: 'seekBy', delta: -10 }); });
    $('remote-fwd').addEventListener('click', function () { sendData({ type: 'cast-ctl', action: 'seekBy', delta: 10 }); });
    $('remote-fs').addEventListener('click', function () { sendData({ type: 'cast-ctl', action: 'fullscreen' }); });
    $('player-fs').addEventListener('click', function () {
      var v = currentPlayerVideo();
      if (v) { if (v.requestFullscreen) v.requestFullscreen(); else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
    });
    var v = $('player-video');
    ['play', 'pause', 'timeupdate', 'ended'].forEach(function (ev) {
      v.addEventListener(ev, function () {
        if (ev === 'timeupdate') {
          if (stateTimer) return;
          stateTimer = setTimeout(function () { stateTimer = null; pushState(); }, 4000);
        } else pushState();
      });
    });
    renderHome();
    var fromHash = parsePairHash(location.hash);
    if (fromHash) {
      log('opened with a pairing link — joining room ' + fromHash.room);
      startGuest(fromHash.room);
    } else {
      show('card-home');
      setStatus('Not paired', '#8e8e93');
    }
    log('console ready · ' + store.deviceName);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
