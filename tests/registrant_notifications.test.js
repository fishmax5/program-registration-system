// PER-PROGRAM NOTIFICATION SETTINGS: what one Program_Options row means.
//
// The whole feature is two cells a member of staff types into, and the cost of
// reading them wrong runs both ways. Read too loosely and a program that never
// wrote to anybody starts emailing fifty people every morning. Read too
// strictly — a typo taken as "do not notify" — and the one person who was
// promised a 2:15 appointment is told nothing at all. So the resolution is
// pinned here: what a blank row means for each KIND of program, what each
// dropdown value overrides, and what an unrecognized cell falls back to.
//
// The appointment case is checked all the way to the message, because the
// time line in it is the reason this exists: a calendar event has one
// description shared by every guest, so the person's own slot can only be
// said in mail.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
;this.resolveNotificationPolicy = resolveNotificationPolicy;
this.defaultNotificationPolicy = defaultNotificationPolicy;
this.parseReminderDays = parseReminderDays;
this.notificationProgramKey = notificationProgramKey;
this.buildRegistrantReminderBody = buildRegistrantReminderBody;
this.buildRegistrantReminderSubject = buildRegistrantReminderSubject;
this.NOTIFY_MODES = NOTIFY_MODES;
this.REMINDER_CONFIRMATION_OFFSET = REMINDER_CONFIRMATION_OFFSET;
this.HEADERS = HEADERS;
this.PROGRAM_OPTIONS_STAFF_COLUMNS = PROGRAM_OPTIONS_STAFF_COLUMNS;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function checkTrue(name, actual) { check(name, !!actual, true); }

const M = sandbox.NOTIFY_MODES;
const resolve = sandbox.resolveNotificationPolicy;

// ---------------------------------------------------------------------------
// The columns exist, and they belong to the staff.
// ---------------------------------------------------------------------------
checkTrue('Notify_Mode is a Program_Options column',
  sandbox.HEADERS.Program_Options.indexOf('Notify_Mode') !== -1);
checkTrue('Reminder_Days is a Program_Options column',
  sandbox.HEADERS.Program_Options.indexOf('Reminder_Days') !== -1);
// A refresh that overwrote these would wipe the setting every hour.
checkTrue('the refresh never overwrites Notify_Mode',
  sandbox.PROGRAM_OPTIONS_STAFF_COLUMNS.indexOf('Notify_Mode') !== -1);
checkTrue('the refresh never overwrites Reminder_Days',
  sandbox.PROGRAM_OPTIONS_STAFF_COLUMNS.indexOf('Reminder_Days') !== -1);

// ---------------------------------------------------------------------------
// A blank row: the program is notified the way its KIND is notified.
// ---------------------------------------------------------------------------
const ordinary = resolve('', '', false);
check('a blank row on an ordinary program invites and nothing else',
  [ordinary.invite, ordinary.remind, ordinary.days], [true, false, []]);

const assistance = resolve('', '', true);
check('a blank row on an appointment program invites, confirms and reminds',
  [assistance.invite, assistance.remind, assistance.confirmTime, assistance.personalizeTime,
    assistance.days],
  [true, true, true, true, [1]]);

// A typo must not be a silent way to stop telling somebody about a booking.
const typo = resolve('inviite', '', true);
check('an unrecognized mode falls back to the kind default',
  [typo.invite, typo.remind, typo.days], [true, true, [1]]);

// ---------------------------------------------------------------------------
// What each dropdown value overrides.
// ---------------------------------------------------------------------------
const none = resolve(M.NONE, '7, 1', true);
check('"Do not notify" silences both channels, days and all',
  [none.invite, none.remind, none.confirmTime, none.days], [false, false, false, []]);

const inviteOnly = resolve(M.INVITE_ONLY, '7', true);
check('"Calendar invite only" drops the reminders an appointment would default to',
  [inviteOnly.invite, inviteOnly.remind, inviteOnly.days], [true, false, []]);

const remindOnly = resolve(M.REMIND_ONLY, '3', false);
check('"Reminder emails only" keeps the program off the guest list',
  [remindOnly.invite, remindOnly.remind, remindOnly.days], [false, true, [3]]);

const both = resolve(M.INVITE_AND_REMIND, '', false);
check('"+ reminders" on a program with no days typed takes the default cadence',
  [both.invite, both.remind, both.days], [true, true, [1]]);

// Case and spacing are what a person types, not what they mean.
check('the dropdown value is matched case-insensitively',
  resolve('  calendar invite only  ', '', true).remind, false);

// ---------------------------------------------------------------------------
// Reminder_Days: forgiving about separators, strict about what it keeps.
// ---------------------------------------------------------------------------
check('a list is read soonest last', sandbox.parseReminderDays('1, 7'), [7, 1]);
check('the morning of is 0, and it is kept', sandbox.parseReminderDays('7 and 0'), [7, 0]);
check('duplicates collapse', sandbox.parseReminderDays('1,1,1'), [1]);
check('a day count past the window is dropped', sandbox.parseReminderDays('400, 2'), [2]);
check('pure nonsense yields nothing to send on', sandbox.parseReminderDays('soon-ish'), []);
// ...and nothing is where the mode's own default takes over, rather than silence.
check('an unparseable cell falls back to the default cadence',
  resolve(M.INVITE_AND_REMIND, 'soon-ish', false).days, [1]);

// ---------------------------------------------------------------------------
// The message. The time line is the whole point of it.
// ---------------------------------------------------------------------------
const session = {
  title: 'Personalized Assistance', location: 'Main Building',
  date: new Date(2026, 2, 3), time: '9:00 AM – 4:00 PM'
};
const booked = sandbox.buildRegistrantReminderBody(
  session, { name: "Mary O'Brien", time: '2:15 PM' }, sandbox.REMINDER_CONFIRMATION_OFFSET, 5);
checkTrue('a booking confirmation states the person\'s own time', booked.indexOf('2:15 PM') !== -1);
checkTrue('...and greets them by name', booked.indexOf("Mary O'Brien") !== -1);
// The shared block hours must not appear beside a personal slot — two times in
// one message is exactly the confusion this feature exists to remove.
check('...and does not also quote the whole block', booked.indexOf('9:00 AM – 4:00 PM'), -1);

const dayBefore = sandbox.buildRegistrantReminderBody(
  session, { name: 'Mary', time: '2:15 PM' }, 1, 1);
checkTrue('the day-before reminder says tomorrow', dayBefore.indexOf('tomorrow') !== -1);
checkTrue('...and repeats the time', dayBefore.indexOf('2:15 PM') !== -1);

const group = sandbox.buildRegistrantReminderBody(
  { title: 'Chair Yoga', location: 'Annex', date: new Date(2026, 2, 3), time: '10:00 AM' },
  { name: 'Sam', time: '' }, 0, 0);
checkTrue('a program with no per-person time falls back to the session time',
  group.indexOf('10:00 AM') !== -1);
checkTrue('...and says today', group.indexOf('today') !== -1);

check('the confirmation subject is not a countdown',
  sandbox.buildRegistrantReminderSubject(session, sandbox.REMINDER_CONFIRMATION_OFFSET)
    .indexOf('Reminder'), -1);
checkTrue('a countdown subject names the program',
  sandbox.buildRegistrantReminderSubject(session, 1).indexOf('Personalized Assistance') !== -1);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
