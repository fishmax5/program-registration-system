// A RUN THAT DIES OUTRIGHT SAYS WHERE, AND DOES NOT DIE THERE FOR EVER.
//
// 2026-09-30 11:39: the hourly sync ended in Apps Script's "JavaScript engine
// reported an unexpected error. Error code INTERNAL." — an abort no catch in
// the project saw — eight and a half silent minutes after the memory tabs.
// Nothing said which tail step, or which registrant sheet, it was on, and the
// resumed plan would have walked back into the same place. An abort cannot be
// thrown in a test, so each death is reproduced the way it looks to the NEXT
// run: the marker the dead run left behind in Script Properties.
//
//   1. The push names each sheet in Script Properties before touching it, and
//      clears the marker when the loop ends.
//   2. A marker left standing is reported by name, and that sheet goes LAST.
//   3. A second death on the same sheet leaves it out; everything else is
//      still written. A day later it is tried again, and a clean write wipes
//      its count.
//   4. The push lets go of each spreadsheet handle once it is done with it.
//   5. The sync's tail logs a start line per step, puts the step's id on the
//      plan while it runs, and a plan still carrying it is a death: retried
//      once, then dropped from the window so the steps after it run.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 30, 11, 0, 0).getTime();
const props = {};

function builder() {
  const b = new Proxy({}, {
    get(t, prop) {
      if (prop === 'build') return () => ({ __rule: true });
      if (typeof prop !== 'string') return undefined;
      return () => b;
    }
  });
  return b;
}

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  },
  Utilities: {
    formatDate: (d, tz, pattern) =>
      (pattern === 'yyyy-MM-dd' ? new RealDate(d).toISOString().slice(0, 10) : new RealDate(d).toISOString()),
    getUuid: () => 'abcdef01-2345-6789-abcd-ef0123456789',
    sleep: () => {},
    computeDigest: (algo, raw) => {
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
      return [(h >> 24) & 255, (h >> 16) & 255, (h >> 8) & 255, h & 255];
    },
    DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      setProperties: () => {}, deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); },
    flush: () => {},
    newDataValidation: () => builder(),
    newConditionalFormatRule: () => builder(),
    WrapStrategy: { CLIP: 'CLIP', OVERFLOW: 'OVERFLOW', WRAP: 'WRAP' },
    ProtectionType: { RANGE: 'RANGE' },
    BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.LEADER_SHEET_HEADERS = LEADER_SHEET_HEADERS;
this.LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY = LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY;
this.LEADER_SHEET_PUSH_MAX_CRASHES = LEADER_SHEET_PUSH_MAX_CRASHES;
this.REGISTRATION_SYNC_TAIL_STEPS = REGISTRATION_SYNC_TAIL_STEPS;
this.REGISTRATION_SYNC_MAX_STEP_DEATHS = REGISTRATION_SYNC_MAX_STEP_DEATHS;
this.getIndexMap = getIndexMap;
this.pushProgramLeaderSheets = pushProgramLeaderSheets;
this.openSpreadsheetCached = openSpreadsheetCached;
this.forgetSpreadsheetCached = forgetSpreadsheetCached;
this.runRegistrationSyncPhases_ = runRegistrationSyncPhases_;
this.__setRegistry = function (r) { __leaderSheetRegistryCache = r; __leaderSheetRegistryDirty = false; };
this.__stubRowsByProgram = function (fn) { buildLeaderSheetRowsByProgram = fn; };
this.__stubAccess = function (fn) { ensureProgramLeaderSheetAccess = fn; };
this.__stubSyncContext = function (fn) { buildRegistrationSyncContext = fn; };
`, sandbox, { filename: 'program.gs' });

const logs = [];
const notes = [];
sandbox.log = m => logs.push(String(m));
sandbox.noteForAdmin = (section, m) => notes.push(`${section}: ${m}`);
sandbox.toastIfPossible = () => {};

const headers = sandbox.LEADER_SHEET_HEADERS;
const map = sandbox.getIndexMap(headers);
function rosterFor(title, n) {
  const row = new Array(headers.length).fill('');
  row[map['Event_Date']] = new RealDate(2026, 9, 6, 10, 0);
  row[map['Event_Time']] = '10:00 AM – 11:30 AM';
  row[map['Name']] = `Somebody at ${title} ${n || ''}`;
  row[map['Party_Size']] = 1;
  row[map['Program_Status']] = 'Active';
  row[map['Event_ID']] = `evt|${title}|0`;
  return [row];
}

const KEY = sandbox.LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY;
const sheets = {};
const opened = [];
const markerWhenOpened = {};
sandbox.SpreadsheetApp.openById = id => {
  opened.push(id);
  markerWhenOpened[id] = props[KEY] ? JSON.parse(props[KEY]).current : null;
  sheets[id] = sheets[id] || makeCountingSheet([], 'Sign_Up_Sheet');
  const sheet = sheets[id];
  return { getSheetByName: () => sheet, insertSheet: () => sheet, getSheets: () => [sheet] };
};
let generation = 0;
sandbox.__stubRowsByProgram(() => ({
  'a|ashbridge': rosterFor('A', generation), 'b|ashbridge': rosterFor('B', generation),
  'c|narberth': rosterFor('C', generation)
}));
sandbox.__stubAccess(() => ({ openedUp: true, editors: ['a@b.c'] }));
const registry = {
  'a|ashbridge': { fileId: 'FA', title: 'A', location: 'Ashbridge' },
  'b|ashbridge': { fileId: 'FB', title: 'B', location: 'Ashbridge' },
  'c|narberth': { fileId: 'FC', title: 'C', location: 'Narberth' }
};
sandbox.__setRegistry(registry);

function push() {
  opened.length = 0;
  logs.length = 0;
  notes.length = 0;
  generation++; // every sheet a rewrite, as after the v3 bump
  return sandbox.pushProgramLeaderSheets([], [], { progress: {} });
}

// 1. Each sheet is named before it is touched; nothing is left standing after.
assert.strictEqual(push(), 3, 'a clean push writes all three');
assert.strictEqual(markerWhenOpened.FB && markerWhenOpened.FB.programKey, 'b|ashbridge',
  'the marker names the sheet BEFORE its file is opened');
assert.ok(!(KEY in props), 'a push that finished leaves no marker behind');
assert.ok(logs.some(l => /rewriting \d\/3 — "B" \(Ashbridge\)/.test(l)),
  'each rewrite is its own log line, naming the program');

// 4. Handles are let go of once each sheet is done.
opened.length = 0;
sandbox.openSpreadsheetCached('FA');
assert.deepStrictEqual(opened, ['FA'], 'the push did not keep FA open for the rest of the execution');
sandbox.forgetSpreadsheetCached('FA');

// 2. A run died on B: B is reported by name and goes last.
props[KEY] = JSON.stringify({ current: { programKey: 'b|ashbridge', title: 'B', location: 'Ashbridge',
  fileId: 'FB', at: '2026-09-30T15:39:00Z' }, crashes: {} });
assert.strictEqual(push(), 3, 'after one death every sheet is still written');
assert.deepStrictEqual(opened, ['FA', 'FC', 'FB'], 'the sheet that died goes to the back of the queue');
assert.ok(logs.some(l => /died while on the sheet for "B" \(Ashbridge\)/.test(l)), 'and is named in the log');
assert.ok(notes.some(n => /stopped the sync/.test(n) && /spreadsheets\/d\/FB/.test(n)),
  'and in the office digest, with its link');
// A clean rewrite of B wiped its count.
assert.ok(!(KEY in props), 'B written cleanly: nothing held against it');

// 3. Two deaths in a row on B: left out, the rest still written.
props[KEY] = JSON.stringify({ current: { programKey: 'b|ashbridge', title: 'B', location: 'Ashbridge',
  fileId: 'FB', at: '2026-09-30T15:39:00Z' },
  crashes: { 'b|ashbridge': { count: 1, lastAt: new RealDate(NOW - 3600000).toISOString() } } });
assert.strictEqual(push(), 2, 'the other two sheets are written');
assert.ok(opened.indexOf('FB') === -1, 'the sheet that killed two runs is not opened');
assert.ok(logs.some(l => /left out 1 sheet/.test(l)), 'and the log says one was left out');
const held = JSON.parse(props[KEY]);
assert.strictEqual(held.current, null, 'no sheet is in flight after the loop');
assert.strictEqual(held.crashes['b|ashbridge'].count, sandbox.LEADER_SHEET_PUSH_MAX_CRASHES,
  'the count is kept so the next hour leaves it out too');
assert.strictEqual(push(), 2, 'the next hour still leaves it out');

// A day later it is forgotten and tried again.
held.crashes['b|ashbridge'].lastAt = new RealDate(NOW - 25 * 3600000).toISOString();
props[KEY] = JSON.stringify(held);
assert.strictEqual(push(), 3, 'a day-old count is forgotten');
assert.ok(!(KEY in props), 'and the clean write clears it');

// 5. The tail: a start line, the marker while a step runs, and a death.
const steps = sandbox.REGISTRATION_SYNC_TAIL_STEPS;
const ran = [];
const savedDuring = {};
let lastSaved = null;
steps.forEach(s => { s.run = () => { ran.push(s.id); savedDuring[s.id] = JSON.parse(lastSaved); }; });
sandbox.__stubSyncContext(() => ({ problems: [], step: (label, fn) => fn() }));
function tailCtx(tail, extra) {
  const state = Object.assign({ importDone: true, tail: tail.slice(), problems: [] }, extra || {});
  return { state, deadline: Infinity, save: () => { lastSaved = JSON.stringify(state); } };
}

logs.length = 0;
let ctx = tailCtx(['club_tab', 'leader_sheets_push']);
sandbox.runRegistrationSyncPhases_(ctx);
assert.deepStrictEqual(ran, ['club_tab', 'leader_sheets_push'], 'both steps ran');
assert.strictEqual(savedDuring.club_tab.stepInFlight.id, 'club_tab',
  'the running step is on the SAVED plan while it runs');
assert.ok(ctx.state.stepInFlight === undefined, 'and gone once it returned');
assert.ok(logs.some(l => /step \d+\/\d+ — rebuilding the club roster tab/.test(l)),
  'every step logs a start line');

// A plan still carrying the marker: the last slice died in that step.
ran.length = 0;
logs.length = 0;
ctx = tailCtx(['leader_sheets_push', 'leader_alerts'],
  { stepInFlight: { id: 'leader_sheets_push', at: '2026-09-30T15:30:33Z' } });
sandbox.runRegistrationSyncPhases_(ctx);
assert.deepStrictEqual(ran, ['leader_sheets_push', 'leader_alerts'], 'one death: the step is tried again');
assert.ok(logs.some(l => /previous run died while refreshing the program registrant sheets/.test(l)),
  'and the log names the step that died');

ran.length = 0;
notes.length = 0;
ctx = tailCtx(['leader_sheets_push', 'leader_alerts'],
  { stepInFlight: { id: 'leader_sheets_push', at: '2026-09-30T15:30:33Z' },
    stepDeaths: { leader_sheets_push: sandbox.REGISTRATION_SYNC_MAX_STEP_DEATHS - 1 } });
sandbox.runRegistrationSyncPhases_(ctx);
assert.deepStrictEqual(ran, ['leader_alerts'], 'a second death drops the step, and the rest of the tail runs');
assert.ok(ctx.state.problems.some(p => /registrant sheets/.test(p)), 'recorded as a problem for the window');
assert.ok(notes.some(n => /stopped outright/.test(n)), 'and told to the office');

console.log('leader_sheet_push_crash: all passed');
