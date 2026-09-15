// AN OPTIMISTIC WRITE THAT DID NOT LAND IS TRIED AGAIN BEFORE ANYBODY IS MAILED.
//
// Quick Mark and the door app both answer before they write, so a refusal has
// nobody looking at it. The old answer was to mail the office at once; the
// commonest refusal by far is the workbook being mid-sync, which is a mark that
// would go through two minutes later. What is pinned here: the failure is
// queued rather than mailed, a retry that succeeds drops it silently, a busy
// lock costs no try, and the mail still happens once the retries are spent.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let props = {};
let triggers = [];
let lockHeld = false;
let urgent = [];
let quickMarkResults = [];
let doorResults = [];
let quickMarkCalls = [];

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (props[k] === undefined ? null : props[k]),
      setProperty: (k, v) => { props[k] = String(v); },
      setProperties: o => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); },
      deleteProperty: k => { delete props[k]; },
      getKeys: () => Object.keys(props)
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: {
    getScriptLock: () => ({ tryLock: () => !lockHeld, releaseLock: () => {} }),
    getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} })
  },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {
    newTrigger: fn => ({ timeBased: () => ({ after: () => ({ create: () => { triggers.push(fn); } }) }) }),
    getProjectTriggers: () => triggers.map(fn => ({ getHandlerFunction: () => fn })),
    deleteTrigger: t => { triggers = triggers.filter(fn => fn !== t.getHandlerFunction()); }
  },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.queueOptimisticRetry = queueOptimisticRetry;
this.flushOptimisticRetryQueue = flushOptimisticRetryQueue;
this.readCheckInList = readCheckInList;
this.OPTIMISTIC_RETRY_PROP_KEY = OPTIMISTIC_RETRY_PROP_KEY;
this.OPTIMISTIC_RETRY_MAX_TRIES = OPTIMISTIC_RETRY_MAX_TRIES;
this.OPTIMISTIC_RETRY_HANDLER = OPTIMISTIC_RETRY_HANDLER;
this.reportOptimisticQuickMarkFailure = reportOptimisticQuickMarkFailure;
// The three collaborators this file stands on, replaced so the test drives
// what the writers answer rather than standing a whole workbook up.
isDeskWorkBlocked = function () { return false; };
notifyAdminUrgent = function (subject, body) { __urgent(subject, body); };
applyQuickMarkLocked = function (args) { __quickMarkCall(args); return __quickMarkResult(); };
walkInSignIn = function (args) { __doorCall(args); return __doorResult(); };
householdCompanionsOf = function () { return []; };
`, sandbox, { filename: 'program.gs' });

sandbox.__urgent = (s, b) => urgent.push({ subject: s, body: b });
sandbox.__quickMarkCall = a => quickMarkCalls.push(a);
sandbox.__quickMarkResult = () => quickMarkResults.shift() || { ok: false, message: 'still busy' };
sandbox.__doorCall = () => {};
sandbox.__doorResult = () => doorResults.shift() || { ok: false, message: 'still busy' };

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + name); return; }
  failures++; console.log('FAIL ' + name + '\n     expected ' + e + '\n     actual   ' + a);
}
function reset() {
  props = {}; triggers = []; lockHeld = false; urgent = [];
  quickMarkResults = []; doorResults = []; quickMarkCalls = [];
}
const queued = () => sandbox.readCheckInList(sandbox.OPTIMISTIC_RETRY_PROP_KEY);

// ---------------------------------------------------------------------------
reset();
const failedMark = { optimistic: true, name: 'Joan Coltune', location: 'Narberth', session: 'Lunch' };
sandbox.reportOptimisticQuickMarkFailure(failedMark, { ok: false, message: '⏳ The workbook is mid-update' });
check('a failed desk mark is queued, not mailed', [queued().length, urgent.length], [1, 0]);
check('...and a retry is armed', triggers, [sandbox.OPTIMISTIC_RETRY_HANDLER]);
check('...carrying the arguments verbatim', queued()[0].args.name, 'Joan Coltune');

// A mark the desk IS waiting on still answers by returning, as it always did.
reset();
sandbox.reportOptimisticQuickMarkFailure({ name: 'Bob' }, { ok: false, message: 'no' });
check('a non-optimistic mark is neither queued nor mailed', [queued().length, urgent.length], [0, 0]);

// The walk-in question is not a failure.
reset();
sandbox.reportOptimisticQuickMarkFailure({ optimistic: true, name: 'Bob' }, { needsConfirm: true });
check('the walk-in question is not queued', queued().length, 0);

// ---------------------------------------------------------------------------
reset();
sandbox.reportOptimisticQuickMarkFailure(failedMark, { ok: false, message: 'mid-update' });
quickMarkResults = [{ ok: true, message: 'Marked.' }];
let res = sandbox.flushOptimisticRetryQueue({ waitMs: 1 });
check('a retry that works empties the queue', [res.applied, res.pending], [1, 0]);
check('...and nobody was mailed about it', urgent.length, 0);
check('...and the mark it re-applied is the one that failed',
  quickMarkCalls[0].name, 'Joan Coltune');

// ---------------------------------------------------------------------------
reset();
sandbox.reportOptimisticQuickMarkFailure(failedMark, { ok: false, message: 'mid-update' });
lockHeld = true;
res = sandbox.flushOptimisticRetryQueue({ waitMs: 1 });
check('a busy lock applies nothing', [res.applied, res.busy], [0, true]);
check('...and costs the entry no try', queued()[0].tries, 0);
lockHeld = false;

// ---------------------------------------------------------------------------
reset();
sandbox.reportOptimisticQuickMarkFailure(failedMark, { ok: false, message: 'nobody by that name' });
for (let i = 0; i < sandbox.OPTIMISTIC_RETRY_MAX_TRIES - 1; i++) {
  sandbox.flushOptimisticRetryQueue({ waitMs: 1 });
}
check('a mark that keeps failing is still queued short of the cap',
  [queued().length, urgent.length], [1, 0]);
sandbox.flushOptimisticRetryQueue({ waitMs: 1 });
check('...and on the last try it is reported and dropped',
  [queued().length, urgent.length], [0, 1]);
check('...naming the person', urgent[0].subject.indexOf('Joan Coltune') !== -1, true);
check('...and quoting the first refusal, not just the last',
  urgent[0].body.indexOf('nobody by that name') !== -1, true);

// ---------------------------------------------------------------------------
// The door's sign-in is retried too, and NOT under the script lock — its own
// writer takes that for itself, and a lock held here would refuse it silently.
reset();
sandbox.queueOptimisticRetry('doorSignIn', { name: 'Drew Meiers', location: 'Ashbridge' }, 'mid-update');
check('a door sign-in is queued the same way', queued().length, 1);
lockHeld = true; // would block the desk's half; must not block this one
doorResults = [{ ok: true }];
res = sandbox.flushOptimisticRetryQueue({ waitMs: 1 });
check('...and is applied without the script lock', [res.applied, res.pending], [1, 0]);

console.log(failures === 0 ? '\nAll optimistic-retry checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
