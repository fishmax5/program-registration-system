// PROGRAM_SETTINGS NEW-EVENT DEFAULTS.
//
// A green row under each kind's heading holds what a program of that kind is
// born with. This pins the three things that make it safe: every ordinary
// reader skips it (it is not a program), it round-trips through the one grid
// read that carries it across a redraw, and it SEEDS a new row without ever
// being applied to one that exists.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS; this.getIndexMap = getIndexMap;
this.groupProgramSettingsRows = groupProgramSettingsRows;
this.programSettingsDefaultsRow = programSettingsDefaultsRow;
this.isMemoryTabDividerValue = isMemoryTabDividerValue;
this.isProgramSettingsDefaultsValue = isProgramSettingsDefaultsValue;
this.readProgramSettingsTable_ = readProgramSettingsTable_;
this.seedNotificationHalf = seedNotificationHalf;
this.PROGRAM_FORM_TYPES = PROGRAM_FORM_TYPES;
this.NOTIFICATION_CHECKBOX_COLUMNS = NOTIFICATION_CHECKBOX_COLUMNS;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + name); return; }
  failures++; console.log('FAIL ' + name + '\n     expected ' + e + '\n     actual   ' + a);
}

const headers = sandbox.HEADERS.Program_Settings;
const map = sandbox.getIndexMap(headers);
const kinds = sandbox.PROGRAM_FORM_TYPES.map(t => t.key);
const kind = kinds[0];

// --- the row is skipped like a heading ---------------------------------------
const defRow = sandbox.programSettingsDefaultsRow(headers, kind, { Day_Before: true, Other_Reminders: '3' });
check('a defaults row reads as a divider to every ordinary reader', sandbox.isMemoryTabDividerValue(defRow[0]), true);
check('and is recognised as a defaults row', sandbox.isProgramSettingsDefaultsValue(defRow[0]), true);
check('the kind key rides in Type_Tag', defRow[map['Type_Tag']], kind);
check('ticks are written as booleans', [defRow[map['Day_Before']], defRow[map['Week_Before']]], [true, false]);

// --- grouping: every kind drawn, defaults after the heading -------------------
const prog = new Array(headers.length).fill(''); prog[0] = 'Chair Yoga';
const g = sandbox.groupProgramSettingsRows([{ group: kind, row: prog }], headers, { [kind]: { Day_Before: true } });
check('every kind gets a heading and a defaults row', g.defaultsOffsets.length, kinds.length);
check('heading, then defaults, then programs', [g.rows[0][0].indexOf('--- ') === 0,
  sandbox.isProgramSettingsDefaultsValue(g.rows[1][0]), g.rows[2][0]], [true, true, 'Chair Yoga']);
check('only programs are counted', g.programCount, 1);
const bare = sandbox.groupProgramSettingsRows([{ group: kind, row: prog }], headers);
check('without defaults the old shape is unchanged', [bare.rows.length, bare.defaultsOffsets.length], [2, 0]);

// --- round trip through the one grid read ------------------------------------
const grid = [['banner'], headers.slice()].concat(g.rows);
const fake = { getLastRow: () => grid.length, getLastColumn: () => headers.length, getName: () => 'Program_Settings',
  getRange: () => ({ getValues: () => grid }) };
const read = sandbox.readProgramSettingsTable_(fake, headers);
check('the program survives and no heading or defaults row is a program', read.rows.map(r => r[0]), ['Chair Yoga']);
check('the default survives the redraw', read.defaults[kind].Day_Before, true);
check('a kind never set reads clear', read.defaults[kinds[1]].Day_Before, false);

// --- seeding: born with the default, nothing else is touched -----------------
const born = new Array(headers.length).fill('');
const how = sandbox.seedNotificationHalf(born, map, 'k|l', {}, {}, false, null, read.defaults[kind]);
check('a new row takes its kind default', [how, born[map['Day_Before']], born[map['Week_Before']]], ['kind-default', true, false]);
const plain = new Array(headers.length).fill('');
check('no default means the old built-in', sandbox.seedNotificationHalf(plain, map, 'k|l', {}, {}, false, null, null), 'default');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
