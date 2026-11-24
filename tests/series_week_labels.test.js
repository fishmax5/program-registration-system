// "[WEEK 3 OF 8]" ON A GROUPED PROGRAM'S CALENDAR TITLES (99zzh).
//
// Pins: the label never changes the clean title (so never a new Event_ID or
// form) and is not logged as a note; a cancellation keeps its number and a
// closure skips one; a twice-weekly course is one number per week; a long gap
// is a new run; Freeze keeps numbers when a date is deleted, Recount does not;
// a date added inside a frozen run is left unnumbered and reported; and the
// apply pass writes, rewrites and takes labels off correctly.
const vm = require('vm');

const src = require('./helpers/source').readSource();
const logs = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.computeSeriesWeekNumbers = computeSeriesWeekNumbers;
this.parseEventTitle = parseEventTitle;
this.titleWithSeriesWeekLabel = titleWithSeriesWeekLabel;
this.stripSeriesWeekLabel = stripSeriesWeekLabel;
this.applySeriesWeekLabels = applySeriesWeekLabels;
this.normalizeSeriesWeekMode = normalizeSeriesWeekMode;
this.buildSeriesWeekNumbersHtml = buildSeriesWeekNumbersHtml;
this.STORE = {};
this.PROGRAMS = {};
this.EVENTS = {};
this.MODE = 'freeze';
this.WRITES = [];
this.NOTES = [];
this.install = function () {
  resetCanonicalEventTitles_();
  loadSessionTableTitleSpellings_ = function () { return {}; };
  log = function (m) { __logs.push(String(m)); };
  readDocumentStoreProperty = function (k) { return k in STORE ? STORE[k] : null; };
  writeDocumentStoreProperty = function (k, v) { STORE[k] = v; };
  collectGroupedSeriesPrograms_ = function () { return JSON.parse(JSON.stringify(PROGRAMS)); };
  computeSyncDateRange = function () { return { start: new Date('2026-01-01'), end: new Date('2027-01-01') }; };
  getCalendarEventsForWindow = function () { return EVENTS; };
  getSeriesWeekNumberingDefault = function () { return MODE; };
  setEventTitleQuietly = function (ev, t) { WRITES.push(t); ev.title = t; };
  spoolOfficeNote = function (s, m) { NOTES.push(m); };
};
`, Object.assign(sandbox, { __logs: logs }), { filename: 'program.gs' });
sandbox.install();

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- the label is invisible to identity ------------------------------------
const plain = sandbox.parseEventTitle('Memoir Writing');
const labelled = sandbox.parseEventTitle('Memoir Writing [Week 3 of 8]');
check('the label does not change the clean title', labelled.cleanTitle, plain.cleanTitle);
check('the label is not a tag', labelled.hasLegacyBrackets, false);
check('the label is not logged as a note', logs.filter(l => /Week 3 of 8/.test(l)).length, 0);
check('relabelling replaces, never stacks',
  sandbox.titleWithSeriesWeekLabel('Memoir Writing [Week 2 of 8]', '[Week 3 of 8]'), 'Memoir Writing [Week 3 of 8]');
check('a cancelled title keeps its words',
  sandbox.titleWithSeriesWeekLabel('CANCELLED: Memoir Writing', '[Week 4 of 8]'), 'CANCELLED: Memoir Writing [Week 4 of 8]');
check('other brackets are left alone', sandbox.stripSeriesWeekLabel('Yoga [Cap: 12] [Week 1 of 6]'), 'Yoga [Cap: 12]');
check('modes read in any spelling', ['Freeze', 'recount', 'Dynamic', 'OFF', 'x'].map(sandbox.normalizeSeriesWeekMode),
  ['freeze', 'recount', 'recount', 'off', '']);

// --- the numbering --------------------------------------------------------
const wk = r => Object.keys(r.byWeek).sort().map(w => `${r.byWeek[w].week}/${r.byWeek[w].total}`);
// Tuesdays Sep 1 – Oct 20 2026, eight weeks.
const eight = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20'];
const first = sandbox.computeSeriesWeekNumbers(eight, {}, 'freeze');
check('eight weeks are 1..8 of 8', wk(first), ['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8']);

// A closure planned in week 4: no event on Sep 22, run extended to Oct 27.
const closure = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
check('a closure skips a week', wk(sandbox.computeSeriesWeekNumbers(closure, {}, 'freeze')),
  ['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8']);

// A cancellation is still an event (renamed CANCELLED), so the dates are the same eight.
check('a cancellation keeps the numbers', wk(sandbox.computeSeriesWeekNumbers(eight, first.frozen, 'freeze')), wk(first));

// A date deleted to cancel it: freeze keeps every number, recount closes the gap.
const deleted = eight.filter(d => d !== '2026-09-22');
const frozenAfter = sandbox.computeSeriesWeekNumbers(deleted, first.frozen, 'freeze');
check('freeze: a deleted date does not renumber', wk(frozenAfter), ['1/8', '2/8', '3/8', '5/8', '6/8', '7/8', '8/8']);
check('freeze: the deleted week stays in the ledger', frozenAfter.frozen['2026-09-21'], 4);
check('recount: a deleted date closes the gap', wk(sandbox.computeSeriesWeekNumbers(deleted, first.frozen, 'recount')),
  ['1/7', '2/7', '3/7', '4/7', '5/7', '6/7', '7/7']);

// A make-up date at the end grows the run.
const makeup = sandbox.computeSeriesWeekNumbers(eight.concat(['2026-10-27']), first.frozen, 'freeze');
check('a make-up date at the end is the next number', wk(makeup), ['1/9', '2/9', '3/9', '4/9', '5/9', '6/9', '7/9', '8/9', '9/9']);

// A date added inside a frozen run (in a closure week) cannot be numbered.
const closureFrozen = sandbox.computeSeriesWeekNumbers(closure, {}, 'freeze').frozen;
const inserted = sandbox.computeSeriesWeekNumbers(closure.concat(['2026-09-22']), closureFrozen, 'freeze');
check('a date inside a frozen run is unnumbered', inserted.unnumbered, ['2026-09-21']);
check('and the rest keep their numbers', inserted.byWeek['2026-09-28'], { week: 4, total: 8 });

// Twice a week is one number per week.
check('twice weekly is one number per week',
  wk(sandbox.computeSeriesWeekNumbers(['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10'], {}, 'freeze')), ['1/2', '2/2']);
const both = sandbox.computeSeriesWeekNumbers(['2026-09-01', '2026-09-03'], {}, 'freeze');
check('both days of the week share it', Object.keys(both.byWeek).length, 1);

// A long gap starts a second run.
const spring = ['2027-03-02', '2027-03-09'];
check('a second run starts at Week 1', wk(sandbox.computeSeriesWeekNumbers(eight.concat(spring), first.frozen, 'freeze')),
  ['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8', '1/2', '2/2']);

// --- the apply pass ---------------------------------------------------------
const CAL = 'cal-a';
function ev(title, date) {
  return { title, start: new Date(`${date}T15:00:00Z`), isAllDayEvent: () => false,
    getTitle() { return this.title; }, getStartTime() { return this.start; } };
}
const key = `${CAL}|${sandbox.parseEventTitle('Memoir Writing').cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const dates = {};
eight.forEach(d => { dates[d] = true; });
sandbox.PROGRAMS = { [key]: { key, title: 'Memoir Writing', calendarId: CAL, location: 'Narberth', dates } };
const events = eight.map(d => ev(d === '2026-09-22' ? 'CANCELLED DUE TO ILLNESS: Memoir Writing' : 'Memoir Writing', d));
const yoga = ev('Chair Yoga [Week 1 of 6]', '2026-09-01'); // typed by somebody, never ours
sandbox.EVENTS = { [CAL]: events.concat([yoga]) };

let r = sandbox.applySeriesWeekLabels();
check('every date is labelled', events.map(e => e.title.match(/\[Week (\d) of 8\]/) ? 1 : 0).join(''), '11111111');
check('the cancelled date keeps its number and its words', events[3].title, 'CANCELLED DUE TO ILLNESS: Memoir Writing [Week 4 of 8]');
check('a title on a program never labelled is left alone', yoga.title, 'Chair Yoga [Week 1 of 6]');
check('eight writes', r.written, 8);

sandbox.WRITES.length = 0;
r = sandbox.applySeriesWeekLabels();
check('a second pass writes nothing', sandbox.WRITES.length, 0);

// The program stops being grouped: our labels come back off.
sandbox.PROGRAMS = {};
r = sandbox.applySeriesWeekLabels();
check('a program no longer grouped loses our labels', events[0].title, 'Memoir Writing');
check('eight taken off', r.cleared, 8);

// Per-program Off, through the ledger.
sandbox.PROGRAMS = { [key]: { key, title: 'Memoir Writing', calendarId: CAL, location: 'Narberth', dates } };
sandbox.applySeriesWeekLabels();
const ledger = JSON.parse(sandbox.STORE.SERIES_WEEK_LABELS_V1);
ledger.programs[key].mode = 'off';
sandbox.STORE.SERIES_WEEK_LABELS_V1 = JSON.stringify(ledger);
sandbox.applySeriesWeekLabels();
check('a program set to Off is unlabelled', events[0].title, 'Memoir Writing');

// Recount once renumbers one program without changing its mode.
ledger.programs[key].mode = 'freeze';
ledger.programs[key].weeks = { '2026-08-31': 5 };
sandbox.STORE.SERIES_WEEK_LABELS_V1 = JSON.stringify(ledger);
sandbox.applySeriesWeekLabels({ recountKey: key });
check('recount once renumbers from the dates', events[0].title, 'Memoir Writing [Week 1 of 8]');
check('and keeps the mode', JSON.parse(sandbox.STORE.SERIES_WEEK_LABELS_V1).programs[key].mode, 'freeze');

// The dialog never writes a title as markup.
const html = sandbox.buildSeriesWeekNumbersHtml([{ key: 'k', title: '</script><b>x', location: 'N', override: '', upcoming: [] }], 'freeze');
check('a title cannot end the dialog script', html.indexOf('</script><b>') === -1, true);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
