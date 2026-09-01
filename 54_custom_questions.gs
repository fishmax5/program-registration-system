/**
 * What custom questions this script last put on each form:
 * { formId: { fingerprint, titles: [...] } }.
 *
 * The TITLES half is what makes removal possible at all — an item on a form is
 * just an item, with nothing marking it as ours, so the only way to know that
 * "Zip Code" is a question we added (and should now take off, because its row
 * was deleted) rather than one staff added by hand is to have written down
 * that we added it. The FINGERPRINT half is what makes the steady state free:
 * unchanged questions cost one property read and no Forms call at all.
 */
const CUSTOM_QUESTIONS_PROP_KEY = 'CUSTOM_FORM_QUESTIONS_V1';

function getAppliedCustomQuestions() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(CUSTOM_QUESTIONS_PROP_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function saveAppliedCustomQuestions(all) {
  PropertiesService.getScriptProperties().setProperty(CUSTOM_QUESTIONS_PROP_KEY, JSON.stringify(all || {}));
}

/** Forgets what we applied to one form — called when a rebuild has just deleted every item on it. */
function forgetAppliedCustomQuestions(formId) {
  const all = getAppliedCustomQuestions();
  if (!all[formId]) return;
  delete all[formId];
  saveAppliedCustomQuestions(all);
}

/** Every custom-question title currently applied to one form. Used to keep them out of the notes parser. */
function appliedCustomQuestionTitles(formId) {
  const entry = getAppliedCustomQuestions()[formId];
  return (entry && Array.isArray(entry.titles)) ? entry.titles : [];
}

/** A cheap hash of exactly what would be written, so an unchanged set costs no Forms calls. */
function computeCustomQuestionFingerprint(specs) {
  const payload = (specs || []).map(s =>
    [s.title, s.kind, s.required ? 1 : 0, s.help, (s.choices || []).join('~'),
      s.imageFileId || '',
      // The scale's shape is not in `choices` (it is parsed out of the same
      // cell into its own object), so without this a 1-5 rating retyped as
      // 0-10 hashed identically and never reached the form.
      s.scale ? `${s.scale.lower}-${s.scale.upper}:${s.scale.lowerLabel}:${s.scale.upperLabel}` : ''
    ].join('|')).join('||');
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, payload, Utilities.Charset.UTF_8));
}

/**
 * Puts a program's extra questions on its form, takes off the ones that are no
 * longer asked for, and leaves everything else alone. Returns the number of
 * items added or removed.
 *
 * WHERE THEY GO: immediately before the "Anything Else?" question, on EVERY
 * page that has one — which is both branch pages of an ordinary form, and the
 * one reachable branch of an appointment form. A respondent therefore meets
 * them whichever way they sign up, and getResponseValueByTitle() already knows
 * how to read a title that appears on several pages (it returns the instance
 * that was actually part of this respondent's path).
 *
 * WHAT IT DELIBERATELY DOES NOT DO: add a page break, renumber anything, or
 * touch a template item. Those are the three ways an added question could
 * change how an existing one is read, and none of them is needed to ask
 * somebody for their zip code.
 */
function syncCustomQuestionsOnForm(form, context, specs, options) {
  options = options || {};
  const formId = form.getId();
  // THE DESCRIPTION ROWS ARE NOT ITEMS. They are handled by
  // syncDescriptionInjectionsOnForm(), and letting them through here would put
  // a section header on the form saying the same thing twice.
  const wanted = (specs || []).filter(spec => !questionTypeIsDescription(spec.kind));
  const fingerprint = computeCustomQuestionFingerprint(wanted);
  const applied = getAppliedCustomQuestions()[formId] || { fingerprint: '', titles: [] };
  if (!options.force && applied.fingerprint === fingerprint) return 0;

  const wantedTitles = wanted.map(s => s.title);
  let changed = 0;

  // 1. Retire what is no longer asked for. Only titles WE recorded are ever
  //    deleted — a question staff typed onto the form by hand is not ours to
  //    remove, however much it looks like one of ours.
  const stale = (applied.titles || []).filter(t => wantedTitles.indexOf(t) === -1);
  if (stale.length > 0) {
    const staleSet = new Set(stale);
    changed += deleteFormItems(form,
      form.getItems().filter(it => staleSet.has(it.getTitle())),
      `form ${formId} (question no longer on ${SHEET_NAMES.PROGRAM_QUESTIONS})`);
  }

  // 2. Add what is missing, in order, before each "Anything Else?".
  //    The item list is re-read for every insertion: a move renumbers
  //    everything after it, and a stale index puts a question on the wrong
  //    page. This only runs when the questions actually changed, so the cost
  //    is paid once per edit rather than once per sync.
  wanted.forEach(spec => {
    const items = form.getItems();
    const anchors = items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES);
    // ONE COPY OF A HEADER IMAGE, WHATEVER THE PAGE COUNT. Every other custom
    // row is repeated on both branch pages so a respondent meets it whichever
    // way they sign up; a picture at the top of the form is at the top of the
    // form, once. See imageGoesAtTheTop().
    const wantedCopies = imageGoesAtTheTop(spec.kind) ? 1 : Math.max(1, anchors.length);
    const existing = items.filter(it => it.getTitle() === spec.title);
    if (existing.length === wantedCopies) return; // already on every page it belongs on

    // ALL OR NOTHING PER QUESTION. A partial set — on one branch page but not
    // the other — cannot be repaired by adding the difference, because there
    // is no cheap way to tell WHICH page the existing copy is on, and guessing
    // wrong leaves two copies on one page and none on the other. Clearing and
    // re-adding is a handful of extra calls on a path that only runs when the
    // questions actually changed.
    if (existing.length > 0) {
      changed += deleteFormItems(form, existing, `form ${formId} (re-placing "${spec.title}")`);
    }
    for (let n = 0; n < wantedCopies; n++) {
      const item = addCustomQuestionItem(form, spec);
      if (!item) break;
      changed++;
      try {
        // INDEX 0 for a header image — the whole point of it is to be the
        // first thing on the page, above the first question. Everything else
        // is re-read and moved to an anchor's CURRENT index, which puts it
        // immediately before that anchor.
        if (imageGoesAtTheTop(spec.kind)) {
          form.moveItem(item.getIndex(), 0);
        } else {
          const fresh = form.getItems().filter(it =>
            it.getTitle() === TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES);
          const at = fresh[n] || fresh[fresh.length - 1];
          if (at) form.moveItem(item.getIndex(), at.getIndex());
        }
      } catch (err) {
        log(`Added "${spec.title}" to form ${formId} but could not position it (${err}) — ` +
          `it is asked at the end of the form instead.`);
      }
    }
  });

  // RE-READ rather than reused: the map was read at the top of this function
  // and adding a dozen items to a form is slow enough that another pass in the
  // same execution may have recorded against a different form since. Merged so
  // the description block recorded by syncDescriptionInjectionsOnForm() is not
  // dropped by a question sync that knows nothing about it.
  const store = getAppliedCustomQuestions();
  store[formId] = Object.assign({}, store[formId], { fingerprint, titles: wantedTitles });
  saveAppliedCustomQuestions(store);
  if (changed > 0) {
    invalidateFormItemIndex(formId);
    log(`Program questions: ${changed} item change(s) on form ${formId}.`);
  }
  return changed;
}

/** Builds one custom question item on `form` (appended at the end; the caller positions it). */
function addCustomQuestionItem(form, spec) {
  try {
    let item;
    if (spec.kind === 'PARAGRAPH') item = form.addParagraphTextItem();
    else if (spec.kind === 'LIST') item = form.addListItem().setChoiceValues(spec.choices);
    else if (spec.kind === 'CHECKBOX') item = form.addCheckboxItem().setChoiceValues(spec.choices);
    else if (spec.kind === 'MULTIPLE_CHOICE') item = form.addMultipleChoiceItem().setChoiceValues(spec.choices);
    else if (spec.kind === 'SECTION_HEADER') item = form.addSectionHeaderItem();
    else if (spec.kind === 'DATE') item = form.addDateItem();
    else if (spec.kind === 'TIME') item = form.addTimeItem();
    else if (spec.kind === 'SCALE') {
      const scale = spec.scale || parseQuestionScale('');
      item = form.addScaleItem().setBounds(scale.lower, scale.upper);
      // Both ends or neither: Forms takes them as a pair, and one label on its
      // own reads as a scale somebody half-filled-in.
      if (scale.lowerLabel || scale.upperLabel) {
        item.setLabels(scale.lowerLabel || String(scale.lower), scale.upperLabel || String(scale.upper));
      }
    }
    else if (questionTypeIsImage(spec.kind)) {
      // The blob is fetched per form. A picture on ten forms is ten uploads,
      // which is why this only ever runs when the questions actually changed
      // (see syncCustomQuestionsOnForm()'s fingerprint).
      item = form.addImageItem().setImage(DriveApp.getFileById(spec.imageFileId).getBlob());
    } else item = form.addTextItem();
    item.setTitle(spec.title);
    if (spec.help) item.setHelpText(spec.help);
    // A notice and an image have no setRequired() at all — calling it throws,
    // and throwing here would cost the form every question after this one.
    if (!questionTypeIsDisplayOnly(spec.kind)) item.setRequired(!!spec.required);
    return item;
  } catch (err) {
    log(`Could not add the question "${spec.title}" to form ${form.getId()} (${err}).`);
    noteForAdmin('Program questions not added',
      `"${spec.title}" could not be added to form ${form.getId()}: ${err}`);
    return null;
  }
}

/**
 * THE ONE ENTRY POINT every form-building path calls once its dates, wording
 * and lunch questions are settled: shape the form for [Personalized Assistance]
 * if its sessions say so, then apply the program's own extra questions.
 *
 * Both halves are guarded separately and neither is allowed to fail the caller.
 * A form that is built and linked but missing a zip-code question is a form
 * people can still register on; a sync that dies here would leave a program
 * with no form at all.
 */
function applyProgramFormExtensions(form, context, options) {
  options = options || {};
  let changed = 0;

  if (context.isAssistance) {
    try {
      changed += syncAssistanceQuestionsOnForm(form, context, options.appointmentChoices ||
        buildAppointmentChoicesForContext(context, options.booked || {}));
    } catch (err) {
      log(`Could not shape form ${form.getId()} as an appointment form (${err}).`);
      noteForAdmin('Appointment forms not updated',
        `${form.getId()} (${describeLocations(context.locations)}) — its appointment times could not be ` +
        `set: ${err}. The next sync will try again.`);
    }
  }

  // ONE DATE OR SEVERAL — see section 1g. After the appointment branch, which
  // takes the mode question off for its own reasons and would otherwise be
  // fighting this over the same question every hour; and guarded like it, so a
  // failure here cannot cost the caller its form.
  try {
    const shaped = syncSessionCountShapeOnForm(form, context);
    changed += shaped;
    // A RESTORED MODE QUESTION HAS NO CHOICES ON IT. applyAttendanceModeChoices()
    // ran earlier in this same pass, found no question, and said so in the log —
    // so the question restoreMultiSessionShapeOnForm() has just put back would
    // sit on the form as an empty required list until the next sync, which is a
    // form nobody can submit. Setting them here closes that gap inside the one
    // pass that opened it.
    if (shaped > 0 && context.sessions.length > 1) {
      applyAttendanceModeChoices(form, {
        isFixed: context.isFixed, isClub: context.isClub, programTitle: context.programTitle,
        isLunchOnly: context.isLunchOnly, isAssistance: context.isAssistance
      });
    }
  } catch (err) {
    log(`Could not shape form ${form.getId()} for its ${context.sessions.length} session(s) (${err}).`);
  }

  let matching = null;
  try {
    const specs = options.questionSpecs || getProgramQuestionSpecs();
    matching = questionsForFormContext(specs, context);
    changed += syncCustomQuestionsOnForm(form, context, matching, { force: options.force });
  } catch (err) {
    log(`Could not apply the extra questions to form ${form.getId()} (${err}).`);
    noteForAdmin('Program questions not added',
      `Form ${form.getId()} (${describeLocations(context.locations)}) — ${err}`);
  }

  // THE WORDING ABOVE THE FIRST QUESTION. Separately guarded from the items
  // for the usual reason — a description that will not write must not cost the
  // form its questions — and done here rather than inside
  // buildFormDescription() because this is the one step every form-building
  // path reaches with the form already open and its dates already settled.
  try {
    changed += syncDescriptionInjectionsOnForm(form, context, matching);
  } catch (err) {
    log(`Could not apply the description wording to form ${form.getId()} (${err}).`);
  }
  return changed;
}

/**
 * Asks — or stops asking — whether the person is staying for lunch on the day
 * of their appointment. See TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH.
 *
 * BOTH DIRECTIONS, on every sync, for the same reason every other question
 * here is: a provider's dates move into a month with no menu typed yet, or the
 * site stops catering, and a question about a meal nobody is serving orders
 * one. Idempotent — in the steady state it compares two lists and returns 0.
 *
 * Returns how many writes it made.
 */
function applyAppointmentLunchQuestion(form, wantsLunch) {
  const items = form.getItems();
  const existing = items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK);

  if (!wantsLunch) {
    return deleteFormItems(form, existing, `the appointment form ${form.getId()} (no lunch on its dates)`);
  }

  const wanted = [APPOINTMENT_LUNCH_CHOICES.YES, APPOINTMENT_LUNCH_CHOICES.NO];
  const helpText = 'Lunch is served at the centre on some of the days above — the menu for each day is ' +
    'shown beside its date. This is only about the day you have just picked, and you are welcome to ' +
    'stay for it whether or not your appointment is at lunchtime.';

  if (existing.length > 0) {
    // More than one can only be a half-finished earlier pass; keep the first
    // and let the rest go, so a respondent is never asked the same thing twice.
    let changed = existing.length > 1
      ? deleteFormItems(form, existing.slice(1), `the appointment form ${form.getId()} (duplicate lunch question)`)
      : 0;
    try {
      const list = existing[0].asMultipleChoiceItem();
      const current = list.getChoices().map(c => c.getValue());
      if (current.length === wanted.length && current.every((v, i) => v === wanted[i]) &&
        String(list.getHelpText() || '') === helpText) {
        return changed;
      }
      list.setChoiceValues(wanted);
      list.setHelpText(helpText);
      return changed + 1;
    } catch (err) {
      // Unreadable, or the wrong item type — rebuild it below rather than
      // leave a question nobody can answer.
      try { form.deleteItem(existing[0]); } catch (delErr) { return changed; }
    }
  }

  const item = form.addMultipleChoiceItem()
    .setTitle(TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH)
    .setHelpText(helpText)
    .setChoiceValues(wanted)
    .setRequired(false);
  // Under the earlier-appointment question, which is itself under the time
  // question: the three read as one block about the appointment just chosen.
  const anchor = form.getItems().filter(it => it.getType() !== FormApp.ItemType.PAGE_BREAK &&
    (it.getTitle() === TEMPLATE_ITEM_TITLES.EARLIER_APPOINTMENT ||
      it.getTitle() === TEMPLATE_ITEM_TITLES.APPOINTMENT)).pop() || null;
  if (anchor) {
    try {
      form.moveItem(item.getIndex(), anchor.getIndex() + 1);
    } catch (err) {
      log(`Added the lunch question to appointment form ${form.getId()} but could not move it under the ` +
        `time question (${err}) — it is still asked, at the end.`);
    }
  }
  return 1;
}

/**
 * Puts the matching "Form description" wording onto a form whose description
 * this pass did NOT rebuild — the hourly sync, where the dates have not moved
 * and the only thing that changed is the tab.
 *
 * HOW IT AVOIDS STACKING. The base text cannot be re-derived here (a rebuild
 * path knows the capacity hints and the sign-up wording that went into it;
 * this one does not), so what is stripped is the exact block this script
 * appended last time, recorded per form beside the question titles. A
 * description somebody has since edited by hand simply will not carry that
 * block, in which case nothing is stripped and the new wording is appended to
 * what they wrote — which is the conservative answer: their words survive.
 *
 * Returns 1 when the form was written to, 0 otherwise.
 */
function syncDescriptionInjectionsOnForm(form, context, matching) {
  const formId = form.getId();
  const specs = matching || questionsForFormContext(getProgramQuestionSpecs(), context);
  const injection = buildDescriptionInjectionText(specs);

  const store = getAppliedCustomQuestions();
  const entry = store[formId] || {};
  const previous = String(entry.description || '');

  const current = form.getDescription() || '';
  let base = current;
  if (previous && current.lastIndexOf(previous) === current.length - previous.length) {
    base = current.slice(0, current.length - previous.length);
  }

  const wanted = `${base}${injection}`;
  if (wanted !== current) form.setDescription(wanted);
  if (previous === injection && wanted === current) return 0;

  store[formId] = Object.assign({}, store[formId], { description: injection });
  saveAppliedCustomQuestions(store);
  return wanted === current ? 0 : 1;
}

/**
 * A GROUP (fresh from the calendar) in the shape the extension layer wants —
 * the same shape buildFormSessionContext() produces from the sheet.
 *
 * The two callers are the two halves of "when does a form get built": from the
 * calendar during a sync, and from the dashboard rows during a rebuild. One
 * shape means the appointment and question logic is written once.
 */
function formContextFromGroup(group, formId) {
  // A LUNCH-ONLY GROUP KEEPS ITS DATES SOMEWHERE ELSE — in lunchOnlySessions,
  // because it has no calendar events to take them from (see
  // syncLunchOnlySessions(), and sessionsOfGroup(), which has the same
  // branch). Reading only `group.sessions` handed the extension layer an
  // EMPTY session list for every lunch sign-up form, so any Program_Questions
  // rule scoped to a date or a location saw a form with no dates and no
  // locations to match against.
  const rawSessions = group.sessions || group.lunchOnlySessions || [];
  const sessions = rawSessions.map(s => {
    const start = coerceDate(s.event ? s.event.getStartTime() : s.date);
    if (!start) return null;
    const location = s.locationName || s.location || '';
    return {
      date: start,
      end: s.event ? s.event.getEndTime() : (s.end || null),
      // A lunch session's id is the LUNCHONLY: one the session table carries.
      // Hashing it as a calendar event would mint an id matching no row at
      // all, since there is no calendarId behind it to hash.
      eventId: group.isLunchOnly
        ? makeLunchOnlyEventId(formatDateKey(start), location)
        : computeEventId(s.calendarId, group.cleanTitle, formatDateKey(start)),
      slotMinutes: group.slotMinutes || 0,
      location,
      title: group.cleanTitle
    };
  }).filter(Boolean);

  return {
    formId: formId || '',
    sessions,
    locations: group.locations || distinctLocations(sessions.map(s => s.location)),
    titles: [group.cleanTitle].filter(Boolean),
    showLocation: !!group.isShared,
    showTitle: false,
    isClub: !!group.isClub,
    isFixed: !!group.isFixed,
    isAssistance: !!group.isAssistance,
    isLunchOnly: !!group.isLunchOnly,
    maxPerMonth: group.maxPerMonth || 0,
    // The same keyword surface the sheet-side context carries (see
    // buildFormSessionContext()), assembled from what a calendar group knows
    // about itself — so a keyword rule matches a form identically whether it
    // was just built from the calendar or refreshed from the dashboard.
    typeTags: [group.typeTag, group.isClub ? 'Club' : '',
      group.isAssistance ? 'Personalized Assistance' : '',
      group.isFixed ? 'Grouped' : ''].map(t => String(t || '').trim()).filter(Boolean),
    programTitle: group.cleanTitle
  };
}

