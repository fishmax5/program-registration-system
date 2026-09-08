// ============================================================================
// 18a. THE WEEKLY PROGRAMS READ  (what runs every Tuesday, not what is on)
// ============================================================================
//
// The calendar page (17) answers "what is on this Thursday". A person deciding
// whether to JOIN something is asking the other question — "what runs every
// week, and on which day" — and answering it from a day-by-day calendar means
// reading eight weeks of cards and noticing that Chair Yoga appears in all of
// them. That is a thing a computer should have done.
//
// So this is the same snapshot, folded the other way: one entry per PROGRAM
// that the sessions themselves show to be recurring weekly, filed under the
// weekday it runs on.
//
// WHAT "WEEKLY" MEANS HERE, and why it is decided from the sessions rather
// than from a setting: nothing in this workbook stores "this is a weekly
// class". The recurrence lives in the calendar, and the only honest way to
// know it is to look at the dates. A program is weekly when, inside the
// window the public page already carries:
//
//   - it has at least PUBLIC_WEEKLY_MIN_SESSIONS dates (three: two points is
//     a coincidence, three is a pattern);
//   - every one of them is on the SAME WEEKDAY;
//   - every gap between consecutive dates is a whole number of weeks, and the
//     smallest gap is exactly one — the same rule detectProgramMonthRecurrence
//     (78) uses, and for the same reason: a weekly class that misses a week
//     has gaps [1, 2, 1], and reading that as fortnightly would be arithmetic
//     winning an argument against the plain fact that it runs on Tuesdays.
//
// A program running EVERY OTHER week is deliberately not here. It is on the
// calendar page like everything else, and "Every Tuesday" is a promise this
// page should not make on its behalf.
//
// NO SECOND READ OF ANYTHING. This is built by folding what
// publicProgramCalendar() already returned — same tab read, same cache, same
// pinned field list, so the weekly page cannot come to carry a fact the
// calendar page was not allowed to publish. Everything the privacy banner in
// 86 says holds here by construction rather than by a second promise.
//
// Behavior only, numbered last for the usual reason: its own consts stand
// alone and everything it calls is a hoisted function.
// ============================================================================

/** Three dates. Two is a coincidence; three is a pattern. */
const PUBLIC_WEEKLY_MIN_SESSIONS = 3;

/** Monday first — the week as a person planning one reads it, not as Date does. */
const PUBLIC_WEEKLY_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * THE CALL THE WEEKLY PAGE MAKES. Payload is the calendar's: { fresh } skips
 * the cache, everything else is ignored.
 *
 * Returns { ok, generatedAt, todayKey, horizonKey, locations, programs } — or
 * the calendar's own { ok: false, message }, unchanged, because "we could not
 * look" is one sentence whichever page is asking.
 */
function publicWeeklyPrograms(payload) {
  const snapshot = publicProgramCalendar(payload);
  if (!snapshot || snapshot.ok === false) return snapshot;
  const programs = foldWeeklyPrograms_(snapshot.sessions || []);
  const locations = {};
  programs.forEach(p => { if (p.location) locations[p.location] = true; });
  return {
    ok: true,
    generatedAt: snapshot.generatedAt,
    todayKey: snapshot.todayKey,
    horizonKey: snapshot.horizonKey,
    // The buildings that have a WEEKLY program in them, which is not every
    // building on the calendar page: a filter chip with nothing behind it is
    // a chip that empties the page when it is tapped.
    locations: Object.keys(locations).sort(),
    programs
  };
}

/**
 * The fold: public session rows in, weekly program entries out, sorted by
 * weekday and then by the time of day they start.
 *
 * THE KEY IS TITLE + BUILDING. A `[Shared]` program that runs on Tuesday in
 * two buildings is two things a person can go to, at two addresses, and
 * collapsing them into one entry would print an address that is wrong for
 * half the people reading it.
 */
function foldWeeklyPrograms_(sessions) {
  const groups = {};
  const order = [];
  sessions.forEach(session => {
    if (!session || !session.dateKey || !session.title) return;
    const key = `${session.title}||${session.location || ''}`;
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(session);
  });

  const out = [];
  order.forEach(key => {
    const entry = weeklyProgramEntry_(groups[key]);
    if (entry) out.push(entry);
  });
  out.sort(compareWeeklyPrograms_);
  return out;
}

/** One group of same-title, same-building sessions → an entry, or null. */
function weeklyProgramEntry_(group) {
  if (!group || group.length < PUBLIC_WEEKLY_MIN_SESSIONS) return null;

  const dated = group.slice().sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
  const weekday = weeklyWeekdayName_(dated[0]);
  if (!weekday) return null;

  let smallestGap = null;
  for (let i = 1; i < dated.length; i++) {
    if (weeklyWeekdayName_(dated[i]) !== weekday) return null;
    const days = weeklyDaysBetween_(dated[i - 1].dateKey, dated[i].dateKey);
    // A duplicate row for one date (a `[Shared]` program typed twice, say) is
    // a zero gap, not a broken pattern — it says nothing about the cadence.
    if (days === 0) continue;
    if (days === null || days % 7 !== 0) return null;
    if (smallestGap === null || days < smallestGap) smallestGap = days;
  }
  if (smallestGap !== 7) return null;

  // THE NEXT ONE IS THE ONE THAT MATTERS: its link is the current form, its
  // seats are the seats somebody would be taking, and its time is what the
  // program actually starts at now (a term that moved from 9:30 to 10:00 is
  // described by its next session, not by its first).
  const next = dated[0];
  return {
    id: `${weekday}|${next.id}`,
    title: next.title,
    location: next.location,
    weekday,
    time: next.time,
    sortTime: next.sortTime,
    // Every date in the window, so the page can say how many are left and
    // when the run reaches — without a second card per date.
    dates: dated.map(s => s.dateKey),
    count: dated.length,
    nextDateKey: next.dateKey,
    nextDayLabel: next.dayLabel,
    lastDayLabel: dated[dated.length - 1].dayLabel,
    lunch: !!next.lunch,
    club: !!next.club,
    appointment: !!next.appointment,
    url: next.url,
    state: next.state,
    seats: next.seats
  };
}

/**
 * The weekday's full name, taken off the label the server already built
 * ('Thursday, October 2') rather than by parsing the date again.
 *
 * DELIBERATELY NOT A NEW FIELD ON THE SESSION ROW. That list is pinned by
 * tests/public_calendar.test.js as the whole of what may leave the workbook,
 * and a page that needs a word it can already read is not a reason to widen
 * it.
 */
function weeklyWeekdayName_(session) {
  const label = String((session && session.dayLabel) || '');
  const comma = label.indexOf(',');
  const name = (comma === -1 ? label : label.slice(0, comma)).trim();
  return PUBLIC_WEEKLY_DAY_ORDER.indexOf(name) === -1 ? '' : name;
}

/** Whole days between two 'yyyy-MM-dd' keys, or null if either will not parse. */
function weeklyDaysBetween_(fromKey, toKey) {
  const from = weeklyKeyToUtc_(fromKey);
  const to = weeklyKeyToUtc_(toKey);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86400000);
}

/** 'yyyy-MM-dd' → a UTC timestamp. UTC on purpose: this is date arithmetic,
 *  and a local-time midnight is one daylight-saving change from 6.958 days. */
function weeklyKeyToUtc_(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

/** Monday first, then start time, then title. */
function compareWeeklyPrograms_(a, b) {
  const dayA = PUBLIC_WEEKLY_DAY_ORDER.indexOf(a.weekday);
  const dayB = PUBLIC_WEEKLY_DAY_ORDER.indexOf(b.weekday);
  if (dayA !== dayB) return dayA - dayB;
  if (a.sortTime !== b.sortTime) return a.sortTime < b.sortTime ? -1 : 1;
  return a.title.localeCompare(b.title);
}
