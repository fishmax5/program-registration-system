// ============================================================================
// 1b. LUNCH SCHEDULE LOOKUP (per Event_Date x Location — see Lunch_Schedule tab)
// ============================================================================

/** Returns the hardcoded form footer note for a location (falls back to a generic note). */
function getFormFooterForLocation(locationName) {
  return FORM_FOOTER_BY_LOCATION[locationName] || DEFAULT_FORM_FOOTER;
}

/**
 * The footer note for a form covering `locations` — the one location's note
 * when there is one, and every DISTINCT note (each prefixed with the location
 * it belongs to) when a cross-location form spans several. Locations that
 * share a note are not repeated, so the common "three sites, one house rule"
 * case still reads as a single sentence.
 */
function buildFooterNoteForLocations(locations) {
  const list = (locations || []).filter(Boolean);
  if (list.length <= 1) return getFormFooterForLocation(list[0]);

  const byNote = {};
  list.forEach(loc => {
    const note = getFormFooterForLocation(loc);
    if (!note) return;
    if (!byNote[note]) byNote[note] = [];
    byNote[note].push(loc);
  });
  const notes = Object.keys(byNote);
  if (notes.length === 0) return DEFAULT_FORM_FOOTER;
  if (notes.length === 1) return notes[0];
  return notes.map(note => `${byNote[note].join(' / ')}: ${note}`).join('\n');
}

/**
 * Looks up the day's meal info (Type, Meal_Description, Meal_Shorthand)
 * from Lunch_Schedule for one specific date AND location. Returns null if
 * no row exists for that date+location yet. Type may be 'Hot' | 'Cold' |
 * 'Not Serving'. Backed by getMealInfoIndex()'s one-read-per-execution map
 * (this used to re-read the whole tab on every call).
 */
function getMealInfoForDate(date, location) {
  if (!date) return null;
  const index = getMealInfoIndex();
  const dateKey = formatDateKey(date);
  const key = location ? `${dateKey}|${String(location).trim()}` : dateKey;
  return index[key] || null;
}

/**
 * Builds a "date label + menu hint [+ capacity hint]" string, e.g. "Mon,
 * Jan 5, 2026 — Turkey Sandwich (FULL - Waitlist)", using Meal_Shorthand
 * when present, falling back to Meal_Description. When the date+location is
 * marked "Not Serving," the hint instead reads "No Lunch Served" — this is
 * what lets a form communicate the lack of catering right on the date row
 * itself. capacityHint (CAPACITY_HINT_SUFFIX or '') is always appended
 * LAST, after any meal hint. Used ONLY for form-facing display text;
 * internal matching/storage always uses the plain label via
 * stripMealHint()/formatDateLabel().
 */
function formatDateLabelWithMeal(date, location, capacityHint, showLocation, title, showTitle) {
  const parts = buildSessionLabelParts(date, location, capacityHint, showLocation, title, showTitle);
  return `${parts.base}${parts.hint}${parts.capacityHint}`;
}

/**
 * The same label BEFORE it is joined up: { base, hint, capacityHint }.
 *
 * It exists because the form's DESCRIPTION wants one more thing in the middle
 * of it than the grid row does — the session's clock time, which belongs
 * directly after the date and cannot go on the end, where the meal already is.
 * The grid row label is a join key and must not gain a character (see
 * formatSessionLabel()); the description is prose and can say more. Building
 * both from the same parts is what keeps them from drifting into two different
 * answers about the same day.
 */
function buildSessionLabelParts(date, location, capacityHint, showLocation, title, showTitle) {
  const base = formatSessionLabel(date, location, showLocation, title, showTitle);
  const meal = getMealInfoForDate(date, location);
  let hint = '';
  if (meal && meal.type === 'Not Serving') hint = `${MEAL_HINT_SEPARATOR}${NO_LUNCH_HINT}`;
  else if (meal) {
    const dish = meal.shorthand || meal.description;
    if (dish) hint = `${MEAL_HINT_SEPARATOR}${formatMealHint(dish)}`;
  }
  return { base, hint, capacityHint: capacityHint || '' };
}

/**
 * A SESSION'S CLOCK TIME, as the form description says it: "10:00 AM – 11:30 AM".
 *
 * Asked for because the form told people WHICH DAY and never what time, which
 * is the other half of the question anybody deciding whether they can come is
 * actually asking — and the answer was on the calendar, in the event, on a
 * page they were not looking at.
 *
 * BLANK WHEN THERE IS NO TIME TO SAY. A session at midnight is an all-day
 * event or a date typed without one, and "12:00 AM" is worse than silence: it
 * is a time, and somebody will believe it.
 */
function sessionTimeRangeForDisplay(session) {
  const start = coerceDate(session && session.date);
  if (!start) return '';
  if (start.getHours() === 0 && start.getMinutes() === 0) return '';
  return formatTimeRange(start, (session && session.end) || null);
}

/**
 * The plain, meal-and-capacity-free label that IDENTIFIES one session on a
 * form: its date, plus its location when the form covers more than one (see
 * SHARED_LOCATION_SCOPE).
 *
 * This is the join key between a form and the session table — the grid row
 * label a respondent ticks, and the key buildRegistryIndex() looks that row
 * back up by. On a single-location, single-program form it is exactly the date
 * label it has always been, so nothing about existing forms changes.
 *
 * TWO THINGS CAN BE ADDED, and neither is decoration — each exists because
 * without it two different sessions collapse to one indistinguishable row
 * label, which a Forms grid rejects outright and which no lookup could resolve
 * back to a session anyway:
 *
 *   the LOCATION, on a cross-location form (see SHARED_LOCATION_SCOPE), where
 *     two sites can run the same program on the same day;
 *   the PROGRAM NAME, on a combined form (see mergeEventsIntoOneForm()), whose
 *     whole point is that its dates belong to DIFFERENT programs — a bare date
 *     there tells a respondent nothing about what they are signing up for.
 *
 * Both use LOCATION_LABEL_SEPARATOR, and both sit before any meal or capacity
 * hint, so stripMealHint() still returns a label that identifies the SESSION.
 */
function formatSessionLabel(date, location, showLocation, title, showTitle) {
  let base = formatDateLabel(date);
  if (showTitle && title) base += `${LOCATION_LABEL_SEPARATOR}${title}`;
  if (showLocation && location) base += `${LOCATION_LABEL_SEPARATOR}${location}`;
  return base;
}

/** The distinct locations in a list of names, in the order they appear. */
function distinctLocations(names) {
  return dedupePreservingOrder((names || []).map(n => String(n || '').trim()).filter(Boolean));
}

/** The distinct locations a set of [{date, location}] sessions touches. */
function locationsOfSessions(sessions) {
  return distinctLocations((sessions || []).map(s => s.location));
}

/** The distinct PROGRAM names a set of sessions covers — more than one means a combined form. */
function distinctSessionTitles(sessions) {
  return dedupePreservingOrder((sessions || []).map(s => String(s.title || '').trim()).filter(Boolean));
}

/**
 * Splits a form's SESSIONS — [{ date, location }], each session knowing the
 * one place it happens — into the full label list (for the attendance roster
 * grid: every date, whether or not lunch is served) and the lunch-grid label
 * subset (only date+location pairs Lunch_Schedule doesn't mark "Not Serving"),
 * so the lunch grid never offers a choice on a day nothing is being catered.
 *
 * options:
 *   capacityHints  { 'yyyy-MM-dd': CAPACITY_HINT_SUFFIX } (see
 *                  buildCapacityHintsFromRegistryRows()) — omit for none.
 *   showLocation   whether labels name their location. Defaults to "only if
 *                  the sessions actually span more than one", which is right
 *                  for any caller that isn't holding a form's own scope; a
 *                  caller that knows the form is cross-location passes true
 *                  explicitly so its labels stay stable even in a window
 *                  where only one location happens to have dates.
 *   showTitle      whether labels name their program. Same defaulting rule,
 *                  against the sessions' distinct titles — see
 *                  formatSessionLabel().
 *
 * Both lists are DE-DUPLICATED. A group with two sessions on the same day —
 * a morning and an afternoon sitting of the same program — produces the same
 * label twice, and a Google Forms grid rejects duplicate row labels outright
 * ("Invalid data updating form"), which fails the whole form write and takes
 * the date list with it. Collapsing them costs nothing downstream: a grid row
 * is matched back to its session by label (registryIndex is keyed
 * `formId|label`), so the two sittings were always going to resolve to one
 * row anyway.
 */
function buildDateLabelSets(sessions, options) {
  options = options || {};
  const capacityHints = options.capacityHints || {};
  const showLocation = options.showLocation === undefined
    ? locationsOfSessions(sessions).length > 1
    : !!options.showLocation;
  const showTitle = options.showTitle === undefined
    ? distinctSessionTitles(sessions).length > 1
    : !!options.showTitle;

  // ONE PASS OVER THE SESSIONS, because everything below is a different view
  // of the same three facts about each one: its label parts, whether it serves
  // lunch, and what time it runs at.
  const partsByLabel = {};
  const timesByLabel = {};
  const decorated = sessions.map(session => {
    const parts = buildSessionLabelParts(session.date, session.location,
      capacityHints[formatDateKey(session.date)], showLocation, session.title, showTitle);
    const label = `${parts.base}${parts.hint}${parts.capacityHint}`;
    if (!partsByLabel[label]) partsByLabel[label] = parts;
    const time = sessionTimeRangeForDisplay(session);
    if (time) {
      if (!timesByLabel[label]) timesByLabel[label] = [];
      if (timesByLabel[label].indexOf(time) === -1) timesByLabel[label].push(time);
    }
    return { session, label };
  });

  const allDateLabels = dedupePreservingOrder(decorated.map(d => d.label));
  const lunchDateLabels = dedupePreservingOrder(decorated
    .filter(d => isLunchOfferedOn(d.session.date, d.session.location))
    .map(d => d.label));

  // THE DESCRIPTION'S OWN LINES, one per label above and in the same order,
  // carrying the session's clock time between the date and the meal. Built
  // here rather than recovered from a label later because only here is the
  // session — and therefore its start and end — still in hand.
  //
  // TWO SITTINGS OF ONE PROGRAM ON ONE DAY share a label (a grid cannot carry
  // two rows reading the same thing — see the dedupe above) and say BOTH their
  // times on one line, which is the first time the form has been able to
  // disclose the second sitting at all.
  const lineFor = label => {
    const times = timesByLabel[label];
    const parts = partsByLabel[label];
    if (!times || times.length === 0 || !parts) return label;
    return `${parts.base}, ${times.join(' and ')}${parts.hint}${parts.capacityHint}`;
  };

  return {
    allDateLabels,
    lunchDateLabels,
    allDateLines: allDateLabels.map(lineFor),
    lunchDateLines: lunchDateLabels.map(lineFor)
  };
}

/**
 * The Form_IDs known to belong to a CROSS-LOCATION group, read off the
 * persistent groupKey -> Form_ID registry (a shared group's key is scoped
 * SHARED_LOCATION_SCOPE — see buildEventGroups()).
 *
 * Why it's needed at all: a form's scope is otherwise inferred from its own
 * session rows spanning several locations, which is true in the steady state
 * but not in the window where a shared program has dates at only one of its
 * locations. Reading the registry keeps such a form labelling itself the same
 * way before and after its second location shows up — labels that flip would
 * strand every response already collected against the old ones.
 */
function getSharedFormIdSet() {
  const registry = getPersistentFormRegistry();
  const prefix = `${SHARED_LOCATION_SCOPE}::`;
  const shared = new Set();
  Object.keys(registry).forEach(key => {
    if (key.indexOf(prefix) === 0 && registry[key]) shared.add(registry[key]);
  });
  return shared;
}

/**
 * Everything the form-facing layer needs about ONE form, derived from that
 * form's own session rows: its sessions (each date with the location and
 * program it belongs to, in date order), the distinct locations and programs
 * it covers, whether its labels name either of those, whether it is a club or
 * a grouped series, and its capacity hints.
 *
 * Every "refresh a live form from the sheet" path goes through this, so
 * cross-location, combined-program and club handling are each decided in
 * exactly one place rather than re-derived (differently) in five.
 */
function buildFormSessionContext(formId, formRows, map, sharedFormIds) {
  const sessions = formRows
    .map(row => ({
      date: coerceDate(row[map['Event_Date']]),
      // The END is carried alongside the start for one reason: an appointment
      // program's slots are cut out of the span between them, and every
      // "refresh a live form from the sheet" path has to be able to do that
      // arithmetic without going back to the calendar.
      end: map['Event_End'] === undefined ? null : coerceDate(row[map['Event_End']]),
      eventId: String(row[map['Event_ID']] || '').trim(),
      slotMinutes: map['Slot_Minutes'] === undefined ? 0 : (Number(row[map['Slot_Minutes']]) || 0),
      location: String(row[map['Location']] || '').trim(),
      title: String(row[map['Clean_Title']] || '').trim()
    }))
    .filter(s => s.date)
    .sort((a, b) => a.date - b.date);

  const locations = locationsOfSessions(sessions);
  const titles = distinctSessionTitles(sessions);
  // Computed up here because showTitle depends on it — see below.
  const isLunchOnly = formRows.length > 0 &&
    formRows.every(row => isLunchOnlyEventId(row[map['Event_ID']]));
  // THE BRACKET TAGS THIS FORM'S SESSIONS CARRY, deduped. Nothing in the form
  // layer reads them directly; they exist so a Program_Questions keyword rule
  // can be aimed at what a program IS rather than what it is called — "zoom",
  // "club", "assistance" — and survive it being renamed. See
  // questionsForFormContext().
  const typeTags = dedupePreservingOrder(formRows
    .map(row => String((map['Type_Tag'] === undefined ? '' : row[map['Type_Tag']]) || '').trim())
    .filter(Boolean));
  return {
    formId,
    sessions,
    locations,
    titles,
    typeTags,
    showLocation: locations.length > 1 || !!(sharedFormIds && sharedFormIds.has(formId)),
    // A DATE LABEL NEVER CARRIES A LUNCH ROW'S TITLE, and this is load-bearing
    // rather than cosmetic. Every lunch row is named for its own dish now
    // ("Lunch @ Narberth — Chx Parm"), so a month of them is a month of
    // DISTINCT titles — which would otherwise flip showTitle on and put the
    // dish inside the label a form response is matched back to
    // (buildRegistryIndex()). The dish is the one part of that name that
    // changes when somebody retypes a menu, so a label built from it would
    // strand every registration made before the edit.
    //
    // Nothing is lost by leaving it out: the form's own name already says
    // which location and month it covers, and each date row carries the day's
    // menu as a hint anyway (formatDateLabelWithMeal()).
    showTitle: titles.length > 1 && !isLunchOnly,
    // A form is a club form when the sessions on it are club sessions. On a
    // combined form (several programs, one of them a club) that is still true
    // of the form as a whole, which is the right answer: the club option has
    // to be offered for the club's own dates to be joinable at all.
    isClub: formRows.some(row => isClubColumnValue(row[map['Club']])),
    isFixed: formRows.some(row => isGroupedTypeTag(row[map['Type_Tag']])),
    // SOME, not every, matching isClub above: an appointment program's form
    // has a fundamentally different shape, and a single assistance session on
    // it means the time question has to be there for that session to be
    // bookable at all. syncAssistanceQuestionsOnForm() offers times for the
    // assistance sessions only, so an ordinary session sharing the form is
    // not misrepresented as an appointment.
    isAssistance: map['Personalized_Assistance'] !== undefined &&
      formRows.some(row => isAssistanceColumnValue(row[map['Personalized_Assistance']])),
    // Computed above (EVERY row, not some: a form mixing lunch-only sessions
    // with real programs is not a lunch-only form, and shaping it as one would
    // strip the attendance question off a program that needs it.
    // syncLunchOnlySessions() never builds such a form, but a hand-edited
    // Form_ID could, and the conservative reading is the one that leaves the
    // ordinary form alone).
    isLunchOnly,
    programTitle: titles.length === 1 ? titles[0] : '',
    capacityHints: buildCapacityHintsFromRegistryRows(formRows, map)
  };
}

/** { Form_ID: {showLocation, showTitle} } for a batch of session rows — how each form's date labels read. */
function buildLabelOptionsByForm(rows, map) {
  const sharedFormIds = getSharedFormIdSet();
  const byForm = groupRegistryRowsByForm(rows, map);
  const out = {};
  Object.keys(byForm).forEach(formId => {
    const context = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
    out[formId] = { showLocation: context.showLocation, showTitle: context.showTitle };
  });
  return out;
}

/** First occurrence of each value, in the order they appeared. */
function dedupePreservingOrder(values) {
  const seen = new Set();
  return values.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
}

/**
 * Builds { 'yyyy-MM-dd': CAPACITY_HINT_SUFFIX } from a batch of
 * Program_Sessions rows (any set sharing the same header layout —
 * typically one form's sessions), using each row's own Max_Capacity /
 * Remaining_Seats. Uncapped sessions (no Max_Capacity) never get a hint.
 */
function buildCapacityHintsFromRegistryRows(rows, map) {
  const hints = {};
  rows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    // A SESSION CLOSED BY HAND CARRIES THE HINT TOO, and it is the case the
    // capacity test below cannot see: it usually has no cap at all (see
    // WAITLIST_ONLY_TAG), so `isCapped` is false and the date used to go onto
    // the form reading like any other. Somebody signing up for it is
    // waitlisted, and being told that before submitting is the whole job of
    // this suffix.
    if (map['Waitlist_Only'] !== undefined && isWaitlistOnlyColumnValue(row[map['Waitlist_Only']])) {
      hints[formatDateKey(d)] = CAPACITY_HINT_SUFFIX;
      return;
    }
    const rawCap = row[map['Max_Capacity']];
    const isCapped = rawCap !== '' && rawCap !== '--' && Number(rawCap) > 0;
    if (!isCapped) return;
    const remaining = Number(row[map['Remaining_Seats']]);
    if (!isNaN(remaining) && remaining <= 0) hints[formatDateKey(d)] = CAPACITY_HINT_SUFFIX;
  });
  return hints;
}

/**
 * Generic lunch response choices offered on every form (Yes/No — the
 * specific dish/serving status for a given day comes from Lunch_Schedule
 * and is shown directly on the date row via formatDateLabelWithMeal()).
 */
const GENERIC_LUNCH_CHOICES = ['No Lunch', 'Yes - Lunch'];


