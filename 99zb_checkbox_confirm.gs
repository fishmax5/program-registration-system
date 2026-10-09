// ============================================================================
// A TICK BOX ASKS BEFORE IT COUNTS (99zb)
// ============================================================================
// A check box is the easiest cell in the workbook to change by accident: one
// click, no typing, no Enter, and on a trackpad or a tablet a scroll that
// lands on the wrong spot is a click. Every other consequential edit here
// already asks first (confirmCellEditOrRevert, 01) — a Type_Tag, a Leader, a
// registration horizon — while a tick that marks somebody attended, cancels a
// meal or closes a date to new registrations went straight through with only a
// toast to say so.
//
// So onEdit (18) asks this FIRST, before any per-tab handler sees it:
// declining puts the box back and the handler never runs, so nothing
// downstream ever acts on the accident.
//
// ONLY FOR THE TICKS THAT MATTER (R3, docs/transitions/R3_checkbox_confirm.md).
// It used to ask on every check box on every tab, and the commonest click in
// the building — Attended on All_Registrants — cost a dialog every time, which
// trains people to press Yes without reading and so protects nothing. Now it
// asks only for a column on CHECKBOX_CONFIRM_COLUMNS: ticks that LEAVE THE
// WORKBOOK (a calendar tag, an invitation, an email, a shared sheet) or are
// HARD TO UNDO (a cancellation, a waitlisting, a club booking). Everything
// else is undone by clicking it again and goes straight through, which is
// what happened before this file existed.
//
// The column is matched by HEADER NAME, never by letter: the nearest header
// cell above the edited one in the same column, which is right in both
// sectioned zones (Upcoming and Past each carry their own header row) and on
// the memory tabs alike. That one read happens only after the cheap checks.
//
// "Don't ask for 5 minutes" is the Cancel button. Google's alert offers fixed
// buttons only (Yes / No / Cancel), so the message says what each one means.
// The snooze is per USER (the user cache), so one person snoozing does not
// silence the tablet at the other building, and it lapses by itself —
// CacheService's own expiry is the timer.
//
// Deliberately NOT asked:
//   - a column not on the list;
//   - a multi-cell edit (paste, fill-down, Space over a selection): it has no
//     oldValue to restore and is a deliberate act, not a slip;
//   - a cell that merely holds TRUE/FALSE without check-box validation;
//   - no UI (a script writing the cell never fires onEdit anyway).
// Club_Members' Active is asked on the TICK only: its untick already asks
// "cancel their upcoming bookings?" itself (cancelUpcomingClubRegistrations,
// 41), and two pop-ups for one click is how a confirmation becomes a reflex.
// ============================================================================

const CHECKBOX_CONFIRM_SNOOZE_SECONDS = 5 * 60;
const CHECKBOX_CONFIRM_SNOOZE_KEY = 'CHECKBOX_CONFIRM_SNOOZED_V1';

/**
 * THE ALLOW-LIST. One entry per tab × column whose tick is worth a question:
 *
 *   tab     the tab's name (SHEET_NAMES)
 *   column  the header, as it is spelled in HEADERS for that tab
 *   ask     'both', 'tick' or 'untick' — which direction is consequential
 *   why     one sentence, shown in the dialog: what the tick sets in motion
 *
 * Lazy because it is built from PROGRAM_FLAG_COLUMNS / SESSION_FLAG_COLUMNS
 * (02), NOTIFICATION_CHECKBOX_COLUMNS (81) and SHEET_NAMES (03). To add a
 * column, add an entry with its reason; tests/checkbox_confirm.test.js checks
 * every entry names a real column of its tab. What was considered and left
 * OFF, and why, is in docs/transitions/R3_checkbox_confirm.md.
 */
defineLazyGlobal_('CHECKBOX_CONFIRM_COLUMNS', () => {
  const entries = [];
  const add = (tab, column, ask, why) => entries.push({ tab, column, ask, why });

  // Program flags: a tag onto EVERY calendar event of the program (the
  // installable trigger delivers it at once), and different forms next sync.
  PROGRAM_FLAG_COLUMNS.forEach(flag => {
    const why = `This writes or removes [${flag.tag}] on every calendar event of this program, ` +
      'and changes how its registration forms work.';
    add(SHEET_NAMES.PROGRAM_DASHBOARD, flag.column, 'both', why);
    add(SHEET_NAMES.PROGRAM_MONTH, flag.column, 'both', why);
  });
  // Waitlist_Only: one date's calendar event, and that date closed to new
  // Active registrations.
  SESSION_FLAG_COLUMNS.forEach(flag => {
    add(SHEET_NAMES.PROGRAM_DASHBOARD, flag.column, 'both',
      `This writes or removes [${flag.tag}] on this date's calendar event, and decides whether ` +
      'new sign-ups for it go on the waitlist.');
  });
  // Registrant notifications: invitations and reminder emails to every
  // registrant. Google emails a guest the moment they are added, so an
  // invitation cannot be taken back.
  NOTIFICATION_CHECKBOX_COLUMNS.forEach(column => {
    add(SHEET_NAMES.PROGRAM_SETTINGS, column, 'both',
      column === 'Add_Guest_To_Calendar'
        ? 'This decides whether registrants are invited to the calendar event — Google emails them the moment they are added.'
        : 'This decides whether registrants of this program are sent this email.');
  });
  // A leader who asked to hear: emails, and a roster sheet built and SHARED.
  add(SHEET_NAMES.PROGRAM_LEADERS, 'Notify_Roster_Changes', 'both',
    'This decides whether this leader is emailed about the roster and given a shared roster sheet.');
  // The two leader ticks the import acts on (71): a cancellation that gives
  // the seat away, and a waitlisting whose undo needs a seat still free.
  add(SHEET_NAMES.REGISTRANT_DASH, 'Dropped', 'both',
    'On the next sync a ticked upcoming registration is CANCELLED and its seat given away.');
  add(SHEET_NAMES.REGISTRANT_DASH, 'Waitlisted', 'both',
    'On the next sync this person is moved to the waitlist; unticking only puts them back if a seat is still free.');
  // A standing place: booked into every upcoming session on the next sync.
  // The untick asks its own question (41), so only the tick is asked here.
  add(SHEET_NAMES.CLUB_MEMBERS, 'Active', 'tick',
    'On the next sync this person is booked into every upcoming session of this club.');
  return entries;
});

/**
 * Asks before a single check-box click is allowed to stand. Returns true when
 * the edit should go on to its handler, false when it was undone.
 * Never throws: a confirmation that breaks must not break the edit.
 */
function confirmCheckboxEditOrRevert(e) {
  try {
    if (!isSingleCheckboxClick_(e)) return true;
    const ticking = String(e.value).toUpperCase() === 'TRUE';
    const entry = checkboxConfirmEntryFor_(e, ticking);
    if (!entry) return true;
    if (checkboxConfirmSnoozed_()) return true;

    let ui;
    try { ui = SpreadsheetApp.getUi(); } catch (err) { return true; }
    if (!ui) return true;

    const where = describeCheckboxCell_(e);
    const response = ui.alert(
      ticking ? `Tick ${entry.column}?` : `Untick ${entry.column}?`,
      `${where}\n\n${entry.why}\n\n` +
      `YES — ${ticking ? 'tick' : 'untick'} it.\n` +
      `NO — put it back the way it was.\n` +
      `CANCEL — ${ticking ? 'tick' : 'untick'} it, and don't ask again for 5 minutes.`,
      ui.ButtonSet.YES_NO_CANCEL);

    if (response === ui.Button.YES) return true;
    if (response === ui.Button.CANCEL) {
      snoozeCheckboxConfirm_();
      return true;
    }

    // NO, or the dialog closed with the ✕: undo. A check box has two states,
    // so the old one is the opposite of the new — which is also right when
    // e.oldValue is missing (the box was blank, i.e. unticked).
    e.range.setValue(!ticking);
    invalidateSectionedRowsCache();
    toastIfPossible('Put back — nothing was changed.');
    return false;
  } catch (err) {
    log(`confirmCheckboxEditOrRevert: ${err} — letting the edit through.`);
    return true;
  }
}

/**
 * The allow-list entry this click falls under, or null when it is not one to
 * ask about. Cheap first (is the tab on the list at all; does the direction
 * matter), and only then the one read that finds the column's header.
 */
function checkboxConfirmEntryFor_(e, ticking) {
  let tab = '';
  try { tab = e.range.getSheet().getName(); } catch (err) { return null; }
  const direction = ticking ? 'tick' : 'untick';
  const candidates = CHECKBOX_CONFIRM_COLUMNS.filter(entry =>
    entry.tab === tab && (entry.ask === 'both' || entry.ask === direction));
  if (candidates.length === 0) return null;
  const header = checkboxHeaderAbove_(e.range);
  if (!header) return null;
  return candidates.filter(entry => entry.column === header)[0] || null;
}

/**
 * The header of the edited cell's column: the nearest cell ABOVE it in the
 * same column holding text. Every cell of a check-box column is a boolean or
 * blank, so the first text found going up is that zone's header row — the
 * Past zone's own when the click is in Past, row 2 on a memory tab — and
 * section banners never interfere, because they are written in the first
 * column and a tick box never is. Null when there is nothing above.
 */
function checkboxHeaderAbove_(range) {
  const row = range.getRow();
  if (row <= 1) return '';
  const column = range.getColumn();
  const values = range.getSheet().getRange(1, column, row - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i][0];
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') continue;
    const text = String(value).trim();
    if (!text || /^(TRUE|FALSE)$/i.test(text)) continue;
    return normalizeHeaderText(text);
  }
  return '';
}

/** One cell, a TRUE/FALSE value, and check-box validation on the cell. */
function isSingleCheckboxClick_(e) {
  if (!e || !e.range) return false;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return false;
  const value = String(e.value === undefined ? '' : e.value).toUpperCase();
  if (value !== 'TRUE' && value !== 'FALSE') return false;
  const rule = e.range.getDataValidation();
  if (!rule) return false;
  return rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
}

/** "Tab name, cell C14" — cheap, and enough to find the cell again. */
function describeCheckboxCell_(e) {
  let tab = '';
  try { tab = e.range.getSheet().getName(); } catch (err) { /* keep going */ }
  const cell = e.range.getA1Notation();
  return tab ? `${tab}, cell ${cell}` : `Cell ${cell}`;
}

function checkboxConfirmCache_() {
  try { return CacheService.getUserCache(); } catch (err) { return null; }
}

function checkboxConfirmSnoozed_() {
  const cache = checkboxConfirmCache_();
  if (!cache) return false;
  try { return !!cache.get(CHECKBOX_CONFIRM_SNOOZE_KEY); } catch (err) { return false; }
}

function snoozeCheckboxConfirm_() {
  const cache = checkboxConfirmCache_();
  try {
    if (!cache) throw new Error('no user cache');
    cache.put(CHECKBOX_CONFIRM_SNOOZE_KEY, String(Date.now()), CHECKBOX_CONFIRM_SNOOZE_SECONDS);
    toastIfPossible('Done. Tick boxes won\'t ask again for 5 minutes.');
  } catch (err) {
    log(`snoozeCheckboxConfirm_: ${err}`);
    toastIfPossible('Done — but the 5-minute pause could not be saved, so the next tick will still ask.');
  }
}
