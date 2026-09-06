// REMOVING REGISTRANTS ONE ROW AT A TIME.
//
// THE FAILURE THIS FILE GUARDS is not "the row did not go" — it is "the row
// went and came back". Three paths rebuild registrant rows from standing state
// (the import, the all-dates catch-up, the club catch-up), and the only thing
// that stops them is a tombstone recorded BEFORE the tab is redrawn. A sweep
// that deletes first and tombstones after — or that tombstones the rows it is
// keeping — reads as working and is undone by the next hourly sync.
//
// The rules pinned here:
//
//   1. Only rows whose Manual_Override is exactly the remove mark are swept;
//      Manually Edited and Manually Added are records, not requests.
//   2. Every doomed row is tombstoned, and no kept row is.
//   3. The tab is redrawn with the KEPT rows, and the counts are recomputed
//      from those same rows.
//   4. The mark is protected from the import, because a mark an hourly sync
//      can reset to Auto-Synced disappears between marking and sweeping.
//   5. The confirmation names who is about to go, and says the form responses
//      are staying.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, fmt) => {
      const d = new Date(date);
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toDateString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'desk@example.org' })
  },
  ScriptApp: {}, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.collectMarkedRegistrantRemovals = collectMarkedRegistrantRemovals;
this.describeMarkedRegistrantRemovals = describeMarkedRegistrantRemovals;
this.removeMarkedRegistrantsInternal = removeMarkedRegistrantsInternal;
this.getProtectedRegistrantKeys = getProtectedRegistrantKeys;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.REGISTRANT_REMOVE_OVERRIDE_OPTION = REGISTRANT_REMOVE_OVERRIDE_OPTION;
this.REGISTRANT_MANUAL_OVERRIDE_OPTIONS = REGISTRANT_MANUAL_OVERRIDE_OPTIONS;
this.__setHooks = function (hooks) {
  getSectionedRows = hooks.getSectionedRows;
  recordRegistrantTombstones = hooks.recordRegistrantTombstones;
  renderRegistrantsSheet = hooks.renderRegistrantsSheet;
  renderTriageSheet = hooks.renderTriageSheet;
  recomputeEventRegistryCounts = hooks.recomputeEventRegistryCounts;
  updateMasterLunchDashboard = hooks.updateMasterLunchDashboard;
};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function ok(name, cond, note) {
  if (cond) console.log('ok   ' + name);
  else { failures++; console.log('FAIL ' + name + (note ? '\n     ' + note : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`);
}

const REMOVE = sandbox.REGISTRANT_REMOVE_OVERRIDE_OPTION;
const map = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
function row(over) {
  const r = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
  Object.keys(over).forEach(k => { r[map[k]] = over[k]; });
  return r;
}

const rows = [
  row({ Name: 'Ruth Cohen', Event: 'Chair Yoga', Event_Date: new Date(2026, 8, 10), Event_ID: 'E1', Person_Type: 'Registrant', Manual_Override: REMOVE }),
  row({ Name: 'Ruth Cohen', Event: 'Chair Yoga', Event_Date: new Date(2026, 8, 10), Event_ID: 'E1', Person_Type: 'Registrant', Manual_Override: 'Manually Added' }),
  row({ Name: 'Sam Adler', Event: 'Chair Yoga', Event_Date: new Date(2026, 8, 10), Event_ID: 'E1', Person_Type: 'Registrant', Manual_Override: 'Auto-Synced' }),
  row({ Name: 'Ida Weiss', Event: 'Bridge', Event_Date: new Date(2026, 8, 12), Event_ID: 'E2', Person_Type: 'Guest', Manual_Override: 'Manually Edited' })
];

const calls = { tombstoned: [], rendered: [], counts: null, lunch: null };
const sheets = {};
sheets[sandbox.SHEET_NAMES.REGISTRANT_DASH] = { __name: 'registrants' };
sheets[sandbox.SHEET_NAMES.PROGRAM_DASHBOARD] = { __name: 'sessions' };
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: name => sheets[name] || null
});
sandbox.__setHooks({
  // The triage tab is absent in this workbook, which is also the case the
  // sweep has to survive: a tab that is not there is not an error.
  getSectionedRows: () => rows.map(r => r.slice()),
  recordRegistrantTombstones: (doomed) => { calls.tombstoned.push(doomed); },
  renderRegistrantsSheet: (force, keep) => { calls.rendered.push(keep); },
  renderTriageSheet: (force, keep) => { calls.rendered.push(keep); },
  recomputeEventRegistryCounts: (registry, sheet, keep) => { calls.counts = keep; },
  updateMasterLunchDashboard: (keep) => { calls.lunch = keep; }
});

const marked = sandbox.collectMarkedRegistrantRemovals();

// 1. Only the mark counts.
eq('one row is marked, not the hand-edited ones', marked.total, 1);
eq('and the rest are kept', marked.tabs[0].keep.length, 3);
eq('the marked row is the one that asked for it',
  marked.tabs[0].doomed[0][map['Name']], 'Ruth Cohen');
ok('the row kept under the same name is the Manually Added one',
  marked.tabs[0].keep.every(r => r[map['Manual_Override']] !== REMOVE));

// 5. The words before anything happens.
const detail = sandbox.describeMarkedRegistrantRemovals(marked);
ok('the confirmation names the person', /Ruth Cohen/.test(detail), detail);
ok('and the session', /Chair Yoga/.test(detail), detail);
ok('and promises the responses are left alone',
  /form responses behind them are left in place/.test(detail), detail);
ok('and does not name a row it is keeping', !/Ida Weiss/.test(detail), detail);

const message = sandbox.removeMarkedRegistrantsInternal(marked);

// 2. The tombstones, which are the whole reason a deletion sticks.
eq('exactly the doomed rows are tombstoned', calls.tombstoned.length, 1);
eq('one of them', calls.tombstoned[0].length, 1);
eq('and it is the marked row', calls.tombstoned[0][0][map['Name']], 'Ruth Cohen');

// 3. Redrawn and recounted from the SAME kept rows.
eq('the tab is redrawn once', calls.rendered.length, 1);
eq('with the kept rows', calls.rendered[0].length, 3);
ok('the session counts are recomputed from those same rows', calls.counts === calls.rendered[0]);
ok('and so is the catering', calls.lunch === calls.rendered[0]);
ok('the message says what happened', /Removed 1 marked registrant row/.test(message), message);

// 4. The mark survives an import that lands between marking and sweeping.
const protectedKeys = sandbox.getProtectedRegistrantKeys(rows);
ok('a row marked for removal is protected from re-derivation',
  protectedKeys.has('E1|ruth cohen|Registrant'), [...protectedKeys].join(', '));

// And the dropdown a person picks from.
eq('the dropdown offers the three states plus the instruction',
  sandbox.REGISTRANT_MANUAL_OVERRIDE_OPTIONS,
  ['Auto-Synced', 'Manually Edited', 'Manually Added', REMOVE]);

console.log(failures === 0 ? '\nAll remove-marked-registrant tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
