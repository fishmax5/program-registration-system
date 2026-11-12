// The mail-volume audit: counts what the CURRENT policies would send per address.
const vm = require('vm');
const src = require('./helpers/source').readSource();
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null }, FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {},
  HtmlService: {}, LockService: {}, Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + '\n;this.a = analyzeRegistrantMailVolume_; this.d = describeRegistrantMailVolume_;', sandbox, { filename: 'p.gs' });
let failures = 0;
const check = (n, a, e) => { const x = JSON.stringify(a), y = JSON.stringify(e);
  if (x === y) console.log('ok   ' + n); else { failures++; console.log('FAIL ' + n + '\n  got ' + x + '\n  exp ' + y); } };

const sessions = [
  { eventId: 'A1', dateKey: '2026-11-17', title: 'Taxes', location: 'Narberth', isAssistance: true },
  { eventId: 'B1', dateKey: '2026-11-17', title: 'Chair Yoga', location: 'Narberth', isAssistance: false },
  { eventId: 'B2', dateKey: '2026-11-18', title: 'Chair Yoga', location: 'Narberth', isAssistance: false }
];
// assistance: day-before only; ordinary: nothing; (a stray ticked ordinary row sends a week-before + invite)
const policy = s => s.eventId === 'A1' ? { invite: false, remind: true, days: [1], confirmTime: false }
  : s.eventId === 'B2' ? { invite: true, remind: true, days: [7, 1], confirmTime: false }
  : { invite: false, remind: false, days: [], confirmTime: false };
const regs = [
  { eventId: 'A1', email: 'Pat@x.org', status: 'Active' },
  { eventId: 'B1', email: 'pat@x.org', status: 'Active' },
  { eventId: 'B2', email: 'lee@x.org', status: 'Active' },
  { eventId: 'A1', email: 'gone@x.org', status: 'Cancelled' },
  { eventId: 'A1', email: 'not-an-email', status: 'Active' }
];
const r = sandbox.a(sessions, regs, policy, '2026-11-12', 7);
check('assistance person gets exactly one', r.perAddress['pat@x.org'], 1);
// B2 on 11-18: 7-before = 11-11 (before today, not counted), 1-before = 11-17 (counted), invite counted (in window)
check('a stray ticked row counts its day-before and invite only', r.perAddress['lee@x.org'], 2);
check('cancelled and implausible addresses are not counted', Object.keys(r.perAddress).sort(), ['lee@x.org', 'pat@x.org']);
check('a program that sends nothing does not appear', Object.keys(r.byProgram).sort(), ['Chair Yoga — Narberth', 'Taxes — Narberth']);
check('a quiet week says so', /Nothing to consolidate/.test(sandbox.d(sandbox.a([], [], policy, '2026-11-12', 7), 7)), true);
console.log(failures ? failures + ' failure(s)' : 'all passed'); process.exit(failures ? 1 : 0);
