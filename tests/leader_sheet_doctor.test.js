// WHY IS A ROSTER SHEET EMPTY? (section 99h).
//
// "Nobody has signed up yet" is what a program registrant sheet says about a
// class nobody has booked, and — in the same words — about a class with a
// dozen people on the Registrants tab whose rows never reached it. From the
// sheet the two are identical. This report is which of the two, per sheet, so
// what is pinned here is that the four cases produce four different answers:
//
//   NOBODY BOOKED — sessions in the window, no rows. The true answer, said as
//   such, with nothing to fix.
//
//   NOTHING RUNNING — no sessions in the window at all, which is also true and
//   is a different sentence, because "the program is not on the dashboard" is
//   a fault the other wording would hide.
//
//   STRANDED ROWS — rows naming the program that matched no session. The
//   Event_ID drift, named, with the two-step repair.
//
//   AN UNREACHABLE SHEET — the one state not knowable from the workbook, and
//   the one that has been silently stale for longest.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
      return pattern === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: (algo, raw) => {
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
      return [(h >> 24) & 255, (h >> 16) & 255, (h >> 8) & 255, h & 255];
    },
    DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/New_York' }),
    getActive: () => ({ getSpreadsheetTimeZone: () => 'America/New_York' }),
    getUi: () => { throw new Error('no ui'); }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.diagnoseLeaderSheetRosters = diagnoseLeaderSheetRosters;
this.describeLeaderSheetRosters = describeLeaderSheetRosters;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.leaderProgramKey = leaderProgramKey;
// tabText maps a fileId to what sits in its first data cell, so a test can put
// a sheet into the one state the workbook cannot see from its own tabs: the
// placeholder, under a registry entry claiming a roster.
this.__stub = function (sessions, registrants, registry, openFails, tabText) {
  getSectionedRows = (sheet, headers) =>
    (headers === HEADERS.All_Program_Sessions ? sessions : registrants);
  getProgramLeaderSheetRegistry = () => registry;
  getOrCreateSheet = ss => (ss && ss.__fileId
    ? { getRange: () => ({ getValue: () => (tabText || {})[ss.__fileId] || '' }) }
    : {});
  openSpreadsheetCached = id => {
    if (openFails && openFails.indexOf(id) !== -1) throw new Error('You do not have permission');
    return { __fileId: id };
  };
};
this.LEADER_SHEET_EMPTY_ROSTER_TEXT = LEADER_SHEET_EMPTY_ROSTER_TEXT;
`, sandbox, { filename: 'program.gs' });

const { diagnoseLeaderSheetRosters, describeLeaderSheetRosters, HEADERS, getIndexMap, leaderProgramKey } = sandbox;

let failures = 0;
function checkTrue(label, got) {
  if (got) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}`);
}

const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
const regMap = getIndexMap(HEADERS.All_Registrants);
const soon = new Date();
soon.setDate(soon.getDate() + 3);

function sessionRow(f) {
  const row = new Array(HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(f).forEach(k => { row[sessionMap[k]] = f[k]; });
  return row;
}
function registrantRow(f) {
  const row = new Array(HEADERS.All_Registrants.length).fill('');
  Object.keys(f).forEach(k => { row[regMap[k]] = f[k]; });
  return row;
}

const registry = {
  [leaderProgramKey('Computer Tech Support', 'Narberth')]:
    { title: 'Computer Tech Support', location: 'Narberth', fileId: 'FILE1', accessOpened: true },
  [leaderProgramKey('Chair Yoga', 'Narberth')]:
    { title: 'Chair Yoga', location: 'Narberth', fileId: 'FILE2', accessOpened: true },
  [leaderProgramKey('Retired Class', 'Narberth')]:
    { title: 'Retired Class', location: 'Narberth', fileId: 'FILE3', accessOpened: true },
  [leaderProgramKey('Unreachable', 'Narberth')]:
    { title: 'Unreachable', location: 'Narberth', fileId: 'GONE', accessOpened: true }
};

const sessions = [
  sessionRow({ Event_ID: 'TECH', Event_Date: soon, Clean_Title: 'Computer Tech Support', Location: 'Narberth' }),
  sessionRow({ Event_ID: 'YOGA', Event_Date: soon, Clean_Title: 'Chair Yoga', Location: 'Narberth' }),
  sessionRow({ Event_ID: 'GHOST', Event_Date: soon, Clean_Title: 'Unreachable', Location: 'Narberth' })
];

const registrants = [
  // Chair Yoga: a person who joined properly.
  registrantRow({
    Event_ID: 'YOGA', Event_Date: soon, Event: 'Chair Yoga', Location: 'Narberth',
    Name: 'Karl Hardman', Program_Status: 'Active'
  }),
  // Computer Tech Support: on the tab, naming the program, matching no session
  // — but the join's own fallback now rescues exactly this, so to produce a
  // STRANDED finding the date has to be one no session of it is running on.
  registrantRow({
    Event_ID: 'OLD-TECH-ID', Event_Date: new Date(soon.getTime() + 86400000),
    Event: 'Computer Tech Support', Location: 'Narberth',
    Name: 'Arnold Feldman', Program_Status: 'Active'
  })
];

sandbox.__stub(sessions, registrants, registry, ['GONE']);
const report = describeLeaderSheetRosters();

checkTrue('a program with sessions and stranded rows is named as drift',
  /Computer Tech Support[\s\S]*come apart from the session table/.test(report));
checkTrue('...and carries the two-step repair',
  /Repair Dashboard Links[\s\S]*Update Everything Now/.test(report));
checkTrue('a program with no sessions in the window says so instead',
  /Retired Class[\s\S]*No sessions of this program are running/.test(report));
checkTrue('a sheet that cannot be opened leads its own line',
  /Unreachable[\s\S]*could not be opened/.test(report));
checkTrue('a roster with people on it is not in the empty list',
  report.indexOf('ROSTERS WITH PEOPLE ON THEM (1)') !== -1);
checkTrue('...and says how many rows it holds',
  /Chair Yoga.*: 1 row\(s\)/.test(report));

// --- Two sheets for one program -------------------------------------------
// THE CASE THAT LOOKS HEALTHY FROM BOTH ENDS: the registry holds two entries
// for one program, the push writes the roster to one of them and stamps the
// other's refresh note, and the leader holding the second link sees "Nobody
// has signed up yet" while the workbook reports rows written. Neither side is
// lying; they are about different files.
const twinRegistry = {
  [leaderProgramKey('Computer Tech Support', 'Narberth')]:
    { title: 'Computer Tech Support', location: 'Narberth', fileId: 'LIVE', accessOpened: true },
  'computer tech support|narberth ':
    { title: 'Computer Tech Support', location: 'Narberth', fileId: 'STALE', accessOpened: true }
};
sandbox.__stub(sessions, [
  registrantRow({
    Event_ID: 'TECH', Event_Date: soon, Event: 'Computer Tech Support', Location: 'Narberth',
    Name: 'Donna Inners', Program_Status: 'Active'
  })
], twinRegistry, []);
const twinReport = describeLeaderSheetRosters();
checkTrue('two entries for one program lead the report',
  twinReport.indexOf('TWO SHEETS FOR ONE PROGRAM (1)') !== -1);
checkTrue('...and both files are named by their links',
  /LIVE\/edit[\s\S]*STALE\/edit|STALE\/edit[\s\S]*LIVE\/edit/.test(twinReport));
checkTrue('...with the row count beside each, so the live one is obvious',
  /1 row\(s\) · key/.test(twinReport) && /0 row\(s\) · key/.test(twinReport));

// --- The fingerprint that claims a roster over a tab that says nobody -------
// THE PAIR THAT SHOULD BE IMPOSSIBLE, and was not. Ten rows join onto the
// program, the registry says they were written, and the sheet the leader opens
// reads "Nobody has signed up yet." Before this, the report printed "already
// written, the next push will skip it" beside that file — true about the
// fingerprint, and the single most misleading sentence it could have offered
// the person staring at the empty sheet.
const liveRegistry = {
  [leaderProgramKey('Computer Tech Support', 'Narberth')]:
    { title: 'Computer Tech Support', location: 'Narberth', fileId: 'LIVE', accessOpened: true }
};
const oneRegistrant = [
  registrantRow({
    Event_ID: 'TECH', Event_Date: soon, Event: 'Computer Tech Support', Location: 'Narberth',
    Name: 'Donna Inners', Program_Status: 'Active'
  })
];
sandbox.__stub(sessions, oneRegistrant, liveRegistry, [],
  { LIVE: sandbox.LEADER_SHEET_EMPTY_ROSTER_TEXT });
const lyingReport = describeLeaderSheetRosters();
checkTrue('a sheet showing an empty roster it should not leads the report',
  lyingReport.indexOf('SHEETS SHOWING AN EMPTY ROSTER THEY SHOULD NOT (1)') !== -1);
checkTrue('...named with its own link, because that is the file to look at',
  /SHEETS SHOWING AN EMPTY ROSTER[\s\S]*LIVE\/edit/.test(lyingReport));
checkTrue('...and says the next sync fixes it by itself',
  /rewrites these by itself/.test(lyingReport));
checkTrue('...and the filled section stops claiming it is already written',
  lyingReport.indexOf('already written, the next push will skip it') === -1);

// The same workbook with the roster actually ON the sheet says nothing of the
// kind — a check that fires on a healthy sheet is a check that gets removed.
sandbox.__stub(sessions, oneRegistrant, liveRegistry, [], { LIVE: 'Donna Inners' });
const honestReport = describeLeaderSheetRosters();
checkTrue('a sheet that really holds its roster is not accused',
  honestReport.indexOf('SHEETS SHOWING AN EMPTY ROSTER') === -1);

// --- Two registry entries, ONE spreadsheet ---------------------------------
// Worse than two files and invisible to the twin check above, which groups on
// the program's name: both entries write the same tab in the same pass, so the
// last one reached decides what is on it while the other reports rows written.
sandbox.__stub(sessions, oneRegistrant, {
  [leaderProgramKey('Computer Tech Support', 'Narberth')]:
    { title: 'Computer Tech Support', location: 'Narberth', fileId: 'SHARED', accessOpened: true },
  [leaderProgramKey('Tech Help', 'Narberth')]:
    { title: 'Tech Help', location: 'Narberth', fileId: 'SHARED', accessOpened: true }
}, [], {});
const sharedReport = describeLeaderSheetRosters();
checkTrue('two entries naming one spreadsheet are reported',
  sharedReport.indexOf('TWO REGISTRY ENTRIES SHARING ONE SPREADSHEET (1)') !== -1);
checkTrue('...with both programs named, since the names are what differ',
  /SHARING ONE SPREADSHEET[\s\S]*Computer Tech Support[\s\S]*Tech Help/.test(sharedReport));
checkTrue('...and two differently-named entries are NOT the name-based twin case',
  sharedReport.indexOf('TWO SHEETS FOR ONE PROGRAM') === -1);

// The healthy workbook says so in one line rather than listing nothing.
sandbox.__stub(sessions, registrants, {}, []);
checkTrue('no registered sheets is not reported as a fault',
  describeLeaderSheetRosters().indexOf('None of them is empty') !== -1);

console.log(failures === 0 ? '\nAll roster-doctor checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
