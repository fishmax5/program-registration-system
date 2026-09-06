// DRAWING Master_Program_Dashboard, not just computing it.
//
// tests/program_month.test.js pins what the rows SAY. Nothing pinned the pass
// that writes them, and the failure that cost a render was exactly there: the
// two row arrays were renamed (upcoming/past -> running/finished, when the
// split stopped being a date partition and became a status one) and three of
// the side-channel calls at the foot of writeProgramMonthSheet() were left
// naming the old ones. Every value is in scope at load, so nothing complains
// until the tab is drawn — and then the whole render throws
// "ReferenceError: upcoming is not defined", caught one level up, and the tab
// silently keeps last week's contents.
//
// So this test draws the tab. It asserts almost nothing about the drawing: the
// point is that the pass RUNS, with notes, links and a matched-leader wash all
// present, because that is the half a unit test of the row builder cannot see.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const properties = {};
let toasts = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => new Date(d).toISOString() + '|' + fmt,
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (properties[k] === undefined ? null : properties[k]),
      setProperty: (k, v) => { properties[k] = v; },
      setProperties: o => { Object.keys(o).forEach(k => { properties[k] = o[k]; }); },
      deleteProperty: k => { delete properties[k]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => ({ toast: msg => toasts.push(msg) }),
    newConditionalFormatRule: () => chainableFactory({ build: () => ({}) }),
    newDataValidation: () => chainableFactory({ build: () => ({}) }),
    newRichTextValue: () => chainableFactory({ build: () => ({}) }),
    WrapStrategy: { OVERFLOW: 'overflow', CLIP: 'clip' },
    ProtectionType: { RANGE: 'range' },
    BandingTheme: { LIGHT_GREY: 'grey' }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};

/**
 * A builder that answers every unknown call with ITSELF. The write pass chains
 * through a dozen of these (rules, validations, rich text, ranges) and cares
 * about none of their return values — so the stub only has to not get in the
 * way. Built in two steps because the Proxy must be able to return itself.
 */
function chainableFactory(overrides) {
  const target = Object.assign({}, overrides || {});
  const proxy = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => proxy;
    }
  });
  return proxy;
}
vm.createContext(sandbox);
vm.runInContext(src + `
;this.writeProgramMonthSheet = writeProgramMonthSheet;
this.partitionRunningPrograms = partitionRunningPrograms;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.PROGRAM_MONTH_LEADER_COLUMN = PROGRAM_MONTH_LEADER_COLUMN;
this.__setLeaderIndex = function (rows) { __programLeaderIndexCache = rows; };
`, sandbox, { filename: 'program_month_render.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const headers = sandbox.HEADERS.Master_Program_Dashboard;
const map = sandbox.getIndexMap(headers);

// --- the sheet ---------------------------------------------------------------
// Records what it was asked to do and answers everything else with itself.
function fakeSheet() {
  const calls = { notes: [], richText: [], backgrounds: 0, values: [] };
  const rangeFor = (row, col, rows, cols) => {
    const range = chainableFactory({
      getA1Notation: () => `R${row}C${col}`,
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => rows || 1,
      getNumColumns: () => cols || 1,
      getValues: () => Array.from({ length: rows || 1 },
        () => new Array(cols || 1).fill('')),
      getValue: () => '',
      setNote: text => { calls.notes.push({ row, col, text }); return range; },
      setRichTextValue: v => { calls.richText.push({ row, col }); return range; },
      setValues: v => { calls.values.push({ row, col, values: v }); return range; }
    });
    return range;
  };
  const sheet = chainableFactory({
    calls,
    getName: () => 'Master_Program_Dashboard',
    getSheetId: () => 42,
    getMaxRows: () => 400,
    getMaxColumns: () => Math.max(headers.length, 30),
    getLastRow: () => 0,
    getLastColumn: () => 0,
    getBandings: () => [],
    getProtections: () => [],
    getConditionalFormatRules: () => [],
    getFrozenRows: () => 0,
    getFrozenColumns: () => 0,
    getRange: (row, col, rows, cols) => rangeFor(row, col, rows, cols),
    getRangeList: a1s => chainableFactory({
      setBackground: () => { calls.backgrounds += a1s.length; return null; }
    }),
    getParent: () => ({ getId: () => 'ss', toast: () => {} })
  });
  return sheet;
}

// --- the rows ----------------------------------------------------------------
function programRow(fields) {
  const row = new Array(headers.length).fill('');
  Object.keys(fields).forEach(header => {
    if (map[header] === undefined) throw new Error(`no such column: ${header}`);
    row[map[header]] = fields[header];
  });
  return row;
}

const running = programRow({
  Program: 'Chair Yoga', Location: 'Main', Group_Key: 'program::chair yoga::main',
  Next_Date: new Date(2026, 9, 6), Last_Date: new Date(2026, 11, 15), Status: 'Active',
  Schedule: 'Weekly · Tue 10:00 AM', Seats: '8 of 12', Leader: 'A Leader'
});
const finished = programRow({
  Program: 'Winter Chorus', Location: 'Annex', Group_Key: 'program::winter chorus::annex',
  Next_Date: '', Last_Date: new Date(2026, 2, 3), Status: 'Completed'
});

const built = {
  rows: [running, finished],
  notes: [
    { row: running, header: 'Schedule', text: 'skipped the week of Nov 24' },
    { row: finished, header: 'Seats', text: 'summed over this month and next' }
  ],
  links: [{
    row: running,
    parts: [
      { label: 'Register', url: 'https://example.test/register' },
      { label: 'Roster', url: 'https://example.test/roster' }
    ]
  }],
  matched: [running]
};

sandbox.__setLeaderIndex({});

// ---------------------------------------------------------------------------
// The render itself. A throw here IS the failure — it is what the log line
// "could not be rebuilt this run" was reporting.
// ---------------------------------------------------------------------------
const sheet = fakeSheet();
let thrown = null;
try {
  sandbox.writeProgramMonthSheet(sheet, built, false, null);
} catch (err) {
  thrown = String(err);
}
check('the tab draws without throwing', thrown, null);
const written = sheet.calls.values.reduce((all, v) => all.concat(v.values), []);
check('both program rows were written',
  [written.some(r => r[map['Program']] === 'Chair Yoga'),
    written.some(r => r[map['Program']] === 'Winter Chorus')],
  [true, true]);

// The three side-channel passes are the ones that were naming variables that
// no longer existed, and each is silent on a row it cannot place — so "it ran"
// is only true if each actually landed on a row.
check('the cell notes landed', sheet.calls.notes.length >= built.notes.length, true);
check('the link cell landed', sheet.calls.richText.length, 1);
check('the unconfirmed leader was washed', sheet.calls.backgrounds, 1);

// AND AGAIN WITH THE METRICS BLOCK ABOVE IT, which is what pushes every row
// down: the side-channel passes locate a row by where the sectioned writer
// actually put it, so a wrong answer here is a note on somebody else's program.
const month = label => ({
  label, sessions: 1, registrations: 2, participants: 2, newPeople: 1,
  returningPct: 50, perSession: 2, attendedPct: 100
});
const withMetrics = fakeSheet();
thrown = null;
try {
  sandbox.writeProgramMonthSheet(withMetrics, built, false, {
    windows: [{ label: 'Next 7 days', sessions: 1, registrations: 2, seatsFilledPct: 50, emptySeats: 4, waitlisted: 0 }],
    months: { current: month('October'), previous: month('September') }
  });
} catch (err) {
  thrown = String(err);
}
check('...and again with the metrics block above it', thrown, null);
check('...with the notes and the wash still landing',
  [withMetrics.calls.notes.length >= built.notes.length, withMetrics.calls.backgrounds], [true, 1]);

console.log(failures === 0 ? '\nAll program_month_render tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
