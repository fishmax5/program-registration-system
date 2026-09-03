// THE SIGN-IN SHEET: one person, one row — and what colour that row is.
//
// Two things this file pins, both of which are new and both of which are the
// kind of thing that goes wrong silently on somebody else's Thursday:
//
//   1. THE MEAL ARITHMETIC. A duplicate of the same person takes the MAXIMUM of
//      their meal counts and a GUEST adds. Get those the wrong way round and
//      the kitchen either cooks for a hundred people who are not coming or
//      leaves a guest without lunch. Everything about the aggressive name key
//      exists to serve that one sum.
//   2. THE TWO WASHES. Yellow means the meal leaves the building, purple means
//      it needs handling here, and purple wins a row that is both — because
//      "take it out of the fridge first" is the half that gets forgotten.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const date = new Date(d);
      const pad = n => String(n).padStart(2, '0');
      // Local, like Utilities.formatDate against the script's own timezone —
      // an ISO slice would shift a morning session onto the previous day.
      return fmt === 'yyyy-MM-dd'
        ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        : date.toString();
    },
    sleep: () => {},
    getUuid: () => 'uuid'
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.signInPersonKey = signInPersonKey;
this.signInPhoneKey = signInPhoneKey;
this.dedupeSignInEntries = dedupeSignInEntries;
this.classifySignInHandling = classifySignInHandling;
this.signInHandlingColor = signInHandlingColor;
this.buildSignInSheetRow = buildSignInSheetRow;
this.splitNameForPrinting = splitNameForPrinting;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.PALETTE = PALETTE;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const map = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
const DAY = new Date(2026, 8, 3); // Thursday 3 September 2026, local

/** A Registrant_Dash row with only the columns a sign-in sheet reads. */
function registrantRow(values) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  Object.keys(values).forEach(k => { row[map[k]] = values[k]; });
  return row;
}

/** The shape collectSignInSheetData() hands to the dedupe pass. */
function entry(values) {
  return Object.assign({
    name: '', program: '', status: 'Active', isGuest: false, phone: '', lunch: false, meals: 1,
    row: registrantRow({})
  }, values);
}

// ---------------------------------------------------------------------------
// The aggressive name key
// ---------------------------------------------------------------------------
const jane = sandbox.signInPersonKey('Jane Smith');
[
  ['plain', 'Jane Smith'],
  ['case and spacing', 'jane   SMITH '],
  ['last-comma-first', 'Smith, Jane'],
  ['an honorific', 'Ms. Jane Smith'],
  ['a middle initial', 'Jane A. Smith'],
  ['a suffix', 'Jane Smith Jr'],
  ['an honorific AND an initial AND a suffix', 'Dr. Jane A Smith III']
].forEach(pair => {
  check(`"${pair[1]}" is the same person as Jane Smith (${pair[0]})`,
    sandbox.signInPersonKey(pair[1]), jane);
});

check('a different first name is a different person',
  sandbox.signInPersonKey('John Smith') === jane, false);
// The apostrophe closes up rather than splitting, so the two spellings people
// actually type are one key. See signInPersonKey()'s note for why "O Brien"
// with a real space is deliberately out of reach.
check("O'Brien and OBrien are one person",
  sandbox.signInPersonKey("Sean O'Brien"), sandbox.signInPersonKey('Sean OBrien'));
check('and the apostrophe does not eat the O',
  sandbox.signInPersonKey("Sean O'Brien"), 'obrien sean');
check('a blank name has no key', sandbox.signInPersonKey('   '), '');

check('a phone key is the last ten digits, however it was typed',
  [sandbox.signInPhoneKey('(610) 555-1212'), sandbox.signInPhoneKey('1-610-555-1212')],
  ['6105551212', '6105551212']);
check('a number too short to be a phone number is not a key',
  sandbox.signInPhoneKey('x412'), '');

// ---------------------------------------------------------------------------
// THE POINT OF THE WHOLE EXERCISE: one person on two programs is one row,
// and one lunch.
// ---------------------------------------------------------------------------
const twoPrograms = sandbox.dedupeSignInEntries([
  entry({ name: 'Jane Smith', program: 'Chair Yoga', lunch: true, meals: 1 }),
  entry({ name: 'Smith, Jane', program: 'Bridge Club', lunch: true, meals: 1 })
]);
check('two registrations, one row', twoPrograms.length, 1);
check('both programs are named on it', twoPrograms[0].program, 'Chair Yoga · Bridge Club');
check('and she still eats ONE lunch, not two', twoPrograms[0].meals, 1);

// A standing order of four, answered on one form and left at the default on the
// other. The MAXIMUM is what she asked for; the sum is four extra meals.
const standingOrder = sandbox.dedupeSignInEntries([
  entry({ name: 'Joan Ray', program: 'Art', lunch: true, meals: 4 }),
  entry({ name: 'Joan Ray', program: 'Chorus', lunch: true, meals: 1 })
]);
check('a standing order of four survives being registered twice', standingOrder[0].meals, 4);

// Lunch on one registration and not the other still means lunch.
const oneOfTwo = sandbox.dedupeSignInEntries([
  entry({ name: 'Ann Lee', program: 'Art', lunch: false, meals: 1 }),
  entry({ name: 'Ann Lee', program: 'Chorus', lunch: true, meals: 2 })
]);
check('lunch ticked on either registration means lunch', [oneOfTwo[0].lunch, oneOfTwo[0].meals], [true, 2]);

// A cancellation on one program does not cancel her attendance at the other.
const oneCancelled = sandbox.dedupeSignInEntries([
  entry({ name: 'May Fox', program: 'Art', status: 'Cancelled' }),
  entry({ name: 'May Fox', program: 'Chorus', status: 'Active' })
]);
check('Active beats a cancellation on the merged row', oneCancelled[0].status, 'Active');

// ---------------------------------------------------------------------------
// The phone pass: two spellings of one person
// ---------------------------------------------------------------------------
const nicknamed = sandbox.dedupeSignInEntries([
  entry({ name: 'Bob Smith', program: 'Art', phone: '(610) 555-1212', lunch: true, meals: 1 }),
  entry({ name: 'Robert Smith', program: 'Chorus', phone: '610-555-1212', lunch: true, meals: 1 })
]);
check('Bob and Robert Smith on one phone number are one person', nicknamed.length, 1);
check('and one lunch', nicknamed[0].meals, 1);

// A HOUSEHOLD, not a person. Same landline, nothing else in common.
const household = sandbox.dedupeSignInEntries([
  entry({ name: 'Bob Smith', program: 'Art', phone: '610-555-1212', lunch: true, meals: 1 }),
  entry({ name: 'Ada Perez', program: 'Art', phone: '610-555-1212', lunch: true, meals: 1 })
]);
check('two names sharing a landline stay two people', household.length, 2);

// A GUEST is normally on their host's phone. Merging them costs a meal, so the
// phone pass does not look at guests at all.
const guestOnHostPhone = sandbox.dedupeSignInEntries([
  entry({ name: 'Bob Smith', program: 'Art', phone: '610-555-1212', lunch: true, meals: 1 }),
  entry({ name: 'Sue Smith', program: 'Art', phone: '610-555-1212', lunch: true, meals: 1, isGuest: true })
]);
check('a guest on the host\'s phone is still their own person', guestOnHostPhone.length, 2);

// Two nameless rows are two rows, not one merged nobody.
check('nameless rows do not collapse into each other',
  sandbox.dedupeSignInEntries([entry({ program: 'Art' }), entry({ program: 'Chorus' })]).length, 2);

// ---------------------------------------------------------------------------
// A GUEST ADDS. The other half of the arithmetic.
// ---------------------------------------------------------------------------
const withGuest = sandbox.buildSignInSheetRow({
  name: 'Jane Smith',
  program: 'Chair Yoga',
  status: 'Active',
  phone: '610-555-0100',
  lunch: true,
  meals: 1,
  row: registrantRow({ Name: 'Jane Smith', Phone: '610-555-0100', Party_Size: 2 }),
  guests: [{ name: 'Tom Smith', lunch: true, meals: 1 }]
}, map, [], DAY, 'Narberth');
check('a guest\'s meal is ADDED to the name the desk ticks off', withGuest.meals, 2);
check('and the guest is named in the notes',
  withGuest.notes.indexOf('with guest: Tom Smith') !== -1, true);

// ---------------------------------------------------------------------------
// The two washes
// ---------------------------------------------------------------------------
check('take-out is yellow', sandbox.classifySignInHandling(['Take-out']), 'takeout');
check('"take out" without the hyphen is still yellow',
  sandbox.classifySignInHandling(['take out please']), 'takeout');
check('their own containers is yellow',
  sandbox.classifySignInHandling(['Take-out — brings their own containers']), 'takeout');
check('the fridge is purple', sandbox.classifySignInHandling(['Put meals in the fridge']), 'special');
check('the freezer is purple', sandbox.classifySignInHandling(['Put meals in the freezer']), 'special');
check('somebody else collecting is purple',
  sandbox.classifySignInHandling(['Somebody else collects for them']), 'special');
check('purple wins a row that is both',
  sandbox.classifySignInHandling(['Take-out', 'Put meals in the fridge']), 'special');
check('a diet need gets no wash at all', sandbox.classifySignInHandling(['No milk']), '');
check('and neither does an ordinary row', sandbox.classifySignInHandling([]), '');

check('the washes are the two palette colours',
  [sandbox.signInHandlingColor('takeout'), sandbox.signInHandlingColor('special'),
    sandbox.signInHandlingColor('')],
  [sandbox.PALETTE.HANDLING_TAKEOUT, sandbox.PALETTE.HANDLING_SPECIAL, '']);

// ---------------------------------------------------------------------------
// A standing need reaches the Handling column, from either source
// ---------------------------------------------------------------------------
/** One Regular_Needs row, in the shape parseRegularNeedRow() produces. */
function need(values) {
  return Object.assign({
    name: '', nameKey: '', need: '', kind: 'Handling', quantity: 0, location: '', program: '',
    frequency: 'Every time', weekdays: [], interval: 0, dates: [], startsKey: '', endsKey: '',
    active: true, autoNote: true, id: ''
  }, values);
}

const needs = [
  need({ name: 'Joan Ray', nameKey: 'joan ray', need: 'Put meals in the fridge', quantity: 2 }),
  need({ name: 'Someone Else', nameKey: 'someone else', need: 'Take-out' })
];

const fromTab = sandbox.buildSignInSheetRow({
  name: 'Joan Ray', program: 'Art', status: 'Active', phone: '', lunch: true, meals: 2,
  row: registrantRow({ Name: 'Joan Ray' })
}, map, needs, DAY, 'Narberth');
check('a standing need from the tab reaches the Handling column',
  fromTab.handling, 'Put meals in the fridge (×2)');
check('and washes the row purple', fromTab.handlingClass, 'special');

check('somebody else\'s standing need does not leak onto this row',
  sandbox.buildSignInSheetRow({
    name: 'Jane Smith', program: 'Art', status: 'Active', phone: '', lunch: true, meals: 1,
    row: registrantRow({ Name: 'Jane Smith' })
  }, map, needs, DAY, 'Narberth').handling, '');

// The hand-typed half: Admin_Notes, which is where Quick Mark stamps needs and
// where the desk types the ones nobody has added to the tab.
const fromNotes = sandbox.buildSignInSheetRow({
  name: 'Ed Park', program: 'Art', status: 'Active', phone: '', lunch: true, meals: 1,
  row: registrantRow({ Name: 'Ed Park', Admin_Notes: '🔔 Take-out · likes the window seat' })
}, map, [], DAY, 'Narberth');
check('a hand-typed take-out note is picked up', fromNotes.handling, 'Take-out');
check('and washes the row yellow', fromNotes.handlingClass, 'takeout');
check('while the rest of the note stays a note',
  fromNotes.notes.indexOf('likes the window seat') !== -1, true);
check('and the handling line is NOT repeated in the notes column',
  fromNotes.notes.indexOf('Take-out') === -1, true);

// A need matched on the tab AND stamped into Admin_Notes prints once.
const both = sandbox.buildSignInSheetRow({
  name: 'Joan Ray', program: 'Art', status: 'Active', phone: '', lunch: true, meals: 2,
  row: registrantRow({ Name: 'Joan Ray', Admin_Notes: '🔔 Put meals in the fridge (×2)' })
}, map, needs, DAY, 'Narberth');
check('a need that was both matched and stamped prints once',
  both.handling, 'Put meals in the fridge (×2)');

// ---------------------------------------------------------------------------
// Names on the page
// ---------------------------------------------------------------------------
check('a name splits on the LAST space',
  sandbox.splitNameForPrinting('Mary Anne Delacroix'), { first: 'Mary Anne', last: 'Delacroix' });
check('"Last, First" is respected as typed',
  sandbox.splitNameForPrinting('Delacroix, Mary Anne'), { last: 'Delacroix', first: 'Mary Anne' });
check('one word is a surname',
  sandbox.splitNameForPrinting('Delacroix'), { first: '', last: 'Delacroix' });

// A merged person keeps the longest spelling of their own name.
check('the fullest spelling of a merged name is the one printed',
  sandbox.dedupeSignInEntries([
    entry({ name: 'Jane Smith', program: 'Art' }),
    entry({ name: 'Jane A. Smith', program: 'Chorus' })
  ])[0].name, 'Jane A. Smith');

console.log(failures === 0 ? '\nAll sign-in sheet checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
