// Offline exercise of the pure helpers behind three things:
//
//   - the question builder and the Program_Questions shapes it writes
//     (keyword matching, the scale parser, description injections),
//   - the lunch menu push's scope arithmetic — which location-months a push
//     covers, and therefore which forms it reaches,
//   - the sentence a push says afterwards.
//
// Stubs just enough of the Apps Script globals, in the manner of the other
// tests in this folder.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

function fmt(date, tz, pattern) {
  if (pattern === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  return date.toISOString();
}

const properties = {};
const sandbox = {
  console,
  Utilities: {
    formatDate: fmt,
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
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
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.PROGRAM_QUESTION_TYPE_OPTIONS = PROGRAM_QUESTION_TYPE_OPTIONS;
this.PROGRAM_QUESTION_TYPES = PROGRAM_QUESTION_TYPES;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- Program_Questions rows -------------------------------------------------
const qHeaders = sandbox.HEADERS.Program_Questions;
const qMap = sandbox.getIndexMap(qHeaders);
function row(values) {
  const out = qHeaders.map(() => '');
  Object.keys(values).forEach(k => { out[qMap[k]] = values[k]; });
  return out;
}

check('the tab carries a keyword column', qMap['Match_Keywords'] !== undefined, true);
check('"text" is a short answer again, not a notice', sandbox.PROGRAM_QUESTION_TYPES['text'], 'TEXT');

const specs = sandbox.buildProgramQuestionSpecs([
  row({ Program: '*', Question: 'What is your zip code?', Type: 'Short answer', Sort: 2 }),
  row({ Program: '*', Match_Keywords: 'wills | estates', Question: 'Bring photo ID',
        Type: 'Notice', Help_Text: 'Please bring a photo ID to your appointment.', Sort: 1 }),
  row({ Program: '*', Match_Keywords: 'zoom', Question: 'Zoom note', Type: 'Form description',
        Help_Text: 'This session runs on Zoom. A link is emailed the day before.' }),
  row({ Program: '*', Question: 'How did you hear about us?', Type: 'Scale',
        Choices: '1-7 | Not at all | A great deal' }),
  row({ Program: '*', Question: 'Our T\'ai Chi class', Type: 'Header image',
        Choices: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing' }),
  row({ Program: '*', Question: 'Preferred day', Type: 'Date' })
]);

check('every usable row survives', specs.length, 6);
// Sort orders the rows that HAVE one against each other; rows with a blank
// Sort keep their typed order and sit ahead of them, which is the tab's
// long-standing behaviour (see readProgramQuestionRow()).
check('Sort still orders the rows that use it',
  specs.map(s => s.title).indexOf('Bring photo ID') <
  specs.map(s => s.title).indexOf('What is your zip code?'), true);
check('a scale reads its range', [specs.find(s => s.kind === 'SCALE').scale.lower,
  specs.find(s => s.kind === 'SCALE').scale.upper], [1, 7]);
check('and its end labels', specs.find(s => s.kind === 'SCALE').scale.upperLabel, 'A great deal');
check('an out-of-range scale is clamped', sandbox.parseQuestionScale('0-40').upper, 10);
check('a blank scale is 1 to 5',
  [sandbox.parseQuestionScale('').lower, sandbox.parseQuestionScale('').upper], [1, 5]);
const header = specs.find(s => s.kind === 'HEADER_IMAGE');
check('a header image reads its Drive link', header.imageFileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
check('a header image goes at the top', sandbox.imageGoesAtTheTop(header.kind), true);
check('an ordinary image does not', sandbox.imageGoesAtTheTop('IMAGE'), false);
check('both picture kinds are pictures',
  [sandbox.questionTypeIsImage('IMAGE'), sandbox.questionTypeIsImage('HEADER_IMAGE')], [true, true]);
check('a picture asks nothing', sandbox.questionTypeIsDisplayOnly('HEADER_IMAGE'), true);
check('a picture row with no link is refused',
  !!sandbox.readProgramQuestionRow(row({ Question: 'Logo', Type: 'Header image' }),
    qMap, sandbox.reservedQuestionTitles(), 0).error, true);
check('a date row is a date', specs.find(s => s.title === 'Preferred day').kind, 'DATE');
check('a description row asks nothing', sandbox.questionTypeIsDisplayOnly('DESCRIPTION'), true);

// --- keyword matching -------------------------------------------------------
const willsForm = { formId: 'f1', titles: ['Low-Cost Wills'], locations: ['Narberth'], typeTags: ['Regular'] };
const zoomForm = { formId: 'f2', titles: ['Book Club'], locations: ['Zoom'], typeTags: ['Club'] };
const plainForm = { formId: 'f3', titles: ['Chair Yoga'], locations: ['Ashbridge'], typeTags: ['Regular'] };

const titlesOn = context => sandbox.questionsForFormContext(specs, context).map(s => s.title);
check('a keyword reaches the program it names without naming it',
  titlesOn(willsForm).indexOf('Bring photo ID') !== -1, true);
check('and reaches no other program',
  titlesOn(plainForm).indexOf('Bring photo ID'), -1);
check('a keyword can match a location instead',
  titlesOn(zoomForm).indexOf('Zoom note') !== -1, true);
check('an unkeyworded row still reaches everything',
  [titlesOn(willsForm), titlesOn(zoomForm), titlesOn(plainForm)]
    .every(list => list.indexOf('What is your zip code?') !== -1), true);

const clubOnly = sandbox.buildProgramQuestionSpecs([
  row({ Program: '*', Match_Keywords: 'club', Question: 'Are you a member?', Type: 'Short answer' })
]);
check('a keyword can match a calendar tag',
  sandbox.questionsForFormContext(clubOnly, zoomForm).length, 1);

const narberthWills = sandbox.buildProgramQuestionSpecs([
  row({ Location: 'Narberth', Match_Keywords: 'wills', Question: 'Which document?',
        Type: 'Dropdown', Choices: 'New will\nUpdate' })
]);
check('location and keyword narrow together',
  [sandbox.questionsForFormContext(narberthWills, willsForm).length,
   sandbox.questionsForFormContext(narberthWills,
     { titles: ['Low-Cost Wills'], locations: ['Ashbridge'], typeTags: [] }).length], [1, 0]);

// --- description injections -------------------------------------------------
const zoomInjection = sandbox.buildDescriptionInjectionText(
  sandbox.questionsForFormContext(specs, zoomForm));
check('the description text is the help text, not the row name',
  zoomInjection.trim(), 'This session runs on Zoom. A link is emailed the day before.');
check('a form matching no description row gets nothing',
  sandbox.buildDescriptionInjectionText(sandbox.questionsForFormContext(specs, plainForm)), '');
check('the injection is appended to the description it is given',
  sandbox.applyDescriptionInjectionsToText('Location: Zoom', zoomForm, specs),
  'Location: Zoom\n\nThis session runs on Zoom. A link is emailed the day before.');
check('a description row is not also asked as an item',
  sandbox.computeCustomQuestionFingerprint(specs.filter(s => !sandbox.questionTypeIsDescription(s.kind)))
    !== sandbox.computeCustomQuestionFingerprint(specs), true);
check('a retyped scale hashes differently', (() => {
  const one = sandbox.buildProgramQuestionSpecs([row({ Question: 'Rate us', Type: 'Scale', Choices: '1-5' })]);
  const two = sandbox.buildProgramQuestionSpecs([row({ Question: 'Rate us', Type: 'Scale', Choices: '0-10' })]);
  return sandbox.computeCustomQuestionFingerprint(one) !== sandbox.computeCustomQuestionFingerprint(two);
})(), true);

// --- a row the builder must refuse ------------------------------------------
const reserved = sandbox.reservedQuestionTitles();
check('a reserved title is refused, with a reason',
  !!sandbox.readProgramQuestionRow(row({ Question: 'Name', Type: 'Short answer' }), qMap, reserved, 0).error,
  true);
check('a dropdown with no options is refused',
  !!sandbox.readProgramQuestionRow(row({ Question: 'Pick one', Type: 'Dropdown' }), qMap, reserved, 0).error,
  true);
check('an unticked row is not a mistake, it is just absent',
  sandbox.readProgramQuestionRow(row({ Question: 'Retired', Type: 'Short answer', Active: false }),
    qMap, reserved, 0), null);
check('the same question twice for one program is one question',
  sandbox.buildProgramQuestionSpecs([
    row({ Program: 'Chair Yoga', Question: 'Mat?', Type: 'Short answer' }),
    row({ Program: 'Chair Yoga', Question: 'Mat?', Type: 'Short answer' })
  ]).length, 1);
check('...but the same wording aimed at two keyword sets is two rules',
  sandbox.buildProgramQuestionSpecs([
    row({ Match_Keywords: 'wills', Question: 'Bring ID', Type: 'Short answer' }),
    row({ Match_Keywords: 'medicare', Question: 'Bring ID', Type: 'Short answer' })
  ]).length, 2);

// --- the menu push's scope --------------------------------------------------
check('a location-month is the unit', sandbox.lunchMonthScopeKey('Narberth', '2026-09-14'),
  'Narberth|2026-09');
check('a blank location keeps its shape', sandbox.lunchMonthScopeKey('', '2026-09-14'), '|2026-09');

const outcome = sandbox.describeLunchPushOutcome(
  { monthCount: 2 },
  { signUpFormsBuilt: 1, signUpFormsRefreshed: 2, formsSeen: 9, formsRefreshed: 9, problems: [] });
check('a clean push says what landed', outcome.indexOf('9 of 9') !== -1 && outcome.indexOf('✅') !== -1, true);

const bad = sandbox.describeLunchPushOutcome(
  { monthCount: 2 },
  { signUpFormsBuilt: 0, signUpFormsRefreshed: 0, formsSeen: 9, formsRefreshed: 0,
    problems: ['3 registration form(s) could not be rewritten'] });
check('a failed push does NOT say it worked', bad.indexOf('✅'), -1);
check('and names the problem', bad.indexOf('could not be rewritten') !== -1, true);

// --- keyword parsing --------------------------------------------------------
check('keywords split on lines', sandbox.parseQuestionKeywords('Wills\nEstates'), ['wills', 'estates']);
check('keywords split on pipes', sandbox.parseQuestionKeywords('wills | estates'), ['wills', 'estates']);
check('keywords split on commas', sandbox.parseQuestionKeywords('wills, estates'), ['wills', 'estates']);
check('a single keyword is one keyword', sandbox.parseQuestionKeywords('wills'), ['wills']);
check('no keywords is no narrowing', sandbox.parseQuestionKeywords(''), []);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
