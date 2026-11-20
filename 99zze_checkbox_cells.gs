// ============================================================================
// 99zze. A TICK BOX THAT READS "false"  (checkbox cells kept boolean — Nov 2026)
// ============================================================================
//
// WHAT STAFF SAW. On All_Registrants, row after row showed the word "false"
// (or "true") with a red corner where the Attended / Lunch_Served / Contacted /
// Confirmed / Waitlisted / Dropped tick box should be. On 20 Nov 2026 that was
// 2,882 of the tab's ~3,600 rows, upcoming and past alike, and 426 of them were
// real Attended ticks reading as the word "true".
//
// WHAT THE CELLS HELD. Not a boolean: the TEXT "false", in a cell whose number
// format was Plain text ('@'). The checkbox rule wants TRUE/FALSE, so Sheets
// drew the text with an invalid-data marker instead of a box. Lowercase is the
// tell: that is JavaScript's String(false), which is what a setValues() of a
// real boolean leaves in a cell already formatted as text.
//
// WHERE THE '@' CAME FROM. formatRegistrantGroupDividers_() (99zs) stamped every
// program heading row Plain text across all 38 columns. Headings move on every
// render (a new sign-up pushes every block below it down a row), and the
// stamp outlived the rows it was put on: the render's clearFormats() did not
// take it back off (the live tab shows it on blank spacer rows and on rows no
// heading occupies today). So each render left a new scatter of text-formatted
// rows, the next render's values landed in them as text, and the text was read
// back and written out again. The desk's in-place insert (38) added more: rows
// inserted under a heading inherited the heading's format before their values
// went in.
//
// THE FIX, three parts:
//   1. The headings are no longer stamped as text (99zs). The '▸ ' marker
//      already keeps a label like "▸ December 2026 Social" from parsing as a
//      date, and the stamp landed after the values anyway, so it protected
//      nothing.
//   2. Before a registrant tab's values are written, the tick-box columns are
//      given an explicit number format (CHECKBOX_CELL_NUMBER_FORMAT), whatever
//      an earlier render left on them, so a boolean written there stays one.
//      The same goes for the desk's in-place insert (38).
//   3. Every row on its way to the tab has its tick-box cells read as booleans
//      ("false", "FALSE", " true " → false/true). That is the REPAIR: the next
//      full render of All_Registrants turns every broken cell back into a box,
//      with its tick (or lack of one) intact. Nothing else is changed on a row.
//
// Self-contained: the column list is read at CALL time, so this file may load
// in any order (see the top of CLAUDE.md).
// ============================================================================

/**
 * The number format the tick-box columns are given before values land. Any
 * non-text pattern would do: a checkbox draws a boolean the same way under
 * all of them. '0' is the project's ordinary whole-number pattern, and the one
 * the live tab already carries on the columns beside these.
 */
const CHECKBOX_CELL_NUMBER_FORMAT = '0';

/** The registrant columns drawn as tick boxes: the day-of marks and the leader's four. */
function registrantCheckboxColumns_() {
  return REGISTRANT_DAYOF_COLUMNS.concat(LEADER_FLAG_COLUMNS);
}

/**
 * A tick-box cell's value as the boolean it means, when it is one written as
 * words. A real boolean, a blank, and anything that is not true/false (a
 * leader's "x", a 1) are returned exactly as they came: those are read by
 * isTruthyCheckbox() everywhere already, and this is a repair of one known
 * fault, not a reinterpretation of the column.
 */
function checkboxCellValue_(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return value;
}

/**
 * Rewrites, in place, the named tick-box columns of `rows` from words to
 * booleans. Heading rows (99zs) are skipped. Returns how many cells changed,
 * so a caller can say so. Never throws.
 */
function coerceCheckboxColumns_(rows, headers, columns) {
  if (!rows || !rows.length || !headers) return 0;
  const idx = (columns || []).map(h => headers.indexOf(h)).filter(i => i >= 0);
  if (!idx.length) return 0;
  let changed = 0;
  rows.forEach(row => {
    if (!row || isSectionedDividerValue(row[0])) return;
    idx.forEach(i => {
      const before = row[i];
      const after = checkboxCellValue_(before);
      if (after !== before) {
        row[i] = after;
        changed++;
      }
    });
  });
  return changed;
}

/**
 * The 1-based column runs the named headers occupy, contiguous ones merged:
 * Attended/Lunch_Served and the leader's four are two runs on All_Registrants,
 * so the stamp below is two calls rather than six. Pure.
 */
function checkboxColumnRuns_(headers, columns) {
  const cols = (columns || [])
    .map(h => (headers || []).indexOf(h) + 1)
    .filter(c => c > 0)
    .sort((a, b) => a - b);
  const runs = [];
  cols.forEach(c => {
    const last = runs[runs.length - 1];
    if (last && c === last.col + last.count) last.count++;
    else if (!last || c >= last.col + last.count) runs.push({ col: c, count: 1 });
  });
  return runs;
}

/**
 * Gives the tick-box columns of rows [startRow, startRow+numRows-1] a number
 * format that is not Plain text. DIRECT, never staged into a render batch (97):
 * it has to be on the cells BEFORE the values are written, and a staged format
 * lands after. Cosmetic-safe: a failure is logged and the write goes ahead.
 */
function stampCheckboxColumns_(sheet, headers, columns, startRow, numRows) {
  if (!sheet || !numRows || numRows < 1 || !startRow) return 0;
  let stamped = 0;
  checkboxColumnRuns_(headers, columns).forEach(run => {
    try {
      sheet.getRange(startRow, run.col, numRows, run.count).setNumberFormat(CHECKBOX_CELL_NUMBER_FORMAT);
      stamped++;
    } catch (err) {
      log(`ℹ️ Could not clear the text format off the tick-box columns of ` +
        `"${sheet.getName ? sheet.getName() : ''}" (${err}).`);
    }
  });
  return stamped;
}
