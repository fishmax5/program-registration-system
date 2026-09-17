// Two ways a registrant who asked for lunch stopped reaching the kitchen.
//
// 1. THE MENU HADN'T BEEN TYPED YET. Lunch demand was gated on
//    isLunchOfferedOn(), which answers false both for "the kitchen is closed
//    that day" and for "nobody has written the menu row yet". At a "By
//    exception" location the second is true of every date until somebody types
//    the month in — so an all-dates registrant who ticked lunch first was
//    written No Lunch, and typing the menu afterwards never went back for them.
//
// 2. RECORDING THE ORDER FROZE THE COUNT. Any hand-edit on a
//    Master_Lunch_Dashboard row flips Manual_Override to "Manually Edited",
//    and the whole row was then skipped on every later render. Typing
//    Actual_Ordered — the column the tab exists for — therefore stopped
//    Registered_Count ever moving again, while the same people went on
//    appearing in the rollup and on All_Lunch_Registrants.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    // Pattern-aware, because formatDateKey() goes through it: a stub that
    // ignored the pattern would key every date as an ISO timestamp and nothing
    // in this file would ever match anything.
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      return date.toISOString();
    },
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: n => ({ __name: n }), getSpreadsheetTimeZone: () => 'America/New_York' })
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.lunchIsRuledOutOn = lunchIsRuledOutOn;
this.isLunchOfferedOn = isLunchOfferedOn;
this.buildRegistrantRow = buildRegistrantRow;
this.updateMasterLunchDashboard = updateMasterLunchDashboard;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.dropNotServingRowsReal = dropNotServingRows;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};

// --- 1. a gap is not a decision --------------------------------------------
// Narberth caters "by exception": nothing is served unless a menu row says so.
// Zoom serves nothing ever. The 14th has a Hot menu, the 21st has nothing typed
// yet, and the 28th has been explicitly closed.
const MENU = {
  'Narberth|2026-09-14': { type: 'Hot' },
  'Narberth|2026-09-28': { type: 'Not Serving' }
};
sandbox.getCateringPolicyForLocation = loc => (loc === 'Zoom' ? 'Never' : 'By exception');
sandbox.getMealInfoForDate = (date, loc) => MENU[`${loc}|${sandbox.formatDateKey(date)}`] || null;

const d = day => new Date(2026, 8, day);

check('a catered date is not ruled out', sandbox.lunchIsRuledOutOn(d(14), 'Narberth'), false);
check('a date with no menu row yet is not ruled out either', sandbox.lunchIsRuledOutOn(d(21), 'Narberth'), false);
check('an explicit "Not Serving" IS ruled out', sandbox.lunchIsRuledOutOn(d(28), 'Narberth'), true);
check('a location that never caters is ruled out', sandbox.lunchIsRuledOutOn(d(14), 'Zoom'), true);

// ...which is exactly where it parts company with "is lunch on offer", the
// question the FORM asks — a date with no menu can't be offered a meal, but a
// person who has asked for one still has to be counted.
check('the offer question still says no to a date with no menu',
  sandbox.isLunchOfferedOn(d(21), 'Narberth'), false);

const lrMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
// The all-dates branch: one lunch tick, applied to every date on the form.
function lunchStatusFor(dayOfMonth, location) {
  const row = sandbox.buildRegistrantRow({
    registryEntry: {
      eventId: `evt-${dayOfMonth}`, eventDate: d(dayOfMonth), location,
      cleanTitle: 'Book Club', eventTime: '', maxCapacity: 0
    },
    name: 'Jane Smith', personType: 'Attendee', lunchType: 'Yes - Lunch',
    primaryRegistrant: 'Self', adminNotes: '', formEditUrl: '',
    protectedKeys: new Set(), existingRowIndex: new Map(),
    submittedAt: new Date(2026, 8, 1), orderAheadDays: 3, partyId: 'p1', partySize: 1
  });
  return row ? row[lrMap['Lunch_Status']] : null;
}
sandbox.getRegistrantTombstone = () => null;
sandbox.computeOrderAheadFlag = () => '';

check('lunch on a catered date is Needed', lunchStatusFor(14, 'Narberth'), 'Needed');
check('lunch on a date whose menu is not typed yet is STILL Needed',
  lunchStatusFor(21, 'Narberth'), 'Needed');
check('lunch on a day the kitchen is closed is not', lunchStatusFor(28, 'Narberth'), 'No Lunch');
check('lunch at a never-catering location is not', lunchStatusFor(14, 'Zoom'), 'No Lunch');

// --- 2. recording the order must not freeze the count -----------------------
const dashHeaders = sandbox.HEADERS.Master_Lunch_Dashboard;
const dashMap = sandbox.getIndexMap(dashHeaders);

// One existing row for the 14th: 9 people counted this morning, 30 ordered,
// and the act of typing that 30 flipped it to "Manually Edited".
function existingRow(override) {
  const row = new Array(dashHeaders.length).fill('');
  row[dashMap['Event_Date']] = d(14);
  row[dashMap['Location']] = 'Narberth';
  row[dashMap['Registered_Count']] = 9;
  row[dashMap['Actual_Ordered']] = 30;
  row[dashMap['Manual_Override']] = override;
  return row;
}

let written = [];
function renderWith(override) {
  const table = [existingRow(override)];
  sandbox.getOrCreateSheet = (ss, name) => ({ __name: name });
  sandbox.readAllSectionedRows = () => table;
  sandbox.buildLunchSignUpRows = () => [];
  sandbox.getLunchOnlyFormLinks = () => ({});
  sandbox.getDashboardRowPlan = () => ({});
  // Four more people have registered since the order was placed.
  sandbox.buildDashboardRollup = () => [{
    dateKey: '2026-09-14', location: 'Narberth', registeredCount: 13, servedConfirmed: 0,
    mealType: 'Hot', mealShorthand: 'Chicken'
  }];
  sandbox.getMealBufferConfigForLocation = () => ({ standardBufferAmount: 2, testerBufferAmount: 1 });
  sandbox.dropNotServingRows = rows => rows;
  sandbox.renderLunchRosterSheet = () => {};
  sandbox.writeMasterLunchDashboardSheet = (sheet, plan, headers, rows) => { written = rows; };
  sandbox.updateMasterLunchDashboard(null);
  return written[0];
}

const edited = renderWith('Manually Edited');
check('a hand-edited row still gets the new count', edited[dashMap['Registered_Count']], 13);
check('and keeps what the person typed', edited[dashMap['Actual_Ordered']], 30);
check('and picks up the derived meal type', edited[dashMap['Lunch_Type']], 'Hot');
check('and the buffer Config says', edited[dashMap['Standard_Buffer']], 2);

// A row somebody created outright is still theirs, whole.
const added = renderWith('Manually Added');
check('a manually ADDED row is left alone entirely', added[dashMap['Registered_Count']], 9);

// --- 3. and neither of the two ways it could be ERASED ----------------------
// Actual_Ordered is the one number on this tab nothing can recompute: it is
// what the kitchen actually ordered, typed by a person. The render is a read,
// a sheet.clear() and a rewrite, so anything the read misses is gone.

// (a) A header cell edited out from under the column. The sectioned read
//     resolves a canonical column the header row doesn't name to blank, so the
//     rewrite would put a blank back over every typed number at once.
let noted = [];
sandbox.noteForAdmin = (subject) => { noted.push(subject); };

function renderWithHeaders(headerNames) {
  const table = [existingRow('Manually Edited')];
  written = null;
  noted = [];
  sandbox.getOrCreateSheet = (ss, name) => ({ __name: name });
  sandbox.readAllSectionedRows = () => table;
  sandbox.buildLunchSignUpRows = () => [];
  sandbox.getLunchOnlyFormLinks = () => ({});
  sandbox.getDashboardRowPlan = () => ({});
  sandbox.buildDashboardRollup = () => [{
    dateKey: '2026-09-14', location: 'Narberth', registeredCount: 13, servedConfirmed: 0,
    mealType: 'Hot', mealShorthand: 'Chicken'
  }];
  sandbox.getMealBufferConfigForLocation = () => ({ standardBufferAmount: 2, testerBufferAmount: 1 });
  sandbox.dropNotServingRows = rows => rows;
  sandbox.renderLunchRosterSheet = () => {};
  sandbox.writeMasterLunchDashboardSheet = (sheet, plan, headers, rows) => { written = rows; };
  // Stand in for the live header probe: these are the names the tab's own
  // header row currently carries.
  sandbox.getSectionZones = () => [{ headerRow: 5, dataStart: 6, dataEnd: 6 }];
  sandbox.getHeaderMapAt = () => {
    const map = {};
    headerNames.forEach((name, i) => { map[name] = i + 1; });
    return map;
  };
  sandbox.updateMasterLunchDashboard(null);
  return written;
}

check('a header row carrying every column renders as usual',
  renderWithHeaders(dashHeaders) !== null, true);
const blanked = renderWithHeaders(dashHeaders.filter(h => h !== 'Actual_Ordered'));
check('a header row missing Actual_Ordered writes NOTHING', blanked, null);
check('and the office is told which column went', noted.length, 1);

// (b) A "Not Serving" future date whose row carries a typed order. The
//     hand-edited flag comes from a simple onEdit, which never fires for a
//     script write and only flips a cell reading "Auto-Synced" or blank — so
//     the typed number itself has to be what saves the row.
sandbox.noteForAdmin = () => {};
sandbox.isExplicitlyNotServing = () => true;
const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
function notServingRow(override, actualOrdered) {
  const row = new Array(dashHeaders.length).fill('');
  row[dashMap['Event_Date']] = future;
  row[dashMap['Location']] = 'Narberth';
  row[dashMap['Manual_Override']] = override;
  row[dashMap['Actual_Ordered']] = actualOrdered;
  return row;
}
const dropRows = rows => sandbox.dropNotServingRowsReal(rows, dashMap, []);
check('an auto-synced Not-Serving row with nothing typed on it goes',
  dropRows([notServingRow('Auto-Synced', '')]).length, 0);
check('the same row carrying a typed order STAYS',
  dropRows([notServingRow('Auto-Synced', 30)]).length, 1);
check('and so does a hand-edited one, as before',
  dropRows([notServingRow('Manually Edited', '')]).length, 1);

console.log(failures === 0 ? '\nAll lunch-demand checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
