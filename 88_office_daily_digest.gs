// ============================================================================
// 9g. THE OFFICE'S ONE EMAIL A DAY  (spool it, then send it at ten)
// ============================================================================
//
// The office was on four different mailing paths at once: the per-sync digest
// notifyAdmin() sends (hourly), the per-category notices notifyAdminCategory()
// sends (appointment requests, calendar invitations), the office's own copy of
// every registrant reminder, and a BCC on every leader roster alert. None of
// them was wrong on its own. Together they were forty messages on a Tuesday,
// which is the same thing as no messages: nobody reads the fortieth, so nobody
// reads the one that mattered.
//
// So office mail is now a SPOOL and one send. Everything that would have gone
// to the office is written down as it happens, and at 10am one message goes to
// everybody in Config's Admin Notification Emails table covering YESTERDAY —
// the whole day, closed, rather than a rolling window that reports half of a
// sync twice.
//
// ------------------------------------------------- WHAT DOES NOT WAIT
//
// A fault the desk may need to act on within the hour still goes at once, via
// notifyAdminUrgent(): a Quick Mark that would not save (the person at the
// desk has already moved on), a door sign-in that did not complete. Those are
// the only two callers, and adding a third is a decision, not a detail —
// everything else is something the office READS, and reading it tomorrow
// morning next to the rest of the day is better than reading it alone at
// 3am.
//
// -------------------------------------------------- WHY A DAY IS CLOSED
//
// The 10am pass sends every spooled day STRICTLY BEFORE today and deletes it.
// That is what makes the message re-runnable and the trigger cheap to miss: a
// workbook whose triggers were rebuilt on Thursday sends Tuesday and Wednesday
// on Friday morning, in two messages, each still saying which day it is about.
// Today's spool is never touched by the trigger, so an entry written at 09:59
// cannot be sent in a digest headed with yesterday's date and then written
// again into today's.
//
// ------------------------------------------------------- THE SAME THING TWICE
//
// An hourly sync that cannot open a form reports it twenty-four times a day.
// The spool COALESCES on section + message: the second identical note is a
// count on the first, with the first and last times it happened. That is the
// difference between a digest of twelve lines and a digest of two hundred
// that says the same twelve things.
//
// --------------------------------------------------- NEITHER SWITCH STOPS IT
//
// Pause_Outbound_Mail holds mail to people OUTSIDE the office and never
// touched notifyAdmin(); this inherits that exactly. Automation_Enabled is not
// consulted either, and the trigger below is deliberately not gated on it: the
// digest reports what already happened, and the morning somebody pauses
// everything to do repair work is the morning they most want yesterday's
// account of it.
//
// ------------------------------------------------------------- THE STORE
//
// Script Properties, one property per chunk per day, because a value there is
// capped at 9KB and a busy day is more than that. A note costs ONE write and
// no read: the day's chunks are read once per execution and appended to in
// memory, so a pass that spools forty lines pays forty writes rather than
// eighty round trips. Nothing here is cached across executions, and nothing
// here throws — a spool that cannot be written must not fail the sync that
// was reporting something to it.
//
// ------------------------------------------------------ WHY IT IS NUMBERED 88
//
// Last, like everything else that is behavior only. Its own constants stand
// alone, it reads no other file's constants at load time, and its callers
// (15, 33, 66, 70) reach it through hoisted function declarations, which works
// whatever order the project's files are evaluated in.
// ============================================================================

/** One property per chunk: `<prefix><yyyy-MM-dd>::<n>`. */
const OFFICE_DIGEST_SPOOL_PROP_PREFIX = 'OFFICE_DIGEST_SPOOL_V1::';

/** The hour the digest goes out, in TIMEZONE. Mirrored by writeTriggers(). */
const OFFICE_DIGEST_HOUR = 10;

/**
 * How much JSON one chunk holds before the next is started. Script Properties
 * refuse a value over 9KB; the margin is for the entry that crosses the line.
 */
const OFFICE_DIGEST_MAX_CHUNK_CHARS = 8000;

/**
 * How many chunks one day may have. Past this the day stops recording new
 * SECTIONS and only counts them, so a runaway loop costs a line saying so
 * rather than the whole 500KB property store.
 */
const OFFICE_DIGEST_MAX_CHUNKS_PER_DAY = 12;

/** How far back the 10am pass looks for a day nobody sent. */
const OFFICE_DIGEST_MAX_DAYS_SWEPT = 14;

/** The heading a day that filled up files its count under. */
const OFFICE_DIGEST_OVERFLOW_SECTION = 'More than one day’s notes';

/** Lines one digest email prints before it starts saying "and N more". */
const OFFICE_DIGEST_MAX_BODY_LINES = 600;

/**
 * The day currently loaded, as { key, chunks: [[entry, ...], ...] }.
 * Read once per execution; see THE STORE above.
 */
let __officeDigestSpool = null;

/**
 * Forgets the day held in memory, so the next note re-reads it from the store.
 *
 * The cache is per execution and the store only ever grows under it, so
 * nothing in production needs this — it exists for the tests, which delete a
 * day out from under the cache and would otherwise write it straight back.
 */
function resetOfficeDigestSpoolCache() {
  __officeDigestSpool = null;
}

/** yyyy-MM-dd in TIMEZONE — the key a day's chunks are filed under. */
function officeDigestDateKey_(date) {
  return Utilities.formatDate(date || new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function officeDigestChunkKey_(dateKey, index) {
  return `${OFFICE_DIGEST_SPOOL_PROP_PREFIX}${dateKey}::${index}`;
}

/** Every dateKey the store holds a chunk for, oldest first. */
function officeDigestSpooledDateKeys_() {
  const keys = {};
  try {
    PropertiesService.getScriptProperties().getKeys().forEach(key => {
      if (key.indexOf(OFFICE_DIGEST_SPOOL_PROP_PREFIX) !== 0) return;
      const rest = key.slice(OFFICE_DIGEST_SPOOL_PROP_PREFIX.length);
      const dateKey = rest.split('::')[0];
      if (dateKey) keys[dateKey] = true;
    });
  } catch (err) {
    log(`⚠️ Could not list the office digest spool (${err}).`);
  }
  return Object.keys(keys).sort();
}

/** One day's chunks, parsed. A chunk that will not parse is dropped, not thrown. */
function readOfficeDigestChunks_(dateKey) {
  const chunks = [];
  let props = null;
  try {
    props = PropertiesService.getScriptProperties();
  } catch (err) {
    return chunks;
  }
  for (let i = 0; i < OFFICE_DIGEST_MAX_CHUNKS_PER_DAY; i++) {
    let raw = null;
    try {
      raw = props.getProperty(officeDigestChunkKey_(dateKey, i));
    } catch (err) {
      break;
    }
    if (!raw) break;
    try {
      const parsed = JSON.parse(raw);
      chunks.push(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      log(`⚠️ The office digest spool for ${dateKey} chunk ${i} could not be read (${err}) — it was skipped.`);
      chunks.push([]);
    }
  }
  return chunks;
}

function loadOfficeDigestSpool_(dateKey) {
  if (__officeDigestSpool && __officeDigestSpool.key === dateKey) return __officeDigestSpool;
  __officeDigestSpool = { key: dateKey, chunks: readOfficeDigestChunks_(dateKey) };
  if (__officeDigestSpool.chunks.length === 0) __officeDigestSpool.chunks.push([]);
  return __officeDigestSpool;
}

function writeOfficeDigestChunk_(dateKey, index, entries) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty(officeDigestChunkKey_(dateKey, index), JSON.stringify(entries));
    return true;
  } catch (err) {
    log(`⚠️ Could not write the office digest spool for ${dateKey} (${err}).`);
    return false;
  }
}

/**
 * ONE LINE FOR THE OFFICE, TOMORROW MORNING.
 *
 * `section` is the heading it files under and `message` the line itself. The
 * same pair spooled twice is one entry with a count and two times, which is
 * what keeps an hourly sync's twenty-four identical complaints to one line —
 * see THE SAME THING TWICE above.
 *
 * Never throws and never blocks its caller: this is the reporting half of
 * something that has already happened, and a spool that will not write must
 * not take down the pass that was telling it.
 */
function spoolOfficeNote(section, message) {
  const heading = String(section === null || section === undefined ? '' : section).trim() || 'Notes';
  const line = String(message === null || message === undefined ? '' : message).trim();
  if (!line) return false;

  try {
    const now = new Date();
    const dateKey = officeDigestDateKey_(now);
    const stamp = Utilities.formatDate(now, TIMEZONE, 'HH:mm');
    const spool = loadOfficeDigestSpool_(dateKey);

    // Coalesce against everything already spooled today, wherever it sits: the
    // repeat is a count on the first entry, so the digest says "since 05:04"
    // rather than printing it twenty-four times.
    for (let i = 0; i < spool.chunks.length; i++) {
      const found = spool.chunks[i].filter(e => e.s === heading && e.m === line)[0];
      if (!found) continue;
      found.n = (Number(found.n) || 1) + 1;
      found.l = stamp;
      return writeOfficeDigestChunk_(dateKey, i, spool.chunks[i]);
    }

    let index = spool.chunks.length - 1;
    if (JSON.stringify(spool.chunks[index]).length > OFFICE_DIGEST_MAX_CHUNK_CHARS) {
      if (spool.chunks.length >= OFFICE_DIGEST_MAX_CHUNKS_PER_DAY) {
        // The day is full. Counted rather than recorded, and counted on an
        // entry that is itself coalesced, so the overflow costs one line.
        return spoolOfficeDigestOverflow_(dateKey, spool, stamp);
      }
      spool.chunks.push([]);
      index = spool.chunks.length - 1;
    }
    spool.chunks[index].push({ s: heading, m: line, n: 1, f: stamp, l: stamp });
    return writeOfficeDigestChunk_(dateKey, index, spool.chunks[index]);
  } catch (err) {
    log(`⚠️ Could not spool an office note (${err}).`);
    return false;
  }
}

/** The one entry a full day keeps writing to. Deliberately in the LAST chunk. */
function spoolOfficeDigestOverflow_(dateKey, spool, stamp) {
  const index = spool.chunks.length - 1;
  const entries = spool.chunks[index];
  const existing = entries.filter(e => e.s === OFFICE_DIGEST_OVERFLOW_SECTION)[0];
  if (existing) {
    existing.n = (Number(existing.n) || 1) + 1;
    existing.l = stamp;
  } else {
    entries.push({
      s: OFFICE_DIGEST_OVERFLOW_SECTION,
      m: 'The day filled up. Further notes were counted but not recorded; the execution log has them all.',
      n: 1, f: stamp, l: stamp
    });
  }
  return writeOfficeDigestChunk_(dateKey, index, entries);
}

/** Everything spooled for one day, in the order it was first written. */
function readOfficeDigestDay(dateKey) {
  const entries = [];
  readOfficeDigestChunks_(dateKey).forEach(chunk => {
    chunk.forEach(entry => {
      if (entry && entry.m) entries.push(entry);
    });
  });
  return entries;
}

function deleteOfficeDigestDay_(dateKey) {
  try {
    const props = PropertiesService.getScriptProperties();
    for (let i = 0; i < OFFICE_DIGEST_MAX_CHUNKS_PER_DAY; i++) {
      props.deleteProperty(officeDigestChunkKey_(dateKey, i));
    }
    if (__officeDigestSpool && __officeDigestSpool.key === dateKey) __officeDigestSpool = null;
  } catch (err) {
    log(`⚠️ Could not clear the office digest spool for ${dateKey} (${err}).`);
  }
}

/**
 * The digest's body: sections in the order they were first written that day,
 * each line stamped with when it happened and, where it happened more than
 * once, how many times and between which times.
 */
function buildOfficeDigestBody(dateKey, entries) {
  const lines = [
    `Everything the workbook would have emailed the office on ${dateKey}, in one message.`,
    '',
    'Sent once a day at ' + OFFICE_DIGEST_HOUR + ':00. Anything the desk may need within the hour —',
    'a Quick Mark that would not save, a door sign-in that did not finish — is still sent',
    'as it happens and is not held for this.',
    ''
  ];

  const order = [];
  const bySection = {};
  entries.forEach(entry => {
    if (!bySection[entry.s]) {
      bySection[entry.s] = [];
      order.push(entry.s);
    }
    bySection[entry.s].push(entry);
  });

  let printed = 0;
  let suppressed = 0;
  order.forEach(section => {
    const items = bySection[section];
    const total = items.reduce((sum, e) => sum + (Number(e.n) || 1), 0);
    lines.push(`${section} (${total})`);
    items.forEach(entry => {
      if (printed >= OFFICE_DIGEST_MAX_BODY_LINES) {
        suppressed += (Number(entry.n) || 1);
        return;
      }
      printed++;
      const count = Number(entry.n) || 1;
      const when = count > 1 ? `${entry.f}–${entry.l}, ${count}×` : entry.f;
      // A multi-line note (a whole sync digest, say) keeps its shape, indented
      // under the line that introduces it.
      const body = String(entry.m).split('\n');
      lines.push(`  ${when}  ${body[0]}`);
      body.slice(1).forEach(rest => lines.push(`        ${rest}`));
    });
    lines.push('');
  });

  if (suppressed > 0) {
    lines.push(`…and ${suppressed} more item(s), which the execution log has in full.`);
    lines.push('');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) lines.push(`Workbook: ${ss.getUrl()}`);
  } catch (err) { /* the digest is worth sending without the link */ }

  return lines.join('\n');
}

function buildOfficeDigestSubject(dateKey, entries) {
  const total = entries.reduce((sum, e) => sum + (Number(e.n) || 1), 0);
  return `[Office digest] ${dateKey} — ${total} item(s)`;
}

/**
 * Sends one day's spool to EVERY address on Config's Admin Notification Emails
 * table, ticked or not — this is the office's copy of what the workbook did,
 * and the per-category ticks now govern only what still goes out immediately
 * (see notifyAdminUrgent). Returns true if a message went.
 *
 * DELIBERATELY NOT RATIONED and not pausable, like notifyAdmin() always was:
 * it is one internal message a day, and the run it reports on may well be the
 * one that ran out of quota.
 *
 * The spool is deleted only once the message is away — a day cleared before
 * the send is a day nobody ever hears about, and a day sent without being
 * cleared is a day sent again tomorrow.
 */
function sendOfficeDigestForDay(dateKey) {
  const entries = readOfficeDigestDay(dateKey);
  if (entries.length === 0) {
    // A quiet day stays quiet: no message, and nothing left behind to send.
    deleteOfficeDigestDay_(dateKey);
    return false;
  }
  const emails = getAllAdminNotificationEmails();
  if (emails.length === 0) {
    log(`ℹ️ The office digest for ${dateKey} was not sent — no addresses on Config's Admin Notification Emails table.`);
    return false;
  }
  try {
    MailApp.sendEmail(emails.join(','), buildOfficeDigestSubject(dateKey, entries),
      buildOfficeDigestBody(dateKey, entries));
  } catch (err) {
    // Kept, not dropped: tomorrow's pass sweeps every day before today, so a
    // digest that could not be sent this morning goes out with the next one.
    log(`⚠️ Could not send the office digest for ${dateKey} (${err}) — it is kept for the next pass.`);
    return false;
  }
  log(`Office digest for ${dateKey} sent to ${emails.join(', ')} — ${entries.length} line(s).`);
  deleteOfficeDigestDay_(dateKey);
  return true;
}

/**
 * The 10am trigger. Sends every spooled day before today — normally just
 * yesterday, and any day a missed or rebuilt trigger left behind.
 *
 * A day older than OFFICE_DIGEST_MAX_DAYS_SWEPT is dropped rather than mailed:
 * a fortnight-old list of forms that could not be opened is history, and the
 * one thing worse than not being told is being told at length about a
 * workbook that has moved on.
 */
function sendOfficeDailyDigest() {
  const todayKey = officeDigestDateKey_(new Date());
  const oldestKey = officeDigestDateKey_(
    new Date(Date.now() - OFFICE_DIGEST_MAX_DAYS_SWEPT * 24 * 60 * 60 * 1000));
  let sent = 0;
  officeDigestSpooledDateKeys_().forEach(dateKey => {
    if (dateKey >= todayKey) return;
    if (dateKey < oldestKey) {
      log(`ℹ️ Dropped the office digest spool for ${dateKey} — older than ${OFFICE_DIGEST_MAX_DAYS_SWEPT} days.`);
      deleteOfficeDigestDay_(dateKey);
      return;
    }
    if (sendOfficeDigestForDay(dateKey)) sent++;
  });
  return sent;
}

/** The menu item. Sends the closed days AND today so far, then says what went. */
function sendOfficeDigestNow() {
  const sent = sendOfficeDailyDigest();
  const todayKey = officeDigestDateKey_(new Date());
  const todaySent = sendOfficeDigestForDay(todayKey);
  const total = sent + (todaySent ? 1 : 0);
  const message = total === 0
    ? 'Nothing is waiting for the office — no digest was sent.'
    : `Sent ${total} office digest(s) to everyone on Config's Admin Notification Emails table.`;
  log(message);
  toastIfPossible(message);
  return total;
}
