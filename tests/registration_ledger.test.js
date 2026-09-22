// THE REGISTRATION LEDGER (section 99k), phase 1.
//
// Nothing calls the appender yet, so what is pinned here is the whole of what
// phase 2 will be built on top of — and the fold is the half that has to be
// right before anything reads from it, because in phase 4 its output IS
// All_Registrants.
//
//   THE VOCABULARY. A kind or a source outside the two lists THROWS at the
//   point of composition. An entry the fold does not understand is worse than
//   no entry: the append succeeds, the writer believes it recorded something,
//   and the replay drops it silently.
//
//   THE BUFFER. Appending writes nothing; flushing writes once, past the last
//   row; a flush that throws leaves its entries pending rather than losing
//   them; and an entry already written is never written twice, because a
//   doubled `registered` entry is a doubled seat.
//
//   THE REPLAY. Order is the sheet's. `registered` is the only kind that
//   creates a registration, and a second one for a live id is a reactivation
//   rather than a second seat. Statuses go through 71's own stampers, so the
//   four cells a cancellation writes are the four cells the desk writes. A
//   move clears the marks. `removed`, `superseded` and an absorbed `merged`
//   are dead and are not resurrected by a later entry — that entry is a
//   PROBLEM, reported rather than thrown, because one bad entry must not cost
//   the replay the ones after it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => d.toISOString(),
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
this.LEDGER_ENTRY_KINDS = LEDGER_ENTRY_KINDS;
this.makeLedgerEntry = makeLedgerEntry;
this.appendLedgerEntries = appendLedgerEntries;
this.pendingLedgerEntryCount = pendingLedgerEntryCount;
this.flushLedger = flushLedger;
this.ledgerEntryToRow = ledgerEntryToRow;
this.ledgerRowToEntry = ledgerRowToEntry;
this.foldRegistrationLedger = foldRegistrationLedger;
this.resolveRegistrationId = resolveRegistrationId;
this.registrantTombstoneKey = registrantTombstoneKey;
this.setLedgerSheetForTest = function (sheet) { __ledgerTestSheet = sheet; };
`, sandbox, { filename: 'program.gs' });

const {
  HEADERS, SHEET_NAMES, getIndexMap, LEDGER_KINDS, LEDGER_SOURCES, LEDGER_ENTRY_KINDS,
  makeLedgerEntry, appendLedgerEntries, pendingLedgerEntryCount, flushLedger,
  ledgerEntryToRow, ledgerRowToEntry, foldRegistrationLedger, resolveRegistrationId,
  registrantTombstoneKey
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}
function throws(label, fn, fragment) {
  try {
    fn();
  } catch (err) {
    if (String(err.message).indexOf(fragment) !== -1) { console.log(`ok   ${label}`); return; }
    failures++;
    console.log(`FAIL ${label}\n  threw    ${err.message}\n  expected to mention ${fragment}`);
    return;
  }
  failures++;
  console.log(`FAIL ${label}\n  did not throw`);
}

const RMAP = getIndexMap(HEADERS.All_Registrants);
const cell = (row, header) => row[RMAP[header]];

// --- the schema -----------------------------------------------------------

check('the ledger has a tab name of its own', SHEET_NAMES.REGISTRATION_LEDGER, 'Registration_Ledger');
check('and thirteen columns, Entry_ID first', HEADERS.Registration_Ledger, [
  'Entry_ID', 'Entry_At', 'Occurred_At', 'Kind', 'Registration_ID',
  'Event_ID', 'Name', 'Person_Type', 'Party_ID',
  'Source', 'Actor', 'Payload', 'Note'
]);
check('nine kinds, and superseded is one of them', LEDGER_ENTRY_KINDS.length, 9);
check('superseded is in the vocabulary', LEDGER_ENTRY_KINDS.indexOf('superseded') !== -1, true);

// --- composing an entry ---------------------------------------------------

const base = {
  kind: LEDGER_KINDS.REGISTERED,
  source: LEDGER_SOURCES.IMPORT,
  eventId: 'ashb-2026-09-16-chairyoga',
  name: 'Joan Meier',
  personType: 'Registrant'
};

const composed = makeLedgerEntry(base);
check('an entry mints its own Entry_ID', !!composed.entryId, true);
check('a registered entry mints the Registration_ID', !!composed.registrationId, true);
check('Entry_At is stamped', !!composed.entryAt && typeof composed.entryAt.getTime === 'function', true);
check('Occurred_At is blank rather than guessed', composed.occurredAt, null);
check('the actor is best-effort, from the session', composed.actor, 'desk@centre.org');

throws('a kind outside the vocabulary throws',
  () => makeLedgerEntry(Object.assign({}, base, { kind: 'unregistered' })), 'not one of');
throws('and so does a source',
  () => makeLedgerEntry(Object.assign({}, base, { source: 'somewhere' })), 'not one of');
throws('every kind but registered needs the id it is about',
  () => makeLedgerEntry({ kind: LEDGER_KINDS.CANCELLED, source: LEDGER_SOURCES.CANCEL_PAGE }),
  'needs the Registration_ID');

// --- the row, and back again ----------------------------------------------

const withPayload = makeLedgerEntry(Object.assign({}, base, {
  payload: { Meals_Ordered: 2, Phone: '610-555-0112' },
  note: 'Signed up on the form.'
}));
const LMAP = getIndexMap(HEADERS.Registration_Ledger);
const ledgerRow = ledgerEntryToRow(withPayload);
check('the payload is JSON in one cell',
  ledgerRow[LMAP['Payload']], '{"Meals_Ordered":2,"Phone":"610-555-0112"}');
check('an empty payload is a blank cell, not "{}"',
  ledgerEntryToRow(composed)[LMAP['Payload']], '');
check('the name is on the row, so the tab reads without a join',
  ledgerRow[LMAP['Name']], 'Joan Meier');
check('and it reads back as the entry it was',
  ledgerRowToEntry(ledgerRow).payload, { Meals_Ordered: 2, Phone: '610-555-0112' });
check('an unreadable payload does not lose the entry',
  ledgerRowToEntry(['x', new Date(), '', 'corrected', 'r1', '', '', '', '', 'import', '', '{oops', ''])
    .payload.__unparseable, '{oops');

// --- the buffer and the flush ---------------------------------------------
//
// A stub sheet standing in for the tab: it records what was written and where,
// which is the only thing the appender promises.
function stubSheet() {
  const written = [];
  let lastRow = 1;   // the header row
  return {
    written: written,
    getLastRow: () => lastRow,
    getRange: (row, col, numRows, numCols) => ({
      setValues: values => {
        written.push({ row: row, values: values });
        lastRow = row + values.length - 1;
        return { setFontWeight: () => {} };
      },
      setFontWeight: () => ({})
    }),
    setFrozenRows: () => {},
    getDataRange: () => ({ getValues: () => [] })
  };
}

let sheet = stubSheet();
sandbox.registrationLedgerSheet = () => sheet;
vm.runInContext('registrationLedgerSheet = this.registrationLedgerSheet;', sandbox);

const e1 = makeLedgerEntry(base);
const e2 = makeLedgerEntry(Object.assign({}, base, { name: 'Bob Kaplan' }));
appendLedgerEntries([e1, e2]);
check('appending writes nothing', sheet.written.length, 0);
check('it is pending', pendingLedgerEntryCount(), 2);

check('one flush is one write', flushLedger(), 2);
check('and it is one setValues, not two', sheet.written.length, 1);
check('past the last row, never over the header', sheet.written[0].row, 2);
check('carrying both entries', sheet.written[0].values.length, 2);
check('the buffer is empty afterwards', pendingLedgerEntryCount(), 0);
check('a flush with nothing pending writes nothing', flushLedger(), 0);
check('still one write', sheet.written.length, 1);

// The same entry offered twice is written once: a doubled `registered` entry
// is a doubled seat, and nothing de-duplicates the tab after the fact.
appendLedgerEntries([e1]);
check('an entry already written is not written again', flushLedger(), 0);
check('and no second write went out', sheet.written.length, 1);

// A flush that cannot write keeps what it was given, so the next one — the
// `finally` in the sliced runner — writes them instead of losing them.
const refusing = stubSheet();
refusing.getRange = () => ({ setValues: () => { throw new Error('busy'); }, setFontWeight: () => ({}) });
sheet = refusing;
const e3 = makeLedgerEntry(Object.assign({}, base, { name: 'Ann Meier' }));
appendLedgerEntries([e3]);
check('a refused flush reports nothing written', flushLedger(), 0);
check('and the entry is still pending', pendingLedgerEntryCount(), 1);

sheet = stubSheet();
check('the next flush writes it', flushLedger(), 1);
check('nothing was lost', pendingLedgerEntryCount(), 0);

// --- the fold -------------------------------------------------------------

let clock = Date.UTC(2026, 8, 14, 9, 0, 0);
function entry(fields) {
  clock += 60 * 1000;   // each entry later than the last, as the tab has them
  return makeLedgerEntry(Object.assign({ entryAt: new Date(clock) }, fields));
}

// One registration, taken and then cancelled.
const reg = entry({
  kind: LEDGER_KINDS.REGISTERED, source: LEDGER_SOURCES.IMPORT,
  eventId: 'ev-916', name: 'Joan Meier', personType: 'Registrant', partyId: 'party-1',
  payload: { Event_Date: '2026-09-16', Lunch_Type: 'Hot', Lunch_Status: 'Needed', Meals_Ordered: 1 }
});
const id = reg.registrationId;

let folded = foldRegistrationLedger([reg]);
check('a registered entry makes one row', folded.rows.length, 1);
check('with the identity it states', cell(folded.rows[0], 'Name'), 'Joan Meier');
check('the session it names', cell(folded.rows[0], 'Event_ID'), 'ev-916');
check('the party it came from', cell(folded.rows[0], 'Party_ID'), 'party-1');
check('active, because that is what registering is', cell(folded.rows[0], 'Program_Status'), 'Active');
check('and the payload assigned over it', cell(folded.rows[0], 'Meals_Ordered'), 1);
check('nothing to report', folded.problems.length, 0);
check('and the key resolves back to the id',
  resolveRegistrationId(folded.index, 'ev-916', 'Joan Meier', 'Registrant'), id);
check('a person the ledger has never heard of resolves to nothing',
  resolveRegistrationId(folded.index, 'ev-916', 'Someone Else', 'Registrant'), null);

const cancel = entry({
  kind: LEDGER_KINDS.CANCELLED, source: LEDGER_SOURCES.CANCEL_PAGE,
  registrationId: id, eventId: 'ev-916', name: 'Joan Meier',
  note: 'Cancelled from the calendar invite.'
});
folded = foldRegistrationLedger([reg, cancel]);
check('a cancellation is still a row', folded.rows.length, 1);
// THE FOUR CELLS, through 71's own stamper rather than a fourth copy of them.
check('Program_Status', cell(folded.rows[0], 'Program_Status'), 'Cancelled');
check('Lunch_Status with it', cell(folded.rows[0], 'Lunch_Status'), 'Cancelled');
check('Manual_Override, which is what stops a re-derivation undoing it',
  cell(folded.rows[0], 'Manual_Override'), 'Manually Edited');
check('and a sentence in Admin_Notes',
  String(cell(folded.rows[0], 'Admin_Notes')).indexOf('Cancelled') === 0, true);

// Registering somebody who already has a live registration is the ordinary
// case — they cancelled and signed up again — and it is never a second seat.
const again = entry({
  kind: LEDGER_KINDS.REGISTERED, source: LEDGER_SOURCES.QUICK_MARK,
  registrationId: id, eventId: 'ev-916', name: 'Joan Meier'
});
folded = foldRegistrationLedger([reg, cancel, again]);
check('a second registered entry on a live id is not a second row', folded.rows.length, 1);
check('it is a reactivation', cell(folded.rows[0], 'Program_Status'), 'Active');
check('and the meal comes back from Lunch_Type, not from memory',
  cell(folded.rows[0], 'Lunch_Status'), 'Needed');

// The waitlist, and coming off it.
const wait = entry({
  kind: LEDGER_KINDS.WAITLISTED, source: LEDGER_SOURCES.QUICK_MARK,
  registrationId: id, name: 'Joan Meier'
});
folded = foldRegistrationLedger([reg, wait]);
check('waitlisted is a status, not an ending', cell(folded.rows[0], 'Program_Status'), 'Waitlisted');
check('and the meal goes with it', cell(folded.rows[0], 'Lunch_Status'), 'Waitlisted');

const back = entry({
  kind: LEDGER_KINDS.REACTIVATED, source: LEDGER_SOURCES.LEADER_SHEET,
  registrationId: id, name: 'Joan Meier'
});
folded = foldRegistrationLedger([reg, wait, back]);
check('reactivated takes them back off it', cell(folded.rows[0], 'Program_Status'), 'Active');

// A move: the destination is on the entry, the origin is in the payload, and
// the marks do not travel because "attended" is a fact about a day.
const marked = entry({
  kind: LEDGER_KINDS.CORRECTED, source: LEDGER_SOURCES.QUICK_MARK,
  registrationId: id, name: 'Joan Meier',
  payload: { Attended: true, Lunch_Served: true }
});
const moved = entry({
  kind: LEDGER_KINDS.MOVED, source: LEDGER_SOURCES.CHANGE_PANEL,
  registrationId: id, eventId: 'ev-923', name: 'Joan Meier',
  payload: { from: 'ev-916', Event_Date: '2026-09-23', Event_Time: '10:00 AM' }
});
folded = foldRegistrationLedger([reg, marked, moved]);
check('the move lands on the destination', cell(folded.rows[0], 'Event_ID'), 'ev-923');
check('carrying the new date', cell(folded.rows[0], 'Event_Date'), '2026-09-23');
check('and the time as the words the tab carries', cell(folded.rows[0], 'Event_Time'), '10:00 AM');
check('the attendance mark does not travel', cell(folded.rows[0], 'Attended'), false);
check('nor does the meal mark', cell(folded.rows[0], 'Lunch_Served'), false);
check('and "from" is recorded rather than replayed onto the row', folded.problems.length, 0);

// A correction is the fields it names and no others.
const corrected = entry({
  kind: LEDGER_KINDS.CORRECTED, source: LEDGER_SOURCES.CHANGE_PANEL,
  registrationId: id, name: 'Joan Meier', payload: { Phone: '610-555-0113' }
});
folded = foldRegistrationLedger([reg, corrected]);
check('the corrected field changes', cell(folded.rows[0], 'Phone'), '610-555-0113');
check('and the ones it did not name do not', cell(folded.rows[0], 'Meals_Ordered'), 1);

// A payload key that is not a column is reported: a writer appending
// "Attending" where the column is "Attended" is a correction that never lands,
// and it is silent in every other way.
const misspelt = entry({
  kind: LEDGER_KINDS.CORRECTED, source: LEDGER_SOURCES.CHANGE_PANEL,
  registrationId: id, name: 'Joan Meier', payload: { Attending: true }
});
folded = foldRegistrationLedger([reg, misspelt]);
check('a payload key that is not a column is a problem', folded.problems.length, 1);
check('named in full', folded.problems[0].reason.indexOf('"Attending"') !== -1, true);
check('and the rest of the entry still lands', folded.rows.length, 1);

// Removal, and what it is not.
const removed = entry({
  kind: LEDGER_KINDS.REMOVED, source: LEDGER_SOURCES.REMOVE_SWEEP,
  registrationId: id, name: 'Joan Meier'
});
folded = foldRegistrationLedger([reg, removed]);
check('a removed registration is not a row at all', folded.rows.length, 0);
check('the state remembers why', folded.states[id].deadBy, 'removed');

const afterDeath = entry({
  kind: LEDGER_KINDS.CORRECTED, source: LEDGER_SOURCES.QUICK_MARK,
  registrationId: id, name: 'Joan Meier', payload: { Attended: true }
});
folded = foldRegistrationLedger([reg, removed, afterDeath]);
check('a later correction does not resurrect it', folded.rows.length, 0);
check('and it is reported rather than thrown', folded.problems.length, 1);
check('saying what killed it', folded.problems[0].reason.indexOf('removed') !== -1, true);

const rebirth = entry({
  kind: LEDGER_KINDS.REGISTERED, source: LEDGER_SOURCES.DOOR,
  registrationId: id, name: 'Joan Meier'
});
folded = foldRegistrationLedger([reg, removed, rebirth]);
check('nor does a registered entry under the same dead id', folded.rows.length, 0);

// Superseded: the newer submission replaced this one, and the replay must not
// put both seats back.
const sup = entry({
  kind: LEDGER_KINDS.SUPERSEDED, source: LEDGER_SOURCES.IMPORT,
  registrationId: id, name: 'Joan Meier', payload: { by: 'other-id' }
});
folded = foldRegistrationLedger([reg, sup]);
check('a superseded registration is not written out', folded.rows.length, 0);

// A merge: one survivor, one absorbed, and the arithmetic is the entry's.
const regB = entry({
  kind: LEDGER_KINDS.REGISTERED, source: LEDGER_SOURCES.DOOR,
  eventId: 'ev-916', name: 'Joan Meier', personType: 'Registrant',
  payload: { Meals_Ordered: 2 }
});
const merged = entry({
  kind: LEDGER_KINDS.MERGED, source: LEDGER_SOURCES.DEDUPE,
  registrationId: id, eventId: 'ev-916', name: 'Joan Meier',
  payload: { absorbed: regB.registrationId, Meals_Ordered: 3 }
});
folded = foldRegistrationLedger([reg, regB, merged]);
check('two registrations become one row', folded.rows.length, 1);
check('the survivor keeps its id', folded.rows[0][RMAP['Event_ID']], 'ev-916');
check('the absorbed one is dead', folded.states[regB.registrationId].dead, true);
check('and the numbers are the merge\'s own, not re-derived',
  cell(folded.rows[0], 'Meals_Ordered'), 3);

const orphanMerge = entry({
  kind: LEDGER_KINDS.MERGED, source: LEDGER_SOURCES.DEDUPE,
  registrationId: id, name: 'Joan Meier', payload: { absorbed: 'nobody' }
});
folded = foldRegistrationLedger([reg, orphanMerge]);
check('absorbing a registration that is not there is a problem', folded.problems.length, 1);
check('and the survivor survives', folded.rows.length, 1);

// An entry about a registration that was never registered.
const orphan = entry({
  kind: LEDGER_KINDS.CANCELLED, source: LEDGER_SOURCES.CANCEL_PAGE,
  registrationId: 'never-seen', name: 'Nobody'
});
folded = foldRegistrationLedger([reg, orphan]);
check('an entry with no registration behind it is dropped', folded.rows.length, 1);
check('and reported', folded.problems[0].reason.indexOf('no registration with this id') !== -1, true);

// THE ORDER IS THE SHEET'S. Handed the entries backwards, the replay reaches
// the same answer, because Entry_At decides and the row order only breaks ties.
folded = foldRegistrationLedger([cancel, reg]);
check('out of order, the last word still wins', cell(folded.rows[0], 'Program_Status'), 'Cancelled');

// Two registrations, two rows, in the order they were first registered.
const other = entry({
  kind: LEDGER_KINDS.REGISTERED, source: LEDGER_SOURCES.IMPORT,
  eventId: 'ev-916', name: 'Bob Kaplan', personType: 'Registrant'
});
folded = foldRegistrationLedger([reg, other]);
check('two registrations are two rows', folded.rows.length, 2);
check('in registration order', folded.rows.map(r => cell(r, 'Name')), ['Joan Meier', 'Bob Kaplan']);
check('each resolvable by its own key',
  resolveRegistrationId(folded.index, 'ev-916', 'Bob Kaplan', 'Registrant'), other.registrationId);

// An empty ledger is an empty workbook, not a fault: before phase 2 that is
// every workbook there is.
check('an empty ledger folds to nothing', foldRegistrationLedger([]).rows.length, 0);
check('and so does a null one', foldRegistrationLedger(null).problems.length, 0);

console.log(failures ? `\n${failures} failure(s)` : '\nAll registration ledger checks passed.');
process.exit(failures ? 1 : 0);
