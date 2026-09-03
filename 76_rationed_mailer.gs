// ============================================================================
// 9f. THE RATIONED MAILER  (one send, one quota, one bad-address rule)
// ============================================================================
//
// Two passes in this workbook send mail to people outside it — the roster
// alerts (section 9d) and the registrant reminders (section 9e) — and they
// each grew the same four pieces of plumbing around MailApp.sendEmail:
// ask what quota is left, add the archive BCC, send, and record it so the
// next hourly sync does not send it again. Two copies of that is two places
// for the same bug, and they had already drifted: one counted a refused
// address against the run, the other retried it once per message.
//
// So the plumbing lives here, once, and NOTHING ELSE DOES. What to say, who
// to say it to, how often, and how many of a scarce hundred messages this
// particular pass may spend are decisions that differ per caller and stay in
// 66 and 70 with the rest of their policy. This file knows only how to put
// one message on the wire without spending somebody else's quota.
//
// ------------------------------------------------------------- THE QUOTA
//
// MailApp allows 100 messages a day on a consumer account and 1500 on
// Workspace. It is a real, shared, daily resource: a message spent here is
// not available to the pass that runs next hour, or to the one that runs
// twenty lines later in the same execution.
//
// BOTH PASSES RUN IN ONE EXECUTION, roster alerts first (see
// syncRegistrationsInternal), so the first one is in a position to take
// everything the second one needed. Two things stop it:
//
//   1. ONE ESTIMATE, SHARED. The remaining quota is read once per execution
//      and decremented as messages go out, so the reminder pass starts from
//      what the alert pass actually left rather than from its own hopeful
//      re-read. A BCC is its own message against the same allowance, so it
//      is counted at two, not one.
//
//   2. EACH CALLER NAMES A FLOOR IT WILL NOT DIG BELOW (`reserve`), and the
//      pass that runs first names a floor high enough to leave the second one
//      a working share — see LEADER_ALERT_QUOTA_RESERVE, which is why it is
//      not the same number as REMINDER_QUOTA_RESERVE. Under both floors sits
//      the handful of messages notifyAdmin() needs.
//
// notifyAdmin() deliberately does NOT come through here. It is one message to
// one address saying something went wrong — quite possibly that mail is over
// quota — and rationing the message that reports the shortage is exactly
// backwards. It is small, it is rare, and it is what the floors are for.
//
// ------------------------------------------------- AN ADDRESS THAT IS REFUSED
//
// When MailApp refuses an address it will refuse it the same way in ten
// seconds and the same way tomorrow, so the second attempt is a wasted
// message off a quota somebody else could have used. A refusal is remembered
// for the rest of the execution and every later message to that address is
// suppressed without a send — which matters most to the reminder pass, where
// one person can be due three messages about two sessions.
//
// It is remembered for the EXECUTION and no longer. A refusal is not proof
// the address is bad — an over-quota send throws too — and a suppression list
// that outlived the run would need a way to forgive an address that was only
// ever the victim of a bad afternoon.
//
// -------------------------------------------------------------- THE LEDGER
//
// A send is recorded only once it is actually away. That is the invariant the
// hourly sync depends on in both directions: a message recorded before it is
// sent is a message nobody ever gets and nothing ever retries, and a message
// sent without being recorded is a message the next sync sends again.
//
// The ledgers THEMSELVES stay with their callers, and there are still two of
// them, under the keys they have always had. They are not the same shape —
// one stores a roster snapshot per program, the other a set of stamps per
// event — and a single writer is no reason to invent a third shape that both
// would have to be migrated into.
//
// ------------------------------------------------------ WHY IT IS NUMBERED 74
//
// Last, like everything else that is behavior only. It defines two constants
// nothing else derives from, reads no other file's constants at load time,
// and its callers reach it through a hoisted function declaration, which
// works whatever order the project's files are evaluated in.
// ============================================================================

/**
 * What to assume is left when MailApp cannot be ASKED what is left.
 *
 * The quota call itself can throw — an authorization scope not yet granted,
 * most often on the very first run after a deploy — and refusing to send
 * anything because we could not ask would turn a permissions hiccup into
 * silence. So it assumes the smaller of the two real allowances, which leaves
 * each caller free to send up to its own per-run cap. A genuinely over-quota
 * send throws on the send instead, which is handled.
 */
const RATIONED_MAIL_ASSUMED_QUOTA = 100;

/** The reason string a suppressed message carries when the refusal is unknown. */
const RATIONED_MAIL_REFUSED_REASON = 'the address was refused earlier in this run';

/** The shared estimate, and the addresses this run has stopped trying. */
let __rationedMailQuota = null;
let __rationedMailRefused = {};

/**
 * How many more messages MailApp will accept today, as this execution
 * understands it: read once, then decremented by what actually goes out.
 *
 * Read once rather than per send because every caller in one execution is
 * spending from the same allowance, and because a per-send round trip to ask
 * would cost more than it saves.
 */
function rationedMailRemainingQuota() {
  if (__rationedMailQuota !== null) return __rationedMailQuota;
  try {
    const remaining = MailApp.getRemainingDailyQuota();
    __rationedMailQuota = typeof remaining === 'number'
      ? remaining : RATIONED_MAIL_ASSUMED_QUOTA;
  } catch (err) {
    log(`ℹ️ Could not read the remaining mail quota (${err}) — sending up to the per-run cap anyway.`);
    __rationedMailQuota = RATIONED_MAIL_ASSUMED_QUOTA;
  }
  return __rationedMailQuota;
}

/**
 * Forgets the shared estimate and the refused addresses.
 *
 * For a test, and for the menu entries that run a pass by hand: those are
 * separate executions in production, but nothing stops two of them sharing
 * one in a script that calls both.
 */
function resetRationedMailState() {
  __rationedMailQuota = null;
  __rationedMailRefused = {};
}

/**
 * Sends one message, if the day's quota can afford it and the address has not
 * already been refused this run.
 *
 * `request` is:
 *   to           the recipient. Required.
 *   subject      }
 *   body         } plain text — see buildRegistrantReminderBody() for why.
 *   reserve      the floor this caller will not dig the day's quota below.
 *   archiveCopy  false to send to `to` alone. Otherwise the configured archive
 *                address is BCC'd — BCC and not CC, because these messages
 *                tell one person about their own registration and a visible
 *                office address on them invites a reply-all thread nobody at
 *                the desk wants. Blank in Config means copy nobody.
 *   alreadySent  optional () => boolean: the caller's ledger, consulted before
 *                the send. A caller may well have checked it already; this is
 *                the check that is guaranteed to have run.
 *   recordSent   optional () => void: called ONLY after the message is away.
 *
 * Returns { status, cost, error } where status is one of:
 *   'sent'        it went. `cost` is what it took off the quota.
 *   'duplicate'   alreadySent() said this one has already gone. Nothing spent.
 *   'held'        sending it would have crossed the caller's reserve.
 *   'suppressed'  this address was refused earlier in this run.
 *   'failed'      MailApp refused it, `error` says how. The address is
 *                 suppressed for the rest of the run.
 *
 * Never throws: every caller is a pass that rides the hourly sync, and a mail
 * problem must not be able to fail a run that imported every registration
 * correctly. The caller decides what a status other than 'sent' means for its
 * own bookkeeping — which is why nothing here writes a ledger entry, logs a
 * warning, or notes anything for the admin on a message that did not go.
 */
function sendRationedEmail(request) {
  const req = request || {};
  const result = { status: 'failed', cost: 0, error: null };

  const to = String(req.to === null || req.to === undefined ? '' : req.to).trim();
  if (!to) {
    result.error = 'no address to send to';
    return result;
  }

  if (typeof req.alreadySent === 'function' && req.alreadySent()) {
    result.status = 'duplicate';
    return result;
  }

  const refusedKey = to.toLowerCase();
  if (__rationedMailRefused[refusedKey]) {
    result.status = 'suppressed';
    result.error = __rationedMailRefused[refusedKey];
    return result;
  }

  const archiveCopy = req.archiveCopy === false
    ? '' : String(getArchiveCopyEmail() || '').trim();
  // A BCC'd recipient costs its own message against the same daily quota this
  // is rationing, so it is counted rather than treated as free.
  const cost = archiveCopy ? 2 : 1;
  const reserve = Number(req.reserve) || 0;
  if (rationedMailRemainingQuota() - cost < reserve) {
    result.status = 'held';
    result.error = 'the daily mail quota';
    return result;
  }

  const options = {
    to,
    subject: String(req.subject === null || req.subject === undefined ? '' : req.subject),
    body: String(req.body === null || req.body === undefined ? '' : req.body)
  };
  if (archiveCopy) options.bcc = archiveCopy;

  try {
    MailApp.sendEmail(options);
  } catch (err) {
    // Not counted against the quota: a message MailApp would not take is a
    // message it did not send. Remembered, so the next one to this address
    // costs nothing at all.
    __rationedMailRefused[refusedKey] = String(err) || RATIONED_MAIL_REFUSED_REASON;
    result.error = err;
    return result;
  }

  __rationedMailQuota = Math.max(0, rationedMailRemainingQuota() - cost);
  result.status = 'sent';
  result.cost = cost;
  // AFTER the send and not before: a ledger entry written first is a message
  // nobody receives and nothing retries.
  if (typeof req.recordSent === 'function') req.recordSent();
  return result;
}
