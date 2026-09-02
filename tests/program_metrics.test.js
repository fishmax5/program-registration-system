// The dashboard's metrics block used to report five running totals — Total
// Programs, Total Sessions, Total Registrations, Unique Participants, Avg Fill
// Rate — computed over every row the workbook had ever held. Every one of them
// was true and none could be acted on: they only ever went up, and the fill
// rate averaged settled past sessions against sessions six months out that
// nobody had been told about yet.
//
// What replaced them is two period-bounded tables, and this file pins the
// arithmetic of both against a fixed calendar:
//
//   1. THE NEAR-TERM WINDOWS — next 7 and next 30 days: how full, how many
//      chairs left, how many people being turned away.
//   2. MONTH OVER MONTH — this month SO FAR against the SAME SPAN of last
//      month, so a comparison run on the 14th is a fortnight against a
//      fortnight rather than against a whole month.
const vm = require('vm');

// The whole project, in the order Apps Script evaluates it. This test was
// written against the single Code.gs and read that file directly; the source
// is now sixty-odd numbered files and the helper is what knows to concatenate
// them in filename order — the same rule the runtime applies.
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
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
;this.scanRegistrants = scanRegistrants;
this.computeProgramMetrics = computeProgramMetrics;
this.formatMetricChange = formatMetricChange;
this.sessionCapacity = sessionCapacity;
this.sessionTakesRegistration = sessionTakesRegistration;
this.describeDateSpan = describeDateSpan;
this.monthSpanThroughDay = monthSpanThroughDay;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
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
const regHeaders = sandbox.HEADERS.Registrant_Dash;
const regMap = sandbox.getIndexMap(regHeaders);

/** A session row: date, title, capacity ('--' for uncapped), and an optional [No Registration] tick. */
function session(id, y, m, d, title, cap, noReg) {
  const row = new Array(sessionHeaders.length).fill('');
  row[sessionMap['Event_ID']] = id;
  row[sessionMap['Event_Date']] = new Date(y, m - 1, d);
  row[sessionMap['Clean_Title']] = title;
  row[sessionMap['Location']] = 'Narberth';
  row[sessionMap['Max_Capacity']] = cap;
  row[sessionMap['No_Registration']] = noReg ? true : false;
  return row;
}

/** A registrant row against a session, with its own date (which is what the month history is built from). */
function registrant(eventId, y, m, d, name, status, attended) {
  const row = new Array(regHeaders.length).fill('');
  row[regMap['Event_ID']] = eventId;
  row[regMap['Event_Date']] = new Date(y, m - 1, d);
  row[regMap['Name']] = name;
  row[regMap['Program_Status']] = status || 'Active';
  row[regMap['Attended']] = attended === undefined ? '' : attended;
  return row;
}

// "Today" throughout is Wednesday 2026-09-16, so this month so far is Sep 1–16
// and the like-for-like comparison is Aug 1–16.
const NOW = new Date(2026, 8, 16);

// ---------------------------------------------------------------------------
// 1. THE NEAR-TERM WINDOWS
// ---------------------------------------------------------------------------
// Inside 7 days: a capped Chair Yoga (cap 10, 8 signed up), a capped Tai Chi
// (cap 4, 5 signed up — over its cap, with one waitlisted), and an uncapped
// Coffee Hour. Days 8–30 add one more capped session. Beyond 30 days sits a
// session nobody has registered for yet, which is exactly the row the old
// all-time fill rate used to drag every number down with.
const WINDOW_SESSIONS = [
  session('yoga-0918', 2026, 9, 18, 'Chair Yoga', 10),
  session('taichi-0921', 2026, 9, 21, 'Tai Chi', 4),
  session('coffee-0917', 2026, 9, 17, 'Coffee Hour', '--'),
  session('wills-1005', 2026, 10, 5, 'Low-Cost Wills', 6),
  session('bingo-1120', 2026, 11, 20, 'Bingo', 40)
];

const WINDOW_REGISTRANTS = [];
for (let i = 0; i < 8; i++) WINDOW_REGISTRANTS.push(registrant('yoga-0918', 2026, 9, 18, `Yoga Person ${i}`));
for (let i = 0; i < 5; i++) WINDOW_REGISTRANTS.push(registrant('taichi-0921', 2026, 9, 21, `Tai Chi Person ${i}`));
WINDOW_REGISTRANTS.push(registrant('taichi-0921', 2026, 9, 21, 'Hopeful Person', 'Waitlisted'));
for (let i = 0; i < 3; i++) WINDOW_REGISTRANTS.push(registrant('coffee-0917', 2026, 9, 17, `Coffee Person ${i}`));
for (let i = 0; i < 2; i++) WINDOW_REGISTRANTS.push(registrant('wills-1005', 2026, 10, 5, `Wills Person ${i}`));

const windowScan = sandbox.scanRegistrants(null, WINDOW_REGISTRANTS);
const windowMetrics = sandbox.computeProgramMetrics(WINDOW_SESSIONS, sessionMap, windowScan, NOW);
const next7 = windowMetrics.windows[0];
const next30 = windowMetrics.windows[1];

// Sep 16 + 6 = Sep 22, so the 18th and 21st are in and the 17th is too.
check('next 7 days says where it stops', next7.label, 'Next 7 days (thru Sep 22)');
check('next 7 days counts three sessions', next7.sessions, 3);
check('next 7 days counts every active registration', next7.registrations, 16);
// 8+5 taken of 10+4 offered = 13/14. The uncapped Coffee Hour is in neither
// half of that fraction — an open-door session has no seats to sell.
check('seats filled is over CAPPED sessions only', next7.seatsFilledPct, 93);
// Chair Yoga has two chairs left; Tai Chi is over its cap and has none, and
// its overflow does not cancel out somebody else's empty room.
check('empty seats floor at zero per session', next7.emptySeats, 2);
check('waitlisted is demand being turned away', next7.waitlisted, 1);

check('next 30 days says where it stops', next30.label, 'Next 30 days (thru Oct 15)');
check('next 30 days reaches October', next30.sessions, 4);
check('next 30 days counts October registrations', next30.registrations, 18);
// 8+5+2 of 10+4+6 = 15/20.
check('the 30-day fill rate takes in the October session', next30.seatsFilledPct, 75);
check('and its four empty seats', next30.emptySeats, 6);
// November's untouched 40-seat session is in NEITHER window, which is the
// whole point: it is not a 0%-full failure, it is not open yet.
check('nothing beyond the window is counted', next30.sessions < WINDOW_SESSIONS.length, true);

// A week with no capped session at all reads blank, not 0% full.
const UNCAPPED_ONLY = [session('coffee-0917', 2026, 9, 17, 'Coffee Hour', '--')];
const uncappedMetrics = sandbox.computeProgramMetrics(UNCAPPED_ONLY, sessionMap,
  sandbox.scanRegistrants(null, [registrant('coffee-0917', 2026, 9, 17, 'Someone')]), NOW);
check('an all-uncapped week has no fill rate rather than 0%', uncappedMetrics.windows[0].seatsFilledPct, null);
check('and no empty-seat count either', uncappedMetrics.windows[0].emptySeats, null);

// ---------------------------------------------------------------------------
// 2. MONTH OVER MONTH
// ---------------------------------------------------------------------------
// July, August and September, all in the first half of the month so the Sep
// 1–16 / Aug 1–16 comparison has something on both sides of it.
//
//   Marion   July, August, September   — returning, not new
//   Joe      August, September         — returning, not new
//   Priya    September only            — NEW
//   Walter   July only                 — neither: back in neither Aug nor Sep
//   Ada      August only               — new in August, gone by September
const MONTH_SESSIONS = [
  session('jul-a', 2026, 7, 8, 'Chair Yoga', 20),
  session('aug-a', 2026, 8, 5, 'Chair Yoga', 20),
  session('aug-b', 2026, 8, 12, 'Book Club', 20),
  session('sep-a', 2026, 9, 3, 'Chair Yoga', 20),
  session('sep-b', 2026, 9, 10, 'Book Club', 20),
  // A [No Registration] drop-in: a session that genuinely ran, whose zero
  // registrations are structural and must not drag Avg / Session down.
  session('sep-c', 2026, 9, 14, 'Coffee Hour', '--', true),
  // Dated AFTER today, so it is this month's pipeline rather than this
  // month's record — it must not appear in the Sep 1–16 numbers.
  session('sep-late', 2026, 9, 24, 'Chair Yoga', 20)
];

const MONTH_REGISTRANTS = [
  registrant('jul-a', 2026, 7, 8, 'Marion Webb', 'Active', true),
  registrant('jul-a', 2026, 7, 8, 'Walter Hale', 'Active', true),

  registrant('aug-a', 2026, 8, 5, 'Marion Webb', 'Active', true),
  registrant('aug-a', 2026, 8, 5, 'Joe Ricci', 'Active', false),
  registrant('aug-b', 2026, 8, 12, 'Ada Kern', 'Active', true),
  // The same person, spelled the way a form and a desk actually spell her:
  // one participant, not two.
  registrant('aug-b', 2026, 8, 12, 'marion  webb', 'Active', true),

  registrant('sep-a', 2026, 9, 3, 'Marion Webb', 'Active', true),
  registrant('sep-a', 2026, 9, 3, 'Joe Ricci', 'Active', true),
  registrant('sep-b', 2026, 9, 10, 'Priya Nair', 'Active', false),
  registrant('sep-b', 2026, 9, 10, 'Marion Webb', 'Active', true),
  // Beyond today: booked, but not yet part of the month's record.
  registrant('sep-late', 2026, 9, 24, 'Someone Later', 'Active')
];

const monthScan = sandbox.scanRegistrants(null, MONTH_REGISTRANTS);
const monthMetrics = sandbox.computeProgramMetrics(MONTH_SESSIONS, sessionMap, monthScan, NOW);
const thisMonth = monthMetrics.months.current;
const lastMonth = monthMetrics.months.previous;

check('this month names the span it covers', thisMonth.label, 'Sep 1–16');
check('last month is the SAME span, not the whole month', lastMonth.label, 'Aug 1–16');

check('this month counts the drop-in as a session it ran', thisMonth.sessions, 3);
check('and stops at today rather than running to month end', thisMonth.registrations, 4);
check('Marion counts once however she was spelled', thisMonth.participants, 3);
check('Priya is the only face never seen before', thisMonth.newPeople, 1);
// Marion and Joe were both here in August; Priya was not. 2 of 3.
check('returning is measured against LAST month specifically', thisMonth.returningPct, 67);
// 4 registrations over 2 registering sessions — the drop-in is not a divisor.
check('avg per session leaves [No Registration] out of the divisor', thisMonth.perSession, 2);
// Sep 3 and Sep 10 have both happened; 3 of their 4 registrations are ticked.
check('attendance is asked only of sessions that have happened', thisMonth.attendedPct, 75);

check('last month counts its own two sessions', lastMonth.sessions, 2);
// FOUR ROWS, THREE PEOPLE, and the gap between the next two lines is the
// reason both numbers are on the block. Marion signed up for Chair Yoga AND
// Book Club in August, which is two registrations and one participant —
// counting registrations as people is how a small, loyal membership gets
// reported as a growing one.
check('registrations count sign-ups', lastMonth.registrations, 4);
check('participants count people: Marion, Joe and Ada', lastMonth.participants, 3);
// Joe and Ada are both first seen in August.
check('two of August’s three were new', lastMonth.newPeople, 2);
// Only Marion was here in July. 1 of 3.
check('August’s returning share looks back at July', lastMonth.returningPct, 33);
check('August averaged two sign-ups a session', lastMonth.perSession, 2);
// Marion twice and Ada ticked, Joe not: 3 of 4.
check('August’s attendance', lastMonth.attendedPct, 75);

// A month where the desk ticked nothing reads blank, not 0% — a center nobody
// walked into is a far stronger claim than the data supports.
const UNTICKED = MONTH_REGISTRANTS.map(row => {
  const copy = row.slice();
  copy[regMap['Attended']] = '';
  return copy;
});
const untickedMetrics = sandbox.computeProgramMetrics(MONTH_SESSIONS, sessionMap,
  sandbox.scanRegistrants(null, UNTICKED), NOW);
check('an unticked month has no attendance figure at all', untickedMetrics.months.current.attendedPct, null);

// ---------------------------------------------------------------------------
// 3. THE CHANGE ROW
// ---------------------------------------------------------------------------
check('a rise is an arrow and a magnitude', sandbox.formatMetricChange(410, 372), '▲ 38');
check('a fall is the other arrow', sandbox.formatMetricChange(24, 31), '▼ 7');
check('no movement is a dash, not a zero', sandbox.formatMetricChange(12, 12), '—');
check('percentages move in POINTS', sandbox.formatMetricChange(61, 58, { points: true }), '▲ 3 pts');
check('a percentage falling', sandbox.formatMetricChange(58, 61, { points: true }), '▼ 3 pts');
check('a rate keeps its decimal', sandbox.formatMetricChange(6.6, 6.4, { decimals: true }), '▲ 0.2');
check('nothing to compare against is a dash', sandbox.formatMetricChange(null, 5), '—');
check('nothing to compare, the other way', sandbox.formatMetricChange(5, null), '—');

// ---------------------------------------------------------------------------
// 4. THE SPAN ARITHMETIC ITSELF
// ---------------------------------------------------------------------------
// March 31st cannot be compared against February 31st. The span clamps to the
// days February has, and the LABEL says so rather than quietly comparing a
// long month against a short one.
const marchEnd = new Date(2026, 2, 31);
const febSpan = sandbox.monthSpanThroughDay(2026, 1, marchEnd.getDate());
check('February clamps to the days it has', sandbox.describeDateSpan(febSpan.start, febSpan.end), 'Feb 1–28');
const marSpan = sandbox.monthSpanThroughDay(2026, 2, marchEnd.getDate());
check('March keeps all of them', sandbox.describeDateSpan(marSpan.start, marSpan.end), 'Mar 1–31');
// On the 1st, "Sep 1–1" would read as a typo.
const firstSpan = sandbox.monthSpanThroughDay(2026, 8, 1);
check('a one-day span is one date', sandbox.describeDateSpan(firstSpan.start, firstSpan.end), 'Sep 1');

// JANUARY, where "last month" and "the month before" are in a different YEAR.
// A month index of -1 is December of the year before, and its length is
// December's — the one place this arithmetic can be off by a year rather than
// a day, and the one it would be wrong about for a fortnight before anyone
// noticed.
const JAN = new Date(2027, 0, 10);
const YEAR_END_SESSIONS = [
  session('dec-a', 2026, 12, 4, 'Chair Yoga', 20),
  session('nov-a', 2026, 11, 6, 'Chair Yoga', 20),
  session('jan-a', 2027, 1, 7, 'Chair Yoga', 20)
];
const YEAR_END_REGISTRANTS = [
  registrant('nov-a', 2026, 11, 6, 'Marion Webb', 'Active', true),
  registrant('dec-a', 2026, 12, 4, 'Marion Webb', 'Active', true),
  registrant('dec-a', 2026, 12, 4, 'Ada Kern', 'Active', true),
  registrant('jan-a', 2027, 1, 7, 'Marion Webb', 'Active', true)
];
const yearEnd = sandbox.computeProgramMetrics(YEAR_END_SESSIONS, sessionMap,
  sandbox.scanRegistrants(null, YEAR_END_REGISTRANTS), JAN);
check('January looks back into last year', yearEnd.months.previous.label, 'Dec 1–10');
check('and finds December\u2019s session there', yearEnd.months.previous.sessions, 1);
check('January\u2019s own session is this month\u2019s', yearEnd.months.current.sessions, 1);
// Marion was in December, so she is returning in January — across the year
// boundary, which is the whole point of the check.
check('returning crosses the new year', yearEnd.months.current.returningPct, 100);
check('and nobody in January is new', yearEnd.months.current.newPeople, 0);
// December's own "returning" looks back at November, where only Marion was.
check('December looks back at November', yearEnd.months.previous.returningPct, 50);

// Capacity and registration-bearing reads, which every number above rests on.
check('a double dash is uncapped', sandbox.sessionCapacity(session('x', 2026, 9, 1, 'X', '--'), sessionMap), null);
check('a blank is uncapped', sandbox.sessionCapacity(session('x', 2026, 9, 1, 'X', ''), sessionMap), null);
check('a zero is uncapped', sandbox.sessionCapacity(session('x', 2026, 9, 1, 'X', 0), sessionMap), null);
check('a number is a cap', sandbox.sessionCapacity(session('x', 2026, 9, 1, 'X', 12), sessionMap), 12);
check('an unticked box takes registration', sandbox.sessionTakesRegistration(session('x', 2026, 9, 1, 'X', 12), sessionMap), true);
check('a ticked one does not', sandbox.sessionTakesRegistration(session('x', 2026, 9, 1, 'X', 12, true), sessionMap), false);

// ---------------------------------------------------------------------------
// 5. AN EMPTY WORKBOOK
// ---------------------------------------------------------------------------
// Nothing here may divide by zero or claim 0% of nothing.
const emptyMetrics = sandbox.computeProgramMetrics([], sessionMap, sandbox.scanRegistrants(null, []), NOW);
check('an empty week has no fill rate', emptyMetrics.windows[0].seatsFilledPct, null);
check('an empty week has no sessions', emptyMetrics.windows[0].sessions, 0);
check('an empty month has no participants', emptyMetrics.months.current.participants, 0);
check('an empty month has no returning share', emptyMetrics.months.current.returningPct, null);
check('an empty month has no per-session rate', emptyMetrics.months.current.perSession, null);
check('and its change row is all dashes', sandbox.formatMetricChange(
  emptyMetrics.months.current.perSession, emptyMetrics.months.previous.perSession, { decimals: true }), '—');

// ---------------------------------------------------------------------------
// 6. THE BLOCK AS IT IS ACTUALLY WRITTEN
// ---------------------------------------------------------------------------
// The arithmetic above is only half of it: a range whose height disagrees with
// the values handed to it throws in a live workbook and nowhere else, and this
// block writes eight of them. The fake sheet checks every range it is given
// against the data written into it, so a shape mistake fails here rather than
// on somebody's Monday morning.
const written = [];
const noted = [];
const backgrounds = [];
let rangeErrors = [];

function fakeRange(sheet, row, col, numRows, numCols) {
  const api = {};
  const dims = `r${row}c${col} ${numRows}x${numCols}`;
  api.setValues = values => {
    if (values.length !== numRows) rangeErrors.push(`${dims}: ${values.length} row(s) of values`);
    values.forEach(r => {
      if (r.length !== numCols) rangeErrors.push(`${dims}: a row of ${r.length} value(s)`);
    });
    values.forEach((r, i) => written.push({ row: row + i, col: col, values: r }));
    return api;
  };
  api.setNotes = notes => {
    if (notes.length !== numRows) rangeErrors.push(`${dims}: ${notes.length} row(s) of notes`);
    notes.forEach(r => {
      if (r.length !== numCols) rangeErrors.push(`${dims}: a row of ${r.length} note(s)`);
      r.forEach(n => noted.push(n));
    });
    return api;
  };
  api.setBackground = color => { backgrounds.push({ row: row, numRows: numRows, color: color }); return api; };
  ['setFontSize', 'setFontWeight', 'setFontColor', 'setHorizontalAlignment', 'setVerticalAlignment',
    'setNumberFormat', 'setWrapStrategy', 'setValue', 'setNote', 'breakApart'].forEach(fn => {
    api[fn] = () => api;
  });
  return api;
}

const fakeSheet = {
  getName: () => 'Master_Program_Dashboard',
  getMaxColumns: () => sessionHeaders.length,
  getMaxRows: () => 200,
  getRange: (row, col, numRows, numCols) => fakeRange(fakeSheet, row, col, numRows === undefined ? 1 : numRows, numCols === undefined ? 1 : numCols),
  setRowHeight: () => fakeSheet
};

const nextRow = sandbox.writeProgramMetricsSection(fakeSheet, 8, sessionHeaders.length, monthMetrics);
check('every range matches the data written into it', rangeErrors, []);
// Row 8 banner, 9 window header, 10-11 the two windows, 12 month header,
// 13-15 this month / last month / change. The next section starts at 16.
check('the block is eight rows deep, and says where it ended', nextRow, 16);

const rowAt = n => (written.find(w => w.row === n) || {}).values;
check('the two windows are written in order',
  [rowAt(10)[0], rowAt(11)[0]], ['Next 7 days (thru Sep 22)', 'Next 30 days (thru Oct 15)']);
check('this month, last month, then the change',
  [rowAt(13)[0], rowAt(14)[0], rowAt(15)[0]],
  ['This month (Sep 1–16)', 'Last month (Aug 1–16)', 'Change']);
// A percentage reaches the cell as a FRACTION under an 0% format, never as the
// string "67%" — a cell that merely looks like a percentage is at the mercy of
// whatever format the tab happens to be carrying.
check('a percentage is written as a number for its format to render', rowAt(13)[5], 0.67);
check('and attendance the same way', rowAt(13)[7], 0.75);
check('the change row is arrows, not numbers',
  rowAt(15).slice(1).every(v => typeof v === 'string'), true);
check('the derived row is marked with a stripe',
  backgrounds.some(b => b.row === 15), true);
check('every column heading carries its explanation',
  noted.length, 14);
check('and none of them is blank', noted.every(n => n && n.length > 20), true);

// A metric with nothing behind it reaches the cell as a dash — never as a zero
// that a percent format would render as a confident "0%".
written.length = 0;
rangeErrors = [];
sandbox.writeProgramMetricsSection(fakeSheet, 8, sessionHeaders.length, untickedMetrics);
check('an unticked month writes a dash where the percentage would go',
  (written.find(w => w.row === 13) || {}).values[7], '—');
check('and still fills every range it opens', rangeErrors, []);

console.log(failures === 0 ? '\nAll program-metrics checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
