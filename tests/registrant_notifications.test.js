// PER-PROGRAM NOTIFICATION SETTINGS: what one Registrant_Notifications row means.
//
// The whole feature is six answers a member of staff ticks, and the cost of
// reading them wrong runs both ways. Read too loosely and a program that never
// wrote to anybody starts emailing fifty people every morning. Read too
// strictly and the one person who was promised a 2:15 appointment is told
// nothing at all. So the resolution is pinned here: what the ticks add up to,
// what a row that does not exist yet falls back to, and how the retired
// Notify_Mode dropdown is carried onto the boxes that replaced it.
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
;this.defaultNotificationPolicy = defaultNotificationPolicy;
this.parseReminderDays = parseReminderDays;
this.notificationProgramKey = notificationProgramKey;
this.buildRegistrantReminderBody = buildRegistrantReminderBody;
this.buildRegistrantReminderSubject = buildRegistrantReminderSubject;
this.LEGACY_NOTIFY_MODES = LEGACY_NOTIFY_MODES;
this.policyFromNotificationRow = policyFromNotificationRow;
this.policyFromLegacyCells = policyFromLegacyCells;
this.writeNotificationTicks = writeNotificationTicks;
this.getIndexMap = getIndexMap;
this.REGISTRANT_NOTIFICATION_STAFF_COLUMNS = REGISTRANT_NOTIFICATION_STAFF_COLUMNS;
this.NOTIFICATION_CHECKBOX_COLUMNS = NOTIFICATION_CHECKBOX_COLUMNS;
this.REMINDER_CONFIRMATION_OFFSET = REMINDER_CONFIRMATION_OFFSET;
this.HEADERS = HEADERS;

`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function checkTrue(name, actual) { check(name, !!actual, true); }

const M = sandbox.LEGACY_NOTIFY_MODES;
const NOTIFY_HEADERS = sandbox.HEADERS.Registrant_Notifications;
const notifyMap = sandbox.getIndexMap(NOTIFY_HEADERS);

/** A row with the given ticks, everything else blank. */
function rowWith(ticks) {
  const row = new Array(NOTIFY_HEADERS.length).fill('');
  Object.keys(ticks).forEach(h => { row[notifyMap[h]] = ticks[h]; });
  return row;
}
const readRow = (ticks, isAssistance) =>
  sandbox.policyFromNotificationRow(rowWith(ticks), notifyMap, !!isAssistance);

// ---------------------------------------------------------------------------
// The columns exist, and every answer belongs to the staff.
// ---------------------------------------------------------------------------
['Add_To_Calendar', 'Week_Before', 'Day_Before', 'Morning_Of', 'Other_Reminders',
  'Confirm_On_Booking'].forEach(h => {
  checkTrue(`${h} is a Registrant_Notifications column`, NOTIFY_HEADERS.indexOf(h) !== -1);
  // A refresh that overwrote one of these would wipe the setting every hour.
  checkTrue(`the refresh never overwrites ${h}`,
    sandbox.REGISTRANT_NOTIFICATION_STAFF_COLUMNS.indexOf(h) !== -1);
});
// The retired pair is gone from the tab it used to live on, so nothing reads
// half the answer off a stale column.
check('Notify_Mode has left Program_Options',
  sandbox.HEADERS.Program_Options.indexOf('Notify_Mode'), -1);
check('Reminder_Days has left Program_Options',
  sandbox.HEADERS.Program_Options.indexOf('Reminder_Days'), -1);

// ---------------------------------------------------------------------------
// THE CHANNELS ADD UP. This is the whole reason the dropdown was replaced.
// ---------------------------------------------------------------------------
const everything = readRow({
  Add_To_Calendar: true, Week_Before: true, Day_Before: true, Morning_Of: true,
  Other_Reminders: '14, 3', Confirm_On_Booking: true
});
check('every channel at once, soonest last',
  [everything.invite, everything.remind, everything.confirmTime, everything.days],
  [true, true, true, [14, 7, 3, 1, 0]]);

const weekOnly = readRow({ Add_To_Calendar: true, Week_Before: true });
check('a week out and the calendar, and nothing else',
  [weekOnly.invite, weekOnly.remind, weekOnly.confirmTime, weekOnly.days],
  [true, true, false, [7]]);

const mailOnly = readRow({ Day_Before: true });
check('reminders without the guest list',
  [mailOnly.invite, mailOnly.remind, mailOnly.days], [false, true, [1]]);

// An UNTICKED row is a decision, not an oversight — refreshRegistrantNotifications()
// is what guarantees a row is never born blank (see section 9h).
const silent = readRow({});
check('an all-blank row sends nothing, even for an appointment program',
  [silent.invite, silent.remind, silent.confirmTime, silent.days], [false, false, false, []]);

// Other_Reminders ADDS; it never replaces a box, and never double-counts one.
const overlap = readRow({ Day_Before: true, Other_Reminders: '1, 2' });
check('a day count already ticked is not sent twice', overlap.days, [2, 1]);

// A tick box pasted in as text is still a tick.
check('a pasted "TRUE" counts as ticked',
  readRow({ Add_To_Calendar: 'TRUE' }).invite, true);

// personalizeTime is a fact about the KIND of program, never a tick.
check('an appointment row still states the person\'s own time',
  readRow({ Day_Before: true }, true).personalizeTime, true);
check('...and an ordinary one has no personal time to state',
  readRow({ Day_Before: true }, false).personalizeTime, false);

// ---------------------------------------------------------------------------
// A program with no row yet: notified the way its KIND is notified.
// ---------------------------------------------------------------------------
const ordinary = sandbox.defaultNotificationPolicy(false);
check('a new ordinary program invites and nothing else',
  [ordinary.invite, ordinary.remind, ordinary.days], [true, false, []]);
const assistance = sandbox.defaultNotificationPolicy(true);
check('a new appointment program invites, confirms and reminds',
  [assistance.invite, assistance.remind, assistance.confirmTime, assistance.personalizeTime,
    assistance.days],
  [true, true, true, true, [1]]);

// ...and what the refresh seeds that row with reads back as the same policy.
const seeded = new Array(NOTIFY_HEADERS.length).fill('');
sandbox.writeNotificationTicks(seeded, notifyMap, assistance);
const seededPolicy = sandbox.policyFromNotificationRow(seeded, notifyMap, true);
check('a seeded row round-trips to the policy it was seeded from',
  [seededPolicy.invite, seededPolicy.remind, seededPolicy.confirmTime, seededPolicy.days],
  [true, true, true, [1]]);
// A day count with no box of its own has to land in Other_Reminders or be lost.
const odd = new Array(NOTIFY_HEADERS.length).fill('');
sandbox.writeNotificationTicks(odd, notifyMap,
  { invite: true, remind: true, days: [14, 7], confirmTime: false });
check('a seeded day count with no box lands in Other_Reminders',
  odd[notifyMap['Other_Reminders']], '14');
check('...and the one with a box is ticked', odd[notifyMap['Week_Before']], true);

// ---------------------------------------------------------------------------
// THE CARRY-OVER: what each retired dropdown value becomes.
// ---------------------------------------------------------------------------
const legacy = (mode, days, isAssistance) =>
  sandbox.policyFromLegacyCells({ mode: mode, reminderDays: days }, !!isAssistance);

const none = legacy(M.NONE, '7, 1', true);
check('"Do not notify" carries across as every box unticked',
  [none.invite, none.remind, none.confirmTime, none.days], [false, false, false, []]);

const inviteOnly = legacy(M.INVITE_ONLY, '7', true);
check('"Calendar invite only" carries across as the calendar box alone',
  [inviteOnly.invite, inviteOnly.remind, inviteOnly.days], [true, false, []]);

const remindOnly = legacy(M.REMIND_ONLY, '3', false);
check('"Reminder emails only" keeps the program off the guest list',
  [remindOnly.invite, remindOnly.remind, remindOnly.days], [false, true, [3]]);

const both = legacy(M.INVITE_AND_REMIND, '', false);
check('"+ reminders" with no days typed takes the default cadence',
  [both.invite, both.remind, both.days], [true, true, [1]]);

// A typo must not be the way a program is carried across as silent.
const typo = legacy('inviite', '', true);
check('an unrecognized mode carries across as the kind default',
  [typo.invite, typo.remind, typo.days], [true, true, [1]]);

// Case and spacing are what a person typed, not what they meant.
check('the retired value is matched case-insensitively',
  legacy('  calendar invite only  ', '', true).remind, false);

// ---------------------------------------------------------------------------
// Day counts: forgiving about separators, strict about what they keep.
// ---------------------------------------------------------------------------
check('a list is read soonest last', sandbox.parseReminderDays('1, 7'), [7, 1]);
check('the morning of is 0, and it is kept', sandbox.parseReminderDays('7 and 0'), [7, 0]);
check('duplicates collapse', sandbox.parseReminderDays('1,1,1'), [1]);
check('a day count past the window is dropped', sandbox.parseReminderDays('400, 2'), [2]);
check('pure nonsense yields nothing to send on', sandbox.parseReminderDays('soon-ish'), []);
check('an unparseable Other_Reminders cell costs the boxes nothing',
  readRow({ Day_Before: true, Other_Reminders: 'soon-ish' }).days, [1]);

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
