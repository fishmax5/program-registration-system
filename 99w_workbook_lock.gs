// ============================================================================
// SECTION 99w: THE WORKBOOK LOCK, WHICH DOES NOT LAPSE AT SIX MINUTES
// ============================================================================
//
// Every writer in this project that must not overlap another — both syncs,
// every sliced job, every desk write, every menu repair — took
// `LockService.getScriptLock()` and trusted it for as long as it held it. It
// cannot be trusted that long. Apps Script releases a held script lock on its
// own after about SIX MINUTES (Google issue tracker 365027671), with no
// exception and nothing for `hasLock()` to report, while the execution holding
// it carries on — and a registration sync slice works for up to
// `Sync_Minutes_Per_Run` (25 by default).
//
// That is exactly the 2026-09-25 18:50–19:30 incident, read off the log:
// `syncRegistrations` (oHmUKQ) took the lock at 18:50 and was still importing
// at 18:58 when its own watchdog's `resumeRegistrationSync` (M0TZTM) was
// granted the same lock; at 19:04 `removeDuplicateSessionRows` was granted it
// with BOTH syncs still running and cut the session table from 500 rows to
// 405; M0TZTM then redrew the table from the 500 rows it had read eight minutes
// earlier (19:08, the 95 duplicates back); a third slice (REl-Dw) read the tab
// while that redraw had it empty and wrote it back with nothing in it (19:09,
// "0 upcoming / 0 past"); and every slice after that pushed ~33 program
// registrant sheets from an empty session table. Every one of those grants and
// refusals lines up with a hold that lapsed six minutes after it was taken.
//
// So the lock is now TWO things. The script lock is still taken — it is what
// makes two executions' check-and-claim atomic — but what an execution HOLDS
// is a LEASE in Script Properties (`WORKBOOK_LOCK_LEASE_PROP_KEY`): who holds
// it, since when, and until when. A contender that gets the script lock reads
// the lease first, and a live lease belonging to another execution means the
// workbook is busy exactly as a held lock always meant: it lets go and waits
// out the rest of its `waitMs`. The lease does not lapse while its holder is
// working — `renewWorkbookLease()` pushes its expiry forward from `log()`
// (throttled to one write a minute), from every sliced job's state save and
// from the registration sync's step wrapper, so any execution doing work is
// renewing it — and it DOES lapse `WORKBOOK_LOCK_LEASE_TTL_MS` after its
// holder stops, which is how a run killed at the account's ceiling (no
// `finally`) or cancelled in the editor stops blocking the workbook.
//
// `workbookLock()` has the shape of the Lock it replaces (`tryLock`,
// `waitLock`, `releaseLock`, `hasLock`), which is why every call site changed
// by one word. It is also REENTRANT within an execution, counted: a nested
// acquire returns true at once and a nested release does not let go of the
// outer hold. With the raw script lock a nested `releaseLock()` released the
// OUTER hold too — another way for a long job to lose its lock without saying
// so.
//
// Where Script Properties cannot be read (a test harness without them) this
// degrades to the plain script lock, which is what everything here was before.
// ============================================================================

const WORKBOOK_LOCK_LEASE_PROP_KEY = 'WORKBOOK_LOCK_LEASE_V1';

/** How long a lease outlives its last renewal. See the banner. */
const WORKBOOK_LOCK_LEASE_TTL_MS = 10 * 60 * 1000;

/** Renewals from log() are at most this often: one property write a minute. */
const WORKBOOK_LOCK_RENEW_EVERY_MS = 60 * 1000;

/** How long a contender sleeps between looks at a busy lease. */
const WORKBOOK_LOCK_POLL_MS = 2000;

// Per EXECUTION: Apps Script gives every execution a fresh global scope, so
// these are the execution's own identity and hold count.
let workbookLockExecId_ = null;
let workbookLockDepth_ = 0;
let workbookLockLastRenew_ = 0;
let workbookLockLabel_ = '';

function workbookLockExecId_get_() {
  if (!workbookLockExecId_) {
    try {
      workbookLockExecId_ = Utilities.getUuid();
    } catch (err) {
      workbookLockExecId_ = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }
  return workbookLockExecId_;
}

function workbookLockProps_() {
  try {
    const props = PropertiesService.getScriptProperties();
    return props && typeof props.getProperty === 'function' ? props : null;
  } catch (err) {
    return null;
  }
}

/** The lease as stored, or null. Never throws. */
function readWorkbookLease() {
  const props = workbookLockProps_();
  if (!props) return null;
  try {
    const raw = props.getProperty(WORKBOOK_LOCK_LEASE_PROP_KEY);
    const lease = raw ? JSON.parse(raw) : null;
    return lease && typeof lease === 'object' ? lease : null;
  } catch (err) {
    return null;
  }
}

/** True when `lease` is held by another execution and has not lapsed. Pure. */
function workbookLeaseBlocks(lease, execId, now) {
  if (!lease || !lease.owner) return false;
  if (lease.owner === execId) return false;
  return Number(lease.expiresAt) > now;
}

function writeWorkbookLease_(props, label) {
  const now = Date.now();
  props.setProperty(WORKBOOK_LOCK_LEASE_PROP_KEY, JSON.stringify({
    owner: workbookLockExecId_get_(),
    label: label || '',
    since: now,
    renewedAt: now,
    expiresAt: now + WORKBOOK_LOCK_LEASE_TTL_MS
  }));
  workbookLockLastRenew_ = now;
}

function tryAcquireWorkbookLock_(waitMs, label) {
  if (workbookLockDepth_ > 0) {
    workbookLockDepth_++;
    return true;
  }
  const raw = LockService.getScriptLock();
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  for (;;) {
    const remaining = Math.max(0, deadline - Date.now());
    if (!raw.tryLock(remaining)) return false;

    const props = workbookLockProps_();
    if (!props) {
      workbookLockDepth_ = 1;
      workbookLockLabel_ = label || '';
      return true;
    }
    let blocked = false;
    try {
      blocked = workbookLeaseBlocks(readWorkbookLease(), workbookLockExecId_get_(), Date.now());
      if (!blocked) writeWorkbookLease_(props, label);
    } catch (err) {
      // A lease that cannot be written is not a reason to refuse: the script
      // lock is held, which is everything this project had before.
      blocked = false;
    }
    if (!blocked) {
      workbookLockDepth_ = 1;
      workbookLockLabel_ = label || '';
      return true;
    }

    // Somebody else's live lease: the script lock we just got is one that
    // lapsed under them. Let go and wait out the rest of the budget.
    try { raw.releaseLock(); } catch (err) { /* not held */ }
    const left = deadline - Date.now();
    if (left <= 0) return false;
    try {
      Utilities.sleep(Math.min(WORKBOOK_LOCK_POLL_MS, left));
    } catch (err) {
      return false;
    }
  }
}

function releaseWorkbookLock_() {
  if (workbookLockDepth_ <= 0) return;
  workbookLockDepth_--;
  if (workbookLockDepth_ > 0) return;
  workbookLockLabel_ = '';
  const props = workbookLockProps_();
  if (props) {
    try {
      const lease = readWorkbookLease();
      if (lease && lease.owner === workbookLockExecId_get_()) {
        props.deleteProperty(WORKBOOK_LOCK_LEASE_PROP_KEY);
      }
    } catch (err) {
      // It lapses on its own after the TTL.
    }
  }
  try { LockService.getScriptLock().releaseLock(); } catch (err) { /* lapsed already */ }
}

/**
 * The lock every writer takes. Same shape as Apps Script's Lock:
 *   tryLock(ms)  true when this execution now holds the workbook
 *   waitLock(ms) the same, throwing on a timeout
 *   releaseLock()
 *   hasLock()
 * `label` names the holder in the lease, for "why did nothing happen?" (99g).
 */
function workbookLock(label) {
  let held = false;
  return {
    tryLock: waitMs => {
      if (held) return true;
      held = tryAcquireWorkbookLock_(waitMs, label);
      return held;
    },
    waitLock: waitMs => {
      if (held) return;
      held = tryAcquireWorkbookLock_(waitMs, label);
      if (!held) throw new Error('Lock timeout: another process was holding the workbook lock for too long.');
    },
    releaseLock: () => {
      if (!held) return;
      held = false;
      releaseWorkbookLock_();
    },
    hasLock: () => held
  };
}

/**
 * True when ANOTHER run holds the workbook right now — a live lease that is
 * not ours. One property read and no lock, which is what lets Quick Mark
 * (38) decide to queue a mark without first waiting to be refused. False when
 * the lease cannot be read, so the caller falls back to trying the lock.
 */
function workbookHeldElsewhere() {
  try {
    return workbookLeaseBlocks(readWorkbookLease(), workbookLockExecId_get_(), Date.now());
  } catch (err) {
    return false;
  }
}

/**
 * Who has the workbook, in words: "another run (Sync Registrations, since
 * 3:12 PM)". A message that says "a sync" when the holder was a retry flush
 * or a menu repair sends somebody looking for a sync that is not there.
 * Never throws.
 */
function workbookHolderPhrase_() {
  try {
    const lease = readWorkbookLease();
    if (!lease || !lease.owner) return 'another run';
    const label = String(lease.label || '').trim() || 'an unnamed run';
    let since = '';
    try {
      since = Utilities.formatDate(new Date(Number(lease.since)), TIMEZONE, 'h:mm a');
    } catch (err) { since = ''; }
    return `another run (${label}${since ? `, since ${since}` : ''})`;
  } catch (err) {
    return 'another run';
  }
}

/** True while this execution holds the workbook lock. */
function holdsWorkbookLock() {
  return workbookLockDepth_ > 0;
}

/**
 * Push this execution's lease expiry forward. A no-op unless it holds the
 * lock; throttled unless `force`. Never throws — it is called from log().
 */
function renewWorkbookLease(force) {
  if (workbookLockDepth_ <= 0) return;
  const now = Date.now();
  if (!force && now - workbookLockLastRenew_ < WORKBOOK_LOCK_RENEW_EVERY_MS) return;
  workbookLockLastRenew_ = now;
  const props = workbookLockProps_();
  if (!props) return;
  try {
    const lease = readWorkbookLease();
    // Somebody took it over after it lapsed (a holder that went quiet for
    // longer than the TTL). Do not steal it back; say so once.
    if (lease && lease.owner && lease.owner !== workbookLockExecId_get_() && Number(lease.expiresAt) > now) {
      if (ENABLE_LOGGING) {
        console.log(`⚠️ The workbook lock held by this run (${workbookLockLabel_ || 'unnamed'}) lapsed and ` +
          `was taken by "${lease.label || 'another run'}" — two runs may now overlap.`);
      }
      return;
    }
    props.setProperty(WORKBOOK_LOCK_LEASE_PROP_KEY, JSON.stringify({
      owner: workbookLockExecId_get_(),
      label: workbookLockLabel_ || (lease && lease.label) || '',
      since: (lease && lease.owner === workbookLockExecId_get_() && lease.since) || now,
      renewedAt: now,
      expiresAt: now + WORKBOOK_LOCK_LEASE_TTL_MS
    }));
  } catch (err) {
    // Next renewal will try again.
  }
}

/**
 * For "why did nothing happen?" (99g): a sentence about a live lease held by
 * another run, or '' when there is none.
 */
function describeWorkbookLease() {
  const lease = readWorkbookLease();
  const now = Date.now();
  if (!workbookLeaseBlocks(lease, workbookLockExecId_get_(), now)) return '';
  const mins = n => Math.max(0, Math.round(n / 60000));
  return `The workbook is held by ${lease.label ? `"${lease.label}"` : 'another run'} ` +
    `(taken ${mins(now - Number(lease.since || now))} min ago, last active ` +
    `${mins(now - Number(lease.renewedAt || now))} min ago; it frees itself ` +
    `${mins(Number(lease.expiresAt) - now)} min after that run goes quiet).`;
}

/** Escape hatch for a lease left by a run cancelled in the editor. */
function clearWorkbookLease() {
  const props = workbookLockProps_();
  if (!props) return false;
  try {
    props.deleteProperty(WORKBOOK_LOCK_LEASE_PROP_KEY);
    return true;
  } catch (err) {
    return false;
  }
}
