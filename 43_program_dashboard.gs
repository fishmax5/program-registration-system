// ============================================================================
// 7. MASTER PROGRAM DASHBOARD  (renderProgramDashboard)
// ============================================================================
//
// One function rebuilds the ENTIRE sheet, top to bottom, every time it's
// called: it reads whatever is currently across both the Upcoming and Past
// session sub-tables, removes any session whose calendar event has
// disappeared (routing its registrants to Triage first, refreshing that
// session's form), sorts/splits the rest by date, computes the Today/
// Metrics sections, then clears the sheet and writes everything fresh.
// ============================================================================

/**
 * options.registrantRows — already-in-memory Registrant_Dash
 * rows, to skip re-reading that tab. Honored only when this render's own
 * triage pass didn't rewrite the tab underneath them (see registrantsMoved).
 * Returns { registrantsMoved } so a caller holding those rows knows whether
 * they are still safe to reuse afterward.
 *
 * options.sessionRows — already-in-memory session rows, same idea.
 *
 * options.skipTriage — do NOT cross-check the sessions against the live
 * calendars. This is the ONLY thing in a dashboard render that reads outside
 * the spreadsheet, and it is also the only thing that can remove data, so
 * rebuildLayoutFromSheet() turns it off: a re-layout must not be able to
 * decide, on the strength of one unreadable calendar, that a program was
 * cancelled. Nothing else in here needs the network.
 */
function renderProgramDashboard(force, options) {
  options = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);

  let sessionRows = options.sessionRows || readAllSectionedRows(sheet, headers, 'Event_ID');

  const triageResult = options.skipTriage
    ? { rows: sessionRows, affectedFormIds: new Set(), registrantsMoved: false }
    : triageDeletedSessions(sessionRows, map, registrantsSheet);
  sessionRows = triageResult.rows;

  sessionRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d) row[map['Event_Date']] = d;
  });

  if (triageResult.affectedFormIds.size > 0) {
    refreshFormDateListsForForms(sessionRows, map, triageResult.affectedFormIds);
  }

  const reusableRegistrantRows = triageResult.registrantsMoved ? null : options.registrantRows;
  const registrantScan = scanRegistrants(registrantsSheet, reusableRegistrantRows);

  // THE HEADLINE NUMBERS COUNT PROGRAMS, AND A MEAL IS NOT ONE. The lunch
  // rows are written to the table below and are now plainly VISIBLE there —
  // they read "Lunch @ Narberth — Chx Parm", which is a line on the schedule
  // like any other — but they stay out of both summaries. "42 programs this
  // month" counting thirty lunches is a number nobody can use, and the Today
  // block names what is RUNNING at each location: the meal is on the lunch
  // dashboard, in a count of its own, which is where somebody looks for it.
  const programSessionRows = sessionRows.filter(row => !isLunchOnlyEventId(row[map['Event_ID']]));
  const todayData = buildTodayAtLocations(programSessionRows, map, registrantScan);
  const metrics = computeProgramMetrics(programSessionRows, map, registrantScan);

  // The links to this session's own files, recomputed from the registries on
  // every render (see 69_generated_file_links.gs): whatever is in these two
  // cells now is last render's answer, and a file may have been built or
  // deleted since.
  stampGeneratedFileLinks(sessionRows, map, { titleColumn: 'Clean_Title' });

  writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, force);
  return { registrantsMoved: triageResult.registrantsMoved };
}

/**
 * A triage sweep this size is treated as a symptom, not an instruction — see
 * triageDeletedSessions(). Both have to be exceeded before a sweep is
 * refused, so deleting one whole small program still works normally while a
 * "everything vanished" reading never does.
 */
const TRIAGE_MAX_SESSIONS_PER_RUN = 15;
const TRIAGE_MAX_FRACTION_PER_RUN = 0.25;
/** One-shot property set by confirmLargeTriage() to let the next sweep exceed those limits. */
const TRIAGE_OVERRIDE_PROP_KEY = 'TRIAGE_OVERRIDE_ONCE';

/**
 * Cross-checks in-memory session rows against what's genuinely still on the
 * calendars right now and drops any that are gone. Dropped sessions'
 * registrants are moved to Deleted_Event_Triage. Master_Program_Dashboard no
 * longer has a Manual_Override column, so nothing can be protected from
 * this anymore — every session's presence is strictly calendar-derived.
 *
 * WHICH MAKES THIS THE MOST DESTRUCTIVE FUNCTION IN THE FILE, and it is
 * built to distrust itself accordingly:
 *
 *   1. A calendar that could not be READ proves nothing. getCalendarById()
 *      returns null on a transient failure, and the old code read that as an
 *      empty event list — i.e. "every session at that location is deleted."
 *      Rows whose Calendar_Source we couldn't read are now left alone.
 *   2. A sweep that would take out most of the table is refused outright.
 *      Programs get cancelled a few at a time; 268 sessions disappearing at
 *      once is a failed calendar read, a mid-import snapshot, or a bug — and
 *      the cost of pausing is one log line, while the cost of proceeding is
 *      the whole dashboard plus every registrant on it. confirmLargeTriage()
 *      is the way to say "no, really".
 *   3. While a bootstrap import is in flight, nothing is triaged at all: the
 *      session table is being written as we read it.
 */
function triageDeletedSessions(sessionRows, map, registrantsSheet) {
  const empty = { rows: sessionRows, affectedFormIds: new Set(), registrantsMoved: false };

  if (isBootstrapActive()) {
    log('Triage skipped: a large-setup import or forms-rebuild sweep is still writing the session table.');
    return empty;
  }

  const { start, end } = computeSyncDateRange();

  // Shares syncCalendarsInternal()'s fetch for this window — a full
  // initializeAndSyncAll() used to hit every calendar four separate times
  // (once per renderProgramDashboard(), plus the sync's own scan).
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const readableCalendars = new Set();
  const liveEventIds = new Set();
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Triage: "${CALENDAR_MAP[calendarId]}" could not be read this run — its sessions are left as they are.`);
      return;
    }
    readableCalendars.add(calendarId);
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed) return;
      liveEventIds.add(computeEventId(calendarId, parsed.cleanTitle, formatDateKey(ev.getStartTime())));
    });
  });

  if (readableCalendars.size === 0) {
    log('Triage skipped: no calendar could be read this run.');
    return empty;
  }

  const doomedRows = [];
  const deletedEventInfo = {};
  sessionRows.forEach(row => {
    const eventId = row[map['Event_ID']];
    const d = coerceDate(row[map['Event_Date']]);
    const source = row[map['Calendar_Source']];
    // No Calendar_Source (a hand-added row) can't be attributed to a calendar
    // we verified, so it is never triaged.
    if (!eventId || !d || !source || !readableCalendars.has(source)) return;
    if (d < start || d > end) return; // outside the window we can see
    if (liveEventIds.has(eventId)) return;
    doomedRows.push(row);
    deletedEventInfo[eventId] = { cleanTitle: row[map['Clean_Title']], location: row[map['Location']] };
  });

  const deletedCount = Object.keys(deletedEventInfo).length;
  if (deletedCount === 0) return empty;

  if (isTriageTooBig(deletedCount, sessionRows.length)) {
    const message = `Triage REFUSED: ${deletedCount} of ${sessionRows.length} session(s) looked deleted in one pass, ` +
      `which is far more likely to be a bad calendar read than ${deletedCount} real cancellations. ` +
      `Nothing was removed. If they really are all gone, run confirmLargeTriage() from the Apps Script ` +
      `editor and let the next sync through.`;
    log(`⚠️ ${message}`);
    noteForAdmin('Sessions that look deleted', message);
    return empty;
  }

  const doomedSet = new Set(doomedRows);
  const keep = sessionRows.filter(row => !doomedSet.has(row));
  const affectedFormIds = new Set();
  doomedRows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (formId) affectedFormIds.add(formId);
  });

  moveRegistrantsToTriage(registrantsSheet, deletedEventInfo);
  log(`Triaged ${deletedCount} deleted event(s) during dashboard render.`);

  // registrantsMoved tells callers that any registrant rows they were
  // holding from before this call are now stale — moveRegistrantsToTriage()
  // rewrites the Registrants tab.
  return { rows: keep, affectedFormIds, registrantsMoved: true };
}

/** Is this sweep big enough to need a human? Consumes the one-shot override if one is set. */
function isTriageTooBig(deletedCount, totalRows) {
  const overLimit = deletedCount > TRIAGE_MAX_SESSIONS_PER_RUN &&
    deletedCount > totalRows * TRIAGE_MAX_FRACTION_PER_RUN;
  if (!overLimit) return false;

  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(TRIAGE_OVERRIDE_PROP_KEY)) {
    props.deleteProperty(TRIAGE_OVERRIDE_PROP_KEY); // one sweep only
    log('Large triage allowed once by confirmLargeTriage().');
    return false;
  }
  return true;
}

/**
 * MAINTENANCE — run from the Apps Script editor. Lets the NEXT sweep remove
 * more sessions than the safety limit allows, once. Use it after checking
 * that the sessions really are gone from the calendar.
 */
function confirmLargeTriage() {
  if (!requireAuthorizedAdmin('Confirm Large Triage')) return;
  PropertiesService.getScriptProperties().setProperty(TRIAGE_OVERRIDE_PROP_KEY, String(Date.now()));
  log(`confirmLargeTriage: the next sweep may exceed ${TRIAGE_MAX_SESSIONS_PER_RUN} sessions. ` +
    `Run "Sync Cal" to trigger it — the permission is used up by that one sweep.`);
}

/** After sessions are removed (their calendar event vanished), pushes an updated date list to any form those sessions belonged to. */
function refreshFormDateListsForForms(keptSessionRows, map, affectedFormIds) {
  const rowsByForm = {};
  keptSessionRows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (!formId || !affectedFormIds.has(formId)) return;
    if (!rowsByForm[formId]) rowsByForm[formId] = [];
    rowsByForm[formId].push(row);
  });
  const sharedFormIds = getSharedFormIdSet();

  affectedFormIds.forEach(formId => {
    const formContext = buildFormSessionContext(formId, rowsByForm[formId] || [], map, sharedFormIds);
    const dates = formContext.sessions;
    const location = describeLocations(formContext.locations);
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(formContext.sessions, formContext);
    const attendanceLabels = allDateLabels.length > 0 ? allDateLabels : ['No upcoming dates'];
    const lunchLabels = lunchDateLabels.length > 0 ? lunchDateLabels : ['No upcoming dates'];
    if (applyFormDateLabels(formId, attendanceLabels, lunchLabels, { context: 'deleted-event cleanup',
      shape: formLunchShapeKey(formContext, lunchDateLabels.length > 0) })) {
      log(`Refreshed form ${formId}'s date list to ${dates.length} remaining date(s) after a deleted-event cleanup.`);
    }
    if (dates.length === 0) {
      // Emptying a live form is a big enough thing to say out loud: it means
      // every session that form covered is gone from the calendar.
      noteForAdmin('Registration forms left with no dates',
        `Form ${formId} (${formContext.locations.length > 0 ? location : 'unknown location'}) now shows ` +
        `"No upcoming dates" — every session it covered ` +
        `disappeared from the calendar. Check that this was intended.`);
    }
  });
  flushPersistentRegistries();
}

/**
 * One pass over Registrant_Dash powering BOTH the Today block and the
 * participation metrics. Four structures come out of it:
 *
 *   countsByEventId       { eventId: { active, waitlist, attended } }
 *   activePeopleByEventId { eventId: Set(nameKey) }
 *   monthsByPerson        { nameKey: Set('yyyy-MM') }
 *   earliestMonthByPerson { nameKey: 'yyyy-MM' }
 *
 * THE LAST TWO ARE WHAT MAKE "NEW" AND "RETURNING" ANSWERABLE, and they are
 * the reason this scan reads Event_Date at all. Whether somebody is new is not
 * a fact about this month's rows — it is a fact about every month BEFORE this
 * one, so the only place it can be established is a pass that has already seen
 * the whole tab. Building it here costs one date parse per row on a pass that
 * was happening anyway; doing it later would cost a second read of thousands
 * of rows.
 *
 * PEOPLE ARE KEYED BY normalizeNameKey(), not by the name as typed. "Jane
 * Smith", "jane smith" and "Jane  Smith" are one person everywhere else in
 * this workbook — Member_Roll, the club rosters, the Quick Mark dropdown — and
 * counting them as three was quietly inflating every participant number this
 * dashboard has ever shown. A stray second space is the commonest way one
 * person becomes two, and it is invisible on the sheet.
 *
 * ATTENDED IS COUNTED ONLY ON ACTIVE ROWS, alongside the active count it will
 * be divided by, so the show-rate's numerator and denominator can never be
 * drawn from different populations.
 *
 * The month history is built from the registrant row's OWN Event_Date rather
 * than by joining to the session table: the row carries it (it is the tab's
 * first column), and a person's history has to include months whose sessions
 * may since have been triaged off the dashboard. A row with no parseable date
 * still counts toward its event — it simply cannot be attributed to a month.
 */
function scanRegistrants(registrantsSheet, registrantRows) {
  const result = {
    countsByEventId: {},
    activePeopleByEventId: {},
    monthsByPerson: {},
    earliestMonthByPerson: {}
  };
  const headers = HEADERS.Registrant_Dash;
  const rows = registrantRows || readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (!eventId) return;
    const status = row[map['Program_Status']];
    const name = row[map['Name']];

    if (!result.countsByEventId[eventId]) {
      result.countsByEventId[eventId] = { active: 0, waitlist: 0, attended: 0 };
    }
    if (status === 'Active') {
      const counts = result.countsByEventId[eventId];
      counts.active++;
      if (isTruthyCheckbox(row[map['Attended']])) counts.attended++;

      const personKey = normalizeNameKey(name);
      if (personKey) {
        if (!result.activePeopleByEventId[eventId]) result.activePeopleByEventId[eventId] = new Set();
        result.activePeopleByEventId[eventId].add(personKey);

        const when = coerceDate(row[map['Event_Date']]);
        if (when) {
          const monthKey = formatMonthKey(when);
          if (!result.monthsByPerson[personKey]) result.monthsByPerson[personKey] = new Set();
          result.monthsByPerson[personKey].add(monthKey);
          const earliest = result.earliestMonthByPerson[personKey];
          if (!earliest || monthKey < earliest) result.earliestMonthByPerson[personKey] = monthKey;
        }
      }
    }
    if (status === 'Waitlisted') result.countsByEventId[eventId].waitlist++;
  });
  return result;
}

/** One row per CALENDAR_MAP location, summarizing what's happening there today. */
function buildTodayAtLocations(sessionRows, map, registrantScan) {
  const todayKey = formatDateKey(new Date());
  const locations = Object.values(CALENDAR_MAP);

  return locations.map(loc => {
    const todaysSessions = sessionRows.filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) === todayKey && row[map['Location']] === loc;
    });
    const programs = Array.from(new Set(todaysSessions.map(r => r[map['Clean_Title']]))).sort();
    const registeredToday = todaysSessions.reduce((sum, row) => {
      const c = registrantScan.countsByEventId[row[map['Event_ID']]];
      return sum + (c ? c.active : 0);
    }, 0);
    return {
      location: loc,
      programsToday: programs.length > 0 ? programs.join(', ') : 'No programs today',
      sessionsToday: todaysSessions.length,
      registeredToday
    };
  });
}

// ============================================================================
// PROGRAM METRICS — WHY NOTHING HERE IS A TOTAL
// ============================================================================
//
// This block used to read: Total Programs, Total Sessions, Total
// Registrations, Unique Participants, Avg Fill Rate — five numbers computed
// over every row the workbook had ever held. Each of them was true, and not
// one of them could be acted on:
//
//   • THEY ONLY EVER GO UP. "1,284 sessions" is a number that grows for as
//     long as the center stays open and can never say whether this month went
//     better or worse than last. By the second year it moves so slowly that
//     two adjacent renders are indistinguishable, which is another way of
//     saying it stopped carrying information.
//   • AVG FILL RATE AVERAGED TWO DIFFERENT POPULATIONS. Every past session
//     sat at whatever fill it finished at, and every session six months out
//     sat near zero because nobody can register for something that has not
//     been advertised yet. The mean of a settled 95% and an unopened 0% is
//     47%, which describes no session that exists. Meanwhile the question the
//     number LOOKED like it was answering — "what should I be promoting this
//     week?" — was exactly the one it could not answer.
//   • UNIQUE PARTICIPANTS ALL-TIME is a mailing-list statistic. Nobody runs a
//     Tuesday on it.
//
// So every number below is bounded by a period, and there are two kinds:
//
//   THE NEAR-TERM WINDOWS — the next 7 and next 30 days. This is the half
//   about seats: what is coming, how full it is, how many chairs are still
//   empty, and how many people are being turned away. A fill rate is only
//   meaningful over sessions that are actually open for business, and "the
//   next seven days" is the span in which a phone call can still change the
//   answer.
//
//   THE MONTH-OVER-MONTH BLOCK — this month against last, LIKE FOR LIKE. On
//   the 14th, September 1–14 is compared against August 1–14, not against the
//   whole of August: comparing a fortnight against a whole month makes every
//   change read negative for the first three weeks of every month, and a block
//   that cries wolf that reliably stops being read at all. The row labels say
//   the spans out loud, so the comparison can be checked rather than trusted.
//
// WHAT IS DELIBERATELY NOT HERE. Lunch: a meal is not a program, the numbers
// above the session table count programs, and the meal has a dashboard of its
// own (see renderProgramDashboard's filter). Distinct programs offered per
// month: a real planning statistic, but a planning one — it does not change
// what anybody does this week, and eight columns of month KPIs is already the
// point where a table starts being scanned instead of read.
// ============================================================================

/**
 * The near-term windows, in days from today INCLUSIVE — so 7 means today plus
 * the next six days. Each row says its own end date rather than making anyone
 * work out whether the boundary was counted.
 */
const METRIC_WINDOW_DAYS = [7, 30];

/** A session's cap, or null when it is uncapped ('--', blank, or a non-positive number). */
function sessionCapacity(row, map) {
  const raw = map['Max_Capacity'] === undefined ? '' : row[map['Max_Capacity']];
  if (raw === '--' || raw === '' || raw === null || raw === undefined) return null;
  const cap = Number(raw);
  return isFinite(cap) && cap > 0 ? cap : null;
}

/**
 * Does this session take sign-ups at all? A [No Registration] drop-in coffee
 * hour is a session the center genuinely ran, so it counts as one — but its
 * zero registrations are structural rather than a shortfall, and letting them
 * into the denominator of "registrations per session" makes a healthy month of
 * drop-ins read as a collapse in demand.
 */
function sessionTakesRegistration(row, map) {
  if (map['No_Registration'] === undefined) return true;
  return !isFlagColumnValue(row[map['No_Registration']], NO_REGISTRATION_WORDS_REGEX);
}

/** `days` away from `from`, built over local midnights so DST can't shift a boundary. */
function shiftDate(from, days) {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
}

/**
 * The first `dayOfMonth` days of a month, CLAMPED to the days that month has.
 * Comparing March 1–31 against February asks for a February 31st; the clamp
 * makes it February 1–28, and the label the caller builds says so rather than
 * quietly comparing a long span with a short one.
 */
function monthSpanThroughDay(year, month, dayOfMonth) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lastDay = Math.min(dayOfMonth, daysInMonth);
  return { start: new Date(year, month, 1), end: new Date(year, month, lastDay) };
}

/** "Sep 1–14", or "Sep 1" when the span is a single day. */
function describeDateSpan(start, end) {
  const from = Utilities.formatDate(start, TIMEZONE, 'MMM d');
  if (formatDateKey(start) === formatDateKey(end)) return from;
  return `${from}–${Utilities.formatDate(end, TIMEZONE, 'd')}`;
}

/**
 * Everything both blocks need about one span of dates, gathered in a single
 * pass so no two numbers on this dashboard can be drawn from different
 * populations.
 *
 * `people` is a set of normalizeNameKey()s rather than a count, because the
 * month block has to intersect it with a person's history to tell a new face
 * from a returning one — and a count cannot be intersected with anything.
 */
function summarizeSessionSpan(sessionRows, map, registrantScan, startKey, endKey, todayKey) {
  const summary = {
    sessions: 0, registeringSessions: 0, registrations: 0, waitlisted: 0,
    people: new Set(),
    seatsOffered: 0, seatsTaken: 0, emptySeats: 0, cappedSessions: 0,
    pastRegistrations: 0, pastAttended: 0
  };

  sessionRows.forEach(row => {
    const when = coerceDate(row[map['Event_Date']]);
    if (!when) return;
    const dateKey = formatDateKey(when);
    if (dateKey < startKey || dateKey > endKey) return;

    summary.sessions++;
    if (!sessionTakesRegistration(row, map)) return;
    summary.registeringSessions++;

    const counts = registrantScan.countsByEventId[row[map['Event_ID']]];
    const active = counts ? counts.active : 0;
    summary.registrations += active;
    summary.waitlisted += counts ? counts.waitlist : 0;

    const people = registrantScan.activePeopleByEventId[row[map['Event_ID']]];
    if (people) people.forEach(person => summary.people.add(person));

    // The show rate can only be asked of sessions that have already happened.
    // A session later today is not a no-show; it has not started.
    if (dateKey < todayKey) {
      summary.pastRegistrations += active;
      summary.pastAttended += counts ? counts.attended : 0;
    }

    const cap = sessionCapacity(row, map);
    if (cap !== null) {
      summary.cappedSessions++;
      summary.seatsOffered += cap;
      summary.seatsTaken += active;
      // Floored per session, not on the total: an over-subscribed session has
      // no empty seats to sell, and letting its overflow cancel out a genuinely
      // empty room somewhere else would hide both.
      summary.emptySeats += Math.max(cap - active, 0);
    }
  });

  return summary;
}

/** A whole-number percentage, or null when there is nothing to take a percentage OF. */
function percentageOrNull(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

/**
 * Computes both metric blocks: the near-term windows and the month-over-month
 * comparison. `now` is injectable so the arithmetic can be tested against a
 * fixed calendar rather than against whatever day the tests happen to run on.
 */
function computeProgramMetrics(sessionRows, map, registrantScan, now) {
  now = now || new Date();
  const todayKey = formatDateKey(now);

  const windows = METRIC_WINDOW_DAYS.map(days => {
    // days - 1, because the window counts from today INCLUSIVE: seven days
    // ending on the sixth day after this one.
    const end = shiftDate(now, days - 1);
    const span = summarizeSessionSpan(sessionRows, map, registrantScan, todayKey, formatDateKey(end), todayKey);
    return {
      label: `Next ${days} days (thru ${Utilities.formatDate(end, TIMEZONE, 'MMM d')})`,
      sessions: span.sessions,
      registrations: span.registrations,
      // Null, not zero, when no session in the window has a cap at all. Most
      // programs here are uncapped, and "0% full" would be a bare-faced lie
      // about a week of open-door sessions.
      seatsFilledPct: percentageOrNull(span.seatsTaken, span.seatsOffered),
      emptySeats: span.cappedSessions > 0 ? span.emptySeats : null,
      waitlisted: span.waitlisted
    };
  });

  const months = computeMonthOverMonth(sessionRows, map, registrantScan, now, todayKey);
  return { windows, months };
}

/**
 * This month so far against the same span of last month.
 *
 * "NEW" AND "RETURNING" ARE DIFFERENT QUESTIONS, and neither is the other's
 * complement. New counts people this workbook has never seen in any earlier
 * month. Returning counts people who were also here LAST month specifically.
 * Somebody last seen in June is neither — they are a lapsed member who came
 * back, which is a third thing and is left unnamed rather than folded into one
 * of the two and quietly distorting it.
 *
 * Both are asked of THIS SPAN'S participants, so neither depends on the
 * current month being over. A definition anchored on the previous cohort
 * ("what share of August came back") would read artificially low for the first
 * three weeks of every September, for no reason except the date.
 *
 * THE LIMIT WORTH KNOWING: "never seen before" means "has no earlier row on
 * Registrant_Dash". Someone whose earlier registrations were deleted — a
 * cleared test run, a purge — reads as new again. Old rows are hidden rather
 * than removed (see collapseOldPastMonths), so ordinary aging does not do
 * this; deletion does, and deletion is a deliberate act.
 */
function computeMonthOverMonth(sessionRows, map, registrantScan, now, todayKey) {
  const dayOfMonth = now.getDate();
  const thisMonth = monthSpanThroughDay(now.getFullYear(), now.getMonth(), dayOfMonth);
  const lastMonth = monthSpanThroughDay(now.getFullYear(), now.getMonth() - 1, dayOfMonth);
  const monthBefore = monthSpanThroughDay(now.getFullYear(), now.getMonth() - 2, dayOfMonth);

  const periodFor = (span, priorSpan) => {
    const summary = summarizeSessionSpan(sessionRows, map, registrantScan,
      formatDateKey(span.start), formatDateKey(span.end), todayKey);
    const monthKey = formatMonthKey(span.start);
    const priorMonthKey = formatMonthKey(priorSpan.start);

    let newPeople = 0;
    let returning = 0;
    summary.people.forEach(person => {
      if (registrantScan.earliestMonthByPerson[person] === monthKey) newPeople++;
      const seen = registrantScan.monthsByPerson[person];
      if (seen && seen.has(priorMonthKey)) returning++;
    });

    return {
      label: describeDateSpan(span.start, span.end),
      sessions: summary.sessions,
      registrations: summary.registrations,
      participants: summary.people.size,
      newPeople: newPeople,
      returningPct: percentageOrNull(returning, summary.people.size),
      perSession: summary.registeringSessions > 0
        ? Math.round((summary.registrations / summary.registeringSessions) * 10) / 10
        : null,
      // Blank rather than 0% when NOTHING in the span was ticked. A month in
      // which not one person was marked present is overwhelmingly a desk that
      // did not tick rather than a center nobody walked into, and "0%" is a
      // far more confident claim than the data supports.
      attendedPct: summary.pastAttended > 0
        ? percentageOrNull(summary.pastAttended, summary.pastRegistrations)
        : null
    };
  };

  return {
    current: periodFor(thisMonth, lastMonth),
    previous: periodFor(lastMonth, monthBefore)
  };
}

/**
 * One cell of the Change row: "▲ 38", "▼ 3 pts", "—".
 *
 * AN ARROW RATHER THAN A COLOR, deliberately. Green-up/red-down is the obvious
 * move and it fails twice here: the sign-in material off this workbook gets
 * printed in black and white, and a color has to decide that up is GOOD, which
 * is false of half these columns — a month with more sessions in it is not
 * self-evidently a better month. An arrow states the direction and leaves the
 * judgement to the person reading, which is where it belongs.
 *
 * Percentages move in POINTS. Sixty-one percent up from fifty-eight is three
 * points, not five percent, and writing it the other way is how a modest
 * month gets reported as a triumph.
 */
function formatMetricChange(current, previous, options) {
  options = options || {};
  if (current === null || current === undefined || previous === null || previous === undefined) return '—';
  const delta = current - previous;
  const rounded = options.decimals ? Math.round(delta * 10) / 10 : Math.round(delta);
  if (rounded === 0) return '—';
  const unit = options.points ? ' pts' : '';
  const magnitude = options.decimals ? Math.abs(rounded).toFixed(1) : Math.abs(rounded);
  return `${rounded > 0 ? '▲' : '▼'} ${magnitude}${unit}`;
}

/**
 * Writes Event_Time as a formula reading "10:00 AM – 11:30 AM" off the row's
 * own start and end cells.
 *
 * A FORMULA rather than a written string because Sheets coerces a cell that
 * merely LOOKS like a time into one, at which point the tab's own formatting
 * decides how it reads and the range half is lost. The IF handles a row
 * written before Event_End existed: no end, no dash, just the start time.
 */
function setEventTimeFormulas(sheet, dataStart, count, map, dateColLetter) {
  if (count < 1) return;
  const endColLetter = map['Event_End'] === undefined ? '' : columnToLetter(map['Event_End'] + 1);
  const formulas = [];
  for (let i = 0; i < count; i++) {
    const r = dataStart + i;
    const start = `TEXT(${dateColLetter}${r},"h:mm AM/PM")`;
    formulas.push([endColLetter
      ? `=IF(${endColLetter}${r}="",${start},${start}&" – "&TEXT(${endColLetter}${r},"h:mm AM/PM"))`
      : `=${start}`]);
  }
  sheet.getRange(dataStart, map['Event_Time'] + 1, count, 1).setFormulas(formulas);
}

/** Clears the sheet and redraws all sections in order, then applies all formatting. */
/**
 * Puts the generated lunch rows BACK ON SCREEN — the inverse of what used to
 * happen here, and the reason this function still exists rather than simply
 * being deleted.
 *
 * They were hidden on the argument that a meal is not a program and thirty
 * identical rows a month are noise between staff and the classes. Both halves
 * of that were really about the old NAME: every row read "🥡 Lunch Only (no
 * program)", so thirty of them said nothing thirty times and the tab appeared
 * to announce that nothing was on. A row that reads "Lunch @ Narberth — Chx
 * Parm" is a line on the schedule like any other, and hiding the day's lunch
 * from the tab staff read to see what is running was never what anybody
 * wanted.
 *
 * SHOWING HAS TO BE DONE, not merely not-hidden. Hiding is a property of the
 * sheet's ROWS, not of their contents: it survives clear() and every rewrite
 * of the tab, so a workbook that has ever run the old code would keep its
 * lunch rows invisible forever unless something explicitly shows them. This is
 * that something, and it runs on every render — which also undoes a row
 * somebody hid by hand.
 *
 * Shown in RUNS, for the same reason they were hidden in runs: a month of
 * lunches is one showRows() call per unbroken stretch, not thirty.
 */
function showLunchOnlySessionRows(sheet, map, upcoming, past, result) {
  const bands = [];
  const collect = (rows, startRow) => {
    let runStart = -1;
    rows.forEach((row, i) => {
      if (isLunchOnlyEventId(row[map['Event_ID']])) {
        if (runStart === -1) runStart = i;
        return;
      }
      if (runStart !== -1) {
        bands.push({ start: startRow + runStart, count: i - runStart });
        runStart = -1;
      }
    });
    if (runStart !== -1) bands.push({ start: startRow + runStart, count: rows.length - runStart });
  };
  collect(upcoming, result.upcomingDataStart);
  collect(past, result.pastDataStart);

  let shown = 0;
  bands.forEach(band => {
    try {
      sheet.showRows(band.start, band.count);
      shown += band.count;
    } catch (err) {
      log(`ℹ️ Could not show ${band.count} lunch row(s) at row ${band.start} (${err}).`);
    }
  });
  return shown;
}

/**
 * The near-term window table's columns, and what each one means. The notes go
 * onto the header CELLS rather than into the banner, because the question a
 * column raises ("returning since when?") is asked while looking straight at
 * it, and a note is answered by hovering the word itself.
 */
const METRIC_WINDOW_HEADERS = [
  ['Coming Up', 'A rolling window starting today. Each row says the date it runs to.'],
  ['Sessions', 'Every program session in the window, drop-ins included. Lunch is not a program and is counted on the lunch dashboard.'],
  ['Registered', 'Active registrations across those sessions. People on a waitlist are in the last column, not this one.'],
  ['Seats Filled', 'Seats taken ÷ seats offered, across CAPPED sessions only.\n\nBlank when nothing in the window has a cap — most programs here are uncapped, and "0% full" would be a lie about a week of open-door sessions. Can read over 100% where a session took more than its cap.'],
  ['Empty Seats', 'Unsold seats across capped sessions — the number a phone call can still change. Blank when nothing in the window has a cap.'],
  ['Waitlisted', 'People the window is turning away. A number that stays up here is the case for putting on a second session.']
];

/** The month-over-month table's columns. Same reasoning about the notes. */
const METRIC_MONTH_HEADERS = [
  ['Month Over Month', 'This month SO FAR against the same span of last month — Sep 1–14 against Aug 1–14, not against the whole of August.\n\nComparing a fortnight against a full month makes every change read negative for the first three weeks of every month. Each row says the span it covers.'],
  ['Sessions', 'Every program session dated in the span, drop-ins included.'],
  ['Registered', 'Active registrations on those sessions.'],
  ['Participants', 'Distinct PEOPLE behind those registrations — somebody at four sessions counts once. Matched on name the way the rest of the workbook matches it, so casing and stray spaces do not split one person in two.'],
  ['New People', 'Participants with no earlier registration anywhere in this workbook.\n\nDeleting somebody’s history makes them new again; ordinary aging does not, since old rows are hidden rather than removed.'],
  ['Returning', 'Share of this span’s participants who were also here LAST month.\n\nNot the opposite of New People: somebody last seen in June is neither — they came back after a gap, which is a third thing.'],
  ['Avg / Session', 'Registrations ÷ the sessions that take registration.\n\n[No Registration] drop-ins are left out of the divisor: their zero registrations are structural, and counting them would make a healthy month of drop-ins read as a collapse in demand.'],
  ['Attendance', 'Share of registrations ticked Attended, across sessions in the span that have ALREADY happened.\n\nBlank when nothing in the span was ticked at all — that is a desk that did not tick, not a center nobody walked into.']
];

/**
 * Writes the whole metrics block — banner, near-term windows, month over month
 * — and returns the first row after it, so the caller can carry on down the
 * tab without knowing how tall the block turned out to be.
 *
 * ONE BANNER OVER TWO TABLES, not two sections. Everything above the session
 * table travels in the frozen band (see freezeRowsSafely), so every row spent
 * here is a row of the session table that nobody can see; a second banner and
 * a second spacer would be two of them spent on punctuation. The tables label
 * themselves — the first column of each header says which question it answers
 * — and the first two number columns mean the same thing in both, so the eye
 * can run straight down Sessions and Registered.
 */
function writeProgramMetricsSection(sheet, startRow, numCols, metrics) {
  let row = startRow;
  writeSectionBanner(sheet, row, numCols, '📈 Program Metrics', {
    note: 'Nothing here is a running total. The top table is what is COMING — how full the next week and month are, and how many seats are still to be sold. The bottom table is how this month is going against the same span of last month.\n\nHover any column heading for what it counts.'
  });
  row++;

  const pct = value => (value === null || value === undefined ? '—' : value / 100);
  const num = value => (value === null || value === undefined ? '—' : value);

  // --- Near-term windows ---
  writeSectionHeader(sheet, row, METRIC_WINDOW_HEADERS.length, METRIC_WINDOW_HEADERS.map(h => h[0]));
  sheet.getRange(row, 1, 1, METRIC_WINDOW_HEADERS.length).setNotes([METRIC_WINDOW_HEADERS.map(h => h[1])]);
  row++;
  const windowStart = row;
  const windowRows = metrics.windows.map(w =>
    [w.label, w.sessions, w.registrations, pct(w.seatsFilledPct), num(w.emptySeats), w.waitlisted]);
  sheet.getRange(windowStart, 1, windowRows.length, METRIC_WINDOW_HEADERS.length).setValues(windowRows);
  styleMetricTable(sheet, windowStart, windowRows.length, METRIC_WINDOW_HEADERS.length);
  sheet.getRange(windowStart, 2, windowRows.length, 2).setNumberFormat('0');
  sheet.getRange(windowStart, 4, windowRows.length, 1).setNumberFormat('0%');
  sheet.getRange(windowStart, 5, windowRows.length, 2).setNumberFormat('0');
  row += windowRows.length;

  // --- Month over month ---
  writeSectionHeader(sheet, row, METRIC_MONTH_HEADERS.length, METRIC_MONTH_HEADERS.map(h => h[0]));
  sheet.getRange(row, 1, 1, METRIC_MONTH_HEADERS.length).setNotes([METRIC_MONTH_HEADERS.map(h => h[1])]);
  row++;
  const monthStart = row;
  const current = metrics.months.current;
  const previous = metrics.months.previous;
  const monthRows = [
    [`This month (${current.label})`, current.sessions, current.registrations, current.participants,
      current.newPeople, pct(current.returningPct), num(current.perSession), pct(current.attendedPct)],
    [`Last month (${previous.label})`, previous.sessions, previous.registrations, previous.participants,
      previous.newPeople, pct(previous.returningPct), num(previous.perSession), pct(previous.attendedPct)],
    ['Change',
      formatMetricChange(current.sessions, previous.sessions),
      formatMetricChange(current.registrations, previous.registrations),
      formatMetricChange(current.participants, previous.participants),
      formatMetricChange(current.newPeople, previous.newPeople),
      formatMetricChange(current.returningPct, previous.returningPct, { points: true }),
      formatMetricChange(current.perSession, previous.perSession, { decimals: true }),
      formatMetricChange(current.attendedPct, previous.attendedPct, { points: true })]
  ];
  sheet.getRange(monthStart, 1, monthRows.length, METRIC_MONTH_HEADERS.length).setValues(monthRows);
  styleMetricTable(sheet, monthStart, monthRows.length, METRIC_MONTH_HEADERS.length);
  // Formats are set on the two DATA rows only. The Change row holds strings
  // ("▲ 38", "—"), which a number format leaves alone — but a percent format
  // over a cell somebody later retypes as a bare number would silently
  // multiply it by a hundred, so the row is left plain.
  sheet.getRange(monthStart, 2, 2, 4).setNumberFormat('0');
  sheet.getRange(monthStart, 6, 2, 1).setNumberFormat('0%');
  sheet.getRange(monthStart, 7, 2, 1).setNumberFormat('0.0');
  sheet.getRange(monthStart, 8, 2, 1).setNumberFormat('0%');

  // The Change row is derived from the two above it rather than counted off
  // the sheet, and reads as a different KIND of line: one stripe says so
  // without adding a heading for a single row.
  const changeRow = monthStart + monthRows.length - 1;
  sheet.getRange(changeRow, 1, 1, METRIC_MONTH_HEADERS.length).setBackground(PALETTE.STRIPE);
  row += monthRows.length;

  return row;
}

/** Shared look for both metric tables: a bold label column, centered numbers, ordinary row height. */
function styleMetricTable(sheet, startRow, numRows, numCols) {
  if (numRows < 1) return;
  sheet.getRange(startRow, 1, numRows, numCols).setVerticalAlignment('middle');
  sheet.getRange(startRow, 1, numRows, 1)
    .setFontSize(TYPO.HERO_LABEL.size)
    .setFontWeight(TYPO.HERO_LABEL.weight)
    .setFontColor(TYPO.HERO_LABEL.color);
  sheet.getRange(startRow, 2, numRows, numCols - 1)
    .setFontSize(TYPO.METRIC_VALUE.size)
    .setFontWeight(TYPO.METRIC_VALUE.weight)
    .setFontColor(TYPO.METRIC_VALUE.color)
    .setHorizontalAlignment('center');
  for (let r = 0; r < numRows; r++) {
    try { sheet.setRowHeight(startRow + r, ROW_HEIGHTS.DATA); } catch (err) { /* row absent */ }
  }
}

function writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, force) {
  invalidateEventTimeIndex(); // the session table's times are about to be rewritten
  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // see renderFlatDateSheet() — hidden rows outlive clear()
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  // NOTES OUTLIVE clear(), like hidden rows and validations do, and this tab
  // now carries a dozen of them explaining the metric columns. They are
  // written at whatever row the block lands on, and that row MOVES — a
  // location added to CALENDAR_MAP shifts everything below the Today block —
  // so yesterday's notes have to be swept before today's are written, or the
  // tab accumulates explanations attached to the wrong cells. Everything on
  // this tab that sets a note does so after this line.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();

  const numCols = headers.length;
  let row = 1;

  // --- Section A: Today at Each Location (the hero block) ---
  writeSectionBanner(sheet, row, numCols,
    `📍 TODAY — ${Utilities.formatDate(new Date(), TIMEZONE, 'EEEE, MMM d, yyyy')}`, { hero: true });
  row++;
  writeSectionHeader(sheet, row, TODAY_AT_LOCATIONS_HEADERS.length, TODAY_AT_LOCATIONS_HEADERS);
  row++;
  const todayDataStart = row;
  const todayRowsOut = todayData.map(t => [t.location, t.programsToday, t.sessionsToday, t.registeredToday]);
  if (todayRowsOut.length > 0) {
    const todayRange = sheet.getRange(todayDataStart, 1, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length);
    todayRange.setValues(todayRowsOut).setVerticalAlignment('middle');
    // Same treatment as the lunch dashboard's Today block: this is the line
    // someone reads while walking past, so the numbers get real size.
    sheet.getRange(todayDataStart, 1, todayRowsOut.length, 1)
      .setFontSize(TYPO.HERO_LABEL.size).setFontWeight('bold');
    sheet.getRange(todayDataStart, 2, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length - 1)
      .setFontSize(TYPO.HERO_VALUE.size)
      .setFontWeight(TYPO.HERO_VALUE.weight)
      .setFontColor(TYPO.HERO_VALUE.color)
      .setHorizontalAlignment('center');
    for (let r = 0; r < todayRowsOut.length; r++) {
      try { sheet.setRowHeight(todayDataStart + r, ROW_HEIGHTS.HERO_DATA); } catch (err) { /* row absent */ }
    }
  }
  applyZebraStripingManualBounded(sheet, todayDataStart, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length);
  row += todayRowsOut.length;
  row++; // spacer

  // --- Section B: Program Metrics (near-term windows + month over month) ---
  row = writeProgramMetricsSection(sheet, row, numCols, metrics);
  row++; // spacer

  // --- Section C: All Program Sessions, split into Upcoming / Past ---
  const todayKey = formatDateKey(new Date());
  const { upcoming, past } = partitionByDate(sessionRows, map['Event_Date'], todayKey);
  const result = writeUpcomingPastSections(sheet, row, headers, upcoming, past, {
    upcomingLabel: '🔜 Upcoming Sessions', pastLabel: '🕓 Past Sessions'
  });

  const dateColLetter = columnToLetter(map['Event_Date'] + 1);
  setEventTimeFormulas(sheet, result.upcomingDataStart, upcoming.length, map, dateColLetter);
  setEventTimeFormulas(sheet, result.pastDataStart, past.length, map, dateColLetter);

  // THE LUNCH ROWS ARE ON THE VIEW, and are put back onto it if an older
  // render (or a person) hid them — see showLunchOnlySessionRows(). The banner
  // says nothing about them any more because there is nothing left to explain:
  // they read as what they are.
  showLunchOnlySessionRows(sheet, map, upcoming, past, result);

  const zones = [
    { start: result.upcomingDataStart, count: upcoming.length },
    { start: result.pastDataStart, count: past.length }
  ];
  const rules = [];
  const locationRanges = [];
  if (todayRowsOut.length > 0) locationRanges.push(sheet.getRange(todayDataStart, 1, todayRowsOut.length, 1));

  zones.forEach(z => {
    if (z.count < 1) return;
    ['Active_Count', 'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats'].forEach(h => {
      sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0');
    });
    applyLocationValidationBounded(sheet, map['Location'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Type_Tag'] + 1, EVENT_TYPE_OPTIONS, z.start, z.count);
    // Club and No_Registration are real checkboxes — one click, and the click
    // is what handleProgramFlagEdit() turns into a calendar-description tag.
    // Text in these columns (a workbook written by an older version says
    // "Club") is normalized to a tick by reconcileProgramFlagColumns() on the
    // next sync, and reads correctly in the meantime — see isFlagColumnValue().
    PROGRAM_FLAG_COLUMNS.forEach(flag => {
      if (map[flag.column] === undefined) return;
      sheet.getRange(z.start, map[flag.column] + 1, z.count, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });

    Object.keys(EVENT_STATUS_COLORS).forEach(text => {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(EVENT_STATUS_COLORS[text])
        .setRanges([sheet.getRange(z.start, map['Status'] + 1, z.count, 1)]).build());
    });
    locationRanges.push(sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  });

  rules.push(...buildLocationColorRules(locationRanges));
  sheet.setConditionalFormatRules(rules);

  // NO YELLOW MANUAL-ENTRY WASH HERE, deliberately. Type_Tag, Club and
  // No_Registration are the cells a human changes on this table, but none of
  // them is a blank waiting to be filled in — each always already holds a
  // real, calendar-derived value, and washing full columns of correct values
  // in "please type here" yellow read as columns of problems on the tab people
  // scan first. A dropdown and two checkboxes, each with a confirmation dialog
  // behind it (see handleProgramDashboardEdit) — the prompt is the affordance,
  // not the color. Everything else keeps its warning protection.
  protectDerivedColumns(sheet, headers,
    ['Event_Date', 'Clean_Title', 'Event_Time', 'Event_End', 'Active_Count', 'Waitlist_Count',
      'Remaining_Seats', 'Status', 'Form_ID', 'Event_ID', 'Calendar_Source',
      'Leader_Sheet_Link', 'Sign_In_Sheet_Link'],
    zones);

  applyColumnVisibility(sheet, headers, PROGRAM_DASHBOARD_HIDDEN_COLUMNS);

  // THROUGH THE SESSION TABLE'S HEADER ROW, like every other tab in this
  // workbook — not through the Today block, which is where this used to stop.
  // The bulk of this tab is the session table: hundreds of rows, twenty
  // columns, and the only thing that says which column is which was the first
  // thing to scroll off the top of it. Freezing here keeps the Today and
  // metrics blocks visible as well, since they sit above it — the old
  // behaviour, plus the headers it was missing.
  freezeRowsSafely(sheet, result.upcomingHeaderRow);
  freezeColumnsSafely(sheet, 3); // date, location, program name
  autosizeColumns(sheet, { force: !!force, minCols: headers.length });
  log(`renderProgramDashboard complete: ${todayRowsOut.length} location(s) today, ${upcoming.length} upcoming / ${past.length} past session row(s).`);
}


