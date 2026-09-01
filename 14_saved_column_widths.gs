// ============================================================================
// 2a-i. SAVED COLUMN WIDTHS  ("this column should be this wide, always")
// ============================================================================
//
// autosizeColumns() fits every column to its contents and pads the result, and
// for most of this workbook that is exactly right. For a handful of columns it
// never is: Admin_Notes fits to whatever the longest note happens to be this
// week, Name is narrower than a name needs to be to stay readable at a
// distance, and the link columns fit to a URL nobody reads. Widening them by
// hand works until the next render, which fits them again.
//
// So a width set by hand can now be PROMOTED INTO A DEFAULT. The admin drags
// the columns on the tab until it looks right, opens the dialog and saves — and
// from then on every render of that tab applies those widths after the autofit,
// which is the last word on the subject. It is stored in Script Properties
// rather than in this file so it survives without an edit-and-redeploy.
//
// SAVED BY HEADER NAME, with the column number only as a fallback. A HEADERS
// array can be reordered or gain a column, and a width remembered as "column 7"
// would then be applied to whatever moved into column 7 — quietly making the
// wrong column wide. Remembered as "Admin_Notes", it follows the column it
// belongs to.
// ============================================================================

const COLUMN_WIDTH_PROP_KEY = 'SHEET_COLUMN_WIDTHS_V1';

/**
 * How far down a tab a header row can be before this stops looking for it.
 * Master_Program_Dashboard's is around row 11 (a hero block and a metrics
 * block sit above it); nothing in this workbook is anywhere near 60.
 */
const HEADER_ROW_SEARCH_DEPTH = 60;

/** Every saved width in the workbook: { sheetName: { byName: {}, byIndex: {} } }. */
function readSavedColumnWidthBook() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(COLUMN_WIDTH_PROP_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch (err) {
    log(`ℹ️ Could not read the saved column widths (${err}) — falling back to the autofit.`);
    return {};
  }
}

function writeSavedColumnWidthBook(book) {
  PropertiesService.getScriptProperties().setProperty(COLUMN_WIDTH_PROP_KEY, JSON.stringify(book || {}));
}

/** One tab's saved widths, or null when it has none. */
function savedColumnWidthsFor(sheetName) {
  const entry = readSavedColumnWidthBook()[sheetName];
  if (!entry) return null;
  const byName = entry.byName || {};
  const byIndex = entry.byIndex || {};
  if (Object.keys(byName).length === 0 && Object.keys(byIndex).length === 0) return null;
  return { byName, byIndex };
}

/**
 * The row this tab's column headers are written on — the one a saved width's
 * header NAME has to be resolved through.
 *
 * The first row in the top HEADER_ROW_SEARCH_DEPTH that carries at least two
 * of `wantedNames`. Two rather than one because a banner or a stray note can
 * easily contain a single word that matches a header, and because every real
 * header row in this workbook carries all of them. FIRST rather than best,
 * because a tab with two identical stacked header rows (Upcoming and Past)
 * wants the upper one — its columns are the same columns.
 *
 * Returns 0 when there is no such row, which every caller reads as "size this
 * tab by column number instead".
 */
function findHeaderRowByNames(sheet, wantedNames) {
  const names = {};
  (wantedNames || []).forEach(n => { names[normalizeHeaderText(n)] = true; });
  if (Object.keys(names).length === 0) return 0;
  const lastRow = Math.min(sheet.getLastRow(), HEADER_ROW_SEARCH_DEPTH);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return 0;
  const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  for (let r = 0; r < grid.length; r++) {
    let hits = 0;
    for (let c = 0; c < grid[r].length; c++) {
      if (names[normalizeHeaderText(grid[r][c])]) hits++;
      if (hits >= 2) return r + 1;
    }
  }
  return 0;
}

/**
 * The header names this tab is expected to have. HEADERS is the answer for
 * every tab that has an entry there; Config is laid out in blocks instead, so
 * its headers are collected from CONFIG_LAYOUT.
 */
function expectedHeaderNamesFor(sheetName) {
  if (HEADERS[sheetName]) return HEADERS[sheetName];
  if (sheetName === SHEET_NAMES.CONFIG) {
    return Object.values(CONFIG_LAYOUT).reduce((all, section) => all.concat(section.headers), []);
  }
  return [];
}

/**
 * Applies this tab's saved widths, if it has any. Called by autosizeColumns()
 * as its last act, so a saved width always beats the fitted one.
 *
 * Costs NOTHING on a tab with no saved widths, which is most of them: one
 * Script Properties read, already cached by Apps Script within an execution,
 * and no sheet access at all.
 *
 * Returns how many columns were set, for the log.
 */
function applySavedColumnWidths(sheet, lastCol) {
  const saved = savedColumnWidthsFor(sheet.getName());
  if (!saved) return 0;

  // 0 means "leave this column exactly as the autofit left it".
  const targets = new Array(lastCol).fill(0);
  const clamp = px => Math.max(MIN_COLUMN_WIDTH_PX, Math.min(Math.round(Number(px) || 0), MAX_SAVED_COLUMN_WIDTH_PX));

  // By number first, so a by-name width lands on top of it where both exist.
  Object.keys(saved.byIndex).forEach(key => {
    const col = Number(key);
    if (col >= 1 && col <= lastCol) targets[col - 1] = clamp(saved.byIndex[key]);
  });

  const names = Object.keys(saved.byName);
  if (names.length > 0) {
    const headerRow = findHeaderRowByNames(sheet, names.concat(expectedHeaderNamesFor(sheet.getName())));
    if (headerRow) {
      const map = getHeaderMapAt(sheet, headerRow);
      names.forEach(h => {
        const col = map[normalizeHeaderText(h)];
        if (col && col <= lastCol) targets[col - 1] = clamp(saved.byName[h]);
      });
    }
  }

  // Grouped into runs the same way applyColumnWidthBuffer() groups its own —
  // consecutive columns wanting the same width are one call, not N.
  let set = 0;
  let runStart = -1;
  for (let i = 0; i <= targets.length; i++) {
    const here = i < targets.length ? targets[i] : 0;
    if (runStart >= 0 && here === targets[runStart]) continue;
    if (runStart >= 0) {
      sheet.setColumnWidths(runStart + 1, i - runStart, targets[runStart]);
      set += i - runStart;
    }
    runStart = here > 0 ? i : -1;
  }
  return set;
}

/**
 * The ceiling on a SAVED width. Higher than MAX_COLUMN_WIDTH_PX, which caps
 * what the AUTOFIT is allowed to decide on its own — a person who has dragged
 * a notes column out to 600px has said something the autofit's guess should
 * not overrule.
 */
const MAX_SAVED_COLUMN_WIDTH_PX = 900;

/**
 * Reads a tab's CURRENT column widths into the shape saved above: by header
 * name where the tab has a header row this can find, and by column number
 * either way as the fallback.
 */
function captureColumnWidths(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const byName = {};
  const byIndex = {};
  const headerRow = findHeaderRowByNames(sheet, expectedHeaderNamesFor(sheet.getName()));
  const nameByCol = {};
  if (headerRow) {
    const map = getHeaderMapAt(sheet, headerRow);
    Object.keys(map).forEach(name => { if (nameByCol[map[name]] === undefined) nameByCol[map[name]] = name; });
  }
  for (let col = 1; col <= lastCol; col++) {
    const width = sheet.getColumnWidth(col);
    byIndex[col] = width;
    if (nameByCol[col]) byName[nameByCol[col]] = width;
  }
  return { byName, byIndex, headerRow, lastCol };
}

/** Stores `widths` (from captureColumnWidths()) as this tab's defaults. */
function saveColumnWidthsForSheet(sheet, widths) {
  const book = readSavedColumnWidthBook();
  book[sheet.getName()] = { byName: widths.byName, byIndex: widths.byIndex };
  writeSavedColumnWidthBook(book);
}

/** Forgets one tab's saved widths, so its next render goes back to the autofit. */
function clearSavedColumnWidthsForSheet(sheetName) {
  const book = readSavedColumnWidthBook();
  delete book[sheetName];
  writeSavedColumnWidthBook(book);
}

// ----------------------------------------------------------------------------
// The dialog: set the widths, then promote them to defaults
// ----------------------------------------------------------------------------
//
// TWO HALVES OF ONE JOB, which is why they are one dialog rather than two menu
// items. Getting a tab's widths right is a matter of nudging a few columns and
// looking at the result; deciding those are the defaults is the moment after.
// A dialog that only saved would mean dragging columns on the tab and then
// hunting for a menu item; a dialog that only set widths would be a worse
// version of dragging them.
//
// So: it lists the columns with their CURRENT widths, any number can be typed
// over, "Apply" puts them on the tab to be looked at, and "Save as defaults"
// is the separate, deliberate act that makes every future render honour them.
// ----------------------------------------------------------------------------

/** Admin menu entry: the column-width dialog, on whichever tab is in front. */
function showColumnWidthDialog() {
  if (!requireAuthorizedAdmin('Column Widths')) return;
  const html = HtmlService.createHtmlOutput(buildColumnWidthHtml())
    .setWidth(560)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Column Widths');
}

/**
 * What the dialog draws: every tab's name (so the picker needs no second
 * call), and the columns of the one being looked at.
 */
function readColumnWidthState(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets().filter(s => !s.isSheetHidden()).map(s => s.getName());
  const wanted = sheetName && sheets.indexOf(sheetName) !== -1 ? sheetName : ss.getActiveSheet().getName();
  const sheet = ss.getSheetByName(wanted);
  const captured = captureColumnWidths(sheet);
  const saved = savedColumnWidthsFor(wanted);

  const columns = [];
  for (let col = 1; col <= captured.lastCol; col++) columns.push({ col, width: captured.byIndex[col], header: '' });
  // Named through the header row, which is the only thing that knows which
  // column is which — captured.byName is keyed the other way round, and two
  // columns of the same width would trade names if it were read backwards.
  if (captured.headerRow) {
    const map = getHeaderMapAt(sheet, captured.headerRow);
    Object.keys(map).forEach(name => {
      const entry = columns[map[name] - 1];
      if (entry && !entry.header) entry.header = name;
    });
  }
  columns.forEach(c => { if (!c.header) c.header = `Column ${columnToLetter(c.col)}`; });

  return {
    sheets,
    sheetName: wanted,
    headerRow: captured.headerRow,
    columns,
    savedCount: saved ? Object.keys(saved.byName).length + Object.keys(saved.byIndex).length : 0
  };
}

/**
 * Puts the typed widths on the tab, and — when asked — saves them as its
 * defaults.
 *
 * The widths are always applied BEFORE they are saved, never the other way
 * round: what gets stored is then exactly what the tab is showing, rather than
 * a set of numbers nobody has looked at.
 */
function applyColumnWidthsFromDialog(args) {
  if (!requireAuthorizedAdmin('Column Widths')) {
    return { ok: false, message: 'That account cannot change column widths.' };
  }
  args = args || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(String(args.sheetName || ''));
  if (!sheet) return { ok: false, message: `There is no tab called "${args.sheetName}".` };

  let changed = 0;
  (args.widths || []).forEach(entry => {
    const col = Number(entry.col);
    const width = Math.max(MIN_COLUMN_WIDTH_PX, Math.min(Math.round(Number(entry.width) || 0), MAX_SAVED_COLUMN_WIDTH_PX));
    if (!col || col < 1 || !width) return;
    if (sheet.getColumnWidth(col) === width) return;
    sheet.setColumnWidth(col, width);
    changed++;
  });

  if (!args.saveAsDefaults) {
    const message = changed > 0
      ? `${changed} column(s) resized on ${sheet.getName()} — nothing saved yet.`
      : `Nothing to change on ${sheet.getName()}.`;
    log(`applyColumnWidthsFromDialog: ${message}`);
    return { ok: true, message, saved: false };
  }

  // WHAT THE TAB IS ACTUALLY SHOWING, re-read rather than assumed: a column
  // dragged on the sheet while this dialog was open is part of what the person
  // is looking at and means to keep.
  const captured = captureColumnWidths(sheet);
  saveColumnWidthsForSheet(sheet, captured);
  const message = `${Object.keys(captured.byIndex).length} column width(s) on ${sheet.getName()} are now the ` +
    `default — every render will use them` +
    (captured.headerRow ? ', matched by header name.' : ' (matched by column number: no header row found).');
  log(`applyColumnWidthsFromDialog: ${message}`);
  return { ok: true, message, saved: true };
}

/** Forgets a tab's saved widths and refits it, so the result is visible at once. */
function clearColumnWidthsFromDialog(sheetName) {
  if (!requireAuthorizedAdmin('Column Widths')) {
    return { ok: false, message: 'That account cannot change column widths.' };
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(String(sheetName || ''));
  if (!sheet) return { ok: false, message: `There is no tab called "${sheetName}".` };
  clearSavedColumnWidthsForSheet(sheet.getName());
  autosizeColumns(sheet, { force: true });
  const message = `${sheet.getName()} is back to the automatic fit.`;
  log(`clearColumnWidthsFromDialog: ${message}`);
  return { ok: true, message, saved: false };
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildColumnWidthHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 4px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
  label.field { display: block; font-weight: bold; margin: 10px 0 3px 0; }
  select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { text-align: left; font-size: 11px; color: #666; border-bottom: 1px solid #ddd; padding: 4px 6px; }
  td { padding: 3px 6px; border-bottom: 1px solid #F1F3F4; }
  td.num { width: 90px; }
  td input { width: 78px; padding: 4px; font-size: 13px; text-align: right; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 9px 16px;
           font-size: 13px; cursor: pointer; margin: 14px 6px 0 0; }
  button.secondary { background: #fff; color: #1A73E8; border: 1px solid #DADCE0; }
  button[disabled] { background: #9aa0a6; color: #fff; border-color: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; } .busy { color: #666; font-weight: normal; }
  #saved { color: #666; font-size: 11px; margin-top: 4px; }
</style>
<h3>Column Widths</h3>
<p class="hint">
  Type the widths you want and press <b>Apply</b> to see them on the tab. When it looks right,
  <b>Save as defaults</b> — from then on every rebuild of that tab uses these widths instead of
  fitting the columns to whatever happens to be in them. Widths are remembered by column heading,
  so they follow the column even if the layout changes.
</p>

<label class="field" for="sheet">Tab</label>
<select id="sheet" onchange="load()"></select>
<div id="saved"></div>

<table id="cols"><thead><tr><th>Column</th><th>Width (px)</th></tr></thead><tbody></tbody></table>

<button id="apply" onclick="apply(false)" disabled>Apply</button>
<button id="save" onclick="apply(true)" disabled>Save as defaults</button>
<button id="clear" class="secondary" onclick="forget()" disabled>Forget defaults</button>
<div id="status"></div>

<script>
  var STATE = null;

  function el(id) { return document.getElementById(id); }
  function say(msg, cls) { var s = el('status'); s.textContent = msg; s.className = cls || ''; }
  function busy(on) {
    ['apply', 'save', 'clear', 'sheet'].forEach(function (id) { el(id).disabled = on; });
    if (!on && STATE) { el('clear').disabled = !STATE.savedCount; }
  }

  function load(name) {
    busy(true);
    say('Reading the columns…', 'busy');
    google.script.run
      .withSuccessHandler(draw)
      .withFailureHandler(function (err) { busy(false); say('Could not read the tab: ' + err.message, 'err'); })
      .readColumnWidthState(name || (STATE ? el('sheet').value : ''));
  }

  function draw(state) {
    STATE = state;
    var picker = el('sheet');
    if (picker.options.length !== state.sheets.length) {
      picker.innerHTML = '';
      state.sheets.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n; o.textContent = n;
        picker.appendChild(o);
      });
    }
    picker.value = state.sheetName;
    el('saved').textContent = state.savedCount
      ? 'This tab has saved widths — they are what you see below.'
      : 'This tab has no saved widths yet; these are the widths the automatic fit chose.';

    var body = el('cols').tBodies[0];
    body.innerHTML = '';
    state.columns.forEach(function (c) {
      var tr = document.createElement('tr');
      var label = document.createElement('td');
      label.textContent = c.header;
      var num = document.createElement('td');
      num.className = 'num';
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '20';
      input.value = c.width;
      input.setAttribute('data-col', c.col);
      num.appendChild(input);
      tr.appendChild(label);
      tr.appendChild(num);
      body.appendChild(tr);
    });
    busy(false);
    say('');
  }

  function typedWidths() {
    var out = [];
    var inputs = el('cols').getElementsByTagName('input');
    for (var i = 0; i < inputs.length; i++) {
      out.push({ col: Number(inputs[i].getAttribute('data-col')), width: Number(inputs[i].value) });
    }
    return out;
  }

  function apply(save) {
    busy(true);
    say(save ? 'Saving…' : 'Applying…', 'busy');
    google.script.run
      .withSuccessHandler(function (res) {
        say(res.message, res.ok ? 'ok' : 'err');
        load(el('sheet').value);
      })
      .withFailureHandler(function (err) { busy(false); say('Failed: ' + err.message, 'err'); })
      .applyColumnWidthsFromDialog({
        sheetName: el('sheet').value,
        widths: typedWidths(),
        saveAsDefaults: !!save
      });
  }

  function forget() {
    if (!window.confirm('Forget the saved widths for this tab and go back to the automatic fit?')) return;
    busy(true);
    say('Clearing…', 'busy');
    google.script.run
      .withSuccessHandler(function (res) {
        say(res.message, res.ok ? 'ok' : 'err');
        load(el('sheet').value);
      })
      .withFailureHandler(function (err) { busy(false); say('Failed: ' + err.message, 'err'); })
      .clearColumnWidthsFromDialog(el('sheet').value);
  }

  load('');
</script>`;
}


