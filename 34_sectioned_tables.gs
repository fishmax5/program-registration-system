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
  const scanEnd = nextHeaderRow ? nextHeaderRow - 1 : sheet.getLastRow();
  if (scanEnd < headerRow + 1) return null;
  const values = sheet.getRange(headerRow + 1, dateCol1Based, scanEnd - headerRow, 1).getValues();
  let firstRow = -1, lastRow = -1;
  values.forEach((v, i) => {
    if (coerceDate(v[0])) {
      if (firstRow === -1) firstRow = headerRow + 1 + i;
      lastRow = headerRow + 1 + i;
    }
  });
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
  let lastRow = Math.max(sheet.getLastRow(), 0);
  if (endRow) lastRow = Math.min(endRow, lastRow);
  // A values read is only a read, so the row bound that keeps a runaway tab
  // from costing the door page a huge fetch is free to apply. The
  // formula-preserving read is a RENDER's read — the rows it returns are the
  // rows about to be written back — so truncating it would delete whatever
  // sat past the bound. It reads to the bottom for that reason.
  if (!preserveFormulas) lastRow = Math.min(lastRow, SECTIONED_HEADER_SCAN_ROWS);
  if (lastRow < 1) return [];

  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const values = range.getValues();
  // The formula string wherever a cell holds one, the value everywhere else —
  // getRowsPreservingFormulas(), done once for the whole grid.
  const formulas = preserveFormulas ? range.getFormulas() : null;
  const grid = formulas
    ? values.map((row, r) => row.map((val, c) => formulas[r][c] || val))
    : values;

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
    combined = combined.concat(dateColIdx >= 0 ? rows.filter(row => coerceDate(row[dateColIdx])) : rows);
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
  try {
    SpreadsheetApp.getUi().alert('Old Months', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    toastIfPossible(`${grandTotal} history row(s), ${grandOld} in collapsed months — see the log.`);
  }
  return { totalRows: grandTotal, oldRows: grandOld, cells: grandCells };
}

/**
 * The point at which the history on these tabs is worth doing something about.
 * Nowhere near a Sheets hard limit — it's the point where a full re-render
 * starts eating a meaningful share of the 6-minute execution budget, which is
 * what actually breaks first.
 */
const ARCHIVE_ADVISORY_CELLS = 150000;

/**
 * Writes two stacked sub-tables ("Upcoming" then "Past") starting at
 * `startRow`, each with its own banner, header row, and zebra-striped/
 * month-tinted data rows. Returns the exact row numbers used, so callers
 * can layer per-zone validation/conditional-formatting/formulas on top.
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

  writeSectionBanner(sheet, row, numCols, options.upcomingLabel || '⏳ Upcoming');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const upcomingHeaderRow = row;
  row++;
  const upcomingDataStart = row;
  stampTextColumns(sheet, textCols, upcomingDataStart, upcomingRows.length);
  if (upcomingRows.length > 0) sheet.getRange(upcomingDataStart, 1, upcomingRows.length, numCols).setValues(upcomingRows);
  setDataRowHeights(sheet, upcomingDataStart, upcomingRows.length);
  applyZebraStripingManualBounded(sheet, upcomingDataStart, upcomingRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, upcomingDataStart, upcomingRows.length, options.dateNumberFormat);
  row += upcomingRows.length;
  row++; // spacer

  const pastBannerRow = row;
  writeSectionBanner(sheet, row, numCols, options.pastLabel || '🕓 Past');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const pastHeaderRow = row;
  row++;
  const pastDataStart = row;
  stampTextColumns(sheet, textCols, pastDataStart, pastRows.length);
  if (pastRows.length > 0) sheet.getRange(pastDataStart, 1, pastRows.length, numCols).setValues(pastRows);
  setDataRowHeights(sheet, pastDataStart, pastRows.length);
  applyZebraStripingManualBounded(sheet, pastDataStart, pastRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, pastDataStart, pastRows.length, options.dateNumberFormat);
  row += pastRows.length;

  // Old months go away LAST, once the rows are written and formatted — hiding
  // them first would only mean formatting a hidden range, and the banner has
  // to be able to say how many went.
  const hidden = options.collapseOldMonths === false
    ? 0
    : collapseOldPastMonths(sheet, pastDataStart, pastRows, dateColIdx);
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

  return {
    nextRow: row + 1,
    upcomingHeaderRow, upcomingDataStart, upcomingCount: upcomingRows.length,
    pastBannerRow, pastHeaderRow, pastDataStart, pastCount: pastRows.length,
    hiddenPastRows: hidden
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
  // Belt and braces: writeUpcomingPastSections() below drops this tab's cached
  // reads too, but the clear() happens first and a throw in between would
  // otherwise leave the old rows cached against an emptied tab.
  invalidateSectionedRowsCache(sheet);
  sheet.clear();
  sheet.clearFormats();
  // Row visibility is a sheet-level property that survives clear(), exactly
  // like column visibility below — so last render's hidden old-month range
  // has to be released before this render decides its own.
  showAllRows(sheet);
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  // Column visibility is a sheet-level property that survives clear(), so a
  // tab whose hidden-column list has changed needs it re-asserted, not
  // inherited. applyColumnVisibility() (called from the afterWrite hooks)
  // shows everything not currently on the list.

  const todayKey = formatDateKey(new Date());
  const dateColIdx = headers.indexOf('Event_Date');
  const { upcoming, past } = partitionByDate(allRows, dateColIdx, todayKey);

  // opts.startRow leaves room above the tables for a fixed block written by
  // the caller afterwards. Nothing uses it today — the Registrants tab's Quick
  // Mark panel did, and is now a dialog (section 6d) — but the parameter is
  // what keeps that an option rather than a rewrite.
  const result = writeUpcomingPastSections(sheet, opts.startRow || 1, headers, upcoming, past, opts);
  freezeRowsSafely(sheet, result.upcomingHeaderRow);

  if (opts.afterWrite) opts.afterWrite(sheet, headers, result);

  autosizeColumns(sheet, { force: !!opts.force, minCols: headers.length });
  return result;
}


