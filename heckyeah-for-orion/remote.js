/* HeckYeah for Orion — phone remote: QR compare-and-pair over WebRTC.
 * A WebExtension cannot run the TV app's LAN server (no listening
 * sockets), so the channel is a PeerJS data connection rendezvoused
 * through the free PeerJS cloud broker. The QR encodes ONLY a room
 * id as an fmhy.net URL fragment (fragments are never sent to the
 * server). Pairing then follows HeckYeah TV v1.37 EXACTLY: the phone
 * opens the link, connects, and REQUESTS pairing; the host generates
 * a one-time 6-digit code (60s, single active request) that appears
 * on BOTH screens — the host pops a card automatically — and either
 * side confirms (Pair on the phone, Accept on the host).
 *
 * ROAMING HOST: the session {room, paired} lives in the extension
 * store, not in one page. Whichever tab is in front hosts the peer;
 * when you navigate or switch tabs, the new page re-hosts the same
 * room, and an already-paired phone is re-accepted instantly with
 * no code (the phone reconnects on its own). A heartbeat + want-host
 * flag hands hosting to the visible tab. (0.6.0 tried a
 * background-page host; on Orion it never finished connecting.)
 * Commands: virtual cursor (trackpad), click, scroll, keyboard
 * (text + keys), media (play/pause, -10s, +10s, next episode, PiP+app).
 * Synthetic key/mouse events are untrusted (isTrusted=false): most
 * players and inputs accept them, some sites will not. Best effort. */
(function () {
  'use strict';
  if (window.__hyoRemote) return;
  window.__hyoRemote = true;
  var H = window.HYO;
  if (!H) return;
  var isTop = window.top === window;

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text != null) e.textContent = text;
    return e;
  }
  var BTN = 'background:#0a84ff;color:#fff;border:none;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:650;cursor:pointer;';
  var GHOST = 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:999px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;';
  var GLASS = 'background:rgba(16,20,34,0.78);color:#f2f4f8;border:1px solid rgba(255,255,255,0.18);' +
    'backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);' +
    'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;';

  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function randomRoom() {
    var out = '';
    try {
      var buf = new Uint8Array(14);
      crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    } catch (e) {
      for (var j = 0; j < 14; j++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
  }
  function randomCode() {
    var n = 0;
    try {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      n = buf[0] % 1000000;
    } catch (e) { n = Math.floor(Math.random() * 1000000); }
    return ('000000' + n).slice(-6);
  }
  function parseRemoteHash() {
    var m = String(location.hash || '').match(/hyo-remote=([A-Za-z0-9]+)/);
    if (!m) return null;
    return { room: m[1] };
  }
  function remoteUrl(room) {
    return 'https://fmhy.net/#hyo-remote=' + room;
  }

  /* ================= stage: command executors =================
   * `stage` is this page's remote-control state: the virtual cursor
   * and, when this page is the current host, the live connection. */
  var stage = { cx: 0, cy: 0, cursorEl: null, peer: null, conn: null, paired: false, lastNow: null };
  var mediaHandler = null;

  function ensureCursor() {
    if (stage.cursorEl) return stage.cursorEl;
    var c = el('div', 'position:fixed;z-index:2147483647;width:22px;height:22px;pointer-events:none;' +
      'left:0;top:0;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.5));transition:transform 45ms linear;');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3 L19 12 L12.5 13.5 L9.5 20 Z" fill="#fff" stroke="#111" stroke-width="1.6"/></svg>';
    stage.cx = Math.round(innerWidth / 2);
    stage.cy = Math.round(innerHeight / 2);
    c.style.transform = 'translate(' + stage.cx + 'px,' + stage.cy + 'px)';
    document.body.appendChild(c);
    stage.cursorEl = c;
    return c;
  }
  var lastHoverAt = 0;
  function moveCursor(dx, dy) {
    ensureCursor();
    stage.cx = Math.max(0, Math.min(innerWidth - 4, stage.cx + dx));
    stage.cy = Math.max(0, Math.min(innerHeight - 4, stage.cy + dy));
    stage.cursorEl.style.transform = 'translate(' + stage.cx + 'px,' + stage.cy + 'px)';
    /* Wake hover states: many players only reveal their controls
     * after a real mousemove over the container. Throttled to ~12/s. */
    var now = Date.now();
    if (now - lastHoverAt > 80 && typeof document.elementFromPoint === 'function') {
      lastHoverAt = now;
      var hov = document.elementFromPoint(stage.cx, stage.cy);
      if (hov) {
        try { hov.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: stage.cx, clientY: stage.cy })); } catch (e) {}
        try { hov.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: stage.cx, clientY: stage.cy, pointerId: 1, pointerType: 'mouse', isPrimary: true })); } catch (e) {}
      }
    }
  }
  function clickableTarget(t) {
    var n = t;
    for (var i = 0; n && i < 6; i++) {
      var tag = n.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return n;
      try {
        if (n.getAttribute && (n.getAttribute('role') === 'button' || n.hasAttribute('onclick') || n.hasAttribute('tabindex'))) return n;
        var cs = window.getComputedStyle ? getComputedStyle(n) : null;
        if (cs && cs.cursor === 'pointer') return n;
      } catch (e) {}
      n = n.parentElement;
    }
    return t;
  }
  function clickAtPoint(x, y) {
    var raw = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    if (!raw) return;
    var t = clickableTarget(raw);
    var seq = [
      ['pointerover', {}], ['mouseover', {}], ['mousemove', {}],
      ['pointerdown', { buttons: 1 }], ['mousedown', { buttons: 1 }],
      ['pointerup', { buttons: 0 }], ['mouseup', { buttons: 0 }], ['click', {}]
    ];
    seq.forEach(function (pair) {
      var type = pair[0];
      var extra = pair[1];
      var opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: extra.buttons || 0, view: window };
      try {
        if (type.indexOf('pointer') === 0 && typeof PointerEvent === 'function') {
          t.dispatchEvent(new PointerEvent(type, Object.assign({}, opts, { pointerId: 1, pointerType: 'mouse', isPrimary: true })));
        } else {
          t.dispatchEvent(new MouseEvent(type, opts));
        }
      } catch (e) {}
    });
    try { if (t.focus) t.focus(); } catch (e) {}
    try { t.click(); } catch (e) {}
    var ring = el('div', 'position:fixed;z-index:2147483646;width:34px;height:34px;border-radius:50%;' +
      'border:2px solid #0a84ff;pointer-events:none;left:' + (x - 17) + 'px;top:' + (y - 17) + 'px;opacity:0.9;');
    if (document.body) document.body.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 350);
  }
  function clickAtCursor() {
    ensureCursor();
    clickAtPoint(stage.cx, stage.cy);
  }
  function scrollByRemote(dy, px, py) {
    var t = typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(px != null ? px : (stage.cx || innerWidth / 2), py != null ? py : (stage.cy || innerHeight / 2))
      : null;
    var done = false;
    var n = t;
    while (n && n !== document.body) {
      if (n.scrollHeight > n.clientHeight + 4) {
        var before = n.scrollTop;
        n.scrollTop = before + dy;
        if (n.scrollTop !== before) { done = true; break; }
      }
      n = n.parentElement;
    }
    if (!done) window.scrollBy(0, dy);
  }
  function focusedEditable() {
    var a = document.activeElement;
    if (!a) return null;
    if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') return a;
    if (a.isContentEditable) return a;
    return null;
  }
  function insertText(str) {
    var a = focusedEditable();
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
      try {
        var proto = a.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        var start = a.selectionStart != null ? a.selectionStart : a.value.length;
        var end = a.selectionEnd != null ? a.selectionEnd : a.value.length;
        setter.call(a, a.value.slice(0, start) + str + a.value.slice(end));
        a.selectionStart = a.selectionEnd = start + str.length;
        a.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } catch (e) {}
    }
    if (a && a.isContentEditable) {
      try { document.execCommand('insertText', false, str); return; } catch (e) {}
    }
    for (var i = 0; i < str.length; i++) dispatchKey(str[i]);
  }
  var KEYCODES = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
  function dispatchKey(key) {
    var a = document.activeElement || document.body;
    var opts = { key: key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, bubbles: true, cancelable: true };
    if (KEYCODES[key]) { opts.keyCode = KEYCODES[key]; opts.which = KEYCODES[key]; }
    try { a.dispatchEvent(new KeyboardEvent('keydown', opts)); } catch (e) {}
    if (key === 'Backspace') {
      var ed = focusedEditable();
      if (ed && (ed.tagName === 'INPUT' || ed.tagName === 'TEXTAREA') && ed.selectionStart === ed.selectionEnd && ed.selectionStart > 0) {
        try {
          var proto = ed.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(ed, ed.value.slice(0, ed.selectionStart - 1) + ed.value.slice(ed.selectionStart));
          ed.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {}
      }
    }
    try { a.dispatchEvent(new KeyboardEvent('keyup', opts)); } catch (e) {}
  }
  function genericMedia(action) {
    var vids = document.querySelectorAll('video');
    var best = null, bestArea = -1;
    for (var i = 0; i < vids.length; i++) {
      var r = vids[i].getBoundingClientRect();
      var area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) { bestArea = area; best = vids[i]; }
    }
    if (!best) return;
    if (action === 'playpause') { if (best.paused) { var p = best.play(); if (p && p.catch) p.catch(function () {}); } else best.pause(); }
    else if (action === 'back') best.currentTime = Math.max(0, best.currentTime - 10);
    else if (action === 'fwd') best.currentTime = Math.min(best.duration || 1e9, best.currentTime + 10);
  }
  /* ---- cross-frame relay: most streaming players live in iframes,
   * and a click dispatched on an <iframe> element never reaches
   * inside it. When the cursor is over a frame, the command is
   * relayed INTO that frame (coordinates translated) and executed
   * there by this same code. Media commands broadcast to every
   * frame, so the frame that actually holds the video answers. ---- */
  function frameAtCursor() {
    if (typeof document.elementFromPoint !== 'function') return null;
    var t = document.elementFromPoint(stage.cx, stage.cy);
    if (!t || (t.tagName !== 'IFRAME' && t.tagName !== 'FRAME')) return null;
    try {
      var r = t.getBoundingClientRect();
      return { win: t.contentWindow, x: Math.round(stage.cx - r.left), y: Math.round(stage.cy - r.top) };
    } catch (e) { return null; }
  }
  function relay(cmd, targetWin, depth) {
    var msg = { __hyo: 'hyo-relay', cmd: cmd, depth: depth || 0 };
    try {
      if (targetWin) { targetWin.postMessage(msg, '*'); return; }
      var frames = document.querySelectorAll('iframe,frame');
      for (var i = 0; i < frames.length; i++) {
        try { frames[i].contentWindow.postMessage(msg, '*'); } catch (e) {}
      }
    } catch (e) {}
  }
  function runMedia(action) {
    if (mediaHandler) mediaHandler(action);
    else genericMedia(action);
  }
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.__hyo !== 'hyo-relay' || !d.cmd) return;
    var c = d.cmd;
    try {
      if (c.t === 'click') clickAtPoint(c.x || 0, c.y || 0);
      else if (c.t === 'scroll') scrollByRemote(c.dy || 0, c.x, c.y);
      else if (c.t === 'moveat') { stage.cx = c.x || 0; stage.cy = c.y || 0; moveCursor(0, 0); }
      else if (c.t === 'media') {
        runMedia(String(c.a || ''));
        if ((d.depth || 0) < 3) relay(c, null, (d.depth || 0) + 1);
      } else if (c.t === 'text') {
        if (focusedEditable() || document.hasFocus()) insertText(String(c.s || ''));
      } else if (c.t === 'key') {
        if (focusedEditable() || document.hasFocus()) dispatchKey(String(c.k || ''));
      }
    } catch (err) {}
  });

  function handleCommand(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'move': {
        moveCursor(msg.dx || 0, msg.dy || 0);
        var fm = frameAtCursor();
        if (fm) relay({ t: 'moveat', x: fm.x, y: fm.y }, fm.win);
        break;
      }
      case 'click': {
        var f = frameAtCursor();
        if (f) relay({ t: 'click', x: f.x, y: f.y }, f.win);
        else clickAtCursor();
        break;
      }
      case 'scroll': {
        var fs2 = frameAtCursor();
        if (fs2) relay({ t: 'scroll', dy: msg.dy || 0, x: fs2.x, y: fs2.y }, fs2.win);
        else scrollByRemote(msg.dy || 0);
        break;
      }
      case 'text':
        insertText(String(msg.s || ''));
        relay({ t: 'text', s: String(msg.s || '') });
        break;
      case 'key':
        dispatchKey(String(msg.k || ''));
        relay({ t: 'key', k: String(msg.k || '') });
        break;
      case 'media':
        runMedia(String(msg.a || ''));
        relay({ t: 'media', a: String(msg.a || '') });
        break;
    }
  }
  function reportNow(now) {
    stage.lastNow = now;
    if (stage.conn && stage.paired) {
      try { stage.conn.send({ t: 'now', now: now }); } catch (e) {}
    }
  }


  /* ================= session + roaming host ================= */
  var SESSION_TTL = 6 * 60 * 60 * 1000;  // paired session: 6h
  var ROOM_TTL = 10 * 60 * 1000;         // unpaired room: 10 min
  var CODE_TTL = 60 * 1000;              // one pairing code: 60s
  var hosting = false;
  var panelState = null;

  stage.pending = null; // { code, conn, at } — one active request, like the TV
  stage.lastTraffic = 0; // last ping/command from the paired phone
  stage.log = [];
  function log(line) {
    var d = new Date();
    var ts = ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    stage.log.unshift(ts + '  ' + line);
    stage.log = stage.log.slice(0, 7);
    if (panelState && panelState.logBox) {
      panelState.logBox.textContent = stage.log.join('\n');
    }
  }

  function loadSession(cb) {
    H.loadStore().then(function (s) { cb(s, s.hyoSession || null); });
  }
  function saveSession(store, sess) {
    store.hyoSession = sess;
    return H.saveStore(store);
  }
  function sessionAlive(sess) {
    if (!sess || !sess.room) return false;
    var age = Date.now() - (sess.createdAt || 0);
    return sess.paired ? age < SESSION_TTL : age < ROOM_TTL;
  }

  function stopHosting() {
    hosting = false;
    stage.paired = false;
    stage.conn = null;
    stage.pending = null;
    try { stage.peer && stage.peer.destroy(); } catch (e) {}
    stage.peer = null;
  }
  function endSession() {
    log('session ended');
    stopHosting();
    H.loadStore().then(function (s) { saveSession(s, null); });
    if (panelState) { panelState.wrap.remove(); panelState = null; }
  }

  function completePairing(how) {
    if (!stage.pending) return;
    var conn = stage.pending.conn;
    stage.paired = true;
    stage.conn = conn;
    stage.pending = null;
    try { conn.send({ t: 'paired' }); } catch (e) {}
    if (stage.lastNow) { try { conn.send({ t: 'now', now: stage.lastNow }); } catch (e) {} }
    log('paired \u2713 (confirmed on ' + how + ')');
    loadSession(function (store, cur) {
      if (cur) { cur.paired = true; saveSession(store, cur); }
    });
    if (panelState) panelState.render();
  }

  function startHosting(sess) {
    if (!isTop || hosting) return;
    if (typeof window.Peer !== 'function') { log('PeerJS library missing on this page'); return; }
    hosting = true;
    var peer;
    try { peer = new window.Peer('hyo-' + sess.room); }
    catch (e) { hosting = false; log('peer create failed: ' + e.message); return; }
    stage.peer = peer;
    log('host: created peer for room ' + sess.room.slice(0, 4) + '\u2026');
    peer.on('open', function (id) { log('host: broker connected'); });
    peer.on('disconnected', function () {
      log('host: broker dropped \u2014 reconnecting');
      try { peer.reconnect(); } catch (e) {}
    });
    peer.on('connection', function (conn) {
      log('guest: channel opening');
      conn.on('iceStateChanged', function (s) { log('guest: ice ' + s); });
      conn.on('data', function (msg) {
        if (!msg) return;
        if (msg.t === 'bye') { log('guest: bye'); endSession(); return; }
        if (msg.t === 'ping') {
          stage.lastTraffic = Date.now();
          try { conn.send({ t: 'pong' }); } catch (e) {}
          return;
        }
        if (stage.paired && conn === stage.conn) { stage.lastTraffic = Date.now(); handleCommand(msg); return; }
        if (msg.t === 'pair-request') {
          log('guest: pair-request');
          loadSession(function (store, cur) {
            if (cur && cur.paired) {
              stage.paired = true;
              stage.conn = conn;
              try { conn.send({ t: 'paired' }); } catch (e) {}
              if (stage.lastNow) { try { conn.send({ t: 'now', now: stage.lastNow }); } catch (e) {} }
              log('paired \u2713 (returning phone, no code needed)');
              if (panelState) panelState.render();
              return;
            }
            stage.pending = { code: randomCode(), conn: conn, at: Date.now() };
            try { conn.send({ t: 'code', code: stage.pending.code }); } catch (e) {}
            log('code issued: ' + stage.pending.code);
            openPanel(true); // the TV pops the card — so do we
            if (panelState) panelState.render();
          });
          return;
        }
        if (msg.t === 'pair-confirm') {
          if (stage.pending && conn === stage.pending.conn && Date.now() - stage.pending.at < CODE_TTL) {
            completePairing('phone');
          } else {
            log('confirm ignored (no live code)');
          }
          return;
        }
        if (stage.pending && conn === stage.pending.conn) log('guest: unexpected "' + msg.t + '"');
      });
      conn.on('close', function () {
        log('guest: channel closed');
        if (stage.conn === conn) { stage.conn = null; stage.paired = false; }
        if (stage.pending && stage.pending.conn === conn) stage.pending = null;
        if (panelState) panelState.render();
      });
    });
    peer.on('error', function (err) {
      var type = err && err.type ? err.type : 'unknown';
      log('host: peer error ' + type);
      if (type === 'unavailable-id') {
        hosting = false;
        stage.peer = null;
        log('host: another tab already hosts \u2014 standing aside');
      }
    });
  }

  /* Takeover watch: the visible tab should host. The host heartbeats
   * into the store; a visible non-host asks for the stage (wantHost)
   * and a hidden host yields. */
  function roamTick() {
    if (!isTop || parseRemoteHash()) return;
    loadSession(function (store, sess) {
      if (!sessionAlive(sess)) {
        if (sess && !panelState && !stage.pending) saveSession(store, null);
        if (hosting && !panelState) stopHosting();
        return;
      }
      if (!sess.paired) return;
      if (hosting) {
        /* A host with a LIVE phone (traffic within 12s) never
         * yields — a tab switch mid-session must not murder the
         * connection; the claimant takes over only once this host
         * has actually gone quiet or away. */
        var serving = stage.conn && Date.now() - (stage.lastTraffic || 0) < 12000;
        if (document.hidden && sess.wantHost && Date.now() - sess.wantHost < 8000 && !serving) {
          log('roam: yielding stage to visible tab');
          stopHosting();
          return;
        }
        sess.hostBeat = Date.now();
        saveSession(store, sess);
        return;
      }
      if (!document.hidden) {
        sess.wantHost = Date.now();
        saveSession(store, sess);
      }
      var beatStale = !sess.hostBeat || Date.now() - sess.hostBeat > 5000;
      /* Fast probe: a visible page with a paired session tries to
       * host right away. If a live tab already holds the room,
       * PeerJS answers unavailable-id and we stand aside; if the
       * "host" is a zombie (the page that died on navigation), the
       * room frees within seconds and the next tick claims it. */
      var probeDue = !stage.lastHostTry || Date.now() - stage.lastHostTry > 6000;
      if (beatStale || (probeDue && !document.hidden)) {
        stage.lastHostTry = Date.now();
        if (beatStale) log('roam: claiming stage');
        startHosting(sess);
      }
    });
  }
  if (isTop && !parseRemoteHash()) {
    setTimeout(roamTick, 300);
    setInterval(roamTick, 2000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) roamTick(); // claim the stage the moment we're in front
    });
  }

  /* ================= pairing panel (host UI) ================= */
  function drawQrInto(box, url) {
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var modCount = qr.getModuleCount();
    var cell = 5, quiet = 2;
    var px = (modCount + quiet * 2) * cell;
    var canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = '180px';
    canvas.style.height = '180px';
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    for (var rr = 0; rr < modCount; rr++) {
      for (var cc = 0; cc < modCount; cc++) {
        if (qr.isDark(rr, cc)) ctx.fillRect((cc + quiet) * cell, (rr + quiet) * cell, cell, cell);
      }
    }
    box.appendChild(canvas);
  }
  var CARD = GLASS + 'border-radius:28px;padding:14px 22px 22px;width:324px;max-width:92vw;text-align:center;' +
    'box-shadow:0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14);';

  function openPanel(auto) {
    if (!isTop) return;
    if (panelState) { if (!auto) { panelState.wrap.remove(); panelState = null; } return; }
    if (typeof window.Peer !== 'function' || typeof window.qrcode !== 'function') {
      if (!auto) alert('HeckYeah remote libraries failed to load on this page.');
      return;
    }
    var wrap = el('div', 'position:fixed;inset:0;z-index:2147483601;background:rgba(4,6,12,0.5);' +
      'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;');
    var card = el('div', CARD);
    card.appendChild(el('div', 'width:38px;height:5px;border-radius:3px;background:rgba(255,255,255,0.28);margin:0 auto 14px;'));
    var bodyBox = el('div', '');
    card.appendChild(bodyBox);
    card.appendChild(el('div', 'font-size:11px;color:#7d8494;letter-spacing:0.6px;margin-top:16px;text-align:left;', 'CONNECTION LOG'));
    var logBox = el('div', 'font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#9fb0c9;line-height:1.55;' +
      'text-align:left;white-space:pre-wrap;word-break:break-word;max-height:110px;overflow-y:auto;margin-top:4px;', stage.log.join('\n') || '(\u2026)');
    card.appendChild(logBox);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    var myPanel = { wrap: wrap, logBox: logBox, render: render };
    panelState = myPanel;
    var tickTimer = setInterval(function () {
      if (panelState !== myPanel) { clearInterval(tickTimer); return; }
      if (stage.pending && Date.now() - stage.pending.at >= CODE_TTL) {
        stage.pending = null;
        log('code expired');
        render();
        return;
      }
      renderCountdown();
    }, 1000);
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) closePanel(); });
    function closePanel() {
      wrap.remove();
      if (panelState === myPanel) panelState = null;
    }
    myPanel.close = closePanel;
    var countElRef = null;
    function renderCountdown() {
      if (!countElRef) return;
      if (stage.pending) {
        var left = Math.max(0, Math.round((stage.pending.at + CODE_TTL - Date.now()) / 1000));
        countElRef.textContent = 'Code expires in ' + left + 's';
      } else {
        countElRef.textContent = '';
      }
    }

    function render() {
      if (panelState !== myPanel) return;
      loadSession(function (store, sess) {
        if (panelState !== myPanel) return;
        bodyBox.innerHTML = '';
        countElRef = null;
        if (!sessionAlive(sess)) {
          bodyBox.appendChild(el('div', 'font-size:20px;font-weight:750;', 'Pair your phone'));
          bodyBox.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:6px 4px 0;', 'Start a pairing session:'));
          var startBtn = el('button', BTN + 'margin-top:16px;min-width:160px;padding:12px 18px;', 'Show pairing QR');
          startBtn.addEventListener('click', function () {
            var fresh = { room: randomRoom(), paired: false, createdAt: Date.now() };
            saveSession(store, fresh).then(function () { log('session created'); startHosting(fresh); render(); });
          });
          bodyBox.appendChild(startBtn);
          var closeB = el('button', GHOST + 'margin-top:10px;min-width:110px;', 'Close');
          closeB.addEventListener('click', closePanel);
          bodyBox.appendChild(closeB);
          return;
        }
        startHosting(sess);
        if (sess.paired || stage.paired) {
          var dotRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:8px;');
          dotRow.appendChild(el('span', 'width:9px;height:9px;border-radius:50%;background:#30d158;display:inline-block;'));
          dotRow.appendChild(el('span', 'font-size:20px;font-weight:750;', 'Phone connected'));
          bodyBox.appendChild(dotRow);
          bodyBox.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:8px 4px 0;',
            'Pairing roams with you \u2014 switch tabs or open another page and the phone reconnects on its own.'));
          if (stage.lastNow && stage.lastNow.title) {
            bodyBox.appendChild(el('div', 'font-size:12px;color:#7d8494;margin-top:12px;letter-spacing:0.4px;', 'NOW PLAYING'));
            bodyBox.appendChild(el('div', 'font-size:14.5px;font-weight:600;margin-top:2px;', stage.lastNow.title));
          }
          var disc = el('button', 'background:rgba(255,69,58,0.16);color:#ff6961;border:none;border-radius:999px;padding:10px 16px;font-size:14px;font-weight:650;cursor:pointer;margin-top:16px;min-width:130px;', 'Disconnect');
          disc.addEventListener('click', function () { endSession(); });
          bodyBox.appendChild(disc);
          var done = el('button', GHOST + 'margin-top:10px;min-width:110px;', 'Done');
          done.addEventListener('click', closePanel);
          bodyBox.appendChild(done);
          return;
        }
        if (stage.pending) {
          bodyBox.appendChild(el('div', 'font-size:20px;font-weight:750;', 'Pair this phone?'));
          bodyBox.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:6px 4px 0;', 'A phone is asking to pair. If it shows this same code, accept:'));
          bodyBox.appendChild(el('div', 'font-size:42px;font-weight:800;letter-spacing:8px;margin:8px 0 2px;font-variant-numeric:tabular-nums;', stage.pending.code));
          countElRef = el('div', 'font-size:12px;color:#7d8494;font-variant-numeric:tabular-nums;', '');
          bodyBox.appendChild(countElRef);
          renderCountdown();
          var row = el('div', 'display:flex;gap:10px;justify-content:center;margin-top:14px;');
          var accept = el('button', BTN + 'min-width:120px;padding:12px 18px;', 'Accept');
          accept.addEventListener('click', function () { completePairing('host'); });
          var reject = el('button', GHOST + 'min-width:100px;', 'Reject');
          reject.addEventListener('click', function () {
            if (stage.pending) {
              try { stage.pending.conn.send({ t: 'denied' }); } catch (e) {}
              log('pairing rejected on host');
              stage.pending = null;
            }
            render();
          });
          row.appendChild(accept);
          row.appendChild(reject);
          bodyBox.appendChild(row);
          return;
        }
        bodyBox.appendChild(el('div', 'font-size:20px;font-weight:750;', 'Pair your phone'));
        bodyBox.appendChild(el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:6px 4px 14px;',
          'Scan with your phone camera \u2014 the remote opens and asks to pair, and a code pops up here.'));
        var qrBox = el('div', 'background:#fff;border-radius:20px;padding:12px;display:inline-block;line-height:0;box-shadow:0 10px 30px rgba(0,0,0,0.35);');
        try { drawQrInto(qrBox, remoteUrl(sess.room)); }
        catch (e) { qrBox.textContent = 'QR unavailable \u2014 type the link below.'; qrBox.style.color = '#000'; qrBox.style.fontSize = '12px'; qrBox.style.lineHeight = '1.4'; }
        bodyBox.appendChild(qrBox);
        bodyBox.appendChild(el('div', 'font-size:10.5px;color:#7d8494;margin-top:9px;word-break:break-all;line-height:1.4;', remoteUrl(sess.room)));
        var statusRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;');
        statusRow.appendChild(el('span', 'width:8px;height:8px;border-radius:50%;background:#0a84ff;display:inline-block;'));
        statusRow.appendChild(el('span', 'font-size:13.5px;color:#d7deeb;', 'Waiting for your phone\u2026'));
        bodyBox.appendChild(statusRow);
        var cancel = el('button', GHOST + 'margin-top:14px;min-width:120px;', 'Cancel pairing');
        cancel.addEventListener('click', function () { endSession(); });
        bodyBox.appendChild(cancel);
      });
    }
    render();
  }
  function startHostPanel() { openPanel(false); }

  /* ================= guest side (the phone) =================
   * Fire TV flow: the remote connects and REQUESTS pairing on its
   * own as soon as the page opens. The host answers with a code;
   * the code shows here and on the host; Pair confirms. */
  function guestBoot() {
    var info = parseRemoteHash();
    if (!info) return false;
    document.title = 'HeckYeah Remote';
    var glog = [];
    var S = {
      bg: 'position:fixed;inset:0;z-index:2147483602;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
        'background:linear-gradient(180deg,#141828 0%,#0a0d18 55%,#070910 100%);color:#f2f4f8;' +
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;',
      card: 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:24px;' +
        'backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);'
    };
    var rootEl = el('div', S.bg);
    var inner = el('div', 'padding:22px 18px 36px;max-width:520px;margin:0 auto;');
    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:10px;');
    var brand = el('div', 'font-size:19px;font-weight:800;letter-spacing:-0.3px;');
    brand.innerHTML = 'Heck<span style="color:#0a84ff">Yeah</span> Remote';
    head.appendChild(brand);
    var statusPill = el('div', 'display:flex;align-items:center;gap:7px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:999px;padding:6px 12px;flex:0 0 auto;');
    var dot = el('span', 'width:8px;height:8px;border-radius:50%;background:#ffd60a;display:inline-block;');
    var statusTxt = el('span', 'font-size:12.5px;font-weight:600;color:#d7deeb;', 'Starting\u2026');
    statusPill.appendChild(dot);
    statusPill.appendChild(statusTxt);
    head.appendChild(statusPill);
    inner.appendChild(head);

    var pairCard = el('div', S.card + 'padding:20px;margin-top:18px;text-align:center;');
    pairCard.appendChild(el('div', 'font-size:13px;color:#9fb0c9;letter-spacing:0.3px;', 'PAIRING CODE'));
    var codeEl = el('div', 'font-size:44px;font-weight:800;letter-spacing:9px;margin:6px 0 4px;font-variant-numeric:tabular-nums;', '\u2013 \u2013 \u2013 \u2013 \u2013 \u2013');
    pairCard.appendChild(codeEl);
    var pairMsg = el('div', 'font-size:13.5px;color:#9fb0c9;line-height:1.5;margin:0 8px 14px;', 'Asking the other screen for a code\u2026');
    pairCard.appendChild(pairMsg);
    var pairBtn = el('button', BTN + 'width:100%;padding:14px 16px;font-size:16.5px;border-radius:16px;opacity:0.45;', 'Pair');
    pairBtn.disabled = true;
    pairCard.appendChild(pairBtn);
    inner.appendChild(pairCard);

    var controls = el('div', 'display:none;');
    var nowCard = el('div', S.card + 'padding:14px 16px;margin-top:16px;');
    nowCard.appendChild(el('div', 'font-size:11px;color:#7d8494;letter-spacing:1.2px;font-weight:700;', 'NOW PLAYING'));
    var nowTitle = el('div', 'font-size:16px;font-weight:650;margin-top:4px;line-height:1.35;', 'Nothing reported yet');
    var nowState = el('div', 'font-size:12.5px;color:#9fb0c9;margin-top:2px;', 'Open a video on the other screen');
    nowCard.appendChild(nowTitle);
    nowCard.appendChild(nowState);
    controls.appendChild(nowCard);

    var pad = el('div', S.card + 'height:38vh;min-height:210px;margin-top:14px;touch-action:none;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;' +
      'color:#7d8494;-webkit-user-select:none;user-select:none;');
    pad.appendChild(el('div', 'font-size:22px;', '\u2726'));
    pad.appendChild(el('div', 'font-size:13px;font-weight:600;', 'Trackpad'));
    pad.appendChild(el('div', 'font-size:12px;color:#5f6779;padding:0 30px;text-align:center;line-height:1.45;', 'Drag to move the cursor \u00b7 tap to click \u00b7 two fingers to scroll'));
    controls.appendChild(pad);

    var transport = el('div', 'display:flex;align-items:center;justify-content:center;gap:14px;margin-top:16px;');
    function roundBtn(label, size, action, primary) {
      var b = el('button', (primary ? 'background:#0a84ff;' : 'background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.14);') +
        'color:#fff;border-radius:50%;width:' + size + 'px;height:' + size + 'px;font-size:' + (primary ? 22 : 15) + 'px;font-weight:700;cursor:pointer;', label);
      b.addEventListener('click', function () { send({ t: 'media', a: action }); });
      return b;
    }
    transport.appendChild(roundBtn('\u221210', 56, 'back', false));
    transport.appendChild(roundBtn('\u23ef', 72, 'playpause', true));
    transport.appendChild(roundBtn('+10', 56, 'fwd', false));
    controls.appendChild(transport);
    var wide = el('div', 'display:flex;gap:10px;margin-top:14px;');
    var nextBtn = el('button', BTN + 'flex:1;padding:12px;border-radius:14px;', 'Next Episode \u203a');
    nextBtn.addEventListener('click', function () { send({ t: 'media', a: 'next' }); });
    var appBtn = el('button', GHOST + 'flex:1;padding:12px;border-radius:14px;', '\ud83d\udcfa App + PiP');
    appBtn.addEventListener('click', function () { send({ t: 'media', a: 'app' }); });
    wide.appendChild(nextBtn);
    wide.appendChild(appBtn);
    controls.appendChild(wide);

    var kbRow = el('div', 'display:flex;gap:10px;margin-top:10px;');
    var kbBtn = el('button', GHOST + 'flex:1;padding:12px;border-radius:14px;', '\u2328\ufe0f Keyboard');
    var enterBtn = el('button', GHOST + 'padding:12px 16px;border-radius:14px;', '\u23ce');
    var bsBtn = el('button', GHOST + 'padding:12px 16px;border-radius:14px;', '\u232b');
    kbRow.appendChild(kbBtn);
    kbRow.appendChild(enterBtn);
    kbRow.appendChild(bsBtn);
    controls.appendChild(kbRow);
    var input = document.createElement('input');
    input.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:10px;height:10px;opacity:0.01;');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    controls.appendChild(input);
    var discBtn = el('button', 'background:none;border:none;color:#ff6961;font-size:14px;font-weight:600;cursor:pointer;width:100%;margin-top:20px;padding:8px;', 'Disconnect');
    controls.appendChild(discBtn);
    inner.appendChild(controls);

    inner.appendChild(el('div', 'font-size:11px;color:#7d8494;letter-spacing:0.6px;margin-top:22px;', 'CONNECTION LOG'));
    var logBox = el('div', 'font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:#9fb0c9;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin-top:4px;', '(\u2026)');
    inner.appendChild(logBox);
    rootEl.appendChild(inner);
    (document.body || document.documentElement).appendChild(rootEl);

    function gLog(line) {
      var d = new Date();
      var ts = ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
      glog.unshift(ts + '  ' + line);
      glog = glog.slice(0, 7);
      logBox.textContent = glog.join('\n');
    }
    var conn = null;
    var peer = null;
    var paired = false;
    var userStopped = false;
    var reconnectTimer = null;
    var gen = 0; // connection generation: handlers from a superseded
                 // socket are inert (the Fire TV v1.38 lesson)
    function setStatus(text, color) {
      statusTxt.textContent = text;
      dot.style.background = color;
    }
    function send(msg) { if (conn && paired) { try { conn.send(msg); } catch (e) {} } }
    function sendRaw(msg) { if (conn) { try { conn.send(msg); } catch (e) {} } }
    function showControls(on) {
      controls.style.display = on ? '' : 'none';
      pairCard.style.display = on ? 'none' : '';
    }
    function scheduleReconnect(why) {
      if (userStopped || reconnectTimer) return;
      setStatus('Reconnecting\u2026', '#ffd60a');
      gLog('retry in 2s (' + why + ')');
      reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, 2000);
    }
    var lastPong = 0;
    var pingTimer = null;
    var watchTimer = null;
    function stopHeartbeat() {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    }
    function startHeartbeat() {
      stopHeartbeat();
      lastPong = Date.now();
      var myGen = gen;
      pingTimer = setInterval(function () { send({ t: 'ping' }); }, 4000);
      watchTimer = setInterval(function () {
        if (paired && Date.now() - lastPong > 12000) {
          handleDrop(myGen, 'heartbeat lost (no pong for 12s)');
        }
      }, 4000);
      gLog('heartbeat running (4s ping, 12s tolerance)');
    }
    function handleDrop(myGen, why) {
      if (myGen !== gen || userStopped) return;
      gen++; // invalidate every other handler from this socket
      stopHeartbeat();
      gLog('dropped (' + why + ') \u2014 reconnecting to the same session');
      var wasPaired = paired;
      paired = false;
      conn = null;
      try { peer && peer.destroy(); } catch (e) {}
      peer = null;
      if (wasPaired) showControls(false);
      codeEl.textContent = '\u2013 \u2013 \u2013 \u2013 \u2013 \u2013';
      pairBtn.disabled = true;
      pairBtn.style.opacity = '0.45';
      pairMsg.textContent = 'Connection dropped \u2014 reconnecting to the same session\u2026';
      scheduleReconnect(why);
    }
    function connect() {
      if (userStopped) return;
      if (typeof window.Peer !== 'function') { setStatus('Pairing unavailable', '#ff453a'); gLog('PeerJS library missing'); return; }
      var myGen = ++gen;
      try { peer && peer.destroy(); } catch (e) {}
      peer = null;
      conn = null;
      setStatus('Connecting\u2026', '#ffd60a');
      gLog('dialing broker\u2026');
      try { peer = new window.Peer(); } catch (e) { gLog('peer create failed'); scheduleReconnect('create'); return; }
      peer.on('error', function (err) {
        if (myGen !== gen) return;
        var type = err && err.type ? err.type : 'unknown';
        gLog('peer error: ' + type);
        if (type === 'peer-unavailable') {
          pairMsg.textContent = 'The other screen is not hosting right now \u2014 keeping trying. Open the pairing card there.';
          scheduleReconnect('host not up');
        } else if (!paired) {
          setStatus('Connection problem', '#ff453a');
          scheduleReconnect(type);
        }
      });
      peer.on('disconnected', function () {
        gLog('broker dropped \u2014 reconnecting');
        try { peer.reconnect(); } catch (e) {}
      });
      peer.on('open', function (id) {
        if (myGen !== gen) return;
        gLog('broker connected');
        conn = peer.connect('hyo-' + info.room, { reliable: true });
        conn.on('iceStateChanged', function (s) {
          /* Log only. A single ICE event NEVER tears the session
           * down (transient 'disconnected'/'failed' blips recover
           * on their own) — the heartbeat watchdog below is the
           * only drop authority, exactly like the TV build, where
           * no socket event alone may end a pairing. */
          gLog('ice: ' + s);
        });
        conn.on('open', function () {
          gLog('channel open \u2014 requesting pairing');
          setStatus('Asking to pair\u2026', '#ffd60a');
          sendRaw({ t: 'pair-request' });
        });
        conn.on('data', function (msg) {
          if (!msg) return;
          if (msg.t === 'code') {
            gLog('code received: ' + msg.code);
            codeEl.textContent = String(msg.code).split('').join(' ');
            pairMsg.textContent = 'If the other screen shows this same code, tap Pair.';
            pairBtn.disabled = false;
            pairBtn.style.opacity = '1';
            setStatus('Code received', '#ffd60a');
          } else if (msg.t === 'paired') {
            paired = true;
            gLog('paired \u2713');
            setStatus('Connected', '#30d158');
            showControls(true);
            startHeartbeat();
          } else if (msg.t === 'pong') {
            lastPong = Date.now();
          } else if (msg.t === 'denied') {
            userStopped = true;
            gLog('rejected by host');
            setStatus('Rejected', '#ff453a');
            pairMsg.textContent = 'The other screen rejected this pairing. Reopen the pairing card there and scan again.';
            pairBtn.disabled = true;
            pairBtn.style.opacity = '0.45';
          } else if (msg.t === 'now') {
            if (msg.now && msg.now.title) {
              nowTitle.textContent = msg.now.title;
              nowState.textContent = msg.now.paused ? 'Paused' : 'Playing';
            }
          } else if (msg.t === 'stage') {
            if (msg.ok === false) nowState.textContent = 'No HeckYeah page is in front on the other device';
          }
        });
        conn.on('close', function () { handleDrop(myGen, 'channel closed'); });
      });
    }
    pairBtn.addEventListener('click', function () {
      if (pairBtn.disabled) return;
      gLog('confirm sent');
      setStatus('Confirming\u2026', '#ffd60a');
      sendRaw({ t: 'pair-confirm' });
    });
    discBtn.addEventListener('click', function () {
      userStopped = true;
      stopHeartbeat();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      sendRaw({ t: 'bye' });
      paired = false;
      try { conn && conn.close(); } catch (e) {}
      try { peer && peer.destroy(); } catch (e) {}
      conn = null;
      setStatus('Disconnected', '#ff453a');
      showControls(false);
    });
    setTimeout(connect, 400); // auto-connect + request, like the TV remote

    /* trackpad: 1 finger move (x1.7), tap = click, 2 fingers = scroll */
    var lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0, accX = 0, accY = 0, flushTimer = 0, twoFinger = false, lastScrollY = 0;
    function flushMove() {
      if (accX || accY) { send({ t: 'move', dx: Math.round(accX), dy: Math.round(accY) }); accX = 0; accY = 0; }
    }
    pad.addEventListener('touchstart', function (ev) {
      ev.preventDefault();
      var t = ev.touches[0];
      lastX = downX = t.clientX; lastY = downY = t.clientY; downT = Date.now();
      twoFinger = ev.touches.length > 1;
      if (twoFinger) lastScrollY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
    }, { passive: false });
    pad.addEventListener('touchmove', function (ev) {
      ev.preventDefault();
      if (ev.touches.length > 1) {
        twoFinger = true;
        var midY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
        var dy = (lastScrollY - midY) * 2;
        lastScrollY = midY;
        if (Math.abs(dy) >= 4) send({ t: 'scroll', dy: Math.round(dy) });
        return;
      }
      var t = ev.touches[0];
      accX += (t.clientX - lastX) * 1.7;
      accY += (t.clientY - lastY) * 1.7;
      lastX = t.clientX; lastY = t.clientY;
      if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = 0; flushMove(); }, 40);
    }, { passive: false });
    pad.addEventListener('touchend', function (ev) {
      ev.preventDefault();
      flushMove();
      var movedDist = Math.abs(lastX - downX) + Math.abs(lastY - downY);
      if (!twoFinger && ev.touches.length === 0 && movedDist < 10 && Date.now() - downT < 300) {
        send({ t: 'click' });
      }
      if (ev.touches.length === 0) twoFinger = false;
    }, { passive: false });

    /* keyboard: forward typed text + special keys */
    kbBtn.addEventListener('click', function () { input.focus(); });
    enterBtn.addEventListener('click', function () { send({ t: 'key', k: 'Enter' }); });
    bsBtn.addEventListener('click', function () { send({ t: 'key', k: 'Backspace' }); });
    var prevVal = '';
    input.addEventListener('input', function () {
      var v = input.value;
      if (v.length > prevVal.length && v.indexOf(prevVal) === 0) {
        send({ t: 'text', s: v.slice(prevVal.length) });
      } else if (v.length < prevVal.length) {
        for (var i = 0; i < prevVal.length - v.length; i++) send({ t: 'key', k: 'Backspace' });
      } else if (v !== prevVal) {
        send({ t: 'text', s: v });
      }
      prevVal = v;
    });
    input.addEventListener('keydown', function (ev) {
      if (['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Tab'].indexOf(ev.key) !== -1) {
        send({ t: 'key', k: ev.key });
      }
    });
    return true;
  }

  H.Remote = {
    parseRemoteHash: parseRemoteHash,
    isRemoteHash: function () { return !!parseRemoteHash(); },
    startHostPanel: startHostPanel,
    stopHost: endSession,
    reportNow: reportNow,
    guestBoot: guestBoot,
    setMediaHandler: function (fn) { mediaHandler = fn; },
    randomRoom: randomRoom,
    randomCode: randomCode,
    remoteUrl: remoteUrl
  };
})();
