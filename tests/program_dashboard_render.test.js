// THE DASHBOARD'S RENDER PATH, ACTUALLY RUN.
//
// Everything else about Master_Program_Dashboard was tested by calling the
// functions that compute its numbers — scanRegistrants(), computeProgramMetrics()
// — and nothing ever ran writeProgramDashboardSheet() itself. That left the
// longest function on the tab, the one that clears the sheet and then writes
// every banner, formula, checkbox, validation and conditional format back onto
// it, with no coverage at all: a typo in it is a ReferenceError that no test
// sees and that reaches a real workbook mid-write, with the rows already on the
// tab and the formatting not.
//
// So this file runs it. The sheet underneath is a fake that stores what it is
// given and records what it was asked to do — permissive enough that a call
// this test does not model still works, which is the point: an undefined
// identifier anywhere in the render path throws here rather than in somebody's
// hourly sync.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(date, tz, pattern) {
  const p = n => String(n).padStart(2, '0');
  switch (pattern) {
    case 'yyyy-MM-dd': return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    case 'yyyy-MM': return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
    case 'MMM d': return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
    case 'd': return String(date.getDate());
    case 'MMMM yyyy': return `${LONG_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    case 'EEEE, MMM d, yyyy':
      return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    default: return date.toISOString();
  }
}

// ---------------------------------------------------------------------------
// A sheet that answers every call and remembers the ones this test asks about.
// ---------------------------------------------------------------------------
/**
 * Anything not spelled out returns the object itself, so a chain of setters
 * this test has no opinion about still runs. The methods that have to give a
 * real answer — the ones whose result the code reads back — are spelled out.
 */
function chainable(overrides) {
  const target = Object.assign({}, overrides || {});
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return () => proxy;
    }
  });
  return proxy;
}

function fakeSheet(name) {
  const cells = new Map();
  const record = { numberFormats: [], validations: [], formulas: [], shownRows: [], notes: 0 };
  const key = (r, c) => `${r},${c}`;

  function range(row, col, numRows, numCols) {
    numRows = numRows === undefined ? 1 : numRows;
    numCols = numCols === undefined ? 1 : numCols;
    const self = chainable({
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const k = key(row + r, col + c);
            line.push(cells.has(k) ? cells.get(k) : '');
          }
          out.push(line);
        }
        return out;
      },
      getBackgrounds: () =>
        Array.from({ length: numRows }, () => Array.from({ length: numCols }, () => '#ffffff')),
      getFormulas: () =>
        Array.from({ length: numRows }, () => Array.from({ length: numCols }, () => '')),
      getA1Notation: () => `R${row}C${col}`,
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => numRows,
      setValues: values => {
        values.forEach((line, r) => line.forEach((v, c) => cells.set(key(row + r, col + c), v)));
        return self;
      },
      setValue: v => { cells.set(key(row, col), v); return self; },
      setFormulas: f => { record.formulas.push({ row, col, count: f.length }); return self; },
      setNumberFormat: format => {
        record.numberFormats.push({ row, col, numRows, format });
        return self;
      },
      setDataValidation: rule => {
        record.validations.push({ row, col, numRows, kind: rule && rule.__kind });
        return self;
      },
      setNote: () => { record.notes++; return self; }
    });
    return self;
  }

  const sheet = chainable({
    getName: () => name,
    getMaxRows: () => 2000,
    getMaxColumns: () => 60,
    getLastRow: () => 500,
    getLastColumn: () => 30,
    getBandings: () => [],
    getProtections: () => [],
    getConditionalFormatRules: () => [],
    getFrozenRows: () => 0,
    getColumnWidth: () => 100,
    getSheetId: () => 1,
    getFilter: () => null,
    isRowHiddenByUser: () => false,
    getRange: (r, c, nr, nc) => range(r, c, nr, nc),
    showRows: (start, count) => { record.shownRows.push({ start, count }); }
  });
  return { sheet, cells, record, cellAt: (r, c) => cells.get(key(r, c)) };
}

const spreadsheet = chainable({
  getSheetByName: n => fakeSheet(n).sheet,
  getSheets: () => [],
  getSpreadsheetTimeZone: () => 'America/New_York',
  getId: () => 'ss-1'
});

/** A builder whose build() says which kind of rule it was — enough to check a checkbox is a checkbox. */
function validationBuilder() {
  const state = { kind: '' };
  const b = chainable({
    requireCheckbox: () => { state.kind = 'checkbox'; return b; },
    requireValueInList: () => { state.kind = 'list'; return b; },
    build: () => ({ __kind: state.kind })
  });
  return b;
}

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate,
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => String(payload).split('').map(c => c.charCodeAt(0)),
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, deleteProperty: () => {}, getProperties: () => ({})
    })
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet,
    getActive: () => spreadsheet,
    getUi: () => { throw new Error('headless'); },
    newDataValidation: () => validationBuilder(),
    newConditionalFormatRule: () => chainable({ build: () => ({ __kind: 'format' }) }),
    WrapStrategy: { OVERFLOW: 'OVERFLOW', CLIP: 'CLIP', WRAP: 'WRAP' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
    ProtectionType: { RANGE: 'RANGE' },
    DataValidationCriteria: {}
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, DocumentApp: {}, UrlFetchApp: {},
  MailApp: {}, Calendar: {}, ScriptApp: { getProjectTriggers: () => [] },
  LockService: { getScriptLock: () => chainable({ tryLock: () => true }) },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }),
    getActiveUser: () => ({ getEmail: () => 'test@example.com' })
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.writeProgramDashboardSheet = writeProgramDashboardSheet;
this.scanRegistrants = scanRegistrants;
this.computeProgramMetrics = computeProgramMetrics;
this.buildTodayAtLocations = buildTodayAtLocations;
this.applyMonthColorTint = applyMonthColorTint;
this.MONTH_DISPLAY_FORMAT = MONTH_DISPLAY_FORMAT;
this.DATE_DISPLAY_FORMAT = DATE_DISPLAY_FORMAT;
this.PROGRAM_FLAG_COLUMNS = PROGRAM_FLAG_COLUMNS;
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

const headers = sandbox.HEADERS.Master_Program_Dashboard;
const map = sandbox.getIndexMap(headers);

function session(id, date, title, capacity) {
  const row = new Array(headers.length).fill('');
  row[map['Event_ID']] = id;
  row[map['Event_Date']] = date;
  row[map['Clean_Title']] = title;
  row[map['Location']] = 'Narberth';
  row[map['Max_Capacity']] = capacity;
  row[map['Status']] = 'Open';
  return row;
}

// Relative to today, so the fixture never expires: one session this morning,
// one next week, and a past lunch row — which exercises the run-finding in
// showLunchOnlySessionRows() as well.
const now = new Date();
const day = 86400000;
const at = (offsetDays, hour) => {
  const d = new Date(now.getTime() + offsetDays * day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0);
};
const sessionRows = [
  session('yoga-today', at(0, 10), 'Chair Yoga', 10),
  session('taichi-next-week', at(7, 13), 'Tai Chi', '--'),
  session('LUNCHONLY_last-week', at(-7, 12), 'Lunch @ Narberth — Chx Parm', '--')
];

const scan = sandbox.scanRegistrants(null, []);
const metrics = sandbox.computeProgramMetrics(sessionRows, map, scan, now);
const todayData = sandbox.buildTodayAtLocations(sessionRows, map, scan);

// ---------------------------------------------------------------------------
// 1. IT RUNS. The assertion that would have caught a ReferenceError in the
//    render path — everything below only gets to run because this one holds.
// ---------------------------------------------------------------------------
const { sheet, record, cellAt } = fakeSheet('Master_Program_Dashboard');
let threw = null;
try {
  sandbox.writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, false);
} catch (err) {
  threw = String(err);
}
check('the whole render runs end to end', threw, null);
if (threw) { console.log('\n1 or more checks failed'); process.exit(1); }

// ---------------------------------------------------------------------------
// 2. THE ROWS ARE ON THE TAB, and each one is in the right section.
// ---------------------------------------------------------------------------
const written = [];
for (let r = 1; r <= 200; r++) {
  const id = cellAt(r, map['Event_ID'] + 1);
  // The two header rows carry the column's NAME in that cell; the data rows
  // carry an event id.
  if (id && id !== 'Event_ID') written.push({ row: r, id });
}
check('every session row was written exactly once',
  written.map(w => w.id).sort(), ['LUNCHONLY_last-week', 'taichi-next-week', 'yoga-today']);

const rowOf = id => written.filter(w => w.id === id)[0].row;
check("today's session and next week's are together, above the past lunch row",
  rowOf('yoga-today') < rowOf('taichi-next-week') &&
  rowOf('taichi-next-week') < rowOf('LUNCHONLY_last-week'), true);

// ---------------------------------------------------------------------------
// 3. THE DATE CELL STILL HOLDS A DATE. The month format is display only — this
//    is what says so, and what would fail if the render ever wrote the label
//    into the cell instead of onto it.
// ---------------------------------------------------------------------------
const dateCell = cellAt(rowOf('yoga-today'), map['Event_Date'] + 1);
check('the Event_Date cell holds the session\'s real start datetime',
  dateCell instanceof Date && dateCell.getHours(), 10);

const dateFormats = record.numberFormats
  .filter(f => f.col === map['Event_Date'] + 1)
  .map(f => f.format);
check('and is formatted as its month',
  dateFormats.length > 0 && dateFormats.every(f => f === sandbox.MONTH_DISPLAY_FORMAT), true);

// The other tabs are unchanged: applyMonthColorTint() without a format still
// stamps the day-by-day one.
const plain = fakeSheet('Registrant_Dash');
plain.cells.set('2,1', at(0, 10));
sandbox.applyMonthColorTint(plain.sheet, 1, 2, 1);
check('a tab that asks for no format still gets the day-by-day one',
  plain.record.numberFormats.map(f => f.format), [sandbox.DATE_DISPLAY_FORMAT]);

// ---------------------------------------------------------------------------
// 4. THE FORMATTING THAT COMES AFTER THE ROWS. A render that dies between the
//    two leaves a tab that looks written and behaves like a text file — no
//    checkboxes, no dropdowns, no time formulas. All of it lands here.
// ---------------------------------------------------------------------------
const checkboxCols = record.validations
  .filter(v => v.kind === 'checkbox')
  .map(v => v.col - 1);
sandbox.PROGRAM_FLAG_COLUMNS.forEach(flag => {
  check(`${flag.column} is a checkbox in the upcoming section`,
    checkboxCols.indexOf(map[flag.column]) >= 0, true);
});
check('Waitlist_Only is a checkbox too',
  checkboxCols.indexOf(map['Waitlist_Only']) >= 0, true);
check('Type_Tag is a dropdown',
  record.validations.filter(v => v.kind === 'list').map(v => v.col - 1).indexOf(map['Type_Tag']) >= 0, true);
check('Event_Time is written as formulas, in both sections',
  record.formulas.filter(f => f.col === map['Event_Time'] + 1).map(f => f.count), [2, 1]);
check('the lunch row was explicitly shown', record.shownRows.length > 0, true);

console.log(failures === 0 ? '\nall passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
