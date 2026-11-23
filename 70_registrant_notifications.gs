// ============================================================================
// 9e. REGISTRANT NOTIFICATIONS  (what the people signed up for are told)
// ============================================================================
//
// ONE EMAIL A WEEK PER PERSON (November 2026). Members were getting a message
// per program per reminder, plus Google's own invitation and update mail for
// every calendar change, and the office heard the same complaint again and
// again: too much mail, so people deleted it unread. So:
//
//   THE FRIDAY EMAIL. From Friday at WEEKLY_EMAIL_SEND_HOUR, everybody with an
//   Active registration in the coming Monday–Sunday is sent ONE message
//   listing all of it, day by day, with any waitlisted places listed apart.
//   An appointment shows the person's own time, which is the one thing the
//   shared calendar event cannot say.
//
//   THE "ADDED TO YOUR WEEK" EMAIL. Somebody who signs up on Saturday for
//   Tuesday, or comes off a waitlist on Wednesday for Thursday, has missed
//   the Friday email for that week. They get one short message naming only
//   what is new, at most once per sync, and nothing for a week that has not
//   had its Friday email yet — that week's Friday email will carry it.
//
// WHAT IT REPLACED. The per-program Week_Before, Day_Before, Morning_Of,
// Other_Reminders and Confirm_On_Booking emails. Those ticks on
// Program_Settings (section 9h) are still read by the mail-volume forecast
// (99zza) but no longer send anything. Add_Guest_To_Calendar still decides
// who is put on a calendar event (section 5b), and that is now silent too.
//
// THE CONFIG SWITCH STILL WINS for the calendar: "📧 Calendar Invitations"
// set to "Do not invite" means nobody is added to a guest list.
//
// SENDING IS RECORDED, NOT RE-DERIVED. The ledger keeps, per week and per
// address, which sessions that person has been told about, so the hourly sync
// that finds the same rows again sends nothing.
// ============================================================================

/** The reminder cadence a program falls back to when nothing else says. */
const DEFAULT_REMINDER_DAYS = [1];

/** The largest day count Other_Reminders keeps (read by parseReminderDays). */
const REMINDER_FORWARD_DAYS = 30;

/**
 * The hours of the day a registrant email may go out, in TIMEZONE: from
 * REMINDER_EARLIEST_HOUR up to, not including, REMINDER_LATEST_HOUR.
 *
 * THE FAILURE IT PREVENTS. This pass rides the hourly sync, so without a
 * window it runs at whatever hour the sync runs, including the small ones.
 * People got "your appointment is tomorrow at 2:15" at 12:10am, which reads as
 * a malfunction even when the content is right.
 *
 * Nothing is dropped by waiting: an email due outside the window is simply not
 * sent yet, its ledger entry stays unwritten, and the first sync inside the
 * window sends it.
 *
 * NOT the same thing as the pause switch (section 9f), which DROPS what it
 * holds. This defers; nothing is lost.
 */
const REMINDER_EARLIEST_HOUR = 9;
const REMINDER_LATEST_HOUR = 20;

/** Is it a decent hour to email registrants? */
function isWithinRegistrantReminderHours(now) {
  const at = now || new Date();
  const hour = Number(Utilities.formatDate(at, TIMEZONE, 'H'));
  return hour >= REMINDER_EARLIEST_HOUR && hour < REMINDER_LATEST_HOUR;
}

/**
 * The most registrant emails one run will send, and the floor it will not dig
 * the day's mail quota below (the `reserve` sendRationedEmail() is given, see
 * section 9f). This pass rides the hourly sync, and one hour must not spend
 * the whole workbook's mail on itself. Anything held back keeps its ledger
 * entry unwritten and goes out on the next sync — so a Friday with 110 people
 * to write to is three syncs, 10, 11 and noon, not one.
 *
 * THE FLOOR IS THE LOWER OF THE TWO on purpose. The leader alert pass runs
 * first in the same execution and stops at LEADER_ALERT_QUOTA_RESERVE so there
 * is something left here. What stays under this floor is the handful of
 * messages notifyAdmin() needs to report that any of this went wrong.
 */
const MAX_REMINDER_EMAILS_PER_RUN = 40;
const REMINDER_QUOTA_RESERVE = 10;

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
  // NOTHING, for every kind (September 2026). A program new to the calendar
  // used to be born invited — and an appointment one reminded and confirmed
  // too — which meant a placeholder or a rental on a program calendar mailed
  // people before anybody had looked at it. Now a new row is born with every
  // box clear and staff tick what they want; an existing row's ticks are
  // untouched. personalizeTime is not a send, so an appointment keeps it.
  //
  // EXCEPT ONE ALERT FOR A PERSONAL ASSISTANCE PROGRAM (November 2026, from the
  // office: people were deleting mail unread because there was so much of it).
  // The appointment is the one thing a member cannot be left to find in the
  // Sunday announcement, so an assistance row is born with Day_Before only —
  // no calendar invite, no booking confirmation, no week-before, no morning-of.
  if (isAssistance) {
    return { invite: false, remind: true, days: [1], confirmTime: false, personalizeTime: true };
  }
  return { invite: false, remind: false, days: [], confirmTime: false, personalizeTime: false };
}

/**
 * Reads "1, 0" / "7 and 1" / "3" out of an Other_Reminders cell into [1, 0].
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

/**
 * { programKey: policy } read off Program_Settings once per execution. The tab
 * is a few hundred rows at most and both the invitation pass and the reminder
 * pass want it, so it is read once and memoized rather than re-opened per
 * session.
 */
let __notificationPolicyRowsCache = null;

function invalidateNotificationPolicyCache() {
  __notificationPolicyRowsCache = null;
  // The same tab feeds the program aliases (99zzc); a rewrite of it is a
  // rewrite of both. Guarded for a deployment without 99zzc.
  try { invalidateProgramAliasIndex(); } catch (err) { /* nothing to forget */ }
}

function readNotificationPolicyRows() {
  if (__notificationPolicyRowsCache) return __notificationPolicyRowsCache;
  const out = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS) : null;
  if (sheet) {
    const headers = HEADERS.Program_Settings;
    const map = getIndexMap(headers);
    readSimpleTableValues(sheet, headers).forEach(row => {
      const key = notificationProgramKey(row[map['Event']], row[map['Location']]);
      if (key === '|') return;
      out[key] = row;
    });
  }
  __notificationPolicyRowsCache = out;
  return out;
}

/** The key Program_Settings rows and session rows are matched on. */
function notificationProgramKey(title, location) {
  return `${normalizeNameKey(title)}|${normalizeNameKey(location)}`;
}

/**
 * The policy governing one SESSION — its program's row where there is one,
 * its kind's default where there is not.
 *
 * A program the calendar has only just introduced has no row until the next
 * Program_Settings refresh, and a session must not go unnotified in
 * the meantime: an absent ROW is its kind's default. An absent TICK, on a row
 * that exists, is a decision — see 9h.
 */
function notificationPolicyForSession(session) {
  // Through the program's filed title (99zzc), so a session carrying an
  // alias or a "CANCELLED…:" prefix follows its program's ticks.
  const row = readNotificationPolicyRows()[programSettingsKey(session.title, session.location)];
  if (!row) return defaultNotificationPolicy(!!session.isAssistance);
  return policyFromNotificationRow(row, getIndexMap(HEADERS.Program_Settings),
    !!session.isAssistance);
}



// --- the weekly email --------------------------------------------------------

/** When a week's email starts going out: the Friday before it, from 10am. */
const WEEKLY_EMAIL_SEND_HOUR = 10;

/** What this pass calls itself to recordDayLongMailHold() (`76`). */
const WEEKLY_EMAIL_MAIL_PASS = 'weeklyRegistrantEmail';

/**
 * Who has been told about what:
 *   { firstWeek: 'yyyy-MM-dd', weeks: { mondayKey: { email: [sessionKey…] } } }
 * where a sessionKey is "eventId|dateKey". firstWeek is the Monday of the
 * first week this pass ever wrote about — see firstWeeklyEmailWeek_().
 */
const WEEKLY_EMAIL_LEDGER_PROP_KEY = 'WEEKLY_REGISTRANT_EMAIL_V1';
const WEEKLY_EMAIL_LEDGER_CHUNK_CHARS = 8000;
const WEEKLY_EMAIL_LEDGER_MAX_CHUNKS = 40;

/** The per-program reminder ledger this pass replaced; cleared on first run. */
const RETIRED_REMINDER_LEDGER_PROP_KEY = 'REGISTRANT_REMINDERS_V1';

let __weeklyEmailLedgerCache = null;
let __weeklyEmailLedgerDirty = false;

function getWeeklyEmailLedger() {
  if (__weeklyEmailLedgerCache) return __weeklyEmailLedgerCache;
  const raw = readChunkedScriptProperty(WEEKLY_EMAIL_LEDGER_PROP_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Unreadable reads as EMPTY but keeps no firstWeek, so the pass starts
    // again from the coming week rather than re-sending the one under way.
    log(`⚠️ The weekly registrant email ledger could not be parsed (${err}) — starting fresh.`);
  }
  const ledger = parsed && typeof parsed === 'object' ? parsed : {};
  if (!ledger.weeks || typeof ledger.weeks !== 'object') ledger.weeks = {};
  __weeklyEmailLedgerCache = ledger;
  return ledger;
}

function saveWeeklyEmailLedger() {
  if (!__weeklyEmailLedgerDirty || !__weeklyEmailLedgerCache) return;
  writeChunkedScriptProperty(WEEKLY_EMAIL_LEDGER_PROP_KEY, JSON.stringify(__weeklyEmailLedgerCache),
    WEEKLY_EMAIL_LEDGER_CHUNK_CHARS, WEEKLY_EMAIL_LEDGER_MAX_CHUNKS);
  __weeklyEmailLedgerDirty = false;
}

/** "2026-11-20" moved by `days`, on the calendar date alone (no clock, no DST). */
function shiftDateKey_(dateKey, days) {
  const parts = String(dateKey).split('-').map(Number);
  const moved = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  const pad = n => String(n).padStart(2, '0');
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** Monday 1 … Sunday 7, for a date key. */
function isoWeekdayOfDateKey_(dateKey) {
  const parts = String(dateKey).split('-').map(Number);
  const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week a date key falls in. */
function mondayOfDateKey_(dateKey) {
  return shiftDateKey_(dateKey, 1 - isoWeekdayOfDateKey_(dateKey));
}

/** Has the Friday email for the week starting `mondayKey` been due yet? */
function weeklyEmailIsDue_(mondayKey, todayKey, hour) {
  const fridayKey = shiftDateKey_(mondayKey, -3);
  return todayKey > fridayKey || (todayKey === fridayKey && hour >= WEEKLY_EMAIL_SEND_HOUR);
}

/**
 * The first week this pass writes about, decided once, on its first run.
 *
 * Monday to Wednesday: the week already under way, so the rest of it is not
 * left with no word at all now that the per-program reminders have stopped.
 * Thursday to Sunday: the coming week. A Thursday start would be a "your week"
 * email with three days left in it, sent a day before the real one.
 */
function firstWeeklyEmailWeek_(todayKey) {
  const monday = mondayOfDateKey_(todayKey);
  return isoWeekdayOfDateKey_(todayKey) <= 3 ? monday : shiftDateKey_(monday, 7);
}

/** True for "CANCELLED DUE TO ILLNESS: X" and its kin (see 99zzc). */
function isCancelledSessionTitle_(title) {
  return /^\s*cancel{1,2}ed\b[^:]{0,60}:/i.test(String(title || ''));
}

/** "10:00 AM" / "2:15 PM - 3:00 PM" → minutes after midnight, for sorting. */
function minutesOfTimeLabel_(label) {
  const match = String(label || '').match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]/);
  if (!match) return 24 * 60;
  let hour = Number(match[1]) % 12;
  if (/p/i.test(match[3])) hour += 12;
  return hour * 60 + Number(match[2] || 0);
}

/**
 * Everybody's registrations for the weeks this run may write about, grouped
 * by address. Pure apart from the header map, so the tests drive it directly.
 *
 * Returns { email: { names: [..], weeks: { mondayKey: [item…] } } } where an
 * item is { key, dateKey, date, title, time, location, waitlisted }. Only
 * sessions from today on, never a cancelled session, never an address that
 * cannot be mailed, and one item per session per address even when two
 * people share the address (a couple), with both names kept for the greeting.
 */
function collectWeeklyEmailItems(sessionRows, registrantRows, weekKeys, todayKey) {
  const sessMap = getIndexMap(HEADERS.All_Program_Sessions);
  const regMap = getIndexMap(HEADERS.All_Registrants);
  const sessionsByKey = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessMap['Event_Date']]);
    if (!eventId || !date) return;
    sessionsByKey[`${eventId}|${formatDateKey(date)}`] = {
      title: String(row[sessMap['Clean_Title']] || '').trim(),
      location: String(row[sessMap['Location']] || '').trim(),
      time: eventTimeLabelOf(row[sessMap['Event_Time']]),
      isAssistance: isAssistanceColumnValue(row[sessMap['Personalized_Assistance']])
    };
  });

  const wantedWeeks = {};
  weekKeys.forEach(key => { wantedWeeks[key] = true; });
  const byEmail = {};
  (registrantRows || []).forEach(row => {
    const status = String(row[regMap['Program_Status']] || '').trim();
    if (status !== 'Active' && status !== 'Waitlisted') return;
    const email = String(row[regMap['Email']] || '').trim().toLowerCase();
    if (!isPlausibleEmail(email)) return;
    const date = coerceDate(row[regMap['Event_Date']]);
    if (!date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < todayKey) return;
    const weekKey = mondayOfDateKey_(dateKey);
    if (!wantedWeeks[weekKey]) return;

    const eventId = String(row[regMap['Event_ID']] || '').trim();
    const key = `${eventId}|${dateKey}`;
    const session = sessionsByKey[key] || null;
    const title = (session && session.title) || String(row[regMap['Event']] || '').trim();
    if (!title || isCancelledSessionTitle_(title)) return;
    // The person's OWN time for an appointment; the session's for anything else.
    const ownTime = eventTimeLabelOf(row[regMap['Event_Time']]);
    const time = session && !session.isAssistance ? (session.time || ownTime) : ownTime;

    const person = byEmail[email] || (byEmail[email] = { email, names: [], weeks: {} });
    const name = String(row[regMap['Name']] || '').trim();
    if (name && person.names.indexOf(name) === -1) person.names.push(name);
    const list = person.weeks[weekKey] || (person.weeks[weekKey] = []);
    const existing = list.filter(item => item.key === key)[0];
    const waitlisted = status === 'Waitlisted';
    if (existing) {
      // Active beats Waitlisted when one address holds both on one session.
      if (!waitlisted) existing.waitlisted = false;
      return;
    }
    list.push({
      key, dateKey, date, title, time, waitlisted,
      location: (session && session.location) || String(row[regMap['Location']] || '').trim()
    });
  });

  Object.keys(byEmail).forEach(email => {
    Object.keys(byEmail[email].weeks).forEach(weekKey => {
      byEmail[email].weeks[weekKey].sort((a, b) =>
        (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0) ||
        (minutesOfTimeLabel_(a.time) - minutesOfTimeLabel_(b.time)) ||
        a.title.localeCompare(b.title));
    });
  });
  return byEmail;
}

/**
 * The Friday email, or the "added to your week" one, for one person and week.
 * Returns null when there is nothing to send. `told` is what the ledger says
 * they have already been sent for that week, or null if nothing yet.
 */
function planWeeklyEmail(person, weekKey, items, told, todayKey) {
  const active = items.filter(item => !item.waitlisted);
  if (told === null || told === undefined) {
    if (active.length === 0) return null;
    return {
      kind: 'weekly',
      subject: buildWeeklyEmailSubject(weekKey),
      body: buildWeeklyEmailBody(person.names, weekKey, items, todayKey, person.email),
      keys: active.map(item => item.key)
    };
  }
  const already = {};
  told.forEach(key => { already[key] = true; });
  const added = active.filter(item => !already[item.key]);
  if (added.length === 0) return null;
  return {
    kind: 'added',
    subject: buildAddedToWeekSubject(added),
    body: buildAddedToWeekBody(person.names, weekKey, added, person.email),
    keys: told.concat(added.map(item => item.key))
  };
}

function weekRangeLabel_(weekKey) {
  const short = key => Utilities.formatDate(parseDateKey(key), TIMEZONE, 'EEE, MMM d');
  return `${short(weekKey)} – ${short(shiftDateKey_(weekKey, 6))}`;
}

function greetingFor_(names) {
  if (names.length === 1) return `Hello ${names[0]},`;
  if (names.length === 2) return `Hello ${names[0]} and ${names[1]},`;
  return 'Hello,';
}

function itemLine_(item, withDate) {
  const parts = [item.title];
  if (withDate) parts.push(Utilities.formatDate(item.date, TIMEZONE, 'EEE, MMM d'));
  if (item.time) parts.push(item.time);
  if (item.location) parts.push(item.location);
  return `  • ${parts.join(', ')}`;
}

/** "Your New Horizons programs for the week of Mon, Nov 23". */
function buildWeeklyEmailSubject(weekKey) {
  return `Your ${centerShortNameForMail_()} programs for the week of ` +
    Utilities.formatDate(parseDateKey(weekKey), TIMEZONE, 'EEE, MMM d');
}

/**
 * The Friday email. Plain text on purpose: it reaches a phone unmangled, and
 * a list of days is the whole content.
 */
function buildWeeklyEmailBody(names, weekKey, items, todayKey, email) {
  const active = items.filter(item => !item.waitlisted);
  const waiting = items.filter(item => item.waitlisted);
  const underWay = todayKey > shiftDateKey_(weekKey, -1);
  const lines = [greetingFor_(names), ''];
  lines.push(underWay
    ? `Here is everything you are registered for in the rest of this week (${weekRangeLabel_(weekKey)}):`
    : `Here is everything you are registered for next week (${weekRangeLabel_(weekKey)}):`);
  let day = '';
  active.forEach(item => {
    if (item.dateKey !== day) {
      day = item.dateKey;
      lines.push('');
      lines.push(Utilities.formatDate(item.date, TIMEZONE, 'EEEE, MMM d'));
    }
    lines.push(itemLine_(item, false));
  });
  if (waiting.length > 0) {
    lines.push('');
    lines.push('You are on the waitlist for:');
    waiting.forEach(item => lines.push(itemLine_(item, true)));
  }
  lines.push('');
  lines.push('This is your one reminder for the week. If you sign up for something else this week, ' +
    'we will send a short note about just that.');
  lines.push('');
  lines.push('If you can no longer make something, please let us know so the place can go to somebody else.');
  weeklyOptOutFooterLines(email).forEach(line => lines.push(line));
  return lines.join('\n');
}

/** "Added to your week: Chair Yoga on Tue, Nov 24" / "2 programs added to your week". */
function buildAddedToWeekSubject(added) {
  if (added.length === 1) {
    return `Added to your week: ${added[0].title} on ` +
      Utilities.formatDate(added[0].date, TIMEZONE, 'EEE, MMM d');
  }
  return `${added.length} programs added to your week`;
}

function buildAddedToWeekBody(names, weekKey, added, email) {
  const lines = [greetingFor_(names), ''];
  lines.push(added.length === 1
    ? `You are now registered for this, in the week of ${weekRangeLabel_(weekKey)}:`
    : `You are now registered for these, in the week of ${weekRangeLabel_(weekKey)}:`);
  lines.push('');
  added.forEach(item => lines.push(itemLine_(item, true)));
  lines.push('');
  lines.push('Everything else in your week is as in our last email.');
  lines.push('');
  lines.push('If you can no longer make it, please let us know so the place can go to somebody else.');
  weeklyOptOutFooterLines(email).forEach(line => lines.push(line));
  return lines.join('\n');
}

/** "New Horizons" — the center's name as a subject line can carry it. */
function centerShortNameForMail_() {
  const name = String(typeof CENTER_NAME === 'string' ? CENTER_NAME : '').trim();
  return name.replace(/\s+Senior Center$/i, '') || 'New Horizons';
}

/**
 * THE PASS. Sends each person's Friday email for every week that has had its
 * Friday (from firstWeek on), and an "added to your week" note for anything
 * new in a week already written about. Returns { sent, weekly, added, held,
 * paused, stoppedForToday }.
 *
 * Safe to call every hour: the ledger makes a repeat send impossible, and an
 * hour with nothing new does no work beyond the read.
 *
 * options.ignoreQuietHours skips the hours window and the day-long hold — the
 * menu item passes it. It never brings a week's Friday email forward.
 * options.now is for tests.
 */
function sendWeeklyRegistrantEmails(sessionRows, registrantRows, options) {
  const opts = options || {};
  const result = { sent: 0, weekly: 0, added: 0, held: 0, paused: 0, optedOut: 0, stoppedForToday: false };
  if (!opts.ignoreQuietHours && dayLongMailHoldInEffect(WEEKLY_EMAIL_MAIL_PASS)) {
    result.stoppedForToday = true;
    return result;
  }
  const now = opts.now || new Date();
  if (!opts.ignoreQuietHours && !isWithinRegistrantReminderHours(now)) return result;

  const todayKey = formatDateKey(now);
  const hour = Number(Utilities.formatDate(now, TIMEZONE, 'H'));
  const ledger = getWeeklyEmailLedger();
  if (!ledger.firstWeek) {
    ledger.firstWeek = firstWeeklyEmailWeek_(todayKey);
    __weeklyEmailLedgerDirty = true;
    // The ledger of the per-program reminders this replaced: nothing reads it
    // any more, and it holds Script Properties space every other store shares.
    clearChunkedScriptProperty(RETIRED_REMINDER_LEDGER_PROP_KEY);
  }

  // Forget weeks that are over.
  const thisMonday = mondayOfDateKey_(todayKey);
  Object.keys(ledger.weeks).forEach(weekKey => {
    if (weekKey < thisMonday) { delete ledger.weeks[weekKey]; __weeklyEmailLedgerDirty = true; }
  });

  const weekKeys = [thisMonday, shiftDateKey_(thisMonday, 7)]
    .filter(weekKey => weekKey >= ledger.firstWeek && weeklyEmailIsDue_(weekKey, todayKey, hour));
  if (weekKeys.length === 0) {
    saveWeeklyEmailLedger();
    return result;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessions = sessionRows || getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.All_Program_Sessions, 'Event_ID');
  const rows = registrantRows || getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID');
  const byEmail = collectWeeklyEmailItems(sessions, rows, weekKeys, todayKey);

  const weeklyCounts = {};
  // Addresses that asked to stop (99zzf). Dropped before anything is planned,
  // so nothing is recorded for them and a person put back later is treated
  // like anybody else.
  const optedOut = weeklyEmailOptOutSet();
  const emails = Object.keys(byEmail).sort().filter(email => {
    if (!optedOut[email]) return true;
    result.optedOut++;
    return false;
  });
  for (const weekKey of weekKeys) {
    const toldThisWeek = ledger.weeks[weekKey] || {};
    for (const email of emails) {
      if (result.stoppedForToday) break;
      const person = byEmail[email];
      const items = person.weeks[weekKey];
      if (!items) continue;
      const plan = planWeeklyEmail(person, weekKey, items,
        Object.prototype.hasOwnProperty.call(toldThisWeek, email) ? toldThisWeek[email] : null, todayKey);
      if (!plan) continue;
      if (result.sent >= MAX_REMINDER_EMAILS_PER_RUN) { result.held++; continue; }

      const outcome = sendRationedEmail({
        to: email,
        subject: plan.subject,
        body: plan.body,
        reserve: REMINDER_QUOTA_RESERVE,
        alreadySent: () => {
          const told = toldThisWeek[email];
          return !!told && plan.keys.every(key => told.indexOf(key) !== -1);
        },
        recordSent: () => {
          toldThisWeek[email] = plan.keys.slice();
          ledger.weeks[weekKey] = toldThisWeek;
          __weeklyEmailLedgerDirty = true;
        }
      });

      if (outcome.status === 'sent') {
        result.sent++;
        if (plan.kind === 'weekly') {
          result.weekly++;
          weeklyCounts[weekKey] = (weeklyCounts[weekKey] || 0) + 1;
        } else {
          result.added++;
          spoolOfficeNote('Registrant emails',
            `${person.names[0] ? `${person.names[0]} <${email}>` : email} — added to their week of ` +
            `${weekRangeLabel_(weekKey)}`);
        }
        continue;
      }
      if (outcome.status === 'duplicate') continue;
      if (outcome.status === 'held') {
        result.held++;
        if (mailHoldLastsAllDay(outcome)) {
          result.stoppedForToday = true;
          if (recordDayLongMailHold(WEEKLY_EMAIL_MAIL_PASS)) {
            noteForAdmin('Weekly registrant emails held until tomorrow',
              `The weekly emails stopped for the rest of today (${outcome.error}). Nothing has been ` +
              `recorded as sent, so tomorrow's first sync sends everybody still waiting.`);
          }
        }
        continue;
      }
      // PAUSED: the mailer has recorded it as spent (section 9f).
      if (outcome.status === 'paused') { result.paused++; continue; }
      log(`⚠️ Could not send the weekly email to ${email} (${outcome.error}).`);
      if (outcome.status === 'failed') {
        noteForAdmin('Weekly emails that could not be sent',
          `${email} could not be sent their weekly email (${outcome.error}). It will be tried again next sync.`);
      }
    }
  }

  saveWeeklyEmailLedger();
  Object.keys(weeklyCounts).forEach(weekKey => {
    spoolOfficeNote('Registrant emails',
      `${weeklyCounts[weekKey]} weekly email(s) sent for ${weekRangeLabel_(weekKey)}`);
  });
  if (result.sent > 0 || result.held > 0) {
    log(`Weekly registrant emails: ${result.sent} sent` +
      (result.held > 0 ? `; ${result.held} held for the next sync.` : '.'));
  }
  if (result.paused > 0) {
    log(`Weekly registrant emails: ${result.paused} dropped — mail to members and leaders is paused.`);
  }
  return result;
}


// --- the menu ----------------------------------------------------------------

/**
 * MENU ENTRY: run the weekly email pass now instead of waiting for the next
 * sync. Sends nothing for a week whose Friday has not come yet.
 */
function sendWeeklyRegistrantEmailsNow() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  let result;
  try {
    result = sendWeeklyRegistrantEmails(null, null, { ignoreQuietHours: true });
  } catch (err) {
    log(`⚠️ Could not send the weekly registrant emails (${err}).`);
    toastIfPossible(`Could not send the weekly emails ⚠️ — ${err}`);
    return;
  }
  flushAdminDigest('Weekly registrant emails');
  toastIfPossible(result.sent > 0
    ? `Weekly emails sent ✅ — ${result.sent}` + (result.held > 0 ? `, ${result.held} held for the next run.` : '.')
    : 'Nobody is due a weekly email right now. They go out from Friday at 10am.');
}
