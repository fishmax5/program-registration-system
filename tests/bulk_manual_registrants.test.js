// BULK MANUAL REGISTRANTS (99q) — the paste, the roll match, the grouping and
// which dates a person is put on. The writes themselves are Quick Mark's
// Register (applyQuickMarkLocked), pinned by its own tests.
const vm = require('vm');
const assert = require('assert');
const { readSource } = require('./helpers/source');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 9, 9, 0, 0);
const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${d.getMonth() + 1}/${d.getDate()}`;
    },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {},
    Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'u'
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {},
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(readSource(), sandbox);
const run = code => vm.runInContext(code, sandbox);

// 1. The paste: header, no header, "Last, First" in one cell, shapes.
let people = run(`parseBulkRegistrantPaste('First,Last,Phone,Email\\nJane,Smith,610-555-0100,jane@x.org\\nBob,Kaplan,,')`);
assert.strictEqual(people.length, 2);
assert.strictEqual(people[0].name, 'Jane Smith');
assert.strictEqual(people[0].phone, '610-555-0100');
assert.strictEqual(people[0].email, 'jane@x.org');
people = run(`parseBulkRegistrantPaste('"Smith, Jane"\\tjane@x.org\\t610 555 0100')`);
assert.strictEqual(people[0].name, 'Jane Smith', 'Last, First is read as a name');
assert.strictEqual(people[0].email, 'jane@x.org', 'an email is recognized in the phone column');
assert.strictEqual(run(`parseBulkRegistrantPaste('Name\\n,\\n')`).length, 0, 'a nameless row is dropped');

// 2. The match.
const out = JSON.parse(run(`(() => {
  const map = getIndexMap(HEADERS.Member_Roll);
  const row = (name, phone, email) => { const r = new Array(HEADERS.Member_Roll.length).fill('');
    r[map['Name']] = name; r[map['Phone']] = phone; r[map['Email']] = email; r[map['Status']] = 'Active'; return r; };
  const roll = [row('Jane Smith', '6105550100', ''), row('Robert Kaplan', '', 'rk@x.org'), row('Mary Lee', '', '')];
  return JSON.stringify(matchBulkRegistrantsToRoll([
    { name: 'jane smith' }, { name: 'Bob Kaplan', email: 'RK@x.org' },
    { name: 'Mark Lee' }, { name: 'Ann Novak' }, { name: 'Bob Jones', phone: '(610) 555-0100' }
  ], roll, map, {}));
})()`));
assert.deepStrictEqual(out.map(p => p.match), ['exact', 'contact', 'similar', 'new', 'contact']);
assert.strictEqual(out[0].suggested, 'Jane Smith', 'exact uses the roll spelling');
assert.strictEqual(out[1].suggested, 'Robert Kaplan', 'a single contact match is pre-selected');
assert.strictEqual(out[2].suggested, 'Mark Lee', 'a similar name is offered, never chosen');
assert.deepStrictEqual(out[2].candidates, ['Mary Lee']);
assert.strictEqual(out[4].suggested, 'Jane Smith', 'phone matched on digits');

// 3. Grouping: two buildings stay two programs; past, lunch and appointment rows are left out.
const programs = JSON.parse(run(`JSON.stringify(groupBulkRegistrantPrograms_([
  { label: 'Yoga · 9/15', title: 'Yoga', dateKey: '2026-09-15', location: 'A' },
  { label: 'Yoga · 9/22', title: 'Yoga', dateKey: '2026-09-22', location: 'A' },
  { label: 'Yoga · 9/15', title: 'Yoga', dateKey: '2026-09-15', location: 'B' },
  { label: 'Yoga · 9/1',  title: 'Yoga', dateKey: '2026-09-01', location: 'A' },
  { label: 'Lunch · 9/15', title: 'Lunch', dateKey: '2026-09-15', location: 'A', lunchOnly: true },
  { label: 'Help · 9/15', title: 'Help', dateKey: '2026-09-15', location: 'A', appointment: {} },
  { label: 'Yoga · 12/1', title: 'Yoga', dateKey: '2026-12-01', location: 'A' }
]))`));
assert.strictEqual(programs.length, 2);
assert.deepStrictEqual(programs[0].sessions.map(s => s.dateKey), ['2026-09-15', '2026-09-22']);

// 4. Which dates.
const p = JSON.stringify(programs[0]);
const keys = rec => JSON.parse(run(`JSON.stringify(bulkRegistrantSessionsFor(${p}, '${rec}', ['2026-09-22', '2027-01-01']))`)).map(s => s.dateKey);
assert.deepStrictEqual(keys('next'), ['2026-09-15']);
assert.deepStrictEqual(keys('club'), ['2026-09-15']);
assert.deepStrictEqual(keys('all'), ['2026-09-15', '2026-09-22']);
assert.deepStrictEqual(keys('picked'), ['2026-09-22'], 'a date the program does not have is ignored');

// 5. Nothing from the workbook is interpolated into the dialog.
assert.ok(!/\$\{/.test(run('buildBulkRegistrantsHtml()')));
console.log('bulk_manual_registrants: all passed');
