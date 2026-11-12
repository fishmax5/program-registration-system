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
this.PROGRAM_SETTINGS_LUNCH_GROUP = PROGRAM_SETTINGS_LUNCH_GROUP;
this.PROGRAM_SETTINGS_INACTIVE_GROUP = PROGRAM_SETTINGS_INACTIVE_GROUP;
this.NOTIFICATION_CHECKBOX_COLUMNS = NOTIFICATION_CHECKBOX_COLUMNS;
this.isSpecialEventProgram_ = isSpecialEventProgram_; this.builtInSpecialEventDefaults_ = builtInSpecialEventDefaults_;
this.PROGRAM_SETTINGS_SPECIAL_GROUP = PROGRAM_SETTINGS_SPECIAL_GROUP;
this.consolidateNotificationRow_ = consolidateNotificationRow_; this.consolidateKindDefaults_ = consolidateKindDefaults_;
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
check('every kind and the special-event group get a heading and a defaults row', g.defaultsOffsets.length, kinds.length + 1);
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


// --- lunch is its own group, and finished programs sink to the foot ---------
const mk = (title, last) => { const r = new Array(headers.length).fill(''); r[0] = title; r[map['Last_Date']] = last || ''; return r; };
const g2 = sandbox.groupProgramSettingsRows([
  { group: sandbox.PROGRAM_SETTINGS_INACTIVE_GROUP, row: mk('Old A', new Date(2026, 0, 5)) },
  { group: sandbox.PROGRAM_SETTINGS_INACTIVE_GROUP, row: mk('Old B', new Date(2026, 5, 5)) },
  { group: sandbox.PROGRAM_SETTINGS_LUNCH_GROUP, row: mk('Lunch') },
  { group: kind, row: mk('Chair Yoga') }
], headers);
const titles = g2.rows.map(r => r[0]).filter(t => t.indexOf('--- ') !== 0);
check('lunch follows the kinds; finished last, newest first', titles, ['Chair Yoga', 'Lunch', 'Old B', 'Old A']);

// --- special events: one date, not repeating -------------------------------
const SP = sandbox.PROGRAM_SETTINGS_SPECIAL_GROUP;
const prog1 = (over) => Object.assign({ dateKeys: {}, isLunch: false, isClub: false, noRegistration: false, isAssistance: false }, over);
const today = '2026-11-10', back = '2026-09-26';
const isSp = (p, k) => sandbox.isSpecialEventProgram_(p, k || 'MONTHLY', today, back);
check('one upcoming date is a special event', isSp(prog1({ dateKeys: { '2026-12-05': true } })), true);
check('two upcoming dates is not', isSp(prog1({ dateKeys: { '2026-12-05': true, '2026-12-12': true } })), false);
check('a series on its last date (earlier date inside the lookback) is not', isSp(prog1({ dateKeys: { '2026-11-03': true, '2026-12-01': true } })), false);
check('a date from last year does not stop an annual event', isSp(prog1({ dateKeys: { '2025-12-05': true, '2026-12-05': true } })), true);
check('a single date already passed is not', isSp(prog1({ dateKeys: { '2026-11-01': true } })), false);
check('club, appointments, drop-in and lunch are excluded',
  [prog1({ isClub: true }), prog1({ isAssistance: true }), prog1({ noRegistration: true }), prog1({ isLunch: true })]
    .map(p => isSp(Object.assign(p, { dateKeys: { '2026-12-05': true } }))), [false, false, false, false]);
const d = sandbox.builtInSpecialEventDefaults_();
check('born with the invite, a week before and a day before',
  [d.Add_Guest_To_Calendar, d.Week_Before, d.Day_Before, d.Morning_Of, d.Confirm_On_Booking], [true, true, true, false, false]);
const spGrid = [['banner'], headers.slice()].concat(sandbox.groupProgramSettingsRows([], headers, { [SP]: d }).rows);
const spRead = sandbox.readProgramSettingsTable_({ getLastRow: () => spGrid.length, getLastColumn: () => headers.length,
  getName: () => 'Program_Settings', getRange: () => ({ getValues: () => spGrid }) }, headers);
check('the special-event default round-trips through the tab', spRead.defaults[SP].Week_Before, true);

// --- the one-time consolidation (Nov 2026): one alert for assistance, none else
const ticked = () => { const r = new Array(headers.length).fill('');
  ['Add_Guest_To_Calendar', 'Week_Before', 'Day_Before', 'Morning_Of', 'Confirm_On_Booking'].forEach(h => { r[map[h]] = true; });
  r[map['Other_Reminders']] = '3'; return r; };
const ord = ticked();
check('an ordinary program row is cleared', sandbox.consolidateNotificationRow_(ord, map, false), true);
check('...every box and the day list', [sandbox.NOTIFICATION_CHECKBOX_COLUMNS.some(h => ord[map[h]] === true), ord[map['Other_Reminders']]], [false, '']);
const asst = ticked();
sandbox.consolidateNotificationRow_(asst, map, true);
check('an assistance row keeps Day_Before only',
  sandbox.NOTIFICATION_CHECKBOX_COLUMNS.filter(h => asst[map[h]] === true), ['Day_Before']);
check('an already-consolidated row reports no change', sandbox.consolidateNotificationRow_(asst, map, true), false);
const kd = { MONTHLY: { Week_Before: true, Other_Reminders: '3' }, APPOINTMENTS: { Week_Before: true }, SPECIAL: { Week_Before: true, Day_Before: true } };
sandbox.consolidateKindDefaults_(kd);
check('kind defaults are cleared, assistance gets Day_Before, special events are untouched',
  [kd.MONTHLY.Week_Before, kd.MONTHLY.Other_Reminders, kd.APPOINTMENTS.Week_Before, kd.APPOINTMENTS.Day_Before, kd.SPECIAL.Week_Before],
  [false, '', false, true, true]);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
