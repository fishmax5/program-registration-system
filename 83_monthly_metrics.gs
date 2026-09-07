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
    registrantMap: getIndexMap(HEADERS.All_Registrants)
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
 * `now` is injectable so the arithmetic can be pinned against a fixed calendar
 * in tests, the same way computeProgramMetrics() takes it.
 */
function computeMonthlyMetrics(monthKey, source, firstMonthByPerson, now) {
  now = now || new Date();
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
  const activeByEvent = {};

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
    }
  });

  if (sessions === 0 && lunchSessions === 0 && registrations === 0 &&
      waitlisted === 0 && cancellations === 0) {
    return null; // nothing left to count — see the banner above
  }

  const participants = Object.keys(participantsSet).length;
  const rate = (numerator, denominator) =>
    (denominator > 0 ? Math.round((numerator / denominator) * 100) / 100 : '');

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
    Captured_On: new Date(),
    Notes: ''
  };
}

// ----------------------------------------------------------------------------
// STORING IT
// ----------------------------------------------------------------------------

/** The stored rows, oldest first, as arrays in HEADERS.Metrics order. */
function readStoredMetricsRows(sheet) {
  if (!sheet) return [];
  return readSimpleTableValues(sheet, HEADERS.Metrics)
    .filter(row => String(row[0] || '').trim() !== '')
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
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
 *   people — summed like the rest, with the caveat spelled out in its note:
 *            a person at four sessions in four months is four of these.
 */
function metricsYearOverYearIndicators() {
  return [
    { header: 'Sessions', label: 'Sessions held', kind: 'sum',
      note: 'Program sessions dated in the period, drop-ins included. Lunches with no program behind them are counted separately.' },
    { header: 'Registrations', label: 'Registrations', kind: 'sum',
      note: 'Active registrations. Waitlisted and cancelled rows are their own indicators.' },
    { header: 'Participants', label: 'Participants (per month)', kind: 'sum',
      note: 'Distinct people per MONTH, added up. Somebody who came in every month counts twelve times — this is monthly reach, not a headcount of individuals for the year, which stored monthly rows cannot answer.' },
    { header: 'New_People', label: 'New people', kind: 'sum',
      note: 'People with no earlier registration anywhere in the workbook at the time their month was counted.' },
    { header: 'Attendance_Rate', label: 'Attendance rate', kind: 'rate',
      note: 'Registrations ticked Attended, across sessions that had already happened. Averaged over the months that recorded one; months where nothing was ticked are left out rather than counted as zero.' },
    { header: 'Seats_Filled_Rate', label: 'Seats filled', kind: 'rate',
      note: 'Seats taken ÷ seats offered, across CAPPED sessions only. Most programs here are uncapped, so this speaks for the ones that are not.' },
    { header: 'Waitlisted', label: 'Waitlisted', kind: 'sum',
      note: 'People the schedule turned away. A number that grows year over year is the case for another session.' },
    { header: 'Cancellations', label: 'Cancellations', kind: 'sum',
      note: 'Bookings cancelled or superseded.' },
    { header: 'Club_Sessions', label: 'Club sessions', kind: 'sum',
      note: 'Sessions tagged [Club] — the standing-roster half of the program mix.' },
    { header: 'Meals_Ordered', label: 'Meals ordered', kind: 'sum',
      note: 'Meals registrants asked for, counted off the registrations rather than off the kitchen order.' },
    { header: 'Meals_Served', label: 'Meals served', kind: 'sum',
      note: 'People handed their food (a Lunch_Served tick). How much each took is Meals consumed.' },
    { header: 'Lunch_Only_Signups', label: 'Lunch-only sign-ups', kind: 'sum',
      note: 'Registrations for a meal with no programming behind it.' }
  ];
}

/** Twelve month keys ending at `endMonthKey`, oldest first. */
function metricsTwelveMonthsTo(endMonthKey) {
  const keys = [];
  for (let i = 11; i >= 0; i--) keys.push(metricsShiftMonthKey(endMonthKey, -i));
  return keys;
}

/**
 * The year-over-year block: the last twelve complete-ish months against the
 * twelve before them, plus this month against the same month a year ago.
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

  const gather = (keys, indicator) => {
    const values = [];
    keys.forEach(key => {
      const row = byMonth[key];
      if (!row) return;
      const raw = row[map[indicator.header]];
      if (raw === '' || raw === null || raw === undefined) return;
      values.push(indicator.kind === 'rate' ? metricsRateToPoints(raw) : Number(raw) || 0);
    });
    if (values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    // A rate is an average of the months that HAVE one; everything else is a
    // total. Averaging totals would answer a question nobody asked, and
    // totalling rates would produce a percentage over 1000.
    return indicator.kind === 'rate' ? Math.round(total / values.length) : total;
  };

  const monthsCovered = current.filter(key => byMonth[key]).length;
  const priorCovered = prior.filter(key => byMonth[key]).length;

  const indicators = metricsYearOverYearIndicators().map(indicator => ({
    label: indicator.label,
    note: indicator.note,
    points: indicator.kind === 'rate',
    current: gather(current, indicator),
    previous: gather(prior, indicator)
  }));

  const monthLine = indicator => {
    const row = byMonth[thisMonthKey];
    const yearAgo = byMonth[metricsShiftMonthKey(thisMonthKey, -12)];
    const read = source => {
      if (!source) return null;
      const raw = source[map[indicator.header]];
      if (raw === '' || raw === null || raw === undefined) return null;
      return indicator.kind === 'rate' ? metricsRateToPoints(raw) : Number(raw) || 0;
    };
    return {
      label: indicator.label,
      note: indicator.note,
      points: indicator.kind === 'rate',
      current: read(row),
      previous: read(yearAgo)
    };
  };

  return {
    currentLabel: `${metricsMonthLabel(current[0])} – ${metricsMonthLabel(lastComplete)}`,
    priorLabel: `${metricsMonthLabel(prior[0])} – ${metricsMonthLabel(prior[11])}`,
    monthsCovered: monthsCovered,
    priorMonthsCovered: priorCovered,
    indicators: indicators,
    thisMonthLabel: metricsMonthLabel(thisMonthKey),
    yearAgoLabel: metricsMonthLabel(metricsShiftMonthKey(thisMonthKey, -12)),
    thisMonth: metricsYearOverYearIndicators().map(monthLine)
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
 * The whole tab: the year-over-year block, then the month-by-month record it
 * is built from.
 *
 * The summary sits ABOVE the history and inside the frozen band, because the
 * question this tab exists to answer is the one at the top; the monthly rows
 * are the working underneath it. Written by hand rather than through
 * writeMemoryTab() for exactly that reason — a memory tab is a table with a
 * banner, and this is two tables.
 */
function writeMetricsSheet(sheet, rows, now) {
  const headers = HEADERS.Metrics;
  const numCols = headers.length;
  const summary = buildYearOverYearSummary(rows, now);

  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());

  writeSectionBanner(sheet, 1, numCols, '📈 Metrics — Year Over Year', {
    hero: true,
    note: 'One row per month, counted once and then kept. The rows a month was counted from are eventually archived; ' +
      'these numbers are what still answers "how did last year compare".\n\n' +
      'The twelve-month periods END WITH THE MONTH JUST GONE — half of this month against a whole one would report ' +
      'a collapse every month for four weeks. This month has its own line underneath.\n\n' +
      'Recount from Settings & Fixes → "Update Metrics Now". The Notes column is yours; a recount carries it.'
  });

  let row = 3;
  row = writeMetricsSummaryTable(sheet, row,
    [`Last 12 months (${summary.currentLabel})`, `Prior 12 months (${summary.priorLabel})`],
    summary.indicators,
    `Twelve complete months against the twelve before them. ` +
    `${summary.monthsCovered} of 12 months stored for the recent period, ${summary.priorMonthsCovered} of 12 for the prior one — ` +
    `a period missing months reads low, and this is how you can tell.`);

  row++;
  row = writeMetricsSummaryTable(sheet, row,
    [`${summary.thisMonthLabel} so far`, summary.yearAgoLabel],
    summary.thisMonth,
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

  // Newest first: the month somebody opens this tab to read is the last one.
  const ordered = rows.slice().sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  if (ordered.length > 0) {
    sheet.getRange(row, 1, ordered.length, numCols).setValues(ordered);
    const map = getIndexMap(headers);
    const format = (header, pattern) =>
      sheet.getRange(row, map[header] + 1, ordered.length, 1).setNumberFormat(pattern);
    ['Sessions', 'Programs', 'Locations', 'Club_Sessions', 'Assistance_Sessions', 'Drop_In_Sessions',
      'Lunch_Sessions', 'Registrations', 'Participants', 'New_People', 'Guests', 'Waitlisted',
      'Cancellations', 'Attended', 'Empty_Seats', 'Meals_Ordered', 'Meals_Served', 'Meals_Consumed',
      'Lunch_Only_Signups'].forEach(header => format(header, '0'));
    format('Avg_Per_Session', '0.0');
    format('Attendance_Rate', '0%');
    format('Seats_Filled_Rate', '0%');
    format('Captured_On', DATE_DISPLAY_FORMAT);
    applyZebraStripingManualBounded(sheet, row, ordered.length, numCols);
    tintManualEntryColumns(sheet, row, ordered.length, headers, METRICS_STAFF_COLUMNS);
  }

  // Everything above the history is the answer; the history is the evidence.
  // Freezing through the column header keeps the first visible in a scroll.
  freezeRowsSafely(sheet, headerRow);
  freezeColumnsSafely(sheet, 2); // Month and Month_Label are the row's identity
  autosizeColumns(sheet, { minCols: numCols, force: true });
}

/**
 * One comparison table — Indicator | current | previous | Change.
 *
 * The change column is formatMetricChange()'s arrow rather than a color, for
 * the reason given where it is defined: this material gets printed in black
 * and white, and a color has to decide that up is GOOD, which is false of
 * Cancellations and Waitlisted.
 */
function writeMetricsSummaryTable(sheet, startRow, periodLabels, indicators, note) {
  const headerValues = ['Indicator', periodLabels[0], periodLabels[1], 'Change'];
  writeSectionHeader(sheet, startRow, headerValues.length, headerValues);
  sheet.getRange(startRow, 1, 1, headerValues.length)
    .setNotes([['What is being compared. Hover a row label for what it counts.', note, note,
      'The direction, not a judgement — more sessions is not self-evidently a better year. Rates move in percentage POINTS.']]);

  const values = indicators.map(indicator => [
    indicator.label,
    metricsSummaryValue(indicator.current, indicator.points),
    metricsSummaryValue(indicator.previous, indicator.points),
    formatMetricChange(indicator.current, indicator.previous, { points: indicator.points })
  ]);
  const dataRow = startRow + 1;
  sheet.getRange(dataRow, 1, values.length, headerValues.length).setValues(values);
  sheet.getRange(dataRow, 1, values.length, 1).setNotes(indicators.map(i => [i.note]));
  styleMetricTable(sheet, dataRow, values.length, headerValues.length);
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.METRICS);
  if (sheet) sheet.activate();
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
