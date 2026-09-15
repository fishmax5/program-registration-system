// THE ROSTER THAT GOES BACK OUT, AND WHAT IT COSTS.
//
// pushProgramLeaderSheets() runs at the end of every hourly sync, on every
// registered program registrant sheet. Each of those lives in SOMEBODY ELSE'S
// spreadsheet, and rewriting one used to take the better part of eleven
// hundred round trips (tools/render_bench.js) — because the sheet is banded per
// SESSION, and a weekly class running a year is fifty-two bands with fifty-two
// runs of rows between them, each costing a handful of per-column calls.
// Multiply by one sheet per program and it is the single most expensive thing
// the sync does.
//
// Two changes, and this pins both:
//
//   1. The per-run loops are RangeLists. One call per attribute, not one per
//      attribute per session — a number that no longer grows with the length
//      of the class. The cells it lands on must be the same ones.
//   2. The whole rewrite is FINGERPRINTED, like the form date labels (10) and
//      the appointment times (55). An hour on which nobody's roster moved
//      costs one call — the banner's refresh stamp — instead of eleven
//      hundred. The risks are the two ends of that: skipping a sheet that HAD
//      changed, and never skipping at all because something in the fingerprint
//      moves on its own.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet, roundTrips } = require('./helpers/counting_sheet');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 9, 9, 0, 0).getTime();

function builder() {
  const b = new Proxy({}, {
    get(t, prop) {
      if (prop === 'build') return () => ({ __rule: true });
      if (typeof prop !== 'string') return undefined;
      return () => b;
    }
  });
  return b;
}

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  },
  Utilities: {
    formatDate: (d, tz, pattern) =>
      (pattern === 'yyyy-MM-dd' ? new RealDate(d).toISOString().slice(0, 10) : new RealDate(d).toISOString()),
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {},
    // The fingerprint hashes with this. A real digest is not needed — only
    // that two different inputs give two different answers.
    computeDigest: (algo, raw) => {
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
      return [(h >> 24) & 255, (h >> 16) & 255, (h >> 8) & 255, h & 255];
    },
    DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {},
    newDataValidation: () => builder(),
    newConditionalFormatRule: () => builder(),
    WrapStrategy: { CLIP: 'CLIP', OVERFLOW: 'OVERFLOW', WRAP: 'WRAP' },
    ProtectionType: { RANGE: 'RANGE' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.LEADER_OWNED_COLUMNS = LEADER_OWNED_COLUMNS;
this.LEADER_FLAG_COLUMNS = LEADER_FLAG_COLUMNS;
this.MANUAL_ENTRY_CELL_TINT = MANUAL_ENTRY_CELL_TINT;
this.LEADER_SHEET_BAND_BG = LEADER_SHEET_BAND_BG;
this.LEADER_SHEET_WAITLIST_BG = LEADER_SHEET_WAITLIST_BG;
this.PALETTE = PALETTE;
this.MEMORY_TAB_DATA_ROW = MEMORY_TAB_DATA_ROW;
this.MEMORY_TAB_BANNER_ROW = MEMORY_TAB_BANNER_ROW;
this.getIndexMap = getIndexMap;
this.writeProgramLeaderSheetTab = writeProgramLeaderSheetTab;
this.pushProgramLeaderSheets = pushProgramLeaderSheets;
this.computeLeaderSheetFingerprint = computeLeaderSheetFingerprint;
this.getProgramLeaderSheetRegistry = getProgramLeaderSheetRegistry;
this.__setRegistry = function (r) { __leaderSheetRegistryCache = r; };
this.__stubRowsByProgram = function (fn) { buildLeaderSheetRowsByProgram = fn; };
this.__stubAccess = function (fn) { ensureProgramLeaderSheetAccess = fn; };
this.__clearSpreadsheetHandles = function () { __spreadsheetHandleCache = {}; };
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const headers = sandbox.LEADER_SHEET_HEADERS;
const map = sandbox.getIndexMap(headers);

function rosterRows(weeks, perWeek) {
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    for (let n = 0; n < perWeek; n++) {
      const row = new Array(headers.length).fill('');
      row[map['Event_Date']] = new RealDate(2026, 0, 6 + w * 7, 10, 0);
      row[map['Event_Time']] = '10:00 AM – 11:30 AM';
      row[map['Name']] = `Person ${w}-${n}`;
      row[map['Party_Size']] = 1;
      row[map['Program_Status']] = 'Active';
      row[map['Event_ID']] = `evt|Chair Yoga|${w}`;
      rows.push(row);
    }
  }
  return rows;
}

const callsNamed = (sheet, name) => sheet.calls.filter(c => c.name === name);
const rangeListCalls = sheet => sheet.calls.filter(c => c.name.indexOf('rangeList.') === 0);

// ---------------------------------------------------------------------------
// 1. THE COST DOES NOT GROW WITH THE NUMBER OF SESSIONS
// ---------------------------------------------------------------------------
{
  const entry = { title: 'Chair Yoga', location: 'Ashbridge' };

  const short = makeCountingSheet([], 'Sign_Up_Sheet');
  sandbox.writeProgramLeaderSheetTab(short, entry, rosterRows(4, 4));
  const shortCost = roundTrips(short.stats);

  const long = makeCountingSheet([], 'Sign_Up_Sheet');
  sandbox.writeProgramLeaderSheetTab(long, entry, rosterRows(52, 4));
  const longCost = roundTrips(long.stats);

  // Thirteen times the sessions. Before the RangeLists this was very nearly
  // thirteen times the round trips; what is left that still scales is the row
  // HEIGHT of each band, which has no range-list form.
  assert.ok(longCost < shortCost * 4,
    `a year of a weekly class should not cost 13x a month of one — ${shortCost} vs ${longCost}`);
  assert.ok(longCost < 250, `a year of a weekly class should stay well under 250 trips, was ${longCost}`);
}

// ---------------------------------------------------------------------------
// 2. THE RangeLists LAND ON THE RIGHT CELLS
// ---------------------------------------------------------------------------
{
  const sheet = makeCountingSheet([], 'Sign_Up_Sheet');
  const rows = rosterRows(3, 2);           // 3 sessions, 2 people each
  sandbox.writeProgramLeaderSheetTab(sheet, { title: 'Chair Yoga', location: 'Ashbridge' }, rows);

  const lists = rangeListCalls(sheet);
  assert.ok(lists.length > 0, 'the per-run work went out as range lists');

  // Every tick-box column gets exactly one checkbox call, covering one range
  // per session run — three ranges here, never a band row among them.
  //
  // insertCheckboxes(), NOT setDataValidation(): a RangeList does not have the
  // latter, so the batched version of this threw on every registrant sheet
  // until it was changed (see applyLeaderFlagCheckboxes_ in `46`). The helper
  // now refuses that name, which is what makes this assertion mean something.
  const validations = lists.filter(c => c.name === 'rangeList.insertCheckboxes');
  assert.strictEqual(validations.length, sandbox.LEADER_FLAG_COLUMNS.length,
    'one checkbox call per tick-box column, whatever the number of sessions');
  validations.forEach(v => assert.strictEqual(v.ranges.length, 3,
    'covering one range per session run'));

  // The manual-entry wash: one call per leader-owned column, three ranges each.
  const washes = lists.filter(c => c.name === 'rangeList.setBackground' &&
    c.args[0] === sandbox.MANUAL_ENTRY_CELL_TINT);
  assert.strictEqual(washes.length, sandbox.LEADER_OWNED_COLUMNS.filter(h => map[h] !== undefined).length,
    'one wash call per leader-owned column');
  washes.forEach(w => assert.strictEqual(w.ranges.length, 3, 'covering all three session runs'));

  // The rows themselves: a band row, then its people, per session.
  const grid = callsNamed(sheet, 'setValues').find(c => c.rows > 1).args[0];
  assert.strictEqual(grid.length, 3 * (1 + 2), 'three bands and six people');
  assert.strictEqual(grid[0][map['Name']], '', 'the first row is a band, not a person');
  assert.strictEqual(grid[1][map['Name']], 'Person 0-0');

  // ...and the backgrounds still distinguish them, in one write.
  const bg = callsNamed(sheet, 'setBackgrounds').find(c => c.rows === grid.length).args[0];
  assert.strictEqual(bg[0][0], sandbox.LEADER_SHEET_BAND_BG, 'the band row is washed as a band');
  assert.strictEqual(bg[1][0], sandbox.PALETTE.PAPER, 'each class restarts its own stripe');
  assert.strictEqual(bg[2][0], sandbox.PALETTE.STRIPE);
  assert.strictEqual(bg[3][0], sandbox.LEADER_SHEET_BAND_BG, 'and the next band');
}

// ---------------------------------------------------------------------------
// 3. THE FINGERPRINT: AN HOUR WITH NO CHANGE COSTS ONE CALL
// ---------------------------------------------------------------------------
{
  const rows = rosterRows(12, 4);
  const sheet = makeCountingSheet([], 'Sign_Up_Sheet');
  sandbox.__clearSpreadsheetHandles();
  sandbox.SpreadsheetApp.openById = () => ({
    getSheetByName: () => sheet,
    insertSheet: () => sheet,
    getSheets: () => [sheet]
  });
  sandbox.__stubRowsByProgram(() => ({ 'chair yoga|ashbridge': rows }));
  sandbox.__stubAccess(() => ({ openedUp: true, editors: ['a@b.c'] }));
  sandbox.__setRegistry({
    'chair yoga|ashbridge': { fileId: 'F1', title: 'Chair Yoga', location: 'Ashbridge' }
  });

  const first = sandbox.pushProgramLeaderSheets([], []);
  assert.strictEqual(first, 1, 'the first push wrote the sheet');
  const entry = sandbox.getProgramLeaderSheetRegistry()['chair yoga|ashbridge'];
  assert.ok(entry.pushedFingerprint, 'and remembered what it wrote');
  assert.strictEqual(entry.accessOpened, true,
    'the sharing repair and the fingerprint both survive on the entry — neither Object.assign drops the other');

  const before = roundTrips(sheet.stats);
  const second = sandbox.pushProgramLeaderSheets([], []);
  const cost = roundTrips(sheet.stats) - before;
  assert.strictEqual(second, 0, 'the second push wrote nothing');
  assert.ok(cost <= 2, `an unchanged roster costs the refresh stamp and no more, was ${cost}`);
  assert.ok(callsNamed(sheet, 'setNote').length >= 1,
    'the banner still says when it was last looked at');

  // One more person: the fingerprint moves and the sheet is rewritten.
  const grown = rows.concat(rosterRows(1, 1));
  sandbox.__stubRowsByProgram(() => ({ 'chair yoga|ashbridge': grown }));
  const third = sandbox.pushProgramLeaderSheets([], []);
  assert.strictEqual(third, 1, 'a roster that moved is written out again');
  assert.notStrictEqual(sandbox.getProgramLeaderSheetRegistry()['chair yoga|ashbridge'].pushedFingerprint,
    entry.pushedFingerprint, 'and the fingerprint moved with it');

  // ...and the menu's own refresh ignores the fingerprint entirely, which is
  // the escape hatch for a sheet somebody has mangled by hand.
  const fourth = sandbox.pushProgramLeaderSheets([], [], { force: true });
  assert.strictEqual(fourth, 1, 'a forced push always writes');
}

// ---------------------------------------------------------------------------
// 4. THE FINGERPRINT IS STABLE ACROSS RUNS, AND MOVES WHEN THE HEADING DOES
// ---------------------------------------------------------------------------
{
  const rows = rosterRows(2, 2);
  const a = sandbox.computeLeaderSheetFingerprint({ title: 'Chair Yoga', location: 'Ashbridge' }, rows);
  const b = sandbox.computeLeaderSheetFingerprint({ title: 'Chair Yoga', location: 'Ashbridge' }, rows);
  assert.strictEqual(a, b, 'the same rows an hour later hash the same — the refresh stamp is NOT in it');

  const moved = sandbox.computeLeaderSheetFingerprint({ title: 'Chair Yoga', location: 'Narberth' }, rows);
  assert.notStrictEqual(a, moved, 'a program that moved building is a sheet whose banner has to change');

  const renamed = sandbox.computeLeaderSheetFingerprint({ title: 'Gentle Yoga', location: 'Ashbridge' }, rows);
  assert.notStrictEqual(a, renamed, 'and so is one that was renamed');
}

console.log('✅ leader_sheet_push.test.js passed');
