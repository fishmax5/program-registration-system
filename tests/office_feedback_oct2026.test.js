// THREE CHANGES FROM THE OFFICE'S OCTOBER 2026 EMAILS.
//
//   THE SYNC EVERY THREE HOURS. A timed trigger run imports only once the
//   interval is up; a menu press (no event object) always imports.
//
//   CANCEL EVERY LATER DATE. Quick Mark's cancel can take the rest of a
//   program: same title, same building, this date onwards, live rows only,
//   this person only.
//
//   PRIVATE SESSIONS. Sessions and people counted once each, hours per
//   session; attendees parsed from a typed list; the dialog never writes
//   workbook data as markup.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {}, getUuid: () => 'uuid' },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.registrationSyncDueFromTrigger_ = registrationSyncDueFromTrigger_;
this.laterSessionsOfProgram = laterSessionsOfProgram;
this.summarizePrivateSessions = summarizePrivateSessions;
this.privateSessionMetricsForMonth = privateSessionMetricsForMonth;
this.parsePrivateSessionAttendees = parsePrivateSessionAttendees;
this.buildPrivateSessionHtml = buildPrivateSessionHtml;
this.HEADERS = HEADERS;
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

// --- every three hours ----------------------------------------------------
const H = 3600 * 1000;
const t0 = Date.UTC(2026, 9, 8, 12, 0);
const timed = { triggerUid: 'x' };
check('a menu press always imports', S.registrationSyncDueFromTrigger_(undefined, t0), true);
check('the first timed run imports', S.registrationSyncDueFromTrigger_(timed, t0), true);
check('one hour later it stands down', S.registrationSyncDueFromTrigger_(timed, t0 + H), false);
check('two hours later it stands down', S.registrationSyncDueFromTrigger_(timed, t0 + 2 * H), false);
check('a menu press in between still imports', S.registrationSyncDueFromTrigger_(undefined, t0 + 2 * H), true);
check('three hours later (a few minutes early) it imports',
  S.registrationSyncDueFromTrigger_(timed, t0 + 3 * H - 4 * 60 * 1000), true);

// --- every later date ------------------------------------------------------
const map = S.getIndexMap(S.HEADERS.All_Registrants);
function reg(id, name, event, location, date, status) {
  const row = new Array(S.HEADERS.All_Registrants.length).fill('');
  row[map['Event_ID']] = id; row[map['Name']] = name; row[map['Event']] = event;
  row[map['Location']] = location; row[map['Event_Date']] = new Date(date);
  row[map['Program_Status']] = status || 'Active';
  return row;
}
const rows = [
  reg('a1', 'Colette Katz', 'Art in Nature', 'Ashbridge', '2026-10-05T12:00'),
  reg('a2', 'Colette Katz', 'Art in Nature', 'Ashbridge', '2026-10-19T12:00'),
  reg('a3', 'Colette Katz', 'Art in Nature', 'Ashbridge', '2026-10-26T12:00'),
  reg('a4', 'Colette Katz', 'Art in Nature', 'Ashbridge', '2026-11-02T12:00', 'Cancelled'),
  reg('a5', 'Colette Katz', 'Art  in nature', 'Ashbridge', '2026-11-09T12:00'),
  reg('n1', 'Colette Katz', 'Art in Nature', 'Narberth', '2026-10-27T12:00'),
  reg('t1', 'Colette Katz', "T'ai Chi", 'Ashbridge', '2026-10-27T12:00'),
  reg('a6', 'Joan Coltune', 'Art in Nature', 'Ashbridge', '2026-10-26T12:00')
];
check('the picked date and every later live one, same program and building only',
  S.laterSessionsOfProgram(rows, map, rows[1]).eventIds, ['a2', 'a3', 'a5']);

// --- private sessions ------------------------------------------------------
check('attendees: one per line or comma, duplicates dropped',
  S.parsePrivateSessionAttendees('Ann Lee\n  Bob Day , ann lee;\n\nCy Ho'), ['Ann Lee', 'Bob Day', 'Cy Ho']);
const entries = [
  { sessionId: 's1', hours: 1, attendee: 'Ann', attendeeKey: 'ann', monthKey: '2026-09' },
  { sessionId: 's1', hours: 1, attendee: 'Bob', attendeeKey: 'bob', monthKey: '2026-09' },
  { sessionId: 's2', hours: 1.5, attendee: 'Ann', attendeeKey: 'ann', monthKey: '2026-09' },
  { sessionId: 's3', hours: 2, attendee: 'Cy', attendeeKey: 'cy', monthKey: '2026-10' }
];
check('sessions and people once, hours per session',
  S.privateSessionMetricsForMonth('2026-09', entries), { sessions: 2, people: 2, attendances: 3, hours: 2.5 });
const html = S.buildPrivateSessionHtml({ names: ['</script><b>x</b>'], programs: [], locations: [], recent: [] });
check('nothing from the workbook is written as markup', html.indexOf('</script><b>x</b>'), -1);
check('Metrics carries the three new columns last',
  S.HEADERS.Metrics.slice(-3), ['Private_Sessions', 'Private_Session_People', 'Private_Session_Hours']);

console.log(failures === 0 ? '\nAll office-feedback checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
