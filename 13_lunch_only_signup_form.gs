// ============================================================================
// 1f. THE LUNCH-ONLY SIGN-UP FORM
// ============================================================================
//
// WHAT IT IS FOR. Plenty of people come in for the meal and nothing else, and
// a good number of them like to book a whole month of lunches in one go. Until
// now the only way onto the catering count was through a PROGRAM's form —
// which meant registering for a class you were not attending in order to get
// fed, or ringing the office and having somebody add you by hand.
//
// WHY IT IS BUILT FROM Lunch_Schedule AND NOT THE CALENDAR. Every other form
// in this system is generated from calendar events, because every other form
// is for a program and a program is a thing on the calendar. A lunch is
// not. The record of which days food is served on is Lunch_Schedule, it is
// already maintained (staff type the month's menu into it), and requiring a
// duplicate calendar entry per catered day would mean two places to keep in
// step and one of them silently authoritative.
//
// HOW IT REJOINS THE REST OF THE SYSTEM. Each catered date becomes an ordinary
// row on the session table, with two differences that do all the work:
//
//   Event_ID   is a LUNCHONLY: id (makeLunchOnlyEventId()) rather than a
//              calendar hash. Everything downstream already knew about these —
//              buildDashboardRollup() has counted them since Quick Mark could
//              record a walk-in meal — and it is what tells the form layer,
//              the importer and the roster that this row is a meal and not a
//              class.
//
//   Calendar_Source is BLANK, which is what keeps triage away from it:
//              triageDeletedSessions() only removes a row it can attribute to
//              a calendar it just read, so a session with no calendar behind it
//              is never mistaken for a deleted one. Without this the entire
//              lunch program would be swept into Deleted_Event_Triage on the
//              first sync after it was written.
//
// Everything else — the form, the date labels, the import, the counts, the
// roster, the sign-in sheet, Quick Mark — then works on it unchanged, because
// all of it is driven by session rows.
//
// ONE FORM PER LOCATION PER CALENDAR MONTH, which is what Type_Tag 'Regular'
// means everywhere else in this file. A month is the unit people think in
// ("can I sign up for October's lunches?"), and it keeps a form's date list
// short enough to read.
// ============================================================================

/** Type_Tag for the generated lunch sessions — 'Regular' = one form per calendar month. */
defineLazyGlobal_('LUNCH_ONLY_TYPE_TAG', () => EVENT_TYPES.REGULAR);

/** Group key for a lunch-only form, in the persistent groupKey -> Form_ID registry. */
function lunchOnlyGroupKey(location, monthLabel) {
  return `LUNCHONLY::${location}::${monthLabel}`;
}

/**
 * The hour a generated lunch session is dated at. Noon, so that the date reads
 * sensibly wherever a time is shown and so that a row can never land on the
 * wrong calendar day through a daylight-saving shift at midnight.
 */
const LUNCH_ONLY_SESSION_HOUR = 12;

/**
 * HOW FAR AHEAD A LUNCH SIGN-UP FORM IS BUILT — and why it is not the
 * calendar's window.
 *
 * This used to read computeSyncDateRange(), the 60-day lookahead the calendar
 * import works in, and that was wrong for a reason worth writing down: the two
 * windows are answering different questions. The calendar's window bounds how
 * far ahead we go LOOKING for events, and 60 days is generous for that,
 * because a program two months out has usually not been put on the calendar
 * yet. The menu is the opposite. It is TYPED, in blocks, by somebody working
 * ahead — and the whole reason "Build / Refresh Lunch Sign-Up Forms" is on the
 * menu at all is the moment right after a month of it has been pasted in and
 * the link is wanted NOW, for a newsletter that goes out weeks before the
 * month it is advertising.
 *
 * So the exact case the feature exists for was the case it failed: in late
 * August, a November menu is past the 60-day line, every one of its dates was
 * dropped, no form was built, no link was pinned — and the menu action said
 * "No catered dates on Lunch_Schedule in the window — add a Hot or Cold row
 * and run this again" to somebody looking straight at the rows it could not
 * see. Nothing about that told them the rows were real and merely too far off.
 *
 * Six months is the whole of any lead time anybody types a menu on, and it is
 * still bounded: a year pasted in one go builds six months of forms, not
 * twelve, and the six it will not build are REPORTED (see the digest note in
 * syncLunchOnlySessions()) rather than silently dropped as they were before.
 */
const LUNCH_SIGNUP_LOOKAHEAD_MONTHS = 6;

/**
 * The window the lunch-only sync works in: from the first of this month to the
 * last day of the month LUNCH_SIGNUP_LOOKAHEAD_MONTHS after it.
 *
 * Whole months on both ends on purpose — a form covers a calendar month, so a
 * horizon that fell mid-month would build a form offering the first half of
 * March and silently omit the rest.
 */
function computeLunchSignUpDateRange() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
  const end = new Date(today.getFullYear(), today.getMonth() + LUNCH_SIGNUP_LOOKAHEAD_MONTHS + 1, 0, 23, 59, 59);
  return { start, end };
}

/**
 * What the last syncLunchOnlySessions() in this execution actually did.
 *
 * Read by refreshLunchSignUpForms() so the toast can say which of the several
 * quite different reasons for "no links" it is looking at. They used to be one
 * sentence — "no catered dates on Lunch_Schedule" — which is a true statement
 * about only one of them and a misleading one about the other three, and the
 * misleading readings are the ones somebody is standing there needing an
 * answer to.
 */
let __lastLunchSignUpRun = null;

/**
 * The last run's counts, or a zeroed set when nothing has run in this
 * execution. Every reader goes through this rather than the variable, so
 * "no run yet" is one shape rather than a null check at each call site.
 */
function getLastLunchSignUpRunStats() {
  return __lastLunchSignUpRun || blankLunchSignUpRunStats();
}

function blankLunchSignUpRunStats() {
  return {
    cateredRows: 0,      // Hot/Cold rows on the tab at a catering location, whenever they fall
    upcomingDates: 0,    // ...of those, the ones inside the window (i.e. buildable)
    pastDates: 0,        // ...already gone by
    beyondHorizon: 0,    // ...further out than LUNCH_SIGNUP_LOOKAHEAD_MONTHS
    formsBuilt: 0,
    formsRefreshed: 0,
    formsUnchanged: 0,
    formsFailed: 0
  };
}

/**
 * Builds (or brings up to date) the lunch-only sign-up form for every location
 * that is serving food in the sync window, and writes its dates onto the
 * session table.
 *
 * Returns { location: {formId, publishedUrl, editUrl, dates} } for the
 * locations that have one — which is what pins the links to the top of
 * Master_Lunch_Dashboard.
 *
 * SAFE TO RUN ON EVERY SYNC. A date already on the session table is skipped, a
 * form already built is reused and merely refreshed, and a location with no
 * catered dates left produces nothing at all rather than an empty form.
 */
function syncLunchOnlySessions(registrySheet) {
  const stats = __lastLunchSignUpRun = blankLunchSignUpRunStats();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const menuSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  if (!menuSheet) return {};

  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const menuMap = getIndexMap(HEADERS.Lunch_Schedule);
  // NOT the calendar's 60-day window — see LUNCH_SIGNUP_LOOKAHEAD_MONTHS.
  const { end } = computeLunchSignUpDateRange();
  const todayKey = formatDateKey(new Date());

  // WHICH DATES. Catered (Hot/Cold) rows only, from today forward, inside the
  // sign-up horizon (LUNCH_SIGNUP_LOOKAHEAD_MONTHS — NOT the calendar import's
  // shorter one, which is a different question) — and never at a location whose
  // Config policy is "Never", which is a standing statement that no food is
  // served there and outranks a menu row somebody typed by mistake (the same
  // rule buildDashboardRollup() applies, and it reports the contradiction).
  const wanted = {};
  /** Location -> the furthest-out catered month it has rows for past the horizon. */
  const beyondHorizonBy = {};
  readLunchScheduleRows(menuSheet).forEach(row => {
    const d = coerceDate(row[menuMap['Event_Date']]);
    const location = String(row[menuMap['Location']] || '').trim();
    const type = String(row[menuMap['Type']] || '').trim();
    if (!d || !location) return;
    if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return;
    if (getCateringPolicyForLocation(location) === CATERING_POLICIES.NEVER) return;
    stats.cateredRows++;

    // COUNTED, not just skipped. A date outside the window is the difference
    // between "there is no menu" and "there is a menu and it is further out
    // than this runs" — two states that produced the same silence, and only
    // one of which is anybody's mistake.
    const dateKey = formatDateKey(d);
    if (dateKey < todayKey) { stats.pastDates++; return; }
    if (d > end) {
      stats.beyondHorizon++;
      const label = getMonthLabel(d);
      if (!beyondHorizonBy[location] || beyondHorizonBy[location].key < formatDateKey(d)) {
        beyondHorizonBy[location] = { key: formatDateKey(d), label };
      }
      return;
    }
    stats.upcomingDates++;

    const monthLabel = getMonthLabel(d);
    const groupKey = lunchOnlyGroupKey(location, monthLabel);
    if (!wanted[groupKey]) wanted[groupKey] = { location, monthLabel, dateKeys: [] };
    if (wanted[groupKey].dateKeys.indexOf(dateKey) === -1) wanted[groupKey].dateKeys.push(dateKey);
  });

  // A DATE FLIPPED TO "Not Serving" DROPS OUT HERE, and that is how it leaves
  // the form: `wanted` is what the date labels are built from, so the next
  // refresh simply stops offering it. The session ROW stays on the dashboard —
  // deleting it would take the anchor out from under anybody already signed up
  // for that meal, who buildDashboardRollup() is meanwhile emailing somebody
  // about by name.
  //
  // THE ONE LOOSE END, and it is deliberate: a location/month whose dates ALL
  // become Not Serving disappears from this map entirely, so its form is not
  // refreshed and its link stops being pinned — but the form itself stays open
  // and still lists the dates it had. Closing it automatically would mean
  // re-opening it automatically too, and a form that opens and closes itself
  // on the strength of a menu edit is a worse failure than a stale link. Close
  // it by hand if that ever happens; see STRESS_TEST.md.

  // TYPED, REAL, AND TOO FAR OFF TO BUILD YET — and reported only where that
  // is the WHOLE of what a location has, which is the case where the silence
  // misleads. A location with October dates and March ones needs no telling:
  // it has a form, it has a pinned link, and March's will appear by itself. A
  // location whose only catered dates are past the horizon has nothing on
  // screen at all, and used to have no way to find out why.
  Object.keys(beyondHorizonBy).forEach(location => {
    const hasBuildableDates = Object.keys(wanted).some(k => wanted[k].location === location);
    if (hasBuildableDates) return;
    noteForAdmin('Lunch menu further ahead than the sign-up forms go',
      `${SHEET_NAMES.LUNCH_SCHEDULE} has catered dates for ${location} out to ${beyondHorizonBy[location].label} ` +
      `and none nearer, and that is past the ${LUNCH_SIGNUP_LOOKAHEAD_MONTHS}-month horizon the lunch sign-up ` +
      `forms are built in — so ${location} has no sign-up form or pinned link yet. The menu is fine as typed: ` +
      `nothing needs re-entering, and the form builds itself as those dates come inside the horizon.`);
  });

  // WHAT WAS PINNED BEFORE, minus the months that are actually over. Read
  // here, above the empty-`wanted` branch, because that branch needs it too.
  const previousLinks = pruneLunchOnlyFormLinks(getLunchOnlyFormLinks());

  if (Object.keys(wanted).length === 0) {
    // NOT cleared. This used to write an empty map, on the reasoning that
    // nothing catered in the window means every stored link points at a month
    // that is over — which is true only if the window is the whole story, and
    // it is not. The state this actually describes, most of the time, is
    // "next month's menu has not been typed in yet": the form for the month
    // we are IN exists, is open, and is the link somebody is being asked for
    // at the desk right now. Deleting the only record of it made the block
    // read "no catered dates yet" about a form that was taking responses, and
    // made the recovery circular — you could not get the link back until you
    // had entered the menu, and the reason you wanted the link was to know
    // which form the menu belonged to.
    //
    // So the pruning above is the whole of the rule: a month that has ENDED
    // stops being pinned; a month that has not, stays, whatever the menu
    // currently says.
    saveLunchOnlyFormLinks(previousLinks);
    return previousLinks;
  }

  const existingRows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const rowByEventId = {};
  existingRows.forEach(row => {
    const id = String(row[map['Event_ID']] || '').trim();
    if (id) rowByEventId[id] = row;
  });

  // Started from what was already pinned rather than from nothing, for the
  // reason above and for one more: `links` is what gets SAVED at the end, so a
  // location/month this run does not reach — all its dates flipped to "Not
  // Serving", its form momentarily unopenable, its menu rows deleted by
  // accident — used to be dropped from the pin silently while its form went on
  // accepting responses. That was the documented "one loose end" of this
  // function; it is not one any more. Only a month that has ended is dropped,
  // and every group this run does reach overwrites its entry below.
  const links = Object.assign({}, previousLinks);
  const newRows = [];
  // Whether any EXISTING row was re-stamped. Together with newRows.length this
  // is what decides whether the session table is rewritten at all — see the
  // render call at the end.
  let touchedExisting = 0;

  Object.keys(wanted).sort().forEach(groupKey => {
    const entry = wanted[groupKey];
    entry.dateKeys.sort();

    // The form for this location+month: whichever one its existing rows
    // already point at, else the persistent registry, else a new one. Reading
    // the rows FIRST matters — the registry is Script Properties, which a
    // workbook can lose, and the rows are the thing that outlives it.
    const eventIds = entry.dateKeys.map(k => makeLunchOnlyEventId(k, entry.location));
    let formId = '';
    let missingRows = 0;
    let formIdsSeen = 0;
    eventIds.forEach(id => {
      const row = rowByEventId[id];
      if (!row) { missingRows++; return; }
      const rowFormId = String(row[map['Form_ID']] || '').trim();
      if (!rowFormId) return;
      formIdsSeen++;
      if (!formId) formId = rowFormId;
    });
    if (!formId) formId = getPersistentFormRegistry()[groupKey] || '';

    // NOTHING TO DO THIS RUN — the common case, and worth detecting, because
    // this function runs hourly and a "refresh" is half a dozen round trips to
    // the Forms API plus a new revision on a form nobody changed. The
    // calendar-driven half of the system gets this for free (collectCalendarWork()
    // skips a group with no new dates); this is the same short-circuit.
    //
    // Everything has to line up: every date already has a row, every one of
    // those rows names the same form, and the stored link entry describes that
    // form with that many dates. Any disagreement and the refresh runs.
    const stored = previousLinks[groupKey];
    if (missingRows === 0 && formId && formIdsSeen === eventIds.length &&
      stored && stored.formId === formId && stored.dateCount === entry.dateKeys.length) {
      links[groupKey] = stored;
      stats.formsUnchanged++;
      return;
    }

    const sessions = entry.dateKeys.map(dateKey => ({
      date: lunchOnlySessionDate(dateKey),
      location: entry.location,
      // The LOCATION-scoped name, not the dated one: these sessions share a
      // form covering a whole month, and a form named after one Tuesday's
      // chicken would be wrong on every other date it carries.
      title: lunchOnlyProgramLabel(entry.location)
    }));

    // A synthetic group, shaped exactly like the ones processCalendarGroup()
    // hands the form layer — minus `sessions[].event`, which is why
    // sessionsOfGroup() has a branch for `lunchOnlySessions`.
    const group = {
      cleanTitle: lunchOnlyProgramLabel(entry.location),
      monthLabel: entry.monthLabel,
      locations: [entry.location],
      isFixed: false,
      isShared: false,
      isClub: false,
      isLunchOnly: true,
      lunchOnlySessions: sessions
    };
    const configInfo = { footerNote: buildFooterNoteForLocations(group.locations) };

    let formInfo = null;
    try {
      formInfo = formId
        ? refreshFormForNewDates(formId, group, configInfo)
        : createRegistrationForm(group, configInfo);
      if (formId) stats.formsRefreshed++; else stats.formsBuilt++;
    } catch (err) {
      stats.formsFailed++;
      if (!formId) {
        log(`⚠️ Could not build the lunch sign-up form for ${entry.location}, ${entry.monthLabel} (${err}).`);
        noteForAdmin('Lunch sign-up form could not be built',
          `${entry.location}, ${entry.monthLabel} — ${err}. Those dates have no lunch-only form, so nobody can ` +
          `sign up for a meal online at that location this month. The program forms are unaffected.`);
        return;
      }
      // A form we already had and can no longer open. Replacing it silently
      // would strand every link already handed out AND every response on it,
      // so it is reported and this month is left alone until somebody looks.
      log(`⚠️ Could not reopen lunch sign-up form ${formId} for ${entry.location}, ${entry.monthLabel} (${err}).`);
      noteForAdmin('Lunch sign-up form could not be opened',
        `${formId} (${entry.location}, ${entry.monthLabel}) — ${err}. Its dates were left as they are rather than ` +
        `being moved onto a replacement form, which would strand the responses already on it.`);
      return;
    }

    savePersistentFormRegistryEntry(groupKey, formInfo.formId);
    flushPersistentRegistries(); // see processCalendarGroup(): never leave a new form unreferenced

    links[groupKey] = {
      location: entry.location,
      monthLabel: entry.monthLabel,
      // "2026-09", taken straight off the first date this form covers — see
      // buildLunchSignUpRows() for why the label alone is not enough.
      monthKey: entry.dateKeys[0].slice(0, 7),
      formId: formInfo.formId,
      publishedUrl: formInfo.publishedUrl,
      editUrl: formInfo.editUrl,
      dateCount: entry.dateKeys.length
    };
    // SAVED AS WE GO, not only at the end. Building a month of forms is the
    // slowest thing this file does, and a run that hits the execution limit
    // half way through used to lose every pin it had earned — the FORMS
    // survived (savePersistentFormRegistryEntry() above), so the next run
    // rebuilt nothing, but the links they were built for were gone and the
    // block went back to saying there were no catered dates. One property
    // write per changed month, and only for months that changed.
    saveLunchOnlyFormLinks(links);

    entry.dateKeys.forEach((dateKey, i) => {
      const eventId = eventIds[i];
      const existing = rowByEventId[eventId];
      if (existing) {
        // Already on the table. The one thing worth re-asserting is the form
        // it points at — a month whose form was rebuilt would otherwise keep
        // sending people to the old one.
        existing[map['Form_ID']] = formInfo.formId;
        existing[map['Form_Response_Link']] = makeHyperlinkFormula(formInfo.publishedUrl, 'View Live Form');
        existing[map['Edit_Form_Link']] = makeHyperlinkFormula(formInfo.editUrl, 'Edit Form Settings');
        touchedExisting++;
        return;
      }
      newRows.push(buildLunchOnlySessionRow(headers, map, dateKey, entry.location, formInfo));
    });
  });

  // ONLY WHEN SOMETHING ACTUALLY MOVED. This runs hourly, and a dashboard
  // render rewrites the whole tab; on the overwhelming majority of runs every
  // month is unchanged, short-circuited above, and there is nothing to write.
  //
  // Written through the normal render rather than appended raw, so the rows
  // land in the right Upcoming/Past section and pick up the tab's formatting.
  // existingRows already carries the in-place Form_ID edits above.
  //
  // skipTriage, and it matters: this render is spreadsheet-only, and a lunch
  // pass must never be a path that can decide a program was cancelled on the
  // strength of a calendar read it did not need to make.
  if (newRows.length > 0 || touchedExisting > 0) {
    renderProgramDashboard(true, { sessionRows: existingRows.concat(newRows), skipTriage: true });
    log(`Lunch sign-up: ${newRows.length} new lunch date(s), ${touchedExisting} existing row(s) re-pointed.`);
  }

  saveLunchOnlyFormLinks(links);
  return links;
}

/** Noon on `dateKey` — see LUNCH_ONLY_SESSION_HOUR. */
function lunchOnlySessionDate(dateKey) {
  const d = parseDateKey(dateKey);
  d.setHours(LUNCH_ONLY_SESSION_HOUR, 0, 0, 0);
  return d;
}

/** One session-table row for one catered date at one location. */
function buildLunchOnlySessionRow(headers, map, dateKey, location, formInfo) {
  const row = new Array(headers.length).fill('');
  row[map['Event_Date']] = lunchOnlySessionDate(dateKey);
  row[map['Location']] = location;
  // THE ROW SAYS WHICH LUNCH IT IS. Rebuilt on every render, so a menu typed
  // or corrected later shows up here without a migration — the row's identity
  // is its Event_ID, never its name.
  row[map['Clean_Title']] = lunchOnlyRowTitle(location, dateKey);
  row[map['Type_Tag']] = LUNCH_ONLY_TYPE_TAG;
  row[map['Active_Count']] = 0;
  row[map['Form_Response_Link']] = makeHyperlinkFormula(formInfo.publishedUrl, 'View Live Form');
  row[map['Edit_Form_Link']] = makeHyperlinkFormula(formInfo.editUrl, 'Edit Form Settings');
  row[map['Form_ID']] = formInfo.formId;
  row[map['Event_ID']] = makeLunchOnlyEventId(dateKey, location);
  // BLANK ON PURPOSE, and load-bearing: it is what keeps triage off this row.
  // See the section comment above.
  row[map['Calendar_Source']] = '';
  // There is no calendar event to have synced, and claiming otherwise would
  // make the column mean two different things on two kinds of row.
  row[map['Calendar_Synced?']] = false;
  return row;
}

/**
 * Where the lunch-only form links live between syncs, so the lunch dashboard
 * can pin them without rebuilding every form to find out what they are.
 *
 * Keyed by lunchOnlyGroupKey() — one entry per location per month, the same
 * unit a form covers. That is also what lets syncLunchOnlySessions() carry an
 * unchanged month forward without touching its form at all.
 *
 * In Script Properties rather than on a tab because they are derived state
 * with exactly one reader, and a tab would be one more thing a person could
 * edit into disagreeing with the forms it names.
 */
const LUNCH_ONLY_LINKS_PROP_KEY = 'LUNCH_ONLY_FORM_LINKS_V1';

function saveLunchOnlyFormLinks(links) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty(LUNCH_ONLY_LINKS_PROP_KEY, JSON.stringify(links || {}));
  } catch (err) {
    log(`ℹ️ Could not store the lunch sign-up form links (${err}) — the dashboard will show them next sync.`);
  }
}

/**
 * The stored pins, minus every month that has ENDED — the one condition under
 * which a lunch sign-up link stops being worth showing.
 *
 * Deliberately not "minus every month with no catered date in the sync
 * window": those are different statements, and conflating them is what made
 * the block go blank in the gap between one month's menu running out and the
 * next one being typed in. An entry with no monthKey (written by a version
 * before that was stored) is KEPT — it cannot be judged, and dropping what you
 * cannot judge is how a link disappears for no reason anybody can reconstruct.
 */
function pruneLunchOnlyFormLinks(links) {
  const thisMonthKey = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM');
  const kept = {};
  Object.keys(links || {}).forEach(groupKey => {
    const entry = links[groupKey] || {};
    if (!entry.publishedUrl) return;
    const monthKey = String(entry.monthKey || '').trim();
    if (monthKey && monthKey < thisMonthKey) return;
    kept[groupKey] = entry;
  });
  return kept;
}

function getLunchOnlyFormLinks() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(LUNCH_ONLY_LINKS_PROP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    log(`ℹ️ Could not read the lunch sign-up form links (${err}).`);
    return {};
  }
}


/**
 * THE FOUR KINDS OF TAB, in the order they are worth looking at, and the
 * colour each one's tab is painted.
 *
 * TWELVE TABS IS A LOT TO MEET AT ONCE, and until now they arrived as an
 * undifferentiated row along the bottom of the window: a tab rebuilt from
 * scratch every hour sat next to one nobody may type in next to one that is
 * pure settings, all in the same grey. "Which of these matter today?" and
 * "may I type in this one?" are the two questions somebody new asks, and the
 * workbook answered neither.
 *
 * Colour answers the first. The second is answered where it has to be —
 * on the cells, in yellow, at the moment of typing (see MANUAL_ENTRY_PREFIX
 * and applyLunchRosterFormatting()) — because a tab colour cannot say "these
 * four columns, but not those".
 *
 *   TODAY    green   what a serving day is run from. Open these.
 *   SET UP   blue    what you fill in ahead of time: the menu, the settings,
 *                    the extra questions a form should ask.
 *   LISTS    yellow  standing lists that outlive any one session — who the
 *                    members are, who is in which club, who is waiting for an
 *                    appointment.
 *   ARCHIVE  grey    where things go when they stop being current.
 */
defineLazyGlobal_('TAB_GROUPS', () => ([
  { color: PALETTE.TAB_TODAY, names: [
    SHEET_NAMES.PROGRAM_DASHBOARD,
    // Immediately after the tab it is a view of, and after rather than before
    // it: the session table is the one staff open every morning, and a derived
    // summary does not get to be the first thing in the workbook.
    SHEET_NAMES.PROGRAM_MONTH,
    SHEET_NAMES.LUNCH_DASHBOARD,
    SHEET_NAMES.LUNCH_ROSTER,
    SHEET_NAMES.REGISTRANT_DASH
  ] },
  { color: PALETTE.TAB_SETUP, names: [
    SHEET_NAMES.LUNCH_SCHEDULE,
    SHEET_NAMES.CONFIG,
    SHEET_NAMES.PROGRAM_QUESTIONS
  ] },
  { color: PALETTE.TAB_LISTS, names: [
    SHEET_NAMES.MEMBER_ROLL,
    SHEET_NAMES.CLUB_MEMBERS,
    SHEET_NAMES.REGULAR_NEEDS,
    SHEET_NAMES.PROGRAM_SETTINGS,
    // Beside Program_Settings, which is the tab it was carved out of and the
    // one somebody is already on when they go looking for who leads a class.
    SHEET_NAMES.PROGRAM_LEADERS,
    SHEET_NAMES.ASSISTANCE_REQUESTS
  ] },
  { color: PALETTE.TAB_ARCHIVE, names: [
    SHEET_NAMES.TRIAGE,
    // The record of months that are over, which is the archive shelf even
    // though nothing was moved there — see 83_monthly_metrics.gs.
    SHEET_NAMES.METRICS
  ] }
]));

// ----------------------------------------------------------------------------
// 2a-ii. SAVED TAB ORDER  ("these tabs, in THIS order, always")
// ----------------------------------------------------------------------------
//
// TAB_GROUPS above is this system's opinion about which tabs matter most, and
// for a workbook nobody has opinions about yet it is the right one. It is not
// the right one forever: the person who runs a serving day wants the two tabs
// they touch every morning first, and which two those are depends on the
// office rather than on the software.
//
// Dragging a tab works — until the next layout rebuild, which walks TAB_GROUPS
// and puts everything back. That is the same trap saved column widths were dug
// out of (section 2a-i), and it gets the same answer: the arrangement somebody
// made by hand can be PROMOTED INTO THE DEFAULT. Drag the tabs into the order
// you want, press the menu item, and every rebuild from then on honours it.
//
// SAVED AS A LIST OF NAMES, not positions: a tab that does not exist in this
// workbook is skipped rather than leaving a hole, and a tab this version does
// not know about yet keeps its place at the end instead of being shuffled
// somewhere arbitrary.
//
// COLOURS ARE NOT PART OF IT. A tab's colour says what KIND of tab it is
// (TODAY / SET UP / LISTS / ARCHIVE) and that does not change because somebody
// moved it — so the group colours are applied either way, from the same
// TAB_GROUPS list as before.
// ----------------------------------------------------------------------------

const TAB_ORDER_PROP_KEY = 'SHEET_TAB_ORDER_V1';

/** The saved tab order, or [] when nobody has saved one. */
function readSavedTabOrder() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(TAB_ORDER_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.map(n => String(n || '')).filter(Boolean) : [];
  } catch (err) {
    log(`ℹ️ Could not read the saved tab order (${err}) — using the built-in one.`);
    return [];
  }
}

function writeSavedTabOrder(names) {
  const list = (names || []).map(n => String(n || '')).filter(Boolean);
  if (list.length === 0) {
    PropertiesService.getScriptProperties().deleteProperty(TAB_ORDER_PROP_KEY);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(TAB_ORDER_PROP_KEY, JSON.stringify(list));
}

/** Every tab name TAB_GROUPS positions, in its built-in order. */
function builtInTabOrder() {
  return TAB_GROUPS.reduce((names, group) => names.concat(group.names), []).filter(Boolean);
}

/**
 * The order reorderTabs() should actually apply: the saved one when there is
 * one, with any tab it does not mention appended in the built-in order.
 *
 * The append is what keeps an order saved today from stranding a tab a later
 * version introduces — it lands at the end, visible, rather than wherever the
 * spreadsheet happened to leave it.
 */
function resolveTabOrder() {
  const saved = readSavedTabOrder();
  if (saved.length === 0) return builtInTabOrder();
  return dedupePreservingOrder(saved.concat(builtInTabOrder()));
}

/** { tabName: colour } from TAB_GROUPS — the colour is a fact about the tab, not about where it sits. */
function tabColorsByName() {
  const colors = {};
  TAB_GROUPS.forEach(group => group.names.forEach(name => { colors[name] = group.color; }));
  return colors;
}

function reorderTabs(ss) {
  const colors = tabColorsByName();
  let position = 0;
  resolveTabOrder().forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    position++;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(position);
    if (!colors[name]) return;
    // Never fatal: a tab colour is the last thing worth failing a layout
    // rebuild over.
    try {
      sheet.setTabColor(colors[name]);
    } catch (err) {
      log(`Could not colour the "${name}" tab (${err}).`);
    }
  });
}

/**
 * MENU ACTION: remember the tabs exactly as they sit right now.
 *
 * Every tab is recorded, hidden ones included — hiding is a separate decision
 * and one this never touches, but a hidden tab still has a position and would
 * otherwise be the one thing the next rebuild moved.
 */
function saveCurrentTabOrder() {
  if (!requireAuthorizedAdmin('Save Tab Order')) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = ss.getSheets().map(sheet => sheet.getName());
  writeSavedTabOrder(names);
  const message = `Tab order saved ✅ — these ${names.length} tabs stay in this order from now on. ` +
    `Drag them and press this again to change it.`;
  toastIfPossible(message);
  log(`saveCurrentTabOrder: ${names.join(' | ')}`);
  return names.length;
}

/** MENU ACTION: forget it, and go back to the order this system ships with. */
function clearSavedTabOrder() {
  if (!requireAuthorizedAdmin('Reset Tab Order')) return false;
  const had = readSavedTabOrder().length > 0;
  writeSavedTabOrder([]);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Applied straight away rather than waiting for the next rebuild: somebody
  // who pressed this wants to see the built-in order, now.
  reorderTabs(ss);
  const message = had
    ? 'Saved tab order forgotten ✅ — the tabs are back in their built-in order.'
    : 'There was no saved tab order — the tabs were already in their built-in order.';
  toastIfPossible(message);
  log(`clearSavedTabOrder: ${message}`);
  return had;
}

function initPlaceholderSheet(ss, tabName, message) {
  const sheet = getOrCreateSheet(ss, tabName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1).setValue(message).setFontStyle('italic').setFontColor(TYPO.MUTED.color);
  }
  autosizeColumns(sheet);
}

function setHeadersIfNeeded(sheet, headers) {
  const existing = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || 1)).getValues()[0];
  const needsWrite = headers.some((h, i) => String(existing[i] || '').trim() !== h);
  if (needsWrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    invalidateSectionedRowsCache(sheet);
    log(`Headers written on "${sheet.getName()}"`);
  }
}

function styleHeaderRow(sheet, numCols) {
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight('bold')
    .setBackground(TYPO.COLUMN_HEADER.background)
    .setFontColor(TYPO.COLUMN_HEADER.color)
    .setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/**
 * ONE type scale for the whole workbook. Every tab draws from this, so a
 * "banner" looks like a banner everywhere and the eye learns the hierarchy
 * once: big left-aligned blue banner = a section starts here; dark bold row =
 * these are the columns; plain = data.
 *
 * Sizes, not just weights, do the work — bold-on-bold reads as noise, whereas
 * a genuine size step is legible at a glance from across a desk, which is how
 * this workbook actually gets used on a serving day.
 */
defineLazyGlobal_('TYPO', () => ({
  BANNER:        { size: 13, weight: 'bold', color: PALETTE.PAPER, background: PALETTE.BANNER_BG },
  BANNER_HERO:   { size: 18, weight: 'bold', color: PALETTE.PAPER, background: PALETTE.BANNER_HERO_BG },
  // 11, not 10. The column headers are the one row on a twenty-column tab that
  // says what anything is, and they were set a full step below the data they
  // label — the smallest type in the workbook doing its most load-bearing job.
  COLUMN_HEADER: { size: 11, weight: 'bold', color: PALETTE.PAPER, background: PALETTE.HEADER_BG },
  HERO_VALUE:    { size: 16, weight: 'bold', color: PALETTE.INK_STRONG },
  HERO_LABEL:    { size: 11, weight: 'bold', color: PALETTE.HEADER_BG },
  // One step below HERO_VALUE, and the step exists because the two numbers are
  // read from different distances. The Today block is read standing up, on the
  // way past, and earns 16pt. The metrics block underneath it is read sitting
  // down, a dozen numbers at a time, when somebody is asking how the month is
  // going — at 16pt that many figures shout, and the block stops being a
  // table and becomes a wall.
  METRIC_VALUE:  { size: 12, weight: 'bold', color: PALETTE.INK_STRONG },
  // 10, not 9. Notes and "no rows yet" lines are read by people at a sign-in
  // desk, often standing; 9px grey-on-white is where legibility gave out.
  MUTED:         { size: 10, weight: 'normal', color: PALETTE.INK_MUTED }
}));

/**
 * Row heights that go with the scale above.
 *
 * DATA is the one that matters most and did not exist before: every data row
 * sat at Sheets' 21px default, which is tight enough that twenty columns of
 * text form an unbroken block with no vertical rhythm to follow across. 24 is
 * one comfortable step — about 12% more air per row, enough to track a row
 * across a wide tab without doubling the rows a screen loses.
 */
const ROW_HEIGHTS = {
  BANNER: 30,
  BANNER_HERO: 42,
  HERO_DATA: 34,
  DATA: 24,
  /**
   * Sheets' own default. Named because a render has to be able to put a row
   * BACK to it — see resetRowHeights().
   */
  DEFAULT: 21
};

/**
 * Writes a section banner at an arbitrary row: text in column A, the banner
 * color across the full width of the table.
 *
 * LEFT-ALIGNED, deliberately: centering put the text in the middle of a very
 * wide strip, nowhere near the column-A edge the eye scans down. Left-aligned,
 * every banner starts on the same vertical line as the data beneath it and the
 * tab reads as a stack of labelled blocks.
 *
 * NOT MERGED, and that matters. It used to merge across the table, which is
 * incompatible with freezing columns — Sheets refuses with "you can't freeze
 * columns which contain only part of a merged cell", and since every tab has
 * these banners, one merged banner blocked setFrozenColumns() on the whole tab
 * (this took out initSheet() entirely). Once the text is left-aligned the merge
 * buys nothing: OVERFLOW lets it spill across the empty cells to its right and
 * it looks identical.
 *
 * breakApart() is still called, on the full row width, to undo merges left
 * behind by earlier versions of this function.
 *
 * `hero` gives the one banner per tab that should dominate (Today's Lunch
 * Needs, Today at Each Location) a larger size, deeper blue and a taller row.
 *
 * `note` is where the EXPLANATION goes. These banners had grown into
 * paragraphs — a label, then a dash, then two lines telling you what the
 * section is for, why some rows are hidden and which menu item brings them
 * back. In a blue strip across twenty columns that is not a heading any more;
 * it is a wall of text over every table on the tab, and the one word a person
 * was actually looking for is buried in the middle of it. So the banner says
 * what the section IS, in a few words, and everything that explains it becomes
 * a cell note: still there, one hover away, on exactly the cell it is about.
 */
function writeSectionBanner(sheet, row, numCols, text, options) {
  options = options || {};
  const style = options.hero ? TYPO.BANNER_HERO : TYPO.BANNER;

  // Full row width, not just numCols: an older render may have merged wider.
  try {
    sheet.getRange(row, 1, 1, Math.max(sheet.getMaxColumns(), numCols)).breakApart();
  } catch (err) { /* nothing merged here */ }

  sheet.getRange(row, 1, 1, numCols)
    .setFontSize(style.size)
    .setFontWeight(style.weight)
    .setFontColor(style.color)
    .setBackground(style.background)
    .setVerticalAlignment('middle');

  sheet.getRange(row, 1)
    .setValue(text)
    .setHorizontalAlignment('left')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW)
    // Always set, blank included: a note left behind by an earlier render (or
    // by an earlier version of this function, which put all of this in the
    // banner text) has to be cleared rather than inherited.
    .setNote(options.note || '');

  try {
    sheet.setRowHeight(row, options.hero ? ROW_HEIGHTS.BANNER_HERO : ROW_HEIGHTS.BANNER);
  } catch (err) { /* row may not exist yet on a brand-new sheet */ }
}

/**
 * Freezes rows 1..`row` — the header row of the table that IS the tab, so the
 * column names stay on screen however far down somebody scrolls.
 *
 * "The table that is the tab" is the rule, and it is not always the topmost
 * table: All_Program_Sessions opens with a Today block and a metrics
 * block, and freezing at those left the session table's headers — the thing
 * five hundred rows are read against — scrolling away with everything else.
 * Whatever a tab puts above its main table comes along in the frozen band.
 *
 * TOLERATES FAILURE, exactly like freezeColumnsSafely(). Sheets refuses to
 * freeze more rows than the grid has room to show, and a tab whose main table
 * starts unusually far down is a lost nicety, not a lost render.
 */
function freezeRowsSafely(sheet, row) {
  if (!row || row < 1) return false;
  try {
    sheet.setFrozenRows(row);
    return true;
  } catch (err) {
    log(`ℹ️ Could not freeze ${row} row(s) on "${sheet.getName()}" (${err}) — everything else rendered normally.`);
    return false;
  }
}

/**
 * Freezes `count` columns, tolerating failure.
 *
 * Sheets refuses to freeze columns that would cut a merged cell in half, and a
 * merge can arrive from anywhere — an old render, or someone merging a few
 * cells by hand. A frozen column is a nicety; losing the entire render over one
 * is not a trade worth making, so this reports and carries on.
 */
function freezeColumnsSafely(sheet, count) {
  if (!count || count < 1) return false;
  try {
    sheet.setFrozenColumns(count);
    return true;
  } catch (err) {
    log(`ℹ️ Could not freeze ${count} column(s) on "${sheet.getName()}" (${err}) — ` +
      `usually a merged cell spanning the freeze line. Everything else rendered normally.`);
    return false;
  }
}

/** Writes a bold, dark header row of the given headers at an arbitrary row. */
function writeSectionHeader(sheet, row, numCols, headerValues) {
  // The marker row every sectioned read finds its sub-tables by. Moving,
  // adding or renaming one changes which rows come back and in what column
  // order, so no cached read of this tab survives it.
  invalidateSectionedRowsCache(sheet);
  sheet.getRange(row, 1, 1, numCols).setValues([headerValues])
    .setFontSize(TYPO.COLUMN_HEADER.size)
    .setFontWeight(TYPO.COLUMN_HEADER.weight)
    .setBackground(TYPO.COLUMN_HEADER.background)
    .setFontColor(TYPO.COLUMN_HEADER.color)
    .setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/** Manual alternating white/light-gray fill — safe to be overwritten later. */
function applyZebraStripingManual(sheet, numDataRows) {
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS[sheet.getName()] ? HEADERS[sheet.getName()].length : 1);
  applyZebraStripingManualBounded(sheet, 2, numDataRows, lastCol);
}

/** Same idea, but for an exact row range/column count. */
function applyZebraStripingManualBounded(sheet, startRow, numRows, numCols) {
  if (numRows < 1 || numCols < 1) return;
  const backgrounds = [];
  for (let r = 0; r < numRows; r++) {
    backgrounds.push(new Array(numCols).fill(r % 2 === 0 ? PALETTE.PAPER : PALETTE.STRIPE));
  }
  sheet.getRange(startRow, 1, numRows, numCols).setBackgrounds(backgrounds);
}

/** Native row banding for tabs that are a single flat table with nothing else competing for background color. */
function applyZebraStripingBanding(sheet, startRow) {
  startRow = startRow || 2;
  sheet.getBandings().forEach(b => b.remove());
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const numRows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
  const range = sheet.getRange(startRow, 1, numRows, lastCol);
  const banding = range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  banding.setFirstRowColor(PALETTE.PAPER);
  // The same stripe the manual striper uses, so a flat tab and a sectioned one
  // band identically — they sit next to each other in the tab strip.
  banding.setSecondRowColor(PALETTE.STRIPE);
}

/**
 * Widens the grid when a layout needs a column the sheet does not have.
 *
 * A tab's column count is not decorative: getRange(1, 27, 1, 5) on a sheet
 * with 26 columns THROWS rather than growing it, and a default Google Sheet
 * has exactly 26. So a layout that grows past whatever the tab was created
 * with — Config's did, when the Admin Notification Emails table landed past
 * the columns every earlier version ended at — has to ask for the room before
 * it writes into it.
 *
 * Never narrows: a tab somebody has widened by hand keeps its columns, and
 * this is a no-op on every tab that already has the room, which is all of them
 * after the first run.
 */
function ensureSheetColumns(sheet, neededCols) {
  const have = sheet.getMaxColumns();
  if (!neededCols || neededCols <= have) return have;
  sheet.insertColumnsAfter(have, neededCols - have);
  log(`Widened "${sheet.getName()}" from ${have} to ${neededCols} columns to fit its layout.`);
  return neededCols;
}

/**
 * Resizes columns to fit their content via a single whole-sheet call.
 * options.minCols guarantees columns are considered even if
 * sheet.getLastColumn() hasn't caught up yet this execution. options.force
 * additionally clears any lingering WRAP strategy first (wrapped cells
 * report a fixed/incorrect content width and block autosize).
 */
function autosizeColumns(sheet, options) {
  options = options || {};
  const force = !!options.force;
  const lastCol = Math.max(sheet.getLastColumn(), options.minCols || 0);
  if (lastCol < 1) return;

  try {
    if (force) {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      sheet.getRange(1, 1, lastRow, lastCol).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
    sheet.autoResizeColumns(1, lastCol);
    applyColumnWidthBuffer(sheet, lastCol);
    // LAST, so a width somebody set by hand and saved beats the fitted one.
    // Free on a tab with no saved widths, which is most of them — see
    // applySavedColumnWidths().
    applySavedColumnWidths(sheet, lastCol);
  } catch (err) {
    log(`autosizeColumns skipped on "${sheet.getName()}": ${err}`);
  }
}

/**
 * Pads already-autofitted columns out to COLUMN_WIDTH_BUFFER_MULTIPLIER of
 * their fitted width, clamped to [MIN_COLUMN_WIDTH_PX, MAX_COLUMN_WIDTH_PX].
 * Assumes the caller just ran autoResizeColumns() — it reads the fitted
 * widths rather than re-fitting.
 *
 * On call counts, since this runs on every render of every tab: the fit is
 * ONE batched autoResizeColumns() (not one autoResizeColumn() per column),
 * and while the N getColumnWidth() reads are unavoidable — SpreadsheetApp
 * has no batch width read — the WRITES are grouped. Consecutive columns
 * landing on the same target width go out as a single setColumnWidths()
 * run, and after clamping that happens a lot: every column pinned to the
 * cap collapses into one call, as does every run of similar short columns.
 */
function applyColumnWidthBuffer(sheet, lastCol) {
  const targets = [];
  for (let col = 1; col <= lastCol; col++) {
    const padded = Math.round(sheet.getColumnWidth(col) * COLUMN_WIDTH_BUFFER_MULTIPLIER);
    targets.push(Math.max(MIN_COLUMN_WIDTH_PX, Math.min(padded, MAX_COLUMN_WIDTH_PX)));
  }

  let runStart = 0;
  for (let i = 1; i <= targets.length; i++) {
    if (i < targets.length && targets[i] === targets[runStart]) continue;
    sheet.setColumnWidths(runStart + 1, i - runStart, targets[runStart]);
    runStart = i;
  }
}

/**
 * One-shot padded autofit across EVERY sheet in the workbook. Exposed on
 * the menu ("Resize All Sheets") and safe to run any time — it only ever
 * sets column widths, so there's no data, formatting, or form state to
 * lose. Use it after tuning the width constants above, or to fix up a tab
 * that predates them.
 *
 * Deliberately NOT called from any render path: each render already
 * autosizes the single tab it just rewrote, which is strictly cheaper than
 * re-walking the workbook, and doing both would size every sheet twice.
 */
function resizeAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  sheets.forEach(sheet => autosizeColumns(sheet, { force: true }));
  log(`resizeAllSheets: padded autofit applied to ${sheets.length} sheet(s).`);
  ss.toast(`Resized ${sheets.length} sheet(s) ✅`, 'Calendar & Form Manager', 5);
}


