// ============================================================================
// 18. CHANGING ONE REGISTRATION  (everything Quick Mark could not say)
// ============================================================================
//
// WHAT QUICK MARK COULD ALREADY DO was mark and add: attended, lunch, signed
// up for lunch, registered, waitlisted — five ticks, every one of which either
// records something that happened or puts somebody ON a list. What it had no
// vocabulary for at all was the other half of a front desk's day, which is
// that something on a row is WRONG and a person is standing there waiting for
// it to be right:
//
//   "She rang to move to Thursday."          — a different DAY, not a slot.
//   "He's not coming after all."             — a cancellation.
//   "She cancelled and now she can come."    — putting one back.
//   "I marked the wrong Mary present."       — undoing a mark.
//   "She wants the cold plate, not hot."     — the meal, corrected.
//   "That phone number is two digits out."   — contact details.
//   "He's on there twice."                   — one row, gone.
//
// Every one of those was already possible SOMEWHERE: on the Registrants tab in
// a dropdown, or through the Move Sessions dialog, or by marking
// Manual_Override and running a sweep off a menu. None of them was possible in
// front of the person they were about, which is the only moment anybody knows
// them. So the same dialog the desk already has open grew a panel, and this
// file is what the panel calls.
//
// THE RULE THIS FILE FOLLOWS is the one 71_cancellation.gs set: a status is
// never one cell. A cancellation is four (the seat, the meal, the override
// that stops the next sync re-deriving the row, and a dated note), and so is a
// waitlisting, and so is putting either of them back. Every path here that
// changes a status therefore goes through the writers in 71 —
// stampRegistrantRowCancelled(), stampRegistrantRowWaitlisted(),
// stampRegistrantRowActive() — and the ONE new one below
// (stampRegistrantRowUncancelled()), which is the reverse of a cancellation
// and did not exist because until now nothing could ask for it.
//
// DELIBERATELY NOT OPTIMISTIC, which is the one place this parts company with
// the marking path beside it. A mark is shown as done immediately because the
// desk has thirty of them to make and a refusal is survivable (see submit() in
// 36). A change is rare, consequential, and can be refused for reasons only
// the sheet knows — the slot went in between, the session is full, they are
// already on it — so the desk waits the second out and reads the answer. A
// cancellation shown as done and then refused is a seat given away twice.
//
// A MOVE IS THE ONE THAT NEEDED A TOMBSTONE. Moving a row to another session
// rewrites its Event_ID, and the form response it came from is still sitting
// in the responses sheet pointing at the OLD one — so the next import would
// helpfully put the original row back and the person would be on both dates.
// recordRegistrantTombstones() on the way out is what closes that (section
// 5c), and clearRegistrantTombstones() on the destination is what stops a
// move onto a session somebody was once removed from being silently undone.
//
// LOAD ORDER. Numbered last for the usual reason — never renumber, and this
// landed after 98. Safe there: behavior only, its own two constants stand
// alone, its schema is HEADERS.All_Registrants in 03 like every other tab's,
// and everything it reaches for (the cancellation writers in 71, the session
// lookups in 38, the tombstones in 28, the render and the two recounts) it
// reads at CALL time or through a hoisted function declaration.
// ============================================================================

/**
 * The changes the panel can ask for. One string per action, matched on the way
 * in — a value that is not in here is refused rather than guessed at, because
 * the failure mode of guessing is writing the wrong change to the right row.
 */
const REGISTRANT_CHANGE_ACTIONS = {
  MOVE: 'move',
  CANCEL: 'cancel',
  RESTORE: 'restore',
  WAITLIST: 'waitlist',
  UNDO: 'undo',
  LUNCH: 'lunch',
  CONTACT: 'contact',
  NOTE: 'note',
  REMOVE: 'remove'
};

/**
 * The meal-count columns a move to another DATE clears.
 *
 * "Ate here", "took home" and the rest are facts about a lunch that was handed
 * over on a particular day. Carried onto a different day they become a claim
 * that somebody collected three meals at a service they have not attended yet,
 * which lands in the kitchen's reconciliation as a discrepancy nobody can
 * trace. Attended and Lunch_Served go with them, for the same reason.
 */
const REGISTRANT_MOVE_CLEARED_COUNTS = [
  'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge'
];


// --- the one entry point ----------------------------------------------------

/**
 * Called from the Quick Mark dialog's change panel. Applies ONE change to one
 * registration (and the guests who came with it) and says what it did.
 *
 * UNDER THE DESK LOCK, all of it, for the reason every other desk write takes
 * it: this reads the whole registrants tab, decides, and writes it back, and a
 * render landing in the middle would either lose the change or resurrect the
 * rows the render had just moved. The same lock Quick Mark's marks and the
 * door pages take, so a change and a check-in cannot interleave.
 *
 * Returns { ok, message } for the dialog to show. Never throws for an ordinary
 * refusal — "that slot has gone" is an answer, not a failure.
 */
function applyRegistrantChangeFromDialog(args) {
  return withScriptLock(DESK_LOCK_WAIT_MS, () => applyRegistrantChangeLocked(args), {
    ok: false,
    message: '⏳ The workbook is mid-update — nothing was changed. Press the button again in a moment.'
  });
}

/** The body of applyRegistrantChangeFromDialog(), which holds the lock for it. */
function applyRegistrantChangeLocked(args) {
  args = args || {};
  const action = String(args.change || '').trim();
  const name = String(args.name || '').trim();
  if (!name) return { ok: false, message: '⚠️ Pick a name first — nothing was changed.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) {
    return { ok: false, message: '⚠️ There is no registrants tab yet — run Sync Registrations once.' };
  }
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');

  const target = pickRegistrantRowForChange(rows, map, args);
  if (!target) {
    const where = String(args.session || '').trim();
    return {
      ok: false,
      message: `⚠️ ${name} has no row on ${where || 'that session'} to change. ` +
        `Reload the lists (↻) if they registered in the last few minutes.`
    };
  }
  // A GUEST GOES WITH THE PERSON WHO BROUGHT THEM, on every change here, for
  // the reason matchesCancellationParty() gives: a guest row with nobody to
  // attach to is a stranger on the door list and a meal the kitchen still
  // cooks. The reverse is not true — a guest can be changed on their own.
  const party = registrantChangeParty(rows, map, target);

  switch (action) {
    case REGISTRANT_CHANGE_ACTIONS.MOVE:
      return moveRegistrantChange(ss, sheet, rows, map, target, party, args);
    case REGISTRANT_CHANGE_ACTIONS.CANCEL:
      return cancelRegistrantChange(target, map, args);
    case REGISTRANT_CHANGE_ACTIONS.RESTORE:
      return restoreRegistrantChange(ss, sheet, rows, map, target, party, args);
    case REGISTRANT_CHANGE_ACTIONS.WAITLIST:
      return waitlistRegistrantChange(ss, sheet, rows, map, target, party, args);
    case REGISTRANT_CHANGE_ACTIONS.UNDO:
      return undoRegistrantMarks(ss, sheet, rows, map, target, args);
    case REGISTRANT_CHANGE_ACTIONS.LUNCH:
      return changeRegistrantLunch(ss, sheet, rows, map, target, args);
    case REGISTRANT_CHANGE_ACTIONS.CONTACT:
      return changeRegistrantContact(ss, sheet, rows, map, target, args);
    case REGISTRANT_CHANGE_ACTIONS.NOTE:
      return noteOnRegistrantRow(ss, sheet, rows, map, target, args);
    case REGISTRANT_CHANGE_ACTIONS.REMOVE:
      return removeRegistrantChange(ss, sheet, rows, map, target, party, args);
    default:
      return { ok: false, message: '⚠️ Pick what needs changing first — nothing was changed.' };
  }
}


// --- finding the row ---------------------------------------------------------

/**
 * WHICH ROW the panel is talking about: the same narrowing applyQuickMarkLocked()
 * does, applied to row ARRAYS rather than to sheet ranges.
 *
 * It is arrays here because every change in this file either rewrites a whole
 * row (a status is four cells that have to agree) or removes one, and both of
 * those end at renderRegistrantsSheet() with the full row set in hand — which
 * is the shape cancelRegistrantRowsLocked() already works in. Reading cells by
 * number and then re-rendering from a separate read is how two writes in one
 * lock disagree with each other.
 *
 * Same four filters, in the same order of strictness: the name, the location,
 * the program, the DATE when the session choice named one, and the booked SLOT
 * when the dialog said which of two appointments it meant. Then today first,
 * else the soonest future, else the most recent past — the rule every other
 * reader in this project sorts sessions by.
 */
function pickRegistrantRowForChange(rows, map, args) {
  const nameKey = normalizeNameKey(args.name);
  const location = String(args.location || '').trim();
  const selection = parseQuickMarkProgramChoice(args.session);
  const bookedTime = appointmentStartLabelOf(args.bookedTime);
  const todayKey = formatDateKey(new Date());

  const found = [];
  rows.forEach(row => {
    if (normalizeNameKey(row[map['Name']]) !== nameKey) return;
    // A superseded row is an earlier submission the tab keeps as history —
    // never the row a desk means, and never one anything here may write to.
    if (isSupersededRegistrantRow(row, map)) return;
    if (location && String(row[map['Location']] || '').trim() !== location) return;
    if (selection.title &&
      quickMarkTitleKey(row[map['Event']]) !== quickMarkTitleKey(selection.title)) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (selection.dateKey && (!date || formatDateKey(date) !== selection.dateKey)) return;
    const slot = map['Event_Time'] === undefined ? '' : appointmentStartLabelOf(row[map['Event_Time']]);
    if (bookedTime && slot !== bookedTime) return;
    found.push({ row, date, dateKey: date ? formatDateKey(date) : '', slot });
  });
  if (found.length === 0) return null;

  found.sort((a, b) => {
    const rank = c => (c.dateKey === todayKey ? 0 : (c.dateKey > todayKey ? 1 : 2));
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 2) return (b.date || 0) - (a.date || 0); // past: newest first
    return (a.date || 0) - (b.date || 0);                    // future: soonest first
  });
  return found[0];
}

/**
 * The picked row plus the guests who came with that person on that session.
 *
 * Widens a MEMBER's change and never a guest's, exactly as
 * matchesCancellationParty() does — and never past the slot, because two
 * appointments held by one person are two separate bookings and a guest
 * belongs to one of them.
 */
function registrantChangeParty(rows, map, target) {
  const eventId = String(target.row[map['Event_ID']] || '').trim();
  const nameKey = normalizeNameKey(target.row[map['Name']]);
  const isGuest = String(target.row[map['Person_Type']] || '').trim() === 'Guest';
  if (isGuest || !eventId) return [target.row];

  const party = [target.row];
  rows.forEach(row => {
    if (row === target.row) return;
    if (String(row[map['Event_ID']] || '').trim() !== eventId) return;
    if (String(row[map['Person_Type']] || '').trim() !== 'Guest') return;
    if (normalizeNameKey(row[map['Primary_Registrant']]) !== nameKey) return;
    if (isSupersededRegistrantRow(row, map)) return;
    // On an appointment session the member holds a named chair; a guest on a
    // different one is a different booking.
    const slot = map['Event_Time'] === undefined ? '' : appointmentStartLabelOf(row[map['Event_Time']]);
    if (target.slot && slot !== target.slot) return;
    party.push(row);
  });
  return party;
}


// --- the change that did not have a writer yet -------------------------------

/**
 * Takes ONE row back off a cancellation, in place. Returns true if it moved.
 *
 * THE REVERSE OF stampRegistrantRowCancelled(), and the mirror of
 * stampRegistrantRowActive() beside it: same four cells, same order, same
 * reason each one is written.
 *
 * ONLY FROM 'Cancelled'. A superseded row is history and an active one has
 * nothing to undo; both are refused here rather than resolved, so the caller
 * can say which it was.
 *
 * THE MEAL IS RESTORED FROM Lunch_Type, not remembered — the identical rule
 * stampRegistrantRowActive() applies, and for the identical reason: a
 * cancelled row carries Lunch_Status = 'Cancelled' and no memory of what it
 * said before, while Lunch_Type is untouched by any of this and still names
 * the meal the person asked for. Wrong in the safe direction is one uneaten
 * meal; wrong the other way is somebody sitting down to nothing.
 *
 * WHY THIS DID NOT EXIST UNTIL NOW. stampRegistrantRowActive() deliberately
 * refuses a cancelled row — "handing a seat back to somebody who cancelled is
 * something a human should have to type", which was the right rule while the
 * only thing that could ask was a tick box on a shared sheet an hourly pass
 * reads. The desk panel IS a human typing it, with the person on the phone, so
 * the seat check moves to the caller (registrantChangeSeatRefusal()) and the
 * refusal here narrows to "this row was not cancelled".
 */
function stampRegistrantRowUncancelled(row, map, opts) {
  if (String(row[map['Program_Status']] || '').trim() !== 'Cancelled') return false;

  row[map['Program_Status']] = 'Active';
  if (map['Lunch_Status'] !== undefined) {
    const lunchType = String(row[map['Lunch_Type']] || '').trim();
    row[map['Lunch_Status']] = (lunchType && lunchType !== 'No Lunch') ? 'Needed' : 'No Lunch';
  }
  row[map['Manual_Override']] = 'Manually Edited';
  appendAdminNote(row, map, waitlistStamp('Put back on the list', opts));
  return true;
}


// --- shared guards -----------------------------------------------------------

/** Who is making this change, for the Admin_Notes stamp every writer here leaves. */
function registrantChangeStampOptions(args) {
  return {
    source: CANCELLATION_SOURCES.DESK,
    by: getCurrentUserEmail() || '',
    reason: String((args && args.reason) || '')
  };
}

/**
 * IS THERE A SEAT on this session — the one guard every path that gives
 * somebody a place has to pass, whether that place is new, restored, or moved
 * in from another date.
 *
 * Returns '' when there is room, and the sentence to refuse with when there is
 * not. Read from the rows in hand rather than from the dashboard's own count,
 * because the count is written by a pass that may not have run since the last
 * three things this desk did.
 *
 * A [Waitlist Only] session refuses whatever the number says: somebody has
 * deliberately shut it, and a capacity that happens to have room in it is not
 * permission to reopen it (see WAITLIST_ONLY_TAG).
 *
 * An APPOINTMENT session is not seat-counted here at all — its capacity is its
 * slots, and the caller checks the one chair it is actually asking for.
 */
function registrantChangeSeatRefusal(rows, map, eventId, sessionLabel) {
  if (!eventId) return '';
  const seat = buildWaitlistSeatIndex(rows, map)[eventId];
  if (!seat) return '';
  const where = sessionLabel || 'that session';
  if (seat.closed) {
    return `⚠️ ${where} is marked ${WAITLIST_ONLY_TAG}, so nobody can be given a place on it. ` +
      `Untick Waitlist_Only on the session row first, or leave them on the waiting list.`;
  }
  if (seat.capacity > 0 && seat.active >= seat.capacity) {
    return `⚠️ ${where} is full (${seat.active} of ${seat.capacity}). Raise Max_Capacity, or cancel ` +
      `somebody, or leave them on the waiting list.`;
  }
  return '';
}

/**
 * Is somebody ALREADY on this session under this name — a row that is not part
 * of the party being changed, and not one of the two statuses that hold
 * nothing? Returns the offending status, or ''.
 *
 * This is the difference between a move and a duplicate. "Move her to
 * Thursday" when she is already down for Thursday produces two rows for one
 * person: two seats against the capacity and two meals against the catering
 * count, which is exactly what 85_duplicate_registrations.gs exists to unpick
 * afterwards. Refusing it here is the cheaper half of that bargain.
 */
function registrantAlreadyOnSession(rows, map, eventId, row, party) {
  const nameKey = normalizeNameKey(row[map['Name']]);
  const personType = String(row[map['Person_Type']] || '').trim();
  let clash = '';
  rows.forEach(other => {
    if (clash || party.indexOf(other) !== -1) return;
    if (String(other[map['Event_ID']] || '').trim() !== eventId) return;
    if (normalizeNameKey(other[map['Name']]) !== nameKey) return;
    if (String(other[map['Person_Type']] || '').trim() !== personType) return;
    const status = String(other[map['Program_Status']] || '').trim() || 'Active';
    if (CANCELLATION_TERMINAL_STATUSES.indexOf(status) !== -1) return;
    clash = status;
  });
  return clash;
}

/**
 * The counts, straight away rather than at the next hourly sync — the same
 * bargain cancelRegistrantRowsLocked() makes, and for the same reason: the
 * desk changed this because of the person in front of them, and a form that
 * still says "Full" for an hour is a seat nobody can use.
 *
 * Returns '' on success and a clause to append to the caller's message on
 * failure: the rows are already written by then, and reporting a recount
 * problem as though the change had not happened is worse than either.
 */
function refreshCountsAfterRegistrantChange(ss, sheet, rows) {
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, rows);
    updateMasterLunchDashboard(rows);
    return '';
  } catch (err) {
    log(`⚠️ A registrant change was written, but the counts could not be recalculated (${err}).`);
    return ' (The counts could not be recalculated just now — the hourly sync will.)';
  }
}

/**
 * Writes the tab back and hands the caller its own message, with whatever the
 * recount had to say appended. Every path below that mutates rows ends here,
 * so there is one place the render, the recount, the log line and the dropped
 * Quick Mark lists live.
 */
function finishRegistrantChange(ss, sheet, rows, message) {
  renderRegistrantsSheet(false, rows);
  const trouble = refreshCountsAfterRegistrantChange(ss, sheet, rows);
  // The lists the dialog and the door read are built from these rows: a
  // changed status, a moved date and a removed row are all things a stored
  // copy would go on being wrong about until the next sync.
  invalidateQuickMarkIndexCache();
  const said = `${message}${trouble}`;
  toastIfPossible(said);
  log(`applyRegistrantChangeFromDialog: ${said}`);
  return { ok: true, message: said, listsChanged: true };
}

/** "Chair Yoga — Thu, Sep 17 (Ashbridge)", for every message in this file. */
function describeRegistrantSession(title, date, location) {
  const parts = [String(title || '').trim() || 'that program'];
  if (date) parts.push(formatDateLabel(date));
  const where = String(location || '').trim();
  return `${parts.join(' — ')}${where ? ` (${where})` : ''}`;
}

/** The session one registrant row is on, said the same way. */
function describeRegistrantRowSession(row, map) {
  return describeRegistrantSession(row[map['Event']], coerceDate(row[map['Event_Date']]),
    row[map['Location']]);
}


// --- move: a different time, a different day, a different program ------------

/**
 * MOVING A REGISTRATION, which is the change this whole panel was asked for.
 *
 * Quick Mark could already move an APPOINTMENT to another slot on the same
 * afternoon (the "🕐 Move them to a different time" tick, which rewrites one
 * cell). What it could not do — and what the phone call is actually about
 * nine times in ten — is move somebody to another DAY: "I can't make Tuesday,
 * can I come Thursday instead?" That is five cells, a capacity check, a slot
 * check, a lunch that may or may not exist on the new date, and a tombstone;
 * which is why it is here rather than as a sixth tick.
 *
 * IT IS NOT LIMITED TO THE SAME PROGRAM, deliberately. The destination is the
 * whole session list at any location, because "she wants Narberth's Thursday
 * class instead of Ashbridge's Tuesday one" is one sentence to a person and
 * was two dialogs and a hand-edit here.
 *
 * THE MARKS DO NOT TRAVEL. An attendance tick and a meal handed over are facts
 * about the day they were recorded on; carried to another date they assert
 * something that has not happened. Cleared when the DATE changes, kept when
 * only the slot does — and said out loud in the message either way, because a
 * desk that moved somebody after ticking them in needs to know the tick went.
 */
function moveRegistrantChange(ss, sheet, rows, map, target, party, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const status = String(row[map['Program_Status']] || '').trim() || 'Active';
  if (CANCELLATION_TERMINAL_STATUSES.indexOf(status) !== -1) {
    return {
      ok: false,
      message: `⚠️ ${name}'s booking is ${status.toLowerCase()}, so there is nothing to move. ` +
        `Put them back on first, then move them.`
    };
  }

  const to = resolveRegistrantMoveTarget(args);
  if (!to) {
    return {
      ok: false,
      message: '⚠️ Pick the session to move them to — nothing was changed. ' +
        'Run Sync Cal if the program is new.'
    };
  }
  const fromEventId = String(row[map['Event_ID']] || '').trim();
  const wantedSlot = appointmentStartLabelOf(args.toAppointmentTime);
  const toLabel = describeRegistrantSession(to.title, to.date, to.location);
  if (to.eventId === fromEventId && (!wantedSlot || wantedSlot === target.slot)) {
    return { ok: false, message: `⚠️ ${name} is already on ${toLabel} — nothing was changed.` };
  }

  // ONE PERSON, ONE PLACE — except on an appointment session, where one person
  // legitimately holds two chairs on the same afternoon (see the appointment
  // note in namesFor()). So the duplicate guard is for ORDINARY sessions only;
  // an appointment destination is guarded by its slot instead, one line down,
  // which is the stricter check anyway: it refuses the same CHAIR to two
  // people rather than the same session to one person twice.
  if (!to.isAssistance) {
    const clash = registrantAlreadyOnSession(rows, map, to.eventId, row, party);
    if (clash) {
      return {
        ok: false,
        message: `⚠️ ${name} already has a ${clash.toLowerCase()} row on ${toLabel}. Moving them would ` +
          `make two — cancel or remove one of them instead. Nothing was changed.`
      };
    }
  }

  // AN APPOINTMENT IS A CHAIR AT A TIME, so a move onto one has to name the
  // slot and the slot has to still be free — checked here, under the lock,
  // against the rows in hand rather than against the dialog's snapshot. Two
  // people in one chair is the failure the whole tag exists to prevent, and a
  // move is now a second way to cause it.
  let slot = null;
  if (to.isAssistance) {
    const others = rows.filter(other => party.indexOf(other) === -1);
    const taken = readBookedAppointmentTimes(others)[to.eventId] || new Set();
    const free = buildAppointmentSlots(to.date, to.end, resolveSlotMinutes(to))
      .filter(s => !taken.has(s.startLabel));
    if (!wantedSlot) {
      return {
        ok: false,
        message: free.length
          ? `⚠️ ${toLabel} is booked by appointment — pick a time as well (${free.length} free).`
          : `⚠️ Every appointment on ${toLabel} is taken, so ${name} cannot be moved onto it.`
      };
    }
    slot = free.filter(s => s.startLabel === wantedSlot)[0] || null;
    if (!slot) {
      return {
        ok: false,
        message: `⚠️ The ${wantedSlot} appointment on ${toLabel} has just been taken — reload the ` +
          `lists (↻) and pick another time. Nothing was changed.`
      };
    }
  } else if (status === 'Active') {
    // Only an ACTIVE row needs a seat: moving somebody's waiting-list place to
    // another date does not take one, and refusing it because the new date is
    // full would be refusing the only thing a full session can offer.
    const refusal = registrantChangeSeatRefusal(rows, map, to.eventId, toLabel);
    if (refusal) return { ok: false, message: refusal };
  }

  const fromLabel = describeRegistrantRowSession(row, map);
  const dateChanged = !to.date || !target.date || formatDateKey(to.date) !== target.dateKey;
  const lunchOffered = isLunchOfferedOn(to.date, to.location);
  const stamp = registrantChangeStampOptions(args);

  // THE TOMBSTONE FIRST, while the rows still say where they came from. The
  // form response behind this registration is still in the responses sheet
  // pointing at the old Event_ID, and the next import would put the original
  // row back beside the moved one — which is the whole reason a move is not
  // simply five setValue() calls. Same Party_ID, so a re-import of that
  // response stays blocked while a genuinely new submission still comes
  // through (see getRegistrantTombstone()).
  recordRegistrantTombstones(party, map);

  let marksCleared = 0;
  let mealsDropped = false;
  party.forEach(member => {
    if (dateChanged && clearRegistrantMarksOnRow(member, map)) marksCleared++;
    member[map['Event_Date']] = to.date;
    member[map['Event_Time']] = slot ? slot.rangeLabel : (to.eventTime || '');
    member[map['Location']] = to.location;
    member[map['Event']] = to.title;
    member[map['Event_ID']] = to.eventId;
    // THE MEAL FOLLOWS THE DATE, not the row. A person who wanted feeding on
    // Tuesday still wants feeding on Thursday — unless Thursday serves
    // nothing, in which case the row must stop asking for a meal that is not
    // being cooked (the dashboard would otherwise raise "lunch needed with no
    // menu set" every hour). Only an ACTIVE row has a live meal at all:
    // 'Cancelled' and 'Waitlisted' are answers about the meal too.
    if (String(member[map['Program_Status']] || '').trim() === 'Active' &&
      map['Lunch_Status'] !== undefined) {
      const wantsLunch = String(member[map['Lunch_Type']] || '').trim() &&
        String(member[map['Lunch_Type']] || '').trim() !== 'No Lunch';
      if (wantsLunch && !lunchOffered) {
        member[map['Lunch_Type']] = 'No Lunch';
        member[map['Lunch_Status']] = 'No Lunch';
        writeMealsOrdered(member, map, 0);
        mealsDropped = true;
      } else if (wantsLunch) {
        member[map['Lunch_Type']] = resolveWalkInLunchType(to);
        member[map['Lunch_Status']] = 'Needed';
      }
    }
    member[map['Manual_Override']] = 'Manually Edited';
    appendAdminNote(member, map, waitlistStamp(`Moved from ${fromLabel} to ${toLabel}`, stamp));
  });

  // And the destination's own tombstones lifted: somebody moved onto a session
  // a row for them was once removed from is a deliberate write, exactly like a
  // walk-in typed at the desk, and must not be argued with by the next sync.
  clearRegistrantTombstones(party.map(member =>
    registrantTombstoneKey(to.eventId, member[map['Name']], member[map['Person_Type']])));

  const others = party.length > 1 ? ` (with ${party.length - 1} guest(s))` : '';
  const slotNote = slot ? ` at ${slot.rangeLabel}` : '';
  const markNote = marksCleared
    ? ` Their attendance and lunch marks were cleared — those belonged to ${fromLabel}.`
    : '';
  const mealNote = mealsDropped
    ? ` No lunch is served on that date, so their meal has been taken off the order.`
    : '';
  return finishRegistrantChange(ss, sheet, rows,
    `✅ ${name}${others} moved from ${fromLabel} to ${toLabel}${slotNote}.${markNote}${mealNote}`);
}

/**
 * The session a move is aimed at, resolved the same way a walk-in's is: a
 * lunch-only choice becomes the synthetic session that carries the date and
 * the kitchen (buildLunchOnlySession()), and everything else is looked up on
 * the session table, which is the only place an Event_ID can come from.
 */
function resolveRegistrantMoveTarget(args) {
  const location = String((args && args.toLocation) || '').trim();
  const selection = parseQuickMarkProgramChoice(args && args.toSession);
  if (!selection.title) return null;
  return selection.lunchOnly
    ? buildLunchOnlySession(selection.dateKey, location)
    : findNearestSessionForProgram(selection.title, location, selection.dateKey);
}

/**
 * Clears the marks that belong to a particular day: present, fed, and how much
 * of the food went where. Returns true if anything was actually on.
 *
 * Shared by the move above and the "undo a mark" panel below, which are the
 * same write for two different reasons — one because the day changed, one
 * because the tick was wrong.
 */
function clearRegistrantMarksOnRow(row, map, options) {
  const opts = options || {};
  const attended = opts.attended !== false;
  const lunch = opts.lunch !== false;
  let cleared = false;
  if (attended && map['Attended'] !== undefined && row[map['Attended']] === true) {
    row[map['Attended']] = false;
    cleared = true;
  }
  if (!lunch) return cleared;
  if (map['Lunch_Served'] !== undefined && row[map['Lunch_Served']] === true) {
    row[map['Lunch_Served']] = false;
    cleared = true;
  }
  REGISTRANT_MOVE_CLEARED_COUNTS.forEach(header => {
    if (map[header] === undefined) return;
    if (!row[map[header]]) return;
    row[map[header]] = '';
    cleared = true;
  });
  return cleared;
}


// --- the three status changes ------------------------------------------------

/**
 * Cancel, through the one writer in 71_cancellation.gs — not a fourth copy of
 * the four cells.
 *
 * cancelRegistrantRowsLocked() rather than cancelRegistrantRows(): this
 * already holds the desk lock, and the same nesting applyQuickMarkForHousehold()
 * avoids for the same reason. It does its own read, render and recount off the
 * rows it reads, which is why nothing above it here is reused.
 */
function cancelRegistrantChange(target, map, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const eventId = String(row[map['Event_ID']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  const status = String(row[map['Program_Status']] || '').trim() || 'Active';
  if (CANCELLATION_TERMINAL_STATUSES.indexOf(status) !== -1) {
    return { ok: false, message: `⚠️ ${name} is already ${status.toLowerCase()} on ${where} — nothing was changed.` };
  }

  const result = cancelRegistrantRowsLocked(
    (candidate, candidateMap) => matchesCancellationParty(candidate, candidateMap, {
      eventId, nameKey: normalizeNameKey(name)
    }),
    Object.assign({ name, emptyMessage: `That booking was already cancelled.` },
      registrantChangeStampOptions(args)));

  if (!result.ok || !result.cancelled) {
    return { ok: false, message: `⚠️ ${result.message}` };
  }
  invalidateQuickMarkIndexCache();
  const said = `✅ ${name} cancelled for ${where}. Their seat and their lunch have gone back.`;
  toastIfPossible(said);
  log(`applyRegistrantChangeFromDialog: ${said}`);
  return { ok: true, message: said, listsChanged: true };
}

/**
 * PUT THEM BACK ON — the sentence this workbook could not say at all.
 *
 * Two different undoings behind one plain-English label, because the desk does
 * not know or care which of them applies: a cancellation reversed
 * (stampRegistrantRowUncancelled()), or a waiting-list place given a seat
 * (stampRegistrantRowActive()). Both are refused unless there is actually a
 * place to give, which is the guard that makes offering this safe at all.
 *
 * A WAITLISTING THE IMPORT MADE IS NOT UNDONE HERE. If the session filled up
 * and this person is number thirteen, then promoting them is jumping a queue
 * that capacity built — the same rule applyLeaderWaitlistTicks() follows, and
 * the same reason (wasWaitlistedByHand()). The refusal says so, and says what
 * to do instead, rather than leaving a desk pressing a button that does
 * nothing.
 */
function restoreRegistrantChange(ss, sheet, rows, map, target, party, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  const status = String(row[map['Program_Status']] || '').trim() || 'Active';

  if (status === 'Active') {
    return { ok: false, message: `✅ ${name} is already on the list for ${where} — nothing to put back.` };
  }
  if (status === 'Superseded') {
    return {
      ok: false,
      message: `⚠️ That row is a superseded copy of an earlier submission, not a booking — there is ` +
        `nothing to put back. Their live row is the one to change.`
    };
  }
  if (status === 'Waitlisted' && !wasWaitlistedByHand(row, map)) {
    return {
      ok: false,
      message: `⚠️ ${name} is on the waiting list because ${where} was full when they registered, not ` +
        `because anybody put them there — so this cannot promote them out of turn. Raise Max_Capacity ` +
        `or cancel somebody, and the next sync gives them the seat.`
    };
  }

  const eventId = String(row[map['Event_ID']] || '').trim();
  const refusal = registrantChangeSeatRefusal(rows, map, eventId, where);
  if (refusal) return { ok: false, message: refusal };
  // AND THE CHAIR, on an appointment session, where "is there a seat" is the
  // wrong question: a cancelled appointment gives its slot up the moment it is
  // cancelled (readBookedAppointmentTimes() skips it), so somebody else may
  // well be in it by now.
  const held = appointmentStartLabelOf(row[map['Event_Time']]);
  if (held) {
    const others = rows.filter(other => party.indexOf(other) === -1);
    if ((readBookedAppointmentTimes(others)[eventId] || new Set()).has(held)) {
      return {
        ok: false,
        message: `⚠️ The ${held} appointment on ${where} has been given to somebody else since ${name} ` +
          `came off it. Book them a free time instead. Nothing was changed.`
      };
    }
  }

  const stamp = registrantChangeStampOptions(args);
  let restored = 0;
  party.forEach(member => {
    const memberStatus = String(member[map['Program_Status']] || '').trim();
    if (memberStatus === 'Waitlisted') {
      if (stampRegistrantRowActive(member, map, stamp)) restored++;
    } else if (stampRegistrantRowUncancelled(member, map, stamp)) {
      restored++;
    }
  });
  if (restored === 0) {
    return { ok: false, message: `⚠️ Nothing about ${name}'s row could be put back — it is already ${status.toLowerCase()}.` };
  }

  const was = status === 'Waitlisted' ? 'off the waiting list and' : 'back';
  const others = restored > 1 ? ` (with ${restored - 1} guest(s))` : '';
  return finishRegistrantChange(ss, sheet, rows,
    `✅ ${name}${others} is ${was} on the list for ${where}. Their seat is theirs again, and the ` +
    `meal they asked for is back on the order.`);
}

/**
 * Move an existing booking onto the waiting list — the same writer the "Add to
 * waitlist" tick reaches, from the other side of the dialog.
 *
 * TWO ENTRY POINTS, ONE WRITER, and they are answering different questions:
 * the tick is part of MARKING somebody at the desk and will write a row for
 * a person who has none, while this changes a booking that already exists and
 * is reached by picking them and saying what is wrong. That is the same shape
 * as the three doors 71_cancellation.gs opens onto one cancellation writer, for
 * the same reason: the sentences differ, the four cells must not.
 */
function waitlistRegistrantChange(ss, sheet, rows, map, target, party, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  const stamp = registrantChangeStampOptions(args);

  let moved = 0;
  party.forEach(member => {
    if (stampRegistrantRowWaitlisted(member, map, stamp)) moved++;
  });
  if (moved === 0) {
    const status = String(row[map['Program_Status']] || '').trim() || 'Active';
    return {
      ok: false,
      message: `⚠️ ${name} is already ${status.toLowerCase()} on ${where}, so there is nothing to move ` +
        `onto the waiting list.`
    };
  }

  const others = moved > 1 ? ` (with ${moved - 1} guest(s))` : '';
  return finishRegistrantChange(ss, sheet, rows,
    `✅ ${name}${others} moved to the waiting list for ${where}. They hold no seat and no meal is ` +
    `ordered; "Put them back on" is what gives both back.`);
}


// --- the corrections ---------------------------------------------------------

/**
 * "I MARKED THE WRONG MARY PRESENT" — a tick taken back off.
 *
 * Quick Mark could already correct one of the two ticks by accident of how the
 * lunch rule reads (ticking Lunch on its own clears Attended, which is the
 * take-out case doubling as a correction). It could not clear either one
 * outright, and it could not clear a meal count at all — so a desk that ticked
 * the wrong row had to go and find it on the Registrants tab, which is the
 * thing this dialog exists so nobody has to do.
 *
 * The meal counts go with the lunch tick rather than standing on their own:
 * "they did not get a meal" and "they got three" are the same correction at
 * two levels of detail, and a served tick with three meals underneath it
 * cleared by halves is worse than either.
 */
function undoRegistrantMarks(ss, sheet, rows, map, target, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  const attended = !!args.clearAttended;
  const lunch = !!args.clearLunch;
  if (!attended && !lunch) {
    return { ok: false, message: '⚠️ Tick which mark to take off — Attended, Lunch, or both.' };
  }
  if (!clearRegistrantMarksOnRow(row, map, { attended, lunch })) {
    return {
      ok: false,
      message: `✅ Nothing to undo — ${name} is not marked ${attended && lunch ? 'attended or fed'
        : (attended ? 'attended' : 'as having had a meal')} on ${where}.`
    };
  }
  row[map['Manual_Override']] = 'Manually Edited';
  appendAdminNote(row, map, waitlistStamp(
    `${[attended ? 'Attended' : '', lunch ? 'Lunch' : ''].filter(Boolean).join(' and ')} unticked`,
    registrantChangeStampOptions(args)));

  const what = attended && lunch ? 'attendance and lunch marks' : (attended ? 'attendance mark' : 'lunch mark');
  return finishRegistrantChange(ss, sheet, rows,
    `✅ ${name}'s ${what} taken back off for ${where}.`);
}

/**
 * THE MEAL, CORRECTED — Hot for Cold, a meal added to somebody who said no, a
 * meal taken off somebody who said yes, and how many of them.
 *
 * SET, NOT ADDED, which is the opposite of what the Lunch tick on the marking
 * path does (addQuickMarkMealCounts(), where a second handover extends the
 * first). This is a correction: somebody is telling the workbook what the
 * number IS, and adding to it would make the smaller, later, more accurate
 * number produce a bigger wrong one.
 *
 * A MEAL IS REFUSED ON A DATE THAT SERVES NONE, the same way a sign-up is at
 * the desk and for the same reason: the row would carry Lunch_Status =
 * 'Needed', the dashboard would raise "lunch needed with no menu set", and
 * whoever asked would walk away believing a meal was booked.
 */
function changeRegistrantLunch(ss, sheet, rows, map, target, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  const status = String(row[map['Program_Status']] || '').trim() || 'Active';
  if (status !== 'Active') {
    return {
      ok: false,
      message: `⚠️ ${name}'s booking is ${status.toLowerCase()} on ${where}, so no meal is on order for ` +
        `them. Put them back on the list first.`
    };
  }
  const wanted = String(args.lunchType || '').trim();
  if (REGISTRANT_LUNCH_TYPE_OPTIONS.indexOf(wanted) === -1) {
    return { ok: false, message: `⚠️ Pick Hot, Cold, or No Lunch — nothing was changed.` };
  }
  const wantsLunch = wanted !== 'No Lunch';
  if (wantsLunch && !isLunchOfferedOn(target.date, row[map['Location']])) {
    return {
      ok: false,
      message: `⚠️ No lunch is scheduled on ${where}, so ${name} cannot be put down for one. Add a Hot ` +
        `or Cold row for that date on ${SHEET_NAMES.LUNCH_SCHEDULE} first.`
    };
  }
  const meals = wantsLunch ? Math.max(1, quickMarkCount(args.mealsOrdered)) : 0;

  row[map['Lunch_Type']] = wanted;
  if (map['Lunch_Status'] !== undefined) row[map['Lunch_Status']] = wantsLunch ? 'Needed' : 'No Lunch';
  writeMealsOrdered(row, map, meals);
  row[map['Manual_Override']] = 'Manually Edited';
  appendAdminNote(row, map, waitlistStamp(
    `Meal set to ${wanted}${meals > 1 ? ` ×${meals}` : ''}`, registrantChangeStampOptions(args)));

  const said = wantsLunch
    ? `✅ ${name} is down for ${meals > 1 ? `${meals} ${wanted.toLowerCase()} meals` : `a ${wanted.toLowerCase()} meal`} on ${where}.`
    : `✅ ${name}'s meal has been taken off the order for ${where}.`;
  return finishRegistrantChange(ss, sheet, rows, said);
}

/**
 * A PHONE NUMBER IS A FACT ABOUT A PERSON, NOT ABOUT A BOOKING — so a
 * correction made at the desk lands on every upcoming row that person has,
 * not only the one that happened to be picked.
 *
 * The alternative was tested by reality and lost: correcting one row leaves
 * eleven others carrying the number that does not ring, and the cancel page
 * (which matches on the last four digits) then opens for some of somebody's
 * bookings and not others. Past rows are left exactly as they are — they are
 * the record of how we reached that person at the time.
 *
 * Member_Roll needs no write here. Its Phone/Email are rebuilt from these rows
 * on every sync — newest wins (refreshMemberRoll()), and applyMemberRollContacts()
 * only ever fills a registrant row's BLANKS back, so it cannot undo what is
 * typed here. The roll picks the correction up on its own; a second writer
 * would be a second chance to disagree.
 */
function changeRegistrantContact(ss, sheet, rows, map, target, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const phone = String(args.phone || '').trim();
  const email = String(args.email || '').trim();
  if (!phone && !email) {
    return { ok: false, message: '⚠️ Type a phone number or an email address — nothing was changed.' };
  }
  if (email && email.indexOf('@') === -1) {
    return { ok: false, message: `⚠️ "${email}" does not look like an email address — nothing was changed.` };
  }

  const nameKey = normalizeNameKey(name);
  const todayKey = formatDateKey(new Date());
  const stamp = registrantChangeStampOptions(args);
  let touched = 0;
  rows.forEach(other => {
    if (normalizeNameKey(other[map['Name']]) !== nameKey) return;
    if (isSupersededRegistrantRow(other, map)) return;
    const date = coerceDate(other[map['Event_Date']]);
    // The picked row always, whenever it is; every OTHER row only while it is
    // still ahead of us.
    if (other !== row && (!date || formatDateKey(date) < todayKey)) return;
    if (phone && map['Phone'] !== undefined) other[map['Phone']] = phone;
    if (email && map['Email'] !== undefined) other[map['Email']] = email;
    other[map['Manual_Override']] = 'Manually Edited';
    touched++;
  });
  appendAdminNote(row, map, waitlistStamp(
    `Contact details corrected${phone ? ` (phone ${phone})` : ''}${email ? ` (email ${email})` : ''}`,
    stamp));

  const spread = touched > 1 ? ` — put on all ${touched} of their upcoming rows` : '';
  return finishRegistrantChange(ss, sheet, rows,
    `✅ ${name}'s contact details updated${spread}. Member_Roll picks the new ones up on the next sync.`);
}

/**
 * ONE SENTENCE ON THE ROW — "brings her own chair", "paying next week",
 * "daughter will collect her".
 *
 * Appended rather than typed over, like every other note this project writes
 * (appendAdminNote()), and capped at the same length a cancellation reason is:
 * a cell holding four paragraphs makes the whole tab unreadable, and anybody
 * with more than a sentence to say puts it in a regular need instead — which
 * is the control directly above this one in the same dialog, and the right
 * home for anything that is true every week rather than today.
 */
function noteOnRegistrantRow(ss, sheet, rows, map, target, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  const text = String(args.note || '').replace(/\s+/g, ' ').trim().slice(0, CANCELLATION_REASON_MAX_CHARS);
  if (!text) return { ok: false, message: '⚠️ Type the note first — nothing was written.' };

  const who = getCurrentUserEmail() || '';
  appendAdminNote(row, map, `${text} (noted at the desk on ${formatDateLabel(new Date())}` +
    `${who ? ` by ${who}` : ''})`);
  row[map['Manual_Override']] = 'Manually Edited';
  return finishRegistrantChange(ss, sheet, rows, `✅ Noted on ${name}'s row for ${where}: ${text}`);
}


// --- and the last resort -----------------------------------------------------

/**
 * ONE ROW, GONE — the desk's version of removeMarkedRegistrants() (section 83).
 *
 * WHY IT DELETES RATHER THAN MARKS. Section 83's whole argument is that a
 * mis-click in a dropdown must not be permanent, and it is right about a
 * dropdown: somebody scrolling a roster picks the wrong line, and the sweep
 * being a separate menu item is what makes that recoverable. The panel is not
 * a dropdown on a roster. Somebody has picked a location, a session and a
 * name, chosen "remove this row entirely" out of nine changes, and answered a
 * confirmation naming the person and the date. At that point "it will be
 * deleted when somebody remembers to run a menu item" is not caution, it is
 * the desk being told a thing happened that has not happened — and the row is
 * still on the roster, still in the count, still cooked for.
 *
 * The mark is still there for the other job it is good at: three duplicates
 * spotted while reading down a roster, cleared in one sweep.
 *
 * SAME TWO WRITES THAT ONE MAKES, in the same order and for the same reason:
 * the tombstone BEFORE the render, without which the import and both catch-ups
 * rebuild the row on the next sync; and the form response left exactly where
 * it is, because removing a duplicate row does not mean destroying the only
 * copy of what somebody said.
 */
function removeRegistrantChange(ss, sheet, rows, map, target, party, args) {
  const row = target.row;
  const name = String(row[map['Name']] || '').trim();
  const where = describeRegistrantRowSession(row, map);
  if (!args.confirmRemove) {
    return {
      ok: false,
      needsConfirm: true,
      message: `${name} — ${where}`,
      question: `Delete ${name}'s row for ${where}?` +
        (party.length > 1 ? `\n\nTheir ${party.length - 1} guest row(s) go with it.` : '') +
        `\n\nThe row is deleted and the next sync will not put it back. The form response behind it ` +
        `is left in place, and a genuinely new registration from ${name} for that session still ` +
        `comes through.`
    };
  }

  recordRegistrantTombstones(party, map);
  const kept = rows.filter(candidate => party.indexOf(candidate) === -1);
  if (kept.length === rows.length) {
    return { ok: false, message: `⚠️ ${name}'s row could not be found to remove. Nothing was changed.` };
  }

  const others = party.length > 1 ? ` and ${party.length - 1} guest row(s)` : '';
  return finishRegistrantChange(ss, sheet, kept,
    `✅ ${name}'s row${others} removed from ${where}. The form response was left in place.`);
}
