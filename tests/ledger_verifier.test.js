// THE LEDGER'S VERIFIER (section 99n), phase 2.
//
// Phase 2 puts an append in front of nine writers and nothing reads the
// result: the Registrants tab is still the state. What makes it safe to take
// the next step later is this check, run now — and what is pinned here is that
// its three buckets stay APART, because the fix for each is a different fix.
//
//   ON THE TAB, NOT IN THE FOLD — a writer that is not appending.
//   IN THE FOLD, NOT ON THE TAB — the original fault, detected for the first
//   time: a row the tab has lost, named, rather than a count that cannot say
//   which rows went.
//   BOTH, DISAGREEING — per COLUMN, because "these rows differ" is not
//   something anybody can act on.
//
// Plus the two properties that decide whether anybody goes on reading it: a
// clean run files NOTHING (an hourly "all is well" is how a digest stops being
// read), and a run that could not read one of the two sides says so rather
// than printing an empty bucket — "nothing to report" and "nothing looked at"
// are different answers.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const spooled = [];
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
this.makeLedgerEntry = makeLedgerEntry;
this.ledgerEntryToRow = ledgerEntryToRow;
this.ledgerPayloadFromRow = ledgerPayloadFromRow;
this.ledgerEntriesForExistingRow = ledgerEntriesForExistingRow;
this.verifyLedgerAgainstTab = verifyLedgerAgainstTab;
this.describeLedgerVerification = describeLedgerVerification;
this.setVerifierSides = function (entries, rows) {
  readLedgerEntries = function () { return entries; };
  getSectionedRows = function () { return rows; };
  SpreadsheetApp.getActiveSpreadsheet = function () {
    return { getSheetByName: function () { return {}; } };
  };
};
this.breakVerifierSide = function (which) {
  if (which === 'ledger') readLedgerEntries = function () { throw new Error('busy'); };
  else getSectionedRows = function () { throw new Error('busy'); };
};
this.spoolNotes = function (sink) { spoolOfficeNote = function (s, m) { sink.push(m); return true; }; };
`, sandbox, { filename: 'program.gs' });

const {
  HEADERS, SHEET_NAMES, getIndexMap, LEDGER_KINDS, LEDGER_SOURCES, LEDGER_VERIFY_COLUMNS,
  makeLedgerEntry, ledgerPayloadFromRow, ledgerEntriesForExistingRow,
  verifyLedgerAgainstTab, describeLedgerVerification, setVerifierSides, breakVerifierSide
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
function tabRow(fields) {
  const row = new Array(HEADERS.All_Registrants.length).fill('');
  row[MAP['Program_Status']] = 'Active';
  row[MAP['Lunch_Status']] = 'No Lunch';
  row[MAP['Person_Type']] = 'Registrant';
  Object.keys(fields).forEach(h => { row[MAP[h]] = fields[h]; });
  return row;
}

const joan = tabRow({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event: 'Chair Yoga', Location: 'Ashbridge',
  Event_Date: new Date(2026, 8, 16), Meals_Ordered: 2, Lunch_Type: 'Hot', Lunch_Status: 'Needed'
});
const bob = tabRow({
  Name: 'Bob Kaplan', Event_ID: 'ev-916', Event: 'Chair Yoga', Location: 'Ashbridge',
  Event_Date: new Date(2026, 8, 16)
});

// --- a row recorded the way a migration (or an on-demand mint) records it ---

const joanEntries = ledgerEntriesForExistingRow(joan, MAP, { source: LEDGER_SOURCES.MIGRATION });
check('one registered entry for a live row', joanEntries.length, 1);
check('the payload carries the meal, not just the name', joanEntries[0].payload.Meals_Ordered, 2);
check('and the date as a date KEY, never a Date object',
  joanEntries[0].payload.Event_Date, '2026-09-16');
check('the identity is in the entry’s own columns, not repeated in the payload',
  joanEntries[0].payload.Name, undefined);

// A dead row is TWO entries: `registered` creates an Active registration by
// construction, so a cancelled row recorded with one entry folds back onto the
// tab as somebody holding the seat they gave up.
const cancelled = tabRow({
  Name: 'Ann Meier', Event_ID: 'ev-916', Event: 'Chair Yoga', Location: 'Ashbridge',
  Event_Date: new Date(2026, 8, 16), Program_Status: 'Cancelled', Lunch_Status: 'Cancelled'
});
const annEntries = ledgerEntriesForExistingRow(cancelled, MAP, { source: LEDGER_SOURCES.MIGRATION });
check('a cancelled row is registered AND cancelled', annEntries.map(e => e.kind),
  [LEDGER_KINDS.REGISTERED, LEDGER_KINDS.CANCELLED]);
check('both about one registration', annEntries[1].registrationId, annEntries[0].registrationId);
check('a waitlisted row records the waitlisting',
  ledgerEntriesForExistingRow(tabRow({ Name: 'W', Event_ID: 'e', Program_Status: 'Waitlisted' }), MAP)
    .map(e => e.kind), [LEDGER_KINDS.REGISTERED, LEDGER_KINDS.WAITLISTED]);
check('an Active row records no second entry',
  ledgerEntriesForExistingRow(bob, MAP).length, 1);

// --- the three buckets ------------------------------------------------------

setVerifierSides(joanEntries.concat(annEntries), [joan, cancelled]);
let result = verifyLedgerAgainstTab();
check('a ledger that reproduces the tab reports nothing', {
  ok: result.ok, a: result.missingFromFold.length, b: result.missingFromTab.length,
  c: result.disagreeing.length
}, { ok: true, a: 0, b: 0, c: 0 });
check('and a clean run files no line at all', describeLedgerVerification(result), []);

// BUCKET ONE: on the tab, in nobody's ledger — a writer that is not appending.
setVerifierSides(joanEntries, [joan, bob]);
result = verifyLedgerAgainstTab();
check('a row nothing appended is named', result.missingFromFold.map(r => r.name), ['Bob Kaplan']);
check('and it is not mistaken for a lost row', result.missingFromTab.length, 0);

// BUCKET TWO: in the ledger and not on the tab. THE ORIGINAL FAULT.
setVerifierSides(joanEntries.concat(ledgerEntriesForExistingRow(bob, MAP)), [joan]);
result = verifyLedgerAgainstTab();
check('a registration the tab has lost is named', result.missingFromTab.map(r => r.name), ['Bob Kaplan']);
check('the line says which session it was',
  result.missingFromTab[0].said.indexOf('Chair Yoga') !== -1, true);
const lostLines = describeLedgerVerification(result);
check('and it leads the report', lostLines[0].indexOf('NOT on') !== -1, true);

// BUCKET THREE: on both, disagreeing, PER COLUMN.
const movedMeal = tabRow({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event: 'Chair Yoga', Location: 'Ashbridge',
  Event_Date: new Date(2026, 8, 16), Meals_Ordered: 4, Lunch_Type: 'Hot', Lunch_Status: 'Needed'
});
setVerifierSides(joanEntries, [movedMeal]);
result = verifyLedgerAgainstTab();
check('a disagreement is one finding', result.disagreeing.length, 1);
check('naming the column and both answers', result.disagreeing[0].columns,
  ['Meals_Ordered: the tab says "4", the ledger says "2"']);

// A superseded row is bookkeeping rather than a registration, on both sides —
// counting it would report every resubmission in the workbook as a loss.
const superseded = tabRow({
  Name: 'Old Joan', Event_ID: 'ev-916', Program_Status: 'Superseded'
});
setVerifierSides(joanEntries, [joan, superseded]);
result = verifyLedgerAgainstTab();
check('a superseded row is out of scope', result.missingFromFold.length, 0);
check('and is not counted as checked', result.checked, 1);

// A number typed as text and the same number as a number are the same answer.
const textCount = tabRow({
  Name: 'Joan Meier', Event_ID: 'ev-916', Event: 'Chair Yoga', Location: 'Ashbridge',
  Event_Date: new Date(2026, 8, 16), Meals_Ordered: '2', Lunch_Type: 'Hot', Lunch_Status: 'Needed'
});
setVerifierSides(joanEntries, [textCount]);
check('"2" and 2 are not a disagreement', verifyLedgerAgainstTab().disagreeing.length, 0);

// --- a side that could not be read -----------------------------------------
//
// A partial pass must never be drawn as a clean bill of health: an empty
// bucket from a side nothing read is the most misleading thing this can print.
setVerifierSides(joanEntries, [joan]);
breakVerifierSide('ledger');
result = verifyLedgerAgainstTab();
check('an unreadable ledger is not a clean run', result.ok, false);
const skippedLines = describeLedgerVerification(result);
check('it says so and stops', skippedLines.length, 1);
check('naming what it could not read', skippedLines[0].indexOf('incomplete') !== -1, true);

console.log(failures ? `\n${failures} failure(s)` : '\nAll ledger verifier checks passed.');
process.exit(failures ? 1 : 0);
