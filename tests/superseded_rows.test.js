// SUPERSEDED ROWS ARE BOOKKEEPING, AND NOBODY READS THEM.
//
// A resubmission still marks the row it replaces rather than overwriting it —
// that is what gives the seat back and what keeps the next submission finding
// ONE current row instead of a pile. What is pinned here is the other half:
// the marked row is not written back onto All_Registrants, so the tab every
// other reader in this project reads (the door, the desk, the sign-in sheet,
// the dashboards) cannot show a person twice.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d, tz, p) => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.isSupersededRegistrantRow = isSupersededRegistrantRow;
this.dropSupersededRegistrantRows = dropSupersededRegistrantRows;
this.supersedeRegistrantRow = supersedeRegistrantRow;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + name); return; }
  failures++; console.log('FAIL ' + name + '\n     expected ' + e + '\n     actual   ' + a);
}

const headers = sandbox.HEADERS.All_Registrants;
const map = sandbox.getIndexMap(headers);
function rowWith(values) {
  const row = new Array(headers.length).fill('');
  Object.keys(values).forEach(h => { row[map[h]] = values[h]; });
  return row;
}

check('a superseded row is recognized',
  sandbox.isSupersededRegistrantRow(rowWith({ Program_Status: 'Superseded' }), map), true);
check('...whatever whitespace it was written with',
  sandbox.isSupersededRegistrantRow(rowWith({ Program_Status: ' Superseded ' }), map), true);
['Active', 'Waitlisted', 'Cancelled', ''].forEach(status => {
  check(`a ${status || 'blank'} row is not superseded`,
    sandbox.isSupersededRegistrantRow(rowWith({ Program_Status: status }), map), false);
});

// A cancellation is NOT a supersession: somebody who cancelled is a fact the
// desk needs to see, and only the resubmission's leftover row goes.
const rows = [
  rowWith({ Name: 'Bob Smith', Program_Status: 'Superseded' }),
  rowWith({ Name: 'Bob Smith', Program_Status: 'Active' }),
  rowWith({ Name: 'Ruth Cohen', Program_Status: 'Cancelled' }),
  rowWith({ Name: 'Marion Levy', Program_Status: 'Waitlisted' })
];
check('only the superseded row is dropped',
  sandbox.dropSupersededRegistrantRows(rows, headers).map(r => r[map['Name']] + '/' + r[map['Program_Status']]),
  ['Bob Smith/Active', 'Ruth Cohen/Cancelled', 'Marion Levy/Waitlisted']);
check('an empty tab is still an empty tab', sandbox.dropSupersededRegistrantRows(null, headers), []);

// The mark itself is unchanged — the seat is given back by the caller, and the
// row it leaves is what the filter above then drops.
const marked = rowWith({ Name: 'Bob Smith', Program_Status: 'Active', Lunch_Status: 'Needed' });
sandbox.supersedeRegistrantRow(marked, map, new Date('2026-09-06T12:00:00Z'));
check('a superseded row still says so in both status columns',
  [marked[map['Program_Status']], marked[map['Lunch_Status']]], ['Superseded', 'Superseded']);
check('...and is what the render then drops',
  sandbox.dropSupersededRegistrantRows([marked], headers).length, 0);

console.log(failures === 0 ? '\nAll superseded-row checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
