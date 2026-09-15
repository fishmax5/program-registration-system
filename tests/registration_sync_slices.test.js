// A SYNC THAT RAN OUT OF TIME, AND WHAT IT IS ALLOWED TO LEAVE BEHIND.
//
// syncRegistrations() is now a sliced job: it works until its budget is spent,
// records where it stopped, and hands the rest to a follow-up run
// (98_registration_sync_slices.gs). The whole point of the change is that
// NOTHING IS LOST when that happens, and there are exactly two ways to lose
// something —
//
//   1. Advancing the sync clock over responses that were never read. The
//      clock moves to the moment the window OPENED, and only once every form
//      in that window has been read. A slice that stopped with forms pending
//      must leave it exactly where it was, or those responses are never read
//      again by anybody.
//   2. Rewriting a form that still holds un-imported responses. The two
//      migration passes replace a form's questions, so they wait for the
//      whole form list to have been read.
//
// Everything else here is about the tail: that its steps run in order, that a
// slice which stops mid-tail hands on exactly the steps that are left, that a
// step which throws is recorded and stepped over rather than retried for ever,
// and that the unsliced entry point the form rebuilds depend on still runs the
// whole thing in one go.
//
// The heavy dependencies are replaced with recorders after the project is
// evaluated — every one of them is a hoisted function declaration, so the
// phases call the stub. What is under test is the plan, not the passes.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const RealDate = Date;
let CLOCK = new RealDate(2026, 8, 9, 9, 0, 0).getTime();

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [CLOCK])); }
    static now() { return CLOCK; }
  },
  Utilities: {
    formatDate: (d) => new RealDate(d).toISOString(),
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
    // TIMEZONE is a top-level const that asks the active spreadsheet for its
    // time zone at load, so this has to answer before the project is evaluated.
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {}
  },
  FormApp: { ItemType: {}, openById: () => { throw new Error('no form'); } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.REGISTRATION_SYNC_TAIL_STEPS = REGISTRATION_SYNC_TAIL_STEPS;
this.newRegistrationSyncPlan = newRegistrationSyncPlan;
this.runRegistrationSyncPhases_ = runRegistrationSyncPhases_;
this.runRegistrationImportPhase = runRegistrationImportPhase;
this.buildRegistrationSyncContext = buildRegistrationSyncContext;
this.syncRegistrationsInternal = syncRegistrationsInternal;
this.registrationSyncTailIds = registrationSyncTailIds;
this.getLastSyncTime = getLastSyncTime;
`, sandbox, { filename: 'program.gs' });

sandbox.SpreadsheetApp.getActiveSpreadsheet = () =>
  ({ getSheetByName: () => null, toast: () => {}, getSheets: () => [] });
sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;

// ---------------------------------------------------------------------------
// The stubs. Each records that it was called; none of them does any work.
// ---------------------------------------------------------------------------
const calls = [];
const record = name => (...args) => { calls.push({ name, args }); };

let FORM_IDS = [];
let RESPONSES_BY_FORM = {};
let FORM_REFUSALS = {};
let ROWS_WRITTEN = null;
let WRITE_FAILS = false;
let CLOCK_WRITES = [];
let TRIGGERS = [];

function installStubs() {
  calls.length = 0;
  CLOCK_WRITES = [];
  TRIGGERS = [];
  ROWS_WRITTEN = null;

  sandbox.log = () => {};
  sandbox.noteForAdmin = () => {};
  sandbox.toastIfPossible = () => {};
  sandbox.flushAdminDigest = record('flushAdminDigest');
  sandbox.isPermissionError = () => false;

  sandbox.getOrCreateSheet = (ss, name) => ({ __name: name, getName: () => name });
  sandbox.migrateLegacySheetNames = record('migrateLegacySheetNames');
  sandbox.getOrderAheadDays = () => 3;
  sandbox.getSectionedRows = () => [];
  sandbox.buildRegistryIndex = () => ({});
  sandbox.getProtectedRegistrantKeys = () => new Set();
  sandbox.getExistingRegistrantIndex = () => ({});
  sandbox.seedRegistryOccupancy = record('seedRegistryOccupancy');
  sandbox.getDistinctFormIds = () => FORM_IDS.slice();
  sandbox.openFormCached = id => {
    if (FORM_REFUSALS[id]) throw new Error(`refused ${id}`);
    return { getResponses: () => RESPONSES_BY_FORM[id] || [] };
  };
  sandbox.getFormItemIndex = () => ({});
  sandbox.processFormResponse = (index, response) => [[response]];
  sandbox.flushPersistentRegistries = record('flushPersistentRegistries');
  sandbox.upsertClubMembers = record('upsertClubMembers');
  sandbox.recordAssistanceRequests = record('recordAssistanceRequests');
  sandbox.runFormStateMigrations = record('runFormStateMigrations');
  sandbox.migrateFormsToCurrentTemplate = record('migrateFormsToCurrentTemplate');
  sandbox.applyAllDatesCatchup = record('applyAllDatesCatchup');
  sandbox.applyClubRosterCatchup = record('applyClubRosterCatchup');
  sandbox.pullProgramLeaderSheetEdits = record('pullProgramLeaderSheetEdits');
  sandbox.applyLeaderDropsAsCancellations = record('applyLeaderDropsAsCancellations');
  sandbox.applyLeaderWaitlistTicks = record('applyLeaderWaitlistTicks');
  sandbox.applyMemberRollContacts = record('applyMemberRollContacts');
  sandbox.renderRegistrantsSheet = (force, rows) => {
    if (WRITE_FAILS) throw new Error('the tab would not take it');
    calls.push({ name: 'renderRegistrantsSheet', args: [force, rows] });
    ROWS_WRITTEN = rows;
  };
  sandbox.setLastSyncTime = date => { CLOCK_WRITES.push(new RealDate(date).toISOString()); };
  sandbox.openUpFileToAnyoneWithLink = () => ({ openedUp: false });
  sandbox.describeFormLink = id => id;

  // Every tail step's work, replaced by a recorder of the same name.
  ['recomputeEventRegistryCounts', 'refreshFormShapeForAllForms', 'refreshAppointmentSlotsForAllForms',
    'updateMasterLunchDashboard', 'refreshMemoryTabs', 'renderClubMembersSheet', 'refreshClubMemberLabels',
    'ensureRegistrantSheetsForUpcomingPrograms', 'ensureProgramLeaderSheetsForNotifyingLeaders',
    'pushProgramLeaderSheets', 'notifyProgramLeadersOfRosterChanges', 'sendProgramLeaderDaySnapshotDigests',
    'inviteRegistrantsToCalendarEvents', 'sendRegistrantReminders'
  ].forEach(name => { sandbox[name] = record(name); });
  sandbox.renderProgramDashboard = (...args) => {
    calls.push({ name: 'renderProgramDashboard', args });
    return { registrantsMoved: false };
  };
}

/** A runSlicedJob-shaped ctx that writes nowhere. */
function fakeCtx(plan, deadline) {
  return { state: plan, deadline, save: () => {}, budgetMs: 0 };
}

const namesCalled = () => calls.map(c => c.name);

// ---------------------------------------------------------------------------
// 1. THE CLOCK ONLY MOVES WHEN EVERY FORM HAS BEEN READ
// ---------------------------------------------------------------------------
{
  installStubs();
  FORM_IDS = ['f1', 'f2', 'f3', 'f4'];
  RESPONSES_BY_FORM = { f1: ['r1'], f2: ['r2'], f3: ['r3'], f4: ['r4'] };
  FORM_REFUSALS = {};

  const plan = sandbox.newRegistrationSyncPlan();
  const opened = plan.windowOpenedAt;
  // A deadline already in the past: the loop reads ONE form (it never stops
  // before doing something) and hands the rest on.
  const sync = sandbox.buildRegistrationSyncContext(plan, CLOCK - 1);
  sandbox.runRegistrationImportPhase(sync);

  assert.strictEqual(plan.formsRead, 1, 'one form read on the first slice');
  assert.deepStrictEqual(plan.pendingFormIds, ['f2', 'f3', 'f4'], 'the rest are still pending');
  assert.strictEqual(plan.importDone, false, 'the import is not finished');
  assert.deepStrictEqual(CLOCK_WRITES, [],
    'THE CLOCK MUST NOT MOVE while a form in this window is unread');
  assert.ok(namesCalled().indexOf('renderRegistrantsSheet') !== -1,
    'the rows read so far are still written to the tab');
  assert.ok(namesCalled().indexOf('migrateFormsToCurrentTemplate') === -1,
    'no form is rewritten while any form still holds un-imported responses');
  assert.ok(namesCalled().indexOf('runFormStateMigrations') === -1,
    'and neither is one repaired in place');

  // The follow-up slice reads the same window, from the same lastSync.
  installStubs();
  const sync2 = sandbox.buildRegistrationSyncContext(plan, CLOCK + 60000);
  sandbox.runRegistrationImportPhase(sync2);
  assert.deepStrictEqual(plan.pendingFormIds, [], 'the remaining forms were read');
  assert.strictEqual(plan.importDone, true);
  assert.deepStrictEqual(CLOCK_WRITES, [opened],
    'the clock moves to the moment the WINDOW opened, not to now');
  assert.ok(namesCalled().indexOf('migrateFormsToCurrentTemplate') !== -1,
    'the form rewrites happen once every form has been read');
  assert.strictEqual(plan.importedRows, 4, 'all four responses were imported across the two slices');
}

// ---------------------------------------------------------------------------
// 2. A FORM THAT REFUSES IS STILL OFF THE LIST
// ---------------------------------------------------------------------------
{
  installStubs();
  FORM_IDS = ['f1', 'bad', 'f3'];
  RESPONSES_BY_FORM = { f1: ['r1'], f3: ['r3'] };
  FORM_REFUSALS = { bad: true };

  const plan = sandbox.newRegistrationSyncPlan();
  const sync = sandbox.buildRegistrationSyncContext(plan, Infinity);
  sandbox.runRegistrationImportPhase(sync);
  assert.deepStrictEqual(plan.pendingFormIds, [],
    'a form this account cannot open must not sit at the head of the list for ever');
  assert.strictEqual(plan.importDone, true);
  assert.strictEqual(plan.importedRows, 2, 'the two readable forms still came in');
}

// ---------------------------------------------------------------------------
// 3. THE ROWS DID NOT LAND: THE CLOCK STAYS PUT
// ---------------------------------------------------------------------------
{
  installStubs();
  FORM_IDS = ['f1'];
  RESPONSES_BY_FORM = { f1: ['r1'] };
  FORM_REFUSALS = {};
  WRITE_FAILS = true;

  const plan = sandbox.newRegistrationSyncPlan();
  const sync = sandbox.buildRegistrationSyncContext(plan, Infinity);
  sandbox.runRegistrationImportPhase(sync);
  WRITE_FAILS = false;

  assert.deepStrictEqual(CLOCK_WRITES, [],
    'a write that did not land must leave the responses readable next run');
  assert.ok(plan.problems.some(p => /Registrants tab/.test(p)),
    'and the office is told which step failed');
}

// ---------------------------------------------------------------------------
// 4. THE TAIL: IN ORDER, AND EXACTLY THE STEPS THAT ARE LEFT
// ---------------------------------------------------------------------------
{
  installStubs();
  FORM_IDS = [];
  RESPONSES_BY_FORM = {};
  FORM_REFUSALS = {};

  const plan = sandbox.newRegistrationSyncPlan();
  plan.importDone = true;
  plan.pendingFormIds = [];
  const allIds = Array.from(sandbox.registrationSyncTailIds());
  assert.deepStrictEqual(Array.from(plan.tail), Array.from(allIds), 'a fresh plan starts with every step');

  // A deadline that expires after four steps.
  let ran = 0;
  const startClock = CLOCK;
  const stepDeadline = startClock + 4;
  const advancing = {
    state: plan,
    get deadline() { return stepDeadline; },
    save: () => {}
  };
  // Each recorded call moves the clock on by one millisecond.
  const originalPush = calls.push.bind(calls);
  calls.push = entry => { CLOCK += 1; ran++; return originalPush(entry); };

  const first = sandbox.runRegistrationSyncPhases_(advancing);
  calls.push = originalPush;
  CLOCK = startClock;

  assert.ok(!first.finished, 'the slice handed off rather than finishing');
  assert.ok(plan.tail.length > 0, 'steps are left over');
  assert.ok(plan.tail.length < allIds.length, 'and some were done');
  const doneIds = allIds.slice(0, allIds.length - plan.tail.length);
  assert.deepStrictEqual(Array.from(plan.tail), Array.from(allIds).slice(doneIds.length),
    'what is left is the TAIL of the list, in order — never a set with holes in it');

  // The follow-up runs exactly the rest.
  installStubs();
  const second = sandbox.runRegistrationSyncPhases_(fakeCtx(plan, Infinity));
  assert.ok(second.finished, 'the follow-up finished the window');
  assert.deepStrictEqual(Array.from(plan.tail), [], 'nothing is left');
  // The order the steps ran in is the order the table declares.
  const declaredOrder = sandbox.REGISTRATION_SYNC_TAIL_STEPS.map(s => s.id);
  assert.strictEqual(declaredOrder.length, allIds.length);
  assert.ok(namesCalled().indexOf('pushProgramLeaderSheets') <
    namesCalled().indexOf('notifyProgramLeadersOfRosterChanges') ||
    namesCalled().indexOf('pushProgramLeaderSheets') === -1,
    'a leader is told about a roster only after the sheet holding it went out');
  assert.ok(namesCalled().indexOf('inviteRegistrantsToCalendarEvents') <
    namesCalled().indexOf('sendRegistrantReminders'),
    'the invitation goes before the reminder about it');
}

// ---------------------------------------------------------------------------
// 5. A TAIL STEP THAT THREW IS RECORDED AND STEPPED OVER
// ---------------------------------------------------------------------------
{
  installStubs();
  sandbox.updateMasterLunchDashboard = () => { throw new Error('the lunch tab is protected'); };

  const plan = sandbox.newRegistrationSyncPlan();
  plan.importDone = true;
  plan.pendingFormIds = [];
  const result = sandbox.runRegistrationSyncPhases_(fakeCtx(plan, Infinity));

  assert.ok(result.finished, 'one failing step does not stop the window');
  assert.deepStrictEqual(Array.from(plan.tail), [], 'and it is not retried inside this window');
  assert.ok(plan.problems.some(p => /lunch dashboard/.test(p)),
    'the failure is named in words the office can act on');
  assert.ok(namesCalled().indexOf('sendRegistrantReminders') !== -1,
    'every step after the failure still ran');
}

// ---------------------------------------------------------------------------
// 6. THE TRIAGE PASS MOVING ROWS MAKES EVERY LATER STEP RE-READ
// ---------------------------------------------------------------------------
{
  installStubs();
  sandbox.renderProgramDashboard = () => ({ registrantsMoved: true });
  const readBack = [['a row off the tab']];
  sandbox.getSectionedRows = () => readBack;

  const plan = sandbox.newRegistrationSyncPlan();
  plan.importDone = true;
  plan.pendingFormIds = [];
  const sync = sandbox.buildRegistrationSyncContext(plan, Infinity);
  sync.setRegistrantRows([['a row this run built']]);
  assert.strictEqual(sync.reusableRows()[0][0], 'a row this run built');
  sync.noteRegistrantsMoved();
  assert.strictEqual(sync.reusableRows(), null,
    'once the triage pass has moved rows, the array this run holds is not the tab');
  assert.strictEqual(sync.registrantRows(), readBack,
    'and asking for the rows reads the tab instead');
}

// ---------------------------------------------------------------------------
// 7. THE UNSLICED ENTRY POINT STILL RUNS THE WHOLE THING
// ---------------------------------------------------------------------------
{
  installStubs();
  FORM_IDS = ['f1', 'f2'];
  RESPONSES_BY_FORM = { f1: ['r1'], f2: ['r2'] };
  FORM_REFUSALS = {};
  const before = Object.keys(sandbox.PropertiesService.__store).slice();

  const result = sandbox.syncRegistrationsInternal();
  assert.ok(result.finished, 'it ran to the end with no deadline');
  assert.ok(namesCalled().indexOf('sendRegistrantReminders') !== -1, 'including the last step of the tail');
  assert.ok(!Object.keys(sandbox.PropertiesService.__store).some(
    k => k === 'REGISTRATION_SYNC_PLAN_V1' && before.indexOf(k) === -1),
    'and it wrote no plan for a follow-up run to pick up');
}

console.log('✅ registration_sync_slices.test.js passed');
