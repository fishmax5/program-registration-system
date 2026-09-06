// ============================================================================
// 5b. CALENDAR INVITATIONS  (registrants -> guests on the real calendar event)
// ============================================================================
//
// A registration lands in this workbook, which is not where the person who
// made it looks. This step closes that gap: anyone who signs up is added as a
// GUEST on the actual Google Calendar event, so the program appears in their
// own calendar, with Google's own reminders, and moves if the event moves.
//
// THREE RULES, all of them about not sending mail we cannot justify:
//
//   UPCOMING ONLY. A past event's guest list is history. Adding somebody to
//   last Tuesday emails them an invitation to something that has happened.
//
//   ACTIVE ONLY, AND SYMMETRIC. Active registrants are invited; anyone whose
//   row is Cancelled, Superseded or Waitlisted is REMOVED if they were
//   previously invited. A one-way invite would leave a cancelled member
//   holding a calendar entry for a session they withdrew from, which is worse
//   than never having invited them.
//
//   ONCE. The ledger below records who has already been added per event, so a
//   sync that changes nothing sends nothing — without it, every hourly run
//   would re-add the same guests, and Google treats each add as an event
//   update worth notifying about.
//
// THE OFFICE IS NOT A GUEST. Addresses ticked for Calendar_Invite_Guest on
// Config's Admin Notification Emails table used to be added to the event
// alongside the registrants, which put every session anybody signed up for
// onto four or five staff calendars and mailed them a Google invitation for
// each one. They are told the same thing by mail instead: one digest per run
// (notifyOfficeOfCalendarInvites) naming every session that changed, who was
// invited to it and who came off. Staff addresses already sitting on events
// from the old behaviour are taken off by the one-time Admin item
// removeAdminGuestsFromCalendarEvents().
//
// Governed by Config's "📧 Calendar Invitations" switch (see
// CALENDAR_INVITE_OPTIONS); off means this whole section is a no-op. Under
// that switch, each PROGRAM says whether it wants invitations at all, with
// Program_Settings' Add_Guest_To_Calendar tick — see sections 9e and 9h.
// ============================================================================

/** Who we have already put on which event's guest list: { Event_ID: [email...] }. */
const CALENDAR_INVITE_PROP_KEY = 'CALENDAR_INVITES_V1';

let __calendarInviteLedgerCache = null;
let __calendarInviteLedgerDirty = false;

function getCalendarInviteLedger() {
  if (__calendarInviteLedgerCache) return __calendarInviteLedgerCache;
  const raw = PropertiesService.getScriptProperties().getProperty(CALENDAR_INVITE_PROP_KEY);
  __calendarInviteLedgerCache = raw ? JSON.parse(raw) : {};
  return __calendarInviteLedgerCache;
}

function saveCalendarInviteLedger() {
  if (!__calendarInviteLedgerDirty || !__calendarInviteLedgerCache) return;
  PropertiesService.getScriptProperties()
    .setProperty(CALENDAR_INVITE_PROP_KEY, JSON.stringify(__calendarInviteLedgerCache));
  __calendarInviteLedgerDirty = false;
}

/**
 * Ceiling on how many EVENTS one execution will touch. A guest add is a
 * calendar write; the hourly sync this rides on has a six-minute budget and
 * real work to do before it gets here. Anything left over is picked up next
 * run — the ledger makes the work strictly decreasing, so a backlog drains.
 */
const MAX_INVITE_EVENTS_PER_RUN = 40;

/**
 * Splits registrant rows into the emails that SHOULD be on each session's
 * guest list and the ones that should not.
 *
 * A person appearing in both (two rows, one cancelled and one active) counts
 * as wanted — the active row wins. Shared by the pass that actually sends and
 * by the dialog that reports what sending would do, so the two can never
 * disagree about a session having work outstanding.
 */
function partitionInviteEmails(rows, lrMap, sessionByEventId) {
  const wanted = {};
  const unwanted = {};
  (rows || []).forEach(row => {
    const eventId = String(row[lrMap['Event_ID']] || '').trim();
    if (!sessionByEventId[eventId]) return;
    const email = String(row[lrMap['Email']] || '').trim().toLowerCase();
    if (!isPlausibleEmail(email)) return;
    const status = String(row[lrMap['Program_Status']] || '').trim();
    const bucket = status === 'Active' ? wanted : unwanted;
    if (!bucket[eventId]) bucket[eventId] = new Set();
    bucket[eventId].add(email);
  });
  return { wanted, unwanted };
}

/**
 * Brings upcoming sessions' calendar guest lists into line with their
 * registrants. Returns { invited, removed, eventsTouched, deferred }.
 *
 * Every upcoming session by default — that is the hourly sync's job. Pass
 * `options.onlyEventIds` (a Set) to confine the pass to named sessions, which
 * is what the menu's picker does: a manual run is nearly always about one
 * program, and sweeping everything is not something to do by accident. See
 * showCalendarInviteDialog().
 *
 * Safe to call on every sync and safe to call by hand: it computes the
 * difference against the ledger and does nothing when there is none.
 */
function inviteRegistrantsToCalendarEvents(sessionRows, registrantRows, options) {
  const onlyEventIds = (options && options.onlyEventIds) || null;
  const result = { invited: 0, removed: 0, eventsTouched: 0, deferred: 0, digests: 0, skipped: false };
  if (!shouldInviteRegistrants()) {
    result.skipped = true;
    return result;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regHeaders = HEADERS.All_Program_Sessions;
  const regMap = getIndexMap(regHeaders);
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const sessions = sessionRows || (registrySheet ? getSectionedRows(registrySheet, regHeaders, 'Event_ID') : []);
  if (sessions.length === 0) return result;

  const todayKey = formatDateKey(new Date());
  const sessionByEventId = {};
  sessions.forEach(row => {
    const eventId = String(row[regMap['Event_ID']] || '').trim();
    const date = coerceDate(row[regMap['Event_Date']]);
    const calendarId = String(row[regMap['Calendar_Source']] || '').trim();
    if (!eventId || !date || !calendarId) return;
    if (formatDateKey(date) < todayKey) return; // upcoming only
    if (onlyEventIds && !onlyEventIds.has(eventId)) return;
    const session = {
      eventId, date, calendarId,
      title: String(row[regMap['Clean_Title']] || '').trim(),
      location: String(row[regMap['Location']] || '').trim(),
      isAssistance: isAssistanceColumnValue(row[regMap['Personalized_Assistance']])
    };
    // THE PROGRAM'S OWN SETTING, under the Config switch already checked
    // above: a program with Add_Guest_To_Calendar unticked keeps its guest list
    // empty, whatever else it sends. See section 9e.
    if (!notificationPolicyForSession(session).invite) return;
    sessionByEventId[eventId] = session;
  });
  if (Object.keys(sessionByEventId).length === 0) return result;

  const lrHeaders = HEADERS.All_Registrants;
  const lrMap = getIndexMap(lrHeaders);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const rows = registrantRows ||
    (registrantsSheet ? getSectionedRows(registrantsSheet, lrHeaders, 'Event_ID') : []);

  const { wanted, unwanted } = partitionInviteEmails(rows, lrMap, sessionByEventId);
  const nameByEmail = registrantNamesByEmail(rows, lrMap);
  const ledger = getCalendarInviteLedger();
  const eventIds = Object.keys(sessionByEventId);
  // What the office is told about afterwards, rather than added to. One entry
  // per event this pass actually changed; the digest is sent once at the end,
  // so a run that touches thirty sessions is one message and not thirty
  // calendar invitations.
  const changes = [];

  for (const eventId of eventIds) {
    const already = new Set(ledger[eventId] || []);
    const want = wanted[eventId] || new Set();
    const drop = unwanted[eventId] || new Set();

    const toAdd = Array.from(want).filter(email => !already.has(email));
    const toRemove = Array.from(drop).filter(email => already.has(email) && !want.has(email));
    if (toAdd.length === 0 && toRemove.length === 0) continue;

    if (result.eventsTouched >= MAX_INVITE_EVENTS_PER_RUN) {
      result.deferred++;
      continue;
    }

    const session = sessionByEventId[eventId];
    const event = findCalendarEventForSession(session);
    if (!event) {
      log(`ℹ️ Calendar invitations: no calendar event found for "${session.title}" on ` +
        `${formatDateLabel(session.date)} (${session.location}) — nobody was invited to it.`);
      continue;
    }

    let changed = false;
    const addedHere = [];
    const removedHere = [];
    toAdd.forEach(email => {
      try {
        event.addGuest(email);
        already.add(email);
        addedHere.push(email);
        result.invited++;
        changed = true;
      } catch (err) {
        log(`⚠️ Could not invite ${email} to "${session.title}" on ${formatDateLabel(session.date)} (${err}).`);
      }
    });
    toRemove.forEach(email => {
      try {
        event.removeGuest(email);
        already.delete(email);
        removedHere.push(email);
        result.removed++;
        changed = true;
      } catch (err) {
        log(`⚠️ Could not remove ${email} from "${session.title}" on ${formatDateLabel(session.date)} (${err}).`);
      }
    });

    if (changed) {
      ledger[eventId] = Array.from(already);
      __calendarInviteLedgerDirty = true;
      result.eventsTouched++;
      changes.push({
        session,
        added: addedHere.map(email => describeInvitee(email, nameByEmail)),
        removed: removedHere.map(email => describeInvitee(email, nameByEmail))
      });
    }
  }

  saveCalendarInviteLedger();
  // AFTER the ledger is saved: a digest that failed to send must not be able
  // to cost the run the record of guests it did add.
  result.digests = notifyOfficeOfCalendarInvites(changes);
  if (result.invited > 0 || result.removed > 0) {
    log(`Calendar invitations: ${result.invited} guest(s) added, ${result.removed} removed, ` +
      `across ${result.eventsTouched} event(s)` + (result.deferred > 0 ? `; ${result.deferred} left for the next run.` : '.'));
    // The calendar just changed under the cached event lists.
    invalidateCalendarEventsCache();
  }
  return result;
}

/**
 * Finds the live CalendarEvent one session row refers to.
 *
 * Matched by DAY + cleanTitle rather than by a stored calendar event ID,
 * because this system has never stored one — Event_ID is its own hash of
 * calendar + title + date (computeEventId()), deliberately stable across an
 * event being deleted and re-made. Recurring events also change their
 * underlying IDs in ways a stored ID would not survive.
 *
 * Per-day event lists are memoized for the execution: a program with twelve
 * sessions across three calendars would otherwise re-fetch the same day
 * repeatedly.
 */
let __calendarDayEventsCache = {};

function findCalendarEventForSession(session) {
  const dayKey = `${session.calendarId}|${formatDateKey(session.date)}`;
  let events = __calendarDayEventsCache[dayKey];
  if (events === undefined) {
    try {
      const calendar = CalendarApp.getCalendarById(session.calendarId);
      if (!calendar) {
        events = null;
      } else {
        const start = parseDateKey(formatDateKey(session.date));
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        events = calendar.getEvents(start, end);
      }
    } catch (err) {
      log(`⚠️ Calendar ${session.calendarId} could not be read for invitations (${err}).`);
      events = null;
    }
    __calendarDayEventsCache[dayKey] = events;
  }
  if (!events) return null;

  const wanted = normalizeNameKey(session.title);
  for (const ev of events) {
    if (ev.isAllDayEvent()) continue;
    const parsed = parseEventTitle(ev.getTitle());
    if (parsed && normalizeNameKey(parsed.cleanTitle) === wanted) return ev;
  }
  return null;
}

/**
 * MENU ENTRY. Opens the picker for a manual invitation run.
 *
 * IT ASKS WHICH EVENTS, which the old one-click version did not: it swept
 * every upcoming session at once, and "send mail to everyone signed up for
 * anything in the next three months" is not a thing anybody presses a menu
 * item to do deliberately. The common reasons for running this by hand are
 * narrow — one program's guest list needs to go out before the hourly sync
 * gets to it, or one event was fixed and its guests need re-adding — and both
 * of them are a couple of ticks in this dialog.
 *
 * The hourly pass (inviteRegistrantsToCalendarEvents() with no filter, from
 * syncRegistrationsInternal()) is unchanged: it still keeps every event's
 * guest list in line on its own, and this only decides where a MANUAL run
 * points.
 */
function showCalendarInviteDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  if (!shouldInviteRegistrants()) {
    toastIfPossible(`Calendar invitations are switched off — set "Invite_Registrants" to ` +
      `"${CALENDAR_INVITE_OPTIONS.INVITE}" on the ${SHEET_NAMES.CONFIG} tab first.`);
    return;
  }
  const sessions = listInvitableSessions();
  if (sessions.length === 0) {
    toastIfPossible('No upcoming sessions have anybody to invite or remove right now.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildCalendarInviteHtml(sessions))
    .setWidth(640)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Invite Registrants to Calendar Events');
}

/**
 * Every UPCOMING session with invitation work outstanding, soonest first —
 * somebody to add, or somebody previously invited who should now come off.
 *
 * Computed against the same ledger the send itself uses, so the counts in the
 * dialog are what would actually happen rather than an estimate. A session
 * already fully in line is left off the list entirely: offering it would be
 * offering a no-op.
 */
function listInvitableSessions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regHeaders = HEADERS.All_Program_Sessions;
  const regMap = getIndexMap(regHeaders);
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return [];

  const todayKey = formatDateKey(new Date());
  const sessions = {};
  getSectionedRows(registrySheet, regHeaders, 'Event_ID').forEach(row => {
    const eventId = String(row[regMap['Event_ID']] || '').trim();
    const date = coerceDate(row[regMap['Event_Date']]);
    const calendarId = String(row[regMap['Calendar_Source']] || '').trim();
    if (!eventId || !date || !calendarId) return;
    const dateKey = formatDateKey(date);
    if (dateKey < todayKey) return;
    const session = {
      eventId, date, dateKey,
      title: String(row[regMap['Clean_Title']] || '').trim(),
      location: String(row[regMap['Location']] || '').trim(),
      isAssistance: isAssistanceColumnValue(row[regMap['Personalized_Assistance']])
    };
    // Offering a session this workbook would refuse to send for would be
    // offering a no-op — the same filter the send itself applies.
    if (!notificationPolicyForSession(session).invite) return;
    sessions[eventId] = session;
  });
  if (Object.keys(sessions).length === 0) return [];

  const lrHeaders = HEADERS.All_Registrants;
  const lrMap = getIndexMap(lrHeaders);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const rows = registrantsSheet ? getSectionedRows(registrantsSheet, lrHeaders, 'Event_ID') : [];

  const { wanted, unwanted } = partitionInviteEmails(rows, lrMap, sessions);
  const ledger = getCalendarInviteLedger();

  return Object.keys(sessions)
    .map(eventId => {
      const already = new Set(ledger[eventId] || []);
      const want = wanted[eventId] || new Set();
      const drop = unwanted[eventId] || new Set();
      const toAdd = Array.from(want).filter(email => !already.has(email)).length;
      const toRemove = Array.from(drop).filter(email => already.has(email) && !want.has(email)).length;
      return { session: sessions[eventId], toAdd, toRemove };
    })
    .filter(item => item.toAdd > 0 || item.toRemove > 0)
    .sort((a, b) => (a.session.dateKey < b.session.dateKey ? -1
      : (a.session.dateKey > b.session.dateKey ? 1 : a.session.title.localeCompare(b.session.title))))
    .map(item => ({
      value: item.session.eventId,
      label: `${formatDateLabel(item.session.date)} — ${item.session.title || '(untitled)'} ` +
        `(${item.session.location}) — ${item.toAdd} to invite` +
        (item.toRemove > 0 ? `, ${item.toRemove} to remove` : ''),
      toAdd: item.toAdd,
      toRemove: item.toRemove
    }));
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildCalendarInviteHtml(sessions) {
  const totalAdd = sessions.reduce((n, s) => n + s.toAdd, 0);
  const totalRemove = sessions.reduce((n, s) => n + s.toRemove, 0);
  const sessionTags = sessions.map(s =>
    `<label class="row"><input type="checkbox" name="session" value="${escapeHtmlForDialog(s.value)}"> ` +
    `${escapeHtmlForDialog(s.label)}</label>`).join('\n');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  #sessions { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 280px; overflow-y: auto; }
  label.row { display: block; padding: 2px 0; }
  .actions { margin: 8px 0 0 0; }
  .actions a { color: #1A73E8; cursor: pointer; text-decoration: underline; margin-right: 12px; font-size: 12px; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 9px 18px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; } .busy { color: #666; font-weight: normal; }
</style>
<h3>Invite registrants to calendar events</h3>
<p class="hint">
  Tick the sessions to send for. Everyone actively registered who gave an email address is added as a
  guest on that session's Google Calendar event, and <b>Google emails each of them an invitation</b>.
  Anyone whose registration has since been cancelled is removed from the guest list, which Google also
  emails them about. People already invited are left alone.
</p>
<p class="hint">
  Only sessions with something outstanding are listed — ${totalAdd} person(s) to invite${totalRemove > 0
    ? ` and ${totalRemove} to remove` : ''} in total. The hourly sync does all of this on its own; this
  is for getting one session's invitations out now.
</p>
<div id="sessions">${sessionTags}</div>
<div class="actions"><a onclick="pick(true)">Select all</a><a onclick="pick(false)">Select none</a></div>

<button id="go" onclick="submit()">Send invitations</button>
<div id="status"></div>
<script>
  function boxes() { return [].slice.call(document.querySelectorAll('input[name=session]')); }
  function pick(on) { boxes().forEach(function (b) { b.checked = on; }); }
  function say(msg, cls) { var el = document.getElementById('status'); el.textContent = msg; el.className = cls || ''; }
  function submit() {
    var picked = boxes().filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    if (picked.length === 0) { say('Tick at least one session first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Sending… this can take a moment.', 'busy');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .inviteRegistrantsForSessions(picked);
  }
</script>`;
}

/**
 * Called from the dialog. Runs the invitation pass over the chosen sessions
 * only, and returns a human-readable summary.
 */
function inviteRegistrantsForSessions(eventIds) {
  if (!shouldInviteRegistrants()) {
    return `⚠️ Calendar invitations are switched off on the ${SHEET_NAMES.CONFIG} tab.`;
  }
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ No sessions were selected.';

  const result = inviteRegistrantsToCalendarEvents(null, null, { onlyEventIds: wanted });
  const summary = `Calendar invitations ✅ — ${result.invited} invited, ${result.removed} removed, ` +
    `${result.eventsTouched} event(s) updated` +
    (result.deferred > 0 ? ` (${result.deferred} left over — run it again for those).` : '.');
  log(`inviteRegistrantsForSessions: ${summary}`);
  return summary;
}



// ============================================================================
// 5b-ii. WHAT THE OFFICE IS TOLD  (the digest that replaced the guest list)
// ============================================================================
//
// The office used to find out who had been invited to what by being invited
// to it themselves. That is the one thing this file will not do any more (see
// the banner at the top), so the same information is written out instead:
// after each pass, one plain-text message per address ticked for
// Calendar_Invite_Guest, naming every session whose guest list changed, who
// was added, who was taken off, and — the part a guest list never said — HOW
// each of them was told, which is Google's own calendar invitation.
//
// One message per run, not per session: a sync that catches up on thirty
// sessions is one thing that happened, and thirty separate emails about it is
// the same burial by volume the guest list caused.
// ============================================================================

/**
 * The floor this pass will not dig the day's hundred messages below.
 *
 * Lower than the registrant reminders' reserve (REMINDER_QUOTA_RESERVE, ten):
 * a digest is the office learning something slightly sooner than the workbook
 * would have told them anyway, and a member being told about their own
 * appointment is not. When the quota is that close to gone, the member's
 * message is the one that should still be affordable.
 */
const INVITE_DIGEST_QUOTA_RESERVE = 4;

/** Registrant rows as { email: name }, first name seen per address. */
function registrantNamesByEmail(rows, lrMap) {
  const names = {};
  (rows || []).forEach(row => {
    const email = String(row[lrMap['Email']] || '').trim().toLowerCase();
    if (!email || names[email]) return;
    const name = String(row[lrMap['Name']] || '').trim();
    if (name) names[email] = name;
  });
  return names;
}

/** "Ada Lovelace <ada@example.org>", or just the address when we have no name. */
function describeInvitee(email, nameByEmail) {
  const name = (nameByEmail || {})[String(email || '').toLowerCase()];
  return name ? `${name} <${email}>` : String(email || '');
}

/** The digest's subject line. */
function buildCalendarInviteDigestSubject(changes) {
  const invited = (changes || []).reduce((n, c) => n + c.added.length, 0);
  const removed = (changes || []).reduce((n, c) => n + c.removed.length, 0);
  const parts = [];
  if (invited > 0) parts.push(`${invited} invited`);
  if (removed > 0) parts.push(`${removed} removed`);
  return `Calendar invitations: ${parts.join(', ') || 'no changes'} ` +
    `across ${(changes || []).length} session(s)`;
}

/**
 * The digest's body. Plain text for the same reason every other message this
 * project sends is (see buildRegistrantReminderBody): it is read on a phone at
 * a desk, and an HTML mail that renders as markup is worse than no mail.
 */
function buildCalendarInviteDigestBody(changes) {
  const lines = [
    'Registrations were added to (or taken off) these Google Calendar events.',
    'Everyone listed under "invited" was added as a guest on the event, and',
    'Google emailed them its own calendar invitation. Everyone under "removed"',
    'was taken off it, which Google also emailed them about.',
    '',
    'Nobody in the office is on these guest lists any more — this message is',
    'the copy. Who receives it is the Calendar_Invite_Guest column on the',
    'Config tab.',
    ''
  ];
  (changes || []).forEach(change => {
    const session = change.session || {};
    lines.push(`${formatDateLabel(session.date)} — ${session.title || '(untitled)'}` +
      (session.location ? ` (${session.location})` : ''));
    if (change.added.length > 0) {
      lines.push(`  invited (Google calendar invitation): ${change.added.join(', ')}`);
    }
    if (change.removed.length > 0) {
      lines.push(`  removed (Google cancellation): ${change.removed.join(', ')}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Mails the digest to every address ticked for Calendar_Invite_Guest. Returns
 * how many messages actually went.
 *
 * Sent to each address in its own message rather than one message BCC'd to
 * all of them, because sendRationedEmail() counts a BCC as its own message
 * anyway (it is one) and a direct message is the one a member of staff can
 * reply to and forward without wondering who else has it.
 *
 * Never throws, and never blocks the pass: an office that was not told about
 * a set of invitations is a smaller problem than a sync that failed after
 * sending them.
 */
function notifyOfficeOfCalendarInvites(changes) {
  if (!changes || changes.length === 0) return 0;
  let sent = 0;
  try {
    const office = adminEmailsForCategory('calendarInviteGuest');
    if (office.length === 0) return 0;
    const subject = buildCalendarInviteDigestSubject(changes);
    const body = buildCalendarInviteDigestBody(changes);
    office.forEach(address => {
      const outcome = sendRationedEmail({
        to: address,
        subject,
        body,
        reserve: INVITE_DIGEST_QUOTA_RESERVE
      });
      if (outcome.status === 'sent') sent++;
      else if (outcome.status === 'failed') {
        log(`⚠️ Could not send the calendar-invitation digest to ${address} (${outcome.error}).`);
      }
    });
  } catch (err) {
    log(`⚠️ Calendar-invitation digest could not be sent (${err}).`);
    return sent;
  }
  if (sent > 0) log(`Calendar invitations: digest sent to ${sent} office address(es).`);
  return sent;
}

// ============================================================================
// 5b-iii. THE ONE-TIME CLEANUP  (taking the office back off the guest lists)
// ============================================================================
//
// Every event this workbook invited anybody to while the old behaviour was
// live has the office's addresses on it. Nothing above removes them: the pass
// only ever takes off somebody whose REGISTRATION changed, and a staff address
// has no registration. So this Admin item does it once.
//
// UPCOMING ONLY, like everything else here. Removing somebody from a past
// event mails them a cancellation for something that already happened, and a
// guest list nobody will look at again is not worth that.
//
// Resumable and safe to run twice: every event it has looked at is recorded,
// so a second run costs a property read rather than a calendar round trip per
// event, and a run that hits the cap picks up where it left off.
// ============================================================================

/** Events this sweep has already looked at: { Event_ID: true }. */
const ADMIN_GUEST_CLEANUP_PROP_KEY = 'ADMIN_GUEST_CLEANUP_V1';

/** How many events one execution will open. The item is re-runnable. */
const MAX_ADMIN_GUEST_CLEANUP_EVENTS_PER_RUN = 60;

/**
 * Which of an event's guests are office addresses to take off.
 *
 * Pure, and separate from the sweep, because "is this address staff?" is the
 * whole decision: everybody on Config's Admin Notification Emails table,
 * ticked for anything or nothing, and nobody else. A registrant who happens
 * to also be on that table would be removed — which is correct, because this
 * workbook put them there as staff, and the next sync re-adds them from their
 * registration.
 */
function calendarInviteAdminCleanupTargets(guestEmails, adminEmails) {
  const admin = {};
  (adminEmails || []).forEach(email => { admin[String(email || '').trim().toLowerCase()] = true; });
  return dedupePreservingOrder((guestEmails || [])
    .map(email => String(email || '').trim().toLowerCase())
    .filter(email => email && admin[email]));
}

function getAdminGuestCleanupState() {
  const raw = PropertiesService.getScriptProperties().getProperty(ADMIN_GUEST_CLEANUP_PROP_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveAdminGuestCleanupState(state) {
  PropertiesService.getScriptProperties()
    .setProperty(ADMIN_GUEST_CLEANUP_PROP_KEY, JSON.stringify(state));
}

/**
 * MENU ENTRY (Admin ▸ Repair). Takes every Admin Notification Emails address
 * off the guest list of every upcoming session's calendar event, and out of
 * the invitation ledger so no later pass reasons about them again.
 */
function removeAdminGuestsFromCalendarEvents() {
  const adminEmails = getAllAdminNotificationEmails();
  if (adminEmails.length === 0) {
    toastIfPossible('There are no addresses on Config’s Admin Notification Emails table to remove.');
    return 'No admin addresses are configured, so there was nothing to take off any event.';
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regMap = getIndexMap(regHeaders);
  const registrySheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  const rows = registrySheet ? getSectionedRows(registrySheet, regHeaders, 'Event_ID') : [];

  const todayKey = formatDateKey(new Date());
  const seen = getAdminGuestCleanupState();
  const ledger = getCalendarInviteLedger();
  let removed = 0;
  let eventsTouched = 0;
  let looked = 0;
  let deferred = 0;

  for (const row of rows) {
    const eventId = String(row[regMap['Event_ID']] || '').trim();
    const date = coerceDate(row[regMap['Event_Date']]);
    const calendarId = String(row[regMap['Calendar_Source']] || '').trim();
    if (!eventId || !date || !calendarId) continue;
    if (formatDateKey(date) < todayKey) continue; // upcoming only
    if (seen[eventId]) continue;
    if (looked >= MAX_ADMIN_GUEST_CLEANUP_EVENTS_PER_RUN) { deferred++; continue; }

    const session = {
      eventId, date, calendarId,
      title: String(row[regMap['Clean_Title']] || '').trim(),
      location: String(row[regMap['Location']] || '').trim()
    };
    const event = findCalendarEventForSession(session);
    looked++;
    if (!event) { seen[eventId] = true; continue; }

    let guests = [];
    try {
      guests = event.getGuestList().map(guest => guest.getEmail());
    } catch (err) {
      log(`⚠️ Could not read the guest list for "${session.title}" on ${formatDateLabel(session.date)} (${err}).`);
      continue; // NOT marked seen: an unread event is one to try again.
    }

    let changedHere = false;
    calendarInviteAdminCleanupTargets(guests, adminEmails).forEach(email => {
      try {
        event.removeGuest(email);
        removed++;
        changedHere = true;
      } catch (err) {
        log(`⚠️ Could not remove ${email} from "${session.title}" on ${formatDateLabel(session.date)} (${err}).`);
      }
    });
    if (changedHere) eventsTouched++;

    // The ledger too, whether or not the calendar had them: an address left
    // in it is one a later pass would count as "already invited".
    if (Array.isArray(ledger[eventId])) {
      const kept = ledger[eventId].filter(email =>
        adminEmails.indexOf(String(email || '').trim().toLowerCase()) === -1);
      if (kept.length !== ledger[eventId].length) {
        ledger[eventId] = kept;
        __calendarInviteLedgerDirty = true;
      }
    }
    seen[eventId] = true;
  }

  saveCalendarInviteLedger();
  saveAdminGuestCleanupState(seen);
  if (removed > 0) invalidateCalendarEventsCache();

  const summary = `Removed ${removed} office guest(s) from ${eventsTouched} upcoming event(s); ` +
    `${looked} event(s) checked` +
    (deferred > 0 ? `. ${deferred} left — run it again to finish.` : '.');
  log(`removeAdminGuestsFromCalendarEvents: ${summary}`);
  toastIfPossible(summary);
  return summary;
}
