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

  // THE SAME LOCK syncCalendars() takes, and for a sharper reason. This
  // function reads every registrant row, adds to them in memory, and writes
  // the whole tab back. Two overlapping runs — the hourly trigger and someone
  // pressing the menu item, which is exactly what people do when they are
  // waiting for a registration to appear — both read the same "before"
  // picture, and whichever finishes last overwrites the other's new rows with
  // its own. The registrations are not re-read afterwards either: getResponses()
  // is bounded by LAST_FORM_SYNC_TIME, which the losing run has already
  // advanced. So the rows are simply gone until someone notices a name is
  // missing.
  // THE DOOR'S QUEUE GOES IN FIRST, before this run takes the lock and starts
  // rewriting the rows those marks land on. Queued marks are applied by row
  // match, not row number, so ordering is not a correctness question — but a
  // mark applied before the sync is one the sync's own reads can see, and one
  // the roster rebuild at the end of this function will carry. See
  // flushCheckInQueue().
  flushCheckInQueue({ waitMs: SYNC_LOCK_WAIT_MS });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('syncRegistrations: another sync is already running — skipping this run.');
    toastIfPossible('Another sync is already running — try again in a moment.');
    return;
  }
  try {
    syncRegistrationsInternal();
  } finally {
    lock.releaseLock();
  }

  // THE LISTS ARE REBUILT HERE, not the next time somebody opens Quick Mark.
  // A sync is precisely the moment the registrant rows have changed, and it
  // already runs hourly on a trigger with nobody waiting on it — so the read
  // that used to be a wait at the sign-in desk is paid for in the background
  // instead. Outside the lock: this reads tabs, and holding the sync lock
  // while it does would block the next sync for no reason. Guarded like every
  // step inside the sync: the registrations are already imported and written
  // by the time this runs, and a cache that could not be warmed is only a
  // slower first Quick Mark.
  try {
    warmQuickMarkIndexCache();
  } catch (err) {
    log(`⚠️ Could not rebuild the Quick Mark lists after the sync (${err}) — they will be built on demand.`);
  }
}

function syncRegistrationsInternal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  migrateLegacySheetNames(ss);
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);

  const lastSync = getLastSyncTime();
  const syncStartedAt = new Date();
  const orderAheadDays = getOrderAheadDays();

  // One read of each tab up front; both registry-derived structures below
  // are built from the same rows rather than scanning the sheet twice.
  const sessionRows = readAllSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registryIndex = buildRegistryIndex(registrySheet, sessionRows);
  const existingRows = readAllSectionedRows(registrantsSheet, HEADERS.Registrant_Dash, 'Event_ID');
  const protectedKeys = getProtectedRegistrantKeys(existingRows);
  const existingRowIndex = getExistingRegistrantIndex(existingRows);
  // What each session is already holding, so this run's waitlist decisions
  // start from the truth rather than from zero — see seedRegistryOccupancy().
  seedRegistryOccupancy(registryIndex, existingRows);

  const formIds = getDistinctFormIds(registrySheet, sessionRows);
  const newRows = [];
  // Club joins are gathered across every response and written to the roster
  // ONCE, below — a tab rewrite per submission would be both slow and, on a
  // busy sync, a lot of re-reads of a tab we are in the middle of changing.
  // Two things gathered across every response and written ONCE, below: club
  // joins, and the appointment requests nobody could book a time for (see
  // ASSISTANCE_NO_TIME_CHOICE). A tab rewrite per submission would be both
  // slow and, on a busy sync, a lot of re-reads of a tab being changed.
  const collectors = { clubJoins: [], assistanceRequests: [] };

  // ONE STEP FAILING IS NOT THE RUN FAILING.
  //
  // Everything below this line is a step that can be skipped without making
  // the others wrong: a dashboard render, a memory-tab refresh, a form's
  // labels. They were unguarded, so a single throw — and the throw this was
  // written for is a PERMISSION error, from a second account meeting a
  // protected range or a file it does not own — ended the whole sync: every
  // tab downstream of the failure was left as it was, the admin digest never
  // went out, and the log said one line about one call.
  //
  // The one step that is NOT in this category is the write of the Registrants
  // tab. It is still guarded, but its failure stops the sync clock — see
  // `registrantsWritten` below.
  //
  // Each step now says what it could not do, in words that name the fix when
  // the answer is "this account cannot touch that", and the run carries on.
  const stepProblems = [];
  const step = (label, fn) => {
    try {
      return fn();
    } catch (err) {
      stepProblems.push(label);
      log(`⚠️ Registration sync: ${label} failed (${err}) — carrying on with the rest of the run.`);
      noteForAdmin('Parts of the sync that could not run',
        `${label} — ${err}.` + (isPermissionError(err)
          ? ` That is a permissions failure, not a fault in the data: this account is not allowed to ` +
            `change what it just tried to. Run the sync as the account that owns the workbook, or use ` +
            `🔧 Admin ▸ 🔓 Open Up Form Sharing for a form it cannot reach.`
          : ''));
      return undefined;
    }
  };

  formIds.forEach(formId => {
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
      const form = FormApp.openById(formId);
      const responses = form.getResponses(lastSync);
      if (responses.length === 0) return; // don't pay for an item index on a form with nothing new
      const formIndex = getFormItemIndex(form); // ONE getItems() round trip for every response on this form
      responses.forEach(response => {
        const rowsForResponse = processFormResponse(formIndex, response, registryIndex, protectedKeys,
          existingRowIndex, orderAheadDays, collectors);
        newRows.push(...rowsForResponse.filter(Boolean));
      });
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
  });

  flushPersistentRegistries(); // one write for every all-dates entry recorded above

  // The roster is updated BEFORE the catch-up below reads it, so somebody who
  // joined a club in this very sync is booked into its sessions on the same
  // run rather than waiting an hour for the next one.
  step('updating the club roster', () => upsertClubMembers(collectors.clubJoins));

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
  // hadn't been imported yet would lose its answers with them.
  // FIRST THE REPAIRS, THEN THE REBUILDS. A form whose only problem is one a
  // migration can write in place is fixed here and stamped current, so the
  // rebuild pass below skips it entirely — and the five rebuilds an execution
  // can afford are left for the forms that genuinely need one. Ordering it the
  // other way round would rebuild a form this could have fixed with four
  // writes. See 68_form_state_migrations.gs for the standing rule.
  step('repairing forms in place', () =>
    runFormStateMigrations(registrySheet, sessionRows));

  step('bringing forms onto the current template', () =>
    migrateFormsToCurrentTemplate(registrySheet, sessionRows));

  // Catch up "sign up for all dates" registrants on Grouped-series forms
  // whose date list has grown since they originally registered.
  step('catching up "every date" registrants', () =>
    applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows));

  // ...and club members onto every upcoming session of their club, whichever
  // form now covers it. This is the step that makes a membership outlive the
  // form it was created on — see applyClubRosterCatchup().
  step('catching up club members', () =>
    applyClubRosterCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows));

  // BEFORE the tab is rewritten, not after: the leaders' shared sheets hold
  // marks made since the last run, and this is the pass that would otherwise
  // overwrite them with the copy the workbook already had. See
  // pullProgramLeaderSheetEdits() for how a touched cell is told from an
  // untouched one. Guarded, because a shared sheet somebody trashed must not
  // be able to stop the registration import.
  try {
    pullProgramLeaderSheetEdits(existingRows);
  } catch (err) {
    log(`⚠️ Could not read program leader sheets back in this run (${err}) — the registrations themselves are fine.`);
  }

  const combinedRegistrantRows = existingRows.concat(newRows);
  // THE ONE STEP WHOSE FAILURE STOPS THE CLOCK. Everything else here can be
  // skipped and picked up next hour; this is the write that puts the imported
  // registrations on the sheet, and if it does not land, advancing
  // LAST_FORM_SYNC_TIME would mean those responses are never read again.
  const registrantsWritten = step('writing the Registrants tab',
    () => { renderRegistrantsSheet(false, combinedRegistrantRows); return true; }) === true;

  // combinedRegistrantRows IS what was just written to the Registrants tab,
  // so every consumer below can work from it instead of re-reading — except
  // where renderProgramDashboard()'s triage pass rewrites the tab, which it
  // reports back via registrantsMoved.
  step('recounting registrations against capacity', () =>
    recomputeEventRegistryCounts(registrySheet, registrantsSheet, combinedRegistrantRows));
  step("refreshing the forms' dates and lunch questions", () =>
    refreshFormShapeForAllForms(registrySheet));
  // The appointment half of the same idea: capacity labels tell a date-based
  // form which dates are full, and this tells an appointment form which TIMES
  // are gone. Both run here, on fresh counts, for the same reason — a form
  // still offering a slot somebody took an hour ago is how two people end up
  // in one chair.
  step('refreshing the appointment times on forms', () =>
    refreshAppointmentSlotsForAllForms(registrySheet, sessionRows, combinedRegistrantRows));

  // A dashboard render that did not happen has moved nothing, so the rows read
  // at the top are still the rows on the tab — which is exactly what
  // `registrantsMoved: false` means to everything below.
  const dashboardResult = step('rebuilding the program dashboard', () =>
    renderProgramDashboard(false, { registrantRows: combinedRegistrantRows })) || { registrantsMoved: false };
  const reusableRows = dashboardResult.registrantsMoved ? null : combinedRegistrantRows;
  step('rebuilding the lunch dashboard', () => updateMasterLunchDashboard(reusableRows));
  step('refreshing the memory tabs', () => refreshMemoryTabs(reusableRows, null));
  step('rebuilding the club roster tab', () =>
    renderClubMembersSheet(refreshClubMemberLabels(sessionRows)));

  // The other half of the program leader round trip, and the reason this
  // feature needs NO TRIGGER OF ITS OWN: the rosters go back out on the same
  // hourly pass that just imported into them. Reaches outside the workbook, so
  // it sits down here with the invitations and carries its own guard.
  const settledRegistrantRows = reusableRows ||
    readAllSectionedRows(registrantsSheet, HEADERS.Registrant_Dash, 'Event_ID');
  try {
    pushProgramLeaderSheets(sessionRows, settledRegistrantRows);
  } catch (err) {
    log(`⚠️ Could not refresh the program leader sheets this run (${err}).`);
  }

  // AFTER the push, deliberately. The alert email links to the shared sheet
  // and tells a leader what moved on it, and a leader who follows that link
  // within the minute should find the sheet already saying the same thing.
  // Sending first would put "Mary Ray is no longer on the roster" in an inbox
  // beside a sheet that still lists her.
  //
  // Sends nothing at all when nothing changed — see section 9d.
  try {
    notifyProgramLeadersOfRosterChanges(sessionRows, settledRegistrantRows);
  } catch (err) {
    log(`⚠️ Could not send the roster-change alerts this run (${err}) — the registrations themselves are fine.`);
  }

  // LAST, on purpose: this is the only step that reaches outside the workbook
  // to other people, and it should act on the settled picture rather than on
  // rows a later step might still cancel or supersede. Guarded by its own
  // Config switch and a no-op when nothing changed — see section 5b.
  try {
    inviteRegistrantsToCalendarEvents(sessionRows, reusableRows);
  } catch (err) {
    log(`⚠️ Could not send calendar invitations this run (${err}) — the registrations themselves are fine.`);
  }

  // The other half of the same question, and after the invitations because an
  // appointment's confirmation should not reach somebody before the calendar
  // entry it is about. Per-program, ledgered, and a no-op for every program
  // still on the default — see section 9e.
  try {
    sendRegistrantReminders(sessionRows, reusableRows);
  } catch (err) {
    log(`⚠️ Could not send registrant reminders this run (${err}) — the registrations themselves are fine.`);
  }

  flushPersistentRegistries();
  // NOT ADVANCED WHEN THE ROWS DID NOT LAND: the next run re-reads the same
  // responses and writes them again, which is the whole point of a sync clock.
  if (registrantsWritten) setLastSyncTime(syncStartedAt);
  flushAdminDigest('Registration sync'); // no-op unless something above actually needed attention
  if (stepProblems.length === 0) {
    toastIfPossible(`Registration sync complete ✅ — ${newRows.length} new row(s), ` +
      `${combinedRegistrantRows.length} registrant row(s) total.`);
  } else {
    toastIfPossible(`Registration sync finished with problems ⚠️ — ${newRows.length} new row(s) imported, ` +
      `but ${stepProblems.length} step(s) could not run: ${stepProblems.join('; ')}. See the log.`);
  }
}

function getDistinctFormIds(registrySheet, sessionRows) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
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
function buildRegistryIndex(registrySheet, sessionRows) {
  const index = {};
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
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

