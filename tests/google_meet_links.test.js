// Google Meet links on the calendar event (99zt):
//
//   - the Google_Meet setting: Auto is yes on the Zoom calendar or with a
//     tag-only [Hybrid] bracket, Yes and No are exactly that,
//   - [Hybrid] in prose is not a tag,
//   - the reconcile pass: a Meet is created on a Zoom event with none, an
//     existing Meet is read rather than duplicated, a recurring series is
//     patched ONCE on its master, a row already linked costs no call, a past
//     session is left alone, and a refused patch is a blank cell, not a throw,
//   - the program dashboard carries the link as its own column.
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const pad = n => String(n).padStart(2, '0');
const store = {};
const props = {
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); return props; },
  deleteProperty: k => { delete store[k]; return props; },
  getProperties: () => Object.assign({}, store)
};

const calls = { get: [], list: [], patch: [] };
const resources = {};
let refusePatch = false;
const CalendarService = {
  Events: {
    get: (cal, id) => {
      calls.get.push(id);
      if (!resources[id]) throw new Error('Not Found');
      return resources[id];
    },
    list: (cal, opts) => { calls.list.push(opts.iCalUID); return { items: [] }; },
    patch: (body, cal, id, opts) => {
      calls.patch.push({ id, opts, body });
      if (refusePatch) throw new Error('Forbidden');
      const url = `https://meet.google.com/new-${id}`;
      resources[id] = Object.assign({}, resources[id], { hangoutLink: url });
      return resources[id];
    }
  }
};

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new Date(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
    getUuid: () => 'uuid-1',
    computeDigest: () => [],
    DigestAlgorithm: { MD5: 'MD5' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => props, getUserProperties: () => props },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: { ItemType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: CalendarService, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.PROGRAM_MONTH_LINK_PARTS = PROGRAM_MONTH_LINK_PARTS;
this.PROGRAM_SETTINGS_STAFF_COLUMNS = PROGRAM_SETTINGS_STAFF_COLUMNS;
this.resetMeetMemo = () => { __meetLinkMemo = {}; };
this.setPolicyRows = rows => { __notificationPolicyRowsCache = rows; };
`, sandbox, { filename: 'program.gs' });
sandbox.log = () => {};
const adminNotes = [];
sandbox.noteForAdmin = (section, line) => adminNotes.push(line);

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- the decision -----------------------------------------------------------
check('Auto on the Zoom calendar is yes', sandbox.meetLinkWanted('auto', 'Zoom', false), true);
check('Auto with [Hybrid] is yes', sandbox.meetLinkWanted('auto', 'Narberth', true), true);
check('Auto otherwise is no', sandbox.meetLinkWanted('auto', 'Narberth', false), false);
check('No beats the Zoom calendar', sandbox.meetLinkWanted('no', 'Zoom', true), false);
check('Yes anywhere', sandbox.meetLinkWanted('yes', 'Ashbridge', false), true);
check('a blank cell reads as Auto', sandbox.parseGoogleMeetSetting(''), 'auto');
check('a ticked-looking cell reads as Yes', sandbox.parseGoogleMeetSetting('TRUE'), 'yes');
check('[Hybrid] is a tag', sandbox.textHasHybridTag('Chair Yoga [Hybrid]'), true);
check('[Hybrid, Cap: 12] is a tag', sandbox.textHasHybridTag('<p>[Hybrid, Cap: 12]</p>'), true);
check('[Hybrid of yoga and pilates] is prose', sandbox.textHasHybridTag('[Hybrid of yoga and pilates]'), false);
check('[Hybrid] is a recognized tag, so it comes off the form description',
  sandbox.calendarDescriptionToFormText('[Hybrid]\nBring a mat.'), 'Bring a mat.');

// --- the reconcile pass -----------------------------------------------------
const sHeaders = sandbox.HEADERS.All_Program_Sessions;
check('Meet_Link is the last session column', sHeaders[sHeaders.length - 1], 'Meet_Link');
const sMap = sandbox.getIndexMap(sHeaders);
const rowWith = values => { const r = sHeaders.map(() => ''); Object.keys(values).forEach(k => { r[sMap[k]] = values[k]; }); return r; };

const ZOOM = 'zoom@group.calendar.google.com';
const NARB = 'narb@group.calendar.google.com';
const now = new Date();
const future = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 10, 0);
const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 10, 0);

const event = (id, start, opts) => Object.assign({
  getId: () => id, getStartTime: () => start, getEndTime: () => start,
  getTitle: () => 'T', getDescription: () => '', isRecurringEvent: () => false
}, opts || {});

const grid = [
  ['All Program Sessions'],
  ['⏳ Upcoming'],
  sHeaders.slice(),
  rowWith({ Event_Date: future(2), Clean_Title: 'Book Talk', Location: 'Zoom', Calendar_Source: ZOOM }),
  rowWith({ Event_Date: future(3), Clean_Title: 'Chair Yoga', Location: 'Narberth', Calendar_Source: NARB }),
  rowWith({ Event_Date: future(10), Clean_Title: 'Chair Yoga', Location: 'Narberth', Calendar_Source: NARB }),
  rowWith({ Event_Date: future(4), Clean_Title: 'Bingo', Location: 'Narberth', Calendar_Source: NARB }),
  rowWith({ Event_Date: future(5), Clean_Title: 'Lecture', Location: 'Zoom', Calendar_Source: ZOOM,
    Meet_Link: '=HYPERLINK("https://meet.google.com/kept","Join Meet")' }),
  rowWith({ Event_Date: past, Clean_Title: 'Old Talk', Location: 'Zoom', Calendar_Source: ZOOM })
];
const sheet = makeCountingSheet(grid, 'All_Program_Sessions');

resources['single1'] = { id: 'single1', summary: 'Book Talk' };
resources['yogaseries'] = { id: 'yogaseries', summary: 'Chair Yoga [Hybrid]', recurrence: ['RRULE:FREQ=WEEKLY'] };
resources['lecture'] = { id: 'lecture', summary: 'Lecture', hangoutLink: 'https://meet.google.com/should-not-be-read' };
resources['old'] = { id: 'old', summary: 'Old Talk' };
const yogaOpts = {
  isRecurringEvent: () => true, getTitle: () => 'Chair Yoga [Hybrid]'
};
const groups = [
  { cleanTitle: 'Book Talk', sessions: [{ calendarId: ZOOM, locationName: 'Zoom',
    event: event('single1@google.com', future(2)) }] },
  { cleanTitle: 'Chair Yoga', sessions: [
    { calendarId: NARB, locationName: 'Narberth',
      event: event(`yogaseries_${pad(1)}@google.com`, future(3), yogaOpts) },
    { calendarId: NARB, locationName: 'Narberth',
      event: event(`yogaseries_${pad(2)}@google.com`, future(10), yogaOpts) }
  ] },
  { cleanTitle: 'Bingo', sessions: [{ calendarId: NARB, locationName: 'Narberth',
    event: event('bingo@google.com', future(4)) }] },
  { cleanTitle: 'Lecture', sessions: [{ calendarId: ZOOM, locationName: 'Zoom',
    event: event('lecture@google.com', future(5)) }] },
  { cleanTitle: 'Old Talk', sessions: [{ calendarId: ZOOM, locationName: 'Zoom',
    event: event('old@google.com', past) }] }
];
// seriesIdFromInstanceId wants a real occurrence stamp; give the yoga ids one.
groups[1].sessions[0].event.getId = () => 'yogaseries_20261101T140000Z@google.com';
groups[1].sessions[1].event.getId = () => 'yogaseries_20261108T140000Z@google.com';

sandbox.setPolicyRows({});
sandbox.resetMeetMemo();
const changed = sandbox.reconcileMeetLinksFromCalendar(sheet, groups, {});
check('three rows linked (the Zoom single, both yoga dates)', changed, 3);
check('a Zoom event with no Meet gets one',
  grid[3][sMap['Meet_Link']], '=HYPERLINK("https://meet.google.com/new-single1","Join Meet")');
check('both dates of a recurring [Hybrid] series share the MASTER\'s Meet',
  [grid[4][sMap['Meet_Link']], grid[5][sMap['Meet_Link']]],
  ['=HYPERLINK("https://meet.google.com/new-yogaseries","Join Meet")',
    '=HYPERLINK("https://meet.google.com/new-yogaseries","Join Meet")']);
check('the series was patched once, on its master, with conference data v1 and no mail',
  calls.patch.filter(p => p.id === 'yogaseries').map(p => [p.opts.conferenceDataVersion, p.opts.sendUpdates]),
  [[1, 'none']]);
check('a plain in-person program gets nothing', grid[6][sMap['Meet_Link']], '');
check('a row already linked costs no call', calls.get.indexOf('lecture'), -1);
check('…and keeps its link', grid[7][sMap['Meet_Link']], '=HYPERLINK("https://meet.google.com/kept","Join Meet")');
check('a past session is left alone', [grid[8][sMap['Meet_Link']], calls.get.indexOf('old')], ['', -1]);

// An event that already has a Meet is READ, not given a second one.
calls.patch.length = 0;
grid[3][sMap['Meet_Link']] = '';
resources['single1'] = { id: 'single1', hangoutLink: 'https://meet.google.com/existing' };
sandbox.invalidateSectionedRowsCache(sheet);
sandbox.resetMeetMemo();
sandbox.reconcileMeetLinksFromCalendar(sheet, groups, {});
check('an existing Meet is read, not duplicated',
  [grid[3][sMap['Meet_Link']], calls.patch.length],
  ['=HYPERLINK("https://meet.google.com/existing","Join Meet")', 0]);

// Program_Settings says No: nothing is created, nothing is removed.
calls.patch.length = 0;
grid[3][sMap['Meet_Link']] = '';
resources['single1'] = { id: 'single1' };
const pMap = sandbox.getIndexMap(sandbox.HEADERS.Program_Settings);
const noRow = sandbox.HEADERS.Program_Settings.map(() => '');
noRow[pMap['Event']] = 'Book Talk'; noRow[pMap['Location']] = 'Zoom'; noRow[pMap['Google_Meet']] = 'No';
const rows = {}; rows[sandbox.notificationProgramKey('Book Talk', 'Zoom')] = noRow;
sandbox.setPolicyRows(rows);
sandbox.invalidateSectionedRowsCache(sheet);
sandbox.resetMeetMemo();
sandbox.reconcileMeetLinksFromCalendar(sheet, groups, {});
check('Google_Meet = No: no Meet made', [grid[3][sMap['Meet_Link']], calls.patch.length], ['', 0]);

// A refused patch is a blank cell and an office note, never a throw.
sandbox.setPolicyRows({});
refusePatch = true;
sandbox.invalidateSectionedRowsCache(sheet);
sandbox.resetMeetMemo();
let threw = false;
try { sandbox.reconcileMeetLinksFromCalendar(sheet, groups, {}); } catch (err) { threw = true; }
check('a refused patch does not throw', threw, false);
check('…leaves the cell blank', grid[3][sMap['Meet_Link']], '');
check('…and tells the office', adminNotes.some(n => /edit access/.test(n)), true);
refusePatch = false;

// --- the program dashboard ---------------------------------------------------
check('Master_Program_Dashboard has a Meet_Link column',
  sandbox.HEADERS.Master_Program_Dashboard.indexOf('Meet_Link') !== -1, true);
const part = sandbox.PROGRAM_MONTH_LINK_PARTS.filter(p => p.column === 'Meet_Link')[0];
check('…drawn from the session table\'s Meet_Link',
  sandbox.programMonthLinkCell(part, '=HYPERLINK("https://meet.google.com/abc","Join Meet")'),
  '=HYPERLINK("https://meet.google.com/abc","Join Meet")');
check('Program_Settings offers the Google_Meet setting, staff-owned',
  [sandbox.HEADERS.Program_Settings.indexOf('Google_Meet') !== -1,
    sandbox.PROGRAM_SETTINGS_STAFF_COLUMNS.indexOf('Google_Meet') !== -1], [true, true]);

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall google meet link checks passed');
