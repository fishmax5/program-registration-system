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
//   - FormApp.openById() is a REMOTE call and had no memo at all, with 35 call
//     sites across 17 files. reconcileNoRegistrationGroups() and its neighbours
//     in 23_reconcile_sessions.gs open forms five separate times, and within
//     ONE sync the same form is commonly opened again by 10_form_date_labels,
//     26_event_descriptions, 31_form_shape_and_migration, 54_custom_questions,
//     55_assistance_sync_and_images and 68_form_state_migrations.
//   - CalendarApp.getEvents() ran once per calendar in syncCalendarsInternal()
//     AND again in every triageDeletedSessions() pass; a full
//     initializeAndSyncAll() hit the calendars four times over.
// ============================================================================

let __mealInfoIndexCache = null;
let __mealBufferIndexCache = null;
let __orderAheadDaysCache = null;
// Config's Admin Notification Emails table, read once per execution — see
// getAdminNotificationRows(). An array, so an EMPTY table ([], meaning "copy
// nobody") caches as the answer it is rather than being re-read from the sheet
// by every category lookup in the run.
let __adminNotificationRowsCache = null;
let __membershipFormIdCache = null;
// The door's membership application, read once per execution — see
// membershipFormShape(). Wrapped ({ shape }) so a form that could NOT be
// opened is cached as the refusal it is, rather than re-attempting a remote
// call that has already failed once in this execution.
let __membershipFormShapeCache = null;
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
let __formHandleCache = {};

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
  __adminNotificationRowsCache = null;
  __membershipFormIdCache = null;
  __membershipFormShapeCache = null;
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
  // The HANDLE goes with the index. Every path that dirties a form's items has
  // just written to that form, and the cheap thing to do about a handle whose
  // freshness is now in question is to drop it and pay for one more open —
  // rather than reason, at every one of these call sites, about what a Form
  // object does and does not re-read after somebody else has edited the file.
  // Nothing needs a separate invalidateFormHandle(): a path that wants the
  // handle gone wants the index gone too, and there is no path that wants the
  // reverse.
  if (formId) delete __formHandleCache[formId];
  else __formHandleCache = {};
}

/**
 * ONE FormApp.openById() per form per execution.
 *
 * The handle itself, not its items — getFormItemIndex() above memoizes
 * form.getItems() but was always handed a form somebody else had already paid
 * to open. A single sync opens the same form from half a dozen files (the
 * banner at the top of this file lists them), and each of those was a separate
 * round trip to the Forms service for a document that had not changed hands.
 *
 * FAILURES ARE NOT CACHED, deliberately. A form id that will not open is
 * re-tried on the next call, exactly as it was before this cache existed, for
 * three reasons:
 *   - The throw is the ANSWER at some call sites. findExistingFormIdFromEvents()
 *     and the "existing form" branch of moveSessionsToForm() open a form purely
 *     to find out whether it opens; a remembered "no" would still be correct,
 *     but a remembered "no" is one bad minute away from being wrong for the
 *     rest of a run.
 *   - A failure here is routinely REPAIRED mid-execution. syncRegistrations()
 *     answers a permission failure by opening the file's sharing up, and the
 *     rebuild and recovery paths (49, 50) put a form back within the same run;
 *     a cached refusal would outlive its own fix.
 *   - The cost of getting it wrong is asymmetric. A repeated open of a broken
 *     form is one wasted round trip on a path that is already logging a
 *     warning; a wrongly remembered refusal silently skips a form's dates, its
 *     questions or its registrations for the whole execution.
 * Both mean a caller's own try/catch keeps working unchanged — this function
 * throws whatever FormApp.openById() throws, at every call.
 */
function openFormCached(formId) {
  const id = String(formId || '').trim();
  // No id: hand it to Forms anyway, so the caller gets the same error it
  // always got rather than a different one invented here.
  if (!id) return FormApp.openById(formId);
  if (__formHandleCache[id]) return __formHandleCache[id];
  const form = FormApp.openById(id);
  __formHandleCache[id] = form;
  return form;
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


// ============================================================================
// THE SECTIONED-TABLE READ, ONCE PER TAB PER EXECUTION
// ============================================================================
//
// readAllSectionedRows() and readAllSectionedRowValues()
// (34_sectioned_tables.gs) are how every date-bearing tab is read, from
// roughly forty-six files. They are also the most expensive read in the
// project: the formula-preserving one costs a whole-grid read to find the
// header rows plus a getValues() AND a getFormulas() per sub-table — seven
// round trips on the two-zone shape every tab has.
//
// WHAT THIS REPLACES. A single syncRegistrations() run re-read the same two
// tabs over and over: Master_Program_Dashboard at 27_registration_import.gs:81,
// 33_calendar_invitations.gs:110 and :319, 66_program_leader_notifications.gs
// and 70_registrant_notifications.gs; Registrant_Dash at
// 27_registration_import.gs:83 and :281, 30_registry_counts.gs:20,
// 33_calendar_invitations.gs:342 and 70_registrant_notifications.gs:497 —
// eight-plus full-grid reads of two tabs that changed at most once in
// between, which is tens of round trips on a workbook with a year of history.
//
// The codebase already half-solved this by hand, threading a `sessionRows` /
// `registrantRows` optional parameter down through call chains so a callee
// could reuse what its caller had already read. That is a manual cache with
// no invalidation story, and it only ever reached the callees somebody
// remembered to thread it to. This is the same idea with the plumbing gone.
//
// THE KEY is sheet name + marker header + reader kind, plus the `headers`
// array and `endRow` the call asked for — the last two because they change
// the ANSWER, not just the cost: a different HEADERS list projects different
// columns, and Lunch_Schedule's endRow deliberately stops short of the ADD
// block below the tables. The reader kind is in the key because the two
// readers genuinely return different things for the same cell: the
// formula-preserving one hands back `=HYPERLINK(...)` where the values one
// hands back the text it displays, and letting them share an entry would
// hand a caller the wrong one of those.
//
// EVERY HIT IS A COPY. Callers mutate the rows they get back —
// cancelRegistrantRows() stamps four cells on every matching row and hands
// the same array to the render — so a cache that returned its own array
// would be rewritten by its first reader. A slice per row costs nothing
// against the round trips it saves.
//
// INVALIDATION is the whole risk here: a cached roster that survives a write
// reads as data loss, not as a slow page. So it is dropped by every path
// that writes to one of these tabs — writeUpcomingPastSections() and
// renderFlatDateSheet() in 34, writeMemoryTab() in 40, and each of the
// scattered single-cell and single-column writes elsewhere. Grep
// invalidateSectionedRowsCache() for the list. When in doubt the call is
// made with no sheet name, which drops everything: a redundant re-read is
// one round trip, and a missed one is a wrong roster.
// ============================================================================

let __sectionedRowsCache = {};

/**
 * The cache key for one sectioned read. The header list goes in whole, not
 * just its length: two same-length HEADERS arrays project different columns.
 */
function sectionedRowsCacheKey(sheet, headers, markerHeaderName, endRow, kind) {
  return [
    sheet.getName(), markerHeaderName, kind, endRow || '', (headers || []).join(',')
  ].join('|');
}

/** A fresh copy of a cached row set, so a caller's edits never reach the cache. */
function copySectionedRows(rows) {
  return rows.map(row => row.slice());
}

/**
 * readAllSectionedRows(), memoized for the rest of this execution. The
 * formula-preserving read — use it when the rows are going back onto a sheet.
 */
function getSectionedRows(sheet, headers, markerHeaderName, endRow) {
  if (!sheet) return [];
  // A real Sheet always has getName(); a test double that skips it is opting
  // itself out of caching, not asking for a crash — read straight through.
  if (typeof sheet.getName !== 'function') {
    return readAllSectionedRows(sheet, headers, markerHeaderName, endRow);
  }
  const key = sectionedRowsCacheKey(sheet, headers, markerHeaderName, endRow, 'formulas');
  if (!__sectionedRowsCache[key]) {
    __sectionedRowsCache[key] = readAllSectionedRows(sheet, headers, markerHeaderName, endRow);
  }
  return copySectionedRows(__sectionedRowsCache[key]);
}

/**
 * readAllSectionedRowValues(), memoized for the rest of this execution. The
 * one-round-trip values read — use it when nothing is going back onto a
 * sheet, and when a formula cell (Registrant_Dash's Event_Time) has to come
 * back as the time it displays rather than as its formula.
 */
function getSectionedRowValues(sheet, headers, markerHeaderName) {
  if (!sheet) return [];
  if (typeof sheet.getName !== 'function') {
    return readAllSectionedRowValues(sheet, headers, markerHeaderName);
  }
  const key = sectionedRowsCacheKey(sheet, headers, markerHeaderName, null, 'values');
  if (!__sectionedRowsCache[key]) {
    __sectionedRowsCache[key] = readAllSectionedRowValues(sheet, headers, markerHeaderName);
  }
  return copySectionedRows(__sectionedRowsCache[key]);
}

/**
 * Drops the cached reads of one tab — or, called with nothing, of every tab.
 *
 * Called by everything that writes to a sectioned tab. Err toward the
 * no-argument form: dropping a tab that did not change costs one re-read,
 * and keeping a tab that did costs a stale roster.
 *
 * Takes either a sheet or its name — every call site here writes through a
 * sheet object it already has in hand, so it hands over the sheet itself
 * rather than repeat-guarding a `.getName()` call at every site. A sheet-like
 * object with no getName() (only ever a test double that opted out of this
 * cache — see getSectionedRows()) cannot be identified, so this drops
 * everything rather than silently leaving it cached.
 */
function invalidateSectionedRowsCache(sheetOrName) {
  const sheetName = !sheetOrName ? null
    : typeof sheetOrName === 'string' ? sheetOrName
    : typeof sheetOrName.getName === 'function' ? sheetOrName.getName()
    : null;
  if (!sheetName) { __sectionedRowsCache = {}; return; }
  const prefix = `${sheetName}|`;
  Object.keys(__sectionedRowsCache).forEach(key => {
    if (key.indexOf(prefix) === 0) delete __sectionedRowsCache[key];
  });
}
