// ============================================================================
// 99zx. THE ROOM MANAGEMENT TAB  (assign rooms live: dropdowns, keywords, one list)
// ============================================================================
//
// Numbered `99zx` for the usual reason — never renumber, and this landed last.
// Safe there: behavior plus one self-contained layout table. Everything it
// reaches for (`PALETTE`, `TYPO`, `HEADERS`, the Program_Settings readers, the
// room readers in `99zw`) it reads at CALL time or through a hoisted function
// declaration, so nothing is read from another file at load.
//
// WHAT IT IS. `99zw` detects a room wanted twice; this is where the rooms are
// SAID. One staff tab, `Room_Management`, four small tables side by side on
// Config's pattern (a section is keyed by COLUMN, so adding one never reflows
// another):
//
//   Programs → Room   one row per program on Program_Settings (Event, Location),
//                     a Room dropdown that is LIVE — picking one writes
//                     `Program_Settings`' `Room_Or_Setup` at once — and two
//                     derived cells beside it, `Effective_Room` and `Why`, that
//                     say what the program actually gets and from where. Rows
//                     are laid out by DATE, soonest first, with a blank row
//                     between one date and the next.
//   Assign by Keyword the one-off: type a word, pick a room, tick Apply. Every
//                     program whose title contains the word is given that room
//                     (after one confirmation naming them). `Matches` is a sheet
//                     FORMULA, so the count is live as you type, with no script.
//   Keyword Rules     the standing version: Keyword + optional Building + Room.
//                     A program with no room of its own gets the first rule (top
//                     to bottom) whose keyword its title contains — which is how
//                     a program the calendar adds NEXT month is placed without
//                     anybody touching it.
//   Rooms             the master list: Building + Room. It moved here from
//                     Config's Rooms section (`99zw` first put it there); an
//                     entry still on Config is carried across once, and read as
//                     a fallback until then (`readRoomsList`).
//
// WHO WINS. A room chosen for a program on its own row beats any keyword rule;
// a rule only fills a program that has no listed room. A program's
// `Room_Or_Setup` that is not on the Rooms list (this column has always allowed
// free text, "chairs in rows, projector") is not a room, so it does not block a
// rule — it is shown as `Not on the rooms list` when nothing else applies. A
// date's `Room_Override` on the session table beats all of it (`99zw`).
//
// ONE SOURCE OF TRUTH. The Room cell on this tab is NOT a second store: it is
// `Room_Or_Setup`, written through on edit and read back on every refresh, so
// a hand edit on Program_Settings shows up here and nothing can disagree. The
// derived cells (`Date`, `Event`, `Location`, `Effective_Room`, `Why`) are redrawn from
// Program_Settings and the rules on every refresh — typing over them is put
// right, and the header note says so.
//
// NEVER A CLEAR. The Programs block is written as ONE `setValues()` padded with
// blanks over the old range (`99u`'s rule: no tab is empty while it is being
// redrawn), and the other three tables are staff-typed and never rewritten by a
// refresh at all.
//
// WHERE IT RUNS. `refreshRoomManagementTab()` is called from `refreshMemoryTabs`
// (`40`, so once per sync tail step and whenever an edit moves the workbook's
// change generation), from every edit on this tab (`handleRoomManagementEdit`,
// wired into `onEdit`, `18`), and from `openRoomManagementTab()` (the
// Coordinator menu item). It never throws.
//
// `tests/room_management.test.js`.

/**
 * The four tables. Banner row 1, header row 2, data from row 3 — the same
 * three rows every memory tab and Config use. Self-contained, so a plain const.
 */
const ROOM_MANAGEMENT_LAYOUT = {
  PROGRAMS: { title: '🚪 Programs → Room', startCol: 1,
    headers: ['Date', 'Event', 'Location', 'Room', 'Effective_Room', 'Why'] },
  ASSIGN: { title: '⚡ Assign by Keyword (one-off)', startCol: 7,
    headers: ['Keyword', 'Room', 'Matches', 'Apply'] },
  RULES: { title: '📌 Keyword Rules (standing)', startCol: 12,
    headers: ['Keyword', 'Building', 'Room'] },
  ROOMS: { title: '🏢 Rooms (the master list)', startCol: 16,
    headers: ['Building', 'Room'] }
};
const ROOM_MANAGEMENT_BANNER_ROW = 1;
const ROOM_MANAGEMENT_HEADER_ROW = 2;
const ROOM_MANAGEMENT_DATA_ROW = 3;
/** Rows the two staff-typed lists are drawn with dropdowns for. */
const ROOM_MANAGEMENT_MAX_RULES = 60;
const ROOM_MANAGEMENT_MAX_ROOMS = 60;
/** Blank rows left under the programs so the next one a sync adds already has its dropdown. */
const ROOM_MANAGEMENT_SPARE_ROWS = 10;
/** Where Config's retired Rooms section stood (two columns: Building, Room). */
const LEGACY_CONFIG_ROOMS_START_COL = 44;

function roomManagementLastColumn_() {
  return Math.max.apply(null, Object.keys(ROOM_MANAGEMENT_LAYOUT).map(k =>
    ROOM_MANAGEMENT_LAYOUT[k].startCol + ROOM_MANAGEMENT_LAYOUT[k].headers.length - 1));
}

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

/** Does this program's title contain the keyword (case and spacing ignored)? */
function roomKeywordMatches_(title, keyword) {
  const k = roomKey_(keyword);
  return !!k && roomKey_(title).indexOf(k) !== -1;
}

/**
 * The first keyword rule that applies to a program, top to bottom, or null.
 * `rules` is `[{ keyword, building, room }]` with `room` already a label. A rule
 * with a building only applies to programs at that building.
 */
function keywordRuleFor_(title, location, rules) {
  const list = rules || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!roomKeywordMatches_(title, r.keyword)) continue;
    if (r.building && roomKey_(r.building) !== roomKey_(location)) continue;
    return r;
  }
  return null;
}

const ROOM_MANAGEMENT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 11/2" for a `yyyy-MM-dd` key — text on purpose, so Sheets never turns it into a date. */
function roomManagementDateLabel_(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return '';
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${ROOM_MANAGEMENT_DAY_NAMES[day]} ${Number(m[2])}/${Number(m[3])}`;
}

/**
 * The rows of the Programs table: `[Date, Event, Location, Room, Effective_Room, Why]`.
 * `programs` is `[{ event, location, room }]` with `room` the raw Room_Or_Setup.
 * `schedule` is `{ <notificationProgramKey>: [dateKey, ...] }`; only dates from
 * `todayKey` to `endKey` are drawn.
 *
 * Laid out like the other program tabs: by DATE, soonest first, every program
 * meeting that day under it (Location then Event), and one BLANK row between
 * one date and the next. A program therefore appears once per date it meets;
 * the Room cell is still the program's (`Room_Or_Setup`), so a pick on any of
 * its rows is the same pick. Programs with nothing in the window follow the
 * last date after a blank row with no Date, so none disappears from the tab.
 * With no schedule every program is in that last block (Location then Event).
 */
function buildRoomManagementProgramRows(programs, rooms, rules, schedule, todayKey, endKey) {
  const width = ROOM_MANAGEMENT_LAYOUT.PROGRAMS.headers.length;
  const byLocationEvent = (a, b) =>
    String(a.location).localeCompare(String(b.location)) || String(a.event).localeCompare(String(b.event));
  const rowFor = (p, dateLabel) => {
    const eff = effectiveDefaultRoom_(p.event, p.location, p.room, rooms, rules);
    let why = '';
    if (eff.source === 'program') why = 'Set here';
    else if (eff.source === 'keyword') why = `Keyword "${eff.rule.keyword}"`;
    else if (eff.source === 'unlisted') why = 'Not on the rooms list \u2014 not checked';
    return [dateLabel, p.event, p.location, p.room || '', eff.label, why];
  };

  const byDate = {};
  const scheduled = {};
  (programs || []).forEach(p => {
    const pk = notificationProgramKey(p.event, p.location);
    (schedule && schedule[pk] || []).forEach(k => {
      k = String(k);
      if (k < (todayKey || '') || (endKey && k > endKey)) return;
      const day = byDate[k] = byDate[k] || {};
      day[pk] = p;                       // twin sessions on one date are one row
      scheduled[pk] = true;
    });
  });

  const rows = [];
  const blank = () => { if (rows.length) rows.push(new Array(width).fill('')); };
  Object.keys(byDate).sort().forEach(k => {
    blank();
    Object.keys(byDate[k]).map(pk => byDate[k][pk]).sort(byLocationEvent)
      .forEach(p => rows.push(rowFor(p, roomManagementDateLabel_(k))));
  });
  const rest = (programs || []).filter(p => !scheduled[notificationProgramKey(p.event, p.location)])
    .sort(byLocationEvent);
  if (rest.length) { blank(); rest.forEach(p => rows.push(rowFor(p, ''))); }
  return rows;
}

/**
 * What an Apply would do, decided before anything is written.
 * Returns `{ ok, error, room, matches, changes }`: `matches` every program whose
 * title contains the keyword, `changes` those not already on that room.
 */
function planBulkRoomAssign(programs, keyword, roomRaw, rooms) {
  const kw = String(keyword == null ? '' : keyword).trim();
  if (!kw) return { ok: false, error: 'Type a keyword first.', matches: [], changes: [] };
  const room = resolveRoomLabel_(roomRaw, rooms);
  if (!room) {
    return { ok: false, matches: [], changes: [],
      error: String(roomRaw || '').trim()
        ? `"${String(roomRaw).trim()}" is not on the Rooms list — pick one from the dropdown.`
        : 'Pick a room first.' };
  }
  const matches = (programs || []).filter(p => roomKeywordMatches_(p.event, kw));
  if (matches.length === 0) {
    return { ok: false, error: `No program has "${kw}" in its title.`, room, matches, changes: [] };
  }
  const changes = matches.filter(p => resolveRoomLabel_(p.room, rooms) !== room);
  return { ok: true, error: '', room, matches, changes };
}

// ---------------------------------------------------------------------------
// Reading the rest of the workbook
// ---------------------------------------------------------------------------

/** Every program on Program_Settings, as `[{ event, location, room }]`. Never throws. */
function readRoomManagementPrograms_() {
  const out = [];
  try {
    const headers = HEADERS.Program_Settings;
    const map = getIndexMap(headers);
    const index = readNotificationPolicyRows();
    Object.keys(index).forEach(key => {
      const row = index[key];
      out.push({
        event: String(row[map['Event']] || '').trim(),
        location: String(row[map['Location']] || '').trim(),
        room: String(row[map['Room_Or_Setup']] || '').trim()
      });
    });
  } catch (err) {
    log(`ℹ️ Could not read the programs for ${SHEET_NAMES.ROOM_MANAGEMENT} (${err}).`);
  }
  return out;
}

/**
 * Every program's session dates from the session table, as
 * `{ <notificationProgramKey>: [yyyy-MM-dd, ...] }` — upcoming only, since the
 * Day column and the order are about what is next. Never throws.
 */
function readRoomManagementSchedule_(todayKey) {
  const out = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
    if (!sheet) return out;
    const headers = HEADERS.All_Program_Sessions;
    const map = getIndexMap(headers);
    getSectionedRowValues(sheet, headers, 'Event_ID').forEach(row => {
      const start = coerceDate(row[map['Event_Date']]);
      if (!start) return;
      const key = formatDateKey(start);
      if (key < todayKey) return;
      const pk = notificationProgramKey(String(row[map['Clean_Title']] || '').trim(),
        String(row[map['Location']] || '').trim());
      (out[pk] = out[pk] || []).push(key);
    });
  } catch (err) {
    log(`ℹ️ Could not read the session days for ${SHEET_NAMES.ROOM_MANAGEMENT} (${err}) — ordered by location.`);
  }
  return out;
}

/**
 * Writes one program's room onto Program_Settings' `Room_Or_Setup` — the one
 * store — and drops the memo that reads it. A blank clears it. Returns true if
 * a row was found. A value that names a listed room is written as its canonical
 * label; anything else is written as typed (the column allows free text).
 */
function writeProgramSettingsRoom_(event, location, value) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS) : null;
  if (!sheet) return false;
  const last = sheet.getLastRow();
  if (last < MEMORY_TAB_DATA_ROW) return false;
  // The static order, as readNotificationPolicyRows() reads the same tab by.
  const headerMap = getIndexMap(HEADERS.Program_Settings);
  if (headerMap['Event'] === undefined || headerMap['Location'] === undefined ||
      headerMap['Room_Or_Setup'] === undefined) return false;
  const width = Math.max(headerMap['Event'], headerMap['Location'], headerMap['Room_Or_Setup']) + 1;
  const wanted = notificationProgramKey(event, location);
  const rows = sheet.getRange(MEMORY_TAB_DATA_ROW, 1, last - MEMORY_TAB_DATA_ROW + 1, width).getValues();
  const typed = String(value == null ? '' : value).trim();
  const stored = resolveRoomLabel_(typed, readRoomsList()) || typed;
  let written = false;
  rows.forEach((row, i) => {
    if (isMemoryTabDividerValue(row[headerMap['Event']])) return;
    if (notificationProgramKey(row[headerMap['Event']], row[headerMap['Location']]) !== wanted) return;
    sheet.getRange(MEMORY_TAB_DATA_ROW + i, headerMap['Room_Or_Setup'] + 1).setValue(stored);
    written = true;
  });
  invalidateNotificationPolicyCache();
  return written;
}

/** One-time: carries Config's retired Rooms section onto this tab's list if the list is empty. */
function migrateConfigRoomsToTab_(ss, sheet) {
  try {
    const section = ROOM_MANAGEMENT_LAYOUT.ROOMS;
    const lastData = sheet.getLastRow();
    if (lastData >= ROOM_MANAGEMENT_DATA_ROW) {
      const have = sheet.getRange(ROOM_MANAGEMENT_DATA_ROW, section.startCol,
        lastData - ROOM_MANAGEMENT_DATA_ROW + 1, 2).getValues();
      if (have.some(r => String(r[1] || '').trim())) return 0;
    }
    const legacy = readLegacyConfigRooms_();
    if (legacy.length === 0) return 0;
    sheet.getRange(ROOM_MANAGEMENT_DATA_ROW, section.startCol, legacy.length, 2)
      .setValues(legacy.map(r => [r.building, r.room]));
    log(`Carried ${legacy.length} room(s) from Config's old Rooms section onto ${SHEET_NAMES.ROOM_MANAGEMENT}.`);
    forgetRoomsList();
    return legacy.length;
  } catch (err) {
    log(`ℹ️ Could not carry Config's rooms across (${err}) — they are still read from there.`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Drawing the tab
// ---------------------------------------------------------------------------

/**
 * Brings the tab up to date: structure once, then the Programs block, the
 * dropdowns and the Matches formula. Never throws; returns the sheet or null.
 */
function refreshRoomManagementTab(ss) {
  try {
    const book = ss || SpreadsheetApp.getActiveSpreadsheet();
    if (!book) return null;
    const sheet = getOrCreateSheet(book, SHEET_NAMES.ROOM_MANAGEMENT);
    ensureSheetColumns(sheet, roomManagementLastColumn_());
    writeRoomManagementStructure_(sheet);
    migrateConfigRoomsToTab_(book, sheet);
    forgetRoomsList();
    forgetRoomKeywordRules();

    const rooms = readRoomsList();
    const rules = readRoomKeywordRules();
    const programs = readRoomManagementPrograms_();
    const todayKey = formatDateKey(new Date());
    const rows = buildRoomManagementProgramRows(programs, rooms, rules,
      readRoomManagementSchedule_(todayKey), todayKey, deskMonthHorizonKey());

    const sec = ROOM_MANAGEMENT_LAYOUT.PROGRAMS;
    const width = sec.headers.length;
    const old = Math.max(sheet.getLastRow() - ROOM_MANAGEMENT_DATA_ROW + 1, 0);
    const span = Math.max(rows.length, old);
    if (span > 0) {
      const block = rows.slice();
      while (block.length < span) block.push(new Array(width).fill(''));
      // ONE write over the old range, blanks included — never a clear().
      sheet.getRange(ROOM_MANAGEMENT_DATA_ROW, sec.startCol, span, width).setValues(block);
    }
    applyRoomManagementDropdowns_(sheet, rooms, rows.length);
    return sheet;
  } catch (err) {
    log(`⚠️ Could not refresh ${SHEET_NAMES.ROOM_MANAGEMENT} (${err}).`);
    return null;
  }
}

/** Banners, headers, notes and the Matches formula — written only when the header row is not already right. */
function writeRoomManagementStructure_(sheet) {
  const keys = Object.keys(ROOM_MANAGEMENT_LAYOUT);
  const lastCol = roomManagementLastColumn_();
  const current = sheet.getRange(ROOM_MANAGEMENT_HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const upToDate = keys.every(k => {
    const s = ROOM_MANAGEMENT_LAYOUT[k];
    return s.headers.every((h, i) => String(current[s.startCol - 1 + i] || '') === h);
  });
  if (upToDate) return;

  keys.forEach(k => {
    const s = ROOM_MANAGEMENT_LAYOUT[k];
    const span = s.headers.length;
    const banner = sheet.getRange(ROOM_MANAGEMENT_BANNER_ROW, s.startCol, 1, span);
    try { banner.breakApart(); } catch (err) { /* not previously merged */ }
    banner.merge().setValue(s.title)
      .setFontSize(TYPO.BANNER.size).setFontWeight(TYPO.BANNER.weight).setFontColor(TYPO.BANNER.color)
      .setBackground(TYPO.BANNER.background).setHorizontalAlignment('left').setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sheet.getRange(ROOM_MANAGEMENT_HEADER_ROW, s.startCol, 1, span).setValues([s.headers])
      .setFontSize(TYPO.COLUMN_HEADER.size).setFontWeight(TYPO.COLUMN_HEADER.weight)
      .setBackground(TYPO.COLUMN_HEADER.background).setFontColor(TYPO.COLUMN_HEADER.color);
  });

  const L = ROOM_MANAGEMENT_LAYOUT;
  const note = (sec, header, text) => {
    try { sheet.getRange(ROOM_MANAGEMENT_HEADER_ROW, L[sec].startCol + L[sec].headers.indexOf(header)).setNote(text); }
    catch (err) { /* a note is a courtesy */ }
  };
  note('PROGRAMS', 'Event', 'One row per program per date. Date, Event, Location, Effective_Room and Why are redrawn ' +
    'from the workbook on every refresh — type in Room only.');
  note('PROGRAMS', 'Room', 'Pick this program\'s usual room. This IS Program_Settings\' Room_Or_Setup: choosing one saves it ' +
    'there at once. Blank = let a keyword rule decide. A single date that moves rooms goes on the session table\'s Room_Override.');
  note('PROGRAMS', 'Date', 'Upcoming dates through the end of next month, soonest first, a blank row between days. A program ' +
    'is listed under every date it meets; its Room is the same on each. Programs with nothing coming up are at the bottom.');
  note('PROGRAMS', 'Effective_Room', 'What the program actually gets: its own room, else the first matching keyword rule.');
  note('ASSIGN', 'Keyword', 'Type a word that appears in program titles, pick a room, then tick Apply. Every matching ' +
    'program is set to that room after one confirmation. Matches counts them as you type.');
  note('RULES', 'Keyword', 'Standing rules, top to bottom \u2014 first match wins. A program with no room of its own gets ' +
    'the room of the first rule whose keyword its title contains, including programs added later.');
  note('RULES', 'Building', 'Optional. Leave blank to apply at every building.');
  note('ROOMS', 'Room', 'The master list. A room must be here to be offered in the dropdowns or checked for double-booking.');

  // The live match count: a formula, so it needs no script to stay current.
  const a = L.ASSIGN;
  const kw = columnLetter_(a.startCol);
  sheet.getRange(ROOM_MANAGEMENT_DATA_ROW, a.startCol + 2).setFormula(
    `=IF(${kw}${ROOM_MANAGEMENT_DATA_ROW}="","",IFERROR(ROWS(UNIQUE(FILTER($B$${ROOM_MANAGEMENT_DATA_ROW}:$B$1000&"|"&$C$${ROOM_MANAGEMENT_DATA_ROW}:$C$1000,` +
    `$B$${ROOM_MANAGEMENT_DATA_ROW}:$B$1000<>"",ISNUMBER(SEARCH(${kw}${ROOM_MANAGEMENT_DATA_ROW},$B$${ROOM_MANAGEMENT_DATA_ROW}:$B$1000))))),0)&" program(s)")`);
  try { sheet.setFrozenRows(ROOM_MANAGEMENT_HEADER_ROW); } catch (err) { /* frozen across a merge */ }
}

/** 1 -> A, 7 -> G. */
function columnLetter_(col) {
  let n = col, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Dropdowns, ticks and the staff wash. Validations are set per table, bounded. */
function applyRoomManagementDropdowns_(sheet, rooms, programCount) {
  const L = ROOM_MANAGEMENT_LAYOUT;
  const labels = rooms.map(r => r.label);
  const buildings = Object.keys(CALENDAR_MAP).map(id => CALENDAR_MAP[id]);
  const programSpan = programCount + ROOM_MANAGEMENT_SPARE_ROWS;
  const row = ROOM_MANAGEMENT_DATA_ROW;

  // Programs' Room: SUGGESTING, because Room_Or_Setup has always allowed free text.
  applyOpenValueListValidationBounded(sheet, L.PROGRAMS.startCol + 3, labels, row, programSpan);
  // The one-off and the rules: closed, so a typo cannot silently match nothing.
  applyValueListValidationBounded(sheet, L.ASSIGN.startCol + 1, labels, row, 1);
  applyCheckboxValidationBounded(sheet, L.ASSIGN.startCol + 3, row, 1);
  applyValueListValidationBounded(sheet, L.RULES.startCol + 1, buildings, row, ROOM_MANAGEMENT_MAX_RULES);
  applyValueListValidationBounded(sheet, L.RULES.startCol + 2, labels, row, ROOM_MANAGEMENT_MAX_RULES);
  applyValueListValidationBounded(sheet, L.ROOMS.startCol, buildings, row, ROOM_MANAGEMENT_MAX_ROOMS);

  try {
    const tint = MANUAL_ENTRY_CELL_TINT;
    sheet.getRange(row, L.PROGRAMS.startCol + 3, programSpan, 1).setBackground(tint);
    sheet.getRange(row, L.ASSIGN.startCol, 1, 2).setBackground(tint);
    sheet.getRange(row, L.ASSIGN.startCol + 3, 1, 1).setBackground(tint).setHorizontalAlignment('center');
    sheet.getRange(row, L.RULES.startCol, ROOM_MANAGEMENT_MAX_RULES, 3).setBackground(tint);
    sheet.getRange(row, L.ROOMS.startCol, ROOM_MANAGEMENT_MAX_ROOMS, 2).setBackground(tint);
  } catch (err) {
    log(`ℹ️ Could not wash ${SHEET_NAMES.ROOM_MANAGEMENT}'s typing cells (${err}) — the tab is otherwise fine.`);
  }
}

// ---------------------------------------------------------------------------
// Editing live
// ---------------------------------------------------------------------------

/**
 * `onEdit` (`18`) for this tab. A Room pick writes through to Program_Settings;
 * the Apply tick runs the one-off assignment; an edit to the rules or the rooms
 * list just redraws so Effective_Room follows. Anything typed over a derived
 * cell is put right by the redraw. Never throws into onEdit.
 */
function handleRoomManagementEdit(e, sheet) {
  const L = ROOM_MANAGEMENT_LAYOUT;
  const row = e.range.getRow();
  if (row < ROOM_MANAGEMENT_DATA_ROW) return;
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  const numRows = e.range.getNumRows();
  const touches = (sec, offset) => {
    const c = L[sec].startCol + (offset || 0);
    const end = offset === undefined ? L[sec].startCol + L[sec].headers.length - 1 : c;
    return firstCol <= end && lastCol >= c;
  };

  forgetRoomsList();
  forgetRoomKeywordRules();
  invalidateNotificationPolicyCache();
  const ss = sheet.getParent ? sheet.getParent() : SpreadsheetApp.getActiveSpreadsheet();

  if (touches('ASSIGN', 3) && row === ROOM_MANAGEMENT_DATA_ROW && numRows === 1) {
    if (e.range.getValue() === true) runRoomBulkAssign_(sheet, ss);
    return;
  }

  if (touches('PROGRAMS', 3)) {
    const block = sheet.getRange(row, L.PROGRAMS.startCol, numRows, 4).getValues();
    let saved = 0;
    block.forEach(r => {
      if (!String(r[1] || '').trim()) return;
      if (writeProgramSettingsRoom_(r[1], r[2], r[3])) saved++;
    });
    toastIfPossible(saved > 0
      ? `🚪 Room saved for ${saved} program(s).`
      : 'That row is not a program on Program_Settings, so nothing was saved.');
  } else if (touches('PROGRAMS')) {
    toastIfPossible('That column is worked out from the workbook — type in Room to change a program\'s room.');
  } else if (touches('RULES')) {
    const typed = String(sheet.getRange(row, L.RULES.startCol + 2).getValue() || '').trim();
    if (typed && !resolveRoomLabel_(typed, readRoomsList())) {
      toastIfPossible(`⚠️ "${typed}" is not on the Rooms list, so that rule is ignored until it is.`);
    }
  }
  refreshRoomManagementTab(ss);
}

/** The Apply tick: plan, confirm, write through, clear the box. */
function runRoomBulkAssign_(sheet, ss) {
  const L = ROOM_MANAGEMENT_LAYOUT;
  const a = L.ASSIGN;
  const row = ROOM_MANAGEMENT_DATA_ROW;
  const untick = () => { try { sheet.getRange(row, a.startCol + 3).setValue(false); } catch (err) { /* gone */ } };
  const keyword = sheet.getRange(row, a.startCol).getValue();
  const roomRaw = sheet.getRange(row, a.startCol + 1).getValue();
  const rooms = readRoomsList();
  const plan = planBulkRoomAssign(readRoomManagementPrograms_(), keyword, roomRaw, rooms);
  if (!plan.ok) {
    untick();
    toastIfPossible(`⚠️ ${plan.error}`);
    return;
  }
  const list = plan.matches.slice(0, 10).map(p => `• ${p.event} (${p.location})`).join('\n');
  const more = plan.matches.length > 10 ? `\n…and ${plan.matches.length - 10} more` : '';
  const already = plan.matches.length - plan.changes.length;
  const detail = `Set the room for ${plan.matches.length} program(s) with "${String(keyword).trim()}" in the title to ` +
    `${plan.room}?\n\n${list}${more}` +
    (already > 0 ? `\n\n${already} already have it.` : '') +
    `\n\nA room set here replaces whatever those programs have now.`;
  if (!confirmConsequentialAction('Assign room by keyword', detail, false)) {
    untick();
    return;
  }
  let written = 0;
  plan.changes.forEach(p => { if (writeProgramSettingsRoom_(p.event, p.location, plan.room)) written++; });
  sheet.getRange(row, a.startCol, 1, 2).clearContent();
  untick();
  refreshRoomManagementTab(ss);
  toastIfPossible(`🚪 ${plan.room}: ${written} program(s) updated, ${already} already there.`);
}

/** Coordinator menu: make sure the tab exists and is current, then go to it. */
function openRoomManagementTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = refreshRoomManagementTab(ss);
  if (!sheet) { toastIfPossible('Could not open the Room Management tab — see the log.'); return; }
  ss.setActiveSheet(sheet);
  toastIfPossible('🚪 Room Management — pick a room per program, or type a keyword to place many at once.');
}
