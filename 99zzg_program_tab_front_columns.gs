// =============================================================================
// 99zzg — THE FRONT OF THE TWO PROGRAM TABS (November 2026)
// =============================================================================
//
// What somebody opens Master_Program_Dashboard or All_Program_Sessions to find
// out is, nearly always, four things: WHERE, WHAT, HOW MANY are coming, and
// WHICH ROOM — and the roster to check names against. Those were spread across
// the row (the count eight columns in, the room near the end, the roster link
// fourteenth), so this puts them straight after the title:
//
//   Master_Program_Dashboard   Loc · Program · Next_Date · Next_Registered · Room · …
//   All_Program_Sessions       Event_Date · Loc · Clean_Title · Active_Count · Room · …
//
// LOC IS A LETTER, AND THE LOCATION COLUMN IS STILL THERE. `Location` is read
// BY NAME all over the project (Event_IDs, lunch policy, triage, the leader
// sheets, the Leader edit on 78's tab), so its values cannot become "A". The
// letter is a separate derived column (`locationShortLetter`), coloured by the
// same tints as before (LOCATION_COLOR_MAP), and `Location` moved to the
// hidden plumbing at the end of each tab.
//
// THE TITLE IS THE ROSTER LINK, as a RICH-TEXT link rather than a =HYPERLINK()
// formula: every reader of the session table reads Clean_Title's VALUE, and a
// formula there would be a formula string to any reader that keeps formulas
// (96's grid does). A rich-text link has the title as its value and nothing
// else. It is applied after the render's writes (`linkTitleCellsToRosters_`),
// so a render that dies before it costs the links, never the titles.
//
// THE SESSION TABLE'S ROOM IS THE DATE'S EFFECTIVE ROOM — Room_Override if
// somebody set one, else the program's usual room (`effectiveDefaultRoom_`,
// 99zw: its own Program_Settings room, else a keyword rule's). It carries the
// rooms dropdown; a pick writes Room_Override through `handleSessionRoomEdit_`
// (from 18's handleProgramDashboardEdit), and picking the usual room — or
// clearing the cell — takes the date back to it, which is the same rule
// Room_Management's dated rows follow (99zx).
//
// Behavior only; everything it reaches for it reads at CALL time.
// =============================================================================

/** The letter each building is shown as. A building not listed shows its own first letter. */
const LOCATION_SHORT_LETTERS = { Ashbridge: 'A', Narberth: 'N', Zoom: 'Z' };

/** How wide the Loc column is drawn — one letter, or "N+A" for a shared program. */
const LOC_COLUMN_WIDTH_PX = 44;

/** "Narberth" -> "N"; "Narberth + Ashbridge" -> "N+A"; blank -> blank. */
function locationShortLetter(location) {
  const text = String(location == null ? '' : location).trim();
  if (!text) return '';
  return text.split(' + ').map(part => {
    const name = part.trim();
    if (!name) return '';
    const known = Object.keys(LOCATION_SHORT_LETTERS)
      .filter(k => k.toLowerCase() === name.toLowerCase())[0];
    return known ? LOCATION_SHORT_LETTERS[known] : name.charAt(0).toUpperCase();
  }).filter(Boolean).join('+');
}

/** The tint rules for a Loc column: each letter in its building's colour. */
function buildShortLocationColorRules(ranges) {
  if (!ranges || ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(locationShortLetter(loc))
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/**
 * A program's usual room at one building, as `effectiveDefaultRoom_` resolves
 * it, off the memoized Program_Settings read. Never throws: no room is ''.
 */
function usualRoomForProgram_(title, location, settingsIndex) {
  try {
    if (!title) return '';
    const index = settingsIndex || readNotificationPolicyRows();
    const map = getIndexMap(HEADERS.Program_Settings);
    const row = index ? index[programSettingsKey(title, location)] : null;
    return effectiveDefaultRoom_(title, location, row ? row[map['Room_Or_Setup']] : '').text || '';
  } catch (err) {
    return '';
  }
}

/**
 * Fills the two derived front columns on session rows in place — `Loc` and the
 * effective `Room`. Settings that cannot be read cost the Room column for this
 * render, never the render.
 */
function stampSessionFrontColumns_(rows, map) {
  if (!rows || map['Loc'] === undefined) return;
  let index = null;
  try { index = readNotificationPolicyRows(); } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_SETTINGS} for the session table's Room column (${err}).`);
  }
  const memo = {};
  rows.forEach(row => {
    const location = String(row[map['Location']] || '').trim();
    row[map['Loc']] = locationShortLetter(location);
    if (map['Room'] === undefined) return;
    const override = map['Room_Override'] === undefined ? '' : String(row[map['Room_Override']] || '').trim();
    if (override) { row[map['Room']] = override; return; }
    if (isLunchOnlyEventId(row[map['Event_ID']])) { row[map['Room']] = ''; return; }
    const title = String(row[map['Clean_Title']] || '').trim();
    const key = `${title}|${location}`;
    if (memo[key] === undefined) memo[key] = index ? usualRoomForProgram_(title, location, index) : '';
    row[map['Room']] = memo[key];
  });
}

/**
 * Puts each title back as a rich-text link (to its program's rows on
 * All_Registrants since Nov 2026 — see 99zzl) — one call per run of
 * rows. `titles` and `urls` are parallel arrays; a row with no URL is written
 * as plain text. Never throws: a link that cannot be drawn leaves the title.
 */
function linkTitleCellsToRosters_(sheet, startRow, col, titles, urls, opts) {
  if (!titles || titles.length === 0 || !col) return;
  try {
    if (typeof SpreadsheetApp.newRichTextValue !== 'function') return;
    // Nothing to link — the values already say it. A relink (99zzl) writes
    // anyway, so a link that no longer leads anywhere is taken off.
    if (!urls.some(Boolean) && !(opts && opts.writePlain)) return;
    const values = titles.map((title, i) => {
      const text = String(title == null ? '' : title);
      const builder = SpreadsheetApp.newRichTextValue().setText(text);
      return [(urls[i] && text ? builder.setLinkUrl(urls[i]) : builder).build()];
    });
    sheet.getRange(startRow, col, values.length, 1).setRichTextValues(values);
  } catch (err) {
    log(`ℹ️ ${sheet.getName()}: could not link the titles to their rosters (${err}).`);
  }
}

/** Narrows the Loc column after the autosize has had its say. Never throws. */
function narrowLocColumn_(sheet, headers) {
  const at = headers.indexOf('Loc');
  if (at === -1) return;
  try { sheet.setColumnWidth(at + 1, LOC_COLUMN_WIDTH_PX); } catch (err) { /* column absent */ }
}

/**
 * A pick in the session table's Room column. Returns true when the edit was in
 * that column (and so is answered here), false otherwise.
 *
 * The cell is the EFFECTIVE room; what is stored is Room_Override. A pick that
 * equals the program's usual room, or a cleared cell, clears the override, and
 * the cell is written back to what the date now gets. Rows without an
 * Event_ID (banners, headers inside a fill) are left exactly as they were.
 * The columns are read off the tab's OWN header row (`headerRow`), not off
 * HEADERS: getLiveHeaderMap() falls back to HEADERS order on this tab, and a
 * tab still drawn in the old order would otherwise read a Type_Tag pick as a
 * room.
 */
function handleSessionRoomEdit_(e, sheet, headerRow) {
  const live = getHeaderMapAt(sheet, headerRow); // 1-based
  const headerMap = {};
  Object.keys(live).forEach(name => { headerMap[name] = live[name] - 1; });
  const roomCol = headerMap['Room'];
  if (roomCol === undefined) return false;
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  if (roomCol + 1 < firstCol || roomCol + 1 > lastCol) return false;
  const overrideCol = headerMap['Room_Override'];
  if (overrideCol === undefined || headerMap['Clean_Title'] === undefined ||
      headerMap['Location'] === undefined) {
    toastIfPossible('⚠️ The room was not saved — this tab has no Room_Override column yet. ' +
      'It will after the next sync redraws it.');
    return true;
  }
  const startRow = e.range.getRow();
  const n = e.range.getNumRows();
  const width = Math.max(roomCol, overrideCol, headerMap['Clean_Title'], headerMap['Location'],
    headerMap['Event_ID'] === undefined ? 0 : headerMap['Event_ID']) + 1;
  const block = sheet.getRange(startRow, 1, n, width).getValues();
  const rooms = readRoomsList();
  const overrides = [];
  const shown = [];
  let changed = 0;
  block.forEach(line => {
    const eventId = headerMap['Event_ID'] === undefined ? 'x' : String(line[headerMap['Event_ID']] || '').trim();
    if (!eventId || isLunchOnlyEventId(eventId)) {
      overrides.push([line[overrideCol]]);
      shown.push([line[roomCol]]);
      return;
    }
    const title = String(line[headerMap['Clean_Title']] || '').trim();
    const location = String(line[headerMap['Location']] || '').trim();
    const usual = usualRoomForProgram_(title, location);
    const typed = String(line[roomCol] == null ? '' : line[roomCol]).trim();
    const label = resolveRoomLabel_(typed, rooms) || typed;
    const own = !label || (usual && roomKey_(label) === roomKey_(usual)) ? '' : label;
    overrides.push([own]);
    shown.push([own || usual]);
    changed++;
  });
  if (changed === 0) return true;
  sheet.getRange(startRow, overrideCol + 1, n, 1).setValues(overrides);
  sheet.getRange(startRow, roomCol + 1, n, 1).setValues(shown);
  invalidateSectionedRowsCache(sheet);
  toastIfPossible(changed === 1
    ? (overrides.some(o => o[0]) ? 'Room set for this date only.' : "This date is back in the program's usual room.")
    : `Room saved for ${changed} date(s).`);
  return true;
}

/**
 * Session rows built in HEADERS order, re-laid in the order the TAB's own
 * header row has them, so an append lands in the right columns whatever order
 * the tab was last drawn in (26's writeEventRegistryRows). A column HEADERS has
 * and the tab does not is dropped (the next render writes it); a tab column
 * HEADERS does not name is left blank. With no header row found, the rows are
 * returned as they are.
 */
function projectSessionRowsOntoTab_(sheet, headers, rows) {
  try {
    const headerRows = findAllHeaderRows(sheet, 'Event_ID', 5000);
    if (headerRows.length === 0) return rows;
    const tabMap = getHeaderMapAt(sheet, headerRows[headerRows.length - 1]); // 1-based
    const names = Object.keys(tabMap);
    if (names.length === 0) return rows;
    const same = headers.every((h, i) => tabMap[h] === i + 1);
    if (same) return rows;
    const width = Math.max.apply(null, names.map(n => tabMap[n]));
    return rows.map(row => {
      const out = new Array(width).fill('');
      headers.forEach((h, i) => { if (tabMap[h]) out[tabMap[h] - 1] = row[i]; });
      return out;
    });
  } catch (err) {
    log(`ℹ️ Could not read the session table's header row (${err}) — new rows written in the standard order.`);
    return rows;
  }
}
