// ============================================================================
// 1. GLOBAL CONFIGURATION & HELPERS
// ============================================================================

const ENABLE_LOGGING = true;

/** Central logger — no-op when ENABLE_LOGGING is false. */
function log(msg) {
  if (ENABLE_LOGGING) console.log(msg);
}


// ============================================================================
// 1a. ADMIN-ONLY GATE  (structural/destructive actions)
// ============================================================================
//
// Apps Script installable triggers belong to whichever Google account
// created them, invisibly to every other account — that's what let a second
// person's "Check Triggers" click spawn a whole extra, undetectable set of
// calendar-edit triggers (see writeTriggers()'s own doc comment). Resetting
// triggers on every run fixes the symptom for whichever account presses the
// button; this is the cause fix — keep the button out of reach of every
// account except the ones meant to hold it.
//
// WHAT IS GATED IS NOW A LIST, AND IT IS A SHORT ONE. The gate used to sit on
// every admin-menu entry point, which put a sign-in check in front of things
// nobody needs protecting from: reading an event's tags, resizing a column,
// running the Form & Link Doctor, saving a tab order, asking what the triggers
// are doing. Every one of those either only looks, or repairs something in
// place and can be run again. The cost of gating them was real and one-sided —
// the person at the desk who noticed the problem could not press the button
// that fixes it, and the refusal named an account they cannot sign in as.
//
// So the gate is now ADMIN_GATED_ACTIONS: the irreversible ones, and the ones
// that create or destroy triggers (see writeTriggers()'s own doc comment — a
// second account's click there spawns a whole extra, undetectable set of
// calendar-edit triggers, which is what this section was written for).
// requireAuthorizedAdmin() passes anything not on that list, so a call site
// stays exactly where it is and simply stops refusing.
//
// Left UNGATED as it always was: the routine syncCalendars()/syncRegistrations()
// triggers and the onEdit/onOpen simple triggers — those need to keep running
// no matter which account's session happens to be open, and they already have
// their own safety nets (the triage size limit, the bootstrap-active checks,
// sync-token priming).
// ============================================================================

/**
 * The actions the sign-in check still applies to, by the exact `actionName`
 * their call site passes to requireAuthorizedAdmin(). Everything else is open
 * to whoever can open the workbook.
 *
 * ADD A NAME HERE when you add an action that cannot be undone by pressing
 * something else, or that touches installable triggers. Spelling matters — a
 * name that does not match its call site's string silently un-gates it, which
 * is why every entry below is copied from the call rather than retyped.
 */
const ADMIN_GATED_ACTIONS = [
  // Irreversible: forms replaced or links reissued, registrations removed.
  'Destroy and Rebuild Forms',
  'Cancel Destroy-and-Rebuild Sweep',
  'Rebuild Forms In Place',
  'Cancel In-Place Rebuild',
  'Cleanup Never-Policy Forms',
  'Delete Registrations',
  // Folds two registrant rows into one and removes the extra. Every answer is
  // carried onto the row that stays (section 83), but a row is still gone
  // afterwards and nothing in this workbook puts it back.
  'Collapse Duplicate Registrations',
  // Structural: tabs merged away, the whole workbook imported from scratch.
  'Merge Legacy Tabs',
  'Import Everything (First Run)',
  'Cancel Large-Setup Import',
  'Initialize + Sync Everything',
  // Installable triggers — the original reason this section exists.
  'Check Triggers',
  'Take Over Trigger Ownership',
  'Release My Triggers',
  // Moves every generated file in Drive at once. Nothing is deleted and no
  // link changes, but "where did all my forms go" is not a question anybody
  // should be able to raise by mis-clicking a menu.
  'Organize Generated Files',
  // Overriding a safety limit is exactly the kind of decision this is for.
  'Confirm Large Triage'
];

/** Does this action still ask who is signed in? */
function isAdminGatedAction(actionName) {
  return ADMIN_GATED_ACTIONS.indexOf(String(actionName || '')) !== -1;
}

/**
 * Google accounts allowed to run a structural/destructive action. Edit this
 * list to change who holds admin access — nothing else in the code needs to
 * change. An empty list means NOBODY can (fails closed, not open).
 */
const AUTHORIZED_ADMIN_EMAILS = [
  'admin@newhorizonsseniorcenter.org'
];

/**
 * THE OWNER OF THIS SPREADSHEET IS ALWAYS AN ADMIN, whatever the list above
 * says.
 *
 * The list is a hardcoded constant, and a hardcoded constant is exactly the
 * thing that goes stale: an address that was a shared account once, or was
 * aspirational, or belongs to somebody who has left. When it does, EVERY
 * admin action refuses — Rebuild Layout, Delete Registrations, Import
 * Everything, Check Triggers, Re-check All Forms — and the refusal names an
 * account nobody can sign in as. The README's own upgrade instructions
 * ("run Admin ▸ Rebuild Layout") stop working, and there is no way back
 * except editing the source.
 *
 * The owner is the one identity that cannot be wrong: they can already change
 * this file, delete the tabs, and share the workbook with anyone. Gating them
 * out protects nothing and strands everything. Failing closed still holds for
 * everyone else — see requireAuthorizedAdmin().
 *
 * Returns '' when the owner can't be read (a shared drive has no single
 * owner, and getOwner() can come back null), which simply falls through to
 * the list.
 */
function getWorkbookOwnerEmail() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return '';
    const owner = ss.getOwner();
    return owner ? String(owner.getEmail() || '').trim().toLowerCase() : '';
  } catch (err) {
    // A file on a shared drive throws rather than returning null.
    return '';
  }
}

/** Every account that may run an admin action: the list above, plus the owner. */
function listAuthorizedAdminEmails() {
  const owner = getWorkbookOwnerEmail();
  const listed = AUTHORIZED_ADMIN_EMAILS.map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
  return owner && listed.indexOf(owner) === -1 ? listed.concat([owner]) : listed;
}

/**
 * The Google account this specific execution is running as. Session.getEffectiveUser()
 * is who the code's side effects are attributed to — for a menu click or a
 * direct editor run, that's whoever is signed in; for an installable trigger
 * (the daily/hourly syncs, the bootstrap hand-off), it's whoever created that
 * trigger, which is exactly "who actually set this in motion."
 *
 * Returns '' if it can't be determined (getEmail() can come back blank in
 * some restricted execution contexts) — callers must treat that as
 * unauthorized, not as a pass.
 */
function getCurrentUserEmail() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (err) {
    return '';
  }
}

function isAuthorizedAdmin() {
  const email = getCurrentUserEmail();
  if (!email) return false;
  return listAuthorizedAdminEmails().indexOf(email) !== -1;
}

/**
 * Call as the FIRST line of any structural/destructive function. Returns
 * true and does nothing else if the current account is authorized; returns
 * false (having logged and toasted why) otherwise — the caller's very next
 * line should be `return`.
 *
 * FAILS CLOSED: an email that can't be determined is treated as
 * unauthorized, same as a real mismatch. The cost of a false block is
 * someone re-running it after signing in as the right account; the cost of
 * a false pass is an unidentified account rebuilding triggers or running the
 * calendar import.
 */
function requireAuthorizedAdmin(actionName) {
  // NOT ON THE LIST MEANS NOT GATED. See ADMIN_GATED_ACTIONS — the check now
  // covers the irreversible actions and the trigger ones, and nothing else.
  if (!isAdminGatedAction(actionName)) return true;
  if (isAuthorizedAdmin()) return true;
  const email = getCurrentUserEmail();
  const whoami = email ? `you're signed in as ${email}` : `your account could not be identified`;
  const message = `⛔ "${actionName}" is restricted to: ${listAuthorizedAdminEmails().join(', ')} — ${whoami}. ` +
    `Ask one of those accounts to run it, or switch to one of them.`;
  log(message);
  toastIfPossible(message);
  return false;
}


// ============================================================================
// 1b. "ARE YOU SURE?" — consequence prompts for outward-facing changes
// ============================================================================
//
// Some edits in this workbook don't just change the workbook: they rewrite
// LIVE Google Forms that people are mid-way through registering on, or change
// what every future registration is catered as. A spreadsheet gives no hint
// that typing in a cell is about to do that.
//
// So the rule is: anything whose blast radius reaches outside this
// spreadsheet asks first, in plain language, and does nothing at all if the
// answer is no. For a cell edit that means putting the old value BACK, since
// by the time onEdit sees it the new value is already on the sheet.
//
// getUi() is unavailable in a trigger context (a time-driven sync has no
// dialog to show), which is exactly right: an unattended run should proceed
// on its schedule, not sit waiting for a click that will never come. Only a
// human at the keyboard gets asked.
// ============================================================================

/**
 * Asks the user to confirm a consequential action. Returns true to proceed.
 *
 * NO UI AVAILABLE (a trigger run) => returns `defaultWhenUnattended`, which
 * callers must choose deliberately:
 *   - true  for automation that SHOULD keep running unattended (the hourly
 *           sync rewriting form labels — that's its job).
 *   - false for anything a human specifically set in motion, where silence
 *           means nobody is there to take responsibility for it.
 */
function confirmConsequentialAction(title, detail, defaultWhenUnattended) {
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    log(`No UI available to confirm "${title}" — ${defaultWhenUnattended ? 'proceeding' : 'skipping'} (unattended run).`);
    return !!defaultWhenUnattended;
  }
  if (!ui) return !!defaultWhenUnattended;

  const response = ui.alert(title, `${detail}\n\nContinue?`, ui.ButtonSet.YES_NO);
  const proceed = response === ui.Button.YES;
  log(`"${title}": user chose ${proceed ? 'YES — proceeding' : 'NO — nothing changed'}.`);
  if (!proceed) toastIfPossible(`Cancelled — nothing was changed.`);
  return proceed;
}

/**
 * The cell-edit flavour: confirm, and PUT THE OLD VALUE BACK if declined.
 * `e` is the onEdit event, which carries oldValue for a single-cell edit.
 *
 * Multi-cell edits (a paste, a fill-down) have no oldValue to restore, so
 * they are allowed through with a warning toast rather than being reverted to
 * a guess — silently writing the wrong "old" value into a range would be
 * worse than the edit itself.
 */
function confirmCellEditOrRevert(e, title, detail) {
  const isSingleCell = e && e.range && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
  if (!isSingleCell) {
    toastIfPossible(`⚠️ ${title}: applied to a multi-cell edit without asking — please double-check the result.`);
    return true;
  }
  if (confirmConsequentialAction(title, detail, false)) return true;

  // Declined: restore what was there. e.oldValue is undefined when the cell
  // was previously empty, which setValue('') reproduces correctly.
  e.range.setValue(e.oldValue === undefined ? '' : e.oldValue);
  // Whatever tab that was, its cached read is now a row behind.
  invalidateSectionedRowsCache();
  return false;
}

/** Calendar ID -> human-readable location name. */
const CALENDAR_MAP = {
  'c7706e8a3c057e02a4adca78268262aeb7116b9717b9325926bf746728566faa@group.calendar.google.com': 'Narberth',
  '1073e5cc279f84bff722d0b03695b38011d845e6230e2f704adab49d31c3d652@group.calendar.google.com': 'Ashbridge',
  'ac990016bc9f04e0d7ef9da8b463367cd34b2aa5a137535d876af9ae4db2f675@group.calendar.google.com': 'Zoom'
};

