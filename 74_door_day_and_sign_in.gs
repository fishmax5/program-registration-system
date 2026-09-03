// ============================================================================
// 16h. THE DOOR'S DAY, AND ITS ONE WRITE  (read the day; sign somebody in)
// ============================================================================
//
// These are the server functions the retired walk-in page (section 16b) was
// built around, and they outlived it: the door app (sections 16f/16g) reads
// its day through readWalkInDay() and writes every sign-in through
// walkInSignIn(), and the boot store (section 16d) builds its snapshot out of
// the same read. So when the page went, its server half moved here rather than
// out — a page is a way of asking, and this is what was being asked.
//
// WHAT IS IN HERE:
//
//   THE DAY      readWalkInDay() — today (or a chosen date) at ONE building:
//                the programs on, who is expected and what each of them is
//                already down for, whether there is a meal, and the member
//                roll for the search box. walkInDay() is the payload-parsing,
//                PIN-gated endpoint around it; doorDay() (section 16f) is the
//                date-aware one the app actually calls.
//   THE ROLL     readWalkInMembers() and its per-execution memo — names only,
//                because a tablet by a front door is the last place to put a
//                directory of everybody's phone number.
//   THE WRITE    walkInSignIn() — the one place a door sign-in becomes rows,
//                every mark through applyQuickMarkFromDialog(), and
//                recordWalkInMember() for somebody the roll has never heard
//                of. doorSignIn() (section 16f) is its name at the app.
//
// NUMBERED LAST for the reason every file after 64 is: it is behavior only,
// its own two constants stand alone, and everything it calls is a hoisted
// function. Nothing earlier reads it at load time, and its schema
// (SHEET_NAMES, HEADERS.Member_Roll) lives in section 03 like every other.
// ============================================================================

/**
 * How many Member_Roll names travel inside the page for its search box.
 *
 * The roll is names and nothing else here — no phone, no email — because the
 * page only needs to FIND a person, and a directory of contact details is not
 * something to hand to a tablet that lives on a table by the door.
 */
const WALK_IN_MAX_MEMBERS = 4000;

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
 * TODAY ONLY, AND NOT THE CALL THE APP MAKES. This is the endpoint the retired
 * walk-in page (section 16b) asked in the background, kept because it is a
 * published name a served page could still be holding; the door app calls
 * doorDay() (section 16f), which is the same read with a date on it. Two
 * things it does that a bare read does not, and that doorDay() copies:
 *
 *   - The fresh day is folded back into the boot store on the way out
 *     (rememberWalkInDay()). The read is already paid for; giving it to the
 *     next tablet to boot costs one cache write on a call nobody is waiting on.
 *   - A desk blocked by a forms sweep answers with the STORED day rather than
 *     a refusal. A tablet with that day on screen already would be having the
 *     door's list taken away over something the door does not care about.
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
