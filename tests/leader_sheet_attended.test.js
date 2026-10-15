// ============================================================================
// THE Attended TICK A LEADER MAY ADD AND MAY NOT TAKE AWAY  (46, 03, 99zn)
// ============================================================================
//
// The desk owns Attended: Quick Mark (38) and the sign-in app (74) tick it at
// the door, the dashboard's metrics block (43) counts it and the Metrics tab
// (83) stores it. But the person who knows who walked into the room is very
// often the one standing in it, so the program registrant sheet carries the
// column — one way.
//
// A TICK is a mark on the registrant row. An UNTICK is nothing at all. The
// asymmetry is the only thing that makes the column safe to hand out: the
// three-way merge the five leader-owned columns use would happily send a false
// back, and that false would erase a mark somebody made in front of the person
// it was about — from a browser tab left open since Tuesday, or from a leader
// tidying last month's sheet.
//
// What is pinned here: the tick writing through, the untick doing nothing at
// all, the ledger entry appearing ONCE and not again on a repeat sync, an old
// five-value snapshot still reading back as "nothing was touched", and the web
// roster page (99zn) refusing an untick the same way the sheet does.
const assert = require('assert');
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    // The real thing's own format, because buildLeaderSheetRowsByProgram()
    // windows its dates on formatDateKey()'s yyyy-MM-dd and compares them as
    // strings.
    formatDate: (d, tz, pattern) => {
      const date = new Date(d);
      const pad = n => String(n).padStart(2, '0');
      const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return pattern === 'yyyy-MM-dd' ? ymd : date.toISOString();
    },
    getUuid: () => 'u', sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'x' }), getActiveUser: () => ({ getEmail: () => 'x' }) }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

// The harness: one program with one sheet, whose rows this test supplies.
vm.runInContext(`
  var __entries = [];
  var __recorded = {};            // what the ledger already holds, by id
  appendLedgerEntry = function (e) { __entries.push(e); return 1; };
  ledgerIdForRegistrantRow = function (row, map) { return 'REG-' + row[map['Name']]; };
  ledgerAlreadyRecords = function (id, payload) {
    const held = __recorded[id];
    if (!held) return false;
    return Object.keys(payload).every(k => String(held[k]) === String(payload[k]));
  };
  log = function () {};
  noteForAdmin = function () {};
  getProgramLeaderSheetRegistry = () => ({ prog: { fileId: 'f', title: 'Yoga', location: 'Ashbridge' } });
  openSpreadsheetCached = () => ({ getSheetByName: () => ({}) });
  leaderRosterSheetRetired = () => false;
  planLeaderSheetPull_ = () => ({ untouched: () => false, read: () => {}, save: () => {} });

  var __map = getIndexMap(HEADERS.All_Registrants);
  var __sheetMap = getIndexMap(LEADER_SHEET_HEADERS);

  function __registrantRow(o) {
    const r = new Array(HEADERS.All_Registrants.length).fill('');
    Object.keys(o).forEach(k => { r[__map[k]] = o[k]; });
    return r;
  }
  // One line as it would come back off the shared sheet: the values a leader
  // is looking at, plus the hidden snapshot of what was last pushed to them.
  function __sheetLine(rowKey, shown, snapshot) {
    const line = new Array(LEADER_SHEET_HEADERS.length).fill('');
    Object.keys(shown).forEach(k => { line[__sheetMap[k]] = shown[k]; });
    line[__sheetMap['Row_Key']] = rowKey;
    line[__sheetMap['Pushed_Snapshot']] = snapshot;
    return line;
  }
  // The pull, over one sheet holding exactly these lines.
  function __pull(lines, rows) {
    readSimpleTable = () => lines;
    __entries.length = 0;
    const applied = pullProgramLeaderSheetEdits(rows);
    return { applied: applied, entries: __entries.slice() };
  }
`, sandbox);

// Values come back across the vm boundary as JSON: an array built inside the
// context has that context's Array prototype, which deepStrictEqual refuses.
const run = code => JSON.parse(JSON.stringify(
  vm.runInContext(`(function () { ${code} })()`, sandbox) || null));

// ---------------------------------------------------------------------------
// 1. THE PUSH CARRIES THE DESK'S OWN MARK OUT
// ---------------------------------------------------------------------------
{
  const out = run(`
    const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
    const session = new Array(HEADERS.All_Program_Sessions.length).fill('');
    session[sessionMap['Event_ID']] = 'E1';
    session[sessionMap['Event_Date']] = new Date();
    session[sessionMap['Clean_Title']] = 'Yoga';
    session[sessionMap['Location']] = 'Ashbridge';
    const row = __registrantRow({ Name: 'Joan', Event_ID: 'E1', Party_ID: 'P1',
      Program_Status: 'Active', Attended: true });
    const byProgram = buildLeaderSheetRowsByProgram([session], [row]);
    const line = byProgram['yoga|ashbridge'][0];
    return { shown: line[__sheetMap['Attended']], snapshot: line[__sheetMap['Pushed_Snapshot']] };
  `);
  assert.strictEqual(out.shown, true,
    "a leader opening their roster sees who the desk already marked in");
  assert.deepStrictEqual(JSON.parse(out.snapshot),
    [false, false, false, false, '', true],
    'and the snapshot records it, so the next pull knows it was not the leader who ticked it');
}

// ---------------------------------------------------------------------------
// 2. A TICK WRITES THROUGH, AND IS RECORDED ONCE
// ---------------------------------------------------------------------------
{
  const out = run(`
    const row = __registrantRow({ Name: 'Joan', Event_ID: 'E1', Party_ID: 'P1' });
    const key = leaderRowKey('E1', 'P1', 'Joan');
    const sent = readLeaderValues(row, __map);                 // all false, '' notes
    const line = __sheetLine(key, { Attended: true }, encodeLeaderSnapshot(sent));
    const first = __pull([line], [row]);
    // The same hour again, with the sheet still ahead of the snapshot: the row
    // now already holds the mark, and nothing further is owed to the ledger.
    __recorded['REG-Joan'] = { Attended: true };
    const second = __pull([line], [row]);
    return { attended: row[__map['Attended']], first: first, second: second };
  `);
  assert.strictEqual(out.attended, true, 'the tick reached the registrant row');
  assert.strictEqual(out.first.applied, 1);
  assert.strictEqual(out.first.entries.length, 1, 'one ledger entry');
  assert.strictEqual(out.first.entries[0].kind, 'corrected');
  assert.strictEqual(out.first.entries[0].source, 'leader-sheet');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.first.entries[0].payload)), { Attended: true },
    'carrying only the column that moved');
  assert.strictEqual(out.second.entries.length, 0,
    'and not again on the next sync — the row moving is not evidence the registration did (99k)');
}

// ---------------------------------------------------------------------------
// 3. AN UNTICK DOES NOTHING AT ALL
// ---------------------------------------------------------------------------
{
  const out = run(`
    // The desk marked Joan in at the door; the sheet went out saying so; the
    // leader has since unticked it (or a tab open since Tuesday just saved).
    const row = __registrantRow({ Name: 'Joan', Event_ID: 'E1', Party_ID: 'P1',
      Attended: true, Contacted: true });
    const key = leaderRowKey('E1', 'P1', 'Joan');
    const sent = readLeaderValues(row, __map);
    const line = __sheetLine(key, { Attended: false, Contacted: false }, encodeLeaderSnapshot(sent));
    const res = __pull([line], [row]);
    return { attended: row[__map['Attended']], contacted: row[__map['Contacted']], res: res };
  `);
  assert.strictEqual(out.attended, true, "a leader cannot clear the desk's attendance mark");
  assert.strictEqual(out.contacted, false,
    'while Contacted beside it still merges both ways — only the ack column is one-way');
  assert.strictEqual(out.res.applied, 1, 'the untick is not counted as an applied cell');
  assert.strictEqual(out.res.entries.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.res.entries[0].payload)), { Contacted: false },
    'and the ledger never hears about a change that did not happen');
}

// ---------------------------------------------------------------------------
// 4. NOTHING TO SAY IS NOTHING WRITTEN
// ---------------------------------------------------------------------------
{
  const out = run(`
    const row = __registrantRow({ Name: 'Joan', Event_ID: 'E1', Party_ID: 'P1', Attended: true });
    const key = leaderRowKey('E1', 'P1', 'Joan');
    const sent = readLeaderValues(row, __map);
    // An untick and NOTHING else: no cell to apply, so no entry at all rather
    // than an empty 'corrected' entry.
    const line = __sheetLine(key, { Attended: false }, encodeLeaderSnapshot(sent));
    const res = __pull([line], [row]);
    return { attended: row[__map['Attended']], res: res };
  `);
  assert.strictEqual(out.attended, true);
  assert.strictEqual(out.res.applied, 0);
  assert.strictEqual(out.res.entries.length, 0, 'an untick alone leaves no trace anywhere');
}

// ---------------------------------------------------------------------------
// 5. EVERY SHEET IN DRIVE IS HOLDING A FIVE-VALUE SNAPSHOT
//
// The pull runs BEFORE the template bump redraws them, so it has to read those
// as a prefix. A sheet drawn under v3 has no Attended column at all and reads
// it back blank — which must compare EQUAL to the padded snapshot, or the
// first pull after the upgrade claims an untick on every row of every sheet.
// ---------------------------------------------------------------------------
{
  const out = run(`
    const row = __registrantRow({ Name: 'Joan', Event_ID: 'E1', Party_ID: 'P1', Attended: true });
    const key = leaderRowKey('E1', 'P1', 'Joan');
    const old = JSON.stringify([false, false, false, false, '']);   // the v3 shape
    const padded = decodeLeaderSnapshot(old);
    const line = __sheetLine(key, {}, old);                         // no Attended cell
    const res = __pull([line], [row]);
    return { padded: padded, attended: row[__map['Attended']], entries: res.entries.length,
      tooLong: decodeLeaderSnapshot(JSON.stringify([1, 2, 3, 4, 5, 6, 7])),
      tooShort: decodeLeaderSnapshot(JSON.stringify([false, false])) };
  `);
  assert.deepStrictEqual(out.padded, [false, false, false, false, '', false],
    'an older snapshot is padded with each missing column’s own blank');
  assert.strictEqual(out.attended, true, 'and the mark on the row is left alone');
  assert.strictEqual(out.entries, 0, 'with nothing claimed and nothing recorded');
  assert.strictEqual(out.tooLong, null, 'a snapshot longer than the list is still unreadable');
  assert.strictEqual(out.tooShort, null, 'and so is one shorter than the five owned columns');
}

// ---------------------------------------------------------------------------
// 6. THE RULE IS ONE FUNCTION, AND THE PAGE ASKS THE SAME ONE
// ---------------------------------------------------------------------------
{
  const out = run(`
    return {
      ack: LEADER_ACK_FLAG_COLUMNS.slice(),
      tickTrue: leaderAckEditApplies_('Attended', true),
      tickTextTrue: leaderAckEditApplies_('Attended', 'TRUE'),
      untick: leaderAckEditApplies_('Attended', false),
      blank: leaderAckEditApplies_('Attended', ''),
      ownedUntick: leaderAckEditApplies_('Dropped', false),
      ownedNote: leaderAckEditApplies_('Leader_Notes', ''),
      editable: LEADER_SHEET_EDITABLE_COLUMNS.slice(),
      ticks: LEADER_SHEET_TICK_COLUMNS.slice()
    };
  `);
  assert.deepStrictEqual(out.ack, ['Attended']);
  assert.strictEqual(out.tickTrue, true);
  assert.strictEqual(out.tickTextTrue, true, 'a hand-pasted "TRUE" is a tick');
  assert.strictEqual(out.untick, false);
  assert.strictEqual(out.blank, false, 'a cleared cell is an untick, not an unknown');
  assert.strictEqual(out.ownedUntick, true, 'the five owned columns are untouched by the rule');
  assert.strictEqual(out.ownedNote, true);
  assert.ok(out.editable.indexOf('Attended') === out.editable.length - 1,
    'the ack columns are APPENDED to the snapshot order (see 03)');
  assert.ok(out.ticks.indexOf('Attended') !== -1, 'and drawn as a real checkbox');
}

// ---------------------------------------------------------------------------
// 7. THE WEB ROSTER PAGE (99zn): same column, same rule, its own words
// ---------------------------------------------------------------------------
{
  const out = run(`
    resolveLeaderRosterToken_ = () => ({ programKey: 'yoga|ashbridge', title: 'Yoga', location: 'Ashbridge' });
    leaderRosterWriteState_ = () => ({ writable: true, reason: '' });
    var __applied = [];
    applyLeaderRosterEditLocked_ = function (args) { __applied.push(args); return { ok: true, changed: 1 }; };
    deferQuickMarkBehindSync_ = () => null;
    withScriptLock = (ms, fn) => fn();
    leaderRosterNameFor_ = () => 'Joan';
    leaderRosterView = () => ({ ok: true });
    const tick = leaderRosterMark('t', 'k', 'Attended', true);
    const untick = leaderRosterMark('t', 'k', 'Attended', false);
    const other = leaderRosterMark('t', 'k', 'Lunch_Served', true);
    return { tick: tick, untick: untick, other: other, applied: __applied.slice() };
  `);
  assert.strictEqual(out.tick.ok, true, 'a tick is taken');
  assert.strictEqual(out.untick.ok, false, 'an untick is refused');
  assert.ok(/only ever added here/.test(out.untick.message),
    'with the reason, because somebody pressed a button and a shrug is not an answer');
  assert.strictEqual(out.other.ok, false, 'and a column that is not a leader’s is still refused');
  assert.strictEqual(out.applied.length, 1, 'only the tick reached the writer');
  assert.deepStrictEqual(out.applied[0].changes, { Attended: true });
}

console.log('✅ leader_sheet_attended.test.js passed');
