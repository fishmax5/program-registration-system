// The Program_Questions Program column: how a typed title is matched against
// the calendar's, what happens to those rows when a program is renamed, and
// the report for the ones that match nothing. Offline; stubs just enough of
// the Apps Script globals.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console,
  Utilities: {
    formatDate: d => d.toISOString(),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' }, sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: {}, ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {},
  Calendar: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }) }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.MEMORY_TAB_DATA_ROW = MEMORY_TAB_DATA_ROW;
this.SHEET_NAMES = SHEET_NAMES;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- the key itself --------------------------------------------------------
const key = sandbox.programTitleMatchKey;
check('case and spacing wear off', key('  Book Club '), key('bookclub'));
check('punctuation wears off', key("Bob's Class!"), key('Bobs Class'));
check('a bracket tag wears off', key('[Club] Mah Jongg'), key('Mah Jongg'));
check('accents wear off', key('Café Français'), key('Cafe Francais'));
check('blank and "*" are both the empty key', [key(''), key('*'), key('   ')], ['', '', '']);
// THE LINE THIS MUST NOT CROSS: two different programs stay two.
check('a qualified title is NOT the same program',
  key('Chair Yoga (Beginner)') === key('Chair Yoga'), false);

// --- matching a question to a form ----------------------------------------
const H = sandbox.HEADERS.Program_Questions;
const qrow = o => H.map(h => (o[h] === undefined ? '' : o[h]));
const specsFor = rows => sandbox.buildProgramQuestionSpecs(rows);

const typo = specsFor([qrow({ Program: 'bookclub ', Question: 'Which book?', Type: 'Short answer' })]);
check('a spelling apart from the calendar still matches',
  sandbox.questionsForFormContext(typo, { titles: ['Book Club'], locations: ['Narberth'] }).length, 1);
check('and a different program still gets none of it',
  sandbox.questionsForFormContext(typo, { titles: ['Chair Yoga'], locations: ['Narberth'] }).length, 0);
check('a qualified title is not matched loosely',
  sandbox.questionsForFormContext(
    specsFor([qrow({ Program: 'Chair Yoga', Question: 'Waiver', Type: 'Short answer' })]),
    { titles: ['Chair Yoga (Beginner)'], locations: ['Narberth'] }).length, 0);
check('"*" still reaches every form',
  sandbox.questionsForFormContext(
    specsFor([qrow({ Program: '*', Location: '*', Question: 'Zip Code', Type: 'Short answer' })]),
    { titles: ['Anything'], locations: ['Zoom'] }).length, 1);
check('a location typed loosely still narrows',
  sandbox.questionsForFormContext(
    specsFor([qrow({ Location: 'narberth', Question: 'Zip Code', Type: 'Short answer' })]),
    { titles: ['Book Club'], locations: ['Ashbridge'] }).length, 0);

// --- the report ------------------------------------------------------------
const live = ['Book Club', 'Chair Yoga (Beginner)', 'Low-Cost Wills'];
const rows = [
  qrow({ Program: 'Book Club', Question: 'Which book?' }),
  qrow({ Program: '*', Question: 'Zip Code' }),
  qrow({ Program: '', Question: 'Anything else?' }),
  qrow({ Program: 'Chair Yoga', Question: 'Waiver' }),
  qrow({ Program: 'Knitting Circle', Question: 'Own needles?' }),
  qrow({ Question: '' })
];
const found = sandbox.findUnmatchedProgramQuestionRows(rows, live);
check('only the rows naming a program nothing answers to are reported',
  found.unmatched.map(u => u.program), ['Chair Yoga', 'Knitting Circle']);
check('the tab row number is what a person is given',
  found.unmatched[0].sheetRow, sandbox.MEMORY_TAB_DATA_ROW + 3);
check('a near miss is SUGGESTED', found.unmatched[0].suggestions, ['Chair Yoga (Beginner)']);
check('an unrelated title is offered nothing', found.unmatched[1].suggestions, []);
check('a blank row is not a row', found.checked, rows.length);

const clean = sandbox.findUnmatchedProgramQuestionRows(
  [qrow({ Program: 'Book Club', Question: 'Which book?' })], live);
check('a clean tab reports nothing to fix', clean.unmatched.length, 0);
check('and says so', /Nothing to fix/.test(sandbox.describeUnmatchedProgramQuestions(clean)), true);
check('no programs yet is a different answer from nothing to fix',
  /Run a calendar sync first/.test(
    sandbox.describeUnmatchedProgramQuestions(sandbox.findUnmatchedProgramQuestionRows(rows, []))), true);
const report = sandbox.describeUnmatchedProgramQuestions(found);
check('the report changes nothing and says that too',
  /NOTHING WAS CHANGED/.test(report) && /Did you mean: "Chair Yoga \(Beginner\)"/.test(report), true);

// --- a rename is carried onto the rows -------------------------------------
const renameRows = [
  qrow({ Program: 'bookclub', Question: 'Which book?' }),
  qrow({ Program: '*', Question: 'Zip Code' }),
  qrow({ Program: 'Low-Cost Wills', Question: 'Which document?' })
];
let written = null;
sandbox.readProgramQuestionRows = () => renameRows;
sandbox.renderProgramQuestionsSheet = r => { written = r; };
sandbox.renameProgramQuestionRows(
  { getSheetByName: () => ({}) },
  [{ oldTitle: 'Book Club', newTitle: 'Tuesday Book Club' }]);
const pMap = sandbox.getIndexMap(H);
check('the renamed program is carried across, loose spelling and all',
  written.map(r => r[pMap['Program']]), ['Tuesday Book Club', '*', 'Low-Cost Wills']);

written = null;
sandbox.renameProgramQuestionRows(
  { getSheetByName: () => ({}) }, [{ oldTitle: 'Nothing Here', newTitle: 'Still Nothing' }]);
check('a rename that touches no row does not rewrite the tab', written, null);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
