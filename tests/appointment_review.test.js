// A SEPTEMBER FORM HAS TO OFFER EVERY SEPTEMBER DATE AND EVERY TIME ON EACH.
//
// Two things used to stop it, and both are pinned here.
//
//   1. A SESSION ROW'S TIMES WERE WRITTEN ONCE AND NEVER AGAIN.
//      writeEventRegistryRows() sets Event_Date and Event_End when a date
//      first appears; collectCalendarWork() then skips the group forever as
//      "up to date". Stretch the calendar event from 10:00-10:30 to
//      10:00-11:30 afterwards and the row still says half an hour — and an
//      appointment's slots are cut out of the ROW, so the form goes on
//      offering one appointment per date. reconcileSessionTimesFromCalendar()
//      is what closes that, and buildSessionTimeExpectations() is the half of
//      it that can be pinned without a spreadsheet.
//
//   2. A DAY STILL TYPED AS ONE EVENT PER APPOINTMENT collided onto one row
//      whose times were whichever block the sync happened to write last. The
//      answer is the whole contiguous span — the same shape section 12's merge
//      produces, without deleting anything — so the form offers every time on
//      that day whether or not anybody ever presses Merge.
//
// And the third thing this file pins is that neither of those swallows a gap:
// a morning class and an afternoon class of the same name are two sessions,
// and spanning them would invent hours of capacity that do not exist.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    // The three formats this file's code paths ask for, spelled out: a date
    // LABEL has to be a date, or every session on one day would carry a
    // different label and the dedupe below would be testing the stub.
    formatDate: (d, tz, fmt) => {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'];
      if (fmt === 'yyyy-MM-dd') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
          `${String(d.getDate()).padStart(2, '0')}`;
      }
      if (fmt === 'EEE, MMM d, yyyy') {
        return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
      }
      if (fmt === 'MMMM yyyy') return `${full[d.getMonth()]} ${d.getFullYear()}`;
      const h = d.getHours(), m = d.getMinutes();
      const ampm = h < 12 ? 'AM' : 'PM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
    },
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildSessionTimeExpectations = buildSessionTimeExpectations;
this.sessionTimeKey = sessionTimeKey;
this.spanOfContiguousBlocks = spanOfContiguousBlocks;
this.buildAppointmentSlots = buildAppointmentSlots;
this.buildAppointmentChoicesForContext = buildAppointmentChoicesForContext;
this.describeAssistanceMonth = describeAssistanceMonth;
this.sessionTimesAgree = sessionTimesAgree;
this.parseAssistanceReviewId = parseAssistanceReviewId;
this.assistanceReviewId = assistanceReviewId;
this.compareAssistanceMonths = compareAssistanceMonths;
this.noteFormsCarryingSeveralMonths = noteFormsCarryingSeveralMonths;
this.ASSISTANCE_NO_TIME_CHOICE = ASSISTANCE_NO_TIME_CHOICE;
this.REVIEW_LEVELS = REVIEW_LEVELS;
this.CALENDAR_MAP = CALENDAR_MAP;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const CAL = Object.keys(sandbox.CALENDAR_MAP)[0];
// ALWAYS A FUTURE MONTH. buildAppointmentChoicesForContext() drops any session
// that has already started, so a hard-coded month silently stops offering its
// times the moment the calendar passes it — which is exactly how section 5's
// two checks came to fail on every branch, long after they were written. The
// month after next is far enough ahead that every day in it is still to come.
const FIXTURE_MONTH = (() => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 2, 1);
})();
const on = (day, h, m) =>
  new Date(FIXTURE_MONTH.getFullYear(), FIXTURE_MONTH.getMonth(), day, h, m, 0);
const label = d => sandbox.Utilities.formatDate(d, '', 'h:mm a');

/** One calendar event, reduced to what the expectation builder reads off it. */
function ev(startD, startH, startM, endH, endM) {
  return {
    getId: () => `e-${startD}-${startH}${startM}`,
    isAllDayEvent: () => false,
    getStartTime: () => on(startD, startH, startM),
    getEndTime: () => on(startD, endH, endM)
  };
}

/** One group, in the shape buildEventGroups() hands on. */
function group(title, events) {
  return { cleanTitle: title, sessions: events.map(e => ({ event: e, calendarId: CAL, locationName: 'Narberth' })) };
}

const keyFor = (title, day) =>
  sandbox.sessionTimeKey(CAL, title, sandbox.Utilities.formatDate(on(day, 0, 0), '', 'yyyy-MM-dd'));

// ---------------------------------------------------------------------------
// 1. ONE EVENT PER DAY — the row simply follows it
// ---------------------------------------------------------------------------
{
  const expected = sandbox.buildSessionTimeExpectations([
    group('Low-Cost Wills', [ev(1, 10, 0, 11, 30), ev(8, 10, 0, 11, 30)])
  ]);
  const first = expected[keyFor('Low-Cost Wills', 1)];
  check('a 90-minute block is expected as 90 minutes',
    [label(first.start), label(first.end)], ['10:00 AM', '11:30 AM']);
  check('one event is one block', [first.blocks, first.spanned], [1, 1]);
  check('every date of the month is expected', Object.keys(expected).length, 2);
}

// ---------------------------------------------------------------------------
// 2. THE BUG THIS EXISTS FOR — a stale row hides two of the three appointments
// ---------------------------------------------------------------------------
{
  // What the sheet still says, from when the event was half an hour long.
  const staleSlots = sandbox.buildAppointmentSlots(on(1, 10, 0), on(1, 10, 30), 30);
  check('a stale half-hour row cuts ONE appointment', staleSlots.length, 1);

  const expected = sandbox.buildSessionTimeExpectations([
    group('Low-Cost Wills', [ev(1, 10, 0, 11, 30)])
  ]);
  const want = expected[keyFor('Low-Cost Wills', 1)];
  const fresh = sandbox.buildAppointmentSlots(want.start, want.end, 30);
  check('and the calendar it was taken from holds THREE', fresh.length, 3);
  check('at the times the form should be offering',
    fresh.map(s => s.startLabel), ['10:00 AM', '10:30 AM', '11:00 AM']);
  check('the sheet and the calendar are reported as disagreeing',
    sandbox.sessionTimesAgree(on(1, 10, 0), on(1, 10, 30), { start: want.start, end: want.end }), false);
  check('and as agreeing once the row has been rewritten',
    sandbox.sessionTimesAgree(want.start, want.end, { start: want.start, end: want.end }), true);
}

// ---------------------------------------------------------------------------
// 3. A DAY TYPED AS THREE BLOCKS reads as one 90-minute session
// ---------------------------------------------------------------------------
{
  const expected = sandbox.buildSessionTimeExpectations([
    group('Low-Cost Wills', [ev(1, 10, 0, 10, 30), ev(1, 10, 30, 11, 0), ev(1, 11, 0, 11, 30)])
  ]);
  check('three blocks on one day are one session', Object.keys(expected).length, 1);
  const want = expected[keyFor('Low-Cost Wills', 1)];
  check('spanning all three', [label(want.start), label(want.end)], ['10:00 AM', '11:30 AM']);
  check('and saying how many it swallowed', [want.blocks, want.spanned], [3, 3]);
  check('so the form offers all three times',
    sandbox.buildAppointmentSlots(want.start, want.end, 30).map(s => s.startLabel),
    ['10:00 AM', '10:30 AM', '11:00 AM']);
}

// A five-minute comfort break between people is still one afternoon.
{
  const expected = sandbox.buildSessionTimeExpectations([
    group('Computer Help', [ev(1, 10, 0, 10, 30), ev(1, 10, 35, 11, 5)])
  ]);
  check('a comfort break does not end the session',
    label(expected[keyFor('Computer Help', 1)].end), '11:05 AM');
}

// ---------------------------------------------------------------------------
// 4. AND A LUNCH BREAK IS TWO SEPARATE THINGS — never spanned
// ---------------------------------------------------------------------------
{
  const expected = sandbox.buildSessionTimeExpectations([
    group('Chair Yoga', [ev(1, 9, 0, 10, 0), ev(1, 13, 0, 14, 0)])
  ]);
  const want = expected[keyFor('Chair Yoga', 1)];
  check('a morning and an afternoon class keep the morning',
    [label(want.start), label(want.end)], ['9:00 AM', '10:00 AM']);
  check('and only one of the two blocks is spanned', want.spanned, 1);
}

// Overlapping events are refused outright rather than spanned.
{
  const expected = sandbox.buildSessionTimeExpectations([
    group('Medicare Counseling', [ev(1, 10, 0, 11, 0), ev(1, 10, 30, 11, 30)])
  ]);
  check('overlapping events are never spanned', expected[keyFor('Medicare Counseling', 1)].spanned, 1);
}

check('a span of nothing is nothing', sandbox.spanOfContiguousBlocks([]), null);

// ---------------------------------------------------------------------------
// 5. A FORM NEVER OFFERS THE SAME TIME TWICE
// ---------------------------------------------------------------------------
// A day still typed as blocks leaves several rows carrying ONE Event_ID, and
// once the first of them has been grown over the whole run its slots cover the
// times the others repeat.
{
  const context = {
    sessions: [
      { date: on(1, 10, 0), end: on(1, 11, 30), eventId: 'x', slotMinutes: 30, location: 'Narberth', title: 'Low-Cost Wills' },
      { date: on(1, 10, 30), end: on(1, 11, 0), eventId: 'x', slotMinutes: 30, location: 'Narberth', title: 'Low-Cost Wills' },
      { date: on(1, 11, 0), end: on(1, 11, 30), eventId: 'x', slotMinutes: 30, location: 'Narberth', title: 'Low-Cost Wills' }
    ],
    showLocation: false, showTitle: false
  };
  const choices = sandbox.buildAppointmentChoicesForContext(context, {});
  check('duplicate rows do not duplicate the times', choices.length, 4); // 3 + the escape hatch
  check('and the escape hatch is still last', choices[3], sandbox.ASSISTANCE_NO_TIME_CHOICE);
}

// ---------------------------------------------------------------------------
// 6. THE MONTH'S ASSERTIONS
// ---------------------------------------------------------------------------
/** One described session, in the shape describeAssistanceSession() returns. */
function session(over) {
  return Object.assign({
    key: 'k', eventId: 'e', calendarId: CAL, location: 'Narberth', title: 'Low-Cost Wills',
    dateKey: '2026-09-01', dateLabel: 'Tue, Sep 1, 2026', monthLabel: 'September 2026',
    past: false, onSheet: true, onCalendar: true, duplicateRows: 0, blockCount: 1,
    collapsible: false, tickedOnSheet: true, taggedOnCalendar: true,
    slotMinutes: 30, statedSlotMinutes: 30, calendarSlotMinutes: 30,
    sheetTimeLabel: '10:00 AM - 11:30 AM', calendarTimeLabel: '10:00 AM - 11:30 AM',
    slots: 3, calendarSlots: 3, hidden: 0, taken: 0, free: 3, timesAgree: true,
    formIds: ['FORM_A'], formId: 'FORM_A', isShared: false
  }, over || {});
}
const month = sessions => sandbox.describeAssistanceMonth(
  { id: 'x', scope: CAL, title: 'Low-Cost Wills', monthLabel: 'September 2026', sessions });
const texts = m => m.checks.map(c => c.level);
const fixes = m => m.checks.map(c => c.fix).filter(Boolean);

// A month that is right says so, and offers no fixes.
{
  const m = month([session(), session({ dateKey: '2026-09-08', formIds: ['FORM_A'], formId: 'FORM_A' })]);
  check('a healthy month is OK', m.worst, sandbox.REVIEW_LEVELS.OK);
  check('with six appointments across two dates', [m.totals.slots, m.totals.free], [6, 6]);
  check('and nothing to fix', fixes(m), []);
}

// A month split over two forms is the worst thing this screen reports.
{
  const m = month([session(), session({ dateKey: '2026-09-08', formIds: ['FORM_B'], formId: 'FORM_B' })]);
  check('a split month is a problem', m.worst, sandbox.REVIEW_LEVELS.PROBLEM);
  check('and the fix is to combine it', fixes(m).indexOf('combine') !== -1, true);
  check('onto the form most of it is already on', m.primaryFormId, 'FORM_A');
}

// Stale times that hide appointments are a problem; stale times that hide none
// are only worth a mention.
{
  const m = month([session({ timesAgree: false, hidden: 2, slots: 1, free: 1 })]);
  check('hidden appointments are a problem', m.worst, sandbox.REVIEW_LEVELS.PROBLEM);
  check('and the fix is to retime it', fixes(m).indexOf('retime') !== -1, true);
  check('with the count of what is hidden carried up', m.totals.hidden, 2);
}
{
  const m = month([session({ timesAgree: false, hidden: 0 })]);
  check('a stale row hiding nothing is only a warning', m.worst, sandbox.REVIEW_LEVELS.WARN);
}

// A day still typed as blocks, and the duplicate rows it left behind.
{
  const m = month([session({ collapsible: true, blockCount: 3, duplicateRows: 2 })]);
  check('unmerged blocks are a warning', m.worst, sandbox.REVIEW_LEVELS.WARN);
  check('with both fixes offered', fixes(m).sort(), ['merge', 'tidy']);
  check('and the duplicate rows counted', m.totals.duplicateRows, 2);
}

// The sheet and the calendar disagreeing about what this even is.
{
  const m = month([session({ taggedOnCalendar: false })]);
  check('a tick the calendar does not carry is a problem', m.worst, sandbox.REVIEW_LEVELS.PROBLEM);
}
{
  const m = month([session({ tickedOnSheet: false })]);
  check('a tag the dashboard has not read is a problem', m.worst, sandbox.REVIEW_LEVELS.PROBLEM);
}
{
  const m = month([session({ onSheet: false })]);
  check('a calendar date with no row at all is a problem', m.worst, sandbox.REVIEW_LEVELS.PROBLEM);
}

// What somebody has TYPED, as opposed to what the default falls back to - the
// difference decides whether a merge is allowed to overrule the block lengths.
{
  const m = month([session({ statedSlotMinutes: 0, calendarSlotMinutes: 0 })]);
  check('an unstated length is reported as unstated', m.statedSlotMinutes, 0);
  check('while the resolved one still defaults to 30', m.slotMinutes, 30);
}
{
  const m = month([session({ statedSlotMinutes: 0, calendarSlotMinutes: 20 })]);
  check('a length typed on the calendar counts as stated', m.statedSlotMinutes, 20);
}

// Two appointment lengths in one month.
{
  const m = month([session(), session({ dateKey: '2026-09-08', slotMinutes: 60 })]);
  check('two lengths in one month is a warning', m.worst, sandbox.REVIEW_LEVELS.WARN);
  check('and the fix is to set one', fixes(m).indexOf('slots') !== -1, true);
}

// The two things that look like failures and are not.
{
  const m = month([session({ past: true, free: 0, hidden: 0 })]);
  check('a month that has finished is not a fault', m.worst, sandbox.REVIEW_LEVELS.OK);
  check('and says so in words', texts(m), [sandbox.REVIEW_LEVELS.INFO]);
}
{
  const m = month([session({ taken: 3, free: 0 })]);
  check('a fully-booked month is not a fault', m.worst, sandbox.REVIEW_LEVELS.OK);
  check('and says so in words', texts(m), [sandbox.REVIEW_LEVELS.INFO]);
}

// ---------------------------------------------------------------------------
// 7. THE ID SURVIVES THE ROUND TRIP THROUGH THE BROWSER
// ---------------------------------------------------------------------------
// A calendar ID is an email address and a program title can hold almost
// anything, including the "::" a group key uses.
{
  const id = sandbox.assistanceReviewId('team@newhorizons.org', 'Wills :: Estates', 'September 2026');
  check('an id round-trips', sandbox.parseAssistanceReviewId(id),
    { scope: 'team@newhorizons.org', title: 'Wills :: Estates', monthLabel: 'September 2026' });
  check('and it survives JSON', sandbox.parseAssistanceReviewId(JSON.parse(JSON.stringify(id))).title,
    'Wills :: Estates');
  check('nonsense parses to nothing', sandbox.parseAssistanceReviewId('rubbish'), null);
}

// ---------------------------------------------------------------------------
// 8. ONE LINK, MORE THAN ONE MONTH — the inverse of a split month
// ---------------------------------------------------------------------------
// The assertion no single month can make from the inside: "the September form"
// also carrying October, or carrying another program entirely.
{
  const sept = month([session()]);
  const oct = sandbox.describeAssistanceMonth({
    id: 'y', scope: CAL, title: 'Low-Cost Wills', monthLabel: 'October 2026',
    sessions: [session({ dateKey: '2026-10-06', monthLabel: 'October 2026' })]
  });
  sandbox.noteFormsCarryingSeveralMonths([sept, oct]);
  check('a form carrying two months is a warning on both',
    [sept.worst, oct.worst], ['warn', 'warn']);
  check('and the fix defaults to a NEW form, not the one being shared',
    [sept.combineDefault, sept.actions.combine], ['new', 'FORM_A']);
}
{
  const wills = month([session()]);
  const bingo = sandbox.describeAssistanceMonth({
    id: 'z', scope: CAL, title: 'Medicare Counseling', monthLabel: 'September 2026',
    sessions: [session({ title: 'Medicare Counseling' })]
  });
  sandbox.noteFormsCarryingSeveralMonths([wills, bingo]);
  check('two different programs on one form is a problem', wills.worst, 'problem');
}
{
  // A cross-location program takes one sign-up across both rooms BY DESIGN.
  const a = month([session()]);
  const b = month([session({ location: 'Ashbridge' })]);
  sandbox.noteFormsCarryingSeveralMonths([a, b]);
  check('one name, one month, two rooms is left alone', [a.worst, b.worst], ['ok', 'ok']);
}

// Worst first, then soonest.
{
  const order = [
    { worst: 'ok', nextDateKey: '2026-09-01', title: 'A', monthLabel: 'September 2026' },
    { worst: 'problem', nextDateKey: '2026-10-01', title: 'B', monthLabel: 'October 2026' },
    { worst: 'warn', nextDateKey: '2026-09-02', title: 'C', monthLabel: 'September 2026' }
  ].sort(sandbox.compareAssistanceMonths).map(m => m.title);
  check('worst first, then soonest', order, ['B', 'C', 'A']);
}

console.log(failures === 0 ? '\nAll appointment review checks passed.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
