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
