// ============================================================================
// 75. SLICED BACKGROUND JOBS  (runSlicedJob / runSlicedItems)
// ============================================================================
//
// WHY THIS EXISTS: Apps Script kills an execution at six minutes with no
// warning, no exception and no `finally`. Every long job in this project
// therefore runs in SLICES — a slice works until its own deadline, records
// what it did in Script Properties, and arms a one-off trigger that calls the
// job again where it stopped.
//
// That pattern was written out by hand four times: the large-setup import
// (25), the in-place form rebuild (32), the destroy-and-rebuild sweep (49),
// and the routing-repair sweep (68). Four copies of one state machine is four
// places for a slice to stall silently, and they had already drifted — one
// tolerated three failures in a row, the others ended on the first; one held
// the workbook lock for the whole slice, one per form, two not at all.
//
// The ENVELOPE is what lives here, and only the envelope:
//
//   • the state in Script Properties — `{ startedAt, lastSliceAt, slices,
//     stalledSlices, … }`, read and written under the caller's own key;
//   • the stale check that stops a job which died with its watchdog from
//     blocking every later click forever;
//   • the watchdog armed BEFORE any work, so a slice killed outright still
//     leaves exactly one live successor;
//   • the slice counter and its ceiling;
//   • the deadline;
//   • stall detection, consecutive-error tolerance, and the hand-off trigger.
//
// The WORK is the caller's, supplied as `work(ctx)`. So is every word the
// person reads: the runner formats no message of its own. What a job counts as
// progress, what it does between items, whether it pauses automation, whether
// it takes the workbook lock — all of that stays in the file that owns the job.
//
// ---------------------------------------------------------------------------
// A JOB THAT IS MID-FLIGHT WHEN THIS SHIPS IS NOT STRANDED.
//
// Deliberately: this runner reads and writes the SAME state shape and the SAME
// Script Property keys the four hand-written copies did — `BOOTSTRAP_STATE_V1`,
// `IN_PLACE_FORM_REBUILD_STATE_V1`, `FORM_REBUILD_STATE_V1`,
// `FORM_ROUTING_REPAIR_STATE_V1` — and every field it touches
// (`startedAt`, `lastSliceAt`, `slices`, `stalledSlices`, `errorSlices`, and
// whatever else the caller keeps beside them) means exactly what it meant
// before. No stored shape changed, so no key needed a `_V2`.
//
// The consequence worth stating plainly: a workbook part-way through a
// large-setup import when this code lands resumes on its next slice as if
// nothing happened. The resume TRIGGER already armed names the same handler
// (`resumeBootstrapCalendars` and friends are unchanged), the state it reads
// is the state it wrote, and the slice count carries on from where it was.
// Nothing has to finish, and nothing has to be restarted by hand.
// ---------------------------------------------------------------------------
//
// WHAT A CALLER SUPPLIES (`runSlicedJob(job)`):
//
//   propKey            Script Property holding this job's state.
//   resumeHandler      Name of the trigger handler that runs the next slice.
//   budgetMs           How long one slice may work before it stops.
//   resumeDelayMs      Gap before the next slice after a clean hand-off.
//   watchdogDelayMs    Gap before the successor armed at the top of a slice.
//   maxSlices          Ceiling, so a job that cannot finish ends.
//   maxStalledSlices   Slices in a row making no progress before it gives up.
//   maxErrorSlices     Slices in a row ending in an exception before it does
//                      (default 1 — end on the first).
//   around(run)        Optional wrapper: the lock a job holds for its whole
//                      slice, and anything its `finally` must do. Not calling
//                      `run()` skips the slice, leaving the watchdog standing.
//   beforeSlice(state) Optional, after the slice is counted and saved.
//   work(ctx)          The slice's actual work. See the return contract below.
//   madeProgress(state, result)  Optional; defaults to `result.processed > 0`.
//   noteProgress(state, result)  Optional, after madeProgress is judged.
//   onHandOff(state, result)     Optional; says "chunk done, more to come".
//   onError(err, n, max)         Optional; logs the failure.
//   overrunProblem() / stalledProblem(result, state) / errorProblem(err, n) /
//   saveErrorProblem(err)        The caller's own wording for each ending.
//   onDone(state, problem)       Ends the job: clears the state, drops the
//                                trigger, says what happened. `problem` is
//                                null on a clean finish. Its return value is
//                                the runner's.
//
// `work(ctx)` returns one of:
//   { finished: true }        everything is done — onDone(state, null)
//   { stop: 'why' }           end now — onDone(state, 'why')
//   { handOff: true }         nothing was done and it is nobody's fault (a
//                             lock somebody else holds): arm a prompt retry,
//                             skipping the stall count
//   { processed, remaining }  ordinary progress; the runner decides whether
//                             this slice stalled and hands off
//
// `ctx` carries `{ state, budgetMs, deadline, newDeadline(), save() }`.
// `newDeadline()` re-bases the budget on NOW, for a job whose slice does
// something before the budgeted work begins (32 and 49 import outstanding
// registrations first, and paying for that out of the rebuild budget is what
// once left a five-minute run rebuilding two forms).
// ============================================================================

function getSlicedJobState(propKey, label) {
  const raw = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️ ${label || propKey} state was unreadable (${err}) — treating it as finished.`);
    return null;
  }
}

function saveSlicedJobState(propKey, state) {
  PropertiesService.getScriptProperties().setProperty(propKey, JSON.stringify(state));
}

function clearSlicedJobState(propKey) {
  PropertiesService.getScriptProperties().deleteProperty(propKey);
}

/**
 * Is this job in flight right now?
 *
 * State older than `staleMs` reads as "no" — a job that died in a way that
 * took its watchdog with it must not block every later click forever.
 * `onStale(minutes)` supplies the caller's own words for that, and is only
 * called when the state is being ignored.
 */
function isSlicedJobActive(propKey, staleMs, onStale) {
  const state = getSlicedJobState(propKey);
  if (!state) return false;
  const age = Date.now() - (state.lastSliceAt || state.startedAt || 0);
  if (age > staleMs) {
    if (onStale) log(onStale(Math.round(age / 60000)));
    return false;
  }
  return true;
}

/** Replaces any pending hand-off for `handler` with exactly one, `delayMs` out. */
function armSlicedJobResume(handler, delayMs) {
  deleteSlicedJobResumeTriggers(handler);
  ScriptApp.newTrigger(handler).timeBased().after(delayMs).create();
}

/** Drops every pending hand-off for `handler`. One-off triggers linger after firing. */
function deleteSlicedJobResumeTriggers(handler) {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== handler) return;
    ScriptApp.deleteTrigger(t);
    removed++;
  });
  return removed;
}

/**
 * ONE EXECUTION'S WORTH of a sliced job. Everything that decides whether there
 * is a NEXT slice happens here; what the slice actually does is `job.work`.
 *
 * Returns whatever `job.onDone` returned when this slice ended the job, the
 * state when it handed off, or null when there was nothing to do.
 */
function runSlicedJob(job) {
  const state = getSlicedJobState(job.propKey, job.label);
  if (!state) {
    // Nothing in flight — a leftover trigger firing after the job finished.
    deleteSlicedJobResumeTriggers(job.resumeHandler);
    return null;
  }

  // Armed BEFORE anything else, including any lock: from here on every exit
  // path leaves exactly one live successor behind, so neither an outright kill
  // nor a lock we could not get can strand the job. job.onDone() is what
  // finally clears it.
  armSlicedJobResume(job.resumeHandler, job.watchdogDelayMs);

  const slice = () => runOneSlice_(job, state);
  // `around` is where a job puts the lock it holds for a whole slice and the
  // `finally` that must run however the slice ends — including the paths that
  // finish the job, which is why it wraps the body rather than sitting inside
  // it. A wrapper that never calls run() skips this slice; the watchdog above
  // is what brings the next one.
  return job.around ? job.around(slice) : slice();
}

/** The body of one slice, wrapped by `job.around` when the job has one. */
function runOneSlice_(job, state) {
  const finish = (st, problem) => job.onDone(st, problem);

  try {
    state.slices++;
    state.lastSliceAt = Date.now();
    saveSlicedJobState(job.propKey, state);

    if (job.beforeSlice) job.beforeSlice(state);

    if (state.slices > job.maxSlices) {
      return finish(state, job.overrunProblem());
    }

    const ctx = {
      state: state,
      budgetMs: job.budgetMs,
      deadline: Date.now() + job.budgetMs,
      newDeadline: function () {
        this.deadline = Date.now() + job.budgetMs;
        return this.deadline;
      },
      save: function () { saveSlicedJobState(job.propKey, state); }
    };

    const result = job.work(ctx) || {};

    if (result.finished) return finish(state, null);
    if (result.stop) return finish(state, result.stop);
    if (result.handOff) {
      // Not progress and not a stall — somebody else held the lock. The work
      // is still un-done in the state, so the next slice picks it up unchanged.
      armSlicedJobResume(job.resumeHandler, job.resumeDelayMs);
      return state;
    }

    // Guard against work that can never succeed keeping this going forever:
    // no forward movement N times running ends it.
    const madeProgress = job.madeProgress ? job.madeProgress(state, result) : result.processed > 0;
    if (job.noteProgress) job.noteProgress(state, result);
    state.stalledSlices = madeProgress ? 0 : (state.stalledSlices || 0) + 1;
    ctx.save();

    if (state.stalledSlices >= job.maxStalledSlices) {
      return finish(state, job.stalledProblem(result, state));
    }

    if (job.onHandOff) job.onHandOff(state, result);
    armSlicedJobResume(job.resumeHandler, job.resumeDelayMs); // replaces the watchdog with a prompt hand-off
    return state;
  } catch (err) {
    // An exception, unlike a timeout, is ours to handle.
    //
    // Whether it ENDS the job is the caller's call, and the two answers are
    // both right somewhere. A job that tore automation down (25, 49) has to
    // put it back rather than leave it paused, so one failure finishes it. A
    // job that only rewrites forms (32) survives up to maxErrorSlices in a
    // row, because the commonest failure it meets is not ours at all — Apps
    // Script's own "error code INTERNAL" lands on a run rather than on a form
    // and is gone by the next one, and ending a ninety-form sweep on it is
    // how a migration stops half-applied. The count is CONSECUTIVE: any slice
    // that completes clears it (the caller does that in its own work).
    //
    // The state is re-read rather than trusted from memory: whatever the work
    // recorded before it threw is what the next slice must resume from.
    const current = getSlicedJobState(job.propKey, job.label) || state;
    const maxErrors = job.maxErrorSlices || 1;
    const errorSlices = (current.errorSlices || 0) + 1;
    if (job.onError) job.onError(err, errorSlices, maxErrors);

    if (errorSlices >= maxErrors) {
      return finish(current, job.errorProblem(err, errorSlices));
    }

    current.errorSlices = errorSlices;
    try {
      saveSlicedJobState(job.propKey, current);
    } catch (saveErr) {
      // The state is what the next slice resumes from. If it cannot be
      // written the job has nothing to come back to, so end it here rather
      // than leaving a hand-off pointing at a stale plan.
      log(`⚠️ ${job.label || job.propKey} could not record its progress (${saveErr}).`);
      return finish(current, (job.saveErrorProblem || job.errorProblem)(err, errorSlices));
    }
    // Replaces the watchdog armed at the head of this slice with a prompt
    // hand-off, exactly as the ordinary end-of-slice path does.
    armSlicedJobResume(job.resumeHandler, job.resumeDelayMs);
    return current;
  }
}

/**
 * ONE ITEM, ONE LOCK HOLD — the inner loop the two form sweeps (32, 49) share.
 *
 * This is the loop that used to run for four and a half minutes inside a
 * single hold, which is how the sign-in desk found Quick Mark unavailable, in
 * the words of the person using it, "half the time". Each item is independent
 * and its progress is recorded in the job's state as it finishes, so taking
 * the lock per item costs nothing and gives every other execution a gap to get
 * in between one item and the next.
 *
 *   items      what is left to do, in order
 *   deadline   epoch ms; checked BETWEEN items, never inside one
 *   lockWaitMs how long to wait for the workbook lock per item
 *   sleepMs    pacing between items, outside the lock so the pause is a gap
 *              other work can use rather than a held-shut workbook. 0 for none.
 *   step(item) does the work AND records the item as done, under the lock
 *   onLockBusy optional; called once when the lock could not be had
 *
 * Returns how many items were processed. A lock somebody else holds stops the
 * loop rather than failing it: the remaining items are still un-done in the
 * state, so the next slice picks them up unchanged.
 */
function runSlicedItems(opts) {
  let processed = 0;
  for (const item of opts.items) {
    if (Date.now() >= opts.deadline) break;
    const took = withScriptLock(opts.lockWaitMs, () => {
      opts.step(item);
      return true;
    }, false);
    if (!took) {
      if (opts.onLockBusy) opts.onLockBusy();
      break;
    }
    processed++;
    if (opts.sleepMs && Date.now() < opts.deadline) Utilities.sleep(opts.sleepMs);
  }
  return processed;
}
