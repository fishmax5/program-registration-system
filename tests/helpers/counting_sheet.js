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
function makeCountingSheet(grid, name) {
  const stats = {
    getValues: 0, getFormulas: 0, setValues: 0, setValue: 0,
    cellsRead: 0, cellsWritten: 0,
    getLastRow: 0, getLastColumn: 0, getRange: 0
  };

  const width = () => grid.reduce((w, row) => Math.max(w, row.length), 0);
  const cell = (r, c) => {
    const row = grid[r];
    const v = row ? row[c] : undefined;
    return v === undefined ? '' : v;
  };

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
      return {
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
          for (let r = 0; r < rows; r++) {
            if (!grid[row - 1 + r]) grid[row - 1 + r] = [];
            for (let c = 0; c < cols; c++) {
              grid[row - 1 + r][col - 1 + c] = values[r][c];
            }
          }
          return this;
        },
        setValue(value) {
          stats.setValue++;
          stats.cellsWritten += 1;
          if (!grid[row - 1]) grid[row - 1] = [];
          grid[row - 1][col - 1] = value;
          return this;
        },
        // Formatting calls are counted as round trips but change no data.
        setBackground() { return this; },
        setFontWeight() { return this; },
        setNote() { return this; },
        setNumberFormat() { return this; },
        clearDataValidations() { return this; },
        setDataValidation() { return this; }
      };
    }
  };
  return sheet;
}

/** Total service round trips — the number the benchmark is actually about. */
function roundTrips(stats) {
  return stats.getValues + stats.getFormulas + stats.setValues + stats.setValue +
    stats.getLastRow + stats.getLastColumn;
}

module.exports = { makeCountingSheet, roundTrips, displayTextOf };
