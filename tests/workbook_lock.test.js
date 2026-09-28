// THE WORKBOOK LOCK AND THE 2026-09-25 INCIDENT (99w, 99x, 46, 90, 98).
//
// Apps Script releases a held script lock after about six minutes, silently,
// while a sync slice works for up to 25. On 2026-09-25 that let two
// registration sync slices, a duplicate-row removal and a third slice overlap;
// the session table was redrawn from stale rows, then read mid-redraw and
// written back EMPTY, and every later slice blanked ~33 program registrant
// sheets. Pinned here:
//
//   A LIVE LEASE HELD BY ANOTHER EXECUTION REFUSES, even when the raw script
//   lock says yes — which is exactly what a lapsed hold looks like.
//   A LAPSED LEASE DOES NOT, so a killed run frees the workbook on its own.
//   THE LOCK IS REENTRANT: a nested release does not drop the outer hold.
//   THE WATCHDOG FIRES AFTER THE BUDGET, not five minutes into it.
//   THE SESSION TABLE IS NEVER REDRAWN EMPTY from a table that held rows.
//   AN EMPTY SESSION TABLE BLANKS NO ROSTER.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
let rawLockFree = true;
const rawEvents = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString(), getUuid: () => 'me', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: {
    getScriptLock: () => ({
      tryLock: () => { rawEvents.push('try'); return rawLockFree; },
      releaseLock: () => { rawEvents.push('release'); }
    })
  },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.workbookLock = workbookLock;
this.holdsWorkbookLock = holdsWorkbookLock;
this.renewWorkbookLease = renewWorkbookLease;
this.describeWorkbookLease = describeWorkbookLease;
this.KEY = WORKBOOK_LOCK_LEASE_PROP_KEY;
this.sessionTableShrinkRefusal = sessionTableShrinkRefusal;
this.guardSessionTableShrink = guardSessionTableShrink;
this.recordSessionTableCount = recordSessionTableCount;
this.pushProgramLeaderSheets = pushProgramLeaderSheets;
this.REG_WATCHDOG = REGISTRATION_SYNC_WATCHDOG_DELAY_MS;
this.src98 = runRegistrationSyncSlice.toString();
this.src90 = runCalendarSyncSlice.toString();
this.__stub = (name, fn) => { eval(name + ' = fn'); };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}
const lease = () => (props[sandbox.KEY] ? JSON.parse(props[sandbox.KEY]) : null);

// --- The lease -------------------------------------------------------------
let lock = sandbox.workbookLock('Registration sync');
check('a free workbook is taken', lock.tryLock(0), true);
check('and the lease names this run', [lease().owner, lease().label], ['me', 'Registration sync']);

const inner = sandbox.workbookLock('desk');
check('a nested acquire in the same run is granted', inner.tryLock(0), true);
rawEvents.length = 0;
inner.releaseLock();
check('a nested release keeps the outer hold', [sandbox.holdsWorkbookLock(), !!lease(), rawEvents], [true, true, []]);
lock.releaseLock();
check('the outer release frees both', [sandbox.holdsWorkbookLock(), lease(), rawEvents], [false, null, ['release']]);

// Another execution's live lease, and a raw lock that has lapsed under it.
props[sandbox.KEY] = JSON.stringify({ owner: 'other', label: 'Registration sync', since: Date.now() - 8 * 60000,
  renewedAt: Date.now() - 30000, expiresAt: Date.now() + 5 * 60000 });
rawEvents.length = 0;
lock = sandbox.workbookLock('Remove Duplicate Session Rows');
check('a live lease elsewhere refuses although the raw lock was granted', lock.tryLock(0), false);
check('and the raw lock it got is handed straight back', rawEvents, ['try', 'release']);
check('the other run\'s lease is untouched', lease().owner, 'other');
check('and it is reported for "why did nothing happen?"',
  sandbox.describeWorkbookLease().indexOf('"Registration sync"') !== -1, true);

// A lapsed lease — its run was killed and ran no finally.
props[sandbox.KEY] = JSON.stringify({ owner: 'other', since: 0, renewedAt: 0, expiresAt: Date.now() - 1 });
lock = sandbox.workbookLock('x');
check('a lapsed lease does not block', lock.tryLock(0), true);
check('and is replaced by ours', lease().owner, 'me');
const before = lease().expiresAt;
sandbox.renewWorkbookLease(true);
check('renewing pushes the expiry forward', lease().expiresAt >= before, true);
lock.releaseLock();

rawLockFree = false;
check('a raw lock somebody holds still refuses', sandbox.workbookLock('y').tryLock(0), false);
rawLockFree = true;

// --- The watchdog ----------------------------------------------------------
check('the registration watchdog is added to the budget',
  /watchdogDelayMs:\s*getSyncSliceBudgetMs\(\)\s*\+\s*REGISTRATION_SYNC_WATCHDOG_DELAY_MS/.test(sandbox.src98), true);
check('the calendar watchdog is added to the budget',
  /watchdogDelayMs:\s*getSyncSliceBudgetMs\(\)\s*\+\s*CALENDAR_SYNC_WATCHDOG_DELAY_MS/.test(sandbox.src90), true);
check('both syncs take the lease-backed lock',
  [sandbox.src98.indexOf("workbookLock('Registration sync')") !== -1,
    sandbox.src90.indexOf("workbookLock('Calendar sync')") !== -1], [true, true]);

// --- The session table -----------------------------------------------------
check('500 -> 0 refuses', !!sandbox.sessionTableShrinkRefusal(500, 0), true);
check('500 -> 405 (the duplicate removal) is allowed', sandbox.sessionTableShrinkRefusal(500, 405), '');
check('500 -> 200 refuses', !!sandbox.sessionTableShrinkRefusal(500, 200), true);
check('a first render with nothing recorded is allowed', sandbox.sessionTableShrinkRefusal(null, 0), '');
check('a small table may empty', sandbox.sessionTableShrinkRefusal(5, 0), '');
sandbox.recordSessionTableCount(500);
let threw = false;
try { sandbox.guardSessionTableShrink(0, {}); } catch (err) { threw = /Nothing was written/.test(String(err)); }
check('the guard throws before an empty redraw', threw, true);
threw = false;
try { sandbox.guardSessionTableShrink(0, { allowShrink: true }); } catch (err) { threw = true; }
check('a confirmed removal passes allowShrink', threw, false);

// --- The leader sheets -----------------------------------------------------
const opened = [];
sandbox.__stub('getProgramLeaderSheetRegistry', () => ({ 'chair yoga|narberth': { fileId: 'F', title: 'Chair Yoga', location: 'Narberth' } }));
sandbox.__stub('openSpreadsheetCached', id => { opened.push(id); throw new Error('should not open'); });
sandbox.__stub('noteForAdmin', () => {});
check('an empty session table rewrites no roster', sandbox.pushProgramLeaderSheets([], [['a row']]), 0);
check('and opens no sheet', opened, []);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
