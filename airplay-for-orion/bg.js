/* AirPlay for Orion — background script: ICON CLICKS ONLY.
 *
 * v0.2.0 shipped a browser_action default_popup; on Kurt's Orion
 * the icon tap showed NOTHING (on-device verdict, Nov 16) — the
 * popup surface does not render there. So 0.2.1 removes the popup
 * (a default_popup also suppresses onClicked in WebExtension
 * semantics) and routes the click to a surface that is proven on
 * his device: the in-page panel.
 *
 * This script deliberately does NOT host the pairing session —
 * HeckYeah 0.6.0 proved a background host never connects on Orion.
 * All it does on a click:
 *   1. stamps the shared store (lastIconClick + openPanelAt) — the
 *      panel prints the stamp, so a dead link in this chain names
 *      itself on the next test instead of failing silently;
 *   2. messages the clicked tab's content script to open the panel;
 *   3. if that message can't be delivered (no content script on
 *      this page), opens a fresh tab — its content script sees the
 *      fresh openPanelAt stamp at boot and opens the panel itself.
 */
(function () {
  'use strict';
  var A = window.APO;
  if (!A) return;

  function tabsApi() {
    try { if (typeof browser !== 'undefined' && browser.tabs) return browser.tabs; } catch (e) {}
    try { if (typeof chrome !== 'undefined' && chrome.tabs) return chrome.tabs; } catch (e) {}
    return null;
  }
  function stampAndFlag() {
    return A.loadStore().then(function (s) {
      s.lastIconClick = Date.now();
      s.openPanelAt = Date.now();
      return A.saveStore(s);
    });
  }
  function sendOpen(tabId) {
    var tabs = tabsApi();
    if (!tabs || tabId == null) return Promise.resolve(false);
    try {
      var r = tabs.sendMessage(tabId, { __apo: 'open-panel' });
      if (r && r.then) return r.then(function () { return true; }, function () { return false; });
      return new Promise(function (resolve) {
        tabs.sendMessage(tabId, { __apo: 'open-panel' }, function () {
          var bad = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
          resolve(!bad);
        });
      });
    } catch (e) { return Promise.resolve(false); }
  }
  function openFallbackTab() {
    var tabs = tabsApi();
    if (!tabs) return;
    try {
      var r = tabs.create({ url: A.CARRIER });
      if (r && r.catch) r.catch(function () {});
    } catch (e) {}
  }
  function onIconClicked(tab) {
    stampAndFlag().then(function () {
      if (tab && tab.id != null) {
        sendOpen(tab.id).then(function (ok) { if (!ok) openFallbackTab(); });
      } else {
        openFallbackTab();
      }
    });
  }
  try {
    if (typeof browser !== 'undefined' && browser.browserAction && browser.browserAction.onClicked) {
      browser.browserAction.onClicked.addListener(onIconClicked);
    } else if (typeof chrome !== 'undefined' && chrome.browserAction && chrome.browserAction.onClicked) {
      chrome.browserAction.onClicked.addListener(onIconClicked);
    }
  } catch (e) {}
})();
