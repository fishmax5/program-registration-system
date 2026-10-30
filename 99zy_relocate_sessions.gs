// ============================================================================
// 99zy. RELOCATING SESSIONS  (a building closes; its dates and people move)
// ============================================================================
//
// Numbered after `99zx` for the usual reason — never renumber. Behavior plus
// self-contained constants; everything it reaches for (the calendar readers in
// `08`/`21`, `processCalendarGroup` in `24`, the registrant and ledger writers
// in `99a`/`99k`, `workbookLock` in `99w`) it reads at CALL time.
//
// THE PROBLEM. An Event_ID is `calendarId | cleanTitle | date` and each
// building has its own calendar, so moving an event to the other building's
// calendar gives it a NEW identity. Left to the hourly sync that reads as "a
// date was deleted and an unrelated one appeared": the registrants go to
// Deleted_Event_Triage and have to be re-entered through Bulk. Here it is one
// press instead.
//
// WHAT ONE RELOCATION DOES, per ticked date, in this order, because each step
// is only safe once the one before it has landed:
//   1. MOVE THE CALENDAR EVENT to the destination building's calendar
//      (advanced Calendar service `Events.move`; a date of a recurring series
//      is copied across and cancelled at the source instead — see
//      `relocateMoveCalendarEvent_`, because `CalendarApp`'s id is the SERIES').
//      If Google refuses, that date is skipped and reported and NOTHING else
//      is touched for it.
//   2. LOAD THE DATE at the destination through the sync's own
//      `processCalendarGroup` (the same call the weekend loader, `80`, makes),
//      so it gets its program's form, its row and its registration link
//      exactly as a date the sync loaded would.
//   3. MOVE THE REGISTRANTS onto the destination's Event_ID — the same writes
//      `99a`'s Move makes (tombstone the old key first, rewrite the row, lift
//      the destination's tombstone, one `moved` ledger entry per person), in
//      one pass over the tab rather than a render per person. The destination
//      Event_ID is READ BACK off the session table, never computed, because
//      `canonicalEventTitle_` may have folded the title onto a spelling the
//      destination already holds.
//   4. DROP THE OLD SESSION ROW and set `Room_Override` on the new one, in one
//      session-table render, then recount.
//
// THE DATE DOES NOT CHANGE, so attendance and lunch marks stay; a meal is
// dropped only where the destination serves none that day (`99a`'s rule).
//
// IT HOLDS THE WORKBOOK LOCK for the whole thing and refuses while a sync
// holds it: a sync landing between steps 1 and 3 would read the old date as
// deleted and triage the very people being moved.
//
// WHAT IS NOT HERE, deliberately: it is not a sliced job. A press works to
// `RELOCATE_BUDGET_MS` and stops BETWEEN dates; anything it did not reach is
// still on the source calendar, so the dialog's rescan lists it and a second
// press finishes. Each date is independent and the whole sequence is
// idempotent, which is what makes that safe — but it IS "press again", and a
// very large move belongs on `runSlicedJob` (`75`).
// ============================================================================

/** How far ahead the dialog offers dates from. */
const RELOCATE_WINDOW_FORWARD_DAYS = 120;

/** Stop starting new dates after this long, leaving room for the recount and renders. */
const RELOCATE_BUDGET_MS = 4 * 60 * 1000;

/** The lock wait: a sync slice holds the workbook for minutes, so this is generous. */
const RELOCATE_LOCK_WAIT_MS = 30 * 1000;

/** MENU ENTRY. */
function showRelocateSessionsDialog() {
  if (isBootstrapActive()) {
    explainRefusal(bootstrapBusyMessage());
    return;
  }
  const state = relocateDialogState_();
  if (state.locations.length < 2) {
    explainRefusal('Relocating needs at least two building calendars in CALENDAR_MAP.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildRelocateSessionsHtml(state))
    .setWidth(700)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Move Sessions to Another Building');
}

/** Building names in CALENDAR_MAP order, with the calendar each one reads. */
function relocateLocations_() {
  return Object.keys(CALENDAR_MAP).map(calendarId => ({ calendarId, name: CALENDAR_MAP[calendarId] }));
}

/** The calendar id for a building name, or ''. */
function relocateCalendarIdForLocation_(name) {
  const wanted = String(name || '').trim().toLowerCase();
  const hit = relocateLocations_().filter(l => l.name.toLowerCase() === wanted)[0];
  return hit ? hit.calendarId : '';
}

/** What the dialog opens with: the buildings, and the listed rooms per building. */
function relocateDialogState_() {
  let rooms = [];
  try { rooms = readRoomsList(); } catch (err) { rooms = []; }
  return {
    locations: relocateLocations_().map(l => l.name),
    rooms: rooms.map(r => ({ building: r.building, label: r.label }))
  };
}

/**
 * READ-ONLY. Upcoming sessions on one building's calendar, grouped by program,
 * each with how many live registrants it holds. The same grouping 99m draws
 * (`Calendar_Source | Clean_Title`), so two buildings' "Chair Yoga" are two
 * programs.
 *
 * Returns [{ key, label, sessions: [{ eventId, dateKey, label, people }] }].
 */
function listRelocatableSessions(fromLocation) {
  const calendarId = relocateCalendarIdForLocation_(fromLocation);
  if (!calendarId) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];

  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const sessionRows = getSectionedRowValues(sheet, headers, 'Event_ID');

  const regSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  let peopleByEvent = {};
  if (regSheet) {
    const regMap = getIndexMap(HEADERS.All_Registrants);
    peopleByEvent = countLiveRegistrantsByEvent_(
      getSectionedRowValues(regSheet, HEADERS.All_Registrants, 'Event_ID'), regMap);
  }
  return groupRelocatableSessions_(sessionRows, map, calendarId, peopleByEvent,
    formatDateKey(new Date()),
    formatDateKey(new Date(Date.now() + RELOCATE_WINDOW_FORWARD_DAYS * 86400000)));
}

/** Pure. { eventId: liveRegistrantCount } — Cancelled and Superseded rows are not people on a roster. */
function countLiveRegistrantsByEvent_(rows, map) {
  const out = {};
  (rows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return;
    const status = String(row[map['Program_Status']] || '').trim() || 'Active';
    if (status === 'Cancelled' || status === 'Superseded') return;
    out[eventId] = (out[eventId] || 0) + 1;
  });
  return out;
}

/** Pure. The dialog's program list for one calendar. */
function groupRelocatableSessions_(sessionRows, map, calendarId, peopleByEvent, todayKey, limitKey) {
  const byProgram = {};
  const order = [];
  (sessionRows || []).forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const source = String(row[map['Calendar_Source']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    const eventId = String(row[map['Event_ID']] || '').trim();
    // No Calendar_Source means a lunch or hand-typed row: no event to move.
    if (!title || source !== calendarId || !date || !eventId) return;
    const dateKey = formatDateKey(date);
    if (dateKey < todayKey || dateKey > limitKey) return;
    if (!byProgram[title]) {
      byProgram[title] = { key: title, title, sessions: [] };
      order.push(title);
    }
    const time = String(row[map['Event_Time']] || '').trim();
    const people = (peopleByEvent && peopleByEvent[eventId]) || 0;
    byProgram[title].sessions.push({
      eventId,
      dateKey,
      people,
      label: `${formatDateLabel(date)}${time ? ` · ${time}` : ''}${people ? ` · ${people} registered` : ''}`
    });
  });
  return order.map(t => byProgram[t]).map(p => {
    p.sessions.sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
    p.label = `${p.title} — ${p.sessions.length} upcoming date(s)`;
    return p;
  }).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Pure. Which of the ticked Event_IDs are still sessions on the source
 * calendar, as `{ eventId, row, title, date, dateKey }`; the rest come back in
 * `missing` (already moved, or gone from the table since the dialog opened).
 */
function planRelocation_(sessionRows, map, eventIds, fromCalendarId) {
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  const items = [];
  const found = new Set();
  (sessionRows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!wanted.has(eventId) || found.has(eventId)) return;
    if (String(row[map['Calendar_Source']] || '').trim() !== fromCalendarId) return;
    const date = coerceDate(row[map['Event_Date']]);
    const title = String(row[map['Clean_Title']] || '').trim();
    if (!date || !title) return;
    found.add(eventId);
    items.push({ eventId, row, title, date, dateKey: formatDateKey(date) });
  });
  items.sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
  return { items, missing: Array.from(wanted).filter(id => !found.has(id)) };
}

/**
 * Pure (apart from the lunch lookup passed in). Moves every registrant row on
 * `fromEventId` onto the destination session `to` = { eventId, location,
 * date } and returns what changed: `{ moved: [{ row, ledgerId, fromEventId }],
 * mealsDropped }`.
 *
 * The caller has ALREADY recorded the tombstones for the old keys and read the
 * ledger ids (both resolve through the Event_ID this rewrites).
 */
function relocateRegistrantRows_(rows, map, fromEventId, to, lunchOffered, noteText) {
  const moved = [];
  let mealsDropped = 0;
  rows.forEach(row => {
    if (String(row[map['Event_ID']] || '').trim() !== fromEventId) return;
    // A superseded row is history the tab keeps; it stays on the old session.
    if (String(row[map['Program_Status']] || '').trim() === 'Superseded') return;
    const ledgerId = ledgerIdForRegistrantRow(row, map);
    row[map['Location']] = to.location;
    row[map['Event_ID']] = to.eventId;
    if (String(row[map['Program_Status']] || '').trim() === 'Active' && map['Lunch_Status'] !== undefined) {
      const type = String(row[map['Lunch_Type']] || '').trim();
      if (type && type !== 'No Lunch' && !lunchOffered) {
        row[map['Lunch_Type']] = 'No Lunch';
        row[map['Lunch_Status']] = 'No Lunch';
        writeMealsOrdered(row, map, 0);
        mealsDropped++;
      }
    }
    row[map['Manual_Override']] = 'Manually Edited';
    appendAdminNote(row, map, noteText);
    moved.push({ row, ledgerId, fromEventId });
  });
  return { moved, mealsDropped };
}

/** The Google Calendar API id of a CalendarApp event ("abc@google.com" → "abc"). */
function relocateApiEventId_(event) {
  return String(event.getId() || '').split('@')[0];
}

/**
 * The Calendar API resource for ONE CalendarApp event. `CalendarApp`'s getId()
 * is the SERIES id for every date of a recurring event, so moving by it moved
 * the whole series on the first date and left every later date "not found" —
 * the move looked stuck after one change. The API's own instance (its own id,
 * carrying `recurringEventId`) is found by listing the event's slot with
 * `singleEvents`. Returns null when it cannot be told apart.
 */
function relocateFindApiEvent_(calendarId, event) {
  const startMs = event.getStartTime().getTime();
  const found = Calendar.Events.list(calendarId, {
    timeMin: new Date(startMs).toISOString(),
    timeMax: new Date(event.getEndTime().getTime()).toISOString(),
    singleEvents: true,
    maxResults: 50
  });
  const title = String(event.getTitle() || '');
  const hits = ((found && found.items) || []).filter(item => {
    const dt = item.start && item.start.dateTime;
    return dt && new Date(dt).getTime() === startMs && String(item.summary || '') === title;
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Moves ONE date to the other calendar. A plain event is moved. An instance of
 * a recurring event is not moved (Google offers no calendar change for a single
 * instance, and moving the series would take every date): a standalone copy is
 * inserted at the destination first, then the instance is cancelled at the
 * source, and a failed cancel takes the copy back out so the date is never on
 * both. No guest is mailed by either step.
 */
function relocateMoveCalendarEvent_(fromCalendarId, toCalendarId, event) {
  const api = relocateFindApiEvent_(fromCalendarId, event);
  if (!api) throw new Error('could not tell this date from the rest of its series');
  if (!api.recurringEventId) {
    Calendar.Events.move(fromCalendarId, api.id, toCalendarId, { sendUpdates: 'none' });
    return;
  }
  const copy = {
    summary: api.summary, description: api.description, location: api.location,
    start: api.start, end: api.end, colorId: api.colorId, transparency: api.transparency,
    visibility: api.visibility, attendees: api.attendees, reminders: api.reminders
  };
  Object.keys(copy).forEach(k => { if (copy[k] === undefined) delete copy[k]; });
  const inserted = Calendar.Events.insert(copy, toCalendarId, { sendUpdates: 'none' });
  try {
    Calendar.Events.remove(fromCalendarId, api.id, { sendUpdates: 'none' });
  } catch (err) {
    try { Calendar.Events.remove(toCalendarId, inserted.id, { sendUpdates: 'none' }); } catch (ignored) { /* reported below */ }
    throw err;
  }
}

/**
 * Called from the dialog. `roomLabel` is optional and must be on the Rooms
 * list for the destination building; it becomes `Room_Override` on each moved
 * date. Returns a summary string, "⚠️"-prefixed when nothing (or not all) went.
 */
function relocateSessions(eventIds, toLocation, roomLabel) {
  const toCalendarId = relocateCalendarIdForLocation_(toLocation);
  if (!toCalendarId) return '⚠️ Pick the building to move them to — nothing was changed.';
  if (!eventIds || eventIds.length === 0) return '⚠️ Nothing was ticked — nothing was changed.';
  if (isBootstrapActive()) return `⚠️ ${bootstrapBusyMessage()}`;

  let room = '';
  const wantedRoom = String(roomLabel || '').trim();
  if (wantedRoom) {
    const listed = readRoomsList().filter(r => roomKey_(r.label) === roomKey_(wantedRoom))[0];
    if (!listed) return `⚠️ "${wantedRoom}" is not on the Rooms list (Room Management) — nothing was changed.`;
    room = listed.label;
  }

  const lock = workbookLock('Relocate sessions');
  if (!lock.tryLock(RELOCATE_LOCK_WAIT_MS)) {
    return '⚠️ A sync is running — it would read the old dates as deleted. Try again in a minute. Nothing was changed.';
  }
  try {
    return relocateSessionsLocked_(eventIds, toLocation, toCalendarId, room);
  } finally {
    lock.releaseLock();
  }
}

function relocateSessionsLocked_(eventIds, toLocation, toCalendarId, room) {
  const startedAt = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionSheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);

  // The source calendar is whatever the ticked rows say; a dialog is one source.
  const rows0 = getSectionedRows(sessionSheet, headers, 'Event_ID');
  const wanted = new Set(eventIds.map(String));
  const fromCalendarIds = Array.from(new Set(rows0
    .filter(r => wanted.has(String(r[map['Event_ID']] || '').trim()))
    .map(r => String(r[map['Calendar_Source']] || '').trim()).filter(Boolean)));
  if (fromCalendarIds.length === 0) {
    return '⚠️ Those dates are no longer on the session table — rescan to see what is left.';
  }
  if (fromCalendarIds.length > 1) return '⚠️ Pick dates from one building at a time.';
  const fromCalendarId = fromCalendarIds[0];
  if (fromCalendarId === toCalendarId) return '⚠️ Those dates are already at that building.';

  const plan = planRelocation_(rows0, map, eventIds, fromCalendarId);
  const problems = [];
  plan.missing.forEach(id => problems.push(`${id} is no longer a session on the source calendar.`));

  // 1. THE CALENDAR EVENTS. Nothing else is touched for a date Google refuses.
  const moved = [];
  __calendarDayEventsCache = {};
  for (const item of plan.items) {
    if (Date.now() - startedAt > RELOCATE_BUDGET_MS) break;
    const event = findCalendarEventForSession(
      { calendarId: fromCalendarId, date: item.date, title: item.title });
    if (!event) {
      problems.push(`${item.title} ${item.dateKey}: no matching event on the source calendar.`);
      continue;
    }
    try {
      relocateMoveCalendarEvent_(fromCalendarId, toCalendarId, event);
      moved.push(item);
    } catch (err) {
      problems.push(`${item.title} ${item.dateKey}: Google would not move the event (${err}).`);
    }
  }
  const notReached = plan.items.length - moved.length -
    problems.filter(p => !/is no longer a session/.test(p)).length;
  if (moved.length === 0) {
    return `⚠️ Nothing was moved.\n${problems.join('\n')}`;
  }

  // 2. LOAD THE DATES AT THE DESTINATION through the sync's own group loader.
  __calendarDayEventsCache = {};
  invalidateCalendarEventsCache();
  invalidateSectionedRowsCache();
  const keys = moved.map(m => m.dateKey).sort();
  const start = parseDateKey(keys[0]);
  const end = new Date(parseDateKey(keys[keys.length - 1]).getTime() + 86400000 - 1000);
  const existingState = getExistingRegistryState(sessionSheet);
  const groups = buildGroupsForWindow(getCalendarEventsForWindow(start, end),
    { ordinaryEnd: end, assistanceEnd: end });
  const movedKeys = new Set(moved.map(m => `${quickMarkTitleKey(m.title)}|${m.dateKey}`));
  groups.forEach(group => {
    const chosen = group.sessions.filter(session => {
      if (session.calendarId !== toCalendarId) return false;
      const key = `${quickMarkTitleKey(group.cleanTitle)}|${formatDateKey(session.event.getStartTime())}`;
      const eventId = computeEventId(session.calendarId, group.cleanTitle,
        formatDateKey(session.event.getStartTime()));
      return movedKeys.has(key) && !existingState.eventIds.has(eventId);
    });
    if (chosen.length === 0) return;
    try {
      processCalendarGroup(sessionSheet, {
        group,
        configInfo: { footerNote: buildFooterNoteForLocations(group.locations) },
        newSessions: chosen
      }, existingState);
    } catch (err) {
      problems.push(`${group.cleanTitle}: the destination form could not be set up (${err}).`);
    }
  });
  flushPersistentRegistries();
  invalidateSectionedRowsCache();

  // 3 + 4. READ THE DESTINATION BACK, move the people, and redraw once.
  const sessionRows = getSectionedRows(sessionSheet, headers, 'Event_ID');
  const destByKey = {};
  sessionRows.forEach(row => {
    if (String(row[map['Calendar_Source']] || '').trim() !== toCalendarId) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    destByKey[`${quickMarkTitleKey(row[map['Clean_Title']])}|${formatDateKey(date)}`] = row;
  });

  const regSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const regMap = getIndexMap(HEADERS.All_Registrants);
  const regRows = regSheet ? getSectionedRows(regSheet, HEADERS.All_Registrants, 'Event_ID') : [];

  const completed = [];
  let peopleMoved = 0;
  let mealsDropped = 0;
  moved.forEach(item => {
    const dest = destByKey[`${quickMarkTitleKey(item.title)}|${item.dateKey}`];
    if (!dest) {
      problems.push(`${item.title} ${item.dateKey}: moved on the calendar, but the destination row did not ` +
        `appear — run Sync Cal; the people are still on the old date.`);
      return;
    }
    const toEventId = String(dest[map['Event_ID']] || '').trim();
    const fromLabel = `${item.title} — ${formatDateLabel(item.date)} (${CALENDAR_MAP[fromCalendarId]})`;
    const onOld = regRows.filter(r =>
      String(r[regMap['Event_ID']] || '').trim() === item.eventId &&
      String(r[regMap['Program_Status']] || '').trim() !== 'Superseded');
    // THE TOMBSTONES FIRST, while the rows still say where they came from.
    recordRegistrantTombstones(onOld, regMap);
    const result = relocateRegistrantRows_(regRows, regMap, item.eventId,
      { eventId: toEventId, location: toLocation, date: item.date },
      isLunchOfferedOn(item.date, toLocation),
      waitlistStamp(`Moved with the program from ${fromLabel} to ${toLocation}`, {}));
    clearRegistrantTombstones(result.moved.map(m => registrantTombstoneKey(
      toEventId, m.row[regMap['Name']], m.row[regMap['Person_Type']])));
    result.moved.forEach(m => {
      appendLedgerEntry(makeLedgerEntry({
        kind: LEDGER_KINDS.MOVED,
        source: LEDGER_SOURCES.RELOCATE,
        registrationId: m.ledgerId,
        eventId: toEventId,
        name: m.row[regMap['Name']],
        personType: m.row[regMap['Person_Type']],
        partyId: regMap['Party_ID'] === undefined ? '' : m.row[regMap['Party_ID']],
        payload: Object.assign({ from: m.fromEventId }, ledgerMovePayload_(m.row, regMap)),
        note: `Moved with the program from ${fromLabel} to ${toLocation}.`
      }));
    });
    peopleMoved += result.moved.length;
    mealsDropped += result.mealsDropped;
    if (room && map['Room_Override'] !== undefined) dest[map['Room_Override']] = room;
    completed.push(item.eventId);
  });

  // ONE session-table render: old rows out, Room_Override in. A confirmed
  // shrink (see 99x): the dialog was the confirmation.
  const done = new Set(completed);
  const keep = sessionRows.filter(r => !done.has(String(r[map['Event_ID']] || '').trim()));
  renderProgramDashboard(true, { sessionRows: keep, skipTriage: true, allowShrink: true });
  if (regSheet && peopleMoved > 0) {
    renderRegistrantsSheet(false, regRows);
    refreshCountsAfterRegistrantChange(ss, regSheet, regRows);
  } else {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet && regSheet) recomputeEventRegistryCounts(registrySheet, regSheet, regRows);
  }
  invalidateQuickMarkIndexCache();
  flushLedger();

  const summary = `${completed.length > 0 ? '✅' : '⚠️'} Moved ${completed.length} date(s) to ${toLocation} ` +
    `with ${peopleMoved} registrant(s).` +
    (mealsDropped ? ` ${mealsDropped} meal(s) dropped — no lunch is served there those days.` : '') +
    (notReached > 0 ? ` ${notReached} date(s) not reached — press again.` : '') +
    (room ? ` Room: ${room}.` : '') +
    (problems.length ? `\n⚠️ ${problems.join('\n⚠️ ')}` : '');
  log(`relocateSessions: ${summary}`);
  toastIfPossible(summary.split('\n')[0]);
  return summary;
}

/** The dialog. Everything from the workbook crosses into script through JSON, escaped for a script block. */
function buildRelocateSessionsHtml(state) {
  const json = JSON.stringify(JSON.stringify(state)).replace(/</g, '\\u003c');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  .bar { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 10px; flex-wrap: wrap; }
  .bar label { display: block; font-size: 12px; color: #444; }
  select { padding: 5px; font-size: 13px; }
  #list { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 300px; overflow-y: auto; }
  .prog { margin: 6px 0 2px 0; font-weight: bold; }
  label.row { display: block; padding: 1px 0 1px 14px; }
  .muted { color: #666; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
  button.secondary { background: #5f6368; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  .actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; white-space: pre-wrap; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Move sessions to another building</h3>
<p class="hint">
  Tick the dates to move. Each date moves to the other building's calendar <b>with everyone registered
  on it</b> — their rows, history and meals go along; the date gets the destination program's form.
  Attendance marks stay (the day does not change).
</p>
<div class="bar">
  <div><label for="from">From</label><select id="from" onchange="scan()"></select></div>
  <div><label for="to">To</label><select id="to" onchange="fillRooms()"></select></div>
  <div><label for="room">Room there (optional)</label><select id="room"></select></div>
  <button class="secondary" onclick="scan()">Rescan</button>
</div>
<div id="list"><span class="muted">Looking at the session table…</span></div>
<div class="actions">
  <button id="go" onclick="go()">Move ticked dates</button>
  <button class="secondary" onclick="setAll(true)">Tick all</button>
  <button class="secondary" onclick="setAll(false)">Clear</button>
</div>
<div id="status"></div>
<script>
  var STATE = JSON.parse(${json});
  var from = document.getElementById('from'), to = document.getElementById('to'), room = document.getElementById('room');
  STATE.locations.forEach(function (n) {
    from.appendChild(new Option(n, n)); to.appendChild(new Option(n, n));
  });
  from.value = STATE.locations[0];
  to.value = STATE.locations[1];
  function fillRooms() {
    room.innerHTML = '';
    room.appendChild(new Option('(set later)', ''));
    STATE.rooms.filter(function (r) { return r.building === to.value; })
      .forEach(function (r) { room.appendChild(new Option(r.label, r.label)); });
  }
  function scan() {
    document.getElementById('go').disabled = true;
    document.getElementById('list').innerHTML = '<span class="muted">Looking at the session table…</span>';
    say('', '');
    google.script.run.withSuccessHandler(draw).withFailureHandler(function (e) { say('Failed: ' + e.message, 'err'); })
      .listRelocatableSessions(from.value);
  }
  function draw(programs) {
    document.getElementById('go').disabled = false;
    var box = document.getElementById('list');
    box.innerHTML = '';
    if (!programs.length) { box.innerHTML = '<span class="muted">No upcoming dates on that calendar.</span>'; return; }
    programs.forEach(function (p) {
      var h = document.createElement('div'); h.className = 'prog'; h.textContent = p.label;
      var all = document.createElement('input'); all.type = 'checkbox'; all.style.marginRight = '6px';
      all.onchange = function () { p.sessions.forEach(function (s, i) { document.getElementById('s_' + p.key + i).checked = all.checked; }); };
      h.insertBefore(all, h.firstChild); box.appendChild(h);
      p.sessions.forEach(function (s, i) {
        var l = document.createElement('label'); l.className = 'row';
        var c = document.createElement('input'); c.type = 'checkbox'; c.name = 'ev'; c.value = s.eventId;
        c.id = 's_' + p.key + i;
        l.appendChild(c); l.appendChild(document.createTextNode(' ' + s.label)); box.appendChild(l);
      });
    });
  }
  function setAll(on) { [].slice.call(document.querySelectorAll('input[name=ev]')).forEach(function (e) { e.checked = on; }); }
  function go() {
    var picked = [].slice.call(document.querySelectorAll('input[name=ev]:checked')).map(function (e) { return e.value; });
    if (!picked.length) { say('Tick at least one date first.', 'err'); return; }
    if (from.value === to.value) { say('Pick two different buildings.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Moving… each date moves its calendar event, loads the form and moves the people.', '');
    google.script.run
      .withSuccessHandler(function (msg) { say(msg, msg.indexOf('\\u2705') === 0 ? 'ok' : 'err'); scan(); })
      .withFailureHandler(function (e) { document.getElementById('go').disabled = false; say('Failed: ' + e.message, 'err'); })
      .relocateSessions(picked, to.value, room.value);
  }
  function say(m, c) { var el = document.getElementById('status'); el.textContent = m; el.className = c; }
  fillRooms();
  scan();
</script>`;
}
