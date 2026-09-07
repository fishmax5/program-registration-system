// PROGRAM_SETTINGS IS GROUPED BY WHAT KIND OF PROGRAM THE ROW IS ABOUT.
//
// The tab is a tab of decisions — who is emailed, how often, what room — and
// the decision depends entirely on the kind: a drop-in has no form to notify
// anybody through, an appointment program's confirmation is the only place its
// time can be said. Alphabetical order interleaved all six kinds, so this pins
// the grouping itself: the headings are the six kinds the rest of the system
// already uses, a group nobody is in is not drawn, and — the part that would
// quietly corrupt the tab if it broke — every reader skips a heading rather
// than reading it as a program with a blank everything.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d, tz, p) => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.EVENT_TYPES = EVENT_TYPES;
this.groupProgramSettingsRows = groupProgramSettingsRows;
this.programSettingsGroupOf = programSettingsGroupOf;
this.programSettingsGroupLabel = programSettingsGroupLabel;
this.PROGRAM_SETTINGS_INACTIVE_GROUP = PROGRAM_SETTINGS_INACTIVE_GROUP;
this.isMemoryTabDividerValue = isMemoryTabDividerValue;
this.memoryTabDividerRow = memoryTabDividerRow;
this.PROGRAM_FORM_TYPES = PROGRAM_FORM_TYPES;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + name); return; }
  failures++; console.log('FAIL ' + name + '\n     expected ' + e + '\n     actual   ' + a);
}
function checkTrue(name, value) { check(name, !!value, true); }

const headers = sandbox.HEADERS.Program_Settings;
const map = sandbox.getIndexMap(headers);
const rowFor = title => {
  const row = new Array(headers.length).fill('');
  row[map['Event']] = title;
  return row;
};

// ---------------------------------------------------------------------------
// A program's four controls decide its heading — the same resolution the
// review dialog and the calendar stamps use, not a seventh vocabulary.
// ---------------------------------------------------------------------------
const kindOf = program => sandbox.programSettingsGroupOf(program);
check('an ordinary monthly program', kindOf({ typeTag: sandbox.EVENT_TYPES.REGULAR }), 'MONTHLY');
check('a club is a club', kindOf({ typeTag: sandbox.EVENT_TYPES.REGULAR, isClub: true }), 'CLUB');
check('a series club is its own kind',
  kindOf({ typeTag: sandbox.EVENT_TYPES.GROUPED, isClub: true }), 'CLUB_SERIES');
check('appointments beat the type tag',
  kindOf({ typeTag: sandbox.EVENT_TYPES.GROUPED, isAssistance: true }), 'APPOINTMENTS');
check('no registration beats everything else',
  kindOf({ typeTag: sandbox.EVENT_TYPES.REGULAR, isClub: true, noRegistration: true }), 'DROP_IN');

// ---------------------------------------------------------------------------
// The tab itself: a heading per non-empty group, in the six kinds' own order,
// with the programs the calendar has stopped mentioning last.
// ---------------------------------------------------------------------------
const grouped = sandbox.groupProgramSettingsRows([
  { row: rowFor('Zumba'), group: 'MONTHLY' },
  { row: rowFor('Chair Yoga'), group: 'MONTHLY' },
  { row: rowFor('Medicare Counselling'), group: 'APPOINTMENTS' },
  { row: rowFor('Old Book Club'), group: sandbox.PROGRAM_SETTINGS_INACTIVE_GROUP }
], headers);

check('only the groups with something in them are drawn', grouped.dividerOffsets.length, 3);
check('the headings do not count as programs', grouped.programCount, 4);
check('rows come out heading-then-programs, in the kinds’ own order, sorted by title',
  grouped.rows.map(r => String(r[0])),
  [
    `--- ${sandbox.programSettingsGroupLabel('MONTHLY')} (2) ---`,
    'Chair Yoga',
    'Zumba',
    `--- ${sandbox.programSettingsGroupLabel('APPOINTMENTS')} (1) ---`,
    'Medicare Counselling',
    `--- ${sandbox.programSettingsGroupLabel(sandbox.PROGRAM_SETTINGS_INACTIVE_GROUP)} (1) ---`,
    'Old Book Club'
  ]);
check('and the offsets name the heading rows', grouped.dividerOffsets, [0, 3, 5]);

// THE ONE THAT MATTERS MOST: a heading must never be read back as a program.
// readSimpleTable() filters on exactly this, and a heading that slipped
// through would arrive as a row whose Event is punctuation and whose every
// notification tick is blank — which the refresh would then re-seed.
grouped.dividerOffsets.forEach(offset => {
  checkTrue('a heading row is recognized as a divider',
    sandbox.isMemoryTabDividerValue(grouped.rows[offset][0]));
});
checkTrue('...and a program is not', !sandbox.isMemoryTabDividerValue('Chair Yoga'));
checkTrue('...nor is a blank cell', !sandbox.isMemoryTabDividerValue(''));
checkTrue('Member_Roll’s own divider still reads as one',
  sandbox.isMemoryTabDividerValue('--- RETIRED --- (kept for their history, not offered at the door)'));

// A divider is as wide as the layout, so a setValues() of the block cannot
// throw on a short row.
check('a divider row is the full width of the tab',
  sandbox.memoryTabDividerRow(headers, 'Anything').length, headers.length);

// An unknown group is filed under the honest heading rather than dropped: a
// row that reached the tab is a row somebody's answers are on.
const stray = sandbox.groupProgramSettingsRows([{ row: rowFor('Mystery'), group: 'NOT_A_KIND' }], headers);
check('a group nothing recognizes is not a lost row',
  stray.rows.map(r => String(r[0])),
  [`--- ${sandbox.programSettingsGroupLabel(sandbox.PROGRAM_SETTINGS_INACTIVE_GROUP)} (1) ---`, 'Mystery']);

console.log(failures === 0 ? '\nAll program settings grouping checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
