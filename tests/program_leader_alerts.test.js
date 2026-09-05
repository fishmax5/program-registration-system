// ROSTER-CHANGE ALERTS: the diff, and the two ways it can be catastrophically
// wrong.
//
// THE FIRST is the first run. No stored snapshot means every registration
// looks new, and a leader with a forty-person class gets an email announcing
// forty arrivals that happened over three months. That is not a bug you find
// in testing; it is a bug you find in somebody's inbox.
//
// THE SECOND is ageing out. The roster covers a window. Every night, sessions
// fall off the back of it and their people vanish from the snapshot — which,
// to a diff that does not know better, is indistinguishable from everybody
// cancelling at once. "Nine people dropped out of last month's class" is a
// message that gets a program leader to ring nine people.
//
// Both are pinned here, along with what the diff says when it is right.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  // Enough of Utilities.formatDate to be honest about the two patterns this
  // code path uses. The usual `d => d.toISOString()` stub is fine where a
  // stamp is only ever printed; here formatDateKey()'s output is parsed
  // straight back by parseDateKey(), so a key that is not 'yyyy-MM-dd' makes
  // an Invalid Date and every window comparison silently stops meaning
  // anything.
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
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
;this.diffLeaderAlertRosters = diffLeaderAlertRosters;
this.describeLeaderAlertChange = describeLeaderAlertChange;
this.buildLeaderAlertSubject = buildLeaderAlertSubject;
this.buildLeaderAlertBody = buildLeaderAlertBody;
this.buildLeaderAlertRosters = buildLeaderAlertRosters;
this.leaderAlertEntryKey = leaderAlertEntryKey;
this.leaderAlertEntryValue = leaderAlertEntryValue;
this.leaderAlertStatusCode = leaderAlertStatusCode;
this.leaderAlertValueParts = leaderAlertValueParts;
this.parseLeaderEmailList = parseLeaderEmailList;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.LEADER_ALERT_MAX_LINES_PER_PROGRAM = LEADER_ALERT_MAX_LINES_PER_PROGRAM;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const WINDOW = { from: '2026-09-01', to: '2026-10-31' };
const K = sandbox.leaderAlertEntryKey;
const V = sandbox.leaderAlertEntryValue;

// ---------------------------------------------------------------------------
// The four kinds of change, and what each one reads as.
// ---------------------------------------------------------------------------

const before = {};
before[K('2026-09-15', 'Ann Smith')] = V('A', 1);
before[K('2026-09-15', 'Bob Jones')] = V('A', 1);
before[K('2026-09-15', 'Cyd Ray')] = V('A', 2);
before[K('2026-09-15', 'Dee Lee')] = V('W', 1);

const after = {};
after[K('2026-09-15', 'Ann Smith')] = V('A', 1);           // unchanged
after[K('2026-09-15', 'Cyd Ray')] = V('A', 4);             // party grew
after[K('2026-09-15', 'Dee Lee')] = V('A', 1);             // off the waitlist
after[K('2026-09-15', 'Eve Park')] = V('A', 1);            // new
// Bob is gone.

const changes = sandbox.diffLeaderAlertRosters(before, after, WINDOW);

check('an unchanged person is not a change',
  changes.filter(c => c.name.indexOf('ann') === 0).length, 0);
check('every real change is reported once, sorted arrivals-first',
  changes.map(c => c.kind), ['joined', 'left', 'status', 'party']);
check('a new registration reads as one',
  sandbox.describeLeaderAlertChange(changes[0]), '+ Eve Park — signed up');
check('a departure names the person, which is the whole point of the key shape',
  sandbox.describeLeaderAlertChange(changes[1]), '- Bob Jones — no longer on the roster');
check('a move off the waitlist says which way it went',
  sandbox.describeLeaderAlertChange(changes[2]), '~ Dee Lee — Waitlisted → Active');
check('and a party that grew is a change worth setting out chairs for',
  sandbox.describeLeaderAlertChange(changes[3]), '~ Cyd Ray — party of 2 → party of 4');

check('somebody who signs up straight onto the waitlist is told apart from somebody who just signs up',
  sandbox.describeLeaderAlertChange({ kind: 'joined', name: 'fay ross', to: 'W', partySize: 1 }),
  '+ Fay Ross — signed up, on the waitlist');

// ---------------------------------------------------------------------------
// AGEING OUT IS NOT LEAVING.
// ---------------------------------------------------------------------------

const stale = {};
stale[K('2026-07-04', 'Gil Vance')] = V('A', 1);   // long before the window
stale[K('2026-12-25', 'Hal Wynn')] = V('A', 1);    // long after it
stale[K('2026-09-15', 'Ivy Chase')] = V('A', 1);   // inside it, and really gone

check('a session that rolled out of the window is silence, not nine cancellations',
  sandbox.diffLeaderAlertRosters(stale, {}, WINDOW).map(c => c.name), ['ivy chase']);

// ---------------------------------------------------------------------------
// The status vocabulary, including the readings that are NOT in it.
// ---------------------------------------------------------------------------

check('the three statuses round-trip through one character',
  ['Active', 'Waitlisted', 'Cancelled'].map(sandbox.leaderAlertStatusCode), ['A', 'W', 'C']);
check('and anything else — a blank a desk row left, a status nobody has seen — reads as Active',
  ['', '   ', 'Something New', null, undefined].map(sandbox.leaderAlertStatusCode),
  ['A', 'A', 'A', 'A', 'A']);
check('a party of one is stored without a number, so the common case is one character',
  [V('A', 1), V('A', ''), V('W', 3)], ['A', 'A', 'W3']);
check('...and reads back the same either way',
  [sandbox.leaderAlertValueParts('A'), sandbox.leaderAlertValueParts('W3')],
  [{ code: 'A', partySize: 1 }, { code: 'W', partySize: 3 }]);

// ---------------------------------------------------------------------------
// The email itself.
// ---------------------------------------------------------------------------

const programs = [{
  key: 'chair yoga|narberth', title: 'Chair Yoga', location: 'Narberth',
  url: 'https://docs.google.com/spreadsheets/d/F1/edit', changes
}];
const body = sandbox.buildLeaderAlertBody({ name: 'Jane', email: 'j@e.com' }, programs);

check('the email greets the leader by name', body.indexOf('Hello Jane,'), 0);
check('and names the program and the site', body.indexOf('Chair Yoga — Narberth') !== -1, true);
check('and links the sheet the changes happened on', body.indexOf('/d/F1/edit') !== -1, true);
check('and says how to make it stop', body.indexOf('Notify_Roster_Changes') !== -1, true);
check('a leader with no name recorded still gets a greeting',
  sandbox.buildLeaderAlertBody({ name: '', email: 'j@e.com' }, programs).indexOf('Hello,'), 0);

check('one program says which one in the subject',
  sandbox.buildLeaderAlertSubject(programs), 'Chair Yoga (Narberth) — 4 roster changes');
check('several programs are counted rather than listed',
  sandbox.buildLeaderAlertSubject([
    { title: 'A', location: 'X', changes: [1] },
    { title: 'B', location: 'Y', changes: [1, 2] }
  ]), '3 roster changes across 2 of your programs');
check('and one change is not "1 changes"',
  sandbox.buildLeaderAlertSubject([{ title: 'A', location: 'X', changes: [1] }]),
  'A (X) — 1 roster change');

// A roster that moved two hundred times is a report, not an email.
const manyChanges = [];
for (let i = 0; i < 200; i++) {
  manyChanges.push({ kind: 'joined', dateKey: '2026-09-15', name: `person ${i}`, to: 'A', partySize: 1 });
}
const longBody = sandbox.buildLeaderAlertBody({ name: 'Jane' },
  [{ title: 'A', location: 'X', url: '', changes: manyChanges }]);
check('a huge diff is truncated, and says that it was',
  longBody.indexOf(`…and ${200 - sandbox.LEADER_ALERT_MAX_LINES_PER_PROGRAM} more change(s).`) !== -1, true);

// ---------------------------------------------------------------------------
// Building the current picture: only the wanted programs, only the window,
// and never a superseded row.
// ---------------------------------------------------------------------------

const sessionMap = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
const regMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);

function row(map, headers, values) {
  const r = new Array(headers.length).fill('');
  Object.keys(values).forEach(k => { r[map[k]] = values[k]; });
  return r;
}

const soon = new Date();
soon.setDate(soon.getDate() + 7);
const longAgo = new Date();
longAgo.setDate(longAgo.getDate() - 400);

const sessionRows = [
  row(sessionMap, sandbox.HEADERS.All_Program_Sessions,
    { Event_ID: 'EV1', Event_Date: soon, Clean_Title: 'Chair Yoga', Location: 'Narberth' }),
  // Same program, but far outside the alert window.
  row(sessionMap, sandbox.HEADERS.All_Program_Sessions,
    { Event_ID: 'EV2', Event_Date: longAgo, Clean_Title: 'Chair Yoga', Location: 'Narberth' }),
  // A program nobody asked to be told about.
  row(sessionMap, sandbox.HEADERS.All_Program_Sessions,
    { Event_ID: 'EV3', Event_Date: soon, Clean_Title: 'Tai Chi', Location: 'Ashbridge' })
];

const registrantRows = [
  row(regMap, sandbox.HEADERS.All_Registrants, { Event_ID: 'EV1', Name: 'Ann', Program_Status: 'Active', Party_Size: 2 }),
  row(regMap, sandbox.HEADERS.All_Registrants, { Event_ID: 'EV1', Name: 'Old Bob', Program_Status: 'Superseded' }),
  row(regMap, sandbox.HEADERS.All_Registrants, { Event_ID: 'EV2', Name: 'Historic', Program_Status: 'Active' }),
  row(regMap, sandbox.HEADERS.All_Registrants, { Event_ID: 'EV3', Name: 'Someone Else', Program_Status: 'Active' })
];

const rosters = sandbox.buildLeaderAlertRosters(sessionRows, registrantRows, ['chair yoga|narberth']);

check('only the program that was asked for is tracked',
  Object.keys(rosters), ['chair yoga|narberth']);
check('a superseded row is bookkeeping, not an arrival, and a session outside the window is not tracked at all',
  Object.keys(rosters['chair yoga|narberth']).map(k => k.split('|')[1]), ['ann']);
check('and the party size rides along, because it is a change on its own',
  rosters['chair yoga|narberth'][K(Object.keys(rosters['chair yoga|narberth'])[0].split('|')[0], 'Ann')], 'A2');

check('asking about no programs at all builds nothing rather than everything',
  sandbox.buildLeaderAlertRosters(sessionRows, registrantRows, []), {});

// ---------------------------------------------------------------------------
// Addresses, however they were typed.
// ---------------------------------------------------------------------------

check('a list separated any of the three ways is still a list',
  sandbox.parseLeaderEmailList('a@x.com, b@x.com; c@x.com  d@x.com'),
  ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
check('the same address twice is one address',
  sandbox.parseLeaderEmailList('a@x.com, a@x.com'), ['a@x.com']);
check('and something that is not an address is not one',
  sandbox.parseLeaderEmailList('Jane Smith, @nope, a@x.com'), ['a@x.com']);
check('a blank cell is no addresses, not one empty one',
  [sandbox.parseLeaderEmailList(''), sandbox.parseLeaderEmailList(null)], [[], []]);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
