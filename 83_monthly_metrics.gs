// ============================================================================
// 83 — MONTHLY METRICS, AND THE YEAR-OVER-YEAR SUMMARY BUILT ON THEM
// ============================================================================
//
// The dashboard already answers "how is this month going": 43's metrics block
// puts this month so far against the same span of last month, and the next
// seven and thirty days beside it. What it cannot answer — structurally, not
// for want of a column — is "how does this September compare to last
// September".
//
// TWO REASONS IT CANNOT, and the second is the one that decides the design:
//
//   1. A month-over-month comparison is noise at this scale. A holiday week, a
//      snow day, or one program moving from the 28th to the 2nd swings every
//      number in it. A year apart, the same season is being compared with the
//      same season.
//
//   2. THE ROWS DO NOT LAST A YEAR. Past months are collapsed out of view
//      (collapseOldPastMonths), old tabs get archived, and registrations get
//      deleted deliberately. Any comparison computed live from All_Registrants
//      has a baseline that quietly empties out — and a year-ago month that has
//      been archived would report as a collapse in attendance that never
//      happened. That is not a stale number; it is a confident wrong one.
//
// So a month is COUNTED ONCE AND WRITTEN DOWN. The Metrics tab holds one row
// per calendar month (HEADERS.Metrics), and the year-over-year block at the
// top of that tab is built from those stored rows, never from the registrant
// tab. What a stored row says about March 2025 stays true after March 2025's
// rows are gone.
//
// WHAT RECOUNTS AND WHAT DOES NOT:
//
//   • The monthly trigger (captureMonthlyMetricsTrigger) recounts the month
//     just ended and the one running, and leaves every other row alone.
//   • The menu item (refreshMetricsTabNow) recounts every month the workbook
//     still holds rows for — the repair path for a month captured while the
//     data was mid-import.
//   • A month whose source rows are gone is never recounted and never zeroed.
//     Its stored numbers are the only record left of it, and overwriting them
//     with a count of nothing is the one thing this tab must not do.
//
// Everything here counts off the SAME two tabs the dashboard does, through the
// same readers, so a number here and a number there cannot disagree about what
// a registration is.

/**
 * How many months back the menu item will recount.
 *
 * A cap rather than "everything on the tab" because a recount reads every
 * registrant row for the month and a workbook that has been running for six
 * years has nothing to gain from re-deriving 2021 — its rows are long gone, so
 * the recount would find nothing and (correctly) refuse to write. Three years
 * is comfortably more history than the archive holds.
 */
const METRICS_RECOUNT_MONTHS = 36;

/** 'YYYY-MM' for a year and a 0-based month, normalized through Date so a month of -1 rolls back a year. */
function metricsMonthKeyFromParts(year, monthIndex) {
  return formatMonthKey(new Date(year, monthIndex, 1));
}

/** The first day of the month a 'YYYY-MM' key names. */
function metricsMonthStart(monthKey) {
  const parts = String(monthKey || '').split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
}

/** "September 2025" — the month key spelled for a person. */
function metricsMonthLabel(monthKey) {
  return Utilities.formatDate(metricsMonthStart(monthKey), TIMEZONE, 'MMMM yyyy');
}

/** The month key `months` before (or after, for a positive number) the one given. */
function metricsShiftMonthKey(monthKey, months) {
  const start = metricsMonthStart(monthKey);
  return metricsMonthKeyFromParts(start.getFullYear(), start.getMonth() + months);
}

/**
 * A stored rate cell (a fraction, 0.63) as percentage POINTS (63).
 *
 * The tab holds fractions because that is what a '0%' number format wants and
 * what every other percentage cell in this workbook holds. A comparison wants
 * points, because sixty-three up from fifty-eight is five POINTS and calling
 * it eight percent is how a modest year gets reported as a triumph — see
 * formatMetricChange().
 */
function metricsRateToPoints(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return isFinite(number) ? Math.round(number * 100) : null;
}

// ----------------------------------------------------------------------------
// COUNTING A MONTH
// ----------------------------------------------------------------------------

/**
 * Both source tabs, read once, with their header maps.
 *
 * Read through the sectioned readers rather than getDataRange() because these
 * tabs are split into Upcoming and Past bands with a second header row in the
 * middle — see 34_sectioned_tables.gs. A plain read would take that header row
 * for a session called "Event_Date".
 *
 * THE HEADER KEY IS `All_Program_Sessions`, NOT `Master_Program_Dashboard`.
 * The session ledger gave that name up to the program-month tab (see
 * SHEET_NAMES in 03), and HEADERS was re-keyed with it — so the old spelling
 * still resolves, to the month tab's columns, and would hand this file a map
 * with no Event_ID in it and a silently empty count of every month.
 */
function collectMetricsSourceRows(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sessionSheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  return {
    sessionRows: sessionSheet
      ? readAllSectionedRowValues(sessionSheet, HEADERS.All_Program_Sessions, 'Event_ID') : [],
    sessionMap: getIndexMap(HEADERS.All_Program_Sessions),
    registrantRows: registrantSheet
      ? readAllSectionedRowValues(registrantSheet, HEADERS.All_Registrants, 'Event_ID') : [],
    registrantMap: getIndexMap(HEADERS.All_Registrants),
    // The volunteer visits, parsed once for the whole capture rather than per
    // month (99e). A workbook with no volunteer tab reads as an empty list,
    // which is what makes the three columns below zero rather than absent.
    volunteerVisits: readVolunteerVisits(),
    // The private sessions (99zi), parsed once like the volunteer visits.
    privateSessions: readPrivateSessions(),
    // The kitchen's own record, typed into Actual_Ordered day by day. Read
    // fresh (no execution cache) for the reason 44's read is: it is the one
    // column a person types and nothing recomputes.
    lunchDashboardRows: (() => {
      const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_DASHBOARD);
      return sheet
        ? readAllSectionedRowValues(sheet, HEADERS.Master_Lunch_Dashboard, 'Standard_Buffer') : [];
    })(),
    lunchDashboardMap: getIndexMap(HEADERS.Master_Lunch_Dashboard),
    // The roll of people (79), for the three Roll_ columns. Read off the sheet
    // if it exists rather than through readMemberRollRows(), which would CREATE
    // the tab; a roll that will not read leaves those columns blank rather than
    // costing the capture.
    memberRows: (() => {
      try {
        const sheet = ss.getSheetByName(SHEET_NAMES.MEMBER_ROLL);
        return sheet ? readSimpleTableValues(sheet, HEADERS.Member_Roll) : null;
      } catch (err) {
        log(`ℹ️ Metrics: could not read ${SHEET_NAMES.MEMBER_ROLL} (${err}) — the roll columns are left blank.`);
        return null;
      }
    })(),
    memberMap: getIndexMap(HEADERS.Member_Roll)
  };
}

/**
 * What the kitchen was asked for in one month: Actual_Ordered summed over
 * every date x building row of Master_Lunch_Dashboard dated in it.
 *
 * ONLY TYPED CELLS COUNT. A blank Actual_Ordered is "nobody has written the
 * order down yet", not zero meals, so it adds nothing and is not a day — and
 * Total_to_Order is never used in its place, because that is the plan and an
 * invoice is checked against what actually happened. `days` is how many rows
 * did carry a number, which is what tells somebody comparing against the
 * caterer whether the total is complete. Both are '' when no day in the month
 * has one, so a month before this column was kept reads as unrecorded rather
 * than as a month of no lunches.
 */
function kitchenOrdersForMonth(monthKey, rows, map) {
  let total = 0;
  let days = 0;
  const byLocation = {};
  (rows || []).forEach(row => {
    const when = coerceDate(row[map['Event_Date']]);
    if (!when || formatMonthKey(when) !== monthKey) return;
    const raw = row[map['Actual_Ordered']];
    if (raw === '' || raw === null || raw === undefined) return;
    const n = Number(raw);
    if (!isFinite(n)) return;
    total += n;
    days++;
    const location = String(row[map['Location']] || '').trim() || '(no building)';
    byLocation[location] = (byLocation[location] || 0) + n;
  });
  if (days === 0) return { total: '', days: '', byLocation: '' };
  return {
    total: total,
    days: days,
    byLocation: Object.keys(byLocation).sort()
      .map(loc => `${loc} ${byLocation[loc]}`).join(' · ')
  };
}

/**
 * Every month the source rows say anything about, newest first.
 *
 * Sessions AND registrants, because the two do not always cover the same
 * months: a month whose sessions have been triaged off the dashboard still has
 * registrant rows carrying their own Event_Date, and that month happened.
 */
function metricsMonthsPresent(source) {
  const months = {};
  const note = (row, map) => {
    const when = coerceDate(row[map['Event_Date']]);
    if (when) months[formatMonthKey(when)] = true;
  };
  source.sessionRows.forEach(row => note(row, source.sessionMap));
  source.registrantRows.forEach(row => note(row, source.registrantMap));
  // A month in which nobody registered for anything and two volunteers worked
  // is still a month this centre ran, and the hours are the part it is
  // credited for.
  (source.volunteerVisits || []).forEach(visit => { months[visit.monthKey] = true; });
  if (source.lunchDashboardMap) {
    (source.lunchDashboardRows || []).forEach(row => note(row, source.lunchDashboardMap));
  }
  return Object.keys(months).sort().reverse();
}

/**
 * The first month a person appears in ANYWHERE in the registrant rows, keyed by
 * normalizeNameKey().
 *
 * Built once per capture rather than per month, because "new" is a claim about
 * a person's whole history and asking it month by month would re-scan the tab
 * for every month captured.
 *
 * THE LIMIT WORTH KNOWING, and it is the same one 43's New People column
 * carries: "first seen" means "has no earlier row on All_Registrants". Once a
 * month's rows are archived out of the workbook, everybody who started in it
 * reads as new again on the NEXT recount — which is precisely why a captured
 * row is never recounted from an empty month (see captureMonthlyMetrics).
 */
function metricsFirstMonthByPerson(registrantRows, map) {
  const first = {};
  registrantRows.forEach(row => {
    const person = normalizeNameKey(row[map['Name']]);
    if (!person) return;
    const when = coerceDate(row[map['Event_Date']]);
    if (!when) return;
    const monthKey = formatMonthKey(when);
    if (!first[person] || monthKey < first[person]) first[person] = monthKey;
  });
  return first;
}

/** What a row with no Location is filed under, so it still adds up somewhere. */
const METRICS_NO_BUILDING = '(no building)';

/**
 * Keys of a counted month that are NOT stored per building: identity, the
 * capture stamp, the staff note, the per-building column itself, and the two
 * that are already a statement about buildings.
 */
const METRICS_SITE_SKIP_KEYS = ['Month', 'Month_Label', 'Locations', 'Kitchen_Ordered_By_Location',
  'Captured_On', 'Notes', 'By_Site'];

/** The building a row says it belongs to, or METRICS_NO_BUILDING. */
function metricsLocationOf_(row, map) {
  if (!map || map['Location'] === undefined) return METRICS_NO_BUILDING;
  return String(row[map['Location']] || '').trim() || METRICS_NO_BUILDING;
}

/**
 * Every building anything in `monthKey` happened at, sorted: sessions,
 * registrations, kitchen days, volunteer visits and private sessions alike, so
 * a month whose only trace at a building is its volunteers still gets that
 * building's column.
 */
function metricsSitesInMonth_(monthKey, source) {
  const sites = {};
  const scan = (rows, map) => {
    if (!map || map['Event_Date'] === undefined) return;
    (rows || []).forEach(row => {
      const when = coerceDate(row[map['Event_Date']]);
      if (when && formatMonthKey(when) === monthKey) sites[metricsLocationOf_(row, map)] = true;
    });
  };
  scan(source.sessionRows, source.sessionMap);
  scan(source.registrantRows, source.registrantMap);
  scan(source.lunchDashboardRows, source.lunchDashboardMap);
  (source.volunteerVisits || []).forEach(visit => {
    if (visit.monthKey === monthKey) sites[visit.location || METRICS_NO_BUILDING] = true;
  });
  (source.privateSessions || []).forEach(entry => {
    if (entry.monthKey === monthKey) sites[entry.location || METRICS_NO_BUILDING] = true;
  });
  return Object.keys(sites).sort();
}

/**
 * The people on the roll, reduced to what a month's roll figures need — or
 * null when the capture was given no roll at all, which reads as "not
 * measured" rather than as an empty roll.
 *
 * THIS IS THE ROLL OF PEOPLE THE CENTRE KNOWS, not a list of dues-paying
 * members: the door says outright that membership is not required to take
 * part. The workbook does not record who has paid, so nothing here claims to.
 */
function metricsRollPeople_(source) {
  if (!source.memberRows || !source.memberMap) return null;
  const map = source.memberMap;
  const people = [];
  source.memberRows.forEach(row => {
    const name = String(row[map['Name']] || '').trim();
    if (!name || name.indexOf('--- ') === 0) return;
    const first = coerceDate(row[map['First_Seen']]);
    const retired = coerceDate(row[map['Retired_Date']]);
    people.push({
      first: first ? formatDateKey(first) : '',
      retired: retired ? formatDateKey(retired) : '',
      inactive: (String(row[map['Status']] || '').trim() || 'Active') !== 'Active',
      locations: String(row[map['Locations']] || '').toLowerCase()
    });
  });
  return people;
}

/**
 * What every month's count shares, built ONCE per capture and kept on the
 * source (non-enumerable, so a copy of the source made for one building does
 * not carry it): every Active registration as a (person, date, building)
 * triple for the loyalty figures, who was there in each month, and the roll.
 */
function metricsContextFor_(source) {
  if (source.__metricsContext) return source.__metricsContext;
  const rMap = source.registrantMap;
  const activeRegs = [];
  const personsByMonthSite = {};
  (source.registrantRows || []).forEach(row => {
    if (String(row[rMap['Program_Status']] || '').trim() !== 'Active') return;
    const when = coerceDate(row[rMap['Event_Date']]);
    const person = normalizeNameKey(row[rMap['Name']]);
    if (!when || !person) return;
    const site = metricsLocationOf_(row, rMap);
    const month = formatMonthKey(when);
    activeRegs.push({ person: person, key: formatDateKey(when), site: site });
    [`${month}|*`, `${month}|${site}`].forEach(key => {
      (personsByMonthSite[key] = personsByMonthSite[key] || {})[person] = true;
    });
  });
  const context = {
    activeRegs: activeRegs,
    personsByMonthSite: personsByMonthSite,
    roll: metricsRollPeople_(source),
    siteSources: {}
  };
  Object.defineProperty(source, '__metricsContext', { value: context, enumerable: false, configurable: true });
  return context;
}

/** `source` narrowed to one building, built once per building per capture. */
function metricsSourceForSite_(source, site, context) {
  if (context.siteSources[site]) return context.siteSources[site];
  const keep = (rows, map) => (map ? (rows || []).filter(row => metricsLocationOf_(row, map) === site) : []);
  const narrowed = Object.assign({}, source, {
    sessionRows: keep(source.sessionRows, source.sessionMap),
    registrantRows: keep(source.registrantRows, source.registrantMap),
    lunchDashboardRows: keep(source.lunchDashboardRows, source.lunchDashboardMap),
    volunteerVisits: (source.volunteerVisits || []).filter(v => (v.location || METRICS_NO_BUILDING) === site),
    privateSessions: (source.privateSessions || []).filter(e => (e.location || METRICS_NO_BUILDING) === site)
  });
  context.siteSources[site] = narrowed;
  return narrowed;
}

/**
 * People who were coming and have stopped: seen in the 90 days before the
 * month ended (or before today, for a month still running) on NO day of the
 * last 90, but on some day of the 90 before that.
 *
 * Blank — not zero — when the 90 days before that hold no registrations at
 * all, because that is a workbook too young, or rows too long archived, to say.
 * A month still to come has no answer yet.
 */
function metricsLapsingPeople_(monthKey, now, context, site) {
  if (monthKey > formatMonthKey(now)) return '';
  const start = metricsMonthStart(monthKey);
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const end = monthEnd > now ? now : monthEnd;
  const endKey = formatDateKey(end);
  const recentFrom = formatDateKey(shiftDate(end, -90));
  const priorFrom = formatDateKey(shiftDate(end, -180));
  const recent = {};
  const prior = {};
  context.activeRegs.forEach(reg => {
    if (site && reg.site !== site) return;
    if (reg.key > endKey || reg.key <= priorFrom) return;
    if (reg.key > recentFrom) recent[reg.person] = true; else prior[reg.person] = true;
  });
  const before = Object.keys(prior);
  if (before.length === 0) return '';
  return before.filter(person => !recent[person]).length;
}

/**
 * The roll at the END of a month, and what happened to it during the month.
 * Blank for a month that has not finished starting, for a capture with no
 * roll, and for the "no building" bucket (a person's Locations cannot be asked
 * about a row that names none).
 *
 * A person with no First_Seen is on the roll from before it kept dates; one
 * who is not Active and has no Retired_Date is left out of EVERY month, because
 * there is nothing to say which months they were still here for.
 */
function metricsRollFigures_(monthKey, now, context, site) {
  const blank = { size: '', added: '', retired: '' };
  if (!context.roll || context.roll.length === 0) return blank;
  if (monthKey > formatMonthKey(now)) return blank;
  if (site === METRICS_NO_BUILDING) return blank;
  const start = metricsMonthStart(monthKey);
  const endKey = formatDateKey(new Date(start.getFullYear(), start.getMonth() + 1, 0));
  const siteText = site ? String(site).toLowerCase() : '';
  let size = 0;
  let added = 0;
  let retired = 0;
  context.roll.forEach(person => {
    if (siteText && person.locations.indexOf(siteText) === -1) return;
    const onRoll = (!person.first || person.first <= endKey) &&
      !(person.retired && person.retired <= endKey) && !(person.inactive && !person.retired);
    if (onRoll) size++;
    if (person.first && person.first.slice(0, 7) === monthKey) added++;
    if (person.retired && person.retired.slice(0, 7) === monthKey) retired++;
  });
  return { size: size, added: added, retired: retired };
}

/**
 * Counts one month off the source rows and returns the values for its row on
 * the Metrics tab, or null when that month has NOTHING behind it any more.
 *
 * Null rather than a row of zeros is the whole safety property of this file. A
 * month whose rows have been archived reads as zero sessions and zero people,
 * and writing that over what was captured at the time would turn a busy
 * September into a year-over-year collapse — invented, permanent, and
 * indistinguishable from a real one.
 *
 * The row is the whole centre; `By_Site` is the same count made again for each
 * building the month touched (countMetricsSlice_ over a source narrowed to it).
 * Distinct counts do not add up across buildings — somebody who came to both
 * is one participant at the centre and one at each building — and the summary
 * says so beside the numbers.
 *
 * `now` is injectable so the arithmetic can be pinned against a fixed calendar
 * in tests, the same way computeProgramMetrics() takes it.
 */
function computeMonthlyMetrics(monthKey, source, firstMonthByPerson, now) {
  now = now || new Date();
  const context = metricsContextFor_(source);
  const whole = countMetricsSlice_(monthKey, source, firstMonthByPerson, now, context, null);
  if (!whole) return null;

  const bySite = {};
  metricsSitesInMonth_(monthKey, source).forEach(site => {
    const slice = countMetricsSlice_(monthKey, metricsSourceForSite_(source, site, context),
      firstMonthByPerson, now, context, site);
    if (!slice) return;
    const values = {};
    Object.keys(slice).forEach(key => {
      if (METRICS_SITE_SKIP_KEYS.indexOf(key) !== -1) return;
      if (slice[key] === '' || slice[key] === undefined || slice[key] === null) return;
      values[key] = slice[key];
    });
    bySite[site] = values;
  });
  whole.By_Site = Object.keys(bySite).length > 0 ? JSON.stringify(bySite) : '';
  return whole;
}

/**
 * One month's numbers over `source` — the whole centre when `site` is null, or
 * one building when `source` has been narrowed to it and `site` names it.
 */
function countMetricsSlice_(monthKey, source, firstMonthByPerson, now, context, site) {
  const todayKey = formatDateKey(now);
  const sMap = source.sessionMap;
  const rMap = source.registrantMap;

  const inMonth = (row, map) => {
    const when = coerceDate(row[map['Event_Date']]);
    return when && formatMonthKey(when) === monthKey ? when : null;
  };

  // --- Sessions: what the center RAN -----------------------------------
  //
  // A lunch with no programming behind it is counted as a lunch and not as a
  // program (isLunchOnlyEventId), the same split 43 makes: thirty generated
  // meal rows would otherwise triple the session count of every month and make
  // the program mix unreadable.
  const programs = {};
  const locations = {};
  let sessions = 0;
  let registeringSessions = 0;
  let clubSessions = 0;
  let assistanceSessions = 0;
  let dropInSessions = 0;
  let lunchSessions = 0;
  let seatsOffered = 0;
  let seatsTaken = 0;
  let emptySeats = 0;
  let cappedSessions = 0;
  let sessionsFull = 0;
  let sessionsUnderHalf = 0;
  const activeByEvent = {};
  const clubEvents = {};
  const assistanceEvents = {};

  // Which sessions are a club's and which are an appointment program's, found
  // first because a registration is only known by its Event_ID.
  source.sessionRows.forEach(row => {
    if (!inMonth(row, sMap)) return;
    const eventId = row[sMap['Event_ID']];
    if (isClubColumnValue(row[sMap['Club']])) clubEvents[eventId] = true;
    if (isAssistanceColumnValue(row[sMap['Personalized_Assistance']])) assistanceEvents[eventId] = true;
  });

  // Registrations first: the seat arithmetic below needs the per-session count.
  let registrations = 0;
  let participantsSet = {};
  let newPeople = 0;
  let guests = 0;
  let waitlisted = 0;
  let cancellations = 0;
  let attended = 0;
  let pastRegistrations = 0;
  let mealsOrdered = 0;
  let mealsServed = 0;
  let mealsConsumed = 0;
  let lunchOnlySignups = 0;
  let clubRegistrations = 0;
  let assistanceRegistrations = 0;

  source.registrantRows.forEach(row => {
    const when = inMonth(row, rMap);
    if (!when) return;
    const status = String(row[rMap['Program_Status']] || '').trim();
    const eventId = row[rMap['Event_ID']];

    if (status === 'Waitlisted') { waitlisted++; return; }
    if (status === 'Cancelled' || status === 'Superseded') { cancellations++; return; }
    if (status !== 'Active') return;

    registrations++;
    if (eventId) activeByEvent[eventId] = (activeByEvent[eventId] || 0) + 1;
    if (clubEvents[eventId]) clubRegistrations++;
    if (assistanceEvents[eventId]) assistanceRegistrations++;
    if (String(row[rMap['Person_Type']] || '').trim() === 'Guest') guests++;
    if (isLunchOnlyEventId(eventId) || isLunchOnlyProgramTitle(row[rMap['Event']])) lunchOnlySignups++;

    const person = normalizeNameKey(row[rMap['Name']]);
    if (person && !participantsSet[person]) {
      participantsSet[person] = true;
      if (firstMonthByPerson[person] === monthKey) newPeople++;
    }

    // The show rate can only be asked of a session that has already happened —
    // a program later today is not a no-show, it has not started. Same rule as
    // summarizeSessionSpan(), so the two tables cannot disagree.
    if (formatDateKey(when) < todayKey) {
      pastRegistrations++;
      if (isTruthyCheckbox(row[rMap['Attended']])) attended++;
    }

    if (String(row[rMap['Lunch_Status']] || '').trim() === 'Needed') {
      mealsOrdered += readRegistrantMealsOrdered(row, rMap);
    }
    if (isTruthyCheckbox(row[rMap['Lunch_Served']])) mealsServed++;
    mealsConsumed += readRegistrantMealCounts(row, rMap).total;
  });

  source.sessionRows.forEach(row => {
    const when = inMonth(row, sMap);
    if (!when) return;
    const eventId = row[sMap['Event_ID']];

    if (isLunchOnlyEventId(eventId) || isLunchOnlyProgramTitle(row[sMap['Clean_Title']])) {
      lunchSessions++;
      return;
    }

    sessions++;
    const title = String(row[sMap['Clean_Title']] || '').trim();
    if (title) programs[title] = true;
    const location = String(row[sMap['Location']] || '').trim();
    if (location) locations[location] = true;

    if (isClubColumnValue(row[sMap['Club']])) clubSessions++;
    if (isAssistanceColumnValue(row[sMap['Personalized_Assistance']])) assistanceSessions++;
    if (!sessionTakesRegistration(row, sMap)) { dropInSessions++; return; }
    registeringSessions++;

    const active = activeByEvent[eventId] || 0;
    const cap = sessionCapacity(row, sMap);
    if (cap !== null) {
      cappedSessions++;
      seatsOffered += cap;
      seatsTaken += active;
      // Floored per session: an over-subscribed room has no seats left to
      // sell, and letting its overflow cancel out a genuinely empty room
      // somewhere else would hide both.
      emptySeats += Math.max(cap - active, 0);
      if (active >= cap) sessionsFull++;
      if (active * 2 < cap) sessionsUnderHalf++;
    }
  });

  const volunteers = volunteerMetricsForMonth(monthKey, source.volunteerVisits || []);
  const privateSessions = privateSessionMetricsForMonth(monthKey, source.privateSessions || []);
  const kitchen = kitchenOrdersForMonth(monthKey, source.lunchDashboardRows, source.lunchDashboardMap || {});

  if (sessions === 0 && lunchSessions === 0 && registrations === 0 &&
      waitlisted === 0 && cancellations === 0 && volunteers.visits === 0 && kitchen.days === '') {
    return null; // nothing left to count — see the banner above
  }

  const participants = Object.keys(participantsSet).length;
  const rate = (numerator, denominator) =>
    (denominator > 0 ? Math.round((numerator / denominator) * 100) / 100 : '');

  // Who was here last month too. Blank when last month has nobody on file
  // (its rows archived, or a first month): "nobody came back" would be a claim.
  const lastMonthPeople = context.personsByMonthSite[`${metricsShiftMonthKey(monthKey, -1)}|${site || '*'}`];
  const cameBack = lastMonthPeople
    ? Object.keys(participantsSet).filter(person => lastMonthPeople[person]).length : 0;
  const roll = metricsRollFigures_(monthKey, now, context, site);

  return {
    Month: monthKey,
    Month_Label: metricsMonthLabel(monthKey),
    Sessions: sessions,
    Programs: Object.keys(programs).length,
    Locations: Object.keys(locations).length,
    Club_Sessions: clubSessions,
    Assistance_Sessions: assistanceSessions,
    Drop_In_Sessions: dropInSessions,
    Lunch_Sessions: lunchSessions,
    Registrations: registrations,
    // Divided by the sessions that TAKE registration: a [No Registration]
    // drop-in's zero is structural, and leaving it in the divisor makes a
    // healthy month of drop-ins read as a collapse in demand.
    Avg_Per_Session: registeringSessions > 0
      ? Math.round((registrations / registeringSessions) * 10) / 10 : '',
    Participants: participants,
    New_People: newPeople,
    Guests: guests,
    Waitlisted: waitlisted,
    Cancellations: cancellations,
    Attended: attended,
    // Blank rather than 0% when nothing in the month was ticked at all. A month
    // in which not one person was marked present is overwhelmingly a desk that
    // did not tick, and 0% is a far more confident claim than that supports.
    Attendance_Rate: attended > 0 ? rate(attended, pastRegistrations) : '',
    // Blank, not zero, when no session that month had a cap. Most programs here
    // are uncapped and "0% full" would be a bare-faced lie about an open door.
    Seats_Filled_Rate: cappedSessions > 0 ? rate(seatsTaken, seatsOffered) : '',
    Empty_Seats: cappedSessions > 0 ? emptySeats : '',
    Meals_Ordered: mealsOrdered,
    Meals_Served: mealsServed,
    Meals_Consumed: mealsConsumed,
    Lunch_Only_Signups: lunchOnlySignups,
    // DISTINCT PEOPLE and VISITS as two columns, because "how many volunteers
    // do you have" and "how often did they come" are the two questions the
    // annual return asks and one number answers neither.
    Volunteers: volunteers.volunteers,
    Volunteer_Visits: volunteers.visits,
    Volunteer_Hours: volunteers.hours,
    Kitchen_Ordered: kitchen.total,
    Kitchen_Order_Days: kitchen.days,
    Kitchen_Ordered_By_Location: kitchen.byLocation,
    Private_Sessions: privateSessions.sessions,
    Private_Session_People: privateSessions.people,
    Private_Session_Hours: privateSessions.hours,
    // Of this month's participants, the share who were also here last month.
    Returning_Rate: lastMonthPeople && participants > 0 ? rate(cameBack, participants) : '',
    // Registrations per participant: how often somebody who comes, comes.
    Visits_Per_Person: participants > 0 ? Math.round((registrations / participants) * 10) / 10 : '',
    Lapsing_People: metricsLapsingPeople_(monthKey, now, context, site),
    Roll_Size: roll.size,
    Roll_Added: roll.added,
    Roll_Retired: roll.retired,
    // Blank, not zero, without a capped session — same reason as Empty_Seats.
    Sessions_Full: cappedSessions > 0 ? sessionsFull : '',
    Sessions_Under_Half: cappedSessions > 0 ? sessionsUnderHalf : '',
    // Registered, the session has happened, and nobody ticked them present —
    // only once somebody has ticked anything that month (see Attendance_Rate).
    No_Shows: attended > 0 ? pastRegistrations - attended : '',
    // People the schedule turned away, as a share of everyone who asked.
    Waitlist_Share: rate(waitlisted, registrations + waitlisted),
    Club_Registrations: clubRegistrations,
    Assistance_Registrations: assistanceRegistrations,
    Captured_On: new Date(),
    Notes: '',
    By_Site: ''
  };
}

// ----------------------------------------------------------------------------
// STORING IT
// ----------------------------------------------------------------------------

/**
 * The stored rows, oldest first, as arrays in HEADERS.Metrics order.
 *
 * FOUND BY ITS HEADER, not by a fixed row. This used readSimpleTableValues(),
 * which reads a memory tab's table from row 2 — and on this tab row 2 is blank,
 * the history sits under two summary tables and a banner. Every column then
 * projected to "not on the sheet" and the read came back EMPTY, every time, so
 * a recount merged into nothing and any month whose rows had been archived
 * (the very months this tab exists to keep) was dropped when the tab was next
 * drawn. The history is now the run of 'YYYY-MM' rows under the header row
 * whose first two cells are Month and Month_Label, and it ends at the first
 * row that is not one — which is also what keeps the by-site block drawn
 * beneath it from being read back as months.
 */
function readStoredMetricsRows(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = HEADERS.Metrics;
  const grid = sheet.getRange(1, 1, lastRow, Math.max(sheet.getLastColumn(), headers.length)).getValues();

  let headerIndex = -1;
  for (let i = 0; i < grid.length; i++) {
    if (normalizeHeaderText(grid[i][0]) === 'Month' && normalizeHeaderText(grid[i][1]) === 'Month_Label') {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return [];

  const projection = buildHeaderProjectionFromRow(grid[headerIndex], headers,
    `"${sheet.getName()}" row ${headerIndex + 1}`);
  const rows = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const raw = grid[i];
    const month = metricsMonthCellKey_(raw[0]);
    if (!month) break;
    const row = projection ? projection.map(src => (src === -1 ? '' : raw[src])) : raw.slice(0, headers.length);
    row[0] = month;
    rows.push(row);
  }
  return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/**
 * 'YYYY-MM' for a Month cell, or '' when the cell is not one. Sheets may turn
 * "2026-09" into a date on the way in; a date is read back as its month.
 */
function metricsMonthCellKey_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : formatMonthKey(value);
  }
  const text = String(value === null || value === undefined ? '' : value).trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : '';
}

/**
 * Merges freshly counted months into the stored rows.
 *
 * Two things are deliberately CARRIED rather than overwritten:
 *
 *   Notes — the one staff-owned column. Somebody typed "closed for
 *   renovations" against March; a recount must not eat it.
 *
 *   A month that recounted to null — its rows are gone, so what is stored is
 *   the only record of it. See computeMonthlyMetrics().
 */
function mergeMetricsRows(storedRows, counted) {
  const headers = HEADERS.Metrics;
  const map = getIndexMap(headers);
  const byMonth = {};
  storedRows.forEach(row => { byMonth[String(row[map['Month']]).trim()] = row; });

  counted.forEach(metrics => {
    if (!metrics) return;
    const existing = byMonth[metrics.Month];
    const note = existing ? existing[map['Notes']] : '';
    byMonth[metrics.Month] = headers.map(header =>
      (header === 'Notes' ? (note || '') : metrics[header]));
  });

  return Object.keys(byMonth).sort().map(key => byMonth[key]);
}

/**
 * Counts the months asked for, merges them into the tab, and redraws it.
 *
 * `options.months` is a list of 'YYYY-MM' keys; omitted, it counts every month
 * the workbook still holds rows for, back to METRICS_RECOUNT_MONTHS.
 * Returns { captured, skipped, rows } — `skipped` being months that were asked
 * for and had nothing left behind them.
 */
function captureMonthlyMetrics(options) {
  options = options || {};
  const now = options.now || new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = options.source || collectMetricsSourceRows(ss);
  const firstMonthByPerson = metricsFirstMonthByPerson(source.registrantRows, source.registrantMap);

  const oldestAllowed = metricsMonthKeyFromParts(now.getFullYear(), now.getMonth() - METRICS_RECOUNT_MONTHS);
  const wanted = (options.months || metricsMonthsPresent(source)).filter(key => key >= oldestAllowed);

  const counted = [];
  const skipped = [];
  wanted.forEach(monthKey => {
    const metrics = computeMonthlyMetrics(monthKey, source, firstMonthByPerson, now);
    if (metrics) counted.push(metrics); else skipped.push(monthKey);
  });

  const sheet = getOrCreateSheet(ss, SHEET_NAMES.METRICS);
  const rows = mergeMetricsRows(readStoredMetricsRows(sheet), counted);
  writeMetricsSheet(sheet, rows, now);

  log(`Metrics: captured ${counted.length} month(s)` +
    (skipped.length > 0 ? `, left ${skipped.length} stored month(s) alone (no rows behind them)` : ''));
  return { captured: counted.length, skipped: skipped, rows: rows };
}

// ----------------------------------------------------------------------------
// YEAR OVER YEAR
// ----------------------------------------------------------------------------

/**
 * The indicators the summary compares, and how each one moves.
 *
 * A function rather than a top-level constant on purpose: nothing derived from
 * another file's constant may be computed at load time (see
 * 01a_lazy_globals.gs), and a table like this is cheap to rebuild.
 *
 *   sum    — added across the twelve months (sessions, registrations, meals).
 *   rate   — a stored fraction; averaged across the months that HAVE one, and
 *            compared in percentage points.
 *   avg    — a per-month figure that is already an average or a per-month
 *            count of distinct things (programs offered, visits per person);
 *            averaged across the months that have one, never totalled.
 *   latest — a STOCK, not a flow (people on the roll, people lapsing): the
 *            figure for the last month of the period that has one. Adding up
 *            twelve month-ends would count each person twelve times.
 *   people — summed like `sum`, with the caveat spelled out in its note:
 *            a person at four sessions in four months is four of these.
 *
 * `group` is the heading the row is drawn under; `decimals` says it is shown
 * to one place (hours, per-person averages).
 */
function metricsYearOverYearIndicators() {
  const ACTIVITY = 'Activity';
  const DEMAND = 'Showing up and demand';
  const LOYALTY = 'Coming back';
  const MIX = 'Program mix';
  const LUNCH = 'Lunch';
  const HELP = 'Volunteers and private help';
  return [
    { group: ACTIVITY, header: 'Sessions', label: 'Sessions held', kind: 'sum',
      note: 'Program sessions dated in the period, drop-ins included. Lunches with no program behind them are counted separately.' },
    { group: ACTIVITY, header: 'Programs', label: 'Programs offered (per month)', kind: 'avg',
      note: 'Different programs with a session in the month, averaged over the months in the period. A program that ran every month counts once per month, not once.' },
    { group: ACTIVITY, header: 'Registrations', label: 'Registrations', kind: 'sum',
      note: 'Active registrations. Waitlisted and cancelled rows are their own indicators.' },
    { group: ACTIVITY, header: 'Avg_Per_Session', label: 'Registrations per session', kind: 'avg',
      note: 'Registrations ÷ the sessions that take registration (drop-ins are left out of the divisor). Averaged over the months in the period.' },
    { group: ACTIVITY, header: 'Participants', label: 'Participants (per month)', kind: 'sum',
      note: 'Distinct people per MONTH, added up. Somebody who came in every month counts twelve times — this is monthly reach, not a headcount of individuals for the year, which stored monthly rows cannot answer. Per building, somebody who came to both is one participant at each, so the buildings can add up to more than the whole.' },
    { group: ACTIVITY, header: 'New_People', label: 'New people', kind: 'sum',
      note: 'People with no earlier registration anywhere in the workbook at the time their month was counted. Per building this still means new to the CENTRE, not new to that building.' },
    { group: ACTIVITY, header: 'Guests', label: 'Guests', kind: 'sum',
      note: 'Registrations that are a guest brought by somebody else. Already included in Registrations.' },

    { group: DEMAND, header: 'Attendance_Rate', label: 'Attendance rate', kind: 'rate',
      note: 'Registrations ticked Attended, across sessions that had already happened. Averaged over the months that recorded one; months where nothing was ticked are left out rather than counted as zero.' },
    { group: DEMAND, header: 'No_Shows', label: 'No-shows', kind: 'sum',
      note: 'Registered for a session that has happened and not ticked present. Only counted in a month where somebody was ticked at all — otherwise it is a desk that did not tick, not a room of absentees.' },
    { group: DEMAND, header: 'Seats_Filled_Rate', label: 'Seats filled', kind: 'rate',
      note: 'Seats taken ÷ seats offered, across CAPPED sessions only. Most programs here are uncapped, so this speaks for the ones that are not.' },
    { group: DEMAND, header: 'Empty_Seats', label: 'Empty seats', kind: 'sum',
      note: 'Seats offered and not taken, across capped sessions. An over-full session does not cancel out an empty one.' },
    { group: DEMAND, header: 'Sessions_Full', label: 'Sessions that filled', kind: 'sum',
      note: 'Capped sessions with every seat taken. The count behind "do we need another session".' },
    { group: DEMAND, header: 'Sessions_Under_Half', label: 'Sessions under half full', kind: 'sum',
      note: 'Capped sessions with fewer than half their seats taken. The count behind "should this one change".' },
    { group: DEMAND, header: 'Waitlisted', label: 'Waitlisted', kind: 'sum',
      note: 'People the schedule turned away. A number that grows year over year is the case for another session.' },
    { group: DEMAND, header: 'Waitlist_Share', label: 'Waitlist share', kind: 'rate',
      note: 'Waitlisted ÷ (registrations + waitlisted): of everyone who asked, how many were turned away. Averaged over the months in the period. The workbook cannot tell a waitlisted person who later got a seat from one who never did, so this is pressure, not a conversion rate.' },
    { group: DEMAND, header: 'Cancellations', label: 'Cancellations', kind: 'sum',
      note: 'Bookings cancelled or superseded.' },

    { group: LOYALTY, header: 'Returning_Rate', label: 'Returning people', kind: 'rate',
      note: 'Of the people who came in a month, the share who also came the month before. Blank when the month before has nobody on file. Averaged over the months in the period.' },
    { group: LOYALTY, header: 'Visits_Per_Person', label: 'Visits per person (per month)', kind: 'avg',
      note: 'Registrations ÷ participants: how many sessions a person who came, came to. Averaged over the months in the period.' },
    { group: LOYALTY, header: 'Lapsing_People', label: 'Lapsing people', kind: 'latest',
      note: 'People registered at some point in the 90 days before the last 90, and not at all in the last 90. As of the last month of the period. Blank where the workbook holds nothing from before that to compare with.' },
    { group: LOYALTY, header: 'Roll_Size', label: 'People on the roll', kind: 'latest',
      note: 'Everyone on Member_Roll at the end of the month — the people the centre knows, which is not a list of dues-paying members (the workbook does not record who has paid). Per building, by the buildings listed against each person.' },
    { group: LOYALTY, header: 'Roll_Added', label: 'Added to the roll', kind: 'sum',
      note: 'People whose First_Seen falls in the month.' },
    { group: LOYALTY, header: 'Roll_Retired', label: 'Retired from the roll', kind: 'sum',
      note: 'People whose Retired_Date falls in the month.' },

    { group: MIX, header: 'Club_Sessions', label: 'Club sessions', kind: 'sum',
      note: 'Sessions tagged [Club] — the standing-roster half of the program mix.' },
    { group: MIX, header: 'Club_Registrations', label: 'Club registrations', kind: 'sum',
      note: 'Active registrations on a [Club] session.' },
    { group: MIX, header: 'Assistance_Sessions', label: 'Assistance sessions', kind: 'sum',
      note: 'Sessions tagged [Personalized Assistance].' },
    { group: MIX, header: 'Assistance_Registrations', label: 'Assistance registrations', kind: 'sum',
      note: 'Active registrations on a [Personalized Assistance] session.' },
    { group: MIX, header: 'Drop_In_Sessions', label: 'Drop-in sessions', kind: 'sum',
      note: 'Sessions tagged [No Registration]: held, but nobody signs up for them.' },

    { group: LUNCH, header: 'Meals_Ordered', label: 'Meals ordered', kind: 'sum',
      note: 'Meals registrants asked for, counted off the registrations rather than off the kitchen order.' },
    { group: LUNCH, header: 'Kitchen_Ordered', label: 'Lunches ordered from the kitchen', kind: 'sum',
      note: 'Actual_Ordered on Master_Lunch_Dashboard, added up — what the caterer was asked for, and the number to check an invoice against. Only days somebody typed a number count; Kitchen_Order_Days on the month-by-month table says how many that was.' },
    { group: LUNCH, header: 'Meals_Served', label: 'Meals served', kind: 'sum',
      note: 'People handed their food (a Lunch_Served tick). How much each took is Meals consumed.' },
    { group: LUNCH, header: 'Lunch_Only_Signups', label: 'Lunch-only sign-ups', kind: 'sum',
      note: 'Registrations for a meal with no programming behind it.' },

    { group: HELP, header: 'Volunteers', label: 'Volunteers (per month)', kind: 'sum',
      note: 'Distinct volunteers per MONTH, added up — monthly reach, like Participants. Per building, by the Location typed on each visit; visits away from the centre are their own column.' },
    { group: HELP, header: 'Volunteer_Visits', label: 'Volunteer visits', kind: 'sum',
      note: 'Rows on Volunteer_Hours.' },
    { group: HELP, header: 'Volunteer_Hours', label: 'Volunteer hours', kind: 'sum', decimals: true,
      note: 'Hours worked, from arrival and departure times where there are any and the typed number where there are not.' },
    { group: HELP, header: 'Private_Sessions', label: 'Private sessions', kind: 'sum',
      note: 'Appointments logged on Private_Sessions: counted, published nowhere.' },
    { group: HELP, header: 'Private_Session_People', label: 'Private-session people (per month)', kind: 'sum',
      note: 'Distinct people helped per MONTH, added up.' },
    { group: HELP, header: 'Private_Session_Hours', label: 'Private-session hours', kind: 'sum', decimals: true,
      note: 'Hours per session, counted once however many people were in it.' }
  ];
}

/** Twelve month keys ending at `endMonthKey`, oldest first. */
function metricsTwelveMonthsTo(endMonthKey) {
  const keys = [];
  for (let i = 11; i >= 0; i--) keys.push(metricsShiftMonthKey(endMonthKey, -i));
  return keys;
}

/** A By_Site cell as an object keyed by building; {} for blank or garbage. */
function metricsParseBySite_(cell) {
  const text = String(cell === null || cell === undefined ? '' : cell).trim();
  if (!text || text.charAt(0) !== '{') return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

/**
 * The year-over-year block: the last twelve complete-ish months against the
 * twelve before them, plus this month against the same month a year ago —
 * each indicator for the whole centre AND for every building the stored rows
 * name (`sites` on the summary, `sites[building]` on each indicator).
 *
 * THE PERIOD ENDS WITH THE MONTH JUST GONE, not with the month running. Half of
 * September against a whole September is a 50% collapse in every column, every
 * year, for four weeks — the same trap 43's month-over-month block avoids by
 * clamping both spans to the same day. Here the fix is simpler: leave the
 * part-month out of the twelve-month totals, and give it its own line where it
 * is compared against the same month last year (also partial to the same day
 * only in the sense that last year's is complete — which the label says).
 */
function buildYearOverYearSummary(rows, now) {
  now = now || new Date();
  const map = getIndexMap(HEADERS.Metrics);
  const byMonth = {};
  rows.forEach(row => { byMonth[String(row[map['Month']]).trim()] = row; });

  const thisMonthKey = formatMonthKey(now);
  const lastComplete = metricsShiftMonthKey(thisMonthKey, -1);
  const current = metricsTwelveMonthsTo(lastComplete);
  const prior = metricsTwelveMonthsTo(metricsShiftMonthKey(lastComplete, -12));
  const yearAgoKey = metricsShiftMonthKey(thisMonthKey, -12);

  const siteCache = {};
  const bySiteOf = key => {
    if (!siteCache[key]) {
      siteCache[key] = byMonth[key] && map['By_Site'] !== undefined
        ? metricsParseBySite_(byMonth[key][map['By_Site']]) : {};
    }
    return siteCache[key];
  };
  const sitesIn = keys => {
    const found = {};
    keys.forEach(key => Object.keys(bySiteOf(key)).forEach(site => { found[site] = true; }));
    return Object.keys(found).sort();
  };
  // The stored cell for one month, whole-centre or one building. '' when the
  // month has no row, or the row has nothing for that building.
  const stored = (key, header, site) => {
    const row = byMonth[key];
    if (!row) return '';
    if (!site) return row[map[header]];
    const values = bySiteOf(key)[site];
    return values && values[header] !== undefined ? values[header] : '';
  };
  const present = raw => !(raw === '' || raw === null || raw === undefined);

  const gather = (keys, indicator, site) => {
    const values = [];
    keys.forEach(key => {
      const raw = stored(key, indicator.header, site);
      if (!present(raw)) return;
      const value = indicator.kind === 'rate' ? metricsRateToPoints(raw) : (Number(raw) || 0);
      if (value !== null) values.push(value);
    });
    if (values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    // A rate is an average of the months that HAVE one; everything else is a
    // total. Averaging totals would answer a question nobody asked, and
    // totalling rates would produce a percentage over 1000.
    if (indicator.kind === 'rate') return Math.round(total / values.length);
    if (indicator.kind === 'avg') return Math.round((total / values.length) * 10) / 10;
    if (indicator.kind === 'latest') return values[values.length - 1];
    return Math.round(total * 100) / 100;
  };

  const readMonth = (key, indicator, site) => {
    const raw = stored(key, indicator.header, site);
    if (!present(raw)) return null;
    return indicator.kind === 'rate' ? metricsRateToPoints(raw) : (Number(raw) || 0);
  };

  const monthsCovered = current.filter(key => byMonth[key]).length;
  const priorCovered = prior.filter(key => byMonth[key]).length;
  const sites = sitesIn(current.concat(prior));
  const thisMonthSites = sitesIn([thisMonthKey, yearAgoKey]);

  const describe = (indicator, read, listOfSites) => {
    const perSite = {};
    listOfSites.forEach(site => { perSite[site] = read(site); });
    return Object.assign({
      label: indicator.label,
      note: indicator.note,
      group: indicator.group,
      kind: indicator.kind,
      header: indicator.header,
      points: indicator.kind === 'rate',
      decimals: indicator.kind === 'avg' || indicator.decimals === true,
      sites: perSite
    }, read(null));
  };

  return {
    currentLabel: `${metricsMonthLabel(current[0])} – ${metricsMonthLabel(lastComplete)}`,
    priorLabel: `${metricsMonthLabel(prior[0])} – ${metricsMonthLabel(prior[11])}`,
    monthsCovered: monthsCovered,
    priorMonthsCovered: priorCovered,
    sites: sites,
    indicators: metricsYearOverYearIndicators().map(indicator =>
      describe(indicator, site => ({ current: gather(current, indicator, site), previous: gather(prior, indicator, site) }), sites)),
    thisMonthLabel: metricsMonthLabel(thisMonthKey),
    yearAgoLabel: metricsMonthLabel(yearAgoKey),
    thisMonthSites: thisMonthSites,
    thisMonth: metricsYearOverYearIndicators().map(indicator =>
      describe(indicator, site => ({ current: readMonth(thisMonthKey, indicator, site), previous: readMonth(yearAgoKey, indicator, site) }), thisMonthSites))
  };
}

/** A summary cell: the number, or an em dash when that period has no row to read. */
function metricsSummaryValue(value, points) {
  if (value === null || value === undefined) return '—';
  return points ? `${value}%` : value;
}

// ----------------------------------------------------------------------------
// DRAWING THE TAB
// ----------------------------------------------------------------------------

/**
 * The rows a summary table draws: each indicator, with a heading row wherever
 * its group changes. One place, because the early write (99u) has to know how
 * many rows sit above the history before they are drawn.
 */
function metricsSummaryLayout_(indicators) {
  const layout = [];
  let lastGroup = null;
  indicators.forEach(indicator => {
    if (indicator.group && indicator.group !== lastGroup) {
      layout.push({ divider: indicator.group });
      lastGroup = indicator.group;
    }
    layout.push({ indicator: indicator });
  });
  return layout;
}

/** The headers of the by-site block: Month, Site, then one column per indicator. */
function metricsSiteBlockHeaders_() {
  const seen = {};
  const headers = ['Month', 'Site'];
  metricsYearOverYearIndicators().forEach(indicator => {
    if (seen[indicator.header]) return;
    seen[indicator.header] = true;
    headers.push(indicator.header);
  });
  return headers;
}

/** One row per month per building, newest month first, read off the By_Site cells. */
function metricsSiteBlockRows_(rows) {
  const map = getIndexMap(HEADERS.Metrics);
  const headers = metricsSiteBlockHeaders_();
  const out = [];
  rows.slice()
    .sort((a, b) => String(b[map['Month']]).localeCompare(String(a[map['Month']])))
    .forEach(row => {
      const bySite = metricsParseBySite_(row[map['By_Site']]);
      Object.keys(bySite).sort().forEach(site => {
        out.push([row[map['Month']], site].concat(headers.slice(2).map(header =>
          (bySite[site][header] === undefined ? '' : bySite[site][header]))));
      });
    });
  return { headers: headers, rows: out };
}

/**
 * The whole tab: the year-over-year block, then the month-by-month record it
 * is built from, then the same record by building.
 *
 * The summary sits ABOVE the history and inside the frozen band, because the
 * question this tab exists to answer is the one at the top; the monthly rows
 * are the working underneath it. Written by hand rather than through
 * writeMemoryTab() for exactly that reason — a memory tab is a table with a
 * banner, and this is several tables.
 */
function writeMetricsSheet(sheet, rows, now) {
  const headers = HEADERS.Metrics;
  const numCols = headers.length;
  const summary = buildYearOverYearSummary(rows, now);
  const siteBlock = metricsSiteBlockRows_(rows);
  try { ensureSheetColumns(sheet, Math.max(numCols, siteBlock.headers.length, 4 + 3 * Math.max(summary.sites.length, summary.thisMonthSites.length))); }
  catch (err) { log(`ℹ️ Metrics: could not widen the tab (${err}).`); }

  // WRITE BEFORE CLEARING. This is the one tab in the workbook that is a
  // RECORD rather than a projection, so a run killed between a clear and the
  // rows' write lost months nothing can recount. The month-by-month table
  // lands first at the row the draw below will use (under the banner, a blank
  // row, and the two summary tables with a blank row after each); the
  // summaries themselves are left blank here and drawn as they always were.
  // See 99u_write_before_clear.gs.
  const ordered = rows.slice().sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  const historyBannerRow = 3 + (1 + metricsSummaryLayout_(summary.indicators).length) + 1 +
    (1 + metricsSummaryLayout_(summary.thisMonth).length) + 1;
  writeTabValuesBeforeRender_(sheet, [
    { row: historyBannerRow + 1, values: [headers.slice()] },
    { row: historyBannerRow + 2, values: ordered }
  ]);
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());

  writeSectionBanner(sheet, 1, numCols, '📈 Metrics — Year Over Year', {
    hero: true,
    note: 'One row per month, counted once and then kept. The rows a month was counted from are eventually archived; ' +
      'these numbers are what still answers "how did last year compare".\n\n' +
      'The twelve-month periods END WITH THE MONTH JUST GONE — half of this month against a whole one would report ' +
      'a collapse every month for four weeks. This month has its own line underneath.\n\n' +
      'Each table also shows every building on its own, to the right of the whole centre. A month stored before ' +
      'buildings were counted has no building figures until it is recounted.\n\n' +
      'Recount from Settings & Fixes → "Update Metrics Now". The Notes column is yours; a recount carries it.'
  });

  let row = 3;
  row = writeMetricsSummaryTable(sheet, row,
    [`Last 12 months (${summary.currentLabel})`, `Prior 12 months (${summary.priorLabel})`],
    ['current', 'prior'], summary.indicators, summary.sites,
    `Twelve complete months against the twelve before them. ` +
    `${summary.monthsCovered} of 12 months stored for the recent period, ${summary.priorMonthsCovered} of 12 for the prior one — ` +
    `a period missing months reads low, and this is how you can tell.`);

  row++;
  row = writeMetricsSummaryTable(sheet, row,
    [`${summary.thisMonthLabel} so far`, summary.yearAgoLabel],
    ['this month', 'year ago'], summary.thisMonth, summary.thisMonthSites,
    'This month against the same month last year. This month is still running, so it reads low until it ends — ' +
    'the comparison is here to be watched, not totalled.');

  row++;
  writeSectionBanner(sheet, row, numCols, '📅 Month by month', {
    note: 'The stored record. A month recounts whenever its rows are still in the workbook; once they are archived, ' +
      'the row keeps the numbers it was captured with and is never zeroed.'
  });
  row++;

  const headerRow = row;
  writeSectionHeader(sheet, headerRow, numCols, headers);
  labelManualEntryColumns(sheet, headerRow, headers, METRICS_STAFF_COLUMNS);
  row++;

  // Newest first: the month somebody opens this tab to read is the last one
  // (`ordered`, sorted above for the early write).
  checkPredictedTableRow_(sheet, historyBannerRow + 1, headerRow);
  if (ordered.length > 0) {
    sheet.getRange(row, 1, ordered.length, numCols).setValues(ordered);
    const map = getIndexMap(headers);
    const format = (header, pattern) =>
      sheet.getRange(row, map[header] + 1, ordered.length, 1).setNumberFormat(pattern);
    ['Sessions', 'Programs', 'Locations', 'Club_Sessions', 'Assistance_Sessions', 'Drop_In_Sessions',
      'Lunch_Sessions', 'Registrations', 'Participants', 'New_People', 'Guests', 'Waitlisted',
      'Cancellations', 'Attended', 'Empty_Seats', 'Meals_Ordered', 'Meals_Served', 'Meals_Consumed',
      'Lunch_Only_Signups', 'Kitchen_Ordered', 'Kitchen_Order_Days', 'Lapsing_People', 'Roll_Size',
      'Roll_Added', 'Roll_Retired', 'Sessions_Full', 'Sessions_Under_Half', 'No_Shows',
      'Club_Registrations', 'Assistance_Registrations'].forEach(header => format(header, '0'));
    format('Avg_Per_Session', '0.0');
    format('Visits_Per_Person', '0.0');
    format('Attendance_Rate', '0%');
    format('Seats_Filled_Rate', '0%');
    format('Returning_Rate', '0%');
    format('Waitlist_Share', '0%');
    format('Captured_On', DATE_DISPLAY_FORMAT);
    applyZebraStripingManualBounded(sheet, row, ordered.length, numCols);
    tintManualEntryColumns(sheet, row, ordered.length, headers, METRICS_STAFF_COLUMNS);
  }
  row += ordered.length;

  // THE SAME RECORD, BY BUILDING — beneath the history, never above it, and
  // ending the history's run of month rows (readStoredMetricsRows stops at the
  // first row that is not one) with a blank row and a banner.
  if (siteBlock.rows.length > 0) {
    row++;
    writeSectionBanner(sheet, row, numCols, '📍 Month by month, by building', {
      note: 'The month-by-month record counted once per building, newest first. Read from the hidden By_Site column ' +
        'on the table above, so it follows every recount. People who came to more than one building are counted at ' +
        'each, so a building\'s Participants do not add up to the centre\'s.'
    });
    row++;
    writeSectionHeader(sheet, row, siteBlock.headers.length, siteBlock.headers);
    row++;
    sheet.getRange(row, 1, siteBlock.rows.length, siteBlock.headers.length).setValues(siteBlock.rows);
    metricsFormatSiteBlock_(sheet, row, siteBlock);
    row += siteBlock.rows.length;
  }

  // Everything above the history is the answer; the history is the evidence.
  // Freezing through the column header keeps the first visible in a scroll.
  freezeRowsSafely(sheet, headerRow);
  freezeColumnsSafely(sheet, 2); // Month and Month_Label are the row's identity
  autosizeColumns(sheet, { minCols: numCols, force: true });
  // The per-building JSON is the store, not something to read.
  try { sheet.hideColumns(headers.indexOf('By_Site') + 1); } catch (err) { /* a tab that will not hide a column is still right */ }
}

/** Number formats for the by-building block: counts whole, rates as percentages, one place for the averages. */
function metricsFormatSiteBlock_(sheet, firstRow, siteBlock) {
  try {
    const lastRow = firstRow + siteBlock.rows.length - 1;
    const byHeader = {};
    metricsYearOverYearIndicators().forEach(indicator => { byHeader[indicator.header] = indicator; });
    const whole = [];
    const places = [];
    const percent = [];
    siteBlock.headers.forEach((header, index) => {
      if (index < 2) return;
      const letter = columnToLetter(index + 1);
      const range = `${letter}${firstRow}:${letter}${lastRow}`;
      const indicator = byHeader[header];
      if (indicator.kind === 'rate') percent.push(range);
      else if (indicator.kind === 'avg' || indicator.decimals === true) places.push(range);
      else whole.push(range);
    });
    if (whole.length) sheet.getRangeList(whole).setNumberFormat('0');
    if (places.length) sheet.getRangeList(places).setNumberFormat('0.0');
    if (percent.length) sheet.getRangeList(percent).setNumberFormat('0%');
  } catch (err) {
    log(`ℹ️ Metrics: could not format the by-building block (${err}).`);
  }
}

/**
 * One comparison table — Indicator | current | previous | Change, then the same
 * three columns for each building.
 *
 * The change column is formatMetricChange()'s arrow rather than a color, for
 * the reason given where it is defined: this material gets printed in black
 * and white, and a color has to decide that up is GOOD, which is false of
 * Cancellations and Waitlisted.
 *
 * EVERY VALUE CELL GETS AN EXPLICIT NUMBER FORMAT. The rates are written as
 * text ("24%"), which Sheets turns into a percent-formatted number, and a
 * count written into a cell that has ever held one reads back as 14900%
 * (149 new people) — so the counts are formatted as counts rather than left to
 * whatever the cell last was.
 */
function writeMetricsSummaryTable(sheet, startRow, periodLabels, siteLabels, indicators, sites, note) {
  const headerValues = ['Indicator', periodLabels[0], periodLabels[1], 'Change'];
  const headerNotes = ['What is being compared. Hover a row label for what it counts.', note, note,
    'The direction, not a judgement — more sessions is not self-evidently a better year. Rates move in percentage POINTS.'];
  sites.forEach(site => {
    headerValues.push(`${site} — ${siteLabels[0]}`, `${site} — ${siteLabels[1]}`, `${site} — change`);
    headerNotes.push(`${site} on its own: only what happened there. People who came to more than one building count ` +
      'once at each, so the buildings can add up to more than the whole centre.', '', '');
  });
  const numCols = headerValues.length;
  writeSectionHeader(sheet, startRow, numCols, headerValues);
  sheet.getRange(startRow, 1, 1, numCols).setNotes([headerNotes]);

  const layout = metricsSummaryLayout_(indicators);
  const values = layout.map(entry => {
    if (entry.divider) {
      const heading = new Array(numCols).fill('');
      heading[0] = entry.divider;
      return heading;
    }
    const indicator = entry.indicator;
    const options = { points: indicator.points, decimals: indicator.decimals };
    const line = [
      indicator.label,
      metricsSummaryValue(indicator.current, indicator.points),
      metricsSummaryValue(indicator.previous, indicator.points),
      formatMetricChange(indicator.current, indicator.previous, options)
    ];
    sites.forEach(site => {
      const own = indicator.sites[site] || { current: null, previous: null };
      line.push(metricsSummaryValue(own.current, indicator.points), metricsSummaryValue(own.previous, indicator.points),
        formatMetricChange(own.current, own.previous, options));
    });
    return line;
  });
  const dataRow = startRow + 1;
  sheet.getRange(dataRow, 1, values.length, numCols).setValues(values);
  sheet.getRange(dataRow, 1, values.length, 1)
    .setNotes(layout.map(entry => [entry.indicator ? entry.indicator.note : '']));
  styleMetricTable(sheet, dataRow, values.length, numCols);

  // Headings read as headings: small, muted, bold, left — and short.
  layout.forEach((entry, index) => {
    if (!entry.divider) return;
    try {
      sheet.getRange(dataRow + index, 1, 1, numCols)
        .setFontSize(10).setFontWeight('bold').setFontColor(PALETTE.INK_MUTED).setHorizontalAlignment('left');
      sheet.setRowHeight(dataRow + index, 26);
    } catch (err) { /* a heading that will not style is still a heading */ }
  });

  try {
    const lastLetter = columnToLetter(numCols);
    const whole = [];
    const places = [];
    layout.forEach((entry, index) => {
      if (!entry.indicator || entry.indicator.points) return;
      const range = `B${dataRow + index}:${lastLetter}${dataRow + index}`;
      (entry.indicator.decimals ? places : whole).push(range);
    });
    if (whole.length) sheet.getRangeList(whole).setNumberFormat('#,##0');
    if (places.length) sheet.getRangeList(places).setNumberFormat('#,##0.0');
  } catch (err) {
    log(`ℹ️ Metrics: could not set the summary number formats (${err}).`);
  }
  return dataRow + values.length;
}

// ----------------------------------------------------------------------------
// THE TWO WAYS IT RUNS
// ----------------------------------------------------------------------------

/**
 * MENU: recount every month the workbook still holds rows for, and redraw.
 *
 * The repair path. A month captured while an import was half-done, a rename
 * that moved a program's history, a workbook that has never had a Metrics tab
 * at all — all of them are fixed by counting the data as it stands now.
 */
function refreshMetricsTabNow() {
  const result = captureMonthlyMetrics();
  // Hidden with the rest of the back room (99zp): show, then activate.
  openSystemTab_(SHEET_NAMES.METRICS);
  toastIfPossible(result.captured > 0
    ? `Metrics updated — ${result.captured} month(s) recounted ✅`
    : 'Metrics tab redrawn. Nothing to recount: this workbook has no sessions or registrations yet.');
  return result;
}

/**
 * MONTHLY TRIGGER: close out the month just ended, and refresh the one running.
 *
 * TWO MONTHS, NOT ONE. The month just ended is the point of the run — it is
 * complete, and this is the moment its rows are all in and none of them are
 * archived yet. The month running is refreshed alongside it so the tab's
 * bottom line is not a month stale for four weeks; it will be recounted again
 * next month, when it is the one being closed out.
 *
 * Deliberately NOT a whole-history recount. This runs unattended, and a sweep
 * over three years of rows every month is a long execution to schedule for a
 * result that only ever changes when someone edits the past.
 */
function captureMonthlyMetricsTrigger() {
  const now = new Date();
  const thisMonth = formatMonthKey(now);
  const result = captureMonthlyMetrics({ months: [metricsShiftMonthKey(thisMonth, -1), thisMonth], now: now });
  log(`Monthly metrics capture: ${result.captured} month(s) written.`);
  return result;
}
