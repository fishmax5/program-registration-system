// readAllSectionedRowValues() is the read that took Quick Mark's open from a
// twenty-second wait down to something the sign-in desk doesn't notice: ONE
// getValues() of the whole tab, instead of findAllHeaderRows()'s whole-grid
// read plus a getValues() AND a getFormulas() per sub-table.
//
// Cheaper is only worth anything if it is also the same answer, so what this
// file pins is that it agrees with readAllSectionedRows() row for row — across
// stacked sub-tables, banner and spacer rows, a re-ordered header row, and a
// column the sheet doesn't have yet — and that it COUNTS THE CALLS it makes.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

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
;this.readAllSectionedRows = readAllSectionedRows;
this.readAllSectionedRowValues = readAllSectionedRowValues;
`, sandbox, { filename: 'Code.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

/**
 * A fake sheet over a literal grid, counting every range read so the whole
 * point of the new reader — how many round trips it costs — is testable and
 * not just asserted in a comment.
 */
function fakeSheet(grid, formulas) {
  const calls = { getValues: 0, getFormulas: 0 };
  const lastCol = Math.max(...grid.map(r => r.length));
  const cell = (r, c) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : '');
  return {
    calls,
    getName: () => 'Fake_Tab',
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
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const f = formulas && formulas[row - 1 + r] && formulas[row - 1 + r][col - 1 + c];
            line.push(f || '');
          }
          out.push(line);
        }
        return out;
      }
    })
  };
}

const HEADERS = ['Event_ID', 'Event_Date', 'Name'];
const D1 = new Date(2026, 8, 16);
const D2 = new Date(2026, 8, 23);
const D3 = new Date(2026, 7, 5);

// Two stacked sub-tables, each with its own Event_ID header row, a banner
// above each and a spacer between them — the shape every date-bearing tab in
// this workbook has.
const grid = [
  ['⏳ Upcoming', '', ''],
  ['Event_ID', 'Event_Date', 'Name'],
  ['e1', D1, 'Jane Smith'],
  ['e2', D2, 'Bob Vance'],
  ['', '', ''],
  ['🕓 Past', '', ''],
  ['Event_ID', 'Event_Date', 'Name'],
  ['e3', D3, 'Old Timer']
];

const plain = fakeSheet(grid);
const fast = fakeSheet(grid);
// Read ONCE each, so the call counts below are the cost of a single read.
const fastRows = sandbox.readAllSectionedRowValues(fast, HEADERS, 'Event_ID');
const plainRows = sandbox.readAllSectionedRows(plain, HEADERS, 'Event_ID');
const expected = [['e1', D1, 'Jane Smith'], ['e2', D2, 'Bob Vance'], ['e3', D3, 'Old Timer']];

check('both sub-tables, banners and spacers dropped', fastRows, expected);
check('which is exactly what the formula-preserving reader returns', plainRows, expected);

// The whole reason it exists: the call count.
check('ONE read for the whole tab', fast.calls.getValues, 1);
check('and no formula read at all', fast.calls.getFormulas, 0);
// 1 whole-grid read to find the header rows, then a header read, a values read
// and a formulas read per sub-table.
check('against seven for the formula-preserving one',
  plain.calls.getValues + plain.calls.getFormulas, 7);

// A HYPERLINK in a cell is exactly the difference between the two readers, and
// the values reader is the RIGHT one for a consumer that only wants to look:
// Registrant_Dash's Event_Time is a formula, and the formula string is not a
// time anything can parse.
const linked = fakeSheet(grid, { 2: { 2: '=HYPERLINK("http://x","Jane Smith")' } });
check('the values reader hands back what the cell shows',
  sandbox.readAllSectionedRowValues(linked, HEADERS, 'Event_ID')[0][2], 'Jane Smith');
check('and the formula-preserving one hands back the formula',
  sandbox.readAllSectionedRows(fakeSheet(grid, { 2: { 2: '=HYPERLINK("http://x","Jane Smith")' } }),
    HEADERS, 'Event_ID')[0][2], '=HYPERLINK("http://x","Jane Smith")');

// A header row in a DIFFERENT order, and missing a column the code expects.
// Both readers project by header NAME — the thing that keeps a HEADERS edit
// safe on a workbook that already holds data — so the fast one has to as well.
const shuffled = [
  ['⏳ Upcoming', '', ''],
  ['Name', 'Event_ID', 'Event_Date'],
  ['Jane Smith', 'e1', D1]
];
check('a re-ordered header row is projected back into HEADERS order',
  sandbox.readAllSectionedRowValues(fakeSheet(shuffled), HEADERS, 'Event_ID'),
  [['e1', D1, 'Jane Smith']]);

const missing = [
  ['⏳ Upcoming', '', ''],
  ['Event_ID', 'Event_Date'],
  ['e1', D1]
];
check('a column the sheet does not have yet comes back blank, not undefined',
  sandbox.readAllSectionedRowValues(fakeSheet(missing), HEADERS, 'Event_ID'),
  [['e1', D1, '']]);

check('an empty tab is no rows, not a throw',
  sandbox.readAllSectionedRowValues(fakeSheet([]), HEADERS, 'Event_ID'), []);
check('and so is a tab with no header row on it at all',
  sandbox.readAllSectionedRowValues(fakeSheet([['nothing here', '', '']]), HEADERS, 'Event_ID'), []);

console.log(failures === 0 ? '\nAll sectioned value reader checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
