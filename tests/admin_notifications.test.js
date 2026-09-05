// WHO IN THE OFFICE IS COPIED ON WHAT.
//
// One Config table replaced two single-address cells (Admin_Notification_Email
// and Archive_Copy_Address), so the whole of its correctness is in four
// questions, and every one of them is somebody's inbox:
//
//   * does a tick actually decide who is on a category, and does an untouched
//     table mean NOBODY rather than everybody;
//   * does a workbook that has not been rebuilt yet keep copying the people it
//     was already copying — the upgrade must not stop notifications silently;
//   * does the migration carry those two cells across exactly once, without
//     duplicating an address that was in both of them;
//   * does a BCC'd office address still cost its own message off the day's
//     hundred, now that there can be several of them.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sentMail = [];
let quota = 100;
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString(), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    newDataValidation: () => {
      const rule = { requireCheckbox: () => rule, requireValueInList: () => rule, setAllowInvalid: () => rule, build: () => 'rule' };
      return rule;
    }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {},
  MailApp: {
    getRemainingDailyQuota: () => quota,
    sendEmail: options => sentMail.push(options)
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.CONFIG_LAYOUT = CONFIG_LAYOUT;
this.CONFIG_DATA_START_ROW = CONFIG_DATA_START_ROW;
this.ADMIN_NOTIFICATION_MAX_ROWS = ADMIN_NOTIFICATION_MAX_ROWS;
this.RETIRED_ADMIN_NOTIFICATION_COL = RETIRED_ADMIN_NOTIFICATION_COL;
this.RETIRED_ARCHIVE_COPY_COL = RETIRED_ARCHIVE_COPY_COL;
this.getAdminNotificationRows = getAdminNotificationRows;
this.adminEmailsForCategory = adminEmailsForCategory;
this.getAllAdminNotificationEmails = getAllAdminNotificationEmails;
this.migrateLegacyAdminNotificationColumns = migrateLegacyAdminNotificationColumns;
this.legacyAdminNotificationRowValues = legacyAdminNotificationRowValues;
this.sendRationedEmail = sendRationedEmail;
this.normalizeBccList = normalizeBccList;
this.notifyAdmin = notifyAdmin;
this.resetRationedMailState = resetRationedMailState;
this.invalidateConfigCaches = invalidateConfigCaches;
this.ensureSheetColumns = ensureSheetColumns;
this.configLastColumn = configLastColumn;
this.__setConfigSheet = function (sheet) { __configSheetForTest = sheet; };
var __configSheetForTest = null;
SpreadsheetApp.getActiveSpreadsheet = function () {
  return { getSheetByName: name => (name === SHEET_NAMES.CONFIG ? __configSheetForTest : null) };
};
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function ok(name, cond) { check(name, !!cond, true); }

/**
 * A fake Config tab over a sparse { 'row,col': value } grid, recording every
 * write so the migration can be checked on what it did rather than on what it
 * says it did.
 */
function fakeConfigSheet(cells, maxColumns) {
  const grid = Object.assign({}, cells);
  const cleared = [];
  const notes = {};
  let columns = maxColumns === undefined ? 40 : maxColumns;
  const at = (r, c) => (grid[`${r},${c}`] === undefined ? '' : grid[`${r},${c}`]);
  const sheet = {
    grid, cleared, notes,
    getName: () => 'Config',
    getLastRow: () => 8,
    // A real sheet THROWS on a range past its edge rather than growing —
    // that is the whole reason ensureSheetColumns() exists.
    getMaxColumns: () => columns,
    insertColumnsAfter: (after, howMany) => { columns = after + howMany; return sheet; },
    getRange: (row, col, numRows, numCols) => {
      if (col + ((numCols === undefined ? 1 : numCols) - 1) > columns) {
        throw new Error('The coordinates or dimensions of the range are invalid.');
      }
      return buildRange(row, col, numRows, numCols);
    }
  };
  function buildRange(row, col, numRows, numCols) {
    const rows = numRows === undefined ? 1 : numRows;
    const cols = numCols === undefined ? 1 : numCols;
    // Every setter and every clear returns the RANGE, as Apps Script's do —
    // the migration chains them.
    const range = {
      getValue: () => at(row, col),
      getValues: () => {
        const out = [];
        for (let r = 0; r < rows; r++) {
          const line = [];
          for (let c = 0; c < cols; c++) line.push(at(row + r, col + c));
          out.push(line);
        }
        return out;
      },
      setValues: values => {
        values.forEach((line, r) => line.forEach((v, c) => { grid[`${row + r},${col + c}`] = v; }));
        return range;
      },
      setValue: v => { grid[`${row},${col}`] = v; return range; },
      setNote: note => { notes[`${row},${col}`] = note; return range; },
      setDataValidation: () => range,
      breakApart: () => range,
      clearContent: () => {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            cleared.push(`${row + r},${col + c}`);
            delete grid[`${row + r},${col + c}`];
          }
        }
        return range;
      },
      clearNote: () => range,
      clearDataValidations: () => range,
      clearFormat: () => range
    };
    return range;
  }
  return sheet;
}

const ADMIN = sandbox.CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
const ROW1 = sandbox.CONFIG_DATA_START_ROW;

/** The table's own cells, written the way a person filling it in would. */
function tableCells(rows) {
  const cells = {};
  rows.forEach((row, i) => row.forEach((value, c) => { cells[`${ROW1 + i},${ADMIN.startCol + c}`] = value; }));
  return cells;
}

function useSheet(sheet) {
  sandbox.__setConfigSheet(sheet);
  sandbox.invalidateConfigCaches();
  return sheet;
}

// ---------------------------------------------------------------------------
// 1. The table decides, per person, per category.
// ---------------------------------------------------------------------------
useSheet(fakeConfigSheet(tableCells([
  ['Dana@example.org', true, false, false, true, false],
  ['lee@example.org', false, true, true, false, true],
  ['', true, true, true, true, true],                     // ticks against nobody
  ['not-an-address', true, true, true, true, true],       // a half-typed cell
  ['dana@example.org', false, false, false, true, false]  // the same person again
])));

check('a row reads back as its ticks', sandbox.getAdminNotificationRows()[0],
  { email: 'Dana@example.org', syncDigest: true, leaderRosterAlerts: false,
    registrantReminders: false, calendarInviteGuest: true, appointmentRequests: false });
check('ticks against a blank row, or a cell that is not an address, send nothing',
  sandbox.getAdminNotificationRows().length, 3);
check('the sync digest goes to whoever is ticked for it, and nobody else',
  sandbox.adminEmailsForCategory('syncDigest'), ['dana@example.org']);
check('and a category nobody ticked reaches nobody',
  sandbox.adminEmailsForCategory('leaderRosterAlerts'), ['lee@example.org']);
check('one person entered twice is one address, not two off the same quota',
  sandbox.adminEmailsForCategory('calendarInviteGuest'), ['dana@example.org']);
// Its own tick, and its own person: whoever rings the people waiting for an
// appointment is not whoever reads the sync digest.
check('appointment requests go to whoever is ticked for them, and nobody else',
  sandbox.adminEmailsForCategory('appointmentRequests'), ['lee@example.org']);
check('editor access is every address in the table, ticked or not',
  sandbox.getAllAdminNotificationEmails(), ['dana@example.org', 'lee@example.org']);

// A checkbox reads back as a boolean. Anything else in the cell is not a tick:
// a pasted "TRUE" is a string, and acting on it would mail somebody on the
// strength of a paste nobody checked.
useSheet(fakeConfigSheet(tableCells([['dana@example.org', 'TRUE', 'yes', 1, '']])));
check('only a real tick is a tick', sandbox.adminEmailsForCategory('syncDigest'), []);

// AN UNTOUCHED TABLE MEANS NOBODY — the safe direction, and what a blank cell
// always meant here.
useSheet(fakeConfigSheet({}));
check('an empty table copies nobody', sandbox.getAdminNotificationRows(), []);
check('and a Config tab that is not there at all reads the same way',
  (useSheet(null), sandbox.getAdminNotificationRows()), []);

// ---------------------------------------------------------------------------
// 2. The workbook nobody has rebuilt yet. buildConfigSheet() is a menu item a
//    person has to choose; between deploying this and choosing it the hourly
//    sync still runs, and the office must keep getting what it was getting.
// ---------------------------------------------------------------------------
const legacyCells = {
  [`1,${sandbox.RETIRED_ADMIN_NOTIFICATION_COL.col}`]: sandbox.RETIRED_ADMIN_NOTIFICATION_COL.title,
  [`${ROW1},${sandbox.RETIRED_ADMIN_NOTIFICATION_COL.col}`]: 'admin@example.org',
  [`1,${sandbox.RETIRED_ARCHIVE_COPY_COL.col}`]: sandbox.RETIRED_ARCHIVE_COPY_COL.title,
  [`${ROW1},${sandbox.RETIRED_ARCHIVE_COPY_COL.col}`]: 'office@example.org'
};
useSheet(fakeConfigSheet(legacyCells));
check('the retired admin cell still gets the digest',
  sandbox.adminEmailsForCategory('syncDigest'), ['admin@example.org']);
check('and the retired archive cell still gets the leader alerts',
  sandbox.adminEmailsForCategory('leaderRosterAlerts'), ['office@example.org']);
check('the reminders', sandbox.adminEmailsForCategory('registrantReminders'), ['office@example.org']);
check('and the calendar invitations — all three it used to cover',
  sandbox.adminEmailsForCategory('calendarInviteGuest'), ['office@example.org']);

// AND THE COLUMNS ARE NOT EVEN THERE. A Config tab built before this table
// ends at column 25, and a Google Sheet has 26 columns by default — so on the
// workbook that has not been rebuilt, reading the table is a THROW, not an
// empty read. That must still come out as "the office keeps getting what it
// was getting", not as a caught error and a silence nobody notices.
useSheet(fakeConfigSheet(legacyCells, 26));
check('a tab too narrow to hold the table still reads the cells behind it',
  sandbox.adminEmailsForCategory('syncDigest'), ['admin@example.org']);
check('and the rest of them', sandbox.getAllAdminNotificationEmails(),
  ['admin@example.org', 'office@example.org']);

// The rebuild is what makes the room. Without this the banner write itself
// throws and the whole Config tab fails to draw.
const narrow = fakeConfigSheet(legacyCells, 26);
sandbox.ensureSheetColumns(narrow, sandbox.configLastColumn());
check('a rebuild widens the tab to fit the table', narrow.getMaxColumns(),
  ADMIN.startCol + ADMIN.headers.length - 1);
check('and asking again changes nothing',
  (sandbox.ensureSheetColumns(narrow, sandbox.configLastColumn()), narrow.getMaxColumns()),
  ADMIN.startCol + ADMIN.headers.length - 1);

// A table somebody has filled in is the answer; the old cells are not consulted
// behind it, or clearing a row would silently fall back to a year-old address.
useSheet(fakeConfigSheet(Object.assign({}, legacyCells,
  tableCells([['dana@example.org', true, false, false, false]]))));
check('a filled-in table wins over the cells it replaced',
  sandbox.adminEmailsForCategory('syncDigest'), ['dana@example.org']);
check('and the old archive address is not read from under it',
  sandbox.adminEmailsForCategory('registrantReminders'), []);

// ---------------------------------------------------------------------------
// 3. The migration itself.
// ---------------------------------------------------------------------------
const migrated = useSheet(fakeConfigSheet(legacyCells));
sandbox.migrateLegacyAdminNotificationColumns(migrated);
sandbox.invalidateConfigCaches();
check('both addresses land on the table', sandbox.getAdminNotificationRows(), [
  { email: 'admin@example.org', syncDigest: true, leaderRosterAlerts: false,
    registrantReminders: false, calendarInviteGuest: false, appointmentRequests: false },
  { email: 'office@example.org', syncDigest: false, leaderRosterAlerts: true,
    registrantReminders: true, calendarInviteGuest: true, appointmentRequests: false }
]);
// NOT ticked by the migration for anybody: neither retired cell ever stood for
// it, and an upgrade must not start mailing somebody something new.
check('and nobody is carried onto the appointment-request tick',
  sandbox.adminEmailsForCategory('appointmentRequests'), []);
ok('and the columns they came from are cleared',
  migrated.cleared.indexOf(`${ROW1},${sandbox.RETIRED_ADMIN_NOTIFICATION_COL.col}`) !== -1 &&
  migrated.cleared.indexOf(`1,${sandbox.RETIRED_ARCHIVE_COPY_COL.col}`) !== -1);

// Running it again is the normal case — every rebuild calls it — and there is
// nothing left for it to find.
const before = JSON.stringify(migrated.grid);
sandbox.migrateLegacyAdminNotificationColumns(migrated);
check('running it a second time changes nothing', JSON.stringify(migrated.grid), before);

// ONE ADDRESS IN BOTH CELLS IS ONE ROW. Two rows would BCC the same person
// twice off the same daily quota, and read as two people on the tab.
check('an address that was in both cells is one row with every old tick on it',
  sandbox.legacyAdminNotificationRowValues('office@example.org', 'OFFICE@example.org'),
  [['office@example.org', true, true, true, true, false]]);
check('and an empty pair carries nothing across',
  sandbox.legacyAdminNotificationRowValues('', ''), []);

// A table somebody has already filled in is never written over, even while the
// old cells are still standing.
const held = useSheet(fakeConfigSheet(Object.assign({}, legacyCells,
  tableCells([['dana@example.org', true, true, true, true, true]]))));
sandbox.migrateLegacyAdminNotificationColumns(held);
sandbox.invalidateConfigCaches();
check('a filled-in table is left exactly as it was',
  sandbox.getAdminNotificationRows().map(r => r.email), ['dana@example.org']);

// ---------------------------------------------------------------------------
// 4. What a copy costs. Every BCC'd address is its own message against the
//    same hundred, so a three-name office list makes one send cost four.
// ---------------------------------------------------------------------------
check('a bcc list is deduped, lowercased, and typos with no @ are dropped',
  sandbox.normalizeBccList(['A@example.org', 'a@EXAMPLE.org', 'not-an-address', '', 'b@example.org']),
  ['a@example.org', 'b@example.org']);
check('and a comma-separated string is the same list',
  sandbox.normalizeBccList('a@example.org, b@example.org'), ['a@example.org', 'b@example.org']);

sentMail.length = 0;
quota = 100;
sandbox.resetRationedMailState();
let outcome = sandbox.sendRationedEmail({
  to: 'leader@example.org', subject: 'Roster', body: 'changed', reserve: 10,
  bcc: ['a@example.org', 'b@example.org', 'c@example.org']
});
check('one send plus three copies costs four messages', outcome.cost, 4);
check('and they go out blind, on one message', sentMail[0].bcc, 'a@example.org,b@example.org,c@example.org');

// The floor each caller names is what stops one pass spending the day's mail.
// With 12 left and a floor of 10, a send costing 4 must not go.
quota = 12;
sandbox.resetRationedMailState();
sentMail.length = 0;
outcome = sandbox.sendRationedEmail({
  to: 'leader@example.org', subject: 'Roster', body: 'changed', reserve: 10,
  bcc: ['a@example.org', 'b@example.org', 'c@example.org']
});
check('the copies are counted against the caller\'s floor', outcome.status, 'held');
check('so nothing is sent', sentMail.length, 0);
check('while the same message with nobody copied still goes',
  sandbox.sendRationedEmail({ to: 'leader@example.org', subject: 'Roster', body: 'changed', reserve: 10 }).status,
  'sent');

// ---------------------------------------------------------------------------
// 5. notifyAdmin(): one message, however many people are ticked for the digest.
// ---------------------------------------------------------------------------
sentMail.length = 0;
useSheet(fakeConfigSheet(tableCells([
  ['dana@example.org', true, false, false, false],
  ['lee@example.org', true, false, false, false],
  ['no-digest@example.org', false, true, true, true]
])));
check('the digest is sent', sandbox.notifyAdmin('subject', 'body'), true);
check('as ONE message to everyone ticked for it, and nobody else',
  sentMail.map(m => m.to || m), ['dana@example.org,lee@example.org']);

sentMail.length = 0;
useSheet(fakeConfigSheet({}));
check('and an empty table sends nothing at all', sandbox.notifyAdmin('subject', 'body'), false);
check('with no message spent on it', sentMail.length, 0);

console.log(failures === 0 ? '\nAll admin notification checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
