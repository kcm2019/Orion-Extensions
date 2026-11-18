/* dissolve.js — Safari-style dissolve.
 * B (full particle dissolve): first try a real snapshot of the element
 * (SVG foreignObject -> canvas). If the canvas is usable and untainted,
 * particles sample actual pixels. Otherwise fall back to palette
 * particles sampled from the element's computed colours, over a clone
 * that blurs and fades. The pure grid maths lives here for the tests. */
(function (global) {
  'use strict';

  var MAX_PARTICLES = 480;

  function particleGrid(w, h) {
    w = Math.max(0, Math.round(w)); h = Math.max(0, Math.round(h));
    if (!w || !h) return { step: 8, cols: 0, rows: 0, count: 0 };
    var area = w * h;
    var step = Math.max(4, Math.round(Math.sqrt(area / MAX_PARTICLES)));
    var cols = Math.max(1, Math.floor(w / step));
    var rows = Math.max(1, Math.floor(h / step));
    while (cols * rows > MAX_PARTICLES) { step += 1; cols = Math.floor(w / step); rows = Math.floor(h / step); }
    return { step: step, cols: cols, rows: rows, count: cols * rows };
  }

  function paletteFor(el, win) {
    var colors = [];
    try {
      var cs = win.getComputedStyle(el);
      [cs.backgroundColor, cs.color, cs.borderTopColor].forEach(function (c) {
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') colors.push(c);
      });
    } catch (e) {}
    if (!colors.length) colors = ['rgb(180,180,185)', 'rgb(140,140,150)'];
    return colors;
  }

  /* Try to rasterise the element. cb(canvas|null). Async (Image load). */
  function snapshot(el, rect, doc, cb) {
    var done = false;
    function finish(c) { if (!done) { done = true; cb(c || null); } }
    try {
      var clone = el.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      clone.style.margin = '0';
      var html = new XMLSerializer().serializeToString(clone);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(rect.width) +
        '" height="' + Math.round(rect.height) + '"><foreignObject width="100%" height="100%">' +
        html + '</foreignObject></svg>';
      var img = new Image();
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      var timer = setTimeout(function () { finish(null); }, 450);
      img.onload = function () {
        clearTimeout(timer);
        try {
          var canvas = doc.createElement('canvas');
          canvas.width = Math.max(1, Math.round(rect.width));
          canvas.height = Math.max(1, Math.round(rect.height));
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Taint / emptiness probe: throws on a tainted canvas.
          var px = ctx.getImageData(0, 0, 1, 1);
          if (!px) return finish(null);
          finish(canvas);
        } catch (e) { finish(null); }
      };
      img.onerror = function () { clearTimeout(timer); finish(null); };
      img.src = url;
    } catch (e) { finish(null); }
  }

  /* Animate the dissolve in a fixed canvas over the element's rect.
   * The caller hides/removes the real element. */
  function animate(el, doc, win, done) {
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) { if (done) done('none'); return; }
    snapshot(el, rect, doc, function (snap) {
      var grid = particleGrid(rect.width, rect.height);
      if (!grid.count) { if (done) done('none'); return; }
      var canvas = doc.createElement('canvas');
      var dpr = Math.min(2, win.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top +
        'px;width:' + rect.width + 'px;height:' + rect.height + 'px;z-index:2147483646;' +
        'pointer-events:none;';
      (doc.body || doc.documentElement).appendChild(canvas);
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      var palette = paletteFor(el, win);
      var snapCtx = null, snapData = null;
      if (snap) {
        try { snapCtx = snap.getContext('2d'); snapData = snapCtx.getImageData(0, 0, snap.width, snap.height); }
        catch (e) { snapData = null; }
      }
      var particles = [];
      for (var gy = 0; gy < grid.rows; gy++) {
        for (var gx = 0; gx < grid.cols; gx++) {
          var x = gx * grid.step + grid.step / 2;
          var y = gy * grid.step + grid.step / 2;
          var color;
          if (snapData) {
            var sx = Math.min(snap.width - 1, Math.floor(x));
            var sy = Math.min(snap.height - 1, Math.floor(y));
            var idx = (sy * snap.width + sx) * 4;
            var a = snapData.data[idx + 3];
            if (a < 24) continue; // transparent pixel — no particle
            color = 'rgba(' + snapData.data[idx] + ',' + snapData.data[idx + 1] + ',' + snapData.data[idx + 2] + ',';
          } else {
            color = palette[(gx + gy) % palette.length].replace('rgb', 'rgba').replace(')', ',');
          }
          particles.push({
            x: x, y: y, r: Math.max(1.2, grid.step * 0.42),
            vx: (Math.random() - 0.5) * 0.7,
            vy: -(0.25 + Math.random() * 0.9),
            drift: (Math.random() - 0.5) * 0.35,
            delay: (y / Math.max(1, rect.height)) * 180 + Math.random() * 90,
            color: color
          });
        }
      }
      if (!particles.length) { canvas.remove(); if (done) done('none'); return; }
      var start = null;
      var DURATION = 850;
      function frame(ts) {
        if (!start) start = ts;
        var t = ts - start;
        ctx.clearRect(0, 0, rect.width, rect.height);
        var alive = false;
        particles.forEach(function (p) {
          var lt = t - p.delay;
          if (lt < 0) { alive = true; drawP(p, 1, 0); return; }
          var k = lt / DURATION;
          if (k >= 1) return;
          alive = true;
          var dx = p.vx * lt * 0.06 + Math.sin((lt / 140) + p.x) * p.drift * (lt / 60);
          var dy = p.vy * lt * 0.06 + lt * lt * 0.000012; // slight settle after rise
          drawP(p, 1 - k, 0, dx, dy, 1 - k * 0.7);
        });
        function drawP(p, alpha, _z, dx, dy, scale) {
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.fillStyle = p.color + Math.max(0, alpha) + ')';
          ctx.beginPath();
          ctx.arc(p.x + (dx || 0), p.y + (dy || 0), p.r * (scale || 1), 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (alive && t < DURATION + 400) win.requestAnimationFrame(frame);
        else { canvas.remove(); if (done) done(snapData ? 'snapshot' : 'palette'); }
      }
      win.requestAnimationFrame(frame);
    });
  }

  global.EBDissolve = {
    particleGrid: particleGrid,
    paletteFor: paletteFor,
    animate: animate,
    MAX_PARTICLES: MAX_PARTICLES
  };
})(typeof window !== 'undefined' ? window : globalThis);
