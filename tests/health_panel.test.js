// THE HEALTH PANEL (section 99zm) and the report capture it runs on.
//
// Pinned here:
//
//   A CHECK RETURNS ITS TEXT instead of alerting it, through the report's own
//   menu function — and the same function, called outside the panel, still
//   alerts exactly as before.
//
//   A TOAST-ONLY ANSWER is still an answer in the panel; a report that toasts
//   and then answers shows the answer.
//
//   NOTHING THROWS: a report that fails comes back as "could not run", the
//   capture scope is closed behind it, and an unknown id is a sentence.
//
//   USAGE KEEPS COUNTING under the action name the menu item used.
//
//   ESCAPING: the page writes everything with textContent, and a title or a
//   report carrying </script> cannot end the page's script block.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const alerts = [];
const toasts = [];
const modals = [];
const sidebars = [];
let uiAvailable = true;
const ui = {
  ButtonSet: { OK: 'OK' },
  alert: (title, text) => { alerts.push({ title, text }); },
  showModalDialog: (html, title) => { modals.push({ html: html.content, title }); },
  showSidebar: html => { sidebars.push(html); }
};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10), getUuid: () => 'x', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; },
      getProperties: () => Object.assign({}, props)
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ toast: m => toasts.push(m), getSheetByName: () => null, getSpreadsheetTimeZone: () => 'America/New_York' }),
    getActive: () => null,
    getUi: () => { if (!uiAvailable) throw new Error('no ui'); return ui; }
  },
  HtmlService: {
    createHtmlOutput: content => {
      const out = { content };
      out.setWidth = () => out; out.setHeight = () => out; out.setTitle = t => { out.title = t; return out; };
      return out;
    }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.MENU_USAGE_PROP_KEY = MENU_USAGE_PROP_KEY;
this.HEALTH_CHECKS = HEALTH_CHECKS;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a !== b) { failures++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`); }
  else console.log(`ok   ${label}`);
}
const reset = () => { alerts.length = 0; toasts.length = 0; modals.length = 0; };

// --- The table. ---------------------------------------------------------------
const checks = sandbox.HEALTH_CHECKS;
check('ids are unique', new Set(checks.map(c => c.id)).size, checks.length);
check('every check names an existing action', checks.filter(c => typeof sandbox[c.action] !== 'function').map(c => c.action), []);
check('every check is a report or a tool', checks.filter(c => c.kind !== 'report' && c.kind !== 'tool').map(c => c.id), []);
check('the page gets no closures', sandbox.healthPanelChecks_().some(c => 'run' in c || 'action' in c), false);
['reportWhyNothingHappened', 'showTriggerStatus', 'reportMissingRegistrations', 'showLedgerVerificationReport',
 'reportLedgerGrowth', 'reportScriptPropertiesUsage', 'showFormLinkDoctorDialog'].forEach(a =>
  check(`the panel carries ${a}`, checks.some(c => c.action === a), true));

// --- A check returns its text; the menu path still alerts. ---------------------
const hostile = `O'Brien's class </script><img src=x onerror=alert(1)>`;
sandbox.describeWorkbookRefusals = () => `Paused.\n${hostile}`;
reset();
let r = sandbox.runHealthCheck('why');
check('a check returns ok', r.ok, true);
check('a check returns the report text', r.text, `Paused.\n${hostile}`);
check('nothing was alerted while the panel ran it', alerts.length, 0);
check('the capture scope is closed afterwards', sandbox.reportCaptureOpen_(), false);
check('the run is counted under the menu action name',
  JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]).items.reportWhyNothingHappened[0], 1);
reset();
sandbox.reportWhyNothingHappened();
check('the menu path still alerts, with the same title and text', alerts, [{ title: 'Why did nothing happen?', text: `Paused.\n${hostile}` }]);
reset();
uiAvailable = false;
sandbox.reportWhyNothingHappened();
check('with no UI the menu path falls back to the toast', toasts.length, 1);
uiAvailable = true;

// --- A toast-only answer, and a toast before an answer. ------------------------
reset();
r = sandbox.runHealthCheck('duplicateSessions');
check('a report that only toasts still answers in the panel', r.text, 'No session table yet — nothing to report.');
check('and nothing was toasted on the sheet', toasts.length, 0);
reset();
sandbox.auditRegistrationImport = () => ({ missingPeople: [] });
sandbox.describeRegistrationAudit_ = () => 'Nobody is missing.';
r = sandbox.runHealthCheck('missing');
check('a report that toasts "this can take minutes" and then answers shows the answer', r.text, 'Nobody is missing.');
check('the modal it would open is not opened from the panel', modals.length, 0);
reset();
sandbox.reportMissingRegistrations();
check('outside the panel it still opens its scrollable modal', modals.length, 1);
check('the modal escapes the text', modals[0].html.indexOf('Nobody is missing.') >= 0, true);
sandbox.describeRegistrationAudit_ = () => hostile;
reset();
sandbox.reportMissingRegistrations();
check('the modal cannot be ended by a report line', modals[0].html.indexOf('</script>') < 0 && modals[0].html.indexOf('&lt;/script&gt;') >= 0, true);

// --- Nothing throws. ------------------------------------------------------------
sandbox.describeWorkbookRefusals = () => { throw new Error('Config is gone'); };
r = sandbox.runHealthCheck('why');
check('a report that throws comes back as could-not-run', r.ok === false && /could not run: Config is gone/.test(r.text), true);
check('the capture scope is closed after a throw', sandbox.reportCaptureOpen_(), false);
r = sandbox.runHealthCheck('nope');
check('an unknown id is a sentence, not a throw', r.ok === false && /no check called "nope"/.test(r.text), true);
r = sandbox.runHealthCheck('doctor');
check('a tool is not run as a report', r.ok, false);

// --- Tools open their own dialog and are counted. -------------------------------
let opened = 0;
sandbox.showFormLinkDoctorDialog = () => { opened++; };
r = sandbox.openHealthTool('doctor');
check('a tool runs its own function', [r.ok, opened], [true, 1]);
check('a tool is counted under its menu action',
  JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]).items.showFormLinkDoctorDialog[0], 1);
sandbox.clearStuckBackgroundJobs = () => { throw new Error('lease unreadable'); };
r = sandbox.openHealthTool('clearStuck');
check('a tool that throws says so', r.ok === false && /lease unreadable/.test(r.text), true);
check('a report id is not opened as a tool', sandbox.openHealthTool('why').ok, false);

// --- The sidebar. ---------------------------------------------------------------
sandbox.showHealthPanel();
check('the panel opens as a sidebar, titled', [sidebars.length, sidebars[0].title], [1, 'Health']);
const page = sandbox.buildHealthPanelHtml([
  { id: 'x', group: `Group </script>`, kind: 'report', title: hostile, blurb: hostile, slow: false }
]);
check('the page has exactly one closing script tag', page.split('</script>').length - 1, 1);
check('a hostile title cannot end the script block', page.indexOf('</script><img') < 0, true);
check('the page never writes data with innerHTML', /innerHTML/.test(page), false);
check('the page writes report text with textContent', page.indexOf('out.textContent = text') >= 0, true);
check('nothing runs on open: the only server calls are inside the click handler',
  (page.match(/google\.script\.run/g) || []).length, 1);
const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
let compiled = null;
try { new Function(script); compiled = true; } catch (err) { compiled = String(err); }
check('the page script compiles', compiled, true);
// Run the page's script against a tiny DOM and check what lands as text.
{
  const made = [];
  const el = tag => {
    const e = { tag, children: [], style: {}, textContent: '', className: '', listeners: {} };
    e.appendChild = c => { e.children.push(c); return c; };
    e.addEventListener = (k, fn) => { e.listeners[k] = fn; };
    made.push(e);
    return e;
  };
  const list = el('div');
  const calls = [];
  const runner = {};
  runner.withFailureHandler = () => runner;
  runner.withSuccessHandler = fn => { runner.ok = fn; return runner; };
  runner.runHealthCheck = id => { calls.push(id); runner.ok({ ok: true, text: hostile, ms: 1200 }); };
  const ctx = { document: { getElementById: () => list, createElement: el }, google: { script: { run: runner } },
    JSON, Math, Date };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  check('a hostile title is drawn as text', made.some(e => e.textContent === hostile), true);
  check('no server call before a click', calls, []);
  const button = made.find(e => e.tag === 'button');
  button.listeners.click();
  check('a click runs that one check', calls, ['x']);
  const pre = made.find(e => e.tag === 'pre');
  check('the report text lands as text', pre.textContent, hostile);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall health panel checks passed');
