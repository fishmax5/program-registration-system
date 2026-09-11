// A HORIZON THAT DOES NOT GO STALE.
//
// The failure this is written against is a quiet one: "Registration Open
// Through" was one typed date, so the answer somebody gave in September was
// still the answer in January — and the morning after it passed, every form in
// the workbook stopped accepting responses and every upcoming event's
// description said registration was not yet open. Nothing malfunctioned. The
// date simply meant what it said, a month after anybody last looked at it.
//
// So the setting staff keep is now a number of months, resolved afresh on
// every read, and the whole of its correctness is four questions:
//
//   * does it ROLL — three months from today, rounded to the end of that
//     month, so it moves once a month rather than every morning (a horizon
//     that shifts daily rewrites the description of every event on its
//     boundary, daily);
//   * does a workbook that typed a DATE keep it — a blank Months_Ahead has to
//     mean exactly what this setting meant before the rolling half existed,
//     or this change closes forms on somebody else's schedule;
//   * does a typo fail OPEN, in both cells, since one bad cell must never be
//     able to close every form in the workbook;
//   * and is the date cell a DISPLAY that keeps up — it is what every dialog,
//     note and log already prints, and a display a month behind is the one
//     thing somebody would check before believing the sync.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const date = new Date(d);
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return date.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    newDataValidation: () => {
      const rule = {
        requireCheckbox: () => rule, requireValueInList: () => rule,
        setAllowInvalid: () => rule, build: () => 'rule'
      };
      return rule;
    }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: null,
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.CONFIG_LAYOUT = CONFIG_LAYOUT;
this.CONFIG_DATA_START_ROW = CONFIG_DATA_START_ROW;
this.DEFAULT_REGISTRATION_HORIZON_MONTHS = DEFAULT_REGISTRATION_HORIZON_MONTHS;
this.REGISTRATION_HORIZON_MONTH_OPTIONS = REGISTRATION_HORIZON_MONTH_OPTIONS;
this.parseRegistrationHorizonMonths = parseRegistrationHorizonMonths;
this.rollingRegistrationHorizonDate = rollingRegistrationHorizonDate;
this.getRegistrationHorizonKey = getRegistrationHorizonKey;
this.getRegistrationHorizonMonths = getRegistrationHorizonMonths;
this.hasRegistrationHorizon = hasRegistrationHorizon;
this.isBeyondRegistrationHorizon = isBeyondRegistrationHorizon;
this.refreshRegistrationHorizonDisplay = refreshRegistrationHorizonDisplay;
this.seedRegistrationHorizonRow = seedRegistrationHorizonRow;
this.describeRegistrationHorizonMonths = describeRegistrationHorizonMonths;
this.configLastColumn = configLastColumn;
this.invalidateConfigCaches = invalidateConfigCaches;
this.formatDateKey = formatDateKey;
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

const SECTION = sandbox.CONFIG_LAYOUT.REGISTRATION_HORIZON;
const ROW = sandbox.CONFIG_DATA_START_ROW;
const DATE_COL = SECTION.startCol;
const MONTHS_COL = SECTION.startCol + 1;

/** A Config tab holding whatever is in the two horizon cells. */
function configSheet(dateValue, monthsValue) {
  const grid = {};
  const notes = {};
  if (dateValue !== undefined) grid[`${ROW},${DATE_COL}`] = dateValue;
  if (monthsValue !== undefined) grid[`${ROW},${MONTHS_COL}`] = monthsValue;
  const sheet = {
    grid,
    notes,
    getName: () => 'Config',
    getLastRow: () => 8,
    getMaxColumns: () => 60,
    getRange: (row, col) => {
      const key = `${row},${col}`;
      const range = {
        getValue: () => (grid[key] === undefined ? '' : grid[key]),
        setValue: v => { grid[key] = v; return range; },
        setNote: n => { notes[key] = n; return range; },
        setNumberFormat: () => range,
        setDataValidation: () => range,
        clearContent: () => { delete grid[key]; return range; }
      };
      return range;
    }
  };
  return sheet;
}

function useSheet(sheet) {
  sandbox.__setConfigSheet(sheet);
  sandbox.invalidateConfigCaches();
  return sheet;
}

/** The end of the month `months` out from today, as this test works it out itself. */
function endOfMonthAhead(months) {
  const now = new Date();
  return sandbox.formatDateKey(new Date(now.getFullYear(), now.getMonth() + months + 1, 0));
}

// ---------------------------------------------------------------------------
// 1. THE ROLLING RULE. Counted from today, rounded to the end of a month.
// ---------------------------------------------------------------------------
check('the default is three months', sandbox.DEFAULT_REGISTRATION_HORIZON_MONTHS, 3);

const jan15 = new Date(2026, 0, 15);
check('3 months from 15 Jan is the end of April',
  sandbox.formatDateKey(sandbox.rollingRegistrationHorizonDate(3, jan15)), '2026-04-30');
check('and so is 3 months from the 1st of January — it moves once a month, not daily',
  sandbox.formatDateKey(sandbox.rollingRegistrationHorizonDate(3, new Date(2026, 0, 1))), '2026-04-30');
check('a count that crosses the year end still lands on the right month',
  sandbox.formatDateKey(sandbox.rollingRegistrationHorizonDate(5, new Date(2026, 9, 20))), '2027-03-31');
check('one month from January is the end of February, leap year included',
  sandbox.formatDateKey(sandbox.rollingRegistrationHorizonDate(1, new Date(2028, 0, 3))), '2028-02-29');

useSheet(configSheet('', '3 months'));
check('a Months_Ahead cell resolves to that horizon', sandbox.getRegistrationHorizonKey(), endOfMonthAhead(3));
check('and reads back as the month count it is', sandbox.getRegistrationHorizonMonths(), 3);
check('a session inside the window is open',
  sandbox.isBeyondRegistrationHorizon(new Date()), false);

useSheet(configSheet('', '1 month'));
const twoMonthsOut = new Date();
twoMonthsOut.setMonth(twoMonthsOut.getMonth() + 2);
check('a session past the window is not open yet',
  sandbox.isBeyondRegistrationHorizon(twoMonthsOut), true);

// "Add a month" is one step up the dropdown, and nothing else.
useSheet(configSheet('', '4 months'));
check('picking the next option opens one more month',
  sandbox.getRegistrationHorizonKey(), endOfMonthAhead(4));
check('every option on the dropdown parses',
  sandbox.REGISTRATION_HORIZON_MONTH_OPTIONS.map(sandbox.parseRegistrationHorizonMonths),
  [1, 2, 3, 4, 5, 6, 9, 12]);
check('and reads back the way the dropdown writes it',
  [1, 2, 12].map(sandbox.describeRegistrationHorizonMonths), ['1 month', '2 months', '12 months']);

// ---------------------------------------------------------------------------
// 2. A TYPED DATE STILL WINS. Blank Months_Ahead is the behaviour every
//    workbook already running has, unchanged.
// ---------------------------------------------------------------------------
useSheet(configSheet(new Date(2026, 11, 31), ''));
check('a typed date with no month count is the horizon',
  sandbox.getRegistrationHorizonKey(), '2026-12-31');
check('and nothing is rolling', sandbox.getRegistrationHorizonMonths(), null);

useSheet(configSheet('', ''));
check('both cells blank is no horizon at all', sandbox.getRegistrationHorizonKey(), '');
check('which is what hasRegistrationHorizon() says', sandbox.hasRegistrationHorizon(), false);

useSheet(configSheet(new Date(2026, 11, 31), '3 months'));
check('the month count is asked first — the date beside it is only its display',
  sandbox.getRegistrationHorizonKey(), endOfMonthAhead(3));

// ---------------------------------------------------------------------------
// 3. FAILING OPEN. A typo in either cell leaves registration open rather than
//    closing every form in the workbook.
// ---------------------------------------------------------------------------
check('"three" is not a month count', sandbox.parseRegistrationHorizonMonths('three'), null);
check('nor is a blank', sandbox.parseRegistrationHorizonMonths(''), null);
check('nor is a number of months nobody means',
  sandbox.parseRegistrationHorizonMonths('600 months'), null);
check('a bare number is, because an upgraded cell may hold one',
  sandbox.parseRegistrationHorizonMonths(3), 3);
check('a date pasted into the month cell is refused, not read as sixty months',
  sandbox.parseRegistrationHorizonMonths(new Date(2026, 11, 31)), null);

useSheet(configSheet(new Date(2026, 11, 31), 'three'));
check('an unusable month count falls back to the typed date',
  sandbox.getRegistrationHorizonKey(), '2026-12-31');

useSheet(configSheet('September', ''));
check('an unusable date is no horizon, so everything stays open',
  sandbox.getRegistrationHorizonKey(), '');

useSheet(configSheet(2026, ''));
check('and so is a bare year, which Sheets reads as 1905',
  sandbox.getRegistrationHorizonKey(), '');

sandbox.__setConfigSheet(null);
sandbox.invalidateConfigCaches();
check('a workbook with no Config tab has no horizon', sandbox.getRegistrationHorizonKey(), '');

// ---------------------------------------------------------------------------
// 4. THE DISPLAY. The date cell is what every dialog and log already prints,
//    so the sync keeps it current — and writes it only when it moved.
// ---------------------------------------------------------------------------
let sheet = useSheet(configSheet('', '3 months'));
sandbox.refreshRegistrationHorizonDisplay();
check('the sync writes the resolved date into the date cell',
  sandbox.formatDateKey(sheet.grid[`${ROW},${DATE_COL}`]), endOfMonthAhead(3));

let writes = 0;
const counted = configSheet('', '3 months');
const innerGetRange = counted.getRange;
counted.getRange = (row, col) => {
  const range = innerGetRange(row, col);
  const setValue = range.setValue;
  range.setValue = v => { writes++; return setValue(v); };
  return range;
};
useSheet(counted);
sandbox.refreshRegistrationHorizonDisplay();
sandbox.invalidateConfigCaches();
sandbox.refreshRegistrationHorizonDisplay();
check('and only when it moved — the second pass writes nothing', writes, 1);

sheet = useSheet(configSheet(new Date(2026, 11, 31), ''));
sandbox.refreshRegistrationHorizonDisplay();
check('a typed date is never overwritten by the display pass',
  sandbox.formatDateKey(sheet.grid[`${ROW},${DATE_COL}`]), '2026-12-31');

// ---------------------------------------------------------------------------
// 5. THE SEED. Three months on a tab nobody has answered, and nothing at all
//    on one somebody has.
// ---------------------------------------------------------------------------
sheet = useSheet(configSheet('', ''));
sandbox.seedRegistrationHorizonRow(sheet);
check('an unanswered Config tab is seeded to the default',
  sheet.grid[`${ROW},${MONTHS_COL}`], '3 months');
check('and both cells are explained where somebody reading Config will find it',
  [!!sheet.notes[`${ROW},${DATE_COL}`], !!sheet.notes[`${ROW},${MONTHS_COL}`]], [true, true]);

sheet = useSheet(configSheet(new Date(2026, 11, 31), ''));
sandbox.seedRegistrationHorizonRow(sheet);
check('a workbook holding a typed date is left alone',
  sheet.grid[`${ROW},${MONTHS_COL}`], '');

sheet = useSheet(configSheet('', '12 months'));
sandbox.seedRegistrationHorizonRow(sheet);
check('and so is one that already answered with a month count',
  sheet.grid[`${ROW},${MONTHS_COL}`], '12 months');

// The second column has to fit inside the gap the layout has always had
// before MEMBERSHIP_FORM — see the CONFIG_LAYOUT banner.
check('the horizon section still stops short of the next one',
  MONTHS_COL < sandbox.CONFIG_LAYOUT.MEMBERSHIP_FORM.startCol, true);

console.log(failures === 0 ? '\nAll registration-horizon checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
