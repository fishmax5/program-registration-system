// ============================================================================
// 6g. PERSONALIZED ASSISTANCE + PER-PROGRAM QUESTIONS
// ============================================================================
//
// Two features that arrived together because they are the same complaint from
// two directions: the one registration template cannot describe every program
// this center runs.
//
//   [Personalized Assistance]  a program registered for by TIME, not by date —
//                              see ASSISTANCE_TAG for what the tag changes.
//   Program_Questions          extra questions a single program needs asked,
//                              added to its form without the parser, the
//                              template migration, or Registrant_Dash's shape
//                              having to change — see HEADERS.Program_Questions.
//
// THE RULE BOTH OBEY: nothing here may make an EXISTING answer mean something
// different. Extra questions get a title of their own (refused if it collides
// with a template one), a column of their own (Form_Answers, one string of
// "Question: answer" pairs), and a page position that no lookup depends on.
// The appointment question replaces the roster grids only on forms whose
// sessions actually say Personalized_Assistance, and processFormResponse()
// decides which of the two shapes it is reading from the FORM ITSELF rather
// than from a flag it has to be told — a form carrying the time question is an
// appointment form, and nothing else is.
// ============================================================================

/** Minutes per appointment for a group or a form context, with the bracket and the default reconciled. */
function resolveSlotMinutes(source) {
  const stated = Number((source && source.slotMinutes) || 0);
  if (stated >= MIN_APPOINTMENT_SLOT_MINUTES && stated <= MAX_APPOINTMENT_SLOT_MINUTES) return stated;
  return APPOINTMENT_SLOT_MINUTES;
}

/**
 * Cuts one event's span into back-to-back appointments of `minutes` each:
 * [{ start, end, startLabel, rangeLabel }], earliest first.
 *
 * BACK-TO-BACK IS THE WHOLE POINT (see ASSISTANCE_TAG): the slots tile the
 * span with no gaps, the form offers them in this order, and a booked one is
 * simply dropped — so the day fills from the front without anybody having to
 * police it.
 *
 * A partial slot at the end is NOT offered. Half an appointment is not an
 * appointment, and offering one books somebody into fifteen minutes of a
 * thirty-minute consultation.
 *
 * An event with no usable end time yields ONE slot at its start: that is what
 * a calendar event with no duration means, and it keeps such a program
 * bookable (as a single appointment) instead of silently offering nothing.
 */
function buildAppointmentSlots(startTime, endTime, minutes) {
  const start = coerceDate(startTime);
  if (!start) return [];
  const slotMs = Math.max(MIN_APPOINTMENT_SLOT_MINUTES, Number(minutes) || APPOINTMENT_SLOT_MINUTES) * 60 * 1000;
  // An end stored as a bare clock time reads back dated to 1899 and would
  // otherwise fall EARLIER than its own session, collapsing an afternoon of
  // appointments into a single slot. See clockTimeOnDayOf().
  const end = clockTimeOnDayOf(coerceDate(endTime), start);

  const slots = [];
  const push = (from, to) => slots.push({
    start: from,
    end: to,
    startLabel: formatTimeLabel(from),
    rangeLabel: formatTimeRange(from, to)
  });

  if (!end || end <= start) {
    push(start, new Date(start.getTime() + slotMs));
    return slots;
  }

  // Bounded for the same reason "[Slots: 3]" is rejected: an all-day event
  // that slipped through, or a wildly wrong slot length, must not produce a
  // list of two hundred choices on a public form.
  const MAX_SLOTS_PER_SESSION = 48;
  let cursor = start.getTime();
  while (cursor + slotMs <= end.getTime() && slots.length < MAX_SLOTS_PER_SESSION) {
    push(new Date(cursor), new Date(cursor + slotMs));
    cursor += slotMs;
  }
  // A span shorter than one slot is still one appointment — a 20-minute event
  // with 30-minute slots is somebody's calendar being approximate, not a
  // program with no capacity.
  if (slots.length === 0) push(start, end);
  return slots;
}

/**
 * How many people ONE appointment session holds: one per slot
 * (APPOINTMENT_SLOT_CAPACITY), which for a session is simply its slot count.
 *
 * A "[Cap: N]" typed on the event still wins where it can, because it says
 * something the arithmetic cannot know — a provider keeping the last half hour
 * free books six appointments in an eight-slot afternoon. What it cannot do is
 * raise the number: a slot holds one person, so a cap ABOVE the slot count
 * describes chairs that do not exist, and honouring it would let the form take
 * registrations for times it has no times for. Those are clamped and logged,
 * once, where somebody can see why the number on the sheet is not the number
 * they typed.
 */
function resolveAppointmentCapacity(statedCapacity, slotCount, title) {
  const seats = Math.max(0, Number(slotCount) || 0) * APPOINTMENT_SLOT_CAPACITY;
  const stated = Number(statedCapacity) || 0;
  if (stated <= 0) return seats;
  // "[Cap: 1]" ON AN APPOINTMENT PROGRAM MEANS ONE PERSON PER APPOINTMENT.
  //
  // It is the number staff reach for to say what these programs ARE — one
  // visitor at a time with the provider — and read as a SESSION cap it says
  // the opposite of what they meant: an afternoon holding six appointments
  // went 🔴 Waitlist Only after the first booking, and the form stamped
  // "(FULL - Waitlist)" on a date with five free times on it. Nobody typing
  // it on a one-to-one program has ever meant "of the six appointments this
  // afternoon, sell one".
  //
  // So on a session with room for more than one, a stated cap of exactly
  // APPOINTMENT_SLOT_CAPACITY is read as the per-slot statement it is, and
  // the session's capacity is its slot count — the same answer as leaving the
  // tag off. Any HIGHER number is still a session cap ("six of the eight
  // slots this afternoon"), which is the only thing a number above one can
  // usefully mean here. A genuine "see one person and no more today" is said
  // by making the session hold one slot — shorten the event, or [Slots: N] to
  // its full length — which is also what the form has to show either way.
  if (stated === APPOINTMENT_SLOT_CAPACITY && seats > APPOINTMENT_SLOT_CAPACITY) {
    log(`ℹ️ "[Cap: ${stated}]" on "${title}" reads as one person per APPOINTMENT, not one per session — ` +
      `that session holds ${seats} appointment(s), so it takes ${seats}. To offer fewer, shorten the ` +
      `event or say "[Cap: ${seats - 1}]" or lower.`);
    return seats;
  }
  if (seats > 0 && stated > seats) {
    log(`ℹ️ "[Cap: ${stated}]" on "${title}" asks for more people than the ${seats} appointment(s) that fit in ` +
      `the session — an appointment slot holds ${APPOINTMENT_SLOT_CAPACITY}. Using ${seats}.`);
    return seats;
  }
  return stated;
}

/** "Mon, Oct 13, 2026 · Narberth @ 10:30 AM" — one choice on the time question. */
function appointmentChoiceLabel(sessionLabel, slotStartLabel) {
  return `${sessionLabel}${APPOINTMENT_TIME_SEPARATOR}${slotStartLabel}`;
}

/**
 * The inverse: { sessionLabel, slotStartLabel } for a chosen value, or null
 * for ASSISTANCE_NO_TIME_CHOICE and anything else unparseable.
 *
 * Split on the LAST separator, not the first — a program called "Coffee @ 10"
 * is not impossible, and the time is always what comes after the final one.
 */
function parseAppointmentChoice(value) {
  const text = String(value || '').trim();
  if (!text || text === ASSISTANCE_NO_TIME_CHOICE) return null;
  const at = text.lastIndexOf(APPOINTMENT_TIME_SEPARATOR);
  if (at <= 0) return null;
  return {
    sessionLabel: text.substring(0, at).trim(),
    slotStartLabel: text.substring(at + APPOINTMENT_TIME_SEPARATOR.length).trim()
  };
}

/**
 * The start time out of an Event_Time cell ("10:30 AM – 11:00 AM" -> "10:30 AM"),
 * which is what a booked slot is matched on. The range is what staff read; the
 * start is what identifies the slot.
 */
function appointmentStartLabelOf(eventTime) {
  // eventTimeLabelOf() rather than String(): a cell Sheets has coerced into a
  // time value reads back as a Date, and String()ing that gives "Sat Dec 30
  // 1899 10:00:00 GMT-0500" — which matches no slot, so the booked chair
  // silently reads as free.
  const text = eventTimeLabelOf(eventTime);
  if (!text) return '';
  return text.split('–')[0].split(' - ')[0].trim();
}

/**
 * { Event_ID: Set(slot start label) } for every appointment already held by a
 * LIVE registration. Cancelled and Superseded rows release their slot, which
 * is the only sensible reading: staff cancel a row precisely so somebody else
 * can have that time.
 */
function readBookedAppointmentTimes(registrantRows) {
  const map = getIndexMap(HEADERS.Registrant_Dash);
  const booked = {};
  (registrantRows || []).forEach(row => {
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    const startLabel = appointmentStartLabelOf(row[map['Event_Time']]);
    if (!eventId || !startLabel) return;
    if (!booked[eventId]) booked[eventId] = new Set();
    booked[eventId].add(startLabel);
  });
  return booked;
}

/**
 * The choices for one form's time question: every FREE slot on every upcoming
 * assistance session it covers, earliest first, with the "no time works" escape
 * hatch last.
 *
 * PAST SESSIONS ARE LEFT OUT for the same reason a full one is: offering a
 * time nobody can take is how a form collects registrations staff then have to
 * unpick by hand.
 */
function buildAppointmentChoicesForContext(context, booked) {
  const choices = [];
  const now = new Date();
  const taken = booked || {};
  (context.sessions || []).forEach(session => {
    if (!session.date || session.date < now) return;
    const label = formatSessionLabel(session.date, session.location, context.showLocation,
      session.title, context.showTitle);
    const used = taken[session.eventId] || new Set();
    buildAppointmentSlots(session.date, session.end, resolveSlotMinutes(session)).forEach(slot => {
      if (used.has(slot.startLabel)) return;
      choices.push(appointmentChoiceLabel(label, slot.startLabel));
    });
  });
  // Always offered, even when every slot is taken — especially then. See
  // ASSISTANCE_NO_TIME_CHOICE.
  choices.push(ASSISTANCE_NO_TIME_CHOICE);
  // DEDUPED, because two rows can legitimately be the same session. A day
  // still typed as one calendar event per appointment writes one row per
  // block, all carrying the SAME Event_ID (computeEventId() has no time in
  // it) — and once applySessionTimesToRows() has grown the first of them over
  // the whole run, its slots cover the times the other rows repeat. Offering
  // "Tue, Sep 8 · Narberth @ 1:00 PM" twice on one list is a choice nobody
  // can answer meaningfully and a response nothing could resolve back to one
  // chair.
  return dedupePreservingOrder(choices);
}

/** What the mode page is retitled to on an appointment form — it no longer asks about modes. */
const APPOINTMENT_PAGE_TITLE = 'Choose Your Appointment';

/**
 * Reshapes a live form into (or keeps it as) an APPOINTMENT form: the roster
 * grids, the all-dates lunch question and the sign-up-mode question come off,
 * one required time question goes on, and the mode page is re-pointed straight
 * at the closing questions.
 *
 * Returns the number of structural changes made, so a caller knows whether the
 * date-label fingerprint needs forcing.
 *
 * IDEMPOTENT: it runs on every sync for every assistance form, and after the
 * first pass finds nothing to delete, nothing to re-point, and — unless the
 * free slots actually changed — nothing to write to the time question either.
 *
 * TAKING THE TAG OFF IS NOT HANDLED HERE. A form left without its grids is not
 * on the current template by isFormOnCurrentTemplate()'s reckoning, so the
 * ordinary migration sweep rebuilds it back into a date-based form on the next
 * sync. One reversal path, already tested, rather than a second inverse of
 * this function that would have to be kept in step with it forever.
 */
function syncAssistanceQuestionsOnForm(form, context, choices) {
  let changed = 0;
  const items = form.getItems();
  const byTitle = title => items.filter(it => it.getTitle() === title &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK);
  const pageOf = title => items.filter(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === title)[0] || null;

  // 1. The date-based questions, which an appointment form has no use for.
  //    Lunch is included: a counseling appointment is not a meal, and asking
  //    orders one.
  const doomed = findRosterGridItems(items)
    .concat(byTitle(TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID))
    .concat(byTitle(TEMPLATE_ITEM_TITLES.ALL_DATES_MEAL_COUNT))
    // The pre-v9 pair as well, for a form that has not been rebuilt yet.
    .concat(byTitle(TEMPLATE_ITEM_TITLES.LUNCH_GRID))
    .concat(byTitle(TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE))
    .concat(byTitle(TEMPLATE_ITEM_TITLES.ALLERGIES))
    .concat(byTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE));
  changed += deleteFormItems(form, doomed, `the appointment form ${form.getId()}`);

  // 2. The mode page now holds the time question and nothing else, so it says
  //    so — and flows straight into the closing questions rather than through
  //    the (now empty) every-date branch.
  // Found under all three titles it can be carrying: the template's own, this
  // function's, and the one a form covering a single session was retitled to
  // (section 1g). Missing the third would have appended the time question to
  // the END of a form that used to have one date — past the closing questions,
  // on whichever branch page happened to be last — instead of onto its page.
  const modePage = pageOf(TEMPLATE_PAGE_TITLES.MODE) || pageOf(APPOINTMENT_PAGE_TITLE) ||
    pageOf(TEMPLATE_PAGE_TITLES.SINGLE_DATE);
  const specificPage = pageOf(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  if (modePage) {
    if (modePage.getTitle() !== APPOINTMENT_PAGE_TITLE) {
      modePage.asPageBreakItem().setTitle(APPOINTMENT_PAGE_TITLE);
      changed++;
    }
    if (specificPage) {
      // THROUGH setNavigationAfterPage(), for both of the reasons that
      // function exists. It puts the setting on the break Forms reads a
      // section's EXIT off — the next one down — where the obvious spelling,
      // modePage.setGoToPage(specificPage), set the transition INTO the
      // appointment page instead and left its exit on the every-date page's
      // SUBMIT: an appointment form ended the moment somebody picked a time,
      // before "Anything Else?" and before any Program_Questions question. And
      // it does its own read without a try/catch around the write, where the
      // read here — getGoToPage() on a break that has never been given a page
      // target THROWS rather than answering null — took the write down with it
      // on every form built straight from the template.
      //
      // It also skips an identical write, which matters: this runs on every
      // sync for every assistance form, and re-asserting navigation that never
      // changed is a Forms round trip and a new form revision an hour.
      try {
        changed += setNavigationAfterPage(form, modePage, specificPage);
      } catch (err) {
        log(`Could not re-point the appointment page of form ${form.getId()} (${err}).`);
      }
    }
  }

  // 3. The time question itself, created on the appointment page if it isn't
  //    there yet and re-stocked with whatever is still free.
  changed += applyAppointmentChoices(form, context, choices, modePage);
  // 4. And, directly under it, whether they would take an earlier one.
  changed += applyEarlierAppointmentQuestion(form);
  // 5. And, under that, lunch — but only where lunch is actually served on
  //    one of this form's days. Step 1 above deleted the two roster grids and
  //    syncLunchQuestionsOnForm() takes the all-dates meal count off every
  //    appointment form, so this yes/no is the
  //    only lunch question such a form carries and there is nothing here for
  //    the two passes to fight over.
  changed += applyAppointmentLunchQuestion(form,
    formWantsLunchQuestions(context.locations, contextHasLunchDates(context)));
  if (changed > 0) invalidateFormItemIndex(form.getId());
  return changed;
}

/**
 * Adds (or leaves alone) the "would you take an earlier appointment?" question,
 * directly under the time question it qualifies.
 *
 * OPTIONAL ON PURPOSE. It is a courtesy question — the form's job is to book
 * the appointment, and a required extra step between somebody and that booking
 * is a step some of them will abandon on. An unanswered question means "no",
 * which is the safe reading: see EARLIER_APPOINTMENT_CHOICES.
 *
 * Idempotent, like everything else this file writes to a live form: once the
 * question is there with the right choices, this costs one comparison and no
 * Forms write at all.
 */
function applyEarlierAppointmentQuestion(form) {
  const wanted = [EARLIER_APPOINTMENT_CHOICES.YES, EARLIER_APPOINTMENT_CHOICES.NO];
  const helpText = 'Optional. Answer "yes" and we will telephone you if a cancellation frees up a ' +
    'sooner appointment — you can always say no when we ring. Leave it blank and we will keep the ' +
    'time you picked.';
  const items = form.getItems();
  const existing = items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.EARLIER_APPOINTMENT &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK)[0] || null;

  if (existing) {
    try {
      const list = existing.asMultipleChoiceItem();
      const current = list.getChoices().map(c => c.getValue());
      if (current.length === wanted.length && current.every((v, i) => v === wanted[i]) &&
        String(list.getHelpText() || '') === helpText) {
        return 0;
      }
      list.setChoiceValues(wanted);
      list.setHelpText(helpText);
      return 1;
    } catch (err) {
      // Unreadable, or somehow the wrong item type — fall through and rebuild
      // it below rather than leaving a question nobody can answer.
      try { form.deleteItem(existing); } catch (delErr) { return 0; }
    }
  }

  const item = form.addMultipleChoiceItem()
    .setTitle(TEMPLATE_ITEM_TITLES.EARLIER_APPOINTMENT)
    .setHelpText(helpText)
    .setChoiceValues(wanted)
    .setRequired(false);
  // UNDER THE TIME QUESTION, which is the only place it makes sense: it is a
  // qualifier on the answer directly above it. Appended at the end if that
  // question cannot be found — still asked, just further down.
  const timeItem = form.getItems().filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.APPOINTMENT &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK)[0] || null;
  if (timeItem) {
    try {
      form.moveItem(item.getIndex(), timeItem.getIndex() + 1);
    } catch (err) {
      log(`Added the earlier-appointment question to form ${form.getId()} but could not move it ` +
        `under the time question (${err}) — it is still asked, at the end.`);
    }
  }
  return 1;
}

/**
 * Writes the free-slot choices onto the time question, creating it (directly
 * after the appointment page break) if the form hasn't got one.
 *
 * SKIPS AN IDENTICAL WRITE, exactly like applyAttendanceModeChoices(): this
 * runs on every registration sync for every assistance form, and a Forms write
 * is a remote round trip AND a new revision in the form's history. The common
 * case — nobody booked anything in the last hour — costs one comparison.
 */
function applyAppointmentChoices(form, context, choices, modePage) {
  const wanted = (choices && choices.length > 0) ? choices : [ASSISTANCE_NO_TIME_CHOICE];
  const existing = form.getItems().filter(it =>
    it.getTitle() === TEMPLATE_ITEM_TITLES.APPOINTMENT &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK)[0] || null;

  const helpText = wanted.length > 1
    ? 'Appointments are one person at a time. Times already taken are not listed — pick any time shown. ' +
      'If none of them work, choose the last option and we will call you.'
    : 'Every appointment on this form is taken. Choose the option below and we will contact you ' +
      'about another time.';

  if (existing) {
    const list = existing.asListItem();
    try {
      const current = list.getChoices().map(c => c.getValue());
      const same = current.length === wanted.length && current.every((v, i) => v === wanted[i]) &&
        String(list.getHelpText() || '') === helpText;
      if (same) return 0;
    } catch (err) {
      // Unreadable choices — fall through and write them fresh.
    }
    list.setChoiceValues(wanted);
    list.setHelpText(helpText);
    list.setRequired(true);
    return 1;
  }

  const item = form.addListItem()
    .setTitle(TEMPLATE_ITEM_TITLES.APPOINTMENT)
    .setHelpText(helpText)
    .setChoiceValues(wanted)
    .setRequired(true);
  // Created at the end of the form; it belongs on the appointment page, which
  // is the section a respondent reaches after naming their guests.
  if (modePage) {
    try {
      form.moveItem(item.getIndex(), modePage.getIndex() + 1);
    } catch (err) {
      log(`Added the time question to form ${form.getId()} but could not move it onto the ` +
        `appointment page (${err}) — it is still asked, at the end.`);
    }
  }
  return 1;
}


