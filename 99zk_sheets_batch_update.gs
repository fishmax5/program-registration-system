// ============================================================================
// 99zk. A RENDER'S FORMATTING AS ONE SHEETS API REQUEST  (batchUpdate)
// ============================================================================
//
// `97` made a render's formatting one call per attribute PLANE per band. That
// was an order of magnitude, and it left a floor: every plane is still a stop-
// and-wait on the Sheets service, and on the program registrant sheets (`46`)
// the floor was 191 round trips per sheet — a row height per session band, four
// calls per warning protection, a range list per attribute — repeated for every
// program, and all at once on a template bump (the 2026-09-30 nineteen-minute
// push).
//
// The Sheets v4 advanced service has been enabled in appsscript.json all along
// and used nowhere. One `Sheets.Spreadsheets.batchUpdate` takes a LIST of
// requests — repeatCell, updateCells, setDataValidation, updateDimension-
// Properties, addProtectedRange — and applies them in order, in one HTTP call,
// atomically. So this file describes the same paint as requests and sends it
// once.
//
// WHAT THIS FILE IS, AND IS NOT.
//
//   • It changes HOW a sheet is painted, never WHAT. Every request here is the
//     translation of a SpreadsheetApp call the old path makes, in the order it
//     makes it; tests/sheets_batch_golden.test.js paints the same input both
//     ways onto a modelling fake and requires the two to be identical, cell for
//     cell, attribute for attribute. A change to the paint belongs in BOTH
//     painters, and that test is what says so.
//   • The staging layer in `97` is untouched. Only its FLUSH has a second
//     implementation (flushRenderBatchViaSheetsApi_ below), so every stage*
//     call that returns false outside a scope still does what it always did.
//   • It NEVER makes a render fail. Every entry point returns false when the
//     service is absent, switched off (SHEETS_BATCH_FORMATTING_PROP_KEY), or
//     refuses — a 403 on a leader's sheet the trigger owner can only reach
//     through SpreadsheetApp, a quota, a frozen column across a hand-merged
//     cell — and its caller then paints the old way, from the top. A
//     batchUpdate is all-or-nothing, so a refusal leaves nothing half applied
//     for the old path to paint over. Three refusals in one execution stop the
//     API being tried again in that execution (SHEETS_BATCH_MAX_FAILURES): a
//     broken service costs three attempts, not one per sheet.
//
// ORDER IS THE CONTRACT. Values land first — `99u`'s single early setValues(),
// unchanged, so a render killed mid-way still leaves the rows on the tab — and
// the formatting after them. The one column the old leader path rewrote its
// values for after formatting (Event_Time, stamped '@' so a bare "10:00 AM" is
// not read as a time) is written here as `stringValue` AFTER its '@' format in
// the same batch, which is what '@' + setValues(string) produces.
//
// GRID RANGES ARE 0-BASED AND END-EXCLUSIVE; everything else in this project
// is 1-based and inclusive. sheetsGridRange_() is the ONE place that converts,
// and it refuses anything that is not a positive whole number rather than
// painting the row above.
// ============================================================================

/** Script Property kill switch: 'off' sends every render down the old path. */
const SHEETS_BATCH_FORMATTING_PROP_KEY = 'SHEETS_BATCH_FORMATTING_V1';

/**
 * Bytes per batchUpdate. Google recommends at most 2MB a request; a request
 * list that would serialize larger is sent as consecutive batchUpdates (never
 * one per call). A leader sheet is tens of KB; a year of Registrants
 * backgrounds is the case this exists for.
 */
const SHEETS_BATCH_MAX_BYTES = 1800000;

/** Refusals per execution before the API stops being tried at all. */
const SHEETS_BATCH_MAX_FAILURES = 3;

let __sheetsBatchFailures = 0;

/** Is the API path allowed right now? Never throws. */
function sheetsBatchAvailable_() {
  if (__sheetsBatchFailures >= SHEETS_BATCH_MAX_FAILURES) return false;
  try {
    if (typeof Sheets === 'undefined' || !Sheets || !Sheets.Spreadsheets ||
        typeof Sheets.Spreadsheets.batchUpdate !== 'function') return false;
  } catch (err) {
    return false;
  }
  try {
    const flag = PropertiesService.getScriptProperties().getProperty(SHEETS_BATCH_FORMATTING_PROP_KEY);
    if (String(flag || '').trim().toLowerCase() === 'off') return false;
  } catch (err) { /* no properties — the default is on */ }
  return true;
}

/** A refusal: logged, counted, never thrown. */
function recordSheetsBatchFailure_(what, sheet, err) {
  __sheetsBatchFailures++;
  let name = '';
  try { name = sheet ? sheet.getName() : ''; } catch (e) { /* ignore */ }
  log(`ℹ️ Sheets API formatting failed for ${what}${name ? ` on "${name}"` : ''} (${err}) — ` +
    `painted the ordinary way instead.` +
    (__sheetsBatchFailures >= SHEETS_BATCH_MAX_FAILURES ? ' Not trying the API again this run.' : ''));
}

/** For a test: forget this execution's refusals. */
function resetSheetsBatchFailures_() {
  __sheetsBatchFailures = 0;
}

// --- the request vocabulary -------------------------------------------------

/**
 * A 1-based, inclusive (row, col, numRows, numCols) as a GridRange. A missing
 * numRows/numCols leaves that side open (the rest of the sheet), which is how a
 * whole row or column is named. Anything that is not a positive whole number is
 * REFUSED: an off-by-one here repaints somebody else's row.
 */
function sheetsGridRange_(sheetId, row, col, numRows, numCols) {
  const whole = (v, what) => {
    if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 1) {
      throw new Error(`Bad grid ${what}: ${v}`);
    }
    return v;
  };
  const range = { sheetId };
  if (row !== undefined && row !== null) {
    range.startRowIndex = whole(row, 'row') - 1;
    if (numRows !== undefined && numRows !== null) range.endRowIndex = range.startRowIndex + whole(numRows, 'row count');
  }
  if (col !== undefined && col !== null) {
    range.startColumnIndex = whole(col, 'column') - 1;
    if (numCols !== undefined && numCols !== null) range.endColumnIndex = range.startColumnIndex + whole(numCols, 'column count');
  }
  return range;
}

/** '#RRGGBB' / '#RGB' as a Sheets Color. Throws on anything else (a named colour). */
function sheetsColor_(hex) {
  let h = String(hex || '').trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(h);
  if (m3) h = `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const f = x => Math.round(parseInt(x, 16) / 255 * 10000) / 10000;
  return { red: f(m[1]), green: f(m[2]), blue: f(m[3]) };
}

/** A number-format pattern with its API type. The pattern decides the display; the type must agree with it. */
function sheetsNumberFormat_(pattern) {
  const p = String(pattern);
  if (p === '@') return { type: 'TEXT', pattern: '@' };
  // Quoted literals and escapes say nothing about the type; AM/PM is a TIME
  // marker whose M is not a month.
  const bare = p.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  const hasTime = /[hHs]/.test(bare) || /am\/pm|a\/p/i.test(bare);
  const hasDate = /[dyM]/.test(bare.replace(/am\/pm|a\/p/ig, ''));
  const type = hasDate && hasTime ? 'DATE_TIME' : hasDate ? 'DATE' : hasTime ? 'TIME' : 'NUMBER';
  return { type, pattern: p };
}

const SHEETS_H_ALIGN_ = { left: 'LEFT', center: 'CENTER', centre: 'CENTER', right: 'RIGHT' };
const SHEETS_V_ALIGN_ = { top: 'TOP', middle: 'MIDDLE', bottom: 'BOTTOM' };
const SHEETS_WRAP_ = { CLIP: 'CLIP', OVERFLOW: 'OVERFLOW_CELL', WRAP: 'WRAP' };

function sheetsEnum_(table, value, what) {
  const key = String(value);
  const hit = table[key] || table[key.toLowerCase()] || table[key.toUpperCase()];
  if (!hit) throw new Error(`Unknown ${what}: ${value}`);
  return hit;
}

/**
 * A format spec — the attributes the SpreadsheetApp setters take, by name —
 * as a cell and its field mask. Only the attributes named are written; the
 * field mask is what stops a repeatCell erasing the ones it was not asked
 * about. A blank `background` CLEARS the fill, as setBackground(null) does.
 *
 *   { background, fontColor, fontWeight ('bold'|'normal'), fontStyle
 *     ('italic'|'normal'), fontSize, hAlign, vAlign, wrap, numberFormat }
 */
function sheetsCellFormat_(spec) {
  const has = k => Object.prototype.hasOwnProperty.call(spec, k);
  const fmt = {};
  const fields = [];
  const text = () => (fmt.textFormat = fmt.textFormat || {});
  if (has('background')) {
    if (spec.background) fmt.backgroundColor = sheetsColor_(spec.background);
    fields.push('userEnteredFormat.backgroundColor');
  }
  if (has('fontColor')) {
    text().foregroundColor = sheetsColor_(spec.fontColor);
    fields.push('userEnteredFormat.textFormat.foregroundColor');
  }
  if (has('fontWeight')) {
    text().bold = String(spec.fontWeight).toLowerCase() === 'bold';
    fields.push('userEnteredFormat.textFormat.bold');
  }
  if (has('fontStyle')) {
    text().italic = String(spec.fontStyle).toLowerCase() === 'italic';
    fields.push('userEnteredFormat.textFormat.italic');
  }
  if (has('fontSize')) {
    text().fontSize = Number(spec.fontSize);
    fields.push('userEnteredFormat.textFormat.fontSize');
  }
  if (has('hAlign')) {
    fmt.horizontalAlignment = sheetsEnum_(SHEETS_H_ALIGN_, spec.hAlign, 'alignment');
    fields.push('userEnteredFormat.horizontalAlignment');
  }
  if (has('vAlign')) {
    fmt.verticalAlignment = sheetsEnum_(SHEETS_V_ALIGN_, spec.vAlign, 'vertical alignment');
    fields.push('userEnteredFormat.verticalAlignment');
  }
  if (has('wrap')) {
    fmt.wrapStrategy = sheetsEnum_(SHEETS_WRAP_, spec.wrap, 'wrap strategy');
    fields.push('userEnteredFormat.wrapStrategy');
  }
  if (has('numberFormat')) {
    fmt.numberFormat = sheetsNumberFormat_(spec.numberFormat);
    fields.push('userEnteredFormat.numberFormat');
  }
  if (fields.length === 0) throw new Error('Empty format spec');
  return { cell: { userEnteredFormat: fmt }, fields: fields.join(',') };
}

/**
 * A value written WITHOUT SpreadsheetApp's parsing, for the two places that
 * want exactly that: a '@' column (where setValues does not parse either) and
 * a header row of words. Throws on anything setValues() WOULD have parsed into
 * something else — a number-like, date-like or TRUE/FALSE string — so a caller
 * that relied on that parse falls back rather than painting different values.
 */
function sheetsLiteralValue_(v, options) {
  options = options || {};
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number' && isFinite(v)) return { numberValue: v };
  if (typeof v !== 'string') throw new Error(`Cannot send ${Object.prototype.toString.call(v)} as a literal`);
  if (options.asText) return { stringValue: v };
  if (v.charAt(0) === '=') return { formulaValue: v };
  if (/^\s*(true|false)\s*$/i.test(v) ||
      /^\s*[-+(]?\s*[$€£]?\s*[\d.,]+\s*%?\s*\)?\s*$/.test(v) ||
      /\d\s*[\/:\-.]\s*\d/.test(v) ||
      /^\s*'/.test(v)) {
    throw new Error(`"${v}" would be parsed by setValues`);
  }
  return { stringValue: v };
}

/**
 * A DataValidation built by SpreadsheetApp, as an API rule. Only the shapes
 * this project builds are translated — a checkbox, a value list and a
 * number floor; anything
 * else throws, and its flush falls back.
 */
function sheetsValidationRule_(rule) {
  if (!rule) return null;
  const type = String(rule.getCriteriaType());
  const values = rule.getCriteriaValues() || [];
  const out = {};
  if (type === 'CHECKBOX') {
    out.condition = { type: 'BOOLEAN' };
    if (values.length > 0) {
      out.condition.values = values.map(v => ({ userEnteredValue: String(v) }));
    }
  } else if (type === 'VALUE_IN_LIST') {
    const list = values[0] || [];
    out.condition = { type: 'ONE_OF_LIST', values: list.map(v => ({ userEnteredValue: String(v) })) };
    out.showCustomUi = values[1] !== false;
  } else if (type === 'NUMBER_GREATER_THAN_OR_EQUAL_TO') {
    out.condition = { type: 'NUMBER_GREATER_THAN_EQ', values: [{ userEnteredValue: String(values[0]) }] };
  } else {
    throw new Error(`Unsupported validation ${type}`);
  }
  out.strict = !rule.getAllowInvalid();
  const help = typeof rule.getHelpText === 'function' ? rule.getHelpText() : '';
  if (help) out.inputMessage = String(help);
  return out;
}

// --- a batch ----------------------------------------------------------------

/** A request list for one sheet. Two calls: the file id and the sheet id. */
function newSheetsBatch_(sheet) {
  return {
    sheet,
    spreadsheetId: sheet.getParent().getId(),
    sheetId: sheet.getSheetId(),
    requests: []
  };
}

function sheetsBatchFormat_(batch, row, col, numRows, numCols, spec) {
  const f = sheetsCellFormat_(spec);
  batch.requests.push({ repeatCell: {
    range: sheetsGridRange_(batch.sheetId, row, col, numRows, numCols), cell: f.cell, fields: f.fields } });
}

/** The same format on several 1-based {start,count} row runs of one column span. */
function sheetsBatchFormatRuns_(batch, runs, col, numCols, spec) {
  (runs || []).forEach(run => {
    if (run.count > 0) sheetsBatchFormat_(batch, run.start, col, run.count, numCols, spec);
  });
}

/** Clears every format on the sheet — sheet.clearFormats(). Values, notes and validations stay. */
function sheetsBatchClearFormats_(batch) {
  batch.requests.push({ repeatCell: {
    range: { sheetId: batch.sheetId }, cell: {}, fields: 'userEnteredFormat' } });
}

function sheetsBatchUnmergeRow_(batch, row) {
  batch.requests.push({ unmergeCells: { range: sheetsGridRange_(batch.sheetId, row, null, 1, null) } });
}

function sheetsBatchNote_(batch, row, col, note) {
  const cell = note ? { note: String(note) } : {};
  batch.requests.push({ updateCells: {
    range: sheetsGridRange_(batch.sheetId, row, col, 1, 1), rows: [{ values: [cell] }], fields: 'note' } });
}

function sheetsBatchRowHeight_(batch, row, count, px) {
  batch.requests.push({ updateDimensionProperties: {
    range: { sheetId: batch.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row - 1 + count },
    properties: { pixelSize: px }, fields: 'pixelSize' } });
}

function sheetsBatchColumnWidth_(batch, col, count, px) {
  batch.requests.push({ updateDimensionProperties: {
    range: { sheetId: batch.sheetId, dimension: 'COLUMNS', startIndex: col - 1, endIndex: col - 1 + count },
    properties: { pixelSize: px }, fields: 'pixelSize' } });
}

function sheetsBatchColumnsHidden_(batch, col, count, hidden) {
  batch.requests.push({ updateDimensionProperties: {
    range: { sheetId: batch.sheetId, dimension: 'COLUMNS', startIndex: col - 1, endIndex: col - 1 + count },
    properties: { hiddenByUser: !!hidden }, fields: 'hiddenByUser' } });
}

function sheetsBatchAutoResizeColumns_(batch, col, count) {
  batch.requests.push({ autoResizeDimensions: { dimensions: {
    sheetId: batch.sheetId, dimension: 'COLUMNS', startIndex: col - 1, endIndex: col - 1 + count } } });
}

function sheetsBatchFreeze_(batch, which, count) {
  const key = which === 'rows' ? 'frozenRowCount' : 'frozenColumnCount';
  batch.requests.push({ updateSheetProperties: {
    properties: { sheetId: batch.sheetId, gridProperties: { [key]: count } },
    fields: `gridProperties.${key}` } });
}

/** A validation rule (an API rule, or null to clear) over a range. */
function sheetsBatchValidation_(batch, row, col, numRows, numCols, apiRule) {
  const req = { range: sheetsGridRange_(batch.sheetId, row, col, numRows, numCols) };
  if (apiRule) req.rule = apiRule;
  batch.requests.push({ setDataValidation: req });
}

/**
 * applyColumnVisibility() (`39`) as requests: hide the named columns, show
 * every other one, in runs — the same runs, so the two cannot disagree.
 */
function sheetsBatchColumnVisibility_(batch, headers, hiddenNames) {
  const map = getIndexMap(headers);
  const hide = new Set((hiddenNames || []).filter(h => map[h] !== undefined).map(h => map[h] + 1));
  let runStart = 1;
  for (let c = 2; c <= headers.length + 1; c++) {
    const same = c <= headers.length && hide.has(c) === hide.has(runStart);
    if (same) continue;
    sheetsBatchColumnsHidden_(batch, runStart, c - runStart, hide.has(runStart));
    runStart = c;
  }
}

/**
 * A background matrix (what setBackgrounds() takes) as requests, encoded
 * whichever way serializes SMALLER: one updateCells naming every cell, or
 * rectangles — each row's runs of one colour, merged down while the run below
 * is the same. A zebra-striped band with a few tinted columns is mostly the
 * second; a band whose every row differs is the first. Both paint exactly the
 * matrix. A blank entry clears the fill.
 */
function sheetsBatchBackgrounds_(batch, startRow, startCol, matrix) {
  const rows = matrix.length;
  if (rows < 1) return;
  const cols = matrix[0].length;
  const colorCache = {};
  const colorOf = c => {
    if (!c) return null;
    if (!(c in colorCache)) colorCache[c] = sheetsColor_(c);
    return colorCache[c];
  };

  const cellsReq = { updateCells: {
    range: sheetsGridRange_(batch.sheetId, startRow, startCol, rows, cols),
    rows: matrix.map(line => ({ values: line.map(c => {
      const color = colorOf(c);
      return color ? { userEnteredFormat: { backgroundColor: color } } : {};
    }) })),
    fields: 'userEnteredFormat.backgroundColor'
  } };

  // Rectangles: runs per row, extended downwards while identical.
  const rects = [];
  let open = {};
  for (let r = 0; r < rows; r++) {
    const line = matrix[r];
    const next = {};
    let c0 = 0;
    for (let c = 1; c <= cols; c++) {
      if (c < cols && (line[c] || '') === (line[c0] || '')) continue;
      const key = `${c0}:${c}:${line[c0] || ''}`;
      const rect = open[key];
      if (rect) { rect.r1 = r + 1; next[key] = rect; }
      else {
        const made = { r0: r, r1: r + 1, c0, c1: c, color: line[c0] || '' };
        rects.push(made);
        next[key] = made;
      }
      c0 = c;
    }
    open = next;
  }
  const rectReqs = rects.map(rect => {
    const color = colorOf(rect.color);
    return { repeatCell: {
      range: sheetsGridRange_(batch.sheetId, startRow + rect.r0, startCol + rect.c0,
        rect.r1 - rect.r0, rect.c1 - rect.c0),
      cell: color ? { userEnteredFormat: { backgroundColor: color } } : {},
      fields: 'userEnteredFormat.backgroundColor'
    } };
  });

  const cellsJson = JSON.stringify(cellsReq).length;
  if (JSON.stringify(rectReqs).length < cellsJson) {
    rectReqs.forEach(r => batch.requests.push(r));
    return;
  }
  // ONE updateCells IS ONE REQUEST, and sendSheetsBatch_() can only split
  // BETWEEN requests — so a plane that would serialize past a quarter of the
  // ceiling goes out as slices of whole rows, each its own request.
  const sliceRows = Math.max(1, Math.floor(rows * (SHEETS_BATCH_MAX_BYTES / 8) / Math.max(cellsJson, 1)));
  if (sliceRows >= rows) { batch.requests.push(cellsReq); return; }
  const allRows = cellsReq.updateCells.rows;
  for (let r0 = 0; r0 < rows; r0 += sliceRows) {
    const n = Math.min(sliceRows, rows - r0);
    batch.requests.push({ updateCells: {
      range: sheetsGridRange_(batch.sheetId, startRow + r0, startCol, n, cols),
      rows: allRows.slice(r0, r0 + n),
      fields: 'userEnteredFormat.backgroundColor'
    } });
  }
}

/**
 * Sends the batch: one batchUpdate, or a few consecutive ones when the list
 * would serialize past SHEETS_BATCH_MAX_BYTES. Throws whatever the service
 * throws — every caller catches and falls back. Returns the number of calls.
 */
function sendSheetsBatch_(batch) {
  const requests = batch.requests;
  batch.requests = [];
  if (requests.length === 0) return 0;
  const chunks = [];
  let chunk = [];
  let size = 0;
  requests.forEach(req => {
    // UTF-16 length × 2 is an upper bound on the UTF-8 bytes of a non-ASCII
    // note; ASCII requests are overcounted, which only splits sooner.
    const bytes = JSON.stringify(req).length * 2;
    if (chunk.length > 0 && size + bytes > SHEETS_BATCH_MAX_BYTES) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(req);
    size += bytes;
  });
  if (chunk.length > 0) chunks.push(chunk);
  chunks.forEach(list => Sheets.Spreadsheets.batchUpdate({ requests: list }, batch.spreadsheetId));
  return chunks.length;
}

/** 'Tab'!A1:P1 — a sheet name quoted for an A1 range. */
function sheetsA1_(sheetName, row, col, numRows, numCols) {
  const name = `'${String(sheetName).replace(/'/g, "''")}'`;
  return `${name}!${columnToLetter(col)}${row}:${columnToLetter(col + numCols - 1)}${row + numRows - 1}`;
}

/**
 * The widths of columns 1..lastCol, in ONE read — what one getColumnWidth()
 * per column cost before. Throws if the answer does not cover every column.
 */
function readSheetsColumnWidths_(batch, lastCol) {
  const res = Sheets.Spreadsheets.get(batch.spreadsheetId, {
    ranges: [sheetsA1_(batch.sheet.getName(), 1, 1, 1, lastCol)],
    fields: 'sheets(properties(sheetId),data(columnMetadata(pixelSize)))'
  });
  const sheet = ((res && res.sheets) || []).filter(s => s.properties && s.properties.sheetId === batch.sheetId)[0];
  const meta = sheet && sheet.data && sheet.data[0] && sheet.data[0].columnMetadata;
  if (!meta || meta.length < lastCol) throw new Error('Column widths did not come back');
  return meta.slice(0, lastCol).map(m => Number(m && m.pixelSize) || 100);
}

/** This sheet's protected ranges with their API ids, in ONE read. */
function readSheetsProtectedRanges_(batch) {
  const res = Sheets.Spreadsheets.get(batch.spreadsheetId, {
    fields: 'sheets(properties(sheetId),protectedRanges(protectedRangeId,description))'
  });
  const sheet = ((res && res.sheets) || []).filter(s => s.properties && s.properties.sheetId === batch.sheetId)[0];
  return (sheet && sheet.protectedRanges) || [];
}

/**
 * protectDerivedColumns() (`39`) as requests, against the SAME remembered
 * geometry (DERIVED_COLUMN_PROTECTIONS_V1) and written back in the SAME
 * format — so either path can follow the other without a rebuild it did not
 * need. Returns a commit() to call once the batch has landed (the memo must
 * not claim a protection set that was never applied), or null when there is
 * nothing to do.
 */
function sheetsBatchDerivedProtections_(batch, headers, protectedNames, zones) {
  const sheet = batch.sheet;
  const map = getIndexMap(headers);
  const cols = (protectedNames || []).filter(name => map[name] !== undefined).map(name => map[name] + 1);
  const fingerprint = derivedProtectionFingerprint_(cols, zones);
  const stateKey = derivedProtectionKeyFor_(sheet);
  const state = readDerivedProtectionState_();
  const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  if (state[stateKey] && state[stateKey] === `${fingerprint}|${existing.length}`) return null;

  const ours = p => String(p.getDescription() || '').indexOf(PROTECTION_TAG) === 0;
  const kept = existing.filter(p => !ours(p)).length;
  if (existing.length > kept) {
    readSheetsProtectedRanges_(batch).forEach(p => {
      if (String(p.description || '').indexOf(PROTECTION_TAG) !== 0) return;
      batch.requests.push({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } });
    });
  }
  let made = 0;
  (zones || []).forEach(z => {
    if (z.count < 1) return;
    protectedNames.forEach(name => {
      const idx = map[name];
      if (idx === undefined) return;
      batch.requests.push({ addProtectedRange: { protectedRange: {
        range: sheetsGridRange_(batch.sheetId, z.start, idx + 1, z.count, 1),
        description: `${PROTECTION_TAG} — "${name}" is filled in automatically and will be overwritten.`,
        warningOnly: true
      } } });
      made++;
    });
  });
  return () => {
    state[stateKey] = `${fingerprint}|${kept + made}`;
    writeDerivedProtectionState_(state, stateKey);
  };
}

/**
 * applyColumnWidthBuffer() (`13`) as requests, from widths already read: the
 * same padding, the same clamp, the same runs.
 */
function sheetsBatchBufferedWidths_(batch, widths) {
  const targets = widths.map(w => {
    const padded = Math.round(w * COLUMN_WIDTH_BUFFER_MULTIPLIER);
    return Math.max(MIN_COLUMN_WIDTH_PX, Math.min(padded, MAX_COLUMN_WIDTH_PX));
  });
  let runStart = 0;
  for (let i = 1; i <= targets.length; i++) {
    if (i < targets.length && targets[i] === targets[runStart]) continue;
    sheetsBatchColumnWidth_(batch, runStart + 1, i - runStart, targets[runStart]);
    runStart = i;
  }
}

// ============================================================================
// THE PROGRAM REGISTRANT SHEET (`46`)
// ============================================================================
//
// writeProgramLeaderSheetTabLegacy_() as requests. The steps, against the old
// path's calls:
//
//   1. clearDataValidations()                 — unchanged (SpreadsheetApp)
//   2. writeTabValuesBeforeRender_ (`99u`)    — unchanged, except the header
//      row lands already LABELLED (✍️ Contacted), which is what the render
//      writes there anyway; banding removal unchanged (the Banding object has
//      no id to send)
//   3. batchUpdate #1: clearFormats, banner, header and labels, the '@' stamp
//      with Event_Time's words, zebra, waitlist ink, band rows and heights,
//      number formats, wraps, wash, checkboxes, protections, frozen rows,
//      visibility, autosize's CLIP and its fit
//   4. one read: the fitted widths
//   5. batchUpdate #2: padded widths, visibility again, frozen columns
//   6. applySavedColumnWidths()                — unchanged (free with none saved)
//
// Returns true when the sheet was painted; false sends the caller down the old
// path, which repaints everything from the top.
// ============================================================================
function writeProgramLeaderSheetTabViaSheetsApi_(sheet, entry, rows) {
  if (!sheetsBatchAvailable_()) return false;
  const headers = LEADER_SHEET_HEADERS;
  const numCols = headers.length;
  const map = getIndexMap(headers);
  const { grid, bandRowNumbers, runs } = leaderSheetGridLayout_(rows, map, numCols);

  // Event_Time goes out as stringValue under '@'. A value that is not words
  // (a stray Date or number) is what the old path's setValues() handles, so a
  // grid holding one is painted the old way rather than differently.
  const timeIdx = map['Event_Time'];
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i][timeIdx];
    if (v !== '' && v !== null && v !== undefined && typeof v !== 'string') return false;
  }

  try {
    const batch = newSheetsBatch_(sheet);
    const labelledHeaders = headers.map(h =>
      LEADER_OWNED_COLUMNS.indexOf(h) !== -1 ? `${MANUAL_ENTRY_PREFIX} ${h}` : h);
    const bannerText = leaderSheetBannerText_(entry);

    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
    writeTabValuesBeforeRender_(sheet, [
      { row: MEMORY_TAB_BANNER_ROW, values: [[bannerText]] },
      { row: MEMORY_TAB_HEADER_ROW, values: [labelledHeaders] },
      { row: MEMORY_TAB_DATA_ROW, values: rows.length === 0 ? [[LEADER_SHEET_EMPTY_ROSTER_TEXT]] : grid }
    ]);
    // The header row is the marker every sectioned read projects by.
    invalidateSectionedRowsCache(sheet);
    sheet.getBandings().forEach(b => b.remove());
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const lastCol = Math.max(sheet.getLastColumn(), numCols);

    sheetsBatchClearFormats_(batch);

    // writeSectionBanner()
    sheetsBatchUnmergeRow_(batch, MEMORY_TAB_BANNER_ROW);
    sheetsBatchFormat_(batch, MEMORY_TAB_BANNER_ROW, 1, 1, numCols, {
      fontSize: TYPO.BANNER.size, fontWeight: TYPO.BANNER.weight, fontColor: TYPO.BANNER.color,
      background: TYPO.BANNER.background, vAlign: 'middle' });
    sheetsBatchFormat_(batch, MEMORY_TAB_BANNER_ROW, 1, 1, 1, { hAlign: 'left', wrap: 'OVERFLOW' });
    sheetsBatchNote_(batch, MEMORY_TAB_BANNER_ROW, 1, leaderSheetBannerNote());
    sheetsBatchRowHeight_(batch, MEMORY_TAB_BANNER_ROW, 1, ROW_HEIGHTS.BANNER);

    // writeSectionHeader(), then labelManualEntryColumns()
    sheetsBatchFormat_(batch, MEMORY_TAB_HEADER_ROW, 1, 1, numCols, {
      fontSize: TYPO.COLUMN_HEADER.size, fontWeight: TYPO.COLUMN_HEADER.weight,
      background: TYPO.COLUMN_HEADER.background, fontColor: TYPO.COLUMN_HEADER.color,
      vAlign: 'middle', wrap: 'CLIP' });
    LEADER_OWNED_COLUMNS.forEach(name => {
      const idx = headers.indexOf(name);
      if (idx === -1) return;
      sheetsBatchFormat_(batch, MEMORY_TAB_HEADER_ROW, idx + 1, 1, 1, {
        background: MANUAL_ENTRY_HEADER_COLOR, fontColor: '#000000', fontWeight: 'bold' });
    });

    let commitProtections = null;
    if (rows.length === 0) {
      sheetsBatchFormat_(batch, MEMORY_TAB_DATA_ROW, 1, 1, 1, {
        fontStyle: 'italic', fontColor: TYPO.MUTED.color });
    } else {
      const n = grid.length;
      // stampTextColumns(), then the words it protects.
      sheetsBatchFormat_(batch, MEMORY_TAB_DATA_ROW, timeIdx + 1, Math.max(n, 1), 1, { numberFormat: '@' });
      batch.requests.push({ updateCells: {
        range: sheetsGridRange_(batch.sheetId, MEMORY_TAB_DATA_ROW, timeIdx + 1, n, 1),
        rows: grid.map(line => {
          const value = sheetsLiteralValue_(line[timeIdx], { asText: true });
          return { values: [value ? { userEnteredValue: value } : {}] };
        }),
        fields: 'userEnteredValue'
      } });

      // Zebra, band wash and waitlist wash — the same matrix as the old path.
      const bandRowSet = {};
      bandRowNumbers.forEach(r => { bandRowSet[r] = true; });
      const backgrounds = [];
      const waitlistRows = [];
      let stripe = 0;
      for (let i = 0; i < n; i++) {
        const rowNumber = MEMORY_TAB_DATA_ROW + i;
        if (bandRowSet[rowNumber]) {
          backgrounds.push(new Array(numCols).fill(LEADER_SHEET_BAND_BG));
          stripe = 0;
        } else if (isLeaderSheetWaitlistedRow(grid[i], map)) {
          backgrounds.push(new Array(numCols).fill(LEADER_SHEET_WAITLIST_BG));
          waitlistRows.push({ start: rowNumber, count: 1 });
          stripe++;
        } else {
          backgrounds.push(new Array(numCols).fill(stripe % 2 === 0 ? PALETTE.PAPER : PALETTE.STRIPE));
          stripe++;
        }
      }
      sheetsBatchBackgrounds_(batch, MEMORY_TAB_DATA_ROW, 1, backgrounds);

      sheetsBatchFormatRuns_(batch, waitlistRows, map['Program_Status'] + 1, 1, {
        background: LEADER_SHEET_WAITLIST_INK, fontWeight: 'bold' });

      bandRowNumbers.forEach(r => {
        sheetsBatchFormat_(batch, r, 1, 1, numCols, {
          fontWeight: 'bold', fontColor: LEADER_SHEET_BAND_INK, vAlign: 'middle' });
      });
      bandRowNumbers.forEach(r => sheetsBatchFormat_(batch, r, 1, 1, 1, { wrap: 'OVERFLOW' }));
      bandRowNumbers.forEach(r => sheetsBatchRowHeight_(batch, r, 1, ROW_HEIGHTS.BANNER));

      if (runs.length > 0) {
        sheetsBatchFormatRuns_(batch, runs, map['Event_Date'] + 1, 1, { numberFormat: DATE_DISPLAY_FORMAT });
        sheetsBatchFormatRuns_(batch, runs, map['Party_Size'] + 1, 1, { numberFormat: '0' });
        sheetsBatchFormatRuns_(batch, runs, map['Answers'] + 1, 1, { wrap: 'WRAP' });
        LEADER_OWNED_COLUMNS.forEach(name => {
          if (map[name] === undefined) return;
          sheetsBatchFormatRuns_(batch, runs, map[name] + 1, 1, { background: MANUAL_ENTRY_CELL_TINT });
        });
        LEADER_FLAG_COLUMNS.forEach(name => {
          if (map[name] === undefined) return;
          runs.forEach(run => sheetsBatchValidation_(batch, run.start, map[name] + 1, run.count, 1,
            { condition: { type: 'BOOLEAN' }, strict: false }));
          sheetsBatchFormatRuns_(batch, runs, map[name] + 1, 1, { hAlign: 'center' });
        });
      }

      commitProtections = sheetsBatchDerivedProtections_(batch, headers, LEADER_SHEET_DERIVED_COLUMNS,
        [{ start: MEMORY_TAB_DATA_ROW, count: n }]);
    }

    sheetsBatchFreeze_(batch, 'rows', MEMORY_TAB_HEADER_ROW);
    sheetsBatchColumnVisibility_(batch, headers, LEADER_SHEET_HIDDEN_COLUMNS);
    // autosizeColumns(…, { force: true }): CLIP everywhere, then fit. The CLIP
    // also undoes the WRAP/OVERFLOW above, exactly as it always has — see the
    // transition note; the two painters must agree, so this one does too.
    sheetsBatchFormat_(batch, 1, 1, lastRow, lastCol, { wrap: 'CLIP' });
    sheetsBatchAutoResizeColumns_(batch, 1, lastCol);
    sendSheetsBatch_(batch);
    if (commitProtections) commitProtections();
    invalidateAutosizeMemo(sheet.getName());

    const widths = readSheetsColumnWidths_(batch, lastCol);
    sheetsBatchBufferedWidths_(batch, widths);
    sheetsBatchColumnVisibility_(batch, headers, LEADER_SHEET_HIDDEN_COLUMNS);
    sheetsBatchFreeze_(batch, 'columns', Math.min(map['Name'] + 1, numCols));
    sendSheetsBatch_(batch);

    try {
      applySavedColumnWidths(sheet, lastCol);
    } catch (err) {
      log(`autosizeColumns skipped on "${sheet.getName()}": ${err}`);
    }
    return true;
  } catch (err) {
    recordSheetsBatchFailure_('a program registrant sheet', sheet, err);
    return false;
  }
}

// ============================================================================
// THE RENDER SCOPE'S FLUSH (`97`)
// ============================================================================
//
// flushRenderBatchLegacy_() as one batchUpdate: every header row and every
// band's four planes. Header WORDS go out as literal values, so a header that
// setValues() would have parsed (a number, a date) refuses the whole flush and
// the old one runs instead. Returns true when the scope was written.
// ============================================================================
function flushRenderBatchViaSheetsApi_(scope) {
  if (!sheetsBatchAvailable_()) return false;
  const sheet = scope.sheet;
  try {
    const batch = newSheetsBatch_(sheet);

    scope.headers.forEach(header => {
      if (!header.dirty) return;
      const cells = header.values.map((v, c) => {
        const cell = { userEnteredFormat: { textFormat: {
          foregroundColor: sheetsColor_(header.fontColors[c]),
          bold: String(header.fontWeights[c]).toLowerCase() === 'bold'
        } } };
        if (header.backgrounds[c]) cell.userEnteredFormat.backgroundColor = sheetsColor_(header.backgrounds[c]);
        const value = sheetsLiteralValue_(v);
        if (value) cell.userEnteredValue = value;
        return cell;
      });
      batch.requests.push({ updateCells: {
        range: sheetsGridRange_(batch.sheetId, header.row, 1, 1, header.numCols),
        rows: [{ values: cells }],
        fields: 'userEnteredValue,userEnteredFormat.backgroundColor,' +
          'userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.bold'
      } });
    });

    scope.bands.forEach(band => {
      if (band.count < 1) return;
      if (band.backgroundsDirty) sheetsBatchBackgrounds_(batch, band.start, 1, band.backgrounds);
      if (band.validationsDirty) {
        // The whole band cleared, then each staged column — what one
        // setDataValidations() of a null-padded plane does.
        sheetsBatchValidation_(batch, band.start, 1, band.count, band.numCols, null);
        Object.keys(band.validations).map(Number).sort((a, b) => a - b).forEach(col => {
          const rule = sheetsValidationRule_(band.validations[col]);
          if (rule) sheetsBatchValidation_(batch, band.start, col, band.count, 1, rule);
        });
      }
      renderColumnRuns_(band.numberFormats).forEach(run => {
        sheetsBatchFormat_(batch, band.start, run.col, band.count, run.count, { numberFormat: run.value });
      });
      renderColumnRuns_(band.alignments).forEach(run => {
        sheetsBatchFormat_(batch, band.start, run.col, band.count, run.count, { hAlign: run.value });
      });
    });

    sendSheetsBatch_(batch);
    return true;
  } catch (err) {
    recordSheetsBatchFailure_('a render', sheet, err);
    return false;
  }
}
