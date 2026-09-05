// ============================================================================
// 6e. LEGACY TAB MERGE  (mergeLegacyTabs / previewLegacyTabMerge)
// ============================================================================
//
// Layout changes inside a tab need no help: readAllSectionedRows() re-aligns
// rows by header NAME, so re-ordering or adding a column is invisible (see
// buildHeaderProjection()). What DOES get stranded is data sitting in a tab
// under a different NAME —
//
//   • Active_Programs            an early version of the session table
//   • Lunch_Schedule_OLD_<date>  renamed by initLunchScheduleSheet() when it
//                               found the old Month-based menu layout
//   • Config_OLD_<date>          same, for Config
//   • "Copy of …", "… (old)"     anything made by hand while troubleshooting
//
// — which is invisible to every sync and quietly rots. Worse,
// initSheet() used to DELETE Active_Programs outright without reading it.
//
// So this identifies those tabs BY CONTENT (how well their header row matches
// each canonical layout, not by guessing at names), merges their rows into the
// right current tab, and only then deletes them.
//
// MERGE RULE: existing rows win. A legacy row is added only when its identity
// key isn't already present, so re-running is idempotent and nothing current is
// ever overwritten by something older. Every merged row is stamped in
// Admin_Notes/Triage_Notes where the tab has such a column, so its provenance
// is visible afterwards.
// ============================================================================

/**
 * Which canonical tab a legacy tab's rows belong to, plus how to tell two rows
 * apart. `identity` receives (row, map) and returns a dedup key, or '' for a
 * row too incomplete to place.
 */
function getMergeTargets() {
  return [
    {
      sheetName: SHEET_NAMES.PROGRAM_DASHBOARD,
      headers: HEADERS.All_Program_Sessions,
      marker: 'Event_ID',
      identity: (row, map) => String(row[map['Event_ID']] || '').trim(),
      render: rows => renderProgramDashboardFromRows(rows)
    },
    {
      sheetName: SHEET_NAMES.REGISTRANT_DASH,
      headers: HEADERS.All_Registrants,
      marker: 'Event_ID',
      identity: (row, map) => {
        const eventId = String(row[map['Event_ID']] || '').trim();
        const name = normalizeNameKey(row[map['Name']]);
        if (!eventId || !name) return '';
        return `${eventId}|${name}|${row[map['Person_Type']] || ''}`;
      },
      noteColumn: 'Admin_Notes',
      render: rows => renderRegistrantsSheet(true, rows)
    },
    {
      sheetName: SHEET_NAMES.TRIAGE,
      headers: HEADERS.Deleted_Event_Triage,
      marker: 'Event_ID',
      identity: (row, map) => {
        const eventId = String(row[map['Event_ID']] || '').trim();
        const name = normalizeNameKey(row[map['Name']]);
        if (!eventId || !name) return '';
        return `${eventId}|${name}|${row[map['Person_Type']] || ''}`;
      },
      noteColumn: 'Triage_Notes',
      render: rows => renderTriageSheet(true, rows)
    },
    {
      sheetName: SHEET_NAMES.LUNCH_SCHEDULE,
      headers: HEADERS.Lunch_Schedule,
      marker: 'Event_Date',
      identity: (row, map) => {
        const d = coerceDate(row[map['Event_Date']]);
        if (!d) return '';
        return `${formatDateKey(d)}|${String(row[map['Location']] || '').trim()}`;
      },
      // Not the generic read: this tab's ADD block sits below its tables and
      // holds dated rows that are NOT schedule yet — see getLunchScheduleEndRow().
      readCurrent: sheet => readLunchScheduleRows(sheet),
      render: rows => renderLunchScheduleSheet(true, rows)
    }
  ];
}

/**
 * Tabs that must never be treated as legacy, whatever their contents look
 * like: the canonical set itself, plus Config (its own layout, migrated
 * separately by buildConfigSheet()) and the two memory tabs (rebuilt from
 * source data, so merging into them would fight refreshMemoryTabs()).
 */
function getProtectedTabNames() {
  // Plus the hidden queue behind the flag checkboxes: it is small, oddly
  // shaped and machine-written, which is exactly the profile the legacy-tab
  // scanner is built to notice.
  // Plus every name a canonical tab used to carry: a workbook mid-migration
  // still has its data under the old name, and the scanner would otherwise
  // offer to merge a tab that is about to simply be renamed into place.
  return Object.values(SHEET_NAMES)
    .concat(Object.keys(LEGACY_SHEET_RENAMES).reduce((names, k) => {
      const entry = LEGACY_SHEET_RENAMES[k];
      return names.concat(Array.isArray(entry) ? entry : [entry]);
    }, []))
    .concat([PENDING_FLAG_SHEET_NAME]);
}

/** A legacy tab must have at least this many of a target's columns, and this share of ITS OWN columns recognized. */
const LEGACY_MATCH_MIN_COLUMNS = 4;
const LEGACY_MATCH_MIN_PRECISION = 0.7;

/**
 * Scores a tab against every merge target and returns the best match, or null.
 *
 * Content, not name: "Copy of Registrants (2)" and "Active_Programs" are the
 * same problem, and only their headers say what they hold.
 *
 * SCORED BY PRECISION, NOT COVERAGE — how many of the TAB'S OWN columns are
 * recognized, not how much of the target it fills. A legacy tab is by
 * definition an OLDER layout, so it's missing whatever has been added since;
 * scoring it against the target's full width punishes exactly the tabs worth
 * rescuing (a 9-column old Registrants tab covers only half of today's 18, and
 * a coverage test threw it away). Precision asks the right question: does
 * everything on this tab look like it belongs to that layout?
 *
 * Guards against false positives: the target's MARKER column must be present
 * (without it the rows can't be read at all), at least
 * LEGACY_MATCH_MIN_COLUMNS must match so a two-column coincidence can't
 * qualify, and coverage breaks ties — which is what separates a legacy
 * Registrants tab from Triage, whose layout is a superset of it.
 */
function classifyLegacyTab(sheet) {
  const lastRow = Math.min(sheet.getLastRow(), 50); // a header row is near the top or nowhere
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return null;

  const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  let best = null;

  getMergeTargets().forEach(target => {
    const wanted = target.headers.map(h => h.toLowerCase());
    for (let r = 0; r < grid.length; r++) {
      const names = grid[r].map(v => normalizeHeaderText(v).toLowerCase()).filter(Boolean);
      if (names.length === 0) continue;
      if (names.indexOf(target.marker.toLowerCase()) === -1) continue;

      const matched = names.filter(n => wanted.indexOf(n) !== -1).length;
      if (matched < LEGACY_MATCH_MIN_COLUMNS) continue;
      const precision = matched / names.length;      // is everything here ours?
      if (precision < LEGACY_MATCH_MIN_PRECISION) continue;
      const coverage = matched / wanted.length;      // tie-breaker only

      if (!best || precision > best.precision ||
        (precision === best.precision && coverage > best.coverage)) {
        best = { target, headerRow: r + 1, precision, coverage, matched, score: precision };
      }
    }
  });

  return best;
}

/** Every non-protected tab that looks like legacy data, with what it matched. */
function findLegacyTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const protectedNames = getProtectedTabNames();
  const found = [];

  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (protectedNames.indexOf(name) !== -1) return;
    // Config_OLD_* is Config's own layout, which has no marker column and is
    // handled by buildConfigSheet()'s own migration — classifyLegacyTab()
    // will score it at 0, but skip it explicitly so the report can say why.
    const match = classifyLegacyTab(sheet);
    if (!match) return;
    found.push({
      sheet,
      name,
      target: match.target,
      headerRow: match.headerRow,
      score: match.score,
      matched: match.matched,
      rowCount: Math.max(sheet.getLastRow() - match.headerRow, 0)
    });
  });

  return found;
}

/**
 * READ-ONLY. Reports what mergeLegacyTabs() would do — which tabs it found,
 * what each matched, and how many rows are in them. Changes nothing.
 */
function previewLegacyTabMerge() {
  if (!requireAuthorizedAdmin('Preview Legacy Tab Merge')) return [];
  const found = findLegacyTabs();
  if (found.length === 0) {
    log('previewLegacyTabMerge: no legacy tabs found — nothing to merge.');
    toastIfPossible('No leftover tabs found — nothing to merge.');
    return [];
  }
  log(`previewLegacyTabMerge: ${found.length} tab(s) look like legacy data:`);
  found.forEach(f => {
    log(`  • "${f.name}" -> ${f.target.sheetName} ` +
      `(header row ${f.headerRow}, ${f.rowCount} data row(s), ` +
      `${f.matched} matching column(s), ${Math.round(f.score * 100)}% of its columns recognized)`);
  });
  toastIfPossible(`${found.length} leftover tab(s) found — see the log, then run mergeLegacyTabs().`);
  return found;
}

/**
 * Pulls the data out of every legacy tab into the current tabs, then deletes
 * the legacy tabs.
 *
 * DESTRUCTIVE, and gated accordingly: admin only, and it names every tab it is
 * about to delete before doing anything. A tab is deleted ONLY after its rows
 * have been read AND the merged result written back successfully — a failure
 * anywhere leaves the tab in place to try again.
 *
 * Deleted tabs are recoverable for a while from the spreadsheet's own version
 * history (File > Version history), which is the real safety net here; this
 * function does not keep its own copy, because a workbook full of
 * "…_OLD_OLD_2" tabs is the mess it exists to clean up.
 */
function mergeLegacyTabs() {
  if (!requireAuthorizedAdmin('Merge Legacy Tabs')) return 0;

  const found = findLegacyTabs();
  if (found.length === 0) {
    log('mergeLegacyTabs: no legacy tabs found — nothing to do.');
    toastIfPossible('No leftover tabs found — nothing to merge.');
    return 0;
  }

  const summary = found
    .map(f => `• "${f.name}" → ${f.target.sheetName}  (${f.rowCount} row(s))`)
    .join('\n');
  if (!confirmConsequentialAction('Merge and delete these leftover tabs?',
    `${summary}\n\nTheir rows will be added to the current tabs (existing rows are never ` +
    `overwritten), and then these tabs will be DELETED.\n\n` +
    `You can recover a deleted tab from File > Version history.`, false)) {
    return 0;
  }

  // Group by destination so each target tab is written exactly once.
  const byTarget = {};
  found.forEach(f => {
    if (!byTarget[f.target.sheetName]) byTarget[f.target.sheetName] = { target: f.target, sources: [] };
    byTarget[f.target.sheetName].sources.push(f);
  });

  let mergedRows = 0;
  let deletedTabs = 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(byTarget).forEach(sheetName => {
    const { target, sources } = byTarget[sheetName];
    const map = getIndexMap(target.headers);

    let current;
    try {
      const targetSheet = getOrCreateSheet(ss, sheetName);
      current = target.readCurrent
        ? target.readCurrent(targetSheet)
        : getSectionedRows(targetSheet, target.headers, target.marker);
    } catch (err) {
      log(`⚠️ mergeLegacyTabs: could not read "${sheetName}" (${err}) — skipping its sources, tabs left in place.`);
      return;
    }

    const seen = {};
    current.forEach(row => {
      const key = target.identity(row, map);
      if (key) seen[key] = true;
    });

    const added = [];
    const consumed = [];
    sources.forEach(source => {
      let rows;
      try {
        rows = readLegacyTabRows(source, target);
      } catch (err) {
        log(`⚠️ mergeLegacyTabs: could not read "${source.name}" (${err}) — left in place.`);
        return;
      }
      let kept = 0;
      rows.forEach(row => {
        const key = target.identity(row, map);
        if (!key || seen[key]) return; // unplaceable, or the current tab already has it
        seen[key] = true;
        stampMergeProvenance(row, map, target, source.name);
        added.push(row);
        kept++;
      });
      log(`mergeLegacyTabs: "${source.name}" → ${sheetName}: ${kept} new row(s) of ${rows.length} read.`);
      consumed.push(source);
    });

    if (added.length > 0) {
      try {
        target.render(current.concat(added));
      } catch (err) {
        // The write failed, so the sources are still the only copy — keep them.
        log(`⚠️ mergeLegacyTabs: could not write the merged "${sheetName}" (${err}) — source tabs left in place.`);
        return;
      }
      mergedRows += added.length;
    }

    // Only now — rows are safely in the target (or were already there).
    consumed.forEach(source => {
      try {
        ss.deleteSheet(source.sheet);
        deletedTabs++;
        log(`Deleted legacy tab "${source.name}".`);
      } catch (err) {
        log(`⚠️ mergeLegacyTabs: merged "${source.name}" but could not delete it (${err}) — remove it by hand.`);
      }
    });
  });

  // The memory tabs are derived, so rebuild them from whatever just arrived.
  refreshMemoryTabs(null, null);

  const headline = `Merged ${mergedRows} row(s) from ${deletedTabs} leftover tab(s) ✅`;
  log(`mergeLegacyTabs complete: ${headline}`);
  toastIfPossible(headline);
  return mergedRows;
}

/**
 * Reads one legacy tab's rows, projected into the target's column order by
 * header NAME (so a tab whose columns are in any order, or missing some,
 * still lands correctly).
 */
function readLegacyTabRows(source, target) {
  const sheet = source.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow <= source.headerRow) return [];

  const lastCol = Math.max(sheet.getLastColumn(), target.headers.length);
  const projection = buildHeaderProjection(sheet, source.headerRow, target.headers, lastCol);
  const numCols = projection ? lastCol : target.headers.length;
  let rows = getRowsPreservingFormulas(sheet, source.headerRow + 1, 1, lastRow - source.headerRow, numCols);
  if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));

  // Drop banner/spacer rows: on a date-keyed tab, anything without a real date.
  const map = getIndexMap(target.headers);
  const dateIdx = map['Event_Date'];
  if (dateIdx !== undefined) rows = rows.filter(row => coerceDate(row[dateIdx]));
  return rows.filter(row => row.some(v => String(v || '').trim() !== ''));
}

/** Notes on a merged row where it came from, so its provenance is visible on the tab. */
function stampMergeProvenance(row, map, target, sourceName) {
  if (!target.noteColumn || map[target.noteColumn] === undefined) return;
  const existing = String(row[map[target.noteColumn]] || '').trim();
  const stamp = `Merged from "${sourceName}" on ${Utilities.formatDate(new Date(), TIMEZONE, 'M/d/yyyy')}.`;
  row[map[target.noteColumn]] = existing ? `${existing} | ${stamp}` : stamp;
}

/**
 * Renders the session table from an explicit row set. renderProgramDashboard()
 * always re-reads the sheet itself, so a merge needs a way to seed it: the rows
 * are written first, then the normal render picks them up.
 */
function renderProgramDashboardFromRows(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const headers = HEADERS.All_Program_Sessions;

  // Write the combined rows into a bare table the normal render will find,
  // then let renderProgramDashboard() lay it out properly.
  invalidateSectionedRowsCache(sheet);
  sheet.clear();
  sheet.clearFormats();
  writeSectionHeader(sheet, 1, headers.length, headers);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  renderProgramDashboard(true);
}


