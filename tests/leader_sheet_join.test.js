// HOW A REGISTRANT ROW FINDS ITS PROGRAM'S SHEET (section 46).
//
// A registrant row reaches a program registrant sheet through its Event_ID and
// nothing else. That is the right key — the session table is what knows a
// session's title and location, and a renamed program's older rows still carry
// the old title — but an Event_ID is DERIVED from the event's clean title, so
// anything that changes what "clean" means re-keys every session of a program
// and strands every row written under the old key. The sessions are still on
// the dashboard, the people are still on the Registrants tab, and the leader's
// sheet says "Nobody has signed up yet".
//
// So what is pinned here is the second way in and its limits:
//
//   THE HEALTHY CASE IS UNCHANGED. A row whose Event_ID names a session lands
//   on that session's program, whatever its own title text says.
//
//   A STRANDED ROW IS MATCHED ON TITLE, BUILDING AND DATE — all three, against
//   a session that is actually running, which is the same identity the sheet
//   itself is keyed on.
//
//   AND NOTHING ELSE IS. A lunch row, another building, another date and a
//   program with no session that day are each left where they were.
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
    computeDigest: () => [1, 2, 3, 4], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildLeaderSheetRowsByProgram = buildLeaderSheetRowsByProgram;
this.countStrandedRegistrantRows_ = countStrandedRegistrantRows_;
this.leaderProgramKey = leaderProgramKey;
this.HEADERS = HEADERS;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

const {
  buildLeaderSheetRowsByProgram, countStrandedRegistrantRows_, leaderProgramKey,
  HEADERS, LEADER_SHEET_HEADERS, getIndexMap
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
const regMap = getIndexMap(HEADERS.All_Registrants);
const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);

// Relative to today, because the window this join uses is: see
// LEADER_SHEET_BACK_DAYS / LEADER_SHEET_FORWARD_DAYS. A fixture pinned to a
// month expires; this one does not.
const soon = new Date();
soon.setDate(soon.getDate() + 4);
const beyond = new Date();
beyond.setDate(beyond.getDate() + 400);

function sessionRow(fields) {
  const row = new Array(HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(fields).forEach(key => { row[sessionMap[key]] = fields[key]; });
  return row;
}
function registrantRow(fields) {
  const row = new Array(HEADERS.All_Registrants.length).fill('');
  Object.keys(fields).forEach(key => { row[regMap[key]] = fields[key]; });
  return row;
}

const sessions = [
  sessionRow({
    Event_ID: 'NEWID', Event_Date: soon, Clean_Title: 'Computer Tech Support', Location: 'Narberth'
  }),
  sessionRow({
    Event_ID: 'OTHER', Event_Date: soon, Clean_Title: 'Chair Yoga', Location: 'Narberth'
  })
];

const tech = leaderProgramKey('Computer Tech Support', 'Narberth');
const names = programRows => (programRows || []).map(r => r[sheetMap['Name']]);

// --- The healthy case ------------------------------------------------------
const byId = buildLeaderSheetRowsByProgram(sessions, [
  registrantRow({
    Event_ID: 'NEWID', Event_Date: soon, Event: 'whatever the row calls it',
    Location: 'Narberth', Name: 'Donna Inners', Program_Status: 'Active'
  })
]);
check('an Event_ID that names a session still decides the program',
  names(byId[tech]), ['Donna Inners']);

// --- The stranded row ------------------------------------------------------
const stranded = buildLeaderSheetRowsByProgram(sessions, [
  registrantRow({
    Event_ID: 'OLDID-FROM-A-TITLE-THAT-CHANGED', Event_Date: soon,
    Event: 'Computer Tech Support', Location: 'Narberth',
    Name: 'Arnold Feldman', Program_Status: 'Active'
  })
]);
check('a row whose Event_ID matches nothing is found by title, building and date',
  names(stranded[tech]), ['Arnold Feldman']);

// --- And nothing else is ---------------------------------------------------
const notPulledIn = buildLeaderSheetRowsByProgram(sessions, [
  // Lunch is its own thing and its Event names a menu, not a program.
  registrantRow({
    Event_ID: 'LUNCHONLY:x', Event_Date: soon, Event: 'Lunch @ Narberth — Chicken Salad',
    Location: 'Narberth', Name: 'A Luncher', Program_Status: 'Active'
  }),
  // Same program, the other building — which is the privacy boundary the key
  // exists for, so it must not be crossed by the fallback either.
  registrantRow({
    Event_ID: 'GONE', Event_Date: soon, Event: 'Computer Tech Support',
    Location: 'Ashbridge', Name: 'Wrong Building', Program_Status: 'Active'
  }),
  // A date with no session of that program on it.
  registrantRow({
    Event_ID: 'GONE2', Event_Date: beyond, Event: 'Computer Tech Support',
    Location: 'Narberth', Name: 'Out Of Window', Program_Status: 'Active'
  }),
  // Superseded rows are bookkeeping wherever they come from.
  registrantRow({
    Event_ID: 'GONE3', Event_Date: soon, Event: 'Computer Tech Support',
    Location: 'Narberth', Name: 'Replaced', Program_Status: 'Superseded'
  })
]);
check('nothing else is pulled onto the sheet', names(notPulledIn[tech]), []);

// --- What the office is told when a roster comes out empty -----------------
// Counted only to decide whether to report; it never changes what the sheet
// holds. A superseded row is not a person waiting to be told about.
check('the stranded count names the rows the sheet is missing',
  countStrandedRegistrantRows_({ title: 'Computer Tech Support', location: 'Narberth' }, [
    registrantRow({
      Event_ID: 'GONE', Event_Date: soon, Event: 'Computer Tech Support',
      Location: 'Narberth', Name: 'Arnold Feldman', Program_Status: 'Active'
    }),
    registrantRow({
      Event_ID: 'GONE3', Event_Date: soon, Event: 'Computer Tech Support',
      Location: 'Narberth', Name: 'Replaced', Program_Status: 'Superseded'
    }),
    registrantRow({
      Event_ID: 'LUNCHONLY:x', Event_Date: soon, Event: 'Lunch @ Narberth — Chicken Salad',
      Location: 'Narberth', Name: 'A Luncher', Program_Status: 'Active'
    })
  ]), 1);
check('and an empty roster on a program nobody booked is not reported',
  countStrandedRegistrantRows_({ title: 'Chair Yoga', location: 'Narberth' }, []), 0);

console.log(failures === 0 ? '\nAll leader sheet join checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
