// PUTTING TRIAGED PEOPLE ON THEIR NEW PROGRAM (99zzd_triage_to_program.gs).
// The pure halves (which triaged programs are listed, what is suggested, what a
// plan moves, clears and leaves) and the press itself with the tabs, the
// ledger and the tombstones stubbed: what lands on All_Registrants, what comes
// off triage, which ledger entries are written, and that a stale preview
// writes nothing.
const vm = require('vm');
const assert = require('assert');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    },
    computeDigest: (algo, raw) => Array.from(require('crypto').createHash('md5').update(String(raw)).digest()),
    DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {}, Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'u'
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {},
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const run = code => vm.runInContext(code, sandbox);

// Fixtures, built inside the context so Dates are the context's own.
run(`
  var TODAY = '2099-01-01';
  var T = HEADERS.Deleted_Event_Triage, tMap = getIndexMap(T);
  var S = HEADERS.All_Program_Sessions, sMap = getIndexMap(S);
  var R = HEADERS.All_Registrants, rMap = getIndexMap(R);
  function mk(H, m, o) { var r = new Array(H.length).fill(''); Object.keys(o).forEach(function (k) { r[m[k]] = o[k]; }); return r; }
  function d(k) { return parseDateKey(k); }
  function tri(o) {
    return mk(T, tMap, Object.assign({ Deleted_Event_Title: 'Chair Yoga', Deleted_Event_Location: 'Narberth',
      Event: 'Chair Yoga', Location: 'Narberth', Person_Type: 'Registrant', Program_Status: 'Active',
      Event_Time: '10:00 AM' }, o));
  }
  function sess(o) { return mk(S, sMap, Object.assign({ Location: 'Ashbridge', Event_Time: '10:30 AM' }, o)); }
  function reg(o) { return mk(R, rMap, Object.assign({ Person_Type: 'Registrant', Program_Status: 'Active' }, o)); }
  var PALM = 'Chair Yoga - offsite - at The PALM';
  var FROM = { title: 'Chair Yoga', location: 'Narberth' };
  var TO = { title: PALM, location: 'Ashbridge' };
  function fixtures() {
    return {
      triageRows: [
        tri({ Name: 'Ann Lee', Event_Date: d('2099-01-06'), Event_ID: 'OLD6', Lunch_Type: 'Chicken', Lunch_Status: 'Ordered', Meals_Ordered: 1 }),
        tri({ Name: 'Ann Lee', Event_Date: d('2099-01-13'), Event_ID: 'OLD13' }),
        tri({ Name: 'Ann Lee', Event_Date: d('2099-01-20'), Event_ID: 'OLD20' }),   // no session that day
        tri({ Name: 'Bob Ray', Event_Date: d('2099-01-06'), Event_ID: 'OLD6' }),    // already there
        tri({ Name: 'Cy Tan', Event_Date: d('2099-01-06'), Event_ID: 'OLD6' }),     // cancelled there
        tri({ Name: 'Dee Fox', Event_Date: d('2099-01-13'), Event_ID: 'OLD13', Program_Status: 'Waitlisted' }),
        tri({ Name: 'Ann Lee', Event_Date: d('2020-01-07'), Event_ID: 'OLDPAST' }), // past (the press reads the real today)
        tri({ Name: 'Eve Ng', Event_Date: d('2099-01-06'), Event_ID: 'OLD6', Program_Status: 'Cancelled' }),
        tri({ Name: 'Zed Oz', Event_Date: d('2099-01-06'), Event_ID: 'OTHER', Deleted_Event_Title: 'Bingo' })
      ],
      sessionRows: [
        sess({ Clean_Title: PALM, Event_Date: d('2099-01-06'), Event_ID: 'NEW6', Max_Capacity: 1 }),
        sess({ Clean_Title: PALM, Event_Date: d('2099-01-13'), Event_ID: 'NEW13' }),
        sess({ Clean_Title: 'Mat Yoga', Event_Date: d('2099-01-06'), Event_ID: 'MAT6' }),
        sess({ Clean_Title: 'Chess', Event_Date: d('2099-01-06'), Event_ID: 'CH6' })
      ],
      registrantRows: [
        reg({ Name: 'Bob Ray', Event_ID: 'NEW6', Event: PALM, Location: 'Ashbridge', Event_Date: d('2099-01-06') }),
        reg({ Name: 'Cy Tan', Event_ID: 'NEW6', Event: PALM, Location: 'Ashbridge', Event_Date: d('2099-01-06'), Program_Status: 'Cancelled' })
      ],
      tMap: tMap, sMap: sMap, rMap: rMap
    };
  }
`);

// --- the lists ---------------------------------------------------------------
const sources = JSON.parse(run(`JSON.stringify(listTriageMoveSources_(fixtures().triageRows, tMap, TODAY))`));
assert.deepStrictEqual(sources.map(s => s.title), ['Chair Yoga', 'Bingo'], 'most seats first; one entry per program and building');
assert.strictEqual(sources[0].seats, 6, 'only future seats that still hold a place count (past and cancelled left out)');
assert.strictEqual(sources[0].people, 4);
assert.deepStrictEqual(sources[0].dateKeys, ['2099-01-06', '2099-01-13', '2099-01-20']);

const suggestions = JSON.parse(run(`(function () {
  var f = fixtures();
  var dests = listTriageMoveDestinations_(f.sessionRows, sMap, TODAY);
  var s = listTriageMoveSources_(f.triageRows, tMap, TODAY)[0];
  return JSON.stringify(suggestTriageMoveDestinations_(s, dests));
})()`));
assert.strictEqual(suggestions[0].title, 'Chair Yoga - offsite - at The PALM', 'the program sharing the most title and dates comes first');
assert.strictEqual(suggestions[0].covered, 2);
assert.strictEqual(suggestions[0].of, 3);
assert.ok(suggestions.some(s => s.title === 'Mat Yoga'), 'a shared word on a shared date is offered');
assert.ok(!suggestions.some(s => s.title === 'Chess'), 'a program sharing no word is not suggested');
const noise = JSON.parse(run(`JSON.stringify(suggestTriageMoveDestinations_(
  { title: 'Walking Club', dateKeys: ['2099-01-06'] },
  [{ title: 'Art in Nature Club', location: 'Ashbridge', dateKeys: ['2099-01-06'] },
   { title: 'Walking Club', location: 'Ashbridge', dateKeys: ['2099-01-06'] }]))`));
assert.deepStrictEqual(noise.map(s => s.title), ['Walking Club'], '"club" alone is no reason to suggest a program');

// --- the plan ----------------------------------------------------------------
const plan = JSON.parse(run(`(function () {
  var f = fixtures();
  var p = planTriageMove_(Object.assign({ from: FROM, to: TO, todayKey: TODAY }, f));
  var who = function (list) { return list.map(function (x) { return x.triageRow[tMap['Name']] + '@' + x.dateKey; }); };
  return JSON.stringify({
    moves: p.moves.map(function (m) { return m.triageRow[tMap['Name']] + '@' + m.session[sMap['Event_ID']]; }),
    alreadyThere: who(p.alreadyThere), cancelledThere: who(p.cancelledThere),
    noSession: who(p.noSession), ambiguous: who(p.ambiguous), overCapacity: p.overCapacity,
    text: describeTriageMovePlan_(p, tMap, sMap)
  });
})()`));
assert.deepStrictEqual(plan.moves, ['Ann Lee@NEW6', 'Ann Lee@NEW13', 'Dee Fox@NEW13'], 'each seat onto the session on the same day');
assert.deepStrictEqual(plan.alreadyThere, ['Bob Ray@2099-01-06'], 'somebody already on the session is not added twice');
assert.deepStrictEqual(plan.cancelledThere, ['Cy Tan@2099-01-06'], 'somebody who cancelled there stays for the office');
assert.deepStrictEqual(plan.noSession, ['Ann Lee@2099-01-20'], 'a date with no session stays on triage');
assert.deepStrictEqual(plan.ambiguous, []);
assert.strictEqual(plan.overCapacity.length, 1, 'Jan 6 has one seat and Bob holds it: Ann puts it over');
assert.strictEqual(plan.overCapacity[0].eventId, 'NEW6');
assert.strictEqual(plan.overCapacity[0].active, 1);
assert.strictEqual(plan.overCapacity[0].adding, 1);
assert.strictEqual(plan.text.move, 3);
assert.strictEqual(plan.text.alreadyThere, 1);
assert.strictEqual(plan.text.stay, 2);
assert.deepStrictEqual(plan.text.moves.map(m => m.names), [['Ann Lee'], ['Ann Lee', 'Dee Fox (waitlisted)']]);
assert.strictEqual(plan.text.moves[0].time, '10:30 AM', 'the destination session time is shown');

// Room left is no warning; exactly full after the move is none either; over is.
const capacity = JSON.parse(run(`(function () {
  var f = fixtures();
  f.sessionRows[0][sMap['Max_Capacity']] = 2;
  var roomy = planTriageMove_(Object.assign({ from: FROM, to: TO, todayKey: TODAY }, f)).overCapacity.length;
  f.sessionRows[0][sMap['Max_Capacity']] = 1;
  var tight = planTriageMove_(Object.assign({ from: FROM, to: TO, todayKey: TODAY }, f)).overCapacity;
  return JSON.stringify({ roomy: roomy, tight: tight.length, text: describeTriageMovePlan_({ moves: [], alreadyThere: [],
    cancelledThere: [], noSession: [], ambiguous: [], overCapacity: tight }, tMap, sMap).overCapacity[0] });
})()`));
assert.strictEqual(capacity.roomy, 0, 'exactly full after the move: no warning');
assert.strictEqual(capacity.tight, 1);
assert.ok(/1 of 1 seats taken; adding 1 puts it 1 over/.test(capacity.text), capacity.text);

// Two sessions on one day: the time decides, and when it cannot the seat stays.
const twoADay = JSON.parse(run(`(function () {
  var f = fixtures();
  f.sessionRows.push(sess({ Clean_Title: PALM, Event_Date: d('2099-01-13'), Event_ID: 'NEW13B', Event_Time: '10:00 AM' }));
  var timed = planTriageMove_(Object.assign({ from: FROM, to: TO, todayKey: TODAY }, f));
  f.sessionRows[f.sessionRows.length - 1][sMap['Event_Time']] = '2:00 PM';
  var untimed = planTriageMove_(Object.assign({ from: FROM, to: TO, todayKey: TODAY }, f));
  return JSON.stringify({
    timed: timed.moves.filter(function (m) { return m.dateKey === '2099-01-13'; }).map(function (m) { return m.session[sMap['Event_ID']]; }),
    ambiguous: untimed.ambiguous.length
  });
})()`));
assert.deepStrictEqual(twoADay.timed, ['NEW13B', 'NEW13B'], 'the session at the triaged time is the one');
assert.strictEqual(twoADay.ambiguous, 2, 'neither time matches: both seats that day stay');

// A second triaged copy of one person on one date is "already there" behind the first.
const dupes = JSON.parse(run(`(function () {
  var f = fixtures();
  f.triageRows.push(tri({ Name: 'ann  lee', Event_Date: d('2099-01-13'), Event_ID: 'OLD13' }));
  var p = planTriageMove_(Object.assign({ from: FROM, to: TO, todayKey: TODAY }, f));
  return JSON.stringify({ moves: p.moves.length, already: p.alreadyThere.length });
})()`));
assert.deepStrictEqual(dupes, { moves: 3, already: 2 });

// --- the press ---------------------------------------------------------------
run(`
  var W = { regRendered: null, triRendered: null, ledger: [], tomb: [], cleared: [], flushed: 0, counts: 0 };
  var FIX = null;
  readTriageMoveTabs_ = function () { return Object.assign({ ss: {} }, FIX); };
  getOrCreateSheet = function () { return {}; };
  renderRegistrantsSheet = function (force, rows) { W.regRendered = rows; };
  renderTriageSheet = function (force, rows) { W.triRendered = rows; };
  refreshCountsAfterRegistrantChange = function () { W.counts++; return ''; };
  invalidateQuickMarkIndexCache = function () {};
  flushLedger = function () { W.flushed++; return 0; };
  appendLedgerEntry = function (e) { W.ledger.push(e); return 1; };
  ledgerIdForRegistrantRow = function (row, map) { return 'R-' + row[map['Name']] + '-' + row[map['Event_ID']]; };
  recordRegistrantTombstones = function (rows, map) { rows.forEach(function (r) { W.tomb.push(r[map['Event_ID']]); }); };
  clearRegistrantTombstones = function (keys) { W.cleared = W.cleared.concat(keys); };
  isLunchOfferedOn = function () { return false; };
  log = function () {}; toastIfPossible = function () {};
  currentLedgerActor_ = function () { return ''; };
`);

const stale = run(`(function () {
  FIX = fixtures();
  return moveTriagedToProgramLocked_(FROM, TO, { move: 2, alreadyThere: 1 });
})()`);
assert.ok(/^⚠️ The tabs changed since the preview/.test(stale), stale);
assert.strictEqual(run('W.regRendered'), null, 'a stale preview writes nothing');
assert.strictEqual(run('W.triRendered'), null);
assert.strictEqual(run('W.ledger.length'), 0);

const pressed = JSON.parse(run(`(function () {
  FIX = fixtures();
  var msg = moveTriagedToProgramLocked_(FROM, TO, { move: 3, alreadyThere: 1 });
  var added = W.regRendered.slice(2);
  return JSON.stringify({
    msg: msg,
    regCount: W.regRendered.length,
    added: added.map(function (r) { return {
      name: r[rMap['Name']], id: r[rMap['Event_ID']], event: r[rMap['Event']], location: r[rMap['Location']],
      time: r[rMap['Event_Time']], date: formatDateKey(r[rMap['Event_Date']]), status: r[rMap['Program_Status']],
      lunch: r[rMap['Lunch_Type']], meals: r[rMap['Meals_Ordered']], override: r[rMap['Manual_Override']],
      note: r[rMap['Admin_Notes']] }; }),
    triLeft: W.triRendered.map(function (r) { return r[tMap['Name']] + '@' + formatDateKey(r[tMap['Event_Date']]); }),
    ledger: W.ledger.map(function (e) { return { kind: e.kind, source: e.source, id: e.registrationId, eventId: e.eventId, from: e.payload.from }; }),
    tomb: W.tomb, cleared: W.cleared, flushed: W.flushed, counts: W.counts
  });
})()`));
assert.strictEqual(pressed.regCount, 5, 'three rows added to the two already there');
assert.deepStrictEqual(pressed.added.map(a => `${a.name}@${a.id}`), ['Ann Lee@NEW6', 'Ann Lee@NEW13', 'Dee Fox@NEW13']);
const ann6 = pressed.added[0];
assert.strictEqual(ann6.event, 'Chair Yoga - offsite - at The PALM', 'takes the destination title');
assert.strictEqual(ann6.location, 'Ashbridge');
assert.strictEqual(ann6.time, '10:30 AM', 'takes the destination time');
assert.strictEqual(ann6.date, '2099-01-06', 'the day does not change');
assert.strictEqual(ann6.lunch, 'No Lunch', 'no lunch there that day: the meal is dropped');
assert.strictEqual(Number(ann6.meals), 0);
assert.strictEqual(ann6.override, 'Manually Edited');
assert.ok(/Put back from Deleted_Event_Triage: Chair Yoga \(Narberth\) is now Chair Yoga - offsite - at The PALM \(Ashbridge\)/.test(ann6.note), ann6.note);
assert.strictEqual(pressed.added[2].status, 'Waitlisted', 'a waitlisted seat moves as waitlisted');
assert.deepStrictEqual(pressed.triLeft.sort(), [
  'Ann Lee@2020-01-07', 'Ann Lee@2099-01-20', 'Cy Tan@2099-01-06', 'Eve Ng@2099-01-06', 'Zed Oz@2099-01-06'
].sort(), 'moved and already-there rows come off triage; everything else stays');
assert.deepStrictEqual(pressed.ledger.filter(e => e.kind === 'moved').map(e => `${e.id}>${e.eventId}`), [
  'R-Ann Lee-OLD6>NEW6', 'R-Ann Lee-OLD13>NEW13', 'R-Dee Fox-OLD13>NEW13'
], 'the id is resolved through the OLD session, before the rewrite');
assert.ok(pressed.ledger.every(e => e.source === 'triage-move'));
assert.deepStrictEqual(pressed.ledger.filter(e => e.kind === 'moved').map(e => e.from), ['OLD6', 'OLD13', 'OLD13']);
assert.deepStrictEqual(pressed.ledger.filter(e => e.kind === 'removed').map(e => e.id), ['R-Bob Ray-OLD6'],
  'the triaged copy of somebody already there is ended in the ledger, so the alarm does not report it missing');
assert.deepStrictEqual(pressed.tomb, ['OLD6', 'OLD13', 'OLD13'], 'the old keys are tombstoned');
assert.strictEqual(pressed.cleared.length, 3, 'the destination keys are lifted');
assert.strictEqual(pressed.flushed, 1);
assert.strictEqual(pressed.counts, 1);
assert.ok(/^✅ 3 seat\(s\) moved from Chair Yoga \(Narberth\) onto Chair Yoga - offsite - at The PALM \(Ashbridge\); 1 already there, taken off triage\./.test(pressed.msg), pressed.msg);
assert.ok(/2 stay on triage/.test(pressed.msg), pressed.msg);
assert.ok(/1 session\(s\) are now over capacity/.test(pressed.msg));

// The same session coming back (its old Event_ID live again): nothing to tombstone.
const sameSession = JSON.parse(run(`(function () {
  W.tomb = []; W.ledger = [];
  FIX = fixtures();
  FIX.triageRows = [tri({ Name: 'Gil Po', Deleted_Event_Title: PALM, Deleted_Event_Location: 'Ashbridge',
    Event_Date: d('2099-01-13'), Event_ID: 'NEW13' })];
  var msg = moveTriagedToProgramLocked_({ title: PALM, location: 'Ashbridge' }, TO, { move: 1, alreadyThere: 0 });
  return JSON.stringify({ msg: msg, tomb: W.tomb, moved: W.ledger.map(function (e) { return e.payload.from + '>' + e.eventId; }) });
})()`));
assert.deepStrictEqual(sameSession.tomb, [], 'a seat going back onto its own session tombstones nothing');
assert.deepStrictEqual(sameSession.moved, ['NEW13>NEW13']);

// Every source the press writes is one the ledger accepts.
assert.strictEqual(run(`LEDGER_ENTRY_SOURCES.indexOf(LEDGER_SOURCES.TRIAGE_MOVE) !== -1`), true);

console.log('triage to program: ok');
