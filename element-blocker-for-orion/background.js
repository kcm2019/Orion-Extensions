/* background.js — minimal. No popup: browser_action popups don't
 * render on Kurt's Orion, and a default_popup would suppress
 * onClicked.
 *
 * v1.1.0: there is no in-page pill. Toolbar icon click does NOT open
 * a webpage — it messages the active tab's content script, which
 * pops the menu up over the current site (Hide an element…, Zap…,
 * Show hidden, Undo, Manage all rules). From "Hide an element…" the
 * picker lets an element be tapped and hidden. Clicking the icon
 * again closes the menu/picker. The manager tab is reachable only
 * from that menu, via the eb-open-manager message. */
(function () {
  'use strict';

  var CONTENT_FILES = ['selector.js', 'rules.js', 'dissolve.js', 'wb.js', 'content.js'];

  /* v1.6.0 — redirect cancellation at the network layer. When the
   * wall script gives up on overlays/dialogs it navigates the tab to
   * the standalone wall page (error-report / Admiral hosts). No page
   * JS can reliably stop a navigation (location.href is
   * unforgeable), but a blocking webRequest listener can: cancel any
   * main-frame or sub-frame load to a wall host and the tab simply
   * stays where it is. Covers JS redirects AND server 302s. */
  (function blockWallNavigations() {
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

  function openManager() {
    var url = browser.runtime.getURL('manager.html');
    if (browser.tabs && browser.tabs.create) {
      browser.tabs.create({ url: url });
    } else if (browser.runtime.openOptionsPage) {
      browser.runtime.openOptionsPage();
    }
  }

  function sendToggle(tabId) {
    return browser.tabs.sendMessage(tabId, { type: 'eb-toggle-menu' });
  }

  function injectThenToggle(tabId) {
    // Content script missing (page loaded before install, or a page the
    // script didn't run on): inject the files in order, then retry once.
    var chain = Promise.resolve();
    CONTENT_FILES.forEach(function (f) {
      chain = chain.then(function () {
        return browser.tabs.executeScript(tabId, { file: f, runAt: 'document_idle' });
      });
    });
    return chain.then(function () { return sendToggle(tabId); });
  }

  function onIconClick() {
    if (!browser.tabs || !browser.tabs.query) return;
    browser.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      sendToggle(tab.id).catch(function () {
        injectThenToggle(tab.id).catch(function () {
          /* Non-injectable page (about:, extension pages, Orion UI):
           * nothing can be shown over it. */
        });
      });
    });
  }

  if (browser.browserAction && browser.browserAction.onClicked) {
    browser.browserAction.onClicked.addListener(onIconClick);
  }
  if (browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'eb-open-manager') openManager();
    });
  }
})();
