// ============================================================================
// 98. A SYNC THAT RUNS OUT OF TIME FINISHES LATER  (runRegistrationSyncSlice)
// ============================================================================
//
// syncRegistrations() is the longest thing this workbook does, and it grew
// that way one honest step at a time. It opens every registration form and
// asks each for its new responses; it repairs the forms whose shape has
// drifted; it catches up the "every date" registrants and the club rosters; it
// writes the Registrants tab; it recounts capacity, refreshes every form's
// date labels and every appointment form's times, rebuilds four dashboards and
// the memory tabs, creates and pushes a shared roster per program, emails the
// leaders, invites the registrants to the calendar events and sends the
// reminders. Every one of those is a step somebody asked for; together they
// are minutes, and on a centre with a hundred forms they are more minutes than
// Apps Script allows an execution.
//
// AND APPS SCRIPT DOES NOT ASK. It kills the execution at its ceiling — six
// minutes on a consumer account, thirty on Workspace — with no warning, no
// exception and no `finally`. Whatever the run was in the middle of simply
// stops. The registration import survives that (the sync clock is only
// advanced once the rows are on the tab, so the next run reads the same
// responses again), but everything downstream of the kill silently did not
// happen: the leader whose roster changed is not told, the invitation is not
// sent, the dashboard shows last hour's numbers. Hourly, forever, on the
// workbook that is busiest.
//
// SO THE SYNC IS A SLICED JOB NOW. It works until its budget is spent
// (Config's "How Long a Sync May Run", a few minutes short of whatever ceiling
// this account has), records exactly where it stopped, and hands the rest to a
// follow-up trigger a minute later. The state machine around that — the
// watchdog armed before any work, the deadline, the slice counter, the stall
// detection and the hand-off — is runSlicedJob() in 75_sliced_jobs.gs, exactly
// as it is for the four other long jobs here. What lives in this file is what
// 75 deliberately does not hold: this job's own plan, its own steps, and its
// own words.
//
// ---------------------------------------------------------------------------
// WHAT A SLICE MAY AND MAY NOT LEAVE HALF-DONE
//
// The plan has two halves, and only one of them may be interrupted.
//
// THE IMPORT is the half that cannot lose anything. It reads the forms, builds
// the rows and writes the Registrants tab, and it is the one thing this sync
// does that nothing else will do later. A slice that runs out of budget
// part-way through the FORM LOOP still writes the rows it built — but it does
// NOT advance the sync clock, and it records which forms it has not reached
// yet. The next slice reads the same window, from the same `lastSync`, for the
// forms that are left. Only when every form in the window has been read does
// the clock move to the moment the window opened. That is the same bargain the
// unsliced sync already made with a crash; it is now made on purpose.
//
// (Re-reading a form that was already imported is safe and always has been —
// it is what happens today whenever a sync fails before the clock advances.
// Every row is matched back to the row it wrote by registrantImportKey().)
//
// THE TAIL is the half that may stop anywhere. Every step in
// REGISTRATION_SYNC_TAIL_STEPS is a rebuild or a send that is derived from
// what is already on the tabs, so a step that has not run yet is a step the
// next slice runs from the same rows. They are kept IN ORDER, because the
// order is load-bearing in three places the comments below name — the rosters
// go out before the leaders are told about them, the invitations before the
// reminders, the counts before the forms are relabelled with them.
//
// ---------------------------------------------------------------------------
// WHY NOT SIMPLY "PICK IT UP NEXT HOUR"
//
// Because the tail is where everything that leaves the building lives, and the
// steps at the end of it are the ones a full workbook never reaches. A sync
// that spends its whole hour on forms and dashboards and is killed before the
// invitations would never send an invitation again, and nothing would say so.
// A hand-off costs one trigger and a minute.
// ============================================================================

/** Minutes one slice may work for when Config says nothing — see seedSyncBudgetRow(). */
const DEFAULT_SYNC_BUDGET_MINUTES = 25;

/**
 * The range Config's own cell is believed within. Below the floor a slice
 * would stop before it started; above the ceiling there is no Apps Script
 * account the number could be true of, so it is a typo rather than a policy.
 */
const MIN_SYNC_BUDGET_MINUTES = 1;
const MAX_SYNC_BUDGET_MINUTES = 55;

/** Where a part-finished sync remembers what is left. Versioned like every stored shape. */
const REGISTRATION_SYNC_STATE_PROP_KEY = 'REGISTRATION_SYNC_PLAN_V1';

/** The handler the hand-off trigger names. */
const REGISTRATION_SYNC_RESUME_HANDLER = 'resumeRegistrationSync';

/** Gap before the next slice after a clean hand-off — long enough to be a new execution. */
const REGISTRATION_SYNC_RESUME_DELAY_MS = 60 * 1000;

/**
 * The successor armed at the HEAD of every slice, in case this one is killed
 * outright. Deliberately longer than any budget plus the resume delay, so the
 * ordinary hand-off replaces it rather than racing it.
 */
const REGISTRATION_SYNC_WATCHDOG_DELAY_MS = 5 * 60 * 1000;

/**
 * The ceiling on slices for ONE window. A sync that cannot finish in this many
 * runs is not going to, and going round for ever would mean the hourly trigger
 * never opening a fresh window — which is how new registrations stop arriving.
 */
const REGISTRATION_SYNC_MAX_SLICES = 12;

/** Slices in a row that move nothing before the plan is abandoned. */
const REGISTRATION_SYNC_MAX_STALLED_SLICES = 2;

/**
 * A plan older than this is wreckage, not work in progress: something took the
 * watchdog with it. The hourly trigger opens a fresh window instead of
 * resuming a window whose `lastSync` may be a day old.
 */
const REGISTRATION_SYNC_STALE_MS = 2 * 60 * 60 * 1000;

// ============================================================================
// THE TAIL
// ============================================================================
//
// One entry per step, in the order they must run. `id` is what a part-finished
// plan stores, so it is a stored shape: renaming one strands the plans that
// name it (harmless — an unknown id is skipped — but the step is then missed
// once). `label` is what the person reads when a step could not run.
//
// Every `run` takes the same context and reaches its work through a hoisted
// function declaration, so this table declares nothing that has to exist at
// load time. See the banner at the top of CLAUDE.md for why that matters.
// ============================================================================
const REGISTRATION_SYNC_TAIL_STEPS = [
  {
    id: 'counts',
    label: 'recounting registrations against capacity',
    run: ctx => recomputeEventRegistryCounts(ctx.registrySheet, ctx.registrantsSheet, ctx.registrantRows())
  },
  {
    // AFTER the counts, on purpose: a capacity label tells a form which dates
    // are full, and it can only be right if the counts already are.
    id: 'form_shapes',
    label: "refreshing the forms' dates and lunch questions",
    run: ctx => refreshFormShapeForAllForms(ctx.registrySheet)
  },
  {
    // The appointment half of the same idea, on the same fresh counts: this
    // tells an appointment form which TIMES are gone. A form still offering a
    // slot somebody took an hour ago is how two people end up in one chair.
    id: 'appointment_slots',
    label: 'refreshing the appointment times on forms',
    run: ctx => refreshAppointmentSlotsForAllForms(ctx.registrySheet, ctx.sessionRows(), ctx.registrantRows())
  },
  {
    // Reports back whether its triage pass MOVED registrant rows off the tab.
    // When it did, every step below has to re-read rather than reuse the array
    // this run built — see ctx.reusableRows().
    id: 'program_dashboard',
    label: 'rebuilding the program dashboard',
    run: ctx => {
      const result = renderProgramDashboard(false, { registrantRows: ctx.registrantRows() }) ||
        { registrantsMoved: false };
      if (result.registrantsMoved) ctx.noteRegistrantsMoved();
    }
  },
  {
    id: 'lunch_dashboard',
    label: 'rebuilding the lunch dashboard',
    run: ctx => updateMasterLunchDashboard(ctx.reusableRows())
  },
  {
    id: 'memory_tabs',
    label: 'refreshing the memory tabs',
    run: ctx => refreshMemoryTabs(ctx.reusableRows(), null)
  },
  {
    id: 'club_tab',
    label: 'rebuilding the club roster tab',
    run: ctx => renderClubMembersSheet(refreshClubMemberLabels(ctx.sessionRows()))
  },
  {
    // BEFORE THE PUSH, both of these, so a sheet born on this run is filled
    // from the settled picture on the same run rather than sitting empty for
    // an hour. Two reasons a program gets a sheet, deliberately separate: the
    // horizon pass builds one for EVERY program a week before its next
    // session, and the leader pass builds one for a program whose leader has
    // just asked to hear about its roster whether or not it runs this week.
    // Either may find the other already did it.
    id: 'leader_sheets_upcoming',
    label: "creating the upcoming programs' registrant sheets",
    run: ctx => ensureRegistrantSheetsForUpcomingPrograms(ctx.ss, ctx.sessionRows())
  },
  {
    id: 'leader_sheets_notifying',
    label: 'creating registrant sheets for the notifying leaders',
    run: ctx => ensureProgramLeaderSheetsForNotifyingLeaders(ctx.ss, ctx.sessionRows())
  },
  {
    // The other half of the registrant-sheet round trip, and the reason that
    // feature needs no trigger of its own: the rosters go back out on the same
    // hourly pass that just imported into them.
    id: 'leader_sheets_push',
    label: 'refreshing the program registrant sheets',
    run: ctx => pushProgramLeaderSheets(ctx.sessionRows(), ctx.settledRows())
  },
  {
    // AFTER the push, deliberately. The alert links to the shared sheet and
    // says what moved on it; a leader who follows that link within the minute
    // should not find a sheet that still lists the person who left.
    id: 'leader_alerts',
    label: 'sending the roster-change alerts',
    run: ctx => notifyProgramLeadersOfRosterChanges(ctx.sessionRows(), ctx.settledRows())
  },
  {
    // The other Notify_Timing channel, right after the diff pass — see
    // LEADER_DIGEST_QUOTA_RESERVE for why the order of these three mail passes
    // is load-bearing against the shared daily quota.
    id: 'leader_digests',
    label: 'sending the roster digests',
    run: ctx => sendProgramLeaderDaySnapshotDigests(ctx.sessionRows(), ctx.settledRows())
  },
  {
    // The step that reaches outside the workbook to other people, so it acts
    // on the settled picture rather than on rows a later step might cancel.
    id: 'calendar_invites',
    label: 'sending the calendar invitations',
    run: ctx => inviteRegistrantsToCalendarEvents(ctx.sessionRows(), ctx.reusableRows())
  },
  {
    // After the invitations, because an appointment's confirmation should not
    // reach somebody before the calendar entry it is about.
    id: 'registrant_reminders',
    label: 'sending the registrant reminders',
    run: ctx => sendRegistrantReminders(ctx.sessionRows(), ctx.reusableRows())
  }
];

/** Every tail step's id, in order — what a fresh plan starts with. */
function registrationSyncTailIds() {
  return REGISTRATION_SYNC_TAIL_STEPS.map(step => step.id);
}

function registrationSyncTailStep(id) {
  for (let i = 0; i < REGISTRATION_SYNC_TAIL_STEPS.length; i++) {
    if (REGISTRATION_SYNC_TAIL_STEPS[i].id === id) return REGISTRATION_SYNC_TAIL_STEPS[i];
  }
  return null;
}

// ============================================================================
// THE PLAN
// ============================================================================

/**
 * A fresh window: the moment it opened, the clock its form reads are bounded
 * by, every form it has to read, and every tail step it has to run.
 *
 * `windowOpenedAt` becomes LAST_FORM_SYNC_TIME — but only once every form in
 * `pendingFormIds` has been read. It is recorded when the window opens rather
 * than when it closes because a response submitted DURING the sync must be
 * read by the next one; taking the closing time would skip it.
 */
function newRegistrationSyncPlan() {
  return {
    startedAt: Date.now(),
    lastSliceAt: Date.now(),
    slices: 0,
    stalledSlices: 0,
    errorSlices: 0,
    windowOpenedAt: new Date().toISOString(),
    lastSync: getLastSyncTime().toISOString(),
    // Filled by the first slice, once it has read the session table.
    pendingFormIds: null,
    formsRead: 0,
    importedRows: 0,
    importDone: false,
    tail: registrationSyncTailIds(),
    problems: []
  };
}

/**
 * Is a part-finished sync waiting to be picked up — as opposed to a plan that
 * was written down and then died with whatever was running it?
 *
 * The staleness question is the whole of it. A plan carries the `lastSync` its
 * unread forms are still bounded by, and resuming one whose last slice was
 * hours ago would import a window that has since been overtaken; opening a
 * fresh one is the honest answer. REGISTRATION_SYNC_STALE_MS is generous
 * because an ordinary hand-off is a minute.
 */
function isRegistrationSyncInFlight() {
  return isSlicedJobActive(REGISTRATION_SYNC_STATE_PROP_KEY, REGISTRATION_SYNC_STALE_MS);
}

/**
 * The context every phase and every tail step is handed.
 *
 * The row accessors are the interesting part. On the FIRST slice the import
 * has just built `combinedRegistrantRows` and every step downstream can work
 * from it rather than re-reading the tab. On a RESUME slice that array is
 * gone — the execution that built it is over — so the same accessor reads the
 * tab, which is where the import put it. Either way a step asks the same
 * question and gets the rows that are on the sheet.
 *
 * `reusableRows()` is the one that answers null: renderProgramDashboard()'s
 * triage pass can MOVE registrant rows off the tab, and after that the array
 * this run is holding describes rows that are no longer there. Every consumer
 * below it takes null to mean "read it yourself".
 */
function buildRegistrationSyncContext(plan, deadline) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  let rows = null;            // what the import wrote, when this slice did the import
  let moved = false;          // the triage pass took rows off the tab

  const ctx = {
    plan,
    deadline,
    ss,
    registrySheet,
    registrantsSheet,
    problems: [],
    outOfTime: () => Date.now() >= deadline,
    sessionRows: () => getSectionedRows(registrySheet, HEADERS.All_Program_Sessions, 'Event_ID'),
    // The rows the tab holds. `getSectionedRows` is the per-execution cache
    // (08), so a resume slice pays for this once however many steps ask.
    registrantRows: () => rows ||
      getSectionedRows(registrantsSheet, HEADERS.All_Registrants, 'Event_ID'),
    setRegistrantRows: value => { rows = value; },
    noteRegistrantsMoved: () => { moved = true; rows = null; },
    reusableRows: () => (moved ? null : ctx.registrantRows()),
    settledRows: () => ctx.registrantRows(),

    // ONE STEP FAILING IS NOT THE RUN FAILING — the guard the unsliced sync
    // already wrapped every optional step in, moved here so the import phase
    // and the tail share one. The throw this was written for is a PERMISSION
    // error, from a second account meeting a protected range or a file it does
    // not own; unguarded, a single one ended the whole sync.
    step: (label, fn) => {
      try {
        return fn();
      } catch (err) {
        ctx.problems.push(label);
        log(`⚠️ Registration sync: ${label} failed (${err}) — carrying on with the rest of the run.`);
        noteForAdmin('Parts of the sync that could not run',
          `${label} — ${err}.` + (isPermissionError(err)
            ? ` That is a permissions failure, not a fault in the data: this account is not allowed to ` +
              `change what it just tried to. Run the sync as the account that owns the workbook, or use ` +
              `🔧 Admin ▸ 🔓 Open Up Form Sharing for a form it cannot reach.`
            : ''));
        return undefined;
      }
    }
  };
  return ctx;
}

// ============================================================================
// THE SLICE
// ============================================================================

/**
 * One execution's worth of a registration sync.
 *
 * `options.openWindow` is true for the hourly trigger and the menu item, and
 * false for the hand-off. Opening a window when one is already in flight would
 * throw away a part-finished plan and, with it, the `lastSync` its unread
 * forms are still bounded by — so it does not: a scheduled run that arrives
 * mid-plan carries that plan forward instead, and the NEXT one opens the fresh
 * window.
 */
function runRegistrationSyncSlice(options) {
  options = options || {};
  const label = 'Registration sync';
  let state = getSlicedJobState(REGISTRATION_SYNC_STATE_PROP_KEY, label);

  if (state && !isRegistrationSyncInFlight()) {
    log(`${label}: the part-finished plan from ` +
      `${Math.round((Date.now() - (state.lastSliceAt || state.startedAt || 0)) / 60000)} minute(s) ago ` +
      `is too old to resume — starting a fresh window.`);
    state = null;
  }
  if (!state) {
    if (!options.openWindow) {
      // A hand-off that arrived after the plan finished. Nothing to do, and
      // the leftover trigger goes with it.
      deleteSlicedJobResumeTriggers(REGISTRATION_SYNC_RESUME_HANDLER);
      return null;
    }
    saveSlicedJobState(REGISTRATION_SYNC_STATE_PROP_KEY, newRegistrationSyncPlan());
  }

  return runSlicedJob({
    propKey: REGISTRATION_SYNC_STATE_PROP_KEY,
    label,
    resumeHandler: REGISTRATION_SYNC_RESUME_HANDLER,
    budgetMs: getSyncSliceBudgetMs(),
    resumeDelayMs: REGISTRATION_SYNC_RESUME_DELAY_MS,
    watchdogDelayMs: REGISTRATION_SYNC_WATCHDOG_DELAY_MS,
    maxSlices: REGISTRATION_SYNC_MAX_SLICES,
    maxStalledSlices: REGISTRATION_SYNC_MAX_STALLED_SLICES,
    // A sync meets a form it cannot read most weeks; one bad slice is not a
    // reason to abandon a window whose rows are already on the tab.
    maxErrorSlices: 2,

    // THE SAME LOCK THE UNSLICED SYNC TOOK, and for the same sharp reason:
    // this reads every registrant row, adds to them in memory and writes the
    // whole tab back. Two overlapping runs both read the same "before"
    // picture, and whichever finishes last overwrites the other's new rows.
    // Held for the whole slice, as it always was. Not getting it SKIPS the
    // slice — the watchdog armed above this is what brings the next one, which
    // is new: the unsliced sync simply gave up for an hour.
    around: run => {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
        log('syncRegistrations: another sync is already running — this slice will be retried.');
        toastIfPossible('Another sync is already running — try again in a moment.');
        return null;
      }
      try {
        return run();
      } finally {
        lock.releaseLock();
      }
    },

    work: ctx => runRegistrationSyncPhases_(ctx),

    madeProgress: (state, result) => result.processed > 0,

    onError: (err, n, max) =>
      log(`⚠️ Registration sync slice ${n}/${max} ended in an error: ${err}`),

    overrunProblem: () =>
      `this sync has taken ${REGISTRATION_SYNC_MAX_SLICES} runs and is still not finished. ` +
      `The steps it had not reached will be picked up by the next hourly sync.`,
    stalledProblem: (result, state) =>
      `${REGISTRATION_SYNC_MAX_STALLED_SLICES} runs in a row got nothing done, with ` +
      `${(state.tail || []).length} step(s) still to go.`,
    errorProblem: (err, n) => `it failed ${n} run(s) in a row (${err}).`,
    saveErrorProblem: err => `it could not record what it had done (${err}).`,

    onDone: (state, problem) => finishRegistrationSync_(state, problem)
  });
}

/**
 * THE WHOLE SYNC, IN ONE GO, WITH NO LOCK AND NO HAND-OFF.
 *
 * Four places need the registrations imported BEFORE they do something that
 * would destroy them — the in-place form rebuild and its one-form cousin (32),
 * the destroy-and-rebuild sweep (49) and the program review's own update
 * (58) — and a fifth reason they all share: every one of them already holds
 * the workbook lock and is itself a slice of a sliced job with its own budget
 * and its own hand-off. Handing off from inside one of those would arm a
 * second resume trigger for work the outer job is in the middle of, and taking
 * the lock again from inside a hold is not a thing to rely on.
 *
 * So they get the unsliced sync: no budget (the caller's own is what bounds
 * it), no lock (the caller holds it), no state written and no trigger armed.
 * This is exactly what syncRegistrationsInternal() did before this file
 * existed, which is the point — those four call sites are unchanged.
 */
function syncRegistrationsInternal() {
  const plan = newRegistrationSyncPlan();
  const ctx = {
    state: plan,
    // No deadline at all. `Date.now() >= Infinity` is false however long this
    // takes, which is what "run the whole thing" means here.
    deadline: Infinity,
    save: () => {}
  };
  const result = runRegistrationSyncPhases_(ctx);
  flushAdminDigest('Registration sync');
  const problems = plan.problems || [];
  if (problems.length === 0) {
    toastIfPossible(`Registration sync complete ✅ — ${plan.importedRows || 0} new row(s).`);
  } else {
    toastIfPossible(`Registration sync finished with problems ⚠️ — ${plan.importedRows || 0} new row(s) ` +
      `imported, but ${problems.length} step(s) could not run: ${problems.join('; ')}. See the log.`);
  }
  return result;
}

/**
 * The hand-off trigger's handler.
 *
 * GATED LIKE THE SYNC IT CONTINUES. Somebody who pauses automation while a
 * sync is mid-plan means "stop", and a follow-up run that carried on would be
 * the one thing the kill switch could not stop. The plan stays in Script
 * Properties and goes stale on its own; the next unpaused hourly run opens a
 * fresh window, which is the right answer after a pause of any length.
 */
function resumeRegistrationSync() {
  if (!automationGateAllows('Sync Registrations', true)) {
    deleteSlicedJobResumeTriggers(REGISTRATION_SYNC_RESUME_HANDLER);
    return null;
  }
  if (isBootstrapActive()) {
    // Re-armed rather than dropped: the one-off trigger that just fired is
    // spent, and the plan it was carrying would otherwise sit until it went
    // stale. A sweep that rewrites the session table is minutes, not hours.
    log('resumeRegistrationSync: a large-setup import or forms-rebuild sweep is writing to the ' +
      'session table — this slice will be retried.');
    armSlicedJobResume(REGISTRATION_SYNC_RESUME_HANDLER, REGISTRATION_SYNC_WATCHDOG_DELAY_MS);
    return null;
  }
  const outcome = runRegistrationSyncSlice({ openWindow: false });
  if (outcome && outcome.finished) warmQuickMarkAfterSync_();
  return outcome;
}

/**
 * The two halves, in order, inside one slice's budget.
 *
 * Returns the runSlicedJob() contract: `{ finished: true }` when the whole
 * window is done, `{ processed, remaining }` when there is more to do.
 */
function runRegistrationSyncPhases_(ctx) {
  const sync = buildRegistrationSyncContext(ctx.state, ctx.deadline);
  let processed = 0;

  if (!ctx.state.importDone) {
    processed += runRegistrationImportPhase(sync);
    ctx.save();
    if (!ctx.state.importDone) {
      // Forms are still unread and the budget is gone. The rows built so far
      // are on the tab; the clock has NOT moved, so the next slice reads the
      // same window for the forms that are left.
      return { processed: processed + 1, remaining: (ctx.state.pendingFormIds || []).length };
    }
  }

  while (ctx.state.tail.length > 0) {
    if (Date.now() >= ctx.deadline) {
      log(`Registration sync: budget spent with ${ctx.state.tail.length} step(s) to go — ` +
        `handing them to a follow-up run.`);
      ctx.save();
      return { processed, remaining: ctx.state.tail.length };
    }
    const id = ctx.state.tail[0];
    const step = registrationSyncTailStep(id);
    if (step) sync.step(step.label, () => step.run(sync));
    // Dropped whether it ran, failed or is an id this version no longer knows:
    // a step that threw is not retried inside the same window, exactly as it
    // was not before this file existed.
    ctx.state.tail.shift();
    ctx.state.problems = (ctx.state.problems || []).concat(sync.problems.splice(0));
    processed++;
    ctx.save();
  }

  ctx.state.importedRows = ctx.state.importedRows || 0;
  return { finished: true, processed };
}

/**
 * The end of a window, however it ended: clear the plan, drop the hand-off,
 * flush what the office is owed, and say what happened.
 */
function finishRegistrationSync_(state, problem) {
  clearSlicedJobState(REGISTRATION_SYNC_STATE_PROP_KEY);
  deleteSlicedJobResumeTriggers(REGISTRATION_SYNC_RESUME_HANDLER);

  const problems = (state && state.problems) || [];
  const imported = (state && state.importedRows) || 0;
  const slices = (state && state.slices) || 1;
  const across = slices > 1 ? ` across ${slices} runs` : '';

  if (problem) {
    log(`⚠️ Registration sync ended early: ${problem}`);
    noteForAdmin('The registration sync did not finish', problem);
  }
  flushAdminDigest('Registration sync');

  if (problem) {
    toastIfPossible(`Registration sync stopped early ⚠️ — ${imported} new row(s) imported${across}. See the log.`);
  } else if (problems.length > 0) {
    toastIfPossible(`Registration sync finished with problems ⚠️ — ${imported} new row(s) imported${across}, ` +
      `but ${problems.length} step(s) could not run: ${problems.join('; ')}. See the log.`);
  } else {
    toastIfPossible(`Registration sync complete ✅ — ${imported} new row(s)${across}.`);
  }
  return { finished: !problem, problem: problem || null, imported: imported };
}

/**
 * The Quick Mark lists, rebuilt once the WINDOW is done rather than once per
 * slice.
 *
 * A sync is precisely the moment the registrant rows have changed, and it runs
 * hourly with nobody waiting on it — so the read that used to be a wait at the
 * sign-in desk is paid for here. Outside the lock and outside the budget: this
 * reads tabs, and a cache that could not be warmed is only a slower first
 * Quick Mark.
 */
function warmQuickMarkAfterSync_() {
  try {
    warmQuickMarkIndexCache();
  } catch (err) {
    log(`⚠️ Could not rebuild the Quick Mark lists after the sync (${err}) — they will be built on demand.`);
  }
}
