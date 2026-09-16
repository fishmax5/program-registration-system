// VOLUNTEER HOURS (section 99e).
//
// What is pinned here is the arithmetic and the two refusals, because they are
// what a figure the centre is credited on rests on:
//
//   THE HOURS. Two times beat a typed number (the times are the evidence); one
//   time or a backwards pair falls back to the typed number rather than
//   inventing a negative afternoon; a volunteer working from home has no times
//   at all and their typed hours are never overwritten.
//
//   WHAT COUNTS AS A ROW. A name and a date. Hours of nobody, and a visit on no
//   day, are a half-typed row somebody abandoned.
//
//   THE SUMMARY. People are counted once however many times they came, which
//   is the difference between "how many volunteers" and "how many visits" —
//   the two questions the annual return asks.
//
//   THE PAGE. Nothing from the workbook is interpolated into the dialog's
//   script: the whole context crosses as one double-encoded string.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {}, getUuid: () => 'uuid' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.parseVolunteerClockTime = parseVolunteerClockTime;
this.formatVolunteerClockTime = formatVolunteerClockTime;
this.volunteerVisitHours = volunteerVisitHours;
this.describeVolunteerHoursProblem = describeVolunteerHoursProblem;
this.parseVolunteerHourRow = parseVolunteerHourRow;
this.volunteerMetricsForMonth = volunteerMetricsForMonth;
this.buildVolunteerHoursHtml = buildVolunteerHoursHtml;
this.VOLUNTEER_OFF_SITE_LOCATION = VOLUNTEER_OFF_SITE_LOCATION;
this.HEADERS = HEADERS;
this.VOLUNTEER_HOURS_STAFF_COLUMNS = VOLUNTEER_HOURS_STAFF_COLUMNS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

const {
  parseVolunteerClockTime, formatVolunteerClockTime, volunteerVisitHours,
  describeVolunteerHoursProblem, parseVolunteerHourRow, volunteerMetricsForMonth,
  buildVolunteerHoursHtml, VOLUNTEER_OFF_SITE_LOCATION, HEADERS, getIndexMap
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

// --- The clock ------------------------------------------------------------
check('an <input type=time> value', parseVolunteerClockTime('14:15'), 14 * 60 + 15);
check('what somebody types', parseVolunteerClockTime('9:30 AM'), 9 * 60 + 30);
check('and without the space', parseVolunteerClockTime('1:05pm'), 13 * 60 + 5);
check('midnight is not noon', parseVolunteerClockTime('12:00 AM'), 0);
check('noon is', parseVolunteerClockTime('12:00 PM'), 12 * 60);
check('a bare hour in this column is an hour', parseVolunteerClockTime('9'), 9 * 60);
check('a Date reads back as its own clock',
  parseVolunteerClockTime(new Date(2026, 8, 16, 10, 45)), 10 * 60 + 45);
check('a blank is nothing at all', parseVolunteerClockTime(''), null);
check('and so is a sentence', parseVolunteerClockTime('after lunch'), null);
check('it round-trips for a person to read', formatVolunteerClockTime('13:05'), '1:05 PM');

// --- The hours ------------------------------------------------------------
check('two times are the answer', volunteerVisitHours('9:00', '11:30', ''), 2.5);
// THE TIMES BEAT A STALE TYPED NUMBER: a departure corrected at the desk has
// to correct the total, or the figure quietly disagrees with its own evidence.
check('and they beat a typed number', volunteerVisitHours('9:00', '12:00', 2), 3);
// The volunteer who was never at the building. Nobody watched them start.
check('typed hours stand on their own', volunteerVisitHours('', '', 2.25), 2.25);
check('one time alone falls back to the typed hours', volunteerVisitHours('9:00', '', 1.5), 1.5);
// NOT a negative afternoon and NOT an overnight shift: somebody typed 9 for 9pm.
check('a backwards pair falls back too', volunteerVisitHours('2:00 PM', '9:00 AM', 3), 3);
check('and with nothing to fall back on it is zero', volunteerVisitHours('2:00 PM', '9:00 AM', ''), 0);
check('an unreadable pair is explained', describeVolunteerHoursProblem(
  { arrived: '2:00 PM', departed: '9:00 AM', hours: 3 }).indexOf('not after') > -1, true);
check('so is a row with no hours at all',
  describeVolunteerHoursProblem({ arrived: '', departed: '', hours: 0 }).indexOf('no hours') === 0, true);
check('and a complete row has nothing to say',
  describeVolunteerHoursProblem({ arrived: '9:00', departed: '10:00', hours: 1 }), '');

// --- What counts as a row -------------------------------------------------
const map = getIndexMap(HEADERS.Volunteer_Hours);
function row(values) {
  const out = new Array(HEADERS.Volunteer_Hours.length).fill('');
  Object.keys(values).forEach(k => { out[map[k]] = values[k]; });
  return out;
}
check('hours of nobody are not a visit',
  parseVolunteerHourRow(row({ Date: new Date(2026, 8, 1), Hours: 3 }), map), null);
check('and a visit on no day is not either',
  parseVolunteerHourRow(row({ Name: 'Debbie Robinson', Hours: 3 }), map), null);

const parsed = parseVolunteerHourRow(row({
  Date: new Date(2026, 8, 16), Name: 'Debbie Robinson', Role: 'Counselling',
  Location: VOLUNTEER_OFF_SITE_LOCATION, Hours: 2
}), map);
check('an off-site volunteer is a whole row', [parsed.name, parsed.hours, parsed.location],
  ['Debbie Robinson', 2, VOLUNTEER_OFF_SITE_LOCATION]);

// --- The month ------------------------------------------------------------
const visits = [
  { monthKey: '2026-09', nameKey: 'debbie robinson', name: 'Debbie Robinson', hours: 2 },
  { monthKey: '2026-09', nameKey: 'debbie robinson', name: 'Debbie Robinson', hours: 1.5 },
  { monthKey: '2026-09', nameKey: 'sam park', name: 'Sam Park', hours: 3 },
  { monthKey: '2026-08', nameKey: 'sam park', name: 'Sam Park', hours: 4 }
];
// TWO PEOPLE, THREE VISITS — the two different questions, kept apart.
check('a month counts people once and visits every time',
  volunteerMetricsForMonth('2026-09', visits), { volunteers: 2, visits: 3, hours: 6.5 });
check('a month with nobody in it is zero, not absent',
  volunteerMetricsForMonth('2026-07', visits), { volunteers: 0, visits: 0, hours: 0 });

// --- The page -------------------------------------------------------------
const html = buildVolunteerHoursHtml({
  names: ["Bob O'Brien", '</script><b>x</b>'], programs: [], locations: [], roles: [],
  today: '2026-09-16', recent: []
});
check('nothing from the workbook is written as markup', html.indexOf('</script><b>x</b>'), -1);

check('but the payload still carries both values',
  JSON.parse(JSON.parse(html.match(/JSON.parse\((".*?")\);/)[1].replace(/\\u003c/g, '<'))).names,
  ["Bob O'Brien", '</script><b>x</b>']);

console.log(failures === 0 ? '\nAll volunteer hours checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
