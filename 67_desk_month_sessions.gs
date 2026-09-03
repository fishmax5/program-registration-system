// ============================================================================
// 16e. THE MONTH THE DOOR CAN REGISTER INTO  (this month and the next)
// ============================================================================
//
// Both tablet pages could only ever put somebody on a session they could SEE,
// and what they could see was the stored door index — two days back and eight
// days ahead (CHECK_IN_STORE_DAYS_BACK/AHEAD), because that is all a check-in
// list ever needs. The question actually asked at a door is not "is there a
// class on Tuesday", it is "what have you got in October, and can I put my
// name down for the club now" — and the honest answer from a tablet was to go
// and find a member of staff with the workbook open.
//
// So this file answers that one question, for both pages: every dated session
// at ONE LOCATION from today to the end of NEXT month, grouped by day.
//
// WHY IT IS A CALL AND NOT INLINED IN THE PAGE. Registering somebody for
// November is the twice-a-week job; marking forty people present is the
// every-morning one. Two months of sessions travelling inside every page load
// would be paid for by the queue at 9:55 and read by almost nobody, so the
// pages ask for it the first time somebody opens the screen that needs it.
//
// WHY IT IS A LIVE READ. A stored index is a snapshot of the days around
// today; a month out is exactly where a snapshot is most likely to be wrong,
// and a person is standing there being told a date that does not exist.
//
// It reads through collectKnownProgramChoices() and
// freeAppointmentTimesForChoice() — the same two functions Quick Mark's index
// is built from — so the desk, the door and the public form are offered the
// same sessions and the same free appointment slots, and never the same chair.
// ============================================================================

/**
 * The last day this file will offer: the last day of NEXT month.
 *
 * "This and next month" rather than "the next sixty days" on purpose — the
 * person at the desk is holding a paper calendar and asking about October, and
 * a horizon that stops on the 19th of it is a page that appears to have lost
 * half the month.
 */
function deskMonthHorizonKey(from) {
  const base = from ? new Date(from.getTime()) : new Date();
  // Day 0 of the month AFTER next is the last day of next month — the one
  // date arithmetic that never has to know how long February is.
  return formatDateKey(new Date(base.getFullYear(), base.getMonth() + 2, 0));
}

/**
 * THE CALL BOTH PAGES MAKE. Payload: { location, pin }.
 *
 * Returns { ok, location, days: [ { dateKey, dateLabel, monthKey, monthLabel,
 * sessions: [ { value, label, title, byAppointment, times } ] } ] } — a day at
 * a time, because the pages draw a day picker and then a box per session, and
 * grouping it here means neither page has to agree with the other about what a
 * month is.
 *
 * A desk blocked by a forms sweep is refused rather than answered from a
 * store: unlike today's list there is nothing stored to fall back to, and a
 * silently empty month reads as "there is nothing on in October".
 */
function deskMonthSessions(payload) {
  const args = parseCheckInPayload(payload);
  if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
  const location = matchCheckInLocation(args.location);
  if (!location) return { ok: false, message: 'Choose a location first — nothing was read.' };
  if (isDeskWorkBlocked()) return { ok: false, message: deskBusyMessage() };
  try {
    return { ok: true, location, days: readDeskMonthSessions(location) };
  } catch (err) {
    log(`deskMonthSessions could not read the months: ${err}`);
    return { ok: false, message: `Could not read the coming dates (${err}) — nothing was changed.` };
  }
}

/**
 * The body of the call, without the PIN — separately testable, and callable
 * from anything else that wants the same two months.
 *
 * LUNCH-ONLY SESSIONS ARE LEFT OUT. A meal is ordered against a count days
 * ahead (see section 8) and the door page has a lunch line of its own that
 * says so in words; offering "Lunch — 14 October" as one more box to tick
 * would be a promise of food this file is in no position to make.
 */
function readDeskMonthSessions(location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
  const registrantRows = sheet
    ? getSectionedRowValues(sheet, HEADERS.Registrant_Dash, 'Event_ID')
    : [];
  // Which appointment slots have already gone, read once for every session in
  // the two months rather than once per session — the same trick, and the same
  // reason, as buildQuickMarkIndex().
  const bookedTimes = readBookedAppointmentTimes(registrantRows);

  const todayKey = formatDateKey(new Date());
  const horizonKey = deskMonthHorizonKey(new Date());

  const byDate = {};
  const days = [];
  collectKnownProgramChoices(location, registrantRows).forEach(choice => {
    if (!choice.dateKey || choice.lunchOnly) return;
    if (choice.dateKey < todayKey || choice.dateKey > horizonKey) return;
    let day = byDate[choice.dateKey];
    if (!day) {
      const date = parseDateKey(choice.dateKey);
      day = {
        dateKey: choice.dateKey,
        dateLabel: formatDateLabel(date),
        monthKey: choice.dateKey.slice(0, 7),
        monthLabel: Utilities.formatDate(date, TIMEZONE, 'MMMM yyyy'),
        sessions: []
      };
      byDate[choice.dateKey] = day;
      days.push(day);
    }
    day.sessions.push({
      // The session VALUE every write on both pages is keyed on — the same
      // "title · date" label applyQuickMarkFromDialog() is given everywhere
      // else, so nothing here has to be translated before it is written.
      value: choice.label,
      label: choice.label,
      title: choice.title,
      byAppointment: !!choice.appointment,
      times: freeAppointmentTimesForChoice(choice, bookedTimes)
    });
  });

  days.sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
  days.forEach(day => day.sessions.sort((a, b) => a.title.localeCompare(b.title)));
  return days;
}
