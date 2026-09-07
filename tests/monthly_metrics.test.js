// THE METRICS TAB: one stored row per month, and the year-over-year block
// built on top of it.
//
// What this file pins is the property the whole design rests on — that a
// month whose registrant rows have been archived is LEFT ALONE rather than
// recounted to zero. Everything else here (the counting, the sum-vs-average
// split, the arrow) is arithmetic; that one is the difference between a
// comparison and an invented collapse.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      if (pattern === 'MMMM yyyy') return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
      if (pattern === 'MMM d') return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
      if (pattern === 'd') return String(date.getDate());
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
;this.computeMonthlyMetrics = computeMonthlyMetrics;
this.metricsFirstMonthByPerson = metricsFirstMonthByPerson;
this.metricsMonthsPresent = metricsMonthsPresent;
this.mergeMetricsRows = mergeMetricsRows;
this.buildYearOverYearSummary = buildYearOverYearSummary;
this.metricsShiftMonthKey = metricsShiftMonthKey;
this.metricsMonthLabel = metricsMonthLabel;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const sessionHeaders = sandbox.HEADERS.All_Program_Sessions;
const sessionMap = sandbox.getIndexMap(sessionHeaders);
const regHeaders = sandbox.HEADERS.All_Registrants;
const regMap = sandbox.getIndexMap(regHeaders);
const metricHeaders = sandbox.HEADERS.Metrics;
const metricMap = sandbox.getIndexMap(metricHeaders);

function session(id, y, m, d, title, opts) {
  opts = opts || {};
  const row = new Array(sessionHeaders.length).fill('');
  row[sessionMap['Event_ID']] = id;
  row[sessionMap['Event_Date']] = new Date(y, m - 1, d);
  row[sessionMap['Clean_Title']] = title;
  row[sessionMap['Location']] = opts.location || 'Narberth';
  row[sessionMap['Max_Capacity']] = opts.cap === undefined ? '--' : opts.cap;
  row[sessionMap['No_Registration']] = opts.noReg ? true : false;
  row[sessionMap['Club']] = opts.club ? true : false;
  row[sessionMap['Personalized_Assistance']] = opts.assistance ? true : false;
  return row;
}

function registrant(eventId, y, m, d, name, opts) {
  opts = opts || {};
  const row = new Array(regHeaders.length).fill('');
  row[regMap['Event_ID']] = eventId;
  row[regMap['Event_Date']] = new Date(y, m - 1, d);
  row[regMap['Event']] = opts.event || 'Chair Yoga';
  row[regMap['Name']] = name;
  row[regMap['Program_Status']] = opts.status || 'Active';
  row[regMap['Attended']] = opts.attended ? true : '';
  row[regMap['Person_Type']] = opts.personType || 'Attendee';
  row[regMap['Lunch_Status']] = opts.lunch || '';
  row[regMap['Meals_Ordered']] = opts.meals === undefined ? '' : opts.meals;
  row[regMap['Lunch_Served']] = opts.served ? true : '';
  row[regMap['Day1_Dined_In']] = opts.dinedIn === undefined ? '' : opts.dinedIn;
  return row;
}

// "Today" is 2026-09-16, so August is complete and September is mid-flight.
const NOW = new Date(2026, 8, 16);

// ---------------------------------------------------------------------------
// 1. COUNTING ONE MONTH
// ---------------------------------------------------------------------------
// August 2026: three program sessions (one capped Chair Yoga, one uncapped
// [No Registration] Coffee Hour, one Book Club tagged as a club) plus one
// generated lunch row, which is a meal and not a program.
const SESSIONS = [
  session('yoga-0805', 2026, 8, 5, 'Chair Yoga', { cap: 10 }),
  session('coffee-0812', 2026, 8, 12, 'Coffee Hour', { noReg: true }),
  session('book-0819', 2026, 8, 19, 'Book Club', { cap: 6, club: true }),
  session('LUNCHONLY:2026-08-20|Narberth', 2026, 8, 20, 'Lunch @ Narberth — Chx Parm'),
  session('yoga-0902', 2026, 9, 2, 'Chair Yoga', { cap: 10 })
];

const REGISTRANTS = [
  // Chair Yoga: six active (two of them ticked present), one waitlisted, one cancelled.
  registrant('yoga-0805', 2026, 8, 5, 'Ann Adams', { attended: true, lunch: 'Needed', meals: 2, served: true, dinedIn: 2 }),
  registrant('yoga-0805', 2026, 8, 5, 'Ben Brooks', { attended: true, lunch: 'Needed', served: true, dinedIn: 1 }),
  registrant('yoga-0805', 2026, 8, 5, 'Cara Cole'),
  registrant('yoga-0805', 2026, 8, 5, 'Dan Diaz'),
  registrant('yoga-0805', 2026, 8, 5, 'Eve Ellis'),
  registrant('yoga-0805', 2026, 8, 5, 'Guest Of Ann', { personType: 'Guest' }),
  registrant('yoga-0805', 2026, 8, 5, 'Hopeful Hall', { status: 'Waitlisted' }),
  registrant('yoga-0805', 2026, 8, 5, 'Gone Green', { status: 'Cancelled' }),
  // Book Club: two active, both of whom were also at yoga.
  registrant('book-0819', 2026, 8, 19, 'Ann Adams', { event: 'Book Club' }),
  registrant('book-0819', 2026, 8, 19, 'Cara Cole', { event: 'Book Club' }),
  // A lunch with no program behind it.
  registrant('LUNCHONLY:2026-08-20|Narberth', 2026, 8, 20, 'Ann Adams',
    { event: 'Lunch @ Narberth — Chx Parm', lunch: 'Needed', served: true, dinedIn: 1 }),
  // September, so it must not land in August's row.
  registrant('yoga-0902', 2026, 9, 2, 'Ann Adams', { attended: true })
];

const source = {
  sessionRows: SESSIONS, sessionMap: sessionMap,
  registrantRows: REGISTRANTS, registrantMap: regMap
};
const firstMonths = sandbox.metricsFirstMonthByPerson(REGISTRANTS, regMap);
const august = sandbox.computeMonthlyMetrics('2026-08', source, firstMonths, NOW);

check('the lunch row is a lunch, not a program session', [august.Sessions, august.Lunch_Sessions], [3, 1]);
check('distinct programs and locations', [august.Programs, august.Locations], [3, 1]);
check('the club and drop-in split', [august.Club_Sessions, august.Drop_In_Sessions], [1, 1]);
check('active registrations exclude waitlist and cancellations',
  [august.Registrations, august.Waitlisted, august.Cancellations], [9, 1, 1]);
check('a guest is a registration and is also counted as a guest', august.Guests, 1);
check('distinct participants, not registrations', august.Participants, 6);
// Everyone's first month in this workbook is August, so all six are new.
check('new people', august.New_People, 6);
check('the lunch-only sign-up is counted as one', august.Lunch_Only_Signups, 1);
// Two of the nine were ticked; every August session is in the past.
check('attendance is a fraction of past registrations', august.Attendance_Rate, 0.22);
// Capped: yoga 10 seats/6 taken, book club 6/2. The uncapped coffee hour is out.
check('seats filled across capped sessions only', august.Seats_Filled_Rate, 0.5);
check('empty seats', august.Empty_Seats, 8);
// Registrations ÷ the sessions that take registration (yoga + book club).
check('average per session leaves the drop-in out of the divisor', august.Avg_Per_Session, 4.5);
check('meals: ordered counts Meals_Ordered, served counts people',
  [august.Meals_Ordered, august.Meals_Served, august.Meals_Consumed], [4, 3, 4]);
check('the month is labelled for a person', august.Month_Label, 'August 2026');

// September is mid-flight: its one session is on the 2nd, which HAS happened.
const september = sandbox.computeMonthlyMetrics('2026-09', source, firstMonths, NOW);
check('September counts only its own rows', [september.Sessions, september.Registrations], [1, 1]);
check('a September participant first seen in August is not new', september.New_People, 0);

// ---------------------------------------------------------------------------
// 2. A MONTH WITH NOTHING BEHIND IT IS NOT A MONTH OF ZEROS
// ---------------------------------------------------------------------------
// This is the property the tab exists for. August 2025's rows have long since
// been archived; counting it now finds nothing, and "nothing" must come back
// as null so the stored row survives.
check('an archived month recounts to null, not to zero',
  sandbox.computeMonthlyMetrics('2025-08', source, firstMonths, NOW), null);

check('months present are the ones with rows, newest first',
  sandbox.metricsMonthsPresent(source), ['2026-09', '2026-08']);

// ---------------------------------------------------------------------------
// 3. MERGING INTO THE STORED ROWS
// ---------------------------------------------------------------------------
function storedRow(monthKey, values) {
  const row = metricHeaders.map(h => (values[h] === undefined ? '' : values[h]));
  row[metricMap['Month']] = monthKey;
  row[metricMap['Month_Label']] = sandbox.metricsMonthLabel(monthKey);
  return row;
}

const stored = [
  storedRow('2025-08', { Sessions: 40, Registrations: 300, Participants: 90, New_People: 12,
    Attendance_Rate: 0.7, Waitlisted: 4, Cancellations: 3, Club_Sessions: 6,
    Meals_Ordered: 200, Meals_Served: 190, Lunch_Only_Signups: 20, Notes: 'heat wave' }),
  storedRow('2026-08', { Sessions: 1, Registrations: 1, Notes: 'captured mid-import' })
];

const merged = sandbox.mergeMetricsRows(stored, [august, null]);
check('the recounted month replaces its stored numbers',
  merged.filter(r => r[metricMap['Month']] === '2026-08')[0][metricMap['Sessions']], 3);
check('a staff note survives the recount',
  merged.filter(r => r[metricMap['Month']] === '2026-08')[0][metricMap['Notes']], 'captured mid-import');
check('a month that was not recounted keeps every number it had',
  merged.filter(r => r[metricMap['Month']] === '2025-08')[0][metricMap['Registrations']], 300);
check('rows come back oldest first', merged.map(r => r[metricMap['Month']]), ['2025-08', '2026-08']);

// ---------------------------------------------------------------------------
// 4. YEAR OVER YEAR
// ---------------------------------------------------------------------------
// Twelve months of both periods, so the totals are not a question of coverage.
// Sep 2025 – Aug 2026 is the recent period on 2026-09-16 (the month RUNNING is
// left out); Sep 2024 – Aug 2025 is the prior one.
const history = [];
for (let i = 0; i < 24; i++) {
  const monthKey = sandbox.metricsShiftMonthKey('2026-08', -i);
  const recent = i < 12;
  history.push(storedRow(monthKey, {
    Sessions: recent ? 10 : 8,
    Registrations: recent ? 100 : 80,
    Participants: recent ? 40 : 35,
    New_People: recent ? 5 : 5,
    Attendance_Rate: recent ? 0.75 : 0.6,
    Seats_Filled_Rate: '',
    Waitlisted: recent ? 2 : 1,
    Cancellations: 1,
    Club_Sessions: 2,
    Meals_Ordered: 50, Meals_Served: 45, Lunch_Only_Signups: 5
  }));
}
// September 2026 so far, plus the September before it, for the month line.
history.push(storedRow('2026-09', { Sessions: 4, Registrations: 30, Attendance_Rate: 0.8 }));

const summary = sandbox.buildYearOverYearSummary(history, NOW);
check('the twelve-month period ends with the month just gone',
  summary.currentLabel, 'September 2025 – August 2026');
check('the prior period is the twelve before that',
  summary.priorLabel, 'September 2024 – August 2025');
check('both periods are fully covered',
  [summary.monthsCovered, summary.priorMonthsCovered], [12, 12]);

const byLabel = {};
summary.indicators.forEach(i => { byLabel[i.label] = i; });
check('counts are summed across the period',
  [byLabel['Sessions held'].current, byLabel['Sessions held'].previous], [120, 96]);
check('a rate is averaged, not summed',
  [byLabel['Attendance rate'].current, byLabel['Attendance rate'].previous], [75, 60]);
check('a rate with no month reporting it reads as nothing at all',
  byLabel['Seats filled'].current, null);

const thisMonth = {};
summary.thisMonth.forEach(i => { thisMonth[i.label] = i; });
check('this month is compared against the same month a year ago',
  [summary.thisMonthLabel, summary.yearAgoLabel], ['September 2026', 'September 2025']);
check('the month line reads the two rows it names',
  [thisMonth['Registrations'].current, thisMonth['Registrations'].previous], [30, 100]);

// A period with a month missing from the store must not read as a zero month:
// it reads low, and monthsCovered is what says so.
const sparse = history.filter(r => r[metricMap['Month']] !== '2026-03');
const sparseSummary = sandbox.buildYearOverYearSummary(sparse, NOW);
check('a missing month lowers the coverage count, not the average',
  [sparseSummary.monthsCovered,
    sparseSummary.indicators.filter(i => i.label === 'Attendance rate')[0].current], [11, 75]);
check('and its counts simply are not there', 
  sparseSummary.indicators.filter(i => i.label === 'Sessions held')[0].current, 110);

console.log(failures === 0 ? '\nAll monthly metrics checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
