// THE LEDGER'S ONE-TIME BACKFILL (section 99o), phase 3.
//
// What is pinned here is the rule the design had to be corrected about, and
// the two things that follow from it.
//
//   IDEMPOTENCY IS RESOLVE-BEFORE-MINT, not "skip a row that already carries a
//   Registration_ID" — which keys it on the one field that is blank on every
//   row the job exists to process. The job is sliced and Apps Script kills an
//   execution with no `finally`, so a slice that died between appending the
//   entry and writing the id back leaves a blank row: a second mint there is
//   two live states for one person, which is two seats against a capacity and
//   two meals against a catering count.
//
//   A DEAD ROW IS RECORDED AS DEAD. A cancelled, waitlisted or superseded row
//   gets its `registered` entry PLUS the one entry that puts it in that state,
//   because the fold's `registered` creates an Active registration by
//   construction — so a replay built from `registered` alone would put every
//   cancelled seat in the building back. And a dead row's id has to be
//   findable again, which is why the resolution the backfill uses sees dead
//   registrations where the one every other writer uses deliberately does not.
//
//   THE IDS GO BACK AS A COLUMN WRITE. One setValues() over one column of one
//   section zone — never renderRegistrantsSheet(), which is the
//   read-self/clear/rewrite operation this whole design distrusts.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
    getUuid: () => `uuid-${++uuidN}`,
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.getIndexMap = getIndexMap;
this.LEDGER_KINDS = LEDGER_KINDS;
this.LEDGER_SOURCES = LEDGER_SOURCES;
this.LEDGER_VERIFY_COLUMNS = LEDGER_VERIFY_COLUMNS;
this.REGISTRANT_HIDDEN_COLUMNS = REGISTRANT_HIDDEN_COLUMNS;
this.foldRegistrationLedger = foldRegistrationLedger;
this.ledgerRegistrationIdsByKey = ledgerRegistrationIdsByKey;
this.ledgerEntriesForExistingRow = ledgerEntriesForExistingRow;
this.recordLedgerBackfillRow_ = recordLedgerBackfillRow_;
this.ledgerBackfillOccurredAt_ = ledgerBackfillOccurredAt_;
this.appendLedgerEntries = appendLedgerEntries;
this.pendingLedgerEntryCount = pendingLedgerEntryCount;
this.takeBufferedForTest = function () {
  const out = __ledgerBuffer.slice();
  __ledgerBuffer = [];
  return out;
};
`, sandbox, { filename: 'program.gs' });

const {
  HEADERS, getIndexMap, LEDGER_KINDS, LEDGER_SOURCES, LEDGER_VERIFY_COLUMNS,
  REGISTRANT_HIDDEN_COLUMNS, foldRegistrationLedger, ledgerRegistrationIdsByKey,
  recordLedgerBackfillRow_, ledgerBackfillOccurredAt_, takeBufferedForTest
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const MAP = getIndexMap(HEADERS.All_Registrants);
function row(fields) {
  const r = new Array(HEADERS.All_Registrants.length).fill('');
  r[MAP['Program_Status']] = 'Active';
  r[MAP['Person_Type']] = 'Registrant';
  Object.keys(fields).forEach(h => { r[MAP[h]] = fields[h]; });
  return r;
}

// --- the column, and where it may and may not be read ----------------------

check('the tab has a Registration_ID column now',
  HEADERS.All_Registrants.indexOf('Registration_ID') !== -1, true);
check('added at the END, so an older tab reads it back blank',
  HEADERS.All_Registrants[HEADERS.All_Registrants.length - 1], 'Registration_ID');
check('hidden like every other internal key',
  REGISTRANT_HIDDEN_COLUMNS.indexOf('Registration_ID') !== -1, true);
// While the backfill runs the tab's column is blank and the fold's rows carry
// ids: comparing it would put the whole workbook in bucket three and bury the
// findings during exactly the month phase 4's gate is measured over.
check('and never compared by the verifier',
  LEDGER_VERIFY_COLUMNS.indexOf('Registration_ID'), -1);

// --- one row onto the record ------------------------------------------------

takeBufferedForTest();
const joan = row({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event: 'Chair Yoga', Location: 'Ashbridge',
  Event_Date: new Date(2026, 8, 16), Meals_Ordered: 2, Lunch_Type: 'Hot', Lunch_Status: 'Needed'
});
let claimed = {};
const joanId = recordLedgerBackfillRow_(joan, MAP, claimed);
let buffered = takeBufferedForTest();
check('a live row is one registered entry', buffered.map(e => e.kind), [LEDGER_KINDS.REGISTERED]);
check('marked as a migration', buffered[0].source, LEDGER_SOURCES.MIGRATION);
check('carrying the row, not only its name', buffered[0].payload.Meals_Ordered, 2);
check('and the id it hands back is the entry’s', buffered[0].registrationId, joanId);

// Occurred_At is the session's own date — the design's "otherwise" clause, and
// the only one a row can answer: Form_Source names a RESPONSE, not a time.
const occurred = buffered[0].occurredAt;
check('Occurred_At is the session date',
  occurred ? `${occurred.getFullYear()}-${occurred.getMonth() + 1}-${occurred.getDate()}` : null,
  '2026-9-16');
check('and blank where the row has no date at all',
  ledgerBackfillOccurredAt_(row({ Name: 'X', Event_ID: 'e' }), MAP), null);

// --- a dead row is recorded as dead ----------------------------------------

const ann = row({
  Name: 'Ann Meier', Event_ID: 'ev-916', Event: 'Chair Yoga',
  Event_Date: new Date(2026, 8, 16), Program_Status: 'Cancelled', Lunch_Status: 'Cancelled'
});
recordLedgerBackfillRow_(ann, MAP, claimed);
const annEntries = takeBufferedForTest();
check('a cancelled row is registered AND cancelled',
  annEntries.map(e => e.kind), [LEDGER_KINDS.REGISTERED, LEDGER_KINDS.CANCELLED]);
check('so the replay reproduces the tab rather than reviving her',
  foldRegistrationLedger(annEntries).rows.length, 1);
check('and the row it produces is still cancelled',
  foldRegistrationLedger(annEntries).rows[0][MAP['Program_Status']], 'Cancelled');

const gone = row({ Name: 'Old Joan', Event_ID: 'ev-916', Program_Status: 'Superseded' });
recordLedgerBackfillRow_(gone, MAP, claimed);
const goneEntries = takeBufferedForTest();
check('a superseded row too', goneEntries.map(e => e.kind),
  [LEDGER_KINDS.REGISTERED, LEDGER_KINDS.SUPERSEDED]);
check('and it is not written back out as a live registration',
  foldRegistrationLedger(goneEntries).rows.length, 0);

// --- RESOLVE BEFORE YOU MINT -----------------------------------------------
//
// The slice that dies between the append and the column write. The row is
// still blank; the entry is on the tab. A second mint here is two live states
// for one person.

const ledgerSoFar = foldRegistrationLedger(annEntries.concat(goneEntries)
  .concat([{ kind: LEDGER_KINDS.REGISTERED, source: LEDGER_SOURCES.MIGRATION,
    registrationId: joanId, entryAt: new Date(), eventId: 'ev-916', name: 'Joan Meier',
    personType: 'Registrant', payload: {} }]));
claimed = ledgerRegistrationIdsByKey(ledgerSoFar);
takeBufferedForTest();

const joanAgain = row({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event: 'Chair Yoga', Event_Date: new Date(2026, 8, 16)
});
check('a blank row the ledger already holds takes the id it already has',
  recordLedgerBackfillRow_(joanAgain, MAP, claimed), joanId);
check('and nothing is appended a second time', takeBufferedForTest().length, 0);

// A DEAD row too, which is the case the live-only resolver could never answer:
// a cancelled row's id is dead the moment it is minted.
const annAgain = row({
  Name: 'Ann Meier', Event_ID: 'ev-916', Program_Status: 'Cancelled'
});
const annId = annEntries[0].registrationId;
check('a cancelled row is recognized as already recorded',
  recordLedgerBackfillRow_(annAgain, MAP, claimed), annId);
check('with no second registered entry for it', takeBufferedForTest().length, 0);

// Two tab rows sharing one key are a duplicate registration (85's dialog), and
// the backfill reproduces the tab rather than quietly collapsing them: the key
// is claimed once, and the second row mints its own.
claimed = ledgerRegistrationIdsByKey(ledgerSoFar);
const first = recordLedgerBackfillRow_(row({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event_Date: new Date(2026, 8, 16) }), MAP, claimed);
takeBufferedForTest();
const second = recordLedgerBackfillRow_(row({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event_Date: new Date(2026, 8, 16) }), MAP, claimed);
check('the first duplicate takes the recorded id', first, joanId);
check('the second gets one of its own', second !== first, true);
check('as a registered entry of its own', takeBufferedForTest().map(e => e.kind),
  [LEDGER_KINDS.REGISTERED]);

console.log(failures ? `\n${failures} failure(s)` : '\nAll ledger backfill checks passed.');
process.exit(failures ? 1 : 0);
