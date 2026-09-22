// WHY DID NOTHING HAPPEN? (section 99g).
//
// Half the menu in this project begins by asking whether it is allowed to run,
// and every one of those refusals used to be a toast — which lands in the
// corner of a sheet showing Google's own "Running script…" banner and is gone
// before anybody looks up. Several unrelated menu items were reported as
// "shows running script, then nothing, no error", with the executions list
// calling every one of them completed. Completed was the truth.
//
// What is pinned here is the report that answers that, because it is the one
// thing that has to work on a workbook where nothing else does:
//
//   IT NAMES EVERY REASON, not the first one — a paused workbook mid-sweep has
//   two, and fixing one and finding nothing changed is the same dead end again.
//
//   IT NEVER THROWS. A setting it cannot read becomes a line of the report,
//   because "this workbook cannot read its own settings" is an answer.
//
//   A HEALTHY WORKBOOK IS TOLD SO PLAINLY, and told that a menu item still
//   doing nothing is now a DIFFERENT fault — which is the next thing somebody
//   needs to know.
//
//   AND A JOB THAT IS MERELY SLOW IS NOT CALLED STUCK.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString(), getUuid: () => 'x', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.collectWorkbookRefusals = collectWorkbookRefusals;
this.describeWorkbookRefusals = describeWorkbookRefusals;
this.NOTHING_BLOCKING_MESSAGE = NOTHING_BLOCKING_MESSAGE;
this.BOOTSTRAP_STATE_PROP_KEY = BOOTSTRAP_STATE_PROP_KEY;
this.FORM_REBUILD_STATE_PROP_KEY = FORM_REBUILD_STATE_PROP_KEY;
this.__stubAutomation = fn => { isAutomationEnabled = fn; };
this.__stubMailPause = fn => { isOutboundMailPaused = fn; };
this.__stubTestMode = fn => { isNotificationTestMode = fn; };
`, sandbox, { filename: 'program.gs' });

const { collectWorkbookRefusals, describeWorkbookRefusals } = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}
function checkTrue(label, got) { check(label, !!got, true); }

const titles = () => collectWorkbookRefusals().map(r => r.title);

// --- A healthy workbook ----------------------------------------------------
sandbox.__stubAutomation(() => true);
sandbox.__stubMailPause(() => false);
sandbox.__stubTestMode(() => false);
check('nothing blocking is nothing reported', titles(), []);
checkTrue('and it says so, and says what that rules out',
  describeWorkbookRefusals([]).indexOf('different fault') !== -1);

// --- The kill switch -------------------------------------------------------
sandbox.__stubAutomation(() => false);
check('a paused workbook is the first thing said', titles(), ['Automation is paused']);

// --- The rehearsal switch --------------------------------------------------
// THE ONE THAT LOOKS LEAST LIKE A REFUSAL: the syncs run, the log says messages
// went, and no member heard anything because every one went to the office.
sandbox.__stubAutomation(() => true);
sandbox.__stubTestMode(() => true);
check('notification test mode is reported as a reason nothing arrived',
  titles(), ['Notification test mode is on']);
checkTrue('...and says the real messages are still owed',
  collectWorkbookRefusals()[0].detail.indexOf('still') !== -1);
sandbox.__stubTestMode(() => false);

// --- A job in flight, and a job stuck --------------------------------------
sandbox.__stubAutomation(() => true);
props[sandbox.FORM_REBUILD_STATE_PROP_KEY] = JSON.stringify({
  startedAt: Date.now() - 5 * 60000, lastSliceAt: Date.now() - 2 * 60000, slices: 3
});
check('a job that is still advancing is reported, not accused',
  titles(), ['the destroy-and-rebuild forms sweep is in flight']);
checkTrue('...and is left alone',
  collectWorkbookRefusals()[0].fix.indexOf('let it finish') !== -1);

props[sandbox.FORM_REBUILD_STATE_PROP_KEY] = JSON.stringify({
  startedAt: Date.now() - 6 * 3600000, lastSliceAt: Date.now() - 5 * 3600000, slices: 3
});
check('a job that stopped advancing is called stuck',
  titles(), ['the destroy-and-rebuild forms sweep is in flight and has stopped advancing']);
checkTrue('...and points at the item that clears it',
  collectWorkbookRefusals()[0].fix.indexOf('Clear a Stuck Background Job') !== -1);

// --- Every reason, not the first -------------------------------------------
// THE CASE THIS FILE IS ACTUALLY FOR: a sweep that paused automation and then
// died. Fixing one of the two and finding nothing changed is the same dead end
// over again, so both have to be on screen at once.
sandbox.__stubAutomation(() => false);
props[sandbox.BOOTSTRAP_STATE_PROP_KEY] = JSON.stringify({
  startedAt: Date.now() - 9 * 3600000, lastSliceAt: Date.now() - 9 * 3600000, slices: 1
});
check('two reasons are two lines', titles(), [
  'Automation is paused',
  'the large-setup import is in flight and has stopped advancing',
  'the destroy-and-rebuild forms sweep is in flight and has stopped advancing'
]);
checkTrue('and the report numbers them for somebody working through it',
  describeWorkbookRefusals().indexOf('3. ') !== -1);

// --- It cannot be the thing that breaks ------------------------------------
sandbox.__stubAutomation(() => { throw new Error('Config unreadable'); });
const broken = collectWorkbookRefusals();
checkTrue('a check that throws becomes a line rather than an exception',
  broken.some(r => r.title.indexOf('Could not check the automation switch') === 0));
checkTrue('...and the rest of the report still runs',
  broken.some(r => r.title.indexOf('in flight') !== -1));

console.log(failures === 0 ? '\nAll "why did nothing happen" checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
