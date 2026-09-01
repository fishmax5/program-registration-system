// Two decisions that were previously made by a caught exception, and one of
// them wrongly.
//
//   • WHAT AN UNOPENABLE FORM MEANS. "Could not be opened" covers a deleted
//     form, a trashed one, a form the syncing account simply cannot see, and a
//     transient Drive error — and three of those four are temporary. The sync
//     used to answer all four by building a replacement, which on an hourly
//     trigger produced one new form per run: a folder of same-named twins with
//     the dashboard pointing at one and the calendar events at another. What
//     is pinned here is the shape of the row written instead — a row that
//     still names its form and carries NO link, rather than one claiming the
//     program takes no registration.
//   • WHETHER A CALENDAR EVENT AGREES WITH THE DASHBOARD. Both sides look
//     healthy alone; only the comparison finds that residents and staff are
//     being sent to different sign-up pages.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'MMMM yyyy') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (fmt === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return d.toISOString();
    },
    sleep: () => {},
    DigestAlgorithm: { MD5: 'MD5' },
    computeDigest: (algo, raw) => {
      const out = [];
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (raw.charCodeAt(i) + ((h << 5) - h)) | 0;
      for (let i = 0; i < 16; i++) { out.push((h >> (i % 4 * 8)) & 0xff); h = (h * 31 + i) | 0; }
      return out;
    }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.writeEventRegistryRows = writeEventRegistryRows;
this.compareEventLinkToSession = compareEventLinkToSession;
this.findRegistrationLineInDescription = findRegistrationLineInDescription;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.NO_REGISTRATION_LINK_LABEL = NO_REGISTRATION_LINK_LABEL;
this.log = function () {};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const map = sandbox.getIndexMap(sandbox.HEADERS.Master_Program_Dashboard);
const CAL = 'narberth@group.calendar.google.com';

// A sheet stub that captures the one setValues() the writer makes.
function captureRow(formInfo) {
  let written = null;
  const sheet = {
    getLastRow: () => 10,
    getRange: () => ({ setValues: rows => { written = rows[0]; } })
  };
  const start = new Date(2026, 8, 15, 10, 0);
  const end = new Date(2026, 8, 15, 11, 0);
  const group = {
    cleanTitle: 'Chair Yoga', typeTag: 'Regular', locations: ['Narberth'], monthLabel: 'September 2026',
    capacity: 0, isClub: false, noRegistration: false, isAssistance: false, maxPerMonth: 0,
    sessions: [{ calendarId: CAL, locationName: 'Narberth', event: {
      getStartTime: () => start, getEndTime: () => end } }]
  };
  sandbox.writeEventRegistryRows(sheet, group, formInfo);
  return written;
}

// --- A FORM WE COULD NOT OPEN IS STILL THIS ROW'S FORM ---------------------
// The row that handleUnreachableGroupForm() writes: the ID it already had, and
// empty link cells because no URL could be read.
{
  const row = captureRow({ formId: 'FORM_UNREACHABLE', publishedUrl: '', editUrl: '' });
  check('the row keeps naming the form the group already has',
    row[map['Form_ID']], 'FORM_UNREACHABLE');
  check('the view link is left EMPTY, not filled with the no-registration words',
    row[map['Form_Response_Link']], '');
  check('and so is the edit link', row[map['Edit_Form_Link']], '');
}

// --- WHICH MATTERS BECAUSE THAT LABEL MEANS SOMETHING ELSE -----------------
// planDashboardLinkRepair() skips every row carrying it, so writing it here
// would put these rows beyond the reach of the repair that fixes them.
{
  const row = captureRow(null);
  check('a genuinely form-less row still says so in words',
    row[map['Form_Response_Link']], sandbox.NO_REGISTRATION_LINK_LABEL);
  check('and carries no form ID at all', row[map['Form_ID']], '');
}

// --- AN ORDINARY ROW IS UNCHANGED ------------------------------------------
{
  const row = captureRow({ formId: 'FORM_OK', publishedUrl: 'https://x/view', editUrl: 'https://x/edit' });
  check('a form with URLs still gets both hyperlink formulas',
    [String(row[map['Form_Response_Link']]).indexOf('https://x/view') !== -1,
      String(row[map['Edit_Form_Link']]).indexOf('https://x/edit') !== -1],
    [true, true]);
}

// --- THE CALENDAR-VS-DASHBOARD COMPARISON ----------------------------------
{
  const link = id =>
    sandbox.findRegistrationLineInDescription(
      `<a href="https://docs.google.com/forms/d/e/PUB/viewform#form=${id}">📝 Register</a>\n[Regular]`);

  check('an event naming the same form agrees',
    sandbox.compareEventLinkToSession(link('FORM_A'), { formId: 'FORM_A' }), 'agrees');
  check('an event naming a different form is the drift this exists to find',
    sandbox.compareEventLinkToSession(link('FORM_B'), { formId: 'FORM_A' }), 'disagrees');
  check('an event with no link of ours is reported apart from a disagreement',
    sandbox.compareEventLinkToSession(null, { formId: 'FORM_A' }), 'noLink');
  check('an event with no session row to compare against is neither',
    sandbox.compareEventLinkToSession(link('FORM_A'), null), 'noSession');
  check('nor is one whose session row has no form',
    sandbox.compareEventLinkToSession(link('FORM_A'), { formId: '' }), 'noSession');
}

console.log(failures === 0 ? '\nAll form replacement guard checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
