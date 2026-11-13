// BULK APPOINTMENT PROGRAMS (99q) — each person is ONE date and ONE time, the
// time reaches Quick Mark's Register as `appointmentTime`, a row with no time
// writes nothing, and a standing place is never made on an appointment program.
const vm = require('vm');
const assert = require('assert');
const { readSource } = require('./helpers/source');

const RealDate = Date;
let CLOCK = new RealDate(2026, 8, 9, 9, 0, 0).getTime();
const pad = n => String(n).padStart(2, '0');
const store = {};
const triggers = [];
const props = {
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); },
  setProperties: o => { Object.keys(o).forEach(k => { store[k] = String(o[k]); }); },
  deleteProperty: k => { delete store[k]; },
  getProperties: () => Object.assign({}, store),
  getKeys: () => Object.keys(store)
};
const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [CLOCK])); }
    static now() { return CLOCK; }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${d.getMonth() + 1}/${d.getDate()}`;
    },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {},
    Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'job-1'
  },
  PropertiesService: { getScriptProperties: () => props, getUserProperties: () => props },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }),
    getActiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {
    newTrigger: handler => ({ timeBased: () => ({ after: ms => ({ create: () => {
      const t = { handler, ms, getHandlerFunction: () => handler, getUniqueId: () => handler + triggers.length };
      triggers.push(t); return t; } }) }) }),
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => { const i = triggers.indexOf(t); if (i !== -1) triggers.splice(i, 1); }
  },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  CacheService: { getScriptCache: () => null },
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(readSource(), sandbox);
const run = code => vm.runInContext(code, sandbox);


const calls = [];
sandbox.__calls = calls;
run(`
  listBulkRegistrantPrograms = () => [{ key: 'A|Tech', title: 'Computer Tech Support', location: 'A',
    label: 'Computer Tech Support — A', appointment: true,
    sessions: [{ value: 'Tech · 9/15', dateKey: '2026-09-15', dateLabel: 'Sep 15', times: [{ value: '10:00 AM', min: 600 }] },
               { value: 'Tech · 9/22', dateKey: '2026-09-22', dateLabel: 'Sep 22', times: [{ value: '11:00 AM', min: 660 }] }] }];
  flushPersistentRegistries = () => {};
  toastIfPossible = () => {};
  spoolOfficeNote = () => true;
  log = () => {};
  workbookHeldElsewhere = () => false;
  applyQuickMarkLocked = args => {
    __calls.push({ name: args.name, session: args.session, time: args.appointmentTime, standing: !!args.standing });
    return { ok: true, message: 'registered' };
  };
`);

sandbox.__args = { programKey: 'A|Tech', picked: [], people: [
  { name: 'Ann Test', recurrence: 'all', apptDate: '2026-09-22', appointmentTime: '11:00 AM' },
  { name: 'Bob Test', recurrence: 'club', apptDate: '2026-09-15', appointmentTime: '10:00 AM' },
  { name: 'Cal Test', recurrence: 'next', apptDate: '2026-09-15', appointmentTime: '' },
  { name: 'Dee Test', recurrence: 'next', apptDate: '2030-01-01', appointmentTime: '10:00 AM' }
] };
const st = run('startBulkRegistrants(__args)');
assert.strictEqual(st.ok, true);
for (let i = 0; i < 5 && run('bulkRegistrantsStatus()').active; i++) run('resumeBulkRegistrants()');
const done = run('bulkRegistrantsStatus()');
assert.strictEqual(done.done, true);

// Ann: the ONE date she was given, never "every date" even though her row said all.
assert.deepStrictEqual(calls.filter(c => c.name === 'Ann Test').map(c => [c.session, c.time]),
  [['Tech · 9/22', '11:00 AM']]);
// Bob: a "standing place" on an appointment program is never made.
assert.deepStrictEqual(calls.filter(c => c.name === 'Bob Test').map(c => [c.session, c.time, c.standing]),
  [['Tech · 9/15', '10:00 AM', false]]);
// Cal: no time -> nothing written. Dee: a date the program does not have -> nothing written.
assert.strictEqual(calls.filter(c => c.name === 'Cal Test').length, 0, 'no time, no write');
assert.strictEqual(calls.filter(c => c.name === 'Dee Test').length, 0, 'an unknown date, no write');
assert.ok(done.lines.some(l => /Cal Test/.test(l) && /no time was chosen/.test(l)), done.lines.join('\n'));
assert.ok(done.lines.some(l => /Ann Test/.test(l) && /Sep 22 at 11:00 AM/.test(l)), done.lines.join('\n'));

// The follow-up names the time as well as the day.
const entry = run(`bulkFollowUpEntryFor_(listBulkRegistrantPrograms()[0], [], { name: 'Ann Test', email: 'a@x.org', action: 'register', recurrence: 'picked', apptDate: '2026-09-22', appointmentTime: '11:00 AM' })`);
assert.strictEqual(entry.dates, 'Sep 22 at 11:00 AM');
console.log('bulk appointment: ok');
