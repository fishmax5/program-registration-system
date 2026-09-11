// ============================================================================
// 89. EVERY FILE THIS SYSTEM MADE, OPENED BACK UP  (one menu item)
// ============================================================================
//
// THE FAILURE THIS REPAIRS. Every file this project produces is created by
// whoever pressed the button — a real person, signed in as themselves — and
// read and rewritten every hour by whoever owns the triggers, which is
// routinely a DIFFERENT account. Drive gives a new file to its creator alone,
// so the hourly run opens it, is refused, and the work stops without anything
// looking broken:
//
//   a registration form  → responses stop arriving on All_Registrants
//   a registrant sheet   → a leader's ticks never come back, and the refresh
//                          fails with whatever Drive threw that hour
//   a sign-in Doc        → the desk's link opens a file nobody can rebuild
//   a form image         → the question builder cannot copy it onto the form
//   a folder             → the next generated file cannot be filed into it
//
// `46`'s openUpAllFormSharing() already did this for FORMS. Everything else
// was repaired only by the run that happened to touch it (and a registrant
// sheet, only the first time — see pushProgramLeaderSheets()'s accessOpened
// flag), which is no help at all when the file was made before that code
// existed or by an account that has since left. This is the one sweep over
// every artifact whose id this workbook has written down.
//
// IT IS THE SAME TRADE `46` ALREADY MADE, and the banner on
// openUpFileToAnyoneWithLink() states it: the accounts that run this system
// become named editors, and anyone with the link can edit. A registration form
// is a public sign-up page and a roster is first names and ticks; the
// alternative in practice is a file nobody can open and a feature nobody uses.
// TWO KINDS STOP SHORT OF THE LINK, and get the named editors only. A FOLDER,
// because a link-editable folder hands over everything inside it, now and in
// future. And a form IMAGE, because `55` promises the person who uploaded it
// that "a photo put on a public form is not a Drive file made public" — the
// form carries a COPY of the bytes, so nothing is lost by keeping the original
// shut.
//
// RUN IT AS THE ACCOUNT THAT OWNS THE FILES. An account that cannot reach a
// file cannot change its sharing either, so running this from the account
// being refused REPORTS the problem rather than fixing it — per file, by name,
// so the next run can be made from the right account.
//
// IT CARRIES ITSELF ON, and that is the whole reason it is a sliced job. A
// workbook with three hundred artifacts is more Drive calls than one execution
// has, and the first version of this stopped at its deadline and asked the
// person to press the item again — which is a repair that only finishes if
// somebody sits there pressing it, on the workbook where it matters most. It
// runs on `runSlicedJob` (`75`) now, like the four other long jobs here: the
// plan is fixed at the press, each slice works to a budget, records every file
// as it finishes, and arms the next slice thirty seconds out. Nothing to press
// again, and a slice killed outright still leaves exactly one successor.
//
// Every step is idempotent, so a file done twice costs a round trip and
// nothing else — which is what makes the resume safe rather than delicate.
//
// LOAD ORDER: it may sit anywhere. Behavior only, its nine constants stand
// alone, and everything it reaches for — the registries (`06`, `46`, `69`),
// the folders (`82`), the Config reads (`15`), openUpFileToAnyoneWithLink()
// (`46`) and the sliced-job runner (`75`) — it reads at CALL time or through a
// hoisted function declaration.
// ============================================================================

/**
 * This job's state: the plan fixed at the press, the ids finished, the count
 * opened and the refusals. `_V2` because the shape changed when the sweep
 * became a sliced job — it held `{ startedAt, done: {} }` before, which the
 * runner cannot resume from.
 */
const SHARING_SWEEP_STATE_PROP_KEY = 'OPEN_UP_SHARING_SWEEP_V2';

/** The trigger handler one slice arms for the next. A NAME, so it must match. */
const SHARING_SWEEP_RESUME_HANDLER = 'resumeOpenUpAllFileSharing';

/**
 * How long one slice works before it stops tidily and hands on. Short of the
 * six-minute kill by enough to record the last file and arm the successor.
 */
const SHARING_SWEEP_BUDGET_MS = 4 * 60 * 1000;

/** The gap before the next slice after a clean hand-off. */
const SHARING_SWEEP_RESUME_DELAY_MS = 30 * 1000;

/**
 * The watchdog armed BEFORE any work — longer than the execution ceiling, so a
 * slice killed outright is followed by exactly one successor rather than
 * racing the hand-off this same slice is about to arm.
 */
const SHARING_SWEEP_WATCHDOG_DELAY_MS = 8 * 60 * 1000;

/** Ceiling, so a sweep that cannot finish ends and says so. */
const SHARING_SWEEP_MAX_SLICES = 40;

/** Slices in a row reaching no file at all before it gives up. */
const SHARING_SWEEP_MAX_STALLED_SLICES = 2;

/** Slices in a row ending in an exception before it gives up. See the runner call. */
const SHARING_SWEEP_MAX_ERROR_SLICES = 3;

/**
 * State older than this is not "in flight", it is abandoned — the execution
 * died in a way that took its watchdog with it. Reading it as finished is what
 * stops one dead sweep blocking every later press forever.
 */
const SHARING_SWEEP_STALE_MS = 60 * 60 * 1000;

/**
 * EVERY GOOGLE FILE THIS WORKBOOK HAS AN ID FOR, as
 * `{ id, what, folder, linkSharing }`, in the order they are worth repairing.
 *
 * Read from the SAME registries organizeGeneratedFiles() (`82`) files things
 * by, deliberately: two lists of "what this system made" would drift, and the
 * one that drifts is the one that silently stops repairing something.
 *
 * The registration forms come from the session table's Form_ID column AS WELL
 * AS the persistent registry, because those disagree in both directions — a
 * group whose key changed leaves a form in the registry that no row names, and
 * a form repointed by hand (`47`) is named by rows the registry never heard of.
 * Both are live forms somebody can still submit.
 *
 * Never throws: a registry that cannot be read costs its own entries and
 * nothing else.
 */
function collectGeneratedArtifactTargets() {
  const targets = [];
  const seen = {};
  // `opts` carries the two answers `openUpFileToAnyoneWithLink` takes: how to
  // FETCH the id (`folder`), and how far to OPEN it (`linkSharing`, defaulting
  // to on for a file and off for a folder).
  const add = (id, what, opts) => {
    const fileId = String(id || '').trim();
    if (!fileId || seen[fileId]) return;
    seen[fileId] = true;
    const folder = !!(opts && opts.folder);
    targets.push({
      id: fileId,
      what: what,
      folder: folder,
      linkSharing: opts && opts.linkSharing !== undefined ? !!opts.linkSharing : !folder
    });
  };
  const guarded = (label, fn) => {
    try {
      fn();
    } catch (err) {
      log(`ℹ️ Could not list ${label} for the sharing sweep (${err}) — carrying on with the rest.`);
    }
  };

  // --- forms ---------------------------------------------------------------
  guarded('the registration forms on the session table', () => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    const map = getIndexMap(HEADERS.All_Program_Sessions);
    getSectionedRows(sheet, HEADERS.All_Program_Sessions, 'Event_ID').forEach(row => {
      add(row[map['Form_ID']], 'a registration form');
    });
  });

  guarded('the stored form registry', () => {
    const registry = getPersistentFormRegistry();
    Object.keys(registry).forEach(groupKey => {
      add(registry[groupKey], `the registration form for ${groupKey}`);
    });
  });

  guarded('the lunch sign-up forms', () => {
    const links = getLunchOnlyFormLinks();
    Object.keys(links).forEach(groupKey => {
      add((links[groupKey] || {}).formId, `the lunch sign-up form for ${groupKey}`);
    });
  });

  // The template every form is copied from: one the syncing account cannot
  // open is a workbook that can never build another form.
  guarded('the form template', () => {
    add(getOrCreateTemplateForm().getId(), 'the form template');
  });

  // The door's membership application. Its id is TYPED on Config rather than
  // made here, so this is the one target the workbook may not own at all — and
  // the one where a refusal is an ordinary answer rather than a fault.
  guarded('the membership application form', () => {
    add(getMembershipFormId(), 'the membership application form');
  });

  // --- spreadsheets and documents ------------------------------------------
  guarded('the program registrant sheets', () => {
    const registry = getProgramLeaderSheetRegistry();
    Object.keys(registry).forEach(programKey => {
      const entry = registry[programKey] || {};
      add(entry.fileId, `the registrant sheet for "${entry.title || programKey}"`);
    });
  });

  guarded('the sign-in sheets', () => {
    const registry = getSignInSheetRegistry();
    Object.keys(registry).forEach(key => {
      const entry = registry[key] || {};
      add(entry.fileId, `the sign-in sheet for ${key.replace('|', ' at ')}`);
    });
  });

  // --- the pictures on the forms -------------------------------------------
  // NAMED EDITORS, AND NO LINK, which is the one place this sweep deliberately
  // stops short of what it does to everything else.
  //
  // The account that puts a question on a form reads the picture's BYTES
  // (`DriveApp.getFileById(...).getBlob()` in `54`) and uploads a copy into the
  // form — routinely the trigger owner rather than whoever uploaded it, which
  // is why the file needs an editor added at all. But the FORM does not read
  // the Drive file, and `55`'s banner makes that a promise to the person who
  // uploaded it: "a photo put on a public form is not a Drive file made
  // public." Opening these to anyone with the link would quietly break that,
  // for nothing — the copy on the form is what people see.
  //
  // Listed from the folder rather than a registry because there is no
  // registry: `55` uploads them and the question row holds the only reference.
  guarded('the form images', () => {
    const files = getOrCreateFormImageFolder().getFiles();
    while (files.hasNext()) {
      const file = files.next();
      add(file.getId(), `the form image "${file.getName()}"`, { linkSharing: false });
    }
  });

  // --- the folders they live in --------------------------------------------
  // Named editors only. A folder open to anyone with the link hands over
  // everything inside it, now and in the future, which is a bigger promise
  // than any single file here makes.
  guarded('this system\'s folders', () => {
    [getSystemRootFolder(),
      getOrCreateFormsFolder(),
      getOrCreateSignInSheetDocFolder(),
      getOrCreateSignInSheetFolder(),
      getOrCreateProgramLeaderSheetFolder(),
      getOrCreateFormImageFolder()
    ].forEach(folder => {
      if (folder) add(folder.getId(), `the "${folder.getName()}" folder`, { folder: true });
    });
  });

  return targets;
}

/**
 * MENU ACTION: open up every file this system has made — forms, registrant
 * sheets, sign-in documents, form images — and add the accounts that run it as
 * editors of those and of the folders they sit in.
 *
 * Starts the job; `runOpenUpSharingSlice()` is what does the work, here and on
 * every slice after it.
 */
function openUpAllGeneratedFileSharing() {
  if (!requireAuthorizedAdmin('Open Up All File Sharing')) return 0;
  if (isOpenUpSharingSweepActive()) {
    const message = 'A sharing sweep is already running — it carries itself on every ' +
      `${Math.round(SHARING_SWEEP_RESUME_DELAY_MS / 1000)}s until every file has been looked at. ` +
      'You will be told when it finishes.';
    toastIfPossible(message);
    return 0;
  }
  if (!confirmConsequentialAction('Open up every file this system made?',
    'Registration forms, program registrant sheets, sign-in documents and form images are all set to ' +
    '"anyone with the link can edit", and the accounts that run this system are added as editors of ' +
    'them and of the folders they live in.\n\nThis is what lets an hourly sync run by one account read ' +
    'files created by another — which is what most "it stopped updating" faults turn out to be. ' +
    'Nothing is moved, renamed or deleted, and no link changes.\n\nIt carries itself on across as many ' +
    'runs as it needs, so there is nothing to press again.', true)) {
    return 0;
  }

  const targets = collectGeneratedArtifactTargets();
  if (targets.length === 0) {
    toastIfPossible('Nothing to open up — this workbook has no generated files recorded yet.');
    return 0;
  }

  // The plan is fixed HERE, at the press, rather than rebuilt per slice: a file
  // made by the hourly sync while this is running would otherwise extend a
  // sweep that is trying to end, and it is already opened up by the run that
  // made it.
  saveSlicedJobState(SHARING_SWEEP_STATE_PROP_KEY, {
    startedAt: Date.now(),
    lastSliceAt: Date.now(),
    slices: 0,
    stalledSlices: 0,
    errorSlices: 0,
    targets: targets,
    done: [],
    opened: 0,
    refused: []
  });
  log(`openUpAllGeneratedFileSharing: starting on ${targets.length} file(s) and folder(s).`);
  toastIfPossible(`Opening up ${targets.length} file(s) — this carries itself on until it is done.`);
  return runOpenUpSharingSlice();
}

/** THE TRIGGER HANDLER. Named as a string in `SHARING_SWEEP_RESUME_HANDLER`. */
function resumeOpenUpAllFileSharing() {
  runOpenUpSharingSlice();
}

/** Is a sweep in flight? Stale state reads as "no" — see `75`. */
function isOpenUpSharingSweepActive() {
  return isSlicedJobActive(SHARING_SWEEP_STATE_PROP_KEY, SHARING_SWEEP_STALE_MS, minutes =>
    `ℹ️ A sharing sweep has been idle for ${minutes} minute(s) — treating it as finished.`);
}

/**
 * ONE SLICE: work down the plan until the budget runs out, then hand on.
 *
 * NO WORKBOOK LOCK, deliberately — unlike the two form sweeps this borrows its
 * runner from. Every call in here is to Drive; nothing reads or writes a cell,
 * so holding the workbook shut for four minutes would cost the desk Quick Mark
 * and buy nothing.
 */
function runOpenUpSharingSlice() {
  return runSlicedJob({
    label: 'Open up file sharing',
    propKey: SHARING_SWEEP_STATE_PROP_KEY,
    resumeHandler: SHARING_SWEEP_RESUME_HANDLER,
    budgetMs: SHARING_SWEEP_BUDGET_MS,
    resumeDelayMs: SHARING_SWEEP_RESUME_DELAY_MS,
    watchdogDelayMs: SHARING_SWEEP_WATCHDOG_DELAY_MS,
    maxSlices: SHARING_SWEEP_MAX_SLICES,
    maxStalledSlices: SHARING_SWEEP_MAX_STALLED_SLICES,
    // An error does not end this sweep, for the same reason it does not end the
    // in-place rebuild: the commonest failure is transient and lands on a RUN
    // rather than on a file, every file already done stays done, and a sweep
    // that gives up with two hundred files left in it is a sweep somebody has
    // to notice and press again.
    maxErrorSlices: SHARING_SWEEP_MAX_ERROR_SLICES,

    work: ctx => {
      const state = ctx.state;
      const doneSet = {};
      (state.done || []).forEach(id => { doneSet[id] = true; });
      const remainingTargets = (state.targets || []).filter(t => !doneSet[t.id]);
      if (remainingTargets.length === 0) return { finished: true };

      let processed = 0;
      for (const target of remainingTargets) {
        if (Date.now() >= ctx.deadline) break;

        const outcome = openUpFileToAnyoneWithLink(target.id, target.what,
          { folder: target.folder, linkSharing: target.linkSharing });
        // A target that never asked for link sharing (a folder, a form image)
        // is judged on whether anything REFUSED; everything else on the link.
        const worked = target.linkSharing ? outcome.openedUp : outcome.problems.length === 0;
        if (worked) state.opened = (state.opened || 0) + 1;
        else {
          state.refused.push(`${target.what} (${target.id}) — ${outcome.problems.join('; ') || 'Drive refused'}`);
        }

        // Recorded as it finishes, not at the end of the slice: a slice killed
        // outright must not make its successor redo the files it got through.
        state.done.push(target.id);
        processed++;
        ctx.save();
      }

      const remaining = remainingTargets.length - processed;
      if (remaining <= 0) return { finished: true };
      // A slice that got this far did not fail, whatever it did — so the
      // consecutive-error count starts again from here.
      state.errorSlices = 0;
      return { processed: processed, remaining: remaining };
    },

    onHandOff: (state, result) => {
      toastIfPossible(`Opening up file sharing: ${state.done.length} done, ${result.remaining} to go. ` +
        `It carries on by itself in ${Math.round(SHARING_SWEEP_RESUME_DELAY_MS / 1000)}s.`);
    },

    overrunProblem: () => `stopped after ${SHARING_SWEEP_MAX_SLICES} runs without finishing`,
    stalledProblem: result => `stopped early — ${result.remaining} file(s) could not be reached at all`,

    onError: (err, n) => {
      log(`⚠️ A sharing sweep run failed (${err}) — failure ${n} of ${SHARING_SWEEP_MAX_ERROR_SLICES} in a row.`);
    },
    errorProblem: (err, n) =>
      `stopped after ${n} run(s) in a row ended in an error, the last of them: ${err}`,
    saveErrorProblem: err => `stopped after an error it could not record: ${err}`,

    onDone: (state, problem) => finishOpenUpSharingSweep(state, problem)
  });
}

/** Ends the sweep: clear the state, drop the hand-off trigger, say what happened. */
function finishOpenUpSharingSweep(state, problem) {
  clearSlicedJobState(SHARING_SWEEP_STATE_PROP_KEY);
  deleteSlicedJobResumeTriggers(SHARING_SWEEP_RESUME_HANDLER);

  const refused = state.refused || [];
  const left = Math.max(0, (state.targets || []).length - (state.done || []).length);

  refused.forEach(line => {
    noteForAdmin('Files whose sharing could not be changed',
      `${line}. This account cannot change its sharing, which almost always means it does not own the ` +
      `file. Sign in as the account that created it and run Open Up All File Sharing again.`);
  });

  const parts = [problem
    ? `⚠️ Opening up file sharing ${problem}. ${state.opened || 0} file(s) were opened up; ${left} still to do.`
    : `✅ File sharing opened up on ${state.opened || 0} file(s) and folder(s).`];
  if (refused.length > 0) {
    parts.push(`${refused.length} refused this account — run it again signed in as whoever created them ` +
      `(they are named in the log and in the office digest).`);
  }
  const headline = parts.join(' ');

  log(`openUpAllGeneratedFileSharing: ${headline}`);
  if (problem) noteForAdmin('Open up file sharing', headline);
  flushAdminDigest('File sharing');
  toastIfPossible(headline);
  return state.opened || 0;
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops a sweep that is still
 * handing itself on. Whatever has been opened up stays opened up.
 */
function cancelOpenUpAllFileSharing() {
  clearSlicedJobState(SHARING_SWEEP_STATE_PROP_KEY);
  const removed = deleteSlicedJobResumeTriggers(SHARING_SWEEP_RESUME_HANDLER);
  log(`cancelOpenUpAllFileSharing: state cleared, ${removed} pending hand-off trigger(s) removed.`);
  toastIfPossible('Sharing sweep stopped. Everything already opened up stays that way.');
}
