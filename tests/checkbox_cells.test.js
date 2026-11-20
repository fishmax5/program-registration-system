// A TICK BOX THAT READS "false" (99zze).
//
// On 20 Nov 2026 the live All_Registrants tab held 2,882 rows whose tick boxes
// (Attended, Lunch_Served, Contacted, Confirmed, Waitlisted, Dropped) were the
// TEXT "false" or "true" in Plain-text ('@') cells, drawn as words with a red
// invalid-data corner. A boolean written into a '@' cell becomes String(value),
// and the program headings (99zs) left '@' behind on rows that later held
// registrants.
//
// What is pinned here:
//
//   1. THE WORDS ARE READ AS THE BOXES THEY MEAN, and nothing else moves.
//   2. THE COLUMN RUNS: six tick-box columns, two calls.
//   3. THE RENDER, against a sheet that turns a boolean written into a '@'
//      cell into text the way Sheets does, and whose clearFormats() leaves the
//      '@' behind (what the live tab shows): every tick box lands a boolean,
//      and an old-style render on the same sheet is shown to fail, so this test
//      would have caught the fault.
//   4. THE DESK'S IN-PLACE INSERT stamps the tick boxes before writing.
//   5. AN UNDO clears a tick that reached the tab as the word "true".
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const NOW = new Date(2026, 8, 9, 9, 0, 0); // Wed 9 Sep 2026
const RealDate = Date;
const pad = n => String(n).padStart(2, '0');

function builder(kind, spec) {
  spec = spec || { kind };
  const b = new Proxy({}, {
    get(t, prop) {
      if (prop === 'build') return () => Object.assign({ __rule: true }, spec);
      if (typeof prop !== 'string') return undefined;
      return (...args) => { spec[prop] = args.length === 1 ? args[0] : args; return b; };
    }
  });
  return b;
}

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return d.toISOString();
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: (() => {
    const store = {};
    const props = {
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); return props; },
      deleteProperty: k => { delete store[k]; return props; },
      getProperties: () => Object.assign({}, store)
    };
    return { getScriptProperties: () => props, getUserProperties: () => props };
  })(),
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {},
    newDataValidation: () => builder('validation'),
    newConditionalFormatRule: () => builder('conditional'),
    WrapStrategy: { CLIP: 'CLIP', OVERFLOW: 'OVERFLOW', WRAP: 'WRAP' },
    ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
    DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', CHECKBOX: 'CHECKBOX' },
    BorderStyle: { SOLID: 'SOLID' },
    CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT' }
  },
  FormApp: { ItemType: {}, openById: () => { throw new Error('no form'); } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.PALETTE = PALETTE;
this.groupRegistrantRowsByProgram = groupRegistrantRowsByProgram;
this.isSectionedDividerValue = isSectionedDividerValue;
this.registrantProgramGroupKey = registrantProgramGroupKey;
this.registrantGroupDividerRowNumbers = registrantGroupDividerRowNumbers;
this.collapseOldGroupedPastRows_ = collapseOldGroupedPastRows_;
this.renderFlatDateSheet = renderFlatDateSheet;
this.applyRegistrantsFormatting = applyRegistrantsFormatting;
this.readAllSectionedRows = readAllSectionedRows;
this.readAllSectionedRowValues = readAllSectionedRowValues;
this.getSectionZones = getSectionZones;
this.insertRegistrantRowsInPlace_ = insertRegistrantRowsInPlace_;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.invalidateAutosizeMemo = invalidateAutosizeMemo;
this.REGISTRANT_GROUP_DIVIDER_PREFIX = REGISTRANT_GROUP_DIVIDER_PREFIX;
this.REGISTRANT_GROUP_DIVIDER_BG = REGISTRANT_GROUP_DIVIDER_BG;
this.checkboxCellValue_ = checkboxCellValue_;
this.coerceCheckboxColumns_ = coerceCheckboxColumns_;
this.checkboxColumnRuns_ = checkboxColumnRuns_;
this.registrantCheckboxColumns_ = registrantCheckboxColumns_;
this.registrantGroupDividerRow = registrantGroupDividerRow;
this.clearRegistrantMarksOnRow = clearRegistrantMarksOnRow;
this.getIndexMap = getIndexMap;
this.CHECKBOX_CELL_NUMBER_FORMAT = CHECKBOX_CELL_NUMBER_FORMAT;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const HEADERS = sandbox.HEADERS.All_Registrants;
const col = name => HEADERS.indexOf(name);
const ok = msg => console.log(`ok   ${msg}`);
// Arrays built INSIDE the vm carry the vm's Array prototype, which
// deepStrictEqual compares. Lift them into this realm before asserting.
const arr = x => Array.from(x);

function makeRow(title, location, date, name) {
  const row = new Array(HEADERS.length).fill('');
  row[col('Event_Date')] = date;
  row[col('Event_Time')] = '10:00 AM – 11:30 AM';
  row[col('Location')] = location;
  row[col('Event')] = title;
  row[col('Name')] = name;
  row[col('Person_Type')] = 'Registrant';
  row[col('Program_Status')] = 'Active';
  row[col('Event_ID')] = `evt|${title}|${location}|${date.getTime()}`;
  row[col('Manual_Override')] = 'Auto-Synced';
  return row;
}


const CHECKS = sandbox.registrantCheckboxColumns_();
const checkCols = CHECKS.map(h => col(h));

// ---------------------------------------------------------------------------
// 1. THE WORDS, AND ONLY THE WORDS
// ---------------------------------------------------------------------------
{
  const v = sandbox.checkboxCellValue_;
  assert.strictEqual(v('false'), false);
  assert.strictEqual(v('FALSE'), false);
  assert.strictEqual(v(' true '), true);
  assert.strictEqual(v('True'), true);
  assert.strictEqual(v(true), true);
  assert.strictEqual(v(false), false);
  assert.strictEqual(v(''), '', 'a blank stays blank');
  assert.strictEqual(v('x'), 'x', "a leader's x is left for isTruthyCheckbox");
  assert.strictEqual(v(1), 1);

  const row = makeRow('Advanced Stitch Club', 'Ashbridge', new RealDate(2026, 11, 2), 'Carol Reynolds');
  checkCols.forEach(i => { row[i] = 'false'; });
  row[col('Attended')] = 'true';
  row[col('Phone')] = '2158527119';
  row[col('Admin_Notes')] = 'false';
  const heading = sandbox.registrantGroupDividerRow('▸ Advanced Stitch Club — Ashbridge', HEADERS.length);
  heading[col('Attended')] = 'false';
  const changed = sandbox.coerceCheckboxColumns_([row, heading], HEADERS, CHECKS);
  assert.strictEqual(changed, CHECKS.length, 'every tick-box cell on the registrant row, nothing on the heading');
  assert.strictEqual(row[col('Attended')], true, 'a real tick that was the word "true" stays a tick');
  CHECKS.filter(h => h !== 'Attended').forEach(h => assert.strictEqual(row[col(h)], false, h));
  assert.strictEqual(row[col('Phone')], '2158527119', 'a column that is not a tick box is not touched');
  assert.strictEqual(row[col('Admin_Notes')], 'false', 'not even when it holds the same word');
  assert.strictEqual(heading[col('Attended')], 'false', 'heading rows are skipped');
  assert.strictEqual(sandbox.coerceCheckboxColumns_([row], HEADERS, CHECKS), 0, 'idempotent');
  ok('true/false words become the boxes they mean; nothing else on the row moves');
}

// ---------------------------------------------------------------------------
// 2. SIX COLUMNS, TWO RUNS
// ---------------------------------------------------------------------------
{
  const runs = Array.from(sandbox.checkboxColumnRuns_(HEADERS, CHECKS)).map(r => ({ col: r.col, count: r.count }));
  assert.deepStrictEqual(runs, [
    { col: col('Attended') + 1, count: 2 },
    { col: col('Contacted') + 1, count: 4 }
  ], 'Attended/Lunch_Served and the four leader flags');
  assert.deepStrictEqual(Array.from(sandbox.checkboxColumnRuns_(['A', 'B', 'C'], ['C', 'A', 'A'])).map(r => [r.col, r.count]),
    [[1, 1], [3, 1]], 'out of order and repeated names still make clean runs');
  ok('the tick-box stamp is two calls on All_Registrants');
}

// ---------------------------------------------------------------------------
// 3. THE RENDER, ON A SHEET THAT DOES WHAT SHEETS DOES
// ---------------------------------------------------------------------------
//
// The counting sheet records every call in order. Replaying them over a
// number-format plane gives what the live tab would hold: a setValues() into a
// '@' cell stores String(value). The plane starts with '@' across a scatter of
// rows — where an earlier render's headings were — and the sheet-level
// clearFormats() is NOT applied to it, which is the worst case and what the
// live tab's blank spacer rows show.
function replay(sheet, staleTextRows, numCols) {
  const fmt = {};
  staleTextRows.forEach(r => { for (let c = 1; c <= numCols; c++) fmt[`${r}:${c}`] = '@'; });
  const out = [];
  sheet.calls.forEach(call => {
    if (call.name === 'setNumberFormat') {
      for (let r = 0; r < call.rows; r++) for (let c = 0; c < call.cols; c++) {
        fmt[`${call.row + r}:${call.col + c}`] = call.args[0];
      }
    } else if (call.name === 'rangeList.setNumberFormat') {
      call.ranges.forEach(a1 => {
        const m = /^R(\d+)C(\d+):R(\d+)C(\d+)$/.exec(a1);
        if (!m) return;
        for (let r = +m[1]; r <= +m[3]; r++) for (let c = +m[2]; c <= +m[4]; c++) fmt[`${r}:${c}`] = call.args[0];
      });
    } else if (call.name === 'setValues' || call.name === 'setValue') {
      const values = call.name === 'setValue' ? [[call.args[0]]] : call.args[0];
      for (let r = 0; r < call.rows; r++) for (let c = 0; c < call.cols; c++) {
        const key = `${call.row + r}:${call.col + c}`;
        let v = values[r][c];
        if (fmt[key] === '@' && typeof v === 'boolean') v = String(v);
        (out[call.row + r - 1] = out[call.row + r - 1] || [])[call.col + c - 1] = v;
      }
    }
  });
  return { values: out, fmt };
}

function brokenRows() {
  const d = n => new RealDate(2026, 8, 9 + n);
  const rows = [];
  ['Advanced Stitch Club', 'Chair Yoga', 'Tai Chi'].forEach((title, t) => {
    for (let i = 0; i < 4; i++) {
      const row = makeRow(title, 'Ashbridge', d(i * 7 + (t % 2 ? -14 : 1)), `${title} ${i}`);
      // Read back off the live tab: every tick box a word.
      checkCols.forEach(c => { row[c] = 'false'; });
      if (i === 0) row[col('Attended')] = 'true';
      rows.push(row);
    }
  });
  return rows;
}

function render(sheet, rows, withFix) {
  sandbox.invalidateSectionedRowsCache(sheet);
  sandbox.invalidateAutosizeMemo(sheet);
  sheet.calls.length = 0;
  const opts = {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    textColumns: ['Event_Time'],
    groupRows: sandbox.groupRegistrantRowsByProgram,
    afterWrite: sandbox.applyRegistrantsFormatting
  };
  if (withFix) opts.checkboxColumns = CHECKS;
  return sandbox.renderFlatDateSheet(sheet, HEADERS, rows, opts);
}

function freshSheet() {
  const grid = [];
  const sheet = makeCountingSheet(grid, 'All_Registrants');
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: () => sheet, getSheets: () => [sheet], toast: () => {}
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  return { sheet, grid };
}

// Every data row's tick-box cells, as the replayed tab holds them.
function tickCells(values) {
  const cells = [];
  values.forEach(line => {
    if (!line || !(line[col('Event_Date')] instanceof RealDate || line[col('Event_Date')] instanceof sandbox.Date)) return;
    checkCols.forEach(c => cells.push({ name: line[col('Name')], header: HEADERS[c], value: line[c] }));
  });
  return cells;
}

const STALE = [];
for (let r = 3; r <= 40; r += 2) STALE.push(r);

{
  // Before: an old-style render (no tick-box handling) on the polluted sheet
  // leaves words. If this ever stops failing, the replay has stopped modelling
  // the fault and section 3 proves nothing.
  const { sheet } = freshSheet();
  render(sheet, brokenRows(), false);
  const before = tickCells(replay(sheet, STALE, HEADERS.length).values);
  assert.ok(before.length > 0, 'the replay found the registrant rows');
  assert.ok(before.some(c => typeof c.value === 'string'),
    'the old render leaves tick boxes as words on a text-formatted row');
  ok('the replay reproduces the fault: an old-style render writes "false" as text');
}

{
  const { sheet } = freshSheet();
  render(sheet, brokenRows(), true);
  const { values, fmt } = replay(sheet, STALE, HEADERS.length);
  const after = tickCells(values);
  assert.strictEqual(after.length, 12 * CHECKS.length, 'every registrant row, every tick box');
  const words = after.filter(c => typeof c.value !== 'boolean');
  assert.deepStrictEqual(words, [], 'no tick box is left as a word');
  const ticked = after.filter(c => c.header === 'Attended' && c.value === true).map(c => c.name).sort();
  assert.deepStrictEqual(ticked, ['Advanced Stitch Club 0', 'Chair Yoga 0', 'Tai Chi 0'],
    'the ticks that were the word "true" are still ticked');

  // And nothing this render did leaves a tick-box cell Plain text for the next
  // single-cell write (Quick Mark, the door) to land in.
  STALE.forEach(r => checkCols.forEach(c => {
    assert.notStrictEqual(fmt[`${r}:${c + 1}`], '@', `row ${r} ${HEADERS[c]} still Plain text`);
  }));

  // The stamp is direct (before the values), not staged into the render batch.
  const stampAt = sheet.calls.findIndex(c => c.name === 'setNumberFormat' &&
    c.args[0] === sandbox.CHECKBOX_CELL_NUMBER_FORMAT && c.col === col('Attended') + 1);
  const firstValues = sheet.calls.findIndex(c => c.name === 'setValues');
  assert.ok(stampAt >= 0 && stampAt < firstValues, 'the tick-box columns are stamped before any value lands');
  ok('a render repairs every word into a tick box and leaves no Plain-text tick cell behind');
}

// ---------------------------------------------------------------------------
// 4. THE DESK'S IN-PLACE INSERT
// ---------------------------------------------------------------------------
{
  const { sheet, grid } = freshSheet();
  const existing = [
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 16), 'Bob'),
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 30), 'Eve')
  ];
  render(sheet, existing, true);
  sandbox.invalidateSectionedRowsCache(sheet);
  sheet.calls.length = 0;

  const walkIn = makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 10), 'Walk In');
  checkCols.forEach(c => { walkIn[c] = 'false'; });
  const landed = sandbox.insertRegistrantRowsInPlace_(sheet, [walkIn]);
  assert.strictEqual(landed.length, 1, 'inserted at the top of its block');

  const valuesAt = sheet.calls.findIndex(c => c.name === 'setValues' && c.cols === HEADERS.length);
  const written = sheet.calls[valuesAt];
  const stamps = sheet.calls.slice(0, valuesAt).filter(c => c.name === 'setNumberFormat' &&
    c.args[0] === sandbox.CHECKBOX_CELL_NUMBER_FORMAT && c.row === written.row);
  assert.deepStrictEqual(stamps.map(c => c.col).sort((a, b) => a - b),
    [col('Attended') + 1, col('Contacted') + 1], 'both tick-box runs stamped before the row is written');
  checkCols.forEach(c => assert.strictEqual(written.args[0][0][c], false, `${HEADERS[c]} written as a boolean`));

  const copyAt = sheet.calls.findIndex(c => c.name === 'copyTo');
  const restamp = sheet.calls.slice(copyAt).filter(c => c.name === 'setNumberFormat' &&
    c.args[0] === sandbox.CHECKBOX_CELL_NUMBER_FORMAT);
  assert.ok(copyAt > valuesAt && restamp.length === 2,
    "and again after the neighbour's format is copied over it");
  ok("the desk's insert writes tick boxes as booleans into cells that are not text");
}

// ---------------------------------------------------------------------------
// 5. AN UNDO CLEARS A TICK THAT IS THE WORD "true"
// ---------------------------------------------------------------------------
{
  const map = sandbox.getIndexMap(HEADERS);
  const row = makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 16), 'Bob');
  row[col('Attended')] = 'true';
  row[col('Lunch_Served')] = 'TRUE';
  assert.strictEqual(sandbox.clearRegistrantMarksOnRow(row, map), true, 'something was on');
  assert.strictEqual(row[col('Attended')], false);
  assert.strictEqual(row[col('Lunch_Served')], false);
  ok('undoing a mark clears a tick that reached the tab as words');
}

console.log('\nAll checkbox-cell assertions passed.');
