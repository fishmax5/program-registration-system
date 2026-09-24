// The calendar event's own description at the top of the form (99r):
//
//   - what is taken off an event description (our links, tag-only brackets,
//     HTML) and what is left on (a note in brackets, the words),
//   - one text shown once, several shown per date and folded by text,
//   - the three Description_Placement answers,
//   - the sync writer: a legacy form gains the top without its bottom or its
//     base moving, a second pass writes nothing, a changed calendar replaces
//     the top in place, and a hand-edited base survives,
//   - the hourly fingerprint, the session-table cell, and the reconcile pass.
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const store = {};
const props = {
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); return props; },
  deleteProperty: k => { delete store[k]; return props; },
  getProperties: () => Object.assign({}, store)
};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new Date(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'MMM d') return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
      return d.toISOString();
    },
    computeDigest: (alg, payload) => Array.from(require('crypto').createHash('md5').update(String(payload)).digest())
      .map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 'MD5' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => props, getUserProperties: () => props },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: { ItemType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.FORM_DESCRIPTION_PLACEMENTS = FORM_DESCRIPTION_PLACEMENTS;
this.CUSTOM_QUESTIONS_PROP_KEY = CUSTOM_QUESTIONS_PROP_KEY;
this.loadSessionGrid = loadSessionGrid;
this.sessionGridColumn = sessionGridColumn;
`, sandbox, { filename: 'program.gs' });
sandbox.log = () => {};
sandbox.noteForAdmin = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- cleaning one event description ---------------------------------------
const clean = sandbox.calendarDescriptionToFormText;
check('our registration link comes off',
  clean('<a href="https://docs.google.com/forms/d/e/abc/viewform">Register here</a><br><br>Bring a yoga mat.'),
  'Bring a yoga mat.');
check('a bare forms URL comes off',
  clean('Register: https://docs.google.com/forms/d/e/abc/viewform\nBring water.').indexOf('docs.google.com'), -1);
check('tag-only brackets come off, a note in brackets stays',
  clean('[Club] [Cap: 12]\nMeets in the library [room 4].\n[Waitlist Only][Grouped]'),
  'Meets in the library [room 4].');
check('HTML becomes lines and entities decode',
  clean('<p>Tea &amp; biscuits</p><ul><li>Pens</li><li>Paper</li></ul>'),
  'Tea & biscuits\n\n• Pens\n• Paper');
check('another link keeps its words and address',
  clean('See <a href="https://example.org/menu">the menu</a>.'),
  'See the menu (https://example.org/menu).');
check('an event with nothing but our tags says nothing', clean('[Shared]\n\n'), '');

// --- the calendar block ----------------------------------------------------
const d = (m, day) => new Date(2026, m, day, 10, 0);
const block = sandbox.buildCalendarDescriptionBlock;
check('one text across every date shows once, without dates',
  block([{ date: d(9, 10), calendarText: 'Bring a mat.' }, { date: d(9, 3), calendarText: 'Bring a mat.' }]),
  'Bring a mat.');
check('different texts are listed per date, identical ones folded',
  block([
    { date: d(9, 10), calendarText: 'Watercolour' },
    { date: d(9, 3), calendarText: 'Pastels' },
    { date: d(9, 17), calendarText: 'Pastels' }
  ]),
  'Oct 3, Oct 17: Pastels\nOct 10: Watercolour');
check('a date with no text is not given an empty line',
  block([{ date: d(9, 3), calendarText: 'Pastels' }, { date: d(9, 10), calendarText: '' }]),
  'Oct 3: Pastels');
check('twins on one date take the first non-empty text',
  block([{ date: d(9, 3), calendarText: '' }, { date: new Date(2026, 9, 3, 13), calendarText: 'Afternoon' }]),
  'Afternoon');
check('no text anywhere is no block', block([{ date: d(9, 3), calendarText: '' }]), '');

// --- placement --------------------------------------------------------------
const P = sandbox.FORM_DESCRIPTION_PLACEMENTS;
check('blank placement is Below', sandbox.normalizeDescriptionPlacement(''), P.BELOW);
check('placement reads loosely', sandbox.normalizeDescriptionPlacement(' replace calendar '), P.REPLACE);
const desc = (help, placement) => ({ kind: 'DESCRIPTION', help, placement });
const compose = sandbox.composeFormDescriptionParts;
check('Below rows go at the end, in the legacy shape',
  compose('Cal', [desc('B1', ''), desc('B2', P.BELOW)]), { top: 'Cal\n\n', bottom: '\n\nB1\n\nB2' });
check('Above rows go before the calendar text',
  compose('Cal', [desc('A', P.ABOVE)]), { top: 'A\n\nCal\n\n', bottom: '' });
check('Replace rows go instead of it',
  compose('Cal', [desc('A', P.ABOVE), desc('R', P.REPLACE)]), { top: 'A\n\nR\n\n', bottom: '' });
check('no calendar text and no rows is nothing', compose('', []), { top: '', bottom: '' });

// --- the Program_Questions column ------------------------------------------
const qHeaders = sandbox.HEADERS.Program_Questions;
check('Description_Placement is the LAST column', qHeaders[qHeaders.length - 1], 'Description_Placement');
const qMap = sandbox.getIndexMap(qHeaders);
const qRow = values => { const out = qHeaders.map(() => ''); Object.keys(values).forEach(k => { out[qMap[k]] = values[k]; }); return out; };
const specs = sandbox.buildProgramQuestionSpecs([
  qRow({ Program: '*', Question: 'Top note', Type: 'Form description', Help_Text: 'Read this first.',
    Description_Placement: 'Above calendar', Active: true }),
  qRow({ Program: '*', Question: 'Old note', Type: 'Form description', Help_Text: 'Legacy wording.', Active: true })
]);
check('a row carries its placement, a legacy row reads Below',
  specs.map(s => s.placement), [P.ABOVE, P.BELOW]);
check('the legacy injection text is Below rows only',
  sandbox.buildDescriptionInjectionText(specs), '\n\nLegacy wording.');

// --- the sync writer on a live form ----------------------------------------
function fakeForm(id, description) {
  const f = { id, description, writes: 0 };
  f.getId = () => id;
  f.getDescription = () => f.description;
  f.setDescription = text => { f.description = text; f.writes++; return f; };
  return f;
}
const BASE = 'Location: Ashbridge\n\nDates:\n• Oct 3\n\nPlease register below.';
// A form as the code before this change left it: base + legacy bottom, recorded.
store[sandbox.CUSTOM_QUESTIONS_PROP_KEY] = JSON.stringify({ f1: { description: '\n\nLegacy wording.' } });
const form = fakeForm('f1', `${BASE}\n\nLegacy wording.`);
const context = t => ({ formId: 'f1', sessions: [{ date: d(9, 3), calendarText: t }] });
const legacyOnly = [specs[1]];

check('a legacy form is written once', sandbox.syncDescriptionInjectionsOnForm(form, context('Bring a mat.'), legacyOnly), 1);
check('…and gains the calendar text on top, nothing else moved',
  form.description, `Bring a mat.\n\n${BASE}\n\nLegacy wording.`);
check('a second pass writes nothing', sandbox.syncDescriptionInjectionsOnForm(form, context('Bring a mat.'), legacyOnly), 0);
check('the fingerprint says settled',
  sandbox.formDescriptionNeedsSync('f1', sandbox.formDescriptionPartsForContext(context('Bring a mat.'), legacyOnly)), false);
check('…and unsettled when the calendar changes',
  sandbox.formDescriptionNeedsSync('f1', sandbox.formDescriptionPartsForContext(context('Bring two mats.'), legacyOnly)), true);
sandbox.syncDescriptionInjectionsOnForm(form, context('Bring two mats.'), legacyOnly);
check('a changed calendar text replaces the old one in place',
  form.description, `Bring two mats.\n\n${BASE}\n\nLegacy wording.`);
sandbox.syncDescriptionInjectionsOnForm(form, context('Bring two mats.'), specs);
check('an Above row lands over the calendar text',
  form.description, `Read this first.\n\nBring two mats.\n\n${BASE}\n\nLegacy wording.`);
form.description = form.description.replace('Please register below.', 'Please register below. Staff note.');
sandbox.syncDescriptionInjectionsOnForm(form, context(''), specs);
check('a hand-edited base survives, and an event with no text loses only its block',
  form.description, `Read this first.\n\n${BASE.replace('below.', 'below. Staff note.')}\n\nLegacy wording.`);
sandbox.forgetFormDescriptionState('f1');
check('a bare base write clears the fingerprint',
  sandbox.formDescriptionNeedsSync('f1', sandbox.formDescriptionPartsForContext(context(''), specs)), true);

// --- the session-table cell -------------------------------------------------
check('a description that looks like a formula is written as text',
  sandbox.eventDescriptionCellValue('=SUM(A1)'), "'=SUM(A1)");
check('…and reads back without the apostrophe', sandbox.readEventDescriptionCell("'=SUM(A1)"), '=SUM(A1)');
const sHeaders = sandbox.HEADERS.All_Program_Sessions;
check('Event_Description is the LAST session column', sHeaders[sHeaders.length - 1], 'Event_Description');
const sMap = sandbox.getIndexMap(sHeaders);
const rowWith = values => { const r = sHeaders.map(() => ''); Object.keys(values).forEach(k => { r[sMap[k]] = values[k]; }); return r; };
const ctx = sandbox.buildFormSessionContext('f9',
  [rowWith({ Event_Date: d(9, 3), Clean_Title: 'Art', Location: 'Ashbridge', Event_ID: 'x', Event_Description: 'Pastels' })],
  sMap, new Set());
check('the row context carries the calendar text', ctx.sessions[0].calendarText, 'Pastels');

// --- the reconcile pass ----------------------------------------------------
const CAL = 'cal@example.com';
const up = d(9, 3);
const grid = [
  ['All Program Sessions'],
  ['⏳ Upcoming'],
  sHeaders.slice(),
  rowWith({ Event_Date: up, Clean_Title: 'Art', Location: 'Ashbridge', Calendar_Source: CAL, Event_ID: 'e1',
    Event_Description: 'Old words' })
];
const sheet = makeCountingSheet(grid, 'All_Program_Sessions');
const groups = [{
  cleanTitle: 'Art',
  sessions: [{ calendarId: CAL, event: {
    getStartTime: () => up, getEndTime: () => up,
    getDescription: () => '[Club]<br>New words <a href="https://docs.google.com/forms/d/e/abc/viewform">Register</a>'
  } }]
}];
check('the reconcile pass rewrites a changed description', sandbox.reconcileEventDescriptionsFromCalendar(sheet, groups), 1);
check('…with the cleaned text on the row', grid[3][sMap['Event_Description']], 'New words');
sandbox.invalidateSectionedRowsCache(sheet);
check('…and a second pass changes nothing', sandbox.reconcileEventDescriptionsFromCalendar(sheet, groups), 0);

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall form calendar description checks passed');
