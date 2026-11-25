// THE SHEET A PROGRAM LEADER GETS, now that it is banded by session rather
// than one flat run of rows.
//
// Since Nov 2026 the sheet is a view-only list: nothing is read back.
//
// What is pinned here: the grouping the layout is built from, what a band
// says, and — the load-bearing one — that a sheet with bands interleaved
// through it pulls back exactly the leader's edits and nothing else.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  // formatDateKey() builds a 'yyyy-MM-dd' KEY and compares keys with < and >.
  // A stub that ignored the pattern and answered every call with a full ISO
  // timestamp turned those comparisons into comparisons of the MILLISECOND the
  // value was made in: a fixture row dated Date.now() sorts before the
  // new Date() the code under test reads a moment later, so today's session
  // read as already past and dropped out. Honour the one pattern that is a key;
  // everything else here is read with indexOf, and the full stamp still suits it.
  Utilities: {
    formatDate: (d, tz, pattern) =>
      (pattern === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : d.toISOString()),
    sleep: () => {}
  },
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
this.getIndexMap = getIndexMap;
this.isLeaderSheetWaitlistedRow = isLeaderSheetWaitlistedRow;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.LEADER_OWNED_COLUMNS = LEADER_OWNED_COLUMNS;
this.HEADERS = HEADERS;
this.__setRegistry = function (r) { __leaderSheetRegistryCache = r; };
this.ensureRegistrantSheetsForUpcomingPrograms = ensureRegistrantSheetsForUpcomingPrograms;
this.REGISTRANT_SHEET_MAX_CREATES_PER_RUN = REGISTRANT_SHEET_MAX_CREATES_PER_RUN;
this.__stubCreate = function (fn) { createProgramLeaderSheet = fn; };
// Every program has a leader here except one named "No Leader …" — only
// programs with a leader get a sheet (Nov 2026).
buildProgramLeaderIndex = () => new Proxy({}, { get: (t, k) =>
  String(k).indexOf('no leader') === 0 ? undefined : [{ name: 'Lee', emails: [] }] });
this.registrantSheetFileName = registrantSheetFileName;
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
// WHO GETS A SHEET, now that it is every program rather than only the ones
// with a notifying leader.
//
// THE FAILURES THIS PINS. (1) A calendar carrying next spring's dates must not
// build a spreadsheet per program tonight — the horizon is what stops it, and
// SpreadsheetApp.create() is the slowest call this project makes. (2) A weekly
// class must get ONE sheet, not one per date: the registry entry is what makes
// a link handed out in September still right in March. (3) A run that hits the
// cap must build the SOONEST sessions' sheets, not whatever sorted first.
// ---------------------------------------------------------------------------

const pdHeaders = sandbox.HEADERS.All_Program_Sessions;
const pdMap = sandbox.getIndexMap(pdHeaders);

function dashRow(title, location, daysOut) {
  const row = new Array(pdHeaders.length).fill('');
  row[pdMap['Event_ID']] = `${title}-${daysOut}`;
  row[pdMap['Clean_Title']] = title;
  row[pdMap['Location']] = location;
  row[pdMap['Event_Date']] = new Date(Date.now() + daysOut * 86400000);
  return row;
}

let built = [];
sandbox.__stubCreate(value => { built.push(value); });

sandbox.__setRegistry({});
built = [];
sandbox.ensureRegistrantSheetsForUpcomingPrograms(null, [
  dashRow('Chair Yoga', 'Narberth', 2),
  dashRow('Chair Yoga', 'Narberth', 9),   // same program, later — still one sheet
  dashRow('Bridge Club', 'Narberth', 40), // past the horizon
  dashRow('Art', 'Ashbridge', -3)         // already happened
]);
check('one sheet per program inside the week, and none for the rest',
  built, ['Chair Yoga|||Narberth']);

check('the same program at another site is its own sheet — the privacy boundary',
  (() => {
    built = [];
    sandbox.ensureRegistrantSheetsForUpcomingPrograms(null, [
      dashRow('Chair Yoga', 'Narberth', 1), dashRow('Chair Yoga', 'Ashbridge', 1)]);
    return built.slice().sort();
  })(),
  ['Chair Yoga|||Ashbridge', 'Chair Yoga|||Narberth']);

check('a program already holding a sheet is left completely alone',
  (() => {
    sandbox.__setRegistry({ 'chair yoga|narberth': { fileId: 'F1' } });
    built = [];
    sandbox.ensureRegistrantSheetsForUpcomingPrograms(null, [dashRow('Chair Yoga', 'Narberth', 1)]);
    sandbox.__setRegistry({});
    return built;
  })(), []);

// The cap, and the order it spends itself in.
built = [];
const many = [];
for (let i = 0; i < sandbox.REGISTRANT_SHEET_MAX_CREATES_PER_RUN + 3; i++) {
  // Named so alphabetical order is the REVERSE of soonest-first: a pass that
  // sorted by name would build the furthest-out sessions and leave tomorrow's.
  many.push(dashRow(`Program ${String.fromCharCode(90 - i)}`, 'Narberth', i));
}
sandbox.ensureRegistrantSheetsForUpcomingPrograms(null, many);
check('one run builds no more than the cap',
  built.length, sandbox.REGISTRANT_SHEET_MAX_CREATES_PER_RUN);
check('...and spends it on the soonest sessions',
  built[0], 'Program Z|||Narberth');

// A LUNCH GETS NO SHEET (Nov 2026). Each dish was its own program key, so
// every lunch date built a spreadsheet nobody read.
built = [];
sandbox.__setRegistry({});
sandbox.ensureRegistrantSheetsForUpcomingPrograms(null, [
  dashRow('Lunch @ Narberth — Cheese Lasagna', 'Narberth', 1),
  dashRow('Lunch @ Ashbridge', 'Ashbridge', 2),
  dashRow('🥡 Lunch Only (no program)', 'Narberth', 3),
  dashRow('Chair Yoga', 'Narberth', 2)
]);
check('a lunch-only session gets no registrant sheet, a program beside it still does',
  built, ['Chair Yoga|||Narberth']);

built = [];
sandbox.__setRegistry({});
sandbox.ensureRegistrantSheetsForUpcomingPrograms(null, [
  dashRow('No Leader Club', 'Narberth', 1),
  dashRow('Chair Yoga', 'Narberth', 2)
]);
check('a program with no leader gets no registrant sheet',
  built, ['Chair Yoga|||Narberth']);

check('the file is named for what is on it, not for who reads it',
  sandbox.registrantSheetFileName('Chair Yoga', 'Narberth'),
  'Registrant Sheet — Chair Yoga (Narberth)');

// WHICH LINES GET THE WASH: a waitlisted status, and only that (a view-only
// list has no Waitlisted tick of its own since Nov 2026).
{
  const m = sandbox.getIndexMap(sandbox.LEADER_SHEET_HEADERS);
  const line = over => {
    const row = new Array(sandbox.LEADER_SHEET_HEADERS.length).fill('');
    Object.keys(over).forEach(k => { row[m[k]] = over[k]; });
    return row;
  };
  check('a waitlisted status is washed',
    sandbox.isLeaderSheetWaitlistedRow(line({ Program_Status: 'Waitlisted' }), m), true);
  check('an ordinary active line is not washed',
    sandbox.isLeaderSheetWaitlistedRow(line({ Program_Status: 'Active' }), m), false);
  check('and neither is a band row',
    sandbox.isLeaderSheetWaitlistedRow(line({}), m), false);
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
