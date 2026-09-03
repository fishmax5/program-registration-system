// ============================================================================
// 6f-iv. A FORM THAT WAS DELETED OUT OF THE DRIVE FOLDER
// ============================================================================
//
// Everything else in this file assumes a form's Drive file is where the system
// left it. Nothing enforces that: the forms live in an ordinary Drive folder
// that people open, tidy and delete out of, and a form dragged to the trash
// leaves no mark anywhere in this workbook. The dashboard still carries its
// link, the registry still names it, the calendar events still point at it —
// and a resident clicking that link meets "File not found". Worse, the fault
// is invisible from the sheet: every column reads exactly as it did the day
// before.
//
// Two facts make this recoverable, and they are the reason this is a separate
// action rather than a branch of the rebuild:
//
//   • A TRASHED FORM IS STILL A FORM. Drive keeps it for 30 days, its ID, its
//     published URL and every response already collected all survive, and
//     setTrashed(false) puts it back exactly as it was. That is a strictly
//     better outcome than any rebuild: no link changes, so nothing handed out
//     on a flyer or in an email breaks. Restoring must therefore be TRIED
//     FIRST and rebuilding kept for the forms where it is genuinely too late.
//   • A FORM CAN BE LOST WITHOUT BEING TRASHED. Dragging it out of the folder,
//     or "removing" it from a shared folder, leaves the file alive and the
//     links working but the folder no longer describing what exists. That is
//     a filing problem, not a data-loss one, and the fix is to file it back —
//     it must not be confused with the trashed case, and it must never
//     trigger a rebuild.
//
// So the states below are deliberately four, not two, and each one gets the
// smallest fix that answers it. The only irreversible outcome — a new form,
// with a new link — is reached only for a file Drive itself can no longer
// produce, and only after a second, separate confirmation.
// ============================================================================

/** A form whose Drive file is present, untrashed, and filed where it belongs. */
const FORM_FILE_OK = 'ok';
/** Alive and linkable, but no longer in the forms folder. Filing, not damage. */
const FORM_FILE_STRAYED = 'strayed';
/** In the Drive trash — restorable, with its ID, link and responses intact. */
const FORM_FILE_TRASHED = 'trashed';
/** Drive cannot produce the file at all: emptied from the trash, or owned by
 *  an account this one can no longer reach. Only a rebuild answers this. */
const FORM_FILE_GONE = 'gone';

/**
 * Every form this workbook still depends on, each with something readable to
 * call it by and a count of the sessions that would be affected if it were
 * gone.
 *
 * THREE SOURCES, because a form can be depended on without appearing in all
 * three: the dashboard's Form_ID column (what the links point at), the
 * persistent group -> form registry (what the NEXT sync will reuse), and the
 * stored lunch-only links (a lunch sign-up form has no session rows of its
 * own). A form named by any one of them is a form whose disappearance breaks
 * something, so the union is what gets checked.
 */
function collectFormsWorkbookDependsOn(sessionRows, map, registry, lunchLinks) {
  const byId = {};
  const todayKey = formatDateKey(new Date());
  const ensure = formId => {
    if (!byId[formId]) {
      byId[formId] = { formId, titles: [], locations: [], sessions: 0, upcoming: 0, sources: [] };
    }
    return byId[formId];
  };
  const note = (entry, source) => {
    if (entry.sources.indexOf(source) === -1) entry.sources.push(source);
  };

  (sessionRows || []).forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    if (!formId) return;
    const entry = ensure(formId);
    note(entry, 'dashboard');
    entry.sessions++;
    const date = coerceDate(row[map['Event_Date']]);
    if (date && formatDateKey(date) >= todayKey) entry.upcoming++;
    const title = String(row[map['Clean_Title']] || '').trim();
    if (title && entry.titles.indexOf(title) === -1) entry.titles.push(title);
    const location = String(row[map['Location']] || '').trim();
    if (location && entry.locations.indexOf(location) === -1) entry.locations.push(location);
  });

  Object.keys(registry || {}).forEach(groupKey => {
    const formId = String(registry[groupKey] || '').trim();
    if (!formId) return;
    note(ensure(formId), 'registry');
  });

  Object.keys(lunchLinks || {}).forEach(groupKey => {
    const formId = String((lunchLinks[groupKey] || {}).formId || '').trim();
    if (!formId) return;
    note(ensure(formId), 'lunch');
  });

  return Object.keys(byId).map(formId => {
    const entry = byId[formId];
    // A form named only by the registry has no rows to describe it, and its
    // group key is the only human-readable thing anybody has. Better than an
    // ID on its own, which is what the dialog would otherwise be full of.
    if (entry.titles.length === 0) {
      const key = Object.keys(registry || {}).filter(k => String(registry[k] || '').trim() === formId)[0];
      entry.describe = key ? `${key} (no session rows)` : `form ${formId.substring(0, 8)}…`;
    } else {
      entry.describe = `${entry.titles.slice(0, 2).join(', ')}${entry.titles.length > 2 ? '…' : ''}` +
        (entry.locations.length > 0 ? ` (${describeLocations(entry.locations)})` : '');
    }
    return entry;
  }).sort((a, b) => a.describe.localeCompare(b.describe));
}

/**
 * WHICH OF THE FOUR STATES a probe describes. Split out from the Drive call
 * so the decision can be reasoned about — and tested — without a Drive.
 *
 * "Cannot tell which folder it is in" is treated as OK rather than as
 * strayed: an unreadable parent list is a permissions answer, not a filing
 * one, and moving a file on the strength of it is how a form ends up
 * somewhere nobody expects.
 */
function classifyFormFileState(probe) {
  if (!probe || !probe.found) return FORM_FILE_GONE;
  if (probe.trashed) return FORM_FILE_TRASHED;
  if (probe.inFolder === false) return FORM_FILE_STRAYED;
  return FORM_FILE_OK;
}

/** Asks Drive what became of one form file. Never throws. */
function probeFormFile(formId, folderId) {
  let file;
  try {
    file = DriveApp.getFileById(formId);
  } catch (err) {
    return { found: false, trashed: false, inFolder: false };
  }
  let trashed = false;
  try {
    trashed = !!file.isTrashed();
  } catch (err) {
    log(`ℹ️ Could not read the trashed state of form ${formId} (${err}) — treating it as present.`);
  }
  // A TRASHED FILE'S PARENTS ARE NOT ASKED ABOUT. Drive reports them
  // inconsistently for something in the trash, and the answer would not
  // change anything anyway: restoring it puts it back where it was, and the
  // filing pass below re-checks it afterwards.
  let inFolder = true;
  if (folderId && !trashed) {
    inFolder = false;
    try {
      const parents = file.getParents();
      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) { inFolder = true; break; }
      }
    } catch (err) {
      log(`ℹ️ Could not read which folders form ${formId} is in (${err}) — leaving it where it is.`);
      inFolder = true;
    }
  }
  return { found: true, trashed, inFolder };
}

/** Sorts the referenced forms into the four states. `probeFn` is injected. */
function planFormRecovery(refs, probeFn) {
  const buckets = { ok: [], strayed: [], trashed: [], gone: [] };
  (refs || []).forEach(ref => {
    const state = classifyFormFileState(probeFn(ref.formId));
    buckets[state].push(Object.assign({}, ref, { state }));
  });
  return buckets;
}

/**
 * Takes one form back out of the trash and files it in the forms folder.
 * Returns true if the file ended up untrashed.
 *
 * The filing is best-effort ON PURPOSE: a form that is out of the trash is a
 * form whose link works again, which is the whole point of the action. Which
 * folder it sits in afterwards is tidiness, and tidiness must not be able to
 * report a successful rescue as a failure.
 */
function restoreOneFormFile(formId, folder) {
  const file = DriveApp.getFileById(formId);
  file.setTrashed(false);
  // ASKED AGAIN, AFTER THE RESTORE. Untrashing puts a file back where it came
  // from, which for a form this system built is the forms folder already — so
  // the ordinary case has nothing to move, and trying to move it anyway is
  // what produced a "could not be filed" line under every single rescue.
  if (!isFormFiledIn(file, folder)) fileFormIntoFormsFolder(file, folder);
  return true;
}

/** Is this file already a child of `folder`? Unreadable parents answer "yes" — see classifyFormFileState(). */
function isFormFiledIn(file, folder) {
  if (!folder) return true;
  try {
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) return true;
    }
    return false;
  } catch (err) {
    return true;
  }
}

/**
 * Files the form into the forms folder.
 *
 * moveTo() FIRST, and addFile() only as the fallback. addFile()/removeFile()
 * are the old Drive-v2 shape and they throw "Cannot use this operation on a
 * shared drive item" outright — which is not an exotic case here: a workbook
 * run by a center with a Google Workspace account keeps its forms on a shared
 * drive, so on those setups EVERY rescue reported a filing failure it had no
 * way to avoid. moveTo() is the operation that works in both places.
 *
 * A shared drive also has no "My Drive root" to take the file out of, so the
 * root cleanup belongs with the fallback that needs it, not before the move.
 */
function fileFormIntoFormsFolder(file, folder) {
  if (!folder) return;
  try {
    file.moveTo(folder);
    return;
  } catch (err) {
    log(`ℹ️ Form ${file.getId()} could not be moved into "${FORMS_FOLDER_NAME}" (${err}) — trying the older Drive call.`);
  }
  try {
    folder.addFile(file);
    const root = DriveApp.getRootFolder();
    const parents = file.getParents();
    let inRoot = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === root.getId()) { inRoot = true; break; }
    }
    if (inRoot) root.removeFile(file);
  } catch (err) {
    log(`ℹ️ Form ${file.getId()} could not be filed into "${FORMS_FOLDER_NAME}" (${err}) — it is otherwise fine: ` +
      `the form is out of the trash and its link works. Only which folder it sits in is unsettled.`);
  }
}

/** Takes every form in `refs` back out of the trash. Returns { restored, failed }. */
function restoreTrashedFormsNow(refs, folder) {
  const out = { restored: 0, failed: 0 };
  (refs || []).forEach(ref => {
    try {
      restoreOneFormFile(ref.formId, folder);
      out.restored++;
      log(`Recover forms: restored ${ref.describe} (form ${ref.formId}) from the trash.`);
    } catch (err) {
      out.failed++;
      log(`⚠️ Recover forms: ${ref.describe} (form ${ref.formId}) could not be restored (${err}).`);
      noteForAdmin('Forms that could not be restored',
        `${ref.describe} — ${describeFormLink(ref.formId)} is in the trash and this account could not take ` +
        `it out (${err}). Sign in as whoever owns the form, or restore it by hand in Drive.`);
    }
  });
  return out;
}

/** Files every form in `refs` back into the forms folder. Returns how many moved. */
function refileStrayedFormsNow(refs, folder) {
  let refiled = 0;
  (refs || []).forEach(ref => {
    try {
      fileFormIntoFormsFolder(DriveApp.getFileById(ref.formId), folder);
      refiled++;
    } catch (err) {
      log(`ℹ️ Recover forms: ${ref.describe} could not be re-filed (${err}) — its link still works.`);
    }
  });
  return refiled;
}

/**
 * ADMIN ACTION — "Recover Deleted Forms…".
 *
 * Reports the state of every form the workbook depends on, then, on
 * confirmation, restores the ones sitting in the Drive trash and re-files the
 * ones that merely wandered out of the folder. Both of those keep every
 * existing link and every response already collected.
 *
 * Forms Drive can no longer produce at all are reported separately and, on a
 * SECOND confirmation, rebuilt through the ordinary destroy-and-rebuild path —
 * which imports outstanding registrations first and rewrites the dashboard and
 * calendar links afterwards. That path is used rather than a private one so a
 * rebuild started here behaves in every respect like a rebuild started
 * anywhere else.
 */
function recoverDeletedForms() {
  if (!requireAuthorizedAdmin('Recover Deleted Forms')) return null;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — nothing to recover.');
    return null;
  }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const sessionRows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const refs = collectFormsWorkbookDependsOn(sessionRows, map, getPersistentFormRegistry(),
    getLunchOnlyFormLinks());
  if (refs.length === 0) {
    toastIfPossible('This workbook does not name a single form yet — nothing to recover.');
    return null;
  }

  toastIfPossible(`Checking ${refs.length} form(s) in Drive…`);
  let folder = null;
  let folderId = '';
  try {
    folder = getOrCreateFormsFolder();
    folderId = folder.getId();
  } catch (err) {
    log(`ℹ️ Recover Deleted Forms: the forms folder could not be opened (${err}) — ` +
      `restoring will still work, but nothing will be re-filed.`);
  }
  const buckets = planFormRecovery(refs, formId => probeFormFile(formId, folderId));
  const result = { restored: 0, refiled: 0, failed: 0, gone: buckets.gone.length, rebuild: null };

  const summary = `${refs.length} form(s) checked — ${buckets.ok.length} fine, ` +
    `${buckets.trashed.length} in the trash, ${buckets.strayed.length} outside the folder, ` +
    `${buckets.gone.length} that Drive cannot produce at all.`;
  log(`Recover Deleted Forms: ${summary}`);

  const preview = list => list.slice(0, 6).map(r => `• ${r.describe}`).join('\n') +
    (list.length > 6 ? `\n…and ${list.length - 6} more` : '');

  if (buckets.trashed.length === 0 && buckets.strayed.length === 0) {
    const message = buckets.gone.length === 0
      ? `Every form this workbook depends on is where it should be ✅ — ${summary}`
      : `Nothing is in the trash to restore, but ${buckets.gone.length} form(s) cannot be opened at all ` +
        `— they were emptied from the trash, or belong to an account this one cannot reach. ` +
        `Those can only be replaced with new forms (new links).`;
    toastIfPossible(message);
    try { SpreadsheetApp.getUi().alert('Recover Deleted Forms', message, SpreadsheetApp.getUi().ButtonSet.OK); }
    catch (uiErr) { /* no UI — the toast and the log said it */ }
    if (buckets.gone.length > 0) offerToRebuildLostForms(registrySheet, buckets.gone, result);
    return result;
  }

  const detail = [
    buckets.trashed.length > 0
      ? `IN THE TRASH — ${buckets.trashed.length} form(s) would be taken back out, keeping their ID, ` +
        `their link and every response already collected. Nothing that was handed out stops working:\n` +
        preview(buckets.trashed)
      : '',
    buckets.strayed.length > 0
      ? `OUTSIDE THE FOLDER — ${buckets.strayed.length} form(s) are alive and their links work; they are ` +
        `just not in "${FORMS_FOLDER_NAME}" any more. They would be filed back:\n` +
        preview(buckets.strayed)
      : '',
    buckets.gone.length > 0
      ? `⚠️ CANNOT BE RECOVERED — ${buckets.gone.length} form(s) cannot be opened at all, which means the ` +
        `trash was emptied or the file belongs to an account this one cannot reach. This step does not ` +
        `touch them; you will be asked separately whether to build replacements:\n` + preview(buckets.gone)
      : ''
  ].filter(Boolean).join('\n\n');

  if (!confirmConsequentialAction(
    `Restore ${buckets.trashed.length + buckets.strayed.length} form(s)?`,
    `${detail}\n\nNo form is rebuilt and no link changes here — this only puts files back where they were.`,
    false)) {
    return null;
  }

  const restored = restoreTrashedFormsNow(buckets.trashed, folder);
  result.restored = restored.restored;
  result.failed = restored.failed;
  result.refiled = refileStrayedFormsNow(buckets.strayed, folder);

  flushAdminDigest('Recover deleted forms');
  const done = `Restored ${result.restored} form(s) from the trash` +
    (result.refiled > 0 ? `, re-filed ${result.refiled}` : '') +
    (result.failed > 0 ? `, ${result.failed} failed — see the log` : '') + '.';
  log(`Recover Deleted Forms: ${done}`);
  toastIfPossible(`${result.failed > 0 ? '⚠️' : '✅'} ${done}`);

  if (buckets.gone.length > 0) offerToRebuildLostForms(registrySheet, buckets.gone, result);
  return result;
}

/**
 * The second half, and the only part that can change a link: for forms Drive
 * cannot produce, offer to build replacements.
 *
 * Restricted to forms with UPCOMING sessions, exactly as planFormRebuilds()
 * decides it — a form whose every date has passed is finished business, and
 * replacing it would hand a live sign-up page to a program that has already
 * run. A lost form with nothing upcoming is reported and left alone.
 */
function offerToRebuildLostForms(registrySheet, goneRefs, result) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const lost = {};
  goneRefs.forEach(ref => { lost[ref.formId] = ref; });

  const plan = planFormRebuilds(getSectionedRows(registrySheet, headers, 'Event_ID'), map)
    .filter(item => Object.prototype.hasOwnProperty.call(lost, item.oldFormId));
  const pastOnly = goneRefs.length - plan.length;

  if (plan.length === 0) {
    const message = `${goneRefs.length} unrecoverable form(s) have no upcoming session, so there is nothing ` +
      `to rebuild — whatever they were collecting has already happened. Their responses are already on ` +
      `${SHEET_NAMES.REGISTRANT_DASH}.`;
    log(`Recover Deleted Forms: ${message}`);
    toastIfPossible(message);
    return;
  }

  const preview = plan.slice(0, 6).map(p => `• ${p.describe} (${p.upcomingCount} upcoming date(s))`).join('\n') +
    (plan.length > 6 ? `\n…and ${plan.length - 6} more` : '');

  if (!confirmConsequentialAction(`Build ${plan.length} replacement form(s)?`,
    `These forms cannot be recovered — Drive has no file left to restore:\n${preview}\n` +
    (pastOnly > 0 ? `\n(${pastOnly} other lost form(s) have no upcoming session and are left alone.)\n` : '') +
    `\n⚠️ A REPLACEMENT IS A NEW FORM WITH A NEW LINK. Any link already handed out for these — in an ` +
    `email, on a printed flyer — stays dead, because the form it pointed at is gone either way. The ` +
    `dashboard's links and the calendar event descriptions are rewritten here, so those become right ` +
    `again.\n\n` +
    `Registrations already imported onto ${SHEET_NAMES.REGISTRANT_DASH} are untouched. Anything a lost ` +
    `form collected but never handed over cannot be imported — it went with the file.\n\n` +
    `Say no and nothing changes: the dashboard keeps pointing at the dead forms, which is at least an ` +
    `honest record of what happened.`, false)) {
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try the rebuild again in a moment.');
    return;
  }
  try {
    result.rebuild = plan.length > FORM_REBUILD_SLICE_THRESHOLD
      ? startFormRebuildSweep(plan)
      : runFormRebuildSweep(registrySheet, plan);
  } finally {
    lock.releaseLock();
  }
}



