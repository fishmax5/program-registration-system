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
this.registrationSyncTailStep = registrationSyncTailStep;
this.__stubVerifierReport = function (fn) { reportLedgerVerification = fn; dailyStepDue_ = function () { return true; }; };
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
this.setTriageSide = function (rows) {
  readLedgerVerifyTriageRows_ = function () { if (rows instanceof Error) throw rows; return rows; };
};
this.spoolNotes = function (sink) { spoolOfficeNote = function (s, m) { sink.push(m); return true; }; };
`, sandbox, { filename: 'program.gs' });

const {
  HEADERS, SHEET_NAMES, getIndexMap, LEDGER_KINDS, LEDGER_SOURCES, LEDGER_VERIFY_COLUMNS,
  makeLedgerEntry, ledgerPayloadFromRow, ledgerEntriesForExistingRow,
  verifyLedgerAgainstTab, describeLedgerVerification, setVerifierSides, breakVerifierSide,
  setTriageSide
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

// --- the triage tab: the third side ------------------------------------------
//
// A row moveRegistrantsToTriage() (26) took off the tab is on triage, with no
// ledger entry saying so. It is NOT lost, and counting it in the 🚨 bucket is
// how 1,100 parked rows came to bury 160 real ones. Triage has its OWN column
// positions (a superset of the Registrants layout), so the key is read from
// those — a test row built in the Registrants layout would not prove that.
const TMAP = getIndexMap(HEADERS.Deleted_Event_Triage);
function triageRow(fields) {
  const row = new Array(HEADERS.Deleted_Event_Triage.length).fill('');
  row[TMAP['Program_Status']] = 'Active';
  row[TMAP['Person_Type']] = 'Registrant';
  Object.keys(fields).forEach(h => { row[TMAP[h]] = fields[h]; });
  return row;
}
check('triage really is laid out differently from the tab', TMAP['Event_ID'] !== MAP['Event_ID'], true);

const aheadRow = fields => tabRow(Object.assign({
  Event_ID: 'ev-2099', Event: 'Chair Yoga', Location: 'Narberth', Event_Date: new Date(2099, 0, 5)
}, fields));
const carol = aheadRow({ Name: 'Carol Ames' });
const dave = aheadRow({ Name: 'Dave Ames', Program_Status: 'Cancelled' });
const carolEntries = ledgerEntriesForExistingRow(carol, MAP);
const daveEntries = ledgerEntriesForExistingRow(dave, MAP);
const triaged = person => triageRow({
  Name: person, Event_ID: 'ev-2099', Event: 'Chair Yoga', Location: 'Narberth',
  Deleted_Event_Title: 'Chair Yoga', Deleted_Event_Location: 'Narberth'
});

setVerifierSides(joanEntries.concat(carolEntries), [joan]);
setTriageSide([triaged('Carol Ames')]);
result = verifyLedgerAgainstTab();
check('a registration parked on triage is not counted as lost', result.missingFromTab.length, 0);
check('it is counted as on triage instead', result.onTriage.map(r => r.name), ['Carol Ames']);
check('dated, so the digest can tell ahead from history',
  [result.onTriage[0].dateKey, result.onTriage[0].when], ['2099-01-05', 'future']);
let triageLines = describeLedgerVerification(result);
check('a seat still ahead on triage files ONE line and a program list, never the 🚨',
  triageLines.map(l => l.slice(0, 2)), ['📥', '  ']);
check('named by program and building, with the first date',
  triageLines[1].trim(), '• Chair Yoga (Narberth): 1, from 2099-01-05');

// The same person on triage, but for a date already gone: accounted for, and
// history — the triage tab already shows it, so a clean run still files nothing.
const pastCarol = tabRow({
  Name: 'Carol Ames', Event_ID: 'ev-2020', Event: 'Chair Yoga', Location: 'Narberth',
  Event_Date: new Date(2020, 0, 6)
});
setVerifierSides(ledgerEntriesForExistingRow(pastCarol, MAP), []);
setTriageSide([triageRow({ Name: 'Carol Ames', Event_ID: 'ev-2020' })]);
result = verifyLedgerAgainstTab();
check('a past triaged row is on triage', [result.onTriage.length, result.onTriage[0].when], [1, 'past']);
check('and files nothing', describeLedgerVerification(result), []);

// A cancellation parked on triage is nobody waiting for a seat.
setVerifierSides(daveEntries, []);
setTriageSide([triaged('Dave Ames')]);
result = verifyLedgerAgainstTab();
check('a cancelled registration on triage is accounted for', result.onTriage.length, 1);
check('and is not a seat anybody is waiting on', describeLedgerVerification(result), []);

// Matched on the same key as the other two sides: a different person on the
// same triaged session does not account for this one.
setVerifierSides(carolEntries, []);
setTriageSide([triaged('Somebody Else')]);
result = verifyLedgerAgainstTab();
check('only the same person on the same session counts', result.missingFromTab.map(r => r.name), ['Carol Ames']);

// A triage tab that cannot be read costs the run its triage answer, not the
// whole check: it says so, and the parked rows fall back into the lost bucket
// rather than vanishing from every bucket.
setVerifierSides(carolEntries, []);
setTriageSide(new Error('busy'));
result = verifyLedgerAgainstTab();
check('an unreadable triage tab is not fatal', result.ok, true);
check('the rows it would have held are counted as missing', result.missingFromTab.length, 1);
triageLines = describeLedgerVerification(result);
check('and the report says why first', triageLines[0].indexOf('Deleted_Event_Triage could not be read') !== -1, true);
setTriageSide([]);

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

// --- paused in the sync (Nov 2026) -----------------------------------------
//
// The daily sync no longer folds the ledger or files its findings: ~94 digest
// lines a day nobody was working. The step is still in the list, and still
// runs when the switch is turned back on.
{
  let reported = 0;
  sandbox.__stubVerifierReport(() => { reported++; return null; });
  const step = sandbox.registrationSyncTailStep('ledger_verify');
  check('the ledger step is still in the sync tail', !!step, true);
  step.run({});
  check('...but the sync no longer runs the verifier or files its lines', reported, 0);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll ledger verifier checks passed.');
process.exit(failures ? 1 : 0);
