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
    apply: (form, context) => repairFormPageRouting(form, context)
  }
];

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

  const result = { opened: 0, repaired: 0, unrecognized: 0, deferred: 0 };
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return result;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  const versions = getFormTemplateVersions();

  Object.keys(byForm).forEach(formId => {
    if (only && !only.has(formId)) return;
    const pending = FORM_STATE_MIGRATIONS.filter(m => force || !hasFormStateMigrationRun(formId, m.id));
    if (pending.length === 0) return; // the steady state — no API call at all
    if (result.opened >= limit || (deadline && Date.now() >= deadline)) { result.deferred++; return; }

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

    const formContext = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
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
    log(`Form repairs: ${result.repaired} form(s) fixed in place, no rebuild needed.`);
  }
  if (result.deferred > 0) {
    log(`${result.deferred} more form(s) still to check — they'll be picked up on the next run.`);
  }
  flushFormStateMigrationLedger();
  flushPersistentRegistries();
  return result;
}

/**
 * ADMIN → "Fix Form Page Routing (no rebuild)". Runs every registered
 * migration over every form, ledger ignored, and says what it did.
 *
 * The un-destructive sibling of "Rebuild Forms In Place": no question is
 * replaced, no pre-checked box is regenerated, no link moves — the only writes
 * are the navigation settings that are actually wrong. Someone who has just
 * pulled a fix and does not want to wait an hour for the sync runs this.
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

  toastIfPossible('Checking every form’s page routing…');
  // Most of the six minutes, less the room this needs to report.
  const deadline = Date.now() + 4.5 * 60 * 1000;
  let result;
  try {
    result = runFormStateMigrations(registrySheet, null, { force: true, limit: 500, deadline: deadline });
  } catch (err) {
    ui.alert(`The routing check could not finish: ${err}\n\nNothing is half-written — every form it did ` +
      `reach is fixed, and running this again picks up where it stopped.`);
    return;
  }

  const lines = [
    `Forms opened: ${result.opened}`,
    `Fixed in place: ${result.repaired}`
  ];
  if (result.unrecognized > 0) {
    lines.push(`Left alone: ${result.unrecognized} — these are not on a shape this repair describes. ` +
      `Admin → Rebuild Forms In Place will bring them up to date the long way.`);
  }
  if (result.deferred > 0) {
    lines.push(`Not reached this run: ${result.deferred} — run this again to continue.`);
  }
  if (result.opened > 0 && result.repaired === 0 && result.unrecognized === 0) {
    lines.push('', 'Every form was already routing correctly. Nothing was written, so no form gained a ' +
      'revision in its history.');
  } else if (result.repaired > 0) {
    lines.push('', 'Links are unchanged, questions are unchanged, and answers already collected are ' +
      'untouched — only where each page sends people has moved.');
  }
  ui.alert('Form page routing', lines.join('\n'), ui.ButtonSet.OK);
}
