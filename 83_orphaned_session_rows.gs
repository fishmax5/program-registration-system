// ============================================================================
// 83. SESSION ROWS WHOSE CALENDAR IS GONE  (removeOrphanedSessionRows)
// ============================================================================
//
// triageDeletedSessions() (43_program_dashboard.gs) removes a session whose
// calendar EVENT disappeared. It cannot remove a session whose whole CALENDAR
// disappeared, and that is deliberate: its first safety rule is "a row I
// cannot attribute to a calendar I just read is left alone", which is exactly
// what stops one unreadable calendar from cancelling every program at that
// location. 39_triage_sheet.gs is the tab that case lands on, and it is a
// different case — an event the calendar stopped mentioning, not a calendar
// this workbook stopped reading.
//
// The consequence is a residue nothing else reaches. When a location's
// calendar is retired, recreated, or repointed at a new ID, the old rows keep
// a Calendar_Source that is no longer in CALENDAR_MAP — so triage skips them
// on every run, forever, while the same programs re-import under the new ID as
// new rows beside them. All_Program_Sessions then carries two rows per
// session, one live and one that was on a calendar once and is not anymore,
// with the older registrants joined to the dead half.
//
// WHAT COUNTS AS ORPHANED is deliberately narrow: a row is swept only when its
// Calendar_Source is set (so no lunch row and no hand-added row is ever in
// scope — that blank is the same thing keeping triage off the meals) AND names
// a calendar this workbook is not configured to read at all. Nothing in here
// reads a calendar, so nothing in here can be fooled by a calendar that failed
// to load: a CONFIGURED calendar's rows are never touched, however this
// particular run happened to go. That is the whole difference between this and
// triage, and it is why this one needs no size limit — where triage refuses a
// sweep that is most of the table, "most of the table" is precisely what a
// retired location legitimately looks like.
//
// A DELETED PAST SESSION IS NOT ORPHANED. Rows older than the sync window
// whose events are long gone are history, and history is the point of the Past
// sub-table. This sweep is about a calendar that left, not a date that did.
//
// MENU-ONLY, NEVER A TRIGGER. Retiring a calendar is something a person did on
// purpose, so a person is present to confirm it. With no safety fraction to
// fall back on, the confirmation names every calendar ID with its row count,
// its programs and its date span instead — which is the reading actually worth
// doing before saying yes.
//
// Numbered last for the usual reason: renumbering an existing file is the one
// edit this project cannot make. Safe there — behavior only, it declares no
// constant anything else derives from, and everything it calls (CALENDAR_MAP,
// HEADERS, renderProgramDashboard, moveRegistrantsToTriage) it reaches through
// a hoisted function or reads at CALL time, never at load time.
// ============================================================================

/**
 * Pure. Splits session rows into the ones whose Calendar_Source names a
 * calendar this workbook still knows about, and the ones it does not.
 *
 * `knownCalendarIds` (a Set or an array) is passed in rather than read from
 * CALENDAR_MAP so this is testable, and so the CALLER is the one that has to
 * decide what an empty list means — see removeOrphanedSessionRows().
 *
 * Returns { keep, orphans, byCalendar }, where byCalendar is
 * { calendarId: { rows, titles, earliest, latest } } — the breakdown the
 * report and the confirmation prompt are both written from.
 */
function findOrphanedSessionRows(sessionRows, map, knownCalendarIds) {
  const known = new Set(knownCalendarIds instanceof Set
    ? Array.from(knownCalendarIds) : (knownCalendarIds || []));
  const keep = [];
  const orphans = [];
  const byCalendar = {};

  (sessionRows || []).forEach(row => {
    const source = String(row[map['Calendar_Source']] || '').trim();
    // No Calendar_Source at all is a lunch row or a row somebody typed.
    // Neither ever came from a calendar, so neither can have lost one.
    if (!source || known.has(source)) { keep.push(row); return; }

    orphans.push(row);
    const bucket = byCalendar[source] ||
      (byCalendar[source] = { rows: [], titles: [], earliest: null, latest: null });
    bucket.rows.push(row);

    const title = String(row[map['Clean_Title']] || '').trim();
    if (title && bucket.titles.indexOf(title) === -1) bucket.titles.push(title);

    const d = coerceDate(row[map['Event_Date']]);
    if (d) {
      if (!bucket.earliest || d < bucket.earliest) bucket.earliest = d;
      if (!bucket.latest || d > bucket.latest) bucket.latest = d;
    }
  });

  return { keep, orphans, byCalendar };
}

/**
 * How many program titles a calendar's line names before it starts counting.
 * The point of the list is recognition — "oh, that is the Ashbridge lot" — and
 * six is enough for that where a hundred would push the calendar IDs, which
 * are the actual identifiers, off the top of a dialog nobody can scroll.
 */
const ORPHAN_REPORT_TITLES_SHOWN = 6;

/**
 * Pure. The human-readable breakdown, shared by the read-only report and the
 * confirmation prompt so the two can never describe different sweeps.
 *
 * NAMES THE CALENDAR ID IN FULL. It is ugly, and it is the only thing that
 * identifies WHICH retired calendar these rows are from — the location name on
 * the rows is very often the name of the LIVE calendar that replaced it.
 */
function describeOrphanedSessionRows(found) {
  const ids = Object.keys(found.byCalendar);
  if (ids.length === 0) {
    return 'No session rows are left over from a retired calendar — nothing to remove.';
  }

  const lines = ids.map(id => {
    const bucket = found.byCalendar[id];
    const span = bucket.earliest
      ? `${formatDateLabel(bucket.earliest)} – ${formatDateLabel(bucket.latest)}`
      : 'no readable dates';
    const shown = bucket.titles.slice(0, ORPHAN_REPORT_TITLES_SHOWN).join(', ');
    const more = bucket.titles.length > ORPHAN_REPORT_TITLES_SHOWN
      ? `, +${bucket.titles.length - ORPHAN_REPORT_TITLES_SHOWN} more` : '';
    return `  • ${id}\n      ${bucket.rows.length} row(s), ${bucket.titles.length} program(s), ${span}\n` +
      `      ${shown || '(untitled)'}${more}`;
  });

  return `${found.orphans.length} session row(s) belong to ${ids.length} calendar(s) this workbook ` +
    `no longer reads:\n${lines.join('\n')}`;
}

/** The session rows and their index map, read once, for either half of this sweep. */
function readSessionRowsForOrphanScan_(ss, preserveFormulas) {
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return null;
  const headers = HEADERS.All_Program_Sessions;
  return {
    sheet,
    map: getIndexMap(headers),
    rows: preserveFormulas
      ? getSectionedRows(sheet, headers, 'Event_ID')
      : getSectionedRowValues(sheet, headers, 'Event_ID')
  };
}

/**
 * READ-ONLY. Says how many session rows are left over from a retired calendar,
 * and from which. Changes nothing — this is the measurement that comes before
 * the decision, the same pairing as previewLegacyTabMerge() before a merge,
 * and it is ungated for the same reason every other read in this workbook is.
 */
function reportOrphanedSessionRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const table = readSessionRowsForOrphanScan_(ss, false);
  if (!table) {
    log('reportOrphanedSessionRows: no session table yet — nothing to report.');
    toastIfPossible('No session table yet — nothing to report.');
    return null;
  }

  const found = findOrphanedSessionRows(table.rows, table.map, Object.keys(CALENDAR_MAP));

  const configured = Object.keys(CALENDAR_MAP)
    .map(id => `  • ${id} — ${CALENDAR_MAP[id]}`).join('\n');
  const report = `${describeOrphanedSessionRows(found)}\n\nCalendars this workbook DOES read:\n${configured}`;

  log(report);
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Leftover Calendar Rows', report + (found.orphans.length > 0
      ? '\n\nNothing was changed. "🧹 Remove Leftover Calendar Rows…" is what removes them.'
      : ''), ui.ButtonSet.OK);
  } catch (err) {
    toastIfPossible(`${found.orphans.length} leftover row(s) from retired calendar(s) — see the log.`);
  }
  return found;
}

/**
 * Removes every session row whose calendar this workbook no longer reads, and
 * routes their registrants to Triage rather than deleting them.
 *
 * Run from 🔧 Admin → ⚠️ Destructive after repointing or retiring a calendar.
 * Returns the number of rows removed.
 */
function removeOrphanedSessionRows() {
  if (!requireAuthorizedAdmin('Remove Leftover Calendar Rows')) return 0;

  const configured = Object.keys(CALENDAR_MAP);
  // The one reading that would make EVERY calendar-derived row an orphan.
  // CALENDAR_MAP is a literal in 01_logging_and_access.gs, so an empty one can
  // only mean somebody is mid-edit — and "the config is empty" is not evidence
  // that the sessions are.
  if (configured.length === 0) {
    log('removeOrphanedSessionRows: CALENDAR_MAP is empty — refusing to read every row as leftover.');
    toastIfPossible('No calendars are configured — nothing was removed.');
    return 0;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Held for the whole sweep, for the same reason a sync holds it: this
  // rewrites the session table, the Registrants tab and the Triage tab, and a
  // sync landing halfway through would be appending rows to a table this is
  // about to replace wholesale. Taken here rather than through withScriptLock()
  // so the busy branch can SAY it is busy — that helper's onBusy is a value,
  // and a value cannot log only when the lock was refused.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('removeOrphanedSessionRows: another sync is already running — skipping.');
    toastIfPossible('A sync is already running — try again in a moment.');
    return 0;
  }
  try {
    return removeOrphanedSessionRowsLocked_(ss);
  } finally {
    lock.releaseLock();
  }
}

/** The sweep itself, under the script lock. Returns the number of rows removed. */
function removeOrphanedSessionRowsLocked_(ss) {
  const table = readSessionRowsForOrphanScan_(ss, true);
  if (!table) {
    log('removeOrphanedSessionRows: no session table yet — nothing to remove.');
    return 0;
  }
  const map = table.map;
  const found = findOrphanedSessionRows(table.rows, map, Object.keys(CALENDAR_MAP));

  if (found.orphans.length === 0) {
    log('removeOrphanedSessionRows: every session row belongs to a configured calendar — nothing to do.');
    toastIfPossible('No leftover calendar rows — nothing to remove.');
    return 0;
  }

  // defaultWhenUnattended is false: this must never proceed on a trigger.
  if (!confirmConsequentialAction('Remove leftover calendar rows?',
    `${describeOrphanedSessionRows(found)}\n\n` +
    `These rows come off "${SHEET_NAMES.PROGRAM_DASHBOARD}". Their registrants are MOVED to ` +
    `"${SHEET_NAMES.TRIAGE}" — not deleted — and the forms behind them are left alone.`, false)) {
    return 0;
  }

  // Registrants first, off the rows while they still exist to be attributed.
  const deletedEventInfo = {};
  found.orphans.forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return; // removed anyway; there is just nothing to join on
    deletedEventInfo[eventId] = {
      cleanTitle: row[map['Clean_Title']],
      location: row[map['Location']]
    };
  });
  if (Object.keys(deletedEventInfo).length > 0) {
    moveRegistrantsToTriage(getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), deletedEventInfo, {
      triageNote: 'The calendar this session came from is no longer connected to this workbook — ' +
        'check whether the program moved to another calendar before contacting the registrant.',
      adminHeading: 'Sessions removed with their retired calendar',
      adminReason: 'its calendar is no longer connected to this workbook; its registrants are in triage'
    });
  }

  // The ordinary render, handed the survivors. skipTriage because this sweep
  // has already decided what goes, and a calendar read here could only take
  // out MORE rows than the human just approved.
  renderProgramDashboard(true, { sessionRows: found.keep, skipTriage: true });

  // Only forms that still have sessions on them. A form whose every row was on
  // the retired calendar belongs to that calendar too, and pushing it an empty
  // date list would edit a live form for a program this workbook has just
  // stopped tracking — which is not this sweep's business.
  const keptFormIds = new Set(found.keep
    .map(row => String(row[map['Form_ID']] || '').trim()).filter(Boolean));
  const affectedFormIds = new Set();
  found.orphans.forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    if (formId && keptFormIds.has(formId)) affectedFormIds.add(formId);
  });
  if (affectedFormIds.size > 0) {
    try {
      refreshFormDateListsForForms(found.keep, map, affectedFormIds);
    } catch (err) {
      // The rows are already gone and that was the point; a form left showing
      // one extra date is a smaller problem than a half-done sweep.
      log(`⚠️ Rows removed, but ${affectedFormIds.size} form date list(s) could not be refreshed (${err}).`);
      noteForAdmin('Forms needing a date refresh',
        `${affectedFormIds.size} form(s) still list a date whose row was removed — ${err}`);
    }
  }

  const calendarCount = Object.keys(found.byCalendar).length;
  log(`removeOrphanedSessionRows: removed ${found.orphans.length} session row(s) from ` +
    `${calendarCount} retired calendar(s): ${Object.keys(found.byCalendar).join(', ')}.`);
  flushAdminDigest('Leftover calendar rows');
  toastIfPossible(`Removed ${found.orphans.length} leftover row(s) from ${calendarCount} retired calendar(s).`);
  return found.orphans.length;
}
