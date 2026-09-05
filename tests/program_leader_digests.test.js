// DAY-BEFORE ROSTER DIGESTS (section 9d-ii) — the other Notify_Timing channel.
//
// A leader on "N days before each date" is not watching an inbox for changes.
// They get ONE email per session, N days ahead of it, saying who is on the
// roster. Four things about that are worth pinning, because all four fail
// silently and all four fail in somebody's inbox:
//
//   1. THE COUNTDOWN IS PER LEADER, not per program. Two leaders on one class,
//      one asking for a week's notice and one for two days, are two different
//      mornings — resolving both against the widest count would mail the
//      two-day leader five days early, every time.
//
//   2. THE LEDGER IS WHAT STOPS AN HOURLY PASS. "3 days before" is true for
//      the whole of the day three days out, so a pass that re-sent whenever
//      the offset still matched would send that digest twenty-four times.
//
//   3. A MISSED MORNING IS STILL OWED. A workbook that was quiet on the exact
//      day (a failed run, a leader who ticked the box late) must still send —
//      so "due" is the whole window up to the date, not one exact match.
//
//   4. THE CHANNELS DO NOT LEAK. A leader on "At each registration" must get
//      nothing at all from this pass, and vice versa; a leader hearing from
//      both channels about the same class is exactly the noise Notify_Timing
//      exists to let them turn off.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const properties = {};
const sentMail = [];
let remainingQuota = 100;

const sandbox = {
  console: { log: () => {} },
  // formatDateKey()'s output is parsed straight back by parseDateKey(), so a
  // key that is not 'yyyy-MM-dd' makes an Invalid Date and every window
  // comparison in the pass silently stops meaning anything.
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (properties[k] === undefined ? null : properties[k]),
      setProperty: (k, v) => { properties[k] = String(v); },
      setProperties: o => { Object.keys(o).forEach(k => { properties[k] = String(o[k]); }); },
      deleteProperty: k => { delete properties[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {},
  MailApp: {
    getRemainingDailyQuota: () => remainingQuota,
    sendEmail: options => { sentMail.push(options); }
  },
  DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.sendProgramLeaderDaySnapshotDigests = sendProgramLeaderDaySnapshotDigests;
this.notifyProgramLeadersOfRosterChanges = notifyProgramLeadersOfRosterChanges;
this.buildLeaderDigestBody = buildLeaderDigestBody;
this.buildLeaderDigestSubject = buildLeaderDigestSubject;
this.describeLeaderDigestPerson = describeLeaderDigestPerson;
this.pruneLeaderDigestLedger = pruneLeaderDigestLedger;
this.getLeaderDigestLedger = getLeaderDigestLedger;
this.resetRationedMailState = resetRationedMailState;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.LEADER_ALERT_MAX_LINES_PER_PROGRAM = LEADER_ALERT_MAX_LINES_PER_PROGRAM;
this.__setLeaderIndex = function (rows) { __programLeaderIndexCache = rows; };
this.__resetDigestLedger = function () {
  __leaderDigestLedgerCache = null;
  __leaderDigestLedgerDirty = false;
};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const sessionHeaders = sandbox.HEADERS.All_Program_Sessions;
const sessionMap = sandbox.getIndexMap(sessionHeaders);
const regHeaders = sandbox.HEADERS.All_Registrants;
const regMap = sandbox.getIndexMap(regHeaders);

function row(map, headers, values) {
  const r = new Array(headers.length).fill('');
  Object.keys(values).forEach(k => { r[map[k]] = values[k]; });
  return r;
}

/** A date this many days from today, which is how the pass measures "due". */
function daysFromToday(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday, so a DST boundary cannot round the key onto the wrong day
  d.setDate(d.getDate() + days);
  return d;
}

function session(eventId, days, title, location) {
  return row(sessionMap, sessionHeaders, {
    Event_ID: eventId, Event_Date: daysFromToday(days),
    Clean_Title: title, Location: location
  });
}

function registrant(eventId, name, status, partySize) {
  return row(regMap, regHeaders, {
    Event_ID: eventId, Name: name, Program_Status: status || '', Party_Size: partySize || 1
  });
}

/** One leader row as buildProgramLeaderIndex() would have read it off the tab. */
function leader(name, email, title, location, timing, notify) {
  return {
    name, emails: [email], notify: notify !== false, timing,
    programTitle: title, programLocation: location
  };
}

const EACH_CHANGE = { mode: 'each_change', days: 0 };
const daysBefore = days => ({ mode: 'days_before', days });

/** A clean slate: no ledger, no spent quota, no mail sent yet. */
function reset() {
  Object.keys(properties).forEach(k => { delete properties[k]; });
  sentMail.length = 0;
  remainingQuota = 100;
  sandbox.resetRationedMailState();
  sandbox.__resetDigestLedger();
}

// ---------------------------------------------------------------------------
// The ordinary case: one leader, one countdown, one session inside it.
// ---------------------------------------------------------------------------

reset();
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [leader('Jane Doe', 'jane@x.com', 'Chair Yoga', 'Narberth', daysBefore(3))]
});

const sessions = [
  session('EV_SOON', 3, 'Chair Yoga', 'Narberth'),   // exactly the countdown
  session('EV_LATER', 9, 'Chair Yoga', 'Narberth'),  // well past it
  session('EV_GONE', -2, 'Chair Yoga', 'Narberth')   // already happened
];
const registrants = [
  registrant('EV_SOON', 'Ann Smith', 'Active', 1),
  registrant('EV_SOON', 'Bob Jones', 'Active', 3),
  registrant('EV_SOON', 'Cyd Ray', 'Waitlisted', 1),
  registrant('EV_SOON', 'Dee Lee', 'Cancelled', 1),      // not coming
  registrant('EV_SOON', 'Old Bob', 'Superseded', 1),     // bookkeeping
  registrant('EV_LATER', 'Far Future', 'Active', 1),
  registrant('EV_GONE', 'Last Week', 'Active', 1)
];

check('a session inside the countdown is one email',
  sandbox.sendProgramLeaderDaySnapshotDigests(sessions, registrants), 1);
check('...to the leader who asked for it', sentMail.map(m => m.to), ['jane@x.com']);

const digest = sentMail[0].body;
check('the digest greets the leader by name', digest.indexOf('Hello Jane Doe,'), 0);
check('and names the session it is about',
  digest.indexOf('Chair Yoga — Narberth') !== -1, true);
check('an active registrant is listed', digest.indexOf('Ann Smith') !== -1, true);
check('a party rides along, because it is chairs to set out',
  digest.indexOf('Bob Jones (party of 3)') !== -1, true);
check('the waitlist is marked rather than merged into the roster',
  digest.indexOf('Cyd Ray — waitlisted') !== -1, true);
check('somebody who cancelled is not coming, so is not listed',
  digest.indexOf('Dee Lee'), -1);
check('and neither is a superseded row', digest.indexOf('Old Bob'), -1);
check('a session outside the countdown is not in this email',
  digest.indexOf('Far Future'), -1);
check('and one that already happened is never "before" anything',
  digest.indexOf('Last Week'), -1);
check('the digest says how to change or stop it',
  digest.indexOf('Notify_Timing') !== -1, true);

// ---------------------------------------------------------------------------
// THE LEDGER. "3 days before" stays true all day; the pass runs hourly.
// ---------------------------------------------------------------------------

check('a second run the same day sends nothing at all',
  sandbox.sendProgramLeaderDaySnapshotDigests(sessions, registrants), 0);
check('...and no second email went out', sentMail.length, 1);

// ---------------------------------------------------------------------------
// A MISSED MORNING IS STILL OWED — the run that should have gone out three
// days ahead never happened, and the class is tomorrow.
// ---------------------------------------------------------------------------

reset();
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [leader('Jane Doe', 'jane@x.com', 'Chair Yoga', 'Narberth', daysBefore(3))]
});
check('a countdown that was missed still sends, late rather than never',
  sandbox.sendProgramLeaderDaySnapshotDigests(
    [session('EV_TOMORROW', 1, 'Chair Yoga', 'Narberth')],
    [registrant('EV_TOMORROW', 'Ann Smith', 'Active', 1)]), 1);

// ---------------------------------------------------------------------------
// THE COUNTDOWN IS PER LEADER. Same class, two leaders, two different
// mornings — the five-day-out session is only the week-notice leader's.
// ---------------------------------------------------------------------------

reset();
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [
    leader('Week Ahead', 'week@x.com', 'Chair Yoga', 'Narberth', daysBefore(7)),
    leader('Two Days', 'two@x.com', 'Chair Yoga', 'Narberth', daysBefore(2))
  ]
});
sandbox.sendProgramLeaderDaySnapshotDigests(
  [session('EV_FIVE', 5, 'Chair Yoga', 'Narberth')],
  [registrant('EV_FIVE', 'Ann Smith', 'Active', 1)]);
check('only the leader whose countdown has started is written to',
  sentMail.map(m => m.to), ['week@x.com']);

// ---------------------------------------------------------------------------
// THE CHANNELS DO NOT LEAK.
// ---------------------------------------------------------------------------

reset();
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [leader('Jane Doe', 'jane@x.com', 'Chair Yoga', 'Narberth', EACH_CHANGE)]
});
check('a leader on the diff channel gets nothing from the digest pass',
  sandbox.sendProgramLeaderDaySnapshotDigests(
    [session('EV_SOON', 1, 'Chair Yoga', 'Narberth')],
    [registrant('EV_SOON', 'Ann Smith', 'Active', 1)]), 0);

reset();
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [leader('Jane Doe', 'jane@x.com', 'Chair Yoga', 'Narberth', daysBefore(3))]
});
check('and a leader on the countdown channel gets nothing from the diff pass',
  sandbox.notifyProgramLeadersOfRosterChanges(
    [session('EV_SOON', 1, 'Chair Yoga', 'Narberth')],
    [registrant('EV_SOON', 'Ann Smith', 'Active', 1)]), 0);
check('...and the diff pass sent no mail on the way to that answer', sentMail.length, 0);

// An unticked box still means silence, whatever the timing cell says.
reset();
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [
    leader('Jane Doe', 'jane@x.com', 'Chair Yoga', 'Narberth', daysBefore(3), false)
  ]
});
check('Notify_Roster_Changes is still the on/off switch',
  sandbox.sendProgramLeaderDaySnapshotDigests(
    [session('EV_SOON', 1, 'Chair Yoga', 'Narberth')],
    [registrant('EV_SOON', 'Ann Smith', 'Active', 1)]), 0);

// ---------------------------------------------------------------------------
// A SEND THAT DID NOT GO IS NOT RECORDED — the next sync owes it again.
// ---------------------------------------------------------------------------

reset();
remainingQuota = 0; // the day's mail is spent; the reserve refuses this pass
sandbox.__setLeaderIndex({
  'chair yoga|narberth': [leader('Jane Doe', 'jane@x.com', 'Chair Yoga', 'Narberth', daysBefore(3))]
});
const quietSessions = [session('EV_SOON', 2, 'Chair Yoga', 'Narberth')];
const quietRegistrants = [registrant('EV_SOON', 'Ann Smith', 'Active', 1)];
check('a held message is not a sent one',
  sandbox.sendProgramLeaderDaySnapshotDigests(quietSessions, quietRegistrants), 0);

remainingQuota = 100; // ...and the next run, with quota again, still owes it
sandbox.resetRationedMailState();
check('...so the next run sends it rather than swallowing it',
  sandbox.sendProgramLeaderDaySnapshotDigests(quietSessions, quietRegistrants), 1);

// ---------------------------------------------------------------------------
// The ledger does not grow forever.
// ---------------------------------------------------------------------------

reset();
sandbox.getLeaderDigestLedger().EV_PAST = { 'jane@x.com': true };
sandbox.getLeaderDigestLedger().EV_AHEAD = { 'jane@x.com': true };
sandbox.getLeaderDigestLedger().EV_FORGOTTEN = { 'jane@x.com': true };
sandbox.pruneLeaderDigestLedger(
  { EV_PAST: '2020-01-01', EV_AHEAD: '2999-01-01' }, '2026-09-03');
check('a session that has happened is dropped, one still ahead is kept, and one the calendar no longer mentions goes too',
  Object.keys(sandbox.getLeaderDigestLedger()), ['EV_AHEAD']);

// ---------------------------------------------------------------------------
// The message itself, on the cases the pass above cannot easily reach.
// ---------------------------------------------------------------------------

const jane = { name: 'Jane', email: 'jane@x.com' };
const oneSession = [{
  title: 'Chair Yoga', location: 'Narberth', date: new Date(2026, 2, 5), dateKey: '2026-03-05',
  url: 'https://docs.google.com/spreadsheets/d/F1/edit',
  roster: [{ name: 'Ann Smith', partySize: 1, waitlisted: false }]
}];

check('one session names it in the subject, and counts one person as a person',
  sandbox.buildLeaderDigestSubject(oneSession).indexOf('1 person on the roster') !== -1, true);
check('several sessions are counted rather than listed',
  sandbox.buildLeaderDigestSubject(oneSession.concat(oneSession, oneSession)),
  '3 upcoming sessions on your roster');
check('the digest links the sheet the roster lives on',
  sandbox.buildLeaderDigestBody(jane, oneSession).indexOf('/d/F1/edit') !== -1, true);

const emptySession = [Object.assign({}, oneSession[0], { roster: [], url: '' })];
check('a session nobody has signed up for says so, rather than trailing off',
  sandbox.buildLeaderDigestBody(jane, emptySession).indexOf('Nobody is registered yet.') !== -1, true);
check('a leader with no name recorded still gets a greeting',
  sandbox.buildLeaderDigestBody({ name: '' }, oneSession).indexOf('Hello,'), 0);

// A class of two hundred is a report, not an email.
const crowd = [];
for (let i = 0; i < 200; i++) crowd.push({ name: `Person ${i}`, partySize: 1, waitlisted: false });
const crowdedBody = sandbox.buildLeaderDigestBody(jane,
  [Object.assign({}, oneSession[0], { roster: crowd })]);
check('a huge roster is truncated, and says that it was',
  crowdedBody.indexOf(`…and ${200 - sandbox.LEADER_ALERT_MAX_LINES_PER_PROGRAM} more.`) !== -1, true);

check('a party of one is not spelled out, because most of them are',
  sandbox.describeLeaderDigestPerson({ name: 'Ann Smith', partySize: 1, waitlisted: false }),
  'Ann Smith');

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
