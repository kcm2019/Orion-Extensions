/* uBlock for Orion — $redirect stub resources (K anti-detect pack).
 * When a filter says $redirect=<name>, the request is not cancelled: it is
 * answered with one of these inert stand-ins, so the page's own code (very
 * often an ad-block detector) loads something, runs it, and concludes
 * there is no blocker. Stubs are served as data: URLs by the background
 * layer, and as synthetic responses by the page-world fallback for
 * fetch/XHR. Functional equivalents of uBO's resourcelets, written for
 * this extension.
 */
(function (root) {
  'use strict';

  var NOOP_JS = '/* uBlock for Orion: noop */\n';
  var NOOP_CSS = '/* uBlock for Orion: noop */\n';
  var NOOP_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

  var FUCKADBLOCK_JS = [
    '(function(window){',
    'if (window.FuckAdBlock) return;',
    'function FuckAdBlock(options){',
    '  this._options = { checkOnLoad:true, resetOnEnd:true, loopCheckTime:50, loopMaxNumber:5,',
    '    baitClass:"pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links",',
    '    baitStyle:"width:1px !important;height:1px !important;position:absolute !important;left:-10000px !important;top:-1000px !important;", debug:false };',
    '  this._var = { version:"3.2.1", bait:null, checking:false, loop:null, loopNumber:0, event:{ detected:[], notDetected:[] } };',
    '  if (options) this.setOption(options);',
    '  var self=this;',
    '  if (this._options.checkOnLoad) setTimeout(function(){ self.check(); }, 1);',
    '}',
    'FuckAdBlock.prototype.setOption = function(options, value){',
    '  if (value !== undefined) { this._options[options] = value; return this; }',
    '  for (var k in options) this._options[k] = options[k];',
    '  return this;',
    '};',
    'FuckAdBlock.prototype.getOption = function(key){ return key ? this._options[key] : this._options; };',
    'FuckAdBlock.prototype.on = function(detected, fn){ return detected ? this.onDetected(fn) : this.onNotDetected(fn); };',
    'FuckAdBlock.prototype.onDetected = function(fn){ if (typeof fn === "function") this._var.event.detected.push(fn); return this; };',
    'FuckAdBlock.prototype.onNotDetected = function(fn){ if (typeof fn === "function") this._var.event.notDetected.push(fn); return this; };',
    'FuckAdBlock.prototype.check = function(){',
    '  var self=this;',
    '  setTimeout(function(){',
    '    self._var.event.notDetected.forEach(function(fn){ try { fn(); } catch(e){} });',
    '    if (self._options.resetOnEnd) self._var.event.detected = []; ',
    '  }, 1);',
    '  return true;',
    '};',
    'window.FuckAdBlock = FuckAdBlock;',
    'window.fuckAdBlock = new FuckAdBlock();',
    '})(window);'
  ].join('\n');

  var ADSBYGOOGLE_JS = [
    '(function(){',
    'var a = window.adsbygoogle = window.adsbygoogle || [];',
    'a.loaded = true;',
    'if (!a._uboStub) { a._uboStub = true; a.push = function(){ return a.length; }; }',
    '})();'
  ].join('\n');

  var GOOGLE_IMA_JS = [
    '(function(){',
    'var g = window.google = window.google || {};',
    'if (g.ima && g.ima._uboStub) return;',
    'function Evt(type){ this.type = type; }',
    'function AdsManager(){ }',
    'AdsManager.prototype.addEventListener = function(){};',
    'AdsManager.prototype.init = function(){};',
    'AdsManager.prototype.start = function(){};',
    'AdsManager.prototype.resume = function(){};',
    'AdsManager.prototype.pause = function(){};',
    'AdsManager.prototype.resize = function(){};',
    'AdsManager.prototype.destroy = function(){};',
    'AdsManager.prototype.setVolume = function(){};',
    'AdsManager.prototype.getVolume = function(){ return 0; };',
    'AdsManager.prototype.getRemainingTime = function(){ return 0; };',
    'AdsManager.prototype.isCustomPlaybackUsed = function(){ return false; };',
    'function AdsLoader(container){ this._c = container; }',
    'AdsLoader.prototype.addEventListener = function(){};',
    'AdsLoader.prototype.requestAds = function(){};',
    'AdsLoader.prototype.getSettings = function(){ return new ImaSdkSettings(); };',
    'AdsLoader.prototype.contentComplete = function(){};',
    'AdsLoader.prototype.destroy = function(){};',
    'function ImaSdkSettings(){ }',
    'ImaSdkSettings.prototype.setAutoPlayAdBreaks = function(){};',
    'ImaSdkSettings.prototype.setLocale = function(){};',
    'ImaSdkSettings.prototype.setNumRedirects = function(){};',
    'ImaSdkSettings.prototype.setPlayerType = function(){};',
    'ImaSdkSettings.prototype.setPlayerVersion = function(){};',
    'ImaSdkSettings.prototype.setVpaidMode = function(){};',
    'ImaSdkSettings.prototype.setDisableCustomPlaybackForIOS10Plus = function(){};',
    'function AdDisplayContainer(el, video){ this._el = el; }',
    'AdDisplayContainer.prototype.initialize = function(){};',
    'AdDisplayContainer.prototype.destroy = function(){};',
    'g.ima = {',
    '  _uboStub: true,',
    '  AdDisplayContainer: AdDisplayContainer,',
    '  AdsLoader: AdsLoader,',
    '  AdsManager: AdsManager,',
    '  AdsRequest: function(){},',
    '  ImaSdkSettings: ImaSdkSettings,',
    '  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "adsManagerLoaded" } },',
    '  AdErrorEvent: { Type: { AD_ERROR: "adError" } },',
    '  AdEvent: { Type: { LOADED:"loaded", STARTED:"started", COMPLETE:"complete", SKIPPED:"skipped",',
    '    CONTENT_PAUSE_REQUESTED:"contentPauseRequested", CONTENT_RESUME_REQUESTED:"contentResumeRequested",',
    '    ALL_ADS_COMPLETED:"allAdsCompleted", AD_PROGRESS:"adProgress", AD_BUFFERING:"adBuffering" } },',
    '  ViewMode: { NORMAL: "normal", FULLSCREEN: "fullscreen" },',
    '  settings: new ImaSdkSettings()',
    '};',
    'g.ima.settings = new ImaSdkSettings();',
    '})();'
  ].join('\n');

  var VAST_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<VAST version="2.0"></VAST>';

  var STUBS = {
    'noopjs':    { mime: 'text/javascript', text: NOOP_JS },
    'noopcss':   { mime: 'text/css', text: NOOP_CSS },
    'nooptext':  { mime: 'text/plain', text: '' },
    'noopframe': { mime: 'text/html', text: NOOP_HTML },
    'fuckadblock': { mime: 'text/javascript', text: FUCKADBLOCK_JS },
    'adsbygoogle': { mime: 'text/javascript', text: ADSBYGOOGLE_JS },
    'google-ima':  { mime: 'text/javascript', text: GOOGLE_IMA_JS },
    'noopvast':  { mime: 'text/xml', text: VAST_XML }
  };

  // Map a $redirect resource name (+ request type) to a stub key.
  function resolveKey(name, type) {
    if (!name) return null;
    var n = String(name).toLowerCase();
    if (n === 'noopjs' || n === 'noop.js' || n === 'noop') return 'noopjs';
    if (n === 'noopcss' || n === 'noop.css') return 'noopcss';
    if (n === 'nooptext' || n === 'noop.txt' || n === 'empty.txt') return 'nooptext';
    if (n === 'noopframe' || n === 'noop.html' || n === 'click2load.html') return 'noopframe';
    if (n.indexOf('fuckadblock') === 0) return 'fuckadblock';
    if (n.indexOf('adsbygoogle') === 0) return 'adsbygoogle';
    if (n.indexOf('google-ima') === 0) return 'google-ima';
    if (n.indexOf('noopvast') === 0) return 'noopvast';
    if (n === 'empty') {
      if (type === 'script') return 'noopjs';
      if (type === 'stylesheet') return 'noopcss';
      if (type === 'sub_frame' || type === 'subdocument') return 'noopframe';
      return 'nooptext';
    }
    return null;
  }
  function stubFor(name, type) {
    var key = resolveKey(name, type);
    if (!key) return null;
    var s = STUBS[key];
    return { key: key, mime: s.mime, text: s.text };
  }
  function dataUrl(name, type) {
    var s = stubFor(name, type);
    if (!s) return null;
    return 'data:' + s.mime + ';charset=utf-8,' + encodeURIComponent(s.text);
  }

  var api = { STUBS: STUBS, resolveKey: resolveKey, stubFor: stubFor, dataUrl: dataUrl };
  root.UBOResources = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
