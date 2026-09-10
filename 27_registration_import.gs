// ============================================================================
// 5. REGISTRATION IMPORT & WAITLISTING  (syncRegistrations)
// ============================================================================

function getLastSyncTime() {
  const stored = PropertiesService.getScriptProperties().getProperty(LAST_SYNC_PROP_KEY);
  return stored ? new Date(stored) : new Date(0);
}

function setLastSyncTime(date) {
  PropertiesService.getScriptProperties().setProperty(LAST_SYNC_PROP_KEY, date.toISOString());
}

function syncRegistrations() {
  if (!automationGateAllows('Sync Registrations')) return;
  recordHandlerRun('syncRegistrations');

  if (isBootstrapActive()) {
    log(`syncRegistrations: a large-setup import or forms-rebuild sweep is writing to the session table — skipping this run.`);
    return;
  }

  // THE DOOR'S QUEUE GOES IN FIRST, before this run takes the lock and starts
  // rewriting the rows those marks land on. Queued marks are applied by row
  // match, not row number, so ordering is not a correctness question — but a
  // mark applied before the sync is one the sync's own reads can see, and one
  // the roster rebuild at the end of this function will carry. See
  // flushCheckInQueue().
  flushCheckInQueue({ waitMs: SYNC_LOCK_WAIT_MS });

  // ONE SLICE OF THE SYNC. The lock, the budget, the hand-off when the budget
  // is spent and the words at the end of it all live in
  // 98_registration_sync_slices.gs; what is left in this file is the IMPORT
  // itself, below. `openWindow` is what makes this the run that decides the
  // sync clock's next value — a hand-off carries the window this opened.
  const outcome = runRegistrationSyncSlice({ openWindow: true });

  // THE LISTS ARE REBUILT ONCE THE WINDOW IS DONE, not once per slice, and
  // outside the lock — see warmQuickMarkAfterSync_().
  if (outcome && outcome.finished) warmQuickMarkAfterSync_();
}

/**
 * THE HALF THAT CANNOT LOSE ANYTHING: every form's new responses, into rows,
 * onto the Registrants tab.
 *
 * Returns how many units of work this slice got through, which is what tells
 * the sliced-job runner whether the run stalled. Sets `plan.importDone` when
 * every form in the window has been read — and only then is the sync clock
 * advanced, because a window with unread forms in it is a window that has to
 * be read again. See the banner in 98_registration_sync_slices.gs.
 */
function runRegistrationImportPhase(sync) {
  const plan = sync.plan;
  const ss = sync.ss;
  migrateLegacySheetNames(ss);
  const registrySheet = sync.registrySheet;
  const registrantsSheet = sync.registrantsSheet;

  const lastSync = new Date(plan.lastSync);
  const orderAheadDays = getOrderAheadDays();

  // One read of each tab up front; both registry-derived structures below
  // are built from the same rows rather than scanning the sheet twice.
  const sessionRows = sync.sessionRows();
  const registryIndex = buildRegistryIndex(registrySheet);
  const existingRows = getSectionedRows(registrantsSheet, HEADERS.All_Registrants, 'Event_ID');
  const protectedKeys = getProtectedRegistrantKeys(existingRows);
  const existingRowIndex = getExistingRegistrantIndex(existingRows);
  // What each session is already holding, so this run's waitlist decisions
  // start from the truth rather than from zero — see seedRegistryOccupancy().
  seedRegistryOccupancy(registryIndex, existingRows);

  // THE WORK LIST IS THE PLAN'S, not this execution's. A first slice writes it
  // down; a resume slice reads what is left of it. Recomputing it here would
  // be reading a session table that the previous slice's own writes have
  // already changed, which is how a form gets read twice and another not at
  // all.
  if (!plan.pendingFormIds) {
    plan.pendingFormIds = getDistinctFormIds(registrySheet);
    plan.formsRead = 0;
  }

  const newRows = [];
  // Two things gathered across every response and written ONCE, below: club
  // joins, and the appointment requests nobody could book a time for (see
  // ASSISTANCE_NO_TIME_CHOICE). A tab rewrite per submission would be both
  // slow and, on a busy sync, a lot of re-reads of a tab being changed.
  const collectors = { clubJoins: [], assistanceRequests: [] };

  let formsThisSlice = 0;
  while (plan.pendingFormIds.length > 0) {
    // CHECKED BETWEEN FORMS, never inside one: a response half-imported is a
    // registrant row half-built, and there is no state that could resume from
    // the middle of one. A form is the smallest unit this can stop on.
    if (sync.outOfTime() && formsThisSlice > 0) break;
    const formId = plan.pendingFormIds[0];
    // THE WHOLE FORM IS INSIDE THE GUARD, not just the open.
    //
    // It used to be only FormApp.openById(), on the reasoning that opening is
    // where access is decided — but getResponses() and getItems() are separate
    // calls that reach the same file and can be refused on their own, and a
    // refusal there was an uncaught throw that ended the ENTIRE sync. One form
    // shared wrongly therefore stopped every OTHER form's registrations from
    // being imported, stopped the dashboards being rebuilt, and left
    // LAST_FORM_SYNC_TIME unadvanced so the next run did the same thing again.
    // A form that cannot be read is one form's problem; it must not be the
    // workbook's.
    try {
      const form = openFormCached(formId);
      const responses = form.getResponses(lastSync);
      if (responses.length > 0) {
        const formIndex = getFormItemIndex(form); // ONE getItems() round trip for every response on this form
        responses.forEach(response => {
          const rowsForResponse = processFormResponse(formIndex, response, registryIndex, protectedKeys,
            existingRowIndex, orderAheadDays, collectors);
          newRows.push(...rowsForResponse.filter(Boolean));
        });
      }
    } catch (err) {
      log(`⚠️ Could not read form ${formId}: ${err}`);
      // A PERMISSION FAILURE IS REPAIRABLE, and the repair is worth trying
      // from here: this account may hold the file even though the call that
      // failed did not go through Drive. When it works, the next run imports
      // normally and nobody has to do anything. When it does not — because
      // this is the account that cannot reach the file — the admin digest
      // says which form and names the menu item that fixes it, run by the
      // account that owns it.
      if (isPermissionError(err)) {
        const opened = openUpFileToAnyoneWithLink(formId, `registration form ${formId}`);
        noteForAdmin('Forms that could not be read',
          `${describeFormLink(formId)} refused this account (${err}). ` +
          (opened.openedUp
            ? `Its sharing has just been opened to anyone with the link, so the next sync should import it.`
            : `Its sharing could NOT be changed from here. Sign in as the account that created it and run ` +
              `🔧 Admin ▸ 🔓 Open Up Form Sharing. Until then this form's registrations are not being imported.`));
      } else {
        noteForAdmin('Forms that could not be opened', `${formId} — ${err}`);
      }
    }
    // OFF THE LIST WHETHER IT WAS READ OR REFUSED. A form this account cannot
    // open will refuse the next slice too, and leaving it at the head of the
    // list would be a window that can never close.
    plan.pendingFormIds.shift();
    plan.formsRead = (plan.formsRead || 0) + 1;
    formsThisSlice++;
  }

  const allFormsRead = plan.pendingFormIds.length === 0;

  flushPersistentRegistries(); // one write for every all-dates entry recorded above

  // The roster is updated BEFORE the catch-up below reads it, so somebody who
  // joined a club in this very sync is booked into its sessions on the same
  // run rather than waiting an hour for the next one.
  sync.step('updating the club roster', () => upsertClubMembers(collectors.clubJoins));

  // Guarded on its own: somebody asking for an appointment we cannot offer is
  // worth recording, and is never worth failing an import over.
  try {
    recordAssistanceRequests(collectors.assistanceRequests);
  } catch (err) {
    log(`⚠️ Could not file this run's appointment requests (${err}) — the registrations themselves are fine.`);
    noteForAdmin('Appointment requests needing a date',
      `${collectors.assistanceRequests.length} request(s) could not be written to ` +
      `"${SHEET_NAMES.ASSISTANCE_REQUESTS}": ${err}`);
  }

  // Deliberately AFTER the import loop above: bringing a form built on an
  // older template up to date replaces its questions, and a response that
  // hadn't been imported yet would lose its answers with them. WHICH IS ALSO
  // WHY THIS WAITS FOR EVERY FORM TO HAVE BEEN READ: a slice that ran out of
  // budget with forms still pending is holding un-imported responses on those
  // very forms, and rewriting one now is the way to lose them for good.
  //
  // FIRST THE REPAIRS, THEN THE REBUILDS. A form whose only problem is one a
  // migration can write in place is fixed here and stamped current, so the
  // rebuild pass below skips it entirely — and the five rebuilds an execution
  // can afford are left for the forms that genuinely need one. Ordering it the
  // other way round would rebuild a form this could have fixed with four
  // writes. See 68_form_state_migrations.gs for the standing rule.
  //
  // Both take this slice's deadline: they open forms one at a time and defer
  // the rest, which is exactly what a budget is for.
  if (allFormsRead) {
    sync.step('repairing forms in place', () =>
      runFormStateMigrations(registrySheet, sessionRows, { deadline: sync.deadline }));

    sync.step('bringing forms onto the current template', () =>
      migrateFormsToCurrentTemplate(registrySheet, sessionRows, { deadline: sync.deadline }));
  }

  // Catch up "sign up for all dates" registrants on Grouped-series forms
  // whose date list has grown since they originally registered.
  sync.step('catching up "every date" registrants', () =>
    applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows));

  // ...and club members onto every upcoming session of their club, whichever
  // form now covers it. This is the step that makes a membership outlive the
  // form it was created on — see applyClubRosterCatchup().
  sync.step('catching up club members', () =>
    applyClubRosterCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows));

  // BEFORE the tab is rewritten, not after: the leaders' shared sheets hold
  // marks made since the last run, and this is the pass that would otherwise
  // overwrite them with the copy the workbook already had. See
  // pullProgramLeaderSheetEdits() for how a touched cell is told from an
  // untouched one. Guarded, because a shared sheet somebody trashed must not
  // be able to stop the registration import.
  try {
    pullProgramLeaderSheetEdits(existingRows);
    // IMMEDIATELY AFTER THE MERGE, on the rows it just touched: a leader's
    // "Dropped" tick is a cancellation, and until it became one it was a
    // column nothing read while the seat stayed full. See
    // applyLeaderDropsAsCancellations() for why it stamps these rows rather
    // than going through cancelRegistrantRows() — the tab is written below.
    applyLeaderDropsAsCancellations(existingRows);
    // ...and the tick beside it, which was a note for exactly as long. Two-way,
    // so a seat that comes free can be given back by unticking the box that
    // gave it up. AFTER the drops, on purpose: a row cancelled a line above is
    // refused here rather than being put in a queue it has left.
    applyLeaderWaitlistTicks(existingRows, sessionRows);
  } catch (err) {
    log(`⚠️ Could not read the program registrant sheets back in this run (${err}) — the registrations themselves are fine.`);
  }

  const combinedRegistrantRows = existingRows.concat(newRows);
  // BEFORE the write, so every consumer of these rows below — the Registrants
  // tab, the dashboards, the program leader sheets, the sign-in sheets — sees
  // the phone number and email the workbook already knows, not the blanks a
  // club catch-up or a door sign-in left. Fills blanks only; see
  // applyMemberRollContacts().
  sync.step('filling in known contact details', () => applyMemberRollContacts(combinedRegistrantRows));
  // THE ONE STEP WHOSE FAILURE STOPS THE CLOCK. Everything else here can be
  // skipped and picked up next hour; this is the write that puts the imported
  // registrations on the sheet, and if it does not land, advancing
  // LAST_FORM_SYNC_TIME would mean those responses are never read again.
  const registrantsWritten = sync.step('writing the Registrants tab',
    () => { renderRegistrantsSheet(false, combinedRegistrantRows); return true; }) === true;
  if (registrantsWritten) sync.setRegistrantRows(combinedRegistrantRows);

  plan.importedRows = (plan.importedRows || 0) + newRows.length;
  plan.problems = (plan.problems || []).concat(sync.problems.splice(0));

  // THE CLOCK MOVES ONLY WHEN THE WHOLE WINDOW IS IN. Not when some of the
  // forms were read, and not when the write did not land: either way the next
  // run has to read the same responses again, which is the whole point of a
  // sync clock.
  if (allFormsRead && registrantsWritten) {
    setLastSyncTime(new Date(plan.windowOpenedAt));
    plan.importDone = true;
  } else if (!allFormsRead) {
    log(`Registration sync: ${plan.formsRead} form(s) read, ${plan.pendingFormIds.length} to go — ` +
      `handing the rest to a follow-up run. The sync clock stays where it was.`);
  } else {
    // The rows did not land. There is nothing a follow-up run can do about
    // that which the next hourly one will not, so the window closes here and
    // the clock stays put.
    plan.importDone = true;
  }

  return formsThisSlice + 1;
}

// sessionRows dropped: getSectionedRows() below is now the per-execution cache
// (08_execution_caches.gs), so a caller re-reading right after
// syncRegistrationsInternal()'s own top-of-run read gets the same array back
// for free — the hand-threaded parameter would only have duplicated it.
function getDistinctFormIds(registrySheet) {
  const headers = HEADERS.All_Program_Sessions;
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const values = rows.map(row => row[map['Form_ID']]);
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Maps "Form_ID|Plain Session Label" -> { eventId, maxCapacity, eventDate,
 * location, cleanTitle }. The label is exactly what a grid row on that form
 * says once its meal/capacity hints are stripped (formatSessionLabel() /
 * stripMealHint()) — including the location on a cross-location form, which
 * is what keeps two sites' sessions on the same date resolving to two
 * different registry entries instead of one.
 */
function buildRegistryIndex(registrySheet) {
  const index = {};
  const headers = HEADERS.All_Program_Sessions;
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const labelOptionsByForm = buildLabelOptionsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const eventDateRaw = row[map['Event_Date']];
    if (!formId || !eventDateRaw) return;
    const eventDate = coerceDate(eventDateRaw);
    if (!eventDate) return;
    const location = row[map['Location']] || '';
    const cleanTitle = row[map['Clean_Title']] || '';
    const opts = labelOptionsByForm[formId] || {};
    const label = formatSessionLabel(eventDate, location, opts.showLocation, cleanTitle, opts.showTitle);
    const isClub = isClubColumnValue(row[map['Club']]);
    index[`${formId}|${label}`] = {
      formId,
      eventId: row[map['Event_ID']],
      maxCapacity: Number(row[map['Max_Capacity']]) || 0,
      // "This session takes nobody else, whatever the number beside it says."
      // Read per SESSION, like the capacity it overrides — see
      // WAITLIST_ONLY_TAG and processFormResponse(). Absent on a workbook still
      // on the old layout, which reads as false: the column is the only place
      // this is ever stated, so a missing one states nothing.
      waitlistOnly: map['Waitlist_Only'] !== undefined &&
        isWaitlistOnlyColumnValue(row[map['Waitlist_Only']]),
      eventDate,
      // What the session's clock time reads as on the registrant rows built
      // from this entry — see formatTimeRange().
      eventTime: formatTimeRange(eventDate, map['Event_End'] === undefined ? '' : row[map['Event_End']]),
      // The three facts an APPOINTMENT booking needs and a date booking never
      // asks for: where the session ends (so its slots can be re-derived), how
      // long one slot is, and whether the program limits repeat visits. All
      // three are '' / 0 on every ordinary session — see ASSISTANCE_TAG.
      eventEnd: map['Event_End'] === undefined ? null : coerceDate(row[map['Event_End']]),
      slotMinutes: map['Slot_Minutes'] === undefined ? 0 : (Number(row[map['Slot_Minutes']]) || 0),
      maxPerMonth: map['Max_Per_Month'] === undefined ? 0 : (Number(row[map['Max_Per_Month']]) || 0),
      isAssistance: map['Personalized_Assistance'] !== undefined &&
        isAssistanceColumnValue(row[map['Personalized_Assistance']]),
      location,
      cleanTitle,
      isClub,
      // A club's roster is keyed by the PROGRAM, which is why this is computed
      // per session rather than per form — see computeClubKey().
      clubKey: isClub ? computeClubKey(cleanTitle, location, sharedFormIds.has(formId)) : '',
      // THE SAME KEY, COMPUTED FOR EVERY SESSION. A standing place on a
      // program is a Club_Members row, and staff can now add one from the
      // desk to a program that carries no [Club] tag at all (see
      // addStandingListMember()) — a Zoom class whose regulars have never
      // filled in a form is the case this was asked for. So the roster is
      // matched against this, and `isClub` goes on meaning only what it ever
      // meant: whether the public FORM offers to join.
      programKey: computeClubKey(cleanTitle, location, sharedFormIds.has(formId))
    };
  });
  return index;
}

/**
 * Normalizes a name for IDENTITY purposes only (dedup / manual-edit
 * protection / the "sign up for all dates" registry) — "Jane Smith" and
 * "jane smith " are the same person. Display values (the Name column
 * itself) always keep the original, as-typed casing/spacing.
 *
 * INTERNAL runs of whitespace collapse too, which is not fussiness: these
 * names are typed by the public into a form and by staff into Quick Mark, and
 * "Jane  Smith" with a stray second space is the single most common way one
 * person becomes two. Two rows on Member_Roll, Times_Seen split across them,
 * a club membership that doesn't match the registration, and a Quick Mark
 * dropdown offering the same person twice — all from a keystroke nobody can
 * see. A tab or a newline pasted mid-name does the same thing, so \s+ rather
 * than just the space.
 */
function normalizeNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

