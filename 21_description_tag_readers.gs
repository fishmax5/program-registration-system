// ============================================================================
// 4c-bis. WHAT DOES THE SYSTEM ACTUALLY READ IN THIS DESCRIPTION?
// ============================================================================
//
// Every tag in this file is a bracket somebody typed into a calendar
// description, and the rules for reading one are not obvious from looking at
// it: a bracket is honoured only when the WHOLE bracket is tags
// (isTagOnlyBracket()), the words have several accepted spellings apiece,
// "[Slots: 20]" implies [Personalized Assistance] without saying it, and a
// description that has been edited in the Calendar web UI comes back re-encoded
// (normalizeBracketContent()).
//
// So when a tag "isn't working", the question is never "is it typed there" —
// somebody has already looked at the event and seen it. The question is
// whether THIS SCRIPT reads it, and until now there was no way to ask. The
// answer had to be inferred from a checkbox two syncs later.
//
// readTagsFromDescription() answers it directly, and 🔧 Admin ▸ Read an Event's
// Tags… puts it in front of a person: paste a program name, get every matching
// calendar event with its description, every bracket in it, which ones were
// read as tags, which were left as notes and why — and what the dashboard
// currently says about the same session, which is the comparison that names
// the problem when the two disagree.
// ============================================================================

/**
 * Every setting a bracket can state, as one table: the pattern that finds it,
 * what to call it on screen, and what it does.
 *
 * The parser proper (parseSettingsBrackets) still reads each setting with its
 * own regex; this is deliberately a second, REPORTING view of the same
 * vocabulary, so the inspector can name a tag it found without the parser
 * having to grow a debug mode. The patterns are the same constants, so the two
 * cannot disagree about what matches — only about what to say about it.
 */
const DESCRIPTION_TAG_READERS = [
  {
    key: 'capacity', label: 'Cap: N', pattern: /Cap:\s*(\d+)/i, numeric: true,
    describe: v => `Max_Capacity is ${v}. Above that, registrations go on the waitlist.`
  },
  {
    key: 'slotMinutes', label: 'Slots: N', pattern: /Slots?:\s*(\d+)/i, numeric: true,
    describe: v => `Appointments are ${v} minutes long. On its own this ALSO makes the program ` +
      `appointment-based — a slot length is a statement about appointments.`
  },
  {
    key: 'maxPerMonth', label: 'Max Per Month: N', pattern: /Max\s*Per\s*Month:\s*(\d+)/i, numeric: true,
    describe: v => `A person booking more than ${v} appointment(s) in one calendar month is flagged.`
  },
  {
    key: 'isShared', label: SHARED_LOCATION_TAG, pattern: SHARED_LOCATION_WORDS_REGEX,
    describe: () => 'This program pools with the same-named program at every other location onto ONE form.'
  },
  {
    key: 'isClub', label: CLUB_TAG, pattern: CLUB_WORDS_REGEX,
    describe: () => 'Standing membership: people sign up once and are booked into every future session.'
  },
  {
    key: 'noRegistration', label: NO_REGISTRATION_TAG, pattern: NO_REGISTRATION_WORDS_REGEX,
    describe: () => 'No registration form at all. This tag beats every other tag here.'
  },
  {
    key: 'isAssistance', label: ASSISTANCE_TAG, pattern: ASSISTANCE_WORDS_REGEX,
    describe: () => 'Booked by APPOINTMENT, not by date: each event is cut into back-to-back slots and ' +
      'the form asks for a time.'
  },
  {
    key: 'grouped', label: 'Grouped', pattern: /\b(Grouped|Fixed)\b/i,
    describe: () => 'One form for the whole series, rather than one form per calendar month.'
  },
  {
    key: 'regular', label: 'Regular', pattern: /\b(Monthly|Regular)\b/i,
    describe: () => 'One form per calendar month — the default, stated explicitly (which is how it ' +
      'overrides a [Grouped] left behind in the event TITLE).'
  }
];

/**
 * READS a description exactly as the sync does, and says what it saw.
 *
 * Returns:
 *   brackets    every "[...]" in the description, in order, each with the
 *               normalized text the parser actually matched against
 *   recognized  [{ key, label, value, describe, bracket }] — one entry per
 *               setting found, in the order the brackets appear
 *   ignored     [{ content, reason }] — brackets left alone, and why
 *   settings    parseSettingsBrackets()'s own answer, so the report can never
 *               drift from the thing it is reporting on
 *
 * Pure: no calendar, no sheet, no writes. That is what makes it safe to call
 * from a dialog and testable offline.
 */
function readTagsFromDescription(description) {
  const raw = String(description || '');
  const brackets = [];
  const recognized = [];
  const ignored = [];

  BRACKET_GROUP_REGEX.lastIndex = 0;
  let match;
  while ((match = BRACKET_GROUP_REGEX.exec(raw)) !== null) {
    const content = match[1] || '';
    const normalized = normalizeBracketContent(content);
    const tagOnly = isTagOnlyBracket(content);
    brackets.push({ content, normalized, tagOnly });

    if (!tagOnly) {
      ignored.push({
        content,
        reason: normalized
          ? 'read as a note, not a tag — a bracket only sets something when the WHOLE bracket is ' +
            'tags this script knows. Put the note outside the brackets, or split the tag into its own bracket.'
          : 'empty.'
      });
      continue;
    }

    DESCRIPTION_TAG_READERS.forEach(reader => {
      const found = new RegExp(reader.pattern.source, 'i').exec(normalized);
      if (!found) return;
      const value = reader.numeric ? parseInt(found[1], 10) : true;
      recognized.push({
        key: reader.key,
        label: reader.label,
        matched: found[0],
        value,
        describe: reader.describe(value),
        bracket: content
      });
    });
  }

  return { brackets, recognized, ignored, settings: parseSettingsBrackets(raw) };
}

/**
 * The whole answer for ONE calendar event: what its description says, what
 * this script reads out of it, what the title contributes, and what the
 * session table currently shows for the same session.
 *
 * `dashboardRows` is the already-read Master_Program_Dashboard, passed in so
 * inspecting twelve events costs one read of the tab rather than twelve.
 */
function inspectOneEventTags(ev, calendarId, locationName, dashboardRows, map) {
  const parsed = parseEventTitle(ev.getTitle());
  const description = ev.getDescription() || '';
  const read = readTagsFromDescription(description);
  const settings = parsed ? resolveEventSettings(ev, parsed) : null;
  const start = ev.getStartTime();

  // The row this event became, matched the way every other part of this system
  // matches one: same calendar, same clean title, same date.
  let sheetRow = null;
  if (parsed && map['Clean_Title'] !== undefined) {
    const dateKey = formatDateKey(start);
    const found = (dashboardRows || []).filter(row =>
      String(row[map['Calendar_Source']] || '').trim() === calendarId &&
      String(row[map['Clean_Title']] || '').trim() === parsed.cleanTitle &&
      (coerceDate(row[map['Event_Date']]) ? formatDateKey(coerceDate(row[map['Event_Date']])) : '') === dateKey);
    if (found.length > 0) {
      const row = found[0];
      sheetRow = {
        typeTag: String(row[map['Type_Tag']] || '').trim(),
        isClub: isClubColumnValue(row[map['Club']]),
        noRegistration: isNoRegistrationColumnValue(row[map['No_Registration']]),
        isAssistance: isAssistanceColumnValue(row[map['Personalized_Assistance']]),
        slotMinutes: row[map['Slot_Minutes']],
        maxCapacity: row[map['Max_Capacity']],
        formId: String(row[map['Form_ID']] || '').trim()
      };
    }
  }

  // The three flags the sheet shows as checkboxes, calendar answer beside
  // sheet answer. A disagreement here IS the bug report — it means the tick and
  // the tag have come apart, and which way round says which one to fix.
  const comparisons = settings && sheetRow ? PROGRAM_FLAG_COLUMNS.map(flag => ({
    column: flag.column,
    tag: flag.tag,
    calendar: !!settings[flag.groupKey],
    sheet: !!sheetRow[flag.groupKey],
    agrees: !!settings[flag.groupKey] === !!sheetRow[flag.groupKey]
  })) : [];

  return {
    title: ev.getTitle(),
    cleanTitle: parsed ? parsed.cleanTitle : '',
    isTentative: !!(parsed && parsed.isTentative),
    location: locationName,
    calendarId,
    dateLabel: formatDateLabel(start),
    timeLabel: `${formatTimeLabel(start)}–${formatTimeLabel(ev.getEndTime())}`,
    description,
    read,
    settings,
    hasLegacyTitleBrackets: !!(parsed && parsed.hasLegacyBrackets),
    sheetRow,
    comparisons
  };
}

/** How many events the inspector will report on at once — more than this is a list, not an answer. */
const TAG_INSPECTOR_MAX_EVENTS = 12;

/**
 * Finds the calendar events a person means and inspects each one.
 *
 * `query` is matched loosely against the event title, because the whole point
 * of this tool is being used by somebody who is not sure what the system
 * thinks the program is CALLED — a leading "*", a stray bracket or a double
 * space all change cleanTitle without changing what a person reads.
 * `dateHint` ('yyyy-MM-dd', or blank) narrows it to one day.
 */
function inspectCalendarEventTags(query, dateHint) {
  const wanted = String(query || '').trim().toLowerCase();
  if (!wanted) return { error: 'Type part of the program name.', events: [], matched: 0 };

  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const map = getIndexMap(HEADERS.Master_Program_Dashboard);
  const dashboardRows = dash
    ? readAllSectionedRows(dash, HEADERS.Master_Program_Dashboard, 'Event_ID') : [];

  const hits = [];
  const unreadable = [];
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) { unreadable.push(locationName); return; }
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const title = String(ev.getTitle() || '');
      const parsed = parseEventTitle(title);
      const haystack = `${title} ${parsed ? parsed.cleanTitle : ''}`.toLowerCase();
      if (haystack.indexOf(wanted) === -1) return;
      if (dateHint && formatDateKey(ev.getStartTime()) !== dateHint) return;
      hits.push({ ev, calendarId, locationName });
    });
  });

  hits.sort((a, b) => a.ev.getStartTime() - b.ev.getStartTime());
  const shown = hits.slice(0, TAG_INSPECTOR_MAX_EVENTS);
  return {
    matched: hits.length,
    truncated: hits.length > shown.length,
    unreadable,
    windowLabel: `${formatDateLabel(start)} – ${formatDateLabel(end)}`,
    events: shown.map(h => inspectOneEventTags(h.ev, h.calendarId, h.locationName, dashboardRows, map))
  };
}

/** 🔧 Admin ▸ Read an Event's Tags… */
function showEventTagInspectorDialog() {
  const html = HtmlService.createHtmlOutput(buildEventTagInspectorHtml())
    .setWidth(760)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Read an Event’s Tags');
}

/** Called from the dialog. Returns the report as markup. */
function inspectEventTagsFromDialog(query, dateHint) {
  try {
    const report = inspectCalendarEventTags(query, String(dateHint || '').trim());
    log(`Tag inspector: "${query}"${dateHint ? ` on ${dateHint}` : ''} -> ${report.matched || 0} event(s).`);
    return renderEventTagReportHtml(report);
  } catch (err) {
    log(`showEventTagInspectorDialog: ${err}`);
    return `<p class="err">Could not read the calendar: ${escapeHtmlForDialog(err)}</p>`;
  }
}

/** The report markup for one inspectCalendarEventTags() answer. */
function renderEventTagReportHtml(report) {
  const esc = escapeHtmlForDialog;
  if (report.error) return `<p class="err">${esc(report.error)}</p>`;

  const head = [];
  if (report.unreadable && report.unreadable.length > 0) {
    head.push(`<p class="err">⚠️ Could not read: ${esc(report.unreadable.join(', '))}.</p>`);
  }
  if (report.matched === 0) {
    head.push(`<p class="err">No event matched, ${esc(report.windowLabel)}.</p>
      <p class="hint">The search is on the event's TITLE as it appears on the calendar. If the program
      is outside this window, or its title is spelled differently, nothing will match — and neither
      does the sync, which is worth knowing on its own.</p>`);
    return head.join('\n');
  }
  head.push(`<p class="hint">${report.matched} event(s) matched, ${esc(report.windowLabel)}` +
    `${report.truncated ? ` — showing the first ${report.events.length}` : ''}.</p>`);

  const blocks = report.events.map(e => {
    const tags = e.read.recognized.length === 0
      ? `<p class="none">Nothing in this description is read as a tag.</p>`
      : `<table>${e.read.recognized.map(t => `<tr>
          <td class="tagcell">[${esc(t.label)}]</td>
          <td>${esc(t.describe)}<br><span class="detail">matched "${esc(t.matched)}" in
          "[${esc(t.bracket)}]"</span></td></tr>`).join('')}</table>`;

    const ignored = e.read.ignored.length === 0 ? '' :
      `<div class="sub"><b>Brackets left alone</b>${e.read.ignored.map(b =>
        `<p class="detail">"[${esc(b.content)}]" — ${esc(b.reason)}</p>`).join('')}</div>`;

    const legacy = e.hasLegacyTitleBrackets
      ? `<p class="detail">⚠️ This event still carries settings in its TITLE. They are still read as a
         fallback, but the supported place is the description.</p>` : '';
    const tentative = e.isTentative
      ? `<p class="err">⚠️ The title starts with "*", so this event is skipped entirely — no form,
         no dashboard row — until the asterisk comes off.</p>` : '';

    const sheet = !e.sheetRow
      ? `<p class="detail">No row on the dashboard for this date yet — run 🔄 Update Everything Now.</p>`
      : `<table>${e.comparisons.map(c => `<tr>
          <td class="tagcell">${esc(c.column)}</td>
          <td>calendar says <b>${c.calendar ? 'yes' : 'no'}</b>,
              sheet says <b>${c.sheet ? 'yes' : 'no'}</b>
              ${c.agrees ? '<span class="ok">✔ agree</span>'
                : `<span class="err">✘ DISAGREE — the next sync will make the sheet say
                   "${c.calendar ? 'yes' : 'no'}", because the calendar is the source of truth.
                   To keep the sheet's answer, tick the box again and use
                   "Push Dashboard Ticks to the Calendar".</span>`}</td></tr>`).join('')}
        <tr><td class="tagcell">Slot_Minutes</td><td>${esc(e.sheetRow.slotMinutes || '(blank)')}</td></tr>
        <tr><td class="tagcell">Max_Capacity</td><td>${esc(e.sheetRow.maxCapacity || '(blank)')}</td></tr>
        <tr><td class="tagcell">Form_ID</td><td>${esc(e.sheetRow.formId || '(none)')}</td></tr></table>`;

    return `<div class="event">
      <h4>${esc(e.title)}</h4>
      <p class="detail">${esc(e.dateLabel)}, ${esc(e.timeLabel)} · ${esc(e.location)}
        · reads as the program "<b>${esc(e.cleanTitle)}</b>"</p>
      ${tentative}${legacy}
      <div class="sub"><b>Description, exactly as the calendar returns it</b>
        <pre>${esc(e.description) || '<i>(empty)</i>'}</pre></div>
      <div class="sub"><b>Tags this script reads</b>${tags}</div>
      ${ignored}
      <div class="sub"><b>What the dashboard says about this session</b>${sheet}</div>
    </div>`;
  });

  return head.concat(blocks).join('\n');
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildEventTagInspectorHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  h4 { margin: 0 0 2px 0; font-size: 14px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.45; }
  .detail { color: #666; line-height: 1.4; margin: 2px 0; }
  .none { color: #C5221F; margin: 4px 0; }
  input[type=text] { font-size: 13px; padding: 6px; width: 320px; }
  input.date { width: 130px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 7px 14px;
           font-size: 13px; cursor: pointer; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  .event { border: 1px solid #ccc; border-radius: 4px; padding: 10px; margin: 12px 0; }
  .sub { margin-top: 10px; }
  pre { background: #f6f6f6; border: 1px solid #eee; border-radius: 3px; padding: 8px;
        white-space: pre-wrap; word-break: break-word; margin: 4px 0 0 0; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 4px; }
  td { border-bottom: 1px solid #f0f0f0; padding: 4px 6px; vertical-align: top; line-height: 1.4; }
  td.tagcell { width: 190px; font-weight: bold; color: #1155CC; white-space: nowrap; }
  .ok { color: #188038; } .err { color: #C5221F; }
  #out { margin-top: 8px; }
</style>
<h3>What does this script read in a calendar event?</h3>
<p class="hint">
  Type part of a program's name as it appears on the calendar. This reads its events with the same
  code the sync uses and shows every bracket in the description, which ones became settings, which
  were left as notes and why — then compares that with what the dashboard currently shows for the
  same session. <b>It changes nothing.</b>
</p>
<div>
  <input type="text" id="q" placeholder="e.g. Low-Cost Wills" onkeydown="if(event.keyCode===13)go()">
  <input type="text" id="d" class="date" placeholder="yyyy-mm-dd (optional)">
  <button id="btn" onclick="go()">Read the tags</button>
</div>
<div id="out"></div>
<script>
  function go() {
    var q = document.getElementById('q').value;
    if (!q.trim()) { document.getElementById('out').innerHTML = '<p class="err">Type part of a name.</p>'; return; }
    document.getElementById('btn').disabled = true;
    document.getElementById('out').innerHTML = '<p class="hint">Reading the calendar\\u2026</p>';
    google.script.run
      .withSuccessHandler(function (html) {
        document.getElementById('btn').disabled = false;
        document.getElementById('out').innerHTML = html;
      })
      .withFailureHandler(function (err) {
        document.getElementById('btn').disabled = false;
        document.getElementById('out').innerHTML = '<p class="err">Failed: ' + err.message + '</p>';
      })
      .inspectEventTagsFromDialog(q, document.getElementById('d').value);
  }
  document.getElementById('q').focus();
</script>`;
}

/** Public entry point: acquires a script lock so overlapping executions can't race each other. */
function syncCalendars() {
  // Before the bootstrap check, which reads a Script Property, and before
  // anything touches CalendarApp: a paused run should cost as close to
  // nothing as possible, because the account whose trigger is firing may be
  // one nobody here can see or stop any other way.
  if (!automationGateAllows('Sync Cal')) return;
  recordHandlerRun('syncCalendars');

  if (isBootstrapActive()) {
    log(`syncCalendars: a large-setup import or forms-rebuild sweep is in progress — skipping this run so they don't fight over the same forms.`);
    return;
  }

  // Asked only when a human is driving. A calendar sync can create forms,
  // rewrite the date list on existing ones, and edit event descriptions —
  // outward-facing changes people see. The scheduled daily run passes this
  // (defaultWhenUnattended: true) because that is precisely its job; a menu
  // click gets to say no.
  if (!confirmConsequentialAction('Sync calendars now?',
    'This reads every program calendar and may CREATE registration forms, update the dates on ' +
    'existing forms, and edit the registration link in calendar event descriptions.\n\n' +
    'Registrants and their answers are never changed.', true)) {
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('syncCalendars: another sync is already running — skipping this run.');
    toastIfPossible('Another sync is already running — try again in a moment.');
    return;
  }
  try {
    toastIfPossible('Syncing calendars…');
    syncCalendarsInternal();
  } finally {
    lock.releaseLock();
  }
}

function syncCalendarsInternal() {
  // The quiet window — take the calendar watchers down, do the work, advance
  // the sync tokens past our own description edits, put the watchers back
  // (restore-only). All four steps, and the reasons for each, live in
  // withCalendarChangeTriggersPaused(); this was the path that manufactured
  // most of the duplicate calendar triggers before that rule existed.
  withCalendarChangeTriggersPaused('sync', () => {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      migrateLegacySheetNames(ss);
      const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);

      if (findProgramSessionHeaderRows(registrySheet).length === 0) {
        renderProgramDashboard();
      }

      const summary = importCalendarGroups(registrySheet);
      renderProgramDashboard();

      // AFTER the calendar render, not before: that render owns the triage
      // pass, and the lunch pass adds rows it should not have to re-examine.
      // Guarded on its own — a lunch form that will not build must not be able
      // to fail a calendar sync that has already done its work.
      try {
        // The pins are DERIVED from what this returns, and nothing else in
        // this sync draws them. Without the render below, a month whose menu
        // was typed this morning got its form here and its link nowhere: the
        // block went on showing yesterday's answer until the next hourly
        // registration sync happened to redraw the tab. Rendering only when
        // the map actually moved keeps that off the ordinary run, where every
        // month short-circuits and there is nothing new to pin.
        const before = JSON.stringify(pruneLunchOnlyFormLinks(getLunchOnlyFormLinks()));
        const after = JSON.stringify(syncLunchOnlySessions(registrySheet));
        if (after !== before) updateMasterLunchDashboard(null);
      } catch (err) {
        log(`⚠️ Could not refresh the lunch sign-up forms this run (${err}) — the program forms are unaffected.`);
        noteForAdmin('Lunch sign-up forms not refreshed',
          `${err}. The lunch-only sign-up forms were not built or updated this run; everything else synced normally.`);
      }

      SpreadsheetApp.getActiveSpreadsheet().toast(
        `Calendar sync complete ✅ (${describeImportSummary(summary)})`, 'Calendar & Form Manager', 5);
    } finally {
      // Inside the window, so both still happen before the triggers return.
      flushPersistentRegistries(); // never strand a form-label fingerprint written during this run
      flushAdminDigest('Calendar sync');
    }
  });
}

/**
 * THE calendar->registry import, shared by syncCalendarsInternal() and the
 * batched bootstrapCalendars(). Walks every group that has dates not already
 * on the session table, gives each one a form (new, reused, or recovered from
 * an event description), writes its rows, and stamps the registration link
 * back onto its calendar events.
 *
 * options.deadline — epoch ms. Checked BETWEEN groups: the loop stops cleanly
 *   the moment it can no longer be confident a whole group fits in what's
 *   left of the execution. A group is the unit of work because its rows, its
 *   form and its calendar-description edits have to land together; stopping
 *   mid-group would leave a form with no rows pointing at it.
 * options.onGroupDone — called after each processed group, for progress logs.
 *
 * Returns a summary including `remaining` (groups still needing work when the
 * deadline hit) and `outOfTime`.
 */
function importCalendarGroups(registrySheet, options) {
  options = options || {};
  const { start, end } = computeSyncDateRange();
  log(`Calendar import window: ${formatDateLabel(start)} – ${formatDateLabel(end)}, across ` +
    `${Object.keys(CALENDAR_MAP).length} calendar(s): ${Object.keys(CALENDAR_MAP).map(id => CALENDAR_MAP[id]).join(', ')}.`);

  // FIRST, before a single event is read: deliver any checkbox tick that has
  // not reached the calendar yet (see PENDING_FLAG_SHEET_NAME). This run is
  // about to treat the calendar as the truth about every program, so an
  // instruction still sitting in the queue has to become part of that truth
  // now — otherwise this is the sync that unticks somebody's box.
  const pending = applyPendingProgramFlags();
  if (pending.applied > 0) {
    log(`Delivered ${pending.applied} queued checkbox change(s) to the calendar before importing.`);
  }

  // Per-import, not per-execution: a bootstrap slice and the sync that follows
  // it are separate runs, but "Destroy & Rebuild Forms" can replace a form
  // inside one — and a cached recovery would then name a form in the trash.
  invalidateRecoveredFormIds();

  let existingState = getExistingRegistryState(registrySheet);
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const groups = buildGroupsForWindow(eventsByCalendar);

  // BEFORE anything decides what is "new": a program renamed on the calendar
  // presents as a brand-new group whose old sessions have vanished, and the
  // vanishing half is what triage acts on. Moving the existing rows onto the
  // new name here means the rest of this run — and the render that follows
  // it — simply sees a program that was always called this. See section 4e.
  const renames = detectRenamedPrograms(registrySheet, groups, existingState, eventsByCalendar);
  const renamedGroupKeys = new Set();
  if (renames.length > 0) {
    applyProgramRenames(registrySheet, renames);
    renames.forEach(rename => renamedGroupKeys.add(rename.groupKey));
    // The rows just changed underneath it: Event_IDs, titles and therefore
    // group keys are all different now.
    existingState = getExistingRegistryState(registrySheet);
    invalidateRecoveredFormIds();
  }

  const work = collectCalendarWork(groups, existingState, renamedGroupKeys);

  // WHAT THIS RUN THINKS IS ON THE CALENDAR, before it acts on any of it.
  //
  // Everything after this point is decided from `groups` — which forms exist,
  // which rows are written, which checkboxes are ticked and which are cleared —
  // and until this line the log said nothing at all about what was in it. A
  // whole class of bug (a tag read from a description and then dropped on the
  // way to the group; a tag typed into a bracket that reads as prose; a program
  // split across months) is invisible in its effects and obvious here.
  logCalendarGroupInventory(groups, work);

  // Before the per-group loop, and independently of it: a group whose dates
  // are all already on the sheet is skipped below as "up to date", which is
  // right for forms and rows but wrong for a tag somebody has just added to an
  // existing program. [Club] and [No Registration] have to take effect the
  // sync after they are ticked, not the sync after the program's next new
  // date.
  reconcileProgramFlagColumns(registrySheet, work.allGroups || []);
  // The same gap again, for the two columns nothing has ever rewritten: a
  // session's START and END. An event lengthened on the calendar after its
  // date was first written left the row saying what it used to say, and an
  // appointment program's slots are cut out of exactly those two columns —
  // so the form went on offering one appointment per date. BEFORE the pass
  // below, which does the slot arithmetic from them.
  reconcileSessionTimesFromCalendar(registrySheet, work.allGroups || []);
  // The same gap, for the columns a tick of Personalized_Assistance implies
  // rather than sets — see reconcileAssistanceSessionSettings().
  reconcileAssistanceSessionSettings(registrySheet, work.allGroups || []);
  applyNoRegistrationEffects(registrySheet, work.allGroups || []);

  const summary = {
    groupsTotal: work.length, groupsProcessed: 0, groupsFailed: 0,
    formsCreated: 0, formsReused: 0, groupsWithoutForms: 0, formsUnreachable: 0,
    eventsAdded: 0, remaining: 0, outOfTime: false
  };

  for (let i = 0; i < work.length; i++) {
    if (options.deadline && Date.now() >= options.deadline) {
      summary.outOfTime = true;
      summary.remaining = work.length - i;
      log(`Out of time for this run — ${summary.remaining} group(s) left to import.`);
      break;
    }

    const item = work[i];
    try {
      const result = processCalendarGroup(registrySheet, item, existingState);
      summary.groupsProcessed++;
      summary.eventsAdded += result.eventsAdded;
      // A [No Registration] group has no form either way — counting it as
      // "reused" would report forms this run never opened.
      if (result.formCreated) summary.formsCreated++;
      else if (result.noForm) summary.groupsWithoutForms++;
      // Counted separately from "reused": nothing was opened, and reporting it
      // as a reuse is how a program with no working link stays invisible.
      else if (result.formUnreachable) summary.formsUnreachable++;
      else summary.formsReused++;
    } catch (err) {
      // One bad group must not cost the whole run — especially mid-bootstrap,
      // where everything after it would be stranded too.
      summary.groupsFailed++;
      log(`⚠️ Could not import ${describeGroup(item.group)}: ${err} — continuing with the rest.`);
      noteForAdmin('Programs that could not be imported',
        `${item.group.cleanTitle} (${describeLocations(item.group.locations)}) — ${err}`);
    }
    if (options.onGroupDone) options.onGroupDone(summary);
  }

  flushPersistentRegistries(); // one write covering every group touched above

  // AFTER the loop, on purpose — building a form opens it for responses, so a
  // horizon applied before this point would be undone by the very run that
  // applied it. See applyRegistrationHorizonEffects().
  applyRegistrationHorizonEffects(registrySheet, work.allGroups || [], existingState);

  // Once more, now that the loop has built or recovered forms: a program that
  // has just come back off [No Registration] gets its dashboard links back on
  // the SAME sync that restores its form, rather than on the one after.
  updateRegistrationLinkCells(registrySheet, work.allGroups || [], buildFormIdByProgram(work.allGroups || []));
  return summary;
}

/**
 * The one-per-run census of what the calendar was read as.
 *
 * TAGGED PROGRAMS ARE NAMED INDIVIDUALLY; untagged ones are counted. That is
 * the ratio the log needs: an ordinary monthly program with no tags on it is
 * the overwhelming majority and says nothing when it is working, while the
 * tagged ones are every feature that has ever been reported as "not sticking".
 * Naming a hundred untagged programs to find the two that matter is why nobody
 * read the log the last time this went wrong.
 */
function logCalendarGroupInventory(groups, work) {
  if (!groups || groups.length === 0) {
    log('Read 0 program group(s) from the calendar — nothing in the window has a usable title.');
    return;
  }

  const tagged = groups.filter(g => g.isClub || g.noRegistration || g.isAssistance || g.isShared);
  const programs = dedupePreservingOrder(groups.map(g => `${g.scope}::${g.cleanTitle}`)).length;
  const dates = groups.reduce((n, g) => n + (g.sessions ? g.sessions.length : 0), 0);

  log(`Read ${groups.length} group(s) from the calendar — ${programs} program(s), ${dates} date(s). ` +
    `${work.length} group(s) have work to do this run; ${groups.length - work.length} are already up to date.`);

  const byTag = {};
  const count = (label, g) => { (byTag[label] = byTag[label] || []).push(g); };
  groups.forEach(g => {
    if (g.isAssistance) count(ASSISTANCE_TAG, g);
    if (g.isClub) count(CLUB_TAG, g);
    if (g.noRegistration) count(NO_REGISTRATION_TAG, g);
    if (g.isShared) count(SHARED_LOCATION_TAG, g);
  });

  if (tagged.length === 0) {
    log(`No program in the window carries [${ASSISTANCE_TAG}], [${CLUB_TAG}], ` +
      `[${NO_REGISTRATION_TAG}] or [${SHARED_LOCATION_TAG}]. If you expected one to, its bracket is not ` +
      `being read — check it with 🔧 Admin ▸ Read an Event's Tags…`);
    return;
  }

  Object.keys(byTag).forEach(tag => {
    const names = dedupePreservingOrder(byTag[tag].map(g => g.cleanTitle));
    log(`[${tag}] — ${names.length} program(s): ${names.join(', ')}`);
  });
  // And then the full line for each, because the tags are only half of it: the
  // slot length and the span are what an appointment program is actually made
  // of, and a wrong one of those looks identical to a missing tag on the sheet.
  tagged.forEach(g => log(`  ${describeGroup(g)}`));
}

/** Human-readable one-liner for a toast/log line. */
function describeImportSummary(summary) {
  const parts = [`${summary.groupsProcessed} program group(s)`, `${summary.eventsAdded} new date(s)`];
  if (summary.formsCreated > 0) parts.push(`${summary.formsCreated} new form(s)`);
  if (summary.formsReused > 0) parts.push(`${summary.formsReused} existing form(s) reused`);
  if (summary.groupsWithoutForms > 0) parts.push(`${summary.groupsWithoutForms} with no registration`);
  if (summary.formsUnreachable > 0) {
    parts.push(`⚠️ ${summary.formsUnreachable} form(s) could not be opened — nothing rebuilt, see the log`);
  }
  if (summary.groupsFailed > 0) parts.push(`${summary.groupsFailed} failed`);
  return parts.join(', ');
}

/**
 * Parses the raw calendar fetch into the GROUPS that each get one form.
 *
 * Split out from collectCalendarWork() because the group list is needed
 * BEFORE any decision about what is new: detectRenamedPrograms() (section 4e)
 * reads it to work out whether a group that looks brand new is actually an
 * existing program under a new name, and has to do that before "brand new"
 * turns into new rows and a triage sweep.
 *
 * Parsing is per calendar (a calendar IS a location), but GROUPING is done
 * once across all of them — that is what lets a program tagged
 * [All Locations] pool its sessions onto one form instead of one per site.
 */
function buildGroupsForWindow(eventsByCalendar) {
  const parsedSessions = [];

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Calendar not found or inaccessible: ${calendarId}`);
      return;
    }

    const tentativeTitles = new Set();
    events
      .filter(ev => !ev.isAllDayEvent())
      .forEach(ev => {
        const parsed = parseEventTitle(ev.getTitle());
        if (!parsed) return;
        // Tentative events are skipped WHOLESALE — no form, no registry
        // row — until the leading "*" comes off. Because parseEventTitle()
        // strips the asterisk from cleanTitle, confirming an event later
        // produces the exact same Event_ID, so it simply flows through as
        // a brand-new session with no reconciliation needed.
        if (parsed.isTentative) {
          tentativeTitles.add(parsed.cleanTitle);
          return;
        }
        // EVERY resolved setting, copied by NAME OF THE SETTING rather than
        // one hand-written line per field. This loop used to list five of
        // them, and resolveEventSettings() answers eight: isAssistance,
        // slotMinutes and maxPerMonth were resolved correctly from the
        // description on every single sync and then dropped on the floor here.
        //
        // That one omission is the whole of "[Personalized Assistance] does
        // not stick". buildEventGroups() reads `parsed.isAssistance`, got
        // undefined, and built every group with isAssistance false — so
        // reconcileProgramFlagColumns() went on to write `false` into the
        // Personalized_Assistance checkbox of every session row of every
        // program, every hour, no matter what the calendar said. The tick
        // reached the calendar exactly as designed and the sync that read it
        // back could not see it.
        //
        // Copying the whole object is what stops the fourth flag from
        // arriving in the same way. `parsed` also carries title-level facts
        // (cleanTitle, isTentative, the legacy* fallbacks resolveEventSettings
        // has already folded in), so the settings are assigned OVER it rather
        // than replacing it.
        assignEventSettings(parsed, resolveEventSettings(ev, parsed));
        parsedSessions.push({ event: ev, parsed, calendarId, locationName });
      });

    if (tentativeTitles.size > 0) {
      log(`Skipped ${tentativeTitles.size} tentative program(s) at ${locationName} (title starts with "*"): ` +
        `${Array.from(tentativeTitles).join(', ')}. Remove the asterisk to generate forms.`);
    }
  });

  const groups = buildEventGroups(parsedSessions);
  warnAboutPartiallySharedPrograms(groups);
  return groups;
}

/**
 * Turns the group list into an ordered list of units of work —
 * `{ group, configInfo, newSessions }` — skipping groups whose dates are all
 * already on the session table. Pure in-memory work: no form, sheet or
 * calendar writes happen here, so a caller can safely build the whole list up
 * front and then process as much of it as it has time for.
 */
function collectCalendarWork(groups, existingState, renamedGroupKeys) {
  const renamed = renamedGroupKeys || new Set();
  const work = [];
  groups.forEach(group => {
    const newSessions = group.sessions.filter(s => {
      const eventId = computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()));
      return !existingState.eventIds.has(eventId);
    });
    // A program whose rows still say "— no registration —" while its calendar
    // no longer says [No Registration] is NOT up to date, however old its
    // dates are: it needs its form back, and its registration link back on its
    // events. That is the only reason a group with nothing new to add is
    // processed — see processCalendarGroup(), which writes no rows for it and
    // simply restores the form and the links.
    const needsUnblocking = !group.noRegistration && group.sessions.some(s =>
      existingState.blockedPrograms &&
      existingState.blockedPrograms.has(`${s.calendarId}|${group.cleanTitle}`));

    // A group whose rows were just moved onto a new name (section 4e) also has
    // nothing NEW to add — the remap saw to that — and would be skipped here
    // for exactly the same reason. But its form is still called whatever the
    // program used to be called, and refreshFormForNewDates() is the only
    // thing that retitles it. Skipping it would leave respondents opening
    // "Chair Yoga - September" to sign up for Gentle Yoga.
    const wasRenamed = renamed.has(group.groupKey);

    if (newSessions.length === 0 && !needsUnblocking && !wasRenamed) {
      log(`Up to date: ${describeGroup(group)} — every date already on the session table, nothing to do.`);
      return;
    }
    if (newSessions.length === 0) {
      log(`No new dates for ${describeGroup(group)}, but processing it anyway: it ` +
        (wasRenamed ? 'was just renamed on the calendar — its form has to be renamed to match.'
          : `is coming back off [${NO_REGISTRATION_TAG}] — its form and its calendar links have to be restored.`));
    }
    work.push({
      group,
      configInfo: { footerNote: buildFooterNoteForLocations(group.locations) },
      newSessions
    });
  });

  // EVERY group that was seen, including the ones with nothing new to do.
  // reconcileProgramFlagColumns() needs those too — see importCalendarGroups().
  work.allGroups = groups;
  return work;
}

