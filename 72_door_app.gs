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
//   EVENTS     "What are you here for today?" — EVERYTHING on at that building
//              that day, whether or not anybody has registered for it, tapped
//              by THE PERSON STANDING THERE. This is the first screen of every
//              visit and nothing on it is pre-ticked: it is a question, not a
//              filter a volunteer sets in the morning, and it is emptied again
//              the moment a sign-in is away. Asking it first is what makes the
//              rest short — the name list after it holds one class instead of
//              the whole building, and the answer is already ticked on the
//              confirm screen. A quiet "Show everyone here today" is the way
//              past it for somebody who cannot work out which class is theirs.
//   NAMES      Two sections and a search box, all about what they just tapped.
//              First, everybody REGISTERED for it — deduped per person, A–Z
//              under letter headings, because somebody in three programs and a
//              lunch is one person at the door. Under them, HERE RECENTLY: the
//              regulars of those same programs from the last two months who
//              are not down for today (see foldPastRegistrants(), section 16h)
//              — the Tuesday class has the same eight people in it every week
//              and half of them have never filled in a form.
//   PERSON     Tapping a name opens the confirm screen — every event they are
//              down for today, lunch included, with what they said at the door
//              already ticked, and the same wiring the walk-in page already
//              had (walkInSignIn()). They confirm, or they change what is
//              ticked and then confirm.
//   WALK-IN    Under the search box, always on screen and never a second page:
//              "New here, or not registered?". It opens the day's programs as
//              cards, takes a name and a way to reach them, asks about a
//              standing place and about membership, and signs them in through
//              the same one write path. Somebody who says they are not a member
//              yet is FILED FOR THE OFFICE (recordMembershipHandoff) rather
//              than handed an application to fill in on the tablet — see that
//              function for what was there before and why it went.
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
 * The door app's only write — walkInSignIn() under its own name, and the
 * one place a failed sign-in still gets caught.
 *
 * Kept as a separate endpoint rather than pointing the page at walkInSignIn()
 * directly, because the page and the write want to be able to move apart
 * later, and because a function called from a served page is part of that
 * page's contract: renaming one should not silently break the other.
 *
 * THE APP DOES NOT WAIT ON THIS CALL (section 16g's send()) — a tablet at the
 * door shows "Signed in" and hands itself back to the name list the instant
 * somebody taps Confirm, because google.script.run has no true fire-and-forget
 * and a visitor should not have to stand there for Quick Mark's lock waits and
 * sheet writes to find that out. Which means a failure here reaches nobody at
 * the tablet — the screen has already moved on, maybe to the next person's
 * turn — so this is the one point that can still act on it: an unhandled
 * throw is caught rather than surfacing as a raw error the page never reads,
 * and anything that comes back other than success or a wrong PIN (the app's
 * own PIN screen still catches that, because a stale PIN fails every sign-in
 * after it, not just this one) is emailed to staff through
 * notifyAdminUrgent() — to everyone ticked for the sync digest on Config's
 * Admin Notification Emails table — so the visit can be entered by hand.
 * URGENT rather than the 10am office digest (88) precisely because somebody
 * is standing at the door: this is one of the two things in the workbook
 * that still mails the office the moment it happens.
 */
function doorSignIn(payload) {
  const args = parseCheckInPayload(payload);
  const res = doorSignInOne(payload);
  if (res && res.needsPin) return res;

  // THE REST OF THE HOUSEHOLD, one sign-in each. A couple who share a phone
  // number arrive together and the person screen offers to sign them both in
  // (see readWalkInDay()'s household), but they are two members with two sets
  // of rows and each one is written exactly as if they had been tapped
  // themselves — same lock, same row matching, same walk-in row for a session
  // they were not down for. Nothing about this is a group registration.
  //
  // Each is its own call rather than a loop inside walkInSignIn(), so one
  // companion failing (a name that no longer matches a row, a lock that
  // expired mid-party) neither takes down the rest nor loses its own
  // notification: doorSignInOne() reports every failure separately.
  const party = Array.isArray(args.party) ? args.party.slice(0, DOOR_PARTY_MAX) : [];
  const lines = (res && res.lines) ? res.lines.slice() : [];
  party.forEach(companion => {
    const one = Object.assign({}, companion, {
      location: args.location, dateKey: args.dateKey, pin: args.pin,
      // A companion is never the one who answers the membership question or
      // sets up a recurring booking — those were asked of the person at the
      // desk, about themselves.
      recurring: 'none', member: ''
    });
    const got = doorSignInOne(one);
    if (got && got.lines) got.lines.forEach(line => lines.push(line));
    else if (got && got.message) lines.push(`${companion.name || 'Someone'}: ${got.message}`);
  });
  if (res && party.length) res.lines = lines;
  return res;
}

/**
 * HOW MANY PEOPLE ONE TAP CAN SIGN IN. A household is a household; a screen
 * offering to sign in twelve people is a grouping that has gone wrong
 * somewhere upstream, and the door is not where that should be discovered.
 */
const DOOR_PARTY_MAX = 8;

/** One person, signed in and reported — the body doorSignIn() had before it took a party. */
function doorSignInOne(payload) {
  let res;
  try {
    res = walkInSignIn(payload);
  } catch (err) {
    log(`doorSignIn: walkInSignIn threw: ${err}`);
    reportDoorSignInFailure(payload, `Threw an error: ${err}`);
    return { ok: false, message: 'Something went wrong.', lines: [], name: '' };
  }
  if (res && !res.ok && !res.needsPin) {
    reportDoorSignInFailure(payload, res.message || '(no message came back)');
  }
  return res;
}

/**
 * One email per failed door sign-in — see doorSignIn() for why this is the
 * only place that failure is ever going to be seen. Parses `payload` itself
 * rather than taking the already-parsed args, so a thrown-before-parsing
 * failure can still be reported with whatever of the payload is readable.
 */
function reportDoorSignInFailure(payload, reason) {
  const args = parseCheckInPayload(payload);
  const lines = [
    'A door app sign-in did not complete, but the tablet had already shown the visitor "Signed in" — see 73_door_app_html.gs\'s send().',
    '',
    `Name: ${args.name || '(none)'}`,
    `Location: ${args.location || '(none)'}`,
    `Date: ${args.dateKey || '(today)'}`,
    `Phone: ${args.phone || '(none)'}`,
    `Email: ${args.email || '(none)'}`,
    '',
    `Reason: ${reason}`,
    '',
    'Please check whether this visit needs to be entered by hand.'
  ];
  // URGENT, not the daily digest: somebody is standing at the door and the
  // visit may need entering by hand today. See notifyAdminUrgent() (15).
  notifyAdminUrgent('[Door app] A sign-in did not complete', lines.join('\n'));
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
 * they are not a member yet. One line filed for the office, and nothing else.
 *
 * WHAT THIS REPLACED. The door used to hand that person the application ITSELF
 * on a screen of its own, built from the live questions of the office's Google
 * Form and submitted back through the Forms API. It worked, and it was the
 * wrong thing to put at a door: a membership application is ten minutes of
 * personal detail — address, date of birth, emergency contact, a fee — typed
 * standing up on a shared tablet with somebody waiting behind you, and the
 * screen that asks for it is the screen the person hands back. The office
 * would rather have a name and a phone number than three half-finished
 * applications a week.
 *
 * So the answer to "not a member yet" is a NOTE, filed where the office
 * already looks: the 10am daily digest (88_office_daily_digest.gs, through
 * noteForAdmin) plus the Member_Roll staff note recordWalkInMember() writes.
 * It carries the application's own link so whoever follows up has the thing to
 * send in front of them — that link is the one thing Config's membership form
 * id is still read for.
 *
 * NOT URGENT, deliberately. notifyAdminUrgent() is for the two faults where
 * somebody is standing at the desk waiting on a fix (see 88's banner);
 * "somebody would like to join" is a thing to do tomorrow morning, and putting
 * it on the urgent path is how the urgent path stops being read.
 *
 * Renamed from sendMembershipEmail(): it never sent mail, and a name that says
 * it does is a name somebody eventually believes.
 */
function recordMembershipHandoff(entry) {
  const name = String((entry && entry.name) || '').trim();
  const email = String((entry && entry.email) || '').trim();
  const phone = String((entry && entry.phone) || '').trim();
  const location = String((entry && entry.location) || '').trim();
  if (!name) return '';
  const reach = email || phone || 'no contact details';
  log(`recordMembershipHandoff: ${name} — ${reach}${location ? ` at ${location}` : ''}`);
  const link = membershipApplicationUrl();
  noteForAdmin('Membership applications to send',
    `${name} signed in at the door${location ? ` at ${location}` : ''} and is not a member yet — ` +
    `send them a membership application and follow up (${reach}).` +
    (link ? ` The application is at ${link}` : ''));
  return email
    ? `📨 ${name} is not a member yet — the office has been told, and can reach them at ${email}.`
    : `📨 ${name} is not a member yet — the office has been told to follow up` +
      (phone ? ` on ${phone}.` : '. There is no email or phone on file, so tell a staff member.');
}

/**
 * A link to the membership application, for the office's note — '' when
 * Config's Membership Application Form cell is blank, which is a complete
 * answer: the note then names the person and says to send them one, which is
 * what it said before the cell existed.
 *
 * The viewform address is what a form's own link looks like, and it is built
 * rather than asked for: nothing at the door opens that form any more, and
 * paying a remote call to be told the address of a link nobody is waiting on
 * would be a sign-in slowed down for a line in tomorrow's digest.
 */
function membershipApplicationUrl() {
  const formId = getMembershipFormId();
  return formId ? `https://docs.google.com/forms/d/${formId}/viewform` : '';
}
