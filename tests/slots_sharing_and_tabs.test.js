// FOUR THINGS THAT ALL COME DOWN TO "THE SHEET AND THE FORM HAVE TO AGREE".
//
//   1. AN APPOINTMENT SESSION IS FULL WHEN ITS TIMES ARE GONE, not when its
//      chairs are. A couple seeing the provider together is ONE appointment,
//      and counting them as two closed a session with a free time still on
//      its form.
//   2. THE FORM SAYS WHAT TIME THE SESSION RUNS AT — in the description, where
//      the dates already are, and never as part of a grid row label (that
//      label is the join key every registration is matched back by).
//   3. A PERMISSION FAILURE IS TOLD FROM EVERY OTHER FAILURE, because it is
//      the one whose fix is "open the file up" rather than "look at the log".
//   4. A TAB ORDER SAVED BY HAND SURVIVES THE NEXT LAYOUT REBUILD, and a tab
//      the saved order has never heard of still lands somewhere sensible.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(date, tz, pattern) {
  if (pattern === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-` +
      `${String(date.getDate()).padStart(2, '0')}`;
  }
  if (pattern === 'EEE, MMM d, yyyy') {
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  if (pattern === 'h:mm a') {
    const h = date.getHours();
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  return date.toISOString();
}

const properties = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: fmt,
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => Array.from(Buffer.from(String(payload))),
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in properties ? properties[k] : null),
      setProperty: (k, v) => { properties[k] = v; },
      deleteProperty: k => { delete properties[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.TAB_GROUPS = TAB_GROUPS;
this.SHEET_NAMES = SHEET_NAMES;
`, sandbox, { filename: 'program.gs' });

// Nothing here should reach a spreadsheet: no menu is configured, and no date
// in these tests has a Lunch_Schedule row.
sandbox.getMealInfoIndex = () => ({});
sandbox.getCateringPolicyForLocation = () => 'Always';
sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- 1. an appointment session fills by TIME, not by head -------------------
//
// Three half-hour appointments on one afternoon. One person takes 10:00; a
// couple takes 10:30 — that is two registrant rows against ONE appointment.
const counts = {
  APPT: {
    active: 3, waitlist: 0,
    activeSlots: new Set(['10:00 AM', '10:30 AM']), waitlistSlots: new Set(),
    activeUntimed: 0, waitlistUntimed: 0
  }
};
check('an ordinary session counts the people in the room',
  sandbox.occupancyForSession(counts.APPT, false), { active: 3, waitlist: 0 });
check('an appointment session counts the times that are spoken for',
  sandbox.occupancyForSession(counts.APPT, true), { active: 2, waitlist: 0 });
// WHICH IS THE WHOLE POINT: against a capacity of 3 the first reads full and
// the second still has 11:00 to sell.
check('so the sheet no longer closes a session with a free time on it',
  sandbox.computeStatus(sandbox.occupancyForSession(counts.APPT, true).active, 3), '🟡 Almost Full');
check('...where counting heads called it full',
  sandbox.computeStatus(sandbox.occupancyForSession(counts.APPT, false).active, 3), '🔴 Waitlist Only');

// A booking with no time on it cannot be pooled with anything, so it holds a
// place of its own rather than disappearing from the tally.
check('an appointment row with no time still holds a place',
  sandbox.occupancyForSession({
    active: 1, waitlist: 0, activeSlots: new Set(), waitlistSlots: new Set(),
    activeUntimed: 1, waitlistUntimed: 0
  }, true), { active: 1, waitlist: 0 });
check('a session nobody has booked is empty either way',
  sandbox.occupancyForSession(undefined, true), { active: 0, waitlist: 0 });

// --- 2. the form description says what time the session runs ----------------
const morning = new Date(2026, 8, 14, 10, 0);       // Mon Sep 14 2026, 10:00
const morningEnd = new Date(2026, 8, 14, 11, 30);
const afternoon = new Date(2026, 8, 14, 13, 0);
const afternoonEnd = new Date(2026, 8, 14, 14, 0);
const allDay = new Date(2026, 8, 21, 0, 0);

check('a session says its span', sandbox.sessionTimeRangeForDisplay(
  { date: morning, end: morningEnd }), '10:00 AM – 11:30 AM');
check('a session with no end says when it starts', sandbox.sessionTimeRangeForDisplay(
  { date: morning }), '10:00 AM');
// A DATE WITH NO TIME SAYS NOTHING. "12:00 AM" is not a time somebody typed,
// it is the absence of one — and printing it would be believed.
check('a midnight date says nothing at all', sandbox.sessionTimeRangeForDisplay(
  { date: allDay, end: null }), '');

const oneSession = sandbox.buildDateLabelSets(
  [{ date: morning, end: morningEnd, location: 'Narberth', title: 'Chair Yoga' }], {});
check('the grid row label is untouched — it is the join key',
  oneSession.allDateLabels, ['Mon, Sep 14, 2026']);
check('and the description line carries the time',
  oneSession.allDateLines, ['Mon, Sep 14, 2026, 10:00 AM – 11:30 AM']);

// TWO SITTINGS ON ONE DAY are one grid row (a grid rejects duplicate rows) and
// now say both their times on that row's line — which is the first time the
// form has been able to mention the second sitting at all.
const twoSittings = sandbox.buildDateLabelSets([
  { date: morning, end: morningEnd, location: 'Narberth', title: 'Chair Yoga' },
  { date: afternoon, end: afternoonEnd, location: 'Narberth', title: 'Chair Yoga' }
], {});
check('two sittings are still one row', twoSittings.allDateLabels.length, 1);
check('and the line names both times',
  twoSittings.allDateLines, ['Mon, Sep 14, 2026, 10:00 AM – 11:30 AM and 1:00 PM – 2:00 PM']);

const described = sandbox.buildFormDescription(['Narberth'], oneSession.allDateLabels, false, false,
  { dateLines: oneSession.allDateLines });
check('the description is written from the lines', described.indexOf('10:00 AM – 11:30 AM') !== -1, true);
// A LUNCH-ONLY FORM IS DATED AT NOON BY LUNCH_ONLY_SESSION_HOUR — a
// placeholder, not a serving time — so it must not be printed as one.
const lunchOnly = sandbox.buildFormDescription(['Narberth'], oneSession.allDateLabels, false, true,
  { isLunchOnly: true, dateLines: oneSession.allDateLines });
check('but a lunch-only form never states a serving time',
  lunchOnly.indexOf('10:00 AM'), -1);

// --- 3. a permission failure is told from any other failure ------------------
check('Drive refusing an account is a permission failure',
  sandbox.isPermissionError(new Error('You do not have permission to access the requested document.')), true);
check('so is a protected range',
  sandbox.isPermissionError('Exception: You are trying to edit a protected cell or object.'), true);
check('a busy Forms API is NOT one — it fixes itself',
  sandbox.isPermissionError('Failed to edit the form. Please wait and try again.'), false);
check('and neither is an ordinary bug',
  sandbox.isPermissionError(new TypeError('undefined is not a function')), false);

// --- 4. a saved tab order outlives the next rebuild --------------------------
const builtIn = sandbox.builtInTabOrder();
check('with nothing saved, the built-in order is what applies',
  sandbox.resolveTabOrder(), builtIn);

// Somebody drags the lunch dashboard to the front and saves.
const names = sandbox.SHEET_NAMES;
const preferred = [names.LUNCH_DASHBOARD, names.PROGRAM_DASHBOARD];
sandbox.writeSavedTabOrder(preferred);
const resolved = sandbox.resolveTabOrder();
check('the saved order leads', resolved.slice(0, 2), preferred);
check('every built-in tab is still positioned',
  builtIn.every(name => resolved.indexOf(name) !== -1), true);
check('and nothing is positioned twice',
  resolved.length, new Set(resolved).size);

// A TAB THE SAVED ORDER HAS NEVER HEARD OF — one a later version introduces —
// lands at the end rather than wherever the spreadsheet left it.
sandbox.writeSavedTabOrder(['Config']);
check('an unknown-to-the-save tab is still placed',
  sandbox.resolveTabOrder().indexOf(names.LUNCH_ROSTER) > 0, true);

sandbox.writeSavedTabOrder([]);
check('forgetting the saved order goes back to the built-in one',
  sandbox.resolveTabOrder(), builtIn);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
