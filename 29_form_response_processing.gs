// ============================================================================
// 5d. READING ONE FORM RESPONSE INTO REGISTRANT ROWS  (processFormResponse)
// ============================================================================

function processFormResponse(formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays, collectors) {
  const form = formIndex.form;
  const name = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.NAME) || 'Unknown').trim();
  const phone = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.PHONE) || '').trim();
  const email = getRespondentEmail(response);
  const adminNotes = getAdminNotesResponse(formIndex, response);
  // Points at this specific submission (requires setAllowResponseEdits(true)
  // on the template — see getOrCreateTemplateForm()), not the shared form editor.
  const responseEditUrl = response.getEditResponseUrl();
  const submittedAt = response.getTimestamp();
  const partyId = response.getId();

  const people = resolvePeopleOnResponse(formIndex, response, name, adminNotes);
  const partySize = people.length;
  // Every extra question this program asked, in one string. Collected here so
  // both paths below carry it, and kept OUT of Admin_Notes so a staff note and
  // a form answer never turn into each other.
  const customAnswers = getCustomAnswersResponse(formIndex, response);
  // HOW MANY MEALS, not who eats — see TEMPLATE_VERSION's v9 note. Read once
  // here for the all-dates branch (the per-date branch reads its own grid) and
  // attributed to the PERSON FILLING THE FORM IN: the meals are a single order
  // that somebody collects, so they belong on one row rather than being shared
  // out over a party this form never asked us to divide them among.
  //
  // Null means the form never asked, which is not the same as zero: a form
  // with nothing to serve, or an appointment form, whose respondents are not
  // saying "no lunch" so much as never having been offered one. Both end up as
  // No Lunch; the distinction matters only to readMealCountResponse(), which
  // uses it to decide whether to look at a pre-v9 response's answers instead.
  const mealCount = readMealCountResponse(formIndex, response, people);

  // AN APPOINTMENT FORM IS RECOGNIZED BY ITS OWN SHAPE, not by a flag passed
  // in: a form carrying the time question is one, and nothing else is. That
  // means a response submitted while the tag was on is still read correctly
  // after it comes off (the question is still there until the form is
  // rebuilt), and a mis-set checkbox can never make the parser look for a grid
  // that isn't there. See ASSISTANCE_TAG.
  if ((formIndex.byTitle[TEMPLATE_ITEM_TITLES.APPOINTMENT] || []).length > 0) {
    return processAppointmentResponse({
      formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
      people, adminNotes, responseEditUrl, submittedAt, partyId, partySize, phone, email,
      customAnswers, collectors
    });
  }

  const attendanceMode = getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE);
  const joiningClub = isClubModeAnswer(attendanceMode);
  // A FORM COVERING ONE SESSION NEVER ASKED — see section 1g. It is recognized
  // by its own shape, exactly as the appointment form above it is: no mode
  // question on the form, and no mode answer on the response, so there was
  // nothing to choose and "every date on this form" is the one date it covers.
  //
  // BOTH halves are required, and the response's half is what makes this safe
  // on an old submission: a response collected while the form still asked
  // carries its answer, and that answer is honoured even after the question
  // has come off. Only a response that never met the question falls through to
  // here — which is the only kind a one-date form produces.
  const neverAsked = !attendanceMode &&
    (formIndex.byTitle[TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE] || []).length === 0;
  if (joiningClub || isAllDatesModeAnswer(attendanceMode) || neverAsked) {
    return processAllDatesResponse({
      formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
      name, people, adminNotes, responseEditUrl, submittedAt, partyId, partySize,
      phone, email, joiningClub, collectors, customAnswers, mealCount
    });
  }

  // Specific-dates path. Two grids: ATTENDANCE_GRID's rows are every date on
  // the form and its columns are the people; MEAL_COUNT_GRID's rows are only
  // the lunch-eligible ("not Not-Serving") subset — see buildDateLabelSets() —
  // and its answer on a row is one number, the meals that party wants that day.
  //
  // A LUNCH-ONLY FORM HAS ONE GRID, the meal grid under its own title (see
  // makeFormLunchOnly()), and no attendance grid at all — because on that form
  // a meal IS the registration. A pre-v9 lunch-only form is the other way
  // around: one checkbox grid of people under LEGACY_LUNCH_ONLY_GRID_TITLE,
  // which is why that title is an attendance grid here.
  const attendanceGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID) ||
    getGridResponseByTitle(formIndex, response, LEGACY_LUNCH_ONLY_GRID_TITLE);
  const mealGrid = readMealCountGridResponse(formIndex, response, people);
  if (!attendanceGrid && !mealGrid) return [];

  const rows = [];
  const formId = form.getId();
  // The dates to walk: every date the respondent was shown. On a v9 lunch-only
  // form the meal grid is the only grid there is, so it is also the date list.
  const dateRows = attendanceGrid ? attendanceGrid.rows : mealGrid.rows;
  dateRows.forEach((dateLabel, rowIdx) => {
    // Resolved against the registry rather than cut at the first " — ", so a
    // program whose NAME contains that separator still finds its session
    // instead of losing the whole submission — see sessionLabelCandidates().
    const plainDateLabel = resolveSessionLabelForForm(registryIndex, formId, dateLabel);
    const registryEntry = plainDateLabel ? registryIndex[`${formId}|${plainDateLabel}`] : null;
    if (!registryEntry) {
      const message = `No All_Program_Sessions match for form ${formId} / "${stripMealHint(dateLabel)}"` +
        ` (grid row "${dateLabel}") — anyone who ticked that row has NOT been imported.`;
      log(`⚠️ ${message}`);
      noteForAdmin('Form row matches no session', message);
      return;
    }

    const attendingCols = attendanceGrid ? (attendanceGrid.values[rowIdx] || []) : [];
    // The two grids do not carry the same rows — the meal grid holds only the
    // catered dates — so the meal row is found by the label it resolves to,
    // never by position. Unless there is no attendance grid, in which case the
    // meal grid is the one being walked and the index is already its own.
    const mealRowIdx = !mealGrid ? -1
      : (attendanceGrid
        ? mealGrid.rows.findIndex(r => resolveSessionLabelForForm(registryIndex, formId, r) === plainDateLabel)
        : rowIdx);
    const mealsThisDate = (mealGrid && mealRowIdx >= 0) ? mealGrid.countForRow(mealRowIdx) : 0;

    people.forEach(person => {
      const isRegistrant = person.personType === 'Attendee';
      // WHO IS COMING is still a per-person question — except on a lunch-only
      // form, where there is no attendance grid and a meal ordered is the
      // whole of the registration.
      const attendingHere = attendanceGrid
        ? attendingCols.indexOf(person.columnLabel) !== -1
        : mealsThisDate > 0;
      // EVERY MEAL ON THIS SUBMISSION GOES ON THE REGISTRANT'S ROW. The form
      // asks for a total, not for who eats, so there is no honest way to say
      // which guest a given meal is for — and inventing one would put a meal
      // against a name that never asked for it. The roster still lists the
      // guests; the order still says four. See Meals_Ordered on All_Registrants.
      const meals = isRegistrant ? mealsThisDate : 0;
      const wantsLunch = meals > 0;
      if (!attendingHere && !wantsLunch) return; // nothing said about this person on this date

      let notes = person.baseNotes || '';
      // Meals ordered on a date the registrant did not tick. Reconcile rather
      // than silently drop — a meal asked for implies somebody there to eat it
      // — but say so, since it is the one combination the form allows that the
      // respondent may not have meant.
      if (!attendingHere && wantsLunch && attendanceGrid) {
        const flag = `⚠️ Ordered ${meals} meal(s) for ${plainDateLabel} without ticking that date — reconciled as attending.`;
        notes = notes ? `${notes} | ${flag}` : flag;
        log(`Reconciliation: ${person.name} ordered meals for ${plainDateLabel} without ticking "${TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID}" on form ${form.getId()} — treating as attending.`);
      }

      rows.push(buildRegistrantRow({
        registryEntry, name: person.name, personType: person.personType,
        lunchType: wantsLunch ? 'Yes - Lunch' : 'No Lunch', primaryRegistrant: person.primaryRegistrant,
        adminNotes: notes, formEditUrl: responseEditUrl, protectedKeys, existingRowIndex, submittedAt, orderAheadDays,
        partyId, partySize,
        mealsOrdered: meals,
        formAnswers: isRegistrant ? customAnswers : '',
        // A response being read as it arrives — the one path allowed to lift a
        // deletion tombstone. See buildRegistrantRow() and section 5c.
        fromLiveSubmission: true,
        // Contact details belong to the SUBMISSION, so a named guest carries
        // the same ones — they arrived together, and the printed sign-in sheet
        // and any calendar invite need a way to reach each row's party.
        phone, email
      }));
    });
  });

  return rows.filter(Boolean);
}

/**
 * Handles a Grouped-series form submitted via "Sign up for all dates": one
 * lunch choice per person is applied to EVERY current session date on the
 * form (matchingEntries), and each person is recorded in the persistent
 * ALL_DATES registry so future syncRegistrations() runs can retroactively
 * add rows for any dates added to the series afterward (see
 * applyAllDatesCatchup()).
 */
function processAllDatesResponse(args) {
  const {
    formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
    people, adminNotes, responseEditUrl, submittedAt, partyId, partySize,
    phone, email, joiningClub, collectors, customAnswers, mealCount
  } = args;

  const formId = formIndex.formId;
  const matchingEntries = Object.keys(registryIndex).filter(k => k.startsWith(`${formId}|`)).map(k => registryIndex[k]);

  // Which club(s) this form's sessions belong to, if any — a combined form can
  // legitimately carry more than one, so enrollment follows the SESSION rather
  // than the form. Only reached when the respondent chose the club option.
  const clubsOnForm = {};
  if (joiningClub) {
    matchingEntries.forEach(entry => {
      if (!entry.isClub || !entry.clubKey) return;
      if (!clubsOnForm[entry.clubKey]) {
        clubsOnForm[entry.clubKey] = { clubKey: entry.clubKey, title: entry.cleanTitle, location: entry.location };
      }
    });
  }

  // THE MONTH-OF-LUNCHES PATH. On a lunch-only form every session on it is a
  // meal and nothing else, so a submission that answers the meal question with
  // nothing at all has asked for nothing — which is never what somebody
  // filling in a lunch form meant. Left as-is it produced a party of rows all
  // reading "No Lunch", i.e. a registration for an event that does not exist.
  // So on this form alone, an unanswered question means one meal each, which
  // is both the obvious reading and the one a person can correct at the desk;
  // the opposite mistake is a meal nobody ordered.
  //
  // AN EXPLICIT ZERO IS STILL ZERO — mealCount is null only when the question
  // was never answered, and somebody who picked "0 — no lunch" has told us
  // something and is entitled to be believed.
  const lunchOnlyForm = matchingEntries.length > 0 &&
    matchingEntries.every(entry => isLunchOnlyEventId(entry.eventId));
  const meals = (mealCount === null || mealCount === undefined)
    ? (lunchOnlyForm ? Math.min(people.length, MAX_MEALS_PER_SUBMISSION) : 0)
    : mealCount;

  const rows = [];
  people.forEach(person => {
    // EVERY MEAL ON THE REGISTRANT'S ROW — see the specific-dates path for the
    // whole of the reason. A guest is on the roster; the order is one number,
    // and it belongs to whoever collects it.
    const personMeals = person.personType === 'Attendee' ? meals : 0;
    const lunchType = personMeals > 0 ? 'Yes - Lunch' : 'No Lunch';
    saveAllDatesRegistryEntry(formId, {
      name: person.name, personType: person.personType, lunchType,
      primaryRegistrant: person.primaryRegistrant, adminNotes: person.baseNotes || '',
      formEditUrl: responseEditUrl, submittedAt: submittedAt.toISOString(), partyId, partySize,
      phone: phone || '', email: email || '',
      // Stored with the registration so applyAllDatesCatchup() re-derives the
      // same order on a date added months later.
      //
      // BOTH FIELDS, and the new one is the one that is read: `mealsOrdered`
      // is the v9 total, `extraMeals` the pre-v9 number of EXTRAS that an
      // entry written before this change carries. Neither is re-interpreted as
      // the other — an old entry's 0 extras means one meal, a new entry's 0
      // meals means none — so the catch-up reads mealsOrdered where it is
      // present and falls back to 1 + extras where it is not.
      mealsOrdered: personMeals
    });

    // The club half. Recorded per person, not per submission: a party of three
    // joining a club is three memberships, each of which staff can end on its
    // own (the guest who stops coming, the member who doesn't).
    Object.keys(clubsOnForm).forEach(clubKey => {
      const club = clubsOnForm[clubKey];
      (collectors && collectors.clubJoins ? collectors.clubJoins : []).push({
        clubKey,
        club: club.title,
        location: club.location,
        name: person.name,
        personType: person.personType,
        primaryRegistrant: person.primaryRegistrant,
        phone: phone || '',
        email: email || '',
        lunchType,
        source: 'Registration form'
      });
    });

    matchingEntries.forEach(registryEntry => {
      rows.push(buildRegistrantRow({
        registryEntry, name: person.name, personType: person.personType, lunchType,
        primaryRegistrant: person.primaryRegistrant, adminNotes: person.baseNotes || '', formEditUrl: responseEditUrl,
        protectedKeys, existingRowIndex, submittedAt, orderAheadDays, partyId, partySize,
        fromLiveSubmission: true,
        mealsOrdered: personMeals,
        formAnswers: person.personType === 'Attendee' ? (customAnswers || '') : '',
        phone, email
      }));
    });
  });
  return rows.filter(Boolean);
}

/**
 * The respondent's own email address, which Forms collects because the
 * template sets setCollectEmail(true). Wrapped because getRespondentEmail()
 * returns '' rather than throwing on a form where collection is off, and
 * because a malformed address is worth dropping here rather than at the point
 * where it becomes a calendar invitation.
 */
function getRespondentEmail(response) {
  let raw = '';
  try {
    raw = String(response.getRespondentEmail() || '').trim();
  } catch (err) {
    return '';
  }
  return isPlausibleEmail(raw) ? raw : '';
}

/** A minimal sanity check — enough to keep obvious junk out of a guest list. */
function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/**
 * Runs every registration sync: for every form with "all dates" registrants
 * on file, checks whether any of the form's CURRENT session dates are
 * missing a row for that person, and fills them in — this is what makes
 * "all dates" keep meaning "every date," including ones added to an
 * ongoing Grouped series after the original registration.
 */
function applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows) {
  const registry = getAllDatesRegistry();
  Object.keys(registry).forEach(formId => {
    const matchingEntries = Object.keys(registryIndex).filter(k => k.startsWith(`${formId}|`)).map(k => registryIndex[k]);
    if (matchingEntries.length === 0) return;
    registry[formId].forEach(entry => {
      matchingEntries.forEach(registryEntry => {
        const row = buildRegistrantRow({
          registryEntry, name: entry.name, personType: entry.personType, lunchType: entry.lunchType,
          primaryRegistrant: entry.primaryRegistrant, adminNotes: entry.adminNotes || '',
          formEditUrl: entry.formEditUrl, protectedKeys, existingRowIndex,
          submittedAt: new Date(entry.submittedAt), orderAheadDays,
          partyId: entry.partyId || '', partySize: entry.partySize || '',
          // The v9 total where the entry has one; the pre-v9 "one each plus
          // extras" where it does not. See saveAllDatesRegistryEntry() above.
          mealsOrdered: entry.mealsOrdered === undefined || entry.mealsOrdered === null
            ? 1 + (Number(entry.extraMeals) || 0)
            : (Number(entry.mealsOrdered) || 0),
          phone: entry.phone || '', email: entry.email || ''
        });
        if (row) newRows.push(row);
      });
    });
  });
}

/**
 * Marks an existing registrant row as no longer current, WITHOUT deleting
 * it — so staff can see a change actually happened rather than the row
 * just vanishing. Applied when a genuinely different submission (a
 * different Party_ID) shows up for the same Event_ID+Name+Person_Type.
 */
function supersedeRegistrantRow(row, map, supersededAt) {
  if (row[map['Program_Status']] === 'Superseded') return; // already marked by an earlier resubmission this pass
  row[map['Program_Status']] = 'Superseded';
  row[map['Lunch_Status']] = 'Superseded';
  const note = `Superseded by a newer submission on ${Utilities.formatDate(supersededAt, TIMEZONE, 'M/d/yyyy h:mm a')}.`;
  const existingNotes = String(row[map['Admin_Notes']] || '').trim();
  row[map['Admin_Notes']] = existingNotes ? `${existingNotes} | ${note}` : note;
}

/**
 * Resolves what actually gets STORED in a registrant row's Lunch_Type
 * column: the day's real Hot/Cold designation (from Lunch_Schedule, via
 * registryEntry's own date+location) for anyone who wants lunch, 'No Lunch'
 * for anyone who doesn't. Never returns the raw form answer verbatim — a
 * person's lunch type is Hot or Cold, matching Lunch_Schedule's own
 * vocabulary, not a restatement of whether they said yes.
 *
 * Resolved ONCE at row-creation/patch time and never revisited — like
 * Order_Ahead_Flag, it's a fact about what Lunch_Schedule said when this
 * row was written, not something that should drift if the menu changes
 * later. If no Hot/Cold row exists yet for that date, this returns '' —
 * still correctly counted as Needed (see lunchStatus below, which is
 * derived from wantsLunch directly, never from this string) and already
 * surfaced separately by buildDashboardRollup()'s "no menu set" admin note.
 */
function resolveRegistrantLunchType(wantsLunch, registryEntry) {
  if (!wantsLunch) return 'No Lunch';
  const meal = getMealInfoForDate(registryEntry.eventDate, registryEntry.location);
  return (meal && (meal.type === 'Hot' || meal.type === 'Cold')) ? meal.type : '';
}

function buildRegistrantRow(args) {
  const {
    registryEntry, name, personType, lunchType, primaryRegistrant, adminNotes, formEditUrl,
    protectedKeys, existingRowIndex, submittedAt, orderAheadDays, partyId, partySize
  } = args;
  const phone = String(args.phone || '').trim();
  const email = String(args.email || '').trim();
  // Rows that did not come from a form submission (a club booking, say) have
  // no per-response edit link, and "=HYPERLINK("", ...)" is a broken link
  // dressed up as a working one — so they name their origin in plain text.
  const formSource = formEditUrl
    ? makeHyperlinkFormula(formEditUrl, 'View Submission')
    : String(args.formSourceText || '');
  // THE SPELLING THIS WORKBOOK HAS SETTLED ON, not necessarily the one on the
  // form. A member whose name staff corrected on Member_Roll goes on typing
  // the old one into the same form for months (they have it saved in their
  // browser, or a relative fills it in for them); without this the correction
  // is undone by every new response and the roll grows the old row back.
  // See applyMemberNameCorrection() in 77_households_and_names.gs.
  const displayName = canonicalMemberName(name);
  const key = `${registryEntry.eventId}|${normalizeNameKey(displayName)}|${personType}`;
  // The caller's lunchType is just an intent signal ('No Lunch' vs
  // anything else) — resolveRegistrantLunchType() is what turns that into
  // an actual Hot/Cold value. Deriving lunchStatus from this boolean rather
  // than from the resolved string means an unresolved Hot/Cold (no menu
  // configured yet) never downgrades a real "Needed" registrant.
  //
  // Gated on what makes lunch IMPOSSIBLE, not on what makes it scheduled.
  // The gate exists for the "everyone, every date" branch, which asks the
  // lunch question ONCE for the whole form: without it one checkbox would book
  // a meal on every Not-Serving date the form covers. That is a decision
  // somebody made, and it rightly wins.
  //
  // It used to be isLunchOfferedOn(), which ALSO answers false for a date that
  // simply has no Lunch_Schedule row yet — and at a "By exception" location
  // that is every date until the month's menu is typed. An all-dates
  // registrant who ticked lunch before the menu existed was written No Lunch,
  // vanished from Master_Lunch_Dashboard and All_Lunch_Registrants, and stayed gone:
  // typing the menu afterwards changes nothing a row already says.
  //
  // A missing menu row is a GAP, and demand over a gap is exactly what
  // buildDashboardRollup() means by "demand always wins" — it raises "lunch
  // needed with no menu set" for precisely this case. So the gap keeps the
  // demand, and the catch-up pass repairs the rows already written, since it
  // re-derives every all-dates registrant through here on every sync.
  const intendsLunch = !!lunchType && lunchType !== 'No Lunch';
  const wantsLunch = intendsLunch && !lunchIsRuledOutOn(registryEntry.eventDate, registryEntry.location);

  if (protectedKeys.has(key)) {
    return null; // never overwrite a manually-edited/added row, resubmission or not
  }

  // Somebody deleted this exact registration on purpose. The import and both
  // catch-ups all funnel through here, so this one check is what makes a
  // deletion stick instead of being undone by the next sync — see section 5c.
  //
  // A GENUINELY NEW SUBMISSION lifts it: registering again is the person
  // saying they are coming after all, and a past deletion has no business
  // vetoing that. Two conditions, both required. `args.fromLiveSubmission`
  // marks the paths that are reading a response as it arrives (the import
  // itself) as opposed to re-deriving rows from standing state — the all-dates
  // registry and the club roster, which are exactly what kept refilling
  // deleted rows and must never revive anything on their own. And the
  // Party_ID must differ from the one the tombstone recorded, so re-reading
  // the very response that was deleted stays blocked however many times it
  // comes round.
  const tombstone = getRegistrantTombstone(registryEntry.eventId, displayName, personType);
  if (tombstone) {
    const isNewSubmission = !!args.fromLiveSubmission && !!partyId && partyId !== tombstone.p;
    if (!isNewSubmission) return null;
    clearRegistrantTombstones(key);
    log(`A deleted registration was re-created by a new submission: ${displayName} on ${registryEntry.eventId}.`);
  }

  const map = getIndexMap(HEADERS.All_Registrants);
  const existingRow = existingRowIndex.get(key);

  if (existingRow) {
    const existingPartyId = existingRow[map['Party_ID']];
    if (existingPartyId && existingPartyId === partyId) {
      // Same Response ID — Google keeps a response's ID stable when a
      // respondent uses their "edit response" link (see
      // form.setAllowResponseEdits(true) in getOrCreateTemplateForm()), so
      // this is the SAME submission being re-seen, not a new one. Refresh
      // the one row in place rather than appending a duplicate.
      existingRow[map['Lunch_Type']] = resolveRegistrantLunchType(wantsLunch, registryEntry);
      existingRow[map['Lunch_Status']] = existingRow[map['Program_Status']] === 'Waitlisted'
        ? 'Waitlisted'
        : (wantsLunch ? 'Needed' : 'No Lunch');
      existingRow[map['Admin_Notes']] = adminNotes || '';
      existingRow[map['Party_Size']] = partySize || '';
      writeMealsOrdered(existingRow, map, resolveMealsOrderedArg(args.mealsOrdered, wantsLunch));
      if (map['Form_Answers'] !== undefined && args.formAnswers !== undefined) {
        existingRow[map['Form_Answers']] = args.formAnswers || '';
      }
      // Somebody who edits their response to say they WOULD now take an
      // earlier slot has changed their mind, which is exactly what the
      // question is for. Written only when this submission actually answered
      // it, so a resubmission that skipped it cannot erase what staff typed
      // into the column by hand.
      if (map['Earlier_Appointment'] !== undefined && args.earlierAppointment) {
        existingRow[map['Earlier_Appointment']] = args.earlierAppointment;
      }
      // An APPOINTMENT's time is the registrant's own answer, not the
      // session's span — so a re-submission that moved the appointment moves
      // this row's time with it. See processAppointmentResponse().
      const refreshedTime = args.eventTimeOverride || registryEntry.eventTime;
      if (refreshedTime) existingRow[map['Event_Time']] = refreshedTime;
      existingRow[map['Order_Ahead_Flag']] = computeOrderAheadFlag(registryEntry.eventDate, submittedAt, orderAheadDays);
      existingRow[map['Form_Source']] = formSource;
      // Contact details are only ever ADDED here, never blanked: a resubmission
      // that skipped the phone box must not erase the number we already have.
      if (phone) existingRow[map['Phone']] = phone;
      if (email) existingRow[map['Email']] = email;
      return null; // nothing new to append — the existing row was updated in place
    }
    // A genuinely different submission (a different Party_ID) for the same
    // identity: keep the old row visible for the audit trail instead of
    // silently dropping this resubmission the way a plain duplicate-key
    // check used to.
    //
    // The place it held is given back before the new row asks for one: the
    // seed below counted that row as Active, and leaving it counted would let
    // somebody re-registering push their own session over its cap. Its
    // appointment SLOT is left marked taken until the next sync recomputes
    // from the rows themselves — the alternative is reference-counting a set
    // for a case that resolves itself within the hour.
    if (String(existingRow[map['Program_Status']] || '').trim() === 'Active') {
      const held = sessionOccupancy(registryEntry);
      held.people = Math.max(0, held.people - 1);
    }
    supersedeRegistrantRow(existingRow, map, submittedAt);
  }

  // HOW FULL THIS SESSION IS RIGHT NOW, in the unit its capacity is written
  // in — heads for an ordinary session, appointment slots for an assistance
  // one. See sessionOccupancy() and occupancyForSession(): a couple seeing the
  // provider together take ONE appointment, and counting them as two waitlisted
  // the next person while a time was still free on the form.
  const occupancy = sessionOccupancy(registryEntry);
  const slotLabel = registryEntry.isAssistance ? appointmentStartLabelOf(args.eventTimeOverride) : '';
  // Joining an appointment somebody in this same party already holds takes no
  // new place — it is the second seat at one appointment.
  const takesAPlace = !slotLabel || !occupancy.slots.has(slotLabel);
  const used = registryEntry.isAssistance
    ? occupancy.slots.size + occupancy.untimed
    : occupancy.people;

  const isCapped = registryEntry.maxCapacity > 0;
  // A SESSION CAN BE CLOSED WITHOUT BEING FULL — see WAITLIST_ONLY_TAG. The
  // capacity arithmetic below is unchanged and still decides every ordinary
  // session; the tick simply short-circuits it, which is what makes it work on
  // the uncapped sessions that are most of them (`used >= 0` is not a test
  // anything can fail). Nobody already registered is touched: this is the
  // status of THIS submission, computed once, at import.
  const forcedWaitlist = !!registryEntry.waitlistOnly;
  const programStatus = forcedWaitlist || (isCapped && takesAPlace && used >= registryEntry.maxCapacity)
    ? 'Waitlisted' : 'Active';
  const lunchStatus = programStatus === 'Waitlisted'
    ? 'Waitlisted'
    : (wantsLunch ? 'Needed' : 'No Lunch');

  if (programStatus === 'Waitlisted') {
    // Someone just hit a cap — or signed up for a session somebody has closed
    // by hand. That's the one registration outcome a human usually has to do
    // something about, so it goes in the admin digest. The two are reported
    // apart because the answer to them is different: one is "open another
    // session", the other is "you already know, and here is who is waiting".
    noteForAdmin('Waitlisted registrants',
      `${displayName} (${personType}) for ${formatDateLabel(registryEntry.eventDate)} — ` +
      (forcedWaitlist
        ? `this session is marked ${WAITLIST_ONLY_TAG}, so everyone signing up for it is waitlisted.`
        : `capacity ${registryEntry.maxCapacity} is full.`));
  }

  if (programStatus === 'Active') {
    occupancy.people++;
    if (slotLabel) occupancy.slots.add(slotLabel);
    else if (registryEntry.isAssistance) occupancy.untimed++;
  }

  const row = new Array(HEADERS.All_Registrants.length).fill('');

  row[map['Location']] = registryEntry.location || '';
  row[map['Event']] = registryEntry.cleanTitle || '';
  row[map['Event_Date']] = registryEntry.eventDate;
  row[map['Event_Time']] = args.eventTimeOverride || registryEntry.eventTime || '';
  row[map['Manual_Override']] = 'Auto-Synced';
  if (map['Form_Answers'] !== undefined) row[map['Form_Answers']] = args.formAnswers || '';
  if (map['Earlier_Appointment'] !== undefined) row[map['Earlier_Appointment']] = args.earlierAppointment || '';
  row[map['Name']] = displayName;
  row[map['Phone']] = phone;
  row[map['Email']] = email;
  row[map['Person_Type']] = personType;
  row[map['Lunch_Type']] = resolveRegistrantLunchType(wantsLunch, registryEntry);
  row[map['Primary_Registrant']] = primaryRegistrant;
  row[map['Party_ID']] = partyId || '';
  row[map['Party_Size']] = partySize || '';
  writeMealsOrdered(row, map, resolveMealsOrderedArg(args.mealsOrdered, wantsLunch));
  // Points at this specific submission (response.getEditResponseUrl(), via
  // processFormResponse()/processAllDatesResponse()), not the shared form editor.
  row[map['Form_Source']] = formSource;
  row[map['Program_Status']] = programStatus;
  row[map['Lunch_Status']] = lunchStatus;
  row[map['Order_Ahead_Flag']] = computeOrderAheadFlag(registryEntry.eventDate, submittedAt, orderAheadDays);
  row[map['Admin_Notes']] = adminNotes || '';
  row[map['Event_ID']] = registryEntry.eventId;

  existingRowIndex.set(key, row); // reserve/replace immediately so a later row in this same pass supersedes/patches THIS one
  return row;
}

/**
 * What a caller's `mealsOrdered` means once it is known whether the row is
 * having lunch at all: undefined stays undefined (no opinion — see
 * writeMealsOrdered()), and a row with no lunch orders no meals whatever the
 * form said — a count of meals on a row that is not eating is a count of
 * nothing.
 */
function resolveMealsOrderedArg(mealsOrdered, wantsLunch) {
  if (mealsOrdered === undefined || mealsOrdered === null) return undefined;
  return wantsLunch ? mealsOrdered : 0;
}

/**
 * Writes Meals_Ordered — and writes NOTHING for an ordinary one-meal
 * registration, which is almost all of them.
 *
 * A blank cell already means one meal (readRegistrantMealsOrdered()), so
 * stamping a literal 1 onto every row would fill a column with a number that
 * says exactly what its absence said, on a tab staff read across. Worse, it
 * would rewrite every existing row on the next sync for no change in meaning.
 * So the column stays empty until somebody actually orders more than one, and
 * a number in it is always news.
 *
 * A resubmission that drops back to one meal DOES clear it, which is why this
 * writes '' rather than skipping: "I do not need the extras any more" has to
 * be able to reach the kitchen.
 */
function writeMealsOrdered(row, map, mealsOrdered) {
  if (map['Meals_Ordered'] === undefined) return;
  // A CALLER THAT SAID NOTHING CHANGES NOTHING. Only the form paths know how
  // many meals a submission asked for; the club roster and the all-dates
  // catch-up re-derive rows from standing state and have no opinion on it. If
  // "no opinion" wrote a blank, every one of those passes would quietly wipe a
  // number staff had typed onto the row by hand.
  if (mealsOrdered === undefined || mealsOrdered === null) return;
  const amount = Math.floor(Number(mealsOrdered) || 0);
  row[map['Meals_Ordered']] = amount > 1 ? amount : '';
}

