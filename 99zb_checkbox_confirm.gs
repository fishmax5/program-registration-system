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
// So onEdit (18) asks this FIRST, for a single-cell edit of a real check box
// on any tab, before any per-tab handler sees it: declining puts the box back
// and the handler never runs, so nothing downstream ever acts on the accident.
//
// "Don't ask for 5 minutes" is the Cancel button. Google's alert offers fixed
// buttons only (Yes / No / Cancel), so the message says what each one means.
// Somebody ticking down a column of attendance at the desk would otherwise
// answer the same question forty times, which is how a confirmation becomes a
// reflex and stops protecting anything. The snooze is per USER (the user
// cache), so one person snoozing does not silence the tablet at the other
// building, and it lapses by itself — CacheService's own expiry is the timer.
//
// Deliberately NOT asked:
//   - a multi-cell edit (paste, fill-down, Space over a selection): it has no
//     oldValue to restore and is a deliberate act, not a slip;
//   - a cell that merely holds TRUE/FALSE without check-box validation;
//   - no UI (a script writing the cell never fires onEdit anyway).
// None of the check-box handlers ask a question of their own (they toast), so
// nobody sees two pop-ups for one tick.
// ============================================================================

const CHECKBOX_CONFIRM_SNOOZE_SECONDS = 5 * 60;
const CHECKBOX_CONFIRM_SNOOZE_KEY = 'CHECKBOX_CONFIRM_SNOOZED_V1';

/**
 * Asks before a single check-box click is allowed to stand. Returns true when
 * the edit should go on to its handler, false when it was undone.
 * Never throws: a confirmation that breaks must not break the edit.
 */
function confirmCheckboxEditOrRevert(e) {
  try {
    if (!isSingleCheckboxClick_(e)) return true;
    if (checkboxConfirmSnoozed_()) return true;

    let ui;
    try { ui = SpreadsheetApp.getUi(); } catch (err) { return true; }
    if (!ui) return true;

    const ticking = String(e.value).toUpperCase() === 'TRUE';
    const where = describeCheckboxCell_(e);
    const response = ui.alert(
      ticking ? 'Tick this box?' : 'Untick this box?',
      `${where}\n\n` +
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
