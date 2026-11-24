// WEEKLY REGISTRANT EMAIL (70_registrant_notifications.gs) — one email a week
// per person in place of a message per program per reminder.
//
// Pinned here: the Friday email goes out from Friday 10am and not before; it
// lists every Active session in the coming Monday–Sunday with waitlisted
// places apart; an appointment shows the person's own time; one address with
// two people on it gets one email; a sign-up after the Friday email gets one
// short "added to your week" note naming only what is new; the hourly sync
// never sends the same thing twice; and the first run never mails a week the
// per-program reminders were already covering.
const assert = require('assert');
const vm = require('vm');
const src = require('./helpers/source').readSource();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
function fmt(d, tz, pattern) {
  switch (pattern) {
    case 'yyyy-MM-dd': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'H': return String(d.getHours());
    case 'h:mm a': return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    case 'EEE, MMM d': return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    case 'EEEE, MMM d': return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    case 'EEE, MMM d, yyyy': return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    default: return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

const props = { REGISTRANT_REMINDERS_V1: JSON.stringify({ chunks: 1 }), REGISTRANT_REMINDERS_V1_0: '{}' };
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: fmt, sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    setProperties: o => Object.assign(props, o),
    deleteProperty: k => { delete props[k]; }
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.sendWeeklyRegistrantEmails = sendWeeklyRegistrantEmails;
this.firstWeeklyEmailWeek_ = firstWeeklyEmailWeek_;
this.weeklyEmailIsDue_ = weeklyEmailIsDue_;
this.mondayOfDateKey_ = mondayOfDateKey_;
this.shiftDateKey_ = shiftDateKey_;
this.collectWeeklyEmailItems = collectWeeklyEmailItems;
this.resetWeeklyLedgerForTest = function () { __weeklyEmailLedgerCache = null; __weeklyEmailLedgerDirty = false; };
log = function () {};
spoolOfficeNote = function (section, line) { SPOOLED.push(line); };
noteForAdmin = function () {};
dayLongMailHoldInEffect = function () { return false; };
sendRationedEmail = function (msg) {
  if (msg.alreadySent && msg.alreadySent()) return { status: 'duplicate' };
  SENT.push(msg);
  if (msg.recordSent) msg.recordSent();
  return { status: 'sent' };
};
`.replace('SPOOLED', 'this.SPOOLED').replace('SENT.push', 'this.SENT.push'), sandbox);
sandbox.SPOOLED = [];
sandbox.SENT = [];

// ---------------------------------------------------------------------------
// The calendar arithmetic.
// ---------------------------------------------------------------------------
assert.strictEqual(sandbox.mondayOfDateKey_('2026-11-20'), '2026-11-16', 'a Friday belongs to its own week');
assert.strictEqual(sandbox.mondayOfDateKey_('2026-11-22'), '2026-11-16', 'a Sunday ends the week');
assert.strictEqual(sandbox.shiftDateKey_('2026-11-30', 2), '2026-12-02', 'across a month end');
assert.strictEqual(sandbox.weeklyEmailIsDue_('2026-11-23', '2026-11-20', 9), false, 'not before 10am Friday');
assert.strictEqual(sandbox.weeklyEmailIsDue_('2026-11-23', '2026-11-20', 10), true, 'from 10am Friday');
assert.strictEqual(sandbox.weeklyEmailIsDue_('2026-11-23', '2026-11-19', 15), false, 'never on Thursday');
assert.strictEqual(sandbox.firstWeeklyEmailWeek_('2026-11-20'), '2026-11-23', 'merged on a Friday: starts with next week');
assert.strictEqual(sandbox.firstWeeklyEmailWeek_('2026-11-24'), '2026-11-23', 'merged on a Tuesday: the rest of this week');

// ---------------------------------------------------------------------------
// The tables.
// ---------------------------------------------------------------------------
const SH = sandbox.HEADERS.All_Program_Sessions;
const RH = sandbox.HEADERS.All_Registrants;
function sessionRow(f) { const r = new Array(SH.length).fill(''); Object.keys(f).forEach(k => { r[SH.indexOf(k)] = f[k]; }); return r; }
function regRow(f) { const r = new Array(RH.length).fill(''); Object.keys(f).forEach(k => { r[RH.indexOf(k)] = f[k]; }); return r; }
const d = (y, m, day) => new Date(y, m - 1, day);

const sessions = [
  sessionRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Clean_Title: 'Chair Yoga', Location: 'Narberth', Event_Time: '10:00 AM' }),
  sessionRow({ Event_ID: 'lunch', Event_Date: d(2026, 11, 24), Clean_Title: 'Lunch', Location: 'Narberth', Event_Time: '12:00 PM' }),
  sessionRow({ Event_ID: 'tech', Event_Date: d(2026, 11, 25), Clean_Title: 'Tech Help', Location: 'Ashbridge',
    Event_Time: '9:00 AM – 4:00 PM', Personalized_Assistance: true }),
  sessionRow({ Event_ID: 'mahj', Event_Date: d(2026, 11, 26), Clean_Title: 'Mah Jongg', Location: 'Ashbridge', Event_Time: '1:00 PM' }),
  sessionRow({ Event_ID: 'gone', Event_Date: d(2026, 11, 27), Clean_Title: 'CANCELLED DUE TO ILLNESS: Tai Chi', Location: 'Narberth', Event_Time: '11:00 AM' }),
  sessionRow({ Event_ID: 'later', Event_Date: d(2026, 12, 1), Clean_Title: 'Chair Yoga', Location: 'Narberth', Event_Time: '10:00 AM' }),
  sessionRow({ Event_ID: 'thisweek', Event_Date: d(2026, 11, 21), Clean_Title: 'Bingo', Location: 'Narberth', Event_Time: '2:00 PM' })
];
const A = 'a@example.org';
const registrants = [
  // Listed out of order on purpose: the email sorts by day and time.
  regRow({ Event_ID: 'lunch', Event_Date: d(2026, 11, 24), Event: 'Lunch', Name: 'Pat', Email: A, Program_Status: 'Active' }),
  regRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Event: 'Chair Yoga', Name: 'Pat', Email: A, Program_Status: 'Active' }),
  regRow({ Event_ID: 'tech', Event_Date: d(2026, 11, 25), Event: 'Tech Help', Event_Time: '2:15 PM', Name: 'Pat', Email: A, Program_Status: 'Active' }),
  regRow({ Event_ID: 'mahj', Event_Date: d(2026, 11, 26), Event: 'Mah Jongg', Name: 'Pat', Email: A, Program_Status: 'Waitlisted' }),
  regRow({ Event_ID: 'gone', Event_Date: d(2026, 11, 27), Event: 'Tai Chi', Name: 'Pat', Email: A, Program_Status: 'Active' }),
  regRow({ Event_ID: 'later', Event_Date: d(2026, 12, 1), Event: 'Chair Yoga', Name: 'Pat', Email: A, Program_Status: 'Active' }),
  regRow({ Event_ID: 'thisweek', Event_Date: d(2026, 11, 21), Event: 'Bingo', Name: 'Pat', Email: A, Program_Status: 'Active' }),
  // A couple on one address: one email, both names.
  regRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Event: 'Chair Yoga', Name: 'Lee', Email: 'c@example.org', Program_Status: 'Active' }),
  regRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Event: 'Chair Yoga', Name: 'Sam', Email: 'C@example.org', Program_Status: 'Active' }),
  // Waitlisted only: no email.
  regRow({ Event_ID: 'mahj', Event_Date: d(2026, 11, 26), Event: 'Mah Jongg', Name: 'Kim', Email: 'w@example.org', Program_Status: 'Waitlisted' }),
  // Cancelled registration and no usable address: nothing.
  regRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Event: 'Chair Yoga', Name: 'Jo', Email: 'x@example.org', Program_Status: 'Cancelled' }),
  regRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Event: 'Chair Yoga', Name: 'No Mail', Email: 'not an address', Program_Status: 'Active' })
];

function run(when) {
  sandbox.SENT.length = 0;
  sandbox.resetWeeklyLedgerForTest();
  return sandbox.sendWeeklyRegistrantEmails(sessions, registrants, { now: when });
}

// ---------------------------------------------------------------------------
// Friday 9am: too early. Nothing sent, and nothing recorded as sent.
// ---------------------------------------------------------------------------
let result = run(new Date(2026, 10, 20, 9, 30));
assert.strictEqual(sandbox.SENT.length, 0, 'nothing before 10am Friday');

// Friday 10am: the week of Nov 23.
result = run(new Date(2026, 10, 20, 10, 5));
const toAddress = sandbox.SENT.map(m => m.to).sort();
assert.deepStrictEqual(toAddress, [A, 'c@example.org'], 'one email per address; waitlist-only and cancelled get none');
const pat = sandbox.SENT.filter(m => m.to === A)[0];
assert.strictEqual(pat.subject, 'Your New Horizons programs for the week of Mon, Nov 23');
const body = pat.body;
assert.ok(body.startsWith('Hello Pat,'), 'greets by name');
assert.ok(body.indexOf('next week (Mon, Nov 23 – Sun, Nov 29)') !== -1, 'names the week');
assert.ok(body.indexOf('Chair Yoga, 10:00 AM, Narberth') < body.indexOf('Lunch, 12:00 PM, Narberth'), 'sorted by time within a day');
assert.ok(body.indexOf('Tech Help, 2:15 PM, Ashbridge') !== -1, "an appointment shows the person's own time");
assert.strictEqual(body.indexOf('9:00 AM – 4:00 PM'), -1, '...and not the whole block');
assert.ok(body.indexOf('You are on the waitlist for:\n  • Mah Jongg, Thu, Nov 26, 1:00 PM, Ashbridge') !== -1, 'waitlisted listed apart');
assert.strictEqual(body.indexOf('Tai Chi'), -1, 'a cancelled session is left out');
assert.strictEqual(body.indexOf('Dec 1'), -1, 'the week after is left out');
assert.strictEqual(body.indexOf('Bingo'), -1, "this week's weekend is left out: it was not this pass's to cover");
const couple = sandbox.SENT.filter(m => m.to === 'c@example.org')[0];
assert.ok(couple.body.startsWith('Hello Lee and Sam,'), 'a shared address greets both');
assert.strictEqual(couple.body.split('Chair Yoga').length - 1, 1, '...and lists the session once');
assert.ok(sandbox.SPOOLED.some(line => /2 weekly email\(s\) sent/.test(line)), 'one digest line for the batch, not one per person');

// The next sync: nothing new, nothing sent.
result = run(new Date(2026, 10, 20, 11, 5));
assert.strictEqual(sandbox.SENT.length, 0, 'the hourly sync never sends the same email twice');

// Saturday: Pat signs up for Wednesday, and comes off the Mah Jongg waitlist.
registrants.push(regRow({ Event_ID: 'yoga', Event_Date: d(2026, 11, 24), Event: 'Chair Yoga', Name: 'Pat', Email: 'new@example.org', Program_Status: 'Active' }));
registrants[3][RH.indexOf('Program_Status')] = 'Active';
result = run(new Date(2026, 10, 21, 9, 30));
assert.strictEqual(sandbox.SENT.length, 2, 'one note to Pat, and a first email to the new address');
const added = sandbox.SENT.filter(m => m.to === A)[0];
assert.strictEqual(added.subject, 'Added to your week: Mah Jongg on Thu, Nov 26');
assert.ok(added.body.indexOf('Mah Jongg') !== -1 && added.body.indexOf('Chair Yoga') === -1, 'names only what is new');
const fresh = sandbox.SENT.filter(m => m.to === 'new@example.org')[0];
assert.ok(/^Your New Horizons programs/.test(fresh.subject), 'somebody new to the week gets the full email');

// Saturday 9pm: outside the hours window.
registrants.push(regRow({ Event_ID: 'lunch', Event_Date: d(2026, 11, 24), Event: 'Lunch', Name: 'Pat', Email: 'late@example.org', Program_Status: 'Active' }));
result = run(new Date(2026, 10, 21, 21, 0));
assert.strictEqual(sandbox.SENT.length, 0, 'not after 8pm');

// The per-program reminder ledger is cleared on the first run.
assert.ok(!('REGISTRANT_REMINDERS_V1' in props), 'the retired ledger is not left behind');

// ---------------------------------------------------------------------------
// Nov 2026: a member was sent `=IF(W18="",TEXT(A18,…))` as the time of a lunch
// the kitchen was not serving. The session tab's Event_Time is a FORMULA, so
// the time is rebuilt from the row's own start and end; and a lunch-only row
// on a Not Serving day is left out of the email entirely.
// ---------------------------------------------------------------------------
{
  const LUNCH_ID = 'LUNCHONLY:Narberth|2026-11-25';
  const formula = '=IF(W18="",TEXT(A18,"h:mm AM/PM"),TEXT(A18,"h:mm AM/PM")&" – "&TEXT(W18,"h:mm AM/PM"))';
  const sess = [
    sessionRow({ Event_ID: 'art', Event_Date: new Date(2026, 10, 25, 10, 0), Event_End: new Date(2026, 10, 25, 11, 30),
      Clean_Title: 'Art', Location: 'Narberth', Event_Time: formula }),
    sessionRow({ Event_ID: LUNCH_ID, Event_Date: new Date(2026, 10, 25, 12, 0), Clean_Title: 'Lunch @ Narberth — Roast Turkey',
      Location: 'Narberth', Event_Time: formula, Status: '⛔ Not Serving' })
  ];
  const regs = [
    regRow({ Event_ID: 'art', Event_Date: d(2026, 11, 25), Event: 'Art', Name: 'Pam', Email: 'pam@example.org', Program_Status: 'Active', Event_Time: formula }),
    regRow({ Event_ID: LUNCH_ID, Event_Date: d(2026, 11, 25), Event: 'Lunch', Name: 'Pam', Email: 'pam@example.org', Program_Status: 'Active' })
  ];
  const items = sandbox.collectWeeklyEmailItems(sess, regs, ['2026-11-23'], '2026-11-24')['pam@example.org'].weeks['2026-11-23'];
  assert.strictEqual(items.length, 1, 'a Not Serving lunch is not listed');
  assert.strictEqual(items[0].title, 'Art');
  assert.strictEqual(items[0].time, '10:00 AM \u2013 11:30 AM', 'the time is rebuilt, never the formula');

  // The menu says Not Serving even though the Status cell has not caught up yet.
  sess[1][SH.indexOf('Status')] = '';
  const realOffered = sandbox.isLunchOfferedOn;
  sandbox.isLunchOfferedOn = () => false;
  const again = sandbox.collectWeeklyEmailItems(sess, regs, ['2026-11-23'], '2026-11-24')['pam@example.org'].weeks['2026-11-23'];
  assert.strictEqual(again.length, 1, 'the menu decides too, not only the Status cell');
  sandbox.isLunchOfferedOn = () => true;
  const served = sandbox.collectWeeklyEmailItems(sess, regs, ['2026-11-23'], '2026-11-24')['pam@example.org'].weeks['2026-11-23'];
  assert.strictEqual(served.length, 2, 'a lunch that is being served is still listed');
  assert.ok(served.every(item => item.time.charAt(0) !== '='), 'no formula on any line');
  sandbox.isLunchOfferedOn = realOffered;
}

console.log('All weekly registrant email tests passed.');
