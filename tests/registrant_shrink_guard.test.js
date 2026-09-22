// A REWRITE THAT WOULD EMPTY THE TAB IS REFUSED.
//
// All_Registrants is rebuilt by reading itself, clearing itself and writing the
// rows back, so the whole workbook's registrations rest on one in-memory array
// being complete at the instant of clear(). There is no second copy, which is
// why every loss so far has been recovered — when it has been recovered — out
// of Google's file version history.
//
// 99b_registrant_safety_net.gs is the guard consulted immediately before that
// clear(). What is pinned here is the calibration, because a guard that is
// wrong in either direction is worse than none: one that blocks the duplicate
// merge gets turned off, and one that waves through a wipe is decoration.
//
//   * A CATASTROPHIC SHRINK THROWS, and throws BEFORE anything is cleared.
//   * A LEGITIMATE ONE DOES NOT. Merging four duplicates out of three hundred
//     rows is a render that must go through.
//   * BOTH CONDITIONS ARE REQUIRED. Half of a four-row tab is not a fault.
//   * A GROWING OR STEADY TAB IS SILENT — the ordinary case must cost nothing
//     and say nothing.
//   * A SNAPSHOT IS TAKEN BEFORE THE REFUSAL, because the refusal's whole
//     value is that somebody can see what was about to go.
//   * A TAB WITH NO GUARD MARKER IS UNTOUCHED: triage and Lunch_Schedule are
//     projections of the calendar and are rebuilt from it.
const assert = require('assert');
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sentMail = [];
const spooled = [];
const createdFiles = [];

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '2026-09-22_0300', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {},
      deleteProperty: () => {}, getKeys: () => []
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null, getActive: () => null,
    getUi: () => ({ alert: () => {} })
  },
  MimeType: { CSV: 'text/csv' },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: {}, ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  CacheService: null,
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail: (to, subject, body) => sentMail.push({ to, subject, body })
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.guardRegistrantRowLoss_ = guardRegistrantRowLoss_;
this.__setStubs = fns => Object.keys(fns).forEach(k => { this[k] = fns[k]; });
`, sandbox);

/** A sheet double holding `count` data rows, and a note of what it was asked. */
function fakeSheet(count) {
  const calls = { dataRange: 0 };
  return {
    calls,
    getName: () => 'All_Registrants',
    getDataRange: () => {
      calls.dataRange++;
      const rows = [];
      for (let i = 0; i <= count; i++) rows.push(['Event_ID', 'Name']);
      return { getValues: () => rows };
    }
  };
}

/**
 * The three collaborators the guard reaches for, all hoisted functions, all
 * replaced in the evaluated context — which is what lets the calibration be
 * tested without a Drive, a mailbox or a spreadsheet.
 */
function stub(existingCount) {
  sentMail.length = 0; spooled.length = 0; createdFiles.length = 0;
  vm.runInContext(`
    getSectionedRows = function () {
      var rows = [];
      for (var i = 0; i < ${existingCount}; i++) rows.push([]);
      return rows;
    };
    spoolOfficeNote = function (section, message) { __spool(section, message); };
    notifyAdminUrgent = function (subject, body) { __mail(subject, body); return true; };
    getOrCreateSystemFolder = function () {
      return { createFile: function (name) { __file(name); return {}; } };
    };
  `, Object.assign(sandbox, {
    __spool: (section, message) => spooled.push({ section, message }),
    __file: name => createdFiles.push(name),
    __mail: (subject, body) => sentMail.push({ subject, body })
  }));
}

const HEADERS_STUB = ['Event_ID', 'Name'];
const rows = n => { const r = []; for (let i = 0; i < n; i++) r.push([]); return r; };

// 1. A REWRITE THAT WOULD EMPTY THE TAB. 300 rows in, 2 out: not a deletion
//    anybody performed.
stub(300);
let sheet = fakeSheet(300);
assert.throws(
  () => sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(2)),
  /Refused to rewrite/,
  'a rewrite losing 298 of 300 rows must throw');
assert.strictEqual(sentMail.length, 1, 'the office is told at once, not in tomorrow\'s digest');
assert.ok(/refused/i.test(sentMail[0].subject), 'the subject says it was refused');
assert.ok(/Nothing was deleted/.test(sentMail[0].body),
  'the message has to say the rows are still there, or somebody restores over them');
// THE SNAPSHOT IS TAKEN BEFORE THE THROW.
assert.strictEqual(createdFiles.length, 1, 'a snapshot is written before the refusal');
assert.ok(/refused-render/.test(createdFiles[0]), 'and is named for the reason');

// 2. A LEGITIMATE SHRINK GOES THROUGH. Four duplicates merged out of 300.
stub(300);
sheet = fakeSheet(300);
assert.doesNotThrow(() => sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(296)),
  'merging four duplicates must not be blocked');
assert.strictEqual(sentMail.length, 0, 'and must not raise an alarm');

// 3. BUT IT IS REPORTED once it is more than a handful.
stub(300);
sheet = fakeSheet(300);
sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(280));
assert.strictEqual(spooled.length, 1, 'twenty rows is a line in the digest');
assert.strictEqual(sentMail.length, 0, 'but not an urgent email');
assert.strictEqual(createdFiles.length, 1, 'and it is snapshotted');

// 4. BOTH CONDITIONS REQUIRED. Half of a small tab is not a fault: a four-row
//    tab losing two is over the fraction and under the row floor.
stub(8);
sheet = fakeSheet(8);
assert.doesNotThrow(() => sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(0)),
  'a tiny tab emptying is under the row floor and must not throw');

// 5. A GROWING OR STEADY TAB SAYS NOTHING AT ALL, and does not even look at the
//    sheet — the ordinary case is every render in the project.
stub(300);
sheet = fakeSheet(300);
sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(301));
sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(300));
assert.strictEqual(spooled.length + sentMail.length, 0, 'a healthy render is silent');
assert.strictEqual(sheet.calls.dataRange, 0, 'and never reads the tab for a snapshot');

// 6. NO MARKER, NO GUARD. renderFlatDateSheet passes one only for this tab.
stub(300);
sheet = fakeSheet(300);
assert.doesNotThrow(() => sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, '', rows(0)),
  'a tab that declared no guard marker is not guarded');
assert.strictEqual(sentMail.length, 0, 'and is not reported either');

// 7. A TAB BEING BUILT FOR THE FIRST TIME has nothing to protect.
stub(0);
sheet = fakeSheet(0);
assert.doesNotThrow(() => sandbox.guardRegistrantRowLoss_(sheet, HEADERS_STUB, 'Event_ID', rows(0)),
  'an empty tab must not block its own first render');

console.log('registrant_shrink_guard.test.js: all assertions passed');
