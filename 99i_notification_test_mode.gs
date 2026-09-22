// ============================================================================
// 99i. NOTIFICATION TEST MODE  (what would we say, said to us instead)
// ============================================================================
//
// Numbered after `99h` for the usual reason — never renumber, and this landed
// last. Safe there: behavior only, its own four constants stand alone, it
// declares no schema, and everything it reaches for — `isNotificationTestMode`
// / `getAllAdminNotificationEmails` / `CONFIG_LAYOUT` (`15`, `04`),
// `spoolOfficeNote` (`88`), `formatDateLabel` (`07`) — it reads at CALL time or
// through a hoisted function declaration. Its two callers, `76`'s one send and
// `33`'s guest list, reach it the same way.
//
// THE QUESTION THE OTHER TWO SWITCHES CANNOT ANSWER is "what would this
// workbook say to people if I let it?". `Pause_Outbound_Mail` stops the mail
// and DISCARDS it, so all you learn is that nothing went out;
// `Automation_Enabled` stops the syncs, so there is nothing to look at at all.
// Neither shows you the reminder a member would have read, in the words they
// would have read it in, addressed to the address it was going to.
//
// So: every message that would leave the organization is READDRESSED to the
// office's own Admin Notification Emails table, with the real To / Cc / Bcc,
// the real subject, and what sent it printed in a block above the original
// body. Nothing else about the message is touched — the body underneath the
// block is byte-for-byte what the member would have received, because a
// rehearsal that paraphrases is a rehearsal of the paraphrase.
//
// THREE RULES, AND EACH OF THEM IS A DELIBERATE DIFFERENCE FROM THE PAUSE:
//
//   1. THE LEDGER DOES NOT ADVANCE. `sendRationedEmail()` calls `recordSent()`
//      for a PAUSED message, on purpose — the churn a pause exists for must
//      never arrive late. A test is the opposite promise: turn the switch off
//      and the member still gets the reminder they were always owed. So the
//      diverted copy is a copy, and the real message is still outstanding.
//
//   2. BECAUSE OF (1), IT IS CAPPED PER RUN. A ledger that does not advance
//      means the same messages divert again on the next hourly pass, so an
//      unbounded test mode left on overnight is a hundred copies of the same
//      twelve reminders and a spent daily quota. Past the cap this stops
//      diverting and files ONE line saying how many more there were.
//
//   3. CALENDAR INVITATIONS ARE HELD TOO, which the pause does not do: Google
//      emails a guest the moment they are added to an event, so a test mode
//      that left `33` alone would notify exactly the people it promised not to.
//      A held invitation is a digest line naming who would have been added to
//      what — the event's guest list is not touched, so nothing has to be
//      undone afterwards.
//
// WHAT IT IS NOT FOR. It is not a privacy control and not a way to run the
// workbook quietly for a week: it puts every member's name, address and
// reminder into the office's inbox by design. It is a switch somebody turns on,
// reads, and turns off.
// ============================================================================

/**
 * How many diverted copies one run may send.
 *
 * Twelve, because the point is to READ them: a rehearsal that fills an inbox is
 * one nobody gets to the end of, and the reminders this diverts are the same
 * few shapes over and over (a roster alert, a day-before digest, a
 * confirmation). Past this the count is filed instead — which is also the line
 * that tells somebody the switch is still on.
 */
const NOTIFICATION_TEST_MODE_MAX_PER_RUN = 12;

/** What marks a diverted subject line. Kept short: it is read in a list. */
const NOTIFICATION_TEST_SUBJECT_PREFIX = '[TEST] ';

/** The digest section every held invitation and every overflow line is filed under. */
const NOTIFICATION_TEST_DIGEST_SECTION = 'Notification test mode (nothing reached anybody)';

/** Per-execution counters. Reset by the execution, like every other cache here. */
let __notificationTestDiverted = 0;
let __notificationTestSuppressed = 0;
let __notificationTestHeldInvites = 0;
let __notificationTestReported = false;
let __notificationTestCapReported = false;

// ---------------------------------------------------------------------------
// 99i-a. The one message
// ---------------------------------------------------------------------------

/**
 * The office's addresses, as one comma-joined `to`, or '' when the table is
 * empty — which is the one case that cannot be diverted anywhere.
 *
 * EVERY address in the table, ticked or not, exactly like the daily digest
 * (`88`): the per-category ticks answer "who wants to hear about registrant
 * reminders", and this is not that question. Somebody rehearsing wants what
 * they asked for, and they asked for it on the Config tab.
 */
function notificationTestRecipients() {
  try {
    return getAllAdminNotificationEmails().join(',');
  } catch (err) {
    log(`⚠️ Notification test mode: could not read the office's addresses (${err}).`);
    return '';
  }
}

/**
 * The block that goes above the original body. It is the whole point of the
 * mode, so it states what an ordinary "[Office copy]" line cannot: where this
 * was going, what it was going to say it was, and that nothing was consumed.
 *
 * Bcc is named in full rather than counted. A Bcc'd office list is the thing
 * most likely to be wrong, and "3 addresses" is not something anybody can check.
 */
function describeDivertedNotification(req, realTo) {
  const lines = [
    '🧪 NOTIFICATION TEST MODE — this message was NOT sent to the person below.',
    '',
    `To:      ${realTo}`
  ];
  const cc = String((req && req.cc) || '').trim();
  if (cc) lines.push(`Cc:      ${cc}`);
  const bcc = normalizeBccList(req && req.bcc);
  if (bcc.length > 0) lines.push(`Bcc:     ${bcc.join(', ')}`);
  lines.push(`Subject: ${String((req && req.subject) || '')}`);
  if (req && req.describeRecipient) lines.push(`Who:     ${req.describeRecipient}`);
  if (req && req.label) lines.push(`Sent by: ${req.label}`);
  lines.push(`When:    ${formatDateLabel(new Date())} ${Utilities.formatDate(new Date(), TIMEZONE, 'h:mm a')}`);
  lines.push('');
  lines.push('NOTHING WAS CONSUMED — the real message is still owed. Set ' +
    `${CONFIG_LAYOUT.TEST_MAIL.title} back to "No" on the Config tab and it goes out on the next pass.`);
  lines.push('');
  lines.push('──────── the message itself, exactly as it would have been read ────────');
  lines.push('');
  return lines.join('\n');
}

/**
 * The diverted form of one send, or null when this run has diverted enough
 * already (see NOTIFICATION_TEST_MODE_MAX_PER_RUN) or the office has no
 * addresses to divert to.
 *
 * Returns a NEW request rather than mutating the caller's: `76` keeps the
 * original to say who the message was for in its own log line, and a diverted
 * copy that had quietly rewritten `to` would make that line a lie.
 */
function divertNotificationForTest(request) {
  const req = request || {};
  const realTo = String(req.to === null || req.to === undefined ? '' : req.to).trim();
  const office = notificationTestRecipients();
  if (!office) {
    log('⚠️ Notification test mode is on, but no office addresses are on the Config tab — nothing sent.');
    return null;
  }
  if (__notificationTestDiverted >= NOTIFICATION_TEST_MODE_MAX_PER_RUN) {
    __notificationTestSuppressed++;
    noteNotificationTestCapOnce_();
    return null;
  }
  __notificationTestDiverted++;
  noteNotificationTestModeOnce_();
  return {
    to: office,
    subject: NOTIFICATION_TEST_SUBJECT_PREFIX +
      String(req.subject === null || req.subject === undefined ? '' : req.subject),
    body: describeDivertedNotification(req, realTo) +
      String(req.body === null || req.body === undefined ? '' : req.body)
  };
}

// ---------------------------------------------------------------------------
// 99i-b. The invitation that is also an email
// ---------------------------------------------------------------------------

/**
 * Called from `33` instead of `event.addGuest(email)` while the switch is on.
 *
 * The guest list is NOT touched, which is what makes this safe to leave on and
 * safe to turn off: there is nothing to un-invite afterwards, and the next
 * ordinary pass adds the guest for real. One digest line per person per event,
 * coalesced by `spoolOfficeNote` like everything else the office is told.
 */
function recordHeldCalendarInvite(email, session) {
  __notificationTestHeldInvites++;
  noteNotificationTestModeOnce_();
  const where = session
    ? `${String(session.title || 'a session')} on ${session.date ? formatDateLabel(session.date) : 'an unknown date'}`
    : 'a session';
  try {
    spoolOfficeNote(NOTIFICATION_TEST_DIGEST_SECTION,
      `Calendar invitation HELD: ${email} would have been invited to ${where}. ` +
      'Google emails a guest as soon as they are added, so the guest list was left alone.');
  } catch (err) {
    log(`ℹ️ Notification test mode: could not file a held invitation (${err}).`);
  }
  log(`🧪 Held calendar invitation for ${email} (${where}).`);
}

// ---------------------------------------------------------------------------
// 99i-c. Saying the switch is on
// ---------------------------------------------------------------------------

/**
 * ONCE PER EXECUTION, on the first thing this mode holds back — the same shape
 * the pause's own notice takes (`76`), and for the same reason: the line that
 * stops a switch somebody meant to press once from being left on for a
 * fortnight has to be written by the run that is being diverted, not by a
 * summary somebody has to remember to call.
 *
 * Filed for the daily digest rather than sent at once: the diverted copies are
 * already arriving in that same inbox, and an immediate second message about
 * them is the noise `88` exists to stop.
 */
function noteNotificationTestModeOnce_() {
  if (__notificationTestReported) return;
  __notificationTestReported = true;
  const message = 'Notification test mode is ON. Nothing this workbook sends is reaching a member, a ' +
    'program leader or a calendar guest — every message is being diverted to the office instead, and ' +
    'nothing is being consumed: the real ones are still owed and go out on the next pass once this is ' +
    `off. Set ${CONFIG_LAYOUT.TEST_MAIL.title} back to "No" when you have read what you came for.`;
  try {
    spoolOfficeNote(NOTIFICATION_TEST_DIGEST_SECTION, message);
  } catch (err) {
    log(`ℹ️ Notification test mode: could not file the "switch is on" line (${err}).`);
  }
  log(`🧪 ${message}`);
}

/**
 * ONCE PER EXECUTION, when the per-run cap is first reached. A separate line
 * from the one above because it answers a different question — "did I see
 * everything?" — and because a run that hits the cap is a run somebody should
 * read differently.
 */
function noteNotificationTestCapOnce_() {
  if (__notificationTestCapReported) return;
  __notificationTestCapReported = true;
  const message = `More than ${NOTIFICATION_TEST_MODE_MAX_PER_RUN} messages would have gone out this ` +
    'run, so the rest were not diverted — what arrived is a sample, not the whole of it. Nothing was ' +
    'sent to anybody and nothing was consumed, so the same messages divert again on the next pass.';
  try {
    spoolOfficeNote(NOTIFICATION_TEST_DIGEST_SECTION, message);
  } catch (err) {
    log(`ℹ️ Notification test mode: could not file the cap line (${err}).`);
  }
  log(`🧪 ${message}`);
}

/** What this execution held back, for a log line and for the tests. */
function notificationTestModeTally() {
  return {
    diverted: __notificationTestDiverted,
    suppressed: __notificationTestSuppressed,
    heldInvites: __notificationTestHeldInvites
  };
}
