// Offline exercise of the pure helpers added for [Personalized Assistance]
// and Program_Questions. Stubs just enough of the Apps Script globals.
const fs = require('fs');
const vm = require('vm');

const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function fmt(date, tz, pattern) {
  // Only the two patterns the code actually asks for.
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  if (pattern === 'h:mm a') {
    const ampm = h < 12 ? 'AM' : 'PM';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${m} ${ampm}`;
  }
  if (pattern === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  return date.toISOString();
}

const sandbox = {
  console,
  Utilities: {
    formatDate: fmt,
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
// Top-level `const`s are lexical and do not land on the sandbox object, so the
// few this test reads are exported explicitly.
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.ASSISTANCE_NO_TIME_CHOICE = ASSISTANCE_NO_TIME_CHOICE;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const at = (h, m) => new Date(2026, 9, 13, h, m, 0);

// --- slot arithmetic -------------------------------------------------------
const wills = sandbox.buildAppointmentSlots(at(12, 30), at(15, 30), 30);
check('wills: six back-to-back half hours', wills.map(s => s.startLabel),
  ['12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM']);
check('wills: first slot reads as a range', wills[0].rangeLabel, '12:30 PM – 1:00 PM');

const gerry = sandbox.buildAppointmentSlots(at(10, 0), at(11, 0), 20);
check('20-minute slots tile the hour', gerry.map(s => s.startLabel),
  ['10:00 AM', '10:20 AM', '10:40 AM']);

check('a partial trailing slot is not offered',
  sandbox.buildAppointmentSlots(at(10, 0), at(11, 15), 30).map(s => s.startLabel),
  ['10:00 AM', '10:30 AM']);

check('an event with no end is one appointment',
  sandbox.buildAppointmentSlots(at(9, 0), null, 30).map(s => s.startLabel), ['9:00 AM']);

check('a span shorter than one slot is still one appointment',
  sandbox.buildAppointmentSlots(at(9, 0), at(9, 20), 30).map(s => s.rangeLabel),
  ['9:00 AM – 9:20 AM']);

check('slot length falls back to the default', sandbox.resolveSlotMinutes({ slotMinutes: 0 }), 30);
check('a plausible slot length is honored', sandbox.resolveSlotMinutes({ slotMinutes: 20 }), 20);
check('an absurd slot length is refused', sandbox.resolveSlotMinutes({ slotMinutes: 3 }), 30);

// --- choice labels ---------------------------------------------------------
const label = sandbox.appointmentChoiceLabel('Tue, Oct 13, 2026 · Narberth', '12:30 PM');
check('choice label', label, 'Tue, Oct 13, 2026 · Narberth @ 12:30 PM');
check('choice parses back', sandbox.parseAppointmentChoice(label),
  { sessionLabel: 'Tue, Oct 13, 2026 · Narberth', slotStartLabel: '12:30 PM' });
check('a program name containing "@" still parses',
  sandbox.parseAppointmentChoice('Coffee @ 10 — Tue, Oct 13, 2026 @ 12:30 PM').slotStartLabel,
  '12:30 PM');
check('the escape hatch parses to nothing',
  sandbox.parseAppointmentChoice(sandbox.ASSISTANCE_NO_TIME_CHOICE), null);
check('an empty answer parses to nothing', sandbox.parseAppointmentChoice(''), null);

check('start time out of a range', sandbox.appointmentStartLabelOf('12:30 PM – 1:00 PM'), '12:30 PM');
check('start time out of a bare time', sandbox.appointmentStartLabelOf('12:30 PM'), '12:30 PM');
check('sort key orders morning before afternoon',
  sandbox.appointmentSortKey('9:00 AM') < sandbox.appointmentSortKey('1:00 PM'), true);
check('an unparseable time sorts last',
  sandbox.appointmentSortKey('') > sandbox.appointmentSortKey('11:59 PM'), true);

// --- the tag itself --------------------------------------------------------
const parse = t => sandbox.parseSettingsBrackets(t);
check('[Personalized Assistance] is read', parse('[Personalized Assistance]').isAssistance, true);
check('[By Appointment] is read', parse('[By Appointment]').isAssistance, true);
check('[1-on-1] is read', parse('[1-on-1]').isAssistance, true);
check('[Slots: 20] implies an appointment program',
  [parse('[Slots: 20]').isAssistance, parse('[Slots: 20]').slotMinutes], [true, 20]);
check('an out-of-range slot length is dropped', parse('[Slots: 3]').slotMinutes, 0);
check('[Max Per Month: 1] is read', parse('[Max Per Month: 1]').maxPerMonth, 1);
check('it composes with the other tags',
  (o => [o.isAssistance, o.capacity, o.isFixed, o.slotMinutes])(
    parse('[Personalized Assistance, Grouped, Cap: 6, Slots: 20]')),
  [true, 6, true, 20]);
check('an ordinary program is not an appointment one',
  [parse('[Cap: 12, Club]').isAssistance, parse('').isAssistance], [false, false]);
check('a checkbox cell reads as the tag',
  [sandbox.isAssistanceColumnValue(true), sandbox.isAssistanceColumnValue(false),
    sandbox.isAssistanceColumnValue('')], [true, false, false]);

// --- program questions -----------------------------------------------------
check('choices split by line', sandbox.parseQuestionChoices('New Will\nUpdate Will\nNew Power of Attn'),
  ['New Will', 'Update Will', 'New Power of Attn']);
check('choices split by pipe', sandbox.parseQuestionChoices('Yes | No | Not sure'), ['Yes', 'No', 'Not sure']);
check('choices split by comma when nothing else does',
  sandbox.parseQuestionChoices('In person, Virtual'), ['In person', 'Virtual']);
check('a single option stays one option',
  sandbox.parseQuestionChoices('New Power of Attn'), ['New Power of Attn']);
check('an empty cell is no options', sandbox.parseQuestionChoices('  '), []);

const H = sandbox.HEADERS.Program_Questions;
const qrow = o => H.map(h => (o[h] === undefined ? '' : o[h]));
const specs = sandbox.buildProgramQuestionSpecs([
  qrow({ Program: 'Low-Cost Wills', Question: 'Zip Code', Type: 'Short answer', Required: true, Sort: 1 }),
  qrow({ Program: 'Low-Cost Wills', Question: 'Which document do you need?', Type: 'Dropdown',
    Choices: 'New Will\nUpdate Will', Sort: 2 }),
  // refused: a template title
  qrow({ Program: 'Low-Cost Wills', Question: 'Phone Number', Type: 'Short answer' }),
  // refused: a dropdown with nothing to pick
  qrow({ Program: 'Low-Cost Wills', Question: 'Individual or couple?', Type: 'Dropdown' }),
  // refused: not a type
  qrow({ Program: 'Low-Cost Wills', Question: 'Anything?', Type: 'Signature' }),
  // skipped: switched off
  qrow({ Program: 'Low-Cost Wills', Question: 'Old question', Type: 'Short answer', Active: false }),
  // refused: duplicate of the first
  qrow({ Program: 'Low-Cost Wills', Question: 'Zip Code', Type: 'Short answer' })
]);
check('only the usable rows become questions', specs.map(s => s.title),
  ['Zip Code', 'Which document do you need?']);
check('a blank Type defaults to a short answer',
  sandbox.buildProgramQuestionSpecs([qrow({ Question: 'Zip Code' })])[0].kind, 'TEXT');
check('Required is read from a tick', specs[0].required, true);
check('Sort orders the questions',
  sandbox.buildProgramQuestionSpecs([
    qrow({ Question: 'Second', Sort: 2 }), qrow({ Question: 'First', Sort: 1 })
  ]).map(s => s.title), ['First', 'Second']);

const context = { titles: ['Low-Cost Wills'], locations: ['Narberth'] };
check('questions follow their program',
  sandbox.questionsForFormContext(specs, context).length, 2);
check('another program gets none of them',
  sandbox.questionsForFormContext(specs, { titles: ['Chair Yoga'], locations: ['Narberth'] }).length, 0);
check('a blank Program reaches every form',
  sandbox.questionsForFormContext(
    sandbox.buildProgramQuestionSpecs([qrow({ Question: 'Zip Code' })]),
    { titles: ['Chair Yoga'], locations: ['Zoom'] }).length, 1);
check('a Location narrows it',
  sandbox.questionsForFormContext(
    sandbox.buildProgramQuestionSpecs([qrow({ Question: 'Zip Code', Location: 'Ashbridge' })]),
    { titles: ['Chair Yoga'], locations: ['Narberth'] }).length, 0);

check('an unchanged question set hashes the same',
  sandbox.computeCustomQuestionFingerprint(specs) === sandbox.computeCustomQuestionFingerprint(specs), true);
check('a changed question set hashes differently',
  sandbox.computeCustomQuestionFingerprint(specs) ===
    sandbox.computeCustomQuestionFingerprint(specs.slice(0, 1)), false);

// --- free slots on a form --------------------------------------------------
const session = {
  date: at(12, 30), end: at(14, 0), eventId: 'EV1', slotMinutes: 30,
  location: 'Narberth', title: 'Low-Cost Wills'
};
const formCtx = { sessions: [session], showLocation: false, showTitle: false };
const free = sandbox.buildAppointmentChoicesForContext(formCtx, {});
check('every slot is offered while the day is empty', free.length, 4);
check('the escape hatch is always last', free[free.length - 1], sandbox.ASSISTANCE_NO_TIME_CHOICE);

const booked = { EV1: new Set(['12:30 PM', '1:00 PM']) };
const left = sandbox.buildAppointmentChoicesForContext(formCtx, booked);
check('taken times disappear', left.length, 2);
check('and the earliest remaining one is offered first',
  sandbox.parseAppointmentChoice(left[0]).slotStartLabel, '1:30 PM');

const past = { sessions: [Object.assign({}, session, { date: new Date(2020, 0, 1) })],
  showLocation: false, showTitle: false };
check('a past session offers nothing but the escape hatch',
  sandbox.buildAppointmentChoicesForContext(past, {}), [sandbox.ASSISTANCE_NO_TIME_CHOICE]);

// --- reserved titles -------------------------------------------------------
const reserved = sandbox.reservedQuestionTitles();
['Name', 'Phone Number', 'Anything Else?', 'Guest 1 Name', 'Which appointment time would you like?']
  .forEach(t => check(`"${t}" is reserved`, reserved.has(t.toLowerCase()), true));
check('"Zip Code" is not reserved', reserved.has('zip code'), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
