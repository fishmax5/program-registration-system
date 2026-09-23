// ============================================================================
// 9g. QUIET HOURS  (nothing leaves this workbook between 5pm and 9am)
// ============================================================================
//
// An hourly sync does not know what time it is for the person on the other
// end. A roster alert at 11pm, a reminder at 6am and a fault report at 2am
// are all the same message sent at a time nobody asked to be interrupted —
// and the office is not at the desk to act on any of them anyway.
//
// So there is one window, stated once, and EVERY send in this project is
// checked against it: the rationed mailer (section 9f), the urgent admin
// notice (section 1) and the office's daily digest (section 8h). There is no
// Config cell for it deliberately — this is a fixed house rule, not a setting
// somebody has to discover, and a second switch beside Pause_Outbound_Mail
// would be one more thing to read before answering "why did nothing go out?".
//
// ---------------------------------------------------- HELD, NOT DROPPED
//
// A quiet-hours message is HELD, which is the opposite of what the pause does
// with one (see THE PAUSE in section 9f). Nothing is recorded, so the caller's
// ledger does not advance and the next hourly pass after 9am sends it. That is
// the right answer here and the wrong one for the pause, because the pause
// exists to THROW AWAY churn about registrations that never changed, while
// quiet hours only ever mean "not yet".
//
// Callers therefore need no new branch: it comes back as the 'held' status
// they already have for a message the quota could not afford — not sent, not
// recorded, tried again, no warning, because nothing went wrong.
//
// The office's daily digest is the same: it keeps its spool and goes out on
// the next pass, which its own sweep of every day before today already does.
// notifyAdminUrgent() is the one exception worth naming, and it is not a
// silence either — see quietHoursHoldsUrgentMail().
//
// ------------------------------------------------------- THE BOUNDARIES
//
// The window is read in the WORKBOOK's timezone (TIMEZONE, section 07), not
// the script's, because that is the timezone every date this system prints is
// already in. It is half-open at both ends by the same rule — 17:00 is quiet,
// 09:00 is not — so a trigger firing exactly on the hour has one answer and
// not two.
//
// Numbered 99c, last for the usual reason: behavior only, its two constants stand
// alone, it reads TIMEZONE at CALL time rather than at load time, and its
// three callers reach it through a hoisted function declaration.
// ============================================================================

/** The hour mail stops going out, in the workbook's timezone. 17 = 5pm. */
const MAIL_QUIET_HOURS_START_HOUR = 17;

/**
 * The hour mail may go out again. 9 = 9am. Quiet hours run across midnight.
 * Office rule: email goes out between 9am and 5pm only (it was 8am).
 */
const MAIL_QUIET_HOURS_END_HOUR = 9;

/**
 * Is it now — or at the moment given — inside the quiet window?
 *
 * Never throws: a timezone that cannot be read is not a reason to hold a
 * message that would otherwise have gone, so it falls back to the script's
 * own clock rather than to silence.
 */
function isWithinMailQuietHours(now) {
  // Duck-typed rather than `instanceof Date`, so a date handed in from
  // another realm — a test's sandbox, most of all — is still a date.
  const when = (now && typeof now.getTime === 'function') ? now : new Date();
  let hour;
  try {
    hour = Number(Utilities.formatDate(when, TIMEZONE, 'H'));
  } catch (err) {
    hour = when.getHours();
  }
  if (!(hour >= 0)) return false;
  // The window wraps midnight, so it is a union rather than a range.
  return hour >= MAIL_QUIET_HOURS_START_HOUR || hour < MAIL_QUIET_HOURS_END_HOUR;
}

/** "5:00 PM" / "9:00 AM", for the one sentence every caller says about this. */
function describeMailQuietHours() {
  const label = hour => {
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
  };
  return `${label(MAIL_QUIET_HOURS_START_HOUR)} and ${label(MAIL_QUIET_HOURS_END_HOUR)}`;
}

/** The `error` a held message carries, so a log says WHICH hold this was. */
function mailQuietHoursReason() {
  return `quiet hours — nothing is sent between ${describeMailQuietHours()}`;
}

/**
 * Whether an URGENT admin notice has to wait.
 *
 * Named separately because its callers (a Quick Mark that would not save, a
 * door sign-in that did not complete) cannot retry: there is no ledger and no
 * next pass, so holding one would simply lose it. They file it for the daily
 * digest instead — nobody is at the desk at 2am to act on it, and the digest
 * at ten is when somebody is.
 */
function quietHoursHoldsUrgentMail() {
  return isWithinMailQuietHours();
}
