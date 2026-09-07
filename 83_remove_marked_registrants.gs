// ============================================================================
// 10c. REMOVING REGISTRANTS ONE ROW AT A TIME  (removeMarkedRegistrants)
// ============================================================================
//
// There was already a way to delete registrations, and it works by SESSION:
// showDeleteRegistrationsDialog() (section 10b) picks whole sessions and
// clears every row on them. That is the right shape for the job it was built
// for — a test run, a duplicate import, a program cancelled before it ran.
//
// It is the wrong shape for the job the desk actually has most often: ONE row
// is wrong. Somebody was entered twice under two spellings, a walk-in was
// added to the wrong day, a name was typed into the wrong session. Clearing
// the whole session to remove one person is not an option, so those rows were
// simply left there — and a registrant tab nobody trusts is worse than one
// with an awkward delete on it.
//
// SO THE MARK LIVES IN A COLUMN THAT IS ALREADY ON EVERY ROW. Manual_Override
// gained a fourth option on the registrant tabs — "Remove This Row"
// (REGISTRANT_REMOVE_OVERRIDE_OPTION) — which is a request, not a record, and
// is the one value in that column washed red. Marking costs one click in a
// dropdown that is already there; nothing is deleted by marking.
//
// WHY THE SWEEP IS A MENU ITEM AND NOT AN onEdit. Three reasons, and each one
// on its own would be enough:
//
//   • A mis-click in a dropdown must not be permanent. A mark can be changed
//     back; a deleted row cannot, and onEdit would delete it before the person
//     had finished reading what they picked.
//   • Marking a handful of rows and clearing them together is how the job is
//     really done — three duplicates found while reading down a roster.
//   • Deleting a row means re-rendering the tab and recomputing the counts and
//     the catering numbers. That is a second of work; onEdit does it once per
//     edit, this does it once per sweep.
//
// WHAT MAKES A DELETION STICK is not this file. It is the tombstone
// (section 5c): the key of a row a human deliberately removed, which
// buildRegistrantRow() refuses to rebuild — closing the import, the all-dates
// catch-up and the club catch-up in one check. Without it the next sync puts
// every removed row straight back. recordRegistrantTombstones() is therefore
// called BEFORE anything is written, and a genuinely new submission from the
// same person for the same session still comes through as normal.
//
// WHAT IT DELIBERATELY DOES NOT DO: touch the form responses. The session
// dialog offers that as a tick because clearing a test run means clearing what
// the test submitted; removing one duplicate row does not mean destroying the
// only copy of what somebody said. The tombstone is what keeps the response
// from coming back as a row.
// ============================================================================

/** The registrant-shaped tabs the mark is offered on, in the order they are swept. */
defineLazyGlobal_('REGISTRANT_REMOVAL_TABS', () => ([
  { name: SHEET_NAMES.REGISTRANT_DASH, headers: HEADERS.All_Registrants, render: renderRegistrantsSheet },
  { name: SHEET_NAMES.TRIAGE, headers: HEADERS.Deleted_Event_Triage, render: renderTriageSheet }
]));

/** How many names the confirmation lists before it stops naming them. */
const REGISTRANT_REMOVAL_PREVIEW_NAMES = 12;

/**
 * MENU ENTRY: delete every registrant row marked "Remove This Row", after
 * saying exactly who is about to go.
 *
 * Not admin-gated, unlike its session-wide sibling, and the difference is the
 * blast radius: that one clears a session at a time and can take the form
 * responses with it, this one deletes exactly the rows somebody hand-marked
 * one at a time and leaves every response in place. The guard that fits is
 * the one below — a named list and a Yes.
 */
function removeMarkedRegistrants() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }

  const marked = collectMarkedRegistrantRemovals();
  if (marked.total === 0) {
    toastIfPossible(`Nothing marked. Set Manual_Override to "${REGISTRANT_REMOVE_OVERRIDE_OPTION}" on the rows to remove, then run this again.`);
    return;
  }

  if (!confirmConsequentialAction(
    `Remove ${marked.total} marked registrant row${marked.total === 1 ? '' : 's'}?`,
    describeMarkedRegistrantRemovals(marked),
    false)) {
    return;
  }

  // The same lock the session-wide delete takes: a sync running underneath a
  // re-render is how half a tab goes missing.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('⚠️ A sync is running right now — try again in a moment.');
    return;
  }
  try {
    const message = removeMarkedRegistrantsInternal(marked);
    toastIfPossible(message);
    log(`removeMarkedRegistrants: ${message}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reads both registrant tabs and splits each one's rows into the marked and
 * the kept. Reads only; nothing here writes.
 */
function collectMarkedRegistrantRemovals() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = [];
  let total = 0;

  REGISTRANT_REMOVAL_TABS.forEach(spec => {
    const sheet = ss.getSheetByName(spec.name);
    if (!sheet) return;
    const map = getIndexMap(spec.headers);
    if (map['Manual_Override'] === undefined) return;
    const rows = getSectionedRows(sheet, spec.headers, 'Event_ID');
    const keep = [];
    const doomed = [];
    rows.forEach(row => {
      const override = String(row[map['Manual_Override']] || '').trim();
      (override === REGISTRANT_REMOVE_OVERRIDE_OPTION ? doomed : keep).push(row);
    });
    if (doomed.length === 0) return;
    total += doomed.length;
    tabs.push({ spec, sheet, map, keep, doomed });
  });

  return { tabs, total };
}

/** The words in the confirmation: who, on what, and what will and will not happen. */
function describeMarkedRegistrantRemovals(marked) {
  const lines = [];
  marked.tabs.forEach(tab => {
    const nameCol = tab.map['Name'];
    const eventCol = tab.map['Event'];
    const dateCol = tab.map['Event_Date'];
    lines.push(`${tab.spec.name} — ${tab.doomed.length} row(s):`);
    tab.doomed.slice(0, REGISTRANT_REMOVAL_PREVIEW_NAMES).forEach(row => {
      const name = nameCol === undefined ? '(unnamed)' : String(row[nameCol] || '(unnamed)');
      const event = eventCol === undefined ? '' : String(row[eventCol] || '');
      const date = dateCol === undefined ? '' : formatDateLabel(row[dateCol]);
      lines.push(`  • ${name}${event ? ` — ${event}` : ''}${date ? ` (${date})` : ''}`);
    });
    if (tab.doomed.length > REGISTRANT_REMOVAL_PREVIEW_NAMES) {
      lines.push(`  • …and ${tab.doomed.length - REGISTRANT_REMOVAL_PREVIEW_NAMES} more`);
    }
  });
  lines.push('');
  lines.push('The rows are deleted and will not be re-imported by the next sync.');
  lines.push('The form responses behind them are left in place, and a genuinely new');
  lines.push('registration from the same person for the same session still comes through.');
  return lines.join('\n');
}

/**
 * The write half. Tombstones first — a row deleted without one is a row the
 * next sync rebuilds (section 5c) — then the re-render, then the counts.
 */
function removeMarkedRegistrantsInternal(marked) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let registrantKeep = null;

  marked.tabs.forEach(tab => {
    recordRegistrantTombstones(tab.doomed, tab.map);
    tab.spec.render(false, tab.keep);
    if (tab.spec.name === SHEET_NAMES.REGISTRANT_DASH) registrantKeep = tab.keep;
  });

  // Only the registrants tab feeds the counts; triage rows are already out of
  // every total by virtue of being on triage.
  if (registrantKeep) {
    try {
      const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
      const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
      if (registrySheet && registrantsSheet) {
        recomputeEventRegistryCounts(registrySheet, registrantsSheet, registrantKeep);
      }
      updateMasterLunchDashboard(registrantKeep);
    } catch (err) {
      return `Removed ${marked.total} row(s) — but the counts could not be recalculated (${err}). ` +
        'Run Update Everything Now to bring them back in line.';
    }
  }

  return `Removed ${marked.total} marked registrant row(s). The form responses were left in place.`;
}
