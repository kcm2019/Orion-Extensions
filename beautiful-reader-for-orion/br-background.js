/* br-background.js — Beautiful Reader v1.10.0. Exists for one job:
 * cancel forced navigations to anti-adblock wall hosts
 * (error-report.com / getadmiral.com / admiral.digital) at the
 * network layer, so when a wall script gives up on overlays and
 * dialogs and tries to send the tab to the standalone wall page,
 * the tab simply stays on the article. Covers JS redirects and
 * server 302s. Defensive: if webRequest is unavailable, nothing
 * else in the extension depends on this file. */
(function () {
  'use strict';
  // Link taps inside the reader ask the background to
  // open a real tab (v1.20.1): a content script's
  // window.open from a top-layer popover is unreliable
  // on Orion, while tabs.create is the extension's own
  // door and answers to no popup rules. Independent of
  // the webRequest setup below — either can work alone.
  try {
    var rtApi = null;
    try { if (typeof browser !== 'undefined' && browser.runtime && browser.tabs) rtApi = browser; } catch (e) {}
    if (!rtApi) { try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs) rtApi = chrome; } catch (e) {} }
    if (rtApi && rtApi.runtime.onMessage) {
      rtApi.runtime.onMessage.addListener(function (msg) {
        if (msg && msg.type === 'br:openTab' && /^https?:\/\//i.test(msg.url || '')) {
          try {
            var tp = rtApi.tabs.create({ url: msg.url });
            if (tp && tp.then) return tp.then(function () { return { ok: true }; }, function () { return { ok: false }; });
            return { ok: true };
          } catch (e) { return { ok: false }; }
        }
        return undefined;
      });
    }
  } catch (e) {}
  var api = null;
  try { if (typeof browser !== 'undefined' && browser.webRequest) api = browser; } catch (e) {}
  if (!api) { try { if (typeof chrome !== 'undefined' && chrome.webRequest) api = chrome; } catch (e) {} }
  if (!api) return;
  var urls = ['*://*.error-report.com/*', '*://*.getadmiral.com/*', '*://*.admiral.digital/*'];
  try {
    api.webRequest.onBeforeRequest.addListener(function (details) {
      return { cancel: true };
    }, { urls: urls, types: ['main_frame', 'sub_frame'] }, ['blocking']);
  } catch (e) {}
})();
