// QUICK MARK WAITS FOR THE SYNC, NOT THE PERSON AT THE DESK (38, 99b, 99w).
//
// The dialog is optimistic: the mark is drawn as done before the server
// answers. So while a sync holds the workbook, the mark is QUEUED at once —
// no lock wait, no "nothing was marked" — and written by the sync itself as
// each slice lets go. Pinned here:
//
//   A mark made while another run holds the lease is queued without touching
//   the lock, and answers ok + queued.
//   A mark somebody IS waiting on (not optimistic) is never silently queued.
//   A free workbook writes at once, exactly as before.
//   A lock wait that times out with no lease visible queues too.
//   The end-of-slice flush writes batch after batch until the queue is empty,
//   and stops at a busy lock rather than spinning.
//   The retry trigger does not wait on a lock a sync is holding.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString(), getUuid: () => 'desk', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.applyQuickMarkFromDialog = applyQuickMarkFromDialog;
this.flushDeskWritesAfterSync = flushDeskWritesAfterSync;
this.flushOptimisticRetryQueueTrigger = flushOptimisticRetryQueueTrigger;
this.KEY = WORKBOOK_LOCK_LEASE_PROP_KEY;
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

const calls = [];
let lockFree = true;
sandbox.__stub('applyQuickMarkLocked', args => { calls.push(`write:${args.name}`); return { ok: true, message: 'marked' }; });
sandbox.__stub('queueOptimisticRetry', (kind, args) => { calls.push(`queue:${kind}:${args.name}`); return true; });
sandbox.__stub('withScriptLock', (ms, fn, busy) => { calls.push('lock'); return lockFree ? fn() : busy; });
sandbox.__stub('notifyAdminUrgent', () => { calls.push('mail'); });
sandbox.__stub('armOptimisticRetry', () => { calls.push('arm'); });
sandbox.__stub('flushCheckInQueue', () => { calls.push('door'); });

const syncHolds = () => {
  props[sandbox.KEY] = JSON.stringify({ owner: 'sync', label: 'Registration sync', since: Date.now(),
    renewedAt: Date.now(), expiresAt: Date.now() + 600000 });
};
const free = () => { delete props[sandbox.KEY]; };

// --- Behind a sync ---------------------------------------------------------
syncHolds();
calls.length = 0;
let res = sandbox.applyQuickMarkFromDialog({ name: 'Joan', optimistic: true });
check('a sync holding the workbook queues the mark', [res.ok, res.queued], [true, true]);
check('without waiting on the lock or writing', calls, ['queue:quickMark:Joan']);

calls.length = 0;
lockFree = false;
res = sandbox.applyQuickMarkFromDialog({ name: 'Ann' });
check('a caller who is waiting is never silently queued', [res.ok, !!res.queued, calls], [false, false, ['lock']]);

// --- A free workbook -------------------------------------------------------
free();
lockFree = true;
calls.length = 0;
res = sandbox.applyQuickMarkFromDialog({ name: 'Joan', optimistic: true });
check('a free workbook writes at once', [res.ok, !!res.queued, calls], [true, false, ['lock', 'write:Joan']]);

// --- A lock that timed out with no lease -----------------------------------
lockFree = false;
calls.length = 0;
res = sandbox.applyQuickMarkFromDialog({ name: 'Bea', optimistic: true });
check('a timed-out wait queues too, and mails nobody', [res.queued, calls], [true, ['lock', 'queue:quickMark:Bea']]);

// --- The flush at the end of a slice ---------------------------------------
let rounds = [{ ok: true, applied: 25, pending: 10 }, { ok: true, applied: 10, pending: 0 }];
sandbox.__stub('flushOptimisticRetryQueue', () => { calls.push('flush'); return rounds.shift(); });
calls.length = 0;
sandbox.flushDeskWritesAfterSync();
check('the flush writes batch after batch, then the door queue', calls, ['flush', 'flush', 'door']);

rounds = [{ ok: false, applied: 0, pending: 7, busy: true }];
calls.length = 0;
sandbox.flushDeskWritesAfterSync();
check('a busy lock stops it and keeps the trigger armed', calls, ['flush', 'arm', 'door']);

// --- The retry trigger -----------------------------------------------------
syncHolds();
calls.length = 0;
sandbox.flushOptimisticRetryQueueTrigger();
check('the trigger does not wait on a lock a sync holds', calls, ['arm']);
free();

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall passed');
