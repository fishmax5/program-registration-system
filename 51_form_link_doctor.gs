// ============================================================================
// 6f-vi. THE FORM & LINK DOCTOR — one screen for every way a link goes wrong
// ============================================================================
//
// There were four separate menu items for this: check the tab against itself,
// check the calendar against the tab, repair the links, recover the forms. Each
// one answered a real question and none of them answered "what is wrong with
// my links", which is the only question anybody actually arrives with. Worse,
// they had to be run in the right ORDER — repairing links before restoring the
// forms they point at repairs them onto a form that is still in the trash —
// and nothing said so. Somebody debugging a bad link had to already know which
// of the four to open, which is precisely the knowledge they are missing.
//
// So: ONE item, one pass over the sheet, Drive and the calendar, and a list of
// FINDINGS in the order they should be fixed. Each finding says what is wrong,
// how many rows or programs it touches, why it matters in the words somebody
// at the front desk would use, and carries its own fix button. Nothing is
// applied until a button is pressed, and after every fix the whole diagnosis
// re-runs, so the list is always what is true NOW rather than what was true
// when the dialog opened.
//
// THE ORDER IS THE POINT, and it is dependency order, not severity order:
//
//   1. rows whose identity has shifted     nothing below can be trusted until
//                                          these are rebuilt from the calendar
//   2. forms in the trash                  restore before repairing anything
//                                          that points at them
//   3. forms nothing can recover           decide about replacements next,
//                                          since a replacement changes the ID
//                                          every later step would write
//   4. the dashboard's own links           now that every form is real
//   5. the calendar's links                last, because this step copies the
//                                          dashboard onto every event
//
// The checks themselves are the ones that already existed —
// planDashboardLinkRepair(), planFormRecovery(), planEventLinkDrift() — kept
// as they are and read from one place. This section is the diagnosis and the
// screen, not a fifth opinion.
// ============================================================================

/** Finding codes. Also the fix dispatch keys — see applyFormLinkDoctorFix(). */
const DOCTOR_FIXES = {
  RESTORE: 'restoreForms',
  REFILE: 'refileForms',
  REBUILD: 'rebuildLostForms',
  LINKS: 'repairLinks',
  EVENTS: 'rewriteEventLinks'
};

/**
 * Reads everything, decides nothing. Split from buildDoctorFindings() so the
 * decisions can be tested without a spreadsheet, a Drive or a calendar.
 */
function gatherFormLinkFacts(registrySheet, options) {
  const opts = options || {};
  const facts = { linkStats: null, recovery: null, drift: null, duplicates: [], skipped: [] };

  // THE LINK PLAN IS THE ONE STAGE THAT MUST SURVIVE, because it is the only
  // one that answers the question people actually open this for: does the
  // Form_ID column agree with the link beside it? It is also cheap relative to
  // the two below — the sheet, plus one open per DISTINCT form to read its
  // address. Guarded all the same: a single unreachable form used to take the
  // whole diagnosis down, and a diagnosis that cannot be shown is worse than a
  // partial one.
  try {
    const { stats } = planDashboardLinkRepair(registrySheet);
    facts.linkStats = stats;
  } catch (err) {
    log(`⚠️ Doctor: the link plan could not be built (${err}) — links were not checked.`);
    facts.skipped.push('links');
  }

  // DRIVE IS SKIPPABLE, and it is the stage that made this dialog unopenable.
  // It probes EVERY form this workbook depends on, one Drive call each, and
  // then lists the whole forms folder — on a centre with a hundred forms that
  // is several hundred round trips before a single pixel is drawn. See
  // showFormLinkDoctorDialog() for why nothing here runs before the dialog now.
  if (opts.skipDrive) {
    facts.skipped.push('drive');
  } else {
    try {
      const headers = HEADERS.All_Program_Sessions;
      const map = getIndexMap(headers);
      const sessionRows = getSectionedRows(registrySheet, headers, 'Event_ID');
      const refs = collectFormsWorkbookDependsOn(sessionRows, map, getPersistentFormRegistry(),
        getLunchOnlyFormLinks());
      let folderId = '';
      try {
        folderId = getOrCreateFormsFolder().getId();
      } catch (err) {
        log(`ℹ️ Doctor: the forms folder could not be opened (${err}) — filing is not checked this run.`);
      }
      facts.recovery = planFormRecovery(refs, formId => probeFormFile(formId, folderId));
      facts.duplicates = folderId ? findDuplicateFormTitles(folderId, refs) : [];
    } catch (err) {
      log(`⚠️ Doctor: Drive could not be read (${err}) — the forms themselves were not checked.`);
      facts.skipped.push('drive');
    }
  }

  // THE ONLY EXPENSIVE ONE, and the only one that can be turned off: it reads
  // every calendar in the sync window. Everything above is the sheet and Drive.
  if (opts.skipCalendar) {
    facts.skipped.push('calendar');
  } else {
    try {
      facts.drift = planEventLinkDrift(registrySheet);
    } catch (err) {
      log(`⚠️ Doctor: the calendars could not be read (${err}) — event links were not checked.`);
      facts.skipped.push('calendar');
    }
  }
  return facts;
}

/**
 * Forms in the folder sharing a title — the twins a rebuild-on-every-sync
 * leaves behind. Reported, never touched: which of two identically named forms
 * is the one with the registrations on it is not a question this can answer,
 * and deleting the wrong one is unrecoverable.
 */
function findDuplicateFormTitles(folderId, refs) {
  const inUse = {};
  (refs || []).forEach(ref => { inUse[ref.formId] = ref.describe; });
  const byTitle = {};
  try {
    const files = DriveApp.getFolderById(folderId).getFiles();
    let seen = 0;
    while (files.hasNext() && seen < DOCTOR_MAX_FOLDER_FILES) {
      seen++;
      const file = files.next();
      const title = String(file.getName() || '').trim();
      if (!title) continue;
      if (!byTitle[title]) byTitle[title] = [];
      byTitle[title].push(file.getId());
    }
  } catch (err) {
    log(`ℹ️ Doctor: the forms folder could not be listed (${err}) — duplicates were not checked.`);
    return [];
  }
  return Object.keys(byTitle)
    .filter(title => byTitle[title].length > 1)
    // Only twins the workbook is actually USING one of. Two old forms nobody
    // references are clutter in a folder, not a fault in this system.
    .filter(title => byTitle[title].some(id => inUse[id]))
    .sort()
    .map(title => ({ title, formIds: byTitle[title], usedId: byTitle[title].filter(id => inUse[id])[0] || '' }));
}

/** How many files the duplicate scan will walk before giving up. */
const DOCTOR_MAX_FOLDER_FILES = 500;

/**
 * THE DIAGNOSIS. Pure: facts in, an ordered list of findings out.
 *
 * A finding is `{ code, severity, title, count, what, why, fix, fixLabel,
 * items }`. `severity` is one of 'problem' | 'warn' | 'info' and only colours
 * the row; the ORDER of the list is what says which to do first, and it is
 * dependency order (see the section comment).
 */
function buildDoctorFindings(facts) {
  const findings = [];
  const link = (facts && facts.linkStats) || {};
  const rec = (facts && facts.recovery) || { trashed: [], strayed: [], gone: [], ok: [] };
  const drift = (facts && facts.drift) || null;
  const names = list => (list || []).slice(0, 6).map(r => r.describe || r.title || '');

  if (link.misaligned > 0) {
    findings.push({
      code: 'shiftedRows', severity: 'problem', count: link.misaligned,
      title: 'Rows whose identity columns have shifted',
      what: `${link.misaligned} session row(s) carry an Event_ID that does not match the date, title and ` +
        `calendar written beside it.`,
      why: 'Nothing below this line can be trusted on those rows: a repair that took its form from a title ' +
        'belonging to a different session would turn a visible problem into an invisible one, so every ' +
        'later step skips them. They have to be rebuilt from the calendar, which "Sync Cal only" does.',
      fix: '', fixLabel: 'Run "Sync Cal only" from the menu', items: []
    });
  }

  if (rec.trashed.length > 0) {
    findings.push({
      code: 'trashedForms', severity: 'problem', count: rec.trashed.length,
      title: 'Forms sitting in the Drive trash',
      what: `${rec.trashed.length} form(s) this workbook depends on are in the trash.`,
      why: 'Every link to them — on the dashboard, in the calendar, in an email you sent, on a printed ' +
        'flyer — says "File not found" to whoever clicks it. Taking them back out restores the form, its ' +
        'ID, its link and every response already collected, so nothing that was handed out breaks. Do this ' +
        'BEFORE repairing links, or the repair points rows at a form that is still in the trash.',
      fix: DOCTOR_FIXES.RESTORE, fixLabel: `Restore ${rec.trashed.length} form(s)`, items: names(rec.trashed)
    });
  }

  if (rec.gone.length > 0) {
    findings.push({
      code: 'lostForms', severity: 'problem', count: rec.gone.length,
      title: 'Forms Drive cannot produce at all',
      what: `${rec.gone.length} form(s) cannot be opened: the trash was emptied, or they belong to an ` +
        `account this one cannot reach.`,
      why: 'If it is the second, "🔓 Open Up Form Sharing" — run signed in as whoever created them — is the ' +
        'fix, and it costs nothing to try first. Building replacements is the last resort: a replacement is ' +
        'a NEW form with a NEW link, so anything already handed out for these stays dead either way, and ' +
        'only the ones with dates still to come are worth replacing.',
      fix: DOCTOR_FIXES.REBUILD, fixLabel: `Build replacements for ${rec.gone.length} form(s)`,
      confirm: 'A replacement is a new form with a new link. Registrations already imported are safe; ' +
        'anything a lost form collected but never handed over cannot be recovered. Continue?',
      items: names(rec.gone)
    });
  }

  const linkFindings = [
    ['wrongForm', 'problem', 'Rows pointing at the wrong form',
      'Both links on those rows open a form that belongs to a different session or a different month.'],
    ['staleLiveLink', 'problem', '"View Live Form" links that go to the wrong form',
      'The row names the right form and its "Edit Form Settings" opens it — but "View Live Form" leads ' +
      'somewhere else. A form\'s public address is a separate identifier from its file ID, so this is ' +
      'invisible from the Form_ID column, and it is the link RESIDENTS use. Everyone signing up from the ' +
      'dashboard has been landing on the wrong sign-up page.'],
    ['staleEditLink', 'warn', '"Edit Form Settings" links that go to the wrong form',
      'The mirror image of the one above, and much rarer: staff opening the form to change it are editing ' +
      'somebody else\'s.'],
    ['missingLink', 'warn', 'Rows with a form but no link',
      'Left deliberately when a sync could not open the form to read its address. Filling them in is safe ' +
      'and is what this repair is for.']
  ];
  linkFindings.forEach(([code, severity, title, why]) => {
    if (!link[code]) return;
    findings.push({
      code, severity, count: link[code], title,
      what: `${link[code]} session row(s).`, why,
      fix: DOCTOR_FIXES.LINKS,
      fixLabel: `Rewrite ${link.willFix} link(s) from the forms themselves`, items: []
    });
  });

  if (drift && drift.stats.disagrees > 0) {
    const byProgram = {};
    drift.drift.forEach(d => {
      const key = `${d.title} (${d.location})`;
      byProgram[key] = (byProgram[key] || 0) + 1;
    });
    const programs = Object.keys(byProgram).sort();
    findings.push({
      code: 'calendarDisagrees', severity: 'problem', count: drift.stats.disagrees,
      title: 'Calendar events naming a different form from the dashboard',
      what: `${drift.stats.disagrees} upcoming event(s) across ${programs.length} program(s).`,
      why: 'Residents reading the calendar and staff reading the dashboard are being sent to two different ' +
        'sign-up pages, and the registrations are splitting between them. The fix copies the DASHBOARD onto ' +
        'every event, so run it last — after the steps above have made the dashboard right.',
      fix: DOCTOR_FIXES.EVENTS, fixLabel: `Rewrite ${drift.stats.disagrees} event description(s)`,
      items: programs.slice(0, 6).map(p => `${p} — ${byProgram[p]} date(s)`)
    });
  }

  if (rec.strayed.length > 0) {
    findings.push({
      code: 'strayedForms', severity: 'info', count: rec.strayed.length,
      title: 'Forms that have wandered out of the folder',
      what: `${rec.strayed.length} form(s) are alive and their links work — they are just not in ` +
        `"${FORMS_FOLDER_NAME}" any more.`,
      why: 'Tidiness, not damage. Worth doing because the folder is how anybody finds these by hand.',
      fix: DOCTOR_FIXES.REFILE, fixLabel: `File ${rec.strayed.length} form(s) back`, items: names(rec.strayed)
    });
  }

  if (link.noForm > 0) {
    findings.push({
      code: 'noFormOnRegistry', severity: 'warn', count: link.noForm,
      title: 'Rows with no form to point at',
      what: `${link.noForm} row(s) have no entry in the form registry naming their form.`,
      why: 'Usually a program whose form was never built — "Sync Cal only" builds it and writes the link. ' +
        'Nothing here can invent one.',
      fix: '', fixLabel: 'Run "Sync Cal only" from the menu', items: []
    });
  }

  if (facts && facts.duplicates && facts.duplicates.length > 0) {
    findings.push({
      code: 'duplicateForms', severity: 'info', count: facts.duplicates.length,
      title: 'Two or more forms with the same name',
      what: `${facts.duplicates.length} name(s) in the folder belong to more than one form, and the ` +
        `workbook is using one of each.`,
      why: 'Left over from a sync that used to build a replacement whenever it could not open a form. ' +
        'Nothing here deletes one: which twin holds the registrations is not a question this can answer, ' +
        'and deleting the wrong one cannot be undone. Open both, see which has responses, and move the ' +
        'sessions onto it with "Move Sessions to Another Form…" if it is not the one in use.',
      fix: '', fixLabel: '', items: facts.duplicates.slice(0, 6).map(d => `${d.title} — ${d.formIds.length} forms`)
    });
  }

  return findings;
}

/** The whole diagnosis, in the shape the dialog renders. */
function runFormLinkDoctorScan(options) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return { ok: false, message: 'No program dashboard yet — nothing to check.', findings: [] };

  const facts = gatherFormLinkFacts(registrySheet, options);
  const findings = buildDoctorFindings(facts);
  const rec = facts.recovery;
  const checked = {
    rows: facts.linkStats ? facts.linkStats.scanned : 0,
    forms: rec ? (rec.ok.length + rec.trashed.length + rec.strayed.length + rec.gone.length) : 0,
    events: facts.drift ? facts.drift.stats.scanned : 0,
    // WHAT WAS NOT LOOKED AT, carried to the page so a partial pass can never
    // be drawn as a clean bill of health. "Nothing wrong" about a stage that
    // never ran is the one thing this dialog must not say.
    calendarSkipped: facts.skipped.indexOf('calendar') !== -1,
    driveSkipped: facts.skipped.indexOf('drive') !== -1,
    linksSkipped: facts.skipped.indexOf('links') !== -1
  };
  log(`Form & Link Doctor: ${checked.rows} row(s), ${checked.forms} form(s), ${checked.events} event(s) — ` +
    `${findings.length} finding(s): ${findings.map(f => `${f.code}×${f.count}`).join(', ') || 'none'}.`);
  return { ok: true, findings, checked };
}

/**
 * Applies one finding's fix and hands back a FRESH diagnosis, so the screen
 * can never show a list that a fix has just made untrue.
 *
 * Every fix here is one the menu already offered; what is new is that the
 * Doctor is the confirmation, so these call the appliers directly rather than
 * the versions that put up their own dialog.
 */
function applyFormLinkDoctorFix(code, options) {
  if (!requireAuthorizedAdmin('Form & Link Doctor')) {
    return { ok: false, message: 'Not an admin account.', findings: [] };
  }
  // AT THE DEPTH THE PAGE IS SHOWING. The re-read used to be the full sweep
  // whatever the person was looking at, so a fix applied from the quick pass
  // paid the Drive and calendar cost on the way back — and a re-read that runs
  // out of time after the WRITE has landed reports a failure for a repair that
  // actually worked.
  const depth = options || { skipDrive: true, skipCalendar: true };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return { ok: false, message: 'No program dashboard yet.', findings: [] };
  if (isBootstrapActive()) return { ok: false, message: bootstrapBusyMessage(), findings: [] };

  let message = '';
  try {
    message = runOneDoctorFix(registrySheet, code);
  } catch (err) {
    log(`⚠️ Form & Link Doctor: "${code}" failed (${err}).`);
    const failed = runFormLinkDoctorScan({ skipCalendar: true, skipDrive: true });
    return { ok: false, message: `That fix failed: ${err}`, findings: failed.findings || [] };
  }
  flushAdminDigest('Form & Link Doctor');
  log(`Form & Link Doctor: ${code} — ${message}`);
  const rescan = runFormLinkDoctorScan(depth);
  return { ok: true, message, findings: rescan.findings || [], checked: rescan.checked };
}

/** The dispatch itself. Returns the sentence the dialog shows. */
function runOneDoctorFix(registrySheet, code) {
  if (code === DOCTOR_FIXES.LINKS) {
    const { plan } = planDashboardLinkRepair(registrySheet);
    if (plan.length === 0) return 'Every link already matched — nothing was written.';
    return `Rewrote ${applyDashboardLinkPlan(registrySheet, plan)} link(s) on the dashboard.`;
  }

  if (code === DOCTOR_FIXES.RESTORE || code === DOCTOR_FIXES.REFILE || code === DOCTOR_FIXES.REBUILD) {
    const headers = HEADERS.All_Program_Sessions;
    const map = getIndexMap(headers);
    const refs = collectFormsWorkbookDependsOn(
      getSectionedRows(registrySheet, headers, 'Event_ID'), map,
      getPersistentFormRegistry(), getLunchOnlyFormLinks());
    let folder = null;
    let folderId = '';
    try {
      folder = getOrCreateFormsFolder();
      folderId = folder.getId();
    } catch (err) {
      log(`ℹ️ Doctor: the forms folder could not be opened (${err}).`);
    }
    const buckets = planFormRecovery(refs, formId => probeFormFile(formId, folderId));

    if (code === DOCTOR_FIXES.RESTORE) {
      const out = restoreTrashedFormsNow(buckets.trashed, folder);
      return `Restored ${out.restored} form(s) from the trash` +
        (out.failed > 0 ? `, ${out.failed} refused this account — see the log.` : '.');
    }
    if (code === DOCTOR_FIXES.REFILE) {
      return `Filed ${refileStrayedFormsNow(buckets.strayed, folder)} form(s) back into "${FORMS_FOLDER_NAME}".`;
    }

    const lost = {};
    buckets.gone.forEach(ref => { lost[ref.formId] = true; });
    const plan = planFormRebuilds(getSectionedRows(registrySheet, headers, 'Event_ID'), map)
      .filter(item => Object.prototype.hasOwnProperty.call(lost, item.oldFormId));
    if (plan.length === 0) {
      return 'None of the lost forms has a session still to come, so there was nothing to rebuild.';
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) return 'A sync is running — try the rebuild again in a moment.';
    try {
      const result = plan.length > FORM_REBUILD_SLICE_THRESHOLD
        ? startFormRebuildSweep(plan)
        : runFormRebuildSweep(registrySheet, plan);
      return `Rebuilt ${(result && result.replaced) || 0} form(s); the dashboard and the calendar now carry ` +
        `their new links.`;
    } finally {
      lock.releaseLock();
    }
  }

  if (code === DOCTOR_FIXES.EVENTS) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) return 'A sync is running — try this again in a moment.';
    try {
      const stats = rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
      return `Rewrote ${stats.rewritten} event description(s) from the dashboard.`;
    } finally {
      lock.releaseLock();
    }
  }

  throw new Error(`Unknown fix "${code}".`);
}

/**
 * ADMIN ACTION — "🩺 Form & Link Doctor…".
 *
 * THE DIALOG OPENS BEFORE ANYTHING IS CHECKED, and that is the whole of this
 * function. It used to run the entire diagnosis first and hand the result to
 * buildFormLinkDoctorHtml() — which meant the menu item probed every form in
 * Drive, listed the forms folder and read every calendar in the sync window
 * BEFORE the dialog was created. On a small workbook that was a slow menu
 * item. On a real one it was several hundred round trips, and Apps Script
 * stops an execution at its ceiling with no warning and no exception: the
 * dialog was never created, so nothing appeared, and nothing said why. The
 * symptom is a menu item that does nothing at all.
 *
 * So the scan moved to where every other slow thing in this project already
 * lives — behind google.script.run, on a page that is already on screen and
 * can say "Checking…". The page asks for the QUICK pass first (the sheet and
 * the link plan, which is what people open this for), and asks for Drive and
 * the calendars only if somebody presses for them. See doctorScanQuick().
 */
function showFormLinkDoctorDialog() {
  if (!requireAuthorizedAdmin('Form & Link Doctor')) return;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  // The one thing worth failing here for: there is no tab to diagnose, and a
  // dialog that opens only to say so is worse than a toast.
  const registrySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first, then try the Doctor.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildFormLinkDoctorHtml(null))
    .setWidth(720)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Form & Link Doctor');
}

function buildFormLinkDoctorHtml(scan) {
  // Same guard as every other dialog that carries its data inline: a program
  // called "Films </script>" would otherwise end the script block mid-sentence.
  const inlineJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 0;
         display: flex; flex-direction: column; height: 100vh; }
  header, footer { padding: 10px 14px; background: #F8F9FA; border-bottom: 1px solid #DADCE0; flex: 0 0 auto; }
  footer { border-bottom: 0; border-top: 1px solid #DADCE0; }
  main { flex: 1 1 auto; overflow-y: auto; padding: 14px; }
  h3 { margin: 0; font-size: 17px; }
  .sub { color: #5F6368; margin-top: 3px; }
  .card { border: 1px solid #DADCE0; border-radius: 6px; padding: 11px 13px; margin-bottom: 12px; }
  .card.problem { border-left: 4px solid #C5221F; }
  .card.warn    { border-left: 4px solid #F29900; }
  .card.info    { border-left: 4px solid #9AA0A6; }
  .card h4 { margin: 0 0 5px 0; font-size: 14px; }
  .step { display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center;
          border-radius: 50%; background: #E8EAED; color: #3C4043; font-size: 11px; margin-right: 7px; }
  .what { margin: 0 0 6px 0; }
  .why { color: #5F6368; line-height: 1.5; margin: 0; }
  .items { color: #5F6368; font-size: 12px; line-height: 1.6; margin: 8px 0 0 0; padding-left: 18px; }
  .actions { margin-top: 10px; }
  .allgood { text-align: center; padding: 40px 20px; color: #188038; font-size: 15px; line-height: 1.7; }
  button { border: 0; border-radius: 4px; padding: 7px 14px; font-size: 13px; cursor: pointer;
           background: #1155CC; color: #fff; }
  button.ghost { background: #fff; color: #1155CC; border: 1px solid #C6D4F0; }
  button[disabled] { background: #9AA0A6; color: #fff; border-color: #9AA0A6; cursor: default; }
  .manual { color: #B06000; font-size: 12px; }
  #status { margin-top: 6px; line-height: 1.5; white-space: pre-wrap; font-size: 12px; }
  .ok-text { color: #188038; } .err-text { color: #C5221F; }
</style>
<header>
  <h3>🩺 Form &amp; Link Doctor</h3>
  <div class="sub" id="checked"></div>
</header>
<main id="list"></main>
<footer>
  <button class="ghost" id="rescan" onclick="scan(false)">Check again</button>
  <button class="ghost" id="deep" onclick="scan(true)">Also check Drive &amp; calendars</button>
  <button class="ghost" onclick="google.script.host.close()">Close</button>
  <div id="status"></div>
</footer>
<script>
  // NULL UNTIL THE FIRST ANSWER COMES BACK. The page is drawn and on screen
  // before anything is checked — see showFormLinkDoctorDialog().
  var SCAN = ${inlineJson(scan)};
  var DEEP = false;
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg || '';
    el.className = cls || '';
  }
  function setBusy(on) {
    busy = on;
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on;
  }

  function draw() {
    var main = document.getElementById('list');
    if (!SCAN) {
      document.getElementById('checked').textContent = 'Checking the session table and its links\u2026';
      main.innerHTML = '<div class="allgood">\u23f3 Checking\u2026<br>Reading the session table and opening ' +
        'each form once to read its address.</div>';
      return;
    }

    var checked = SCAN.checked || {};
    // SAY WHAT WAS LOOKED AT, never more. A quick pass that reported "3 forms"
    // because it never opened Drive would be the dialog lying about its own
    // depth, which is the failure that hides a trashed form.
    var parts = [(checked.rows || 0) + ' session row(s)'];
    parts.push(checked.driveSkipped ? 'forms in Drive not checked' : (checked.forms || 0) + ' form(s)');
    parts.push(checked.calendarSkipped ? 'calendars not read' : (checked.events || 0) + ' upcoming event(s)');
    document.getElementById('checked').textContent = parts.join(', ') + '.';
    document.getElementById('deep').style.display =
      (checked.driveSkipped || checked.calendarSkipped) ? '' : 'none';

    var findings = SCAN.findings || [];
    main.innerHTML = '';
    if (findings.length === 0) {
      var clean = ['\u2705 Nothing wrong in what was checked.'];
      clean.push(checked.linksSkipped
        ? 'The links could not be read this time \u2014 see the log.'
        : 'Every session row names a form, and both its links open that form.');
      if (checked.driveSkipped || checked.calendarSkipped) {
        clean.push('<span class="manual">Not checked yet: ' +
          (checked.driveSkipped ? 'whether those forms still exist in Drive' : '') +
          (checked.driveSkipped && checked.calendarSkipped ? ', and ' : '') +
          (checked.calendarSkipped ? 'whether the calendar events agree' : '') +
          '. Press \u201cAlso check Drive &amp; calendars\u201d.</span>');
      }
      main.innerHTML = '<div class="allgood">' + clean.join('<br>') + '</div>';
      return;
    }
    for (var i = 0; i < findings.length; i++) {
      main.appendChild(card(findings[i], i + 1));
    }
  }

  function card(f, step) {
    var div = document.createElement('div');
    div.className = 'card ' + f.severity;
    var html = '<h4><span class="step">' + step + '</span>' + esc(f.title) + '</h4>' +
      '<p class="what">' + esc(f.what) + '</p>' +
      '<p class="why">' + esc(f.why) + '</p>';
    if (f.items && f.items.length) {
      html += '<ul class="items">';
      for (var i = 0; i < f.items.length; i++) html += '<li>' + esc(f.items[i]) + '</li>';
      if (f.count > f.items.length) html += '<li>…and ' + (f.count - f.items.length) + ' more</li>';
      html += '</ul>';
    }
    html += '<div class="actions"></div>';
    div.innerHTML = html;
    var actions = div.querySelector('.actions');
    if (f.fix) {
      var button = document.createElement('button');
      button.textContent = f.fixLabel;
      button.onclick = function () { apply(f); };
      actions.appendChild(button);
    } else if (f.fixLabel) {
      actions.innerHTML = '<span class="manual">↳ ' + esc(f.fixLabel) + '</span>';
    }
    return div;
  }

  function apply(f) {
    if (busy) return;
    if (f.confirm && !window.confirm(f.confirm)) return;
    setBusy(true);
    say('Working — this can take a minute…');
    google.script.run
      .withSuccessHandler(function (raw) {
        setBusy(false);
        var out = JSON.parse(raw);
        SCAN = { findings: out.findings, checked: out.checked || SCAN.checked };
        say(out.message || '', out.ok === false ? 'err-text' : 'ok-text');
        draw();
      })
      .withFailureHandler(function (err) {
        setBusy(false);
        say('Failed: ' + err.message, 'err-text');
      })
      .doctorApplyFix(f.fix, DEEP);
  }

  // ONE ENTRY POINT, TWO DEPTHS. The quick pass reads the sheet and opens each
  // distinct form once to read its address; the deep one adds a Drive probe per
  // form, the folder listing and every calendar in the window. The quick one is
  // what runs on open, because it is the one that answers "is the Form_ID
  // column pointing at the form the link opens?" — and because a dialog has to
  // show something before it can afford to be slow.
  function scan(deep) {
    if (busy) return;
    DEEP = !!deep;
    setBusy(true);
    say(DEEP ? 'Checking Drive and the calendars \u2014 this can take a few minutes\u2026' : 'Checking\u2026');
    google.script.run
      .withSuccessHandler(function (raw) {
        setBusy(false);
        SCAN = JSON.parse(raw);
        say('');
        draw();
      })
      .withFailureHandler(function (err) {
        setBusy(false);
        // A DEEP PASS THAT DIED STILL LEAVES THE QUICK ONE ON SCREEN, which is
        // the reason the two are separate calls rather than one with a flag.
        say(DEEP
          ? 'Drive and the calendars could not be checked (' + err.message + '). What is above was still ' +
            'checked and is still true.'
          : 'Failed: ' + err.message, 'err-text');
        DEEP = false;
        draw();
      })
      [DEEP ? 'doctorScanFull' : 'doctorScanQuick']();
  }

  draw();
  scan(false);
</script>`;
}

/** Dialog entry points. Stringified because google.script.run will not carry a Set or a Date. */
function doctorApplyFix(code, deep) {
  return JSON.stringify(applyFormLinkDoctorFix(code, doctorScanDepth(!!deep)));
}

/**
 * The two depths, as one place rather than a literal at each call site.
 *
 * The QUICK one is the sheet and the link plan: one read of the session table,
 * and one form opened per distinct Form_ID to read its published and edit
 * addresses. That is what decides every `wrongForm` / `staleLiveLink` finding
 * — which is what somebody opening this dialog is nearly always here for.
 *
 * The DEEP one adds the two stages that cost round trips in proportion to the
 * whole workbook rather than to the problem: a Drive probe for every form, the
 * forms folder listed in full, and every calendar in the sync window read and
 * its descriptions compared. Those answer real questions (is a form in the
 * trash? does the calendar still name the right link?) and they are worth
 * waiting for — but only once somebody has asked to wait.
 */
function doctorScanDepth(deep) {
  return deep ? {} : { skipDrive: true, skipCalendar: true };
}

function doctorScanQuick() {
  return JSON.stringify(runFormLinkDoctorScan(doctorScanDepth(false)));
}

function doctorScanFull() {
  return JSON.stringify(runFormLinkDoctorScan(doctorScanDepth(true)));
}

/** Kept: the name the dialog used before the scan was split in two. */
function doctorRescan() {
  return doctorScanFull();
}

