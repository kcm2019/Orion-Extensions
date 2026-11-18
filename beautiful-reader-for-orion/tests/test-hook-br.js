/* Page-hook behavior test: wall dialogs are suppressed, legit ones
 * pass through, reload-after-dialog is swallowed, wall redirects are
 * blocked. Runs br-page-hook.js in a vm with a fake window. */
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
// Browser-like timers (integer ids, one shared pool) + event
// capture, so the v1.13.0 kill command can be exercised.
let nextId = 1; const handles = {}; const listeners = {};
win.setTimeout = function (fn, ms) { const id = nextId++; handles[id] = setTimeout(fn, ms); return id; };
win.clearTimeout = function (id) { if (handles[id]) { clearTimeout(handles[id]); delete handles[id]; } };
win.setInterval = function (fn, ms) { const id = nextId++; handles[id] = setInterval(fn, ms); return id; };
win.clearInterval = win.clearTimeout;
win.requestAnimationFrame = function (fn) { return win.setTimeout(function () { fn(0); }, 16); };
win.stop = function () { calls.stop = (calls.stop || 0) + 1; };
win.addEventListener = function (type, fn) { listeners[type] = fn; };
win.MutationObserver = function () {};
const sandbox = { window: win, console, Error, Date, Object, String };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../br-page-hook.js', 'utf8'), sandbox, { filename: 'br-page-hook.js' });

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
win.__brWallDialogAt = Date.now() - 20000;
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

ok(posted.some(p => p.__br === 'hook' && /page hook installed/.test(p.msg)), 'hook reported its install + patches');
ok(posted.some(p => /location patches: .*href/.test(p.msg)), 'href trap installed: ' + (posted.find(p => /location patches/.test(p.msg)) || {}).msg);
ok(posted.filter(p => p.__br === 'dialog').length >= 3, 'suppressions were reported for the log (' + posted.filter(p => p.__br === 'dialog').length + ')');
ok(typeof win.__brHook.isWallDialog === 'function' && win.__brHook.isWallDialog('TURN OFF YOUR ADBLOCKER') === 'adblock', 'matcher is case-insensitive');

// v1.13.0 kill command: pending page timers die by id sweep,
// scheduling is neutered, and the kill is reported for the log.
let ticks = 0;
win.setInterval(function () { ticks++; }, 25);
let lateRan = false;
win.setTimeout(function () { lateRan = true; }, 60);
ok(typeof listeners.message === 'function', 'kill listener registered');
listeners.message({ source: win, data: { __br_cmd: 'kill' } });
ok(win.__brKilled === true, 'kill flag set');
ok(calls.stop === 1, 'window.stop called by the kill');
const ticksAtKill = ticks;
setTimeout(function () {
  ok(ticks === ticksAtKill, 'page interval cleared by the id sweep');
  ok(lateRan === false, 'pending page timeout cleared');
  ok(win.setTimeout(function () { lateRan = true; }, 10) === 0, 'setTimeout neutered after kill');
  setTimeout(function () {
    ok(lateRan === false, 'neutered timer never fires');
    ok(posted.some(p => p.__br === 'hook' && /KILLED/.test(p.msg || '')), 'kill was reported for the log');
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }, 40);
}, 130);
