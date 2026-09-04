// ============================================================================
// 9e. REGISTRANT NOTIFICATIONS  (how often each program tells its people)
// ============================================================================
//
// One cell per program, on Program_Options, answering "how much does this
// program talk to the people signed up for it?" — because the honest answer
// differs by program and always has. A drop-in coffee morning that fifty
// people come to needs nothing beyond the calendar entry they already have.
// A Personalized Assistance appointment is a promise to one person to be
// somewhere at 2:15, and that person should be told 2:15, in writing, without
// a member of staff having to remember to type it.
//
// TWO COLUMNS, both staff-owned (PROGRAM_OPTIONS_STAFF_COLUMNS):
//
//   Notify_Mode     — a dropdown: leave it on "Default for type" and the
//                     program is notified the way its KIND is normally
//                     notified (see defaultNotificationPolicy()). The other
//                     values override that for this one program.
//   Reminder_Days   — how many days BEFORE the session a reminder goes out,
//                     comma-separated, 0 meaning the morning of. Blank takes
//                     the mode's own default. Ignored entirely by the two
//                     modes that send no reminders.
//
// WHAT THE MODES DRIVE. Two independent channels, deliberately:
//
//   THE CALENDAR INVITE (section 5b) puts the person on the real event's
//   guest list, and from then on Google's own reminders and any change to
//   the event reach them without this workbook doing anything.
//
//   THE REMINDER EMAIL is this file's own send, on the cadence above. It is
//   the only one that can say something PER PERSON — a calendar event has
//   ONE description shared by every guest, so "your appointment is at 2:15"
//   cannot live in the invite itself. For an appointment program the email
//   is therefore not a nicety; it is where the time is stated. That is also
//   why an assistance registrant gets one AS SOON AS they are booked
//   (REMINDER_CONFIRMATION_OFFSET) as well as on the countdown.
//
// THE CONFIG SWITCH STILL WINS. "📧 Calendar Invitations" set to "Do not
// invite" means nobody is added to a guest list, whatever a program row says:
// the tab decides which programs opt IN to a channel, never that a channel
// switched off at the workbook level is on after all. Reminder emails have
// their own switch on the same footing — REMINDERS_OFF_MODES below is about
// per-program intent, not about overriding the workbook.
//
// SENDING IS RECORDED, NOT RE-DERIVED. Every send is written to a ledger
// keyed by event, person and offset, so an hourly sync that finds the same
// row for the eighth time sends nothing. Without that, "1 day before" would
// mean twenty-four emails.
// ============================================================================

/** What Notify_Mode can say. The stored value is the visible string. */
const NOTIFY_MODES = {
  DEFAULT: 'Default for type',
  INVITE_ONLY: 'Calendar invite only',
  INVITE_AND_REMIND: 'Calendar invite + reminders',
  REMIND_ONLY: 'Reminder emails only',
  NONE: 'Do not notify'
};
const NOTIFY_MODE_LIST = Object.values(NOTIFY_MODES);

/** Suggestions for the Reminder_Days cell. An open list: any day count is legal. */
const REMINDER_DAYS_SUGGESTIONS = ['7', '3', '1', '7, 1', '1, 0', '0'];

/** Reminder_Days when the cell is blank and the mode does send reminders. */
const DEFAULT_REMINDER_DAYS = [1];

/**
 * The pseudo-offset a booking confirmation is recorded under.
 *
 * Not a day count and deliberately not expressible in Reminder_Days: it fires
 * on the registration, not on a countdown, and the ledger has to be able to
 * tell "we told them their time when they booked" apart from "we reminded
 * them the day before" — the two are both true and neither replaces the other.
 */
const REMINDER_CONFIRMATION_OFFSET = 'booked';

/** How far out a reminder is worth computing. Past today's date, nothing is. */
const REMINDER_FORWARD_DAYS = 30;

/**
 * The most reminder emails one run will send, and the floor it will not dig
 * the day's mail quota below (the `reserve` sendRationedEmail() is given, see
 * section 9f). Same reasoning as the roster alerts one file up: this pass
 * rides the hourly sync, a quiet hour sends nothing, and the hour that is not
 * quiet must not spend the whole workbook's mail on itself. Anything held back
 * keeps its ledger entry unwritten and goes out on the next pass.
 *
 * THE FLOOR IS THE LOWER OF THE TWO on purpose. The alert pass runs first in
 * the same execution and stops at LEADER_ALERT_QUOTA_RESERVE precisely so
 * there is something left here: a reminder names the time somebody is expected
 * somewhere, which is worth nothing the day after. What stays under this floor
 * is the handful of messages notifyAdmin() needs to report that any of this
 * went wrong.
 */
const MAX_REMINDER_EMAILS_PER_RUN = 40;
const REMINDER_QUOTA_RESERVE = 10;

/** Who has already been told what: { eventId: { "email|offset": true } }. */
const REMINDER_LEDGER_PROP_KEY = 'REGISTRANT_REMINDERS_V1';
const REMINDER_LEDGER_CHUNK_CHARS = 8000;
const REMINDER_LEDGER_MAX_CHUNKS = 40;

let __reminderLedgerCache = null;
let __reminderLedgerDirty = false;

function getRegistrantReminderLedger() {
  if (__reminderLedgerCache) return __reminderLedgerCache;
  const raw = readChunkedScriptProperty(REMINDER_LEDGER_PROP_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Unreadable reads as EMPTY, which is the direction that re-sends rather
    // than the one that goes silent: a duplicate reminder is a mild
    // annoyance, a missed appointment time is the thing this exists to stop.
    log(`⚠️ The registrant reminder ledger could not be parsed (${err}) — starting fresh.`);
  }
  __reminderLedgerCache = parsed && typeof parsed === 'object' ? parsed : {};
  return __reminderLedgerCache;
}

function saveRegistrantReminderLedger() {
  if (!__reminderLedgerDirty || !__reminderLedgerCache) return;
  writeChunkedScriptProperty(REMINDER_LEDGER_PROP_KEY, JSON.stringify(__reminderLedgerCache),
    REMINDER_LEDGER_CHUNK_CHARS, REMINDER_LEDGER_MAX_CHUNKS);
  __reminderLedgerDirty = false;
}


// --- the policy behind one program ------------------------------------------

/**
 * How a program of this KIND is notified when nobody has said otherwise.
 *
 * ASSISTANCE IS THE ONE THAT DIFFERS, and it differs because its registrants
 * hold a time nobody else holds: an appointment is per person, so it is
 * invited AND written to, the day before and at the moment of booking, with
 * the person's own slot in the text. Everything else defaults to what this
 * workbook did before this file existed — the calendar invite and nothing
 * more — so switching to this layout changes no program's mail on its own.
 */
function defaultNotificationPolicy(isAssistance) {
  return isAssistance
    ? { invite: true, remind: true, days: [1], confirmTime: true, personalizeTime: true }
    : { invite: true, remind: false, days: [], confirmTime: false, personalizeTime: false };
}

/**
 * Reads "1, 0" / "7 and 1" / "3" out of a Reminder_Days cell into [1, 0].
 *
 * Deliberately forgiving about separators and deliberately strict about what
 * it keeps: whole days, not negative (a reminder after the event is not a
 * reminder), no further out than the window this pass looks at, de-duplicated,
 * and soonest LAST so a session reads 7 then 1 then 0 in the order it happens.
 * A cell of pure nonsense yields nothing, and the caller falls back to the
 * mode's default rather than sending on a schedule nobody typed.
 */
function parseReminderDays(value) {
  const text = String(value === null || value === undefined ? '' : value);
  const days = [];
  (text.match(/\d+/g) || []).forEach(token => {
    const day = Math.floor(Number(token));
    if (!(day >= 0) || day > REMINDER_FORWARD_DAYS) return;
    if (days.indexOf(day) === -1) days.push(day);
  });
  return days.sort((a, b) => b - a);
}

/** One Program_Options row's two cells resolved into a policy. */
function resolveNotificationPolicy(mode, reminderDaysValue, isAssistance) {
  const fallback = defaultNotificationPolicy(isAssistance);
  const wanted = String(mode || '').trim().toLowerCase();
  const chosen = NOTIFY_MODE_LIST.filter(m => m.toLowerCase() === wanted)[0];
  if (wanted && !chosen) {
    log(`ℹ️ Notify_Mode reads "${mode}", which is not one of ${NOTIFY_MODE_LIST.join(' / ')} — ` +
      `that program is notified the way its kind usually is.`);
  }
  let policy;
  switch (chosen) {
    case NOTIFY_MODES.NONE:
      policy = { invite: false, remind: false, days: [], confirmTime: false,
        personalizeTime: fallback.personalizeTime };
      break;
    case NOTIFY_MODES.INVITE_ONLY:
      policy = { invite: true, remind: false, days: [], confirmTime: false,
        personalizeTime: fallback.personalizeTime };
      break;
    case NOTIFY_MODES.INVITE_AND_REMIND:
      policy = { invite: true, remind: true, days: [], confirmTime: fallback.confirmTime,
        personalizeTime: fallback.personalizeTime };
      break;
    case NOTIFY_MODES.REMIND_ONLY:
      policy = { invite: false, remind: true, days: [], confirmTime: fallback.confirmTime,
        personalizeTime: fallback.personalizeTime };
      break;
    default:
      // "Default for type", blank, or a value nobody recognizes. An
      // unrecognized cell is NOT treated as "do not notify": a typo must not
      // be a way to silently stop telling people about their appointments.
      policy = {
        invite: fallback.invite, remind: fallback.remind, days: fallback.days.slice(),
        confirmTime: fallback.confirmTime, personalizeTime: fallback.personalizeTime
      };
      break;
  }
  if (policy.remind) {
    const typed = parseReminderDays(reminderDaysValue);
    policy.days = typed.length > 0 ? typed
      : (fallback.days.length > 0 ? fallback.days.slice() : DEFAULT_REMINDER_DAYS.slice());
  } else {
    policy.days = [];
    policy.confirmTime = false;
  }
  return policy;
}

/**
 * { programKey: { mode, reminderDays } } read off Program_Options once per
 * execution. The tab is a few hundred rows at most and both the invitation
 * pass and the reminder pass want it, so it is read once and memoized rather
 * than re-opened per session.
 */
let __notificationPolicyRowsCache = null;

function invalidateNotificationPolicyCache() {
  __notificationPolicyRowsCache = null;
}

function readNotificationPolicyRows() {
  if (__notificationPolicyRowsCache) return __notificationPolicyRowsCache;
  const out = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_OPTIONS) : null;
  if (sheet) {
    const headers = HEADERS.Program_Options;
    const map = getIndexMap(headers);
    readSimpleTable(sheet, headers).forEach(row => {
      const key = notificationProgramKey(row[map['Event']], row[map['Location']]);
      if (key === '|') return;
      out[key] = {
        mode: String(row[map['Notify_Mode']] || '').trim(),
        reminderDays: row[map['Reminder_Days']]
      };
    });
  }
  __notificationPolicyRowsCache = out;
  return out;
}

/** The key Program_Options rows and session rows are matched on. */
function notificationProgramKey(title, location) {
  return `${normalizeNameKey(title)}|${normalizeNameKey(location)}`;
}

/**
 * The policy governing one SESSION — its program's row where there is one,
 * its kind's default where there is not.
 *
 * A program the staff have never touched has no row until the next
 * Program_Options refresh, and a session must not go unnotified in the
 * meantime: an absent row is the default, not silence.
 */
function notificationPolicyForSession(session) {
  const row = readNotificationPolicyRows()[notificationProgramKey(session.title, session.location)];
  return resolveNotificationPolicy(row ? row.mode : '', row ? row.reminderDays : '',
    !!session.isAssistance);
}


// --- the reminder pass -------------------------------------------------------

/**
 * Emails everybody who is due a reminder, and everybody newly booked into an
 * appointment program their own time. Returns { sent, held, eventsTouched }.
 *
 * Runs off the two tables the sync has just settled, like the invitation pass
 * beside it, and is safe to call every hour: the ledger makes a repeat send
 * impossible and a sync with nothing due does no work beyond the read.
 */
function sendRegistrantReminders(sessionRows, registrantRows) {
  const result = { sent: 0, held: 0, eventsTouched: 0 };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regMap = getIndexMap(regHeaders);
  const sessions = sessionRows ||
    getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), regHeaders, 'Event_ID');
  if (sessions.length === 0) return result;

  const today = new Date();
  const todayKey = formatDateKey(today);
  const horizonKey = formatDateKey(new Date(today.getTime() + REMINDER_FORWARD_DAYS * 86400000));

  // Every session in the window, with the policy its program asks for. Built
  // first so a program that sends nothing costs one lookup rather than a pass
  // over its registrants.
  const due = {};
  const liveEventIds = {};
  sessions.forEach(row => {
    const eventId = String(row[regMap['Event_ID']] || '').trim();
    const date = coerceDate(row[regMap['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = formatDateKey(date);
    liveEventIds[eventId] = dateKey;
    if (dateKey < todayKey || dateKey > horizonKey) return;
    const session = {
      eventId, date, dateKey,
      title: String(row[regMap['Clean_Title']] || '').trim(),
      location: String(row[regMap['Location']] || '').trim(),
      time: eventTimeLabelOf(row[regMap['Event_Time']]),
      isAssistance: isAssistanceColumnValue(row[regMap['Personalized_Assistance']])
    };
    const policy = notificationPolicyForSession(session);
    if (!policy.remind) return;
    // How many days from today this session is. A reminder for "1 day before"
    // is owed when that number is 1 — computed on the DATE KEYS rather than on
    // a millisecond difference, which a daylight-saving boundary rounds wrong.
    const daysAway = Math.round(
      (parseDateKey(dateKey).getTime() - parseDateKey(todayKey).getTime()) / 86400000);
    const offsets = policy.days.filter(day => day >= daysAway);
    if (offsets.length === 0 && !policy.confirmTime) return;
    // EVERY offset already PASSED counts as due, not just today's exact match:
    // a person who registers the evening before a "7 days before" reminder was
    // meant to go out has still never been told, and the ledger stops the one
    // they did get from repeating.
    due[eventId] = { session, policy, offsets, daysAway };
  });
  if (Object.keys(due).length === 0) {
    pruneRegistrantReminderLedger(liveEventIds, todayKey);
    saveRegistrantReminderLedger();
    return result;
  }

  const lrHeaders = HEADERS.Registrant_Dash;
  const lrMap = getIndexMap(lrHeaders);
  const rows = registrantRows ||
    getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), lrHeaders, 'Event_ID');

  const ledger = getRegistrantReminderLedger();

  rows.forEach(row => {
    const eventId = String(row[lrMap['Event_ID']] || '').trim();
    const item = due[eventId];
    if (!item) return;
    // ACTIVE ONLY. A waitlisted or cancelled row is not a person who should be
    // told to turn up; the roster alerts are where a change of status is
    // reported, and to staff rather than to the member.
    if (String(row[lrMap['Program_Status']] || '').trim() !== 'Active') return;
    const email = String(row[lrMap['Email']] || '').trim().toLowerCase();
    if (!isPlausibleEmail(email)) return;

    const name = String(row[lrMap['Name']] || '').trim();
    // The person's OWN time where the program has one per person, the
    // session's where it does not. This is the line the calendar invite
    // cannot carry.
    const personalTime = item.policy.personalizeTime
      ? eventTimeLabelOf(row[lrMap['Event_Time']]) : '';
    const wanted = [];
    if (item.policy.confirmTime) wanted.push(REMINDER_CONFIRMATION_OFFSET);
    item.offsets.forEach(day => wanted.push(day));

    const sentFor = ledger[eventId] || {};
    wanted.forEach(offset => {
      const stamp = `${email}|${offset}`;
      // Read here as well as inside the send: a message that has already gone
      // must not count against the per-run cap the way a held one does.
      const alreadySent = () => !!sentFor[stamp];
      if (alreadySent()) return;
      if (result.sent >= MAX_REMINDER_EMAILS_PER_RUN) {
        result.held++;
        return;
      }

      // The quota, the send itself, the refused-address rule and "record it
      // only once it is away" are section 9f's. What is decided here is who is
      // due a message, who in the office is copied (Config's
      // Registrant_Reminders tick, and nobody by default), what it says, and
      // how much of a scarce quota this pass may spend (`reserve`).
      const outcome = sendRationedEmail({
        to: email,
        subject: buildRegistrantReminderSubject(item.session, offset),
        body: buildRegistrantReminderBody(item.session, { name, time: personalTime }, offset,
          item.daysAway),
        reserve: REMINDER_QUOTA_RESERVE,
        bcc: adminEmailsForCategory('registrantReminders'),
        alreadySent,
        recordSent: () => {
          sentFor[stamp] = true;
          ledger[eventId] = sentFor;
          __reminderLedgerDirty = true;
        }
      });

      if (outcome.status === 'sent' || outcome.status === 'duplicate') {
        if (outcome.status === 'sent') result.sent++;
        return;
      }
      if (outcome.status === 'held') {
        result.held++;
        return;
      }
      // NOT recorded, so the next pass tries again. Told to the admin on the
      // refusal itself — an address MailApp refuses will refuse the same way
      // tomorrow — but not again for the messages suppressed behind it, which
      // are the same bad address reported twice.
      log(`⚠️ Could not send a reminder to ${email} for "${item.session.title}" ` +
        `on ${formatDateLabel(item.session.date)} (${outcome.error}).`);
      if (outcome.status === 'failed') {
        noteForAdmin('Reminders that could not be sent',
          `${email} could not be emailed about "${item.session.title}" on ` +
          `${formatDateLabel(item.session.date)} (${outcome.error}). It will be tried again next sync.`);
      }
    });
  });

  result.eventsTouched = Object.keys(ledger).length;
  pruneRegistrantReminderLedger(liveEventIds, todayKey);
  saveRegistrantReminderLedger();

  if (result.sent > 0 || result.held > 0) {
    log(`Registrant reminders: ${result.sent} email(s) sent` +
      (result.held > 0 ? `; ${result.held} held back by the per-run cap or the mail quota — ` +
        `they go out on the next sync.` : '.'));
  }
  if (result.held > 0) {
    noteForAdmin('Reminders held back',
      `${result.held} reminder email(s) were not sent this run because the per-run cap or the daily ` +
      `mail quota was reached. They were NOT discarded — the next sync sends them.`);
  }
  return result;
}

/**
 * Drops ledger entries for events that have happened or that the calendar no
 * longer mentions. Without it the ledger grows by one entry per person per
 * session for ever, against a Script Properties budget it shares with every
 * other registry in this project.
 */
function pruneRegistrantReminderLedger(liveEventIds, todayKey) {
  const ledger = getRegistrantReminderLedger();
  Object.keys(ledger).forEach(eventId => {
    const dateKey = liveEventIds[eventId];
    if (dateKey && dateKey >= todayKey) return;
    delete ledger[eventId];
    __reminderLedgerDirty = true;
  });
}

/** "Your appointment on Tue, Mar 3, 2026" / "Reminder: Chair Yoga tomorrow". */
function buildRegistrantReminderSubject(session, offset) {
  const title = session.title || 'your program';
  if (offset === REMINDER_CONFIRMATION_OFFSET) {
    return `${title} — ${formatDateLabel(session.date)}`;
  }
  const when = offset === 0 ? 'today' : (offset === 1 ? 'tomorrow' : `in ${offset} days`);
  return `Reminder: ${title} ${when}`;
}

/**
 * The message itself. Plain text on purpose — it is four lines of fact, it
 * reaches a phone unmangled, and nothing in it is worth a stylesheet.
 *
 * THE TIME LINE IS THE POINT for an appointment: it names the person's own
 * slot, which is the one thing the shared calendar event cannot say.
 */
function buildRegistrantReminderBody(session, person, offset, daysAway) {
  const lines = [];
  lines.push(person.name ? `Hello ${person.name},` : 'Hello,');
  lines.push('');
  if (offset === REMINDER_CONFIRMATION_OFFSET) {
    lines.push(person.time
      ? `You are booked for ${session.title} on ${formatDateLabel(session.date)} at ${person.time}.`
      : `You are booked for ${session.title} on ${formatDateLabel(session.date)}.`);
  } else {
    const when = daysAway === 0 ? 'today' : (daysAway === 1 ? 'tomorrow'
      : `on ${formatDateLabel(session.date)}`);
    lines.push(person.time
      ? `A reminder that ${session.title} is ${when} at ${person.time}.`
      : `A reminder that ${session.title} is ${when}.`);
  }
  if (!person.time && session.time) lines.push(`Time: ${session.time}`);
  lines.push(`Date: ${formatDateLabel(session.date)}`);
  if (session.location) lines.push(`Location: ${session.location}`);
  lines.push('');
  lines.push('If you can no longer make it, please let us know so the place can go to somebody else.');
  return lines.join('\n');
}


// --- the menu ----------------------------------------------------------------

/**
 * MENU ENTRY: run the reminder pass now instead of waiting for the next sync.
 *
 * Reads both tables fresh — whoever pressed this has just changed a
 * Notify_Mode cell and expects that cell counted — and clears the policy
 * memo first for the same reason.
 */
function sendRegistrantRemindersNow() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  invalidateNotificationPolicyCache();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registrantRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.Registrant_Dash, 'Event_ID');

  let result;
  try {
    result = sendRegistrantReminders(sessionRows, registrantRows);
  } catch (err) {
    log(`⚠️ Could not send the registrant reminders (${err}).`);
    toastIfPossible(`Could not send the reminders ⚠️ — ${err}`);
    return;
  }
  flushAdminDigest('Registrant reminders');

  toastIfPossible(result.sent > 0
    ? `Reminders sent ✅ — ${result.sent} email(s)` + (result.held > 0
      ? `, ${result.held} held for the next run.` : '.')
    : `Nobody is due a reminder right now — set Notify_Mode on ${SHEET_NAMES.PROGRAM_OPTIONS} ` +
      `to choose which programs send them.`);
}
