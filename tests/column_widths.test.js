// A column width set by hand used to survive exactly until the next render,
// which re-fitted every column to its contents. Saved widths are the way to
// say "this one is this wide, always" — and the whole of their correctness is
// in three questions: is the width remembered against the right COLUMN, does
// it still find that column after the layout moves, and does it beat the
// autofit rather than the other way round.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => d.toISOString(), sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.captureColumnWidths = captureColumnWidths;
this.applySavedColumnWidths = applySavedColumnWidths;
this.saveColumnWidthsForSheet = saveColumnWidthsForSheet;
this.clearSavedColumnWidthsForSheet = clearSavedColumnWidthsForSheet;
this.savedColumnWidthsFor = savedColumnWidthsFor;
this.findHeaderRowByNames = findHeaderRowByNames;
this.MIN_COLUMN_WIDTH_PX = MIN_COLUMN_WIDTH_PX;
this.MAX_SAVED_COLUMN_WIDTH_PX = MAX_SAVED_COLUMN_WIDTH_PX;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

/** A fake sheet over a grid and a width per column, counting the width writes. */
function fakeSheet(name, grid, widths) {
  const calls = { setColumnWidths: 0 };
  const cols = widths.slice();
  return {
    calls, widths: cols,
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => cols.length,
    getColumnWidth: col => cols[col - 1],
    setColumnWidths: (start, count, width) => {
      calls.setColumnWidths++;
      for (let i = 0; i < count; i++) cols[start - 1 + i] = width;
    },
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const v = grid[row - 1 + r] && grid[row - 1 + r][col - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      }
    })
  };
}

// Registrant_Dash's real shape: a banner, then the header row, then rows.
const grid = [
  ['⏳ Upcoming Registrants', '', '', ''],
  ['Event_Date', 'Location', 'Name', 'Admin_Notes'],
  ['', '', 'Jane Smith', 'called Tuesday']
];

// --- Finding the header row -------------------------------------------------
check('the header row is found under its banner',
  sandbox.findHeaderRowByNames(fakeSheet('T', grid, [100, 100, 100, 100]),
    ['Event_Date', 'Location', 'Name', 'Admin_Notes']), 2);
check('a banner that happens to contain one header word is not a header row',
  sandbox.findHeaderRowByNames(
    fakeSheet('T', [['Name', '', '', ''], ['Event_Date', 'Location', 'Name', 'Admin_Notes']], [100, 100, 100, 100]),
    ['Event_Date', 'Location', 'Name', 'Admin_Notes']), 2);
check('and a tab with no header row at all says so rather than guessing',
  sandbox.findHeaderRowByNames(fakeSheet('T', [['just', 'some', 'notes', '']], [100, 100, 100, 100]),
    ['Event_Date', 'Location', 'Name', 'Admin_Notes']), 0);

// --- Capturing, saving, applying -------------------------------------------
// Admin_Notes has been dragged out to 420; everything else is where the
// autofit left it.
const source = fakeSheet('Registrant_Dash', grid, [90, 110, 160, 420]);
const captured = sandbox.captureColumnWidths(source);
check('every column is captured by number', captured.byIndex, { 1: 90, 2: 110, 3: 160, 4: 420 });
check('and by header name, which is what survives a layout change',
  captured.byName, { Event_Date: 90, Location: 110, Name: 160, Admin_Notes: 420 });

sandbox.saveColumnWidthsForSheet(source, captured);
check('saved widths are readable back', !!sandbox.savedColumnWidthsFor('Registrant_Dash'), true);
check('and a tab that never saved any has none', sandbox.savedColumnWidthsFor('Lunch_Roster'), null);

// A later render has just autofitted everything narrow. The saved widths are
// applied last and are the last word.
const refitted = fakeSheet('Registrant_Dash', grid, [64, 64, 64, 64]);
const set = sandbox.applySavedColumnWidths(refitted, 4);
check('the autofit is overruled', refitted.widths, [90, 110, 160, 420]);
check('on every column that was saved', set, 4);

// THE POINT OF SAVING BY NAME. Location has been dropped and Admin_Notes has
// moved left — the width remembered as "column 4" would now land on nothing,
// and by number alone Admin_Notes would come out at 110.
const movedGrid = [
  ['⏳ Upcoming Registrants', '', ''],
  ['Event_Date', 'Admin_Notes', 'Name'],
  ['', 'called Tuesday', 'Jane Smith']
];
const moved = fakeSheet('Registrant_Dash', movedGrid, [64, 64, 64]);
sandbox.applySavedColumnWidths(moved, 3);
check('a width follows its column when the layout moves', moved.widths, [90, 420, 160]);

// --- The write count --------------------------------------------------------
// Consecutive columns wanting the same width go out as one call, the same way
// applyColumnWidthBuffer() groups its own writes.
const runs = fakeSheet('Runs', [['A', 'B', 'C', 'D']], [64, 64, 64, 64]);
sandbox.saveColumnWidthsForSheet(runs, { byName: {}, byIndex: { 1: 200, 2: 200, 3: 200, 4: 90 } });
sandbox.applySavedColumnWidths(runs, 4);
check('three columns at one width are one call, not three', runs.calls.setColumnWidths, 2);
check('and they all get it', runs.widths, [200, 200, 200, 90]);

// --- Bounds and forgetting --------------------------------------------------
const silly = fakeSheet('Silly', [['A', 'B']], [64, 64]);
sandbox.saveColumnWidthsForSheet(silly, { byName: {}, byIndex: { 1: 5, 2: 99999 } });
sandbox.applySavedColumnWidths(silly, 2);
check('an absurd width is clamped rather than honoured',
  silly.widths, [sandbox.MIN_COLUMN_WIDTH_PX, sandbox.MAX_SAVED_COLUMN_WIDTH_PX]);

sandbox.clearSavedColumnWidthsForSheet('Registrant_Dash');
check('forgetting a tab hands it back to the autofit',
  sandbox.savedColumnWidthsFor('Registrant_Dash'), null);
const untouched = fakeSheet('Registrant_Dash', grid, [64, 64, 64, 64]);
check('which is to say nothing is applied at all',
  sandbox.applySavedColumnWidths(untouched, 4), 0);
check('and no width write is made', untouched.calls.setColumnWidths, 0);

console.log(failures === 0 ? '\nAll column width checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
