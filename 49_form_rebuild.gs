// ============================================================================
// 11. DESTROY AND REBUILD FORMS  (the last resort, on the Admin menu)
// ============================================================================
//
// FOUR WAYS TO FIX A FORM, and it is worth knowing which one you want,
// because they differ by exactly how much they throw away:
//
//   1. The hourly sync's own migration (migrateFormsToCurrentTemplate()) —
//      rewrites a form's questions IN PLACE, keeping its ID. Automatic,
//      invisible, and the right answer almost always.
//   2. recheckAllRegistrationForms() — the same thing, on demand, for every
//      form at once. Run it from the Apps Script editor when you don't want to
//      wait an hour.
//   3. rebuildAllFormsInPlace() — on the Admin menu, and the one to reach for
//      once forms are live. Same in-place rewrite, but it does not first ask
//      whether each form looks stale, so it also reaches a form somebody has
//      hand-edited within the template's shape. Links survive.
//   4. THIS. Throws each form away and builds a brand-new one in its place.
//
// (4) exists for the cases (1)–(3) cannot reach: a form somebody has
// hand-edited into a state the parser no longer recognizes, one whose
// questions were deleted, one whose responses are corrupt, one that Google
// itself will no longer open. In every one of those the form's ID is not an
// asset worth keeping — it is the thing tying you to the broken object. If the
// ID IS worth keeping — and it is, the moment a link has been handed out — (3)
// ends with the same current-template form and costs nobody their link.
//
// WHAT IT COSTS, stated plainly because the menu item has to say it out loud:
// every registration link already handed out STOPS WORKING. Old links point at
// the old form, and the old form is in the Drive trash. Calendar descriptions
// and dashboard links are rewritten here, so anything anyone reaches through
// this system is fine — but a link in an email somebody sent last week, or on
// a printed flyer, is not.
//
// WHAT IT DOES NOT COST: registrations. Responses already imported are rows on
// Registrant_Dash and are untouched. Responses NOT yet imported
// would be destroyed with the form, so this imports them first and refuses to
// go on if that import fails — losing a registration to a maintenance action
// is the one outcome that would make this tool not worth having.
//
// Past-only forms are left alone: their sessions have happened, their links
// are nobody's route to anything, and replacing them would break the archive
// for no gain.
// ============================================================================

/**
 * How many forms one SYNCHRONOUS run will replace. Building a form is a few
 * dozen Forms calls plus a Drive copy, and this runs from a menu click with a
 * six-minute ceiling. Whatever is left is reported and picked up by running
 * it again — the work is strictly decreasing, since a rebuilt form is
 * skipped next time.
 *
 * This only governs plans at or below FORM_REBUILD_SLICE_THRESHOLD. Bigger
 * plans skip it entirely and run as the self-continuing background sweep
 * defined below instead — see the block comment above
 * runFormRebuildSweepSlice() for why.
 */
const MAX_FORM_REPLACEMENTS_PER_RUN = 8;

/**
 * Above this many forms, one click starts a background sweep that keeps
 * itself going — the same slice/watchdog/hand-off-trigger technique
 * bootstrapCalendars() uses for a first-time import. Below it, the plain
 * single-run path above (reported leftovers, re-run by hand) is simple
 * enough not to need that machinery, and the "run it again" it occasionally
 * asks for tops out at a handful of clicks rather than dozens.
 */
const FORM_REBUILD_SLICE_THRESHOLD = 50;

/** What the confirmation prompt makes you type. Deliberately not "yes". */
const DESTROY_REBUILD_CONFIRM_WORD = 'REBUILD';

/**
 * ADMIN MENU ENTRY. Replaces every live registration form covering an upcoming
 * session with a brand-new one built from the current template.
 *
 * A plan of FORM_REBUILD_SLICE_THRESHOLD forms or fewer runs to completion (or
 * as far as MAX_FORM_REPLACEMENTS_PER_RUN allows) in this one execution. A
 * bigger plan hands off to startFormRebuildSweep() instead, which finishes the
 * whole job in the background across as many executions as it takes — the
 * person who clicked the menu does not click it again.
 */
function destroyAndRebuildAllForms() {
  if (!requireAuthorizedAdmin('Destroy and Rebuild Forms')) return null;
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

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const plan = planFormRebuilds(getSectionedRows(registrySheet, headers, 'Event_ID'), map);
  if (plan.length === 0) {
    toastIfPossible('Nothing to rebuild — no form on this workbook covers an upcoming session.');
    return null;
  }

  const sliced = plan.length > FORM_REBUILD_SLICE_THRESHOLD;
  const preview = plan.slice(0, 6)
    .map(p => `• ${p.describe} (${p.upcomingCount} upcoming date(s))`).join('\n');
  const more = plan.length > 6 ? `\n…and ${plan.length - 6} more` : '';
  const batched = sliced
    ? `\n\nThat is over ${FORM_REBUILD_SLICE_THRESHOLD}, so this runs as a BACKGROUND SWEEP: it rebuilds a ` +
      `few forms at a time and re-arms itself automatically until every one is done — you will NOT need to ` +
      `run this again. Calendar sync and registration sync pause for the duration and resume on their own ` +
      `when the sweep finishes.`
    : plan.length > MAX_FORM_REPLACEMENTS_PER_RUN
      ? `\n\nOnly the first ${MAX_FORM_REPLACEMENTS_PER_RUN} will be done this run — run it again for the rest.`
      : '';

  if (!confirmConsequentialAction('Destroy and rebuild every registration form?',
    `${plan.length} form(s) would be REPLACED with brand-new ones:\n${preview}${more}${batched}\n\n` +
    `⚠️ EVERY REGISTRATION LINK ALREADY HANDED OUT WILL STOP WORKING. The old forms go to the Drive ` +
    `trash (recoverable for 30 days); anything still pointing at them — a link in an email you sent, a ` +
    `printed flyer — leads to a dead form. Calendar event descriptions and the dashboard's links are ` +
    `rewritten here, so those stay right.\n\n` +
    `Registrations are NOT lost: outstanding responses are imported first, and rows already on ` +
    `${SHEET_NAMES.REGISTRANT_DASH} are untouched.\n\n` +
    `If a form is merely out of date or hand-edited, you do not want this — "Rebuild Forms In Place" one ` +
    `menu item up does the same rewrite and keeps every link. This is for a form that is broken beyond ` +
    `that.`, false)) {
    return null;
  }

  // A second, deliberately awkward gate. The first dialog is a Yes/No, and a
  // Yes/No is one mis-aimed click; this one cannot be answered by accident.
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    log('destroyAndRebuildAllForms: no UI available — this action has to be run from the menu, by a person.');
    return null;
  }
  const typed = ui.prompt('Confirm: rebuild from scratch',
    `Type ${DESTROY_REBUILD_CONFIRM_WORD} to replace ${plan.length} form(s). Anything else cancels.`,
    ui.ButtonSet.OK_CANCEL);
  if (typed.getSelectedButton() !== ui.Button.OK ||
    String(typed.getResponseText() || '').trim().toUpperCase() !== DESTROY_REBUILD_CONFIRM_WORD) {
    toastIfPossible('Cancelled — nothing was changed.');
    return null;
  }

  if (sliced) {
    return startFormRebuildSweep(plan);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try again in a moment.');
    return null;
  }
  try {
    return runFormRebuildSweep(registrySheet, plan);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Works out which forms are worth replacing, grouped exactly as they are TODAY
 * — one new form per old form.
 *
 * Grouping by current Form_ID rather than re-deriving groups from the calendar
 * is the whole point: it preserves whatever arrangement the workbook is
 * actually in, including cross-location forms and hand-built combined ones. A
 * rebuild should hand back what you had, not what a fresh import would have
 * built.
 *
 * A form with no upcoming sessions is skipped — see the section note.
 */
function planFormRebuilds(sessionRows, map) {
  const byForm = groupRegistryRowsByForm(sessionRows, map);
  const sharedFormIds = getSharedFormIdSet();
  const todayKey = formatDateKey(new Date());
  const plan = [];

  Object.keys(byForm).forEach(formId => {
    const rows = byForm[formId];
    const upcoming = rows.filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) >= todayKey;
    });
    if (upcoming.length === 0) return; // past business — leave its link alone

    // Built from the UPCOMING rows only. A rebuilt form should offer the dates
    // somebody can still sign up for, not re-list a term that has finished.
    const context = buildFormSessionContext(formId, upcoming, map, sharedFormIds);
    if (context.sessions.length === 0) return;

    plan.push({
      oldFormId: formId,
      context,
      upcomingCount: upcoming.length,
      eventIds: new Set(upcoming.map(row => String(row[map['Event_ID']] || '').trim()).filter(Boolean)),
      describe: `${context.titles.slice(0, 2).join(', ')}${context.titles.length > 2 ? '…' : ''} ` +
        `(${describeLocations(context.locations)})`
    });
  });

  return plan.sort((a, b) => a.describe.localeCompare(b.describe));
}

/**
 * Does the work: import first, then replace each form, then bring everything
 * that references a form back into agreement.
 */
function runFormRebuildSweep(registrySheet, plan) {
  const result = { replaced: 0, failed: 0, deferred: 0, importFailed: false };

  // IMPORT BEFORE DESTROYING. A response submitted since the last sync lives
  // only on the form, and trashing the form takes it with it. This is the one
  // step that makes the whole action safe, so a failure here aborts rather
  // than being logged and stepped over.
  toastIfPossible('Importing outstanding registrations before rebuilding…');
  try {
    syncRegistrationsInternal();
  } catch (err) {
    result.importFailed = true;
    const message = `⚠️ Nothing was rebuilt. The registrations on the current forms could not be imported ` +
      `first (${err}), and rebuilding would have destroyed any that had not come across yet. ` +
      `Fix the import, or run "Sync Registrations" by hand, then try again.`;
    log(`destroyAndRebuildAllForms: aborted — ${err}`);
    toastIfPossible(message);
    try { SpreadsheetApp.getUi().alert(message); } catch (uiErr) { /* no UI */ }
    return result;
  }

  // RE-READ THE PLAN. The import above re-renders the dashboard and can move
  // rows (its triage pass sends sessions whose calendar event has gone to
  // Triage), so the contexts gathered for the confirmation dialog a moment ago
  // may now describe dates that no longer exist. Rebuilding is restricted to
  // the forms the user actually agreed to, but the SESSIONS on each one are
  // taken fresh — otherwise a new form could be built listing a session that
  // was triaged away between the click and the work.
  const confirmed = new Set(plan.map(item => item.oldFormId));
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const currentPlan = planFormRebuilds(getSectionedRows(registrySheet, headers, 'Event_ID'), map)
    .filter(item => confirmed.has(item.oldFormId));

  for (const item of currentPlan) {
    if (result.replaced >= MAX_FORM_REPLACEMENTS_PER_RUN) {
      result.deferred++;
      continue;
    }
    try {
      if (replaceOneForm(registrySheet, item)) {
        result.replaced++;
        // See migrateFormsToCurrentTemplate() — same reason, same pause.
        if (result.replaced < MAX_FORM_REPLACEMENTS_PER_RUN) Utilities.sleep(1500);
      } else {
        result.failed++;
      }
    } catch (err) {
      result.failed++;
      log(`⚠️ Could not rebuild the form for ${item.describe} (${err}) — it was left exactly as it was.`);
      noteForAdmin('Forms that could not be rebuilt', `${item.describe} — ${err}`);
    }
  }

  if (result.replaced > 0) {
    SpreadsheetApp.flush();
    // Every event still carries a link to a form that is now in the trash.
    rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
    renderProgramDashboard(false, { skipTriage: true });
  }
  flushPersistentRegistries();
  flushAdminDigest('Destroy and rebuild forms');

  const summary = `Rebuilt ${result.replaced} form(s)` +
    (result.failed > 0 ? `, ${result.failed} failed` : '') +
    (result.deferred > 0 ? `, ${result.deferred} left — run it again to continue` : '') +
    '. Old forms are in the Drive trash.';
  log(`destroyAndRebuildAllForms: ${summary}`);
  toastIfPossible(`✅ ${summary}`);
  return result;
}

// ============================================================================
// DESTROY-AND-REBUILD: BACKGROUND SWEEP FOR LARGE PLANS
//
// Below FORM_REBUILD_SLICE_THRESHOLD forms, runFormRebuildSweep() above does
// the whole job (or as much of MAX_FORM_REPLACEMENTS_PER_RUN as fits) in the
// one execution the menu click gave it, and any leftover count just says "run
// it again". Fine for a handful of forms. It stops being fine once a plan
// runs past what one execution — or even a few manual re-clicks — can
// reasonably get through: nobody should have to sit at the sheet re-running a
// menu item a dozen-plus times to replace fifty or a hundred forms.
//
// So a plan over the threshold takes the same route bootstrapCalendars() uses
// for a first-time import (see the "BOOTSTRAP" block comment above
// runBootstrapSlice(), which this mirrors closely — same shape, different
// unit of work):
//   - Automation (syncCalendars/syncRegistrations/onCalendarChange) is paused
//     up front, via the same pauseAutomationForBootstrap() the import uses —
//     both are long, multi-execution jobs writing to the same dashboard and
//     session table, so both need the same quiet.
//   - Each slice imports outstanding registrations first, then replaces
//     forms until its time budget runs out, then hands off to the next slice
//     via a one-off trigger. Importing every slice (not just the first)
//     matters here: a response can land on a form that is not yet rebuilt in
//     the gap between slices, and that form is about to be trashed — see
//     runFormRebuildSweep()'s note on why the import has to happen before
//     anything is destroyed.
//   - Progress lives in the STATE (which old Form_IDs are done), not in
//     memory, so a slice never repeats work and a killed slice's watchdog
//     trigger picks up exactly where the state says to.
//   - The final slice restores every trigger and clears the state.
//
// isBootstrapActive() treats this sweep as equivalent to a bootstrap import
// for every guard already written against it (see its definition) — the two
// jobs are different work, but "something big is rewriting the dashboard
// across many executions" is the same fact either way, and everything that
// has to stand down for one has to stand down for the other.
// ============================================================================

const FORM_REBUILD_RESUME_HANDLER = 'resumeFormRebuildSweep';
const FORM_REBUILD_STATE_PROP_KEY = 'FORM_REBUILD_STATE_V1';

/** Mirrors BOOTSTRAP_SLICE_BUDGET_MS — see its comment for why not a flat 5 minutes. */
const FORM_REBUILD_SLICE_BUDGET_MS = 4.5 * 60 * 1000;
/** Mirrors BOOTSTRAP_RESUME_DELAY_MS — gap before the next slice after a clean hand-off. */
const FORM_REBUILD_RESUME_DELAY_MS = 30 * 1000;
/** Mirrors BOOTSTRAP_WATCHDOG_DELAY_MS — armed before a slice starts, so a killed slice still gets a successor. */
const FORM_REBUILD_WATCHDOG_DELAY_MS = FORM_REBUILD_SLICE_BUDGET_MS + 2.5 * 60 * 1000;
/** Hard stop, so a bug can never leave the project trading triggers forever. */
const FORM_REBUILD_MAX_SLICES = 60;
/** Consecutive slices allowed to make no progress before giving up. */
const FORM_REBUILD_MAX_STALLED_SLICES = 2;
/** Mirrors BOOTSTRAP_STALE_MS — after this long with no slice completing, the sweep stops blocking normal syncs. */
const FORM_REBUILD_STALE_MS = 2 * 60 * 60 * 1000;

function getFormRebuildState() {
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_REBUILD_STATE_PROP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️ Form-rebuild sweep state was unreadable (${err}) — treating it as finished.`);
    return null;
  }
}

function saveFormRebuildState(state) {
  PropertiesService.getScriptProperties().setProperty(FORM_REBUILD_STATE_PROP_KEY, JSON.stringify(state));
}

function clearFormRebuildState() {
  PropertiesService.getScriptProperties().deleteProperty(FORM_REBUILD_STATE_PROP_KEY);
}

/** Is a sliced destroy-and-rebuild sweep in flight right now? Stale state (see FORM_REBUILD_STALE_MS) reads as "no". */
function isFormRebuildSweepActive() {
  const state = getFormRebuildState();
  if (!state) return false;
  const age = Date.now() - (state.lastSliceAt || state.startedAt || 0);
  if (age > FORM_REBUILD_STALE_MS) {
    log(`⚠️ Ignoring a destroy-and-rebuild sweep that hasn't advanced in ${Math.round(age / 60000)} minute(s) — ` +
      `run destroyAndRebuildAllForms() to restart it, or cancelFormRebuildSweep() to clear it.`);
    return false;
  }
  return true;
}

/**
 * Starts the background sweep for a plan over FORM_REBUILD_SLICE_THRESHOLD
 * forms. Called only from destroyAndRebuildAllForms(), after both
 * confirmations, so everything here can assume the user already agreed to
 * replace exactly the forms in `plan`.
 */
function startFormRebuildSweep(plan) {
  // Ownership is checked here for the same reason bootstrapCalendars() checks
  // it before pausing automation: the sweep both tears triggers down and
  // builds them back up, so the account starting it is choosing to own them.
  if (!requireTriggerOwnership()) return null;
  if (isFormRebuildSweepActive()) {
    toastIfPossible('A destroy-and-rebuild sweep is already running — leaving it alone.');
    return null;
  }

  pauseAutomationForBootstrap();
  saveFormRebuildState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0,
    confirmed: plan.map(item => item.oldFormId), done: [], replaced: 0, failed: 0
  });
  log(`Destroy-and-rebuild sweep started: automation paused, replacing ${plan.length} form(s) in slices.`);
  toastIfPossible(`Rebuild sweep started for ${plan.length} form(s) — this runs in the background and will ` +
    `finish on its own; no need to run this again.`);

  runFormRebuildSweepSlice();
  return { started: true, planned: plan.length };
}

/** Trigger handler for the next slice. Never call this directly — use destroyAndRebuildAllForms(). */
/**
 * DELIBERATELY NOT behind the Automation_Enabled kill switch, for the same
 * reason resumeBootstrapCalendars() isn't (see its comment): a sweep stopped
 * halfway is not a paused sweep, it's a stranded one — the triggers stay
 * torn down and the state stays active, so every normal sync keeps standing
 * down until something explicitly finishes or cancels it. That "something"
 * is this handler completing normally, or cancelFormRebuildSweep().
 */
function resumeFormRebuildSweep() {
  runFormRebuildSweepSlice();
}

/** One execution's worth of rebuilding. Everything that decides whether there is a NEXT slice happens here. */
function runFormRebuildSweepSlice() {
  const state = getFormRebuildState();
  if (!state) {
    // Nothing in flight — a leftover trigger firing after the sweep finished.
    deleteFormRebuildResumeTriggers();
    return;
  }

  // Armed BEFORE anything else, including the lock: from here on every exit
  // path leaves exactly one live successor behind, so neither an outright
  // kill nor a lock we couldn't get can strand the sweep. finishFormRebuildSweep()
  // is what finally clears it.
  armFormRebuildResume(FORM_REBUILD_WATCHDOG_DELAY_MS);

  // THE LOCK IS TAKEN AND GIVEN BACK AROUND EACH UNIT OF WORK, not held for
  // the whole slice. It used to wrap everything below, which meant that while
  // a sweep ran the workbook was locked for 4.5 minutes out of every 5 — and
  // the sign-in desk found Quick Mark unavailable, in the words of the person
  // using it, "half the time". Replacing one form has nothing to do with
  // marking one person off a list; the lock only ever needed to cover the
  // steps that read and rewrite whole tabs.
  if (!withScriptLock(SYNC_LOCK_WAIT_MS, () => true, false)) {
    log('Form-rebuild slice: another execution holds the lock — the next slice will retry.');
    return;
  }

  try {
    state.slices++;
    state.lastSliceAt = Date.now();
    saveFormRebuildState(state);
    // Re-asserted every slice, not just at the start — see runBootstrapSlice()'s
    // comment on why a trigger that reappears mid-sweep has to be removed again
    // rather than trusted to stay gone.
    pauseAutomationForBootstrap();

    if (state.slices > FORM_REBUILD_MAX_SLICES) {
      finishFormRebuildSweep(state, `stopped after ${FORM_REBUILD_MAX_SLICES} slices without finishing`);
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (!registrySheet) {
      finishFormRebuildSweep(state, 'stopped — the program dashboard sheet is gone');
      return;
    }

    const remainingBefore = state.confirmed.length - state.done.length;
    toastIfPossible(`Rebuild sweep: chunk ${state.slices} running… (${state.replaced} done, ${remainingBefore} left)`);

    // Import outstanding registrations before every slice, not just the
    // first — a response can be submitted on a not-yet-rebuilt form in the
    // gap between slices, and that form is about to be trashed. This is the
    // one step that makes the whole action safe, so a failure here stops the
    // sweep rather than risking a form being destroyed with a response still
    // on it (see runFormRebuildSweep()'s identical reasoning above).
    //
    // Held under the lock on its own: this rewrites whole tabs, so it must not
    // interleave with a sync — but it is seconds, not minutes, and the desk
    // gets the workbook back the moment it is done.
    const imported = withScriptLock(SYNC_LOCK_WAIT_MS, () => {
      try {
        syncRegistrationsInternal();
        return { ok: true };
      } catch (err) {
        return { ok: false, err };
      }
    }, null);
    if (!imported) {
      log('Form-rebuild slice: could not take the lock to import registrations — the next slice will retry.');
      armFormRebuildResume(FORM_REBUILD_RESUME_DELAY_MS);
      return;
    }
    if (!imported.ok) {
      finishFormRebuildSweep(state, `stopped — could not import outstanding registrations (${imported.err})`);
      return;
    }

    const headers = HEADERS.Master_Program_Dashboard;
    const map = getIndexMap(headers);
    const confirmedSet = new Set(state.confirmed);
    const doneSet = new Set(state.done);
    // Re-derived fresh every slice, same reason runFormRebuildSweep() re-reads
    // the plan after its import: the sync above can move rows (triage sends a
    // deleted session's row elsewhere), so only the SET of confirmed old
    // Form_IDs is trusted from the original plan — the sessions on each one
    // are taken as they stand right now.
    const remainingPlan = withScriptLock(SYNC_LOCK_WAIT_MS, () =>
      planFormRebuilds(getSectionedRows(registrySheet, headers, 'Event_ID'), map)
        .filter(item => confirmedSet.has(item.oldFormId) && !doneSet.has(item.oldFormId)), null);
    if (!remainingPlan) {
      log('Form-rebuild slice: could not take the lock to re-read the plan — the next slice will retry.');
      armFormRebuildResume(FORM_REBUILD_RESUME_DELAY_MS);
      return;
    }

    if (remainingPlan.length === 0) {
      finishFormRebuildSweep(state, null);
      return;
    }

    const deadline = Date.now() + FORM_REBUILD_SLICE_BUDGET_MS;
    let processedThisSlice = 0;
    for (const item of remainingPlan) {
      if (Date.now() >= deadline) break;
      // ONE FORM, ONE LOCK HOLD. This is the loop that used to run for four and
      // a half minutes inside a single hold. Each form is independent and its
      // progress is recorded in the state, so taking the lock per form costs
      // nothing and gives every other execution — above all Quick Mark at the
      // sign-in desk — a gap to get in between one form and the next.
      const took = withScriptLock(SYNC_LOCK_WAIT_MS, () => {
        try {
          if (replaceOneForm(registrySheet, item)) {
            state.replaced++;
          } else {
            state.failed++;
          }
        } catch (err) {
          state.failed++;
          log(`⚠️ Could not rebuild the form for ${item.describe} (${err}) — it was left exactly as it was.`);
          noteForAdmin('Forms that could not be rebuilt', `${item.describe} — ${err}`);
        }
        state.done.push(item.oldFormId);
        saveFormRebuildState(state);
        return true;
      }, false);
      // Somebody else is mid-write. Not an error and not a stall: this form is
      // still un-done in the state, so the next slice picks it up unchanged.
      if (!took) {
        log('Form-rebuild slice: lock busy between forms — leaving the rest to the next slice.');
        break;
      }
      processedThisSlice++;
      // Pacing between forms — see migrateFormsToCurrentTemplate() / the
      // identical sleep in runFormRebuildSweep() above for the same reason.
      // Outside the lock now, so the pause is a gap other work can use rather
      // than a second and a half of holding the workbook shut doing nothing.
      if (Date.now() < deadline) Utilities.sleep(1500);
    }

    if (processedThisSlice > 0) {
      // Whole-tab work again, so back under the lock — and if it cannot be had,
      // the next slice redoes it. Both steps are idempotent: the link rewrite
      // reads what the descriptions currently say, and the render rebuilds the
      // dashboard from the rows.
      withScriptLock(SYNC_LOCK_WAIT_MS, () => {
        SpreadsheetApp.flush();
        // Every event replaced this slice still carries a link to a form that
        // is now in the trash.
        rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
        renderProgramDashboard(false, { skipTriage: true });
        flushPersistentRegistries();
      });
    }

    const remaining = state.confirmed.length - state.done.length;
    if (remaining <= 0) {
      finishFormRebuildSweep(state, null);
      return;
    }

    const madeProgress = processedThisSlice > 0;
    state.stalledSlices = madeProgress ? 0 : (state.stalledSlices || 0) + 1;
    saveFormRebuildState(state);

    if (state.stalledSlices >= FORM_REBUILD_MAX_STALLED_SLICES) {
      finishFormRebuildSweep(state, `stopped early — ${remaining} form(s) could not be processed`);
      return;
    }

    toastIfPossible(`Rebuild sweep: chunk ${state.slices} done — ${state.replaced} form(s) rebuilt so far` +
      (state.failed > 0 ? `, ${state.failed} failed` : '') +
      `, ${remaining} to go. Next chunk starts in ${Math.round(FORM_REBUILD_RESUME_DELAY_MS / 1000)}s.`);
    armFormRebuildResume(FORM_REBUILD_RESUME_DELAY_MS); // replaces the watchdog with a prompt hand-off
  } catch (err) {
    // An exception, unlike a timeout, is ours to handle: put the system back
    // together rather than leaving automation paused.
    log(`⚠️ Form-rebuild slice failed (${err}) — restoring automation.`);
    noteForAdmin('Destroy and rebuild forms', `The sweep stopped with an error and automation was restored: ${err}`);
    finishFormRebuildSweep(getFormRebuildState() || state, `stopped by an error: ${err}`);
  } finally {
    // No lock to give back: every hold above is opened and closed around one
    // unit of work by withScriptLock().
    flushPersistentRegistries(); // a killed slice's forms must never be forgotten
  }
}

/**
 * Last slice: every trigger back in place, admin digest flushed, state
 * cleared. `problem` is null on a clean finish.
 */
function finishFormRebuildSweep(state, problem) {
  state = state || {};
  deleteFormRebuildResumeTriggers();
  clearFormRebuildState();

  try {
    // force: this IS the restore, and the state was cleared just above — but
    // not relying on that ordering is what keeps automation from staying off.
    writeTriggers(true);
  } catch (err) {
    log(`⚠️ Rebuild sweep: could not restore the triggers (${err}) — run "Check Triggers" from the menu.`);
    noteForAdmin('Destroy and rebuild forms',
      `The sweep finished but its triggers could not be restored (${err}). Run "Check Triggers" from the menu.`);
  }

  const totals = `${state.replaced || 0} form(s) rebuilt` + ((state.failed || 0) > 0 ? `, ${state.failed} failed` : '');
  const headline = problem
    ? `⚠️ Destroy-and-rebuild sweep ${problem}. ${totals}.`
    : `Destroy-and-rebuild sweep complete ✅ (${totals}, over ${state.slices || 1} run(s)). Old forms are in the Drive trash.`;

  log(headline);
  if (problem) noteForAdmin('Destroy and rebuild forms', headline);
  toastIfPossible(headline);
  flushAdminDigest('Destroy and rebuild forms');
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. Mirrors armBootstrapResume(). */
function armFormRebuildResume(delayMs) {
  deleteFormRebuildResumeTriggers();
  ScriptApp.newTrigger(FORM_REBUILD_RESUME_HANDLER).timeBased().after(delayMs).create();
}

function deleteFormRebuildResumeTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== FORM_REBUILD_RESUME_HANDLER) return;
    ScriptApp.deleteTrigger(t); // one-off triggers linger after firing; clear them out
    removed++;
  });
  return removed;
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops a sliced rebuild
 * sweep and puts automation back exactly as finishFormRebuildSweep() would.
 * Whatever was already rebuilt stays rebuilt; re-running
 * destroyAndRebuildAllForms() picks up only the forms still left.
 */
function cancelFormRebuildSweep() {
  if (!requireAuthorizedAdmin('Cancel Destroy-and-Rebuild Sweep')) return;
  const state = getFormRebuildState();
  if (!state) {
    deleteFormRebuildResumeTriggers();
    writeTriggers();
    log('No destroy-and-rebuild sweep was running — triggers verified anyway.');
    return;
  }
  finishFormRebuildSweep(state, 'was cancelled');
}

/**
 * Replaces ONE form: build the new one, point its sessions at it, carry the
 * persistent registries across, then trash the old one.
 *
 * ORDER MATTERS, and it is the conservative one. The new form is built and the
 * sheet is repointed BEFORE anything is trashed, so every failure mode leaves
 * a working form somewhere: fail while building and nothing has changed; fail
 * after building and the sessions are on a good new form with the old one
 * still sitting there harmlessly.
 *
 * A crash that kills the WHOLE EXECUTION (not caught by anything in-process,
 * e.g. hitting the 6-minute ceiling) can still leave an unused form sitting
 * in the Drive folder, since there is no way to run cleanup code after that.
 * Every failure this function can catch itself — a thrown error, or a form
 * built but never wired to any session — trashes the new form before
 * returning, so it never lingers as an unlinked duplicate.
 */
function replaceOneForm(registrySheet, item) {
  const context = item.context;
  const formTitle = readFormTitleOrDerive(item.oldFormId, context);

  // createFormFromSpec() retries its OWN configuration internally, on the ONE
  // form it copies — no retry wrapper here, so a transient error partway
  // through can never cause a second copy to be made (see its comment).
  const created = createFormFromSpec(context, formTitle, 'destroy and rebuild');
  if (!created) {
    log(`⚠️ Rebuild skipped for ${item.describe}: no usable sessions to put on a form.`);
    return false;
  }

  // Declared out here on purpose: the success log below the try block reports
  // it, and a `const` inside the block would leave that line reading a name
  // that no longer exists — a ReferenceError thrown AFTER the swap had already
  // completed, which the caller could only report as a failed rebuild.
  let moved = 0;

  // From here on, the new form is a going concern only once it is actually
  // repointed onto sessions and its registries are carried across. Any
  // failure in between — including one thrown out of this function entirely
  // — leaves an orphan unless it's cleaned up right here, so this whole
  // stretch is wrapped: the new form is trashed on any path that doesn't end
  // in a completed swap, and the underlying error is re-thrown so the caller
  // still sees and logs it exactly as before.
  try {
    moved = writeFormIdOntoSessions(registrySheet, item.eventIds, created.formId);
    if (moved === 0) {
      log(`⚠️ Rebuild for ${item.describe} built form ${created.formId} but moved no session rows onto it — ` +
        `the old form has been left in place. Check the dashboard's Form_ID column.`);
      try { DriveApp.getFileById(created.formId).setTrashed(true); } catch (trashErr) { /* best effort */ }
      return false;
    }

    remapFormRegistries(item.oldFormId, created.formId);
  } catch (err) {
    try { DriveApp.getFileById(created.formId).setTrashed(true); } catch (trashErr) { /* best effort */ }
    throw err;
  }

  trashReplacedForm(item.oldFormId, item.describe);

  log(`Rebuilt ${item.describe}: ${moved} session(s) moved from form ${item.oldFormId} to ${created.formId}.`);
  noteForAdmin('Registration forms rebuilt from scratch',
    `${item.describe} — a new form replaced ${item.oldFormId}. Any link handed out before now points at the ` +
    `old form, which is in the Drive trash. The calendar events and the dashboard have the new link.`);
  return true;
}

/** The old form's own title if it can still be opened, else one derived from its sessions. */
function readFormTitleOrDerive(oldFormId, context) {
  try {
    const title = String(openFormCached(oldFormId).getTitle() || '').trim();
    if (title) return title;
  } catch (err) {
    // Expected often enough to be worth not shouting about: a form nobody can
    // open is one of the main reasons to be running this at all.
    log(`ℹ️ Could not read the old title of form ${oldFormId} (${err}) — naming the replacement from its sessions.`);
  }
  const titles = context.titles || [];
  const base = titles.length > 0
    ? `${titles.slice(0, 2).join(' + ')}${titles.length > 2 ? ' + more' : ''}`
    : 'Registration';
  return `${base} — ${describeLocations(context.locations)}`;
}

/**
 * Carries the per-form bookkeeping from the old ID to the new one.
 *
 * The ALL_DATES registry is the one that would actually hurt to lose: it is
 * keyed by Form_ID and holds everyone who chose "sign up for every date", which
 * is what keeps them being added to dates the series gains later. Dropping it
 * would silently stop those people being booked, with nothing anywhere saying
 * why. The group -> form map is remapped for the same reason in miniature: the
 * next sync would otherwise reuse a trashed form.
 *
 * The label fingerprint is DELETED rather than moved — it describes labels
 * written to a form that no longer exists, and the new form has its own
 * (written with force:true at build time).
 */
function remapFormRegistries(oldFormId, newFormId) {
  // A group key now points at a different form — anything this run cached
  // about which form a group resolves to is stale.
  invalidateRecoveredFormIds();
  const allDates = getAllDatesRegistry();
  if (allDates[oldFormId]) {
    allDates[newFormId] = (allDates[newFormId] || []).concat(allDates[oldFormId]);
    delete allDates[oldFormId];
    __allDatesRegistryDirty = true;
  }

  const registry = getPersistentFormRegistry();
  Object.keys(registry).forEach(groupKey => {
    if (registry[groupKey] !== oldFormId) return;
    registry[groupKey] = newFormId;
    __formRegistryDirty = true;
  });

  const fingerprints = getFormLabelFingerprints();
  if (fingerprints[oldFormId]) {
    delete fingerprints[oldFormId];
    __formLabelFingerprintDirty = true;
  }

  const versions = getFormTemplateVersions();
  if (versions[oldFormId]) {
    delete versions[oldFormId];
    __formTemplateVersionDirty = true;
  }

  // "We closed this one because registration has not opened for it" has to
  // follow the sessions onto their new form, or the replacement is left live
  // for a program nobody can sign up for yet AND the old ID sits in the
  // property forever, since nothing will ever look it up again. The new form
  // was built by configureFormFromSpec(), which already asked the horizon the
  // same question — this only cleans up after the form it replaced.
  const horizonClosed = readRegistrationHorizonClosedForms();
  if (Object.prototype.hasOwnProperty.call(horizonClosed, oldFormId)) {
    delete horizonClosed[oldFormId];
    writeRegistrationHorizonClosedForms(horizonClosed);
  }

  invalidateFormItemIndex(oldFormId);
  flushPersistentRegistries();
}

/**
 * Moves the replaced form to the Drive trash — recoverable for 30 days, which
 * is the right level of destructive for something a person triggered from a
 * menu. Never a hard delete.
 *
 * A failure here is logged, not raised: by this point the sessions are already
 * on the new form and everything downstream is correct. An old form left
 * sitting in the folder is untidy, not broken.
 */
function trashReplacedForm(oldFormId, describe) {
  try {
    DriveApp.getFileById(oldFormId).setTrashed(true);
    // The handle this execution may still be holding now points at a file in
    // the trash. Dropped here as well as in retireReplacedFormState(), because
    // this is the step that makes it stale and it is best-effort — a rebuild
    // that failed to trash still went past the other one.
    invalidateFormItemIndex(oldFormId);
  } catch (err) {
    log(`ℹ️ Rebuilt ${describe}, but the old form ${oldFormId} could not be trashed (${err}) — ` +
      `nothing points at it any more; delete it by hand if you want it gone.`);
  }
}

