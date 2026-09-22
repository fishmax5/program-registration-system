// NOTIFICATION TEST MODE (section 99i).
//
// The question the other two switches cannot answer is "what would this
// workbook say to people if I let it?". The pause stops the mail and DISCARDS
// it; automation-off stops the syncs so there is nothing to look at. This mode
// readdresses every outgoing message to the office instead, and what is pinned
// here is the three rules that make it a rehearsal rather than a second pause:
//
//   NOTHING REACHES THE PERSON. The address MailApp is handed is the office's,
//   never the member's — and the member's real To/Bcc/subject are in the body
//   where somebody can check them.
//
//   NOTHING IS CONSUMED. recordSent() is NOT called, unlike the pause, so the
//   real message is still owed when the switch goes off. That is the whole
//   difference and it is one line.
//
//   IT IS CAPPED. Because nothing is consumed, the same messages divert again
//   every pass — so past the cap nothing more is sent and the office is told
//   how many it did not see.
//
// And the fourth thing, which the pause deliberately does NOT do: a calendar
// guest is not added at all, because Google emails them the moment they are.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sent = [];
const spooled = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => (pattern === 'h:mm a' ? '9:05 AM' : new Date(d).toISOString()),
    getUuid: () => 'x', sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: null,
  MailApp: {
    getRemainingDailyQuota: () => 500,
    sendEmail: options => { sent.push(options); }
  }
};
vm.createContext(sandbox);
vm.runInContext('var OFFICE_NOTES_HOLDER = [];', sandbox);
vm.runInContext(src + `
;this.sendRationedEmail = sendRationedEmail;
this.divertNotificationForTest = divertNotificationForTest;
this.recordHeldCalendarInvite = recordHeldCalendarInvite;
this.notificationTestModeTally = notificationTestModeTally;
this.NOTIFICATION_TEST_MODE_MAX_PER_RUN = NOTIFICATION_TEST_MODE_MAX_PER_RUN;
`, sandbox, { filename: 'program.gs' });

// The stubs, installed after the source so they replace the real readers. The
// spool they write into is declared in the context above, before the source.
vm.runInContext(`
this.__stub = function (opts) {
  isNotificationTestMode = () => !!opts.testing;
  isOutboundMailPaused = () => !!opts.paused;
  isWithinMailQuietHours = () => !!opts.quiet;
  getAllAdminNotificationEmails = () => (opts.office || ['office@nh.org', 'caroline@nh.org']);
  spoolOfficeNote = (section, message) => { OFFICE_NOTES_HOLDER.push({ section, message }); return true; };
  noteForAdmin = () => true;
};
this.officeNotes = () => OFFICE_NOTES_HOLDER;
this.resetCounters = () => {
  __notificationTestDiverted = 0;
  __notificationTestSuppressed = 0;
  __notificationTestHeldInvites = 0;
  __notificationTestReported = false;
  __notificationTestCapReported = false;
  __rationedMailQuota = null;
  __rationedMailRefused = {};
  OFFICE_NOTES_HOLDER.length = 0;
};
`, sandbox);

const { sendRationedEmail, notificationTestModeTally, NOTIFICATION_TEST_MODE_MAX_PER_RUN } = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}
function checkTrue(label, got) { check(label, !!got, true); }

function request(extra) {
  return Object.assign({
    to: 'member@example.com',
    subject: 'Your program is tomorrow',
    body: 'Chair Yoga, Tuesday at 10:30. See you there.',
    recordSent: () => { ledgerWrites++; },
    alreadySent: () => false
  }, extra || {});
}
let ledgerWrites = 0;

// --- Nothing reaches the person -------------------------------------------
sandbox.__stub({ testing: true });
sandbox.resetCounters();
sent.length = 0;
ledgerWrites = 0;
const outcome = sendRationedEmail(request({ bcc: ['office@nh.org'], describeRecipient: 'Karl Hardman' }));

check('one message went out', sent.length, 1);
check('addressed to the office, not the member', sent[0].to, 'office@nh.org,caroline@nh.org');
checkTrue('the subject says it is a test', sent[0].subject.indexOf('[TEST] ') === 0);
checkTrue('...and keeps the real subject after it',
  sent[0].subject.indexOf('Your program is tomorrow') !== -1);
checkTrue('the body names the real recipient', sent[0].body.indexOf('member@example.com') !== -1);
checkTrue('...and the real Bcc, in full', sent[0].body.indexOf('office@nh.org') !== -1);
checkTrue('...and who it was about', sent[0].body.indexOf('Karl Hardman') !== -1);
checkTrue('the message itself is underneath, unchanged',
  sent[0].body.indexOf('Chair Yoga, Tuesday at 10:30. See you there.') !== -1);
check('nothing is Bcc\'d on the diverted copy', sent[0].bcc, undefined);

// --- Nothing is consumed ---------------------------------------------------
// THE ONE LINE THAT SEPARATES THIS FROM THE PAUSE. The pause calls recordSent()
// so the churn never arrives late; a rehearsal must leave the member's real
// reminder owed.
check('the caller\'s ledger was not advanced', ledgerWrites, 0);
check('and the caller is told "held", the status it already understands',
  outcome.status, 'held');
checkTrue('with a reason that says where the copy went',
  outcome.error.indexOf('office') !== -1);

// --- The switch says so, once ----------------------------------------------
sent.length = 0;
sendRationedEmail(request());
const notes = sandbox.officeNotes();
check('the office is told the switch is on exactly once',
  notes.filter(n => n.message.indexOf('Notification test mode is ON') === 0).length, 1);

// --- The cap ---------------------------------------------------------------
sandbox.resetCounters();
sent.length = 0;
for (let i = 0; i < NOTIFICATION_TEST_MODE_MAX_PER_RUN + 4; i++) sendRationedEmail(request());
check('the cap is what goes out', sent.length, NOTIFICATION_TEST_MODE_MAX_PER_RUN);
check('and the rest are counted',
  notificationTestModeTally().suppressed, 4);
checkTrue('with one line saying what was not seen',
  sandbox.officeNotes().some(n => n.message.indexOf('a sample, not the whole of it') !== -1));

// --- The pause still wins --------------------------------------------------
// A workbook sending nothing at all has nothing to rehearse.
sandbox.__stub({ testing: true, paused: true });
sandbox.resetCounters();
sent.length = 0;
ledgerWrites = 0;
const paused = sendRationedEmail(request());
check('a paused workbook diverts nothing', sent.length, 0);
check('...and says paused', paused.status, 'paused');
check('...and consumes it, exactly as the pause always has', ledgerWrites, 1);

// --- Quiet hours do not hold a rehearsal ----------------------------------
// The copy goes to the office that asked for it; holding it until 8am is a
// rehearsal nobody sees.
sandbox.__stub({ testing: true, quiet: true });
sandbox.resetCounters();
sent.length = 0;
sendRationedEmail(request());
check('a rehearsal is not held by quiet hours', sent.length, 1);

// --- No office addresses --------------------------------------------------
sandbox.__stub({ testing: true, office: [] });
sandbox.resetCounters();
sent.length = 0;
ledgerWrites = 0;
const nowhere = sendRationedEmail(request());
check('with nowhere to divert to, nothing is sent', sent.length, 0);
check('...and nothing is consumed either', ledgerWrites, 0);
check('...and it is held', nowhere.status, 'held');

// --- The invitation that is also an email ---------------------------------
sandbox.__stub({ testing: true });
sandbox.resetCounters();
sandbox.recordHeldCalendarInvite('member@example.com', { title: 'Chair Yoga', date: new Date() });
check('a held invitation is counted', notificationTestModeTally().heldInvites, 1);
checkTrue('...and filed with who and what',
  sandbox.officeNotes().some(n => n.message.indexOf('member@example.com') !== -1 &&
    n.message.indexOf('Chair Yoga') !== -1));

console.log(failures === 0 ? '\nAll notification test mode checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
