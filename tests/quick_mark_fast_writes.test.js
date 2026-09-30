// A DESK WRITE COSTS WHAT IT CHANGES, NOT WHAT THE TAB HOLDS (38, 99q).
//
// Pinned here:
//
//   A new registrant row is INSERTED into the Upcoming section in date order,
//   with its values in one write — no redraw of the tab — and every other row
//   is left exactly where it was.
//   It declines (and the caller redraws, as before) for a row dated before
//   today, an empty Upcoming section, and a header row out of HEADERS order.
//   Several rows at once go to their own places.
//   addRegistrantRowsToTab_() redraws only when a row cannot go in — and then
//   once, with every row in it.
//   A mark on an existing row is one write per run of adjacent columns, and
//   never touches a column between them (a formula stays a formula).
//   The stored Quick Mark lists are PATCHED with a new name rather than
//   dropped — and dropped when the row names a session they do not have.
//   A batch holds its rows, writes them once at the end, and answers a second
//   add of the same person to the same session as already registered.
const vm = require('vm');
const src = require('./helpers/source').readSource();
const { makeCountingSheet } = require('./helpers/counting_sheet');

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d, tz, pattern) {
  const date = new Date(d);
  const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (pattern === 'yyyy-MM-dd') return key;
  return `${key} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: fmt, getUuid: () => 'u', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null, getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT' }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => null },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.insertRegistrantRowsInPlace_ = insertRegistrantRowsInPlace_;
this.addRegistrantRowsToTab_ = addRegistrantRowsToTab_;
this.writeRegistrantRowPatch_ = writeRegistrantRowPatch_;
this.patchStoredQuickMarkIndex_ = patchStoredQuickMarkIndex_;
this.withRegistrantAddBatch_ = withRegistrantAddBatch_;
this.getIndexMap = getIndexMap;
this.SEP = QUICK_MARK_SESSION_KEY_SEPARATOR;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.__stub = (name, fn) => { eval(name + ' = fn'); };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const headers = sandbox.HEADERS.All_Registrants;
const map = sandbox.getIndexMap(headers);
const W = headers.length;

function daysFromNow(n) {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
function regRow(name, days, extra) {
  const row = new Array(W).fill('');
  row[map['Event_Date']] = daysFromNow(days);
  row[map['Location']] = 'Narberth';
  row[map['Event']] = 'Chair Yoga';
  row[map['Name']] = name;
  row[map['Event_ID']] = `cal|Chair Yoga|${days}`;
  Object.keys(extra || {}).forEach(h => { row[map[h]] = extra[h]; });
  return row;
}

/** Banner, header, the upcoming rows, spacer, banner, header, the past rows. */
function tabGrid(upcoming, past) {
  const grid = [['⏳ Upcoming Registrants'], headers.slice()];
  upcoming.forEach(r => grid.push(r.slice()));
  grid.push([]);
  grid.push(['🕓 Past Registrants']);
  grid.push(headers.slice());
  past.forEach(r => grid.push(r.slice()));
  return grid;
}

/** A counting sheet that can actually insert and delete rows. */
function tab(grid) {
  const sheet = makeCountingSheet(grid, 'All_Registrants');
  const ops = [];
  sheet.insertRowsAfter = (after, n) => {
    ops.push(`after:${after}:${n}`);
    grid.splice(after, 0, ...Array.from({ length: n }, () => []));
    return sheet;
  };
  sheet.insertRowsBefore = (before, n) => {
    ops.push(`before:${before}:${n}`);
    grid.splice(before - 1, 0, ...Array.from({ length: n }, () => []));
    return sheet;
  };
  sheet.deleteRows = (at, n) => { ops.push(`delete:${at}:${n}`); grid.splice(at - 1, n); return sheet; };
  sheet.ops = ops;
  return sheet;
}
const names = grid => grid.map(r => (r && r[map['Name']]) || '').filter(n => n && n !== 'Name');

// ---------------------------------------------------------------------------
// The insert.
// ---------------------------------------------------------------------------
{
  const grid = tabGrid([regRow('Ann', 1), regRow('Bob', 3), regRow('Cy', 5)], [regRow('Old', -3)]);
  const sheet = tab(grid);
  const joan = regRow('Joan', 4);
  const landed = sandbox.insertRegistrantRowsInPlace_(sheet, [joan]);
  check('a new upcoming row goes in', landed.length, 1);
  check('after the last row on or before its date', names(grid), ['Ann', 'Bob', 'Joan', 'Cy', 'Old']);
  check('as one inserted row after Bob', sheet.ops, ['after:4:1']);
  check('its values in one write', sheet.stats.setValues, 1);
  check('one row longer, nothing else moved', grid.length, 10);
  check('the row is the row that was handed in', grid[4][map['Name']], 'Joan');
}
{
  const grid = tabGrid([regRow('Ann', 1), regRow('Bob', 3)], []);
  const sheet = tab(grid);
  sandbox.insertRegistrantRowsInPlace_(sheet, [regRow('First', 0)]);
  check('a row earlier than every other goes in at the top', names(grid), ['First', 'Ann', 'Bob']);
  check('inserted before the first data row', sheet.ops, ['before:3:1']);
}
{
  const grid = tabGrid([regRow('Ann', 1), regRow('Bob', 3), regRow('Cy', 5)], []);
  const sheet = tab(grid);
  const landed = sandbox.insertRegistrantRowsInPlace_(sheet, [regRow('Six', 6), regRow('Two', 2), regRow('Two-b', 2)]);
  check('several rows land together', landed.length, 3);
  check('each in its own place', names(grid), ['Ann', 'Two', 'Two-b', 'Bob', 'Cy', 'Six']);
}
{
  const grid = tabGrid([regRow('Ann', 1)], []);
  const before = JSON.stringify(grid);
  const sheet = tab(grid);
  check('a row dated before today is not inserted', sandbox.insertRegistrantRowsInPlace_(sheet, [regRow('Past', -1)]).length, 0);
  check('and the tab is untouched', JSON.stringify(grid), before);
}
{
  const grid = tabGrid([], []);
  const sheet = tab(grid);
  check('an empty Upcoming section is redrawn instead', sandbox.insertRegistrantRowsInPlace_(sheet, [regRow('A', 1)]).length, 0);
}
{
  const grid = tabGrid([regRow('Ann', 1)], []);
  const swapped = headers.slice();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  grid[1] = swapped;
  const sheet = tab(grid);
  check('a header row out of HEADERS order is redrawn instead',
    sandbox.insertRegistrantRowsInPlace_(sheet, [regRow('A', 2)]).length, 0);
}
{
  const grid = tabGrid([regRow('Ann', 1), regRow('Bob', 3)], []);
  const sheet = tab(grid);
  sheet.getRange = ((orig) => (r, c, nr, nc) => {
    const range = orig(r, c, nr, nc);
    if (nr === 1 && nc === W && r === 4) {
      return new Proxy(range, { get: (t, p) => (p === 'setValues' ? () => { throw new Error('refused'); } : t[p]) });
    }
    return range;
  })(sheet.getRange);
  const landed = sandbox.insertRegistrantRowsInPlace_(sheet, [regRow('Mid', 2)]);
  check('a write that fails lands nothing', landed.length, 0);
  check('and the blank row it inserted is taken back out', names(grid), ['Ann', 'Bob']);
  check('by deleting exactly that row', sheet.ops, ['after:3:1', 'delete:4:1']);
}

// ---------------------------------------------------------------------------
// addRegistrantRowsToTab_: the redraw is only for what did not go in.
// ---------------------------------------------------------------------------
{
  const grid = tabGrid([regRow('Ann', 1)], [regRow('Old', -5)]);
  const sheet = tab(grid);
  const rendered = [];
  sandbox.__stub('renderRegistrantsSheet', (force, rows) => { rendered.push(rows.map(r => r[map['Name']])); });
  sandbox.__stub('getSectionedRows', () => [regRow('Ann', 1), regRow('Old', -5)]);
  sandbox.addRegistrantRowsToTab_(sheet, [regRow('Up', 2), regRow('Back', -1)]);
  // A redraw is coming anyway for the past row, so the upcoming one rides in
  // it rather than being inserted first and rewritten a moment later.
  check('a batch that needs a redraw is not inserted first', names(grid).indexOf('Up'), -1);
  check('and goes through ONE redraw, every row in it', rendered, [['Ann', 'Old', 'Up', 'Back']]);

  const grid2 = tabGrid([regRow('Ann', 1)], []);
  rendered.length = 0;
  sandbox.addRegistrantRowsToTab_(tab(grid2), [regRow('Up', 2)]);
  check('no redraw at all when every row went in', rendered.length, 0);
}

// ---------------------------------------------------------------------------
// A mark on an existing row.
// ---------------------------------------------------------------------------
{
  const row = regRow('Ann', 1, { Form_Source: '=HYPERLINK("https://x","View response")', Manual_Override: 'Auto-Synced' });
  const grid = tabGrid([row], []);
  const sheet = tab(grid);
  const runs = sandbox.writeRegistrantRowPatch_(sheet, map, 3,
    { Attended: true, Lunch_Served: true, Manual_Override: 'Manually Edited' });
  check('Attended and Lunch_Served side by side are one write, the override another', runs, 2);
  check('as two setValues and no single-cell writes', [sheet.stats.setValues, sheet.stats.setValue], [2, 0]);
  check('the ticks landed', [grid[2][map['Attended']], grid[2][map['Lunch_Served']], grid[2][map['Manual_Override']]],
    [true, true, 'Manually Edited']);
  check('and the formula beside them is still a formula', grid[2][map['Form_Source']],
    '=HYPERLINK("https://x","View response")');
}

// ---------------------------------------------------------------------------
// The stored Quick Mark lists are patched, not dropped.
// ---------------------------------------------------------------------------
function storedIndex() {
  const d = daysFromNow(2);
  const dateKey = fmt(d, '', 'yyyy-MM-dd');
  const label = `Chair Yoga — ${dateKey}`;
  return {
    schema: 5,
    sessions: [
      { value: label, label, location: 'Narberth', title: 'Chair Yoga', dateKey, times: [{ value: '10:00 AM' }, { value: '10:30 AM' }] },
      { value: 'Chair Yoga', label: 'Chair Yoga', location: 'Narberth', title: 'Chair Yoga', dateKey: '', times: [] }
    ],
    namesBySession: {
      [`Narberth${sandbox.SEP}${label}`]: { names: ['Bob'], keys: ['bob'], times: [''], statuses: ['Active'] },
      [`Narberth${sandbox.SEP}Chair Yoga`]: { names: ['Bob'], keys: ['bob'], times: [''], statuses: ['Active'] }
    },
    members: [{ name: 'Ann', key: 'ann' }, { name: 'Zed', key: 'zed' }],
    needs: []
  };
}
{
  let written = null;
  let stored = storedIndex();
  sandbox.__stub('readCachedQuickMarkIndex', () => Object.assign(JSON.parse(JSON.stringify(stored)), { fromCache: true }));
  sandbox.__stub('readSheetQuickMarkIndex', () => null);
  sandbox.__stub('writeCachedQuickMarkIndex', index => { written = index; });
  sandbox.__stub('writeSheetQuickMarkIndex', () => {});
  const joan = regRow('Joan', 2, { Event_Time: '10:30 AM – 11:00 AM', Program_Status: 'Active' });
  check('a new name on a known session is patched in', sandbox.patchStoredQuickMarkIndex_([joan]), true);
  const dated = written.namesBySession[Object.keys(written.namesBySession)[0]];
  check('onto that session\'s list', dated.names, ['Bob', 'Joan']);
  check('and the program\'s undated list', written.namesBySession[`Narberth${sandbox.SEP}Chair Yoga`].names, ['Bob', 'Joan']);
  check('her booked time is off the free list', written.sessions[0].times.map(t => t.value), ['10:00 AM']);
  check('and she is on the member list, in order', written.members.map(m => m.name), ['Ann', 'Joan', 'Zed']);
  check('the stored copy is not marked as read from the cache', written.fromCache, undefined);

  written = null;
  check('a row on a session the stored copy does not have is not patched',
    sandbox.patchStoredQuickMarkIndex_([regRow('Kim', 9)]), false);
  check('and nothing is written', written, null);

  sandbox.__stub('readCachedQuickMarkIndex', () => null);
  check('nothing stored, nothing patched', sandbox.patchStoredQuickMarkIndex_([joan]), false);
}

// ---------------------------------------------------------------------------
// The batch.
// ---------------------------------------------------------------------------
{
  const added = [];
  const noted = [];
  sandbox.__stub('addRegistrantRowsToTab_', (sheet, rows, opts) => { added.push({ n: rows.length, signup: !!opts.signup }); });
  sandbox.__stub('noteRegistrantRowsAdded_', rows => { noted.push(rows.length); });
  sandbox.__stub('__registrantAddBatch', null);
  const result = sandbox.withRegistrantAddBatch_(() => {
    vm.runInContext(`
      __registrantAddBatch.sheet = ({});
      __registrantAddBatch.rows.push([1], [2], [3]);
      __registrantAddBatch.signup = true;
    `, sandbox);
    // A nested batch joins the outer one rather than writing on its own.
    sandbox.withRegistrantAddBatch_(() => {
      vm.runInContext('__registrantAddBatch.rows.push([4]);', sandbox);
    });
    return 'done';
  });
  check('a batch hands back what its body returned', result, 'done');
  check('and writes every row it held, once, at the end', added, [{ n: 4, signup: true }]);
  check('telling the stored lists once', noted, [4]);
  check('and closes behind itself', vm.runInContext('__registrantAddBatch', sandbox), null);
}

if (failures) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nall ok');
