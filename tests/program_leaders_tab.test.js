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
    getActiveSpreadsheet: () => null,
    getActive: () => null,
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
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
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

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
