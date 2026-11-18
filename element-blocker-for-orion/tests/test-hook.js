/* Page-hook behavior test: wall dialogs are suppressed, legit ones
 * pass through, reload-after-dialog is swallowed, wall redirects are
 * blocked. Runs page-hook.js in a vm with a fake window. */
'use strict';
const fs = require('fs');
const vm = require('vm');
let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log('FAIL: ' + n); } }

const calls = { confirm: 0, alert: 0, prompt: 0, reload: 0, assign: 0 };
const posted = [];
function FakeLocation() {}
FakeLocation.prototype.reload = function () { calls.reload++; };
FakeLocation.prototype.assign = function () { calls.assign++; };
FakeLocation.prototype.replace = function () { calls.assign++; };

let hrefVal = 'https://www.gamesradar.com/article';
Object.defineProperty(FakeLocation.prototype, 'href', {
  configurable: true,
  get: function () { return hrefVal; },
  set: function (v) { hrefVal = v; calls.hrefSet = (calls.hrefSet || 0) + 1; }
});

const win = {
  confirm: function () { calls.confirm++; return true; },
  alert: function () { calls.alert++; },
  prompt: function () { calls.prompt++; return 'typed'; },
  postMessage: function (data) { posted.push(data); },
  location: new FakeLocation(),
};
win.window = win;
const sandbox = { window: win, console, Error, Date, Object, String };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../page-hook.js', 'utf8'), sandbox, { filename: 'page-hook.js' });

// Legit dialogs pass through untouched.
ok(win.confirm('Delete this photo?') === true && calls.confirm === 1, 'legit confirm reaches browser UI');
win.alert('Saved.');
ok(calls.alert === 1, 'legit alert reaches browser UI');
ok(win.prompt('Your name?') === 'typed' && calls.prompt === 1, 'legit prompt reaches browser UI');

// Wall confirm throws (neither OK-redirect nor Cancel-reload branch runs).
let threw = false;
try { win.confirm('Please allow ads on this site. Click OK to learn more.'); } catch (e) { threw = /wall dialog suppressed/.test(e.message); }
ok(threw, 'wall confirm throws to abort the caller script');
ok(calls.confirm === 1, 'wall confirm never reached the browser UI');

// Wall alert is silently swallowed.
win.alert('Adblock detected — please allow ads');
ok(calls.alert === 1, 'wall alert never reached the browser UI');

// Reload shortly after a suppressed dialog is swallowed; later reloads work.
win.location.reload();
ok(calls.reload === 0, 'location.reload swallowed within 15s of suppressed dialog');
win.__ebWallDialogAt = Date.now() - 20000;
win.location.reload();
ok(calls.reload === 1, 'location.reload works again after the guard window');

// Redirect to a wall host is blocked; normal navigation is not.
win.location.assign('https://report.error-report.com/engage');
ok(calls.assign === 0, 'redirect to error-report.com blocked');
win.location.assign('https://www.gamesradar.com/news/');
ok(calls.assign === 1, 'normal assign passes through');

// Forced redirect via the href setter is trapped; normal href works.
win.location.href = 'https://report.error-report.com/engage?x=1';
ok(hrefVal === 'https://www.gamesradar.com/article' && !calls.hrefSet, 'location.href redirect to wall host blocked');
win.location.href = 'https://www.gamesradar.com/other/';
ok(hrefVal === 'https://www.gamesradar.com/other/' && calls.hrefSet === 1, 'normal location.href passes through');

ok(posted.some(p => p.__eb === 'hook' && /page hook installed/.test(p.msg)), 'hook reported its install + patches');
ok(posted.some(p => /location patches: .*href/.test(p.msg)), 'href trap installed: ' + (posted.find(p => /location patches/.test(p.msg)) || {}).msg);
ok(posted.filter(p => p.__eb === 'dialog').length >= 3, 'suppressions were reported for the log (' + posted.filter(p => p.__eb === 'dialog').length + ')');
ok(typeof win.__ebHook.isWallDialog === 'function' && win.__ebHook.isWallDialog('TURN OFF YOUR ADBLOCKER') === 'adblock', 'matcher is case-insensitive');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
