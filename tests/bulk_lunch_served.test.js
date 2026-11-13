// BULK LUNCH SERVED (99q's "Lunch served" mode) — recording meals that were
// already eaten, from a pasted list, for past dates at one building.
//
// Pins: which dates are offered (past/today, catered, newest first); what the
// start refuses (future dates, dates with no lunch scheduled, nobody counted);
// the "already served" lookup (any live row at the building, never a cancelled
// one, other buildings ignored); the review naming walk-ins and open orders;
// that every write is Quick Mark's own Lunch tick with the bulk source; that a
// person already served is skipped and a re-run writes nothing twice; and that
// the job is the same sliced one the program lists use (budget hand-off, no
// follow-up email list).
const vm = require('vm');
const assert = require('assert');
const { readSource } = require('./helpers/source');

const RealDate = Date;
let CLOCK = new RealDate(2026, 10, 13, 10, 0, 0).getTime(); // Fri 13 Nov 2026
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
    Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'job-lunch-1'
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
const json = code => JSON.parse(run(`JSON.stringify(${code})`));

// ---------------------------------------------------------------------------
// 1. THE DATES OFFERED: today or earlier, catered, newest first, per building.
// ---------------------------------------------------------------------------
{
  const dates = json(`(() => {
    const map = getIndexMap(HEADERS.Lunch_Schedule);
    const mk = (y, m, d, loc, type, shorthand) => {
      const row = new Array(HEADERS.Lunch_Schedule.length).fill('');
      row[map['Event_Date']] = new Date(y, m - 1, d); row[map['Location']] = loc;
      row[map['Type']] = type; row[map['Meal_Shorthand']] = shorthand || '';
      return row;
    };
    const rows = [
      mk(2026, 10, 6, 'Narberth', 'Hot', 'Chx Parm'),
      mk(2026, 9, 29, 'Narberth', 'Cold', ''),
      mk(2026, 10, 7, 'Narberth', 'Not Serving'),   // nothing eaten
      mk(2026, 11, 20, 'Narberth', 'Hot'),          // still to come
      mk(2026, 1, 5, 'Narberth', 'Hot'),            // before the lookback
      mk(2026, 10, 6, 'Ashbridge', 'Hot'),
      mk(2026, 10, 6, 'Narberth', 'Hot', 'dup')      // same date twice
    ];
    return bulkLunchDatesFrom_(rows, map, '2026-11-13', '2026-06-16', () => true);
  })()`);
  assert.deepStrictEqual(dates.map(b => b.location), ['Ashbridge', 'Narberth'], 'a list per building');
  const narb = dates.filter(b => b.location === 'Narberth')[0].dates;
  assert.deepStrictEqual(narb.map(d => d.dateKey), ['2026-10-06', '2026-09-29'], 'newest first; no future, no closed, no old, no repeat');
  assert.strictEqual(narb[0].dish, 'Chx Parm');
  // The catering policy has the last word.
  const none = json(`(() => {
    const map = getIndexMap(HEADERS.Lunch_Schedule);
    const row = new Array(HEADERS.Lunch_Schedule.length).fill('');
    row[map['Event_Date']] = new Date(2026, 9, 6); row[map['Location']] = 'Narberth'; row[map['Type']] = 'Hot';
    return bulkLunchDatesFrom_([row], map, '2026-11-13', '2026-06-16', () => false);
  })()`);
  assert.deepStrictEqual(none, []);
}

// ---------------------------------------------------------------------------
// 2. WHAT THE START REFUSES — the same check the review makes.
// ---------------------------------------------------------------------------
{
  const v = (loc, keys, offered) => json(`validateBulkLunchChoice_(${JSON.stringify(loc)}, ${JSON.stringify(keys)}, '2026-11-13', ${offered || '() => true'})`);
  assert.strictEqual(v('', ['2026-10-06']).ok, false, 'no building');
  assert.strictEqual(v('Narberth', []).ok, false, 'no dates');
  assert.strictEqual(v('Narberth', ['garbage']).ok, false, 'a malformed key is not a date');
  const future = v('Narberth', ['2026-10-06', '2026-11-14']);
  assert.strictEqual(future.ok, false);
  assert.ok(/still to come/.test(future.message) && /2026-11-14/.test(future.message));
  assert.strictEqual(v('Narberth', ['2026-11-13']).ok, true, 'today is allowed');
  const closed = v('Narberth', ['2026-10-06', '2026-10-07'], `(k) => k !== '2026-10-07'`);
  assert.strictEqual(closed.ok, false);
  assert.ok(/No lunch is scheduled/.test(closed.message) && /2026-10-07/.test(closed.message), closed.message);
  const ok = v('Narberth', ['2026-10-07', '2026-10-06', '2026-10-06']);
  assert.deepStrictEqual(ok.dateKeys, ['2026-10-06', '2026-10-07'], 'sorted and de-duplicated');
  // Forty-one distinct, valid, past dates is a different job.
  const many = [];
  for (let i = 0; i < 41; i++) many.push(new RealDate(2026, 0, 1 + i).toISOString().slice(0, 10));
  assert.strictEqual(v('Narberth', many).ok, false, 'too many dates');
  assert.strictEqual(v('Narberth', many.slice(0, 40)).ok, true, 'forty is the ceiling');
}

// ---------------------------------------------------------------------------
// 3. WHO IS ALREADY SERVED: any live row at THIS building on a chosen date.
// ---------------------------------------------------------------------------
const INDEX_ROWS = `(() => {
  const map = getIndexMap(HEADERS.All_Registrants);
  const mk = o => {
    const row = new Array(HEADERS.All_Registrants.length).fill('');
    row[map['Event_Date']] = new Date(o.y || 2026, (o.m || 10) - 1, o.d);
    row[map['Location']] = o.loc || 'Narberth';
    row[map['Name']] = o.name; row[map['Event']] = o.event || 'Lunch @ Narberth';
    row[map['Event_ID']] = o.eid || ('LUNCHONLY:2026-10-' + pad2(o.d) + '|Narberth');
    row[map['Program_Status']] = o.status || 'Active';
    row[map['Lunch_Served']] = !!o.served; row[map['Lunch_Status']] = o.ls || '';
    return row;
  };
  const pad2 = n => String(n).padStart(2, '0');
  return { map, mk };
})()`;
{
  run(`var __ix = ${INDEX_ROWS};`);
  const out = json(`(() => {
    const { map, mk } = __ix;
    const rows = [
      mk({ d: 6, name: 'Ann Served', served: true }),                                       // lunch row, served
      mk({ d: 6, name: 'Bob Program', event: 'Chair Yoga', eid: 'CAL|Chair Yoga|2026-10-06', served: true }), // served on a program row
      mk({ d: 6, name: 'Cal Cancelled', served: true, status: 'Cancelled' }),               // never counts
      mk({ d: 6, name: 'Dee Elsewhere', served: true, loc: 'Ashbridge' }),                  // other building
      mk({ d: 7, name: 'Eve Other Day', served: true }),                                    // date not chosen
      mk({ d: 6, name: 'Fay Ordered', event: 'Chair Yoga', eid: 'CAL|Chair Yoga|2026-10-06', ls: 'Needed' }),  // order open
      mk({ d: 6, name: 'Gus Signedup', ls: 'Needed' })                                       // lunch row, not served
    ];
    const look = buildBulkLunchServedIndex_('Narberth', ['2026-10-06'], rows, map);
    return ['Ann Served', 'Bob Program', 'Cal Cancelled', 'Dee Elsewhere', 'Eve Other Day', 'Fay Ordered', 'Gus Signedup', 'Nobody Known']
      .reduce((acc, n) => { acc[n] = look(n); return acc; }, {});
  })()`);
  const served = n => !!out[n].servedOn['2026-10-06'];
  assert.strictEqual(served('Ann Served'), true);
  assert.strictEqual(served('Bob Program'), true, 'a meal handed over on a program row is still served');
  assert.strictEqual(served('Cal Cancelled'), false, 'a cancelled row is not a registration');
  assert.strictEqual(served('Dee Elsewhere'), false, 'another building is another kitchen');
  assert.strictEqual(served('Eve Other Day'), false);
  assert.strictEqual(out['Ann Served'].lunchRowOn['2026-10-06'], true);
  assert.strictEqual(out['Bob Program'].lunchRowOn['2026-10-06'], undefined, 'a program row is not a lunch row');
  assert.strictEqual(out['Fay Ordered'].orderedOn['2026-10-06'], 'Chair Yoga', 'an open order is named, not settled');
  assert.strictEqual(served('Fay Ordered'), false);
  assert.strictEqual(out['Gus Signedup'].lunchRowOn['2026-10-06'], true, 'an existing lunch sign-up is marked, not duplicated');
  assert.strictEqual(served('Gus Signedup'), false);
  assert.strictEqual(served('Nobody Known'), false);
}

// ---------------------------------------------------------------------------
// 4. THE REVIEW writes nothing and says what each name will be.
// ---------------------------------------------------------------------------
run(`
  log = () => {};
  toastIfPossible = () => {};
  spoolOfficeNote = () => true;
  flushPersistentRegistries = () => {};
  getMealInfoForDate = () => null;
  isLunchOfferedOn = (date, loc) => loc === 'Narberth';
  // The roll: Ann is on it, nobody else is.
  matchBulkPeopleToRoll_ = people => people.map(p => /^Ann/.test(p.name)
    ? Object.assign({}, p, { match: 'exact', candidates: [p.name], suggested: p.name })
    : Object.assign({}, p, { match: 'new', candidates: [], suggested: p.name }));
`);
{
  run(`var __ix2 = ${INDEX_ROWS};`);
  // Built inside the vm: a Date that crossed the boundary would not be one.
  run(`__regRowsHolder = (() => { const { mk } = __ix2; return [mk({ d: 6, name: 'Ann Served', served: true })]; })();`);
  run(`readBulkLunchRegistrantRows_ = () => __regRowsHolder;`);
  const review = json(`previewBulkLunchServed({
    records: [['Ann Served', '610-555-0100'], ['New Person', '']], fields: ['name', 'phone'], hasHeader: false,
    location: 'Narberth', dateKeys: ['2026-10-06'] })`);
  assert.strictEqual(review.ok, true, review.message);
  assert.strictEqual(review.people.length, 2);
  const ann = review.people[0].options[0];
  assert.strictEqual(ann.servedOn['2026-10-06'], true, 'Ann is flagged already served');
  const newbie = review.people[1].options[0];
  assert.deepStrictEqual(newbie.servedOn, {});
  assert.deepStrictEqual(newbie.lunchRowOn, {}, 'no lunch row: the dialog will say walk-in');
  assert.deepStrictEqual(review.dateLabels, ['10/6']);
  assert.strictEqual(review.duplicatesChecked, true);
  // The refusals come back as the review, before any name is looked at.
  assert.strictEqual(json(`previewBulkLunchServed({ records: [['A B']], fields: ['name'], location: 'Narberth', dateKeys: ['2026-11-20'] })`).ok, false);
  assert.strictEqual(json(`previewBulkLunchServed({ records: [['A B']], fields: ['name'], location: 'Ashbridge', dateKeys: ['2026-10-06'] })`).ok, false, 'no lunch at Ashbridge in this fake');
  assert.strictEqual(json(`previewBulkLunchServed({ records: [['A B']], fields: [''], location: 'Narberth', dateKeys: ['2026-10-06'] })`).ok, false, 'no name column');
}

// ---------------------------------------------------------------------------
// 5. THE START AND THE WRITE: Quick Mark's Lunch tick, per person per date.
// ---------------------------------------------------------------------------
const calls = [];
const served = {};            // 'name|dateKey' -> true, as the desk's write would leave the tab
sandbox.__calls = calls;
sandbox.__served = served;
sandbox.__advance = ms => { CLOCK += ms; };
run(`
  workbookHeldElsewhere = () => false;
  // The fresh read under the lock: what the desk's earlier writes left behind.
  buildBulkLunchServedIndex_ = (loc, keys) => name => ({
    nameKey: name.toLowerCase(),
    servedOn: keys.reduce((o, k) => { if (__served[name + '|' + k]) o[k] = true; return o; }, {}),
    lunchRowOn: {}, orderedOn: {}
  });
`);
// The desk's write, stubbed: each lunch costs a minute and leaves the person
// "served" for the next fresh read. The session value ends in the date label,
// which this file's Utilities stub formats as m/d.
run(`
  applyQuickMarkLocked = args => {
    __advance(60 * 1000);
    __calls.push(JSON.parse(JSON.stringify(args)));
    const label = args.session.split(LOCATION_LABEL_SEPARATOR).pop();
    const key = { '10/6': '2026-10-06', '10/7': '2026-10-07' }[label];
    __served[args.name + '|' + key] = true;
    return { ok: true, message: 'ok' };
  };
`);

{
  // Refusals before anything is saved.
  let r = json(`startBulkLunchServed({ location: 'Narberth', dateKeys: ['2026-11-20'], people: [{ name: 'Ann Served', ateHere: 1 }] })`);
  assert.strictEqual(r.ok, false);
  r = json(`startBulkLunchServed({ location: 'Narberth', dateKeys: ['2026-10-06'], people: [{ name: 'Zero Meals', ateHere: 0, tookHome: 0 }] })`);
  assert.strictEqual(r.ok, false);
  assert.ok(/no meal counted/.test(r.message), r.message);
  assert.strictEqual(calls.length, 0, 'a refusal writes nothing');
  assert.ok(!('BULK_REGISTRANTS_PLAN_V1' in store), 'and saves no plan');

  // One person, two dates: the desk's Lunch tick, with the bulk source.
  sandbox.__args = { location: 'Narberth', dateKeys: ['2026-10-07', '2026-10-06', '2026-10-06'], people: [
    { name: 'Ann Served', phone: '610', email: 'a@e.com', ateHere: 2, tookHome: 1 },
    { name: 'ann served', ateHere: 1 },                 // listed twice: one lunch
    { name: 'Take Out', ateHere: 0, tookHome: 2 }
  ] };
  let st = json('startBulkLunchServed(__args)');
  assert.strictEqual(st.ok, true, st.message);
  assert.strictEqual(st.done, true);
  assert.strictEqual(st.total, 2, 'the repeated name is one person');
  assert.strictEqual(st.written, 4, 'two people x two dates');
  assert.strictEqual(st.changedCount, 0, 'nothing here is a registration change to email about');
  assert.ok(/Lunch served — Narberth/.test(st.label));
  assert.strictEqual(calls.length, 4);
  const ann1 = calls[0];
  assert.strictEqual(ann1.lunch, true);
  assert.strictEqual(ann1.attended, true, 'ate here: present');
  assert.strictEqual(ann1.ateHere, 2);
  assert.strictEqual(ann1.tookHome, 1);
  assert.strictEqual(ann1.mealsOrdered, 3);
  assert.strictEqual(ann1.confirmWalkIn, true, 'a new name is added as a walk-in, as the review said');
  assert.strictEqual(ann1.ledgerSource, 'bulk-list');
  assert.strictEqual(ann1.location, 'Narberth');
  assert.ok(/^Lunch @ Narberth · /.test(ann1.session), ann1.session);
  assert.strictEqual(ann1.phone, '610');
  const take = calls.filter(c => c.name === 'Take Out')[0];
  assert.strictEqual(take.attended, false, 'all taken home: the take-out case, not present');
  assert.strictEqual(take.ateHere, 0);
  assert.strictEqual(take.tookHome, 2);
  assert.ok(/lunch served on 10\/6, 10\/7/.test(st.lines[0]), st.lines[0]);
  assert.ok(/added as a walk-in/.test(st.lines[0]), 'the line says a walk-in row was made');
  assert.strictEqual(triggers.length, 0);
  run('dismissBulkRegistrantsResult()');

  // IDEMPOTENT: the same list again writes nothing and says why.
  calls.length = 0;
  sandbox.__args = { location: 'Narberth', dateKeys: ['2026-10-06', '2026-10-07'], people: [{ name: 'Ann Served', ateHere: 1 }] };
  st = json('startBulkLunchServed(__args)');
  assert.strictEqual(st.written, 0);
  assert.strictEqual(calls.length, 0, 'no write for a person already served');
  assert.ok(/already marked served on every date/.test(st.lines[0]), st.lines[0]);
  run('dismissBulkRegistrantsResult()');

  // A MIX: one date already served, one new — only the new one is written.
  calls.length = 0;
  served['Mix Person|2026-10-06'] = true;   // served on the 6th already; the 7th is new
  sandbox.__args = { location: 'Narberth', dateKeys: ['2026-10-06', '2026-10-07'], people: [{ name: 'Mix Person', ateHere: 1 }] };
  st = json('startBulkLunchServed(__args)');
  assert.strictEqual(st.written, 1);
  assert.strictEqual(calls.length, 1);
  assert.ok(/Already marked served on 10\/6/.test(st.lines[0]), st.lines[0]);
  run('dismissBulkRegistrantsResult()');
}

// ---------------------------------------------------------------------------
// 6. THE SAME SLICED JOB: a budget hand-off, a stop, and a date that has
//    become a future one by the time the slice runs.
// ---------------------------------------------------------------------------
{
  calls.length = 0;
  const people = ['Ann', 'Bob', 'Cal', 'Dee', 'Eve', 'Fay'].map(n => ({ name: `${n} Slice`, ateHere: 1 }));
  sandbox.__args = { location: 'Narberth', dateKeys: ['2026-10-06', '2026-10-07'], people };
  let st = json('startBulkLunchServed(__args)');
  assert.strictEqual(st.active, true, 'two minutes a person against a four minute budget: not one slice');
  assert.ok(st.next > 0 && st.next < people.length, `part done (${st.next})`);
  assert.strictEqual(triggers.filter(t => t.handler === 'resumeBulkRegistrants').length, 1, 'exactly one hand-off');
  // A second start while it runs is refused.
  const again = json('startBulkLunchServed(__args)');
  assert.strictEqual(again.ok, false);
  for (let i = 0; i < 6 && json('bulkRegistrantsStatus()').active; i++) run('resumeBulkRegistrants()');
  st = json('bulkRegistrantsStatus()');
  assert.strictEqual(st.done, true);
  assert.strictEqual(st.problem, '');
  assert.strictEqual(st.lines.length, people.length, 'nobody twice, nobody missed');
  assert.strictEqual(new Set(calls.map(c => c.name)).size, people.length);
  assert.strictEqual(calls.length, people.length * 2);
  assert.strictEqual(triggers.length, 0);
  assert.ok(!('BULK_REGISTRANTS_JOB_V1' in store));
  run('dismissBulkRegistrantsResult()');

  // Stop keeps who was done and names who was not reached.
  calls.length = 0;
  sandbox.__args = { location: 'Narberth', dateKeys: ['2026-10-06', '2026-10-07'],
    people: people.map(p => ({ name: p.name + ' II', ateHere: 1 })) };
  json('startBulkLunchServed(__args)');
  st = json('stopBulkRegistrants()');
  assert.strictEqual(st.done, true);
  assert.strictEqual(st.problem, 'was stopped');
  assert.strictEqual(st.remaining.length, people.length - st.next);
  run('dismissBulkRegistrantsResult()');

  // Resumed after midnight: a date that is now in the future is not marked.
  calls.length = 0;
  // The slice's own re-check, exercised directly: the plan said 14 Nov, the
  // clock still says the 13th.
  run(`__late = serveOneBulkLunchPerson_({ location: 'Narberth', dateKeys: ['2026-11-14'] }, { name: 'Late Person', ateHere: 1 })`);
  const late = json('__late');
  assert.strictEqual(late.written, 0);
  assert.ok(/nothing was written/.test(late.line));
  assert.strictEqual(calls.length, 0);
}

// ---------------------------------------------------------------------------
// 7. THE DIALOG carries the mode and nothing from the workbook as markup.
// ---------------------------------------------------------------------------
{
  const html = run('buildBulkRegistrantsHtml()');
  assert.ok(/name="mode" value="lunch"/.test(html), 'the mode switch is on the page');
  assert.ok(/startBulkLunchServed/.test(html) && /previewBulkLunchServed/.test(html) && /listBulkLunchChoices/.test(html));
  assert.ok(/ADDED AS A WALK-IN/.test(html), 'the review says out loud that a walk-in will be created');
  assert.ok(!/<script>[^]*Narberth/.test(html), 'no building is baked into the page');
}

console.log('bulk_lunch_served: all passed');
