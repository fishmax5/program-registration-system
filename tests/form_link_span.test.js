// A Regular program is grouped PER CALENDAR MONTH, and each of those groups
// gets its own form (see buildEventGroups()). So "Chair Yoga on the Narberth
// calendar" names one form in September and a DIFFERENT one in October.
//
// buildFormIdByProgram() used to key its calendarId -> Form_ID map on
// `calendarId|title` with no month in it, so both months wrote to the same key
// and whichever group was processed last won. updateRegistrationLinkCells()
// then restored THAT one form's links onto every row of the program — so the
// sessions a month out were handed the near month's form. A live link, on the
// right row, pointing at the wrong month's form: sign-ups landing quietly on
// the wrong form rather than an error anybody would see.
//
// What is pinned here:
//   • two months of one program produce two distinct keys, not one;
//   • each month's key resolves to that month's own form;
//   • a [Grouped] series still collapses to ONE key ('FIXED') across every
//     month it runs in — it genuinely is one form for the whole run;
//   • the span helpers agree whether the span is read off a group or off a row,
//     which is what makes the write and the read-back line up.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

// Dates are formatted through Utilities.formatDate in the real thing; a
// deterministic stand-in keeps the month labels stable regardless of host zone.
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'MMMM yyyy') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildFormIdByProgram = buildFormIdByProgram;
this.formSpanForGroup = formSpanForGroup;
this.formSpanForRow = formSpanForRow;
this.programFormKey = programFormKey;
this.__setRegistry = function (r) { getPersistentFormRegistry = function () { return r; }; };
this.log = function () {};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const CAL = 'narberth@group.calendar.google.com';
const sep = new Date(2026, 8, 15); // September 2026
const oct = new Date(2026, 9, 13); // October 2026

// --- the span itself ---------------------------------------------------------
{
  check('a Regular group spans its month',
    sandbox.formSpanForGroup({ isFixed: false, monthLabel: 'September 2026' }), 'September 2026');
  check('a Grouped series spans the whole run',
    sandbox.formSpanForGroup({ isFixed: true, monthLabel: null }), 'FIXED');
  check('a row agrees with its group, read off Type_Tag + date',
    sandbox.formSpanForRow('Regular', sep), 'September 2026');
  check('and a Grouped row does too',
    sandbox.formSpanForRow('Grouped', sep), 'FIXED');
  check('an undated row has no span rather than a wrong one',
    sandbox.formSpanForRow('Regular', ''), '');
}

// --- TWO MONTHS OF ONE PROGRAM ARE TWO ENTRIES, NOT ONE ---------------------
// The bug: both months collapsed onto `cal|Chair Yoga` and the last one won.
{
  sandbox.__setRegistry({
    [`${CAL}::Chair Yoga::September 2026`]: 'FORM_SEP',
    [`${CAL}::Chair Yoga::October 2026`]: 'FORM_OCT'
  });
  const groups = [
    { groupKey: `${CAL}::Chair Yoga::September 2026`, cleanTitle: 'Chair Yoga',
      isFixed: false, monthLabel: 'September 2026', sessions: [{ calendarId: CAL }] },
    { groupKey: `${CAL}::Chair Yoga::October 2026`, cleanTitle: 'Chair Yoga',
      isFixed: false, monthLabel: 'October 2026', sessions: [{ calendarId: CAL }] }
  ];
  const map = sandbox.buildFormIdByProgram(groups);

  check('two months of one program are two entries', Object.keys(map).length, 2);

  const sepKey = sandbox.programFormKey(CAL, 'Chair Yoga', sandbox.formSpanForRow('Regular', sep));
  const octKey = sandbox.programFormKey(CAL, 'Chair Yoga', sandbox.formSpanForRow('Regular', oct));
  check('a September row resolves to September\'s form', map[sepKey], 'FORM_SEP');
  check('an October row resolves to October\'s own form', map[octKey], 'FORM_OCT');
  check('and the two rows do not resolve to the same form', map[sepKey] === map[octKey], false);
}

// --- A [Grouped] SERIES IS STILL ONE FORM ACROSS EVERY MONTH ----------------
// The other direction, and the one a naive "just add the month" fix breaks: a
// Grouped run spanning September and October is ONE form, so its rows in both
// months must land on the same key.
{
  sandbox.__setRegistry({ [`${CAL}::Fall Book Club::FIXED`]: 'FORM_FIXED' });
  const map = sandbox.buildFormIdByProgram([
    { groupKey: `${CAL}::Fall Book Club::FIXED`, cleanTitle: 'Fall Book Club',
      isFixed: true, monthLabel: null, sessions: [{ calendarId: CAL }, { calendarId: CAL }] }
  ]);
  check('a Grouped series is one entry however many months it runs',
    Object.keys(map).length, 1);
  const sepRow = sandbox.programFormKey(CAL, 'Fall Book Club', sandbox.formSpanForRow('Grouped', sep));
  const octRow = sandbox.programFormKey(CAL, 'Fall Book Club', sandbox.formSpanForRow('Grouped', oct));
  check('and both of its months reach it', [map[sepRow], map[octRow]], ['FORM_FIXED', 'FORM_FIXED']);
}

// --- ONE TITLE ON TWO CALENDARS STAYS TWO FORMS -----------------------------
// The span must not accidentally merge locations that were always separate.
{
  const OTHER = 'ashbridge@group.calendar.google.com';
  sandbox.__setRegistry({
    [`${CAL}::Bingo::September 2026`]: 'FORM_NARB',
    [`${OTHER}::Bingo::September 2026`]: 'FORM_ASH'
  });
  const map = sandbox.buildFormIdByProgram([
    { groupKey: `${CAL}::Bingo::September 2026`, cleanTitle: 'Bingo',
      isFixed: false, monthLabel: 'September 2026', sessions: [{ calendarId: CAL }] },
    { groupKey: `${OTHER}::Bingo::September 2026`, cleanTitle: 'Bingo',
      isFixed: false, monthLabel: 'September 2026', sessions: [{ calendarId: OTHER }] }
  ]);
  check('the same program at two locations is still two forms',
    [map[sandbox.programFormKey(CAL, 'Bingo', 'September 2026')],
      map[sandbox.programFormKey(OTHER, 'Bingo', 'September 2026')]],
    ['FORM_NARB', 'FORM_ASH']);
}

// --- A GROUP WITH NO FORM YET CONTRIBUTES NOTHING ---------------------------
{
  sandbox.__setRegistry({});
  const map = sandbox.buildFormIdByProgram([
    { groupKey: `${CAL}::New Thing::September 2026`, cleanTitle: 'New Thing',
      isFixed: false, monthLabel: 'September 2026', sessions: [{ calendarId: CAL }] }
  ]);
  check('a program with no form yet adds no entry', Object.keys(map).length, 0);
}

console.log(failures === 0 ? '\nAll form-link span checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
