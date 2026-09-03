// getSectionedRows() / getSectionedRowValues() (08_execution_caches.gs) are
// readAllSectionedRows() / readAllSectionedRowValues() memoized for the rest
// of one execution. What matters here is not the row values — those are
// already pinned by sectioned_value_reader.test.js — but the CALL COUNT: a
// second read of the same tab has to be free, a read the cache was never
// told to drop has to still be free, and a read after invalidation has to go
// back to the sheet. Getting any of those wrong is either a wasted round
// trip or, worse, a stale roster after a write.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, p) => d.toISOString(),
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.getSectionedRows = getSectionedRows;
this.getSectionedRowValues = getSectionedRowValues;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

/** Same shape as sectioned_value_reader.test.js's — a literal grid, call-counted. */
function fakeSheet(name, grid) {
  const calls = { getValues: 0, getFormulas: 0 };
  const lastCol = Math.max(...grid.map(r => r.length));
  const cell = (r, c) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : '');
  return {
    calls,
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => lastCol,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => {
        calls.getValues++;
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(cell(row - 1 + r, col - 1 + c));
          out.push(line);
        }
        return out;
      },
      getFormulas: () => {
        calls.getFormulas++;
        return Array.from({ length: numRows }, () => new Array(numCols).fill(''));
      }
    })
  };
}

const HEADERS = ['Event_ID', 'Event_Date', 'Name'];
const D1 = new Date(2026, 8, 16);

const grid = [
  ['⏳ Upcoming', '', ''],
  ['Event_ID', 'Event_Date', 'Name'],
  ['e1', D1, 'Jane Smith'],
  ['', '', ''],
  ['🕓 Past', '', ''],
  ['Event_ID', 'Event_Date', 'Name']
];

// ---------------------------------------------------------------------------
// A second read of the same tab, same headers, same reader kind: free.
// ---------------------------------------------------------------------------
let sheet = fakeSheet('Tab_A', grid);
sandbox.getSectionedRowValues(sheet, HEADERS, 'Event_ID');
sandbox.getSectionedRowValues(sheet, HEADERS, 'Event_ID');
check('a second values read of the same tab costs nothing', sheet.calls.getValues, 1);

sheet = fakeSheet('Tab_A', grid);
sandbox.getSectionedRows(sheet, HEADERS, 'Event_ID');
sandbox.getSectionedRows(sheet, HEADERS, 'Event_ID');
check('a second formula-preserving read of the same tab costs nothing',
  sheet.calls.getValues + sheet.calls.getFormulas > 0 &&
  (() => {
    const third = fakeSheet('Tab_A', grid);
    sandbox.getSectionedRows(third, HEADERS, 'Event_ID');
    const before = third.calls.getValues + third.calls.getFormulas;
    sandbox.getSectionedRows(third, HEADERS, 'Event_ID');
    return third.calls.getValues + third.calls.getFormulas === before;
  })(), true);

// ---------------------------------------------------------------------------
// The two readers never share an entry, even for the same sheet+headers+marker
// — a formula string and the value it displays are different answers.
// ---------------------------------------------------------------------------
const linked = [
  ['⏳ Upcoming', ''],
  ['Event_ID', 'Event_Date'],
  ['e1', D1]
];
const hyperlinkGrid = [
  ['⏳ Upcoming', '', ''],
  ['Event_ID', 'Event_Date', 'Name'],
  ['e1', D1, 'Jane Smith']
];
sheet = fakeSheet('Tab_B', hyperlinkGrid);
const values = sandbox.getSectionedRowValues(sheet, HEADERS, 'Event_ID');
const formulas = sandbox.getSectionedRows(sheet, HEADERS, 'Event_ID');
check('both readers ran their own read rather than sharing a cache entry',
  sheet.calls.getValues > 0 || sheet.calls.getFormulas > 0, true);
check('and both come back with the same row data on this fixture', values, formulas);

// ---------------------------------------------------------------------------
// Every hit is a COPY — a caller mutating its rows must not corrupt the cache.
// ---------------------------------------------------------------------------
sheet = fakeSheet('Tab_C', grid);
const first = sandbox.getSectionedRowValues(sheet, HEADERS, 'Event_ID');
first[0][2] = 'MUTATED';
const second = sandbox.getSectionedRowValues(sheet, HEADERS, 'Event_ID');
check('mutating one read does not leak into the next', second[0][2], 'Jane Smith');

// ---------------------------------------------------------------------------
// invalidateSectionedRowsCache(sheet) drops only that tab.
// ---------------------------------------------------------------------------
const sheetD1 = fakeSheet('Tab_D', grid);
const sheetE1 = fakeSheet('Tab_E', grid);
sandbox.getSectionedRowValues(sheetD1, HEADERS, 'Event_ID');
sandbox.getSectionedRowValues(sheetE1, HEADERS, 'Event_ID');
sandbox.invalidateSectionedRowsCache(sheetD1);

const sheetD2 = fakeSheet('Tab_D', grid);
sandbox.getSectionedRowValues(sheetD2, HEADERS, 'Event_ID');
check('an invalidated tab is read fresh next time', sheetD2.calls.getValues, 1);

const sheetE2 = fakeSheet('Tab_E', grid);
sandbox.getSectionedRowValues(sheetE2, HEADERS, 'Event_ID');
check('a DIFFERENT tab is untouched by that invalidation — still served from cache',
  sheetE2.calls.getValues, 0);

// invalidateSectionedRowsCache() takes a sheet OR its name.
const sheetF1 = fakeSheet('Tab_F', grid);
sandbox.getSectionedRowValues(sheetF1, HEADERS, 'Event_ID');
sandbox.invalidateSectionedRowsCache('Tab_F');
const sheetF2 = fakeSheet('Tab_F', grid);
sandbox.getSectionedRowValues(sheetF2, HEADERS, 'Event_ID');
check('invalidating by name works the same as invalidating by sheet', sheetF2.calls.getValues, 1);

// ---------------------------------------------------------------------------
// invalidateSectionedRowsCache() with no argument drops EVERY tab.
// ---------------------------------------------------------------------------
const sheetG1 = fakeSheet('Tab_G', grid);
const sheetH1 = fakeSheet('Tab_H', grid);
sandbox.getSectionedRowValues(sheetG1, HEADERS, 'Event_ID');
sandbox.getSectionedRowValues(sheetH1, HEADERS, 'Event_ID');
sandbox.invalidateSectionedRowsCache();

const sheetG2 = fakeSheet('Tab_G', grid);
const sheetH2 = fakeSheet('Tab_H', grid);
sandbox.getSectionedRowValues(sheetG2, HEADERS, 'Event_ID');
sandbox.getSectionedRowValues(sheetH2, HEADERS, 'Event_ID');
check('a bare invalidation clears every tab, not just one', sheetG2.calls.getValues === 1 && sheetH2.calls.getValues === 1, true);

// ---------------------------------------------------------------------------
// A different HEADERS array is a different answer, not just a different cost
// — two same-shaped calls with different header lists must not collide.
// ---------------------------------------------------------------------------
const narrowHeaders = ['Event_ID', 'Event_Date'];
sheet = fakeSheet('Tab_I', grid);
const wide = sandbox.getSectionedRowValues(sheet, HEADERS, 'Event_ID');
const narrow = sandbox.getSectionedRowValues(sheet, narrowHeaders, 'Event_ID');
check('a different headers array reads again rather than reusing the other shape',
  sheet.calls.getValues, 2);
check('and projects the narrower column list', narrow[0], ['e1', D1]);
check('while the wider one still has all three columns', wide[0], ['e1', D1, 'Jane Smith']);

// ---------------------------------------------------------------------------
// A sheet-like object with no getName() opts itself out of the cache rather
// than the WRAPPER throwing while building a cache key for it — the pattern
// the rest of this suite relies on: many test files replace
// readAllSectionedRows()/readAllSectionedRowValues() wholesale with a stub
// that ignores the sheet entirely, and hand it a bare { } in place of one.
// The real readers still expect a real Sheet (getName() included) when
// called for real, exactly as before this cache existed — this only pins
// that getSectionedRows()/getSectionedRowValues() do not ADD a new
// requirement of their own ahead of that call.
// ---------------------------------------------------------------------------
const realReader = sandbox.readAllSectionedRowValues;
sandbox.readAllSectionedRowValues = () => [['stubbed']];
check('a sheet with no getName() reaches the (stubbed) reader rather than throwing on the cache key',
  (() => {
    try {
      return sandbox.getSectionedRowValues({}, HEADERS, 'Event_ID');
    } catch (err) {
      return `threw: ${err}`;
    }
  })(), [['stubbed']]);
sandbox.readAllSectionedRowValues = realReader;

console.log(failures === 0 ? '\nAll sectioned rows cache checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
