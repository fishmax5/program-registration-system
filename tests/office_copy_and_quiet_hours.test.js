// WHAT THE OFFICE SEES, AND WHAT TIME OF NIGHT A MEMBER HEARS FROM US.
//
// Two rules about outbound mail, both of which look like polish and are not:
//
//   * THE OFFICE COPY. The desk wants a thread it can talk on — "did anyone
//     call her back?" belongs under the reminder that prompted it. A BCC gives
//     them the message but not that: reply-all on a BCC'd copy goes to the
//     MEMBER. So the member's copy names the member alone and the office is
//     sent its own message. Checked here from both ends: the member's envelope
//     must not carry an office address, and the office's copy must exist, say
//     who the original went to, and cost what the BCC cost.
//
//   * NINE IN THE MORNING. The reminder pass rides the hourly sync, so before
//     this it mailed people at 12:10am. The gate defers, it does not drop —
//     a reminder held overnight is one nobody has been told about yet, and the
//     morning's sync still owes it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sentMail = [];
let now = new Date('2026-09-08T14:00:00Z');
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
      // The tests below care only about the hour and the day, and read them in
      // UTC: TIMEZONE is stubbed out of the picture, so "9" here means the
      // gate's own comparison is what is under test, not a timezone library.
      if (pattern === 'H') return String(d.getUTCHours());
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: null,
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail: (a, subject, body) => sentMail.push(
      a && typeof a === 'object' ? a : { to: a, subject, body })
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.sendRationedEmail = sendRationedEmail;
this.resetRationedMailState = resetRationedMailState;
this.isWithinRegistrantReminderHours = isWithinRegistrantReminderHours;
this.REMINDER_EARLIEST_HOUR = REMINDER_EARLIEST_HOUR;
this.OFFICE_COPY_SUBJECT_PREFIX = OFFICE_COPY_SUBJECT_PREFIX;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}

// ---------------------------------------------------------------------------
// 1. THE OFFICE COPY IS A SEPARATE MESSAGE.
// ---------------------------------------------------------------------------
sentMail.length = 0;
sandbox.resetRationedMailState();
const forwarded = sandbox.sendRationedEmail({
  to: 'member@example.org',
  subject: 'Reminder: Chair Yoga tomorrow',
  body: 'Hello Ada,',
  reserve: 0,
  bcc: ['office@example.org', 'desk@example.org'],
  officeCopy: true,
  describeRecipient: 'Reminder sent to Ada <member@example.org> about "Chair Yoga"'
});
check('it went', forwarded.status, 'sent');
check('two messages: the member\'s and the office\'s', sentMail.length, 2);
check('the member is written to alone', sentMail[0].to, 'member@example.org');
check('...with no office address on the envelope at all',
  [sentMail[0].bcc, sentMail[0].cc], [undefined, undefined]);
check('the office copy goes to every ticked address',
  sentMail[1].to, 'office@example.org,desk@example.org');
check('marked as a copy in the subject',
  sentMail[1].subject.indexOf(sandbox.OFFICE_COPY_SUBJECT_PREFIX), 0);
check('...and still names the original, so it files with it',
  sentMail[1].subject.indexOf('Reminder: Chair Yoga tomorrow') > 0, true);
check('it says who actually received the original',
  sentMail[1].body.indexOf('Ada <member@example.org>') !== -1, true);
check('and that a reply-all stays in the office',
  sentMail[1].body.indexOf('member@example.org is not on it') !== -1, true);
check('the copy is not free: it costs one message per office address',
  forwarded.cost, 3);

// A pass that does NOT ask for the forward keeps the BCC it always had.
sentMail.length = 0;
sandbox.resetRationedMailState();
const bcc = sandbox.sendRationedEmail({
  to: 'leader@example.org', subject: 'Roster changes', body: 'Two changes.',
  reserve: 0, bcc: ['office@example.org']
});
check('a BCC caller still sends one message', [bcc.status, sentMail.length], ['sent', 1]);
check('...with the office hidden on it', sentMail[0].bcc, 'office@example.org');

// Nobody ticked: no copy, no forward, no second message.
sentMail.length = 0;
sandbox.resetRationedMailState();
sandbox.sendRationedEmail({
  to: 'member@example.org', subject: 'Reminder', body: 'x', reserve: 0,
  bcc: [], officeCopy: true
});
check('an empty office list copies nobody', sentMail.length, 1);

// A forward MailApp refuses must not turn a delivered reminder into a failure:
// the member was told, and a retry next hour would tell them twice.
sentMail.length = 0;
sandbox.resetRationedMailState();
let call = 0;
const realSend = sandbox.MailApp.sendEmail;
sandbox.MailApp.sendEmail = function (options) {
  call++;
  if (call === 2) throw new Error('office list rejected');
  return realSend(options);
};
const survived = sandbox.sendRationedEmail({
  to: 'member@example.org', subject: 'Reminder', body: 'x', reserve: 0,
  bcc: ['office@example.org'], officeCopy: true
});
sandbox.MailApp.sendEmail = realSend;
check('a failed office copy still reads as sent', survived.status, 'sent');
check('...and the member\'s message was the one that went', sentMail.map(m => m.to), ['member@example.org']);

// ---------------------------------------------------------------------------
// 2. NOT BEFORE NINE.
// ---------------------------------------------------------------------------
check('the gate is 9am', sandbox.REMINDER_EARLIEST_HOUR, 9);
check('12:10am is too early',
  sandbox.isWithinRegistrantReminderHours(new Date(Date.UTC(2026, 8, 8, 0, 10))), false);
check('8:59am is still too early',
  sandbox.isWithinRegistrantReminderHours(new Date(Date.UTC(2026, 8, 8, 8, 59))), false);
check('9:00am sends',
  sandbox.isWithinRegistrantReminderHours(new Date(Date.UTC(2026, 8, 8, 9, 0))), true);
check('and so does the whole rest of the day',
  sandbox.isWithinRegistrantReminderHours(new Date(Date.UTC(2026, 8, 8, 23, 30))), true);

console.log(failures === 0 ? '\nAll office copy and quiet hours tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
