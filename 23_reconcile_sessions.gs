/**
 * WHAT THE CALENDAR SAYS THE TIMES ARE, per session row that already exists.
 *
 * WHY THIS PASS HAD TO EXIST, and why [Personalized Assistance] looked broken
 * without it. writeEventRegistryRows() writes Event_Date and Event_End ONCE,
 * when a date first appears, and nothing has ever written them again —
 * collectCalendarWork() skips a group whose dates are all already on the sheet
 * as "up to date". That is fine for a program whose events never move, and it
 * is exactly wrong for the way an appointment program is actually set up:
 *
 *     Monday    somebody types 10:00–10:30 Low-Cost Wills across September
 *     Tuesday   the provider says they can do the whole morning, and the
 *               events are stretched to 10:00–11:30 on the calendar
 *     Wednesday every form still offers ONE appointment per date
 *
 * The row still says 10:00–10:30, buildAppointmentSlots() cuts one slot out of
 * half an hour, and the September form offers the first time on each date and
 * nothing else. Nothing in the log says so, because as far as the sync is
 * concerned there was nothing to do.
 *
 * A DAY STILL TYPED AS SEPARATE BLOCKS gets the same answer the merge in
 * section 12 would give it, WITHOUT deleting anything. Every block of one day
 * hashes to the same Event_ID (computeEventId() carries no time), so the row
 * used to show whichever block the sync happened to write last — a value that
 * changed between runs. Instead: the earliest block's start, and, where the
 * blocks tile back-to-back within TIME_BLOCK_MAX_GAP_MINUTES, the end of the
 * run. So a diary of six half-hours reads as one 12:30–3:30 session and its
 * form offers all six times the moment this pass runs, whether or not anybody
 * ever presses Merge.
 *
 * TWO SEPARATE THINGS ON ONE DAY ARE NOT SPANNED. A gap longer than a comfort
 * break is a morning class and an afternoon class, and swallowing the gap
 * would invent an hour of capacity that does not exist — the same line section
 * 12 draws, drawn here for the same reason.
 *
 * Returns { "calendarId|title|yyyy-MM-dd": { start, end, blocks, spanned } }.
 */
function buildSessionTimeExpectations(groups) {
  const byKey = {};
  (groups || []).forEach(group => {
    (group.sessions || []).forEach(session => {
      const ev = session.event;
      if (!ev) return;
      let start = null;
      let end = null;
      try {
        // An all-day event has no times worth writing onto a row, and reading
        // one as a span would hand a form twenty-four hours of appointments.
        if (ev.isAllDayEvent && ev.isAllDayEvent()) return;
        start = ev.getStartTime();
        end = ev.getEndTime();
      } catch (err) {
        return; // an event that will not answer is not evidence about anything
      }
      if (!start) return;
      const key = sessionTimeKey(session.calendarId, group.cleanTitle, formatDateKey(start));
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({ start, end: end || null });
    });
  });

  const expected = {};
  Object.keys(byKey).forEach(key => {
    const blocks = byKey[key].sort((a, b) => a.start - b.start);
    const first = blocks[0];
    let cursor = first.end;
    let spanned = 1;
    for (let i = 1; i < blocks.length; i++) {
      if (!cursor) break;
      const next = blocks[i];
      const gapMinutes = (next.start.getTime() - cursor.getTime()) / 60000;
      // Overlapping (a negative gap) is refused outright, exactly as
      // describeTimeBlockRun() refuses it: two events on top of each other are
      // a mistake somebody has to look at, not a span.
      if (gapMinutes < 0 || gapMinutes > TIME_BLOCK_MAX_GAP_MINUTES) break;
      if (!next.end || next.end <= cursor) break;
      cursor = next.end;
      spanned++;
    }
    expected[key] = {
      start: first.start,
      end: (spanned > 1 ? cursor : first.end) || null,
      blocks: blocks.length,
      spanned
    };
  });
  return expected;
}

/** The key buildSessionTimeExpectations() and its writer agree on: calendar, title, day. */
function sessionTimeKey(calendarId, cleanTitle, dateKey) {
  return `${String(calendarId || '').trim()}|${String(cleanTitle || '').trim()}|${dateKey}`;
}

/**
 * Brings Event_Date and Event_End on rows that ALREADY EXIST into line with
 * what the calendar now says — see buildSessionTimeExpectations() for what
 * "what the calendar says" means when a day holds several blocks.
 *
 * ONLY THE TIME OF DAY EVER CHANGES. The rows are matched by
 * `calendarId | title | dateKey`, which is what an Event_ID is built from, so
 * a session that has moved to another DAY is not touched here at all: to this
 * system that is a date that vanished and a date that appeared, and
 * triageDeletedSessions() and writeEventRegistryRows() already own both halves.
 * Nothing this function does can re-key a row, strand a registration, or move
 * a form.
 *
 * ONE ROW PER SESSION IS WRITTEN, the first one found. A day still typed as
 * separate blocks has several rows carrying one Event_ID, and giving them all
 * the same span would turn a visible list of three times into three identical
 * lines. The first row grows to cover the run — so the form offers every time
 * on it (buildAppointmentChoicesForContext() dedupes what the extra rows
 * repeat) — and the duplicates are left exactly as they are, where the review
 * in section 15 names them and offers to tidy them.
 *
 * Returns how many rows changed.
 */
function reconcileSessionTimesFromCalendar(registrySheet, groups) {
  return applySessionTimesToRows(registrySheet, buildSessionTimeExpectations(groups));
}

/**
 * The row-writing half of the above, taking the answer directly:
 * `expected` is { "calendarId|title|yyyy-MM-dd": { start, end } }.
 *
 * Split out for the same reason applyAssistanceSettingsToRows() is: the sync
 * is not the only thing that knows a session's new span.
 * collapseTimeBlockRun() has just stretched a calendar event over a whole
 * afternoon and should not have to wait an hour — or rebuild a group — before
 * the form offers the afternoon's appointments.
 */
function applySessionTimesToRows(registrySheet, expected) {
  if (!expected || Object.keys(expected).length === 0) return 0;

  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  const needed = ['Calendar_Source', 'Clean_Title', 'Event_Date', 'Event_End'];
  if (needed.some(header => !sheetMap[header])) return 0; // a workbook still on the old layout

  const written = {};
  const retimed = {};
  let changed = 0;

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const sources = registrySheet.getRange(zone.start, sheetMap['Calendar_Source'], zone.count, 1).getValues();
    const titles = registrySheet.getRange(zone.start, sheetMap['Clean_Title'], zone.count, 1).getValues();
    const startRange = registrySheet.getRange(zone.start, sheetMap['Event_Date'], zone.count, 1);
    const endRange = registrySheet.getRange(zone.start, sheetMap['Event_End'], zone.count, 1);
    const starts = startRange.getValues();
    const ends = endRange.getValues();

    let touched = false;
    for (let r = 0; r < zone.count; r++) {
      const have = coerceDate(starts[r][0]);
      if (!have) continue;
      const title = String(titles[r][0] || '').trim();
      const key = sessionTimeKey(sources[r][0], title, formatDateKey(have));
      const want = expected[key];
      if (!want) continue;
      if (written[key]) continue; // a duplicate row of the same session — see above
      written[key] = true;

      // clockTimeOnDayOf(): an end retyped by hand reads back dated to 1899,
      // and comparing that against a real moment would report a difference on
      // every single sync forever.
      const haveEnd = clockTimeOnDayOf(coerceDate(ends[r][0]), have);
      const sameStart = have.getTime() === want.start.getTime();
      const sameEnd = want.end
        ? !!(haveEnd && haveEnd.getTime() === want.end.getTime())
        : !haveEnd;
      if (sameStart && sameEnd) continue;

      starts[r] = [want.start];
      ends[r] = [want.end || ''];
      touched = true;
      changed++;
      if (title) {
        if (!retimed[title]) retimed[title] = 0;
        retimed[title]++;
      }
    }

    if (touched) {
      startRange.setValues(starts);
      endRange.setValues(ends);
      invalidateSectionedRowsCache(registrySheet);
    }
  });

  if (changed > 0) {
    // The Event_Time formulas read these two columns, and Quick Mark reads the
    // times through an index built from them.
    invalidateEventTimeIndex();
    const named = Object.keys(retimed).sort().map(t => `${t} (${retimed[t]})`);
    log(`Session times brought into line with the calendar on ${changed} row(s): ${named.join(', ')}. ` +
      `An appointment program's slots are cut out of these two columns, so a session whose calendar ` +
      `event was lengthened now offers every appointment that fits in it.`);
  }
  return changed;
}

/**
 * The rest of what [Personalized Assistance] means to a session row:
 * Slot_Minutes and Max_Capacity.
 *
 * WHY THIS IS A SEPARATE PASS, and why the feature looked broken without it.
 * writeEventRegistryRows() only ever writes NEW rows, so a program whose
 * twelve dates are already on the sheet is skipped wholesale by
 * collectCalendarWork(). reconcileProgramFlagColumns() closes that gap for the
 * CHECKBOXES — tick Personalized_Assistance and every row of the program shows
 * it on the next sync — and closed it for nothing else. The tick therefore
 * landed on a table whose Slot_Minutes stayed blank and whose Max_Capacity
 * stayed whatever the program had as a date-based program (usually nothing, ie
 * "🟢 Unlimited"), which reads exactly like an appointment program that did not
 * take: the box is on, the sheet says unlimited, and nothing about the session
 * knows it is now cut into slots.
 *
 * What it writes, per row, from the row's OWN start and end times — a group's
 * events are not all the same length, and the slot count is arithmetic on the
 * session, not on the program:
 *   Slot_Minutes    resolveSlotMinutes(group), or blank once the tag comes off
 *   Max_Capacity    one person per slot — see resolveAppointmentCapacity()
 * and, so the tab is not left showing a stale count beside a fresh capacity,
 * Remaining_Seats and Status are recomputed from the Active_Count already on
 * the row. (The registration sync recomputes all three from the registrants
 * themselves later; this just keeps the two columns from disagreeing in the
 * meantime.)
 *
 * A program that has just LOST the tag is reconciled the same way, back to its
 * stated cap or to uncapped — one reversal path, same pass.
 *
 * Returns how many rows changed.
 */
function reconcileAssistanceSessionSettings(registrySheet, groups) {
  if (!groups || groups.length === 0) return 0;

  // Programs whose tick has not reached the calendar yet are left alone, for
  // the same reason reconcileProgramFlagColumns() leaves their checkbox alone:
  // the groups were built from a calendar that has not been told yet.
  const pendingKeys = pendingProgramKeysFor('Personalized_Assistance');

  const expected = {};
  groups.forEach(group => {
    const spec = {
      isAssistance: !!group.isAssistance,
      slotMinutes: group.isAssistance ? resolveSlotMinutes(group) : 0,
      statedCapacity: Number(group.capacity) || 0
    };
    group.sessions.forEach(session => {
      const key = `${session.calendarId}|${group.cleanTitle}`;
      if (pendingKeys.has(key)) return;
      expected[key] = spec;
    });
  });

  const changed = applyAssistanceSettingsToRows(registrySheet, expected);
  if (changed > 0) {
    // Named, and with the arithmetic shown: "N rows updated" cannot tell a
    // program that has just BECOME appointment-based from one that has just
    // stopped being one, and those are the two things this pass does.
    const on = groups.filter(g => g.isAssistance);
    const off = groups.filter(g => !g.isAssistance);
    log(`Appointment settings written to ${changed} session row(s).` +
      (on.length > 0 ? ` Booked by appointment: ${dedupePreservingOrder(on.map(g =>
        `${g.cleanTitle} (${resolveSlotMinutes(g)}-min slots)`)).join(', ')}.` : '') +
      (off.length > 0 && on.length > 0 ? ` Everything else on this run is booked by date.` : ''));
  }
  return changed;
}

/**
 * The row-writing half of the above, taking the answer directly:
 * `expected` is { "calendarId|Clean_Title": { isAssistance, slotMinutes,
 * statedCapacity, dateKeys } }, and every session row of a named program is
 * brought into line with it.
 *
 * `dateKeys` — an optional { 'yyyy-MM-dd': true } narrowing the write to those
 * dates. The sync leaves it out, because a tick of Personalized_Assistance is a
 * statement about the whole program. The appointment review sets it, because an
 * appointment LENGTH is read per calendar event and grouped per month: setting
 * September's length must not quietly restate October's on the sheet while
 * October's own events still say something else.
 *
 * Split out because the sync is not the only thing that knows this answer.
 * convertTimeBlockToAppointments() has just written the tag onto the calendar
 * itself and should not have to wait an hour — or rebuild a group — to see the
 * sheet agree with it.
 *
 * options.writeFlagColumn — also tick (or untick) Personalized_Assistance.
 *   The sync leaves that to reconcileProgramFlagColumns(), which has already
 *   run by then off the same groups; a caller writing the calendar directly
 *   has nothing else to do it.
 *
 * Returns how many rows changed.
 */
function applyAssistanceSettingsToRows(registrySheet, expected, options) {
  options = options || {};
  if (!expected || Object.keys(expected).length === 0) return 0;

  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  const needed = ['Calendar_Source', 'Clean_Title', 'Event_Date', 'Event_End', 'Slot_Minutes',
    'Max_Capacity', 'Active_Count', 'Remaining_Seats', 'Status'];
  if (needed.some(header => !sheetMap[header])) return 0; // a workbook still on the old layout
  const flagCol = options.writeFlagColumn ? sheetMap['Personalized_Assistance'] : null;

  let changed = 0;
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const read = header => registrySheet.getRange(zone.start, sheetMap[header], zone.count, 1).getValues();
    const sources = read('Calendar_Source');
    const titles = read('Clean_Title');
    const starts = read('Event_Date');
    const ends = read('Event_End');
    const actives = read('Active_Count');
    const slotRange = registrySheet.getRange(zone.start, sheetMap['Slot_Minutes'], zone.count, 1);
    const capRange = registrySheet.getRange(zone.start, sheetMap['Max_Capacity'], zone.count, 1);
    const remainingRange = registrySheet.getRange(zone.start, sheetMap['Remaining_Seats'], zone.count, 1);
    const statusRange = registrySheet.getRange(zone.start, sheetMap['Status'], zone.count, 1);
    const flagRange = flagCol ? registrySheet.getRange(zone.start, flagCol, zone.count, 1) : null;
    const slots = slotRange.getValues();
    const caps = capRange.getValues();
    const remaining = remainingRange.getValues();
    const statuses = statusRange.getValues();
    const flags = flagRange ? flagRange.getValues() : null;

    let touched = false;
    let flagTouched = false;
    for (let r = 0; r < zone.count; r++) {
      const key = `${String(sources[r][0] || '').trim()}|${String(titles[r][0] || '').trim()}`;
      if (!Object.prototype.hasOwnProperty.call(expected, key)) continue;
      const spec = expected[key];
      if (spec.dateKeys) {
        const rowDate = coerceDate(starts[r][0]);
        if (!rowDate || !spec.dateKeys[formatDateKey(rowDate)]) continue;
      }

      if (flags && !(isFlagColumnValue(flags[r][0], ASSISTANCE_WORDS_REGEX) === spec.isAssistance &&
        typeof flags[r][0] === 'boolean')) {
        flags[r] = [spec.isAssistance];
        flagTouched = true;
      }

      let wantSlots = '';
      let wantCap = spec.statedCapacity > 0 ? spec.statedCapacity : '';
      if (spec.isAssistance) {
        wantSlots = spec.slotMinutes;
        const slotCount = buildAppointmentSlots(starts[r][0], ends[r][0], spec.slotMinutes).length;
        const capacity = resolveAppointmentCapacity(spec.statedCapacity, slotCount, titles[r][0]);
        wantCap = capacity > 0 ? capacity : '';
      }
      // Number(), not ===: a blank cell reads as '' and a written number as a
      // number, and neither is worth a write when it already says the same.
      if (Number(slots[r][0] || 0) === Number(wantSlots || 0) &&
        Number(caps[r][0] || 0) === Number(wantCap || 0)) continue;

      slots[r] = [wantSlots];
      caps[r] = [wantCap];
      const active = Number(actives[r][0]) || 0;
      const cap = Number(wantCap) || 0;
      remaining[r] = [cap > 0 ? Math.max(cap - active, 0) : ''];
      statuses[r] = [cap > 0 ? computeStatus(active, cap) : '🟢 Unlimited'];
      touched = true;
      changed++;
    }
    if (touched) {
      slotRange.setValues(slots);
      capRange.setValues(caps);
      remainingRange.setValues(remaining);
      statusRange.setValues(statuses);
    }
    if (flagTouched && flagRange) flagRange.setValues(flags);
    if (touched || flagTouched) invalidateSectionedRowsCache(registrySheet);
  });

  return changed;
}

/**
 * The name this had when Club was the only flag column. Kept for anything
 * still calling it.
 */
function reconcileClubTags(registrySheet, groups) {
  return reconcileProgramFlagColumns(registrySheet, groups);
}

/**
 * Makes [No Registration] mean something to the forms and the calendar, not
 * just to a column.
 *
 * processCalendarGroup() already declines to BUILD a form for a tagged group.
 * This handles the case that actually happens: a program that has been running
 * with a form for months, whose box somebody has just ticked. Two things have
 * to stop, and both have to be reversible —
 *
 *   1. the registration link in its calendar events, which otherwise keeps
 *      inviting people to sign up for something nobody is listing;
 *   2. the form itself, which otherwise keeps quietly accepting responses that
 *      no longer reach anyone. It is CLOSED, never deleted or unlinked: the
 *      responses already in it are the record of who came, and deleting a form
 *      is not something a checkbox should be able to do.
 *
 * Untick the box and both are undone — the link goes back on the next sync,
 * and the form is re-opened here. Only forms THIS function closed are ever
 * re-opened (they are remembered in a Script Property), so a form staff closed
 * by hand in the Forms UI stays closed.
 */
const NO_REGISTRATION_CLOSED_FORMS_PROP_KEY = 'NO_REGISTRATION_CLOSED_FORMS_V1';

function applyNoRegistrationEffects(registrySheet, groups) {
  if (!groups || groups.length === 0) return 0;

  const props = PropertiesService.getScriptProperties();
  let closedIds;
  try {
    closedIds = JSON.parse(props.getProperty(NO_REGISTRATION_CLOSED_FORMS_PROP_KEY) || '{}');
  } catch (err) {
    closedIds = {};
  }
  // Nothing tagged and nothing we have ever closed: every sync of every
  // workbook that does not use this feature stops here, before a single
  // Forms or Calendar call.
  const tagged = groups.filter(g => g.noRegistration);
  if (tagged.length === 0 && Object.keys(closedIds).length === 0) {
    // Nothing to close, re-open or strip. The link columns are still checked:
    // a row left saying "— no registration —" by an earlier tag has to get its
    // links back, and that is cheap (a few reads per zone, and a Forms call
    // only where such a row is actually found).
    updateRegistrationLinkCells(registrySheet, groups, buildFormIdByProgram(groups));
    return 0;
  }

  const formIdsByGroupKey = getPersistentFormRegistry();
  let touched = 0;
  let closedNow = 0;
  let reopenedNow = 0;

  groups.forEach(group => {
    // The registry is the cheap answer. Reading a form ID back out of the
    // event descriptions opens forms one at a time, so it is kept for the
    // tagged groups that actually need one — which is where a form built
    // before the registry existed has to be found.
    const formId = formIdsByGroupKey[group.groupKey] ||
      (group.noRegistration ? (findExistingFormIdFromEvents(group.events || []) || '') : '');

    if (group.noRegistration) {
      // 1. Every registration link out of every one of its events.
      (group.events || []).forEach(ev => {
        const existing = ev.getDescription() || '';
        const stripped = stripAllRegistrationLines(existing);
        // Notices count too — a program that has just been tagged
        // [No Registration] must not be left telling people its registration
        // opens later. It doesn't open at all.
        if ((stripped.removed === 0 && stripped.noticesRemoved === 0) || stripped.text === existing) return;
        ev.setDescription(stripped.text);
        touched++;
      });

      // 2. The form stops taking responses, and we remember that we did it.
      if (formId && !closedIds[formId]) {
        try {
          const form = FormApp.openById(formId);
          if (form.isAcceptingResponses()) {
            form.setAcceptingResponses(false);
            closedNow++;
          }
          closedIds[formId] = group.groupKey;
        } catch (err) {
          log(`ℹ️ "${group.cleanTitle}" is tagged [${NO_REGISTRATION_TAG}] but its form ${formId} could not be closed (${err}).`);
        }
      }
      return;
    }

    // The tag has come off: re-open a form we closed for this reason. Anything
    // we did not close ourselves is left exactly as it is.
    if (formId && closedIds[formId]) {
      try {
        const form = FormApp.openById(formId);
        if (!form.isAcceptingResponses()) {
          form.setAcceptingResponses(true);
          reopenedNow++;
        }
      } catch (err) {
        log(`ℹ️ "${group.cleanTitle}" no longer says [${NO_REGISTRATION_TAG}], so its form should be taking ` +
          `sign-ups again — but ${describeFormLink(formId)} could not be re-opened (${err}). Anyone ` +
          `following its link still sees "no longer accepting responses".`);
      }
      delete closedIds[formId];
    }
  });

  if (touched > 0) invalidateCalendarEventsCache();
  props.setProperty(NO_REGISTRATION_CLOSED_FORMS_PROP_KEY, JSON.stringify(closedIds));
  updateRegistrationLinkCells(registrySheet, groups, buildFormIdByProgram(groups));

  if (touched || closedNow || reopenedNow) {
    log(`applyNoRegistrationEffects: removed the registration link from ${touched} event(s), ` +
      `closed ${closedNow} form(s), re-opened ${reopenedNow}.`);
  }
  return touched;
}

/** Form_IDs this feature closed, so only its own closures are ever re-opened. */
const REGISTRATION_HORIZON_CLOSED_FORMS_PROP_KEY = 'REGISTRATION_HORIZON_CLOSED_FORMS_V1';

/** { Form_ID: program title } for every form THIS feature closed. */
function readRegistrationHorizonClosedForms() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties()
      .getProperty(REGISTRATION_HORIZON_CLOSED_FORMS_PROP_KEY) || '{}');
  } catch (err) {
    return {};
  }
}

function writeRegistrationHorizonClosedForms(closedIds) {
  PropertiesService.getScriptProperties()
    .setProperty(REGISTRATION_HORIZON_CLOSED_FORMS_PROP_KEY, JSON.stringify(closedIds));
}

/**
 * Opens a form for responses, or — when every session it covers is past the
 * horizon — builds it already closed.
 *
 * Called from the ONE line every form builder has: the setAcceptingResponses
 * (true) that turns a fresh copy of the template into a live form. Doing it
 * here rather than only in the sheet-driven reconciler is what closes the
 * window in between. A form built by a path that runs AFTER the reconciler
 * (the lunch-only forms, a destroy-and-rebuild, a combined form made by "Move
 * Sessions to Another Form") would otherwise sit live and public until the
 * next sync came round — which, for a season built three months early, is
 * exactly the leak this whole setting exists to stop.
 *
 * A group with no upcoming sessions at all is opened normally: "not yet" is a
 * statement about the future, and a form covering only past dates has none.
 */
function applyRegistrationHorizonToNewForm(form, sessions, formTitle) {
  const label = formTitle || form.getId();
  const closeIt = registrationHorizonClosesSessions(sessions);

  try {
    if (closeIt) {
      form.setCustomClosedFormMessage(REGISTRATION_NOT_OPEN_FORM_MESSAGE);
      form.setAcceptingResponses(false);
      const closedIds = readRegistrationHorizonClosedForms();
      closedIds[form.getId()] = label;
      writeRegistrationHorizonClosedForms(closedIds);
      log(`"${label}" is entirely past the registration horizon (${describeRegistrationHorizon()}) — ` +
        `built, but not accepting responses yet.`);
    } else {
      form.setAcceptingResponses(true);
    }
  } catch (err) {
    log(`⚠️ Could not confirm "accepting responses" on "${label}" (${err}).`);
  }
}

/**
 * True when a form covering exactly these sessions should not be live yet:
 * it has upcoming sessions, and every one of them is past the horizon.
 *
 * `sessions` is the `[{ date }]` shape both form builders already hold —
 * sessionsOfGroup() for a calendar or lunch-only group, spec.sessions for a
 * combined or rebuilt form.
 */
function registrationHorizonClosesSessions(sessions) {
  if (!hasRegistrationHorizon()) return false;
  const todayKey = formatDateKey(new Date());
  const upcoming = (sessions || [])
    .map(session => coerceDate(session && session.date))
    .filter(date => date && formatDateKey(date) >= todayKey);
  return upcoming.length > 0 && upcoming.every(date => isBeyondRegistrationHorizon(date));
}

/**
 * REGISTRATION HORIZON — makes the Config date mean something to the calendar
 * and to the forms, every sync, whether or not a program has new dates.
 *
 * Two halves, deliberately kept apart because they answer to different
 * sources of truth:
 *
 *   NOTICES work off the calendar groups this run already has in memory. A
 *   program whose dates are all on the sheet already is skipped by the import
 *   loop as "up to date", which is right for rows and forms and wrong for a
 *   horizon somebody moved this morning. The whole point of this setting is
 *   that changing one cell changes what the calendar says, so it cannot wait
 *   for a program's next new date.
 *
 *   FORM LIVENESS works off the session table, because that is the only place
 *   that knows every session a form covers — including the lunch-only forms,
 *   which have rows and a Form_ID but no calendar group of their own.
 *
 * Called AFTER the import loop, never before. Building a form opens it for
 * responses, so a run that closed one first would hand it straight back —
 * which is also why the builders themselves ask the horizon on the way past
 * (applyRegistrationHorizonToNewForm). This pass is what catches the
 * transitions those cannot see: a horizon that MOVED under forms and events
 * built weeks ago.
 */
function applyRegistrationHorizonEffects(registrySheet, groups, existingState) {
  const notices = reconcileRegistrationHorizonNotices(groups || [], existingState);
  const forms = reconcileRegistrationHorizonForms(registrySheet);
  return { notices, forms };
}

/**
 * Brings every event's description into line with the horizon — and ONLY the
 * ones that disagree with it.
 *
 * This is not a second copy of backInjectCalendarDescriptions(). That function
 * owns the link on events it has just imported; this one owns the single
 * question "does what this description says match whether registration is open
 * for this date", and it touches nothing else. An event with a correct link
 * inside the horizon, or a correct notice outside it, is not written to — which
 * is what keeps a sync of a fully-imported season from generating a calendar
 * notification per event per day.
 *
 * The scan itself is free: the events are already in memory from this run's
 * one calendar fetch, and every test below is string work. Google only hears
 * from us where a description is actually wrong.
 */
function reconcileRegistrationHorizonNotices(groups, existingState) {
  const showLinks = shouldShowLinkInDescription();
  const registry = getPersistentFormRegistry();
  const groupFormMap = (existingState && existingState.groupFormMap) || {};
  const formInfoCache = {};
  let marked = 0;
  let restored = 0;
  let cleared = 0;

  groups.forEach(group => {
    // A [No Registration] program has no registration to be early for, and
    // applyNoRegistrationEffects() has already stripped its descriptions bare.
    if (group.noRegistration) return;

    (group.events || []).forEach(ev => {
      const existing = ev.getDescription() || '';
      const stripped = stripAllRegistrationLines(existing);
      const notYetOpen = shouldMarkNotYetOpen(ev.getStartTime());

      if (!showLinks) {
        // "Hide link" means nothing of ours belongs in these descriptions —
        // not a link, and not a notice either. Only a leftover from before the
        // setting changed can be here, so this is almost always a no-op.
        if (stripped.noticesRemoved > 0 && stripped.text !== existing) {
          ev.setDescription(stripped.text);
          cleared++;
        }
        return;
      }

      if (notYetOpen) {
        // Right already: one notice, at the top, no link underneath it.
        if (existing.indexOf(REGISTRATION_NOT_OPEN_LINE) === 0 &&
          stripped.removed === 0 && stripped.noticesRemoved === 1) {
          return;
        }
        const updated = prependRegistrationLine(stripped.text, REGISTRATION_NOT_OPEN_LINE);
        if (updated === existing) return;
        ev.setDescription(updated);
        marked++;
        return;
      }

      // Inside the horizon. The only thing this function fixes here is a
      // notice that has outlived the horizon that wrote it — an event whose
      // link is simply missing for some other reason is
      // backInjectCalendarDescriptions()' and "Rewrite Event Links"' business,
      // not this function's.
      if (stripped.noticesRemoved === 0) return;

      const formId = groupFormMap[group.groupKey] || registry[group.groupKey] || '';
      const formInfo = formId ? getFormInfoForLink(formId, formInfoCache) : null;
      const updated = formInfo
        ? prependRegistrationLine(stripped.text, buildRegistrationLinkLine(group, formInfo))
        : stripped.text; // no form to link to yet — the stale notice still comes off
      if (updated === existing) return;
      ev.setDescription(updated);
      if (formInfo) restored++; else cleared++;
    });
  });

  if (marked + restored + cleared > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`Registration horizon (${describeRegistrationHorizon()}): marked ${marked} event(s) ` +
      `"${REGISTRATION_NOT_OPEN_TEXT}", put the link back on ${restored}, cleared ${cleared}.`);
  }
  return { marked, restored, cleared };
}

/**
 * Closes a form whose remaining sessions are ALL past the horizon, and
 * re-opens it when the horizon reaches them.
 *
 * "Not live" is `setAcceptingResponses(false)` plus a closed-form message that
 * says why, so somebody who has the link from a colleague or a bookmark reads
 * "Registration Not Yet Open" rather than Google's blank "no longer accepting
 * responses" — which would read as "you missed it" for a program nobody has
 * been able to sign up for yet.
 *
 * Two rules keep this from being destructive:
 *
 *   ONLY FORMS THIS FUNCTION CLOSED ARE EVER RE-OPENED. They are remembered in
 *   a Script Property, exactly as applyNoRegistrationEffects() remembers its
 *   own, so a form staff closed by hand in the Forms UI stays closed and a
 *   form closed by [No Registration] is left to that feature to re-open.
 *
 *   A FORM WITH NO UPCOMING SESSIONS IS NOT TOUCHED. Last month's form is
 *   closed, open, or archived for reasons of its own, and none of them are
 *   this setting's business.
 */
function reconcileRegistrationHorizonForms(registrySheet) {
  const props = PropertiesService.getScriptProperties();
  const closedIds = readRegistrationHorizonClosedForms();

  // No horizon and nothing we have ever closed: every sync of every workbook
  // that does not use this setting stops here, before reading a sheet or
  // opening a single form.
  if (!hasRegistrationHorizon() && Object.keys(closedIds).length === 0) return { closed: 0, reopened: 0 };
  if (!registrySheet) return { closed: 0, reopened: 0 };

  let noRegistrationClosed;
  try {
    noRegistrationClosed = JSON.parse(props.getProperty(NO_REGISTRATION_CLOSED_FORMS_PROP_KEY) || '{}');
  } catch (err) {
    noRegistrationClosed = {};
  }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());

  // Form_ID -> { open: does it still cover a session inside the horizon,
  //              upcoming: does it cover any future session at all, title }
  const byForm = {};
  getSectionedRows(registrySheet, headers, 'Event_ID').forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    if (!formId) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date || formatDateKey(date) < todayKey) return;
    if (!byForm[formId]) {
      byForm[formId] = { open: false, upcoming: false, title: String(row[map['Clean_Title']] || '').trim() };
    }
    byForm[formId].upcoming = true;
    if (!isBeyondRegistrationHorizon(date)) byForm[formId].open = true;
  });

  // A form we closed whose sessions have since been deleted outright would
  // otherwise never be reconsidered — it has no rows left to put it in the map
  // above, so it could sit closed forever. Add it back as "no upcoming
  // sessions" and let the loop decide what that means.
  Object.keys(closedIds).forEach(formId => {
    if (!byForm[formId]) byForm[formId] = { open: false, upcoming: false, title: closedIds[formId] || '' };
  });

  let closed = 0;
  let reopened = 0;

  Object.keys(byForm).forEach(formId => {
    const state = byForm[formId];
    // Closed by [No Registration], which is a stronger statement than "not
    // yet". That feature owns the form until its tag comes off.
    if (noRegistrationClosed[formId]) return;

    const shouldBeClosed = state.upcoming && !state.open;
    const weClosedIt = Object.prototype.hasOwnProperty.call(closedIds, formId);

    if (shouldBeClosed) {
      if (weClosedIt) return; // already ours, already shut
      try {
        const form = FormApp.openById(formId);
        if (form.isAcceptingResponses()) {
          form.setCustomClosedFormMessage(REGISTRATION_NOT_OPEN_FORM_MESSAGE);
          form.setAcceptingResponses(false);
          closed++;
        }
        closedIds[formId] = state.title;
      } catch (err) {
        log(`ℹ️ "${state.title}" is entirely past the registration horizon, so its form should have ` +
          `stopped taking sign-ups — but ${describeFormLink(formId)} could not be closed (${err}). It ` +
          `is still open, and can still take a registration for a session that has passed.`);
      }
      return;
    }

    if (!weClosedIt) return;

    // Either a session is now inside the horizon, or the form has no upcoming
    // session left to hold shut. Both mean this function is done with it.
    try {
      const form = FormApp.openById(formId);
      if (!form.isAcceptingResponses()) {
        form.setAcceptingResponses(true);
        reopened++;
      }
      delete closedIds[formId];
    } catch (err) {
      log(`ℹ️ "${state.title}" is inside the registration horizon again, so its form should be taking ` +
        `sign-ups — but ${describeFormLink(formId)} could not be re-opened (${err}). Anyone following ` +
        `its link still sees "no longer accepting responses".`);
    }
  });

  writeRegistrationHorizonClosedForms(closedIds);
  if (closed || reopened) {
    log(`Registration horizon (${describeRegistrationHorizon()}): closed ${closed} form(s) that are not open yet, ` +
      `re-opened ${reopened}.`);
  }
  return { closed, reopened };
}

/**
 * Keeps the session table's two link columns honest about [No Registration].
 *
 * A program that has been running with a form already has "View Live Form" on
 * every one of its rows, and those rows are not rewritten by a sync that has
 * no new dates to add — so ticking the box would leave a live registration
 * link sitting on the dashboard for a program that no longer takes any. Rows
 * of a tagged program therefore say so in words instead (see
 * NO_REGISTRATION_LINK_LABEL), and rows that say so get their real links back
 * when the tag comes off.
 *
 * A tagged program keeps its Form_ID — hidden plumbing, and what makes the
 * restore possible without waiting for a new date to appear. Rows written
 * WHILE the tag was on have no Form_ID at all, so `formIdByProgram`
 * (`calendarId|title` -> Form_ID, from the persistent registry) is the
 * fallback, and it is written into the row on the way past.
 */
function updateRegistrationLinkCells(registrySheet, groups, formIdByProgram) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  if (!sheetMap['Form_Response_Link'] || !sheetMap['Calendar_Source'] || !sheetMap['Clean_Title']) return 0;

  // Same rule as reconcileProgramFlagColumns(): a program whose No_Registration
  // tick has not reached the calendar yet is not something the calendar gets to
  // have an opinion about, so its link cells are left as they are until it has.
  const pendingKeys = pendingProgramKeysFor('No_Registration');

  const wantsNoRegistration = {};
  groups.forEach(group => {
    group.sessions.forEach(session => {
      const key = `${session.calendarId}|${group.cleanTitle}`;
      if (pendingKeys.has(key)) return;
      wantsNoRegistration[key] = !!group.noRegistration;
    });
  });

  const linksByFormId = {};
  const linksFor = formId => {
    if (!formId) return null;
    if (!Object.prototype.hasOwnProperty.call(linksByFormId, formId)) {
      try {
        const form = FormApp.openById(formId);
        linksByFormId[formId] = { publishedUrl: form.getPublishedUrl(), editUrl: form.getEditUrl() };
      } catch (err) {
        log(`ℹ️ Could not re-read form ${formId} to restore its links (${err}).`);
        linksByFormId[formId] = null;
      }
    }
    return linksByFormId[formId];
  };

  let changed = 0;
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const sources = registrySheet.getRange(zone.start, sheetMap['Calendar_Source'], zone.count, 1).getValues();
    const titles = registrySheet.getRange(zone.start, sheetMap['Clean_Title'], zone.count, 1).getValues();
    const formIds = sheetMap['Form_ID']
      ? registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1).getValues()
      : null;
    // THE ROW'S OWN SPAN, for the form fallback below. A form belongs to one
    // month of a Regular program, so restoring a link from a program-level
    // lookup would hand every month of it whichever month's form was written
    // last — see buildFormIdByProgram(). Read here rather than derived from
    // the group, because the row is the only thing that knows which month it
    // is in.
    const dates = registrySheet.getRange(zone.start, sheetMap['Event_Date'], zone.count, 1).getValues();
    const typeTags = sheetMap['Type_Tag']
      ? registrySheet.getRange(zone.start, sheetMap['Type_Tag'], zone.count, 1).getValues()
      : null;
    // Read as VALUES but written CELL BY CELL. These columns hold =HYPERLINK()
    // formulas, which getValues() flattens to their display text — writing a
    // whole column back from that array would turn every link on it into the
    // words "View Live Form".
    const view = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1).getValues();

    for (let r = 0; r < zone.count; r++) {
      const key = `${String(sources[r][0] || '').trim()}|${String(titles[r][0] || '').trim()}`;
      if (!Object.prototype.hasOwnProperty.call(wantsNoRegistration, key)) continue;
      const isBlocked = String(view[r][0] || '').trim() === NO_REGISTRATION_LINK_LABEL;
      const setCell = (colName, value) => {
        if (!sheetMap[colName]) return;
        registrySheet.getRange(zone.start + r, sheetMap[colName], 1, 1).setValue(value);
        invalidateSectionedRowsCache(registrySheet);
      };

      if (wantsNoRegistration[key]) {
        if (isBlocked) continue;
        setCell('Form_Response_Link', NO_REGISTRATION_LINK_LABEL);
        setCell('Edit_Form_Link', '');
        changed++;
        continue;
      }

      if (!isBlocked) continue; // already showing its own links
      const rowFormId = formIds ? String(formIds[r][0] || '').trim() : '';
      // The row's own form first — it is the only per-ROW fact here, so a row
      // that kept its Form_ID through the tag needs no lookup at all. The
      // fallback is for rows WRITTEN while the tag was on, which carry none;
      // it is keyed by span so a row a month out gets its own month's form.
      const spanKey = programFormKey(String(sources[r][0] || '').trim(),
        String(titles[r][0] || '').trim(),
        formSpanForRow(typeTags ? typeTags[r][0] : '', dates[r][0]));
      const formId = rowFormId || (formIdByProgram ? (formIdByProgram[spanKey] || '') : '');
      const links = linksFor(formId);
      if (!links) continue; // no form to point at yet — the next sync builds one
      setCell('Form_Response_Link', makeHyperlinkFormula(links.publishedUrl, 'View Live Form'));
      setCell('Edit_Form_Link', makeHyperlinkFormula(links.editUrl, 'Edit Form Settings'));
      if (!rowFormId) setCell('Form_ID', formId);
      changed++;
    }
  });

  if (changed > 0) log(`updateRegistrationLinkCells: rewrote the link columns on ${changed} session row(s).`);
  return changed;
}

/**
 * `calendarId|title|span` -> Form_ID, from the persistent form registry, for
 * these groups.
 *
 * KEYED ON THE SPAN AS WELL AS THE PROGRAM, and that third component is the
 * whole correctness of this map — see formSpanForGroup(). A Regular program is
 * one GROUP per calendar month, each with its own form, so the September and
 * October groups of "Chair Yoga" both used to write to `cal|Chair Yoga` and
 * whichever ran last won. Every row of that program then restored the same
 * link, so the sessions a month out were handed the near month's form: a live
 * link, on the right row, to the wrong month — which reads as sign-ups
 * silently landing on the wrong form rather than as an error.
 */
function buildFormIdByProgram(groups) {
  const registry = getPersistentFormRegistry();
  const out = {};
  (groups || []).forEach(group => {
    const formId = registry[group.groupKey];
    if (!formId) return;
    const span = formSpanForGroup(group);
    group.sessions.forEach(session => {
      out[programFormKey(session.calendarId, group.cleanTitle, span)] = formId;
    });
  });
  return out;
}

/**
 * A program that carries [All Locations] on SOME of its events and not others
 * is almost always a half-finished edit — someone tagged one calendar's copies
 * and stopped. It is handled coherently either way (each event follows its own
 * tag, so the untagged ones keep their own per-location form), but it is worth
 * saying out loud: the symptom otherwise is "the shared form is missing
 * Ashbridge" with nothing anywhere explaining why.
 */
function warnAboutPartiallySharedPrograms(groups) {
  const byTitle = {};
  groups.forEach(g => {
    if (!byTitle[g.cleanTitle]) byTitle[g.cleanTitle] = { shared: [], own: [] };
    byTitle[g.cleanTitle][g.isShared ? 'shared' : 'own'].push(g);
  });

  Object.keys(byTitle).forEach(title => {
    const { shared, own } = byTitle[title];
    if (shared.length === 0 || own.length === 0) return;
    const strayLocations = dedupePreservingOrder(own.reduce((acc, g) => acc.concat(g.locations), []));
    const message = `"${title}" is tagged [${SHARED_LOCATION_TAG}] at ${describeLocations(shared[0].locations)} ` +
      `but NOT at ${strayLocations.join(', ')}, so those sessions keep their own separate form(s). ` +
      `Add [${SHARED_LOCATION_TAG}] to their calendar events too (or use "🔗 Link Program Across Locations…") ` +
      `if they were meant to share one.`;
    log(`⚠️ ${message}`);
    noteForAdmin('Programs only partly linked across locations', message);
  });
}

