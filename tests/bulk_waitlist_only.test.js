// CLOSING A RUN OF DATES AT ONCE — the bulk [Waitlist Only] picker (99l).
//
// waitlist_only.test.js pins what the tag MEANS: it describes one date, it is
// never folded up onto the program, and its calendar write reaches that date's
// event and no other. This file pins the bulk path to the same rules, because
// the whole risk of a bulk tool is that it takes a per-date answer and applies
// it per program.
//
// The five properties below are the ones that make it safe:
//
//   1. ONE PROGRAM'S DATES. The picker groups on `Calendar_Source|Clean_Title`
//      — the same boundary spreadFlagToSiblingRows() draws — and the writer
//      re-checks it against every row rather than trusting what the dialog was
//      drawn from. A rename between opening the dialog and pressing the button
//      makes the row a different program, and closing that one is not what
//      anybody said.
//   2. THE CELL AND THE QUEUE, TOGETHER. A tick is half a cell and half a
//      queue entry — the calendar is what the next syncCalendars() recomputes
//      this column FROM, so a bulk write that skipped recordPendingProgramFlag()
//      would be undone within the hour. One entry PER DATE, which is what keeps
//      "the 14th is full" off the 21st.
//   3. IT UNTICKS. The dialog sends the whole picture, so reopening a date is
//      the same action as closing one.
//   4. A DATE THAT DID NOT CHANGE IS NOT QUEUED. An hourly sync should not be
//      asked to re-stamp a calendar that already agrees.
//   5. PAST DATES ARE NEVER OFFERED. Closing one says nothing.
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 9, 9, 0, 0); // Wed 9 Sep 2026
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {},
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'u'
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  // The lock is always free here; the busy branch is a one-line early return
  // whose message the dialog simply shows.
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.listWaitlistProgramSessions = listWaitlistProgramSessions;
this.applyBulkWaitlistOnly = applyBulkWaitlistOnly;
this.buildBulkWaitlistOnlyHtml = buildBulkWaitlistOnlyHtml;
this.isWaitlistOnlyColumnValue = isWaitlistOnlyColumnValue;
// The queue is a tab of its own (18). What this file is about is WHICH dates
// reach it and which do not, so the entries are recorded rather than written.
this.__queued = [];
recordPendingProgramFlag = function (column, calendarId, title, on, dateKey) {
  this.__queued.push({ column, calendarId, title, on, dateKey });
}.bind(this);
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const HEADERS = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(HEADERS);
const col = name => map[name];
const CAL = 'a@group.calendar.google.com';
const CAL2 = 'b@group.calendar.google.com';

function sessionRow(title, date, opts) {
  opts = opts || {};
  const row = new Array(HEADERS.length).fill('');
  row[col('Event_Date')] = date;
  row[col('Event_End')] = new RealDate(date.getTime() + 3600000);
  row[col('Event_Time')] = '10:00 AM';
  row[col('Location')] = opts.location || 'Ashbridge';
  row[col('Clean_Title')] = title;
  row[col('Calendar_Source')] = opts.calendarId || CAL;
  row[col('Event_ID')] = opts.eventId || `${title}|${date.getTime()}`;
  row[col('Type_Tag')] = 'Regular';
  row[col('Club')] = false;
  row[col('No_Registration')] = false;
  row[col('Personalized_Assistance')] = false;
  row[col('Waitlist_Only')] = !!opts.waitlistOnly;
  row[col('Max_Capacity')] = 12;
  row[col('Status')] = '🟢 Open';
  return row;
}

// Two programs on one calendar, one of them also running at a second building
// under the same title (unlinked — two programs, not one), plus a past date.
const D1 = new RealDate(2026, 8, 15, 10, 0);
const D2 = new RealDate(2026, 8, 22, 10, 0);
const D3 = new RealDate(2026, 8, 29, 10, 0);
const D_PAST = new RealDate(2026, 7, 11, 10, 0);

const blank = new Array(HEADERS.length).fill('');
const grid = [
  ['All Program Sessions'],
  ['⏳ Upcoming'],
  HEADERS.slice(),
  sessionRow('Chair Yoga', D1),
  sessionRow('Chair Yoga', D2, { waitlistOnly: true }),
  sessionRow('Chair Yoga', D3),
  sessionRow('Chair Yoga', D1, { calendarId: CAL2, location: 'Narberth', eventId: 'other-building' }),
  sessionRow('Bingo', D1, { eventId: 'bingo-1' }),
  blank.slice(),
  ['✅ Past'],
  HEADERS.slice(),
  sessionRow('Chair Yoga', D_PAST, { eventId: 'yoga-past' })
];

const sheet = makeCountingSheet(grid, 'All_Program_Sessions');
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: name => (name === 'All_Program_Sessions' ? sheet : null),
  toast: () => {}, getSheets: () => [sheet]
});
sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;

// --- what the picker offers ------------------------------------------------

const programs = sandbox.listWaitlistProgramSessions();
const yoga = programs.filter(p => p.key === `${CAL}|Chair Yoga`)[0];

ok('the two buildings are offered as two programs, not one',
  programs.filter(p => p.title === 'Chair Yoga').length === 2,
  JSON.stringify(programs.map(p => p.key)));
ok('a program carries only its own upcoming dates',
  yoga && yoga.sessions.length === 3, yoga ? String(yoga.sessions.length) : 'missing');
ok('the past date is never offered',
  yoga && yoga.sessions.every(s => s.eventId !== 'yoga-past'));
ok('the dates arrive in date order',
  yoga.sessions[0].dateKey === '2026-09-15' && yoga.sessions[2].dateKey === '2026-09-29',
  JSON.stringify(yoga.sessions.map(s => s.dateKey)));
ok('a date already closed arrives ticked',
  yoga.sessions[1].on === true && yoga.sessions[0].on === false,
  JSON.stringify(yoga.sessions.map(s => s.on)));

// The whole program list is inlined into the dialog, so a program title
// carrying markup must not end the page mid-sentence.
{
  const html = sandbox.buildBulkWaitlistOnlyHtml([{
    key: 'k', title: '</script><b>x', label: '</script><b>x', sessions: []
  }]);
  // Two places the title reaches: the <option> markup (escaped as HTML) and
  // the JSON inlined into the script block (escaped as \u003c). The page must
  // hold exactly one closing </script>, its own.
  const closings = html.split('<' + '/script>').length - 1;
  ok('a title containing </script> cannot close the page early',
    closings === 1, `${closings} closing script tags`);
  ok('the title still survives into the payload',
    html.indexOf('\\u003c/script>\\u003cb>x') !== -1,
    'the title was mangled rather than escaped');
}

// --- closing three dates ---------------------------------------------------

{
  sandbox.__queued.length = 0;
  const msg = sandbox.applyBulkWaitlistOnly(`${CAL}|Chair Yoga`, [
    { eventId: yoga.sessions[0].eventId, on: true },   // was open  -> closes
    { eventId: yoga.sessions[1].eventId, on: true },   // was closed -> no change
    { eventId: yoga.sessions[2].eventId, on: true }    // was open  -> closes
  ]);
  ok('it reports the dates it actually closed', /2 date\(s\) closed/.test(msg), msg);
  ok('only the dates that changed are queued for the calendar',
    sandbox.__queued.length === 2, JSON.stringify(sandbox.__queued));
  ok('each queue entry carries its own date',
    sandbox.__queued.map(q => q.dateKey).sort().join(',') === '2026-09-15,2026-09-29',
    JSON.stringify(sandbox.__queued.map(q => q.dateKey)));
  ok('the queue entries are for this program on this calendar',
    sandbox.__queued.every(q => q.title === 'Chair Yoga' && q.calendarId === CAL &&
      q.column === 'Waitlist_Only' && q.on === true),
    JSON.stringify(sandbox.__queued));

  const read = sheet.getRange(1, 1, grid.length, HEADERS.length).getValues();
  const cell = rowIdx => read[rowIdx][col('Waitlist_Only')];
  ok('the three Chair Yoga cells on this calendar are ticked',
    sandbox.isWaitlistOnlyColumnValue(cell(3)) &&
    sandbox.isWaitlistOnlyColumnValue(cell(4)) &&
    sandbox.isWaitlistOnlyColumnValue(cell(5)),
    JSON.stringify([cell(3), cell(4), cell(5)]));
  ok('the same title at the OTHER building is untouched',
    !sandbox.isWaitlistOnlyColumnValue(cell(6)), String(cell(6)));
  ok('the program beside it is untouched', !sandbox.isWaitlistOnlyColumnValue(cell(7)), String(cell(7)));
  ok('the past row is untouched', !sandbox.isWaitlistOnlyColumnValue(cell(11)), String(cell(11)));
}

// --- reopening one of them -------------------------------------------------

{
  sandbox.__queued.length = 0;
  const msg = sandbox.applyBulkWaitlistOnly(`${CAL}|Chair Yoga`, [
    { eventId: yoga.sessions[0].eventId, on: true },
    { eventId: yoga.sessions[1].eventId, on: false },
    { eventId: yoga.sessions[2].eventId, on: true }
  ]);
  ok('reopening a date is the same action as closing one',
    /1 date\(s\) reopened/.test(msg), msg);
  ok('only the reopened date is queued',
    sandbox.__queued.length === 1 && sandbox.__queued[0].on === false &&
    sandbox.__queued[0].dateKey === '2026-09-22',
    JSON.stringify(sandbox.__queued));
}

// --- nothing to do, and the wrong program ----------------------------------

{
  sandbox.__queued.length = 0;
  const msg = sandbox.applyBulkWaitlistOnly(`${CAL}|Chair Yoga`, [
    { eventId: yoga.sessions[1].eventId, on: false }
  ]);
  ok('a date that already says so is not written or queued',
    /Nothing to do/.test(msg) && sandbox.__queued.length === 0, msg);
}
{
  sandbox.__queued.length = 0;
  // The same Event_IDs, sent under a program key no row matches — what a
  // rename between opening the dialog and pressing the button looks like.
  const msg = sandbox.applyBulkWaitlistOnly(`${CAL}|Gentle Yoga`, [
    { eventId: yoga.sessions[0].eventId, on: false }
  ]);
  ok('a row that is no longer this program is refused, not rewritten',
    /⚠/.test(msg) && sandbox.__queued.length === 0, msg);
}
{
  const msg = sandbox.applyBulkWaitlistOnly(`${CAL}|Chair Yoga`, []);
  ok('an empty selection changes nothing', /⚠/.test(msg), msg);
}

console.log(failures === 0 ? '\nAll bulk waitlist tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
