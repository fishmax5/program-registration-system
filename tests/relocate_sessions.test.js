// RELOCATING SESSIONS (99zy_relocate_sessions.gs) — the pure halves: which dates a
// building lists, what a ticked Event_ID plans to, and the registrant rewrite.
// The calendar move and the form load are Apps Script services this cannot run;
// what is pinned here is everything that decides WHICH rows move and WHAT they
// become.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');

const notes = [];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    },
    // computeEventId() digests `calendarId|cleanTitle|dateKey` and keeps the
    // first twelve hex characters, so the digest has to actually spread across
    // the whole input: a stub that echoed the bytes of the raw string gave
    // every date of one program the same id, since only the calendar's first
    // six characters survived the truncation.
    computeDigest: (algo, raw) =>
      Array.from(require('crypto').createHash('md5').update(String(raw)).digest()),
    DigestAlgorithm: { MD5: 'MD5' },
    sleep: () => {},
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    Charset: { UTF_8: 'UTF-8' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.groupRelocatableSessions_ = groupRelocatableSessions_;
this.planRelocation_ = planRelocation_;
this.relocateRegistrantRows_ = relocateRegistrantRows_;
this.countLiveRegistrantsByEvent_ = countLiveRegistrantsByEvent_;
this.relocateCalendarIdForLocation_ = relocateCalendarIdForLocation_;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.CALENDAR_MAP = CALENDAR_MAP;
this.LEDGER_SOURCES = LEDGER_SOURCES;
// The two writers the rewrite calls out to are stubbed: ids are resolved
// through the ledger and the note through a stamp, neither of which is the
// subject here.
ledgerIdForRegistrantRow = function (row) { return 'R-' + row[this.__regMap['Name']]; }.bind(this);
appendAdminNote = function (row, map, text) { row[map['Admin_Notes']] = text; };
writeMealsOrdered = function (row, map, n) { row[map['Meals_Ordered']] = n; };
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const map = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
const regMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
sandbox.__regMap = regMap;
const NARBERTH = Object.keys(sandbox.CALENDAR_MAP).filter(k => sandbox.CALENDAR_MAP[k] === 'Narberth')[0];
const ASHBRIDGE = Object.keys(sandbox.CALENDAR_MAP).filter(k => sandbox.CALENDAR_MAP[k] === 'Ashbridge')[0];

const day = n => new Date(2026, 10, n);
const srow = o => {
  const r = new Array(sandbox.HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(o).forEach(k => { r[map[k]] = o[k]; });
  return r;
};
const rrow = o => {
  const r = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
  Object.keys(o).forEach(k => { r[regMap[k]] = o[k]; });
  return r;
};

ok('a building name resolves to its calendar, any case',
  sandbox.relocateCalendarIdForLocation_('ashbridge') === ASHBRIDGE);
ok('an unknown building resolves to nothing', sandbox.relocateCalendarIdForLocation_('Nowhere') === '');

const sessions = [
  srow({ Event_ID: 'n1', Clean_Title: 'Chair Yoga', Calendar_Source: NARBERTH, Event_Date: day(10), Event_Time: '9:00 AM' }),
  srow({ Event_ID: 'n2', Clean_Title: 'Chair Yoga', Calendar_Source: NARBERTH, Event_Date: day(17) }),
  srow({ Event_ID: 'n3', Clean_Title: 'Bingo', Calendar_Source: NARBERTH, Event_Date: day(11) }),
  srow({ Event_ID: 'a1', Clean_Title: 'Chair Yoga', Calendar_Source: ASHBRIDGE, Event_Date: day(10) }),
  srow({ Event_ID: 'old', Clean_Title: 'Bingo', Calendar_Source: NARBERTH, Event_Date: new Date(2026, 0, 5) }),
  srow({ Event_ID: 'lunch', Clean_Title: 'Lunch', Calendar_Source: '', Event_Date: day(10) })
];

// 1. THE LIST
{
  const out = sandbox.groupRelocatableSessions_(sessions, map, NARBERTH, { n1: 3 }, '2026-11-01', '2027-03-01');
  ok('only the source building\'s calendar is listed', out.every(p => p.sessions.every(s => s.eventId[0] === 'n')));
  ok('two programs, alphabetical', out.map(p => p.title).join() === 'Bingo,Chair Yoga', out.map(p => p.title).join());
  ok('a past date is not offered', !out[0].sessions.some(s => s.eventId === 'old'));
  ok('a row with no calendar behind it (lunch) is never offered',
    !out.some(p => p.title === 'Lunch'));
  const yoga = out.filter(p => p.title === 'Chair Yoga')[0];
  ok('dates in order, with the registered count shown', yoga.sessions[0].eventId === 'n1' &&
    /3 registered/.test(yoga.sessions[0].label) && !/registered/.test(yoga.sessions[1].label));
}

// 2. THE PLAN
{
  const plan = sandbox.planRelocation_(sessions, map, ['n2', 'n1', 'gone', 'a1'], NARBERTH);
  ok('ticked dates plan in date order', plan.items.map(i => i.eventId).join() === 'n1,n2');
  ok('a tick that is already moved or gone is reported, not planned', plan.missing.sort().join() === 'a1,gone');
}

// 3. THE PEOPLE
{
  const rows = [
    rrow({ Event_ID: 'n1', Name: 'Ann', Program_Status: 'Active', Lunch_Type: 'Chicken', Lunch_Status: 'Needed', Location: 'Narberth', Attended: true }),
    rrow({ Event_ID: 'n1', Name: 'Bea', Program_Status: 'Cancelled', Location: 'Narberth' }),
    rrow({ Event_ID: 'n1', Name: 'Cy', Program_Status: 'Superseded', Location: 'Narberth' }),
    rrow({ Event_ID: 'n2', Name: 'Dot', Program_Status: 'Active', Location: 'Narberth' })
  ];
  const to = { eventId: 'a1', location: 'Ashbridge', date: day(10) };
  const out = sandbox.relocateRegistrantRows_(rows, regMap, 'n1', to, false, 'moved note');
  ok('active and cancelled people move; the superseded history stays',
    out.moved.map(m => m.row[regMap['Name']]).join() === 'Ann,Bea' &&
    rows[2][regMap['Event_ID']] === 'n1');
  ok('somebody on another date is untouched', rows[3][regMap['Event_ID']] === 'n2' && rows[3][regMap['Location']] === 'Narberth');
  ok('the id and building are rewritten',
    rows[0][regMap['Event_ID']] === 'a1' && rows[0][regMap['Location']] === 'Ashbridge');
  ok('the ledger id is read BEFORE the Event_ID changes',
    out.moved[0].ledgerId === 'R-Ann' && out.moved[0].fromEventId === 'n1');
  ok('the move is protected from re-derivation', rows[0][regMap['Manual_Override']] === 'Manually Edited');
  ok('attendance stays — the day did not change', rows[0][regMap['Attended']] === true);
  ok('no lunch there: the meal is taken off and counted',
    rows[0][regMap['Lunch_Status']] === 'No Lunch' && out.mealsDropped === 1);

  const kept = [rrow({ Event_ID: 'n1', Name: 'Eve', Program_Status: 'Active', Lunch_Type: 'Chicken', Lunch_Status: 'Needed' })];
  const out2 = sandbox.relocateRegistrantRows_(kept, regMap, 'n1', to, true, 'x');
  ok('lunch served there: the meal is kept', kept[0][regMap['Lunch_Status']] === 'Needed' && out2.mealsDropped === 0);
}

// 4. THE LEDGER'S WORD FOR IT
ok('the ledger has its own source for a relocation', sandbox.LEDGER_SOURCES.RELOCATE === 'relocate');

const live = sandbox.countLiveRegistrantsByEvent_([
  rrow({ Event_ID: 'n1', Program_Status: 'Active' }), rrow({ Event_ID: 'n1', Program_Status: '' }),
  rrow({ Event_ID: 'n1', Program_Status: 'Cancelled' }), rrow({ Event_ID: 'n1', Program_Status: 'Superseded' })
], regMap);
ok('live count skips cancelled and superseded; a blank status is active', live.n1 === 2, String(live.n1));

console.log(failures === 0 ? '\nAll relocate-session tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
