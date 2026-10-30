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
this.kitchenOrdersForMonth = kitchenOrdersForMonth;
this.getIndexMap = getIndexMap;
this.readStoredMetricsRows = readStoredMetricsRows;
this.metricsSummaryLayout_ = metricsSummaryLayout_;
this.metricsSiteBlockRows_ = metricsSiteBlockRows_;
this.MANUAL_ENTRY_PREFIX = MANUAL_ENTRY_PREFIX;
this.MEMBER_ROLL_HEADERS = HEADERS.Member_Roll;
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

// --- Lunches ordered from the kitchen ---------------------------------------
// Summed off Actual_Ordered on the lunch dashboard: the number an invoice is
// checked against. A blank cell is "not written down yet", never zero.
{
  const lunchHeaders = sandbox.HEADERS.Master_Lunch_Dashboard;
  const lMap = sandbox.getIndexMap(lunchHeaders);
  const lunchRow = (y, m, d, location, ordered, plan) => {
    const row = new Array(lunchHeaders.length).fill('');
    row[lMap['Event_Date']] = new Date(y, m - 1, d);
    row[lMap['Location']] = location;
    row[lMap['Actual_Ordered']] = ordered;
    row[lMap['Total_to_Order']] = plan || 99;
    return row;
  };
  const rows = [
    lunchRow(2026, 9, 1, 'Narberth', 20),
    lunchRow(2026, 9, 2, 'Narberth', '18'),
    lunchRow(2026, 9, 2, 'Ashbridge', 7),
    lunchRow(2026, 9, 3, 'Narberth', ''),      // not typed: no day, no meals, and NOT the plan
    lunchRow(2026, 10, 1, 'Narberth', 25)      // another month
  ];
  const sept = sandbox.kitchenOrdersForMonth('2026-09', rows, lMap);
  check('kitchen orders sum the typed numbers only', [sept.total, sept.days], [45, 3]);
  check('and split them by building', sept.byLocation, 'Ashbridge 7 · Narberth 38');
  const empty = sandbox.kitchenOrdersForMonth('2026-08', rows, lMap);
  check('a month with nothing typed is blank, not zero', [empty.total, empty.days], ['', '']);

  const withKitchen = Object.assign({}, source, { lunchDashboardRows: rows, lunchDashboardMap: lMap });
  const septMetrics = sandbox.computeMonthlyMetrics('2026-09', withKitchen, firstMonths, NOW);
  check('the month row carries the kitchen total',
    [septMetrics.Kitchen_Ordered, septMetrics.Kitchen_Order_Days], [45, 3]);
  check('a month known only from the lunch dashboard is still listed',
    sandbox.metricsMonthsPresent(withKitchen).indexOf('2026-10') !== -1, true);
}


// ---------------------------------------------------------------------------
// 5. THE SAME MONTH, BUILDING BY BUILDING
// ---------------------------------------------------------------------------
// Ashbridge and Narberth in August 2026. Ann comes to both buildings, so she is
// one participant at the centre and one at each building — the buildings
// legitimately add up to MORE than the whole, and the summary says so.
{
  const at = (row, location) => { row[regMap['Location']] = location; return row; };
  const sess = (id, d, title, location, opts) => {
    const row = session(id, 2026, 8, d, title, Object.assign({ location: location }, opts || {}));
    return row;
  };
  const sessions = [
    sess('n-yoga', 5, 'Chair Yoga', 'Narberth', { cap: 4 }),     // 4 of 4: full
    sess('a-tai', 6, 'Tai Chi', 'Ashbridge', { cap: 10 }),        // 1 of 10: under half
    sess('a-club', 7, 'Mah Jongg', 'Ashbridge', { cap: 8, club: true }),
    sess('a-help', 8, 'Computer Help', 'Ashbridge', { assistance: true })
  ];
  const regs = [
    at(registrant('n-yoga', 2026, 8, 5, 'Ann Adams', { attended: true }), 'Narberth'),
    at(registrant('n-yoga', 2026, 8, 5, 'Ben Brooks', { attended: true }), 'Narberth'),
    at(registrant('n-yoga', 2026, 8, 5, 'Cara Cole'), 'Narberth'),
    at(registrant('n-yoga', 2026, 8, 5, 'Dan Diaz'), 'Narberth'),
    at(registrant('n-yoga', 2026, 8, 5, 'Wait Ing', { status: 'Waitlisted' }), 'Narberth'),
    at(registrant('a-tai', 2026, 8, 6, 'Ann Adams', { attended: true }), 'Ashbridge'),
    at(registrant('a-club', 2026, 8, 7, 'Eve Ellis', { attended: true }), 'Ashbridge'),
    at(registrant('a-help', 2026, 8, 8, 'Eve Ellis'), 'Ashbridge'),
    // July: Ann and Ben were here; Eve was not. Ann at Narberth only.
    at(registrant('n-jul', 2026, 7, 9, 'Ann Adams'), 'Narberth'),
    at(registrant('n-jul', 2026, 7, 9, 'Ben Brooks'), 'Narberth'),
    // May: Fay came, and has not been seen since — lapsing at the end of August.
    // Ann also came in May and is still coming.
    at(registrant('n-may', 2026, 5, 5, 'Fay Fox'), 'Narberth'),
    at(registrant('n-may', 2026, 5, 5, 'Ann Adams'), 'Narberth')
  ];
  const roll = (name, first, status, retired, locations) => {
    const row = new Array(sandbox.MEMBER_ROLL_HEADERS.length).fill('');
    const m = sandbox.getIndexMap(sandbox.MEMBER_ROLL_HEADERS);
    row[m['Name']] = name; row[m['First_Seen']] = first; row[m['Status']] = status;
    row[m['Retired_Date']] = retired; row[m['Locations']] = locations;
    return row;
  };
  const siteSource = {
    sessionRows: sessions, sessionMap: sessionMap,
    registrantRows: regs, registrantMap: regMap,
    memberMap: sandbox.getIndexMap(sandbox.MEMBER_ROLL_HEADERS),
    memberRows: [
      roll('Ann Adams', new Date(2025, 0, 10), 'Active', '', 'Narberth, Ashbridge'),
      roll('Ben Brooks', new Date(2025, 5, 1), 'Active', '', 'Narberth'),
      roll('Eve Ellis', new Date(2026, 7, 3), 'Active', '', 'Ashbridge'),     // added in August
      roll('Old Timer', new Date(2024, 0, 1), 'Retired', new Date(2026, 7, 20), 'Narberth'), // retired in August
      roll('Gone Long', new Date(2024, 0, 1), 'Retired', new Date(2025, 1, 1), 'Narberth')   // retired last year
    ]
  };
  const firsts = sandbox.metricsFirstMonthByPerson(regs, regMap);
  const aug = sandbox.computeMonthlyMetrics('2026-08', siteSource, firsts, NOW);
  const bySite = JSON.parse(aug.By_Site);

  check('both buildings get a figure', Object.keys(bySite).sort(), ['Ashbridge', 'Narberth']);
  check('sessions are counted where they were held',
    [bySite.Narberth.Sessions, bySite.Ashbridge.Sessions, aug.Sessions], [1, 3, 4]);
  check('registrations per building add up to the whole',
    [bySite.Narberth.Registrations, bySite.Ashbridge.Registrations, aug.Registrations], [4, 3, 7]);
  check('a person at both buildings is one participant at the centre and one at each',
    [aug.Participants, bySite.Narberth.Participants, bySite.Ashbridge.Participants], [5, 4, 2]);
  check('a building with no capped waitlist trouble has no waitlist key stored',
    [bySite.Narberth.Waitlisted, bySite.Ashbridge.Waitlisted], [1, 0]);
  check('the whole-centre row is not changed by also counting buildings',
    [aug.Waitlisted, aug.Cancellations], [1, 0]);

  // --- demand ---
  check('a capped session with every seat taken filled', [aug.Sessions_Full, bySite.Narberth.Sessions_Full], [1, 1]);
  check('a capped session under half full is counted',
    [aug.Sessions_Under_Half, bySite.Ashbridge.Sessions_Under_Half], [2, 2]);
  check('no-shows are registered, past, and not ticked — once anybody was ticked',
    [aug.No_Shows, bySite.Narberth.No_Shows], [3, 2]);
  check('waitlist share is turned away over everyone who asked',
    [aug.Waitlist_Share, bySite.Narberth.Waitlist_Share], [0.13, 0.2]);
  check('club and assistance registrations follow the session',
    [aug.Club_Registrations, aug.Assistance_Registrations], [1, 1]);

  // --- coming back ---
  // July had Ann and Ben; August has Ann, Ben, Cara, Dan, Eve → 2 of 5.
  check('returning people are last month\'s share of this month\'s',
    [aug.Returning_Rate, bySite.Narberth.Returning_Rate], [0.4, 0.5]);
  check('a building with nobody the month before has no returning figure',
    bySite.Ashbridge.Returning_Rate, undefined);
  check('visits per person', aug.Visits_Per_Person, 1.4);
  // End of Aug 31: last 90 days start after Jun 2; the 90 before are Mar 4–Jun 2.
  // Fay was seen in May and not since; Ann was seen in both.
  check('lapsing people were seen before and not lately', [aug.Lapsing_People, bySite.Narberth.Lapsing_People], [1, 1]);
  check('the first month has nobody to lapse', sandbox.computeMonthlyMetrics('2026-05', siteSource, firsts, NOW).Lapsing_People, '');

  // --- the roll ---
  // End of August: Ann, Ben, Eve and Old Timer (retired the 20th, so gone by the 31st) → 3.
  check('the roll at month end leaves out who retired in the month',
    [aug.Roll_Size, aug.Roll_Added, aug.Roll_Retired], [3, 1, 1]);
  check('the roll by building uses the buildings listed against each person',
    [bySite.Narberth.Roll_Size, bySite.Ashbridge.Roll_Size], [2, 2]);
  check('no roll at all is blank, not an empty roll',
    sandbox.computeMonthlyMetrics('2026-08',
      Object.assign({}, siteSource, { memberRows: null, __metricsContext: undefined }), firsts, NOW).Roll_Size, '');

  // --- the summary reads By_Site back ---
  const rowFor = metrics => metricHeaders.map(h => (metrics[h] === undefined ? '' : metrics[h]));
  const stored2 = [rowFor(aug)];
  const sum2 = sandbox.buildYearOverYearSummary(stored2, new Date(2026, 8, 16));
  check('the summary names the buildings its stored rows know', sum2.sites, ['Ashbridge', 'Narberth']);
  const regsInd = sum2.indicators.filter(i => i.label === 'Registrations')[0];
  check('a building\'s twelve-month figure reads its own slice',
    [regsInd.current, regsInd.sites.Narberth.current, regsInd.sites.Ashbridge.current], [7, 4, 3]);
  const rollInd = sum2.indicators.filter(i => i.label === 'People on the roll')[0];
  check('a stock is the last month with one, not a sum', rollInd.current, 3);
  const progInd = sum2.indicators.filter(i => i.label === 'Programs offered (per month)')[0];
  check('a per-month count is averaged', progInd.current, 4);
  check('a month stored before buildings were counted has none to show',
    sandbox.buildYearOverYearSummary([storedRow('2026-08', { Registrations: 9 })], new Date(2026, 8, 16)).sites, []);

  // --- the by-building block ---
  const block = sandbox.metricsSiteBlockRows_(stored2);
  check('the by-building block has a row per month per building', block.rows.map(r => r.slice(0, 2)),
    [['2026-08', 'Ashbridge'], ['2026-08', 'Narberth']]);
  check('and its columns line up with its headers',
    block.rows[1][block.headers.indexOf('Registrations')], 4);

  // --- the layout the early write counts on ---
  const layout = sandbox.metricsSummaryLayout_(sum2.indicators);
  check('every group is a heading row and every indicator one row',
    [layout.filter(e => e.divider).length, layout.filter(e => e.indicator).length],
    [6, sum2.indicators.length]);
}

// ---------------------------------------------------------------------------
// 6. READING THE HISTORY BACK OFF A TAB THAT HAS SUMMARIES ABOVE IT
// ---------------------------------------------------------------------------
// The history sits under a banner and two summary tables, and the by-building
// block sits under it. It used to be read from row 2, which is blank, so every
// column projected to "not on the sheet" and EVERY stored month read back empty:
// a recount then merged into nothing and dropped the months it could not count.
{
  const blank = new Array(metricHeaders.length).fill('');
  const monthRow = (key, values) => {
    const row = blank.slice();
    row[metricMap['Month']] = key;
    row[metricMap['Month_Label']] = sandbox.metricsMonthLabel(key);
    Object.keys(values).forEach(h => { row[metricMap[h]] = values[h]; });
    return row;
  };
  const header = metricHeaders.slice();
  header[metricMap['Notes']] = `${sandbox.MANUAL_ENTRY_PREFIX} Notes`;
  const pad = row => row.concat(new Array(Math.max(0, metricHeaders.length - row.length)).fill(''));
  const grid = [
    pad(['📈 Metrics — Year Over Year']),
    pad([]),
    pad(['Indicator', 'Last 12 months', 'Prior 12 months', 'Change']),
    pad(['Sessions held', 120, 96, '▲ 24']),
    pad([]),
    pad(['📅 Month by month']),
    header,
    monthRow('2026-08', { Sessions: 3, Registrations: 9, Notes: 'heat wave' }),
    monthRow('2025-08', { Sessions: 40, Registrations: 300 }),
    pad([]),
    pad(['📍 Month by month, by building']),
    pad(['Month', 'Site', 'Sessions']),
    pad(['2026-08', 'Narberth', 3])
  ];
  const sheet = {
    getName: () => 'Metrics',
    getLastRow: () => grid.length,
    getLastColumn: () => metricHeaders.length,
    getRange: (r, c, nr, nc) => ({ getValues: () => grid.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)) })
  };
  const read = sandbox.readStoredMetricsRows(sheet);
  check('the history is found under the summaries and stops before the by-building block',
    read.map(r => r[metricMap['Month']]), ['2025-08', '2026-08']);
  check('its columns are read by name, whatever order the tab has them in',
    [read[1][metricMap['Registrations']], read[1][metricMap['Notes']], read[0][metricMap['Sessions']]], [9, 'heat wave', 40]);
  check('a tab with no history header reads as empty', sandbox.readStoredMetricsRows(
    { getName: () => 'Metrics', getLastRow: () => 1, getLastColumn: () => 4,
      getRange: () => ({ getValues: () => [['hello', '', '', '']] }) }), []);
}

console.log(failures === 0 ? '\nAll monthly metrics checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
