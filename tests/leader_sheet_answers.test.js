// THE PROGRAM'S OWN QUESTIONS, ON THE LEADER'S SHEET (section 46).
//
// A Program_Questions question ("What was your computer issue?") is asked FOR
// the program leader, and its answer is stored on All_Registrants as one
// Form_Answers string. Pinned here:
//
//   IT REACHES THE SHEET, one question per line, in an Answers column that is
//   LAST — after every column the sheet already had, so the leader-owned ticks
//   the pull reads back by header keep the positions they always had.
//
//   A ROW WITH NO ANSWERS IS BLANK, not an error.
//
//   IT IS IN THE FINGERPRINT, so an answer that changes redraws the sheet.
//
//   A SHEET WRITTEN BEFORE THE COLUMN still reads back: the ticks are found by
//   header, and the missing Answers column projects to blank.
const vm = require('vm');
const crypto = require('crypto');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
      return pattern === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: (alg, raw) => Array.from(crypto.createHash('md5').update(raw).digest()),
    DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildLeaderSheetRowsByProgram = buildLeaderSheetRowsByProgram;
this.computeLeaderSheetFingerprint = computeLeaderSheetFingerprint;
this.leaderSheetAnswersText = leaderSheetAnswersText;
this.leaderProgramKey = leaderProgramKey;
this.readSimpleTable = readSimpleTable;
this.HEADERS = HEADERS;
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.LEADER_SHEET_DERIVED_COLUMNS = LEADER_SHEET_DERIVED_COLUMNS;
this.LEADER_OWNED_COLUMNS = LEADER_OWNED_COLUMNS;
this.MEMORY_TAB_HEADER_ROW = MEMORY_TAB_HEADER_ROW;
this.MEMORY_TAB_DATA_ROW = MEMORY_TAB_DATA_ROW;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

const {
  buildLeaderSheetRowsByProgram, computeLeaderSheetFingerprint, leaderSheetAnswersText,
  leaderProgramKey, readSimpleTable, HEADERS, LEADER_SHEET_HEADERS,
  LEADER_SHEET_DERIVED_COLUMNS, LEADER_OWNED_COLUMNS, getIndexMap
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
const regMap = getIndexMap(HEADERS.All_Registrants);
const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);

const soon = new Date();
soon.setDate(soon.getDate() + 4);

function sessionRow(fields) {
  const row = new Array(HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(fields).forEach(key => { row[sessionMap[key]] = fields[key]; });
  return row;
}
function registrantRow(fields) {
  const row = new Array(HEADERS.All_Registrants.length).fill('');
  Object.keys(fields).forEach(key => { row[regMap[key]] = fields[key]; });
  return row;
}

// --- The column's place -----------------------------------------------------
const OLD_HEADERS = [
  'Event_Date', 'Event_Time', 'Location', 'Name', 'Party_Size',
  'Phone', 'Email', 'Program_Status',
  'Contacted', 'Confirmed', 'Waitlisted', 'Dropped', 'Leader_Notes',
  'Row_Key', 'Pushed_Snapshot'
];
check('Answers is appended after every column the sheet already had',
  Array.from(LEADER_SHEET_HEADERS), OLD_HEADERS.concat(['Answers']));
check('Answers is sync-owned, never a leader-owned column',
  [LEADER_SHEET_DERIVED_COLUMNS.indexOf('Answers') !== -1, LEADER_OWNED_COLUMNS.indexOf('Answers')],
  [true, -1]);

// --- The text ---------------------------------------------------------------
check('one question per line',
  leaderSheetAnswersText('What was your computer issue?: Printer | Device: iPad'),
  'What was your computer issue?: Printer\nDevice: iPad');
check('no answers is blank', leaderSheetAnswersText(''), '');

// --- Onto the sheet ---------------------------------------------------------
const sessions = [sessionRow({
  Event_ID: 'TECH', Event_Date: soon, Clean_Title: 'Computer Tech Support', Location: 'Narberth'
})];
const tech = leaderProgramKey('Computer Tech Support', 'Narberth');
function rowsFor(answers) {
  return buildLeaderSheetRowsByProgram(sessions, [
    registrantRow({
      Event_ID: 'TECH', Event_Date: soon, Location: 'Narberth', Name: 'Donna Inners',
      Program_Status: 'Active', Form_Answers: answers
    }),
    registrantRow({
      Event_ID: 'TECH', Event_Date: soon, Location: 'Narberth', Name: 'Arnold Feldman',
      Program_Status: 'Active'
    })
  ])[tech];
}
const rows = rowsFor('What was your computer issue?: Printer will not print');
check('each registrant carries their own answers, and a row with none is blank',
  rows.map(r => [r[sheetMap['Name']], r[sheetMap['Answers']]]),
  [['Arnold Feldman', ''], ['Donna Inners', 'What was your computer issue?: Printer will not print']]);

const entry = { title: 'Computer Tech Support', location: 'Narberth' };
check('a changed answer changes the fingerprint',
  computeLeaderSheetFingerprint(entry, rows) ===
    computeLeaderSheetFingerprint(entry, rowsFor('What was your computer issue?: Email')),
  false);

// --- A sheet written before the column still reads back by header -----------
const oldRow = OLD_HEADERS.map(h => ({ Name: 'Donna Inners', Dropped: true, Leader_Notes: 'called' })[h] || '');
oldRow[0] = soon;
const grid = [['banner'], OLD_HEADERS, oldRow];
const oldSheet = {
  getLastRow: () => grid.length,
  getLastColumn: () => OLD_HEADERS.length,
  getName: () => 'Sign_Up_Sheet',
  getRange: (r, c, nr, nc) => ({
    getValues: () => grid.slice(r - 1, r - 1 + (nr || 1))
      .map(row => { const out = row.slice(c - 1, c - 1 + (nc || 1)); while (out.length < (nc || 1)) out.push(''); return out; }),
    getFormulas: () => new Array(nr || 1).fill(0).map(() => new Array(nc || 1).fill(''))
  })
};
const readBack = readSimpleTable(oldSheet, LEADER_SHEET_HEADERS)[0];
check('the leader\'s ticks on an old-shape sheet are found by header, Answers reads blank',
  [readBack[sheetMap['Name']], readBack[sheetMap['Dropped']], readBack[sheetMap['Leader_Notes']], readBack[sheetMap['Answers']]],
  ['Donna Inners', true, 'called', '']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall leader sheet answers checks passed');
