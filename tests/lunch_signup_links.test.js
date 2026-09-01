// The pinned lunch sign-up links on Master_Lunch_Dashboard: which of them
// survive a render, and in what order. Stubs just enough of Apps Script.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

// Frozen "now" so "this month" is a fixed fact: September 2026.
const NOW = new Date(2026, 8, 15, 9, 0, 0);
const RealDate = Date;

function fmt(date, tz, pattern) {
  const p = n => String(n).padStart(2, '0');
  if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
  if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return date.toISOString();
}

const sandbox = {
  console,
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: { formatDate: fmt, sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York' },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
// Top-level `const`s are lexical and do not land on the sandbox object.
vm.runInContext(src + `
;this.LUNCH_SIGNUP_HEADERS = LUNCH_SIGNUP_HEADERS;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const pin = (location, monthKey, monthLabel, dateCount) => ({
  location, monthKey, monthLabel, dateCount,
  formId: `form-${location}-${monthKey}`,
  publishedUrl: `https://forms/${location}/${monthKey}`,
  editUrl: `https://forms/${location}/${monthKey}/edit`
});

const stored = {
  'Narberth::August 2026': pin('Narberth', '2026-08', 'August 2026', 4),
  'Narberth::September 2026': pin('Narberth', '2026-09', 'September 2026', 3),
  'Ashbridge::September 2026': pin('Ashbridge', '2026-09', 'September 2026', 2),
  'Narberth::October 2026': pin('Narberth', '2026-10', 'October 2026', 5)
};

// --- the bug this exists for ----------------------------------------------
// A month with no catered dates left in the sync window is NOT a month whose
// form has stopped existing. Only a month that has ENDED stops being pinned.
const kept = sandbox.pruneLunchOnlyFormLinks(stored);
check('a month that has ended is dropped', Object.keys(kept).indexOf('Narberth::August 2026'), -1);
check('the current and future months are kept', Object.keys(kept).sort(),
  ['Ashbridge::September 2026', 'Narberth::October 2026', 'Narberth::September 2026']);

check('an entry with no link is not pinnable',
  Object.keys(sandbox.pruneLunchOnlyFormLinks({ x: { monthKey: '2026-09' } })), []);

check('an entry written before monthKey existed is kept, not guessed at',
  Object.keys(sandbox.pruneLunchOnlyFormLinks({
    x: { publishedUrl: 'https://forms/x', monthLabel: 'September 2026' }
  })), ['x']);

check('nothing stored is nothing pinned', Object.keys(sandbox.pruneLunchOnlyFormLinks({})), []);
check('an unreadable map is nothing pinned', Object.keys(sandbox.pruneLunchOnlyFormLinks(null)), []);

// --- ordering --------------------------------------------------------------
const rows = sandbox.buildLunchSignUpRows(stored);
check('soonest month first, then location',
  rows.map(r => `${r.location} ${r.monthLabel}`),
  ['Ashbridge September 2026', 'Narberth September 2026', 'Narberth October 2026']);
check('the ended month is not among them', rows.some(r => r.monthLabel === 'August 2026'), false);
check('the date count rides along', rows[0].dateCount, 2);

// --- the block's shape -----------------------------------------------------
check('the sign-up link is the last column, so it can overflow',
  sandbox.LUNCH_SIGNUP_HEADERS[sandbox.LUNCH_SIGNUP_HEADERS.length - 1], 'Sign_Up_Link');

const planEmpty = sandbox.getDashboardRowPlan(0);
check('an empty block still occupies one row, so it can say why', planEmpty.signUpRows, 1);
const planFour = sandbox.getDashboardRowPlan(4);
check('four months fit without an overflow line', planFour.signUpRows, 4);
const planMany = sandbox.getDashboardRowPlan(9);
check('more than the limit adds one overflow line', planMany.signUpRows, 5);
check('the block always starts at row 3', planFour.signUpDataStart, 3);
check('and Today starts below it',
  planFour.todayBannerRow > planFour.signUpDataEnd, true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
