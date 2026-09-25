// ============================================================================
// SECTION 99u: A TAB IS NEVER EMPTY WHILE IT IS BEING REDRAWN
// ============================================================================
//
// Every tab this workbook draws was drawn the same way: `sheet.clear()`, then
// banner, header, rows, formatting — dozens to hundreds of calls. Apps Script
// stops an execution at its ceiling with no warning, no exception and no
// `finally`, so a run killed anywhere between the clear and the rows' own
// setValues() left the tab EMPTY. On a derived tab that costs an hour; on
// All_Registrants and All_Program_Sessions it costs the data, because the next
// render reads the tab to rebuild it, finds nothing, and writes nothing back —
// and `99j`'s guard cannot object to going from zero to zero. That is what a
// run on 25 September 2026 did to the dashboard, the session table and the
// registrant tab at once.
//
// So the clear is gone, and its CONTENTS half is done by writing. Before any
// formatting, the caller hands `writeTabValuesBeforeRender_()` the values the
// render is about to produce, placed where it will produce them, and ONE
// setValues() — atomic, it lands whole or not at all — writes them padded with
// blanks over everything the tab used to hold. At every moment after that the
// tab holds a complete, readable copy of the new rows; the real render then
// writes the same cells again, with its formatting, exactly as it always did.
//
// THE ONE RULE A CALLER MUST KEEP: a non-blank cell may be placed only where
// the real render will write that same cell. A blank is always safe (it is
// what clear() would have left). So callers place their data TABLES — the part
// worth protecting — at the row the render will use, and leave hero blocks and
// summaries above them blank for the render to fill. Each caller compares its
// prediction with where the render actually landed and logs a mismatch, and
// `tests/write_before_clear.test.js` holds every renderer to the rule.
//
// Validations must be cleared BEFORE the call: a value landing in a cell whose
// old rule rejects it throws. And if the write fails for any reason, this
// falls back to clearContents() — the old behaviour — rather than throwing,
// because a render that used to work must not start failing here.
// ============================================================================

/**
 * `blocks` is [{ row, col?, values }] — 1-based row/col, `values` a 2-D array
 * (ragged rows allowed). Writes them in one call over the union of the blocks
 * and the tab's current used range, blanks everywhere else. Returns true when
 * the values landed, false when it fell back to clearing the contents.
 */
function writeTabValuesBeforeRender_(sheet, blocks) {
  try {
    const grid = composeTabValueGrid_(blocks);
    const height = Math.max(grid.length, sheet.getLastRow());
    const width = Math.max(grid.reduce((w, r) => Math.max(w, r.length), 0), sheet.getLastColumn());
    if (height < 1 || width < 1) return true;

    // setValues() past the edge of the grid throws; clear() never needed room.
    if (sheet.getMaxRows() < height) sheet.insertRowsAfter(sheet.getMaxRows(), height - sheet.getMaxRows());
    if (sheet.getMaxColumns() < width) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    }

    const padded = new Array(height);
    for (let r = 0; r < height; r++) {
      const src = grid[r] || [];
      const line = new Array(width);
      for (let c = 0; c < width; c++) {
        const v = src[c];
        line[c] = v === undefined || v === null ? '' : v;
      }
      padded[r] = line;
    }
    sheet.getRange(1, 1, height, width).setValues(padded);
    return true;
  } catch (err) {
    log(`ℹ️ Could not write "${safeSheetName_(sheet)}" before redrawing it (${err}) — clearing it first instead.`);
    sheet.clearContents();
    return false;
  }
}

/** The blocks as one row-major grid (0-based), later blocks winning. Pure. */
function composeTabValueGrid_(blocks) {
  const grid = [];
  (blocks || []).forEach(block => {
    if (!block || !block.values) return;
    const col0 = (block.col || 1) - 1;
    block.values.forEach((line, i) => {
      const r = block.row - 1 + i;
      if (r < 0) return;
      grid[r] = grid[r] || [];
      (line || []).forEach((v, c) => { grid[r][col0 + c] = v; });
    });
  });
  for (let r = 0; r < grid.length; r++) grid[r] = grid[r] || [];
  return grid;
}

/**
 * The values writeUpcomingPastSections() (34) lays down from `startRow`:
 * banner, header, upcoming rows, a spacer, banner, header, past rows. Only the
 * banner TEXT in column 1 — the rest of a banner row is blank, as it is after
 * the render. Returned as one block.
 */
function sectionedTableValueBlock_(startRow, headers, upcoming, past, options) {
  options = options || {};
  const values = [];
  values.push([options.upcomingLabel || '⏳ Upcoming']);
  values.push(headers.slice());
  upcoming.forEach(r => values.push(r));
  values.push([]);
  values.push([options.pastLabel || '🕓 Past']);
  values.push(headers.slice());
  past.forEach(r => values.push(r));
  return { row: startRow, values };
}

/** Where sectionedTableValueBlock_() puts the upcoming header row. */
function sectionedTableHeaderRow_(startRow) {
  return startRow + 1;
}

/** Logs when a render did not land where its early write predicted. */
function checkPredictedTableRow_(sheet, predictedHeaderRow, actualHeaderRow) {
  if (predictedHeaderRow === actualHeaderRow) return true;
  log(`⚠️ "${safeSheetName_(sheet)}" was redrawn with its table at row ${actualHeaderRow}, ` +
    `but written early at row ${predictedHeaderRow} — some cells may hold leftover values until the next redraw.`);
  return false;
}

function safeSheetName_(sheet) {
  try { return sheet.getName(); } catch (err) { return 'a tab'; }
}
