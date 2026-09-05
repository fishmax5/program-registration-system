/**
 * Re-shapes every appointment form and re-stocks its time question with what
 * is still free.
 *
 * Runs at the end of each registration sync, beside the capacity-label
 * refresh and for the same reason: the thing that changed is who has booked
 * what, and a form still offering a slot somebody took an hour ago is how two
 * people end up in one chair.
 *
 * THE WHOLE SHAPE, NOT JUST THE TIMES. This used to call
 * applyAppointmentChoices() on its own, which ADDS the time question and
 * removes nothing — fine for a form that was already built as an appointment
 * form, and wrong for the case that actually happens: staff tick
 * Personalized_Assistance on a program whose form already exists. That form
 * then carried BOTH shapes at once. Worse than untidy: the mode question's
 * "I want to sign up for all events this month" branches straight to the
 * every-date page and submits, so the times sitting on the other branch were
 * never reached — the form offered a whole month of appointments and, for
 * anyone taking the first option, no time at all. Reshaping here is the same
 * idempotent call every other path makes, and after the first pass it finds
 * nothing to delete and nothing to write.
 */
function refreshAppointmentSlotsForAllForms(registrySheet, sessionRows, registrantRows) {
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  if (map['Personalized_Assistance'] === undefined) return 0; // a workbook still on the old layout
  const rows = sessionRows || getSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;

  const byForm = groupRegistryRowsByForm(rows, map);
  const assistanceFormIds = Object.keys(byForm).filter(formId =>
    byForm[formId].some(row => isAssistanceColumnValue(row[map['Personalized_Assistance']])));
  // The overwhelmingly common case in a workbook with no appointment programs:
  // stop before reading the registrants or opening a single form.
  if (assistanceFormIds.length === 0) return 0;

  const booked = readBookedAppointmentTimes(registrantRows ||
    getSectionedRows(getOrCreateSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_NAMES.REGISTRANT_DASH),
      HEADERS.All_Registrants, 'Event_ID'));
  const sharedFormIds = getSharedFormIdSet();
  let touched = 0;

  // FINGERPRINTED, like the date labels above it and for the same reason. This
  // runs on every hourly sync for every appointment form, and its whole job is
  // to take booked times off the list — so on the many hours when nobody
  // booked anything it has nothing to do and was finding that out by opening
  // each form to look, which is a remote round trip apiece. The free-slot list
  // IS the answer, so hashing it decides the question without opening
  // anything.
  //
  // IT TRACKS WHAT THIS SCRIPT WRITES, exactly as the date-label fingerprint
  // does — a form edited by hand is not noticed until its times legitimately
  // change again. The escape hatch is already on the menu and already says so:
  // "Rebuild Appointment Forms + Report…" calls syncAssistanceQuestionsOnForm()
  // directly and reshapes every one of them whatever any hash says.
  const fingerprints = getFormLabelFingerprints();
  let skipped = 0;
  const reshaped = []; // program names, for a log line worth reading

  assistanceFormIds.forEach(formId => {
    const context = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
    if (context.sessions.length === 0) return;
    const choices = buildAppointmentChoicesForContext(context, booked);
    // Keyed apart from the date-label fingerprint of the same form: they are
    // two different writes to two different questions, and one key would have
    // each of them permanently invalidating the other.
    const key = `${formId}::appointments`;
    // THE LUNCH SHAPE IS PART OF THIS ANSWER TOO. An appointment form now asks
    // about lunch on the days one is served (applyAppointmentLunchQuestion()),
    // and a menu typed for dates this form already covers changes that without
    // freeing or taking a single appointment — so a hash of the times alone
    // says "nothing to do" on exactly the run that has something to do.
    const fingerprint = computeFormLabelFingerprint(choices, [context.maxPerMonth || 0],
      formLunchShapeKey(context, contextHasLunchDates(context)));
    if (fingerprints[key] === fingerprint) { skipped++; return; }

    try {
      const form = openFormCached(formId);
      const written = syncAssistanceQuestionsOnForm(form, context, choices);
      touched += written;
      if (written > 0) {
        const free = choices.filter(c => c !== ASSISTANCE_NO_TIME_CHOICE).length;
        reshaped.push(`${context.programTitle || describeLocations(context.locations) || formId} ` +
          `(${free} free time(s))`);
      }
      // Recorded only after the write succeeded: a form that could not be
      // opened must be tried again next hour, not marked as done.
      fingerprints[key] = fingerprint;
      __formLabelFingerprintDirty = true;
    } catch (err) {
      const name = context.programTitle || describeLocations(context.locations) || formId;
      log(`⚠️ "${name}": its appointment times could not be refreshed on ` +
        `${describeFormLink(formId)} (${err}). The form is still offering whatever it offered before, ` +
        `which may include a slot somebody has already taken.`);
      noteForAdmin('Appointment forms not updated',
        `"${name}" — the list of free appointment times on ${describeFormLink(formId)} could not be ` +
        `refreshed: ${err}. Until it is, the form may offer a time that is already booked.`);
    }
  });

  if (touched > 0) {
    // reshaped.length is FORMS; `touched` is the number of question edits
    // those forms needed. The old line reported the edit count as a form count
    // ("refreshed 14 form(s)" for four forms), which made a quiet run look
    // like a storm.
    log(`Refreshed the appointment times on ${reshaped.length} form(s) (${touched} question edit(s)): ` +
      `${dedupePreservingOrder(reshaped).join(', ')}.`);
  }
  if (skipped > 0) {
    log(`${skipped} appointment form(s) already offered exactly these times — not opened. ` +
      `(Use Programs & Forms ▸ Rebuild Appointment Forms + Report… to reshape them anyway.)`);
  }
  return touched;
}


/**
 * MENU: reshape every [Personalized Assistance] form NOW, and say exactly what
 * was identified as one.
 *
 * The hourly sync does this already (refreshAppointmentSlotsForAllForms()),
 * which is precisely the problem when something looks wrong: the answer to
 * "why has this form still got the wrong questions on it" is an hour away, and
 * when it arrives it is silent. This runs the same reshape on demand and
 * reports what it saw, per program:
 *
 *   - which sessions the workbook thinks are appointments (the
 *     Personalized_Assistance tick on All_Program_Sessions, which is what
 *     every other part of this feature reads);
 *   - how many free slots each form is offering, and out of how many;
 *   - what changed on the form, or that nothing needed to;
 *   - and the two things that produce a form with NO times on it — every
 *     session in the past, and every slot already booked — named as such
 *     rather than left to look like a failure.
 *
 * It is read-mostly and re-runnable: the only writes are the same idempotent
 * form edits the sync makes.
 */
function rebuildAssistanceFormsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!dash) {
    toastIfPossible('⚠️ There is no program dashboard yet — run Sync Cal once.');
    return;
  }
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(dash, headers, 'Event_ID');
  const lines = [];
  const todayKey = formatDateKey(new Date());

  if (map['Personalized_Assistance'] === undefined) {
    const stale = 'This workbook\'s dashboard has no Personalized_Assistance column yet — ' +
      'run Admin → Rebuild Layout, then Sync Cal.';
    log(`rebuildAssistanceFormsNow: ${stale}`);
    try { SpreadsheetApp.getUi().alert('Appointment Forms', stale, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { /* no UI */ }
    return;
  }

  // WHAT IS AN APPOINTMENT, PROGRAM BY PROGRAM. Reported for every
  // program on the dashboard, not just the ticked ones: "Low-Cost Wills —
  // not marked" is the answer to the commonest version of this question, and
  // it cannot be given by listing only the programs that ARE marked.
  const byProgram = {};
  rows.forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    if (!title) return;
    const key = `${title}\u0000${String(row[map['Location']] || '').trim()}`;
    if (!byProgram[key]) {
      byProgram[key] = {
        title, location: String(row[map['Location']] || '').trim(),
        marked: 0, total: 0, upcoming: 0, formIds: {}
      };
    }
    const entry = byProgram[key];
    entry.total++;
    const date = coerceDate(row[map['Event_Date']]);
    if (date && formatDateKey(date) >= todayKey) entry.upcoming++;
    if (isAssistanceColumnValue(row[map['Personalized_Assistance']])) {
      entry.marked++;
      const formId = String(row[map['Form_ID']] || '').trim();
      if (formId) entry.formIds[formId] = true;
    }
  });

  lines.push('IDENTIFIED AS PERSONALIZED ASSISTANCE');
  const programs = Object.keys(byProgram).map(k => byProgram[k])
    .sort((a, b) => a.title.localeCompare(b.title));
  const marked = programs.filter(p => p.marked > 0);
  if (marked.length === 0) {
    lines.push('  (nothing — no session on the dashboard has its Personalized_Assistance box ticked)');
    lines.push('  Tick it on All_Program_Sessions, or put [Personalized Assistance] in the');
    lines.push('  calendar event\'s description, then run Sync Cal.');
  }
  marked.forEach(p => {
    lines.push(`  ✅ ${p.title} (${p.location}) — ${p.marked} of ${p.total} session(s) marked, ` +
      `${p.upcoming} still upcoming`);
    if (p.marked < p.total) {
      lines.push(`     ⚠️ ${p.total - p.marked} session(s) of this program are NOT marked — those dates ` +
        `are offered as ordinary sign-ups.`);
    }
  });
  const unmarked = programs.filter(p => p.marked === 0);
  if (unmarked.length > 0) {
    lines.push('');
    lines.push(`NOT MARKED (${unmarked.length} program(s)) — ordinary date-based sign-up:`);
    unmarked.slice(0, ASSISTANCE_REPORT_MAX_UNMARKED).forEach(p =>
      lines.push(`  – ${p.title} (${p.location})`));
    if (unmarked.length > ASSISTANCE_REPORT_MAX_UNMARKED) {
      lines.push(`  …and ${unmarked.length - ASSISTANCE_REPORT_MAX_UNMARKED} more.`);
    }
  }

  // WHAT THE CALENDAR SAYS — the half of this report that was missing, and the
  // only half that can answer the question people actually arrive with.
  //
  // Everything above reads the SHEET. When the ticks are all gone, a report
  // built from the sheet says "nothing is marked", which is true, useless, and
  // exactly what somebody already knew before they clicked. The calendar is
  // the source of truth for these ticks — the sync reads it and writes them —
  // so the useful comparison is calendar against sheet, and the two ways they
  // can disagree are two different problems with two different fixes:
  //
  //   calendar says yes, sheet says no  -> the sync has not run since the tag
  //                                        went on. Run 🔄 Update Everything Now.
  //   calendar says no, sheet said yes  -> the tag never reached the calendar,
  //                                        or is typed in a bracket this script
  //                                        reads as a note. The next sync will
  //                                        clear the tick again, whatever you do
  //                                        to the sheet.
  lines.push('');
  lines.push('WHAT THE CALENDAR SAYS (the source of truth for these ticks)');
  const onCalendar = summarizeAssistanceOnCalendar();
  if (onCalendar.error) {
    lines.push(`  ⚠️ The calendar could not be read: ${onCalendar.error}`);
  } else {
    onCalendar.unreadable.forEach(name => lines.push(`  ⚠️ ${name} could not be read.`));
    if (onCalendar.programs.length === 0) {
      lines.push('  (nothing — no calendar event in the sync window reads as [Personalized Assistance])');
      lines.push(`  Window searched: ${onCalendar.windowLabel}.`);
      lines.push('  If the tag IS typed on an event, this script is not reading the bracket it is in —');
      lines.push('  a bracket only sets something when the WHOLE bracket is tags, so');
      lines.push('  "[Call for an appointment]" is a note and sets nothing. Check the exact wording with');
      lines.push('  🔧 Admin ▸ Read an Event\'s Tags…');
    }
    onCalendar.programs.forEach(p => {
      lines.push(`  ${p.tagged === p.total ? '✅' : '⚠️'} ${p.title} (${p.location}) — tagged on ` +
        `${p.tagged} of ${p.total} calendar event(s)${p.slotMinutes ? `, ${p.slotMinutes}-minute slots` : ''}`);
      const sheetEntry = byProgram[`${p.title}\u0000${p.location}`];
      if (sheetEntry && sheetEntry.marked === 0) {
        lines.push('     ⚠️ …but NO session of it is ticked on the dashboard. The sync has not read this ' +
          'tag yet — run 🔄 Update Everything Now.');
      }
    });
    programs.filter(p => p.marked > 0).forEach(p => {
      const still = onCalendar.programs.filter(c => c.title === p.title && c.location === p.location);
      if (still.length === 0) {
        lines.push(`  ⚠️ ${p.title} (${p.location}) is ticked on the dashboard but NO calendar event of ` +
          `it reads as [${ASSISTANCE_TAG}]. The next sync will clear those ticks. Use ` +
          `"Push Dashboard Ticks to the Calendar" to write the tag, then re-run this.`);
      }
    });
  }

  // THE RESHAPE ITSELF, form by form.
  const byForm = groupRegistryRowsByForm(rows, map);
  const assistanceFormIds = Object.keys(byForm).filter(formId =>
    byForm[formId].some(row => isAssistanceColumnValue(row[map['Personalized_Assistance']])));

  lines.push('');
  lines.push(`FORMS RESHAPED (${assistanceFormIds.length})`);
  if (assistanceFormIds.length === 0) {
    lines.push('  (none to do)');
  } else {
    const booked = readBookedAppointmentTimes(getSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID'));
    const sharedFormIds = getSharedFormIdSet();
    assistanceFormIds.forEach(formId => {
      const context = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
      const name = context.programTitle || describeLocations(context.locations) || formId;
      const upcoming = context.sessions.filter(s => s.date && formatDateKey(s.date) >= todayKey);
      try {
        const choices = buildAppointmentChoicesForContext(context, booked);
        // The escape hatch is always the last choice and is never a time — see
        // ASSISTANCE_NO_TIME_CHOICE. Counting it as one is how a form with
        // nothing free reads as "1 time available".
        const free = choices.filter(c => c !== ASSISTANCE_NO_TIME_CHOICE).length;
        const changed = syncAssistanceQuestionsOnForm(openFormCached(formId), context, choices);
        lines.push(`  ${name} — ${free} free appointment time(s) across ${upcoming.length} upcoming ` +
          `session(s); ${changed > 0 ? `${changed} change(s) written` : 'already correct'}` +
          `; asks about an earlier appointment`);
        if (free === 0) {
          lines.push(upcoming.length === 0
            ? `     ⚠️ No UPCOMING sessions — a past date is never offered, so this form can only take ` +
              `"${ASSISTANCE_NO_TIME_CHOICE}". Add the next dates to the calendar and run Sync Cal.`
            : `     ⚠️ Every slot on those sessions is already booked. Cancel a registrant row to free one.`);
        }
      } catch (err) {
        lines.push(`  ${name} — ⚠️ could not be reshaped: ${err}`);
        log(`rebuildAssistanceFormsNow: ${formId} failed (${err}).`);
      }
    });
  }

  const report = lines.join('\n');
  log(`rebuildAssistanceFormsNow:\n${report}`);
  try {
    SpreadsheetApp.getUi().alert('Appointment Forms', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // No UI (editor or trigger run) — the log above is the output.
  }
}

/** How many ordinary programs the report above lists before summarizing the rest. */
const ASSISTANCE_REPORT_MAX_UNMARKED = 12;

/**
 * WHICH PROGRAMS THE CALENDAR ITSELF SAYS ARE APPOINTMENT PROGRAMS, read with
 * the sync's own parser and nothing else.
 *
 * Deliberately independent of the session table and of buildEventGroups(): the
 * point of the answer is to be compared with those, and a summary derived from
 * them could not disagree with them. It walks the events, resolves each one's
 * settings exactly as buildGroupsForWindow() does, and counts.
 *
 * Returns { programs: [{ title, location, tagged, total, slotMinutes }],
 * unreadable: [locationName], windowLabel, error }.
 */
function summarizeAssistanceOnCalendar() {
  let start, end, eventsByCalendar;
  try {
    const range = computeSyncDateRange();
    start = range.start;
    end = range.end;
    eventsByCalendar = getCalendarEventsForWindow(start, end);
  } catch (err) {
    return { programs: [], unreadable: [], windowLabel: '', error: String(err) };
  }

  const byProgram = {};
  const unreadable = [];
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) { unreadable.push(locationName); return; }
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.isTentative) return;
      const settings = resolveEventSettings(ev, parsed);
      const key = `${parsed.cleanTitle}\u0000${locationName}`;
      if (!byProgram[key]) {
        byProgram[key] = { title: parsed.cleanTitle, location: locationName,
          tagged: 0, total: 0, slotMinutes: 0 };
      }
      const entry = byProgram[key];
      entry.total++;
      if (!settings.isAssistance) return;
      entry.tagged++;
      if (!entry.slotMinutes) entry.slotMinutes = resolveSlotMinutes(settings);
    });
  });

  return {
    programs: Object.keys(byProgram).map(k => byProgram[k])
      .filter(p => p.tagged > 0)
      .sort((a, b) => a.title.localeCompare(b.title)),
    unreadable,
    windowLabel: `${formatDateLabel(start)} – ${formatDateLabel(end)}`,
    error: ''
  };
}

// ---------------------------------------------------------------------------
// READING AN APPOINTMENT SUBMISSION
// ---------------------------------------------------------------------------

/**
 * One appointment form response -> registrant rows.
 *
 * A respondent picks ONE time, and everybody named on the submission is booked
 * into it: a couple coming to see Heather about a will is one appointment with
 * two people in it, not two appointments. That is the opposite of the roster
 * grid's per-person resolution, and it is right here for the same reason the
 * grid is right there — an appointment is a slot in somebody's diary.
 *
 * "None of these work" books nothing at all and files a request instead — see
 * ASSISTANCE_NO_TIME_CHOICE.
 */
function processAppointmentResponse(args) {
  const { formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
    people, adminNotes, responseEditUrl, submittedAt, partyId, partySize, phone, email,
    customAnswers, collectors } = args;
  const form = formIndex.form;
  const formId = form.getId();
  const chosen = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.APPOINTMENT) || '').trim();
  const parsed = parseAppointmentChoice(chosen);
  const registrantName = people[0] ? people[0].name : '';
  // Optional, and blank means no — see EARLIER_APPOINTMENT_CHOICES.
  const earlierAppointment = readEarlierAppointmentAnswer(
    getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.EARLIER_APPOINTMENT));
  // Likewise optional, likewise blank-means-no, and absent altogether on a
  // form whose dates serve no lunch — see TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH.
  const appointmentLunch = readAppointmentLunchAnswer(
    getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH));

  if (!parsed) {
    // Either the escape hatch, or a form whose times changed under a
    // respondent mid-submission. Both are "a person who wants an appointment
    // and has not got one", which is exactly what the requests tab is for —
    // and is a great deal better than dropping the submission.
    if (collectors && collectors.assistanceRequests) {
      collectors.assistanceRequests.push({
        received: submittedAt,
        program: describeFormPrograms(registryIndex, formId),
        location: describeFormLocations(registryIndex, formId),
        name: registrantName,
        phone, email,
        // Their answer to the earlier-appointment question rides along with
        // the rest: somebody asking to be fitted in has by definition said
        // they will take what opens up, and staff working this tab should not
        // have to go and look it up on another one.
        answers: [customAnswers, earlierAppointment, adminNotes].filter(Boolean).join(' | '),
        requestId: partyId
      });
    }
    log(`Appointment request with no time chosen on form ${formId} — filed on "${SHEET_NAMES.ASSISTANCE_REQUESTS}".`);
    return [];
  }

  const plainLabel = resolveSessionLabelForForm(registryIndex, formId, parsed.sessionLabel) || parsed.sessionLabel;
  const registryEntry = registryIndex[`${formId}|${plainLabel}`];
  if (!registryEntry) {
    const message = `No ${SHEET_NAMES.PROGRAM_DASHBOARD} match for form ${formId} / "${parsed.sessionLabel}"` +
      ` — the appointment chosen by ${registrantName || 'a registrant'} has NOT been imported.`;
    log(message);
    noteForAdmin('Form row matches no session', message);
    return [];
  }

  // The chosen slot's own times, rather than the session's whole span: the
  // registrant row's Event_Time IS the appointment, and it is what the
  // provider's list is built from.
  const slot = buildAppointmentSlots(registryEntry.eventDate, registryEntry.eventEnd,
    resolveSlotMinutes(registryEntry)).filter(s => s.startLabel === parsed.slotStartLabel)[0];
  const eventTime = slot ? slot.rangeLabel : parsed.slotStartLabel;

  // A DOUBLE BOOKING IS FLAGGED, NEVER DROPPED. Taken slots are removed from
  // the form, so this needs two people submitting inside the same hour — rare,
  // and precisely the case where losing one of them silently is worst.
  const clash = existingAppointmentHolder(existingRowIndex, registryEntry.eventId, eventTime,
    people.map(p => p.name));
  let notes = adminNotes;
  if (clash) {
    const flag = `Double-booked: ${clash} already holds ${eventTime} on this date.`;
    notes = notes ? `${notes} | ${flag}` : flag;
    noteForAdmin('Double-booked appointments',
      `${registrantName || 'A registrant'} and ${clash} both hold ${eventTime} on ` +
      `${formatDateLabel(registryEntry.eventDate)} for "${registryEntry.cleanTitle}" — one needs moving.`);
  }

  const repeat = describeRepeatAppointment(registryEntry, registrantName, existingRowIndex,
    registryEntry.maxPerMonth);
  if (repeat) {
    notes = notes ? `${notes} | ${repeat}` : repeat;
    noteForAdmin('Repeat appointments this month', repeat);
  }

  const rows = [];
  people.forEach((person, i) => {
    rows.push(buildRegistrantRow({
      registryEntry, name: person.name, personType: person.personType,
      // AN APPOINTMENT IS NOT A MEAL, BUT THE DAY MIGHT COME WITH ONE. This is
      // the answer to the form's own lunch question and nothing else: no
      // question on the form (its dates serve none) reads as 'No Lunch', which
      // is what this call site said unconditionally until the question
      // existed. buildRegistrantRow() still gates it on the date, so a Yes on
      // a day that turns out not to be catered orders nothing.
      //
      // On EVERY person in the party, for the same reason earlierAppointment
      // is: a couple seeing Heather together eat together.
      lunchType: appointmentLunch,
      primaryRegistrant: person.primaryRegistrant,
      adminNotes: i === 0 ? notes : (person.baseNotes || ''),
      formEditUrl: responseEditUrl, protectedKeys, existingRowIndex, submittedAt, orderAheadDays,
      partyId, partySize, fromLiveSubmission: true, phone, email,
      // THE APPOINTMENT ITSELF. Everything a provider is sent a week ahead —
      // and everything the day's schedule is built from — is this one value.
      eventTimeOverride: eventTime,
      // On EVERY person in the party, not just the first: a couple seeing
      // Heather together are moved together or not at all, so the answer has
      // to be true of both their rows.
      earlierAppointment,
      formAnswers: i === 0 ? customAnswers : ''
    }));
  });
  return rows.filter(Boolean);
}

/** "Low-Cost Wills" — the distinct program titles one form covers, for a request row. */
function describeFormPrograms(registryIndex, formId) {
  return describeFormField(registryIndex, formId, 'cleanTitle').join(' / ');
}

/** "Narberth + Ashbridge" — the distinct locations one form covers, for a request row. */
function describeFormLocations(registryIndex, formId) {
  return describeLocations(describeFormField(registryIndex, formId, 'location'));
}

function describeFormField(registryIndex, formId, field) {
  const values = [];
  Object.keys(registryIndex || {}).forEach(key => {
    const entry = registryIndex[key];
    if (!entry || entry.formId !== formId) return;
    const value = String(entry[field] || '').trim();
    if (value) values.push(value);
  });
  return dedupePreservingOrder(values);
}

/**
 * The name already holding `eventTime` on `eventId`, if it is somebody else.
 * Returns '' when the slot is free or is held by one of the people on this
 * very submission (an edited response re-choosing its own time).
 */
function existingAppointmentHolder(existingRowIndex, eventId, eventTime, ownNames) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const own = new Set((ownNames || []).map(normalizeNameKey));
  const wanted = appointmentStartLabelOf(eventTime);
  let holder = '';
  existingRowIndex.forEach(row => {
    if (holder) return;
    if (String(row[map['Event_ID']] || '') !== eventId) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return;
    if (appointmentStartLabelOf(row[map['Event_Time']]) !== wanted) return;
    const name = String(row[map['Name']] || '').trim();
    if (own.has(normalizeNameKey(name))) return;
    holder = name;
  });
  return holder;
}

/**
 * The note for a second appointment in one calendar month, where the program
 * asked for a limit ("[Max Per Month: 1]" — Gerry's rule). Returns '' when
 * there is no limit or the limit is not reached.
 *
 * FLAGGED, NOT REFUSED. A form cannot know that the person booking a second
 * session is the same Jane Smith, staff sometimes make the exception
 * deliberately, and a registration silently thrown away is the one outcome
 * nobody can recover from. So the row is created and says what it is.
 */
function describeRepeatAppointment(registryEntry, name, existingRowIndex, maxPerMonth) {
  const limit = Number(maxPerMonth || 0);
  if (!limit || !name) return '';
  const map = getIndexMap(HEADERS.All_Registrants);
  const key = normalizeNameKey(name);
  const month = getMonthLabel(registryEntry.eventDate);
  const program = String(registryEntry.cleanTitle || '').trim();
  let count = 0;
  existingRowIndex.forEach(row => {
    if (normalizeNameKey(row[map['Name']]) !== key) return;
    if (String(row[map['Event']] || '').trim() !== program) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return;
    const d = coerceDate(row[map['Event_Date']]);
    if (d && getMonthLabel(d) === month) count++;
  });
  if (count < limit) return '';
  return `${name} already has ${count} "${program}" appointment(s) in ${month} — ` +
    `this program allows ${limit} per month.`;
}


// ---------------------------------------------------------------------------
// THE TWO TABS
// ---------------------------------------------------------------------------

/** Writes the Program_Questions tab, keeping whatever is already on it. */
function renderProgramQuestionsSheet(allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_QUESTIONS);
  const headers = HEADERS.Program_Questions;
  const map = getIndexMap(headers);
  const rows = allRows || readProgramQuestionRows(sheet);
  invalidateProgramQuestionSpecs();

  writeMemoryTab(sheet, headers, rows, {
    banner: '❓ Program Questions',
    bannerNote: 'Extra questions added to a program\'s registration form — one row per question.\n\n' +
      'Press "Update Program Questions on Forms" on the menu when you are done editing.',
    staffColumns: PROGRAM_QUESTIONS_STAFF_COLUMNS,
    numberColumns: ['Sort']
  });

  // EVERY COLUMN WITH A FIXED VOCABULARY GETS A DROPDOWN, and they reach a
  // band of blank rows past the data — because the row that matters is the
  // NEXT one, the empty one somebody is about to type a question into. See
  // MEMORY_TAB_SPARE_ROWS for what this used to do instead.
  //
  // Program and Location are dropdowns for the first time here. Both are
  // matched against the calendar by exact text (questionsForFormContext()),
  // so a title typed from memory — "Bookclub", "Book Club " — is a question
  // that silently applies to no form at all, with nothing on the tab to say
  // so. They are OPEN lists rather than closed ones: "*" is a legitimate
  // answer to both, a program that has not been imported yet is a
  // legitimate answer to Program, and refusing either would be worse than
  // not knowing it.
  const span = applyMemoryTabValidation(sheet, headers, rows.length, {
    checkboxes: ['Required', 'Active'],
    lists: { Type: PROGRAM_QUESTION_TYPE_OPTIONS },
    openLists: {
      Program: [PROGRAM_QUESTION_ALL_PROGRAMS].concat(listKnownProgramTitles()),
      Location: [PROGRAM_QUESTION_ALL_PROGRAMS].concat(Object.values(CALENDAR_MAP))
    }
  });
  // Choices is one option per line, so the cell has to be able to show them.
  sheet.getRange(MEMORY_TAB_DATA_ROW, map['Choices'] + 1, span, 1).setWrap(true);
  // Same for the keywords, which are a list in exactly the same way.
  if (map['Match_Keywords'] !== undefined) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Match_Keywords'] + 1, span, 1).setWrap(true);
  }

  // THE NOTES ARE ON THE HEADERS, not the rows: a note on the header is there
  // on an empty tab, which is exactly when somebody needs telling what the
  // column is for. Rewritten every render so they cannot drift from the code.
  const headerNote = (column, text) => {
    if (map[column] === undefined) return;
    sheet.getRange(MEMORY_TAB_HEADER_ROW, map[column] + 1).setNote(text);
  };
  headerNote('Type',
    'What kind of thing this row puts on the form.\n\n' +
    'ASKS A QUESTION:\n' +
    '  Short answer / Paragraph — free text\n' +
    '  Dropdown / Checkboxes / Multiple choice — needs its options in Choices\n' +
    '  Date / Time — a real date or time picker, not a typed-in one\n' +
    '  Scale — 1 to 5 by default. Choices can set the range and the end\n' +
    '          labels: "1-5 | Not at all | Very much"\n' +

    'SHOWS SOMETHING (asks nothing, so Required does not apply):\n' +
    '  Notice — a block of words in the middle of the form. The heading goes\n' +
    '           in Question and the wording in Help_Text. This is where a\n' +
    '           class disclaimer belongs.\n' +
    '  Image  — a picture beside the last question. Put its Google Drive\n' +
    '           link in Choices.\n' +
    '  Header image — the same picture, at the TOP of the form instead,\n' +
    '           above the first question. This is the one for a logo or a\n' +
    '           photo of the class.\n' +
    '  Form description — wording added to the top of the form, above the\n' +
    '           first question, where it is read before anybody starts.\n' +
    '           Question names the row; Help_Text is what is actually shown.\n\n' +
    'Anything here survives a form being rebuilt. Anything you type onto the\n' +
    'form itself does not.');
  headerNote('Question',
    'The wording of the question — and its NAME, which is how this row is\n' +
    'matched to what is already on the form. Renaming it retires the old one\n' +
    'and adds a new one; answers already collected stay where they are.\n\n' +
    'For a Notice this is the bold heading above the wording ("Please note").\n' +
    'For an Image it is the caption. Both need one.');
  headerNote('Choices',
    'One option per line, for Dropdown / Checkboxes / Multiple choice.\n\n' +
    'For an Image row this holds the picture instead: upload it to Google\n' +
    'Drive, use Share \u25b8 Copy link, and paste the link here.\n\n' +
    'Ignored by the text types and by Notice.');
  headerNote('Program',
    'Pick from the dropdown — it lists every program currently on the\n' +
    'dashboard, spelled the way the Google Calendar spells it. A name typed\n' +
    'from memory that does not match exactly asks its question of no form at\n' +
    'all, and nothing here would say so.\n\n' +
    'Pick "*" (or leave it blank) for every form in the workbook.');
  headerNote('Location',
    'Pick "*" or leave it blank for every location. Otherwise only forms\n' +
    'covering that location are asked.');
  headerNote('Match_Keywords',
    'The other way to aim a row — by what a program IS rather than by its\n' +
    'exact name. One keyword per line (or separated by "|" or a comma).\n\n' +
    'A keyword is matched as text against every program title the form\n' +
    'covers, its locations, and its calendar tags. So:\n\n' +
    '  wills      reaches "Low-Cost Wills" AND "Wills & Estates Clinic"\n' +
    '  zoom       reaches everything running online\n' +
    '  club       reaches every [Club] program\n\n' +
    'ANY one keyword matching is enough. Program, Location and Match_Keywords\n' +
    'narrow TOGETHER: Location "Narberth" plus keyword "wills" means the\n' +
    'wills clinic at Narberth, not either of them.\n\n' +
    'Leave it blank not to narrow by keyword at all.');
  return rows.length;
}

/** Reads the requests tab. */
function readAssistanceRequestRows(sheet) {
  const target = sheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.ASSISTANCE_REQUESTS);
  if (!target) return [];
  try {
    return readSimpleTable(target, HEADERS.Assistance_Requests);
  } catch (err) {
    log(`Could not read "${SHEET_NAMES.ASSISTANCE_REQUESTS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/**
 * Files the "no time works" submissions collected during an import, newest
 * first, skipping any whose Request_ID is already on the tab.
 *
 * The staff columns (Status / Scheduled_For / Staff_Notes) are never written
 * by this — the whole tab exists so somebody can work through it, and a sync
 * that reset their progress every hour would make it useless.
 */
function recordAssistanceRequests(requests) {
  if (!requests || requests.length === 0) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.ASSISTANCE_REQUESTS);
  const headers = HEADERS.Assistance_Requests;
  const map = getIndexMap(headers);
  const existing = readAssistanceRequestRows(sheet);
  const seen = new Set(existing.map(row => String(row[map['Request_ID']] || '').trim()).filter(Boolean));

  let added = 0;
  requests.forEach(req => {
    const id = String(req.requestId || '').trim();
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    const row = new Array(headers.length).fill('');
    row[map['Received']] = req.received || new Date();
    row[map['Program']] = req.program || '';
    row[map['Location']] = req.location || '';
    row[map['Name']] = req.name || '';
    row[map['Phone']] = req.phone || '';
    row[map['Email']] = req.email || '';
    row[map['Answers']] = req.answers || '';
    row[map['Status']] = ASSISTANCE_REQUEST_STATUSES[0];
    row[map['Request_ID']] = id;
    existing.push(row);
    added++;
  });

  if (added === 0) return 0;
  // The rows this run actually filed, kept aside before the sort below mixes
  // them in with everything already on the tab: the email is about what is
  // new, and a digest of the whole backlog every hour is a digest nobody reads.
  const filed = existing.slice(existing.length - added);
  existing.sort((a, b) => {
    const da = coerceDate(a[map['Received']]);
    const db = coerceDate(b[map['Received']]);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });
  renderAssistanceRequestsSheet(existing);
  log(`${SHEET_NAMES.ASSISTANCE_REQUESTS}: filed ${added} new request(s).`);
  noteForAdmin('Appointment requests needing a date',
    `${added} person/people asked for a personalized-assistance appointment outside the times offered. ` +
    `See the "${SHEET_NAMES.ASSISTANCE_REQUESTS}" tab.`);
  // AND, for whoever is actually going to ring these people, their own email
  // with the numbers in it — see the Appointment_Requests tick on Config's
  // Admin Notification Emails table. The digest line above stays where it is:
  // the two are read by different people, and often by nobody in common.
  //
  // Guarded, and after the tab is written: a request that is safely on the
  // tab and unannounced is recoverable by looking at the tab; a mail failure
  // that lost the row would not be.
  try {
    sendAssistanceRequestNotification(filed, map);
  } catch (err) {
    log(`⚠️ Could not email this run's appointment requests (${err}) — they are on the tab.`);
  }
  return added;
}

/**
 * The one email per sync about the requests just filed, to the addresses
 * ticked for 'appointmentRequests'.
 *
 * Everything needed to make the call is in the body — name, number, email, the
 * program and location they asked about, and what they typed — because the
 * alternative is opening the workbook to find out whether this is worth
 * opening the workbook for. Nobody ticked means nothing sent.
 */
function sendAssistanceRequestNotification(rows, map) {
  if (!rows || rows.length === 0) return false;
  const lines = [
    `${rows.length} person/people asked for a personalized-assistance appointment at a time we have not `,
    'scheduled yet. They have NOT been booked into anything — each one is waiting to hear from somebody.',
    ''
  ];
  rows.forEach(row => {
    const value = header => String(row[map[header]] || '').trim();
    const received = coerceDate(row[map['Received']]);
    lines.push(`• ${value('Name') || '(no name given)'}`);
    lines.push(`    Asked about: ${[value('Program'), value('Location')].filter(Boolean).join(' — ') || '(not recorded)'}`);
    lines.push(`    Contact: ${[value('Phone'), value('Email')].filter(Boolean).join('  ·  ') || '(none given)'}`);
    if (value('Answers')) lines.push(`    They said: ${value('Answers')}`);
    if (received) lines.push(`    Received: ${formatDateLabel(received)}`);
    lines.push('');
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  lines.push(`Work them through on the "${SHEET_NAMES.ASSISTANCE_REQUESTS}" tab — Status there is yours to move.`);
  if (ss) lines.push(ss.getUrl());
  return notifyAdminCategory('appointmentRequests',
    `[Calendar & Form Manager] ${rows.length} appointment request(s) need a date`,
    lines.join('\n'));
}

/** Writes the requests tab: newest first, Status as a dropdown, the response ID hidden. */
function renderAssistanceRequestsSheet(allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.ASSISTANCE_REQUESTS);
  const headers = HEADERS.Assistance_Requests;
  const map = getIndexMap(headers);
  const rows = allRows || readAssistanceRequestRows(sheet);

  writeMemoryTab(sheet, headers, rows, {
    banner: '🗓️ Appointment Requests',
    bannerNote: 'People who need a personalized-assistance appointment at a time ' +
      'we have not scheduled yet.',
    staffColumns: ASSISTANCE_REQUEST_STAFF_COLUMNS,
    dateColumns: ['Received', 'Scheduled_For']
  });

  // Down the blank band too: a request phoned in is typed onto the row under
  // the last one, and it needs the same Status dropdown as one the form filed.
  const span = applyMemoryTabValidation(sheet, headers, rows.length, {
    lists: { Status: ASSISTANCE_REQUEST_STATUSES },
    openLists: {
      Location: Object.values(CALENDAR_MAP),
      Program: listKnownProgramTitles()
    }
  });
  sheet.getRange(MEMORY_TAB_DATA_ROW, map['Answers'] + 1, span, 1).setWrap(true);
  applyColumnVisibility(sheet, headers, ['Request_ID']);
  return rows.length;
}


// ---------------------------------------------------------------------------
// THE PROVIDER'S LIST  ("who is Heather seeing on the 13th?")
// ---------------------------------------------------------------------------

/**
 * Every upcoming personalized-assistance appointment, grouped by date and
 * program, with the times, names, contact details and each person's answers to
 * the program's own questions.
 *
 * This is the deliverable the tag exists for. Heather Turner and the Medicare
 * counselors are sent their day's list a week ahead, and assembling it by
 * filtering the registrants tab by hand — for the right program, on the right
 * date, in time order, with the zip codes and document types attached — is
 * both fiddly and easy to get wrong in a way nobody notices until somebody is
 * missing from a schedule.
 */
function getAssistanceScheduleData(daysAhead) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  const sMap = getIndexMap(HEADERS.All_Program_Sessions);
  const rMap = getIndexMap(HEADERS.All_Registrants);
  if (sMap['Personalized_Assistance'] === undefined) return { days: [], earlier: [] };

  const assistanceEventIds = {};
  getSectionedRows(registrySheet, HEADERS.All_Program_Sessions, 'Event_ID').forEach(row => {
    if (!isAssistanceColumnValue(row[sMap['Personalized_Assistance']])) return;
    const id = String(row[sMap['Event_ID']] || '').trim();
    if (id) assistanceEventIds[id] = true;
  });
  if (Object.keys(assistanceEventIds).length === 0) return { days: [], earlier: [] };

  const horizon = new Date();
  horizon.setHours(0, 0, 0, 0);
  const until = new Date(horizon.getTime() + Math.max(1, Number(daysAhead) || 14) * 24 * 60 * 60 * 1000);

  const byDay = {};
  const earlierList = [];
  getSectionedRows(registrantsSheet, HEADERS.All_Registrants, 'Event_ID').forEach(row => {
    const eventId = String(row[rMap['Event_ID']] || '').trim();
    if (!assistanceEventIds[eventId]) return;
    const status = String(row[rMap['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return;
    const date = coerceDate(row[rMap['Event_Date']]);
    if (!date || date < horizon || date > until) return;

    const key = `${formatDateKey(date)}|${row[rMap['Event']]}|${row[rMap['Location']]}`;
    if (!byDay[key]) {
      byDay[key] = {
        dateKey: formatDateKey(date),
        dateLabel: formatDateLabel(date),
        program: String(row[rMap['Event']] || ''),
        location: String(row[rMap['Location']] || ''),
        people: []
      };
    }
    const earlier = rMap['Earlier_Appointment'] === undefined
      ? false : wantsEarlierAppointment(row[rMap['Earlier_Appointment']]);
    byDay[key].people.push({
      time: eventTimeLabelOf(row[rMap['Event_Time']]),
      name: String(row[rMap['Name']] || ''),
      personType: String(row[rMap['Person_Type']] || ''),
      phone: String(row[rMap['Phone']] || ''),
      email: String(row[rMap['Email']] || ''),
      answers: String(rMap['Form_Answers'] === undefined ? '' : (row[rMap['Form_Answers']] || '')),
      notes: String(row[rMap['Admin_Notes']] || ''),
      earlier
    });
    // THE CALL LIST. Kept as its own flat list rather than left to be picked
    // out of the days above, because the moment it is wanted is the moment a
    // cancellation lands: somebody needs "who would take this, and what is
    // their number" in one glance, not a scroll through every day looking for
    // markers.
    if (earlier) {
      earlierList.push({
        dateKey: formatDateKey(date),
        dateLabel: formatDateLabel(date),
        time: eventTimeLabelOf(row[rMap['Event_Time']]),
        program: String(row[rMap['Event']] || ''),
        location: String(row[rMap['Location']] || ''),
        name: String(row[rMap['Name']] || ''),
        phone: String(row[rMap['Phone']] || ''),
        email: String(row[rMap['Email']] || '')
      });
    }
  });

  const days = Object.keys(byDay).map(k => byDay[k])
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.program.localeCompare(b.program))
    .map(day => {
      // Time order within the day, which is the only order a provider's list
      // is any use in. Rows with no time (a hand-added walk-in) sit at the end.
      day.people.sort((a, b) =>
        (appointmentSortKey(a.time) - appointmentSortKey(b.time)) || a.name.localeCompare(b.name));
      return day;
    });

  // FURTHEST OUT FIRST. Whoever is booked in November has the most to gain
  // from a slot that just opened in September, and is the first person to
  // ring — which is the opposite of the chronological order the provider's
  // list is in, so it is sorted here rather than shared with it.
  earlierList.sort((a, b) => b.dateKey.localeCompare(a.dateKey) ||
    (appointmentSortKey(a.time) - appointmentSortKey(b.time)) || a.name.localeCompare(b.name));

  return { days, earlier: earlierList };
}

/** Minutes-since-midnight for "10:30 AM", for sorting. Unparseable times sort last. */
function appointmentSortKey(eventTime) {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp])/.exec(appointmentStartLabelOf(eventTime));
  if (!m) return 100000;
  let hour = parseInt(m[1], 10) % 12;
  if (/[Pp]/.test(m[3])) hour += 12;
  return hour * 60 + parseInt(m[2], 10);
}

function showAssistanceScheduleDialog() {
  const html = HtmlService.createHtmlOutput(buildAssistanceScheduleHtml())
    .setWidth(680)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'Personalized Assistance Schedule');
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildAssistanceScheduleHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  select, button { font-size: 13px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 7px 14px; cursor: pointer; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #out { margin-top: 12px; border: 1px solid #ddd; border-radius: 4px; padding: 10px; max-height: 330px;
         overflow: auto; background: #fafafa; }
  .day { margin: 0 0 14px 0; }
  .day h4 { margin: 0 0 4px 0; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { background: #f1f3f4; font-size: 12px; }
  td.time { white-space: nowrap; font-weight: bold; }
  span.earlier { color: #B06000; font-weight: bold; }
  .none { color: #666; font-style: italic; }
</style>
<h3>Who is booked, and when</h3>
<p class="hint">
  Every upcoming appointment on a program tagged <b>[${ASSISTANCE_TAG}]</b>, in time order.
  Select the list and copy it into the email you send the provider. Underneath it,
  everyone who asked to be called if an earlier appointment opens up.
</p>
<div>
  <label>Next
    <select id="days">
      <option value="7">7 days</option>
      <option value="14" selected>14 days</option>
      <option value="30">30 days</option>
      <option value="60">60 days</option>
    </select>
  </label>
  <button id="go" onclick="load()">Show</button>
</div>
<div id="out"><span class="none">Choose a range and press Show.</span></div>
<script>
  function load() {
    document.getElementById('go').disabled = true;
    document.getElementById('out').innerHTML = '<span class="none">Reading the registrations...</span>';
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        document.getElementById('out').innerHTML = '<span class="none">Failed: ' + err.message + '</span>';
      })
      .getAssistanceScheduleData(Number(document.getElementById('days').value));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function render(data) {
    document.getElementById('go').disabled = false;
    var days = (data && data.days) || [];
    var earlier = (data && data.earlier) || [];
    if (days.length === 0) {
      document.getElementById('out').innerHTML =
        '<span class="none">No appointments booked in that range.</span>';
      return;
    }
    var html = '';
    days.forEach(function (d) {
      html += '<div class="day"><h4>' + esc(d.program) + ' &mdash; ' + esc(d.dateLabel) +
        ' (' + esc(d.location) + ')</h4><table><tr><th>Time</th><th>Name</th><th>Phone</th>' +
        '<th>Email</th><th>Details</th></tr>';
      d.people.forEach(function (p) {
        var detail = [p.answers, p.notes].filter(function (x) { return x; }).join(' - ');
        html += '<tr><td class="time">' + esc(p.time) + '</td><td>' + esc(p.name) +
          (p.personType === 'Guest' ? ' (guest)' : '') +
          // The marker is on the provider's list too, because the provider is
          // often the one who knows first that a slot has fallen through.
          (p.earlier ? ' <span class="earlier" title="Would take an earlier appointment">&#9742;</span>' : '') +
          '</td><td>' + esc(p.phone) +
          '</td><td>' + esc(p.email) + '</td><td>' + esc(detail) + '</td></tr>';
      });
      html += '</table></div>';
    });

    html += '<div class="day"><h4>&#9742; Would take an earlier appointment</h4>';
    if (earlier.length === 0) {
      html += '<span class="none">Nobody in this range has asked to be called.</span>';
    } else {
      html += '<p class="hint">Furthest-out booking first — the person with the most to gain from ' +
        'a slot that just opened. Ringing is optional for them: they can always say no.</p>' +
        '<table><tr><th>Booked for</th><th>Time</th><th>Name</th><th>Phone</th><th>Email</th>' +
        '<th>Program</th></tr>';
      earlier.forEach(function (p) {
        html += '<tr><td class="time">' + esc(p.dateLabel) + '</td><td class="time">' + esc(p.time) +
          '</td><td>' + esc(p.name) + '</td><td>' + esc(p.phone) + '</td><td>' + esc(p.email) +
          '</td><td>' + esc(p.program) + ' (' + esc(p.location) + ')</td></tr>';
      });
      html += '</table>';
    }
    html += '</div>';
    document.getElementById('out').innerHTML = html;
  }
</script>`;
}

// ---------------------------------------------------------------------------
// THE QUESTION BUILDER  (the dialog behind "➕ Build a Form Question…")
// ---------------------------------------------------------------------------
//
// WHY A DIALOG WHEN THERE IS ALREADY A TAB. Program_Questions is nine columns
// wide, and four of them only mean something for certain values of a fifth:
// Choices is options, or a Drive link, or a scale range, depending on Type;
// Required means nothing for three of the types; Program, Location and
// Match_Keywords narrow together in a way a spreadsheet cannot show you. The
// tab is the right place to EDIT twenty questions and the wrong place to write
// the first one, and the failure it produces is silent — a row that reaches no
// form, on a tab that looks exactly like a row that reaches every form.
//
// So this asks for one question at a time, shows only the fields that type
// actually uses, runs the same validation the sync runs (readProgramQuestionRow())
// before anything is written, and — the part that a tab genuinely cannot do —
// says WHICH FORMS IT WOULD LAND ON, by name, before you commit to it.

/** Where a picture uploaded through the builder is kept. One folder, so they stay findable. */
const FORM_IMAGE_FOLDER_NAME = 'Form Images';

/**
 * The biggest picture the dialog will take. Not a Drive limit — a
 * google.script.run one: the whole file crosses as a base64 string in one
 * call, and a phone photo straight off a camera roll is the shape that would
 * otherwise fail with a browser error naming nothing.
 */
const FORM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** The folder the builder's uploads go in, made on first use. */
function getOrCreateFormImageFolder() {
  const folders = DriveApp.getFoldersByName(FORM_IMAGE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(FORM_IMAGE_FOLDER_NAME);
  log(`Created Drive folder "${FORM_IMAGE_FOLDER_NAME}" for pictures put on forms.`);
  return folder;
}

/**
 * Called from the builder dialog: takes the picture somebody chose off their
 * own computer, puts it in Drive, and hands back the link the row stores.
 *
 * WHY THE UPLOAD IS HERE AT ALL. The row has always stored a Drive link, and
 * getting one meant: save the photo, open Drive, upload it, find it, Share,
 * Copy link, come back, paste. Six steps outside this workbook to put a
 * picture on a form, every one of them a place to give up. The picture is the
 * whole content of the row; asking somebody to go and file it themselves first
 * is asking them to do the system's job.
 *
 * NOTHING IS SHARED. The form does not read the Drive file — the script fetches
 * its bytes and uploads a copy INTO the form (addImageItem().setImage()), so
 * the file's own permissions never come into it. That is worth knowing: a
 * photo put on a public form is not a Drive file made public.
 *
 * Returns { ok, url, fileId, name, error }.
 */
function uploadFormImage(payload) {
  payload = payload || {};
  const name = String(payload.name || 'form-image').trim() || 'form-image';
  const mimeType = String(payload.mimeType || '').trim();
  if (mimeType.indexOf('image/') !== 0) {
    return { ok: false, error: `That is a ${mimeType || 'file of unknown type'}, not a picture. ` +
      `Choose a JPG, PNG or GIF.` };
  }
  let bytes;
  try {
    bytes = Utilities.base64Decode(String(payload.bytes || ''));
  } catch (err) {
    return { ok: false, error: `That file could not be read (${err}).` };
  }
  if (bytes.length === 0) return { ok: false, error: 'That file is empty.' };
  if (bytes.length > FORM_IMAGE_MAX_BYTES) {
    return { ok: false, error: `That picture is ${Math.round(bytes.length / (1024 * 1024))}MB, and the ` +
      `limit here is ${FORM_IMAGE_MAX_BYTES / (1024 * 1024)}MB. Most phone photos shrink below it if you ` +
      `send them at "medium" size.` };
  }

  try {
    const blob = Utilities.newBlob(bytes, mimeType, name);
    const file = getOrCreateFormImageFolder().createFile(blob);
    log(`Form image uploaded: "${name}" (${file.getId()}).`);
    return { ok: true, url: file.getUrl(), fileId: file.getId(), name };
  } catch (err) {
    log(`⚠️ Could not save the uploaded form image "${name}" (${err}).`);
    return { ok: false, error: `Could not save it to Drive (${err}).` };
  }
}

/** MENU ENTRY: build one form question, see what it would match, then add it. */
function showQuestionBuilderDialog() {
  const html = HtmlService.createHtmlOutput(buildQuestionBuilderHtml({
    programs: listKnownProgramTitles(),
    locations: Object.keys(CALENDAR_MAP).map(k => CALENDAR_MAP[k]).filter(Boolean),
    types: PROGRAM_QUESTION_TYPE_OPTIONS
  })).setWidth(620).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Build a Form Question');
}

/**
 * The row a dialog answer describes, in Program_Questions order.
 *
 * Built here rather than in the browser so the column ORDER lives in exactly
 * one place — HEADERS.Program_Questions — and adding a column later cannot
 * leave the dialog writing values one cell to the left.
 */
function buildQuestionRowFromDialog(answer) {
  const headers = HEADERS.Program_Questions;
  const map = getIndexMap(headers);
  const row = headers.map(() => '');
  const put = (column, value) => { if (map[column] !== undefined) row[map[column]] = value; };
  put('Program', String(answer.program || '').trim() || PROGRAM_QUESTION_ALL_PROGRAMS);
  put('Location', String(answer.location || '').trim() || PROGRAM_QUESTION_ALL_PROGRAMS);
  put('Match_Keywords', String(answer.keywords || '').trim());
  put('Question', String(answer.title || '').trim());
  put('Type', String(answer.type || '').trim() || 'Short answer');
  put('Choices', String(answer.choices || '').trim());
  put('Help_Text', String(answer.help || '').trim());
  put('Required', !!answer.required);
  put('Sort', String(answer.sort || '').trim() === '' ? '' : Number(answer.sort));
  put('Active', true);
  return row;
}

/**
 * Called from the dialog on every keystroke-ish change: what this row would do
 * if it were saved.
 *
 * Returns { ok, error, matches, sample, note } — `matches` counting the LIVE
 * FORMS it would be added to and `sample` naming the first few, which is the
 * one question the tab cannot answer and the one that decides whether the
 * keywords were right.
 */
function previewBuiltQuestion(answer) {
  const map = getIndexMap(HEADERS.Program_Questions);
  const outcome = readProgramQuestionRow(buildQuestionRowFromDialog(answer || {}), map,
    reservedQuestionTitles(), 0);
  if (!outcome) return { ok: false, error: 'Type the question\'s wording first.' };
  if (outcome.error) return { ok: false, error: `${outcome.error}.` };

  const spec = outcome.spec;
  let contexts;
  try {
    contexts = listFormContextsForMatching();
  } catch (err) {
    log(`Question builder: could not list the forms to match against (${err}).`);
    return { ok: true, error: '', matches: -1, sample: [], note: 'Could not read the session table, so ' +
      'this cannot say which forms it would reach. The question itself is fine.' };
  }

  const hits = contexts.filter(context => questionsForFormContext([spec], context).length === 1);
  const sample = hits.slice(0, 6).map(context =>
    `${(context.titles || []).slice(0, 2).join(' + ') || '(untitled)'} — ${describeLocations(context.locations)}`);

  let note = '';
  if (hits.length === 0) {
    note = 'As typed, this reaches NO form. Check the spelling of the program, or use a keyword ' +
      'instead of an exact name.';
  } else if (hits.length === contexts.length && contexts.length > 1) {
    note = 'This reaches EVERY form in the workbook. If that is not what you meant, name a program, ' +
      'a location, or a keyword.';
  }
  if (imageGoesAtTheTop(spec.kind)) {
    note += (note ? ' ' : '') + 'The picture goes at the very top of the form, above the first question.';
  }
  return { ok: true, error: '', matches: hits.length, total: contexts.length, sample, note };
}

/**
 * Every live form as a matching context, once each — what previewBuiltQuestion()
 * tries a candidate row against.
 *
 * The same buildFormSessionContext() the real thing uses, so a preview cannot
 * disagree with what the sync will do half an hour later.
 */
function listFormContextsForMatching() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return [];
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const byForm = groupRegistryRowsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  return Object.keys(byForm)
    .map(formId => buildFormSessionContext(formId, byForm[formId], map, sharedFormIds))
    .filter(context => context.sessions.length > 0);
}

/**
 * Called from the dialog's Add button: validate, append the row to
 * Program_Questions, and (if asked) push it to the forms straight away.
 *
 * APPENDED, NEVER REWRITTEN. The tab is read, the row is added to the end of
 * what was there, and the whole lot is re-rendered — so a question added here
 * cannot disturb one somebody typed by hand, and both are ordered by the same
 * Sort column afterwards.
 */
function saveBuiltQuestion(answer, alsoPush) {
  const map = getIndexMap(HEADERS.Program_Questions);
  const row = buildQuestionRowFromDialog(answer || {});
  const outcome = readProgramQuestionRow(row, map, reservedQuestionTitles(), 0);
  if (!outcome) return '⚠️ Type the question\'s wording first.';
  if (outcome.error) return `⚠️ ${outcome.error}.`;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_QUESTIONS);
  const existing = sheet ? readProgramQuestionRows(sheet) : [];

  // The same duplicate rule the sync applies, said here where it can be acted
  // on rather than in an email after the fact.
  const clash = existing.some(other => {
    const parsed = readProgramQuestionRow(other, map, reservedQuestionTitles(), 0);
    return parsed && parsed.spec && parsed.spec.key === outcome.spec.key;
  });
  if (clash) {
    return `⚠️ "${outcome.title}" is already listed for that program, location and keyword set. ` +
      `Edit the row on the ${SHEET_NAMES.PROGRAM_QUESTIONS} tab instead of adding a second one.`;
  }

  renderProgramQuestionsSheet(existing.concat([row]));
  invalidateProgramQuestionSpecs();
  sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_QUESTIONS);
  if (sheet) ss.setActiveSheet(sheet);

  const where = outcome.spec.program === PROGRAM_QUESTION_ALL_PROGRAMS && !outcome.spec.keywords.length
    ? 'every form' : 'the forms it names';
  if (!alsoPush) {
    return `✅ Added "${outcome.title}" to ${SHEET_NAMES.PROGRAM_QUESTIONS}. It reaches ${where} on the ` +
      `next sync — or press "Update Program Questions on Forms" to do it now.`;
  }

  let pushed;
  try {
    // skipConfirm: the dialog's own button IS the confirmation, and a second
    // "are you sure?" behind a modal that is already open cannot be answered
    // (Apps Script will not show a prompt on top of a modal dialog).
    pushed = pushProgramQuestionsToForms({ skipConfirm: true });
  } catch (err) {
    log(`Question builder: could not push "${outcome.title}" to the forms (${err}).`);
    return `✅ Added "${outcome.title}" to ${SHEET_NAMES.PROGRAM_QUESTIONS}, but the forms could not be ` +
      `updated just now (${err}). The next sync will put it on them.`;
  }
  return `✅ Added "${outcome.title}" and updated the forms — ${pushed} item(s) changed.`;
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildQuestionBuilderHtml(options) {
  const option = (value, label) =>
    `<option value="${escapeHtmlForDialog(value)}">${escapeHtmlForDialog(label === undefined ? value : label)}</option>`;
  const typeTags = (options.types || []).map(t => option(t)).join('\n');
  const programTags = [option(PROGRAM_QUESTION_ALL_PROGRAMS, '* — every program')]
    .concat((options.programs || []).map(p => option(p))).join('\n');
  const locationTags = [option(PROGRAM_QUESTION_ALL_PROGRAMS, '* — every location')]
    .concat((options.locations || []).map(l => option(l))).join('\n');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  label.field { display: block; font-weight: bold; margin-top: 12px; }
  input[type=text], select, textarea { width: 100%; padding: 6px; font-size: 13px;
    box-sizing: border-box; margin-top: 4px; font-family: inherit; }
  textarea { height: 56px; }
  .row { display: flex; gap: 10px; }
  .row > div { flex: 1; }
  .sub { color: #666; font-weight: normal; font-size: 12px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button.secondary { background: #E8EAED; color: #202124; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #match { margin-top: 12px; padding: 8px; background: #F1F3F4; border-radius: 4px; line-height: 1.5;
           min-height: 34px; }
  #match ul { margin: 6px 0 0 18px; padding: 0; }
  #status { margin-top: 10px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Build a form question</h3>
<p class="hint">
  Everything here is written to the <b>${escapeHtmlForDialog(SHEET_NAMES.PROGRAM_QUESTIONS)}</b> tab as one
  row, and re-applied to the forms after every rebuild — unlike a question typed onto a form by hand,
  which the next rebuild deletes.
</p>

<label class="field">What is it?
  <select id="type" onchange="shape(); preview();">${typeTags}</select>
</label>

<label class="field">Wording <span class="sub" id="titleHint">— the question people read</span>
  <input type="text" id="title" oninput="preview()" placeholder="e.g. What is your zip code?">
</label>

<label class="field">Help text <span class="sub" id="helpHint">— the small print under it (optional)</span>
  <textarea id="help" oninput="preview()"></textarea>
</label>

<div id="choicesBlock">
  <label class="field">Choices <span class="sub" id="choicesHint">— one per line</span>
    <textarea id="choices" oninput="preview()"></textarea>
  </label>
</div>

<div id="pictureBlock" style="display:none;">
  <label class="field">Picture
    <span class="sub">— choose it here and it is uploaded for you</span>
    <input type="file" id="picker" accept="image/*" onchange="uploadPicture()">
  </label>
  <div id="pictureState" class="sub" style="margin-top:6px;">No picture chosen yet.</div>
  <img id="picturePreview" style="display:none;max-width:100%;margin-top:8px;border-radius:4px;">
  <label class="field">…or paste a Google Drive link
    <input type="text" id="pictureLink" oninput="preview()" placeholder="https://drive.google.com/file/d/…">
  </label>
</div>

<div class="row">
  <div>
    <label class="field">Program
      <select id="program" onchange="preview()">${programTags}</select>
    </label>
  </div>
  <div>
    <label class="field">Location
      <select id="location" onchange="preview()">${locationTags}</select>
    </label>
  </div>
</div>

<label class="field">Keywords <span class="sub">— or match by word instead: "wills", "zoom", "club"</span>
  <input type="text" id="keywords" oninput="preview()" placeholder="one per line, or separated by | or ,">
</label>

<div class="row">
  <div>
    <label class="field">Order <span class="sub">(optional)</span>
      <input type="text" id="sort" oninput="preview()" placeholder="1">
    </label>
  </div>
  <div>
    <label class="field" id="requiredBlock">Answer required?
      <select id="required" onchange="preview()">
        <option value="">No</option>
        <option value="yes">Yes</option>
      </select>
    </label>
  </div>
</div>

<div id="match">Fill in the wording to see which forms this would reach.</div>

<button id="add" onclick="save(true)">Add it and update the forms now</button>
<button class="secondary" onclick="save(false)">Add it to the tab only</button>
<div id="status"></div>

<script>
  var DISPLAY_ONLY = ['Notice', 'Image', 'Header image', 'Form description'];
  var NO_CHOICES = ['Short answer', 'Paragraph', 'Notice', 'Form description', 'Date', 'Time'];
  var PICTURE = ['Image', 'Header image'];

  function val(id) { return document.getElementById(id).value; }

  function answer() {
    // A picture row stores its Drive link in the SAME column the choice types
    // store their options in — see the Choices column on Program_Questions —
    // so the two inputs feed one field rather than the row growing a tenth.
    var isPicture = PICTURE.indexOf(val('type')) !== -1;
    return {
      type: val('type'), title: val('title'), help: val('help'),
      choices: isPicture ? val('pictureLink') : val('choices'),
      program: val('program'), location: val('location'), keywords: val('keywords'),
      sort: val('sort'), required: val('required') === 'yes'
    };
  }

  // The file is read in the browser and crosses as base64 — google.script.run
  // cannot carry a File object. Everything about the outcome is said in
  // #pictureState, because a silent failure here leaves somebody looking at a
  // picture they believe is attached and a row that has nothing in it.
  function uploadPicture() {
    var file = document.getElementById('picker').files[0];
    if (!file) return;
    state('Uploading “' + file.name + '”…');
    var reader = new FileReader();
    reader.onerror = function () { state('That file could not be read.'); };
    reader.onload = function () {
      var base64 = String(reader.result).split(',')[1] || '';
      google.script.run
        .withSuccessHandler(function (res) {
          if (!res || !res.ok) { state(res && res.error ? res.error : 'Upload failed.'); return; }
          document.getElementById('pictureLink').value = res.url;
          var img = document.getElementById('picturePreview');
          img.src = String(reader.result);
          img.style.display = 'block';
          state('“' + res.name + '” uploaded ✓ — it is saved in your Drive under “Form Images”.');
          if (!val('title')) {
            document.getElementById('title').value = res.name.replace(/\\.[a-z0-9]+$/i, '');
          }
          preview();
        })
        .withFailureHandler(function (err) { state('Upload failed: ' + err.message); })
        .uploadFormImage({ name: file.name, mimeType: file.type, bytes: base64 });
    };
    reader.readAsDataURL(file);
  }

  function state(text) { document.getElementById('pictureState').textContent = text; }

  // Only the fields this type actually uses. The tab cannot do this, and it is
  // where most of the confusion about Choices comes from.
  function shape() {
    var type = val('type');
    var display = DISPLAY_ONLY.indexOf(type) !== -1;
    var picture = PICTURE.indexOf(type) !== -1;
    document.getElementById('requiredBlock').style.display = display ? 'none' : 'block';
    document.getElementById('pictureBlock').style.display = picture ? 'block' : 'none';
    document.getElementById('choicesBlock').style.display =
      (!picture && NO_CHOICES.indexOf(type) === -1) ? 'block' : 'none';

    var titleHint = '— the question people read';
    var helpHint = '— the small print under it (optional)';
    var choicesHint = '— one per line';
    if (type === 'Notice') {
      titleHint = '— the bold heading ("Please note")';
      helpHint = '— the wording itself. This is the part people read.';
    } else if (type === 'Form description') {
      titleHint = '— a name for this rule (not shown on the form)';
      helpHint = '— the wording added to the top of the form. This is what people read.';
    } else if (type === 'Image') {
      titleHint = '— the caption under the picture';
    } else if (type === 'Header image') {
      titleHint = '— the caption. The picture goes at the very top of the form';
    } else if (type === 'Scale') {
      choicesHint = '— range and end labels: 1-5 | Not at all | Very much';
    }
    document.getElementById('titleHint').textContent = titleHint;
    document.getElementById('helpHint').textContent = helpHint;
    document.getElementById('choicesHint').textContent = choicesHint;
  }

  var pending = null;
  function preview() {
    if (pending) window.clearTimeout(pending);
    // Unhurried on purpose: each preview reads the whole session table server
    // side, and the answer only changes when the program, location, keywords
    // or type do — not on every letter of the wording.
    pending = window.setTimeout(runPreview, 800);
  }

  function runPreview() {
    if (!val('title')) {
      show('Fill in the wording to see which forms this would reach.');
      return;
    }
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function (err) { show('Could not check this: ' + err.message); })
      .previewBuiltQuestion(answer());
  }

  function render(result) {
    if (!result.ok) { show('<span class="err">' + esc(result.error) + '</span>'); return; }
    var html;
    if (result.matches < 0) {
      html = esc(result.note);
    } else {
      html = '<b>' + result.matches + ' of ' + result.total + ' form(s)</b> would be asked this.';
      if (result.sample && result.sample.length) {
        html += '<ul><li>' + result.sample.map(esc).join('</li><li>') + '</li></ul>';
      }
      if (result.note) html += '<div style="margin-top:6px;">' + esc(result.note) + '</div>';
    }
    show(html);
  }

  function save(alsoPush) {
    document.getElementById('add').disabled = true;
    say('Working…', '');
    google.script.run
      .withSuccessHandler(function (message) {
        document.getElementById('add').disabled = false;
        say(message, message.indexOf('⚠') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('add').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .saveBuiltQuestion(answer(), alsoPush);
  }

  function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function show(html) { document.getElementById('match').innerHTML = html; }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
  shape();
</script>`;
}


/**
 * Menu action: push the current Program_Questions tab onto every live form now,
 * rather than waiting for the next calendar sync.
 *
 * The tab is where staff work, and the gap between typing a question and
 * seeing it on the form is exactly where they conclude it did not work and try
 * again by hand on the form itself — which is the failure this whole feature
 * exists to prevent.
 *
 * BOTH KINDS OF ROW GO. The tab holds questions (items on the form) and "Form
 * description" rows (wording above the first question), and this used to push
 * only the first kind — so the one row somebody could type, press the button
 * for, and watch do nothing was the description. See the comment in the loop.
 */
function pushProgramQuestionsToForms(options) {
  options = options || {};
  // skipConfirm is for a caller that has ALREADY asked — the question builder
  // dialog, whose own button is the confirmation. Apps Script cannot show a
  // prompt on top of an open modal, so asking again there is not a second
  // safeguard, it is a dialog that appears to hang.
  if (!options.skipConfirm && !confirmConsequentialAction('Update the registration forms now?',
    `Every question on "${SHEET_NAMES.PROGRAM_QUESTIONS}" is added to the forms it names, and any ` +
    `question this system added before but which is no longer listed is removed from them.\n\n` +
    `Answers already collected are never changed.`, true)) {
    return 0;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const byForm = groupRegistryRowsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  invalidateProgramQuestionSpecs(); // the whole point of this menu item is to re-read the tab
  const specs = getProgramQuestionSpecs();
  const applied = getAppliedCustomQuestions();

  let changed = 0;
  let forms = 0;
  Object.keys(byForm).forEach(formId => {
    const context = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
    if (context.sessions.length === 0) return;
    const wanted = questionsForFormContext(specs, context);
    const before = applied[formId];
    // Nothing wanted and nothing ever applied — no questions AND no wording —
    // is the one case with no reason to open the form. The description half
    // has to be in this test as well as the titles: a form whose only custom
    // row was a "Form description" that has since been deleted still carries
    // that wording, and skipping it here would leave it there forever.
    const everApplied = !!before &&
      (((before.titles || []).length > 0) || !!String(before.description || ''));
    if (wanted.length === 0 && !everApplied) return;
    try {
      const form = openFormCached(formId);
      let n = syncCustomQuestionsOnForm(form, context, wanted);
      // THE DESCRIPTION ROWS ARE NOT ITEMS, and this menu item used to push
      // only items. syncCustomQuestionsOnForm() filters every "Form
      // description" row out (they belong above the first question, not among
      // them) and fingerprints what is left — so a run whose ONLY change was a
      // description row saw an unchanged fingerprint, wrote nothing, and said
      // "the forms already match the question list", which is the exact
      // opposite of what had just happened. The wording is pushed here, by the
      // same function the hourly sync uses, so the tab and the forms agree
      // whichever one gets there first.
      n += syncDescriptionInjectionsOnForm(form, context, wanted);
      if (n > 0) { changed += n; forms++; }
    } catch (err) {
      log(`Could not update the questions on form ${formId} (${err}).`);
      noteForAdmin('Program questions not added', `Form ${formId} — ${err}`);
    }
  });

  flushAdminDigest('Program questions');
  const message = changed === 0
    ? 'The forms already match the question list — nothing to change.'
    : `Updated ${forms} form(s) — ${changed} question(s) or description(s) added, changed or removed.`;
  toastIfPossible(message);
  log(`pushProgramQuestionsToForms: ${message}`);
  return changed;
}


