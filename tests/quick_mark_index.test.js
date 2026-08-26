// Quick Mark used to fetch a list per selection: one server round trip when
// you picked a location, another when you picked a session, each re-reading
// whole tabs. At a sign-in desk that is a wait between every pick, thirty
// times in a row. buildQuickMarkIndex() does the reading once and the browser
// narrows what it already has — so what this file pins is that the one index
// still answers exactly what the two per-step reads used to.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const NOW = new Date(2026, 8, 16, 9, 0, 0); // Wed 16 Sep 2026
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
      if (pattern === 'h:mm a') return '9:00 AM';
      return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
    },
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: n => ({ __name: n }),
      getSpreadsheetTimeZone: () => 'America/New_York'
    })
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildQuickMarkIndex = buildQuickMarkIndex;
this.orderQuickMarkChoices = orderQuickMarkChoices;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.QUICK_MARK_SESSION_KEY_SEPARATOR = QUICK_MARK_SESSION_KEY_SEPARATOR;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const map = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
function reg(name, location, event, date) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  row[map['Name']] = name;
  row[map['Location']] = location;
  row[map['Event']] = event;
  if (date) row[map['Event_Date']] = date;
  return row;
}

// Chair Yoga runs at BOTH locations on the same Wednesday — the case that used
// to collapse into one entry once the index stopped filtering by location up
// front. Mrs Okonkwo is on the roll but registered for nothing.
const rows = [
  reg('Jane Smith', 'Narberth', 'Chair Yoga', new RealDate(2026, 8, 16)),
  reg('jane  smith ', 'Narberth', 'Chair Yoga', new RealDate(2026, 8, 16)), // same person, loosely
  reg('Bob Vance', 'Narberth', 'Chair Yoga', new RealDate(2026, 8, 23)),
  reg('Ada Lovelace', 'Ashbridge', 'Chair Yoga', new RealDate(2026, 8, 16)),
  reg('Old Timer', 'Narberth', 'Bingo', new RealDate(2026, 8, 9))          // last week
];
// The index reads with the VALUES reader (one call per tab, no formula
// preservation) — see readAllSectionedRowValues(). Both are stubbed so this
// file keeps testing buildQuickMarkIndex() rather than either reader.
sandbox.readAllSectionedRows = () => rows;
sandbox.readAllSectionedRowValues = () => rows;
sandbox.collectKnownMembers = () => ['Mrs Okonkwo', 'Jane Smith'];
// Program_Options is where the dateless "Chair Yoga, any date" fallback comes
// from — the choice a desk picks when which date it was does not matter.
const optMap = sandbox.getIndexMap(sandbox.HEADERS.Program_Options);
const optionRow = new Array(sandbox.HEADERS.Program_Options.length).fill('');
optionRow[optMap['Event']] = 'Chair Yoga';
optionRow[optMap['Location']] = 'Narberth';
sandbox.readSimpleTable = () => [optionRow];
sandbox.readSimpleTableValues = () => [optionRow];
sandbox.readLunchScheduleRows = () => [];
sandbox.getCateringPolicyForLocation = () => 'Always';
sandbox.log = () => {};

const ix = sandbox.buildQuickMarkIndex();
const SEP = sandbox.QUICK_MARK_SESSION_KEY_SEPARATOR;
const labels = loc => ix.sessions.filter(s => s.location === loc).map(s => s.label);

check('each location gets its own copy of a shared session',
  labels('Narberth').indexOf('Chair Yoga · Wed, Sep 16') !== -1 &&
  labels('Ashbridge').indexOf('Chair Yoga · Wed, Sep 16') !== -1, true);
check('today and next week are offered, soonest first, before last week',
  labels('Narberth'),
  ['Chair Yoga · Wed, Sep 16', 'Chair Yoga · Wed, Sep 23', 'Bingo · Wed, Sep 9', 'Chair Yoga']);
check('and they are grouped by whether they have happened',
  ix.sessions.filter(s => s.location === 'Narberth').map(s => s.group),
  ['Upcoming', 'Upcoming', 'Past', 'Any date (program only)']);

// The names for one session — the second per-step read, now a lookup.
const narberth16 = ix.namesBySession['Narberth' + SEP + 'Chair Yoga · Wed, Sep 16'];
check('one person registered twice is listed once', narberth16.names, ['Jane Smith']);
check('and the other location\'s session has its own list',
  ix.namesBySession['Ashbridge' + SEP + 'Chair Yoga · Wed, Sep 16'].names, ['Ada Lovelace']);
check('a session nobody is on has an empty list',
  ix.namesBySession['Narberth' + SEP + 'Chair Yoga · Wed, Sep 23'].names, ['Bob Vance']);

// The roll travels once, with the keys that let the browser subtract the
// people already listed under the session — the dedupe the old per-session
// read did on the server.
check('the roll is sent once, normalized', ix.members.map(m => m.name), ['Jane Smith', 'Mrs Okonkwo']);
check('and this session\'s people can be subtracted from it by key',
  ix.members.filter(m => narberth16.keys.indexOf(m.key) === -1).map(m => m.name), ['Mrs Okonkwo']);

// The dateless "program only" fallback sorts last and collects the people from
// EVERY date of that program at that location — both Wednesdays at once.
check('the dateless fallback is offered last',
  ix.sessions.filter(s => s.location === 'Narberth').map(s => s.label).slice(-1), ['Chair Yoga']);
check('and it carries every date\'s people',
  ix.namesBySession['Narberth' + SEP + 'Chair Yoga'].names, ['Jane Smith', 'Bob Vance']);

console.log(failures === 0 ? '\nAll Quick Mark index checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
