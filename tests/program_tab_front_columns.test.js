// The front of the two program tabs (99zzg):
//   • the building as one letter — A / N / Z, "N+A" for a shared program;
//   • the next class's count, over capacity only when every session that day has one;
//   • the session table's Room is the date's EFFECTIVE room, and a pick in it
//     is stored on Room_Override — the usual room, or a blank, clears it;
//   • the Room edit reads the TAB's header row, so a tab in the old order
//     cannot read a Type_Tag pick as a room;
//   • a new session row is appended in the tab's own column order;
//   • the header lists put the four columns straight after the title.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York' },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.LOCATION_COLOR_MAP = LOCATION_COLOR_MAP;
this.PROGRAM_DASHBOARD_HIDDEN_COLUMNS = PROGRAM_DASHBOARD_HIDDEN_COLUMNS;
this.PROGRAM_MONTH_HIDDEN_COLUMNS = PROGRAM_MONTH_HIDDEN_COLUMNS;
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}\n  got      ${g}\n  expected ${w}`); }
}

// --- The letter ---------------------------------------------------------------
check('each building is its letter',
  ['Ashbridge', 'Narberth', 'Zoom', 'narberth'].map(sandbox.locationShortLetter), ['A', 'N', 'Z', 'N']);
check('a shared program is both letters', sandbox.locationShortLetter('Narberth + Ashbridge'), 'N+A');
check('an unknown building is its own first letter, a blank is blank',
  [sandbox.locationShortLetter('library'), sandbox.locationShortLetter('')], ['L', '']);
check('every coloured building has a distinct letter',
  new Set(Object.keys(sandbox.LOCATION_COLOR_MAP).map(sandbox.locationShortLetter)).size,
  Object.keys(sandbox.LOCATION_COLOR_MAP).length);

// --- The header order --------------------------------------------------------
{
  const s = sandbox.HEADERS.All_Program_Sessions;
  check('the session table leads with date, letter, title, count, room',
    s.slice(0, 5), ['Event_Date', 'Loc', 'Clean_Title', 'Active_Count', 'Room']);
  check('Location and the roster link are hidden plumbing now',
    ['Location', 'Registrant_Sheet_Link', 'Room_Override'].map(h => sandbox.PROGRAM_DASHBOARD_HIDDEN_COLUMNS.indexOf(h) !== -1),
    [true, true, true]);
  const m = sandbox.HEADERS.Master_Program_Dashboard;
  check('the dashboard leads with letter, program, next date, count, room',
    m.slice(0, 5), ['Loc', 'Program', 'Next_Date', 'Next_Registered', 'Room']);
  check('the dashboard hides Location', sandbox.PROGRAM_MONTH_HIDDEN_COLUMNS.indexOf('Location') !== -1, true);
}

// --- Next class's count -------------------------------------------------------
{
  const map = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
  const row = (active, cap) => {
    const r = new Array(sandbox.HEADERS.All_Program_Sessions.length).fill('');
    r[map['Active_Count']] = active; r[map['Max_Capacity']] = cap;
    return { row: r };
  };
  check('capped: "8 / 12"', sandbox.describeNextSessionRegistered([row(8, 12)], map), '8 / 12');
  check('uncapped: just the number', sandbox.describeNextSessionRegistered([row(5, '')], map), '5');
  check('two buildings on one day are summed', sandbox.describeNextSessionRegistered([row(3, 10), row(4, 10)], map), '7 / 20');
  check('one capped and one not: the number alone', sandbox.describeNextSessionRegistered([row(3, 10), row(4, '')], map), '7');
  check('no next date: blank', sandbox.describeNextSessionRegistered([], map), '');
}

// --- The session rows' derived front columns ---------------------------------
{
  const headers = sandbox.HEADERS.All_Program_Sessions;
  const map = sandbox.getIndexMap(headers);
  sandbox.readNotificationPolicyRows = () => ({});
  sandbox.usualRoomForProgram_ = (title) => (title === 'Chair Yoga' ? 'Narberth: Hall' : '');
  const mk = (title, location, override) => {
    const r = new Array(headers.length).fill('');
    r[map['Clean_Title']] = title; r[map['Location']] = location;
    r[map['Room_Override']] = override || ''; r[map['Event_ID']] = `cal|${title}|2026-12-01`;
    return r;
  };
  const rows = [mk('Chair Yoga', 'Narberth'), mk('Chair Yoga', 'Narberth', 'Narberth: Library'), mk('Bingo', 'Ashbridge')];
  sandbox.stampSessionFrontColumns_(rows, map);
  check('Loc is the letter', rows.map(r => r[map['Loc']]), ['N', 'N', 'A']);
  check('Room is the override, else the usual room, else blank',
    rows.map(r => r[map['Room']]), ['Narberth: Hall', 'Narberth: Library', '']);
}

// --- A pick in the Room column ------------------------------------------------
function roomSheet(headerRowValues, dataRow) {
  const grid = [headerRowValues, dataRow];
  const writes = [];
  return {
    writes,
    grid,
    getName: () => 'All_Program_Sessions',
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + (nr || 1)).map(line => line.slice(c - 1, c - 1 + (nc || 1))),
      setValues: v => { writes.push({ col: c, value: v[0][0] }); v.forEach((line, i) => { grid[r - 1 + i][c - 1] = line[0]; }); }
    })
  };
}
{
  const headers = sandbox.HEADERS.All_Program_Sessions;
  const map = sandbox.getIndexMap(headers);
  sandbox.readRoomsList = () => [{ label: 'Narberth: Hall' }, { label: 'Narberth: Library' }];
  sandbox.usualRoomForProgram_ = () => 'Narberth: Hall';
  sandbox.invalidateSectionedRowsCache = () => {};
  sandbox.toastIfPossible = () => {};
  const pick = (value) => {
    const data = new Array(headers.length).fill('');
    data[map['Clean_Title']] = 'Chair Yoga'; data[map['Location']] = 'Narberth';
    data[map['Event_ID']] = 'cal|Chair Yoga|2026-12-01';
    data[map['Room']] = value; data[map['Room_Override']] = 'stale';
    const sheet = roomSheet(headers.slice(), data);
    sandbox.getHeaderMapAt = (sh, row) => {
      const out = {}; sh.grid[row - 1].forEach((h, i) => { out[h] = i + 1; }); return out;
    };
    const e = { range: { getRow: () => 2, getColumn: () => map['Room'] + 1, getNumRows: () => 1, getNumColumns: () => 1 } };
    const answered = sandbox.handleSessionRoomEdit_(e, sheet, 1);
    return [answered, data[map['Room_Override']], data[map['Room']]];
  };
  check('a different room is stored as this date\'s override',
    pick('narberth: library'), [true, 'Narberth: Library', 'Narberth: Library']);
  check('picking the usual room clears the override', pick('Narberth: Hall'), [true, '', 'Narberth: Hall']);
  check('clearing the cell clears the override and shows the usual room', pick(''), [true, '', 'Narberth: Hall']);

  // A tab still in the OLD order: the 5th column is Type_Tag there, and a pick
  // in it is not a room.
  const old = ['Event_Date', 'Location', 'Clean_Title', 'Event_Time', 'Type_Tag'];
  const sheet = roomSheet(old, ['', 'Narberth', 'Chair Yoga', '', 'Grouped']);
  const e = { range: { getRow: () => 2, getColumn: () => 5, getNumRows: () => 1, getNumColumns: () => 1 } };
  check('on a tab in the old order a Type_Tag pick is not taken for a room',
    [sandbox.handleSessionRoomEdit_(e, sheet, 1), sheet.writes.length], [false, 0]);
}

// --- Appending in the tab's own order ----------------------------------------
{
  const headers = sandbox.HEADERS.All_Program_Sessions;
  const map = sandbox.getIndexMap(headers);
  const oldOrder = ['Event_Date', 'Location', 'Clean_Title', 'Event_ID'];
  sandbox.findAllHeaderRows = () => [1];
  sandbox.getHeaderMapAt = () => { const o = {}; oldOrder.forEach((h, i) => { o[h] = i + 1; }); return o; };
  const row = new Array(headers.length).fill('');
  row[map['Event_Date']] = 'D'; row[map['Location']] = 'Narberth'; row[map['Clean_Title']] = 'T'; row[map['Event_ID']] = 'ID';
  check('a new row lands under the tab\'s own headers',
    sandbox.projectSessionRowsOntoTab_({}, headers, [row])[0], ['D', 'Narberth', 'T', 'ID']);
  sandbox.getHeaderMapAt = () => { const o = {}; headers.forEach((h, i) => { o[h] = i + 1; }); return o; };
  check('a tab already in HEADERS order is written as it is',
    sandbox.projectSessionRowsOntoTab_({}, headers, [row])[0] === row, true);
}

if (failures) { console.log(`\n${failures} failure(s).`); process.exit(1); }
console.log('\nall passed');
