// ============================================================================
// 1c. PER-EXECUTION CACHES  (the sync hot paths)
// ============================================================================
//
// An Apps Script global lives exactly as long as ONE execution, which makes
// globals the natural home for "read this tab once per run" memoization:
// there is no cross-run staleness to reason about, only within-run
// invalidation whenever this script itself rewrites the tab a cache was
// built from. Every cache below is explicitly dropped by the code path that
// dirties it — grep the invalidate* functions for their call sites.
//
// What these replace (all of it per-call before):
//   - getMealInfoForDate() re-read the ENTIRE Lunch_Schedule tab on every
//     single call, and buildDateLabelSets() calls it 2-3x PER DATE. A
//     10-date form therefore cost ~30 full-tab reads to build its labels,
//     once per form, on every sync.
//   - getMealBufferConfigForLocation()/getOrderAheadDays() re-read Config
//     per call, the former once per lunch-dashboard rollup row.
//   - form.getItems() is a REMOTE call and getResponseValueByTitle() made
//     one per lookup — roughly ten per response, times every response.
//   - CalendarApp.getEvents() ran once per calendar in syncCalendarsInternal()
//     AND again in every triageDeletedSessions() pass; a full
//     initializeAndSyncAll() hit the calendars four times over.
// ============================================================================

let __mealInfoIndexCache = null;
let __mealBufferIndexCache = null;
let __orderAheadDaysCache = null;
let __adminNotificationEmailCache = null;
let __archiveCopyEmailCache = null;
let __cateringPolicyIndexCache = null;
let __linkDisplayCache = null;
let __calendarInviteModeCache = null;
// { key } — the wrapper is what lets a legitimately EMPTY horizon ('' = none)
// be cached, instead of being re-read from the sheet on every session.
let __registrationHorizonCache = null;
let __automationEnabledCache = null;
let __triggerOwnerCache = null;
let __calendarEventsCache = null;
let __formItemIndexCache = {};

/**
 * Reads Lunch_Schedule ONCE per execution into
 * { 'yyyy-MM-dd|Location': mealInfo, 'yyyy-MM-dd': mealInfo }. The
 * date-only key preserves getMealInfoForDate()'s original "no location
 * given -> first matching row wins" behavior; first write wins for both key
 * shapes, matching the old top-to-bottom scan.
 */
function getMealInfoIndex() {
  if (__mealInfoIndexCache) return __mealInfoIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE) : null;
  if (sheet) {
    const headers = HEADERS.Lunch_Schedule;
    const map = getIndexMap(headers);
    readLunchScheduleRows(sheet).forEach(row => {
      const rowDate = coerceDate(row[map['Event_Date']]);
      if (!rowDate) return;
      const dateKey = formatDateKey(rowDate);
      const location = String(row[map['Location']] || '').trim();
      // CANONICALIZED, not read raw. The Type column has a strict dropdown,
      // but a paste carries its own validation over the top of the cell's, so
      // a hand-typed "not serving" does reach this tab — and read raw it is
      // not equal to 'Not Serving', which silently defeats EVERY not-serving
      // safeguard at once: isExplicitlyNotServing() says no, isLunchOfferedOn()
      // says lunch is on, the form keeps offering it, and nobody is warned.
      // Failing safe here costs nothing; anything canonicalizeLunchType()
      // doesn't recognize is kept verbatim, exactly as before.
      const rawType = row[map['Type']] || '';
      const type = canonicalizeLunchType(rawType) || String(rawType).trim();
      const info = {
        type,
        description: row[map['Meal_Description']] || '',
        shorthand: row[map['Meal_Shorthand']] || '',
        // Where this meal came from, carried on the info object so a lookup by
        // Meal_ID can answer "which date and location was that batch?" without
        // a second pass over the tab.
        dateKey,
        location,
        mealId: deriveMealId(rowDate, location, type)
      };
      const locatedKey = `${dateKey}|${location}`;
      if (index[locatedKey] === undefined) index[locatedKey] = info;
      if (index[dateKey] === undefined) index[dateKey] = info;
      // Third key shape: the batch's own ID. A Meal_ID starts with "M-" and a
      // date key never does, so the three shapes share one object safely.
      if (info.mealId && index[info.mealId] === undefined) index[info.mealId] = info;
    });
  }
  __mealInfoIndexCache = index;
  return index;
}

/**
 * The ID of the BATCH a Lunch_Schedule row describes:
 *
 *     M-20260916-NARBERTH-HOT
 *
 * Derived rather than stored, because this tab is cleared and rebuilt on every
 * render and an ID that had to survive that is an ID that eventually doesn't.
 * Deriving it also means an existing workbook needs no migration step — the
 * next render simply fills the column in, and every ID it produces for a row
 * that already existed is the same one it would have produced last month.
 *
 * "Not Serving" and blank types get NO ID: there is no batch on a day the
 * kitchen is closed, and handing one out would invite a registrant row to
 * point at food that was never made.
 *
 * The location goes in whole rather than abbreviated. A four-letter prefix is
 * tidier right up until two locations share one.
 */
function deriveMealId(date, location, type) {
  const d = coerceDate(date);
  const cleanType = String(type || '').trim();
  const cleanLocation = String(location || '').trim();
  if (!d || !cleanLocation) return '';
  if (CATERED_LUNCH_TYPES.indexOf(cleanType) === -1) return '';
  const slug = cleanLocation.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!slug) return '';
  return `M-${Utilities.formatDate(d, TIMEZONE, 'yyyyMMdd')}-${slug}-${cleanType.toUpperCase()}`;
}

/**
 * Looks a batch up by its Meal_ID. Returns the same info object
 * getMealInfoForDate() returns (type/description/shorthand) plus the dateKey
 * and location the batch belongs to, or null when nothing on Lunch_Schedule
 * answers to that ID.
 *
 * A null here is the ORPHAN case — a row pointing at a batch that has since
 * been retyped, re-dated or marked Not Serving. Callers must not drop those
 * meals on the floor; they belong to the row's own day until someone fixes the
 * reference. See buildDashboardRollup().
 */
function getMealBatchById(mealId) {
  const key = parseMealIdReference(mealId);
  if (!key) return null;
  const info = getMealInfoIndex()[key];
  return info && info.mealId ? info : null;
}

/**
 * Pulls a bare Meal_ID out of whatever is actually in a Meal_Source cell.
 *
 * The dropdown offers "M-20260916-NARBERTH-HOT — Chicken Parm", because an ID
 * on its own is unreadable at a serving counter and picking the wrong day off
 * a list of near-identical strings is exactly the mistake this column exists
 * to prevent. Sheets stores whatever was picked, so the label comes along with
 * it and has to be trimmed back off here. Anything that doesn't contain a
 * well-formed ID returns '' and is treated as an orphan reference — which is
 * reported, never silently ignored.
 */
function parseMealIdReference(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return '';
  const match = text.match(/^M-\d{8}-[A-Z0-9]+-[A-Z]+/);
  return match ? match[0] : '';
}

/**
 * Meal_Source dropdown options: every batch on Lunch_Schedule near enough to
 * today to still be plausibly changing hands, newest first, each labelled with
 * its dish.
 *
 * Bounded on purpose. A dropdown carrying every meal the kitchen has ever made
 * is the same unusable list Quick Mark's name field would be without its
 * cascade — and the whole point of the column is naming YESTERDAY'S food, not
 * last spring's. The window looks forward a little as well as back, because a
 * menu is typically pasted in a month ahead and a batch cooked tomorrow is a
 * legitimate thing to point at once tomorrow arrives.
 *
 * Anything outside the window is still accepted if typed — the validation is
 * open (see applyRegistrantsFormatting()).
 */
function getRecentMealIdOptions() {
  const index = getMealInfoIndex();
  const today = new Date();
  const from = formatDateKey(new Date(today.getTime() - MEAL_SOURCE_LOOKBACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + MEAL_SOURCE_LOOKAHEAD_DAYS * 86400000));

  const seen = {};
  const batches = [];
  Object.keys(index).forEach(key => {
    const info = index[key];
    // Every batch appears under three keys; take it once, from its own ID.
    if (!info || !info.mealId || key !== info.mealId) return;
    if (info.dateKey < from || info.dateKey > to) return;
    if (seen[info.mealId]) return;
    seen[info.mealId] = true;
    batches.push(info);
  });

  batches.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));
  return batches.slice(0, MEAL_SOURCE_MAX_OPTIONS).map(info => {
    const dish = String(info.shorthand || info.description || info.type || '').trim();
    return dish ? `${info.mealId} — ${dish}` : info.mealId;
  });
}

/** Called by renderLunchScheduleSheet() — the only thing that rewrites the tab this index is built from. */
function invalidateMealInfoIndex() {
  __mealInfoIndexCache = null;
}

/** Called by buildConfigSheet() — the only thing that rewrites/seeds the Config tab. */
function invalidateConfigCaches() {
  __mealBufferIndexCache = null;
  __orderAheadDaysCache = null;
  __adminNotificationEmailCache = null;
  __archiveCopyEmailCache = null;
  __cateringPolicyIndexCache = null;
  __linkDisplayCache = null;
  __calendarInviteModeCache = null;
  __registrationHorizonCache = null;
  __automationEnabledCache = null;
  __triggerOwnerCache = null;
  // This one also lives in the CROSS-execution cache, which a plain
  // per-execution reset would leave serving the old value to the next
  // trigger firing for up to AUTOMATION_FLAG_CACHE_SECONDS.
  clearAutomationFlagCache();
}

/**
 * Item lookups for one form, built with a SINGLE form.getItems() round
 * trip: { byTitle: {title: [item...]}, paragraphItems: [...] }. Cached per
 * form ID for the rest of the execution. Only ever used for READS — the
 * refresh paths that mutate a form's items call invalidateFormItemIndex().
 */
function getFormItemIndex(form) {
  const formId = form.getId();
  if (__formItemIndexCache[formId]) return __formItemIndexCache[formId];
  const items = form.getItems();
  const byTitle = {};
  const paragraphItems = [];
  items.forEach(item => {
    const title = item.getTitle();
    if (!byTitle[title]) byTitle[title] = [];
    byTitle[title].push(item);
    if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) paragraphItems.push(item);
  });
  // The custom questions THIS SCRIPT put on the form (see
  // syncCustomQuestionsOnForm). Carried on the index because both readers of
  // it — the admin-notes fallback and the Form_Answers collector — need the
  // same list, and it costs one Script Properties read per form rather than
  // one per response.
  const customTitles = appliedCustomQuestionTitles(formId);
  const index = { form, formId, items, byTitle, paragraphItems, customTitles };
  __formItemIndexCache[formId] = index;
  return index;
}

function invalidateFormItemIndex(formId) {
  if (formId) delete __formItemIndexCache[formId];
  else __formItemIndexCache = {};
}

/**
 * One CalendarApp.getEvents() per calendar per execution, keyed on the sync
 * window so a differently-scoped call still re-fetches. Returns
 * { calendarId: [CalendarEvent...] | null }, where null means the calendar
 * was inaccessible (callers log and skip, same as before).
 *
 * Safe to share across a full syncCalendars(): that run edits event
 * DESCRIPTIONS (backInjectCalendarDescriptions) but never adds or removes
 * events, so the set of live events this cache represents stays accurate.
 */
function getCalendarEventsForWindow(start, end) {
  const windowKey = `${start.getTime()}|${end.getTime()}`;
  if (__calendarEventsCache && __calendarEventsCache.windowKey === windowKey) {
    return __calendarEventsCache.byCalendar;
  }
  const byCalendar = {};
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    // getCalendarById() returns null for "not found", but THROWS when the
    // running context has no calendar authorization at all — which is the
    // normal state inside a simple onEdit trigger (see onEdit()). Both mean
    // the same thing to every caller: this calendar could not be read.
    try {
      const calendar = CalendarApp.getCalendarById(calendarId);
      byCalendar[calendarId] = calendar ? calendar.getEvents(start, end) : null;
    } catch (err) {
      log(`⚠️ Calendar ${calendarId} could not be read (${err}).`);
      byCalendar[calendarId] = null;
    }
  });
  __calendarEventsCache = { windowKey, byCalendar };
  return byCalendar;
}

/** Drops the calendar cache — used after anything that could change which events exist. */
function invalidateCalendarEventsCache() {
  __calendarEventsCache = null;
}


