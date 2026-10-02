// DELETE REGISTRATIONS (48): THE LEDGER IS TOLD, AND A SYNC QUEUES IT.
//
//   Every deleted row gets a `removed` entry, source `delete-sessions`, and
//   the ledger is flushed BEFORE the tombstones and the render.
//   A sync holding the workbook queues the deletion (kind deleteRegistrations)
//   without touching the lock or the tab, after the admin and confirm checks.
//   A lock that times out queues too.
//   The queued entry, replayed by 99b, deletes and files a digest line.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString(), getUuid: () => 'u', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key in props ? props[key] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: name => ({ name }), getSpreadsheetTimeZone: () => 'America/New_York' }),
    getActive: () => null, getUi: () => { throw new Error('no ui'); }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }),
    getActiveUser: () => ({ getEmail: () => 'admin@x.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.deleteRegistrationsForSessions = deleteRegistrationsForSessions;
this.applyQueuedOptimisticWrite = applyQueuedOptimisticWrite;
this.HEADERS = HEADERS;
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

const headers = sandbox.HEADERS.All_Registrants;
const col = name => headers.indexOf(name);
function row(eventId, name) {
  const r = headers.map(() => '');
  r[col('Event_ID')] = eventId;
  r[col('Name')] = name;
  r[col('Person_Type')] = 'Registrant';
  return r;
}

const calls = [];
const entries = [];
let lockFree = true;
let queued = null;
sandbox.__stub('isAuthorizedAdmin', () => true);
sandbox.__stub('getSectionedRows', () => [row('E1', 'Joan'), row('E1', 'Ann'), row('E2', 'Bob')]);
sandbox.__stub('ledgerIdForRegistrantRow', r => `R-${r[col('Name')]}`);
sandbox.__stub('appendLedgerEntry', e => { entries.push(e); calls.push('append'); });
sandbox.__stub('flushLedger', () => { calls.push('flush'); return entries.length; });
sandbox.__stub('recordRegistrantTombstones', rows => { calls.push(`tomb:${rows.length}`); });
sandbox.__stub('renderRegistrantsSheet', (f, keep) => { calls.push(`render:${keep.length}`); });
sandbox.__stub('recomputeEventRegistryCounts', () => { calls.push('counts'); });
sandbox.__stub('updateMasterLunchDashboard', () => {});
sandbox.__stub('spoolOfficeNote', (section, msg) => { calls.push(`digest:${section}`); });
sandbox.__stub('queueOptimisticRetry', (kind, args) => { queued = { kind, args }; calls.push(`queue:${kind}`); return true; });
sandbox.__stub('workbookLock', () => ({
  tryLock: () => { calls.push('lock'); return lockFree; },
  releaseLock: () => {}
}));

// --- Free workbook: deletes, ledger first ----------------------------------
let msg = sandbox.deleteRegistrationsForSessions(['E1'], { confirm: 'delete' });
check('deletes the two rows on E1', /Deleted 2 registration/.test(msg), true);
check('ledger appended and flushed before tombstones and render',
  calls, ['lock', 'append', 'append', 'flush', 'tomb:2', 'render:1', 'counts']);
check('entries are `removed` from delete-sessions',
  entries.map(e => [e.kind, e.source, e.registrationId]),
  [['removed', 'delete-sessions', 'R-Joan'], ['removed', 'delete-sessions', 'R-Ann']]);

// --- A sync holds the lease: queued, nothing touched -----------------------
calls.length = 0; entries.length = 0;
props[sandbox.KEY] = JSON.stringify({ owner: 'sync', label: 'Registration sync', since: Date.now(),
  renewedAt: Date.now(), expiresAt: Date.now() + 600000 });
msg = sandbox.deleteRegistrationsForSessions(['E1', 'E2'], { confirm: 'DELETE', alsoDeleteResponses: true });
check('behind a sync it is queued without the lock or the tab', calls, ['queue:deleteRegistrations']);
check('the answer says queued', msg.indexOf('⏳') === 0, true);
check('queued args', [queued.args.eventIds, queued.args.alsoDeleteResponses], [['E1', 'E2'], true]);

// --- Checks still come first ------------------------------------------------
calls.length = 0;
msg = sandbox.deleteRegistrationsForSessions(['E1'], { confirm: 'nope' });
check('a wrong confirm word is refused, not queued', [msg.indexOf('⚠️') === 0, calls], [true, []]);
delete props[sandbox.KEY];

// --- Lock timeout with no lease visible: queued too -------------------------
calls.length = 0; lockFree = false;
msg = sandbox.deleteRegistrationsForSessions(['E2'], { confirm: 'DELETE' });
check('a lock that times out queues', calls, ['lock', 'queue:deleteRegistrations']);
lockFree = true;

// --- The queue replays it ---------------------------------------------------
calls.length = 0; entries.length = 0;
const res = sandbox.applyQueuedOptimisticWrite({ kind: 'deleteRegistrations',
  args: { eventIds: ['E2'], alsoDeleteResponses: false, requestedBy: 'admin@x.org' } });
check('replayed deletion succeeds', [res.ok, /Deleted 1 registration/.test(res.message)], [true, true]);
check('replay appends, tombstones, renders and files a digest line',
  calls, ['append', 'flush', 'tomb:1', 'render:2', 'counts', 'digest:Registrations deleted']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
