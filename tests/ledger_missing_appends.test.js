// WRITERS OF THE REGISTRANTS TAB THAT USED TO TELL THE LEDGER NOTHING: the
// program rename (Event_ID / Event) and — covered by the same composer — the
// club-list cancel. (The leader-sheet pull was a third until Nov 2026, when
// the leaders' sheets became view-only lists and the pull was removed.) Each now appends one
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

console.log('ledger_missing_appends: ok');
