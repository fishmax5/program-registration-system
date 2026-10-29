// ALWAYS-OPEN EVENTS (section 99zv): Jigsaw Puzzles, Community Hour — on no calendar.
//
// Pinned here: the Days_Open reader (blank/garbage = every day), that an inactive
// row and a blank-location row behave, that a title is found however it is
// spelled, the synthetic session's shape and its id, that Quick Mark files the
// undated entries in a group of their own FIRST, and the door's day listing them
// first on the days they are open only.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d, tz, p) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, getUuid: () => 'x', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => (n === 'Standing_Events' ? {} : null), getSpreadsheetTimeZone: () => 'America/New_York' }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York' }, ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.__stub = function (name, fn) { eval(name + ' = fn'); };
this.__reset = function () { __standingEventsMemo = null; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const H = sandbox.HEADERS.Standing_Events;
const row = o => H.map(h => (o[h] === undefined ? '' : o[h]));
let rows = [];
sandbox.__stub('readSimpleTable', () => rows);
sandbox.__stub('checkInLocations', () => ['Narberth', 'Ashbridge']);

// --- Days_Open ---------------------------------------------------------------
const P = sandbox.parseStandingEventDays;
check('blank = every day', P(''), null);
check('"Every day" = every day', P('Every day'), null);
check('Weekdays', P('weekdays'), [1, 2, 3, 4, 5]);
check('Mon-Fri range', P('Mon-Fri'), [1, 2, 3, 4, 5]);
check('list', P('Tue, Thu'), [2, 4]);
check('long names and "and"', P('Tuesday and Thursday'), [2, 4]);
check('wrapping range Fri-Mon', P('Fri-Mon'), [0, 1, 5, 6]);
check('garbage = every day, not nothing', P('whenever'), null);

// --- reading the tab ---------------------------------------------------------
rows = [
  row({ Event: 'Jigsaw Puzzles', Location: 'Narberth', Active: true }),
  row({ Event: 'Community Hour', Location: '', Days_Open: 'Tue, Thu', Time_Note: '1-2pm' }),
  row({ Event: 'Old Thing', Location: 'Narberth', Active: false }),
  row({ Event: '', Location: 'Narberth' }),
  row({ Event: 'Jigsaw Puzzles', Location: 'Narberth' })
];
sandbox.__reset();
const all = sandbox.readStandingEvents();
check('inactive, untitled and duplicate rows dropped; blank location = every building',
  all.map(e => `${e.title}@${e.location}`),
  ['Jigsaw Puzzles@Narberth', 'Community Hour@Narberth', 'Community Hour@Ashbridge']);
check('events at one building', sandbox.standingEventsAt('Ashbridge').map(e => e.title), ['Community Hour']);
check('found however it is spelled', !!sandbox.findStandingEvent('  jigsaw  puzzles', 'Narberth'), true);
check('not at the wrong building', sandbox.findStandingEvent('Jigsaw Puzzles', 'Ashbridge'), null);

// 2026-10-27 is a Tuesday, 2026-10-28 a Wednesday.
const hour = sandbox.findStandingEvent('Community Hour', 'Narberth');
check('open on a Tuesday', sandbox.standingEventOpenOn(hour, '2026-10-27'), true);
check('closed on a Wednesday', sandbox.standingEventOpenOn(hour, '2026-10-28'), false);

// --- the synthetic session ---------------------------------------------------
const s = sandbox.buildStandingEventSession(hour, '2026-10-27', 'Narberth');
check('session identity', [s.title, s.dateKey, s.location, s.isStandingEvent, s.eventTime],
  ['Community Hour', '2026-10-27', 'Narberth', true, '1-2pm']);
check('its id is recognised', sandbox.isStandingEventId(s.eventId), true);
check('a lunch id is not one', sandbox.isStandingEventId('LUNCHONLY:2026-10-27|Narberth'), false);
check('one id per day', s.eventId !== sandbox.buildStandingEventSession(hour, '2026-10-28', 'Narberth').eventId, true);
check('building defaults to the event\'s own', sandbox.buildStandingEventSession(hour, '2026-10-27', '').location, 'Narberth');
check('no event, no session', sandbox.buildStandingEventSession(null, '2026-10-27', 'Narberth'), null);

// --- Quick Mark's list -------------------------------------------------------
const choice = (title, dateKey, standingEvent) => ({
  label: title, title, dateKey, location: 'Narberth', standingEvent: !!standingEvent
});
const ordered = sandbox.orderQuickMarkChoices([
  choice('Chair Yoga', '2999-01-01'),
  choice('Bingo', ''),
  choice('Jigsaw Puzzles', '', true)
]);
check('always-open group comes first, undated entries last',
  ordered.map(c => `${c.group}:${c.title}`),
  ['Open every day (no calendar):Jigsaw Puzzles', 'Upcoming:Chair Yoga', 'Any date (program only):Bingo']);

// --- the door's day ----------------------------------------------------------
sandbox.__stub('getSectionedRowValues', () => []);
sandbox.__stub('readHouseholdIndex', () => ({ byKey: {} }));
sandbox.__stub('householdCompanionsOf', () => []);
sandbox.__stub('readWalkInMembers', () => []);
sandbox.__stub('getMealInfoForDate', () => null);
sandbox.__stub('isLunchOfferedOn', () => false);
sandbox.__stub('lunchIsRuledOutOn', () => false);
sandbox.__stub('lunchOnlyRowTitle', () => 'Lunch');
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: n => (n === 'Standing_Events' ? {} : null), getSpreadsheetTimeZone: () => 'America/New_York'
});
sandbox.__reset();
const tue = sandbox.readWalkInDay('Narberth', '2026-10-27');
check('Tuesday at Narberth lists both, no registration needed',
  tue.programs.map(p => `${p.title}|${p.noRegistration}|${p.time}`),
  ['Community Hour|true|1-2pm', 'Jigsaw Puzzles|true|']);
const wed = sandbox.readWalkInDay('Narberth', '2026-10-28');
check('Wednesday lists only the one that is open daily', wed.programs.map(p => p.title), ['Jigsaw Puzzles']);

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
