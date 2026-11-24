// ============================================================================
// 99zzk. A DATE CALLED OFF ON THE CALENDAR STAYS ITS OWN SESSION
// ============================================================================
//
// Staff cancel a date by renaming its event "CANCELLED DUE TO ILLNESS: Memoir
// Writing" (99zzc). The title is in Event_ID, so until now that rename made the
// date a DIFFERENT session: the real row looked deleted (its registrants went
// to Deleted_Event_Triage) and a new row, maybe a new program, appeared under
// the CANCELLED title. Nobody on that date was told anything by the roster,
// because they were no longer on it.
//
// parseEventTitle() (20) now takes the status word off before the title is an
// identity and says `isCancelled`. So the date keeps its Event_ID, its row and
// its people, and:
//   • the row's Status reads CANCELLED_SESSION_STATUS, written for a new row
//     (26), set or cleared on an existing one by the pass below (inside 21's
//     reconcile scope), and kept by the recount (30), which zeroes the seats
//     but leaves the counts — they are who has to be told;
//   • the date is not offered on the form, from either path that builds a
//     form's dates (sessionsOfGroup in 24, buildFormSessionContext in 09);
//   • the public pages drop it (86 already drops any Status saying "cancel");
//   • the weekly email leaves it out (70);
//   • a group whose every date is called off makes no form (24).
// Renaming the event back clears the mark on the next sync.
//
// MIGRATION. A row written BEFORE this, under the CANCELLED title, now names
// an Event_ID no event computes: the next sync triages it like any vanished
// date, and the date itself comes back as an ordinary row only if no row with
// the stripped title exists. Its people are on Deleted_Event_Triage, and
// Programs & Forms ▸ Put Triaged People on Their New Program (99zzd) moves them
// onto the restored date.
// ============================================================================

const CANCELLED_SESSION_STATUS = '🚫 Cancelled';

// sessionTimeKey → true (called off) / false (on), for every event the
// current execution grouped. Filled by buildEventGroups (24).
let __calendarSessionCancelled = {};

function recordCalendarSessionCancelled_(calendarId, cleanTitle, start, cancelled) {
  try {
    const key = sessionTimeKey(calendarId, cleanTitle, formatDateKey(start));
    // Two events on one date: called off only if every one of them is.
    __calendarSessionCancelled[key] = (key in __calendarSessionCancelled)
      ? (__calendarSessionCancelled[key] && cancelled) : cancelled;
  } catch (err) { /* a key that cannot be built is a row this cannot mark */ }
}

function resetCalendarSessionCancelled_() {
  __calendarSessionCancelled = {};
}

function isCancelledSessionStatus(value) {
  return String(value || '').trim() === CANCELLED_SESSION_STATUS;
}

/**
 * Marks the rows whose event is called off this run, and unmarks the ones put
 * back on. Only rows whose event was read this execution are touched. Returns
 * how many rows changed. Never throws.
 */
function reconcileCancelledSessionsFromCalendar(registrySheet) {
  try {
    if (Object.keys(__calendarSessionCancelled).length === 0) return 0;
    const model = loadSessionGrid(registrySheet);
    if (!model) return 0;
    if (['Calendar_Source', 'Clean_Title', 'Event_Date', 'Status'].some(h => !model.map[h])) return 0;
    let changed = 0;
    model.zones.forEach(zone => {
      const sources = sessionGridColumn(model, zone, 'Calendar_Source');
      const titles = sessionGridColumn(model, zone, 'Clean_Title');
      const starts = sessionGridColumn(model, zone, 'Event_Date');
      const status = sessionGridColumn(model, zone, 'Status');
      const remaining = model.map['Remaining_Seats'] ? sessionGridColumn(model, zone, 'Remaining_Seats') : null;
      if (!sources || !titles || !starts || !status) return;
      let touched = false;
      for (let r = 0; r < zone.count; r++) {
        const date = coerceDate(starts[r]);
        if (!date) continue;
        const key = sessionTimeKey(sources[r], String(titles[r] || '').trim(), formatDateKey(date));
        if (!(key in __calendarSessionCancelled)) continue;
        const marked = isCancelledSessionStatus(status[r]);
        if (__calendarSessionCancelled[key] && !marked) {
          status[r] = CANCELLED_SESSION_STATUS;
          if (remaining) remaining[r] = 0;
        } else if (!__calendarSessionCancelled[key] && marked) {
          status[r] = ''; // the recount writes the real one
        } else continue;
        touched = true;
        changed++;
      }
      if (touched) {
        markSessionGridColumn(model, zone, 'Status');
        if (remaining) markSessionGridColumn(model, zone, 'Remaining_Seats');
      }
    });
    flushSessionGrid(model);
    if (changed) log(`Cancelled sessions: ${changed} row(s) marked or unmarked from the calendar.`);
    return changed;
  } catch (err) {
    log(`⚠️ Could not mark cancelled sessions this run (${err}).`);
    return 0;
  }
}
