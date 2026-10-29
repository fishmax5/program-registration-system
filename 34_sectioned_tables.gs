// ============================================================================
// 6. SECTIONED TABLE HELPERS  (Upcoming / Past split — every date-bearing tab)
// ============================================================================
//
// Every tab keyed by Event_Date now renders as two stacked sub-tables: dates
// today-or-later ("Upcoming", ascending) and dates before today ("Past",
// most-recent-first). This section holds the shared machinery: finding a
// tab's (possibly several) header rows, reading all its rows regardless of
// which zone they're currently in, splitting rows by date, and writing the
// two zones back out with consistent banners/headers/zebra striping/month
// tinting. All_Program_Sessions and Master_Lunch_Dashboard call the
// lower-level writeUpcomingPastSections() directly (since they have their
// own extra Today/Metrics sections above); the three flat, single-table
// tabs (All_Registrants, Deleted_Event_Triage, Lunch_Schedule)
// use the renderFlatDateSheet() wrapper instead.
// ============================================================================

/**
 * Given the exact row of one header and the row of the NEXT header (or null
 * if this is the last zone), finds the contiguous span of rows in between
 * that actually contain a parseable date in dateCol1Based — i.e. the real
 * data rows, skipping whatever banner/spacer rows sit in between. Returns
 * null if the zone has no data rows.
 */
function getZoneDataRange(sheet, headerRow, nextHeaderRow, dateCol1Based) {
  if (!dateCol1Based) return null;
  // One column of the tab's cached grid (96), not a read of its own. Called
  // once per zone per pass, which on the reconcile phase alone was a dozen
  // round trips asking the same question of the same unchanged column.
  const entry = readSheetGrid(sheet, false);
  if (!entry) return null;
  const scanEnd = nextHeaderRow ? nextHeaderRow - 1 : entry.lastRow;
  if (scanEnd < headerRow + 1) return null;
  let firstRow = -1, lastRow = -1;
  for (let row = headerRow + 1; row <= scanEnd; row++) {
    const line = entry.values[row - 1];
    if (line && coerceDate(line[dateCol1Based - 1]) && !isSectionedDividerValue(line[0])) {
      if (firstRow === -1) firstRow = row;
      lastRow = row;
    }
  }
  if (firstRow === -1) return null;
  return { start: firstRow, count: lastRow - firstRow + 1 };
}

/**
 * Returns [{headerRow, dataStart, dataEnd}, ...] for every header row found
 * via `markerHeaderName` on `sheet`.
 *
 * `endRow` bounds the LAST zone. Without it the final table runs to the
 * bottom of the sheet, which is right everywhere except Lunch_Schedule, whose
 * ADD block sits below the tables and holds dated rows that are explicitly
 * NOT part of the schedule yet — see getLunchScheduleEndRow().
 */
function getSectionZones(sheet, markerHeaderName, endRow) {
  const headerRows = findAllHeaderRows(sheet, markerHeaderName, 5000, endRow);
  if (headerRows.length === 0) return [];
  const map = getHeaderMapAt(sheet, headerRows[0]);
  const dateCol = map['Event_Date'];
  const limit = endRow || null;
  return headerRows.map((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : (limit ? limit + 1 : null);
    const zone = getZoneDataRange(sheet, hRow, nextHeader, dateCol);
    return zone
      ? { headerRow: hRow, dataStart: zone.start, dataEnd: zone.start + zone.count - 1 }
      : { headerRow: hRow, dataStart: hRow + 1, dataEnd: hRow };
  });
}

function isRowInAnyDataZone(zones, row) {
  return findZoneForRow(zones, row) !== null;
}

/** The zone (from getSectionZones()) whose data rows contain `row`, or null. */
function findZoneForRow(zones, row) {
  return zones.filter(z => row >= z.dataStart && row <= z.dataEnd)[0] || null;
}

/**
 * Reads every current data row across all of a tab's stacked sub-tables
 * (each with its own header row located via `markerHeaderName`) into one
 * combined array, preserving formulas. Banner/spacer rows are skipped
 * automatically since they never contain a parseable Event_Date.
 *
 * Rows come back in `headers` order even when the SHEET's own columns are in
 * a different order — see buildHeaderProjection(). That is what lets a
 * HEADERS entry be reordered (or gain/lose a column) without scrambling the
 * data already sitting on the tab: the next render reads by header NAME and
 * writes back out in the new order.
 *
 * TWO round trips for the whole tab, whatever the section count — see
 * readSectionedGrid_().
 */
function readAllSectionedRows(sheet, headers, markerHeaderName, endRow) {
  return readSectionedGrid_(sheet, headers, markerHeaderName, endRow, true);
}

/**
 * The same rows as readAllSectionedRows(), read in ONE call and WITHOUT
 * formula preservation. For readers that only want to look at the data.
 *
 * WHY IT EXISTS. readAllSectionedRows() is built for a render: it is about to
 * copy rows back onto a sheet, so a HYPERLINK cell has to come back as its
 * formula rather than as dead text, and that costs a getFormulas() on top of
 * the getValues(). Nothing here is going back onto a sheet, so the second
 * fetch is dead weight — one getValues() of the whole grid answers all of it.
 *
 * It is also the MORE correct read for a consumer of values: All_Registrants's
 * Event_Time is a formula, and the formula-preserving read hands back the
 * formula string, which is not a time anything can parse.
 */
function readAllSectionedRowValues(sheet, headers, markerHeaderName) {
  return readSectionedGrid_(sheet, headers, markerHeaderName, null, false);
}

/**
 * How far down a tab a header row is looked for. Both readers stop here; the
 * formula-preserving one still reads DATA past it (see below).
 */
const SECTIONED_HEADER_SCAN_ROWS = 5000;

/**
 * The one implementation behind both sectioned readers.
 *
 * WHAT IT COSTS, AND WHY THAT IS THE POINT. This used to be 1 + 2N round
 * trips on the formula-preserving path: a whole-grid scan in
 * findAllHeaderRows() to locate the header rows, then per sub-table a header
 * read plus a getRowsPreservingFormulas() — itself a getValues() AND a
 * getFormulas(). On a workbook with a year of history that is the tab read
 * three times over, and the round trips, not the parsing, are what a person
 * feels: it is what took Quick Mark's open to a twenty-second wait.
 *
 * So the grid is fetched ONCE (twice with `preserveFormulas`: getValues() +
 * getFormulas(), merged here exactly as getRowsPreservingFormulas() does it),
 * the header rows are found in the grid already in memory, and each
 * sub-table's rows are sliced out of it. Two calls per tab — one without
 * formulas — however many sections the tab has grown.
 *
 * `endRow` bounds the read, which is both halves of what Lunch_Schedule needs
 * from it: the last zone stops there, and the ADD block below it — dated rows
 * that are explicitly NOT part of the schedule yet — is never read at all.
 * See getLunchScheduleEndRow().
 */
function readSectionedGrid_(sheet, headers, markerHeaderName, endRow, preserveFormulas) {
  if (!sheet) return [];
  // Through the per-execution grid cache (96), so a tab read by a reconcile
  // pass and then by the render that follows it costs one fetch between them
  // rather than one each. The cache is dropped by every writer — see
  // invalidateSectionedRowsCache().
  const entry = readSheetGrid(sheet, !!preserveFormulas);
  if (!entry) return [];
  let lastRow = entry.lastRow;
  if (endRow) lastRow = Math.min(endRow, lastRow);
  // A values read is only a read, so the row bound that keeps a runaway tab
  // from costing the door page a huge fetch is free to apply. The
  // formula-preserving read is a RENDER's read — the rows it returns are the
  // rows about to be written back — so truncating it would delete whatever
  // sat past the bound. It reads to the bottom for that reason.
  if (!preserveFormulas) lastRow = Math.min(lastRow, SECTIONED_HEADER_SCAN_ROWS);
  if (lastRow < 1) return [];

  const values = entry.values;
  // The formula string wherever a cell holds one, the value everywhere else —
  // getRowsPreservingFormulas(), done once for the whole grid.
  const grid = sheetGridCells(entry, !!preserveFormulas);

  // Header rows are located in `values`, never in the merged grid: a marker
  // cell is text, and a stray formula beside it must not change what the row
  // is recognized as.
  const headerRows = [];
  const scanEnd = Math.min(values.length, SECTIONED_HEADER_SCAN_ROWS);
  for (let r = 0; r < scanEnd; r++) {
    if (values[r].some(v => normalizeHeaderText(v) === markerHeaderName)) headerRows.push(r + 1);
  }
  if (headerRows.length === 0) return [];

  const dateColIdx = headers.indexOf('Event_Date');
  let combined = [];
  headerRows.forEach((hRow, i) => {
    const zoneEnd = (i + 1 < headerRows.length) ? headerRows[i + 1] - 1 : lastRow;
    if (zoneEnd <= hRow) return;
    const projection = buildHeaderProjectionFromRow(values[hRow - 1], headers,
      `"${sheet.getName()}" row ${hRow}`);
    let rows = grid.slice(hRow, zoneEnd); // hRow is 1-based, so this starts one past the header
    rows = projection
      ? rows.map(row => projection.map(src => (src === -1 ? '' : row[src])))
      : rows.map(row => row.slice(0, headers.length));
    // A DATA ROW IS A DATED ROW THAT IS NOT A HEADING. The date test alone is
    // what has always made banners and spacers invisible here, and it covers a
    // program heading too (99zs writes none with a date). The second test is
    // for the one heading it would not cover: a program whose own title parses
    // as a date. Both, so no reader in the project can see a heading row.
    combined = combined.concat(dateColIdx >= 0
      ? rows.filter(row => coerceDate(row[dateColIdx]) && !isSectionedDividerValue(row[0]))
      : rows.filter(row => !isSectionedDividerValue(row[0])));
  });
  return combined;
}

/**
 * Compares a header ROW as it actually sits on the sheet against the header
 * array the code expects.
 *
 * Returns null when they already line up column-for-column — the fast path,
 * and the only case that ever ran before this existed. Otherwise returns a
 * per-canonical-column array of 0-based SHEET column indexes (-1 for a
 * column the sheet doesn't have yet), so a sectioned read can project each
 * row into the expected order.
 *
 * This is what makes changing a HEADERS layout safe on a workbook that
 * already holds data. Reordering the array used to silently reinterpret
 * every stored row positionally — with Event_Date moving to column A, every
 * existing registrant row would have been read with a Location string where
 * its date belonged, failed the date filter, and been dropped on the next
 * render.
 */
function buildHeaderProjection(sheet, headerRow, headers, lastCol) {
  return buildHeaderProjectionFromRow(
    sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0], headers,
    `"${sheet.getName()}" row ${headerRow}`);
}

/**
 * The half of buildHeaderProjection() that needs no sheet: the header row's
 * values are already in hand.
 *
 * Split out for readSectionedGrid_(), which fetches a tab's whole grid up
 * front and therefore already holds every header row it is about to project —
 * going back to the sheet for each of them would put back exactly the round
 * trips that read is there to remove. `where` is only used to say which row
 * was re-aligned in the log.
 */
function buildHeaderProjectionFromRow(headerRowValues, headers, where) {
  const rowValues = headerRowValues.map(normalizeHeaderText);
  const alreadyAligned = headers.every((h, i) => rowValues[i] === h);
  if (alreadyAligned) return null;

  const colByName = {};
  rowValues.forEach((name, i) => { if (name && colByName[name] === undefined) colByName[name] = i; });
  // A canonical column the sheet doesn't have may still be there under the
  // name an older version wrote — see LEGACY_HEADER_ALIASES. Checked only
  // AFTER the canonical name misses, so a workbook carrying both columns
  // (mid-migration) always prefers the current one.
  const resolve = h => {
    if (colByName[h] !== undefined) return colByName[h];
    const aliases = LEGACY_HEADER_ALIASES[h] || [];
    for (const alias of aliases) {
      if (colByName[alias] !== undefined) return colByName[alias];
    }
    return -1;
  };
  const projection = headers.map(resolve);
  const missing = headers.filter((h, i) => projection[i] === -1);
  log(`Re-aligned ${where} by header name` +
    (missing.length > 0 ? ` (no column on the sheet yet for: ${missing.join(', ')})` : ''));
  return projection;
}

/** Splits rows into { upcoming (today-or-later, ascending), past (before today, most-recent-first) }. Rows with no parseable date are treated as upcoming (kept visible). */
function partitionByDate(rows, dateColIdx, todayKey) {
  const upcoming = [], past = [];
  rows.forEach(row => {
    const d = dateColIdx >= 0 ? coerceDate(row[dateColIdx]) : null;
    if (!d) { upcoming.push(row); return; }
    if (formatDateKey(d) >= todayKey) upcoming.push(row); else past.push(row);
  });
  const byDateAsc = (a, b) => {
    const da = coerceDate(a[dateColIdx]), db = coerceDate(b[dateColIdx]);
    if (!da || !db) return 0;
    return da - db;
  };
  upcoming.sort(byDateAsc);
  past.sort((a, b) => -byDateAsc(a, b));
  return { upcoming, past };
}

// ============================================================================
// OLD MONTHS
// ============================================================================
//
// Every date-sorted tab in this workbook grows in one direction forever. A
// year in, the Past section of All_Registrants is thousands of
// rows that nobody scrolls through and every render rewrites.
//
// THE CHEAP HALF OF THE PROBLEM — that it is in the way — is solved here, by
// HIDING past rows older than PAST_MONTHS_SHOWN months. Hiding, specifically:
//
//   • Nothing is moved and nothing is deleted, so no sync, count, dashboard
//     rollup or Member_Roll recompute sees any difference. That matters more
//     than it sounds: the rows on these tabs ARE the database, and a scheme
//     that relocates them has to be right about every reader of every tab.
//   • Ctrl+F still finds a hidden row. Someone asking "was Marion here last
//     March?" gets an answer, without the tab opening onto last March.
//   • It is one API call to undo (showAllPastRows(), on the menu).
//
// THE EXPENSIVE HALF — that the rows still cost render time and cells — is
// NOT solved here, deliberately. See reportArchivableMonths(), which measures
// it and says what the options are, and the "Old months" section of
// USER_GUIDE.md, which lays out the archive designs and why none of them is
// worth doing before the numbers say so.
// ============================================================================

/**
 * How many months of past rows stay visible, counting the current month.
 * 2 = this month and last month; anything older is hidden.
 */
const PAST_MONTHS_SHOWN = 2;

/** 'yyyy-MM' for a date — the key old-month collapsing compares on. */
function formatMonthKey(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM');
}

/** The oldest month that stays visible, as a 'yyyy-MM' key. */
function getVisibleMonthCutoffKey() {
  const now = new Date();
  return formatMonthKey(new Date(now.getFullYear(), now.getMonth() - (PAST_MONTHS_SHOWN - 1), 1));
}

/**
 * Hides the tail of a Past block — the rows whose month is older than the
 * cutoff. Returns how many rows were hidden.
 *
 * ONE CONTIGUOUS BLOCK, always: partitionByDate() sorts past rows
 * most-recent-first, so "older than X" is by construction a suffix. That is
 * what keeps this to a single hideRows() call however many years accumulate,
 * and it is why this function is a suffix scan rather than a filter.
 *
 * Undated rows (there shouldn't be any in a Past block, but a hand-typed row
 * can produce one) count as visible and stop the scan — hiding a row nobody
 * can find again by date is exactly the outcome to avoid.
 */
function collapseOldPastMonths(sheet, pastDataStart, pastRows, dateColIdx) {
  if (!pastRows || pastRows.length === 0 || dateColIdx < 0) return 0;
  const cutoff = getVisibleMonthCutoffKey();

  let firstOldIndex = -1;
  for (let i = pastRows.length - 1; i >= 0; i--) {
    const d = coerceDate(pastRows[i][dateColIdx]);
    if (!d || formatMonthKey(d) >= cutoff) break;
    firstOldIndex = i;
  }
  if (firstOldIndex === -1) return 0;

  const count = pastRows.length - firstOldIndex;
  try {
    sheet.hideRows(pastDataStart + firstOldIndex, count);
  } catch (err) {
    log(`ℹ️ Could not hide ${count} old row(s) on "${sheet.getName()}" (${err}) — they stay visible.`);
    return 0;
  }
  return count;
}

/**
 * Un-hides every row on a rendered tab. Called at the START of each full
 * render: sheet.clear() does NOT reset row visibility, so yesterday's hidden
 * range would otherwise still be hidden today, over completely different rows.
 */
/**
 * Puts a band of rows back to the default height.
 *
 * THE SAME CLASS OF LEFTOVER AS A HIDDEN ROW, and it outlives clear() for the
 * same reason: a row height is a property of the ROW, not of what is in it, so
 * clearing the sheet leaves every height exactly as the last render set it.
 *
 * On a tab whose top blocks change SIZE between renders that is visible
 * damage, not untidiness. Master_Lunch_Dashboard's pinned sign-up block is one
 * row tall with no forms and five with four months of them, and its banner
 * rows are 40px against a 21px default — so a render that shrank the block
 * left a run of fat empty rows sitting above the Today block, and one that
 * grew it left a squashed banner. The tab reads as broken because, in the only
 * sense that matters to somebody looking at it, it is.
 */
function resetRowHeights(sheet, fromRow, toRow) {
  const last = Math.min(toRow, sheet.getMaxRows());
  if (!fromRow || last < fromRow) return;
  try {
    sheet.setRowHeights(fromRow, last - fromRow + 1, ROW_HEIGHTS.DEFAULT);
  } catch (err) {
    log(`ℹ️ Could not reset row heights on "${sheet.getName()}" (${err}).`);
  }
}

/**
 * Gives a band of data rows the workbook's standard data height.
 *
 * ONE CALL FOR THE WHOLE BAND, which is the only reason this is affordable at
 * all: setRowHeight() per row is one API call per row, and the session table
 * runs to hundreds. setRowHeights() sets the run in one.
 *
 * Never fatal — a height is presentation, and a tab with tight rows is worth
 * strictly less than a tab that failed to render.
 */
function setDataRowHeights(sheet, startRow, numRows) {
  if (!startRow || numRows < 1) return;
  const last = Math.min(startRow + numRows - 1, sheet.getMaxRows());
  if (last < startRow) return;
  try {
    sheet.setRowHeights(startRow, last - startRow + 1, ROW_HEIGHTS.DATA);
  } catch (err) {
    log(`ℹ️ Could not set data row heights on "${sheet.getName()}" (${err}).`);
  }
}

function showAllRows(sheet) {
  try {
    sheet.showRows(1, sheet.getMaxRows());
  } catch (err) {
    log(`ℹ️ Could not un-hide rows on "${sheet.getName()}" (${err}).`);
  }
}

/**
 * Menu action: show everything on every date-sorted tab, until the next
 * render puts the old months away again. The counterpart to the automatic
 * collapse — someone doing a year-end count needs the whole thing on screen,
 * and should not have to go hunting through Format ▸ Hide to get it.
 */
function showAllPastRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = [
    SHEET_NAMES.REGISTRANT_DASH,
    SHEET_NAMES.PROGRAM_DASHBOARD,
    SHEET_NAMES.LUNCH_SCHEDULE,
    SHEET_NAMES.LUNCH_DASHBOARD,
    SHEET_NAMES.LUNCH_ROSTER,
    SHEET_NAMES.TRIAGE
  ];
  let done = 0;
  names.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    showAllRows(sheet);
    done++;
  });
  toastIfPossible(`All past rows shown on ${done} tab(s). They collapse again on the next sync.`);
  log(`showAllPastRows: un-hid rows on ${done} tab(s).`);
}

/**
 * READ-ONLY. Counts how much history each tab is carrying, by month, and says
 * what it costs — the measurement that has to come before any decision to
 * archive. Changes nothing.
 */
function reportArchivableMonths() {
  if (!requireAuthorizedAdmin('Archive Old Months (report)')) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cutoff = getVisibleMonthCutoffKey();
  const tabs = [
    { name: SHEET_NAMES.REGISTRANT_DASH, headers: HEADERS.All_Registrants, marker: 'Event_ID' },
    { name: SHEET_NAMES.PROGRAM_DASHBOARD, headers: HEADERS.All_Program_Sessions, marker: 'Event_ID' },
    { name: SHEET_NAMES.TRIAGE, headers: HEADERS.Deleted_Event_Triage, marker: 'Event_ID' },
    { name: SHEET_NAMES.LUNCH_SCHEDULE, headers: HEADERS.Lunch_Schedule, marker: 'Event_Date' }
  ];

  const lines = [];
  let grandTotal = 0;
  let grandOld = 0;
  let grandCells = 0;

  tabs.forEach(tab => {
    const sheet = ss.getSheetByName(tab.name);
    if (!sheet) return;
    const rows = tab.name === SHEET_NAMES.LUNCH_SCHEDULE
      ? readLunchScheduleRows(sheet)
      : readAllSectionedRows(sheet, tab.headers, tab.marker);
    const dateIdx = tab.headers.indexOf('Event_Date');

    const months = {};
    let old = 0;
    rows.forEach(row => {
      const d = coerceDate(row[dateIdx]);
      if (!d) return;
      const key = formatMonthKey(d);
      months[key] = (months[key] || 0) + 1;
      if (key < cutoff) old++;
    });

    const monthKeys = Object.keys(months).sort();
    const cells = rows.length * tab.headers.length;
    grandTotal += rows.length;
    grandOld += old;
    grandCells += cells;

    lines.push(`  • ${tab.name}: ${rows.length} row(s) across ${monthKeys.length} month(s)` +
      (monthKeys.length > 0 ? ` (${monthKeys[0]} → ${monthKeys[monthKeys.length - 1]})` : '') +
      `; ${old} older than ${cutoff}; ~${cells} cells.`);
  });

  const verdict = grandCells > ARCHIVE_ADVISORY_CELLS
    ? `⚠️ Over the ${ARCHIVE_ADVISORY_CELLS}-cell advisory line — worth archiving a year out. ` +
      `See "Old months" in USER_GUIDE.md.`
    : `✅ Comfortably inside normal size. Hiding old months is enough for now; nothing needs archiving.`;

  const report = `Old-month report (visible from ${cutoff} onward):\n${lines.join('\n')}\n` +
    `  TOTAL: ${grandTotal} row(s), ${grandOld} in collapsed months, ~${grandCells} cells.\n${verdict}`;

  log(report);
  presentReport_('Old Months', report,
    `${grandTotal} history row(s), ${grandOld} in collapsed months — see the log.`);
  return { totalRows: grandTotal, oldRows: grandOld, cells: grandCells };
}

/**
 * The point at which the history on these tabs is worth doing something about.
 * Nowhere near a Sheets hard limit — it's the point where a full re-render
 * starts eating a meaningful share of the 6-minute execution budget, which is
 * what actually breaks first.
 */
const ARCHIVE_ADVISORY_CELLS = 150000;

// ============================================================================
// THE TWO LINKS BETWEEN THE SECTIONS
// ============================================================================
//
// Every tab written through writeUpcomingPastSections() is two stacked tables
// with the Past one BELOW however many Upcoming rows there happen to be — a
// hundred on the session table in a busy month, a thousand on
// All_Registrants. The only way to the Past section was to scroll, and the
// only way back was to scroll further; Ctrl+End overshoots into the collapsed
// old months and Ctrl+Home lands above the frozen header on the tabs that
// have a Today block. So each banner now carries one in-sheet link: "⬇ Jump
// to Past" on the Upcoming banner, "⬆ Back to top" on the Past one.
//
// IT GOES IN A CELL A FEW COLUMNS ALONG, never in the banner's own cell and
// never merged. Column A holds the section's name — and on the Past banner,
// the hidden-row count collapseOldPastMonths() appends to it — which is the
// one thing on that row anybody reads. The banner row is otherwise BLANK on
// every tab in the workbook (writeSectionBanner() writes column 1 only, and
// sectionedTableValueBlock_() leaves the rest of the row empty), so a cell a
// few columns in is free whatever the tab, and nothing has to be checked
// per-tab. Column A is left to spill across the columns in between: the
// banner text overflows, which a non-empty cell to its right would clip, so
// the link sits far enough along that "🕓 Past · 247 hidden" still fits.
//
// WHITE, NOT LINK-BLUE. #1155CC is the colour a link wants, and on a
// #2C6BC4 banner it is nearly invisible — the one place in this workbook
// where the convention and the contrast disagree. So the link keeps the
// banner's own PAPER on blue (TYPO.BANNER.color) and says it is a link by
// being underlined, at TYPO.MUTED's size so it cannot be mistaken for the
// column headers in the row underneath.
// ============================================================================

/**
 * Which column the jump link goes in, or 0 for a table too narrow to carry
 * one without landing on the banner text itself.
 *
 * Five is far enough right that no banner label reaches it (the first four
 * columns of every sectioned tab include at least one wide text column —
 * Clean_Title, Event, Meal_Description) and near enough left to be on screen
 * without scrolling sideways. The narrowest sectioned tab in the workbook is
 * Lunch_Schedule's six columns, so the clamp is belt and braces rather than a
 * case that happens today.
 */
const SECTION_JUMP_LINK_COLUMN = 5;

/** The two labels. Overridable per tab — see writeUpcomingPastSections(). */
const SECTION_JUMP_TO_PAST_LABEL = '⬇ Jump to Past';
const SECTION_BACK_TO_TOP_LABEL = '⬆ Back to top';

function sectionJumpLinkColumn_(numCols) {
  if (!numCols || numCols < 2) return 0;
  return Math.min(SECTION_JUMP_LINK_COLUMN, numCols);
}

/**
 * `=HYPERLINK()` onto a row of THIS tab. `#gid=<id>&range=A<row>` is the
 * anchor Sheets itself puts in the address bar, and the gid is the only part
 * that cannot be guessed — the same tab name lives in forty spreadsheets here,
 * so it is asked of the sheet rather than assumed.
 *
 * Returns '' when the sheet will not say what its id is, because a link to
 * `#gid=null` is worse than no link.
 */
function sectionAnchorFormula_(sheet, targetRow, label) {
  let gid;
  try {
    gid = sheet.getSheetId();
  } catch (err) {
    gid = null;
  }
  if (gid === null || gid === undefined || !targetRow || targetRow < 1) return '';
  // A double quote in the label would end the string argument and leave a
  // formula error where the link should be. Every label today is one of this
  // file's own constants, which is exactly how such a thing goes unnoticed
  // until somebody passes a tab's own wording through options.
  const safe = String(label === undefined || label === null ? '' : label).replace(/"/g, '""');
  return `=HYPERLINK("#gid=${gid}&range=A${targetRow}", "${safe}")`;
}

/**
 * Writes one banner-row link cell — or CLEARS it, which is the case that
 * needs the care. A tab whose Past section has emptied since the last render
 * (every row of it deleted, or a triage tab worked through) would otherwise
 * keep offering a link to nothing: the early write (99u) blanks the cell on
 * the renderers that have one, but this is the shared writer and it states the
 * cell either way rather than relying on its callers' blocks.
 *
 * Never fatal. A link between two sections is a convenience; a render that
 * failed over one is not a trade worth making.
 */
function writeSectionJumpLink_(sheet, row, col, formula) {
  if (!col) return false;
  try {
    const cell = sheet.getRange(row, col).setValue(formula || '');
    if (!formula) return true;
    cell
      .setFontSize(TYPO.MUTED.size)
      .setFontWeight('normal')
      .setFontLine('underline')
      // The banner's label spills rightwards and this cell's own label has to
      // be allowed to do the same, or a narrow column clips "⬇ Jump to Past"
      // to "⬇ Jump".
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
    return true;
  } catch (err) {
    log(`ℹ️ Could not write the section link on "${safeSheetName_(sheet)}" row ${row} (${err}).`);
    return false;
  }
}

/**
 * Writes two stacked sub-tables ("Upcoming" then "Past") starting at
 * `startRow`, each with its own banner, header row, and zebra-striped/
 * month-tinted data rows. Returns the exact row numbers used, so callers
 * can layer per-zone validation/conditional-formatting/formulas on top.
 *
 * Each banner also carries the one in-sheet link to the other section —
 * `options.jumpToPastLabel` / `options.backToTopLabel` for a tab whose two
 * sections are not called Upcoming and Past (Master_Program_Dashboard splits
 * on status, not date). See SECTION_JUMP_LINK_COLUMN above.
 */
function writeUpcomingPastSections(sheet, startRow, headers, upcomingRows, pastRows, options) {
  // THE tab-rewrite choke point: every sectioned tab in the workbook is
  // written through here, renderFlatDateSheet() included. Anything this
  // execution read off this tab describes the rows that are about to be
  // replaced, so it goes now rather than after — an early return below would
  // otherwise leave a cache describing a half-written tab.
  invalidateSectionedRowsCache(sheet);
  options = options || {};
  const numCols = headers.length;
  const dateColIdx = headers.indexOf('Event_Date');
  let row = startRow;

  // Columns that must stay TEXT however time-like they read — stamped before
  // the values land, because that is the only moment it works. See
  // stampTextColumns().
  const textCols = (options.textColumns || [])
    .map(h => headers.indexOf(h) + 1)
    .filter(col => col > 0);

  const upcomingBannerRow = row;
  writeSectionBanner(sheet, row, numCols, options.upcomingLabel || '⏳ Upcoming');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const upcomingHeaderRow = row;
  row++;
  const upcomingDataStart = row;
  // The band every formatting pass below — and the tab's own afterWrite hook —
  // stages into when a render scope is open. See 97_render_batching.gs.
  declareRenderBand(sheet, upcomingDataStart, upcomingRows.length);
  stampTextColumns(sheet, textCols, upcomingDataStart, upcomingRows.length);
  if (upcomingRows.length > 0) sheet.getRange(upcomingDataStart, 1, upcomingRows.length, numCols).setValues(upcomingRows);
  setDataRowHeights(sheet, upcomingDataStart, upcomingRows.length);
  applyZebraStripingManualBounded(sheet, upcomingDataStart, upcomingRows.length, numCols);
  // The dates are the ones just written, not a read-back of them.
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, upcomingDataStart, upcomingRows.length,
    options.dateNumberFormat, upcomingRows.map(r => r[dateColIdx]));
  row += upcomingRows.length;
  row++; // spacer

  const pastBannerRow = row;
  writeSectionBanner(sheet, row, numCols, options.pastLabel || '🕓 Past');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const pastHeaderRow = row;
  row++;
  const pastDataStart = row;
  declareRenderBand(sheet, pastDataStart, pastRows.length);
  stampTextColumns(sheet, textCols, pastDataStart, pastRows.length);
  if (pastRows.length > 0) sheet.getRange(pastDataStart, 1, pastRows.length, numCols).setValues(pastRows);
  setDataRowHeights(sheet, pastDataStart, pastRows.length);
  applyZebraStripingManualBounded(sheet, pastDataStart, pastRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, pastDataStart, pastRows.length,
    options.dateNumberFormat, pastRows.map(r => r[dateColIdx]));
  row += pastRows.length;

  // Old months go away LAST, once the rows are written and formatted — hiding
  // them first would only mean formatting a hidden range, and the banner has
  // to be able to say how many went.
  // A tab whose rows were grouped by program (99zs) is no longer date-ordered
  // down the page, so "older than the cutoff" has stopped being a suffix and
  // the one-call scan below cannot find it. See collapseOldGroupedPastRows_().
  const hidden = options.collapseOldMonths === false
    ? 0
    : (options.groupedRows
        ? collapseOldGroupedPastRows_(sheet, pastDataStart, pastRows, dateColIdx)
        : collapseOldPastMonths(sheet, pastDataStart, pastRows, dateColIdx));
  if (hidden > 0) {
    // The COUNT in the banner, the explanation in the note. "247 hidden" is
    // the fact somebody scanning the tab needs; the sentence about them still
    // being searchable and how to bring them back is what they need once, on
    // the day they first wonder — and that is what a note is for.
    sheet.getRange(pastBannerRow, 1)
      .setValue(`${options.pastLabel || '🕓 Past'}  ·  ${hidden} hidden`)
      .setNote(`${hidden} row(s) dated before ${getVisibleMonthCutoffKey()} are hidden.\n\n` +
        `They are still on this tab and still found by Ctrl+F. ` +
        `"Show All Past Rows" on the ${APP_MENU_NAME} menu brings them back.`);
  }

  // THE TWO LINKS, LAST — after collapseOldPastMonths() has had its say on the
  // Past banner's own cell (column A; these are columns apart, but the order
  // keeps the row's final state in one place) and once pastBannerRow is known,
  // so both ends of the pair are written in the same pass.
  //
  // ONLY WHEN THERE IS SOMEWHERE TO GO. An empty Past section still gets its
  // banner — that is what tells somebody there is no history yet — but a link
  // down to it would be a link to nothing, and its "back" counterpart would be
  // stranded under it. So the pair is written together or cleared together.
  const jumpCol = sectionJumpLinkColumn_(numCols);
  if (pastRows.length > 0) {
    writeSectionJumpLink_(sheet, upcomingBannerRow, jumpCol,
      sectionAnchorFormula_(sheet, pastBannerRow,
        options.jumpToPastLabel || SECTION_JUMP_TO_PAST_LABEL));
    // "Back to top" means the top of THIS table, not row 1: on the tabs that
    // open with a Today or metrics block the table's own banner is what
    // somebody who came down here was looking at, and on the flat tabs the
    // two are the same row anyway.
    writeSectionJumpLink_(sheet, pastBannerRow, jumpCol,
      sectionAnchorFormula_(sheet, upcomingBannerRow,
        options.backToTopLabel || SECTION_BACK_TO_TOP_LABEL));
  } else {
    writeSectionJumpLink_(sheet, upcomingBannerRow, jumpCol, '');
    writeSectionJumpLink_(sheet, pastBannerRow, jumpCol, '');
  }

  return {
    nextRow: row + 1,
    upcomingBannerRow,
    upcomingHeaderRow, upcomingDataStart, upcomingCount: upcomingRows.length,
    pastBannerRow, pastHeaderRow, pastDataStart, pastCount: pastRows.length,
    hiddenPastRows: hidden,
    jumpLinkColumn: jumpCol,
    // Where the program headings landed, for the one range-list paint that
    // takes the band's stripe and validations back off them (99zs). Empty on
    // every tab that is not grouped.
    dividerRows: options.groupedRows
      ? registrantGroupDividerRowNumbers(upcomingDataStart, upcomingRows)
          .concat(registrantGroupDividerRowNumbers(pastDataStart, pastRows))
      : []
  };
}

/**
 * Stamps 1-based columns as PLAIN TEXT, before anything is written into them.
 *
 * "10:00 AM" in a cell Sheets is free to interpret stops being those words and
 * becomes a time value dated 30 Dec 1899 — the epoch it counts times from —
 * which is what put "12/30/1899" in the Event_Time column beside a correct
 * date. The format has to be on the cells FIRST: applying it afterwards
 * reformats a number that is already a number, and the words are gone by then.
 *
 * Cheap, and deliberately not conditional on there being rows: an empty band
 * formatted as text is what keeps the next single-cell write — Quick Mark
 * moving somebody to 11:30 — text as well.
 */
function stampTextColumns(sheet, cols, startRow, numRows) {
  if (!cols || cols.length === 0) return;
  const rows = Math.max(numRows, 1);
  cols.forEach(col => {
    try {
      if (stageRenderNumberFormat(sheet, startRow, col, rows, '@')) return;
      sheet.getRange(startRow, col, rows, 1).setNumberFormat('@');
    } catch (err) {
      log(`ℹ️ Could not stamp column ${col} on "${sheet.getName()}" as text (${err}).`);
    }
  });
}

/**
 * Fully rebuilds a "flat" (single logical table) sheet into Upcoming/Past
 * sub-tables, driven entirely by each row's Event_Date. Used for
 * All_Registrants, Deleted_Event_Triage, and Lunch_Schedule.
 */
function renderFlatDateSheet(sheet, headers, allRows, opts) {
  opts = opts || {};
  const phase = renderPhaseMarker_(sheet, opts);
  phase('start', allRows.length + ' row(s)');
  // THE LAST THING BEFORE THE WIPE. A tab whose caller declared a guard marker
  // (All_Registrants, and nothing else today) gets its incoming row count
  // compared against what it is currently holding, and a rewrite that would
  // remove most of the tab THROWS here rather than clearing. See
  // 99j_registrant_safety_net.gs for why this tab in particular. The order is
  // load-bearing twice over: before invalidateSectionedRowsCache(), so the
  // guard's count is the memoized read the render already paid for, and
  // before the early write below, so a refusal leaves the tab exactly as it was.
  if (opts.guardMarker) guardRegistrantRowLoss_(sheet, headers, opts.guardMarker, allRows);
  // Belt and braces: writeUpcomingPastSections() below drops this tab's cached
  // reads too, but the early write happens first and a throw in between would
  // otherwise leave the old rows cached against a rewritten tab.
  invalidateSectionedRowsCache(sheet);

  const todayKey = formatDateKey(new Date());
  const dateColIdx = headers.indexOf('Event_Date');
  let { upcoming, past } = partitionByDate(allRows, dateColIdx, todayKey);
  // GROUPING COMES AFTER THE GUARD AND AFTER THE PARTITION, deliberately. The
  // guard above counts registrations, and a heading row is not one; the
  // partition is what decides a row's section, and a heading belongs to the
  // section its block was put in rather than to a date. From here down the two
  // arrays carry heading rows, which is what makes the early write (99u), the
  // values write and the formatting all describe the same rows.
  if (opts.groupRows) {
    upcoming = opts.groupRows(upcoming, headers, false);
    past = opts.groupRows(past, headers, true);
    opts = Object.assign({}, opts, { groupedRows: true });
  }

  // WRITE BEFORE CLEARING. The new rows land in one call, where the render
  // below will put them, before anything is wiped — so a run killed mid-render
  // leaves this tab holding its rows rather than nothing. Validations go
  // first because a value landing under an old rule that rejects it throws.
  // See 99u_write_before_clear.gs.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  const tableStart = opts.startRow || 1;
  writeTabValuesBeforeRender_(sheet,
    [sectionedTableValueBlock_(tableStart, headers, upcoming, past, opts)],
    { noClearFallback: !!opts.guardMarker });
  phase('values written ahead of formatting');
  sheet.clearFormats();
  // Row visibility is a sheet-level property that survives clear(), exactly
  // like column visibility below — so last render's hidden old-month range
  // has to be released before this render decides its own.
  showAllRows(sheet);
  sheet.getBandings().forEach(b => b.remove());
  // Column visibility is a sheet-level property that survives clear(), so a
  // tab whose hidden-column list has changed needs it re-asserted, not
  // inherited. applyColumnVisibility() (called from the afterWrite hooks)
  // shows everything not currently on the list.

  // opts.startRow leaves room above the tables for a fixed block written by
  // the caller afterwards. Nothing uses it today — the Registrants tab's Quick
  // Mark panel did, and is now a dialog (section 6d) — but the parameter is
  // what keeps that an option rather than a rewrite.
  //
  // THE SCOPE COVERS THE afterWrite HOOK TOO, deliberately: the hook is where
  // most of a tab's formatting is decided (validations, checkbox columns, the
  // manual-entry wash), and staging the table's own passes while leaving the
  // hook to write a column at a time would have moved almost none of the cost.
  // See 97_render_batching.gs.
  const result = withRenderBatch(sheet, headers.length, () => {
    phase('writing sections');
    const written = writeUpcomingPastSections(sheet, opts.startRow || 1, headers, upcoming, past, opts);
    phase('sections written; running afterWrite');
    checkPredictedTableRow_(sheet, sectionedTableHeaderRow_(tableStart), written.upcomingHeaderRow);
    freezeRowsSafely(sheet, written.upcomingHeaderRow);
    if (opts.afterWrite) opts.afterWrite(sheet, headers, written);
    return written;
  });

  phase('render batch flushed');
  // AFTER the batch has flushed and after the afterWrite hook, because what
  // this undoes on a heading row is what those two just did to it.
  if (result && result.dividerRows && result.dividerRows.length) {
    formatRegistrantGroupDividers_(sheet, headers.length, result.dividerRows);
  }

  phase('autosizing columns');
  autosizeColumns(sheet, { force: !!opts.force, minCols: headers.length });
  phase('done');
  return result;
}

/**
 * Where a render of a GUARDED tab (All_Registrants) is, written down as it goes.
 *
 * An "Error code INTERNAL" is an abort of the execution: no catch, no finally,
 * no log line — so a render that dies leaves a tab half drawn and nothing to say
 * which step it was on. Each phase logs with the seconds elapsed and stores its
 * name in Document Properties; the marker is removed by 'done'. One still
 * standing when the next render begins is an execution that died on that phase,
 * and is logged then. Never throws, and does nothing for the unguarded tabs.
 */
function renderPhaseMarker_(sheet, opts) {
  if (!opts || !opts.guardMarker) return function () {};
  const name = sheet.getName();
  const key = 'RENDER_IN_FLIGHT_V1';
  const startedAt = Date.now();
  let props = null;
  try {
    props = PropertiesService.getDocumentProperties();
    const left = props.getProperty(key);
    if (left) log(`⚠️ A previous render of "${name}" did not finish — last recorded phase: ${left}.`);
  } catch (err) { props = null; }
  return function (label, detail) {
    const secs = Math.round((Date.now() - startedAt) / 100) / 10;
    log(`Render "${name}" +${secs}s: ${label}${detail ? ' — ' + detail : ''}`);
    if (!props) return;
    try {
      if (label === 'done') props.deleteProperty(key);
      else props.setProperty(key, `${label} (${new Date().toISOString()})`);
    } catch (err) { /* a marker that will not write must not fail a render */ }
  };
}


