/**
 * Dispatches to a per-sheet handler for tabs that carry a Manual_Override
 * column (Registrants, Lunch Dashboard) plus the Lunch_Schedule edit hook.
 * Master_Program_Dashboard's session table no longer has a Manual_Override
 * column at all (see HEADERS.Master_Program_Dashboard), so there's nothing
 * to auto-flip there anymore.
 */
/**
 * A SIMPLE trigger, on purpose, and that choice has consequences worth
 * stating because they shape everything reachable from here.
 *
 * Simple onEdit CAN show alerts and prompts (which is why the "are you sure?"
 * dialogs work at all) but runs WITHOUT authorization, so it cannot touch
 * CalendarApp, FormApp, PropertiesService, or the protection API. An
 * INSTALLABLE onEdit is the mirror image: full authorization, no UI at all,
 * so every confirmation would silently answer itself.
 *
 * We keep the dialogs. Everything an edit does that needs authorization is
 * therefore either (a) written to survive being refused — see
 * getCalendarEventsForWindow() and protectDerivedColumns(), both of which
 * degrade instead of throwing — or (b) moved off this path entirely and onto
 * a menu item the user clicks, which runs fully authorized. Pushing a menu
 * change out to live forms is the main example: it used to be attempted from
 * here, where FormApp is unavailable and the failure was swallowed by the
 * catch below, and is now "🍱 Push Menu Changes to Forms".
 *
 * BEFORE ADDING ANYTHING HERE: if it needs a Google service other than
 * SpreadsheetApp, it does not belong on this path.
 */
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const name = sheet.getName();
    if (name === SHEET_NAMES.REGISTRANT_DASH) {
      handleRegistrantsEdit(e, sheet);
    } else if (name === SHEET_NAMES.LUNCH_DASHBOARD) {
      handleLunchDashboardEdit(e, sheet);
    } else if (name === SHEET_NAMES.LUNCH_SCHEDULE) {
      handleLunchScheduleEdit(e, sheet);
    } else if (name === SHEET_NAMES.PROGRAM_DASHBOARD) {
      handleProgramDashboardEdit(e, sheet);
    } else if (name === SHEET_NAMES.CONFIG) {
      handleConfigEdit(e, sheet);
    } else if (name === SHEET_NAMES.CLUB_MEMBERS) {
      handleClubMembersEdit(e, sheet);
    }
  } catch (err) {
    // Say something. A silent catch here is how "I typed it and nothing
    // happened" becomes unreportable: the edit stays on the sheet looking
    // accepted while the work behind it never ran.
    log(`onEdit error: ${err}`);
    toastIfPossible(`⚠️ That edit didn't fully process (${err}). The cell is saved; check the log or run the matching menu item.`);
  }
}

/**
 * Master_Program_Dashboard: the session table is rebuilt from the calendar on
 * every render, so almost nothing typed here survives — EXCEPT the three
 * columns that describe how a program's registration works: Type_Tag, and the
 * Club / No_Registration checkboxes (PROGRAM_FLAG_COLUMNS). All three are real,
 * outward-facing decisions.
 *
 * Changing Grouped <-> Regular re-partitions a program's sessions across
 * forms: Regular means one form per calendar month, Grouped means one form for
 * the whole series. Applying that means the next sync builds different forms
 * and injects different links into the calendar — so it asks first, reverts
 * the cell on "no", and on "yes" writes the tag back into the calendar
 * DESCRIPTION (the actual source of truth, see resolveEventSettings()) so the
 * change survives the next render instead of being overwritten by it.
 *
 * The two checkboxes work exactly the same way, one tick instead of a dropdown
 * — see handleProgramFlagEdit().
 */
function handleProgramDashboardEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Event_ID');
  const editedRow = e.range.getRow();
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Program_Dashboard);

  // A LUNCH-ONLY ROW HAS NO CALENDAR EVENT BEHIND IT, and everything below
  // this line works by writing a tag into an event description. Type_Tag,
  // [Club] and [No Registration] are all instructions to the calendar, and
  // there is no calendar here — the row was generated from Lunch_Schedule (see
  // syncLunchOnlySessions()). Left unguarded the edit would be accepted on
  // screen, fail to reach anything, and be silently undone by the next render:
  // the "my change didn't save" bug, which is exactly what these paths exist
  // to prevent. So it is refused at the point of typing, with the place the
  // change actually belongs.
  const editedEventId = headerMap['Event_ID'] === undefined ? ''
    : String(sheet.getRange(editedRow, headerMap['Event_ID'] + 1).getValue() || '').trim();
  if (isLunchOnlyEventId(editedEventId)) {
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) {
      e.range.setValue(e.oldValue === undefined ? '' : e.oldValue);
      invalidateSectionedRowsCache(sheet); // the cell just went back to its old value
    }
    toastIfPossible(`⚠️ That is a lunch date, not a program — it has no calendar event to change. ` +
      `Edit it on ${SHEET_NAMES.LUNCH_SCHEDULE} instead.`);
    return;
  }

  // The flag checkboxes first: an edit lands in exactly one column, and
  // handleProgramFlagEdit() reports whether that column was one of theirs.
  for (let i = 0; i < PROGRAM_FLAG_COLUMNS.length; i++) {
    if (handleProgramFlagEdit(e, sheet, zones, headerMap, PROGRAM_FLAG_COLUMNS[i])) return;
  }

  const typeCol = headerMap['Type_Tag'];
  if (typeCol === undefined) return;

  // The edited RANGE, not just its top-left cell: a fill-down or a paste over
  // a block of Type_Tag cells is exactly as consequential as typing one, and
  // used to slip through unasked and unstamped (the calendar never learned
  // about it, so the next render silently put the old tags back — the "my
  // change didn't save" bug, in its quietest form).
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  if (typeCol + 1 < firstCol || typeCol + 1 > lastCol) return;

  const numRows = e.range.getNumRows();
  const isSingleCell = numRows === 1 && e.range.getNumColumns() === 1;

  if (isSingleCell) {
    const newTag = normalizeTypeTag(e.value);
    const oldTag = normalizeTypeTag(e.oldValue);
    if (newTag === oldTag) return;
    const title = String(sheet.getRange(editedRow, (headerMap['Clean_Title'] || 0) + 1).getValue() || 'this program');
    if (!confirmCellEditOrRevert(e, `Change ${title} to "${newTag}"?`, describeTypeTagChange(title, newTag))) return;
    applyTypeTagToCalendar(sheet, editedRow, headerMap, newTag, title);
    return;
  }

  // Multi-row edit. Collect the distinct (row, tag) pairs that actually landed
  // inside a data zone, ask ONCE, and stamp each affected program.
  const targets = [];
  for (let r = 0; r < numRows; r++) {
    const row = editedRow + r;
    if (!isRowInAnyDataZone(zones, row)) continue;
    const tag = normalizeTypeTag(sheet.getRange(row, typeCol + 1).getValue());
    if (tag !== EVENT_TYPES.GROUPED && tag !== EVENT_TYPES.REGULAR) continue;
    const title = String(sheet.getRange(row, (headerMap['Clean_Title'] || 0) + 1).getValue() || '').trim();
    if (!title) continue;
    if (targets.some(t => t.title === title && t.tag === tag)) continue; // one stamp per program
    targets.push({ row, title, tag });
  }
  if (targets.length === 0) return;

  const list = targets.slice(0, 8).map(t => `• ${t.title} → ${t.tag}`).join('\n');
  const more = targets.length > 8 ? `\n…and ${targets.length - 8} more` : '';
  // NOT confirmCellEditOrRevert(): a multi-cell edit carries no oldValue, so
  // there is nothing truthful to put back on a "no". Instead the change stays
  // on the sheet but is NOT pushed to the calendar, and the toast says so —
  // the next render then restores the calendar's own tags, which is the
  // honest undo.
  if (!confirmConsequentialAction('Change how these programs are grouped?',
    `${targets.length} program(s) would be re-grouped:\n${list}${more}\n\n` +
    'Each one\'s registration forms will be rebuilt on the next sync, and the registration link ' +
    'in its calendar events updated.', false)) {
    toastIfPossible('Not applied. The cells will go back to the calendar\'s own tags on the next sync.');
    return;
  }

  let stampedPrograms = 0;
  targets.forEach(t => {
    if (writeTypeTagToCalendarEvents(sheet, t.row, headerMap, t.tag) > 0) stampedPrograms++;
  });
  toastIfPossible(`Re-grouped ${stampedPrograms}/${targets.length} program(s) — run Sync Cal to rebuild their forms.`);
}

/** The plain-language consequence of flipping one program's Type_Tag. */
function describeTypeTagChange(title, newTag) {
  return newTag === EVENT_TYPES.GROUPED
    ? `"${title}" will switch to ONE shared registration form for its whole series, ` +
      `instead of a separate form each month.\n\nThe next sync will build that form and update the ` +
      `registration link on every one of its calendar events.`
    : `"${title}" will switch to a SEPARATE registration form per calendar month, ` +
      `instead of one form for the whole series.\n\nThe next sync will build those forms and update the ` +
      `registration link on every one of its calendar events.`;
}

/**
 * One tick of a Club / No_Registration checkbox, made LIVE — and made to
 * SURVIVE, which turned out to be the harder half.
 *
 * Returns TRUE when the edit belonged to this flag's column, so the caller can
 * stop looking.
 *
 * WHAT THIS FUNCTION DOES, and deliberately does not do. It runs on the SIMPLE
 * onEdit path, which has no authorization for CalendarApp (see onEdit()), so it
 * does no calendar work at all. It does the two things a spreadsheet write can
 * do, immediately:
 *
 *   1. ticks the same box on every OTHER row of the same program — same
 *      Clean_Title on the same calendar, plus everything sharing the form (see
 *      spreadFlagToSiblingRows()). A flag is a property of a program, never of
 *      one date, and leaving eleven rows unticked said otherwise.
 *   2. records the tick on the pending-changes tab (see
 *      PENDING_FLAG_SHEET_NAME), which is what stops the next sync from
 *      quietly undoing it before anything has had the authorization to write
 *      it to a calendar. THIS IS THE BUG FIX: a calendar edit anywhere fires
 *      onCalendarChange -> syncCalendars(), and that recomputes these columns
 *      from calendar descriptions that had never been told about the tick.
 *
 * The calendar write itself happens seconds later in
 * onProgramFlagEditInstallable(), the INSTALLABLE onEdit trigger, which is the
 * same edit seen by a fully authorized execution. That is what makes ticking
 * the box the only step. If that trigger is not installed (nobody has run
 * 🔧 Admin ▸ Check Triggers on this workbook yet), nothing is lost: the entry
 * stays queued, the box stays ticked, and the next Sync Cal delivers it.
 *
 * NO CONFIRMATION DIALOG. A dropdown holding a real value is worth asking
 * about; a checkbox is already the question, the answer and the undo, and a
 * modal here would also have to be answered before the installable trigger
 * could safely act. The toast says what was done and how to reverse it.
 */
function handleProgramFlagEdit(e, sheet, zones, headerMap, flag) {
  const flagCol = headerMap[flag.column];
  if (flagCol === undefined) return false;

  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  if (flagCol + 1 < firstCol || flagCol + 1 > lastCol) return false;

  const editedRow = e.range.getRow();
  const numRows = e.range.getNumRows();
  const readCell = (row, name) =>
    (headerMap[name] === undefined ? '' : String(sheet.getRange(row, headerMap[name] + 1).getValue() || '').trim());

  // Every distinct program touched by this edit — one cell or a fill-down over
  // a hundred — with the state its box now shows.
  const targets = [];
  for (let r = 0; r < numRows; r++) {
    const row = editedRow + r;
    if (!isRowInAnyDataZone(zones, row)) continue;
    const title = readCell(row, 'Clean_Title');
    const calendarId = readCell(row, 'Calendar_Source');
    if (!title || !calendarId) continue;
    const on = isTruthyCheckbox(sheet.getRange(row, flagCol + 1).getValue());
    if (targets.some(t => t.title === title && t.calendarId === calendarId)) continue;
    targets.push({ row, title, calendarId, on });
  }
  if (targets.length === 0) return true;

  let spread = 0;
  targets.forEach(t => {
    spread += spreadFlagToSiblingRows(sheet, zones, headerMap, flag, t.row, t.on);
    recordPendingProgramFlag(flag.column, t.calendarId, t.title, t.on);
  });

  const headline = targets.length === 1
    ? describeFlagState(flag, targets[0].title, targets[0].on)
    : `${targets.length} program(s) updated`;
  toastIfPossible(`${headline}${spread > 0 ? ` — ${spread} other session row(s) ticked to match` : ''}. ` +
    `Writing [${flag.tag}] to the calendar; the forms follow on the next Sync Cal.`);
  return true;
}

/**
 * Puts the same tick on every other row of the same program, and reports how
 * many rows it changed.
 *
 * WHAT COUNTS AS THE SAME PROGRAM, on the sheet alone (this runs where nothing
 * but SpreadsheetApp is available):
 *
 *   - same Clean_Title on the same Calendar_Source — the program itself, every
 *     one of its dates, past and upcoming;
 *   - anything sharing its Form_ID — which is how a program tagged
 *     [All Locations] reaches its own rows at the other locations, since what
 *     makes those one program is precisely that they share one form.
 *
 * Deliberately NOT "same title anywhere": two locations running an unlinked
 * "Chair Yoga" are two programs with two forms, and stampProgramFlagOnCalendar()
 * would not tag both either. The sheet and the calendar have to agree about
 * what a program is, or the next sync unticks whatever went further.
 */
function spreadFlagToSiblingRows(sheet, zones, headerMap, flag, sourceRow, on) {
  const flagCol = headerMap[flag.column];
  const titleCol = headerMap['Clean_Title'];
  const calCol = headerMap['Calendar_Source'];
  if (flagCol === undefined || titleCol === undefined || calCol === undefined) return 0;
  const formCol = headerMap['Form_ID'];

  const title = String(sheet.getRange(sourceRow, titleCol + 1).getValue() || '').trim();
  const calendarId = String(sheet.getRange(sourceRow, calCol + 1).getValue() || '').trim();
  if (!title || !calendarId) return 0;
  const formId = formCol === undefined
    ? '' : String(sheet.getRange(sourceRow, formCol + 1).getValue() || '').trim();

  let changed = 0;
  (zones || []).forEach(zone => {
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;

    const titles = sheet.getRange(zone.dataStart, titleCol + 1, count, 1).getValues();
    const calendars = sheet.getRange(zone.dataStart, calCol + 1, count, 1).getValues();
    const forms = formCol === undefined
      ? null : sheet.getRange(zone.dataStart, formCol + 1, count, 1).getValues();
    const flagRange = sheet.getRange(zone.dataStart, flagCol + 1, count, 1);
    const flags = flagRange.getValues();

    let touched = false;
    for (let r = 0; r < count; r++) {
      const rowTitle = String(titles[r][0] || '').trim();
      const rowCalendar = String(calendars[r][0] || '').trim();
      const rowForm = forms ? String(forms[r][0] || '').trim() : '';
      const sameProgram = (rowTitle === title && rowCalendar === calendarId) ||
        (!!formId && rowForm === formId);
      if (!sameProgram) continue;
      if (isTruthyCheckbox(flags[r][0]) === on && typeof flags[r][0] === 'boolean') continue;
      flags[r] = [on];
      touched = true;
      if (zone.dataStart + r !== sourceRow) changed++;
    }
    if (touched) {
      flagRange.setValues(flags);
      invalidateSectionedRowsCache(sheet);
    }
  });
  return changed;
}

/**
 * THE INSTALLABLE onEdit TRIGGER. Same edit as onEdit() above, seen a second
 * time by an execution that is fully authorized — which is the only way a
 * cell edit in this project can reach a calendar at all.
 *
 * Installed by writeTriggers() (🔧 Admin ▸ Check Triggers). Without it
 * everything still works, one sync later; with it, ticking the box is the
 * whole job.
 *
 * It drains the pending-changes queue rather than reading the edit: whatever
 * handleProgramFlagEdit() decided — including a fill-down that touched forty
 * programs — is already recorded there, and draining also picks up anything
 * an earlier failure left behind. Cheap to be wrong about: an edit anywhere
 * else on the workbook costs one sheet-name comparison and returns.
 */
function onProgramFlagEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAMES.PROGRAM_DASHBOARD) return;
    if (isBootstrapActive()) return; // it is rewriting the whole table anyway

    // Was this edit in one of the flag columns? Both triggers start from the
    // same edit and race, so when the answer is yes the queue entry may not be
    // written yet — wait a moment for it rather than deciding there is nothing
    // to do. When the answer is no, nothing is waited for: the drain still
    // runs, but only if something is already queued (a retry of an earlier
    // failure), and it costs one read of a two-column tab.
    if (editTouchesProgramFlagColumn(e, sheet)) {
      Utilities.sleep(1200);
    } else if (readPendingProgramFlags().length === 0) {
      return;
    }

    // The sync holds this lock while it reads every calendar and rewrites the
    // table — and it drains the queue itself as its first act, so there is
    // nothing here worth waiting for it to finish.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) {
      log('onProgramFlagEditInstallable: a sync is running and will deliver the queued change itself.');
      return;
    }
    let result;
    try {
      result = applyPendingProgramFlags();
    } finally {
      lock.releaseLock();
      // This trigger is installable, so it CAN send mail — and it is the one
      // path that delivers a tick to the calendar without a sync wrapped
      // around it. Without a flush, anything stampProgramFlagOnCalendar()
      // needed to tell somebody (a tag it could not remove without deleting
      // their note) would be assembled and then thrown away with the
      // execution.
      flushAdminDigest('Program flag change');
    }
    if (result.applied === 0 && result.failed === 0) return;

    toastIfPossible(result.failed === 0
      ? `Calendar updated ✅ — ${result.stampedEvents} event(s) across ${result.applied} program(s). ` +
        `The forms follow on the next Sync Cal.`
      : `⚠️ ${result.failed} program change(s) could not reach the calendar and are still queued — ` +
        `they will be retried on the next Sync Cal.`);
  } catch (err) {
    log(`onProgramFlagEditInstallable error: ${err}`);
  }
}

/** True when `e` covers a Club / No_Registration cell inside a data zone of the session table. */
function editTouchesProgramFlagColumn(e, sheet) {
  const zone = findZoneForRow(getSectionZones(sheet, 'Event_ID'), e.range.getRow());
  if (!zone) return false;
  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Program_Dashboard);
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  return PROGRAM_FLAG_COLUMNS.some(flag => {
    const col = headerMap[flag.column];
    return col !== undefined && col + 1 >= firstCol && col + 1 <= lastCol;
  });
}

/**
 * Drains the pending-changes queue: stamps each outstanding tick onto its
 * program's calendar events and clears the entries that got through.
 *
 * Authorized callers only (it writes to calendars): the installable onEdit
 * above, every sync, and the menu item. An entry survives a failed attempt on
 * purpose — a calendar that could not be read this minute is a reason to try
 * again later, not a reason to drop somebody's instruction.
 */
function applyPendingProgramFlags() {
  const result = { applied: 0, failed: 0, stampedEvents: 0 };
  const entries = readPendingProgramFlags();
  if (entries.length === 0) return result;

  // Every delivery below writes a calendar description, so it runs inside a
  // quiet window: otherwise one ticked checkbox fires the calendar-edit
  // triggers on every event of the program and each firing runs a full
  // syncCalendars(). Nested inside a sync (which drains the queue as its first
  // act) this is a no-op — see withCalendarChangeTriggersPaused().
  withCalendarChangeTriggersPaused('checkbox change', () => drainPendingProgramFlags(entries, result));
  return result;
}

/** The delivery loop itself. Always called inside a calendar quiet window. */
function drainPendingProgramFlags(entries, result) {
  const delivered = [];
  entries.forEach(entry => {
    const flag = getProgramFlagByColumn(entry.column);
    if (!flag || !entry.title || !entry.calendarId) {
      delivered.push(entry); // unreadable row — clearing it is the only sane end
      return;
    }
    const outcome = stampProgramFlagOnCalendar(entry.title, entry.calendarId, flag, entry.on);
    if (!outcome.ok) {
      result.failed++;
      return;
    }
    result.applied++;
    result.stampedEvents += outcome.stamped;
    delivered.push(entry);
    log(`Pending ${entry.column} change delivered: ${describeFlagState(flag, entry.title, entry.on)} ` +
      `(${outcome.stamped} calendar event(s) changed).`);
  });

  clearPendingProgramFlags(delivered);
  return result;
}

/**
 * The hidden queue tab, created on demand.
 *
 * Creating it puts the user somewhere they did not ask to be — insertSheet()
 * makes the new tab ACTIVE, and this can run from a cell edit — so the tab
 * they were working on is put back before anything else happens, and the new
 * one is hidden only after that (a sheet cannot be hidden while it is active).
 */
function getPendingFlagSheet(createIfMissing) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PENDING_FLAG_SHEET_NAME);
  if (!sheet) {
    if (!createIfMissing) return null;
    const wasActive = ss.getActiveSheet();
    sheet = ss.insertSheet(PENDING_FLAG_SHEET_NAME, ss.getNumSheets());
    sheet.getRange(1, 1, 1, PENDING_FLAG_HEADERS.length)
      .setValues([PENDING_FLAG_HEADERS])
      .setFontWeight('bold');
    freezeRowsSafely(sheet, 1);
    try { if (wasActive) ss.setActiveSheet(wasActive); } catch (err) { /* nothing to go back to */ }
    try { sheet.hideSheet(); } catch (err) { /* a lone or active tab cannot be hidden */ }
  }
  return sheet;
}

/** Every outstanding entry: { column, calendarId, title, on, row }. */
function readPendingProgramFlags() {
  const sheet = getPendingFlagSheet(false);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, PENDING_FLAG_HEADERS.length).getValues()
    .map((row, i) => ({
      column: String(row[0] || '').trim(),
      calendarId: String(row[1] || '').trim(),
      title: String(row[2] || '').trim(),
      on: isTruthyCheckbox(row[3]),
      row: i + 2
    }))
    .filter(entry => entry.column);
}

/**
 * Records (or replaces) one program's outstanding tick. Callable from a simple
 * onEdit — it is a spreadsheet write and nothing else.
 */
function recordPendingProgramFlag(flagColumn, calendarId, title, on) {
  try {
    const sheet = getPendingFlagSheet(true);
    const key = pendingFlagKey(flagColumn, calendarId, title);
    const existing = readPendingProgramFlags()
      .filter(entry => pendingFlagKey(entry.column, entry.calendarId, entry.title) === key);
    const values = [flagColumn, calendarId, title, !!on, new Date()];

    if (existing.length > 0) {
      sheet.getRange(existing[0].row, 1, 1, values.length).setValues([values]);
      // A duplicate can only exist if two edits raced; keep the first row.
      existing.slice(1).reverse().forEach(entry => sheet.deleteRow(entry.row));
      return;
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  } catch (err) {
    // Never let the queue break the edit itself. The box stays ticked; the
    // menu item is still there to push it through.
    log(`⚠️ Could not queue the ${flagColumn} change for "${title}" (${err}).`);
  }
}

/** Removes the given entries (bottom-up, so earlier row numbers stay valid). */
function clearPendingProgramFlags(entries) {
  if (!entries || entries.length === 0) return 0;
  const sheet = getPendingFlagSheet(false);
  if (!sheet) return 0;
  const rows = entries.map(entry => entry.row).filter(Boolean).sort((a, b) => b - a);
  rows.forEach(row => {
    try { sheet.deleteRow(row); } catch (err) { log(`⚠️ Could not clear pending row ${row} (${err}).`); }
  });
  return rows.length;
}

/**
 * `Calendar_Source|Clean_Title` for every program with an outstanding tick of
 * this flag — the set reconcileProgramFlagColumns() must not touch, because
 * the calendar has not been told about them yet.
 */
function pendingProgramKeysFor(flagColumn) {
  const keys = new Set();
  readPendingProgramFlags().forEach(entry => {
    if (entry.column !== flagColumn) return;
    keys.add(`${entry.calendarId}|${entry.title}`);
  });
  return keys;
}

/**
 * "Book Club is a club" / "Coffee Hour takes no registration" — one line, for
 * a toast or a list.
 *
 * The wording lives on the flag itself (PROGRAM_FLAG_COLUMNS.describeOn /
 * .describeOff) rather than in a chain of column-name tests here. It used to
 * be the latter, with [Club] as the fall-through, and the third flag arrived
 * after that chain was written: every log line and every toast about
 * Personalized_Assistance announced that the program "is a club", which is
 * both wrong and — on a tab where Club is a real neighbouring checkbox —
 * actively misleading about what had just been ticked.
 */
function describeFlagState(flag, title, on) {
  const describe = on ? (flag && flag.describeOn) : (flag && flag.describeOff);
  if (typeof describe === 'function') return describe(title);
  // A flag added without wording still says something true about itself.
  return `"${title}" ${on ? 'is now' : 'is no longer'} ${flag ? `[${flag.tag}]` : 'tagged'}`;
}

/** Stamps one program's new Type_Tag onto its calendar events and reports what happened. */
function applyTypeTagToCalendar(sheet, editedRow, headerMap, newTag, title) {
  const stamped = writeTypeTagToCalendarEvents(sheet, editedRow, headerMap, newTag);
  toastIfPossible(stamped > 0
    ? `Set "${title}" to ${newTag} on ${stamped} calendar event(s) — run Sync Cal to rebuild its form(s).`
    : `⚠️ "${title}" reads ${newTag} on the sheet, but the calendar could not be updated from a cell edit. ` +
      `Click "Apply Type Changes to Calendar" on the menu to make it stick.`);
  return stamped;
}

/**
 * Menu action: push everything the dashboard is still waiting to tell the
 * calendar — every queued Club / No_Registration tick, plus every program's
 * Type_Tag — and stamp the differences.
 *
 * THE RECOVERY PATH for the one thing a cell edit genuinely cannot finish.
 * Writing to a calendar needs authorization that a simple onEdit trigger does
 * not have (see onEdit()). Normally the installable onEdit trigger delivers a
 * tick within seconds and the next sync catches anything it missed; this is
 * what to click when neither has happened — no trigger installed, no sync
 * since, or a calendar that was unreachable at the time.
 *
 * THE FLAGS ARE TAKEN FROM THE QUEUE, NOT FROM THE CELLS, and that distinction
 * matters enough to state. Reading the checkboxes and stamping whatever they
 * currently show sounds equivalent and is not: an unticked box is indis-
 * tinguishable from a box nobody has ever touched, so a sheet that had gone
 * stale for any reason would have this action march through the calendar
 * DELETING [Club] tags that were typed there by hand and were perfectly
 * correct. The queue holds only what a person actually did. Type_Tag has no
 * queue and keeps its sheet-driven behavior, which is safe for the reason the
 * flags are not: it always holds a real, non-empty value.
 *
 * Safe to click at any time.
 */
function applyProgramTagChangesToCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) { toastIfPossible('No program dashboard yet — run Sync Cal first.'); return 0; }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const byProgram = {};
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const calendarId = String(row[map['Calendar_Source']] || '').trim();
    const tag = normalizeTypeTag(row[map['Type_Tag']]);
    if (!title || !calendarId) return;
    if (tag !== EVENT_TYPES.GROUPED && tag !== EVENT_TYPES.REGULAR) return;
    // Last row wins per program — they should all agree, and if they don't,
    // the most recently written one is the intent.
    byProgram[`${title}|${calendarId}`] = { title, calendarId, tag };
  });

  // ONE quiet window around the whole job, drain included. Both halves write
  // descriptions, and the calendar-edit triggers must not come back between
  // them — see withCalendarChangeTriggersPaused(). This is the click that used
  // to produce a run of onCalendarChange firings, each one a full sync
  // reacting to the edits of the one before it.
  let stampedEvents = 0;
  let changedPrograms = 0;
  let pending = { applied: 0, failed: 0, stampedEvents: 0 };
  withCalendarChangeTriggersPaused('Apply Type / Club / No-Reg Changes', () => {
    pending = applyPendingProgramFlags();
    stampedEvents = pending.stampedEvents;
    changedPrograms = pending.applied;
    Object.keys(byProgram).forEach(k => {
      const p = byProgram[k];
      const n = stampTypeTagOnCalendar(p.title, p.calendarId, p.tag);
      if (n > 0) { stampedEvents += n; changedPrograms++; }
    });
  });

  const stillQueued = pending.failed > 0
    ? ` ⚠️ ${pending.failed} queued change(s) still could not reach the calendar — check that the calendars are readable.`
    : '';
  const message = changedPrograms > 0
    ? `Applied ${changedPrograms} program change(s) to ${stampedEvents} calendar event(s) — ` +
      `run Sync Cal to rebuild their forms.${stillQueued}`
    : `Everything on the dashboard already matches its calendar ✅ — nothing to change.${stillQueued}`;
  toastIfPossible(message);
  log(`applyProgramTagChangesToCalendar: ${message}`);
  return changedPrograms;
}

/**
 * The name this action had when it only handled Type_Tag. Kept so anything
 * still bound to it — an old menu, a saved trigger, somebody's habit in the
 * script editor — keeps working.
 */
function applyTypeTagChangesToCalendar() {
  return applyProgramTagChangesToCalendar();
}

/**
 * Writes [Grouped]/[Regular] into the DESCRIPTION of every calendar event
 * belonging to the same program as `editedRow`, replacing whichever grouping
 * bracket was there.
 *
 * The description is where resolveEventSettings() reads this from, so this is
 * what makes a Type_Tag edit stick. Without it the cell would read "Grouped"
 * until the next render recomputed it from the calendar and quietly put
 * "Regular" back — the classic "my change didn't save" bug.
 *
 * Scope is program + location (every session sharing Clean_Title and
 * Calendar_Source), not just the edited row: grouping is a property of the
 * program, and leaving its other sessions disagreeing would split it across
 * both groupings at once. That's the "unite disparate monthly events" case.
 */
function writeTypeTagToCalendarEvents(sheet, editedRow, headerMap, newTag) {
  const title = String(sheet.getRange(editedRow, (headerMap['Clean_Title'] || 0) + 1).getValue() || '').trim();
  const calendarId = String(sheet.getRange(editedRow, (headerMap['Calendar_Source'] || 0) + 1).getValue() || '').trim();
  return stampTypeTagOnCalendar(title, calendarId, newTag);
}

/**
 * The stamping itself, addressed by program rather than by sheet row, so both
 * the cell-edit path above and the menu-driven reconcile
 * (applyTypeTagChangesToCalendar) share one implementation.
 */
function stampTypeTagOnCalendar(title, calendarId, newTag) {
  if (!title || !calendarId) return 0;

  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  if (!eventsByCalendar[calendarId]) {
    log(`⚠️ Type_Tag change for "${title}": calendar ${calendarId} could not be read — nothing stamped.`);
    return 0;
  }

  let stamped = 0;
  // Every calendar is walked, but only this program's own calendar is stamped
  // unconditionally. The exception is a session tagged [All Locations]: it
  // shares ONE form with the other locations, so leaving them on a different
  // Grouped/Regular tag would split that shared program back into two forms —
  // one keyed ::FIXED and one keyed by month. Grouping is a property of a
  // program, and a linked program's program spans locations.
  Object.keys(CALENDAR_MAP).forEach(otherCalendarId => {
    const events = eventsByCalendar[otherCalendarId];
    if (!events) return;
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.cleanTitle !== title) return;

      const existing = ev.getDescription() || '';
      if (otherCalendarId !== calendarId &&
        !(parseSettingsBrackets(existing).isShared || parsed.legacyIsShared)) return;

      // A NO-OP EDIT IS STILL AN EDIT, and every one of them is a notification
      // to everybody the event is shared with — the same rule
      // setFlagBracketInDescription() follows when a tag is already there.
      //
      // [Regular] is the DEFAULT: an event whose description says nothing
      // about grouping already means Regular, so appending the word tells the
      // system nothing it did not know and tells every subscriber that the
      // event changed. Applying "Monthly sign-up" from the review would
      // otherwise rewrite the description of every event of every program
      // that was already monthly, which is most of them.
      //
      // NOT skipped when the description is silent but the TITLE still carries
      // a legacy "[Grouped]": there the appended [Regular] is doing real work,
      // because an explicit statement in the description is the only thing
      // that overrides a bracket left in a title (see resolveEventSettings()).
      const settings = resolveEventSettings(ev, parsed);
      const statesGrouping = !!parseSettingsBrackets(existing).explicitGrouping;
      const wantsGrouped = newTag === EVENT_TYPES.GROUPED;
      if (!statesGrouping && settings.isFixed === wantsGrouped) return;

      const updated = setGroupingBracketInDescription(existing, newTag);
      if (updated === existing) return;
      ev.setDescription(updated);
      stamped++;
    });
  });

  if (stamped > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`Stamped [${newTag}] onto ${stamped} calendar event(s) for "${title}".`);
  }
  return stamped;
}

/**
 * The flag equivalent of stampTypeTagOnCalendar(): writes [Club] or
 * [No Registration] into — or out of — the DESCRIPTION of every calendar event
 * of one program, and returns how many events changed.
 *
 * Same scoping rule as the grouping stamp, for the same reason. A program's
 * own calendar is stamped unconditionally; another location's copy is stamped
 * only when it is tagged [All Locations], because then it is genuinely the
 * same program and a club (or a no-sign-up program) that is one at Narberth
 * and not at Ashbridge is a contradiction rather than a setting.
 *
 * `flag` is an entry of PROGRAM_FLAG_COLUMNS; `on` is the state the checkbox
 * was just put into.
 *
 * Returns { stamped, ok }. The two are not the same question and the pending
 * queue needs both: `stamped: 0, ok: true` means the calendar already agreed
 * and the instruction is DONE, while `ok: false` means the calendar could not
 * be read at all and the instruction must stay queued for another attempt.
 * Conflating them is how a tick gets dropped on the one run where Calendar was
 * briefly unavailable.
 */
function stampProgramFlagOnCalendar(title, calendarId, flag, on) {
  if (!title || !calendarId || !flag) return { stamped: 0, ok: false };

  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  if (!eventsByCalendar[calendarId]) {
    log(`⚠️ ${flag.column} change for "${title}": calendar ${calendarId} could not be read — nothing stamped.`);
    return { stamped: 0, ok: false };
  }

  let stamped = 0;
  let stuck = 0;
  Object.keys(CALENDAR_MAP).forEach(otherCalendarId => {
    const events = eventsByCalendar[otherCalendarId];
    if (!events) return;
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.cleanTitle !== title) return;

      const existing = ev.getDescription() || '';
      if (otherCalendarId !== calendarId &&
        !(parseSettingsBrackets(existing).isShared || parsed.legacyIsShared)) return;

      const updated = setFlagBracketInDescription(existing, flag.regex, flag.tag, on);
      // Untagging that couldn't finish — the word is inside somebody's own
      // bracketed note ("[Book Club]"), which is left intact on purpose.
      // The next sync will read the tag straight back off the calendar and
      // re-tick the box, so this has to reach a person.
      if (!on && descriptionStillCarriesFlag(updated, flag.regex)) stuck++;
      if (updated === existing) return;
      ev.setDescription(updated);
      stamped++;
    });
  });

  if (stamped > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`${on ? 'Added' : 'Removed'} [${flag.tag}] on ${stamped} calendar event(s) for "${title}".`);
  }
  if (stuck > 0) {
    const message = `Unticking ${flag.column} for "${title}" left ${stuck} calendar event(s) still reading as ` +
      `[${flag.tag}] — the word is part of a bracketed note somebody wrote (something like "[Book ${flag.tag}]"), ` +
      `and removing it would have deleted their note. Edit those event descriptions by hand, or the next sync ` +
      `will tick the box again.`;
    log(`⚠️ ${message}`);
    noteForAdmin(`${flag.column} could not be removed from the calendar`, message);
  }
  return { stamped, ok: true, stuck };
}

/**
 * Returns `description` with any grouping bracket ([Grouped]/[Regular], or the
 * legacy [Fixed]/[Regular]) replaced by [newTag] — preserving [Cap: N] and any
 * unrelated bracketed notes, and appending the tag if none was present.
 */
function setGroupingBracketInDescription(description, newTag) {
  const raw = String(description || '');
  const groupingWord = /^\s*(Grouped|Fixed|Monthly|Regular)\s*$/i;
  let replaced = false;

  // Rewrite brackets that ONLY hold a grouping word; leave mixed brackets
  // like [Cap: 12, Grouped] to the combined-content branch below.
  let out = raw.replace(/\[([^\]]*)\]/g, (whole, content) => {
    if (groupingWord.test(content)) { replaced = true; return `[${newTag}]`; }
    if (/\b(Grouped|Fixed|Monthly|Regular)\b/i.test(content)) {
      replaced = true;
      const kept = content
        .split(',')
        .map(part => part.trim())
        .filter(part => part && !groupingWord.test(part));
      return `[${kept.concat(newTag).join(', ')}]`;
    }
    return whole;
  });

  // raw.trim(), not raw — an all-whitespace description has no content to sit
  // under, and treating it as content left the tag behind a blank first line.
  if (!replaced) out = raw.trim() ? `${raw.replace(/\s*$/, '')}\n[${newTag}]` : `[${newTag}]`;
  return out;
}

/**
 * Returns `description` with the [All Locations] tag added or removed,
 * preserving [Cap: N], [Grouped]/[Regular] and any unrelated bracketed notes.
 * Removing it empties a bracket that held nothing else, which is why the
 * result goes through tidyDescriptionWhitespace().
 */
function setSharedBracketInDescription(description, shared) {
  return setFlagBracketInDescription(description, SHARED_LOCATION_WORDS_REGEX, SHARED_LOCATION_TAG, shared);
}

/**
 * The general form of the above: returns `description` with a one-word tag
 * added or removed, preserving every other bracket and every other word inside
 * a shared bracket.
 *
 * This is what a ticked checkbox on the dashboard turns into — [Club] and
 * [No Registration] both go through here (see PROGRAM_FLAG_COLUMNS), as does
 * [All Locations]. The rules that matter:
 *
 *   - adding, when some spelling of the tag is already there, changes nothing.
 *     "[Members Only]" already says club; rewriting it to "[Club]" would edit
 *     somebody's calendar to no effect, and every such edit is a notification
 *     to everyone the event is shared with.
 *   - removing takes the word out of whatever bracket held it and keeps the
 *     rest, so [Cap: 12, Club] becomes [Cap: 12] rather than disappearing.
 *   - a bracket left empty is dropped, and the hole it leaves is closed up by
 *     tidyDescriptionWhitespace().
 *
 * REMOVAL IS EXACT, and that is the careful part. A comma-separated part is
 * taken out only when the part IS the tag — "Club", "Members Only" — never
 * when it merely contains the word. "[Book Club]" and "[Drop-In room 4]" are
 * somebody's note about the program, not this system's tag, and the earlier
 * contains-match deleted them outright: an unticked checkbox silently erasing
 * a line from a calendar event that attendees can see. A tag that survives
 * that rule is reported rather than fought over — descriptionStillCarriesFlag()
 * finds it and stampProgramFlagOnCalendar() tells somebody — because a
 * checkbox that won't stick is a thing a person can fix in thirty seconds and
 * a deleted note is not.
 */
function setFlagBracketInDescription(description, wordsRegex, tagWord, on) {
  const raw = String(description || '');
  const isJustTheTag = part => {
    const trimmed = String(part).trim();
    if (!trimmed) return false;
    const match = wordsRegex.exec(trimmed);
    return !!match && match[0].length === trimmed.length;
  };
  let sawTag = false;

  let out = raw.replace(/\[([^\]]*)\]/g, (whole, rawContent) => {
    // Normalized for the same reason the parser normalizes — the two halves of
    // this round trip have to agree about what a tag is, and a description
    // edited in the Calendar web UI says "Personalized&nbsp;Assistance". Left
    // unnormalized here, ticking the box on a program whose calendar already
    // said so appended a SECOND [Personalized Assistance] bracket.
    const content = normalizeBracketContent(rawContent);
    if (!wordsRegex.test(content)) return whole;
    // A NOTE IS NOT A TAG, and this is the side of that rule that was missing.
    // parseSettingsBrackets() reads a bracket only when the WHOLE bracket is
    // tags (isTagOnlyBracket()), so "[Call the office for an appointment]" is
    // prose and sets nothing. This function still counted it as "already
    // tagged" and therefore wrote nothing to the calendar — so ticking
    // Personalized_Assistance on such a program stamped 0 events, the sync
    // read the calendar back, found no tag, and unticked the box. The two
    // halves have to agree about what a tag is, or a checkbox cannot stick.
    if (!isTagOnlyBracket(content)) return whole;
    sawTag = true;
    if (on) return whole; // already tagged — leave the author's spelling alone
    const parts = content.split(',').map(part => part.trim()).filter(Boolean);
    const kept = parts.filter(part => !isJustTheTag(part));
    if (kept.length === parts.length) return whole; // nothing here was the tag
    return kept.length > 0 ? `[${kept.join(', ')}]` : '';
  });

  if (on && !sawTag) {
    // `raw.trim()`, not `raw`: an all-whitespace description is empty for this
    // purpose, and treating it as content prefixed the tag with a blank line.
    out = raw.trim() ? `${raw.replace(/\s*$/, '')}\n[${tagWord}]` : `[${tagWord}]`;
  }
  if (!on && sawTag) out = tidyDescriptionWhitespace(out);
  return out;
}

/**
 * Returns `description` with "[Slots: N]" saying `minutes` — rewriting the
 * number where one is already stated, appending a bracket where none is.
 *
 * Same rules as setFlagBracketInDescription(), which is the point: only a
 * TAG-ONLY bracket is rewritten (isTagOnlyBracket()), so "[Slots: 20 if Gerry
 * is in]" is somebody's note and is left exactly as typed, and a bracket that
 * holds other tags keeps them — "[Personalized Assistance, Slots: 30]" becomes
 * "[Personalized Assistance, Slots: 20]" rather than growing a second bracket
 * that contradicts the first.
 *
 * `minutes` outside the sanity bounds is refused rather than written: the
 * parser would ignore it anyway (see parseSettingsBrackets), and a description
 * that says one thing while the system does another is worse than a
 * description that says nothing.
 */
function setSlotMinutesInDescription(description, minutes) {
  const raw = String(description || '');
  const wanted = Number(minutes) || 0;
  if (wanted < MIN_APPOINTMENT_SLOT_MINUTES || wanted > MAX_APPOINTMENT_SLOT_MINUTES) return raw;

  const slotsPattern = /Slots?:\s*\d+/i;
  let replaced = false;
  let out = raw.replace(/\[([^\]]*)\]/g, (whole, rawContent) => {
    const content = normalizeBracketContent(rawContent); // see the note there
    if (!slotsPattern.test(content) || !isTagOnlyBracket(content)) return whole;
    replaced = true;
    return `[${content.replace(new RegExp(slotsPattern.source, 'gi'), `Slots: ${wanted}`)}]`;
  });

  // raw.trim(), not raw — an all-whitespace description has no content for the
  // tag to sit under, exactly as in setFlagBracketInDescription().
  if (!replaced) out = raw.trim() ? `${raw.replace(/\s*$/, '')}\n[Slots: ${wanted}]` : `[Slots: ${wanted}]`;
  return out;
}

/**
 * True when `description` still reads as carrying `wordsRegex`'s tag inside a
 * bracket — what setFlagBracketInDescription(…, false) could not remove
 * without destroying somebody's own words. See stampProgramFlagOnCalendar().
 */
function descriptionStillCarriesFlag(description, wordsRegex) {
  BRACKET_GROUP_REGEX.lastIndex = 0;
  let match;
  while ((match = BRACKET_GROUP_REGEX.exec(String(description || ''))) !== null) {
    const content = match[1] || '';
    // Tag-only brackets only, matching the parser (isTagOnlyBracket()) and
    // setFlagBracketInDescription() above. A prose bracket that merely
    // contains the word — "[Film Club selection: Casablanca]" — is not read as
    // a tag by anything any more, so warning that it will re-tick the box is
    // a false alarm about a note the untick never had any business touching.
    if (isTagOnlyBracket(content) && wordsRegex.test(normalizeBracketContent(content))) {
      BRACKET_GROUP_REGEX.lastIndex = 0;
      return true;
    }
  }
  return false;
}

/**
 * Menu action: put one program's sessions at every location onto ONE
 * registration form — or take them back apart.
 *
 * The tag itself is just text in a calendar description ([All Locations], see
 * SHARED_LOCATION_SCOPE) and could be typed by hand on every event. This
 * exists because typing it by hand does only half the job on a calendar that
 * has already been imported:
 *
 *   1. it has to go on the events at EVERY location, or the program ends up
 *      half-linked (warnAboutPartiallySharedPrograms());
 *   2. the dates already on the session table are not re-imported — a group
 *      whose dates are all present is skipped wholesale by
 *      collectCalendarWork() — so without step 3 the change would appear to
 *      do nothing until the next new date appeared months later.
 *   3. so the sessions ALREADY on the table are re-pointed onto whichever of
 *      the program's existing forms is keeping the roster, the survivor form
 *      is relabelled to name its locations, and every calendar link is
 *      rewritten to match.
 *
 * PAST sessions are deliberately left alone: they carry the form their
 * registrations actually came in on, and that is the record.
 */
function linkProgramAcrossLocations() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return null;
  }

  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    log(`linkProgramAcrossLocations: no UI available (${err}) — this action has to be run from the menu.`);
    return null;
  }

  const answer = ui.prompt('Link a program across locations',
    'Type the program name exactly as it appears in Clean_Title on the dashboard ' +
    '(e.g. "Tai Chi").\n\n' +
    'Every calendar event with that name, at every location, will be tagged ' +
    `[${SHARED_LOCATION_TAG}] so they all share ONE registration form. Run it again on an ` +
    'already-linked program to unlink it.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return null;

  const title = String(answer.getResponseText() || '').trim();
  if (!title) {
    toastIfPossible('No program name typed — nothing changed.');
    return null;
  }

  const matches = findProgramEventsAcrossCalendars(title);
  if (matches.total === 0) {
    ui.alert(`No calendar events named "${title}" in the sync window. ` +
      'Check the spelling against the Clean_Title column (the name without any [brackets] or "*").');
    return null;
  }

  // Already fully tagged -> this is an unlink. Otherwise -> link.
  const linking = matches.tagged < matches.total;
  const locationSummary = Object.keys(matches.byLocation)
    .map(loc => `• ${loc}: ${matches.byLocation[loc].total} event(s), ${matches.byLocation[loc].tagged} already tagged`)
    .join('\n');

  const detail = linking
    ? `"${title}" — ${matches.total} event(s) across ${Object.keys(matches.byLocation).length} location(s):\n` +
      `${locationSummary}\n\n` +
      `They will all be tagged [${SHARED_LOCATION_TAG}], and their UPCOMING sessions re-pointed onto one shared ` +
      `form — one for the whole series if this program is Grouped, one per month if it is Regular, in each case ` +
      `whichever existing form already carries the most of those sessions. Its dates will be relabelled to name ` +
      `their location — "Mon, Jan 5, 2026${LOCATION_LABEL_SEPARATOR}Narberth" — and every upcoming event's ` +
      `registration link rewritten to point at it.\n\n` +
      `Past sessions keep the form they were registered on. Registrations already imported are untouched.`
    : `"${title}" is currently linked across ${Object.keys(matches.byLocation).length} location(s):\n` +
      `${locationSummary}\n\n` +
      `The [${SHARED_LOCATION_TAG}] tag will be removed from all ${matches.total} event(s), so each location's ` +
      `FUTURE dates go back onto their own form. Sessions already on the dashboard keep the shared form they ` +
      `are on now — moving live registrations back apart is not something this can do safely.`;

  if (!confirmConsequentialAction(linking ? 'Link this program across locations?' : 'Unlink this program?', detail, false)) {
    return null;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try again in a moment.');
    return null;
  }
  try {
    // Tagging every event of a program, then rewriting the registration link
    // on each one, is a lot of description writes — all of which the
    // calendar-edit triggers would otherwise deliver straight back as a run of
    // full syncs. See withCalendarChangeTriggersPaused().
    let stamped = 0;
    let repointed = { moved: 0, survivors: [] };
    withCalendarChangeTriggersPaused('Link Program Across Locations', () => {
      stamped = stampSharedTagOnCalendars(matches.events, linking);
      if (linking) repointed = repointProgramSessionsToOneForm(registrySheet, title);
    });

    const summary = linking
      ? `"${title}" linked across locations ✅ — ${stamped} event(s) tagged, ` +
        `${repointed.moved} upcoming session(s) moved onto ${repointed.survivors.length || 1} shared form(s).`
      : `"${title}" unlinked ✅ — the tag came off ${stamped} event(s). Run Sync Cal to build each location's own form.`;
    log(`linkProgramAcrossLocations: ${summary}`);
    toastIfPossible(summary);
    flushAdminDigest('Link program across locations');
    return { linking, stamped, repointed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Every timed event named `title` on every program calendar in the sync
 * window, with a per-location tally of how many already carry the
 * [All Locations] tag. Matching is on cleanTitle, so "*Tai Chi" and
 * "Tai Chi [Cap: 12]" both count as "Tai Chi".
 */
function findProgramEventsAcrossCalendars(title) {
  const wanted = String(title || '').trim().toLowerCase();
  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);

  const result = { total: 0, tagged: 0, byLocation: {}, events: [] };
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Link across locations: "${locationName}" could not be read — skipped.`);
      return;
    }
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.cleanTitle.toLowerCase() !== wanted) return;

      const isTagged = parseSettingsBrackets(ev.getDescription() || '').isShared || parsed.legacyIsShared;
      if (!result.byLocation[locationName]) result.byLocation[locationName] = { total: 0, tagged: 0 };
      result.byLocation[locationName].total++;
      if (isTagged) result.byLocation[locationName].tagged++;
      result.total++;
      if (isTagged) result.tagged++;
      result.events.push({ event: ev, calendarId, locationName });
    });
  });
  return result;
}

/** Writes (or clears) the [All Locations] tag on a set of events. Returns how many descriptions changed. */
function stampSharedTagOnCalendars(matchedEvents, shared) {
  let stamped = 0;
  matchedEvents.forEach(({ event }) => {
    const existing = event.getDescription() || '';
    const updated = setSharedBracketInDescription(existing, shared);
    if (updated === existing) return;
    event.setDescription(updated);
    stamped++;
  });
  if (stamped > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`${shared ? 'Tagged' : 'Untagged'} [${SHARED_LOCATION_TAG}] on ${stamped} calendar event(s).`);
  }
  return stamped;
}

/**
 * Moves the UPCOMING sessions of `title` onto one form PER SPAN — one form
 * for the whole series if the program is [Grouped], one per calendar month if
 * it is [Regular]. That mirrors exactly what a fresh import would build, so a
 * program linked here and a program linked before its dates existed end up in
 * the same shape.
 *
 * Within a span the surviving form is the one already carrying the most of
 * that span's sessions (earliest date breaks a tie), so the form that keeps
 * the roster is the one most people are already looking at.
 *
 * Rewrites Form_ID and both link columns in place, records the resulting
 * cross-location group keys in the persistent registry (so the next sync
 * reuses these forms instead of building more), relabels each surviving form
 * to name its locations, and rewrites the registration link on every upcoming
 * calendar event so nothing still points at a retired form.
 */
function repointProgramSessionsToOneForm(registrySheet, title) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return { moved: 0, survivors: [] };
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  const todayKey = formatDateKey(new Date());
  const wanted = String(title || '').trim().toLowerCase();

  // The form-span this row belongs to — the same partition buildEventGroups()
  // uses, so re-pointing lands where the next import would have put it.
  const spanOf = formSpanForRow;

  // Pass 1: read the zones once and work out which form survives in each span.
  const zones = [];
  const tally = {};
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;
    const read = col => registrySheet.getRange(zone.start, sheetMap[col], zone.count, 1).getValues();
    const info = {
      zone,
      dates: read('Event_Date'),
      titles: read('Clean_Title'),
      types: read('Type_Tag'),
      formIds: read('Form_ID')
    };
    zones.push(info);

    info.dates.forEach((dateRow, r) => {
      const d = coerceDate(dateRow[0]);
      const rowTitle = String(info.titles[r][0] || '').trim().toLowerCase();
      const formId = String(info.formIds[r][0] || '').trim();
      if (!d || rowTitle !== wanted || !formId || formatDateKey(d) < todayKey) return;
      const span = spanOf(info.types[r][0], d);
      if (!tally[span]) tally[span] = {};
      if (!tally[span][formId]) tally[span][formId] = { count: 0, earliest: d };
      tally[span][formId].count++;
      if (d < tally[span][formId].earliest) tally[span][formId].earliest = d;
    });
  });

  const spans = Object.keys(tally);
  if (spans.length === 0) {
    log(`repointProgramSessionsToOneForm: no upcoming "${title}" sessions on the dashboard yet — the next Sync Cal ` +
      `will build the shared form(s) from the calendar.`);
    return { moved: 0, survivors: [] };
  }

  // The survivor for each span, and its links — resolved up front so a form
  // that won't open costs its own span only, not the whole run.
  const survivorBySpan = {};
  const linksBySpan = {};
  spans.forEach(span => {
    const candidates = Object.keys(tally[span]);
    const survivor = candidates.sort((a, b) =>
      (tally[span][b].count - tally[span][a].count) || (tally[span][a].earliest - tally[span][b].earliest))[0];
    try {
      const form = FormApp.openById(survivor);
      survivorBySpan[span] = survivor;
      linksBySpan[span] = {
        view: makeHyperlinkFormula(buildRegistrationUrl(form), 'View Live Form'),
        edit: makeHyperlinkFormula(form.getEditUrl(), 'Edit Form Settings')
      };
    } catch (err) {
      log(`⚠️ repointProgramSessionsToOneForm: could not open form ${survivor} for "${title}" / ${span} (${err}) — ` +
        `those sessions were left where they are.`);
      noteForAdmin('Programs that could not be linked across locations',
        `"${title}" (${span}) — the form its sessions would move onto (${survivor}) could not be opened: ${err}`);
    }
  });

  // Pass 2: write Form_ID and both links on the rows that are moving.
  let moved = 0;
  zones.forEach(info => {
    const { zone } = info;
    const idRange = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1);
    const viewRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const editRange = registrySheet.getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1);
    const ids = idRange.getValues();
    // Formula-or-value, so rows that are NOT moving are written back exactly
    // as they were (the same care updateRegistryFormLinks() takes).
    const viewValues = viewRange.getValues();
    const editValues = editRange.getValues();
    const views = viewRange.getFormulas().map((f, r) => [f[0] || viewValues[r][0]]);
    const edits = editRange.getFormulas().map((f, r) => [f[0] || editValues[r][0]]);

    let touched = false;
    info.dates.forEach((dateRow, r) => {
      const d = coerceDate(dateRow[0]);
      const rowTitle = String(info.titles[r][0] || '').trim().toLowerCase();
      const formId = String(ids[r][0] || '').trim();
      if (!d || rowTitle !== wanted || !formId || formatDateKey(d) < todayKey) return;
      const survivor = survivorBySpan[spanOf(info.types[r][0], d)];
      if (!survivor || formId === survivor) return;
      ids[r] = [survivor];
      views[r] = [linksBySpan[spanOf(info.types[r][0], d)].view];
      edits[r] = [linksBySpan[spanOf(info.types[r][0], d)].edit];
      touched = true;
      moved++;
    });

    if (touched) {
      idRange.setValues(ids);
      viewRange.setValues(views);
      editRange.setValues(edits);
      invalidateSectionedRowsCache(registrySheet);
    }
  });

  const survivors = spans.map(span => survivorBySpan[span]).filter(Boolean);
  if (moved === 0) {
    log(`repointProgramSessionsToOneForm: "${title}" already sits on one form per span — nothing to move.`);
    return { moved, survivors };
  }
  SpreadsheetApp.flush(); // the refresh below re-reads these rows

  // These forms now span locations. Record that where the next sync looks for
  // them, then relabel each one (buildFormSessionContext() sees the
  // multi-location rows and adds the location to every date label).
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const derived = { eventIds: new Set(), groupFormMap: {} };
  addSharedGroupKeysFromRows(derived, rows, map);
  Object.keys(derived.groupFormMap).forEach(key => {
    if (survivors.indexOf(derived.groupFormMap[key]) !== -1) {
      savePersistentFormRegistryEntry(key, derived.groupFormMap[key]);
    }
  });
  flushPersistentRegistries();

  dedupePreservingOrder(survivors).forEach(formId =>
    refreshOneFormDateLabels(formId, rows, map, 'cross-location link'));
  flushPersistentRegistries();

  // Retired forms are still linked from every calendar event they used to
  // cover. Rewriting from the session table is exactly what this does.
  rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());

  return { moved, survivors };
}

/**
 * Config: these cells change how every FUTURE registration is interpreted —
 * a catering policy decides whether a location is asked about lunch at all,
 * and buffers/order-ahead feed the numbers staff order against. Worth a
 * confirmation, and worth invalidating the caches built from them.
 */
function handleConfigEdit(e, sheet) {
  if (typeof e.value === 'undefined') return; // multi-cell paste
  const editedCol = e.range.getColumn();
  const policySection = CONFIG_LAYOUT.CATERING_POLICY;
  const isPolicyEdit = editedCol === policySection.startCol + 1 &&
    e.range.getRow() >= CONFIG_DATA_START_ROW;

  if (isPolicyEdit) {
    const location = String(sheet.getRange(e.range.getRow(), policySection.startCol).getValue() || 'this location');
    const detail = `Lunch service for "${location}" becomes "${e.value}".\n\n` +
      `This changes whether its registration forms ask about lunch at all, and whether its dates ` +
      `appear on the lunch dashboard. Existing forms are updated on the next sync.`;
    if (!confirmCellEditOrRevert(e, `Change lunch service for ${location}?`, detail)) return;
    toastIfPossible(`Lunch service for ${location} set to "${e.value}" — forms update on the next sync.`);
  }

  const isLinkDisplayEdit = editedCol === CONFIG_LAYOUT.LINK_DISPLAY.startCol &&
    e.range.getRow() === CONFIG_DATA_START_ROW;
  if (isLinkDisplayEdit) {
    const hiding = String(e.value || '').trim().toLowerCase() === LINK_DISPLAY_OPTIONS.HIDE.toLowerCase();
    if (!confirmCellEditOrRevert(e, `Set the registration link to "${e.value}"?`,
      hiding
        ? 'Upcoming calendar events will stop showing a registration link. The forms keep working — ' +
          'you hand the link out yourself from the program dashboard.\n\n' +
          'Events already in the calendar keep their link until you run ' +
          '"🔗 Rewrite Event Links" from the Admin menu.'
        : 'Upcoming calendar events will show a "📝 Register for ..." link at the top of their ' +
          'description.\n\nEvents already in the calendar are updated on the next sync, or straight ' +
          'away with "🔗 Rewrite Event Links" from the Admin menu.')) {
      // Reverted — the cache must reflect the value actually on the sheet.
      invalidateConfigCaches();
      return;
    }
    toastIfPossible(`Registration link set to "${e.value}". Run "🔗 Rewrite Event Links" to apply it to existing events.`);
  }

  // Turning invitations ON is the one Config change that reaches members'
  // inboxes, so it asks — and says how many people are about to hear from
  // Google. Turning it OFF needs no confirmation: stopping is always safe.
  const isInviteEdit = editedCol === CONFIG_LAYOUT.CALENDAR_INVITES.startCol &&
    e.range.getRow() === CONFIG_DATA_START_ROW;
  if (isInviteEdit) {
    const turningOn = String(e.value || '').trim().toLowerCase() === CALENDAR_INVITE_OPTIONS.INVITE.toLowerCase();
    if (turningOn && !confirmCellEditOrRevert(e, 'Start sending calendar invitations?',
      'From the next sync, everyone actively registered for an UPCOMING session who gave an email address ' +
      'is added as a guest on that session\'s calendar event — and Google emails each of them an ' +
      'invitation.\n\nThey are removed again (and emailed about that) if their registration is cancelled. ' +
      'Nothing is sent for sessions that have already happened.')) {
      invalidateConfigCaches(); // reverted — the cache must match the sheet
      return;
    }
    toastIfPossible(turningOn
      ? 'Calendar invitations on. Use "📧 Invite Registrants to Calendar Events" to send them now.'
      : 'Calendar invitations off — no guests will be added or removed.');
  }

  // The horizon decides what the public can see and sign up for, across every
  // program at once, so it says out loud what the date about to be typed will
  // do — including the case that surprises people: a date in the PAST closes
  // everything.
  const isHorizonEdit = editedCol === CONFIG_LAYOUT.REGISTRATION_HORIZON.startCol &&
    e.range.getRow() === CONFIG_DATA_START_ROW;
  if (isHorizonEdit) {
    const raw = String(e.value || '').trim();
    const parsed = raw ? coerceRegistrationHorizonDate(e.range.getValue()) : null;

    if (raw && !parsed) {
      // Not a date. Refused outright rather than confirmed: left in place it
      // reads as "no horizon" (see getRegistrationHorizonKey()), so somebody
      // who typed "September" would believe registration was held back when it
      // was wide open.
      e.range.setValue(e.oldValue === undefined ? '' : e.oldValue);
      invalidateConfigCaches();
      toastIfPossible(`"${raw}" isn't a usable date — Registration Open Through was left as it was. ` +
        'Enter a full date like 9/15/2026 (a bare year reads as 1905), or clear the cell.');
      return;
    }

    const detail = parsed
      ? `Registration will be open through ${formatDateLabel(parsed)}.\n\n` +
        'Sessions on or before that date are unaffected. Sessions AFTER it are not open yet: their ' +
        `calendar events will say "${REGISTRATION_NOT_OPEN_LINE}" instead of showing a register link, and ` +
        'any form whose remaining sessions are all past that date will stop accepting responses.\n\n' +
        'Nothing is deleted — move the date forward or clear the cell and it all comes back on the next ' +
        'sync. Existing events are updated on the next sync, or straight away with ' +
        '"🔗 Rewrite Event Links" from the Admin menu.'
      : 'Clearing this opens registration for EVERY session again: register links go back on their ' +
        'calendar events, and any form closed only because it was past the horizon re-opens on the ' +
        'next sync.';
    if (!confirmCellEditOrRevert(e, parsed ? `Open registration through ${formatDateLabel(parsed)}?` : 'Remove the registration horizon?', detail)) {
      invalidateConfigCaches(); // reverted — the cache must match the sheet
      return;
    }
    invalidateConfigCaches(); // the horizon just moved; anything read after this must see the new one
    toastIfPossible(parsed
      ? `Registration open through ${formatDateLabel(parsed)}. Run Sync Cal, or "🔗 Rewrite Event Links", to apply it now.`
      : 'Registration horizon cleared — every session is open again from the next sync.');
  }

  // Any Config edit can invalidate a cached read of it, confirmed or not.
  invalidateConfigCaches();
}

/**
 * A 0-based { headerName: index } map read off the table's OWN header row,
 * falling back to the canonical array when the sheet's row can't supply one.
 *
 * An onEdit handler has to trust the sheet, not the constant: right after a
 * HEADERS layout changes, the tab still holds the previous order until its
 * next render, and a map built from the constant would flip Manual_Override
 * on top of whatever column now sits at that index.
 */
function getLiveHeaderMap(sheet, headerRow, headers) {
  const sheetMap = getHeaderMapAt(sheet, headerRow);
  const map = {};
  headers.forEach(h => { if (sheetMap[h]) map[h] = sheetMap[h] - 1; });
  return map['Manual_Override'] === undefined ? getIndexMap(headers) : map;
}

/**
 * Shared auto-flip: given a { headerName: 0-based index } map for whatever
 * table the edit landed in, flips that row's Manual_Override to "Manually
 * Edited" — unless the edit WAS to Manual_Override or Event_ID themselves.
 */
function autoFlipManualOverride(sheet, headerMap0Based, editedRow, editedCol1Based) {
  const overrideCol = headerMap0Based['Manual_Override'];
  if (overrideCol === undefined) return;
  const overrideCol1Based = overrideCol + 1;
  if (editedCol1Based === overrideCol1Based) return;
  const eventIdCol = headerMap0Based['Event_ID'];
  if (eventIdCol !== undefined && editedCol1Based === eventIdCol + 1) return;

  const cell = sheet.getRange(editedRow, overrideCol1Based);
  const current = String(cell.getValue()).trim();
  if (current === 'Auto-Synced' || current === '') {
    cell.setValue('Manually Edited');
    invalidateSectionedRowsCache(sheet);
  }
}

/** Registrant_Dash: auto-flip on any hand-edit within a data zone, plus status-change toasts. */
function handleRegistrantsEdit(e, sheet) {
  const editedRow = e.range.getRow();
  const editedCol = e.range.getColumn();

  const zones = getSectionZones(sheet, 'Event_ID');
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Registrant_Dash);
  autoFlipManualOverride(sheet, headerMap, editedRow, editedCol);

  // Computed from the RANGE, not just its top-left cell, so a fill-down or a
  // paste over a block of statuses recalculates too — those are how somebody
  // cancels a whole table's worth of people at once, which is exactly when the
  // catering number matters most.
  const lastCol = editedCol + e.range.getNumColumns() - 1;
  const rangeCovers = name => headerMap[name] !== undefined &&
    headerMap[name] + 1 >= editedCol && headerMap[name] + 1 <= lastCol;
  const countingColumnsEdited = rangeCovers('Program_Status') || rangeCovers('Lunch_Status');

  if (typeof e.value !== 'undefined') {
    const isProgramStatusCol = editedCol === headerMap['Program_Status'] + 1;

    // Lunch_Served no longer implies Attended, on a direct edit any more than
    // through the Quick Mark dialog — one rule, wherever the tick happens. A
    // member can get a take-out meal without ever attending the session, so
    // ticking Lunch here marks lunch only; tick Attended separately for a
    // normal dine-in mark.

    if (isProgramStatusCol && e.oldValue === 'Waitlisted' && e.value === 'Active') {
      toastIfPossible("🚀 Promoted off the waitlist — set their Lunch_Status to 'Needed' if they want a meal.");
    }
  }

  // The catering numbers are recomputed HERE, not left for the hourly sync.
  //
  // This used to be a toast — "check whether this changes your catering
  // numbers" — which put the arithmetic back on the person who had just done
  // the thing that changed it, and left Master_Lunch_Dashboard showing an
  // order that included somebody who had cancelled, for up to an hour. On the
  // one number in this workbook with a supplier deadline attached, "check it
  // yourself later" was the wrong answer.
  if (countingColumnsEdited) {
    recalculateCateringCounts(sheet, headerMap, editedRow, e.range.getNumRows());
  }
}

/**
 * Rebuilds Master_Lunch_Dashboard (and the session table's Active/Waitlist
 * counts) from the registrant rows as they stand right now, and reports the
 * new lunch number for the date that was just edited.
 *
 * WHY THIS IS SAFE ON THE onEdit PATH, which is the constraint that shaped it:
 * every step is SpreadsheetApp only. buildDashboardRollup() reads three tabs
 * and Config; updateMasterLunchDashboard() writes one; recomputeEventRegistryCounts()
 * writes cells. Nothing here opens a form, touches a calendar, or reads a
 * script property — see onEdit(). protectDerivedColumns(), the one call
 * underneath that needs authorization, already degrades instead of throwing.
 *
 * Any noteForAdmin() raised during the rollup is dropped rather than mailed:
 * MailApp is unavailable here, and the next sync re-derives the same notes
 * anyway from the same data.
 *
 * NOT triggered by Lunch_Served ticks, deliberately. Those happen dozens of
 * times an hour at a sign-in desk, a full dashboard render each would make the
 * tab unusable on the day it is needed most — and Served_Confirmed is a record
 * of what happened, not a number anybody orders against. Only Program_Status
 * and Lunch_Status, which are what change the ORDER, recalculate immediately.
 */
function recalculateCateringCounts(sheet, headerMap, editedRow, numRows) {
  const dateIdx = headerMap['Event_Date'];
  const locationIdx = headerMap['Location'];

  // Read the edited rows' date/location BEFORE the rebuild, to report against.
  const touched = [];
  if (dateIdx !== undefined && locationIdx !== undefined) {
    const width = Math.max(dateIdx, locationIdx) + 1;
    const values = sheet.getRange(editedRow, 1, numRows, width).getValues();
    values.forEach(row => {
      const d = coerceDate(row[dateIdx]);
      const location = String(row[locationIdx] || '').trim();
      if (!d || !location) return;
      const key = `${formatDateKey(d)}|${location}`;
      if (!touched.some(t => t.key === key)) touched.push({ key, date: d, location });
    });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrantRows = getSectionedRows(sheet, HEADERS.Registrant_Dash, 'Event_ID');

    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) {
      // Active_Count / Waitlist_Count / Status on the session table come from
      // the same rows. Leaving those stale while the lunch numbers moved would
      // just relocate the confusion to the other dashboard.
      recomputeEventRegistryCounts(registrySheet, sheet, registrantRows);
    }
    updateMasterLunchDashboard(registrantRows);

    toastIfPossible(describeRecalculatedCounts(touched));
    log(`Catering counts recalculated after a status edit on ${numRows} row(s).`);
    return true;
  } catch (err) {
    // Say so. A silently failed recalculation looks exactly like a correct one
    // that happened to produce the same number.
    log(`⚠️ Could not recalculate the catering counts after a status edit (${err}).`);
    toastIfPossible(`⚠️ Status saved, but the lunch numbers could not be recalculated (${err}). Run "Sync Registrations".`);
    return false;
  }
}

/** "Narberth, Mon Sep 14 — 12 lunches to order now." Reads the freshly-written dashboard. */
function describeRecalculatedCounts(touched) {
  if (touched.length === 0) return 'Catering numbers recalculated ✅';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_DASHBOARD);
  if (!sheet) return 'Catering numbers recalculated ✅';

  // The dashboard was written microseconds ago in this same execution; make
  // sure those writes have landed before reading the number back out of it.
  SpreadsheetApp.flush();

  const headers = HEADERS.Master_Lunch_Dashboard;
  const map = getIndexMap(headers);
  const byKey = {};
  getSectionedRows(sheet, headers, 'Standard_Buffer').forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    byKey[`${formatDateKey(d)}|${String(row[map['Location']] || '').trim()}`] = row;
  });

  const parts = touched.slice(0, 3).map(t => {
    const row = byKey[t.key];
    if (!row) return `${t.location}, ${formatDateLabel(t.date)} — no longer on the lunch schedule`;
    const registered = Number(row[map['Registered_Count']]) || 0;
    const buffers = (Number(row[map['Standard_Buffer']]) || 0) + (Number(row[map['Tester_Buffer']]) || 0);
    // Total_to_Order is a live formula, so it reads back as a formula string
    // here rather than a number — recompute the same sum instead.
    return `${t.location}, ${formatDateLabel(t.date)} — ${registered} registered, ${registered + buffers} to order`;
  });
  const more = touched.length > 3 ? ` (+${touched.length - 3} more date(s))` : '';
  return `✅ Catering numbers updated: ${parts.join(' · ')}${more}`;
}

/** Master_Lunch_Dashboard: only the Full Schedule table (Upcoming/Past zones, marker 'Standard_Buffer') is real, editable data. */
function handleLunchDashboardEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Standard_Buffer');
  const editedRow = e.range.getRow();
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Lunch_Dashboard);
  autoFlipManualOverride(sheet, headerMap, editedRow, e.range.getColumn());
}


