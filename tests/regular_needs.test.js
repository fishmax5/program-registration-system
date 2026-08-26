// "Put her meals in the fridge." "No milk." "One meal every World Affairs
// day." "Every Tues, Thurs." Every one of those is a real note off a real
// lunch sheet, every one belongs to a PERSON rather than to a registration,
// and every one was being carried in somebody's head.
//
// A regular need is that fact plus WHEN IT APPLIES, and the when is the only
// part with anywhere to hide a bug — so this file is mostly recurrence:
// weekdays typed the way people actually type them, a fortnight that does not
// split a Tue/Thu pair across two of them, a month end that does not skip
// February, and a program-scoped need that must never leak onto a session it
// was not meant for.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const NOW = new Date(2026, 8, 16, 9, 0, 0); // Wed 16 Sep 2026
const RealDate = Date;

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      return date.toISOString();
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.parseNeedWeekdays = parseNeedWeekdays;
this.parseNeedDates = parseNeedDates;
this.regularNeedAppliesOn = regularNeedAppliesOn;
this.regularNeedsFor = regularNeedsFor;
this.parseRegularNeedRow = parseRegularNeedRow;
this.describeRegularNeed = describeRegularNeed;
this.describeNeedSchedule = describeNeedSchedule;
this.stampRegularNeedsOnRow = stampRegularNeedsOnRow;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'Code.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const D = (y, m, d) => new RealDate(y, m - 1, d);

// ---------------------------------------------------------------------------
// Weekdays, typed the way people type them
// ---------------------------------------------------------------------------
// Every one of these is lifted off the real lunch sheet's Notes column. The
// parser exists because asking somebody to write "Tue, Wed, Thu, Fri" when
// they have always written "Tues -- Fri" is how a tab stops being used.
check('a plain list', sandbox.parseNeedWeekdays('Tue, Thu'), [2, 4]);
check('the long spellings people actually use', sandbox.parseNeedWeekdays('Every Tues, Thurs'), [2, 4]);
check('"Thursdays ONLY"', sandbox.parseNeedWeekdays('Thursdays ONLY'), [4]);
check('slashes', sandbox.parseNeedWeekdays('Mon/Wed/Fri'), [1, 3, 5]);
check('a range spelled with a dash', sandbox.parseNeedWeekdays('Tues -- Fri Every Week'), [2, 3, 4, 5]);
check('a range spelled with a word', sandbox.parseNeedWeekdays('Mon to Wed'), [1, 2, 3]);
check('a range that wraps through the weekend', sandbox.parseNeedWeekdays('Fri - Mon'), [0, 1, 5, 6]);
check('nothing at all is no constraint', sandbox.parseNeedWeekdays(''), []);
check('and prose with no weekday in it is the same', sandbox.parseNeedWeekdays('when she comes'), []);

check('dates are read in whatever format they were typed',
  sandbox.parseNeedDates('9/16/2026, 2026-09-23'), ['2026-09-16', '2026-09-23']);

// ---------------------------------------------------------------------------
// The recurrence itself
// ---------------------------------------------------------------------------
const need = extra => Object.assign({
  need: 'No milk', nameKey: 'jane smith', frequency: 'Every time',
  weekdays: [], dates: [], startsKey: '', endsKey: '', interval: 0, active: true
}, extra);

const WED = D(2026, 9, 16);
const THU = D(2026, 9, 17);
const FRI = D(2026, 9, 18);

check('"every time" is every time', sandbox.regularNeedAppliesOn(need(), WED), true);

// A weekday list narrows EVERY frequency, not only Weekly. "Every time, but
// only on Thursdays" is a thing people write, and reading it as "every time"
// sends a meal out on a Tuesday.
check('a weekday list narrows even "every time"',
  [WED, THU].map(d => sandbox.regularNeedAppliesOn(need({ weekdays: [4] }), d)), [false, true]);

check('weekly on the named days',
  [WED, THU, FRI].map(d => sandbox.regularNeedAppliesOn(need({ frequency: 'Weekly', weekdays: [2, 4] }), d)),
  [false, true, false]);
check('weekly with no day named falls back to the day it started on',
  [WED, THU].map(d => sandbox.regularNeedAppliesOn(
    need({ frequency: 'Weekly', startsKey: '2026-09-10' }), d)), // a Thursday
  [false, true]);

// THE FORTNIGHT TEST. Counted from the start of the WEEK, so every day of an
// "on" week is on — counting in raw days would put the Tuesday of a pair in
// one fortnight and the Thursday in the next.
const fortnightly = need({ frequency: 'Every N weeks', interval: 2, weekdays: [2, 4], startsKey: '2026-09-15' });
check('every other week: both days of the "on" week are on',
  [D(2026, 9, 15), D(2026, 9, 17)].map(d => sandbox.regularNeedAppliesOn(fortnightly, d)), [true, true]);
check('and neither day of the "off" week is',
  [D(2026, 9, 22), D(2026, 9, 24)].map(d => sandbox.regularNeedAppliesOn(fortnightly, d)), [false, false]);
check('and the week after that is on again',
  sandbox.regularNeedAppliesOn(fortnightly, D(2026, 9, 29)), true);
check('an interval of 1 is just weekly',
  sandbox.regularNeedAppliesOn(need({ frequency: 'Every N weeks', interval: 1, weekdays: [4] }), THU), true);

// Monthly anchors on the day of the month it started. The 31st has to mean
// "the end of the month" in the months that have no 31st, or a need set up in
// January quietly stops in February.
const monthly = need({ frequency: 'Monthly', startsKey: '2026-01-31' });
check('monthly keeps its day of the month', sandbox.regularNeedAppliesOn(monthly, D(2026, 3, 31)), true);
check('and lands on the last day of a shorter one',
  sandbox.regularNeedAppliesOn(monthly, D(2026, 2, 28)), true);
check('but not on the day before it', sandbox.regularNeedAppliesOn(monthly, D(2026, 2, 27)), false);

check('specific dates are exactly those dates',
  [D(2026, 9, 16), D(2026, 9, 17)].map(d =>
    sandbox.regularNeedAppliesOn(need({ frequency: 'Specific dates', dates: ['2026-09-16'] }), d)),
  [true, false]);
check('"once" is its start date and nothing else',
  [D(2026, 9, 16), D(2026, 9, 23)].map(d =>
    sandbox.regularNeedAppliesOn(need({ frequency: 'Once', startsKey: '2026-09-16' }), d)),
  [true, false]);

// The window applies under every frequency — "no milk until she finishes the
// antibiotics" should not have to be its own kind of need.
const windowed = need({ startsKey: '2026-09-16', endsKey: '2026-09-18' });
check('a window bounds an otherwise unconditional need',
  [D(2026, 9, 15), WED, FRI, D(2026, 9, 19)].map(d => sandbox.regularNeedAppliesOn(windowed, d)),
  [false, true, true, false]);
check('an inactive need never applies',
  sandbox.regularNeedAppliesOn(need({ active: false }), WED), false);
check('and neither does one asked about a date that is not one',
  sandbox.regularNeedAppliesOn(need(), 'not a date'), false);

// ---------------------------------------------------------------------------
// Matching a need to a person on a session
// ---------------------------------------------------------------------------
const needs = [
  need({ need: 'No milk' }),
  need({ need: 'Put meals in the fridge', location: 'Narberth' }),
  need({ need: 'One meal', program: 'World Affairs', quantity: 1 }),
  need({ need: 'Bagged lunch for everyone', nameKey: '' })
];
const forJane = ctx => sandbox.regularNeedsFor(needs, ctx).map(n => n.need);

check('a bare need follows the person anywhere',
  forJane({ name: 'Jane Smith', location: 'Ashbridge', title: 'Chair Yoga', date: WED }),
  ['No milk', 'Bagged lunch for everyone']);
check('a location-scoped need only at that location',
  forJane({ name: 'Jane Smith', location: 'Narberth', title: 'Chair Yoga', date: WED }),
  ['No milk', 'Put meals in the fridge', 'Bagged lunch for everyone']);
check('a program-scoped need only on that program',
  forJane({ name: 'Jane Smith', location: 'Ashbridge', title: 'World Affairs', date: WED }),
  ['No milk', 'One meal', 'Bagged lunch for everyone']);

// THE LEAK THIS GUARDS. "One meal every World Affairs day" pinned to a
// program must not fire on a session whose program we could not name —
// that is how it becomes a meal every day.
check('and never on a session with no program named',
  forJane({ name: 'Jane Smith', location: 'Ashbridge', title: '', date: WED }),
  ['No milk', 'Bagged lunch for everyone']);
check('somebody else gets only the everyone-need',
  sandbox.regularNeedsFor(needs, { name: 'Bob Vance', location: 'Narberth', title: 'Chair Yoga', date: WED })
    .map(n => n.need),
  ['Bagged lunch for everyone']);
check('and a loosely-typed name is the same person',
  sandbox.regularNeedsFor(needs, { name: 'jane  SMITH ', location: 'Ashbridge', title: 'Chair Yoga', date: WED })
    .map(n => n.need),
  ['No milk', 'Bagged lunch for everyone']);

// ---------------------------------------------------------------------------
// Reading a row, and writing the note
// ---------------------------------------------------------------------------
const map = sandbox.getIndexMap(sandbox.HEADERS.Regular_Needs);
function needRow(values) {
  const row = new Array(sandbox.HEADERS.Regular_Needs.length).fill('');
  Object.keys(values).forEach(h => { row[map[h]] = values[h]; });
  return row;
}

// BLANK MEANS ACTIVE. A row somebody typed and did not tick is a row they
// meant — an opt-in checkbox here would mean every hand-typed need silently
// does nothing, which is the one failure this tab cannot have.
check('a hand-typed row with nothing ticked is live',
  sandbox.parseRegularNeedRow(needRow({ Name: 'Jane Smith', Need: 'No milk' })).active, true);
check('and only a deliberate no turns it off',
  [false, 'No', 'off'].map(v =>
    sandbox.parseRegularNeedRow(needRow({ Name: 'J', Need: 'x', Active: v })).active),
  [false, false, false]);
check('a row with no need text is not a need',
  sandbox.parseRegularNeedRow(needRow({ Name: 'Jane Smith' })), null);
check('but a row with no NAME is — it is the whole session',
  sandbox.parseRegularNeedRow(needRow({ Need: 'Bagged lunch' })).nameKey, '');

check('a quantity shows in the wording',
  sandbox.describeRegularNeed({ need: 'Put meals in the freezer', quantity: 2 }),
  'Put meals in the freezer (×2)');
check('and one of something does not',
  sandbox.describeRegularNeed({ need: 'No milk', quantity: 1 }), 'No milk');

check('the schedule reads back in words',
  sandbox.describeNeedSchedule(sandbox.parseRegularNeedRow(needRow({
    Name: 'Jane Smith', Need: 'One meal', Program: 'World Affairs', Frequency: 'Weekly', Weekdays: 'Tue, Thu'
  }))),
  'weekly on Tue, Thu, every World Affairs');

// The note lands on the row, and — the part that matters over thirty marks in
// a morning — lands there exactly once.
function fakeCell(initial) {
  const state = { value: initial };
  return {
    state,
    getRange: () => ({
      getValue: () => state.value,
      setValue: v => { state.value = v; }
    })
  };
}
const noteMap = { Admin_Notes: 0 };
const applied = [{ need: 'No milk', quantity: 0, autoNote: true }, { need: 'Take-out', quantity: 0, autoNote: true }];

const fresh = fakeCell('Walk-in added at the desk.');
check('the needs are appended to what was already there',
  [sandbox.stampRegularNeedsOnRow(fresh, noteMap, 5, applied), fresh.state.value],
  [' Noted: No milk; Take-out.', 'Walk-in added at the desk. · 🔔 No milk · 🔔 Take-out']);

check('marking the same person again adds nothing',
  [sandbox.stampRegularNeedsOnRow(fresh, noteMap, 5, applied), fresh.state.value],
  ['', 'Walk-in added at the desk. · 🔔 No milk · 🔔 Take-out']);

const optedOut = fakeCell('');
check('a need with Auto_Note off is shown but never written',
  [sandbox.stampRegularNeedsOnRow(optedOut, noteMap, 5, [{ need: 'No milk', autoNote: false }]), optedOut.state.value],
  ['', '']);

console.log(failures === 0 ? '\nAll regular needs checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
