// ============================================================================
// 10. MOVING SESSIONS BETWEEN FORMS  (combine, or just repoint a link)
// ============================================================================
//
// Which form a session belongs to is decided by grouping rules — [Grouped] vs
// [Regular], [All Locations] — and those rules cover the shapes a program
// USUALLY takes. They cannot express the one-off:
//
//   "These four different programs are one Tuesday afternoon event this month;
//    put them on a single form so people sign up once."
//   "This session's form link is wrong / points at a form we retired. Move it
//    to that one."
//
// Both are the same operation underneath — take some sessions, point them at a
// different form, make everything that references the old one agree — so both
// live behind one menu item. Pick the sessions, then either let it build a new
// COMBINED form covering exactly them, or name an existing form to move them
// onto.
//
// WHAT MAKES A COMBINED FORM WORK AT ALL is that its date labels name their
// program (formatSessionLabel()'s showTitle, which turns itself on as soon as
// a form's sessions carry more than one Clean_Title). Without that, a form
// covering Chair Yoga and Bingo on the same afternoon would offer two
// identical date rows — which Google Forms rejects outright, and which no
// response could be resolved back to a session anyway.
//
// WHAT THIS DOES NOT DO: move registrations. Rows already imported keep
// pointing at the session they were made for, which is correct — the session
// did not change, only the form people reach it through. Anyone who registers
// after the move arrives through the new form.
// ============================================================================

/** MENU ENTRY: pick sessions, pick a destination form. */
function showRepointSessionsDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const sessions = listRepointableSessions();
  if (sessions.length === 0) {
    toastIfPossible('No upcoming sessions to move — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildRepointSessionsHtml(sessions, listExistingForms()))
    .setWidth(620)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Move Sessions to Another Form');
}

/** How far ahead the picker looks. Past sessions are deliberately not offered — their forms are closed business. */
const REPOINT_WINDOW_FORWARD_DAYS = 120;

/** Every UPCOMING session, newest form link and all, as { value: Event_ID, label }. */
function listRepointableSessions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const limitKey = formatDateKey(new Date(Date.now() + REPOINT_WINDOW_FORWARD_DAYS * 86400000));

  return getSectionedRows(sheet, headers, 'Event_ID')
    .map(row => {
      const date = coerceDate(row[map['Event_Date']]);
      const eventId = String(row[map['Event_ID']] || '').trim();
      if (!date || !eventId) return null;
      const dateKey = formatDateKey(date);
      if (dateKey < todayKey || dateKey > limitKey) return null;
      return {
        value: eventId,
        dateKey,
        label: `${formatDateLabel(date)} — ${String(row[map['Clean_Title']] || '').trim()} ` +
          `(${String(row[map['Location']] || '').trim()})`,
        formId: String(row[map['Form_ID']] || '').trim()
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : a.label.localeCompare(b.label))));
}

/** The forms this workbook already knows about, for the "move onto an existing form" list. */
function listExistingForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const byForm = {};

  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!formId || !date) return;
    const title = String(row[map['Clean_Title']] || '').trim();
    if (!byForm[formId]) byForm[formId] = { formId, titles: [], latest: date, upcoming: 0 };
    if (title && byForm[formId].titles.indexOf(title) === -1) byForm[formId].titles.push(title);
    if (date > byForm[formId].latest) byForm[formId].latest = date;
    if (formatDateKey(date) >= todayKey) byForm[formId].upcoming++;
  });

  return Object.keys(byForm)
    .map(k => byForm[k])
    .filter(f => f.upcoming > 0) // a form with nothing upcoming is not somewhere to send people
    .sort((a, b) => b.latest - a.latest)
    .slice(0, 100)
    .map(f => ({
      value: f.formId,
      label: `${f.titles.slice(0, 3).join(', ')}${f.titles.length > 3 ? '…' : ''} — ` +
        `${f.upcoming} upcoming date(s), through ${formatDateLabel(f.latest)}`
    }));
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildRepointSessionsHtml(sessions, forms) {
  const sessionTags = sessions.map(s =>
    `<label class="row"><input type="checkbox" name="session" value="${escapeHtmlForDialog(s.value)}"> ` +
    `${escapeHtmlForDialog(s.label)}</label>`).join('\n');
  const formTags = forms.map(f =>
    `<option value="${escapeHtmlForDialog(f.value)}">${escapeHtmlForDialog(f.label)}</option>`).join('\n');
  const noForms = forms.length === 0 ? '<option value="">(no other forms yet)</option>' : '';

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  #sessions { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 200px; overflow-y: auto; }
  label.row { display: block; padding: 2px 0; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin: 12px 0 0 0; padding: 8px 10px; }
  legend { font-weight: bold; padding: 0 4px; }
  input[type=text], select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; margin-top: 4px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Move sessions onto one form</h3>
<p class="hint">
  Tick the sessions, then choose where they should go. Their "View Live Form" links and the
  registration link in their calendar events are both updated. Registrations already collected are
  not moved or changed.
</p>
<div id="sessions">${sessionTags}</div>

<fieldset>
  <legend><label><input type="radio" name="mode" value="new" checked> Build a new combined form</label></legend>
  <input type="text" id="newTitle" placeholder="Form name (optional) — e.g. Tuesday Afternoon Programs">
</fieldset>

<fieldset>
  <legend><label><input type="radio" name="mode" value="existing"> Move onto an existing form</label></legend>
  <select id="existingForm">${noForms}${formTags}</select>
  <input type="text" id="formRef" placeholder="…or paste a form URL or ID to use instead">
</fieldset>

<button id="go" onclick="submit()">Move sessions</button>
<div id="status"></div>
<script>
  function submit() {
    var picked = [].slice.call(document.querySelectorAll('input[name=session]:checked')).map(function (el) { return el.value; });
    if (picked.length === 0) { say('Tick at least one session first.', 'err'); return; }
    var mode = document.querySelector('input[name=mode]:checked').value;
    var payload = {
      mode: mode,
      title: document.getElementById('newTitle').value,
      formRef: document.getElementById('formRef').value || document.getElementById('existingForm').value
    };
    if (mode === 'existing' && !payload.formRef) { say('Pick an existing form, or paste its URL.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… this can take a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .repointSessionsToForm(picked, payload);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Points every session in `eventIds` at one form —
 * newly built, or an existing one named in `target` — and brings everything
 * that references a form into line: the two link columns, the destination
 * form's own date list, and the registration link in the calendar events.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function repointSessionsToForm(eventIds, target) {
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ No sessions were selected.';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return '⚠️ No program dashboard yet — run Sync Cal first.';

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const allRows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const chosenRows = allRows.filter(row => wanted.has(String(row[map['Event_ID']] || '').trim()));
  if (chosenRows.length === 0) return '⚠️ Those sessions are no longer on the dashboard — try Sync Cal and reopen this.';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) return '⚠️ A sync is already running — try again in a moment.';
  try {
    const mode = String((target && target.mode) || 'new');
    let formId;
    let formCreated = false;

    if (mode === 'existing') {
      formId = extractFormId(target.formRef);
      if (!formId) return '⚠️ That does not look like a form URL or ID.';
      try {
        FormApp.openById(formId);
      } catch (err) {
        return `⚠️ Could not open form ${formId} (${err}). Check the ID, and that this account can edit it.`;
      }
    } else {
      const created = createCombinedRegistrationForm(chosenRows, map, target && target.title);
      if (!created) return '⚠️ Could not build the combined form — see the execution log for why.';
      formId = created.formId;
      formCreated = true;
    }

    const moved = writeFormIdOntoSessions(registrySheet, wanted, formId);
    if (moved === 0) return '⚠️ Nothing was moved — those sessions already point at that form.';
    SpreadsheetApp.flush(); // the refresh below re-reads these rows

    // The destination form now covers a different set of dates than it did a
    // moment ago; its grid rows have to say so, or a respondent cannot pick
    // the sessions that were just moved onto it.
    const refreshedRows = getSectionedRows(registrySheet, headers, 'Event_ID');
    refreshOneFormDateLabels(formId, refreshedRows, map, 'sessions moved onto this form');
    reapplySignUpOptionsForForm(formId, refreshedRows, map);
    flushPersistentRegistries();

    // Every event that used to link to another form is still saying so.
    rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
    flushAdminDigest('Move sessions to another form');

    const summary = `✅ ${moved} session(s) moved onto ${formCreated ? 'a new combined form' : 'that form'}. ` +
      `Their dashboard links and calendar descriptions now point at it.` +
      (formCreated ? ' Each date on the form is labelled with its own program name.' : '');
    log(`repointSessionsToForm: ${summary} (form ${formId})`);
    toastIfPossible(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Pulls a Form ID out of whatever somebody pasted: a bare ID, an edit URL, a
 * published /viewform URL, or a shortened /d/e/... published link.
 *
 * The /d/e/ form is worth being explicit about — it is the link people copy
 * out of the address bar most often, and the long string in it is a PUBLISHED
 * id, not the form's own ID, so FormApp.openById() will reject it. Better to
 * say that than to hand back "could not open".
 */
function extractFormId(reference) {
  const raw = String(reference || '').trim();
  if (!raw) return '';
  if (raw.indexOf('/d/e/') !== -1) {
    log('ℹ️ That is a published form link (/d/e/…), which does not contain the form ID. ' +
      'Open the form for editing and copy the /d/<id>/edit URL instead.');
    return '';
  }
  const match = /\/d\/([a-zA-Z0-9-_]{20,})/.exec(raw);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(raw) ? raw : '';
}

/**
 * Writes `formId` and its two link columns onto every session row whose
 * Event_ID is in `wanted`. Returns how many rows actually changed.
 *
 * Reads and writes the link columns as formula-or-value, so rows that are NOT
 * moving are written back byte-identical — the same care updateRegistryFormLinks()
 * takes, and the reason a repoint never quietly flattens a neighbouring row's
 * HYPERLINK() into its display text.
 */
function writeFormIdOntoSessions(registrySheet, wanted, formId) {
  let links;
  try {
    const form = FormApp.openById(formId);
    links = {
      view: makeHyperlinkFormula(buildRegistrationUrl(form), 'View Live Form'),
      edit: makeHyperlinkFormula(form.getEditUrl(), 'Edit Form Settings')
    };
  } catch (err) {
    log(`⚠️ writeFormIdOntoSessions: could not open form ${formId} (${err}).`);
    return 0;
  }

  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  let moved = 0;

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const eventIds = registrySheet.getRange(zone.start, sheetMap['Event_ID'], zone.count, 1).getValues();
    const idRange = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1);
    const viewRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const editRange = registrySheet.getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1);

    const ids = idRange.getValues();
    const viewValues = viewRange.getValues();
    const editValues = editRange.getValues();
    const views = viewRange.getFormulas().map((f, r) => [f[0] || viewValues[r][0]]);
    const edits = editRange.getFormulas().map((f, r) => [f[0] || editValues[r][0]]);

    let touched = false;
    eventIds.forEach((idRow, r) => {
      const eventId = String(idRow[0] || '').trim();
      if (!wanted.has(eventId)) return;
      if (String(ids[r][0] || '').trim() === formId) return; // already there
      ids[r] = [formId];
      views[r] = [links.view];
      edits[r] = [links.edit];
      touched = true;
      moved++;
    });

    if (touched) {
      idRange.setValues(ids);
      viewRange.setValues(views);
      editRange.setValues(edits);
      // repointSessionsToForm() deliberately re-reads these rows straight
      // after this returns — see the flush() there. It has to see the new
      // Form_ID, not the one this just replaced.
      invalidateSectionedRowsCache(registrySheet);
    }
  });

  return moved;
}

/**
 * Builds a brand-new form covering exactly `sessionRows`.
 *
 * Treated as a GROUPED series regardless of what its member programs are
 * tagged: a combined form is one form for one fixed list of dates, which is
 * precisely what Grouped means, and it is what makes the "sign up for every
 * date on this form" wording truthful.
 */
function createCombinedRegistrationForm(sessionRows, map, requestedTitle) {
  const sessions = sessionRows
    .map(row => ({
      date: coerceDate(row[map['Event_Date']]),
      location: String(row[map['Location']] || '').trim(),
      title: String(row[map['Clean_Title']] || '').trim()
    }))
    .filter(s => s.date)
    .sort((a, b) => a.date - b.date);
  if (sessions.length === 0) return null;

  const locations = locationsOfSessions(sessions);
  const titles = distinctSessionTitles(sessions);
  const formTitle = String(requestedTitle || '').trim() ||
    `${titles.slice(0, 2).join(' + ')}${titles.length > 2 ? ' + more' : ''} — ` +
    `${formatDateLabel(sessions[0].date)} onward`;

  const created = createFormFromSpec({
    sessions,
    locations,
    showLocation: locations.length > 1,
    // showTitle: this form's whole point is that its dates belong to different
    // programs, so every row says which — see formatSessionLabel().
    showTitle: titles.length > 1,
    // A combined form is one form for one fixed list of dates, which is what
    // Grouped means — and what makes "sign up for every date on this form"
    // the truthful wording.
    isFixed: true,
    isClub: sessionRows.some(row => isClubColumnValue(row[map['Club']])),
    programTitle: titles.length === 1 ? titles[0] : ''
  }, formTitle, 'combined form');
  if (!created) return null;

  log(`Created combined registration form "${formTitle}" (${created.formId}) covering ${sessions.length} ` +
    `session(s) across ${titles.length} program(s).`);
  return created;
}

/**
 * Copies the template and dresses the copy up for one specific set of
 * sessions: title, description, sign-up options, lunch questions, date labels,
 * footer note, version stamp.
 *
 * `spec` is deliberately the same shape buildFormSessionContext() returns —
 * sessions, locations, showLocation, showTitle, isFixed, isClub, programTitle,
 * capacityHints — so a caller holding a live form's context can rebuild it
 * without translating anything, and a caller inventing a new grouping can hand
 * over a literal.
 *
 * Every "a brand-new form appears" path goes through here: the combined-form
 * builder above and the destroy-and-rebuild sweep in section 11. The
 * per-group createRegistrationForm() deliberately does NOT — it is on the sync
 * hot path and works from a calendar group rather than from sheet rows.
 *
 * Returns { formId, formTitle }, or null if the sessions are empty.
 */
function createFormFromSpec(spec, formTitle, context) {
  const sessions = (spec.sessions || []).filter(s => s.date);
  if (sessions.length === 0) return null;

  // The Drive copy happens exactly ONCE, outside any retry. Only the
  // configuration below — all of it re-runnable against the same form ID —
  // is retried on a transient Forms error. Retrying the copy itself was the
  // bug: withFormRetry used to wrap this whole function, so a "please wait
  // and try again" thrown by any one of the configuration calls re-ran
  // createFormFromSpec() from the top and copied the template again,
  // leaving an orphaned form in Drive for every attempt beyond the first.
  const templateForm = getOrCreateTemplateForm();
  const copiedFile = DriveApp.getFileById(templateForm.getId()).makeCopy(formTitle, getOrCreateFormsFolder());
  const form = FormApp.openById(copiedFile.getId());
  // The same opening-up createRegistrationForm() does, for the same reason:
  // whoever syncs this workbook is routinely not whoever made the form.
  openUpFileToAnyoneWithLink(form.getId(), `registration form "${formTitle}"`);

  try {
    withFormRetry(`configuring "${formTitle}"`, () => configureFormFromSpec(form, spec, sessions, formTitle, context));
  } catch (err) {
    // Configuration never finished — this form is not a usable replacement.
    // Trash it here rather than leaving it to whoever notices later; the
    // caller's plan still has the old form to fall back on.
    try { DriveApp.getFileById(form.getId()).setTrashed(true); } catch (trashErr) { /* best effort */ }
    throw err;
  }

  return { formId: form.getId(), formTitle };
}

/** The re-runnable half of createFormFromSpec(): every call is safe to repeat against the same form. */
function configureFormFromSpec(form, spec, sessions, formTitle, context) {
  const locations = spec.locations || locationsOfSessions(sessions);

  form.setTitle(formTitle);
  // Published BEFORE the horizon decides whether it accepts responses — see
  // createRegistrationForm(), which had the same two calls the wrong way round.
  try {
    if (typeof form.setPublished === 'function') form.setPublished(true);
  } catch (err) {
    log(`⚠️ Could not explicitly publish "${formTitle}" (${err}).`);
  }
  applyRegistrationHorizonToNewForm(form, sessions, formTitle);

  const { allDateLabels, lunchDateLabels, allDateLines } = buildDateLabelSets(sessions, {
    showLocation: spec.showLocation,
    showTitle: spec.showTitle,
    capacityHints: spec.capacityHints
  });

  form.setDescription(buildFormDescription(locations, allDateLabels, spec.isFixed, lunchDateLabels.length > 0,
    { isClub: spec.isClub, programTitle: spec.programTitle, isLunchOnly: spec.isLunchOnly,
      dateLines: allDateLines }));
  applyAttendanceModeChoices(form,
    { isFixed: spec.isFixed, isClub: spec.isClub, programTitle: spec.programTitle, isLunchOnly: spec.isLunchOnly });
  syncLunchQuestionsOnForm(form, locations, lunchDateLabels.length > 0, spec);
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels,
    { form, force: true, context: context || 'new form',
      shape: formLunchShapeKey(Object.assign({}, spec, { locations }), lunchDateLabels.length > 0) });
  applyFormFooterNote(form, buildFooterNoteForLocations(locations));
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);
  flushPersistentRegistries();
}

/**
 * Re-asserts one form's sign-up options after its session list has changed —
 * a form that has just gained a club's dates has to start offering the club
 * option, and one that has just lost them has to stop.
 */
function reapplySignUpOptionsForForm(formId, sessionRows, map) {
  const formRows = sessionRows.filter(row => String(row[map['Form_ID']] || '').trim() === formId);
  if (formRows.length === 0) return;
  const context = buildFormSessionContext(formId, formRows, map, getSharedFormIdSet());
  try {
    applyAttendanceModeChoices(FormApp.openById(formId), {
      isFixed: context.isFixed || context.showTitle, // a combined form is a fixed list of dates
      isClub: context.isClub,
      programTitle: context.programTitle,
      isLunchOnly: context.isLunchOnly,
      // An appointment form HAS no mode question — passing this is what stops
      // it logging a warning about the absence on every session change.
      isAssistance: context.isAssistance
    });
  } catch (err) {
    log(`⚠️ Could not update the sign-up options on form ${formId} (${err}).`);
  }
}


