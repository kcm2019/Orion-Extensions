/* selector.js — pure selector + fingerprint logic. Shared by content.js
 * and the node test suites. Works on real DOM elements and on the fake
 * element objects in tests (tagName, id, classList|className,
 * parentElement, children, getAttribute, textContent). */
(function (global) {
  'use strict';

  var UNSTABLE_ID = /(\d{4,}|[a-f0-9]{8,}|uuid|random|timestamp)/i;
  var UNSTABLE_CLASS = /^([a-z]{1,3}\d|css-[a-z0-9]{5,}|[a-f0-9]{6,}|sc-[a-zA-Z0-9]{5,}|jsx-\d|__|.*\d{5,}.*)$/;
  var STATE_CLASSES = /^(active|open|opened|closed|hidden|visible|show|shown|selected|focused|hover|expanded|collapsed|is-|has-)/;

  function isStableId(id) {
    if (!id || typeof id !== 'string') return false;
    if (id.length > 40 || /\s/.test(id)) return false;
    if (!/^[A-Za-z][\w\-:.]*$/.test(id)) return false;
    if (UNSTABLE_ID.test(id)) return false;
    return true;
  }

  function classArray(el) {
    if (!el) return [];
    if (el.classList && typeof el.classList.length === 'number') {
      var out = [];
      for (var i = 0; i < el.classList.length; i++) out.push(el.classList[i]);
      return out;
    }
    if (typeof el.className === 'string') return el.className.split(/\s+/).filter(Boolean);
    return [];
  }

  function stableClasses(el) {
    return classArray(el).filter(function (c) {
      if (!c || c.length > 48) return false;
      if (UNSTABLE_CLASS.test(c)) return false;
      if (STATE_CLASSES.test(c)) return false;
      return /^[A-Za-z][\w-]*$/.test(c);
    });
  }

  function cssEscape(s) {
    if (global.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/([^A-Za-z0-9_-])/g, '\\$1');
  }

  function nthOfType(el) {
    var parent = el.parentElement;
    if (!parent || !parent.children) return 1;
    var n = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === el.tagName) n++;
      if (parent.children[i] === el) return n;
    }
    return n || 1;
  }

  function sameTagSiblingCount(el) {
    var parent = el.parentElement;
    if (!parent || !parent.children) return 1;
    var n = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === el.tagName) n++;
    }
    return n;
  }

  function segment(el) {
    var tag = String(el.tagName || '').toLowerCase();
    if (isStableId(el.id)) return tag + '#' + cssEscape(el.id);
    var classes = stableClasses(el).slice(0, 3);
    var seg = tag;
    if (classes.length) seg += '.' + classes.map(cssEscape).join('.');
    // nth-of-type only when needed to disambiguate among same-tag siblings
    if (!classes.length || sameTagSiblingCount(el) > 1) {
      // keep it when there are no classes at all, or when a same-tag
      // sibling shares the first class (cheap heuristic: always keep if
      // multiple same-tag siblings and no id)
      if (!classes.length || sameTagSiblingCount(el) > 1) {
        seg += ':nth-of-type(' + nthOfType(el) + ')';
      }
    }
    return seg;
  }

  function ancestors(el, stopAtBody) {
    var chain = [];
    var node = el;
    while (node && node.tagName && node.tagName !== 'HTML') {
      chain.push(node);
      if (stopAtBody !== false && node.tagName === 'BODY') break;
      node = node.parentElement;
    }
    return chain; // [el, parent, grandparent, ...]
  }

  function generateSelector(el, doc) {
    if (!el || !el.tagName) return '';
    var chain = ancestors(el);
    var parts = [];
    var start = 0;
    // If any ancestor (incl. self) has a stable id, start there: shortest path.
    for (var i = 0; i < chain.length; i++) {
      if (isStableId(chain[i].id)) { start = i; break; }
    }
    var slice = chain.slice(0, start + 1).reverse();
    // If no stable id found, slice is the whole chain reversed minus html.
    if (start === 0 && !isStableId(chain[0].id)) slice = chain.slice().reverse();
    parts = slice.map(segment);
    var sel = parts.join(' > ');
    if (doc && doc.querySelectorAll) {
      var tries = 0;
      while (tries < 6) {
        var found;
        try { found = doc.querySelectorAll(sel); } catch (e) { break; }
        if (found.length === 1 && found[0] === el) break;
        if (found.length <= 1) break;
        // Strengthen: rebuild with nth-of-type forced on every segment.
        parts = slice.map(function (node) {
          var base = segment(node);
          if (base.indexOf('#') !== -1) return base;
          if (base.indexOf(':nth-of-type') === -1) base += ':nth-of-type(' + nthOfType(node) + ')';
          return base;
        });
        var stronger = parts.join(' > ');
        if (stronger === sel) break;
        sel = stronger;
        tries++;
      }
    }
    return sel;
  }

  function normalizeText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100);
  }

  var DATA_ATTRS = ['data-testid', 'data-test-id', 'data-id', 'data-component', 'data-role', 'data-type', 'data-name'];

  function makeFingerprint(el, opts) {
    opts = opts || {};
    var fp = {
      tag: String(el.tagName || '').toLowerCase(),
      id: isStableId(el.id) ? el.id : '',
      classes: stableClasses(el).sort(),
      text: normalizeText(el.textContent || ''),
      aria: (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt'))) || '',
      role: (el.getAttribute && el.getAttribute('role')) || '',
      data: {},
      pos: opts.position || '',
      wPct: opts.wPct || 0,
      hPct: opts.hPct || 0
    };
    if (el.getAttribute) {
      DATA_ATTRS.forEach(function (a) {
        var v = el.getAttribute(a);
        if (v && v.length <= 60) fp.data[a] = v;
      });
    }
    return fp;
  }

  /* Score a live candidate (built with makeFingerprint) against a saved
   * fingerprint. Returns 0..100. Tag must match for any score. */
  function fingerprintScore(saved, cand) {
    if (!saved || !cand || saved.tag !== cand.tag) return 0;
    var score = 20;
    var strong = false;
    if (saved.id && cand.id) {
      if (saved.id === cand.id) { score += 50; strong = true; } else return 0;
    }
    var savedData = saved.data || {}, candData = cand.data || {};
    Object.keys(savedData).forEach(function (k) {
      if (candData[k] && candData[k] === savedData[k]) { score += 30; strong = true; }
    });
    if (saved.text && cand.text) {
      if (saved.text === cand.text) { score += 30; strong = true; }
      else if (saved.text.length >= 12 && cand.text.indexOf(saved.text.slice(0, 40)) !== -1) { score += 15; strong = true; }
    }
    if (saved.aria && cand.aria && saved.aria === cand.aria) { score += 20; strong = true; }
    if (saved.classes && cand.classes) {
      var overlap = saved.classes.filter(function (c) { return cand.classes.indexOf(c) !== -1; });
      if (saved.classes.length) score += Math.round(20 * (overlap.length / saved.classes.length));
      if (overlap.length >= 2) strong = true;
    }
    if (saved.pos && cand.pos && saved.pos === cand.pos && saved.pos !== 'static') score += 10;
    if (saved.wPct && cand.wPct && Math.abs(saved.wPct - cand.wPct) <= 15) score += 5;
    if (saved.hPct && cand.hPct && Math.abs(saved.hPct - cand.hPct) <= 15) score += 5;
    if (!strong) return Math.min(score, 54); // never match on weak signals alone
    return Math.min(score, 100);
  }

  var MATCH_THRESHOLD = 55;

  global.EBSelector = {
    isStableId: isStableId,
    stableClasses: stableClasses,
    generateSelector: generateSelector,
    ancestors: ancestors,
    makeFingerprint: makeFingerprint,
    fingerprintScore: fingerprintScore,
    normalizeText: normalizeText,
    MATCH_THRESHOLD: MATCH_THRESHOLD
  };
})(typeof window !== 'undefined' ? window : globalThis);
