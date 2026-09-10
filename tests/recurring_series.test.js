// A COURSE IS NOT TWELVE MONTHS OF A PROGRAM.
//
// "Repeat weekly, ends after 8 occurrences" is a complete statement about what
// a program is, and until now this system read it as eight ordinary dates —
// two forms when the run crossed a month, a roster split down the middle. This
// pins the reading, the ceiling that keeps a standing class out of it, the
// order of precedence that keeps a typed tag winning, and the two things that
// make the answer durable: the stamp, and the adoption of the form already in
// circulation.
const vm = require('vm');

const src = require('./helpers/source').readSource();
const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 10), sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' } },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: k => { delete props[k]; }
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {},
  Calendar: { Events: { get: () => { throw new Error('no stub'); } } }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.countRecurrenceOccurrences = countRecurrenceOccurrences;
this.isDetectedGroupedSeries = isDetectedGroupedSeries;
this.readSeriesRecurrence = readSeriesRecurrence;
this.resolveEventSettings = resolveEventSettings;
this.parseEventTitle = parseEventTitle;
this.stampDetectedSeriesGrouping = stampDetectedSeriesGrouping;
this.groupedProgramNeedsAdoption = groupedProgramNeedsAdoption;
this.chooseFormForGroupedProgram = chooseFormForGroupedProgram;
this.RECURRING_SERIES_COUNT_LIMIT = RECURRING_SERIES_COUNT_LIMIT;
this.DEFAULT_GROUP_SERIES_UP_TO = DEFAULT_GROUP_SERIES_UP_TO;
this.setStubs = function (max) {
  getGroupSeriesUpTo = function () { return max; };
  noteForAdmin = function () {};
  invalidateCalendarEventsCache = function () {};
  invalidateSeriesRecurrenceMemo();
};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const LIMIT = sandbox.RECURRING_SERIES_COUNT_LIMIT;
const count = (rrule, start) =>
  sandbox.countRecurrenceOccurrences(rrule, start ? new Date(start) : null, LIMIT);

// --- reading the rule -------------------------------------------------------
check('ends after 8 occurrences is a run of 8',
  count(['RRULE:FREQ=WEEKLY;COUNT=8'], '2026-09-01T10:00:00'), 8);
check('a rule with no end is not a run at all',
  count(['RRULE:FREQ=WEEKLY'], '2026-09-01T10:00:00'), null);
check('nothing to read is nothing to say', count([], '2026-09-01T10:00:00'), null);
check('an end DATE is counted, not guessed at — six Tuesdays to Oct 6',
  count(['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261007T035959Z'], '2026-09-01T10:00:00'), 6);
// The same rule one day earlier: the UNTIL is a UTC instant, so a run that ends
// on the 6th and one that ends on the 5th differ by exactly one Tuesday.
check('and the bound is an instant, not a date somebody rounded',
  count(['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261006T035959Z'], '2026-09-01T10:00:00'), 5);
check('two days a week counts both of them',
  count(['RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260930T035959Z'], '2026-09-01T10:00:00'), 9);
check('every OTHER week counts half as many',
  count(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20261028T035959Z'], '2026-09-01T10:00:00'), 5);
check('a weekly rule with no BYDAY steps from the start date',
  count(['RRULE:FREQ=WEEKLY;UNTIL=20260929T035959Z'], '2026-09-01T10:00:00'), 4);
check('monthly is stepped by months',
  count(['RRULE:FREQ=MONTHLY;UNTIL=20270109T000000Z'], '2026-09-08T10:00:00'), 5);
check('daily too', count(['RRULE:FREQ=DAILY;UNTIL=20260905T035959Z'], '2026-09-01T10:00:00'), 4);
check('a run past the walk limit answers "longer than that"',
  count(['RRULE:FREQ=DAILY;UNTIL=21000101T000000Z'], '2026-09-01T10:00:00'), LIMIT + 1);
check('COUNT past the limit is capped the same way',
  count(['RRULE:FREQ=DAILY;COUNT=5000'], '2026-09-01T10:00:00'), LIMIT + 1);
check('a rule this file cannot understand is left alone (two RRULEs)',
  count(['RRULE:FREQ=WEEKLY;COUNT=8', 'RRULE:FREQ=DAILY;COUNT=2'], '2026-09-01T10:00:00'), null);
check('and one with dates of its own (RDATE)',
  count(['RRULE:FREQ=WEEKLY;COUNT=8', 'RDATE;VALUE=DATE:20261225'], '2026-09-01T10:00:00'), null);
check('a cancelled occurrence is IGNORED — it can only make a run shorter',
  count(['RRULE:FREQ=WEEKLY;COUNT=8', 'EXDATE;TZID=America/New_York:20260915T100000'],
    '2026-09-01T10:00:00'), 8);
check('an UNTIL with no start to walk from is unanswerable',
  count(['RRULE:FREQ=WEEKLY;UNTIL=20261006T035959Z'], null), null);

// --- what counts as a series ------------------------------------------------
let seriesLookups = 0;
function seriesEvent(recurrence, opts) {
  const o = opts || {};
  const state = { description: o.description || '', writes: 0 };
  sandbox.Calendar.Events.get = (calId, id) => {
    if (id !== 'series-1') throw new Error('not found');
    return { start: { dateTime: '2026-09-01T10:00:00-04:00' }, recurrence };
  };
  return {
    state,
    getTitle: () => o.title || 'Memoir Writing',
    isAllDayEvent: () => false,
    isRecurringEvent: () => o.recurring !== false,
    // What Calendar gives an occurrence: the series' id with the occurrence
    // stamped on the end. Reading the series off it is what keeps this from
    // costing a remote call per event.
    getId: () => (o.bareId ? 'series-1@google.com' : 'series-1_20260901T140000Z@google.com'),
    getEventSeries: () => { seriesLookups++; return { getId: () => 'series-1@google.com' }; },
    getOriginalCalendarId: () => 'cal-a',
    getDescription: () => state.description,
    setDescription: d => { state.description = d; state.writes++; }
  };
}

function detects(recurrence, max, opts) {
  sandbox.setStubs(max === undefined ? sandbox.DEFAULT_GROUP_SERIES_UP_TO : max);
  return sandbox.isDetectedGroupedSeries(seriesEvent(recurrence, opts));
}

check('eight weeks is a series', detects(['RRULE:FREQ=WEEKLY;COUNT=8']), true);
check('twelve is still a series', detects(['RRULE:FREQ=WEEKLY;COUNT=12']), true);
check('a year of Tuesdays is a standing class, not a series',
  detects(['RRULE:FREQ=WEEKLY;COUNT=52']), false);
check('a program that never ends is never a series',
  detects(['RRULE:FREQ=WEEKLY']), false);
check('one occurrence is a one-off with the repeat box open',
  detects(['RRULE:FREQ=WEEKLY;COUNT=1']), false);
check('two that straddle a month are the smallest real case',
  detects(['RRULE:FREQ=WEEKLY;COUNT=2']), true);
check('the ceiling is a Config cell, and it is obeyed',
  detects(['RRULE:FREQ=WEEKLY;COUNT=8'], 6), false);
check('nought turns the whole thing off',
  detects(['RRULE:FREQ=WEEKLY;COUNT=8'], 0), false);
check('an event that does not repeat is not asked about',
  detects(['RRULE:FREQ=WEEKLY;COUNT=8'], 12, { recurring: false }), false);
{
  sandbox.setStubs(12);
  const ev = seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=8']);
  sandbox.Calendar.Events.get = () => { throw new Error('calendar unreadable'); };
  check('a rule that cannot be read leaves the program exactly as it was',
    sandbox.isDetectedGroupedSeries(ev), false);
}
{
  sandbox.setStubs(12);
  let calls = 0;
  const ev = seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=8']);
  const inner = sandbox.Calendar.Events.get;
  sandbox.Calendar.Events.get = (c, i) => { calls++; return inner(c, i); };
  sandbox.isDetectedGroupedSeries(ev);
  sandbox.isDetectedGroupedSeries(ev);
  sandbox.isDetectedGroupedSeries(seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=8']));
  check('one remote call per series per run, not one per event', calls, 1);
  check('and the series is read off the instance id, not fetched', seriesLookups, 0);
}
{
  // An id with no occurrence stamp on it is not one to guess at.
  sandbox.setStubs(12);
  seriesLookups = 0;
  check('an unrecognized id falls back to asking Calendar for the series',
    sandbox.isDetectedGroupedSeries(seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=8'], { bareId: true })), true);
  check('which is the only time that call is made', seriesLookups, 1);
}

{
  // AN IMPORTED SERIES. An .ics import keeps the originating system's UID, so
  // Events.get() on it is a 404 where the whole of the rest of this file
  // assumes the UID and the API's event id are the same string. The 404 is
  // answered by listing the calendar by iCalUID, which hands back the master.
  sandbox.setStubs(12);
  let listed = null;
  sandbox.Calendar.Events.get = () => { const e = new Error('Not Found'); throw e; };
  sandbox.Calendar.Events.list = (calId, opts) => {
    listed = opts;
    return { items: [{ start: { dateTime: '2026-09-01T10:00:00-04:00' },
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=8'] }] };
  };
  const uid = 'Icalb3401b2a7dca972b08ee5bc0ada56c3b';
  const ev = {
    getTitle: () => 'Memoir Writing',
    isAllDayEvent: () => false,
    isRecurringEvent: () => true,
    getId: () => uid,
    getEventSeries: () => ({ getId: () => uid }),
    getOriginalCalendarId: () => 'cal-a',
    getDescription: () => '',
    setDescription: () => {}
  };
  check('an imported series is read by its iCalUID rather than given up on',
    sandbox.isDetectedGroupedSeries(ev), true);
  check('and it is asked for the master, not the occurrences',
    listed && listed.iCalUID === uid && listed.singleEvents === false, true);
}

// --- precedence: a typed tag always wins ------------------------------------
function resolved(description, recurrence) {
  sandbox.setStubs(12);
  const ev = seriesEvent(recurrence, { description });
  return sandbox.resolveEventSettings(ev, sandbox.parseEventTitle(ev.getTitle())).isFixed;
}
check('a silent description lets the recurrence answer',
  resolved('Bring a notebook.', ['RRULE:FREQ=WEEKLY;COUNT=8']), true);
check('[Regular] typed by hand beats the recurrence',
  resolved('[Regular]\nBring a notebook.', ['RRULE:FREQ=WEEKLY;COUNT=8']), false);
check('[Grouped] typed by hand still groups a program with no recurrence at all',
  resolved('[Grouped]', ['RRULE:FREQ=WEEKLY']), true);
check('and a standing class stays Regular with nothing typed anywhere',
  resolved('', ['RRULE:FREQ=WEEKLY;COUNT=52']), false);

// --- writing it down --------------------------------------------------------
function group(ev) {
  return { isFixed: true, cleanTitle: 'Memoir Writing', locations: ['Narberth'],
    sessions: [{ event: ev, calendarId: 'cal-a' }] };
}
{
  delete props.AUTO_GROUPED_SERIES_V1;
  sandbox.setStubs(12);
  const ev = seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=8'], { description: 'Bring a notebook.' });
  check('a recognized series has the tag written into its description',
    sandbox.stampDetectedSeriesGrouping([group(ev)]), 1);
  check('and the description now says so', /\[Grouped\]/.test(ev.state.description), true);
  check('without losing what was already there',
    /Bring a notebook\./.test(ev.state.description), true);

  ev.state.description = 'Bring a notebook.'; // somebody deletes the bracket
  check('deleting the bracket is an answer too — it is not written back',
    sandbox.stampDetectedSeriesGrouping([group(ev)]), 0);
  check('and the description is left as they left it', ev.state.description, 'Bring a notebook.');
}
{
  delete props.AUTO_GROUPED_SERIES_V1;
  sandbox.setStubs(12);
  const ev = seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=8'], { description: '[Regular]' });
  check('a description that already states grouping is never touched',
    sandbox.stampDetectedSeriesGrouping([group(ev)]), 0);
  check('not even to agree with it', ev.state.writes, 0);
}
{
  delete props.AUTO_GROUPED_SERIES_V1;
  sandbox.setStubs(12);
  const ev = seriesEvent(['RRULE:FREQ=WEEKLY;COUNT=52'], { description: '' });
  check('a standing class is not stamped', sandbox.stampDetectedSeriesGrouping([group(ev)]), 0);
}

// --- the form already in circulation ----------------------------------------
const day = n => new Date(2026, 8, n);
function state(rows) {
  return { groupFormMap: {}, programFormCandidates: { 'cal-a|Memoir Writing': rows } };
}
const seriesGroup = { isFixed: true, cleanTitle: 'Memoir Writing', groupKey: 'cal-a::Memoir Writing::FIXED',
  scope: 'cal-a', calendarId: 'cal-a', calendarIds: ['cal-a'] };

{
  // "today" for these is the real one; the dates are chosen either side of it.
  const past = new Date(); past.setDate(past.getDate() - 7);
  const soon = new Date(); soon.setDate(soon.getDate() + 7);
  const later = new Date(); later.setDate(later.getDate() + 40);
  check('the form the NEXT date is on is the one that survives',
    sandbox.chooseFormForGroupedProgram(state([
      { formId: 'form-oct', date: later, grouped: false },
      { formId: 'form-sep', date: soon, grouped: false }
    ]), seriesGroup), 'form-sep');
  check('a program with nothing upcoming falls back to the last one anybody used',
    sandbox.chooseFormForGroupedProgram(state([
      { formId: 'form-aug', date: past, grouped: false }
    ]), seriesGroup), 'form-aug');
  check('a program spread across two forms has months to bring together',
    sandbox.groupedProgramNeedsAdoption(state([
      { formId: 'form-sep', date: soon, grouped: false },
      { formId: 'form-oct', date: later, grouped: false }
    ]), seriesGroup), true);
  check('a program already on one form has nothing to do',
    sandbox.groupedProgramNeedsAdoption(state([
      { formId: 'form-sep', date: soon, grouped: false },
      { formId: 'form-sep', date: later, grouped: false }
    ]), seriesGroup), false);
  check('a date somebody deliberately moved off a settled series is left where they put it',
    sandbox.groupedProgramNeedsAdoption(state([
      { formId: 'form-sep', date: soon, grouped: true },
      { formId: 'form-other', date: later, grouped: true }
    ]), seriesGroup), false);
  check('and a Regular program is never asked',
    sandbox.groupedProgramNeedsAdoption(state([
      { formId: 'form-sep', date: soon, grouped: false },
      { formId: 'form-oct', date: later, grouped: false }
    ]), Object.assign({}, seriesGroup, { isFixed: false })), false);
}

console.log(failures === 0 ? '\nAll recurring-series checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
