// Program_Month is one row per program-month — the unit buildEventGroups()
// already makes one FORM for, and the one thing the session table cannot show.
// Everything here is about the COLLAPSING: what becomes one row, what refuses
// to, and what a collapsed cell is allowed to claim.
//
// The rules this file holds:
//
//   1. Four sessions sharing a Form_ID are ONE row. That is the whole premise.
//   2. A blank Form_ID falls back to (title, location, month) — the
//      [No Registration] and hand-added cases, which have no form to group by.
//   3. A [Shared] program at two locations has ONE form and is ONE row, with
//      describeLocations() wording the pair.
//   4. An all-uncapped group's Fill is BLANK, never 0% — most programs here
//      are uncapped, and "0% full" about a month of open-door sessions is a
//      lie a person would act on.
//   5. Lunch collapses to one row per location per month.
//
// And, from phase 2 — the metrics block's move up here, the leader-coverage
// line it made possible, and the Sessions drill-through:
//
//   6. The Sessions cell links into the session tab at the group's OWN first
//      day row, and degrades to the plain count rather than to a wrong link.
//   7. Leader coverage counts THIS month's programs with nobody down as
//      leading them, treats a shared program as covered if either building's
//      row names a leader, leaves lunch out of it, and — the line that matters
//      — only ever counts: it shares nothing and sends nothing.
//   8. Moving the metric block onto this tab does not move a number in it. The
//      arithmetic stayed in 43_program_dashboard.gs; this asserts it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      if (pattern === 'MMM d') return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
      if (pattern === 'EEE MMM d') return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`;
      if (pattern === 'EEE') return DAYS[date.getDay()];
      if (pattern === 'd') return String(date.getDate());
      if (pattern === 'h:mm a') {
        const h = date.getHours() % 12 || 12;
        return `${h}:${p(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
      }
      return date.toISOString();
    },
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: n => ({ __name: n }), getSpreadsheetTimeZone: () => 'America/New_York' }),
    WrapStrategy: { OVERFLOW: 'OVERFLOW', CLIP: 'CLIP', WRAP: 'WRAP' }
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildProgramMonthRows = buildProgramMonthRows;
this.describeProgramMonthSchedule = describeProgramMonthSchedule;
this.worstProgramMonthStatus = worstProgramMonthStatus;
this.programMonthSessionsCell = programMonthSessionsCell;
this.programMonthSessionRowNumbers = programMonthSessionRowNumbers;
this.programMonthLeaderCoverage = programMonthLeaderCoverage;
this.computeProgramMetrics = computeProgramMetrics;
this.scanRegistrants = scanRegistrants;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.LUNCH_ONLY_EVENT_ID_PREFIX = LUNCH_ONLY_EVENT_ID_PREFIX;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const sessionHeaders = sandbox.HEADERS.Master_Program_Dashboard;
const sessionMap = sandbox.getIndexMap(sessionHeaders);
const monthMap = sandbox.getIndexMap(sandbox.HEADERS.Program_Month);

/** One session row. `at` is [year, month0, day, hour, minute]. */
function session(fields) {
  const row = new Array(sessionHeaders.length).fill('');
  const at = fields.at;
  row[sessionMap['Event_Date']] = new Date(at[0], at[1], at[2], at[3], at[4] || 0);
  row[sessionMap['Event_End']] = new Date(at[0], at[1], at[2], at[3] + (fields.hours || 2), at[4] || 0);
  row[sessionMap['Location']] = fields.location || 'Narberth';
  row[sessionMap['Clean_Title']] = fields.title || 'Chair Yoga';
  row[sessionMap['Form_ID']] = fields.formId === undefined ? 'FORM_A' : fields.formId;
  row[sessionMap['Event_ID']] = fields.eventId || `EV_${at.join('_')}_${fields.location || 'Narberth'}`;
  row[sessionMap['Active_Count']] = fields.active === undefined ? 0 : fields.active;
  row[sessionMap['Waitlist_Count']] = fields.waitlist === undefined ? 0 : fields.waitlist;
  row[sessionMap['Max_Capacity']] = fields.capacity === undefined ? '' : fields.capacity;
  row[sessionMap['Status']] = fields.status || '';
  row[sessionMap['Type_Tag']] = fields.type || 'Regular';
  if (fields.club) row[sessionMap['Club']] = true;
  if (fields.noRegistration) row[sessionMap['No_Registration']] = true;
  return row;
}

const cell = (row, header) => row[monthMap[header]];

// --- 1. Four sessions, one Form_ID, one row ---------------------------------
{
  const rows = [
    session({ at: [2026, 8, 1, 9, 30], active: 6, capacity: 12, status: '🟢 Open' }),
    session({ at: [2026, 8, 8, 9, 30], active: 9, capacity: 12, status: '🟡 Almost Full' }),
    session({ at: [2026, 8, 15, 9, 30], active: 4, capacity: 12, status: '🟢 Open' }),
    session({ at: [2026, 8, 22, 9, 30], active: 5, capacity: 12, status: '🟢 Open' })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('four sessions collapse to one row', built.rows.length, 1);
  const row = built.rows[0];
  check('Month_Start is the 1st, as a real Date',
    // Not `instanceof Date`: the value was built inside the vm context, whose
    // Date is a different constructor from this file's. What matters is that
    // the sectioned reader will see a date, which is what this asks.
    [Object.prototype.toString.call(cell(row, 'Month_Start')), cell(row, 'Month_Start').getDate(), cell(row, 'Month_Start').getMonth()],
    ['[object Date]', 1, 8]);
  check('Sessions counts the group', cell(row, 'Sessions'), '4 sessions');
  check('Schedule says the weekday and the times',
    cell(row, 'Schedule'), 'Tue 9:30 AM – 11:30 AM · 4 sessions');
  check('Registered sums the group', cell(row, 'Registered'), 24);
  check('Max_Capacity sums the caps', cell(row, 'Max_Capacity'), 48);
  check('Fill is the group total', cell(row, 'Fill'), '50%');
  check('Status is the group\'s worst', cell(row, 'Status'), '🟡 Almost Full');
  check('Group_Key is the form', cell(row, 'Group_Key'), 'form::FORM_A');
}

// --- 2. A blank Form_ID falls back to (title, location, month) --------------
{
  const rows = [
    session({ at: [2026, 8, 2, 10, 0], formId: '', title: 'Coffee Hour', noRegistration: true }),
    session({ at: [2026, 8, 9, 10, 0], formId: '', title: 'Coffee Hour', noRegistration: true }),
    // Same title, DIFFERENT location — a separate program-month, and the
    // fallback key is the only thing that can say so.
    session({ at: [2026, 8, 9, 10, 0], formId: '', title: 'Coffee Hour', location: 'Ashbridge' }),
    // Same title and location, NEXT month. Without the month in the key this
    // would join the September row and claim three sessions.
    session({ at: [2026, 9, 7, 10, 0], formId: '', title: 'Coffee Hour' })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('blank Form_ID groups by title, location and month', built.rows.length, 3);
  check('the fallback key says what it grouped on',
    cell(built.rows[0], 'Group_Key'), 'plain::Coffee Hour::Narberth::2026-09');
  check('the two-session fallback group counts two', cell(built.rows[0], 'Sessions'), '2 sessions');
  check('the flags collapse into one cell', cell(built.rows[0], 'Flags'), 'No Registration');
}

// --- 3. A [Shared] group across two locations is ONE row --------------------
{
  const rows = [
    session({ at: [2026, 8, 3, 13, 0], formId: 'FORM_SHARED', title: 'Book Club', location: 'Narberth', club: true }),
    session({ at: [2026, 8, 10, 13, 0], formId: 'FORM_SHARED', title: 'Book Club', location: 'Ashbridge', club: true })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('one form across two locations is one row', built.rows.length, 1);
  check('Location is worded by describeLocations()',
    cell(built.rows[0], 'Location'), 'Narberth + Ashbridge');
  check('a club reads as one', cell(built.rows[0], 'Flags'), 'Club');
}

// --- 4. An all-uncapped group's Fill is BLANK, never 0% ---------------------
{
  const rows = [
    session({ at: [2026, 8, 4, 11, 0], formId: 'FORM_U', active: 7 }),
    session({ at: [2026, 8, 11, 11, 0], formId: 'FORM_U', active: 5 })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  const row = built.rows[0];
  check('uncapped Fill is blank', cell(row, 'Fill'), '');
  check('uncapped Max_Capacity is blank', cell(row, 'Max_Capacity'), '');
  check('registrations are still counted', cell(row, 'Registered'), 12);
}

// A group where only SOME sessions have a cap takes its percentage off the
// capped ones alone — the uncapped sessions have no denominator to contribute.
{
  const rows = [
    session({ at: [2026, 8, 4, 11, 0], formId: 'FORM_M', active: 5, capacity: 10 }),
    session({ at: [2026, 8, 11, 11, 0], formId: 'FORM_M', active: 40 })
  ];
  const row = sandbox.buildProgramMonthRows(rows, sessionMap).rows[0];
  check('a partly-capped group takes its fill off the capped sessions', cell(row, 'Fill'), '50%');
}

// --- 5. Lunch collapses to one row per location per month -------------------
{
  const lunch = (day, location) => session({
    at: [2026, 8, day, 12, 0],
    formId: '',
    title: `Lunch @ ${location} — Chx Parm`,
    location,
    eventId: `${sandbox.LUNCH_ONLY_EVENT_ID_PREFIX}${location}_${day}`
  });
  const rows = [];
  [1, 2, 3, 4, 7].forEach(day => rows.push(lunch(day, 'Narberth')));
  [1, 2].forEach(day => rows.push(lunch(day, 'Ashbridge')));
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('lunch is one row per location per month', built.rows.length, 2);
  check('the lunch row says where and how many days',
    [cell(built.rows[0], 'Program'), cell(built.rows[0], 'Sessions')],
    ['Lunch @ Narberth', '5 days']);
  check('the lunch row\'s schedule is its span', cell(built.rows[0], 'Schedule'), 'Sep 1–7');
  check('the second location is its own row',
    [cell(built.rows[1], 'Program'), cell(built.rows[1], 'Sessions')],
    ['Lunch @ Ashbridge', '2 days']);
}

// --- Times that do not agree say so, and name the outliers in a note --------
{
  const rows = [
    session({ at: [2026, 8, 1, 9, 30], formId: 'FORM_V' }),
    session({ at: [2026, 8, 8, 9, 30], formId: 'FORM_V' }),
    session({ at: [2026, 8, 15, 14, 0], formId: 'FORM_V' })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('a moved session makes the schedule read "times vary"',
    cell(built.rows[0], 'Schedule'), '3 sessions · times vary');
  check('the outlier is named in a note, on the Schedule cell',
    [built.notes.length, built.notes[0].header, built.notes[0].text.indexOf('Tue Sep 15') > -1],
    [1, 'Schedule', true]);
}

// --- A status nothing recognizes is the group's worst, not ignored ----------
{
  check('an unknown status wins',
    sandbox.worstProgramMonthStatus(
      [{ row: ['🟢 Open'] }, { row: ['⚠️ Form missing'] }], { Status: 0 }),
    '⚠️ Form missing');
}

// --- A dateless row is left on the session table ----------------------------
{
  const row = session({ at: [2026, 8, 1, 9, 30] });
  row[sessionMap['Event_Date']] = '';
  check('a row with no date contributes no month',
    sandbox.buildProgramMonthRows([row], sessionMap).rows.length, 0);
}

// --- 6. The Sessions drill-through ------------------------------------------
{
  const rows = [
    session({ at: [2026, 8, 1, 9, 30], eventId: 'EV_FIRST' }),
    session({ at: [2026, 8, 8, 9, 30], eventId: 'EV_SECOND' })
  ];
  const linked = sandbox.buildProgramMonthRows(rows, sessionMap,
    { gid: 1234, rowNumbersByEventId: { EV_FIRST: 57, EV_SECOND: 58 } });
  check('the Sessions cell links at the group\u2019s FIRST session row',
    cell(linked.rows[0], 'Sessions'), '=HYPERLINK("#gid=1234&range=A57","2 sessions")');

  // A wrong link is worse than no link: both of these degrade rather than guess.
  const unlocated = sandbox.buildProgramMonthRows(rows, sessionMap, { gid: 1234, rowNumbersByEventId: {} });
  check('and is the plain count when the row cannot be located',
    cell(unlocated.rows[0], 'Sessions'), '2 sessions');
  const noTab = sandbox.buildProgramMonthRows(rows, sessionMap, { gid: null, rowNumbersByEventId: { EV_FIRST: 57 } });
  check('or when there is no session tab to point at', cell(noTab.rows[0], 'Sessions'), '2 sessions');
  check('a build with no link target at all still writes the count',
    cell(sandbox.buildProgramMonthRows(rows, sessionMap).rows[0], 'Sessions'), '2 sessions');

  // The row numbers come off the tab itself. A duplicate Event_ID mid-repair
  // resolves to the EARLIER row, which is the one in the Upcoming block.
  const fakeSessionSheet = {
    getLastRow: () => 4,
    getRange: () => ({ getValues: () => [[''], ['EV_FIRST'], ['EV_SECOND'], ['EV_FIRST']] })
  };
  check('row numbers are read off the session tab, first occurrence winning',
    sandbox.programMonthSessionRowNumbers(fakeSessionSheet, sessionMap), { EV_FIRST: 2, EV_SECOND: 3 });
  // A tab that cannot be read costs the links, never the render.
  check('an unreadable session tab yields no links rather than throwing',
    sandbox.programMonthSessionRowNumbers({ getLastRow: () => { throw new Error('gone'); } }, sessionMap), {});
  check('and neither does no session tab at all',
    sandbox.programMonthSessionRowNumbers(null, sessionMap), {});
}

// --- 7. Leader coverage ------------------------------------------------------
{
  const now = new Date();
  const thisMonth = [now.getFullYear(), now.getMonth()];
  const monthKey = `${thisMonth[0]}-${String(thisMonth[1] + 1).padStart(2, '0')}`;

  const built = sandbox.buildProgramMonthRows([
    session({ at: [thisMonth[0], thisMonth[1], 3, 9, 30], title: 'Chair Yoga', formId: 'F_YOGA' }),
    session({ at: [thisMonth[0], thisMonth[1], 4, 9, 30], title: 'Book Club', formId: 'F_BOOK' }),
    // One form, two buildings — covered if EITHER building has a leader row.
    session({ at: [thisMonth[0], thisMonth[1], 5, 9, 30], title: 'Memory Cafe', formId: 'F_CAFE', location: 'Narberth' }),
    session({ at: [thisMonth[0], thisMonth[1], 6, 9, 30], title: 'Memory Cafe', formId: 'F_CAFE', location: 'Ashbridge' }),
    // Lunch is not a program and is not counted either way.
    session({ at: [thisMonth[0], thisMonth[1], 7, 12, 0], title: 'Lunch @ Narberth \u2014 Chx Parm',
      formId: 'F_LUNCH', eventId: `${sandbox.LUNCH_ONLY_EVENT_ID_PREFIX}x|Narberth` }),
    // Next month's row is somebody else's problem, and not this month's number.
    session({ at: [thisMonth[0], thisMonth[1] + 1, 3, 9, 30], title: 'Watercolor', formId: 'F_PAINT' })
  ], sessionMap);

  const realIndex = sandbox.buildProgramLeaderIndex;
  sandbox.buildProgramLeaderIndex = () => ({
    [sandbox.leaderProgramKey('Chair Yoga', 'Narberth')]: [{ name: 'Jane Doe' }],
    // Only the Ashbridge half of the shared program is named.
    [sandbox.leaderProgramKey('Memory Cafe', 'Ashbridge')]: [{ name: 'Sam Reed' }]
  });
  const coverage = sandbox.programMonthLeaderCoverage(built.rows, monthKey);
  sandbox.buildProgramLeaderIndex = realIndex;

  check('coverage counts this month\u2019s programs, lunch excluded', coverage.considered, 3);
  check('and names only the ones nobody is down for', coverage.missing, ['Book Club — Narberth']);

  // With no leader tab at all, every program reads unassigned — which is the
  // honest answer, and the number the tab exists to drive to zero.
  const empty = sandbox.buildProgramLeaderIndex;
  sandbox.buildProgramLeaderIndex = () => ({});
  check('an empty leader tab reports every program this month',
    sandbox.programMonthLeaderCoverage(built.rows, monthKey).missing.length, 3);
  sandbox.buildProgramLeaderIndex = empty;
}

// --- 8. The metrics did not move by a digit ----------------------------------
{
  // The same rows, the same function, the same scan — the block changed which
  // TAB it is drawn on and nothing else. Computed here the way the month tab
  // computes it on the menu path, and compared against the session-row
  // arithmetic 43_program_dashboard.gs has always done.
  const NOW = new Date(2026, 8, 16);
  const rows = [
    session({ at: [2026, 8, 18, 9, 30], eventId: 'yoga', capacity: 10 }),
    session({ at: [2026, 8, 21, 9, 30], eventId: 'taichi', capacity: 4 }),
    session({ at: [2026, 8, 17, 9, 30], eventId: 'coffee', capacity: '--' })
  ];
  const regHeaders = sandbox.HEADERS.Registrant_Dash;
  const regMap = sandbox.getIndexMap(regHeaders);
  const registrants = [];
  const add = (eventId, name) => {
    const row = new Array(regHeaders.length).fill('');
    row[regMap['Event_ID']] = eventId;
    row[regMap['Event_Date']] = new Date(2026, 8, 18);
    row[regMap['Name']] = name;
    row[regMap['Program_Status']] = 'Active';
    registrants.push(row);
  };
  for (let i = 0; i < 8; i++) add('yoga', `Yoga ${i}`);
  for (let i = 0; i < 5; i++) add('taichi', `Tai Chi ${i}`);
  const scan = sandbox.scanRegistrants(null, registrants);
  const metrics = sandbox.computeProgramMetrics(rows, sessionMap, scan, NOW);
  check('the near-term window still counts the same sessions', metrics.windows[0].sessions, 3);
  check('and the same registrations', metrics.windows[0].registrations, 13);
  check('and the same fill over capped sessions only', metrics.windows[0].seatsFilledPct, 93);
}

console.log(failures === 0 ? '\nAll program_month tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
