// The review used to write to the calendar and then sync, once per program, as
// you walked it — so a person with forty programs to go through waited through
// forty full updates to make forty decisions. What is pinned here is the two
// halves of the fix:
//
//   THE PLAN IS HELD IN THE BROWSER. Choosing a kind, staging a merge and
//   marking a program reviewed must not call the server at all. Exactly one
//   call goes out, when Apply is pressed, and it must carry every decision.
//
//   THE FORMS LIST. Which program is on which form, read form-first, and the
//   three overlaps that list exists to surface — one month split across two
//   forms, one form carrying two programs, and a calendar link pointing at a
//   form the sheet does not use.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '2026-08-25 10:00', sleep: () => {}, computeDigest: () => [1],
    DigestAlgorithm: { MD5: 'MD5' }, getUuid: () => 'x' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildProgramReviewHtml = buildProgramReviewHtml;
this.buildFormLinkageReport = buildFormLinkageReport;
this.PROGRAM_FORM_TYPES = PROGRAM_FORM_TYPES;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, `got      ${a}\n  expected ${e}`);
}

// --- WHICH PROGRAM IS ON WHICH FORM -----------------------------------------
function program(over) {
  return Object.assign({
    id: 'cal1::Chair Yoga', title: 'Chair Yoga', locations: ['Narberth'],
    sheetTypeLabel: 'Monthly sign-up', formIds: ['F1'], calendarFormIds: ['F1'],
    formsByMonth: [{ month: 'March 2026', formIds: ['F1'], sessions: 4 }]
  }, over || {});
}

{
  const report = sandbox.buildFormLinkageReport([program()]);
  check('a tidy program is one form with one program on it',
    report.forms.map(f => [f.formId, f.programs.length, f.sessions]), [['F1', 1, 4]]);
  check('and nothing overlaps', report.conflicts, []);
  ok('the form carries an edit address built from its ID, with nothing opened',
    report.forms[0].editUrl === 'https://docs.google.com/forms/d/F1/edit');
}

{
  // ONE MONTH, TWO FORMS — the same sessions handed out on two different links.
  const report = sandbox.buildFormLinkageReport([program({
    formIds: ['F1', 'F2'], calendarFormIds: ['F1', 'F2'],
    formsByMonth: [{ month: 'March 2026', formIds: ['F1', 'F2'], sessions: 4 }]
  })]);
  const split = report.conflicts.filter(c => c.kind === 'split-month');
  check('a month split across two forms is reported once', split.length, 1);
  check('and as a problem, not a nicety', split[0].level, 'problem');
  ok('naming both the month and the program', /March 2026/.test(split[0].text) &&
    /Chair Yoga/.test(split[0].text));
  ok('its sessions are not counted twice onto either form',
    report.forms.every(f => f.sessions === 0));
}

{
  // TWO MONTHS, TWO FORMS is how a monthly program is meant to work.
  const report = sandbox.buildFormLinkageReport([program({
    formIds: ['F1', 'F2'], calendarFormIds: ['F1', 'F2'],
    formsByMonth: [
      { month: 'March 2026', formIds: ['F1'], sessions: 4 },
      { month: 'April 2026', formIds: ['F2'], sessions: 5 }
    ]
  })]);
  check('a form per month is not a conflict', report.conflicts, []);
  check('and each form counts only its own month', report.forms.map(f => f.sessions).sort(), [4, 5]);
}

{
  // ONE FORM, TWO DIFFERENT NAMES.
  const report = sandbox.buildFormLinkageReport([
    program(),
    program({ id: 'cal2::Tai Chi', title: 'Tai Chi', locations: ['Ardmore'] })
  ]);
  const shared = report.conflicts.filter(c => c.kind === 'shared-form');
  check('two differently-named programs on one form is reported', shared.length, 1);
  check('as a problem', shared[0].level, 'problem');
  ok('naming both programs', /Chair Yoga/.test(shared[0].text) && /Tai Chi/.test(shared[0].text));
  ok('and the form is flagged as a clash', report.forms[0].sharedAcrossTitles === true);
}

{
  // ONE NAME AT TWO PLACES on one form is how a cross-location sign-up works,
  // and must not be reported in the same words as the case above.
  const report = sandbox.buildFormLinkageReport([
    program(),
    program({ id: 'cal2::Chair Yoga', locations: ['Ardmore'] })
  ]);
  const shared = report.conflicts.filter(c => c.kind === 'shared-form');
  check('one name at two locations is worth confirming, not a problem', shared[0].level, 'warn');
  ok('and the form is not flagged as a clash', report.forms[0].sharedAcrossTitles === false);
}

{
  // THE CALENDAR POINTS SOMEWHERE ELSE.
  const report = sandbox.buildFormLinkageReport([program({ calendarFormIds: ['F9'] })]);
  const stray = report.conflicts.filter(c => c.kind === 'calendar-elsewhere');
  check('a calendar link on a form the sheet does not use is reported', stray.length, 1);
  ok('naming the form the events advertise', /F9/.test(stray[0].text));
  const f9 = report.forms.filter(f => f.formId === 'F9')[0];
  ok('and that form is listed, marked as calendar-only',
    !!f9 && f9.onCalendar === true && f9.onSheet === false);
}

{
  // Shared forms sort to the top, because they are what somebody scanning this
  // list came to find.
  const report = sandbox.buildFormLinkageReport([
    program({ id: 'cal1::Zumba', title: 'Zumba', formIds: ['F3'], calendarFormIds: ['F3'],
      formsByMonth: [{ month: 'March 2026', formIds: ['F3'], sessions: 1 }] }),
    program({ formIds: ['F1'], calendarFormIds: ['F1'] }),
    program({ id: 'cal2::Tai Chi', title: 'Tai Chi', formIds: ['F1'], calendarFormIds: ['F1'],
      formsByMonth: [{ month: 'March 2026', formIds: ['F1'], sessions: 2 }] })
  ]);
  check('the shared form is listed first', report.forms[0].formId, 'F1');
}

// --- THE PLAN NEVER TOUCHES THE SERVER UNTIL APPLY ---------------------------
const review = {
  ready: true,
  summary: { total: 2, problems: 1, warnings: 1, reviewed: 0, calendarsUnread: [] },
  formLinks: sandbox.buildFormLinkageReport([program()]),
  programs: [
    {
      id: 'cal1::Chair Yoga', title: 'Chair Yoga', locations: ['Narberth'], isShared: false,
      sessionCount: 4, upcomingCount: 4, eventCount: 4, formCount: 1, formIds: ['F1'],
      dateLabels: ['Mon, Mar 2'], moreDates: 0, sheetTypeKey: 'MONTHLY',
      sheetTypeLabel: 'Monthly sign-up', calendarTypeKey: 'MONTHLY', calendarTypeLabel: 'Monthly sign-up',
      registered: 4, waitlisted: 0, capacity: 0, slotMinutes: 0, timeBlockDays: 2,
      checks: [{ level: 'problem', text: 'Two events on one day.', fix: 'merge' },
               { level: 'warn', text: 'Some events carry no link.', fix: 'sync' }],
      worst: 'problem', fingerprint: 'a/1', reviewedAt: '', reviewedBy: '', changedSinceReview: false
    },
    {
      id: 'cal2::Tai Chi', title: 'Tai Chi', locations: ['Ardmore'], isShared: false,
      sessionCount: 3, upcomingCount: 3, eventCount: 3, formCount: 1, formIds: ['F2'],
      dateLabels: ['Tue, Mar 3'], moreDates: 0, sheetTypeKey: 'MONTHLY',
      sheetTypeLabel: 'Monthly sign-up', calendarTypeKey: 'SERIES', calendarTypeLabel: 'Series',
      registered: 0, waitlisted: 0, capacity: 0, slotMinutes: 0, timeBlockDays: 0,
      checks: [{ level: 'warn', text: 'The sheet and the calendar disagree.', fix: 'kind' }],
      worst: 'warn', fingerprint: 'b/1', reviewedAt: '', reviewedBy: '', changedSinceReview: false
    }
  ]
};

const html = sandbox.buildProgramReviewHtml(review);
const scriptBody = html.substring(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

ok('the dialog script parses as JavaScript', (() => {
  try { new vm.Script(scriptBody); return true; } catch (e) { console.log('  ' + e.message); return false; }
})());

// A DOM thin enough to run the dialog's own script against. Elements are
// created on demand and remembered, which is all this script asks of one.
function runDialog(outcome) {
  outcome = outcome || { ok: true };
  const els = {};
  const calls = [];
  const el = () => ({ innerHTML: '', textContent: '', className: '', value: '', disabled: false,
    title: '', style: {} });
  const box = {
    console: { log: () => {} },
    confirm: () => true,
    document: {
      getElementById: id => (els[id] || (els[id] = el())),
      getElementsByName: () => [{ checked: true, value: 'attention' }]
    },
    google: {
      script: {
        run: {
          withSuccessHandler(fn) { this._ok = fn; return this; },
          withFailureHandler(fn) { this._err = fn; return this; },
          reviewApplyPlan(planJson) {
            calls.push({ fn: 'reviewApplyPlan', plan: JSON.parse(planJson) });
            this._ok(JSON.stringify({ ok: outcome.ok, message: 'done', review }));
          },
          reviewClearAllMarks() { calls.push({ fn: 'reviewClearAllMarks' }); }
        }
      }
    }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(scriptBody, box, { filename: 'dialog.js' });
  return { box, calls, els };
}

{
  const { box, calls, els } = runDialog();
  // Everything a person does while walking the review.
  box.setFilter();                       // "Needs attention" — both programs
  box.stageKind('SERIES');               // program 1
  box.stageMerge(true);                  // program 1
  box.toggleMark();                      // marks program 1, advances to program 2
  box.stageKind('CLUB');                 // program 2
  box.toggleMark();                      // marks program 2

  check('nothing has gone to the server yet', calls.length, 0);
  ok('and the footer says so', /not yet applied/.test(els['plan-bar'].innerHTML));

  box.applyPlan();
  check('Apply sends exactly one call', calls.map(c => c.fn), ['reviewApplyPlan']);

  const plan = calls[0].plan;
  check('carrying both kind changes', plan.kinds,
    [{ id: 'cal1::Chair Yoga', typeKey: 'SERIES' }, { id: 'cal2::Tai Chi', typeKey: 'CLUB' }]);
  check('the staged merge', plan.merges, ['cal1::Chair Yoga']);
  check('and both marks', plan.marks.sort(), ['cal1::Chair Yoga', 'cal2::Tai Chi']);
  ok('the plan does not ask for a bare sync — its own changes force one', plan.sync === false);
  ok('and the forms list is what it lands on', /which form/i.test(els.card.innerHTML));
  check('the plan is emptied once it has been applied', box.plan,
    { kinds: {}, merges: {}, marks: {} });
}

{
  const { box, calls } = runDialog();
  box.setFilter();
  box.stageKind('SERIES');
  box.stageKind('');                     // changed their mind
  box.applyPlan();
  check('an undone choice is not sent', calls[0].plan.kinds, []);
  ok('and an empty plan still asks for the update', calls[0].plan.sync === true);
}

{
  const { box, calls } = runDialog();
  box.setFilter();
  box.stageKind('SERIES');
  box.stageKind('CLUB');                 // second answer replaces the first
  box.applyPlan();
  check('changing an answer replaces it rather than queueing two', calls[0].plan.kinds,
    [{ id: 'cal1::Chair Yoga', typeKey: 'CLUB' }]);
}

{
  const { box, calls } = runDialog();
  box.setFilter();
  box.stageKind('MONTHLY');              // what it already is
  box.applyPlan();
  check('choosing the kind it already is writes nothing', calls[0].plan.kinds, []);
}

{
  const { box, calls } = runDialog();
  box.setFilter();
  box.toggleMark();                      // mark program 1, advance to 2
  box.step(-1);                          // back to program 1
  box.toggleMark();                      // unmark it
  box.applyPlan();
  check('a mark can be taken off again before Apply', calls[0].plan.marks, []);
}

{
  // A half-finished apply must not take the selections with it: every step is
  // idempotent, so pressing Apply again is how somebody finishes the job.
  const { box, calls } = runDialog({ ok: false });
  box.setFilter();
  box.stageKind('SERIES');
  box.toggleMark();
  box.applyPlan();
  check('a failed apply keeps the plan', Object.keys(box.plan.kinds), ['cal1::Chair Yoga']);
  check('and its marks', Object.keys(box.plan.marks), ['cal1::Chair Yoga']);
  box.applyPlan();
  check('so pressing Apply again re-sends the same plan',
    calls.map(c => c.plan.kinds.length), [1, 1]);
}

// A fix the final update performs must not still be a button — pressing it is
// the per-program wait this whole screen was rebuilt to remove.
ok('there is no per-program "sync now" button left',
  scriptBody.indexOf('Sync now') === -1);
ok('nor a per-program "apply this kind" call',
  scriptBody.indexOf('reviewApplyKind') === -1 && scriptBody.indexOf('reviewMarkOne') === -1);

console.log(failures === 0 ? '\nAll batched review checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
