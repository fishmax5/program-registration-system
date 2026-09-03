// ============================================================================
// 17. CANCELLATION  (one writer, three doors)
// ============================================================================
//
// WHAT WAS ALREADY TRUE, AND WHY THIS FILE IS NOT A NEW FEATURE.
//
// Program_Status = 'Cancelled' has always been the answer the rest of this
// project is built around. A cancelled row keeps its history but stops
// counting: recomputeEventRegistryCounts() gives the seat back,
// updateMasterLunchDashboard() drops the meal, the appointment layer frees the
// time slot (see 52 and 55, which both skip 'Cancelled' by name), and
// inviteRegistrantsToCalendarEvents() takes the person back off the calendar
// event's guest list.
//
// What did NOT exist was a way to SAY it. The status was a dropdown on a
// hidden-ish tab, and everybody who actually learns that somebody is not
// coming — the volunteer at the door, the person themselves on the phone, the
// program leader looking at their own sheet — had no way to record it. So a
// cancellation travelled as a sticky note, or as a seat that stayed full all
// month, or as a lunch that got cooked for nobody.
//
// THE RULE THIS FILE IS BUILT ON: three doors, ONE writer. Every path below
// ends at cancelRegistrantRows(), which is the only function in the project
// that turns a booking into a cancellation. That matters because a
// cancellation is four writes, not one — the program status, the lunch status,
// the manual-override flag that stops the next sync undoing it, and the
// Admin_Notes stamp that says who did it and when — and three copies of that
// list is three chances for one of them to fall out of step.
//
// cancelUpcomingClubRegistrations() (section 41) is the shape this generalizes;
// it predates this file and still writes the same four cells the same way.
//
// LOAD ORDER. This file is numbered after the door pages because it reads
// their vocabulary (DESK_LOCK_WAIT_MS, the check-in PIN) and is read by
// nothing at load time. It declares no constant anything else derives from.

/**
 * Where a cancellation came from. Stamped into Admin_Notes, because "this seat
 * was empty and nobody knows why" is the question this whole file exists to
 * stop being asked — and because the three doors have genuinely different
 * standing. A leader ticking Dropped on their own sheet is a report; a
 * volunteer cancelling at the desk is a decision; the registrant themselves is
 * the authority.
 */
const CANCELLATION_SOURCES = {
  DESK: 'at the door',
  SELF: 'by the registrant',
  LEADER: 'by the program leader',
  STAFF: 'in the workbook'
};

/** One sentence's worth of reason. See cancellationStamp(). */
const CANCELLATION_REASON_MAX_CHARS = 200;

/** Statuses that are already not-coming. Cancelling one again is a no-op, not an error. */
const CANCELLATION_TERMINAL_STATUSES = ['Cancelled', 'Superseded'];


// --- the one writer ---------------------------------------------------------

/**
 * Stamps ONE registrant row as cancelled, in place. Returns true if it moved.
 *
 * THE FOUR CELLS, and why each one:
 *
 *   Program_Status  — the seat. Everything downstream reads this.
 *   Lunch_Status    — the meal. NOT derived from the program status anywhere,
 *                     which is deliberate (somebody can skip the program and
 *                     still eat), so a cancellation has to say both or the
 *                     kitchen keeps cooking.
 *   Manual_Override — the reason it STICKS. Without it the next import can
 *                     re-derive this row from the form response that is still
 *                     sitting in the responses sheet, and a cancellation the
 *                     hourly sync silently reverses is worse than none.
 *   Admin_Notes     — who, when, and (if they said) why.
 *
 * Appends to Admin_Notes rather than replacing it: a row can carry a standing
 * note about the person that has nothing to do with today.
 */
function stampRegistrantRowCancelled(row, map, opts) {
  const status = String(row[map['Program_Status']] || '').trim();
  if (CANCELLATION_TERMINAL_STATUSES.indexOf(status) !== -1) return false;

  row[map['Program_Status']] = 'Cancelled';
  row[map['Lunch_Status']] = 'Cancelled';
  row[map['Manual_Override']] = 'Manually Edited';
  const notes = String(row[map['Admin_Notes']] || '').trim();
  row[map['Admin_Notes']] = notes ? `${notes} | ${cancellationStamp(opts)}` : cancellationStamp(opts);
  return true;
}

/**
 * The sentence that goes in Admin_Notes.
 *
 * WRITTEN TO BE READ BY A PERSON SIX WEEKS LATER, not parsed. The date, the
 * door it came through, and the reason if one was given — in that order,
 * because "when" is what somebody scanning a column is looking for.
 *
 * The reason is TRIMMED AND CAPPED. It arrives from a text box on a public web
 * page, and a cell holding four paragraphs makes the whole tab unreadable;
 * anybody who needs to say more than a sentence rings the office.
 */
function cancellationStamp(opts) {
  const o = opts || {};
  const source = o.source || CANCELLATION_SOURCES.STAFF;
  const reason = String(o.reason || '').replace(/\s+/g, ' ').trim().slice(0, CANCELLATION_REASON_MAX_CHARS);
  const who = String(o.by || '').trim();
  const parts = [`Cancelled ${source} on ${formatDateLabel(new Date())}`];
  if (who) parts.push(`by ${who}`);
  const head = parts.join(' ');
  return reason ? `${head}: ${reason}` : `${head}.`;
}

/**
 * CANCEL EVERY ROW THE MATCHER PICKS — the single write path every door ends at.
 *
 * `matcher(row, map)` returns true for a row to cancel. It is handed the whole
 * row so a caller can be as narrow as one Party_ID or as broad as one person's
 * entire month.
 *
 * UNDER THE DESK LOCK, for the reason every other desk write is: this reads
 * rows, decides, and writes the whole tab back, and a render landing in the
 * middle would either lose the cancellation or resurrect rows the render had
 * just moved. The lock is the same one Quick Mark and the door pages take, so
 * a cancellation and a check-in cannot interleave.
 *
 * RE-COUNTS BEFORE IT RETURNS, and reports failure separately from the
 * cancellation itself: giving the seat back is the POINT of cancelling, but a
 * recount that throws must not make the caller think nothing happened — the
 * rows are already written by then, and the hourly sync recounts anyway.
 *
 * Returns { ok, cancelled, message }.
 */
function cancelRegistrantRows(matcher, opts) {
  return withScriptLock(DESK_LOCK_WAIT_MS, () => cancelRegistrantRowsLocked(matcher, opts), {
    ok: false, cancelled: 0,
    message: 'The workbook is mid-update — nothing was cancelled. Try again in a moment.'
  });
}

/** The body of cancelRegistrantRows(), which holds the lock for it. */
function cancelRegistrantRowsLocked(matcher, opts) {
  const o = opts || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return { ok: false, cancelled: 0, message: 'There is no Registrants tab to cancel anything on.' };

  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');

  let cancelled = 0;
  rows.forEach(row => {
    if (!matcher(row, map)) return;
    if (stampRegistrantRowCancelled(row, map, o)) cancelled++;
  });

  if (cancelled === 0) {
    return { ok: true, cancelled: 0, message: o.emptyMessage || 'Nothing to cancel — those bookings were already off the list.' };
  }

  renderRegistrantsSheet(false, rows);

  // THE SEAT AND THE MEAL, immediately. The hourly sync would get to both, but
  // the whole reason somebody cancels at a desk is that the next person in the
  // queue wants the seat now, and a form that still says "Full" for an hour is
  // a cancellation nobody can use.
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, rows);
    updateMasterLunchDashboard(rows);
  } catch (err) {
    log(`⚠️ Cancelled ${cancelled} booking(s), but could not recalculate the counts (${err}) — the hourly sync will.`);
  }

  log(`cancelRegistrantRows: cancelled ${cancelled} row(s) ${o.source || CANCELLATION_SOURCES.STAFF}` +
    `${o.by ? ` (${o.by})` : ''}.`);
  return {
    ok: true, cancelled,
    message: cancelled === 1
      ? `Cancelled. The seat is free${o.name ? ` — ${o.name} is off the list.` : '.'}`
      : `Cancelled ${cancelled} bookings. Those seats are free.`
  };
}

/**
 * A GUEST GOES WITH THE PERSON WHO BROUGHT THEM.
 *
 * Cancelling Ruth without cancelling "Ruth's daughter" leaves a guest row with
 * nobody to attach to — the door lists nest guests under their member (see
 * nestCheckInGuests()), so an orphaned guest shows up as a stranger nobody at
 * the desk can place, and the kitchen still cooks for them.
 *
 * The reverse is NOT true: a guest can drop out on their own and the member
 * still comes. So this widens a member's cancellation and never a guest's.
 */
function matchesCancellationParty(row, map, args) {
  if (String(row[map['Event_ID']] || '').trim() !== args.eventId) return false;
  const nameKey = normalizeNameKey(row[map['Name']]);
  if (nameKey === args.nameKey) return true;
  const isGuest = String(row[map['Person_Type']] || '').trim() === 'Guest';
  return isGuest && normalizeNameKey(row[map['Primary_Registrant']]) === args.nameKey;
}

/**
 * Cancel one person (and their guests) on one session. The shape every door
 * except the self-serve page uses, since a desk and a leader sheet are both
 * looking at exactly one row when they decide.
 */
function cancelOneRegistration(args) {
  const target = {
    eventId: String((args && args.eventId) || '').trim(),
    nameKey: normalizeNameKey((args && args.name) || '')
  };
  if (!target.eventId || !target.nameKey) {
    return { ok: false, cancelled: 0, message: 'Nothing was cancelled — the booking could not be identified.' };
  }
  return cancelRegistrantRows((row, map) => matchesCancellationParty(row, map, target), Object.assign({
    name: String((args && args.name) || '').trim(),
    emptyMessage: 'That booking was already cancelled.'
  }, args));
}


// --- door 1: the desk -------------------------------------------------------

/**
 * "SHE JUST RANG TO SAY SHE CAN'T COME" — the cancellation the check-in page
 * could not record.
 *
 * The door already had the two halves either side of this: it can mark
 * somebody present, and it can register somebody new. What it could not do was
 * the thing that actually happens most mornings, which is that a name on the
 * list is not coming and everybody standing at the tablet knows it.
 *
 * NOT QUEUED, unlike a check-in mark. A mark is idempotent and worth nothing
 * if it is slow, so it goes in a queue and lands within five minutes; a
 * cancellation gives a seat back, and the volunteer who does it is very often
 * about to give that seat to the person in front of them. It writes now.
 *
 * Payload: { location, session, name, eventId, reason, pin }.
 */
function checkInCancel(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  if (isDeskWorkBlocked()) return { ok: false, message: deskBusyMessage() };
  const name = String(args.name || '').trim();
  if (!name) return { ok: false, message: 'Nothing was cancelled — no name.' };

  const result = cancelOneRegistration({
    eventId: String(args.eventId || '').trim(),
    name,
    reason: String(args.reason || ''),
    source: CANCELLATION_SOURCES.DESK,
    by: getCurrentUserEmail() || ''
  });
  return { ok: !!result.ok, message: result.message };
}


// --- door 2: the program leader ---------------------------------------------

/**
 * A TICK IN "DROPPED" IS A CANCELLATION, and until now it was a note.
 *
 * The shared leader sheet has carried a Dropped checkbox since it was built,
 * and pullProgramLeaderSheetEdits() has faithfully merged it back onto the
 * Registrants tab every hour — where it sat in a column nothing reads. The
 * leader had done the only thing their sheet offered and the seat stayed full.
 *
 * Program_Status is a DERIVED column on that sheet (LEADER_SHEET_DERIVED_COLUMNS)
 * — a leader cannot type it, and should not have to: "this person dropped out"
 * is the sentence they know, and translating it into the workbook's vocabulary
 * is this project's job, not theirs.
 *
 * RUN AFTER THE MERGE, INSIDE THE IMPORT, on the same rows the merge just
 * touched — so a tick made this morning is a freed seat by the next pass
 * rather than by the next time somebody notices. Stamps the rows directly
 * instead of going through cancelRegistrantRows(), because the import is
 * about to write this exact array to the tab and re-reading it here would
 * throw away the rest of the pass's work.
 *
 * UPCOMING ONLY. A leader tidying up last month's sheet is recording history,
 * not cancelling anything, and a past session's seat is not a seat.
 */
function applyLeaderDropsAsCancellations(registrantRows) {
  if (!registrantRows || registrantRows.length === 0) return 0;
  const map = getIndexMap(HEADERS.Registrant_Dash);
  if (map['Dropped'] === undefined) return 0;
  const todayKey = formatDateKey(new Date());

  let cancelled = 0;
  registrantRows.forEach(row => {
    if (!isCheckedTrue(row[map['Dropped']])) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date || formatDateKey(date) < todayKey) return;
    if (stampRegistrantRowCancelled(row, map, {
      source: CANCELLATION_SOURCES.LEADER,
      reason: String(row[map['Leader_Notes']] || '')
    })) cancelled++;
  });

  if (cancelled > 0) {
    log(`Program leader sheets: ${cancelled} "Dropped" tick(s) became cancellations — those seats are free.`);
  }
  return cancelled;
}

/**
 * Is this cell ticked? A checkbox read back out of a sheet is a boolean, but
 * the same column read out of a SHARED sheet a leader may have typed into by
 * hand is as likely to be the string "TRUE", "Yes", or "y".
 */
function isCheckedTrue(value) {
  if (value === true) return true;
  return /^(true|yes|y|x|1)$/i.test(String(value === null || value === undefined ? '' : value).trim());
}


// --- door 3: the registrant themselves --------------------------------------
//
// THE PAGE THIS PROJECT DID NOT HAVE.
//
// Everything else here is a way for STAFF to record what somebody told them.
// This is the only path where the person who knows they are not coming can say
// so without anybody answering a phone — which is the difference between a
// seat that comes back on Tuesday and one that comes back when the volunteer
// gets round to the message pad.
//
// WHY THE LINK IS PER-FORM AND NOT PER-PERSON. The obvious design is a signed
// token per registrant, mailed to them. It cannot work here: the place this
// link goes is the calendar event's description, and a description is ONE text
// shared by every guest on the event (see 33 — Google mails the same invite to
// all of them). A per-person token in there would be a token everybody has.
//
// So the link is scoped to the FORM — the same unit the "📝 Register" link
// beside it is scoped to, covering one program's month or series — and the
// page identifies the person the way the office does on the phone: their name,
// plus the email or phone number already on their row. A forwarded invite gets
// somebody else's cancel PAGE, not their cancellation.
//
// It is deliberately NOT a hard security boundary, and should not be mistaken
// for one. It is the lock on a village hall door: enough that you cannot
// cancel a stranger's booking by accident or by curiosity, not enough to stop
// somebody who already knows Ruth's phone number and means her harm. The
// consequence of being wrong is a cancelled booking that staff can see, dated
// and stamped 'by the registrant', and put back.

/** How many digits of a phone number have to match. See cancellationIdentityMatches(). */
const CANCEL_PAGE_PHONE_DIGITS = 4;

/**
 * Is this row the person standing in front of the page?
 *
 * NAME PLUS ONE CONTACT DETAIL. The name alone is on a printed sign-in sheet
 * that sits on a table all morning; the contact detail is the part only they
 * and the workbook know.
 *
 * The phone is matched on its LAST FOUR DIGITS, punctuation ignored, because
 * "(610) 555-0142" and "610-555-0142" are the same number and a page that
 * rejects one of them has locked out the person it is for. The email is
 * matched whole but case-insensitively.
 *
 * A row with NEITHER a phone nor an email on it cannot be matched at all, and
 * is deliberately left unmatchable rather than falling back to the name: an
 * empty contact column must not become the one that opens for anybody.
 */
function cancellationIdentityMatches(row, map, identity) {
  if (normalizeNameKey(row[map['Name']]) !== identity.nameKey) return false;
  const email = String(row[map['Email']] || '').trim().toLowerCase();
  const phoneDigits = String(row[map['Phone']] || '').replace(/\D/g, '');
  if (!email && !phoneDigits) return false;
  if (identity.email && email && identity.email === email) return true;
  return !!(identity.phone && phoneDigits &&
    phoneDigits.slice(-CANCEL_PAGE_PHONE_DIGITS) === identity.phone.slice(-CANCEL_PAGE_PHONE_DIGITS));
}

/** What the page sends up, normalized once so the lookup and the apply agree. */
function parseCancelIdentity(payload) {
  const p = payload || {};
  const phone = String(p.contact || p.phone || '').replace(/\D/g, '');
  const raw = String(p.contact || p.email || '').trim().toLowerCase();
  return {
    nameKey: normalizeNameKey(p.name || ''),
    name: String(p.name || '').trim(),
    email: raw.indexOf('@') !== -1 ? raw : '',
    phone: phone.length >= CANCEL_PAGE_PHONE_DIGITS ? phone : '',
    formId: String(p.formId || '').trim()
  };
}

/**
 * Every UPCOMING Event_ID this form registers people onto.
 *
 * Read from the session table rather than from the registrant rows' Form_Source,
 * because Form_Source is a human-readable label ("Tai Chi — March") and the
 * dashboard's Form_ID is the actual identity. A form whose sessions have all
 * passed returns nothing, and the page says so in words.
 */
function upcomingEventIdsForForm(formId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet || !formId) return {};
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const out = {};
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    if (String(row[map['Form_ID']] || '').trim() !== formId) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date || formatDateKey(date) < todayKey) return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return;
    out[eventId] = {
      eventId,
      dateKey: formatDateKey(date),
      dateLabel: formatDateLabel(date),
      title: String(row[map['Clean_Title']] || '').trim(),
      location: String(row[map['Location']] || '').trim(),
      time: String(row[map['Event_Time']] || '').trim()
    };
  });
  return out;
}

/**
 * "WHAT AM I BOOKED ON?" — the page's first question, answered.
 *
 * Returns the person's upcoming bookings on this form so they can SEE what
 * they are about to cancel before they cancel it. A page that cancels on a
 * name and a button, with nothing shown in between, is a page people press by
 * mistake and then ring the office about anyway.
 *
 * SAYS NOTHING ABOUT WHY A LOOKUP FAILED. "No bookings under that name" is the
 * answer both to a typo and to a name that is not registered, on purpose: a
 * page that distinguishes them is a page that confirms, to anybody who asks,
 * whether a given person attends a given program.
 */
function cancelPageLookup(payload) {
  const identity = parseCancelIdentity(payload);
  if (!identity.nameKey || (!identity.email && !identity.phone)) {
    return { ok: false, message: 'Type your name and either your phone number or your email address.' };
  }
  const sessions = upcomingEventIdsForForm(identity.formId);
  const eventIds = Object.keys(sessions);
  if (eventIds.length === 0) {
    return { ok: false, message: 'There are no upcoming dates left on this program to cancel.' };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return { ok: false, message: 'We cannot look that up right now. Please ring the office.' };
  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);

  const bookings = [];
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!sessions[eventId]) return;
    // GUESTS ARE NOT LISTED SEPARATELY. They go with the member who brought
    // them (matchesCancellationParty), so showing them as their own line would
    // offer somebody a checkbox that cancels itself when they tick the one
    // above it.
    if (String(row[map['Person_Type']] || '').trim() === 'Guest') return;
    if (!cancellationIdentityMatches(row, map, identity)) return;
    const status = String(row[map['Program_Status']] || '').trim();
    const session = sessions[eventId];
    bookings.push({
      eventId,
      dateLabel: session.dateLabel,
      dateKey: session.dateKey,
      title: session.title,
      location: session.location,
      time: session.time,
      status: status || 'Active',
      cancellable: CANCELLATION_TERMINAL_STATUSES.indexOf(status) === -1
    });
  });

  if (bookings.length === 0) {
    return { ok: false, message: 'We could not find a booking under that name and contact details. Please ring the office and we will sort it out.' };
  }
  bookings.sort((a, b) => a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0));
  return { ok: true, name: identity.name, bookings };
}

/**
 * "CANCEL THESE ONES" — the page's second and last action.
 *
 * RE-CHECKS THE IDENTITY, on the rows themselves, rather than trusting that
 * the browser is sending back the same Event_IDs the lookup handed it. The
 * lookup and this call are two separate requests to a public web app, and the
 * list in between lives in a browser anybody can edit.
 *
 * The reason box is optional and free text — see cancellationStamp() for where
 * it lands and how far it is trusted.
 */
function cancelPageApply(payload) {
  const identity = parseCancelIdentity(payload);
  const wanted = {};
  ((payload && payload.eventIds) || []).forEach(id => { wanted[String(id || '').trim()] = true; });
  if (!identity.nameKey || (!identity.email && !identity.phone)) {
    return { ok: false, message: 'Nothing was cancelled — start again from your name.' };
  }
  if (Object.keys(wanted).length === 0) {
    return { ok: false, message: 'Tick at least one date first — nothing was cancelled.' };
  }
  const sessions = upcomingEventIdsForForm(identity.formId);

  const result = cancelRegistrantRows((row, map) => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!wanted[eventId] || !sessions[eventId]) return false;
    if (cancellationIdentityMatches(row, map, identity)) return true;
    // The member's guests ride along, and only theirs.
    return String(row[map['Person_Type']] || '').trim() === 'Guest' &&
      normalizeNameKey(row[map['Primary_Registrant']]) === identity.nameKey;
  }, {
    name: identity.name,
    reason: String((payload && payload.reason) || ''),
    source: CANCELLATION_SOURCES.SELF,
    by: identity.name,
    emptyMessage: 'Those dates were already cancelled — there is nothing more to do.'
  });

  return {
    ok: !!result.ok,
    cancelled: result.cancelled || 0,
    message: result.ok && result.cancelled
      ? `Thank you — you are off the list for ${result.cancelled === 1 ? 'that date' : `${result.cancelled} dates`}. There is nothing else you need to do.`
      : result.message
  };
}


// --- the page itself --------------------------------------------------------

/**
 * THE CANCEL PAGE — served by doGet() at ?mode=cancel&form=<formId>.
 *
 * TWO SCREENS, in the order a person thinks: "who are you" and then "which
 * dates". Nothing is cancelled until the second screen, and the second screen
 * only ever shows dates that were found under their own name — so the last
 * thing anybody sees before they press the button is their own booking, in
 * words, with the date on it.
 *
 * WRITTEN FOR THE PHONE IN SOMEBODY'S HAND, not for the tablet at the door.
 * The other two pages in this project are used standing up by volunteers who
 * use them daily; this one is used once, by a person who has never seen it,
 * from a link inside a calendar invitation. Hence the long sentences, the big
 * targets, and the complete absence of jargon: there is no "session", no
 * "Event_ID", and no "registration status" anywhere on it.
 *
 * EVERY INTERPOLATED VALUE IS ESCAPED and the options blob is stringified
 * twice — the rule this project applies to anything served to a browser (see
 * buildCheckInHtml and tests/check_in_page.test.js). A program called
 * "Women's </script> Group" would otherwise end the page mid-sentence.
 */
function buildCancelPageHtml(options) {
  const opts = options || {};
  const inlineOptions = JSON.stringify(JSON.stringify({
    formId: String(opts.formId || ''),
    programLabel: String(opts.programLabel || '')
  })).replace(/<\//g, '<\\/');
  const heading = opts.programLabel
    ? `Cancel your place — ${escapeHtmlForDialog(opts.programLabel)}`
    : 'Cancel your place';

  return `
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         font-size: 17px; color: #202124; margin: 0; background: #F8F9FA; line-height: 1.5; }
  header { background: #1A73E8; color: #fff; padding: 16px; }
  header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  main { padding: 18px 16px 80px 16px; max-width: 620px; margin: 0 auto; }
  p.hint { color: #5F6368; font-size: 15px; margin: 0 0 16px 0; }
  label.field { display: block; font-weight: 600; margin: 16px 0 6px 0; font-size: 15px; }
  input[type=text], textarea { width: 100%; padding: 14px; font-size: 17px;
    border: 1px solid #DADCE0; border-radius: 8px; background: #fff; font-family: inherit; }
  textarea { min-height: 76px; resize: vertical; }
  button { width: 100%; padding: 16px; font-size: 17px; font-weight: 600; border: 0;
    border-radius: 8px; background: #1A73E8; color: #fff; margin-top: 18px; cursor: pointer; }
  button.danger { background: #D93025; }
  button.link { background: none; color: #1A73E8; text-decoration: underline; font-weight: 400;
    padding: 10px; margin-top: 6px; }
  button[disabled] { opacity: .55; }
  /* THE BOOKINGS. A whole row is the tap target, not the little checkbox —
     this is read by people whose hands are not steady. */
  .booking { display: flex; gap: 12px; align-items: flex-start; background: #fff;
    border: 1px solid #DADCE0; border-radius: 10px; padding: 14px; margin-bottom: 10px; cursor: pointer; }
  .booking.on { border-color: #D93025; background: #FCE8E6; }
  .booking.off { opacity: .55; cursor: default; }
  .booking input { width: 22px; height: 22px; margin-top: 2px; flex: none; }
  .booking .when { font-weight: 600; }
  .booking .where { color: #5F6368; font-size: 15px; }
  .note { background: #FEF7E0; border: 1px solid #FDD663; border-radius: 8px; padding: 12px;
    font-size: 15px; margin: 16px 0; }
  .msg { padding: 14px; border-radius: 8px; margin-top: 16px; font-weight: 600; }
  .msg.ok { background: #E6F4EA; color: #137333; }
  .msg.bad { background: #FCE8E6; color: #C5221F; }
  [hidden] { display: none !important; }
</style>
<header><h1>${heading}</h1></header>
<main>
  <div id="who">
    <p class="hint">Let us know you cannot make it and we will give your place to somebody
      on the waiting list. Nobody needs to ring you back.</p>
    <label class="field" for="name">Your name</label>
    <input type="text" id="name" autocomplete="name" placeholder="First and last name">
    <label class="field" for="contact">Your phone number or email address</label>
    <input type="text" id="contact" autocomplete="tel" placeholder="As we have it on file">
    <p class="hint">This is only so we find the right person — it is the same one you gave
      us when you signed up.</p>
    <button id="find">Find my booking</button>
    <div id="whoMsg"></div>
  </div>

  <div id="pick" hidden>
    <p class="hint">Tick the dates you cannot make. Anything you leave unticked stays booked.</p>
    <div id="bookings"></div>
    <label class="field" for="reason">Anything you would like us to know? (optional)</label>
    <textarea id="reason" placeholder="You do not have to give a reason."></textarea>
    <button id="go" class="danger">Cancel the ticked dates</button>
    <button id="back" class="link">That is not me — start again</button>
    <div id="pickMsg"></div>
  </div>

  <div id="done" hidden>
    <div class="msg ok" id="doneMsg"></div>
    <p class="hint">You can close this page. If you change your mind, ring the office and we
      will put you back on if there is still room.</p>
  </div>
</main>
<script>
  var OPTIONS = JSON.parse(${inlineOptions});
  var STATE = { name: '', contact: '', bookings: [], picked: {} };

  function el(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function say(where, text, bad) {
    el(where).innerHTML = text ? '<div class="msg ' + (bad ? 'bad' : 'ok') + '">' +
      escapeHtml(text) + '</div>' : '';
  }
  function busy(id, on, label) {
    el(id).disabled = !!on;
    el(id).textContent = on ? 'One moment…' : label;
  }

  el('find').onclick = function () {
    STATE.name = el('name').value.trim();
    STATE.contact = el('contact').value.trim();
    if (!STATE.name || !STATE.contact) {
      say('whoMsg', 'Please fill in both boxes.', true);
      return;
    }
    say('whoMsg', '');
    busy('find', true, 'Find my booking');
    google.script.run
      .withSuccessHandler(function (res) {
        busy('find', false, 'Find my booking');
        if (!res || !res.ok) { say('whoMsg', (res && res.message) || 'Something went wrong.', true); return; }
        STATE.bookings = res.bookings || [];
        STATE.picked = {};
        drawBookings();
        el('who').hidden = true;
        el('pick').hidden = false;
      })
      .withFailureHandler(function (err) {
        busy('find', false, 'Find my booking');
        say('whoMsg', 'We could not reach the office system just now. Please try again in a moment.', true);
      })
      .cancelPageLookup({ name: STATE.name, contact: STATE.contact, formId: OPTIONS.formId });
  };

  function drawBookings() {
    el('bookings').innerHTML = STATE.bookings.map(function (b, i) {
      var where = [b.location, b.time].filter(Boolean).join(' · ');
      if (!b.cancellable) {
        return '<div class="booking off"><input type="checkbox" disabled><div>' +
          '<div class="when">' + escapeHtml(b.dateLabel) + '</div>' +
          '<div class="where">' + escapeHtml(where) + ' — already cancelled</div></div></div>';
      }
      return '<div class="booking" data-i="' + i + '">' +
        '<input type="checkbox" data-i="' + i + '"><div>' +
        '<div class="when">' + escapeHtml(b.dateLabel) + '</div>' +
        '<div class="where">' + escapeHtml(where) + '</div></div></div>';
    }).join('');
    // The row toggles the box, and the box toggles itself — bound here rather
    // than inline so nothing depends on a program title surviving an onclick
    // attribute.
    Array.prototype.forEach.call(el('bookings').querySelectorAll('.booking[data-i]'), function (row) {
      row.onclick = function (ev) {
        var i = row.getAttribute('data-i');
        var box = row.querySelector('input');
        if (ev.target !== box) box.checked = !box.checked;
        STATE.picked[i] = box.checked;
        row.className = 'booking' + (box.checked ? ' on' : '');
      };
    });
  }

  el('back').onclick = function () {
    el('pick').hidden = true;
    el('done').hidden = true;
    el('who').hidden = false;
    say('pickMsg', '');
  };

  el('go').onclick = function () {
    var ids = STATE.bookings.filter(function (b, i) { return STATE.picked[i] && b.cancellable; })
      .map(function (b) { return b.eventId; });
    if (!ids.length) { say('pickMsg', 'Tick at least one date first.', true); return; }
    if (!window.confirm('Cancel ' + (ids.length === 1 ? 'that date' : ids.length + ' dates') + '?')) return;
    say('pickMsg', '');
    busy('go', true, 'Cancel the ticked dates');
    google.script.run
      .withSuccessHandler(function (res) {
        busy('go', false, 'Cancel the ticked dates');
        if (!res || !res.ok) { say('pickMsg', (res && res.message) || 'Nothing was cancelled.', true); return; }
        el('doneMsg').textContent = res.message;
        el('pick').hidden = true;
        el('done').hidden = false;
      })
      .withFailureHandler(function () {
        busy('go', false, 'Cancel the ticked dates');
        say('pickMsg', 'We could not reach the office system just now. Nothing was cancelled — please try again.', true);
      })
      .cancelPageApply({
        name: STATE.name, contact: STATE.contact, formId: OPTIONS.formId,
        eventIds: ids, reason: el('reason').value
      });
  };
</script>`;
}

/**
 * The label the cancel page puts in its own heading: the program this form is
 * for, read off the first session that carries it.
 *
 * Falls back to nothing rather than to the form ID. "Cancel your place —
 * 1FAIpQLSc..." is worse than "Cancel your place".
 */
function cancelPageProgramLabel(formId) {
  const sessions = upcomingEventIdsForForm(formId);
  const first = Object.keys(sessions).map(k => sessions[k])
    .sort((a, b) => a.dateKey < b.dateKey ? -1 : 1)[0];
  return first ? [first.title, first.location].filter(Boolean).join(' — ') : '';
}
