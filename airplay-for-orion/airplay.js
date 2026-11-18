/* AirPlay for Orion — simulated AirPlay between two Orion devices.
 *
 * Pairing follows HeckYeah TV v1.37 exactly, carried over WebRTC
 * because a WebExtension cannot run the TV app's LAN server (no
 * listening sockets): the QR encodes ONLY a room id in a fragment of
 * a neutral carrier page (example.com — fragments never reach the
 * server). The second device opens it, connects, and REQUESTS
 * pairing; the host generates a one-time 6-digit code (60s, single
 * active request) shown on BOTH screens; either side confirms.
 *
 * ROAMING HOST (HeckYeah Orion 0.7/0.8 lessons): the session lives in
 * extension storage, not in one page. Whichever tab is in front hosts
 * the peer; navigation re-hosts the same room and an already-paired
 * device is re-accepted with no code. NO background page (0.6.0
 * proved Orion background hosts never connect). NO socket event
 * alone may end a pairing (v1.38 rule): drops are declared only by
 * the 4s-ping / 12s-no-pong heartbeat watchdog, and the guest redials
 * the SAME session — the session is the credential.
 *
 * Media:
 *  - Cast URL: the receiver plays the URL itself (full quality, the
 *    AirPlay /play equivalent). Direct media files play in <video>;
 *    page URLs open in a receiver frame with a note.
 *  - Share this page's video: <video>.captureStream() over a PeerJS
 *    media call.
 *  - Share screen/tab: getDisplayMedia() — historically absent on
 *    iOS WebKit; the capability report says plainly whether THIS
 *    device has it. Whole-device mirroring (other apps, Home Screen)
 *    is impossible from an extension — native ReplayKit only.
 *  - Share camera: getUserMedia().
 * Controls travel back over the data channel. */
(function () {
  'use strict';
  if (window.__apoAirplay) return;
  window.__apoAirplay = true;
  var A = window.APO;
  if (!A) return;
  var isTop = window.top === window;
  if (!isTop) return;

  var guestInfo = A.parsePairHash(location.hash);
  var isGuestPage = !!guestInfo;

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text != null) e.textContent = text;
    return e;
  }
  var BLUE = '#0a84ff';
  var BTN = 'background:' + BLUE + ';color:#fff;border:none;border-radius:999px;padding:11px 16px;font-size:14.5px;font-weight:650;cursor:pointer;';
  var GHOST = 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:999px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;';
  var DANGER = 'background:rgba(255,69,58,0.16);color:#ff6961;border:none;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:650;cursor:pointer;';
  var GLASS = 'background:rgba(16,20,34,0.82);color:#f2f4f8;border:1px solid rgba(255,255,255,0.18);' +
    'backdrop-filter:blur(26px) saturate(190%);-webkit-backdrop-filter:blur(26px) saturate(190%);' +
    'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;';
  var INPUT = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.16);' +
    'border-radius:12px;color:#fff;padding:11px 12px;font-size:15px;outline:none;';

  var caps = A.probeCapabilities();
  var storeCache = A.defaultStore();
  var myName = '';
  var role = isGuestPage ? 'source' : 'player';

  /* ---------------- shared link state ---------------- */
  var link = {
    peer: null, conn: null, call: null,
    paired: false, isHost: false,
    remotePeerId: null, remoteName: '',
    pending: null, /* host only: { code, conn, at } */
    lastTraffic: 0, lastPong: 0,
    localStream: null, sharingLabel: '',
    log: []
  };
  var ui = null; /* { render(), logBox, status setters } — set by panel/guest builders */

  function log(line) {
    var d = new Date();
    var ts = ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    link.log.unshift(ts + '  ' + line);
    link.log = link.log.slice(0, 8);
    if (ui && ui.logBox) ui.logBox.textContent = link.log.join('\n');
  }
  function setStatus(text, color) {
    if (ui && ui.setStatus) ui.setStatus(text, color);
  }
  function render() { if (ui) ui.render(); }

  function loadStore(cb) {
    A.loadStore().then(function (s) { storeCache = s; cb(s); });
  }
  function saveSession(sess) {
    storeCache.session = sess;
    return A.saveStore(storeCache);
  }
  function getSession() { return storeCache.session || null; }

  /* Extract a room from a pasted pairing link or a bare room code. */
  function roomFromText(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var parsed = A.parsePairHash(s.indexOf('#') >= 0 ? s.slice(s.indexOf('#')) : s);
    if (parsed) return parsed.room;
    var bare = s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return bare.length >= 8 ? bare : null;
  }

  function sendData(msg) {
    if (link.conn) { try { link.conn.send(msg); return true; } catch (e) {} }
    return false;
  }

  /* ---------------- receiver ---------------- */
  var recv = null; /* { wrap, video, titleEl } */
  function closeReceiver(notify) {
    if (!recv) return;
    try { recv.video.pause(); } catch (e) {}
    try { recv.video.srcObject = null; recv.video.removeAttribute('src'); recv.video.load(); } catch (e) {}
    recv.wrap.remove();
    recv = null;
    if (notify) sendData({ t: 'ctl', a: 'stopped' });
  }
  function openReceiver() {
    if (recv) return recv;
    var wrap = el('div', 'position:fixed;inset:0;z-index:2147483603;background:#000;display:flex;flex-direction:column;' +
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;color:#fff;');
    var bar = el('div', 'display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(20,22,30,0.85);');
    var title = el('div', 'font-size:15px;font-weight:650;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', 'AirPlay receiver');
    bar.appendChild(title);
    var fsBtn = el('button', GHOST + 'padding:8px 12px;', '⛶ Fullscreen');
    var closeBtn = el('button', DANGER + 'padding:8px 12px;', 'Stop');
    bar.appendChild(fsBtn);
    bar.appendChild(closeBtn);
    wrap.appendChild(bar);
    var video = document.createElement('video');
    video.setAttribute('style', 'flex:1;width:100%;min-height:0;background:#000;');
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;
    wrap.appendChild(video);
    var ctl = el('div', 'display:flex;align-items:center;justify-content:center;gap:14px;padding:12px;background:rgba(20,22,30,0.85);');
    function cBtn(label, fn) {
      var b = el('button', GHOST + 'min-width:64px;padding:10px;', label);
      b.addEventListener('click', fn);
      ctl.appendChild(b);
      return b;
    }
    cBtn('−10s', function () { video.currentTime = Math.max(0, video.currentTime - 10); });
    cBtn('⏯', function () { if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } else video.pause(); });
    cBtn('+10s', function () { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10); });
    wrap.appendChild(ctl);
    document.body.appendChild(wrap);
    fsBtn.addEventListener('click', function () {
      try {
        if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else if (wrap.requestFullscreen) wrap.requestFullscreen();
      } catch (e) {}
    });
    closeBtn.addEventListener('click', function () { closeReceiver(true); });
    recv = { wrap: wrap, video: video, titleEl: title };
    return recv;
  }
  function receiveStream(stream, fromName) {
    var r = openReceiver();
    r.titleEl.textContent = 'Live from ' + (fromName || link.remoteName || 'paired device');
    r.video.srcObject = stream;
    var p = r.video.play();
    if (p && p.catch) p.catch(function () {});
    log('receiving live stream');
    setStatus('Receiving', '#30d158');
  }
  function receiveUrl(url, title, fromName) {
    var clean = A.validateCastUrl(url);
    if (!clean) { log('refused a non-http(s) cast URL'); return; }
    var r = openReceiver();
    r.titleEl.textContent = (title || clean) + (fromName ? '  ·  from ' + fromName : '');
    if (A.isDirectMediaUrl(clean)) {
      r.video.srcObject = null;
      r.video.src = clean;
      var p = r.video.play();
      if (p && p.catch) p.catch(function () {});
      log('playing cast URL directly');
    } else {
      /* A page URL: show it in a frame under the bar (best effort —
       * many sites send X-Frame-Options and will refuse). */
      r.video.style.display = 'none';
      var fr = document.createElement('iframe');
      fr.setAttribute('style', 'flex:1;width:100%;min-height:0;border:none;background:#fff;');
      fr.src = clean;
      r.wrap.insertBefore(fr, r.wrap.lastChild);
      recv.frame = fr;
      log('cast page URL opened in receiver frame (site may refuse framing)');
    }
    setStatus('Receiving', '#30d158');
  }

  /* ---------------- source: capture + call ---------------- */
  function stopSharing(notify) {
    if (link.localStream) {
      link.localStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      link.localStream = null;
    }
    if (link.call) { try { link.call.close(); } catch (e) {} link.call = null; }
    link.sharingLabel = '';
    if (notify) sendData({ t: 'ctl', a: 'stopped' });
    render();
  }
  function startCallWithStream(stream, label) {
    if (!link.remotePeerId) { log('cannot share yet — no remote peer id (pair first)'); return; }
    if (!link.peer) { log('cannot share — not connected'); return; }
    stopSharing(false);
    link.localStream = stream;
    link.sharingLabel = label;
    stream.getTracks().forEach(function (t) {
      t.addEventListener('ended', function () { log('share ended (' + label + ')'); stopSharing(true); });
    });
    try {
      link.call = link.peer.call(link.remotePeerId, stream);
      log('sharing: ' + label);
      setStatus('Sharing — ' + label, '#30d158');
    } catch (e) {
      log('media call failed: ' + (e && e.message));
      stopSharing(false);
    }
    render();
  }
  function sharePageVideo() {
    var vids = document.querySelectorAll('video');
    var best = null, bestArea = -1;
    for (var i = 0; i < vids.length; i++) {
      var r = vids[i].getBoundingClientRect();
      var area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) { bestArea = area; best = vids[i]; }
    }
    if (!best) { log('no <video> on this page to share'); if (ui) ui.toast('No video on this page'); return; }
    var fn = best.captureStream || best.webkitCaptureStream;
    if (!fn) { log('captureStream NOT available for page videos on this device'); if (ui) ui.toast('Video capture not supported here'); return; }
    try {
      var stream = fn.call(best);
      if (best.paused) { var p = best.play(); if (p && p.catch) p.catch(function () {}); }
      startCallWithStream(stream, 'page video');
    } catch (e) { log('captureStream failed: ' + (e && e.message)); }
  }
  function shareScreen() {
    var md = navigator.mediaDevices || {};
    if (typeof md.getDisplayMedia !== 'function') {
      log('getDisplayMedia NOT available on this device/browser — screen share impossible here');
      if (ui) ui.toast('Screen share not available on this device');
      return;
    }
    md.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
      startCallWithStream(stream, 'screen / tab');
    }).catch(function (e) { log('screen share cancelled/failed: ' + (e && e.name)); });
  }
  function shareCamera() {
    var md = navigator.mediaDevices || {};
    if (typeof md.getUserMedia !== 'function') { log('getUserMedia NOT available'); return; }
    md.getUserMedia({ video: { facingMode: 'user' }, audio: true }).then(function (stream) {
      startCallWithStream(stream, 'camera');
    }).catch(function (e) { log('camera failed: ' + (e && e.name)); });
  }
  function castUrl(url) {
    var clean = A.validateCastUrl(url);
    if (!clean) { if (ui) ui.toast('Only http(s) URLs can be cast'); return; }
    if (sendData({ t: 'cast-url', url: clean, title: document.title, name: myName })) {
      log('cast URL sent');
      setStatus('Sent to player', '#30d158');
    } else {
      log('cast failed — not paired/connected');
    }
  }

  /* ---------------- pairing: host side ---------------- */
  var hosting = false;
  function stopHosting() {
    hosting = false;
    link.paired = false;
    link.conn = null;
    link.pending = null;
    try { link.peer && link.peer.destroy(); } catch (e) {}
    link.peer = null;
  }
  function endSession() {
    log('session ended');
    stopSharing(false);
    closeReceiver(false);
    stopHosting();
    loadStore(function (s) { saveSession(null); render(); });
  }
  function completePairing(how) {
    if (!link.pending) return;
    var conn = link.pending.conn;
    link.paired = true;
    link.conn = conn;
    link.pending = null;
    try { conn.send({ t: 'paired', peerId: A.hostPeerId(getSession().room), name: myName }); } catch (e) {}
    log('paired ✓ (confirmed on ' + how + ')');
    setStatus('Connected', '#30d158');
    var sess = getSession();
    if (sess) { sess.paired = true; saveSession(sess); }
    startHeartbeat();
    render();
  }
  function wireConn(conn, isHostSide) {
    conn.on('data', function (msg) { handleData(msg, conn, isHostSide); });
    conn.on('close', function () {
      /* Log only — a close event alone never ends the pairing. */
      log('channel closed (watchdog decides)');
      if (link.conn === conn) link.conn = null;
      render();
    });
  }
  function handleData(msg, conn, isHostSide) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'ping':
        link.lastTraffic = Date.now();
        try { conn.send({ t: 'pong' }); } catch (e) {}
        return;
      case 'pong':
        link.lastPong = Date.now();
        return;
      case 'bye':
        log('remote said bye');
        endSession();
        return;
      case 'cast-url':
        if (link.paired || !isHostSide) receiveUrl(msg.url, msg.title, msg.name);
        return;
      case 'ctl':
        handleCtl(msg.a);
        return;
      case 'hello':
        if (msg.name) { link.remoteName = msg.name; }
        if (msg.peerId) { link.remotePeerId = msg.peerId; }
        return;
    }
    if (isHostSide) {
      if (msg.t === 'pair-request') {
        log('guest: pair-request from ' + (msg.name || 'device'));
        if (msg.peerId) link.remotePeerId = msg.peerId;
        if (msg.name) link.remoteName = msg.name;
        var sess = getSession();
        if (sess && sess.paired) {
          link.paired = true;
          link.conn = conn;
          try { conn.send({ t: 'paired', peerId: A.hostPeerId(sess.room), name: myName }); } catch (e) {}
          log('paired ✓ (returning device, no code)');
          setStatus('Connected', '#30d158');
          startHeartbeat();
          render();
          return;
        }
        link.pending = { code: A.randomCode(), conn: conn, at: Date.now() };
        try { conn.send({ t: 'code', code: link.pending.code, name: myName }); } catch (e) {}
        log('code issued: ' + link.pending.code);
        openPanel(true);
        render();
        return;
      }
      if (msg.t === 'pair-confirm') {
        if (link.pending && conn === link.pending.conn && Date.now() - link.pending.at < A.CODE_TTL) {
          completePairing('other device');
        } else {
          log('confirm ignored (no live code)');
        }
        return;
      }
    } else {
      /* guest side */
      if (msg.t === 'code') {
        guestState.code = msg.code;
        if (msg.name) link.remoteName = msg.name;
        log('code received: ' + msg.code);
        setStatus('Code received', '#ffd60a');
        render();
        return;
      }
      if (msg.t === 'paired') {
        link.paired = true;
        if (msg.peerId) link.remotePeerId = msg.peerId;
        if (msg.name) link.remoteName = msg.name;
        log('paired ✓');
        setStatus('Connected', '#30d158');
        startHeartbeat();
        render();
        return;
      }
      if (msg.t === 'denied') {
        guestState.stopped = true;
        log('rejected by host');
        setStatus('Rejected', '#ff453a');
        render();
        return;
      }
    }
  }
  function handleCtl(a) {
    if (a === 'stopped') {
      log('remote stopped playback/sharing');
      closeReceiver(false);
      stopSharing(false);
      setStatus('Connected', '#30d158');
      render();
      return;
    }
    if (!recv || !recv.video) { log('control ignored — nothing playing here'); return; }
    var v = recv.video;
    if (a === 'playpause') { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); }
    else if (a === 'back') v.currentTime = Math.max(0, v.currentTime - 10);
    else if (a === 'fwd') v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10);
    else if (a === 'fullscreen') {
      try { if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); } catch (e) {}
    }
  }
  function wireIncomingCalls(peer) {
    peer.on('call', function (call) {
      log('incoming media call');
      call.answer();
      call.on('stream', function (stream) { receiveStream(stream, link.remoteName); });
      call.on('close', function () { log('media call closed'); });
    });
  }
  function startHosting(sess) {
    if (hosting || isGuestPage) return;
    if (typeof window.Peer !== 'function') { log('PeerJS library missing on this page'); return; }
    hosting = true;
    link.isHost = true;
    var peer;
    try { peer = new window.Peer(A.hostPeerId(sess.room)); }
    catch (e) { hosting = false; log('peer create failed: ' + e.message); return; }
    link.peer = peer;
    wireIncomingCalls(peer);
    peer.on('open', function () { log('host: broker connected'); });
    peer.on('disconnected', function () { log('host: broker dropped — reconnecting'); try { peer.reconnect(); } catch (e) {} });
    peer.on('connection', function (conn) {
      log('guest: channel opening');
      conn.on('iceStateChanged', function (s) { log('guest: ice ' + s); });
      wireConn(conn, true);
    });
    peer.on('error', function (err) {
      var type = err && err.type ? err.type : 'unknown';
      log('host: peer error ' + type);
      if (type === 'unavailable-id') {
        hosting = false;
        link.peer = null;
        log('host: another tab already hosts — standing aside');
      }
    });
  }

  /* Roaming: visible tab hosts; host heartbeats into the store; a
   * host with a LIVE paired device (traffic < 12s) never yields. */
  function roamTick() {
    if (isGuestPage) return;
    loadStore(function (s) {
      var sess = s.session;
      if (!A.sessionAlive(sess)) {
        if (sess) saveSession(null);
        if (hosting && !ui) stopHosting();
        return;
      }
      myName = s.deviceName || myName;
      if (!sess.paired) return;
      if (hosting) {
        var serving = link.conn && Date.now() - (link.lastTraffic || 0) < 12000;
        if (document.hidden && sess.wantHost && Date.now() - sess.wantHost < 8000 && !serving) {
          log('roam: yielding stage to visible tab');
          stopHosting();
          return;
        }
        sess.hostBeat = Date.now();
        saveSession(sess);
        return;
      }
      if (!document.hidden) { sess.wantHost = Date.now(); saveSession(sess); }
      var beatStale = !sess.hostBeat || Date.now() - sess.hostBeat > 5000;
      var probeDue = !link.lastHostTry || Date.now() - link.lastHostTry > 6000;
      if (beatStale || (probeDue && !document.hidden)) {
        link.lastHostTry = Date.now();
        startHosting(sess);
      }
    });
  }

  /* ---------------- heartbeat (the only drop authority) ---------------- */
  var pingTimer = null, watchTimer = null;
  function startHeartbeat() {
    stopHeartbeat();
    link.lastPong = Date.now();
    pingTimer = setInterval(function () { sendData({ t: 'ping' }); }, 4000);
    watchTimer = setInterval(function () {
      if (link.paired && Date.now() - link.lastPong > 12000 && Date.now() - (link.lastTraffic || 0) > 12000) {
        setStatus('Reconnecting…', '#ffd60a');
        if (!link.isHost && guestState.gen != null) guestDrop('heartbeat lost (no pong for 12s)');
      }
    }, 4000);
  }
  function stopHeartbeat() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  }

  /* ---------------- guest side ---------------- */
  var guestState = { code: null, stopped: false, gen: 0, reconnectTimer: null };
  function guestDrop(why) {
    if (guestState.stopped) return;
    log('dropped (' + why + ') — redialling the same session');
    guestState.gen++;
    stopHeartbeat();
    link.paired = false;
    link.conn = null;
    try { link.peer && link.peer.destroy(); } catch (e) {}
    link.peer = null;
    guestState.code = null;
    setStatus('Reconnecting…', '#ffd60a');
    render();
    if (!guestState.reconnectTimer) {
      guestState.reconnectTimer = setTimeout(function () { guestState.reconnectTimer = null; guestConnect(); }, 2000);
    }
  }
  function guestConnect() {
    if (guestState.stopped) return;
    if (typeof window.Peer !== 'function') { setStatus('Pairing unavailable', '#ff453a'); log('PeerJS library missing'); return; }
    var myGen = ++guestState.gen;
    try { link.peer && link.peer.destroy(); } catch (e) {}
    link.peer = null;
    link.conn = null;
    setStatus('Connecting…', '#ffd60a');
    log('dialing broker…');
    var peer;
    try { peer = new window.Peer(); } catch (e) { log('peer create failed'); guestDrop('create'); return; }
    link.peer = peer;
    link.isHost = false;
    wireIncomingCalls(peer);
    peer.on('error', function (err) {
      if (myGen !== guestState.gen) return;
      var type = err && err.type ? err.type : 'unknown';
      log('peer error: ' + type);
      if (type === 'peer-unavailable') {
        setStatus('Waiting for host…', '#ffd60a');
        if (!guestState.reconnectTimer) {
          guestState.reconnectTimer = setTimeout(function () { guestState.reconnectTimer = null; guestConnect(); }, 2000);
        }
      }
    });
    peer.on('disconnected', function () { try { peer.reconnect(); } catch (e) {} });
    peer.on('open', function (id) {
      if (myGen !== guestState.gen) return;
      log('broker connected');
      var conn = peer.connect(A.hostPeerId(guestInfo.room), { reliable: true });
      link.conn = conn;
      conn.on('iceStateChanged', function (s) { log('ice: ' + s); /* log only — never a drop reason */ });
      conn.on('open', function () {
        if (myGen !== guestState.gen) return;
        log('channel open — requesting pairing');
        setStatus('Asking to pair…', '#ffd60a');
        try { conn.send({ t: 'pair-request', peerId: id, name: myName }); } catch (e) {}
        wireConn(conn, false);
      });
      conn.on('close', function () {
        if (myGen !== guestState.gen) return;
        /* A close alone doesn't declare the drop — but on the guest,
         * with no other channel, treat it as a redial trigger while
         * keeping the session (the pairing itself survives). */
        guestDrop('channel closed');
      });
    });
  }

  /* ---------------- shared UI body ---------------- */
  function capsLines() {
    function yn(b) { return b ? '✓' : '✗'; }
    return [
      'WebRTC ' + yn(caps.rtc) + ' · PeerJS ' + yn(caps.peerJs),
      'Screen/tab capture (getDisplayMedia) ' + yn(caps.display),
      'Page-video capture (captureStream) ' + yn(caps.vidCapture),
      'Camera (getUserMedia) ' + yn(caps.userMedia)
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
    canvas.style.width = '180px'; canvas.style.height = '180px'; canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    box.appendChild(canvas);
  }

  function buildBody(container, opts) {
    /* opts: { onClose } for panel mode */
    container.innerHTML = '';
    var sess = getSession();

    var head = el('div', 'display:flex;align-items:center;gap:8px;');
    var dot = el('span', 'width:9px;height:9px;border-radius:50%;background:' +
      (link.paired ? '#30d158' : (sess && A.sessionAlive(sess) ? '#ffd60a' : '#8e8e93')) + ';display:inline-block;flex:0 0 auto;');
    head.appendChild(dot);
    head.appendChild(el('div', 'font-size:19px;font-weight:750;flex:1;', 'AirPlay'));
    var statusEl = el('div', 'font-size:12.5px;color:#9fb0c9;font-weight:600;',
      link.paired ? 'Connected' : (isGuestPage ? 'Connecting…' : 'Not paired'));
    head.appendChild(statusEl);
    container.appendChild(head);
    ui.setStatus = function (text, color) { statusEl.textContent = text; dot.style.background = color || '#ffd60a'; };

    var nameRow = el('div', 'display:flex;gap:8px;align-items:center;margin-top:12px;');
    nameRow.appendChild(el('div', 'font-size:13px;color:#9fb0c9;flex:0 0 auto;', 'This device'));
    var nameInput = document.createElement('input');
    nameInput.setAttribute('style', INPUT + 'flex:1;padding:8px 10px;font-size:14px;');
    nameInput.value = myName;
    nameInput.addEventListener('change', function () {
      myName = nameInput.value.trim() || myName;
      storeCache.deviceName = myName;
      A.saveStore(storeCache);
      sendData({ t: 'hello', peerId: link.isHost ? (sess ? A.hostPeerId(sess.room) : null) : undefined, name: myName });
    });
    nameRow.appendChild(nameInput);
    container.appendChild(nameRow);

    /* Console link (v0.3.0): pairing links point at the hosted
     * console page when set — the other device then needs NO
     * extension, any browser works. Empty = extension-only pairing
     * via the example.com carrier. */
    var consoleRow = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px;');
    consoleRow.appendChild(el('div', 'font-size:13px;color:#9fb0c9;flex:0 0 auto;', 'Console link'));
    var consoleInput = document.createElement('input');
    consoleInput.setAttribute('style', INPUT + 'flex:1;padding:8px 10px;font-size:12.5px;');
    consoleInput.setAttribute('placeholder', 'https://…/airplay-console.html (optional)');
    consoleInput.value = A.consoleBase(storeCache);
    consoleInput.addEventListener('change', function () {
      storeCache.consoleUrl = consoleInput.value.trim();
      A.saveStore(storeCache);
      log(storeCache.consoleUrl
        ? 'console link set — pairing QRs now point at the console page'
        : 'console link cleared — pairing is extension-only');
      if (ui && ui.render) ui.render();
    });
    consoleRow.appendChild(consoleInput);
    container.appendChild(consoleRow);

    /* ----- guest pairing card ----- */
    if (isGuestPage && !link.paired) {
      var card = el('div', 'margin-top:16px;text-align:center;');
      card.appendChild(el('div', 'font-size:13px;color:#9fb0c9;letter-spacing:0.3px;', 'PAIRING CODE'));
      card.appendChild(el('div', 'font-size:42px;font-weight:800;letter-spacing:8px;margin:6px 0 2px;font-variant-numeric:tabular-nums;',
        guestState.code ? String(guestState.code).split('').join(' ') : '– – – – – –'));
      card.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:0 6px 12px;',
        guestState.stopped ? 'The other device rejected this pairing. Ask it to show a new QR and scan again.' :
        guestState.code ? 'If the other device shows this same code, tap Pair.' : 'Asking the other device for a code…'));
      var pairBtn = el('button', BTN + 'width:100%;padding:13px;border-radius:14px;' + (guestState.code ? '' : 'opacity:0.45;'), 'Pair');
      pairBtn.disabled = !guestState.code || guestState.stopped;
      pairBtn.addEventListener('click', function () {
        log('confirm sent');
        sendData({ t: 'pair-confirm' });
      });
      card.appendChild(pairBtn);
      container.appendChild(card);
    }

    /* ----- host pairing states ----- */
    if (!isGuestPage && !link.paired) {
      if (link.pending) {
        var pc = el('div', 'margin-top:16px;text-align:center;');
        pc.appendChild(el('div', 'font-size:18px;font-weight:750;', 'Pair this device?'));
        pc.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:6px 4px 0;', 'A device is asking to pair. If it shows this same code, accept:'));
        pc.appendChild(el('div', 'font-size:42px;font-weight:800;letter-spacing:8px;margin:8px 0 2px;font-variant-numeric:tabular-nums;', link.pending.code));
        var row = el('div', 'display:flex;gap:10px;justify-content:center;margin-top:12px;');
        var accept = el('button', BTN + 'min-width:110px;', 'Accept');
        accept.addEventListener('click', function () { completePairing('this device'); });
        var reject = el('button', GHOST, 'Reject');
        reject.addEventListener('click', function () {
          if (link.pending) {
            try { link.pending.conn.send({ t: 'denied' }); } catch (e) {}
            log('pairing rejected here');
            link.pending = null;
          }
          render();
        });
        row.appendChild(accept);
        row.appendChild(reject);
        pc.appendChild(row);
        container.appendChild(pc);
      } else if (!sess || !A.sessionAlive(sess)) {
        var intro = el('div', 'margin-top:14px;text-align:center;');
        intro.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:0 4px 12px;',
          'Pair with another device running this extension in Orion. Either device can then send, the other plays.'));
        var startBtn = el('button', BTN + 'min-width:170px;padding:12px 18px;', 'Show pairing QR');
        startBtn.addEventListener('click', startPairing);
        intro.appendChild(startBtn);
        /* Join from here too (the popup's join field moved in-page
         * when the popup surface died): paste the other device's
         * pairing link, or just its room code. */
        var joinInput = document.createElement('input');
        joinInput.setAttribute('style', INPUT + 'margin-top:14px;text-align:center;');
        joinInput.setAttribute('placeholder', 'Paste pairing link or room code');
        intro.appendChild(joinInput);
        var joinBtn = el('button', GHOST + 'min-width:170px;margin-top:8px;', 'Join as the other device →');
        joinBtn.addEventListener('click', function () {
          var room = roomFromText(joinInput.value);
          if (!room) { log('join: paste the full pairing link or its room code'); return; }
          location.href = A.pairUrl(room, A.consoleBase(storeCache) || undefined);
        });
        intro.appendChild(joinBtn);
        container.appendChild(intro);
      } else {
        startHosting(sess);
        var wait = el('div', 'margin-top:14px;text-align:center;');
        wait.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:0 4px 12px;',
          'Scan with the other device — it asks to pair and a code pops up here.'));
        var qrBox = el('div', 'background:#fff;border-radius:20px;padding:12px;display:inline-block;line-height:0;');
        try { drawQrInto(qrBox, A.pairUrl(sess.room, A.consoleBase(storeCache) || undefined)); }
        catch (e) { qrBox.textContent = 'QR unavailable — open the link below on the other device.'; qrBox.style.color = '#000'; qrBox.style.fontSize = '12px'; qrBox.style.lineHeight = '1.4'; }
        wait.appendChild(qrBox);
        wait.appendChild(el('div', 'font-size:10.5px;color:#7d8494;margin-top:9px;word-break:break-all;line-height:1.4;', A.pairUrl(sess.room, A.consoleBase(storeCache) || undefined)));
        wait.appendChild(el('div', 'font-size:12px;color:#ffd60a;line-height:1.5;margin-top:10px;',
          A.consoleBase(storeCache)
            ? 'This link opens the AirPlay Console — it works in ANY browser on the other device, no extension needed.'
            : 'The link must open in ORION on the other device. If its Camera opens it in Safari, that tab can\'t pair — copy the link instead: on the other device open Orion → 📺 AirPlay → paste it into “Paste pairing link or room code” → Join. Tip: host the console page and set “Console link” in this panel, and pairing links will work in any browser with no extension.'));
        var cancel = el('button', GHOST + 'margin-top:12px;', 'Cancel pairing');
        cancel.addEventListener('click', endSession);
        wait.appendChild(cancel);
        container.appendChild(wait);
      }
    }

    /* ----- connected: role + source + player ----- */
    if (link.paired) {
      var connBox = el('div', 'margin-top:14px;');
      connBox.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;',
        'Paired with ' + (link.remoteName || 'the other device') + ' · either device can send at any time'));
      var roleRow = el('div', 'display:flex;gap:8px;margin-top:12px;');
      function roleBtn(label, r) {
        var active = role === r;
        var b = el('button', (active ? BTN : GHOST) + 'flex:1;', label);
        b.addEventListener('click', function () { role = r; render(); });
        return b;
      }
      roleRow.appendChild(roleBtn('📤  I am the Source', 'source'));
      roleRow.appendChild(roleBtn('📺  I am the Player', 'player'));
      connBox.appendChild(roleRow);

      if (role === 'source') {
        var src = el('div', 'margin-top:14px;');
        src.appendChild(el('div', 'font-size:12px;color:#7d8494;letter-spacing:0.6px;font-weight:700;', 'CAST A VIDEO OR PAGE URL'));
        var urlInput = document.createElement('input');
        urlInput.setAttribute('style', INPUT + 'margin-top:8px;');
        urlInput.setAttribute('placeholder', 'https://… (mp4, m3u8, or a page)');
        urlInput.value = !isGuestPage && location.href.indexOf('http') === 0 ? location.href : '';
        src.appendChild(urlInput);
        var castBtn = el('button', BTN + 'width:100%;margin-top:8px;padding:12px;border-radius:14px;', 'Cast URL to Player');
        castBtn.addEventListener('click', function () { castUrl(urlInput.value); });
        src.appendChild(castBtn);

        src.appendChild(el('div', 'font-size:12px;color:#7d8494;letter-spacing:0.6px;font-weight:700;margin-top:16px;', 'SHARE LIVE'));
        var shareRow = el('div', 'display:flex;flex-direction:column;gap:8px;margin-top:8px;');
        function shareBtn(label, fn, enabled, why) {
          var b = el('button', (enabled ? GHOST : GHOST + 'opacity:0.45;') + 'width:100%;text-align:left;', label + (enabled ? '' : ' — ' + why));
          b.addEventListener('click', function () { if (enabled) fn(); else if (ui) ui.toast(why); });
          return b;
        }
        shareRow.appendChild(shareBtn('🖥  Share this page’s video', sharePageVideo, caps.vidCapture, 'captureStream not supported here'));
        shareRow.appendChild(shareBtn('🪟  Share screen / tab', shareScreen, caps.display, 'getDisplayMedia not available on this device'));
        shareRow.appendChild(shareBtn('🤳  Share camera', shareCamera, caps.userMedia, 'camera not available'));
        src.appendChild(shareRow);
        if (link.localStream) {
          var stopBtn = el('button', DANGER + 'width:100%;margin-top:10px;', '■ Stop sharing (' + link.sharingLabel + ')');
          stopBtn.addEventListener('click', function () { stopSharing(true); });
          src.appendChild(stopBtn);
        }
        src.appendChild(el('div', 'font-size:12px;color:#7d8494;letter-spacing:0.6px;font-weight:700;margin-top:16px;', 'REMOTE — CONTROLS THE PLAYER'));
        var ctlRow = el('div', 'display:flex;gap:8px;margin-top:8px;');
        [['−10s', 'back'], ['⏯', 'playpause'], ['+10s', 'fwd'], ['⛶', 'fullscreen']].forEach(function (pair) {
          var b = el('button', GHOST + 'flex:1;', pair[0]);
          b.addEventListener('click', function () { sendData({ t: 'ctl', a: pair[1] }); });
          ctlRow.appendChild(b);
        });
        src.appendChild(ctlRow);
        connBox.appendChild(src);
      } else {
        var play = el('div', 'margin-top:14px;text-align:center;');
        play.appendChild(el('div', 'font-size:34px;margin-bottom:4px;', '📺'));
        play.appendChild(el('div', 'font-size:15px;font-weight:650;', myName || 'This device'));
        play.appendChild(el('div', 'font-size:13px;color:#9fb0c9;line-height:1.5;margin-top:4px;',
          'Ready to receive. When the source casts or shares, it plays here automatically — fullscreen, with the native player.'));
        var openBtn = el('button', GHOST + 'margin-top:10px;', 'Open receiver screen');
        openBtn.addEventListener('click', function () { openReceiver(); });
        play.appendChild(openBtn);
        connBox.appendChild(play);
      }

      var disc = el('button', DANGER + 'width:100%;margin-top:16px;', 'Disconnect & forget pairing');
      disc.addEventListener('click', function () { sendData({ t: 'bye' }); endSession(); if (isGuestPage) { guestState.stopped = true; } });
      connBox.appendChild(disc);
      container.appendChild(connBox);
    }

    container.appendChild(el('div', 'font-size:11px;color:#7d8494;letter-spacing:0.6px;margin-top:18px;', 'THIS DEVICE CAN'));
    container.appendChild(el('div', 'font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#9fb0c9;line-height:1.6;white-space:pre-wrap;margin-top:3px;', capsLines()));
    container.appendChild(el('div', 'font-size:11px;color:#7d8494;letter-spacing:0.6px;margin-top:14px;', 'CONNECTION LOG'));
    var logBox = el('div', 'font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#9fb0c9;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin-top:3px;', link.log.join('\n') || '(…)');
    container.appendChild(logBox);
    ui.logBox = logBox;
  }

  /* ---------------- panel (host / any page) ---------------- */
  var panelState = null;
  function openPanel(auto) {
    if (isGuestPage) return;
    if (panelState) { if (!auto) { panelState.wrap.remove(); panelState = null; ui = null; } return; }
    if (typeof window.Peer !== 'function' || typeof window.qrcode !== 'function') {
      if (!auto) alert('AirPlay libraries failed to load on this page.');
      return;
    }
    var wrap = el('div', 'position:fixed;inset:0;z-index:2147483601;background:rgba(4,6,12,0.5);' +
      'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;');
    var card = el('div', GLASS + 'border-radius:28px;padding:20px 20px 18px;width:340px;max-width:94vw;max-height:92vh;overflow-y:auto;' +
      'box-shadow:0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14);');
    var bodyBox = el('div', '');
    card.appendChild(bodyBox);
    var closeRow = el('div', 'text-align:center;margin-top:14px;');
    var closeB = el('button', GHOST + 'min-width:100px;', 'Close');
    closeRow.appendChild(closeB);
    card.appendChild(closeRow);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    var myPanel = { wrap: wrap };
    panelState = myPanel;
    function closePanel() { wrap.remove(); if (panelState === myPanel) { panelState = null; ui = null; } }
    closeB.addEventListener('click', closePanel);
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) closePanel(); });
    ui = {
      logBox: null,
      setStatus: null,
      toast: function (m) { log(m); },
      render: function () { if (panelState === myPanel) buildBody(bodyBox, {}); }
    };
    buildBody(bodyBox, {});
    var tick = setInterval(function () {
      if (panelState !== myPanel) { clearInterval(tick); return; }
      if (link.pending && Date.now() - link.pending.at >= A.CODE_TTL) {
        link.pending = null;
        log('code expired');
        buildBody(bodyBox, {});
      }
    }, 1000);
  }

  /* ---------------- guest full-page console ---------------- */
  function guestBoot() {
    if (document.getElementById('apo-guest-root')) return true;
    document.title = 'AirPlay — Source';
    var root = el('div', 'position:fixed;inset:0;z-index:2147483602;overflow-y:auto;-webkit-overflow-scrolling:touch;' +

      'background:linear-gradient(180deg,#141828 0%,#0a0d18 55%,#070910 100%);color:#f2f4f8;' +
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;');
    var inner = el('div', 'padding:22px 18px 36px;max-width:520px;margin:0 auto;');
    var bodyBox = el('div', GLASS + 'border-radius:24px;padding:18px;');
    inner.appendChild(bodyBox);
    inner.appendChild(el('div', 'font-size:12px;color:#7d8494;line-height:1.5;margin-top:14px;text-align:center;',
      'Keep this tab open — it is your connection. If it drops, it redials the same pairing on its own.'));
    root.id = 'apo-guest-root';
    root.appendChild(inner);
    (document.body || document.documentElement).appendChild(root);
    ui = {
      logBox: null,
      setStatus: null,
      toast: function (m) { log(m); },
      render: function () { buildBody(bodyBox, {}); }
    };
    buildBody(bodyBox, {});
    setTimeout(guestConnect, 400);
    return true;
  }

  /* ---------------- pill (non-guest pages) ---------------- */
  function mountPill() {
    if (isGuestPage || document.getElementById('apo-pill')) return;
    var pill = el('button', 'position:fixed;right:12px;bottom:12px;z-index:2147483600;' + GLASS +
      'border-radius:999px;padding:9px 14px;font-size:13.5px;font-weight:650;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,0.4);', '📺 AirPlay');
    pill.id = 'apo-pill';
    pill.addEventListener('click', function () { openPanel(false); });
    document.body.appendChild(pill);
    document.addEventListener('fullscreenchange', function () {
      pill.style.display = document.fullscreenElement ? 'none' : '';
    });
    try {
      document.addEventListener('webkitfullscreenchange', function () {
        pill.style.display = document.webkitFullscreenElement ? 'none' : '';
      });
    } catch (e) {}
  }

  /* Create a fresh pairing session and host it from THIS page.
   * Used by the panel button and by the toolbar popup (which only
   * scaffolds — the hosting always happens here, in a visible page). */
  function startPairing() {
    var fresh = { room: A.randomRoom(), paired: false, createdAt: Date.now() };
    saveSession(fresh);
    startHosting(fresh);
    log('session created — QR is up');
    render();
  }

  /* ---------------- toolbar popup messages ----------------
   * The popup drives this tab: open the panel (optionally starting
   * pairing), open the receiver, cast a URL, or end the session. */
  function onPopupMessage(msg) {
    if (!msg || msg.__apo == null) return;
    if (msg.__apo === 'open-panel') {
      openPanel(false);
      if (msg.action === 'start-pairing') {
        var sess = getSession();
        if (sess && A.sessionAlive(sess)) {
          /* A live session (pairing or paired) is reused as-is —
           * never mint a new room over the top of one. */
          startHosting(sess);
          render();
        } else if (!link.paired) {
          startPairing();
        }
      }
    } else if (msg.__apo === 'open-receiver') {
      openReceiver();
    } else if (msg.__apo === 'cast-url') {
      if (link.paired) castUrl(msg.url);
      else { openPanel(false); log('cast from popup ignored — not paired yet'); }
    } else if (msg.__apo === 'end-session') {
      endSession();
    }
  }
  try {
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
      browser.runtime.onMessage.addListener(function (msg) { onPopupMessage(msg); });
    } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg) { onPopupMessage(msg); });
    }
  } catch (e) {}

  /* ---------------- boot ---------------- */
  loadStore(function (s) {
    storeCache = s;
    /* The console page IS an interface already — never inject the
     * pill or the guest takeover into it. */
    var cb = A.consoleBase(s);
    if (cb && location.href.indexOf(cb.split('#')[0]) === 0) return;
    myName = s.deviceName || A.defaultDeviceName(navigator.userAgent);
    if (!s.deviceName) { storeCache.deviceName = myName; A.saveStore(storeCache); }
    storeCache.visits = (storeCache.visits || 0) + 1;
    A.saveStore(storeCache);
    log('caps: display=' + caps.display + ' vidCapture=' + caps.vidCapture + ' camera=' + caps.userMedia + ' rtc=' + caps.rtc + ' storage=' + s.storageMode);
    if (s.lastIconClick) {
      var lt = new Date(s.lastIconClick);
      log('last icon click reached the extension at ' +
        ('0' + lt.getHours()).slice(-2) + ':' + ('0' + lt.getMinutes()).slice(-2) + ':' + ('0' + lt.getSeconds()).slice(-2));
    }
    if (isGuestPage) {
      guestBoot();
      /* Guest-boot watchdog: if the console didn't take over the
       * page (late body, bfcache restore, hash arriving after load),
       * re-check and boot again. Idempotent — guestBoot no-ops when
       * the root already exists. */
      var guestWatch = function () {
        if (A.parsePairHash(location.hash) && !document.getElementById('apo-guest-root')) guestBoot();
      };
      setTimeout(guestWatch, 800);
      setTimeout(guestWatch, 2500);
      window.addEventListener('hashchange', guestWatch);
      window.addEventListener('pageshow', guestWatch);
    } else {
      mountPill();
      /* Icon-click fallback: the background stamps openPanelAt when
       * the icon is tapped but the message can't reach a tab (or
       * reaches a page with no host yet). A fresh stamp at boot
       * means "the user just tapped the icon — open the menu." */
      if (s.openPanelAt && Date.now() - s.openPanelAt < 60000) {
        storeCache.openPanelAt = null;
        A.saveStore(storeCache);
        setTimeout(function () { openPanel(false); }, 350);
      }
      setTimeout(roamTick, 300);
      setInterval(roamTick, 2000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) roamTick(); });
      var sess = getSession();
      if (sess && sess.paired && A.sessionAlive(sess)) setStatus('Paired', '#ffd60a');
    }
  });

  window.APOAirplay = {
    caps: caps,
    openPanel: openPanel,
    startPairing: startPairing,
    castUrl: castUrl,
    sharePageVideo: sharePageVideo,
    shareScreen: shareScreen,
    shareCamera: shareCamera,
    link: link
  };
})();
