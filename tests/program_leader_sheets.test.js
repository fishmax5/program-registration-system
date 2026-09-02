// THE SHEET A PROGRAM LEADER GETS, now that it is banded by session rather
// than one flat run of rows.
//
// The bands are the whole risk here. The sheet is written by this code and
// READ BACK by the same code on the next sync, and the merge that reads it
// matches people by a hidden Row_Key. A band row is a row on that sheet with
// no Row_Key at all — so if the pull ever stopped skipping it, a band would be
// read as a registrant whose five marks had just been cleared, and the merge
// would dutifully clear them in the workbook too.
//
// What is pinned here: the grouping the layout is built from, what a band
// says, and — the load-bearing one — that a sheet with bands interleaved
// through it pulls back exactly the leader's edits and nothing else.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.groupLeaderSheetRowsBySession = groupLeaderSheetRowsBySession;
this.leaderSheetSessionBandLabel = leaderSheetSessionBandLabel;
this.pullProgramLeaderSheetEdits = pullProgramLeaderSheetEdits;
this.leaderRowKey = leaderRowKey;
this.encodeLeaderSnapshot = encodeLeaderSnapshot;
this.getIndexMap = getIndexMap;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.LEADER_OWNED_COLUMNS = LEADER_OWNED_COLUMNS;
this.HEADERS = HEADERS;
this.__setRegistry = function (r) { __leaderSheetRegistryCache = r; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const map = sandbox.getIndexMap(sandbox.LEADER_SHEET_HEADERS);

/** One sheet row, with only the columns a test cares about filled in. */
function sheetRow(values) {
  const row = new Array(sandbox.LEADER_SHEET_HEADERS.length).fill('');
  Object.keys(values).forEach(k => { row[map[k]] = values[k]; });
  return row;
}

// ---------------------------------------------------------------------------
// Grouping: one band per date AND time.
// ---------------------------------------------------------------------------

const rows = [
  sheetRow({ Event_Date: new Date(2026, 8, 15), Event_Time: '10:00 AM', Name: 'Ann', Program_Status: 'Active' }),
  sheetRow({ Event_Date: new Date(2026, 8, 15), Event_Time: '10:00 AM', Name: 'Bob', Program_Status: 'Waitlisted' }),
  // Same DAY, different sitting — a separate class, so a separate band.
  sheetRow({ Event_Date: new Date(2026, 8, 15), Event_Time: '2:00 PM', Name: 'Cyd', Program_Status: 'Active' }),
  sheetRow({ Event_Date: new Date(2026, 8, 22), Event_Time: '10:00 AM', Name: 'Dee', Program_Status: 'Cancelled' })
];

const groups = sandbox.groupLeaderSheetRowsBySession(rows, map);

check('a day with two sittings is two bands, not one',
  groups.length, 3);
check('and each band holds only its own people',
  groups.map(g => g.rows.length), [2, 1, 1]);
check('the counts are the system\'s answer, per status',
  groups.map(g => [g.active, g.waitlisted, g.cancelled]),
  [[1, 1, 0], [1, 0, 0], [0, 0, 1]]);

// A row a desk added by hand can reach the sheet with no Program_Status at
// all. Counting it as nothing would make a band under-report its own class.
const blankStatus = sandbox.groupLeaderSheetRowsBySession(
  [sheetRow({ Event_Date: new Date(2026, 8, 15), Event_Time: '10:00 AM', Name: 'Eve', Program_Status: '' })], map);
check('a blank status counts as signed up, not as nothing',
  [blankStatus[0].active, blankStatus[0].waitlisted, blankStatus[0].cancelled], [1, 0, 0]);

// ---------------------------------------------------------------------------
// What a band says. Zero counts are left off — see the label's comment.
// ---------------------------------------------------------------------------

check('a band names the session and what is on it',
  sandbox.leaderSheetSessionBandLabel(groups[0]).indexOf('1 signed up') !== -1 &&
  sandbox.leaderSheetSessionBandLabel(groups[0]).indexOf('1 waitlisted') !== -1 &&
  sandbox.leaderSheetSessionBandLabel(groups[0]).indexOf('10:00 AM') !== -1,
  true);
check('and says nothing about a waitlist that does not exist',
  sandbox.leaderSheetSessionBandLabel(groups[1]).indexOf('waitlisted') === -1 &&
  sandbox.leaderSheetSessionBandLabel(groups[1]).indexOf('cancelled') === -1,
  true);
check('a session with no readable date still gets a band rather than throwing',
  sandbox.leaderSheetSessionBandLabel({ date: null, timeLabel: '', active: 0, waitlisted: 0, cancelled: 0 })
    .indexOf('Date not set'), 0);

// ---------------------------------------------------------------------------
// THE ONE THAT MATTERS: a banded sheet pulls back only the leader's edits.
// ---------------------------------------------------------------------------

const regMap = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);

function registrantRow(values) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  Object.keys(values).forEach(k => { row[regMap[k]] = values[k]; });
  return row;
}

// What the last push sent out, and therefore what the snapshot on each row
// says. Ann was untouched; Bob has since been ticked Contacted on the sheet.
//
// The four flags are BOOLEANS in a snapshot, not blanks: readLeaderValues()
// normalizes an unticked checkbox to `false` before it is encoded, and a
// snapshot written with '' would make every unticked box on the sheet look
// like something the leader had just changed.
const annSent = [false, false, false, false, ''];
const bobSent = [false, false, false, false, ''];

const sheetRows = [
  // A band. Column A carries its label, every other cell is blank — which is
  // exactly what makes it invisible to the pull.
  sheetRow({ Event_Date: 'Tue 15 Sep  ·  10:00 AM  ·  2 signed up' }),
  sheetRow({
    Event_Date: new Date(2026, 8, 15), Name: 'Ann', Contacted: false, Confirmed: false,
    Waitlisted: false, Dropped: false, Leader_Notes: '',
    Row_Key: sandbox.leaderRowKey('EV1', 'P1', 'Ann'),
    Pushed_Snapshot: sandbox.encodeLeaderSnapshot(annSent)
  }),
  sheetRow({
    Event_Date: new Date(2026, 8, 15), Name: 'Bob', Contacted: true, Confirmed: false,
    Waitlisted: false, Dropped: false, Leader_Notes: 'left a message',
    Row_Key: sandbox.leaderRowKey('EV1', 'P2', 'Bob'),
    Pushed_Snapshot: sandbox.encodeLeaderSnapshot(bobSent)
  }),
  sheetRow({ Event_Date: 'Tue 22 Sep  ·  10:00 AM  ·  1 signed up' })
];

const fakeTab = {
  getName: () => 'Sign_Up_Sheet',
  getLastRow: () => 2 + sheetRows.length,
  getLastColumn: () => sandbox.LEADER_SHEET_HEADERS.length,
  getRange: () => ({
    // readSimpleTable() reads the header row, then the data block. Both come
    // through here; the header read is one row starting at row 2.
    getValues: () => [sandbox.LEADER_SHEET_HEADERS],
    getFormulas: () => sheetRows.map(() => new Array(sandbox.LEADER_SHEET_HEADERS.length).fill(''))
  })
};

// readSimpleTable() asks for the header row and the data block separately, so
// the stub answers by shape rather than by call order.
fakeTab.getRange = (row, col, numRows) => ({
  getValues: () => (numRows === 1 && row === 2
    ? [sandbox.LEADER_SHEET_HEADERS]
    : sheetRows.slice(row - 3, row - 3 + numRows)),
  getFormulas: () => new Array(numRows).fill(0)
    .map(() => new Array(sandbox.LEADER_SHEET_HEADERS.length).fill(''))
});

sandbox.SpreadsheetApp.openById = () => ({ getSheetByName: () => fakeTab });
sandbox.__setRegistry({ 'chair yoga|narberth': { fileId: 'F1', title: 'Chair Yoga', location: 'Narberth' } });

const registrantRows = [
  registrantRow({ Event_ID: 'EV1', Party_ID: 'P1', Name: 'Ann', Contacted: false, Leader_Notes: 'staff note' }),
  registrantRow({ Event_ID: 'EV1', Party_ID: 'P2', Name: 'Bob', Contacted: false, Leader_Notes: '' })
];

const applied = sandbox.pullProgramLeaderSheetEdits(registrantRows);

check('only the cells the leader actually changed come back', applied, 2);
check("Bob's tick and note landed on his row",
  [registrantRows[1][regMap['Contacted']], registrantRows[1][regMap['Leader_Notes']]],
  [true, 'left a message']);
check("Ann's untouched cells left the workbook's own note alone",
  [registrantRows[0][regMap['Contacted']], registrantRows[0][regMap['Leader_Notes']]],
  [false, 'staff note']);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
