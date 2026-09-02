// ============================================================================
// 6c. MEMORY TABS  (Member_Roll / Program_Options)
// ============================================================================
//
// Everything else in this workbook is derived: wipe it, re-sync, and it comes
// back. These two tabs are the exception — they're where the ORGANIZATION'S
// OWN knowledge accumulates, the things no calendar event or form response can
// tell you. "Marion always brings her sister." "This program needs the big
// room." "Cold lunch only, no dairy."
//
// Each tab is therefore split down the middle:
//   LEFT  — recomputed from the registrant/session history every refresh.
//           Never hand-edit; it will be overwritten.
//   RIGHT — MEMBER_ROLL_STAFF_COLUMNS / PROGRAM_OPTIONS_STAFF_COLUMNS. Written
//           only by people, never by this script. Keyed by Name (or
//           Event+Location), so a row keeps its notes as long as the key is
//           stable — and normalizeNameKey() makes the key survive the casing
//           and spacing drift that "Jane Smith" vs "jane smith " produces
//           across separate form submissions.
//
// This is also what the Quick Mark lists are built from — the unique
// people and programs, deduplicated once here rather than re-derived on every
// keystroke.
// ============================================================================

/**
 * Rebuilds both memory tabs from current data, preserving every staff column.
 * Called at the end of a registration sync (where the source rows are already
 * in memory) and from initSheet().
 */
function refreshMemoryTabs(registrantRows, sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    refreshMemberRoll(ss, registrantRows);
    // Resolved ONCE for the two tabs that want it. Both used to fall back to
    // reading the session table themselves when handed null, which is the
    // whole tab read twice per sync for the same rows.
    const sessions = sessionRows ||
      readAllSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD),
        HEADERS.Master_Program_Dashboard, 'Event_ID');
    // BEFORE refreshProgramOptions(), and that order is load-bearing on a
    // workbook that has not migrated yet: refreshProgramLeadersTab() carries
    // Program_Options' old Instructor_Email column onto its own tab, reading
    // it off the live sheet — and the Program_Options refresh below is the
    // write that finally rewrites that tab without the column. The other way
    // round, every address a site has been keeping is gone before anything
    // reads it. See migrateProgramLeaderAddresses().
    refreshProgramLeadersTab(ss, sessions);
    refreshProgramOptions(ss, sessions);
  } catch (err) {
    // Never let a memory-tab refresh take down a sync — these tabs are
    // reference material, not the system of record.
    log(`⚠️ Could not refresh the memory tabs (${err}) — the rest of the sync is unaffected.`);
  }
}

/**
 * One row per unique person, keyed on normalizeNameKey(Name). Recomputes the
 * history columns, carries the staff columns forward untouched, and keeps a
 * person on the roll even after their sessions age out — a member who came
 * once last year is still a member you might want notes on.
 */
function refreshMemberRoll(ss, registrantRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.MEMBER_ROLL);
  const headers = HEADERS.Member_Roll;
  const map = getIndexMap(headers);

  // What staff have already written, by person key.
  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = normalizeNameKey(row[map['Name']]);
    if (key) existingByKey[key] = row;
  });

  const lrHeaders = HEADERS.Registrant_Dash;
  const lrMap = getIndexMap(lrHeaders);
  const rows = registrantRows ||
    readAllSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), lrHeaders, 'Event_ID');

  const people = {};
  rows.forEach(row => {
    const name = String(row[lrMap['Name']] || '').trim();
    const key = normalizeNameKey(name);
    if (!key) return;
    const d = coerceDate(row[lrMap['Event_Date']]);
    if (!people[key]) {
      people[key] = { name, times: 0, first: d, last: d, locations: {}, lunches: {}, phone: '', email: '', contactAt: null };
    }
    const p = people[key];
    p.name = name; // last spelling seen wins for DISPLAY; the key stays stable
    p.times++;
    if (d && (!p.first || d < p.first)) p.first = d;
    if (d && (!p.last || d > p.last)) p.last = d;
    // The MOST RECENT contact details they gave, not the first: a phone number
    // is the kind of thing that changes, and the newest one somebody typed on
    // a form is the best guess this tab can make. Rows with no date at all
    // still count, but never displace a dated one.
    const phone = String(row[lrMap['Phone']] || '').trim();
    const email = String(row[lrMap['Email']] || '').trim();
    if ((phone || email) && (!p.contactAt || (d && d >= p.contactAt))) {
      if (phone) p.phone = phone;
      if (email) p.email = email;
      if (d) p.contactAt = d;
    }
    const loc = String(row[lrMap['Location']] || '').trim();
    if (loc) p.locations[loc] = true;
    const lunch = String(row[lrMap['Lunch_Type']] || '').trim();
    if (lunch && lunch !== 'No Lunch') p.lunches[lunch] = (p.lunches[lunch] || 0) + 1;
  });

  // Anyone already on the roll but absent from the current history stays,
  // with their computed columns left as they were.
  const outRows = [];
  const seen = {};
  Object.keys(people).sort((a, b) => people[a].name.localeCompare(people[b].name)).forEach(key => {
    const p = people[key];
    const row = new Array(headers.length).fill('');
    const prior = existingByKey[key];
    if (prior) MEMBER_ROLL_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
    row[map['Name']] = p.name;
    // Never blank out a number we already had just because the latest
    // submission omitted one — a known way to reach someone is not something
    // to lose to a skipped field.
    row[map['Phone']] = p.phone || (prior ? prior[map['Phone']] : '') || '';
    row[map['Email']] = p.email || (prior ? prior[map['Email']] : '') || '';
    row[map['Times_Seen']] = p.times;
    row[map['First_Seen']] = p.first || '';
    row[map['Last_Seen']] = p.last || '';
    row[map['Locations']] = Object.keys(p.locations).sort().join(', ');
    row[map['Usual_Lunch']] = pickMostFrequent(p.lunches);
    outRows.push(row);
    seen[key] = true;
  });
  Object.keys(existingByKey).forEach(key => {
    if (!seen[key]) outRows.push(existingByKey[key]);
  });

  writeMemoryTab(sheet, headers, outRows, memberRollTabOptions());
  log(`Member_Roll refreshed: ${outRows.length} member(s).`);
}

/**
 * How Member_Roll is drawn. One definition because it is written from two
 * places now — the refresh above and the door page's own writer
 * (recordWalkInMember()) — and a tab that comes back with a different banner
 * or a different set of tinted staff columns depending on which one touched it
 * last is a tab that looks broken.
 */
function memberRollTabOptions() {
  return {
    banner: '👤 Member Roll',
    bannerNote: 'Everyone who has ever registered for anything, whichever form they came in on.',
    staffColumns: MEMBER_ROLL_STAFF_COLUMNS,
    dateColumns: ['First_Seen', 'Last_Seen'],
    numberColumns: ['Times_Seen']
  };
}

/** One row per unique program (Event x Location), same recomputed/staff split. */
function refreshProgramOptions(ss, sessionRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_OPTIONS);
  const headers = HEADERS.Program_Options;
  const map = getIndexMap(headers);

  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = `${normalizeNameKey(row[map['Event']])}|${normalizeNameKey(row[map['Location']])}`;
    if (key !== '|') existingByKey[key] = row;
  });

  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regMap = getIndexMap(regHeaders);
  const rows = sessionRows ||
    readAllSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), regHeaders, 'Event_ID');

  const todayKey = formatDateKey(new Date());
  const programs = {};
  rows.forEach(row => {
    const title = String(row[regMap['Clean_Title']] || '').trim();
    const location = String(row[regMap['Location']] || '').trim();
    if (!title) return;
    const key = `${normalizeNameKey(title)}|${normalizeNameKey(location)}`;
    const d = coerceDate(row[regMap['Event_Date']]);
    if (!programs[key]) {
      programs[key] = { title, location, sessions: 0, next: null, last: null, typeTag: '', caps: {} };
    }
    const p = programs[key];
    p.sessions++;
    p.typeTag = normalizeTypeTag(row[regMap['Type_Tag']]);
    if (d) {
      const dk = formatDateKey(d);
      if (dk >= todayKey && (!p.next || d < p.next)) p.next = d;
      if (!p.last || d > p.last) p.last = d;
    }
    const cap = Number(row[regMap['Max_Capacity']]);
    if (cap > 0) p.caps[cap] = (p.caps[cap] || 0) + 1;
  });

  const outRows = [];
  const seen = {};
  Object.keys(programs)
    .sort((a, b) => programs[a].title.localeCompare(programs[b].title))
    .forEach(key => {
      const p = programs[key];
      const row = new Array(headers.length).fill('');
      const prior = existingByKey[key];
      if (prior) PROGRAM_OPTIONS_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
      row[map['Event']] = p.title;
      row[map['Location']] = p.location;
      row[map['Type_Tag']] = p.typeTag;
      row[map['Sessions_Tracked']] = p.sessions;
      row[map['Next_Date']] = p.next || '';
      row[map['Last_Date']] = p.last || '';
      // Only SUGGEST a capacity where the calendar is consistent about it —
      // the staff column is theirs to set, so this never overwrites it.
      if (!row[map['Usual_Capacity']]) row[map['Usual_Capacity']] = pickMostFrequent(p.caps);
      outRows.push(row);
      seen[key] = true;
    });
  Object.keys(existingByKey).forEach(key => {
    if (!seen[key]) outRows.push(existingByKey[key]);
  });

  writeMemoryTab(sheet, headers, outRows, programOptionsTabOptions());

  // The dropdowns run past the last row so the blank line under it has them
  // too (see MEMORY_TAB_SPARE_ROWS). Notify_Mode is a CLOSED list — every
  // legal answer is known, and a typo there would quietly change who gets
  // told about their appointment. Reminder_Days is open: the suggestions are
  // the cadences anyone actually asks for, and "14, 7, 1" is still valid.
  applyMemoryTabValidation(sheet, headers, outRows.length, {
    lists: { Notify_Mode: NOTIFY_MODE_LIST },
    openLists: { Reminder_Days: REMINDER_DAYS_SUGGESTIONS }
  });
  // The tab those settings are read from has just been rewritten; anything
  // asking again in this execution must see the rows as they now stand.
  invalidateNotificationPolicyCache();

  log(`Program_Options refreshed: ${outRows.length} program(s).`);
}

/**
 * Is this cell value a ticked checkbox? A Sheets checkbox reads back as a real
 * boolean, but the same column filled in by hand, pasted, or read back through
 * a formula can arrive as "TRUE"/"true"/"Yes"/1 — all of which a human plainly
 * meant as yes, and none of which `=== true` catches.
 */
function isTruthyCheckbox(value) {
  if (value === true) return true;
  if (value === 1) return true;
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === '✓';
}

/**
 * Reads one registrant row's five meal counts and maps them onto the lunch
 * dashboard columns they feed. Returns { total, byDashboardColumn }.
 *
 * THE LEGACY CASE, and why it needs handling rather than ignoring: before this
 * split, a row carried Dine_In_Count/Subs_Count plus a Meals_In_Fridge
 * CHECKBOX that meant "those meals were taken away, not eaten here." Those old
 * columns are read into Day1_Dined_In/Subs_Dined_In by LEGACY_HEADER_ALIASES,
 * which is the right reading for every row where the box was clear. Where it
 * was TICKED, the same numbers meant the opposite, so they are re-routed to
 * the takeaway columns here. Detection is deliberately narrow — an actual
 * boolean, which is what a Sheets checkbox reads back as, and never a number
 * someone has since typed into the same cell as a fridge COUNT.
 */
function readRegistrantMealCounts(row, map) {
  const out = { total: 0, byDashboardColumn: {} };
  const add = (column, amount) => {
    if (!(amount > 0)) return;
    out.byDashboardColumn[column] = (out.byDashboardColumn[column] || 0) + amount;
    out.total += amount;
  };

  const legacyTakeaway = isLegacyFridgeCheckbox(row[map['Meals_In_Fridge']]);
  REGISTRANT_MEAL_COUNT_COLUMNS.forEach(name => {
    if (map[name] === undefined) return;
    const raw = row[map[name]];
    if (name === 'Meals_In_Fridge' && legacyTakeaway) return; // a ticked box is not a count of one
    const amount = Number(raw) || 0;
    if (!(amount > 0)) return;
    let column = MEAL_COUNT_TO_DASHBOARD_COLUMN[name];
    if (legacyTakeaway && name === 'Day1_Dined_In') column = MEAL_COUNT_TO_DASHBOARD_COLUMN.Day1_Taken_Out;
    if (legacyTakeaway && name === 'Subs_Dined_In') column = MEAL_COUNT_TO_DASHBOARD_COLUMN.Subs_Taken_Out;
    add(column, amount);
  });
  return out;
}

/**
 * How many meals ONE registrant row is ordering.
 *
 * BLANK IS ONE. Every row written before Meals_Ordered existed is blank, and
 * every ordinary registration still is — so this reads the workbook's original
 * "one row, one meal" rule out of an empty cell rather than needing a
 * migration to write 1 into a hundred thousand of them.
 *
 * FLOORED AT ONE for a row that is having lunch, because a 0 here would be a
 * second way to say "no meal" and the workbook already has one that everything
 * else reads: Lunch_Status. A row that says Needed and 0 is somebody's typo,
 * and resolving a typo towards a missing meal is the one direction the lunch
 * numbers must never round (see lunchPersonEntry()).
 *
 * Non-numeric text ("four", "2 subs") reads as one for the same reason: the
 * row plainly wants feeding, and the alternative is dropping it.
 */
function readRegistrantMealsOrdered(row, map) {
  if (map['Meals_Ordered'] === undefined) return 1;
  const raw = row[map['Meals_Ordered']];
  const amount = Math.floor(Number(raw) || 0);
  return amount > 1 ? amount : 1;
}

/**
 * Where one registrant row's meals should be counted: { dateKey, location,
 * carried }.
 *
 * Three outcomes, and the third is the one worth being careful about:
 *
 *   BLANK Meal_Source — the row's own date and location, which is what this
 *   workbook has always assumed and what every row written before this column
 *   existed means. `carried` is false.
 *
 *   A Meal_ID that resolves — that batch's date and location. `carried` is
 *   true only when the batch's date differs from the handover's, so naming
 *   today's meal explicitly (which the dropdown makes easy) is not reported as
 *   a carry-over.
 *
 *   AN ORPHAN — a Meal_ID nothing on Lunch_Schedule answers to, because the
 *   menu row was re-dated, retyped or closed after someone pointed at it. The
 *   meals fall back to the row's own day, exactly as if the cell were blank,
 *   and a human is told. They must never be dropped: an unreadable reference
 *   is a reason to ask someone, not to lose a meal that demonstrably happened.
 */
function resolveMealSource(rawSource, meta, row, lrMap) {
  const fallback = { dateKey: meta.dateKey, location: meta.location, carried: false };
  const mealId = String(rawSource || '').trim();
  if (!mealId) return fallback;

  const batch = getMealBatchById(mealId);
  if (!batch) {
    noteForAdmin('Meal_Source points at a meal that no longer exists',
      `${String(row[lrMap['Name']] || '').trim() || '(unnamed)'} on ` +
      `${formatDateLabel(parseDateKey(meta.dateKey))} at ${meta.location} has Meal_Source "${mealId}", ` +
      `which is not on Lunch_Schedule. Their meals are counted under their own date until the ` +
      `reference is corrected — check that menu row's date and type.`);
    return fallback;
  }
  return {
    dateKey: batch.dateKey,
    location: batch.location,
    carried: batch.dateKey !== meta.dateKey
  };
}

/** True only for a real ticked CHECKBOX — the pre-split meaning of Meals_In_Fridge. See readRegistrantMealCounts(). */
function isLegacyFridgeCheckbox(value) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

/** The key with the highest count, or '' for an empty tally. */
function pickMostFrequent(counts) {
  const keys = Object.keys(counts || {});
  if (keys.length === 0) return '';
  return keys.sort((a, b) => counts[b] - counts[a])[0];
}

/**
 * Reads a plain (single header row at row 2, banner at row 1) tab into rows,
 * projected into `headers` order by NAME — so these tabs survive a layout
 * change the same way the sectioned ones do (see buildHeaderProjection()).
 */
function readSimpleTable(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < MEMORY_TAB_DATA_ROW) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const projection = buildHeaderProjection(sheet, MEMORY_TAB_HEADER_ROW, headers, lastCol);
  const numCols = projection ? lastCol : headers.length;
  let rows = getRowsPreservingFormulas(sheet, MEMORY_TAB_DATA_ROW, 1, lastRow - MEMORY_TAB_DATA_ROW + 1, numCols);
  if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));
  // Blank trailing rows are not members.
  return rows.filter(row => String(row[0] || '').trim() !== '');
}

/**
 * readSimpleTable() for a reader that only wants the data: one whole-grid
 * getValues() instead of a header read, a values read and a formulas read.
 * Same reasoning as readAllSectionedRowValues() — see there.
 */
function readSimpleTableValues(sheet, headers) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < MEMORY_TAB_DATA_ROW) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const projection = buildHeaderProjectionFromRow(grid[MEMORY_TAB_HEADER_ROW - 1], headers,
    `"${sheet.getName()}" row ${MEMORY_TAB_HEADER_ROW}`);
  return grid.slice(MEMORY_TAB_DATA_ROW - 1)
    .map(row => (projection ? projection.map(src => (src === -1 ? '' : row[src])) : row.slice(0, headers.length)))
    .filter(row => String(row[0] || '').trim() !== '');
}

const MEMORY_TAB_BANNER_ROW = 1;
const MEMORY_TAB_HEADER_ROW = 2;
const MEMORY_TAB_DATA_ROW = 3;

/**
 * HOW FAR A MEMORY TAB'S DROPDOWNS REACH BELOW THE LAST ROW.
 *
 * THE BUG THIS FIXES, and it is the one people actually hit: every one of
 * these tabs applied its dropdowns and checkboxes to `rows.length` rows —
 * exactly the rows that already existed. writeMemoryTab() clears every data
 * validation on the sheet first, so the row a person types their NEXT question
 * into had no dropdown on it, no checkbox in Required or Active, and no
 * warning when the Type was spelled "dropdown " with a trailing space. An
 * EMPTY tab was worse still: `rows.length` is 0, so the whole block was
 * skipped and the tab a person met on their first visit had nothing to pick
 * from anywhere on it.
 *
 * A tab is a form somebody fills in, so the blank line under the last row is
 * part of it. The dropdowns now run a band of spare rows past the data, and
 * ensureMemoryTabSpareRows() makes sure the sheet is long enough to hold them.
 *
 * Fifty because it is more rows than anyone adds between renders and few
 * enough that the validation write stays one call.
 */
const MEMORY_TAB_SPARE_ROWS = 50;

/**
 * How many rows a memory tab's validation should cover: the data, plus the
 * blank band under it. Always at least one, so an empty tab still gets its
 * dropdowns.
 */
function memoryTabValidationRows(rowCount) {
  return Math.max(Number(rowCount) || 0, 0) + MEMORY_TAB_SPARE_ROWS;
}

/**
 * Grows the sheet so the spare band exists to put validation on. A sheet that
 * is already long enough is left alone — insertRowsAfter() on a full-height
 * sheet is a write nobody needs.
 */
function ensureMemoryTabSpareRows(sheet, rowCount) {
  const needed = MEMORY_TAB_DATA_ROW + memoryTabValidationRows(rowCount) - 1;
  const have = sheet.getMaxRows();
  if (have >= needed) return;
  sheet.insertRowsAfter(have, needed - have);
}

/**
 * The two things every memory tab wants on its spare band as well as its data:
 * a real checkbox in each boolean column, and a dropdown on each column with a
 * fixed vocabulary.
 *
 * `spec.checkboxes` is a list of header names; `spec.lists` is
 * { header: [options] } for a restricted dropdown and `spec.openLists` the
 * same for a suggesting one (see applyOpenValueListValidationBounded).
 * Anything naming a column this tab hasn't got is skipped rather than
 * throwing, so a workbook on an older layout renders instead of failing.
 */
function applyMemoryTabValidation(sheet, headers, rowCount, spec) {
  const map = getIndexMap(headers);
  const span = memoryTabValidationRows(rowCount);
  ensureMemoryTabSpareRows(sheet, rowCount);

  (spec.checkboxes || []).forEach(header => {
    if (map[header] === undefined) return;
    sheet.getRange(MEMORY_TAB_DATA_ROW, map[header] + 1, span, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
      .setHorizontalAlignment('center');
  });
  Object.keys(spec.lists || {}).forEach(header => {
    if (map[header] === undefined) return;
    applyValueListValidationBounded(sheet, map[header] + 1, spec.lists[header],
      MEMORY_TAB_DATA_ROW, span);
  });
  Object.keys(spec.openLists || {}).forEach(header => {
    if (map[header] === undefined) return;
    applyOpenValueListValidationBounded(sheet, map[header] + 1, spec.openLists[header],
      MEMORY_TAB_DATA_ROW, span);
  });
  return span;
}

/** Writes a memory tab: banner, header row, data, and the yellow staff-column wash. */
function writeMemoryTab(sheet, headers, rows, options) {
  const numCols = headers.length;
  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols, options.banner, { note: options.bannerNote });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);
  labelManualEntryColumns(sheet, MEMORY_TAB_HEADER_ROW, headers, options.staffColumns);

  if (rows.length > 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1, rows.length, numCols).setValues(rows);
    const map = getIndexMap(headers);
    (options.dateColumns || []).forEach(h => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[h] + 1, rows.length, 1).setNumberFormat(DATE_DISPLAY_FORMAT);
    });
    (options.numberColumns || []).forEach(h => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[h] + 1, rows.length, 1).setNumberFormat('0');
    });
    applyZebraStripingManualBounded(sheet, MEMORY_TAB_DATA_ROW, rows.length, numCols);
    tintManualEntryColumns(sheet, MEMORY_TAB_DATA_ROW, rows.length, headers, options.staffColumns);
  }

  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  freezeColumnsSafely(sheet, 1); // the name/program is the row's identity — keep it visible
  autosizeColumns(sheet, { minCols: numCols, force: true });
}


