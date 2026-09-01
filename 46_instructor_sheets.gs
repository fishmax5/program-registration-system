// ============================================================================
// 9b. INSTRUCTOR SIGN-UP SHEETS  (a live roster, shared out of the workbook)
// ============================================================================
//
// THE PROBLEM. An instructor wants to know who is coming to their class, and
// they want to know it now — not off a PDF printed on Monday. Sharing this
// workbook with them is not an answer: it holds every location's registrations,
// every phone number, the catering order and the tabs that break if you type in
// the wrong cell.
//
// So each program gets its OWN small spreadsheet in Drive, holding nothing but
// that program's roster, which the instructor is added to as an editor. It is
// refreshed by the hourly registration sync — the same pass that imports the
// form responses in the first place — so it costs NO NEW TRIGGER. That matters:
// Apps Script allows twenty installable triggers per account and this project
// already spends one per calendar, so a design that needed one per program
// would stop working somewhere around the twentieth class.
//
// WHY NOT IMPORTRANGE. A formula-driven mirror is live and needs no code at
// all, and that was the first plan. It cannot work here, because these sheets
// are not read-only: the instructor marks who they have CONTACTED, who has
// CONFIRMED, who is WAITLISTED, who has DROPPED. An IMPORTRANGE (or QUERY)
// result spills into the cells beneath it, so the moment a new registration
// lands the roster grows by a row and every hand-typed mark below the insertion
// point is now attached to the wrong person. Silently. There is no way to pin
// an editable column beside a spilling formula. So the rows are WRITTEN by this
// code instead, each carrying a hidden Row_Key, and the marks are matched back
// by that key rather than by position.
//
// WHICH WAY THE FIVE INSTRUCTOR COLUMNS FLOW. Both ways, resolved per cell
// against a snapshot:
//
//   Every push writes a hidden Pushed_Snapshot beside each row — the five
//   values exactly as they were sent out. Every pull compares the sheet's
//   current values against that snapshot, cell by cell. A cell that DIFFERS is
//   something the instructor typed since the last refresh, and it wins. A cell
//   that MATCHES was never touched, so whatever the workbook says now wins,
//   and a correction made on Registrant_Dash is not clobbered by a stale copy
//   sitting in a browser tab.
//
// That is a real three-way merge and it is why staff and instructor can work on
// the same roster at once. Without it the last writer would win by accident and
// the loser would never know.
//
// THE PRIVACY BOUNDARY is one program AT ONE LOCATION — the same grain as
// Program_Options, and the reason the key carries both. Somebody teaching Chair
// Yoga at Narberth has no business reading Ashbridge's roster, and a per-title
// sheet would hand it to them.
// ============================================================================

/** Drive folder the per-program sheets live in, so they don't litter My Drive. */
const INSTRUCTOR_SHEET_FOLDER_NAME = 'Instructor Sign-Up Sheets';

/** programKey -> { fileId, title, location, createdAt }. See getInstructorSheetRegistry(). */
const INSTRUCTOR_SHEET_REGISTRY_PROP_KEY = 'INSTRUCTOR_SHEET_REGISTRY_V1';

/** The one tab in an instructor's spreadsheet. Named, not indexed, so a stray extra tab can't be mistaken for it. */
const INSTRUCTOR_SHEET_TAB_NAME = 'Sign_Up_Sheet';

/**
 * The window a shared sheet covers. Backward as well as forward because an
 * instructor marking up last week's class is the normal case on a Monday, and
 * a roster that dropped a session the moment it started would be useless for
 * exactly the marking it exists to collect.
 */
const INSTRUCTOR_SHEET_BACK_DAYS = 14;
const INSTRUCTOR_SHEET_FORWARD_DAYS = 90;

/** Backstop on one sheet's size — the window already bounds this; a runaway roster shouldn't blow the write. */
const INSTRUCTOR_SHEET_MAX_ROWS = 3000;

/**
 * The shared sheet's own columns. A SUBSET of Registrant_Dash plus two hidden
 * machine columns — deliberately not the whole row: Lunch_Type, the meal
 * counts, Admin_Notes and the internal keys are staff business, and every
 * column left out here is one an instructor cannot see.
 */
const INSTRUCTOR_SHEET_HEADERS = [
  'Event_Date', 'Event_Time', 'Location', 'Name', 'Party_Size',
  'Phone', 'Email', 'Program_Status',
  'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Instructor_Notes',
  'Row_Key', 'Pushed_Snapshot'
];

/** Machine columns on the shared sheet. Hidden, never typed in — see writeInstructorSignUpTab(). */
const INSTRUCTOR_SHEET_HIDDEN_COLUMNS = ['Row_Key', 'Pushed_Snapshot'];

/** What the shared sheet shows but the instructor may not change — everything the sync owns. */
const INSTRUCTOR_SHEET_DERIVED_COLUMNS = [
  'Event_Date', 'Event_Time', 'Location', 'Name', 'Party_Size', 'Phone', 'Email', 'Program_Status'
];


// --- the registry -----------------------------------------------------------

let __instructorSheetRegistryCache = null;
let __instructorSheetRegistryDirty = false;

/**
 * Which programs have a shared sheet, and where it lives. Read once per
 * execution and written back by flushPersistentRegistries(), like every other
 * persistent registry in this project.
 */
function getInstructorSheetRegistry() {
  if (__instructorSheetRegistryCache) return __instructorSheetRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(INSTRUCTOR_SHEET_REGISTRY_PROP_KEY);
  __instructorSheetRegistryCache = raw ? JSON.parse(raw) : {};
  return __instructorSheetRegistryCache;
}

function saveInstructorSheetRegistryEntry(programKey, entry) {
  const registry = getInstructorSheetRegistry();
  registry[programKey] = entry;
  __instructorSheetRegistryDirty = true;
}

function removeInstructorSheetRegistryEntry(programKey) {
  const registry = getInstructorSheetRegistry();
  if (registry[programKey] === undefined) return;
  delete registry[programKey];
  __instructorSheetRegistryDirty = true;
}

/** Program identity: title AND location, which is the privacy boundary — see the section header. */
function instructorProgramKey(title, location) {
  return `${normalizeNameKey(title)}|${normalizeNameKey(location)}`;
}

/**
 * The identity of one roster line, and the thing that makes the merge safe
 * against re-ordering.
 *
 * Party_ID (the form response) is included because one submission can seat a
 * whole party under one name, and the name alone is included because a row
 * added by hand at the desk has no Party_ID at all. Normalized, so the key a
 * row is written under is the key it is read back under even if somebody
 * retypes the name with a double space.
 */
function instructorRowKey(eventId, partyId, name) {
  return `${String(eventId || '').trim()}|${String(partyId || '').trim()}|${normalizeNameKey(name)}`;
}

/** A checkbox cell, however Sheets hands it back (boolean from a tick, text from a paste). */
function normalizeInstructorFlag(value) {
  if (value === true) return true;
  return String(value === null || value === undefined ? '' : value).trim().toUpperCase() === 'TRUE';
}

/** A free-text instructor cell. */
function normalizeInstructorNote(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/** The five instructor values off a row, normalized — the unit both the snapshot and the merge work in. */
function readInstructorValues(row, map) {
  return INSTRUCTOR_OWNED_COLUMNS.map(name => {
    const raw = map[name] === undefined ? '' : row[map[name]];
    return INSTRUCTOR_FLAG_COLUMNS.indexOf(name) === -1
      ? normalizeInstructorNote(raw)
      : normalizeInstructorFlag(raw);
  });
}

/**
 * The five values as one hidden cell. JSON rather than a delimiter join
 * because Instructor_Notes is free text and any separator worth reading is
 * one somebody will eventually type into a note.
 */
function encodeInstructorSnapshot(values) {
  return JSON.stringify(values);
}

function decodeInstructorSnapshot(cell) {
  const raw = String(cell === null || cell === undefined ? '' : cell).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === INSTRUCTOR_OWNED_COLUMNS.length ? parsed : null;
  } catch (err) {
    return null; // an unreadable snapshot means "assume nothing" — see pullInstructorSheetEdits()
  }
}


// --- reading the instructors' edits back in ---------------------------------

/**
 * Folds every shared sheet's instructor columns back into `registrantRows`
 * IN PLACE, and reports how many cells actually moved.
 *
 * Called from syncRegistrationsInternal() BEFORE the Registrants tab is
 * rewritten, so an instructor's ticks survive the same pass that imports new
 * registrations rather than being overwritten by it.
 *
 * PER CELL, against Pushed_Snapshot: a cell the instructor changed wins, a
 * cell they never touched leaves the workbook's own value alone. A row with NO
 * readable snapshot (hand-pasted, or written by a version before this existed)
 * is treated as untouched — the safe direction, since claiming an edit that
 * never happened would overwrite real data with blanks.
 */
function pullInstructorSheetEdits(registrantRows) {
  const registry = getInstructorSheetRegistry();
  const programKeys = Object.keys(registry);
  if (programKeys.length === 0 || !registrantRows || registrantRows.length === 0) return 0;

  const sheetMap = getIndexMap(INSTRUCTOR_SHEET_HEADERS);
  const edits = {}; // rowKey -> { values: [...], changed: [bool...] }

  programKeys.forEach(programKey => {
    const entry = registry[programKey] || {};
    if (!entry.fileId) return;
    let rows;
    try {
      const file = SpreadsheetApp.openById(entry.fileId);
      const tab = file.getSheetByName(INSTRUCTOR_SHEET_TAB_NAME);
      if (!tab) {
        log(`ℹ️ Instructor sheet for "${entry.title}" has no "${INSTRUCTOR_SHEET_TAB_NAME}" tab — nothing to read back.`);
        return;
      }
      rows = readSimpleTable(tab, INSTRUCTOR_SHEET_HEADERS);
    } catch (err) {
      // Deleted, trashed, or unreachable. NOT unregistered automatically: a
      // permission blip would otherwise silently detach a live sheet and the
      // next push would build a second one. NOT re-thrown either — see the
      // push half.
      log(`⚠️ Could not read the instructor sheet for "${entry.title}" (${err}).`);
      noteForAdmin('Instructor sheets that could not be read',
        describeInstructorAccessFailure(entry, programKey, err));
      return;
    }

    rows.forEach(row => {
      const rowKey = String(row[sheetMap['Row_Key']] || '').trim();
      if (!rowKey) return;
      const snapshot = decodeInstructorSnapshot(row[sheetMap['Pushed_Snapshot']]);
      if (!snapshot) return;
      const current = readInstructorValues(row, sheetMap);
      const changed = current.map((value, i) => value !== snapshot[i]);
      if (changed.indexOf(true) === -1) return;
      // Two sheets claiming the same row key would mean the same session was
      // shared twice; last one read wins, which is as good an answer as any.
      edits[rowKey] = { values: current, changed };
    });
  });

  const editedKeys = Object.keys(edits);
  if (editedKeys.length === 0) return 0;

  const map = getIndexMap(HEADERS.Registrant_Dash);
  let applied = 0;
  registrantRows.forEach(row => {
    const rowKey = instructorRowKey(row[map['Event_ID']], row[map['Party_ID']], row[map['Name']]);
    const edit = edits[rowKey];
    if (!edit) return;
    INSTRUCTOR_OWNED_COLUMNS.forEach((name, i) => {
      if (!edit.changed[i] || map[name] === undefined) return;
      row[map[name]] = edit.values[i];
      applied++;
    });
  });

  if (applied > 0) log(`Instructor sheets: merged ${applied} instructor-edited cell(s) back into the Registrants tab.`);
  return applied;
}


/**
 * What to say when an instructor sheet cannot be opened — and, when the reason
 * is a permission, WHO has to do WHAT about it.
 *
 * "Sign_Up — Tai Chi (Narberth) — Exception: You do not have permission to
 * access the requested document" is a true sentence that leaves the reader
 * with no idea that the fix is thirty seconds of sharing, or that the account
 * needing access is the one running the triggers rather than the one reading
 * the email.
 */
function describeInstructorAccessFailure(entry, programKey, err) {
  const name = (entry && entry.title) ? `${entry.title}${entry.location ? ` (${entry.location})` : ''}` : programKey;
  const text = String((err && err.message) || err || '');
  const fileRef = (entry && entry.fileId) ? `\nThe file is: https://docs.google.com/spreadsheets/d/${entry.fileId}/edit` : '';
  if (/permission|access|not found|forbidden/i.test(text)) {
    const runningAs = getCurrentUserEmail() || 'the account running the sync';
    return `${name} — this workbook cannot open its shared sheet: ${text}\n\n` +
      `This run is signed in as ${runningAs}, and that account is not on the file. Nothing is lost — the ` +
      `sheet and everything on it are fine — but the instructor's ticks are not coming back into the ` +
      `workbook and the workbook's rows are not going out to them.\n\n` +
      `To fix it: open the file, press Share, and either add ${runningAs} as an editor or set "Anyone with ` +
      `the link" to Editor. Then run "Refresh Instructor Sheets Now" once. A sheet made from this menu now ` +
      `does both of those automatically.${fileRef}`;
  }
  return `${name} — ${text}${fileRef}`;
}


// --- writing the sheets back out --------------------------------------------

/**
 * Refreshes every registered instructor sheet from the settled picture.
 *
 * Only sheets ALREADY in the registry are touched. Creating one is a
 * deliberate menu action (createInstructorSignUpSheet()) — a sync that
 * conjured a spreadsheet per program would produce sixty files nobody asked
 * for and share none of them.
 */
function pushInstructorSignUpSheets(sessionRows, registrantRows) {
  const registry = getInstructorSheetRegistry();
  const programKeys = Object.keys(registry);
  if (programKeys.length === 0) return 0;

  const byProgram = buildInstructorRowsByProgram(sessionRows, registrantRows);
  let pushed = 0;
  programKeys.forEach(programKey => {
    const entry = registry[programKey] || {};
    if (!entry.fileId) return;
    try {
      const file = SpreadsheetApp.openById(entry.fileId);
      const tab = getOrCreateSheet(file, INSTRUCTOR_SHEET_TAB_NAME);
      writeInstructorSignUpTab(tab, entry, byProgram[programKey] || []);
      pushed++;
      // ONCE PER SHEET, EVER — not once per hour. Any sheet made before
      // ensureInstructorSheetAccess() existed was shared with its creator and
      // nobody else, which is what stopped this whole round trip working when
      // the syncs moved to another account. Repaired here because this is the
      // pass that proves we can still open it; the flag on the registry entry
      // is what keeps it from being three Drive calls every hour thereafter.
      if (!entry.accessOpened) {
        const access = ensureInstructorSheetAccess(file, `instructor sheet for "${entry.title}"`);
        if (access.openedUp || access.editors.length > 0) {
          saveInstructorSheetRegistryEntry(programKey, Object.assign({}, entry, { accessOpened: true }));
        }
      }
    } catch (err) {
      // NEVER RE-THROWN. The registration sync calls this at the very end, on
      // a settled picture, and an instructor's spreadsheet being unreachable
      // is not a reason to fail a run that has already imported every
      // registration correctly.
      log(`⚠️ Could not refresh the instructor sheet for "${entry.title}" (${err}).`);
      noteForAdmin('Instructor sheets that could not be refreshed',
        describeInstructorAccessFailure(entry, programKey, err));
    }
  });
  if (pushed > 0) log(`Instructor sheets: refreshed ${pushed} shared sheet(s).`);
  return pushed;
}

/**
 * { programKey: [instructor sheet row, ...] } for every program in the
 * registry's window, built ONCE from the rows the caller already has in hand
 * rather than re-reading either tab per program.
 *
 * A registrant row belongs to a program via its Event_ID, not its Event text:
 * the session table is what knows a session's title and location, and a
 * renamed program's older registrant rows still carry the old title.
 */
function buildInstructorRowsByProgram(sessionRows, registrantRows) {
  const sessionMap = getIndexMap(HEADERS.Master_Program_Dashboard);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - INSTRUCTOR_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + INSTRUCTOR_SHEET_FORWARD_DAYS * 86400000));

  const programByEventId = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessionMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessionMap['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    programByEventId[eventId] =
      instructorProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]);
  });

  const map = getIndexMap(HEADERS.Registrant_Dash);
  const sheetMap = getIndexMap(INSTRUCTOR_SHEET_HEADERS);
  const byProgram = {};

  (registrantRows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const programKey = programByEventId[eventId];
    if (!programKey) return;
    // Superseded rows are bookkeeping — a registration that a later submission
    // replaced. Showing them would list the same person twice with no way for
    // an instructor to tell which one is real.
    if (String(row[map['Program_Status']] || '').trim() === 'Superseded') return;

    const values = readInstructorValues(row, map);
    const out = new Array(INSTRUCTOR_SHEET_HEADERS.length).fill('');
    out[sheetMap['Event_Date']] = row[map['Event_Date']];
    out[sheetMap['Event_Time']] = eventTimeLabelOf(row[map['Event_Time']]);
    out[sheetMap['Location']] = row[map['Location']] || '';
    out[sheetMap['Name']] = row[map['Name']] || '';
    out[sheetMap['Party_Size']] = row[map['Party_Size']] || '';
    out[sheetMap['Phone']] = row[map['Phone']] || '';
    out[sheetMap['Email']] = row[map['Email']] || '';
    out[sheetMap['Program_Status']] = row[map['Program_Status']] || '';
    INSTRUCTOR_OWNED_COLUMNS.forEach((name, i) => { out[sheetMap[name]] = values[i]; });
    out[sheetMap['Row_Key']] =
      instructorRowKey(row[map['Event_ID']], row[map['Party_ID']], row[map['Name']]);
    // Written in the same breath as the values it describes — that identity is
    // what the next pull's per-cell comparison rests on.
    out[sheetMap['Pushed_Snapshot']] = encodeInstructorSnapshot(values);

    if (!byProgram[programKey]) byProgram[programKey] = [];
    byProgram[programKey].push(out);
  });

  // Date first, then name: the order an instructor reads a class list in.
  Object.keys(byProgram).forEach(programKey => {
    byProgram[programKey].sort((a, b) => {
      const da = coerceDate(a[sheetMap['Event_Date']]);
      const db = coerceDate(b[sheetMap['Event_Date']]);
      if (da && db && da.getTime() !== db.getTime()) return da - db;
      return normalizeNameKey(a[sheetMap['Name']]).localeCompare(normalizeNameKey(b[sheetMap['Name']]));
    });
    if (byProgram[programKey].length > INSTRUCTOR_SHEET_MAX_ROWS) {
      log(`⚠️ Instructor sheet for ${programKey} would hold ` +
        `${byProgram[programKey].length} rows — trimmed to ${INSTRUCTOR_SHEET_MAX_ROWS}.`);
      byProgram[programKey] = byProgram[programKey].slice(0, INSTRUCTOR_SHEET_MAX_ROWS);
    }
  });

  return byProgram;
}

/**
 * Draws one shared sheet: banner, header, rows, and the yellow "this is yours"
 * wash on exactly the five instructor columns.
 *
 * Laid out on the memory-tab rows (banner 1, header 2, data 3) so
 * readSimpleTable() can read it straight back on the next pull without a
 * second layout to keep in step.
 */
function writeInstructorSignUpTab(sheet, entry, rows) {
  const headers = INSTRUCTOR_SHEET_HEADERS;
  const numCols = headers.length;
  const map = getIndexMap(headers);

  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  const stamp = Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), "EEE d MMM 'at' h:mm a");
  // The program and where it runs. The refresh stamp and the "tick the
  // yellow columns" instruction are a note: this sheet goes to an instructor
  // who reads the top line to check they have opened the right one, and a
  // heading that is three facts joined by bullets is not a top line.
  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols,
    `👩‍🏫 ${entry.title || 'Program'} — ${entry.location || ''}`,
    { note: `Refreshed ${stamp}.\n\nTick the yellow columns; everything else fills in by itself.` });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);
  labelManualEntryColumns(sheet, MEMORY_TAB_HEADER_ROW, headers, INSTRUCTOR_OWNED_COLUMNS);

  if (rows.length > 0) {
    // Before the values, never after — a bare "10:00 AM" that Sheets is
    // allowed to read as a time stops being those words. See
    // stampTextColumns().
    stampTextColumns(sheet, [map['Event_Time'] + 1], MEMORY_TAB_DATA_ROW, rows.length);
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1, rows.length, numCols).setValues(rows);
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Event_Date'] + 1, rows.length, 1).setNumberFormat(DATE_DISPLAY_FORMAT);
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Party_Size'] + 1, rows.length, 1).setNumberFormat('0');
    applyZebraStripingManualBounded(sheet, MEMORY_TAB_DATA_ROW, rows.length, numCols);
    tintManualEntryColumns(sheet, MEMORY_TAB_DATA_ROW, rows.length, headers, INSTRUCTOR_OWNED_COLUMNS);
    // Real checkboxes, so a mark is one click and reads back as a boolean —
    // which is what the snapshot comparison in pullInstructorSheetEdits()
    // expects to be comparing.
    INSTRUCTOR_FLAG_COLUMNS.forEach(name => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[name] + 1, rows.length, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });
    // Warning-only, like everywhere else in this project: an instructor who
    // really must correct a misspelled name should be told it will be
    // overwritten, not stopped and left with no way to say so.
    protectDerivedColumns(sheet, headers, INSTRUCTOR_SHEET_DERIVED_COLUMNS,
      [{ start: MEMORY_TAB_DATA_ROW, count: rows.length }]);
  } else {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1)
      .setValue('Nobody has signed up yet — this fills in by itself as registrations come in.')
      .setFontStyle('italic')
      .setFontColor(TYPO.MUTED.color);
  }

  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  applyColumnVisibility(sheet, headers, INSTRUCTOR_SHEET_HIDDEN_COLUMNS);
  autosizeColumns(sheet, { minCols: numCols, force: true });
  // After the autosize, which would otherwise size the two hidden machine
  // columns back into view on some sheets.
  applyColumnVisibility(sheet, headers, INSTRUCTOR_SHEET_HIDDEN_COLUMNS);
  freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, numCols));
}


// --- creating and sharing one ------------------------------------------------

function getOrCreateInstructorSheetFolder() {
  const folders = DriveApp.getFoldersByName(INSTRUCTOR_SHEET_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(INSTRUCTOR_SHEET_FOLDER_NAME);
  log(`Created Drive folder "${INSTRUCTOR_SHEET_FOLDER_NAME}" for shared instructor rosters.`);
  return folder;
}

/**
 * OPENS THE SHEET UP so that everyone who has to touch it can.
 *
 * THE FAILURE THIS EXISTS FOR. An instructor sheet is created by whoever
 * clicked the menu item — a real person, signed in as themselves — and it is
 * then read and written every hour by whoever owns the triggers, which is
 * routinely a DIFFERENT account. Drive shares a new file with its creator and
 * nobody else, so the hourly sync opens it, is refused, and the sheet silently
 * stops round-tripping: the instructor's ticks never come back into the
 * workbook, and the workbook's rows never go out to the instructor. Both sides
 * carry on looking like they are working.
 *
 * Three things are done about it here, cheapest first:
 *
 *   THE ADMINS AND THE TRIGGER OWNER are added as editors by name, so the
 *     accounts that actually run this system can always open the file.
 *   ANYONE WITH THE LINK CAN EDIT. This is a roster of first names, times and
 *     ticks, handed to instructors who are not in the organization's directory
 *     and who should not have to have accounts at all — and the alternative,
 *     in practice, is a sheet nobody can open and a feature nobody uses. Low
 *     security here is a deliberate trade, not an oversight. Anybody who wants
 *     it narrowed can change the sharing on the file itself; nothing below
 *     forces it open again except the run that creates it.
 *   EVERY PART OF IT IS GUARDED separately and none of it can throw. A sheet
 *     that cannot be shared is still a sheet — with a link somebody can share
 *     by hand — and losing the roster over a Drive permission error is a far
 *     worse outcome than an unshared file.
 *
 * Returns { openedUp, editors, problems } for the caller to report; never
 * throws.
 */
function ensureInstructorSheetAccess(file, describe) {
  if (!file) return { openedUp: false, editors: [], problems: [] };
  return openUpFileToAnyoneWithLink(file.getId(), describe || 'instructor sheet');
}

/**
 * THE SHARING THIS SYSTEM NEEDS ON EVERY FILE IT OWNS AND LATER HAS TO READ
 * BACK: the accounts that run it as named editors, and anyone with the link
 * able to edit.
 *
 * WHY IT IS THE SAME ANSWER FOR A FORM AS FOR AN INSTRUCTOR SHEET. Both are
 * created by whoever clicked the menu item — a real person, signed in as
 * themselves — and both are read and written every hour by whoever owns the
 * triggers, which is routinely a DIFFERENT account. Drive gives a new file to
 * its creator and nobody else, so the hourly run opens it, is refused, and the
 * work silently stops: an instructor's ticks never come back, or a form's
 * registrations are never imported. Nothing in either case looks broken.
 *
 * LOW SECURITY HERE IS A DELIBERATE TRADE. A registration form is a public
 * sign-up page and an instructor sheet is a roster of first names and ticks;
 * the alternative, in practice, is a file nobody can open and a feature nobody
 * uses. Anybody who wants it narrowed can change the sharing on the file
 * itself — nothing re-opens it except a run that touches it again.
 *
 * NEVER THROWS. A file that cannot be shared is still a file, and losing a
 * form or a roster over a Drive permission error is far worse than an unshared
 * one. Returns { openedUp, editors, problems } for a caller that wants to say
 * what happened.
 */
function openUpFileToAnyoneWithLink(fileId, describe) {
  const outcome = { openedUp: false, editors: [], problems: [] };
  if (!fileId) return outcome;
  const label = describe || `file ${fileId}`;

  let driveFile = null;
  try {
    driveFile = DriveApp.getFileById(fileId);
  } catch (err) {
    // Almost always "you do not have permission" — i.e. we are already the
    // account that cannot reach it, and there is nothing to do from here. The
    // repair has to be run by an account that CAN, which is what the admin
    // menu item exists for (see openUpAllFormSharing()).
    outcome.problems.push(`could not be reached in Drive (${err})`);
    log(`ℹ️ Could not open the ${label} in Drive to check its sharing (${err}).`);
    return outcome;
  }

  // The people this system runs as. Named editors survive a link-sharing
  // setting later being tightened by hand, which is the point of doing both.
  const wanted = listAuthorizedAdminEmails()
    .concat([getTriggerOwner(), getCurrentUserEmail()])
    .map(e => String(e || '').trim().toLowerCase())
    .filter(e => e.indexOf('@') > 0);
  dedupePreservingOrder(wanted).forEach(email => {
    try {
      driveFile.addEditor(email);
      outcome.editors.push(email);
    } catch (err) {
      // Adding yourself, adding the owner, or a Workspace policy saying no.
      // None of those is worth a line in the admin digest.
      log(`ℹ️ Could not add ${email} as an editor of the ${label} (${err}).`);
    }
  });

  try {
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    outcome.openedUp = true;
  } catch (err) {
    outcome.problems.push(`link sharing could not be turned on (${err})`);
    log(`⚠️ Could not open the ${label} to anyone with the link (${err}).`);
  }
  return outcome;
}

/**
 * MENU ACTION: open every registration form (and the template behind them) to
 * anyone with the link, and add the accounts that run this system as editors.
 *
 * THE FAILURE IT REPAIRS. Forms are created by whoever pressed the menu item
 * and read every hour by whoever owns the triggers. When those are different
 * accounts — which is the normal state of this office — Drive refuses the
 * second one, and the symptom is not an error anybody sees: registrations for
 * that form simply stop arriving on the Registrants tab. Since the sync
 * guards each form separately (see syncRegistrationsInternal()), the rest of
 * the workbook carries on looking perfectly healthy.
 *
 * RUN IT AS THE ACCOUNT THAT OWNS THE FORMS — usually whoever set the system
 * up. An account that cannot reach a file cannot change its sharing either, so
 * running this from the account that is being refused reports the problem
 * rather than fixing it, and says so per form.
 *
 * New forms no longer need this: createRegistrationForm() and
 * createFormFromSpec() open a form up the moment they make it. This is for
 * every form that already exists.
 */
function openUpAllFormSharing() {
  if (!requireAuthorizedAdmin('Open Up Form Sharing')) return 0;
  if (!confirmConsequentialAction('Open up the registration forms?',
    'Every registration form this workbook knows about is set to "anyone with the link can edit", and ' +
    'the accounts that run this system are added as editors.\n\nThis is what lets an hourly sync run by ' +
    'one account import registrations from forms created by another. A registration form is a public ' +
    'sign-up page, so the link being open is not a change in who can see it.', true)) {
    return 0;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const map = getIndexMap(HEADERS.Master_Program_Dashboard);
  const rows = readAllSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const formIds = dedupePreservingOrder(rows.map(row => String(row[map['Form_ID']] || '').trim())
    .filter(Boolean));

  // The template too: every form is a copy of it, and a template the syncing
  // account cannot open is a workbook that can never build another form.
  let templateId = '';
  try {
    templateId = getOrCreateTemplateForm().getId();
  } catch (err) {
    log(`ℹ️ Could not reach the form template to open it up (${err}).`);
  }

  const targets = dedupePreservingOrder(formIds.concat(templateId ? [templateId] : []));
  let opened = 0;
  const refused = [];
  targets.forEach(formId => {
    const outcome = openUpFileToAnyoneWithLink(formId,
      formId === templateId ? 'the form template' : `registration form ${formId}`);
    if (outcome.openedUp) opened++;
    else refused.push(formId);
  });

  refused.forEach(formId => {
    noteForAdmin('Forms whose sharing could not be changed',
      `${describeFormLink(formId)} — this account cannot change its sharing, which almost always means ` +
      `it does not own the form. Sign in as the account that created it and run this again.`);
  });
  flushAdminDigest('Form sharing');

  const message = refused.length === 0
    ? `Form sharing opened ✅ — ${opened} form(s) can now be read by every account that runs this system.`
    : `Form sharing opened for ${opened} form(s) ⚠️ — ${refused.length} refused this account. ` +
      `Run it again signed in as whoever created those forms.`;
  toastIfPossible(message);
  log(`openUpAllFormSharing: ${message}`);
  return opened;
}

/**
 * The instructor addresses recorded for one program, off Program_Options'
 * Instructor_Email column. Several are allowed, comma- or semicolon-separated,
 * because a class with a lead and an assistant is ordinary.
 *
 * Returns [] when the column is blank — createInstructorSignUpSheet() then
 * makes the file and hands back a link to share by hand, rather than refusing
 * to build anything over a missing address.
 */
function getInstructorEmailsForProgram(title, location) {
  return buildInstructorEmailIndex()[instructorProgramKey(title, location)] || [];
}

/**
 * { programKey: [address, ...] } for every program that names one.
 *
 * ONE read of Program_Options for the whole execution, cached: the dialog asks
 * this per program, and a tab read apiece turned listing sixty programs into
 * sixty full-tab round trips — slow enough to be felt before the dropdown even
 * appeared.
 */
let __instructorEmailIndexCache = null;

function buildInstructorEmailIndex() {
  if (__instructorEmailIndexCache) return __instructorEmailIndexCache;
  const index = {};
  __instructorEmailIndexCache = index;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_OPTIONS);
  if (!sheet) return index;
  const headers = HEADERS.Program_Options;
  const map = getIndexMap(headers);
  let rows;
  try {
    rows = readSimpleTable(sheet, headers);
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_OPTIONS} for instructor addresses (${err}).`);
    return index;
  }

  rows.forEach(row => {
    const key = instructorProgramKey(row[map['Event']], row[map['Location']]);
    if (!index[key]) index[key] = [];
    // Comma, semicolon or whitespace: staff type addresses however they type
    // them, and rejecting a list over its separator would be a silent no-share.
    String(row[map['Instructor_Email']] || '')
      .split(/[,;\s]+/)
      .map(part => part.trim())
      .filter(part => part.indexOf('@') > 0)
      .forEach(email => { if (index[key].indexOf(email) === -1) index[key].push(email); });
  });
  return index;
}

/**
 * MENU ACTION (via the dialog): make a shared sheet for one program, fill it,
 * and add whoever Program_Options names as its instructor.
 *
 * Idempotent by program key — pressing it again for a program that already has
 * one refreshes that sheet and returns the SAME link rather than building a
 * second copy nobody would know to share.
 */
function createInstructorSignUpSheet(programValue) {
  const parts = String(programValue || '').split('|||');
  const title = String(parts[0] || '').trim();
  const location = String(parts[1] || '').trim();
  if (!title || !location) throw new Error('Pick a program first.');

  const programKey = instructorProgramKey(title, location);
  const registry = getInstructorSheetRegistry();
  const existing = registry[programKey];

  let file = null;
  if (existing && existing.fileId) {
    try {
      file = SpreadsheetApp.openById(existing.fileId);
    } catch (err) {
      // Registered but gone — trashed by hand, most likely. Build a fresh one
      // rather than failing the action the person actually asked for.
      log(`ℹ️ Registered instructor sheet for "${title}" could not be opened (${err}) — creating a new one.`);
      removeInstructorSheetRegistryEntry(programKey);
      file = null;
    }
  }

  const isNew = !file;
  if (isNew) {
    file = SpreadsheetApp.create(`Sign-Up Sheet — ${title} (${location})`);
    // Moved rather than copied: create() drops it in My Drive root, and a
    // folder of these is what keeps them findable a year from now.
    try {
      const driveFile = DriveApp.getFileById(file.getId());
      getOrCreateInstructorSheetFolder().addFile(driveFile);
      DriveApp.getRootFolder().removeFile(driveFile);
    } catch (err) {
      log(`ℹ️ Could not file the new instructor sheet into "${INSTRUCTOR_SHEET_FOLDER_NAME}" (${err}) — it is in My Drive.`);
    }
  }

  const entry = {
    fileId: file.getId(),
    title,
    location,
    createdAt: (existing && existing.createdAt) || new Date().toISOString()
  };
  saveInstructorSheetRegistryEntry(programKey, entry);
  flushPersistentRegistries(); // registered before the fill, so a timeout mid-write still leaves a findable sheet

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = readAllSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registrantRows = readAllSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.Registrant_Dash, 'Event_ID');
  const byProgram = buildInstructorRowsByProgram(sessionRows, registrantRows);

  const tab = getOrCreateSheet(file, INSTRUCTOR_SHEET_TAB_NAME);
  writeInstructorSignUpTab(tab, entry, byProgram[programKey] || []);
  // A brand-new spreadsheet arrives with an empty "Sheet1" beside ours.
  removeDefaultSheetIfIdle(file, INSTRUCTOR_SHEET_TAB_NAME);

  // BEFORE the named instructors, and on every run rather than only the first:
  // this is what keeps the file openable by the account that syncs it, and a
  // sheet created before this existed is repaired the next time somebody
  // presses the menu item. See ensureInstructorSheetAccess().
  const access = ensureInstructorSheetAccess(file, `instructor sheet for "${title}"`);

  const emails = getInstructorEmailsForProgram(title, location);
  const shared = [];
  emails.forEach(email => {
    try {
      file.addEditor(email);
      shared.push(email);
    } catch (err) {
      // NOT fatal, and not silent either. An address that bounces off Drive
      // (a typo, a personal address a Workspace policy will not share with) is
      // exactly the case where the link still works and somebody should be
      // told to send it by hand.
      log(`⚠️ Could not share the instructor sheet for "${title}" with ${email} (${err}).`);
      noteForAdmin('Instructor sheets that could not be shared',
        `"${title}" (${location}) could not be shared with ${email} — ${err}. The sheet exists and ` +
        `anyone with its link can open it, so sending them the link by hand works.`);
    }
  });

  log(`Instructor sheet ${isNew ? 'created' : 'refreshed'} for "${title}" (${location}) — ` +
    `${(byProgram[programKey] || []).length} row(s), shared with ${shared.length} address(es), ` +
    `link sharing ${access.openedUp ? 'on' : 'NOT on'}.`);

  return {
    url: file.getUrl(),
    title,
    location,
    isNew,
    rowCount: (byProgram[programKey] || []).length,
    shared,
    unshared: emails.filter(e => shared.indexOf(e) === -1),
    // Told to the dialog, because "anyone with this link can edit it" is
    // exactly what somebody about to paste that link into an email needs to
    // know, and so is the opposite.
    linkSharing: access.openedUp,
    accessProblems: access.problems
  };
}

/**
 * Drops the "Sheet1" a new spreadsheet is born with, once ours exists beside
 * it. Guarded: a sheet somebody has already typed into is left alone, and so
 * is the last remaining sheet in a file (Sheets refuses to delete it anyway).
 */
function removeDefaultSheetIfIdle(file, keepName) {
  file.getSheets().forEach(sheet => {
    if (sheet.getName() === keepName) return;
    if (!/^Sheet\d+$/.test(sheet.getName())) return;
    if (sheet.getLastRow() > 0 || sheet.getLastColumn() > 0) return;
    try { file.deleteSheet(sheet); } catch (err) { /* the only sheet, or in use */ }
  });
}


// --- the menu -----------------------------------------------------------------

/** MENU ENTRY: pick a program, get a shareable live roster. */
function showInstructorSheetDialog() {
  const options = listInstructorProgramOptions();
  if (options.length === 0) {
    toastIfPossible('No programs to share yet — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildInstructorSheetHtml(options))
    .setWidth(560)
    .setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Instructor Sign-Up Sheets');
}

/**
 * Every program (title x location) with a session in the window, marked with
 * whether it already has a shared sheet and whether Program_Options names an
 * instructor for it.
 *
 * Both facts are on the option itself so the dialog can say "already shared"
 * and "no instructor email on file" without a round trip per selection.
 */
function listInstructorProgramOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!dash) return [];

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - INSTRUCTOR_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + INSTRUCTOR_SHEET_FORWARD_DAYS * 86400000));

  const byKey = {};
  readAllSectionedRows(dash, headers, 'Event_ID').forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!title || !location || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    const key = instructorProgramKey(title, location);
    if (!byKey[key]) byKey[key] = { key, title, location, sessions: 0, nextDate: null };
    byKey[key].sessions++;
    if (!byKey[key].nextDate || date < byKey[key].nextDate) byKey[key].nextDate = date;
  });

  const registry = getInstructorSheetRegistry();
  return Object.keys(byKey)
    .map(k => byKey[k])
    .sort((a, b) => a.location.localeCompare(b.location) || a.title.localeCompare(b.title))
    .map(entry => {
      const existing = registry[entry.key];
      const emails = getInstructorEmailsForProgram(entry.title, entry.location);
      return {
        value: `${entry.title}|||${entry.location}`,
        title: entry.title,
        location: entry.location,
        label: `${entry.title}  •  ${entry.sessions} session(s), next ${formatDateLabel(entry.nextDate)}` +
          (existing ? '  •  already shared' : '') +
          (emails.length > 0 ? `  •  ${emails.join(', ')}` : '  •  no instructor email on file'),
        alreadyShared: !!existing,
        url: existing && existing.fileId ? `https://docs.google.com/spreadsheets/d/${existing.fileId}/edit` : '',
        emails
      };
    });
}

/**
 * MENU ENTRY: read every shared sheet's marks back in, then send the current
 * rosters out again — the same two halves the hourly sync does, for when
 * somebody does not want to wait an hour for them.
 */
function refreshInstructorSignUpSheetsNow() {
  const registry = getInstructorSheetRegistry();
  if (Object.keys(registry).length === 0) {
    toastIfPossible('No instructor sheets have been created yet — use "Share a Sign-Up Sheet…" first.');
    return;
  }
  // The same lock syncRegistrations() takes: this reads the whole Registrants
  // tab, changes rows in memory and writes it all back, which is exactly the
  // shape that loses data when two runs overlap.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try again in a moment.');
    return;
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sessionRows = readAllSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.Master_Program_Dashboard, 'Event_ID');
    const registrantRows = readAllSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.Registrant_Dash, 'Event_ID');

    // EACH HALF GUARDED SEPARATELY, and neither allowed to fail the action.
    // One unreachable sheet used to be able to take the whole refresh down
    // with it — including the sheets that were perfectly reachable, sitting
    // further down the same loop. Both halves already skip a sheet they cannot
    // open; this is the outer guard for everything else (a Drive outage, a
    // quota, a registry entry pointing at something that is no longer a
    // spreadsheet at all).
    let merged = 0;
    let pushed = 0;
    const failures = [];
    try {
      merged = pullInstructorSheetEdits(registrantRows);
      if (merged > 0) renderRegistrantsSheet(false, registrantRows);
    } catch (err) {
      log(`⚠️ Could not read the instructor sheets back in (${err}).`);
      failures.push(`the instructors' own edits could not be read back in (${err})`);
    }
    try {
      pushed = pushInstructorSignUpSheets(sessionRows, registrantRows);
    } catch (err) {
      log(`⚠️ Could not push the instructor sheets out (${err}).`);
      failures.push(`the rosters could not be sent out (${err})`);
    }

    flushAdminDigest('Instructor sheet refresh');
    const trouble = failures.length === 0 ? '' : ` ⚠️ ${failures.join('; ')}.`;
    toastIfPossible(`Instructor sheets refreshed ${failures.length === 0 ? '✅' : '⚠️'} — ` +
      `${pushed} sheet(s) out, ${merged} instructor edit(s) in.${trouble}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * Location first and then program, matching the sign-in sheet dialog — a flat
 * list of every program at every site reads as noise to somebody who runs one
 * building. The program list is filtered in the BROWSER from a JSON copy, so
 * changing location is instant rather than a round trip.
 */
function buildInstructorSheetHtml(options) {
  const locations = [];
  options.forEach(o => { if (locations.indexOf(o.location) === -1) locations.push(o.location); });
  locations.sort();

  const locationTags = locations
    .map(loc => `<option value="${escapeHtmlForDialog(loc)}">${escapeHtmlForDialog(loc)}</option>`)
    .join('\n');

  // `<` is escaped so a program name containing one can never close the
  // script element early.
  const payload = JSON.stringify(options).replace(/</g, '\\u003c');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
  select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; }
  label { display: block; margin: 12px 0 4px 0; font-weight: bold; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  a { color: #1155CC; }
</style>
<h3>Share a live sign-up sheet</h3>
<p class="hint">
  Makes a small spreadsheet in Drive holding just this program's roster at this location, and adds
  whoever <b>Program_Options</b> names in <b>Instructor_Email</b> as an editor. It refreshes itself on
  the hourly registration sync — no printing, no new trigger.
  The instructor ticks <b>Contacted</b>, <b>Confirmed</b>, <b>Waitlisted</b> and <b>Dropped</b> and
  types in <b>Instructor_Notes</b>; those come back into the Registrants tab on the same sync.
</p>
<label for="location">Location</label>
<select id="location" onchange="fillPrograms()">${locationTags}</select>
<label for="program">Program</label>
<select id="program"></select>
<button id="go" onclick="submit()">Create / refresh sheet</button>
<div id="status"></div>
<script>
  var OPTIONS = ${payload};

  function fillPrograms() {
    var loc = document.getElementById('location').value;
    var sel = document.getElementById('program');
    sel.innerHTML = '';
    var mine = OPTIONS.filter(function (o) { return o.location === loc; });
    mine.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    document.getElementById('go').disabled = mine.length === 0;
    if (mine.length === 0) say('Nothing scheduled at this location in the next few weeks.', 'err');
    else showExisting();
  }

  // A program that already has a sheet gets its link straight away, so
  // "where is that thing I made last month" is answered without pressing
  // anything and re-running the whole build.
  function showExisting() {
    var chosen = current();
    if (chosen && chosen.alreadyShared && chosen.url) {
      var el = document.getElementById('status');
      el.className = '';
      el.innerHTML = 'Already shared — <a href="' + chosen.url + '" target="_blank">open it</a>' +
        '. Pressing the button refreshes it now.';
    } else {
      say('', '');
    }
  }

  function current() {
    var value = document.getElementById('program').value;
    return OPTIONS.filter(function (o) { return o.value === value; })[0] || null;
  }

  function submit() {
    var chosen = current();
    if (!chosen) { say('Pick a program first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Building the sheet…', '');
    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('go').disabled = false;
        if (!res || !res.url) { say('Could not build the sheet.', 'err'); return; }
        var el = document.getElementById('status');
        el.className = 'ok';
        var shared = res.shared.length > 0
          ? 'Shared with ' + res.shared.join(', ') + '.'
          : 'No instructor address on file — copy the link and share it yourself, or fill in ' +
            'Instructor_Email on Program_Options and press this again.';
        var failed = res.unshared.length > 0
          ? '<br>Could not share with ' + res.unshared.join(', ') + '.'
          : '';
        // SAID OUT LOUD, both ways. Anyone with the link can edit this sheet —
        // which is what makes it work for instructors who have no account here
        // and what keeps the hourly sync able to read their ticks back — and
        // somebody about to paste that link into an email is entitled to know
        // it. When it could NOT be opened up, that is the more urgent half:
        // the sync will not be able to reach it either.
        var link = res.linkSharing
          ? '<br>Anyone with the link can open and edit it.'
          : '<br><b>Link sharing could not be turned on</b>, so only the people named above can open it — ' +
            'including the account that runs the hourly sync. Share it by hand if the ticks stop coming back.';
        el.innerHTML = (res.isNew ? 'Created' : 'Refreshed') + ' — ' + res.rowCount +
          ' row(s). ' + shared + failed + link +
          '<br><a href="' + res.url + '" target="_blank">Open the sheet</a>';
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .createInstructorSignUpSheet(chosen.value);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  document.getElementById('program').onchange = showExisting;
  fillPrograms();
</script>`;
}

