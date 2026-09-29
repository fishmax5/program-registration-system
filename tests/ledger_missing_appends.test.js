// THREE WRITERS OF THE REGISTRANTS TAB THAT USED TO TELL THE LEDGER NOTHING:
// the leader-sheet pull (ticks), the program rename (Event_ID / Event) and —
// covered by the same composer — the club-list cancel. Each now appends one
// entry per row it changed, composed before the row moves.
const vm = require('vm');
const assert = require('assert');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), getUuid: () => 'u', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'x' }), getActiveUser: () => ({ getEmail: () => 'x' }) }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
vm.runInContext(`
  var __entries = [];
  appendLedgerEntry = function (e) { __entries.push(e); return 1; };
  ledgerIdForRegistrantRow = function (row, map) { return 'REG-' + row[map['Name']]; };
  log = function () {};
  noteForAdmin = function () {};
  var __map = getIndexMap(HEADERS.All_Registrants);
  function __row(o) {
    const r = new Array(HEADERS.All_Registrants.length).fill('');
    Object.keys(o).forEach(k => { r[__map[k]] = o[k]; });
    return r;
  }
`, sandbox);

// --- rename: a corrected entry naming the new session, resolved from the old id
const renameResult = vm.runInContext(`
  const rows = [__row({ Name: 'Joan', Event_ID: 'OLD', Event: 'Yoga', Party_ID: 'P1' }),
                __row({ Name: 'Other', Event_ID: 'ELSE', Event: 'Bingo' })];
  getSectionedRows = () => rows;
  renderRegistrantsSheet = () => {};
  buildTitleByOldId = () => ({ OLD: 'Chair Yoga' });
  __entries.length = 0;
  renameRegistrantRows({ getSheetByName: () => ({}) }, [], { OLD: 'NEW' });
  ({ entries: __entries.slice(), event: rows[0][__map['Event']], id: rows[0][__map['Event_ID']] });
`, sandbox);
assert.strictEqual(renameResult.entries.length, 1, 'only the renamed row is recorded');
const re = renameResult.entries[0];
assert.strictEqual(re.kind, 'corrected');
assert.strictEqual(re.registrationId, 'REG-Joan');
assert.strictEqual(re.eventId, 'NEW');
assert.strictEqual(re.source, 'migration');
assert.deepStrictEqual(JSON.parse(JSON.stringify(re.payload)), { Event_ID: 'NEW', Event: 'Chair Yoga' });
assert.strictEqual(renameResult.id, 'NEW');

// --- leader pull: one corrected per row, only the ticks that moved
const pull = vm.runInContext(`
  const row = __row({ Name: 'Joan', Event_ID: 'E1', Party_ID: 'P1', Contacted: false });
  const untouched = __row({ Name: 'Sam', Event_ID: 'E1', Party_ID: 'P2' });
  const key = leaderRowKey('E1', 'P1', 'Joan');
  getProgramLeaderSheetRegistry = () => ({ prog: { fileId: 'f', title: 'Yoga' } });
  openSpreadsheetCached = () => ({ getSheetByName: () => ({}) });
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const sheetRow = []; sheetRow[sheetMap['Row_Key']] = key; sheetRow[sheetMap['Pushed_Snapshot']] = 'snap';
  readSimpleTable = () => [sheetRow];
  decodeLeaderSnapshot = () => LEADER_OWNED_COLUMNS.map(() => false);
  readLeaderValues = () => LEADER_OWNED_COLUMNS.map(n => n === 'Contacted');
  __entries.length = 0;
  const applied = pullProgramLeaderSheetEdits([row, untouched]);
  ({ applied, entries: __entries.slice() });
`, sandbox);
assert.strictEqual(pull.applied, 1);
assert.strictEqual(pull.entries.length, 1, 'the untouched row is not recorded');
assert.strictEqual(pull.entries[0].source, 'leader-sheet');
assert.strictEqual(pull.entries[0].registrationId, 'REG-Joan');
assert.deepStrictEqual(JSON.parse(JSON.stringify(pull.entries[0].payload)), { Contacted: true });

console.log('ledger_missing_appends: ok');
