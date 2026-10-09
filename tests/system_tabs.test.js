// A FRONT OFFICE AND A BACK ROOM (99zp).
//
// Pins: the back-room list and the front office never overlap and the session
// table stays visible; apply hides and warning-protects only system tabs that
// exist, leaves a staff tab alone, is idempotent (a second run writes nothing),
// never protects with an editors list, steps off an active system tab first;
// Config "No" shows them and lifts only OUR protection; reorderTabs() hides
// again what it un-hid by activating; the toggle shows for a window and hides
// again; the daily pass is a no-op inside that window and on the same day.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const props = {};
let configValue = '';

function makeProtection(desc, warning) {
  const p = {
    desc, warning, removed: false,
    getDescription: () => p.desc,
    setDescription: d => { p.desc = d; return p; },
    setWarningOnly: w => { p.warning = w; return p; },
    isWarningOnly: () => p.warning,
    remove: () => { p.removed = true; }
  };
  return p;
}

function makeSheet(ss, name, hidden) {
  const sh = {
    name, hidden: !!hidden, protections: [], writes: 0,
    getName: () => name,
    isSheetHidden: () => sh.hidden,
    hideSheet: () => {
      if (ss.active === sh) throw new Error('cannot hide the active sheet');
      sh.hidden = true; sh.writes++;
    },
    showSheet: () => { sh.hidden = false; sh.writes++; },
    getProtections: () => sh.protections.filter(p => !p.removed),
    protect: () => { const p = makeProtection('', false); sh.protections.push(p); sh.writes++; return p; },
    setTabColor: () => {},
    getRange: () => ({ getValue: () => configValue, setValue: () => {}, setNote: () => {} })
  };
  return sh;
}

function makeSpreadsheet(names, hiddenNames) {
  const ss = { sheets: [], active: null };
  ss.sheets = names.map(n => makeSheet(ss, n, (hiddenNames || []).includes(n)));
  ss.active = ss.sheets[0];
  ss.getSheets = () => ss.sheets.slice();
  ss.getSheetByName = n => ss.sheets.find(s => s.name === n) || null;
  ss.getActiveSheet = () => ss.active;
  ss.setActiveSheet = s => { ss.active = s; s.hidden = false; return s; }; // activating shows it, as in Sheets
  ss.moveActiveSheet = pos => {
    const i = ss.sheets.indexOf(ss.active);
    ss.sheets.splice(i, 1);
    ss.sheets.splice(pos - 1, 0, ss.active);
  };
  return ss;
}

let current = null;
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), sleep: () => {}, getUuid: () => 'u',
    computeDigest: () => [1], DigestAlgorithm: {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; }
  }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => current, getActive: () => current, flush: () => {},
    getUi: () => { throw new Error('no ui'); },
    ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
    DataValidationCriteria: { CHECKBOX: 'CHECKBOX', VALUE_IN_LIST: 'VALUE_IN_LIST' }
  },
  CacheService: { getScriptCache: () => null, getUserCache: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }),
    getActiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.SYSTEM_TAB_NAMES = SYSTEM_TAB_NAMES;
this.SHEET_NAMES = SHEET_NAMES;
this.frontOfficeTabNames = frontOfficeTabNames;
this.applySystemTabVisibility = applySystemTabVisibility;
this.applySystemTabVisibilityIfDue_ = applySystemTabVisibilityIfDue_;
this.toggleSystemTabVisibility = toggleSystemTabVisibility;
this.reorderTabs = reorderTabs;
this.openSystemTab_ = openSystemTab_;
this.SYSTEM_TAB_PROTECTION_DESCRIPTION = SYSTEM_TAB_PROTECTION_DESCRIPTION;
this.resetRun = () => { __systemTabVisibilityAppliedThisRun = false; };
`, sandbox);

const S = sandbox.SHEET_NAMES;
const SYSTEM = sandbox.SYSTEM_TAB_NAMES;

// --- The lists ------------------------------------------------------------
for (const must of [S.REGISTRATION_LEDGER, 'Ledger_Checkpoint', S.TRIAGE, S.METRICS,
  '_Pending_Tag_Changes', 'Quick_Mark_Index']) {
  assert.ok(SYSTEM.includes(must), `${must} is a system tab`);
}
const front = sandbox.frontOfficeTabNames();
assert.ok(front.length > 0);
assert.ok(front.every(n => !SYSTEM.includes(n)), 'front office and back room never overlap');
for (const staff of [S.PROGRAM_DASHBOARD, S.PROGRAM_MONTH, S.REGISTRANT_DASH, S.CONFIG,
  S.MEMBER_ROLL, S.PROGRAM_SETTINGS, S.PROGRAM_LEADERS, S.LUNCH_SCHEDULE, S.VOLUNTEER_HOURS,
  S.PROGRAM_WAITLIST]) {
  assert.ok(!SYSTEM.includes(staff), `${staff} stays visible`);
}

// --- Apply: hides and protects only existing system tabs ------------------
current = makeSpreadsheet([S.CONFIG, S.REGISTRANT_DASH, S.REGISTRATION_LEDGER, S.TRIAGE, 'Office Notes']);
current.active = current.getSheetByName(S.REGISTRATION_LEDGER); // somebody is looking at it
configValue = '';
let r = sandbox.applySystemTabVisibility();
assert.strictEqual(r.errors.length, 0);
assert.strictEqual(JSON.stringify(r.hidden.slice().sort()), JSON.stringify([S.REGISTRATION_LEDGER, S.TRIAGE].sort()));
assert.strictEqual(current.getSheetByName(S.REGISTRATION_LEDGER).hidden, true);
assert.strictEqual(current.getSheetByName('Office Notes').hidden, false, 'a staff tab is never touched');
assert.strictEqual(current.getSheetByName(S.REGISTRANT_DASH).hidden, false);
assert.ok(!SYSTEM.includes(current.active.getName()), 'stepped off the system tab first');
const ledgerProt = current.getSheetByName(S.REGISTRATION_LEDGER).getProtections();
assert.strictEqual(ledgerProt.length, 1);
assert.strictEqual(ledgerProt[0].getDescription(), sandbox.SYSTEM_TAB_PROTECTION_DESCRIPTION);
assert.strictEqual(ledgerProt[0].isWarningOnly(), true, 'warning-only: nobody is locked out');

// Idempotent: a second run writes nothing.
const before = current.sheets.map(s => s.writes);
r = sandbox.applySystemTabVisibility();
assert.deepStrictEqual(current.sheets.map(s => s.writes), before);
assert.strictEqual(r.hidden.length + r.protected.length, 0);

// A hardened protection is turned back into a warning.
ledgerProt[0].warning = false;
sandbox.applySystemTabVisibility();
assert.strictEqual(ledgerProt[0].isWarningOnly(), true);

// --- Config "No": shown, and only OUR protection lifted -------------------
const triage = current.getSheetByName(S.TRIAGE);
const someoneElses = makeProtection('derived columns', true);
triage.protections.push(someoneElses);
configValue = 'No';
r = sandbox.applySystemTabVisibility();
assert.strictEqual(triage.hidden, false);
assert.strictEqual(current.getSheetByName(S.REGISTRATION_LEDGER).hidden, false);
assert.strictEqual(someoneElses.removed, false, 'another protection is left alone');
assert.strictEqual(JSON.stringify(triage.getProtections().map(p => p.getDescription())), '["derived columns"]');
configValue = '';

// --- reorderTabs: activating un-hides; it must hide again ------------------
current = makeSpreadsheet([S.REGISTRANT_DASH, S.CONFIG, S.TRIAGE, S.METRICS, 'Office Notes'],
  [S.TRIAGE, S.METRICS, 'Office Notes']);
sandbox.reorderTabs(current);
assert.strictEqual(current.getSheetByName(S.TRIAGE).hidden, true);
assert.strictEqual(current.getSheetByName(S.METRICS).hidden, true);
assert.strictEqual(current.getSheetByName('Office Notes').hidden, true, 'staff-hidden tab stays hidden');
assert.strictEqual(current.active.hidden, false, 'left on a visible tab');

// --- openSystemTab_: show then activate -----------------------------------
const opened = sandbox.openSystemTab_(S.METRICS);
assert.strictEqual(opened.hidden, false);
assert.strictEqual(current.active, opened);

// --- Toggle and the daily pass ---------------------------------------------
current = makeSpreadsheet([S.CONFIG, S.REGISTRATION_LEDGER, S.TRIAGE]);
sandbox.applySystemTabVisibility();
assert.strictEqual(sandbox.toggleSystemTabVisibility(), 'shown');
assert.ok(Number(props.SYSTEM_TABS_SHOWN_UNTIL_V1) > Date.now());
assert.strictEqual(current.getSheetByName(S.TRIAGE).hidden, false);
// Protection stays on while shown.
assert.strictEqual(current.getSheetByName(S.TRIAGE).getProtections().length, 1);
// Inside the window, the daily pass leaves them be.
sandbox.resetRun();
assert.strictEqual(sandbox.applySystemTabVisibilityIfDue_(), false);
assert.strictEqual(current.getSheetByName(S.TRIAGE).hidden, false);
// Window lapsed: hides and clears it.
props.SYSTEM_TABS_SHOWN_UNTIL_V1 = String(Date.now() - 1);
sandbox.resetRun();
assert.strictEqual(sandbox.applySystemTabVisibilityIfDue_(), true);
assert.strictEqual(current.getSheetByName(S.TRIAGE).hidden, true);
assert.ok(!('SYSTEM_TABS_SHOWN_UNTIL_V1' in props));
// Same day again: not due.
current.getSheetByName(S.TRIAGE).hidden = false;
sandbox.resetRun();
assert.strictEqual(sandbox.applySystemTabVisibilityIfDue_(), false);
// Toggle while shown → hides now.
assert.strictEqual(sandbox.toggleSystemTabVisibility(), 'shown');
assert.strictEqual(sandbox.toggleSystemTabVisibility(), 'hidden');
assert.strictEqual(current.getSheetByName(S.TRIAGE).hidden, true);

// --- Never throws -----------------------------------------------------------
current = makeSpreadsheet([S.CONFIG, S.REGISTRATION_LEDGER]);
current.getSheetByName(S.REGISTRATION_LEDGER).getProtections = () => { throw new Error('no access'); };
r = sandbox.applySystemTabVisibility();
assert.strictEqual(r.errors.length, 1);
current = null;
assert.doesNotThrow(() => sandbox.applySystemTabVisibility());

console.log('system_tabs.test.js: ok');
