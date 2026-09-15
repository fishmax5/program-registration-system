// ============================================================================
// 97. ONE TAB REWRITE, ONE CALL PER ATTRIBUTE  (withRenderBatch)
// ============================================================================
//
// A render is not expensive because of the rows it writes. Measured on a
// year of registrations — 1,280 rows, 37 columns — the setValues() that puts
// every one of those rows on the tab is FOUR round trips out of nearly five
// hundred (`tools/render_bench.js`). The other four hundred and ninety are
// formatting, applied a column at a time:
//
//   • a background matrix for the zone, then a month tint that RE-READ the
//     date column it had just been handed, then one setBackground per
//     manual-entry column;
//   • one setDataValidation per dropdown, per checkbox column, per meal
//     column — and a setHorizontalAlignment and a setNumberFormat beside most
//     of them;
//   • four calls per manual-entry column on each of the two header rows;
//
// each of them correct, each of them cheap-looking, and every one of them a
// stop-and-wait on the Sheets service. Two zones multiply the whole list by
// two, and a sync renders several tabs.
//
// THE SHAPE OF THE FIX IS THE ONE `withSessionGrid()` (96) ALREADY USES: open
// a scope, let the passes inside it stage into shared arrays, and write once
// at the end. Here the arrays are the four attribute planes of a rectangular
// BAND of rows — backgrounds, data validations, number formats, horizontal
// alignments — and the flush is one call per plane per band instead of one per
// column per attribute.
//
//   withRenderBatch(sheet, numCols, () => {
//     ... writeUpcomingPastSections(), then the tab's afterWrite hook ...
//   });                                   // ← the flush happens here
//
// WHAT MAKES THIS SAFE TO ADOPT PIECEMEAL: every stage* function below returns
// FALSE when there is no open scope, or when the range it was given does not
// sit inside a band the scope was told about. Its caller then does exactly
// what it always did. So a helper converted to ask the batch first behaves
// identically on the twenty other call sites that render nothing — the Config
// tab, an onEdit repair, a one-off dialog — and a tab that has not opened a
// scope is unchanged.
//
// TWO PLANES ARE WRITTEN WHOLE AND TWO ARE NOT, and the difference is about
// what an unstaged cell means:
//
//   • backgrounds and data validations are written for the WHOLE band. Both
//     have a well-defined "nothing here" value (the zebra color the striper
//     already computes; `null`, which clears a validation) and both tabs that
//     use this clear formats and validations before they write, so a full
//     rectangle asserts the truth rather than erasing somebody's work.
//   • number formats and horizontal alignments are written only for the
//     columns that asked, in contiguous runs. There is no safe "leave this
//     one alone" value in a setNumberFormats() matrix, and a render has no
//     business restating the format of a column it was never asked about.
//
// The validation plane shares ONE row array across every row of the band —
// validations are uniform down a column, and `setDataValidations()` only reads
// what it is given, so a 1,280-row band costs 37 references rather than 47,000.
// ============================================================================

/**
 * The open scope, or null. One at a time, per execution — a render is not
 * re-entrant, and the nested calls that do happen (a tab's afterWrite hook
 * calling a helper that opens its own) are answered by joining the outer one.
 */
let __renderBatch = null;

/**
 * Runs `fn` with a staging scope open for `sheet`, then writes what it staged.
 *
 * `numCols` bounds every plane: a band is `numCols` wide whatever column a
 * caller happens to name, so a stray column beyond the table's width is
 * refused rather than silently widening the write.
 *
 * The flush runs on the way out ONLY when `fn` returned normally. A render
 * that threw half-way has left the tab in a state this scope's arrays no
 * longer describe — writing them would be asserting a layout that is not
 * there — so the staged work is dropped and the throw carries on.
 */
function withRenderBatch(sheet, numCols, fn) {
  if (!sheet || !numCols || numCols < 1) return fn();
  const outer = __renderBatch;
  // A nested scope on the same tab joins the outer one; on a DIFFERENT tab it
  // would be a second render inside a render, which nothing here does — and
  // if it ever does, the honest answer is to leave it unbatched rather than
  // stage two tabs' bands into one set of arrays.
  if (outer) return fn();
  __renderBatch = { sheet, numCols, bands: [], headers: [] };
  const scope = __renderBatch;
  let out;
  try {
    out = fn();
  } catch (err) {
    __renderBatch = outer;
    throw err;
  }
  __renderBatch = outer;
  flushRenderBatch_(scope);
  return out;
}

/** Is a scope open for this sheet? */
function renderBatchOpenFor_(sheet) {
  return !!(__renderBatch && sheet && __renderBatch.sheet === sheet);
}

/**
 * Tells the open scope that rows [startRow, startRow+numRows-1] are one
 * rectangular band of data rows, so the stage* calls below have somewhere to
 * land. Called once per zone by writeUpcomingPastSections().
 *
 * `defaultBackground` is what an unstaged cell of the band reads as. The zebra
 * striper overwrites the whole plane immediately afterwards, so this only ever
 * shows through on a band nothing striped.
 */
function declareRenderBand(sheet, startRow, numRows, defaultBackground) {
  if (!renderBatchOpenFor_(sheet) || !startRow || numRows < 1) return false;
  const numCols = __renderBatch.numCols;
  const backgrounds = [];
  for (let r = 0; r < numRows; r++) {
    backgrounds.push(new Array(numCols).fill(defaultBackground || PALETTE.PAPER));
  }
  __renderBatch.bands.push({
    start: startRow,
    count: numRows,
    numCols,
    backgrounds,
    backgroundsDirty: false,
    validations: {},       // col (1-based) -> DataValidation
    validationsDirty: false,
    numberFormats: {},     // col -> format string
    alignments: {}         // col -> 'left' | 'center' | 'right'
  });
  return true;
}

/**
 * Tells the open scope about a HEADER row, so the per-column relabelling that
 * follows it (labelManualEntryColumns) can patch one array instead of making
 * four calls a column.
 */
function declareRenderHeaderRow(sheet, row, headerValues, defaults) {
  if (!renderBatchOpenFor_(sheet) || !row) return false;
  const numCols = __renderBatch.numCols;
  const values = new Array(numCols).fill('');
  for (let c = 0; c < numCols; c++) values[c] = (headerValues || [])[c] === undefined ? '' : headerValues[c];
  defaults = defaults || {};
  __renderBatch.headers.push({
    row,
    numCols,
    values,
    backgrounds: new Array(numCols).fill(defaults.background || PALETTE.PAPER),
    fontColors: new Array(numCols).fill(defaults.fontColor || '#000000'),
    fontWeights: new Array(numCols).fill(defaults.fontWeight || 'bold'),
    // Always written: this row's VALUES are what the declaring call was making,
    // and they only reach the tab through the flush.
    dirty: true
  });
  return true;
}

/** The declared band wholly containing [startRow, startRow+numRows-1], or null. */
function renderBandFor_(sheet, startRow, numRows) {
  if (!renderBatchOpenFor_(sheet) || !startRow || numRows < 1) return null;
  const end = startRow + numRows - 1;
  const bands = __renderBatch.bands;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (startRow >= b.start && end <= b.start + b.count - 1) return b;
  }
  return null;
}

/** The declared header row at `row`, or null. */
function renderHeaderRowFor_(sheet, row) {
  if (!renderBatchOpenFor_(sheet) || !row) return null;
  const headers = __renderBatch.headers;
  for (let i = 0; i < headers.length; i++) if (headers[i].row === row) return headers[i];
  return null;
}

/**
 * Stages a whole-band background matrix — what applyZebraStripingManualBounded()
 * hands over. `matrix` is numRows × numCols, exactly as setBackgrounds() takes.
 */
function stageRenderBackgrounds(sheet, startRow, numRows, numCols, matrix) {
  const band = renderBandFor_(sheet, startRow, numRows);
  if (!band || numCols !== band.numCols) return false;
  const offset = startRow - band.start;
  for (let r = 0; r < numRows; r++) {
    const line = band.backgrounds[offset + r];
    for (let c = 0; c < numCols; c++) line[c] = matrix[r][c];
  }
  band.backgroundsDirty = true;
  return true;
}

/**
 * Stages one column's backgrounds. `color` may be a single value for the whole
 * column or an array of one value per row — which is what a month tint is.
 */
function stageRenderColumnBackground(sheet, startRow, col, numRows, color) {
  const band = renderBandFor_(sheet, startRow, numRows);
  if (!band || !col || col < 1 || col > band.numCols) return false;
  const offset = startRow - band.start;
  const list = Array.isArray(color) ? color : null;
  for (let r = 0; r < numRows; r++) {
    band.backgrounds[offset + r][col - 1] = list ? list[r] : color;
  }
  band.backgroundsDirty = true;
  return true;
}

/** Stages one column's data validation rule (null clears it). */
function stageRenderValidation(sheet, startRow, col, numRows, rule) {
  const band = renderBandFor_(sheet, startRow, numRows);
  // A validation staged for PART of a band would be a lie once the plane is
  // written whole, so this one insists on the full height.
  if (!band || startRow !== band.start || numRows !== band.count) return false;
  if (!col || col < 1 || col > band.numCols) return false;
  band.validations[col] = rule || null;
  band.validationsDirty = true;
  return true;
}

/** Stages one column's number format. */
function stageRenderNumberFormat(sheet, startRow, col, numRows, format) {
  const band = renderBandFor_(sheet, startRow, numRows);
  if (!band || startRow !== band.start || numRows !== band.count) return false;
  if (!col || col < 1 || col > band.numCols) return false;
  band.numberFormats[col] = format;
  return true;
}

/** Stages one column's horizontal alignment. */
function stageRenderAlignment(sheet, startRow, col, numRows, align) {
  const band = renderBandFor_(sheet, startRow, numRows);
  if (!band || startRow !== band.start || numRows !== band.count) return false;
  if (!col || col < 1 || col > band.numCols) return false;
  band.alignments[col] = align;
  return true;
}

/**
 * Patches one cell of a declared header row — its text and the three
 * attributes the manual-entry label changes.
 */
function stageRenderHeaderCell(sheet, row, col, spec) {
  const header = renderHeaderRowFor_(sheet, row);
  if (!header || !col || col < 1 || col > header.numCols) return false;
  spec = spec || {};
  if (spec.value !== undefined) header.values[col - 1] = spec.value;
  if (spec.background !== undefined) header.backgrounds[col - 1] = spec.background;
  if (spec.fontColor !== undefined) header.fontColors[col - 1] = spec.fontColor;
  if (spec.fontWeight !== undefined) header.fontWeights[col - 1] = spec.fontWeight;
  header.dirty = true;
  return true;
}

/**
 * Groups `{col: value}` into contiguous column runs sharing one value, so a
 * plane written per column goes out as one call per run instead of one per
 * column. Six meal columns side by side become one call; a lone text column
 * stays one call, which is what it already was.
 */
function renderColumnRuns_(byColumn) {
  const cols = Object.keys(byColumn).map(Number).sort((a, b) => a - b);
  const runs = [];
  cols.forEach(col => {
    const value = byColumn[col];
    const last = runs[runs.length - 1];
    if (last && last.value === value && col === last.col + last.count) {
      last.count++;
      return;
    }
    runs.push({ col, count: 1, value });
  });
  return runs;
}

// ============================================================================
// ONE AUTOSIZE PER TAB PER EXECUTION
// ============================================================================
//
// autosizeColumns() is the other end of the same bill. It is one
// autoResizeColumns() over the whole tab — which on 1,280 rows is the single
// slowest thing a render asks for — followed by one getColumnWidth() per
// column to pad the fitted widths, which on a 37-column tab is 37 more round
// trips. Roughly forty, every time.
//
// And a sync renders the same tab more than once: the Registrants tab is
// written by the import, again if the triage pass moves rows off it, again by
// a Quick Mark walk-in. Every one of those re-fitted columns that had just
// been fitted.
//
// So a tab is sized ONCE per execution, and again only if the table's SHAPE
// changed under it — its last row or its column count. A render that changed
// only what is IN the cells keeps the widths the first one fitted, which is
// the trade this makes on purpose: a column a few pixels narrower than a
// longer name would like, against forty round trips per redundant render. The
// memo is a plain global, so it dies with the execution and the next sync
// fits from scratch.
//
// `force` (the caller's own "this tab has been rebuilt, size it properly"
// flag) always sizes, and clears the memo behind it.
// ============================================================================
let __autosizedShapes = {};

/**
 * Should this tab be autosized now? Records the shape when the answer is yes,
 * so the next caller in this execution can be told no.
 */
function shouldAutosizeColumns_(sheet, lastCol, force) {
  let shape;
  try {
    shape = `${sheet.getLastRow()}x${lastCol}`;
  } catch (err) {
    return true; // could not tell — size it
  }
  const name = sheet.getName();
  if (!force && __autosizedShapes[name] === shape) return false;
  __autosizedShapes[name] = shape;
  return true;
}

/** Drops the memo — for a test, and for anything that rewrites a tab wholesale. */
function invalidateAutosizeMemo(sheetName) {
  if (sheetName) delete __autosizedShapes[sheetName];
  else __autosizedShapes = {};
}

/**
 * The three per-column attributes a render sets together — a validation, an
 * alignment, a number format — staged when a scope is open and written the old
 * way when it is not.
 *
 * This is what the checkbox and meal-quantity loops on the registrant and
 * session tabs used to do inline, three chained calls at a time, once per
 * column per zone. Omit an attribute to leave it alone.
 */
function applyBoundedColumnFormat(sheet, colIndex, startRow, numRows, spec) {
  if (!colIndex || colIndex < 1 || numRows < 1) return;
  spec = spec || {};
  const has = key => Object.prototype.hasOwnProperty.call(spec, key);
  // ALL OR NOTHING. All three planes want the WHOLE band — a column staged for
  // part of one would be overwritten when the plane is written whole — so the
  // decision is made once, up front, rather than per attribute: a column half
  // staged and half written directly is a column written twice.
  const band = renderBandFor_(sheet, startRow, numRows);
  if (band && startRow === band.start && numRows === band.count &&
      colIndex >= 1 && colIndex <= band.numCols) {
    if (has('validation')) stageRenderValidation(sheet, startRow, colIndex, numRows, spec.validation);
    if (has('alignment')) stageRenderAlignment(sheet, startRow, colIndex, numRows, spec.alignment);
    if (has('numberFormat')) stageRenderNumberFormat(sheet, startRow, colIndex, numRows, spec.numberFormat);
    return;
  }
  const range = sheet.getRange(startRow, colIndex, numRows, 1);
  if (has('validation')) range.setDataValidation(spec.validation);
  if (has('alignment')) range.setHorizontalAlignment(spec.alignment);
  if (has('numberFormat')) range.setNumberFormat(spec.numberFormat);
}

/** Writes everything a scope staged. One call per plane per band. */
function flushRenderBatch_(scope) {
  const sheet = scope.sheet;

  scope.headers.forEach(header => {
    if (!header.dirty) return;
    try {
      const range = sheet.getRange(header.row, 1, 1, header.numCols);
      range.setValues([header.values]);
      range.setBackgrounds([header.backgrounds]);
      range.setFontColors([header.fontColors]);
      range.setFontWeights([header.fontWeights]);
    } catch (err) {
      log(`ℹ️ Could not write the header row ${header.row} of "${sheet.getName()}" in one pass (${err}).`);
    }
  });

  scope.bands.forEach(band => {
    if (band.count < 1) return;
    try {
      if (band.backgroundsDirty) {
        sheet.getRange(band.start, 1, band.count, band.numCols).setBackgrounds(band.backgrounds);
      }
      if (band.validationsDirty) {
        // ONE ROW ARRAY, SHARED BY EVERY ROW — see the banner. A validation is
        // uniform down a column, and setDataValidations() reads what it is
        // given without keeping it.
        const template = new Array(band.numCols).fill(null);
        Object.keys(band.validations).forEach(col => { template[Number(col) - 1] = band.validations[col]; });
        sheet.getRange(band.start, 1, band.count, band.numCols)
          .setDataValidations(new Array(band.count).fill(template));
      }
      renderColumnRuns_(band.numberFormats).forEach(run => {
        sheet.getRange(band.start, run.col, band.count, run.count).setNumberFormat(run.value);
      });
      renderColumnRuns_(band.alignments).forEach(run => {
        sheet.getRange(band.start, run.col, band.count, run.count).setHorizontalAlignment(run.value);
      });
    } catch (err) {
      log(`ℹ️ Could not write the formatting for rows ${band.start}–${band.start + band.count - 1} ` +
        `of "${sheet.getName()}" in one pass (${err}).`);
    }
  });

  // THE HEADER ROWS ONLY REACHED THE TAB JUST NOW, and every sectioned read
  // finds its sub-tables by them. writeSectionHeader() drops this tab's cached
  // grid when it STAGES, which is the right moment for everything it was
  // guarding against — except a read that happens between the staging and this
  // flush, which would cache a picture of the tab with no header rows in it
  // and go on serving it afterwards. So it is dropped again here, where the
  // words are actually on the sheet.
  invalidateSectionedRowsCache(sheet);
}
