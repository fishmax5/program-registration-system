// What "🔗 Rewrite Event Links" can and cannot recognize in a description that
// Google Calendar has re-encoded.
//
// THE BUG THIS FILE EXISTS FOR: registration links were switched from "Hide
// link" back to "Show link", the rewrite was run, and events came back
// carrying BOTH the new "📝 Register for ..." link and the old "🚧
// Registration Not Yet Open" notice underneath it. The notice survived because
// the Calendar web UI had re-encoded this script's own stamp — "🚧" arriving
// back as "&#128679;", the space after it as "&nbsp;" — and a pattern that
// only knew the literal characters no longer matched its own line.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console,
  Utilities: { formatDate: () => '', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} },
  Session: { getScriptTimeZone: () => 'America/New_York' },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.stripAllRegistrationLines = stripAllRegistrationLines;
this.prependRegistrationLine = prependRegistrationLine;
this.buildRegistrationLinkLine = buildRegistrationLinkLine;
this.findRegistrationLineInDescription = findRegistrationLineInDescription;
this.REGISTRATION_NOT_OPEN_LINE = REGISTRATION_NOT_OPEN_LINE;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const NOTICE = 'Registration Not Yet Open';
/** True when the notice is gone from what the strip left behind. */
function noticeGone(description) {
  return !new RegExp(NOTICE, 'i').test(sandbox.stripAllRegistrationLines(description).text);
}
/** How many notices the strip says it removed — callers act on this count. */
function noticesRemoved(description) {
  return sandbox.stripAllRegistrationLines(description).noticesRemoved;
}

console.log('\n-- the notice comes off in every encoding Calendar hands back --');

check('as this script writes it', noticeGone(`🚧 ${NOTICE}\n\nRoom 12`), true);
check('re-flowed into a <div>', noticeGone(`<div>🚧 ${NOTICE}</div><div>Room 12</div>`), true);
check('with <br> line breaks', noticeGone(`🚧 ${NOTICE}<br><br>Room 12`), true);
check('emoji as a numeric entity', noticeGone(`&#128679; ${NOTICE}\n\nRoom 12`), true);
check('emoji as a hex entity', noticeGone(`&#x1F6A7; ${NOTICE}\n\nRoom 12`), true);
check('space as &nbsp;', noticeGone(`🚧&nbsp;${NOTICE}\n\nRoom 12`), true);
check('both, inside a <div>', noticeGone(`<div>&#128679;&nbsp;${NOTICE}</div><div>Room 12</div>`), true);
check('entity-stamped and mid-line', noticeGone(`Room 12<br>&#128679; ${NOTICE}`), true);
check('stamp lost entirely, words alone on the line', noticeGone(`${NOTICE}\n\nRoom 12`), true);
check('two of them, both counted', noticesRemoved(`🚧 ${NOTICE}\n&#128679;&nbsp;${NOTICE}\nRoom 12`), 2);

console.log('\n-- and takes nothing else with it --');

const kept = sandbox.stripAllRegistrationLines(
  `&#128679;&nbsp;${NOTICE}\n\nRoom 12, back entrance\n[Cap: 12] [Grouped]\nAsk for Dana`);
check('every other line survives byte for byte', kept.text,
  'Room 12, back entrance\n[Cap: 12] [Grouped]\nAsk for Dana');
check('a sentence a person typed about registration is not a notice',
  sandbox.stripAllRegistrationLines('We will announce when Registration Not Yet Open changes.').noticesRemoved, 0);

console.log('\n-- the orphaned "Register for" label goes the same way --');

check('label with an entity-encoded stamp',
  /Register for/.test(sandbox.stripAllRegistrationLines(
    '&#128221;&nbsp;Register for Chair Yoga — September 2026\n\nRoom 12').text), false);
check('a line about registering that carries no stamp is left alone',
  sandbox.stripAllRegistrationLines('Register for this one at the front desk.').text,
  'Register for this one at the front desk.');

console.log('\n-- opening registration again leaves ONE line at the top --');

// The whole failure, end to end: an event stamped while registration was held
// back, re-encoded by a hand edit, then rewritten once the links were switched
// back on. What comes out must be the link and nothing else of ours.
const stale = `<div>&#128679;&nbsp;${NOTICE}</div><div>Room 12, back entrance</div>`;
const stripped = sandbox.stripAllRegistrationLines(stale);
const rewritten = sandbox.prependRegistrationLine(stripped.text, sandbox.buildRegistrationLinkLine(
  { isFixed: false, cleanTitle: 'Chair Yoga', monthLabel: 'September 2026' },
  { formId: 'FORM123', publishedUrl: 'https://docs.google.com/forms/d/e/FORM123/viewform' }));
check('no notice left under the new link', /Registration Not Yet Open/.test(rewritten), false);
check('exactly one register link', (rewritten.match(/📝 Register for/g) || []).length, 1);
check('the room number is still there', /Room 12, back entrance/.test(rewritten), true);

console.log('\n-- the line an earlier system wrote while the link was hidden --');

// Verbatim from a live program calendar: the register link at the top is
// current, and the sentence under it is what "Hide link" used to leave behind.
// It names a form that has since been replaced, so it is not just a duplicate
// — it points the reader at the wrong one.
const HIDDEN_ERA = '<a href="https://docs.google.com/forms/d/e/1FAIpQLSfDWLp8R4K6WN9MM4nXKHjrDzDFbma9Offm0ebISFgu55n6Yg/viewform#form=1AvayYZO1QvUU4wGULAneYL_RJCNxCISKatQdPGb1uXw">\u{1F4DD} Register for Mah Jongg (For intermediate Players) — August 2026</a>\n\n\u{1F4DD} Registration for Mah Jongg (For intermediate Players) is available on our dashboard/website. [Form: 1xUAo1h3bmn1EQyl_A_RdauP8lH--dREPEwfMhMYJW8Q]\n[Regular]\n[Club]';

const hiddenEra = sandbox.stripAllRegistrationLines(HIDDEN_ERA);
check('the sentence and its [Form: …] marker are gone', hiddenEra.text, '[Regular]\n[Club]');
check('both registration lines are counted', hiddenEra.removed, 2);
check('the [Regular] / [Club] tags the sync reads survive', hiddenEra.text, '[Regular]\n[Club]');
check('a description around it keeps its own words',
  sandbox.stripAllRegistrationLines(
    '\u{1F4DD} Registration for Mat Yoga is available on our dashboard/website. [Form: 1cvk3g2]\n\n' +
    '4 weeks, with Ro. Limited space available.\n[Regular]').text,
  '4 weeks, with Ro. Limited space available.\n[Regular]');
check('re-flowed into <div>s, it takes only its own sentence',
  sandbox.stripAllRegistrationLines(
    '<div>Room 12</div><div>\u{1F4DD}&nbsp;Registration for Chair Yoga is available on our dashboard/website. [Form: 1abc-DEF_9]</div><div>[Cap: 12]</div>').text,
  '<div>Room 12</div><div></div><div>[Cap: 12]</div>');
check('the marker alone, after a hand edit took the sentence',
  sandbox.stripAllRegistrationLines('Room 12\n[Form: 1abc-DEF_9]').text, 'Room 12');
check('the sentence alone, after a hand edit took the marker',
  sandbox.stripAllRegistrationLines(
    '\u{1F4DD} Registration for Chair Yoga is available on our dashboard/website.\nRoom 12').text, 'Room 12');
check('a sentence of a person\'s own about registering is left alone',
  sandbox.stripAllRegistrationLines('Registration for this trip closes Friday — see Dana.').text,
  'Registration for this trip closes Friday — see Dana.');

console.log('\n-- switching Hide link back to Show link leaves ONE line --');

// What the next sync does with that event: the link at the top is already
// correct, so the whole question is whether the sync still looks underneath it.
const linkLine = sandbox.buildRegistrationLinkLine(
  { isFixed: false, cleanTitle: 'Mah Jongg (For intermediate Players)', monthLabel: 'August 2026' },
  { formId: '1AvayYZO1QvUU4wGULAneYL_RJCNxCISKatQdPGb1uXw',
    publishedUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfDWLp8R4K6WN9MM4nXKHjrDzDFbma9Offm0ebISFgu55n6Yg/viewform' });
const found = sandbox.findRegistrationLineInDescription(HIDDEN_ERA);
check('the top link reads as current, which is why the sync used to stop here',
  found.formId === '1AvayYZO1QvUU4wGULAneYL_RJCNxCISKatQdPGb1uXw' &&
  HIDDEN_ERA.indexOf(linkLine) === 0, true);
check('...but there is more than one registration line, so it must not stop',
  hiddenEra.removed === 1 && hiddenEra.noticesRemoved === 0, false);
check('an event that really is finished takes the fast path',
  (() => {
    const clean = sandbox.prependRegistrationLine('[Regular]\n[Club]', linkLine);
    const s = sandbox.stripAllRegistrationLines(clean);
    return s.removed === 1 && s.noticesRemoved === 0 && clean.indexOf(linkLine) === 0;
  })(), true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
