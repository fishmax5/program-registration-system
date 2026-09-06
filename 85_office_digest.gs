// ============================================================
// 85. THE OFFICE'S DAILY DIGEST
// ============================================================
/**
 * ONE MESSAGE A DAY INSTEAD OF A COPY OF EVERY SEND.
 *
 * Config's Admin Notification Emails table says who in the office is copied
 * on what (see ADMIN_NOTIFICATION_CATEGORIES). The ticks are unchanged; what
 * changed is WHEN the copy arrives. A tick used to mean "put a copy of each
 * one in my inbox as it goes": a BCC on every leader roster alert, a BCC on
 * every registrant reminder, a message per sync about the calendar
 * invitations. A busy week is several hundred of those, which is the same as
 * telling the office nothing — nobody at the desk can find the one that
 * matters in it.
 *
 * A tick now means "tell me once a day what went out". Everything that would
 * have been copied is noted here as it happens, and one email a day carries
 * the whole list to each person, containing only the categories THEY are
 * ticked for. Same facts, same recipients, one message.
 *
 * WHAT THIS IS NOT. It is not the admin sync digest (noteForAdmin() /
 * flushAdminDigest(), Config's Sync_Digest tick), which reports what went
 * WRONG to whoever maintains the workbook, once per run. This one reports what
 * went RIGHT, once per day, and the two are routinely different people.
 *
 * NOT RATIONED AND NOT PAUSED, for the reason notifyAdmin() gives: this is
 * office mail about the workbook, not a message to a member or a leader.
 * Pause_Outbound_Mail exists so that repairing the workbook does not write to
 * the people registered in it; it is not a reason to stop the office finding
 * out what its own system did.
 *
 * WHY SCRIPT PROPERTIES. The notes are made by hourly syncs and menu presses,
 * in a dozen separate executions across a day; the digest is sent by a
 * thirteenth. Nothing survives between executions except stored state, so the
 * queue is stored — accumulated in memory within a run (a reminder loop that
 * wrote a property per message would cost more round trips than the mail it is
 * describing) and persisted once, by saveOfficeDigestQueue(), at the end of
 * each sweep that makes notes.
 */
const OFFICE_DIGEST_PROP_KEY = 'OFFICE_DIGEST_QUEUE_V1';

/**
 * A Script Property value is capped at 9KB and a day of reminders is hundreds
 * of lines. Past this many the queue keeps COUNTING but stops remembering
 * individual lines: "and 212 more" is still true and still useful, where a
 * property write that throws mid-sync is neither.
 */
const OFFICE_DIGEST_MAX_LINES = 150;
const OFFICE_DIGEST_MAX_LINE_CHARS = 200;

/**
 * The sections of the digest, in the order they are printed, and who receives
 * each one.
 *
 * The first three are Config ticks, so a person reads exactly the categories
 * they asked for and a category nobody ticked is noted and then quietly
 * dropped — an empty recipient list has always meant "copy nobody" here.
 *
 * FILES SHARED is the exception, and matches openUpFileToAnyoneWithLink():
 * being an editor of a registrant sheet is standing access to a file rather
 * than mail, so it is not a tick of its own, and every address on the table
 * gets both the access and the line saying it was granted.
 */
const OFFICE_DIGEST_SECTIONS = [
  { key: 'leaderRosterAlerts', title: 'Roster change alerts emailed to program leaders' },
  { key: 'registrantReminders', title: 'Reminders emailed to registrants' },
  { key: 'calendarInviteGuest', title: 'Registrants invited to calendar events' },
  { key: 'filesShared', title: 'Files shared out of the workbook' }
];

/** Who receives one section. Never throws; an unknown key reaches nobody. */
function officeDigestRecipients(sectionKey) {
  try {
    if (sectionKey === 'filesShared') return getAllAdminNotificationEmails();
    if (!OFFICE_DIGEST_SECTIONS.some(section => section.key === sectionKey)) return [];
    return adminEmailsForCategory(sectionKey);
  } catch (err) {
    log(`⚠️ Could not read who is copied on "${sectionKey}" (${err}) — nobody was.`);
    return [];
  }
}

/** Per-execution collector, persisted by saveOfficeDigestQueue(). */
let __officeDigest = null;

/**
 * Notes one thing the office would previously have been copied on, under one
 * of the section keys above. Never sends anything and never throws: the whole
 * point is that the send happens once, later, somewhere else.
 *
 * A section nobody is ticked for is not queued at all. A queue that will never
 * be read is a property growing without bound.
 */
function noteForOffice(sectionKey, message) {
  if (officeDigestRecipients(sectionKey).length === 0) return;
  if (!__officeDigest) __officeDigest = {};
  if (!__officeDigest[sectionKey]) __officeDigest[sectionKey] = [];
  __officeDigest[sectionKey].push(String(message || '').slice(0, OFFICE_DIGEST_MAX_LINE_CHARS));
}

/** Reads the stored queue, or an empty one. A corrupt value reads as empty. */
function readOfficeDigestQueue_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(OFFICE_DIGEST_PROP_KEY);
    if (!raw) return { since: '', lines: 0, sections: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.sections) {
      return { since: '', lines: 0, sections: {} };
    }
    return { since: parsed.since || '', lines: parsed.lines || 0, sections: parsed.sections };
  } catch (err) {
    log(`⚠️ The office digest queue could not be read (${err}) — starting a fresh one.`);
    return { since: '', lines: 0, sections: {} };
  }
}

function writeOfficeDigestQueue_(queue) {
  try {
    PropertiesService.getScriptProperties().setProperty(OFFICE_DIGEST_PROP_KEY, JSON.stringify(queue));
    return true;
  } catch (err) {
    // The sweep that made the notes is not failed over the record of it. What
    // is lost is some of one day's lines, and the counts along with them.
    log(`⚠️ The office digest queue could not be saved (${err}).`);
    return false;
  }
}

/**
 * Folds this execution's notes into the stored queue — ONE property read and
 * one write, however many notes were made. Call it at the end of any sweep
 * that calls noteForOffice(). With nothing pending it does nothing.
 */
function saveOfficeDigestQueue() {
  const pending = __officeDigest;
  __officeDigest = null;
  if (!pending) return false;
  const keys = Object.keys(pending).filter(key => pending[key].length > 0);
  if (keys.length === 0) return false;

  const queue = readOfficeDigestQueue_();
  if (!queue.since) queue.since = new Date().toISOString();
  keys.forEach(key => {
    const bucket = queue.sections[key] || (queue.sections[key] = { count: 0, lines: [] });
    pending[key].forEach(message => {
      bucket.count++;
      if (queue.lines < OFFICE_DIGEST_MAX_LINES) {
        bucket.lines.push(message);
        queue.lines++;
      }
    });
  });
  return writeOfficeDigestQueue_(queue);
}

/** Throws the queue away — after a successful send, and nowhere else. */
function clearOfficeDigestQueue_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(OFFICE_DIGEST_PROP_KEY);
  } catch (err) {
    log(`⚠️ The office digest queue could not be cleared (${err}) — tomorrow's digest may repeat today's.`);
  }
}

/**
 * TRIGGER HANDLER: sends each person their day's digest, then clears the
 * queue.
 *
 * A QUIET DAY SENDS NOTHING, to anybody. An empty queue means nothing left the
 * organization since the last digest, and a daily "nothing happened" is the
 * fastest way to teach an office to file this address away unread.
 *
 * The queue is cleared only if every message that had a recipient actually
 * went. A send that throws (quota, an address MailApp refuses) leaves the
 * record intact for the next run rather than dropping a day of it on the
 * floor; the cost of that is one duplicate section for whoever did receive
 * theirs, which is the cheaper mistake.
 */
function sendOfficeDailyDigest() {
  const queue = readOfficeDigestQueue_();
  const sections = OFFICE_DIGEST_SECTIONS
    .filter(section => queue.sections[section.key] && queue.sections[section.key].count > 0);
  if (sections.length === 0) {
    log('Office daily digest: nothing was sent outside the organization since the last digest — no email.');
    return 0;
  }

  // One message per person, carrying only their own sections. Grouped by
  // recipient rather than by section so that somebody ticked for three
  // categories gets one email a day and not three.
  const byRecipient = {};
  sections.forEach(section => {
    officeDigestRecipients(section.key).forEach(address => {
      (byRecipient[address] || (byRecipient[address] = [])).push(section);
    });
  });

  const recipients = Object.keys(byRecipient);
  if (recipients.length === 0) {
    // Every tick was cleared after the notes were made. Nobody asked for this.
    log('Office daily digest: nobody is ticked for anything in the queue — it was discarded.');
    clearOfficeDigestQueue_();
    return 0;
  }

  const covering = queue.since
    ? `Covering ${formatOfficeDigestStamp_(queue.since)} to ${formatOfficeDigestStamp_(new Date().toISOString())}.`
    : '';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sent = 0;
  let failed = 0;

  recipients.forEach(address => {
    const mine = byRecipient[address];
    const total = mine.reduce((sum, section) => sum + queue.sections[section.key].count, 0);
    const lines = ['Everything this system sent outside the organization since the last digest.'];
    if (covering) lines.push(covering);
    lines.push('');
    mine.forEach(section => {
      const bucket = queue.sections[section.key];
      lines.push(`${section.title} (${bucket.count}):`);
      bucket.lines.forEach(message => lines.push(`  • ${message}`));
      const unlisted = bucket.count - bucket.lines.length;
      if (unlisted > 0) lines.push(`  • …and ${unlisted} more not listed individually.`);
      lines.push('');
    });
    if (ss) lines.push(`Workbook: ${ss.getUrl()}`);

    try {
      MailApp.sendEmail(address,
        `[Calendar & Form Manager] Daily record — ${total} item(s)`, lines.join('\n'));
      sent++;
    } catch (err) {
      failed++;
      log(`⚠️ The office daily digest could not be sent to "${address}" (${err}).`);
    }
  });

  if (failed === 0) {
    clearOfficeDigestQueue_();
    log(`Office daily digest sent to ${sent} address(es).`);
  } else {
    log(`⚠️ Office daily digest: ${failed} address(es) could not be reached — the queue is kept for the next run.`);
  }
  return sent;
}

/** yyyy-MM-dd HH:mm in the workbook's timezone, or the raw stamp if unreadable. */
function formatOfficeDigestStamp_(iso) {
  try {
    return Utilities.formatDate(new Date(iso), TIMEZONE, 'yyyy-MM-dd HH:mm');
  } catch (err) {
    return String(iso || '');
  }
}

/** MENU ACTION: send the record now rather than waiting for the daily trigger. */
function sendOfficeDigestNow() {
  saveOfficeDigestQueue();
  const sent = sendOfficeDailyDigest();
  toastIfPossible(sent > 0
    ? `Daily record sent to ${sent} office address(es) ✅`
    : 'Nothing has been sent outside the organization since the last digest.');
}
