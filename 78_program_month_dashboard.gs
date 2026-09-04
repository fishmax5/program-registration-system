// ============================================================================
// 7b. THE PROGRAM_MONTH TAB  (one row per program-month)
// ============================================================================
//
// The session table is one row per SESSION. Almost nothing downstream is:
// buildEventGroups() (24) keys every group as
// `scope::cleanTitle::monthLabel` — one program, one location, one month — and
// that key is what gets ONE Google Form, ONE leader sheet, ONE capacity and
// ONE set of links. A four-session weekly class therefore prints the same
// fourteen columns four times over, and the difference between the rows is a
// date and three counts.
//
// This tab is the other half of that join, written out on its own: one row per
// program-month, with the schedule collapsed into a phrase a person reads
// instead of four rows they compare.
//
// IT IS DERIVED, READ-ONLY, AND PURELY ADDITIVE — that is the whole design
// constraint, and everything below follows from it:
//
//   • Nothing reads this tab. Not the sync, not Quick Mark, not the door, not
//     the link doctor. Delete the tab and the workbook behaves exactly as it
//     did; the next render draws it again from the session rows.
//   • Nothing is STORED here that is not already on a session row. There is no
//     second record of a capacity, a leader or a link that could drift out of
//     agreement with the first one and be believed.
//   • It is rendered from the session rows the caller ALREADY HAS in memory
//     (renderProgramDashboard passes them). A derived view that cost a second
//     full read of a several-hundred-row tab on every sync would be paying,
//     every hour, for something nobody has looked at since Tuesday.
//
// WHY Form_ID IS THE GROUPING KEY. It is the groupKey's identity, it is
// already on the row, and it costs nothing to read. It also collapses the one
// case a (title, location, month) key gets wrong: a [Shared] program running
// at two locations has ONE form and is ONE thing to run, so it is one row here
// with Location reading "Narberth + Ashbridge" the way describeLocations()
// words it everywhere else. The fallback is only for rows that genuinely have
// no form — [No Registration] programs, and rows somebody typed in by hand.
//
// FIXED-SPAN GROUPS ARE FILED UNDER THEIR FIRST MONTH — the design doc's open
// question #2, answered. A [Grouped] series takes ONE form for its whole run
// (formSpanKey() gives it the literal 'FIXED' rather than a month label), so a
// ten-week course starting in September has no month of its own: it touches
// three. Grouping on Form_ID gives it ONE row, and monthStart is its earliest
// session's month.
//
// The alternative — repeating the group on every month it touches, with a
// "spans Sep–Nov" note — reads better on a tab somebody scrolls by month, and
// was refused anyway: every number on a month row is a SUM over that row's
// sessions, so a repeated row would either double-count them or have to divide
// them up, and a Registered figure that is a third of the truth in three
// places is worse than a row filed a month early. The Schedule cell states the
// real span, and its note names every session, so nothing about the run is
// hidden by where the row sits.
//
// Nothing downstream depends on the choice, because nothing downstream reads
// this tab: if it is ever revisited, this is the only place it lives.
// ============================================================================

/**
 * Internal plumbing, hidden for the same reason the session table hides its
 * own: Form_ID is how these rows were grouped and Group_Key is what one row
 * IS, and neither is something anybody scans a tab for.
 */
const PROGRAM_MONTH_HIDDEN_COLUMNS = ['Form_ID', 'Group_Key'];

/**
 * The three program-wide flags, in the order they read best in one cell.
 * Written out rather than derived from PROGRAM_FLAG_COLUMNS' own wording,
 * because that list's `describeOn` is a sentence about a change ("X is now a
 * club") and this is a label in a table.
 */
const PROGRAM_MONTH_FLAG_LABELS = {
  Club: 'Club',
  No_Registration: 'No Registration',
  Personalized_Assistance: 'Assistance'
};

/** Worst-first. A group reads as its unhappiest session, so one full date is not hidden by three open ones. */
const PROGRAM_MONTH_STATUS_ORDER = ['🔴 Waitlist Only', '🟡 Almost Full', '🟢 Open', '🟢 Unlimited'];

/** Separates the parts of one collapsed cell — the same interpunct the rest of the workbook uses. */
const PROGRAM_MONTH_JOINER = ' · ';

/**
 * The key a session row is filed under.
 *
 * Form_ID first — see the banner. The fallback carries the month explicitly
 * because, without a form, nothing else in the key says which month this is:
 * two Septembers of the same drop-in coffee hour must not collapse into one
 * row claiming twelve sessions.
 */
function programMonthGroupKey(row, map, monthKey) {
  const eventId = String(row[map['Event_ID']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  // A meal is not a program and never had a form: it groups by where and when
  // it was served, and by nothing else. See the lunch note in buildProgramMonthRows().
  if (isLunchOnlyEventId(eventId)) return `lunch::${location}::${monthKey}`;

  const formId = String(row[map['Form_ID']] || '').trim();
  if (formId) return `form::${formId}`;

  const title = String(row[map['Clean_Title']] || '').trim();
  return `plain::${title}::${location}::${monthKey}`;
}

/**
 * "Tue 9:30 AM – 11:00 AM · 4 sessions", or "4 sessions · times vary" when
 * they do not agree — which is the line that earns this tab its keep. A person
 * reading one phrase learns what four rows of a session table were there to
 * tell them, and learns it faster.
 *
 * WHEN THEY DISAGREE, THE OUTLIERS GO IN A CELL NOTE rather than into the
 * cell. "Times vary" is the fact; WHICH Tuesday is at 2pm is the follow-up
 * question, and a follow-up question answered in the cell would make the
 * common case unreadable to serve the rare one.
 */
function describeProgramMonthSchedule(sessions) {
  const count = sessions.length;
  const plural = count === 1 ? 'session' : 'sessions';
  const shapes = sessions.map(s => ({
    when: s.date,
    weekday: s.date ? Utilities.formatDate(s.date, TIMEZONE, 'EEE') : '',
    times: s.times || ''
  }));
  const distinct = [];
  shapes.forEach(shape => {
    const signature = `${shape.weekday}|${shape.times}`;
    if (distinct.indexOf(signature) === -1) distinct.push(signature);
  });

  if (distinct.length === 1 && shapes.length > 0 && shapes[0].weekday) {
    const one = shapes[0];
    const phrase = one.times ? `${one.weekday} ${one.times}` : one.weekday;
    return { text: `${phrase}${PROGRAM_MONTH_JOINER}${count} ${plural}`, note: '' };
  }

  // The commonest shape is the baseline; everything else is named. Counted
  // rather than assumed, so "one Tuesday moved" reads as one outlier and not
  // as a schedule with no pattern at all.
  const tally = {};
  shapes.forEach(shape => {
    const signature = `${shape.weekday}|${shape.times}`;
    tally[signature] = (tally[signature] || 0) + 1;
  });
  let commonest = '';
  Object.keys(tally).forEach(signature => {
    if (!commonest || tally[signature] > tally[commonest]) commonest = signature;
  });
  const outliers = shapes
    .filter(shape => `${shape.weekday}|${shape.times}` !== commonest && shape.when)
    .map(shape => `${Utilities.formatDate(shape.when, TIMEZONE, 'EEE MMM d')}` +
      (shape.times ? ` — ${shape.times}` : ''));

  const usual = commonest.split('|');
  const usualPhrase = usual[0] ? (usual[1] ? `${usual[0]} ${usual[1]}` : usual[0]) : '';
  const note = outliers.length > 0
    ? `Usually ${usualPhrase || 'the same time'}.\n\nNot these:\n${outliers.join('\n')}`
    : '';
  return { text: `${count} ${plural}${PROGRAM_MONTH_JOINER}times vary`, note };
}

/** The flags this group carries, collapsed into one cell. */
function describeProgramMonthFlags(sessions, map) {
  const on = [];
  PROGRAM_FLAG_COLUMNS.forEach(flag => {
    if (map[flag.column] === undefined) return;
    // ANY session carrying the flag means the GROUP does. These describe a
    // program, not a date — buildEventGroups() sets them on the group and
    // never unsets them per session — so a row that has not caught up with a
    // tick yet is a stale row, not a disagreement worth reporting.
    const anyOn = sessions.some(s => isFlagColumnValue(s.row[map[flag.column]], flag.regex));
    if (anyOn) on.push(PROGRAM_MONTH_FLAG_LABELS[flag.column] || flag.column);
  });
  return on.join(PROGRAM_MONTH_JOINER);
}

/** The group's worst status, or '' when no session on it says anything. */
function worstProgramMonthStatus(sessions, map) {
  let worst = '';
  let worstRank = PROGRAM_MONTH_STATUS_ORDER.length;
  sessions.forEach(s => {
    const status = String(s.row[map['Status']] || '').trim();
    if (!status) return;
    const at = PROGRAM_MONTH_STATUS_ORDER.indexOf(status);
    // A status this file has never heard of is treated as the WORST thing on
    // the group rather than ignored: a tab that quietly drops the one value it
    // did not recognize is how a group with something wrong with it reads
    // green.
    const rank = at === -1 ? -1 : at;
    if (rank < worstRank) { worstRank = rank; worst = status; }
  });
  return worst;
}

/** A number out of a cell that may hold '', '--', or words. 0 for anything that is not one. */
function programMonthNumber(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/**
 * Session rows in, Program_Month rows out. Pure — no sheet, no cache, no
 * clock beyond the dates on the rows themselves — which is what lets the tests
 * pin the collapsing rules without a spreadsheet.
 *
 * `linkTarget` — { gid, rowNumbersByEventId } for the session tab, so the
 * Sessions cell can be a drill-through link. Omitted (by every test, and by
 * anything that has no sheet in hand) the cell is the plain count, which is
 * what it always was.
 *
 * Returns { rows, notes }: `notes` is keyed by the row ARRAY (not its index),
 * because the rows are about to be split into Upcoming and Past and sorted,
 * and an index into the list handed back here would be an index into a list
 * that no longer exists by the time the notes are written.
 */
function buildProgramMonthRows(sessionRows, sessionMap, linkTarget) {
  const headers = HEADERS.Program_Month;
  const map = getIndexMap(headers);
  const groups = {};
  const order = [];

  (sessionRows || []).forEach(row => {
    const date = coerceDate(row[sessionMap['Event_Date']]);
    // No date, no month, and this tab IS the month. A dateless row keeps
    // living on the session table, where it is visible and fixable.
    if (!date) return;
    const monthKey = formatMonthKey(date);
    const key = programMonthGroupKey(row, sessionMap, monthKey);
    if (!groups[key]) {
      groups[key] = { key, sessions: [], monthStart: null };
      order.push(key);
    }
    const group = groups[key];
    group.sessions.push({
      row,
      date,
      times: formatTimeRange(row[sessionMap['Event_Date']],
        sessionMap['Event_End'] === undefined ? '' : row[sessionMap['Event_End']])
    });
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    if (!group.monthStart || first < group.monthStart) group.monthStart = first;
  });

  const rows = [];
  const notes = [];
  order.forEach(key => {
    const group = groups[key];
    const sessions = group.sessions.slice().sort((a, b) => a.date - b.date);
    const first = sessions[0].row;
    const isLunch = key.indexOf('lunch::') === 0;

    const locations = [];
    sessions.forEach(s => {
      const location = String(s.row[sessionMap['Location']] || '').trim();
      if (location && locations.indexOf(location) === -1) locations.push(location);
    });

    let registered = 0, waitlist = 0, capacity = 0, cappedRegistered = 0, cappedSessions = 0;
    sessions.forEach(s => {
      registered += programMonthNumber(s.row[sessionMap['Active_Count']]);
      waitlist += programMonthNumber(s.row[sessionMap['Waitlist_Count']]);
      const cap = sessionCapacity(s.row, sessionMap);
      if (cap !== null) {
        cappedSessions++;
        capacity += cap;
        cappedRegistered += programMonthNumber(s.row[sessionMap['Active_Count']]);
      }
    });

    const types = [];
    sessions.forEach(s => {
      const type = String(s.row[sessionMap['Type_Tag']] || '').trim();
      if (type && types.indexOf(type) === -1) types.push(type);
    });

    // The first non-blank wins for each link. They are group facts printed on
    // every session row, so they agree — but a row written before a form
    // existed holds a blank, and taking the first row's blank would lose a
    // link the group plainly has.
    const firstNonBlank = header => {
      let found = '';
      sessions.some(s => {
        const value = sessionMap[header] === undefined ? '' : s.row[sessionMap[header]];
        if (String(value || '').trim()) { found = value; return true; }
        return false;
      });
      return found;
    };

    const schedule = describeProgramMonthSchedule(sessions);
    // A MEAL IS NOT A PROGRAM, and this is the whole of what that costs here:
    // one row per location per month, saying what it is and how many days it
    // ran, instead of the ~21 rows the session table carries. Its Schedule
    // says the span rather than a weekday, because lunch is every weekday and
    // "Mon–Fri · 21 sessions" tells nobody anything. Everything downstream
    // that counts PROGRAMS still filters these out by Event_ID, exactly as it
    // does today — see renderProgramDashboard()'s filter.
    const sessionsLabel = isLunch
      ? `${sessions.length} ${sessions.length === 1 ? 'day' : 'days'}`
      : `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`;
    // Linked at the group's FIRST session, which is the row somebody landing
    // on the session tab wants to be looking at — the top of this program's
    // block, not the middle of it.
    const sessionsCell = programMonthSessionsCell(sessionsLabel,
      String(sessions[0].row[sessionMap['Event_ID']] || '').trim(), linkTarget);
    const scheduleCell = isLunch
      ? describeDateSpan(sessions[0].date, sessions[sessions.length - 1].date)
      : schedule.text;

    const out = new Array(headers.length).fill('');
    out[map['Month_Start']] = group.monthStart;
    out[map['Location']] = describeLocations(locations);
    out[map['Program']] = isLunch
      ? `Lunch @ ${locations[0] || 'this location'}`
      : String(first[sessionMap['Clean_Title']] || '');
    out[map['Type_Tag']] = types.join(PROGRAM_MONTH_JOINER);
    out[map['Flags']] = isLunch ? '' : describeProgramMonthFlags(sessions, sessionMap);
    out[map['Schedule']] = scheduleCell;
    out[map['Sessions']] = sessionsCell;
    out[map['Registered']] = registered;
    out[map['Max_Capacity']] = cappedSessions > 0 ? capacity : '';
    // BLANK, NEVER 0%, when nothing in the group has a cap — the same
    // discipline percentageOrNull() exists for on the metrics block. Most
    // programs here are uncapped, and "0% full" would be a bare-faced lie
    // about a month of open-door sessions.
    const fill = percentageOrNull(cappedRegistered, capacity);
    out[map['Fill']] = fill === null ? '' : `${fill}%`;
    out[map['Waitlist']] = waitlist;
    out[map['Form_Response_Link']] = firstNonBlank('Form_Response_Link');
    out[map['Edit_Form_Link']] = firstNonBlank('Edit_Form_Link');
    out[map['Leader_Sheet_Link']] = firstNonBlank('Leader_Sheet_Link');
    out[map['Status']] = isLunch ? '' : worstProgramMonthStatus(sessions, sessionMap);
    out[map['Form_ID']] = String(first[sessionMap['Form_ID']] || '');
    out[map['Group_Key']] = key;

    rows.push(out);
    if (!isLunch && schedule.note) notes.push({ row: out, header: 'Schedule', text: schedule.note });
  });

  return { rows, notes };
}

/**
 * options.sessionRows — the session rows the caller already has. Passed by
 * every render on the sync path; the menu item is the one caller that has to
 * go and read them, and it is the one caller nothing is waiting on.
 */
function renderProgramMonthDashboard(force, options) {
  options = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_MONTH);
  const sessionHeaders = HEADERS.Master_Program_Dashboard;
  const sessionMap = getIndexMap(sessionHeaders);

  const sessionSheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  let sessionRows = options.sessionRows;
  if (!sessionRows) {
    sessionRows = sessionSheet ? getSectionedRows(sessionSheet, sessionHeaders, 'Event_ID') : [];
  }

  // THE METRICS THE CALLER ALREADY COMPUTED, or — on the menu path, the one
  // caller nothing is waiting on — computed here from the same two inputs and
  // by the same function, so the numbers cannot depend on how the tab was
  // asked for. A failure to work them out costs the block, not the tab.
  let metrics = options.metrics;
  if (!metrics) {
    try {
      const programRows = sessionRows.filter(row => !isLunchOnlyEventId(row[sessionMap['Event_ID']]));
      const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
      metrics = computeProgramMetrics(programRows, sessionMap, scanRegistrants(registrantsSheet));
    } catch (err) {
      log(`\u2139\ufe0f Program_Month: could not compute the metrics block (${err}) — the month table is drawn without it.`);
      metrics = null;
    }
  }

  const built = buildProgramMonthRows(sessionRows, sessionMap, {
    gid: sessionSheet ? sessionSheet.getSheetId() : null,
    rowNumbersByEventId: programMonthSessionRowNumbers(sessionSheet, sessionMap)
  });
  writeProgramMonthSheet(sheet, built, force, metrics);
  log(`Program_Month: ${built.rows.length} program-month row(s) from ${sessionRows.length} session row(s).`);
  return built;
}

function writeProgramMonthSheet(sheet, built, force, metrics) {
  const headers = HEADERS.Program_Month;
  const map = getIndexMap(headers);
  const numCols = headers.length;

  invalidateSectionedRowsCache(sheet);
  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // hidden rows outlive clear() — see renderFlatDateSheet()
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  // Notes outlive clear() as well, and this tab writes them onto whichever row
  // a group lands on — a row that MOVES the moment a session is added. Last
  // render's notes go before this render's are written, or the tab
  // accumulates explanations attached to the wrong months.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();

  // --- The metrics block, on the tab whose grain it matches ---
  let row = 1;
  if (metrics) {
    row = writeProgramMetricsSection(sheet, row, numCols, metrics);
    row = writeProgramMonthCoverageLine(sheet, row, numCols,
      programMonthLeaderCoverage(built.rows, formatMonthKey(new Date())));
    row++; // spacer
  }

  // A MONTH ROW IS PAST WHEN ITS MONTH IS OVER, not when its first day has
  // gone: partitioning on today would file the whole of this month under
  // "Past" from the 2nd onwards. The 1st of the current month is the boundary.
  const now = new Date();
  const todayKey = formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const { upcoming, past } = partitionByDate(built.rows, map['Month_Start'], todayKey);
  const result = writeUpcomingPastSections(sheet, row, headers, upcoming, past, {
    upcomingLabel: '🗓️ This Month & Ahead', pastLabel: '🕓 Past Months',
    // NOT COLLAPSED. Old-month hiding is defined against a tab of sessions,
    // where two months is hundreds of rows; here a year of history is a couple
    // of dozen, and the whole point of the tab is that a year of it fits on a
    // screen. Passed explicitly rather than left to the default, because the
    // default would silently hide half of what this tab exists to show.
    collapseOldMonths: false
  });

  const zones = [
    { start: result.upcomingDataStart, count: upcoming.length },
    { start: result.pastDataStart, count: past.length }
  ];

  const rules = [];
  const locationRanges = [];
  zones.forEach(z => {
    if (z.count < 1) return;
    ['Registered', 'Max_Capacity', 'Waitlist'].forEach(h => {
      sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0');
    });
    // The month tint the sectioned writer applies for itself on every other
    // tab. It keys off a column literally named Event_Date, and this tab's
    // date is Month_Start — so it is applied here rather than by changing what
    // that shared writer is defined against.
    applyMonthColorTint(sheet, map['Month_Start'] + 1, z.start, z.count);
    Object.keys(EVENT_STATUS_COLORS).forEach(text => {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text)
        .setBackground(EVENT_STATUS_COLORS[text])
        .setRanges([sheet.getRange(z.start, map['Status'] + 1, z.count, 1)]).build());
    });
    locationRanges.push(sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  });
  rules.push(...buildLocationColorRules(locationRanges));
  sheet.setConditionalFormatRules(rules);

  writeProgramMonthNotes(sheet, map, built.notes, upcoming, past, result);

  // EVERY column, because every column here is derived. There is nothing on
  // this tab a person is meant to type into: an edit would be overwritten by
  // the next sync without ever having changed anything, which is precisely
  // what the warning says.
  protectDerivedColumns(sheet, headers, headers, zones);
  applyColumnVisibility(sheet, headers, PROGRAM_MONTH_HIDDEN_COLUMNS);
  freezeRowsSafely(sheet, result.upcomingHeaderRow);
  freezeColumnsSafely(sheet, 3); // month, location, program name
  autosizeColumns(sheet, { force: !!force, minCols: numCols });
}

/** The outlier notes, placed by finding each row's array in the written sections. */
function writeProgramMonthNotes(sheet, map, notes, upcoming, past, result) {
  if (!notes || notes.length === 0) return;
  notes.forEach(note => {
    let at = upcoming.indexOf(note.row);
    let start = result.upcomingDataStart;
    if (at === -1) { at = past.indexOf(note.row); start = result.pastDataStart; }
    if (at === -1) return; // a row that was not written can't be annotated
    sheet.getRange(start + at, map[note.header] + 1).setNote(note.text);
  });
}

// ============================================================================
// PHASE 2 — WHAT THE MONTH ROW MAKES POSSIBLE
// ============================================================================
//
// Three things land here, and all three are the same argument: this is the tab
// whose grain matches the question.
//
//   THE METRICS BLOCK, moved up off the session table (see the note in
//   renderProgramDashboard()). Its arithmetic and every one of its column
//   notes stay in 43_program_dashboard.gs, which is what makes "the numbers
//   must not move by a digit" true by construction rather than by inspection:
//   the same computeProgramMetrics() over the same rows, drawn one tab across.
//
//   LEADER COVERAGE — "Programs with no leader this month: 3". The number
//   Program_Leaders exists to drive to zero, and the honest measure of whether
//   attributing leaders to programs is working at all. It reads
//   buildProgramLeaderIndex() — the SAME index the sharing and mail paths read,
//   memoized per execution, so this is not a second read of that tab — and it
//   is a COUNT, never an action: nothing here shares a sheet or sends anything.
//
//   THE SESSIONS DRILL-THROUGH. "4 sessions" becomes a link into the session
//   tab at that group's own first day row, which is what makes two tabs read
//   as one view. It degrades to the plain count rather than to a wrong link —
//   a link to the wrong program's rows is worse than no link at all.
// ============================================================================

/**
 * { Event_ID: sheet row } for the session tab as it stands right now: one read
 * of one column, so a month row can point at its own block of day rows rather
 * than at the top of the tab.
 *
 * Caught, not thrown, and empty on failure — the Sessions cells then read as
 * plain counts. A drill-through link is not worth a render.
 */
function programMonthSessionRowNumbers(sessionSheet, sessionMap) {
  const out = {};
  if (!sessionSheet) return out;
  try {
    const lastRow = sessionSheet.getLastRow();
    if (lastRow < 1) return out;
    const values = sessionSheet.getRange(1, sessionMap['Event_ID'] + 1, lastRow, 1).getValues();
    values.forEach((cells, i) => {
      const eventId = String(cells[0] || '').trim();
      // FIRST wins. An Event_ID appears once, but a tab caught mid-repair can
      // hold a stray duplicate, and the earlier row is the one in Upcoming.
      if (eventId && out[eventId] === undefined) out[eventId] = i + 1;
    });
  } catch (err) {
    log(`\u2139\ufe0f Could not read the session tab's row numbers (${err}) — Program_Month's Sessions cells stay plain text.`);
  }
  return out;
}

/**
 * The Sessions cell, linked at the group's first session row when both the
 * tab's gid and that row are known, and the plain words otherwise.
 */
function programMonthSessionsCell(label, firstEventId, target) {
  target = target || {};
  const row = target.rowNumbersByEventId ? target.rowNumbersByEventId[firstEventId] : undefined;
  if (target.gid === null || target.gid === undefined || row === undefined) return label;
  return makeHyperlinkFormula(`#gid=${target.gid}&range=A${row}`, label);
}

/**
 * How many of THIS MONTH's programs have nobody down as leading them, and
 * which ones — the count for the line, the names for its note.
 *
 * Lunch is not a program and is not counted. A row whose Location reads
 * "Narberth + Ashbridge" (one form, two buildings) counts as covered if EITHER
 * building's program has a leader row: a shared program is one thing to run,
 * and reporting it as unstaffed because only one of its two keys matched would
 * be a number nobody could act on.
 *
 * READ-ONLY, like everything else on this tab. It counts rows on
 * Program_Leaders; it never writes one, never shares a sheet and never sends
 * anything — see the NO WILDCARDS paragraph at the top of 65_program_leaders.gs.
 */
function programMonthLeaderCoverage(rows, monthKey) {
  const map = getIndexMap(HEADERS.Program_Month);
  const missing = [];
  let considered = 0;

  let index;
  try {
    index = buildProgramLeaderIndex();
  } catch (err) {
    log(`\u2139\ufe0f Could not read the leader index for Program_Month's coverage line (${err}).`);
    return null;
  }

  rows.forEach(row => {
    if (String(row[map['Group_Key']] || '').indexOf('lunch::') === 0) return;
    const monthStart = coerceDate(row[map['Month_Start']]);
    if (!monthStart || formatMonthKey(monthStart) !== monthKey) return;
    const title = String(row[map['Program']] || '').trim();
    if (!title) return;
    considered++;
    const locations = String(row[map['Location']] || '').split(' + ').map(part => part.trim()).filter(Boolean);
    const covered = locations.some(location => {
      const leaders = index[leaderProgramKey(title, location)];
      return !!(leaders && leaders.length > 0);
    });
    if (!covered) missing.push(`${title} — ${row[map['Location']]}`);
  });

  return { considered, missing: missing.sort() };
}

/**
 * The coverage line, written under the metric tables and styled like them.
 * Returns the next free row.
 *
 * ONE LINE, not a table: it is a single number, and a number with a heading
 * row above it and a blank row below it would be three rows of frozen band
 * spent on one fact.
 */
function writeProgramMonthCoverageLine(sheet, row, numCols, coverage) {
  if (!coverage) return row;
  const label = 'Programs with no leader this month';
  sheet.getRange(row, 1, 1, 2).setValues([[label, coverage.missing.length]]);
  sheet.getRange(row, 1)
    .setFontSize(TYPO.HERO_LABEL.size)
    .setFontWeight(TYPO.HERO_LABEL.weight)
    .setFontColor(TYPO.HERO_LABEL.color)
    .setNote(coverage.missing.length > 0
      ? `Counted over the ${coverage.considered} program(s) running this month.\n\n` +
        `Nobody on ${SHEET_NAMES.PROGRAM_LEADERS} is down as leading:\n${coverage.missing.join('\n')}\n\n` +
        `Add a row there naming the program and its location. This tab only COUNTS — ` +
        `nothing is shared and no mail is sent from here.`
      : `Every one of the ${coverage.considered} program(s) running this month has a leader row on ` +
        `${SHEET_NAMES.PROGRAM_LEADERS}.`);
  sheet.getRange(row, 2)
    .setFontSize(TYPO.METRIC_VALUE.size)
    .setFontWeight(TYPO.METRIC_VALUE.weight)
    .setFontColor(TYPO.METRIC_VALUE.color)
    .setHorizontalAlignment('center')
    .setNumberFormat('0');
  try { sheet.setRowHeight(row, ROW_HEIGHTS.DATA); } catch (err) { /* row absent */ }
  return row + 1;
}

/** Menu: rebuild the month view on its own, from whatever the session tab currently says. */
function renderProgramMonthSheetNow() {
  renderProgramMonthDashboard(true);
  SpreadsheetApp.getActive().toast('Program_Month rebuilt from the session table.');
}
