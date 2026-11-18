'use strict';
/* Popup Blocker for Orion — background (v1.0.0)
 * One job: open a blocked popup's URL in a real tab when the user
 * taps Open in the panel. tabs.create is extension-privileged, so
 * no popup blocker (including this one) can stop it. If Orion's
 * tabs API is unavailable, reply {ok:false} and content.js falls
 * back to the page hook's one-time native open.
 */
(function () {
  var api = null;
  try { if (typeof browser !== 'undefined') api = browser; } catch (e) {}
  if (!api) { try { if (typeof chrome !== 'undefined') api = chrome; } catch (e) {} }
  if (!api || !api.runtime || !api.runtime.onMessage) return;

  api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'opb-open-tab' || !msg.url) return undefined;
    try {
      var p = new URL(msg.url);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') {
        if (sendResponse) sendResponse({ ok: false, error: 'scheme' });
        return undefined;
      }
    } catch (e) {
      if (sendResponse) sendResponse({ ok: false, error: 'bad-url' });
      return undefined;
    }
    try {
      var result = api.tabs.create({ url: msg.url, active: true });
      if (result && typeof result.then === 'function') {
        return result.then(
          function () { return { ok: true }; },
          function (err) { return { ok: false, error: String(err && err.message || err) }; }
        );
      }
      if (sendResponse) sendResponse({ ok: true });
    } catch (err) {
      if (sendResponse) sendResponse({ ok: false, error: String(err && err.message || err) });
    }
    return undefined;
  });
})();
