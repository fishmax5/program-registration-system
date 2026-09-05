// ============================================================================
// 1g. TIMEZONE, DATE FORMATTING, AND THE HINTS A FORM LABEL CARRIES
// ============================================================================

const TIMEZONE = SpreadsheetApp.getActiveSpreadsheet()
  ? SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()
  : Session.getScriptTimeZone();

/**
 * A header cell's canonical name. labelManualEntryColumns() decorates the
 * hand-entry columns' header cells with MANUAL_ENTRY_PREFIX, so the literal
 * cell text on Master_Lunch_Dashboard reads "✍️ Standard_Buffer" — every
 * header lookup has to see through that decoration, or a column (and, for
 * findAllHeaderRows(), the entire header row it marks) becomes invisible.
 */
function normalizeHeaderText(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  return text.indexOf(MANUAL_ENTRY_PREFIX) === 0 ? text.substring(MANUAL_ENTRY_PREFIX.length).trim() : text;
}

/** Scans Row 1 for an exact header match and returns its 1-based column index (flat, single-header sheets like Config). */
function getColumnIndex(sheet, colName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeHeaderText(headerRow[i]) === colName) return i + 1;
  }
  log(`⚠️ getColumnIndex: header "${colName}" not found on sheet "${sheet.getName()}"`);
  return -1;
}

/** Convenience wrapper: builds a { headerName: colIndex } map from Row 1 in one pass. */
function getHeaderMap(sheet) {
  return getHeaderMapAt(sheet, 1);
}

/** Same as getHeaderMap(), but for a header at an arbitrary row. */
function getHeaderMapAt(sheet, headerRow) {
  const map = {};
  if (!headerRow || headerRow < 1) return map;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return map;
  const headerRowValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  headerRowValues.forEach((h, i) => {
    const name = normalizeHeaderText(h);
    if (name && map[name] === undefined) map[name] = i + 1;
  });
  return map;
}

/**
 * Scans down row-by-row for EVERY row that contains uniqueHeaderText anywhere
 * in it, returning all matching row numbers. Every date-bearing tab now has
 * TWO such header rows (Upcoming + Past sub-tables — see section 6), so this
 * replaces the old single-header-row finder.
 *
 * HOW FAR IT READS. maxRowsToScan is a CEILING, not a target: the scan stops
 * at getLastRow() — the tab's real extent — and maxRowsToScan only caps that
 * on a workbook whose grid has grown past anything a header search should be
 * paying for. (A tab whose trailing rows were cleared but not deleted still
 * reports a large getLastRow(); that read is honest, and bounded by the
 * ceiling like any other.) `endRow` narrows it further for a caller that
 * already knows where the tables end — see getLunchScheduleEndRow().
 */
function findAllHeaderRows(sheet, uniqueHeaderText, maxRowsToScan, endRow) {
  const ceiling = maxRowsToScan || 3000;
  const bound = endRow ? Math.min(endRow, ceiling) : ceiling;
  const lastRow = Math.min(Math.max(sheet.getLastRow(), 0), bound);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const rows = [];
  for (let r = 0; r < values.length; r++) {
    if (values[r].some(v => normalizeHeaderText(v) === uniqueHeaderText)) rows.push(r + 1);
  }
  return rows;
}

/** Locates Master_Program_Dashboard's session-table header rows (unique marker: 'Event_ID'). */
function findProgramSessionHeaderRows(sheet) {
  return findAllHeaderRows(sheet, 'Event_ID', 5000);
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  // Before creating anything: is this tab already here under the name an
  // earlier version of this script gave it? See LEGACY_SHEET_RENAMES.
  const renamed = getOrCreateSheetRenameOnly(ss, name);
  if (renamed) return renamed;

  sheet = ss.insertSheet(name);
  log(`Created missing tab: ${name}`);
  return sheet;
}

/**
 * Applies every LEGACY_SHEET_RENAMES entry that still needs applying.
 *
 * getOrCreateSheet() already does this lazily, but plenty of code reads a tab
 * with a plain getSheetByName() and treats "not there" as "no rows" — which is
 * the wrong answer for a workbook whose data is sitting under the old name. So
 * the rename is also done eagerly, at the points where a workbook first comes
 * under this script's hands in a session: opening it, setting it up, and each
 * sync. Cheap and idempotent — once the tabs carry their current names this is
 * one getSheetByName() per entry and nothing else.
 */
function migrateLegacySheetNames(ss) {
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(LEGACY_SHEET_RENAMES).forEach(currentName => {
    if (book.getSheetByName(currentName)) return;
    getOrCreateSheetRenameOnly(book, currentName);
  });
}

/** The rename half of getOrCreateSheet(), without the "create it if it isn't there" half. */
function getOrCreateSheetRenameOnly(ss, name) {
  const formerName = LEGACY_SHEET_RENAMES[name];
  if (!formerName) return null;
  const former = ss.getSheetByName(formerName);
  if (!former) return null;
  try {
    former.setName(name);
    log(`Renamed the "${formerName}" tab to "${name}" — its rows, formatting and history are unchanged.`);
    return former;
  } catch (err) {
    log(`⚠️ Could not rename "${formerName}" to "${name}" (${err}).`);
    return null;
  }
}

/**
 * Reads a range as values, but substitutes the formula string wherever a
 * cell contains one — use this instead of plain getValues() whenever rows
 * are about to be copied/relocated elsewhere (a plain getValues() read
 * would flatten a HYPERLINK formula down to dead plain text).
 */
function getRowsPreservingFormulas(sheet, startRow, startCol, numRows, numCols) {
  const range = sheet.getRange(startRow, startCol, numRows, numCols);
  const values = range.getValues();
  const formulas = range.getFormulas();
  return values.map((row, r) => row.map((val, c) => formulas[r][c] || val));
}

/**
 * Generic "dropdown restricted to a predefined list" helper — every
 * dropdown in the workbook is built on top of this ONE implementation.
 */
function applyValueListValidationBounded(sheet, colIndex, options, startRow, numRows) {
  if (!colIndex || colIndex < 1 || numRows < 1 || !options || options.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build();
  sheet.getRange(startRow, colIndex, numRows, 1).setDataValidation(rule);
}

/**
 * Same idea for a YES/NO cell: a checkbox, which is TRUE or FALSE and cannot
 * be typed into as "y", "yes please" or a stray space. Every tick box in the
 * workbook is built on this one implementation.
 */
function applyCheckboxValidationBounded(sheet, colIndex, startRow, numRows) {
  if (!colIndex || colIndex < 1 || numRows < 1) return;
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(startRow, colIndex, numRows, 1).setDataValidation(rule);
}

/**
 * Same, but SUGGESTING rather than restricting: the list drops down, and a
 * value that isn't on it is still accepted. For cells where the list is a
 * convenience and the vocabulary is genuinely open — a walk-in's name, a
 * pasted location — rejecting the input is worse than not knowing it.
 */
function applyOpenValueListValidationBounded(sheet, colIndex, options, startRow, numRows) {
  if (!colIndex || colIndex < 1 || numRows < 1 || !options || options.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(true).build();
  sheet.getRange(startRow, colIndex, numRows, 1).setDataValidation(rule);
}

/** Same as above, from startRow to the end of the sheet. */
function applyValueListValidationRange(sheet, colIndex, options, startRow) {
  if (!colIndex || colIndex < 1) return;
  const numRows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
  applyValueListValidationBounded(sheet, colIndex, options, startRow, numRows);
}

/** Applies a dropdown restricted to MANUAL_OVERRIDE_OPTIONS, starting at row 2 (unbounded — general utility). */
function applyManualOverrideValidation(sheet, colIndex) {
  applyManualOverrideValidationRange(sheet, colIndex, 2);
}

function applyManualOverrideValidationRange(sheet, colIndex, startRow) {
  applyValueListValidationRange(sheet, colIndex, MANUAL_OVERRIDE_OPTIONS, startRow);
}

function applyManualOverrideValidationBounded(sheet, colIndex, startRow, numRows) {
  applyValueListValidationBounded(sheet, colIndex, MANUAL_OVERRIDE_OPTIONS, startRow, numRows);
}

/**
 * Deterministic color fallback for a location not in LOCATION_COLOR_MAP.
 *
 * Generated INTO the tint layer (see PALETTE) — pale enough to sit beside the
 * named locations without a fourth building looking louder than the three that
 * have colors of their own.
 */
function getLocationColor(locationName) {
  if (LOCATION_COLOR_MAP[locationName]) return LOCATION_COLOR_MAP[locationName];
  let hash = 0;
  for (let i = 0; i < locationName.length; i++) {
    hash = locationName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hslToPastelHex(hueAvoidingReservedColors(hash), 40, 93);
}

/** Dropdown restricted to the current CALENDAR_MAP location names, from startRow to the end of the sheet. */
function applyLocationValidationRange(sheet, colIndex, startRow) {
  applyValueListValidationRange(sheet, colIndex, Object.values(CALENDAR_MAP), startRow);
}

/** Same, but bounded to an exact number of rows. */
function applyLocationValidationBounded(sheet, colIndex, startRow, numRows) {
  applyValueListValidationBounded(sheet, colIndex, Object.values(CALENDAR_MAP), startRow, numRows);
}

/** Builds one color-coded conditional format rule per known location, across one or more ranges. */
function buildLocationColorRules(ranges) {
  if (ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(loc)
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/**
 * Same colors as buildLocationColorRules(), but painted across a row BAND
 * rather than just the Location cell, keyed off that row's own Location
 * column — so a lunch schedule mixing several locations on the same date
 * reads as blocks of color instead of one tinted cell per row.
 *
 * excludeCols (1-based) carves out the cells that already carry their own
 * meaning — the month-tinted Event_Date, the yellow hand-entry columns — the
 * same way buildManualOverrideRowTintRules() does. Push these rules AFTER any
 * more specific rule over the same cells (the purple manual-override tint,
 * the grey "Not Serving" type cell): the first matching rule wins.
 */
function buildLocationRowTintRules(sheet, dataStartRow, numRows, numCols, locationCol, excludeCols) {
  if (numRows < 1 || !locationCol) return [];
  const colLetter = columnToLetter(locationCol);
  const ranges = buildRowRangesExcludingColumns(sheet, dataStartRow, numRows, numCols, excludeCols);
  if (ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}${dataStartRow}="${loc}"`)
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/** Converts a 1-based column index to its A1 letter(s) (1 -> 'A', 27 -> 'AA'). */
function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/**
 * Returns one Range per contiguous run of 1-based columns from 1..numCols,
 * skipping any column in excludeCols — used so a "whole row" conditional
 * tint never paints over a cell that already carries its own more specific
 * meaning.
 */
function buildRowRangesExcludingColumns(sheet, startRow, numRows, numCols, excludeCols) {
  const excludeSet = new Set((excludeCols || []).filter(c => c && c > 0));
  const ranges = [];
  let runStart = null;
  for (let c = 1; c <= numCols; c++) {
    if (excludeSet.has(c)) {
      if (runStart !== null) { ranges.push(sheet.getRange(startRow, runStart, numRows, c - runStart)); runStart = null; }
    } else if (runStart === null) {
      runStart = c;
    }
  }
  if (runStart !== null) ranges.push(sheet.getRange(startRow, runStart, numRows, numCols - runStart + 1));
  return ranges;
}

/**
 * Builds conditional format rules that tint MOST of a row's cells whenever
 * that row's Manual_Override reads "Manually Edited" or "Manually Added".
 * excludeCols (1-based) lets a caller carve out columns with their own more
 * specific highlight (Status, Location, the month tint, a manual-entry
 * column's yellow wash) so the purple tint never overrides them.
 */
function buildManualOverrideRowTintRules(sheet, dataStartRow, numRows, numCols, overrideCol, excludeCols) {
  if (numRows < 1 || !overrideCol) return [];
  const colLetter = columnToLetter(overrideCol);
  const ranges = buildRowRangesExcludingColumns(sheet, dataStartRow, numRows, numCols, excludeCols);
  if (ranges.length === 0) return [];
  return ['Manually Edited', 'Manually Added'].map(text =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}${dataStartRow}="${text}"`)
      .setBackground(MANUAL_OVERRIDE_COLOR)
      .setRanges(ranges)
      .build()
  );
}

/** Highlights + labels the header cells of columns meant for hand entry. */
function labelManualEntryColumns(sheet, headerRow, headers, manualColumnNames) {
  manualColumnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx === -1) return;
    // A HEADER cell, which is what every sectioned read projects its columns
    // by — so this is a write the cache has to hear about like any other.
    invalidateSectionedRowsCache(sheet);
    sheet.getRange(headerRow, idx + 1)
      .setValue(`${MANUAL_ENTRY_PREFIX} ${name}`)
      .setBackground(MANUAL_ENTRY_HEADER_COLOR)
      .setFontColor('#000000')
      .setFontWeight('bold');
  });
}

/** Washes the data cells of manual-entry columns with a light tint. */
function tintManualEntryColumns(sheet, startRow, numRows, headers, manualColumnNames) {
  if (numRows < 1) return;
  manualColumnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx === -1) return;
    sheet.getRange(startRow, idx + 1, numRows, 1).setBackground(MANUAL_ENTRY_CELL_TINT);
  });
}

/** Greys out only blank/"--" cells in given columns. General-purpose utility (not currently on any render path). */
function greyOutDashCells(sheet, startRow, numRows, colIndexes) {
  if (numRows < 1) return;
  colIndexes.forEach(col => {
    if (!col || col < 1) return;
    const values = sheet.getRange(startRow, col, numRows, 1).getValues();
    values.forEach((r, i) => {
      const v = String(r[0]).trim();
      if (v === '--' || v === '') {
        sheet.getRange(startRow + i, col).setBackground(NA_CELL_COLOR);
      }
    });
  });
}

/** Deterministic pastel color fallback for months not in MONTH_COLOR_MAP. */
function getMonthColor(monthName) {
  if (MONTH_COLOR_MAP[monthName]) return MONTH_COLOR_MAP[monthName];
  let hash = 0;
  for (let i = 0; i < monthName.length; i++) {
    hash = monthName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hueAvoidingReservedColors(hash);
  // Tint layer, like the named months above it — a generated month must not
  // arrive stronger than the twelve that were chosen by hand.
  return hslToPastelHex(hue, 45, 92);
}

/**
 * Maps an arbitrary hash into a hue that skips reserved bands (status
 * green/red, plus the three location colors' neighborhoods), leaving three
 * safe zones: gold/yellow, teal, magenta — exactly where MONTH_COLOR_MAP's
 * palette lives.
 */
function hueAvoidingReservedColors(hash) {
  const bands = [[50, 80], [165, 195], [290, 335]];
  const totalWidth = bands.reduce((sum, b) => sum + (b[1] - b[0]), 0);
  let pos = Math.abs(hash) % totalWidth;
  for (const [lo, hi] of bands) {
    const width = hi - lo;
    if (pos < width) return lo + pos;
    pos -= width;
  }
  return bands[0][0];
}

function hslToPastelHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function getMonthLabel(date) {
  return Utilities.formatDate(date, TIMEZONE, 'MMMM yyyy');
}

function formatDateKey(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

function formatDateLabel(date) {
  return Utilities.formatDate(date, TIMEZONE, 'EEE, MMM d, yyyy');
}

/** Parses a 'yyyy-MM-dd' key back into a local Date at midnight. */
function parseDateKey(dateKey) {
  const parts = String(dateKey).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** Returns a real Date from a sheet cell value, or null if it can't be parsed. */
function coerceDate(val) {
  if (val instanceof Date) return val;
  if (val === '' || val === null || val === undefined) return null;
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function makeHyperlinkFormula(url, label) {
  return `=HYPERLINK("${url}","${label}")`;
}

/**
 * THE FORM-SPAN A SESSION BELONGS TO — 'FIXED' for a [Grouped] series, which
 * takes one form for its whole run, else the month label, because a Regular
 * program takes one form per calendar month (see buildEventGroups()).
 *
 * WHY THIS IS A NAMED THING RATHER THAN AN EXPRESSION. A Form_ID is only
 * meaningful alongside its span. "Chair Yoga on the Narberth calendar" names
 * one form in September and a DIFFERENT one in October, so any map from a
 * program to its form that is keyed on calendar + title alone cannot hold both
 * — the second month written silently replaces the first, and every lookup
 * afterwards answers one month's question with the other month's form. That is
 * exactly how a session a month out ends up carrying this month's link.
 *
 * A FLAG is the opposite case and is deliberately NOT keyed this way: [Club],
 * [No Registration] and [Personalized Assistance] are properties of the
 * PROGRAM, true of every month of it at once — the rule
 * unifyProgramFlagsAcrossGroups() exists to enforce. So those maps stay on
 * `calendarId|title`, and only the form lookups carry a span.
 */
function formSpanForGroup(group) {
  if (!group) return '';
  return group.isFixed ? 'FIXED' : String(group.monthLabel || '');
}

/** The same span, read off a session ROW (its Type_Tag and its date) instead of a group. */
function formSpanForRow(typeTag, date) {
  if (isGroupedTypeTag(typeTag)) return 'FIXED';
  const d = coerceDate(date);
  return d ? getMonthLabel(d) : '';
}

/** Key for a `calendarId + title + span` -> Form_ID map. See formSpanForGroup(). */
function programFormKey(calendarId, cleanTitle, span) {
  return `${String(calendarId || '').trim()}|${String(cleanTitle || '').trim()}|${span}`;
}

function computeEventId(calendarId, cleanTitle, dateKey) {
  const raw = `${calendarId}|${cleanTitle}|${dateKey}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('').substring(0, 12);
}

/**
 * WHAT A SESSION TAKING NO MORE PLACES READS AS. Spelled once because two
 * different facts now produce it: a capped session that has filled up (below),
 * and a session a human has forced to the waitlist whatever its capacity says
 * (see WAITLIST_ONLY_TAG). Both mean the same thing to whoever is looking at
 * the tab — the next person to sign up is on a list, not in the room — so they
 * deliberately say it in the same words and take the same red from
 * EVENT_STATUS_COLORS, which is keyed by this exact string.
 */
const WAITLIST_ONLY_STATUS = '🔴 Waitlist Only';

function computeStatus(activeCount, maxCapacity) {
  if (maxCapacity <= 0) return '🟢 Open';
  const remaining = maxCapacity - activeCount;
  if (remaining <= 0) return WAITLIST_ONLY_STATUS;
  if (remaining <= Math.max(1, Math.ceil(maxCapacity * 0.15))) return '🟡 Almost Full';
  return '🟢 Open';
}

/**
 * Suffix appended by formatDateLabelWithMeal() when a capped session has
 * hit 0 Remaining_Seats — converts silent waitlisting into something a
 * respondent actually sees before submitting (see
 * buildCapacityHintsFromRegistryRows() / refreshFormShapeForAllForms()).
 * Deliberately a plain hyphen, not the em dash " — " used for meal hints,
 * so stripMealHint() can tell the two apart unambiguously.
 */
const CAPACITY_HINT_SUFFIX = ' (FULL - Waitlist)';

/** What formatDateLabelWithMeal() puts between a session label and its menu hint. */
const MEAL_HINT_SEPARATOR = ' — ';

/**
 * HOW A DATE'S MENU READS ON THE FORM: "(Lunch: Chicken Parmesan)".
 *
 * It used to be the bare dish — "Tue 9/16/2026 — Chicken Parmesan" — and a
 * respondent scanning a column of those has to work out for themselves what
 * the words after the dash are FOR. Several read them as the name of the
 * session (a "Chicken Parmesan" class), which is a reasonable reading of a
 * date followed by a phrase, and one of them is on a form for a program that
 * has nothing to do with food. Saying "Lunch:" in front of the dish costs
 * seven characters and removes the guess.
 *
 * The SEPARATOR IS UNCHANGED, deliberately: stripMealHint() and
 * sessionLabelCandidates() cut a decorated label back to the plain one at
 * " — ", which is the join key between a grid row and its session, so every
 * registration already collected against an old-style label still resolves.
 * Only the text after the separator has changed.
 */
function formatMealHint(hint) {
  return `(Lunch: ${String(hint).trim()})`;
}

/**
 * What a date marked "Not Serving" says instead. Still carries the exact words
 * "No Lunch Served" — buildFormDescription() looks for them in the label list
 * to decide whether to add its footnote — inside the same brackets the menu
 * hint uses, so a column of dates reads as one thing rather than two.
 */
const NO_LUNCH_HINT = '(No Lunch Served)';

/** Strips the CAPACITY_HINT_SUFFIX and/or the " — <shorthand/description>" menu hint appended by formatDateLabelWithMeal(), returning the plain date label. */
function stripMealHint(label) {
  let s = String(label);
  if (s.endsWith(CAPACITY_HINT_SUFFIX)) s = s.slice(0, -CAPACITY_HINT_SUFFIX.length);
  const idx = s.indexOf(MEAL_HINT_SEPARATOR);
  return idx === -1 ? s : s.substring(0, idx);
}

/**
 * Every plain session label a decorated form label could be hiding, LONGEST
 * FIRST — the capacity suffix off, then each " — " cut away from the right.
 *
 * WHY THIS ISN'T JUST stripMealHint(). That function cuts at the FIRST " — ",
 * which is right only when the separator appears exactly once. It can appear
 * more than once from either side:
 *
 *   a PROGRAM NAME with an em dash in it ("Tech Help — Drop In"), which
 *     formatSessionLabel() puts INTO the plain label on a combined form — so
 *     cutting at the first separator truncates the label to "…· Tech Help",
 *     which matches no session and silently drops every registration for that
 *     program (registryIndex is keyed on the plain label);
 *   a MEAL SHORTHAND with one ("Chicken — house made"), which just adds a
 *     second separator after the first.
 *
 * Trying the longest candidate first means a real label always wins over a
 * shorter prefix of itself, so a form carrying both "· Tech Help" and
 * "· Tech Help — Drop In" still resolves each to its own session.
 */
function sessionLabelCandidates(label) {
  let s = String(label);
  if (s.endsWith(CAPACITY_HINT_SUFFIX)) s = s.slice(0, -CAPACITY_HINT_SUFFIX.length);
  const out = [];
  for (let cursor = s; ;) {
    out.push(cursor);
    const idx = cursor.lastIndexOf(MEAL_HINT_SEPARATOR);
    if (idx === -1) return out;
    cursor = cursor.substring(0, idx);
  }
}

/**
 * The plain session label a form grid row refers to — the one that answers in
 * `registryIndex` — recovered from the decorated label the respondent saw.
 * Returns '' when no candidate matches, which is the caller's cue that this
 * row belongs to no session it knows about.
 */
function resolveSessionLabelForForm(registryIndex, formId, decoratedLabel) {
  const candidates = sessionLabelCandidates(decoratedLabel);
  for (let i = 0; i < candidates.length; i++) {
    if (registryIndex[`${formId}|${candidates[i]}`]) return candidates[i];
  }
  return '';
}

/**
 * How every Event_Date cell in this workbook reads: "Tue 9/16/2026".
 *
 * THE DAY NAME IS THE POINT. Asked for from the desk, in these words: "Any
 * chance we could have the day of the week on the main event page as well as
 * the date? It would make it easier to find things like 'Advanced Mah Jongg'
 * at Ashbridge (Tues) vs 'Advanced Mah Jongg' at Narberth (Mon)." Programs
 * here are known by their day as much as by their name, and a bare 9/16/2026
 * made the one distinguishing fact the reader had to work out for themselves.
 *
 * It is still a real date underneath — this is a display format, not a string
 * — so sorting, coerceDate() and every date comparison are unaffected.
 */
const DATE_DISPLAY_FORMAT = 'ddd M/d/yyyy';

/**
 * The same date cell shown as its MONTH alone — "September 2026".
 *
 * Master_Program_Dashboard's session table reads by month rather than by day:
 * the day is already in Event_Time's row and in the calendar, and a column of
 * thirty near-identical dates is noise there. The cell still holds the real
 * start datetime, so partitionByDate(), collapseOldPastMonths() and the
 * Event_Time formulas that read it are untouched — only what a person sees
 * changes. See applyMonthColorTint(), whose `format` argument carries it.
 */
const MONTH_DISPLAY_FORMAT = 'MMMM yyyy';

/**
 * Tints an Event_Date column's cells by month — the direct replacement for the
 * old separate Month column everywhere — and stamps DATE_DISPLAY_FORMAT while
 * it is there.
 *
 * The two belong together: this is called on exactly the Event_Date column of
 * exactly the tabs that have one, from writeUpcomingPastSections(), so it is
 * the one place that already knows where every date cell in the workbook is.
 *
 * `format` lets one tab say it wants its dates read differently —
 * Master_Program_Dashboard passes MONTH_DISPLAY_FORMAT. Omitted, every tab
 * gets DATE_DISPLAY_FORMAT as it always has.
 */
function applyMonthColorTint(sheet, colIndex1Based, startRow, numRows, format) {
  if (numRows < 1) return;
  const range = sheet.getRange(startRow, colIndex1Based, numRows, 1);
  const values = range.getValues();
  const backgrounds = values.map(r => { const d = coerceDate(r[0]); return [d ? getMonthColor(getMonthLabel(d)) : PALETTE.PAPER]; });
  range.setBackgrounds(backgrounds);
  range.setNumberFormat(format || DATE_DISPLAY_FORMAT);
}

/** Builds a "text equals" conditional format rule across one or more explicit ranges. */
function buildTextEqualsRuleForRanges(ranges, text, bgColor) {
  if (!ranges || ranges.length === 0) return null;
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bgColor).setRanges(ranges).build();
}


