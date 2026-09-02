// ============================================================================
// 16f. THE DOOR APP  (one deployment, one link, one page — set up per tablet)
// ============================================================================
//
// Before this file there were three links to keep straight: the session
// check-in roster (?mode=session), the same roster opened on its register
// screen (?page=register), and the walk-in door page (no mode at all). Every
// one of them was the same deployment with a different query string, and the
// query string was the thing a volunteer had to get right — off a printed
// card, through a QR generator, onto a tablet that had been power-cycled since
// March. A tablet on the wrong link is a tablet showing the wrong page, and
// nobody at a door has any way to tell that is what happened.
//
// So there is ONE address now. What used to be in the URL is SET UP ONCE on
// the tablet instead:
//
//   SETUP      Which building, and which day. Stored in the tablet's own
//              localStorage, so the second boot goes straight past it. A
//              "Change setup" button in the header re-opens it, and the day
//              defaults to today on every boot — a tablet left on Tuesday's
//              date must not still be on it on Wednesday.
//   NAMES      Everybody expected at that building on that day, in ONE list,
//              A–Z, under letter headings. Deduped per person: somebody in
//              three programs and a lunch is one card, because the person at
//              the door is one person.
//   PERSON     Tapping a name opens the confirm screen — every event they are
//              down for today, lunch included, pre-ticked, with the same
//              wiring the walk-in page already had (walkInSignIn()). They
//              confirm, or they change what is ticked and then confirm.
//   WALK-IN    Underneath the name scroller, always on screen and never a
//              second page: "Not on the list?". It opens the day's programs
//              as cards, takes a name and a way to reach them, asks about a
//              standing place and about membership, and signs them in through
//              the same one write path.
//
// WHAT LIVES HERE AND WHAT DOES NOT. This file is the SERVER half — the day
// read, the recurring-registration writes, the membership hand-off. The page
// itself is section 16g (73_door_app_html.gs). Both are behavior only: they
// read no constant at load time that is not already defined by section 03, so
// their numbering is free and nothing earlier depends on them.
// ============================================================================

/** How far ahead "the rest of this month" is ever allowed to reach. */
const DOOR_RECURRING_MAX_SESSIONS = 40;

/**
 * ONE DAY AT ONE BUILDING, for the door app — a thin, date-aware front on
 * readWalkInDay().
 *
 * Payload: { location, dateKey, pin }. `dateKey` is what the setup screen
 * chose; blank means today. Returns { ok, day, today } — `today` so the page
 * can say "you are looking at Thursday" without trusting a tablet's clock.
 *
 * THE STORED SNAPSHOT IS ONLY EVER TODAY'S. The boot store (section 16d) holds
 * one day per building and that day is today's; a tablet set up on next
 * Tuesday must never be handed it, and a live read of one location's single
 * day is a small enough read to make on every open.
 */
function doorDay(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  const location = matchCheckInLocation(args.location);
  if (!location) {
    return { ok: false, message: 'Choose a location in setup first — nothing was read.' };
  }
  const todayKey = formatDateKey(new Date());
  const dateKey = String(args.dateKey || '').trim() || todayKey;
  if (!parseDateKey(dateKey)) {
    return { ok: false, message: 'That date could not be read. Open setup and choose it again.' };
  }
  // A forms sweep is no reason to shut the front door — the same judgement
  // walkInDay() makes, and for today there is a stored day to hand back
  // instead of a refusal.
  if (isDeskWorkBlocked()) {
    const stored = dateKey === todayKey ? storedWalkInDay(location) : null;
    if (stored) return { ok: true, day: stored, stale: true, today: todayKey };
    return { ok: false, message: deskBusyMessage() };
  }
  try {
    const day = readWalkInDay(location, dateKey);
    if (dateKey === todayKey) rememberWalkInDay(day);
    return { ok: true, day, today: todayKey };
  } catch (err) {
    log(`doorDay failed: ${err}`);
    const stored = dateKey === todayKey ? storedWalkInDay(location) : null;
    if (stored) return { ok: true, day: stored, stale: true, today: todayKey };
    return { ok: false, message: `Could not read that day's list (${err}).` };
  }
}

/**
 * The door app's only write — walkInSignIn() under its own name.
 *
 * Kept as a separate endpoint rather than pointing the page at walkInSignIn()
 * directly, because the page and the write want to be able to move apart
 * later, and because a function called from a served page is part of that
 * page's contract: renaming one should not silently break the other.
 */
function doorSignIn(payload) {
  return walkInSignIn(payload);
}

/**
 * A CONTACT DETAIL, EITHER KIND. Plenty of members have a phone and no email
 * at all, and refusing their sign-in over an address they have never had is
 * the page turning somebody away at the door of their own senior center. One
 * of the two is asked for; which one is theirs to decide.
 */
function isPlausiblePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Do we have any way at all of reaching this person afterwards? */
function hasDoorContact(email, phone) {
  return isPlausibleEmail(String(email || '').trim()) || isPlausiblePhone(phone);
}

/**
 * EVERY LATER SESSION OF ONE PROGRAM, at one building, within one month.
 *
 * Read through readDeskMonthSessions() (section 16e) rather than off the
 * dashboard again: that function already answers "what is on at this building
 * between today and the end of next month", it already drops lunch-only
 * sessions and it already builds the session VALUE every write is keyed on. A
 * second reader of the same tabs is a second set of rules to keep in step with
 * the first, and the one that drifts is the one nobody is looking at.
 *
 * `title` is the CLEAN title (what a session choice carries before the
 * separator). Returns the sessions strictly after `fromDateKey` and no later
 * than the last day of `fromDateKey`'s month — "the rest of THIS month" is the
 * promise the door makes, and next month is a different one.
 */
function doorRemainingMonthSessions(location, title, fromDateKey) {
  const from = parseDateKey(fromDateKey);
  if (!from || !title) return [];
  const monthKey = fromDateKey.slice(0, 7);
  const wanted = normalizeNameKey(title);
  const out = [];
  const seen = {};
  (readDeskMonthSessions(location) || []).forEach(day => {
    if (day.monthKey !== monthKey || day.dateKey <= fromDateKey) return;
    (day.sessions || []).forEach(session => {
      if (normalizeNameKey(session.title) !== wanted) return;
      if (seen[session.value]) return;
      seen[session.value] = true;
      out.push({ value: session.value, dateKey: day.dateKey, title: session.title });
    });
  });
  out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return out.slice(0, DOOR_RECURRING_MAX_SESSIONS);
}

/**
 * A STANDING PLACE, made at the door — the second half of a walk-in sign-in
 * for somebody who is not here once.
 *
 * `choice` is what the page asked for:
 *   'month'  every remaining session of this program THIS MONTH, registered
 *            one at a time. No attendance is marked on any of them: a
 *            registration says where somebody is expected, and being here is
 *            a separate fact recorded on the day (see applyQuickMarkLocked()).
 *   'club'   the open-ended version — a row on Club_Members, which is that
 *            promise already, and which catches up every future session by
 *            itself (applyClubRosterCatchup()). Never on an appointment
 *            program, which the desk write refuses for us and reports.
 *
 * Returns lines for the sign-in receipt, one per thing done, because "and put
 * her down for the rest of the month" is not true of a call that half worked.
 */
function applyDoorRecurring(args) {
  const choice = String((args && args.choice) || '').trim().toLowerCase();
  if (!choice || choice === 'none' || choice === 'once') return [];
  const location = String(args.location || '').trim();
  const name = String(args.name || '').trim();
  const dateKey = String(args.dateKey || '').trim();
  const programs = args.programs || [];
  const lines = [];
  if (!programs.length) return lines;

  programs.forEach(program => {
    // An appointment is a chair at a time. A standing place in one is one
    // person holding every slot the program will ever run — refused here in
    // words rather than left to fail silently downstream.
    if (program.byAppointment) {
      lines.push(`⚠️ ${program.title} is booked by appointment, so no standing place was made ` +
        'for it. See a staff member.');
      return;
    }
    if (choice === 'club') {
      const res = applyQuickMarkFromDialog({
        location,
        session: program.value,
        name,
        register: true,
        standing: true,
        standingLunch: !!args.lunch,
        confirmWalkIn: true,
        phone: args.phone || '',
        email: args.email || ''
      });
      lines.push((res && res.message) ||
        `⚠️ ${program.title} — the standing place came back with nothing.`);
      return;
    }
    const later = doorRemainingMonthSessions(location, program.title, dateKey);
    if (!later.length) {
      lines.push(`ℹ️ ${program.title} does not run again at ${location} this month, ` +
        'so there was nothing further to book.');
      return;
    }
    let done = 0;
    let refused = '';
    later.forEach(session => {
      const res = applyQuickMarkFromDialog({
        location,
        session: session.value,
        name,
        register: true,
        confirmWalkIn: true,
        phone: args.phone || '',
        email: args.email || ''
      });
      if (res && res.ok) done++;
      else if (!refused) refused = (res && res.message) || '';
    });
    lines.push(done
      ? `📅 ${program.title} — registered for the ${done} further ` +
        `${done === 1 ? 'session' : 'sessions'} this month.`
      : `⚠️ ${program.title} — none of this month's later sessions could be booked. ` +
        (refused || 'Tell the office.'));
  });
  return lines;
}

/**
 * THE MEMBERSHIP HAND-OFF — for somebody who signed in at the door and said
 * they are not a member yet.
 *
 * DELIBERATELY NOT AN EMAIL YET. What the office sends a new member — the
 * form, the welcome, the sender it goes out as — is a decision nobody has
 * made in this repo, and a half-guessed template mailed to a real person is
 * worse than no mail at all. So this records the request where staff already
 * look for it (the Member_Roll staff note recordWalkInMember() writes, and the
 * admin digest) and returns the line the receipt shows.
 *
 * TODO: send the membership form. When the template exists, send it from here
 * and change the line below to say it was sent — every caller goes through
 * this one function, so nothing else has to change.
 */
function sendMembershipEmail(entry) {
  const name = String((entry && entry.name) || '').trim();
  const email = String((entry && entry.email) || '').trim();
  const phone = String((entry && entry.phone) || '').trim();
  const location = String((entry && entry.location) || '').trim();
  if (!name) return '';
  const reach = email || phone || 'no contact details';
  log(`sendMembershipEmail (not yet sending): ${name} — ${reach}${location ? ` at ${location}` : ''}`);
  noteForAdmin('Membership forms to send',
    `${name} signed in at the door${location ? ` at ${location}` : ''} and is not a member yet — ` +
    `send them the membership form (${reach}).`);
  return email
    ? `📨 ${name} is not a member yet — the office has been told to send the membership form to ${email}.`
    : `📨 ${name} is not a member yet — the office has been told to follow up` +
      (phone ? ` on ${phone}.` : '. There is no email or phone on file, so tell a staff member.');
}
