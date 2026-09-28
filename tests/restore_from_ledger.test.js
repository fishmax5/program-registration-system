// RESTORING WHAT THE LEDGER STILL HOLDS (99v), AND THE EMPTY-TAB GUARD (99j).
//
//   * A live fold row with no tab row, on a session that exists, is OFFERED.
//   * One already on the tab (any status), one whose session is gone, one
//     tombstoned and one on triage are COUNTED, never offered.
//   * Offers are grouped per program per building.
//   * A restored row keeps its Registration_ID, gets a local Date back, a
//     Manual_Override and an Admin_Notes stamp.
//   * An EMPTY tab is judged against the last rendered count, not waved through.
const assert = require('assert');
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '2026-09-28_1200', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; },
    setProperties: () => {}, deleteProperty: k => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => '' }) },
  MimeType: { CSV: 'text/csv' },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/New_York' }) }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { HEADERS, getIndexMap } = sandbox;
const H = HEADERS.All_Registrants;
const map = getIndexMap(H);
const row = (eventId, name, extra) => {
  const r = new Array(H.length).fill('');
  r[map['Event_ID']] = eventId; r[map['Name']] = name; r[map['Person_Type']] = 'Attendee';
  r[map['Event']] = 'Computer Tech Support'; r[map['Location']] = 'Narberth';
  r[map['Event_Date']] = '2026-09-29'; r[map['Registration_ID']] = 'id-' + name;
  r[map['Program_Status']] = 'Active';
  Object.keys(extra || {}).forEach(k => { r[map[k]] = extra[k]; });
  return r;
};

const fold = [
  row('e1', 'Donna'),                                // offered
  row('e1', 'Arnold', { Program_Status: 'Cancelled' }), // on tab already
  row('gone', 'Ghost'),                              // session gone
  row('e1', 'Tomb'),                                 // tombstoned
  row('e1', 'Triaged'),                              // on triage
  row('e2', 'Ashley', { Event: 'Low Cost Wills' })  // offered, other group
];
const live = [row('e1', 'arnold', { Program_Status: 'Cancelled' })];
const tk = sandbox.registrantTombstoneKey;
const out = sandbox.classifyLedgerRestore({
  foldRows: fold, liveRows: live,
  sessionEventIds: new Set(['e1', 'e2']),
  triageKeys: new Set([tk('e1', 'Triaged', 'Attendee')]),
  isTombstoned: (e, n) => n === 'Tomb'
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(out.counts)),
  { present: 1, noSession: 1, deliberate: 1, triage: 1, offered: 2 });
assert.strictEqual(out.groups.length, 2);
assert.deepStrictEqual(Array.from(out.groups, g => g.program), ['Computer Tech Support', 'Low Cost Wills']);
assert.strictEqual(out.groups[0].rows[0][map['Name']], 'Donna');

const restored = sandbox.buildLedgerRestoredRow(fold[0], map, 'Restored.');
assert.strictEqual(restored[map['Registration_ID']], 'id-Donna');
assert.ok(Object.prototype.toString.call(restored[map['Event_Date']]) === '[object Date]');
assert.strictEqual(restored[map['Event_Date']].getDate(), 29);
assert.strictEqual(restored[map['Manual_Override']], 'Manually Edited');
assert.strictEqual(restored[map['Admin_Notes']], 'Restored.');
assert.strictEqual(fold[0][map['Manual_Override']], '', 'the fold row is not mutated');

// The empty-tab baseline.
assert.strictEqual(sandbox.lastRenderedRegistrantCount_(), 0);
sandbox.recordRenderedRegistrantCount_(700);
assert.strictEqual(sandbox.lastRenderedRegistrantCount_(), 700);

console.log('restore_from_ledger: ok');
