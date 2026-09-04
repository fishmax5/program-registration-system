// ============================================================================
// 17. THE PROGRAM-MONTH VIEW  (Program_Month)
// ============================================================================
//
// Master_Program_Dashboard is one row per SESSION, and a weekly class is four
// or five near-identical rows a month: same form, same links, same capacity,
// same flags, differing only in a date. Fourteen of its twenty-five columns
// are program-month facts printed four times over.
//
// This tab is the other half of that table, written out separately: ONE ROW
// PER PROGRAM-MONTH — the unit buildEventGroups() already keys on, the unit a
// Google Form is made for, the unit a leader sheet is shared at. Nothing here
// is new information. It is the same rows, grouped back into the shape they
// were made in.
//
// DERIVED, TOP TO BOTTOM. Every cell is recomputed from the session table and
// Registrant_Dash on each render. Nothing stores anything here, nothing reads
// it back, no Script Property backs it, and no form knows it exists — so the
// tab can be deleted at any time and the only thing lost is the view. That is
// deliberate, and it is what makes this file safe to change.
//
// WHERE IT IS RENDERED FROM. renderProgramDashboard(), at the end, with the
// session rows and the registrant scan it already has in hand — so the two
// tabs can never disagree, and the month view costs no extra read of either
// tab. It is wrapped in a try/catch there for the same reason it is derived:
// a view must never be able to fail the table it is a view OF.
//
// ---------------------------------------------------------------------------
// THE GROUPING RULE, and the one assumption in it
// ---------------------------------------------------------------------------
//
// Form_ID first. It is already on the row, it IS the groupKey's identity, and
// it costs nothing to read. Rows with no Form_ID — the [No Registration] case
// and the hand-added-row case — fall back to
// (Clean_Title, Location, month), which is the same unit named the long way.
//
// A [Shared] program whose one form covers two locations gets ONE row, with
// Location reading "Narberth + Ashbridge" the way describeLocations() already
// words it everywhere else.
//
// FIXED-SPAN GROUPS ARE FILED UNDER THEIR FIRST MONTH. A [Grouped] series
// takes ONE form for its whole run (see formSpanKey(): the span is the literal
// 'FIXED' rather than a month label), so a ten-week course starting in
// September has no month of its own — it touches three. This tab files it once,
// on the month its first session falls in, and says the real span in the
// Schedule cell ("10 sessions · Sep 8 – Nov 10").
//
// That is a decision, not a fact, and the alternative is defensible: repeating
// the group on each month it touches reads better on a tab somebody scrolls by
// month. It was refused because every number on this tab is a sum over its
// row's sessions, and a repeated row would either double-count those sessions
// or have to divide them up — and a Registered figure that is a third of the
// truth in each of three places is worse than a row filed a month early.
// Filing once is arithmetically honest; the Schedule cell is where the span
// gets stated out loud. If this is ever revisited, revisit it here: nothing
// downstream depends on the choice, because nothing downstream reads this tab.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT HERE
// ---------------------------------------------------------------------------
//
//   • A Leader column. Who leads what is Program_Leaders' answer, and a
//     column here that could be typed into would be a second place storing it.
//     A read-only tab cannot disagree with anything.
//   • Sign_In_Sheet_Link. A sign-in sheet is per DAY and per building; a
//     month row would have twenty of them, and the session table is where the
//     one for Tuesday already sits.
//   • Any tick box. Every flag on this tab is a word in a cell. The place to
//     change a flag is the session table, where ticking it writes the tag back
//     onto the calendar (see handleProgramFlagEdit()).
// ============================================================================

/** The row's own plumbing: what it was grouped on. Kept, hidden — see HEADERS.Program_Month. */
const PROGRAM_MONTH_HIDDEN_COLUMNS = ['Group_Key', 'Form_ID'];

/**
 * Worst-first, for a group's Status cell: a program with one closed session
 * must not read green because its other three are open.
 *
 * The numbers are severities, not an order to display in. '🟢 Unlimited' is a
 * step BELOW '🟢 Open' on purpose — it is "open, more so" (see
 * EVENT_STATUS_COLORS), so a group mixing the two reads as merely Open, which
 * is the more cautious of the two true statements.
 */
const PROGRAM_MONTH_STATUS_SEVERITY = {
  '🟢 Unlimited': 0,
  '🟢 Open': 1,
  '🟡 Almost Full': 2,
  '🔴 Waitlist Only': 3
};

/** How the flags read once they are words in one cell rather than three ticks. */
const PROGRAM_MONTH_FLAG_LABELS = {
  Club: 'Club',
  No_Registration: 'No sign-up',
  Personalized_Assistance: 'By appointment'
};

/**
 * The key one session row groups under.
 *
 * Form_ID when there is one — see the banner. The fallback carries the month
 * in it and the Form_ID key deliberately does NOT: a Regular program's form is
 * already one per month, so its month is implied, while a FIXED span's single
 * form is exactly the thing that must not be split back up by month.
 */
function programMonthGroupKey(row, map) {
  const formId = String(row[map['Form_ID']] || '').trim();
  if (formId) return `form:${formId}`;
  const title = String(row[map['Clean_Title']] || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const location = String(row[map['Location']] || '').trim().toLowerCase();
  const when = coerceDate(row[map['Event_Date']]);
  const month = when ? formatMonthKey(when) : '';
  return `title:${title}|${location}|${month}`;
}

/** A row's Active/Waitlist pair — from the registrant scan when there is one, else off the row. */
function programMonthCountsFor(row, map, registrantScan) {
  const eventId = String(row[map['Event_ID']] || '').trim();
  const scanned = registrantScan && registrantScan.countsByEventId
    ? registrantScan.countsByEventId[eventId]
    : null;
  if (scanned) return { active: scanned.active || 0, waitlist: scanned.waitlist || 0 };
  const num = value => {
    const n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  };
  return {
    active: num(row[map['Active_Count']]),
    waitlist: map['Waitlist_Count'] === undefined ? 0 : num(row[map['Waitlist_Count']])
  };
}

/**
 * The session rows, grouped. One pass, no reads — everything it needs is on
 * the rows it is given, which is what keeps this testable against plain
 * arrays and what keeps a render from paying for the view.
 *
 * Groups come back sorted by their month, then by program name, so the caller
 * can write them straight out.
 */
function buildProgramMonthGroups(sessionRows, map, registrantScan) {
  const groups = [];
  const byKey = {};

  (sessionRows || []).forEach(row => {
    const key = programMonthGroupKey(row, map);
    let group = byKey[key];
    if (!group) {
      group = {
        key: key,
        formId: String(row[map['Form_ID']] || '').trim(),
        rows: [],
        titles: [],
        locations: [],
        types: [],
        statuses: [],
        firstDate: null,
        lastDate: null,
        sessions: 0,
        registered: 0,
        waitlist: 0,
        cappedSessions: 0,
        capacity: 0,
        seatsTaken: 0,
        lunchOnly: true,
        flags: {},
        formLink: '',
        editLink: '',
        leaderSheetLink: '',
        firstEventId: ''
      };
      byKey[key] = group;
      groups.push(group);
    }

    group.rows.push(row);
    group.sessions++;

    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const type = String(row[map['Type_Tag']] || '').trim();
    const status = String(row[map['Status']] || '').trim();
    if (location && group.locations.indexOf(location) === -1) group.locations.push(location);
    if (type && group.types.indexOf(type) === -1) group.types.push(type);
    if (status && group.statuses.indexOf(status) === -1) group.statuses.push(status);

    const eventId = String(row[map['Event_ID']] || '').trim();
    const isLunch = isLunchOnlyEventId(eventId);
    if (!isLunch) {
      group.lunchOnly = false;
      // A lunch row's title carries the day's dish ("Lunch @ Narberth — Chx
      // Parm"), so collecting it would make a month of lunches read as thirty
      // programs. The group names itself from its location instead.
      if (title && group.titles.indexOf(title) === -1) group.titles.push(title);
    }

    const when = coerceDate(row[map['Event_Date']]);
    if (when) {
      if (!group.firstDate || when < group.firstDate) {
        group.firstDate = when;
        group.firstEventId = eventId;
      }
      if (!group.lastDate || when > group.lastDate) group.lastDate = when;
    }

    const counts = programMonthCountsFor(row, map, registrantScan);
    group.registered += counts.active;
    group.waitlist += counts.waitlist;

    // Seats taken is counted only on CAPPED sessions, alongside the cap it
    // will be divided by — the same discipline summarizeSessionSpan() uses, so
    // a Fill percentage can never be drawn from two different populations.
    const cap = sessionCapacity(row, map);
    if (cap !== null) {
      group.cappedSessions++;
      group.capacity += cap;
      group.seatsTaken += counts.active;
    }

    PROGRAM_FLAG_COLUMNS.forEach(flag => {
      if (map[flag.column] === undefined) return;
      if (isFlagColumnValue(row[map[flag.column]], flag.regex)) group.flags[flag.column] = true;
    });

    const carry = (field, header) => {
      if (group[field] || map[header] === undefined) return;
      const value = String(row[map[header]] || '').trim();
      if (value) group[field] = value;
    };
    carry('formLink', 'Form_Response_Link');
    carry('editLink', 'Edit_Form_Link');
    carry('leaderSheetLink', 'Leader_Sheet_Link');
  });

  groups.forEach(group => {
    group.titles.sort();
    // Locations are left in the order they were MET, not sorted: a shared
    // program's row should read the way describeLocations() words it
    // everywhere else in this workbook — the calendar the sessions came from
    // first, then the one it is shared with — rather than alphabetically,
    // which would silently disagree with the form's own date labels.
    // The month the row is FILED under: its earliest session's. For everything
    // except a FIXED span that is the only month the group has; for a FIXED
    // span it is the choice the banner explains.
    group.monthStart = group.firstDate
      ? new Date(group.firstDate.getFullYear(), group.firstDate.getMonth(), 1)
      : null;
    group.label = group.lunchOnly
      ? lunchOnlyProgramLabel(describeLocations(group.locations))
      : (group.titles.length > 0 ? group.titles.join(' / ') : '(untitled)');
    group.spansMonths = !!(group.firstDate && group.lastDate &&
      formatMonthKey(group.firstDate) !== formatMonthKey(group.lastDate));
  });

  groups.sort((a, b) => {
    const am = a.monthStart ? a.monthStart.getTime() : 0;
    const bm = b.monthStart ? b.monthStart.getTime() : 0;
    if (am !== bm) return am - bm;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

/** "Club · By appointment", or blank. */
function describeProgramMonthFlags(group) {
  return Object.keys(PROGRAM_MONTH_FLAG_LABELS)
    .filter(column => group.flags[column])
    .map(column => PROGRAM_MONTH_FLAG_LABELS[column])
    .join(' · ');
}

/**
 * "Sep 8–23", or "Sep 8 – Nov 10" when the span crosses a month.
 *
 * describeDateSpan() writes the end as a bare DAY, which is right for the
 * metric block it was written for — both its spans are inside one month by
 * construction. A FIXED-span course is the case that breaks it: September the
 * 8th to November the 10th came out "Sep 8–10", which reads as a fortnight and
 * is the wrong answer by two months.
 */
function programMonthSpanLabel(first, last) {
  if (!first || !last) return '';
  if (formatMonthKey(first) === formatMonthKey(last)) return describeDateSpan(first, last);
  return `${Utilities.formatDate(first, TIMEZONE, 'MMM d')} – ${Utilities.formatDate(last, TIMEZONE, 'MMM d')}`;
}

/**
 * The line that earns this tab its keep: four rows of dates read as
 * "Tue 10:00 AM – 11:30 AM · 4 sessions".
 *
 * A group whose sessions do NOT all share a weekday and a time says so —
 * "4 sessions · Sep 2 – Sep 23 · times vary" — rather than picking one of them
 * and quietly being wrong three times. The outliers go in the cell's note, so
 * the difference is one hover away instead of a scan of four rows.
 */
function describeProgramMonthSchedule(group, map) {
  const count = group.sessions;
  const plural = `${count} session${count === 1 ? '' : 's'}`;
  const span = programMonthSpanLabel(group.firstDate, group.lastDate);

  if (group.lunchOnly) {
    // A month of lunches is a run of days, not a weekly slot: the count and
    // the span are the whole of what there is to say about it.
    const days = `${count} day${count === 1 ? '' : 's'}`;
    return span ? `${days} · ${span}` : days;
  }

  const weekdays = [];
  const times = [];
  group.rows.forEach(row => {
    const when = coerceDate(row[map['Event_Date']]);
    if (!when) return;
    const day = Utilities.formatDate(when, TIMEZONE, 'EEE');
    if (weekdays.indexOf(day) === -1) weekdays.push(day);
    const time = formatTimeRange(when, map['Event_End'] === undefined ? '' : row[map['Event_End']]);
    if (time && times.indexOf(time) === -1) times.push(time);
  });

  if (weekdays.length === 1 && times.length === 1) {
    return `${weekdays[0]} ${times[0]} · ${plural}`;
  }
  const parts = [plural];
  if (span) parts.push(span);
  parts.push(weekdays.length > 1 && times.length <= 1 ? 'days vary' : 'times vary');
  return parts.join(' · ');
}

/** Every session in the group, one per line: what the Schedule cell's note says when the times are not all the same. */
function programMonthScheduleNote(group, map) {
  return group.rows
    .map(row => {
      const when = coerceDate(row[map['Event_Date']]);
      if (!when) return null;
      const time = formatTimeRange(when, map['Event_End'] === undefined ? '' : row[map['Event_End']]);
      return `${Utilities.formatDate(when, TIMEZONE, 'EEE, MMM d')}${time ? ` · ${time}` : ''}`;
    })
    .filter(Boolean)
    .sort()
    .join('\n');
}

/** The group's worst session status — see PROGRAM_MONTH_STATUS_SEVERITY. */
function worstProgramMonthStatus(group) {
  let worst = '';
  let severity = -1;
  group.statuses.forEach(status => {
    const rank = PROGRAM_MONTH_STATUS_SEVERITY[status];
    if (rank === undefined || rank <= severity) return;
    severity = rank;
    worst = status;
  });
  return worst || (group.statuses.length > 0 ? group.statuses[0] : '');
}

/**
 * { Event_ID: sheet row number } for the session tab as it stands right now.
 *
 * One read of one column, so the Sessions cell can link at the group's own
 * block of day rows rather than at the top of the tab. A failure here is
 * cosmetic — the cell falls back to plain text — so it is caught rather than
 * thrown: a drill-through link is not worth a render.
 */
function programMonthSessionRowNumbers(sheet, map) {
  const out = {};
  if (!sheet) return out;
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return out;
    const column = map['Event_ID'] + 1;
    const values = sheet.getRange(1, column, lastRow, 1).getValues();
    values.forEach((cells, i) => {
      const eventId = String(cells[0] || '').trim();
      // FIRST wins: an Event_ID appears once, but a tab mid-repair may hold a
      // stray duplicate and the earlier row is the one in the Upcoming block.
      if (eventId && out[eventId] === undefined) out[eventId] = i + 1;
    });
  } catch (err) {
    log(`ℹ️ Could not read the session tab's row numbers for ${SHEET_NAMES.PROGRAM_MONTH} (${err}) — its Sessions cells stay plain text.`);
  }
  return out;
}

/**
 * The Sessions cell: "4 sessions", linked into the session tab at this group's
 * first day row. A same-workbook #gid link, which is what makes the split read
 * as one view across two tabs rather than two tables to keep in your head.
 */
function programMonthSessionsCell(group, sessionsGid, rowNumbersByEventId) {
  const label = `${group.sessions} session${group.sessions === 1 ? '' : 's'}`;
  const row = rowNumbersByEventId ? rowNumbersByEventId[group.firstEventId] : undefined;
  if (sessionsGid === null || sessionsGid === undefined || row === undefined) return label;
  return makeHyperlinkFormula(`#gid=${sessionsGid}&range=A${row}`, label);
}

/** One group as one sheet row. */
function buildProgramMonthRow(headers, group, map, options) {
  options = options || {};
  const out = new Array(headers.length).fill('');
  const put = (header, value) => {
    const idx = headers.indexOf(header);
    if (idx >= 0) out[idx] = value;
  };

  put('Month_Start', group.monthStart || '');
  put('Location', describeLocations(group.locations));
  put('Program', group.label);
  put('Type', group.types.join(' / '));
  put('Flags', describeProgramMonthFlags(group));
  put('Schedule', describeProgramMonthSchedule(group, map));
  put('Sessions', programMonthSessionsCell(group, options.sessionsGid, options.rowNumbersByEventId));
  put('Registered', group.registered);
  // Blank rather than 0 when nothing in the group has a cap: most programs
  // here are uncapped, and both a capacity of zero and a fill of 0% would be
  // lies about an open-door class. Same rule as the metrics block.
  put('Capacity', group.cappedSessions > 0 ? group.capacity : '');
  const fill = percentageOrNull(group.seatsTaken, group.capacity);
  put('Fill', fill === null ? '' : fill / 100);
  put('Waitlist', group.waitlist);
  put('Status', worstProgramMonthStatus(group));
  put('Form_Response_Link', group.formLink);
  put('Edit_Form_Link', group.editLink);
  put('Leader_Sheet_Link', group.leaderSheetLink);
  put('Group_Key', group.key);
  put('Form_ID', group.formId);
  return out;
}

/** Every group, as sheet rows. Separated from the writer so a test can read the values without a spreadsheet. */
function buildProgramMonthRows(headers, groups, map, options) {
  return groups.map(group => buildProgramMonthRow(headers, group, map, options));
}

/**
 * Draws the whole tab.
 *
 * `sessionRows` and `registrantScan` come from renderProgramDashboard(), which
 * has both in hand — this never re-reads either tab. `metrics` is the block
 * that used to sit above the session table and now lives here, on the tab
 * whose grain it matches (see writeProgramMetricsSection() in
 * 43_program_dashboard.gs, which still owns the words and the arithmetic).
 */
function renderProgramMonthDashboard(sessionRows, map, registrantScan, metrics, force) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_MONTH);
  const headers = HEADERS.Program_Month;
  const numCols = headers.length;

  const sessionsSheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const groups = buildProgramMonthGroups(sessionRows, map, registrantScan);
  const rows = buildProgramMonthRows(headers, groups, map, {
    sessionsGid: sessionsSheet ? sessionsSheet.getSheetId() : null,
    rowNumbersByEventId: programMonthSessionRowNumbers(sessionsSheet, map)
  });

  invalidateSectionedRowsCache(sheet);
  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // hidden rows outlive clear() — see renderFlatDateSheet()
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  // Notes outlive clear() too, and this tab writes a dozen of them (the metric
  // column headings, the Schedule outliers) at rows that MOVE as the table
  // above them grows. Swept before anything writes one.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();

  let row = 1;
  // --- The metrics block, on the tab whose grain it matches ---
  if (metrics) {
    row = writeProgramMetricsSection(sheet, row, numCols, metrics);
    row++; // spacer
  }

  // --- The month table, split the way every date-bearing tab is split ---
  const monthIdx = headers.indexOf('Month_Start');
  const thisMonthStartKey = formatDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const { upcoming, past } = partitionByDate(rows, monthIdx, thisMonthStartKey);
  const result = writeUpcomingPastSections(sheet, row, headers, upcoming, past, {
    upcomingLabel: '🗓️ This Month and Ahead',
    pastLabel: '🕓 Past Months'
  });

  // The month tint and the date format, applied here rather than by
  // writeUpcomingPastSections(): that function tints the column it finds under
  // the name 'Event_Date', and this tab's date column is a MONTH, which is a
  // different thing and says so.
  applyMonthColorTint(sheet, monthIdx + 1, result.upcomingDataStart, upcoming.length);
  applyMonthColorTint(sheet, monthIdx + 1, result.pastDataStart, past.length);

  const zones = [
    { start: result.upcomingDataStart, count: upcoming.length },
    { start: result.pastDataStart, count: past.length }
  ];
  const rules = [];
  const locationRanges = [];
  zones.forEach(zone => {
    if (zone.count < 1) return;
    ['Registered', 'Capacity', 'Waitlist'].forEach(header => {
      const idx = headers.indexOf(header);
      if (idx >= 0) sheet.getRange(zone.start, idx + 1, zone.count, 1).setNumberFormat('0');
    });
    const fillIdx = headers.indexOf('Fill');
    if (fillIdx >= 0) sheet.getRange(zone.start, fillIdx + 1, zone.count, 1).setNumberFormat('0%');
    const statusIdx = headers.indexOf('Status');
    if (statusIdx >= 0) {
      Object.keys(EVENT_STATUS_COLORS).forEach(text => {
        rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text)
          .setBackground(EVENT_STATUS_COLORS[text])
          .setRanges([sheet.getRange(zone.start, statusIdx + 1, zone.count, 1)]).build());
      });
    }
    const locationIdx = headers.indexOf('Location');
    if (locationIdx >= 0) locationRanges.push(sheet.getRange(zone.start, locationIdx + 1, zone.count, 1));
  });
  rules.push(...buildLocationColorRules(locationRanges));
  sheet.setConditionalFormatRules(rules);

  writeProgramMonthScheduleNotes(sheet, headers, map, groups, upcoming, past, result);

  // EVERY column is derived, so every column is protected. There is nothing on
  // this tab a person is meant to type into — the flags are ticked on the
  // session tab, and who leads what is typed on Program_Leaders.
  protectDerivedColumns(sheet, headers, headers, zones);
  applyColumnVisibility(sheet, headers, PROGRAM_MONTH_HIDDEN_COLUMNS);

  freezeRowsSafely(sheet, result.upcomingHeaderRow);
  freezeColumnsSafely(sheet, 3); // month, location, program name
  autosizeColumns(sheet, { force: !!force, minCols: numCols });

  log(`renderProgramMonthDashboard complete: ${groups.length} program-month row(s) ` +
    `from ${(sessionRows || []).length} session row(s).`);
  return { groups: groups.length, upcoming: upcoming.length, past: past.length };
}

/**
 * The Schedule cell's note, on the rows that need one: every session of the
 * group, dated and timed, for a group whose sessions are not all alike.
 *
 * Written from the ROWS that were laid out rather than from the group list, so
 * a note can never end up attached to a different program's line.
 */
function writeProgramMonthScheduleNotes(sheet, headers, map, groups, upcoming, past, result) {
  const scheduleIdx = headers.indexOf('Schedule');
  const keyIdx = headers.indexOf('Group_Key');
  if (scheduleIdx < 0 || keyIdx < 0) return 0;

  const byKey = {};
  groups.forEach(group => { byKey[group.key] = group; });

  let written = 0;
  const stamp = (rows, startRow) => {
    rows.forEach((row, i) => {
      const group = byKey[row[keyIdx]];
      if (!group || group.sessions < 2) return;
      const schedule = String(row[scheduleIdx] || '');
      // Only where the cell had to generalize. A "Tue 10:00 AM · 4 sessions"
      // line has already said everything the note would.
      if (schedule.indexOf('vary') === -1 && !group.spansMonths) return;
      try {
        sheet.getRange(startRow + i, scheduleIdx + 1).setNote(programMonthScheduleNote(group, map));
        written++;
      } catch (err) {
        log(`ℹ️ Could not note the schedule for "${group.label}" (${err}).`);
      }
    });
  };
  stamp(upcoming, result.upcomingDataStart);
  stamp(past, result.pastDataStart);
  return written;
}
