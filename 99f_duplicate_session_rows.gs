// ============================================================================
// 99f. TWO ROWS, ONE SESSION  (the duplicates already on the tab)
// ============================================================================
//
// collapseSessionsByEventId_() (26) is what stops this happening again: one
// session row per Event_ID, however many calendar events fall on the date.
// This file is the other half — the rows written before that rule existed, and
// the read-only check that says whether there are any.
//
// WHY A DUPLICATE HERE IS NEVER BENIGN. An Event_ID is the identity of a
// session to everything downstream: registrants join on it, tombstones match
// on it, capacity is recounted per it, Quick Mark and both door pages look a
// session up by it, and a form response is resolved back through it. Two rows
// carrying one Event_ID therefore do not mean "two sittings" to anything — they
// mean one session counted twice on the tab people read, with the SECOND row's
// counts and status permanently stale, because recomputeCountsForZone() writes
// the answer for that Event_ID once.
//
// WHAT THIS SWEEP DOES NOT TOUCH. Registrants, forms, calendar events and
// tombstones are all left exactly where they are, which is what makes it safe:
// the surviving row keeps the same Event_ID, so every registration that was
// attached to that session is still attached to it afterwards. This is the one
// removal in the workbook that moves nobody to Triage (84 does, and must —
// there the session itself is going).
//
// WHICH ROW SURVIVES. The one carrying the most, resolved column by column
// rather than by picking a winner whole: a row written in a run that could not
// open the form has empty link cells, its twin from a healthier run does not,
// and taking either one whole would throw away what the other knows. See
// mergeDuplicateSessionRows_(). The same additive reading as mergeRegistrantRow
// (85) and mergeMemberRollRows (79), and for the same reason — nothing here can
// tell which row somebody meant.
// ============================================================================

/**
 * Groups the session rows by Event_ID and splits them into the ones to keep
 * and the duplicates to drop. Pure: reads nothing, writes nothing.
 *
 * Returns { keep, drop, groups } — `keep` being every row in tab order with
 * each duplicate set already merged down to one, `drop` the rows that come
 * off, and `groups` a description per Event_ID that held more than one.
 *
 * A row with no Event_ID at all is never a duplicate of anything: it is a
 * hand-typed or half-written row, it is kept, and it is not reported. "Blank"
 * is not an identity two rows can share.
 */
function findDuplicateSessionRows(sessionRows, map) {
  const byId = {};
  const order = [];
  const keep = [];
  const drop = [];
  const groups = [];

  (sessionRows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) { keep.push(row); return; }
    if (!byId[eventId]) { byId[eventId] = []; order.push(eventId); }
    byId[eventId].push(row);
  });

  order.forEach(eventId => {
    const rows = byId[eventId];
    if (rows.length === 1) { keep.push(rows[0]); return; }
    const survivor = mergeDuplicateSessionRows_(rows, map);
    keep.push(survivor);
    rows.slice(1).forEach(row => drop.push(row));
    groups.push({
      eventId,
      count: rows.length,
      title: String(survivor[map['Clean_Title']] || '').trim(),
      location: String(survivor[map['Location']] || '').trim(),
      date: coerceDate(survivor[map['Event_Date']])
    });
  });

  return { keep, drop, groups };
}

/**
 * One row out of several claiming the same Event_ID, merged additively.
 *
 * The FIRST row is the base — it is the earlier one on the tab, which for a
 * date-sorted table is the one the rest of the workbook has been agreeing with
 * — and every later row only ever fills a cell the base left empty. A tick is
 * the one exception, and it is OR-ed: Waitlist_Only is a statement about the
 * date (WAITLIST_ONLY_TAG), and a twin carrying it is somebody having closed
 * this session, not a contradiction of the row that does not.
 *
 * The derived columns are deliberately NOT merged — Active_Count,
 * Waitlist_Count, Remaining_Seats and Status are recomputed from the registrant
 * rows the moment this lands (see removeDuplicateSessionRowsLocked_), and
 * carrying a stale count across would be preserving exactly the wrong half.
 */
function mergeDuplicateSessionRows_(rows, map) {
  const survivor = rows[0].slice();
  const isBlank = v => v === '' || v === null || v === undefined;

  rows.slice(1).forEach(row => {
    Object.keys(map).forEach(header => {
      const i = map[header];
      if (i === undefined) return;
      if (header === 'Waitlist_Only') {
        if (isWaitlistOnlyColumnValue(row[i])) survivor[i] = WAITLIST_ONLY_COLUMN_VALUE;
        return;
      }
      if (isBlank(survivor[i]) && !isBlank(row[i])) survivor[i] = row[i];
    });
  });
  return survivor;
}

/** The lines a person reads about what was found, shared by the report and the confirmation. */
function describeDuplicateSessionRows(found) {
  if (found.groups.length === 0) {
    return 'Every session row on the tab has a date of its own — no duplicates.';
  }
  const lines = found.groups
    .slice()
    .sort((a, b) => (a.date && b.date) ? a.date - b.date : 0)
    .map(g => `  • ${g.date ? formatDateLabel(g.date) : '(no date)'} — ` +
      `${g.title || '(untitled)'}${g.location ? ` (${g.location})` : ''}: ${g.count} rows`);

  return `${found.drop.length} duplicate session row(s) across ${found.groups.length} date(s). ` +
    `Each of these dates is on the tab more than once, under one Event_ID:\n${lines.join('\n')}`;
}

/**
 * READ-ONLY. Says how many session rows are duplicates and on which dates.
 * Ungated like every other read in this workbook — the person who noticed the
 * tab looked wrong is the person who should be able to press it.
 */
function reportDuplicateSessionRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) {
    toastIfPossible('No session table yet — nothing to report.');
    return null;
  }
  const headers = HEADERS.All_Program_Sessions;
  const found = findDuplicateSessionRows(
    getSectionedRowValues(sheet, headers, 'Event_ID'), getIndexMap(headers));

  const report = describeDuplicateSessionRows(found);
  log(report);
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Duplicate Session Rows', report + (found.drop.length > 0
      ? '\n\nNothing was changed. "🧹 Remove Duplicate Session Rows…" is what removes them.\n\n' +
        'Registrations are not affected: the row that stays keeps the same Event_ID, so everyone ' +
        'signed up for these sessions stays signed up for them.'
      : ''), ui.ButtonSet.OK);
  } catch (err) {
    toastIfPossible(`${found.drop.length} duplicate session row(s) — see the log.`);
  }
  return found;
}

/**
 * Removes every session row that repeats an Event_ID another row already
 * carries, merging what each held onto the one that stays.
 *
 * Returns the number of rows removed.
 */
function removeDuplicateSessionRows() {
  if (!requireAuthorizedAdmin('Remove Duplicate Session Rows')) return 0;

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Held for the whole sweep, for the same reason removeOrphanedSessionRows()
  // holds it: this rewrites the session table wholesale, and a sync landing
  // halfway through would be appending rows to a table about to be replaced.
  // Taken here rather than through withScriptLock() so the busy branch can SAY
  // it is busy.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('removeDuplicateSessionRows: another sync is already running — skipping.');
    toastIfPossible('A sync is already running — try again in a moment.');
    return 0;
  }
  try {
    return removeDuplicateSessionRowsLocked_(ss);
  } finally {
    lock.releaseLock();
  }
}

/** The sweep itself, under the script lock. */
function removeDuplicateSessionRowsLocked_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) {
    log('removeDuplicateSessionRows: no session table yet — nothing to remove.');
    return 0;
  }
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  // Formula-preserving: the link columns hold =HYPERLINK(), and this render
  // writes every row back.
  const found = findDuplicateSessionRows(getSectionedRows(sheet, headers, 'Event_ID'), map);

  if (found.drop.length === 0) {
    log('removeDuplicateSessionRows: every Event_ID appears once — nothing to do.');
    toastIfPossible('No duplicate session rows — nothing to remove.');
    return 0;
  }

  // defaultWhenUnattended is false: this must never proceed on a trigger.
  if (!confirmConsequentialAction('Remove duplicate session rows?',
    `${describeDuplicateSessionRows(found)}\n\n` +
    `One row is kept per date, carrying whatever each copy held. Registrations, forms and ` +
    `calendar events are left exactly as they are — the row that stays has the same Event_ID, so ` +
    `nobody comes off a roster.`, false)) {
    return 0;
  }

  renderProgramDashboard(true, { sessionRows: found.keep, skipTriage: true });

  // The counts on the surviving rows were never merged (see
  // mergeDuplicateSessionRows_), so they are recomputed here from the
  // registrant rows that are still exactly where they were.
  try {
    const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
    if (registrantsSheet) recomputeEventRegistryCounts(sheet, registrantsSheet, null);
  } catch (err) {
    log(`⚠️ Duplicate rows removed, but the seat counts could not be recomputed (${err}).`);
    noteForAdmin('Session counts needing a refresh',
      `Duplicate session rows were removed; the seat counts did not recompute — ${err}`);
  }

  log(`removeDuplicateSessionRows: removed ${found.drop.length} duplicate row(s) across ` +
    `${found.groups.length} date(s).`);
  flushAdminDigest('Duplicate session rows');
  toastIfPossible(`Removed ${found.drop.length} duplicate row(s) across ${found.groups.length} date(s).`);
  return found.drop.length;
}
