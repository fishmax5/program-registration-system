// ONE PROGRAM, TWO SPELLINGS (74's readWalkInDay, 38's row match).
//
// The tablet's tile for a program carries the value built from the session
// table's Clean_Title, and a person's registered value used to be built from the
// Event written on their own registrant row; the page compares them as exact
// strings. "Jig-Saw" on the calendar against "Jigsaw" on a registration was two
// programs: the tile said nobody was signed up while "Show everyone" listed the
// people who were, and the registrant's spelling added a second tile.
//
// Pins: both spellings share ONE value and ONE tile (the calendar's spelling),
// the registered person carries that value, the regulars section matches the
// same way, two DIFFERENT programs keep different values, and the write path
// finds a row written under the other spelling instead of adding a second.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'H') return '12';
      if (fmt === 'yyyy-MM-dd') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
          `${String(d.getDate()).padStart(2, '0')}`;
      }
      if (fmt === 'EEE, MMM d, yyyy') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
          'Nov', 'Dec'];
        return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
      }
      return '9:00 AM';
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + ';this.HEADERS = HEADERS; this.SHEET_NAMES = SHEET_NAMES;', sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

const DASH_HEADERS = ['Event_Date', 'Location', 'Clean_Title', 'Event_Time',
  'Personalized_Assistance', 'No_Registration', 'Event_ID'];
const REG_HEADERS = ['Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended',
  'Lunch_Served', 'Lunch_Status', 'Phone', 'Event_ID'];
const ROLL_HEADERS = ['Name', 'Phone', 'Email', 'Times_Seen', 'First_Seen', 'Last_Seen',
  'Locations', 'Usual_Guests', 'Dietary_Notes', 'Contact', 'Staff_Notes'];

function gridSheet(name, values) {
  return {
    getName: () => name,
    getLastRow: () => values.length,
    getLastColumn: () => (values[0] || []).length,
    getMaxRows: () => values.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || (values[0] || []).length))),
      getValue: () => values[row - 1][col - 1],
      getDisplayValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || (values[0] || []).length)).map(String))
    })
  };
}

const real = { dash: sandbox.HEADERS.All_Program_Sessions, reg: sandbox.HEADERS.All_Registrants,
  roll: sandbox.HEADERS.Member_Roll, meal: sandbox.getMealInfoForDate };

function withWorkbook(parts, fn) {
  sandbox.HEADERS.All_Program_Sessions = DASH_HEADERS;
  sandbox.HEADERS.All_Registrants = REG_HEADERS;
  sandbox.HEADERS.Member_Roll = ROLL_HEADERS;
  sandbox.getMealInfoForDate = () => null;
  const sheets = {
    [sandbox.SHEET_NAMES.PROGRAM_DASHBOARD]: gridSheet(sandbox.SHEET_NAMES.PROGRAM_DASHBOARD,
      [DASH_HEADERS].concat(parts.dash || [])),
    All_Registrants: gridSheet('All_Registrants', [REG_HEADERS].concat(parts.reg || []))
  };
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: n => sheets[n] || null });
  sandbox.invalidateSectionedRowsCache();
  try { return fn(); } finally {
    sandbox.HEADERS.All_Program_Sessions = real.dash;
    sandbox.HEADERS.All_Registrants = real.reg;
    sandbox.HEADERS.Member_Roll = real.roll;
    sandbox.getMealInfoForDate = real.meal;
    sandbox.SpreadsheetApp.getActiveSpreadsheet = () => null;
  }
}

const TODAY = '2026-09-16';
const d = key => new Date(key + 'T10:00:00');

const dash = [
  [d(TODAY), 'Narberth', 'Jig-Saw', '10:00 AM', false, false, 'evt1'],
  [d(TODAY), 'Narberth', 'Chair Yoga', '11:00 AM', false, false, 'evt2'],
  [d(TODAY), 'Narberth', 'Chair Yoga (Beginner)', '12:00 PM', false, false, 'evt3']
];
// Seven people registered under the OTHER spelling; one under Chair Yoga.
const reg = [];
['Ann One', 'Bo Two', 'Cy Three', 'Di Four', 'Ed Five', 'Flo Six', 'Gus Seven'].forEach(n =>
  reg.push([d(TODAY), 'Narberth', 'Jigsaw', '10:00 AM', n, false, false, 'No Lunch', '', 'evt1']));
reg.push([d(TODAY), 'Narberth', 'Chair Yoga', '11:00 AM', 'Hal Eight', false, false, 'No Lunch', '', 'evt2']);
// A regular: came to "Jigsaw" last week, not signed up today.
reg.push([d('2026-09-09'), 'Narberth', 'Jigsaw!', '10:00 AM', 'Ivy Regular', true, false, 'No Lunch', '', 'evt0']);

const day = withWorkbook({ dash, reg }, () => sandbox.readWalkInDay('Narberth', TODAY));

const jig = day.programs.filter(p => /jig/i.test(p.title));
ok('two spellings of one program are ONE tile', jig.length === 1);
ok("and it carries the calendar's spelling", jig[0] && jig[0].title === 'Jig-Saw');
const ann = day.people.filter(p => p.name === 'Ann One')[0];
ok('a registered person holds the tile\'s own value',
  ann && jig[0] && ann.registered.length === 1 && ann.registered[0] === jig[0].value);
ok('every one of the seven is matched to the tile',
  day.people.filter(p => p.registered.indexOf(jig[0].value) !== -1).length === 7);
const yoga = day.programs.filter(p => p.title === 'Chair Yoga')[0];
const beginner = day.programs.filter(p => p.title === 'Chair Yoga (Beginner)')[0];
ok('different programs keep different values', yoga && beginner && yoga.value !== beginner.value);
ok('so Hal is on Chair Yoga and not on the Beginner class',
  day.people.filter(p => p.name === 'Hal Eight')[0].registered.join() === yoga.value);
ok('the regulars section matches by the same key',
  (day.past || []).some(p => p.name === 'Ivy Regular' && p.values.indexOf(jig[0].value) !== -1));
ok('and the page value still parses back to a title and a date',
  sandbox.parseQuickMarkProgramChoice(jig[0].value).title === 'Jig-Saw');

// The write path: a row written as "Jigsaw" is FOUND by a selection for
// "Jig-Saw" rather than missed (which would add a second row).
ok('titles that differ only in punctuation match for the write',
  sandbox.quickMarkTitlesMatch_('Jigsaw', 'Jig-Saw') === true);
ok('different programs do not', sandbox.quickMarkTitlesMatch_('Chair Yoga', 'Chair Yoga (Beginner)') === false);
ok('lunch still collapses to itself and nothing else',
  sandbox.quickMarkTitlesMatch_('Lunch @ Narberth — Soup', 'Lunch @ Narberth — Stew') === true &&
  sandbox.quickMarkTitlesMatch_('Lunch @ Narberth — Soup', 'Jigsaw') === false);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
