// THE NINTH STORE: a renamed program's REGISTRANT SHEET REGISTRY (section 22).
//
// applyProgramRenames() moved eight stores and not this one, and missing it
// reports nothing at all: the registry keeps the old key and the old stored
// title while the session table carries the new Clean_Title, so the push
// iterates a key the join no longer produces, writes an empty roster over a
// real one, and the stranded-row counter — comparing against that same stale
// title — finds nothing to report. A program leader is left holding a live
// link to a sheet that says "Nobody has signed up yet" while every screen in
// the workbook agrees everything is fine.
//
// What is pinned here:
//
//   BOTH FACTS MOVE — the key the push iterates AND the title every report
//   names the program by. Moving one without the other trades a silent empty
//   sheet for a confusing report.
//
//   EVERY BUILDING — a [Shared] program renamed once has two keys, because a
//   registrant sheet is keyed on title AND location.
//
//   A COLLISION MOVES NOTHING. A sheet already registered under the new name
//   is a real file in somebody's Drive; overwriting its entry would leave that
//   file in no registry at all, which is the one state no report can see.
//
//   AND AN UNTOUCHED REGISTRY IS NOT WRITTEN — a rename of a program that has
//   no shared sheet costs nothing.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const store = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
      return pattern === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1, 2, 3, 4], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (store[key] === undefined ? null : store[key]),
      setProperty: (key, value) => { store[key] = value; },
      deleteProperty: key => { delete store[key]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.renameLeaderSheetRegistryKeys = renameLeaderSheetRegistryKeys;
this.collectRenameLocations_ = collectRenameLocations_;
this.leaderProgramKey = leaderProgramKey;
this.getProgramLeaderSheetRegistry = getProgramLeaderSheetRegistry;
this.saveProgramLeaderSheetRegistryEntry = saveProgramLeaderSheetRegistryEntry;
this.LEADER_SHEET_REGISTRY_PROP_KEY = LEADER_SHEET_REGISTRY_PROP_KEY;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
// The office notes are the other half of the collision answer, so they are
// collected rather than swallowed.
this.__notes = [];
noteForAdmin = function (section, message) { this.__notes.push({ section, message }); }.bind(this);
this.__resetRegistry = function (entries) {
  __leaderSheetRegistryCache = entries;
  __leaderSheetRegistryDirty = false;
};
`, sandbox, { filename: 'program.gs' });

const {
  renameLeaderSheetRegistryKeys, collectRenameLocations_, leaderProgramKey,
  getProgramLeaderSheetRegistry, HEADERS, getIndexMap
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}

const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
function sessionRow(fields) {
  const row = new Array(HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(fields).forEach(key => { row[sessionMap[key]] = fields[key]; });
  return row;
}

// --- The buildings a rename has to move -----------------------------------
check('the locations are the distinct buildings the rows name',
  collectRenameLocations_([
    sessionRow({ Location: 'Narberth' }),
    sessionRow({ Location: 'Ashbridge' }),
    sessionRow({ Location: 'Narberth' }),
    sessionRow({ Location: '' })
  ], sessionMap), ['Narberth', 'Ashbridge']);

// --- The ordinary rename ---------------------------------------------------
// "Glee Club" -> "Glee Club Rehearsal", which is one of the four found on a
// real workbook: the sheet was registered under the old name and the sessions
// had long since moved to the new one.
sandbox.__notes.length = 0;
sandbox.__resetRegistry({
  [leaderProgramKey('Glee Club', 'Narberth')]: {
    fileId: 'FILE1', title: 'Glee Club', location: 'Narberth',
    pushedFingerprint: 'fp', accessOpened: true
  }
});
renameLeaderSheetRegistryKeys([
  { oldTitle: 'Glee Club', newTitle: 'Glee Club Rehearsal', locations: ['Narberth'] }
]);
let registry = getProgramLeaderSheetRegistry();

check('the entry is filed under the new key',
  !!registry[leaderProgramKey('Glee Club Rehearsal', 'Narberth')], true);
check('and no longer under the old one',
  registry[leaderProgramKey('Glee Club', 'Narberth')] === undefined, true);
check('the stored title moves with it — it is what every report names',
  registry[leaderProgramKey('Glee Club Rehearsal', 'Narberth')].title, 'Glee Club Rehearsal');
check('and the file, the fingerprint and the access flag are untouched',
  (e => [e.fileId, e.pushedFingerprint, e.accessOpened])(
    registry[leaderProgramKey('Glee Club Rehearsal', 'Narberth')]),
  ['FILE1', 'fp', true]);
check('nothing is reported, because nothing needed a person',
  sandbox.__notes.length, 0);

// --- Two buildings, one rename --------------------------------------------
sandbox.__resetRegistry({
  [leaderProgramKey('Book Club', 'Narberth')]: { fileId: 'N', title: 'Book Club', location: 'Narberth' },
  [leaderProgramKey('Book Club', 'Ashbridge')]: { fileId: 'A', title: 'Book Club', location: 'Ashbridge' }
});
renameLeaderSheetRegistryKeys([
  { oldTitle: 'Book Club', newTitle: 'Monday Book Club', locations: ['Narberth', 'Ashbridge'] }
]);
registry = getProgramLeaderSheetRegistry();
check('a [Shared] program moves every building it runs in',
  [
    (registry[leaderProgramKey('Monday Book Club', 'Narberth')] || {}).fileId,
    (registry[leaderProgramKey('Monday Book Club', 'Ashbridge')] || {}).fileId
  ], ['N', 'A']);

// --- The collision ---------------------------------------------------------
// Both entries point at DIFFERENT files, which is the real shape: "Healthy
// Exercise (H)" and "Healthy Exercise(H)" each had a spreadsheet of their own.
sandbox.__notes.length = 0;
sandbox.__resetRegistry({
  [leaderProgramKey('Healthy Exercise (H)', 'Narberth')]: { fileId: 'OLD', title: 'Healthy Exercise (H)' },
  [leaderProgramKey('Healthy Exercise(H)', 'Narberth')]: { fileId: 'NEW', title: 'Healthy Exercise(H)' }
});
renameLeaderSheetRegistryKeys([
  { oldTitle: 'Healthy Exercise (H)', newTitle: 'Healthy Exercise(H)', locations: ['Narberth'] }
]);
registry = getProgramLeaderSheetRegistry();
check('a collision overwrites nothing — the live entry keeps its file',
  registry[leaderProgramKey('Healthy Exercise(H)', 'Narberth')].fileId, 'NEW');
check('and strands nothing — the old entry is still there naming its own file',
  (registry[leaderProgramKey('Healthy Exercise (H)', 'Narberth')] || {}).fileId, 'OLD');
check('and a person is told, because only a person can say which link is held',
  sandbox.__notes.length, 1);
check('under the heading the rename itself is reported under',
  sandbox.__notes[0].section, 'Programs renamed on the calendar');

// --- A rename with no sheet to move ---------------------------------------
// Cleared first, because the flushes above have already written the property
// and "was it written" is only a question about a clean slate.
delete store[sandbox.LEADER_SHEET_REGISTRY_PROP_KEY];
sandbox.__resetRegistry({});
renameLeaderSheetRegistryKeys([
  { oldTitle: 'Nobody Shares This', newTitle: 'Still Nobody', locations: ['Narberth'] }
]);
check('a program with no shared sheet costs nothing',
  Object.keys(getProgramLeaderSheetRegistry()).length, 0);
check('and the registry was never written',
  store[sandbox.LEADER_SHEET_REGISTRY_PROP_KEY] === undefined, true);

// A rename carrying no locations cannot move anything and must not throw:
// detectRenamedPrograms() is the only caller that fills that field in.
sandbox.__resetRegistry({ [leaderProgramKey('A', 'Narberth')]: { fileId: 'X', title: 'A' } });
renameLeaderSheetRegistryKeys([{ oldTitle: 'A', newTitle: 'B' }]);
check('a rename with no buildings on it leaves the registry alone',
  (getProgramLeaderSheetRegistry()[leaderProgramKey('A', 'Narberth')] || {}).fileId, 'X');

console.log(failures === 0 ? '\nAll leader sheet rename checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
