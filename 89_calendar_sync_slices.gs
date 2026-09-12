// ============================================================================
// 89. A CALENDAR SYNC THAT RUNS OUT OF TIME FINISHES LATER  (sliced syncCalendars)
// ============================================================================
//
// THE FAILURE THIS EXISTS FOR. `syncCalendars()` reads every program calendar
// over a window that now reaches three months out (94), groups what it finds,
// and then walks the groups that have work to do — and a group is not a cheap
// thing: a Drive copy for a new form, a dozen-plus Forms calls to shape it,
// and a description write per calendar event. On a centre with a hundred
// programs that loop is longer than one execution, and Apps Script does not
// ask. It kills the run at the account's ceiling with no warning, no exception
// and no `finally`.
//
// What the kill cost was never the groups it had already done — those have
// their rows, their forms and their links, and the sheet is the record. It was
// everything AFTER the loop, every time:
//
//   • applyRegistrationHorizonEffects() never ran, so forms past the horizon
//     stayed open and events inside it kept saying "not yet open";
//   • updateRegistrationLinkCells() never ran, so a form built in the last
//     minute of the run had no link on the dashboard;
//   • renderProgramDashboard() never ran, so the tab still showed the picture
//     from before the sync;
//   • the lunch sign-up pass never ran;
//   • and withCalendarChangeTriggersPaused()'s `finally` never ran, which is
//     the sharp one — the calendar-edit watchers stay DOWN until the next
//     successful sync puts them back.
//
// And nothing said so. The next run started from the top, read the whole
// window again, and was killed in the same place, because the work that was
// left was the work that did not fit the first time.
//
// SO IT IS A SLICED JOB, like the five others here. A slice works to a budget
// (Config's "How Long a Sync May Run", the same dial the registration sync
// reads), stops BETWEEN groups, and hands the rest to a follow-up trigger a
// minute later. The state machine around that — the watchdog armed before any
// work, the deadline, the slice counter, stall detection and the hand-off — is
// runSlicedJob() (75). What lives here is what 75 deliberately does not hold:
// this job's budget, its lock, and every word the person reads.
//
// ---------------------------------------------------------------------------
// THERE IS NO PLAN TO KEEP, AND THAT IS THE DESIGN
//
// Unlike the registration sync (98), this job stores no list of what is left.
// It does not need one: `collectCalendarWork()` derives the work from the
// dates NOT already on the session table, so a group this slice finished is a
// group the next slice sees as up to date and skips. The sheet is the record —
// exactly the bargain bootstrapCalendars() (25) has always made, and the
// reason progress here is measured against the REMAINING count rather than by
// groups touched.
//
// The cost of that is honest and small: every slice re-reads the calendar
// window and rebuilds the groups. That read is one `getEvents()` per calendar
// and is not what runs a sync out of time; the per-group Drive and Forms calls
// are. The benefit is that a slice can be killed outright — mid-group, mid
// write, watchdog and all — without leaving a stored plan that disagrees with
// the workbook.
//
// WHAT A PARTIAL SLICE DELIBERATELY DOES NOT DO is triage. A run that stopped
// early has not written the rows for the groups it never reached, and
// triageDeletedSessions() removes session rows whose event it cannot find. It
// is given the whole calendar read either way, so it would probably be right —
// but "probably right" is not the standard for a pass that moves registrants
// to Deleted_Event_Triage, and a slice that ran out of budget has no budget
// for a second calendar read anyway. So the render a partial slice does asks
// for `skipTriage`, and the slice that FINISHES the window does the ordinary
// full one. The lunch pass waits for that same slice, for the same reason.
//
// Numbered 89 because 89 and 90 were never used and this is a sync, so it
// belongs beside the sync files rather than at the end of the tail. Safe
// there: behavior only, its own five constants stand alone, it reads no other
// file's constants at load time, and everything it calls — syncCalendarsInternal,
// runSlicedJob, getSyncSliceBudgetMs, automationGateAllows, isBootstrapActive —
// it reaches through a hoisted function declaration.
// ============================================================================

/** The trigger handler one slice arms for the next. */
const CALENDAR_SYNC_RESUME_HANDLER = 'resumeCalendarSync';

/** Script Property holding this job's slice bookkeeping. Versioned like every stored shape. */
const CALENDAR_SYNC_STATE_PROP_KEY = 'CALENDAR_SYNC_STATE_V1';

/**
 * Gap before the next slice after a clean hand-off. A minute rather than the
 * bootstrap's thirty seconds: the calendar-edit watchers go back up at the end
 * of every slice (withCalendarChangeTriggersPaused restores them), and the
 * gap is what lets an edit made during the sync settle before the next slice
 * takes them down again.
 */
const CALENDAR_SYNC_RESUME_DELAY_MS = 60 * 1000;

/**
 * Watchdog: armed BEFORE a slice starts, so a slice killed by the execution
 * ceiling still leaves exactly one successor. Generous against the budget,
 * because the budget is only checked between groups and the group that
 * overruns it is the one that got the run killed.
 */
const CALENDAR_SYNC_WATCHDOG_DELAY_MS = 10 * 60 * 1000;

/** Hard stop, so a bug can never leave the project trading triggers forever. */
const CALENDAR_SYNC_MAX_SLICES = 12;

/** Consecutive slices allowed to make no progress before it gives up. */
const CALENDAR_SYNC_MAX_STALLED_SLICES = 2;

/**
 * After this long with no slice completing, a stored state stops being
 * believed — otherwise a sync that died in a way that took its watchdog with
 * it would look in flight forever.
 */
const CALENDAR_SYNC_STALE_MS = 2 * 60 * 60 * 1000;

/** Is a sliced calendar sync in flight right now? Stale state reads as "no". */
function isCalendarSyncInFlight() {
  return isSlicedJobActive(CALENDAR_SYNC_STATE_PROP_KEY, CALENDAR_SYNC_STALE_MS, minutes =>
    `⚠️ Ignoring a calendar sync that hasn't advanced in ${minutes} minute(s) — starting a fresh one.`);
}

/** A fresh slice record. Counters only: the sheet is the record of what is done. */
function newCalendarSyncState() {
  return {
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0, errorSlices: 0,
    groupsProcessed: 0, eventsAdded: 0, formsCreated: 0, formsReused: 0, groupsFailed: 0,
    lastRemaining: null
  };
}

/**
 * ONE EXECUTION'S WORTH of a calendar sync.
 *
 * `options.openWindow` is true for the daily trigger, the menu item and
 * onCalendarChange's escalation; false for the hand-off. A run that arrives
 * while a sync is already mid-window carries that one forward rather than
 * resetting its slice count — the work is derived from the sheet either way,
 * so "starting again" and "carrying on" do the same thing, and only the
 * bookkeeping would have been thrown away.
 */
function runCalendarSyncSlice(options) {
  options = options || {};
  let state = getSlicedJobState(CALENDAR_SYNC_STATE_PROP_KEY, 'Calendar sync');

  if (state && !isCalendarSyncInFlight()) {
    log(`Calendar sync: the slice record from ` +
      `${Math.round((Date.now() - (state.lastSliceAt || state.startedAt || 0)) / 60000)} minute(s) ago ` +
      `is too old to carry on — starting a fresh run.`);
    clearSlicedJobState(CALENDAR_SYNC_STATE_PROP_KEY);
    state = null;
  }
  if (!state) {
    if (!options.openWindow) {
      // A hand-off that arrived after the sync finished. Nothing to do, and
      // the spent trigger goes with it.
      deleteSlicedJobResumeTriggers(CALENDAR_SYNC_RESUME_HANDLER);
      return null;
    }
    saveSlicedJobState(CALENDAR_SYNC_STATE_PROP_KEY, newCalendarSyncState());
  }

  return runSlicedJob({
    label: 'Calendar sync',
    propKey: CALENDAR_SYNC_STATE_PROP_KEY,
    resumeHandler: CALENDAR_SYNC_RESUME_HANDLER,
    budgetMs: getSyncSliceBudgetMs(),
    resumeDelayMs: CALENDAR_SYNC_RESUME_DELAY_MS,
    watchdogDelayMs: CALENDAR_SYNC_WATCHDOG_DELAY_MS,
    maxSlices: CALENDAR_SYNC_MAX_SLICES,
    maxStalledSlices: CALENDAR_SYNC_MAX_STALLED_SLICES,
    // A calendar sync meets an event or a form it cannot read most weeks. One
    // bad slice is not a reason to abandon a window whose groups are already
    // half imported.
    maxErrorSlices: 2,

    // THE LOCK IS HELD FOR THE WHOLE SLICE, which is where syncCalendars()
    // used to take it. There is no point between two groups at which handing
    // the workbook to another sync would leave a coherent picture: rows, form
    // and calendar description land together per group. Not getting it SKIPS
    // the slice — the watchdog armed above brings the next one, where the old
    // code simply gave up until tomorrow.
    around: run => {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
        log('syncCalendars: another sync is already running — this slice will be retried.');
        toastIfPossible('Another sync is already running — try again in a moment.');
        return null;
      }
      try {
        return run();
      } finally {
        // A killed slice's form-label fingerprints must never be stranded.
        flushPersistentRegistries();
        lock.releaseLock();
      }
    },

    work: ctx => {
      const state = ctx.state;
      if (state.slices > 1) {
        toastIfPossible(`Continuing the calendar sync — chunk ${state.slices} ` +
          `(${state.groupsProcessed} program group(s) done so far).`);
      }
      const summary = syncCalendarsInternal({ deadline: ctx.deadline }) || {};

      state.groupsProcessed += summary.groupsProcessed || 0;
      state.eventsAdded += summary.eventsAdded || 0;
      state.formsCreated += summary.formsCreated || 0;
      state.formsReused += summary.formsReused || 0;
      state.groupsFailed += summary.groupsFailed || 0;

      if (!summary.outOfTime) return { finished: true };
      return { processed: summary.groupsProcessed || 0, remaining: summary.remaining || 0 };
    },

    // Measured against the REMAINING count, not by groups touched: this job
    // keeps no list of what is left, so a slice that processed groups without
    // reducing the remainder has not actually moved.
    madeProgress: (state, result) => result.processed > 0 &&
      (state.lastRemaining === null || state.lastRemaining === undefined ||
        result.remaining < state.lastRemaining),
    noteProgress: (state, result) => { state.lastRemaining = result.remaining; },

    onHandOff: (state, result) => {
      const seconds = Math.round(CALENDAR_SYNC_RESUME_DELAY_MS / 1000);
      log(`Calendar sync: ${result.remaining} group(s) left — handing off to the next run in ${seconds}s.`);
      toastIfPossible(`Calendar sync paused after ${state.groupsProcessed} program group(s) — ` +
        `${result.remaining} to go. It continues on its own in ${seconds}s; nothing to press.`);
    },

    onError: (err, n, max) =>
      log(`⚠️ Calendar sync slice ${n}/${max} ended in an error: ${err}`),

    overrunProblem: () =>
      `this sync has taken ${CALENDAR_SYNC_MAX_SLICES} runs and is still not finished. ` +
      `The groups it had not reached will be picked up by the next scheduled sync.`,
    stalledProblem: result =>
      `${CALENDAR_SYNC_MAX_STALLED_SLICES} runs in a row got nothing done, with ` +
      `${(result && result.remaining) || 0} group(s) still to import.`,
    errorProblem: (err, n) => `it failed ${n} run(s) in a row (${err}).`,
    saveErrorProblem: err => `it could not record what it had done (${err}).`,

    onDone: (state, problem) => finishCalendarSync_(state, problem)
  });
}

/**
 * Last slice: the trigger dropped, the state cleared, and one line saying what
 * the whole run did rather than what this slice did. `problem` is null on a
 * clean finish.
 */
function finishCalendarSync_(state, problem) {
  state = state || {};
  deleteSlicedJobResumeTriggers(CALENDAR_SYNC_RESUME_HANDLER);
  clearSlicedJobState(CALENDAR_SYNC_STATE_PROP_KEY);

  const slices = state.slices || 1;
  // A one-slice sync is the ordinary case and has already toasted its own
  // completion from inside syncCalendarsInternal(). Saying it twice would make
  // the sliced path look like a different thing happening.
  if (slices > 1 || problem) {
    const totals = `${state.groupsProcessed || 0} program group(s), ${state.eventsAdded || 0} date(s), ` +
      `${state.formsCreated || 0} new form(s), ${state.formsReused || 0} existing form(s) reused` +
      (state.groupsFailed > 0 ? `, ${state.groupsFailed} failed` : '');
    const headline = problem
      ? `⚠️ Calendar sync ${problem} Done so far: ${totals}.`
      : `Calendar sync complete ✅ (${totals}, over ${slices} run(s)).`;
    log(headline);
    if (problem) noteForAdmin('Calendar sync', headline);
    toastIfPossible(headline);
  }
  flushAdminDigest('Calendar sync');
  return { finished: !problem, problem: problem || null, slices: slices };
}

/**
 * The hand-off trigger's handler.
 *
 * GATED LIKE THE SYNC IT CONTINUES, for the same reason resumeRegistrationSync()
 * is: somebody who pauses automation mid-run means stop, and a follow-up that
 * carried on would be the one thing the kill switch could not stop. The slice
 * record is left to go stale on its own — the next unpaused run reads the
 * calendar fresh, which is the right answer after a pause of any length.
 */
function resumeCalendarSync() {
  if (!automationGateAllows('Sync Cal', true)) {
    deleteSlicedJobResumeTriggers(CALENDAR_SYNC_RESUME_HANDLER);
    return null;
  }
  if (isBootstrapActive()) {
    // Re-armed rather than dropped: the one-off trigger that just fired is
    // spent, and this run would otherwise sit until it went stale.
    log('resumeCalendarSync: a large-setup import or forms-rebuild sweep is in progress — ' +
      'this slice will be retried.');
    armSlicedJobResume(CALENDAR_SYNC_RESUME_HANDLER, CALENDAR_SYNC_WATCHDOG_DELAY_MS);
    return null;
  }
  recordHandlerRun('syncCalendars');
  return runCalendarSyncSlice({ openWindow: false });
}
