// ============================================================================
// THE TWO PAINTERS MUST PAINT THE SAME SHEET  (99zk)
// ============================================================================
//
// 99zk_sheets_batch_update.gs sends a render's formatting as Sheets API
// requests instead of SpreadsheetApp calls. It is only allowed to change HOW
// the sheet is painted, never WHAT — so every case here paints one input twice
// onto tests/helpers/painting_sheet.js, once with no `Sheets` service (the old
// path) and once with the fake service, and requires the two models to be
// identical: values, every format attribute, notes, validations, row heights,
// column widths, hidden columns, frozen panes, protections.
//
// Plus the things a golden comparison cannot see on its own: that the API path
// really was taken (and in how few calls), that a refusal falls back to the old
// path with nothing half applied, that the kill switch works, and that a grid
// range is never off by one.
// ============================================================================
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makePaintingSheet, makeSheetsService, makeValidationBuilder, snapshot } =
  require('./helpers/painting_sheet');

const NOW = new Date(2026, 8, 9, 9, 0, 0);
const RealDate = Date;
const pad = n => String(n).padStart(2, '0');
const store = {};
const logs = [];

const sandbox = {
  console,
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
      return 'Wed 9 Sep at 9:00 AM';
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: (() => {
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
    newDataValidation: () => makeValidationBuilder(),
    newConditionalFormatRule: () => new Proxy({}, { get: (t, p) => (p === 'build' ? () => ({}) : () => t.__self) }),
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
// A conditional-format builder that chains: every method returns itself.
sandbox.SpreadsheetApp.newConditionalFormatRule = () => {
  const b = new Proxy({}, { get: (t, p) => (p === 'build' ? () => ({ __cf: true }) : () => b) });
  return b;
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.getIndexMap = getIndexMap;
this.writeProgramLeaderSheetTab = writeProgramLeaderSheetTab;
this.renderFlatDateSheet = renderFlatDateSheet;
this.applyRegistrantsFormatting = applyRegistrantsFormatting;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.invalidateAutosizeMemo = invalidateAutosizeMemo;
this.resetSheetsBatchFailures_ = resetSheetsBatchFailures_;
this.sheetsGridRange_ = sheetsGridRange_;
this.sheetsBatchBackgrounds_ = sheetsBatchBackgrounds_;
this.sendSheetsBatch_ = sendSheetsBatch_;
this.sheetsNumberFormat_ = sheetsNumberFormat_;
this.sheetsLiteralValue_ = sheetsLiteralValue_;
this.SHEETS_BATCH_MAX_BYTES = SHEETS_BATCH_MAX_BYTES;
`, sandbox, { filename: 'program.gs' });
sandbox.log = msg => logs.push(String(msg));
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

let serial = 0;
function freshSheet(name) {
  serial++;
  const sheet = makePaintingSheet({ name, sheetId: 100 + serial, fileId: `file-${serial}` });
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: n => (n === name ? sheet : null), getSheets: () => [sheet], toast: () => {}, getId: () => `file-${serial}`
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  return sheet;
}

/** Paint with the old path (no Sheets service). */
function legacy(fn) {
  delete sandbox.Sheets;
  sandbox.resetSheetsBatchFailures_();
  sandbox.invalidateAutosizeMemo();
  return fn();
}

/** Paint with the API path, against a fake service the sheet is registered with. */
function viaApi(sheet, fn, service) {
  service = service || makeSheetsService();
  service.register(sheet);
  sandbox.Sheets = service;
  sandbox.resetSheetsBatchFailures_();
  sandbox.invalidateAutosizeMemo();
  try { fn(); } finally { delete sandbox.Sheets; }
  return service;
}

function same(a, b, label) {
  const sa = snapshot(a);
  const sb = snapshot(b);
  Object.keys(sa).forEach(k => {
    if (k === 'cells') {
      const keys = new Set([...Object.keys(sa.cells), ...Object.keys(sb.cells)]);
      keys.forEach(cell => assert.deepStrictEqual(sb.cells[cell], sa.cells[cell], `${label}: cell ${cell} differs`));
    } else {
      assert.deepStrictEqual(sb[k], sa[k], `${label}: ${k} differs`);
    }
  });
}

// --- the program registrant sheet -------------------------------------------

const LH = sandbox.LEADER_SHEET_HEADERS;
const LMAP = sandbox.getIndexMap(LH);
function leaderRows(weeks, perWeek, opts) {
  opts = opts || {};
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    for (let n = 0; n < perWeek; n++) {
      const row = new Array(LH.length).fill('');
      row[LMAP['Event_Date']] = new RealDate(2026, 8, 15 + w * 7, 10, 0);
      row[LMAP['Event_Time']] = n === 0 ? '10:00 AM' : '10:00 AM – 11:30 AM';
      row[LMAP['Location']] = 'Ashbridge';
      row[LMAP['Name']] = `Person ${w}-${n}`;
      row[LMAP['Party_Size']] = 1;
      row[LMAP['Program_Status']] = opts.waitlistAt === `${w}-${n}` ? 'Waitlisted' : 'Active';
      row[LMAP['Contacted']] = n % 2 === 0;
      row[LMAP['Event_ID']] = `evt|Chair Yoga|${w}`;
      row[LMAP['Row_Key']] = `k${w}-${n}`;
      row[LMAP['Answers']] = 'Q: a\nQ2: b';
      rows.push(row);
    }
  }
  return rows;
}
const ENTRY = { title: 'Chair Yoga', location: 'Ashbridge', fileId: 'x' };

function leaderCase(label, renders) {
  const a = freshSheet('Sign_Up_Sheet');
  const b = freshSheet('Sign_Up_Sheet');
  renders.forEach(rows => legacy(() => sandbox.writeProgramLeaderSheetTab(a, ENTRY, rows.map(r => r.slice()))));
  const before = b.stats.calls;
  let service;
  renders.forEach(rows => {
    service = viaApi(b, () => sandbox.writeProgramLeaderSheetTab(b, ENTRY, rows.map(r => r.slice())), service);
  });
  same(a, b, label);
  return { a, b, service, apiSpreadsheetAppCalls: b.stats.calls - before };
}

// 1. A year of a weekly class with a waitlisted row.
{
  const logStart = logs.length;
  const r = leaderCase('a year of a weekly class', [leaderRows(52, 4, { waitlistAt: '3-2' })]);
  assert.strictEqual(r.service.stats.batchUpdate, 2, 'the leader sheet is two batchUpdates');
  assert.strictEqual(r.service.stats.get, 1, 'one width read (a fresh sheet has no old protections to look up)');
  assert.ok(r.apiSpreadsheetAppCalls < 30, `SpreadsheetApp calls on the API path: ${r.apiSpreadsheetAppCalls}`);
  assert.ok(!logs.slice(logStart).some(l => /Sheets API formatting failed/.test(l)), 'no fallback was taken');
  // The things a reader actually looks at, stated outright rather than only by comparison.
  const s = snapshot(r.b);
  assert.strictEqual(s.frozenRows, 2);
  assert.strictEqual(s.frozenCols, LMAP['Name'] + 1);
  assert.deepStrictEqual(s.hidden, [LMAP['Row_Key'] + 1, LMAP['Pushed_Snapshot'] + 1]);
  assert.strictEqual(s.rowHeights[3], 30, 'the first band row is banner height');
  assert.strictEqual(s.cells[`4,${LMAP['Event_Time'] + 1}`].value, '10:00 AM', 'a bare time stays words');
  assert.strictEqual(s.cells[`4,${LMAP['Event_Time'] + 1}`].numberFormat, '@');
  assert.strictEqual(s.cells[`4,${LMAP['Contacted'] + 1}`].validation, 'checkbox:false');
  assert.ok(s.protections.length > 0, 'derived columns are protected');
}

// 2. A sheet re-rendered with fewer rows, and an empty roster.
leaderCase('shrinking re-render', [leaderRows(10, 3), leaderRows(4, 2)]);
leaderCase('empty roster after a full one', [leaderRows(3, 3), []]);
leaderCase('empty roster from new', [[]]);

// 3. Mid-transition: a sheet painted by the OLD code, then by the new.
{
  const a = freshSheet('Sign_Up_Sheet');
  const b = freshSheet('Sign_Up_Sheet');
  legacy(() => sandbox.writeProgramLeaderSheetTab(a, ENTRY, leaderRows(6, 3)));
  legacy(() => sandbox.writeProgramLeaderSheetTab(a, ENTRY, leaderRows(5, 3)));
  legacy(() => sandbox.writeProgramLeaderSheetTab(b, ENTRY, leaderRows(6, 3)));
  viaApi(b, () => sandbox.writeProgramLeaderSheetTab(b, ENTRY, leaderRows(5, 3)));
  same(a, b, 'old path then new');
}

// 4. A refusal: the API throws, nothing is half applied, the old path paints.
{
  const a = freshSheet('Sign_Up_Sheet');
  const b = freshSheet('Sign_Up_Sheet');
  legacy(() => sandbox.writeProgramLeaderSheetTab(a, ENTRY, leaderRows(4, 2)));
  const service = makeSheetsService();
  service.failWith(new Error('403 The caller does not have permission'));
  const logStart = logs.length;
  viaApi(b, () => sandbox.writeProgramLeaderSheetTab(b, ENTRY, leaderRows(4, 2)), service);
  same(a, b, 'fallback after a refusal');
  assert.ok(logs.slice(logStart).some(l => /Sheets API formatting failed/.test(l)), 'the refusal is logged');
}

// 5. The kill switch.
{
  const b = freshSheet('Sign_Up_Sheet');
  store.SHEETS_BATCH_FORMATTING_V1 = 'off';
  const service = viaApi(b, () => sandbox.writeProgramLeaderSheetTab(b, ENTRY, leaderRows(2, 2)));
  delete store.SHEETS_BATCH_FORMATTING_V1;
  assert.strictEqual(service.stats.batchUpdate, 0, 'off means the API is never called');
}

// 6. A non-string Event_Time goes the old way rather than painting differently.
{
  const rows = leaderRows(2, 2);
  rows[0][LMAP['Event_Time']] = new RealDate(2026, 8, 15, 10, 0);
  const b = freshSheet('Sign_Up_Sheet');
  const service = viaApi(b, () => sandbox.writeProgramLeaderSheetTab(b, ENTRY, rows));
  assert.strictEqual(service.stats.batchUpdate, 0);
}

// --- the Registrants render (97's flush) -------------------------------------

const RH = sandbox.HEADERS.All_Registrants;
const rcol = n => RH.indexOf(n);
function registrantRows(weeksBack, weeksForward) {
  const rows = [];
  for (let w = -weeksBack; w <= weeksForward; w++) {
    ['Chair Yoga', 'Book Club', 'Tai Chi'].forEach((title, p) => {
      for (let n = 0; n < 3; n++) {
        const row = new Array(RH.length).fill('');
        row[rcol('Event_Date')] = new RealDate(2026, 8, 9 + w * 7, 10 + p, 0);
        row[rcol('Event_Time')] = '10:00 AM – 11:30 AM';
        row[rcol('Location')] = p % 2 === 0 ? 'Ashbridge' : 'Narberth';
        row[rcol('Event')] = title;
        row[rcol('Name')] = `Person ${p}-${n}`;
        row[rcol('Person_Type')] = 'Registrant';
        row[rcol('Program_Status')] = 'Active';
        row[rcol('Lunch_Status')] = 'Needed';
        row[rcol('Event_ID')] = `evt|${title}|${w}`;
        row[rcol('Manual_Override')] = 'Auto-Synced';
        rows.push(row);
      }
    });
  }
  return rows;
}
function renderRegistrants(sheet, rows) {
  sandbox.invalidateSectionedRowsCache(sheet);
  return sandbox.renderFlatDateSheet(sheet, RH, rows.map(r => r.slice()), {
    upcomingLabel: '⏳ Upcoming Registrants', pastLabel: '🕓 Past Registrants',
    textColumns: ['Event_Time'], force: false, afterWrite: sandbox.applyRegistrantsFormatting
  });
}
{
  const rows = registrantRows(8, 4);
  const a = freshSheet('All_Registrants');
  legacy(() => renderRegistrants(a, rows));
  legacy(() => renderRegistrants(a, rows));
  const b = freshSheet('All_Registrants');
  const logStart = logs.length;
  const service = makeSheetsService();
  viaApi(b, () => renderRegistrants(b, rows), service);
  viaApi(b, () => renderRegistrants(b, rows), service);
  assert.ok(!logs.slice(logStart).some(l => /Sheets API formatting failed/.test(l)),
    `no fallback: ${logs.slice(logStart).filter(l => /Sheets API/.test(l)).join(' / ')}`);
  assert.strictEqual(service.stats.batchUpdate, 2, 'one batchUpdate per render');
  same(a, b, 'Registrants render, twice');
}

// --- the arithmetic ---------------------------------------------------------

// 1-based inclusive → 0-based exclusive, and nothing that is not a whole number.
const plain = v => JSON.parse(JSON.stringify(v)); // across the vm realm boundary
assert.deepStrictEqual(plain(sandbox.sheetsGridRange_(7, 3, 2, 4, 5)),
  { sheetId: 7, startRowIndex: 2, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 6 });
assert.deepStrictEqual(plain(sandbox.sheetsGridRange_(7, 1, null, 1, null)), { sheetId: 7, startRowIndex: 0, endRowIndex: 1 });
[0, -1, 1.5, NaN, '2'].forEach(bad => assert.throws(() => sandbox.sheetsGridRange_(7, bad, 1, 1, 1), /Bad grid/));

assert.strictEqual(sandbox.sheetsNumberFormat_('@').type, 'TEXT');
assert.strictEqual(sandbox.sheetsNumberFormat_('ddd M/d/yyyy').type, 'DATE');
assert.strictEqual(sandbox.sheetsNumberFormat_('h:mm AM/PM').type, 'TIME');
assert.strictEqual(sandbox.sheetsNumberFormat_('0').type, 'NUMBER');

assert.deepStrictEqual(plain(sandbox.sheetsLiteralValue_('✍️ Attended')), { stringValue: '✍️ Attended' });
['12', '3/4', '10:00', 'TRUE', '$5'].forEach(v => assert.throws(() => sandbox.sheetsLiteralValue_(v), /parsed/));
assert.deepStrictEqual(plain(sandbox.sheetsLiteralValue_('10:00 AM', { asText: true })), { stringValue: '10:00 AM' });

// The background encoder paints exactly its matrix, whichever encoding it picks.
{
  const zebra = [];
  for (let r = 0; r < 40; r++) {
    const line = new Array(12).fill(r % 2 ? '#F0F4F8' : '#FFFFFF');
    line[5] = '#FFFCF0'; line[6] = '#FFFCF0'; line[9] = r < 20 ? '#DFF1EE' : '#F8F4DC';
    zebra.push(line);
  }
  const random = zebra.map((line, r) => line.map((c, i) => ((r * 7 + i * 3) % 5 === 0 ? '#A5D68F' : c)));
  [zebra, random].forEach((matrix, which) => {
    const s = makePaintingSheet({ name: 'T', sheetId: 9, fileId: 'enc' });
    const service = makeSheetsService();
    service.register(s);
    sandbox.Sheets = service;
    const batch = { sheet: s, spreadsheetId: 'enc', sheetId: 9, requests: [] };
    sandbox.sheetsBatchBackgrounds_(batch, 5, 2, matrix);
    sandbox.sendSheetsBatch_(batch);
    delete sandbox.Sheets;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < 12; c++) {
        assert.strictEqual(s.model.fmt[`${5 + r},${2 + c}`].background, matrix[r][c].toLowerCase(),
          `encoding ${which}: R${5 + r}C${2 + c}`);
      }
    }
    assert.strictEqual(s.model.fmt['4,2'], undefined, 'the row above the band is untouched');
    assert.strictEqual(s.model.fmt[`${5 + matrix.length},2`], undefined, 'the row below the band is untouched');
    assert.strictEqual(s.model.fmt['5,1'], undefined, 'the column left of the band is untouched');
  });
}

// A request list past the byte ceiling goes out in more than one call — never one per request.
{
  const s = makePaintingSheet({ name: 'T', sheetId: 9, fileId: 'big', maxRows: 5000, maxCols: 30 });
  const service = makeSheetsService();
  service.register(s);
  sandbox.Sheets = service;
  const batch = { sheet: s, spreadsheetId: 'big', sheetId: 9, requests: [] };
  const matrix = [];
  for (let r = 0; r < 4000; r++) matrix.push(new Array(30).fill(0).map((x, i) => ((r + i) % 3 ? '#FFFFFF' : '#F0F4F8')));
  sandbox.sheetsBatchBackgrounds_(batch, 1, 1, matrix);
  const n = batch.requests.length;
  const calls = sandbox.sendSheetsBatch_(batch);
  delete sandbox.Sheets;
  assert.ok(calls > 1 && calls < n, `split into ${calls} calls for ${n} requests`);
  assert.strictEqual(s.model.fmt['4000,30'].background, matrix[3999][29].toLowerCase());
}

console.log('sheets_batch_golden: all passed');
