// ============================================================================
// 99d. WHO THE IMPORT SHOULD HAVE WRITTEN AND DID NOT  (read-only audit)
// ============================================================================
//
// THE QUESTION THIS ANSWERS: somebody says a registration is missing, and
// nothing in the workbook disagrees with them. The row is not on
// All_Registrants, the session is on the dashboard, the form still opens, and
// the log for the hour it was submitted in is long gone. There has been no way
// to ask "which responses does this workbook hold that it never turned into
// rows?" — only to look up one name at a time and find nothing, which is the
// same answer whether the person never registered or the import dropped them.
//
// THE TWO FAULTS IT LOOKS FOR, both in the grid path (29_form_response_processing):
//
//   1. A RESPONSE THAT READS AS NOTHING. getGridResponseByTitle() resolves a
//      grid through formIndex.byTitle — items CURRENTLY on the form — so a
//      response submitted against a question since deleted and replaced has
//      nothing left to resolve against. processFormResponse() then hits
//      `if (!attendanceGrid && !mealGrid) return []` and imports NOBODY, with
//      no warning and no admin note, because returning no rows is also what a
//      blank submission legitimately does.
//
//      WHY A RESPONSE DERIVED NOTHING IS NOT ASSUMED. This file was written
//      from a hypothesis — the v8→v9 meal swap and makeFormLunchOnly() — and
//      its first report stated that hypothesis as the CAUSE of every empty
//      response it found. It had checked no such thing. On the first real run
//      that heading collected 50 responses across three forms, and the
//      commonest cause turned out to be answerable without looking at a grid at
//      all: a form NO session row names, whose every response derives nothing
//      because there is no date to match against. classifyEmptyResponse_() is
//      what replaced the assertion — two cheap facts, three named states, and
//      no verdict where the evidence does not reach one.
//
//   2. A RESPONSE READ AGAINST THE WRONG DATES. The same function returns the
//      grid's rows from the LIVE item (`grid.getRows()`) and the answers as
//      SUBMITTED, and processFormResponse() zips them by index —
//      `values[rowIdx]`. Nothing keeps those aligned. The lunch grid's rows are
//      rebuilt from the session table and sorted by date, so a menu row typed
//      for an earlier date INSERTS in the middle and shifts every row below it:
//      answers land on the wrong date, and the tail runs off the end of
//      `values` and is silently not imported at all. A shape mismatch is the
//      one half of this that can be PROVED from here — a response whose answer
//      array is a different length than the grid it is being read against was
//      definitely submitted to a different grid. A reorder that kept the count
//      the same cannot be proved and is not claimed; see the report's wording.
//
// WHAT IT IS NOT. It does not repair anything, and it deliberately cannot. Its
// output is a list of people and sessions for somebody to look at, because the
// repair for fault 2 is a judgement about which date a person meant and this
// file has no standing to make it.
//
// ---------------------------------------------------------------------------
// THE READ-ONLY GUARANTEE, and why it needs code rather than a promise.
//
// Re-deriving rows means calling processFormResponse(), which is written for
// the live import and has three side effects that would be wrong here:
//
//   • buildRegistrantRow() MUTATES a matching existing row in place when the
//     Party_ID is the same. Answered by handing it an EMPTY existingRowIndex
//     and an EMPTY protectedKeys — every row is then derived fresh, which is
//     what the comparison needs anyway.
//   • processAllDatesResponse() calls saveAllDatesRegistryEntry(), which sets
//     __allDatesRegistryDirty. That is in-memory until somebody flushes, so
//     this file never calls flushPersistentRegistries() and restores the dirty
//     flags it found on the way out.
//   • buildRegistrantRow() calls clearRegistrantTombstones(), which writes to
//     Script Properties IMMEDIATELY. That is the one that cannot be handled by
//     not-flushing, so withReadOnlyRegistries_() swaps it for a recorder for
//     the duration. Every .gs file here shares one global scope and function
//     declarations are ordinary bindings in it, so this is the same mechanism
//     10_form_date_labels.gs already uses to set __formLabelFingerprintDirty.
//     Restored in a finally, including when a form throws.
//
// Nothing here is numbered or ordered in any load-bearing way: it is behavior
// only, its own two constants stand alone, its schema is HEADERS.All_Registrants
// in 03 like every other tab's, and everything it calls — buildRegistryIndex,
// processFormResponse, getSectionedRows, the tombstone readers — is a hoisted
// function declaration. It was 97 on its own branch until the merge that
// brought the render-batching file in under that number; the prefix is all
// that changed.
// ============================================================================

/**
 * How long one audit run may spend reading forms before it stops and says how
 * far it got. Apps Script's ceiling is six minutes; this leaves room for the
 * report to be built and drawn after the loop ends, because an audit that dies
 * mid-loop reports nothing at all and is therefore worse than one that reads
 * two thirds of the forms and says so.
 */
const REGISTRATION_AUDIT_BUDGET_MS = 4 * 60 * 1000;

/** How many findings of each kind the dialog lists before it says "and N more". */
const REGISTRATION_AUDIT_MAX_LISTED = 200;

/**
 * Runs `fn` with the two write paths reachable from processFormResponse()
 * neutralized, and restores them afterwards whatever happens.
 *
 * Returns { result, tombstonesWouldClear } — the second being the keys
 * buildRegistrantRow() tried to revive, which is a finding in its own right: a
 * registration somebody deleted on purpose that a re-read would put back.
 */
function withReadOnlyRegistries_(fn) {
  const realClear = clearRegistrantTombstones;
  const realTombstone = getRegistrantTombstone;
  const wouldClear = [];
  // Snapshotted so an in-memory registry write made during the derivation does
  // not leave the execution looking dirty to anything that flushes later.
  const dirtyBefore = {
    allDates: __allDatesRegistryDirty,
    form: __formRegistryDirty,
    labels: __formLabelFingerprintDirty
  };

  clearRegistrantTombstones = function (keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach(key => { if (key) wouldClear.push(key); });
    return 0; // nothing was cleared, so nothing is saved
  };

  // AND THE TOMBSTONE LOOKUP ITSELF, which is not about writing — it is about
  // being able to tell two findings apart. buildRegistrantRow() returns null
  // for a tombstoned row, so a response whose rows were ALL deliberately
  // deleted derives nothing and is indistinguishable, from outside, from a
  // response the parser could not read at all. The audit reported the first as
  // the second. Deriving every row and classifying it here — where the store
  // is read directly, and where `tombstonedSkips` already exists to say so —
  // is the only way those two answers stay apart.
  getRegistrantTombstone = function () { return null; };

  try {
    return { result: fn(), tombstonesWouldClear: wouldClear };
  } finally {
    clearRegistrantTombstones = realClear;
    getRegistrantTombstone = realTombstone;
    __allDatesRegistryDirty = dirtyBefore.allDates;
    __formRegistryDirty = dirtyBefore.form;
    __formLabelFingerprintDirty = dirtyBefore.labels;
  }
}

/**
 * The shape check for fault 2, on one response.
 *
 * Compares the length of each grid answer array against the number of rows the
 * LIVE grid carries. A difference is proof that this response was submitted to
 * a different grid than the one it is now being read against, which means
 * every `values[rowIdx]` lookup for it is against the wrong date.
 *
 * Returns [] when the form carries no grid, which is the ordinary case for an
 * appointment form and for a one-date form.
 */
function auditResponseGridShape_(formIndex, response) {
  const titles = [TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID, LEGACY_LUNCH_ONLY_GRID_TITLE,
    TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID, TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID,
    TEMPLATE_ITEM_TITLES.LUNCH_GRID];
  const findings = [];

  titles.forEach(title => {
    (formIndex.byTitle[title] || []).forEach(item => {
      const itemResponse = response.getResponseForItem(item);
      if (!itemResponse) return;
      const values = itemResponse.getResponse();
      if (!values || !Array.isArray(values)) return;
      const grid = item.getType() === FormApp.ItemType.GRID
        ? item.asGridItem() : item.asCheckboxGridItem();
      const liveRows = grid.getRows() || [];
      if (values.length === liveRows.length) return; // provably fine, or a reorder we cannot see
      findings.push({
        title,
        submittedRows: values.length,
        liveRows: liveRows.length
      });
    });
  });

  return findings;
}

/**
 * Which of a form's LIVE grid rows resolve to no session on the dashboard.
 *
 * Checked once per form rather than once per response, because it is a
 * property of the form: every response read against such a row is skipped by
 * processFormResponse() with the "No All_Program_Sessions match" note, so a row
 * that resolves to nothing is a row nobody on it is being imported from.
 *
 * Uses the same two calls the import does — resolveSessionLabelForForm() and
 * the `formId|label` key — so a row this reports is a row that really would be
 * refused, not one that merely looks odd.
 */
function auditFormGridRows_(formIndex, registryIndex) {
  const titles = [TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID, LEGACY_LUNCH_ONLY_GRID_TITLE,
    TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID, TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID,
    TEMPLATE_ITEM_TITLES.LUNCH_GRID];
  const formId = formIndex.formId;
  const unmatched = [];
  const seen = {};

  titles.forEach(title => {
    (formIndex.byTitle[title] || []).forEach(item => {
      const grid = item.getType() === FormApp.ItemType.GRID
        ? item.asGridItem() : item.asCheckboxGridItem();
      (grid.getRows() || []).forEach(label => {
        if (seen[label]) return;
        seen[label] = true;
        // The placeholder a freshly added grid carries before its labels are
        // written is not a fault — it is a form waiting for the next sync.
        if (!label || label.indexOf('automatically') !== -1) return;
        const plain = resolveSessionLabelForForm(registryIndex, formId, label);
        if (plain && registryIndex[`${formId}|${plain}`]) return;
        unmatched.push({ formId, label: String(label), title });
      });
    });
  });

  return unmatched;
}

/**
 * WHY a response derived no rows — asked of the response rather than assumed.
 *
 * The first version of this file did not ask. It put every empty response under
 * one heading and told the reader they were the v8→v9 meal swap and the
 * lunch-only reshaping, which was the hypothesis the file was written from and
 * not something it had checked. On the first real run that heading collected 50
 * responses across three forms, and the causes below are not the same fault and
 * do not have the same fix — so the report names what it can see and stops.
 *
 * Three states, told apart by two cheap facts:
 *
 *   noSessions      — the dashboard has NO session row naming this form, so
 *                     every response on it derives nothing whatever it says.
 *                     Nothing to do with grids; this is the fault
 *                     reportUnimportedForms() (99) exists for, and the fix is
 *                     to repoint the rows and mark the form for re-import.
 *   unreadable      — the response answered NOTHING the form still carries.
 *                     getItemResponses() returns answers for items that are
 *                     still there, so a zero here means the items this was
 *                     submitted against are gone — a rebuilt form (49), or a
 *                     question deleted and replaced. It can also just be a
 *                     blank submission, which is why the count of answers is
 *                     reported rather than a conclusion.
 *   answeredNoRows  — it answered N questions the form still has and STILL
 *                     produced no row. That is the parser, and it is the one
 *                     worth reading a response by hand over.
 */
function classifyEmptyResponse_(response, sessionsOnForm) {
  if (sessionsOnForm === 0) return { kind: 'noSessions', answers: null };
  let answers = 0;
  try {
    answers = (response.getItemResponses() || []).length;
  } catch (err) {
    return { kind: 'unreadable', answers: 0 };
  }
  return { kind: answers === 0 ? 'unreadable' : 'answeredNoRows', answers };
}

/**
 * Reads every response this workbook's forms hold, re-derives the registrant
 * rows they should produce, and compares that against what is actually on
 * All_Registrants.
 *
 * options.formIds  — audit only these forms (run from the Apps Script editor
 *                    to narrow a second pass after a bounded first one).
 * options.since    — a Date; only responses submitted after it. Omitted means
 *                    every response the forms still hold.
 *
 * Returns the finding object describeRegistrationAudit_() renders.
 */
function auditRegistrationImport(options) {
  options = options || {};
  const startedAt = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!registrySheet || !registrantsSheet) {
    log('auditRegistrationImport: no session table or registrant tab yet — nothing to audit.');
    return null;
  }

  const map = getIndexMap(HEADERS.All_Registrants);
  const existingRows = getSectionedRows(registrantsSheet, HEADERS.All_Registrants, 'Event_ID');
  // The keys the import itself matches on (Event_ID|name|Person_Type), so a
  // derived row is judged present or absent by exactly the rule that would
  // have written it. Superseded and cancelled rows COUNT as present: they are
  // a record that the registration was seen, which is the question here.
  const present = new Set(existingRows.map(row => registrantImportKey(row, map)));
  const registryIndex = buildRegistryIndex(registrySheet);
  const orderAheadDays = getOrderAheadDays();
  const tombstones = getRegistrantTombstones();

  const formIds = options.formIds && options.formIds.length > 0
    ? options.formIds.slice()
    : getDistinctFormIds(registrySheet);

  const finding = {
    formsExamined: 0,
    formsUnread: [],
    formsNotReached: [],
    responsesRead: 0,
    emptyResponses: [],     // fault 1 — read as nothing at all
    shapeMismatches: [],    // fault 2 — proved misaligned
    unmatchedRows: [],      // a grid row resolving to no session
    missingPeople: [],      // derived, not on the tab, not tombstoned
    tombstonedSkips: 0,     // derived, not on the tab, but deliberately deleted
    stoppedEarly: false
  };

  const audited = withReadOnlyRegistries_(() => {
    formIds.forEach((formId, idx) => {
      if (Date.now() - startedAt > REGISTRATION_AUDIT_BUDGET_MS) {
        if (!finding.stoppedEarly) finding.stoppedEarly = true;
        finding.formsNotReached.push(formId);
        return;
      }
      try {
        const form = openFormCached(formId);
        const responses = options.since ? form.getResponses(options.since) : form.getResponses();
        if (responses.length === 0) { finding.formsExamined++; return; }
        const formIndex = getFormItemIndex(form);
        finding.formsExamined++;
        auditFormGridRows_(formIndex, registryIndex)
          .forEach(row => finding.unmatchedRows.push(row));
        // Counted ONCE per form, not once per response: it is a fact about the
        // dashboard, and it is what tells a parser fault from a form no session
        // row names at all.
        const sessionsOnForm = Object.keys(registryIndex)
          .filter(k => k.indexOf(`${formId}|`) === 0).length;

        responses.forEach(response => {
          finding.responsesRead++;
          const who = String(getResponseValueByTitle(formIndex, response,
            TEMPLATE_ITEM_TITLES.NAME) || '(no name given)').trim();
          const when = response.getTimestamp();

          auditResponseGridShape_(formIndex, response).forEach(shape => {
            finding.shapeMismatches.push({
              formId, name: who, submittedAt: when,
              title: shape.title, submittedRows: shape.submittedRows, liveRows: shape.liveRows
            });
          });

          // EMPTY existingRowIndex and protectedKeys on purpose — see the
          // banner. A throwaway collectors object for the same reason: the
          // club joins and appointment requests gathered here are discarded
          // with it rather than being written anywhere.
          let derived = [];
          try {
            derived = processFormResponse(formIndex, response, registryIndex, new Set(),
              new Map(), orderAheadDays, { clubJoins: [], assistanceRequests: [] }) || [];
          } catch (err) {
            log(`auditRegistrationImport: could not re-derive a response on ${formId} (${err}).`);
            return;
          }

          if (derived.length === 0) {
            const why = classifyEmptyResponse_(response, sessionsOnForm);
            finding.emptyResponses.push({
              formId, name: who, submittedAt: when,
              kind: why.kind, answers: why.answers, sessionsOnForm
            });
            return;
          }

          derived.forEach(row => {
            const key = registrantImportKey(row, map);
            if (present.has(key)) return;
            if (tombstones[key]) { finding.tombstonedSkips++; return; }
            finding.missingPeople.push({
              formId,
              name: String(row[map['Name']] || ''),
              personType: String(row[map['Person_Type']] || ''),
              eventDate: coerceDate(row[map['Event_Date']]),
              location: String(row[map['Location']] || ''),
              event: String(row[map['Event']] || ''),
              submittedAt: when
            });
          });
        });
      } catch (err) {
        log(`auditRegistrationImport: could not read form ${formId} (${err}).`);
        finding.formsUnread.push({ formId, error: String(err) });
      }
    });
    return finding;
  });

  finding.tombstonesWouldRevive = audited.tombstonesWouldClear.length;
  finding.elapsedMs = Date.now() - startedAt;
  return finding;
}

/** One line for a person the import should have written and did not. */
function describeMissingPerson_(entry) {
  const date = entry.eventDate
    ? Utilities.formatDate(entry.eventDate, TIMEZONE, 'EEE d MMM yyyy')
    : '(no date)';
  const submitted = entry.submittedAt
    ? Utilities.formatDate(entry.submittedAt, TIMEZONE, 'd MMM yyyy')
    : '(unknown)';
  const who = entry.personType && entry.personType !== 'Attendee'
    ? `${entry.name} (${entry.personType})`
    : entry.name;
  return `  • ${who} — ${date}, ${entry.location || '(no location)'}` +
    `${entry.event ? ` — ${entry.event}` : ''} · submitted ${submitted}`;
}

/** A capped list, with an honest tail when there is more than the cap. */
function describeCappedList_(lines) {
  if (lines.length <= REGISTRATION_AUDIT_MAX_LISTED) return lines.join('\n');
  return lines.slice(0, REGISTRATION_AUDIT_MAX_LISTED).join('\n') +
    `\n  … and ${lines.length - REGISTRATION_AUDIT_MAX_LISTED} more (the whole list is in the execution log).`;
}

/**
 * The report, in the order somebody reading it needs it: what is missing
 * first, then why, then what could not be looked at.
 */
function describeRegistrationAudit_(finding) {
  if (!finding) return 'No session table or registrant tab yet — nothing to audit.';

  const parts = [];
  parts.push(`Read ${finding.responsesRead} response(s) across ${finding.formsExamined} form(s) ` +
    `in ${Math.round(finding.elapsedMs / 1000)}s. NOTHING WAS CHANGED.`);

  if (finding.missingPeople.length === 0) {
    parts.push('\n✅ Every response re-derives to a row that is already on All_Registrants.');
  } else {
    parts.push(`\n❗ ${finding.missingPeople.length} registration(s) that these responses should produce ` +
      `are NOT on All_Registrants:\n` +
      describeCappedList_(finding.missingPeople
        .slice()
        .sort((a, b) => (a.eventDate || 0) - (b.eventDate || 0))
        .map(describeMissingPerson_)));
  }

  if (finding.emptyResponses.length > 0) {
    // GROUPED BY FORM AND BY CAUSE, because on a real workbook these cluster:
    // the first run of this audit found 50 of them on three forms, and a flat
    // list of fifty names says far less than "this form has no session rows".
    const byKind = { noSessions: {}, unreadable: {}, answeredNoRows: {} };
    finding.emptyResponses.forEach(e => {
      const bucket = byKind[e.kind] || byKind.unreadable;
      if (!bucket[e.formId]) bucket[e.formId] = [];
      bucket[e.formId].push(e);
    });
    const formLines = bucket => Object.keys(bucket).map(formId =>
      `  • form ${formId} — ${bucket[formId].length} response(s)`);

    parts.push(`\n⚠️ ${finding.emptyResponses.length} response(s) produced NO registrant row. ` +
      `Three different reasons, which do not have the same fix:`);

    if (Object.keys(byKind.noSessions).length > 0) {
      parts.push(`\n  NO SESSION ROW NAMES THIS FORM. Every response on it derives nothing, ` +
        `whatever it says — the grid is not involved. This is what "Find Forms Nothing Is ` +
        `Importing" reports; the fix is to repoint the sessions at the form and mark it for ` +
        `re-import, which collects the responses that are behind the sync clock.\n` +
        describeCappedList_(formLines(byKind.noSessions)));
    }
    if (Object.keys(byKind.unreadable).length > 0) {
      parts.push(`\n  ANSWERED NOTHING THE FORM STILL CARRIES. The questions these were ` +
        `submitted against are no longer on the form, so no row can be derived from them — ` +
        `a rebuilt form, or a question deleted and replaced. A genuinely blank submission ` +
        `looks identical from here, so this is a place to LOOK rather than a verdict:\n` +
        describeCappedList_(formLines(byKind.unreadable)));
    }
    if (Object.keys(byKind.answeredNoRows).length > 0) {
      parts.push(`\n  ANSWERED THE FORM AND STILL PRODUCED NOTHING. These answered questions ` +
        `the form still has, so the parser read them and made no row. This is the set worth ` +
        `opening one of by hand:\n` +
        describeCappedList_(finding.emptyResponses
          .filter(e => e.kind === 'answeredNoRows')
          .map(e => `  • ${e.name} — answered ${e.answers} question(s) · form ${e.formId}`)));
    }
  }

  if (finding.shapeMismatches.length > 0) {
    parts.push(`\n⚠️ ${finding.shapeMismatches.length} response(s) were submitted against a grid of a ` +
      `DIFFERENT SIZE than the one they are now read against, so their answers are being matched to the ` +
      `wrong dates (and any answer past the end of the current grid is dropped):\n` +
      describeCappedList_(finding.shapeMismatches.map(s =>
        `  • ${s.name} — "${s.title}": answered ${s.submittedRows} row(s), the form now has ` +
        `${s.liveRows} · form ${s.formId}`)) +
      `\n  A response whose grid was REORDERED but kept the same number of rows is misread in the same ` +
      `way and cannot be detected from here — so treat this count as a floor, not a total.`);
  }

  if (finding.unmatchedRows.length > 0) {
    parts.push(`\n⚠️ ${finding.unmatchedRows.length} date row(s) on a live form resolve to no session ` +
      `on the dashboard — anybody who ticks one of these is refused by the import:\n` +
      describeCappedList_(finding.unmatchedRows.map(r =>
        `  • "${r.label}" — form ${r.formId}`)));
  }

  if (finding.tombstonedSkips > 0) {
    parts.push(`\nℹ️ ${finding.tombstonedSkips} derived row(s) are absent because somebody deleted them ` +
      `on purpose. Those are correct and are not counted above.`);
  }
  if (finding.tombstonesWouldRevive > 0) {
    parts.push(`ℹ️ ${finding.tombstonesWouldRevive} deleted registration(s) would have been revived by a ` +
      `real import of these responses. This audit did not revive them.`);
  }

  if (finding.formsUnread.length > 0) {
    parts.push(`\n⚠️ ${finding.formsUnread.length} form(s) could not be read:\n` +
      finding.formsUnread.map(f => `  • ${f.formId} — ${f.error}`).join('\n'));
  }
  if (finding.stoppedEarly) {
    parts.push(`\n⏱️ Stopped after ${Math.round(finding.elapsedMs / 1000)}s with ` +
      `${finding.formsNotReached.length} form(s) not yet looked at. Run it again to carry on, or narrow ` +
      `it from the Apps Script editor with auditRegistrationImport({ formIds: [...] }).`);
  }

  return parts.join('\n');
}

/**
 * Menu entry: 🔧 Admin ▸ 📄 Reports ▸ "Find Missing Registrations (read-only report)".
 *
 * Ungated like the other two reports there, and for the same reason: it only
 * looks. The person who noticed the missing name is the person who should be
 * able to press this.
 */
function reportMissingRegistrations() {
  toastIfPossible('Reading every form’s responses — this can take a few minutes.');
  const finding = auditRegistrationImport();
  const report = describeRegistrationAudit_(finding);
  log(report);

  try {
    const ui = SpreadsheetApp.getUi();
    // A <pre> in a modal rather than ui.alert(): the useful output here is a
    // list of names somebody needs to COPY, and an alert is neither scrollable
    // nor selectable. Escaped, per the standing rule about anything served to
    // a browser — a member named O'Brien must not end the page.
    const html = HtmlService.createHtmlOutput(
      `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:12px">` +
      `<pre style="white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtmlForDialog(report)}</pre>` +
      `</div>`)
      .setWidth(720).setHeight(560);
    ui.showModalDialog(html, 'Missing Registrations (read-only)');
  } catch (err) {
    toastIfPossible(`${(finding && finding.missingPeople.length) || 0} missing registration(s) — see the log.`);
  }
  return finding;
}
