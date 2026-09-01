// ============================================================================
// 6g. THE TRIAGE TAB  (sessions the calendar stopped mentioning)
// ============================================================================

function renderTriageSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.TRIAGE);
  const headers = HEADERS.Deleted_Event_Triage;
  const rows = allRows || readAllSectionedRows(sheet, headers, 'Event_ID');
  return renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming (Triaged)',
    pastLabel: '🕓 Past (Triaged)',
    // Triage rows are registrant rows — same column, same coercion.
    textColumns: ['Event_Time'],
    force,
    afterWrite: applyRegistrantsFormatting
  });
}

/**
 * Shared formatting for Registrant_Dash AND Deleted_Event_Triage
 * — both carry the same Manual_Override / Program_Status / Lunch_Status /
 * Order_Ahead_Flag / Event_Date columns, just with Triage adding a few
 * extra trailing columns that don't need special styling beyond zebra.
 */
/**
 * Columns on Registrants/Triage a person is MEANT to fill in. Everything else
 * on the row came from a form or is derived, and gets no yellow — so "yellow
 * means yours" holds across every tab in the workbook (same wash as the lunch
 * dashboard's hand-entry columns, via labelManualEntryColumns()).
 */
const REGISTRANT_EDITABLE_COLUMNS = [
  'Attended', 'Lunch_Served',
  'Meals_Ordered',
  'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
  'Meal_Source',
  'Phone', 'Lunch_Type', 'Lunch_Status', 'Program_Status', 'Earlier_Appointment', 'Admin_Notes'
].concat(INSTRUCTOR_OWNED_COLUMNS);

/**
 * Columns that only ever matter when something has gone wrong — internal keys
 * and the raw form link. Hidden during normal use; unhide from the Sheets UI
 * (or read them in the formula bar) when debugging.
 *
 * Manual_Override is NOT hidden despite being machine-written: it is the one
 * column that explains why a row is a different color, and hiding the legend
 * to a color you can plainly see is worse than the column costing a little
 * width.
 */
const REGISTRANT_HIDDEN_COLUMNS = ['Event_ID', 'Party_ID', 'Form_Source'];

/** Member_Roll columns that come off the forms rather than from staff — refreshed, not hand-kept. */
const MEMBER_ROLL_DERIVED_CONTACT_COLUMNS = ['Phone', 'Email'];

function applyRegistrantsFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];

  zones.forEach(z => {
    if (z.count < 1) return;
    applyManualOverrideValidationBounded(sheet, map['Manual_Override'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Program_Status'] + 1, PROGRAM_STATUS_OPTIONS, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Status'] + 1, LUNCH_STATUS_OPTIONS, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Type'] + 1, REGISTRANT_LUNCH_TYPE_OPTIONS, z.start, z.count);
    // Staff hear this on the telephone far more often than anybody ticks it on
    // a form, so the column is theirs to set — see EARLIER_APPOINTMENT_CHOICES.
    if (map['Earlier_Appointment'] !== undefined) {
      applyValueListValidationBounded(sheet, map['Earlier_Appointment'] + 1,
        EARLIER_APPOINTMENT_OPTIONS, z.start, z.count);
    }
    // Real checkboxes, not free text: a tick is one click and reads back as a
    // boolean, which is what Served_Confirmed counts.
    REGISTRANT_DAYOF_COLUMNS.concat(INSTRUCTOR_FLAG_COLUMNS).forEach(h => {
      if (map[h] === undefined) return;
      sheet.getRange(z.start, map[h] + 1, z.count, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });
    // Whole meal counts, not free text — this is what buildDashboardRollup()
    // sums into Master_Lunch_Dashboard's Day_1_*/Subs_* columns, plus
    // Meals_Ordered, which is the same kind of number on the ordering side.
    REGISTRANT_MEAL_QUANTITY_COLUMNS.forEach(h => {
      if (map[h] === undefined) return;
      sheet.getRange(z.start, map[h] + 1, z.count, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation()
          .requireNumberGreaterThanOrEqualTo(0)
          .setAllowInvalid(false)
          .build())
        .setNumberFormat('0')
        .setHorizontalAlignment('center');
    });
    // Meal_Source offers the batches anyone could plausibly still be handing
    // out, newest first, and accepts anything — allowInvalid, like every other
    // list on this tab, because a paste must never be rejected and because a
    // batch that has aged off the list is still a legitimate thing to name.
    // Blank stays the normal value: it means today's meal.
    if (map['Meal_Source'] !== undefined) {
      applyOpenValueListValidationBounded(sheet, map['Meal_Source'] + 1,
        getRecentMealIdOptions(), z.start, z.count);
    }
  });

  const overrideCol = map['Manual_Override'] + 1;
  const programCol = map['Program_Status'] + 1;
  const lunchCol = map['Lunch_Status'] + 1;
  const orderAheadCol = map['Order_Ahead_Flag'] + 1;
  const dateCol = map['Event_Date'] + 1;
  const editableCols = REGISTRANT_EDITABLE_COLUMNS
    .filter(h => map[h] !== undefined)
    .map(h => map[h] + 1);

  const rules = [];
  zones.forEach(z => {
    if (z.count < 1) return;
    // MANUAL_OVERRIDE, RECONSIDERED. It used to tint most of the row purple,
    // which fought with every other signal on it: the status colors, the
    // month tint, and now the yellow editable band. On a tab where the
    // interesting question is "who still needs marking?", a whole-row wash
    // for "this row was hand-edited" is the least useful thing competing for
    // the strongest visual channel.
    //
    // So the tint is now confined to the Manual_Override CELL itself — the
    // column that names the state — and the row is left to say what staff
    // actually scan for. The information is not lost, just demoted to where
    // it belongs, and the cell is still impossible to miss when you look at
    // the column.
    const overrideRange = sheet.getRange(z.start, overrideCol, z.count, 1);
    ['Manually Edited', 'Manually Added'].forEach(text => {
      const rule = buildTextEqualsRuleForRanges([overrideRange], text, MANUAL_OVERRIDE_COLOR);
      if (rule) rules.push(rule);
    });
  });

  const activeZones = zones.filter(z => z.count > 0);
  const programRanges = activeZones.map(z => sheet.getRange(z.start, programCol, z.count, 1));
  const lunchRanges = activeZones.map(z => sheet.getRange(z.start, lunchCol, z.count, 1));
  const orderAheadRanges = activeZones.map(z => sheet.getRange(z.start, orderAheadCol, z.count, 1));

  ['Cancelled', 'Waitlisted', 'Active', 'Superseded'].forEach(text => {
    const rule = buildTextEqualsRuleForRanges(programRanges, text, REGISTRANT_STATUS_COLORS[text]);
    if (rule) rules.push(rule);
  });
  ['Cancelled', 'Waitlisted', 'Needed', 'Superseded'].forEach(text => {
    const rule = buildTextEqualsRuleForRanges(lunchRanges, text, REGISTRANT_STATUS_COLORS[text]);
    if (rule) rules.push(rule);
  });
  if (orderAheadRanges.length > 0) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(ORDER_AHEAD_FLAG_COLOR).setRanges(orderAheadRanges).build());
  }

  // Location color-coding on the Location cell, same as every other tab.
  const locRanges = activeZones.map(z => sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  rules.push(...buildLocationColorRules(locRanges));

  sheet.setConditionalFormatRules(rules);

  // The yellow "this is yours to fill in" wash, and the header pencils that
  // label it — identical treatment to Master_Lunch_Dashboard's columns.
  labelManualEntryColumns(sheet, result.upcomingHeaderRow, headers, REGISTRANT_EDITABLE_COLUMNS);
  labelManualEntryColumns(sheet, result.pastHeaderRow, headers, REGISTRANT_EDITABLE_COLUMNS);
  zones.forEach(z => {
    if (z.count < 1) return;
    tintManualEntryColumns(sheet, z.start, z.count, headers, REGISTRANT_EDITABLE_COLUMNS);
  });

  applyColumnVisibility(sheet, headers, REGISTRANT_HIDDEN_COLUMNS);
  // Name is the row's identity; keep it and the date on screen while scrolling
  // right through the form-supplied columns.
  freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, headers.length));

  // Warn (don't block) on the columns the sync owns — a correction typed into
  // Event_Date or Name doesn't move the registration, it just gets overwritten
  // and loses the row's link to its session.
  protectDerivedColumns(sheet, headers,
    ['Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Person_Type', 'Primary_Registrant',
      'Party_Size', 'Order_Ahead_Flag', 'Event_ID', 'Party_ID'],
    zones);

  // No autosize here on purpose: this runs as renderFlatDateSheet()'s
  // afterWrite hook, and that function autosizes immediately afterward.
  // Doing it in both places sized Registrants and Triage twice per render.
}

/**
 * Warning-only protection on columns this script OWNS and rewrites.
 *
 * Deliberately warning-based (setWarningOnly(true)) rather than a hard lock:
 * a hard protection would also block this script's own writes unless every
 * render remembered to unprotect and re-protect, and an admin who genuinely
 * needs to correct a cell shouldn't have to go hunting through protection
 * settings to do it. What people actually need is to be TOLD, at the moment
 * they type, that the value is derived and will be overwritten — which is
 * exactly what the warning dialog says.
 *
 * Re-created from scratch each render (matched by description) so the
 * protected range always matches the columns actually there.
 */
const PROTECTION_TAG = 'Auto-managed by Calendar & Form Manager';

function protectDerivedColumns(sheet, headers, protectedNames, zones) {
  const map = getIndexMap(headers);

  // Cleared ONCE, for the whole sheet, before anything is re-created —
  // clearing per zone would have each zone wipe the previous one's work.
  // Only this script's own protections are touched; anyone else's are left be.
  //
  // The whole call is guarded, not just the per-protection remove(): the
  // protection API needs authorization the script does not have inside a
  // simple onEdit trigger, and a render IS reachable from there (a Quick Mark
  // walk-in rebuilds this tab). Warning labels are a nicety; aborting a
  // render that has already cleared the sheet is not survivable.
  try {
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter(p => String(p.getDescription() || '').indexOf(PROTECTION_TAG) === 0)
      .forEach(p => {
        try { p.remove(); } catch (err) { /* someone else's, or already gone */ }
      });
  } catch (err) {
    log(`ℹ️ Could not read protections on "${sheet.getName()}" (${err}) — leaving them as they are.`);
    return;
  }

  (zones || []).forEach(z => {
    if (z.count < 1) return;
    protectedNames.forEach(name => {
      const idx = map[name];
      if (idx === undefined) return;
      try {
        sheet.getRange(z.start, idx + 1, z.count, 1)
          .protect()
          .setDescription(`${PROTECTION_TAG} — "${name}" is filled in automatically and will be overwritten.`)
          .setWarningOnly(true);
      } catch (err) {
        log(`ℹ️ Could not set a protection warning on "${name}" of ${sheet.getName()} (${err}).`);
      }
    });
  });
}

/**
 * Hides the columns named in `hiddenNames` and shows every other one, so a
 * re-render can't leave a column hidden after it's been taken off the list.
 */
function applyColumnVisibility(sheet, headers, hiddenNames) {
  const map = getIndexMap(headers);
  const hide = new Set((hiddenNames || []).filter(h => map[h] !== undefined).map(h => map[h] + 1));
  for (let c = 1; c <= headers.length; c++) {
    try {
      if (hide.has(c)) sheet.hideColumns(c); else sheet.showColumns(c);
    } catch (err) { /* a column beyond the sheet's width — nothing to hide */ }
  }
}

function renderLunchScheduleSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_SCHEDULE);
  const headers = HEADERS.Lunch_Schedule;
  const rows = stampMealIds(allRows || readLunchScheduleRows(sheet));
  const result = renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Menu',
    pastLabel: '🕓 Past Menu',
    force,
    afterWrite: applyLunchScheduleFormatting
  });
  invalidateMealInfoIndex(); // this tab is exactly what getMealInfoIndex() is built from
  return result;
}

/**
 * Fills in every row's Meal_ID before the tab is written.
 *
 * Unconditional, not fill-the-blanks: the ID is a pure function of the row's
 * date, location and type, so a stale one (the date was corrected, the day was
 * closed) has to be replaced rather than kept. This is the single place the
 * column is written, and it runs on every render — which is what lets an
 * existing workbook pick the column up with no migration.
 */
function stampMealIds(rows) {
  const map = getIndexMap(HEADERS.Lunch_Schedule);
  if (map['Meal_ID'] === undefined) return rows || [];
  (rows || []).forEach(row => {
    // The Type cell is canonicalized in passing, on the one pass that already
    // rewrites every row. A value that arrived past the dropdown (a paste
    // brings its own validation) is otherwise compared verbatim everywhere
    // downstream, and "not serving" is not 'Not Serving' — see
    // getMealInfoIndex(). Fixing the cell means it only has to be got right
    // once, instead of at every reader.
    if (map['Type'] !== undefined) {
      const canonical = canonicalizeLunchType(row[map['Type']]);
      if (canonical) row[map['Type']] = canonical;
    }
    row[map['Meal_ID']] = deriveMealId(row[map['Event_Date']], row[map['Location']], row[map['Type']]);
  });
  return rows || [];
}

function applyLunchScheduleFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];

  zones.forEach(z => {
    if (z.count < 1) return;
    applyValueListValidationBounded(sheet, map['Location'] + 1, Object.values(CALENDAR_MAP), z.start, z.count);
    applyValueListValidationBounded(sheet, map['Type'] + 1, LUNCH_TYPE_OPTIONS, z.start, z.count);
  });

  const rules = [];
  const activeZones = zones.filter(z => z.count > 0);
  const locRanges = activeZones.map(z => sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  rules.push(...buildLocationColorRules(locRanges));

  const typeRanges = activeZones.map(z => sheet.getRange(z.start, map['Type'] + 1, z.count, 1));
  const notServingRule = buildTextEqualsRuleForRanges(typeRanges, 'Not Serving', NOT_SERVING_COLOR);
  if (notServingRule) rules.push(notServingRule);

  sheet.setConditionalFormatRules(rules);

  // Meal_ID is computed from the three columns to its left on every render, so
  // typing into it is work that disappears at the next sync. Same warning the
  // dashboard's derived columns get.
  protectDerivedColumns(sheet, headers, ['Meal_ID'], zones);

  // The ADD block goes last, below everything, so a paste of any size just
  // extends the sheet downward instead of colliding with the tables.
  writeLunchAddBlock(sheet, result.nextRow + 1);
}

/**
 * Writes the "paste your CSV here" block at the bottom of Lunch_Schedule.
 *
 * BELOW the tables on purpose. A paste area at the TOP has to be a fixed
 * height, and a 40-row paste into a 12-row box overflows into whatever is
 * beneath it — which on this tab is the live schedule. At the bottom there is
 * nothing to overflow into: the paste simply makes the sheet taller, and
 * harvestPastedMenuRows() sweeps everything from the header row down.
 */
function writeLunchAddBlock(sheet, startRow) {
  const numCols = LUNCH_ADD_HEADERS.length;
  // Make room BEFORE writing anything: getRange() throws on a row that isn't
  // there, and on a freshly-cleared tab the schedule can easily run past the
  // sheet's default height.
  const needed = startRow + 1 + LUNCH_ADD_BLANK_ROWS;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());

  // The marker itself and nothing else. findLunchAddBlock() matches on the
  // START of this cell, so the trailing instructions were never load-bearing —
  // they were four lines of blue explaining a block whose own column headers
  // sit directly beneath it and say the same thing.
  writeSectionBanner(sheet, startRow, numCols, LUNCH_ADD_MARKER, {
    note: 'Paste rows here: Date, Location, Type, Description, Shorthand.\n\n' +
      'One row or a hundred — they move up into the schedule above by themselves, ' +
      'and this block empties again.'
  });

  const headerRow = startRow + 1;
  sheet.getRange(headerRow, 1, 1, numCols)
    .setValues([LUNCH_ADD_HEADERS])
    .setFontWeight('bold')
    .setFontSize(TYPO.COLUMN_HEADER.size)
    .setFontColor(TYPO.COLUMN_HEADER.color)
    .setBackground(TYPO.COLUMN_HEADER.background);

  const firstRow = headerRow + 1;
  const blankRows = LUNCH_ADD_BLANK_ROWS;
  const entry = sheet.getRange(firstRow, 1, blankRows, numCols);
  entry.setBackground(MANUAL_ENTRY_CELL_TINT)
    .setBorder(true, true, true, true, true, true, '#D9D9D9', SpreadsheetApp.BorderStyle.SOLID);

  // Dropdowns on the two columns with a fixed vocabulary. requireValueInList's
  // second argument false = show the list but DON'T reject anything else:
  // a paste must never be blocked by validation, and canonicalizeLocation() /
  // canonicalizeLunchType() already snap free text onto these values.
  const locationRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.values(CALENDAR_MAP), true).setAllowInvalid(true).build();
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(LUNCH_TYPE_OPTIONS, true).setAllowInvalid(true).build();
  sheet.getRange(firstRow, 2, blankRows, 1).setDataValidation(locationRule);
  sheet.getRange(firstRow, 3, blankRows, 1).setDataValidation(typeRule);
}


