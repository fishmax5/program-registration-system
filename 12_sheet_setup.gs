// ============================================================================
// 2. SHEET SETUP UTILITY  (initSheet)
// ============================================================================

/**
 * FIRST-TIME setup for a workbook that has nothing in it yet: build every
 * tab, create the template form, install the triggers, and hand off to the
 * calendar import.
 *
 * NOT the right tool for a workbook already carrying data. To roll a layout
 * change onto a live workbook — new columns, a new panel, changed
 * formatting — use rebuildLayoutFromSheet() instead: same redraw, from the
 * rows already on the tabs, with no calendar read, no form write, and no
 * triage pass that could remove a session.
 */
function initSheet() {
  if (!requireAuthorizedAdmin('Initialize sheet setup')) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateLegacySheetNames(ss);

  // NOT deleted here any more. This used to drop Active_Programs outright,
  // discarding whatever was on it — the log line even claimed its data "now
  // lives in" the new tab, which nothing had actually arranged. Leaving it
  // alone means mergeLegacyTabs() can still salvage it; initSheet() has no
  // business destroying the only copy of anything.
  const legacySheet = ss.getSheetByName(LEGACY_ACTIVE_PROGRAMS_SHEET_NAME);
  if (legacySheet) {
    log(`ℹ️ Found the legacy "${LEGACY_ACTIVE_PROGRAMS_SHEET_NAME}" tab. It is left untouched — ` +
      `run mergeLegacyTabs() to fold its rows into "${SHEET_NAMES.PROGRAM_DASHBOARD}" and remove it.`);
    noteForAdmin('Leftover tabs',
      `"${LEGACY_ACTIVE_PROGRAMS_SHEET_NAME}" is still in the workbook — run mergeLegacyTabs() to merge and clear it.`);
  }

  buildConfigSheet(ss);
  initLunchScheduleSheet(ss);

  try {
    getOrCreateTemplateForm();
  } catch (err) {
    log(`⚠️ Could not build/verify the template registration form during setup (${err}) — it will be retried on the next calendar sync.`);
  }

  renderRegistrantsSheet(true);
  renderTriageSheet(true);

  initPlaceholderSheet(ss, SHEET_NAMES.LUNCH_DASHBOARD, 'Run "Sync Registrations" from the menu to populate this dashboard.');
  initPlaceholderSheet(ss, SHEET_NAMES.LUNCH_ROSTER, 'Run "Sync Registrations" from the menu to populate the lunch name list.');

  renderProgramDashboard(true);
  refreshMemoryTabs(null, null); // builds Member_Roll / Program_Options, empty on a fresh workbook
  renderClubMembersSheet([]);   // and the (empty) club roster, so its columns exist from day one
  // Both empty on a fresh workbook, and both need their columns and dropdowns
  // to exist before anybody can use them — a tab staff are told to type into
  // has to be there before they are told.
  renderProgramQuestionsSheet([]);
  renderAssistanceRequestsSheet([]);
  renderRegularNeedsSheet([]);   // the standing-needs tab, empty but ready to type into
  warmQuickMarkIndexCache();     // and Quick Mark's lists, so its first open is instant

  writeTriggers();
  reorderTabs(ss);

  toastIfPossible('Sheet setup complete ✅ — next: "Import Everything (First Run)".');
  log('initSheet complete.');
}

/**
 * REBUILD EVERY TAB INTO THE CURRENT LAYOUT, USING ONLY WHAT IS ALREADY IN
 * THE WORKBOOK. No calendar, no forms, no Drive, no network at all.
 *
 * The problem this exists for: shipping a layout change to a workbook that is
 * already carrying a year of real data. initSheet() rebuilds the tabs, but a
 * calendar sync is the normal partner to it, and on a busy calendar that is
 * slow, quota-hungry, and — via triageDeletedSessions() — the one path in the
 * system that can REMOVE sessions and shunt their registrants to triage. None
 * of that is wanted when the only thing that actually changed is where the
 * columns sit.
 *
 * So this is the same rebuild with every outward-facing step removed:
 *
 *   REBUILT (from the rows already on each tab)
 *     Config (older layouts are backed up, current ones kept as-is)
 *     All_Program_Sessions    — with triage OFF
 *     All_Registrants             — the tables only; Quick Mark is a dialog
 *     Deleted_Event_Triage
 *     Lunch_Schedule              — including the new ADD block
 *     Master_Lunch_Dashboard      — recomputed; hand-entered columns kept
 *     All_Lunch_Registrants                — rebuilt with it, from the same rollup
 *     Member_Roll / Program_Options — staff columns never touched
 *     Tab order, column widths, dropdowns, conditional formatting
 *
 *   NOT TOUCHED
 *     The calendars.       Nothing is read from or written to them.
 *     The registration forms. No form is opened, created, or relabelled.
 *     The triggers.        Automation keeps running exactly as it was.
 *     The template form.   Not created or version-checked.
 *
 * EVERY ROW IS READ BEFORE ANY TAB IS CLEARED. Each render is otherwise a
 * read-then-clear-then-write on its own tab, which is fine in isolation, but
 * reading up front also means the confirmation dialog can state real counts —
 * and a dialog that says "1,240 registrant rows" is one somebody can actually
 * check before agreeing to it.
 *
 * Safe to run repeatedly. Nothing here is order-dependent on a sync having
 * happened, and running it twice produces the same workbook.
 */
function rebuildLayoutFromSheet() {
  if (!requireAuthorizedAdmin('Rebuild Layout (from sheet)')) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateLegacySheetNames(ss);

  const read = (name, headers, marker) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return [];
    try {
      return name === SHEET_NAMES.LUNCH_SCHEDULE
        ? readLunchScheduleRows(sheet)
        : getSectionedRows(sheet, headers, marker);
    } catch (err) {
      log(`⚠️ Rebuild: could not read "${name}" (${err}) — treating it as empty.`);
      return [];
    }
  };

  const sessionRows = read(SHEET_NAMES.PROGRAM_DASHBOARD, HEADERS.All_Program_Sessions, 'Event_ID');
  const registrantRows = read(SHEET_NAMES.REGISTRANT_DASH, HEADERS.All_Registrants, 'Event_ID');
  const triageRows = read(SHEET_NAMES.TRIAGE, HEADERS.Deleted_Event_Triage, 'Event_ID');
  const menuRows = read(SHEET_NAMES.LUNCH_SCHEDULE, HEADERS.Lunch_Schedule, 'Event_Date');

  // A workbook with no sessions has nothing to rebuild FROM, and quietly
  // producing a set of correctly-formatted empty tabs would look like success
  // while destroying the "wait, where did everything go?" signal.
  if (sessionRows.length === 0 && registrantRows.length === 0 && menuRows.length === 0) {
    const message = 'Nothing to rebuild from — this workbook has no sessions, registrants or menu rows yet. ' +
      'Use "Import Everything (First Run)" to bring the calendar in.';
    log(`rebuildLayoutFromSheet: ${message}`);
    toastIfPossible(message);
    return null;
  }

  if (!confirmConsequentialAction('Rebuild every tab from the data already here?',
    `Found: ${sessionRows.length} session(s), ${registrantRows.length} registrant row(s), ` +
    `${triageRows.length} triaged row(s), ${menuRows.length} menu row(s).\n\n` +
    'Every tab is redrawn in the current layout using exactly these rows. ' +
    'Your hand-entered columns, notes and manual rows are all kept.\n\n' +
    'The calendars, the registration forms and the automatic triggers are NOT touched — ' +
    'nothing outside this spreadsheet changes, and no session can be removed.', false)) {
    return null;
  }

  toastIfPossible('Rebuilding every tab from the data already here…');

  buildConfigSheet(ss);

  // Triage OFF — see renderProgramDashboard(). This is what makes the whole
  // operation calendar-free, and it is the single most important line here.
  renderProgramDashboard(true, { sessionRows, skipTriage: true, registrantRows });

  renderRegistrantsSheet(true, registrantRows);
  renderTriageSheet(true, triageRows);
  renderLunchScheduleSheet(true, menuRows);

  // After the tabs above, in this order, on purpose:
  //  - counts are recomputed from the registrant rows onto the session table;
  //  - the lunch dashboard reads the menu index, which only becomes correct
  //    once Lunch_Schedule has been rewritten (renderLunchScheduleSheet()
  //    invalidates that cache);
  //  - the memory tabs are derived from both of the tabs above them.
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (registrySheet && registrantsSheet) {
    recomputeEventRegistryCounts(registrySheet, registrantsSheet, registrantRows);
  }
  updateMasterLunchDashboard(registrantRows);
  refreshMemoryTabs(registrantRows, sessionRows);
  // Redrawn from its own rows, exactly like every other tab here — the roster
  // is data staff own, so a layout rebuild must preserve it verbatim.
  renderClubMembersSheet(refreshClubMemberLabels(sessionRows));
  // Same treatment, same reason: both are tabs staff type into, so a layout
  // rebuild re-draws them from their own rows and changes nothing in them.
  renderProgramQuestionsSheet();
  renderAssistanceRequestsSheet();
  renderRegularNeedsSheet();
  // Built here so the first Quick Mark after a layout rebuild is the fast one.
  warmQuickMarkIndexCache();

  reorderTabs(ss);

  const summary = `Rebuilt from existing data ✅ — ${sessionRows.length} session(s), ` +
    `${registrantRows.length} registrant row(s), ${menuRows.length} menu row(s). ` +
    `Calendars, forms and triggers untouched.`;
  log(`rebuildLayoutFromSheet: ${summary}`);
  toastIfPossible(summary);
  return { sessionRows: sessionRows.length, registrantRows: registrantRows.length, menuRows: menuRows.length };
}

/**
 * Builds/refreshes the day-by-day, per-location Lunch_Schedule tab. If an
 * older Month-based (no Location) layout is found, it's renamed to a
 * timestamped backup instead of being destroyed.
 */
function initLunchScheduleSheet(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  if (sheet && sheet.getRange(1, 1).getValue() === 'Month') {
    const backupName = `Lunch_Schedule_OLD_${Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss')}`;
    sheet.setName(backupName);
    log(`⚠️ Existing Lunch_Schedule tab used the older Month-based layout — renamed to "${backupName}". ` +
      `The new tab tracks one row per date PER LOCATION (with a "Not Serving" Type option) — please migrate anything you still need.`);
  }
  renderLunchScheduleSheet(true);
}

/** Puts tabs in a logical, at-a-glance order. */
