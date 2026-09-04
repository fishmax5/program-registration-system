// LIVE LINKS TO THE FILES THIS SYSTEM PRODUCES.
//
// The two columns are DERIVED: a render recomputes them and overwrites, which
// is the whole safety property here — a link must never outlive the file it
// points at. What is pinned:
//
//   * the sign-in registry's key is date x location, so one printed sheet is
//     found by every tab that has a row for that day and building;
//   * a day with no PDF (or a program never shared) writes '' rather than a
//     stale formula left over from the last render;
//   * the filename a printed sheet is saved under parses back into the date
//     and location the backfill has to recover from it.
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
this.signInSheetKey = signInSheetKey;
this.signInSheetLinkFormula = signInSheetLinkFormula;
this.leaderSheetLinkFormula = leaderSheetLinkFormula;
this.leaderProgramKey = leaderProgramKey;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.SIGN_IN_SHEET_FILENAME_RE = SIGN_IN_SHEET_FILENAME_RE;
this.SIGN_IN_SHEET_LINK_LABEL = SIGN_IN_SHEET_LINK_LABEL;
this.__setSignInRegistry = function (r) { __signInSheetRegistryCache = r; };
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

sandbox.__setSignInRegistry({
  [sandbox.signInSheetKey('2026-03-04', 'Narberth')]: { fileId: 'pdf1', url: 'https://drive/pdf1' }
});
sandbox.__setLeaderRegistry({
  [sandbox.leaderProgramKey('Chair Yoga', 'Narberth')]: { fileId: 'sheet1', title: 'Chair Yoga' }
});

// ---------------------------------------------------------------------------
// The session table: both links, keyed off the row's own program and day.
// ---------------------------------------------------------------------------
const pdMap = sandbox.getIndexMap(sandbox.HEADERS.Master_Program_Dashboard);
function sessionRow(values) {
  const row = new Array(sandbox.HEADERS.Master_Program_Dashboard.length).fill('');
  Object.keys(values).forEach(k => { row[pdMap[k]] = values[k]; });
  return row;
}

const rows = [
  sessionRow({ Event_Date: DAY, Location: 'Narberth', Clean_Title: 'Chair Yoga' }),
  // Same program, the other building: a different leader sheet (there is none)
  // and no printed sheet that day.
  sessionRow({ Event_Date: DAY, Location: 'Bala Cynwyd', Clean_Title: 'Chair Yoga' }),
  // A stale formula from a render before the PDF was deleted — must be cleared.
  sessionRow({
    Event_Date: new Date('2026-03-05T15:00:00Z'), Location: 'Narberth', Clean_Title: 'Chair Yoga',
    Sign_In_Sheet_Link: '=HYPERLINK("https://drive/gone","🖨️ Sign-In PDF")'
  })
];
sandbox.stampGeneratedFileLinks(rows, pdMap, { titleColumn: 'Clean_Title' });

// Read off the constant rather than spelled out: the LABEL is presentation and
// has changed once already (the file became a live Doc); what is pinned here is
// that the row gets a formula pointing at THAT day's file.
check('the day\'s sign-in sheet lands on its session row',
  rows[0][pdMap['Sign_In_Sheet_Link']],
  `=HYPERLINK("https://drive/pdf1","${sandbox.SIGN_IN_SHEET_LINK_LABEL}")`);
check('and so does the leader sheet for that program in that building',
  rows[0][pdMap['Registrant_Sheet_Link']],
  '=HYPERLINK("https://docs.google.com/spreadsheets/d/sheet1/edit","📋 Registrant Sheet")');
check('the same program in another building gets neither',
  [rows[1][pdMap['Sign_In_Sheet_Link']], rows[1][pdMap['Registrant_Sheet_Link']]], ['', '']);
check('a link to a file that is gone is cleared, not left standing',
  rows[2][pdMap['Sign_In_Sheet_Link']], '');

// ---------------------------------------------------------------------------
// The lunch dashboard: the same printed sheet, no leader.
// ---------------------------------------------------------------------------
const lunchMap = sandbox.getIndexMap(sandbox.HEADERS.Master_Lunch_Dashboard);
const lunchRow = new Array(sandbox.HEADERS.Master_Lunch_Dashboard.length).fill('');
lunchRow[lunchMap['Event_Date']] = DAY;
lunchRow[lunchMap['Location']] = 'Narberth';
sandbox.stampGeneratedFileLinks([lunchRow], lunchMap, {});
check('the meal row points at the same PDF the session row does',
  lunchRow[lunchMap['Sign_In_Sheet_Link']], rows[0][pdMap['Sign_In_Sheet_Link']]);
check('and carries no leader sheet column at all',
  lunchMap['Registrant_Sheet_Link'], undefined);

// ---------------------------------------------------------------------------
// Registrants: one row per person, each pointing at their own session's files.
// ---------------------------------------------------------------------------
const regMap = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
const regRow = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
regRow[regMap['Event_Date']] = DAY;
regRow[regMap['Location']] = 'Narberth';
regRow[regMap['Event']] = 'Chair Yoga';
sandbox.stampGeneratedFileLinks([regRow], regMap, { titleColumn: 'Event' });
check('a registrant row reaches the leader sheet by its Event column',
  regRow[regMap['Registrant_Sheet_Link']], rows[0][pdMap['Registrant_Sheet_Link']]);

// ---------------------------------------------------------------------------
// A tab written before these columns existed has no index for them, and the
// stamp must do nothing rather than write off the end of the row.
// ---------------------------------------------------------------------------
const oldMap = { Event_Date: 0, Location: 1 };
const oldRow = [DAY, 'Narberth'];
sandbox.stampGeneratedFileLinks([oldRow], oldMap, { titleColumn: 'Clean_Title' });
check('an older layout is left exactly as it was', oldRow.length, 2);

// ---------------------------------------------------------------------------
// The backfill reads the date and location back out of the filename the
// printed sheet was saved under. If these two ever disagree, a workbook full
// of PDFs shows an empty column.
// ---------------------------------------------------------------------------
const parsed = sandbox.SIGN_IN_SHEET_FILENAME_RE.exec('Sign-In 2026-03-04 Bala Cynwyd.pdf');
check('the filename parses back into its date and location',
  [parsed[1], parsed[2]], ['2026-03-04', 'Bala Cynwyd']);
check('a renamed file is skipped rather than half-read',
  sandbox.SIGN_IN_SHEET_FILENAME_RE.exec('Monday printout.pdf'), null);

// ---------------------------------------------------------------------------
// The key is date AND location — never one without the other.
// ---------------------------------------------------------------------------
check('the sign-in key normalizes the location, not the date',
  sandbox.signInSheetKey('2026-03-04', '  NARBERTH '), '2026-03-04|narberth');
check('a day with no printed sheet asks for nothing',
  sandbox.signInSheetLinkFormula('', 'Narberth'), '');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
