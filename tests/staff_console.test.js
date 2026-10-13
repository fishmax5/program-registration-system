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
//   4. And what the console does NOT fetch: the page it opens with and every
//      `static` page travel inside its own document, so opening it is one
//      execution and no waiting panel; the rest are built ahead in ONE batched
//      execution, which stands down while a panel has a call in flight. Each
//      of those is a way to make the console slower than the dialogs it
//      replaced if it goes wrong, and the last one is a way to make a MARK
//      slower, which is worse.
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

// --- 4. what never has to be fetched ----------------------------------------

// The pages that travel inside the document: the one it opens with, then
// every `static` page. Nothing else — a page that reads a staff tab is built
// on request or by the batched prefetch, never on the way to a dialog that
// does not exist yet.
sandbox.readyQuickMarkIndex = () => null;
sandbox.buildQuickMarkHtml = () => '<p>QM</p>';
sandbox.buildBulkRegistrantsHtml = () => '<p>bulk</p>';
sandbox.volunteerDialogContext = () => ({ names: [] });
sandbox.buildVolunteerHoursHtml = () => '<p>vol</p>';
sandbox.privateSessionDialogContext = () => ({ names: [] });
sandbox.buildPrivateSessionHtml = () => '<p>priv</p>';
sandbox.listWaitlistProgramSessions = () => [{ key: 'k' }];
sandbox.buildBulkWaitlistOnlyHtml = () => '<p>close</p>';

let inlined = sandbox.staffConsoleInlinePanels_();
ok('the page the console opens with travels with the document',
  Object.prototype.hasOwnProperty.call(inlined, 'quickMark'));
ok('…and so does every page with no workbook data in it',
  inlined.bulkRegistrants && inlined.health);
ok('…and nothing that reads a staff tab does',
  !inlined.volunteer && !inlined.privateSession && !inlined.closeSessions);
ok('every carried page is wrapped for its iframe, bridge and all',
  Object.keys(inlined).every(id => /^<!DOCTYPE html>/.test(inlined[id]) &&
    inlined[id].indexOf('staffConsole') > 0));
ok('what is carried fits the ceiling it is measured against',
  Object.keys(inlined).reduce((n, id) => n + sandbox.staffConsoleInlineJson_(inlined[id]).length, 0) <=
    vm.runInContext('STAFF_CONSOLE_INLINE_MAX_CHARS', sandbox));

// A REFUSAL IS NOT CARRIED. The gate's sentence can stop being true in the
// minutes a window stays open, so the panel is fetched and the person is told
// the live refusal rather than a remembered one.
sandbox.isDeskWorkBlocked = () => true;
ok('a refused panel is left for the client to ask about',
  !Object.prototype.hasOwnProperty.call(sandbox.staffConsoleInlinePanels_(), 'quickMark'));
sandbox.isDeskWorkBlocked = () => false;

// TOO BIG TO CARRY: the smaller page goes instead — which for Quick Mark is
// the page a workbook with no stored lists has always been handed.
sandbox.buildQuickMarkHtml = idx => (idx === null ? '<p>lite</p>' : '<p>' + 'x'.repeat(600000) + '</p>');
sandbox.readyQuickMarkIndex = () => ({ big: true });
inlined = sandbox.staffConsoleInlinePanels_();
ok('a page over the ceiling falls back to its smaller one',
  /<p>lite<\/p>$/.test(inlined.quickMark || ''));
ok('…and says so in the log', logs.some(l => /over the \d+ left to carry it/.test(l)));

// THE PAGES WITH NO FALLBACK ARE GIVEN THE ROOM FIRST, which reads backwards
// until you ask what each one loses: a static page that will not fit costs a
// whole round trip and has nothing smaller to offer, while the opening page
// has, so an opening page big enough to eat the ceiling must not be what
// pushes them out.
sandbox.buildQuickMarkHtml = () => '<p>' + 'x'.repeat(600000) + '</p>';
inlined = sandbox.staffConsoleInlinePanels_();
ok('an enormous opening page does not push out the pages that cannot shrink',
  !!inlined.bulkRegistrants && !!inlined.health && !inlined.quickMark);

// And a page with no smaller version, over the ceiling, is simply not carried:
// the client fetches it, which is what every panel did before any of this.
sandbox.buildBulkRegistrantsHtml = () => '<p>' + 'y'.repeat(600000) + '</p>';
ok('a page over the ceiling with nothing smaller is not carried at all',
  !Object.prototype.hasOwnProperty.call(sandbox.staffConsoleInlinePanels_(), 'bulkRegistrants'));
ok('…and says why in the log', logs.some(l => /too big to carry/.test(l)));
sandbox.buildBulkRegistrantsHtml = () => '<p>bulk</p>';
sandbox.buildQuickMarkHtml = () => '<p>QM</p>';

// The one value in this project encoded ONCE rather than twice, because its
// size is what decides whether a page can be carried.
const hazard = { html: '</script><!-- \u2028\u2029 "q" \\ \u00e9' };
const encoded = sandbox.staffConsoleInlineJson_(hazard);
ok('the carried pages cannot end the script block or open a comment in it',
  encoded.indexOf('<') === -1);
ok('…nor carry a line separator a browser could reject',
  encoded.indexOf('\u2028') === -1 && encoded.indexOf('\u2029') === -1);
ok('…and it is still valid JavaScript that reads back unchanged',
  JSON.stringify(vm.runInContext('(' + encoded + ')', sandbox)) === JSON.stringify(hazard));
ok('encoding once is smaller than encoding twice, which is the whole point',
  encoded.length < sandbox.staffConsoleScriptJson_(hazard).length);

// THE MEMBER ROLL IS READ ONCE FOR THE WHOLE BATCH. Pinned here rather than
// beside collectKnownMembers() because the batch is why the memo exists: two
// of the three prefetched pages want that list, readSimpleTableValues() is a
// whole-tab getValues() every call (it does not go through readSheetGrid()'s
// cache), and a prefetch that read the roll twice to answer the same question
// twice is the cost this file is about.
{
  const savedRead = sandbox.readSimpleTableValues;
  const savedRetired = sandbox.memberRollIsRetired;
  let reads = 0;
  sandbox.readSimpleTableValues = () => { reads++; return [['Mrs Okonkwo'], ['Jane Smith']]; };
  sandbox.memberRollIsRetired = () => false;
  sandbox.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ getName: () => 'Member_Roll' }) }) };
  sandbox.invalidateKnownMembersMemo();
  const first = sandbox.collectKnownMembers();
  const second = sandbox.collectKnownMembers();
  ok('the member roll is read once however many pages ask for it',
    reads === 1 && second.length === 2 && JSON.stringify(first) === JSON.stringify(second));
  // A LIST OF NAMES IS A LIST OF SPELLINGS. The two writers that change the
  // roll inside an execution drop it, the same pair that drops the door's.
  sandbox.invalidateKnownMembersMemo();
  sandbox.collectKnownMembers();
  ok('…and read again once something has written to it', reads === 2);
  sandbox.readSimpleTableValues = savedRead;
  sandbox.memberRollIsRetired = savedRetired;
  sandbox.SpreadsheetApp = { getActiveSpreadsheet: () => null };
  sandbox.invalidateKnownMembersMemo();
}

// --- 5. the batched prefetch ------------------------------------------------

let batch = sandbox.staffConsolePanels(['volunteer', 'privateSession', 'closeSessions']);
ok('one call builds several panels', Object.keys(batch.panels).length === 3 && !batch.notBuilt.length);
ok('…each the same page staffConsolePanel() would have returned',
  batch.panels.volunteer === sandbox.staffConsolePanel('volunteer').html);

sandbox.listWaitlistProgramSessions = () => [];
batch = sandbox.staffConsolePanels(['volunteer', 'closeSessions']);
ok('a panel that refuses is left out rather than remembered as a refusal',
  !!batch.panels.volunteer && !batch.panels.closeSessions && !batch.notBuilt.length);
sandbox.listWaitlistProgramSessions = () => [{ key: 'k' }];

batch = sandbox.staffConsolePanels(['volunteer', '__proto__', 'nope']);
ok('an unknown or inherited id in a prefetch is ignored', Object.keys(batch.panels).length === 1);
ok('a prefetch of nothing is not an error',
  JSON.stringify(sandbox.staffConsolePanels(null)) === JSON.stringify({ panels: {}, notBuilt: [] }));

// THE BUDGET HANDS WORK BACK rather than running past it. A page that is more
// than the whole response may hold stops the batch, and what was not reached
// is named so the client can come back for it.
sandbox.buildVolunteerHoursHtml = () => '<p>' + 'v'.repeat(700000) + '</p>';
batch = sandbox.staffConsolePanels(['volunteer', 'privateSession', 'closeSessions']);
ok('a spent prefetch budget names what it did not reach',
  !!batch.panels.volunteer && batch.notBuilt.length === 2 &&
  batch.notBuilt.indexOf('privateSession') >= 0);
sandbox.buildVolunteerHoursHtml = () => '<p>vol</p>';

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

/**
 * The console's own script, built with `inline` as the pages carried inside
 * the document. `{}` is the pre-carrying path and still has to work: it is
 * what a workbook whose desk is busy, or whose Quick Mark page is too big to
 * carry, gets.
 */
function consoleScript(inline) {
  const saved = sandbox.staffConsoleInlinePanels_;
  sandbox.staffConsoleInlinePanels_ = () => (inline || {});
  const html = sandbox.buildStaffConsoleHtml();
  sandbox.staffConsoleInlinePanels_ = saved;
  // ONE script block, whatever is carried: a page inlined as raw markup would
  // put a </script> in the middle of the console's own and end it there.
  ok('the document has exactly one script block',
    (html.match(/<script>/g) || []).length === 1 && (html.match(/<\/script>/g) || []).length === 1);
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
  const timers = [];
  const ctx = {
    document: dom.document,
    window: { addEventListener: (t, f) => { if (t === 'message') winListeners.push(f); } },
    google: { script: { run: fakeRun(calls), host: { editor: { focus() {} } } } },
    // The prefetch is scheduled, never immediate: the test fires the timers
    // itself so that "it waits for quiet" is something it can actually watch.
    setTimeout: (f) => { timers.push(f); return timers.length; },
    Date,
    JSON, Object, Array, String
  };
  vm.createContext(ctx);
  vm.runInContext(consoleScript({}), ctx);
  const send = (source, data) => winListeners.forEach(f => f({ source, data }));

  ok('carrying no page, the console asks for Quick Mark once, after painting', calls.length === 1 &&
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

// --- 6. the console side, carrying its pages --------------------------------

{
  const dom = makeDom();
  const calls = [];
  const winListeners = [];
  const timers = [];
  let nowMs = 1000000;
  const ctx = {
    document: dom.document,
    window: { addEventListener: (t, f) => { if (t === 'message') winListeners.push(f); } },
    google: { script: { run: fakeRun(calls), host: { editor: { focus() {} } } } },
    setTimeout: (f) => { timers.push(f); return timers.length; },
    Date: { now: () => nowMs },
    JSON, Object, Array, String
  };
  vm.createContext(ctx);
  vm.runInContext(consoleScript({
    quickMark: '<p>carried QM</p>', bulkRegistrants: '<p>carried bulk</p>', health: '<p>carried health</p>'
  }), ctx);
  const send = (source, data) => winListeners.forEach(f => f({ source, data }));
  const fireTimers = () => { const t = timers.splice(0); t.forEach(f => f()); };

  // THE WHOLE POINT. Opening the console is one execution: the desk's page
  // came with the document, so there is nothing to ask for and nothing to wait
  // for.
  ok('carrying its page, the console asks the server NOTHING on open', calls.length === 0);
  const frame = dom.all.find(n => n.tagName === 'iframe');
  ok('…and Quick Mark is already on screen, from the document',
    frame && frame.srcdoc === '<p>carried QM</p>');

  // The prefetch is scheduled rather than immediate: a console that spent an
  // execution the instant it opened would be racing the first thing the person
  // does with it.
  ok('the rest are not fetched in the same breath', calls.length === 0 && timers.length === 1);
  fireTimers();
  ok('after a quiet moment, ONE call builds every page that could not be carried',
    calls.length === 1 && calls[0].fn === 'staffConsolePanels' &&
    JSON.stringify(calls[0].args[0].sort()) === JSON.stringify(['closeSessions', 'privateSession', 'volunteer']));
  calls[0].ok({ panels: { volunteer: '<p>pre vol</p>', privateSession: '<p>pre priv</p>' }, notBuilt: [] });

  // A carried page opens with no round trip, which is the second half of the
  // saving: the first open of each panel is a paint.
  calls.length = 0;
  send(frame.contentWindow, { staffConsole: 'call', id: 'v1', fn: 'showVolunteerHoursDialog', args: [] });
  ok('a prefetched panel opens without asking the server again', calls.length === 0);
  ok('…from the page built ahead',
    dom.all.some(n => n.tagName === 'iframe' && n.srcdoc === '<p>pre vol</p>'));

  // ↻ Reload means fresh: the carried copy is thrown away, not reused.
  const volBox = dom.all.filter(n => n.tagName === 'iframe' && n.srcdoc === '<p>pre vol</p>')[0].parentNode;
  const reload = volBox.children[0].children.filter(b => /Reload/.test(b.textContent))[0];
  reload.onclick();
  ok('↻ Reload fetches the page live instead of reusing the carried one',
    calls.length === 1 && calls[0].fn === 'staffConsolePanel' && calls[0].args[0] === 'volunteer');
  calls[0].ok({ ok: true, id: 'volunteer', title: 'Log Volunteer Hours', html: '<p>fresh vol</p>' });
  ok('…and the fresh page is what is shown',
    dom.all.some(n => n.tagName === 'iframe' && n.srcdoc === '<p>fresh vol</p>'));

  // THE DESK COMES FIRST. While a panel has a call in flight, the prefetch
  // stands down — an execution spent on a page nobody has opened is an
  // execution a mark is queued behind.
  calls.length = 0;
  send(frame.contentWindow, { staffConsole: 'call', id: 'm1', fn: 'applyQuickMarkFromDialog', args: [{}] });
  ok('a mark is one real call', calls.length === 1 && calls[0].fn === 'applyQuickMarkFromDialog');
  // Answering it is what puts the still-unbuilt panel back in the queue.
  calls[0].ok({ ok: true });
  ok('a mark answered leaves the rest to be built in the quiet after it', timers.length === 1);
  // Now a second mark is in flight when that quiet moment arrives.
  calls.length = 0;
  send(frame.contentWindow, { staffConsole: 'call', id: 'm2', fn: 'applyQuickMarkFromDialog', args: [{}] });
  const mark = calls[calls.length - 1];
  calls.length = 0;
  fireTimers();
  ok('a prefetch does not go out while a panel is waiting on an answer',
    calls.length === 0 && timers.length === 1);
  mark.ok({ ok: true });
  fireTimers();
  ok('…and goes out once the desk has its answer',
    calls.length === 1 && calls[0].fn === 'staffConsolePanels' &&
    JSON.stringify(calls[0].args[0]) === JSON.stringify(['closeSessions']));

  // A page built ahead is kept for its TTL and no longer: these carry a roll
  // of names and a list of recent visits, and a twenty-minute-old copy shown
  // without saying so is the one thing this must not do.
  calls[0].ok({ panels: { closeSessions: '<p>pre close</p>' }, notBuilt: [] });
  nowMs += vm.runInContext('STAFF_CONSOLE_PREFETCH_TTL_MS', sandbox) + 1;
  calls.length = 0;
  send(frame.contentWindow, { staffConsole: 'call', id: 'c9', fn: 'showBulkWaitlistOnlyDialog', args: [] });
  ok('a page built ahead and left too long is fetched again rather than shown',
    calls.length === 1 && calls[0].fn === 'staffConsolePanel' && calls[0].args[0] === 'closeSessions');

  // A page with no workbook data in it has nothing to go stale, so the one
  // that came with the document is still the right answer an hour later.
  calls.length = 0;
  send(frame.contentWindow, { staffConsole: 'call', id: 'b9', fn: 'showBulkRegistrantsDialog', args: [] });
  ok('a page that holds no workbook data is never re-fetched for age',
    calls.length === 0 &&
    dom.all.some(n => n.tagName === 'iframe' && n.srcdoc === '<p>carried bulk</p>'));

  // And the Health tab, which used to spend a round trip asking whether R4's
  // panel exists in this version.
  calls.length = 0;
  dom.all.find(n => n.id === 'tab-health').onclick();
  ok('the Health tab draws without asking the workbook anything',
    calls.length === 0 &&
    dom.all.some(n => n.tagName === 'iframe' && n.srcdoc === '<p>carried health</p>'));
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
