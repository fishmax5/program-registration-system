// ============================================================================
// 9b. PROGRAM REGISTRANT SHEETS  (a live roster, shared out of the workbook)
// ============================================================================
//
// THE PROBLEM. Somebody wants to know who is coming to a class, and they want
// to know it now — not off a PDF printed on Monday. Sharing this workbook with
// them is not an answer: it holds every location's registrations, every phone
// number, the catering order and the tabs that break if you type in the wrong
// cell.
//
// THESE USED TO BE CALLED "PROGRAM LEADER SHEETS", and the name was wrong by
// the time it was written: the leader marks who confirmed, but the desk reads
// the same sheet to answer the phone, the office reads it to plan a room, and
// the person covering a class nobody planned to cover reads it because it is
// the only current list there is. A sheet named after ONE of its readers is a
// sheet the others hesitate to open. It is the REGISTRANTS' sheet — named for
// what is on it rather than for who was expected to look.
//
// The identifiers below still say "leader", deliberately and for the same
// reason LEADER_SHEET_REGISTRY_PROP_KEY still says "instructor": renaming a
// stored key or a tab name hands every live sheet to nobody. What changed is
// every word a person reads.
//
// So each program gets its OWN small spreadsheet in Drive, holding nothing but
// that program's roster, which the leader is added to as an editor.
//
// ONE SHEET PER PROGRAM, NOT PER SESSION. A weekly class is one sheet with a
// band per date (see below), so a link that was handed out in September is
// still the right link in March. A sheet per session would mean a new link
// every week, a folder nobody can find anything in, and marks stranded on
// last week's file. It is
// refreshed by the hourly registration sync — the same pass that imports the
// form responses in the first place — so it costs NO NEW TRIGGER. That matters:
// Apps Script allows twenty installable triggers per account and this project
// already spends one per calendar, so a design that needed one per program
// would stop working somewhere around the twentieth class.
//
// WHO GETS ONE. Every program does, a week before its next session — see
// ensureRegistrantSheetsForUpcomingPrograms(). It used to be only programs
// whose leader had ticked Notify_Roster_Changes, and that left the ordinary
// case (a class with no leader row at all) with no live roster unless somebody
// remembered the menu item on the morning it was needed. The sheet is cheap,
// it is built once for the life of the program, and a week is long enough to
// be useful before the day and short enough that a calendar full of next
// year's dates does not build a hundred spreadsheets tonight.
//
// WHO IT IS SHARED WITH is still Program_Leaders (section 9c), which is where a
// leader's name and their address live. A program with no leader row gets its
// sheet anyway — anyone with the link can open it — and nobody is emailed
// about it.
//
// WHY NOT IMPORTRANGE. A formula-driven mirror is live and needs no code at
// all, and that was the first plan. It cannot work here, because these sheets
// are not read-only: the leader marks who they have CONTACTED, who has
// CONFIRMED, who is WAITLISTED, who has DROPPED. An IMPORTRANGE (or QUERY)
// result spills into the cells beneath it, so the moment a new registration
// lands the roster grows by a row and every hand-typed mark below the insertion
// point is now attached to the wrong person. Silently. There is no way to pin
// an editable column beside a spilling formula. So the rows are WRITTEN by this
// code instead, each carrying a hidden Row_Key, and the marks are matched back
// by that key rather than by position.
//
// WHICH WAY THE FIVE LEADER COLUMNS FLOW. Both ways, resolved per cell
// against a snapshot:
//
//   Every push writes a hidden Pushed_Snapshot beside each row — the five
//   values exactly as they were sent out. Every pull compares the sheet's
//   current values against that snapshot, cell by cell. A cell that DIFFERS is
//   something the leader typed since the last refresh, and it wins. A cell
//   that MATCHES was never touched, so whatever the workbook says now wins,
//   and a correction made on All_Registrants is not clobbered by a stale copy
//   sitting in a browser tab.
//
// That is a real three-way merge and it is why staff and leader can work on
// the same roster at once. Without it the last writer would win by accident and
// the loser would never know.
//
// THE SHEET IS BANDED BY SESSION, not a flat list of rows. A class list is read
// one class at a time — "who is coming on Thursday" — and a leader with twelve
// dates on one sheet was reading a four-hundred-row block whose only marker for
// where Thursday started was the date repeating in column A. Each session now
// opens with its own band naming the date, the time and the headcount, and its
// registrants sit under it.
//
// THE BANDS ARE INVISIBLE TO THE MERGE, and that is load-bearing rather than
// incidental: a band row carries no Row_Key and no Pushed_Snapshot, and
// pullProgramLeaderSheetEdits() skips any row missing either. So the layout can
// grow another band, a subtotal or a spacer without the pull needing to learn
// about it, and — the failure that matters — a band row can never be mistaken
// for a registrant whose marks were all just cleared.
//
// THE PRIVACY BOUNDARY is one program AT ONE LOCATION — the same grain as
// Program_Settings and Program_Leaders, and the reason the key carries both.
// Somebody teaching Chair Yoga at Narberth has no business reading Ashbridge's
// roster, and a per-title sheet would hand it to them.
// ============================================================================

/**
 * Drive folder the per-program sheets live in, so they don't litter My Drive.
 *
 * These sheets have been filed under two earlier names — "Instructor Sign-Up
 * Sheets", then "Program Leader Sign-Up Sheets".
 * getOrCreateProgramLeaderSheetFolder() RENAMES whichever it finds rather than
 * creating a second beside it: a folder per historical name, each holding the
 * sheets made while that name was current, is a filing system nobody asked for
 * and the kind of thing only noticed a year later. The list is in
 * most-recent-first order, which is the order a workbook is likeliest to have
 * them in.
 */
const LEADER_SHEET_FOLDER_NAME = 'Program Registrant Sheets';
const LEGACY_LEADER_SHEET_FOLDER_NAMES =
  ['Program Leader Sign-Up Sheets', 'Instructor Sign-Up Sheets'];

/**
 * programKey -> { fileId, title, location, createdAt }. See
 * getProgramLeaderSheetRegistry().
 *
 * THE VALUE IS DELIBERATELY STILL SPELLED "INSTRUCTOR". Script Property keys
 * are versioned here because a changed stored SHAPE needs a new key — and this
 * shape did not change, only the words this project uses for it. Renaming the
 * key would hand every existing workbook an empty registry: every live shared
 * sheet would look unregistered, the next menu press would build a second file
 * beside each one, and the marks sitting in the first would stop coming back.
 * A stale-looking constant value is a much smaller cost than that.
 */
const LEADER_SHEET_REGISTRY_PROP_KEY = 'INSTRUCTOR_SHEET_REGISTRY_V1';

/**
 * The one tab in a leader's spreadsheet. Named, not indexed, so a stray extra
 * tab can't be mistaken for it — and unchanged by the rename for the same
 * reason the registry key is: getOrCreateSheet() would make a second, empty
 * tab beside every existing roster and the marks on the first would be orphaned.
 */
const LEADER_SHEET_TAB_NAME = 'Sign_Up_Sheet';

/**
 * The window a shared sheet covers. Backward as well as forward because a
 * leader marking up last week's class is the normal case on a Monday, and
 * a roster that dropped a session the moment it started would be useless for
 * exactly the marking it exists to collect.
 */
const LEADER_SHEET_BACK_DAYS = 14;
const LEADER_SHEET_FORWARD_DAYS = 90;

/** Backstop on one sheet's size — the window already bounds this; a runaway roster shouldn't blow the write. */
const LEADER_SHEET_MAX_ROWS = 3000;

/**
 * The shared sheet's own columns. A SUBSET of All_Registrants plus two hidden
 * machine columns — deliberately not the whole row: Lunch_Type, the meal
 * counts, Admin_Notes and the internal keys are staff business, and every
 * column left out here is one a program leader cannot see.
 */
const LEADER_SHEET_HEADERS = [
  'Event_Date', 'Event_Time', 'Location', 'Name', 'Party_Size',
  'Phone', 'Email', 'Program_Status',
  'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes',
  'Row_Key', 'Pushed_Snapshot'
];

/** Machine columns on the shared sheet. Hidden, never typed in — see writeProgramLeaderSheetTab(). */
const LEADER_SHEET_HIDDEN_COLUMNS = ['Row_Key', 'Pushed_Snapshot'];

/** What the shared sheet shows but the leader may not change — everything the sync owns. */
const LEADER_SHEET_DERIVED_COLUMNS = [
  'Event_Date', 'Event_Time', 'Location', 'Name', 'Party_Size', 'Phone', 'Email', 'Program_Status'
];

/**
 * The background a session band is drawn in, and the ink on it.
 *
 * The TINT layer rather than the banner blue (see PALETTE): a band here is
 * separating one class from the next INSIDE a table, not announcing a section
 * of the workbook, and a full-strength blue strip every eight rows turns a
 * roster into a barcode. Slate ink on a pale wash reads as structure and
 * leaves the yellow hand-entry columns as the only saturated thing on the page,
 * which is the one place a leader's eye should be pulled.
 */
defineLazyGlobal_('LEADER_SHEET_BAND_BG', () => PALETTE.LOC_BLUE);
defineLazyGlobal_('LEADER_SHEET_BAND_INK', () => PALETTE.INK_STRONG);

/**
 * WHAT A WAITLISTED LINE LOOKS LIKE, which until now was: exactly like every
 * other line, with one word in a column a leader had no reason to read.
 *
 * A roster is scanned, not read. The one question a leader asks of it standing
 * in a doorway is "how many chairs do I need", and a person who is waiting is
 * the one line on the page where the answer is no. So the whole row is washed
 * — the pale peach of the TINT layer, not a signal colour, because it is a
 * state of a row rather than an alarm about it and half a class on the
 * waitlist must not turn the sheet orange.
 *
 * The Program_Status CELL itself takes the saturated SIGNAL_ORANGE that
 * 'Waitlisted' wears everywhere else in this workbook (see STATUS_COLORS): one
 * loud cell says which word to read, the wash says which rows to skip, and a
 * leader who has seen the dashboard recognizes both.
 *
 * The five yellow hand-entry columns are re-tinted over this afterwards, on
 * purpose — "type here" outranks "this one is waiting" on a column the leader
 * is meant to tick.
 */
defineLazyGlobal_('LEADER_SHEET_WAITLIST_BG', () => PALETTE.LOC_PEACH);
defineLazyGlobal_('LEADER_SHEET_WAITLIST_INK', () => PALETTE.SIGNAL_ORANGE);


// --- the registry -----------------------------------------------------------

let __leaderSheetRegistryCache = null;
let __leaderSheetRegistryDirty = false;

/**
 * Which programs have a shared sheet, and where it lives. Read once per
 * execution and written back by flushPersistentRegistries(), like every other
 * persistent registry in this project.
 */
function getProgramLeaderSheetRegistry() {
  if (__leaderSheetRegistryCache) return __leaderSheetRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(LEADER_SHEET_REGISTRY_PROP_KEY);
  __leaderSheetRegistryCache = raw ? JSON.parse(raw) : {};
  return __leaderSheetRegistryCache;
}

function saveProgramLeaderSheetRegistryEntry(programKey, entry) {
  const registry = getProgramLeaderSheetRegistry();
  registry[programKey] = entry;
  __leaderSheetRegistryDirty = true;
}

function removeProgramLeaderSheetRegistryEntry(programKey) {
  const registry = getProgramLeaderSheetRegistry();
  if (registry[programKey] === undefined) return;
  delete registry[programKey];
  __leaderSheetRegistryDirty = true;
}

/** Program identity: title AND location, which is the privacy boundary — see the section header. */
function leaderProgramKey(title, location) {
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
function leaderRowKey(eventId, partyId, name) {
  return `${String(eventId || '').trim()}|${String(partyId || '').trim()}|${normalizeNameKey(name)}`;
}

/** A checkbox cell, however Sheets hands it back (boolean from a tick, text from a paste). */
function normalizeLeaderFlag(value) {
  if (value === true) return true;
  return String(value === null || value === undefined ? '' : value).trim().toUpperCase() === 'TRUE';
}

/** A free-text program leader cell. */
function normalizeLeaderNote(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/** The five program leader values off a row, normalized — the unit both the snapshot and the merge work in. */
function readLeaderValues(row, map) {
  return LEADER_OWNED_COLUMNS.map(name => {
    const raw = map[name] === undefined ? '' : row[map[name]];
    return LEADER_FLAG_COLUMNS.indexOf(name) === -1
      ? normalizeLeaderNote(raw)
      : normalizeLeaderFlag(raw);
  });
}

/**
 * Is this built roster line somebody who is WAITING rather than booked?
 *
 * Either half counts, and they are two different facts that a leader reads as
 * one: Program_Status is what the workbook decided (a full session, a closed
 * one, or a by-hand waitlisting that has already been applied), and the
 * Waitlisted tick is what the leader decided a moment ago on this very sheet.
 * Reading only the first would leave a leader's own tick uncoloured until the
 * next push — which is the hour in which they are actually looking at it.
 */
function isLeaderSheetWaitlistedRow(row, sheetMap) {
  if (String(row[sheetMap['Program_Status']] || '').trim() === 'Waitlisted') return true;
  return sheetMap['Waitlisted'] !== undefined && normalizeLeaderFlag(row[sheetMap['Waitlisted']]);
}

/**
 * The five values as one hidden cell. JSON rather than a delimiter join
 * because Leader_Notes is free text and any separator worth reading is
 * one somebody will eventually type into a note.
 */
function encodeLeaderSnapshot(values) {
  return JSON.stringify(values);
}

function decodeLeaderSnapshot(cell) {
  const raw = String(cell === null || cell === undefined ? '' : cell).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === LEADER_OWNED_COLUMNS.length ? parsed : null;
  } catch (err) {
    return null; // an unreadable snapshot means "assume nothing" — see pullProgramLeaderSheetEdits()
  }
}


// --- reading the program leaders' edits back in ---------------------------------

/**
 * Folds every shared sheet's program leader columns back into `registrantRows`
 * IN PLACE, and reports how many cells actually moved.
 *
 * Called from syncRegistrationsInternal() BEFORE the Registrants tab is
 * rewritten, so a program leader's ticks survive the same pass that imports new
 * registrations rather than being overwritten by it.
 *
 * PER CELL, against Pushed_Snapshot: a cell the program leader changed wins, a
 * cell they never touched leaves the workbook's own value alone. A row with NO
 * readable snapshot (hand-pasted, or written by a version before this existed)
 * is treated as untouched — the safe direction, since claiming an edit that
 * never happened would overwrite real data with blanks.
 */
function pullProgramLeaderSheetEdits(registrantRows) {
  const registry = getProgramLeaderSheetRegistry();
  const programKeys = Object.keys(registry);
  if (programKeys.length === 0 || !registrantRows || registrantRows.length === 0) return 0;

  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const edits = {}; // rowKey -> { values: [...], changed: [bool...] }

  programKeys.forEach(programKey => {
    const entry = registry[programKey] || {};
    if (!entry.fileId) return;
    let rows;
    try {
      // The push at the end of the same sync opens this file too — see
      // openSpreadsheetCached() for why that was two loads of one document.
      const file = openSpreadsheetCached(entry.fileId);
      const tab = file.getSheetByName(LEADER_SHEET_TAB_NAME);
      if (!tab) {
        log(`ℹ️ Program registrant sheet for "${entry.title}" has no "${LEADER_SHEET_TAB_NAME}" tab — nothing to read back.`);
        return;
      }
      rows = readSimpleTable(tab, LEADER_SHEET_HEADERS);
    } catch (err) {
      // Deleted, trashed, or unreachable. NOT unregistered automatically: a
      // permission blip would otherwise silently detach a live sheet and the
      // next push would build a second one. NOT re-thrown either — see the
      // push half.
      log(`⚠️ Could not read the program registrant sheet for "${entry.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be read',
        describeLeaderSheetAccessFailure(entry, programKey, err));
      return;
    }

    rows.forEach(row => {
      const rowKey = String(row[sheetMap['Row_Key']] || '').trim();
      if (!rowKey) return;
      const snapshot = decodeLeaderSnapshot(row[sheetMap['Pushed_Snapshot']]);
      if (!snapshot) return;
      const current = readLeaderValues(row, sheetMap);
      const changed = current.map((value, i) => value !== snapshot[i]);
      if (changed.indexOf(true) === -1) return;
      // Two sheets claiming the same row key would mean the same session was
      // shared twice; last one read wins, which is as good an answer as any.
      edits[rowKey] = { values: current, changed };
    });
  });

  const editedKeys = Object.keys(edits);
  if (editedKeys.length === 0) return 0;

  const map = getIndexMap(HEADERS.All_Registrants);
  let applied = 0;
  registrantRows.forEach(row => {
    const rowKey = leaderRowKey(row[map['Event_ID']], row[map['Party_ID']], row[map['Name']]);
    const edit = edits[rowKey];
    if (!edit) return;
    LEADER_OWNED_COLUMNS.forEach((name, i) => {
      if (!edit.changed[i] || map[name] === undefined) return;
      row[map[name]] = edit.values[i];
      applied++;
    });
  });

  if (applied > 0) log(`Program registrant sheets: merged ${applied} leader-edited cell(s) back into the Registrants tab.`);
  return applied;
}


/**
 * What to say when a program registrant sheet cannot be opened — and, when the reason
 * is a permission, WHO has to do WHAT about it.
 *
 * "Sign_Up — Tai Chi (Narberth) — Exception: You do not have permission to
 * access the requested document" is a true sentence that leaves the reader
 * with no idea that the fix is thirty seconds of sharing, or that the account
 * needing access is the one running the triggers rather than the one reading
 * the email.
 */
function describeLeaderSheetAccessFailure(entry, programKey, err) {
  const name = (entry && entry.title) ? `${entry.title}${entry.location ? ` (${entry.location})` : ''}` : programKey;
  const text = String((err && err.message) || err || '');
  const fileRef = (entry && entry.fileId) ? `\nThe file is: https://docs.google.com/spreadsheets/d/${entry.fileId}/edit` : '';
  if (/permission|access|not found|forbidden/i.test(text)) {
    const runningAs = getCurrentUserEmail() || 'the account running the sync';
    return `${name} — this workbook cannot open its shared sheet: ${text}\n\n` +
      `This run is signed in as ${runningAs}, and that account is not on the file. Nothing is lost — the ` +
      `sheet and everything on it are fine — but the leader's ticks are not coming back into the ` +
      `workbook and the workbook's rows are not going out to them.\n\n` +
      `To fix it: open the file, press Share, and either add ${runningAs} as an editor or set "Anyone with ` +
      `the link" to Editor. Then run "Refresh Program Registrant Sheets Now" once. A sheet made from this menu now ` +
      `does both of those automatically.${fileRef}`;
  }
  return `${name} — ${text}${fileRef}`;
}


// --- writing the sheets back out --------------------------------------------

/**
 * ONE tick column, across every session band of the sheet, as real checkboxes.
 *
 * THE BUG THIS IS. A RangeList is NOT a Range: it carries setBackground,
 * setNumberFormat, setHorizontalAlignment and the rest of the formatting, and
 * it does NOT carry setDataValidation. So the batched write that replaced the
 * per-run getRange() calls — one range list per column instead of one range
 * per column per band — threw
 *
 *     TypeError: ticks.setDataValidation is not a function
 *
 * on every registrant sheet, every hour. pushProgramLeaderSheets() catches per
 * SHEET, so what a leader saw was the roster abandoned half-written with the
 * four tick columns reading as the words TRUE and FALSE: the values had been
 * written and the validation that draws them as boxes had not.
 *
 * insertCheckboxes() is the call a RangeList DOES have, and it is the better
 * one anyway — it sets the validation AND normalizes the cells already holding
 * TRUE/FALSE, which is what repairs a sheet that has already been through the
 * failure. setDataValidation stays as the fallback for anything handed in that
 * has it instead.
 *
 * GUARDED, and never throws: a column that reads back as TRUE/FALSE still
 * round-trips (normalizeLeaderFlag() accepts both), so losing a whole roster
 * refresh over how a cell is DRAWN is the worse outcome by far. A column the
 * sheet's headers do not name arrives here as null and is skipped, rather than
 * becoming a NaN column index and its own unhelpful throw.
 */
function applyLeaderFlagCheckboxes_(name, ticks) {
  if (!ticks) return;
  try {
    if (typeof ticks.insertCheckboxes === 'function') ticks.insertCheckboxes();
    else if (typeof ticks.setDataValidation === 'function') {
      ticks.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    }
    ticks.setHorizontalAlignment('center');
  } catch (err) {
    log(`ℹ️ Could not draw the "${name}" column as checkboxes (${err}) — the ticks still work.`);
  }
}


/**
 * Refreshes every registered program registrant sheet from the settled picture.
 *
 * Only sheets ALREADY in the registry are touched. Creating one is a
 * deliberate menu action (createProgramLeaderSheet()) — a sync that
 * conjured a spreadsheet per program would produce sixty files nobody asked
 * for and share none of them.
 */
/**
 * Bumped when the SHAPE this file draws changes — a new column, a different
 * band, a reworded banner note. Without it, a change to the drawing would
 * reach only the sheets whose rosters happened to move afterwards.
 */
const LEADER_SHEET_TEMPLATE_KEY = 'leader-sheet-v1';

/**
 * WHAT THIS SHEET WOULD BE WRITTEN WITH, as one short string.
 *
 * Fingerprinted like the form date labels (10) and the appointment times (55),
 * and for the same reason: this pass runs hourly on every registered sheet
 * whether or not anything on it has moved, and rewriting one is the better part
 * of two hundred round trips against somebody else's spreadsheet. The rows ARE
 * the answer, so hashing them decides the question without writing anything.
 *
 * The heading is in it because the banner is drawn from the entry, so a program
 * renamed or moved is a sheet that has to be redrawn. The refresh STAMP is not:
 * it changes every hour by definition, and a fingerprint that never matches is
 * not a fingerprint.
 *
 * LIKE EVERY FINGERPRINT HERE, it tracks what this script WRITES. A sheet a
 * leader has mangled is not noticed until its rows legitimately change — the
 * escape hatch is the menu item, which passes { force: true }.
 */
function computeLeaderSheetFingerprint(entry, rows) {
  return computeFormLabelFingerprint(rows || [],
    [String((entry && entry.title) || ''), String((entry && entry.location) || '')],
    LEADER_SHEET_TEMPLATE_KEY);
}

function pushProgramLeaderSheets(sessionRows, registrantRows, options) {
  const force = !!(options && options.force);
  const registry = getProgramLeaderSheetRegistry();
  const programKeys = Object.keys(registry);
  if (programKeys.length === 0) return 0;

  const byProgram = buildLeaderSheetRowsByProgram(sessionRows, registrantRows);
  let pushed = 0;
  let unchanged = 0;
  programKeys.forEach(programKey => {
    const entry = registry[programKey] || {};
    if (!entry.fileId) return;
    try {
      const rows = byProgram[programKey] || [];
      const fingerprint = computeLeaderSheetFingerprint(entry, rows);
      // The file is opened either way: the pull at the head of this sync
      // already paid for it (openSpreadsheetCached), and the banner's "Refreshed
      // …" line has to stay true even on an hour when nothing moved.
      const file = openSpreadsheetCached(entry.fileId);
      const tab = getOrCreateSheet(file, LEADER_SHEET_TAB_NAME);
      if (!force && entry.pushedFingerprint === fingerprint && entry.accessOpened) {
        stampLeaderSheetRefreshed(tab);
        unchanged++;
        return;
      }
      writeProgramLeaderSheetTab(tab, entry, rows);
      if (entry.pushedFingerprint !== fingerprint) {
        saveProgramLeaderSheetRegistryEntry(programKey,
          Object.assign({}, entry, { pushedFingerprint: fingerprint }));
      }
      pushed++;
      // ONCE PER SHEET, EVER — not once per hour. Any sheet made before
      // ensureProgramLeaderSheetAccess() existed was shared with its creator and
      // nobody else, which is what stopped this whole round trip working when
      // the syncs moved to another account. Repaired here because this is the
      // pass that proves we can still open it; the flag on the registry entry
      // is what keeps it from being three Drive calls every hour thereafter.
      if (!entry.accessOpened) {
        const access = ensureProgramLeaderSheetAccess(file, `program registrant sheet for "${entry.title}"`);
        if (access.openedUp || access.editors.length > 0) {
          // Merged onto whatever the fingerprint write above left, not onto the
          // copy this loop started with — two Object.assign()s from the same
          // stale `entry` would each drop the other's field.
          saveProgramLeaderSheetRegistryEntry(programKey,
            Object.assign({}, getProgramLeaderSheetRegistry()[programKey] || entry, { accessOpened: true }));
        }
      }
    } catch (err) {
      // NEVER RE-THROWN. The registration sync calls this at the very end, on
      // a settled picture, and a program leader's spreadsheet being unreachable
      // is not a reason to fail a run that has already imported every
      // registration correctly.
      log(`⚠️ Could not refresh the program registrant sheet for "${entry.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be refreshed',
        describeLeaderSheetAccessFailure(entry, programKey, err));
    }
  });
  if (pushed > 0 || unchanged > 0) {
    log(`Program registrant sheets: rewrote ${pushed} shared sheet(s)` +
      (unchanged > 0 ? `, left ${unchanged} unchanged.` : '.'));
  }
  return pushed;
}

/**
 * The one cell a sheet nobody's roster moved still gets: the banner's note,
 * which says when this was last looked at.
 *
 * A leader opens the sheet to find out whether the list in front of them is
 * current, and "Refreshed three days ago" on a list that is right today is the
 * wrong answer to the only question they asked. One call, against the two
 * hundred a full redraw costs.
 */
function stampLeaderSheetRefreshed(sheet) {
  try {
    sheet.getRange(MEMORY_TAB_BANNER_ROW, 1).setNote(leaderSheetBannerNote());
  } catch (err) {
    log(`ℹ️ Could not restamp the refresh time on a program registrant sheet (${err}).`);
  }
}

/**
 * { programKey: [registrant sheet row, ...] } for every program in the
 * registry's window, built ONCE from the rows the caller already has in hand
 * rather than re-reading either tab per program.
 *
 * A registrant row belongs to a program via its Event_ID, not its Event text:
 * the session table is what knows a session's title and location, and a
 * renamed program's older registrant rows still carry the old title.
 */
function buildLeaderSheetRowsByProgram(sessionRows, registrantRows) {
  const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - LEADER_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + LEADER_SHEET_FORWARD_DAYS * 86400000));

  const programByEventId = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessionMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessionMap['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    programByEventId[eventId] =
      leaderProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]);
  });

  const map = getIndexMap(HEADERS.All_Registrants);
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const byProgram = {};

  (registrantRows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const programKey = programByEventId[eventId];
    if (!programKey) return;
    // Superseded rows are bookkeeping — a registration that a later submission
    // replaced. Showing them would list the same person twice with no way for
    // a program leader to tell which one is real.
    if (String(row[map['Program_Status']] || '').trim() === 'Superseded') return;

    const values = readLeaderValues(row, map);
    const out = new Array(LEADER_SHEET_HEADERS.length).fill('');
    out[sheetMap['Event_Date']] = row[map['Event_Date']];
    out[sheetMap['Event_Time']] = eventTimeLabelOf(row[map['Event_Time']]);
    out[sheetMap['Location']] = row[map['Location']] || '';
    out[sheetMap['Name']] = row[map['Name']] || '';
    out[sheetMap['Party_Size']] = row[map['Party_Size']] || '';
    out[sheetMap['Phone']] = row[map['Phone']] || '';
    out[sheetMap['Email']] = row[map['Email']] || '';
    out[sheetMap['Program_Status']] = row[map['Program_Status']] || '';
    LEADER_OWNED_COLUMNS.forEach((name, i) => { out[sheetMap[name]] = values[i]; });
    out[sheetMap['Row_Key']] =
      leaderRowKey(row[map['Event_ID']], row[map['Party_ID']], row[map['Name']]);
    // Written in the same breath as the values it describes — that identity is
    // what the next pull's per-cell comparison rests on.
    out[sheetMap['Pushed_Snapshot']] = encodeLeaderSnapshot(values);

    if (!byProgram[programKey]) byProgram[programKey] = [];
    byProgram[programKey].push(out);
  });

  // Date, then TIME, then name: the order a program leader reads a class list
  // in, and — since writeProgramLeaderSheetTab() bands the sheet by session —
  // the order that makes grouping a single scan rather than a second pass.
  // Time is in the key because a program CAN run twice in a day (a morning and
  // an afternoon sitting of the same class), and sorting on the date alone
  // would interleave the two into one band that belonged to neither.
  Object.keys(byProgram).forEach(programKey => {
    byProgram[programKey].sort((a, b) => {
      const da = coerceDate(a[sheetMap['Event_Date']]);
      const db = coerceDate(b[sheetMap['Event_Date']]);
      if (da && db && da.getTime() !== db.getTime()) return da - db;
      const ta = String(a[sheetMap['Event_Time']] || '');
      const tb = String(b[sheetMap['Event_Time']] || '');
      if (ta !== tb) return ta.localeCompare(tb);
      return normalizeNameKey(a[sheetMap['Name']]).localeCompare(normalizeNameKey(b[sheetMap['Name']]));
    });
    if (byProgram[programKey].length > LEADER_SHEET_MAX_ROWS) {
      log(`⚠️ Program registrant sheet for ${programKey} would hold ` +
        `${byProgram[programKey].length} rows — trimmed to ${LEADER_SHEET_MAX_ROWS}.`);
      byProgram[programKey] = byProgram[programKey].slice(0, LEADER_SHEET_MAX_ROWS);
    }
  });

  return byProgram;
}

/**
 * Groups a program's rows into the sessions they belong to, in the order they
 * are already sorted into.
 *
 * A "session" is one date at one time — see the sort in
 * buildLeaderSheetRowsByProgram() for why the time is part of that and not
 * just the date. Rows arrive grouped already, so this is a single scan rather
 * than a bucket-and-re-sort: the grouping cannot disagree with the order the
 * rows are written in, which is the drift that would put a band above the
 * wrong people.
 *
 * Each group carries the counts its band reports. They are counted HERE, off
 * Program_Status, rather than being read back off the sheet: the numbers a
 * band states have to be the system's own answer, because the four tick
 * columns beside them are the leader's answer and a band mixing the two would
 * be telling them their own marks back as though the workbook had decided them.
 */
function groupLeaderSheetRowsBySession(rows, sheetMap) {
  const groups = [];
  let current = null;

  (rows || []).forEach(row => {
    const date = coerceDate(row[sheetMap['Event_Date']]);
    const dateKey = date ? formatDateKey(date) : '';
    const timeLabel = String(row[sheetMap['Event_Time']] || '');
    const sessionKey = `${dateKey}|${timeLabel}`;

    if (!current || current.sessionKey !== sessionKey) {
      current = {
        sessionKey, date, timeLabel,
        rows: [], active: 0, waitlisted: 0, cancelled: 0
      };
      groups.push(current);
    }
    current.rows.push(row);

    const status = String(row[sheetMap['Program_Status']] || '').trim();
    if (status === 'Waitlisted') current.waitlisted++;
    else if (status === 'Cancelled') current.cancelled++;
    else current.active++; // Active, and anything a hand-added desk row left blank
  });

  return groups;
}

/**
 * What one session's band says: when it is, and how it stands.
 *
 * Only the counts that are NOT zero are named. "6 signed up · 0 waitlisted ·
 * 0 cancelled" on every band of a twelve-week class is three facts of which
 * two are noise, repeated twelve times, and the one number that matters stops
 * standing out. A waitlist that exists is worth a word; one that does not is
 * worth nothing.
 */
function leaderSheetSessionBandLabel(group) {
  const when = group.date ? formatDateLabel(group.date) : 'Date not set';
  const parts = [group.timeLabel ? `${when} · ${group.timeLabel}` : when];
  parts.push(`${group.active} signed up`);
  if (group.waitlisted > 0) parts.push(`${group.waitlisted} waitlisted`);
  if (group.cancelled > 0) parts.push(`${group.cancelled} cancelled`);
  return parts.join('  ·  ');
}

/**
 * Draws one shared sheet: banner, header, a band per session with its roster
 * under it, and the yellow "this is yours" wash on exactly the five leader
 * columns.
 *
 * Laid out on the memory-tab rows (banner 1, header 2, data 3) so
 * readSimpleTable() can read it straight back on the next pull without a
 * second layout to keep in step.
 *
 * THE BANDS COST THE PULL NOTHING. A band row is written with a label in
 * column A and every other cell blank — no Row_Key, no Pushed_Snapshot — and
 * pullProgramLeaderSheetEdits() skips any row without both. That is the whole
 * contract between the two halves, and it is why this function is free to
 * change the layout without the merge having to be told.
 *
 * ONE setValues AND ONE setBackgrounds for the whole block, bands included.
 * The obvious shape — write each session, then style it — is a handful of API
 * calls per session, and a leader with a year of weekly classes has fifty of
 * them. That was slow enough on a real roster to push the hourly sync toward
 * its execution limit, which is a strange way to lose a registration import.
 */
/**
 * The banner note, and everything a program leader is told by it.
 *
 * ITS OWN FUNCTION because it is now written from two places: the full redraw
 * below, and stampLeaderSheetRefreshed(), which is all a sheet gets on an hour
 * when nobody's roster moved. Both have to say the same thing, and the one
 * thing that differs between one hour and the next is the time at the top of
 * it — which is exactly why the stamp is not in the fingerprint.
 */
function leaderSheetBannerNote() {
  const stamp = Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), "EEE d MMM 'at' h:mm a");
  return `Refreshed ${stamp}.\n\nEach class has its own blue band. Tick the yellow columns; ` +
    `everything else fills in by itself.\n\n` +
    // SAID OUT LOUD, because it is the one tick with a consequence outside
    // this sheet. A leader who thinks Dropped is a private note will use it
    // to mean "chase this person"; a leader who is told what it does will
    // use it to free a seat, which is what it now actually does. See
    // applyLeaderDropsAsCancellations().
    `Ticking Dropped CANCELS that person's place — their seat and their lunch go back, ` +
    `and anything you type in Leader_Notes goes with it as the reason. Untick it before the ` +
    `next hour is up if you did not mean to; after that, ring the office.\n\n` +
    // THE SECOND TICK WITH A CONSEQUENCE, and the only one that can be
    // taken back — which is exactly why it has to be said in the same
    // breath as Dropped, or a leader will use the permanent one to mean
    // the reversible one. See applyLeaderWaitlistTicks().
    `Ticking Waitlisted moves that person off the class list and onto the waitlist — their seat ` +
    `and their lunch go back too, and the row turns peach so you can see at a glance who is ` +
    `waiting. Untick it to put them back on, which works whenever the class has room for them.`;
}

function writeProgramLeaderSheetTab(sheet, entry, rows) {
  const headers = LEADER_SHEET_HEADERS;
  const numCols = headers.length;
  const map = getIndexMap(headers);

  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  // The program and where it runs. The refresh stamp and the "tick the
  // yellow columns" instruction are a note: this sheet goes to a program leader
  // who reads the top line to check they have opened the right one, and a
  // heading that is three facts joined by bullets is not a top line.
  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols,
    `👩‍🏫 ${entry.title || 'Program'} — ${entry.location || ''}`,
    { note: leaderSheetBannerNote() });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);
  labelManualEntryColumns(sheet, MEMORY_TAB_HEADER_ROW, headers, LEADER_OWNED_COLUMNS);

  if (rows.length === 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1)
      .setValue('Nobody has signed up yet — this fills in by itself as registrations come in.')
      .setFontStyle('italic')
      .setFontColor(TYPO.MUTED.color);
    freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
    applyColumnVisibility(sheet, headers, LEADER_SHEET_HIDDEN_COLUMNS);
    autosizeColumns(sheet, { minCols: numCols, force: true });
    applyColumnVisibility(sheet, headers, LEADER_SHEET_HIDDEN_COLUMNS);
    freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, numCols));
    return;
  }

  // The grid to write, and — built in the same pass — where the bands landed
  // and which stretches of it are registrants. Everything after this works off
  // those three, so the layout is decided exactly once.
  const grid = [];
  const bandRowNumbers = [];
  const runs = [];
  groupLeaderSheetRowsBySession(rows, map).forEach(group => {
    const band = new Array(numCols).fill('');
    band[map['Event_Date']] = leaderSheetSessionBandLabel(group);
    bandRowNumbers.push(MEMORY_TAB_DATA_ROW + grid.length);
    grid.push(band);

    runs.push({ start: MEMORY_TAB_DATA_ROW + grid.length, count: group.rows.length });
    group.rows.forEach(row => grid.push(row));
  });

  // Before the values, never after — a bare "10:00 AM" that Sheets is
  // allowed to read as a time stops being those words. See stampTextColumns().
  stampTextColumns(sheet, [map['Event_Time'] + 1], MEMORY_TAB_DATA_ROW, grid.length);
  sheet.getRange(MEMORY_TAB_DATA_ROW, 1, grid.length, numCols).setValues(grid);

  // Zebra on the registrant rows, the band wash on the bands, in ONE write.
  // A band row is not part of the stripe sequence — striping straight through
  // them puts an arbitrary light/dark boundary on a row that is supposed to
  // BE the boundary.
  const bandRowSet = {};
  bandRowNumbers.forEach(r => { bandRowSet[r] = true; });
  const backgrounds = [];
  let stripe = 0;
  for (let i = 0; i < grid.length; i++) {
    const rowNumber = MEMORY_TAB_DATA_ROW + i;
    if (bandRowSet[rowNumber]) {
      backgrounds.push(new Array(numCols).fill(LEADER_SHEET_BAND_BG));
      stripe = 0; // each class starts its own stripe sequence, so week two looks like week one
    } else if (isLeaderSheetWaitlistedRow(grid[i], map)) {
      // The wash replaces the stripe rather than sitting under it — a row that
      // is half zebra and half peach reads as a rendering fault. It still
      // COUNTS as a stripe, so the rows either side of it keep alternating and
      // the band does not appear to skip a beat. See LEADER_SHEET_WAITLIST_BG.
      backgrounds.push(new Array(numCols).fill(LEADER_SHEET_WAITLIST_BG));
      stripe++;
    } else {
      backgrounds.push(new Array(numCols).fill(stripe % 2 === 0 ? PALETTE.PAPER : PALETTE.STRIPE));
      stripe++;
    }
  }
  sheet.getRange(MEMORY_TAB_DATA_ROW, 1, grid.length, numCols).setBackgrounds(backgrounds);

  // ============================================================================
  // EVERYTHING BELOW IS A RangeList, NOT A LOOP.
  //
  // This sheet is banded per SESSION, so a weekly class running a year is fifty
  // bands and fifty runs between them — and each of those used to cost four
  // calls for the band row and, per run, two number formats, a wash per
  // leader-owned column and two calls per tick box. Two hundred round trips
  // against SOMEBODY ELSE'S spreadsheet, hourly, per program.
  //
  // getRangeList() applies one setter to many ranges in a single call, which is
  // exactly the shape of every one of those loops: the same format, the same
  // rule, the same colour, on one column of every run. So the per-run loop is
  // gone and what is left is one call per ATTRIBUTE — a number that does not
  // grow with the number of sessions on the sheet.
  // ============================================================================
  const columnA1 = (column, list) => (list || runs)
    .map(run => sheet.getRange(run.start, column, run.count, 1).getA1Notation());
  const rangeListFor = (column, list) => {
    const a1 = columnA1(column, list);
    return a1.length > 0 ? sheet.getRangeList(a1) : null;
  };

  // The one loud cell on the row, written after the wash it sits on.
  const waitlistRows = [];
  for (let i = 0; i < grid.length; i++) {
    if (bandRowSet[MEMORY_TAB_DATA_ROW + i] || !isLeaderSheetWaitlistedRow(grid[i], map)) continue;
    waitlistRows.push({ start: MEMORY_TAB_DATA_ROW + i, count: 1 });
  }
  const waitlistInk = rangeListFor(map['Program_Status'] + 1, waitlistRows);
  if (waitlistInk) waitlistInk.setBackground(LEADER_SHEET_WAITLIST_INK).setFontWeight('bold');

  if (bandRowNumbers.length > 0) {
    const bandRows = bandRowNumbers.map(r => ({ start: r, count: 1 }));
    const wholeBand = sheet.getRangeList(bandRows.map(b =>
      sheet.getRange(b.start, 1, 1, numCols).getA1Notation()));
    wholeBand.setFontWeight('bold')
      .setFontColor(LEADER_SHEET_BAND_INK)
      .setVerticalAlignment('middle');
    // OVERFLOW, not wrap: the label is longer than the Event_Date column and
    // is meant to run across the blank cells beside it. Wrapping would fold it
    // into a three-line cell and push the band to triple height.
    const bandLabels = rangeListFor(1, bandRows);
    if (bandLabels) bandLabels.setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
    // Row heights are the one thing with no range-list form — a height belongs
    // to a row, not to a range — so the bands keep a call apiece.
    bandRowNumbers.forEach(rowNumber => {
      try { sheet.setRowHeight(rowNumber, ROW_HEIGHTS.BANNER); } catch (err) { /* row may not exist yet */ }
    });
  }

  if (runs.length > 0) {
    const dates = rangeListFor(map['Event_Date'] + 1);
    if (dates) dates.setNumberFormat(DATE_DISPLAY_FORMAT);
    const sizes = rangeListFor(map['Party_Size'] + 1);
    if (sizes) sizes.setNumberFormat('0');
    LEADER_OWNED_COLUMNS.forEach(name => {
      if (map[name] === undefined) return;
      const wash = rangeListFor(map[name] + 1);
      if (wash) wash.setBackground(MANUAL_ENTRY_CELL_TINT);
    });
    // Real checkboxes, so a mark is one click and reads back as a boolean —
    // which is what the snapshot comparison in pullProgramLeaderSheetEdits()
    // expects to be comparing. Never on a band row: a checkbox there is an
    // invitation to tick something that goes nowhere.
    LEADER_FLAG_COLUMNS.forEach(name => {
      if (map[name] === undefined) return;
      applyLeaderFlagCheckboxes_(name, rangeListFor(map[name] + 1));
    });
  }

  // Warning-only, like everywhere else in this project: a program leader who
  // really must correct a misspelled name should be told it will be
  // overwritten, not stopped and left with no way to say so.
  //
  // ONE ZONE covering the bands as well as the rows, rather than one per run.
  // protectDerivedColumns() creates a protection per column per zone, and a
  // year of weekly classes is fifty zones — four hundred protection objects on
  // a sheet holding one class list, built one API call at a time. The bands
  // being protected too costs nothing: their derived cells are blank and
  // nobody types in them.
  protectDerivedColumns(sheet, headers, LEADER_SHEET_DERIVED_COLUMNS,
    [{ start: MEMORY_TAB_DATA_ROW, count: grid.length }]);

  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  applyColumnVisibility(sheet, headers, LEADER_SHEET_HIDDEN_COLUMNS);
  autosizeColumns(sheet, { minCols: numCols, force: true });
  // After the autosize, which would otherwise size the two hidden machine
  // columns back into view on some sheets.
  applyColumnVisibility(sheet, headers, LEADER_SHEET_HIDDEN_COLUMNS);
  freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, numCols));
}


// --- creating and sharing one ------------------------------------------------

/**
 * The Drive folder these sheets are filed in — inside the folder the workbook
 * lives in, renaming the one they used to live in rather than creating a
 * second beside it. Both halves are getOrCreateSystemFolder()'s (`82`): the
 * legacy name is passed to it, and it renames and adopts what it finds.
 *
 * Every existing sheet is reached by fileId out of the registry, so nothing
 * would BREAK if this made a new folder — the old files would just sit in a
 * folder named after a word this project no longer uses, with new ones
 * arriving somewhere else, and the only person who ever noticed would be
 * whoever went looking for a sheet a year from now. Renaming costs one Drive
 * call on the first pass after the rename and none afterwards.
 */
function getOrCreateProgramLeaderSheetFolder() {
  return getOrCreateSystemFolder(LEADER_SHEET_FOLDER_NAME, LEGACY_LEADER_SHEET_FOLDER_NAMES);
}

/**
 * OPENS THE SHEET UP so that everyone who has to touch it can.
 *
 * THE FAILURE THIS EXISTS FOR. A program registrant sheet is created by whoever
 * clicked the menu item — a real person, signed in as themselves — and it is
 * then read and written every hour by whoever owns the triggers, which is
 * routinely a DIFFERENT account. Drive shares a new file with its creator and
 * nobody else, so the hourly sync opens it, is refused, and the sheet silently
 * stops round-tripping: the leader's ticks never come back into the
 * workbook, and the workbook's rows never go out to the program leader. Both sides
 * carry on looking like they are working.
 *
 * Three things are done about it here, cheapest first:
 *
 *   THE ADMINS AND THE TRIGGER OWNER are added as editors by name, so the
 *     accounts that actually run this system can always open the file.
 *   ANYONE WITH THE LINK CAN EDIT. This is a roster of first names, times and
 *     ticks, handed to program leaders who are not in the organization's directory
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
function ensureProgramLeaderSheetAccess(file, describe) {
  if (!file) return { openedUp: false, editors: [], problems: [] };
  return openUpFileToAnyoneWithLink(file.getId(), describe || 'program registrant sheet');
}

/**
 * Adds an editor WITHOUT Drive mailing them about it.
 *
 * THE FAILURE IT PREVENTS. DriveApp.addEditor() always sends a "X shared a
 * spreadsheet with you" notification, and this function runs on every sync
 * against every generated file. The office accounts that are named editors of
 * everything this workbook makes were getting one of those per file per run —
 * hundreds of mails saying nothing they did not already know.
 *
 * The Drive advanced service is the only way to say "share, but do not mail":
 * sendNotificationEmails is not exposed on DriveApp. If it is not enabled, or
 * the call fails for any reason other than the permission already existing, we
 * fall back to DriveApp so the SHARING still happens — a noisy share beats a
 * file the office cannot open.
 *
 * Returns true if the address ended up an editor, false if Drive refused.
 * Never throws.
 */
function addEditorWithoutNotifying_(driveFile, email) {
  const address = String(email || '').trim();
  if (!address) return false;
  try {
    if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.insert) {
      Drive.Permissions.insert(
        { role: 'writer', type: 'user', value: address },
        driveFile.getId(),
        { sendNotificationEmails: false, supportsAllDrives: true });
      return true;
    }
  } catch (err) {
    // Already an editor, the owner, or a Workspace policy saying no — all of
    // which DriveApp reports the same way. Fall through and let it try.
    log(`ℹ️ Drive would not add ${address} quietly (${err}) — falling back to DriveApp.`);
  }
  try {
    driveFile.addEditor(address);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * THE SHARING THIS SYSTEM NEEDS ON EVERY FILE IT OWNS AND LATER HAS TO READ
 * BACK: the accounts that run it as named editors, and anyone with the link
 * able to edit.
 *
 * WHY IT IS THE SAME ANSWER FOR A FORM AS FOR A PROGRAM REGISTRANT SHEET. Both are
 * created by whoever clicked the menu item — a real person, signed in as
 * themselves — and both are read and written every hour by whoever owns the
 * triggers, which is routinely a DIFFERENT account. Drive gives a new file to
 * its creator and nobody else, so the hourly run opens it, is refused, and the
 * work silently stops: a program leader's ticks never come back, or a form's
 * registrations are never imported. Nothing in either case looks broken.
 *
 * LOW SECURITY HERE IS A DELIBERATE TRADE. A registration form is a public
 * sign-up page and a program registrant sheet is a roster of first names and ticks;
 * the alternative, in practice, is a file nobody can open and a feature nobody
 * uses. Anybody who wants it narrowed can change the sharing on the file
 * itself — nothing re-opens it except a run that touches it again.
 *
 * NEVER THROWS. A file that cannot be shared is still a file, and losing a
 * form or a roster over a Drive permission error is far worse than an unshared
 * one. Returns { openedUp, editors, problems } for a caller that wants to say
 * what happened.
 */
function openUpFileToAnyoneWithLink(fileId, describe, opts) {
  const outcome = { openedUp: false, editors: [], problems: [] };
  if (!fileId) return outcome;
  const label = describe || `file ${fileId}`;
  // `folder: true` is the FOLDER case (`89`). Two things follow from it, and
  // both are load-bearing: a folder id has to be fetched with getFolderById()
  // — getFileById() throws outright on one, which would report every folder as
  // unreachable — and a folder gets the named editors and NO link sharing,
  // because a link-editable folder hands over everything inside it, now and in
  // future, which is a larger promise than any single file here makes.
  const isFolder = !!(opts && opts.folder);
  const wantsLinkSharing = isFolder
    ? !!(opts && opts.linkSharing === true)
    : (!opts || opts.linkSharing !== false);

  let driveFile = null;
  try {
    driveFile = isFolder ? DriveApp.getFolderById(fileId) : DriveApp.getFileById(fileId);
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
  // Every address on Config's Admin Notification Emails table joins the
  // accounts that run this system as a named editor, whatever it is ticked
  // for: the office asked to be on everything shared out of the workbook, this
  // is standing access to a file rather than mail, and a named editor survives
  // the link sharing below being tightened by hand later. An empty table means
  // nobody extra (see getAllAdminNotificationEmails).
  const wanted = listAuthorizedAdminEmails()
    .concat([getTriggerOwner(), getCurrentUserEmail()])
    .concat(getAllAdminNotificationEmails())
    .map(e => String(e || '').trim().toLowerCase())
    .filter(e => e.indexOf('@') > 0);
  // QUIETLY. These addresses are added again on every run, so a notification
  // per file per run is hundreds of mails telling the office nothing it does
  // not already know. See addEditorWithoutNotifying_().
  dedupePreservingOrder(wanted).forEach(email => {
    if (addEditorWithoutNotifying_(driveFile, email)) {
      outcome.editors.push(email);
    } else {
      // Adding yourself, adding the owner, or a Workspace policy saying no.
      // None of those is worth a line in the admin digest.
      log(`ℹ️ Could not add ${email} as an editor of the ${label}.`);
    }
  });

  if (!wantsLinkSharing) return outcome;

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
  const map = getIndexMap(HEADERS.All_Program_Sessions);
  const rows = getSectionedRows(registrySheet, HEADERS.All_Program_Sessions, 'Event_ID');
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
 * MENU ACTION (via the dialog): make a shared sheet for one program, fill it,
 * and add whoever Program_Leaders names as its leader.
 *
 * Idempotent by program key — pressing it again for a program that already has
 * one refreshes that sheet and returns the SAME link rather than building a
 * second copy nobody would know to share.
 */
function createProgramLeaderSheet(programValue) {
  const parts = String(programValue || '').split('|||');
  const title = String(parts[0] || '').trim();
  const location = String(parts[1] || '').trim();
  if (!title || !location) throw new Error('Pick a program first.');

  const programKey = leaderProgramKey(title, location);
  const registry = getProgramLeaderSheetRegistry();
  const existing = registry[programKey];

  let file = null;
  if (existing && existing.fileId) {
    try {
      file = SpreadsheetApp.openById(existing.fileId);
    } catch (err) {
      // Registered but gone — trashed by hand, most likely. Build a fresh one
      // rather than failing the action the person actually asked for.
      log(`ℹ️ Registered program registrant sheet for "${title}" could not be opened (${err}) — creating a new one.`);
      removeProgramLeaderSheetRegistryEntry(programKey);
      file = null;
    }
  }

  const isNew = !file;
  if (isNew) {
    file = SpreadsheetApp.create(registrantSheetFileName(title, location));
    // Moved rather than copied: create() drops it in My Drive root, and a
    // folder of these is what keeps them findable a year from now. Through
    // moveDriveFileInto() (`82`) rather than the addFile()/removeFile() pair
    // this used to do inline — that pair throws outright on a shared drive,
    // so on a Workspace setup EVERY new leader sheet stayed in My Drive.
    moveDriveFileInto(DriveApp.getFileById(file.getId()),
      getOrCreateProgramLeaderSheetFolder(),
      `the program leader sheet for "${title}"`);
  } else {
    // An existing file made under an older name. Renamed here — on the menu
    // press, once, rather than on the hourly push — so the folder does not end
    // up half "Sign-Up Sheet — …" and half "Registrant Sheet — …" forever. A
    // Drive that refuses is a cosmetic loss and never the reason this fails.
    const wanted = registrantSheetFileName(title, location);
    try {
      if (file.getName() !== wanted) file.rename(wanted);
    } catch (err) {
      log(`ℹ️ Could not rename the registrant sheet for "${title}" (${err}) — its contents are unaffected.`);
    }
  }

  const entry = {
    fileId: file.getId(),
    title,
    location,
    createdAt: (existing && existing.createdAt) || new Date().toISOString()
  };
  saveProgramLeaderSheetRegistryEntry(programKey, entry);
  flushPersistentRegistries(); // registered before the fill, so a timeout mid-write still leaves a findable sheet

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.All_Program_Sessions, 'Event_ID');
  const registrantRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID');
  const byProgram = buildLeaderSheetRowsByProgram(sessionRows, registrantRows);

  const tab = getOrCreateSheet(file, LEADER_SHEET_TAB_NAME);
  writeProgramLeaderSheetTab(tab, entry, byProgram[programKey] || []);
  // A brand-new spreadsheet arrives with an empty "Sheet1" beside ours.
  removeDefaultSheetIfIdle(file, LEADER_SHEET_TAB_NAME);

  // BEFORE the named program leaders, and on every run rather than only the first:
  // this is what keeps the file openable by the account that syncs it, and a
  // sheet created before this existed is repaired the next time somebody
  // presses the menu item. See ensureProgramLeaderSheetAccess().
  const access = ensureProgramLeaderSheetAccess(file, `program registrant sheet for "${title}"`);

  const emails = getProgramLeaderEmailsForProgram(title, location);
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
      log(`⚠️ Could not share the program registrant sheet for "${title}" with ${email} (${err}).`);
      noteForAdmin('Program registrant sheets that could not be shared',
        `"${title}" (${location}) could not be shared with ${email} — ${err}. The sheet exists and ` +
        `anyone with its link can open it, so sending them the link by hand works.`);
    }
  });

  log(`Program registrant sheet ${isNew ? 'created' : 'refreshed'} for "${title}" (${location}) — ` +
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

/**
 * Builds the shared sheet for every program whose leader has ticked
 * Notify_Roster_Changes but who does not have one yet.
 *
 * BEFORE THIS, the tick only turned on the email in section 9d — and that
 * email links to the sheet ("Your sign-up sheet: …") only when one already
 * exists, so a leader who ticked the box on a program nobody had shared yet
 * got a change list with nowhere to click. Somebody on staff still had to
 * notice and run "Program Registrant Sheets" by hand. The tick is the
 * only ask a leader gets to make here, so it is the one this reads.
 *
 * ONLY FOR PROGRAMS THIS WORKBOOK KNOWS (see knownProgramKeys()) — the same
 * guard refreshProgramLeadersTab() applies before trusting a row's Program
 * and Location. A typo'd pair would otherwise build an empty, useless
 * spreadsheet on every sync until somebody noticed and deleted it by hand.
 *
 * Reuses createProgramLeaderSheet() rather than a second way of building one:
 * that function is already idempotent by program key, already fills the
 * sheet from the settled picture, and already shares it with the program's
 * leaders — this only decides WHICH programs it should be called for.
 *
 * Called from syncRegistrationsInternal(), right before pushProgramLeaderSheets()
 * so a sheet created this run is refreshed and access-checked the same pass it
 * is born in rather than waiting an hour. Never throws: reaches outside the
 * workbook, on the same footing as the push and the alert pass either side of
 * it in that function.
 */
/** What one of these spreadsheets is called in Drive. Named for what is on it, not for who reads it. */
function registrantSheetFileName(title, location) {
  return `Registrant Sheet — ${title} (${location})`;
}

/**
 * How far ahead of a session its program's sheet is built.
 *
 * A week, and the number is a compromise between two failures. Too short and
 * the sheet appears the morning somebody needed it yesterday. Too long — or no
 * horizon at all — and a workbook whose calendar runs eighteen months out
 * builds a spreadsheet for every program it has ever run, tonight, in one
 * execution, against a Drive quota.
 */
const REGISTRANT_SHEET_LEAD_DAYS = 7;

/**
 * How many sheets one sync may create. The hourly pass comes back, so a
 * backlog drains over a few hours instead of one run spending its whole
 * execution budget in SpreadsheetApp.create() — which is the slowest call this
 * project makes — and timing out before it writes the registrations it
 * actually ran to import.
 */
const REGISTRANT_SHEET_MAX_CREATES_PER_RUN = 5;

/**
 * Builds a registrant sheet for every program with a session inside the next
 * REGISTRANT_SHEET_LEAD_DAYS days that does not already have one.
 *
 * Called from the hourly registration sync (27) BEFORE the push, so a sheet
 * created here is filled in on the same run rather than sitting empty for an
 * hour.
 *
 * NEVER THROWS AND NEVER REBUILDS. A program already in the registry is left
 * exactly alone — this decides only whether a sheet EXISTS, and the push
 * beside it decides what is in it. That is what makes a sheet handed out in
 * September still the same file, with the same link and the same marks, in
 * March.
 *
 * Returns how many were created.
 */
function ensureRegistrantSheetsForUpcomingPrograms(ss, sessionRows) {
  const map = getIndexMap(HEADERS.All_Program_Sessions);
  const registry = getProgramLeaderSheetRegistry();

  const today = new Date();
  const todayKey = formatDateKey(today);
  const horizonKey = formatDateKey(
    new Date(today.getTime() + REGISTRANT_SHEET_LEAD_DAYS * 86400000));

  // Soonest session first, so a run that hits the cap builds the sheets that
  // are needed first rather than whichever program sorts earliest by name.
  const wanted = {};
  (sessionRows || []).forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title || !location) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < todayKey || dateKey > horizonKey) return;
    const key = leaderProgramKey(title, location);
    if (registry[key] && registry[key].fileId) return; // already has one, for the life of the program
    if (!wanted[key] || dateKey < wanted[key].dateKey) {
      wanted[key] = { title, location, dateKey };
    }
  });

  const keys = Object.keys(wanted).sort((a, b) => wanted[a].dateKey.localeCompare(wanted[b].dateKey));
  let created = 0;
  keys.forEach(key => {
    if (created >= REGISTRANT_SHEET_MAX_CREATES_PER_RUN) return; // the next sync picks the rest up
    const program = wanted[key];
    try {
      createProgramLeaderSheet(`${program.title}|||${program.location}`);
      created++;
      log(`Registrant sheet auto-created for "${program.title}" (${program.location}) — ` +
        `its next session is ${program.dateKey}.`);
    } catch (err) {
      log(`⚠️ Could not auto-create the registrant sheet for "${program.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be auto-created',
        `"${program.title}" (${program.location}) — its next session is ${program.dateKey}, so this ` +
        `workbook tried to build a shared roster for it automatically and could not (${err}). Use ` +
        `"Program Registrant Sheets" on the Admin menu to build it by hand.`);
    }
  });

  if (created > 0 && keys.length > created) {
    log(`${keys.length - created} more registrant sheet(s) are due — the next sync builds them.`);
  }
  return created;
}

function ensureProgramLeaderSheetsForNotifyingLeaders(ss, sessionRows) {
  const leaders = getProgramLeadersWantingAlerts();
  if (leaders.length === 0) return 0;

  const registry = getProgramLeaderSheetRegistry();
  const known = knownProgramKeys(ss, sessionRows);

  const missing = {};
  leaders.forEach(leader => leader.programs.forEach(program => {
    if (registry[program.key] && registry[program.key].fileId) return; // already has one
    if (!known[program.key]) return; // not a program this workbook recognizes
    missing[program.key] = program;
  }));

  const keys = Object.keys(missing);
  let created = 0;
  keys.forEach(key => {
    const program = missing[key];
    try {
      createProgramLeaderSheet(`${program.title}|||${program.location}`);
      created++;
      log(`Registrant sheet auto-created (leader notify) for "${program.title}" (${program.location}) — ` +
        `its leader asked to be notified of roster changes.`);
    } catch (err) {
      log(`⚠️ Could not auto-create the program registrant sheet for "${program.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be auto-created',
        `"${program.title}" (${program.location}) — its leader ticked Notify_Roster_Changes, so this ` +
        `workbook tried to build a shared sheet for it automatically and could not (${err}). Use ` +
        `"Program Registrant Sheets" on the Admin menu to build it by hand.`);
    }
  });

  return created;
}


// --- the menu -----------------------------------------------------------------

/** MENU ENTRY: pick a program, get a shareable live roster. */
function showProgramLeaderSheetDialog() {
  const options = listProgramLeaderProgramOptions();
  if (options.length === 0) {
    toastIfPossible('No programs to share yet — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildProgramLeaderSheetHtml(options))
    .setWidth(560)
    .setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Program Registrant Sheets');
}

/**
 * Every program (title x location) with a session in the window, marked with
 * whether it already has a shared sheet and whether Program_Leaders names a
 * leader for it.
 *
 * Both facts are on the option itself so the dialog can say "already shared"
 * and "no leader on file" without a round trip per selection.
 */
function listProgramLeaderProgramOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!dash) return [];

  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - LEADER_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + LEADER_SHEET_FORWARD_DAYS * 86400000));

  const byKey = {};
  getSectionedRows(dash, headers, 'Event_ID').forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!title || !location || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    const key = leaderProgramKey(title, location);
    if (!byKey[key]) byKey[key] = { key, title, location, sessions: 0, nextDate: null };
    byKey[key].sessions++;
    if (!byKey[key].nextDate || date < byKey[key].nextDate) byKey[key].nextDate = date;
  });

  const registry = getProgramLeaderSheetRegistry();
  return Object.keys(byKey)
    .map(k => byKey[k])
    .sort((a, b) => a.location.localeCompare(b.location) || a.title.localeCompare(b.title))
    .map(entry => {
      const existing = registry[entry.key];
      const emails = getProgramLeaderEmailsForProgram(entry.title, entry.location);
      return {
        value: `${entry.title}|||${entry.location}`,
        title: entry.title,
        location: entry.location,
        label: `${entry.title}  •  ${entry.sessions} session(s), next ${formatDateLabel(entry.nextDate)}` +
          (existing ? '  •  already shared' : '') +
          (emails.length > 0 ? `  •  ${emails.join(', ')}` : '  •  no leader on Program_Leaders'),
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
function refreshProgramLeaderSheetsNow() {
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
    const sessionRows = getSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.All_Program_Sessions, 'Event_ID');
    const registrantRows = getSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID');

    // BEFORE THE REGISTRY CHECK BELOW: somebody pressing this — because a
    // program starts on Monday, or because they have just ticked
    // Notify_Roster_Changes — should not have to wait for the hourly sync to
    // get a sheet. Both auto-create passes, in the same order the sync runs
    // them; either may find the other already did it.
    try {
      ensureRegistrantSheetsForUpcomingPrograms(ss, sessionRows);
    } catch (err) {
      log(`⚠️ Could not auto-create the upcoming programs' registrant sheets (${err}).`);
    }
    try {
      ensureProgramLeaderSheetsForNotifyingLeaders(ss, sessionRows);
    } catch (err) {
      log(`⚠️ Could not auto-create registrant sheets for the notifying leaders (${err}).`);
    }

    const registry = getProgramLeaderSheetRegistry();
    if (Object.keys(registry).length === 0) {
      toastIfPossible('No program registrant sheets have been created yet. One is built by itself a week before a ' +
        'program\'s next session — use "Share a Program Registrant Sheet…" to get one sooner.');
      return;
    }

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
      merged = pullProgramLeaderSheetEdits(registrantRows);
      // THE SAME TWO STEPS THE HOURLY SYNC TAKES, and for the same reason: a
      // merge on its own leaves a Dropped tick sitting in a column nothing
      // reads and a seat that never comes back. This menu item exists for the
      // person who does not want to wait an hour, and until now what it saved
      // them the wait for was half the job.
      if (merged > 0) {
        merged += applyLeaderDropsAsCancellations(registrantRows);
        merged += applyLeaderWaitlistTicks(registrantRows, sessionRows);
        renderRegistrantsSheet(false, registrantRows);
        // The seat and the meal, now rather than at the next hourly sync —
        // the same courtesy cancelRegistrantRows() extends to the desk, for
        // the same reason: somebody pressed this because they want the
        // answer today.
        try {
          recomputeEventRegistryCounts(
            getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD),
            getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), registrantRows);
          updateMasterLunchDashboard(registrantRows);
        } catch (err) {
          log(`⚠️ Merged the leaders' edits, but could not recalculate the counts (${err}) — the hourly sync will.`);
        }
      }
    } catch (err) {
      log(`⚠️ Could not read the program registrant sheets back in (${err}).`);
      failures.push(`the program leaders' own edits could not be read back in (${err})`);
    }
    try {
      // FORCED, because this is the escape hatch. The hourly pass skips a sheet
      // whose rows have not moved (see computeLeaderSheetFingerprint), and the
      // reason somebody presses a menu item called "refresh the rosters" is
      // usually that one of them looks wrong — which is the one case a
      // fingerprint cannot see.
      pushed = pushProgramLeaderSheets(sessionRows, registrantRows, { force: true });
    } catch (err) {
      log(`⚠️ Could not push the program registrant sheets out (${err}).`);
      failures.push(`the rosters could not be sent out (${err})`);
    }

    flushAdminDigest('Program registrant sheet refresh');
    const trouble = failures.length === 0 ? '' : ` ⚠️ ${failures.join('; ')}.`;
    toastIfPossible(`Program registrant sheets refreshed ${failures.length === 0 ? '✅' : '⚠️'} — ` +
      `${pushed} sheet(s) out, ${merged} program leader edit(s) in.${trouble}`);
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
function buildProgramLeaderSheetHtml(options) {
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
<h3>Share a live registrant sheet</h3>
<p class="hint">
  Makes a small spreadsheet in Drive holding just this program's roster at this location, and adds
  whoever <b>Program_Leaders</b> names as its leader as an editor. One sheet per program, not per
  date — the same link stays right all season. It refreshes itself on the hourly registration sync,
  which also builds one by itself a week before a program's next session, so this is for when you
  want it sooner.
  The program leader ticks <b>Contacted</b>, <b>Confirmed</b>, <b>Waitlisted</b> and <b>Dropped</b> and
  types in <b>Leader_Notes</b>; those come back into the Registrants tab on the same sync.
  <b>Dropped is a cancellation</b> — the seat and the lunch go back on the next sync, and the
  leader's note rides along as the reason. <b>Waitlisted moves them onto the waitlist</b> the same
  way, and unticking it puts them back on whenever the session has room.
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
          : 'No leader address on file — copy the link and share it yourself, or add a row on ' +
            'the Program_Leaders tab and press this again.';
        var failed = res.unshared.length > 0
          ? '<br>Could not share with ' + res.unshared.join(', ') + '.'
          : '';
        // SAID OUT LOUD, both ways. Anyone with the link can edit this sheet —
        // which is what makes it work for program leaders who have no account here
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
      .createProgramLeaderSheet(chosen.value);
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

