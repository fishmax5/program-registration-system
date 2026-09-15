// ============================================================================
// A SHEET THAT REMEMBERS WHAT IT WAS ASKED FOR
// ============================================================================
//
// Every optimization in this project's sync path is an argument about ROUND
// TRIPS: not how much JavaScript runs, but how many times the script stops and
// asks the Sheets service a question. That is the number a person feels, and
// it is the one number the ordinary tests never look at — they stub a sheet to
// make an assertion about VALUES and are rightly indifferent to how many calls
// it took to reach them.
//
// So this is a stub of the same shape that also counts. It backs a real 2-D
// grid, answers getValues()/getFormulas()/setValues()/setValue() honestly
// against it, and tallies each call and the cells it moved. tools/sync_bench.js
// drives the real reconcile passes against one of these and prints the tally,
// which is what makes "this is faster" a measurement rather than a claim.
//
// FORMULAS ARE MODELLED, because the distinction is load-bearing in the code
// under measurement: a cell holding "=HYPERLINK(...)" reads back through
// getValues() as the words it displays and through getFormulas() as the
// formula. updateRegistrationLinkCells() writes those columns one cell at a
// time precisely because of that, so a stub that flattened the difference
// would measure a problem that isn't there — and would let a wrong fix pass.
// ============================================================================

/** The display text a formula cell reads back as through getValues(). */
function displayTextOf(formula) {
  const link = /^=HYPERLINK\(\s*"[^"]*"\s*,\s*"([^"]*)"\s*\)$/i.exec(String(formula));
  return link ? link[1] : '';
}

function isFormula(value) {
  return typeof value === 'string' && value.charAt(0) === '=';
}

/**
 * A counting Sheet over `grid` (an array of rows of cell values; a string
 * beginning with "=" is treated as a formula).
 *
 * The grid is held by reference and mutated in place, so a caller can read it
 * back afterwards to check that a faster path wrote the same cells as a slower
 * one — which is the other half of what a benchmark has to prove.
 */
let __countingSheetSerial = 0;

/**
 * Setters a Range has and a RangeList does not. Anything named here reads back
 * as undefined off a range list, exactly as it does in Apps Script — see the
 * note at getRangeList() below for the bug that cost.
 */
const RANGE_LIST_MISSING_METHODS = ['setDataValidation', 'setValue', 'setValues', 'getValues'];

function makeCountingSheet(grid, name, options) {
  options = options || {};
  __countingSheetSerial++;
  const fileId = options.fileId || `file-${__countingSheetSerial}`;
  const sheetId = options.sheetId === undefined ? __countingSheetSerial : options.sheetId;
  const stats = {
    getValues: 0, getFormulas: 0, setValues: 0, setValue: 0,
    cellsRead: 0, cellsWritten: 0,
    getLastRow: 0, getLastColumn: 0, getRange: 0,
    // Calls that move no data but still cross the wire — see the Proxy below.
    formatting: 0,
    // The same idea one level up: setRowHeights, autoResizeColumns,
    // getColumnWidth, protect(), setConditionalFormatRules — calls made on the
    // SHEET rather than on a Range. A render is mostly these, so a harness
    // that counted only Range calls would report a render as nearly free.
    sheetOps: 0
  };

  const width = () => grid.reduce((w, row) => Math.max(w, row.length), 0);
  const cell = (r, c) => {
    const row = grid[r];
    const v = row ? row[c] : undefined;
    return v === undefined ? '' : v;
  };

  const protections = [];
  // Every formatting call this sheet was asked for, in order — see the Proxy
  // below. Read back as `sheet.calls` by anything asserting on WHAT a render
  // wrote rather than on how many calls it took.
  const calls = [];

  const sheet = {
    stats,
    grid,
    getName: () => name || 'All_Program_Sessions',
    getLastRow: () => { stats.getLastRow++; return grid.length; },
    getLastColumn: () => { stats.getLastColumn++; return width(); },
    getRange(row, col, numRows, numCols) {
      stats.getRange++;
      const rows = numRows === undefined ? 1 : numRows;
      const cols = numCols === undefined ? 1 : numCols;
      const range = {
        getValues() {
          stats.getValues++;
          stats.cellsRead += rows * cols;
          const out = [];
          for (let r = 0; r < rows; r++) {
            const line = [];
            for (let c = 0; c < cols; c++) {
              const v = cell(row - 1 + r, col - 1 + c);
              line.push(isFormula(v) ? displayTextOf(v) : v);
            }
            out.push(line);
          }
          return out;
        },
        getFormulas() {
          stats.getFormulas++;
          stats.cellsRead += rows * cols;
          const out = [];
          for (let r = 0; r < rows; r++) {
            const line = [];
            for (let c = 0; c < cols; c++) {
              const v = cell(row - 1 + r, col - 1 + c);
              line.push(isFormula(v) ? v : '');
            }
            out.push(line);
          }
          return out;
        },
        getValue() {
          stats.getValues++;
          stats.cellsRead += 1;
          const v = cell(row - 1, col - 1);
          return isFormula(v) ? displayTextOf(v) : v;
        },
        setValues(values) {
          stats.setValues++;
          stats.cellsWritten += rows * cols;
          calls.push({ name: 'setValues', row, col, rows, cols, args: [values] });
          for (let r = 0; r < rows; r++) {
            if (!grid[row - 1 + r]) grid[row - 1 + r] = [];
            for (let c = 0; c < cols; c++) {
              grid[row - 1 + r][col - 1 + c] = values[r][c];
            }
          }
          return proxy;
        },
        setValue(value) {
          stats.setValue++;
          stats.cellsWritten += 1;
          calls.push({ name: 'setValue', row, col, rows: 1, cols: 1, args: [value] });
          if (!grid[row - 1]) grid[row - 1] = [];
          grid[row - 1][col - 1] = value;
          return proxy;
        },
        getRow: () => row,
        getColumn: () => col,
        getNumRows: () => rows,
        getNumColumns: () => cols,
        getA1Notation: () => `R${row}C${col}`,
        // MODELLED, not merely counted, because the question a render bench
        // has to answer about protections is whether the NEXT render rebuilds
        // them. That needs getProtections() to hand back what protect() made.
        protect() {
          stats.sheetOps++;
          const p = {
            __a1: `R${row}C${col}:${rows}x${cols}`,
            __description: '',
            setDescription(text) { stats.sheetOps++; p.__description = text; return p; },
            setWarningOnly() { stats.sheetOps++; return p; },
            getDescription: () => p.__description,
            getRange: () => proxy,
            remove() { stats.sheetOps++; const i = protections.indexOf(p); if (i >= 0) protections.splice(i, 1); }
          };
          protections.push(p);
          return p;
        }
      };
      // FORMATTING IS COUNTED, NOT MODELLED. A render makes dozens of calls
      // that move no data — setBackground, clearNote, setFontWeight, the
      // borders, the number formats — and stubbing each one by name is how a
      // harness like this rots: the next call the code learns to make throws,
      // in a file nobody thinks of as part of the feature. So anything not
      // implemented above is answered generically, chained like the real
      // Range, and tallied under `formatting` — which is the honest place for
      // it, since a round trip that changes no cell still costs a round trip.
      const proxy = new Proxy(range, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop !== 'string') return undefined;
          return (...args) => {
            stats.formatting++;
            // WHAT was asked for, not only how often. A render's correctness
            // now lives in the ARGUMENTS of a handful of batched calls rather
            // than in which of a hundred small ones happened, so a test has to
            // be able to look at them. Recorded for every non-getter.
            if (!/^(get|is)[A-Z]/.test(prop)) {
              calls.push({ name: prop, row, col, rows, cols, args });
            }
            // A getter is asked for a value, not for chaining. Only the
            // setters and the clears hand the range back, and they hand back
            // the PROXY — a real Range chains indefinitely, and returning the
            // bare object would break on the second call in a chain.
            if (/^(get|is)[A-Z]/.test(prop)) return prop.startsWith('is') ? false : null;
            return proxy;
          };
        }
      });
      return proxy;
    }
  };

  // ==========================================================================
  // THE SHEET ITSELF IS COUNTED TOO.
  //
  // A tab rewrite is not mostly getValues/setValues. It is setRowHeights, a
  // column of data validations, autoResizeColumns, one getColumnWidth per
  // column, a protection created per column per zone, and a conditional-format
  // rule list — every one of them a stop-and-wait on the Sheets service, and
  // none of them a Range call. Counting only the Range surface measured a
  // render as almost free, which is the opposite of what a render is.
  //
  // Same bargain as the Range proxy below it: the calls that have to answer
  // honestly are written out, and everything else is answered generically,
  // chained, and tallied.
  // ==========================================================================
  const columnWidths = {};
  const bandings = [];
  const sheetImpl = Object.assign(sheet, {
    getMaxRows: () => Math.max(grid.length, 1000),
    getMaxColumns: () => Math.max(width(), 26),
    getBandings: () => { stats.sheetOps++; return bandings.slice(); },
    getProtections: () => { stats.sheetOps++; return protections.slice(); },
    getColumnWidth: col => { stats.sheetOps++; return columnWidths[col] || 100; },
    setColumnWidth: (col, px) => { stats.sheetOps++; columnWidths[col] = px; return sheetProxy; },
    setColumnWidths: (col, n, px) => {
      stats.sheetOps++;
      for (let i = 0; i < n; i++) columnWidths[col + i] = px;
      return sheetProxy;
    },
    clear: () => { stats.sheetOps++; grid.length = 0; return sheetProxy; },
    // A file id and a sheet id, because code under measurement legitimately
    // keys on them — the same tab NAME lives in forty different spreadsheets
    // (every program registrant sheet is a "Sign_Up_Sheet"), so a harness that
    // could not tell two of them apart would hide exactly that bug.
    getSheetId: () => sheetId,
    // MODELLED, because it is the whole point of some of the code measured
    // here: getRangeList() applies one setter to many ranges in ONE call, so a
    // harness that counted it per range would report the batched version as no
    // better than the loop it replaced.
    getRangeList: a1List => {
      stats.sheetOps++;
      const list = new Proxy({ __a1: a1List.slice() }, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop !== 'string') return undefined;
          // A RangeList IS NOT A RANGE, and the difference is not academic: it
          // carries the formatting setters and NOT setDataValidation. A proxy
          // that answered every name let a batched rewrite of the registrant
          // sheet ship calling it, which threw "ticks.setDataValidation is not
          // a function" on every sheet, every hour. insertCheckboxes() is the
          // call a RangeList does have; this keeps the harness honest about
          // which of the two the code under measurement reached for.
          if (RANGE_LIST_MISSING_METHODS.indexOf(prop) !== -1) return undefined;
          return (...args) => {
            stats.sheetOps++;
            calls.push({ name: `rangeList.${prop}`, ranges: a1List.slice(), args });
            if (/^(get|is)[A-Z]/.test(prop)) return null;
            return list;
          };
        }
      });
      return list;
    },
    getParent: () => ({ getId: () => fileId, getSheetByName: () => sheetProxy, toast: () => {} })
  });

  const sheetProxy = new Proxy(sheetImpl, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      return () => {
        stats.sheetOps++;
        if (/^(get|is)[A-Z]/.test(prop)) return prop.startsWith('is') ? false : null;
        return sheetProxy;
      };
    }
  });

  // What Range.protect() hands back: a Protection this harness can list again
  // on the next render, which is what makes "the protections were rebuilt"
  // and "they were left alone" two different numbers.
  sheet.__protections = protections;
  sheet.calls = calls;
  return sheetProxy;
}

/**
 * Total service round trips — the number the benchmark is actually about.
 *
 * FORMATTING COUNTS. A setBackground() that changes no cell still stops the
 * script and waits for Sheets, so leaving it out would flatter a render (which
 * is mostly formatting) and say nothing useful about it. The data-only tally
 * is still there under the individual counters for anything that wants it.
 */
function roundTrips(stats) {
  return stats.getValues + stats.getFormulas + stats.setValues + stats.setValue +
    stats.getLastRow + stats.getLastColumn + stats.formatting + stats.sheetOps;
}

module.exports = { makeCountingSheet, roundTrips, displayTextOf };
