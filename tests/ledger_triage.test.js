// THE LEDGER TRIAGE REPORT (section 99zz). Read-only: sorts the verifier's
// buckets by date, kind, last Source and column, and judges future-dated
// "in the ledger, not on the tab" rows against the 3am snapshots.
// Pinned here: its bucket SIZES equal verifyLedgerAgainstTab()'s on the same
// input (so the two cannot drift), nothing is written, and an unread side or
// an uncovered snapshot is "unknown", never a clean bill of health.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
    getUuid: () => `uuid-${++uuidN}`, sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS; this.getIndexMap = getIndexMap; this.LEDGER_KINDS = LEDGER_KINDS;
this.LEDGER_SOURCES = LEDGER_SOURCES; this.makeLedgerEntry = makeLedgerEntry;
this.verifyLedgerAgainstTab = verifyLedgerAgainstTab;
this.analyzeLedgerDivergence_ = analyzeLedgerDivergence_;
this.describeLedgerTriage = describeLedgerTriage;
this.readRegistrantSnapshots_ = readRegistrantSnapshots_;
this.judgeAgainstSnapshots_ = judgeAgainstSnapshots_;
this.parseSnapshotCsv_ = parseSnapshotCsv_;
this.setSides = function (entries, rows) {
  readLedgerEntries = function () { return entries; };
  getSectionedRows = function () { return rows; };
  SpreadsheetApp.getActiveSpreadsheet = function () { return { getSheetByName: function () { return {}; } }; };
};
`, sandbox, { filename: 'program.gs' });
const S = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const MAP = S.getIndexMap(S.HEADERS.All_Registrants);
function tabRow(f) {
  const row = new Array(S.HEADERS.All_Registrants.length).fill('');
  row[MAP['Program_Status']] = 'Active'; row[MAP['Lunch_Status']] = 'No Lunch'; row[MAP['Person_Type']] = 'Registrant';
  Object.keys(f).forEach(h => { row[MAP[h]] = f[h]; });
  return row;
}
const entry = (id, kind, source, f) => S.makeLedgerEntry(Object.assign({
  kind, source, registrationId: id, eventId: 'ev', name: 'N', personType: 'Registrant',
  entryAt: new Date(2026, 9, 1), payload: {}
}, f));
const reg = (id, f) => entry(id, S.LEDGER_KINDS.REGISTERED, S.LEDGER_SOURCES.IMPORT, Object.assign({
  payload: { Event: 'Chair Yoga', Location: 'Ashbridge', Event_Date: f.date, Program_Status: 'Active', Lunch_Status: 'No Lunch' }
}, f));

const TODAY = '2026-11-10';
// ledger-only: a past form row, a future form row, a future club row, a lunch-only future row
const entries = [
  reg('r1', { eventId: 'e-past', name: 'Past Pat', date: '2026-09-02' }),
  reg('r2', { eventId: 'e-fut', name: 'Future Fran', date: '2026-11-12' }),
  entry('r3', S.LEDGER_KINDS.REGISTERED, S.LEDGER_SOURCES.CLUB, { eventId: 'e-club', name: 'Club Cal', payload: { Event: 'Art Club', Location: 'Ashbridge', Event_Date: '2026-11-19' } }),
  entry('r4', S.LEDGER_KINDS.REGISTERED, S.LEDGER_SOURCES.DOOR, { eventId: 'LUNCHONLY:2026-11-11|Narberth', name: 'Lunch Lou', payload: { Event: 'Lunch', Location: 'Narberth', Event_Date: '2026-11-11' } }),
  // on both, disagreeing: cancelled on the tab, ledger last wrote via import
  reg('r5', { eventId: 'e-both', name: 'Both Bea', date: '2026-11-20' })
];
const rows = [
  tabRow({ Name: 'Both Bea', Event_ID: 'e-both', Event: 'Chair Yoga', Location: 'Ashbridge', Event_Date: new Date(2026, 10, 20), Program_Status: 'Cancelled' }),
  tabRow({ Name: 'Tab Tom', Event_ID: 'e-tab', Event: 'Tai Chi', Location: 'Ashbridge', Event_Date: new Date(2026, 10, 25), Form_Source: 'Form response' })
];

const a = S.analyzeLedgerDivergence_(entries, rows, TODAY);
check('four ledger-only', a.missingFromTab.length, 4);
check('one tab-only', a.missingFromFold.length, 1);
check('one disagreeing', a.disagreeing.length, 1);
check('past/future split',
  a.missingFromTab.map(f => `${f.name}:${f.when}`).sort(),
  ['Club Cal:future', 'Future Fran:future', 'Lunch Lou:future', 'Past Pat:past']);
check('kinds', a.missingFromTab.map(f => f.origin).sort(), ['club / standing list', 'form', 'form', 'lunch-only']);
check('last source read off the ledger', a.missingFromTab.find(f => f.name === 'Lunch Lou').lastSource, 'door');
check('tab-only row says it has no ledger entry', a.missingFromFold[0].lastSource, '(no ledger entry)');
check('tab-only row classified by Form_Source', a.missingFromFold[0].origin, 'form');
check('disagreement names the column and both values',
  a.disagreeing[0].columns.map(c => `${c.column}:${c.tab}/${c.ledger}`), ['Program_Status:Cancelled/Active']);

// sizes agree with the verifier
S.setSides(entries, rows);
const v = S.verifyLedgerAgainstTab();
check('bucket sizes equal the verifier\'s',
  [a.missingFromTab.length, a.missingFromFold.length, a.disagreeing.length],
  [v.missingFromTab.length, v.missingFromFold.length, v.disagreeing.length]);

// snapshots
const csv = (header, lines) => [header].concat(lines).map(l => l.map(c => `"${c}"`).join(',')).join('\n');
const H = ['Event_Date', 'Name', 'Person_Type', 'Program_Status', 'Event_ID'];
check('quoted csv with comma and quote',
  JSON.stringify(S.parseSnapshotCsv_('"a, b","say ""hi"""\n"c","d"\n')), JSON.stringify([['a, b', 'say "hi"'], ['c', 'd']]));
const files = [
  { name: 'All_Registrants 2026-11-08_0300 (snapshot).csv', body: csv(H, [['x', 'Future Fran', 'Registrant', 'Active', 'e-fut']]) },
  { name: 'All_Registrants 2026-11-09_0300 (snapshot).csv', body: csv(H, [['x', 'Someone Else', 'Registrant', 'Active', 'e-zzz']]) },
  { name: 'not a snapshot.txt', body: '' }
];
const fut = a.missingFromTab.filter(f => f.when === 'future');
const read = S.readRegistrantSnapshots_(fut.map(f => f.key), () => files, f => f.body);
check('only snapshots by name are opened', read.read, 2);
S.judgeAgainstSnapshots_(fut, read);
const verdict = n => fut.find(f => f.name === n).verdict;
check('seen in a snapshot, gone now = lost', verdict('Future Fran'), 'lost-from-tab');
check('covered by snapshots, never in one = never on the tab', verdict('Club Cal'), 'never-on-tab');
check('which snapshot saw her last', fut.find(f => f.name === 'Future Fran').lastSeen, '2026-11-08_0300');
// a registration recorded AFTER the newest snapshot is not covered by it
const lateEntry = [reg('r9', { eventId: 'e-late', name: 'Late Lee', date: '2026-11-15', entryAt: new Date(2026, 10, 10) })];
const late = S.analyzeLedgerDivergence_(lateEntry, [], TODAY).missingFromTab;
S.judgeAgainstSnapshots_(late, S.readRegistrantSnapshots_(late.map(f => f.key), () => files, f => f.body));
check('registered after every snapshot = unknown, not clean', late[0].verdict, 'unknown');
check('an unlistable folder is said, not hidden',
  S.readRegistrantSnapshots_([], () => { throw new Error('no folder'); }, () => '').skipped.length, 1);

// text
const text = S.describeLedgerTriage({ ok: true, skipped: [], analysis: a, snapshotRead: read, futureMissing: fut });
check('report names the lost row', /Future Fran[\s\S]*2026-11-08_0300/.test(text), true);
check('report says it restored nothing', /nothing was written, restored or changed/.test(text), true);
check('report offers restore, does not do it', /did not restore them/.test(text), true);
check('an unreadable side is never a clean bill of health',
  /Nothing was looked at/.test(S.describeLedgerTriage({ ok: false, skipped: ['the ledger could not be read (x)'] })), true);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll ledger triage checks passed.');
