// WHAT A FORM SAYS ABOUT LUNCH, and what an appointment form does with it.
//
// Five things are pinned here, all of them things a respondent or a member of
// staff read off a live form:
//
//   1. THE MENU BESIDE A DATE NAMES ITSELF — "(Lunch: Chicken Parmesan)" —
//      and the plain session label is still recoverable from it, because that
//      label is the join key every registration is matched back by.
//   2. A FORM SAYS WHERE IT IS. Narberth and Ashbridge are addresses, not
//      names, to the person the form was built to reach.
//   3. AN APPOINTMENT PROGRAM ASKS ABOUT LUNCH on the days one is served, and
//      not on the days none is.
//   4. "[Cap: 1]" ON A ONE-TO-ONE PROGRAM MEANS ONE PERSON PER APPOINTMENT,
//      not a session that goes full on its first booking.
//   5. A FORM WHOSE LUNCH SHAPE CHANGED IS RE-EXAMINED even when not one of
//      its dates has moved — the fingerprint has to notice.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(date, tz, pattern) {
  if (pattern === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-` +
      `${String(date.getDate()).padStart(2, '0')}`;
  }
  if (pattern === 'EEE, MMM d, yyyy') {
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  return date.toISOString();
}

const properties = {};
const logs = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: fmt,
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    // Enough of a digest to be a FUNCTION of its input, which is all the
    // fingerprint checks below need of it.
    computeDigest: (alg, payload) => Array.from(Buffer.from(String(payload))),
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in properties ? properties[k] : null),
      setProperty: (k, v) => { properties[k] = v; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
// `const` at the top of a script is not a property of the global object, so
// the handful this file reads are re-exported the way the other tests do it.
vm.runInContext(src + `
;this.CAPACITY_HINT_SUFFIX = CAPACITY_HINT_SUFFIX;
this.APPOINTMENT_LUNCH_CHOICES = APPOINTMENT_LUNCH_CHOICES;
this.NO_LUNCH_HINT = NO_LUNCH_HINT;
this.LOCATION_ADDRESSES = LOCATION_ADDRESSES;
`, sandbox, { filename: 'Code.gs' });

// The two things that would otherwise reach for the spreadsheet: the menu
// index and the per-location catering policy.
const MENU = {};
sandbox.getMealInfoIndex = () => MENU;
sandbox.log = message => logs.push(String(message));
const POLICIES = { Narberth: 'Always', Ashbridge: 'By exception', Zoom: 'Never' };
sandbox.getCateringPolicyForLocation = name => POLICIES[String(name || '').trim()] || 'Always';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const monday = new Date(2026, 8, 14);   // Mon Sep 14 2026
const tuesday = new Date(2026, 8, 15);
const wednesday = new Date(2026, 8, 16);
MENU['2026-09-14|Narberth'] = { type: 'Hot', shorthand: 'Chicken Parm', description: 'Chicken Parmesan' };
MENU['2026-09-15|Narberth'] = { type: 'Not Serving', shorthand: '', description: '' };

// --- 1. the menu names itself ----------------------------------------------
const hotLabel = sandbox.formatDateLabelWithMeal(monday, 'Narberth', '', false, 'Chair Yoga', false);
check('the dish is announced as the lunch it is', hotLabel, 'Mon, Sep 14, 2026 — (Lunch: Chicken Parm)');
check('a not-serving day says so in the same brackets',
  sandbox.formatDateLabelWithMeal(tuesday, 'Narberth', '', false, 'Chair Yoga', false),
  'Tue, Sep 15, 2026 — (No Lunch Served)');
check('a day with no menu row yet is just a date',
  sandbox.formatDateLabelWithMeal(wednesday, 'Narberth', '', false, 'Chair Yoga', false),
  'Wed, Sep 16, 2026');

// THE JOIN KEY SURVIVES. Every registration is matched back to its session by
// the plain label, so the decoration has to come off cleanly — including off a
// label that also carries the capacity suffix.
check('the plain label is still recoverable', sandbox.stripMealHint(hotLabel), 'Mon, Sep 14, 2026');
const fullLabel = sandbox.formatDateLabelWithMeal(monday, 'Narberth',
  sandbox.CAPACITY_HINT_SUFFIX, false, 'Chair Yoga', false);
check('...and off a full session too', sandbox.stripMealHint(fullLabel), 'Mon, Sep 14, 2026');
check('the candidate list still offers the plain label',
  sandbox.sessionLabelCandidates(fullLabel).indexOf('Mon, Sep 14, 2026') !== -1, true);

// --- 2. a form says where it is ---------------------------------------------
check('Narberth is an address', sandbox.describeLocationWithAddress('Narberth'),
  'Narberth — 100 Conway Avenue, 2nd Floor, Narberth, PA');
check('Ashbridge is an address', sandbox.describeLocationWithAddress('Ashbridge'),
  'Ashbridge — Ashbridge House, Ashbridge Park, Bryn Mawr, PA');
check('a location we have no address for is left exactly as it was',
  sandbox.describeLocationWithAddress('Zoom'), 'Zoom');

const description = sandbox.buildFormDescription(['Narberth'], [hotLabel], false, true, {});
check('the address is at the top of the form',
  description.indexOf('100 Conway Avenue') !== -1, true);
// THE DESCRIPTION DOES NOT EXPLAIN THE DASH. It used to carry a paragraph
// glossing "(Lunch: …)" and "(No Lunch Served)"; the brackets say what they
// are, and a form that opens with a footnote about its own punctuation is a
// form nobody reads to the bottom of.
check('the description no longer glosses the meal hint',
  description.indexOf('follows the dash'), -1);
check('a not-serving date still says so beside the date itself',
  sandbox.buildFormDescription(['Narberth'], ['Tue, Sep 15, 2026 — (No Lunch Served)'], false, true, {})
    .indexOf('(No Lunch Served)') !== -1, true);

const shared = sandbox.buildFormDescription(['Narberth', 'Ashbridge'], [hotLabel], false, true, {});
check('a cross-location form gives both addresses',
  shared.indexOf('100 Conway Avenue') !== -1 && shared.indexOf('Ashbridge Park') !== -1, true);

// --- 3. an appointment form and lunch ---------------------------------------
const paContext = {
  locations: ['Narberth'], isAssistance: true,
  sessions: [{ date: monday, location: 'Narberth' }]
};
const paDryDay = {
  locations: ['Narberth'], isAssistance: true,
  sessions: [{ date: tuesday, location: 'Narberth' }]
};
const paZoom = {
  locations: ['Zoom'], isAssistance: true,
  sessions: [{ date: monday, location: 'Zoom' }]
};
check('an appointment on a catered day is asked about lunch',
  sandbox.formWantsLunchQuestions(paContext.locations, sandbox.contextHasLunchDates(paContext)), true);
check('an appointment on a Not-Serving day is not',
  sandbox.formWantsLunchQuestions(paDryDay.locations, sandbox.contextHasLunchDates(paDryDay)), false);
check('and a location that never caters is never asked',
  sandbox.formWantsLunchQuestions(paZoom.locations, sandbox.contextHasLunchDates(paZoom)), false);

check('a Yes on that question orders a meal', sandbox.readAppointmentLunchAnswer(
  sandbox.APPOINTMENT_LUNCH_CHOICES.YES), 'Yes - Lunch');
check('a No does not', sandbox.readAppointmentLunchAnswer(
  sandbox.APPOINTMENT_LUNCH_CHOICES.NO), 'No Lunch');
// NOT ANSWERING IS NOT ORDERING. The question is optional, and a portion
// nobody eats is what a generous reading of a blank would cost the kitchen.
check('and a blank is not an order', sandbox.readAppointmentLunchAnswer(''), 'No Lunch');

const paDescription = sandbox.buildFormDescription(['Narberth'], [hotLabel], false, true,
  { isAssistance: true });
check('the appointment form invites them to stay for it',
  paDescription.indexOf('stay for it') !== -1, true);
check('a dry appointment form does not',
  sandbox.buildFormDescription(['Narberth'], ['Tue, Sep 15, 2026 — (No Lunch Served)'], false, false,
    { isAssistance: true }).indexOf('stay for it'), -1);

// --- 4. [Cap: 1] on a one-to-one program ------------------------------------
// Six half-hour appointments in an afternoon, tagged the way staff tag these.
check('Cap:1 means one person per appointment, not one per afternoon',
  sandbox.resolveAppointmentCapacity(1, 6, 'Low-Cost Wills'), 6);
check('...and it says so where somebody can see why',
  logs.some(l => l.indexOf('one person per APPOINTMENT') !== -1), true);
check('a genuine session cap below the slot count still wins',
  sandbox.resolveAppointmentCapacity(4, 6, 'Low-Cost Wills'), 4);
check('a cap above the slot count is still clamped to the times that exist',
  sandbox.resolveAppointmentCapacity(20, 6, 'Low-Cost Wills'), 6);
check('no cap at all is still the slot count',
  sandbox.resolveAppointmentCapacity(0, 6, 'Low-Cost Wills'), 6);
// A session that really does hold one appointment is unaffected: one slot,
// cap of one, capacity one. There is nothing to disambiguate.
check('a one-slot session is one appointment either way',
  sandbox.resolveAppointmentCapacity(1, 1, 'Medicare'), 1);

// --- 5. the fingerprint notices a changed lunch shape ------------------------
const labels = ['Mon, Sep 14, 2026'];
check('the shape of a catered form', sandbox.formLunchShapeKey(
  { locations: ['Narberth'] }, true), 'lunch');
check('the shape of a form with nothing to eat on it', sandbox.formLunchShapeKey(
  { locations: ['Narberth'] }, false), 'no-lunch');
check('the shape of an appointment form that serves lunch', sandbox.formLunchShapeKey(
  { locations: ['Narberth'], isAssistance: true }, true), 'appointment+lunch');
check('the shape of the lunch-only form', sandbox.formLunchShapeKey(
  { locations: ['Narberth'], isLunchOnly: true }, true), 'lunch-only');

// THE POINT OF ALL OF THAT: a menu typed for dates a form already covers
// changes what the form should ASK without changing one date label, and the
// hash that decides whether to open the form has to move with it.
const before = sandbox.computeFormLabelFingerprint(labels, [], 'no-lunch');
const after = sandbox.computeFormLabelFingerprint(labels, [], 'lunch');
check('the same dates with a different lunch shape hash differently',
  before === after, false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
