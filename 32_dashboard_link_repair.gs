// ============================================================================
// REPAIRING A DASHBOARD WHOSE LINK COLUMNS SLID OFF THEIR ROWS
// ============================================================================
//
// WHY A NORMAL REBUILD CANNOT DO THIS. Every "rebuild" in this file — the
// layout rebuild, the dashboard render, the sync — reads the session table,
// sorts it, and writes it back. That is exactly right when the rows are
// correct and exactly useless when they are not: a shifted link column is READ
// shifted and WRITTEN shifted, so the repair launders the corruption into a
// freshly formatted tab and the tab now looks deliberate. Rendering harder does
// not help. The values have to come from somewhere that is not those cells.
//
// WHERE THEY COME FROM INSTEAD. Three columns can be re-derived from facts that
// live somewhere other than the cell being fixed:
//
//   Form_ID              from the persistent groupKey -> Form_ID registry in
//                        Script Properties, looked up by the row's OWN
//                        identity (calendar + title + span).
//   Form_Response_Link   from that form's published URL.
//   Edit_Form_Link       from that form's edit URL.
//
// Nothing here reads a calendar. A form is opened only to learn its published
// URL, once per DISTINCT form rather than once per row.
//
// IT USED TO SKIP EVEN THAT, harvesting a form's published URL out of the
// =HYPERLINK() already sitting on some correctly-aligned row — zero API calls
// beyond the sheet, and wrong in a way that took a fortnight to see. The
// self-check proves a row's IDENTITY columns are consistent; it says nothing
// about whether the URL in that row's link cell belongs to the Form_ID beside
// it. So one row carrying a mismatched live link seeded the cache for that
// form, and the repair then wrote that same wrong URL across every other row
// of it — while writing a perfectly correct edit link, because an edit URL is
// reconstructed from the form ID and a published URL cannot be. A dashboard
// whose "Edit Form Settings" all work and whose "View Live Form" all lead
// somewhere else is the exact signature of that, and the cache made the
// "already right" test agree with itself: harvested URL compared against
// harvested URL is equal by construction, so nothing was ever reported.
//
// A published URL is now only ever read from the FORM. Opening one form per
// distinct form on the tab is the price of the answer being true.
//
// HOW A SHIFTED ROW IS RECOGNIZED WITH NO NETWORK AT ALL. Event_ID is a pure
// function of three other columns on the same row — computeEventId(
// Calendar_Source, Clean_Title, dateKey) — so a row can be checked against
// itself. If the recomputation matches, that row's identity columns are intact
// and can be trusted to name the right form. If it does not, the row's identity
// has moved too, this repair says so and REFUSES TO GUESS: writing a link
// derived from a title that belongs to a different session would turn a visible
// problem into an invisible one.
// ============================================================================

/**
 * The identity columns a repair needs, read off one row, plus whether the row
 * vouches for itself.
 *
 * `aligned` is the Event_ID self-check described above. A lunch-only row is
 * checked against its own id shape (makeLunchOnlyEventId) rather than the
 * calendar-derived digest, since it never came from a calendar.
 */
function readSessionRowIdentity(values, r) {
  const at = name => (values[name] ? values[name][r][0] : '');
  const date = coerceDate(at('Event_Date'));
  const eventId = String(at('Event_ID') || '').trim();
  const source = String(at('Calendar_Source') || '').trim();
  const title = String(at('Clean_Title') || '').trim();
  const location = String(at('Location') || '').trim();
  const identity = {
    date,
    eventId,
    source,
    title,
    location,
    typeTag: at('Type_Tag'),
    formId: String(at('Form_ID') || '').trim(),
    link: String(at('Form_Response_Link') || '').trim(),
    isLunchOnly: isLunchOnlyEventId(eventId),
    aligned: false
  };
  if (!date || !eventId) return identity;
  identity.aligned = identity.isLunchOnly
    ? eventId === makeLunchOnlyEventId(formatDateKey(date), location)
    : eventId === computeEventId(source, title, formatDateKey(date));
  return identity;
}

/**
 * The registry key naming the form this row SHOULD be on, derived only from
 * the row's own identity columns.
 *
 * Returns '' for a row whose identity is incomplete — the caller treats that
 * as "cannot be repaired from here" rather than as a miss.
 */
function registryKeyForSessionRow(identity) {
  if (!identity.date) return '';
  if (identity.isLunchOnly) {
    return lunchOnlyGroupKey(identity.location, getMonthLabel(identity.date));
  }
  if (!identity.source || !identity.title) return '';
  return `${identity.source}::${identity.title}::${formSpanForRow(identity.typeTag, identity.date)}`;
}

/**
 * WHY one row's links need rewriting, or '' when they do not — the whole
 * decision, with no sheet and no Drive in it.
 *
 * FOUR FAULTS, NOT ONE, because they are four different things to tell
 * somebody and they do not happen together:
 *
 *   wrongForm      the row names a different form from the one the registry
 *                  says this session belongs on. Both links are wrong.
 *   staleLiveLink  the row names the RIGHT form, and its "View Live Form"
 *                  goes somewhere else. This is the one that hides: a
 *                  published URL (/forms/d/e/<published id>/viewform) is a
 *                  separate identifier from the file ID, so it cannot be
 *                  checked by looking at the form ID beside it, and the edit
 *                  link — which IS built from the file ID — stays perfectly
 *                  correct while it is wrong. "Every Edit Form Settings works
 *                  and every View Live Form does not" is this fault, and only
 *                  this one.
 *   staleEditLink  the mirror image, and much rarer: an edit URL that does not
 *                  match the form ID beside it.
 *   missingLink    the row has a form but an empty link cell — what
 *                  handleUnreachableGroupForm() leaves behind on purpose, to
 *                  be filled in once the form can be opened again.
 *
 * A row deliberately marked [No Registration] never reaches here (see the
 * caller); an empty cell on a row that HAS a form is a gap, not a statement.
 */
function diagnoseRowLinkFault(id, wantedFormId, urls) {
  if (id.formId !== wantedFormId) return 'wrongForm';
  if (!id.viewHref || !id.editHref) return 'missingLink';
  if (id.viewHref !== urls.publishedUrl) return 'staleLiveLink';
  if (id.editHref !== urls.editUrl) return 'staleEditLink';
  return '';
}

/**
 * Works out, per row, which form it belongs on and what its two links should
 * say — WITHOUT reading a calendar and without rebuilding anything.
 *
 * Returns { plan, stats }. `plan` is one entry per row that needs a write;
 * `stats` is what the confirmation dialog reports. Pure inspection: this
 * function writes nothing.
 */
function planDashboardLinkRepair(registrySheet) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  // The four REASONS a row needs a write are counted apart from each other:
  // they are four different faults with four different explanations, and the
  // Doctor reports them as such (see buildDoctorFindings()).
  const stats = { scanned: 0, misaligned: 0, noKey: 0, noForm: 0, alreadyRight: 0,
    blocked: 0, formsOpened: 0, willFix: 0,
    wrongForm: 0, staleLiveLink: 0, staleEditLink: 0, missingLink: 0 };
  if (headerRows.length === 0) return { plan: [], stats };
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  const needed = ['Event_Date', 'Event_ID', 'Calendar_Source', 'Clean_Title', 'Location',
    'Type_Tag', 'Form_ID', 'Form_Response_Link', 'Edit_Form_Link'];
  if (needed.some(h => !sheetMap[h])) return { plan: [], stats };

  const registry = getPersistentFormRegistry();
  const shared = getSharedFormIdSet();
  const plan = [];
  // formId -> { publishedUrl, editUrl } | null, read from the FORM and
  // memoized for the run. Never seeded from the cells being repaired — see the
  // section comment above for the fortnight that cost.
  const urlByFormId = {};
  const rowsToResolve = [];

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;
    const values = {};
    needed.forEach(h => {
      values[h] = registrySheet.getRange(zone.start, sheetMap[h], zone.count, 1).getValues();
    });
    // The link columns are read as FORMULAS as well as values: the URL a cell
    // actually points at is the thing being judged, and getValues() flattens a
    // =HYPERLINK() to its label ("View Live Form"), which every row has whether
    // its link is right or not.
    const viewFormulas = registrySheet
      .getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1).getFormulas();
    const editFormulas = registrySheet
      .getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1).getFormulas();
    const hrefOf = formula => {
      const m = /HYPERLINK\("([^"]+)"/.exec(formula || '');
      return m ? m[1] : '';
    };

    for (let r = 0; r < zone.count; r++) {
      const id = readSessionRowIdentity(values, r);
      if (!id.date) continue;
      stats.scanned++;
      id.row = zone.start + r;
      id.key = registryKeyForSessionRow(id);

      // A row whose links were deliberately taken away by [No Registration]
      // is not misaligned — it is saying what it is meant to say.
      if (id.link === NO_REGISTRATION_LINK_LABEL) { stats.blocked++; continue; }

      if (!id.aligned) { stats.misaligned++; continue; }

      // ALIGNED, so its own Form_ID is trustworthy. What its two cells POINT
      // AT is carried alongside, because that — not the label — is what the
      // comparison below is about.
      id.viewHref = hrefOf(viewFormulas[r][0]);
      id.editHref = hrefOf(editFormulas[r][0]);
      if (!id.key) { stats.noKey++; continue; }
      rowsToResolve.push(id);
    }
  });

  // WHICH FORM EACH ROW BELONGS ON. The registry is the authority; where it has
  // no entry (a workbook that lost its Script Properties), the aligned rows of
  // the same group vote, which is the same recovery findExistingFormIdFromEvents()
  // makes from calendar descriptions — minus the calendar.
  const votesByKey = {};
  rowsToResolve.forEach(id => {
    if (!id.formId) return;
    if (!votesByKey[id.key]) votesByKey[id.key] = {};
    votesByKey[id.key][id.formId] = (votesByKey[id.key][id.formId] || 0) + 1;
  });
  const majority = key => {
    const v = votesByKey[key] || {};
    return Object.keys(v).sort((a, b) => v[b] - v[a])[0] || '';
  };

  rowsToResolve.forEach(id => {
    const wantedFormId = registry[id.key] || majority(id.key);
    if (!wantedFormId) { stats.noForm++; return; }
    let urls = urlByFormId[wantedFormId];
    if (!urls) {
      try {
        const form = openFormCached(wantedFormId);
        urls = { publishedUrl: buildRegistrationUrl(form), editUrl: form.getEditUrl() };
        stats.formsOpened++;
      } catch (err) {
        log(`Repair links: could not open form ${wantedFormId} for "${id.title}" (${err}).`);
        urls = null;
      }
      urlByFormId[wantedFormId] = urls;
    }
    if (!urls) { stats.noForm++; return; }

    const wantedView = makeHyperlinkFormula(urls.publishedUrl, 'View Live Form');
    const wantedEdit = makeHyperlinkFormula(urls.editUrl, 'Edit Form Settings');
    const reason = diagnoseRowLinkFault(id, wantedFormId, urls);
    if (!reason) {
      stats.alreadyRight++;
      return;
    }
    stats.willFix++;
    stats[reason]++;
    plan.push({ row: id.row, title: id.title, dateKey: formatDateKey(id.date),
      wasFormId: id.formId, formId: wantedFormId, view: wantedView, edit: wantedEdit,
      reason, shared: shared.has(wantedFormId) });
  });

  return { plan, stats, sheetMap };
}

/**
 * Writes a repair plan onto the tab. Returns how many rows were written.
 *
 * WRITTEN CELL BY CELL, per planned row. Deliberately not a column write: a
 * whole-column setValues() is the shape of operation that produced this mess
 * in the first place, and the rows NOT in the plan must not be rewritten even
 * with their own current values.
 */
function applyDashboardLinkPlan(registrySheet, plan) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]);
  let fixed = 0;
  plan.forEach(p => {
    try {
      registrySheet.getRange(p.row, sheetMap['Form_ID']).setValue(p.formId);
      registrySheet.getRange(p.row, sheetMap['Form_Response_Link']).setFormula(p.view);
      registrySheet.getRange(p.row, sheetMap['Edit_Form_Link']).setFormula(p.edit);
      invalidateSectionedRowsCache(registrySheet);
      fixed++;
    } catch (err) {
      log(`Repair dashboard links: row ${p.row} could not be written (${err}).`);
    }
  });
  return fixed;
}

/**
 * ADMIN ACTION — "Repair Dashboard Links (no calendar read)".
 *
 * Rewrites Form_ID and both link columns on Program_Sessions from the
 * form registry, row by row, touching nothing else on the tab and reading no
 * calendar. See the section comment above for why the ordinary rebuild cannot
 * do this and what makes this safe.
 *
 * Reports before it writes, and refuses to guess on any row whose own identity
 * columns disagree with its Event_ID.
 */
function repairDashboardLinks() {
  if (!requireAuthorizedAdmin('Repair Dashboard Links')) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — nothing to repair.');
    return null;
  }

  const { plan, stats } = planDashboardLinkRepair(registrySheet);
  log(`Repair Dashboard Links: scanned ${stats.scanned} row(s) — ${stats.willFix} to fix, ` +
    `${stats.alreadyRight} already right, ${stats.misaligned} with a broken Event_ID, ` +
    `${stats.blocked} marked "${NO_REGISTRATION_LINK_LABEL}", ${stats.noForm} with no form to point at ` +
    `(${stats.formsOpened} form(s) opened).`);

  if (stats.willFix === 0) {
    const message = stats.misaligned > 0
      ? `No link needed fixing, but ${stats.misaligned} row(s) have an Event_ID that does not match their ` +
        `own date/title/calendar. Those rows are shifted in their IDENTITY columns, which this repair will ` +
        `not guess at — they need "Sync Cal only" to rebuild them from the calendar.`
      : 'Every link on the dashboard already matches the form registry ✅ — nothing to repair.';
    toastIfPossible(message);
    return { fixed: 0, stats };
  }

  const sample = plan.slice(0, 5)
    .map(p => `  row ${p.row}: ${p.dateKey} ${p.title || '(untitled)'} → form ${p.formId.substring(0, 8)}…`)
    .join('\n');
  if (!confirmConsequentialAction(`Repair ${stats.willFix} dashboard link(s)?`,
    `Rewrites Form_ID, "View Live Form" and "Edit Form Settings" on ${stats.willFix} row(s) of ` +
    `${SHEET_NAMES.PROGRAM_DASHBOARD}, taking each row's form from the form registry rather than from the ` +
    `cells being replaced.\n\n` +
    `NO calendar is read and NO form is rebuilt — every registration link stays the link it is, and every ` +
    `response already collected is untouched. ${stats.formsOpened} form(s) were opened just to read their ` +
    `address.\n\n` +
    `First ${Math.min(5, plan.length)} of ${plan.length}:\n${sample}\n\n` +
    (stats.misaligned > 0
      ? `SKIPPED: ${stats.misaligned} row(s) whose Event_ID disagrees with their own date/title/calendar. ` +
        `Their identity columns are shifted too, so nothing here can name their form safely — run ` +
        `"Sync Cal only" to rebuild those from the calendar.\n\n`
      : '') +
    `Nothing else on the tab is touched: no counts, no dates, no ticks, no formatting.`,
    false)) {
    return null;
  }

  const fixed = applyDashboardLinkPlan(registrySheet, plan);

  log(`Repair Dashboard Links: rewrote ${fixed} row(s).`);
  toastIfPossible(`Repaired ${fixed} dashboard link(s) ✅` +
    (stats.misaligned > 0 ? ` — ${stats.misaligned} shifted row(s) skipped, see the log.` : ''));
  return { fixed, stats };
}

/**
 * ADMIN ACTION — "Check Dashboard Alignment (read-only)".
 *
 * The diagnosis on its own, changing nothing: how many session rows vouch for
 * themselves, how many links disagree with the registry, and how many rows
 * have slid far enough that their Event_ID no longer matches their own date,
 * title and calendar.
 *
 * Worth having separately from the repair because the first question anybody
 * asks about a tab that looks wrong is "how wrong, and where" — and the honest
 * answer to that must not require agreeing to a write first.
 */
function checkDashboardAlignment() {
  if (!requireAuthorizedAdmin('Check Dashboard Alignment')) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — nothing to check.');
    return null;
  }
  const { stats } = planDashboardLinkRepair(registrySheet);
  const lines = [
    `${stats.scanned} session row(s) checked.`,
    ``,
    `${stats.alreadyRight} link(s) already correct.`,
    `${stats.willFix} link(s) point at the wrong form, or at none — "Repair Dashboard Links" fixes these ` +
      `without reading a calendar.`,
    `${stats.blocked} row(s) deliberately say "${NO_REGISTRATION_LINK_LABEL}" and are left alone.`,
    `${stats.noForm} row(s) have no form in the registry to point at.`,
    ``,
    `${stats.misaligned} row(s) FAIL the self-check: their Event_ID does not match the date, title and ` +
      `calendar on the same row, so the identity columns themselves have shifted. No repair can name their ` +
      `form safely — rebuild those from the calendar with "Sync Cal only".`
  ];
  const report = lines.join('\n');
  log(`Check Dashboard Alignment:\n${report}`);
  try {
    SpreadsheetApp.getUi().alert('Dashboard alignment', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    toastIfPossible(`${stats.willFix} link(s) repairable, ${stats.misaligned} row(s) shifted — see the log.`);
  }
  return stats;
}


/**
 * THE DISAGREEMENT NOTHING WAS WATCHING FOR.
 *
 * A session's form is written in two places that are updated by different
 * code, on different occasions: the dashboard's Form_ID column, and the
 * registration link inside the calendar event's description. They are supposed
 * to name the same form, and for most of this system's life they did.
 *
 * They come apart whenever a group's form changes without its calendar events
 * being rewritten — the old rebuild-on-a-caught-exception did exactly that (see
 * handleUnreachableGroupForm(), which is why it no longer exists), and so does
 * any hand edit that repoints one side. Once they have, NOTHING SAYS SO. Both
 * sides look perfectly healthy on their own: the dashboard's link opens a form,
 * the event's link opens a form, and only somebody who checks one against the
 * other finds that a resident reading the calendar and a member of staff
 * reading the dashboard are being sent to two different sign-up pages — with
 * the registrations splitting between them.
 *
 * That is what took a week to notice, and the reason it took a week is that
 * this comparison had never been written down anywhere. It is cheap: both
 * sides are already read, by the two functions this borrows from.
 *
 * READ-ONLY, and paired with a fix that already exists — "🔗 Rewrite Event
 * Links" rewrites every event description from the dashboard, which is exactly
 * the repair for every row this reports. Kept separate from that for the same
 * reason "Check Dashboard Alignment" is kept separate from the repair beside
 * it: the first question anybody asks about a link that looks wrong is "how
 * many, and which", and answering it must not require agreeing to a write.
 */

/** What one event's description says about its form, against what the sheet says. */
function compareEventLinkToSession(found, session) {
  if (!session || !session.formId) return 'noSession';
  if (!found || !found.formId) return 'noLink';
  return found.formId === session.formId ? 'agrees' : 'disagrees';
}

/**
 * Every upcoming event whose description names a different form from the
 * dashboard row for the same session. Reads both sides, writes neither.
 */
function planEventLinkDrift(registrySheet) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const stats = { scanned: 0, agrees: 0, disagrees: 0, noLink: 0, noSession: 0 };
  const drift = [];

  const sessionByEventId = {};
  getSectionedRows(registrySheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const d = coerceDate(row[map['Event_Date']]);
    if (!eventId || !d || formatDateKey(d) < todayKey) return;
    sessionByEventId[eventId] = {
      formId: String(row[map['Form_ID']] || '').trim(),
      // A row deliberately marked [No Registration] is not in disagreement
      // with an event that carries no link — it is agreeing with it.
      blocked: String(row[map['Form_Response_Link']] || '').trim() === NO_REGISTRATION_LINK_LABEL,
      cleanTitle: String(row[map['Clean_Title']] || '').trim()
    };
  });

  const { start, end } = computeSyncDateRange();
  const windowStart = parseDateKey(todayKey);
  const eventsByCalendar = getCalendarEventsForWindow(start, end);

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) return;
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const startTime = ev.getStartTime();
      if (startTime < windowStart) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed) return;
      const dateKey = formatDateKey(startTime);
      const session = sessionByEventId[computeEventId(calendarId, parsed.cleanTitle, dateKey)];
      if (session && session.blocked) return;

      stats.scanned++;
      const found = findRegistrationLineInDescription(ev.getDescription() || '');
      const verdict = compareEventLinkToSession(found, session);
      stats[verdict]++;
      if (verdict === 'disagrees') {
        drift.push({ dateKey, title: parsed.cleanTitle, location: CALENDAR_MAP[calendarId],
          eventFormId: found.formId, sheetFormId: session.formId });
      }
    });
  });

  drift.sort((a, b) => (a.dateKey + a.title).localeCompare(b.dateKey + b.title));
  return { stats, drift };
}

/**
 * ADMIN ACTION — "Check Event Links vs the Dashboard (read-only)".
 */
function checkEventLinksAgainstDashboard() {
  if (!requireAuthorizedAdmin('Check Event Links vs the Dashboard')) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — nothing to compare.');
    return null;
  }

  toastIfPossible('Reading every upcoming event and comparing its link…');
  const { stats, drift } = planEventLinkDrift(registrySheet);

  const byProgram = {};
  drift.forEach(d => {
    const key = `${d.title} (${d.location})`;
    if (!byProgram[key]) byProgram[key] = { dates: [], eventFormId: d.eventFormId, sheetFormId: d.sheetFormId };
    byProgram[key].dates.push(d.dateKey);
  });
  const names = Object.keys(byProgram).sort();
  const sample = names.slice(0, 8).map(name => {
    const p = byProgram[name];
    return `• ${name} — ${p.dates.length} date(s): the calendar says form ${p.eventFormId.substring(0, 8)}…, ` +
      `the dashboard says ${p.sheetFormId.substring(0, 8)}…`;
  }).join('\n');

  const lines = [
    `${stats.scanned} upcoming event(s) checked against the session table.`,
    ``,
    `${stats.agrees} event(s) carry the same form the dashboard does ✅`,
    `${stats.disagrees} event(s) name a DIFFERENT form from the dashboard` +
      (names.length > 0 ? ` — ${names.length} program(s):` : '.'),
    names.length > 0 ? sample + (names.length > 8 ? `\n…and ${names.length - 8} more` : '') : '',
    ``,
    `${stats.noLink} event(s) carry no registration link at all.`,
    `${stats.noSession} event(s) have no session row with a form on the dashboard.`,
    ``,
    stats.disagrees > 0
      ? `A disagreement means residents reading the calendar and staff reading the dashboard are being sent ` +
        `to two different sign-up pages, and the registrations are splitting between them. "🔗 Rewrite Event ` +
        `Links" rewrites every event description from the dashboard, which fixes all of these — check first ` +
        `that the dashboard is naming the form you want kept, since that is the one everybody will be sent to.`
      : `Nothing to fix here.`
  ].filter(l => l !== '');

  const report = lines.join('\n');
  log(`Check Event Links vs the Dashboard:\n${report}`);
  try {
    SpreadsheetApp.getUi().alert('Event links vs the dashboard', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    toastIfPossible(`${stats.disagrees} event(s) disagree with the dashboard — see the log.`);
  }
  return { stats, drift };
}

/**
 * MAINTENANCE — run from the Apps Script editor when a form needs
 * re-checking right now rather than at the next hourly sync (which already
 * calls migrateFormsToCurrentTemplate() itself), or after someone has hand-
 * edited a form's questions, since the version stamps this clears are the
 * only reason a form gets skipped without being opened.
 *
 * Returns the number of forms that were actually rebuilt.
 */
function recheckAllRegistrationForms() {
  if (!requireAuthorizedAdmin('Re-check All Registration Forms')) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return 0;

  PropertiesService.getScriptProperties().deleteProperty(FORM_TEMPLATE_VERSION_PROP_KEY);
  __formTemplateVersionCache = null;
  __formTemplateVersionDirty = false;

  const rebuilt = migrateFormsToCurrentTemplate(registrySheet);
  flushAdminDigest('Form re-check');
  log(`recheckAllRegistrationForms: rebuilt ${rebuilt} form(s) on template v${TEMPLATE_VERSION}.`);
  return rebuilt;
}

/**
 * How long one execution spends REBUILDING, measured from the moment its
 * registration import finishes rather than from the click.
 *
 * That distinction is the whole of it. Measuring from the click meant the
 * import — which on a busy workbook is minutes, not seconds — was spent out of
 * the rebuild budget, and a run that had five minutes of work in it got
 * through two forms before the deadline it had already used up stopped it.
 * The import is now paid for separately, and this is what is left for the job
 * itself, kept short of the six-minute execution ceiling.
 */
const IN_PLACE_REBUILD_SLICE_BUDGET_MS = 4 * 60 * 1000;

/** Handler name for the hand-off between slices. Mirrors FORM_REBUILD_RESUME_HANDLER. */
const IN_PLACE_REBUILD_RESUME_HANDLER = 'resumeInPlaceFormRebuild';
const IN_PLACE_REBUILD_STATE_PROP_KEY = 'IN_PLACE_FORM_REBUILD_STATE_V1';

/** Gap between slices — long enough to be a real gap for the desk, short enough not to feel stalled. */
const IN_PLACE_REBUILD_RESUME_DELAY_MS = 30 * 1000;

/** Watchdog: if a slice dies outright (the six-minute ceiling), this is what restarts the sweep. */
const IN_PLACE_REBUILD_WATCHDOG_DELAY_MS = IN_PLACE_REBUILD_SLICE_BUDGET_MS + 2.5 * 60 * 1000;

/** A ceiling on slices, so a sweep that cannot make progress ends rather than running forever. */
const IN_PLACE_REBUILD_MAX_SLICES = 60;

/**
 * Slices in a row that end in an EXCEPTION before the sweep gives up.
 *
 * More than one, because the failure this exists for is Apps Script's own
 * INTERNAL engine error: it strikes a run rather than a form, it does not
 * repeat, and ending a ninety-form sweep on the first of them is how a
 * template migration stops half-applied — some forms routing people to the
 * current pages and the rest still on the layout the migration was meant to
 * replace.
 */
const IN_PLACE_REBUILD_MAX_ERROR_SLICES = 3;

/** Slices in a row that rebuild nothing before the sweep gives up and says so. */
const IN_PLACE_REBUILD_MAX_STALLED_SLICES = 2;

function getInPlaceRebuildState() {
  return getSlicedJobState(IN_PLACE_REBUILD_STATE_PROP_KEY, 'In-place rebuild');
}

function saveInPlaceRebuildState(state) {
  saveSlicedJobState(IN_PLACE_REBUILD_STATE_PROP_KEY, state);
}

/** Is an in-place rebuild in flight? Stale state (FORM_REBUILD_STALE_MS) reads as "no". */
function isInPlaceRebuildActive() {
  return isSlicedJobActive(IN_PLACE_REBUILD_STATE_PROP_KEY, FORM_REBUILD_STALE_MS, minutes =>
    `⚠️ Ignoring an in-place rebuild that hasn't advanced in ${minutes} minute(s) — ` +
    `run "Rebuild Forms In Place" again to restart it.`);
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. Mirrors armFormRebuildResume(). */
function armInPlaceRebuildResume(delayMs) {
  armSlicedJobResume(IN_PLACE_REBUILD_RESUME_HANDLER, delayMs);
}

function deleteInPlaceRebuildResumeTriggers() {
  return deleteSlicedJobResumeTriggers(IN_PLACE_REBUILD_RESUME_HANDLER);
}

/**
 * ADMIN MENU ENTRY. Rewrites every live registration form from the current
 * template IN PLACE — same form, same ID, SAME LINK.
 *
 * This is destroyAndRebuildAllForms() minus the destruction, and it is the one
 * to reach for once forms are live and their links are out in the world. Both
 * actions end with every form built from the current template; the difference
 * is only what happens to the link on the flyer:
 *
 *   • THIS      — the form is emptied and rebuilt in place. Every link ever
 *                 handed out still works, because it is still the same form.
 *   • DESTROY   — a brand-new form replaces it and the old one is trashed.
 *                 Every link handed out dies. Only worth it when the form
 *                 itself is broken beyond editing, or Google will not open it.
 *
 * It differs from the hourly sync's own migration in one respect, which is
 * what makes it worth a menu item: the sync only rebuilds a form it judges
 * STALE, and a form somebody has hand-edited within the template's shape — a
 * reworded question, a deleted choice — does not look stale to it. This
 * rebuilds every form in the plan whether or not it looks current
 * (`force: true`), which is what "put the forms back the way the system wants
 * them" has to mean.
 *
 * IT FINISHES THE WHOLE LIST. One execution is capped at six minutes, which is
 * a few forms; the rest are picked up by a hand-off trigger that keeps the
 * sweep going in the background until every form is done. Nobody clicks this
 * twice. Unlike the destroy sweep it does NOT pause automation — nothing here
 * is destructive, each form is rebuilt under the workbook lock, and an hourly
 * sync landing in the middle would at worst rebuild a form this sweep was
 * about to.
 *
 * WHAT IT COSTS: the per-question answers on responses that have not been
 * imported yet, since rebuilding deletes the questions those answers hang off.
 * Which is why the import runs at the head of every slice and a failed import
 * stops the sweep — exactly as in the destroy path, and for the same reason.
 * Rows already on Registrant_Dash are the record of those registrations and
 * are untouched either way.
 *
 * Returns { started, planned }, or null if it never started.
 */
function rebuildAllFormsInPlace() {
  if (!requireAuthorizedAdmin('Rebuild Forms In Place')) return null;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return null;
  }
  if (isInPlaceRebuildActive()) {
    toastIfPossible('An in-place rebuild is already running — leaving it alone.');
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return null;
  }

  // The same plan the destroy path builds, for the same reason: a form whose
  // sessions have all happened is nobody's route to anything, and rewriting it
  // would only disturb the archive.
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const plan = planFormRebuilds(getSectionedRows(registrySheet, headers, 'Event_ID'), map);
  if (plan.length === 0) {
    toastIfPossible('Nothing to update — no form on this workbook covers an upcoming session.');
    return null;
  }

  const preview = plan.slice(0, 6).map(p => `• ${p.describe}`).join('\n');
  const more = plan.length > 6 ? `\n…and ${plan.length - 6} more` : '';
  if (!confirmConsequentialAction('Rebuild every registration form in place?',
    `${plan.length} form(s) would have their questions rewritten from the current template:\n` +
    `${preview}${more}\n\n` +
    `✅ EVERY REGISTRATION LINK KEEPS WORKING. Each form keeps its own ID, so links already handed out — ` +
    `in an email, on a flyer, in a calendar invite — go on opening the same form.\n\n` +
    `Registrations are NOT lost: outstanding responses are imported first, and rows already on ` +
    `${SHEET_NAMES.REGISTRANT_DASH} are untouched. What does go is the per-question detail of any ` +
    `response still sitting unimported on a form — which is why the import comes first, and why this ` +
    `stops if that import fails.\n\n` +
    `Anyone part-way through filling in a form when it is rebuilt will have to start again.\n\n` +
    `A few forms are done per run and the rest continue in the background until the list is finished — ` +
    `you will NOT need to run this again.`, false)) {
    return null;
  }

  saveInPlaceRebuildState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0, errorSlices: 0,
    confirmed: plan.map(item => item.oldFormId), done: [], rebuilt: 0
  });
  log(`In-place rebuild started for ${plan.length} form(s).`);
  toastIfPossible(`Rebuilding ${plan.length} form(s) in place — this continues in the background until it ` +
    `finishes; no need to run it again. Every link stays the same.`);

  runInPlaceRebuildSlice();
  return { started: true, planned: plan.length };
}

/**
 * MENU ENTRY: fix ONE form, now, in place.
 *
 * The same repair rebuildAllFormsInPlace() performs, aimed at a single form
 * and finished before the dialog closes. That sweep is the right tool after a
 * template change, when every form on the workbook is behind; it is the wrong
 * one for the ordinary case, which is one form that has gone wrong — a
 * question somebody edited, a date list that never caught up, an appointment
 * form still showing the attendance grids. Rebuilding forty forms to correct
 * one of them is a background sweep, a wait, and forty forms' worth of risk
 * for a job that takes ten seconds.
 *
 * KEEPS THE LINK. The form keeps its ID, so every link already handed out goes
 * on opening it — that is the whole reason this is the in-place rebuild rather
 * than the destroy-and-replace one.
 */
function showFixOneFormDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const forms = listExistingForms();
  if (forms.length === 0) {
    toastIfPossible('No form on this workbook covers an upcoming session — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildFixOneFormHtml(forms))
    .setWidth(560)
    .setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, 'Update One Form');
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildFixOneFormHtml(forms) {
  const formTags = forms.map(f =>
    `<option value="${escapeHtmlForDialog(f.value)}">${escapeHtmlForDialog(f.label)}</option>`).join('\n');

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
<h3>Update one form</h3>
<p class="hint">
  Rebuilds a single registration form from the current template — its dates, its questions, and the
  appointment times if it is a Personalized Assistance form. <b>The link keeps working:</b> the form
  keeps its own ID, so anything already handed out still opens it.
</p>
<p class="hint">
  Outstanding responses are imported first. What is lost is the per-question detail of a response
  still sitting unimported on the form; rows already on ${escapeHtmlForDialog(SHEET_NAMES.REGISTRANT_DASH)}
  are untouched. Anyone part-way through filling it in will have to start again.
</p>

<label class="field">Which form?
  <select id="pickedForm">${formTags}</select>
</label>
<label class="field">…or paste a form URL or ID to use instead
  <input type="text" id="formRef" placeholder="https://docs.google.com/forms/d/…/edit">
</label>

<button id="go" onclick="submit()">Update this form</button>
<div id="status"></div>
<script>
  function submit() {
    var ref = document.getElementById('formRef').value || document.getElementById('pickedForm').value;
    if (!ref) { say('Pick a form, or paste its URL.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… importing registrations, then rebuilding. This can take a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .fixOneFormNow(ref);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * WHY THIS FORM DOES OR DOES NOT ASK ABOUT LUNCH, written to the log in full.
 *
 * "Update one form" exists for the form that has gone wrong, and the commonest
 * report is that a rebuilt form still has no lunch section. Every input to
 * that decision is on a different sheet — the location's catering policy on
 * Config, the day's menu row on Lunch_Schedule, the session rows on the
 * program dashboard — and until now the only trace a rebuild left was a
 * message naming the number of forms it touched. This prints the whole chain
 * for ONE form, in the order the code reads it, so the answer is read rather
 * than guessed at:
 *
 *   - WHICH form, by ID and by the title Drive shows, so the person looking at
 *     a form in one tab can be sure it is the one that was rebuilt;
 *   - the shape the context asks for (lunch-only, appointment, ordinary) —
 *     an appointment form never carries the roster grids by design;
 *   - each location's catering policy, because a "Never" location settles it
 *     before any date is looked at;
 *   - every session date with its own verdict and the menu row behind it, so
 *     a By-exception location with no menu typed yet is distinguishable from
 *     a day somebody marked "Not Serving".
 *
 * Diagnostics only: it reads, it never writes, and it must never be able to
 * fail the rebuild it is describing.
 */
function logFormLunchDiagnostics(context, when) {
  try {
    const formId = context.formId || '(unknown)';
    const sessions = context.sessions || [];
    const locations = context.locations || [];
    const { lunchDateLabels } = buildDateLabelSets(sessions, context);
    const shape = formLunchShapeKey(context, lunchDateLabels.length > 0);
    const asks = formWantsLunchQuestions(locations, lunchDateLabels.length > 0);

    const policies = locations.map(loc => `${loc}="${getCateringPolicyForLocation(loc)}"`).join(', ');
    log(`Lunch diagnosis (${when}) for form ${formId} — ${sessions.length} session(s) at ` +
      `${describeLocations(locations)}; catering policy ${policies || '(no location on the sheet)'}; ` +
      `flags lunchOnly=${!!context.isLunchOnly} appointment=${!!context.isAssistance} ` +
      `club=${!!context.isClub} grouped=${!!context.isFixed}; shape "${shape}"; ` +
      `${lunchDateLabels.length} of ${sessions.length} date(s) serve lunch; ` +
      `roster lunch questions ${asks ? 'WANTED' : 'NOT wanted'}.`);

    // ONE LINE PER DATE, capped: a year-long club would otherwise bury every
    // other line in the log, and the first dozen dates already show the
    // pattern that a wrong verdict follows.
    sessions.slice(0, FIX_ONE_FORM_DIAGNOSTIC_DATE_LIMIT).forEach(session => {
      const meal = getMealInfoForDate(session.date, session.location);
      const offered = isLunchOfferedOn(session.date, session.location);
      log(`  ${formatDateKey(session.date)} @ ${session.location || '(no location)'} — ` +
        `lunch ${offered ? 'OFFERED' : 'not offered'}; menu row ` +
        `${meal ? `"${meal.type}"${meal.shorthand ? ` (${meal.shorthand})` : ''}` : 'none typed yet'}.`);
    });
    if (sessions.length > FIX_ONE_FORM_DIAGNOSTIC_DATE_LIMIT) {
      log(`  …and ${sessions.length - FIX_ONE_FORM_DIAGNOSTIC_DATE_LIMIT} further date(s) not listed.`);
    }
  } catch (err) {
    log(`Lunch diagnosis (${when}) could not be produced (${err}) — the rebuild itself is unaffected.`);
  }
}

/** How many of a form's dates the diagnosis above prints one line each for. */
const FIX_ONE_FORM_DIAGNOSTIC_DATE_LIMIT = 12;

/**
 * WHAT THE LIVE FORM ACTUALLY CARRIES, read back off the form itself.
 *
 * The companion to the diagnosis above, and the half that settles the report
 * it was written for: one says what the sheet asked for, this says what the
 * document ended up with — including the grid's own rows, because a lunch grid
 * still showing the template's placeholder row is a form with a lunch section
 * that nobody can answer, and it looks nothing like a missing one.
 */
function logLunchQuestionsOnLiveForm(formId, when) {
  try {
    const form = openFormCached(formId);
    const items = form.getItems();
    const titles = items.map(it => it.getTitle());
    // LUNCH_ONLY_GRID is in the list because on a lunch-only form the roster
    // grid IS the lunch question, under its own title — a form that carries it
    // has a lunch section, and reporting one as having none would send
    // somebody hunting for a grid that is already there.
    const present = [
      TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID,
      TEMPLATE_ITEM_TITLES.ALL_DATES_MEAL_COUNT,
      TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID,
      TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH,
      // The pre-v9 three, so a form that has not been rebuilt yet reports what
      // it actually carries rather than "NONE — the form has no lunch section."
      TEMPLATE_ITEM_TITLES.LUNCH_GRID,
      TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE,
      TEMPLATE_ITEM_TITLES.EXTRA_MEALS,
      LEGACY_LUNCH_ONLY_GRID_TITLE
    ].filter(title => titles.indexOf(title) !== -1);
    log(`Lunch questions on form ${formId} ("${form.getTitle()}") ${when}: ` +
      (present.length ? present.map(t => `"${t}"`).join(', ') : 'NONE — the form has no lunch section.'));

    items.filter(it => isMealCountGridTitle(it.getTitle()) ||
        it.getTitle() === TEMPLATE_ITEM_TITLES.LUNCH_GRID).forEach(it => {
      // Either kind of grid — the meal grid is a GRID and the pre-v9 lunch one
      // a CHECKBOX_GRID, and asking the wrong one for its rows throws.
      const rows = (it.getType() === FormApp.ItemType.GRID ? it.asGridItem() : it.asCheckboxGridItem()).getRows();
      log(`  "${it.getTitle()}" offers ${rows.length} row(s): ${rows.join(' | ')}`);
    });
  } catch (err) {
    log(`Could not read the lunch questions off form ${formId} ${when} (${err}).`);
  }
}

/**
 * Called from the dialog. Imports outstanding registrations, then rebuilds
 * that one form in place from the current template.
 *
 * The import comes first for the same reason it heads every slice of the
 * in-place sweep: a rebuild deletes the questions an unimported response
 * hangs off, so a failed import stops the job rather than being stepped over.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function fixOneFormNow(formRef) {
  if (isBootstrapActive()) return `⚠️ ${bootstrapBusyMessage()}`;
  if (isInPlaceRebuildActive()) {
    return '⚠️ A rebuild of every form is already running — let it finish, it will reach this form too.';
  }

  const formId = extractFormId(formRef);
  if (!formId) return '⚠️ That is not a form ID or an editable form URL — copy the /d/<id>/edit link.';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return '⚠️ No program dashboard yet — run Sync Cal first.';

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID')
    .filter(row => String(row[map['Form_ID']] || '').trim() === formId);
  if (rows.length === 0) {
    log(`Update one form: no session on ${SHEET_NAMES.PROGRAM_DASHBOARD} carries Form_ID ${formId}.`);
    return `⚠️ No session on ${SHEET_NAMES.PROGRAM_DASHBOARD} uses form ${formId}. ` +
      `Only a form this workbook manages can be rebuilt from its template.`;
  }
  // The context this rebuild will run on, kept rather than thrown away: the
  // label below is one line of it, and the lunch diagnosis is the rest.
  const context = buildFormSessionContext(formId, rows, map, getSharedFormIdSet());
  const label = `${context.titles.slice(0, 3).join(', ')} (${describeLocations(context.locations)})`;

  // BEFORE AND AFTER, both to the log. The report this exists to answer is
  // "the form I am looking at came back without a lunch section", and the two
  // halves of the answer are what the sheet asked for and what the document
  // came out with — neither of which the old one-line "Updated form X" said.
  log(`Update one form: ${formId} ("${label}") — ${rows.length} dashboard row(s), ` +
    `template v${TEMPLATE_VERSION}.`);
  logLunchQuestionsOnLiveForm(formId, 'before the rebuild');
  logFormLunchDiagnostics(context, 'from the sheet');

  const outcome = withScriptLock(SYNC_LOCK_WAIT_MS, () => {
    try {
      syncRegistrationsInternal();
    } catch (err) {
      return { ok: false, message: `⚠️ Nothing was changed. The registrations on this form could not be ` +
        `imported first (${err}), and rebuilding would have destroyed any that had not come across yet. ` +
        `Run "Sync Registrations only", then try again.` };
    }
    try {
      // force: true — the point of asking for one form by name is that the
      // sync's own staleness test has already decided it looks fine.
      const rebuilt = migrateFormsToCurrentTemplate(registrySheet, null, {
        force: true, onlyFormIds: new Set([formId]), limit: 1
      });
      return { ok: true, rebuilt };
    } catch (err) {
      log(`⚠️ Could not update form ${formId} in place (${err}).`);
      return { ok: false, message: `⚠️ Could not update "${label}" (${err}). The form is unchanged.` };
    }
  }, null);

  if (!outcome) return '⚠️ A sync is running just now — try again in a moment.';
  if (!outcome.ok) return outcome.message;

  flushPersistentRegistries(); // the template version and link fingerprints written above
  flushAdminDigest('Update one form');
  if (outcome.rebuilt === 0) {
    log(`Update one form: ${formId} ("${label}") was NOT rebuilt — migrateFormsToCurrentTemplate ` +
      `returned 0, so the form was skipped or its rebuild failed; the lines above say which.`);
    return `⚠️ "${label}" could not be rebuilt — see the log for what the form itself reported. ` +
      `Its link and its registrations are unchanged.`;
  }
  log(`Updated form ${formId} ("${label}") in place from the menu.`);
  logLunchQuestionsOnLiveForm(formId, 'after the rebuild');
  return `✅ "${label}" was rebuilt from the current template. Its registration link is unchanged, and ` +
    `its dates and questions now match the sheet.`;
}

/**
 * Trigger handler for the next slice. Never call this directly — use
 * rebuildAllFormsInPlace().
 *
 * Not behind the Automation_Enabled kill switch, for the same reason
 * resumeFormRebuildSweep() isn't: a sweep stopped halfway is not a paused
 * sweep, it is a stranded one, and its state would go on telling the next
 * click that a rebuild is already running.
 */
function resumeInPlaceFormRebuild() {
  runInPlaceRebuildSlice();
}

/**
 * One execution's worth of in-place rebuilding.
 *
 * The state machine around this — watchdog, slice count, deadline, stall
 * detection, hand-off — is runSlicedJob() in 74. What is particular to this
 * sweep is here: the import at the head of every slice, the budget that starts
 * only once that import is paid for, one form per lock hold, and a tolerance
 * for a few exceptions in a row that the other sliced jobs do not have.
 */
function runInPlaceRebuildSlice() {
  return runSlicedJob({
    label: 'In-place rebuild',
    propKey: IN_PLACE_REBUILD_STATE_PROP_KEY,
    resumeHandler: IN_PLACE_REBUILD_RESUME_HANDLER,
    budgetMs: IN_PLACE_REBUILD_SLICE_BUDGET_MS,
    resumeDelayMs: IN_PLACE_REBUILD_RESUME_DELAY_MS,
    watchdogDelayMs: IN_PLACE_REBUILD_WATCHDOG_DELAY_MS,
    maxSlices: IN_PLACE_REBUILD_MAX_SLICES,
    maxStalledSlices: IN_PLACE_REBUILD_MAX_STALLED_SLICES,

    // AN ERROR IS NOT THE END OF THIS SWEEP, unlike the other three. It used
    // to end on any exception, which threw away a sweep with ninety forms
    // still in it because one slice hit something transient — and the
    // commonest thing it hits is not ours at all: Apps Script's own "the
    // JavaScript engine reported an unexpected error, error code INTERNAL",
    // which lands on whatever slice happens to be running and is gone on the
    // next one. The forms already rebuilt stay done (each is recorded under
    // the lock as it finishes), so a retry costs nothing and resumes where
    // this slice stopped. Nothing here tore automation down, so there is
    // nothing an unfinished sweep leaves switched off.
    maxErrorSlices: IN_PLACE_REBUILD_MAX_ERROR_SLICES,

    work: ctx => {
      const state = ctx.state;
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
      if (!registrySheet) return { stop: 'stopped — the program dashboard sheet is gone' };

      // IMPORT BEFORE REBUILDING, at the head of every slice — see
      // runFormRebuildSweepSlice(), which does the same for the same reason. A
      // response submitted on a not-yet-rebuilt form in the gap between slices
      // is attached to questions this sweep is about to delete.
      //
      // Held under the lock on its own: it rewrites whole tabs, so it must not
      // interleave with a sync — but it is seconds, not minutes, and the desk
      // gets the workbook back the moment it is done.
      const imported = withScriptLock(SYNC_LOCK_WAIT_MS, () => {
        try {
          syncRegistrationsInternal();
          return { ok: true };
        } catch (err) {
          return { ok: false, err };
        }
      }, null);
      if (!imported) {
        log('In-place rebuild: could not take the lock to import registrations — the next run will retry.');
        return { handOff: true };
      }
      if (!imported.ok) {
        return { stop: `stopped — could not import outstanding registrations (${imported.err})` };
      }

      // THE BUDGET STARTS HERE, after the import — see
      // IN_PLACE_REBUILD_SLICE_BUDGET_MS for why that is the whole point.
      ctx.newDeadline();

      const doneSet = new Set(state.done);
      const remainingIds = state.confirmed.filter(id => !doneSet.has(id));
      if (remainingIds.length === 0) return { finished: true };

      let rebuiltThisSlice = 0;
      const processedThisSlice = runSlicedItems({
        items: remainingIds,
        deadline: ctx.deadline,
        lockWaitMs: SYNC_LOCK_WAIT_MS,
        // Pacing between forms — see migrateFormsToCurrentTemplate().
        sleepMs: 1500,
        onLockBusy: () => log('In-place rebuild: lock busy between forms — leaving the rest to the next run.'),
        step: formId => {
          try {
            // Sessions taken fresh inside the migration, so a row moved by the
            // import above is read as it now stands. `limit: 1` because the
            // slicing, the pacing and the lock are the loop's job, not its.
            rebuiltThisSlice += migrateFormsToCurrentTemplate(registrySheet, null, {
              force: true, onlyFormIds: new Set([formId]), limit: 1
            });
          } catch (err) {
            // Individual failures are already reported by the migration itself;
            // this catches anything that got past it. Either way the form is
            // marked done — a form that fails twice will fail a third time, and
            // a sweep that retries it forever never finishes.
            log(`⚠️ Could not rebuild form ${formId} in place (${err}).`);
            noteForAdmin('Forms that could not be updated', `${formId} — ${err}`);
          }
          state.done.push(formId);
          saveInPlaceRebuildState(state);
        }
      });

      state.rebuilt += rebuiltThisSlice;
      const remaining = state.confirmed.length - state.done.length;
      if (remaining <= 0) return { finished: true };

      // A slice that got this far did not fail, whatever it did or did not
      // rebuild — so the consecutive-error count starts again from here.
      state.errorSlices = 0;
      return { processed: processedThisSlice, remaining };
    },

    onHandOff: (state, result) => {
      toastIfPossible(`Rebuilding in place: ${state.rebuilt} form(s) done, ${result.remaining} to go. ` +
        `Next batch starts in ${Math.round(IN_PLACE_REBUILD_RESUME_DELAY_MS / 1000)}s.`);
    },

    overrunProblem: () => `stopped after ${IN_PLACE_REBUILD_MAX_SLICES} runs without finishing`,
    stalledProblem: result => `stopped early — ${result.remaining} form(s) could not be processed`,

    onError: (err, n) => {
      log(`⚠️ In-place rebuild run failed (${err}) — failure ${n} of ` +
        `${IN_PLACE_REBUILD_MAX_ERROR_SLICES} in a row.`);
    },
    errorProblem: (err, n) =>
      `stopped after ${n} run(s) in a row ended in an error, the last of them: ${err}`,
    saveErrorProblem: err => `stopped after an error it could not record: ${err}`,

    onDone: (state, problem) => finishInPlaceRebuild(state, problem)
  });
}

/** Ends the sweep: clear the state, drop the hand-off trigger, say what happened. */
function finishInPlaceRebuild(state, problem) {
  PropertiesService.getScriptProperties().deleteProperty(IN_PLACE_REBUILD_STATE_PROP_KEY);
  deleteInPlaceRebuildResumeTriggers();

  // No dashboard render: nothing on it changed. Every form kept its ID, so the
  // dates, the Form_ID column and the calendar descriptions all still say the
  // right thing, and the one cell a rebuild does invalidate — the prefilled
  // "View Live Form" link, whose entry.N parameters name item IDs that a
  // rebuild replaces — was rewritten by updateRegistryFormLinks() inside the
  // migration itself.
  flushPersistentRegistries();

  const left = Math.max(0, (state.confirmed || []).length - (state.done || []).length);
  const headline = problem
    ? `⚠️ In-place rebuild ${problem}. ${state.rebuilt} form(s) were rebuilt; ${left} still to do — ` +
      `run "Rebuild Forms In Place" again to finish. Every registration link is unchanged.`
    : `✅ ${state.rebuilt} form(s) rebuilt in place on template v${TEMPLATE_VERSION}. ` +
      `Every registration link is unchanged.`;
  log(`rebuildAllFormsInPlace: ${headline}`);
  if (problem) noteForAdmin('Rebuild forms in place', headline);
  toastIfPossible(headline);
  flushAdminDigest('Rebuild forms in place');
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops an in-place rebuild
 * that is still handing itself on. Whatever has been rebuilt stays rebuilt;
 * running the menu item again picks up only the forms still left.
 */
function cancelInPlaceFormRebuild() {
  if (!requireAuthorizedAdmin('Cancel In-Place Rebuild')) return;
  const state = getInPlaceRebuildState();
  if (!state) {
    deleteInPlaceRebuildResumeTriggers();
    log('No in-place rebuild was running — any leftover hand-off trigger has been cleared.');
    return;
  }
  finishInPlaceRebuild(state, 'was cancelled');
}

/**
 * ONE-TIME MAINTENANCE — run from the Apps Script editor, not wired to any
 * sync or the menu. createRegistrationForm() strips lunch questions off a
 * NEVER-policy location's form at creation, and refreshFormForNewDates()
 * catches up an existing form the next time it gains new dates — but a
 * form that already exists AND isn't due for new dates soon just sits with
 * stale lunch questions on it until one of those paths touches it. This
 * sweeps every currently-live form for a NEVER-policy location right now.
 *
 * Safe to run any time: removeLunchQuestionsFromForm() is a no-op on a form
 * that's already clean, so re-running this costs a few FormApp calls and
 * changes nothing.
 */
function cleanupNeverPolicyForms() {
  if (!requireAuthorizedAdmin('Cleanup Never-Policy Forms')) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return;

  const headers = HEADERS.Master_Program_Dashboard;
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);

  const locationsByForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const location = String(row[map['Location']] || '').trim();
    if (!formId || !location) return;
    if (!locationsByForm[formId]) locationsByForm[formId] = [];
    if (locationsByForm[formId].indexOf(location) === -1) locationsByForm[formId].push(location);
  });

  let checked = 0;
  Object.keys(locationsByForm).forEach(formId => {
    const locations = locationsByForm[formId];
    // A cross-location form only qualifies when EVERY location on it is
    // Never — one catering site on the form is reason enough to keep asking.
    if (locations.some(loc => getCateringPolicyForLocation(loc) !== CATERING_POLICIES.NEVER)) return;
    checked++;
    try {
      removeLunchQuestionsFromForm(openFormCached(formId), locations);
    } catch (err) {
      log(`⚠️ cleanupNeverPolicyForms: could not open form ${formId} for "${describeLocations(locations)}" (${err}).`);
    }
  });
  log(`cleanupNeverPolicyForms: checked ${checked} form(s) at Never-policy location(s).`);
}


