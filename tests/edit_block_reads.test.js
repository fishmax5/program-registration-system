// A FILL-DOWN IS ONE EDIT, NOT THREE HUNDRED READS.
//
// onEdit fires once for the whole range somebody dragged, and the handlers
// underneath it have to know two or three things about each row in it before
// they can decide whether that row is a target: the program's title, its
// calendar, its date, the state the box now shows. Each of those was a
// getRange().getValue() — one round trip per cell — so ticking a box down a
// column of three hundred sessions was the better part of a thousand of them,
// with somebody watching the sheet and waiting for the confirmation dialog.
//
// readEditedBlock() reads the block once. This pins the two halves of that:
//
//   1. THE ANSWERS ARE THE SAME. The targets a handler collects from the block
//      are the targets it collected cell by cell — the same rows, the same
//      titles, the same tick states, the same de-duplication down to one entry
//      per program.
//   2. THE FALLBACK STILL WORKS. A block read that will not go through (a tab
//      mid-rebuild, a range past the grid) drops back to the per-cell reads it
//      replaced, because those are slower and always worked.
//
// Nothing in this suite exercised these handlers at all before, which is the
// other reason it exists: they are reached only from onEdit, and onEdit is the
// one entry point a test never takes by accident.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 9, 9, 0, 0).getTime();

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  },
  Utilities: {
    formatDate: (d, tz, pattern) =>
      (pattern === 'yyyy-MM-dd' ? new RealDate(d).toISOString().slice(0, 10) : new RealDate(d).toISOString()),
    sleep: () => {}, getUuid: () => 'u', computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null, getActive: () => null,
    getUi: () => { throw new Error('no ui'); }, flush: () => {}
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.readEditedBlock = readEditedBlock;
this.handleProgramFlagEdit = handleProgramFlagEdit;
this.handleWaitlistOnlyEdit = handleWaitlistOnlyEdit;
this.PROGRAM_FLAG_COLUMNS = PROGRAM_FLAG_COLUMNS;
this.__stubSpread = function (fn) { spreadFlagToSiblingRows = fn; };
this.__stubRecord = function (fn) { recordPendingProgramFlag = fn; };
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.toastIfPossible = () => {};

const headers = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(headers);
// headerMap here is the 0-based index map the handlers are given.
const headerMap = map;

// --- a sheet that counts what it was asked to read --------------------------
function makeSheet(rows, firstDataRow, options) {
  options = options || {};
  const reads = { blocks: 0, cells: 0 };
  return {
    reads,
    getName: () => 'All_Program_Sessions',
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => {
        if (options.blockReadThrows) throw new Error('the tab is mid-rebuild');
        reads.blocks++;
        const out = [];
        for (let r = 0; r < (numRows || 1); r++) {
          const line = rows[row - firstDataRow + r] || new Array(headers.length).fill('');
          out.push(line.slice(0, numCols || 1));
        }
        return out;
      },
      getValue: () => {
        reads.cells++;
        const line = rows[row - firstDataRow] || [];
        const v = line[(col || 1) - 1];
        return v === undefined ? '' : v;
      }
    })
  };
}

function sessionRow(fields) {
  const row = new Array(headers.length).fill('');
  Object.keys(fields).forEach(h => { row[map[h]] = fields[h]; });
  return row;
}

// Three programs, four weekly sessions each, all with the Club box now ticked.
const FIRST_DATA_ROW = 4;
const PROGRAMS = ['Chair Yoga', 'Book Club', 'Tai Chi'];
const rows = [];
PROGRAMS.forEach(title => {
  for (let w = 0; w < 4; w++) {
    rows.push(sessionRow({
      Clean_Title: title,
      Calendar_Source: 'ashbridge@example.com',
      Event_Date: new RealDate(2026, 8, 15 + w * 7, 10, 0),
      Club: true,
      Waitlist_Only: true
    }));
  }
});

const zones = [{ dataStart: FIRST_DATA_ROW, dataEnd: FIRST_DATA_ROW + rows.length - 1 }];
// isRowInAnyDataZone() reads {dataStart, dataEnd} — mirror what getSectionZones
// hands the handlers.
const inZone = row => row >= FIRST_DATA_ROW && row <= FIRST_DATA_ROW + rows.length - 1;
sandbox.isRowInAnyDataZone = (z, row) => inZone(row);

function editEvent(sheet, col1Based, numRows) {
  return {
    range: {
      getRow: () => FIRST_DATA_ROW,
      getColumn: () => col1Based,
      getNumRows: () => numRows,
      getNumColumns: () => 1
    }
  };
}

// ---------------------------------------------------------------------------
// 1. THE PROGRAM FLAG: one block read, one target per PROGRAM
// ---------------------------------------------------------------------------
{
  const clubFlag = sandbox.PROGRAM_FLAG_COLUMNS.find(f => f.column === 'Club');
  assert.ok(clubFlag, 'the Club flag is a program flag');

  const recorded = [];
  sandbox.__stubRecord((column, calendarId, title, on) => recorded.push({ column, calendarId, title, on }));
  sandbox.__stubSpread(() => 0);

  const sheet = makeSheet(rows, FIRST_DATA_ROW);
  const handled = sandbox.handleProgramFlagEdit(
    editEvent(sheet, map['Club'] + 1, rows.length), sheet, zones, headerMap, clubFlag);

  assert.strictEqual(handled, true, 'the edit was claimed by the flag handler');
  assert.deepStrictEqual(recorded.map(r => r.title).sort(), PROGRAMS.slice().sort(),
    'one entry per PROGRAM, not one per session row');
  assert.ok(recorded.every(r => r.on === true), 'each carries the state the box now shows');
  assert.strictEqual(sheet.reads.cells, 0, 'no cell was read one at a time');
  assert.strictEqual(sheet.reads.blocks, 1,
    `a fill-down over ${rows.length} rows is ONE read, not three per row`);
}

// ---------------------------------------------------------------------------
// 2. THE SESSION FLAG: one target per DATE, and the date read from the block
// ---------------------------------------------------------------------------
{
  const recorded = [];
  sandbox.__stubRecord((column, calendarId, title, on, dateKey) =>
    recorded.push({ title, on, dateKey }));

  const sheet = makeSheet(rows, FIRST_DATA_ROW);
  const handled = sandbox.handleWaitlistOnlyEdit(
    editEvent(sheet, map['Waitlist_Only'] + 1, rows.length), sheet, zones, headerMap);

  assert.strictEqual(handled, true);
  assert.strictEqual(recorded.length, rows.length,
    'a per-DATE flag is one entry per session row, unlike the program flag above');
  assert.ok(recorded.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.dateKey)),
    'each carries the date it read out of the block');
  assert.strictEqual(sheet.reads.cells, 0, 'and none of it was read a cell at a time');
  assert.strictEqual(sheet.reads.blocks, 1);
}

// ---------------------------------------------------------------------------
// 3. A BLOCK READ THAT WILL NOT GO THROUGH FALLS BACK TO CELLS
// ---------------------------------------------------------------------------
{
  const recorded = [];
  sandbox.__stubRecord((column, calendarId, title, on) => recorded.push({ title, on }));
  sandbox.__stubSpread(() => 0);

  const sheet = makeSheet(rows, FIRST_DATA_ROW, { blockReadThrows: true });
  const clubFlag = sandbox.PROGRAM_FLAG_COLUMNS.find(f => f.column === 'Club');
  const handled = sandbox.handleProgramFlagEdit(
    editEvent(sheet, map['Club'] + 1, rows.length), sheet, zones, headerMap, clubFlag);

  assert.strictEqual(handled, true, 'the handler still did its job');
  assert.deepStrictEqual(recorded.map(r => r.title).sort(), PROGRAMS.slice().sort(),
    'with the same answers it would have given from a block');
  assert.ok(sheet.reads.cells > 0, 'read a cell at a time, which is what the fallback is');
}

// ---------------------------------------------------------------------------
// 4. THE READER ITSELF
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet(rows, FIRST_DATA_ROW);
  const at = sandbox.readEditedBlock(sheet, FIRST_DATA_ROW, 3, [map['Clean_Title'] + 1]);
  assert.strictEqual(at(FIRST_DATA_ROW, map['Clean_Title'] + 1), 'Chair Yoga');
  assert.strictEqual(at(FIRST_DATA_ROW + 2, map['Clean_Title'] + 1), 'Chair Yoga');
  assert.strictEqual(at(FIRST_DATA_ROW, 0), '', 'a column the caller has not got answers blank');
  assert.strictEqual(at(FIRST_DATA_ROW, 999), '', 'and so does one past the block');
  assert.strictEqual(at(FIRST_DATA_ROW + 50, map['Clean_Title'] + 1), '',
    'a row past the block answers blank rather than throwing');
}

console.log('✅ edit_block_reads.test.js passed');
