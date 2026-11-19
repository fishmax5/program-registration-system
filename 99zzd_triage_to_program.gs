// ============================================================================
// 99zzd. PUTTING TRIAGED PEOPLE ON THEIR NEW PROGRAM
// ============================================================================
//
// Numbered after `99zzc` for the usual reason — never renumber. Behavior plus
// self-contained constants; everything it reaches for (the triage tab in `26`/
// `39`, the registrant and ledger writers in `99a`/`99k`, the tombstones in
// `28`, `workbookLock` in `99w`) it reads at CALL time.
//
// THE PROBLEM. An Event_ID is `calendarId | cleanTitle | date`, so a program
// that is renamed, or moved to the other building's calendar by hand rather
// than through `99zy`, reads to the sync as "these dates were deleted": its
// people go to Deleted_Event_Triage (`moveRegistrantsToTriage`, `26`) and are
// on NO roster from then on. `22` catches a clean rename, and only that; the
// rest wait on triage until somebody re-enters them. In November 2026 that was
// 522 future seats, 127 of them with a live session for the same day under the
// program's new name or building.
//
// The two ways back before this file were both short of it:
//   - `restoreTriagedRegistrants` (`26`) puts a row back only when its OLD
//     Event_ID is live again. A renamed or moved program never is.
//   - Bulk's "from a deleted session" (`99q`) re-enters people one session at
//     a time as NEW registrations, so the ledger cannot tell that the person
//     on Ashbridge's roster is the one who signed up for Narberth's.
//
// WHAT ONE PRESS DOES. Pick a triaged program (its old title and building) and
// the live program its people belong on. For every triaged seat from today on
// that still holds a place (Active or Waitlisted):
//   - the destination has ONE session that day → the seat MOVES onto it: the
//     row goes back on All_Registrants with the destination's Event_ID, title,
//     time and building, the same writes `99zy` makes (the old key tombstoned
//     first, a stamp in Admin_Notes, the destination's tombstone lifted, one
//     `moved` ledger entry under `LEDGER_SOURCES.TRIAGE_MOVE`), and the
//     triage row comes off;
//   - the person is ALREADY on that session (another sign-up, a club
//     catch-up) → nothing is added, the triaged copy comes off, and the ledger
//     records the copy as `removed`, so the alarm does not then report it as
//     missing;
//   - the person is on that session but CANCELLED there → left on triage: they
//     gave that place up, and only the office knows whether to undo that;
//   - no session that day, or two on the day and the time does not decide →
//     left on triage, listed, for a person to decide.
// The DATE never changes, so a seat only ever lands on the same day. Guests
// move with the rows that are theirs; Cancelled and Superseded triage rows
// are history and stay where they are.
//
// THE PREVIEW IS THE CONFIRMATION, and the press re-plans from a fresh read and
// refuses if the number it would move is not the number the preview showed:
// the tab can change under an open dialog (a sync triages more, somebody else
// presses), and moving people the office was not shown is the one thing this
// must not do.
//
// IT IS NOT A SLICED JOB, and that is the conventions' rule weighed rather than
// skipped: what a press costs does not grow with the people in it. It is one
// read of three tabs, one render of All_Registrants, one of the triage tab and
// one ledger flush, whether it moves one seat or a hundred, so there is no
// "ran out of time halfway" to hand on. It holds the workbook lock and refuses
// while a sync holds it (a sync landing mid-press could triage the session
// being written). The registrants are written BEFORE the triage rows come off:
// a press that dies between the two leaves people on both tabs, and the next
// press finds them "already there" and clears the copies — never the other way
// round, which would lose them.
//
// WHAT IT DOES NOT DO: tell anybody. A moved row mails nobody (registrant
// alerts are for appointment programs and special events), and a club member
// moved here is not added to the destination club's Club_Members list — the
// office does both by hand.
// ============================================================================

/** The lock wait: a sync slice holds the workbook for minutes, so this is generous. */
const TRIAGE_MOVE_LOCK_WAIT_MS = 30 * 1000;

/** How many destination programs the dialog suggests first. */
const TRIAGE_MOVE_SUGGESTIONS = 5;

/** Statuses that hold a place: the only triage rows worth putting back. */
const TRIAGE_MOVE_HOLDING_STATUSES = ['Active', 'Waitlisted', ''];

/**
 * Words that say nothing about which program a title is, for the suggestions.
 * The second line is the kind-of-thing words: on the live workbook "Walking
 * Club" was suggested "Art in Nature Club" and "Mat Yoga Workshop" was
 * suggested "Art Workshop" on the strength of them alone.
 */
const TRIAGE_MOVE_TITLE_NOISE = ['the', 'a', 'an', 'at', 'in', 'of', 'for', 'and', 'with', 'to', 'on', 'only', 'w',
  'club', 'group', 'class', 'workshop', 'discussion', 'program', 'session', 'meeting'];

/** MENU ENTRY. */
function showTriageToProgramDialog() {
  if (isBootstrapActive()) {
    explainRefusal(bootstrapBusyMessage());
    return;
  }
  const html = HtmlService.createHtmlOutput(buildTriageToProgramHtml())
    .setWidth(760)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'Put Triaged People on Their New Program');
}

// --- pure: who is where ------------------------------------------------------

/** Pure. The program a triage row came from: the title and building it was triaged under. */
function triageMoveSourceOf_(row, tMap) {
  const title = String(row[tMap['Deleted_Event_Title']] || '').trim() || String(row[tMap['Event']] || '').trim();
  const location = String(row[tMap['Deleted_Event_Location']] || '').trim() ||
    String(row[tMap['Location']] || '').trim();
  return { title, location };
}

/** Pure. Do two { title, location } name one program? The title as the Quick Mark matches it, the building exactly. */
function triageMoveSameProgram_(a, b) {
  return quickMarkTitleKey(a.title) === quickMarkTitleKey(b.title) &&
    String(a.location || '').trim().toLowerCase() === String(b.location || '').trim().toLowerCase();
}

/** Pure. Is this triage row a future seat somebody still holds? */
function triageMoveHoldsSeat_(row, tMap, todayKey) {
  const date = coerceDate(row[tMap['Event_Date']]);
  if (!date || formatDateKey(date) < todayKey) return false;
  const status = String(row[tMap['Program_Status']] || '').trim();
  return TRIAGE_MOVE_HOLDING_STATUSES.indexOf(status) !== -1;
}

/**
 * Pure. The triaged programs with seats still to place, most seats first:
 * [{ title, location, seats, people, dateKeys, firstDateKey }].
 */
function listTriageMoveSources_(triageRows, tMap, todayKey) {
  const byKey = {};
  const order = [];
  (triageRows || []).forEach(row => {
    if (!triageMoveHoldsSeat_(row, tMap, todayKey)) return;
    const src = triageMoveSourceOf_(row, tMap);
    if (!src.title) return;
    const key = `${quickMarkTitleKey(src.title)}\u0001${src.location.toLowerCase()}`;
    if (!byKey[key]) {
      byKey[key] = { title: src.title, location: src.location, seats: 0, names: {}, dates: {} };
      order.push(key);
    }
    const g = byKey[key];
    g.seats++;
    g.names[normalizeNameKey(row[tMap['Name']])] = true;
    g.dates[formatDateKey(coerceDate(row[tMap['Event_Date']]))] = true;
  });
  return order.map(key => {
    const g = byKey[key];
    const dateKeys = Object.keys(g.dates).sort();
    return { title: g.title, location: g.location, seats: g.seats, people: Object.keys(g.names).length,
      dateKeys, firstDateKey: dateKeys[0] };
  }).sort((a, b) => b.seats - a.seats || a.title.localeCompare(b.title));
}

/**
 * Pure. Every program with a session from today on, by title and building:
 * [{ title, location, dateKeys }], alphabetical. A session with no Event_ID is
 * a hand-typed or lunch row, which nobody registers for.
 */
function listTriageMoveDestinations_(sessionRows, sMap, todayKey) {
  const byKey = {};
  (sessionRows || []).forEach(row => {
    const title = String(row[sMap['Clean_Title']] || '').trim();
    const location = String(row[sMap['Location']] || '').trim();
    const eventId = String(row[sMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sMap['Event_Date']]);
    if (!title || !eventId || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < todayKey) return;
    const key = `${quickMarkTitleKey(title)}\u0001${location.toLowerCase()}`;
    if (!byKey[key]) byKey[key] = { title, location, dates: {} };
    byKey[key].dates[dateKey] = true;
  });
  return Object.keys(byKey).map(k => ({
    title: byKey[k].title, location: byKey[k].location, dateKeys: Object.keys(byKey[k].dates).sort()
  })).sort((a, b) => a.title.localeCompare(b.title) || a.location.localeCompare(b.location));
}

/** Pure. A title's words that say which program it is: lower case, no punctuation, no filler. */
function triageMoveTitleWords_(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)
    .filter(w => w && TRIAGE_MOVE_TITLE_NOISE.indexOf(w) === -1);
}

/**
 * Pure. The live programs a triaged one most likely became, best first, each
 * with how many of the triaged dates it covers: [{ title, location, covered,
 * of }]. Only a program meeting on at least one of those dates AND sharing a
 * word of the title (or the very same title) is offered — a suggestion that
 * covers no date would place nobody, and one that shares no word is a guess.
 * The office still picks; this only orders the list.
 */
function suggestTriageMoveDestinations_(source, destinations) {
  const wanted = new Set(source.dateKeys || []);
  const words = triageMoveTitleWords_(source.title);
  const scored = [];
  (destinations || []).forEach(d => {
    const covered = d.dateKeys.filter(k => wanted.has(k)).length;
    if (covered === 0) return;
    const same = quickMarkTitleKey(d.title) === quickMarkTitleKey(source.title);
    const theirs = new Set(triageMoveTitleWords_(d.title));
    const shared = words.filter(w => theirs.has(w)).length;
    if (!same && shared === 0) return;
    const titleScore = same ? 2 : shared / Math.max(1, words.length);
    scored.push({ title: d.title, location: d.location, covered, of: wanted.size,
      score: titleScore * (covered / Math.max(1, wanted.size)) });
  });
  return scored.sort((a, b) => b.score - a.score || b.covered - a.covered || a.title.localeCompare(b.title))
    .slice(0, TRIAGE_MOVE_SUGGESTIONS)
    .map(s => ({ title: s.title, location: s.location, covered: s.covered, of: s.of }));
}

/**
 * Pure. THE PLAN: what a press would do with one triaged program, given the
 * destination program. Reads nothing and writes nothing.
 *
 * Returns {
 *   moves:          [{ triageRow, session, dateKey }]  — onto that session
 *   alreadyThere:   [{ triageRow, dateKey }]           — copy comes off triage
 *   cancelledThere: [{ triageRow, dateKey }]           — stays; the office decides
 *   noSession:      [{ triageRow, dateKey }]           — stays
 *   ambiguous:      [{ triageRow, dateKey }]           — stays: two sessions that day
 *   overCapacity:   [{ eventId, dateKey, label, capacity, active, adding, closed }]
 * }
 *
 * "Already there" is the person under the same name and Person_Type on the
 * destination session in any status but Superseded — two rows for one person
 * on one session is a duplicate, whatever the second one says. A second
 * triaged copy of the same person and date counts as already there behind the
 * first. Capacity is only REPORTED: these people held places before their
 * program moved, and whether to turn anybody away is the office's call.
 */
function planTriageMove_(input) {
  const tMap = input.tMap, sMap = input.sMap, rMap = input.rMap;
  const from = input.from, to = input.to;

  const sessionsByDate = {};
  (input.sessionRows || []).forEach(row => {
    const title = String(row[sMap['Clean_Title']] || '').trim();
    const location = String(row[sMap['Location']] || '').trim();
    const eventId = String(row[sMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sMap['Event_Date']]);
    if (!eventId || !date || !triageMoveSameProgram_({ title, location }, to)) return;
    const dateKey = formatDateKey(date);
    (sessionsByDate[dateKey] = sessionsByDate[dateKey] || []).push(row);
  });

  // Who is on each destination session already, by the identity a duplicate
  // would share: name (spelling-tolerant) and Person_Type.
  const onSession = {};
  const destIds = new Set();
  Object.keys(sessionsByDate).forEach(k => sessionsByDate[k].forEach(r =>
    destIds.add(String(r[sMap['Event_ID']] || '').trim())));
  (input.registrantRows || []).forEach(row => {
    const eventId = String(row[rMap['Event_ID']] || '').trim();
    if (!destIds.has(eventId)) return;
    const status = String(row[rMap['Program_Status']] || '').trim() || 'Active';
    if (status === 'Superseded') return;
    const key = triageMovePersonKey_(eventId, row[rMap['Name']], row[rMap['Person_Type']]);
    // A live row wins over a cancelled one for the same person.
    if (onSession[key] && onSession[key] !== 'Cancelled') return;
    onSession[key] = status;
  });

  const plan = { moves: [], alreadyThere: [], cancelledThere: [], noSession: [], ambiguous: [], overCapacity: [] };
  const triaged = (input.triageRows || []).filter(row =>
    triageMoveHoldsSeat_(row, tMap, input.todayKey) &&
    triageMoveSameProgram_(triageMoveSourceOf_(row, tMap), from));
  triaged.sort((a, b) => formatDateKey(coerceDate(a[tMap['Event_Date']]))
    .localeCompare(formatDateKey(coerceDate(b[tMap['Event_Date']]))));

  const adding = {};
  triaged.forEach(triageRow => {
    const dateKey = formatDateKey(coerceDate(triageRow[tMap['Event_Date']]));
    const sessions = sessionsByDate[dateKey] || [];
    let session = sessions.length === 1 ? sessions[0] : null;
    if (sessions.length > 1) {
      const time = String(triageRow[tMap['Event_Time']] || '').trim();
      const sameTime = sessions.filter(s => time && String(s[sMap['Event_Time']] || '').trim() === time);
      session = sameTime.length === 1 ? sameTime[0] : null;
      if (!session) { plan.ambiguous.push({ triageRow, dateKey }); return; }
    }
    if (!session) { plan.noSession.push({ triageRow, dateKey }); return; }

    const eventId = String(session[sMap['Event_ID']] || '').trim();
    const key = triageMovePersonKey_(eventId, triageRow[tMap['Name']], triageRow[tMap['Person_Type']]);
    const there = onSession[key];
    if (there === 'Cancelled') { plan.cancelledThere.push({ triageRow, dateKey }); return; }
    if (there) { plan.alreadyThere.push({ triageRow, dateKey }); return; }
    onSession[key] = String(triageRow[tMap['Program_Status']] || '').trim() || 'Active';
    plan.moves.push({ triageRow, session, dateKey });
    if (onSession[key] === 'Active') adding[eventId] = (adding[eventId] || 0) + 1;
  });

  if (Object.keys(adding).length > 0) {
    const seats = buildWaitlistSeatIndex(input.registrantRows || [], rMap, input.sessionRows || []);
    Object.keys(adding).forEach(eventId => {
      const seat = seats[eventId];
      if (!seat) return;
      if (!seat.closed && !(seat.capacity > 0 && seat.active + adding[eventId] > seat.capacity)) return;
      const move = plan.moves.filter(m => String(m.session[sMap['Event_ID']] || '').trim() === eventId)[0];
      plan.overCapacity.push({ eventId, dateKey: move.dateKey,
        label: formatDateLabel(coerceDate(move.session[sMap['Event_Date']])),
        capacity: seat.capacity, active: seat.active, adding: adding[eventId], closed: !!seat.closed });
    });
  }
  return plan;
}

/** Pure. One person on one session, for spotting a duplicate. */
function triageMovePersonKey_(eventId, name, personType) {
  return `${String(eventId || '').trim()}|${normalizeNameKey(name)}|${String(personType || '').trim()}`;
}

/**
 * Pure. What the dialog shows for a plan: counts, the dates, and names (the
 * dialog is inside the workbook, for the office). One line per date.
 */
function describeTriageMovePlan_(plan, tMap, sMap) {
  const name = r => String(r[tMap['Name']] || '').trim() +
    (String(r[tMap['Person_Type']] || '').trim() === 'Guest' ? ' (guest)' : '') +
    (String(r[tMap['Program_Status']] || '').trim() === 'Waitlisted' ? ' (waitlisted)' : '');
  const byDate = list => {
    const out = {};
    list.forEach(item => { (out[item.dateKey] = out[item.dateKey] || []).push(name(item.triageRow)); });
    return Object.keys(out).sort().map(k => ({ dateKey: k, label: formatDateLabel(parseDateKey(k)), names: out[k] }));
  };
  const times = {};
  plan.moves.forEach(m => {
    times[m.dateKey] = String(m.session[sMap['Event_Time']] || '').trim();
  });
  return {
    move: plan.moves.length,
    alreadyThere: plan.alreadyThere.length,
    stay: plan.cancelledThere.length + plan.noSession.length + plan.ambiguous.length,
    moves: byDate(plan.moves).map(d => Object.assign(d, { time: times[d.dateKey] || '' })),
    alreadyThereByDate: byDate(plan.alreadyThere),
    cancelledThere: byDate(plan.cancelledThere),
    noSession: byDate(plan.noSession),
    ambiguous: byDate(plan.ambiguous),
    overCapacity: plan.overCapacity.map(o => o.closed
      ? `${o.label}: that session is closed to new registrations (Waitlist_Only); ${o.adding} would be added anyway.`
      : `${o.label}: ${o.active} of ${o.capacity} seats taken; adding ${o.adding} puts it ` +
        `${o.active + o.adding - o.capacity} over.`)
  };
}

/**
 * Pure. A triage row in the All_Registrants layout, still on its OLD session.
 * Triage's columns are a superset of the registrant layout, so it copies by
 * header name, as `restoreTriagedRegistrants` does; the two link columns the
 * triage tab lacks are left blank and the render fills them.
 */
function triageRowAsRegistrant_(triageRow, tMap, rHeaders, rMap) {
  const row = new Array(rHeaders.length).fill('');
  rHeaders.forEach(h => { if (tMap[h] !== undefined) row[rMap[h]] = triageRow[tMap[h]]; });
  return row;
}

/**
 * Pure (apart from the lunch answer passed in). Puts a registrant-layout row on
 * the destination session: its date (the same day), time, building, title and
 * Event_ID, the meal where that day serves none, and the stamp. Returns
 * { mealDropped }.
 *
 * The caller resolves the ledger id BEFORE this — it is found through the old
 * Event_ID, which this rewrites.
 */
function triageRowRewrite_(row, rMap, session, sMap, lunchOffered, noteText) {
  row[rMap['Event_Date']] = coerceDate(session[sMap['Event_Date']]);
  row[rMap['Event_Time']] = String(session[sMap['Event_Time']] || '').trim();
  row[rMap['Location']] = String(session[sMap['Location']] || '').trim();
  row[rMap['Event']] = String(session[sMap['Clean_Title']] || '').trim();
  row[rMap['Event_ID']] = String(session[sMap['Event_ID']] || '').trim();
  // THE MEAL FOLLOWS THE DATE (`99a`'s rule): only an Active row has a live
  // meal, and it is dropped only where the destination serves none that day.
  let mealDropped = false;
  const status = String(row[rMap['Program_Status']] || '').trim() || 'Active';
  if (status === 'Active' && rMap['Lunch_Status'] !== undefined) {
    const type = String(row[rMap['Lunch_Type']] || '').trim();
    if (type && type !== 'No Lunch' && !lunchOffered) {
      row[rMap['Lunch_Type']] = 'No Lunch';
      row[rMap['Lunch_Status']] = 'No Lunch';
      writeMealsOrdered(row, rMap, 0);
      mealDropped = true;
    }
  }
  row[rMap['Manual_Override']] = 'Manually Edited';
  appendAdminNote(row, rMap, noteText);
  return { mealDropped };
}

// --- reads for the dialog ----------------------------------------------------

/** The three tabs a plan reads, fresh. */
function readTriageMoveTabs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const read = (name, headers) => {
    const sheet = ss.getSheetByName(name);
    return sheet ? getSectionedRows(sheet, headers, 'Event_ID') : [];
  };
  return {
    ss,
    triageRows: read(SHEET_NAMES.TRIAGE, HEADERS.Deleted_Event_Triage),
    sessionRows: read(SHEET_NAMES.PROGRAM_DASHBOARD, HEADERS.All_Program_Sessions),
    registrantRows: read(SHEET_NAMES.REGISTRANT_DASH, HEADERS.All_Registrants),
    tMap: getIndexMap(HEADERS.Deleted_Event_Triage),
    sMap: getIndexMap(HEADERS.All_Program_Sessions),
    rMap: getIndexMap(HEADERS.All_Registrants)
  };
}

/**
 * Called from the dialog: the triaged programs, each with its suggested
 * destinations, and every live program for the "something else" list.
 */
function listTriageMoveChoices() {
  try {
    const tabs = readTriageMoveTabs_();
    const todayKey = formatDateKey(new Date());
    const destinations = listTriageMoveDestinations_(tabs.sessionRows, tabs.sMap, todayKey);
    const sources = listTriageMoveSources_(tabs.triageRows, tabs.tMap, todayKey).map(s =>
      Object.assign(s, { suggestions: suggestTriageMoveDestinations_(s, destinations) }));
    return { ok: true, sources,
      destinations: destinations.map(d => ({ title: d.title, location: d.location })) };
  } catch (err) {
    return { ok: false, message: `⚠️ Could not read the tabs: ${err}` };
  }
}

/** Called from the dialog: what a press would do. Reads only. */
function previewTriageMove(from, to) {
  try {
    const tabs = readTriageMoveTabs_();
    const plan = planTriageMove_(Object.assign({ from, to, todayKey: formatDateKey(new Date()) }, tabs));
    return Object.assign({ ok: true }, describeTriageMovePlan_(plan, tabs.tMap, tabs.sMap));
  } catch (err) {
    return { ok: false, message: `⚠️ Could not plan that: ${err}` };
  }
}

// --- the write ---------------------------------------------------------------

/**
 * Called from the dialog. `expect` is { move, alreadyThere } as the preview
 * showed them; a fresh plan that differs is refused unwritten. Returns a
 * summary string, "⚠️"-prefixed when nothing went.
 */
function moveTriagedToProgram(from, to, expect) {
  if (!from || !from.title || !to || !to.title) return '⚠️ Pick both programs — nothing was changed.';
  if (isBootstrapActive()) return `⚠️ ${bootstrapBusyMessage()}`;
  const lock = workbookLock('Move triaged people to a program');
  if (!lock.tryLock(TRIAGE_MOVE_LOCK_WAIT_MS)) {
    return '⚠️ A sync is running. Try again in a minute. Nothing was changed.';
  }
  try {
    return moveTriagedToProgramLocked_(from, to, expect || {});
  } finally {
    lock.releaseLock();
  }
}

function moveTriagedToProgramLocked_(from, to, expect) {
  const tabs = readTriageMoveTabs_();
  const tMap = tabs.tMap, sMap = tabs.sMap, rMap = tabs.rMap;
  const plan = planTriageMove_(Object.assign({ from, to, todayKey: formatDateKey(new Date()) }, tabs));
  if (plan.moves.length !== Number(expect.move || 0) ||
      plan.alreadyThere.length !== Number(expect.alreadyThere || 0)) {
    return `⚠️ The tabs changed since the preview (it would now move ${plan.moves.length} and clear ` +
      `${plan.alreadyThere.length}). Preview again. Nothing was changed.`;
  }
  if (plan.moves.length === 0 && plan.alreadyThere.length === 0) {
    return '⚠️ Nobody in triage for that program can go on that one. Nothing was changed.';
  }

  const fromLabel = `${from.title} (${from.location})`;
  const toLabel = `${to.title} (${to.location})`;
  const note = waitlistStamp(`Put back from ${SHEET_NAMES.TRIAGE}: ${fromLabel} is now ${toLabel}.`, {});
  const rHeaders = HEADERS.All_Registrants;
  const asRegistrant = triageRow => triageRowAsRegistrant_(triageRow, tMap, rHeaders, rMap);

  // THE IDS AND THE OLD KEYS FIRST, while the rows still say where they came
  // from (`99a`'s order). A row the ledger has never heard of is minted here,
  // under its OLD session, so the `moved` below has something to move.
  const moving = plan.moves.map(m => {
    const before = asRegistrant(m.triageRow);
    return { m, before, ledgerId: ledgerIdForRegistrantRow(before, rMap) };
  });
  const clearing = plan.alreadyThere.map(a => {
    const before = asRegistrant(a.triageRow);
    return { a, before, ledgerId: ledgerIdForRegistrantRow(before, rMap) };
  });
  recordRegistrantTombstones(moving
    .filter(x => String(x.before[rMap['Event_ID']] || '').trim() !==
      String(x.m.session[sMap['Event_ID']] || '').trim())
    .map(x => x.before), rMap);

  let mealsDropped = 0;
  const lunchByKey = {};
  const added = moving.map(x => {
    const row = x.before.slice();
    const where = String(x.m.session[sMap['Location']] || '').trim();
    const lunchKey = `${x.m.dateKey}|${where}`;
    if (lunchByKey[lunchKey] === undefined) {
      lunchByKey[lunchKey] = isLunchOfferedOn(coerceDate(x.m.session[sMap['Event_Date']]), where);
    }
    if (triageRowRewrite_(row, rMap, x.m.session, sMap, lunchByKey[lunchKey], note).mealDropped) mealsDropped++;
    // Registration_ID rides along: ledgerIdForRegistrantRow wrote it onto
    // `before` when it minted, and the slice above copied it.
    return { row, x };
  });
  clearRegistrantTombstones(added.map(a => registrantTombstoneKey(
    a.row[rMap['Event_ID']], a.row[rMap['Name']], a.row[rMap['Person_Type']])));

  added.forEach(a => {
    appendLedgerEntry(makeLedgerEntry({
      kind: LEDGER_KINDS.MOVED,
      source: LEDGER_SOURCES.TRIAGE_MOVE,
      registrationId: a.x.ledgerId,
      eventId: a.row[rMap['Event_ID']],
      name: a.row[rMap['Name']],
      personType: a.row[rMap['Person_Type']],
      partyId: rMap['Party_ID'] === undefined ? '' : a.row[rMap['Party_ID']],
      payload: Object.assign({ from: a.x.before[rMap['Event_ID']] }, ledgerMovePayload_(a.row, rMap)),
      note: `Put back from triage: ${fromLabel} is now ${toLabel}.`
    }));
  });
  // The triaged COPY of somebody already on the session: the registration it
  // stood for ends here, so the alarm does not later report it missing.
  clearing.forEach(c => {
    appendLedgerEntry(makeLedgerEntry({
      kind: LEDGER_KINDS.REMOVED,
      source: LEDGER_SOURCES.TRIAGE_MOVE,
      registrationId: c.ledgerId,
      eventId: c.before[rMap['Event_ID']],
      name: c.before[rMap['Name']],
      personType: c.before[rMap['Person_Type']],
      partyId: rMap['Party_ID'] === undefined ? '' : c.before[rMap['Party_ID']],
      note: `Triaged copy cleared: already on ${toLabel} for ${formatDateLabel(parseDateKey(c.a.dateKey))}.`
    }));
  });

  // REGISTRANTS FIRST, then triage — see the banner for why that order.
  const regSheet = getOrCreateSheet(tabs.ss, SHEET_NAMES.REGISTRANT_DASH);
  let recount = '';
  if (added.length > 0) {
    const regRows = tabs.registrantRows.concat(added.map(a => a.row));
    renderRegistrantsSheet(false, regRows);
    recount = refreshCountsAfterRegistrantChange(tabs.ss, regSheet, regRows);
  }
  const gone = new Set(plan.moves.map(m => m.triageRow).concat(plan.alreadyThere.map(a => a.triageRow)));
  renderTriageSheet(false, tabs.triageRows.filter(row => !gone.has(row)));
  invalidateQuickMarkIndexCache();
  flushLedger();

  const left = plan.cancelledThere.length + plan.noSession.length + plan.ambiguous.length;
  const summary = `✅ ${added.length} seat(s) moved from ${fromLabel} onto ${toLabel}` +
    (clearing.length ? `; ${clearing.length} already there, taken off triage` : '') + '.' +
    (mealsDropped ? ` ${mealsDropped} meal(s) dropped — no lunch is served there those days.` : '') +
    (left ? ` ${left} stay on triage (no session that day, or cancelled there).` : '') +
    (plan.overCapacity.length ? ` ⚠️ ${plan.overCapacity.length} session(s) are now over capacity.` : '') +
    recount;
  log(`moveTriagedToProgram: ${summary}`);
  toastIfPossible(summary);
  return summary;
}

// --- the dialog --------------------------------------------------------------

/** The dialog. Everything from the workbook crosses into script through google.script.run, never interpolated. */
function buildTriageToProgramHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  label.f { display: block; font-size: 12px; color: #444; margin-top: 8px; }
  select { padding: 5px; font-size: 13px; width: 100%; }
  #plan { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 300px; overflow-y: auto; margin-top: 10px; }
  .sec { margin: 8px 0 2px 0; font-weight: bold; }
  .line { padding: 1px 0 1px 14px; }
  .muted { color: #666; } .warn { color: #B06000; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
  button.secondary { background: #5f6368; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  .actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; white-space: pre-wrap; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Put triaged people on their new program</h3>
<p class="hint">
  For a program whose dates were deleted because it was renamed or moved building. Pick it, pick the
  program its people belong on now, and preview. Each seat from today on moves onto that program's
  session <b>on the same day</b>. Nobody is emailed. Dates with no session stay on triage.
</p>
<label class="f" for="src">Triaged program (seats still held, from today on)</label>
<select id="src" onchange="fillDest()"></select>
<label class="f" for="dst">Put them on</label>
<select id="dst" onchange="clearPlan()"></select>
<div class="actions">
  <button class="secondary" id="pv" onclick="preview()">Preview</button>
  <button id="go" onclick="go()" disabled>Move them</button>
</div>
<div id="plan"><span class="muted">Loading…</span></div>
<div id="status"></div>
<script>
  var CHOICES = null, LAST = null;
  var src = document.getElementById('src'), dst = document.getElementById('dst');
  function say(m, c) { var el = document.getElementById('status'); el.textContent = m; el.className = c; }
  function key(p) { return JSON.stringify([p.title, p.location]); }
  function load() {
    google.script.run.withSuccessHandler(function (r) {
      if (!r.ok) { say(r.message, 'err'); return; }
      CHOICES = r; src.innerHTML = '';
      if (!r.sources.length) { document.getElementById('plan').innerHTML = '<span class="muted">Nobody on triage holds a seat from today on.</span>'; return; }
      r.sources.forEach(function (s, i) {
        src.appendChild(new Option(s.title + ' (' + s.location + ') · ' + s.seats + ' seat(s), ' + s.people + ' people, from ' + s.firstDateKey, String(i)));
      });
      fillDest();
    }).withFailureHandler(function (e) { say('Failed: ' + e.message, 'err'); }).listTriageMoveChoices();
  }
  function fillDest() {
    var s = CHOICES.sources[Number(src.value)];
    dst.innerHTML = '';
    var seen = {};
    if (s.suggestions.length) {
      var g = document.createElement('optgroup'); g.label = 'Suggested (meets on those dates)';
      s.suggestions.forEach(function (d) {
        seen[key(d)] = true;
        var o = new Option(d.title + ' (' + d.location + ') · ' + d.covered + ' of ' + d.of + ' dates', key(d));
        g.appendChild(o);
      });
      dst.appendChild(g);
    }
    var all = document.createElement('optgroup'); all.label = 'Every program with upcoming dates';
    CHOICES.destinations.forEach(function (d) {
      if (seen[key(d)]) return;
      all.appendChild(new Option(d.title + ' (' + d.location + ')', key(d)));
    });
    dst.appendChild(all);
    clearPlan();
  }
  function picked() {
    var s = CHOICES.sources[Number(src.value)];
    var d = JSON.parse(dst.value);
    return { from: { title: s.title, location: s.location }, to: { title: d[0], location: d[1] } };
  }
  function clearPlan() {
    LAST = null; document.getElementById('go').disabled = true;
    document.getElementById('plan').innerHTML = '<span class="muted">Press Preview to see who would move.</span>';
    say('', '');
  }
  function section(box, title, items, withTime) {
    if (!items.length) return;
    var h = document.createElement('div'); h.className = 'sec'; h.textContent = title; box.appendChild(h);
    items.forEach(function (d) {
      var l = document.createElement('div'); l.className = 'line';
      l.textContent = d.label + (withTime && d.time ? ' · ' + d.time : '') + ': ' + d.names.join(', ');
      box.appendChild(l);
    });
  }
  function preview() {
    var p = picked();
    say('Planning…', '');
    google.script.run.withSuccessHandler(function (r) {
      if (!r.ok) { say(r.message, 'err'); return; }
      LAST = { p: p, r: r };
      var box = document.getElementById('plan'); box.innerHTML = '';
      var head = document.createElement('div');
      head.textContent = r.move + ' seat(s) move · ' + r.alreadyThere + ' already there (taken off triage) · ' + r.stay + ' stay on triage';
      box.appendChild(head);
      r.overCapacity.forEach(function (w) { var l = document.createElement('div'); l.className = 'line warn'; l.textContent = '⚠️ ' + w; box.appendChild(l); });
      section(box, 'Moves onto ' + p.to.title + ' (' + p.to.location + ')', r.moves, true);
      section(box, 'Already there: only the triaged copy comes off', r.alreadyThereByDate, false);
      section(box, 'Stay on triage: no session that day', r.noSession, false);
      section(box, 'Stay on triage: cancelled on that session', r.cancelledThere, false);
      section(box, 'Stay on triage: two sessions that day', r.ambiguous, false);
      document.getElementById('go').disabled = (r.move + r.alreadyThere) === 0;
      say('', '');
    }).withFailureHandler(function (e) { say('Failed: ' + e.message, 'err'); }).previewTriageMove(p.from, p.to);
  }
  function go() {
    if (!LAST) return;
    document.getElementById('go').disabled = true;
    say('Moving…', '');
    google.script.run.withSuccessHandler(function (msg) {
      say(msg, msg.indexOf('\\u2705') === 0 ? 'ok' : 'err');
      LAST = null; load();
    }).withFailureHandler(function (e) { say('Failed: ' + e.message, 'err'); })
      .moveTriagedToProgram(LAST.p.from, LAST.p.to, { move: LAST.r.move, alreadyThere: LAST.r.alreadyThere });
  }
  load();
</script>`;
}
