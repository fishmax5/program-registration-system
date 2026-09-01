// "The correct date, and then 12/30/1899 where the time should be."
//
// That is what a registrant row looks like once Sheets has eaten its
// Event_Time. The column holds WORDS — "10:00 AM – 11:30 AM" — but a session
// with no usable end time writes the start on its own, and a lone "10:00 AM"
// is a thing Sheets is only too happy to read as a time value: 30 Dec 1899,
// the epoch it counts times from, shown as a date beside a date that was
// right all along.
//
// Two halves, both pinned here: the range must survive an end time stored as
// a bare clock time (which is how the 1899 value gets into Event_End in the
// first place), and everything that READS a time has to keep working on the
// cells already coerced — the appointment match above all, where a slot that
// reads as gibberish reads as FREE.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const NOW = new Date(2026, 8, 16, 9, 0, 0); // Wed 16 Sep 2026
const RealDate = Date;

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'h:mm a') {
        const h = date.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${p(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return date.toISOString();
    },
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.formatTimeRange = formatTimeRange;
this.eventTimeLabelOf = eventTimeLabelOf;
this.clockTimeOnDayOf = clockTimeOnDayOf;
this.appointmentStartLabelOf = appointmentStartLabelOf;
this.buildAppointmentSlots = buildAppointmentSlots;
this.readBookedAppointmentTimes = readBookedAppointmentTimes;
this.backfillRegistrantEventTimes = backfillRegistrantEventTimes;
this.stampTextColumns = stampTextColumns;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// The shape a coerced cell reads back as: a clock time on the Sheets epoch.
const epochTime = (h, m) => new RealDate(1899, 11, 30, h, m);

const START = new RealDate(2026, 9, 13, 10, 0);   // Tue 13 Oct, 10:00 AM
const END = new RealDate(2026, 9, 13, 11, 30);

// --- the range survives an end time stored as a bare clock time -------------

check('an ordinary session still reads as a range',
  sandbox.formatTimeRange(START, END), '10:00 AM – 11:30 AM');

check('an end stored as a clock time keeps the range instead of collapsing it',
  sandbox.formatTimeRange(START, epochTime(11, 30)), '10:00 AM – 11:30 AM');

check('an end that is genuinely before the start is still no range at all',
  sandbox.formatTimeRange(START, new RealDate(2026, 9, 13, 9, 0)), '10:00 AM');

check('no end at all is the start on its own',
  sandbox.formatTimeRange(START, ''), '10:00 AM');

check('a clock time is moved onto the session day, a real datetime is left alone',
  [sandbox.clockTimeOnDayOf(epochTime(11, 30), START).getTime(),
    sandbox.clockTimeOnDayOf(END, START).getTime()],
  [new RealDate(2026, 9, 13, 11, 30).getTime(), END.getTime()]);

// --- reading a cell Sheets has already eaten --------------------------------

check('a coerced Event_Time reads back as the words it held',
  sandbox.eventTimeLabelOf(epochTime(10, 0)), '10:00 AM');

check('a text Event_Time is handed back untouched',
  sandbox.eventTimeLabelOf(' 10:00 AM – 11:30 AM '), '10:00 AM – 11:30 AM');

check('a blank stays blank', [sandbox.eventTimeLabelOf(''), sandbox.eventTimeLabelOf(null)], ['', '']);

check('the slot match reads a coerced cell as its own start time',
  sandbox.appointmentStartLabelOf(epochTime(13, 0)), '1:00 PM');

// A booked chair whose cell has been coerced must still read as BOOKED — the
// failure this pins is two people in one chair, not a cosmetic one.
const regMap = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
function reg(name, time) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  row[regMap['Name']] = name;
  row[regMap['Event_ID']] = 'EV-WILLS-1013';
  row[regMap['Event_Date']] = START;
  row[regMap['Event_Time']] = time;
  row[regMap['Program_Status']] = 'Active';
  return row;
}
const booked = sandbox.readBookedAppointmentTimes([reg('Ruth Kaplan', epochTime(13, 0))]);
check('a coerced appointment cell still holds its slot',
  Array.from(booked['EV-WILLS-1013'] || []), ['1:00 PM']);

// --- the slots themselves ----------------------------------------------------

check('an afternoon whose end is a clock time is still cut into its chairs',
  sandbox.buildAppointmentSlots(new RealDate(2026, 9, 13, 12, 30), epochTime(14, 0), 30)
    .map(s => s.startLabel),
  ['12:30 PM', '1:00 PM', '1:30 PM']);

// --- the render heals what is already on the tab ------------------------------

const rows = [reg('Ruth Kaplan', epochTime(10, 0)), reg('Sam Weber', '10:00 AM – 11:30 AM')];
sandbox.backfillRegistrantEventTimes(null, sandbox.HEADERS.Registrant_Dash, rows);
check('the next render writes the words back, and leaves good rows alone',
  rows.map(r => r[regMap['Event_Time']]), ['10:00 AM', '10:00 AM – 11:30 AM']);

// --- and the column is stamped as text BEFORE anything lands in it -----------

const calls = [];
const fakeSheet = {
  getName: () => 'Registrant_Dash',
  getRange: (row, col, numRows) => ({
    setNumberFormat: fmt => { calls.push({ row, col, numRows, fmt }); }
  })
};
sandbox.stampTextColumns(fakeSheet, [4], 3, 2);
check('the time column is stamped plain text over its own rows',
  calls, [{ row: 3, col: 4, numRows: 2, fmt: '@' }]);

const emptyCalls = [];
const emptySheet = {
  getName: () => 'Registrant_Dash',
  getRange: (row, col, numRows) => ({ setNumberFormat: fmt => { emptyCalls.push({ row, col, numRows, fmt }); } })
};
sandbox.stampTextColumns(emptySheet, [4], 3, 0);
check('an empty band is stamped too, so the next single write stays text',
  emptyCalls, [{ row: 3, col: 4, numRows: 1, fmt: '@' }]);

console.log(failures === 0 ? '\nAll Event_Time checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
