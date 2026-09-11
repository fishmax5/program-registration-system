// ============================================================================
// 99. RE-READING A FORM THIS WORKBOOK STOPPED LOOKING AT  (backfill + report)
// ============================================================================
//
// THE FAILURE THIS EXISTS FOR, in the order it happened:
//
//   1. Appointment programs stopped taking a form per month and started taking
//      one rolling form (94). adoptAssistanceProgramSessions() repointed every
//      upcoming row at it, and the month forms it replaced were left behind.
//   2. On some rows the two halves of that repoint came apart: the link cells
//      moved to the new form and Form_ID stayed on the old one — the "a live
//      link, on the right row, to the wrong form" fault 32 exists to repair.
//   3. The old form was then deleted out of Drive.
//
// And the import went quiet. syncRegistrationsInternal() builds its work list
// from the Form_ID COLUMN and nothing else (getDistinctFormIds), so the form
// staff were handing out — the one the dashboard link opened, the one filling
// up with responses — was never opened, never read, and never mentioned. The
// registrations were all there. Nothing had gone wrong with any of them. They
// simply were not on any list this workbook walks.
//
// TWO THINGS FOLLOW, and this file is both of them.
//
// FIRST, FIXING THE POINTER DOES NOT BRING ANYBODY BACK. The import reads
// form.getResponses(LAST_FORM_SYNC_TIME), and every response submitted while
// the pointer was wrong is older than that. Correct Form_ID and the next sync
// finally opens the form — and collects only what arrives from that moment on.
// The people already missing stay missing, and the tab now looks healthy, which
// is worse than looking broken. So there has to be a way to say "read this
// form from the beginning", and before this file there was none: the sync clock
// is only ever read and advanced (27), with no reset anywhere in the project.
//
// HOW IT IS DONE: a MARK, not a second importer. A form is written into
// Script Properties, and the ordinary sync — one code path, the same waitlist
// arithmetic, the same tombstones, the same counts, dashboards, leader sheets
// and invitations afterwards — reads that form from the epoch instead of from
// the clock. Re-reading a whole history is safe because buildRegistrantRow()
// was already built to be: a response whose row exists is patched in place by
// Party_ID and appends nothing, a deleted registration stays deleted on its
// tombstone, and a row somebody has edited by hand is untouchable. The mark is
// cleared only once the Registrants tab has actually been written, for the same
// reason LAST_FORM_SYNC_TIME is only advanced then — a backfill that did not
// land must happen again rather than be forgotten.
//
// THE MARKED FORM IS ALSO ADDED TO THE WORK LIST, which is the half that makes
// this usable before the pointer is repaired: a form no session row names is a
// form getDistinctFormIds() cannot see, and that is exactly the form somebody
// reaches for this with. Its responses will each report that they match no
// session until Form_ID is put right — which is the true state of affairs, said
// out loud, instead of silence.
//
// SECOND, THE SILENCE ITSELF WAS THE BUG. A Form_ID naming a form that cannot
// be opened was one line in a digest that also carries waitlists, renames and
// double-bookings — and it never said which programs were affected, or that
// the workbook's own registry disagreed with the column, or what to press.
// describeUnimportedFormPointer() is what that line says now, and
// reportUnimportedForms() is the standing read-only check for the shape of
// fault nothing else looks for: a form with responses that no session row
// names, which is to say a form nobody is importing.
//
// Numbered last for the usual reason — never renumber, and this landed after
// 98. It was 97 on its own branch until the merge that brought the render
// batching and the sliced sync in; the prefix is all that changed. Safe there: behavior only, its own three constants stand alone, its
// schema is HEADERS.All_Program_Sessions in 03 like every other tab's, and
// everything it reaches for (getSectionedRows, getPersistentFormRegistry,
// registryKeyForSessionRow, extractFormId, syncRegistrations) it reads at CALL
// time or through a hoisted function declaration.
// ============================================================================

/**
 * The forms marked to be read from the beginning on the next sync.
 *
 * VERSIONED like every stored shape in this project. The value is
 * { formId: ISO timestamp the mark was made }, and the timestamp is kept for
 * the report rather than for the read — a mark means "from the epoch", and a
 * mark that has been sitting there for a week is worth being able to say so.
 */
const REGISTRATION_BACKFILL_PROP_KEY = 'REGISTRATION_BACKFILL_FORMS_V1';

/** How many forms the unimported-forms report will open before it summarizes the rest. */
const UNIMPORTED_FORM_REPORT_MAX_FORMS = 40;

/** How many programs and dates a "this form could not be read" note names before it counts the rest. */
const UNIMPORTED_FORM_NOTE_MAX_ROWS = 6;

function getBackfillMarks() {
  const raw = PropertiesService.getScriptProperties().getProperty(REGISTRATION_BACKFILL_PROP_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    // A store nobody can read is a store with nothing marked in it. Said out
    // loud rather than swallowed: the person waiting for a backfill needs to
    // know theirs is not coming.
    log(`⚠️ The re-import list could not be read (${err}) — starting a fresh one. ` +
      `Any form marked for re-import will need marking again.`);
    return {};
  }
}

function saveBackfillMarks(marks) {
  const props = PropertiesService.getScriptProperties();
  if (!marks || Object.keys(marks).length === 0) {
    props.deleteProperty(REGISTRATION_BACKFILL_PROP_KEY);
    return;
  }
  props.setProperty(REGISTRATION_BACKFILL_PROP_KEY, JSON.stringify(marks));
}

/** Marks one form to be read from the beginning on the next registration sync. */
function markFormForBackfill(formId) {
  const id = String(formId || '').trim();
  if (!id) return false;
  const marks = getBackfillMarks();
  if (marks[id]) return false; // already waiting — marking twice is not marking harder
  marks[id] = new Date().toISOString();
  saveBackfillMarks(marks);
  return true;
}

/** The marked form IDs, for the sync's work list. */
function pendingBackfillFormIds() {
  return Object.keys(getBackfillMarks());
}

function isFormMarkedForBackfill(formId) {
  return Object.prototype.hasOwnProperty.call(getBackfillMarks(), String(formId || '').trim());
}

/**
 * Drops the marks for forms that have now been read. Called ONLY once the
 * Registrants tab has been written — see the banner.
 */
function clearBackfillMarks(formIds) {
  const marks = getBackfillMarks();
  let cleared = 0;
  (formIds || []).forEach(id => {
    if (marks[String(id || '').trim()]) { delete marks[String(id).trim()]; cleared++; }
  });
  if (cleared > 0) {
    saveBackfillMarks(marks);
    log(`Re-import: ${cleared} form(s) have now been read from the beginning; their marks are cleared.`);
  }
  return cleared;
}

/**
 * How far back to read one form's responses: the sync clock normally, and the
 * beginning of time for a form somebody has marked.
 *
 * new Date(0) rather than a stored "since": a backfill is asked for because
 * nobody knows how long the form has been going unread, and a guess at that
 * date is the one input that could leave people out a second time. The cost of
 * reading everything is one pass over a form's own responses, and every one
 * already imported is recognized by its Party_ID and appends nothing.
 */
function backfillSinceFor(formId, lastSync) {
  return isFormMarkedForBackfill(formId) ? new Date(0) : lastSync;
}

// ---------------------------------------------------------------------------
// WHY A FORM COULD NOT BE READ — the words the admin digest carries
// ---------------------------------------------------------------------------

/**
 * One session row reduced to the identity registryKeyForSessionRow() wants.
 *
 * getSectionedRows() hands back rows projected into HEADERS order, where 32's
 * reader works off the raw sheet grid — so the same identity is assembled here
 * rather than that one being reshaped to take both.
 */
function sessionRowFormIdentity(row, map) {
  const eventId = String(row[map['Event_ID']] || '').trim();
  return {
    date: coerceDate(row[map['Event_Date']]),
    eventId,
    source: String(row[map['Calendar_Source']] || '').trim(),
    title: String(row[map['Clean_Title']] || '').trim(),
    location: String(row[map['Location']] || '').trim(),
    typeTag: map['Type_Tag'] === undefined ? '' : row[map['Type_Tag']],
    isAssistance: map['Personalized_Assistance'] !== undefined &&
      isAssistanceColumnValue(row[map['Personalized_Assistance']]),
    formId: String(row[map['Form_ID']] || '').trim(),
    isLunchOnly: isLunchOnlyEventId(eventId)
  };
}

/**
 * WHAT IS ACTUALLY WRONG when a form named by the session table cannot be
 * opened, in the words somebody can act on.
 *
 * It used to say the form ID and the error, which names neither the programs
 * that have stopped importing nor the fix. Three things are added here, and
 * the third is the one that matters:
 *
 *   • WHICH programs and dates point at it, so the size of the outage is
 *     legible without going to look;
 *   • that this workbook's own form registry names a DIFFERENT form for those
 *     sessions — which is this bug's signature, and is checkable for free
 *     because the registry is a memoized Script Properties read;
 *   • that repairing the pointer is only half of it. Everything submitted
 *     while it was wrong is behind the sync clock, so the second half is a
 *     re-import, and the note says so rather than leaving somebody to discover
 *     it when the names still do not appear.
 *
 * Pure description: it opens at most one form (the registry's candidate, to
 * say whether it is reachable) and writes nothing.
 */
function describeUnimportedFormPointer(formId, sessionRows, map) {
  const wanted = String(formId || '').trim();
  if (!wanted) return '';
  const registry = getPersistentFormRegistry();
  const affected = [];
  const suggested = {};

  (sessionRows || []).forEach(row => {
    const id = sessionRowFormIdentity(row, map);
    if (id.formId !== wanted || !id.date) return;
    affected.push(id);
    const key = registryKeyForSessionRow(id);
    const shouldBe = key ? String(registry[key] || '').trim() : '';
    if (shouldBe && shouldBe !== wanted) suggested[shouldBe] = (suggested[shouldBe] || 0) + 1;
  });

  if (affected.length === 0) {
    // Nothing on the session table points at it, so no program has stopped
    // importing — this form is only being read because somebody marked it.
    return `No session on ${SHEET_NAMES.PROGRAM_DASHBOARD} points at it, so no program is waiting on it.`;
  }

  const named = dedupePreservingOrder(affected.map(id => id.title).filter(Boolean));
  const dates = affected.map(id => id.date).sort((a, b) => a - b);
  const shown = named.slice(0, UNIMPORTED_FORM_NOTE_MAX_ROWS).join(', ') +
    (named.length > UNIMPORTED_FORM_NOTE_MAX_ROWS ? `, and ${named.length - UNIMPORTED_FORM_NOTE_MAX_ROWS} more` : '');

  let text = `${affected.length} session row(s) point at it — ${shown} — covering ` +
    `${formatDateLabel(dates[0])} to ${formatDateLabel(dates[dates.length - 1])}. ` +
    `Registrations for those sessions are NOT being imported.`;

  const candidates = Object.keys(suggested).sort((a, b) => suggested[b] - suggested[a]);
  if (candidates.length > 0) {
    const best = candidates[0];
    let reachable = true;
    try {
      openFormCached(best);
    } catch (err) {
      reachable = false;
    }
    text += ` This workbook's form registry says those sessions belong on ` +
      `${describeFormLink(best)}${reachable ? '' : ', which cannot be opened either'} — so the ` +
      `Form_ID column and the registry disagree, which is what stops the form staff are actually ` +
      `handing out from ever being read.`;
    if (reachable) {
      text += ` Run 🔧 Admin ▸ 🔗 Repair Dashboard Links to put the column right, then ` +
        `🔧 Admin ▸ ♻️ Re-import a Form's Responses… on ${describeFormLink(best)} — the repair alone ` +
        `does NOT recover anything already submitted, because those responses are behind the sync clock.`;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// THE STANDING CHECK: a form with responses that nothing is importing
// ---------------------------------------------------------------------------

/**
 * Every form this workbook should be reading and is not, in two shapes:
 *
 *   unreadable  a form the session table NAMES that will not open — deleted,
 *               or out of this account's reach.
 *   unnamed     a form the persistent registry knows about that NO session row
 *               names. This is the one nothing else in the project looks for,
 *               and it is the shape of the appointment-form fault: the form is
 *               alive, its link is in circulation, it is collecting responses,
 *               and getDistinctFormIds() has never heard of it.
 *
 * Read-only, and bounded: at most UNIMPORTED_FORM_REPORT_MAX_FORMS forms are
 * opened, because the answer this gives ("it holds N responses") is worth one
 * Forms round trip each and a workbook with three hundred stale registry
 * entries is not worth three hundred.
 */
function findUnimportedForms(registrySheet) {
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const namedByRows = new Set();
  rows.forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    if (formId) namedByRows.add(formId);
  });

  const registry = getPersistentFormRegistry();
  const registryForms = {};
  Object.keys(registry).forEach(key => {
    const formId = String(registry[key] || '').trim();
    if (!formId) return;
    if (!registryForms[formId]) registryForms[formId] = [];
    registryForms[formId].push(key);
  });

  const unreadable = [];
  const unnamed = [];
  let opened = 0;
  let skipped = 0;

  const describeForm = formId => {
    if (opened >= UNIMPORTED_FORM_REPORT_MAX_FORMS) { skipped++; return null; }
    opened++;
    try {
      const form = openFormCached(formId);
      const responses = form.getResponses();
      const latest = responses.length > 0 ? responses[responses.length - 1].getTimestamp() : null;
      return { title: form.getTitle(), responses: responses.length, latest };
    } catch (err) {
      return { error: String(err) };
    }
  };

  Array.from(namedByRows).forEach(formId => {
    const info = describeForm(formId);
    if (!info || !info.error) return;
    unreadable.push({ formId, error: info.error, why: describeUnimportedFormPointer(formId, rows, map) });
  });

  Object.keys(registryForms).forEach(formId => {
    if (namedByRows.has(formId)) return;
    const info = describeForm(formId);
    if (!info || info.error) return; // a registry entry for a form that is gone is ordinary housekeeping
    if (info.responses === 0) return; // nothing is being lost, so it is not a fault
    unnamed.push({
      formId, title: info.title, responses: info.responses, latest: info.latest,
      keys: registryForms[formId]
    });
  });

  unnamed.sort((a, b) => b.responses - a.responses);
  return { unreadable, unnamed, scanned: namedByRows.size, opened, skipped };
}

/**
 * ADMIN REPORT — "Find Forms Nothing Is Importing". Read-only and ungated,
 * like every other report: it says what is true and changes nothing.
 */
function reportUnimportedForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return;
  }

  const found = findUnimportedForms(registrySheet);
  const lines = [];

  if (found.unreadable.length === 0 && found.unnamed.length === 0) {
    lines.push(`✅ Every form this workbook knows about is being imported.`);
    lines.push('');
    lines.push(`${found.scanned} form(s) are named by the session table, and each of them opened.`);
  }

  if (found.unreadable.length > 0) {
    lines.push(`⚠️ ${found.unreadable.length} form(s) named on ${SHEET_NAMES.PROGRAM_DASHBOARD} could not be opened:`);
    found.unreadable.forEach(f => {
      lines.push('');
      lines.push(`• ${f.formId}`);
      lines.push(`  ${f.error}`);
      if (f.why) lines.push(`  ${f.why}`);
    });
    lines.push('');
  }

  if (found.unnamed.length > 0) {
    lines.push(`⚠️ ${found.unnamed.length} form(s) hold responses and NO session row names them, so nothing ` +
      `is importing them:`);
    found.unnamed.forEach(f => {
      lines.push('');
      lines.push(`• "${f.title}" — ${f.responses} response(s)` +
        (f.latest ? `, the most recent on ${formatDateLabel(f.latest)}` : ''));
      lines.push(`  ${f.formId}`);
      lines.push(`  The form registry files it under: ${f.keys.slice(0, 3).join(', ')}`);
    });
    lines.push('');
    lines.push('For each of these: put the sessions back on the right form (🔗 Repair Dashboard Links, or ' +
      'Move Sessions to Another Form…), then use ♻️ Re-import a Form\'s Responses… — repairing the ' +
      'pointer alone collects nothing already submitted.');
  }

  if (found.skipped > 0) {
    lines.push('');
    lines.push(`(${found.skipped} further form(s) were not opened this run — the report looks at ` +
      `${UNIMPORTED_FORM_REPORT_MAX_FORMS} at a time.)`);
  }

  const report = lines.join('\n');
  log(`reportUnimportedForms:\n${report}`);
  try {
    SpreadsheetApp.getUi().alert('Forms Nothing Is Importing', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // No UI (editor or trigger run) — the log above is the output.
  }
}

// ---------------------------------------------------------------------------
// THE DIALOG
// ---------------------------------------------------------------------------

/**
 * Every form worth offering for a re-import — which is deliberately a WIDER
 * list than listExistingForms() (47) gives.
 *
 * That one answers "where could I send people?", so it keeps only forms with an
 * upcoming date. This one answers "what might have gone unread?", and the whole
 * premise is a form the session table has lost track of — so the registry's
 * forms are in the list too, marked as such, and a form whose dates are all
 * past is still offered because that is precisely when somebody notices.
 */
function listFormsForReimport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const byForm = {};

  if (sheet) {
    const headers = HEADERS.All_Program_Sessions;
    const map = getIndexMap(headers);
    getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
      const formId = String(row[map['Form_ID']] || '').trim();
      const date = coerceDate(row[map['Event_Date']]);
      if (!formId || !date) return;
      const title = String(row[map['Clean_Title']] || '').trim();
      if (!byForm[formId]) byForm[formId] = { formId, titles: [], latest: date, rows: 0, fromRows: true };
      const entry = byForm[formId];
      entry.rows++;
      if (title && entry.titles.indexOf(title) === -1) entry.titles.push(title);
      if (date > entry.latest) entry.latest = date;
    });
  }

  const registry = getPersistentFormRegistry();
  Object.keys(registry).forEach(key => {
    const formId = String(registry[key] || '').trim();
    if (!formId || byForm[formId]) return;
    byForm[formId] = { formId, titles: [key], latest: null, rows: 0, fromRows: false };
  });

  return Object.keys(byForm)
    .map(k => byForm[k])
    .sort((a, b) => {
      // The forms nothing points at go FIRST. They are the reason this dialog
      // exists, and burying them under fifty healthy months would be the same
      // silence in a different shape.
      if (a.fromRows !== b.fromRows) return a.fromRows ? 1 : -1;
      return (b.latest || 0) - (a.latest || 0);
    })
    .slice(0, 120)
    .map(f => ({
      value: f.formId,
      label: f.fromRows
        ? `${f.titles.slice(0, 3).join(', ')}${f.titles.length > 3 ? '…' : ''} — ` +
          `${f.rows} session row(s), through ${formatDateLabel(f.latest)}`
        : `⚠️ NO SESSION ROW POINTS AT THIS FORM — registered as ${f.titles[0]}`
    }));
}

/** ADMIN ACTION — "Re-import a Form's Responses…". */
function showReimportFormDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const forms = listFormsForReimport();
  const html = HtmlService.createHtmlOutput(buildReimportFormHtml(forms))
    .setWidth(620)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, "Re-import a Form's Responses");
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildReimportFormHtml(forms) {
  const formTags = forms.length > 0
    ? forms.map(f => `<option value="${escapeHtmlForDialog(f.value)}">${escapeHtmlForDialog(f.label)}</option>`).join('\n')
    : '<option value="">(no form on this workbook yet)</option>';

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  label.field { display: block; font-weight: bold; margin-top: 12px; }
  input[type=text], select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; margin-top: 4px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Re-import a form's responses</h3>
<p class="hint">
  Reads <b>every response the form has ever taken</b>, not just the ones since the last sync. Use it when a
  form has been collecting registrations that never reached
  ${escapeHtmlForDialog(SHEET_NAMES.REGISTRANT_DASH)} — usually because its sessions were pointing at a
  different form while the responses came in.
</p>
<p class="hint">
  <b>Nothing already on the tab is disturbed.</b> A response that is already a row is recognized and left
  alone, a registration somebody deleted stays deleted, and a row edited by hand is never overwritten.
  Only the missing ones are added.
</p>
<p class="hint">
  Check the <b>Form_ID</b> column on ${escapeHtmlForDialog(SHEET_NAMES.PROGRAM_DASHBOARD)} first — if it names
  the wrong form, run <b>🔗 Repair Dashboard Links</b> (on the Admin menu) before this, or the responses will come back saying
  they match no session.
</p>

<label class="field">Which form?
  <select id="pickedForm">${formTags}</select>
</label>
<label class="field">…or paste a form URL or ID to use instead
  <input type="text" id="formRef" placeholder="https://docs.google.com/forms/d/…/edit">
</label>

<button id="go" onclick="submit()">Re-import this form</button>
<div id="status"></div>
<script>
  function submit() {
    var ref = document.getElementById('formRef').value || document.getElementById('pickedForm').value;
    if (!ref) { say('Pick a form, or paste its URL.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… reading the whole form, then importing. This can take a few minutes.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .reimportFormNow(ref);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Marks the form and runs the sync, which is the whole of it.
 *
 * DELIBERATELY NOT A SECOND IMPORTER. Everything that has to happen after a
 * registration lands — the waitlist arithmetic against live occupancy, the
 * capacity recount, the dashboards, the leader sheets, the calendar invitations
 * — is a hundred lines downstream of the form loop in syncRegistrationsInternal(),
 * and a private copy of it here would be a second thing to keep in step forever.
 * So this changes one input to the existing run and lets the existing run
 * happen.
 */
function reimportFormNow(formRef) {
  if (isBootstrapActive()) return `⚠️ ${bootstrapBusyMessage()}`;

  const formId = extractFormId(formRef);
  if (!formId) return '⚠️ That is not a form ID or an editable form URL — copy the /d/<id>/edit link.';

  let title = '';
  let total = 0;
  try {
    const form = openFormCached(formId);
    title = form.getTitle();
    total = form.getResponses().length;
  } catch (err) {
    return `⚠️ That form could not be opened (${err}). If it was deleted, its responses are gone with it — ` +
      `the registrations it already imported are still on ${SHEET_NAMES.REGISTRANT_DASH}.`;
  }
  if (total === 0) return `"${title}" has no responses at all, so there is nothing to re-import.`;

  markFormForBackfill(formId);
  log(`Re-import: "${title}" (${formId}) marked to be read from the beginning — ${total} response(s) on it.`);

  // The mark survives a failure here, so a sync that could not run leaves the
  // form still waiting rather than quietly un-marked.
  syncRegistrations();

  const stillWaiting = isFormMarkedForBackfill(formId);
  if (stillWaiting) {
    return `⚠️ "${title}" is marked for re-import, but the sync could not finish — it will be read from ` +
      `the beginning on the next run instead. Check the log.`;
  }
  return `Re-imported "${title}" — all ${total} response(s) read. Anyone who was missing from ` +
    `${SHEET_NAMES.REGISTRANT_DASH} is on it now; everybody already there was left as they were. ` +
    `If names are still missing, the Form_ID column is pointing the sessions at a different form — ` +
    `run 🔗 Admin ▸ Repair Dashboard Links and try again.`;
}
