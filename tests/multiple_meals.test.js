// ONE PERSON, SEVERAL MEALS — both halves of it.
//
// The workbook used to answer "how many meals do we order?" by counting
// PEOPLE. Joan Coltune orders four every lunch day and they are all hers; the
// Ginsburgs collect three between two of them. The only way to say that was to
// type "Extra Meal 1" and "Extra Meal 2" into the guest boxes, which puts
// people who do not exist onto the roster, the sign-in sheet and the party
// count — and then those non-people have to be explained to whoever reads any
// of the three.
//
// So Meals_Ordered says how many meals ONE registrant row is down for (blank
// means one, which is what every row written before it meant), the rollup adds
// meals rather than heads, and Lunch_Roster prints the number beside the name.
//
// The second half — how many meals a person actually CONSUMED and where —
// already existed as the four per-person counts. What this file pins there is
// that Quick Mark can now write them, since a desk that cannot record "ate two
// here, took three home" without opening the tab and finding the row is a desk
// that will not record it at all.
//
// And the end-to-end question underneath both: a lunch ticked on an ORDINARY
// PROGRAM FORM still has to reach Master_Lunch_Dashboard and Lunch_Roster.
// That path is the one every registration in September travels.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const NOW = new Date(2026, 8, 1, 9, 0, 0); // Tue 1 Sep 2026 — every date below is upcoming
const RealDate = Date;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      if (pattern === 'h:mm a') return '9:00 AM';
      return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
    },
    base64Encode: b => Buffer.from(String(b)).toString('base64'),
    base64Decode: t => Buffer.from(String(t), 'base64'),
    newBlob: b => ({ getBytes: () => b, getDataAsString: () => String(b) }),
    gzip: blob => blob,
    ungzip: blob => blob,
    computeDigest: () => [1],
    DigestAlgorithm: { MD5: 'MD5' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: n => ({ __name: n }), getSpreadsheetTimeZone: () => 'America/New_York' })
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.buildRegistrantRow = buildRegistrantRow;
this.buildDashboardRollup = buildDashboardRollup;
this.renderLunchRosterSheet = renderLunchRosterSheet;
this.readRegistrantMealsOrdered = readRegistrantMealsOrdered;
this.readExtraMealsResponse = readExtraMealsResponse;
this.readCachedQuickMarkIndex = readCachedQuickMarkIndex;
this.readSheetQuickMarkIndex = readSheetQuickMarkIndex;
this.QUICK_MARK_INDEX_SCHEMA = QUICK_MARK_INDEX_SCHEMA;
this.EXTRA_MEALS_NONE_LABEL = EXTRA_MEALS_NONE_LABEL;
this.MAX_EXTRA_MEALS = MAX_EXTRA_MEALS;
this.addQuickMarkMealCounts = addQuickMarkMealCounts;
this.formatDateKey = formatDateKey;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.getCateringPolicyForLocation = () => 'Always';
sandbox.getRegistrantTombstone = () => null;
sandbox.computeOrderAheadFlag = () => '';

const map = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
const d = day => new RealDate(2026, 8, day);
const DATE_KEY = '2026-09-16';

// ===========================================================================
// 1. BLANK MEANS ONE
// ===========================================================================
// The whole reason this column needed no migration: every row already in every
// workbook is blank, and blank has to keep meaning exactly what it meant.
function rowWith(meals) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  if (meals !== undefined) row[map['Meals_Ordered']] = meals;
  return row;
}
check('a blank cell is one meal', sandbox.readRegistrantMealsOrdered(rowWith(''), map), 1);
check('a typed 4 is four', sandbox.readRegistrantMealsOrdered(rowWith(4), map), 4);
check('a number typed as text still counts', sandbox.readRegistrantMealsOrdered(rowWith('3'), map), 3);
// A 0 would be a second way to say "no lunch" — the workbook already has one
// that everything reads, and rounding a typo towards a missing meal is the one
// direction the lunch numbers must never go.
check('a typed 0 does not silently cancel the meal', sandbox.readRegistrantMealsOrdered(rowWith(0), map), 1);
check('and neither does a word', sandbox.readRegistrantMealsOrdered(rowWith('four'), map), 1);

// ===========================================================================
// 2. THE FORM CAN ORDER EXTRAS
// ===========================================================================
// Caroline enters Joan's standing order through the ordinary program form, so
// the question has to survive the trip from a Forms answer to a number.
function extrasFor(answer) {
  const formIndex = { byTitle: {}, form: { getId: () => 'f1' } };
  sandbox.getResponseValueByTitle = () => answer;
  return sandbox.readExtraMealsResponse(formIndex, {});
}
check('"None" is no extras', extrasFor(sandbox.EXTRA_MEALS_NONE_LABEL), 0);
check('an unanswered question is no extras', extrasFor(''), 0);
check('"3" is three extras', extrasFor('3'), 3);
// The question is a list of fixed choices, so a number past the cap can only
// come from an edited form — and an order of ninety meals should reach a
// person before it reaches the kitchen.
check('an impossible answer is capped, not trusted',
  extrasFor('90'), sandbox.MAX_EXTRA_MEALS);

// ===========================================================================
// 3. A LUNCH TICKED ON A PROGRAM FORM REACHES THE KITCHEN
// ===========================================================================
// The path every September registration takes: processFormResponse() resolves
// the people, buildRegistrantRow() writes the row, buildDashboardRollup()
// counts it and renderLunchRosterSheet() names it. This is the whole of that
// path apart from the Forms API itself.
sandbox.getMealInfoForDate = () => ({ type: 'Hot', shorthand: 'Chx Parm' });
sandbox.isLunchOfferedOn = () => true;
sandbox.lunchIsRuledOutOn = () => false;
sandbox.isExplicitlyNotServing = () => false;
sandbox.resolveRegistrantLunchType = wantsLunch => (wantsLunch ? 'Hot' : 'No Lunch');
sandbox.readLunchScheduleRows = () => [];

const registryEntry = {
  eventId: 'evt-bookclub', eventDate: d(16), location: 'Narberth',
  cleanTitle: 'Book Club', eventTime: '1:00 PM – 2:00 PM', maxCapacity: 0
};

/** One registration, exactly as processFormResponse() builds it. */
function register(name, opts) {
  opts = opts || {};
  return sandbox.buildRegistrantRow({
    registryEntry: Object.assign({}, registryEntry, opts.registryEntry || {}),
    name, personType: opts.personType || 'Attendee',
    lunchType: opts.noLunch ? 'No Lunch' : 'Yes - Lunch',
    primaryRegistrant: opts.primaryRegistrant || 'Self',
    adminNotes: '', formEditUrl: '', protectedKeys: new Set(),
    existingRowIndex: new Map(), submittedAt: new RealDate(2026, 8, 2),
    orderAheadDays: 3, partyId: opts.partyId || 'p1', partySize: opts.partySize || 1,
    mealsOrdered: opts.mealsOrdered, phone: '610-555-0100', email: ''
  });
}

const plainRow = register('Ada Lovelace');
check('a plain lunch registration is Needed', plainRow[map['Lunch_Status']], 'Needed');
// An ordinary registration leaves the column EMPTY rather than stamping a 1:
// blank already says one, and a column full of 1s is a column that has to be
// read to learn nothing.
check('and writes nothing into Meals_Ordered', plainRow[map['Meals_Ordered']], '');

const joanRow = register('Joan Coltune', { mealsOrdered: 4 });
check("Joan's four meals are on her own row", joanRow[map['Meals_Ordered']], 4);
check('and she is still one person', joanRow[map['Party_Size']], 1);

// A registrant who is not eating orders nothing, whatever the extras question
// said — the extras were extras OF a meal that is not happening.
const noLunchRow = register('Bob Vance', { noLunch: true, mealsOrdered: 3 });
check('extras on a no-lunch row are dropped', noLunchRow[map['Meals_Ordered']], '');

// The rollup, over those rows plus a guest and a duplicate registration.
const guestRow = register('Ginsburg Guest', {
  personType: 'Guest', primaryRegistrant: 'Sam Ginsburg', partyId: 'p2', partySize: 2
});
// Ada again, from a second program's form on the same day: the case
// lunchPersonEntry() exists for. One person, one meal, however many forms.
const adaAgain = register('ada  lovelace ', {
  registryEntry: { eventId: 'evt-yoga', cleanTitle: 'Chair Yoga' }, partyId: 'p3'
});

sandbox.readAllSectionedRows = () => [];
const eventMeta = {
  'evt-bookclub': { dateKey: DATE_KEY, location: 'Narberth' },
  'evt-yoga': { dateKey: DATE_KEY, location: 'Narberth' }
};
// The session table, read back in the shape buildDashboardRollup() reads it.
const dashHeaders = sandbox.HEADERS.Master_Program_Dashboard;
const dashMap = sandbox.getIndexMap(dashHeaders);
const sessionRows = Object.keys(eventMeta).map(eventId => {
  const row = new Array(dashHeaders.length).fill('');
  row[dashMap['Event_ID']] = eventId;
  row[dashMap['Event_Date']] = d(16);
  row[dashMap['Location']] = 'Narberth';
  return row;
});
sandbox.readAllSectionedRows = (sheet, headers) =>
  (headers === sandbox.HEADERS.Master_Program_Dashboard ? sessionRows : []);

const rollup = sandbox.buildDashboardRollup(
  [plainRow, joanRow, noLunchRow, guestRow, adaAgain]);
const bucket = rollup.filter(r => r.dateKey === DATE_KEY && r.location === 'Narberth')[0];

check('the day reaches the dashboard at all', !!bucket, true);
// Ada 1 + Joan 4 + the Ginsburg guest 1 = 6 meals, from 3 people. Bob ordered
// no lunch and is not in either number.
check('Registered_Count is MEALS', bucket.registeredCount, 6);
check('and the headcount beside it is still people', bucket.registeredPeople, 3);
check('a second form for the same person merges', bucket.mergedRequests, 1);

// ...and the same rollup names them, which is the point of building both from
// one object: the count and the list can never disagree.
let rosterRows = [];
sandbox.getOrCreateSheet = (ss, name) => ({ __name: name });
sandbox.renderFlatDateSheet = (sheet, headers, rows) => { rosterRows = rows; return {}; };
sandbox.parseDateKey = key => {
  const parts = String(key).split('-');
  return new RealDate(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
};
sandbox.renderLunchRosterSheet(rollup);

const rosterMap = sandbox.getIndexMap(sandbox.HEADERS.Lunch_Roster);
const byName = {};
rosterRows.forEach(row => { byName[row[rosterMap['Name']]] = row; });
check('everyone eating is on the roster',
  Object.keys(byName).sort(), ['Ada Lovelace', 'Ginsburg Guest', 'Joan Coltune']);
check('Joan is ONE row', rosterRows.filter(r => r[rosterMap['Name']] === 'Joan Coltune').length, 1);
check('...reading four meals', byName['Joan Coltune'][rosterMap['Meals']], 4);
check('an ordinary eater reads one, not a blank', byName['Ada Lovelace'][rosterMap['Meals']], 1);
check('and the menu decides the type', byName['Joan Coltune'][rosterMap['Lunch_Type']], 'Hot');
check('somebody with no lunch is not on it', byName['Bob Vance'], undefined);

// ===========================================================================
// 4. THE DESK CAN RECORD WHAT WAS ACTUALLY EATEN, AND WHERE
// ===========================================================================
// "Ate 2 here and took 3 home" — the counts already existed; what did not was
// any way to write them without opening the tab and hunting for the row.
function fakeSheet(initial) {
  const cells = Object.assign({}, initial);
  return {
    cells,
    getRange: (row, col) => ({
      getValue: () => (cells[col] === undefined ? '' : cells[col]),
      setValue: v => { cells[col] = v; }
    })
  };
}
const dinedCol = map['Day1_Dined_In'] + 1;
const outCol = map['Day1_Taken_Out'] + 1;
const fridgeCol = map['Meals_In_Fridge'] + 1;

const sheet = fakeSheet({});
sandbox.addQuickMarkMealCounts(sheet, map, 5, { ateHere: 2, tookHome: 3, inFridge: 0 });
check('ate two here', sheet.cells[dinedCol], 2);
check('took three home', sheet.cells[outCol], 3);
check('and nothing is written where nothing was counted', sheet.cells[fridgeCol], undefined);

// They come back an hour later for another. The second handover is marked
// exactly like the first, so it has to ADD — setting would make the smaller
// later number erase the earlier one.
sandbox.addQuickMarkMealCounts(sheet, map, 5, { ateHere: 1, tookHome: 0, inFridge: 0 });
check('a second helping adds rather than replaces', sheet.cells[dinedCol], 3);

// The pre-split workbook had a fridge CHECKBOX in that column. A ticked box is
// not a count of one, and must never be added to as though it were.
const legacy = fakeSheet({ [fridgeCol]: true });
sandbox.addQuickMarkMealCounts(legacy, map, 5, { ateHere: 0, tookHome: 0, inFridge: 2 });
check('a legacy fridge tick is replaced by a real count, not incremented',
  legacy.cells[fridgeCol], 2);

// ===========================================================================
// 5. THE STORED QUICK MARK LISTS KNOW HOW OLD THEY ARE
// ===========================================================================
// Why appointment times stopped appearing on Personalized Assistance sessions
// after they were added: the index lives in a cache AND on a hidden tab, and
// the tab copy never expires. A workbook that had used Quick Mark before the
// feature landed kept serving the pre-times lists — sessions with no `times`
// and no `byAppointment` — and getQuickMarkIndex() promoted that copy back
// into the cache on every open.
function storedIndex(schema) {
  const index = { sessions: [{ label: 'PA', byAppointment: true, times: [] }], members: [], needs: [] };
  if (schema !== undefined) index.schema = schema;
  // Stored exactly as writeSheetQuickMarkIndex() stores it — packed, not raw
  // JSON — so this exercises the real reader rather than a shortcut past it.
  return Buffer.from(JSON.stringify(index)).toString('base64');
}
let sheetPayload = storedIndex(undefined); // the shape written before the stamp existed
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: () => ({
    getLastRow: () => 3,
    getRange: () => ({ getValues: () => [[sheetPayload]] })
  }),
  getSpreadsheetTimeZone: () => 'America/New_York'
});
check('an index with no schema stamp is refused', sandbox.readSheetQuickMarkIndex(), null);
sheetPayload = storedIndex(sandbox.QUICK_MARK_INDEX_SCHEMA - 1);
check('and so is one from an older version', sandbox.readSheetQuickMarkIndex(), null);
sheetPayload = storedIndex(sandbox.QUICK_MARK_INDEX_SCHEMA);
check('the current one is served', !!sandbox.readSheetQuickMarkIndex(), true);

console.log(failures === 0 ? '\nAll multiple-meals checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
