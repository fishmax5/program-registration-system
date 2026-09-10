// ============================================================================
// WHAT DOES A TAB REWRITE COST?
// ============================================================================
//
// tools/sync_bench.js measures the RECONCILE phase — the passes that read the
// session table and change a few columns of it. This one measures the other
// half of the same execution: the RENDER, where a tab is cleared and written
// back out whole.
//
// A render's cost is almost never its setValues(). It is everything around it:
// a row-height run per zone, a background matrix, a month tint that re-READ
// the column it had just written, a data validation per column per zone, a
// warning protection created per derived column per zone (three calls each,
// and they are among the slowest calls Apps Script makes), a conditional
// format rule list, an autoResize and one getColumnWidth per column. None of
// those are Range.getValues(), and all of them stop the script and wait.
//
//     node tools/render_bench.js
//
// Like sync_bench, this is a MEASUREMENT and asserts nothing. What keeps the
// optimized render honest about what lands in the cells is
// tests/render_batching.test.js beside it.
// ============================================================================
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { readSource } = require(path.join(ROOT, 'tests', 'helpers', 'source'));
const { makeCountingSheet, roundTrips } = require(path.join(ROOT, 'tests', 'helpers', 'counting_sheet'));

const NOW = new Date(2026, 8, 9, 9, 0, 0); // Wed 9 Sep 2026
const RealDate = Date;
const pad = n => String(n).padStart(2, '0');

/** A chainable do-nothing builder — every SpreadsheetApp.new*() shape at once. */
function builder() {
  const b = new Proxy({}, {
    get(t, prop) {
      if (prop === 'build') return () => ({ __built: true });
      if (prop === 'copy') return () => builder();
      if (typeof prop !== 'string') return undefined;
      return () => b;
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
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
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
    newDataValidation: () => builder(),
    newConditionalFormatRule: () => builder(),
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
this.renderFlatDateSheet = renderFlatDateSheet;
this.applyRegistrantsFormatting = applyRegistrantsFormatting;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.writeUpcomingPastSections = writeUpcomingPastSections;
this.autosizeColumns = autosizeColumns;
this.protectDerivedColumns = protectDerivedColumns;
this.partitionByDate = partitionByDate;
this.formatDateKey = formatDateKey;
this.applyColumnVisibility = applyColumnVisibility;
this.collapseOldPastMonths = collapseOldPastMonths;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const HEADERS = sandbox.HEADERS.All_Registrants;
const col = name => HEADERS.indexOf(name);

// --- the tab this is measured against ---------------------------------------
//
// A year of registrations for a centre running eight programs a week at two
// buildings, four people on each: the size at which a render stops being
// instant and starts being a share of the execution budget.
function buildRegistrantRows(weeksBack, weeksForward) {
  const PROGRAMS = ['Chair Yoga', 'Book Club', 'Tai Chi', 'Watercolours',
    'Current Events', 'Beginner Bridge', 'Gentle Movement', 'Computer Help'];
  const rows = [];
  for (let w = -weeksBack; w <= weeksForward; w++) {
    PROGRAMS.forEach((title, p) => {
      for (let n = 0; n < 4; n++) {
        const date = new RealDate(2026, 8, 9 + w * 7, 10 + (p % 4), 0);
        const row = new Array(HEADERS.length).fill('');
        row[col('Event_Date')] = date;
        row[col('Event_Time')] = '10:00 AM – 11:30 AM';
        row[col('Location')] = p % 2 === 0 ? 'Ashbridge' : 'Narberth';
        row[col('Event')] = title;
        row[col('Name')] = `Person ${p}-${n}`;
        row[col('Person_Type')] = 'Registrant';
        row[col('Program_Status')] = 'Active';
        row[col('Lunch_Status')] = 'Needed';
        row[col('Event_ID')] = `evt|${title}|${w}`;
        row[col('Manual_Override')] = 'Auto-Synced';
        rows.push(row);
      }
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
  return sandbox.renderFlatDateSheet(sheet, HEADERS, rows, {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    textColumns: ['Event_Time'],
    force: false,
    afterWrite: sandbox.applyRegistrantsFormatting
  });
}

function run() {
  const rows = buildRegistrantRows(26, 13);
  const sheet = freshSheet('All_Registrants');

  console.log('\nTHE REGISTRANTS TAB — one full rewrite');
  console.log(`${rows.length} registrant rows, two zones, ${HEADERS.length} columns\n`);

  // FIRST render: an empty tab, so every protection and validation is new.
  const first = measure(() => render(sheet, rows), sheet);
  // SECOND render: the same rows onto the tab that already holds them, which
  // is what a sync actually does — several times in one execution.
  const second = measure(() => render(sheet, rows), sheet);

  // WHERE THE TRIPS WOULD GO WITH NO SCOPE OPEN. Each phase is called on its
  // own here, outside withRenderBatch(), which is exactly the shape the code
  // had before 97_render_batching.gs — so this table is the "before" the two
  // renders underneath it are measured against.
  const sheet2 = freshSheet('All_Registrants');
  render(sheet2, rows);
  const todayKey = sandbox.formatDateKey(new Date());
  const dateColIdx = HEADERS.indexOf('Event_Date');
  const part = sandbox.partitionByDate(rows, dateColIdx, todayKey);
  const phases = [];
  const phase = (name, fn) => phases.push([name, measure(fn, sheet2)]);
  let result;
  phase('writeUpcomingPastSections', () => {
    result = sandbox.writeUpcomingPastSections(sheet2, 1, HEADERS, part.upcoming, part.past, {
      upcomingLabel: 'U', pastLabel: 'P', textColumns: ['Event_Time'] });
  });
  phase('applyRegistrantsFormatting', () => sandbox.applyRegistrantsFormatting(sheet2, HEADERS, result));
  phase('autosizeColumns', () => sandbox.autosizeColumns(sheet2, { minCols: HEADERS.length }));
  console.log('  phase (unbatched, for comparison)      round trips  cells r/w');
  console.log('  ' + '-'.repeat(66));
  phases.forEach(([n, d]) => line(n, d));
  console.log('');

  console.log('  render                                 round trips  cells r/w');
  console.log('  ' + '-'.repeat(66));
  line('first (empty tab)', first);
  line('second (same geometry)', second);
  console.log('  ' + '-'.repeat(66));
  console.log(`  TOTAL round trips for two renders: ${first.trips + second.trips}`);
  console.log(`  breakdown of the second: ${describe(second)}`);
  return first.trips + second.trips;
}

function measure(fn, sheet) {
  const before = Object.assign({}, sheet.stats);
  try { fn(); } catch (err) { console.log(`  render threw: ${err && err.stack || err}`); }
  const after = sheet.stats;
  const delta = {};
  Object.keys(after).forEach(k => { delta[k] = after[k] - (before[k] || 0); });
  delta.trips = roundTrips(after) - roundTrips(before);
  return delta;
}

function line(name, d) {
  console.log(`  ${name.padEnd(38)}${String(d.trips).padStart(11)}  ${d.cellsRead}/${d.cellsWritten}`);
}

function describe(d) {
  return `getValues ${d.getValues}, setValues ${d.setValues}, setValue ${d.setValue}, ` +
    `range formatting ${d.formatting}, sheet-level ${d.sheetOps}`;
}

run();
