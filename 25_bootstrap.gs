// ============================================================================
// 4b. LARGE-SETUP BOOTSTRAP  (bootstrapCalendars / resumeBootstrapCalendars)
// ============================================================================
//
// WHY THIS EXISTS: a normal syncCalendars() finishes in seconds because it has
// almost nothing to do — every group already has its form and its rows, so it
// skips them. The FIRST import is the opposite: every group is new, and each
// one costs a Drive copy, a dozen-plus Forms calls, a sheet write and one
// calendar-description write PER EVENT. Multiply that by a full 60-day window
// of programs across three calendars and it blows straight through Apps
// Script's six-minute execution limit — which is exactly what happens when
// you run initSheet() and then Sync Cal on a real calendar.
//
// A timeout there is worse than slow. The kill is not an exception, so
// syncCalendarsInternal()'s `finally` never runs: the calendar-edit triggers
// it removed at the start stay removed, the persistent registries never get
// flushed (so the forms it just created are forgotten and DUPLICATED on the
// next attempt), and whatever it managed to write is half-applied.
//
// So the bootstrap works in slices:
//   - Automation is paused up front — the calendar-edit triggers AND the
//     time-driven syncCalendars/syncRegistrations triggers — so nothing else
//     runs while a multi-execution import is in flight. syncCalendars() also
//     refuses to start on its own while the bootstrap is active.
//   - Each slice imports whole groups until its time budget runs out, then
//     hands off to the next slice via a one-off trigger. Progress lives in
//     the SHEET (a group with rows is skipped next time), so a slice never
//     has to trust anything it kept in memory.
//   - The hand-off trigger is armed BEFORE the work starts, timed to fire
//     after this slice's budget. If a slice is killed anyway, the next one
//     still comes. A slice that finishes normally re-arms it for a minute
//     out, so the common case doesn't idle.
//   - The final slice rebuilds every trigger, renders the dashboard once,
//     and clears the state.
// ============================================================================

const BOOTSTRAP_ENTRY_NAME = 'bootstrapCalendars';
const BOOTSTRAP_RESUME_HANDLER = 'resumeBootstrapCalendars';
const BOOTSTRAP_STATE_PROP_KEY = 'BOOTSTRAP_STATE_V1';

/**
 * How long one slice may spend importing before it stops between groups —
 * targeting ~5-minute chunks so a big calendar takes fewer, longer runs
 * instead of many short ones.
 *
 * NOT a flat 5 minutes on purpose. Apps Script's hard ceiling is 6 minutes,
 * the budget is only checked BETWEEN groups, and a group can take ~30-60s on
 * its own (a Drive copy, a dozen-plus Forms calls, a description write per
 * event). At a 5.0-minute budget a group starting at 4:59 runs past the
 * ceiling and gets killed mid-write; 4.5 leaves that group room to finish and
 * still leaves time for the wrap-up (flush, re-arm, log, toast). The killed
 * case is survivable — that's what the watchdog is for — but it costs a whole
 * extra slice, so it's worth not inviting.
 */
const BOOTSTRAP_SLICE_BUDGET_MS = 4.5 * 60 * 1000;
/** Gap before the next slice after a clean hand-off. Short, so the import doesn't idle between chunks. */
const BOOTSTRAP_RESUME_DELAY_MS = 30 * 1000;
/** Watchdog: armed before a slice starts, so a slice killed by the timeout still gets a successor. */
const BOOTSTRAP_WATCHDOG_DELAY_MS = BOOTSTRAP_SLICE_BUDGET_MS + 2.5 * 60 * 1000;
/** Toast progress roughly every this many groups WITHIN a slice, so a long chunk isn't silent. */
const BOOTSTRAP_TOAST_EVERY_GROUPS = 5;
/** Hard stop, so a bug can never leave the project trading triggers forever. */
const BOOTSTRAP_MAX_SLICES = 30;
/** Consecutive slices allowed to make no progress before giving up. */
const BOOTSTRAP_MAX_STALLED_SLICES = 2;
/**
 * After this long with no slice completing, isBootstrapActive() stops
 * believing the state — otherwise a bootstrap that died in a way that took
 * its watchdog with it would block every normal sync indefinitely.
 */
const BOOTSTRAP_STALE_MS = 2 * 60 * 60 * 1000;

function getBootstrapState() {
  const raw = PropertiesService.getScriptProperties().getProperty(BOOTSTRAP_STATE_PROP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️ Bootstrap state was unreadable (${err}) — treating it as finished.`);
    return null;
  }
}

function saveBootstrapState(state) {
  PropertiesService.getScriptProperties().setProperty(BOOTSTRAP_STATE_PROP_KEY, JSON.stringify(state));
}

function clearBootstrapState() {
  PropertiesService.getScriptProperties().deleteProperty(BOOTSTRAP_STATE_PROP_KEY);
}

/** Is a sliced import in flight right now, specifically? Stale state (see BOOTSTRAP_STALE_MS) reads as "no". */
function isBootstrapImportActive() {
  const state = getBootstrapState();
  if (!state) return false;
  const age = Date.now() - (state.lastSliceAt || state.startedAt || 0);
  if (age > BOOTSTRAP_STALE_MS) {
    log(`⚠️ Ignoring a large-setup import that hasn't advanced in ${Math.round(age / 60000)} minute(s) — ` +
      `run ${BOOTSTRAP_ENTRY_NAME}() to restart it, or cancelBootstrapCalendars() to clear it.`);
    return false;
  }
  return true;
}

/**
 * Is EITHER kind of sliced background job in flight — the large-setup import
 * above, or the destroy-and-rebuild forms sweep (see the "DESTROY-AND-REBUILD:
 * BACKGROUND SWEEP" block further down)? Both are multi-execution jobs that
 * pause syncCalendars/syncRegistrations/onCalendarChange for their duration
 * and write to the same dashboard, session table, and form registries, so
 * everything already guarded against one has to stand down for the other too.
 * Kept as a single combined check so the many call sites written against the
 * import don't each need to separately learn about the sweep.
 */
function isBootstrapActive() {
  return isBootstrapImportActive() || isFormRebuildSweepActive();
}

/**
 * The narrower question the SIGN-IN DESK has to ask: is a job in flight that
 * would make marking one person off the list unsafe?
 *
 * Only the bootstrap import is. It writes the session table and the registrant
 * table from scratch across many executions, and a row marked in the middle of
 * that is a row about to be overwritten. A destroy-and-rebuild sweep is a
 * different animal: it replaces FORMS. It touches the registrant table only
 * through the ordinary import at the head of each slice, which Quick Mark
 * already coexists with every hour of every day.
 *
 * The distinction is not academic. A sweep can run for hours, and while one
 * did, Quick Mark refused to open at all — the tool the desk needs most, gone
 * for the whole morning, because a maintenance job was rebuilding forms
 * nobody was standing at. Marking somebody off a list has nothing to do with
 * rebuilding a form, and it no longer waits for one.
 */
function isDeskWorkBlocked() {
  return isBootstrapImportActive();
}

/** Why the desk is blocked, for a toast. Only ever the import — see isDeskWorkBlocked(). */
function deskBusyMessage() {
  return 'A large-setup import is rewriting the registrations table — try this once it finishes ' +
    '(it says so in a toast when it does).';
}

/** Which of the two sliced jobs is blocking, in one line — for toasts/logs that need to say why. */
function bootstrapBusyMessage() {
  if (isFormRebuildSweepActive()) {
    return 'A destroy-and-rebuild forms sweep is running in the background — try this once it finishes.';
  }
  return 'A large-setup import is running — try this once it finishes.';
}

/**
 * START HERE for a big calendar. Imports every program on every calendar —
 * creating each one's registration form, or adopting the form already linked
 * from its calendar description — across as many executions as it takes,
 * with all automation paused until it's done.
 *
 * Safe to run on an already-populated workbook: groups whose dates are
 * already on the session table are skipped, so this is also the way to
 * recover after a sync that timed out half-finished.
 */
function bootstrapCalendars() {
  if (!requireAuthorizedAdmin('Import Everything (First Run)')) return;
  // Ownership is checked HERE rather than in the writeTriggers(true) that
  // finishBootstrap() ends with, because by that point refusing would strand
  // the project with no triggers at all. An import both tears automation
  // down and builds it back up — so the account that starts one is choosing
  // to own the triggers, and has to be the owner going in.
  if (!requireTriggerOwnership()) return;
  if (isBootstrapImportActive()) {
    const state = getBootstrapState();
    const message = `A large-setup import is already running (slice ${state.slices} of at most ${BOOTSTRAP_MAX_SLICES}) — leaving it alone.`;
    log(message);
    toastIfPossible(message);
    return;
  }
  if (isFormRebuildSweepActive()) {
    const message = 'A destroy-and-rebuild forms sweep is running in the background — leaving it alone; try this once it finishes.';
    log(message);
    toastIfPossible(message);
    return;
  }

  pauseAutomationForBootstrap();
  saveBootstrapState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0,
    lastRemaining: null, groupsProcessed: 0, eventsAdded: 0,
    formsCreated: 0, formsReused: 0, groupsFailed: 0
  });
  log('Large-setup import started: automation paused, importing in slices.');
  toastIfPossible('Large-setup import started — this runs in the background and may take several minutes.');

  runBootstrapSlice();
}

/** Trigger handler for the next slice. Never call this directly — use bootstrapCalendars(). */
/**
 * DELIBERATELY NOT behind the Automation_Enabled kill switch, unlike the
 * three handlers in MANAGED_AUTOMATION_HANDLERS.
 *
 * An import that stops halfway is not a paused import — it's a stranded one:
 * the triggers stay torn down, the bootstrap state stays active (so every
 * normal sync keeps standing down), and the form registry never gets
 * flushed. Letting the kill switch hit this would turn "pause automation for
 * a minute" into a broken workbook that only cancelBootstrapCalendars() can
 * clear. An import already has its own stop control, which cleans up after
 * itself — that's what to use instead.
 *
 * bootstrapCalendars() is where the ownership check lives, so nothing an
 * un-owned account started can reach here in the first place.
 */
function resumeBootstrapCalendars() {
  runBootstrapSlice();
}

/**
 * One execution's worth of importing. Everything that decides whether there
 * is a NEXT slice happens here.
 */
function runBootstrapSlice() {
  const state = getBootstrapState();
  if (!state) {
    // Nothing in flight — a leftover trigger firing after the job finished.
    deleteBootstrapResumeTriggers();
    return;
  }

  // Armed BEFORE anything else, including the lock: from here on every exit
  // path leaves exactly one live successor behind, so neither an outright
  // kill nor a lock we couldn't get can strand the import. finishBootstrap()
  // is what finally clears it.
  armBootstrapResume(BOOTSTRAP_WATCHDOG_DELAY_MS);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('Bootstrap slice: another execution holds the lock — the next slice will retry.');
    return;
  }

  try {
    state.slices++;
    state.lastSliceAt = Date.now();
    saveBootstrapState(state);

    // Re-asserted EVERY slice, not just at the start. An import runs for
    // half an hour across a dozen executions, and a single trigger that
    // comes back during it — someone pressing "Check Triggers", a re-run of
    // initSheet(), anything at all — puts every event this import has
    // already touched back in onCalendarChange()'s queue, and the remaining
    // slices then fight a sync storm instead of importing. Costs one
    // getProjectTriggers() call per slice and normally removes nothing.
    pauseAutomationForBootstrap();

    if (state.slices > BOOTSTRAP_MAX_SLICES) {
      finishBootstrap(state, `stopped after ${BOOTSTRAP_MAX_SLICES} slices without finishing`);
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    if (findProgramSessionHeaderRows(registrySheet).length === 0) {
      renderProgramDashboard();
    }

    const doneBefore = state.groupsProcessed;
    toastIfPossible(`Import chunk ${state.slices} running… (${doneBefore} program group(s) done so far)`);

    const summary = importCalendarGroups(registrySheet, {
      deadline: Date.now() + BOOTSTRAP_SLICE_BUDGET_MS,
      // A 4.5-minute chunk is a long time to stare at an unchanged screen, so
      // it reports in as it goes rather than only at the hand-off.
      onGroupDone: partial => {
        if (partial.groupsProcessed % BOOTSTRAP_TOAST_EVERY_GROUPS !== 0) return;
        const done = doneBefore + partial.groupsProcessed;
        const left = partial.groupsTotal - partial.groupsProcessed;
        toastIfPossible(`Importing… ${done} program group(s), ${partial.eventsAdded} date(s) so far` +
          (left > 0 ? ` — about ${left} left` : ''));
      }
    });
    state.groupsProcessed += summary.groupsProcessed;
    state.eventsAdded += summary.eventsAdded;
    state.formsCreated += summary.formsCreated;
    state.formsReused += summary.formsReused;
    state.groupsFailed += summary.groupsFailed;
    log(`Bootstrap slice ${state.slices}: ${describeImportSummary(summary)}; ${summary.remaining} group(s) left.`);

    if (!summary.outOfTime) {
      finishBootstrap(state, null);
      return;
    }

    toastIfPossible(`Import chunk ${state.slices} done — ${state.groupsProcessed} program group(s) imported, ` +
      `${summary.remaining} to go. Next chunk starts in ${Math.round(BOOTSTRAP_RESUME_DELAY_MS / 1000)}s.`);

    // Still work to do. Guard against a group that can never succeed keeping
    // this going forever: no forward movement twice running ends it.
    const madeProgress = summary.groupsProcessed > 0 &&
      (state.lastRemaining === null || summary.remaining < state.lastRemaining);
    state.stalledSlices = madeProgress ? 0 : state.stalledSlices + 1;
    state.lastRemaining = summary.remaining;
    saveBootstrapState(state);

    if (state.stalledSlices >= BOOTSTRAP_MAX_STALLED_SLICES) {
      finishBootstrap(state, `stopped early — ${summary.remaining} group(s) could not be imported`);
      return;
    }

    armBootstrapResume(BOOTSTRAP_RESUME_DELAY_MS); // replaces the watchdog with a prompt hand-off
    log(`Bootstrap: handing off to the next slice in ${Math.round(BOOTSTRAP_RESUME_DELAY_MS / 1000)}s.`);
  } catch (err) {
    // An exception, unlike a timeout, is ours to handle: put the system back
    // together rather than leaving automation paused.
    log(`⚠️ Bootstrap slice failed (${err}) — restoring automation.`);
    noteForAdmin('Large-setup import', `The import stopped with an error and automation was restored: ${err}`);
    finishBootstrap(getBootstrapState() || state, `stopped by an error: ${err}`);
  } finally {
    flushPersistentRegistries(); // a killed slice's forms must never be forgotten
    lock.releaseLock();
  }
}

/**
 * Last slice: one dashboard render for everything imported, every trigger
 * back in place, state cleared. `problem` is null on a clean finish.
 */
function finishBootstrap(state, problem) {
  state = state || {};
  deleteBootstrapResumeTriggers();

  // Rendered while the bootstrap still counts as active, deliberately: that
  // is what keeps triageDeletedSessions() out of this render. Everything on
  // the session table was put there by the import that just ran, and a
  // half-read calendar at this exact moment must never be allowed to
  // conclude that all of it has been deleted.
  try {
    renderProgramDashboard(true);
  } catch (err) {
    log(`⚠️ Bootstrap: could not render the dashboard at the end (${err}) — the data is imported; re-run Sync Cal to redraw.`);
  }

  clearBootstrapState();

  try {
    // Swallow the import's own description edits before the calendar-edit
    // triggers go back on, or every one of the events just written becomes a
    // full syncCalendars() a moment later.
    primeCalendarSyncTokens('import');
    // force: this IS the restore, and the state was cleared just above — but
    // not relying on that ordering is what keeps automation from staying off.
    writeTriggers(true); // daily sync, hourly registrations, one calendar-edit trigger per calendar
  } catch (err) {
    // Automation staying paused is the one outcome worth shouting about.
    log(`⚠️ Bootstrap: could not restore the triggers (${err}) — run "Check Triggers" from the menu.`);
    noteForAdmin('Large-setup import',
      `The import finished but its triggers could not be restored (${err}). Run "Check Triggers" from the menu.`);
  }

  const totals = `${state.groupsProcessed || 0} program group(s), ${state.eventsAdded || 0} date(s), ` +
    `${state.formsCreated || 0} new form(s), ${state.formsReused || 0} existing form(s) reused` +
    (state.groupsFailed > 0 ? `, ${state.groupsFailed} failed` : '');
  const headline = problem
    ? `⚠️ Large-setup import ${problem}. Imported so far: ${totals}.`
    : `Large-setup import complete ✅ (${totals}, over ${state.slices || 1} run(s)).`;

  log(headline);
  if (problem) noteForAdmin('Large-setup import', headline);
  toastIfPossible(headline);
  flushAdminDigest('Large-setup import');
  log('Automation restored. Run "Sync Registrations" (or wait for the hourly trigger) to pull in any existing form responses.');
}

/**
 * Deletes the syncCalendars / syncRegistrations / onCalendarChange triggers
 * for the duration of the import. Idempotent by design — every slice calls
 * it, so a trigger that reappears mid-import survives at most one slice.
 */
const BOOTSTRAP_PAUSED_HANDLERS = ['syncCalendars', 'syncRegistrations', 'onCalendarChange'];

function pauseAutomationForBootstrap() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (BOOTSTRAP_PAUSED_HANDLERS.indexOf(t.getHandlerFunction()) === -1) return;
    ScriptApp.deleteTrigger(t);
    removed++;
  });
  if (removed > 0) {
    log(`Paused ${removed} trigger(s) for the duration of the import — finishBootstrap() puts them all back.`);
  }
  return removed;
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. */
function armBootstrapResume(delayMs) {
  deleteBootstrapResumeTriggers();
  ScriptApp.newTrigger(BOOTSTRAP_RESUME_HANDLER).timeBased().after(delayMs).create();
}

/**
 * DIAGNOSTIC — run from the Apps Script editor. Logs every trigger this
 * project currently has, plus whether an import is in flight.
 *
 * Use it when onCalendarChange executions keep appearing during an import.
 * There are only two explanations and this separates them:
 *
 *   - NO onCalendarChange trigger listed, yet executions keep arriving:
 *     Google is draining notifications it had already accepted for a channel
 *     that is being torn down. Nothing in this script can recall those. They
 *     cost one log line each (see onCalendarChange) and stop on their own.
 *   - onCalendarChange triggers ARE listed while an import is active:
 *     something re-created them. That is a bug worth chasing — check whether
 *     initSheet() or another project (a second copy of this script bound to
 *     the same calendars) is running.
 */
function logProjectTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const active = isBootstrapActive();
  log(`Project triggers (${triggers.length}) — large-setup import ${active ? 'IS' : 'is NOT'} currently active:`);
  triggers.forEach(t => {
    const source = t.getTriggerSourceId();
    log(`  • ${t.getHandlerFunction()}${source ? ` [${CALENDAR_MAP[source] || source}]` : ''}`);
  });
  if (active && triggers.some(t => t.getHandlerFunction() === 'onCalendarChange')) {
    log('⚠️ A calendar-edit trigger exists DURING an import — it should have been paused. ' +
      'Something re-created it; the next slice will remove it again.');
  }
  return triggers.length;
}

function deleteBootstrapResumeTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== BOOTSTRAP_RESUME_HANDLER) return;
    ScriptApp.deleteTrigger(t); // one-off triggers linger after firing; clear them out
    removed++;
  });
  return removed;
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops a sliced import and
 * puts automation back exactly as finishBootstrap() would. Whatever was
 * already imported stays imported; re-running bootstrapCalendars() picks up
 * from there.
 */
function cancelBootstrapCalendars() {
  if (!requireAuthorizedAdmin('Cancel Large-Setup Import')) return;
  const state = getBootstrapState();
  if (!state) {
    deleteBootstrapResumeTriggers();
    // NOT forced: with no import in flight there is nothing paused to
    // restore, so this is an ordinary "verify my triggers" and has to
    // respect trigger ownership like any other. Forcing here would let a
    // non-owner admin build a full set (and claim ownership) just by running
    // the escape hatch on a project that was working fine.
    writeTriggers();
    log('No large-setup import was running — triggers verified anyway.');
    return;
  }
  finishBootstrap(state, 'was cancelled');
}

/** Toasts when there's a UI to toast into (a trigger run has none) — never worth throwing over. */
function toastIfPossible(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Calendar & Form Manager', 8);
  } catch (err) {
    // Running from a trigger with no active spreadsheet UI — the log line stands on its own.
  }
}

/**
 * The registration line we inject into a calendar event description.
 *
 * It's an HTML anchor — Google Calendar renders a subset of HTML in
 * descriptions — so attendees see a short "Register for X" link instead of
 * a raw URL.
 *
 * The form ID rides along in the href's #fragment rather than as a visible
 * "[Form ID: ...]" tag. A fragment is never sent to the server and is
 * ignored by Forms, so it changes nothing for the person clicking it — but
 * it keeps the ID machine-recoverable, which is what lets
 * findExistingFormIdFromEvents() rebuild a lost form registry instead of
 * spawning duplicate forms.
 */
const REGISTRATION_LINK_FRAGMENT_KEY = 'form';

function buildRegistrationLinkLine(group, formInfo) {
  const label = group.isFixed
    ? `📝 Register for ${group.cleanTitle}`
    : `📝 Register for ${group.cleanTitle} — ${group.monthLabel}`;
  const href = `${formInfo.publishedUrl}#${REGISTRATION_LINK_FRAGMENT_KEY}=${formInfo.formId}`;
  return `<a href="${href}">${label}</a>`;
}

/** Matches our anchor, capturing (1) the URL without fragment and (2) the form ID. */
const REGISTRATION_ANCHOR_REGEX =
  new RegExp(`<a href="([^"#]*)#${REGISTRATION_LINK_FRAGMENT_KEY}=([a-zA-Z0-9_-]+)"[^>]*>.*?</a>`, 'i');
/** Pre-anchor format, still read so events stamped by older versions keep working. */
const LEGACY_REGISTRATION_LINE_REGEX = /^.*Registration Link:\s*(\S+)\s*\[Form ID:\s*([a-zA-Z0-9_-]+)\]\s*$/m;

/** Finds our registration line in a description in either format. Returns { url, formId, matchText } or null. */
function findRegistrationLineInDescription(description) {
  const anchor = REGISTRATION_ANCHOR_REGEX.exec(description);
  if (anchor) return { url: anchor[1], formId: anchor[2], matchText: anchor[0], isLegacy: false };
  const legacy = LEGACY_REGISTRATION_LINE_REGEX.exec(description);
  if (legacy) return { url: legacy[1], formId: legacy[2], matchText: legacy[0], isLegacy: true };
  return null;
}

function findExistingFormIdFromEvents(events) {
  for (const ev of events) {
    const found = findRegistrationLineInDescription(ev.getDescription() || '');
    if (!found) continue;
    try {
      FormApp.openById(found.formId);
      return found.formId;
    } catch (err) {
      log(`⚠️ Found a Form ID marker (${found.formId}) in an event description, but it could not be opened (${err}) — ignoring.`);
    }
  }
  return null;
}


