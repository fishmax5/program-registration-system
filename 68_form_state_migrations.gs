// ============================================================================
// FORM STATE MIGRATIONS — carrying a live form from the shape it was built
// with to the shape the code now expects, WITHOUT rebuilding it.
//
// WHY THIS FILE EXISTS. A change to the template is only half a change. The
// template is a stored Drive file the next form is copied from, so a fix in
// addTemplateItemsToForm() reaches forms created afterwards and nobody else:
// a group's form is created once and reused for as long as the group runs.
// Until now the only way to close that gap was migrateFormsToCurrentTemplate(),
// which REBUILDS the form — a few dozen Forms calls, every question replaced,
// every pre-checked box regenerated, five forms per execution. For a change
// that moved one setting, that is a sledgehammer, and it is why "we found the
// bug" and "the forms people are filling in are fixed" were weeks apart.
//
// WHAT A MIGRATION IS HERE. A small, idempotent function that takes a live
// form in state A and leaves it in state B, writing only what is actually
// wrong. It is registered in FORM_STATE_MIGRATIONS below with an id, and the
// ledger in Script Properties remembers which forms it has already run on, so
// the steady state costs one property read and no Forms calls at all.
//
// THE STANDING RULE, for every change after this one: if a change alters the
// shape of something already living out in the world — a form's navigation,
// its questions, a stored registry's fields, a tab's columns — ship the
// migration in the same commit as the change. A version bump says "this is
// different now"; a migration is what makes it different for the people
// already holding the old thing. Add it to FORM_STATE_MIGRATIONS, give it its
// own id, and leave the old ones in place: a workbook that has been offline
// for six months runs all of them in order the next time it syncs.
//
// LOADS LAST, and holds behavior only. It reads TEMPLATE_VERSION,
// TEMPLATE_PAGE_TITLES and TEMPLATE_ITEM_TITLES (05), the template-version
// registry (06) and the session context builders (09) at RUN time, never at
// load time, so its number is free to be the highest one.
// ============================================================================

/**
 * Which migrations have already run on which forms:
 * { formId: { migrationId: true } }, in Script Properties.
 *
 * VERSIONED KEY, per the project rule — a later migration that needs a richer
 * record than "it ran" gets a _V2 key rather than a new reading of this one.
 */
const FORM_STATE_MIGRATION_LEDGER_PROP_KEY = 'FORM_STATE_MIGRATIONS_V1';

/** Ceiling on forms OPENED for migration in one execution. A repair is a handful of
 *  Forms calls rather than a rebuild's few dozen, so this can be far higher than
 *  MAX_FORM_REBUILDS_PER_RUN and still leave the six-minute sync room to breathe. */
const MAX_FORM_MIGRATIONS_PER_RUN = 20;

let __formStateMigrationLedger = null;

/** The ledger, read once per execution. */
function getFormStateMigrationLedger() {
  if (__formStateMigrationLedger) return __formStateMigrationLedger;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_STATE_MIGRATION_LEDGER_PROP_KEY);
  try {
    __formStateMigrationLedger = raw ? JSON.parse(raw) : {};
  } catch (err) {
    log(`⚠️ The form migration ledger could not be read (${err}) — starting a fresh one. ` +
      `Migrations are idempotent, so the worst case is that they run once more than they had to.`);
    __formStateMigrationLedger = {};
  }
  return __formStateMigrationLedger;
}

/** Records that `migrationId` has run on `formId`. Written through at the end of the sweep. */
function markFormStateMigrationApplied(formId, migrationId) {
  const ledger = getFormStateMigrationLedger();
  if (!ledger[formId]) ledger[formId] = {};
  ledger[formId][migrationId] = true;
}

/** Has this migration already run on this form? */
function hasFormStateMigrationRun(formId, migrationId) {
  const ledger = getFormStateMigrationLedger();
  return !!(ledger[formId] && ledger[formId][migrationId]);
}

/** Persists the ledger. Called once, after a sweep, not per form. */
function flushFormStateMigrationLedger() {
  if (!__formStateMigrationLedger) return;
  PropertiesService.getScriptProperties()
    .setProperty(FORM_STATE_MIGRATION_LEDGER_PROP_KEY, JSON.stringify(__formStateMigrationLedger));
}

/** Forgets every record, so the next sweep re-runs every migration on every form. */
function clearFormStateMigrationLedger() {
  __formStateMigrationLedger = {};
  PropertiesService.getScriptProperties().deleteProperty(FORM_STATE_MIGRATION_LEDGER_PROP_KEY);
}

// ---------------------------------------------------------------------------
// THE REGISTRY
//
// Each entry:
//   id       — stable, and never reused. It is what the ledger stores.
//   title    — what a person reading a log line or a menu report should see.
//   targets  — (context) => boolean, optional. Which forms this migration is
//              FOR, judged from the dashboard rows alone so a form it does not
//              apply to is never opened. Omit it and the migration is for
//              every form.
//   version  — the TEMPLATE_VERSION this migration brings a form up to, or 0
//              when it is not a template change at all. A form that ends a
//              sweep having had every migration for a version applied is
//              STAMPED at that version, which is what keeps
//              migrateFormsToCurrentTemplate() from rebuilding a form this
//              already fixed.
//   apply    — (form, context) => number of writes made. Must be idempotent
//              and must return 0 when the form is already right.
// ---------------------------------------------------------------------------
const FORM_STATE_MIGRATIONS = [
  {
    id: 'page_routing_v8',
    title: 'Page routing (v7 → v8)',
    version: 8,
    targets: context => isRoutingAffectedFormContext(context),
    apply: (form, context) => repairFormPageRouting(form, context)
  }
];

/**
 * WHICH FORMS THE v8 ROUTING REPAIR IS FOR: the single-session ones and the
 * appointment (Personalized Assistance) ones, and no others.
 *
 * The misplaced setting was only ever REACHED on a form built without the
 * "how would you like to sign up?" question. Everywhere else that question is
 * a required dropdown whose choices carry their own per-answer navigation, and
 * choice navigation overrides the section's — so no respondent on an ordinary
 * form ever fell through to it, which is exactly why the bug went unseen for
 * as long as it did. Opening those forms reads a few dozen items, writes
 * nothing, and puts every one of them in a ledger describing a repair they
 * never needed.
 *
 * Judged from the dashboard rows, so a form this rules out is never opened at
 * all — on the same two conditions the shaping code itself uses:
 *
 *   • ONE SESSION, not a club — collapseFormToSingleSession() takes the mode
 *     question off, except on a club form, which keeps it however few dates it
 *     covers because the club option lives on it
 *     (applyModeQuestionForSessionCount()).
 *   • ASSISTANCE — syncAssistanceQuestionsOnForm() removes the question and puts
 *     the time question in its place.
 *
 * Keep this in step with those two functions: if either stops removing the mode
 * question, this stops being the right filter. Being generous costs one form
 * opened for nothing — repairFormPageRouting() reads the shape off the form
 * itself and still decides what to write — while being narrow in the other
 * direction leaves a form mis-routing, so err towards opening.
 */
function isRoutingAffectedFormContext(context) {
  if (!context) return false;
  if (context.isAssistance) return true;
  return context.sessions.length === 1 && !context.isClub;
}

/**
 * v7 → v8: PUTS EVERY SECTION'S EXIT ON THE BREAK FORMS READS IT OFF.
 *
 * The bug this undoes is described at length above setNavigationAfterPage():
 * a page break's navigation is the transition INTO it, not out of the page it
 * opens, and every navigation write in this project used to be spelled the
 * other way round. On a complete form nothing showed, because the mode
 * question's per-answer navigation decided the branch before the misplaced
 * setting could apply. On the two shapes built WITHOUT that question — a form
 * covering one session, and an appointment form — the every-date page's SUBMIT
 * was read at the end of the page before it, and the form ended before the
 * allergies question, "Anything Else?", and every question staff had put on
 * Program_Questions.
 *
 * WHAT IT WRITES is exactly the wiring addTemplateItemsToForm() lays down,
 * re-derived from the form in front of it rather than from what the template
 * would build — the mode page's exit is the one line that differs by shape,
 * and each of the three shapes is a shape this system builds on purpose:
 *
 *   • full form         — CONTINUE, because the mode question routes its own
 *                         page and CONTINUE is the fall-through under it;
 *   • one session        — straight on to the every-date page, since the
 *                         question is gone and the roster grid's single row is
 *                         one nobody ever ticks (collapseFormToSingleSession());
 *   • appointment form   — on to the roster page, which is where an appointment
 *                         form's closing questions live (syncAssistanceQuestionsOnForm()).
 *
 * IDEMPOTENT AND CHEAP, because setNavigationAfterPage() skips a write whose
 * setting is already right: a form that has been repaired costs the reads and
 * no writes, and a re-run makes no new revision in the form's history.
 *
 * A FORM IT DOES NOT RECOGNIZE IS LEFT ALONE. The pages are found by title,
 * and a form with no mode page and no every-date page is not a form this
 * wiring describes — it is somebody's hand-built form, or a shape from before
 * these titles, and half-wiring it is worse than not touching it. Such a form
 * is reported rather than repaired, and the rebuild path is still there for it.
 */
function repairFormPageRouting(form, context) {
  const items = form.getItems();
  const pageOf = title => items.filter(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === title)[0] || null;
  const hasQuestion = title => items.some(it =>
    it.getType() !== FormApp.ItemType.PAGE_BREAK && it.getTitle() === title);

  // All three titles the mode page can be carrying — the template's own, the
  // one a single-session form was retitled to, and the appointment one. Read
  // in that order for the same reason syncAssistanceQuestionsOnForm() does.
  const modePage = pageOf(TEMPLATE_PAGE_TITLES.MODE) ||
    pageOf(TEMPLATE_PAGE_TITLES.SINGLE_DATE) ||
    pageOf(APPOINTMENT_PAGE_TITLE);
  const allDatesPage = pageOf(TEMPLATE_PAGE_TITLES.ALL_DATES);
  const specificPage = pageOf(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  if (!modePage || !allDatesPage) return { changed: 0, recognized: false };

  // THE SHAPE IS READ OFF THE FORM, not off the context — the same rule
  // restoreMultiSessionShapeOnForm() and processFormResponse() follow. A
  // checkbox on a tab is an opinion about what a form is; the questions on it
  // are the fact.
  const isAppointmentForm = hasQuestion(TEMPLATE_ITEM_TITLES.APPOINTMENT);
  const hasModeQuestion = hasQuestion(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE);

  let changed = 0;
  const write = (page, target, what) => {
    try {
      changed += setNavigationAfterPage(form, page, target);
    } catch (err) {
      log(`Could not repair ${what} on form ${form.getId()} (${err}) — continuing with the rest of it.`);
    }
  };

  // Page 1 and the guest pages all end at the mode page. Belt and braces on a
  // complete form, where the guest-count question routes page 1 by choice —
  // and the whole of the routing on a form whose guest-count question somebody
  // has deleted.
  write(null, modePage, 'the first page');
  [TEMPLATE_PAGE_TITLES.GUEST_1, TEMPLATE_PAGE_TITLES.GUEST_2, TEMPLATE_PAGE_TITLES.GUEST_3]
    .map(pageOf).filter(page => page)
    .forEach(page => write(page, modePage, 'a guest page'));

  if (isAppointmentForm && specificPage) {
    write(modePage, specificPage, 'the appointment page');
  } else if (!hasModeQuestion && !isAppointmentForm) {
    write(modePage, allDatesPage, 'the date page');
  } else {
    write(modePage, FormApp.PageNavigationType.CONTINUE, 'the sign-up page');
  }

  // The every-date branch ends the form for the people who take it — otherwise
  // they fall on into the roster grid they have just said they do not need.
  // The roster branch is the last section and submits by itself.
  if (specificPage) write(allDatesPage, FormApp.PageNavigationType.SUBMIT, 'the every-date page');

  if (changed > 0) {
    const where = context ? describeLocations(context.locations) : '';
    log(`Repaired the page routing on form ${form.getId()}${where ? ` ("${where}")` : ''}: ` +
      `${changed} navigation setting(s) moved onto the break Forms reads them off.`);
    invalidateFormItemIndex(form.getId());
  }
  return { changed: changed, recognized: true };
}

/**
 * THE SWEEP. Runs every pending migration over every live registration form,
 * in place, and stamps a form whose migrations have brought it up to
 * TEMPLATE_VERSION so migrateFormsToCurrentTemplate() does not then rebuild
 * what this has already fixed.
 *
 * Runs BEFORE the rebuild pass on every sync (see syncRegistrations()), which
 * is the order that makes it worth having: a form the repair can fix is
 * stamped current by the time the rebuild pass looks at it, and the rebuild
 * pass is left for the forms that genuinely need one — an older template's
 * questions, a hand-edited shape, a form the repair did not recognize.
 *
 * Options:
 *   • onlyFormIds — a Set limiting the sweep.
 *   • force       — ignore the ledger and re-run every migration. The writes
 *                   are idempotent, so this costs Forms reads and only the
 *                   writes that are actually needed. This is what the Admin
 *                   menu item runs.
 *   • limit       — forms opened this run (default MAX_FORM_MIGRATIONS_PER_RUN).
 *   • deadline    — a Date.now() value to stop at.
 *
 * Returns { opened, repaired, unrecognized, deferred }.
 */
function runFormStateMigrations(registrySheet, sessionRows, options) {
  options = options || {};
  const force = options.force === true;
  const only = options.onlyFormIds || null;
  const limit = options.limit || MAX_FORM_MIGRATIONS_PER_RUN;
  const deadline = options.deadline || 0;

  // `visited` is every form this pass is FINISHED with — repaired, skipped as
  // not applicable, or given up on. A caller that slices itself across
  // executions (repairFormRoutingNow()) takes the rest of its list from it, so
  // a form counted in `deferred` is the only kind that comes back next time.
  const result = { opened: 0, repaired: 0, skipped: 0, unrecognized: 0, deferred: 0, visited: [] };
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return result;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  const versions = getFormTemplateVersions();

  Object.keys(byForm).forEach(formId => {
    if (only && !only.has(formId)) return;
    const formContext = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
    // TARGETING COMES BEFORE THE LEDGER AND BEFORE THE OPEN. A migration says
    // which forms it is for from the rows alone (see the `targets` field), so a
    // form no pending migration applies to costs nothing at all — no Forms
    // call, and no ledger entry claiming a repair it never needed.
    const pending = FORM_STATE_MIGRATIONS.filter(m =>
      (force || !hasFormStateMigrationRun(formId, m.id)) &&
      (!m.targets || m.targets(formContext)));
    if (pending.length === 0) {
      // Not "done" in the ledger — just nothing to do to this form today. A
      // form whose last dates pass becomes a single-session form, and the next
      // sweep judges it fresh.
      const applicable = FORM_STATE_MIGRATIONS.some(m => !m.targets || m.targets(formContext));
      if (!applicable) result.skipped++;
      result.visited.push(formId);
      return; // the steady state — no API call at all
    }
    if (result.opened >= limit || (deadline && Date.now() >= deadline)) { result.deferred++; return; }
    result.visited.push(formId);

    let form;
    try {
      form = FormApp.openById(formId);
    } catch (err) {
      // NOT recorded as applied. A form that could not be opened has not been
      // migrated, and the next run must try it again — the rebuild pass logs
      // and reports the same failure, so this stays quiet about it.
      log(`ℹ️ runFormStateMigrations: could not open form ${formId} (${err}) — leaving it for the next run.`);
      return;
    }
    result.opened++;

    let changedHere = 0;
    let allLanded = true;
    pending.forEach(migration => {
      let outcome;
      try {
        outcome = withFormRetry(`${migration.title} on form ${formId}`,
          () => migration.apply(form, formContext));
      } catch (err) {
        log(`⚠️ ${migration.title} failed on form ${formId} (${err}) — the form is unchanged and the ` +
          `next run will try again.`);
        noteForAdmin('Forms that could not be updated',
          `${formId} could not have "${migration.title}" applied: ${err}. Its link and its questions are ` +
          `untouched; if this keeps happening, Admin → Rebuild Forms In Place will fix the form the long way.`);
        allLanded = false; // unknown state — do not stamp, do not record
        return;
      }
      // A migration may answer with a count or with { changed, recognized }.
      // ONE MIGRATION'S REFUSAL IS ITS OWN: the ones beside it are still
      // recorded, so a form that a later migration cannot read is not made to
      // re-run every earlier one for the rest of its life.
      const changed = (outcome && typeof outcome === 'object') ? (outcome.changed || 0) : (outcome || 0);
      const landed = !(outcome && typeof outcome === 'object' && outcome.recognized === false);
      changedHere += changed;
      if (landed) markFormStateMigrationApplied(formId, migration.id);
      else allLanded = false;
    });

    if (!allLanded) {
      result.unrecognized++;
      // DELIBERATELY NOT recorded and NOT stamped: a form this could not read
      // is exactly the form the rebuild pass should still be allowed to have.
      log(`Form ${formId} is not on a shape these repairs describe — leaving it for the rebuild pass.`);
    } else {
      if (changedHere > 0) result.repaired++;
      // STAMPED, so the rebuild pass skips it. Safe only because every
      // migration carrying a `version` is the WHOLE of what that version
      // changed — the day a version changes something a migration cannot
      // reach, that migration does not get a version and this does not stamp.
      const covered = FORM_STATE_MIGRATIONS.every(m =>
        m.version !== TEMPLATE_VERSION || hasFormStateMigrationRun(formId, m.id));
      const anyForThisVersion = FORM_STATE_MIGRATIONS.some(m => m.version === TEMPLATE_VERSION);
      if (covered && anyForThisVersion && versions[formId] !== TEMPLATE_VERSION) {
        setFormTemplateVersion(formId, TEMPLATE_VERSION);
      }
    }
    // A breath between forms, for the reason migrateFormsToCurrentTemplate()
    // gives: several documents' worth of writes back to back is what makes
    // Forms start answering "please wait and try again".
    if (changedHere > 0 && result.opened < limit) Utilities.sleep(500);
  });

  if (result.repaired > 0) {
    log(`Form repairs: ${result.repaired} form(s) fixed in place, no rebuild needed` +
      (result.skipped > 0
        ? `; ${result.skipped} form(s) were not opened at all — nothing pending applies to their shape.`
        : '.'));
  }
  if (result.deferred > 0) {
    log(`${result.deferred} more form(s) still to check — they'll be picked up on the next run.`);
  }
  flushFormStateMigrationLedger();
  flushPersistentRegistries();
  return result;
}

// ---------------------------------------------------------------------------
// THE MENU ACTION, AND HOW IT FINISHES BY ITSELF
//
// A repair is cheap — a handful of Forms reads and the settings that are
// actually wrong — but a workbook can carry hundreds of forms, and an Apps
// Script execution is killed at six minutes with no warning and no return
// value. The old shape of this action spent what time it had and then told the
// person "run this again to continue", which on a large workbook meant
// clicking it, reading a number, and clicking it again until the number
// stopped moving.
//
// It now hands ITSELF on: a slice works until its budget is spent, and if any
// form is still unvisited it arms a one-off trigger that calls the sweep again
// where it stopped. The list of forms left is kept in Script Properties, so a
// slice that dies outright — the ceiling, a thrown error — loses nothing but
// its own progress, and the watchdog trigger armed at the top of every slice
// restarts it. The state machine behind that is runSlicedJob() in 74, shared
// with the bootstrap import (25) and the two form sweeps (32, 49) — this is
// the one caller with no lock and no automation pause, since nothing this
// repair writes conflicts with a sync the way replacing a form would. The
// stored state keeps its key and shape, so a repair already in flight resumes
// untouched.
// ---------------------------------------------------------------------------

/** { startedAt, lastSliceAt, slices, remaining: [formId], opened, repaired, skipped, unrecognized } */
const FORM_ROUTING_REPAIR_STATE_PROP_KEY = 'FORM_ROUTING_REPAIR_STATE_V1';

/** Handler name for the hand-off between slices. Mirrors IN_PLACE_REBUILD_RESUME_HANDLER. */
const FORM_ROUTING_REPAIR_RESUME_HANDLER = 'resumeFormRoutingRepair';

/**
 * How long one slice spends repairing. Short of the six-minute ceiling by
 * enough to write the state, arm the successor and report — a slice that runs
 * into the ceiling instead is recovered by the watchdog, but a minute and a
 * half later.
 */
const FORM_ROUTING_REPAIR_SLICE_BUDGET_MS = 4 * 60 * 1000;

/** Gap between slices. Short: nothing here holds the workbook, so there is little to yield to. */
const FORM_ROUTING_REPAIR_RESUME_DELAY_MS = 15 * 1000;

/** If a slice dies outright, this is what restarts the sweep. */
const FORM_ROUTING_REPAIR_WATCHDOG_DELAY_MS = FORM_ROUTING_REPAIR_SLICE_BUDGET_MS + 2.5 * 60 * 1000;

/** A ceiling on slices, so a sweep that cannot advance ends rather than handing on forever. */
const FORM_ROUTING_REPAIR_MAX_SLICES = 40;

/**
 * A single slice that repairs nothing ends the sweep — not two in a row, like
 * the other sliced jobs. Handing this one on again would only ask the exact
 * same `remaining` list the exact same question, since nothing here changes
 * what runFormStateMigrations() would find; ending immediately and saying so
 * beats a trigger that never stops.
 */
const FORM_ROUTING_REPAIR_MAX_STALLED_SLICES = 1;

/** A sweep that has not advanced in this long is abandoned rather than blocking the next click. */
const FORM_ROUTING_REPAIR_STALE_MS = 30 * 60 * 1000;

function getFormRoutingRepairState() {
  return getSlicedJobState(FORM_ROUTING_REPAIR_STATE_PROP_KEY, 'Routing repair');
}

function saveFormRoutingRepairState(state) {
  saveSlicedJobState(FORM_ROUTING_REPAIR_STATE_PROP_KEY, state);
}

/** Is a routing repair in flight? Stale state reads as "no". */
function isFormRoutingRepairActive() {
  return isSlicedJobActive(FORM_ROUTING_REPAIR_STATE_PROP_KEY, FORM_ROUTING_REPAIR_STALE_MS, minutes =>
    `⚠️ Ignoring a routing repair that has not advanced in ${minutes} minute(s).`);
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. */
function armFormRoutingRepairResume(delayMs) {
  armSlicedJobResume(FORM_ROUTING_REPAIR_RESUME_HANDLER, delayMs);
}

function deleteFormRoutingRepairResumeTriggers() {
  return deleteSlicedJobResumeTriggers(FORM_ROUTING_REPAIR_RESUME_HANDLER);
}

/**
 * ADMIN → "Fix Form Page Routing (no rebuild)". Runs every registered
 * migration over the forms it applies to, ledger ignored, and says what it did.
 *
 * The un-destructive sibling of "Rebuild Forms In Place": no question is
 * replaced, no pre-checked box is regenerated, no link moves — the only writes
 * are the navigation settings that are actually wrong. Someone who has just
 * pulled a fix and does not want to wait an hour for the sync runs this.
 *
 * ONE CLICK IS THE WHOLE JOB. What does not fit in this execution is carried on
 * by a hand-off trigger until every form has been looked at; the dialog says so
 * rather than asking for another click.
 */
function repairFormRoutingNow() {
  if (!requireAuthorizedAdmin('Fix Form Page Routing')) return;
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    ui.alert(`There is no "${SHEET_NAMES.PROGRAM_DASHBOARD}" tab to read the forms from yet.`);
    return;
  }
  if (isFormRoutingRepairActive()) {
    ui.alert('A routing check is already running in the background and will finish on its own — ' +
      'leaving it alone.');
    return;
  }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const formIds = Object.keys(groupRegistryRowsByForm(readAllSectionedRows(registrySheet, headers, 'Event_ID'), map));
  if (formIds.length === 0) {
    ui.alert('There is no form on this workbook to check yet.');
    return;
  }

  saveFormRoutingRepairState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0,
    remaining: formIds, opened: 0, repaired: 0, skipped: 0, unrecognized: 0
  });
  toastIfPossible('Checking every form’s page routing…');

  const state = runFormRoutingRepairSlice();
  const totals = state || getFormRoutingRepairState();
  reportFormRoutingRepair(totals, ui);
}

/**
 * Trigger handler for the next slice. Never call this directly — use
 * repairFormRoutingNow().
 *
 * Not behind the Automation_Enabled kill switch, for the reason
 * resumeInPlaceFormRebuild() isn't: a sweep stopped halfway is not a paused
 * sweep, it is a stranded one, and its state would go on telling the next click
 * that a repair is already running.
 */
function resumeFormRoutingRepair() {
  runFormRoutingRepairSlice();
}

/**
 * One execution's worth of repairing. Returns the state as it stands after
 * this slice — `remaining` empty means the sweep is finished.
 *
 * The state machine — watchdog, slice count, deadline, hand-off — is
 * runSlicedJob() in 74. This job has no lock and no automation pause (nothing
 * it writes conflicts with a sync the way a form REPLACEMENT would), so its
 * `work` is the whole slice: one batched call into runFormStateMigrations()
 * over whatever forms are still `remaining`.
 */
function runFormRoutingRepairSlice() {
  return runSlicedJob({
    label: 'Routing repair',
    propKey: FORM_ROUTING_REPAIR_STATE_PROP_KEY,
    resumeHandler: FORM_ROUTING_REPAIR_RESUME_HANDLER,
    budgetMs: FORM_ROUTING_REPAIR_SLICE_BUDGET_MS,
    resumeDelayMs: FORM_ROUTING_REPAIR_RESUME_DELAY_MS,
    watchdogDelayMs: FORM_ROUTING_REPAIR_WATCHDOG_DELAY_MS,
    maxSlices: FORM_ROUTING_REPAIR_MAX_SLICES,
    maxStalledSlices: FORM_ROUTING_REPAIR_MAX_STALLED_SLICES,

    work: ctx => {
      const state = ctx.state;
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
      if (!registrySheet) return { stop: 'stopped — the program dashboard sheet is gone' };
      if (!state.remaining || state.remaining.length === 0) return { finished: true };

      // force: the ledger is what the hourly sync goes by, and a person clicking
      // this is asking for the forms to be looked at again whatever it says.
      // No limit: the deadline is the limit, and it is the honest one.
      const result = runFormStateMigrations(registrySheet, null, {
        force: true, limit: 100000, onlyFormIds: new Set(state.remaining),
        deadline: ctx.deadline
      });

      state.opened += result.opened;
      state.repaired += result.repaired;
      state.skipped += result.skipped;
      state.unrecognized += result.unrecognized;
      const visited = new Set(result.visited);
      const before = state.remaining.length;
      state.remaining = state.remaining.filter(id => !visited.has(id));
      if (state.remaining.length === 0) return { finished: true };

      return { processed: before - state.remaining.length, remaining: state.remaining.length };
    },

    onHandOff: state => {
      toastIfPossible(`Routing check: ${state.opened} form(s) done, ${state.remaining.length} to go. ` +
        `This continues by itself — no need to run it again.`);
    },

    overrunProblem: () => `stopped after ${FORM_ROUTING_REPAIR_MAX_SLICES} runs without finishing`,
    // Nothing moved and there is still a list: handing on again would only
    // repeat this. Ending and saying so beats a trigger that never stops.
    stalledProblem: result => `stopped — ${result.remaining} form(s) could not be checked`,

    // An exception, unlike a timeout, is ours to handle: end the sweep tidily
    // rather than leaving its state to block the next click for half an hour.
    onError: err => { log(`⚠️ The routing repair run failed (${err}).`); },
    errorProblem: err => `stopped after an error: ${err}`,

    onDone: (state, problem) => finishFormRoutingRepair(state, problem)
  });
}

/** Ends the sweep: clear the state, drop the hand-off trigger, say what happened. */
function finishFormRoutingRepair(state, problem) {
  clearSlicedJobState(FORM_ROUTING_REPAIR_STATE_PROP_KEY);
  deleteFormRoutingRepairResumeTriggers();
  const finished = Object.assign({}, state, { problem: problem || '' });
  const headline = describeFormRoutingRepair(finished).join(' · ');
  log(`repairFormRoutingNow: ${problem ? `⚠️ ${problem}. ` : ''}${headline}`);
  if (problem) noteForAdmin('Form page routing', `${problem}. ${headline}`);
  flushAdminDigest('Form page routing');
  return finished;
}

/** The lines both the dialog and the log are built from. */
function describeFormRoutingRepair(state) {
  const lines = [
    `Forms opened: ${state.opened || 0}`,
    `Fixed in place: ${state.repaired || 0}`
  ];
  if (state.skipped > 0) {
    lines.push(`Not opened: ${state.skipped} — the routing fix only reaches the single-session and ` +
      `appointment forms, and every other form routes by its sign-up question's own answers.`);
  }
  if (state.unrecognized > 0) {
    lines.push(`Left alone: ${state.unrecognized} — these are not on a shape this repair describes. ` +
      `Admin → Rebuild Forms In Place will bring them up to date the long way.`);
  }
  return lines;
}

/** The dialog at the end of the first slice. Later slices have no UI to talk to. */
function reportFormRoutingRepair(state, ui) {
  if (!state) return;
  const lines = describeFormRoutingRepair(state);
  const left = (state.remaining || []).length;
  if (state.problem) {
    lines.push('', `⚠️ The check ${state.problem}.`);
  } else if (left > 0) {
    lines.push('', `Still to check: ${left}. This carries on in the background until it is done — ` +
      `you do NOT need to run it again.`);
  } else if (state.opened > 0 && state.repaired === 0 && state.unrecognized === 0) {
    lines.push('', 'Every form was already routing correctly. Nothing was written, so no form gained a ' +
      'revision in its history.');
  }
  if (state.repaired > 0) {
    lines.push('', 'Links are unchanged, questions are unchanged, and answers already collected are ' +
      'untouched — only where each page sends people has moved.');
  }
  ui.alert('Form page routing', lines.join('\n'), ui.ButtonSet.OK);
}
