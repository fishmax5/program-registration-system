// Writing a tag into a calendar description is not free: every edit is a
// notification to everybody the event is shared with. setFlagBracketInDescription()
// has always known that — adding a tag that is already there changes nothing —
// and the grouping stamp did not.
//
// [Regular] is the DEFAULT. An event whose description says nothing about
// grouping already means Regular, so appending the word tells the system
// nothing and tells every subscriber the event changed. Applying "Monthly
// sign-up" to a program that was already monthly would have rewritten every
// one of its events, which is most of the calendar.
//
// The exception is the one case where the appended word does real work: a
// description that is silent while the TITLE still carries a legacy [Grouped].
// There an explicit [Regular] in the description is the only thing that can
// override it.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10), sleep: () => {}, computeDigest: () => [1],
    DigestAlgorithm: { MD5: 'MD5' } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.stampTypeTagOnCalendar = stampTypeTagOnCalendar;
this.EVENT_TYPES = EVENT_TYPES;
this.CALENDAR_MAP = CALENDAR_MAP;
this.setStubs = function (getEvents, range, invalidate) {
  getCalendarEventsForWindow = getEvents;
  computeSyncDateRange = range;
  invalidateCalendarEventsCache = invalidate;
};
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const CAL = Object.keys(sandbox.CALENDAR_MAP)[0];

function event(title, description) {
  const state = { description: description || '', writes: 0 };
  return {
    state,
    getTitle: () => title,
    isAllDayEvent: () => false,
    getDescription: () => state.description,
    setDescription: d => { state.description = d; state.writes++; }
  };
}

function stamp(events, tag) {
  sandbox.setStubs(
    () => { const out = {}; out[CAL] = events; return out; },
    () => ({ start: new Date(2026, 2, 1), end: new Date(2026, 3, 30) }),
    () => {}
  );
  return sandbox.stampTypeTagOnCalendar('Chair Yoga', CAL, tag);
}

// --- the write nobody needed --------------------------------------------
{
  const ev = event('Chair Yoga', 'Bring a mat.');
  check('a silent description already means Regular, so nothing is written',
    stamp([ev], sandbox.EVENT_TYPES.REGULAR), 0);
  check('and the description is untouched', ev.state.description, 'Bring a mat.');
  check('with no edit at all', ev.state.writes, 0);
}
{
  const ev = event('Chair Yoga', '');
  check('an empty description likewise', stamp([ev], sandbox.EVENT_TYPES.REGULAR), 0);
}
{
  const ev = event('Chair Yoga', 'Bring a mat.\n[Regular]');
  check('one that already says Regular likewise',
    stamp([ev], sandbox.EVENT_TYPES.REGULAR), 0);
}

// --- the writes that do real work ---------------------------------------
{
  const ev = event('Chair Yoga', 'Bring a mat.');
  check('making a silent program Grouped IS a change',
    stamp([ev], sandbox.EVENT_TYPES.GROUPED), 1);
  check('and it says so', /\[Grouped\]/.test(ev.state.description), true);
}
{
  const ev = event('Chair Yoga', '[Grouped]');
  check('moving a Grouped program to Regular is a change',
    stamp([ev], sandbox.EVENT_TYPES.REGULAR), 1);
  check('and the bracket is rewritten, not added to', ev.state.description, '[Regular]');
}
// THE EXCEPTION: a legacy bracket left in the TITLE. The description is silent,
// but silence there does NOT mean Regular — the title is still saying Grouped,
// and an explicit [Regular] in the description is the only thing that overrides it.
{
  const ev = event('Chair Yoga [Grouped]', 'Bring a mat.');
  check('a legacy tag in the title still gets its override written',
    stamp([ev], sandbox.EVENT_TYPES.REGULAR), 1);
  check('as an explicit [Regular] in the description',
    /\[Regular\]/.test(ev.state.description), true);
}
{
  const ev = event('Chair Yoga [Grouped]', 'Bring a mat.');
  check('and a title already agreeing needs no write',
    stamp([ev], sandbox.EVENT_TYPES.GROUPED), 0);
}

// --- a bracket that is prose is never touched ---------------------------
{
  const ev = event('Chair Yoga', 'Meets in the [big room upstairs]');
  check('a note is not a tag', stamp([ev], sandbox.EVENT_TYPES.REGULAR), 0);
  check('and stays exactly as typed', ev.state.description, 'Meets in the [big room upstairs]');
}

// --- another program on the same calendar is not touched --------------
{
  const mine = event('Chair Yoga', '');
  const theirs = event('Book Club', '');
  stamp([mine, theirs], sandbox.EVENT_TYPES.GROUPED);
  check('only the named program is stamped', theirs.state.writes, 0);
}

console.log(failures === 0 ? '\nAll type-tag stamp checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
