// THE WAITLIST TAB AND THE ANY-DATE WAITING LIST (sections 46, 99z).
//
// Pinned here:
//
//   A WAITLISTED ROW LEAVES THE CLASS LIST — on Program_Status alone, so a row
//   a leader has just ticked stays where the next pull can read the tick.
//
//   ONE LINE PER PERSON on the Waitlist tab, their dates condensed into one
//   cell, past dates dropped, and the any-date people from Program_Waitlist
//   beside them ("Any date", or "Any date (also: …)" for somebody on both).
//
//   THE FINGERPRINT MOVES when an any-date entry is added, with no registrant
//   row changing — otherwise the Waitlist tab would never be redrawn for it.
//
//   QUICK MARK'S ANY-DATE ADD writes ONE row to Program_Waitlist and nothing
//   else, fills the contact from the roll, and refuses the same person twice.
const vm = require('vm');
const crypto = require('crypto');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const y = d.getFullYear();
      const m = d.getMonth();
      const day = d.getDate();
      if (pattern === 'yyyy-MM-dd') return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (pattern === 'yyyy') return String(y);
      if (pattern === 'MMM') return MONTHS[m];
      if (pattern === 'MMM yyyy') return `${MONTHS[m]} ${y}`;
      if (pattern === 'd') return String(day);
      return d.toISOString();
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: (alg, raw) => Array.from(crypto.createHash('md5').update(raw).digest()),
    DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@x.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.LEADER_WAITLIST_HEADERS = LEADER_WAITLIST_HEADERS;
this.__setWaitlist = function (byKey) { __programWaitlistMemo = byKey; };
this.__stub = function (name, fn) { eval(name + ' = fn'); };
`, sandbox, { filename: 'program.gs' });

const {
  HEADERS, LEADER_SHEET_HEADERS, LEADER_WAITLIST_HEADERS, getIndexMap,
  splitLeaderSheetRows, buildLeaderWaitlistRows, condenseLeaderWaitlistDates,
  computeLeaderSheetFingerprint, leaderProgramKey, leaderSheetContentFor
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
const outMap = getIndexMap(LEADER_WAITLIST_HEADERS);
function day(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
function sheetRow(fields) {
  const row = new Array(LEADER_SHEET_HEADERS.length).fill('');
  Object.keys(fields).forEach(k => { row[sheetMap[k]] = fields[k]; });
  return row;
}

// --- The split ----------------------------------------------------------------
const joan1 = sheetRow({ Event_Date: day(7), Name: 'Joan Smith', Phone: '555-1', Program_Status: 'Waitlisted', Party_Size: 1 });
const joan2 = sheetRow({ Event_Date: day(14), Name: 'joan  smith', Program_Status: 'Waitlisted', Party_Size: 2 });
const bob = sheetRow({ Event_Date: day(7), Name: 'Bob Lee', Program_Status: 'Active' });
const ticked = sheetRow({ Event_Date: day(7), Name: 'Ann Ticked', Program_Status: 'Active', Waitlisted: true });
const pastWait = sheetRow({ Event_Date: day(-3), Name: 'Old Wait', Program_Status: 'Waitlisted' });
const split = splitLeaderSheetRows([joan1, bob, joan2, ticked, pastWait]);
check('only Program_Status=Waitlisted leaves the class list (a fresh tick stays for the pull)',
  split.roster.map(r => r[sheetMap['Name']]), ['Bob Lee', 'Ann Ticked']);
check('the waitlisted rows are all handed on', split.waitlisted.length, 3);

// --- Condensing ------------------------------------------------------------------
check('one month, several days',
  condenseLeaderWaitlistDates([new Date(2026, 9, 13), new Date(2026, 9, 6), new Date(2026, 9, 6)]),
  'Oct 6, 13');
check('two months', condenseLeaderWaitlistDates([new Date(2026, 9, 6), new Date(2026, 10, 3)]),
  'Oct 6 · Nov 3');
check('the year is named when the list crosses one',
  condenseLeaderWaitlistDates([new Date(2026, 11, 29), new Date(2027, 0, 5)]),
  'Dec 29 2026 · Jan 5 2027');
check('nothing is blank', condenseLeaderWaitlistDates([]), '');

// --- One line per person ----------------------------------------------------------
const anyDate = [
  { name: 'Joan Smith', phone: '', email: 'j@x.org', partySize: 1, addedOn: day(-10), notes: 'mornings' },
  { name: 'Zed Any', phone: '555-9', email: '', partySize: 1, addedOn: day(-2), notes: '' },
  { name: 'Amy Early', phone: '', email: '', partySize: 1, addedOn: day(-20), notes: '' }
];
const waitRows = buildLeaderWaitlistRows(split.waitlisted, anyDate);
check('one row per person, past dates dropped, dated people first, then any-date by when they asked',
  waitRows.map(r => r[outMap['Name']]), ['Joan Smith', 'Amy Early', 'Zed Any']);
const joan = waitRows[0];
check('a person on both lists: any date, with their dates condensed beside it',
  joan[outMap['Dates']], `Any date (also: ${condenseLeaderWaitlistDates([day(7), day(14)])})`);
check('contact and size merged across their rows',
  [joan[outMap['Phone']], joan[outMap['Email']], joan[outMap['Party_Size']], joan[outMap['Notes']]],
  ['555-1', 'j@x.org', 2, 'mornings']);
check('an any-date-only person says so', waitRows[2][outMap['Dates']], 'Any date');
check('nobody waiting is no rows', buildLeaderWaitlistRows([], []).length, 0);

// --- The fingerprint -----------------------------------------------------------------
const entry = { title: 'Chair Yoga', location: 'Narberth' };
const key = leaderProgramKey('Chair Yoga', 'Narberth');
sandbox.__setWaitlist({});
const before = computeLeaderSheetFingerprint(entry, [bob]);
sandbox.__setWaitlist({ [key]: [anyDate[1]] });
const after = computeLeaderSheetFingerprint(entry, [bob]);
check('an any-date entry moves the fingerprint with no registrant row changing', before !== after, true);
const content = leaderSheetContentFor(entry, [bob, joan1]);
check('the content split puts the waitlisted on the Waitlist tab only',
  [content.roster.length, content.waitlist.map(r => r[outMap['Name']])], [1, ['Joan Smith', 'Zed Any']]);

// --- Quick Mark's any-date add -------------------------------------------------------
const appended = [];
const wlHeaders = HEADERS.Program_Waitlist;
const fakeTab = {
  getLastColumn: () => wlHeaders.length,
  getRange: () => ({ getValues: () => [wlHeaders.slice()] }),
  appendRow: row => appended.push(row)
};
sandbox.__stub('ensureProgramWaitlistTab_', () => fakeTab);
sandbox.__stub('readMemberRollRows', () => {
  const m = getIndexMap(HEADERS.Member_Roll);
  const r = new Array(HEADERS.Member_Roll.length).fill('');
  r[m['Name']] = 'Pat Roll'; r[m['Phone']] = '555-7'; r[m['Email']] = 'pat@x.org';
  return { rows: [r] };
});
let touchedRegistrants = false;
sandbox.__stub('renderRegistrantsSheet', () => { touchedRegistrants = true; });
sandbox.__stub('appendLedgerEntry', () => { touchedRegistrants = true; });
sandbox.__setWaitlist({});
const ok = sandbox.addProgramWaitlistEntryFromDialog({ title: 'Chair Yoga', location: 'Narberth', name: ' Pat  Roll ' });
const wm = getIndexMap(wlHeaders);
check('the add succeeds', ok.ok, true);
check('one row appended, contact taken from the roll, status Waiting',
  [appended.length, appended[0][wm['Name']], appended[0][wm['Phone']], appended[0][wm['Email']],
    appended[0][wm['Status']], appended[0][wm['Program']], appended[0][wm['Party_Size']]],
  [1, 'Pat Roll', '555-7', 'pat@x.org', 'Waiting', 'Chair Yoga', 1]);
check('nothing on All_Registrants or the ledger is touched', touchedRegistrants, false);
sandbox.__setWaitlist({ [key]: [{ name: 'Pat Roll' }] });
const dup = sandbox.addProgramWaitlistEntryFromDialog({ title: 'Chair Yoga', location: 'Narberth', name: 'pat roll' });
check('the same person twice is refused', [dup.ok, appended.length], [false, 1]);
check('lunch has no waiting list',
  sandbox.addProgramWaitlistEntryFromDialog({ title: 'Lunch @ Narberth', location: 'Narberth', name: 'X Y' }).ok, false);
check('a name is required',
  sandbox.addProgramWaitlistEntryFromDialog({ title: 'Chair Yoga', location: 'Narberth', name: '' }).ok, false);
check('Placed and Removed are off the list; blank is waiting',
  ['Waiting', '', 'Placed', 'removed'].map(sandbox.isProgramWaitlistWaiting), [true, true, false, false]);

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall program waitlist checks passed');
