/**
 * THE ONE PASS THAT VISITS EVERY LIVE FORM ON EVERY SYNC, and the answer to
 * "why did the form show the dish beside the date and never ask about lunch?"
 *
 * WHAT IT USED TO BE. This was refreshFormCapacityLabelsForAllForms(): it
 * re-stamped roster-grid ROW LABELS with CAPACITY_HINT_SUFFIX wherever a
 * capped session had hit 0 Remaining_Seats, skipped any form with no capped
 * session at all, and touched nothing but labels.
 *
 * WHY THAT WAS NOT ENOUGH. A form's date labels carry the day's menu
 * (formatDateLabelWithMeal()) and its QUESTIONS carry whether lunch is asked
 * about at all — and the two were refreshed by different things. The questions
 * were only ever re-checked by a path with a reason of its own to open the
 * form: a menu PUSH (refreshFormsForLunchDates()), or a group with a NEW date,
 * which collectCalendarWork() skips for every program whose dates are already
 * on the sheet. Type a menu row straight onto Lunch_Schedule for a month a
 * form already covers and neither happens — but this pass, running for its
 * capacity hints, cheerfully wrote "(Lunch: Chicken Parmesan)" onto the date
 * rows of a form carrying no lunch question anywhere. The respondent is shown
 * the meal and given no way to ask for one.
 *
 * WHAT IT IS NOW. The same fingerprinted pass over EVERY form — the
 * capped-only shortcut is gone, since a form's lunch shape can change with
 * nothing on it capped — and the fingerprint now covers the lunch SHAPE as
 * well as the labels (see formLunchShapeKey()). When either has moved, the
 * form goes to refreshOneFormDateLabels(), which is already the function that
 * re-checks the questions, rewrites the description and writes the rows in one
 * open. When neither has, it costs one hash compare and no FormApp call at
 * all, exactly as before.
 *
 * Call AFTER recomputeEventRegistryCounts(), so Remaining_Seats — and with it
 * the capacity hints this still exists to write — is fresh.
 */
function refreshFormShapeForAllForms(registrySheet) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  const fingerprints = getFormLabelFingerprints();
  let opened = 0;
  let deferred = 0;

  Object.keys(byForm).forEach(formId => {
    const formRows = byForm[formId];
    const formContext = buildFormSessionContext(formId, formRows, map, sharedFormIds);
    if (formContext.sessions.length === 0) return;
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(formContext.sessions, formContext);
    const shape = formLunchShapeKey(formContext, lunchDateLabels.length > 0);
    // The same hash refreshOneFormDateLabels() will store if it writes, so a
    // form that is already right is not opened at all.
    if (fingerprints[formId] === computeFormLabelFingerprint(allDateLabels, lunchDateLabels, shape)) return;
    if (opened >= FORM_SHAPE_CHECK_MAX_FORMS_PER_RUN) { deferred++; return; }
    opened++;
    refreshOneFormDateLabels(formId, formRows, map, 'form check');
  });
  if (opened > 0) {
    log(`Hourly form check: ${opened} form(s) had labels or a lunch shape to bring up to date` +
      (deferred > 0 ? `, and ${deferred} more left for the next run (this run's limit is ` +
        `${FORM_SHAPE_CHECK_MAX_FORMS_PER_RUN} forms).` : '.'));
  }
  flushPersistentRegistries();
}

/** Former name of the pass above, kept so any existing trigger or hand-run call still reaches it. */
function refreshFormCapacityLabelsForAllForms(registrySheet) {
  return refreshFormShapeForAllForms(registrySheet);
}

/** { Form_ID: [session rows] } from a batch of Master_Program_Dashboard rows. Rows with no form are skipped. */
function groupRegistryRowsByForm(rows, map) {
  const byForm = {};
  rows.forEach(row => {
    // TRIMMED, like every other reader of this column. Both sides of this map
    // used to be raw cell values, so nothing mismatched — but the key then
    // travelled to FormApp.openById(), which would refuse a perfectly good
    // form over a trailing space somebody never typed on purpose.
    const formId = String(row[map['Form_ID']] || '').trim();
    if (!formId) return;
    if (!byForm[formId]) byForm[formId] = [];
    byForm[formId].push(row);
  });
  return byForm;
}

/**
 * Is this live form built on the CURRENT template? Structural, not a
 * version stamp — it has to be able to judge a form first seen long before
 * stamps existed.
 *
 * A form is out of date when it still carries the v1/v2 guest-count question
 * (and, behind it, that template's per-count branch pages), when any question
 * the current template introduced is missing, when the old floating footer
 * header is still on it, or when it has more page breaks than the current
 * template builds. Any of those means a respondent is meeting a form this
 * code no longer knows how to read.
 */
function isFormOnCurrentTemplate(form) {
  const items = form.getItems();
  const titles = items.map(it => it.getTitle());
  if (titles.indexOf(LEGACY_GUEST_COUNT_TITLE) !== -1) return false;
  if (titles.indexOf(LEGACY_FOOTER_ITEM_TITLE) !== -1) return false;
  // THE PRE-v9 LUNCH QUESTIONS ARE PROOF OF AN OLD FORM, and they have to be
  // judged here rather than by the `required` list below: the v9 questions are
  // legitimately ABSENT from a form with nothing to serve, so "does it have
  // the new ones?" would mark every no-lunch form stale forever. Their
  // presence, on the other hand, is unambiguous — nothing writes them any more
  // (see TEMPLATE_VERSION's v9 note), so a form carrying one was built before
  // the change and is asking for meals in people rather than in numbers.
  const preV9 = [TEMPLATE_ITEM_TITLES.LUNCH_GRID, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE,
    TEMPLATE_ITEM_TITLES.EXTRA_MEALS, LEGACY_LUNCH_ONLY_GRID_TITLE];
  if (preV9.some(title => titles.indexOf(title) !== -1)) return false;
  // AN APPOINTMENT FORM IS A CURRENT FORM. syncAssistanceQuestionsOnForm()
  // deliberately removes the mode question and both roster grids and puts the
  // time question in their place, so judging it by the date-based checklist
  // would mark it stale on every single sync — and the rebuild that followed
  // would put the grids back, only for the next sync to strip them again.
  // Carrying the time question is the positive statement that this shape is
  // intended. Everything a rebuild WOULD have fixed is re-applied by
  // applyProgramFormExtensions() anyway.
  const isAppointmentForm = titles.indexOf(TEMPLATE_ITEM_TITLES.APPOINTMENT) !== -1;
  const required = isAppointmentForm ? [
    TEMPLATE_ITEM_TITLES.NAME,
    TEMPLATE_ITEM_TITLES.PHONE,
    TEMPLATE_ITEM_TITLES.GUEST_COUNT
  ] : [
    TEMPLATE_ITEM_TITLES.NAME,
    TEMPLATE_ITEM_TITLES.PHONE,
    TEMPLATE_ITEM_TITLES.GUEST_COUNT,
    TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE,
    TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID
  ];
  if (required.some(title => titles.indexOf(title) === -1)) return false;
  const pageBreaks = items.filter(it => it.getType() === FormApp.ItemType.PAGE_BREAK).length;
  return pageBreaks <= Object.keys(TEMPLATE_PAGE_TITLES).length;
}

/**
 * Rewrites a live form's questions to the current template IN PLACE, keeping
 * its Form ID.
 *
 * Keeping the ID is the whole point: every calendar description, dashboard
 * link, registry entry, all-dates registrant record and label fingerprint in
 * the system is keyed by it, and none of them have to be chased down. The
 * cost is that responses already collected against the OLD questions lose
 * their per-question answers when those questions are deleted — which is why
 * this runs from syncRegistrations() only AFTER that run has imported
 * everything new. Rows already on Registrant_Dash are the record
 * of those registrations and are untouched.
 */
function rebuildFormFromCurrentTemplate(form, context) {
  clearFormNavigation(form);
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
  addTemplateItemsToForm(form);

  const { allDateLabels, lunchDateLabels, allDateLines } = buildDateLabelSets(context.sessions, context);
  form.setDescription(buildFormDescription(context.locations, allDateLabels, context.isFixed, lunchDateLabels.length > 0,
    { isClub: context.isClub, programTitle: context.programTitle, isLunchOnly: context.isLunchOnly,
      isAssistance: context.isAssistance, dateLines: allDateLines }));

  // THE DATE LABELS ARE THE ONE STEP THAT CANNOT BE SKIPPED. A rebuilt form's
  // grids hold the template's placeholder row until they are written, so a
  // form that gets here and then fails is a form nobody can register on —
  // strictly worse than the out-of-date one it replaced. The two steps before
  // it are therefore allowed to fail on their own: wrong sign-up wording or a
  // missing footer is a blemish, and reporting it beats abandoning the rebuild.
  // (This is not hypothetical — a title collision made applyAttendanceModeChoices
  // throw here, and every form it touched was left showing
  // "(dates will be filled in automatically)".)
  try {
    applyAttendanceModeChoices(form,
      { isFixed: context.isFixed, isClub: context.isClub, programTitle: context.programTitle,
        isLunchOnly: context.isLunchOnly, isAssistance: context.isAssistance });
  } catch (err) {
    log(`⚠️ Rebuilt form ${form.getId()} but could not set its sign-up options (${err}) — ` +
      `it carries the template's default wording.`);
    noteForAdmin('Forms rebuilt with default sign-up wording',
      `${form.getId()} (${describeLocations(context.locations)}) — its options could not be customized: ${err}`);
  }
  syncLunchQuestionsOnForm(form, context.locations, lunchDateLabels.length > 0, context);
  // force: a rebuilt form's grids are back to the template placeholder row,
  // and its fingerprint on file still describes the labels it had before.
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels, { form, force: true,
    context: 'template migration', shape: formLunchShapeKey(context, lunchDateLabels.length > 0) });
  try {
    applyFormFooterNote(form, buildFooterNoteForLocations(context.locations));
  } catch (err) {
    log(`ℹ️ Rebuilt form ${form.getId()} but could not attach its footer note (${err}).`);
  }
  // A REBUILD DELETED EVERY ITEM ON THIS FORM, including the questions this
  // system added from Program_Questions — which is exactly the failure that
  // made hand-editing a live form pointless. Forget what we think is on it,
  // then put it all back: the appointment shape if its sessions call for one,
  // and the program's own questions.
  forgetAppliedCustomQuestions(form.getId());
  applyProgramFormExtensions(form, context, { force: true });
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);
}

/** Ceiling on how many out-of-date forms one execution will rebuild — see migrateFormsToCurrentTemplate(). */
const MAX_FORM_REBUILDS_PER_RUN = 5;

/**
 * Cuts every "go to section" link on a form: choice-level page navigation on
 * list/multiple-choice items, and page-level navigation on the page breaks
 * themselves.
 *
 * This is what a rebuild has to do FIRST. Deleting a page break that another
 * item's choice still points at leaves the form describing a jump to a
 * section that no longer exists, and Forms rejects the whole update with a
 * flat "Invalid data updating form" — which is exactly how a migration fails
 * on the old eight-section template, where seven choices point at branch
 * pages. Neutralize the links, and the items delete cleanly.
 */
function clearFormNavigation(form) {
  form.getItems().forEach(item => {
    try {
      const type = item.getType();
      if (type === FormApp.ItemType.PAGE_BREAK) {
        item.asPageBreakItem().setGoToPage(FormApp.PageNavigationType.CONTINUE);
        return;
      }
      if (type !== FormApp.ItemType.LIST && type !== FormApp.ItemType.MULTIPLE_CHOICE) return;
      const typed = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
      const values = typed.getChoices().map(c => c.getValue()).filter(v => v !== '' && v !== null && v !== undefined);
      if (values.length > 0) typed.setChoiceValues(values); // plain choices — no navigation attached
    } catch (err) {
      log(`ℹ️ Could not clear navigation on "${item.getTitle()}" of form ${form.getId()} (${err}) — continuing.`);
    }
  });
}

/**
 * Brings every live registration form up to the current template.
 *
 * This is the missing half of a TEMPLATE_VERSION bump. Bumping it rebuilds
 * the cached template, so forms created AFTERWARDS are correct — but a
 * group's form is created once and then reused for as long as the group
 * runs (see refreshFormForNewDates()), so the forms people are actually
 * filling in stayed on whatever template they were born with. A respondent
 * on a v1/v2 form still met the guest-count question and its branch pages,
 * and still got mis-routed by them; the fix shipped in the template never
 * reached them.
 *
 * Cheap by design: a form whose stamp already reads TEMPLATE_VERSION is
 * skipped without any API call, so the steady state costs one Script
 * Properties read. Only unstamped or stale forms are opened, and no more
 * than MAX_FORM_REBUILDS_PER_RUN are rebuilt in any one execution — a
 * rebuild is a few dozen Forms calls, and the hourly sync it rides on has a
 * six-minute ceiling. Whatever is left over is picked up next run, so a
 * backlog drains itself.
 *
 * Call AFTER responses have been imported — see rebuildFormFromCurrentTemplate().
 * Returns the number of forms rebuilt.
 *
 * OPTIONS, all for rebuildAllFormsInPlace() — the hourly sync passes none and
 * gets exactly the behaviour described above:
 *   • onlyFormIds — a Set limiting the sweep to these forms.
 *   • force       — rebuild even a form that looks current. The two skips this
 *                   turns off (the version stamp and isFormOnCurrentTemplate())
 *                   both answer "is this form STALE", and the answer is no for
 *                   a form somebody has hand-edited within the shape: a
 *                   reworded question, a deleted choice, an extra item. That is
 *                   the case a person reaches for this action for.
 *   • limit       — ceiling on rebuilds this run (default MAX_FORM_REBUILDS_PER_RUN).
 *   • deadline    — a Date.now() value to stop at, for a caller that knows how
 *                   much of its six minutes it has already spent.
 */
function migrateFormsToCurrentTemplate(registrySheet, sessionRows, options) {
  options = options || {};
  const force = options.force === true;
  const only = options.onlyFormIds || null;
  const limit = options.limit || MAX_FORM_REBUILDS_PER_RUN;
  const deadline = options.deadline || 0;

  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || getSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const versions = getFormTemplateVersions();
  const sharedFormIds = getSharedFormIdSet();

  const newUrlByFormId = {};
  let rebuilt = 0;
  let deferred = 0;

  Object.keys(byForm).forEach(formId => {
    if (only && !only.has(formId)) return;
    if (!force && versions[formId] === TEMPLATE_VERSION) return; // already known good — no API call
    if (rebuilt >= limit || (deadline && Date.now() >= deadline)) { deferred++; return; }

    let form;
    try {
      form = openFormCached(formId);
    } catch (err) {
      log(`⚠️ migrateFormsToCurrentTemplate: could not open form ${formId} (${err}).`);
      noteForAdmin('Forms that could not be opened', `${formId} — ${err}`);
      return;
    }

    if (!force && isFormOnCurrentTemplate(form)) {
      setFormTemplateVersion(formId, TEMPLATE_VERSION); // first sighting of an already-current form: just record it
      return;
    }

    const formRows = byForm[formId];
    const formContext = buildFormSessionContext(formId, formRows, map, sharedFormIds);
    const location = describeLocations(formContext.locations);
    if (formContext.sessions.length === 0) return;

    try {
      withFormRetry(`rebuilding form ${formId} ("${location}")`,
        () => rebuildFormFromCurrentTemplate(form, formContext));
    } catch (err) {
      log(`⚠️ migrateFormsToCurrentTemplate: could not rebuild form ${formId} for "${location}" (${err}).`);
      noteForAdmin('Forms that could not be updated',
        `${formId} (${location}) is still on an older layout — rebuilding it failed with: ${err}. ` +
        `It keeps its old questions and its link still works; the next sync will try again.`);
      return;
    }

    rebuilt++;
    // A breath between forms. A rebuild is ~35 writes to one document, and
    // running several back to back is precisely what makes Forms start
    // answering "please wait and try again" — the retry above recovers from
    // that, but not provoking it is cheaper than recovering from it.
    if (rebuilt < limit) Utilities.sleep(1500);
    newUrlByFormId[formId] = buildRegistrationUrl(form);
    // Deliberately says only WHICH version, not what changed in it. This line
    // used to name the v3 change ("the guest-count branch pages are gone") and
    // was still saying it long after v4 brought that question back on purpose —
    // a log line that describes one particular migration goes stale the moment
    // the next one lands, and a stale one is worse than a terse one.
    log(`Rebuilt form ${formId} ("${location}") on template v${TEMPLATE_VERSION}.`);
    noteForAdmin('Registration forms updated',
      `"${form.getTitle()}" (${location}) ` +
      (force ? 'has been rebuilt from the current template' : 'was on an older layout and has been rebuilt on the current one') +
      ` (template v${TEMPLATE_VERSION}). Its link is unchanged; the boxes it pre-checks are re-generated on the ` +
      `dashboard's "View Live Form" link, and calendar invites pick the new one up the next time that ` +
      `program's dates change.`);
  });

  if (rebuilt > 0) updateRegistryFormLinks(registrySheet, newUrlByFormId);
  if (deferred > 0) {
    log(force
      ? `${deferred} more form(s) left to rebuild this run — run the action again to continue.`
      : `${deferred} more form(s) still on an older template — they'll be rebuilt on the next sync.`);
  }
  flushPersistentRegistries();
  return rebuilt;
}

/**
 * Re-points Master_Program_Dashboard's "View Live Form" links at freshly
 * generated URLs, for the forms in urlByFormId. Needed after a rebuild: the
 * link we hand out is a PREFILLED url (buildRegistrationUrl()) whose
 * entry.N parameters name the form's item IDs, and a rebuilt form has new
 * ones. The stale link still opens the right form — Forms ignores parameters
 * it doesn't recognize — it just stops pre-checking anything.
 */
function updateRegistryFormLinks(registrySheet, urlByFormId) {
  if (Object.keys(urlByFormId).length === 0) return;
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based, read off the sheet itself

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const idValues = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1).getValues();
    const linkRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const formulas = linkRange.getFormulas();
    const values = linkRange.getValues();
    const links = formulas.map((f, r) => [f[0] || values[r][0]]); // leave every other row exactly as it is
    let touched = false;
    idValues.forEach((idRow, r) => {
      const url = urlByFormId[String(idRow[0] || '').trim()];
      if (!url) return;
      links[r] = [makeHyperlinkFormula(url, 'View Live Form')];
      touched = true;
    });
    if (touched) {
      linkRange.setValues(links);
      invalidateSectionedRowsCache(registrySheet);
    }
  });
}


