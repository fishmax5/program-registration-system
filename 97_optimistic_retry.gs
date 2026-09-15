// ============================================================================
// 97. AN OPTIMISTIC WRITE THAT DID NOT LAND  (retry, then tell somebody)
// ============================================================================
//
// THREE PLACES IN THIS WORKBOOK ANSWER BEFORE THEY WRITE. Quick Mark's dialog
// draws the mark as done and clears for the next person while the sheet write
// runs underneath (36); the household press does the same for a party (38);
// the door app shows "Signed in" and hands itself back to the name list the
// instant somebody taps Confirm (72/73). All three are right to: a desk with a
// queue at it, and a visitor standing at a tablet, should not wait out a lock
// and a sheet write to find out what they already know.
//
// The cost is that a REFUSAL has nobody looking at it. Each of the three used
// to answer that the same way — mail the office at once (notifyAdminUrgent,
// 15) and let somebody enter it by hand. Which is correct, and is also the
// wrong first move, because the overwhelmingly common failure here is not a
// bad mark: it is the workbook being mid-sync. `withScriptLock` gives up after
// DESK_LOCK_WAIT_MS, the hourly sync holds the lock for rather longer than
// that, and the answer the desk gets is "⏳ The workbook is mid-update" — a
// mark that would have worked perfectly two minutes later. Mailing a person
// about it is asking them to redo something the script could simply do again.
//
// SO IT IS DONE AGAIN. A failed optimistic write is written to a durable queue
// and a one-off trigger is armed OPTIMISTIC_RETRY_DELAY_MS out; the flush
// applies what it can and re-arms for whatever is left, so a mark refused
// during an hour-long import lands on its own as soon as the import is over.
// The office hears nothing in the ordinary case, because in the ordinary case
// there is nothing for anybody to do.
//
// IT IS STILL BOUNDED, and that is not a hedge. "Retry until it works" is the
// right instinct for a busy workbook and the wrong one for a mark that can
// never work — a name nobody registered, a lunch on a date with no lunch. That
// answer will be the same on the two hundredth attempt, and a queue that never
// gives up on it is a registration nobody is ever told about. So a mark is
// retried OPTIMISTIC_RETRY_MAX_TRIES times and then reported exactly as it
// was before this file existed: the urgent mail, with the whole history
// attached. The retries are what got added; nothing was taken away.
//
// WHY NOT THE DOOR'S QUEUE (63), which is this shape already? Because that
// queue carries the door's five fields and this has to carry whatever its
// caller was called with — Quick Mark's args run to meal counts, standing
// places, appointment times and a walk-in confirmation, and a queue that
// dropped any of them would re-apply a different mark from the one the desk
// made. The entries here hold the caller's arguments VERBATIM and a `kind`
// saying which writer they belong to, so what is retried is bit-for-bit what
// failed. The storage underneath is 63's — same chunked properties, same lock,
// same caps — because that part was already right.
//
// Numbered last for the usual reason: never renumber, and this landed after
// 96. Safe there — behavior only, its own constants stand alone, and
// everything it calls (readCheckInList, writeCheckInList, withCheckInQueueLock,
// applyQuickMarkLocked, walkInSignIn, notifyAdminUrgent, isDeskWorkBlocked) is
// a hoisted function declaration, so load order cannot reach it.
// ============================================================================

/** The queue itself. Chunked like 63's, through the same writer. */
const OPTIMISTIC_RETRY_PROP_KEY = 'OPTIMISTIC_RETRY_QUEUE_V1';

/**
 * How long after a failure the first retry runs, and the spacing of every one
 * after it.
 *
 * Two minutes, because the failure this exists for is a lock held by a sync:
 * long enough that the retry is not simply the same collision again, short
 * enough that a mark made at the desk is on the tab before the person who made
 * it has finished with the next visitor.
 */
const OPTIMISTIC_RETRY_DELAY_MS = 2 * 60 * 1000;

/**
 * How many times one entry is retried before the office is told.
 *
 * Twenty at two minutes apart is forty minutes of trying, which comfortably
 * outlasts any sync, import or forms sweep this workbook runs — so anything
 * still failing at the end of it is failing for a reason no amount of waiting
 * will change, and is exactly what the urgent mail is for.
 */
const OPTIMISTIC_RETRY_MAX_TRIES = 20;

/** Entries kept. Newest win when it bites — same rule, same reason, as 63's. */
const OPTIMISTIC_RETRY_MAX = 200;

/** How many are applied under one lock hold. */
const OPTIMISTIC_RETRY_BATCH = 25;

/** The one-off trigger's handler. Named once so arming and clearing agree. */
const OPTIMISTIC_RETRY_HANDLER = 'flushOptimisticRetryQueueTrigger';

/**
 * Takes an optimistic write that has just failed and promises to try it again.
 *
 * Returns true when the retry was queued — which is what lets the three
 * callers below keep their urgent mail as the ELSE branch rather than deleting
 * it: a queue that could not be written (properties unreachable, quota) must
 * fall straight through to telling somebody, because a mark that is neither
 * written nor queued nor reported is a mark that never happened.
 *
 * Never throws. The write it is reporting on has already failed, and a retry
 * queue that fails on top of it must not turn an answer the caller can still
 * show into an exception it cannot.
 */
function queueOptimisticRetry(kind, args, message) {
  try {
    const entry = {
      id: `${new Date().getTime()}-${Math.floor(Math.random() * 1e6)}`,
      at: new Date().getTime(),
      tries: 0,
      kind: String(kind || ''),
      args: args || {},
      // What went wrong the FIRST time, kept whole. When this eventually goes
      // to the office it is the difference between "it did not save" and a
      // reason somebody can act on.
      firstMessage: String(message || '')
    };
    const written = withCheckInQueueLock(() => {
      const queue = readCheckInList(OPTIMISTIC_RETRY_PROP_KEY);
      queue.push(entry);
      return writeCheckInList(OPTIMISTIC_RETRY_PROP_KEY, queue, OPTIMISTIC_RETRY_MAX);
    });
    if (!written) return false;
    armOptimisticRetry();
    log(`queueOptimisticRetry: queued a ${entry.kind} to try again in ` +
      `${Math.round(OPTIMISTIC_RETRY_DELAY_MS / 1000)}s — ${entry.firstMessage}`);
    return true;
  } catch (err) {
    log(`ℹ️ Could not queue an optimistic write for retry (${err}).`);
    return false;
  }
}

/**
 * Exactly one pending retry trigger, OPTIMISTIC_RETRY_DELAY_MS out.
 *
 * Replaced rather than added to: ten marks failing during one sync are ten
 * queue entries and one flush, not ten flushes racing each other for the same
 * lock. One-off triggers also linger in the project after they fire, so the
 * clear is what keeps this from growing into the trigger quota.
 */
function armOptimisticRetry() {
  try {
    clearOptimisticRetryTriggers();
    ScriptApp.newTrigger(OPTIMISTIC_RETRY_HANDLER).timeBased().after(OPTIMISTIC_RETRY_DELAY_MS).create();
  } catch (err) {
    // NOT FATAL, because it is not the only way this queue gets flushed: the
    // door's five-minute pass flushes it too (see flushCheckInQueueTrigger()),
    // so a trigger that could not be created costs the retry a few minutes
    // rather than losing it.
    log(`ℹ️ Could not arm the optimistic-retry trigger (${err}) — the five-minute pass will pick it up.`);
  }
}

/** Drops every pending retry trigger. */
function clearOptimisticRetryTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== OPTIMISTIC_RETRY_HANDLER) return;
    ScriptApp.deleteTrigger(t);
    removed++;
  });
  return removed;
}

/** The trigger's entry point: flush, and re-arm if anything is still waiting. */
function flushOptimisticRetryQueueTrigger() {
  const result = flushOptimisticRetryQueue({ waitMs: SYNC_LOCK_WAIT_MS });
  if (result && result.pending > 0) armOptimisticRetry();
}

/**
 * Applies what the queue holds, and says what is left.
 *
 * SUCCESS DROPS THE ENTRY; anything else counts a try against it and leaves it
 * where it is. A batch is applied under ONE lock hold, for the same reason
 * 63's flush does it: the cost here is the lock, not the writes.
 *
 * Refuses to run at all while the one job that rewrites the registrations tab
 * underneath it is running (isDeskWorkBlocked) — applying a mark by row match
 * against a tab being rebuilt is how a tick lands on somebody else, and the
 * whole point of this file is that waiting is cheap now.
 */
function flushOptimisticRetryQueue(options) {
  const opts = options || {};
  try {
    const queue = readCheckInList(OPTIMISTIC_RETRY_PROP_KEY);
    if (!queue.length) return { ok: true, applied: 0, pending: 0 };
    if (isDeskWorkBlocked()) return { ok: false, applied: 0, pending: queue.length };

    const batch = queue.slice(0, OPTIMISTIC_RETRY_BATCH);
    const waitMs = opts.waitMs === undefined ? DESK_LOCK_WAIT_MS : opts.waitMs;

    // TWO GROUPS, AND THE SPLIT IS NOT COSMETIC. LockService locks are not
    // reentrant, so a writer that takes the script lock ITSELF cannot be called
    // from inside a lock this function is already holding — it would not
    // deadlock, it would do something quieter and worse: tryLock fails, the
    // writer returns its "the workbook is mid-update" refusal, and the entry
    // burns a try against a collision with nobody but us. The door's sign-in
    // (74) is that kind of writer; Quick Mark's locked body (38) is the other,
    // and is only correct WITH the lock held.
    const held = batch.filter(entry => entry.kind !== 'doorSignIn');
    const unheld = batch.filter(entry => entry.kind === 'doorSignIn');

    let outcomes = [];
    if (held.length) {
      const got = withScriptLock(waitMs, () => held.map(entry => {
        try {
          return { entry, result: applyQueuedOptimisticWrite(entry) };
        } catch (err) {
          return { entry, result: { ok: false, message: String(err) } };
        }
      }), null);
      // BUSY IS NOT A TRY. The lock could not be taken, so nothing was
      // attempted and nothing should be counted against an entry's allowance —
      // otherwise a long sync burns the whole retry budget without ever having
      // run a mark. Everything stays queued exactly as it was.
      if (got === null) return { ok: false, applied: 0, pending: queue.length, busy: true };
      outcomes = outcomes.concat(got);
    }
    unheld.forEach(entry => {
      try {
        outcomes.push({ entry, result: applyQueuedOptimisticWrite(entry) });
      } catch (err) {
        outcomes.push({ entry, result: { ok: false, message: String(err) } });
      }
    });

    let applied = 0;
    const done = {};
    const retry = {};
    outcomes.forEach(outcome => {
      const result = outcome.result;
      if (result && result.ok) {
        applied++;
        done[outcome.entry.id] = true;
        log(`flushOptimisticRetryQueue: a ${outcome.entry.kind} that failed at the desk has now been written.`);
        return;
      }
      const message = (result && result.message) || 'It could not be written.';
      const tries = Number(outcome.entry.tries || 0) + 1;
      if (tries >= OPTIMISTIC_RETRY_MAX_TRIES) {
        done[outcome.entry.id] = true;
        reportExhaustedOptimisticRetry(outcome.entry, message, tries);
        return;
      }
      retry[outcome.entry.id] = tries;
    });

    const remaining = withCheckInQueueLock(() => {
      // Re-read inside the lock: something can have been queued while the
      // batch was being applied, and rewriting from a stale copy would drop it.
      const kept = readCheckInList(OPTIMISTIC_RETRY_PROP_KEY)
        .filter(entry => !done[entry.id])
        .map(entry => {
          if (retry[entry.id] !== undefined) entry.tries = retry[entry.id];
          return entry;
        });
      writeCheckInList(OPTIMISTIC_RETRY_PROP_KEY, kept, OPTIMISTIC_RETRY_MAX);
      return kept.length;
    });

    return { ok: true, applied, pending: remaining === null ? queue.length : remaining };
  } catch (err) {
    log(`ℹ️ Could not flush the optimistic-retry queue (${err}) — its entries stay queued.`);
    return { ok: false, applied: 0, pending: 0 };
  }
}

/** One queued write, re-applied. Called with the script lock already held. */
function applyQueuedOptimisticWrite(entry) {
  const args = entry.args || {};
  switch (entry.kind) {
    case 'quickMark':
      return applyQuickMarkLocked(args);
    case 'quickMarkHousehold':
      // The household path holds the lock itself, so the retry applies its
      // members one at a time through the locked writer rather than calling
      // back into a function that would try to take a lock this already has.
      return applyQueuedHouseholdQuickMark(args);
    case 'doorSignIn':
      // Called WITHOUT the script lock held — walkInSignIn() takes it for
      // itself, one mark at a time, through applyQuickMarkFromDialog(). See
      // the split in flushOptimisticRetryQueue().
      return walkInSignIn(args);
    default:
      return { ok: false, message: `Unknown queued write kind "${entry.kind}".` };
  }
}

/** A household press, re-applied member by member under the held lock. */
function applyQueuedHouseholdQuickMark(base) {
  const names = [String(base.name || '').trim()].filter(Boolean);
  householdCompanionsOf(base.name).forEach(m => {
    if (names.indexOf(m.name) === -1) names.push(m.name);
  });
  const messages = [];
  let ok = false;
  names.forEach(name => {
    const one = applyQuickMarkLocked(Object.assign({}, base, { name }));
    if (one && one.ok) ok = true;
    if (one && one.message) messages.push(`${name}: ${one.message}`);
  });
  // ANY member landing counts as the press having worked, which is the same
  // rule applyQuickMarkForHousehold() applies: a companion who is not
  // registered for the session was never going to be marked, and holding the
  // whole party in the queue for them would retry the ones that DID land.
  return { ok, message: messages.join(' ') };
}

/**
 * The retries are spent — so this is where the mail that used to go out
 * immediately finally goes out, with everything that has happened since.
 *
 * URGENT rather than the 10am digest, for the reason it always was: somebody
 * was at the desk or at the door, the screen told them it was done, and it is
 * not. The forty minutes of trying is what makes this message rare enough to
 * still be worth reading — see notifyAdminUrgent() (15) and section 88 on why
 * adding a third urgent caller is a decision and not a detail. This is not a
 * third: it is the same two, moved behind the retries.
 */
function reportExhaustedOptimisticRetry(entry, message, tries) {
  try {
    const args = entry.args || {};
    const what = entry.kind === 'doorSignIn' ? 'A door app sign-in' : 'A mark made at the desk';
    log(`⚠️ Giving up on a queued ${entry.kind} after ${tries} attempt(s): ${message}`);
    notifyAdminUrgent(`Still could not save: ${args.name || '(no name)'}`,
      `${what} was shown as done and then refused, and has been retried ` +
      `${tries} times over the last ${Math.round(tries * OPTIMISTIC_RETRY_DELAY_MS / 60000)} minutes ` +
      `without ever going through. Whoever made it has long since moved on.\n\n` +
      `Name: ${args.name || '(no name)'}\n` +
      `Location: ${args.location || '(none)'}\n` +
      `Session: ${args.session || args.dateKey || '(none chosen)'}\n` +
      `\nWhat the workbook said the first time:\n${entry.firstMessage || '(nothing)'}\n` +
      `\nWhat it said on the last attempt:\n${message}\n\n` +
      'Nothing was written. This one does need entering by hand.');
  } catch (err) {
    log(`ℹ️ Could not report an exhausted optimistic retry (${err}).`);
  }
}
