// ============================================================================
// HOW MANY TIMES DOES A SYNC ASK THE SHEET?
// ============================================================================
//
// The reconcile phase of a calendar sync — the six passes importCalendarGroups()
// runs over the session table before it touches a single form — is where this
// project spends its round trips. Each pass located the tab's header rows (a
// read of the WHOLE grid), read its header row, then read three to nine single
// columns per section zone, and wrote back a column at a time. Six passes doing
// that against one tab is the cost, and it is invisible: every one of them is
// correct, fast in isolation, and indifferent to the five beside it.
//
// This driver makes the number visible. It builds a session table of a
// believable size, runs the real passes against a counting stub
// (tests/helpers/counting_sheet.js), and prints the round trips. Run it before
// and after a change:
//
//     node tools/sync_bench.js
//
// It is a MEASUREMENT, not a test — it asserts nothing and is not part of the
// test suite. What keeps the optimized path honest about VALUES is
// tests/reconcile_batching.test.js beside it, which runs the same passes and
// checks the cells they land on.
// ============================================================================
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const { readSource } = require(path.join(ROOT, 'tests', 'helpers', 'source'));
const { makeCountingSheet, roundTrips } = require(path.join(ROOT, 'tests', 'helpers', 'counting_sheet'));

const NOW = new Date(2026, 8, 9, 9, 0, 0); // Wed 9 Sep 2026
const RealDate = Date;
const pad = n => String(n).padStart(2, '0');

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return d.toISOString();
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: (() => {
    const store = {};
    const props = {
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); return props; },
      deleteProperty: k => { delete store[k]; return props; },
      getProperties: () => Object.assign({}, store)
    };
    return { getScriptProperties: () => props, getUserProperties: () => props };
  })(),
  // Defined before the project is evaluated: TIMEZONE is a top-level const
  // that asks the active spreadsheet for its time zone at load.
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    flush: () => {}
  },
  FormApp: { ItemType: {}, openById: () => { throw new Error('no form'); } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.reconcileProgramFlagColumns = reconcileProgramFlagColumns;
this.reconcileSessionFlagColumns = reconcileSessionFlagColumns;
this.reconcileSessionTimesFromCalendar = reconcileSessionTimesFromCalendar;
this.reconcileAssistanceSessionSettings = reconcileAssistanceSessionSettings;
this.applyNoRegistrationEffects = applyNoRegistrationEffects;
this.updateRegistrationLinkCells = updateRegistrationLinkCells;
this.buildFormIdByProgram = buildFormIdByProgram;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.withSessionGrid = (typeof withSessionGrid === 'function') ? withSessionGrid : null;
this.getSectionedRows = getSectionedRows;
this.findProgramSessionHeaderRows = findProgramSessionHeaderRows;
this.getHeaderMapAt = getHeaderMapAt;
this.recomputeEventRegistryCounts = recomputeEventRegistryCounts;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const HEADERS = sandbox.HEADERS.All_Program_Sessions;
const col = name => HEADERS.indexOf(name);

// --- the workbook this is measured against ---------------------------------
//
// Eight programs across two calendars, meeting weekly, half of them already in
// the past: a centre that has been running this system for a few months, which
// is the smallest workbook where the cost is worth anything.
const CALENDARS = ['ashbridge@example.com', 'narberth@example.com'];
const PROGRAMS = ['Chair Yoga', 'Book Club', 'Tai Chi', 'Watercolours',
  'Current Events', 'Beginner Bridge', 'Gentle Movement', 'Computer Help'];

function makeEvent(start, end, description) {
  return {
    getStartTime: () => start,
    getEndTime: () => end,
    isAllDayEvent: () => false,
    getDescription: () => description || '',
    setDescription: () => {},
    getId: () => `${start.getTime()}`
  };
}

/** The session rows, and the groups a calendar read would have produced for them. */
function buildWorkbook() {
  const upcoming = [];
  const past = [];
  const groups = [];

  CALENDARS.forEach(calendarId => {
    PROGRAMS.forEach((title, p) => {
      const sessions = [];
      const events = [];
      // Thirteen weeks back and thirteen forward, one program at a time.
      for (let w = -13; w <= 13; w++) {
        const date = new RealDate(2026, 8, 9 + w * 7, 10 + (p % 4), 0);
        const end = new RealDate(date.getTime() + 90 * 60000);
        const ev = makeEvent(date, end, '');
        const row = new Array(HEADERS.length).fill('');
        row[col('Event_Date')] = date;
        row[col('Event_End')] = end;
        row[col('Location')] = calendarId === CALENDARS[0] ? 'Ashbridge' : 'Narberth';
        row[col('Clean_Title')] = title;
        row[col('Calendar_Source')] = calendarId;
        row[col('Event_ID')] = `${calendarId}|${title}|${w}`;
        row[col('Type_Tag')] = 'Regular';
        row[col('Club')] = false;
        row[col('No_Registration')] = false;
        row[col('Personalized_Assistance')] = false;
        row[col('Waitlist_Only')] = false;
        row[col('Active_Count')] = 4;
        row[col('Max_Capacity')] = 12;
        row[col('Remaining_Seats')] = 8;
        row[col('Status')] = '🟢 Open';
        row[col('Form_ID')] = `form-${p}`;
        row[col('Form_Response_Link')] = '=HYPERLINK("https://forms/x","View Live Form")';
        row[col('Edit_Form_Link')] = '=HYPERLINK("https://forms/e","Edit Form Settings")';
        (w >= 0 ? upcoming : past).push(row);
        sessions.push({ calendarId, event: ev, waitlistOnly: false });
        events.push(ev);
      }
      groups.push({
        groupKey: `${calendarId}::${title}::2026-09`,
        cleanTitle: title, scope: calendarId, locations: [calendarId],
        sessions, events,
        isClub: false, noRegistration: false, isAssistance: false, isShared: false,
        statedCapacity: 12, slotMinutes: 0
      });
    });
  });

  // The tab as it actually sits: a banner, the Upcoming table, then the Past
  // one under its own header row — which is why every pass below loops zones.
  const header = HEADERS.slice();
  const blank = new Array(HEADERS.length).fill('');
  const grid = [['All Program Sessions'], ['Upcoming'], header]
    .concat(upcoming)
    .concat([blank.slice()], [['Past']], [header.slice()])
    .concat(past);

  return { grid, groups, rows: upcoming.length + past.length };
}

function run(label) {
  const { grid, groups, rows } = buildWorkbook();
  const sheet = makeCountingSheet(grid, 'All_Program_Sessions');
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: name => (name === 'All_Program_Sessions' ? sheet : null),
    toast: () => {}, getSheets: () => [sheet]
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;
  sandbox.SpreadsheetApp.flush = () => {};

  console.log(`\n${label}`);
  console.log(`${rows} session rows, two zones, ${HEADERS.length} columns\n`);
  console.log('  pass                                   reads  writes  cells r/w');
  console.log('  ' + '-'.repeat(66));

  let prev = Object.assign({}, sheet.stats);
  const report = name => {
    const s = sheet.stats;
    const reads = (s.getValues - prev.getValues) + (s.getFormulas - prev.getFormulas) +
      (s.getLastRow - prev.getLastRow) + (s.getLastColumn - prev.getLastColumn);
    const writes = (s.setValues - prev.setValues) + (s.setValue - prev.setValue);
    console.log(`  ${name.padEnd(38)}${String(reads).padStart(5)}${String(writes).padStart(8)}` +
      `  ${s.cellsRead - prev.cellsRead}/${s.cellsWritten - prev.cellsWritten}`);
    prev = Object.assign({}, s);
  };
  const time = (name, fn) => {
    try { fn(); } catch (err) { console.log(`  ${name}: threw ${err}`); }
    report(name);
  };

  // The five importCalendarGroups() runs inside one shared scope. Without
  // withSessionGrid() defined (the "before" measurement) this is a plain call,
  // which is exactly the shape the code had.
  const runFive = () => {
    time('reconcileProgramFlagColumns', () => sandbox.reconcileProgramFlagColumns(sheet, groups));
    time('reconcileSessionFlagColumns', () => sandbox.reconcileSessionFlagColumns(sheet, groups));
    time('reconcileSessionTimesFromCalendar', () => sandbox.reconcileSessionTimesFromCalendar(sheet, groups));
    time('reconcileAssistanceSessionSettings', () => sandbox.reconcileAssistanceSessionSettings(sheet, groups));
    time('applyNoRegistrationEffects', () => sandbox.applyNoRegistrationEffects(sheet, groups));
  };

  if (sandbox.withSessionGrid) {
    sandbox.withSessionGrid(sheet, runFive);
    report('(scope closes — one write-back)');
  } else {
    runFive();
  }

  // AFTER the group loop has written rows, so it is outside the scope in the
  // sync too — see importCalendarGroups().
  time('updateRegistrationLinkCells',
    () => sandbox.updateRegistrationLinkCells(sheet, groups, sandbox.buildFormIdByProgram(groups)));

  const s = sheet.stats;
  console.log('  ' + '-'.repeat(66));
  console.log(`  TOTAL round trips: ${roundTrips(s)}` +
    `   (getValues ${s.getValues}, getFormulas ${s.getFormulas}, ` +
    `setValues ${s.setValues}, setValue ${s.setValue})`);
  console.log(`  cells read ${s.cellsRead}, cells written ${s.cellsWritten}`);
  return roundTrips(s);
}

run(sandbox.withSessionGrid
  ? 'RECONCILE PHASE — one shared read, one write-back'
  : 'RECONCILE PHASE — per-pass column reads');

// ============================================================================
// THE SECOND HALF OF THE SAME PROBLEM: the readers that come AFTER the
// reconcile phase.
//
// A sync does not stop at the passes above. The dashboard render reads the
// session rows, the triage pass reads them, the registration import reads them
// again at the top of its own half, the counts pass reads four columns of them
// and the leader sheets read them once more — all in ONE execution, and until
// the grid cache existed every one of those was its own fetch of the same
// unchanged tab.
// ============================================================================
function runReaders(label) {
  const { grid, groups, rows } = buildWorkbook();
  const sheet = makeCountingSheet(grid, 'All_Program_Sessions');
  const registrants = makeCountingSheet([['Event_ID']], 'All_Registrants');
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: name => (name === 'All_Program_Sessions' ? sheet
      : name === 'All_Registrants' ? registrants : null),
    toast: () => {}, getSheets: () => [sheet, registrants]
  });
  sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;

  console.log(`\n${label}`);
  console.log(`${rows} session rows, one execution\n`);
  console.log('  reader                                 reads  cells read');
  console.log('  ' + '-'.repeat(66));

  let prev = Object.assign({}, sheet.stats);
  const time = (name, fn) => {
    try { fn(); } catch (err) { console.log(`  ${name}: threw ${err}`); }
    const s = sheet.stats;
    const reads = (s.getValues - prev.getValues) + (s.getFormulas - prev.getFormulas) +
      (s.getLastRow - prev.getLastRow) + (s.getLastColumn - prev.getLastColumn);
    console.log(`  ${name.padEnd(38)}${String(reads).padStart(5)}  ${s.cellsRead - prev.cellsRead}`);
    prev = Object.assign({}, s);
  };

  const H = sandbox.HEADERS.All_Program_Sessions;
  time('the render reads the session rows', () => sandbox.getSectionedRows(sheet, H, 'Event_ID'));
  time('the triage pass reads them', () => sandbox.getSectionedRows(sheet, H, 'Event_ID'));
  time('the import reads them at its top', () => sandbox.getSectionedRows(sheet, H, 'Event_ID'));
  time('a link-repair scan finds the headers', () => sandbox.findProgramSessionHeaderRows(sheet));
  time('and reads the header row', () => sandbox.getHeaderMapAt(sheet, 3));
  time('the leader sheets read them again', () => sandbox.getSectionedRows(sheet, H, 'Event_ID'));

  const s = sheet.stats;
  console.log('  ' + '-'.repeat(66));
  console.log(`  TOTAL reads: ${s.getValues + s.getFormulas + s.getLastRow + s.getLastColumn}` +
    `, cells read ${s.cellsRead}`);
}

runReaders(sandbox.withSessionGrid
  ? 'DOWNSTREAM READERS — one shared grid'
  : 'DOWNSTREAM READERS — a fetch apiece');
