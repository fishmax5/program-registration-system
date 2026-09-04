// THE PROGRAM_LEADERS TAB, and the migration that fills it.
//
// THE EXPENSIVE FAILURE this guards is a silent one. Who leads a program used
// to be Program_Options' Instructor_Email column; HEADERS.Program_Options no
// longer lists it, so the very next render of that tab writes it away. If the
// addresses have not been carried across by then, a year of somebody's
// maintenance is gone with nothing on screen to say so — the shared sheets
// keep working (they were shared already) and only the NEXT sheet created
// quietly goes to nobody.
//
// So: the migration reads a column the layout has already stopped describing,
// never overwrites a row somebody typed, never runs twice, and never turns
// notifications on for people who were never asked.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const properties = {};
// Swapped per-test, below — buildProgramLeaderIndex() reads the active
// spreadsheet directly, unlike getProgramLeadersWantingAlerts() elsewhere in
// this file, which is exercised through the __setLeaderIndex() seam instead.
let activeSpreadsheet = null;
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (properties[k] === undefined ? null : properties[k]),
      setProperty: (k, v) => { properties[k] = v; },
      setProperties: o => { Object.keys(o).forEach(k => { properties[k] = o[k]; }); },
      deleteProperty: k => { delete properties[k]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => activeSpreadsheet,
    getActive: () => activeSpreadsheet,
    newDataValidation: () => {
      const rule = {};
      const builder = {
        requireCheckbox: () => builder, requireValueInList: () => builder,
        setAllowInvalid: () => builder, build: () => rule
      };
      return builder;
    },
    WrapStrategy: { OVERFLOW: 'overflow', CLIP: 'clip' },
    ProtectionType: { RANGE: 'range' }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.migrateProgramLeaderAddresses = migrateProgramLeaderAddresses;
this.readLegacyInstructorEmails = readLegacyInstructorEmails;
this.getProgramLeaderEmailsForProgram = getProgramLeaderEmailsForProgram;
this.getProgramLeadersWantingAlerts = getProgramLeadersWantingAlerts;
this.invalidateProgramLeaderIndex = invalidateProgramLeaderIndex;
this.buildProgramLeaderIndex = buildProgramLeaderIndex;
this.parseLeaderNotifyTiming = parseLeaderNotifyTiming;
this.leaderNotifyTimingDaysBefore = leaderNotifyTimingDaysBefore;
this.leaderNotifyTimingMaxDays = leaderNotifyTimingMaxDays;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.PROGRAM_LEADERS_STAFF_COLUMNS = PROGRAM_LEADERS_STAFF_COLUMNS;
this.LEADER_NOTIFY_TIMING_LIST = LEADER_NOTIFY_TIMING_LIST;
this.LEADER_NOTIFY_TIMING_EACH_CHANGE = LEADER_NOTIFY_TIMING_EACH_CHANGE;
this.PROGRAM_LEADERS_MIGRATED_PROP_KEY = PROGRAM_LEADERS_MIGRATED_PROP_KEY;
this.__setLeaderIndex = function (rows) { __programLeaderIndexCache = rows; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const leaderHeaders = sandbox.HEADERS.Program_Leaders;
const leaderMap = sandbox.getIndexMap(leaderHeaders);

// ---------------------------------------------------------------------------
// Program_Options no longer has the column, so nothing may read it by header
// list. This is what the migration has to work around.
// ---------------------------------------------------------------------------

check('the address column is gone from the Program_Options layout',
  sandbox.HEADERS.Program_Options.indexOf('Instructor_Email'), -1);
check('Notify_Timing is a Program_Leaders column',
  leaderHeaders.indexOf('Notify_Timing') !== -1, true);
// A refresh that owned this column would wipe the setting every hour.
check('...and the refresh never overwrites it',
  sandbox.PROGRAM_LEADERS_STAFF_COLUMNS.indexOf('Notify_Timing') !== -1, true);
check('and the notes column on a registrant row is now the leader\'s',
  [sandbox.HEADERS.Registrant_Dash.indexOf('Instructor_Notes') === -1,
    sandbox.HEADERS.Registrant_Dash.indexOf('Leader_Notes') !== -1],
  [true, true]);

// ---------------------------------------------------------------------------
// Reading the old column off a sheet the layout has forgotten.
// ---------------------------------------------------------------------------

/**
 * A Program_Options tab as an OLDER version of this workbook left it: banner,
 * header row, data — with Instructor_Email still sitting in it.
 */
function legacyProgramOptionsSheet(dataRows) {
  const header = ['Event', 'Location', 'Type_Tag', 'Sessions_Tracked', 'Next_Date', 'Last_Date',
    'Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup', 'Instructor_Email', 'Staff_Notes'];
  const grid = [new Array(header.length).fill(''), header].concat(dataRows);
  return {
    getName: () => 'Program_Options',
    getLastRow: () => grid.length,
    getLastColumn: () => header.length,
    getRange: () => ({ getValues: () => grid })
  };
}

function optionRow(event, location, email) {
  const r = new Array(11).fill('');
  r[0] = event; r[1] = location; r[9] = email;
  return r;
}

const legacySheet = legacyProgramOptionsSheet([
  optionRow('Chair Yoga', 'Narberth', 'jane@x.com,助@x.com'),
  optionRow('Tai Chi', 'Ashbridge', 'ken@x.com; lee@x.com'),
  optionRow('Bridge Club', 'Narberth', ''),          // no address — nothing to carry
  optionRow('', '', 'orphan@x.com')                  // no program — nothing to carry it to
]);

const legacy = sandbox.readLegacyInstructorEmails({ getSheetByName: () => legacySheet });

check('every program with an address is found, and only those',
  Object.keys(legacy).sort(), ['chair yoga|narberth', 'tai chi|ashbridge']);
check('a semicolon-separated pair is two addresses',
  legacy['tai chi|ashbridge'].emails, ['ken@x.com', 'lee@x.com']);
check('a workbook that never had the column yields nothing rather than throwing',
  sandbox.readLegacyInstructorEmails({ getSheetByName: () => null }), {});

// ---------------------------------------------------------------------------
// The migration itself.
// ---------------------------------------------------------------------------

/** A Program_Leaders tab that records what was written to it. */
function fakeLeaderSheet(existingRows) {
  const state = { rows: existingRows.slice(), written: null };
  const grid = () => [new Array(leaderHeaders.length).fill(''), leaderHeaders].concat(state.rows);
  const sheet = {
    state,
    getName: () => 'Program_Leaders',
    getLastRow: () => grid().length,
    getLastColumn: () => leaderHeaders.length,
    getMaxRows: () => 100,
    getMaxColumns: () => leaderHeaders.length,
    getBandings: () => [],
    clear: () => {}, clearFormats: () => {},
    setRowHeight: () => {}, setFrozenRows: () => {}, setFrozenColumns: () => {},
    insertRowsAfter: () => {},
    autoResizeColumns: () => {}, setColumnWidth: () => {},
    hideColumns: () => {}, showColumns: () => {},
    getProtections: () => [],
    getRange: (row, col, numRows) => ({
      getValues: () => {
        const g = grid();
        if (numRows === 1 && row === 2) return [leaderHeaders];
        return g.slice(row - 1, row - 1 + (numRows || g.length));
      },
      getFormulas: () => new Array(numRows || 1).fill(0).map(() => new Array(leaderHeaders.length).fill('')),
      setValues: values => { state.written = values; return sheet.getRange(row, col, numRows); },
      setValue: () => sheet.getRange(row, col, numRows),
      setNote: () => sheet.getRange(row, col, numRows),
      setBackground: () => sheet.getRange(row, col, numRows),
      setBackgrounds: () => sheet.getRange(row, col, numRows),
      setFontSize: () => sheet.getRange(row, col, numRows),
      setFontWeight: () => sheet.getRange(row, col, numRows),
      setFontColor: () => sheet.getRange(row, col, numRows),
      setFontStyle: () => sheet.getRange(row, col, numRows),
      setVerticalAlignment: () => sheet.getRange(row, col, numRows),
      setHorizontalAlignment: () => sheet.getRange(row, col, numRows),
      setWrapStrategy: () => sheet.getRange(row, col, numRows),
      setNumberFormat: () => sheet.getRange(row, col, numRows),
      setDataValidation: () => sheet.getRange(row, col, numRows),
      clearDataValidations: () => sheet.getRange(row, col, numRows),
      breakApart: () => sheet.getRange(row, col, numRows),
      protect: () => ({ setDescription: () => ({ setWarningOnly: () => {} }) })
    })
  };
  return sheet;
}

const ss = { getSheetByName: name => (name === sandbox.SHEET_NAMES.PROGRAM_OPTIONS ? legacySheet : null) };

// A leader row somebody already typed for Chair Yoga, with a NAME on it — the
// thing the old column could never hold.
const typedRow = new Array(leaderHeaders.length).fill('');
typedRow[leaderMap['Leader_Name']] = 'Jane Doe';
typedRow[leaderMap['Email']] = 'jane.doe@x.com';
typedRow[leaderMap['Program']] = 'Chair Yoga';
typedRow[leaderMap['Location']] = 'Narberth';

const leaderSheet = fakeLeaderSheet([typedRow]);
const added = sandbox.migrateProgramLeaderAddresses(ss, leaderSheet);

check('only the programs with no leader row yet are carried across', added, 1);

const written = leaderSheet.state.written || [];
check('the row somebody typed is kept exactly as they typed it',
  written.filter(r => r[leaderMap['Program']] === 'Chair Yoga')
    .map(r => [r[leaderMap['Leader_Name']], r[leaderMap['Email']]]),
  [['Jane Doe', 'jane.doe@x.com']]);
check('and the carried-over program arrives with its addresses',
  written.filter(r => r[leaderMap['Program']] === 'Tai Chi')
    .map(r => [r[leaderMap['Email']], r[leaderMap['Location']]]),
  [['ken@x.com, lee@x.com', 'Ashbridge']]);
check('NOT ticked for notifications — nobody asked these people',
  written.filter(r => r[leaderMap['Program']] === 'Tai Chi')
    .map(r => r[leaderMap['Notify_Roster_Changes']]),
  [false]);

check('the migration records that it ran',
  typeof properties[sandbox.PROGRAM_LEADERS_MIGRATED_PROP_KEY], 'string');

// Running it again must not resurrect an address somebody has since deleted.
const secondSheet = fakeLeaderSheet([]);
check('and never runs twice, whatever the tab looks like the second time',
  sandbox.migrateProgramLeaderAddresses(ss, secondSheet), 0);

// ---------------------------------------------------------------------------
// Reading leaders back out.
// ---------------------------------------------------------------------------

sandbox.__setLeaderIndex({
  'chair yoga|narberth': [
    { name: 'Jane Doe', emails: ['jane@x.com'], notify: true, programTitle: 'Chair Yoga', programLocation: 'Narberth' },
    { name: 'Amy Lead', emails: ['amy@x.com', 'jane@x.com'], notify: false, programTitle: 'Chair Yoga', programLocation: 'Narberth' }
  ],
  'tai chi|narberth': [{ name: 'Jane Doe', emails: ['jane@x.com'], notify: true, programTitle: 'Tai Chi', programLocation: 'Narberth' }],
  'bridge|ashbridge': [{ name: 'Ken Ray', emails: [], notify: true, programTitle: 'Bridge', programLocation: 'Ashbridge' }]
});

check('a program with two leaders shares with both, and an address twice is once',
  sandbox.getProgramLeaderEmailsForProgram('Chair Yoga', 'Narberth'),
  ['jane@x.com', 'amy@x.com']);
check('a program nobody leads shares with nobody rather than failing',
  sandbox.getProgramLeaderEmailsForProgram('Nothing', 'Nowhere'), []);

const wanting = sandbox.getProgramLeadersWantingAlerts();
check('only leaders who ticked the box are written to',
  wanting.map(w => w.email), ['jane@x.com']);
check('and one leader gets ONE email covering all their programs',
  wanting[0].programs.map(p => p.key).sort(), ['chair yoga|narberth', 'tai chi|narberth']);
// The key is normalized so it can match; the email has to say "Chair Yoga",
// not "chair yoga", and a program with no shared sheet yet has nowhere else to
// read a title from.
check('...carrying the program title as somebody actually typed it',
  wanting[0].programs.map(p => `${p.title} (${p.location})`).sort(),
  ['Chair Yoga (Narberth)', 'Tai Chi (Narberth)']);
check('a leader who ticked the box but has no address is not a send',
  wanting.filter(w => w.email === '').length, 0);

// ---------------------------------------------------------------------------
// Notify_Timing: WHICH channel a ticked leader is on.
//
// THE FAILURE THIS PINS is the quiet one, and it is the same shape as an
// unrecognized Notify_Mode in section 9e: this column arrives on tabs that
// already have leaders ticked for alerts, so every one of those cells starts
// BLANK. Read strictly, a blank cell would put all of them on a channel
// nobody chose — or on none at all — and the first anybody would hear of it
// is a leader mentioning they have stopped getting emails.
// ---------------------------------------------------------------------------

const timing = sandbox.parseLeaderNotifyTiming;
const EACH = { mode: 'each_change', days: 0, weekday: -1 };

check('a blank cell keeps doing what a ticked box has always done', timing(''), EACH);
check('...and so does a cell nobody has typed into at all',
  [timing(null), timing(undefined)], [EACH, EACH]);
check('the dropdown\'s own default reads as the diff channel',
  timing(sandbox.LEADER_NOTIFY_TIMING_EACH_CHANGE), EACH);
check('a day count reads as the countdown channel',
  timing('3 days before each date'), { mode: 'days_before', days: 3, weekday: -1 });
check('one day is singular, and still a day count',
  timing('1 day before each date'), { mode: 'days_before', days: 1, weekday: -1 });
check('case and stray spacing are what somebody typed, not what they meant',
  timing('  2 DAYS BEFORE each date  '), { mode: 'days_before', days: 2, weekday: -1 });
// Out of range falls back rather than silencing: a leader who somehow ends up
// with "0 days" or "30 days" in the cell still hears from us.
check('a day count past the week this supports falls back to the diff channel',
  timing('8 days before each date'), EACH);
check('...and so does one that is not a countdown at all',
  [timing('0 days before each date'), timing('when I feel like it')], [EACH, EACH]);

// The weekday channel: the same digest, due on a fixed day of the week rather
// than a fixed count. The failure this pins is a Thursday class on a
// "Thursday before" row resolving to zero days — i.e. the morning of — rather
// than to the week before.
check('a weekday reads as the weekday channel',
  timing('The Thursday before each date'), { mode: 'weekday', days: 7, weekday: 4 });
check('...however it was spelled',
  timing('  thursday before  '), { mode: 'weekday', days: 7, weekday: 4 });
check('...and a weekday with no "before" is not a timing at all',
  timing('Thursday'), EACH);

const daysBefore = sandbox.leaderNotifyTimingDaysBefore;
const thursday = timing('The Thursday before each date');
check('a Tuesday session on a Thursday row is due five days ahead',
  daysBefore(thursday, new Date(2026, 8, 8)), 5);
check('a session ON that weekday is due the week before, never the morning of',
  daysBefore(thursday, new Date(2026, 8, 10)), 7);
check('a day count ignores the session date it is handed',
  daysBefore(timing('3 days before each date'), new Date(2026, 8, 8)), 3);
check('the diff channel is never due as a digest',
  daysBefore(EACH, new Date(2026, 8, 8)), 0);
check('a weekday row is scanned for out to the whole week',
  [sandbox.leaderNotifyTimingMaxDays(thursday),
   sandbox.leaderNotifyTimingMaxDays(timing('2 days before each date')),
   sandbox.leaderNotifyTimingMaxDays(EACH)],
  [7, 2, 0]);

check('the dropdown offers the diff channel, one entry per day count and one per weekday',
  sandbox.LEADER_NOTIFY_TIMING_LIST.length, 15);
check('...starting with the default',
  sandbox.LEADER_NOTIFY_TIMING_LIST[0], sandbox.LEADER_NOTIFY_TIMING_EACH_CHANGE);
check('...and every offered value parses back to what it says',
  sandbox.LEADER_NOTIFY_TIMING_LIST.slice(1, 8).map(label => timing(label).days),
  [1, 2, 3, 4, 5, 6, 7]);
check('...weekdays included',
  sandbox.LEADER_NOTIFY_TIMING_LIST.slice(8).map(label => timing(label).weekday),
  [0, 1, 2, 3, 4, 5, 6]);

// The column has to actually be READ off the tab, not just parse well.
const timedRow = new Array(leaderHeaders.length).fill('');
timedRow[leaderMap['Leader_Name']] = 'Cat Reed';
timedRow[leaderMap['Email']] = 'cat@x.com';
timedRow[leaderMap['Program']] = 'Bridge Club';
timedRow[leaderMap['Location']] = 'Narberth';
timedRow[leaderMap['Notify_Roster_Changes']] = true;
timedRow[leaderMap['Notify_Timing']] = '3 days before each date';

activeSpreadsheet = {
  getSheetByName: name =>
    (name === sandbox.SHEET_NAMES.PROGRAM_LEADERS ? fakeLeaderSheet([timedRow]) : null)
};
sandbox.invalidateProgramLeaderIndex();
const rebuilt = sandbox.buildProgramLeaderIndex();

check('the cell on the tab reaches the leader index',
  rebuilt['bridge club|narberth'][0].timing, { mode: 'days_before', days: 3, weekday: -1 });
// ...and out the other side, because 66 filters its two passes on it.
check('...and rides along to the pass that has to choose a channel',
  sandbox.getProgramLeadersWantingAlerts()[0].programs[0].timing,
  { mode: 'days_before', days: 3, weekday: -1 });

activeSpreadsheet = null;
sandbox.invalidateProgramLeaderIndex();

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
