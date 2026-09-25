// WRITE BEFORE CLEARING, ON EVERY TAB THAT USED TO CLEAR (99u).
//
// Each of these renderers began with sheet.clear() and wrote its rows dozens
// of calls later; a run killed in between left the tab empty, and the next
// render read the empty tab and wrote nothing back. Now each lands its data
// in ONE write first, where the render will put it. The shared checker
// (helpers/write_before_clear.js) proves, per renderer, that clear() is never
// called, that the early write came first, that no old cell survives, and that
// every cell written early is written again by the render — i.e. that each
// renderer's prediction of where its table starts is right, including under a
// Today block, a metrics block, a pinned lunch sign-up block and the Metrics
// tab's two summary tables. The flat tabs and the registrant sheet are held
// to the same rule in render_batching.test.js and leader_sheet_push.test.js.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');
const { checkWriteBeforeClear } = require('./helpers/write_before_clear');

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
this.QUICK_MARK_INDEX_FIRST_ROW = QUICK_MARK_INDEX_FIRST_ROW;
`, sandbox, { filename: 'program.gs' });
sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

let logged = [];
sandbox.log = msg => logged.push(String(msg));

function sheetNamed(name) {
  const grid = [];
  const sheet = makeCountingSheet(grid, name);
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: n => (n === name ? sheet : null), getSheets: () => [sheet], toast: () => {},
    getId: () => 'ss', getActiveSheet: () => sheet
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  return { grid, sheet };
}

function rowOf(headers, fields) {
  const row = new Array(headers.length).fill('');
  Object.keys(fields).forEach(h => { if (headers.indexOf(h) >= 0) row[headers.indexOf(h)] = fields[h]; });
  return row;
}

function noMismatchLogged(label) {
  const bad = logged.filter(l => l.indexOf('written early at row') !== -1);
  assert.deepStrictEqual(bad, [], `${label}: the render did not land where it was written early`);
  logged = [];
}

// --- 43: the session table, under a Today block of two locations ----------
{
  const headers = sandbox.HEADERS.All_Program_Sessions;
  const map = sandbox.getIndexMap(headers);
  const rows = [-7, -1, 2, 9].map((d, i) => rowOf(headers, {
    Event_Date: new RealDate(2026, 8, 9 + d, 10, 0), Location: i % 2 ? 'Narberth' : 'Ashbridge',
    Clean_Title: `Program ${i}`, Event_ID: `cal|Program ${i}|${d}`, Calendar_Source: 'cal'
  }));
  const todayData = [
    { location: 'Ashbridge', programsToday: 1, sessionsToday: 1, registeredToday: 3 },
    { location: 'Narberth', programsToday: 0, sessionsToday: 0, registeredToday: 0 }
  ];
  const { grid, sheet } = sheetNamed('All_Program_Sessions');
  checkWriteBeforeClear('All_Program_Sessions', sheet, grid,
    () => sandbox.writeProgramDashboardSheet(sheet, headers, map, rows, todayData, true),
    { expectRows: rows.map(r => [r[0]]) });
  noMismatchLogged('All_Program_Sessions');
}

// --- 78: the program dashboard, with and without the metrics block --------
{
  const headers = sandbox.HEADERS.Master_Program_Dashboard;
  const running = rowOf(headers, { Program: 'Chair Yoga', Location: 'Main', Group_Key: 'program::chair yoga::main',
    Next_Date: new RealDate(2026, 9, 6), Last_Date: new RealDate(2026, 11, 15), Status: 'Active' });
  const finished = rowOf(headers, { Program: 'Winter Chorus', Location: 'Annex', Group_Key: 'program::winter chorus::annex',
    Last_Date: new RealDate(2026, 2, 3), Status: 'Completed' });
  const built = () => ({ rows: [running.slice(), finished.slice()], notes: [], links: [], matched: [] });
  const month = label => ({ label, sessions: 1, registrations: 2, participants: 2, newPeople: 1,
    returningPct: 50, perSession: 2, attendedPct: 100 });
  [null, {
    windows: [{ label: 'Next 7 days', sessions: 1, registrations: 2, seatsFilledPct: 50, emptySeats: 4, waitlisted: 0 },
      { label: 'Next 30 days', sessions: 3, registrations: 5, seatsFilledPct: 40, emptySeats: 9, waitlisted: 1 }],
    months: { current: month('September'), previous: month('August') }
  }].forEach(metrics => {
    const label = `Master_Program_Dashboard (${metrics ? 'with' : 'without'} metrics)`;
    const { grid, sheet } = sheetNamed('Master_Program_Dashboard');
    checkWriteBeforeClear(label, sheet, grid,
      () => sandbox.writeProgramMonthSheet(sheet, built(), false, metrics),
      { expectRows: [[running[0]], [finished[0]]] });
    noMismatchLogged(label);
  });
}

// --- 44: the lunch dashboard, under its pinned sign-up and Today blocks ----
{
  const headers = sandbox.HEADERS.Master_Lunch_Dashboard;
  const rows = [-3, 1, 5].map(d => rowOf(headers, {
    Event_Date: new RealDate(2026, 8, 9 + d), Location: 'Ashbridge', Registered_Count: 4,
    Standard_Buffer: 1, Tester_Buffer: 0
  }));
  const signUpRows = [['September', 'Ashbridge', 3, 'Open', 'https://example.test/f']];
  const plan = sandbox.getDashboardRowPlan(signUpRows.length);
  const { grid, sheet } = sheetNamed('Master_Lunch_Dashboard');
  checkWriteBeforeClear('Master_Lunch_Dashboard', sheet, grid,
    () => sandbox.writeMasterLunchDashboardSheet(sheet, plan, headers, rows, [], signUpRows));
  assert.deepStrictEqual(logged.filter(l => l.indexOf('mismatch') !== -1), [],
    'Master_Lunch_Dashboard: its own row math still agrees');
  logged = [];
}

// --- 40: a memory tab ----------------------------------------------------
{
  const headers = ['Name', 'Email', 'Notes'];
  const rows = [['Ann', 'a@x.test', ''], ['Bob', 'b@x.test', 'regular']];
  const { grid, sheet } = sheetNamed('Member_Roll');
  checkWriteBeforeClear('memory tab', sheet, grid,
    () => sandbox.writeMemoryTab(sheet, headers, rows, { banner: 'Members', staffColumns: ['Notes'] }),
    { expectRows: rows });
}

// --- 83: the Metrics tab, under its two summary tables --------------------
{
  const headers = sandbox.HEADERS.Metrics;
  const rows = ['2026-07', '2026-08', '2025-09'].map(m => rowOf(headers, { Month: m, Sessions: 3, Registrations: 9 }));
  const { grid, sheet } = sheetNamed('Metrics');
  checkWriteBeforeClear('Metrics', sheet, grid,
    () => sandbox.writeMetricsSheet(sheet, rows, new RealDate(2026, 8, 9)),
    { expectRows: [['2026-08'], ['2026-07'], ['2025-09']] });
  noMismatchLogged('Metrics');
}

// --- 38: Quick Mark's stored index ----------------------------------------
{
  sandbox.Utilities.newBlob = text => ({ getBytes: () => Array.from(Buffer.from(String(text))) });
  sandbox.Utilities.gzip = blob => blob;
  sandbox.Utilities.base64Encode = bytes => Buffer.from(bytes).toString('base64');
  const name = vm.runInContext('QUICK_MARK_INDEX_SHEET_NAME', sandbox);
  const { grid, sheet } = sheetNamed(name);
  const index = { builtAt: 'now', sessions: [{ id: 1 }], members: [], needs: [] };
  checkWriteBeforeClear('Quick Mark index', sheet, grid, () => sandbox.writeSheetQuickMarkIndex(index),
    { junkCols: 3, singleWrite: true });
  assert.ok(String(grid[sandbox.QUICK_MARK_INDEX_FIRST_ROW - 1][0]).length > 0, 'the index chunks were stored');
}

console.log('✅ write_before_clear.test.js passed');
