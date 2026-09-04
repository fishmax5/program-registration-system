// Program_Month is Master_Program_Dashboard's session rows grouped back into
// the unit they were made in — one program, at one location, for one month —
// and the whole tab stands or falls on that grouping being right. This file
// pins it.
//
// The two cases the design called out, and the reason each one matters:
//
//   1. FOUR SESSIONS SHARING ONE Form_ID COLLAPSE TO ONE ROW. Form_ID is the
//      groupKey's identity: a weekly class's four dates carry the same one,
//      and if they did not collapse the month tab would simply be the session
//      tab again with worse columns.
//   2. A BLANK Form_ID FALLS BACK TO title + location + month. That is the
//      [No Registration] case and the hand-added-row case, and the fallback
//      has to carry the month in it — otherwise September's and October's
//      drop-in coffee hours would be one row claiming to be a month.
//
// And the assumption the file's banner states out loud: a FIXED-span group —
// one form for a run of dates crossing months — is filed under its FIRST
// month, once, so nothing on the tab double-counts it.
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
      if (pattern === 'MMMM yyyy') return `${date.getMonth()}-${date.getFullYear()}`;
      if (pattern === 'EEE') return DAYS[date.getDay()];
      if (pattern === 'EEE, MMM d') return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
      if (pattern === 'd') return String(date.getDate());
      if (pattern === 'h:mm a') {
        const h = date.getHours();
        const hour = h % 12 === 0 ? 12 : h % 12;
        return `${hour}:${p(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
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
;this.buildProgramMonthGroups = buildProgramMonthGroups;
this.buildProgramMonthRows = buildProgramMonthRows;
this.programMonthGroupKey = programMonthGroupKey;
this.describeProgramMonthSchedule = describeProgramMonthSchedule;
this.worstProgramMonthStatus = worstProgramMonthStatus;
this.programMonthSessionsCell = programMonthSessionsCell;
this.scanRegistrants = scanRegistrants;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.makeLunchOnlyEventId = makeLunchOnlyEventId;
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
const map = sandbox.getIndexMap(sessionHeaders);
const monthHeaders = sandbox.HEADERS.Program_Month;
const monthMap = sandbox.getIndexMap(monthHeaders);
const regHeaders = sandbox.HEADERS.Registrant_Dash;
const regMap = sandbox.getIndexMap(regHeaders);

/** One session row. `opts` carries whatever this test cares about beyond the basics. */
function session(opts) {
  const row = new Array(sessionHeaders.length).fill('');
  row[map['Event_ID']] = opts.eventId;
  row[map['Event_Date']] = opts.date;
  if (opts.end) row[map['Event_End']] = opts.end;
  row[map['Clean_Title']] = opts.title || '';
  row[map['Location']] = opts.location || 'Narberth';
  row[map['Type_Tag']] = opts.type || 'Regular';
  row[map['Form_ID']] = opts.formId || '';
  row[map['Max_Capacity']] = opts.cap === undefined ? '--' : opts.cap;
  row[map['Status']] = opts.status || '';
  row[map['Active_Count']] = opts.active === undefined ? '' : opts.active;
  row[map['Waitlist_Count']] = opts.waitlist === undefined ? '' : opts.waitlist;
  row[map['Club']] = !!opts.club;
  row[map['No_Registration']] = !!opts.noReg;
  row[map['Personalized_Assistance']] = !!opts.assistance;
  row[map['Form_Response_Link']] = opts.formLink || '';
  return row;
}

function registrant(eventId, date, name, status) {
  const row = new Array(regHeaders.length).fill('');
  row[regMap['Event_ID']] = eventId;
  row[regMap['Event_Date']] = date;
  row[regMap['Name']] = name;
  row[regMap['Program_Status']] = status || 'Active';
  return row;
}

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h === undefined ? 10 : h, min === undefined ? 0 : min);

// ---------------------------------------------------------------------------
// 1. FOUR SESSIONS, ONE Form_ID, ONE ROW
// ---------------------------------------------------------------------------
// Every Tuesday in September, one form, capacity 10 apiece. Six people are
// registered across the four dates and one is waitlisted.
const YOGA = [
  session({ eventId: 'yoga-0901', date: at(2026, 9, 1, 9, 30), end: at(2026, 9, 1, 11, 0), title: 'Chair Yoga', formId: 'FORM-YOGA-SEP', cap: 10, status: '🟢 Open' }),
  session({ eventId: 'yoga-0908', date: at(2026, 9, 8, 9, 30), end: at(2026, 9, 8, 11, 0), title: 'Chair Yoga', formId: 'FORM-YOGA-SEP', cap: 10, status: '🟢 Open' }),
  session({ eventId: 'yoga-0915', date: at(2026, 9, 15, 9, 30), end: at(2026, 9, 15, 11, 0), title: 'Chair Yoga', formId: 'FORM-YOGA-SEP', cap: 10, status: '🟡 Almost Full' }),
  session({ eventId: 'yoga-0922', date: at(2026, 9, 22, 9, 30), end: at(2026, 9, 22, 11, 0), title: 'Chair Yoga', formId: 'FORM-YOGA-SEP', cap: 10, status: '🟢 Open' })
];

const YOGA_REGISTRANTS = [
  registrant('yoga-0901', at(2026, 9, 1), 'Marion Webb'),
  registrant('yoga-0901', at(2026, 9, 1), 'Joe Ricci'),
  registrant('yoga-0908', at(2026, 9, 8), 'Marion Webb'),
  registrant('yoga-0915', at(2026, 9, 15), 'Priya Nair'),
  registrant('yoga-0915', at(2026, 9, 15), 'Ada Kern'),
  registrant('yoga-0922', at(2026, 9, 22), 'Walter Hale'),
  registrant('yoga-0915', at(2026, 9, 15), 'Hopeful Person', 'Waitlisted')
];

const yogaScan = sandbox.scanRegistrants(null, YOGA_REGISTRANTS);
const yogaGroups = sandbox.buildProgramMonthGroups(YOGA, map, yogaScan);

check('four session rows sharing one Form_ID make ONE month row', yogaGroups.length, 1);
check('and the row knows how many sessions it stands for', yogaGroups[0].sessions, 4);
check('grouped on the form, not on the title', yogaGroups[0].key, 'form:FORM-YOGA-SEP');
check('filed under the month its first session falls in',
  [yogaGroups[0].monthStart.getFullYear(), yogaGroups[0].monthStart.getMonth(), yogaGroups[0].monthStart.getDate()],
  [2026, 8, 1]);
check('registrations are summed across the group', yogaGroups[0].registered, 6);
check('and so is the waitlist', yogaGroups[0].waitlist, 1);
check('capacity is the four caps added up', yogaGroups[0].capacity, 40);
// Four identical Tuesday slots compress to the line the tab exists for.
check('a regular weekly class reads as one line',
  sandbox.describeProgramMonthSchedule(yogaGroups[0], map), 'Tue 9:30 AM – 11:00 AM · 4 sessions');
// One amber session among three green ones is an amber group: a program with
// one nearly-full date must not read as wide open.
check('the group takes its WORST session status',
  sandbox.worstProgramMonthStatus(yogaGroups[0]), '🟡 Almost Full');

const yogaRow = sandbox.buildProgramMonthRows(monthHeaders, yogaGroups, map, {})[0];
check('Registered lands on the row', yogaRow[monthMap['Registered']], 6);
check('Fill is a fraction of the capped seats', yogaRow[monthMap['Fill']], 0.15);
check('Program names the class once', yogaRow[monthMap['Program']], 'Chair Yoga');

// A group with no cap anywhere reads BLANK, never 0 / 0% — the same rule the
// metrics block holds to, and for the same reason.
const UNCAPPED = [
  session({ eventId: 'coffee-0902', date: at(2026, 9, 2), title: 'Coffee Hour', formId: 'FORM-COFFEE', cap: '--' }),
  session({ eventId: 'coffee-0909', date: at(2026, 9, 9), title: 'Coffee Hour', formId: 'FORM-COFFEE', cap: '--' })
];
const uncappedRow = sandbox.buildProgramMonthRows(monthHeaders,
  sandbox.buildProgramMonthGroups(UNCAPPED, map, null), map, {})[0];
check('an uncapped group has no capacity rather than zero', uncappedRow[monthMap['Capacity']], '');
check('and no fill rate rather than 0%', uncappedRow[monthMap['Fill']], '');

// ---------------------------------------------------------------------------
// 2. A BLANK Form_ID FALLS BACK TO TITLE + LOCATION + MONTH
// ---------------------------------------------------------------------------
// A [No Registration] drop-in has no form at all. September's two sessions are
// one row; October's is its own, because the fallback key carries the month.
// The same title at another building is a third row — the privacy-and-place
// grain the rest of the workbook keeps.
const DROP_INS = [
  session({ eventId: 'drop-0903', date: at(2026, 9, 3), title: 'Art Room', noReg: true }),
  session({ eventId: 'drop-0910', date: at(2026, 9, 10), title: 'Art Room', noReg: true }),
  session({ eventId: 'drop-1001', date: at(2026, 10, 1), title: 'Art Room', noReg: true }),
  session({ eventId: 'drop-0903-ash', date: at(2026, 9, 3), title: 'Art Room', location: 'Ashbridge', noReg: true })
];
const dropGroups = sandbox.buildProgramMonthGroups(DROP_INS, map, null);
check('a form-less program groups by title, location and month', dropGroups.length, 3);
check('September at Narberth holds both of its sessions',
  dropGroups.filter(g => g.key === 'title:art room|narberth|2026-09')[0].sessions, 2);
check('October is a row of its own', dropGroups.some(g => g.key === 'title:art room|narberth|2026-10'), true);
check('and the other building is not folded into either',
  dropGroups.some(g => g.key === 'title:art room|ashbridge|2026-09'), true);
check('the flag shows on the row as a word, not three tick boxes',
  sandbox.buildProgramMonthRows(monthHeaders, dropGroups, map, {})[0][monthMap['Flags']], 'No sign-up');

// A title typed with different spacing or casing is ONE program, the way it is
// everywhere else in this workbook.
const SLOPPY = [
  session({ eventId: 'a', date: at(2026, 9, 3), title: 'Art Room' }),
  session({ eventId: 'b', date: at(2026, 9, 10), title: 'art  room' })
];
check('casing and stray spaces do not split one program in two',
  sandbox.buildProgramMonthGroups(SLOPPY, map, null).length, 1);

// ---------------------------------------------------------------------------
// 3. A FIXED SPAN IS FILED ONCE, UNDER ITS FIRST MONTH
// ---------------------------------------------------------------------------
// One form, ten weeks, three months touched — the open question the design
// left, answered here (see the banner in 77_program_month_dashboard.gs).
const COURSE = [
  session({ eventId: 'course-0908', date: at(2026, 9, 8, 13, 0), end: at(2026, 9, 8, 15, 0), title: 'Watercolor Course', formId: 'FORM-COURSE', cap: 12, active: 9 }),
  session({ eventId: 'course-1013', date: at(2026, 10, 13, 13, 0), end: at(2026, 10, 13, 15, 0), title: 'Watercolor Course', formId: 'FORM-COURSE', cap: 12, active: 9 }),
  session({ eventId: 'course-1110', date: at(2026, 11, 10, 13, 30), end: at(2026, 11, 10, 15, 30), title: 'Watercolor Course', formId: 'FORM-COURSE', cap: 12, active: 9 })
];
const courseGroups = sandbox.buildProgramMonthGroups(COURSE, map, null);
check('a fixed-span course is ONE row, not one per month it touches', courseGroups.length, 1);
check('filed under its first month',
  [courseGroups[0].monthStart.getFullYear(), courseGroups[0].monthStart.getMonth()], [2026, 8]);
// Filing once is what keeps the arithmetic honest: nine registrations are
// counted nine times, not twenty-seven.
check('its registrations are counted once', courseGroups[0].registered, 27);
check('the row says the real span out loud rather than hiding it',
  sandbox.describeProgramMonthSchedule(courseGroups[0], map), '3 sessions · Sep 8 – Nov 10 · times vary');
check('and it is marked as crossing months, which is what earns it a note',
  courseGroups[0].spansMonths, true);

// ---------------------------------------------------------------------------
// 4. LUNCH: ONE ROW PER LOCATION PER MONTH
// ---------------------------------------------------------------------------
// A month of lunches at one building is one form and, on this tab, one line.
// The row must NOT name itself after a day's dish — the title carries one and
// it changes whenever somebody retypes the menu.
const LUNCH = [1, 2, 3].map(day => session({
  eventId: sandbox.makeLunchOnlyEventId(`2026-09-0${day}`, 'Narberth'),
  date: at(2026, 9, day, 12, 0),
  title: `Lunch @ Narberth — Dish ${day}`,
  formId: 'FORM-LUNCH-NARB-SEP'
}));
const lunchGroups = sandbox.buildProgramMonthGroups(LUNCH, map, null);
check('a month of lunches at one building is one row', lunchGroups.length, 1);
check('named for the building, never for a day’s dish',
  sandbox.buildProgramMonthRows(monthHeaders, lunchGroups, map, {})[0][monthMap['Program']], 'Lunch @ Narberth');
check('and counted in days rather than in a weekly slot',
  sandbox.describeProgramMonthSchedule(lunchGroups[0], map), '3 days · Sep 1–3');

// ---------------------------------------------------------------------------
// 5. ONE FORM ACROSS TWO LOCATIONS IS ONE ROW THAT SAYS SO
// ---------------------------------------------------------------------------
const SHARED = [
  session({ eventId: 'shared-a', date: at(2026, 9, 4), title: 'Memory Cafe', location: 'Narberth', formId: 'FORM-SHARED' }),
  session({ eventId: 'shared-b', date: at(2026, 9, 11), title: 'Memory Cafe', location: 'Ashbridge', formId: 'FORM-SHARED' })
];
const sharedRow = sandbox.buildProgramMonthRows(monthHeaders,
  sandbox.buildProgramMonthGroups(SHARED, map, null), map, {})[0];
check('a shared form is one row naming both buildings',
  sharedRow[monthMap['Location']], 'Narberth + Ashbridge');

// ---------------------------------------------------------------------------
// 6. THE SESSIONS CELL DRILLS THROUGH — and degrades to plain text
// ---------------------------------------------------------------------------
check('the Sessions cell links at the group’s own block of day rows',
  sandbox.programMonthSessionsCell(yogaGroups[0], 1234, { 'yoga-0901': 57 }),
  '=HYPERLINK("#gid=1234&range=A57","4 sessions")');
check('and is plain words when the row cannot be located',
  sandbox.programMonthSessionsCell(yogaGroups[0], 1234, {}), '4 sessions');
check('or when there is no session tab to point at',
  sandbox.programMonthSessionsCell(yogaGroups[0], null, { 'yoga-0901': 57 }), '4 sessions');

// ---------------------------------------------------------------------------
// 7. THE WHOLE SET AT ONCE, ORDERED
// ---------------------------------------------------------------------------
const ALL = YOGA.concat(DROP_INS, COURSE, LUNCH, SHARED);
const allGroups = sandbox.buildProgramMonthGroups(ALL, map, yogaScan);
check('every session row lands in exactly one group',
  allGroups.reduce((sum, g) => sum + g.sessions, 0), ALL.length);
check('and the rows come out oldest month first',
  allGroups.map(g => g.monthStart.getMonth()).every((m, i, list) => i === 0 || m >= list[i - 1]), true);

console.log(failures === 0 ? '\nAll program-month checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
