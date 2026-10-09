// THE STAFF CONSOLE (99zo).
//
// Three things this pins, because each is a way the console could make a job
// WORSE than the dialog it hosts:
//
//   1. staffConsolePanel() refuses with the SAME sentence the menu item would
//      have alerted, never throws, and hands back the builder's page untouched
//      after the bridge.
//   2. The bridge shim (run in the child page) turns google.script.run into a
//      message per call — chaining, user objects, failures as Errors — and
//      answers only messages from its own parent.
//   3. The console side relays each message to ONE real google.script.run with
//      the same function and arguments, answers the frame that asked, ignores
//      frames it did not make, and opens a sibling panel in place of a
//      show…Dialog call (which would otherwise REPLACE the console).
const vm = require('vm');
const src = require('./helpers/source').readSource();

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

const logs = [];
const sandbox = {
  console: { log: () => {}, error: () => {} },
  Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  ScriptApp: {}, FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });
sandbox.log = msg => logs.push(String(msg));

// --- 1. the server half ------------------------------------------------------

sandbox.isDeskWorkBlocked = () => true;
sandbox.deskBusyMessage = () => 'The desk is busy: a rebuild is running.';
let r = sandbox.staffConsolePanel('quickMark');
ok('a blocked desk refuses Quick Mark with the menu item\'s own sentence',
  r.ok === false && r.message === 'The desk is busy: a rebuild is running.');

sandbox.isDeskWorkBlocked = () => false;
sandbox.readyQuickMarkIndex = () => null;
sandbox.buildQuickMarkHtml = idx => `<p>QM ${idx === null ? 'fetches' : 'inline'}</p><script>var X=1;</script>`;
r = sandbox.staffConsolePanel('quickMark');
ok('an open desk returns Quick Mark', r.ok === true && r.title === 'Quick Mark');
ok('the page starts with a doctype and the bridge', /^<!DOCTYPE html>/.test(r.html) &&
  r.html.indexOf('staffConsole') < r.html.indexOf('<p>QM'));
ok('the builder\'s page follows the bridge untouched', r.html.endsWith('<p>QM fetches</p><script>var X=1;</script>'));

sandbox.readyQuickMarkIndex = () => { throw new Error('cache broke'); };
let built = [];
sandbox.buildQuickMarkHtml = idx => { built.push(idx); if (idx !== null) throw new Error('x'); return '<p>QM</p>'; };
sandbox.readyQuickMarkIndex = () => ({ big: true });
r = sandbox.staffConsolePanel('quickMark');
ok('a Quick Mark build that fails inline falls back to fetching, as the menu item does',
  r.ok === true && built.length === 2 && built[1] === null);

sandbox.isBootstrapActive = () => true;
sandbox.bootstrapBusyMessage = () => 'A large import is running.';
r = sandbox.staffConsolePanel('closeSessions');
ok('Close Sessions refuses during a bootstrap', r.ok === false && r.message === 'A large import is running.');
sandbox.isBootstrapActive = () => false;
sandbox.listWaitlistProgramSessions = () => [];
r = sandbox.staffConsolePanel('closeSessions');
ok('Close Sessions with nothing upcoming says so', r.ok === false && /Sync Cal/.test(r.message));
sandbox.listWaitlistProgramSessions = () => [{ key: 'k' }];
sandbox.buildBulkWaitlistOnlyHtml = programs => `<p>${programs.length} program</p>`;
r = sandbox.staffConsolePanel('closeSessions');
ok('Close Sessions builds from the same program list', r.ok && r.html.endsWith('<p>1 program</p>'));

sandbox.volunteerDialogContext = () => { throw new Error('roll unreadable'); };
r = sandbox.staffConsolePanel('volunteer');
ok('a builder that throws is an answer, not a throw', r.ok === false && /roll unreadable/.test(r.message));
ok('…and is logged', logs.some(l => /Log Volunteer Hours could not be built/.test(l)));

r = sandbox.staffConsolePanel('__proto__');
ok('an unknown or inherited panel id is refused', r.ok === false);
r = sandbox.staffConsolePanel('health');
ok('Health embeds R4\'s panel, with its checks', r.ok === true &&
  r.html.includes(sandbox.healthPanelChecks_()[0].blurb));
ok('Health info says the panel is embeddable', JSON.stringify(sandbox.staffConsoleHealthInfo()) ===
  JSON.stringify({ embeddable: true, dialog: true }));
const savedHealth = [sandbox.buildHealthPanelHtml, sandbox.showHealthPanel];
vm.runInContext('buildHealthPanelHtml = undefined; showHealthPanel = undefined;', sandbox);
r = sandbox.staffConsolePanel('health');
ok('Health without R4\'s builder is a placeholder, not an error', r.ok === false && /not part of this version/.test(r.message));
ok('Health info says nothing is available here', JSON.stringify(sandbox.staffConsoleHealthInfo()) ===
  JSON.stringify({ embeddable: false, dialog: false }));
sandbox.buildHealthPanelHtml = savedHealth[0];
sandbox.showHealthPanel = savedHealth[1];

ok('a page\'s own doctype is not doubled',
  (sandbox.staffConsoleWrapPanelHtml_('<!DOCTYPE html><p>x</p>').match(/<!DOCTYPE/gi) || []).length === 1);

const panelIds = Object.keys(vm.runInContext('STAFF_CONSOLE_PANELS', sandbox));
['quickMark', 'bulkRegistrants', 'volunteer', 'privateSession', 'closeSessions'].forEach(id =>
  ok(`panel ${id} is in the console`, panelIds.includes(id)));
Object.keys(vm.runInContext('STAFF_CONSOLE_SHOW_INTERCEPTS', sandbox)).forEach(fn => {
  ok(`intercepted ${fn} is a real show function`, typeof sandbox[fn] === 'function');
  ok(`intercepted ${fn} names a real panel`, panelIds.includes(vm.runInContext('STAFF_CONSOLE_SHOW_INTERCEPTS', sandbox)[fn]));
});

// --- a fake DOM, just enough for the console's own script --------------------

function makeDom() {
  const all = [];
  function node(tag) {
    const n = {
      tagName: tag, children: [], parentNode: null, className: '', textContent: '', hidden: false,
      attrs: {}, listeners: {}, id: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] || null; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      focus() {}
    };
    if (tag === 'iframe') n.contentWindow = { posted: [], postMessage(m) { this.posted.push(JSON.parse(JSON.stringify(m))); } };
    all.push(n);
    return n;
  }
  const nav = node('nav'); nav.id = 'tabs';
  const main = node('main'); main.id = 'main';
  return {
    all,
    document: {
      createElement: node,
      getElementById: id => all.find(n => n.id === id && (n === nav || n === main || attached(n))) || null
    }
  };
  function attached(n) { while (n.parentNode) n = n.parentNode; return n === nav || n === main; }
}

function consoleScript() {
  const html = sandbox.buildStaffConsoleHtml();
  return html.substring(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
}

// A google.script.run that records each call and lets the test answer it.
function fakeRun(calls) {
  function runner(okF, failF) {
    return new Proxy({}, {
      get(t, name) {
        if (name === 'withSuccessHandler') return f => runner(f, failF);
        if (name === 'withFailureHandler') return f => runner(okF, f);
        if (typeof name !== 'string' || name === 'then') return undefined;
        if (name === 'nonexistentServerFn') return undefined;
        return (...args) => calls.push({ fn: name, args, ok: okF, fail: failF });
      }
    });
  }
  return runner(null, null);
}

// --- 3. the console side -----------------------------------------------------

{
  const dom = makeDom();
  const calls = [];
  const winListeners = [];
  const ctx = {
    document: dom.document,
    window: { addEventListener: (t, f) => { if (t === 'message') winListeners.push(f); } },
    google: { script: { run: fakeRun(calls), host: { editor: { focus() {} } } } },
    JSON, Object, Array, String
  };
  vm.createContext(ctx);
  vm.runInContext(consoleScript(), ctx);
  const send = (source, data) => winListeners.forEach(f => f({ source, data }));

  ok('the console asks for Quick Mark once, after painting', calls.length === 1 &&
    calls[0].fn === 'staffConsolePanel' && calls[0].args[0] === 'quickMark');
  calls[0].ok({ ok: true, id: 'quickMark', title: 'Quick Mark', html: '<p>page</p>' });
  const frame = dom.all.find(n => n.tagName === 'iframe');
  ok('the panel is an iframe carrying the page as srcdoc', frame && frame.srcdoc === '<p>page</p>');

  calls.length = 0;
  const args = [{ location: 'Narberth', name: "O'Brien", attended: true }];
  send(frame.contentWindow, { staffConsole: 'call', id: 'c1', fn: 'applyQuickMarkFromDialog', args });
  ok('a call from the panel becomes one real google.script.run', calls.length === 1 &&
    calls[0].fn === 'applyQuickMarkFromDialog' && JSON.stringify(calls[0].args) === JSON.stringify(args));
  calls[0].ok({ ok: true, queued: true });
  const res = frame.contentWindow.posted.pop();
  ok('its answer goes back to that frame, unchanged (a queued mark stays queued)',
    res.staffConsole === 'result' && res.id === 'c1' && res.ok === true && res.value.queued === true);

  send(frame.contentWindow, { staffConsole: 'call', id: 'c2', fn: 'applyQuickMarkFromDialog', args: [] });
  calls[calls.length - 1].fail(new Error('Lock timed out'));
  const bad = frame.contentWindow.posted.pop();
  ok('a server failure goes back as an error with its message', bad.ok === false && bad.error.message === 'Lock timed out');

  calls.length = 0;
  send({ postMessage() {} }, { staffConsole: 'call', id: 'x', fn: 'applyQuickMarkFromDialog', args: [] });
  ok('a message from a window the console did not make is ignored', calls.length === 0);

  send(frame.contentWindow, { staffConsole: 'call', id: 'c3', fn: 'nonexistentServerFn', args: [] });
  const none = frame.contentWindow.posted.pop();
  ok('an unknown function is answered with an error rather than silence', none.ok === false && /no function/.test(none.error.message));

  calls.length = 0;
  send(frame.contentWindow, { staffConsole: 'call', id: 'c4', fn: 'showVolunteerHoursDialog', args: [] });
  ok('a show…Dialog call opens the panel in the console instead of a new dialog',
    calls.length === 1 && calls[0].fn === 'staffConsolePanel' && calls[0].args[0] === 'volunteer');
  ok('…and the frame is told it went through', frame.contentWindow.posted.pop().ok === true);
  const peopleTab = dom.all.find(n => n.id === 'tab-people');
  ok('…on the People tab', peopleTab.attrs['aria-selected'] === 'true');
  ok('the Quick Mark panel is hidden, not destroyed', frame.parentNode && frame.parentNode.hidden === true);

  calls[0].ok({ ok: false, message: 'Busy.' });
  ok('a refused panel says why, in the panel', dom.all.some(n => n.textContent === 'Busy.' && /err/.test(n.className)));
}

// --- 2. the bridge shim in the child page ------------------------------------

{
  const posted = [];
  const listeners = [];
  const parent = { postMessage: m => posted.push(JSON.parse(JSON.stringify(m))) };
  const win = {
    parent, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); }
  };
  const ctx = { window: win, Proxy, Error, Date, Array, setTimeout, console: { error() {} } };
  vm.createContext(ctx);
  vm.runInContext(vm.runInContext('STAFF_CONSOLE_BRIDGE_SHIM', sandbox), ctx);
  const run = win.google.script.run;
  const deliver = (data, source) => listeners.forEach(f => f({ source: source || parent, data }));

  let got = null; let gotUser = null;
  run.withSuccessHandler((v, u) => { got = v; gotUser = u; }).withUserObject('row 7')
    .bulkRegistrantsStatus('a', 2);
  ok('a chained call posts the function and its arguments', posted.length === 1 &&
    posted[0].staffConsole === 'call' && posted[0].fn === 'bulkRegistrantsStatus' &&
    JSON.stringify(posted[0].args) === '["a",2]');
  deliver({ staffConsole: 'result', id: posted[0].id, ok: false, error: { message: 'no' } }, { other: 1 });
  ok('an answer from anywhere but the parent is ignored', got === null);
  deliver({ staffConsole: 'result', id: posted[0].id, ok: true, value: { exists: true } });
  ok('the success handler gets the value and the user object', got && got.exists === true && gotUser === 'row 7');

  let err = null;
  run.withFailureHandler(e => { err = e; }).startBulkRegistrants({});
  deliver({ staffConsole: 'result', id: posted[1].id, ok: false, error: { message: 'Lock timed out' } });
  ok('a failure arrives as an Error with its message', err && err.message === 'Lock timed out');

  ok('a runner is not mistaken for a promise', run.then === undefined);
  posted.length = 0;
  win.google.script.host.close();
  ok('host.close() asks the console to close the panel', posted.length === 1 && posted[0].staffConsole === 'close');
  ok('setHeight and setWidth are harmless', (win.google.script.host.setHeight(5), win.google.script.host.setWidth(5), true));
}

console.log(fail ? `\n${fail} staff console check(s) FAILED` : '\nall staff console checks passed');
process.exit(fail ? 1 : 0);
