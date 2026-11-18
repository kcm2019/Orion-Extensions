/* uBlock for Orion — filter engine (shared: background, dashboard, content, node tests)
 * Parses uBlock Origin / Adblock Plus filter syntax:
 *  - network filters: ||, |anchors, * wildcards, ^ separators, @@ exceptions,
 *    $options (types, ~types, domain=, third-party, ~third-party, important, badfilter, match-case)
 *  - cosmetic filters: ##, #@# (generic + domain-specific, comma domains, ~exclusions)
 *  - scriptlets: ##+js(name, args...), #+js(...), #@#+js(...) exceptions
 *  - hosts-file lines: 0.0.0.0 domain
 * $redirect / $redirect-rule are supported since v1.1 (K anti-detect pack):
 *  the matcher returns the stub resource name and the caller serves it.
 * NOT supported (counted as unsupported, F was not picked): procedural #?# filters,
 *  #$# style rules, $removeparam / $csp / $replace actions (parsed, not applied).
 */
(function (root) {
  'use strict';

  function hostSuffixes(host) {
    var parts = String(host || '').toLowerCase().split('.'), out = [];
    for (var i = 0; i < parts.length; i++) out.push(parts.slice(i).join('.'));
    return out;
  }
  function hostMatches(host, entry) {
    host = String(host || '').toLowerCase(); entry = String(entry || '').toLowerCase();
    return host === entry || host.slice(-(entry.length + 1)) === '.' + entry;
  }
  function isThirdParty(reqHost, docHost) {
    if (!docHost) return false;
    reqHost = String(reqHost).toLowerCase(); docHost = String(docHost).toLowerCase();
    return reqHost !== docHost && !hostMatches(reqHost, docHost) && !hostMatches(docHost, reqHost);
  }

  var REGEX_SPECIALS = '.+?{}()[]\\';
  function patternToRegex(pattern) {
    if (pattern.charAt(0) === '/' && pattern.lastIndexOf('/') > 0 &&
        /^\/.*\/$/.test(pattern.split('$')[0])) {
      return pattern.slice(1, pattern.lastIndexOf('/'));
    }
    var p = pattern, prefix = '', suffix = '';
    if (p.slice(0, 2) === '||') {
      prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]+\\.)?';
      p = p.slice(2);
    } else if (p.charAt(0) === '|') {
      prefix = '^'; p = p.slice(1);
    }
    if (p.length > 1 && p.charAt(p.length - 1) === '|') { suffix = '$'; p = p.slice(0, -1); }
    var out = '';
    for (var i = 0; i < p.length; i++) {
      var c = p.charAt(i);
      if (c === '*') out += '.*';
      else if (c === '^') out += '(?:[^a-zA-Z0-9_\\-.%]|$)';
      else if (c === '|') out += '\\|';
      else if (REGEX_SPECIALS.indexOf(c) !== -1) out += '\\' + c;
      else out += c;
    }
    return prefix + out + suffix;
  }

  function bucketKeyFor(pattern) {
    if (pattern.slice(0, 2) !== '||') return null;
    var rest = pattern.slice(2), m = /^[a-z0-9.-]+/i.exec(rest);
    if (!m) return null;
    var after = rest.charAt(m[0].length);
    // bucket only when the domain is a clean literal (next char ends/continues the pattern sanely)
    if (after === '' || after === '^' || after === '/' || after === '$' || after === '|' || after === ':') {
      return m[0].toLowerCase();
    }
    return null;
  }
  function pureBlockDomain(pattern, optionsRaw) {
    // ||domain^ / ||domain / ||domain$options-with-no-path -> usable by the page-world fallback
    var m = /^\|\|([a-z0-9.-]+)(\^|\||\$|\/)?/i.exec(pattern);
    if (!m) return null;
    var tail = pattern.slice(2 + m[1].length);
    if (tail === '' || tail === '^' || tail === '|' || tail.charAt(0) === '$') return m[1].toLowerCase();
    return null;
  }

  function parseOptions(raw) {
    var o = { t: [], nt: [], d: [], nd: [], tp: 0, imp: false, bad: false, mc: false, other: [] };
    if (!raw) return o;
    raw.split(',').forEach(function (tok) {
      tok = tok.trim(); if (!tok) return;
      var neg = tok.charAt(0) === '~'; if (neg) tok = tok.slice(1);
      if (tok === 'third-party' || tok === '3p') { o.tp = neg ? -1 : 1; return; }
      if (tok === 'first-party' || tok === '1p') { o.tp = neg ? 1 : -1; return; }
      if (tok === 'important') { o.imp = true; return; }
      if (tok === 'badfilter') { o.bad = true; return; }
      if (tok === 'match-case') { o.mc = true; return; }
      if (tok.indexOf('redirect-rule=') === 0) { o.redirRule = tok.slice(14).split(':')[0]; return; }
      if (tok.indexOf('redirect=') === 0) { o.redir = tok.slice(9).split(':')[0]; return; }
      if (tok.indexOf('domain=') === 0) {
        tok.slice(7).split('|').forEach(function (d) {
          d = d.trim().toLowerCase(); if (!d) return;
          if (d.charAt(0) === '~') o.nd.push(d.slice(1)); else o.d.push(d);
        });
        return;
      }
      if (tok.indexOf('=') !== -1) { o.other.push((neg ? '~' : '') + tok); return; }
      if (IGNORED_OPTIONS[tok]) { o.other.push((neg ? '~' : '') + tok); return; }
      // resource types
      var type = OPTION_TYPE_ALIAS[tok] || tok;
      if (neg) o.nt.push(type); else o.t.push(type);
    });
    return o;
  }
  var TYPE_ALIAS = {
    main_frame: 'document', sub_frame: 'sub_frame', stylesheet: 'stylesheet', script: 'script',
    image: 'image', font: 'font', object: 'object', xmlhttprequest: 'xhr', fetch: 'xhr',
    ping: 'ping', media: 'media', websocket: 'websocket', other: 'other', document: 'document'
  };
  function mapType(t) { return TYPE_ALIAS[t] || 'other'; }

  function splitScriptletArgs(inner) {
    // Commas split args, except \, \( \) and commas inside quotes.
    // A backslash only escapes , ( ) ' " \ — \d, \w etc. pass through intact
    // so regex arguments survive.
    var args = [], cur = '', quote = null;
    for (var i = 0; i < inner.length; i++) {
      var c = inner.charAt(i), next = inner.charAt(i + 1);
      if (c === '\\' && next && ',()\'"\\'.indexOf(next) !== -1) { cur += next; i++; continue; }
      if (quote) {
        if (c === quote) { quote = null; continue; }
        cur += c; continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === ',') { args.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    args.push(cur.trim());
    return args;
  }
  function parseScriptletCall(text) {
    // text like: +js(set-constant, foo.bar, 1)  (leading +js( already located by caller)
    var m = /^\+js\(\s*(.*)\)\s*$/.exec(text);
    if (!m) return null;
    var args = splitScriptletArgs(m[1]);
    if (!args.length || !args[0]) return null;
    return { name: args[0], args: args.slice(1) };
  }

  function isProceduralSelector(sel) {
    return /:(xpath|style|matches-css|matches-attr|watch-attr|remove-attr|remove-class|upward|min-text-length|has-text|matches-path|remove|others)\b/.test(sel) ||
      /:has\(.*:(text|contains)/.test(sel) || sel.charAt(0) === '^';
  }
  var IGNORED_OPTIONS = { ghide: 1, shide: 1, ehide: 1, specifichide: 1, 'inline-script': 1, 'inline-font': 1, all: 1 };
  var OPTION_TYPE_ALIAS = { xmlhttprequest: 'xhr', subdocument: 'sub_frame', frame: 'sub_frame', doc: 'document', fetch: 'xhr', beacon: 'ping' };

  function emptyParsed(listId) {
    return {
      listId: listId, network: [], exceptions: [], badCores: [], redirRules: [],
      cosGeneric: [], cosSpecific: {}, cosGenericExcl: [],
      cosExcGeneric: [], cosExcSpecific: {},
      jsGeneric: [], jsSpecific: {}, jsGenericExcl: [], jsExc: [],
      unsupported: { procedural: 0, style: 0, other: 0 },
      counts: { lines: 0, network: 0, exceptions: 0, cosmetic: 0, scriptlets: 0, hosts: 0, redirect: 0 }
    };
  }

  function addDomainEntries(store, domainsPart, value) {
    // store: {specific:{}, generic:[], genericExcl:[]}
    if (!domainsPart) { store.generic.push(value); return; }
    var domains = domainsPart.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    var pos = domains.filter(function (d) { return d.charAt(0) !== '~'; });
    var neg = domains.filter(function (d) { return d.charAt(0) === '~'; }).map(function (d) { return d.slice(1); });
    if (!pos.length) { store.genericExcl.push({ v: value, excl: neg }); return; }
    pos.forEach(function (d) {
      if (!store.specific[d]) store.specific[d] = [];
      store.specific[d].push(value);
    });
  }

  function parseList(text, listId) {
    var out = emptyParsed(listId);
    var cosStore = { generic: out.cosGeneric, specific: out.cosSpecific, genericExcl: out.cosGenericExcl };
    var cosExcStore = { generic: out.cosExcGeneric, specific: out.cosExcSpecific, genericExcl: [] };
    var jsStore = { generic: out.jsGeneric, specific: out.jsSpecific, genericExcl: out.jsGenericExcl };
    var lines = String(text || '').split(/\r?\n/);
    out.counts.lines = lines.length;
    lines.forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) return;

      // ---- scriptlets first (##+js / #+js / #@#+js) ----
      var jsExcIdx = line.indexOf('#@#+js(');
      var jsIdx = line.indexOf('##+js(');
      var jsShortIdx = jsIdx === -1 ? line.indexOf('#+js(') : -1;
      if (jsExcIdx !== -1 || jsIdx !== -1 || jsShortIdx !== -1) {
        var idx = jsExcIdx !== -1 ? jsExcIdx : (jsIdx !== -1 ? jsIdx : jsShortIdx);
        var isExc = jsExcIdx !== -1;
        var domPart = line.slice(0, idx);
        var callStart = line.indexOf('+js(', idx);
        var call = parseScriptletCall(line.slice(callStart));
        if (!call) { out.unsupported.other++; return; }
        if (isExc) {
          (domPart ? domPart.split(',') : ['']).forEach(function (d) {
            out.jsExc.push((d.trim().toLowerCase()) + '|' + call.name + '|' + call.args.join(','));
          });
        } else {
          addDomainEntries(jsStore, domPart, call);
        }
        out.counts.scriptlets++;
        return;
      }

      // ---- cosmetic / procedural / style ----
      var sepIdx = -1, sepKind = null;
      [['#@#', 'exc'], ['#?#', 'proc'], ['#$#', 'style'], ['##', 'cos']].forEach(function (pair) {
        var i = line.indexOf(pair[0]);
        if (i !== -1 && (sepIdx === -1 || i < sepIdx)) { sepIdx = i; sepKind = pair[0]; }
      });
      if (sepIdx !== -1) {
        var dPart = line.slice(0, sepIdx);
        var sel = line.slice(sepIdx + sepKind.length).trim();
        if (!sel) return;
        if (sepKind === '#?#') { out.unsupported.procedural++; return; }
        if (sepKind === '#$#') { out.unsupported.style++; return; }
        if (isProceduralSelector(sel)) { out.unsupported.procedural++; return; }
        if (sepKind === '#@#') addDomainEntries(cosExcStore, dPart, sel);
        else addDomainEntries(cosStore, dPart, sel);
        out.counts.cosmetic++;
        return;
      }

      if (line.charAt(0) === '!' || line.charAt(0) === '[' || line.charAt(0) === '#') return;

      // ---- hosts file ----
      var hm = /^(\d{1,3}(?:\.\d{1,3}){3}|::1?)\s+([a-z0-9.-]+)\s*$/i.exec(line);
      if (hm && hm[2] !== 'localhost') {
        out.network.push(makeFilter('||' + hm[2].toLowerCase() + '^', null, listId, line));
        out.counts.hosts++; out.counts.network++;
        return;
      }

      // ---- network ----
      var isExcNet = false;
      if (line.slice(0, 2) === '@@') { isExcNet = true; line = line.slice(2); }
      var dollar = line.indexOf('$');
      var pattern = dollar === -1 ? line : line.slice(0, dollar);
      var optRaw = dollar === -1 ? null : line.slice(dollar + 1);
      if (!pattern) return;
      var opts = parseOptions(optRaw);
      if (opts.bad) { out.badCores.push(pattern + '$' + (optRaw || '').replace(/,?badfilter/, '')); return; }
      // v1.2.1 hotfix: a pattern that matches EVERY URL (bare *, ||, ^,
      // separator-only) with no domain and no type restriction is never a
      // legitimate network rule in these lists — as a plain blocker it
      // cancels every request including page navigations, which is what
      // made all sites fail to load. Drop it at compile time and count it.
      if (!isExcNet) {
        var core = pattern.replace(/^\|+/, '').replace(/\|+$/, '');
        if ((core === '' || core === '*' || core === '^') && !(opts.d && opts.d.length) && !(opts.t && opts.t.length)) {
          out.unsupported.other++;
          return;
        }
      }
      var f = makeFilter(pattern, optRaw, listId, rawLine.trim());
      // v1.2.2: drop generic-bound patterns made almost entirely of
      // wildcards with no usable literal token (>= 3 stars, longest
      // literal run < 4 chars). Their regexes are the classic
      // catastrophic-backtracking shape and they can stall the
      // synchronous request listener; legitimate list rules virtually
      // always carry a literal token or a domain bucket.
      if (!f.b) {
        var stars = (pattern.match(/\*/g) || []).length;
        var maxRun = pattern.split(/[^a-zA-Z0-9]+/).reduce(function (m, w) { return Math.max(m, w.length); }, 0);
        if (stars >= 3 && maxRun < 4) { out.unsupported.other++; return; }
      }
      if (opts.redirRule && !opts.redir && !isExcNet) {
        // $redirect-rule alone never blocks; it only dresses up a block
        // caused by another filter. Kept in its own bucket set.
        out.redirRules.push(f); out.counts.redirect++;
        return;
      }
      if (opts.redir) out.counts.redirect++;
      if (isExcNet) { out.exceptions.push(f); out.counts.exceptions++; }
      else { out.network.push(f); out.counts.network++; }
    });
    // apply in-list badfilters
    if (out.badCores.length) {
      var bad = {};
      out.badCores.forEach(function (c) { bad[c] = true; });
      out.network = out.network.filter(function (f) { return !bad[f.p + '$' + (f.oraw || '')]; });
    }
    return out;
  }

  function makeFilter(pattern, optRaw, listId, raw) {
    var opts = parseOptions(optRaw);
    return {
      p: pattern, r: patternToRegex(pattern), oraw: optRaw || '',
      o: opts, l: listId, raw: raw || pattern,
      b: bucketKeyFor(pattern), pd: pureBlockDomain(pattern, optRaw)
    };
  }

  function emptyCompiled() {
    return {
      v: 1, buckets: {}, generic: [], excBuckets: {}, excGeneric: [],
      redirBuckets: {}, redirGeneric: [],
      cosGeneric: [], cosSpecific: {}, cosGenericExcl: [],
      cosExcGeneric: [], cosExcSpecific: {},
      jsGeneric: [], jsSpecific: {}, jsGenericExcl: [], jsExc: [],
      blockDomains: [], unsupported: { procedural: 0, style: 0, other: 0 },
      counts: { network: 0, exceptions: 0, cosmetic: 0, scriptlets: 0, hosts: 0, lines: 0, redirect: 0 }
    };
  }

  function pushBucket(store, f) {
    if (f.b) { if (!store[f.b]) store[f.b] = []; store[f.b].push(f); }
  }
  function mergeParsedList(compiled, parsed) {
    parsed.network.forEach(function (f) {
      if (f.b) pushBucket(compiled.buckets, f); else compiled.generic.push(f);
      if (f.pd && compiled.blockDomains.indexOf(f.pd) === -1) compiled.blockDomains.push(f.pd);
    });
    parsed.exceptions.forEach(function (f) {
      if (f.b) pushBucket(compiled.excBuckets, f); else compiled.excGeneric.push(f);
    });
    (parsed.redirRules || []).forEach(function (f) {
      if (f.b) pushBucket(compiled.redirBuckets, f); else compiled.redirGeneric.push(f);
    });
    compiled.cosGeneric = compiled.cosGeneric.concat(parsed.cosGeneric);
    compiled.cosGenericExcl = compiled.cosGenericExcl.concat(parsed.cosGenericExcl);
    Object.keys(parsed.cosSpecific).forEach(function (d) {
      compiled.cosSpecific[d] = (compiled.cosSpecific[d] || []).concat(parsed.cosSpecific[d]);
    });
    compiled.cosExcGeneric = compiled.cosExcGeneric.concat(parsed.cosExcGeneric);
    Object.keys(parsed.cosExcSpecific).forEach(function (d) {
      compiled.cosExcSpecific[d] = (compiled.cosExcSpecific[d] || []).concat(parsed.cosExcSpecific[d]);
    });
    compiled.jsGeneric = compiled.jsGeneric.concat(parsed.jsGeneric);
    compiled.jsGenericExcl = compiled.jsGenericExcl.concat(parsed.jsGenericExcl);
    Object.keys(parsed.jsSpecific).forEach(function (d) {
      compiled.jsSpecific[d] = (compiled.jsSpecific[d] || []).concat(parsed.jsSpecific[d]);
    });
    compiled.jsExc = compiled.jsExc.concat(parsed.jsExc);
    ['procedural', 'style', 'other'].forEach(function (k) { compiled.unsupported[k] += parsed.unsupported[k] || 0; });
    Object.keys(parsed.counts).forEach(function (k) { compiled.counts[k] = (compiled.counts[k] || 0) + parsed.counts[k]; });
    return compiled;
  }
  function mergeAll(parsedList) {
    var compiled = emptyCompiled();
    // cross-list badfilter cores
    var bad = {};
    parsedList.forEach(function (p) { p.badCores.forEach(function (c) { bad[c] = true; }); });
    parsedList.forEach(function (p) {
      var copy = Object.assign({}, p, {
        network: p.network.filter(function (f) { return !bad[f.p + '$' + (f.oraw || '')]; })
      });
      mergeParsedList(compiled, copy);
    });
    return compiled;
  }

  var DEFAULT_O = { t: [], nt: [], d: [], nd: [], tp: 0, imp: false, mc: false, other: [] };
  function filterMatches(f, req) {
    var o = Object.assign({}, DEFAULT_O, f.o || {});
    if (!f.r) f.r = patternToRegex(f.p);
    if (o.t.length && o.t.indexOf(req.type) === -1) return false;
    if (o.nt.length && o.nt.indexOf(req.type) !== -1) return false;
    if (o.d.length && !o.d.some(function (d) { return hostMatches(req.docHost, d); })) return false;
    if (o.nd.length && o.nd.some(function (d) { return hostMatches(req.docHost, d); })) return false;
    if (o.tp !== 0) {
      var tp = isThirdParty(req.host, req.docHost);
      if (o.tp === 1 && !tp) return false;
      if (o.tp === -1 && tp) return false;
    }
    if (!f._re) { try { f._re = new RegExp(f.r, o.mc ? '' : 'i'); } catch (e) { return false; } }
    return f._re.test(req.url);
  }
  function disp(f) { return f.p + (f.oraw ? '$' + f.oraw : ''); }
  // Compact a parsed list or compiled set for storage.local: drops the regex
  // (recomputed on load), the duplicated raw line, and default option fields.
  function stripFilter(f) {
    var o = f.o, co = null;
    if (o) {
      co = {};
      if (o.t && o.t.length) co.t = o.t;
      if (o.nt && o.nt.length) co.nt = o.nt;
      if (o.d && o.d.length) co.d = o.d;
      if (o.nd && o.nd.length) co.nd = o.nd;
      if (o.tp) co.tp = o.tp;
      if (o.imp) co.imp = true;
      if (o.mc) co.mc = true;
      if (o.redir) co.redir = o.redir;
      if (o.redirRule) co.redirRule = o.redirRule;
      if (o.other && o.other.length) co.other = o.other;
      if (!Object.keys(co).length) co = null;
    }
    var out = { p: f.p, l: f.l };
    if (f.oraw) out.oraw = f.oraw;
    if (co) out.o = co;
    if (f.b) out.b = f.b;
    if (f.pd) out.pd = f.pd;
    return out;
  }
  function stripForStorage(obj) {
    var copy = JSON.parse(JSON.stringify(obj, function (k, v) { return k === '_re' || k === 'r' || k === 'raw' ? undefined : v; }));
    function mapArr(a) { return (a || []).map(stripFilter); }
    if (copy.network) copy.network = mapArr(copy.network);
    if (copy.exceptions) copy.exceptions = mapArr(copy.exceptions);
    if (copy.generic) copy.generic = mapArr(copy.generic);
    if (copy.excGeneric) copy.excGeneric = mapArr(copy.excGeneric);
    if (copy.redirRules) copy.redirRules = mapArr(copy.redirRules);
    if (copy.redirGeneric) copy.redirGeneric = mapArr(copy.redirGeneric);
    ['buckets', 'excBuckets', 'redirBuckets'].forEach(function (bk) {
      if (copy[bk]) Object.keys(copy[bk]).forEach(function (d) { copy[bk][d] = mapArr(copy[bk][d]); });
    });
    return copy;
  }

  // v1.2.2: token index for generic (non-domain) filters. v1.2.1 and
  // earlier tested EVERY generic filter's regex against EVERY request
  // inside the synchronous blocking webRequest listener — with ten
  // lists compiled that's tens of thousands of regex tests per request
  // on a phone CPU, so the listener effectively never returned and
  // Orion silently dropped navigations ("like I never typed anything").
  // uBO solves this with a token index; so do we now: each generic
  // filter is indexed under its longest literal run (>= 4 chars), and a
  // request only tests filters whose token literally appears in the
  // URL, plus the small always-test set (patterns with regex syntax,
  // match-case filters, or no usable token).
  function filterToken(f) {
    if ((f.o || {}).mc) return null;
    var p = String(f.p || '').replace(/^\|+/, '');
    if (/[\\()[\]{}+?]/.test(p)) return null;
    var runs = p.split(/[^a-zA-Z0-9]+/).filter(function (w) { return w.length >= 4; });
    if (!runs.length) return null;
    runs.sort(function (a, b) { return b.length - a.length; });
    return runs[0].toLowerCase();
  }
  function buildTokenIndex(generic) {
    var byToken = {}, always = [];
    (generic || []).forEach(function (f) {
      var tok = filterToken(f);
      if (tok) { (byToken[tok] = byToken[tok] || []).push(f); } else always.push(f);
    });
    return { byToken: byToken, always: always };
  }
  function indexedGeneric(index, url) {
    var out = index.always.slice();
    var seen = {};
    String(url || '').toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
      if (w.length >= 4 && !seen[w]) {
        seen[w] = 1;
        var arr = index.byToken[w];
        if (arr) for (var i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    });
    return out;
  }
  function createMatcher(compiled) {
    var blockIdx = buildTokenIndex(compiled.generic);
    var excIdx = buildTokenIndex(compiled.excGeneric);
    var redirIdx = buildTokenIndex(compiled.redirGeneric || []);
    function candidates(buckets, genericSubset, host) {
      var out = [], seen = {};
      hostSuffixes(host).forEach(function (s) {
        (buckets[s] || []).forEach(function (f) { var k = f.p + '|' + (f.oraw || '') + '|' + f.l; if (!seen[k]) { seen[k] = 1; out.push(f); } });
      });
      return out.concat(genericSubset);
    }
    return {
      match: function (req) {
        req.type = mapType(req.type || 'other');
        var blockC = candidates(compiled.buckets, indexedGeneric(blockIdx, req.url), req.host);
        var excC = candidates(compiled.excBuckets, indexedGeneric(excIdx, req.url), req.host);
        var matched = null, important = null;
        for (var i = 0; i < blockC.length; i++) {
          if (filterMatches(blockC[i], req)) {
            if ((blockC[i].o || {}).imp) { important = blockC[i]; break; }
            matched = matched || blockC[i];
          }
        }
        function withRedirect(f) {
          var res = { blocked: true, filter: disp(f), list: f.l };
          // v1.2.1: lets the background layer guarantee a plain filter
          // can never block a top-level navigation — only a filter that
          // explicitly carries the $document type may do that.
          res.explicitDocument = !!((f.o || {}).t && f.o.t.indexOf('document') !== -1);
          res.bucketed = !!f.b; // v1.2.3: matched filter is domain-specific to this host
          res.important = !!(f.o || {}).imp;
          var own = (f.o || {}).redir;
          if (own) { res.redirect = own; return res; }
          var redirC = candidates(compiled.redirBuckets || {}, indexedGeneric(redirIdx, req.url), req.host);
          for (var k = 0; k < redirC.length; k++) {
            if (filterMatches(redirC[k], req) && (redirC[k].o || {}).redirRule) {
              res.redirect = redirC[k].o.redirRule; res.redirectRule = disp(redirC[k]);
              return res;
            }
          }
          return res;
        }
        if (important) { var ri = withRedirect(important); ri.important = true; return ri; }
        if (matched) {
          for (var j = 0; j < excC.length; j++) {
            if (filterMatches(excC[j], req)) return { blocked: false, filter: disp(matched), exception: disp(excC[j]), list: matched.l };
          }
          return withRedirect(matched);
        }
        return { blocked: false };
      }
    };
  }

  // selectors / scriptlets for a host
  function forHost(map, generic, genericExcl, host) {
    var out = generic.slice();
    (genericExcl || []).forEach(function (e) {
      if (!e.excl.some(function (d) { return hostMatches(host, d); })) out.push(e.v);
    });
    hostSuffixes(host).forEach(function (s) { if (map[s]) out = out.concat(map[s]); });
    return out;
  }
  function targetsRoot(sel) {
    // v1.2.1 insurance: a cosmetic whose target is the page root itself
    // (*, html, body, :root) would blank every page it touched.
    var t = String(sel).trim();
    if (t === '*' || t === 'html' || t === 'body' || t === ':root') return true;
    var parts = t.split(/[\s>+~]+/).filter(Boolean);
    var last = parts[parts.length - 1] || '';
    return last === 'html' || last === 'body' || last === '*' || last === ':root';
  }
  function cosmeticsFor(compiled, host) {
    var sels = forHost(compiled.cosSpecific, compiled.cosGeneric, compiled.cosGenericExcl, host);
    var exc = {};
    forHost(compiled.cosExcSpecific, compiled.cosExcGeneric, [], host).forEach(function (s) { exc[s] = 1; });
    return sels.filter(function (s) { return !exc[s] && !targetsRoot(s); });
  }
  function scriptletsFor(compiled, host) {
    var calls = forHost(compiled.jsSpecific, compiled.jsGeneric, compiled.jsGenericExcl, host);
    return calls.filter(function (c) {
      return !compiled.jsExc.some(function (e) {
        var parts = e.split('|');
        return (parts[0] === '' || hostMatches(host, parts[0])) && parts[1] === c.name;
      });
    });
  }

  // chunked-string helpers for storage.local (pure, unit-tested)
  function chunkString(str, size) {
    var out = [];
    for (var i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
    return out.length ? out : [''];
  }

  // v1.2.3: "same party" host test for the visuals guards — true when
  // two hosts are the same site family: equal, subdomain of each other,
  // same registrable domain, or CDN-style hosts whose registrable SLD
  // extends the site's SLD (github.com vs github.githubassets.com).
  var MULTI_SUFFIX = { 'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1, 'com.au': 1, 'co.jp': 1, 'com.br': 1, 'co.nz': 1, 'com.cn': 1, 'com.tw': 1, 'co.kr': 1, 'com.mx': 1, 'com.sg': 1, 'com.hk': 1, 'com.ar': 1, 'com.co': 1, 'com.pl': 1, 'com.tr': 1, 'com.ru': 1, 'com.ua': 1, 'com.vn': 1, 'com.ph': 1, 'com.my': 1, 'com.pe': 1, 'com.cl': 1, 'com.ve': 1 };
  function regDomainOf(h) {
    var p = String(h || '').toLowerCase().split('.').filter(Boolean);
    if (p.length <= 2) return p.join('.');
    var l2 = p.slice(-2).join('.');
    return MULTI_SUFFIX[l2] ? p.slice(-3).join('.') : l2;
  }
  // v1.2.4: platform party groups — big platforms serve their own media
  // from separately-branded domains (X videos live on twimg.com,
  // YouTube's on googlevideo.com). Those hosts are first-party in every
  // way that matters; a list rule against the shared domain otherwise
  // nukes every video on the platform.
  var PARTY_GROUPS = [
    ['x.com', 'twitter.com', 'twimg.com', 't.co'],
    ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com'],
    ['facebook.com', 'fbcdn.net', 'facebook.net'],
    ['instagram.com', 'cdninstagram.com', 'fbcdn.net'],
    ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'],
    ['twitch.tv', 'ttvnw.net', 'jtvnw.net'],
    ['spotify.com', 'scdn.co'],
    ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com'],
    ['amazon.com', 'media-amazon.com', 'images-amazon.com'],
    ['tiktok.com', 'tiktokcdn.com', 'muscdn.com']
  ];
  var PARTY_OF = {};
  PARTY_GROUPS.forEach(function (g, gi) { g.forEach(function (d) { PARTY_OF[d] = gi; }); });
  function samePartyHost(a, b) {
    a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
    if (!a || !b) return false;
    if (a === b || a.slice(-(b.length + 1)) === '.' + b || b.slice(-(a.length + 1)) === '.' + a) return true;
    var ra = regDomainOf(a), rb = regDomainOf(b);
    if (ra === rb) return true;
    if (PARTY_OF[ra] !== undefined && PARTY_OF[ra] === PARTY_OF[rb]) return true;
    var sa = ra.split('.')[0], sb = rb.split('.')[0];
    return !!(sa && sb && Math.min(sa.length, sb.length) >= 4 && (sa.indexOf(sb) === 0 || sb.indexOf(sa) === 0));
  }

  var api = {
    hostSuffixes: hostSuffixes, hostMatches: hostMatches, isThirdParty: isThirdParty,
    samePartyHost: samePartyHost, regDomainOf: regDomainOf,
    patternToRegex: patternToRegex, bucketKeyFor: bucketKeyFor, parseOptions: parseOptions,
    parseList: parseList, makeFilter: makeFilter, emptyCompiled: emptyCompiled,
    mergeParsedList: mergeParsedList, mergeAll: mergeAll, createMatcher: createMatcher,
    mapType: mapType, cosmeticsFor: cosmeticsFor, scriptletsFor: scriptletsFor,
    parseScriptletCall: parseScriptletCall, chunkString: chunkString,
    stripForStorage: stripForStorage, disp: disp,
    isProceduralSelector: isProceduralSelector, targetsRoot: targetsRoot
  };
  root.UBOEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
