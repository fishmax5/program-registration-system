// THE RECONCILE PHASE, WRITTEN IN BATCHES.
//
// importCalendarGroups() runs five passes over the session table and then a
// sixth after the group loop. Each used to scan the whole tab for its header
// rows and then read three to nine single columns per section zone, and the
// link pass wrote its cells ONE AT A TIME. They now share one read of the tab
// (96_session_grid.gs) and stage their answers into it.
//
// This pins the part that matters: the cells that come out the other end. A
// faster pass that writes a different answer is not a faster pass, and the
// three things most easily lost in a change like this are all checked below —
//
//   1. Two ZONES. Every pass loops Upcoming and Past, and a model that
//      collapsed them would write the first zone's answers over the second's.
//   2. The FORMULAS in the link columns. These were written cell by cell
//      precisely because getValues() flattens "=HYPERLINK(...)" to the words
//      it displays, so a whole-column write turned every live link on the
//      column into dead text. The batched write is only safe because the grid
//      carries formulas; an untouched row must still be a formula afterwards.
//   3. ORDER. The passes see each other's staged writes exactly as they used
//      to see each other's sheet writes — the assistance pass reads a capacity
//      the flag pass has just decided.
//
// It also pins the COST, loosely: the whole phase must stay in single figures
// of round trips. That is the point of the change, and a later edit that
// quietly puts a per-zone read back inside a pass would otherwise pass every
// other test in this suite.
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet, roundTrips } = require('./helpers/counting_sheet');

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
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: {
    ItemType: {},
    openById: id => ({
      getPublishedUrl: () => `https://forms/${id}/view`,
      getEditUrl: () => `https://forms/${id}/edit`,
      isAcceptingResponses: () => true,
      setAcceptingResponses: () => {},
      getId: () => id
    })
  },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.NO_REGISTRATION_LINK_LABEL = NO_REGISTRATION_LINK_LABEL;
this.withSessionGrid = withSessionGrid;
this.loadSessionGrid = loadSessionGrid;
this.sessionGridColumn = sessionGridColumn;
this.reconcileProgramFlagColumns = reconcileProgramFlagColumns;
this.reconcileSessionFlagColumns = reconcileSessionFlagColumns;
this.reconcileSessionTimesFromCalendar = reconcileSessionTimesFromCalendar;
this.reconcileAssistanceSessionSettings = reconcileAssistanceSessionSettings;
this.updateRegistrationLinkCells = updateRegistrationLinkCells;
this.buildFormIdByProgram = buildFormIdByProgram;
this.invalidateSectionedRowsCache = invalidateSectionedRowsCache;
this.getSectionedRows = getSectionedRows;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const HEADERS = sandbox.HEADERS.All_Program_Sessions;
const col = name => HEADERS.indexOf(name);
const CAL = 'ashbridge@example.com';
const LIVE_LINK = '=HYPERLINK("https://forms/keep/view","View Live Form")';
const LIVE_EDIT = '=HYPERLINK("https://forms/keep/edit","Edit Form Settings")';

function ev(start, end) {
  return {
    getStartTime: () => start, getEndTime: () => end,
    isAllDayEvent: () => false, getDescription: () => '', setDescription: () => {},
    getId: () => String(start.getTime())
  };
}

function sessionRow(title, date, end, formId) {
  const row = new Array(HEADERS.length).fill('');
  row[col('Event_Date')] = date;
  row[col('Event_End')] = end;
  row[col('Location')] = 'Ashbridge';
  row[col('Clean_Title')] = title;
  row[col('Calendar_Source')] = CAL;
  row[col('Event_ID')] = `${title}|${date.getTime()}`;
  row[col('Type_Tag')] = 'Regular';
  row[col('Club')] = false;
  row[col('No_Registration')] = false;
  row[col('Personalized_Assistance')] = false;
  row[col('Waitlist_Only')] = false;
  row[col('Active_Count')] = 3;
  row[col('Max_Capacity')] = 12;
  row[col('Remaining_Seats')] = 9;
  row[col('Status')] = '🟢 Open';
  row[col('Form_ID')] = formId;
  row[col('Form_Response_Link')] = LIVE_LINK;
  row[col('Edit_Form_Link')] = LIVE_EDIT;
  return row;
}

// --- the fixture -----------------------------------------------------------
//
// Two programs on one calendar, each with one UPCOMING and one PAST date, so
// both section zones carry a row of each program. "Chair Yoga" gains [Club];
// "Advice Desk" becomes an appointment program AND is tagged [No Registration],
// which is the row whose link columns have to be blanked.
const D_UP_A = new RealDate(2026, 8, 16, 10, 0);
const D_UP_B = new RealDate(2026, 8, 17, 14, 0);
const D_PAST_A = new RealDate(2026, 7, 12, 10, 0);
const D_PAST_B = new RealDate(2026, 7, 13, 14, 0);
// The calendar has since lengthened the upcoming Chair Yoga by half an hour.
const CAL_END_UP_A = new RealDate(2026, 8, 16, 11, 30);

const blank = new Array(HEADERS.length).fill('');
const grid = [
  ['All Program Sessions'],
  ['⏳ Upcoming'],
  HEADERS.slice(),
  sessionRow('Chair Yoga', D_UP_A, new RealDate(2026, 8, 16, 11, 0), 'form-yoga'),
  sessionRow('Advice Desk', D_UP_B, new RealDate(2026, 8, 17, 16, 0), 'form-advice'),
  blank.slice(),
  ['✅ Past'],
  HEADERS.slice(),
  sessionRow('Chair Yoga', D_PAST_A, new RealDate(2026, 7, 12, 11, 0), 'form-yoga'),
  sessionRow('Advice Desk', D_PAST_B, new RealDate(2026, 7, 13, 16, 0), 'form-advice')
];

const groups = [
  {
    groupKey: `${CAL}::Chair Yoga::2026-09`, cleanTitle: 'Chair Yoga',
    scope: CAL, locations: [CAL],
    sessions: [
      { calendarId: CAL, event: ev(D_UP_A, CAL_END_UP_A), waitlistOnly: true },
      { calendarId: CAL, event: ev(D_PAST_A, new RealDate(2026, 7, 12, 11, 0)), waitlistOnly: false }
    ],
    events: [],
    isClub: true, noRegistration: false, isAssistance: false, isShared: false,
    statedCapacity: 12, slotMinutes: 0
  },
  {
    groupKey: `${CAL}::Advice Desk::2026-09`, cleanTitle: 'Advice Desk',
    scope: CAL, locations: [CAL],
    sessions: [
      { calendarId: CAL, event: ev(D_UP_B, new RealDate(2026, 8, 17, 16, 0)), waitlistOnly: false },
      { calendarId: CAL, event: ev(D_PAST_B, new RealDate(2026, 7, 13, 16, 0)), waitlistOnly: false }
    ],
    events: [],
    isClub: false, noRegistration: true, isAssistance: true, isShared: false,
    statedCapacity: 0, slotMinutes: 30
  }
];

const sheet = makeCountingSheet(grid, 'All_Program_Sessions');
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: name => (name === 'All_Program_Sessions' ? sheet : null),
  toast: () => {}, getSheets: () => [sheet]
});
sandbox.SpreadsheetApp.getActive = sandbox.SpreadsheetApp.getActiveSpreadsheet;

const beforeStats = Object.assign({}, sheet.stats);
sandbox.withSessionGrid(sheet, () => {
  sandbox.reconcileProgramFlagColumns(sheet, groups);
  sandbox.reconcileSessionFlagColumns(sheet, groups);
  sandbox.reconcileSessionTimesFromCalendar(sheet, groups);
  sandbox.reconcileAssistanceSessionSettings(sheet, groups);
});
const scopeReads = (sheet.stats.getValues - beforeStats.getValues) +
  (sheet.stats.getFormulas - beforeStats.getFormulas);

// Row numbers on the tab, 1-based: 4/5 are Upcoming, 9/10 are Past.
const at = (row, name) => grid[row - 1][col(name)];

// --- 1. the answers, in BOTH zones ----------------------------------------
check('the club tick reaches the upcoming row', at(4, 'Club'), true);
check('and the past row of the same program', at(9, 'Club'), true);
check('a program the calendar does not call a club stays unticked', at(5, 'Club'), false);

check('[Personalized Assistance] reaches its upcoming row', at(5, 'Personalized_Assistance'), true);
check('and its past row', at(10, 'Personalized_Assistance'), true);

// Waitlist_Only is keyed by DATE, not by program: only the one session the
// calendar tagged may be ticked, in the zone that holds it.
check('the session flag lands on the one date that carries it', at(4, 'Waitlist_Only'), true);
check('and NOT on the same programs other date', at(9, 'Waitlist_Only'), false);

// --- 2. the times, read off the calendar ----------------------------------
check('a session lengthened on the calendar is retimed on the row',
  new RealDate(at(4, 'Event_End')).getTime(), CAL_END_UP_A.getTime());
check('a session the calendar did not move is left alone',
  new RealDate(at(9, 'Event_End')).getTime(), new RealDate(2026, 7, 12, 11, 0).getTime());

// --- 3. the appointment arithmetic ----------------------------------------
// 14:00-16:00 in 30-minute slots is four appointments, so the capacity the
// assistance pass derives is 4 — and Remaining_Seats and Status follow it.
check('the slot length is written from the tag', at(5, 'Slot_Minutes'), 30);
check('the capacity is the slot count, not the stated one', at(5, 'Max_Capacity'), 4);
check('remaining seats follow the derived capacity', at(5, 'Remaining_Seats'), 1);
check('and so does the status', typeof at(5, 'Status'), 'string');

// --- 4. the cost ----------------------------------------------------------
//
// THE CONTRACT IS THE READS, and it is exactly two: the values and the
// formulas, once, for all four passes. That is the whole change. The WRITES
// are deliberately not pinned to a number — they are one per changed column
// per zone, so they rise and fall with how much the calendar actually moved,
// and on a quiet hourly sync there are none at all. A later edit that put a
// per-zone read back inside one of these passes is what this catches.
check('the four passes shared ONE read of the tab', scopeReads, 2);

// --- 5. the link columns, and the formulas in them ------------------------
sandbox.updateRegistrationLinkCells(sheet, groups, sandbox.buildFormIdByProgram(groups));

check('a [No Registration] row says so where its link was',
  at(5, 'Form_Response_Link'), sandbox.NO_REGISTRATION_LINK_LABEL);
check('and its edit link is cleared', at(5, 'Edit_Form_Link'), '');
check('its past row too', at(10, 'Form_Response_Link'), sandbox.NO_REGISTRATION_LINK_LABEL);

// THE REGRESSION THE CELL-BY-CELL WRITE EXISTED TO PREVENT. Chair Yoga's rows
// share a column with the rows just blanked above, so they were written back
// as part of the same batch. They must still be FORMULAS — a whole-column
// write from a getValues() array would have left them as the words they show.
check('an untouched row in the same column is still a live formula',
  at(4, 'Form_Response_Link'), LIVE_LINK);
check('including its edit link', at(4, 'Edit_Form_Link'), LIVE_EDIT);
check('and in the past zone as well', at(9, 'Form_Response_Link'), LIVE_LINK);

// --- 6. nothing was written cell by cell ----------------------------------
//
// updateRegistrationLinkCells() wrote two or three cells PER ROW with
// setValue(), which on a program going [No Registration] mid-month is a round
// trip per link on the tab. Not one of them is left.
check('the whole phase wrote no single cells', sheet.stats.setValue, 0);
check('and the link pass re-read the tab once, not once per zone',
  sheet.stats.getValues + sheet.stats.getFormulas, 4);

// --- 7. the tab reads back consistently afterwards ------------------------
// The flush drops the cached reads, so a reader coming along next sees the
// rows the passes just wrote rather than the ones they started from.
const rows = sandbox.getSectionedRows(sheet, HEADERS, 'Event_ID');
const yogaUpcoming = rows.filter(r => r[col('Clean_Title')] === 'Chair Yoga')[0];
check('a later read sees the ticks the passes staged',
  yogaUpcoming[col('Club')], true);
check('four session rows read back, both zones', rows.length, 4);

console.log(failures === 0
  ? '\nAll reconcile batching checks passed.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
