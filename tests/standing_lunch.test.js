// Two halves of the same complaint from the front desk: "registering a person
// for lunch every single day doesn't seem to be working."
//
// HALF ONE — THE FORM. A lunch-only form asks its mode question in its own
// words ("I want lunch on every date listed on this form."), because a meal is
// not something you attend. isAllDatesModeAnswer() was never taught that
// spelling, and the specific-dates path is not chosen by name — it is simply
// whatever the two recognizers do not claim. So the one-page option fell
// through to a roster grid the respondent had correctly been branched PAST,
// found nothing, and returned no rows: no roster name, no dashboard meal, no
// warning anywhere. What is pinned here is the invariant that failed, not the
// string that failed it — EVERY label buildAttendanceModeChoiceSet() can hand
// a form has to be one a recognizer claims, so the next spelling added cannot
// re-open this quietly.
//
// HALF TWO — QUICK MARK. "…and every future session of it" put somebody on
// Club_Members with no Lunch value, so applyClubRosterCatchup() booked every
// future session as "No Lunch": the program carried forward and the meal did
// not. The desk can now say which of the two it means, and the answer lands in
// the column the catch-up already reads.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: n => ({ __name: n }),
      getSpreadsheetTimeZone: () => 'America/New_York'
    }),
    flush: () => {}
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK' }, PageNavigationType: { SUBMIT: 'SUBMIT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);

// The roster tab, in memory. readClubMemberRows() and renderClubMembersSheet()
// are the only two doors upsertClubMembers() uses to reach it, so replacing
// both is enough to exercise the real function against a real array.
let ROSTER = [];
vm.runInContext(src + `
;this.isAllDatesModeAnswer = isAllDatesModeAnswer;
this.isClubModeAnswer = isClubModeAnswer;
this.buildAttendanceModeChoiceSet = buildAttendanceModeChoiceSet;
this.ATTENDANCE_MODE_CHOICES = ATTENDANCE_MODE_CHOICES;
this.LEGACY_ATTENDANCE_MODE_CHOICES = LEGACY_ATTENDANCE_MODE_CHOICES;
this.upsertClubMembers = upsertClubMembers;
this.addStandingListMember = addStandingListMember;
this.applyClubRosterCatchup = applyClubRosterCatchup;
this.CLUB_LUNCH_OPTIONS = CLUB_LUNCH_OPTIONS;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.log = function () {};
this.noteForAdmin = function () {};
this.getOrCreateSheet = function () { return { __name: 'Club_Members' }; };
`, sandbox, { filename: 'program.gs' });

sandbox.readClubMemberRows = () => ROSTER.map(r => r.slice());
sandbox.renderClubMembersSheet = rows => { ROSTER = rows.map(r => r.slice()); };

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const C = sandbox.ATTENDANCE_MODE_CHOICES;
const map = sandbox.getIndexMap(sandbox.HEADERS.Club_Members);

// ---------------------------------------------------------------------------
// 1. The lunch-only form's every-date answer is an every-date answer
// ---------------------------------------------------------------------------

check('all-dates: monthly wording', sandbox.isAllDatesModeAnswer(C.ALL_DATES), true);
check('all-dates: series wording', sandbox.isAllDatesModeAnswer(C.ALL_DATES_SERIES), true);
check('all-dates: LUNCH wording — the bug',
  sandbox.isAllDatesModeAnswer(C.ALL_DATES_LUNCH), true);
check('all-dates: pre-v4 wording still read',
  sandbox.isAllDatesModeAnswer(sandbox.LEGACY_ATTENDANCE_MODE_CHOICES.ALL_DATES), true);

// The other half of the fork must stay OUT, or the grid path becomes
// unreachable and "let me pick which days" books the whole month.
check('pick-days: monthly wording is not all-dates',
  sandbox.isAllDatesModeAnswer(C.INDIVIDUAL), false);
check('pick-days: series wording is not all-dates',
  sandbox.isAllDatesModeAnswer(C.INDIVIDUAL_SERIES), false);
check('pick-days: LUNCH wording is not all-dates',
  sandbox.isAllDatesModeAnswer(C.INDIVIDUAL_LUNCH), false);
check('an unanswered mode question is not all-dates',
  sandbox.isAllDatesModeAnswer(''), false);

// THE INVARIANT ITSELF. Every shape of form, every label it can offer: the
// all-dates one is claimed by isAllDatesModeAnswer(), the club one by
// isClubModeAnswer(), and the third is the specific-dates path by elimination.
// A new spelling that nobody teaches the recognizer fails HERE rather than
// silently dropping a month of registrations.
[
  { label: 'monthly form', opts: {} },
  { label: 'grouped series', opts: { isFixed: true } },
  { label: 'club form', opts: { isClub: true, programTitle: 'Book Club' } },
  { label: 'club series', opts: { isFixed: true, isClub: true, programTitle: 'Book Club' } },
  { label: 'lunch-only form', opts: { isLunchOnly: true } },
  { label: 'lunch-only outranks the rest', opts: { isLunchOnly: true, isFixed: true, isClub: true, programTitle: 'Lunch' } }
].forEach(({ label, opts }) => {
  const set = sandbox.buildAttendanceModeChoiceSet(opts);
  check(`${label}: its every-date label routes to the every-date page`,
    sandbox.isAllDatesModeAnswer(set.allDates), true);
  check(`${label}: its pick-days label does not`,
    sandbox.isAllDatesModeAnswer(set.individual) || sandbox.isClubModeAnswer(set.individual), false);
  if (set.club) {
    check(`${label}: its club label is read as a club join`,
      sandbox.isClubModeAnswer(set.club), true);
  }
});

// ---------------------------------------------------------------------------
// 2. A standing place, with or without the lunch beside it
// ---------------------------------------------------------------------------

function roster(name) {
  return ROSTER.filter(r => String(r[map['Name']]) === name)[0] || null;
}
function lunchOf(name) {
  const row = roster(name);
  return row ? String(row[map['Lunch']] || '') : null;
}

ROSTER = [];

// A desk registration with the lunch tick: the standing place AND the meal.
let res = sandbox.upsertClubMembers([{
  clubKey: 'CLUB1', club: 'World Affairs', location: 'Narberth', name: 'Joan Coltune',
  personType: 'Attendee', primaryRegistrant: 'Self',
  lunchType: sandbox.CLUB_LUNCH_OPTIONS[0], lunchTypeFromDesk: true, source: 'Added at the front desk'
}]);
check('a new member is added', res.added, 1);
check('…and carries the standing lunch', lunchOf('Joan Coltune'), 'Yes - Lunch');

// The same tick without the lunch: a place every time, no meal. This is the
// distinction that did not exist — both used to land here.
res = sandbox.upsertClubMembers([{
  clubKey: 'CLUB1', club: 'World Affairs', location: 'Narberth', name: 'Bill Reese',
  personType: 'Attendee', primaryRegistrant: 'Self',
  lunchType: sandbox.CLUB_LUNCH_OPTIONS[1], lunchTypeFromDesk: true, source: 'Added at the front desk'
}]);
check('a place-only member is added', res.added, 1);
check('…and orders no meal', lunchOf('Bill Reese'), 'No Lunch');

// ALREADY ON THE LIST. "She's on it already" was the one case where the new
// tick would have done nothing at all — the desk is a person saying what the
// arrangement is now, so it takes.
res = sandbox.upsertClubMembers([{
  clubKey: 'CLUB1', club: 'World Affairs', location: 'Narberth', name: 'Bill Reese',
  personType: 'Attendee', lunchType: sandbox.CLUB_LUNCH_OPTIONS[0], lunchTypeFromDesk: true,
  source: 'Added at the front desk'
}]);
check('an existing member is not duplicated', res.added, 0);
check('the desk changed their standing lunch', res.lunchChanged, 1);
check('…and the column says so', lunchOf('Bill Reese'), 'Yes - Lunch');

// A FORM ARRIVING AGAIN MUST NOT. The Lunch column is staff-editable, and a
// re-submission of a months-old registration is not a fresh statement of it.
res = sandbox.upsertClubMembers([{
  clubKey: 'CLUB1', club: 'World Affairs', location: 'Narberth', name: 'Bill Reese',
  personType: 'Attendee', lunchType: sandbox.CLUB_LUNCH_OPTIONS[1], source: 'Registration form'
}]);
check('a form re-submission changes nothing', res.lunchChanged, 0);
check('…and leaves the staff value alone', lunchOf('Bill Reese'), 'Yes - Lunch');

// An entirely unspecified entry still defaults to no meal, which is what
// every caller that never mentions lunch has always meant.
sandbox.upsertClubMembers([{
  clubKey: 'CLUB1', club: 'World Affairs', location: 'Narberth', name: 'Ann Doyle',
  personType: 'Attendee', source: 'Registration form'
}]);
check('an entry that says nothing about lunch orders none', lunchOf('Ann Doyle'), 'No Lunch');

// ---------------------------------------------------------------------------
// 3. What the desk ticked is what the catch-up books
// ---------------------------------------------------------------------------
//
// applyClubRosterCatchup() is what turns a roster row into registrations on
// every future session. Only the lunch half is pinned here: buildRegistrantRow
// is stood in for, so this asks one question — does the member's own Lunch
// column reach the booking? — without dragging a whole session table in.

const booked = [];
sandbox.buildRegistrantRow = args => { booked.push({ name: args.name, lunchType: args.lunchType }); return ['row']; };
sandbox.isTruthyCheckbox = v => v === true;
sandbox.formatDateKey = () => '2026-09-01';
sandbox.normalizeNameKey = n => String(n).toLowerCase().trim();

const registryIndex = {
  'f1|Sep 3': { eventId: 'E1', eventDate: new Date(2026, 8, 3), programKey: 'CLUB1', clubKey: 'CLUB1', isAssistance: false },
  'f1|Sep 10': { eventId: 'E2', eventDate: new Date(2026, 8, 10), programKey: 'CLUB1', clubKey: 'CLUB1', isAssistance: false }
};
sandbox.applyClubRosterCatchup(registryIndex, new Set(), new Set(), 3, []);

const joan = booked.filter(b => b.name === 'Joan Coltune');
const ann = booked.filter(b => b.name === 'Ann Doyle');
check('the standing member is booked into both future sessions', joan.length, 2);
check('…with a lunch on each of them',
  joan.map(b => b.lunchType), ['Yes - Lunch', 'Yes - Lunch']);
check('the place-only member is booked into both too', ann.length, 2);
check('…and ordered no meals', ann.map(b => b.lunchType), ['No Lunch', 'No Lunch']);

// ---------------------------------------------------------------------------
// 4. The dialog offers the three states, and defaults the third honestly
// ---------------------------------------------------------------------------
//
// The tri-state lives in the dialog's own script, so it is read out of the
// rendered page rather than restated here — a copy of this logic in a test is
// a test of the copy. Three functions are lifted by name and run against a
// fake DOM; everything else on the page is left alone.

const dialog = (() => {
  const box = {
    console: { log: () => {} },
    Utilities: { formatDate: () => '9:00 AM', getUuid: () => 'x', sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
    Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
    ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
  };
  vm.createContext(box);
  vm.runInContext(src + ';this.buildQuickMarkHtml = buildQuickMarkHtml;', box, { filename: 'program.gs' });
  return box.buildQuickMarkHtml(null);
})();

/** One named function, lifted whole out of the rendered script by brace count. */
function lift(name) {
  const at = dialog.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('no function ' + name + ' in the dialog');
  let depth = 0, i = dialog.indexOf('{', at);
  for (let j = i; j < dialog.length; j++) {
    if (dialog[j] === '{') depth++;
    else if (dialog[j] === '}' && --depth === 0) return dialog.substring(at, j + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

const DOM = {};
function node(shown) { return { checked: false, style: { display: shown ? 'block' : 'none' } }; }
function resetDom() {
  ['register', 'standing', 'standingLunch', 'signup', 'lunch'].forEach(id => { DOM[id] = node(true); });
  ['standingLabel', 'standingLunchLabel', 'servedBox', 'mealsBox'].forEach(id => { DOM[id] = node(false); });
}
resetDom();

const ui = {};
vm.createContext(ui);
vm.runInContext(
  'var DOM = null, appointment = false;' +
  'function el(id) { return DOM[id]; }' +
  'function refreshButton() {}' +
  'function showAppointmentTimes() {}' +
  'function appointmentSession() { return appointment; }' +
  lift('registerChanged') + lift('standingChanged') + lift('showMealBoxes') +
  ';this.registerChanged = registerChanged; this.standingChanged = standingChanged;' +
  'this.showMealBoxes = showMealBoxes;' +
  'this.setDom = function (d) { DOM = d; }; this.setAppointment = function (v) { appointment = v; };',
  ui, { filename: 'quick-mark-dialog' });
ui.setDom(DOM);

const shown = id => DOM[id].style.display !== 'none';

// Registering alone: this session only. Neither rider is on screen yet.
resetDom(); ui.setDom(DOM);
DOM.register.checked = true;
ui.registerChanged();
check('register: the standing tick is offered', shown('standingLabel'), true);
check('register: the lunch rider is not, until there is a standing place',
  shown('standingLunchLabel'), false);

// A standing place with no lunch ticked beside it stays a place-only one.
DOM.standing.checked = true;
ui.standingChanged();
check('standing: the lunch rider appears', shown('standingLunchLabel'), true);
check('standing without a lunch tick defaults to place-only',
  DOM.standingLunch.checked, false);

// The case Caroline described: lunch today AND every future session — the
// whole arrangement, so the rider arrives already ticked.
resetDom(); ui.setDom(DOM);
DOM.register.checked = true; DOM.signup.checked = true;
ui.registerChanged();
DOM.standing.checked = true;
ui.standingChanged();
check('signing up for lunch defaults the standing lunch on',
  DOM.standingLunch.checked, true);

// …and it is a default, not a decision. Unticking it sticks.
DOM.standingLunch.checked = false;
ui.showMealBoxes();
check('a cleared rider is not re-ticked behind the desk', DOM.standingLunch.checked, false);

// Dropping the lunch tick drops the default it produced — never a standing
// meal order nobody asked for.
resetDom(); ui.setDom(DOM);
DOM.register.checked = true; DOM.signup.checked = true;
ui.registerChanged();
DOM.standing.checked = true;
ui.standingChanged();
DOM.signup.checked = false;
ui.showMealBoxes();
check('unticking the lunch clears the standing lunch it defaulted',
  DOM.standingLunch.checked, false);

// Untick the standing place and the rider goes with it — a lunch every time
// means nothing without an every-time to hang it on.
DOM.standing.checked = false;
ui.standingChanged();
check('no standing place, no rider on screen', shown('standingLunchLabel'), false);
check('…and nothing left ticked underneath it', DOM.standingLunch.checked, false);

// AN APPOINTMENT PROGRAM HAS NEITHER. It is booked one chair at a time, so
// "every future one" was never offered — and the lunch rider must not outlive
// the tick it hangs off.
resetDom(); ui.setDom(DOM);
DOM.register.checked = true; DOM.signup.checked = true;
ui.registerChanged();
DOM.standing.checked = true;
ui.standingChanged();
check('a standing lunch is on screen for an ordinary program',
  shown('standingLunchLabel'), true);
ui.setAppointment(true);
ui.registerChanged();
check('appointment: the standing tick is withdrawn', shown('standingLabel'), false);
check('appointment: so is the lunch rider', shown('standingLunchLabel'), false);
check('appointment: and both are cleared',
  [DOM.standing.checked, DOM.standingLunch.checked], [false, false]);
ui.setAppointment(false);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
