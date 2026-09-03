/**
 * One unit of work: resolve the group's form, write its new session rows, and
 * put the registration link on its calendar events. Returns
 * { formCreated, eventsAdded }.
 */
function processCalendarGroup(registrySheet, item, existingState) {
  const { group, configInfo, newSessions } = item;

  // [No Registration] short-circuits the whole form half of this function.
  // The dates still become session rows — the dashboard is what staff read to
  // see what is on — but with no form built, no form reused, and no
  // registration link written back. applyNoRegistrationEffects() has already
  // taken care of any form and any link this program had before the tag went
  // on.
  if (group.noRegistration) {
    const noFormGroup = Object.assign({}, group, {
      sessions: newSessions,
      events: newSessions.map(s => s.event)
    });
    writeEventRegistryRows(registrySheet, noFormGroup, null);
    newSessions.forEach(s => existingState.eventIds.add(
      computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()))));
    log(`No form wanted: ${describeGroup(group)} — wrote ${newSessions.length} new date(s) to the session ` +
      `table and built no registration form, because the calendar says [${NO_REGISTRATION_TAG}].`);
    return { formCreated: false, noForm: true, eventsAdded: newSessions.length };
  }

  let existingFormId = existingState.groupFormMap[group.groupKey];
  if (!existingFormId) {
    // Memoized: detectRenamedPrograms() asked this same question about this
    // same group earlier in the run — see recoverFormIdFromGroupEvents().
    existingFormId = recoverFormIdFromGroupEvents(group);
    if (existingFormId) {
      log(`Recovered form for ${describeGroup(group)} — the registry had lost it, but a calendar event ` +
        `description still names ${describeFormLink(existingFormId)}. Reusing it, so nobody's link breaks.`);
    }
  }

  let formInfo;
  let formCreated = false;
  if (existingFormId) {
    try {
      formInfo = refreshFormForNewDates(existingFormId, group, configInfo);
      log(`Reused form for ${describeGroup(group)} — added ${newSessions.length} new date(s) to ` +
        `${describeFormLink(formInfo.formId)}.`);
    } catch (err) {
      // NOT A REASON TO BUILD A SECOND FORM. See handleUnreachableGroupForm().
      return handleUnreachableGroupForm(registrySheet, group, newSessions, existingState, existingFormId, err);
    }
  } else {
    formInfo = createRegistrationForm(group, configInfo);
    formCreated = true;
    log(`Created form for ${describeGroup(group)} — ${describeFormLink(formInfo.formId)}, ` +
      `${newSessions.length} date(s)` +
      (group.isShared ? `, pooled across ${describeLocations(group.locations)}` : '') + '.');
  }
  savePersistentFormRegistryEntry(group.groupKey, formInfo.formId);
  // Flushed HERE, not at the end of the run: between creating a form and
  // writing its rows there is a window where nothing durable points at it,
  // and an execution killed in that window would create a second form for
  // this group on the next attempt. One property write per new group is a
  // cheap price for that never happening. (Everything after this point is
  // itself durable — the rows carry Form_ID, and so does the event
  // description.)
  flushPersistentRegistries();

  const newSessionsGroup = Object.assign({}, group, {
    sessions: newSessions,
    events: newSessions.map(s => s.event)
  });
  writeEventRegistryRows(registrySheet, newSessionsGroup, formInfo);

  backInjectCalendarDescriptions(group, formInfo);

  // Keep the in-memory state honest for the rest of THIS run: these dates now
  // exist, and this group now has a form.
  newSessions.forEach(s => existingState.eventIds.add(
    computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()))));
  existingState.groupFormMap[group.groupKey] = formInfo.formId;

  return { formCreated, eventsAdded: newSessions.length };
}

/**
 * WHAT AN UNOPENABLE FORM MEANS, AND WHAT IT DOES NOT.
 *
 * Until now, a form this group already had that could not be opened sent
 * processCalendarGroup() straight into createRegistrationForm(): a brand-new
 * form, a brand-new link, the registry and the dashboard repointed onto it,
 * and every link already handed out left pointing at the old one. Done
 * silently, on an hourly trigger, from a single caught exception.
 *
 * THE EXCEPTION DOES NOT SAY WHAT PEOPLE ASSUMED IT SAID. "Could not be
 * opened" covers, indistinguishably:
 *
 *   • the form was deleted — the case the rebuild was written for;
 *   • the form is in the Drive trash, where it is fully recoverable and still
 *     holds every response;
 *   • THE ACCOUNT RUNNING THIS SYNC CANNOT SEE THE FORM. Drive gives a new
 *     file to its creator alone, and the forms in this workbook are made by
 *     whichever member of staff put the event on the calendar. An hourly sync
 *     run by somebody else is refused by a form that is in perfect health —
 *     which is the entire reason openUpFileToAnyoneWithLink() and the "Open
 *     Up Form Sharing" menu item exist;
 *   • a transient Forms/Drive error, which the next run would not have had.
 *
 * Three of those four are temporary, and in all three the rebuild is the worst
 * available answer: it costs a live form and its link, strands the responses
 * already collected on it, and leaves a duplicate behind. Run hourly against a
 * fault that does not fix itself, it produces one new form per sync — a folder
 * of same-named twins, with the dashboard on one and the calendar events on
 * another.
 *
 * So the sync no longer replaces a form it merely failed to open. It is the
 * same rule the lunch-only path has always followed (see the catch in
 * syncLunchOnlySessions(): "Replacing it silently would strand every link
 * already handed out AND every response on it"), and the program path was
 * simply the one place that had not adopted it.
 *
 * WHAT HAPPENS INSTEAD: the new dates are still written to the dashboard — the
 * dashboard is what staff read to see what is on, and hiding a session because
 * of a Drive fault helps nobody — carrying the form ID the group already has
 * and empty link cells, since no URL could be read. The registry is left
 * exactly as it is. The calendar descriptions are left exactly as they are,
 * because whatever link they carry is at worst the one that was working
 * yesterday. And it is reported to the admin digest, because the one thing
 * this must never be is quiet.
 *
 * Replacing a form that really is gone is still available, deliberately as a
 * decision somebody makes rather than one a trigger makes for them: "🗑️
 * Recover Deleted Forms…" asks Drive which of the four cases each form is in,
 * restores the recoverable ones with their links intact, and offers to rebuild
 * only the ones nothing can bring back.
 */
function handleUnreachableGroupForm(registrySheet, group, newSessions, existingState, formId, err) {
  log(`⚠️ ${describeGroup(group)} points at ${describeFormLink(formId)}, which this account could not open ` +
    `(${err}). Its ${newSessions.length} new date(s) were written WITHOUT a link, and NO replacement form ` +
    `was built — the form may be in the trash, or simply invisible to whoever is running this sync.`);
  noteForAdmin('Programs whose form could not be opened',
    `${group.cleanTitle} (${describeLocations(group.locations)}${group.monthLabel ? `, ${group.monthLabel}` : ''}) — ` +
    `${describeFormLink(formId)} could not be opened (${err}). Nothing was rebuilt, so every link already handed ` +
    `out still points where it did and every response on that form is still on it. Two things to try, in order: ` +
    `run "🔓 Open Up Form Sharing" signed in as whoever created the form — an account that cannot reach a file ` +
    `is much the commonest cause — and then "🗑️ Recover Deleted Forms…", which says whether the form is in the ` +
    `Drive trash and takes it back out with its link and its responses intact.`);

  // The dates go on the dashboard either way, carrying the form ID the group
  // already has. No URLs were readable, so the link cells stay empty and
  // "Repair Dashboard Links" fills them in on the first run after the form
  // becomes reachable again.
  const newSessionsGroup = Object.assign({}, group, {
    sessions: newSessions,
    events: newSessions.map(s => s.event)
  });
  writeEventRegistryRows(registrySheet, newSessionsGroup,
    { formId, publishedUrl: '', editUrl: '' });

  newSessions.forEach(s => existingState.eventIds.add(
    computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()))));

  return { formCreated: false, formUnreachable: true, eventsAdded: newSessions.length };
}

/**
 * Buckets parsed sessions — `{ event, parsed, calendarId, locationName }`,
 * from every calendar at once — into the groups that each get ONE form.
 *
 * A group key is `<scope>::<title>::<span>`:
 *   scope  the calendar ID, or SHARED_LOCATION_SCOPE when the event is tagged
 *          [All Locations] — the WHERE half of grouping.
 *   span   'FIXED' for a [Grouped] series, else the month label — the WHEN
 *          half. ('FIXED' is deliberately not renamed alongside the Type_Tag
 *          vocabulary; it is a persisted internal key, see
 *          getExistingRegistryState().)
 *
 * Every group carries `sessions` (each with the calendar and location it came
 * from, so nothing downstream has to assume a group is single-location) and
 * `events`, the same list flattened, for the calendar-facing helpers.
 */
function buildEventGroups(parsedSessions) {
  const groups = {};

  parsedSessions.forEach(({ event, parsed, calendarId, locationName }) => {
    const startTime = event.getStartTime();
    const monthLabel = getMonthLabel(startTime);
    const typeTag = parsed.isFixed ? EVENT_TYPES.GROUPED : EVENT_TYPES.REGULAR;

    const scope = parsed.isShared ? SHARED_LOCATION_SCOPE : calendarId;
    const span = parsed.isFixed ? 'FIXED' : monthLabel;
    const key = `${scope}::${parsed.cleanTitle}::${span}`;

    if (!groups[key]) {
      groups[key] = {
        groupKey: key,
        scope,
        isShared: !!parsed.isShared,
        // The one calendar a non-shared group belongs to. A shared group has
        // no single one — its rows take their Calendar_Source per session.
        calendarId: parsed.isShared ? null : calendarId,
        cleanTitle: parsed.cleanTitle,
        capacity: parsed.capacity,
        isFixed: parsed.isFixed,
        isClub: !!parsed.isClub,
        noRegistration: !!parsed.noRegistration,
        isAssistance: !!parsed.isAssistance,
        slotMinutes: parsed.slotMinutes || 0,
        maxPerMonth: parsed.maxPerMonth || 0,
        typeTag,
        monthLabel: parsed.isFixed ? null : monthLabel,
        sessions: []
      };
    }
    // A capacity typed on any one of a group's events applies to the group
    // (it always has — this just keeps that true when the first event seen
    // happens to be an untagged one from another calendar).
    if (!groups[key].capacity && parsed.capacity) groups[key].capacity = parsed.capacity;
    // Same rule for [Club], and for the same reason: a program is a club or it
    // isn't, and tagging one of its twelve calendar events is how somebody
    // says so. Never un-set — a missing tag on one event is an omission, not a
    // statement that the club has been dissolved.
    if (parsed.isClub) groups[key].isClub = true;
    // And again for [No Registration]: tagging one event of a program is how
    // somebody says the program takes no sign-ups, and a missing tag on
    // another of its events is an omission rather than a contradiction.
    if (parsed.noRegistration) groups[key].noRegistration = true;
    // And again for [Personalized Assistance] and the two numbers that only
    // mean anything alongside it: tagging one event of a program is how
    // somebody says the whole program works that way. Never un-set, for the
    // same reason as the two above — a missing tag on the January event is an
    // omission, not a decision to start booking Wills by the day.
    if (parsed.isAssistance) groups[key].isAssistance = true;
    if (!groups[key].slotMinutes && parsed.slotMinutes) groups[key].slotMinutes = parsed.slotMinutes;
    if (!groups[key].maxPerMonth && parsed.maxPerMonth) groups[key].maxPerMonth = parsed.maxPerMonth;
    groups[key].sessions.push({ event, calendarId, locationName });
  });

  return unifyProgramFlagsAcrossGroups(Object.values(groups)).map(g => {
    g.sessions.sort((a, b) => a.event.getStartTime() - b.event.getStartTime());
    g.events = g.sessions.map(s => s.event);
    g.locations = distinctLocations(g.sessions.map(s => s.locationName));
    g.calendarIds = dedupePreservingOrder(g.sessions.map(s => s.calendarId));
    if (g.isFixed) {
      const first = g.events[0].getStartTime();
      const last = g.events[g.events.length - 1].getStartTime();
      g.seriesWeeks = Math.max(1, Math.round((last - first) / (7 * 24 * 60 * 60 * 1000)) + 1);
    }
    return g;
  });
}

/**
 * A FLAG IS A PROPERTY OF A PROGRAM, NOT OF ONE MONTH OF IT — the rule
 * buildEventGroups() states three times over and could only keep inside one
 * group.
 *
 * A Regular program is grouped per calendar MONTH (see the `span` half of the
 * group key), so "Low-Cost Wills" running fortnightly through the spring is
 * five groups, not one. The "tagging one event says it about the program" rule
 * above therefore reached only the events of the same month, and every
 * consumer downstream keys the answer by CALENDAR + TITLE with no month in it:
 *
 *   - reconcileProgramFlagColumns() builds
 *     `expected["<calendarId>|<title>"] = group.isClub`, so five month groups
 *     write to one key and whichever is enumerated LAST silently decides the
 *     program. One untagged month unticked the other four.
 *   - reconcileAssistanceSessionSettings() does the same for Slot_Minutes and
 *     Max_Capacity.
 *   - the appointment forms are shaped from whichever group carried the tag.
 *
 * So the flags are ORed across every group of one program before anything sees
 * them: tagging September's event marks the program, exactly as tagging one
 * event of September's group already marked September. Nothing is ever turned
 * OFF here — a month with no tag on it is an omission, which is the same
 * reading the per-group rule takes.
 *
 * WHAT COUNTS AS ONE PROGRAM: `scope::cleanTitle` — the group key with the
 * month taken off. `scope` is the calendar for an ordinary program and
 * SHARED_LOCATION_SCOPE for one tagged [All Locations], which is exactly the
 * boundary the rest of the system draws: two locations running an unlinked
 * "Chair Yoga" are two programs with two forms (spreadFlagToSiblingRows()
 * refuses to cross that line for the same reason), while a linked program is
 * one program that happens to meet in two rooms.
 *
 * The numbers that only mean anything alongside [Personalized Assistance]
 * travel with it: a slot length typed on the September event is a statement
 * about how long an appointment with Heather takes, not about September.
 * Capacity deliberately does NOT — "[Cap: 12]" on one month's event is a fact
 * about the room that month, and a program's months genuinely differ.
 *
 * Returns the same array, mutated in place.
 */
function unifyProgramFlagsAcrossGroups(groups) {
  const byProgram = {};
  groups.forEach(g => {
    const key = `${g.scope}::${g.cleanTitle}`;
    if (!byProgram[key]) {
      byProgram[key] = { isClub: false, noRegistration: false, isAssistance: false,
        slotMinutes: 0, maxPerMonth: 0, groups: [] };
    }
    const p = byProgram[key];
    p.groups.push(g);
    if (g.isClub) p.isClub = true;
    if (g.noRegistration) p.noRegistration = true;
    if (g.isAssistance) p.isAssistance = true;
    if (!p.slotMinutes && g.slotMinutes) p.slotMinutes = g.slotMinutes;
    if (!p.maxPerMonth && g.maxPerMonth) p.maxPerMonth = g.maxPerMonth;
  });

  Object.keys(byProgram).forEach(key => {
    const p = byProgram[key];
    if (p.groups.length < 2) return; // nothing to spread; keep the log quiet
    const spread = [];
    p.groups.forEach(g => {
      if (p.isClub && !g.isClub) { g.isClub = true; spread.push(CLUB_TAG); }
      if (p.noRegistration && !g.noRegistration) { g.noRegistration = true; spread.push(NO_REGISTRATION_TAG); }
      if (p.isAssistance && !g.isAssistance) { g.isAssistance = true; spread.push(ASSISTANCE_TAG); }
      if (p.slotMinutes && !g.slotMinutes) g.slotMinutes = p.slotMinutes;
      if (p.maxPerMonth && !g.maxPerMonth) g.maxPerMonth = p.maxPerMonth;
    });
    if (spread.length > 0) {
      const title = p.groups[0].cleanTitle;
      log(`ℹ️ "${title}": ${dedupePreservingOrder(spread).map(t => `[${t}]`).join(' ')} is tagged on some of its ` +
        `calendar events but not all of them — applying it to all ${p.groups.length} month(s) of the program. ` +
        `Put the tag on every event (or tick the box on the dashboard, which writes it to all of them) to ` +
        `silence this.`);
    }
  });
  return groups;
}

/**
 * ONE PROGRAM GROUP, IN WORDS — "Low-Cost Wills (Narberth · September 2026)
 * [Personalized Assistance, Slots: 20] — 3 date(s)".
 *
 * WHY THIS EXISTS. The calendar sync identified programs in its log by GROUP
 * KEY, which is `scope::cleanTitle::span` — and `scope` is a calendar ID:
 *
 *   Reused existing form for "c7706e8a3c057e02a4adca78268262aeb7116b9717b93
 *   25926bf746728566faa@group.calendar.google.com::Low-Cost Wills::September 2026"
 *
 * Everything a person wants is in there and none of it is legible: which
 * building, which month, and — the question the log is actually opened to
 * answer — what this run thinks the program IS. A line that names the program,
 * the place, the span and the tags says in one glance whether the sync agrees
 * with the calendar, which is the whole diagnostic.
 *
 * The group key is still what the code keys on and is still logged where the
 * key itself is the subject (a form registry entry, a repoint). It is not what
 * a log line about a PROGRAM should say.
 */
function describeGroup(group) {
  if (!group) return '(unknown program)';
  const where = describeLocations(group.locations || []) ||
    (group.calendarId ? CALENDAR_MAP[group.calendarId] || group.calendarId : '');
  const when = group.isFixed
    ? 'whole series' + (group.seriesWeeks ? `, ~${group.seriesWeeks} week(s)` : '')
    : (group.monthLabel || '');
  const scope = [where, when].filter(Boolean).join(' · ');
  const tags = describeGroupTags(group);
  const dates = group.sessions ? `${group.sessions.length} date(s)` : '';
  return `"${group.cleanTitle}"${scope ? ` (${scope})` : ''}${tags ? ` ${tags}` : ''}` +
    `${dates ? ` — ${dates}` : ''}`;
}

/**
 * The tags a group resolved to, as they would be written in a description:
 * "[Club, Grouped, Cap: 12]". Empty string when a program is an ordinary
 * untagged one, so describeGroup() does not print "[]" for most of them.
 *
 * This is the half of a log line that turns "the sync ran" into "the sync ran
 * and read this program as an appointment program" — the fact that was
 * unavailable anywhere, at any log level, while [Personalized Assistance] was
 * being silently dropped.
 */
function describeGroupTags(group) {
  const tags = [];
  if (group.isShared) tags.push(SHARED_LOCATION_TAG);
  if (group.noRegistration) tags.push(NO_REGISTRATION_TAG);
  if (group.isClub) tags.push(CLUB_TAG);
  if (group.isAssistance) {
    tags.push(ASSISTANCE_TAG);
    tags.push(`Slots: ${resolveSlotMinutes(group)}`);
    if (group.maxPerMonth > 0) tags.push(`Max Per Month: ${group.maxPerMonth}`);
  }
  tags.push(group.isFixed ? EVENT_TYPES.GROUPED : EVENT_TYPES.REGULAR);
  if (group.capacity > 0) tags.push(`Cap: ${group.capacity}`);
  return `[${tags.join(', ')}]`;
}

/**
 * A FORM, AS SOMETHING SOMEBODY CAN OPEN — its edit URL, not its ID.
 *
 * A bare form ID in a log line is a dead end: to act on it a person has to
 * know that a form ID is pasted into docs.google.com/forms/d/<id>/edit, and
 * most of the people reading this log do not. The ID is still right there in
 * the middle of the URL for anyone matching it against the Form_ID column.
 *
 * `title` is optional and is worth passing wherever the caller already knows
 * it — this deliberately does NOT open the form to look it up, because these
 * lines are written in loops over every form on the workbook and a round trip
 * apiece to decorate a log message is not a trade worth making.
 */
function describeFormLink(formId, title) {
  const id = String(formId || '').trim();
  if (!id) return 'no form';
  return `${title ? `"${title}" ` : ''}(${FORM_EDIT_URL_PREFIX}${id}/edit)`;
}

/** Where a form ID becomes something clickable. */
const FORM_EDIT_URL_PREFIX = 'https://docs.google.com/forms/d/';

/** The [{date, location, title}] sessions of a group, in the shape the form layer wants. */
function sessionsOfGroup(group) {
  // A lunch-only group has no calendar events to take its dates from — its
  // sessions come from Lunch_Schedule and arrive already in this shape. See
  // syncLunchOnlySessions().
  if (group.lunchOnlySessions) return group.lunchOnlySessions;
  return group.sessions.map(s => ({
    date: s.event.getStartTime(),
    // Carried so the form's description can say what TIME the session runs at
    // — see sessionTimeRangeForDisplay(). Every other consumer of this shape
    // ignores it.
    end: s.event.getEndTime(),
    location: s.locationName,
    title: group.cleanTitle
  }));
}

/**
 * Scans the current per-session table (both Upcoming and Past zones) to
 * build eventIds (every Event_ID already recorded) and groupFormMap
 * (groupKey -> Form_ID already generated), falling back to the persistent
 * registry for any group whose session rows aren't currently on the sheet.
 */
function getExistingRegistryState(registrySheet) {
  // blockedPrograms: `calendarId|title` for every program whose rows currently
  // say "— no registration —". Carried so collectCalendarWork() can tell the
  // difference between a program that is up to date and one that is up to date
  // BUT still showing the marks of a [No Registration] tag that has since come
  // off — the second one has work to do even though it has no new dates.
  const state = { eventIds: new Set(), groupFormMap: {}, blockedPrograms: new Set() };
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = getSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);

  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (eventId) state.eventIds.add(eventId);

    if (String(row[map['Form_Response_Link']] || '').trim() === NO_REGISTRATION_LINK_LABEL) {
      state.blockedPrograms.add(
        `${String(row[map['Calendar_Source']] || '').trim()}|${String(row[map['Clean_Title']] || '').trim()}`);
    }

    const source = row[map['Calendar_Source']];
    const title = row[map['Clean_Title']];
    const typeTag = row[map['Type_Tag']];
    const formId = row[map['Form_ID']];
    if (!source || !title || !formId) return;

    // The ::FIXED group-key suffix is deliberately NOT renamed alongside the
    // Type_Tag vocabulary: it's an internal key already persisted in the
    // form registry (Script Properties) and matched against buildEventGroups()'
    // output. Renaming it would orphan every stored entry and duplicate every
    // grouped form. isGroupedTypeTag() reads both spellings of the VALUE,
    // which is the part users see — see formSpanForRow().
    const key = `${source}::${title}::${formSpanForRow(typeTag, row[map['Event_Date']])}`;
    if (!state.groupFormMap[key]) state.groupFormMap[key] = formId;
  });

  addSharedGroupKeysFromRows(state, rows, map);

  const persistent = getPersistentFormRegistry();
  Object.keys(persistent).forEach(key => {
    if (!state.groupFormMap[key]) state.groupFormMap[key] = persistent[key];
  });

  return state;
}

/**
 * Teaches the sheet-derived half of getExistingRegistryState() about
 * CROSS-LOCATION groups, whose key is scoped SHARED_LOCATION_SCOPE rather than
 * to any one calendar and so can never be reconstructed from a single row.
 *
 * It doesn't need a new column to do it: a form whose sessions span more than
 * one Calendar_Source IS a shared group's form — nothing else in this system
 * puts two calendars on one form. So the evidence is already on the sheet, and
 * the sheet stays a genuine fallback for a lost Script-Properties registry
 * (the case this whole function exists for) instead of quietly duplicating
 * every shared form the first time that registry is missing.
 */
function addSharedGroupKeysFromRows(state, rows, map) {
  const byForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const source = row[map['Calendar_Source']];
    const title = row[map['Clean_Title']];
    if (!formId || !source || !title) return;
    if (!byForm[formId]) byForm[formId] = { title, sources: new Set(), keys: new Set() };
    byForm[formId].sources.add(source);

    const span = formSpanForRow(row[map['Type_Tag']], row[map['Event_Date']]);
    byForm[formId].keys.add(`${SHARED_LOCATION_SCOPE}::${title}::${span}`);
  });

  Object.keys(byForm).forEach(formId => {
    const info = byForm[formId];
    if (info.sources.size < 2) return;
    info.keys.forEach(key => {
      if (!state.groupFormMap[key]) state.groupFormMap[key] = formId;
    });
  });
}


