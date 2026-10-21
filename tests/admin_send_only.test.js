// THE ADMIN ACCOUNT IS SEND-ONLY. Nobody reads it, so (1) every message to a
// member or leader carries a Reply-To that reaches Caroline, and (2) a Quick
// Mark that did not save is addressed to the person who made it plus Caroline,
// not to the office table. Door sign-in failures keep the office table: the
// tablet has no signed-in person.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sent = [];
const sandbox = {
  console: { log: () => {} },
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'admin@example.org' }),
    getActiveUser: () => ({ getEmail: () => 'Deskhelper@Example.org' })
  },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {},
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail: o => sent.push(o)
  }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'program.gs' });

const REPLY = vm.runInContext('MAIL_REPLY_TO', sandbox);
const NAME = vm.runInContext('CENTER_NAME', sandbox);
let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

sandbox.getAdminNotificationRows = () => [
  { email: 'office@example.org', syncDigest: true, leaderRosterAlerts: false,
    registrantReminders: false, calendarInviteGuest: false }
];
sandbox.queueOptimisticRetry = () => false;
sandbox.quietHoursHoldsUrgentMail = () => false;
sandbox.isWithinMailQuietHours = () => false;
sandbox.rationedMailIsPaused = () => false;
sandbox.isNotificationTestMode = () => false;

// 1. A member message replies to Caroline.
const out = sandbox.sendRationedEmail({ to: 'joan@example.com', subject: 's', body: 'b' });
ok('a member message is sent', out.status === 'sent');
ok('with Reply-To Caroline', sent[0] && sent[0].replyTo === REPLY);
ok('and a display name', sent[0] && sent[0].name === NAME);

// 2. A failed optimistic Quick Mark goes to the submitter and Caroline.
sent.length = 0;
sandbox.reportOptimisticQuickMarkFailure(
  { optimistic: true, name: 'Joan', session: 'Yoga', location: 'Narberth' },
  { ok: false, message: 'locked' });
ok('one failure message', sent.length === 1);
const to = (sent[0] ? sent[0].to : '').split(',');
ok('to the desk user (lower-cased)', to.indexOf('deskhelper@example.org') !== -1);
ok('and to Caroline', to.indexOf(REPLY) !== -1);
ok('and not to the office table', to.indexOf('office@example.org') === -1);

// 3. With nobody identifiable, Caroline still gets it.
sent.length = 0;
sandbox.Session.getActiveUser = () => ({ getEmail: () => '' });
sandbox.reportOptimisticQuickMarkFailure({ optimistic: true, name: 'Joan' }, { ok: false, message: 'x' });
ok('unknown submitter -> Caroline only', sent.length === 1 && sent[0].to === REPLY);

// 4. Urgent mail without a named person keeps the office table.
sent.length = 0;
sandbox.notifyAdminUrgent('door', 'body');
ok('door-style urgent mail still goes to the office table', sent[0] && sent[0].to === 'office@example.org');

// 5. The retried-then-exhausted notice uses the stamped submitter.
sent.length = 0;
sandbox.reportExhaustedOptimisticRetry(
  { kind: 'quickMark', args: { name: 'Joan', submittedBy: 'deskhelper@example.org' }, firstMessage: 'a' }, 'b', 4);
ok('exhausted retry -> submitter + Caroline',
  sent.length === 1 && sent[0].to === `deskhelper@example.org,${REPLY}`);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed');
process.exit(fail ? 1 : 0);
