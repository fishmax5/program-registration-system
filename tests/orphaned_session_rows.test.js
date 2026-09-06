// The sweep that removes session rows left behind by a calendar this workbook
// no longer reads (84_orphaned_session_rows.gs).
//
// The two properties worth pinning are the ones that decide whether this is
// safe to run at all:
//   • a row whose calendar IS configured is never in scope, so no calendar
//     that merely failed to load this run can be read as a retired one;
//   • a row with no Calendar_Source (a lunch row, a hand-typed row) is never
//     in scope either — that blank is the same thing keeping triage off the
//     meals, and this sweep has to honor it for the same reason.
const vm = require('vm');

// The whole project, in the order Apps Script evaluates it. This test was
// written against the single Code.gs; the source is now eighty-odd numbered
// files and the helper is what knows to concatenate them in filename order.
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    // formatDateLabel()'s 'EEE, MMM d, yyyy' is the only pattern this file
    // reaches — describeOrphanedSessionRows() prints a date span with it.
    formatDate: (d) => `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' },
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    Charset: { UTF_8: 'UTF-8' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.findOrphanedSessionRows = findOrphanedSessionRows;
this.describeOrphanedSessionRows = describeOrphanedSessionRows;
this.ORPHAN_REPORT_TITLES_SHOWN = ORPHAN_REPORT_TITLES_SHOWN;
this.CALENDAR_MAP = CALENDAR_MAP;
this.ADMIN_GATED_ACTIONS = ADMIN_GATED_ACTIONS;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const LIVE = 'live@group.calendar.google.com';
const OTHER = 'other@group.calendar.google.com';
const RETIRED = 'retired@group.calendar.google.com';

const map = { Event_ID: 0, Clean_Title: 1, Location: 2, Event_Date: 3, Calendar_Source: 4, Form_ID: 5 };
const row = (id, title, date, source, formId) => {
  const r = [];
  r[map.Event_ID] = id; r[map.Clean_Title] = title; r[map.Location] = 'Narberth';
  r[map.Event_Date] = date; r[map.Calendar_Source] = source; r[map.Form_ID] = formId || '';
  return r;
};

// --- The ordinary repointed-calendar case: same programs, two calendar IDs ---
{
  const rows = [
    row('a1', 'Chair Yoga', new Date(2026, 8, 2), LIVE, 'F_NEW'),
    row('a2', 'Chair Yoga', new Date(2026, 8, 9), LIVE, 'F_NEW'),
    row('b1', 'Chair Yoga', new Date(2026, 7, 5), RETIRED, 'F_OLD'),
    row('b2', 'Book Club', new Date(2026, 7, 12), RETIRED, 'F_OLD')
  ];
  const found = sandbox.findOrphanedSessionRows(rows, map, [LIVE, OTHER]);
  ok('keeps every row on a configured calendar', found.keep.length === 2,
    `kept ${found.keep.length}`);
  ok('sweeps every row on the retired calendar', found.orphans.length === 2,
    `orphaned ${found.orphans.length}`);
  ok('buckets them under the retired calendar ID',
    Object.keys(found.byCalendar).join() === RETIRED);
  ok('collects distinct program titles',
    found.byCalendar[RETIRED].titles.join() === 'Chair Yoga,Book Club');
  ok('spans the retired rows\' dates',
    found.byCalendar[RETIRED].earliest.getMonth() === 7 &&
    found.byCalendar[RETIRED].latest.getDate() === 12);
}

// --- The blank Calendar_Source that keeps triage off the meals ---
{
  const rows = [
    row('LUNCHONLY:2026-09-01|Narberth', 'Lunch @ Narberth', new Date(2026, 8, 1), ''),
    row('typed', 'Hand-added session', new Date(2026, 8, 3), null),
    row('c1', 'Tai Chi', new Date(2026, 8, 4), RETIRED)
  ];
  const found = sandbox.findOrphanedSessionRows(rows, map, [LIVE]);
  ok('a lunch row is never orphaned', found.keep.some(r => r[map.Event_ID].indexOf('LUNCHONLY') === 0));
  ok('a hand-added row is never orphaned', found.keep.length === 2, `kept ${found.keep.length}`);
  ok('only the retired-calendar row goes', found.orphans.length === 1 &&
    found.orphans[0][map.Event_ID] === 'c1');
}

// --- Nothing configured, or nothing retired ---
{
  const rows = [row('a1', 'Chair Yoga', new Date(2026, 8, 2), LIVE)];
  ok('an empty known-calendar list orphans everything (the caller must refuse it)',
    sandbox.findOrphanedSessionRows(rows, map, []).orphans.length === 1);
  ok('a Set of IDs works as well as an array',
    sandbox.findOrphanedSessionRows(rows, map, new Set([LIVE])).orphans.length === 0);
  ok('no rows at all is not an error',
    sandbox.findOrphanedSessionRows(null, map, [LIVE]).orphans.length === 0);
}

// --- What the confirmation prompt actually reads ---
{
  const clean = sandbox.findOrphanedSessionRows(
    [row('a1', 'Chair Yoga', new Date(2026, 8, 2), LIVE)], map, [LIVE]);
  ok('says plainly when there is nothing to do',
    /nothing to remove/.test(sandbox.describeOrphanedSessionRows(clean)));

  const shown = sandbox.ORPHAN_REPORT_TITLES_SHOWN;
  const many = [];
  for (let i = 0; i < shown + 3; i++) {
    many.push(row(`x${i}`, `Program ${i}`, new Date(2026, 7, i + 1), RETIRED));
  }
  const text = sandbox.describeOrphanedSessionRows(sandbox.findOrphanedSessionRows(many, map, [LIVE]));
  ok('names the retired calendar ID in full', text.indexOf(RETIRED) !== -1, text);
  ok('reports the row count', new RegExp(`${shown + 3} row\\(s\\)`).test(text), text);
  ok('truncates a long title list rather than dumping it', /\+3 more/.test(text), text);
  ok('prints the date span with the workbook\'s own date label',
    /Aug 1, 2026 – /.test(text), text);
}

// --- The real CALENDAR_MAP: its own rows must never look orphaned ---
{
  const ids = Object.keys(sandbox.CALENDAR_MAP);
  const rows = ids.map((id, i) => row(`m${i}`, 'Chair Yoga', new Date(2026, 8, i + 1), id));
  ok('every configured calendar in CALENDAR_MAP is left alone',
    sandbox.findOrphanedSessionRows(rows, map, ids).orphans.length === 0);
}

// --- The columns this reads really are on the session tab ---
{
  const real = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
  ok('All_Program_Sessions carries every column the sweep reads',
    ['Event_ID', 'Clean_Title', 'Location', 'Event_Date', 'Calendar_Source', 'Form_ID']
      .every(h => real[h] !== undefined));
}

// --- The destructive half is gated; the report is not ---
{
  ok('"Remove Leftover Calendar Rows" is admin-gated',
    sandbox.ADMIN_GATED_ACTIONS.indexOf('Remove Leftover Calendar Rows') !== -1);
  ok('the read-only report is not gated',
    sandbox.ADMIN_GATED_ACTIONS.indexOf('Find Leftover Calendar Rows') === -1);
}

console.log(failures === 0 ? '\nAll orphaned-session-row checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
