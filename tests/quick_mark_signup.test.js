// Registering somebody from the desk — the thing the front desk could not do
// at all before, and the one shape of program where doing it wrong puts two
// people in one chair.
//
// Caroline's ask was two sentences: "can we add Sign-Up for Future Program to
// Quick Mark", and "it would help a LOT to have that for the Personalized
// Assistance programs, because people ring up to book Wills and Computers."
// The second is what this file mostly pins: an appointment session is offered
// as a list of FREE TIMES, cut the same way the public form cuts them and with
// the booked ones already gone, so a desk and a form can never hand out the
// same slot.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const NOW = new Date(2026, 8, 16, 9, 0, 0); // Wed 16 Sep 2026
const RealDate = Date;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
        const ampm = h < 12 ? 'AM' : 'PM';
        return `${h % 12 === 0 ? 12 : h % 12}:${p(date.getMinutes())} ${ampm}`;
      }
      return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
    },
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: n => ({ __name: n }),
      getSpreadsheetTimeZone: () => 'America/New_York'
    })
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildQuickMarkIndex = buildQuickMarkIndex;
this.freeAppointmentTimesForChoice = freeAppointmentTimesForChoice;
this.readBookedAppointmentTimes = readBookedAppointmentTimes;
this.describeQuickMark = describeQuickMark;
this.readEarlierAppointmentAnswer = readEarlierAppointmentAnswer;
this.wantsEarlierAppointment = wantsEarlierAppointment;
this.EARLIER_APPOINTMENT_CHOICES = EARLIER_APPOINTMENT_CHOICES;
this.EARLIER_APPOINTMENT_VALUES = EARLIER_APPOINTMENT_VALUES;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.SHEET_NAMES = SHEET_NAMES;
this.QUICK_MARK_SESSION_KEY_SEPARATOR = QUICK_MARK_SESSION_KEY_SEPARATOR;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const regMap = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
const dashMap = sandbox.getIndexMap(sandbox.HEADERS.Master_Program_Dashboard);

function reg(name, location, event, date, time, status) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  row[regMap['Name']] = name;
  row[regMap['Location']] = location;
  row[regMap['Event']] = event;
  row[regMap['Event_Date']] = date;
  row[regMap['Event_Time']] = time || '';
  row[regMap['Event_ID']] = 'EV-WILLS-1013';
  row[regMap['Program_Status']] = status || 'Active';
  return row;
}

function session(title, location, start, end, assistance, slotMinutes) {
  const row = new Array(sandbox.HEADERS.Master_Program_Dashboard.length).fill('');
  row[dashMap['Clean_Title']] = title;
  row[dashMap['Location']] = location;
  row[dashMap['Event_Date']] = start;
  row[dashMap['Event_End']] = end;
  row[dashMap['Event_ID']] = 'EV-WILLS-1013';
  row[dashMap['Personalized_Assistance']] = !!assistance;
  if (slotMinutes) row[dashMap['Slot_Minutes']] = slotMinutes;
  return row;
}

// Low-Cost Wills with Heather: 12:30–2:00 on Tue 13 Oct, in half-hour chairs.
// Mrs Kaplan already has the 1:00, booked through the form.
const WILLS_START = new RealDate(2026, 9, 13, 12, 30);
const WILLS_END = new RealDate(2026, 9, 13, 14, 0);
const registrants = [reg('Ruth Kaplan', 'Narberth', 'Low-Cost Wills', WILLS_START, '1:00 PM – 1:30 PM')];
const sessions = [session('Low-Cost Wills', 'Narberth', WILLS_START, WILLS_END, true)];

const sectioned = (sheet, headers) =>
  (headers === sandbox.HEADERS.Master_Program_Dashboard ? sessions : registrants);
sandbox.readAllSectionedRows = sectioned;
// The index reads with the VALUES reader — see readAllSectionedRowValues().
sandbox.readAllSectionedRowValues = sectioned;
sandbox.readSimpleTable = () => [];
sandbox.readSimpleTableValues = () => [];
sandbox.readLunchScheduleRows = () => [];
sandbox.collectKnownMembers = () => ['Ruth Kaplan', 'Sam Weber'];
sandbox.getCateringPolicyForLocation = () => 'Always';
sandbox.log = () => {};

const ix = sandbox.buildQuickMarkIndex();
const SEP = sandbox.QUICK_MARK_SESSION_KEY_SEPARATOR;
const wills = ix.sessions.filter(s => s.label.indexOf('Low-Cost Wills') === 0 && s.value.indexOf('·') !== -1)[0];

check('an appointment session says so', wills && wills.byAppointment, true);
check('and offers the free chairs, earliest first, without the booked one',
  wills.times.map(t => t.label),
  ['12:30 PM – 1:00 PM', '1:30 PM – 2:00 PM']);
check('the value a booking is written under is the slot START',
  wills.times.map(t => t.value), ['12:30 PM', '1:30 PM']);

// A cancelled row releases its chair — staff cancel precisely so somebody else
// can have that time.
registrants.push(reg('Sam Weber', 'Narberth', 'Low-Cost Wills', WILLS_START, '12:30 PM – 1:00 PM', 'Cancelled'));
check('a cancelled booking gives the time back',
  sandbox.buildQuickMarkIndex().sessions
    .filter(s => s.byAppointment)[0].times.map(t => t.value),
  ['12:30 PM', '1:30 PM']);

// THE BOOKED SLOT TRAVELS WITH THE NAME. A Personalized Assistance morning is
// a list of times, and a dropdown of bare names is unreadable against it — the
// desk cannot tell who is at 10:30, and the same person holding two slots was
// one entry that marked whichever row sorted first.
registrants.push(reg('Ruth Kaplan', 'Narberth', 'Low-Cost Wills', WILLS_START, '1:30 PM – 2:00 PM'));
const slotted = sandbox.buildQuickMarkIndex();
// (Sam Weber's cancelled 12:30 row from the check above is on this session
// too — a cancelled registration still shows in the list, because correcting
// one is a thing the desk does.)
const willsKey = 'Narberth' + SEP + wills.value;
check('a registered person carries the slot they hold',
  slotted.namesBySession[willsKey].times, ['1:00 PM', '12:30 PM', '1:30 PM']);
check('and one person with two appointments is TWO entries, not one',
  slotted.namesBySession[willsKey].names, ['Ruth Kaplan', 'Sam Weber', 'Ruth Kaplan']);
check('both under the same identity key, so the roll still subtracts her once',
  slotted.namesBySession[willsKey].keys.filter(k => k === 'ruth kaplan').length, 2);

// A genuine duplicate — same person, same session, same slot — is still one
// entry. Deduping got FINER, not weaker.
registrants.push(reg('Ruth Kaplan', 'Narberth', 'Low-Cost Wills', WILLS_START, '1:30 PM – 2:00 PM'));
check('but the same slot twice is still one entry',
  sandbox.buildQuickMarkIndex().namesBySession[willsKey].names.length, 3);
registrants.pop();
registrants.pop();

// The ordinary program, which must be untouched by any of this: no times, no
// dropdown, and the desk can still put somebody on it.
sessions.push(session('Chair Yoga', 'Narberth', new RealDate(2026, 8, 23, 10, 0), new RealDate(2026, 8, 23, 11, 0), false));
const yoga = sandbox.buildQuickMarkIndex().sessions
  .filter(s => s.label.indexOf('Chair Yoga') === 0)[0];
check('an ordinary session is not booked by appointment', yoga.byAppointment, false);
check('and offers no times at all', yoga.times, []);

// A session whose date has gone: never offered, because an appointment nobody
// can keep is not a booking to hand out.
check('a past appointment session offers nothing',
  sandbox.freeAppointmentTimesForChoice({
    dateKey: '2026-08-11',
    appointment: { eventId: 'EV-OLD', start: new RealDate(2026, 7, 11, 12, 30), end: new RealDate(2026, 7, 11, 14, 0) }
  }, {}), []);

// "[Slots: 20]" is the provider saying how long they actually sit with people.
check('the per-program slot length is honoured',
  sandbox.freeAppointmentTimesForChoice({
    dateKey: '2026-10-13',
    appointment: { eventId: 'EV-X', start: WILLS_START, end: WILLS_END, slotMinutes: 45 }
  }, {}).map(t => t.label),
  ['12:30 PM – 1:15 PM', '1:15 PM – 2:00 PM']);

// What the desk is told it did. Registering marks nothing — that is the whole
// point of it being separate from Attended.
check('registering says so, and says nothing was marked',
  sandbox.describeQuickMark(false, false, false, true), 'registered (nothing marked yet)');
check('registering somebody who then turns up is just attendance',
  sandbox.describeQuickMark(true, false, false, true), 'attended');
check('and the lunch phrasings are unchanged',
  [sandbox.describeQuickMark(false, true, false, false), sandbox.describeQuickMark(false, false, true, false)],
  ['lunch (collected, not attending)', 'signed up for lunch (not served yet)']);

// "Would you take an earlier one?" — the fact Caroline was keeping by hand in
// the old form's "Confirmed Date/Time?" column. Blank has to mean NO: nobody
// who skipped an optional question has agreed to be telephoned about moving
// their appointment.
check('yes is recorded as the call-me value',
  sandbox.readEarlierAppointmentAnswer(sandbox.EARLIER_APPOINTMENT_CHOICES.YES),
  sandbox.EARLIER_APPOINTMENT_VALUES.YES);
check('no is recorded as its own answer, not as blank',
  sandbox.readEarlierAppointmentAnswer(sandbox.EARLIER_APPOINTMENT_CHOICES.NO),
  sandbox.EARLIER_APPOINTMENT_VALUES.NO);
check('an unanswered question records nothing',
  [sandbox.readEarlierAppointmentAnswer(''), sandbox.readEarlierAppointmentAnswer(null)], ['', '']);

check('and only the yes value reads as "ring them"',
  [sandbox.EARLIER_APPOINTMENT_VALUES.YES, sandbox.EARLIER_APPOINTMENT_VALUES.NO, '', 'anything else']
    .map(sandbox.wantsEarlierAppointment),
  [true, false, false, false]);
// Staff type into this column by hand far more often than anybody answers the
// form question, and what they type is "yes".
check('a staff "yes" typed into the column counts',
  ['yes', 'Yes please', 'call her', 'no', 'not this one'].map(sandbox.wantsEarlierAppointment),
  [true, true, true, false, false]);

console.log(failures === 0 ? '\nAll Quick Mark sign-up checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
