// The assertions themselves — what the review says is wrong, and (just as
// important) what it stays quiet about. Every check reads only the facts
// gathered for it, so each one can be driven directly with a fact sheet.
//
// The two that matter most, because nothing else in the workbook reports them:
//   • the sheet and the calendar disagreeing about what a program IS — the
//     calendar wins on the next sync, so the sheet's answer is thrown away;
//   • a day of appointments typed as several events, which collide onto one
//     session row because an Event_ID carries no time.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '2026-08-25 10:00', sleep: () => {}, computeDigest: () => [1],
    DigestAlgorithm: { MD5: 'MD5' } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.assertProgramKind = assertProgramKind;
this.assertSessionsAgree = assertSessionsAgree;
this.assertFormsMatchKind = assertFormsMatchKind;
this.assertLinksMatchKind = assertLinksMatchKind;
this.assertAppointmentSettings = assertAppointmentSettings;
this.assertSharedConsistently = assertSharedConsistently;
this.assertCalendarAndSheetLineUp = assertCalendarAndSheetLineUp;
this.assertCapacityIsSane = assertCapacityIsSane;
this.resolveProgramFormType = resolveProgramFormType;
this.REVIEW_LEVELS = REVIEW_LEVELS;
this.EVENT_TYPES = EVENT_TYPES;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}
const L = sandbox.REVIEW_LEVELS;
const T = sandbox.EVENT_TYPES;

// A fact sheet in the shape gatherProgramFacts() produces, defaulting to a
// program with nothing wrong with it.
function facts(over) {
  const sheetState = Object.assign(
    { typeTag: T.REGULAR, isClub: false, noRegistration: false, isAssistance: false },
    (over || {}).sheetState || {});
  const calendarState = Object.assign({}, sheetState, (over || {}).calendarState || {});
  const map = { Form_ID: 0, Max_Capacity: 1, Active_Count: 2, Remaining_Seats: 3, Event_Date: 4 };
  const base = {
    title: 'Chair Yoga',
    locations: ['Narberth'],
    map,
    rows: [['F1', 0, 2, 0, new Date(2026, 2, 2)], ['F1', 0, 2, 0, new Date(2026, 2, 9)]],
    upcomingRows: [['F1', 0, 2, 0, new Date(2026, 2, 2)], ['F1', 0, 2, 0, new Date(2026, 2, 9)]],
    sessionCount: 2,
    upcomingCount: 2,
    eventCount: 2,
    monthsCovered: ['March 2026'],
    formIds: ['F1'],
    linkedEvents: 2,
    upcomingEvents: 2,
    registered: 4,
    waitlisted: 0,
    capacity: 0,
    slotMinutes: 0,
    timeBlockDays: 0,
    isShared: false,
    calendarUnreadable: false,
    rowsWithoutEvents: [],
    eventsWithoutRows: [],
    calendarParts: [{ calendarId: 'cal1', location: 'Narberth', eventCount: 2, taggedShared: 0,
      taggedClub: 0, taggedNoReg: 0, taggedAssistance: 0, taggedGrouped: 0, taggedRegular: 2 }],
    sheetState, calendarState
  };
  const merged = Object.assign(base, over || {});
  merged.sheetState = sheetState;
  merged.calendarState = calendarState;
  merged.sheetType = sandbox.resolveProgramFormType(sheetState);
  merged.calendarType = sandbox.resolveProgramFormType(calendarState);
  return merged;
}
function run(fn, f) { const out = []; sandbox[fn](f, out); return out; }
const has = (checks, level) => checks.some(c => c.level === level);
const text = checks => checks.map(c => c.text).join(' || ');

// --- the sheet and the calendar agreeing, or not ----------------------------
ok('agreement is a tick', has(run('assertProgramKind', facts()), L.OK));
{
  const checks = run('assertProgramKind', facts({
    sheetState: { isClub: true },
    calendarState: { isClub: false }
  }));
  ok('a disagreement is a problem', has(checks, L.PROBLEM), text(checks));
  ok('and it names both answers',
    /Club/.test(text(checks)) && /Monthly/.test(text(checks)), text(checks));
  ok('and offers the kind picker as the fix', checks.some(c => c.fix === 'kind'));
}
ok('upcoming rows with no calendar event at all is a problem',
  has(run('assertProgramKind',
    facts({ eventCount: 0, calendarParts: [], upcomingCount: 2 })), L.PROBLEM));
// A FINISHED PROGRAM IS NOT A BROKEN ONE. The dashboard keeps every session a
// program ever had; the calendar is read from the 1st of this month forward.
// Last season's course therefore has rows and no events, and calling that a
// problem would put every finished program in the building at the top of the
// list, permanently, ahead of the ones that are actually wrong.
{
  const checks = run('assertProgramKind',
    facts({ eventCount: 0, calendarParts: [], upcomingCount: 0 }));
  ok('a finished program is not a problem', !has(checks, L.PROBLEM), text(checks));
  ok('it is just noted as finished', /Finished/.test(text(checks)), text(checks));
}
ok('events with no rows at all is a warning',
  has(run('assertProgramKind', facts({ sessionCount: 0, rows: [] })), L.WARN));
ok('an unreadable calendar is reported as unreadable, not as a missing program',
  /could not be read/.test(text(run('assertProgramKind',
    facts({ calendarUnreadable: true, eventCount: 0, calendarParts: [] })))));

// --- half-tagged programs -------------------------------------------------
ok('events that all say the same thing are a tick',
  has(run('assertSessionsAgree', facts()), L.OK));
{
  const checks = run('assertSessionsAgree', facts({
    eventCount: 4,
    calendarParts: [{ calendarId: 'cal1', location: 'Narberth', eventCount: 4, taggedShared: 0,
      taggedClub: 1, taggedNoReg: 0, taggedAssistance: 0, taggedGrouped: 0, taggedRegular: 4 }]
  }));
  ok('one club-tagged event out of four is a warning', has(checks, L.WARN), text(checks));
  ok('and it says one of four', /1 of its 4 events/.test(text(checks)), text(checks));
}

// --- how many forms its kind implies ----------------------------------------
ok('one form for one month is a tick', has(run('assertFormsMatchKind', facts()), L.OK));
{
  const checks = run('assertFormsMatchKind', facts({ formIds: ['F1', 'F2', 'F3'] }));
  ok('three forms over one month is a warning', has(checks, L.WARN), text(checks));
  ok('and it says what a re-split leaves behind', /re-split/.test(text(checks)));
}
ok('a series on one form is a tick',
  has(run('assertFormsMatchKind', facts({ sheetState: { typeTag: T.GROUPED },
    monthsCovered: ['March 2026', 'April 2026'] })), L.OK));
ok('an upcoming session row with no form at all is a problem',
  has(run('assertFormsMatchKind', facts({
    upcomingRows: [['F1', 0, 2, 0, new Date()], ['', 0, 0, 0, new Date()]] })), L.PROBLEM));
// HISTORY IS NOT ACTIONABLE. Nobody can re-split last April, and comparing ten
// months of rows against ten forms says nothing while burying the one month
// that is actually wrong.
ok('a program whose dates have all happened is asked nothing about forms',
  run('assertFormsMatchKind', facts({ upcomingRows: [], monthsCovered: [] })).length === 0);
ok('and a form missing from a PAST row is not reported',
  !has(run('assertFormsMatchKind', facts({
    rows: [['', 0, 0, 0, new Date(2020, 0, 1)]],
    upcomingRows: [['F1', 0, 2, 0, new Date()]] })), L.PROBLEM));
ok('a drop-in with no form is a tick',
  has(run('assertFormsMatchKind', facts({ sheetState: { noRegistration: true }, formIds: [] })), L.OK));
ok('a drop-in still pointing at a form is a warning',
  has(run('assertFormsMatchKind', facts({ sheetState: { noRegistration: true } })), L.WARN));

// --- the register link people actually use ----------------------------------
ok('every event linked is a tick', has(run('assertLinksMatchKind', facts()), L.OK));
ok('no event linked at all is a problem',
  has(run('assertLinksMatchKind', facts({ linkedEvents: 0 })), L.PROBLEM));
ok('some events linked is a warning',
  has(run('assertLinksMatchKind', facts({ linkedEvents: 1 })), L.WARN));
// PAST EVENTS ARE NOT COUNTED ON EITHER SIDE. The sync window starts at the 1st
// of the current month, so it always holds days that have already happened, and
// a link is written for dates people can still sign up for. Counting a
// fortnight of finished sessions as unlinked would report every program in
// the building as broken by the 20th.
ok('a program whose events have all happened is asked nothing',
  run('assertLinksMatchKind', facts({ eventCount: 8, upcomingEvents: 0, linkedEvents: 0 })).length === 0);
ok('and only the upcoming ones have to carry a link',
  has(run('assertLinksMatchKind',
    facts({ eventCount: 8, upcomingEvents: 2, linkedEvents: 2 })), L.OK));
ok('a drop-in with no links is a tick',
  has(run('assertLinksMatchKind',
    facts({ sheetState: { noRegistration: true }, linkedEvents: 0 })), L.OK));
ok('a drop-in still advertising a link is a warning',
  has(run('assertLinksMatchKind', facts({ sheetState: { noRegistration: true } })), L.WARN));

// --- a day typed as several events ------------------------------------------
{
  const checks = run('assertAppointmentSettings', facts({ timeBlockDays: 6 }));
  ok('extra events on one day is a problem', has(checks, L.PROBLEM), text(checks));
  ok('and merging is offered as the fix', checks.some(c => c.fix === 'merge'));
}
ok('an appointment program with a slot length is a tick',
  has(run('assertAppointmentSettings',
    facts({ sheetState: { isAssistance: true }, slotMinutes: 20 })), L.OK));
ok('an appointment program without one is told the default',
  /minutes is being used/.test(text(run('assertAppointmentSettings',
    facts({ sheetState: { isAssistance: true }, slotMinutes: 0 })))));
ok('an ordinary program is asked nothing about slots',
  run('assertAppointmentSettings', facts()).length === 0);

// --- shared across locations, or not ----------------------------------------
ok('a program nobody shared is asked nothing',
  run('assertSharedConsistently', facts()).length === 0);
ok('shared everywhere is a tick',
  has(run('assertSharedConsistently', facts({
    calendarParts: [{ eventCount: 2, taggedShared: 2 }] })), L.OK));
ok('shared on half its events is a problem',
  has(run('assertSharedConsistently', facts({
    eventCount: 4, calendarParts: [{ eventCount: 4, taggedShared: 2 }] })), L.PROBLEM));

// --- the rows and the events being the same days ----------------------------
ok('the same days is a tick', has(run('assertCalendarAndSheetLineUp', facts()), L.OK));
ok('a row with no event behind it is a problem',
  has(run('assertCalendarAndSheetLineUp', facts({ rowsWithoutEvents: ['Mon, Mar 2'] })), L.PROBLEM));
ok('an event with no row is a warning',
  has(run('assertCalendarAndSheetLineUp', facts({ eventsWithoutRows: ['2026-03-16 (Narberth)'] })), L.WARN));

// --- capacity arithmetic nobody adds up -------------------------------------
ok('no cap and nobody registered says nothing',
  run('assertCapacityIsSane', facts({ registered: 0 })).length === 0);
ok('no cap with people registered is worth a note',
  has(run('assertCapacityIsSane', facts()), L.INFO));
ok('more registered than the cap allows is a warning',
  has(run('assertCapacityIsSane', facts({
    capacity: 2, upcomingRows: [['F1', 2, 5, 0, new Date()]] })), L.WARN));
ok('a waitlist beside empty seats is a warning',
  has(run('assertCapacityIsSane', facts({
    capacity: 10, waitlisted: 2, upcomingRows: [['F1', 10, 3, 7, new Date()]] })), L.WARN));
ok('a waitlist with every seat taken is not',
  !has(run('assertCapacityIsSane', facts({
    capacity: 10, waitlisted: 2, upcomingRows: [['F1', 10, 10, 0, new Date()]] })), L.WARN));
// A room that overflowed last November is a fact about a room somebody has
// already stood in.
ok('a session that overflowed in the past is not reported',
  !has(run('assertCapacityIsSane', facts({
    capacity: 2, rows: [['F1', 2, 5, 0, new Date(2020, 0, 1)]],
    upcomingRows: [['F1', 2, 1, 1, new Date()]] })), L.WARN));

console.log(failures === 0 ? '\nAll review assertion checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
