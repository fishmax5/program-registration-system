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
//   MEMBERSHIP The application itself, for the walk-in who has just said they
//              are not a member yet — built from the live questions of a
//              Google Form the office owns, and submitted back into that
//              form's own responses. Offered AFTER the sign-in, never as a
//              gate in front of it. See the membership section at the foot of
//              this file.
//
// WHAT LIVES HERE AND WHAT DOES NOT. This file is the SERVER half — the day
// read, the recurring-registration writes, the membership application. The page
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
 * WHAT THIS IS NOW, AND WHAT IT NO LONGER IS. It used to be the whole answer:
 * a staff note, a TODO, and a promise that somebody in the office would post a
 * form. The application is now filled in at the door instead (see the section
 * below), on the screen this sign-in hands them straight to.
 *
 * So this is the SECOND record rather than the only one, and it is still worth
 * writing. The person may put the tablet down and walk off; the older walk-in
 * page (section 16b) has no membership screen at all; and the application form
 * may be unreachable from this tablet. In every one of those cases the office
 * still has to know a real person asked, and where they can be reached — which
 * is what this writes, in the place staff already look (the Member_Roll staff
 * note recordWalkInMember() writes, and the admin digest).
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
  noteForAdmin('Membership forms to send',
    `${name} signed in at the door${location ? ` at ${location}` : ''} and is not a member yet — ` +
    `check whether they filled the application in at the door, and follow up if not (${reach}).`);
  return email
    ? `📨 ${name} is not a member yet — the office has been told, and can reach them at ${email}.`
    : `📨 ${name} is not a member yet — the office has been told to follow up` +
      (phone ? ` on ${phone}.` : '. There is no email or phone on file, so tell a staff member.');
}

// ----------------------------------------------------------------------------
// THE MEMBERSHIP APPLICATION  (a form the OFFICE owns, filled in at the door)
// ----------------------------------------------------------------------------
//
// WHAT REPLACED WHAT. This used to be a TODO: a walk-in said "not a member
// yet", the door wrote a staff note, and somebody in the office was supposed
// to post them a form. A door that silently drops a membership request is
// worse than one that never offered it, so the application is now filled in
// where the person is standing — on the tablet, before they walk away.
//
// NOTHING HERE KNOWS WHAT THE FORM ASKS. The application is a Google Form the
// office owns and edits; its id is one Config cell (see
// DEFAULT_MEMBERSHIP_FORM_ID) and its QUESTIONS are read live off the form on
// every open. Hardcoding "name, address, date of birth, fee" here would mean
// the day the office adds a question, the door quietly stops collecting it and
// nobody finds out until a stack of half-filled applications turns up. So the
// screen is built from whatever the form currently holds, and editing the form
// IS how the door's membership screen changes.
//
// AND THE ANSWERS GO BACK THROUGH THE FORM ITSELF — form.createResponse(),
// one item response per answer, .submit(). Not a scraped entry.NNNN POST at
// the form's public endpoint: that is an undocumented shape that breaks
// silently on a form edit, and it bypasses everything the form itself does on
// submit. Going through the API puts the answer in the form's own response
// sheet, which is where whoever processes memberships already looks, and where
// a response submitted on paper-day from a laptop lands too.
//
// THE PIN. This sits behind the same gate as every other door screen, which is
// the tablet's gate, not the applicant's: the door app asks for the desk PIN
// ONCE per tablet and then serves members all day. Putting the application in
// FRONT of that gate would mean a second PIN posture on one page — and asking
// an 82-year-old filling in a membership form for a staff code is how the
// tablet gets handed back. Both endpoints below still check the PIN
// themselves, exactly like doorDay() and doorSignIn(), because an endpoint is
// reachable directly whatever screen is meant to call it, and an ungated
// "submit this form" endpoint is a spam target with the centre's name on it.
//
// NO FORM_STATE_MIGRATIONS ENTRY, deliberately. That registry carries a LIVE
// form from the shape it was BUILT with to the shape this code now expects —
// it is for the registration forms this system generates. Nothing here changes
// the shape of any generated form: the membership application is not generated
// (it is read, never written), and no stored registry shape changed. A
// migration would have nothing to repair.

/** Item types the membership screen can draw as a real field, and answer. */
const MEMBERSHIP_FIELD_TYPES = [
  'TEXT', 'PARAGRAPH_TEXT', 'MULTIPLE_CHOICE', 'LIST', 'CHECKBOX', 'SCALE', 'DATE', 'TIME'
];

/** Item types that ask nothing — shown as words on the screen, never answered. */
const MEMBERSHIP_DISPLAY_TYPES = ['SECTION_HEADER', 'IMAGE', 'VIDEO', 'PAGE_BREAK'];

/**
 * What somebody is shown when the form cannot be opened at all. Said in plain
 * words with the form's own link under it, because the person is standing
 * there either way and "Exception: You do not have permission" is not a thing
 * to put in front of them.
 */
const MEMBERSHIP_NO_ACCESS_MESSAGE =
  'The membership application could not be opened on this tablet. ' +
  'Use the link below, or ask a staff member for a paper form.';

/**
 * THE FORM AS THE DOOR SEES IT — { ok, formId, url, title, description,
 * items[], usable, message }, serializable, read ONCE per execution.
 *
 * The item read is a remote call (form.getItems()), and the screen asks for it
 * on open and again after a failed submit, so it is memoized the way
 * getFormItemIndex() memoizes the same call for registration forms. The
 * REFUSAL is cached too: a form this executing user cannot open will not
 * become openable halfway through one execution, and paying a second remote
 * timeout to re-learn that is time the person at the door spends watching a
 * spinner.
 *
 * `items` never carries a live Item object — only the description a page can
 * render. Every answer is matched back to a live item by id at submit time,
 * off a fresh read, so nothing the browser sends decides what an item IS.
 */
function membershipFormShape() {
  if (__membershipFormShapeCache) return __membershipFormShapeCache.shape;
  const shape = readMembershipFormShape();
  __membershipFormShapeCache = { shape };
  return shape;
}

function readMembershipFormShape() {
  const formId = getMembershipFormId();
  if (!formId) {
    return {
      ok: false, usable: false, formId: '', url: '', items: [],
      message: 'No membership application is set up in this workbook. ' +
        'Add its form id to the Config tab, or ask a staff member for a paper form.'
    };
  }
  // THE FAILURE THIS CATCH IS FOR, and it is the likely one: the application
  // lives in a SHARED drive and is shared WITH the workbook's owner rather
  // than owned by them. FormApp.openById() needs EDIT access as the executing
  // user — view access is not enough, and neither is being able to open the
  // form in a browser as yourself. When that access is missing this throws,
  // and on a tablet an uncaught throw is a blank screen with a stack trace in
  // a log nobody reads.
  //
  // WHAT FIXES IT: grant the account this script runs as (the trigger owner /
  // whoever deployed the web app) edit access to the form, or copy the form
  // into the workbook's own forms folder and put the copy's id in Config.
  // Until then the door says so in words and hands over the form's link.
  let form;
  try {
    form = FormApp.openById(formId);
  } catch (err) {
    log(`⚠️ The membership application (${formId}) could not be opened: ${err}. ` +
      'FormApp.openById needs EDIT access as the executing user — grant it, ' +
      'or copy the form into this workbook\'s forms folder and point Config at the copy.');
    return {
      ok: false, usable: false, formId, url: membershipFallbackUrl(formId), items: [],
      message: MEMBERSHIP_NO_ACCESS_MESSAGE
    };
  }
  try {
    const items = form.getItems().map(describeMembershipItem).filter(Boolean);
    // A REQUIRED question this screen cannot draw makes the whole screen a
    // lie: every field would be filled in and the submit would be refused by
    // the form itself. Better to hand the person the real form up front than
    // to take five minutes of typing and then lose it.
    const blocking = items.filter(item => item.kind === 'unsupported' && item.required);
    return {
      ok: true,
      usable: !blocking.length,
      formId,
      url: form.getPublishedUrl() || membershipFallbackUrl(formId),
      title: form.getTitle() || 'Membership Application',
      description: form.getDescription() || '',
      items,
      message: blocking.length
        ? 'This application has a question that cannot be filled in on the tablet ' +
          `(${blocking[0].title}). Use the link below, or ask a staff member.`
        : ''
    };
  } catch (err) {
    log(`⚠️ The membership application (${formId}) could not be read: ${err}`);
    return {
      ok: false, usable: false, formId, url: membershipFallbackUrl(formId), items: [],
      message: MEMBERSHIP_NO_ACCESS_MESSAGE
    };
  }
}

/**
 * A link to the form when we could not open it to ask for its published one.
 * The viewform address is what a form's own link looks like; somebody who can
 * open the form at all can open this.
 */
function membershipFallbackUrl(formId) {
  return formId ? `https://docs.google.com/forms/d/${formId}/viewform` : '';
}

/**
 * ONE ITEM, as much of it as a page can draw — { id, type, kind, title, help,
 * required, ... }. `kind` is the only thing the page branches on:
 *
 *   'field'       something to answer, drawn as a native input.
 *   'display'     a heading, a notice, an image, a page break: words on the
 *                 screen, no answer.
 *   'unsupported' a question this screen has no honest way to ask — a grid, a
 *                 file upload, a duration. Shown BY NAME with the form's link
 *                 beside it rather than skipped, because a question quietly
 *                 missing from a membership application is an answer the
 *                 office thinks it collected.
 *
 * Every string here is the office's own text and reaches a browser: it is
 * carried as data (google.script.run, JSON) and drawn with textContent, never
 * interpolated into the page's markup. See buildMembershipFields().
 */
function describeMembershipItem(item) {
  let type = '';
  try {
    type = String(item.getType());
  } catch (err) {
    return null;
  }
  const base = {
    id: item.getId(),
    type,
    title: String(item.getTitle() || ''),
    help: String(item.getHelpText() || ''),
    required: false,
    kind: 'unsupported'
  };
  if (MEMBERSHIP_DISPLAY_TYPES.indexOf(type) !== -1) {
    base.kind = 'display';
    return base;
  }
  if (MEMBERSHIP_FIELD_TYPES.indexOf(type) === -1) return base;

  base.kind = 'field';
  try {
    if (type === 'TEXT') {
      base.required = item.asTextItem().isRequired();
    } else if (type === 'PARAGRAPH_TEXT') {
      base.required = item.asParagraphTextItem().isRequired();
    } else if (type === 'MULTIPLE_CHOICE' || type === 'CHECKBOX') {
      const typed = type === 'CHECKBOX' ? item.asCheckboxItem() : item.asMultipleChoiceItem();
      base.required = typed.isRequired();
      base.choices = typed.getChoices().map(choice => String(choice.getValue()));
      // "Other" is a text box wearing a choice's clothes, and a form that
      // offers it usually needs it (an address type, a referral source). The
      // page draws the extra box; createResponse() accepts the typed value
      // only because the item allows it.
      base.hasOther = !!typed.hasOtherOption();
    } else if (type === 'LIST') {
      const typed = item.asListItem();
      base.required = typed.isRequired();
      base.choices = typed.getChoices().map(choice => String(choice.getValue()));
      base.hasOther = false;
    } else if (type === 'SCALE') {
      const typed = item.asScaleItem();
      base.required = typed.isRequired();
      base.lowerBound = typed.getLowerBound();
      base.upperBound = typed.getUpperBound();
      base.lowerLabel = String(typed.getLeftLabel() || '');
      base.upperLabel = String(typed.getRightLabel() || '');
    } else if (type === 'DATE') {
      const typed = item.asDateItem();
      base.required = typed.isRequired();
      // A date question with the year switched off cannot take a year in its
      // response, so the page is told which shape this one is.
      base.includesYear = typed.includesYear ? !!typed.includesYear() : true;
    } else if (type === 'TIME') {
      base.required = item.asTimeItem().isRequired();
    }
  } catch (err) {
    // An item that will not describe itself is not one to guess at.
    log(`⚠️ Membership item "${base.title}" (${type}) could not be read: ${err}`);
    base.kind = 'unsupported';
  }
  return base;
}

/**
 * THE MEMBERSHIP SCREEN'S READ. Payload: { pin }. Returns the shape above.
 *
 * Gated on the desk PIN like every other endpoint on this page — see the
 * section note for why the gate is the tablet's rather than the applicant's.
 */
function doorMembershipForm(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  return membershipFormShape();
}

/**
 * THE APPLICATION ITSELF, submitted. Payload:
 *
 *   { pin, name, location, answers: [{ id, value }] }
 *
 * `value` is a string for text, choice and date/time fields, an array for
 * checkboxes, a number for a scale. `name` and `location` are for the log line
 * only — who was at which door — never for the form, whose own questions ask
 * for whatever the office decided to ask for.
 *
 * READ FRESH AND MATCHED BY ID. The live items are re-read here rather than
 * trusted from the page: a form edited between the open and the submit would
 * otherwise have answers written against the questions it USED to have, which
 * is the one failure mode worse than dropping the application. An id the form
 * no longer has is refused in words rather than quietly skipped.
 *
 * ALL OR NOTHING. Every item response is built BEFORE anything is submitted,
 * so a value one item refuses stops the whole submission instead of filing
 * half an application that looks complete to whoever reads it.
 */
function doorMembershipSubmit(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();

  const formId = getMembershipFormId();
  if (!formId) {
    return { ok: false, message: 'No membership application is set up in this workbook — nothing was sent.' };
  }
  let form;
  try {
    form = FormApp.openById(formId);
  } catch (err) {
    log(`⚠️ Membership application (${formId}) could not be opened to submit: ${err}`);
    return { ok: false, url: membershipFallbackUrl(formId), message: MEMBERSHIP_NO_ACCESS_MESSAGE };
  }

  const answers = Array.isArray(args.answers) ? args.answers : [];
  const built = buildMembershipItemResponses(form, answers);
  if (built.problems.length) {
    return { ok: false, message: built.problems[0], problems: built.problems };
  }

  try {
    let response = form.createResponse();
    built.responses.forEach(itemResponse => { response = response.withItemResponse(itemResponse); });
    response.submit();
  } catch (err) {
    log(`⚠️ A membership application could not be submitted (${formId}): ${err}`);
    return {
      ok: false,
      url: membershipFallbackUrl(formId),
      message: 'The application could not be sent from this tablet. ' +
        'Nothing was recorded — ask a staff member, or use the link below.'
    };
  }

  const name = String(args.name || '').trim();
  const location = String(args.location || '').trim();
  log(`Membership application submitted at the door${location ? ` (${location})` : ''}` +
    `${name ? ` by ${name}` : ''}.`);
  // THE APPLICATION ITSELF IS THE RECORD — it is in the form's own responses,
  // where memberships are processed, and that is true whether or not anything
  // below is ever read. The digest note rides the same collector the rest of
  // the door's notes do (see noteForAdmin), so it reaches the office on the
  // next sync that flushes one; the log line above is what is there
  // immediately.
  noteForAdmin('Membership applications from the door',
    `${name || 'Somebody'} filled in the membership application at the door` +
    `${location ? ` at ${location}` : ''} — it is in the application form's responses.`);
  return {
    ok: true,
    message: name
      ? `✅ Thank you, ${name} — your membership application has been sent to the office.`
      : '✅ Your membership application has been sent to the office.'
  };
}

/**
 * The answers, turned into ItemResponses against the form's LIVE items.
 *
 * Returns { responses, problems }. A problem is a sentence for the person at
 * the door, not a stack trace: a required question left blank, an answer the
 * item refuses, a question the form no longer has. The first one is what the
 * screen says; all of them come back so a page can mark every field at once.
 *
 * A blank OPTIONAL answer is left out entirely rather than submitted as '' —
 * an empty item response is refused by Forms, and "they did not answer" is
 * exactly what leaving it out means.
 */
function buildMembershipItemResponses(form, answers) {
  const byId = {};
  form.getItems().forEach(item => { byId[String(item.getId())] = item; });
  const given = {};
  (answers || []).forEach(answer => {
    if (answer && answer.id !== undefined && answer.id !== null) given[String(answer.id)] = answer.value;
  });

  const responses = [];
  const problems = [];
  Object.keys(given).forEach(id => {
    if (!byId[id]) {
      problems.push('This application has changed since it was opened. ' +
        'Start it again, or ask a staff member.');
    }
  });
  if (problems.length) return { responses, problems };

  form.getItems().forEach(item => {
    const described = describeMembershipItem(item);
    if (!described || described.kind === 'display') return;
    const value = given[String(item.getId())];
    const empty = value === undefined || value === null || value === '' ||
      (Array.isArray(value) && !value.length);
    if (described.kind === 'unsupported') {
      if (described.required) {
        problems.push(`"${described.title}" cannot be filled in on the tablet. ` +
          'Use the link to the full form, or ask a staff member.');
      }
      return;
    }
    if (empty) {
      if (described.required) problems.push(`"${described.title}" is required.`);
      return;
    }
    try {
      responses.push(membershipItemResponse(item, described, value));
    } catch (err) {
      // The item itself refused the answer — a choice that is not on its list,
      // a scale value out of range, a date that will not parse. Reported
      // against the question it belongs to.
      problems.push(`"${described.title}" was not accepted (${err}).`);
    }
  });
  return { responses, problems };
}

/** One answer against one live item. Throws whatever the item throws. */
function membershipItemResponse(item, described, value) {
  switch (described.type) {
    case 'TEXT':
      return item.asTextItem().createResponse(String(value));
    case 'PARAGRAPH_TEXT':
      return item.asParagraphTextItem().createResponse(String(value));
    case 'MULTIPLE_CHOICE':
      return item.asMultipleChoiceItem().createResponse(String(value));
    case 'LIST':
      return item.asListItem().createResponse(String(value));
    case 'CHECKBOX':
      return item.asCheckboxItem().createResponse(
        (Array.isArray(value) ? value : [value]).map(v => String(v)));
    case 'SCALE': {
      const num = Number(value);
      if (isNaN(num)) throw new Error('that is not a number');
      return item.asScaleItem().createResponse(num);
    }
    case 'DATE': {
      // parseDateKey() hands back an Invalid Date rather than a null for
      // anything it cannot read, so the shape is checked before the value.
      const text = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('that is not a date');
      const date = parseDateKey(text);
      if (isNaN(date.getTime())) throw new Error('that is not a date');
      return item.asDateItem().createResponse(date);
    }
    case 'TIME': {
      const parts = String(value).split(':');
      const hour = Number(parts[0]);
      const minute = Number(parts[1]);
      if (isNaN(hour) || isNaN(minute)) throw new Error('that is not a time');
      return item.asTimeItem().createResponse(hour, minute);
    }
    default:
      throw new Error(`${described.type} cannot be filled in on the tablet`);
  }
}
