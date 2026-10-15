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
    __calls.push({ name: args.name, session: args.session, standing: args.standing,
      attended: !!args.attended });
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

// ---------------------------------------------------------------------------
// 8. THE ATTENDED TICK SURVIVES A HAND-OFF, AND ONLY EVER REACHES TODAY.
//
//    Attendance is a fact about a day (99q's banner), so a person put on both
//    of a program's dates is marked on the one that has happened and not on
//    the one that has not — and the flag has to be on the SAVED PLAN, because
//    the slice that writes a given person is routinely not the slice the
//    button started.
// ---------------------------------------------------------------------------
run('dismissBulkRegistrantsResult()');
calls.length = 0;
{
  const todayKey = run('formatDateKey(new Date())');
  const d = new RealDate(CLOCK);
  const later = new RealDate(d.getFullYear(), d.getMonth(), d.getDate() + 13);
  const futureKey = `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}`;
  sandbox.__sessions = [
    { value: 'Yoga · today', dateKey: todayKey, dateLabel: 'today' },
    { value: 'Yoga · later', dateKey: futureKey, dateLabel: 'later' }
  ];
  run(`
    listBulkRegistrantPrograms = () => [{ key: 'A|Yoga', title: 'Yoga', location: 'A', label: 'Yoga — A',
      todayKey: '${todayKey}', sessions: __sessions }];
  `);

  // Four people on BOTH dates — two minutes of work each against a four
  // minute budget, so the list cannot be finished in one slice.
  const att = ['Ivy', 'Jon', 'Kay', 'Lee'].map((n, i) => ({
    name: `${n} Attend`, recurrence: 'all', attended: i !== 2
  }));
  sandbox.__args = { programKey: 'A|Yoga', picked: [], people: att };
  let s = run('startBulkRegistrants(__args)');
  assert.strictEqual(s.active, true, 'the list is longer than one slice');
  assert.ok(s.next > 0 && s.next < att.length, `part done after one slice (${s.next})`);

  // THE FLAG IS IN THE STORED PLAN, read back out of Script Properties — not
  // held in the execution that started the job.
  const plan = JSON.parse(run('JSON.stringify(readBulkRegistrantsPlan_())'));
  assert.deepStrictEqual(plan.people.map(p => [p.name, !!p.attended]),
    att.map(p => [p.name, p.attended]), 'every person\'s own answer survived into the plan');
  assert.ok('BULK_REGISTRANTS_PLAN_V1' in store, 'the key is not versioned up — see startBulkRegistrants');

  // The resumed slices finish the rest.
  for (let i = 0; i < 6 && run('bulkRegistrantsStatus()').active; i++) run('resumeBulkRegistrants()');
  s = run('bulkRegistrantsStatus()');
  assert.strictEqual(s.done, true);
  assert.strictEqual(s.problem, '');
  assert.strictEqual(s.next, att.length);

  // THE MARK REACHED THE DESK'S OWN WRITER — for today, and for nobody's
  // future date.
  const marked = calls.filter(c => c.attended).map(c => `${c.name}|${c.session}`).sort();
  assert.deepStrictEqual(marked, ['Ivy Attend|Yoga · today', 'Jon Attend|Yoga · today', 'Lee Attend|Yoga · today'],
    'attended reached applyQuickMarkLocked on today only, and only for the people ticked');
  assert.strictEqual(calls.filter(c => c.session === 'Yoga · later').length, att.length,
    'everybody was still REGISTERED for the future date');
  assert.strictEqual(calls.filter(c => c.session === 'Yoga · later' && c.attended).length, 0,
    'and nobody was marked attended on a class that has not happened');
  assert.strictEqual(calls.filter(c => c.name === 'Kay Attend' && c.attended).length, 0,
    'a person left unticked is registered and not marked');

  // And the lines say which date it was, rather than "marked attended" beside
  // a person put on two.
  const line = n => s.lines.filter(l => l.indexOf(n) !== -1)[0] || '';
  assert.ok(/Marked attended on today\./.test(line('Ivy Attend')), line('Ivy Attend'));
  assert.ok(!/later/.test(line('Ivy Attend')), 'the future date is never named as attended');
  assert.ok(!/attended/i.test(line('Kay Attend')), line('Kay Attend'));

  // BULK_REGISTRANTS_PLAN_V1 KEEPS ITS KEY, and this is what earns that: a
  // plan saved by the code before this field existed — one whose people carry
  // no `attended` key at all — is picked up mid-flight and finished without
  // marking anybody, which is exactly what it always meant. Taken all the way
  // through the stored property rather than asserted about a literal.
  run('dismissBulkRegistrantsResult()');
  calls.length = 0;
  sandbox.__sessions = [
    { value: 'Yoga · today', dateKey: todayKey, dateLabel: 'today' },
    { value: 'Yoga · later', dateKey: futureKey, dateLabel: 'later' }
  ];
  sandbox.__args = { programKey: 'A|Yoga', picked: [],
    people: ['Nan', 'Ora', 'Pat', 'Quy'].map(n => ({ name: `${n} Old`, recurrence: 'all', attended: true })) };
  s = run('startBulkRegistrants(__args)');
  assert.strictEqual(s.active, true, 'still going, so there is a plan left to rewrite');
  {
    // The stored plan, in the old shape, under the live job's own id.
    const live = JSON.parse(run('JSON.stringify(readBulkRegistrantsPlan_())'));
    live.people.forEach(p => { delete p.attended; });
    sandbox.__old = live;
    assert.strictEqual(run(`writeChunkedScriptProperty(BULK_REGISTRANTS_PLAN_PROP_KEY,
      JSON.stringify(__old), BULK_REGISTRANTS_CHUNK_CHARS, BULK_REGISTRANTS_MAX_CHUNKS)`), true);
  }
  const doneBefore = s.next;
  calls.length = 0;
  for (let i = 0; i < 6 && run('bulkRegistrantsStatus()').active; i++) run('resumeBulkRegistrants()');
  s = run('bulkRegistrantsStatus()');
  assert.strictEqual(s.done, true);
  assert.strictEqual(s.next, 4, 'the old-shape plan was finished, not abandoned');
  assert.ok(doneBefore < 4);
  assert.strictEqual(calls.filter(c => c.attended).length, 0,
    'a plan with no attended field marks nobody — the old meaning, unchanged');
  assert.ok(calls.length > 0, 'and everybody left was still registered');

  // A list whose every date is still to come says so rather than claiming an
  // attendance nobody got.
  run('dismissBulkRegistrantsResult()');
  calls.length = 0;
  sandbox.__sessions = [{ value: 'Yoga · later', dateKey: futureKey, dateLabel: 'later' }];
  sandbox.__args = { programKey: 'A|Yoga', picked: [], people: [{ name: 'Mae Future', recurrence: 'all', attended: true }] };
  s = run('startBulkRegistrants(__args)');
  assert.strictEqual(s.done, true);
  assert.strictEqual(calls.filter(c => c.attended).length, 0, 'nothing in the future is marked');
  assert.ok(/still to come/.test(s.lines[0]), s.lines[0]);
  run('dismissBulkRegistrantsResult()');
}

console.log('bulk attended slices: ok');

// ---------------------------------------------------------------------------
// THE OTHER FIVE ACTIONS, through the one dispatcher the slice calls.
//
// Register and Attended are the path they always were; the rest take one lock
// around the one writer each needs, and every one of them answers { busy } the
// same way, so the slice's hand-off reads one answer whatever the list is for.
// ---------------------------------------------------------------------------
{
  run('dismissBulkRegistrantsResult()');
  calls.length = 0;
  sandbox.__sessions = [{ value: 'Yoga · 9/15', dateKey: '2026-09-15', dateLabel: 'Sep 15' },
                        { value: 'Yoga · 9/22', dateKey: '2026-09-22', dateLabel: 'Sep 22' }];
  const routed = [];
  sandbox.__routed = routed;
  // The three writers stubbed at their own front doors, so what is pinned here
  // is the ROUTING and the plan — each writer's own behaviour is 71's and 99a's.
  run(`
    cancelOneBulkPerson_ = (program, sessions, person) => {
      __routed.push(['cancel', person.name, sessions.length, person.reason]);
      return { line: 'cancelled ' + person.name, written: sessions.length };
    };
    restatusOneBulkPerson_ = (program, sessions, person, toWaitlist) => {
      __routed.push([toWaitlist ? 'waitlist' : 'reactivate', person.name, sessions.length, person.reason]);
      return { line: 'restatused ' + person.name, written: 1 };
    };
    contactOneBulkPerson_ = (program, sessions, person) => {
      __routed.push(['contact', person.name, sessions.length, person.reason]);
      return { line: 'contacted ' + person.name, written: 1 };
    };
  `);

  sandbox.__args = { programKey: 'A|Yoga', picked: ['2026-09-22'], people: [
    { name: 'Can Cel', recurrence: 'all', action: 'cancel', reason: 'term ended' },
    { name: 'Way Ting', recurrence: 'picked', action: 'waitlist' },
    { name: 'Put Back', recurrence: 'next', action: 'reactivate' },
    { name: 'New Phone', recurrence: 'next', action: 'contact' },
    { name: 'Reg Ular', recurrence: 'next', action: 'register' },
    { name: 'Came Today', recurrence: 'next', action: 'attended' },
    { name: 'Non Sense', recurrence: 'next', action: 'burn it all down' }
  ] };
  let s = run('startBulkRegistrants(__args)');
  for (let i = 0; i < 8 && run('bulkRegistrantsStatus()').active; i++) run('resumeBulkRegistrants()');
  s = run('bulkRegistrantsStatus()');
  assert.strictEqual(s.done, true);
  assert.strictEqual(s.problem, '');
  assert.strictEqual(s.next, 7, 'every person reached');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(routed)), [
    ['cancel', 'Can Cel', 2, 'term ended'],
    ['waitlist', 'Way Ting', 1, ''],
    ['reactivate', 'Put Back', 1, ''],
    ['contact', 'New Phone', 1, '']
  ], 'each action to its own writer, with the dates its row asked for');

  // The two register-ish actions went to the desk's own Register instead. The
  // Attended one asked for the tick and got none, because the only date it was
  // given is still to come — the rule the slice applies on the day it writes.
  assert.deepStrictEqual(calls.map(c => [c.name, c.attended]),
    [['Reg Ular', false], ['Came Today', false], ['Non Sense', false]],
    'an action outside the vocabulary falls back to Register rather than being guessed at');

  // The plan stores what was chosen and nothing it was not given.
  run('dismissBulkRegistrantsResult()');
  sandbox.__args = { programKey: 'A|Yoga', picked: [], people: [{ name: 'Can Cel', recurrence: 'next', action: 'cancel' }] };
  run('startBulkRegistrants(__args)');
  const plan = JSON.parse(run('JSON.stringify(readBulkRegistrantsPlan_())') || 'null');
  if (plan) {
    assert.strictEqual(plan.people[0].action, 'cancel');
    assert.strictEqual(plan.people[0].reason, '');
  }
  run('stopBulkRegistrants()');
  run('dismissBulkRegistrantsResult()');
}

// And the lock: a writer that could not have the workbook is a hand-off, never
// a line claiming a cancellation that did not happen.
{
  sandbox.__sessions = [{ value: 'Yoga · 9/15', dateKey: '2026-09-15', dateLabel: 'Sep 15' }];
  const busy = JSON.parse(run(`(() => {
    const was = withScriptLock;
    withScriptLock = (wait, fn, fallback) => fallback;
    try {
      return JSON.stringify(applyOneBulkPersonAction_(
        { title: 'Yoga', location: 'A', sessions: __sessions }, [],
        { name: 'Can Cel', recurrence: 'next', action: 'cancel' }));
    } finally { withScriptLock = was; }
  })()`));
  assert.deepStrictEqual(busy, { busy: true }, 'a busy workbook is answered the way Register answers it');
}

console.log('bulk update actions slices: ok');
