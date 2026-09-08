// ============================================================================
// 18a. THE REGULAR PROGRAMS READ  (what runs every Tuesday, not what is on)
// ============================================================================
//
// The calendar page (17) answers "what is on between now and the end of next
// month". A person deciding whether to JOIN something is asking the other
// question — "what runs every week, and on which day" — and answering that
// from a calendar means reading two months of tiles and noticing which ones
// carry eight dates.
//
// So this is the same snapshot, folded the other way: the programs the
// sessions themselves show to be recurring weekly, filed under the weekday
// they run on.
//
// WHAT "REGULAR" MEANS HERE, and why it is decided from the dates rather than
// from a setting: nothing in this workbook stores "this is a weekly class".
// The recurrence lives in the calendar, and the only honest way to know it is
// to look at the dates. A program is on this page when, inside the window the
// public snapshot already carries:
//
//   - it has at least PUBLIC_REGULAR_MIN_SESSIONS dates (three: two points is
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
// page must not make on its behalf. Nor is LUNCH: it runs nearly every weekday
// at both buildings, so it would be one tile under five headings, and it is
// pinned at the top of the calendar page already.
//
// NO SECOND READ OF ANYTHING. This folds what publicProgramCalendar() already
// returned — same tab read, same cache, same pinned field list — so this page
// cannot come to carry a fact the calendar page was not allowed to publish.
// Everything the privacy banner in 86 says holds here by construction rather
// than by a second promise.
//
// Behavior only, numbered last for the usual reason: its own consts stand
// alone and everything it calls is a hoisted function.
// ============================================================================

/** Three dates. Two is a coincidence; three is a pattern. */
const PUBLIC_REGULAR_MIN_SESSIONS = 3;

/** Monday first — the week as a person planning one reads it, not as Date does. */
const PUBLIC_REGULAR_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday'];

/**
 * THE CALL THE REGULAR PROGRAMS PAGE MAKES. Payload is the calendar's:
 * { fresh } skips the cache, everything else is ignored.
 *
 * Returns { ok, generatedAt, todayKey, horizonKey, intro, locations, programs }
 * — or the calendar's own { ok: false, message }, unchanged, because "we could
 * not look" is one sentence whichever page is asking.
 *
 * A `program` is { key, title, location, weekday, time, sessions } and its
 * sessions are the SAME rows the calendar page draws, untouched: the page
 * below draws tiles out of them exactly as 87 does.
 */
function publicRegularPrograms(payload) {
  const snapshot = publicProgramCalendar(payload);
  if (!snapshot || snapshot.ok === false) return snapshot;
  const programs = foldRegularPrograms_(snapshot.sessions || []);
  const locations = {};
  programs.forEach(p => { if (p.location) locations[p.location] = true; });
  return {
    ok: true,
    intro: snapshot.intro,
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
 * The fold: public session rows in, weekly programs out, ordered Monday first
 * and then by the time of day they start.
 *
 * THE KEY IS THE SERVER'S OWN programKey — title + building, the same one the
 * calendar page groups its tiles on, so the two pages cannot disagree about
 * what one program is. A `[Shared]` program that runs on Tuesday in two
 * buildings stays two programs: they are two rooms to turn up at.
 */
function foldRegularPrograms_(sessions) {
  const groups = {};
  const order = [];
  sessions.forEach(session => {
    if (!session || !session.dateKey || !session.title) return;
    // Lunch is not a program somebody joins on Tuesdays — see the banner.
    if (session.lunch) return;
    const key = session.programKey || `${session.title}|${session.location || ''}`;
    if (!groups[key]) { groups[key] = { key, sessions: [] }; order.push(key); }
    groups[key].sessions.push(session);
  });

  const out = [];
  order.forEach(key => {
    const program = regularProgramFrom_(groups[key]);
    if (program) out.push(program);
  });
  out.sort(compareRegularPrograms_);
  return out;
}

/** One group of same-title, same-building sessions → a program, or null. */
function regularProgramFrom_(group) {
  const sessions = (group.sessions || []).slice()
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
  if (sessions.length < PUBLIC_REGULAR_MIN_SESSIONS) return null;

  const weekday = regularWeekdayName_(sessions[0]);
  if (!weekday) return null;

  let smallestGap = null;
  for (let i = 1; i < sessions.length; i++) {
    if (regularWeekdayName_(sessions[i]) !== weekday) return null;
    const days = regularDaysBetween_(sessions[i - 1].dateKey, sessions[i].dateKey);
    // Two rows for one date (a program typed twice on the calendar) is a zero
    // gap, not a broken pattern — it says nothing about the cadence.
    if (days === 0) continue;
    if (days === null || days % 7 !== 0) return null;
    if (smallestGap === null || days < smallestGap) smallestGap = days;
  }
  if (smallestGap !== 7) return null;

  const next = sessions[0];
  return {
    key: group.key,
    title: next.title,
    location: next.location,
    weekday,
    // The time the NEXT one starts: a term that moved from 9:30 to 10:00 is
    // described by the session somebody would actually turn up to.
    time: next.time,
    sortTime: next.sortTime,
    sessions
  };
}

/**
 * The weekday's full name, taken off the label the server already built
 * ('Thursday, October 2') rather than by parsing the date again.
 *
 * DELIBERATELY NOT A NEW FIELD ON THE SESSION ROW. That list is pinned by
 * tests/public_calendar.test.js as the whole of what may leave the workbook,
 * and a page needing a word it can already read is not a reason to widen it.
 */
function regularWeekdayName_(session) {
  const label = String((session && session.dayLabel) || '');
  const comma = label.indexOf(',');
  const name = (comma === -1 ? label : label.slice(0, comma)).trim();
  return PUBLIC_REGULAR_DAY_ORDER.indexOf(name) === -1 ? '' : name;
}

/** Whole days between two 'yyyy-MM-dd' keys, or null if either will not parse. */
function regularDaysBetween_(fromKey, toKey) {
  const from = regularKeyToUtc_(fromKey);
  const to = regularKeyToUtc_(toKey);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * 'yyyy-MM-dd' → a UTC timestamp. UTC on purpose: this is date arithmetic,
 * and a local-time midnight is one daylight-saving change away from making
 * two Tuesdays 6.958 days apart.
 */
function regularKeyToUtc_(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

/** Monday first, then start time, then title. */
function compareRegularPrograms_(a, b) {
  const dayA = PUBLIC_REGULAR_DAY_ORDER.indexOf(a.weekday);
  const dayB = PUBLIC_REGULAR_DAY_ORDER.indexOf(b.weekday);
  if (dayA !== dayB) return dayA - dayB;
  if (a.sortTime !== b.sortTime) return a.sortTime < b.sortTime ? -1 : 1;
  return a.title.localeCompare(b.title);
}
