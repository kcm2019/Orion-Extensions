/* HeckYeah for Orion — startup update check (bg-update.js).
 * runtime.onStartup fires once per browser launch: run a FORCED
 * update check then, so a new version is discovered at startup
 * instead of up to 12 h later. The result lands in extension
 * storage; the app-view and popup banners read it from there as
 * usual. This page does nothing else and holds no state.
 * Honest limit: if Orion never delivers onStartup to a
 * non-persistent background page, the surfaces' own throttled
 * auto-check remains the backstop — nothing depends on this. */
(function () {
  'use strict';
  try {
    var api = null;
    try { if (typeof browser !== 'undefined' && browser) api = browser; } catch (e) {}
    if (!api) { try { if (typeof chrome !== 'undefined' && chrome) api = chrome; } catch (e) {} }
    if (api && api.runtime && api.runtime.onStartup && typeof api.runtime.onStartup.addListener === 'function') {
      api.runtime.onStartup.addListener(function () {
        try {
          var U = (typeof window !== 'undefined' && window.HYOUpdate) || null;
          if (U) U.checkNow(true);
        } catch (e) {}
      });
    }
  } catch (e) {}
})();
