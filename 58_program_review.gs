// ============================================================================
// 14. THE PROGRAM REVIEW  (decide them one at a time, apply them all at once)
// ============================================================================
//
// WHY THIS EXISTS. Everything in this file is a rule about how the calendar,
// the sheet and the forms should agree, and every one of those rules is
// enforced on the way IN — at the moment a sync runs, a checkbox is ticked, a
// form is rebuilt. None of them is enforced on the way OUT. So after a season
// of editing — a program renamed, a tag typed by hand, a form rebuilt on
// Tuesday and re-split on Thursday, a day of appointments entered as seven
// half-hour blocks — nothing anywhere says which of forty programs are still
// in the state their author believes they are in. The workbook looks fine. The
// dashboard is full of rows. The forms all open.
//
// The only way to find out has been to know what to look for and go looking.
//
// So this states, per program, WHAT OUGHT TO BE TRUE, and then says whether
// it is:
//
//   • the sheet and the calendar agree about what kind of program this is;
//   • every session of it says the same thing as every other;
//   • it has a form, and as many forms as its kind implies — one for a series,
//     one per month for a monthly, none at all for a drop-in;
//   • a drop-in carries no "register here" link;
//   • an appointment program has a slot length, and a capacity that is its
//     number of slots;
//   • its day is one event rather than seven back-to-back blocks;
//   • it is shared across locations everywhere or nowhere;
//   • every session row has a calendar event behind it, and every calendar
//     event has a row.
//
// Each answer is either a tick or a sentence saying what disagrees with what,
// and — where there is one — the fix.
//
// DECIDING IS QUICK; THE CONSEQUENCES ARE SLOW, so they are separated. Every
// fix on this screen ends in the same place: a handful of calendar writes, and
// then a sync to rebuild the form behind them and rewrite the links on the
// events. Carrying that out per program meant a wait between one program and
// the next, forty times over, and each of those syncs re-read every calendar
// and every form in the workbook to publish the effect of one retag.
//
// So the answers are held in the browser as they are given — nothing is
// written — and one press at the end applies all of them inside ONE quiet
// window and runs ONE sync over the lot. The work is the same either way; only
// the waiting multiplies. See reviewApplyPlan().
//
// AND THEN, WHICH PROGRAM IS ON WHICH FORM. Every assertion here is about one
// program in isolation, and the thing a batch of changes can leave behind is a
// relationship BETWEEN programs: two of them sharing a form, or one program's
// sessions handed out on two different links. Neither is visible from a screen
// that shows one program at a time, so the review has a second view that reads
// form-first — and the dialog lands on it the moment an apply comes back. See
// buildFormLinkageReport().
//
// IT READS TWICE AND OPENS NOTHING. The whole review is the dashboard rows and
// one pass over the calendar window, both of which are already cached per
// execution. No form is opened, which is what keeps a forty-program review a
// few seconds rather than a minute: FormApp.openById() is a remote round trip
// each, and none of the questions above needs one.
//
// THE REVIEW MARK IS A FINGERPRINT, not a tick. Marking a program reviewed
// records what was true when you looked at it; if the calendar moves
// underneath afterwards, the mark says "reviewed, but it has changed since"
// rather than going on claiming the program is fine. A mark that can quietly
// become a lie is worse than no mark at all on a workbook several people edit.
// Marks made during a batch are stamped with what is true AFTER the update, not
// before it — otherwise every program in the batch would announce itself as
// changed-since-reviewed the instant it was marked.
// ============================================================================

/** Where the review marks live. One property, one JSON object, keyed by program. */
const PROGRAM_REVIEW_PROP_KEY = 'PROGRAM_REVIEW_STATE_V1';

/** How many programs the dialog will draw. Beyond this it is a bootstrap, not a review. */
const PROGRAM_REVIEW_LIMIT = 250;

/** Severity of one assertion. Ordered worst-first, which is the order they are shown in. */
const REVIEW_LEVELS = { PROBLEM: 'problem', WARN: 'warn', OK: 'ok', INFO: 'info' };

function getProgramReviewState() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(PROGRAM_REVIEW_PROP_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function saveProgramReviewState(state) {
  PropertiesService.getScriptProperties().setProperty(PROGRAM_REVIEW_PROP_KEY, JSON.stringify(state || {}));
}

/**
 * A program's identity for review purposes: its calendar and its title, or
 * the shared scope and its title when it is a cross-location program.
 *
 * DELIBERATELY THE SAME SHAPE buildEventGroups() KEYS ON, minus the month:
 * what a person means by "a program" is the thing that carries one name at
 * one place, whether it meets once or forty times, and whether its dates are
 * on one form or twelve.
 */
function programReviewId(scope, title) {
  return `${scope}::${title}`;
}

/**
 * The whole review: one entry per program, each with its facts and its
 * assertions.
 *
 * Two reads and no forms opened — see the section note. Everything else is
 * derived from those two.
 */
function buildProgramReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) {
    return {
      programs: [], summary: { total: 0, problems: 0, warnings: 0, reviewed: 0 },
      formLinks: { forms: [], conflicts: [] }, ready: false
    };
  }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');
  const calendarFacts = readCalendarFactsForReview();
  const reviewState = getProgramReviewState();
  const todayKey = formatDateKey(new Date());

  const byProgram = {};
  rows.forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const calendarId = String(row[map['Calendar_Source']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!title || !date) return;
    // A LUNCH ROW IS NOT A PROGRAM. It has no calendar event behind it, no
    // tags to disagree about and a form built from the menu rather than the
    // template — every assertion below would fire on it, forty times a month,
    // about a thing that is working exactly as intended.
    if (isLunchOnlyEventId(row[map['Event_ID']])) return;

    const facts = calendarFacts.byProgram[`${calendarId}|${title}`];
    const scope = (facts && facts.isShared) ? SHARED_LOCATION_SCOPE : calendarId;
    const id = programReviewId(scope, title);
    if (!byProgram[id]) {
      byProgram[id] = { id, scope, title, isShared: !!(facts && facts.isShared), rows: [], calendarIds: [] };
    }
    const entry = byProgram[id];
    entry.rows.push(row);
    if (calendarId && entry.calendarIds.indexOf(calendarId) === -1) entry.calendarIds.push(calendarId);
  });

  // A program that exists ONLY on the calendar has no row to have been found
  // above, and is exactly the thing somebody is reviewing to discover: an
  // event added since the last sync, or one whose rows were swept into triage.
  Object.keys(calendarFacts.byProgram).forEach(key => {
    const facts = calendarFacts.byProgram[key];
    const scope = facts.isShared ? SHARED_LOCATION_SCOPE : facts.calendarId;
    const id = programReviewId(scope, facts.title);
    if (byProgram[id]) return;
    byProgram[id] = {
      id, scope, title: facts.title, isShared: facts.isShared, rows: [], calendarIds: [facts.calendarId]
    };
  });

  const programs = Object.keys(byProgram)
    .map(id => describeProgramForReview(byProgram[id], map, calendarFacts, reviewState, todayKey))
    .sort(compareProgramsForReview)
    .slice(0, PROGRAM_REVIEW_LIMIT);

  const summary = {
    total: programs.length,
    problems: programs.filter(p => p.worst === REVIEW_LEVELS.PROBLEM).length,
    warnings: programs.filter(p => p.worst === REVIEW_LEVELS.WARN).length,
    reviewed: programs.filter(p => p.reviewedAt && !p.changedSinceReview).length,
    calendarsUnread: calendarFacts.unreadable
  };
  const formLinks = buildFormLinkageReport(programs);
  summary.formConflicts = formLinks.conflicts.length;
  return { programs, summary, formLinks, ready: true };
}


/**
 * WHICH PROGRAMS ARE ON WHICH FORMS — the whole list, from one side and then
 * the other.
 *
 * WHY IT EXISTS. Every assertion above is about one program in isolation, and
 * the thing that goes wrong after a season of repointing sessions is a
 * relationship BETWEEN programs: two of them quietly sharing a form, or one
 * program's sessions handed out on two different links. Neither is visible from
 * a screen that only ever shows you one program at a time, and neither is
 * visible from the dashboard, where Form_ID is a column of opaque IDs nobody
 * reads across rows.
 *
 * So this inverts the review: form first, then everyone on it.
 *
 * FREE, in the sense that matters here — it reads the programs already
 * described above and opens no forms. The edit URL is built from the ID rather
 * than fetched (FormApp.openById() is a remote round trip each, and forty of
 * them is the minute this whole section exists to avoid); it is the canonical
 * /forms/d/<id>/edit address, which is what Google itself redirects to.
 *
 * THE CONFLICTS ARE THE POINT. Three things are worth saying out loud:
 *
 *   • ONE MONTH, TWO FORMS. Sessions of the same program in the same month
 *     sitting on different forms. This is the one that hurts: two links were
 *     handed out for what people think of as one thing, so half the sign-ups
 *     land somewhere the person reading the other link cannot see.
 *   • ONE FORM, TWO PROGRAMS. A form carrying more than one program's
 *     sessions. Sometimes deliberate; usually a repoint that took the wrong
 *     rows with it, and it means one program's registrants appear under
 *     another's name.
 *   • THE CALENDAR POINTS SOMEWHERE ELSE. The event description advertises a
 *     form the sheet no longer uses, so the public link and the staff link are
 *     different forms.
 */
function buildFormLinkageReport(programs) {
  const byForm = {};
  const order = [];
  const noteForm = (formId, program, how) => {
    if (!formId) return;
    if (!byForm[formId]) {
      byForm[formId] = {
        formId,
        // Built, not fetched — see the note above.
        editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
        programs: [], sessions: 0, onSheet: false, onCalendar: false
      };
      order.push(formId);
    }
    const form = byForm[formId];
    if (how === 'sheet') form.onSheet = true; else form.onCalendar = true;
    let entry = form.programs.filter(e => e.id === program.id)[0];
    if (!entry) {
      entry = {
        id: program.id, title: program.title, locations: program.locations,
        kindLabel: program.sheetTypeLabel, months: [], sessions: 0, onSheet: false, onCalendar: false
      };
      form.programs.push(entry);
    }
    if (how === 'sheet') entry.onSheet = true; else entry.onCalendar = true;
    return entry;
  };

  const conflicts = [];

  (programs || []).forEach(program => {
    (program.formsByMonth || []).forEach(bucket => {
      bucket.formIds.forEach(formId => {
        const entry = noteForm(formId, program, 'sheet');
        if (!entry) return;
        if (entry.months.indexOf(bucket.month) === -1) entry.months.push(bucket.month);
        // Sessions are counted once per month per form: a month split over two
        // forms is a conflict reported below, not a reason to count its
        // sessions twice.
        if (bucket.formIds.length === 1) {
          entry.sessions += bucket.sessions;
          byForm[formId].sessions += bucket.sessions;
        }
      });
      if (bucket.formIds.length > 1) {
        conflicts.push({
          kind: 'split-month',
          programId: program.id,
          level: REVIEW_LEVELS.PROBLEM,
          text: `"${program.title}" has ${bucket.sessions} session(s) in ${bucket.month} spread across ` +
            `${bucket.formIds.length} different forms. Those are the same sessions as far as anybody ` +
            `signing up is concerned, and they were handed two different links. ` +
            `"Move Sessions to Another Form…" puts them back on one.`
        });
      }
    });

    (program.calendarFormIds || []).forEach(formId => {
      noteForm(formId, program, 'calendar');
      if ((program.formIds || []).indexOf(formId) === -1 && (program.formIds || []).length > 0) {
        conflicts.push({
          kind: 'calendar-elsewhere',
          programId: program.id,
          level: REVIEW_LEVELS.WARN,
          text: `"${program.title}" has calendar events pointing at form ${formId}, which is not one of ` +
            `the ${program.formIds.length} form(s) its session rows use. The link the public follows and ` +
            `the form this workbook reads are different forms. A sync rewrites the event links.`
        });
      }
    });
  });

  const forms = order.map(id => byForm[id]).sort((a, b) => {
    // Shared forms first — they are the ones somebody scanning this list is
    // looking for — then by the name of the first program on each.
    if ((a.programs.length > 1) !== (b.programs.length > 1)) return a.programs.length > 1 ? -1 : 1;
    const an = (a.programs[0] || {}).title || '';
    const bn = (b.programs[0] || {}).title || '';
    return an.localeCompare(bn);
  });

  forms.forEach(form => {
    if (form.programs.length < 2) return;
    // ONE NAME AT TWO PLACES IS NOT THE SAME MISTAKE as two names on one form.
    // The first is how a cross-location program is meant to work — one sign-up
    // covering both rooms — and reporting it in the same words as the second
    // would put half the building on this list for working correctly.
    const titles = dedupePreservingOrder(form.programs.map(e => e.title));
    form.sharedAcrossTitles = titles.length > 1;
    conflicts.push({
      kind: 'shared-form',
      programId: form.programs[0].id,
      level: titles.length > 1 ? REVIEW_LEVELS.PROBLEM : REVIEW_LEVELS.WARN,
      text: titles.length > 1
        ? `One form (${form.formId}) carries ${titles.length} differently-named programs — ` +
          `${titles.map(t => `"${t}"`).join(', ')}. One program's registrants are being filed under ` +
          `another's name. "Move Sessions to Another Form…" separates them.`
        : `One form (${form.formId}) carries "${titles[0]}" at ${form.programs.length} locations. That is ` +
          `right for a program taking one sign-up across both rooms — worth confirming it is meant to be.`
    });
  });

  return { forms, conflicts };
}

/** Worst first, then soonest, then by name — the order somebody wants to work down. */
function compareProgramsForReview(a, b) {
  const rank = { problem: 0, warn: 1, ok: 2, info: 2 };
  const ra = rank[a.worst] === undefined ? 2 : rank[a.worst];
  const rb = rank[b.worst] === undefined ? 2 : rank[b.worst];
  if (ra !== rb) return ra - rb;
  if (a.nextDateKey !== b.nextDateKey) return a.nextDateKey < b.nextDateKey ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * One pass over the calendar window, reduced to what the review asks of it:
 * per program, what its events say about it, and per date, whether an event
 * exists at all.
 *
 * `unreadable` names any calendar that could not be read, because every
 * "the calendar does not have this" assertion below would otherwise fire for
 * every program on it — an outage reported forty times as forty missing
 * programs.
 */
function readCalendarFactsForReview() {
  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const byProgram = {};
  const eventDateKeys = {};
  const unreadable = [];
  const todayKey = formatDateKey(new Date());

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) { unreadable.push(CALENDAR_MAP[calendarId]); return; }

    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.isTentative || !parsed.cleanTitle) return;
      const settings = resolveEventSettings(ev, parsed);
      const key = `${calendarId}|${parsed.cleanTitle}`;
      if (!byProgram[key]) {
        byProgram[key] = {
          calendarId, title: parsed.cleanTitle, location: CALENDAR_MAP[calendarId] || '',
          eventCount: 0, taggedShared: 0, dateKeys: {},
          // Counted rather than OR-ed: "some of its events say club" is the
          // fact a half-tagged program needs reported, and a boolean cannot
          // hold it. buildEventGroups() deliberately ORs them for the SYNC —
          // one tagged event means the program is tagged — which is right
          // there and useless here.
          taggedClub: 0, taggedNoReg: 0, taggedAssistance: 0, taggedGrouped: 0, taggedRegular: 0,
          slotMinutes: 0, capacity: 0, maxPerMonth: 0, linkedFormIds: {},
          // LINKS ARE COUNTED ON UPCOMING EVENTS ONLY. The sync window starts
          // at the 1st of the current month, so it always holds some days that
          // have already happened — and a register link is written for dates
          // people can still sign up for. Counting a fortnight of finished
          // sessions as "events with no link" would report every program in
          // the building as broken on the 20th of the month.
          upcomingEvents: 0, linkedEvents: 0
        };
      }
      const p = byProgram[key];
      const dateKey = formatDateKey(ev.getStartTime());
      const upcoming = dateKey >= todayKey;
      p.eventCount++;
      if (upcoming) p.upcomingEvents++;
      p.dateKeys[dateKey] = true;
      if (settings.isShared) p.taggedShared++;
      if (settings.isClub) p.taggedClub++;
      if (settings.noRegistration) p.taggedNoReg++;
      if (settings.isAssistance) p.taggedAssistance++;
      if (settings.isFixed) p.taggedGrouped++; else p.taggedRegular++;
      if (!p.slotMinutes && settings.slotMinutes) p.slotMinutes = settings.slotMinutes;
      if (!p.capacity && settings.capacity) p.capacity = settings.capacity;
      if (!p.maxPerMonth && settings.maxPerMonth) p.maxPerMonth = settings.maxPerMonth;
      const linkedFormId = registrationFormIdInDescription(ev.getDescription());
      if (linkedFormId) {
        if (upcoming) p.linkedEvents++;
        p.linkedFormIds[linkedFormId] = (p.linkedFormIds[linkedFormId] || 0) + 1;
      }
      eventDateKeys[`${calendarId}|${parsed.cleanTitle}|${dateKey}`] = true;
    });
  });

  Object.keys(byProgram).forEach(key => {
    const p = byProgram[key];
    // Shared is the one flag read as ANY, matching buildEventGroups(): an
    // event carrying [All Locations] joins the shared form whatever its
    // neighbours say, so the program IS shared the moment one of them does.
    // The half-tagged case is reported separately, as its own assertion.
    p.isShared = p.taggedShared > 0;
  });

  // The window the calendar was read over, so the assertions can tell "this row
  // has no event" apart from "this row is older than anything we looked at".
  return { byProgram, eventDateKeys, unreadable, windowStartKey: formatDateKey(start),
    windowEndKey: formatDateKey(end) };
}

/**
 * The form ID a calendar event's description currently advertises, or ''.
 *
 * findRegistrationLineInDescription() rather than a fresh regex, so this
 * agrees exactly with what the sync writes and reads — including the
 * pre-anchor format still sitting in descriptions stamped by older versions.
 * A review that disagreed with the sync about what a link is would report
 * missing links on events that have one.
 */
function registrationFormIdInDescription(description) {
  const found = findRegistrationLineInDescription(String(description || ''));
  return found ? found.formId : '';
}


// ---------------------------------------------------------------------------
// THE ASSERTIONS
// ---------------------------------------------------------------------------

/**
 * One program, described and checked.
 *
 * The facts are gathered first and the assertions read only those facts, so
 * every check below is a pure statement about two numbers rather than another
 * pass over the calendar.
 */
function describeProgramForReview(entry, map, calendarFacts, reviewState, todayKey) {
  const facts = gatherProgramFacts(entry, map, calendarFacts, todayKey);
  const checks = [];
  assertProgramKind(facts, checks);
  assertSessionsAgree(facts, checks);
  assertFormsMatchKind(facts, checks);
  assertLinksMatchKind(facts, checks);
  assertAppointmentSettings(facts, checks);
  assertSharedConsistently(facts, checks);
  assertCalendarAndSheetLineUp(facts, checks);
  assertCapacityIsSane(facts, checks);

  const worst = [REVIEW_LEVELS.PROBLEM, REVIEW_LEVELS.WARN, REVIEW_LEVELS.OK]
    .filter(level => checks.some(c => c.level === level))[0] || REVIEW_LEVELS.OK;

  const fingerprint = programReviewFingerprint(facts);
  const mark = reviewState[entry.id] || null;
  return {
    id: entry.id,
    title: facts.title,
    locations: facts.locations,
    isShared: facts.isShared,
    sessionCount: facts.sessionCount,
    upcomingCount: facts.upcomingCount,
    eventCount: facts.eventCount,
    firstDateLabel: facts.firstDateLabel,
    lastDateLabel: facts.lastDateLabel,
    nextDateKey: facts.nextDateKey,
    // The UPCOMING dates, soonest first — the ones somebody reviewing this
    // program is about to be asked about. A list that opens with last
    // October pushes next week off the end of it.
    dateLabels: facts.upcomingDateLabels.slice(0, 12),
    moreDates: Math.max(0, facts.upcomingDateLabels.length - 12),
    sheetTypeKey: facts.sheetType.key,
    sheetTypeLabel: facts.sheetType.label,
    calendarTypeKey: facts.calendarType.key,
    calendarTypeLabel: facts.calendarType.label,
    formIds: facts.formIds,
    formCount: facts.formIds.length,
    // WHICH FORM COVERS WHICH MONTH, and which form its calendar events
    // actually advertise. Both are what the forms-and-programs list at the end
    // of the review is built from — see buildFormLinkageReport().
    formsByMonth: facts.formsByMonth,
    calendarFormIds: facts.calendarFormIds,
    registered: facts.registered,
    waitlisted: facts.waitlisted,
    capacity: facts.capacity,
    slotMinutes: facts.slotMinutes,
    timeBlockDays: facts.timeBlockDays,
    checks,
    worst,
    fingerprint,
    reviewedAt: mark ? mark.at : '',
    reviewedBy: mark ? mark.by : '',
    changedSinceReview: !!(mark && mark.fingerprint !== fingerprint)
  };
}

/** Everything the assertions read, gathered once. */
function gatherProgramFacts(entry, map, calendarFacts, todayKey) {
  const rows = entry.rows;
  const calendarParts = entry.calendarIds
    .map(id => calendarFacts.byProgram[`${id}|${entry.title}`])
    .filter(Boolean);

  const sum = key => calendarParts.reduce((n, p) => n + (p[key] || 0), 0);
  const eventCount = sum('eventCount');

  const dates = rows.map(row => coerceDate(row[map['Event_Date']])).filter(Boolean)
    .sort((a, b) => a - b);
  const upcoming = dates.filter(d => formatDateKey(d) >= todayKey);
  const locations = distinctLocations(rows.map(row => String(row[map['Location']] || '').trim())
    .concat(calendarParts.map(p => p.location)));

  // WHAT THE SHEET SAYS, read as ANY rather than as every — the same reading
  // buildEventGroups() gives the calendar, so the two can be compared at all.
  // Whether the rows agree with EACH OTHER is a separate assertion, which is
  // where the disagreement gets reported.
  const sheetState = {
    typeTag: rows.some(row => isGroupedTypeTag(row[map['Type_Tag']]))
      ? EVENT_TYPES.GROUPED : EVENT_TYPES.REGULAR,
    isClub: rows.some(row => isClubColumnValue(row[map['Club']])),
    noRegistration: rows.some(row => isNoRegistrationColumnValue(row[map['No_Registration']])),
    isAssistance: map['Personalized_Assistance'] !== undefined &&
      rows.some(row => isAssistanceColumnValue(row[map['Personalized_Assistance']]))
  };
  const calendarState = {
    typeTag: sum('taggedGrouped') > 0 ? EVENT_TYPES.GROUPED : EVENT_TYPES.REGULAR,
    isClub: sum('taggedClub') > 0,
    noRegistration: sum('taggedNoReg') > 0,
    isAssistance: sum('taggedAssistance') > 0
  };

  // THE REVIEW IS ABOUT WHAT IS STILL ACTIONABLE, so the form arithmetic reads
  // the UPCOMING rows only. The dashboard keeps every session a program ever
  // had: a program running since last autumn covers ten months and has ten
  // forms, and comparing those two numbers says nothing anybody can act on
  // while burying the one month that is actually wrong. Nobody can re-split
  // last April.
  const isUpcomingRow = row => {
    const date = coerceDate(row[map['Event_Date']]);
    return !!date && formatDateKey(date) >= todayKey;
  };
  const upcomingRows = rows.filter(isUpcomingRow);
  const formIds = dedupePreservingOrder(upcomingRows.map(row => String(row[map['Form_ID']] || '').trim())
    .filter(Boolean));
  const monthsCovered = dedupePreservingOrder(upcoming.map(d => getMonthLabel(d)));

  // WHICH FORM COVERS WHICH MONTH. The form arithmetic above counts forms; this
  // says which sessions are on which of them, because the counts cannot tell
  // "two months, two forms" (right) from "one month split across two forms"
  // (the thing that hands two different links to people signing up for the same
  // sessions). Grouped by month because a month is the unit a monthly form is
  // supposed to cover.
  const formsByMonthIndex = {};
  const monthOrder = [];
  upcomingRows.forEach(row => {
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    const month = getMonthLabel(date);
    if (!formsByMonthIndex[month]) { formsByMonthIndex[month] = { month, formIds: [], sessions: 0 }; monthOrder.push(month); }
    const bucket = formsByMonthIndex[month];
    bucket.sessions++;
    const formId = String(row[map['Form_ID']] || '').trim();
    if (formId && bucket.formIds.indexOf(formId) === -1) bucket.formIds.push(formId);
  });
  const formsByMonth = monthOrder.map(month => formsByMonthIndex[month]);

  // WHAT ITS CALENDAR EVENTS ADVERTISE, which is the other half of the same
  // question: the sheet's Form_ID is what this workbook believes, and the link
  // in the event description is what the public is actually handed. They are
  // written by the same sync and can still come apart — a form rebuilt while
  // one calendar was unreadable leaves the old link on those events forever.
  const calendarFormIds = dedupePreservingOrder(
    calendarParts.reduce((out, part) => out.concat(Object.keys(part.linkedFormIds || {})), []));

  return {
    id: entry.id,
    title: entry.title,
    scope: entry.scope,
    isShared: entry.isShared,
    calendarIds: entry.calendarIds,
    calendarParts,
    locations,
    rows,
    map,
    sessionCount: rows.length,
    upcomingCount: upcoming.length,
    upcomingRows,
    eventCount,
    dates,
    dateLabels: dates.map(d => formatDateLabel(d)),
    upcomingDateLabels: upcoming.map(d => formatDateLabel(d)),
    monthsCovered,
    firstDateLabel: dates.length > 0 ? formatDateLabel(dates[0]) : '',
    lastDateLabel: dates.length > 0 ? formatDateLabel(dates[dates.length - 1]) : '',
    // Sorts a program with nothing upcoming to the bottom of its severity
    // band rather than the top: it is the least urgent thing on the list.
    nextDateKey: upcoming.length > 0 ? formatDateKey(upcoming[0]) : '9999-12-31',
    sheetState,
    calendarState,
    sheetType: resolveProgramFormType(sheetState),
    calendarType: resolveProgramFormType(calendarState),
    formIds,
    formsByMonth,
    calendarFormIds,
    linkedEvents: sum('linkedEvents'),
    upcomingEvents: sum('upcomingEvents'),
    // Upcoming, like the rest of the review: "62 registered" over a year of
    // history is a number nobody can act on, and it hides the four people
    // signed up for next week.
    registered: upcomingRows.reduce((n, row) => n + (Number(row[map['Active_Count']]) || 0), 0),
    waitlisted: upcomingRows.reduce((n, row) => n + (Number(row[map['Waitlist_Count']]) || 0), 0),
    capacity: upcomingRows.reduce((n, row) => Math.max(n, Number(row[map['Max_Capacity']]) || 0), 0),
    slotMinutes: rows.reduce((n, row) =>
      n || (map['Slot_Minutes'] === undefined ? 0 : Number(row[map['Slot_Minutes']]) || 0), 0) ||
      calendarParts.reduce((n, p) => n || p.slotMinutes, 0),
    calendarUnreadable: calendarFacts.unreadable.length > 0 && calendarParts.length === 0,
    // Dates where the sheet has a row and the calendar has no event, and the
    // other way round. Computed here so the assertion is a comparison of two
    // lists rather than a third pass.
    // ONLY ROWS INSIDE THE WINDOW THE CALENDAR WAS READ OVER. That window
    // starts at the 1st of the current month, and the dashboard holds every
    // session this program has ever had — so testing an April row against a
    // calendar nobody looked at April on reports the whole of last season as
    // "no calendar event behind it", on every program, forever.
    rowsWithoutEvents: rows.filter(row => {
      const date = coerceDate(row[map['Event_Date']]);
      const calendarId = String(row[map['Calendar_Source']] || '').trim();
      if (!date || !calendarId) return false;
      const dateKey = formatDateKey(date);
      if (dateKey < calendarFacts.windowStartKey || dateKey > calendarFacts.windowEndKey) return false;
      return !calendarFacts.eventDateKeys[`${calendarId}|${entry.title}|${dateKey}`];
    }).map(row => formatDateLabel(coerceDate(row[map['Event_Date']]))),
    eventsWithoutRows: calendarParts.reduce((out, part) => {
      const known = {};
      rows.forEach(row => {
        const date = coerceDate(row[map['Event_Date']]);
        if (date && String(row[map['Calendar_Source']] || '').trim() === part.calendarId) {
          known[formatDateKey(date)] = true;
        }
      });
      Object.keys(part.dateKeys).forEach(key => { if (!known[key]) out.push(`${key} (${part.location})`); });
      return out;
    }, []),
    timeBlockDays: countTimeBlockDaysForProgram(entry, calendarFacts)
  };
}

/**
 * How many of this program's days are typed as a run of back-to-back blocks
 * rather than as one event — see section 12.
 *
 * Counted from the dateKeys already gathered rather than by re-reading the
 * calendar: a day with more events than the sheet has rows for it is exactly
 * the collision computeEventId() cannot represent, whatever the block lengths
 * turn out to be. The dialog's merge action re-derives the real runs before
 * touching anything.
 */
function countTimeBlockDaysForProgram(entry, calendarFacts) {
  let days = 0;
  entry.calendarIds.forEach(calendarId => {
    const part = calendarFacts.byProgram[`${calendarId}|${entry.title}`];
    if (!part) return;
    const dayCount = Object.keys(part.dateKeys).length;
    // More events than distinct days means at least one day carries several.
    if (part.eventCount > dayCount) days += part.eventCount - dayCount;
  });
  return days;
}

/** What was true when somebody last looked — see the section note on review marks. */
function programReviewFingerprint(facts) {
  return [
    facts.sheetType.key, facts.calendarType.key,
    facts.sessionCount, facts.eventCount, facts.formIds.length,
    facts.slotMinutes, facts.capacity, facts.isShared ? 'shared' : 'own'
  ].join('/');
}

/** A tick or a sentence, with the fix on it where there is one. */
function reviewCheck(level, text, fix) {
  const check = { level, text };
  if (fix) check.fix = fix;
  return check;
}

/**
 * ASSERT: the sheet and the calendar agree about what kind of program this
 * is.
 *
 * This is the one that goes wrong most, and it goes wrong invisibly. The
 * calendar description is the source of truth — resolveEventSettings() reads
 * it on every sync — so a checkbox ticked without reaching the calendar is
 * quietly reverted, and a tag typed into a description by hand is quietly
 * adopted. Either way the dashboard is a report on the calendar rather than a
 * control over it, and nothing anywhere says which of the two somebody meant.
 */
function assertProgramKind(facts, checks) {
  if (facts.calendarUnreadable) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `The calendar this program lives on could not be read, so nothing below compares it with the ` +
      `sheet. Try again in a moment.`));
    return;
  }
  if (facts.eventCount === 0) {
    // A PROGRAM THAT HAS FINISHED IS NOT A BROKEN ONE. The dashboard keeps
    // every session a program ever had; the calendar is read from the 1st of
    // the current month forward. So last season's twelve-week course has rows
    // and no events, and reporting that as a problem would put every finished
    // program in the building at the top of the list — permanently, and
    // ahead of the ones that are actually wrong.
    if (facts.upcomingCount === 0) {
      checks.push(reviewCheck(REVIEW_LEVELS.INFO,
        `Finished — ${facts.sessionCount} past session(s) on the dashboard and nothing upcoming. ` +
        `Its rows are history, and there is nothing left to check.`));
      return;
    }
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `No calendar event for "${facts.title}" anywhere in the sync window, but ${facts.upcomingCount} ` +
      `of its session rows are still UPCOMING. Either the events were deleted or the program was ` +
      `renamed on the calendar and the rows were left behind under the old name.`));
    return;
  }
  if (facts.sessionCount === 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${facts.eventCount} calendar event(s), and no session row for any of them — this program has ` +
      `never been imported. Run "Update Everything Now".`, 'sync'));
    return;
  }

  if (facts.sheetType.key === facts.calendarType.key) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK,
      `The sheet and the calendar agree: ${facts.sheetType.label.toLowerCase()}.`));
    return;
  }
  checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
    `The sheet says "${facts.sheetType.label}" and the calendar says "${facts.calendarType.label}". ` +
    `The calendar wins on the next sync, so the sheet's answer will be thrown away unless it is ` +
    `written out. Pick the one you meant below and press Apply.`, 'kind'));
}

/**
 * ASSERT: every session of the program says the same thing as every other.
 *
 * Half a program tagged is not a setting, it is an edit that stopped
 * halfway — and because buildEventGroups() reads these as ANY, one tagged
 * event makes the whole program tagged. So a half-tagged program behaves
 * as though it were fully tagged while LOOKING, on the dashboard, as though
 * somebody had made a deliberate distinction between its dates.
 */
function assertSessionsAgree(facts, checks) {
  if (facts.eventCount < 2) return;
  const disagreements = [];
  const part = key => facts.calendarParts.reduce((n, p) => n + (p[key] || 0), 0);

  [
    { on: part('taggedClub'), word: 'a club' },
    { on: part('taggedNoReg'), word: 'no-registration' },
    { on: part('taggedAssistance'), word: 'appointments' }
  ].forEach(item => {
    if (item.on > 0 && item.on < facts.eventCount) {
      disagreements.push(`${item.on} of its ${facts.eventCount} events say ${item.word}`);
    }
  });
  const grouped = part('taggedGrouped');
  if (grouped > 0 && grouped < facts.eventCount) {
    disagreements.push(`${grouped} of its ${facts.eventCount} events say one form for the whole series`);
  }

  if (disagreements.length === 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK, `All ${facts.eventCount} of its calendar events say the same thing.`));
    return;
  }
  checks.push(reviewCheck(REVIEW_LEVELS.WARN,
    `Its calendar events disagree with each other — ${disagreements.join('; ')}. One tagged event is ` +
    `read as tagging the whole program, so it already behaves as if they all said so. Applying a kind ` +
    `below writes the same answer onto every one of them.`, 'kind'));
}

/**
 * ASSERT: it has as many forms as its kind implies.
 *
 * A monthly program has one form per calendar month it covers; a series has
 * exactly one; a drop-in has none. More than that is what "a lot of editing"
 * leaves behind — a form rebuilt, sessions repointed, a month re-split — and
 * the visible symptom is people registering on a link that covers half the
 * dates the newsletter advertised.
 */
function assertFormsMatchKind(facts, checks) {
  const kind = facts.sheetType.key;
  const forms = facts.formIds.length;

  if (kind === 'DROP_IN') {
    if (forms === 0) {
      checks.push(reviewCheck(REVIEW_LEVELS.OK, 'It takes no registration, and has no form. Correct.'));
    } else {
      checks.push(reviewCheck(REVIEW_LEVELS.WARN,
        `It is marked "no registration" but ${forms} of its session rows still point at a form. The form ` +
        `stops accepting responses on the next sync; the rows keep the ID so it can be re-opened if the ` +
        `mark comes off.`));
    }
    return;
  }

  // Upcoming rows only, like everything else in this check: a session in
  // February with no form is not something anybody can now do anything about,
  // and reporting it would bury the March one that is.
  const upcomingRows = facts.upcomingRows || facts.rows;
  const missing = upcomingRows.filter(row => !String(row[facts.map['Form_ID']] || '').trim()).length;
  if (missing > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${missing} of its ${upcomingRows.length} upcoming session rows have no form at all — nobody can ` +
      `register for those dates. Run "Update Everything Now" to build them.`, 'sync'));
  }
  if (forms === 0 || upcomingRows.length === 0) return;

  const expected = (kind === 'SERIES' || kind === 'CLUB_SERIES') ? 1 : facts.monthsCovered.length;
  const expectedWord = expected === 1 ? 'one form' : `${expected} forms`;
  const reason = (kind === 'SERIES' || kind === 'CLUB_SERIES')
    ? 'one form for the whole series'
    : `one per calendar month, and it has dates in ${facts.monthsCovered.length} month(s) from here on`;

  if (forms === expected) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK, `It has ${expectedWord}, which is ${reason}.`));
  } else if (forms > expected) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `It has ${forms} forms where its kind implies ${expectedWord} (${reason}). Extra forms are what a ` +
      `re-split leaves behind — its dates are spread across links people were handed at different times. ` +
      `"Move Sessions to Another Form…" puts them back on one.`, 'repoint'));
  } else {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `It has ${forms} form(s) covering ${facts.monthsCovered.length} upcoming month(s). A monthly ` +
      `program normally gets a fresh form each month so its dates and menu stay current.`));
  }
}

/**
 * ASSERT: its calendar events carry a register link, or deliberately do not.
 *
 * The link is what the public actually uses — the dashboard's "View Live Form"
 * column is staff-facing. An event with a form but no link on it is a
 * program nobody can find, and it is invisible from every screen in this
 * workbook.
 */
function assertLinksMatchKind(facts, checks) {
  // UPCOMING EVENTS ONLY, on both sides of every comparison here. A register
  // link is for a date somebody can still sign up for, and the sync window
  // always holds part of a month that has already happened — so counting
  // finished sessions as unlinked would report every program in the building
  // as broken by the 20th.
  const total = facts.upcomingEvents;
  if (total === 0) return;
  const kind = facts.sheetType.key;

  if (kind === 'DROP_IN') {
    if (facts.linkedEvents === 0) {
      checks.push(reviewCheck(REVIEW_LEVELS.OK, 'No "register here" link on its upcoming events, which is right for a drop-in.'));
    } else {
      checks.push(reviewCheck(REVIEW_LEVELS.WARN,
        `${facts.linkedEvents} of its upcoming events still carry a "register here" link, which tells ` +
        `people to sign up for something nobody is keeping a list for. The next sync removes them.`, 'sync'));
    }
    return;
  }

  if (facts.linkedEvents >= total) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK, `All ${total} of its upcoming events carry a register link.`));
  } else if (facts.linkedEvents === 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `None of its ${total} upcoming events carries a register link. Anybody looking at the ` +
      `calendar has no way to sign up. Run "Update Everything Now", or 🔧 Admin ▸ Rewrite Event Links.`, 'sync'));
  } else {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${facts.linkedEvents} of its ${total} upcoming events carry a register link — the rest ` +
      `have none. Run "Update Everything Now" to stamp the others.`, 'sync'));
  }
}

/**
 * ASSERT: an appointment program is set up as one.
 *
 * Three things have to be true together for a day of appointments to work, and
 * each of them is invisible on its own: the tag, a slot length, and a day
 * that is ONE event rather than seven back-to-back blocks (see section 12).
 * The third is the one that silently breaks the other two.
 */
function assertAppointmentSettings(facts, checks) {
  if (facts.timeBlockDays > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${facts.timeBlockDays} of its calendar events sit on a day that already has another event of the ` +
      `same name. A session is identified by its calendar, its name and its DATE — so those events are ` +
      `all the same session, and the dashboard row is showing whichever one the last sync happened to ` +
      `write. If they run back to back, merging them into one event is what makes the day readable. ` +
      `If they are genuinely separate — a morning class and an afternoon one — give them different ` +
      `names on the calendar ("${facts.title} (Morning)"), which is the only way this can tell them ` +
      `apart.`, 'merge'));
  }
  if (facts.sheetType.key !== 'APPOINTMENTS') return;

  if (facts.slotMinutes > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK,
      `Appointments are ${facts.slotMinutes} minutes long.`));
  } else {
    checks.push(reviewCheck(REVIEW_LEVELS.INFO,
      `No appointment length is stated, so ${APPOINTMENT_SLOT_MINUTES} minutes is being used. Put ` +
      `"[Slots: 20]" in the event description to change it.`));
  }
}

/**
 * ASSERT: it is shared across locations everywhere or nowhere.
 *
 * A half-shared program is the one genuinely ambiguous state in the tag
 * system: the tagged events pool onto a shared form and the untagged ones keep
 * their own, so the program has two forms and neither covers all its dates.
 * warnAboutPartiallySharedPrograms() says so during a sync; this says so on
 * demand, next to the rest of what is wrong with the same program.
 */
function assertSharedConsistently(facts, checks) {
  const shared = facts.calendarParts.reduce((n, p) => n + (p.taggedShared || 0), 0);
  if (shared === 0) return;
  if (shared === facts.eventCount) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK,
      `Every one of its events is tagged [All Locations], so all of them share one form.`));
    return;
  }
  checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
    `${shared} of its ${facts.eventCount} events are tagged [All Locations] and the rest are not. The ` +
    `tagged ones pool onto a shared form and the others keep their own, so no single link covers all its ` +
    `dates. "Link Program Across Locations…" tags them all, or untags them all.`));
}

/**
 * ASSERT: the sheet's rows and the calendar's events are the same set of days.
 *
 * A row with no event behind it is a date people can still register for that
 * nobody is running; an event with no row is a date nobody can register for at
 * all. Both are produced by ordinary calendar editing, and neither shows up
 * anywhere until somebody turns up on the day.
 */
function assertCalendarAndSheetLineUp(facts, checks) {
  if (facts.eventCount === 0 || facts.sessionCount === 0) return; // already reported, bigger

  if (facts.rowsWithoutEvents.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${facts.rowsWithoutEvents.length} session row(s) have no calendar event behind them any more ` +
      `(${facts.rowsWithoutEvents.slice(0, 4).join(', ')}` +
      `${facts.rowsWithoutEvents.length > 4 ? ', …' : ''}). People can still register for those dates. ` +
      `Deleting the event should have swept them to Triage — check that tab.`));
  }
  if (facts.eventsWithoutRows.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${facts.eventsWithoutRows.length} calendar event(s) have no session row ` +
      `(${facts.eventsWithoutRows.slice(0, 4).join(', ')}` +
      `${facts.eventsWithoutRows.length > 4 ? ', …' : ''}) — nobody can register for them. ` +
      `Run "Update Everything Now".`, 'sync'));
  }
  if (facts.rowsWithoutEvents.length === 0 && facts.eventsWithoutRows.length === 0) {
    // "Over the window" said out loud, because the two numbers are not
    // comparable without it: the dashboard holds every session this program
    // ever had, and the calendar was read from the 1st of this month forward.
    checks.push(reviewCheck(REVIEW_LEVELS.OK,
      `Its ${facts.eventCount} calendar event(s) from this month on all have a session row, and none ` +
      `of its rows in that stretch has lost its event.`));
  }
}

/**
 * ASSERT: nobody is waitlisted behind an empty room, and nobody is booked into
 * a room that cannot hold them.
 *
 * Both are arithmetic the dashboard already carries and nobody adds up: a
 * capacity typed down after people registered, or a cap left on a program
 * that has since moved to a bigger room.
 */
function assertCapacityIsSane(facts, checks) {
  if (facts.capacity <= 0) {
    if (facts.registered > 0) {
      checks.push(reviewCheck(REVIEW_LEVELS.INFO,
        `${facts.registered} registered, no capacity set — nobody will ever be waitlisted. Put ` +
        `"[Cap: 12]" in the event description to cap it.`));
    }
    return;
  }
  // Upcoming rows only. A session that overflowed last November is a fact about
  // a room somebody has already stood in.
  const rows = facts.upcomingRows || facts.rows;
  const overfull = rows.filter(row => {
    const cap = Number(row[facts.map['Max_Capacity']]) || 0;
    const active = Number(row[facts.map['Active_Count']]) || 0;
    return cap > 0 && active > cap;
  }).length;
  if (overfull > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${overfull} of its upcoming sessions have more people registered than the capacity allows. That ` +
      `happens when a cap is typed down after people had already signed up — nobody is turned away by ` +
      `it, but the room may not hold them.`));
  }
  if (facts.waitlisted > 0) {
    const seatsFree = rows.some(row =>
      (Number(row[facts.map['Remaining_Seats']]) || 0) > 0);
    if (seatsFree) {
      checks.push(reviewCheck(REVIEW_LEVELS.WARN,
        `${facts.waitlisted} person/people are waitlisted while some of its sessions still have seats ` +
        `free. Worth a look — a waitlist on one date and space on another is often somebody who would ` +
        `take the other date.`));
    }
  }
}


// ---------------------------------------------------------------------------
// THE ACTIONS  (what a button on the review actually does)
// ---------------------------------------------------------------------------

/**
 * Sets one program's kind — on the calendar AND on the sheet, now.
 *
 * THE CALENDAR FIRST, and that is the whole point of doing it here rather than
 * by ticking boxes. resolveEventSettings() reads the description on every
 * sync, so the description is what a kind IS; a checkbox that has not reached
 * the calendar is an intention, and the next sync throws it away. Every one of
 * the four controls is written out — including the ones being turned OFF,
 * which is what makes "this is a drop-in now" actually remove [Club].
 *
 * Then the dashboard, straight away, rather than an hour later: somebody
 * reviewing forty programs has to be able to see that the one they just
 * changed has changed.
 *
 * `options.deferFinish` is what the batched apply passes: it leaves the digest
 * unflushed and drops the "now run Update Everything Now" advice, because the
 * batch flushes once at the end and IS the update. Everything else — the
 * calendar stamps, the queue drop, the dashboard rows — is identical, so a
 * batch of one does exactly what pressing the button used to do.
 *
 * Returns { ok, message, stamped }.
 */
function applyProgramKind(programId, typeKey, options) {
  const deferFinish = !!(options && options.deferFinish);
  const settings = programFormTypeSettings(typeKey);
  if (!settings) return { ok: false, message: '⚠️ That is not one of the kinds.' };
  const type = getProgramFormType(typeKey);

  const at = String(programId || '').indexOf('::');
  if (at === -1) return { ok: false, message: '⚠️ Could not tell which program that is.' };
  const scope = programId.substring(0, at);
  const title = programId.substring(at + 2);
  if (!title) return { ok: false, message: '⚠️ Could not tell which program that is.' };

  // A shared program has no single calendar of its own, so its stamp goes
  // out from every calendar that carries it — stampProgramFlagOnCalendar()
  // already walks the others when the events say [All Locations], and
  // starting from each in turn is what covers a program whose tag is on
  // some calendars and not others.
  const calendarIds = scope === SHARED_LOCATION_SCOPE ? Object.keys(CALENDAR_MAP) : [scope];
  let stamped = 0;
  let failures = 0;

  withCalendarChangeTriggersPaused(`Set "${title}" to ${type.label}`, () => {
    calendarIds.forEach(calendarId => {
      PROGRAM_FLAG_COLUMNS.forEach(flag => {
        const on = !!settings[flag.groupKey];
        const outcome = stampProgramFlagOnCalendar(title, calendarId, flag, on);
        if (!outcome.ok) { failures++; return; }
        stamped += outcome.stamped;
      });
      // LAST, because it is the only one that rewrites a bracket rather than
      // adding or removing a word: doing it first would have the flag writes
      // above reading a description mid-edit.
      stamped += stampTypeTagOnCalendar(title, calendarId, settings.typeTag);
    });
  });

  if (failures > 0 && stamped === 0) {
    return { ok: false, message: `⚠️ Nothing was changed — the calendar could not be read. Try again in a moment.` };
  }

  // A TICK STILL SITTING IN THE QUEUE IS NOW OUT OF DATE, and it would be
  // delivered later as though it were the newer instruction. The queue exists
  // because a checkbox cannot reach a calendar on its own (see
  // PENDING_FLAG_SHEET_NAME); this call HAS reached the calendar, so anything
  // queued for the same program has been superseded by it and must not be
  // stamped back over the top an hour from now.
  dropPendingFlagsForProgram(title, calendarIds);

  const rowsChanged = writeProgramKindOntoRows(title, calendarIds, settings);
  if (!deferFinish) flushAdminDigest('Program review');
  const message = `✅ "${title}" is now ${type.label.toLowerCase()}. ` +
    (stamped > 0 ? `${stamped} calendar event(s) retagged. ` : `The calendar already said so. `) +
    (rowsChanged > 0 ? `${rowsChanged} dashboard row(s) updated. ` : '') +
    (deferFinish ? '' : `Run "Update Everything Now" to rebuild its form in the new shape.`);
  log(`applyProgramKind: ${message}`);
  return { ok: true, message, stamped, rowsChanged };
}

/**
 * Brings one program's dashboard rows into line with a kind that has just
 * been written to its calendar.
 *
 * Cosmetic in the strict sense — the next sync would recompute all of it from
 * the calendar — and worth doing anyway, because the alternative is a review
 * screen that says "changed" while the row behind it still says the old thing
 * for an hour. Reviewing forty programs against a sheet that lags the
 * calendar is exactly the confusion this whole tool exists to end.
 */
function writeProgramKindOntoRows(title, calendarIds, settings) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return 0;
  const headerRows = findProgramSessionHeaderRows(sheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(sheet, headerRows[0]); // 1-based
  if (!sheetMap['Clean_Title'] || !sheetMap['Calendar_Source'] || !sheetMap['Type_Tag'] ||
    !sheetMap['Event_Date']) {
    return 0; // a workbook still on an older layout — the sync will catch up
  }

  const wanted = {
    Type_Tag: settings.typeTag,
    Club: settings.isClub,
    No_Registration: settings.noRegistration,
    Personalized_Assistance: settings.isAssistance
  };
  const wantedCalendars = {};
  calendarIds.forEach(id => { wantedCalendars[id] = true; });

  let changed = 0;
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(sheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone || zone.count === 0) return;

    const titles = sheet.getRange(zone.start, sheetMap['Clean_Title'], zone.count, 1).getValues();
    const sources = sheet.getRange(zone.start, sheetMap['Calendar_Source'], zone.count, 1).getValues();
    const targets = [];
    for (let r = 0; r < zone.count; r++) {
      if (String(titles[r][0] || '').trim() !== title) continue;
      if (!wantedCalendars[String(sources[r][0] || '').trim()]) continue;
      targets.push(r);
    }
    if (targets.length === 0) return;

    Object.keys(wanted).forEach(header => {
      const col = sheetMap[header];
      if (!col) return; // a workbook still on the older layout
      const range = sheet.getRange(zone.start, col, zone.count, 1);
      const values = range.getValues();
      let touched = false;
      targets.forEach(r => {
        if (values[r][0] === wanted[header]) return;
        values[r] = [wanted[header]];
        touched = true;
      });
      if (touched) {
        range.setValues(values);
        invalidateSectionedRowsCache(sheet);
        changed += targets.length;
      }
    });
  });
  return changed;
}

/**
 * Records that somebody has looked at these programs, and what was true when
 * they did.
 *
 * TAKES THE WHOLE LIST, because the review is walked with the marks held in the
 * browser and applied in one go at the end — forty separate calls would be
 * forty reads and forty writes of the same one property, which is exactly the
 * per-program round trip this screen exists to stop.
 *
 * `marks` is [{ id, fingerprint }].
 */
function markProgramsReviewed(marks) {
  const list = (marks || []).filter(m => m && m.id);
  if (list.length === 0) return 0;
  const state = getProgramReviewState();
  const at = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm');
  const by = getCurrentUserEmail() || '';
  list.forEach(mark => {
    state[mark.id] = { at, by, fingerprint: String(mark.fingerprint || '') };
  });
  saveProgramReviewState(state);
  return list.length;
}

/** One program's mark. The list form above is what the review actually uses. */
function markProgramReviewed(programId, fingerprint) {
  markProgramsReviewed([{ id: programId, fingerprint }]);
  return true;
}

/**
 * Forgets every queued tick for one program.
 *
 * Called when a kind has just been written straight to the calendar, which is
 * the thing the queue was holding those ticks in order to eventually do. A
 * queued entry that survives is not a pending instruction any more; it is an
 * older answer waiting to overwrite a newer one.
 */
function dropPendingFlagsForProgram(title, calendarIds) {
  const wanted = {};
  (calendarIds || []).forEach(id => { wanted[id] = true; });
  const stale = readPendingProgramFlags()
    .filter(entry => entry.title === title && wanted[entry.calendarId]);
  if (stale.length === 0) return 0;
  clearPendingProgramFlags(stale);
  log(`Dropped ${stale.length} queued tick(s) for "${title}" — the review has just written the ` +
    `calendar directly, so they are superseded.`);
  return stale.length;
}

/** Takes the mark off one program, or off all of them. */
function clearProgramReviewed(programId) {
  if (!programId) { saveProgramReviewState({}); return 0; }
  const state = getProgramReviewState();
  delete state[programId];
  saveProgramReviewState(state);
  return 1;
}


// ---------------------------------------------------------------------------
// THE DIALOG  (🗓️ Programs & Forms ▸ Review Programs, Then Update Once…)
// ---------------------------------------------------------------------------

/**
 * MENU ENTRY: walk the programs, one screen each, and apply the lot at the end.
 *
 * THE WHOLE REVIEW IS SENT TO THE BROWSER AT ONCE, and this is deliberate.
 * Reviewing forty programs means pressing Next forty times, and a round trip
 * per press turns a five-minute job into a twenty-minute one — with a spinner
 * between every program and the next. The review is two sheet reads and one
 * calendar pass; sending all of it costs one wait at the start and none after
 * that.
 *
 * AND THE DECISIONS COME BACK THE SAME WAY — all at once, in a single call, at
 * the end. See reviewApplyPlan(): the browser holds every choice and none of
 * them touches the calendar until Apply, so there is exactly one wait in the
 * whole session and it is the one somebody is expecting.
 */
function showProgramReviewDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const review = buildProgramReview();
  const html = HtmlService.createHtmlOutput(buildProgramReviewHtml(review))
    .setWidth(760)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Review Programs');
}

/** Re-runs the review and hands the browser a fresh payload, without reopening the dialog. */
function refreshProgramReview() {
  return JSON.stringify(buildProgramReview());
}

/** Called from the dialog's "clear all marks" link. */
function reviewClearAllMarks() {
  clearProgramReviewed(null);
  return JSON.stringify({ message: 'Every review mark cleared.', ok: true, review: buildProgramReview() });
}

/**
 * THE ONE BIG APPLY: every decision made while walking the review, carried out
 * in a single pass, followed by a single update of the sheet and the calendar.
 *
 * WHY THIS SHAPE. Each decision on this screen — a kind changed, a day of
 * blocks merged — is a handful of calendar writes and then a sync to rebuild
 * the form behind it. Applying them one at a time meant a wait between one
 * program and the next, forty times over, and each of those syncs re-read
 * every calendar and every form in the workbook to publish the effect of a
 * single retag. The work is the same whether it is done once or forty times;
 * only the waiting multiplies.
 *
 * So the decisions are held in the browser, where they cost nothing, and this
 * runs them all at the end:
 *
 *   1. every kind, then every merge, inside ONE quiet window — the
 *      calendar-edit triggers are paused once rather than torn down and
 *      rebuilt per program (see withCalendarChangeTriggersPaused);
 *   2. ONE sync, which is what rebuilds the forms, rewrites the event links
 *      and brings the dashboard into line with all of it at once;
 *   3. ONE admin digest, so the log reads as the one operation it was;
 *   4. the review marks, stamped with what is true AFTERWARDS rather than what
 *      was on screen before — a mark carrying the old fingerprint would
 *      announce itself as "reviewed, but it has changed since" the instant it
 *      was written, which is true of every program in the batch and useful
 *      about none of them.
 *
 * NOTHING IS APPLIED TWICE. A plan is a set of decisions, so the same program
 * appearing twice in it is the later answer replacing the earlier one, not two
 * stamps.
 *
 * AND RE-SENDING THE SAME PLAN IS SAFE, which is what makes one long call an
 * acceptable thing to hang a session on. Every step here is idempotent —
 * applyProgramKind() stamps what the description should say and reports "the
 * calendar already said so" when it already does, and a merged day has no
 * back-to-back blocks left to merge. So if this call dies partway (a six-minute
 * execution limit is the realistic way), the dialog keeps the plan and pressing
 * Apply again finishes the job rather than doing the first half twice.
 *
 * `plan` is { kinds: [{id, typeKey}], merges: [id], marks: [id], sync: bool }.
 */
function reviewApplyPlan(planJson) {
  if (isBootstrapActive()) {
    return JSON.stringify({ message: bootstrapBusyMessage(), ok: false });
  }

  let plan;
  try {
    plan = JSON.parse(planJson || '{}') || {};
  } catch (err) {
    return JSON.stringify({ message: `⚠️ Could not read what was selected (${err}).`, ok: false });
  }

  // Last answer wins, and the order the choices were made in is the order they
  // are carried out in.
  const kinds = [];
  const kindSeen = {};
  (plan.kinds || []).forEach(entry => {
    if (!entry || !entry.id || !entry.typeKey) return;
    if (kindSeen[entry.id] !== undefined) kinds[kindSeen[entry.id]] = entry;
    else { kindSeen[entry.id] = kinds.length; kinds.push(entry); }
  });
  const merges = dedupePreservingOrder((plan.merges || []).filter(Boolean));
  const markIds = dedupePreservingOrder((plan.marks || []).filter(Boolean));

  const lines = [];
  let failures = 0;
  let changedAnything = false;

  if (kinds.length > 0 || merges.length > 0) {
    // ONE quiet window over the whole batch. The nested call inside
    // applyProgramKind() sees the depth and does not tear the triggers down
    // again, so this is one pause and one restore however many programs the
    // batch touches.
    withCalendarChangeTriggersPaused(
      `Program review — applying ${kinds.length + merges.length} change(s)`, () => {
        kinds.forEach(entry => {
          const outcome = applyProgramKind(entry.id, entry.typeKey, { deferFinish: true });
          lines.push(outcome.message);
          if (outcome.ok) changedAnything = true; else failures++;
        });
        merges.forEach(programId => {
          const outcome = mergeTimeBlocksForProgram(programId);
          lines.push(outcome.message);
          if (outcome.ok && outcome.merged > 0) changedAnything = true;
          if (!outcome.ok) failures++;
        });
      });
  }

  // THE SYNC IS THE POINT OF BATCHING, so it runs whenever anything above
  // reached the calendar — a retag with no sync behind it leaves the form in
  // the old shape, which is exactly the half-done state this screen exists to
  // end. A marks-only pass skips it: recording that somebody looked at forty
  // programs changes nothing for a sync to catch up with.
  const wantSync = changedAnything || plan.sync === true;
  if (wantSync) {
    const synced = runReviewSync();
    lines.push(synced.message);
    if (!synced.ran) failures++;
  }

  if (kinds.length > 0 || merges.length > 0) flushAdminDigest('Program review');

  const review = buildProgramReview();
  if (markIds.length > 0) {
    const byId = {};
    review.programs.forEach(p => { byId[p.id] = p; });
    const marked = markProgramsReviewed(markIds.map(id => ({
      id, fingerprint: byId[id] ? byId[id].fingerprint : ''
    })));
    // The payload was built a few milliseconds before those marks. Patching it
    // is honest and costs nothing; rebuilding the whole review to pick up a
    // timestamp this function already knows would be another pass over every
    // calendar.
    const at = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm');
    const by = getCurrentUserEmail() || '';
    markIds.forEach(id => {
      const p = byId[id];
      if (!p) return;
      p.reviewedAt = at;
      p.reviewedBy = by;
      p.changedSinceReview = false;
    });
    review.summary.reviewed = review.programs.filter(p => p.reviewedAt && !p.changedSinceReview).length;
    lines.push(`✅ ${marked} program(s) marked reviewed.`);
  }

  if (lines.length === 0) lines.push('Nothing was selected, so nothing was changed.');
  log(`reviewApplyPlan: ${kinds.length} kind(s), ${merges.length} merge(s), ${markIds.length} mark(s), ` +
    `${wantSync ? 'one sync' : 'no sync'}, ${failures} failure(s).`);
  return JSON.stringify({ message: lines.join('\n'), ok: failures === 0, review });
}

/**
 * Collapses every run of back-to-back blocks belonging to ONE program.
 *
 * Scoped to the program rather than offering the whole list, because that is
 * what the person is looking at — the general list is its own menu item (see
 * section 12).
 */
function mergeTimeBlocksForProgram(programId) {
  const at = String(programId || '').indexOf('::');
  if (at === -1) return { ok: false, merged: 0, message: '⚠️ Could not tell which program that is.' };
  const title = programId.substring(at + 2);

  const runs = findCollapsibleTimeBlocks({}).filter(run => run.title === title);
  if (runs.length === 0) {
    return { ok: true, merged: 0, message: `"${title}": no back-to-back blocks left — nothing to merge.` };
  }
  const lines = runs.map(run => collapseTimeBlockRun(run, { asAppointments: true }).message);
  return { ok: true, merged: runs.length, message: lines.join('\n') };
}

/**
 * The calendar pass and the registrations pass, once — the "update everything"
 * half of the batched apply.
 *
 * THE LOCK'S ANSWER IS READ, not discarded. withScriptLock() returns its
 * onBusy value when it cannot get the lock, and ignoring that would report a
 * successful update on the one occasion nothing ran at all — sending somebody
 * back to a review whose checks are exactly as stale as they were, believing
 * they are fresh.
 *
 * syncCalendars() asks its own "are you sure", which is the wrong question at
 * the end of a screen somebody has just spent five minutes telling what to do.
 * The internal pair is what the hourly triggers run.
 */
function runReviewSync() {
  let ran = false;
  try {
    ran = withScriptLock(SYNC_LOCK_WAIT_MS, () => {
      syncCalendarsInternal();
      syncRegistrationsInternal();
      return true;
    }, false);
  } catch (err) {
    return { ran: false, message: `⚠️ The update did not finish (${err}).` };
  }
  if (!ran) {
    return {
      ran: false,
      message: '⚠️ A sync was already running just now, so nothing was re-read. Any calendar changes above ' +
        'were still made — press Update again in a moment to rebuild the forms.'
    };
  }
  return { ran: true, message: '✅ Calendar and registrations re-read, forms rebuilt, event links rewritten.' };
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * NOTHING HERE CALLS THE SERVER UNTIL THE END. Walking the review, changing a
 * kind, choosing to merge a day of blocks, marking a program reviewed — all of
 * it is held in one object in the browser (`plan`, below) and sent in a single
 * call when the person presses Apply. That is the whole point of this screen:
 * the decisions are quick and the consequences are slow, so the consequences
 * are done once, together, at the end. See reviewApplyPlan().
 *
 * THE SECOND VIEW is the forms list — which program is on which form, read the
 * other way round. It is the last thing anybody wants after a batch of changes
 * ("did that leave two links for the same sessions?"), so the dialog switches
 * to it automatically once the apply comes back.
 */
function buildProgramReviewHtml(review) {
  // EVERY "<" IS ESCAPED OUT OF BOTH LITERALS, and it is the one way a dialog
  // carrying its data inline can go badly wrong: a program called
  // "Films \u003c/script\u003e" would otherwise end the script block in the
  // middle of a sentence, leaving a page that does nothing at all. JSON is
  // valid JavaScript and \u003c is a valid JSON escape for "<", so the value
  // arrives in the browser exactly as it left. Same guard as the Quick Mark
  // dialog's inline index.
  const inlineJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const payload = inlineJson(review);
  // The six kinds as DATA, not as markup. Building the <option> tags here and
  // stringifying them would put raw "<" into a script block for no reason at
  // all — the browser can make the same tags out of three strings.
  const kinds = inlineJson(PROGRAM_FORM_TYPES.map(t => ({ key: t.key, label: t.label, blurb: t.blurb })));

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 0;
         display: flex; flex-direction: column; height: 100vh; }
  header, footer { padding: 10px 14px; background: #F8F9FA; border-bottom: 1px solid #DADCE0; flex: 0 0 auto; }
  footer { border-bottom: 0; border-top: 1px solid #DADCE0; }
  main { flex: 1 1 auto; overflow-y: auto; padding: 14px; }
  h3 { margin: 0; font-size: 17px; }
  h4 { margin: 18px 0 6px 0; font-size: 14px; }
  .sub { color: #5F6368; margin-top: 3px; }
  .counts { float: right; color: #5F6368; font-size: 12px; text-align: right; line-height: 1.5; }
  .pill { display: inline-block; border-radius: 10px; padding: 1px 9px; font-size: 11px;
          margin-left: 6px; vertical-align: 2px; }
  .pill.problem { background: #FCE8E6; color: #C5221F; }
  .pill.warn    { background: #FEF7E0; color: #B06000; }
  .pill.ok      { background: #E6F4EA; color: #188038; }
  .pill.done    { background: #E8F0FE; color: #1155CC; }
  .pill.staged  { background: #F3E8FD; color: #7627BB; }
  ul.checks { list-style: none; margin: 12px 0 0 0; padding: 0; }
  ul.checks li { padding: 8px 0 8px 26px; border-top: 1px solid #F1F3F4; position: relative; line-height: 1.5; }
  ul.checks li .mark { position: absolute; left: 0; top: 8px; font-size: 14px; }
  li.problem .mark::before { content: '\\u274C'; }
  li.warn .mark::before    { content: '\\u26A0\\uFE0F'; }
  li.ok .mark::before      { content: '\\u2705'; }
  li.info .mark::before    { content: '\\u2139\\uFE0F'; }
  li.ok, li.info { color: #5F6368; }
  fieldset { border: 1px solid #DADCE0; border-radius: 6px; margin: 14px 0 0 0; padding: 10px 12px; }
  legend { font-weight: bold; padding: 0 5px; }
  select { padding: 6px; font-size: 13px; width: 100%; box-sizing: border-box; }
  .blurb { color: #5F6368; margin-top: 7px; line-height: 1.45; min-height: 32px; }
  button { border: 0; border-radius: 4px; padding: 7px 14px; font-size: 13px; cursor: pointer;
           background: #1155CC; color: #fff; }
  button.ghost { background: #fff; color: #1155CC; border: 1px solid #C6D4F0; }
  button.go { background: #188038; }
  button[disabled] { background: #9AA0A6; color: #fff; border-color: #9AA0A6; cursor: default; }
  button.small { padding: 4px 10px; font-size: 12px; margin-left: 6px; }
  .dates { color: #5F6368; font-size: 12px; line-height: 1.6; margin-top: 8px; }
  #status { margin-top: 8px; line-height: 1.5; white-space: pre-wrap; font-size: 12px;
            max-height: 88px; overflow-y: auto; }
  .ok-text { color: #188038; } .err-text { color: #C5221F; }
  a.link { color: #1155CC; cursor: pointer; text-decoration: underline; }
  label.filter { font-weight: normal; margin-right: 12px; color: #5F6368; }
  .tabs { margin-bottom: 8px; }
  .tabs a { display: inline-block; padding: 4px 10px; margin-right: 6px; border-radius: 4px;
            cursor: pointer; color: #1155CC; }
  .tabs a.on { background: #E8F0FE; font-weight: bold; }
  .staged-note { margin-top: 8px; color: #7627BB; line-height: 1.5; }
  table.forms { border-collapse: collapse; width: 100%; margin-top: 4px; }
  table.forms th, table.forms td { border-top: 1px solid #F1F3F4; padding: 7px 8px; text-align: left;
                                   vertical-align: top; line-height: 1.5; }
  table.forms th { color: #5F6368; font-weight: normal; font-size: 12px; border-top: 0; }
  table.forms td.id { font-family: monospace; font-size: 11px; color: #5F6368; word-break: break-all; }
  tr.shared td { background: #FEF7E0; }
  tr.clash td { background: #FCE8E6; }
  .conflict { padding: 8px 0 8px 26px; position: relative; line-height: 1.5;
              border-top: 1px solid #F1F3F4; }
  .conflict .mark { position: absolute; left: 0; top: 8px; }
  .conflict.problem .mark::before { content: '\\u274C'; }
  .conflict.warn .mark::before { content: '\\u26A0\\uFE0F'; }
  .bar { background: #F3E8FD; border: 1px solid #E0CFF6; border-radius: 6px; padding: 8px 10px;
         margin-bottom: 10px; line-height: 1.6; }
</style>

<header>
  <div class="counts" id="counts"></div>
  <div class="tabs">
    <a id="tab-programs" onclick="setView('programs')">Programs</a>
    <a id="tab-forms" onclick="setView('forms')">Which form is each program on?</a>
  </div>
  <div id="filters">
    <label class="filter"><input type="radio" name="filter" value="attention" checked onchange="setFilter()">
      Needs attention</label>
    <label class="filter"><input type="radio" name="filter" value="unreviewed" onchange="setFilter()">
      Not yet reviewed</label>
    <label class="filter"><input type="radio" name="filter" value="all" onchange="setFilter()">
      All</label>
  </div>
</header>

<main>
  <div id="card"></div>
</main>

<footer>
  <div id="plan-bar" style="display:none" class="bar"></div>
  <button class="ghost" id="prev" onclick="step(-1)">&lsaquo; Previous</button>
  <button class="ghost" id="next" onclick="step(1)">Next &rsaquo;</button>
  <button class="ghost" id="mark" onclick="toggleMark()">Mark reviewed &amp; next</button>
  <button class="go" id="apply" onclick="applyPlan()">Apply everything &amp; update</button>
  <span style="float:right; color:#5F6368; font-size:12px;" id="place"></span>
  <div id="status"></div>
</footer>

<script>
  var REVIEW = ${payload};
  var KINDS = ${kinds};
  var filter = 'attention';
  var view = 'programs';
  var at = 0;
  var busy = false;

  // EVERY DECISION MADE ON THIS SCREEN, held here until Apply. kinds is keyed
  // by program so changing your mind replaces an answer rather than queueing a
  // second one; merges and marks are sets for the same reason.
  var plan = { kinds: {}, merges: {}, marks: {} };

  function planCounts() {
    return {
      kinds: Object.keys(plan.kinds).length,
      merges: Object.keys(plan.merges).length,
      marks: Object.keys(plan.marks).length
    };
  }

  function planChanges() {
    var c = planCounts();
    return c.kinds + c.merges;
  }

  function visible() {
    return REVIEW.programs.filter(function (p) {
      if (filter === 'all') return true;
      if (filter === 'unreviewed') return !p.reviewedAt || p.changedSinceReview;
      return p.worst === 'problem' || p.worst === 'warn';
    });
  }

  function setFilter() {
    var boxes = document.getElementsByName('filter');
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) filter = boxes[i].value;
    at = 0;
    draw();
  }

  function setView(which) {
    view = which;
    draw();
  }

  function step(by) {
    var list = visible();
    if (list.length === 0) return;
    at = (at + by + list.length) % list.length;
    draw();
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function kindLabel(key) {
    var picked = KINDS.filter(function (k) { return k.key === key; })[0];
    return picked ? picked.label : key;
  }

  // A fix that the final update performs is not a button any more — pressing it
  // would be the per-program wait this screen was rebuilt to remove. The one
  // exception is merging a day of blocks, which is a decision (is this really
  // one session?) rather than a consequence, so it is staged like the rest.
  function fixNote(fix, p) {
    if (fix === 'sync') return ' <i>The update at the end fixes this.</i>';
    if (fix === 'merge') {
      return plan.merges[p.id]
        ? ' <span class="pill staged">will be merged</span>' +
          ' <a class="link" onclick="stageMerge(false)">undo</a>'
        : ' <button class="small ghost" onclick="stageMerge(true)">Merge its blocks in the update</button>';
    }
    return '';
  }

  function draw() {
    var s = REVIEW.summary || {};
    document.getElementById('counts').innerHTML =
      esc(s.total || 0) + ' programs &nbsp;·&nbsp; ' +
      '<span class="pill problem">' + esc(s.problems || 0) + ' problem</span>' +
      '<span class="pill warn">' + esc(s.warnings || 0) + ' to check</span>' +
      '<span class="pill done">' + esc(s.reviewed || 0) + ' reviewed</span>' +
      (s.formConflicts > 0
        ? '<span class="pill warn">' + esc(s.formConflicts) + ' form overlap(s)</span>'
        : '');

    document.getElementById('tab-programs').className = view === 'programs' ? 'on' : '';
    document.getElementById('tab-forms').className = view === 'forms' ? 'on' : '';
    document.getElementById('filters').style.display = view === 'programs' ? '' : 'none';

    drawPlanBar();
    if (view === 'forms') drawForms(); else drawProgram();
  }

  function drawPlanBar() {
    var c = planCounts();
    var bar = document.getElementById('plan-bar');
    var apply = document.getElementById('apply');
    var bits = [];
    if (c.kinds > 0) bits.push(c.kinds + ' kind change(s)');
    if (c.merges > 0) bits.push(c.merges + ' merge(s)');
    if (c.marks > 0) bits.push(c.marks + ' mark(s)');
    if (bits.length === 0) {
      bar.style.display = 'none';
      apply.textContent = 'Update everything now';
      apply.title = 'Nothing is selected — this re-reads the calendars and rebuilds the forms.';
    } else {
      bar.style.display = '';
      bar.innerHTML = '<b>Selected, not yet applied:</b> ' + esc(bits.join(', ')) +
        '. Nothing has been written yet — press Apply and it is all done in one pass. ' +
        '<a class="link" onclick="discardPlan()">Discard selections</a>';
      apply.textContent = 'Apply everything & update' +
        (planChanges() > 0 ? ' (' + planChanges() + ')' : '');
      apply.title = '';
    }
  }

  function drawProgram() {
    var list = visible();
    if (list.length === 0) {
      document.getElementById('card').innerHTML =
        '<h3>Nothing here.</h3><p class="sub">' +
        (filter === 'attention'
          ? 'Every program passes every check. Switch to "All" to walk through them anyway.'
          : 'Every program has been reviewed. Switch to "All" to go through them again, or ' +
            '<a class="link" onclick="clearMarks()">clear the marks</a>.') + '</p>';
      document.getElementById('place').textContent = '';
      return;
    }
    if (at >= list.length) at = list.length - 1;
    var p = list[at];

    var reviewedNote = !p.reviewedAt ? ''
      : (p.changedSinceReview
        ? '<span class="pill warn">reviewed ' + esc(p.reviewedAt) + ', but it has changed since</span>'
        : '<span class="pill done">reviewed ' + esc(p.reviewedAt) + '</span>');
    if (plan.marks[p.id]) reviewedNote += '<span class="pill staged">will be marked reviewed</span>';

    var checks = p.checks.map(function (c) {
      return '<li class="' + esc(c.level) + '"><span class="mark"></span>' + esc(c.text) +
        (c.fix ? fixNote(c.fix, p) : '') + '</li>';
    }).join('');

    var dates = p.dateLabels.length === 0 ? '' :
      '<div class="dates"><b>Dates:</b> ' + p.dateLabels.map(esc).join(' &nbsp;·&nbsp; ') +
      (p.moreDates > 0 ? ' &nbsp;·&nbsp; …and ' + esc(p.moreDates) + ' more' : '') + '</div>';

    var staged = plan.kinds[p.id];
    var stagedNote = !staged ? '' :
      '<div class="staged-note"><b>Selected:</b> ' + esc(kindLabel(p.sheetTypeKey)) + ' → ' +
      esc(kindLabel(staged)) + '. Applied with everything else at the end. ' +
      '<a class="link" onclick="stageKind(\\'\\')">undo</a></div>';

    document.getElementById('card').innerHTML =
      '<h3>' + esc(p.title) + ' ' + reviewedNote + '</h3>' +
      '<div class="sub">' + esc(p.locations.join(' + ') || 'no location') +
        (p.isShared ? ' — one shared form across locations' : '') +
        ' &nbsp;·&nbsp; ' + esc(p.upcomingCount) + ' upcoming session(s) of ' +
        esc(p.sessionCount) + ', ' + esc(p.formCount) + ' form(s)' +
        ' &nbsp;·&nbsp; ' + esc(p.registered) + ' registered' +
        (p.waitlisted > 0 ? ', ' + esc(p.waitlisted) + ' waitlisted' : '') +
      '</div>' +
      dates +
      '<ul class="checks">' + checks + '</ul>' +
      '<fieldset><legend>What kind of program is this?</legend>' +
        '<select id="kind" onchange="stageKind(this.value)">' + KINDS.map(function (k) {
          return '<option value="' + esc(k.key) + '">' + esc(k.label) + '</option>';
        }).join('') + '</select>' +
        '<div class="blurb" id="blurb"></div>' +
        stagedNote +
      '</fieldset>';

    document.getElementById('kind').value = staged || p.sheetTypeKey;
    showBlurb();
    document.getElementById('mark').textContent =
      plan.marks[p.id] ? 'Unmark & next' : 'Mark reviewed & next';
    document.getElementById('place').textContent = (at + 1) + ' of ' + list.length;
  }

  // WHICH PROGRAM IS ON WHICH FORM, form first. Two programs on one row of this
  // table is the thing it exists to show, so those rows are tinted and the
  // sentences saying what is wrong sit above the table rather than under it.
  function drawForms() {
    var links = REVIEW.formLinks || { forms: [], conflicts: [] };
    var conflicts = links.conflicts.length === 0
      ? '<p class="sub">Nothing overlaps: no form carries two programs, no month is split across two ' +
        'forms, and every calendar link points at the form its sessions use.</p>'
      : links.conflicts.map(function (c) {
          return '<div class="conflict ' + esc(c.level || 'warn') + '"><span class="mark"></span>' +
            esc(c.text) + '</div>';
        }).join('');

    var rows = links.forms.map(function (f) {
      var cls = f.programs.length < 2 ? '' : (f.sharedAcrossTitles ? 'clash' : 'shared');
      var who = f.programs.map(function (e) {
        return '<div>' + esc(e.title) +
          ' <span class="sub" style="display:inline">— ' + esc(e.locations.join(' + ') || 'no location') +
          ', ' + esc(e.kindLabel) + (e.months.length > 0 ? ', ' + esc(e.months.join(', ')) : '') +
          (e.onSheet ? '' : ' — calendar link only, no session row uses it') + '</span></div>';
      }).join('');
      return '<tr class="' + cls + '">' +
        '<td>' + who + '</td>' +
        '<td>' + esc(f.sessions) + '</td>' +
        '<td class="id"><a class="link" href="' + esc(f.editUrl) + '" target="_blank">' +
          esc(f.formId) + '</a></td></tr>';
    }).join('');

    document.getElementById('card').innerHTML =
      '<h3>Which program is on which form</h3>' +
      '<p class="sub">One row per form, and everything registering through it. Read down the first ' +
      'column: two names in one cell means two programs sharing a sign-up.</p>' +
      '<h4>What overlaps</h4>' + conflicts +
      '<h4>Every form in use</h4>' +
      (links.forms.length === 0
        ? '<p class="sub">No upcoming session points at a form yet.</p>'
        : '<table class="forms"><tr><th>Program(s) on it</th><th>Upcoming sessions</th>' +
          '<th>Form</th></tr>' + rows + '</table>');
    document.getElementById('place').textContent = '';
  }

  function showBlurb() {
    var el = document.getElementById('kind');
    if (!el) return;
    var picked = KINDS.filter(function (k) { return k.key === el.value; })[0];
    document.getElementById('blurb').textContent = picked ? picked.blurb : '';
  }

  function current() {
    var list = visible();
    return list.length > 0 ? list[Math.min(at, list.length - 1)] : null;
  }

  // Choosing the kind a program ALREADY is takes it off the plan rather than
  // queueing a write that would change nothing.
  function stageKind(key) {
    var p = current();
    if (!p) return;
    if (!key || key === p.sheetTypeKey) delete plan.kinds[p.id];
    else plan.kinds[p.id] = key;
    draw();
  }

  function stageMerge(on) {
    var p = current();
    if (!p) return;
    if (on) plan.merges[p.id] = true; else delete plan.merges[p.id];
    draw();
  }

  function toggleMark() {
    var p = current();
    if (!p) return;
    if (plan.marks[p.id]) { delete plan.marks[p.id]; draw(); return; }
    plan.marks[p.id] = true;
    step(1);
  }

  function discardPlan() {
    plan = { kinds: {}, merges: {}, marks: {} };
    say('Selections discarded. Nothing had been written.', '');
    draw();
  }

  function applyPlan() {
    var c = planCounts();
    var body = {
      kinds: Object.keys(plan.kinds).map(function (id) { return { id: id, typeKey: plan.kinds[id] }; }),
      merges: Object.keys(plan.merges),
      marks: Object.keys(plan.marks),
      // Nothing to write and nothing to merge still means "update everything",
      // because that is what the button says when the plan is empty.
      sync: (c.kinds + c.merges) === 0
    };
    if (c.kinds + c.merges + c.marks === 0) {
      if (!confirm('Nothing is selected. Re-read the calendars and rebuild the forms anyway?')) return;
    }
    say('Applying ' + (c.kinds + c.merges) + ' change(s), then updating the sheet, the calendar and the ' +
      'forms. This is the long one — a minute or two, and only once.', '');
    call('reviewApplyPlan', [JSON.stringify(body)], function (out) {
      // THE PLAN SURVIVES A PARTIAL RUN. Every step of an apply is idempotent
      // (see reviewApplyPlan), so holding onto the selections after a failure
      // means pressing Apply again finishes the job — whereas clearing them
      // would leave somebody with half their afternoon applied and no record
      // of the other half.
      if (out.ok === false) { draw(); return; }
      plan = { kinds: {}, merges: {}, marks: {} };
      // The forms list is what somebody wants to see the moment a batch lands:
      // it is the only screen that shows whether the rebuild left two links on
      // one set of sessions.
      view = 'forms';
      draw();
    });
  }

  function clearMarks() {
    call('reviewClearAllMarks', []);
  }

  function call(fn, args, after) {
    if (busy) return;
    busy = true;
    setButtons(true);
    var runner = google.script.run
      .withSuccessHandler(function (raw) {
        busy = false; setButtons(false);
        var out = JSON.parse(raw);
        if (out.review) REVIEW = out.review;
        say(out.message || '', out.ok === false ? 'err-text' : 'ok-text');
        if (after) after(out);
        draw();
      })
      .withFailureHandler(function (err) {
        busy = false; setButtons(false);
        say('Failed: ' + err.message, 'err-text');
      });
    runner[fn].apply(runner, args);
  }

  function setButtons(disabled) {
    ['prev', 'next', 'mark', 'apply'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls || '';
  }

  draw();
</script>`;
}


