// GUESTS ON THE DOOR LIST, AND THE SECOND SCREEN (section 16).
//
// Two changes to the check-in page, and the things about them that break
// quietly:
//
//   1. A GUEST IS NOT A NAME OF ITS OWN. A party of three arrives as one
//      person to greet and three meals to count. The roster folds a Guest row
//      into the Primary_Registrant's row — but every mark still has to land on
//      the guest's OWN sheet row, and a guest whose member is not on the list
//      must not vanish off it, which is the failure that would leave a
//      registered person standing at a door that has never heard of them.
//   2. THE REGISTER SCREEN IS NOT THE DEFAULT. A tablet at a door is opened
//      forty times a morning to mark somebody in; ?page=register is the link
//      the desk phone keeps, and anything else must open the door list.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

const HEADER_ROW = [
  'Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended', 'Lunch_Served',
  'Person_Type', 'Primary_Registrant', 'Event_ID'
];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'yyyy-MM-dd') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
          `${String(d.getDate()).padStart(2, '0')}`;
      }
      if (fmt === 'EEE, MMM d, yyyy') return 'Wed, Sep 16, 2026';
      return '9:00 AM';
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + ';this.HEADERS = HEADERS; this.CALENDAR_MAP = CALENDAR_MAP;',
  sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

function sheetFrom(rows) {
  const values = [HEADER_ROW].concat(rows);
  return {
    getName: () => 'Registrant_Dash',
    getLastRow: () => values.length,
    getLastColumn: () => HEADER_ROW.length,
    getMaxRows: () => values.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || HEADER_ROW.length))),
      getValue: () => values[row - 1][col - 1],
      getDisplayValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || HEADER_ROW.length)).map(String))
    })
  };
}

const realHeaders = sandbox.HEADERS.Registrant_Dash;
function withStubSheet(rows, fn) {
  sandbox.HEADERS.Registrant_Dash = HEADER_ROW;
  const sheet = sheetFrom(rows);
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sheet });
  // Each call stands in for a fresh execution against a fresh sheet — the
  // per-execution sectioned-rows cache (08_execution_caches.gs) has to start
  // empty too, or the next scenario's read comes back as this one's rows.
  sandbox.invalidateSectionedRowsCache();
  try { return fn(); } finally {
    sandbox.HEADERS.Registrant_Dash = realHeaders;
    sandbox.SpreadsheetApp.getActiveSpreadsheet = () => null;
  }
}

const d = key => new Date(key + 'T12:00:00');
const session = 'Chair Yoga · Wed, Sep 16, 2026';

// ---------------------------------------------------------------------------
// 1. A member, her two guests, and somebody who came alone.
// ---------------------------------------------------------------------------
const rows = [
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM', 'Ruth Klein', true, false,
    'Attendee', 'Self', 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM', 'Dina Klein', false, false,
    'Guest', 'Ruth Klein', 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM', 'Ari Klein', true, false,
    'Guest', 'Ruth Klein', 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM', 'Al Morris', false, false,
    'Attendee', 'Self', 'evt1']
];

const roster = withStubSheet(rows, () => sandbox.readCheckInRoster('Narberth', session));
ok('the list is two people long, not four', roster.length === 2);
const ruth = roster.filter(r => r.name === 'Ruth Klein')[0];
ok('the member is on it', !!ruth);
ok('and her guests hang off her row', ruth && ruth.guests.length === 2);
ok('each guest keeps its own name', ruth &&
  ruth.guests.map(g => g.name).sort().join(',') === 'Ari Klein,Dina Klein');
// Every mark lands on the guest's own row, so the guest's own state has to
// survive the fold — a party shown as all-present when one of them is not
// would be a lunch count that is wrong by one.
ok('and its own attendance', ruth &&
  ruth.guests.filter(g => g.attended).length === 1);
ok('somebody who came alone has an empty party, not a missing one',
  roster.filter(r => r.name === 'Al Morris')[0].guests.length === 0);
ok('no guest is listed as a person of their own',
  roster.every(r => r.name !== 'Dina Klein' && r.name !== 'Ari Klein'));

// ---------------------------------------------------------------------------
// 2. A guest whose member is NOT on the list still gets a row.
// ---------------------------------------------------------------------------
// The member cancelled and the guest did not, or a name was retyped on one row
// and not the other. The one outcome that must never happen at a door is a
// registered person who is on no list at all.
const orphaned = withStubSheet([
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM', 'Dina Klein', false, false,
    'Guest', 'Ruth Klein', 'evt1']
], () => sandbox.readCheckInRoster('Narberth', session));
ok('an orphan guest is still on the list', orphaned.length === 1);
ok('and the list says whose guest they are', orphaned[0].guestOf === 'Ruth Klein');

// A guest booked at a DIFFERENT appointment slot from the member is not that
// member's party on this screen — the slot is what a provider's list is read
// by, and folding across slots would put a name at a time it does not hold.
const twoSlots = withStubSheet([
  [d('2026-09-16'), 'Narberth', 'Computer Help', '10:00 AM', 'Ruth Klein', false, false,
    'Attendee', 'Self', 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Computer Help', '11:00 AM', 'Dina Klein', false, false,
    'Guest', 'Ruth Klein', 'evt1']
], () => sandbox.readCheckInRoster('Narberth', 'Computer Help · Wed, Sep 16, 2026'));
ok('a guest at another slot is not folded into the member', twoSlots.length === 2);

// ---------------------------------------------------------------------------
// 3. Which screen the page opens on.
// ---------------------------------------------------------------------------
function optionsOf(html) {
  const m = /var OPTS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/.exec(html);
  return m ? JSON.parse(JSON.parse(m[1])) : null;
}
const index = {
  builtAt: '9:00 AM',
  sessions: [
    { value: session, label: session, location: 'Narberth', title: 'Chair Yoga',
      dateKey: '2026-09-16', byAppointment: false, times: [], group: 'Upcoming' },
    // A session that has already happened: markable, but never registerable.
    { value: 'Chair Yoga · Wed, Jan 7, 2015', label: 'Chair Yoga · Wed, Jan 7, 2015',
      location: 'Narberth', title: 'Chair Yoga', dateKey: '2015-01-07',
      byAppointment: false, times: [], group: 'Past' }
  ],
  namesBySession: {}, members: [{ name: 'Ruth Klein', key: 'ruth klein' }], needs: []
};

const door = optionsOf(sandbox.buildCheckInHtml(index, { location: 'Narberth', page: 'checkin' }));
ok('the door list is what an ordinary link opens', door.page === 'checkin');
const reg = optionsOf(sandbox.buildCheckInHtml(index, { location: 'Narberth', page: 'register' }));
ok('?page=register opens the second screen', reg.page === 'register');

// Registering somebody for last Tuesday is not a thing a desk does.
ok('only upcoming sessions can be registered onto',
  reg.upcoming.length === 1 && reg.upcoming[0].dateKey === '2026-09-16');

// The names travel with the page for the register screen's type-ahead — a
// server call at the moment a volunteer starts typing is the wait this page
// exists to avoid.
ok('the roll is inlined for the name box',
  /var INDEX = "/.test(sandbox.buildCheckInHtml(index, { page: 'register' })));

// ---------------------------------------------------------------------------
// 4. The register call refuses the two things it cannot act on.
// ---------------------------------------------------------------------------
const noName = sandbox.checkInRegister(JSON.stringify({ session: session, name: '  ' }));
ok('a blank name registers nothing', noName.ok === false && /name/i.test(noName.message));
const noSession = sandbox.checkInRegister(JSON.stringify({ name: 'Ruth Klein', session: '' }));
ok('and so does a missing session', noSession.ok === false && /session/i.test(noSession.message));

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed');
process.exit(fail ? 1 : 0);
