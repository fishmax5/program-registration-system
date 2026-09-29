// BULK MANUAL REGISTRANTS (99q) AS A SLICED JOB — a list longer than one
// execution finishes by itself: a slice out of budget records who it did and
// arms exactly one resume trigger, the next slice does the rest, a sync
// holding the workbook is a hand-off rather than a failure, a person re-run
// after a kill is harmless, and Stop keeps who was never reached.
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

// The program and the desk's write, stubbed: each registration costs a minute.
const calls = [];
let heldElsewhere = false;
sandbox.__calls = calls;
run(`
  listBulkRegistrantPrograms = () => [{ key: 'A|Yoga', title: 'Yoga', location: 'A', label: 'Yoga — A',
    sessions: [{ value: 'Yoga · 9/15', dateKey: '2026-09-15', dateLabel: 'Sep 15' },
               { value: 'Yoga · 9/22', dateKey: '2026-09-22', dateLabel: 'Sep 22' }] }];
  flushPersistentRegistries = () => {};
  toastIfPossible = () => {};
  spoolOfficeNote = () => true;
  log = () => {};
`);
sandbox.__advance = ms => { CLOCK += ms; };
sandbox.__held = () => heldElsewhere;
run(`
  workbookHeldElsewhere = () => __held();
  applyQuickMarkLocked = args => {
    __advance(60 * 1000);
    const seen = __calls.some(c => c.name === args.name && c.session === args.session);
    __calls.push({ name: args.name, session: args.session, standing: args.standing });
    return seen
      ? { ok: true, message: '✅ ' + args.name + ' is already registered for Yoga on Sep 15 — nothing to add.' }
      : { ok: true, message: 'registered' };
  };
`);

const names = ['Ann', 'Bob', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus'].map(n => `${n} Test`);
const people = names.map(name => ({ name, recurrence: 'next' }));
people[1].recurrence = 'all';
sandbox.__args = { programKey: 'A|Yoga', picked: [], people };

// 1. The first slice runs to its budget, records who it did, and hands on once.
let st = run('startBulkRegistrants(__args)');
assert.strictEqual(st.ok, true);
assert.strictEqual(st.active, true, 'still running after the first slice');
assert.ok(st.next > 0 && st.next < names.length, `part done after one slice (${st.next})`);
const firstSlice = st.next;
assert.strictEqual(st.lines.length, firstSlice, 'one line per person done');
assert.strictEqual(triggers.filter(t => t.handler === 'resumeBulkRegistrants').length, 1, 'exactly one hand-off');
assert.ok(/2 of 2 date/.test(st.lines[1]), 'Bob got every date');

// 2. A second start while this runs is refused and shows the running one.
const again = run('startBulkRegistrants(__args)');
assert.strictEqual(again.ok, false);
assert.strictEqual(again.next, firstSlice);

// 3. A sync holding the workbook is a hand-off, not progress and not a stall.
heldElsewhere = true;
st = run('(resumeBulkRegistrants(), bulkRegistrantsStatus())');
assert.strictEqual(st.next, firstSlice);
assert.strictEqual(st.active, true);
assert.strictEqual(JSON.parse(store.BULK_REGISTRANTS_JOB_V1).stalledSlices, 0);
heldElsewhere = false;

// 4. The trigger's slice finishes the rest, and the job cleans up after itself.
for (let i = 0; i < 5 && run('bulkRegistrantsStatus()').active; i++) run('resumeBulkRegistrants()');
st = run('bulkRegistrantsStatus()');
assert.strictEqual(st.done, true);
assert.strictEqual(st.problem, '');
assert.strictEqual(st.next, names.length);
assert.strictEqual(st.lines.length, names.length, 'nobody done twice, nobody missed');
assert.deepStrictEqual(Array.from(new Set(calls.map(c => c.name))), names);
assert.strictEqual(triggers.length, 0, 'no trigger left behind');
assert.ok(!('BULK_REGISTRANTS_JOB_V1' in store) && !('BULK_REGISTRANTS_PLAN_V1' in store));

// 5. Dismissed, a fresh list starts; a person re-run after a kill says "already", not "added".
run('dismissBulkRegistrantsResult()');
assert.strictEqual(run('bulkRegistrantsStatus()').exists, false);
sandbox.__args = { programKey: 'A|Yoga', picked: [], people: [{ name: 'Ann Test', recurrence: 'next' }] };
st = run('startBulkRegistrants(__args)');
assert.strictEqual(st.done, true);
assert.ok(/already registered/.test(st.lines[0]), st.lines[0]);
assert.strictEqual(st.written, 0);
run('dismissBulkRegistrantsResult()');

// 6. Stop keeps what was done and names who was not reached.
sandbox.__args = { programKey: 'A|Yoga', picked: [], people: names.map(name => ({ name: name + ' II', recurrence: 'next' })) };
st = run('startBulkRegistrants(__args)');
assert.strictEqual(st.active, true);
st = run('stopBulkRegistrants()');
assert.strictEqual(st.done, true);
assert.strictEqual(st.problem, 'was stopped');
assert.strictEqual(st.remaining.length, names.length - st.next);
assert.strictEqual(triggers.length, 0);

// 7. A job that died with its watchdog is carried on, not re-pasted.
run('dismissBulkRegistrantsResult()');
sandbox.__args = { programKey: 'A|Yoga', picked: [], people: names.map(name => ({ name: name + ' III', recurrence: 'next' })) };
run('startBulkRegistrants(__args)');
triggers.length = 0;
CLOCK += 2 * 60 * 60 * 1000;
st = run('bulkRegistrantsStatus()');
assert.strictEqual(st.stalled, true, 'stale and unfinished is offered Carry on');
for (let i = 0; i < 5 && !run('bulkRegistrantsStatus()').done; i++) {
  run(i === 0 ? 'continueBulkRegistrants()' : 'resumeBulkRegistrants()');
}
st = run('bulkRegistrantsStatus()');
assert.strictEqual(st.done, true);
assert.strictEqual(st.next, names.length);

console.log('bulk_registrants_slices: all passed');
