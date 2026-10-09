// ============================================================================
// THE INSTANT IMPORT (99zr): A SIGNAL, NEVER A SECOND INTERPRETER, AND NEVER
// A REASON TO SKIP SOMETHING IT CANNOT VOUCH FOR.
//
// Pins:
//   1. OFF is today: no spreadsheet read, no filtering, the submit handler and
//      the hourly kick do nothing.
//   2. Linking a form: idempotent, never re-points a form linked to somebody
//      else's spreadsheet (reported instead), does re-point one linked to a
//      PREVIOUS spreadsheet of ours, and the migration only targets while on.
//   3. The backstop: the daily full read keeps every form; afterwards a linked
//      form is skipped only when mapped + baselined + unchanged; a grown,
//      unmapped, unbaselined or refused-last-time form is read.
//   4. The submit handler: names the form by its tab, falls back to '*', and
//      a burst arms ONE import.
//   5. The queue: an entry that arrived after a form's read began survives.
//   6. The import phase in event mode: reads only the queued forms, never
//      moves the clock, never clears re-import marks, never runs the form
//      migrations or the ended-form closing; the periodic window does all
//      three and commits the baseline.
//   7. importSubmittedResponses: busy / paused / in-flight answers keep the
//      queue; a landed write dequeues; processFormResponse is what read it.
// ============================================================================
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const RealDate = Date;
let NOW = new RealDate(2026, 9, 6, 11, 0, 0).getTime();

const store = {};
const props = {
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); return props; },
  deleteProperty: k => { delete store[k]; return props; },
  setProperties: o => { Object.keys(o).forEach(k => { store[k] = String(o[k]); }); return props; },
  getProperties: () => Object.assign({}, store)
};
let TRIGGERS = [];
const triggerBuilder = handler => ({
  timeBased: () => ({ after: ms => ({ create: () => { TRIGGERS.push({ handler, ms }); } }) }),
  forSpreadsheet: id => ({ onFormSubmit: () => ({ create: () => { TRIGGERS.push({ handler, ss: id }); } }) })
});

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const x = new RealDate(d);
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      if (pattern === 'yyyy') return String(x.getFullYear());
      return x.toISOString();
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    computeDigest: () => [1], base64Encode: b => String(b),
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF_8' }, sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => props },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/New_York', getSheetByName: () => null, getSheets: () => [] }),
    getUi: () => { throw new Error('no ui'); }
  },
  FormApp: { ItemType: {}, DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {
    newTrigger: triggerBuilder,
    getProjectTriggers: () => TRIGGERS.map(t => ({ getHandlerFunction: () => t.handler, __t: t })),
    deleteTrigger: t => { TRIGGERS = TRIGGERS.filter(x => x !== t.__t); }
  },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.SHARED_RESPONSES_PROP_KEY = SHARED_RESPONSES_PROP_KEY;
this.RESPONSE_SUBMIT_QUEUE_PREFIX = RESPONSE_SUBMIT_QUEUE_PREFIX;
this.INSTANT_IMPORT_HANDLER = INSTANT_IMPORT_HANDLER;
this.FORM_STATE_MIGRATIONS = FORM_STATE_MIGRATIONS;
this.LAST_SYNC_PROP_KEY = LAST_SYNC_PROP_KEY;
this.__resetIndexMemo = () => { __sharedResponseIndex = null; };
`, sandbox, { filename: 'program.gs' });

const notes = [];
sandbox.log = () => {};
sandbox.noteForAdmin = (cat, msg) => notes.push({ cat, msg });
sandbox.describeFormLink = id => `form ${id}`;
sandbox.toastIfPossible = () => {};

const clear = () => {
  Object.keys(store).forEach(k => delete store[k]);
  TRIGGERS = [];
  notes.length = 0;
  sandbox.__resetIndexMemo();
};
const turnOn = (id, previous) => {
  store[sandbox.SHARED_RESPONSES_PROP_KEY] = JSON.stringify({ enabled: true, spreadsheetId: id || 'SS', previous: previous || [] });
  sandbox.__resetIndexMemo();
};

// A fake responses spreadsheet: tabs keyed by form, each with a row count.
let TABS = [];
let OPENS = 0;
function tab(sheetId, formId, lastRow, published) {
  return {
    sheetId, formId, lastRow,
    getSheetId: () => sheetId,
    getFormUrl: () => published ? `https://docs.google.com/forms/d/e/${published}/viewform`
      : `https://docs.google.com/forms/d/${formId}/viewform`,
    getLastRow() { return this.lastRow; },
    getLastColumn: () => 10
  };
}
sandbox.SpreadsheetApp.openById = id => { OPENS++; if (id !== 'SS') throw new Error('nope'); return { getSheets: () => TABS }; };

function fakeForm(id, dest) {
  const f = {
    dest, setCalls: 0,
    getId: () => id,
    getDestinationType: () => (f.dest ? 'SPREADSHEET' : null),
    getDestinationId: () => { if (!f.dest) throw new Error('no destination'); return f.dest; },
    setDestination: (type, target) => { f.dest = target; f.setCalls++; },
    getPublishedUrl: () => `https://docs.google.com/forms/d/e/PUB${id}xxxxxxxxxxxxxx/viewform`
  };
  return f;
}

// ---------------------------------------------------------------------------
// 1. OFF IS TODAY
// ---------------------------------------------------------------------------
{
  clear();
  OPENS = 0;
  const list = ['A', 'B'];
  assert.deepStrictEqual(Array.from(sandbox.withoutUnchangedSharedResponseForms_(list, {})), list);
  assert.strictEqual(OPENS, 0, 'nothing is opened while off');
  sandbox.onSharedResponseSubmit({ range: { getSheet: () => tab(1, 'A', 2) } });
  assert.strictEqual(Object.keys(sandbox.readSubmitQueue_()).length, 0, 'the handler queues nothing while off');
  assert.strictEqual(TRIGGERS.length, 0);
  assert.strictEqual(sandbox.kickInstantImportIfOwed_(), false);
  const migration = sandbox.FORM_STATE_MIGRATIONS.filter(m => m.id === 'response_destination_r1')[0];
  assert.ok(migration, 'the migration is registered under its id');
  assert.strictEqual(migration.version, 0, 'and is not a template version');
  assert.strictEqual(migration.targets({ formId: 'A' }), false, 'it targets nothing while off');
}

// ---------------------------------------------------------------------------
// 2. LINKING
// ---------------------------------------------------------------------------
{
  clear();
  turnOn('SS', ['OLD']);
  const migration = sandbox.FORM_STATE_MIGRATIONS.filter(m => m.id === 'response_destination_r1')[0];
  assert.strictEqual(migration.targets({ formId: 'A' }), true, 'on: it targets a live form');
  store.ENDED_FORMS_CLOSED_V1 = JSON.stringify({ ENDED: { closedAt: 'x', closedByUs: true } });
  assert.strictEqual(migration.targets({ formId: 'ENDED' }), false, 'but not an ended one');

  const fresh = fakeForm('A', null);
  assert.strictEqual(sandbox.linkFormToSharedResponses(fresh).changed, 1);
  assert.strictEqual(fresh.dest, 'SS');
  assert.strictEqual(sandbox.linkFormToSharedResponses(fresh).changed, 0, 'idempotent');
  assert.strictEqual(fresh.setCalls, 1, 'no second write');

  const elsewhere = fakeForm('B', 'SOMEONE_ELSES');
  const r = sandbox.linkFormToSharedResponses(elsewhere);
  assert.strictEqual(r.changed, 0);
  assert.strictEqual(elsewhere.dest, 'SOMEONE_ELSES', 'never silently re-pointed');
  assert.ok(notes.some(n => /another|different/.test(n.msg)), 'and reported');
  sandbox.__resetIndexMemo();
  assert.strictEqual(sandbox.readSharedResponseIndex_().B.x, 'SOMEONE_ELSES');

  const rolled = fakeForm('C', 'OLD');
  assert.strictEqual(sandbox.linkFormToSharedResponses(rolled).changed, 1, 'a previous spreadsheet of ours is re-pointed');
  assert.strictEqual(rolled.dest, 'SS');

  // The index survives being bigger than one property value.
  const big = {};
  for (let i = 0; i < 400; i++) big[`FORM_${i}_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`] = { s: i, p: 'p', n: i };
  sandbox.writeSharedResponseIndex_(big);
  assert.ok(Number(store['SHARED_RESPONSE_INDEX_V1::n']) > 1, 'chunked');
  Object.keys(store).forEach(k => { if (k.indexOf('SHARED_RESPONSE_INDEX_V1::') === 0 && k !== 'SHARED_RESPONSE_INDEX_V1::n') assert.ok(store[k].length <= 8000); });
  sandbox.__resetIndexMemo();
  assert.strictEqual(Object.keys(sandbox.readSharedResponseIndex_()).length, 400, 'and reads back whole');
  sandbox.writeSharedResponseIndex_({});
  assert.strictEqual(store['SHARED_RESPONSE_INDEX_V1::1'], undefined, 'a shrunk index leaves no stale chunk');

  // Linked at birth never throws.
  const broken = { getId: () => 'Z', getDestinationType: () => { throw new Error('boom'); },
    setDestination: () => { throw new Error('boom'); }, getPublishedUrl: () => '' };
  assert.strictEqual(sandbox.linkNewFormToSharedResponses(broken), false);
}

// ---------------------------------------------------------------------------
// 3. THE BACKSTOP
// ---------------------------------------------------------------------------
{
  clear();
  turnOn('SS');
  // Real form ids are 44 characters; the URL reader insists on ten or more.
  const A = 'AAAAAAAAAAAA', B = 'BBBBBBBBBBBB';
  sandbox.writeSharedResponseIndex_({
    [A]: { s: null, p: '', n: null },
    [B]: { s: null, p: '', n: null },
    P: { s: null, p: 'PUBPxxxxxxxxxxxx', n: null },
    X: { s: null, p: '', n: null, x: 'ELSEWHERE' }
  });
  TABS = [tab(1, A, 5), tab(2, B, 3), tab(3, 'P', 7, 'PUBPxxxxxxxxxxxxyyyy')];
  const forms = [A, B, 'P', 'X', 'UNLINKED'];

  // First window of the day: everything is read, and the counts are seen.
  let plan = { windowOpenedAt: 'w1' };
  assert.deepStrictEqual(Array.from(sandbox.withoutUnchangedSharedResponseForms_(forms, plan)), forms,
    'the daily full read keeps every form');
  assert.deepStrictEqual(Object.assign({}, sandbox.readChunkedJson_('SHARED_RESPONSE_OBSERVED_V1').counts), { [A]: 5, [B]: 3, P: 7 },
    'tabs are mapped by form URL, published or not');
  plan.unreadFormIds = [B]; // B refused this window
  sandbox.commitSharedResponseBaseline_(plan);

  // Next window: A unchanged → skipped. B had no baseline (refused) → read.
  TABS[2].lastRow = 8; // P grew
  plan = { windowOpenedAt: 'w2' };
  const kept = Array.from(sandbox.withoutUnchangedSharedResponseForms_(forms, plan));
  assert.deepStrictEqual(kept, [B, 'P', 'X', 'UNLINKED'],
    'only the mapped, baselined, unchanged form is skipped');
  sandbox.commitSharedResponseBaseline_(plan);

  // Counts seen by a window that died are not committed by another one.
  sandbox.withoutUnchangedSharedResponseForms_(forms, { windowOpenedAt: 'w3' });
  TABS[0].lastRow = 50;
  sandbox.commitSharedResponseBaseline_({ windowOpenedAt: 'w4', responseCountsObserved: true });
  sandbox.__resetIndexMemo();
  assert.strictEqual(sandbox.readSharedResponseIndex_()[A].n, 5, 'a stale window commits nothing');
  TABS[0].lastRow = 5;

  // A tab row deleted by hand is a change too.
  TABS[0].lastRow = 4;
  assert.ok(sandbox.withoutUnchangedSharedResponseForms_([A], {}).indexOf(A) !== -1, 'a shrunk tab is read');

  // The spreadsheet will not open: nothing is skipped.
  turnOn('BROKEN');
  assert.deepStrictEqual(Array.from(sandbox.withoutUnchangedSharedResponseForms_(forms, {})), forms);
  turnOn('SS');

  // Tomorrow: full read again.
  NOW += 24 * 3600 * 1000;
  TABS[0].lastRow = 5;
  assert.deepStrictEqual(Array.from(sandbox.withoutUnchangedSharedResponseForms_(forms, {})), forms);
  NOW -= 24 * 3600 * 1000;
}

// ---------------------------------------------------------------------------
// 4–5. THE SUBMIT HANDLER AND THE QUEUE
// ---------------------------------------------------------------------------
{
  clear();
  turnOn('SS');
  sandbox.writeSharedResponseIndex_({ A: { s: 1, p: '', n: 5 } });
  sandbox.onSharedResponseSubmit({ range: { getSheet: () => tab(1, 'A', 6) } });
  sandbox.onSharedResponseSubmit({ range: { getSheet: () => tab(9, 'NOBODY', 2) } });
  sandbox.onSharedResponseSubmit({});
  const q = sandbox.readSubmitQueue_();
  assert.deepStrictEqual(Object.keys(q).sort(), ['*', 'A'], 'named by its tab, else the unknown marker');
  assert.strictEqual(TRIGGERS.filter(t => t.handler === sandbox.INSTANT_IMPORT_HANDLER).length, 1,
    'a burst of submissions arms ONE import');

  // Arrived after the read began: survives.
  store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'A'] = String(NOW + 5);
  sandbox.dequeueSubmittedForms_({ A: NOW });
  assert.ok(store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'A'], 'a later submission stays queued');
  sandbox.dequeueSubmittedForms_({ A: NOW + 10 });
  assert.ok(!store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'A'], 'a covered one goes');

  // The hourly kick re-arms a queue nothing is armed for.
  TRIGGERS = [];
  delete store.INSTANT_IMPORT_ARMED_V1;
  assert.strictEqual(sandbox.kickInstantImportIfOwed_(), true);
  assert.strictEqual(TRIGGERS.length, 1);
}

// ---------------------------------------------------------------------------
// 6. THE IMPORT PHASE IN EVENT MODE vs THE PERIODIC WINDOW
// ---------------------------------------------------------------------------
const calls = [];
const record = name => (...args) => { calls.push(name); };
let RESPONSES = {};
let CLOCK_WRITES = [];
let MARKS_CLEARED = [];
function installImportStubs() {
  calls.length = 0;
  CLOCK_WRITES = [];
  MARKS_CLEARED = [];
  sandbox.getOrCreateSheet = (ss, name) => ({ __name: name });
  sandbox.migrateLegacySheetNames = () => {};
  sandbox.getOrderAheadDays = () => 3;
  sandbox.getSectionedRows = () => [];
  sandbox.buildRegistryIndex = () => ({});
  sandbox.getProtectedRegistrantKeys = () => new Set();
  sandbox.getExistingRegistrantIndex = () => ({});
  sandbox.seedRegistryOccupancy = () => {};
  sandbox.getDistinctFormIds = () => ['A', 'B', 'C'];
  sandbox.withoutEndedForms = ids => ids;
  sandbox.pendingBackfillFormIds = () => ['MARKED'];
  sandbox.isFormMarkedForBackfill = id => id === 'MARKED';
  sandbox.backfillSinceFor = (id, since) => since;
  sandbox.clearBackfillMarks = ids => { MARKS_CLEARED = Array.from(ids); };
  sandbox.openFormCached = id => { calls.push(`open:${id}`); return { getResponses: () => RESPONSES[id] || [] }; };
  sandbox.getFormItemIndex = () => ({});
  // processFormResponse IS the interpreter; the stub proves it was the one called.
  sandbox.processFormResponse = (idx, response) => { calls.push(`process:${response}`); return [[response]]; };
  sandbox.flushPersistentRegistries = () => {};
  sandbox.upsertClubMembers = () => {};
  sandbox.recordAssistanceRequests = () => {};
  sandbox.runFormStateMigrations = record('runFormStateMigrations');
  sandbox.migrateFormsToCurrentTemplate = record('migrateFormsToCurrentTemplate');
  sandbox.closeEndedForms = record('closeEndedForms');
  sandbox.applyAllDatesCatchup = () => {};
  sandbox.applyClubRosterCatchup = () => {};
  sandbox.pullProgramLeaderSheetEdits = () => {};
  sandbox.applyLeaderDropsAsCancellations = () => {};
  sandbox.applyLeaderWaitlistTicks = () => {};
  sandbox.applyMemberRollContacts = () => {};
  sandbox.appendLedgerEntries = () => {};
  sandbox.takeImportLedgerEntries = () => [];
  sandbox.renderRegistrantsSheet = () => { calls.push('render'); };
  sandbox.setLastSyncTime = d => { CLOCK_WRITES.push(new RealDate(d).toISOString()); };
  ['recomputeEventRegistryCounts', 'refreshFormShapeForAllForms', 'refreshAppointmentSlotsForAllForms']
    .forEach(n => { sandbox[n] = record(n); });
}

{
  clear();
  installImportStubs();
  RESPONSES = { A: ['a1'], B: ['b1'], C: ['c1'], MARKED: ['m1'] };
  const plan = {
    eventImport: true, startedAt: NOW, windowOpenedAt: new RealDate(NOW).toISOString(),
    lastSync: new RealDate(NOW - 3600000).toISOString(), pendingFormIds: ['B'], readStartedAt: {},
    formsRead: 0, importedRows: 0, importDone: false, tail: ['counts', 'form_shapes', 'appointment_slots'], problems: []
  };
  sandbox.runRegistrationSyncPhases_({ state: plan, deadline: NOW + 60000, save: () => {} });
  assert.deepStrictEqual(calls.filter(c => /^open:/.test(c)), ['open:B'], 'only the queued form is opened');
  assert.ok(calls.indexOf('process:b1') !== -1, 'and processFormResponse read it');
  assert.ok(plan.readStartedAt.B, 'the moment its read began is recorded');
  assert.strictEqual(plan.registrantsWritten, true);
  assert.deepStrictEqual(CLOCK_WRITES, [], 'AN INSTANT IMPORT NEVER MOVES THE CLOCK');
  assert.deepStrictEqual(MARKS_CLEARED, [], 'nor clears a re-import mark');
  ['runFormStateMigrations', 'migrateFormsToCurrentTemplate', 'closeEndedForms'].forEach(name =>
    assert.ok(calls.indexOf(name) === -1, `${name} is the scheduled sync's`));
  assert.ok(calls.indexOf('recomputeEventRegistryCounts') !== -1, 'counts follow at once');
  assert.ok(calls.indexOf('refreshFormShapeForAllForms') !== -1, 'and the form labels');
}

{
  // The periodic window: every form plus the mark, clock moved, baseline committed.
  clear();
  installImportStubs();
  turnOn('SS');
  sandbox.writeSharedResponseIndex_({ A: { s: 1, p: '', n: null } });
  TABS = [tab(1, 'A', 9)];
  RESPONSES = { A: ['a1'] };
  store[sandbox.LAST_SYNC_PROP_KEY] = new RealDate(NOW - 3 * 3600000).toISOString();
  const plan = sandbox.newRegistrationSyncPlan();
  sandbox.runRegistrationSyncPhases_({ state: plan, deadline: NOW + 60000, save: () => {} });
  assert.deepStrictEqual(calls.filter(c => /^open:/.test(c)), ['open:A', 'open:B', 'open:C', 'open:MARKED']);
  assert.deepStrictEqual(CLOCK_WRITES, [plan.windowOpenedAt], 'the periodic window moves the clock');
  assert.deepStrictEqual(MARKS_CLEARED, ['MARKED']);
  ['runFormStateMigrations', 'migrateFormsToCurrentTemplate', 'closeEndedForms'].forEach(name =>
    assert.ok(calls.indexOf(name) !== -1, `${name} runs on the periodic window`));
  sandbox.__resetIndexMemo();
  assert.strictEqual(sandbox.readSharedResponseIndex_().A.n, 9, 'and the baseline is committed');
}

// ---------------------------------------------------------------------------
// 7. importSubmittedResponses
// ---------------------------------------------------------------------------
{
  clear();
  installImportStubs();
  turnOn('SS');
  let LOCK_FREE = true;
  let PAUSED = false;
  let IN_FLIGHT = false;
  let flushed = 0;
  sandbox.workbookLock = () => ({ tryLock: () => LOCK_FREE, releaseLock: () => {} });
  sandbox.automationGateAllows = () => !PAUSED;
  sandbox.isBootstrapActive = () => false;
  sandbox.isRegistrationSyncInFlight = () => IN_FLIGHT;
  sandbox.getSyncSliceBudgetMs = () => 25 * 60000;
  sandbox.flushLedger = () => { flushed++; };
  sandbox.flushAdminDigest = () => {};
  sandbox.flushDeskWritesAfterSync = () => {};
  sandbox.warmQuickMarkAfterSync_ = () => {};
  RESPONSES = { A: ['a1'], B: ['b1'] };
  store[sandbox.LAST_SYNC_PROP_KEY] = new RealDate(NOW - 3600000).toISOString();
  const lastSync = store[sandbox.LAST_SYNC_PROP_KEY];

  sandbox.queueSubmittedForm_('A', NOW - 1000);
  sandbox.queueSubmittedForm_('GONE', NOW - 1000);

  PAUSED = true;
  assert.strictEqual(sandbox.importSubmittedResponses().skipped, 'paused');
  assert.ok(store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'A'], 'paused: the queue is kept');
  PAUSED = false;

  IN_FLIGHT = true;
  TRIGGERS = [];
  assert.strictEqual(sandbox.importSubmittedResponses().skipped, 'busy');
  assert.strictEqual(TRIGGERS.length, 1, 'a sync window in flight: re-armed');
  IN_FLIGHT = false;

  LOCK_FREE = false;
  TRIGGERS = [];
  assert.strictEqual(sandbox.importSubmittedResponses().skipped, 'locked');
  assert.strictEqual(TRIGGERS.length, 1, 'the workbook busy: re-armed');
  assert.ok(store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'A']);
  LOCK_FREE = true;

  TRIGGERS = [];
  const out = sandbox.importSubmittedResponses();
  assert.strictEqual(out.imported, 1);
  assert.deepStrictEqual(calls.filter(c => /^open:/.test(c)), ['open:A'], 'only the queued, known form');
  assert.ok(!store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'A'], 'dequeued once the write landed');
  assert.ok(!store[sandbox.RESPONSE_SUBMIT_QUEUE_PREFIX + 'GONE'], 'a form nobody reads is dropped');
  assert.strictEqual(store[sandbox.LAST_SYNC_PROP_KEY], lastSync, 'the clock is where it was');
  assert.ok(flushed > 0, 'the ledger buffer is flushed');
  assert.strictEqual(TRIGGERS.length, 0, 'nothing left: nothing re-armed');

  // Turned off: nothing.
  clear();
  sandbox.queueSubmittedForm_('A', NOW);
  assert.strictEqual(sandbox.importSubmittedResponses().skipped, 'off');
}

// ---------------------------------------------------------------------------
// The status text is pure.
// ---------------------------------------------------------------------------
{
  const text = sandbox.describeSharedResponsesStatus_({ enabled: true, spreadsheetId: 'SS' },
    { A: { s: 1, n: 3 }, B: { s: null }, X: { x: 'E' } }, { A: 1 });
  assert.ok(/ON/.test(text) && /Forms linked: 2 \(tabs found for 1, counted for 1\)/.test(text));
  assert.ok(/ANOTHER spreadsheet.*1/.test(text));
}

console.log('✅ shared_response_import.test.js passed');
