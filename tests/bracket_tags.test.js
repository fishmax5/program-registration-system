// A bracket in an event description is either a TAG LIST or a NOTE, and the
// parser has to tell them apart.
//
// Staff are told two things at once: put settings in brackets, and put
// clarifying info in the event description. Before isTagOnlyBracket() those
// instructions collided — every tag was detected by testing its regex against
// the whole bracket, so a bracket only had to CONTAIN one of these ordinary
// English words to switch the setting on. "[Film Club selection: Casablanca]"
// gave the program a standing club roster; "[Drop-in welcome]" deleted its
// registration form.
//
// The two halves of this file are the two halves of the rule: every real tag
// spelling still parses, and no sentence does.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

const sandbox = {
  // Muted: the parser deliberately LOGS every bracket it declines to read, and
  // the point of the second half of this file is that it declines a lot.
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
;this.parseSettingsBrackets = parseSettingsBrackets;
this.isTagOnlyBracket = isTagOnlyBracket;
this.parseEventTitle = parseEventTitle;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

/** The settings a bracket actually turned on, with the noise dropped. */
function settingsOf(text) {
  const r = sandbox.parseSettingsBrackets(text);
  const out = {};
  ['capacity', 'slotMinutes', 'maxPerMonth'].forEach(k => { if (r[k]) out[k] = r[k]; });
  ['isFixed', 'isShared', 'isClub', 'noRegistration', 'isAssistance'].forEach(k => { if (r[k]) out[k] = true; });
  if (r.explicitGrouping) out.explicitGrouping = r.explicitGrouping;
  return out;
}

console.log('\n-- every real tag still parses --');

check('[Club]', settingsOf('[Club]'), { isClub: true });
check('[Members Only] is the same tag', settingsOf('[Members Only]'), { isClub: true });
check('[Membership] is the same tag', settingsOf('[Membership]'), { isClub: true });
check('[Grouped]', settingsOf('[Grouped]'),
  { isFixed: true, explicitGrouping: 'Grouped' });
check('[Fixed] still reads as Grouped', settingsOf('[Fixed]'),
  { isFixed: true, explicitGrouping: 'Grouped' });
check('[Regular]', settingsOf('[Regular]'), { explicitGrouping: 'Regular' });
check('[Monthly] still reads as Regular', settingsOf('[Monthly]'), { explicitGrouping: 'Regular' });
check('[Cap: 12]', settingsOf('[Cap: 12]'), { capacity: 12 });
check('[All Locations]', settingsOf('[All Locations]'), { isShared: true });
check('[Shared]', settingsOf('[Shared]'), { isShared: true });
check('[Combined]', settingsOf('[Combined]'), { isShared: true });
check('[Multi-Site]', settingsOf('[Multi-Site]'), { isShared: true });
check('[All Sites]', settingsOf('[All Sites]'), { isShared: true });
check('[No Registration]', settingsOf('[No Registration]'), { noRegistration: true });
check('[Drop-In]', settingsOf('[Drop-In]'), { noRegistration: true });
check('[No Sign-ups]', settingsOf('[No Sign-ups]'), { noRegistration: true });
check('[Personalized Assistance]', settingsOf('[Personalized Assistance]'), { isAssistance: true });
check('[By Appointment]', settingsOf('[By Appointment]'), { isAssistance: true });
check('[1-on-1]', settingsOf('[1-on-1]'), { isAssistance: true });
check('[Slots: 20] implies appointments', settingsOf('[Slots: 20]'),
  { slotMinutes: 20, isAssistance: true });
check('[Max Per Month: 1]', settingsOf('[Max Per Month: 1]'), { maxPerMonth: 1 });

console.log('\n-- and tags still combine, comma-separated or not --');

check('[Cap: 12, Grouped]', settingsOf('[Cap: 12, Grouped]'),
  { capacity: 12, isFixed: true, explicitGrouping: 'Grouped' });
check('[Cap: 12] [Grouped] in two brackets', settingsOf('[Cap: 12] [Grouped]'),
  { capacity: 12, isFixed: true, explicitGrouping: 'Grouped' });
check('[Cap: 12 Grouped] with no comma', settingsOf('[Cap: 12 Grouped]'),
  { capacity: 12, isFixed: true, explicitGrouping: 'Grouped' });
check('[Club, Cap: 12, All Locations]', settingsOf('[Club, Cap: 12, All Locations]'),
  { capacity: 12, isShared: true, isClub: true });
check('[Personalized Assistance, Slots: 20, Max Per Month: 1]',
  settingsOf('[Personalized Assistance, Slots: 20, Max Per Month: 1]'),
  { slotMinutes: 20, maxPerMonth: 1, isAssistance: true });

console.log('\n-- and a NOTE in brackets changes nothing --');

// Each of these turned a setting on before isTagOnlyBracket() existed. The
// wording is drawn from what staff were actually told to write: the calendar
// naming-conventions email asks everyone to move clarifying info into the
// description, and the program titles here are real ones.
const notes = [
  '[Film Club selection: Casablanca]',      // used to become a club
  '[Book Club is reading Beloved]',         // used to become a club
  '[Drop-in welcome]',                      // used to delete the form
  '[No sign-up needed for members]',        // used to delete the form
  '[Combined with the JCC]',                // used to pool every location
  '[Shared with Ashbridge this week]',      // used to pool every location
  '[Multi-Site event in the spring]',       // used to pool every location
  '[Call the office for an appointment]',   // used to become 30-min slots
  '[Appointments start at 1pm]',            // used to become 30-min slots
  '[Regular attendees only]',               // used to force one form a month
  '[Note: this week only]',
  '[Bring a friend]'
];
notes.forEach(note => check(`${note} sets nothing`, settingsOf(note), {}));

console.log('\n-- a note alongside a real tag leaves the real tag alone --');

// Separate brackets are read separately: the tag one is honoured, the prose
// one is not. This is the shape staff will actually end up with.
check('[Grouped] beside a note', settingsOf('[Grouped] [Film Club selection: Casablanca]'),
  { isFixed: true, explicitGrouping: 'Grouped' });
check('a note beside [Cap: 12]', settingsOf('[Drop-in welcome] [Cap: 12]'), { capacity: 12 });

// ...but a note that has swallowed a tag into the SAME bracket is all note.
// Honouring half a sentence is worse than honouring none of it: "Film Club
// selection" is not a request for a standing club roster.
check('one bracket holding both is all note',
  settingsOf('[Club selection: Casablanca]'), {});

console.log('\n-- isTagOnlyBracket directly --');

check('empty bracket is not a tag list', sandbox.isTagOnlyBracket(''), false);
check('whitespace is not a tag list', sandbox.isTagOnlyBracket('   '), false);
check('"Club" is', sandbox.isTagOnlyBracket('Club'), true);
check('"Club, Grouped" is', sandbox.isTagOnlyBracket('Club, Grouped'), true);
check('"Club selection" is not', sandbox.isTagOnlyBracket('Club selection'), false);
check('separators alone survive stripping', sandbox.isTagOnlyBracket('Club / Grouped'), true);

console.log('\n-- titles carrying legacy brackets follow the same rule --');

// parseEventTitle() runs the same parser over the TITLE for backwards
// compatibility, so a program literally named "Film Club" must not pick up
// a roster from its own name. (It never could — the name has no brackets —
// but a title someone bracketed by hand is the case that matters.)
check('"Film Club" is just a name',
  sandbox.parseEventTitle('Film Club').legacyIsClub, false);
check('...and keeps its whole name', sandbox.parseEventTitle('Film Club').cleanTitle, 'Film Club');
check('"Yoga [Cap: 12]" still reads its legacy cap',
  sandbox.parseEventTitle('Yoga [Cap: 12]').legacyCapacity, 12);
check('...and drops the bracket from the name',
  sandbox.parseEventTitle('Yoga [Cap: 12]').cleanTitle, 'Yoga');
check('"Yoga [with Rosalie]" keeps its cap unset',
  sandbox.parseEventTitle('Yoga [with Rosalie]').hasLegacyBrackets, false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
