// ============================================================
// 74. THE OFFICE'S DAILY DIGEST
// ============================================================
/**
 * ONE MESSAGE A DAY INSTEAD OF A COPY OF EVERYTHING.
 *
 * The archive copy address (Config's "🗄️ Archive Copy Address", see
 * getArchiveCopyEmail()) used to receive a copy of every single thing this
 * system sent outside the organization, as it happened: BCC'd on each leader
 * roster alert and each registrant reminder, added as a guest on every event a
 * registrant was invited to, added as an editor of every file shared out of
 * the workbook. It worked, and it was unreadable — a busy week put several
 * hundred messages and Google invitations into one mailbox, which is the same
 * as putting none there: nobody at the desk could find the one that mattered.
 *
 * So the copies stop, and a RECORD takes their place. Everything that would
 * have been copied is noted here instead, and one email a day carries the
 * whole list: who was emailed about what, which events registrants were
 * invited to, and which files were shared with whom. Same facts, one message,
 * in the order they happened.
 *
 * WHAT THIS IS NOT. It is not the admin digest (noteForAdmin() /
 * flushAdminDigest()), which reports things that went WRONG to whoever
 * maintains the workbook, once per run. This one reports things that went
 * RIGHT to the office, once per day. The two addresses are configured
 * separately and are routinely different people.
 *
 * WHY SCRIPT PROPERTIES. The notes are made by hourly syncs and by menu
 * presses, in a dozen separate executions spread across a day; the digest is
 * sent by a thirteenth. Nothing survives between executions except stored
 * state, so the queue is stored — accumulated in memory within a run (a
 * reminder loop that wrote a property per message would cost more round trips
 * than the mail it is describing) and persisted once, by
 * saveOfficeDigestQueue(), at the end of each producing sweep.
 *
 * BLANK ADDRESS = NOTE NOTHING. An office that cleared the Config cell asked
 * not to be copied, and a queue nobody will ever be sent is just a property
 * growing without bound.
 */
const OFFICE_DIGEST_PROP_KEY = 'OFFICE_DIGEST_QUEUE_V1';

/**
 * A Script Property value is capped at 9KB, and a day of reminders can be
 * hundreds of lines. Past this many the queue keeps COUNTING but stops
 * remembering individual lines: "and 212 more" is still a true and useful
 * sentence, where a write that throws mid-sync is neither.
 */
const OFFICE_DIGEST_MAX_LINES = 150;
const OFFICE_DIGEST_MAX_LINE_CHARS = 200;

/** Per-execution collector, persisted by saveOfficeDigestQueue(). */
let __officeDigest = null;

/**
 * Notes one thing the office would previously have been copied on. Never
 * throws and never sends anything: the whole point is that the send happens
 * once, later, somewhere else.
 */
function noteForOffice(category, message) {
  if (!getArchiveCopyEmail()) return;
  if (!__officeDigest) __officeDigest = {};
  if (!__officeDigest[category]) __officeDigest[category] = [];
  __officeDigest[category].push(String(message || '').slice(0, OFFICE_DIGEST_MAX_LINE_CHARS));
}

/** Reads the stored queue, or an empty one. A corrupt value reads as empty. */
function readOfficeDigestQueue_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(OFFICE_DIGEST_PROP_KEY);
    if (!raw) return { since: '', lines: 0, categories: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.categories) {
      return { since: '', lines: 0, categories: {} };
    }
    return { since: parsed.since || '', lines: parsed.lines || 0, categories: parsed.categories };
  } catch (err) {
    log(`⚠️ The office digest queue could not be read (${err}) — starting a fresh one.`);
    return { since: '', lines: 0, categories: {} };
  }
}

function writeOfficeDigestQueue_(queue) {
  try {
    PropertiesService.getScriptProperties().setProperty(OFFICE_DIGEST_PROP_KEY, JSON.stringify(queue));
    return true;
  } catch (err) {
    // The sweep that made the notes is not failed over a record of it. What is
    // lost is one day's lines, and the counts along with them.
    log(`⚠️ The office digest queue could not be saved (${err}).`);
    return false;
  }
}

/**
 * Folds this execution's notes into the stored queue — ONE property read and
 * one write, however many notes were made. Call it at the end of any sweep
 * that calls noteForOffice(); calling it with nothing pending does nothing.
 */
function saveOfficeDigestQueue() {
  const pending = __officeDigest;
  __officeDigest = null;
  if (!pending) return false;
  const categories = Object.keys(pending).filter(c => pending[c].length > 0);
  if (categories.length === 0) return false;

  const queue = readOfficeDigestQueue_();
  if (!queue.since) queue.since = new Date().toISOString();
  categories.forEach(category => {
    const bucket = queue.categories[category] ||
      (queue.categories[category] = { count: 0, lines: [] });
    pending[category].forEach(message => {
      bucket.count++;
      if (queue.lines < OFFICE_DIGEST_MAX_LINES) {
        bucket.lines.push(message);
        queue.lines++;
      }
    });
  });
  return writeOfficeDigestQueue_(queue);
}

/** Throws the queue away — used after a successful send, and by the reset. */
function clearOfficeDigestQueue_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(OFFICE_DIGEST_PROP_KEY);
  } catch (err) {
    log(`⚠️ The office digest queue could not be cleared (${err}) — tomorrow's digest may repeat today's.`);
  }
}

/**
 * TRIGGER HANDLER: sends the day's digest to the archive copy address, then
 * clears the queue.
 *
 * A QUIET DAY SENDS NOTHING. An empty queue means nothing left the
 * organization since the last digest, and a daily "nothing happened" is the
 * fastest way to teach an office to filter this address into a folder they
 * never open.
 *
 * The queue is cleared only if the mail actually went, so a send that throws
 * (quota, a mistyped address) leaves the record intact for tomorrow rather
 * than dropping a day of it on the floor.
 */
function sendOfficeDailyDigest() {
  const address = getArchiveCopyEmail();
  const queue = readOfficeDigestQueue_();
  const categories = Object.keys(queue.categories).filter(c => queue.categories[c].count > 0);
  if (categories.length === 0) {
    log('Office daily digest: nothing was sent outside the organization since the last digest — no email.');
    return false;
  }
  if (!address) {
    // The cell was cleared after the notes were made. Nobody asked for this.
    log('Office daily digest: the Archive Copy Address is blank — the queue was discarded.');
    clearOfficeDigestQueue_();
    return false;
  }

  const total = categories.reduce((sum, c) => sum + queue.categories[c].count, 0);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [
    'Everything this system sent outside the organization since the last digest.',
    queue.since ? `Covering ${formatDigestStamp_(queue.since)} to ${formatDigestStamp_(new Date().toISOString())}.` : '',
    ''
  ];
  categories.forEach(category => {
    const bucket = queue.categories[category];
    lines.push(`${category} (${bucket.count}):`);
    bucket.lines.forEach(m => lines.push(`  • ${m}`));
    const unlisted = bucket.count - bucket.lines.length;
    if (unlisted > 0) lines.push(`  • …and ${unlisted} more not listed individually.`);
    lines.push('');
  });
  if (ss) lines.push(`Workbook: ${ss.getUrl()}`);

  try {
    MailApp.sendEmail(address,
      `[Calendar & Form Manager] Daily record — ${total} item(s)`,
      lines.filter(l => l !== null).join('\n'));
    log(`Office daily digest sent to ${address} — ${total} item(s).`);
    clearOfficeDigestQueue_();
    return true;
  } catch (err) {
    log(`⚠️ The office daily digest could not be sent to "${address}" (${err}) — it is kept for the next run.`);
    return false;
  }
}

/** yyyy-MM-dd HH:mm in the workbook's timezone, or the raw stamp if unparseable. */
function formatDigestStamp_(iso) {
  try {
    return Utilities.formatDate(new Date(iso), TIMEZONE, 'yyyy-MM-dd HH:mm');
  } catch (err) {
    return String(iso || '');
  }
}

/** MENU ACTION: send the digest now rather than waiting for the daily trigger. */
function sendOfficeDigestNow() {
  saveOfficeDigestQueue();
  const sent = sendOfficeDailyDigest();
  const address = getArchiveCopyEmail();
  toastIfPossible(sent
    ? `Daily record sent to ${address} ✅`
    : (address
      ? 'Nothing has been sent outside the organization since the last digest.'
      : 'No Archive Copy Address is configured on the Config tab.'));
}
