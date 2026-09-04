// TITLE_MATCH — how a program with no leader row finds a leader, and the line
// that must not move while it does.
//
// The feature is an attribution guess. The guard is that a guess writes a
// concrete, inspectable row and NOTHING else: no share, no email, no tick. So
// the test that matters most here is the last one — a leader carrying phrases
// and no typed program is on no mailing list and can read no roster, because
// buildProgramLeaderIndex() still refuses a row with a blank Program.
const vm = require('vm');

const src = require('./helpers/source').readSource();

let activeSpreadsheet = null;
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => activeSpreadsheet,
    getActive: () => activeSpreadsheet,
    newDataValidation: () => {
      const builder = {
        requireCheckbox: () => builder, requireValueInList: () => builder,
        setAllowInvalid: () => builder, build: () => ({})
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
;this.proposeProgramLeaderRowsFromTitles = proposeProgramLeaderRowsFromTitles;
this.parseLeaderTitleMatchPhrases = parseLeaderTitleMatchPhrases;
this.buildProgramLeaderIndex = buildProgramLeaderIndex;
this.invalidateProgramLeaderIndex = invalidateProgramLeaderIndex;
this.getProgramLeaderEmailsForProgram = getProgramLeaderEmailsForProgram;
this.getProgramLeadersWantingAlerts = getProgramLeadersWantingAlerts;
this.LEADER_TITLE_MATCH_MAX_PROGRAMS = LEADER_TITLE_MATCH_MAX_PROGRAMS;
this.PROGRAM_LEADERS_STAFF_COLUMNS = PROGRAM_LEADERS_STAFF_COLUMNS;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const headers = sandbox.HEADERS.Program_Leaders;
const map = sandbox.getIndexMap(headers);

check('Title_Match is a column on the tab', headers.indexOf('Title_Match') !== -1, true);
// A refresh that owned this column would wipe the phrases every hour.
check('...and one the refresh never overwrites',
  sandbox.PROGRAM_LEADERS_STAFF_COLUMNS.indexOf('Title_Match') !== -1, true);

function leaderRow(name, email, program, location, phrases) {
  const row = new Array(headers.length).fill('');
  row[map['Leader_Name']] = name;
  row[map['Email']] = email;
  row[map['Program']] = program || '';
  row[map['Location']] = location || '';
  row[map['Title_Match']] = phrases || '';
  return row;
}

function knownPrograms(pairs) {
  const known = {};
  pairs.forEach(pair => {
    known[`${pair[0].toLowerCase()}|${pair[1].toLowerCase()}`] = { title: pair[0], location: pair[1] };
  });
  return known;
}

function proposalsOf(result) {
  return result.rows.map(row =>
    [row[map['Leader_Name']], row[map['Program']], row[map['Location']]]);
}

// --- the cell ---------------------------------------------------------------

check('phrases split on commas only, so a two-word phrase survives',
  sandbox.parseLeaderTitleMatchPhrases(' Chair  Yoga , YOGA, ,yoga'),
  ['chair yoga', 'yoga']);

// --- precedence -------------------------------------------------------------

const known = knownPrograms([
  ['Chair Yoga', 'Narberth'], ['Gentle Yoga', 'Narberth'], ['Tai Chi', 'Ashbridge']
]);

const simple = sandbox.proposeProgramLeaderRowsFromTitles(
  [leaderRow('Jane', 'jane@x.com', '', '', 'yoga')], map, known);
check('a phrase proposes the programs whose titles contain it, and only those',
  proposalsOf(simple), [['Jane', 'Chair Yoga', 'Narberth'], ['Jane', 'Gentle Yoga', 'Narberth']]);
check('the proposal arrives with notifications OFF',
  simple.rows.map(r => r[map['Notify_Roster_Changes']]), [false, false]);
check('...and says which phrase found it',
  simple.rows[0][map['Staff_Notes']].indexOf('Matched on "yoga"'), 0);
check('...and does not carry the phrase onto the new row',
  simple.rows.map(r => r[map['Title_Match']]), ['', '']);

// Rule 1: a typed row is the answer, even when it names somebody else.
const typed = sandbox.proposeProgramLeaderRowsFromTitles([
  leaderRow('Jane', 'jane@x.com', '', '', 'yoga'),
  leaderRow('Ken', 'ken@x.com', 'Chair Yoga', 'Narberth', '')
], map, known);
check('a concrete row is never overridden by a phrase',
  proposalsOf(typed), [['Jane', 'Gentle Yoga', 'Narberth']]);

// Rule 2: the longest phrase wins.
const longest = sandbox.proposeProgramLeaderRowsFromTitles([
  leaderRow('Jane', 'jane@x.com', '', '', 'yoga'),
  leaderRow('Ken', 'ken@x.com', '', '', 'chair yoga')
], map, known);
check('the longest matching phrase wins',
  proposalsOf(longest), [['Ken', 'Chair Yoga', 'Narberth'], ['Jane', 'Gentle Yoga', 'Narberth']]);

// Rule 3: a tie proposes nothing and says so.
const tie = sandbox.proposeProgramLeaderRowsFromTitles([
  leaderRow('Jane', 'jane@x.com', '', '', 'yoga'),
  leaderRow('Ken', 'ken@x.com', '', '', 'yoga')
], map, known);
check('two leaders claiming the same phrase propose nothing', proposalsOf(tie), []);
check('...and both are named in the report',
  tie.reports.filter(line => line.indexOf('Jane and Ken') !== -1).length, 2);

// --- the two safeguards -----------------------------------------------------

const typo = sandbox.proposeProgramLeaderRowsFromTitles(
  [leaderRow('Jane', 'jane@x.com', '', '', 'yoge')], map, known);
check('a phrase that matches nothing proposes nothing', proposalsOf(typo), []);
check('...and gets a note on its own cell, because it is otherwise silent',
  typo.notes.map(n => n.note), ['No program title contains "yoge".']);

const many = [];
for (let i = 0; i < sandbox.LEADER_TITLE_MATCH_MAX_PROGRAMS + 1; i++) {
  many.push([`Class ${i}`, 'Narberth']);
}
const broad = sandbox.proposeProgramLeaderRowsFromTitles(
  [leaderRow('Jane', 'jane@x.com', '', '', 'class')], map, knownPrograms(many));
check('a phrase claiming the whole building is reported, not applied', proposalsOf(broad), []);
check('...on the cell and in the digest',
  [broad.notes.length, broad.reports.length], [1, 1]);

// --- the line that must not move --------------------------------------------
//
// A phrase row shares nothing and mails nothing. This is section 5's boundary:
// buildProgramLeaderIndex() is the ONE path from "who leads what" to "who may
// read a roster", and a phrase never enters it.

function leadersSheet(rows) {
  const grid = [new Array(headers.length).fill(''), headers].concat(rows);
  return {
    getName: () => sandbox.SHEET_NAMES.PROGRAM_LEADERS,
    getLastRow: () => grid.length,
    getLastColumn: () => headers.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => grid.slice(row - 1, row - 1 + (numRows || grid.length))
        .map(r => r.slice(col - 1, col - 1 + (numCols || headers.length))),
      getFormulas: () => new Array(numRows || 1).fill(0)
        .map(() => new Array(numCols || headers.length).fill(''))
    })
  };
}

activeSpreadsheet = {
  getSheetByName: name => (name === sandbox.SHEET_NAMES.PROGRAM_LEADERS
    ? leadersSheet([
      // Phrases and a ticked box, and NO program: the most dangerous row this
      // tab can hold, and it must resolve to nothing at all.
      (() => { const r = leaderRow('Jane', 'jane@x.com', '', '', 'yoga'); r[map['Notify_Roster_Changes']] = true; return r; })(),
      (() => { const r = leaderRow('Ken', 'ken@x.com', 'Tai Chi', 'Ashbridge', ''); r[map['Notify_Roster_Changes']] = true; return r; })()
    ])
    : null)
};
sandbox.invalidateProgramLeaderIndex();
check('a phrase-only row is in no program\'s index',
  Object.keys(sandbox.buildProgramLeaderIndex()), ['tai chi|ashbridge']);
check('...so it can share no roster',
  sandbox.getProgramLeaderEmailsForProgram('Chair Yoga', 'Narberth'), []);
check('...and is on no mailing list',
  sandbox.getProgramLeadersWantingAlerts().map(entry => entry.email), ['ken@x.com']);

console.log(failures === 0 ? '\nAll title-match tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
