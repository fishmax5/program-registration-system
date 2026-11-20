// FOLDING AND ONCE-A-DAY NOTES (sections 15, 29, 88), Nov 2026.
//
// Two kinds of digest noise this pins out:
//   - the waitlist: one line per person per date (306 lines in two minutes
//     on Nov 18 for one full weekly class) is now ONE line per program and
//     reason, naming each person once and the span of dates;
//   - the lunch warnings re-stated by every sync ("4×"): an identical line in
//     a once-a-day category is filed the first time and dropped after that,
//     while a line in any other category still counts its repeats.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${label}`);
  else { failures++; console.log(`FAIL ${label}\n     expected ${e}\n     got      ${a}`); }
}

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (fmt === 'HH:mm') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return d.toISOString();
    },
    getUuid: () => 'uuid', sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; },
    getProperties: () => Object.assign({}, props),
    getKeys: () => Object.keys(props)
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.noteForAdmin = noteForAdmin;
this.noteForAdminGrouped = noteForAdminGrouped;
this.flushAdminDigest = flushAdminDigest;
this.describeWaitlistedGroup_ = describeWaitlistedGroup_;
this.spoolOfficeNote = spoolOfficeNote;
this.readOfficeDigestDay = readOfficeDigestDay;
this.officeDigestDateKey = officeDigestDateKey_;
this.resetOfficeDigestSpoolCache = function () { __officeDigestSpool = null; };
`, sandbox, { filename: 'program.gs' });
sandbox.log = () => {};

const today = sandbox.officeDigestDateKey(new Date());

// --- the waitlist line ------------------------------------------------------
const weds = [2, 9, 16].map(d => new Date(2026, 11, d));
const line = sandbox.describeWaitlistedGroup_('Chair Yoga (Narberth)', 'capacity 12 is full.', [
  { who: 'Rita Sherry (Attendee)', date: weds[1] },
  { who: 'Rita Sherry (Attendee)', date: weds[0] },
  { who: 'Lynn Ray (Attendee)', date: weds[2] },
  { who: 'Lynn Ray (Attendee)', date: weds[0] }
]);
check('one line names the program, the span of dates, the reason and each person once',
  line.indexOf('Chair Yoga (Narberth) for 3 dates, ') === 0 &&
  line.indexOf('capacity 12 is full. Waitlisted: 2 people: Rita Sherry (Attendee), Lynn Ray (Attendee).') !== -1,
  true);
check('a single person on a single date reads plainly',
  sandbox.describeWaitlistedGroup_('Art (Ashbridge)', 'capacity 8 is full.',
    [{ who: 'Ada (Attendee)', date: weds[0] }]).indexOf(' for ') !== -1 &&
  sandbox.describeWaitlistedGroup_('Art (Ashbridge)', 'capacity 8 is full.',
    [{ who: 'Ada (Attendee)', date: weds[0] }]).indexOf('Waitlisted: Ada (Attendee).') !== -1,
  true);

// --- folding through the collector ------------------------------------------
Object.keys(props).forEach(k => delete props[k]);
sandbox.resetOfficeDigestSpoolCache();
const render = items => sandbox.describeWaitlistedGroup_('Chair Yoga (Narberth)', 'capacity 12 is full.', items);
for (let p = 0; p < 34; p++) {
  weds.forEach(d => sandbox.noteForAdminGrouped('Waitlisted registrants', 'Chair Yoga|full',
    { who: `Person ${p} (Attendee)`, date: d }, render));
}
sandbox.flushAdminDigest('Registration sync');
let day = sandbox.readOfficeDigestDay(today);
check('34 people on 3 dates file ONE waitlist line, not 102', day.length, 1);

// --- once a day ---------------------------------------------------------------
const lunchLine = '7 meal(s) for 7 person(s) are needed at Ashbridge on Thu, Jan 7, 2027, but Lunch_Schedule has no Hot/Cold row for it.';
for (let run = 0; run < 4; run++) {
  sandbox.noteForAdmin('Lunch needed with no menu set', lunchLine);
  sandbox.noteForAdmin('Forms that could not be opened', 'form 1a2b');
  sandbox.flushAdminDigest('Registration sync');
}
day = sandbox.readOfficeDigestDay(today);
const lunch = day.filter(e => e.s.indexOf('Lunch needed with no menu set') === 0);
const forms = day.filter(e => e.s.indexOf('Forms that could not be opened') === 0);
check('a lunch warning re-stated by four syncs is filed once', lunch.map(e => e.n), [1]);
check('...while an ordinary repeated note still counts its repeats', forms.map(e => e.n), [4]);
sandbox.noteForAdmin('Lunch needed with no menu set', lunchLine.replace('7 meal(s) for 7', '8 meal(s) for 8'));
sandbox.flushAdminDigest('Registration sync');
check('a lunch warning that CHANGED is filed as new',
  sandbox.readOfficeDigestDay(today).filter(e => e.s.indexOf('Lunch needed with no menu set') === 0).length, 2);

console.log(failures ? `\n${failures} failure(s)` : '\nAll admin digest folding checks passed.');
process.exit(failures ? 1 : 0);
