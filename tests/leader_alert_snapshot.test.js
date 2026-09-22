// THE ROSTER ALERT THAT WOULD NOT STOP.
//
// The office digests for September 2026 recorded the same email over and over:
// gerry@gerryhebert.net got "6 change(s) across Computer Tech Support" three
// separate times on 2026-09-11, hturner@heatherturnerlaw.com "7 change(s)
// across Low Cost Wills" four times — the SAME count every time, which is what
// an un-advanced snapshot looks like from an inbox. Ten days later the same
// workbook filed 25 held-back alerts for one leader in a day, 21 held-back
// digests for another, and 21 "Service invoked too many times for one day:
// email" failures.
//
// TWO FAULTS, one in each half of 66_program_leader_notifications.gs, and this
// pins both.
//
//   1. THE SNAPSHOT WAS PER PROGRAM AND THE SEND IS PER LEADER. A program was
//      re-baselined only once NOBODY was still owed its changes, so a program
//      with two leaders, one of them unreachable, kept its old snapshot — and
//      the leader who COULD be emailed was sent the identical diff again on
//      the next sync. The file called the cost "one duplicate email"; that
//      holds only while the blocker clears within the hour, and the day's mail
//      quota does not clear until midnight.
//
//   2. A DAY-LONG BLOCKER WAS RETRIED HOURLY. 'held' from sendRationedEmail()
//      means the day's quota and nothing else — the per-run cap is checked
//      before the mailer is reached at all — so every remaining sync that day
//      rebuilt the same diff, re-attempted the same send, and filed another
//      held-back line in the office digest.
//
// And the property the whole feature rests on, which neither fix may break: a
// repeated sync over an unchanged roster sends nothing at all.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const properties = {};
const sentMail = [];
const adminNotes = [];
let remainingQuota = 100;

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
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
;this.notifyProgramLeadersOfRosterChanges = notifyProgramLeadersOfRosterChanges;
this.readProgramLeaderNotifyState = readProgramLeaderNotifyState;
this.resetRationedMailState = resetRationedMailState;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.LEADER_ALERT_STATE_PROP_KEY = LEADER_ALERT_STATE_PROP_KEY;
this.LEADER_ALERT_STATE_LEGACY_PROP_KEY = LEADER_ALERT_STATE_LEGACY_PROP_KEY;
this.LEADER_MAIL_QUOTA_HOLD_PROP_KEY = LEADER_MAIL_QUOTA_HOLD_PROP_KEY;
this.__setLeaderIndex = function (rows) { __programLeaderIndexCache = rows; };
this.__resetAlertState = function () { __leaderAlertStateCache = null; };
this.__adminNotes = [];
// The registry is a Drive read this test has no business making; an empty one
// is the honest answer for a program with no shared sheet built yet.
getProgramLeaderSheetRegistry = function () { return {}; };
noteForAdmin = function (section, message) { this.__adminNotes.push(\`\${section}: \${message}\`); }.bind(this);
spoolOfficeNote = function () {};
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

function daysFromToday(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

const SESSIONS = [row(sessionMap, sessionHeaders, {
  Event_ID: 'EV1', Event_Date: daysFromToday(7),
  Clean_Title: 'Computer Tech Support', Location: 'Narberth'
})];

function roster(names) {
  return names.map(name => row(regMap, regHeaders, {
    Event_ID: 'EV1', Name: name, Program_Status: 'Active', Party_Size: 1
  }));
}

const KEY = 'computer tech support|narberth';

/** One leader row as buildProgramLeaderIndex() would have read it off the tab. */
function leader(name, email) {
  return {
    name, emails: [email], notify: true, timing: { mode: 'each_change', days: 0 },
    programTitle: 'Computer Tech Support', programLocation: 'Narberth'
  };
}

function reset(leaders) {
  Object.keys(properties).forEach(k => { delete properties[k]; });
  sentMail.length = 0;
  sandbox.__adminNotes.length = 0;
  remainingQuota = 100;
  sandbox.resetRationedMailState();
  sandbox.__resetAlertState();
  sandbox.__setLeaderIndex({ [KEY]: leaders });
}

/** One hourly sync of the diff pass. */
function sync(names) {
  sandbox.resetRationedMailState();
  sandbox.__resetAlertState();
  return sandbox.notifyProgramLeadersOfRosterChanges(SESSIONS, roster(names));
}

// ---------------------------------------------------------------------------
// THE PROPERTY THE FEATURE RESTS ON: an unchanged roster is silence, for ever.
// ---------------------------------------------------------------------------

reset([leader('Gerry Hebert', 'gerry@x.com')]);
check('the first sight of a program is a baseline and no mail', sync(['Ann Smith']), 0);
check('...and the second sync over the same roster says nothing', sync(['Ann Smith']), 0);
check('...and so does the twelfth', [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(() => sync(['Ann Smith'])),
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
check('nothing was mailed across any of it', sentMail.length, 0);

check('a real change is one email...', sync(['Ann Smith', 'Bob Jones']), 1);
check('...and the sync after it is quiet again, because the snapshot advanced',
  sync(['Ann Smith', 'Bob Jones']), 0);
check('so the leader heard about Bob exactly once', sentMail.length, 1);

// ---------------------------------------------------------------------------
// FAULT 1: one leader's failure must not re-send to the other.
//
// Two leaders on one program. The second address is one MailApp will not take,
// which is a fault that does not clear by itself — so under the old
// per-program snapshot the first leader was sent the same diff every hour
// until somebody corrected a spreadsheet cell.
// ---------------------------------------------------------------------------

reset([leader('Gerry Hebert', 'gerry@x.com'), leader('Heather Turner', 'bad@x.com')]);
sandbox.MailApp.sendEmail = options => {
  if (options.to === 'bad@x.com') throw new Error('Invalid email: bad@x.com');
  sentMail.push(options);
};

check('a baseline for both leaders, and no mail', sync(['Ann Smith']), 0);
check('a change reaches the leader it can reach', sync(['Ann Smith', 'Bob Jones']), 1);
check('...and the next hour does not tell that leader about Bob again',
  sync(['Ann Smith', 'Bob Jones']), 0);
check('so the reachable leader got exactly one email, not one an hour',
  sentMail.filter(m => m.to === 'gerry@x.com').length, 1);
const owed = sandbox.readProgramLeaderNotifyState().programs[KEY].leaders['bad@x.com'];
check('and the unreachable leader still owes Bob — their baseline did not move',
  Object.keys(owed).filter(k => k.indexOf('bob jones') !== -1).length, 0);
const told = sandbox.readProgramLeaderNotifyState().programs[KEY].leaders['gerry@x.com'];
check('...while the leader who WAS told has Bob in theirs',
  Object.keys(told).filter(k => k.indexOf('bob jones') !== -1).length, 1);

sandbox.MailApp.sendEmail = options => { sentMail.push(options); };

// ---------------------------------------------------------------------------
// FAULT 2: the day's quota is not retried every hour.
// ---------------------------------------------------------------------------

reset([leader('Gerry Hebert', 'gerry@x.com')]);
check('a baseline first', sync(['Ann Smith']), 0);

remainingQuota = 0; // the reserve refuses every send for the rest of the day
check('a change nobody can send is not a change sent', sync(['Ann Smith', 'Bob Jones']), 0);
check('and the office is told, once', sandbox.__adminNotes.filter(
  n => n.indexOf('held until tomorrow') !== -1).length, 1);

remainingQuota = 100; // the estimate reads healthy again; the day is still spent
check('the next sync today does not try again', sync(['Ann Smith', 'Bob Jones']), 0);
check('...nor the one after it', sync(['Ann Smith', 'Bob Jones']), 0);
check('nothing was mailed by any of them', sentMail.length, 0);
check('and the office was NOT told again — 25 identical digest lines in a day was the bug',
  sandbox.__adminNotes.filter(n => n.indexOf('held until tomorrow') !== -1).length, 1);

delete properties[sandbox.LEADER_MAIL_QUOTA_HOLD_PROP_KEY]; // tomorrow
check('tomorrow the change goes out, late but not lost', sync(['Ann Smith', 'Bob Jones']), 1);
check('...and the sync after that is quiet', sync(['Ann Smith', 'Bob Jones']), 0);

// ---------------------------------------------------------------------------
// THE CARRY-OVER. A workbook upgrading from the per-program state must not
// read as a first run for anybody: that would mail every leader their whole
// roster as new arrivals, which is THE FIRST RUN's failure wearing the
// migration's hat.
// ---------------------------------------------------------------------------

reset([leader('Gerry Hebert', 'gerry@x.com'), leader('Heather Turner', 'heather@x.com')]);
const legacy = { programs: {} };
legacy.programs[KEY] = { at: '2026-09-10T00:00:00.000Z', roster: {} };
// What the V1 state held: Ann, on the session a week out.
const annKey = `${sandbox.Utilities.formatDate(daysFromToday(7), '', 'yyyy-MM-dd')}|ann smith`;
legacy.programs[KEY].roster[annKey] = 'A';
properties[`${sandbox.LEADER_ALERT_STATE_LEGACY_PROP_KEY}_0`] = JSON.stringify(legacy);
properties[sandbox.LEADER_ALERT_STATE_LEGACY_PROP_KEY] = JSON.stringify({ chunks: 1 });

check('the upgrade sync is silent — the old baseline is what both leaders are diffed against',
  sync(['Ann Smith']), 0);
check('...and mailed nobody a roster they already had', sentMail.length, 0);
check('a change after the upgrade reaches both leaders, once each',
  sync(['Ann Smith', 'Bob Jones']), 2);
check('...and does not reach them again', sync(['Ann Smith', 'Bob Jones']), 0);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
