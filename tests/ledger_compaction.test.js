// LEDGER GROWTH AND COMPACTION (section 99za).
//
//   REDUNDANT MEANS "CHANGES NOTHING WHERE THE REPLAY MEETS IT". The every-sync
//   `corrected` flood is redundant; a second cancellation is; anything after a
//   registration dies is. A correction that moves a column is not, however
//   often it appears — that is a writer bug, and the report names it instead.
//
//   A MERGED REGISTRATION IS NEVER TOUCHED, on either side.
//
//   THE WRITE IS LOSSLESS AND CHECKED: every registration folds identically
//   with and without the dropped entries, the dropped rows are archived before
//   the tab is written, and a tab that grew while it was being checked is not
//   written at all.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const created = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      // Day-level, as formatDateLabel is in Apps Script: two folds a millisecond
      // apart must stamp the same Admin_Notes.
      return d.toISOString().slice(0, 10);
    },
    getUuid: () => `uuid-${++uuidN}`,
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  MimeType: { CSV: 'text/csv' },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.LEDGER_KINDS = LEDGER_KINDS;
this.LEDGER_SOURCES = LEDGER_SOURCES;
this.makeLedgerEntry = makeLedgerEntry;
this.ledgerEntryToRow = ledgerEntryToRow;
this.ledgerRowToEntry = ledgerRowToEntry;
this.analyzeLedgerRedundancy = analyzeLedgerRedundancy;
this.compareLedgerFolds_ = compareLedgerFolds_;
this.summarizeLedgerGrowth = summarizeLedgerGrowth;
this.describeLedgerGrowth = describeLedgerGrowth;
this.foldRegistrationLedger = foldRegistrationLedger;
this.compactRegistrationLedger = compactRegistrationLedger;
this.setupCompaction = function (sheet, folder, confirm) {
  registrationLedgerSheet = function () { return sheet; };
  requireAuthorizedAdmin = function () { return true; };
  workbookLock = function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; };
  confirmConsequentialAction = function () { return confirm; };
  getOrCreateSystemFolder = function () { return folder; };
  spoolOfficeNote = function () {};
  toastIfPossible = function () {};
  explainRefusal = function (msg) { this.lastRefusal = msg; }.bind(this);
};
`, sandbox, { filename: 'program.gs' });

const { HEADERS, LEDGER_KINDS: K, LEDGER_SOURCES: S, makeLedgerEntry, ledgerEntryToRow, ledgerRowToEntry,
  analyzeLedgerRedundancy, compareLedgerFolds_, summarizeLedgerGrowth, describeLedgerGrowth,
  compactRegistrationLedger, setupCompaction } = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const NOW = new Date();
const hoursAgo = h => new Date(NOW.getTime() - h * 3600000);
let t = 400;
const next = () => hoursAgo(t--);

function entry(kind, id, extra) {
  const e = makeLedgerEntry(Object.assign({
    kind: kind, source: S.IMPORT, registrationId: id,
    eventId: 'cal|Chair Yoga|2026-10-06', name: `Person ${id}`, personType: 'Registrant'
  }, extra || {}));
  e.entryAt = next();
  // Through a row and back, so the test sees exactly what the tab would hold.
  return ledgerRowToEntry(ledgerEntryToRow(e), HEADERS.Registration_Ledger);
}
const P = { Program_Status: 'Active', Lunch_Type: 'Hot', Meals_Ordered: 1, Location: 'Narberth' };

// --- A: the every-sync flood ----------------------------------------------
const a = [entry(K.REGISTERED, 'A', { payload: P })];
for (let i = 0; i < 5; i++) a.push(entry(K.CORRECTED, 'A', { source: S.ALL_DATES, payload: P }));
a.push(entry(K.CORRECTED, 'A', { source: S.ALL_DATES, payload: Object.assign({}, P, { Meals_Ordered: 2 }) }));
a.push(entry(K.CORRECTED, 'A', { source: S.ALL_DATES, payload: Object.assign({}, P, { Meals_Ordered: 2 }) }));

// --- B: cancelled twice, then a stray correction on a dead registration ----
const b = [
  entry(K.REGISTERED, 'B', { payload: P }),
  entry(K.CANCELLED, 'B', { source: S.QUICK_MARK, note: 'rang in' }),
  entry(K.CANCELLED, 'B', { source: S.QUICK_MARK, note: 'rang in again' })
];
const c = [
  entry(K.REGISTERED, 'C', { payload: P }),
  entry(K.SUPERSEDED, 'C', { payload: { by: 'A' } }),
  entry(K.CORRECTED, 'C', { payload: { Meals_Ordered: 3 } })
];

// --- D/E: merged — never touched, even the identical correction ------------
const d = [
  entry(K.REGISTERED, 'D', { payload: P }),
  entry(K.CORRECTED, 'D', { payload: P }),
  entry(K.REGISTERED, 'E', { payload: P, name: 'Person D' }),
  entry(K.MERGED, 'D', { source: S.DEDUPE, payload: { absorbed: 'E' } })
];

// --- F: a column flipping back and forth every sync (not redundant; churn) --
const f = [entry(K.REGISTERED, 'F', { payload: P })];
for (let i = 0; i < 6; i++) {
  f.push(entry(K.CORRECTED, 'F', {
    source: S.CLUB, payload: { Lunch_Type: i % 2 ? 'Hot' : 'Cold' },
    note: 'The same response was re-read and changed: Lunch_Type.'
  }));
}

const all = [].concat(a, b, c, d, f);
const analysis = analyzeLedgerRedundancy(all);
const redundant = all.filter(e => analysis.redundant.has(e));

check('the flood: five identical corrections and the repeated Meals change are redundant',
  a.filter(e => analysis.redundant.has(e)).length, 6);
check('the first real change is kept', analysis.redundant.has(a[6]), false);
check('the second cancellation is redundant, the first is not',
  [analysis.redundant.has(b[1]), analysis.redundant.has(b[2])], [false, true]);
check('an entry after a supersession is redundant', analysis.redundant.has(c[2]), true);
check('the supersession itself is kept', analysis.redundant.has(c[1]), false);
check('merged registrations are not examined at all', d.filter(e => analysis.redundant.has(e)).length, 0);
check('a flipping column is not redundant', f.filter(e => analysis.redundant.has(e)).length, 0);
check('the first entry of a registration is never redundant', [a[0], b[0], c[0], f[0]].some(e => analysis.redundant.has(e)), false);

const reparse = list => list.map(e => ledgerRowToEntry(ledgerEntryToRow(e), HEADERS.Registration_Ledger));
check('the replay is identical without the redundant entries',
  compareLedgerFolds_(reparse(all), reparse(all.filter(e => !analysis.redundant.has(e)))), '');
check('and the check notices when it is not (dropping a real change)',
  compareLedgerFolds_(reparse(all), reparse(all.filter(e => e !== a[6] && e !== a[7]))) !== '', true);

// --- the report ----------------------------------------------------------
// Put the flood in the last day, so it reads as STILL growing.
[a[4], a[5], f[5], f[6], f[4], f[3]].forEach((e, i) => { e.entryAt = hoursAgo(3 + i); });
const reAnalysis = analyzeLedgerRedundancy(all);
const summary = summarizeLedgerGrowth(all, reAnalysis, NOW);
check('recent redundant entries are counted', summary.recentRedundant >= 2, true);
check('the flipping registration is named as churning', summary.churning.map(r => r.id), ['F']);
check('with the column that flips', Object.keys(summary.churning[0].columns), ['Lunch_Type']);
const words = describeLedgerGrowth(summary, reAnalysis);
check('the report answers the question first', /^YES — still growing needlessly/.test(words[0]), true);
check('and names the writer', words.some(l => /corrected \/ all-dates/.test(l)), true);

const quiet = summarizeLedgerGrowth(all, { redundant: new Set(), reasons: new Map(), skipped: 0 },
  new Date(NOW.getTime() + 30 * 86400000));
check('a quiet ledger says NO', /^NO/.test(describeLedgerGrowth(quiet, { skipped: 0 })[0]), true);

// --- the compaction, end to end ------------------------------------------
function fakeSheet(entries, opts) {
  const o = opts || {};
  const values = [HEADERS.Registration_Ledger.slice()].concat(entries.map(e => ledgerEntryToRow(e)));
  if (o.blankRow) values.push(new Array(HEADERS.Registration_Ledger.length).fill(''));
  const sheet = {
    values: values, deleted: null, written: null,
    getDataRange: () => ({ getValues: () => sheet.values.map(r => r.slice()) }),
    getLastRow: () => sheet.values.length + (o.growBy || 0),
    getRange: (r, col, n, w) => ({ setValues: v => { sheet.written = { r: r, n: n, v: v }; } }),
    deleteRows: (at, n) => { sheet.deleted = { at: at, n: n }; }
  };
  return sheet;
}
const folder = { createFile: (name, csv) => { created.push({ name: name, csv: csv }); } };

let sheet = fakeSheet(all, { blankRow: true });
setupCompaction(sheet, folder, true);
const removed = compactRegistrationLedger();
check('compaction removes exactly the redundant entries', removed, reAnalysis.redundant.size);
check('the removed rows are archived first, one CSV line each plus the header',
  created.length === 1 ? created[0].csv.split('\n').length : -1, reAnalysis.redundant.size + 1);
const kept = all.length - reAnalysis.redundant.size;
check('one write over the whole old range', [sheet.written.r, sheet.written.n], [2, all.length + 1]);
check('the kept rows first, in their order',
  sheet.written.v.slice(0, kept).map(r => r[0]), all.filter(e => !reAnalysis.redundant.has(e)).map(e => e.entryId));
check('then blanks', sheet.written.v.slice(kept).every(r => r.every(x => x === '')), true);
check('and the emptied rows deleted', sheet.deleted, { at: kept + 2, n: all.length + 1 - kept });

created.length = 0;
sheet = fakeSheet(all, { growBy: 1 });
setupCompaction(sheet, folder, true);
check('a tab that grew while being checked is not written', [compactRegistrationLedger(), sheet.written], [0, null]);

created.length = 0;
sheet = fakeSheet(all);
setupCompaction(sheet, folder, false);
check('declining the confirmation writes and archives nothing',
  [compactRegistrationLedger(), sheet.written, created.length], [0, null, 0]);

sheet = fakeSheet(all);
setupCompaction(sheet, { createFile: () => { throw new Error('quota'); } }, true);
check('an archive that cannot be written stops the compaction', [compactRegistrationLedger(), sheet.written], [0, null]);
check('and the refusal says why', /quota/.test(sandbox.lastRefusal), true);

created.length = 0;
sheet = fakeSheet(all);
setupCompaction(sheet, folder, true);
vm.runInContext('ledgerArchivePartMaxChars_ = function () { return 1; };', sandbox); // every row its own part
check('an archive too big for one file is split into parts, each with the header',
  [compactRegistrationLedger() > 0, created.length, created.every(c => c.csv.split('\n').length === 2),
    /part 1 of /.test(created[0].name)],
  [true, reAnalysis.redundant.size, true, true]);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall ledger compaction checks passed');
