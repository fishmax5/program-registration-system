// PHANTOM GUEST NAMES (28_deletion_tombstones.gs) — see the block at the end.
const assert = require('assert');
const vm = require('vm');
const src = require('./helpers/source').readSource();

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
function fmt(d, tz, pattern) {
  switch (pattern) {
    case 'yyyy-MM-dd': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'H': return String(d.getHours());
    case 'h:mm a': return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    case 'EEE, MMM d': return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    case 'EEEE, MMM d': return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    case 'EEE, MMM d, yyyy': return `${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    default: return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

const props = { REGISTRANT_REMINDERS_V1: JSON.stringify({ chunks: 1 }), REGISTRANT_REMINDERS_V1_0: '{}' };
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: fmt, sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    setProperties: o => Object.assign(props, o),
    deleteProperty: k => { delete props[k]; }
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.sendWeeklyRegistrantEmails = sendWeeklyRegistrantEmails;
this.firstWeeklyEmailWeek_ = firstWeeklyEmailWeek_;
this.weeklyEmailIsDue_ = weeklyEmailIsDue_;
this.mondayOfDateKey_ = mondayOfDateKey_;
this.shiftDateKey_ = shiftDateKey_;
this.collectWeeklyEmailItems = collectWeeklyEmailItems;
this.isPhantomGuestName = isPhantomGuestName;
this.resolvePeopleOnResponse = resolvePeopleOnResponse;
this.resetWeeklyLedgerForTest = function () { __weeklyEmailLedgerCache = null; __weeklyEmailLedgerDirty = false; };
log = function () {};
spoolOfficeNote = function (section, line) { SPOOLED.push(line); };
noteForAdmin = function () {};
dayLongMailHoldInEffect = function () { return false; };
sendRationedEmail = function (msg) {
  if (msg.alreadySent && msg.alreadySent()) return { status: 'duplicate' };
  SENT.push(msg);
  if (msg.recordSent) msg.recordSent();
  return { status: 'sent' };
};
`.replace('SPOOLED', 'this.SPOOLED').replace('SENT.push', 'this.SENT.push'), sandbox);

// ---------------------------------------------------------------------------
// PHANTOM GUESTS (28's isPhantomGuestName). Nov 2026: "No One", "Just me" and
// the registrant's own name typed into a "Guest N Name" box each became a
// Guest row — a seat, a roster line, and a session listed twice in the
// weekly email. Such a box now reads as empty; a real guest still counts.
// ---------------------------------------------------------------------------
const f = sandbox.isPhantomGuestName;
[['No One', 'Veronica Socha'], ['Just me', 'Reda Scher'], ['N/A', 'Al Ross'], ['none.', 'Al Ross'],
 ['-', 'Al Ross'], ['Jamie koerner', 'Jamie Koerner'], ['Colette  Katz', 'Colette Katz'], ['Myself', 'A B']]
  .forEach(([g, r]) => assert.strictEqual(f(g, r), true, `"${g}" is nobody`));
[['Chick Scher', 'Reda Scher'], ['Judy Jervis', 'Jim Jervis'], ['Nora', 'Al'], ['Mona', 'Al'], ['Noel Smith', 'A']]
  .forEach(([g, r]) => assert.strictEqual(f(g, r), false, `"${g}" is a guest`));

// Through the real reader: only the real guest comes back.
sandbox.getResponseValueByTitle = (idx, resp, title) => ({ 'Guest 1 Name': 'Just me', 'Guest 2 Name': 'Chick Scher', 'Guest 3 Name': 'reda scher' })[title] || '';
const people = sandbox.resolvePeopleOnResponse({}, {}, 'Reda Scher', '');
assert.strictEqual(JSON.stringify(people.map(p => p.name)), JSON.stringify(['Reda Scher', 'Chick Scher']));

console.log('All phantom guest tests passed.');
