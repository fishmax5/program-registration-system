// THE RUN LOG (section 99zzb).
//
//   EVERY log() LINE REACHES THE TAB, IN BATCHES. Nothing is written per line;
//   a flush writes the buffer in one setValues() past the last row.
//
//   A LINE THAT LOOKS LIKE A FORMULA IS STORED AS TEXT.
//
//   A RUN KEEPS A BOUNDED NUMBER OF LINES and says how many it dropped, and
//   the tab trims its oldest rows once it is past its cap plus the slack.
//
//   NOTHING HERE THROWS: a workbook that refuses the write keeps the lines for
//   the next flush, and log() goes on working.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
  }
}

// --- a sheet that records what was written ----------------------------------
function makeSheet(name) {
  const sheet = {
    name,
    rows: [],          // row 1 is the header once written
    setValuesCalls: 0,
    hidden: false,
    getLastRow: () => sheet.rows.length,
    getRange: (row, col, numRows, numCols) => ({
      setValues: values => {
        sheet.setValuesCalls++;
        values.forEach((v, i) => { sheet.rows[row - 1 + i] = v.slice(); });
        return { setFontWeight: () => {} };
      }
    }),
    setFrozenRows: () => {},
    hideSheet: () => { sheet.hidden = true; },
    deleteRows: (start, count) => { sheet.rows.splice(start - 1, count); }
  };
  return sheet;
}

let workbook = { sheets: {}, refuse: false };
const spreadsheet = {
  getSheetByName: name => {
    if (workbook.refuse) throw new Error('Service Spreadsheets failed');
    return workbook.sheets[name] || null;
  },
  insertSheet: name => { workbook.sheets[name] = makeSheet(name); return workbook.sheets[name]; },
  getSpreadsheetTimeZone: () => 'America/New_York'
};

let uuidN = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: { getUuid: () => `abcdef12-${++uuidN}`, sleep: () => {}, formatDate: d => d.toISOString() },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getActive: () => spreadsheet, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => '' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, MimeType: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.SHEET_NAMES = SHEET_NAMES;
this.HEADERS = HEADERS;
this.SYSTEM_TAB_NAMES = SYSTEM_TAB_NAMES;
this.log = log;
this.flushRunLog = flushRunLog;
this.runLogLevel_ = runLogLevel_;
this.runLogMessageCell_ = runLogMessageCell_;
this.RUN_LOG_MAX_ROWS = RUN_LOG_MAX_ROWS;
this.RUN_LOG_TRIM_SLACK = RUN_LOG_TRIM_SLACK;
this.RUN_LOG_MAX_LINES_PER_RUN = RUN_LOG_MAX_LINES_PER_RUN;
this.RUN_LOG_MAX_INFO_LINES_PER_RUN = RUN_LOG_MAX_INFO_LINES_PER_RUN;
this.resetRunLog = function () { __runLogState = undefined; };
`, sandbox);

const tab = () => workbook.sheets[sandbox.SHEET_NAMES.RUN_LOG];
const dataRows = () => (tab() ? tab().rows.slice(1) : []);

console.log('the tab and its shape');
check('the tab is named Run_Log', sandbox.SHEET_NAMES.RUN_LOG, 'Run_Log');
check('its columns', sandbox.HEADERS.Run_Log, ['Logged_At', 'Run_ID', 'Run', 'Level', 'Message']);
check('it is a system tab (hidden and warning-protected by 99zp)',
  sandbox.SYSTEM_TAB_NAMES.indexOf('Run_Log') !== -1, true);

console.log('lines are buffered, then written in one batch');
sandbox.resetRunLog();
sandbox.log('Sync started');
sandbox.log('⚠️ Form row matches no session');
check('nothing is written per line', tab(), undefined);
// The tab's own "Created missing tab" line, logged mid-flush, rides the same batch.
check('a flush writes both lines, and the creation line', sandbox.flushRunLog(), 3);
check('the tab was created with its header', tab().rows[0], sandbox.HEADERS.Run_Log);
check('and hidden', tab().hidden, true);
check('in one setValues for the rows (plus the header)', tab().setValuesCalls, 2);
check('levels are read off the line', dataRows().map(r => r[3]), ['INFO', 'WARN', 'INFO']);
check('the message is the line', dataRows().map(r => r[4]),
  ['Sync started', '⚠️ Form row matches no session', 'Created missing tab: Run_Log']);
check('the run id is the execution id, shortened', dataRows()[0][1], 'abcdef12');
check('a second flush with nothing pending writes nothing', sandbox.flushRunLog(), 0);

console.log('an error line is written at once');
sandbox.log('❌ syncRegistrations threw: TypeError: x is undefined');
check('no flush call needed', dataRows().length, 4);
check('as an ERROR', dataRows()[3][3], 'ERROR');

console.log('a line that looks like a formula stays text');
check('= is quoted', sandbox.runLogMessageCell_('=IMPORTXML("x")'), `'=IMPORTXML("x")`);
check('- is quoted', sandbox.runLogMessageCell_('-3 rows'), `'-3 rows`);
check('plain text is not', sandbox.runLogMessageCell_('3 rows'), '3 rows');
check('a long line is capped',
  sandbox.runLogMessageCell_('x'.repeat(5000)).length <= 2000, true);

console.log('a run keeps a bounded number of lines');
workbook = { sheets: {}, refuse: false };
sandbox.resetRunLog();
for (let i = 0; i < sandbox.RUN_LOG_MAX_INFO_LINES_PER_RUN + 50; i++) sandbox.log(`info ${i}`);
for (let i = 0; i < 10; i++) sandbox.log(`⚠️ warning ${i}`);
sandbox.flushRunLog();
const rows = dataRows();
check('info lines stop at their cap', rows.filter(r => r[3] === 'INFO' && /^info /.test(r[4])).length,
  sandbox.RUN_LOG_MAX_INFO_LINES_PER_RUN);
check('warnings past the info cap are still kept', rows.filter(r => r[3] === 'WARN').length, 10);
check('and the run says how many it dropped', /50 more line\(s\)/.test(rows[rows.length - 1][4]), true);

console.log('the tab trims its oldest rows');
workbook = { sheets: {}, refuse: false };
sandbox.resetRunLog();
sandbox.log('first');
sandbox.flushRunLog();
const sheet = tab();
const filler = sandbox.RUN_LOG_MAX_ROWS + sandbox.RUN_LOG_TRIM_SLACK;
for (let i = 0; i < filler; i++) sheet.rows.push([new Date(), 'old', '', 'INFO', `old ${i}`]);
sandbox.log('newest');
sandbox.flushRunLog();
check('back to the cap', dataRows().length, sandbox.RUN_LOG_MAX_ROWS);
check('the header survives', tab().rows[0], sandbox.HEADERS.Run_Log);
check('the newest line is last', dataRows()[dataRows().length - 1][4], 'newest');

console.log('nothing throws, and a refused write is kept for later');
workbook = { sheets: {}, refuse: true };
sandbox.resetRunLog();
let threw = false;
try {
  sandbox.log('while the workbook refuses');
  check('a refused flush writes nothing', sandbox.flushRunLog(), 0);
} catch (err) { threw = true; }
check('log() and flushRunLog() did not throw', threw, false);
workbook.refuse = false;
check('the next flush writes the kept line (and the creation line)', sandbox.flushRunLog(), 2);
check('it is the line logged while refused', dataRows()[0][4], 'while the workbook refuses');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
