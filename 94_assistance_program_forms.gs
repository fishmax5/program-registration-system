// ============================================================================
// 94. APPOINTMENT PROGRAMS TAKE ONE ROLLING FORM  (see buildEventGroups)
// ============================================================================
//
// A [Personalized Assistance] program is not a month of a program. It is a
// standing arrangement — Heather is here for wills on the second Tuesday, and
// has been since March — and what a member wants from it is a time, not a
// month. Every other program in this workbook is grouped per calendar month
// (the `span` half of the group key), and until now appointment programs went
// through that same mill: twelve forms a year for one program, twelve links,
// and a member who booked in September opening a form in October that no
// longer had a single free slot on it because it was never about October.
//
// SO THEY ARE GROUPED BY PROGRAM INSTEAD. Every session of one appointment
// program, whatever month it falls in, lands on ONE form — key
// `<scope>::<title>::ASSIST` — and that form carries a ROLLING WINDOW of
// dates: this month and the ASSISTANCE_FORM_MONTHS - 1 after it, and nothing
// else. As a month turns, its dates drop off the form and a new month's
// appear, without anybody pressing anything.
//
// WHY A WINDOW AT ALL, when a [Grouped] series happily carries its whole run:
// a series ends. An appointment program does not, so an unbounded form would
// grow a list of every appointment date since it was built — a time question
// hundreds of choices long, most of them in the past. Three months is the
// bound. It is also as far ahead as anybody at the desk is willing to promise
// somebody a chair.
//
// THE WINDOW IS ENFORCED IN TWO PLACES AND THEY HAVE TO AGREE:
//
//   • buildEventGroups() (24), which trims the CALENDAR-derived sessions a
//     group takes to its form, and
//   • buildFormSessionContext() (09), which trims the ROW-derived sessions
//     every "refresh a live form from the sheet" path reads.
//
// Both go through assistanceFormWindow(). They must, and that is not a tidiness
// argument: refreshFormShapeForAllForms() (31) rebuilds each form's labels from
// its session ROWS on every single sync, and refreshFormForNewDates() (26)
// rebuilds them from its calendar GROUP. Two different windows means each pass
// undoing the other's write, hourly, forever — one round trip and one new form
// revision every hour, on every appointment form in the workbook.
//
// WHAT IS NOT WINDOWED: the session ROWS themselves. A date outside the window
// is still on the dashboard, still countable, still has its registrants — this
// is a statement about what one FORM offers, not about what the workbook knows.
// ============================================================================

/**
 * The span half of an appointment program's group key.
 *
 * A PERSISTED INTERNAL KEY, like 'FIXED' beside it: it is written into the
 * Script Properties form registry, and renaming it would orphan every stored
 * entry and build a second form for every appointment program in the workbook.
 * The words a person reads are elsewhere.
 */
const ASSISTANCE_FORM_SPAN = 'ASSIST';

/** How many calendar months an appointment form covers, counting the current one. */
const ASSISTANCE_FORM_MONTHS = 3;

/**
 * The window one appointment form offers: the first of THIS month through the
 * last day of the month ASSISTANCE_FORM_MONTHS - 1 after it.
 *
 * WHY IT STARTS AT THE FIRST OF THE MONTH rather than today. A form that drops
 * a date the morning after it happened is a form whose dates move under the
 * desk mid-month, and the sign-in sheet, the roster and the printed list would
 * all disagree with it for the rest of the day. Months are the unit staff think
 * in here, so the window moves in months too. (The time QUESTION on an
 * appointment form is stricter still and always has been —
 * buildAppointmentChoicesForContext() offers no slot in the past.)
 */
function assistanceFormWindow(now) {
  const today = now || new Date();
  return {
    start: new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0),
    // Day 0 of month N + MONTHS is the last day of month N + MONTHS - 1.
    end: new Date(today.getFullYear(), today.getMonth() + ASSISTANCE_FORM_MONTHS, 0, 23, 59, 59)
  };
}

/**
 * The window in words, for a log line and for the form's own description:
 * "September 2026 – November 2026".
 *
 * An appointment group has no monthLabel — that is the whole point of it — so
 * this is what describeGroup() says in the place a month used to go. Written
 * from the window rather than from the group's dates, deliberately: a program
 * with nothing booked in November still OFFERS November, and a span that shrank
 * whenever a month happened to be empty would read as the program having
 * stopped.
 */
function describeAssistanceFormWindow(now) {
  const window = assistanceFormWindow(now);
  return `${getMonthLabel(window.start)} – ${getMonthLabel(window.end)}`;
}

/** Is this date one an appointment form should be offering right now? */
function isWithinAssistanceFormWindow(date, now) {
  const d = coerceDate(date);
  if (!d) return false;
  const window = assistanceFormWindow(now);
  return d >= window.start && d <= window.end;
}

/**
 * Is this calendar GROUP one of the rolling appointment forms above?
 *
 * [Grouped] is deliberately still honoured over this: somebody who has said
 * "this is a series with an end" has said something the rolling window would
 * contradict, and a series carries its whole run on one form already.
 */
function isRollingAssistanceGroup(group) {
  return !!(group && group.isAssistance && !group.isFixed && !group.isLunchOnly);
}

/**
 * The same question asked of a FORM CONTEXT — buildFormSessionContext()'s
 * shape, derived from the session rows rather than from the calendar.
 *
 * Its `isAssistance` is SOME rather than every (see the comment there), which
 * is the right reading here too: one appointment session on a form is what
 * makes the form an appointment form.
 */
function isRollingAssistanceContext(context) {
  return !!(context && context.isAssistance && !context.isFixed && !context.isLunchOnly);
}

/**
 * Folds every month-group of one appointment program into a single group,
 * keyed `<scope>::<title>::ASSIST`.
 *
 * RUNS AFTER unifyProgramFlagsAcrossGroups(), and could not run before it. The
 * flag is the thing being grouped ON, and it is a property of the PROGRAM that
 * a single tagged event states for all of it — so a program whose September
 * event carries [Personalized Assistance] and whose November events do not is
 * one appointment program, and only after the flags are ORed across its month
 * groups does November's group know that about itself. Folding first would
 * leave November on a form of its own.
 *
 * Everything the month groups disagree about is merged the way
 * buildEventGroups() merges the events inside one group: a setting typed on any
 * one of them applies to the program, and nothing is ever turned back off.
 * Capacity is the one exception there ("[Cap: 12] is a fact about the room that
 * month") and cannot be one here — the months are now one form — so the first
 * capacity anybody typed stands for the program, and a second, different one is
 * said out loud rather than silently kept or silently dropped.
 *
 * Returns a new array; the surviving group objects are the first month's, so
 * every field not named below keeps the value it already had.
 */
function mergeAssistanceProgramGroups(groups) {
  const byProgram = {};
  const out = [];

  (groups || []).forEach(group => {
    if (!isRollingAssistanceGroup(group)) { out.push(group); return; }
    const key = `${group.scope}::${group.cleanTitle}::${ASSISTANCE_FORM_SPAN}`;
    const first = byProgram[key];
    if (!first) {
      group.groupKey = key;
      // The month is gone from the key, so it must go from everything a person
      // reads too — the form's title, the link line in the calendar event. See
      // buildFormTitleForGroup() and buildRegistrationLinkLine().
      group.monthLabel = null;
      group.sessions = group.sessions.slice();
      byProgram[key] = group;
      out.push(group);
      return;
    }

    first.sessions = first.sessions.concat(group.sessions);
    if (group.isClub) first.isClub = true;
    if (group.noRegistration) first.noRegistration = true;
    if (!first.slotMinutes && group.slotMinutes) first.slotMinutes = group.slotMinutes;
    if (!first.maxPerMonth && group.maxPerMonth) first.maxPerMonth = group.maxPerMonth;
    if (!first.capacity && group.capacity) {
      first.capacity = group.capacity;
    } else if (group.capacity && group.capacity !== first.capacity) {
      log(`ℹ️ "${group.cleanTitle}" is an appointment program, so all of its dates share one form — ` +
        `but its months carry different capacities ([Cap: ${first.capacity}] and [Cap: ${group.capacity}]). ` +
        `The form is built with ${first.capacity}; the per-date capacity on the session table is untouched.`);
    }
  });

  return out;
}

/**
 * Drops every session a group's FORM should not be offering.
 *
 * Two different bounds, because the two kinds of group answer to two different
 * horizons:
 *
 *   • a rolling appointment group is trimmed to assistanceFormWindow() — which
 *     is what takes last month's dates off the form when the month turns, and
 *     the only thing that does;
 *   • everything else is trimmed to `ordinaryEnd`, the horizon this sync has
 *     always had (SYNC_LOOKAHEAD_DAYS, rounded out to the end of its month).
 *     That bound is not new — it USED to be the end of the calendar read
 *     itself. computeSyncDateRange() now reads further when an appointment
 *     program needs it to, and without this trim that extra reach would quietly
 *     become a new horizon for every ordinary program in the workbook: a
 *     month's worth of session rows, and a month's worth of forms, appearing
 *     earlier than they ever have.
 *
 * A group left with no sessions at all is dropped: it has nothing to write, and
 * every path downstream would rather not be handed it.
 *
 * `options` — { ordinaryEnd, assistanceEnd, now }, all optional. The defaults
 * are the sync's own horizon and the rolling window, which is what every caller
 * but the weekend loader wants.
 */
function trimGroupsToFormWindows(groups, options) {
  const opts = options || {};
  const ordinaryEnd = opts.ordinaryEnd === undefined
    ? computeSyncDateRange().ordinaryEnd : opts.ordinaryEnd;
  // A caller reading a window it was ASKED for — the weekend loader's two date
  // boxes — passes its own end for both bounds: somebody who typed a date has
  // said they want that date loaded, and a horizon meant for an unattended
  // hourly pass is not an answer to that. The session still only becomes
  // BOOKABLE when its month reaches the rolling window; the row is on the
  // dashboard either way.
  const assistanceEnd = opts.assistanceEnd || null;
  const out = [];
  (groups || []).forEach(group => {
    const rolling = isRollingAssistanceGroup(group);
    const kept = (group.sessions || []).filter(s => {
      const start = s.event ? s.event.getStartTime() : null;
      if (!start) return true;
      if (rolling) {
        return isWithinAssistanceFormWindow(start, opts.now) ||
          (assistanceEnd && start <= assistanceEnd &&
            start >= assistanceFormWindow(opts.now).start);
      }
      return !ordinaryEnd || start <= ordinaryEnd;
    });
    if (kept.length === 0) return;
    group.sessions = kept;
    out.push(group);
  });
  return out;
}

/**
 * The sessions of a form context, trimmed to what an appointment form offers.
 *
 * Applied to `sessions` ONLY, deliberately: locations, titles, showLocation,
 * showTitle, the club/grouped flags and the capacity hints all stay derived
 * from the form's WHOLE row set. Those decide how a date is LABELLED, and
 * buildRegistryIndex() (27) derives the same labels from the same whole row
 * set to match a response back to its session. A window that changed
 * showLocation for three months of the year would relabel every date on the
 * form and strand every response already collected against the old labels.
 */
function windowAssistanceContextSessions(context) {
  if (!isRollingAssistanceContext(context)) return context;
  context.sessions = (context.sessions || []).filter(s => isWithinAssistanceFormWindow(s.date));
  return context;
}

/**
 * ADOPTION: the appointment program that already has one form per month.
 *
 * Every workbook this ships into has them. Those forms hold responses, their
 * links are in circulation, and the session rows of each month point at their
 * own. Grouping alone would leave that untouched — the new rolling form would
 * take the new dates and the old months would go on quietly pointing somewhere
 * else, which is the "a live link, on the right row, to the wrong form" failure
 * this codebase has already paid for once (see buildFormIdByProgram()).
 *
 * So the rolling group ADOPTS one form — getExistingRegistryState() picks the
 * one the program's next session is already on, so the form most people are
 * currently holding a link to is the one that survives — and this points every
 * UPCOMING row of the program at it, through the same writer the "Move
 * Sessions" dialog uses. backInjectCalendarDescriptions() then rewrites the
 * link on every one of the group's events, so the calendar agrees too.
 *
 * PAST ROWS ARE LEFT ALONE, on purpose. A past row's Form_ID is a record of
 * where that registration came from; rewriting it would file September's
 * sign-ups under a form they were never submitted to, and nothing reads it
 * afterwards but a person asking what happened.
 *
 * The superseded forms are not deleted or hidden: they still open, they still
 * hold their responses, and a link handed out for one still works — it simply
 * stops being the form this program's rows name. That is said in the admin
 * digest rather than left to be discovered.
 *
 * Returns the number of rows repointed.
 */
function adoptAssistanceProgramSessions(registrySheet, group, formInfo) {
  if (!isRollingAssistanceGroup(group) || !formInfo || !formInfo.formId) return 0;
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;

  const titleKey = normalizeNameKey(group.cleanTitle);
  const sources = new Set((group.calendarIds || []).filter(Boolean));
  const todayKey = formatDateKey(new Date());
  const wanted = new Set();
  const supersededForms = {};

  rows.forEach(row => {
    if (normalizeNameKey(String(row[map['Clean_Title']] || '')) !== titleKey) return;
    const source = String(row[map['Calendar_Source']] || '').trim();
    // A shared program's rows come from several calendars and the group knows
    // all of them; an ordinary one's come from the single calendar it is
    // scoped to. Either way the row has to be on a calendar THIS group covers,
    // or two locations running an unlinked program of the same name would be
    // folded onto one form — the line spreadFlagToSiblingRows() refuses to
    // cross, for the same reason.
    if (sources.size > 0 && !sources.has(source)) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date || formatDateKey(date) < todayKey) return;
    const rowFormId = String(row[map['Form_ID']] || '').trim();
    if (!rowFormId || rowFormId === formInfo.formId) return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return;
    wanted.add(eventId);
    supersededForms[rowFormId] = (supersededForms[rowFormId] || 0) + 1;
  });

  if (wanted.size === 0) return 0;

  const moved = writeFormIdOntoSessions(registrySheet, wanted, formInfo.formId);
  if (moved === 0) return 0;
  SpreadsheetApp.flush();

  const formList = Object.keys(supersededForms)
    .map(id => `${describeFormLink(id)} (${supersededForms[id]} date(s))`).join(', ');
  log(`Appointment program "${group.cleanTitle}": moved ${moved} upcoming date(s) onto ` +
    `${describeFormLink(formInfo.formId)} — one form now covers every month it runs in. ` +
    `Superseded: ${formList}.`);
  noteForAdmin('Appointment programs moved onto one form',
    `"${group.cleanTitle}" (${describeLocations(group.locations)}) used to take a separate form each month. ` +
    `Its ${moved} upcoming date(s) now point at ${describeFormLink(formInfo.formId)}, and the registration ` +
    `link on its calendar events says the same. The month forms it replaces still open and still hold every ` +
    `response already made on them — nothing was deleted — but they are no longer the form this program ` +
    `books through: ${formList}.`);
  return moved;
}
