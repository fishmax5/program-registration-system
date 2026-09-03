/** Recomputes Active_Count / Waitlist_Count / Remaining_Seats / Status on the session table (both Upcoming and Past zones). */
function recomputeEventRegistryCounts(registrySheet, registrantsSheet, registrantRows) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return;

  const regMap = getHeaderMapAt(registrySheet, headerRows[0]); // identical column layout at every header row
  const counts = buildEventCountsFromRegistrants(registrantsSheet, registrantRows);

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, regMap['Event_Date']);
    if (!zone) return;
    recomputeCountsForZone(registrySheet, zone.start, zone.count, regMap, counts);
  });
}

function buildEventCountsFromRegistrants(registrantsSheet, registrantRows) {
  const counts = {};
  const headers = HEADERS.Registrant_Dash;
  const rows = registrantRows || getSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (!eventId) return;
    if (!counts[eventId]) {
      counts[eventId] = {
        active: 0, waitlist: 0,
        // THE SAME TWO NUMBERS COUNTED IN SLOTS, for the sessions whose
        // capacity is measured in slots rather than in chairs — see
        // occupancyForSession(). Sets, because two rows on one appointment
        // (a couple) are ONE slot, and Sets are how "how many different
        // times are spoken for" is asked.
        activeSlots: new Set(), waitlistSlots: new Set(),
        // Rows carrying no time at all cannot be pooled with anything, so
        // each is counted as a place of its own rather than silently
        // vanishing from a slot tally.
        activeUntimed: 0, waitlistUntimed: 0
      };
    }
    const entry = counts[eventId];
    const status = row[map['Program_Status']];
    const slot = appointmentStartLabelOf(row[map['Event_Time']]);
    if (status === 'Active') {
      entry.active++;
      if (slot) entry.activeSlots.add(slot); else entry.activeUntimed++;
    }
    if (status === 'Waitlisted') {
      entry.waitlist++;
      if (slot) entry.waitlistSlots.add(slot); else entry.waitlistUntimed++;
    }
  });
  return counts;
}

/** The empty count entry, so every reader can assume the same shape. */
function emptyEventCounts() {
  return {
    active: 0, waitlist: 0,
    activeSlots: new Set(), waitlistSlots: new Set(),
    activeUntimed: 0, waitlistUntimed: 0
  };
}

/**
 * HOW FULL ONE SESSION IS, in the unit its capacity is written in.
 *
 * An ordinary session's capacity is CHAIRS: three people in the room are three
 * of them, and a party of two takes two. An appointment session's capacity is
 * SLOTS — Max_Capacity is literally its slot count (resolveAppointmentCapacity())
 * — and a slot holds an appointment, not a head. Heather sees a couple at 10:30
 * and that is ONE appointment; the 11:00 and 11:30 slots are still free.
 *
 * Counting people on both was what made a three-slot afternoon read as full
 * after two bookings: one person at 10:00, a couple at 10:30, three "registered"
 * against a capacity of three, 🔴 Waitlist Only and "(FULL - Waitlist)" stamped
 * on the date — with an empty 11:00 still being offered by the form itself,
 * which has always worked in slots (buildAppointmentChoicesForContext() drops a
 * time the moment anybody takes it). The form and the sheet disagreed, and the
 * sheet was the one that was wrong.
 *
 * A row with no time on it is counted as a place of its own: it is somebody
 * booked onto the session that no slot can be attributed to, and dropping it
 * would under-count the day.
 */
function occupancyForSession(counts, isAppointmentSession) {
  const entry = counts || emptyEventCounts();
  if (!isAppointmentSession) return { active: entry.active || 0, waitlist: entry.waitlist || 0 };
  const slots = set => (set && typeof set.size === 'number') ? set.size : 0;
  return {
    active: slots(entry.activeSlots) + (entry.activeUntimed || 0),
    waitlist: slots(entry.waitlistSlots) + (entry.waitlistUntimed || 0)
  };
}

function recomputeCountsForZone(registrySheet, dataStart, numRows, regMap, counts) {
  const eventIds = registrySheet.getRange(dataStart, regMap['Event_ID'], numRows, 1).getValues();
  const maxCaps = registrySheet.getRange(dataStart, regMap['Max_Capacity'], numRows, 1).getValues();
  // WHICH SESSIONS COUNT IN SLOTS RATHER THAN IN PEOPLE — see
  // occupancyForSession(). Read here rather than inferred from the count,
  // because "three registered against a capacity of three" looks identical
  // either way and only the session knows which it is.
  const isAppointment = regMap['Personalized_Assistance'] === undefined
    ? null
    : registrySheet.getRange(dataStart, regMap['Personalized_Assistance'], numRows, 1).getValues();

  const activeOut = [], waitlistOut = [], remainingOut = [], statusOut = [];
  for (let i = 0; i < numRows; i++) {
    const eventId = eventIds[i][0];
    const rawCap = maxCaps[i][0];
    const isUncapped = rawCap === '--' || rawCap === '' || Number(rawCap) <= 0;
    const maxCap = isUncapped ? 0 : Number(rawCap);
    const c = occupancyForSession(counts[eventId],
      !!isAppointment && isAssistanceColumnValue(isAppointment[i][0]));

    activeOut.push([c.active]);
    if (isUncapped) {
      waitlistOut.push(['']);
      remainingOut.push(['']);
      statusOut.push(['🟢 Unlimited']);
    } else {
      waitlistOut.push([c.waitlist]);
      remainingOut.push([Math.max(maxCap - c.active, 0)]);
      statusOut.push([computeStatus(c.active, maxCap)]);
    }
  }
  registrySheet.getRange(dataStart, regMap['Active_Count'], numRows, 1).setValues(activeOut);
  registrySheet.getRange(dataStart, regMap['Waitlist_Count'], numRows, 1).setValues(waitlistOut);
  registrySheet.getRange(dataStart, regMap['Remaining_Seats'], numRows, 1).setValues(remainingOut);
  registrySheet.getRange(dataStart, regMap['Status'], numRows, 1).setValues(statusOut);
  invalidateSectionedRowsCache(registrySheet);
}

/**
 * How many forms this pass may OPEN in one run.
 *
 * It normally opens none — a form whose labels and lunch shape have not moved
 * costs a hash compare — so the cap only ever bites when something changed for
 * a lot of forms at once: a month of menus typed in one sitting, or the first
 * run after a change to what a label says. Those are exactly the runs that
 * could otherwise spend the whole six-minute execution on Forms calls and be
 * killed part-way. Whatever is left keeps its stale fingerprint and is picked
 * up by the next sync, an hour later, until the backlog is gone.
 */
const FORM_SHAPE_CHECK_MAX_FORMS_PER_RUN = 25;

