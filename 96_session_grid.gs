// ============================================================================
// 96. ONE READ OF A TAB, ONE WRITE  (the sync's reconcile phase)
// ============================================================================
//
// WHAT THIS IS FOR. importCalendarGroups() runs six passes over the session
// table before it opens a single form: the two flag reconciles (22), the times,
// the assistance settings, the [No Registration] effects and the link columns
// (23). Every one of them was written the same sensible way — find the tab's
// header rows, read the columns it cares about, write the ones it changed —
// and every one of them was correct and cheap on its own.
//
// Six of them together were not. Each began with findProgramSessionHeaderRows(),
// which reads the WHOLE GRID to find the rows holding the word "Event_ID", and
// then read three to nine single columns PER SECTION ZONE, and wrote back a
// column at a time. On a workbook of 432 session rows that measured (see
// tools/sync_bench.js) at 142 round trips and 86,602 cells — six full reads of
// one tab to answer six questions about it, none of which had changed the tab
// in a way the next one needed to re-read.
//
// So the tab is read ONCE and the answers are staged in memory:
//
//     withSessionGrid(sheet, () => {
//       reconcileProgramFlagColumns(sheet, groups);   // ... and the other five
//     });                                             // one flush, here
//
// THE ORDER OF EFFECTS IS UNCHANGED, and that is the property this has to
// keep. Each pass used to see the previous pass's writes because it re-read
// the sheet; each pass now sees them because they mutate the same arrays. A
// pass reading a column another pass has just staged gets the new value in
// both worlds. What changes is only WHEN the sheet is told — which is why the
// flush is not optional and why nothing may read the tab through any other
// route while a scope is open (see flushSessionGrid()).
//
// OUTSIDE A SCOPE, each pass loads and flushes for itself. That is deliberate:
// applySessionTimesToRows() and applyAssistanceSettingsToRows() are also
// called from collapseTimeBlockRun() (56) and the program review (58), where
// there is no sync around them and the write has to land before the function
// returns. Those callers keep the behavior they had, at one grid read instead
// of one grid read plus a column read per zone.
//
// FORMULAS ARE PRESERVED, and that is what lets the link columns be written in
// a batch at all. Form_Response_Link holds "=HYPERLINK(...)" and getValues()
// hands back the words it displays, so updateRegistrationLinkCells() wrote
// those cells ONE AT A TIME rather than flatten a whole column of live links
// into the text "View Live Form". Reading the formulas alongside the values —
// the same merge readSectionedGrid_() (34) has always done — removes the
// reason for that, so the column goes back in one call with every untouched
// link still a link.
//
// INVALIDATION IS THE WHOLE RISK, exactly as it is for the sectioned reads
// this sits beside, and it is answered the same way: the grid cache is dropped
// by invalidateSectionedRowsCache() (08), which every path that writes to one
// of these tabs already calls. There is no second list to keep in step.
//
// Numbered last for the usual reason — never renumber, and this landed after
// 95. Safe there: behavior only, its one constant stands alone, its schema is
// HEADERS in 03 like every other tab's, and everything it calls (coerceDate,
// normalizeHeaderText, invalidateSectionedRowsCache) is a hoisted function.
// ============================================================================

/**
 * The raw grid of one tab, read at most once per execution.
 *
 * TWO ENTRIES PER TAB AT MOST, one call each: the values, and — only if
 * somebody asks for them — the formulas. A caller that wants formulas after a
 * values-only read pays for the formulas alone; a caller that wants values
 * after a formula read pays nothing, because the values were kept.
 *
 * { values, merged, lastRow, lastCol } per sheet name. `merged` is the values
 * with a formula string wherever a cell holds one, built once and shared.
 */
let __sheetGridCache = {};

/**
 * Reads (or returns) the whole of `sheet` as a grid.
 *
 * `preserveFormulas` asks for the merged grid — the formula string wherever a
 * cell holds one. Without it the plain values come back, which is both cheaper
 * and the MORE correct read for anything that is not going back onto a sheet:
 * a formula string is not a date anything can parse.
 *
 * Returns null for an empty tab, and reads straight through — uncached — for a
 * sheet-like object with no getName(), which is only ever a test double
 * opting itself out. Same rule as getSectionedRows().
 */
function readSheetGrid(sheet, preserveFormulas) {
  if (!sheet) return null;
  if (typeof sheet.getName !== 'function') return readSheetGridUncached_(sheet, preserveFormulas);

  const name = sheet.getName();
  let entry = __sheetGridCache[name];
  // THE SHEET ITSELF, not only its name. A name is what the twenty-six
  // invalidation call sites have to hand and so it is what the cache is keyed
  // on — but a name is not an identity: two different objects can answer to
  // "All_Program_Sessions", and serving one's grid to the other is not a stale
  // read, it is somebody else's tab. Cheap to rule out, and the failure it
  // prevents is silent.
  if (entry && entry.sheet !== sheet) entry = null;
  if (!entry) {
    entry = readSheetGridUncached_(sheet, false);
    if (!entry) return null;
    entry.sheet = sheet;
    __sheetGridCache[name] = entry;
  }
  if (!preserveFormulas) return entry;

  if (!entry.merged) {
    // The values are already in hand, so this is the getFormulas() and nothing
    // else — the second of the at-most-two calls this tab will cost.
    const formulas = sheet.getRange(1, 1, entry.lastRow, entry.lastCol).getFormulas();
    entry.merged = entry.values.map((row, r) => row.map((val, c) => (formulas[r][c] || val)));
  }
  return entry;
}

/** readSheetGrid() with no cache in the way — the one place either read happens. */
function readSheetGridUncached_(sheet, preserveFormulas) {
  const lastRow = Math.max(sheet.getLastRow(), 0);
  if (lastRow < 1) return null;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const values = range.getValues();
  const merged = preserveFormulas
    ? (() => {
      const formulas = range.getFormulas();
      return values.map((row, r) => row.map((val, c) => (formulas[r][c] || val)));
    })()
    : null;
  return { values, merged, lastRow, lastCol };
}

/** The grid a caller asked for, in the shape it asked for. */
function sheetGridCells(entry, preserveFormulas) {
  if (!entry) return [];
  return preserveFormulas ? (entry.merged || entry.values) : entry.values;
}

/**
 * Drops one tab's cached grid, or — called with nothing — every tab's.
 *
 * Not called directly by anything that writes: invalidateSectionedRowsCache()
 * (08) calls it, so the twenty-six places that already drop the sectioned
 * reads drop this too and there is no second list to keep in step.
 */
function invalidateSheetGridCache(sheetOrName) {
  if (!sheetOrName) { __sheetGridCache = {}; return; }
  const name = typeof sheetOrName === 'string'
    ? sheetOrName
    : (typeof sheetOrName.getName === 'function' ? sheetOrName.getName() : null);
  if (!name) { __sheetGridCache = {}; return; }
  delete __sheetGridCache[name];
}

// ============================================================================
// THE POSITIONED MODEL
// ============================================================================
//
// getSectionedRows() (08) answers "what rows does this tab hold?", projected
// into HEADERS order and with no idea where any of them sit. That is the right
// answer for a render, which is about to write every row back out anyway, and
// the wrong one for a reconcile, which changes four cells in a column of four
// hundred and has to know which four. That is why these passes read raw
// columns rather than use the cached reader — and this is the reader they
// wanted: the same one read, carrying the row numbers.
// ============================================================================

/** The marker text that identifies a session-table header row. */
const SESSION_GRID_HEADER_MARKER = 'Event_ID';

/** The scope opened by withSessionGrid(), if one is open. */
let __sessionGridScope = null;

/**
 * The session table as one in-memory model: its header rows, its column map,
 * its section zones, and a mutable copy of each column a caller asks for.
 *
 * Returns null when the tab has no header row at all — the same "a workbook on
 * an older layout is not an error" answer every pass here already gives.
 *
 * Inside a withSessionGrid() scope the SAME model comes back to every caller,
 * which is what makes six passes cost one read.
 */
function loadSessionGrid(sheet, markerHeaderName) {
  const marker = markerHeaderName || SESSION_GRID_HEADER_MARKER;
  if (__sessionGridScope && __sessionGridScope.sheet === sheet &&
    __sessionGridScope.marker === marker) {
    return __sessionGridScope.model;
  }
  const model = buildSessionGridModel_(sheet, marker);
  if (__sessionGridScope && __sessionGridScope.sheet === sheet &&
    __sessionGridScope.marker === marker) {
    __sessionGridScope.model = model;
  }
  return model;
}

function buildSessionGridModel_(sheet, marker) {
  // Formula-preserving, because the link columns are written back through this
  // and flattening them is the bug this whole file is careful about.
  const entry = readSheetGrid(sheet, true);
  if (!entry) return null;
  const grid = sheetGridCells(entry, true);
  const values = entry.values;

  // Header rows are located in the VALUES, never in the merged grid: a marker
  // cell is text, and a stray formula beside it must not change what the row
  // is recognized as. Same rule, and same reason, as readSectionedGrid_().
  const headerRows = [];
  for (let r = 0; r < values.length; r++) {
    if (values[r].some(v => normalizeHeaderText(v) === marker)) headerRows.push(r + 1);
  }
  if (headerRows.length === 0) return null;

  const map = {};
  values[headerRows[0] - 1].forEach((h, i) => {
    const name = normalizeHeaderText(h);
    if (name && map[name] === undefined) map[name] = i + 1;
  });

  // The zones, exactly as getZoneDataRange() finds them: within each header's
  // span, the contiguous run of rows that actually carry a parseable date, so
  // banners and spacers are skipped without being counted.
  const dateCol = map['Event_Date'];
  const zones = [];
  if (dateCol) {
    headerRows.forEach((hRow, i) => {
      const scanEnd = (i + 1 < headerRows.length) ? headerRows[i + 1] - 1 : entry.lastRow;
      let first = -1;
      let last = -1;
      for (let row = hRow + 1; row <= scanEnd; row++) {
        const line = values[row - 1];
        if (line && coerceDate(line[dateCol - 1])) {
          if (first === -1) first = row;
          last = row;
        }
      }
      if (first !== -1) zones.push({ headerRow: hRow, start: first, count: last - first + 1 });
    });
  }

  return {
    sheet, marker, map, zones, headerRows,
    grid, lastRow: entry.lastRow, lastCol: entry.lastCol,
    // zoneIndex + ':' + column -> the mutable array handed out for it.
    columns: {},
    // The same keys, for the columns that were actually changed.
    dirty: {}
  };
}

/**
 * One zone's values for one column, as a MUTABLE flat array.
 *
 * Mutate it in place and call markSessionGridColumn(); the flush writes it.
 * Every caller asking for the same zone and column gets the SAME array, which
 * is what lets one pass see what another has staged — the property that keeps
 * the order of effects identical to re-reading the sheet between passes.
 *
 * Returns null when the tab has no such column, which is how a workbook still
 * on an older layout says so.
 */
function sessionGridColumn(model, zone, header) {
  if (!model) return null;
  const col = model.map[header];
  if (!col) return null;
  const key = `${zone.start}:${col}`;
  if (!model.columns[key]) {
    const out = new Array(zone.count);
    for (let r = 0; r < zone.count; r++) {
      const line = model.grid[zone.start - 1 + r];
      const v = line ? line[col - 1] : '';
      out[r] = v === undefined ? '' : v;
    }
    model.columns[key] = out;
  }
  return model.columns[key];
}

/** Says that the array handed out for this zone and column has been changed. */
function markSessionGridColumn(model, zone, header) {
  if (!model) return;
  const col = model.map[header];
  if (!col) return;
  model.dirty[`${zone.start}:${col}`] = { zone, col };
}

/**
 * Writes every staged column back, in as few calls as the layout allows, and
 * drops the caches that describe the tab.
 *
 * NO-OP INSIDE A SCOPE. withSessionGrid() owns the flush there, so a pass that
 * calls this from inside one is saying "I am done", not "write now" — which is
 * what lets the same six functions be correct whether they are run by the sync
 * or on their own from a menu.
 *
 * ADJACENT COLUMNS GO IN ONE CALL. Slot_Minutes, Max_Capacity, Remaining_Seats
 * and Status are four neighbours the assistance pass changes together, and
 * writing them as one block is one round trip rather than four. Nothing but
 * neighbours is ever merged: the cells written are exactly the cells staged,
 * which is what keeps this a change of HOW the tab is written and not of WHAT.
 */
function flushSessionGrid(model, force) {
  if (!model) return 0;
  if (__sessionGridScope && __sessionGridScope.model === model && !force) return 0;

  const keys = Object.keys(model.dirty);
  if (keys.length === 0) return 0;

  // Grouped by zone, then walked in column order so neighbours can be merged.
  const byZone = {};
  keys.forEach(key => {
    const { zone, col } = model.dirty[key];
    const bucket = byZone[zone.start] = byZone[zone.start] || { zone, cols: [] };
    bucket.cols.push(col);
  });

  let writes = 0;
  Object.keys(byZone).forEach(zoneStart => {
    const { zone, cols } = byZone[zoneStart];
    cols.sort((a, b) => a - b);
    let runStart = cols[0];
    let runEnd = cols[0];
    const writeRun = () => {
      const width = runEnd - runStart + 1;
      const block = new Array(zone.count);
      for (let r = 0; r < zone.count; r++) {
        const line = new Array(width);
        for (let c = 0; c < width; c++) {
          // A column in the middle of a run that nothing staged is written
          // back as it was read — merged, so a formula goes back as a formula.
          const col = runStart + c;
          const staged = model.columns[`${zone.start}:${col}`];
          if (staged) {
            line[c] = staged[r];
          } else {
            const row = model.grid[zone.start - 1 + r];
            const v = row ? row[col - 1] : '';
            line[c] = v === undefined ? '' : v;
          }
        }
        block[r] = line;
      }
      model.sheet.getRange(zone.start, runStart, zone.count, width).setValues(block);
      writes++;
    };
    for (let i = 1; i < cols.length; i++) {
      if (cols[i] === runEnd + 1) { runEnd = cols[i]; continue; }
      writeRun();
      runStart = runEnd = cols[i];
    }
    writeRun();
  });

  model.dirty = {};
  // The tab has just changed under every cached read of it, this file's own
  // included — invalidateSectionedRowsCache() drops both.
  invalidateSectionedRowsCache(model.sheet);
  return writes;
}

/**
 * Runs `fn` with one shared model of `sheet`, and writes it back once at the
 * end — the whole reason this file exists.
 *
 * REENTRANT, so a pass that opens its own scope inside somebody else's (the
 * link pass is called both on its own and from applyNoRegistrationEffects())
 * joins the outer one rather than flushing under it.
 *
 * The flush runs in a `finally`: a pass that throws must not strand the four
 * cells an earlier pass staged, because the next run would read a tab that
 * disagrees with the calendar and "fix" it in the wrong direction.
 */
function withSessionGrid(sheet, fn, markerHeaderName) {
  const marker = markerHeaderName || SESSION_GRID_HEADER_MARKER;
  if (__sessionGridScope) return fn(__sessionGridScope.model);

  const scope = { sheet, marker, model: null };
  __sessionGridScope = scope;
  scope.model = buildSessionGridModel_(sheet, marker);
  try {
    return fn(scope.model);
  } finally {
    __sessionGridScope = null;
    if (scope.model) flushSessionGrid(scope.model, true);
  }
}
