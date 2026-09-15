// ============================================================================
// 95. A RECURRENCE THAT ENDS IS A SERIES  (see resolveEventSettings, 20)
// ============================================================================
//
// "One form for the whole run" has always been sayable — [Grouped] typed into
// an event's description — and almost never said. The eight-week Memoir
// Writing course goes on the calendar the way every course goes on a calendar:
// one event, repeat weekly, ENDS AFTER 8 OCCURRENCES. Nobody thinks of that as
// a tagging decision, because in the calendar it is already a complete
// statement about what the program is.
//
// This system then read it as eight ordinary dates and, because the run
// crossed a month boundary, built TWO forms for it: weeks one to three on
// September's, four to eight on October's. Two links for one course, a roster
// split down the middle, and a member who signed up in September opening a
// form in October that had never heard of them. The fix staff had was to
// notice, and to type a word into a description.
//
// SO THE RECURRENCE IS READ INSTEAD. An event that repeats and ENDS — "after
// N times", or on a date — is a run with a length, and a run with a length is
// what [Grouped] means. Up to getGroupSeriesUpTo() occurrences (12 by default,
// 0 to turn this off) that is what it is read as.
//
// WHY THERE IS A CEILING AT ALL. A bounded recurrence is not always a course.
// A standing Tuesday class entered as "every week until December 31st" is 52
// occurrences of an ordinary program, and one form for all of it would be a
// year of dates on one page, a capacity that means nothing, and a link that
// outlives the room. Twelve is the line between "a course somebody enrolls in"
// and "a class that is simply on", and it is a Config cell because that line
// is a centre's to draw.
//
// WHAT ALWAYS WINS. A [Grouped] or [Regular] typed into the description, and
// the dashboard's own Type_Tag dropdown, which writes exactly that (see
// stampTypeTagOnCalendar in 18). This is a fallback for events that say
// nothing about grouping, which is nearly all of them — never an override.
// A staff answer, once given, is the answer.
//
// AND IT IS WRITTEN DOWN. A program recognized this way has [Grouped] stamped
// into its events' descriptions ONCE (stampDetectedSeriesGrouping), for three
// reasons: staff can see why their program is grouped and change it in the
// place they change everything else; a recurrence later extended to run
// forever does not silently re-split the program mid-run; and the stamp is
// what makes the answer survive this file being switched off. The ledger is
// what makes "once" true — an event stamped and then untagged by hand is not
// stamped again, because deleting the bracket is also an answer.
//
// WHAT IT COSTS. One Calendar.Events.get() per recurring SERIES per execution
// (memoized below), and nothing at all for the single events that are most of
// a calendar. CalendarApp cannot answer this — isRecurringEvent() is the whole
// of what it exposes about repetition — so the advanced Calendar service, which
// this project already enables and uses for its sync tokens (19), is what reads
// the rule.
// ============================================================================

/**
 * The default ceiling, and the number seeded into Config.
 *
 * Twelve because it covers the shapes a course actually takes — six weeks,
 * eight weeks, a term of ten, twelve of anything — while a program that runs
 * every week of the year does not reach it however it was typed.
 */
const DEFAULT_GROUP_SERIES_UP_TO = 12;

/**
 * The shortest run that is read as a series.
 *
 * Two, not one: a recurrence of a single occurrence is a one-off somebody made
 * with the repeat box open, and grouping it changes nothing anyway (one date
 * is one form either way). Two dates that straddle a month boundary is the
 * smallest case where this decides something real.
 */
const RECURRING_SERIES_MIN_OCCURRENCES = 2;

/**
 * How far the occurrence counter will walk before giving up.
 *
 * An UNTIL rule has to be COUNTED, one occurrence at a time, and "every day
 * until 2099" is a rule that would count forever. The walk stops at this many
 * and answers "more than this", which is all any caller needs: everything past
 * the ceiling is the same answer. Comfortably above any ceiling somebody would
 * type into Config, so raising that number does not need this one raised too —
 * and if it ever is, countRecurrenceOccurrences() says so rather than lying.
 */
const RECURRING_SERIES_COUNT_LIMIT = 400;

/** Script Properties key for the series this system has already stamped. */
const AUTO_GROUPED_SERIES_PROP_KEY = 'AUTO_GROUPED_SERIES_V1';

/**
 * How many series ids the ledger remembers, oldest dropped first.
 *
 * A Script Property caps at 9KB and an id is about thirty bytes, so this is
 * well inside it. Forgetting the oldest entry is safe by construction: the
 * only thing a forgotten id costs is a second look at an event whose
 * description, by then, already says [Grouped] — and an event that already
 * says so is never stamped again.
 */
const AUTO_GROUPED_SERIES_LEDGER_MAX = 200;

/** seriesId -> { seriesId, occurrences } for this execution. */
let __seriesRecurrenceMemo = {};

/** Called by anything that has reason to believe a recurrence rule changed. */
function invalidateSeriesRecurrenceMemo() {
  __seriesRecurrenceMemo = {};
}

/**
 * IS THIS EVENT PART OF A SERIES SHORT ENOUGH TO PUT ON ONE FORM?
 *
 * The whole of what resolveEventSettings() asks. Answers false for everything
 * it cannot be sure about — a single event, an endless recurrence, a rule it
 * cannot parse, a calendar it cannot read — because false is [Regular], which
 * is what every program in this workbook was before this file existed and is
 * the narrower grouping of the two. A wrong "no" costs the monthly forms staff
 * already have; a wrong "yes" merges a year onto one page.
 */
function isDetectedGroupedSeries(event, calendarId) {
  const max = getGroupSeriesUpTo();
  if (!max || max < RECURRING_SERIES_MIN_OCCURRENCES) return false;
  const info = readSeriesRecurrence(event, calendarId);
  if (!info || !info.occurrences) return false;
  return info.occurrences >= RECURRING_SERIES_MIN_OCCURRENCES && info.occurrences <= max;
}

/**
 * The calendar an event was read from, asked of the event itself.
 *
 * resolveEventSettings() is handed an event and nothing else, from six call
 * sites, and the advanced Calendar service needs a calendar id to ask about
 * one. CalendarEvent knows — it is the calendar the event ORIGINATES on, which
 * for everything this system reads is the program calendar it came off.
 */
function calendarIdOfEvent(event, calendarId) {
  if (calendarId) return String(calendarId);
  try {
    if (event && typeof event.getOriginalCalendarId === 'function') {
      return String(event.getOriginalCalendarId() || '');
    }
  } catch (err) {
    // No calendar authorization in this context — see getCalendarEventsForWindow().
  }
  return '';
}

/**
 * { seriesId, occurrences } for the series this event belongs to, or null when
 * it does not belong to one.
 *
 * `occurrences` is null for a recurrence that never ends or that this file
 * cannot count, a number otherwise, and RECURRING_SERIES_COUNT_LIMIT + 1 for
 * one that is simply too long to bother counting.
 *
 * MEMOIZED PER EXECUTION AND PER SERIES, not per event: a weekly course inside
 * the sync window is a dozen events asking one question about one rule, and
 * the answer is a remote call. A rule does not change under a run — and the
 * one thing that would, somebody editing the series mid-sync, is not something
 * a cheaper cache would catch either.
 */
function readSeriesRecurrence(event, calendarId) {
  if (!event || typeof event.isRecurringEvent !== 'function') return null;
  let seriesId = '';
  try {
    if (!event.isRecurringEvent()) return null;
    seriesId = seriesIdFromInstanceId(event.getId());
    // FROM THE ID FIRST, and getEventSeries() only when that gets nowhere.
    // An instance's id IS its series' id with the occurrence stamped on the
    // end — "abc123_20260915T140000Z@google.com" — so the common case costs
    // nothing, where getEventSeries() is a remote call per EVENT and a sync
    // window holds a dozen events for every series in it.
    if (!seriesId) {
      const series = event.getEventSeries();
      if (!series || typeof series.getId !== 'function') return null;
      seriesId = String(series.getId() || '').split('@')[0].trim();
    }
  } catch (err) {
    return null;
  }
  if (!seriesId) return null;
  if (Object.prototype.hasOwnProperty.call(__seriesRecurrenceMemo, seriesId)) {
    return __seriesRecurrenceMemo[seriesId];
  }

  let answer = { seriesId, occurrences: null };
  const id = calendarIdOfEvent(event, calendarId);
  if (id) {
    try {
      const master = readSeriesMaster(id, seriesId, event);
      answer = {
        seriesId,
        occurrences: countRecurrenceOccurrences(
          master && master.recurrence, recurrenceStartDate(master), RECURRING_SERIES_COUNT_LIMIT)
      };
    } catch (err) {
      // A series whose master cannot be read is one this file has no opinion
      // about. Logged once per series per run, because it is memoized below.
      log(`ℹ️ Could not read the repeat rule of series ${seriesId} on ${id} (${err}) — ` +
        `it is treated as an ordinary program.`);
    }
  }
  __seriesRecurrenceMemo[seriesId] = answer;
  return answer;
}

/**
 * "abc123_20260915T140000Z@google.com" -> "abc123": the series an instance
 * belongs to, read off the instance's own id.
 *
 * Returns '' when the id carries no occurrence stamp — an id this shape rule
 * does not recognize is one to ask the Calendar service about properly, not one
 * to guess at. An all-day series stamps a bare date, hence the optional time.
 */
function seriesIdFromInstanceId(eventId) {
  const raw = String(eventId || '').split('@')[0].trim();
  const stripped = raw.replace(/_\d{8}(T\d{6}Z)?$/, '');
  return stripped && stripped !== raw ? stripped : '';
}

/**
 * THE SERIES MASTER, BY EVENT ID FIRST AND BY iCalUID SECOND.
 *
 * CalendarEvent.getId() returns the event's iCalUID, and for an event Google
 * Calendar created itself that is the API's event id with "@google.com" on the
 * end — which is why stripping the domain (seriesIdFromInstanceId) is the
 * cheap path and is right nearly always.
 *
 * It is NOT right for an event that arrived from somewhere else: an .ics
 * import, or a calendar subscribed from another system. Those keep the
 * ORIGINATING system's UID ("Icalb3401b2a7dca972b08ee5bc0ada56c3b") while the
 * API files them under an id of its own, so Events.get() on the UID is a 404 —
 * which this file then read as "a rule I cannot understand" and logged, once
 * per series, on every sync, about a program that may well be a bounded run
 * worth grouping.
 *
 * So the 404 is answered the documented way: list the calendar by iCalUID with
 * singleEvents off, which hands back the MASTER — recurrence and all — in one
 * call, so nothing further is needed. Only the fallback costs a second round
 * trip, and only for the imported events that need it; readSeriesRecurrence()
 * memoizes the answer per series per execution either way.
 *
 * Throws when neither lookup finds a master, so the caller's log still fires
 * for a series that genuinely cannot be read.
 */
function readSeriesMaster(calendarId, seriesId, event) {
  try {
    return Calendar.Events.get(calendarId, seriesId);
  } catch (err) {
    const uid = seriesUidOfEvent(event, seriesId);
    if (!uid) throw err;
    const found = Calendar.Events.list(calendarId, {
      iCalUID: uid,
      singleEvents: false,
      showDeleted: false,
      maxResults: 2
    });
    const items = (found && found.items) || [];
    // The master is the item carrying the rule; an instance carries
    // recurringEventId instead, and is the shape to ask about again by id.
    const master = items.filter(it => it && it.recurrence)[0];
    if (master) return master;
    const instance = items.filter(it => it && it.recurringEventId)[0];
    if (instance) return Calendar.Events.get(calendarId, instance.recurringEventId);
    throw err;
  }
}

/**
 * The iCalUID to look an imported series up by: what the event itself reports,
 * with the series id as the fallback for a stub with no getId().
 */
function seriesUidOfEvent(event, seriesId) {
  try {
    if (event && typeof event.getId === 'function') {
      const raw = String(event.getId() || '').trim();
      // An instance's UID carries the occurrence stamp; the series' does not.
      if (raw) return raw.replace(/_\d{8}(T\d{6}Z)?(?=@|$)/, '');
    }
  } catch (err) {
    // Nothing to add: the seriesId below is the only other thing to try.
  }
  return seriesId ? String(seriesId) : '';
}

/** DTSTART of a series master, from the advanced service's event resource. */
function recurrenceStartDate(master) {
  const start = master && master.start;
  if (!start) return null;
  const raw = start.dateTime || start.date || '';
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * HOW LONG THIS RUN IS, from its RRULE — a number, or null for "no end" and
 * for anything this cannot read.
 *
 * COUNT is the answer written down; UNTIL has to be walked. The walk is
 * deliberately approximate in one direction only:
 *
 *   • EXDATE is IGNORED. A cancelled occurrence makes a run SHORTER, so
 *     ignoring it can only overcount — which can only refuse to group a
 *     program that would have qualified. That is the safe direction.
 *   • A MONTHLY or YEARLY rule is stepped from the start date rather than
 *     resolved through BYDAY ("the second Tuesday"), so a count can be out by
 *     one at the boundary. A monthly program that runs long enough for that to
 *     matter is over the ceiling either way.
 *   • Anything with more than one RRULE, or with RDATEs of its own, returns
 *     null. Those are shapes this file cannot claim to understand, and the
 *     answer to a rule it does not understand is the one staff already have.
 */
function countRecurrenceOccurrences(recurrence, start, limit) {
  const lines = (recurrence || []).map(line => String(line || '').trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const rules = lines.filter(line => /^RRULE[:;]/i.test(line));
  // An RDATE adds dates the rule does not describe; a second RRULE is a shape
  // Google's own UI cannot make. Either way, not ours to count.
  if (rules.length !== 1) return null;
  if (lines.some(line => /^RDATE[:;]/i.test(line))) return null;

  const parts = {};
  rules[0].replace(/^RRULE[:;]/i, '').split(';').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq > 0) parts[pair.substring(0, eq).trim().toUpperCase()] = pair.substring(eq + 1).trim();
  });

  const count = Number(parts.COUNT);
  if (parts.COUNT && !isNaN(count) && count > 0) return Math.min(count, limit + 1);
  if (!parts.UNTIL) return null; // repeats forever — every standing program

  const until = parseRecurrenceUntil(parts.UNTIL);
  if (!until || !start) return null;
  return walkRecurrenceUntil(parts, start, until, limit);
}

/**
 * "20261231" or "20261231T045959Z" -> a Date, else null.
 *
 * THE TRAILING Z IS NOT DECORATION. Google writes an UNTIL in UTC, and the
 * ordinary way to write "ends on the 27th" in New York is 03:59 on the 28th,
 * UTC. Reading that as a local time puts the bound four hours late — which on
 * a rule whose last occurrence is a morning class is one occurrence too many,
 * and at the ceiling is the difference between a course and a standing class.
 * A date with no time at all is a whole day, so it ends when the day does.
 */
function parseRecurrenceUntil(value) {
  const m = String(value || '').trim()
    .match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const d = m[7] === 'Z'
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6])))
    : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 23), Number(m[5] || 59), Number(m[6] || 59));
  return isNaN(d.getTime()) ? null : d;
}

/** Weekday letters as an RRULE writes them, in the order a week runs. */
const RECURRENCE_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Counts the occurrences of an UNTIL rule by walking it, stopping at `limit`.
 *
 * Returns limit + 1 for a run that is still going when the walk stops, which
 * every caller reads as "longer than any ceiling" — see
 * RECURRING_SERIES_COUNT_LIMIT.
 */
function walkRecurrenceUntil(parts, start, until, limit) {
  const freq = String(parts.FREQ || '').toUpperCase();
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const byDay = String(parts.BYDAY || '').split(',')
    .map(d => d.trim().toUpperCase().replace(/^[-+]?\d+/, ''))
    .filter(d => RECURRENCE_WEEKDAYS.indexOf(d) >= 0);

  let n = 0;
  if (freq === 'WEEKLY' && byDay.length > 0) {
    // The week the series starts in, from its Sunday, so the BYDAY list is
    // walked in calendar order rather than from whichever day DTSTART fell on.
    const weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay());
    for (let week = 0; n <= limit; week += interval) {
      let anyInRange = false;
      for (let i = 0; i < byDay.length; i++) {
        const d = new Date(weekStart.getFullYear(), weekStart.getMonth(),
          weekStart.getDate() + week * 7 + RECURRENCE_WEEKDAYS.indexOf(byDay[i]),
          start.getHours(), start.getMinutes(), 0);
        if (d < start) continue;
        if (d > until) return n;
        anyInRange = true;
        n++;
        if (n > limit) return limit + 1;
      }
      // A whole interval-week past UNTIL with nothing in it: the rule is done.
      if (!anyInRange && new Date(weekStart.getFullYear(), weekStart.getMonth(),
        weekStart.getDate() + week * 7) > until) return n;
    }
    return limit + 1;
  }

  const step = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq];
  if (!step) return null;
  for (let i = 0; ; i++) {
    const d = new Date(start.getTime());
    if (step === 'day') d.setDate(start.getDate() + i * interval);
    else if (step === 'week') d.setDate(start.getDate() + i * interval * 7);
    else if (step === 'month') d.setMonth(start.getMonth() + i * interval);
    else d.setFullYear(start.getFullYear() + i * interval);
    if (d > until) return n;
    n++;
    if (n > limit) return limit + 1;
  }
}

// ---------------------------------------------------------------------------
// WRITING IT DOWN
// ---------------------------------------------------------------------------

/**
 * Stamps [Grouped] into the description of every event of every group this run
 * grouped by RECOGNITION rather than by a tag, once per series, and remembers
 * that it did.
 *
 * WHY WRITE AT ALL, when the recognition is re-derived every sync. Three
 * things a derived answer cannot do: it cannot be SEEN — a program grouped for
 * a reason nothing on the calendar states is a program nobody can explain; it
 * cannot be ARGUED WITH in the place staff already argue with everything else,
 * the description and the Type_Tag dropdown that writes it; and it cannot
 * SURVIVE — a recurrence extended in January to run all year would, silently
 * and mid-run, split a course back onto monthly forms and strand its roster.
 * The bracket is what makes the decision a fact about the program instead of a
 * fact about this file.
 *
 * ONCE, AND THE LEDGER IS WHY. Deleting the bracket is an answer too — the
 * event says nothing, so nothing is what it means — and a stamp that came back
 * every hour would be this system arguing with somebody about their own
 * calendar. A description that already states grouping is never touched at
 * all, in either direction.
 *
 * Every write here is a notification to everybody the event is shared with,
 * which is the rule setFlagBracketInDescription() and stampTypeTagOnCalendar()
 * both follow: nothing is written that does not change what the description
 * says.
 */
function stampDetectedSeriesGrouping(groups) {
  const ledger = readAutoGroupedSeriesLedger();
  const stampedNow = [];
  let writes = 0;

  (groups || []).forEach(group => {
    if (!group || !group.isFixed) return;
    (group.sessions || []).forEach(session => {
      const event = session.event;
      if (!event || typeof event.getDescription !== 'function') return;
      const existing = event.getDescription() || '';
      // Said out loud already, either way: not ours to restate or to contradict.
      if (parseSettingsBrackets(existing).explicitGrouping) return;

      const info = readSeriesRecurrence(event, session.calendarId);
      if (!info || !isDetectedGroupedSeries(event, session.calendarId)) return;
      if (ledger.has(info.seriesId) || stampedNow.indexOf(info.seriesId) >= 0) return;

      const updated = setGroupingBracketInDescription(existing, EVENT_TYPES.GROUPED);
      if (updated === existing) return;
      try {
        event.setDescription(updated);
      } catch (err) {
        log(`⚠️ Could not write [${EVENT_TYPES.GROUPED}] onto "${group.cleanTitle}" (${err}).`);
        return;
      }
      writes++;
      stampedNow.push(info.seriesId);
      log(`Recognized "${group.cleanTitle}" as a ${info.occurrences}-session series and wrote ` +
        `[${EVENT_TYPES.GROUPED}] into its calendar description — it now takes one form for the whole run. ` +
        `Change it there, or with the Type_Tag column, to put it back on monthly forms.`);
      noteForAdmin('Short series recognized',
        `"${group.cleanTitle}" (${describeLocations(group.locations)}) repeats ${info.occurrences} times and ` +
        `then ends, so it has been marked [${EVENT_TYPES.GROUPED}]: one registration form for the whole run ` +
        `instead of a new one each month. The tag is now in the calendar event's description — change it ` +
        `there, or in the Type_Tag column on the session table, if that is not what this program is.`);
    });
  });

  if (writes > 0) {
    rememberAutoGroupedSeries(ledger, stampedNow);
    // The descriptions just changed under the cached events.
    invalidateCalendarEventsCache();
  }
  return writes;
}

/** The series already stamped, as a Set. */
function readAutoGroupedSeriesLedger() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(AUTO_GROUPED_SERIES_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    log(`ℹ️ Could not read the recognized-series ledger (${err}) — treating it as empty.`);
    return new Set();
  }
}

/** Adds these ids to the ledger, oldest dropped first past the cap. */
function rememberAutoGroupedSeries(ledger, ids) {
  const kept = Array.from(ledger).concat(ids || []);
  const trimmed = kept.slice(Math.max(0, kept.length - AUTO_GROUPED_SERIES_LEDGER_MAX));
  try {
    PropertiesService.getScriptProperties()
      .setProperty(AUTO_GROUPED_SERIES_PROP_KEY, JSON.stringify(trimmed));
  } catch (err) {
    log(`⚠️ Could not record which series have been marked [${EVENT_TYPES.GROUPED}] (${err}).`);
  }
}

// ---------------------------------------------------------------------------
// ADOPTION: the program that already has one form per month
// ---------------------------------------------------------------------------

/**
 * WHICH FORM A NEWLY GROUPED PROGRAM KEEPS.
 *
 * The same question chooseAdoptedAssistanceForms() answers for appointment
 * programs, and the same answer: the form the program's NEXT session is on,
 * because that is the link in circulation right now — the one printed, emailed
 * and handed over. A program with nothing upcoming falls back to its most
 * recent past date's form, the last one anybody used.
 *
 * Without this, a program recognized as a series presents to
 * processCalendarGroup() as a group whose ::FIXED key the registry has never
 * heard of — and a group with no form gets a NEW one. A brand-new link, on a
 * course three weeks in, with every sign-up so far on a form the dashboard no
 * longer names. Candidates are read off the session rows because the rows are
 * where the truth about "which form is this program actually on" lives.
 *
 * `state` is getExistingRegistryState()'s. Returns a Form_ID or ''.
 */
function chooseFormForGroupedProgram(state, group) {
  if (!group) return '';
  const rows = groupedProgramFormCandidates(state, group);
  if (rows.length === 0) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = rows.filter(c => c.date && c.date >= today).sort((a, b) => a.date - b.date);
  const past = rows.filter(c => c.date && c.date < today).sort((a, b) => b.date - a.date);
  return (upcoming[0] || past[0] || rows[0]).formId;
}

/**
 * Every form this program's rows currently name, with the date of the row that
 * names it.
 *
 * Gathered per CALENDAR, and unioned across all of a shared group's calendars:
 * a group scoped SHARED_LOCATION_SCOPE has no single calendar of its own, and
 * its rows carry the one they came from. The line not crossed is the same one
 * adoptAssistanceProgramSessions() refuses to cross — two locations running an
 * unlinked program of the same name are two programs, so a group takes only
 * the calendars it actually covers.
 */
function groupedProgramFormCandidates(state, group) {
  const byProgram = (state && state.programFormCandidates) || {};
  const calendars = (group.calendarIds && group.calendarIds.length > 0)
    ? group.calendarIds
    : [group.calendarId || group.scope];
  const out = [];
  calendars.filter(Boolean).forEach(calendarId => {
    (byProgram[`${calendarId}|${group.cleanTitle}`] || []).forEach(c => out.push(c));
  });
  return out;
}

/**
 * Is this group's program still spread across the monthly forms it had before
 * it was recognized as a series?
 *
 * What gives collectCalendarWork() a reason to process a group with no new
 * dates. A course recognized in week four has every one of its dates on the
 * sheet already, so without this the adoption would wait for a new date that,
 * a series being a series, is never coming.
 *
 * BOTH HALVES ARE REQUIRED, and the second is what keeps this from undoing
 * somebody's work: rows on more than one form, AND at least one upcoming row
 * still saying it belongs to a Regular program. A long-standing [Grouped]
 * series with one date deliberately moved onto another form (the Move Sessions
 * dialog, 47) satisfies the first and not the second — and pulling that date
 * back would be this system overruling a staff decision every hour, forever.
 */
function groupedProgramNeedsAdoption(state, group) {
  if (!state || !group || !group.isFixed) return false;
  const chosen = (state.groupFormMap || {})[group.groupKey] || chooseFormForGroupedProgram(state, group);
  if (!chosen) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = groupedProgramFormCandidates(state, group).filter(c => c.date && c.date >= today);
  if (!upcoming.some(c => c.formId && c.formId !== chosen)) return false;
  return upcoming.some(c => !c.grouped);
}

/**
 * Brings a newly recognized series' UPCOMING rows onto the one form it now
 * books through, and says so where Type_Tag is read.
 *
 * The shape adoptAssistanceProgramSessions() established, for the same reason
 * and with the same two refusals: PAST ROWS ARE LEFT ALONE (a past row's
 * Form_ID is the record of where that registration came from, and rewriting it
 * would file September's sign-ups under a form they were never submitted to),
 * and the superseded forms are neither deleted nor hidden — they open, they
 * hold their responses, and a link handed out for one still works. It simply
 * stops being the form this program's rows name.
 *
 * TYPE_TAG IS WRITTEN ON THE SAME ROWS, and only those. formSpanForRow() reads
 * it to work out which form a row belongs to, so a row still saying "Regular"
 * under a program that is now one form would key itself back to its month —
 * which is how updateRegistrationLinkCells() and the link doctor would come to
 * restore last month's link onto a row this pass just repointed. Past rows keep
 * the tag they were written with, for the same reason they keep their Form_ID.
 *
 * Returns the number of rows repointed.
 */
function adoptGroupedProgramSessions(registrySheet, group, formInfo, existingState) {
  if (!group || !group.isFixed || !formInfo || !formInfo.formId) return 0;
  // The TAG is written on every upcoming row of a grouped program, always: a
  // row saying Regular under a program that is one form keys itself back to
  // its own month, and that is how a link this pass just repointed comes to be
  // restored to last month's form by the next one. The MOVE is gated, because
  // it is the half that can undo somebody's deliberate repoint — see
  // groupedProgramNeedsAdoption().
  const mayMove = !existingState || groupedProgramNeedsAdoption(existingState, group);
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;

  const titleKey = normalizeNameKey(group.cleanTitle);
  const sources = new Set((group.calendarIds || []).filter(Boolean));
  const todayKey = formatDateKey(new Date());
  const wanted = new Set();
  const retagged = new Set();
  const supersededForms = {};

  rows.forEach(row => {
    if (normalizeNameKey(String(row[map['Clean_Title']] || '')) !== titleKey) return;
    const source = String(row[map['Calendar_Source']] || '').trim();
    if (sources.size > 0 && !sources.has(source)) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date || formatDateKey(date) < todayKey) return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return;
    if (!isGroupedTypeTag(row[map['Type_Tag']])) retagged.add(eventId);
    if (!mayMove) return;
    const rowFormId = String(row[map['Form_ID']] || '').trim();
    if (!rowFormId || rowFormId === formInfo.formId) return;
    wanted.add(eventId);
    supersededForms[rowFormId] = (supersededForms[rowFormId] || 0) + 1;
  });

  const tagged = writeTypeTagOntoSessions(registrySheet, retagged, EVENT_TYPES.GROUPED);
  if (wanted.size === 0) {
    if (tagged > 0) SpreadsheetApp.flush();
    return 0;
  }

  const moved = writeFormIdOntoSessions(registrySheet, wanted, formInfo.formId);
  if (moved === 0) return 0;
  SpreadsheetApp.flush();

  const formList = Object.keys(supersededForms)
    .map(id => `${describeFormLink(id)} (${supersededForms[id]} date(s))`).join(', ');
  log(`Series "${group.cleanTitle}": moved ${moved} upcoming date(s) onto ${describeFormLink(formInfo.formId)} — ` +
    `one form now covers the whole run. Superseded: ${formList}.`);
  noteForAdmin('Short series moved onto one form',
    `"${group.cleanTitle}" (${describeLocations(group.locations)}) runs as a series and used to take a ` +
    `separate form each month. Its ${moved} upcoming date(s) now point at ${describeFormLink(formInfo.formId)}, ` +
    `and the registration link on its calendar events says the same. The month forms it replaces still open ` +
    `and still hold every response already made on them — nothing was deleted — but they are no longer the ` +
    `form this program books through: ${formList}.`);
  return moved;
}

/**
 * Writes one Type_Tag onto the session rows named by these Event_IDs.
 *
 * writeFormIdOntoSessions()' sibling (47), deliberately kept beside its caller
 * rather than added to that file: the Move Sessions dialog moves a date to
 * another form and says nothing about how the program is grouped, and the one
 * path that needs to say both is this one.
 */
function writeTypeTagOntoSessions(registrySheet, eventIds, typeTag) {
  if (!eventIds || eventIds.size === 0) return 0;
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  if (!sheetMap['Event_ID'] || !sheetMap['Type_Tag'] || !sheetMap['Event_Date']) return 0;

  let changed = 0;
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;
    const ids = registrySheet.getRange(zone.start, sheetMap['Event_ID'], zone.count, 1).getValues();
    const tags = registrySheet.getRange(zone.start, sheetMap['Type_Tag'], zone.count, 1).getValues();
    let dirty = false;
    for (let r = 0; r < zone.count; r++) {
      if (!eventIds.has(String(ids[r][0] || '').trim())) continue;
      if (String(tags[r][0] || '').trim() === typeTag) continue;
      tags[r][0] = typeTag;
      dirty = true;
      changed++;
    }
    if (dirty) {
      registrySheet.getRange(zone.start, sheetMap['Type_Tag'], zone.count, 1).setValues(tags);
      invalidateSectionedRowsCache(registrySheet);
    }
  });
  return changed;
}
