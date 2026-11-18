/* uBlock for Orion — page-world hook.
 * Injected by content.js at document_start. Does the jobs that can only be
 * done in the page's own JS world:
 *  - fallback request blocking (I): fetch / XHR / sendBeacon / WebSocket to
 *    hosts taken from pure ||domain^ network rules, used when Orion's
 *    webRequest layer never fires
 *  - scriptlets (E): the ##+js(...) implementations
 *  - per-site switches that need page APIs (C): noPopups, noRemoteFonts
 * Reports everything back to the content script via DOM CustomEvents
 * (name: ubo-orion-event, detail: JSON string) for the Logger (B).
 */
(function () {
  'use strict';
  if (window.__uboOrionHook) return;
  window.__uboOrionHook = true;

  var cfgEl = document.querySelector('script[data-ubo-cfg]') || document.getElementById('ubo-orion-config');
  var cfg = {};
  try { cfg = JSON.parse(cfgEl.textContent || '{}'); } catch (e) {}
  if (cfgEl) cfgEl.remove();

  // K stealth: wrapped functions report a native-looking toString().
  // (Defeats fn.toString() checks; Function.prototype.toString source
  // inspection can still see a wrapper — stated honestly in the README.)
  function hide(fn, name) {
    try { fn.toString = function () { return 'function ' + name + '() { [native code] }'; }; } catch (e) {}
    return fn;
  }
  var stubRules = cfg.redirectStubs || [];
  function stubForUrl(url) {
    for (var i = 0; i < stubRules.length; i++) {
      if (String(url).indexOf(stubRules[i].needle) !== -1) return stubRules[i];
    }
    return null;
  }

  var blockSet = {};
  (cfg.blockDomains || []).forEach(function (d) { blockSet[d] = 1; });
  // v1.2.3: never fallback-block the page's own party — if a broad list
  // rule ever put a platform's own domain in the block set, rejecting
  // its first-party fetch/XHR kills the app (YouTube black screen).
  function regD(h) {
    var p = String(h || '').toLowerCase().split('.').filter(Boolean);
    if (p.length <= 2) return p.join('.');
    var l2 = p.slice(-2).join('.');
    var multi = { 'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1, 'com.au': 1, 'co.jp': 1, 'com.br': 1, 'co.nz': 1, 'com.cn': 1, 'com.tw': 1, 'co.kr': 1, 'com.mx': 1, 'com.sg': 1, 'com.hk': 1 };
    return multi[l2] ? p.slice(-3).join('.') : l2;
  }
  var PARTY_OF = {};
  [['x.com', 'twitter.com', 'twimg.com', 't.co'],
   ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com'],
   ['facebook.com', 'fbcdn.net', 'facebook.net'],
   ['instagram.com', 'cdninstagram.com', 'fbcdn.net'],
   ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'],
   ['twitch.tv', 'ttvnw.net', 'jtvnw.net'],
   ['spotify.com', 'scdn.co'],
   ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com'],
   ['amazon.com', 'media-amazon.com', 'images-amazon.com'],
   ['tiktok.com', 'tiktokcdn.com', 'muscdn.com']
  ].forEach(function (g, gi) { g.forEach(function (d) { PARTY_OF[d] = gi; }); });
  function sameParty(a, b) {
    a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
    if (!a || !b) return false;
    if (a === b || a.slice(-(b.length + 1)) === '.' + b || b.slice(-(a.length + 1)) === '.' + a) return true;
    var ra = regD(a), rb = regD(b);
    if (ra === rb) return true;
    if (PARTY_OF[ra] !== undefined && PARTY_OF[ra] === PARTY_OF[rb]) return true;
    var sa = ra.split('.')[0], sb = rb.split('.')[0];
    return !!(sa && sb && Math.min(sa.length, sb.length) >= 4 && (sa.indexOf(sb) === 0 || sb.indexOf(sa) === 0));
  }
  function hostBlocked(host) {
    if (!host) return false;
    if (sameParty(host, location.hostname)) return false;
    var parts = String(host).toLowerCase().split('.');
    for (var i = 0; i < parts.length; i++) if (blockSet[parts.slice(i).join('.')]) return true;
    return false;
  }
  function urlHost(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ''; } }
  function emit(kind, detail) {
    try {
      window.dispatchEvent(new CustomEvent('ubo-orion-event', {
        detail: JSON.stringify({ kind: kind, detail: detail || '', t: Date.now() })
      }));
    } catch (e) {}
  }

  var fetchIfConds = [], xhrIfConds = [], jsonPrune = null, jsonPruneFetch = null, jsonPruneXhr = null;
  // trusted-replace-*-response rules (the YouTube adPlacements -> no_ads family)
  var trustedRules = [];
  function parseNeedle(raw) {
    if (!raw) return null;
    var m = /^\/(.*)\/([a-z]*)$/.exec(raw);
    if (m) { try { return new RegExp(m[1], m[2].indexOf('g') === -1 ? m[2] + 'g' : m[2]); } catch (e) { return null; } }
    return raw;
  }
  function applyTrusted(text, url, kind) {
    var out = text, hit = false;
    trustedRules.forEach(function (r) {
      if (r.kind !== kind && r.kind !== 'both') return;
      if (r.urlRe && !r.urlRe.test(url)) return;
      var before = out;
      out = typeof r.needle === 'string' ? out.split(r.needle).join(r.replacement) : out.replace(r.needle, r.replacement);
      if (out !== before) hit = true;
    });
    if (hit) emit('scriptlet', 'trusted-replace-' + kind + '-response: ' + url);
    return out;
  }
  function hasTrusted(url, kind) {
    return trustedRules.some(function (r) {
      return (r.kind === kind || r.kind === 'both') && (!r.urlRe || r.urlRe.test(url));
    });
  }

  function condMatch(conds, url, props) {
    return conds.some(function (c) {
      return url.indexOf(c) !== -1 || (props && JSON.stringify(props).indexOf(c) !== -1);
    });
  }

  /* ---------------- fallback network layer (I) + no-fetch-if / no-xhr-if */
  if (window.fetch) {
    var origFetch = window.fetch;
    window.fetch = hide(function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var stub = stubForUrl(url);
      if (stub) {
        emit('redirect-stub', stub.key + ': ' + url);
        return Promise.resolve(new Response(stub.text, { status: 200, headers: { 'Content-Type': stub.mime } }));
      }
      if (condMatch(fetchIfConds, url, init)) {
        emit('scriptlet', 'no-fetch-if: ' + url);
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (hostBlocked(urlHost(url))) {
        emit('fallback-block', url);
        return Promise.reject(new TypeError('blocked by uBlock for Orion (fallback)'));
      }
      var p = origFetch.apply(this, arguments);
      if (hasTrusted(url, 'fetch')) {
        return p.then(function (res) {
          return res.clone().text().then(function (text) {
            var replaced = applyTrusted(text, url, 'fetch');
            if (replaced === text) return res;
            // v1.2.3: never carry the original content-length /
            // content-encoding into a reconstructed body — a stale
            // length truncates the JSON and breaks the app reading it.
            var hh = new Headers(res.headers);
            hh.delete('content-length'); hh.delete('content-encoding');
            return new Response(replaced, { status: res.status, statusText: res.statusText, headers: hh });
          }).catch(function () { return res; });
        });
      }
      if (jsonPruneFetch) {
        return p.then(function (res) {
          try {
            var clone = res.clone();
            var origJson = res.json.bind(res);
            res.json = function () {
              return origJson().then(function (data) { return pruneData(data, jsonPruneFetch); });
            };
            void clone;
          } catch (e) {}
          return res;
        });
      }
      return p;
    }, 'fetch');
  }
  (function () {
    var X = window.XMLHttpRequest; if (!X) return;
    var open = X.prototype.open, send = X.prototype.send;
    var rawTextDesc = Object.getOwnPropertyDescriptor(X.prototype, 'responseText');
    var rawRespDesc = Object.getOwnPropertyDescriptor(X.prototype, 'response');
    X.prototype.open = hide(function (method, url) {
      this.__uboUrl = url;
      var stubRule = stubForUrl(String(url));
      if (stubRule) {
        this.__uboStub = stubRule;
        try {
          Object.defineProperty(this, 'responseText', { configurable: true, get: function () { return stubRule.text; } });
          Object.defineProperty(this, 'response', { configurable: true, get: function () { return stubRule.text; } });
        } catch (e) {}
      }
      var ret = open.apply(this, arguments);
      if (hasTrusted(String(url), 'xhr') && rawTextDesc && rawTextDesc.get) {
        var xhr = this, rawGet = rawTextDesc.get, rawRespGet = rawRespDesc && rawRespDesc.get;
        try {
          Object.defineProperty(xhr, 'responseText', {
            configurable: true,
            get: function () {
              var raw = rawGet.call(xhr);
              return typeof raw === 'string' ? applyTrusted(raw, String(url), 'xhr') : raw;
            }
          });
          if (rawRespGet) {
            Object.defineProperty(xhr, 'response', {
              configurable: true,
              get: function () {
                var raw = rawRespGet.call(xhr);
                if (typeof raw === 'string') return applyTrusted(raw, String(url), 'xhr');
                if (raw && xhr.responseType === 'json') {
                  try { return JSON.parse(applyTrusted(JSON.stringify(raw), String(url), 'xhr')); } catch (e) { return raw; }
                }
                return raw;
              }
            });
          }
        } catch (e) {}
      }
      return ret;
    }, 'open');
    X.prototype.send = hide(function (body) {
      var url = this.__uboUrl || '';
      if (this.__uboStub) {
        emit('redirect-stub', this.__uboStub.key + ': ' + url);
        var sx = this;
        setTimeout(function () {
          try { sx.dispatchEvent(new Event('readystatechange')); sx.dispatchEvent(new Event('load')); sx.dispatchEvent(new Event('loadend')); } catch (e) {}
        }, 0);
        return;
      }
      if (condMatch(xhrIfConds, url, body)) {
        emit('scriptlet', 'no-xhr-if: ' + url);
        var self = this;
        setTimeout(function () {
          try { self.dispatchEvent(new Event('load')); self.dispatchEvent(new Event('loadend')); } catch (e) {}
        }, 0);
        return;
      }
      if (hostBlocked(urlHost(url))) {
        emit('fallback-block', url);
        var xhr = this;
        setTimeout(function () {
          try { xhr.dispatchEvent(new Event('error')); xhr.dispatchEvent(new Event('loadend')); } catch (e) {}
        }, 0);
        return;
      }
      return send.apply(this, arguments);
    }, 'send');
  })();
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = hide(function (url) {
      if (hostBlocked(urlHost(url))) { emit('fallback-block', String(url)); return false; }
      return origBeacon.apply(null, arguments);
    }, 'sendBeacon');
  }
  if (window.WebSocket) {
    var OrigWS = window.WebSocket;
    window.WebSocket = hide(function (url) {
      if (hostBlocked(urlHost(url))) { emit('fallback-block', String(url)); throw new TypeError('blocked by uBlock for Orion (fallback)'); }
      return new OrigWS(url, arguments[1]);
    }, 'WebSocket');
    window.WebSocket.prototype = OrigWS.prototype;
  }

  /* ---------------- per-site switches (C), page side */
  var sw = cfg.switches || {};
  if (sw.noPopups) {
    window.open = hide(function () { emit('switch-block', 'noPopups: window.open'); return null; }, 'open');
  }
  if (sw.noRemoteFonts && window.FontFace) {
    var OrigFF = window.FontFace;
    window.FontFace = hide(function (family, source) {
      if (typeof source === 'string' && /url\s*\(/i.test(source)) {
        emit('switch-block', 'noRemoteFonts: FontFace ' + family);
        return new OrigFF(family, 'local("")');
      }
      return new OrigFF(family, source, arguments[2]);
    }, 'FontFace');
    window.FontFace.prototype = OrigFF.prototype;
  }

  /* ---------------- scriptlets (E) */
  function parseValue(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    if (v === 'undefined') return undefined;
    if (v === 'noopFunc') return function () {};
    if (v === 'emptyObj') return {};
    if (v === 'emptyArr') return [];
    if (v === "''" || v === '""') return '';
    var n = Number(v); return isNaN(n) ? v : n;
  }
  function chain(root, path) {
    var parts = path.split('.'), obj = root;
    for (var i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] === undefined || obj[parts[i]] === null) {
        try { obj[parts[i]] = {}; } catch (e) { return null; }
      }
      obj = obj[parts[i]];
    }
    return { owner: obj, key: parts[parts.length - 1] };
  }
  // json-prune path engine: dotted paths with *, [n], [-] (last element)
  // and name[n] segments — the forms the real lists actually use
  // (e.g. entries.[-].command.reelWatchEndpoint.adClientParams.isAd).
  // [?...] filter expressions are not supported and safely no-op.
  function pruneData(data, paths) {
    paths.forEach(function (path) { pruneSeg(data, String(path).split('.').filter(Boolean), 0); });
    return data;
  }
  function pruneSeg(node, segs, i) {
    if (node === null || typeof node !== 'object' || i >= segs.length) return;
    var seg = segs[i], last = i === segs.length - 1;
    var m = /^([^\[]*)((?:\[[^\]]*\])*)$/.exec(seg);
    if (!m) return;
    var name = m[1], brackets = [], bm, re = /\[([^\]]*)\]/g;
    while ((bm = re.exec(m[2] || ''))) brackets.push(bm[1]);
    function apply(target, key) {
      if (target === null || target === undefined) return;
      if (last && !brackets.length) {
        try { delete target[key]; } catch (e) { try { target[key] = undefined; } catch (e2) {} }
        return;
      }
      if (brackets.length) applyBrackets(target[key], brackets, 0, segs, i);
      else pruneSeg(target[key], segs, i + 1);
    }
    if (name === '*') { Object.keys(node).forEach(function (k) { apply(node, k); }); return; }
    if (name === '' && brackets.length) { applyBrackets(node, brackets, 0, segs, i); return; }
    if (name) apply(node, name);
  }
  function applyBrackets(child, brackets, bi, segs, i) {
    if (child === null || typeof child !== 'object') return;
    var b = brackets[bi], lastBracket = bi === brackets.length - 1, pathLast = i === segs.length - 1;
    var indexes = [];
    if (b === '*') indexes = Array.isArray(child) ? child.map(function (_, idx) { return idx; }) : Object.keys(child);
    else if (b === '-') indexes = Array.isArray(child) && child.length ? [child.length - 1] : [];
    else if (/^\d+$/.test(b)) indexes = [parseInt(b, 10)];
    else return;
    indexes.forEach(function (idx) {
      if (lastBracket && pathLast) {
        try { delete child[idx]; } catch (e) { try { child[idx] = undefined; } catch (e2) {} }
      } else if (lastBracket) pruneSeg(child[idx], segs, i + 1);
      else applyBrackets(child[idx], brackets, bi + 1, segs, i);
    });
  }
  function fnSource(fn) { try { return typeof fn === 'function' ? fn.toString() : String(fn); } catch (e) { return ''; } }

  var origSetTimeout = window.setTimeout, origSetInterval = window.setInterval;
  var timeoutConds = [], intervalConds = [];

  var registry = {
    'set-constant': function (args) {
      var c = chain(window, args[0]); if (!c) return;
      var val = parseValue(args[1]);
      try {
        Object.defineProperty(c.owner, c.key, { get: function () { return val; }, set: function () {}, configurable: true });
      } catch (e) { c.owner[c.key] = val; }
    },
    'abort-current-inline-script': function (args) {
      var c = chain(window, args[0]); if (!c) return;
      var needle = args[1] || '';
      var cur = c.owner[c.key];
      try {
        Object.defineProperty(c.owner, c.key, {
          get: function () {
            var cs = document.currentScript;
            if (cs && (!needle || (cs.textContent || '').indexOf(needle) !== -1)) throw new Error('aborted inline script');
            return cur;
          },
          set: function (v) {
            var cs = document.currentScript;
            if (cs && (!needle || (cs.textContent || '').indexOf(needle) !== -1)) throw new Error('aborted inline script');
            cur = v;
          }, configurable: true
        });
      } catch (e) {}
    },
    'abort-on-property-read': function (args) {
      var c = chain(window, args[0]); if (!c) return;
      try {
        Object.defineProperty(c.owner, c.key, {
          get: function () { throw new Error('abort-on-property-read: ' + args[0]); }, configurable: true
        });
      } catch (e) {}
    },
    'abort-on-property-write': function (args) {
      var c = chain(window, args[0]); if (!c) return;
      var cur = c.owner[c.key];
      try {
        Object.defineProperty(c.owner, c.key, {
          get: function () { return cur; },
          set: function () { throw new Error('abort-on-property-write: ' + args[0]); }, configurable: true
        });
      } catch (e) {}
    },
    'no-setTimeout-if': function (args) { timeoutConds.push(args[0] || ''); },
    'no-setInterval-if': function (args) { intervalConds.push(args[0] || ''); },
    'no-fetch-if': function (args) { fetchIfConds.push(args[0] || ''); },
    'no-xhr-if': function (args) { xhrIfConds.push(args[0] || ''); },
    'json-prune': function (args) {
      jsonPrune = { paths: (args[0] || '').split(/\s+/).filter(Boolean), needle: args[1] || '' };
      var origParse = JSON.parse;
      JSON.parse = function (text) {
        var data = origParse.apply(this, arguments);
        if (jsonPrune && (!jsonPrune.needle || String(text).indexOf(jsonPrune.needle) !== -1)) {
          try { data = pruneData(data, jsonPrune.paths); } catch (e) {}
        }
        return data;
      };
    },
    'json-prune-fetch-response': function (args) { jsonPruneFetch = (args[0] || '').split(/\s+/).filter(Boolean); },
    'json-prune-xhr-response': function (args) { jsonPruneXhr = (args[0] || '').split(/\s+/).filter(Boolean); },
    'set-cookie': function (args) {
      try { document.cookie = args[0] + '=' + (args[1] || '') + '; path=/; max-age=31536000'; } catch (e) {}
    },
    'remove-cookie': function (args) {
      try { document.cookie = args[0] + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'; } catch (e) {}
    },
    'alert-defuser': function () { window.alert = function () {}; },
    'confirm-defuser': function () { window.confirm = function () { return true; }; },
    'trusted-replace-xhr-response': function (args) {
      trustedRules.push({ needle: parseNeedle(args[0]), replacement: args[1] || '', urlRe: parseNeedle(args[2]), kind: 'xhr' });
    },
    'trusted-replace-fetch-response': function (args) {
      trustedRules.push({ needle: parseNeedle(args[0]), replacement: args[1] || '', urlRe: parseNeedle(args[2]), kind: 'fetch' });
    },
    'noeval': function () {
      window.eval = hide(function () { emit('scriptlet', 'noeval'); return undefined; }, 'eval');
    },
    'addEventListener-defuser': function (args) {
      var type = args[0], sel = args[1] || '';
      var origAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (t, fn, opts) {
        if (t === type && this instanceof Element) {
          try { if (!sel || this.matches(sel)) { emit('scriptlet', 'addEventListener-defuser: ' + type); return; } } catch (e) {}
        }
        return origAdd.call(this, t, fn, opts);
      };
    }
  };
  registry['set'] = registry['set-constant'];
  registry['aopr'] = registry['abort-on-property-read'];
  registry['aopw'] = registry['abort-on-property-write'];
  registry['acis'] = registry['abort-current-inline-script'];
  registry['aeld'] = registry['addEventListener-defuser'];
  registry['nosiif'] = registry['no-setInterval-if'];
  registry['nostif'] = registry['no-setTimeout-if'];
  registry['trusted-rpfr'] = registry['trusted-replace-fetch-response'];
  registry['trusted-replace-response'] = registry['trusted-replace-xhr-response'];

  if (timeoutConds) {
    window.setTimeout = hide(function (fn, delay) {
      if (timeoutConds.some(function (c) { return c && fnSource(fn).indexOf(c) !== -1; })) {
        emit('scriptlet', 'no-setTimeout-if');
        return origSetTimeout.call(window, function () {}, 0);
      }
      return origSetTimeout.apply(window, arguments);
    }, 'setTimeout');
    window.setInterval = hide(function (fn, delay) {
      if (intervalConds.some(function (c) { return c && fnSource(fn).indexOf(c) !== -1; })) {
        emit('scriptlet', 'no-setInterval-if');
        return origSetInterval.call(window, function () {}, 3600000);
      }
      return origSetInterval.apply(window, arguments);
    }, 'setInterval');
  }

  var applied = 0, unsupported = [];
  (cfg.scriptlets || []).forEach(function (call) {
    var fn = registry[call.name];
    if (fn) { try { fn(call.args || []); applied++; } catch (e) { emit('scriptlet-error', call.name + ': ' + e.message); } }
    else unsupported.push(call.name);
  });
  if (unsupported.length) emit('scriptlet-unsupported', unsupported.join(','));
  emit('ready', 'scriptlets applied: ' + applied + ', blockDomains: ' + (cfg.blockDomains || []).length);
})();
