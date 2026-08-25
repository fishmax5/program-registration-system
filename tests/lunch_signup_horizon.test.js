// How far ahead a lunch sign-up form gets built, and what the menu action says
// when it builds none. Drives syncLunchOnlySessions() itself by replacing the
// three sheet readers on the sandbox's global object — see STRESS_TEST.md,
// "Running it again".
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

// Frozen "now": 21 August 2026. Chosen because November is then ~72 days out —
// past the calendar's 60-day lookahead, which is the bug this file exists for.
const NOW = new Date(2026, 7, 21, 9, 0, 0);
const RealDate = Date;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function fmt(date, tz, pattern) {
  const p = n => String(n).padStart(2, '0');
  if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
  if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  if (pattern === 'MMMM yyyy') return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  if (pattern === 'EEE, MMM d') return `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
  return date.toISOString();
}

const props = {};
const sandbox = {
  console,
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: fmt, sleep: () => {},
    computeDigest: () => [1, 2, 3], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: n => ({ __name: n, getName: () => n, getLastRow: () => 10, getLastColumn: () => 6 }),
      getSpreadsheetTimeZone: () => 'America/New_York'
    })
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York' },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.LUNCH_SIGNUP_LOOKAHEAD_MONTHS = LUNCH_SIGNUP_LOOKAHEAD_MONTHS;
this.SHEET_NAMES = SHEET_NAMES;
this.lunchOnlyRowTitle = lunchOnlyRowTitle;
this.lunchOnlyProgramLabel = lunchOnlyProgramLabel;
this.isLunchOnlyProgramTitle = isLunchOnlyProgramTitle;
this.quickMarkTitleKey = quickMarkTitleKey;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function checkThat(name, cond) { check(name, !!cond, true); }

// --- the I/O boundary ------------------------------------------------------
// Everything below is a function DECLARATION in Code.gs, so it lands on the
// sandbox's global object and can be replaced from out here.
let menuRows = [];
let built = [];
sandbox.readLunchScheduleRows = () => menuRows;
sandbox.readAllSectionedRows = () => [];        // no session rows yet
sandbox.getCateringPolicyForLocation = loc => (loc === 'Zoom' ? 'Never' : 'Always');
sandbox.renderProgramDashboard = () => {};
sandbox.getPersistentFormRegistry = () => ({});
sandbox.savePersistentFormRegistryEntry = () => {};
sandbox.flushPersistentRegistries = () => {};
sandbox.noteForAdmin = () => {};
sandbox.log = () => {};
sandbox.buildFooterNoteForLocations = () => '';
sandbox.createRegistrationForm = group => {
  built.push(`${group.locations[0]} ${group.monthLabel}`);
  return {
    formId: `f-${group.locations[0]}-${group.monthLabel}`,
    publishedUrl: `https://forms/${group.monthLabel}`,
    editUrl: `https://forms/${group.monthLabel}/edit`
  };
};
sandbox.refreshFormForNewDates = formId => ({
  formId, publishedUrl: `https://forms/${formId}`, editUrl: `https://forms/${formId}/edit`
});

const menu = (y, m, d, location, type) => [new RealDate(y, m, d), location, type, 'Meal', 'Meal', 'M'];
function run() {
  built = [];
  Object.keys(props).forEach(k => delete props[k]);
  return sandbox.syncLunchOnlySessions({ __name: 'Master_Program_Dashboard' });
}

// --- the horizon -----------------------------------------------------------
const range = sandbox.computeLunchSignUpDateRange();
check('the window opens on the first of this month', fmt(range.start, null, 'yyyy-MM-dd'), '2026-08-01');
check('and closes on the last day of the sixth month after it',
  fmt(range.end, null, 'yyyy-MM-dd'), '2027-02-28');
checkThat('which is further out than the calendar\'s own lookahead',
  range.end > sandbox.computeSyncDateRange().end);

// THE BUG. A November menu typed in August is past the calendar's 60-day
// window and was dropped whole: no form, no pin, and a menu action that said
// there were no catered dates to somebody looking straight at them.
menuRows = [
  menu(2026, 10, 4, 'Narberth', 'Hot'),
  menu(2026, 10, 11, 'Narberth', 'Hot'),
  menu(2026, 10, 18, 'Ashbridge', 'Cold')
];
let links = run();
check('a menu typed two months ahead builds its forms', built.sort(),
  ['Ashbridge November 2026', 'Narberth November 2026']);
check('and both are pinned',
  sandbox.buildLunchSignUpRows(links).map(r => `${r.location} ${r.monthLabel}`),
  ['Ashbridge November 2026', 'Narberth November 2026']);
check('the pin carries how many dates that month serves',
  sandbox.buildLunchSignUpRows(links)[1].dateCount, 2);
check('the links survive in Script Properties for the next render',
  Object.keys(JSON.parse(props['LUNCH_ONLY_FORM_LINKS_V1'])).length, 2);

// Still bounded, and what falls outside is COUNTED rather than dropped in
// silence — a year pasted in one go builds six months of it.
menuRows = [menu(2027, 5, 3, 'Narberth', 'Hot')]; // June 2027, ten months out
links = run();
check('a date past the horizon builds nothing', built, []);
check('...and is counted as such, not as a missing menu',
  [sandbox.getLastLunchSignUpRunStats().beyondHorizon, sandbox.getLastLunchSignUpRunStats().cateredRows], [1, 1]);

// --- what the menu action says when it pins nothing -------------------------
check('a menu that is only too far ahead says so',
  /more than 6\s*months out/.test(sandbox.describeWhyNoLunchSignUpForms()), true);

menuRows = [menu(2026, 7, 3, 'Narberth', 'Hot')]; // 3 August: gone by
run();
check('a menu that has entirely passed says THAT instead',
  /already passed/.test(sandbox.describeWhyNoLunchSignUpForms()), true);

menuRows = [menu(2026, 8, 3, 'Zoom', 'Hot')]; // a location that never caters
run();
check('a Hot row at a Never location is not a catered row',
  sandbox.getLastLunchSignUpRunStats().cateredRows, 0);
check('and the message is the one that asks for a Hot or Cold row',
  /no Hot or Cold rows/.test(sandbox.describeWhyNoLunchSignUpForms()), true);

menuRows = [menu(2026, 8, 3, 'Narberth', 'Hot')];
sandbox.createRegistrationForm = () => { throw new Error('Forms is busy'); };
run();
check('a form that could not be built is never reported as a missing menu',
  /could not be built or reopened/.test(sandbox.describeWhyNoLunchSignUpForms()), true);
check('and the failure is counted', sandbox.getLastLunchSignUpRunStats().formsFailed, 1);

// --- a lunch-only group carries its dates in lunchOnlySessions -------------
const lunchGroup = {
  cleanTitle: '🥡 Lunch Only (no program)',
  monthLabel: 'November 2026',
  locations: ['Narberth'],
  isLunchOnly: true,
  lunchOnlySessions: [
    { date: new RealDate(2026, 10, 4, 12), location: 'Narberth', title: '🥡 Lunch Only (no program)' },
    { date: new RealDate(2026, 10, 11, 12), location: 'Narberth', title: '🥡 Lunch Only (no program)' }
  ]
};
const ctx = sandbox.formContextFromGroup(lunchGroup, 'f-1');
check('the extension layer sees a lunch form\'s dates, not an empty form',
  ctx.sessions.length, 2);
check('each one keyed by the id its session row actually carries',
  ctx.sessions[0].eventId, sandbox.makeLunchOnlyEventId('2026-11-04', 'Narberth'));
check('and its location', ctx.sessions[0].location, 'Narberth');

// --- the mode question's page targets --------------------------------------
// ListItem.createChoice(value, navigationItem) takes a PageBreakItem and
// nothing else. form.getItems() hands back generic Items, so a form whose mode
// labels have to be REWRITTEN — every lunch-only form, every [Club] form,
// every [Grouped] series — died on
//   "The parameters (String,FormApp.Item) don't match the method signature
//    for FormApp.ListItem.createChoice."
// A plain monthly form never hit it: its labels already match the copied
// template, so the skip-if-unchanged branch returns first.
sandbox.FormApp.ItemType.PAGE_BREAK = 'PAGE_BREAK';
sandbox.FormApp.ItemType.LIST = 'LIST';

function fakePage(title) {
  const page = { __pageBreak: true, getTitle: () => title, getType: () => 'PAGE_BREAK' };
  // What getItems() actually returns: a generic Item that can BECOME a page.
  return { getTitle: () => title, getType: () => 'PAGE_BREAK', asPageBreakItem: () => page, __page: page };
}

function fakeForm(currentLabels) {
  const navTargets = [];
  const list = {
    getChoices: () => currentLabels.map(v => ({ getValue: () => v })),
    getHelpText: () => '',
    setHelpText: () => list,
    setChoices: () => list,
    createChoice: (value, navigationItem) => {
      // Apps Script's own type check, in the words it uses.
      if (!navigationItem || !navigationItem.__pageBreak) {
        throw new Error("The parameters (String,FormApp.Item) don't match the " +
          'method signature for FormApp.ListItem.createChoice.');
      }
      navTargets.push(`${value} -> ${navigationItem.getTitle()}`);
      return { value };
    }
  };
  const modeItem = {
    getTitle: () => 'How would you like to sign up?',
    getType: () => 'LIST',
    asListItem: () => list
  };
  const allDates = fakePage('Sign Me Up for Every Date');
  const specific = fakePage('Pick Your Dates');
  return {
    navTargets,
    getId: () => 'form-under-test',
    getItems: () => [modeItem, allDates, specific]
  };
}

// The real page titles, so the lookup finds them.
const pageTitles = vm.runInContext('[TEMPLATE_PAGE_TITLES.ALL_DATES, TEMPLATE_PAGE_TITLES.SPECIFIC_DATES]', sandbox);
function fakeFormWithRealTitles(currentLabels) {
  const form = fakeForm(currentLabels);
  const items = form.getItems();
  const allDates = fakePage(pageTitles[0]);
  const specific = fakePage(pageTitles[1]);
  form.getItems = () => [items[0], allDates, specific];
  return form;
}

sandbox.invalidateFormItemIndex = () => {};
const lunchForm = fakeFormWithRealTitles(['I am coming to every date', 'Let me pick my dates']);
let threw = null;
try {
  sandbox.applyAttendanceModeChoices(lunchForm, { isLunchOnly: true });
} catch (err) { threw = String(err); }
check('a lunch form\'s mode choices are written, not thrown at', threw, null);
check('and each choice navigates to a real page break', lunchForm.navTargets.length, 2);

// The path that always worked, so the guard has not broken it: labels that
// already match are left alone without a single Forms write.
const unchanged = fakeFormWithRealTitles(
  vm.runInContext('[ATTENDANCE_MODE_CHOICES.ALL_DATES, ATTENDANCE_MODE_CHOICES.INDIVIDUAL]', sandbox));
unchanged.getItems()[0].asListItem().getHelpText = () =>
  vm.runInContext('buildAttendanceModeHelpText(buildAttendanceModeChoiceSet({}))', sandbox);
sandbox.applyAttendanceModeChoices(unchanged, {});
check('an unchanged form is not rewritten', unchanged.navTargets.length, 0);

// --- lunch rows are ON the programme dashboard's view -----------------------
// They used to be hidden, on the argument that a meal is not a programme. That
// was really an argument about the old NAME: thirty rows a month all reading
// "🥡 Lunch Only (no program)" said nothing thirty times. Now each one reads
// "Lunch @ Narberth — Chx Parm" and belongs on the schedule like any other
// line — and because hiding is a property of the sheet's ROWS rather than of
// their contents, a workbook that ever ran the old code has to be told to show
// them again explicitly, on every render.
const progMap = vm.runInContext('getIndexMap(HEADERS.Master_Program_Dashboard)', sandbox);
const sessionRow = (eventId, title) => {
  const row = new Array(vm.runInContext('HEADERS.Master_Program_Dashboard.length', sandbox)).fill('');
  row[progMap['Event_ID']] = eventId;
  row[progMap['Clean_Title']] = title;
  row[progMap['Location']] = 'Narberth';
  return row;
};
const lunchId = k => sandbox.makeLunchOnlyEventId(k, 'Narberth');

const shownBands = [];
const fakeSheet = {
  getName: () => 'Master_Program_Dashboard',
  showRows: (start, count) => shownBands.push(`${start}+${count}`)
};

// Two separate runs of lunch dates with a class between them, and one in Past.
const upcomingRows = [
  sessionRow(lunchId('2026-09-01'), 'Lunch @ Narberth — Chx Parm'),
  sessionRow(lunchId('2026-09-02'), 'Lunch @ Narberth — Turkey Wrap'),
  sessionRow('cal-hash-1', 'Chair Yoga'),
  sessionRow(lunchId('2026-09-08'), 'Lunch @ Narberth')
];
const pastRows = [
  sessionRow('cal-hash-2', 'Bingo'),
  sessionRow(lunchId('2026-08-04'), '🥡 Lunch Only (no program)') // written before the rename
];
const count = sandbox.showLunchOnlySessionRows(fakeSheet, progMap, upcomingRows, pastRows,
  { upcomingDataStart: 10, pastDataStart: 100 });
check('every lunch row is shown and no class is touched', count, 4);
check('and consecutive ones go in one call, not one each', shownBands, ['10+2', '13+1', '101+1']);

// The summaries still count programmes only. "42 programmes this month"
// counting thirty lunches is a number nobody can use, and the Today block
// names what is RUNNING at a location — the meal has its own count on the
// lunch dashboard.
const scan = { countsByEventId: {}, activeNamesByEventId: {} };
const programOnly = upcomingRows.filter(r => !sandbox.isLunchOnlyEventId(r[progMap['Event_ID']]));
check('a lunch date is not a programme session',
  sandbox.computeProgramMetrics(programOnly, progMap, scan).totalSessions, 1);
check('and never gets listed as what is on today',
  sandbox.computeProgramMetrics(programOnly, progMap, scan).totalPrograms, 1);

// --- a lunch row says WHICH lunch ------------------------------------------
// "🥡 Lunch Only (no program)" named the row by what it isn't, which is only
// meaningful to somebody who already knows the row is generated. A person
// reading the schedule wants the two facts the old name left out: where, and
// what is being served.
sandbox.getMealInfoForDate = (date, loc) =>
  (loc === 'Narberth' ? { type: 'Hot', shorthand: 'Chx Parm', description: 'Chicken Parmesan' } : null);
check('a lunch row is named for its location and its dish',
  sandbox.lunchOnlyRowTitle('Narberth', '2026-09-16'), 'Lunch @ Narberth — Chx Parm');
// A menu that has not been typed yet still gives a usable name, and gains the
// dish on the next render without anything downstream noticing.
check('a lunch with no menu row typed yet is still named',
  sandbox.lunchOnlyRowTitle('Ashbridge', '2026-09-16'), 'Lunch @ Ashbridge');
check('the FORM keeps the location-scoped name, not one Tuesday\'s dish',
  sandbox.lunchOnlyProgramLabel('Narberth'), 'Lunch @ Narberth');

// Recognized by SHAPE, never by equality: the dish changes whenever somebody
// retypes a menu, and the old name is still sitting in registrant rows and
// Program_Options entries written before the rename.
check('a dated lunch title is recognized',
  sandbox.isLunchOnlyProgramTitle('Lunch @ Narberth — Chx Parm'), true);
check('so is a dishless one', sandbox.isLunchOnlyProgramTitle('Lunch @ Ashbridge'), true);
check('and so is the name written before the rename',
  sandbox.isLunchOnlyProgramTitle('🥡 Lunch Only (no program)'), true);
check('a real programme is not', sandbox.isLunchOnlyProgramTitle('Chair Yoga'), false);

// THE POINT OF THE CANONICAL KEY. Retyping Tuesday's menu renames the session
// row, but the people already registered for it keep the name they were
// written under — registrations are not rebuilt. Matching on the displayed
// string would hide them from the desk and drop them into the walk-in path,
// which would add a SECOND row for somebody who is already registered.
check('every spelling of a lunch title matches every other',
  [sandbox.quickMarkTitleKey('Lunch @ Narberth — Chx Parm'),
    sandbox.quickMarkTitleKey('Lunch @ Narberth — Turkey Wrap'),
    sandbox.quickMarkTitleKey('🥡 Lunch Only (no program)')]
    .every(k => k === sandbox.quickMarkTitleKey('Lunch @ Ashbridge')), true);
check('...and a programme still matches only itself',
  sandbox.quickMarkTitleKey('Chair Yoga') === sandbox.quickMarkTitleKey('Lunch @ Narberth'), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
