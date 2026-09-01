// ============================================================================
// 15. THE APPOINTMENT REVIEW  (one month, one location, one form)
// ============================================================================
//
// WHAT THIS ANSWERS that section 14 cannot. The program review walks PROGRAMS:
// one line per thing that carries a name, however many months it runs for.
// That is the right unit for "is this program set up correctly" and the wrong
// unit for the only question anybody ever asks about [Personalized Assistance]:
//
//     "Does the September form at Narberth offer every September date,
//      and every appointment on every one of those dates?"
//
// That question is about a MONTH at a PLACE, because a month at a place is
// what one form covers (buildEventGroups() keys on `scope::title::span`, and
// span is the month label). So this reviews exactly that: one entry per
// program per location per month, and every fact underneath it is a fact about
// the form somebody is about to hand out.
//
// THE THREE WAYS A MONTH GOES WRONG, all of which look identical from the
// outside — a form that is missing times — and none of which the dashboard
// shows:
//
//   1. THE ROW'S TIMES ARE STALE. Event_Date and Event_End are written once,
//      when a date first appears, and an appointment's slots are cut out of
//      them (buildAppointmentSlots()). Stretch the calendar event from
//      10:00-10:30 to 10:00-11:30 afterwards and the row still says half an
//      hour, so the form offers ONE appointment on a date that now holds
//      three. reconcileSessionTimesFromCalendar() fixes this on every sync
//      now; this names the ones that are still wrong, and how many
//      appointments each is hiding.
//
//   2. THE DAY IS STILL SEVERAL EVENTS. A provider's afternoon typed one
//      calendar event per appointment collides onto one Event_ID and one row
//      (see section 12). Reviewed here rather than only in the general merge
//      list, because from this screen you can see what it is COSTING: the
//      duplicate rows it left behind, and the times the form is repeating.
//
//   3. THE MONTH IS SPREAD OVER TWO FORMS. Half of September on one link and
//      half on another is the failure that hurts most, because both links
//      work: whoever follows the first sees eight dates and has no way to know
//      about the other four. "Put this month on one form" is one press here.
//
// AND THE FOURTH, WHICH IS NOT A FAULT: a month whose sessions are all in the
// past, or all booked. Both produce a form with no times on it, both are
// correct, and both are said in words rather than left looking like a failure.
//
// NOTHING IS APPLIED UNTIL THE END, exactly as in section 14 and for the same
// reason: the decisions are quick and the consequences are slow, so the
// consequences are done once, together, when Apply is pressed --
// assistanceReviewApply().
// ============================================================================

/** How many month-entries the dialog will draw. Beyond this it is a bootstrap, not a review. */
const ASSISTANCE_REVIEW_LIMIT = 200;

/**
 * The span a run of calendar blocks covers, and how many of them it took.
 *
 * ONE IMPLEMENTATION, because three places need the same judgement and the
 * judgement is the whole substance: back-to-back blocks within a comfort break
 * of each other are one session, and a gap longer than that is two separate
 * things that happen to share a day. See TIME_BLOCK_MAX_GAP_MINUTES.
 *
 * `blocks` is [{ start, end }] in any order. Returns
 * { start, end, spanned, blocks } - `spanned` being how many of them the span
 * actually swallowed, so a caller can tell "one event" from "six that tile".
 */
function spanOfContiguousBlocks(blocks) {
  const ordered = (blocks || []).filter(b => b && b.start).sort((a, b) => a.start - b.start);
  if (ordered.length === 0) return null;
  const first = ordered[0];
  let cursor = first.end || null;
  let spanned = 1;
  for (let i = 1; i < ordered.length; i++) {
    if (!cursor) break;
    const next = ordered[i];
    const gapMinutes = (next.start.getTime() - cursor.getTime()) / 60000;
    // A negative gap is two events on top of each other, which is a mistake
    // somebody has to look at rather than a span - describeTimeBlockRun()
    // refuses it for the same reason.
    if (gapMinutes < 0 || gapMinutes > TIME_BLOCK_MAX_GAP_MINUTES) break;
    if (!next.end || next.end <= cursor) break;
    cursor = next.end;
    spanned++;
  }
  return { start: first.start, end: (spanned > 1 ? cursor : first.end) || null, spanned, blocks: ordered.length };
}

/**
 * ONE PASS OVER THE CALENDAR, reduced to what this review asks of it: per
 * calendar-title-day, the blocks that are on it, the span they cover, and what
 * the description says about appointments.
 *
 * Keyed by sessionTimeKey() - calendar, clean title, day - which is what an
 * Event_ID is built from, so every fact here lines up with exactly one session
 * row (or with the several rows a day of blocks left behind).
 *
 * `unreadable` names any calendar that could not be read, for the same reason
 * readCalendarFactsForReview() does: without it, an outage reports itself as
 * every program on that calendar having vanished.
 */
function readAssistanceCalendarFacts() {
  let start, end, eventsByCalendar;
  try {
    const range = computeSyncDateRange();
    start = range.start;
    end = range.end;
    eventsByCalendar = getCalendarEventsForWindow(start, end);
  } catch (err) {
    return { byDay: {}, unreadable: [], windowLabel: '', error: String(err) };
  }

  const byDay = {};
  const unreadable = [];

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) { unreadable.push(locationName); return; }
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      // A tentative "*" event is not something to review a form against - see
      // findCollapsibleTimeBlocks(), which refuses to merge them for the same
      // reason.
      if (!parsed || parsed.isTentative) return;
      const settings = resolveEventSettings(ev, parsed);
      const evStart = ev.getStartTime();
      if (!evStart) return;
      const key = sessionTimeKey(calendarId, parsed.cleanTitle, formatDateKey(evStart));
      if (!byDay[key]) {
        byDay[key] = {
          key, calendarId, location: locationName, title: parsed.cleanTitle,
          dateKey: formatDateKey(evStart), blocks: [], isAssistance: false,
          slotMinutes: 0, maxPerMonth: 0, statedCapacity: 0
        };
      }
      const day = byDay[key];
      day.blocks.push({ start: evStart, end: ev.getEndTime() || null, eventId: ev.getId() });
      // Any block of the day carrying the tag makes the day an appointment day
      // - the same "never un-set" rule buildEventGroups() applies, and for the
      // same reason: a missing tag on the second block is an omission, not a
      // contradiction.
      if (settings.isAssistance) day.isAssistance = true;
      if (!day.slotMinutes && settings.slotMinutes) day.slotMinutes = settings.slotMinutes;
      if (!day.maxPerMonth && settings.maxPerMonth) day.maxPerMonth = settings.maxPerMonth;
      if (!day.statedCapacity && settings.capacity) day.statedCapacity = settings.capacity;
    });
  });

  Object.keys(byDay).forEach(key => {
    const day = byDay[key];
    const span = spanOfContiguousBlocks(day.blocks);
    day.start = span ? span.start : null;
    day.end = span ? span.end : null;
    day.spanned = span ? span.spanned : 0;
    day.blockCount = day.blocks.length;
  });

  return {
    byDay, unreadable, error: '',
    windowLabel: `${formatDateLabel(start)} - ${formatDateLabel(end)}`
  };
}

/**
 * A month entry's identity: where, what, when. The same shape a form covers.
 *
 * The separator is deliberately not "::", which is what a group key and a
 * program-review id use: a calendar ID is an email address and a program title
 * can hold almost anything, so the one string this has to survive round-tripping
 * through a browser and back is built from a separator neither of them contains.
 */
const ASSISTANCE_REVIEW_ID_SEPARATOR = '␟';

function assistanceReviewId(scope, title, monthLabel) {
  return [scope, title, monthLabel].join(ASSISTANCE_REVIEW_ID_SEPARATOR);
}

/** The inverse - { scope, title, monthLabel }, or null for anything unparseable. */
function parseAssistanceReviewId(id) {
  const parts = String(id || '').split(ASSISTANCE_REVIEW_ID_SEPARATOR);
  if (parts.length !== 3 || !parts[1]) return null;
  return { scope: parts[0], title: parts[1], monthLabel: parts[2] };
}

/**
 * THE WHOLE REVIEW: one entry per program per location per month - the unit a
 * form covers - with its sessions, its assertions and the actions that would
 * fix them.
 *
 * TWO READS AND NO FORMS OPENED, the same budget section 14 keeps to: the
 * session table, the registrant table (for what is already booked) and one
 * pass over the calendar window. Everything else is arithmetic. Opening forty
 * forms to ask each what it is currently offering is a minute of waiting for
 * an answer this can derive.
 */
function buildAssistanceReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const empty = {
    ready: false, months: [], forms: [],
    summary: { total: 0, problems: 0, warnings: 0, sessions: 0, freeSlots: 0, hiddenSlots: 0 },
    unreadable: [], windowLabel: '', calendarError: ''
  };
  if (!sheet) return empty;

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  if (map['Personalized_Assistance'] === undefined) return empty;

  // readAllSectionedRowValues(), not readAllSectionedRows(): nothing here is
  // going back onto a sheet, so one read of each tab answers all of it - and
  // Registrant_Dash's Event_Time is a FORMULA, which the formula-preserving
  // read hands back as its own source text rather than as a time any booked
  // slot could be matched on.
  const rows = readAllSectionedRowValues(sheet, headers, 'Event_ID');
  const registrantRows = readAllSectionedRowValues(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.Registrant_Dash, 'Event_ID');
  const booked = readBookedAppointmentTimes(registrantRows);
  const facts = readAssistanceCalendarFacts();
  const sharedFormIds = getSharedFormIdSet();
  const todayKey = formatDateKey(new Date());

  // ---- 1. every session that is an appointment, from EITHER side ----------
  // From the sheet, because that is what the forms are built from; and from
  // the calendar, because a program tagged there but never synced has no row
  // at all and is exactly the thing somebody opens this to find.
  const bySession = {};
  const noteSession = (calendarId, title, dateKey, location) => {
    const key = sessionTimeKey(calendarId, title, dateKey);
    if (!bySession[key]) {
      bySession[key] = {
        key, calendarId, title, dateKey, location: location || CALENDAR_MAP[calendarId] || '',
        rows: [], day: facts.byDay[key] || null
      };
    }
    if (location && !bySession[key].location) bySession[key].location = location;
    return bySession[key];
  };

  rows.forEach(row => {
    if (isLunchOnlyEventId(row[map['Event_ID']])) return;
    const title = String(row[map['Clean_Title']] || '').trim();
    const calendarId = String(row[map['Calendar_Source']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!title || !date) return;
    const dateKey = formatDateKey(date);
    const day = facts.byDay[sessionTimeKey(calendarId, title, dateKey)];
    // AN APPOINTMENT BY EITHER RECKONING. The tick on the sheet is what the
    // form layer reads; the tag on the calendar is what the next sync will
    // write. A session where those two disagree is a fault this review exists
    // to report, so it must not be filtered out by agreeing with one of them.
    if (!isAssistanceColumnValue(row[map['Personalized_Assistance']]) && !(day && day.isAssistance)) return;
    noteSession(calendarId, title, dateKey, String(row[map['Location']] || '').trim()).rows.push(row);
  });

  Object.keys(facts.byDay).forEach(key => {
    const day = facts.byDay[key];
    if (!day.isAssistance) return;
    noteSession(day.calendarId, day.title, day.dateKey, day.location);
  });

  // ---- 2. describe each session, then bucket by month ---------------------
  const byMonth = {};
  Object.keys(bySession).forEach(key => {
    const session = describeAssistanceSession(bySession[key], map, booked, sharedFormIds, todayKey);
    // A shared program takes ALL_LOCATIONS as its scope for the same reason
    // buildEventGroups() does: one form covers both rooms, so one entry has to
    // review both.
    const scope = session.isShared ? SHARED_LOCATION_SCOPE : session.calendarId;
    const id = assistanceReviewId(scope, session.title, session.monthLabel);
    if (!byMonth[id]) {
      byMonth[id] = { id, scope, title: session.title, monthLabel: session.monthLabel, sessions: [] };
    }
    byMonth[id].sessions.push(session);
  });

  const months = Object.keys(byMonth)
    .map(id => describeAssistanceMonth(byMonth[id]))
    .sort(compareAssistanceMonths)
    .slice(0, ASSISTANCE_REVIEW_LIMIT);
  // THE INVERSE OF A SPLIT MONTH, and the only assertion here that cannot be
  // made from inside one month: a form carrying MORE than this month.
  noteFormsCarryingSeveralMonths(months);

  const summary = {
    total: months.length,
    problems: months.filter(m => m.worst === REVIEW_LEVELS.PROBLEM).length,
    warnings: months.filter(m => m.worst === REVIEW_LEVELS.WARN).length,
    sessions: months.reduce((n, m) => n + m.totals.sessions, 0),
    freeSlots: months.reduce((n, m) => n + m.totals.free, 0),
    // The number this whole screen exists to drive to zero: appointments that
    // exist on the calendar and are on nobody's form.
    hiddenSlots: months.reduce((n, m) => n + m.totals.hidden, 0)
  };

  return {
    ready: true, months, summary,
    forms: listAssistanceFormChoices(months),
    unreadable: facts.unreadable, windowLabel: facts.windowLabel, calendarError: facts.error
  };
}

/**
 * ONE SESSION, both sides of it: what the sheet says its span is, what the
 * calendar says, how many appointments each of those answers implies, and how
 * many of them are still free.
 *
 * `hidden` is the gap between the two, and it is the number worth reading:
 * appointments the calendar holds that no form is offering, because the row
 * they are cut from is out of date.
 */
function describeAssistanceSession(entry, map, booked, sharedFormIds, todayKey) {
  const rows = entry.rows;
  const first = rows[0] || null;
  const day = entry.day;

  const sheetStart = first ? coerceDate(first[map['Event_Date']]) : null;
  const sheetEnd = (first && map['Event_End'] !== undefined)
    ? clockTimeOnDayOf(coerceDate(first[map['Event_End']]), sheetStart) : null;
  const date = sheetStart || (day ? day.start : null);
  const statedSlotMinutes = (first && map['Slot_Minutes'] !== undefined)
    ? Number(first[map['Slot_Minutes']]) || 0 : 0;
  const slotMinutes = resolveSlotMinutes({ slotMinutes: statedSlotMinutes || (day ? day.slotMinutes : 0) });

  const sheetSlots = sheetStart ? buildAppointmentSlots(sheetStart, sheetEnd, slotMinutes) : [];
  const calendarSlots = (day && day.start) ? buildAppointmentSlots(day.start, day.end, slotMinutes) : [];

  const eventId = first ? String(first[map['Event_ID']] || '').trim()
    : computeEventId(entry.calendarId, entry.title, entry.dateKey);
  const takenLabels = booked[eventId] || new Set();
  // Counted against what the FORM is actually offering (the sheet's slots),
  // not against the calendar's - a booking can only ever have been made into a
  // time the form showed.
  const taken = sheetSlots.filter(slot => takenLabels.has(slot.startLabel)).length;

  const formIds = dedupePreservingOrder(rows
    .map(row => String(row[map['Form_ID']] || '').trim()).filter(Boolean));
  const past = entry.dateKey < todayKey;

  return {
    key: entry.key,
    eventId,
    calendarId: entry.calendarId,
    location: entry.location,
    title: entry.title,
    dateKey: entry.dateKey,
    dateLabel: date ? formatDateLabel(date) : entry.dateKey,
    monthLabel: date ? getMonthLabel(date) : '',
    past,
    onSheet: rows.length > 0,
    onCalendar: !!day,
    duplicateRows: Math.max(0, rows.length - 1),
    blockCount: day ? day.blockCount : 0,
    // A day that is still several events AND tiles back-to-back is a diary
    // waiting to be merged. Several events with a lunch break between them are
    // two separate sessions and no business of this screen.
    collapsible: !!(day && day.blockCount > 1 && day.spanned > 1),
    tickedOnSheet: rows.some(row => isAssistanceColumnValue(row[map['Personalized_Assistance']])),
    taggedOnCalendar: !!(day && day.isAssistance),
    slotMinutes,
    statedSlotMinutes,
    calendarSlotMinutes: day ? day.slotMinutes : 0,
    sheetTimeLabel: sheetStart ? formatTimeRange(sheetStart, sheetEnd) : '',
    calendarTimeLabel: (day && day.start) ? formatTimeRange(day.start, day.end) : '',
    // The two arithmetics, side by side. Everything the checks below say about
    // a missing appointment is the difference between these.
    slots: sheetSlots.length,
    calendarSlots: calendarSlots.length,
    hidden: past ? 0 : Math.max(0, calendarSlots.length - sheetSlots.length),
    taken,
    free: past ? 0 : Math.max(0, sheetSlots.length - taken),
    timesAgree: sessionTimesAgree(sheetStart, sheetEnd, day),
    formIds,
    formId: formIds[0] || '',
    isShared: !!(sharedFormIds && formIds.some(id => sharedFormIds.has(id)))
  };
}

/** Whether a row's start and end are still what the calendar says they are. */
function sessionTimesAgree(sheetStart, sheetEnd, day) {
  if (!day || !day.start) return true; // nothing to disagree with
  if (!sheetStart) return false;
  if (sheetStart.getTime() !== day.start.getTime()) return false;
  if (!day.end) return !sheetEnd;
  return !!(sheetEnd && sheetEnd.getTime() === day.end.getTime());
}

/**
 * ONE MONTH AT ONE PLACE, with the assertions that say whether the form
 * covering it is right.
 *
 * THE ASSERTIONS ARE ORDERED BY WHAT THEY COST somebody. A month split over
 * two links has already been handed out wrongly; stale times are hiding
 * appointments nobody can book; a day still typed as blocks is untidy and
 * costs a duplicate row. So they are asserted in that order, and the worst one
 * decides where the month sorts.
 *
 * EACH ONE NAMES ITS OWN FIX, and the fix is the key of an action
 * assistanceReviewApply() knows how to carry out. That is the whole point of
 * reviewing this way round: the screen that tells you what is wrong is the
 * screen that puts it right, and neither has to describe the other.
 */
function describeAssistanceMonth(entry) {
  const sessions = entry.sessions.slice().sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
  const upcoming = sessions.filter(s => !s.past);
  const locations = dedupePreservingOrder(sessions.map(s => s.location).filter(Boolean));

  const totals = {
    sessions: sessions.length,
    upcoming: upcoming.length,
    slots: upcoming.reduce((n, s) => n + s.slots, 0),
    taken: upcoming.reduce((n, s) => n + s.taken, 0),
    free: upcoming.reduce((n, s) => n + s.free, 0),
    hidden: upcoming.reduce((n, s) => n + s.hidden, 0),
    duplicateRows: sessions.reduce((n, s) => n + s.duplicateRows, 0),
    collapsibleDays: sessions.filter(s => s.collapsible).length
  };

  // WHICH FORMS THIS MONTH IS ON, counted by session, upcoming only: a past
  // date sitting on a retired form is finished business and is not a reason to
  // tell somebody their September is split.
  const formCounts = {};
  upcoming.forEach(s => s.formIds.forEach(id => { formCounts[id] = (formCounts[id] || 0) + 1; }));
  const formIds = Object.keys(formCounts).sort((a, b) => formCounts[b] - formCounts[a]);
  // The form most of the month is already on. Combining onto THAT one keeps
  // the most links that have already been handed out working, which is the
  // only sensible default when the alternative is breaking the majority.
  const primaryFormId = formIds[0] || '';

  const checks = [];
  const actions = {};

  // ---- 1. one month, two forms -------------------------------------------
  if (formIds.length > 1) {
    actions.combine = primaryFormId;
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${upcoming.length} upcoming date(s) in ${entry.monthLabel} are spread across ${formIds.length} ` +
      `different forms (${formIds.map(id => `${id.substring(0, 8)}... has ${formCounts[id]}`).join(', ')}). ` +
      `Both links work, so whoever follows one of them sees part of the month and has no way to know ` +
      `about the rest.`,
      'combine'));
  } else if (upcoming.length > 0 && formIds.length === 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `None of the ${upcoming.length} upcoming date(s) in ${entry.monthLabel} is on a form at all, so ` +
      `there is nothing for anybody to book through. Update Everything builds one.`,
      'sync'));
  }

  // ---- 2. the row's times are not the calendar's --------------------------
  const stale = upcoming.filter(s => !s.timesAgree);
  if (stale.length > 0) {
    actions.retime = true;
    const hiding = stale.reduce((n, s) => n + s.hidden, 0);
    checks.push(reviewCheck(hiding > 0 ? REVIEW_LEVELS.PROBLEM : REVIEW_LEVELS.WARN,
      `${stale.length} date(s) have times on the sheet that the calendar no longer agrees with` +
      (hiding > 0
        ? ` — ${hiding} appointment(s) exist on the calendar that no form is offering. ` +
          `${stale.slice(0, 3).map(s => `${s.dateLabel}: the sheet says ${s.sheetTimeLabel || '(no time)'}, ` +
            `the calendar says ${s.calendarTimeLabel || '(no time)'}`).join('; ')}.`
        : '. The slots still work out the same, but the sheet is reporting a time nobody is keeping.'),
      'retime'));
  }

  // ---- 3. a date that yields one appointment out of a real span -----------
  const noEnd = upcoming.filter(s => s.timesAgree && s.onCalendar && s.slots <= 1 && s.calendarSlots <= 1);
  if (noEnd.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${noEnd.length} date(s) hold exactly one appointment (${noEnd.slice(0, 3).map(s =>
        `${s.dateLabel} ${s.calendarTimeLabel || s.sheetTimeLabel || '(no end time)'}`).join('; ')}). ` +
      `That is right for a single ${noEnd[0].slotMinutes}-minute ` +
      `consultation, and wrong for a morning that was meant to hold several — lengthen the calendar ` +
      `event, or set a shorter appointment length below.`));
  }

  // ---- 4. a day still typed as one event per appointment ------------------
  if (totals.collapsibleDays > 0) {
    actions.merge = true;
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${totals.collapsibleDays} day(s) are still typed as several back-to-back calendar events rather ` +
      `than one span. Every one of those events hashes to the same session (an Event_ID carries no time), ` +
      `so they collide onto one row and the form repeats their times. Merging them into one event per ` +
      `day is what [${ASSISTANCE_TAG}] was built for.`,
      'merge'));
  }
  if (totals.duplicateRows > 0) {
    actions.tidy = true;
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${totals.duplicateRows} extra dashboard row(s) share a session with another row. They are what a ` +
      `day of separate blocks left behind: same Event_ID, same registrants, counted twice on every ` +
      `total the dashboard shows.`,
      'tidy'));
  }

  // ---- 5. the sheet and the calendar disagree about what this even is -----
  const untagged = sessions.filter(s => s.tickedOnSheet && s.onCalendar && !s.taggedOnCalendar);
  if (untagged.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${untagged.length} date(s) are ticked as appointments on the dashboard but carry no ` +
      `[${ASSISTANCE_TAG}] on the calendar. The calendar is the source of truth for that tick, so the ` +
      `next sync will clear it — use "Push Dashboard Ticks to the Calendar" to make it stick.`));
  }
  const unticked = sessions.filter(s => s.taggedOnCalendar && s.onSheet && !s.tickedOnSheet);
  if (unticked.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${unticked.length} date(s) are tagged [${ASSISTANCE_TAG}] on the calendar but not ticked on the ` +
      `dashboard, so their form is still asking which DATES people want rather than which time.`,
      'sync'));
  }
  const missingRows = sessions.filter(s => s.onCalendar && !s.onSheet);
  if (missingRows.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.PROBLEM,
      `${missingRows.length} date(s) are on the calendar and have no row on the dashboard at all ` +
      `(${missingRows.slice(0, 3).map(s => s.dateLabel).join(', ')}), so no form covers them.`,
      'sync'));
  }
  const missingEvents = upcoming.filter(s => s.onSheet && !s.onCalendar);
  if (missingEvents.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `${missingEvents.length} upcoming date(s) are on the dashboard but not on the calendar ` +
      `(${missingEvents.slice(0, 3).map(s => s.dateLabel).join(', ')}). Either the event was deleted, or ` +
      `the calendar could not be read this time.`));
  }

  // ---- 6. one appointment length per program ------------------------------
  const lengths = dedupePreservingOrder(sessions.map(s => s.slotMinutes));
  if (lengths.length > 1) {
    checks.push(reviewCheck(REVIEW_LEVELS.WARN,
      `This month is cut into appointments of ${lengths.join(' and ')} minutes on different dates. ` +
      `That is legitimate where a provider genuinely runs two lengths, and is usually a "[Slots: N]" ` +
      `typed onto some of the events and not others — set one length below to settle it.`,
      'slots'));
  }

  // ---- 7. and the things that are NOT faults ------------------------------
  if (upcoming.length === 0 && sessions.length > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.INFO,
      `Every date in ${entry.monthLabel} has passed. Its form offering no times is correct.`));
  } else if (upcoming.length > 0 && totals.free === 0 && totals.slots > 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.INFO,
      `Every one of the ${totals.slots} appointment(s) left in ${entry.monthLabel} is booked. The form ` +
      `offers only "${ASSISTANCE_NO_TIME_CHOICE}", which is right — that is how somebody asks to be ` +
      `fitted in.`));
  }

  if (checks.length === 0) {
    checks.push(reviewCheck(REVIEW_LEVELS.OK,
      `${entry.monthLabel}: ${upcoming.length} upcoming date(s), ${totals.slots} appointment(s) ` +
      `(${totals.free} still free), all on one form.`));
  }

  const worst = checks.reduce((acc, c) => {
    if (c.level === REVIEW_LEVELS.PROBLEM) return REVIEW_LEVELS.PROBLEM;
    if (c.level === REVIEW_LEVELS.WARN && acc !== REVIEW_LEVELS.PROBLEM) return REVIEW_LEVELS.WARN;
    return acc;
  }, REVIEW_LEVELS.OK);

  return {
    id: entry.id,
    scope: entry.scope,
    title: entry.title,
    monthLabel: entry.monthLabel,
    locations,
    locationLabel: describeLocations(locations),
    sessions,
    formIds,
    formCounts,
    primaryFormId,
    slotMinutes: lengths[0] || APPOINTMENT_SLOT_MINUTES,
    // What somebody has actually TYPED, as opposed to what resolveSlotMinutes()
    // falls back to. The difference matters wherever a default would overrule
    // real evidence — see mergeAssistanceBlocksForMonth().
    statedSlotMinutes: sessions.map(s => s.statedSlotMinutes || s.calendarSlotMinutes).filter(Boolean)[0] || 0,
    totals,
    checks,
    actions,
    worst,
    // Sorted on, so a month that needs attention and starts soonest is first.
    nextDateKey: (upcoming[0] || sessions[sessions.length - 1] || { dateKey: '9999-99-99' }).dateKey
  };
}

/**
 * ONE LINK, MORE THAN ONE MONTH — asserted across the whole review, because it
 * is a relationship BETWEEN entries and no entry can see it from the inside.
 *
 * WHY IT IS WORTH SAYING. What staff hand out is "the September form", and what
 * makes that true is the month in the group key: buildEventGroups() gives each
 * month of an ordinary program its own form. An appointment form carrying
 * September AND October offers a list of times running into next month —
 * which is not wrong, exactly, but it is not what the link was described as,
 * and the October dates on it are dates the October link cannot then claim.
 *
 * Two different PROGRAMS on one form is the sharper version of the same thing
 * and is said in stronger words: one program's registrants are being filed
 * under another's name.
 *
 * The fix on both is "combine", with the default flipped to a NEW form —
 * putting this month onto the form it is already sharing is the one answer
 * that changes nothing.
 */
function noteFormsCarryingSeveralMonths(months) {
  const byForm = {};
  months.forEach(month => {
    month.formIds.forEach(formId => {
      if (!byForm[formId]) byForm[formId] = [];
      byForm[formId].push(month);
    });
  });

  Object.keys(byForm).forEach(formId => {
    const sharing = byForm[formId];
    if (sharing.length < 2) return;
    const monthLabels = dedupePreservingOrder(sharing.map(m => m.monthLabel));
    const titles = dedupePreservingOrder(sharing.map(m => m.title));
    // ONE NAME AT TWO PLACES IS NOT THIS. A cross-location program takes one
    // sign-up across both rooms by design, and reporting it here would put half
    // the building on this list for working correctly.
    if (titles.length === 1 && monthLabels.length === 1) return;

    sharing.forEach(month => {
      month.actions.combine = month.primaryFormId;
      month.combineDefault = 'new';
      month.checks.unshift(reviewCheck(
        titles.length > 1 ? REVIEW_LEVELS.PROBLEM : REVIEW_LEVELS.WARN,
        titles.length > 1
          ? `The form these dates are on (${formId.substring(0, 8)}...) also carries ` +
            `${titles.filter(t => t !== month.title).map(t => `"${t}"`).join(', ')}. One program's ` +
            `registrants are being filed under another's name.`
          : `The form these dates are on (${formId.substring(0, 8)}...) also carries ` +
            `${monthLabels.filter(l => l !== month.monthLabel).join(', ')}. Whoever is handed it as ` +
            `"the ${month.monthLabel} form" gets a list of times running into the other month(s) too.`,
        'combine'));
      month.worst = month.checks.some(c => c.level === REVIEW_LEVELS.PROBLEM)
        ? REVIEW_LEVELS.PROBLEM
        : (month.checks.some(c => c.level === REVIEW_LEVELS.WARN) ? REVIEW_LEVELS.WARN : month.worst);
    });
  });
  // The sort above ran before these were added, so a month that has just become
  // a problem would otherwise sit below the ones that always were.
  months.sort(compareAssistanceMonths);
}

/** Worst first, then soonest, then by name - the order somebody wants to work down. */
function compareAssistanceMonths(a, b) {
  const rank = { problem: 0, warn: 1, ok: 2, info: 2 };
  const ra = rank[a.worst] === undefined ? 2 : rank[a.worst];
  const rb = rank[b.worst] === undefined ? 2 : rank[b.worst];
  if (ra !== rb) return ra - rb;
  if (a.nextDateKey !== b.nextDateKey) return a.nextDateKey < b.nextDateKey ? -1 : 1;
  return a.title.localeCompare(b.title) || a.monthLabel.localeCompare(b.monthLabel);
}

/**
 * Every form these months already sit on, as { formId, label, editUrl }, for
 * the "move these dates onto..." picker.
 *
 * The edit URL is BUILT rather than fetched, the same trick
 * buildFormLinkageReport() uses and for the same reason: FormApp.openById() is
 * a remote round trip each, and the canonical /forms/d/<id>/edit address is
 * what Google itself redirects to.
 */
function listAssistanceFormChoices(months) {
  const byForm = {};
  (months || []).forEach(month => {
    month.formIds.forEach(formId => {
      if (!byForm[formId]) {
        byForm[formId] = {
          formId, editUrl: `https://docs.google.com/forms/d/${formId}/edit`, titles: [], sessions: 0
        };
      }
      const entry = byForm[formId];
      if (entry.titles.indexOf(month.title) === -1) entry.titles.push(month.title);
      entry.sessions += month.formCounts[formId] || 0;
    });
  });
  return Object.keys(byForm).map(id => {
    const entry = byForm[id];
    entry.label = `${entry.titles.join(', ')} - ${entry.sessions} upcoming date(s)`;
    return entry;
  }).sort((a, b) => a.label.localeCompare(b.label));
}


// ---------------------------------------------------------------------------
// THE ACTIONS  (each one is the fix named by an assertion above)
// ---------------------------------------------------------------------------
//
// EVERY ONE OF THEM RE-READS BEFORE IT WRITES. The month entry the browser
// sends back is a description of what was true when the dialog was drawn, and
// between drawing and pressing Apply somebody may have moved an event, deleted
// a date or run a sync. So the id is the only thing taken from the browser;
// what is done is decided from a review built fresh on this side. That is the
// same rule collapseTimeBlockRun() keeps when it re-fetches every event it is
// about to merge, and it is what makes pressing Apply twice safe.
// ---------------------------------------------------------------------------

/**
 * Collapses every day of this month that is still typed as back-to-back
 * blocks, into one event tagged as appointments.
 *
 * Scoped to the month rather than sweeping the calendar, because that is what
 * the person is looking at: the general list is its own menu item (section 12),
 * and merging somebody else's October from a screen about this September is
 * not what pressing this button says it does.
 */
function mergeAssistanceBlocksForMonth(month) {
  const wanted = {};
  month.sessions.filter(s => s.collapsible)
    .forEach(s => { wanted[`${s.calendarId}|${s.dateKey}`] = true; });
  if (Object.keys(wanted).length === 0) {
    return { ok: true, changed: 0, message: `"${month.title}" ${month.monthLabel}: no back-to-back blocks left.` };
  }

  const runs = findCollapsibleTimeBlocks({}).filter(run =>
    run.title === month.title && wanted[`${run.calendarId}|${run.dateKey}`]);
  if (runs.length === 0) {
    return { ok: true, changed: 0,
      message: `"${month.title}" ${month.monthLabel}: those days are no longer several events - nothing to merge.` };
  }

  const lines = [];
  let failures = 0;
  runs.forEach(run => {
    // slotMinutes ONLY where somebody has actually said one. Left out, the merge
    // takes the length from the blocks themselves (the commonest one), which is
    // better evidence than a resolveSlotMinutes() default of
    // APPOINTMENT_SLOT_MINUTES — passing that would turn a diary of 20-minute
    // appointments into 30-minute ones on the strength of nothing.
    const outcome = collapseTimeBlockRun(run, month.statedSlotMinutes
      ? { asAppointments: true, slotMinutes: month.statedSlotMinutes }
      : { asAppointments: true });
    lines.push(outcome.message);
    if (!outcome.ok) failures++;
  });
  return { ok: failures === 0, changed: runs.length, message: lines.join('\n') };
}

/**
 * Brings this month's session rows back into line with the calendar - the
 * fix for the assertion that costs the most and shows the least.
 *
 * It is reconcileSessionTimesFromCalendar()'s writer, handed only this
 * month's days. Doing it here rather than leaving it to the next sync matters
 * because the form rebuild at the end of this same apply reads those rows: a
 * retime deferred by an hour is a form that stays wrong for an hour.
 */
function retimeAssistanceMonth(registrySheet, month, facts) {
  const expected = {};
  month.sessions.forEach(session => {
    const day = facts.byDay[session.key];
    if (!day || !day.start) return;
    expected[session.key] = { start: day.start, end: day.end || null };
  });
  if (Object.keys(expected).length === 0) {
    return { ok: true, changed: 0,
      message: `"${month.title}" ${month.monthLabel}: no calendar events to take times from.` };
  }
  const changed = applySessionTimesToRows(registrySheet, expected);
  return {
    ok: true, changed,
    message: changed > 0
      ? `"${month.title}" ${month.monthLabel}: ${changed} row(s) now carry the times the calendar has.`
      : `"${month.title}" ${month.monthLabel}: the rows already matched the calendar.`
  };
}

/**
 * Sets ONE appointment length across this month - on the calendar events
 * first, because that is the source of truth, and then on the rows so the
 * forms do not have to wait an hour to agree.
 *
 * The tag is written alongside it. Somebody setting an appointment length on a
 * program has said it is an appointment program; making them tick a second box
 * to have that believed would be asking the same question twice.
 */
function applyAssistanceSlotMinutes(month, minutes, facts) {
  const wanted = Number(minutes) || 0;
  if (wanted < MIN_APPOINTMENT_SLOT_MINUTES || wanted > MAX_APPOINTMENT_SLOT_MINUTES) {
    return { ok: false, changed: 0,
      message: `"${month.title}": ${minutes} is not a usable appointment length - it must be between ` +
        `${MIN_APPOINTMENT_SLOT_MINUTES} and ${MAX_APPOINTMENT_SLOT_MINUTES} minutes.` };
  }

  const calendars = {};
  const calendarFor = calendarId => {
    if (!Object.prototype.hasOwnProperty.call(calendars, calendarId)) {
      try {
        calendars[calendarId] = CalendarApp.getCalendarById(calendarId);
      } catch (err) {
        calendars[calendarId] = null;
      }
    }
    return calendars[calendarId];
  };

  let written = 0;
  const stuck = [];
  month.sessions.forEach(session => {
    const day = facts.byDay[session.key];
    if (!day) return;
    const calendar = calendarFor(day.calendarId);
    if (!calendar) { stuck.push(`${session.dateLabel} (calendar unreadable)`); return; }
    day.blocks.forEach(block => {
      let ev = null;
      try {
        ev = calendar.getEventById(block.eventId);
      } catch (err) {
        ev = null;
      }
      if (!ev) { stuck.push(`${session.dateLabel} (event no longer there)`); return; }
      try {
        const before = ev.getDescription() || '';
        let after = setFlagBracketInDescription(before, ASSISTANCE_WORDS_REGEX, ASSISTANCE_TAG, true);
        after = setSlotMinutesInDescription(after, wanted);
        // A tag that says nothing new is not written to the calendar: every
        // write is a revision on somebody's event, and an unchanged
        // description is not worth one.
        if (after !== before) { ev.setDescription(after); written++; }
      } catch (err) {
        stuck.push(`${session.dateLabel} (${err})`);
      }
    });
  });
  if (written > 0) invalidateCalendarEventsCache();

  let rowsChanged = 0;
  try {
    const registrySheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) {
      const expected = {};
      month.sessions.forEach(session => {
        const key = `${session.calendarId}|${month.title}`;
        if (!expected[key]) {
          expected[key] = { isAssistance: true, slotMinutes: wanted, statedCapacity: 0, dateKeys: {} };
        }
        // Scoped to THIS month's dates — see applyAssistanceSettingsToRows().
        expected[key].dateKeys[session.dateKey] = true;
      });
      rowsChanged = applyAssistanceSettingsToRows(registrySheet, expected, { writeFlagColumn: true });
    }
  } catch (err) {
    log(`Set the appointment length on "${month.title}" but could not update its rows (${err}) - ` +
      `the next sync will.`);
  }

  return {
    ok: stuck.length === 0,
    changed: written + rowsChanged,
    message: `"${month.title}" ${month.monthLabel}: appointments are ${wanted} minutes long ` +
      `(${written} calendar event(s) retagged, ${rowsChanged} row(s) updated)` +
      (stuck.length > 0 ? `. Not set on: ${dedupePreservingOrder(stuck).join('; ')}.` : '.')
  };
}

/**
 * Puts every upcoming date of this month onto ONE form.
 *
 * PAST DATES ARE LEFT WHERE THEY ARE, deliberately. A date that has already
 * happened is a record of who came, its form is closed business, and moving it
 * would repoint a link nobody is going to follow while making the roster
 * harder to find.
 *
 * `formRef` is a form ID or URL to move onto, or the word "new" to build a
 * combined form covering exactly these dates. Defaults to the form most of the
 * month is already on, which keeps the most already-handed-out links working.
 */
function combineAssistanceMonthOntoOneForm(month, formRef) {
  const eventIds = dedupePreservingOrder(month.sessions.filter(s => !s.past && s.onSheet)
    .map(s => s.eventId).filter(Boolean));
  if (eventIds.length === 0) {
    return { ok: true, changed: 0,
      message: `"${month.title}" ${month.monthLabel}: no upcoming dates on the dashboard to move.` };
  }

  const wantNew = String(formRef || '').trim().toLowerCase() === 'new';
  const target = wantNew
    ? { mode: 'new', title: `${month.title} - ${month.monthLabel}` }
    : { mode: 'existing', formRef: String(formRef || '').trim() || month.primaryFormId };
  if (!wantNew && !target.formRef) {
    return { ok: false, changed: 0,
      message: `"${month.title}" ${month.monthLabel}: no form to move these dates onto - pick one, or ` +
        `choose to build a new one.` };
  }

  const message = repointSessionsToForm(eventIds, target);
  const ok = message.indexOf('⚠️') === -1;
  return {
    ok,
    // "Nothing was moved" is the answer when they are already on one form,
    // which is a success and must not count as a change worth syncing for.
    changed: (ok && message.indexOf('Nothing was moved') === -1) ? eventIds.length : 0,
    message: `"${month.title}" ${month.monthLabel}: ${message}`
  };
}

/**
 * Removes the extra dashboard rows a day of separate blocks left behind:
 * several rows carrying ONE Event_ID.
 *
 * WHICH ROW SURVIVES is the one covering the longest span - after a retime
 * that is the row grown over the whole run, and it is the one whose slots the
 * form is built from. A tie goes to the row that has a Form_ID, because a row
 * with no form on it is the one that was never linked to anything.
 *
 * NOTHING IS LOST WITH THEM. The duplicates carry the same Event_ID as the
 * survivor, so every registration, every roster and every link already points
 * at the row that stays; the counts on the tab stop being doubled, which is
 * the whole visible effect.
 */
function tidyDuplicateAssistanceRows(monthIds) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return { ok: false, changed: 0, message: '⚠️ No program dashboard yet.' };

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = readAllSectionedRows(sheet, headers, 'Event_ID');

  // Only the programs whose months were actually chosen. A workbook can hold
  // duplicate rows this screen has said nothing about, and quietly deleting
  // those is not what pressing this button offered to do.
  const wantedTitles = {};
  (monthIds || []).forEach(id => {
    const parsed = parseAssistanceReviewId(id);
    if (parsed) wantedTitles[parsed.title] = true;
  });

  const spanOf = row => {
    const start = coerceDate(row[map['Event_Date']]);
    const end = map['Event_End'] === undefined ? null : clockTimeOnDayOf(coerceDate(row[map['Event_End']]), start);
    return (start && end && end > start) ? end.getTime() - start.getTime() : 0;
  };

  const bestByEventId = {};
  const dropped = [];
  rows.forEach((row, index) => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const title = String(row[map['Clean_Title']] || '').trim();
    if (!eventId || isLunchOnlyEventId(eventId) || !wantedTitles[title]) return;
    const current = bestByEventId[eventId];
    if (!current) { bestByEventId[eventId] = { index, span: spanOf(row), hasForm: !!String(row[map['Form_ID']] || '').trim() }; return; }
    const span = spanOf(row);
    const hasForm = !!String(row[map['Form_ID']] || '').trim();
    const better = span > current.span || (span === current.span && hasForm && !current.hasForm);
    if (better) { dropped.push(current.index); bestByEventId[eventId] = { index, span, hasForm }; }
    else dropped.push(index);
  });

  if (dropped.length === 0) {
    return { ok: true, changed: 0, message: 'No duplicate session rows left to tidy.' };
  }
  const doomed = new Set(dropped);
  renderProgramDashboardFromRows(rows.filter((row, index) => !doomed.has(index)));
  const message = `✅ ${dropped.length} duplicate session row(s) removed. Every one of them shared an ` +
    `Event_ID with a row that stays, so nothing that pointed at those sessions has moved.`;
  log(`tidyDuplicateAssistanceRows: ${message}`);
  return { ok: true, changed: dropped.length, message };
}

/**
 * Re-stocks the time question on named forms WHATEVER their fingerprint says.
 *
 * refreshAppointmentSlotsForAllForms() skips a form whose free-slot list hashes
 * to what it wrote last time, which is right on an hourly sync and wrong at the
 * end of this screen: somebody has just been told their form was missing times
 * and pressed the button that fixes it, and "already offered exactly these
 * times" is not an answer they can act on. Clearing the key for the affected
 * forms makes the next pass open them.
 */
/**
 * Every form the named program-months currently sit on, read FRESH from the
 * dashboard.
 *
 * WHY NOT JUST REMEMBER WHICH FORMS WERE TOUCHED. The forms collected while a
 * plan is being applied are the forms these months were on BEFORE it ran, and
 * the whole point of "combine" and "move" is that they are not on those forms
 * afterwards — a brand-new combined form has an ID nothing in the plan could
 * have named. Asking the sheet at the end is the only answer that includes it.
 */
function formIdsForAssistanceMonths(monthIds) {
  const titles = {};
  (monthIds || []).forEach(id => {
    const parsed = parseAssistanceReviewId(id);
    if (parsed) titles[parsed.title] = true;
  });
  if (Object.keys(titles).length === 0) return [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  return dedupePreservingOrder(readAllSectionedRowValues(sheet, headers, 'Event_ID')
    .filter(row => titles[String(row[map['Clean_Title']] || '').trim()])
    .map(row => String(row[map['Form_ID']] || '').trim())
    .filter(Boolean));
}

function forceRefreshAssistanceForms(formIds) {
  const ids = dedupePreservingOrder((formIds || []).filter(Boolean));
  if (ids.length === 0) return 0;
  const fingerprints = getFormLabelFingerprints();
  ids.forEach(formId => {
    if (fingerprints[`${formId}::appointments`] === undefined) return;
    delete fingerprints[`${formId}::appointments`];
    __formLabelFingerprintDirty = true;
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return 0;
  const touched = refreshAppointmentSlotsForAllForms(sheet);
  flushPersistentRegistries();
  return touched;
}


// ---------------------------------------------------------------------------
// THE ONE BIG APPLY
// ---------------------------------------------------------------------------

/**
 * Every decision made while walking the appointment review, carried out in one
 * pass, followed by one update of the calendar, the sheet and the forms.
 *
 * THE ORDER IS THE CAUSAL ONE, and it is the whole reason this is a single
 * function rather than five buttons:
 *
 *   1. MERGE, and 2. SET THE APPOINTMENT LENGTH - both write the CALENDAR,
 *      inside one quiet window so the calendar-edit triggers are paused once
 *      rather than per program (see withCalendarChangeTriggersPaused).
 *   3. RETIME - reads the calendar those two just changed and writes the rows.
 *      After them, never before: retiming first would copy times that are
 *      about to be replaced.
 *   4. TIDY - removes duplicate rows, which is only safe once the survivor has
 *      been grown over the whole span in step 3.
 *   5. COMBINE / MOVE - repoints forms, which reads the rows steps 3 and 4
 *      just settled, and rebuilds each destination form's date list.
 *   6. ONE SYNC, if anything above reached the calendar: that is what rebuilds
 *      every other form and rewrites the event links.
 *   7. THE APPOINTMENT QUESTIONS, forced. This is the line somebody actually
 *      came for - the September form now offering every September date and
 *      every time on each of them - and it runs LAST because it reads the
 *      rows everything above has been settling.
 *
 * RE-SENDING THE SAME PLAN IS SAFE. Every step is idempotent: a merged day has
 * no blocks left to merge, a retime finds the rows already matching, a combine
 * reports "nothing was moved", and a tidy finds no duplicates. So an execution
 * that dies partway - the six-minute limit is the realistic way - is finished
 * by pressing Apply again rather than half-done twice.
 *
 * `plan` is { entries: [{ id, merge, retime, slots, combine, tidy }],
 *             moves: [{ eventId, formRef }], sync: bool }.
 */
function assistanceReviewApply(planJson) {
  if (isBootstrapActive()) {
    return JSON.stringify({ message: bootstrapBusyMessage(), ok: false });
  }
  let plan;
  try {
    plan = JSON.parse(planJson || '{}') || {};
  } catch (err) {
    return JSON.stringify({ message: `⚠️ Could not read what was selected (${err}).`, ok: false });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    return JSON.stringify({ message: '⚠️ No program dashboard yet - run Sync Cal first.', ok: false });
  }

  // THE BROWSER SENDS IDS, NOT FACTS. Everything acted on below is looked up
  // in a review built here, now - see the note above the actions.
  const review = buildAssistanceReview();
  const byId = {};
  review.months.forEach(m => { byId[m.id] = m; });

  const entries = [];
  const seen = {};
  (plan.entries || []).forEach(entry => {
    if (!entry || !entry.id || !byId[entry.id]) return;
    if (seen[entry.id] !== undefined) entries[seen[entry.id]] = entry; // last answer wins
    else { seen[entry.id] = entries.length; entries.push(entry); }
  });

  const lines = [];
  let failures = 0;
  let calendarChanged = false;
  let anythingChanged = false;
  const touchedFormIds = [];
  const noteForms = month => month.formIds.forEach(id => touchedFormIds.push(id));

  const unknown = (plan.entries || []).filter(e => e && e.id && !byId[e.id]).length;
  if (unknown > 0) {
    lines.push(`ℹ️ ${unknown} of the months on screen are no longer in the review - the calendar has ` +
      `changed since it was drawn. They were skipped; reopen this to see them as they are now.`);
  }

  // ---- 1 & 2. the calendar, in one quiet window ---------------------------
  const calendarWork = entries.filter(e => e.merge || e.slots);
  if (calendarWork.length > 0) {
    let facts = readAssistanceCalendarFacts();
    let factsStale = false;
    withCalendarChangeTriggersPaused(
      `Appointment review - ${calendarWork.length} program-month(s)`, () => {
        calendarWork.forEach(entry => {
          const month = byId[entry.id];
          if (entry.merge) {
            const outcome = mergeAssistanceBlocksForMonth(month);
            lines.push(outcome.message);
            if (!outcome.ok) failures++;
            if (outcome.changed > 0) { calendarChanged = true; anythingChanged = true; factsStale = true; }
          }
          if (entry.slots) {
            // Re-read after a merge: the events this is about to retag are not
            // the events that were there when the facts above were gathered.
            if (factsStale) { facts = readAssistanceCalendarFacts(); factsStale = false; }
            const outcome = applyAssistanceSlotMinutes(month, entry.slots, facts);
            lines.push(outcome.message);
            if (!outcome.ok) failures++;
            if (outcome.changed > 0) { calendarChanged = true; anythingChanged = true; }
          }
          noteForms(month);
        });
      });
  }

  // ---- 3. the rows follow the calendar ------------------------------------
  const retimes = entries.filter(e => e.retime);
  if (retimes.length > 0) {
    // One read for the whole batch, taken AFTER every calendar write above.
    const facts = readAssistanceCalendarFacts();
    retimes.forEach(entry => {
      const month = byId[entry.id];
      const outcome = retimeAssistanceMonth(registrySheet, month, facts);
      lines.push(outcome.message);
      if (!outcome.ok) failures++;
      if (outcome.changed > 0) anythingChanged = true;
      noteForms(month);
    });
  }

  // ---- 4. the duplicate rows ----------------------------------------------
  const tidyIds = entries.filter(e => e.tidy).map(e => e.id);
  if (tidyIds.length > 0) {
    tidyIds.forEach(id => noteForms(byId[id]));
    const outcome = tidyDuplicateAssistanceRows(tidyIds);
    lines.push(outcome.message);
    if (!outcome.ok) failures++;
    if (outcome.changed > 0) anythingChanged = true;
  }

  // ---- 5. one month, one form ---------------------------------------------
  entries.filter(e => e.combine).forEach(entry => {
    const month = byId[entry.id];
    const outcome = combineAssistanceMonthOntoOneForm(month, entry.combine);
    lines.push(outcome.message);
    if (!outcome.ok) failures++;
    if (outcome.changed > 0) anythingChanged = true;
    noteForms(month);
  });

  // Individual dates moved somewhere else - the "move things as needed" half.
  // Grouped by destination so a handful of dates going to one form is one call
  // and one form rebuild rather than one apiece.
  const movesByForm = {};
  (plan.moves || []).forEach(move => {
    if (!move || !move.eventId || !move.formRef) return;
    const ref = String(move.formRef);
    if (!movesByForm[ref]) movesByForm[ref] = [];
    movesByForm[ref].push(String(move.eventId));
  });
  Object.keys(movesByForm).forEach(ref => {
    const target = ref.toLowerCase() === 'new'
      ? { mode: 'new', title: '' }
      : { mode: 'existing', formRef: ref };
    const message = repointSessionsToForm(dedupePreservingOrder(movesByForm[ref]), target);
    lines.push(message);
    if (message.indexOf('⚠️') !== -1) failures++;
    else {
      anythingChanged = true;
      // extractFormId(): the box accepts an edit URL, and a fingerprint is
      // keyed by the form's own ID.
      if (ref.toLowerCase() !== 'new') touchedFormIds.push(extractFormId(ref) || ref);
    }
  });

  // ---- 6. one sync ---------------------------------------------------------
  const wantSync = calendarChanged || plan.sync === true;
  if (wantSync) {
    const synced = runReviewSync();
    lines.push(synced.message);
    if (!synced.ran) failures++;
  }

  // ---- 7. and the thing this screen is about -------------------------------
  if (anythingChanged || wantSync) {
    try {
      const touched = forceRefreshAssistanceForms(
        touchedFormIds.concat(formIdsForAssistanceMonths(entries.map(e => e.id))));
      lines.push(touched > 0
        ? `✅ Appointment times rewritten on the affected form(s) - ${touched} question edit(s).`
        : 'The appointment questions on those forms already offered exactly the right times.');
    } catch (err) {
      failures++;
      lines.push(`⚠️ The appointment times could not be rewritten (${err}). The next sync will try again.`);
    }
  }

  if (entries.length > 0 || Object.keys(movesByForm).length > 0) flushAdminDigest('Appointment review');
  if (lines.length === 0) lines.push('Nothing was selected, so nothing was changed.');
  log(`assistanceReviewApply: ${entries.length} month(s), ${Object.keys(movesByForm).length} move ` +
    `target(s), ${wantSync ? 'one sync' : 'no sync'}, ${failures} failure(s).`);

  return JSON.stringify({
    message: lines.join('\n'),
    ok: failures === 0,
    review: buildAssistanceReview()
  });
}

/** Re-runs the review and hands the browser a fresh payload, without reopening the dialog. */
function refreshAssistanceReview() {
  return JSON.stringify(buildAssistanceReview());
}


// ---------------------------------------------------------------------------
// THE DIALOG  (Programs & Forms - Review Appointment Months...)
// ---------------------------------------------------------------------------

/**
 * MENU ENTRY: walk the appointment months one at a time, decide them all, then
 * update once.
 *
 * ONE MONTH ON SCREEN AT A TIME, the same shape as the program review and for
 * the same reason: what makes a review get finished is that each screen asks
 * one answerable question. "Is the September Low-Cost Wills form right?" is
 * answerable in ten seconds from the facts on it; a table of every appointment
 * program in the building is not answerable at all.
 */
function showAssistanceReviewDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const review = buildAssistanceReview();
  const html = HtmlService.createHtmlOutput(buildAssistanceReviewHtml(review))
    .setWidth(780)
    .setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'Review Appointment Months');
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * NOTHING HERE CALLS THE SERVER UNTIL THE END - see assistanceReviewApply().
 * Walking the months, ticking a fix, choosing a form to combine onto, moving
 * one date somewhere else: all of it is held in one object in the browser and
 * sent in a single call when Apply is pressed.
 *
 * EVERY "<" IS ESCAPED OUT OF THE INLINE PAYLOAD, the same guard the program
 * review and the Quick Mark index use: a program called "Films </script>"
 * would otherwise end the script block in the middle of a sentence, leaving a
 * page that does nothing at all.
 */
function buildAssistanceReviewHtml(review) {
  const inlineJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const payload = inlineJson(review);
  const lengths = inlineJson([15, 20, 30, 45, 60, 90]);

  return `<!DOCTYPE html><html><head><base target="_top"><style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; margin: 0; padding: 12px 14px; color: #222; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 10px; }
  .card { border: 1px solid #ddd; border-radius: 6px; padding: 12px 14px; }
  .month { font-size: 16px; font-weight: bold; }
  .where { color: #555; margin-bottom: 8px; }
  .checks { margin: 8px 0 12px; padding: 0; list-style: none; }
  .checks li { margin: 0 0 6px; padding-left: 20px; text-indent: -20px; line-height: 1.45; }
  .problem { color: #a61b1b; }
  .warn { color: #8a5a00; }
  .ok { color: #1a7f37; }
  .info { color: #555; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 10px; }
  th, td { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f6f6f6; font-weight: bold; }
  td.num { text-align: right; }
  .stale { color: #a61b1b; }
  .fixes { background: #f8f9fb; border: 1px solid #e3e6ee; border-radius: 6px; padding: 10px 12px; }
  .fixes label { display: block; margin-bottom: 6px; line-height: 1.4; }
  .nav { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  button { padding: 6px 12px; font-size: 13px; }
  #status { margin-left: auto; color: #555; white-space: pre-wrap; }
  #status.bad { color: #a61b1b; }
  #status.good { color: #1a7f37; }
  .empty { padding: 24px 8px; color: #555; line-height: 1.5; }
  select, input[type=text] { font-size: 12px; padding: 2px 4px; max-width: 320px; }
  </style></head><body>
  <h2>Review Appointment Months</h2>
  <div class="sub" id="sub"></div>
  <div id="card" class="card"></div>
  <div class="nav">
    <button id="prev">&#8592; Back</button>
    <button id="next">Next &#8594;</button>
    <button id="apply">Apply &amp; Update</button>
    <span id="status"></span>
  </div>
<script>
  var review = ${payload};
  var LENGTHS = ${lengths};
  var at = 0;
  // One object, held here, sent once. See assistanceReviewApply().
  var plan = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function entry(id) {
    if (!plan[id]) plan[id] = { id: id };
    return plan[id];
  }

  function drawSub() {
    var s = review.summary || {};
    var bits = [];
    bits.push((s.total || 0) + ' program-month(s)');
    if (s.problems) bits.push(s.problems + ' with problems');
    if (s.warnings) bits.push(s.warnings + ' worth a look');
    bits.push((s.freeSlots || 0) + ' free appointment(s) on the forms');
    if (s.hiddenSlots) {
      bits.push('⚠️ ' + s.hiddenSlots + ' appointment(s) exist on the calendar that no form offers');
    }
    if ((review.unreadable || []).length) bits.push('⚠️ unreadable: ' + review.unreadable.join(', '));
    document.getElementById('sub').textContent = bits.join(' · ') +
      (review.windowLabel ? '  (' + review.windowLabel + ')' : '');
  }

  function draw() {
    drawSub();
    var card = document.getElementById('card');
    if (!review.ready) {
      card.innerHTML = '<div class="empty">This workbook has no program dashboard with a ' +
        'Personalized_Assistance column yet. Run <b>Update Everything Now</b> once, then reopen this.</div>';
      setButtons(true);
      return;
    }
    if (!review.months.length) {
      card.innerHTML = '<div class="empty">No appointment programs found in the sync window.<br><br>' +
        'A program becomes one by carrying <b>[Personalized Assistance]</b> in its calendar event ' +
        'description, or by having its Personalized_Assistance box ticked on the dashboard.</div>';
      setButtons(true);
      return;
    }
    if (at < 0) at = 0;
    if (at > review.months.length - 1) at = review.months.length - 1;
    var m = review.months[at];
    var e = plan[m.id] || {};

    var rows = m.sessions.map(function (s) {
      var times = esc(s.sheetTimeLabel || '—');
      if (!s.timesAgree) {
        times = '<span class="stale">' + times + '</span><br><span class="stale">calendar: ' +
          esc(s.calendarTimeLabel || '(no event)') + '</span>';
      }
      var notes = [];
      if (s.past) notes.push('past');
      if (s.collapsible) notes.push(s.blockCount + ' separate events');
      if (s.duplicateRows) notes.push(s.duplicateRows + ' duplicate row(s)');
      if (!s.onCalendar) notes.push('not on the calendar');
      if (!s.onSheet) notes.push('no dashboard row');
      if (s.hidden) notes.push(s.hidden + ' appointment(s) hidden');
      return '<tr><td>' + esc(s.dateLabel) + '</td><td>' + times + '</td>' +
        '<td class="num">' + s.slots + '</td><td class="num">' + s.taken + '</td>' +
        '<td class="num">' + s.free + '</td>' +
        '<td>' + esc(s.formId ? s.formId.substring(0, 8) + '…' : '—') + '</td>' +
        '<td>' + esc(notes.join(', ')) + '</td></tr>';
    }).join('');

    var checks = m.checks.map(function (c) {
      var mark = c.level === 'problem' ? '⛔' : (c.level === 'warn' ? '⚠️' :
        (c.level === 'ok' ? '✅' : 'ℹ️'));
      return '<li class="' + esc(c.level) + '">' + mark + ' ' + esc(c.text) + '</li>';
    }).join('');

    var fixes = [];
    if (m.actions.merge) {
      fixes.push(box('merge', e.merge, 'Merge each day’s back-to-back events into one span, tagged ' +
        'as appointments (' + m.totals.collapsibleDays + ' day(s))'));
    }
    fixes.push(box('retime', e.retime, 'Take the times from the calendar again' +
      (m.actions.retime ? ' — ' + m.totals.hidden + ' appointment(s) are hidden by stale rows' :
        ' (nothing is stale right now)')));
    if (m.actions.tidy) {
      fixes.push(box('tidy', e.tidy, 'Remove the ' + m.totals.duplicateRows +
        ' duplicate dashboard row(s) this program’s days left behind'));
    }
    fixes.push('<label><input type="checkbox" id="fx-slots"' + (e.slots ? ' checked' : '') + '> ' +
      'Set one appointment length: <select id="slot-len">' +
      LENGTHS.map(function (n) {
        return '<option value="' + n + '"' + ((e.slots || m.slotMinutes) === n ? ' selected' : '') +
          '>' + n + ' minutes</option>';
      }).join('') + '</select></label>');
    fixes.push('<label><input type="checkbox" id="fx-combine"' + (e.combine ? ' checked' : '') + '> ' +
      'Put every upcoming date of ' + esc(m.monthLabel) + ' on ONE form: <select id="combine-form">' +
      '<option value="new"' + ((e.combine || m.combineDefault) === 'new' ? ' selected' : '') +
      '>Build a new form for this month</option>' +
      (review.forms || []).map(function (f) {
        var chosen = (e.combine || m.combineDefault || m.primaryFormId) === f.formId;
        return '<option value="' + esc(f.formId) + '"' + (chosen ? ' selected' : '') + '>' +
          esc(f.label) + '</option>';
      }).join('') + '</select></label>');

    // MOVING ONE DATE somewhere else, which is the thing "combine" cannot say:
    // a session that belongs on another program's form entirely.
    var movable = m.sessions.filter(function (s) { return !s.past && s.onSheet; });
    var moveRow = movable.length
      ? '<label>Move one date instead: <select id="move-date">' +
        '<option value="">— no move —</option>' +
        movable.map(function (s) {
          var chosen = (plan.__moves || {})[s.eventId];
          return '<option value="' + esc(s.eventId) + '"' + (chosen ? ' selected' : '') + '>' +
            esc(s.dateLabel) + '</option>';
        }).join('') + '</select> onto <input type="text" id="move-form" placeholder="form ID or edit URL" ' +
        'value=""></label>'
      : '';

    card.innerHTML =
      '<div class="month">' + esc(m.title) + ' — ' + esc(m.monthLabel) + '</div>' +
      '<div class="where">' + esc(m.locationLabel || '') + ' · ' + m.totals.upcoming +
      ' upcoming date(s) · ' + m.totals.slots + ' appointment(s), ' + m.totals.free + ' free · ' +
      m.slotMinutes + '-minute slots · ' + (m.formIds.length || 0) + ' form(s)</div>' +
      '<ul class="checks">' + checks + '</ul>' +
      '<table><tr><th>Date</th><th>Time on the sheet</th><th>Slots</th><th>Booked</th><th>Free</th>' +
      '<th>Form</th><th></th></tr>' + rows + '</table>' +
      '<div class="fixes">' + fixes.join('') + moveRow + '</div>';

    wire(m);
    say((at + 1) + ' of ' + review.months.length + ' · ' + countPlanned() + ' change(s) queued');
  }

  function box(key, checked, label) {
    return '<label><input type="checkbox" id="fx-' + key + '"' + (checked ? ' checked' : '') + '> ' +
      label + '</label>';
  }

  function wire(m) {
    ['merge', 'retime', 'tidy'].forEach(function (key) {
      var el = document.getElementById('fx-' + key);
      if (!el) return;
      el.onchange = function () {
        var e = entry(m.id);
        if (el.checked) e[key] = true; else delete e[key];
        say((at + 1) + ' of ' + review.months.length + ' · ' + countPlanned() + ' change(s) queued');
      };
    });
    var slots = document.getElementById('fx-slots');
    var len = document.getElementById('slot-len');
    var setSlots = function () {
      var e = entry(m.id);
      if (slots.checked) e.slots = parseInt(len.value, 10); else delete e.slots;
      say((at + 1) + ' of ' + review.months.length + ' · ' + countPlanned() + ' change(s) queued');
    };
    slots.onchange = setSlots;
    len.onchange = setSlots;

    var combine = document.getElementById('fx-combine');
    var target = document.getElementById('combine-form');
    var setCombine = function () {
      var e = entry(m.id);
      if (combine.checked) e.combine = target.value; else delete e.combine;
      say((at + 1) + ' of ' + review.months.length + ' · ' + countPlanned() + ' change(s) queued');
    };
    combine.onchange = setCombine;
    target.onchange = setCombine;

    var moveDate = document.getElementById('move-date');
    var moveForm = document.getElementById('move-form');
    if (moveDate && moveForm) {
      var setMove = function () {
        if (!plan.__moves) plan.__moves = {};
        Object.keys(plan.__moves).forEach(function (id) {
          if (m.sessions.some(function (s) { return s.eventId === id; })) delete plan.__moves[id];
        });
        if (moveDate.value && moveForm.value.trim()) plan.__moves[moveDate.value] = moveForm.value.trim();
        say((at + 1) + ' of ' + review.months.length + ' · ' + countPlanned() + ' change(s) queued');
      };
      moveDate.onchange = setMove;
      moveForm.onchange = setMove;
    }
  }

  function countPlanned() {
    var n = 0;
    Object.keys(plan).forEach(function (id) {
      if (id === '__moves') return;
      var e = plan[id];
      ['merge', 'retime', 'tidy', 'slots', 'combine'].forEach(function (k) { if (e[k]) n++; });
    });
    n += Object.keys(plan.__moves || {}).length;
    return n;
  }

  function buildPayload() {
    var entries = [];
    Object.keys(plan).forEach(function (id) {
      if (id === '__moves') return;
      var e = plan[id];
      if (['merge', 'retime', 'tidy', 'slots', 'combine'].some(function (k) { return e[k]; })) entries.push(e);
    });
    var moves = Object.keys(plan.__moves || {}).map(function (eventId) {
      return { eventId: eventId, formRef: plan.__moves[eventId] };
    });
    return { entries: entries, moves: moves, sync: entries.length === 0 && moves.length === 0 };
  }

  document.getElementById('prev').onclick = function () { at--; draw(); };
  document.getElementById('next').onclick = function () { at++; draw(); };
  document.getElementById('apply').onclick = function () {
    setButtons(true);
    say('Working — this reads the calendars and rebuilds the forms, so it can take a minute…');
    call('assistanceReviewApply', function (raw) {
      var res = JSON.parse(raw);
      if (res.review) { review = res.review; plan = {}; at = 0; }
      draw();
      setButtons(false);
      say(res.message, res.ok ? 'good' : 'bad');
    }, JSON.stringify(buildPayload()));
  };

  function call(fn, done, arg) {
    var runner = google.script.run
      .withSuccessHandler(function (r) { done(r); })
      .withFailureHandler(function (err) {
        setButtons(false);
        say('⚠️ ' + (err && err.message ? err.message : err), 'bad');
      });
    if (arg === undefined) runner[fn](); else runner[fn](arg);
  }

  function setButtons(disabled) {
    ['prev', 'next', 'apply'].forEach(function (id) {
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
</script></body></html>`;
}


