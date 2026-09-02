// ============================================================================
// 16b. THE WALK-IN SIGN-IN PAGE  (the door, for the people who never registered)
// ============================================================================
//
// The check-in page above answers "who is registered for THIS SESSION, and
// have they arrived?". That is the right question for a class with a roster
// and the wrong one for the front door of a senior center, where the person
// standing there is as likely as not to be somebody who saw the newsletter,
// walked in, and has never filled in a form in their life. The session page
// has no row for them at all, and its only answer is to send them to find a
// member of staff with the spreadsheet open.
//
// So the location links open on THIS page instead, and it asks the two
// questions a door actually asks, in that order:
//
//   1. WHO ARE YOU? Everybody registered for anything at this building today
//      is a card, alphabetically — because on an ordinary morning the person
//      at the door IS one of them, and tapping your own name off a screen of
//      twenty is faster than typing it. Under the cards: a search across the
//      whole Member_Roll for the regular who did not register this time, and
//      "I'm new here", which takes a name and an email and nothing else.
//   2. WHAT ARE YOU HERE FOR? Every program running at this building today
//      and, at the bottom, the day's lunch. Anything they are already
//      registered for is ticked and says so; anything else is offered
//      unticked, and ticking it registers them on the spot — the same
//      walk-in row Quick Mark writes (addQuickMarkWalkIn()), through the same
//      function, under the same lock.
//
// WHY LUNCH IS NOT JUST ANOTHER TICK. A meal is ordered from a caterer days
// ahead against a count (see section 8), so a lunch nobody registered for is
// not a box to tick and forget — there may be no food for it. The page
// therefore treats the two states as different things: a registered lunch is
// ticked and reads "already ordered for you", and an unregistered one is
// offered with the plain warning that a meal is not promised and staff have to
// be asked. Ticking it records the DEMAND (Lunch_Status = Needed — the same
// sign-up the desk dialog makes), which is what puts the person on the
// kitchen's list and on the dashboard's "lunch needed" line, and it never
// claims a meal was served.
//
//   3. AND ARE YOU COMING BACK? Under those two questions: every session at
//      this building in this month and the next (deskMonthSessions()), as a
//      day picker and a box per program. Ticking one REGISTERS them for that
//      date — never marks them present at it — and one further tick makes
//      those club places, on every future date of the programs picked. It is
//      the question a front desk is asked all day and could not answer from a
//      tablet: "what have you got next month, and can I put my name down now".
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not hand meals over
// (Lunch_Served is a tap at the counter, on the check-in page, where the food
// is), it does not book appointments — a [Personalized Assistance] slot is a
// chair at a time and picking one is a conversation, so those programs are
// shown, marked "by appointment", and left to staff — and it does not take a
// membership. It takes an EMAIL, so the office can send the membership form
// to somebody who is by then already inside and signed in.
//
// WHAT IT DOES NOT MAKE ANYBODY WAIT FOR. The day this page shows is inlined
// into the page itself from a stored snapshot (section 16d) and drawn on the
// first frame; the live read below runs behind it and replaces it. So the boot
// has no spinner in it, and the list is still the sheet's a second later.
// ============================================================================

/**
 * How many Member_Roll names travel inside the page for its search box.
 *
 * The roll is names and nothing else here — no phone, no email — because the
 * page only needs to FIND a person, and a directory of contact details is not
 * something to hand to a tablet that lives on a table by the door.
 */
const WALK_IN_MAX_MEMBERS = 4000;

/** What ?mode= has to say to get the session roster instead of the door page. */
const CHECK_IN_ROSTER_MODES = ['session', 'sessions', 'checkin', 'check-in', 'roster'];

/**
 * Is this request asking for the SESSION ROSTER (section 16) rather than the
 * door page? Spelled several ways on purpose: the URL is typed by hand onto
 * tablets and read off a printed card, and refusing "check-in" because the
 * page is called "checkin" internally would be a page that mysteriously shows
 * the wrong thing.
 */
function checkInRosterModeRequested(params) {
  const mode = String((params && (params.mode || params.page || params.view)) || '')
    .trim().toLowerCase();
  return CHECK_IN_ROSTER_MODES.indexOf(mode) !== -1;
}

/**
 * TODAY AT ONE BUILDING — who is expected, what is on, and what is for lunch.
 *
 * One call rather than three, because the page cannot draw anything useful
 * until it has all of it, and three round trips to Apps Script is three
 * seconds of a volunteer looking at a spinner.
 *
 * Payload: { location, pin }. Returns { ok, message, day } — see
 * readWalkInDay() for the shape of `day`.
 *
 * THIS IS NOW THE BACKGROUND CALL. The page draws from the snapshot inlined
 * into it (section 16d) and then makes this call silently to correct it, so
 * what happens here is no longer what a volunteer is watching. Two things
 * follow from that:
 *
 *   - The fresh day is folded back into the boot store on the way out
 *     (rememberWalkInDay()). The read is already paid for; giving it to the
 *     next tablet to boot costs one cache write on a call nobody is waiting on.
 *   - A desk blocked by a forms sweep answers with the STORED day rather than
 *     a refusal. The page has that day on screen already; replacing it with
 *     "the workbook is busy" would be taking the door's list away over
 *     something the door does not care about.
 */
function walkInDay(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  const location = matchCheckInLocation(args.location);
  if (!location) {
    return { ok: false, message: 'Choose a location first — nothing was read.' };
  }
  // Same judgement as the roster call: a forms sweep is no reason to shut the
  // front door — and now there is something to hand back instead of a refusal.
  if (isDeskWorkBlocked()) {
    const stored = storedWalkInDay(location);
    if (stored) return { ok: true, day: stored, stale: true };
    return { ok: false, message: deskBusyMessage() };
  }
  try {
    const day = readWalkInDay(location);
    rememberWalkInDay(day);
    return { ok: true, day };
  } catch (err) {
    log(`walkInDay failed: ${err}`);
    // The stored day is a worse answer than the live one and a far better
    // answer than none: the tablet is standing at a door with a queue at it.
    const stored = storedWalkInDay(location);
    if (stored) return { ok: true, day: stored, stale: true };
    return { ok: false, message: `Could not read today's list (${err}).` };
  }
}

/**
 * The day, read live off the workbook:
 *
 *   {
 *     location, dateKey, dateLabel, readAt,
 *     programs: [{ value, title, time, byAppointment, noRegistration }],
 *     lunch:    { offered, ruledOut, type, dish, title, value },
 *     people:   [{ name, key, phone, registered[], attended[], lunchRegistered,
 *                  lunchServed, here }],
 *     members:  [{ name, key }]
 *   }
 *
 * `value` is a Quick Mark SESSION CHOICE — "Chair Yoga · Mon, Sep 1, 2025" —
 * and not a display string that happens to look like one. It is what every
 * write below is made against (parseQuickMarkProgramChoice() parses it back),
 * so the page never has to know how a session is identified and there is no
 * second matching rule in this file to keep in step with the first.
 *
 * NOTHING HERE IS READ FROM A CACHE. The Quick Mark index is a snapshot built
 * on a trigger, which is exactly right for a dropdown of six months of
 * sessions and exactly wrong for a door: somebody who registered an hour ago
 * has to be on this list, and somebody already signed in has to show as signed
 * in. One location's single day is a small read, and it is made once per
 * person at the door rather than once per tap.
 *
 * What IS cached is what the page draws before this answers — the boot
 * snapshot of section 16d, which is a copy of this function's own output and
 * is replaced by it on every load. This function stays the truth; it simply is
 * no longer the thing a volunteer waits on.
 *
 * `dateKeyOverride` is for the tests, which cannot move the clock.
 */
function readWalkInDay(location, dateKeyOverride) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const loc = String(location || '').trim();
  const dateKey = String(dateKeyOverride || '').trim() || formatDateKey(new Date());
  const date = parseDateKey(dateKey);
  const dateLabel = formatDateLabel(date);
  const sessionValue = title => `${title}${LOCATION_LABEL_SEPARATOR}${dateLabel}`;

  const programs = [];
  const programByValue = {};
  const addProgram = entry => {
    if (!entry.title || programByValue[entry.value]) return;
    programByValue[entry.value] = entry;
    programs.push(entry);
  };

  // A lunch-only session's own title carries the dish, and the dish is
  // retyped: the title on the session table, the title on a registrant row
  // written last week, and the title lunchOnlyRowTitle() computes now can all
  // differ. The CANONICAL one is the one computed now — it is what a new row
  // has to be written under — so the others are only ever matched against, by
  // shape (isLunchOnlyProgramTitle()), never used as an identity.
  const lunchTitle = lunchOnlyRowTitle(loc, dateKey);

  const dash = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  if (dash) {
    const headers = HEADERS.Master_Program_Dashboard;
    const map = getIndexMap(headers);
    readAllSectionedRowValues(dash, headers, 'Event_ID').forEach(row => {
      if (String(row[map['Location']] || '').trim() !== loc) return;
      const d = coerceDate(row[map['Event_Date']]);
      if (!d || formatDateKey(d) !== dateKey) return;
      const title = String(row[map['Clean_Title']] || '').trim();
      if (!title || isLunchOnlyProgramTitle(title)) return; // the meal has its own section
      addProgram({
        value: sessionValue(title),
        title,
        time: eventTimeLabelOf(row[map['Event_Time']]) ||
          formatTimeRange(d, map['Event_End'] === undefined ? '' : row[map['Event_End']]),
        // A chair at a time, not a place in a room — offered, but never
        // booked from here. See the section note.
        byAppointment: map['Personalized_Assistance'] !== undefined &&
          isAssistanceColumnValue(row[map['Personalized_Assistance']]),
        // A drop-in with no form. Signing in is still worth recording — that
        // is the only attendance number one of these will ever have.
        noRegistration: map['No_Registration'] !== undefined &&
          isTruthyCheckbox(row[map['No_Registration']]),
        order: d.getHours() * 60 + d.getMinutes()
      });
    });
  }

  const people = [];
  const peopleByKey = {};
  const reg = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
  if (reg) {
    const headers = HEADERS.Registrant_Dash;
    const map = getIndexMap(headers);
    readAllSectionedRowValues(reg, headers, 'Event_ID').forEach(row => {
      if (String(row[map['Location']] || '').trim() !== loc) return;
      const d = coerceDate(row[map['Event_Date']]);
      if (!d || formatDateKey(d) !== dateKey) return;
      const name = String(row[map['Name']] || '').trim();
      if (!name) return;
      const key = normalizeNameKey(name);
      let person = peopleByKey[key];
      if (!person) {
        person = {
          name, key, phone: '', registered: [], attended: [],
          // lunchOnly: their meal is booked on a LUNCH ROW OF ITS OWN rather
          // than as a rider on a program they signed up for. It is the
          // difference between having something to mark them present against
          // and having nothing — see walkInSignIn().
          //
          // lunchOn: the session value of the row that actually carries the
          // meal, so the handover is marked on THAT row rather than on
          // whichever program happened to be ticked first. One person can hold
          // three rows today and only one of them ordered food.
          lunchRegistered: false, lunchOnly: false, lunchOn: '', lunchServed: false, here: false
        };
        peopleByKey[key] = person;
        people.push(person);
      }
      const attended = map['Attended'] !== undefined && isTruthyCheckbox(row[map['Attended']]);
      if (attended) person.here = true;
      if (!person.phone && map['Phone'] !== undefined) {
        person.phone = String(row[map['Phone']] || '').trim();
      }
      // WHETHER A MEAL IS ALREADY ORDERED FOR THEM, which is the one fact
      // that decides what the lunch line says. Read off any of the day's rows
      // — a lunch is counted once per person per day however many of that
      // day's programs they ticked it on (see countLunchMeals()).
      const rowTitle = String(row[map['Event']] || '').trim();
      if (map['Lunch_Status'] !== undefined &&
        String(row[map['Lunch_Status']] || '').trim().toLowerCase() === 'needed') {
        person.lunchRegistered = true;
        if (!person.lunchOn && rowTitle) {
          person.lunchOn = isLunchOnlyProgramTitle(rowTitle)
            ? sessionValue(lunchTitle) : sessionValue(rowTitle);
        }
      }
      if (map['Lunch_Served'] !== undefined && isTruthyCheckbox(row[map['Lunch_Served']])) {
        person.lunchServed = true;
      }
      const title = rowTitle;
      if (!title || isLunchOnlyProgramTitle(title)) {
        if (title) person.lunchOnly = true;
        return;
      }
      const value = sessionValue(title);
      // A registration whose session is not on the dashboard today — a row
      // written against a program the calendar has since dropped — still
      // belongs on the list: the person is standing there holding it.
      addProgram({
        value, title, time: eventTimeLabelOf(row[map['Event_Time']]),
        byAppointment: false, noRegistration: false, order: 24 * 60
      });
      if (person.registered.indexOf(value) === -1) person.registered.push(value);
      if (attended && person.attended.indexOf(value) === -1) person.attended.push(value);
    });
  }

  const meal = getMealInfoForDate(date, loc);
  const mealType = meal ? String(meal.type || '').trim() : '';
  people.sort((a, b) => a.name.localeCompare(b.name));
  programs.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));

  return {
    location: loc,
    dateKey,
    dateLabel,
    programs,
    lunch: {
      // Whether a meal can be signed up for at all today. False on a Zoom-only
      // location, on a day the kitchen is shut, and on a By-exception
      // location whose menu has no row for today — see isLunchOfferedOn().
      offered: isLunchOfferedOn(date, loc),
      // Shut BY A DECISION rather than merely unplanned. The page says the two
      // differently, because "no lunch today" and "no menu typed yet" are
      // different answers to the person asking.
      ruledOut: lunchIsRuledOutOn(date, loc),
      type: mealType,
      dish: meal ? String(meal.shorthand || meal.description || '').trim() : '',
      title: lunchTitle,
      value: sessionValue(lunchTitle)
    },
    people,
    members: readWalkInMembers(),
    readAt: Utilities.formatDate(new Date(), TIMEZONE, 'h:mm a')
  };
}

/**
 * FOR THE LENGTH OF ONE EXECUTION, and no longer — the same contract as the
 * memo caches in section 5a.
 *
 * The roll is the same list for every building, and buildWalkInDayStore()
 * reads a day per building: without this, warming a workbook with four
 * locations reads, dedupes and sorts four thousand names four times over and
 * throws three of them away. Cleared by the one thing that changes the roll
 * inside an execution (recordWalkInMember()).
 */
let walkInMembersMemo = null;

function invalidateWalkInMembersMemo() {
  walkInMembersMemo = null;
}

/**
 * Every name on Member_Roll, deduped and alphabetical, as { name, key }.
 *
 * NAMES ONLY. The page needs to find a person, not to know how to reach one,
 * and a tablet by the front door is the last place to put a directory of
 * everybody's phone number.
 */
function readWalkInMembers() {
  if (walkInMembersMemo) return walkInMembersMemo;
  const out = [];
  const seen = {};
  collectKnownMembers().forEach(name => {
    const key = normalizeNameKey(name);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push({ name, key });
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  walkInMembersMemo = out.slice(0, WALK_IN_MAX_MEMBERS);
  return walkInMembersMemo;
}

/**
 * ONE PERSON, SIGNED IN — the page's only write.
 *
 * Payload: { location, name, phone, email, newMember, programs: [value…],
 *            lunch, pin, dateKey, recurring, member }.
 *
 * The last three are the door app's (section 16f) and are all optional, so
 * the old page's payload still means exactly what it meant: `dateKey` is the
 * day this sign-in is against (blank = today), `recurring` is 'none' | 'month'
 * | 'club' (see applyDoorRecurring()), and `member` is 'yes' | 'no' — only
 * 'no' does anything, and what it does is start the membership hand-off.
 *
 * Every mark goes through applyQuickMarkFromDialog(), one session at a time:
 * same lock, same row matching, same walk-in row, same wording. What is added
 * here is the ORDER of those calls and the judgement between them —
 * registered or not, appointment or not, a meal already ordered or one that
 * has to be asked for — and each one's answer is handed back as its own line,
 * because "signed in" is not true of a person whose four ticks did four
 * different things.
 */
function walkInSignIn(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  if (isDeskWorkBlocked()) return { ok: false, message: deskBusyMessage() };

  const location = matchCheckInLocation(args.location);
  if (!location) return { ok: false, message: 'Choose a location first — nothing was signed in.' };
  const name = String(args.name || '').trim();
  if (!name) return { ok: false, message: 'Pick a name first — nothing was signed in.' };
  const phone = String(args.phone || '').trim();
  const email = String(args.email || '').trim();
  const newMember = !!args.newMember;
  const wanted = (args.programs || []).map(v => String(v || ''));
  const wantsLunch = !!args.lunch;
  // WHICH DAY THIS SIGN-IN IS AGAINST. Blank means today, which is every
  // sign-in made at a door; the door app (section 16f) can be set up on
  // another date, and a tick made on that screen has to land on that date's
  // rows rather than on today's.
  const dateKey = String(args.dateKey || '').trim() || formatDateKey(new Date());
  // 'none' | 'month' | 'club' — see applyDoorRecurring().
  const recurring = String(args.recurring || '').trim().toLowerCase();
  // 'yes' | 'no' | '' — whether they told us they are a member already. Only
  // 'no' does anything: it is what starts the membership hand-off.
  const memberStatus = String(args.member || '').trim().toLowerCase();
  // THE DATES THEY PICKED OFF THE "COMING UP" SECTION — sessions in this month
  // or next (deskMonthSessions()), which are a REGISTRATION and never an
  // attendance: nobody is present at a class in three weeks' time.
  const upcoming = (Array.isArray(args.upcoming) ? args.upcoming : [])
    .map(v => String(v || '').trim()).filter(v => v);
  const upcomingStanding = !!args.upcomingStanding;
  if (!wanted.length && !wantsLunch && !upcoming.length) {
    return { ok: false, message: 'Tick what you are here for first — nothing was signed in.' };
  }
  // A NEW MEMBER WE CANNOT REACH IS THE ONE REFUSAL. The whole reason the
  // page asks a stranger for anything at all is so the office can send them a
  // membership form afterwards; a row with no way to reach them on it is a
  // person we have quietly lost. EITHER an email or a phone number will do —
  // a good number of members have never had an address, and refusing their
  // sign-in over one is the door turning away the people it is there for.
  // Everything else about them can wait.
  if (newMember && !hasDoorContact(email, phone)) {
    return {
      ok: false,
      message: 'An email address or a phone number is needed so the office can send the ' +
        'membership form. Nothing was signed in.'
    };
  }

  let day;
  try {
    day = readWalkInDay(location, dateKey);
  } catch (err) {
    log(`walkInSignIn could not read the day: ${err}`);
    return { ok: false, message: `Could not read today's list (${err}) — nothing was signed in.` };
  }

  const lines = [];
  const person = day.people.filter(p => p.key === normalizeNameKey(name))[0] || null;

  // THE MEMBER ROW GOES IN FIRST, and its failure is reported rather than
  // thrown: somebody is standing at the door, and losing their sign-in to a
  // problem writing a directory row would be much the worse outcome.
  //
  // ONLY FOR SOMEBODY NEW. Writing the roll means rewriting the whole tab
  // (writeMemoryTab()), which is a fine price for the two or three people a
  // week who join at the door and an absurd one to pay on every tap of every
  // name — and there is nothing to add for a person the roll already holds
  // whose details came off the roll in the first place.
  if (newMember) {
    lines.push(recordWalkInMember({
      name, phone, email, location, isNew: newMember, date: parseDateKey(day.dateKey)
    }));
  }

  let firstProgramValue = '';
  let done = 0;
  // What was actually ticked, kept for the recurring pass at the foot of this
  // function: "and the rest of the month" is a statement about these programs
  // and no others.
  const pickedPrograms = [];
  day.programs.forEach(program => {
    if (wanted.indexOf(program.value) === -1) return;
    pickedPrograms.push(program);
    const already = !!(person && person.registered.indexOf(program.value) !== -1);
    // An appointment is a chair at a time (see ASSISTANCE_TAG), and choosing
    // one is a conversation about which times are left. The page shows the
    // program so nobody thinks it is missing, and hands the booking to staff.
    if (!already && program.byAppointment) {
      lines.push(`⚠️ ${program.title} is booked by appointment — see a staff member to make one. ` +
        'Nothing was added for it.');
      return;
    }
    const res = applyQuickMarkFromDialog({
      location,
      session: program.value,
      name,
      attended: true,
      // Not on the list yet: this is the walk-in row, and the page has already
      // asked the person in front of it, which is what confirmWalkIn means.
      register: !already,
      confirmWalkIn: true,
      phone,
      email
    });
    lines.push((res && res.message) || `⚠️ ${program.title} — nothing came back.`);
    if (res && res.ok) {
      done++;
      if (!firstProgramValue) firstProgramValue = program.value;
    }
  });

  if (wantsLunch) {
    const dish = day.lunch.dish ? ` (${day.lunch.dish})` : '';
    if (person && person.lunchRegistered) {
      // A MEAL ALREADY ORDERED, MARKED AS HANDED OVER. The door is where the
      // meal is collected in this building, so the tick is the handover —
      // Lunch_Served, the same column the check-in list's Lunch button sets,
      // and the same one the counter unticks if it turns out the meal was not
      // taken after all.
      //
      // ON THE ROW THAT ORDERED THE FOOD (person.lunchOn), not on whichever
      // program sorted first: one person can hold three rows today and only
      // one of them is the meal. `attended` rides along because a lunch tick
      // on its own is the TAKE-OUT case, which clears attendance — see
      // applyQuickMarkLocked() — and somebody standing at the door plainly
      // came in.
      const res = applyQuickMarkFromDialog({
        location,
        session: person.lunchOn || firstProgramValue || day.lunch.value,
        name,
        attended: true,
        lunch: true
      });
      lines.push(res && res.ok
        ? `${res.message} 🍽️ Lunch${dish} was already ordered for you and is marked handed over.`
        : ((res && res.message) || `🍽️ Lunch${dish} is already ordered for you — collect it at the counter.`));
      if (res && res.ok) done++;
    } else if (!day.lunch.offered) {
      lines.push(day.lunch.ruledOut
        ? `⚠️ No lunch is being served at ${location} today, so none was added.`
        : `⚠️ Today's menu at ${location} has not been set, so a lunch could not be added. ` +
          'Ask a staff member.');
    } else {
      // ONTO THE ROW THEY WERE JUST PUT ON, when there is one. A meal is
      // counted once per person per day whichever program it was ticked
      // against, so signing the lunch onto the program row says the same
      // thing as a second lunch-only row and says it in one row instead of
      // two. With no program ticked there is nothing to attach it to, and the
      // day's own lunch session is what the meal belongs to.
      const lunchSession = firstProgramValue || day.lunch.value;
      const res = applyQuickMarkFromDialog({
        location,
        session: lunchSession,
        name,
        signup: true,
        confirmWalkIn: true,
        phone,
        email
      });
      if (res && res.ok) {
        done++;
        // TWO WRITES, AND THEY SAY DIFFERENT THINGS. The sign-up above is the
        // ORDER — it is what puts the meal on the kitchen's count and on the
        // dashboard's "lunch needed" line, and it has to exist even for a meal
        // handed over a minute later, or the day reports a meal served that
        // nobody ever ordered. This second write is the HANDOVER.
        //
        // They cannot be one call: applyQuickMarkLocked() treats a sign-up and
        // a served tick as mutually exclusive on purpose, because one is a
        // meal expected and the other a meal already gone.
        const handed = applyQuickMarkFromDialog({
          location, session: lunchSession, name, attended: true, lunch: true
        });
        lines.push(`${res.message} ${handed && handed.ok ? 'Marked handed over. ' : ''}` +
          "⚠️ Today's meals were ordered in advance — check with a staff member that there is " +
          'one spare. If there is not, untick the lunch on the check-in list.');
      } else {
        lines.push((res && res.message) || '⚠️ The lunch could not be added.');
      }
    }
  }

  // THE FUTURE DATES, AFTER EVERYTHING ABOUT TODAY. A person standing at the
  // door is here for today first; a booking for the 14th that fails must not
  // be able to cost them the sign-in they came for, so it happens last and its
  // failure is a line rather than a return.
  //
  // register, and never attended,: these rows are a place on a list, and a
  // door that could tick somebody present for a session three weeks out is a
  // door that quietly inflates every attendance number the workbook reports.
  //
  // standing is the CLUB PLACE — the same one the desk's register screen
  // offers (checkInRegister()), which is a Club_Members row and a place on
  // every future date of that program rather than on this one date.
  upcoming.forEach(session => {
    const res = applyQuickMarkFromDialog({
      location,
      session,
      name,
      register: true,
      confirmWalkIn: true,
      phone,
      email,
      standing: upcomingStanding,
      // Never a standing LUNCH from the door: a meal on every future date is a
      // standing order with the caterer, and it is not a thing to sign
      // somebody up for at a tablet without asking the kitchen.
      standingLunch: false
    });
    lines.push((res && res.message) || `⚠️ ${session} — nothing came back.`);
    if (res && res.ok) done++;
  });
  // A STANDING PLACE, AFTER THE DAY ITSELF IS SAFE. Today's ticks are what the
  // person at the door is waiting on; the rest of the month is a promise about
  // dates nobody is standing on, and a failure to make it must not be able to
  // cost the sign-in that already worked.
  if (done && recurring && recurring !== 'none') {
    applyDoorRecurring({
      location, name, dateKey, phone, email,
      lunch: wantsLunch,
      choice: recurring,
      programs: pickedPrograms
    }).forEach(line => lines.push(line));
  }

  // THE MEMBERSHIP HAND-OFF, last and never fatal. Somebody who has just told
  // the door they are not a member yet is already inside and signed in; what
  // is left is the office's to do, and it is recorded rather than sent — see
  // sendMembershipEmail().
  if (memberStatus === 'no') {
    const note = sendMembershipEmail({ name, email, phone, location });
    if (note) lines.push(note);
  }

  const message = done
    ? `✅ Signed in — ${name}.`
    : `⚠️ Nothing was recorded for ${name}. Read the notes below, or ask a staff member.`;
  log(`walkInSignIn: ${message} ${lines.join(' | ')}`);
  return { ok: !!done, message, lines, name };
}

/**
 * Puts a person on Member_Roll from the door, and says in one line what
 * happened. Never throws — see the caller.
 *
 * ADDITIVE, NEVER OVERWRITING. A name already on the roll keeps every value
 * it has; a blank phone or email is filled in from what they just typed, and
 * that is all. The roll's computed columns belong to refreshMemberRoll(),
 * which recomputes them from the registrant history on the next sync — and
 * which leaves a row it finds no history for exactly as it is, so a person
 * added here survives until their first registration turns up.
 *
 * THE STAFF NOTE IS THE POINT. "Send them the membership form" is the whole
 * reason the page asks a stranger for an email, and a note nobody can find is
 * the same as no note: it goes in Staff_Notes, which is a column
 * refreshMemberRoll() never touches (MEMBER_ROLL_STAFF_COLUMNS), so it stays
 * there until a person deletes it.
 */
function recordWalkInMember(entry) {
  const name = String(entry.name || '').trim();
  const phone = String(entry.phone || '').trim();
  const email = String(entry.email || '').trim();
  if (!name) return '⚠️ No name, so nobody was added to the member roll.';
  return withScriptLock(DESK_LOCK_WAIT_MS, () => {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = getOrCreateSheet(ss, SHEET_NAMES.MEMBER_ROLL);
      const headers = HEADERS.Member_Roll;
      const map = getIndexMap(headers);
      const rows = readSimpleTable(sheet, headers);
      const key = normalizeNameKey(name);
      const existing = rows.filter(row => normalizeNameKey(row[map['Name']]) === key)[0];
      let note;
      if (existing) {
        let added = [];
        if (phone && !String(existing[map['Phone']] || '').trim()) {
          existing[map['Phone']] = phone;
          added.push('phone');
        }
        if (email && !String(existing[map['Email']] || '').trim()) {
          existing[map['Email']] = email;
          added.push('email');
        }
        if (!added.length) return `👤 ${name} is already on the member roll.`;
        note = `👤 ${name} was already on the member roll — added their ${added.join(' and ')}.`;
      } else {
        const row = new Array(headers.length).fill('');
        row[map['Name']] = name;
        row[map['Phone']] = phone;
        row[map['Email']] = email;
        // Zero, not one: Times_Seen counts registrations on file, and this
        // person has none yet. The sign-in that follows is what gives them
        // their first, and the next refresh counts it.
        row[map['Times_Seen']] = 0;
        row[map['First_Seen']] = entry.date || '';
        row[map['Last_Seen']] = entry.date || '';
        row[map['Locations']] = String(entry.location || '').trim();
        row[map['Staff_Notes']] = `${WALK_IN_MEMBERSHIP_NOTE} (${formatDateLabel(entry.date || new Date())}` +
          `${entry.location ? `, ${String(entry.location).trim()}` : ''})`;
        rows.push(row);
        note = email
          ? `👤 ${name} added to the member roll — send the membership form to ${email}.`
          : `👤 ${name} added to the member roll.`;
      }
      rows.sort((a, b) => String(a[map['Name']] || '').localeCompare(String(b[map['Name']] || '')));
      writeMemoryTab(sheet, headers, rows, memberRollTabOptions());
      // The roll this execution memoized is now one name short of the truth.
      invalidateWalkInMembersMemo();
      return note;
    } catch (err) {
      log(`recordWalkInMember failed: ${err}`);
      return `⚠️ ${name} could not be added to the member roll (${err}) — tell the office.`;
    }
  }, '⚠️ The workbook is mid-update, so the member roll was not written to. Tell the office.');
}

/** The staff note a door sign-up leaves behind, and what staff search for. */
const WALK_IN_MEMBERSHIP_NOTE = '📨 Signed in at the door — membership form still to send';

/**
 * The page. Inline, like every other page and dialog in this file.
 *
 * `options` is { location, pinRequired, locations, rosterUrl, boot } — the
 * location pin from the query string, whether writes need a PIN, the buildings
 * this workbook has, where the session roster lives for the link at the foot
 * of the page, and the day the page opens on.
 *
 * THE DAY IS INLINED, AND IT IS ONLY EVER A STORED ONE. Every fact on it —
 * who has signed in already, who registered an hour ago, what the kitchen is
 * serving — is exactly the kind that must not be a snapshot at a door, so the
 * page still reads the day live. What changed is WHEN: the stored copy is what
 * the tablet draws on the first frame, and the live read happens behind it and
 * replaces it (section 16d). The page says which of the two it is showing.
 *
 * NEVER A BUILD. walkInBootSnapshot() is a cache read that answers null when
 * there is nothing stored, and null here means the page opens the way it
 * always did — asking for the day and saying so. doGet() is the one path with
 * a volunteer watching a blank tablet, and a page that reads two sectioned
 * tabs before it returns its first byte is the failure this replaces, not a
 * cheaper version of it.
 */
function buildWalkInHtml(options) {
  const opts = options || {};
  const boot = opts.boot === undefined ? walkInBootSnapshot() : opts.boot;
  // Stringified twice, for the reason buildCheckInHtml() gives: once to make
  // the data, once to make it a string literal that a location called
  // "St. Mary's </script>" cannot break out of.
  const inlineOptions = JSON.stringify(JSON.stringify({
    location: String(opts.location || ''),
    pinRequired: !!opts.pinRequired,
    locations: opts.locations || checkInLocations(),
    rosterUrl: String(opts.rosterUrl || ''),
    // The date the page is being served ON, so the tablet can refuse a
    // snapshot — inlined or its own — that belongs to another day. The page
    // has no clock it can trust for this: a tablet by a door is as likely as
    // not to be on the wrong timezone, or on no time at all.
    todayKey: formatDateKey(new Date()),
    boot: boot || null
  })).replace(/<\//g, '<\\/');

  return `
<style>
  /* Same sizing rule as the check-in page: every target is a thumb's worth,
     because this is used standing up by people who are not staff. */
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         font-size: 16px; color: #202124; margin: 0; background: #F8F9FA; }
  header { background: #1A73E8; color: #fff; padding: 14px 16px; position: sticky; top: 0; z-index: 5; }
  header h1 { margin: 0; font-size: 19px; font-weight: 600; }
  header .sub { font-size: 14px; opacity: .92; margin-top: 4px; }
  main { padding: 14px 16px 110px 16px; max-width: 760px; margin: 0 auto; }
  h2 { font-size: 17px; margin: 22px 0 8px 0; }
  h2:first-child { margin-top: 4px; }
  p.hint { color: #5F6368; font-size: 14px; line-height: 1.5; margin: 0 0 10px 0; }

  input[type=text], input[type=tel], input[type=email], select {
    width: 100%; padding: 13px; font-size: 16px; border: 1px solid #DADCE0;
    border-radius: 8px; background: #fff; }
  label.field { display: block; font-weight: 600; margin: 12px 0 5px 0; font-size: 14px; color: #5F6368; }

  /* THE NAME CARDS. Two or three to a row on a tablet, one on a phone —
     wide enough that a name is never cut in half, which is the only thing
     that makes picking one faster than typing it. */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  button.card { background: #fff; border: 1px solid #DADCE0; border-radius: 10px; padding: 14px 12px;
                font-size: 17px; text-align: left; cursor: pointer; min-height: 62px; color: #202124; }
  button.card .meta { display: block; font-size: 12px; color: #5F6368; margin-top: 3px; line-height: 1.35; }
  button.card.here { background: #E6F4EA; border-color: #B7DFC4; }
  button.card.here .meta { color: #188038; }

  ul.list { list-style: none; margin: 0; padding: 0; }
  li.item { background: #fff; border: 1px solid #E8EAED; border-radius: 10px; margin-bottom: 8px; }
  li.item label { display: flex; align-items: flex-start; gap: 12px; padding: 14px 12px; cursor: pointer; }
  li.item input[type=checkbox] { width: 26px; height: 26px; margin: 0; flex: 0 0 auto; }
  li.item .what { flex: 1; }
  li.item .title { font-size: 17px; }
  li.item .meta { display: block; font-size: 13px; color: #5F6368; margin-top: 3px; line-height: 1.4; }
  li.item.on { border-color: #B7DFC4; background: #F4FBF6; }
  li.item.off label { cursor: default; opacity: .72; }
  .tag { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .04em;
         border-radius: 999px; padding: 2px 8px; margin-right: 6px; vertical-align: 1px; }
  .tag.yes { background: #E6F4EA; color: #137333; }
  .tag.no { background: #FEF7E0; color: #B06000; }
  .tag.grey { background: #F1F3F4; color: #5F6368; }
  .warn { color: #B06000; }

  /* THE COMING-UP BOXES. Same size and same shape as the name cards above —
     a date on this page is a dropdown (one ordered choice), and the programs
     on that date are boxes, because that is the choice a thumb has to hit. */
  button.pick { background: #fff; border: 1px solid #DADCE0; border-radius: 10px;
                padding: 14px 12px; font-size: 17px; text-align: left; cursor: pointer;
                color: #202124; min-height: 62px; }
  button.pick .meta { display: block; font-size: 12px; color: #5F6368; margin-top: 3px;
                      line-height: 1.35; }
  button.pick.on { background: #E8F0FE; border-color: #1A73E8; font-weight: 600; }
  button.pick.on .meta { color: #1967D2; }

  button.big { width: 100%; background: #1A73E8; color: #fff; border: 0; border-radius: 10px;
               padding: 16px; font-size: 18px; font-weight: 600; cursor: pointer; margin-top: 16px; }
  button.big[disabled] { opacity: .5; }
  button.plain { background: #fff; border: 1px solid #DADCE0; color: #1A73E8; border-radius: 8px;
                 padding: 13px 14px; font-size: 15px; cursor: pointer; min-height: 48px; width: 100%;
                 margin-top: 8px; }
  .foot { margin-top: 26px; font-size: 13px; color: #5F6368; line-height: 1.6; }
  .foot a { color: #1A73E8; }

  #status { position: fixed; left: 0; right: 0; bottom: 0; padding: 13px 16px; background: #202124;
            color: #fff; font-size: 14px; line-height: 1.45; transform: translateY(120%);
            transition: transform .18s ease; }
  #status.show { transform: translateY(0); }
  #status.err { background: #C5221F; }
  #status.ok { background: #188038; }
  ul.result { list-style: none; margin: 12px 0 0 0; padding: 0; }
  ul.result li { background: #fff; border: 1px solid #E8EAED; border-radius: 8px; padding: 12px;
                 margin-bottom: 8px; font-size: 15px; line-height: 1.45; }
  .hide { display: none !important; }
</style>

<header>
  <h1 id="heading">Sign In</h1>
  <div class="sub" id="subheading"></div>
</header>

<div id="pinbox" class="hide" style="padding:24px 16px;max-width:360px;margin:0 auto;">
  <h2>Enter the desk PIN</h2>
  <input type="tel" id="pin" inputmode="numeric" autocomplete="off" placeholder="PIN">
  <button class="big" onclick="savePin()">Continue</button>
</div>

<main id="app" class="hide"></main>
<div id="status"></div>

<script>
  var OPTS = JSON.parse(${inlineOptions});
  var DAY = null;          // today, as readWalkInDay() sent it
  var PENDING = null;      // a background day held back until the screen is idle
  var STEP = 'who';        // who -> what -> done
  var PERSON = null;       // { name, key, isNew, phone, email }
  var PICKED = {};         // session value -> true
  var LUNCH = false;
  // THE LATER DATES. UPCOMING is this month and next at this building, read
  // once per visit (deskMonthSessions()); the rest is what the person has
  // picked off it — sessions to be REGISTERED for, and whether those are club
  // places on every future date rather than on the one date shown.
  var UPCOMING = null;     // [ { dateKey, dateLabel, monthLabel, sessions } ] once read
  var UPCOMING_ASKED = false;
  var UP_DAY = '';
  var UP_PICKED = {};
  var UP_CLUB = false;
  var RESULT = null;
  var busy = false;
  var pin = '';
  var location_ = OPTS.location || '';

  // ------------------------------------------------------------------- locals
  // WHAT THE PAGE KNOWS BEFORE IT ASKS ANYTHING. Two sources, both free:
  // the snapshot the server inlined (section 16d) and the last day this
  // particular tablet saw, kept in its own localStorage. Either one is drawn
  // on the first frame; neither is ever the last word, because syncDay() is
  // already running behind it.
  //
  // BOTH ARE GATED ON OPTS.todayKey — the date the SERVER is on. A tablet that
  // has been awake since Tuesday, or one whose clock is simply wrong, must not
  // open on a day that is not today: every program on it would be gone, every
  // sign-in already ticked, and every tap would record nothing.
  var DAY_CACHE_PREFIX = 'walkInDay:';

  function bootDay(loc) {
    if (!loc) return null;
    var boot = OPTS.boot;
    if (boot && boot.dateKey === OPTS.todayKey && boot.days && boot.days[loc]) {
      var day = boot.days[loc];
      // The roll is stored once for every building — see walkInBootSnapshot().
      if (day && !day.members) day.members = boot.members || [];
      if (day) { day.stale = true; day.storedAt = boot.builtAt || ''; }
      return day;
    }
    return localDay(loc);
  }

  function localDay(loc) {
    try {
      var raw = window.localStorage.getItem(DAY_CACHE_PREFIX + loc);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || saved.dateKey !== OPTS.todayKey || !saved.day) return null;
      saved.day.stale = true;
      saved.day.storedAt = saved.day.readAt || '';
      return saved.day;
    } catch (err) {
      return null;   // private browsing, a full quota, or a half-written entry
    }
  }

  function rememberDay(loc, day) {
    if (!loc || !day || day.dateKey !== OPTS.todayKey) return;
    try {
      window.localStorage.setItem(DAY_CACHE_PREFIX + loc,
        JSON.stringify({ dateKey: day.dateKey, day: day }));
    } catch (err) { /* a cache is an optimization; never let it stop a sign-in */ }
  }

  function start() {
    try { pin = window.localStorage.getItem('checkInPin') || ''; } catch (err) { pin = ''; }
    if (OPTS.pinRequired && !pin) return showPin();
    showApp();
  }

  function showPin() {
    document.getElementById('pinbox').classList.remove('hide');
    document.getElementById('app').classList.add('hide');
    document.getElementById('pin').focus();
  }

  function savePin() {
    pin = document.getElementById('pin').value.trim();
    try { window.localStorage.setItem('checkInPin', pin); } catch (err) { /* private browsing */ }
    showApp();
  }

  function showApp() {
    document.getElementById('pinbox').classList.add('hide');
    document.getElementById('app').classList.remove('hide');
    if (!location_) return draw();
    openDay();
  }

  /**
   * THE BOOT PATH, AND THE WHOLE OF WHY THIS PAGE NO LONGER WAITS.
   *
   * With something stored for this building we draw it immediately — no
   * spinner, no status line, nothing on screen that says "wait" — and the live
   * read runs behind the drawn page. With nothing stored (the first tablet
   * after a redeploy, a building the warmer has not reached) the page opens the
   * way it always did, saying so. Never both: a page that says "Reading..."
   * over a list it is already showing is a page a volunteer will not touch.
   */
  function openDay(then) {
    var known = bootDay(location_);
    if (!known) return loadDay(then);
    DAY = known;
    draw();
    syncDay(then);
  }

  function loadDay(then) {
    setBusy(true);
    say('Reading today\\'s list...', '');
    call('walkInDay', { location: location_ }, function (res) {
      setBusy(false);
      if (!res || !res.ok) { DAY = null; draw(); return handle(res); }
      DAY = res.day;
      rememberDay(location_, res.day);
      hideStatus();
      draw();
      if (then) then();
    });
  }

  /**
   * THE SAME READ, SILENTLY. No busy state, no status line, and no redraw
   * under somebody's finger.
   *
   * A failure here is not reported at all: the page has a list on it, the
   * volunteer did not ask for this, and an error banner over a working screen
   * is worse than being a few minutes out of date. The next sync — after the
   * next sign-in — tries again.
   */
  function syncDay(then) {
    call('walkInDay', { location: location_ }, function (res) {
      if (!res || !res.ok || !res.day) return;
      rememberDay(location_, res.day);
      // MID-FLOW, THE FRESH DAY WAITS. Somebody who has tapped their name is
      // looking at a screen of ticks; swapping the day out from under them
      // would redraw it, and a tick that moves while a thumb is on its way to
      // it is how the wrong thing gets recorded. It lands the moment the page
      // is back at the name list — see draw().
      if (STEP !== 'who' || PERSON) { PENDING = res.day; return; }
      DAY = res.day;
      draw();
      if (then) then();
    });
  }

  // --------------------------------------------------------------------- draw
  function draw() {
    // A background day held back while somebody was mid-sign-in lands here,
    // the first time the page is idle again — see syncDay().
    if (PENDING && STEP === 'who' && !PERSON) { DAY = PENDING; PENDING = null; }
    var main = document.getElementById('app');
    document.getElementById('subheading').textContent = DAY
      ? DAY.location + ' — ' + DAY.dateLabel
      : (location_ || 'Choose a location');
    main.innerHTML = '';
    if (!location_) return drawLocations(main);
    if (!DAY) return drawEmpty(main, 'Today\\'s list has not loaded yet.');
    if (STEP === 'done') return drawDone(main);
    if (STEP === 'what') return drawWhat(main);
    if (STEP === 'new') return drawNew(main);
    drawWho(main);
  }

  function drawEmpty(main, text) {
    var p = el('p', 'hint', text);
    main.appendChild(p);
    main.appendChild(button('plain', 'Try again', function () { loadDay(); }));
  }

  function drawLocations(main) {
    main.appendChild(el('h2', '', 'Where are you?'));
    (OPTS.locations || []).forEach(function (loc) {
      main.appendChild(button('plain', loc, function () { location_ = loc; openDay(); }));
    });
  }

  // STEP 1 — who is standing there.
  function drawWho(main) {
    main.appendChild(el('h2', '', 'Tap your name'));
    var expected = DAY.people || [];
    if (expected.length) {
      main.appendChild(el('p', 'hint',
        'Everybody signed up for something at ' + DAY.location + ' today.'));
      var grid = el('div', 'cards', '');
      expected.forEach(function (p) { grid.appendChild(personCard(p)); });
      main.appendChild(grid);
    } else {
      main.appendChild(el('p', 'hint',
        'Nobody is signed up for anything here today — search for your name below, ' +
        'or register as a new member.'));
    }

    main.appendChild(el('h2', '', 'Not on the list?'));
    var box = document.createElement('input');
    box.type = 'text';
    box.id = 'search';
    box.placeholder = 'Search for your name';
    box.autocomplete = 'off';
    box.oninput = drawSearchResults;
    main.appendChild(box);
    var results = el('div', 'cards', '');
    results.id = 'results';
    results.style.marginTop = '10px';
    main.appendChild(results);

    // A WORKBOOK THAT HAS NEVER SYNCED HAS NO MEMBER ROLL, and a search box
    // that silently finds nobody reads as a broken search rather than as an
    // empty directory. Say which it is, and say what fills it.
    if (!(DAY.members || []).length) {
      main.appendChild(el('p', 'hint',
        'The member directory is empty — run "Update Everything Now" in the workbook to build ' +
        'it. Anybody can still be registered as new below.'));
    }

    main.appendChild(button('plain', "I'm new here — register", function () {
      STEP = 'new';
      drawNew(document.getElementById('app'));
    }));
    main.appendChild(footer());
  }

  function drawSearchResults() {
    var needle = document.getElementById('search').value.trim().toLowerCase();
    var box = document.getElementById('results');
    box.innerHTML = '';
    if (needle.length < 2) return;
    var here = {};
    (DAY.people || []).forEach(function (p) { here[p.key] = true; });
    var hits = (DAY.members || []).filter(function (m) {
      return m.name.toLowerCase().indexOf(needle) !== -1;
    }).slice(0, 24);
    if (!hits.length) {
      box.appendChild(el('p', 'hint', 'No member matches "' +
        document.getElementById('search').value.trim() + '". Register as a new member below.'));
      return;
    }
    hits.forEach(function (m) {
      var person = null;
      (DAY.people || []).forEach(function (p) { if (p.key === m.key) person = p; });
      box.appendChild(person ? personCard(person) : personCard({ name: m.name, key: m.key,
        registered: [], attended: [], lunchRegistered: false, here: false }));
    });
  }

  function personCard(p) {
    var b = document.createElement('button');
    b.className = 'card' + (p.here ? ' here' : '');
    b.disabled = busy;
    var bits = [];
    if (p.here) bits.push('Already signed in');
    if ((p.registered || []).length) {
      bits.push((p.registered || []).map(titleOf).join(', '));
    }
    if (p.lunchRegistered) bits.push('lunch ordered');
    b.innerHTML = esc(p.name) + (bits.length ? '<span class="meta">' + esc(bits.join(' · ')) + '</span>' : '');
    b.onclick = function () { choose(p); };
    return b;
  }

  // STEP 1b — somebody the roll has never heard of.
  function drawNew(main) {
    main.innerHTML = '';
    main.appendChild(el('h2', '', 'Welcome — who are you?'));
    main.appendChild(el('p', 'hint',
      'Just a name and an email. The office will send you a membership form afterwards; ' +
      'you can sign in and join today\\'s programs now.'));
    main.appendChild(field('newname', 'Your name', 'text', ''));
    main.appendChild(field('newemail', 'Email (for the membership form)', 'email', ''));
    main.appendChild(field('newphone', 'Phone (optional)', 'tel', ''));
    main.appendChild(button('big', 'Continue', function () {
      var n = document.getElementById('newname').value.trim();
      var e = document.getElementById('newemail').value.trim();
      if (!n) return say('Type your name first.', 'err');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e)) {
        return say('An email address is needed so we can send you the membership form.', 'err');
      }
      hideStatus();
      choose({
        name: n, key: '', registered: [], attended: [], lunchRegistered: false, here: false,
        isNew: true, email: e, phone: document.getElementById('newphone').value.trim()
      });
    }));
    main.appendChild(button('plain', 'Back', function () { STEP = 'who'; draw(); }));
  }

  function choose(p) {
    PERSON = p;
    PICKED = {};
    // WHAT THEY ARE ALREADY DOWN FOR COMES PRE-TICKED. Somebody registered for
    // Chair Yoga is here for Chair Yoga; making them tick it again is asking a
    // question the workbook already knows the answer to.
    (p.registered || []).forEach(function (v) { PICKED[v] = true; });
    LUNCH = !!p.lunchRegistered;
    STEP = 'what';
    draw();
  }

  // STEP 2 — what they are here for.
  function drawWhat(main) {
    main.appendChild(el('h2', '', 'Hello, ' + PERSON.name));
    main.appendChild(el('p', 'hint', 'Tick everything you are here for today, then sign in.'));

    var list = el('ul', 'list', '');
    (DAY.programs || []).forEach(function (program) {
      list.appendChild(programItem(program));
    });
    if (!(DAY.programs || []).length) {
      list.appendChild(el('p', 'hint', 'No programs are on at ' + DAY.location + ' today.'));
    }
    main.appendChild(list);

    var lunchList = el('ul', 'list', '');
    lunchList.appendChild(lunchItem());
    main.appendChild(lunchList);

    drawUpcoming(main);

    var go = button('big', 'Sign in', submit);
    go.id = 'go';
    go.disabled = busy;
    main.appendChild(go);
    main.appendChild(button('plain', 'Not you? Pick another name', function () {
      PERSON = null; STEP = 'who'; UP_PICKED = {}; UP_CLUB = false; draw();
    }));
  }

  function programItem(program) {
    var registered = (PERSON.registered || []).indexOf(program.value) !== -1;
    var attended = (PERSON.attended || []).indexOf(program.value) !== -1;
    // An appointment nobody booked is not something a door can hand out —
    // see the section note. Shown, so it is plainly not missing; not tickable.
    var locked = !registered && program.byAppointment;
    var li = el('li', 'item' + (locked ? ' off' : (PICKED[program.value] ? ' on' : '')), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!PICKED[program.value] && !locked;
    box.disabled = locked || busy;
    box.onchange = function () {
      if (box.checked) PICKED[program.value] = true; else delete PICKED[program.value];
      li.className = 'item' + (box.checked ? ' on' : '');
    };
    var what = el('div', 'what', '');
    var tag = attended ? '<span class="tag yes">SIGNED IN</span>'
      : (registered ? '<span class="tag yes">REGISTERED</span>'
        : (locked ? '<span class="tag grey">BY APPOINTMENT</span>'
          : '<span class="tag no">NOT REGISTERED</span>'));
    var meta = [];
    if (program.time) meta.push(program.time);
    if (locked) meta.push('See a staff member to book a time.');
    else if (!registered) meta.push('Tick this and you will be added to the list today.');
    what.innerHTML = tag + '<span class="title">' + esc(program.title) + '</span>' +
      (meta.length ? '<span class="meta">' + esc(meta.join(' — ')) + '</span>' : '');
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
  }

  function lunchItem() {
    var lunch = DAY.lunch || {};
    var registered = !!PERSON.lunchRegistered;
    var offered = !!lunch.offered;
    var locked = !offered && !registered;
    var li = el('li', 'item' + (locked ? ' off' : (LUNCH ? ' on' : '')), '');
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = LUNCH && !locked;
    box.disabled = locked || busy;
    box.onchange = function () {
      LUNCH = box.checked;
      li.className = 'item' + (LUNCH ? ' on' : '');
    };
    var what = el('div', 'what', '');
    var title = 'Lunch' + (lunch.dish ? ' — ' + lunch.dish : '');
    var tag = registered ? '<span class="tag yes">ORDERED FOR YOU</span>'
      : (locked ? '<span class="tag grey">NOT TODAY</span>'
        : '<span class="tag no">NOT REGISTERED</span>');
    var meta = [];
    if (lunch.type && lunch.type !== 'Not Serving') meta.push(lunch.type);
    if (registered) {
      meta.push('Your meal is ordered. Ticking this records it as handed to you — ' +
        'leave it unticked if you are not taking it today.');
    } else if (locked) {
      meta.push(lunch.ruledOut
        ? 'No lunch is served here today.'
        : 'Today\\'s menu has not been set. Ask a staff member.');
    } else {
      // THE SENTENCE THIS WHOLE SECTION EXISTS FOR. Meals are ordered days
      // ahead against a count, so a tick here is a request for one that may
      // not exist — recorded, and never promised.
      meta.push('You are not signed up for lunch. Tick this to be added to the list and ' +
        'recorded as taking a meal, then check with a staff member that one is available.');
    }
    what.innerHTML = tag + '<span class="title">' + esc(title) + '</span>' +
      '<span class="meta' + (registered || locked ? '' : ' warn') + '">' +
      esc(meta.join(' — ')) + '</span>';
    label.appendChild(box);
    label.appendChild(what);
    li.appendChild(label);
    return li;
  }

  // --------------------------------------------------------------------------
  // COMING UP — the same door, asked about a date that is not today
  // --------------------------------------------------------------------------
  //
  // The question a front desk is asked after "am I signed in" is "what have
  // you got next month, and can I put my name down now". Until this section
  // the answer from the tablet was to go and find a member of staff.
  //
  // IT IS A REGISTRATION, NOT A SIGN-IN. Nothing here marks anybody present —
  // see walkInSignIn(), which writes these as places on a list. The club
  // toggle underneath is the same club place the desk's register screen
  // offers: every future date of the programs picked, rather than the one
  // date on the box.
  //
  // IT IS ALSO THE ONE THING ON THIS PAGE THAT IS NOT FREE. Today's list is
  // inlined into the page; two months of dates is a live read, so it is asked
  // for once, the first time somebody reaches this screen, and the page is
  // perfectly usable while it is in flight.
  function drawUpcoming(main) {
    main.appendChild(el('h2', '', 'Coming up at ' + (DAY ? DAY.location : location_)));
    if (!UPCOMING) {
      main.appendChild(el('p', 'hint', 'Reading the coming dates...'));
      loadUpcoming();
      return;
    }
    if (!UPCOMING.length) {
      main.appendChild(el('p', 'hint',
        'Nothing else is on the calendar here this month or next.'));
      return;
    }
    main.appendChild(el('p', 'hint',
      'Signing up for a later date? Pick a day, then tap what you want a place on. ' +
      'These are bookings — you are not being marked as here for them.'));

    var label = el('label', 'field', 'Day');
    label.setAttribute('for', 'up-day');
    main.appendChild(label);
    var sel = document.createElement('select');
    sel.id = 'up-day';
    UPCOMING.forEach(function (day) {
      var o = document.createElement('option');
      o.value = day.dateKey;
      o.textContent = day.monthLabel + '  —  ' + day.dateLabel + '  (' + day.sessions.length +
        (day.sessions.length === 1 ? ' program)' : ' programs)');
      sel.appendChild(o);
    });
    if (!upDay()) UP_DAY = UPCOMING[0].dateKey;
    sel.value = UP_DAY;
    sel.onchange = function () { UP_DAY = sel.value; draw(); };
    main.appendChild(sel);

    var boxes = el('div', 'cards', '');
    (upDay() || { sessions: [] }).sessions.forEach(function (session) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (UP_PICKED[session.value] ? ' on' : '');
      // An appointment is a chair at a time and picking one is a conversation
      // — the same rule today's list follows. Shown so it is plainly not
      // missing, and handed to staff.
      var meta = session.byAppointment
        ? 'By appointment — see a staff member to book a time.'
        : (UP_PICKED[session.value] ? 'You will be put on the list for this date.' : '');
      b.innerHTML = '<span>' + esc(session.title) + '</span>' +
        (meta ? '<span class="meta">' + esc(meta) + '</span>' : '');
      b.disabled = !!session.byAppointment || busy;
      b.onclick = function () {
        if (UP_PICKED[session.value]) delete UP_PICKED[session.value];
        else UP_PICKED[session.value] = true;
        draw();
      };
      boxes.appendChild(b);
    });
    main.appendChild(boxes);

    // THE CLUB TICK, and it only appears once something is picked: a question
    // about "every future date" of nothing at all is a question nobody can
    // answer.
    if (!Object.keys(UP_PICKED).length) return;
    var list = el('ul', 'list', '');
    var li = el('li', 'item' + (UP_CLUB ? ' on' : ''), '');
    var lab = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = UP_CLUB;
    box.disabled = busy;
    box.onchange = function () { UP_CLUB = box.checked; draw(); };
    var what = el('div', 'what', '');
    what.innerHTML = '<span class="tag grey">CLUB</span>' +
      '<span class="title">Every future date, not just this one</span>' +
      '<span class="meta">Keeps you on the list for every future date of the programs you ' +
      'picked, so you never have to sign up for them again. Lunch is not included — ask at ' +
      'the desk for that.</span>';
    lab.appendChild(box);
    lab.appendChild(what);
    li.appendChild(lab);
    list.appendChild(li);
    main.appendChild(list);
  }

  function upDay() {
    for (var i = 0; i < (UPCOMING || []).length; i++) {
      if (UPCOMING[i].dateKey === UP_DAY) return UPCOMING[i];
    }
    return null;
  }

  function loadUpcoming() {
    if (UPCOMING_ASKED || !location_) return;
    UPCOMING_ASKED = true;
    call('deskMonthSessions', { location: location_ }, function (res) {
      if (!res || !res.ok) {
        // Quietly: today's sign-in is what the person is standing there for,
        // and it is unaffected. An empty list says the same thing to them as
        // an error would, without a red bar over the button they came to press.
        UPCOMING = [];
        if (STEP === 'what') draw();
        return;
      }
      UPCOMING = res.days || [];
      if (STEP === 'what') draw();
    });
  }

  function submit() {
    var programs = Object.keys(PICKED);
    var later = Object.keys(UP_PICKED);
    if (!programs.length && !LUNCH && !later.length) {
      return say('Tick what you are here for first.', 'err');
    }
    setBusy(true);
    draw();
    say('Signing you in...', '');
    call('walkInSignIn', {
      location: location_,
      name: PERSON.name,
      phone: PERSON.phone || '',
      email: PERSON.email || '',
      newMember: !!PERSON.isNew,
      programs: programs,
      lunch: !!LUNCH,
      upcoming: later,
      upcomingStanding: !!UP_CLUB
    }, function (res) {
      setBusy(false);
      if (!res) { draw(); return handle(res); }
      RESULT = res;
      STEP = 'done';
      draw();
      say(res.message, res.ok ? 'ok' : 'err');
      // The list is re-read rather than patched: the next person in the queue
      // has to see this one as signed in, and the sheet is the truth. Quietly,
      // though — the volunteer is reading the receipt this call would otherwise
      // paper over, and the re-read lands when they tap "next person".
      syncDay();
    });
  }

  function drawDone(main) {
    main.appendChild(el('h2', '', (RESULT && RESULT.ok ? '✅ ' : '⚠️ ') +
      ((RESULT && RESULT.name) || '')));
    main.appendChild(el('p', 'hint', (RESULT && RESULT.message) || ''));
    var list = el('ul', 'result', '');
    ((RESULT && RESULT.lines) || []).forEach(function (line) {
      list.appendChild(el('li', '', line));
    });
    main.appendChild(list);
    var next = button('big', 'Done — next person', function () {
      PERSON = null; RESULT = null; PICKED = {}; LUNCH = false; STEP = 'who';
      UP_PICKED = {}; UP_CLUB = false;
      hideStatus();
      draw();
    });
    main.appendChild(next);
  }

  function footer() {
    var d = el('div', 'foot', '');
    // WHICH LIST IS ON SCREEN, in words. A stored list is a few minutes old
    // and about to be replaced, and a footer that claims it was read just now
    // is the one thing that would make that dishonest.
    var when = '';
    if (DAY && DAY.stale) {
      when = 'Showing the list stored at ' + (DAY.storedAt || DAY.readAt || 'today') +
        ' — refreshing it now. ';
    } else if (DAY && DAY.readAt) {
      when = 'Read at ' + DAY.readAt + '. ';
    }
    d.innerHTML = esc(when) + 'Staff: ' +
      (OPTS.rosterUrl
        ? '<a href="' + esc(OPTS.rosterUrl) + '" target="_top">open the session check-in list</a>'
        : 'the session check-in list is at ?mode=session') +
      ' to mark meals as they are handed over.';
    return d;
  }

  // ------------------------------------------------------------------ plumbing
  function titleOf(value) {
    var idx = value.lastIndexOf(' · ');
    return idx > 0 ? value.substring(0, idx) : value;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function button(cls, text, onclick) {
    var b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.disabled = busy;
    b.onclick = onclick;
    return b;
  }

  function field(id, label, type, value) {
    var wrap = document.createElement('div');
    var l = el('label', 'field', label);
    l.setAttribute('for', id);
    var i = document.createElement('input');
    i.type = type; i.id = id; i.value = value || ''; i.autocomplete = 'off';
    wrap.appendChild(l);
    wrap.appendChild(i);
    return wrap;
  }

  function call(fn, payload, done) {
    payload.pin = pin;
    google.script.run
      .withSuccessHandler(done)
      .withFailureHandler(function (err) {
        setBusy(false);
        draw();
        say(err && err.message ? err.message : String(err), 'err');
      })[fn](JSON.stringify(payload));
  }

  function handle(res) {
    if (res && res.needsPin) {
      try { window.localStorage.removeItem('checkInPin'); } catch (err) { /* ignore */ }
      pin = '';
      say(res.message || 'Wrong PIN.', 'err');
      return showPin();
    }
    say((res && res.message) || 'Something went wrong - nothing was recorded.', 'err');
  }

  function setBusy(v) { busy = v; }

  var hideTimer = null;
  function say(msg, cls) {
    var el2 = document.getElementById('status');
    el2.textContent = msg;
    el2.className = 'show ' + (cls || '');
    if (hideTimer) window.clearTimeout(hideTimer);
    if (cls === 'ok') hideTimer = window.setTimeout(hideStatus, 4000);
  }

  function hideStatus() { document.getElementById('status').className = ''; }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  start();
</script>`;
}

