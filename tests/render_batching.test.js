// A TAB REWRITE, IN BATCHES.
//
// Every sectioned tab used to be formatted a column at a time: a background
// matrix, then a month tint that re-READ the column it had just been handed,
// then one setBackground per manual-entry column, then a setDataValidation per
// dropdown and per checkbox column, then four calls per manual-entry column on
// each header row — around five hundred round trips on the Registrants tab, of
// which four were the rows themselves. They now stage into the two zones'
// shared attribute planes and go out once each (97_render_batching.gs).
//
// This pins the part that matters: the CELLS that come out the other end. The
// four things most easily lost in a change like this are all checked below —
//
//   1. The layers. Three passes write backgrounds onto one zone — the zebra
//      stripe, the month tint on the date column, the yellow wash on the
//      manual-entry columns — and the last one to speak wins, per cell. A
//      model that lost the ordering would stripe over the tint.
//   2. Two ZONES, again. Upcoming and Past are separate bands, and a plane
//      staged for one must not reach the other.
//   3. FALL-THROUGH. Every stage* call answers false when no scope is open, so
//      the twenty callers that are not a render — an onEdit repair, the Config
//      tab, a dialog — must still write directly. A helper that silently did
//      nothing outside a scope would break them all quietly.
//   4. The PROTECTIONS, which are now skipped when the geometry is unchanged.
//      Skipping one that should have been rebuilt is a warning nobody gets.
//
// And, loosely, the COST: a re-render of a settled tab must stay around a
// hundred round trips. That is the point of the change, and an edit that put a
// per-column call back would otherwise pass every other test here.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet, roundTrips } = require('./helpers/counting_sheet');

const NOW = new Date(2026, 8, 9, 9, 0, 0); // Wed 9 Sep 2026
const RealDate = Date;
const pad = n => String(n).padStart(2, '0');

/** A chainable do-nothing builder — every SpreadsheetApp.new*() shape at once. */
function builder(kind, spec) {
  spec = spec || { kind };
  const b = new Proxy({}, {
    get(t, prop) {
      if (prop === 'build') return () => Object.assign({ __rule: true }, spec);
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        spec[prop] = args.length === 1 ? args[0] : args;
        return b;
      };
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
    BorderStyle: { SOLID: 'SOLID' }
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
this.MANUAL_ENTRY_CELL_TINT = MANUAL_ENTRY_CELL_TINT;
this.MANUAL_ENTRY_HEADER_COLOR = MANUAL_ENTRY_HEADER_COLOR;
this.MANUAL_ENTRY_PREFIX = MANUAL_ENTRY_PREFIX;
this.REGISTRANT_EDITABLE_COLUMNS = REGISTRANT_EDITABLE_COLUMNS;
this.REGISTRANT_HIDDEN_COLUMNS = REGISTRANT_HIDDEN_COLUMNS;
this.getMonthColor = getMonthColor;
this.getMonthLabel = getMonthLabel;
this.renderFlatDateSheet = renderFlatDateSheet;
this.applyRegistrantsFormatting = applyRegistrantsFormatting;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.invalidateAutosizeMemo = invalidateAutosizeMemo;
this.withRenderBatch = withRenderBatch;
this.declareRenderBand = declareRenderBand;
this.stageRenderValidation = stageRenderValidation;
this.stageRenderColumnBackground = stageRenderColumnBackground;
this.applyValueListValidationBounded = applyValueListValidationBounded;
this.applyZebraStripingManualBounded = applyZebraStripingManualBounded;
this.applyBoundedColumnFormat = applyBoundedColumnFormat;
this.protectDerivedColumns = protectDerivedColumns;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const HEADERS = sandbox.HEADERS.All_Registrants;
const col = name => HEADERS.indexOf(name);

const ALL_PROGRAMS = ['Chair Yoga', 'Book Club', 'Tai Chi', 'Watercolours',
  'Current Events', 'Beginner Bridge', 'Gentle Movement', 'Computer Help'];

function buildRows(weeksBack, weeksForward, programs) {
  const rows = [];
  for (let w = -weeksBack; w <= weeksForward; w++) {
    (programs || ['Chair Yoga', 'Book Club']).forEach((title, p) => {
      const date = new RealDate(2026, 8, 9 + w * 7, 10, 0);
      const row = new Array(HEADERS.length).fill('');
      row[col('Event_Date')] = date;
      row[col('Event_Time')] = '10:00 AM – 11:30 AM';
      row[col('Location')] = p === 0 ? 'Ashbridge' : 'Narberth';
      row[col('Event')] = title;
      row[col('Name')] = `Person ${w}-${p}`;
      row[col('Person_Type')] = 'Registrant';
      row[col('Program_Status')] = 'Active';
      row[col('Event_ID')] = `evt|${title}|${w}`;
      row[col('Manual_Override')] = 'Auto-Synced';
      rows.push(row);
    });
  }
  return rows;
}

function freshSheet(name) {
  const grid = [];
  const sheet = makeCountingSheet(grid, name);
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: n => (n === name ? sheet : null),
    getSheets: () => [sheet],
    toast: () => {}
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  return sheet;
}

function render(sheet, rows) {
  sandbox.invalidateSectionedRowsCache(sheet);
  sheet.calls.length = 0;
  return sandbox.renderFlatDateSheet(sheet, HEADERS, rows, {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    textColumns: ['Event_Time'],
    afterWrite: sandbox.applyRegistrantsFormatting
  });
}

const callsNamed = (sheet, name) => sheet.calls.filter(c => c.name === name);

// ---------------------------------------------------------------------------
// 1. ONE BACKGROUND WRITE PER ZONE, CARRYING ALL THREE LAYERS
// ---------------------------------------------------------------------------
{
  const rows = buildRows(3, 3);
  const sheet = freshSheet('All_Registrants');
  const result = render(sheet, rows);

  const bgWrites = callsNamed(sheet, 'setBackgrounds')
    .filter(c => c.rows > 1 && c.cols === HEADERS.length);
  assert.strictEqual(bgWrites.length, 2,
    `expected one whole-band background write per zone, got ${bgWrites.length}`);

  const upcoming = bgWrites.find(c => c.row === result.upcomingDataStart);
  assert.ok(upcoming, 'the Upcoming zone got its own background write');
  assert.strictEqual(upcoming.rows, result.upcomingCount);
  const matrix = upcoming.args[0];

  // The zebra stripe, on a column no other layer touches.
  const plain = col('Person_Type');
  assert.strictEqual(matrix[0][plain], sandbox.PALETTE.PAPER);
  assert.strictEqual(matrix[1][plain], sandbox.PALETTE.STRIPE);

  // The month tint, on the date column, from the dates that were WRITTEN —
  // never read back off the tab.
  const dateCol = col('Event_Date');
  const firstDate = sheet.grid[result.upcomingDataStart - 1][dateCol];
  assert.strictEqual(matrix[0][dateCol],
    sandbox.getMonthColor(sandbox.getMonthLabel(firstDate)),
    'the date cell carries its month color, not the stripe');
  assert.ok(!callsNamed(sheet, 'getValues').length ||
    callsNamed(sheet, 'getValues').every(c => c.cols !== 1),
    'nothing read a single column back after writing it');

  // The manual-entry wash, last, over whatever was underneath it.
  const editable = sandbox.REGISTRANT_EDITABLE_COLUMNS.filter(h => col(h) >= 0);
  assert.ok(editable.length > 0, 'the registrant tab has editable columns');
  editable.forEach(h => {
    assert.strictEqual(matrix[0][col(h)], sandbox.MANUAL_ENTRY_CELL_TINT,
      `${h} keeps the manual-entry wash`);
    assert.strictEqual(matrix[1][col(h)], sandbox.MANUAL_ENTRY_CELL_TINT,
      `${h} is washed on the striped rows too`);
  });
}

// ---------------------------------------------------------------------------
// 2. ONE VALIDATION WRITE PER ZONE, WITH null WHERE THERE IS NO RULE
// ---------------------------------------------------------------------------
{
  const rows = buildRows(2, 2);
  const sheet = freshSheet('All_Registrants');
  const result = render(sheet, rows);

  const vWrites = callsNamed(sheet, 'setDataValidations');
  assert.strictEqual(vWrites.length, 2, 'one validation plane per zone');
  assert.strictEqual(callsNamed(sheet, 'setDataValidation').length, 0,
    'no column-at-a-time validation survives inside a render scope');

  const plane = vWrites.find(c => c.row === result.upcomingDataStart).args[0];
  assert.strictEqual(plane.length, result.upcomingCount);
  assert.ok(plane[0][col('Program_Status')], 'Program_Status carries a dropdown');
  assert.ok(plane[0][col('Manual_Override')], 'Manual_Override carries a dropdown');
  assert.strictEqual(plane[0][col('Name')], null, 'a column nobody validated is cleared, not skipped');
  // Every row of the band is the same rule list — that is what lets the plane
  // share one array. Identity, not equality: a copy per row would be 47,000
  // objects on a real tab.
  assert.strictEqual(plane[0], plane[plane.length - 1],
    'the rows of the validation plane share one array');
}

// ---------------------------------------------------------------------------
// 3. THE HEADER ROW: ITS LABELS AND ITS COLORS, IN ONE WRITE EACH
// ---------------------------------------------------------------------------
{
  const rows = buildRows(2, 2);
  const sheet = freshSheet('All_Registrants');
  const result = render(sheet, rows);

  const headerWrites = callsNamed(sheet, 'setValues')
    .filter(c => c.rows === 1 && c.row === result.upcomingHeaderRow);
  assert.strictEqual(headerWrites.length, 1, 'the header row is written once, labels included');
  const values = headerWrites[0].args[0][0];
  const editable = sandbox.REGISTRANT_EDITABLE_COLUMNS.filter(h => col(h) >= 0);
  editable.forEach(h => {
    assert.strictEqual(values[col(h)], `${sandbox.MANUAL_ENTRY_PREFIX} ${h}`,
      `${h}'s header carries its manual-entry label`);
  });
  assert.strictEqual(values[col('Name')], 'Name', 'a derived column keeps its plain name');

  const headerBg = callsNamed(sheet, 'setBackgrounds')
    .find(c => c.rows === 1 && c.row === result.upcomingHeaderRow).args[0][0];
  editable.forEach(h => {
    assert.strictEqual(headerBg[col(h)], sandbox.MANUAL_ENTRY_HEADER_COLOR);
  });
}

// ---------------------------------------------------------------------------
// 4. THE ZONES DO NOT BLEED
// ---------------------------------------------------------------------------
{
  const rows = buildRows(4, 1);
  const sheet = freshSheet('All_Registrants');
  const result = render(sheet, rows);
  assert.ok(result.upcomingCount > 0 && result.pastCount > 0, 'both zones have rows');

  callsNamed(sheet, 'setBackgrounds').filter(c => c.rows > 1).forEach(c => {
    const start = c.row;
    const end = c.row + c.rows - 1;
    const inUpcoming = start >= result.upcomingDataStart &&
      end <= result.upcomingDataStart + result.upcomingCount - 1;
    const inPast = start >= result.pastDataStart &&
      end <= result.pastDataStart + result.pastCount - 1;
    assert.ok(inUpcoming || inPast,
      `a background write at rows ${start}–${end} spans neither zone cleanly`);
  });
}

// ---------------------------------------------------------------------------
// 5. FALL-THROUGH: OUTSIDE A SCOPE, EVERY HELPER WRITES DIRECTLY
// ---------------------------------------------------------------------------
{
  const sheet = freshSheet('Config');
  sheet.calls.length = 0;
  sandbox.applyValueListValidationBounded(sheet, 3, ['Yes', 'No'], 5, 4);
  const direct = callsNamed(sheet, 'setDataValidation');
  assert.strictEqual(direct.length, 1, 'a dropdown outside a render is still written');
  assert.deepStrictEqual([direct[0].row, direct[0].col, direct[0].rows], [5, 3, 4]);

  sheet.calls.length = 0;
  sandbox.applyBoundedColumnFormat(sheet, 2, 5, 4, { numberFormat: '0', alignment: 'center' });
  assert.strictEqual(callsNamed(sheet, 'setNumberFormat').length, 1);
  assert.strictEqual(callsNamed(sheet, 'setHorizontalAlignment').length, 1);

  // A range that is not inside any declared band, inside a scope: same answer.
  sheet.calls.length = 0;
  sandbox.withRenderBatch(sheet, 10, () => {
    sandbox.declareRenderBand(sheet, 100, 5);
    sandbox.applyValueListValidationBounded(sheet, 3, ['Yes', 'No'], 5, 4);
  });
  assert.strictEqual(callsNamed(sheet, 'setDataValidation').length, 1,
    'a range outside every declared band is written directly');

  // ...and a NARROWER block inside one, which is what the hero "Today" strip on
  // the two dashboards is: four columns wide where the scope is the table's
  // twenty. Staging it would stripe four columns and leave sixteen unwritten.
  sheet.calls.length = 0;
  sandbox.withRenderBatch(sheet, 10, () => {
    sandbox.declareRenderBand(sheet, 5, 4);
    sandbox.applyZebraStripingManualBounded(sheet, 5, 4, 3);   // narrower than the scope
  });
  const narrow = callsNamed(sheet, 'setBackgrounds').filter(c => c.cols === 3);
  assert.strictEqual(narrow.length, 1,
    'a block narrower than the scope is striped directly, not staged into the band');
}

// ---------------------------------------------------------------------------
// 6. A SCOPE THAT THREW WRITES NOTHING
// ---------------------------------------------------------------------------
{
  const sheet = freshSheet('All_Registrants');
  sheet.calls.length = 0;
  assert.throws(() => sandbox.withRenderBatch(sheet, 10, () => {
    sandbox.declareRenderBand(sheet, 5, 3);
    sandbox.stageRenderColumnBackground(sheet, 5, 2, 3, '#ff0000');
    throw new Error('half-way');
  }), /half-way/);
  assert.strictEqual(callsNamed(sheet, 'setBackgrounds').length, 0,
    'a render that threw does not assert a layout it did not finish');
  // ...and the scope is closed again, so the next render is not staging into it.
  sheet.calls.length = 0;
  sandbox.applyValueListValidationBounded(sheet, 3, ['Yes', 'No'], 5, 4);
  assert.strictEqual(callsNamed(sheet, 'setDataValidation').length, 1);
}

// ---------------------------------------------------------------------------
// 7. PROTECTIONS: BUILT ONCE, THEN LEFT ALONE — AND REBUILT WHEN ROWS MOVE
// ---------------------------------------------------------------------------
{
  const sheet = freshSheet('All_Registrants');
  const zones = [{ start: 4, count: 10 }, { start: 20, count: 6 }];
  const names = ['Event_Date', 'Name', 'Location'];

  sandbox.protectDerivedColumns(sheet, HEADERS, names, zones);
  const built = sheet.__protections.length;
  assert.strictEqual(built, names.length * zones.length,
    'one warning protection per derived column per zone');

  const before = roundTrips(sheet.stats);
  sandbox.protectDerivedColumns(sheet, HEADERS, names, zones);
  const cost = roundTrips(sheet.stats) - before;
  assert.strictEqual(sheet.__protections.length, built, 'nothing was rebuilt');
  assert.ok(cost <= 2, `an unchanged layout costs one read, not ${cost} round trips`);

  // Rows moved — the ranges are wrong now, so they go and come back.
  sandbox.protectDerivedColumns(sheet, HEADERS, names, [{ start: 4, count: 11 }, { start: 21, count: 6 }]);
  assert.strictEqual(sheet.__protections.length, built, 'rebuilt for the new geometry');
  assert.ok(sheet.__protections.some(p => p.__a1.indexOf('11x') !== -1 || p.__a1.indexOf('x1') !== -1),
    'the new protections cover the new row counts');

  // Somebody removed one by hand: the count no longer matches, so rebuild.
  sheet.__protections.pop();
  sandbox.protectDerivedColumns(sheet, HEADERS, names, [{ start: 4, count: 11 }, { start: 21, count: 6 }]);
  assert.strictEqual(sheet.__protections.length, built,
    'a protection deleted by hand is put back on the next render');
}

// ---------------------------------------------------------------------------
// 7b. TWO TABS OF THE SAME NAME IN DIFFERENT FILES ARE REMEMBERED APART
//
// Every program registrant sheet (46) is a tab called "Sign_Up_Sheet" in its
// own spreadsheet, and protectDerivedColumns() is called on all of them. One
// entry shared between forty of them cannot make a render skip work it needed
// — the count is read back off the sheet in front of it — but each push would
// overwrite the last one's line and the skip would never fire at all.
// ---------------------------------------------------------------------------
{
  const zones = [{ start: 4, count: 10 }];
  const names = ['Event_Date', 'Name'];
  const a = freshSheet('Sign_Up_Sheet');
  const b = makeCountingSheet([], 'Sign_Up_Sheet');

  sandbox.protectDerivedColumns(a, HEADERS, names, zones);
  sandbox.protectDerivedColumns(b, HEADERS, names, zones);
  assert.strictEqual(a.__protections.length, names.length);
  assert.strictEqual(b.__protections.length, names.length);

  // Now the second render of each, with the OTHER file rendered in between —
  // which is exactly what a sync does across forty of these.
  const beforeA = roundTrips(a.stats);
  sandbox.protectDerivedColumns(a, HEADERS, names, zones);
  sandbox.protectDerivedColumns(b, HEADERS, names, zones);
  const costA = roundTrips(a.stats) - beforeA;
  assert.ok(costA <= 2,
    `a tab whose own layout has not moved costs one read even when forty like it rendered ` +
    `in between, was ${costA}`);
}

// ---------------------------------------------------------------------------
// 8. THE COST — the reason all of the above exists
// ---------------------------------------------------------------------------
{
  const rows = buildRows(26, 13, ALL_PROGRAMS);
  const sheet = freshSheet('All_Registrants');
  sandbox.invalidateAutosizeMemo();
  render(sheet, rows);                       // first: protections and widths are new
  const before = roundTrips(sheet.stats);
  render(sheet, rows);                       // second: the shape a sync actually pays for
  const repeat = roundTrips(sheet.stats) - before;
  assert.ok(repeat < 120,
    `a re-render of a settled tab should stay near a hundred round trips, was ${repeat}`);
  assert.ok(rows.length > 300, 'measured on a tab big enough for the number to mean something');
}

console.log('✅ render_batching.test.js passed');
