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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
