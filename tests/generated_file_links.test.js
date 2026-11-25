// LIVE LINKS TO THE FILES THIS SYSTEM PRODUCES.
//
// The two columns are DERIVED: a render recomputes them and overwrites, which
// is the whole safety property here — a link must never outlive the file it
// points at. What is pinned:
//
//   * the roster-sheet link is keyed by program AND building;
//   * a program never shared writes '' rather than a stale formula;
//   * the retired Sign_In_Sheet_Link column (sign-in sheets were cut in Nov
//     2026) is always written blank, so an old link cannot linger.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const iso = new Date(d).toISOString();
      return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
    },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.stampGeneratedFileLinks = stampGeneratedFileLinks;
this.leaderSheetLinkFormula = leaderSheetLinkFormula;
this.leaderProgramKey = leaderProgramKey;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.__setLeaderRegistry = function (r) { __leaderSheetRegistryCache = r; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const DAY = new Date('2026-03-04T15:00:00Z');

sandbox.__setLeaderRegistry({
  [sandbox.leaderProgramKey('Chair Yoga', 'Narberth')]: { fileId: 'sheet1', title: 'Chair Yoga' }
});

const pdMap = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
function sessionRow(values) {
  const row = new Array(sandbox.HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(values).forEach(k => { row[pdMap[k]] = values[k]; });
  return row;
}

const rows = [
  sessionRow({ Event_Date: DAY, Location: 'Narberth', Clean_Title: 'Chair Yoga' }),
  sessionRow({ Event_Date: DAY, Location: 'Bala Cynwyd', Clean_Title: 'Chair Yoga' }),
  // A sign-in link left over from before the sheets were retired.
  sessionRow({
    Event_Date: new Date('2026-03-05T15:00:00Z'), Location: 'Narberth', Clean_Title: 'Chair Yoga',
    Sign_In_Sheet_Link: '=HYPERLINK("https://drive/gone","📋 Sign-In Sheet")'
  })
];
sandbox.stampGeneratedFileLinks(rows, pdMap, { titleColumn: 'Clean_Title' });

check('the roster sheet for that program in that building lands on its session row',
  rows[0][pdMap['Registrant_Sheet_Link']],
  '=HYPERLINK("https://docs.google.com/spreadsheets/d/sheet1/edit","📋 Registrant Sheet")');
check('the same program in another building gets none',
  rows[1][pdMap['Registrant_Sheet_Link']], '');
check('a retired sign-in link is cleared',
  rows[2][pdMap['Sign_In_Sheet_Link']], '');

check('the lunch dashboard no longer carries a sign-in column',
  sandbox.getIndexMap(sandbox.HEADERS.Master_Lunch_Dashboard)['Sign_In_Sheet_Link'], undefined);

const regMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
const regRow = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
regRow[regMap['Event_Date']] = DAY;
regRow[regMap['Location']] = 'Narberth';
regRow[regMap['Event']] = 'Chair Yoga';
regRow[regMap['Sign_In_Sheet_Link']] = '=HYPERLINK("https://drive/old","x")';
sandbox.stampGeneratedFileLinks([regRow], regMap, { titleColumn: 'Event' });
check('a registrant row reaches the roster sheet by its Event column',
  regRow[regMap['Registrant_Sheet_Link']], rows[0][pdMap['Registrant_Sheet_Link']]);
check('and its retired sign-in cell is blank',
  regRow[regMap['Sign_In_Sheet_Link']], '');

const oldMap = { Event_Date: 0, Location: 1 };
const oldRow = [DAY, 'Narberth'];
sandbox.stampGeneratedFileLinks([oldRow], oldMap, { titleColumn: 'Clean_Title' });
check('an older layout is left exactly as it was', oldRow.length, 2);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
