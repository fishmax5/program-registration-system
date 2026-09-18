// ============================================================================
// 99g. WHY DID NOTHING HAPPEN?  (the menu item that answers for the others)
// ============================================================================
//
// Numbered after `99f` for the usual reason — never renumber, and this landed
// last. Safe there: behavior only, its own three constants stand alone, it
// declares no schema, and everything it reaches for — the four sliced jobs'
// state keys (`25`, `49`, `90`, `98`), the Config reads (`15`), the stored
// Quick Mark index (`38`), the escape hatches (`25`, `49`) — it reads at CALL
// time or through a hoisted function declaration.
//
// THE FAULT THIS FILE IS ABOUT IS NOT A FAULT. It is a REFUSAL nobody can see.
//
// Half the menu in this project begins by asking whether it is allowed to run:
// automation may be paused (`automationGateAllows`), a large-setup import or a
// destroy-and-rebuild sweep may be in flight (`isBootstrapActive`,
// `isDeskWorkBlocked`), a slice of the registration or calendar sync may still
// be working. Each of those answers with a TOAST and returns — and a toast is
// the one thing nobody sees here, because it appears in the corner of a sheet
// that is at that moment showing Google's own "Running script…" banner, lasts
// a few seconds, and is gone before anybody has looked up from the queue.
//
// What that adds up to, from the desk, is the worst possible symptom: several
// unrelated menu items that "show running script and then nothing happens, no
// error", with the executions list reporting every one of them as completed.
// Completed is the truth — the function ran, declined, and returned. Nothing
// in the workbook says so anywhere a person is looking.
//
// Worse, the refusals COMPOUND. A sweep that paused automation and then died
// without finishing (an execution killed at the account's ceiling leaves no
// `finally`) leaves every gated item declining, hourly, indefinitely — and the
// registrations stop importing while the workbook goes on looking fine.
//
// So this file is two things and neither of them is clever:
//
//   1. `reportWhyNothingHappened()` — one menu item that states, in an ALERT
//      somebody has to dismiss, every reason the workbook currently has for
//      refusing to do something. It is ungated on purpose: the person who
//      needs it is by definition the person nothing is working for, and it
//      only ever READS.
//   2. `clearStuckBackgroundJobs()` — the escape hatch, on the menu instead of
//      in the Apps Script editor, because "open the editor and run
//      cancelFormRebuildSweep()" is not a thing a front desk can do.
//
// AND THE REFUSALS THEMSELVES GOT LOUDER. `explainRefusal()` is what the gated
// entry points say no through now: an alert where there is a UI to alert into,
// the toast as the fallback for the trigger runs. One sentence somebody has to
// dismiss beats five paragraphs nobody sees.
// ============================================================================

/**
 * The four multi-execution jobs, in the order a person should think about
 * them. Lazy (`01a`) because every key it names lives in another file.
 *
 * `cancel` is the function that stands the job down properly — putting back
 * whatever it paused — or null for the two that pause nothing and whose state
 * is simply a plan to be dropped.
 */
defineLazyGlobal_('BACKGROUND_JOB_STATES', () => [
  {
    key: BOOTSTRAP_STATE_PROP_KEY,
    label: 'the large-setup import',
    blocks: 'Quick Mark, the syncs, and most of the Admin menu',
    cancel: 'cancelBootstrapCalendars'
  },
  {
    key: FORM_REBUILD_STATE_PROP_KEY,
    label: 'the destroy-and-rebuild forms sweep',
    blocks: 'the syncs and most of the Admin menu (not Quick Mark)',
    cancel: 'cancelFormRebuildSweep'
  },
  {
    key: REGISTRATION_SYNC_STATE_PROP_KEY,
    label: 'the registration sync',
    blocks: 'nothing on its own — it is the sync finishing itself off in slices',
    cancel: null
  },
  {
    key: CALENDAR_SYNC_STATE_PROP_KEY,
    label: 'the calendar sync',
    blocks: 'nothing on its own — it is the sync finishing itself off in slices',
    cancel: null
  }
]);

/**
 * How long a job may go without advancing before this calls it stuck.
 *
 * Deliberately LOOSER than each job's own staleness bound: those decide
 * whether to ignore a job, and this decides whether to tell somebody about it.
 * A job that is merely slow should not be reported as broken while its own
 * code is still happily resuming it.
 */
const BACKGROUND_JOB_STUCK_MS = 30 * 60 * 1000;

/** What the report says when there is nothing wrong. */
const NOTHING_BLOCKING_MESSAGE =
  'Nothing is blocking the menu. Automation is on, no background job is in flight, and outbound ' +
  'mail is not paused.\n\nIf a menu item still does nothing, it is not being refused — say so, ' +
  'because that is a different fault from this one.';

// ---------------------------------------------------------------------------
// 99g-a. What is refusing
// ---------------------------------------------------------------------------

/**
 * Every reason the workbook currently has for declining to do something, as a
 * list of { title, detail, fix } — and NOTHING ELSE. It reads; it never
 * repairs, never writes and never takes a lock, because the one thing it must
 * be able to do is answer on a workbook where everything else is stuck.
 *
 * Each read is guarded on its own: a property store that will not answer must
 * cost its own line rather than the whole report.
 */
function collectWorkbookRefusals() {
  const found = [];

  // 1. THE KILL SWITCH. First because it is the commonest answer and the one
  //    with a cell somebody can see.
  guardRefusalRead_(found, 'the automation switch', () => {
    if (isAutomationEnabled()) return;
    found.push({
      title: 'Automation is paused',
      detail: 'Every sync declines while this is off — "Update Everything Now", "Sync Registrations" ' +
        'and the hourly runs all return without doing anything.',
      fix: `Set Automation_Enabled back to "Yes" on the Config tab (${CONFIG_LAYOUT.AUTOMATION.title}).`
    });
  });

  // 2. THE MULTI-EXECUTION JOBS, each with its own age, because "in flight"
  //    and "in flight since Tuesday" are different answers.
  BACKGROUND_JOB_STATES.forEach(job => {
    guardRefusalRead_(found, job.label, () => {
      const state = getSlicedJobState(job.key, job.label);
      if (!state) return;
      const since = state.lastSliceAt || state.startedAt || 0;
      const minutes = since ? Math.round((Date.now() - since) / 60000) : null;
      const stuck = since && (Date.now() - since) > BACKGROUND_JOB_STUCK_MS;
      found.push({
        title: `${job.label} is in flight` + (stuck ? ' and has stopped advancing' : ''),
        detail: `It last did anything ${minutes === null ? 'at an unrecorded time' : `${minutes} minute(s) ago`}` +
          `, after ${state.slices || 0} slice(s). While it is in flight it blocks ${job.blocks}.` +
          (stuck
            ? ' A job that has not advanced in half an hour is one whose execution was killed part-way ' +
              'through — Apps Script stops a run at the account\'s ceiling with no warning and no error.'
            : ''),
        fix: stuck
          ? (job.cancel
            ? 'Run 🔧 Admin ▸ 🧹 Clear a Stuck Background Job, which stands it down and puts back ' +
              'anything it paused.'
            : 'Run 🔧 Admin ▸ 🧹 Clear a Stuck Background Job to drop the half-finished plan; the next ' +
              'sync starts a fresh one.')
          : 'Nothing to do — let it finish, then try again.'
      });
    });
  });

  // 3. THE SECOND KILL SWITCH, which stops something different and is worth
  //    saying because "why did nobody get an email?" arrives in the same
  //    conversation as "why did nothing happen?".
  guardRefusalRead_(found, 'the outbound-mail pause', () => {
    if (!isOutboundMailPaused()) return;
    found.push({
      title: 'Outbound mail is paused',
      detail: 'The syncs, dashboards and repairs all run as usual, but nothing leaves the ' +
        'organization — reminders, leader alerts and confirmations are dropped rather than queued.',
      fix: `Set Pause_Outbound_Mail back to "No" on the Config tab (${CONFIG_LAYOUT.AUTOMATION.title}).`
    });
  });

  // 4. THE REHEARSAL SWITCH, which is the one that looks most like a fault: the
  //    syncs run, the tabs fill, the log says messages went — and no member,
  //    leader or guest hears anything, because every message went to the office
  //    instead. Left on by somebody who meant to press it once, that is a week
  //    of reminders nobody received.
  guardRefusalRead_(found, 'notification test mode', () => {
    if (!isNotificationTestMode()) return;
    found.push({
      title: 'Notification test mode is on',
      detail: 'Every message that would leave the office — leader alerts, day-before digests, registrant ' +
        'reminders and confirmations — is being diverted to the office\'s own addresses instead, and ' +
        'calendar guests are not being added at all. Nothing is consumed: the real messages are still ' +
        'owed and go out once this is off.',
      fix: `Set ${CONFIG_LAYOUT.TEST_MAIL.title} back to "No" on the Config tab ` +
        `(${CONFIG_LAYOUT.TEST_MAIL.headers[0]}).`
    });
  });

  return found;
}

/**
 * Runs one check and turns its failure into a line of the report.
 *
 * A report that throws is a report nobody can read, and on the workbook this
 * is for, something throwing is exactly what is being asked about.
 */
function guardRefusalRead_(found, label, read) {
  try {
    read();
  } catch (err) {
    found.push({
      title: `Could not check ${label}`,
      detail: String(err),
      fix: 'That failure is itself worth reporting — it means this workbook cannot read its own settings.'
    });
  }
}

/**
 * The report as words. Kept apart from the alert so it can be logged, tested,
 * and read from the Apps Script editor by somebody who cannot open a dialog at
 * all — which, on the workbook this exists for, is a real possibility.
 */
function describeWorkbookRefusals(refusals) {
  const found = refusals || collectWorkbookRefusals();
  if (found.length === 0) return NOTHING_BLOCKING_MESSAGE;
  return found.map((item, i) =>
    `${i + 1}. ${item.title}\n   ${item.detail}\n   → ${item.fix}`).join('\n\n');
}

/**
 * MENU ACTION — "❓ Why did nothing happen?".
 *
 * UNGATED, and that is the whole point: every gate in this project is a reason
 * this item might have to explain, so a gate in front of it would be a locked
 * door with the key behind it. It only reads.
 */
function reportWhyNothingHappened() {
  const text = describeWorkbookRefusals();
  log(`reportWhyNothingHappened:\n${text}`);
  try {
    SpreadsheetApp.getUi().alert('Why did nothing happen?', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // No UI (the editor, or a trigger). The log line above is the answer.
    toastIfPossible('See the log — the reasons are written there.');
  }
}

// ---------------------------------------------------------------------------
// 99g-b. Standing a stuck job down
// ---------------------------------------------------------------------------

/**
 * MENU ACTION — "🧹 Clear a Stuck Background Job".
 *
 * The escape hatch, moved out of the Apps Script editor. It asks first, names
 * exactly what it is about to stand down, and prefers each job's OWN cancel
 * function, because those put back what the job paused — a sweep that paused
 * the hourly triggers has to have them restored, and dropping its state alone
 * would leave a workbook that never syncs again and nothing to say why.
 *
 * Whatever a job already finished stays finished: every one of them is written
 * to resume from the sheet rather than from its plan, so re-running it picks up
 * what is left.
 */
function clearStuckBackgroundJobs() {
  const inFlight = [];
  BACKGROUND_JOB_STATES.forEach(job => {
    try {
      if (getSlicedJobState(job.key, job.label)) inFlight.push(job);
    } catch (err) {
      log(`⚠️ Could not read ${job.label}'s state (${err}).`);
    }
  });

  const ui = tryGetUi_();
  if (inFlight.length === 0) {
    const message = 'No background job is in flight, so there is nothing to clear. If a menu item is ' +
      'still doing nothing, run "Why did nothing happen?" beside this one.';
    if (ui) ui.alert('Nothing to clear', message, ui.ButtonSet.OK);
    log(`clearStuckBackgroundJobs: ${message}`);
    return;
  }

  if (ui) {
    const answer = ui.alert('Clear a stuck background job?',
      `This will stand down:\n\n${inFlight.map(j => `• ${j.label}`).join('\n')}\n\n` +
      'Anything already done stays done — each of these resumes from the workbook rather than from ' +
      'its own plan, so re-running it picks up what is left. Triggers that a job paused are put back.\n\n' +
      'Clear them?', ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) {
      log('clearStuckBackgroundJobs: declined at the prompt.');
      return;
    }
  }

  const cleared = [];
  const refused = [];
  inFlight.forEach(job => {
    try {
      // Its own escape hatch where it has one, because those put back what the
      // job paused. Named rather than looked up off the global object: a
      // string that no longer names a function would fail silently, which is
      // the exact class of fault this file exists for.
      if (job.cancel === 'cancelBootstrapCalendars') cancelBootstrapCalendars();
      else if (job.cancel === 'cancelFormRebuildSweep') cancelFormRebuildSweep();
      else clearSlicedJobState(job.key);
      // A CANCEL CAN ITSELF BE REFUSED: both escape hatches are admin-gated
      // (ADMIN_GATED_ACTIONS, `01`), so the account pressing this may not be
      // allowed to run them — and reporting "stood down" for a job still
      // sitting there would be this file committing the very fault it exists
      // to report. The state is the honest check.
      if (getSlicedJobState(job.key, job.label)) refused.push(job.label);
      else cleared.push(job.label);
    } catch (err) {
      log(`⚠️ Could not stand down ${job.label} (${err}).`);
    }
  });

  const summary = [
    cleared.length > 0
      ? `Stood down: ${cleared.join(', ')}. Run 🔄 Update Everything Now when you are ready — and if the ` +
        'hourly runs had been paused, run 🔧 Admin ▸ Check Triggers once to be sure they are back.'
      : '',
    refused.length > 0
      ? `Still in flight: ${refused.join(', ')}. Standing those down is restricted to ` +
        `${listAuthorizedAdminEmails().join(', ')} — the refusal says which account. Sign in as one of ` +
        'them and press this again.'
      : ''
  ].filter(Boolean).join('\n\n') || 'Nothing could be stood down — see the log.';
  log(`clearStuckBackgroundJobs: ${summary}`);
  if (ui) ui.alert('Background jobs', summary, ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// 99g-c. Saying no where somebody can see it
// ---------------------------------------------------------------------------

/**
 * How the gated entry points decline now.
 *
 * A TOAST IS NOT A REFUSAL ANYBODY READS. It appears in the corner of a sheet
 * that is showing Google's own "Running script…" banner, lasts a few seconds,
 * and is gone before the person who pressed the item has looked up — which is
 * how several unrelated menu items came to be reported as "does nothing, no
 * error". An alert has to be dismissed, so it cannot be missed, and it names
 * the item that will explain the rest.
 *
 * Falls back to the toast when there is no UI to alert into, which is every
 * trigger run: an hourly pass standing down is ordinary and must not throw.
 */
function explainRefusal(message) {
  const full = `${message}\n\nRun "❓ Why did nothing happen?" on the menu for everything that is ` +
    'currently blocking, and what to do about each.';
  log(full);
  const ui = tryGetUi_();
  if (!ui) {
    toastIfPossible(message);
    return;
  }
  try {
    ui.alert('Nothing happened, and here is why', full, ui.ButtonSet.OK);
  } catch (err) {
    toastIfPossible(message);
  }
}

/** The UI, or null where there is none (a trigger, the editor). Never throws. */
function tryGetUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (err) {
    return null;
  }
}
