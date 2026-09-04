// THE MEMBER ROLL, REVAMPED (section 77).
//
// Four things are pinned here, and each of them is a way the roll used to lose
// something:
//
//   THE NAME SPLIT. The parts are derived from Display_Name where there is one
//   and from Name otherwise, and NOTHING here writes Name back: renaming
//   somebody belongs to applyMemberNameCorrection() (section 77), which does it
//   on every tab at once. A second rename path on this tab alone is how a
//   person's history gets left behind under their old spelling.
//
//   THE DEDUPE. A merge must be additive in every column. If a merge can drop
//   a staff note, a location, or a count, then the safest thing the office can
//   do with a duplicate is leave it there, and the roll never gets clean.
//
//   RETIREMENT. A retired member keeps their row and their notes, sorts below
//   the divider, and stops being offered at the door. The divider itself is a
//   real row on the sheet, so every reader has to skip it — a bug here turns a
//   row of dashes into a member called "--- RETIRED ---".
//
//   THE PASTE. A list pasted twice must add nobody the second time.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.splitPersonName = splitPersonName;
this.composeMemberName = composeMemberName;
this.backfillMemberNameParts = backfillMemberNameParts;
this.mergeMemberRollRows = mergeMemberRollRows;
this.orderMemberRollRows = orderMemberRollRows;
this.memberRollIsRetired = memberRollIsRetired;
this.memberRollStatus = memberRollStatus;
this.isMemberRollDividerValue = isMemberRollDividerValue;
this.buildMemberImportRow = buildMemberImportRow;
this.guessMemberImportField = guessMemberImportField;
this.looksLikeMemberImportHeader = looksLikeMemberImportHeader;
this.buildMemberRollImportHtml = buildMemberRollImportHtml;
this.HEADERS = HEADERS;
this.MEMBER_ROLL_STAFF_COLUMNS = MEMBER_ROLL_STAFF_COLUMNS;
this.MEMBER_ROLL_RETIRED_DIVIDER = MEMBER_ROLL_RETIRED_DIVIDER;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

const {
  splitPersonName, composeMemberName, backfillMemberNameParts, mergeMemberRollRows,
  orderMemberRollRows, memberRollIsRetired, isMemberRollDividerValue, buildMemberImportRow,
  guessMemberImportField, looksLikeMemberImportHeader, buildMemberRollImportHtml,
  HEADERS, MEMBER_ROLL_STAFF_COLUMNS, MEMBER_ROLL_RETIRED_DIVIDER, getIndexMap
} = sandbox;

const map = getIndexMap(HEADERS.Member_Roll);

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

/** A roll row from { Header: value }. */
function row(values) {
  const out = new Array(HEADERS.Member_Roll.length).fill('');
  Object.keys(values).forEach(header => { out[map[header]] = values[header]; });
  return out;
}
const read = (r, header) => r[map[header]];

// --- The split ------------------------------------------------------------
check('First Last', splitPersonName('Jane Smith'), { first: 'Jane', last: 'Smith' });
check('Last, First', splitPersonName('Delgado, Marion'), { first: 'Marion', last: 'Delgado' });
check('a middle name stays with the first', splitPersonName('Mary Ellen Carter'),
  { first: 'Mary Ellen', last: 'Carter' });
check('a suffix belongs to the surname', splitPersonName('Robert Delgado Jr'),
  { first: 'Robert', last: 'Delgado Jr' });
check('and a suffix after a comma is not a first name', splitPersonName('Delgado, Jr'),
  { first: '', last: 'Delgado Jr' });
check('a particle starts the surname', splitPersonName('Ana de la Cruz'),
  { first: 'Ana', last: 'de la Cruz' });
check('an honorific is not a first name', splitPersonName('Dr. Alan Reyes'),
  { first: 'Alan', last: 'Reyes' });
check('one word files under itself', splitPersonName('Cher'), { first: '', last: 'Cher' });
check('nothing is nothing', splitPersonName('   '), { first: '', last: '' });
check('the parts compose back', composeMemberName('Ana', 'de la Cruz'), 'Ana de la Cruz');

// A row with no parts gets them — and keeps the Name every other tab is keyed
// on, because a split is a guess and the key is not.
const legacy = row({ Name: 'marion  delgado' });
backfillMemberNameParts(legacy, map);
check('a legacy row is split', [read(legacy, 'First_Name'), read(legacy, 'Last_Name')],
  ['marion', 'delgado']);
check('and its Name is left exactly as it was', read(legacy, 'Name'), 'marion  delgado');

// Display_Name IS the office's corrected spelling, so it is what gets split.
const corrected = row({ Name: 'Bob Smtih', Display_Name: 'Robert Smith' });
backfillMemberNameParts(corrected, map);
check('the corrected spelling is the one split',
  [read(corrected, 'First_Name'), read(corrected, 'Last_Name')], ['Robert', 'Smith']);
check('and Name is still the key every other tab carries',
  read(corrected, 'Name'), 'Bob Smtih');

// Parts a person has typed are kept as typed — the refresh must not re-split
// them from a form's spelling on the next sync.
const typed = row({ Name: 'Mary Ellen Carter', First_Name: 'Mary Ellen', Last_Name: 'Carter' });
backfillMemberNameParts(typed, map);
check('typed parts are left alone',
  [read(typed, 'First_Name'), read(typed, 'Last_Name')], ['Mary Ellen', 'Carter']);

// --- The dedupe -----------------------------------------------------------
const rows = [
  row({
    Name: 'Robert Delgado', First_Name: 'Robert', Last_Name: 'Delgado', Phone: '(610) 555-0182',
    Times_Seen: 9, First_Seen: new Date('2024-03-04'), Last_Seen: new Date('2026-01-10'),
    Locations: 'Narberth', Staff_Notes: 'Brings his sister'
  }),
  row({
    Name: 'R. Delgado', First_Name: 'R.', Last_Name: 'Delgado', Phone: '610-555-0182',
    Email: 'rd@example.com', Times_Seen: 2, First_Seen: new Date('2023-11-02'),
    Last_Seen: new Date('2025-06-01'), Locations: 'Ashbridge', Dietary_Notes: 'No dairy'
  }),
  row({ Name: 'Jane Smith', First_Name: 'Jane', Last_Name: 'Smith', Times_Seen: 4 }),
  // A spouse on the same telephone number is NOT the same person.
  row({ Name: 'Elena Delgado', First_Name: 'Elena', Last_Name: 'Delgado', Phone: '610-555-0182',
        Times_Seen: 3 })
];
const merged = mergeMemberRollRows(rows, map);
check('two spellings become one row', merged.rows.length, 3);
check('and the spouse is left alone',
  merged.rows.filter(r => read(r, 'Name') === 'Elena Delgado').length, 1);

const kept = merged.rows.filter(r => String(read(r, 'Name')).indexOf('Robert') === 0)[0];
check('the longer history survives', read(kept, 'Name'), 'Robert Delgado');
check('counts add', read(kept, 'Times_Seen'), 11);
check('First_Seen widens to the earliest', new Date(read(kept, 'First_Seen')).getFullYear(), 2023);
check('Last_Seen widens to the latest', new Date(read(kept, 'Last_Seen')).getFullYear(), 2026);
check('locations union', read(kept, 'Locations'), 'Ashbridge, Narberth');
check('a blank email is filled in', read(kept, 'Email'), 'rd@example.com');
check('both sets of notes survive', [read(kept, 'Staff_Notes'), read(kept, 'Dietary_Notes')],
  ['Brings his sister', 'No dairy']);
check('and the merge leaves a receipt', read(kept, 'Merged_From'), 'R. Delgado');
check('the merge is reported', merged.merges, [{ kept: 'Robert Delgado', absorbed: 'R. Delgado' }]);

// Running it again changes nothing: the dedupe is on every write, so it has to
// be idempotent or the roll churns on every sync.
const again = mergeMemberRollRows(merged.rows, map);
check('a second pass merges nothing', again.merges.length, 0);
check('and keeps every row', again.rows.length, 3);

// --- Retirement -----------------------------------------------------------
check('blank Status is Active', memberRollIsRetired(row({ Name: 'A B' }), map), false);
check('Retired is retired', memberRollIsRetired(row({ Name: 'A B', Status: 'Retired' }), map), true);
check('so is a word nobody put on the list',
  memberRollIsRetired(row({ Name: 'A B', Status: 'Left the area' }), map), true);

const ordered = orderMemberRollRows([
  row({ Name: 'Zoe Abbot', First_Name: 'Zoe', Last_Name: 'Abbot' }),
  row({ Name: 'Bill Young', First_Name: 'Bill', Last_Name: 'Young', Status: 'Retired' }),
  row({ Name: 'Ana Nunez', First_Name: 'Ana', Last_Name: 'Nunez' })
], map);
check('the working roll sorts by surname', ordered.active.map(r => read(r, 'Name')),
  ['Zoe Abbot', 'Ana Nunez']);
check('and the retired go to their own half', ordered.retired.map(r => read(r, 'Name')),
  ['Bill Young']);

check('the divider is recognized', isMemberRollDividerValue(MEMBER_ROLL_RETIRED_DIVIDER), true);
check('and a person is not', isMemberRollDividerValue('Retired Smith'), false);
check('a blank cell is not a divider', isMemberRollDividerValue(''), false);
// The divider rides on the sheet, so the dedupe must not turn it into a member.
check('the dedupe skips the divider',
  mergeMemberRollRows([row({ Name: MEMBER_ROLL_RETIRED_DIVIDER }),
    row({ Name: 'Jane Smith', First_Name: 'Jane', Last_Name: 'Smith' })], map).rows.length, 1);

// Status and Retired_Date are staff columns, so a refresh carries them
// forward. Without that, one sync un-retires the entire roll.
check('retirement is the staff\'s to keep',
  ['Status', 'Retired_Date', 'First_Name', 'Last_Name'].every(h => MEMBER_ROLL_STAFF_COLUMNS.indexOf(h) > -1),
  true);

// --- The paste ------------------------------------------------------------
check('a header line is recognized', looksLikeMemberImportHeader(['First', 'Last', 'Phone']), true);
check('and a person is not', looksLikeMemberImportHeader(['Jane', 'Smith', '610-555-0100']), false);
check('headers map themselves, punctuation and all',
  ['Surname', 'e-mail', 'Cell', 'Dietary Notes', 'Paid?'].map(guessMemberImportField),
  ['Last_Name', 'Email', 'Phone', 'Dietary_Notes', 'Ignore']);

const pasted = buildMemberImportRow(['Delgado, Marion', '610-555-0900', 'm@example.com'],
  ['Name', 'Phone', 'Email'], map);
check('a one-column name is split on the way in',
  [read(pasted, 'First_Name'), read(pasted, 'Last_Name'), read(pasted, 'Name')],
  ['Marion', 'Delgado', 'Marion Delgado']);
check('a pasted person has no registrations yet', read(pasted, 'Times_Seen'), 0);
check('a nameless record is dropped',
  buildMemberImportRow(['', '610-555-0900'], ['Name', 'Phone'], map), null);

const retiredPaste = buildMemberImportRow(['Bill', 'Young', 'Retired'],
  ['First_Name', 'Last_Name', 'Status'], map);
check('a pasted retirement is a retirement', memberRollIsRetired(retiredPaste, map), true);
// `instanceof Date` is useless across the vm realm boundary — the script's Date
// is not this file's — so ask the value what it is instead.
check('and gets a date stamped on it',
  Object.prototype.toString.call(retiredPaste[map['Retired_Date']]), '[object Date]');

// Pasting the same list twice must add nobody the second time — which is the
// dedupe's job, not the paste's, and this is the proof they meet.
const existing = [row({ Name: 'Marion Delgado', First_Name: 'Marion', Last_Name: 'Delgado',
  Times_Seen: 6, Staff_Notes: 'Sits by the window' })];
const afterPaste = mergeMemberRollRows(existing.concat([pasted]), map);
check('a re-paste adds nobody', afterPaste.rows.length, 1);
check('and does not overwrite what was there',
  read(afterPaste.rows[0], 'Staff_Notes'), 'Sits by the window');
check('while filling in what was missing', read(afterPaste.rows[0], 'Phone'), '610-555-0900');

// The dialog is a template literal served to a browser. Nothing from the
// workbook may be interpolated into it — see tests/check_in_page.test.js.
const html = buildMemberRollImportHtml();
check('the import dialog carries its escaper', html.indexOf('function esc(') > -1, true);
check('and interpolates nothing from the workbook', html.indexOf('${') === -1, true);

console.log(failures === 0 ? '\nAll member roll checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
