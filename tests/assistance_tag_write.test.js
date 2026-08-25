// Ticking Personalized_Assistance has to reach the calendar — and the calendar
// has to read back what was written.
//
// The bug this file pins down: a bracket is a TAG LIST or a NOTE
// (isTagOnlyBracket()), and the two halves of the round trip disagreed about
// which was which. parseSettingsBrackets() ignored a prose bracket, exactly as
// intended, while setFlagBracketInDescription() still counted the word inside
// it as "already tagged" and wrote nothing. On a program whose description
// said "[Call the office for an appointment]" the tick therefore stamped 0
// events, the next sync read the calendar, found no tag, and unticked the box.
//
// The second half is the arithmetic that tick implies: an appointment slot
// holds one person, so a session holds one per slot.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const sandbox = {
  // Muted: the parser LOGS every bracket it declines to read, and this file
  // hands it plenty.
  console: { log: () => {} },
  Utilities: {
    formatDate: d => d.toISOString(),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
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
;this.ASSISTANCE_WORDS_REGEX = ASSISTANCE_WORDS_REGEX;
this.ASSISTANCE_TAG = ASSISTANCE_TAG;
this.CLUB_WORDS_REGEX = CLUB_WORDS_REGEX;
this.CLUB_TAG = CLUB_TAG;
this.APPOINTMENT_SLOT_CAPACITY = APPOINTMENT_SLOT_CAPACITY;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const addAssistance = text => sandbox.setFlagBracketInDescription(
  text, sandbox.ASSISTANCE_WORDS_REGEX, sandbox.ASSISTANCE_TAG, true);
const removeAssistance = text => sandbox.setFlagBracketInDescription(
  text, sandbox.ASSISTANCE_WORDS_REGEX, sandbox.ASSISTANCE_TAG, false);
const readsAsAssistance = text => sandbox.parseSettingsBrackets(text).isAssistance;

// --- the write half: a note must not pass for a tag -------------------------
const prose = 'Computer Tech Support with Ari.\n[Call the office for an appointment]';
const stamped = addAssistance(prose);
check('the tag is added beside the note', stamped, `${prose}\n[${sandbox.ASSISTANCE_TAG}]`);
check('and the note itself is left word for word', stamped.indexOf(prose), 0);
check('the note alone never read as the tag', readsAsAssistance(prose), false);
check('the stamped description does', readsAsAssistance(stamped), true);

// The same trap on the club flag, which is where the rule came from.
const filmClub = 'Tuesday matinee.\n[Film Club selection: Casablanca]';
check('a club NOTE does not block the club tag either',
  sandbox.setFlagBracketInDescription(filmClub, sandbox.CLUB_WORDS_REGEX, sandbox.CLUB_TAG, true),
  `${filmClub}\n[${sandbox.CLUB_TAG}]`);

// --- and a real tag is still left alone ------------------------------------
const alreadyTagged = 'Wills clinic.\n[By Appointment]';
check('somebody else\'s spelling of the tag is not rewritten',
  addAssistance(alreadyTagged), alreadyTagged);
check('a tag sharing a bracket is not duplicated',
  addAssistance('[Cap: 6, Personalized Assistance]'), '[Cap: 6, Personalized Assistance]');
check('an empty description gets the bare tag',
  addAssistance('   '), `[${sandbox.ASSISTANCE_TAG}]`);

// --- the removal half ------------------------------------------------------
check('untagging takes the tag out and keeps the rest of the bracket',
  removeAssistance('[Cap: 6, Personalized Assistance]'), '[Cap: 6]');
check('untagging drops a bracket that held nothing else',
  removeAssistance('Wills clinic.\n[By Appointment]').trim(), 'Wills clinic.');
check('untagging leaves a NOTE completely alone', removeAssistance(prose), prose);
check('and no longer claims that note will re-tick the box',
  sandbox.descriptionStillCarriesFlag(prose, sandbox.ASSISTANCE_WORDS_REGEX), false);
check('a tag it genuinely could not remove is still reported',
  sandbox.descriptionStillCarriesFlag('[Appointments]', sandbox.ASSISTANCE_WORDS_REGEX), true);

// --- what the tick SAYS it did ---------------------------------------------
const flagOf = column => sandbox.getProgramFlagByColumn(column);
check('an assistance tick does not announce a club',
  sandbox.describeFlagState(flagOf('Personalized_Assistance'), 'Computer Tech Support', true),
  '"Computer Tech Support" is booked by appointment');
check('unticking it says the opposite',
  sandbox.describeFlagState(flagOf('Personalized_Assistance'), 'Computer Tech Support', false),
  '"Computer Tech Support" is booked by date again');
check('a club tick still says club',
  sandbox.describeFlagState(flagOf('Club'), 'Book Club', true), '"Book Club" is a club');
check('no-registration keeps its own words',
  sandbox.describeFlagState(flagOf('No_Registration'), 'Coffee Hour', true),
  '"Coffee Hour" takes no registration');

// --- one person per slot ---------------------------------------------------
check('a slot holds one person', sandbox.APPOINTMENT_SLOT_CAPACITY, 1);
check('an untagged capacity is the slot count',
  sandbox.resolveAppointmentCapacity(0, 6, 'Low-Cost Wills'), 6);
check('a smaller stated cap still wins — the provider keeps time back',
  sandbox.resolveAppointmentCapacity(4, 6, 'Low-Cost Wills'), 4);
check('a cap larger than the slots is clamped — there is no second chair',
  sandbox.resolveAppointmentCapacity(20, 6, 'Low-Cost Wills'), 6);
check('a session with no slots falls back to what was stated',
  sandbox.resolveAppointmentCapacity(3, 0, 'Low-Cost Wills'), 3);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
