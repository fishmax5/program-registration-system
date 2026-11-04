// WHAT A PROGRAM LEADER'S ROSTER LISTS (sections 46 and 66, November 2026).
//
// From Heather Turner's note on the Low Cost Wills roster for Nov 10: the
// sheet showed "three people at 11:00" (a cancelled booking plus a couple), a
// couple was two lines each saying "party of 2", the email and the sheet
// disagreed about a cancelled name, and the time bands came out 10:30, 11:00,
// 9:30. Pinned here:
//
//   A CANCELLATION SHOWS FOR TWO DAYS, then leaves the roster. No stamp = gone.
//   ONE LINE PER PARTY, on the sheet and in the email: the names together, the
//     party's size, and a tick on that line lands on every person in it.
//   THE DAY IS ORDERED BY THE CLOCK, whatever time of day an Event_Date holds.
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
this.leaderProgramKey = leaderProgramKey;
this.leaderRowKeyMatches = leaderRowKeyMatches;
this.leaderPartyRowKey = leaderPartyRowKey;
this.leaderCancellationDate_ = leaderCancellationDate_;
this.compareLeaderTimeLabels = compareLeaderTimeLabels;
this.foldLeaderDigestParties = foldLeaderDigestParties;
this.describeLeaderDigestPerson = describeLeaderDigestPerson;
this.buildLeaderDigestSubject = buildLeaderDigestSubject;
this.decodeLeaderSnapshot = decodeLeaderSnapshot;
this.HEADERS = HEADERS;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

const S = sandbox;
let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const sessionMap = S.getIndexMap(S.HEADERS.All_Program_Sessions);
const regMap = S.getIndexMap(S.HEADERS.All_Registrants);
const sheetMap = S.getIndexMap(S.LEADER_SHEET_HEADERS);
const label = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const day = new Date(); day.setDate(day.getDate() + 6); day.setHours(0, 0, 0, 0);
const session = new Array(S.HEADERS.All_Program_Sessions.length).fill('');
session[sessionMap['Event_ID']] = 'E1';
session[sessionMap['Event_Date']] = day;
session[sessionMap['Clean_Title']] = 'Low Cost Wills';
session[sessionMap['Location']] = 'Narberth';

function reg(name, time, extra) {
  const r = new Array(S.HEADERS.All_Registrants.length).fill('');
  r[regMap['Event_ID']] = 'E1';
  r[regMap['Event_Date']] = day;
  r[regMap['Event_Time']] = time;
  r[regMap['Location']] = 'Narberth';
  r[regMap['Name']] = name;
  r[regMap['Party_Size']] = 1;
  r[regMap['Program_Status']] = 'Active';
  Object.keys(extra || {}).forEach(k => { r[regMap[k]] = extra[k]; });
  return r;
}
// A desk row's Event_Date carrying a time of day — what sorted the bands wrong.
const lateInstant = new Date(day.getTime() + 15 * 3600000);
const regs = [
  reg('Carolyn Curci', '10:30 AM – 11:00 AM', { Event_Date: lateInstant }),
  reg('Maryrose Crowe', '11:00 AM – 11:30 AM', { Program_Status: 'Cancelled',
    Admin_Notes: `Cancelled by a program leader on ${label(daysAgo(5))}.` }),
  reg('Fresh Cancel', '11:30 AM – 12:00 PM', { Program_Status: 'Cancelled',
    Admin_Notes: `Note | Cancelled at the door on ${label(daysAgo(1))}.` }),
  reg('Unstamped Cancel', '11:30 AM – 12:00 PM', { Program_Status: 'Cancelled' }),
  reg('John Pavloff', '9:30 AM – 10:00 AM', { Party_ID: 'P1', Party_Size: 2, Primary_Registrant: 'Self', Contacted: true }),
  reg('Mrs. Pavloff', '9:30 AM – 10:00 AM', { Party_ID: 'P1', Party_Size: 2, Primary_Registrant: 'John Pavloff' }),
  reg('Noreen Walsh', '11:00 AM – 11:30 AM', { Party_ID: 'P2', Party_Size: 2, Primary_Registrant: 'George Moosburner' }),
  reg('George Moosburner', '11:00 AM – 11:30 AM', { Party_ID: 'P2', Party_Size: 2, Primary_Registrant: 'Self' }),
  reg('Barbara Shapiro', '10:00 AM – 10:30 AM')
];

const byProgram = S.buildLeaderSheetRowsByProgram([session], regs);
const rows = byProgram[S.leaderProgramKey('Low Cost Wills', 'Narberth')] || [];
check('one line per party, cancellations past two days gone, ordered by the clock',
  rows.map(r => `${r[sheetMap['Event_Time']].slice(0, 8)} ${r[sheetMap['Name']]} ${r[sheetMap['Party_Size']]}`),
  ['9:30 AM  John Pavloff & Mrs. Pavloff 2', '10:00 AM Barbara Shapiro 1', '10:30 AM Carolyn Curci 1',
    '11:00 AM George Moosburner & Noreen Walsh 2', '11:30 AM Fresh Cancel 1']);

const pav = rows[0];
check('a party line carries the party key', pav[sheetMap['Row_Key']], S.leaderPartyRowKey('E1', 'P1'));
check('its ticks are OR-ed across the party, and its snapshot says so',
  [pav[sheetMap['Contacted']], S.decodeLeaderSnapshot(pav[sheetMap['Pushed_Snapshot']])[0]], [true, true]);
check('a tick on the party line matches both people, and nobody else',
  regs.map(r => S.leaderRowKeyMatches(r, regMap, pav[sheetMap['Row_Key']]) ? r[regMap['Name']] : null).filter(Boolean),
  ['John Pavloff', 'Mrs. Pavloff']);
check('a person\'s own key still matches them',
  S.leaderRowKeyMatches(regs[8], regMap, `E1||${'barbara shapiro'}`), true);

check('the last cancellation stamp is the one read',
  S.leaderCancellationDate_('Cancelled at the door on Mon, Nov 2, 2026. | Reactivated | Cancelled by staff on Wed, Nov 4, 2026.').getDate(), 4);
check('9:30 sorts before 11:00', S.compareLeaderTimeLabels('9:30 AM', '11:00 AM') < 0, true);
check('noon and pm on the clock', S.compareLeaderTimeLabels('12:00 PM', '1:00 PM') < 0, true);

// THE EMAIL.
const people = S.foldLeaderDigestParties([
  { name: 'Richard W. Pascal', partySize: 1, time: '11:30 AM – 12:00 PM' },
  { name: 'Mrs. Pavloff', partySize: 2, time: '9:30 AM – 10:00 AM', partyId: 'P1', primary: 'John Pavloff' },
  { name: 'John Pavloff', partySize: 2, time: '9:30 AM – 10:00 AM', partyId: 'P1', primary: 'Self' },
  { name: 'Barbara Shapiro', partySize: 1, time: '10:00 AM – 10:30 AM' }
]);
check('the digest lists one line per party, by time, saying couple',
  people.map(p => S.describeLeaderDigestPerson(p)),
  ['9:30 AM – 10:00 AM — John Pavloff & Mrs. Pavloff (couple)', '10:00 AM – 10:30 AM — Barbara Shapiro',
    '11:30 AM – 12:00 PM — Richard W. Pascal']);
check('and its subject counts bookings beside people',
  S.buildLeaderDigestSubject([{ title: 'Low Cost Wills', location: 'Narberth', date: day, roster: people }])
    .indexOf('3 bookings (4 people)') !== -1, true);
check('a party of three is a party of three',
  S.describeLeaderDigestPerson({ name: 'A, B & C', partySize: 3 }), 'A, B & C (party of 3)');

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall leader roster party and cancellation checks passed');
