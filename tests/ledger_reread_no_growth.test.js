// THE RE-READ BRANCH (29) MUST NOT GROW THE LEDGER EVERY SYNC.
//
// The every-date and club catch-ups land on buildRegistrantRow()'s "same
// Party_ID, re-seen" branch every hour. The Sep 28 fix appended a `corrected`
// entry only when the TAB row moved — but a column the tab puts back between
// syncs moves it every time, and on the live workbook that was ~2,400
// identical `corrected / all-dates` entries a day (reportLedgerGrowth, 99za).
// Pinned here: a tab-side revert the ledger already knows about appends
// nothing, a real change still appends, and a registration the ledger has
// never recorded that value for still appends.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      return date.toISOString().slice(0, 10);
    },
    getUuid: () => `uuid-${++uuidN}`,
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.buildRegistrantRow = buildRegistrantRow;
this.takeImportLedgerEntries = takeImportLedgerEntries;
this.ledgerEntryToRow = ledgerEntryToRow;
this.ledgerRowToEntry = ledgerRowToEntry;
this.ledgerAlreadyRecords = ledgerAlreadyRecords;
this.LEDGER_SOURCES = LEDGER_SOURCES;
this.setLedger = function (entries) {
  readLedgerEntries = function () {
    return entries.map(function (e) { return ledgerRowToEntry(ledgerEntryToRow(e), HEADERS.Registration_Ledger); });
  };
  invalidateLedgerFold();
};
getRegistrantTombstone = function () { return null; };
computeOrderAheadFlag = function () { return ''; };
`, sandbox, { filename: 'program.gs' });

const { HEADERS, getIndexMap, buildRegistrantRow, takeImportLedgerEntries, ledgerAlreadyRecords,
  LEDGER_SOURCES, setLedger } = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const map = getIndexMap(HEADERS.All_Registrants);
const registryEntry = {
  eventId: 'cal|Book Club|2026-11-10', eventDate: new Date(2026, 10, 10), location: 'Narberth',
  cleanTitle: 'Book Club', eventTime: '10:00 AM – 11:00 AM', maxCapacity: 0
};
function build(existingRowIndex, extra) {
  return buildRegistrantRow(Object.assign({
    registryEntry, name: 'Jane Smith', personType: 'Attendee', lunchType: 'No',
    primaryRegistrant: 'Self', adminNotes: '', formEditUrl: '',
    protectedKeys: new Set(), existingRowIndex: existingRowIndex,
    submittedAt: new Date(2026, 8, 1), orderAheadDays: 3, partyId: 'ALLDATES-jane', partySize: 1,
    ledgerSource: LEDGER_SOURCES.ALL_DATES
  }, extra || {}));
}

// First sync: the row is new, and the ledger records it.
setLedger([]);
const row = build(new Map());
const first = takeImportLedgerEntries();
check('a new registration is recorded once', first.map(e => e.kind), ['registered']);
row[map['Registration_ID']] = first[0].registrationId;
setLedger(first);

const key = `${registryEntry.eventId}|${'jane smith'}|Attendee`;
const index = () => new Map([[key, row]]);

// Something on the tab puts Event_Time back between syncs; the catch-up sets it again.
row[map['Event_Time']] = '10:00 AM';
check('the reverted column is written back onto the row', (build(index()), row[map['Event_Time']]), '10:00 AM – 11:00 AM');
check('...and nothing is appended: the ledger already says so', takeImportLedgerEntries().length, 0);

// Every sync after that: still nothing.
for (let i = 0; i < 3; i++) { row[map['Event_Time']] = '10:00 AM'; build(index()); }
check('three more syncs append nothing', takeImportLedgerEntries().length, 0);

// A real change still lands.
build(index(), { mealsOrdered: 3, lunchType: 'Yes - Lunch' });
const changed = takeImportLedgerEntries();
check('a real change is still recorded', changed.map(e => e.kind), ['corrected']);

// The value the ledger has never seen is recorded, whatever the tab said before.
check('ledgerAlreadyRecords: unknown registration is not recorded', ledgerAlreadyRecords('nope', { Event: 'x' }), false);
check('ledgerAlreadyRecords: a value the fold lacks is not recorded',
  ledgerAlreadyRecords(first[0].registrationId, { Meals_Ordered: 5 }), false);
check('ledgerAlreadyRecords: a value the fold holds is recorded',
  ledgerAlreadyRecords(first[0].registrationId, { Event_Time: '10:00 AM – 11:00 AM' }), true);
check('ledgerAlreadyRecords: types matter (the fold would assign 2, not "2")',
  ledgerAlreadyRecords(first[0].registrationId, { Party_Size: '1' }), false);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall re-read ledger checks passed');
