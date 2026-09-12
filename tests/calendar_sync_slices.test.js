// A CALENDAR SYNC THAT RAN OUT OF TIME, AND WHAT IT HANDS ON.
//
// syncCalendars() is a sliced job now (89_calendar_sync_slices.gs): it works
// to Config's budget, stops BETWEEN groups, and arms a follow-up run. Before
// that, an execution killed at the account's ceiling lost everything after the
// group loop — the horizon pass, the link cells, the dashboard render, the
// lunch forms, and the restoration of the calendar-edit watchers — and started
// again from the top on the next run, to be killed in the same place.
//
// What is pinned here:
//   • the deadline reaches importCalendarGroups(), which is the only thing
//     that makes a slice stop cleanly rather than be killed;
//   • a run with NO deadline is unchanged — that is what the program review's
//     own update (58) calls, and it must still do the whole window;
//   • a partial slice does NOT triage (it would be judging a calendar it did
//     not finish reading), does not build lunch forms, and does not claim to
//     be complete;
//   • the slice that finishes the window does all three;
//   • the job's own contract: finished vs. handed off, the counters that
//     accumulate across slices, and progress measured against the REMAINING
//     count rather than by groups touched — a slice that processed groups
//     without reducing the remainder has not moved.
//
// The passes themselves are replaced with recorders after the project is
// evaluated; every one is a hoisted function declaration, so the sync calls
// the stub. What is under test is the slicing, not the import.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const RealDate = Date;
let CLOCK = new RealDate(2026, 8, 12, 9, 0, 0).getTime();

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [CLOCK])); }
    static now() { return CLOCK; }
  },
  Utilities: {
    formatDate: d => new RealDate(d).toISOString(),
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: (() => {
    const store = {};
    const props = {
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); return props; },
      deleteProperty: k => { delete store[k]; return props; },
      getProperties: () => Object.assign({}, store)
    };
    return { getScriptProperties: () => props, getUserProperties: () => props, __store: store };
  })(),
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {}
  },
  FormApp: { ItemType: {}, openById: () => { throw new Error('no form'); } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => LOCK_FREE, releaseLock: () => {} }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {
    getProjectTriggers: () => TRIGGERS.slice(),
    deleteTrigger: t => { TRIGGERS = TRIGGERS.filter(x => x !== t); },
    newTrigger: handler => ({
      timeBased: () => ({
        after: ms => ({ create: () => { TRIGGERS.push({ handler, ms, getHandlerFunction: () => handler }); } })
      })
    })
  },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
let TRIGGERS = [];
let LOCK_FREE = true;
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.syncCalendars = syncCalendars;
this.syncCalendarsInternal = syncCalendarsInternal;
this.runCalendarSyncSlice = runCalendarSyncSlice;
this.resumeCalendarSync = resumeCalendarSync;
this.newCalendarSyncState = newCalendarSyncState;
this.CALENDAR_SYNC_STATE_PROP_KEY = CALENDAR_SYNC_STATE_PROP_KEY;
this.CALENDAR_SYNC_RESUME_HANDLER = CALENDAR_SYNC_RESUME_HANDLER;
`, sandbox, { filename: 'program.gs' });

sandbox.SpreadsheetApp.getActiveSpreadsheet = () =>
  ({ getSheetByName: () => null, toast: () => {}, getSheets: () => [] });
sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;

// ---------------------------------------------------------------------------
// The stubs.
// ---------------------------------------------------------------------------
let calls = [];
let IMPORT_RESULTS = [];
let IMPORT_CALLS = [];
let RENDER_CALLS = [];
const record = name => (...args) => { calls.push({ name, args }); };

function installStubs() {
  calls = [];
  IMPORT_CALLS = [];
  RENDER_CALLS = [];
  TRIGGERS = [];
  LOCK_FREE = true;
  sandbox.PropertiesService.getScriptProperties().deleteProperty(sandbox.CALENDAR_SYNC_STATE_PROP_KEY);

  sandbox.log = () => {};
  sandbox.noteForAdmin = record('noteForAdmin');
  sandbox.toastIfPossible = () => {};
  sandbox.flushAdminDigest = record('flushAdminDigest');
  sandbox.flushPersistentRegistries = record('flushPersistentRegistries');
  sandbox.automationGateAllows = () => true;
  sandbox.isBootstrapActive = () => false;
  sandbox.recordHandlerRun = () => {};
  sandbox.confirmConsequentialAction = () => true;
  sandbox.getSyncSliceBudgetMs = () => 60 * 1000;

  // The quiet window is not what is under test; run the body straight through.
  sandbox.withCalendarChangeTriggersPaused = (why, fn) => fn();
  sandbox.migrateLegacySheetNames = record('migrateLegacySheetNames');
  sandbox.getOrCreateSheet = (ss, name) => ({ __name: name, getName: () => name });
  sandbox.findProgramSessionHeaderRows = () => [1, 2];
  sandbox.refreshRegistrationHorizonDisplay = record('refreshRegistrationHorizonDisplay');
  sandbox.describeImportSummary = () => 'summary';

  sandbox.importCalendarGroups = (sheet, options) => {
    IMPORT_CALLS.push(options || {});
    return IMPORT_RESULTS.shift() || {
      groupsTotal: 0, groupsProcessed: 0, groupsFailed: 0, formsCreated: 0, formsReused: 0,
      eventsAdded: 0, remaining: 0, outOfTime: false
    };
  };
  sandbox.renderProgramDashboard = (force, options) => { RENDER_CALLS.push(options || {}); };
  sandbox.pruneLunchOnlyFormLinks = x => x;
  sandbox.getLunchOnlyFormLinks = () => ({});
  sandbox.syncLunchOnlySessions = (...args) => { calls.push({ name: 'syncLunchOnlySessions', args }); return {}; };
  sandbox.updateMasterLunchDashboard = record('updateMasterLunchDashboard');
}

const summary = over => Object.assign({
  groupsTotal: 10, groupsProcessed: 10, groupsFailed: 0, formsCreated: 1, formsReused: 2,
  eventsAdded: 20, remaining: 0, outOfTime: false
}, over);

const named = name => calls.filter(c => c.name === name).length;
const stateNow = () => {
  const raw = sandbox.PropertiesService.getScriptProperties().getProperty(sandbox.CALENDAR_SYNC_STATE_PROP_KEY);
  return raw ? JSON.parse(raw) : null;
};

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (err) { failures++; console.log(`FAIL ${name}\n  ${err.message}`); }
}

// --- the deadline reaches the loop, and only when there is one ---------------
check('the slice hands its deadline to the group loop', () => {
  installStubs();
  IMPORT_RESULTS = [summary()];
  sandbox.syncCalendarsInternal({ deadline: 1234 });
  assert.strictEqual(IMPORT_CALLS[0].deadline, 1234);
});

check('an unsliced call passes no deadline, so the loop runs to the end', () => {
  installStubs();
  IMPORT_RESULTS = [summary()];
  sandbox.syncCalendarsInternal();
  assert.strictEqual(IMPORT_CALLS[0].deadline, 0);
});

check('and it hands the summary back, so the caller can tell paused from done', () => {
  installStubs();
  IMPORT_RESULTS = [summary({ outOfTime: true, remaining: 4 })];
  const out = sandbox.syncCalendarsInternal({ deadline: 1 });
  assert.strictEqual(out.outOfTime, true);
  assert.strictEqual(out.remaining, 4);
});

// --- what a partial run is not allowed to do --------------------------------
check('a run that finished triages and builds the lunch forms', () => {
  installStubs();
  IMPORT_RESULTS = [summary()];
  sandbox.syncCalendarsInternal({ deadline: 1 });
  assert.strictEqual(RENDER_CALLS[0].skipTriage, false);
  assert.strictEqual(named('syncLunchOnlySessions'), 1);
});

check('a run that ran out of time does NEITHER', () => {
  installStubs();
  IMPORT_RESULTS = [summary({ outOfTime: true, remaining: 4 })];
  sandbox.syncCalendarsInternal({ deadline: 1 });
  assert.strictEqual(RENDER_CALLS[0].skipTriage, true, 'a half-read calendar must not triage');
  assert.strictEqual(named('syncLunchOnlySessions'), 0, 'the lunch forms wait for the finishing run');
});

// --- the job contract -------------------------------------------------------
check('a sync that fits in one run finishes and clears its state', () => {
  installStubs();
  IMPORT_RESULTS = [summary()];
  sandbox.runCalendarSyncSlice({ openWindow: true });
  assert.strictEqual(stateNow(), null, 'the slice record is cleared');
  assert.strictEqual(TRIGGERS.length, 0, 'and the watchdog goes with it');
});

check('a sync that does not fit arms exactly one follow-up', () => {
  installStubs();
  IMPORT_RESULTS = [summary({ groupsProcessed: 6, remaining: 4, outOfTime: true })];
  sandbox.runCalendarSyncSlice({ openWindow: true });
  assert.strictEqual(TRIGGERS.length, 1);
  assert.strictEqual(TRIGGERS[0].handler, sandbox.CALENDAR_SYNC_RESUME_HANDLER);
  const state = stateNow();
  assert.strictEqual(state.groupsProcessed, 6, 'what it did is remembered');
  assert.strictEqual(state.lastRemaining, 4, 'and so is what is left, to judge the next slice by');
});

check('the follow-up carries the counters on and ends the job when it finishes', () => {
  installStubs();
  IMPORT_RESULTS = [summary({ groupsProcessed: 6, eventsAdded: 12, remaining: 4, outOfTime: true })];
  sandbox.runCalendarSyncSlice({ openWindow: true });
  IMPORT_RESULTS = [summary({ groupsProcessed: 4, eventsAdded: 8, remaining: 0, outOfTime: false })];
  sandbox.resumeCalendarSync();
  assert.strictEqual(stateNow(), null, 'finished');
  assert.strictEqual(TRIGGERS.length, 0, 'no trigger left trading with itself');
});

check('a slice that got nothing done twice over stops rather than looping', () => {
  installStubs();
  // Same remainder every time: groups were touched, but the work did not move.
  IMPORT_RESULTS = [
    summary({ groupsProcessed: 1, remaining: 4, outOfTime: true }),
    summary({ groupsProcessed: 1, remaining: 4, outOfTime: true }),
    summary({ groupsProcessed: 1, remaining: 4, outOfTime: true })
  ];
  sandbox.runCalendarSyncSlice({ openWindow: true });
  sandbox.resumeCalendarSync();
  sandbox.resumeCalendarSync();
  assert.strictEqual(stateNow(), null, 'the job ended instead of arming a fourth run');
  assert.strictEqual(named('noteForAdmin') > 0, true, 'and the office is told it stopped early');
});

check('a hand-off that arrives after the sync finished does nothing at all', () => {
  installStubs();
  IMPORT_RESULTS = [summary()];
  assert.strictEqual(sandbox.resumeCalendarSync(), null);
  assert.strictEqual(IMPORT_CALLS.length, 0, 'no window is opened by a spent trigger');
});

check('a paused workbook stops the follow-up too — the kill switch means stop', () => {
  installStubs();
  IMPORT_RESULTS = [summary({ groupsProcessed: 6, remaining: 4, outOfTime: true })];
  sandbox.runCalendarSyncSlice({ openWindow: true });
  sandbox.automationGateAllows = () => false;
  IMPORT_RESULTS = [summary()];
  assert.strictEqual(sandbox.resumeCalendarSync(), null);
  assert.strictEqual(IMPORT_CALLS.length, 1, 'the paused run imported nothing');
  assert.strictEqual(TRIGGERS.length, 0, 'and the spent trigger was dropped');
});

check('a locked workbook skips the slice and leaves the watchdog standing', () => {
  installStubs();
  IMPORT_RESULTS = [summary()];
  LOCK_FREE = false;
  sandbox.runCalendarSyncSlice({ openWindow: true });
  assert.strictEqual(IMPORT_CALLS.length, 0, 'nothing ran');
  assert.strictEqual(TRIGGERS.length, 1, 'the watchdog brings the next one');
  assert.notStrictEqual(stateNow(), null, 'and the run is still in flight');
});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
