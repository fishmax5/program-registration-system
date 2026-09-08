// THE OFFICE IS TOLD, NOT INVITED.
//
// Staff addresses ticked for Calendar_Invite_Guest used to be added to every
// event a registrant was invited to, which put the whole program calendar on
// four or five people's own calendars, one Google invitation at a time. They
// are told in writing instead, and this pins the two things that made the
// change worth making: the pass adds nobody but registrants, and what the
// office reads says who was told and how.
//
// WHERE THAT WRITING GOES has changed once since: it was an email per sync to
// everyone ticked for Calendar_Invite_Guest, and it is now one line per session
// in the 10am office digest (88_office_daily_digest.gs), beside the reminders
// and roster alerts that went out the same day.
const fs = require('fs');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `LABEL(${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())})`;
    },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.registrantNamesByEmail = registrantNamesByEmail;
this.describeInvitee = describeInvitee;
this.calendarInviteAdminCleanupTargets = calendarInviteAdminCleanupTargets;
this.notifyOfficeOfCalendarInvites = notifyOfficeOfCalendarInvites;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function checkTrue(name, actual) { check(name, !!actual, true); }

// ---------------------------------------------------------------------------
// The pass itself no longer knows about office guests.
// ---------------------------------------------------------------------------
const inviteSource = fs.readFileSync(`${__dirname}/../33_calendar_invitations.gs`, 'utf8');
checkTrue('no office address is added to a guest list any more',
  inviteSource.indexOf('officeGuests') === -1);
checkTrue('and no office address is mailed by this pass at all any more',
  inviteSource.indexOf('adminEmailsForCategory') === -1);
checkTrue('what the office is told is written for the daily digest instead',
  inviteSource.indexOf('spoolOfficeNote') !== -1);

// ---------------------------------------------------------------------------
// Who each address belongs to, for a digest a person can read.
// ---------------------------------------------------------------------------
const lrMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
const row = name => {
  const r = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
  r[lrMap['Name']] = name[0];
  r[lrMap['Email']] = name[1];
  return r;
};
const names = sandbox.registrantNamesByEmail(
  [row(['Ada Lovelace', 'Ada@Example.org']), row(['', 'nobody@example.org'])], lrMap);
check('names are keyed by lowercased address', names, { 'ada@example.org': 'Ada Lovelace' });
check('a named registrant reads as name and address',
  sandbox.describeInvitee('ADA@example.org', names), 'Ada Lovelace <ADA@example.org>');
check('an unnamed one is just the address',
  sandbox.describeInvitee('nobody@example.org', names), 'nobody@example.org');

// ---------------------------------------------------------------------------
// The digest.
// ---------------------------------------------------------------------------
const changes = [
  {
    session: { date: new Date(2026, 8, 14), title: 'Chair Yoga', location: 'North' },
    added: ['Ada Lovelace <ada@example.org>'],
    removed: []
  },
  {
    session: { date: new Date(2026, 8, 15), title: 'Bridge Club', location: 'South' },
    added: [],
    removed: ['pat@example.org']
  }
];
const spooled = [];
vm.runInContext('spoolOfficeNote = function (section, message) { ' +
  'this.__spooled.push({ section, message }); return true; };', sandbox);
sandbox.__spooled = spooled;

check('one line per session whose guest list changed',
  sandbox.notifyOfficeOfCalendarInvites(changes), 2);
check('filed under one heading, so a busy morning reads as one block',
  spooled.map(e => e.section), ['Calendar invitations', 'Calendar invitations']);
checkTrue('the line names the session', spooled[0].message.indexOf('Chair Yoga') !== -1);
checkTrue('and says who was invited',
  spooled[0].message.indexOf('Ada Lovelace <ada@example.org>') !== -1);
checkTrue('and who came off the other one', spooled[1].message.indexOf('pat@example.org') !== -1);
checkTrue('...as a removal, not an invitation',
  spooled[1].message.indexOf('removed') !== -1 && spooled[1].message.indexOf('invited') === -1);

// Nothing changed, nothing written — the hourly sync must not put a line in
// the digest every hour to say that nothing happened.
spooled.length = 0;
check('an empty pass writes nothing', sandbox.notifyOfficeOfCalendarInvites([]), 0);
check('...and files nothing', spooled.length, 0);

// ---------------------------------------------------------------------------
// The one-time cleanup picks staff addresses out of a guest list.
// ---------------------------------------------------------------------------
check('every admin address on the event is a target, whatever its case',
  sandbox.calendarInviteAdminCleanupTargets(
    ['Ada@example.org', 'OFFICE@example.org', 'desk@example.org', 'office@example.org'],
    ['office@example.org', 'desk@example.org']),
  ['office@example.org', 'desk@example.org']);
check('a guest list with no staff on it is left alone',
  sandbox.calendarInviteAdminCleanupTargets(['ada@example.org'], ['office@example.org']), []);
check('no admin table means nothing to remove',
  sandbox.calendarInviteAdminCleanupTargets(['ada@example.org'], []), []);

console.log(failures === 0 ? '\nAll calendar invite digest checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
