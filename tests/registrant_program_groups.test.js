// THE REGISTRANTS TAB, GROUPED BY PROGRAM.
//
// Inside each of the two sections the rows are now sorted by program and then
// by date, with a heading row per program (99zs). The heading rows are the
// risk, and all of it is one question: can any reader in this project see one?
// They are REAL ROWS on a tab that fifteen callers read back and rewrite, so a
// heading that reads as data is a registration nobody can account for — and
// one that reads as data twice is a row the next render writes out again.
//
// What is pinned here:
//
//   1. THE ORDER. Blocks alphabetical, dates ascending in Upcoming and
//      most-recent-first in Past, two buildings of one title kept apart.
//   2. THE ROUND TRIP. Written, then read back through the sectioned readers:
//      the headings have to be gone and the registrations all there. Including
//      the one case a blank date does not cover — a program whose own TITLE
//      parses as a date.
//   3. THE PAINT, which is the reason this is affordable: one range-list call
//      per attribute for every heading on the tab, never a banner apiece.
//   4. WRITE BEFORE CLEAR (99u) still holding with headings in the arrays.
//   5. THE OLD-MONTH COLLAPSE, which stopped being a suffix scan the moment
//      the blocks stopped being date-ordered: runs merged, and a heading put
//      away only when its whole block is.
//   6. THE DESK'S FAST WRITE (38). A new row goes into its OWN program's
//      block, and a program with no block on the tab declines so the caller
//      redraws — the only thing that can write a heading is a full render.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');
const { checkWriteBeforeClear } = require('./helpers/write_before_clear');

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

const isDivider = row => sandbox.isSectionedDividerValue(row[0]);
const labelOf = row => String(row[0]);
const titleOf = row => String(row[col('Event')]);
const dateOf = row => new RealDate(row[col('Event_Date')]);

// ---------------------------------------------------------------------------
// 1. BY PROGRAM, THEN BY DATE — AND THE TWO BUILDINGS STAY APART
// ---------------------------------------------------------------------------
{
  const d = n => new RealDate(2026, 8, 9 + n);
  // Deliberately interleaved on the way in, the way a date-ordered tab holds
  // them: nothing here may depend on the input order.
  const rows = [
    makeRow('Tai Chi', 'Narberth', d(1), 'Ann'),
    makeRow('Chair Yoga', 'Ashbridge', d(1), 'Bob'),
    makeRow('Chair Yoga', 'Narberth', d(2), 'Cal'),
    makeRow('Tai Chi', 'Narberth', d(8), 'Dot'),
    makeRow('Chair Yoga', 'Ashbridge', d(15), 'Eve'),
    makeRow('Chair Yoga', 'Ashbridge', d(8), 'Fay')
  ];
  const grouped = sandbox.groupRegistrantRowsByProgram(rows, HEADERS, false);

  assert.strictEqual(grouped.length, rows.length + 3,
    'one heading per program, and nothing lost');
  const headings = grouped.filter(isDivider).map(labelOf);
  assert.deepStrictEqual(arr(headings), [
    '▸ Chair Yoga — Ashbridge',
    '▸ Chair Yoga — Narberth',
    '▸ Tai Chi — Narberth'
  ], 'blocks alphabetical on what the heading says; one title at two buildings is two blocks');

  // Every block: its heading, then its own rows, ascending.
  let seen = null;
  const perBlock = {};
  grouped.forEach(row => {
    if (isDivider(row)) { seen = labelOf(row); perBlock[seen] = []; return; }
    assert.ok(seen, 'no registration sits above the first heading');
    perBlock[seen].push(row);
  });
  assert.deepStrictEqual(arr(perBlock['▸ Chair Yoga — Ashbridge'].map(r => String(r[col('Name')]))),
    ['Bob', 'Fay', 'Eve'], 'ascending inside an Upcoming block');
  assert.deepStrictEqual(arr(perBlock['▸ Tai Chi — Narberth'].map(r => String(r[col('Name')]))),
    ['Ann', 'Dot']);

  // The Past section's own direction, same blocks.
  const past = sandbox.groupRegistrantRowsByProgram(rows, HEADERS, true);
  const pastAsh = [];
  let at = null;
  past.forEach(row => {
    if (isDivider(row)) { at = labelOf(row); return; }
    if (at === '▸ Chair Yoga — Ashbridge') pastAsh.push(String(row[col('Name')]));
  });
  assert.deepStrictEqual(pastAsh, ['Eve', 'Fay', 'Bob'], 'most recent first inside a Past block');
  ok('sorted by program then by date, two buildings kept apart, both directions');
}

// ---------------------------------------------------------------------------
// 2. A HEADING ROW IS INVISIBLE TO EVERY READER
// ---------------------------------------------------------------------------
//
// Rendered, then read back through both sectioned readers. If a heading came
// back as a row, the next render would write it out as data — and the guard
// (99j) would be counting headings as registrations.
function freshSheet(name) {
  const grid = [];
  const sheet = makeCountingSheet(grid, name);
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: n => (n === name ? sheet : null),
    getSheets: () => [sheet],
    toast: () => {}
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  return { sheet, grid };
}

function renderGrouped(sheet, rows) {
  sandbox.invalidateSectionedRowsCache(sheet);
  sandbox.invalidateAutosizeMemo(sheet);
  sheet.calls.length = 0;
  return sandbox.renderFlatDateSheet(sheet, HEADERS, rows, {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    textColumns: ['Event_Time'],
    groupRows: sandbox.groupRegistrantRowsByProgram,
    afterWrite: sandbox.applyRegistrantsFormatting
  });
}

{
  const rows = [
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 16), 'Bob'),
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 2), 'Hal'),
    makeRow('Tai Chi', 'Narberth', new RealDate(2026, 8, 23), 'Ann'),
    // The case a blank Event_Date does not cover: a title that parses as a
    // date, so the heading's own label would too without the marker.
    makeRow('December 2026 Social', 'Narberth', new RealDate(2026, 8, 30), 'Ida'),
    makeRow('December 2026 Social', 'Narberth', new RealDate(2026, 7, 30), 'Jay')
  ];
  const { sheet, grid } = freshSheet('All_Registrants');
  const result = renderGrouped(sheet, rows);

  // The headings really are on the tab — four programs, in both sections where
  // the program has rows on both sides of today.
  const onTab = grid.filter(line => line && sandbox.isSectionedDividerValue(line[0]));
  assert.ok(onTab.length >= 5, `headings drawn on the tab, got ${onTab.length}`);
  assert.ok(result.dividerRows.length === onTab.length,
    'the render reports exactly the heading rows it drew');

  sandbox.invalidateSectionedRowsCache(sheet);
  const readBack = sandbox.readAllSectionedRows(sheet, HEADERS, 'Event_ID');
  assert.strictEqual(readBack.length, rows.length,
    `the reader saw ${readBack.length} rows; ${rows.length} registrations were written`);
  assert.ok(!readBack.some(isDivider), 'no heading came back as a row');
  assert.deepStrictEqual(arr(readBack.map(r => String(r[col('Name')])).sort()),
    ['Ann', 'Bob', 'Hal', 'Ida', 'Jay'], 'every registration came back, once');

  sandbox.invalidateSectionedRowsCache(sheet);
  const values = sandbox.readAllSectionedRowValues(sheet, HEADERS, 'Event_ID');
  assert.strictEqual(values.length, rows.length, 'the values reader agrees');
  assert.ok(!values.some(isDivider));

  // And the zones the desk's fast write and onEdit are bounded by.
  sandbox.invalidateSectionedRowsCache(sheet);
  const zones = sandbox.getSectionZones(sheet, 'Event_ID');
  zones.forEach(z => {
    assert.ok(!sandbox.isSectionedDividerValue(grid[z.dataStart - 1][0]),
      'a zone never starts on a heading');
    assert.ok(z.dataEnd < z.dataStart || !sandbox.isSectionedDividerValue(grid[z.dataEnd - 1][0]),
      'a zone never ends on a heading');
  });
  ok('headings are drawn, and no reader in the project can see one');
}

// ---------------------------------------------------------------------------
// 3. ONE RANGE-LIST CALL PER ATTRIBUTE, NOT A BANNER APIECE
// ---------------------------------------------------------------------------
{
  const rows = [];
  const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
    'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];
  titles.forEach((title, i) => {
    for (let w = 0; w < 4; w++) {
      rows.push(makeRow(title, i % 2 ? 'Narberth' : 'Ashbridge',
        new RealDate(2026, 8, 10 + w * 7), `P${i}-${w}`));
    }
  });
  const { sheet } = freshSheet('All_Registrants');
  const result = renderGrouped(sheet, rows);

  assert.strictEqual(result.dividerRows.length, titles.length,
    `${titles.length} programs, ${titles.length} headings`);

  const listCalls = sheet.calls.filter(c => String(c.name).indexOf('rangeList.') === 0 &&
    c.ranges.length === result.dividerRows.length);
  const names = listCalls.map(c => c.name).sort();
  assert.deepStrictEqual(arr(names), [
    'rangeList.clearDataValidations',
    'rangeList.setBackground',
    'rangeList.setFontColor',
    'rangeList.setFontWeight',
    'rangeList.setHorizontalAlignment',
    'rangeList.setNumberFormat'
  ], 'every heading painted together, one call per attribute');

  // The dropdowns and tick boxes the band gave them are taken back off: a
  // heading row carrying five checkboxes is not a heading.
  const cleared = listCalls.find(c => c.name === 'rangeList.clearDataValidations');
  assert.deepStrictEqual(arr(cleared.ranges.slice().sort()),
    arr(result.dividerRows.map(r => `R${r}C1:R${r}C${HEADERS.length}`).sort()));
  const washed = listCalls.find(c => c.name === 'rangeList.setBackground');
  assert.strictEqual(washed.args[0], sandbox.REGISTRANT_GROUP_DIVIDER_BG);

  // And nothing drew a banner per program.
  const banners = sheet.calls.filter(c => c.name === 'setRowHeight').length;
  assert.ok(banners <= 4, `no per-program banner rows: ${banners} setRowHeight calls`);
  ok('twelve programs cost one call per attribute, not twelve banners');
}

// ---------------------------------------------------------------------------
// 4. WRITE BEFORE CLEAR, WITH HEADINGS IN THE ARRAYS
// ---------------------------------------------------------------------------
{
  const rows = [
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 16), 'Bob'),
    makeRow('Tai Chi', 'Narberth', new RealDate(2026, 8, 2), 'Hal'),
    makeRow('Tai Chi', 'Narberth', new RealDate(2026, 8, 23), 'Ann')
  ];
  const grid = [];
  const sheet = makeCountingSheet(grid, 'All_Registrants');
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: () => sheet, getSheets: () => [sheet], toast: () => {}
  });
  checkWriteBeforeClear('All_Registrants (grouped)', sheet, grid, () => {
    sandbox.invalidateSectionedRowsCache(sheet);
    sandbox.invalidateAutosizeMemo(sheet);
    renderGrouped(sheet, rows);
  });
  ok('the early write still describes the rows the render lands, headings and all');
}

// ---------------------------------------------------------------------------
// 5. THE OLD MONTHS, NOW THAT THEY ARE NOT A SUFFIX
// ---------------------------------------------------------------------------
{
  const d = (m, day) => new RealDate(2026, m, day);
  // Past rows as the grouped render lays them out: blocks alphabetical, dates
  // most-recent-first inside. "Old" is anything before 2026-08.
  const past = sandbox.groupRegistrantRowsByProgram([
    makeRow('Alpha', 'Ash', d(7, 10), 'a1'),   // Aug — visible
    makeRow('Alpha', 'Ash', d(2, 10), 'a2'),   // Mar — old
    makeRow('Bravo', 'Ash', d(1, 10), 'b1'),   // Feb — old
    makeRow('Bravo', 'Ash', d(0, 10), 'b2'),   // Jan — old
    makeRow('Charlie', 'Ash', d(8, 1), 'c1')   // Sep — visible
  ], HEADERS, true);

  const hidden = [];
  const fake = {
    getName: () => 'All_Registrants',
    hideRows: (start, count) => hidden.push({ start, count })
  };
  const n = sandbox.collapseOldGroupedPastRows_(fake, 10, past, col('Event_Date'));

  // Alpha's heading stays (its August row is visible); Alpha's March row and
  // the whole of Bravo — heading included — are one merged run.
  assert.strictEqual(hidden.length, 1, `one merged run, got ${JSON.stringify(hidden)}`);
  assert.strictEqual(n, 4, 'Alpha/Mar + Bravo heading + Bravo/Feb + Bravo/Jan');
  const first = past.findIndex(r => String(r[col('Name')]) === 'a2');
  assert.strictEqual(hidden[0].start, 10 + first, 'the run starts at the first old row');
  assert.strictEqual(hidden[0].count, 4);

  const labels = past.slice(first, first + 4).map(r => isDivider(r) ? labelOf(r) : String(r[col('Name')]));
  assert.deepStrictEqual(arr(labels), ['a2', '▸ Bravo — Ash', 'b1', 'b2'],
    'a heading is put away only when its whole block is');

  // Nothing old: nothing hidden, and no call made.
  hidden.length = 0;
  const recent = sandbox.groupRegistrantRowsByProgram(
    [makeRow('Alpha', 'Ash', d(8, 1), 'a1')], HEADERS, true);
  assert.strictEqual(sandbox.collapseOldGroupedPastRows_(fake, 10, recent, col('Event_Date')), 0);
  assert.strictEqual(hidden.length, 0, 'a tab with no old months is not asked to hide anything');
  ok('old months hidden in merged runs; a heading goes only with its whole block');
}

// ---------------------------------------------------------------------------
// 6. THE DESK'S FAST WRITE GOES INTO ITS OWN PROGRAM'S BLOCK
// ---------------------------------------------------------------------------
//
// Asserted on the INSERT POSITION rather than on the grid afterwards: the
// counting sheet does not model row insertion (nothing else here needs it), so
// the row number the insert asks for is the honest thing to check.
{
  const existing = [
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 16), 'Bob'),
    makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 30), 'Eve'),
    makeRow('Tai Chi', 'Narberth', new RealDate(2026, 8, 23), 'Ann')
  ];
  const { sheet, grid } = freshSheet('All_Registrants');
  renderGrouped(sheet, existing);
  sandbox.invalidateSectionedRowsCache(sheet);

  const rowOf = name => 1 + grid.findIndex(line => line && String(line[col('Name')]) === name);
  const bobRow = rowOf('Bob'), eveRow = rowOf('Eve'), annRow = rowOf('Ann');
  assert.ok(bobRow > 0 && eveRow === bobRow + 1 && annRow > eveRow,
    `the render put Chair Yoga's block (${bobRow}, ${eveRow}) above Tai Chi's (${annRow})`);

  // A walk-in on 23 Sep for Chair Yoga: dated AFTER Tai Chi's only row, so an
  // insert that went by date alone would land it in the Tai Chi block, under
  // the wrong heading.
  sheet.calls.length = 0;
  const walkIn = makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 23), 'New Person');
  const landed = sandbox.insertRegistrantRowsInPlace_(sheet, [walkIn]);
  assert.strictEqual(landed.length, 1, 'the row was inserted rather than declined');

  // The row the values land on is the row the insert made, and the row the
  // format is copied FROM says which side of the block it went in on.
  const wrote = sheet.calls.filter(c => c.name === 'setValues' && c.cols === HEADERS.length);
  assert.strictEqual(wrote.length, 1, 'one values write for the inserted row');
  assert.strictEqual(wrote[0].row, bobRow + 1,
    `inserted after Bob (row ${bobRow}) — inside Chair Yoga, in date order, ` +
    `not after Ann (row ${annRow}) where its date alone would have put it`);
  const copied = sheet.calls.filter(c => c.name === 'copyTo');
  assert.ok(copied.length === 1 && copied[0].row === bobRow,
    'the format came from the row above, which inside a block is a registrant');

  // The earliest date in a block goes in at the TOP of it, and the format is
  // then copied from the row BELOW — the row above is the heading band.
  sandbox.invalidateSectionedRowsCache(sheet);
  sheet.calls.length = 0;
  const early = makeRow('Chair Yoga', 'Ashbridge', new RealDate(2026, 8, 10), 'Early');
  assert.strictEqual(sandbox.insertRegistrantRowsInPlace_(sheet, [early]).length, 1);
  const topWrote = sheet.calls.filter(c => c.name === 'setValues' && c.cols === HEADERS.length);
  assert.strictEqual(topWrote.length, 1);
  assert.strictEqual(topWrote[0].row, bobRow, "at the block's first row");
  const copies = sheet.calls.filter(c => c.name === 'copyTo');
  assert.ok(copies.length === 1 && copies[0].row === bobRow + 1,
    'the format came from the row below, never from the heading band above');

  // A program with no block on the tab DECLINES: only a full render can write
  // the heading a block opens with.
  sandbox.invalidateSectionedRowsCache(sheet);
  const newProgram = makeRow('Watercolours', 'Narberth', new RealDate(2026, 8, 24), 'Kim');
  assert.deepStrictEqual(arr(sandbox.insertRegistrantRowsInPlace_(sheet, [newProgram])), [],
    'a program with no block declines, so the caller redraws');
  ok('a desk write lands in its own program block, and declines where there is none');
}

console.log('\nAll registrant program-grouping assertions passed.');
