// THE PUSH STOPS AT THE SLICE'S DEADLINE, AND WHAT IT DID SURVIVES A KILL.
//
// 2026-09-30: after the v3 template bump every program registrant sheet was a
// rewrite, and pushProgramLeaderSheets() ran from 9:01 to Apps Script's
// ceiling at 9:20 without a line in the log. Its fingerprints were only in
// memory, so the kill lost all of them and the next hour began the same
// rewrite from the top. This pins the three halves of the fix:
//
//   1. With a deadline already spent, the push still does ONE sheet (so a
//      follow-up always moves forward) and reports how many are left.
//   2. Each fingerprint is in Script Properties the moment its sheet lands —
//      not at the end of the execution, which a killed run never reaches.
//   3. The sync's tail step answers AGAIN when sheets are left, so it stays at
//      the head of the tail for the follow-up run instead of being dropped.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');
const { makeCountingSheet } = require('./helpers/counting_sheet');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 30, 9, 0, 0).getTime();
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
this.LEADER_SHEET_REGISTRY_PROP_KEY = LEADER_SHEET_REGISTRY_PROP_KEY;
this.REGISTRATION_SYNC_TAIL_STEPS = REGISTRATION_SYNC_TAIL_STEPS;
this.REGISTRATION_SYNC_STEP_AGAIN = REGISTRATION_SYNC_STEP_AGAIN;
this.getIndexMap = getIndexMap;
this.pushProgramLeaderSheets = pushProgramLeaderSheets;
this.__setRegistry = function (r) { __leaderSheetRegistryCache = r; __leaderSheetRegistryDirty = false; };
this.__stubRowsByProgram = function (fn) { buildLeaderSheetRowsByProgram = fn; };
this.__stubAccess = function (fn) { ensureProgramLeaderSheetAccess = fn; };
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.toastIfPossible = () => {};

const headers = sandbox.LEADER_SHEET_HEADERS;
const map = sandbox.getIndexMap(headers);
function rosterFor(title) {
  const row = new Array(headers.length).fill('');
  row[map['Event_Date']] = new RealDate(2026, 9, 6, 10, 0);
  row[map['Event_Time']] = '10:00 AM – 11:30 AM';
  row[map['Name']] = `Somebody at ${title}`;
  row[map['Party_Size']] = 1;
  row[map['Program_Status']] = 'Active';
  row[map['Event_ID']] = `evt|${title}|0`;
  return [row];
}

const keys = ['a|ashbridge', 'b|ashbridge', 'c|narberth'];
const sheets = {};
sandbox.SpreadsheetApp.openById = id => {
  sheets[id] = sheets[id] || makeCountingSheet([], 'Sign_Up_Sheet');
  const sheet = sheets[id];
  return { getSheetByName: () => sheet, insertSheet: () => sheet, getSheets: () => [sheet] };
};
sandbox.__stubRowsByProgram(() => ({
  'a|ashbridge': rosterFor('A'), 'b|ashbridge': rosterFor('B'), 'c|narberth': rosterFor('C')
}));
sandbox.__stubAccess(() => ({ openedUp: true, editors: ['a@b.c'] }));
sandbox.__setRegistry({
  'a|ashbridge': { fileId: 'FA', title: 'A', location: 'Ashbridge' },
  'b|ashbridge': { fileId: 'FB', title: 'B', location: 'Ashbridge' },
  'c|narberth': { fileId: 'FC', title: 'C', location: 'Narberth' }
});

// 1 + 2. A spent deadline: one sheet, the rest reported, and it is SAVED.
const progress = {};
const pushed = sandbox.pushProgramLeaderSheets([], [], { deadline: NOW - 1, progress });
assert.strictEqual(pushed, 1, 'a spent deadline still writes one sheet, so a follow-up always moves forward');
assert.strictEqual(progress.remaining, 2, 'and says how many are left');
const stored = JSON.parse(props[sandbox.LEADER_SHEET_REGISTRY_PROP_KEY] || '{}');
assert.ok(stored[keys[0]] && stored[keys[0]].pushedFingerprint,
  "the written sheet's fingerprint is in Script Properties already — a killed run keeps it");
assert.ok(!stored[keys[1]] || !stored[keys[1]].pushedFingerprint, 'and the untouched ones are not claimed');

// The follow-up: no deadline, the first sheet is skipped as unchanged.
const followUp = {};
const rest = sandbox.pushProgramLeaderSheets([], [], { progress: followUp });
assert.strictEqual(rest, 2, 'the follow-up writes only the two it had not reached');
assert.strictEqual(followUp.remaining, 0, 'and reports nothing left');

// No options at all: the menu's call shape still works.
assert.strictEqual(sandbox.pushProgramLeaderSheets([], []), 0, 'an unchanged hour writes nothing');

// 3. The tail step keeps itself when there is more to do.
const step = sandbox.REGISTRATION_SYNC_TAIL_STEPS.find(s => s.id === 'leader_sheets_push');
sandbox.__setRegistry({
  'a|ashbridge': { fileId: 'FA2', title: 'A', location: 'Ashbridge' },
  'b|ashbridge': { fileId: 'FB2', title: 'B', location: 'Ashbridge' }
});
const ctx = { deadline: NOW - 1, sessionRows: () => [], settledRows: () => [] };
assert.strictEqual(step.run(ctx), sandbox.REGISTRATION_SYNC_STEP_AGAIN,
  'out of budget with sheets left, the step asks to stay at the head of the tail');
assert.strictEqual(step.run(Object.assign({}, ctx, { deadline: Infinity })), undefined,
  'and is done once every sheet has been reached');

console.log('leader_sheet_push_deadline: all passed');
