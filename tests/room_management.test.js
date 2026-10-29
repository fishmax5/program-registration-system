// THE ROOM MANAGEMENT TAB (99zx_room_management.gs).
//
// Pinned here:
//   • the pure pieces: keyword matching, building-scoped rules, the Programs
//     table's rows and their `Why`, and what an Apply would do (planBulkRoomAssign);
//   • the redraw never clears: the Programs block is ONE setValues over the old
//     range padded with blanks, the staff-typed tables (rooms, rules, the
//     assign box) are never written by it, and the structure is written once;
//   • a Room pick writes through to Program_Settings' Room_Or_Setup (the one
//     store), skipping the heading and defaults rows;
//   • Apply: declined or invalid changes nothing, accepted writes only the
//     programs that are not already there and empties the box;
//   • Config's old Rooms section is carried across once, and only into an
//     empty list.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const toasts = [];
const calls = [];

// A chainable range: every setter returns itself; values live in a grid.
const grid = {};
const key = (r, c) => `${r},${c}`;
function makeRange(sheetState, r, c, n, w) {
  const range = new Proxy({}, {
    get(_, name) {
      if (name === 'getValues') return () => {
        const out = [];
        for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < w; j++) row.push(sheetState.grid[key(r + i, c + j)] ?? ''); out.push(row); }
        return out;
      };
      if (name === 'getValue') return () => sheetState.grid[key(r, c)] ?? '';
      if (name === 'setValues') return vals => {
        calls.push({ op: 'setValues', sheet: sheetState.name, r, c, n: vals.length, w: vals[0].length });
        vals.forEach((row, i) => row.forEach((v, j) => { sheetState.grid[key(r + i, c + j)] = v; }));
        return range;
      };
      if (name === 'setValue') return v => { calls.push({ op: 'setValue', sheet: sheetState.name, r, c }); sheetState.grid[key(r, c)] = v; return range; };
      if (name === 'setFormula') return f => { calls.push({ op: 'setFormula', sheet: sheetState.name, r, c, f }); return range; };
      if (name === 'clearContent') return () => { calls.push({ op: 'clearContent', sheet: sheetState.name, r, c, n, w });
        for (let i = 0; i < n; i++) for (let j = 0; j < w; j++) delete sheetState.grid[key(r + i, c + j)]; return range; };
      if (name === 'merge') return () => { calls.push({ op: 'merge', sheet: sheetState.name, r, c }); return range; };
      if (name === 'getRow') return () => r;
      if (name === 'getColumn') return () => c;
      if (name === 'getNumRows') return () => n;
      if (name === 'getNumColumns') return () => w;
      if (name === 'getSheet') return () => sheetState.sheet;
      return () => range;
    }
  });
  return range;
}
function makeSheet(name) {
  const st = { name, grid: {}, maxCols: 30 };
  st.sheet = {
    getName: () => name,
    getLastRow: () => Math.max(0, ...Object.keys(st.grid).map(k => Number(k.split(',')[0]))),
    getMaxColumns: () => st.maxCols,
    insertColumnsAfter: (a, n) => { st.maxCols += n; },
    setFrozenRows: () => {},
    clear: () => { calls.push({ op: 'clear', sheet: name }); },
    getRange: (r, c, n, w) => makeRange(st, r, c || 1, n || 1, w || 1),
    getParent: () => null
  };
  return st;
}

const tab = makeSheet('Room_Management');
const psTab = makeSheet('Program_Settings');
const cfg = makeSheet('Config');
const book = { getSheetByName: name => ({ Room_Management: tab.sheet, Program_Settings: psTab.sheet, Config: cfg.sheet })[name] || null,
  insertSheet: () => tab.sheet, getSheets: () => [], getSpreadsheetTimeZone: () => 'America/New_York' };

const chain = new Proxy(function () {}, { get: () => () => chain, apply: () => chain });
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => String(d), computeDigest: () => [1, 2, 3, 4], DigestAlgorithm: { MD5: 'MD5' },
    base64Encode: () => 'x', sleep: () => {}, Charset: { UTF_8: 'UTF-8' } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => book, getActive: () => book, newDataValidation: () => chain,
    WrapStrategy: { CLIP: 'CLIP' }, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.roomKeywordMatches_ = roomKeywordMatches_;
this.keywordRuleFor_ = keywordRuleFor_;
this.buildRoomManagementProgramRows = buildRoomManagementProgramRows;
this.planBulkRoomAssign = planBulkRoomAssign;
this.refreshRoomManagementTab = refreshRoomManagementTab;
this.handleRoomManagementEdit = handleRoomManagementEdit;
this.writeProgramSettingsRoom_ = writeProgramSettingsRoom_;
this.migrateConfigRoomsToTab_ = migrateConfigRoomsToTab_;
this.readRoomsList = readRoomsList;
this.forgetRoomsList = forgetRoomsList;
this.forgetRoomKeywordRules = forgetRoomKeywordRules;
this.L = ROOM_MANAGEMENT_LAYOUT;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.getIndexMap = getIndexMap;
this.TAB_GROUPS = TAB_GROUPS;
this.notificationProgramKey = notificationProgramKey;
this.toastIfPossible = function (m) { this.__toasts.push(m); }.bind(this);
this.__toasts = [];
`, sandbox, { filename: 'project.gs' });
sandbox.__toasts = toasts;

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const R1 = 'Narberth: Social Hall', R2 = 'Narberth: Library';
const rooms = [{ building: 'Narberth', room: 'Social Hall', label: R1 }, { building: 'Narberth', room: 'Library', label: R2 }];
const rules = [{ keyword: 'yoga', building: '', room: R1 }, { keyword: 'bingo', building: 'Ashbridge', room: R2 }];

// ---------------------------------------------------------------------------
// 1. THE PURE PIECES
// ---------------------------------------------------------------------------
{
  ok('a keyword is found in a title, ignoring case and spacing', sandbox.roomKeywordMatches_('Chair  YOGA', 'yoga'));
  ok('a blank keyword matches nothing', !sandbox.roomKeywordMatches_('Chair Yoga', '  '));
  ok('the first matching rule wins', sandbox.keywordRuleFor_('Yoga Bingo', 'Ashbridge', rules).keyword === 'yoga');
  ok('a building-scoped rule is skipped elsewhere', sandbox.keywordRuleFor_('Bingo', 'Narberth', rules) === null);

  const rows = sandbox.buildRoomManagementProgramRows([
    { event: 'Painting', location: 'Narberth', room: 'easels' },
    { event: 'Chair Yoga', location: 'Narberth', room: '' },
    { event: 'Bingo', location: 'Ashbridge', room: R2 },
    { event: 'Art', location: 'Narberth', room: R1 }
  ], rooms, rules);
  ok('rows are sorted by location then event',
    rows.map(r => r[0]).join() === 'Bingo,Art,Chair Yoga,Painting', rows.map(r => r[0]).join());
  const byEvent = Object.fromEntries(rows.map(r => [r[0], r]));
  ok('its own room says "Set here"', byEvent.Art[3] === R1 && byEvent.Art[4] === 'Set here');
  ok('a keyword says which', byEvent['Chair Yoga'][3] === R1 && /Keyword "yoga"/.test(byEvent['Chair Yoga'][4]));
  ok('free text says it is not checked', byEvent.Painting[3] === '' && /Not on the rooms list/.test(byEvent.Painting[4]));
  ok('the Room cell shows what is stored, not what is derived', byEvent['Chair Yoga'][2] === '' && byEvent.Painting[2] === 'easels');

  const progs = [{ event: 'Chair Yoga', location: 'Narberth', room: R1 }, { event: 'Gentle Yoga', location: 'Narberth', room: '' },
    { event: 'Bingo', location: 'Narberth', room: '' }];
  let plan = sandbox.planBulkRoomAssign(progs, 'yoga', R1, rooms);
  ok('apply matches by title and skips those already there', plan.ok && plan.matches.length === 2 && plan.changes.length === 1 &&
    plan.changes[0].event === 'Gentle Yoga');
  ok('apply with no keyword is refused', !sandbox.planBulkRoomAssign(progs, ' ', R1, rooms).ok);
  ok('apply with no room is refused', /Pick a room/.test(sandbox.planBulkRoomAssign(progs, 'yoga', '', rooms).error));
  ok('apply with a room not on the list is refused', /not on the Rooms list/.test(sandbox.planBulkRoomAssign(progs, 'yoga', 'the barn', rooms).error));
  ok('apply with no match says so', /No program has "zumba"/.test(sandbox.planBulkRoomAssign(progs, 'zumba', R1, rooms).error));
  ok('a sloppy spelling of a listed room is accepted', sandbox.planBulkRoomAssign(progs, 'yoga', 'narberth:  social hall', rooms).room === R1);
}

// ---------------------------------------------------------------------------
// 2. THE REDRAW NEVER CLEARS AND NEVER TOUCHES WHAT STAFF TYPED
// ---------------------------------------------------------------------------
const psH = sandbox.HEADERS.Program_Settings;
const psRow = (event, location, room) => {
  const r = new Array(psH.length).fill('');
  r[psH.indexOf('Event')] = event; r[psH.indexOf('Location')] = location; r[psH.indexOf('Room_Or_Setup')] = room;
  return r;
};
let PS_ROWS = [];
sandbox.readNotificationPolicyRows = () => {
  const out = {};
  PS_ROWS.forEach(r => { out[sandbox.notificationProgramKey ? sandbox.notificationProgramKey(r[0], r[1]) : r[0] + r[1]] = r; });
  return out;
};
function loadPsGrid() {
  // The tab as it stands: a heading, a defaults row, then programs.
  psTab.grid = {};
  const all = [['--- Chair & Gentle ---'], ['--- ⚙️ New-event defaults · Regular ---'].concat([]), ...PS_ROWS];
  all.forEach((row, i) => row.forEach((v, j) => { psTab.grid[key(3 + i, 1 + j)] = v; }));
}
{
  PS_ROWS = [psRow('Chair Yoga', 'Narberth', ''), psRow('Art', 'Narberth', R1)];
  // The staff-typed tables on the tab, and the rooms list
  const L = sandbox.L;
  tab.grid[key(3, L.ROOMS.startCol)] = 'Narberth'; tab.grid[key(3, L.ROOMS.startCol + 1)] = 'Social Hall';
  tab.grid[key(4, L.ROOMS.startCol)] = 'Narberth'; tab.grid[key(4, L.ROOMS.startCol + 1)] = 'Library';
  tab.grid[key(3, L.RULES.startCol)] = 'yoga'; tab.grid[key(3, L.RULES.startCol + 2)] = R1;
  calls.length = 0;
  sandbox.forgetRoomsList(); sandbox.forgetRoomKeywordRules();
  const sheet = sandbox.refreshRoomManagementTab(book);
  ok('the refresh returns the sheet', !!sheet);
  ok('it never calls clear()', !calls.some(c => c.op === 'clear'));
  const blocks = calls.filter(c => c.op === 'setValues' && c.c === L.PROGRAMS.startCol && c.r === 3);
  ok('the Programs block is ONE setValues from row 3', blocks.length === 1 && blocks[0].n >= 2 && blocks[0].w === 5);
  ok('Chair Yoga got the keyword room in Effective_Room',
    tab.grid[key(3, 4)] === R1 && tab.grid[key(4, 4)] === R1, JSON.stringify([tab.grid[key(3, 1)], tab.grid[key(3, 4)]]));
  const wroteStaffTables = calls.some(c => (c.op === 'setValues' || c.op === 'setValue') &&
    ((c.c >= L.RULES.startCol && c.r >= 3) || (c.c >= L.ROOMS.startCol && c.r >= 3) || (c.c >= L.ASSIGN.startCol && c.c < L.RULES.startCol - 1 && c.r === 3 && c.op === 'setValues')));
  ok('the rules, rooms and assign box are never written by a redraw', !wroteStaffTables);
  ok('the live Matches formula is set', calls.some(c => c.op === 'setFormula' && /COUNTIF/.test(c.f)));

  const merges = calls.filter(c => c.op === 'merge').length;
  calls.length = 0;
  sandbox.refreshRoomManagementTab(book);
  ok('the structure is written once, not on every refresh', calls.filter(c => c.op === 'merge').length === 0 && merges === 4,
    `first ${merges}, second ${calls.filter(c => c.op === 'merge').length}`);

  // A program that goes away leaves a blank, in the same single write.
  PS_ROWS = [psRow('Art', 'Narberth', R1)];
  calls.length = 0;
  sandbox.refreshRoomManagementTab(book);
  const shrunk = calls.filter(c => c.op === 'setValues' && c.c === L.PROGRAMS.startCol && c.r === 3)[0];
  ok('a shrinking list is padded over the old rows', shrunk && shrunk.n >= 2 && !tab.grid[key(4, 1)], JSON.stringify(shrunk));
}

// ---------------------------------------------------------------------------
// 3. A ROOM PICK WRITES THROUGH; APPLY ASKS FIRST
// ---------------------------------------------------------------------------
{
  PS_ROWS = [psRow('Chair Yoga', 'Narberth', ''), psRow('Gentle Yoga', 'Narberth', R2), psRow('Bingo', 'Narberth', '')];
  loadPsGrid();
  sandbox.forgetRoomsList();
  ok('writing a room finds the program past the headings', sandbox.writeProgramSettingsRoom_('Chair Yoga', 'Narberth', 'narberth: social hall') === true);
  const roomCol = psH.indexOf('Room_Or_Setup') + 1;
  ok('and stores the canonical label', psTab.grid[key(5, roomCol)] === R1, String(psTab.grid[key(5, roomCol)]));
  ok('an unknown program is reported, not invented', sandbox.writeProgramSettingsRoom_('Zumba', 'Narberth', R1) === false);
  ok('a blank clears the room', (sandbox.writeProgramSettingsRoom_('Chair Yoga', 'Narberth', ''), psTab.grid[key(5, roomCol)] === ''));
}
{
  // The handler: a Room cell edit on the tab.
  const L = sandbox.L;
  PS_ROWS = [psRow('Chair Yoga', 'Narberth', ''), psRow('Gentle Yoga', 'Narberth', R2), psRow('Bingo', 'Narberth', '')];
  loadPsGrid();
  tab.grid = {};
  tab.grid[key(3, L.ROOMS.startCol)] = 'Narberth'; tab.grid[key(3, L.ROOMS.startCol + 1)] = 'Social Hall';
  tab.grid[key(4, L.ROOMS.startCol)] = 'Narberth'; tab.grid[key(4, L.ROOMS.startCol + 1)] = 'Library';
  sandbox.forgetRoomsList(); sandbox.forgetRoomKeywordRules();
  sandbox.refreshRoomManagementTab(book);

  const written = [];
  const realWrite = sandbox.writeProgramSettingsRoom_;
  sandbox.writeProgramSettingsRoom_ = (e, l, v) => { written.push([e, l, v]); return true; };
  const edit = (r, c, n, w, value) => ({ range: makeRange(tab, r, c, n, w), value });

  // Pick a room for the first program row.
  tab.grid[key(3, 3)] = R1;
  written.length = 0; toasts.length = 0;
  sandbox.handleRoomManagementEdit(edit(3, 3, 1, 1), tab.sheet);
  ok('a Room pick writes through to Program_Settings', written.length === 1 && written[0][2] === R1 && written[0][0] === tab.grid[key(3, 1)],
    JSON.stringify(written));

  // Typing in a derived column writes nothing.
  written.length = 0;
  sandbox.handleRoomManagementEdit(edit(3, 4, 1, 1), tab.sheet);
  ok('typing over a derived cell saves nothing', written.length === 0);

  // Apply, declined.
  const A = L.ASSIGN.startCol;
  tab.grid[key(3, A)] = 'yoga'; tab.grid[key(3, A + 1)] = R1; tab.grid[key(3, A + 3)] = true;
  let asked = 0, answer = false;
  sandbox.confirmConsequentialAction = () => { asked++; return answer; };
  written.length = 0;
  sandbox.handleRoomManagementEdit(edit(3, A + 3, 1, 1), tab.sheet);
  ok('Apply asks once, and declined writes nothing', asked === 1 && written.length === 0);
  ok('declined un-ticks the box but keeps the keyword', tab.grid[key(3, A + 3)] === false && tab.grid[key(3, A)] === 'yoga');

  // Apply, accepted: Gentle Yoga is on the Library, Chair Yoga on nothing — both change.
  answer = true; tab.grid[key(3, A + 3)] = true;
  written.length = 0;
  sandbox.handleRoomManagementEdit(edit(3, A + 3, 1, 1), tab.sheet);
  ok('accepted, it writes every matching program', written.length === 2 && written.every(w => w[2] === R1) &&
    written.map(w => w[0]).sort().join() === 'Chair Yoga,Gentle Yoga', JSON.stringify(written));
  ok('and empties the box for the next one', tab.grid[key(3, A)] === undefined && tab.grid[key(3, A + 1)] === undefined && tab.grid[key(3, A + 3)] === false);

  // Apply with a room not on the list.
  tab.grid[key(3, A)] = 'yoga'; tab.grid[key(3, A + 1)] = 'the barn'; tab.grid[key(3, A + 3)] = true;
  written.length = 0; asked = 0;
  sandbox.handleRoomManagementEdit(edit(3, A + 3, 1, 1), tab.sheet);
  ok('an unlisted room is refused without asking', asked === 0 && written.length === 0 &&
    toasts.some(t => /not on the Rooms list/.test(t)));
  sandbox.writeProgramSettingsRoom_ = realWrite;
}

// ---------------------------------------------------------------------------
// 4. CONFIG'S OLD ROOMS SECTION IS CARRIED ACROSS ONCE
// ---------------------------------------------------------------------------
{
  const L = sandbox.L;
  tab.grid = {};
  cfg.grid = {};
  cfg.grid[key(3, 44)] = 'Narberth'; cfg.grid[key(3, 45)] = 'Old Hall';
  cfg.grid[key(4, 44)] = 'Ashbridge'; cfg.grid[key(4, 45)] = 'Annex';
  ok('an empty list takes the old section', sandbox.migrateConfigRoomsToTab_(book, tab.sheet) === 2 &&
    tab.grid[key(4, L.ROOMS.startCol + 1)] === 'Annex');
  tab.grid[key(3, L.ROOMS.startCol + 1)] = 'Edited Hall';
  ok('a list that has rooms is never overwritten', sandbox.migrateConfigRoomsToTab_(book, tab.sheet) === 0 &&
    tab.grid[key(3, L.ROOMS.startCol + 1)] === 'Edited Hall');
}

// ---------------------------------------------------------------------------
// 5. WIRING
// ---------------------------------------------------------------------------
{
  const names = [].concat.apply([], sandbox.TAB_GROUPS.map(g => g.names));
  ok('the tab is positioned and coloured with the setup tabs', names.indexOf('Room_Management') !== -1);
}

if (failures > 0) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall room management checks passed');
