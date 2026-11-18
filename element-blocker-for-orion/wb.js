/* wb.js — Wall Breaker scoring. Pure: takes a plain info object about
 * an element and decides whether it is an anti-adblock wall.
 * Conservative by design — a false positive hides real content, so a
 * candidate needs size AND ad-specific language (or a known wall
 * iframe source). */
(function (global) {
  'use strict';

  var KNOWN_SRC = ['error-report.com', 'getadmiral.com', 'admiral.digital', 'fuckadblock', 'blockadblock'];
  var STRONG = ['allow ads to continue', 'please allow ads', 'allow ads on this site',
    'disable your adblock', 'disable your ad blocker', 'turn off your adblock',
    'turn off your ad blocker', 'adblock detected', 'ad blocker detected',
    'using an adblocker', 'using an ad blocker', 'whitelist this site', 'allowlist this site'];
  var WEAK = ['adblock', 'ad blocker', 'ad-blocker', 'allow ads', 'whitelist', 'allowlist',
    'disable adblock', 'pause your ad', 'ads help keep', 'supported by ads'];

  function phraseHits(text, list) {
    var t = String(text || '').toLowerCase();
    return list.filter(function (p) { return t.indexOf(p) !== -1; });
  }

  function knownSrc(src) {
    if (!src) return '';
    var s = String(src).toLowerCase();
    for (var i = 0; i < KNOWN_SRC.length; i++) {
      if (s.indexOf(KNOWN_SRC[i]) !== -1) return KNOWN_SRC[i];
    }
    return '';
  }

  /* info: { tag, src, coverPct (0..100 of viewport area), positioned
   * (bool: fixed/absolute/dialog), text, textLen } */
  function wallScore(info) {
    var reasons = [];
    var strong = phraseHits(info.text, STRONG);
    var weak = phraseHits(info.text, WEAK);
    var ks = info.tag === 'iframe' ? knownSrc(info.src) : '';
    if (ks) reasons.push('known wall iframe src: ' + ks);
    if (strong.length) reasons.push('strong phrase: ' + strong.join(' | '));
    if (weak.length >= 2) reasons.push('weak phrases x' + weak.length + ': ' + weak.join(' | '));
    reasons.push('cover=' + Math.round(info.coverPct || 0) + '% positioned=' + !!info.positioned +
      ' textLen=' + (info.textLen || 0));

    var wall = false;
    // Known wall iframe stretched over a large part of the screen.
    if (ks && (info.coverPct || 0) >= 40) wall = true;
    // Full-screen positioned container with ad-specific language and
    // wall-sized (short) text — not a full article page.
    if (!wall && info.positioned && (info.coverPct || 0) >= 85 && (info.textLen || 0) <= 1500) {
      if (strong.length >= 1) wall = true;
      else if (weak.length >= 2) wall = true;
    }
    // Same, slightly smaller coverage, but a strong phrase is decisive.
    if (!wall && info.positioned && (info.coverPct || 0) >= 70 && (info.textLen || 0) <= 900 && strong.length >= 1) {
      wall = true;
    }
    return { wall: wall, strong: strong, weak: weak, knownSrc: ks, reasons: reasons };
  }

  /* CSS that pre-hides known wall iframes before any JS scan runs. */
  var PREHIDE_CSS =
    'iframe[src*="error-report.com"],iframe[src*="getadmiral.com"],iframe[src*="admiral.digital"]' +
    '{display:none !important;}';

  /* The blank-page fallback: once the wall, dialog and redirect are
   * all dead, the script covers the article with an opaque,
   * textless, full-screen veil (or the article is found under one).
   * Only ever applied on pages already proven hostile. */
  function isVeil(info) {
    return !!info.positioned && (info.coverPct || 0) >= 92 &&
      (info.textLen || 0) <= 20 && !info.hasInteractive && !!info.bgOpaque;
  }

  /* Blank decision, pure: given the page's current state and the
   * snapshot, what should the anti-blank watchdog do? Restore while
   * restores are cheap; escalate to the sanctuary when the wiper
   * keeps winning. */
  function blankVerdict(s) {
    if (!s.snapText) return 'none';
    var blanked = !s.hasBody || s.bodyChildren === 0 ||
      (s.curText || 0) < Math.max(200, s.snapText * 0.08);
    if (!blanked) return 'none';
    return (s.restores || 0) < 2 ? 'restore' : 'sanctuary';
  }

  global.EBWall = {
    wallScore: wallScore,
    isVeil: isVeil,
    blankVerdict: blankVerdict,
    phraseHits: phraseHits,
    knownSrc: knownSrc,
    PREHIDE_CSS: PREHIDE_CSS,
    STRONG: STRONG, WEAK: WEAK, KNOWN_SRC: KNOWN_SRC
  };
})(typeof window !== 'undefined' ? window : globalThis);
