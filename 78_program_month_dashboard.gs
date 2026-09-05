// ============================================================================
// 7b. THE MASTER PROGRAM DASHBOARD  (one row per program)
// ============================================================================
//
// The session table is one row per SESSION. Almost nothing downstream is:
// buildEventGroups() (24) keys every group as
// `scope::cleanTitle::monthLabel` — one program, one location, one month — and
// that key is what gets ONE Google Form, ONE leader sheet, ONE capacity and
// ONE set of links. A four-session weekly class therefore prints the same
// fourteen columns four times over, and the difference between the rows is a
// date and three counts.
//
// This tab is the other half of that join, written out on its own — with the
// schedule collapsed into a phrase a person reads instead of forty rows they
// compare.
//
// ONE ROW PER PROGRAM, WHICH IS NOT WHERE THIS STARTED. It was one row per
// program-MONTH, keyed on Form_ID, because that is the unit a form and a
// capacity belong to. That is the right grain for the tab's first question and
// the wrong grain for the one people bring to a front page: "what do we run,
// and who runs it?" A weekly class was twelve rows a year, eleven of which
// differed from the first only in which twelve dates they summed — the same
// complaint that produced this tab in the first place, one level up.
//
// So the grain moved and the key moved with it:
//
//   • A PROGRAM IS ITS TITLE AND THE BUILDING(S) IT RUNS IN. Form_ID still
//     resolves the one case a (title, location) key gets wrong — a [Shared]
//     program has ONE form across two buildings and is ONE thing to run, so it
//     is one row reading "Narberth + Ashbridge" the way describeLocations()
//     words it everywhere else — but the form is no longer the key itself. A
//     Regular program takes a NEW form every month, and keying on it is
//     precisely how the month got into the grain.
//   • THE MONTH LEFT THE ROW. Next_Date leads it (the next session from today,
//     blank when there is none) and Last_Date closes it. The split is Running
//     / Not currently running rather than Upcoming / Past, and the second
//     section is ordered by Last_Date, so a class that finished in June sits
//     above one that finished in 2019.
//   • THE FIXED-SPAN PROBLEM DISSOLVED. A [Grouped] series takes ONE form for
//     its whole run (formSpanKey() gives it the literal 'FIXED'), so it had no
//     month of its own and was filed, awkwardly, under its earliest one — the
//     design doc's open question #2, answered here for two versions with an
//     apology attached. There is no month to file it under now. It is a
//     program, it has a span, and the Schedule cell states the span.
//
// IT IS DERIVED, READ-ONLY, AND PURELY ADDITIVE — that is the whole design
// constraint, and everything below follows from it:
//
//   • Nothing reads this tab. Not the sync, not Quick Mark, not the door, not
//     the link doctor. Delete the tab and the workbook behaves exactly as it
//     did; the next render draws it again from the session rows.
//   • Nothing is STORED here that is not already on a session row or on
//     Program_Leaders / Program_Settings. There is no second record of a
//     capacity, a leader, a room or a link that could drift out of agreement
//     with the first one and be believed. The four cells a person may touch
//     (Leader and the three program flags) are WINDOWS: they are read fresh on
//     every render and what is typed into them is written back to the tab that
//     owns the answer.
//   • It is rendered from the session rows the caller ALREADY HAS in memory
//     (renderProgramDashboard passes them). A derived view that cost a second
//     full read of a several-hundred-row tab on every sync would be paying,
//     every hour, for something nobody has looked at since Tuesday.
//
// FIFTEEN COLUMNS A PERSON READS, WHERE THERE WERE SEVENTEEN — at a twelfth of
// the row count. The rule describeProgramMonthSchedule() was written under
// became the rule for the whole tab: THE FACT GOES IN THE CELL, THE FOLLOW-UP
// QUESTION GOES IN A CELL NOTE. Type_Tag stands alone; Seats is the four
// counting columns as one sentence with its working in the note; Links is four
// link columns as one cell of rich text; Leader_Source is a yellow wash and a
// note. The three program FLAGS went the other way — from words in a joined
// cell to real tick boxes, because a person on this row is as likely to want
// to change one as to read it.
// ============================================================================

/**
 * Internal plumbing, hidden for the same reason the session table hides its
 * own: Form_ID is how these rows were grouped and Group_Key is what one row
 * IS, and neither is something anybody scans a tab for.
 */
const PROGRAM_MONTH_HIDDEN_COLUMNS = ['Form_ID', 'Group_Key'];

/**
 * The three program-wide flag columns this tab offers as tick boxes, in the
 * order they read best.
 *
 * Read off PROGRAM_FLAG_COLUMNS rather than spelled out, so a flag added there
 * cannot quietly fail to appear here — but read through a FUNCTION rather than
 * a top-level const, because PROGRAM_FLAG_COLUMNS is a lazy global in another
 * file and reading one at load time is the hazard 01a_lazy_globals.gs exists
 * to stop.
 */
function programMonthFlagColumns() {
  return PROGRAM_FLAG_COLUMNS.map(flag => flag.column);
}

/** Worst-first. A group reads as its unhappiest session, so one full date is not hidden by three open ones. */
const PROGRAM_MONTH_STATUS_ORDER = ['🔴 Waitlist Only', '🟡 Almost Full', '🟢 Open', '🟢 Unlimited'];

/** Separates the parts of one collapsed cell — the same interpunct the rest of the workbook uses. */
const PROGRAM_MONTH_JOINER = ' · ';

/**
 * The links a program has, in the order they are wanted, with the
 * word each one is printed as.
 *
 * ONE CELL OF RICH TEXT, not three columns. They were three columns three
 * words wide that nobody ever sorted, filtered or read — only clicked — and
 * they pushed Status and the seat counts off the side of a screen to do it.
 * The header they are read off is the session table's; the label is what a
 * person sees.
 */
const PROGRAM_MONTH_LINK_PARTS = [
  { header: 'Form_Response_Link', label: 'Register' },
  { header: 'Edit_Form_Link', label: 'Edit form' },
  // Registrant_Sheet_Link and Sign_In_Sheet_Link are what 69 stamps on the
  // session rows. The month tab used to ask for 'Leader_Sheet_Link', which is
  // the OLD spelling of the first of those: it survives in
  // LEGACY_HEADER_ALIASES for reading a sheet, but HEADERS.All_Program_Sessions
  // is keyed by the new name, so getIndexMap() had nothing under it and the
  // column was blank on every row of every workbook. Collapsing the block into
  // one cell is what made that visible.
  { header: 'Registrant_Sheet_Link', label: 'Roster' },
  { header: 'Sign_In_Sheet_Link', label: 'Sign-in' }
];

/**
 * How many sessions it takes before "weekly" is a claim about a program rather
 * than a coincidence.
 *
 * Two sessions a week apart is two sessions a week apart. Three is a pattern,
 * and three is also the point at which listing the dates in the cell stops
 * being the better answer.
 */
const PROGRAM_MONTH_RECURRENCE_MIN_SESSIONS = 3;

/** The repeats this tab is willing to name, by the number of weeks between sessions. */
const PROGRAM_MONTH_RECURRENCE_WORDS = { 1: 'Weekly', 2: 'Every 2 weeks', 3: 'Every 3 weeks', 4: 'Monthly' };

const PROGRAM_MONTH_MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * WHICH BUILDINGS EACH FORM COVERS — { formId: [location, ...] }.
 *
 * The one thing a (title, location) key cannot work out for itself, and the
 * only reason this tab still looks at Form_ID at all. A [Shared] program has
 * ONE form and runs at two buildings; it is one thing to run, so it is one
 * row. Nothing else in the key needs the form, and using the form AS the key
 * is what put the month in the grain — a Regular program takes a new one every
 * month.
 *
 * A cheap first pass over the rows the caller already holds: one string read
 * per row, no sheet, no cache.
 */
function programFormLocations(sessionRows, map) {
  const out = {};
  (sessionRows || []).forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    if (!formId) return;
    const location = String(row[map['Location']] || '').trim();
    if (!location) return;
    if (!out[formId]) out[formId] = [];
    if (out[formId].indexOf(location) === -1) out[formId].push(location);
  });
  return out;
}

/**
 * The key a session row is filed under: one program, at the building(s) it
 * runs in, for as long as it runs.
 *
 * NO MONTH IN IT ANYWHERE, which is the phase-4 change in one line. The old
 * key was `form::${formId}` with `plain::title::location::month` behind it,
 * and both carried the month — the first implicitly (a Regular program's form
 * is monthly) and the second by writing it out. Twelve rows a year for a
 * weekly class, differing only in which dates they summed.
 *
 * The locations come from `formLocations` where the row has a form, so every
 * month of a [Shared] program resolves to the same "Narberth|Ashbridge"
 * signature and lands on one row. Where it has no form — [No Registration]
 * programs, and rows somebody typed in by hand — the row's own location is the
 * answer, which is right: without a form there is nothing to say two buildings
 * are one thing.
 *
 * NORMALIZED like every other program key in this workbook (normalizeNameKey),
 * so the casing and spacing drift that "Chair Yoga " picks up across a year of
 * calendar edits does not split a program in two.
 */
function programMonthGroupKey(row, map, formLocations) {
  const eventId = String(row[map['Event_ID']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  // A meal is not a program and never had a form: it groups by where it was
  // served and by nothing else. See the lunch note in buildProgramMonthRows().
  if (isLunchOnlyEventId(eventId)) return `lunch::${location}`;

  const title = String(row[map['Clean_Title']] || '').trim();
  const formId = String(row[map['Form_ID']] || '').trim();
  const locations = (formId && formLocations && formLocations[formId]) || [location];
  const signature = locations.map(normalizeNameKey).slice().sort().join('|');
  return `program::${normalizeNameKey(title)}::${signature}`;
}

/**
 * WHOLE WEEKS BETWEEN TWO SESSIONS, or null when they are not a whole number
 * of weeks apart. Rounded off the day count rather than the millisecond count,
 * because a Tuesday in March and a Tuesday in November are 23 or 25 hours
 * apart across a clock change and a program does not stop being weekly for it.
 */
function programMonthWeeksBetween(earlier, later) {
  const days = Math.round((later.getTime() - earlier.getTime()) / PROGRAM_MONTH_MS_PER_DAY);
  return days > 0 && days % 7 === 0 ? days / 7 : null;
}

/**
 * IS THIS PROGRAM A REPEAT, and which weeks of it are missing?
 *
 * The question the tab was not answering. "Tue 9:30 AM – 11:30 AM · 4
 * sessions" is true of a class that runs every Tuesday and equally true of one
 * that ran on the 2nd, the 9th, the 23rd and the 30th — and the difference
 * between those two is the whole of what somebody at a desk wants to know.
 * "Weekly" is the headline; the week that is NOT there is the follow-up.
 *
 * Deliberately strict about what it will call a repeat: at least three
 * sessions (two a week apart is two sessions a week apart), all on the same
 * weekday at the same time, and every gap a whole number of weeks. Anything
 * else falls through to the plain shape, because a phrase like "weekly" that
 * is only mostly true is worse than no phrase at all — it is the sentence
 * somebody plans a room booking around.
 *
 * A GAP IS NOT LABELLED CANCELLED. The calendar has no event that week, and
 * nothing in this workbook can tell a session that was called off from one
 * that was never scheduled — a holiday, a term break, a room that was
 * double-booked in June. The note says which weeks have no session and lets
 * the reader supply the reason they already know.
 *
 * Returns { weeks, word, skipped: [Date] } or null.
 */
function detectProgramMonthRecurrence(sessions) {
  if (!sessions || sessions.length < PROGRAM_MONTH_RECURRENCE_MIN_SESSIONS) return null;
  const dated = sessions.filter(s => s.date);
  if (dated.length !== sessions.length) return null;

  const first = dated[0];
  const firstSig = `${Utilities.formatDate(first.date, TIMEZONE, 'EEE')}|${first.times || ''}`;
  const gaps = [];
  for (let i = 1; i < dated.length; i++) {
    const sig = `${Utilities.formatDate(dated[i].date, TIMEZONE, 'EEE')}|${dated[i].times || ''}`;
    if (sig !== firstSig) return null;
    const weeks = programMonthWeeksBetween(dated[i - 1].date, dated[i].date);
    if (weeks === null) return null;
    gaps.push(weeks);
  }

  // THE SMALLEST GAP IS THE CADENCE, not the commonest one. A weekly class
  // that misses a week has gaps [1, 2, 1]; reading that as "every 2 weeks
  // with an extra session" would be arithmetic winning an argument against
  // the plain fact that it runs on Tuesdays.
  const weeks = Math.min.apply(null, gaps);
  const word = PROGRAM_MONTH_RECURRENCE_WORDS[weeks];
  if (!word) return null;

  // The dates the cadence says should be there, and are not.
  const present = {};
  dated.forEach(s => { present[formatDateKey(s.date)] = true; });
  const skipped = [];
  const last = dated[dated.length - 1].date;
  for (let step = 1; ; step++) {
    const when = new Date(first.date.getTime() + step * weeks * 7 * PROGRAM_MONTH_MS_PER_DAY);
    if (formatDateKey(when) > formatDateKey(last)) break;
    if (!present[formatDateKey(when)]) skipped.push(when);
    if (step > 200) break; // a corrupt date is not worth an infinite loop
  }
  return { weeks, word, skipped, signature: firstSig };
}

/**
 * "Sep 2026 – Jun 2027", or "Sep 2026" when the run does not leave its month.
 *
 * THE ONLY PLACE THE MONTH SURVIVED, and it is a fact about the row rather
 * than the grain of the tab: a program running from September to June is one
 * program with a span, not ten rows. Blank when it stays inside one month,
 * because "Sep 2026 – Sep 2026" is a longer way of saying nothing, and the
 * dates are one drill-through away.
 */
function describeProgramMonthSpan(sessions) {
  if (!sessions || sessions.length === 0) return '';
  const first = sessions[0].date;
  const last = sessions[sessions.length - 1].date;
  if (!first || !last) return '';
  const from = Utilities.formatDate(first, TIMEZONE, MONTH_DISPLAY_FORMAT);
  const to = Utilities.formatDate(last, TIMEZONE, MONTH_DISPLAY_FORMAT);
  return from === to ? from : `${from} \u2013 ${to}`;
}

/**
 * "Sep 2026 — 4\nOct 2026 — 5" : the per-month breakdown, for the note.
 *
 * The month left the GRAIN, not the tab: at one row per program, "how many in
 * October?" is still a question somebody asks, and the answer is one line each
 * rather than one ROW each. Which is the whole trade — a fact worth having
 * kept, in the place a follow-up question belongs.
 */
function describeProgramMonthBreakdown(sessions) {
  const order = [];
  const tally = {};
  (sessions || []).forEach(s => {
    if (!s.date) return;
    const label = Utilities.formatDate(s.date, TIMEZONE, MONTH_DISPLAY_FORMAT);
    if (tally[label] === undefined) { tally[label] = 0; order.push(label); }
    tally[label]++;
  });
  if (order.length < 2) return '';
  return order.map(label => `${label} \u2014 ${tally[label]}`).join('\n');
}

/**
 * "Weekly · Tue 9:30 AM – 11:30 AM · Sep 2026 – Jun 2027 · 38 sessions", or "Tue 9:30 AM – 11:00 AM ·
 * 4 sessions" when the dates do not repeat, or "4 sessions · times vary" when
 * they do not even agree — which is the line that earns this tab its keep. A
 * person reading one phrase learns what four rows of a session table were
 * there to tell them, and learns it faster.
 *
 * THE HEADLINE IS THE CADENCE WHERE THERE IS ONE. "Weekly" first, because it
 * is the fact that makes the other two redundant: told a class is weekly on
 * Tuesdays, nobody needs the dates read out. Told it runs four times, they do.
 *
 * WHEN THERE IS SOMETHING MORE TO SAY, IT GOES IN A CELL NOTE rather than into
 * the cell — the outliers of a schedule that does not agree with itself, and
 * the weeks a repeat is missing. Which Tuesday is at 2pm, and which Tuesday
 * has nothing on it at all, are follow-up questions; answered in the cell they
 * would make the common case unreadable to serve the rare one.
 */
function describeProgramMonthSchedule(sessions) {
  const count = sessions.length;
  const plural = count === 1 ? 'session' : 'sessions';
  const shapes = sessions.map(s => ({
    when: s.date,
    weekday: s.date ? Utilities.formatDate(s.date, TIMEZONE, 'EEE') : '',
    times: s.times || ''
  }));
  const distinct = [];
  shapes.forEach(shape => {
    const signature = `${shape.weekday}|${shape.times}`;
    if (distinct.indexOf(signature) === -1) distinct.push(signature);
  });

  const span = describeProgramMonthSpan(sessions);
  const breakdown = describeProgramMonthBreakdown(sessions);
  // THE SPAN IS ONLY WORTH SAYING WHEN THE RUN LEAVES ITS MONTH. A program
  // whose sessions are all in September gains nothing from "Sep 2026" in a
  // cell that already names the weekday and the count.
  const spanPart = breakdown ? `${PROGRAM_MONTH_JOINER}${span}` : '';
  const spanNote = breakdown ? `\n\nBy month:\n${breakdown}` : '';

  if (distinct.length === 1 && shapes.length > 0 && shapes[0].weekday) {
    const one = shapes[0];
    const phrase = one.times ? `${one.weekday} ${one.times}` : one.weekday;
    const repeat = detectProgramMonthRecurrence(sessions);
    if (!repeat) {
      return {
        text: `${phrase}${spanPart}${PROGRAM_MONTH_JOINER}${count} ${plural}`,
        note: breakdown ? `${phrase}.${spanNote}` : ''
      };
    }
    const dates = sessions.map(s => Utilities.formatDate(s.date, TIMEZONE, 'EEE MMM d'));
    let text = `${repeat.word}${PROGRAM_MONTH_JOINER}${phrase}${spanPart}${PROGRAM_MONTH_JOINER}${count} ${plural}`;
    let note = `${repeat.word}, ${phrase}.${spanNote}\n\nOn:\n${dates.join('\n')}`;
    if (repeat.skipped.length > 0) {
      const missed = repeat.skipped.map(d => Utilities.formatDate(d, TIMEZONE, 'EEE MMM d'));
      // SAID IN THE CELL TOO, not only in the note. A gap is the one thing
      // about a repeat that is not implied by the word "weekly", so a reader
      // who never opens the note must still be told the run has a hole in it.
      text += `${PROGRAM_MONTH_JOINER}${missed.length} skipped`;
      note += `\n\nNo session on:\n${missed.join('\n')}\n\n` +
        `The calendar has nothing that week. This workbook cannot tell a session that was ` +
        `called off from one that was never scheduled — a holiday, a term break, a room ` +
        `already taken.`;
    }
    return { text, note };
  }

  // The commonest shape is the baseline; everything else is named. Counted
  // rather than assumed, so "one Tuesday moved" reads as one outlier and not
  // as a schedule with no pattern at all.
  const tally = {};
  shapes.forEach(shape => {
    const signature = `${shape.weekday}|${shape.times}`;
    tally[signature] = (tally[signature] || 0) + 1;
  });
  let commonest = '';
  Object.keys(tally).forEach(signature => {
    if (!commonest || tally[signature] > tally[commonest]) commonest = signature;
  });
  const outliers = shapes
    .filter(shape => `${shape.weekday}|${shape.times}` !== commonest && shape.when)
    .map(shape => `${Utilities.formatDate(shape.when, TIMEZONE, 'EEE MMM d')}` +
      (shape.times ? ` — ${shape.times}` : ''));

  const usual = commonest.split('|');
  const usualPhrase = usual[0] ? (usual[1] ? `${usual[0]} ${usual[1]}` : usual[0]) : '';
  const note = outliers.length > 0
    ? `Usually ${usualPhrase || 'the same time'}.${spanNote}\n\nNot these:\n${outliers.join('\n')}`
    : (breakdown ? `Times vary.${spanNote}` : '');
  return { text: `${count} ${plural}${spanPart}${PROGRAM_MONTH_JOINER}times vary`, note };
}

/**
 * Is this flag on for the group? { Club: true, No_Registration: false, ... }
 *
 * ANY session carrying the flag means the GROUP does. These describe a
 * program, not a date — buildEventGroups() sets them on the group and never
 * unsets them per session — so a row that has not caught up with a tick yet is
 * a stale row, not a disagreement worth reporting.
 *
 * REAL BOOLEANS, not the words the session table may hold. A workbook old
 * enough to have "Club" typed in the Club column reads back as ticked
 * (isFlagColumnValue), and writing `true` here is what lets the cell be a
 * checkbox somebody can click rather than a string they have to match.
 */
function readProgramMonthFlags(sessions, map) {
  const out = {};
  PROGRAM_FLAG_COLUMNS.forEach(flag => {
    if (map[flag.column] === undefined) return;
    out[flag.column] = sessions.some(s => isFlagColumnValue(s.row[map[flag.column]], flag.regex));
  });
  return out;
}

/**
 * WHAT SORT OF THING IS THIS — the Type_Tag, in one cell.
 *
 * A group with two types prints both: a program whose sessions disagree about
 * what kind of thing they are is worth seeing rather than averaging.
 *
 * The three FLAGS used to be folded in here as words ("Class · Club"). They
 * are tick boxes of their own on this tab now — see PROGRAM_FLAG_COLUMNS and
 * the flag block in HEADERS.Master_Program_Dashboard — because a person
 * looking at this row is as likely to want to CHANGE one as to read it, and a
 * word in a joined cell is not something you can tick.
 */
function describeProgramMonthKind(sessions, map) {
  const parts = [];
  sessions.forEach(s => {
    const type = String(s.row[map['Type_Tag']] || '').trim();
    if (type && parts.indexOf(type) === -1) parts.push(type);
  });
  return parts.join(PROGRAM_MONTH_JOINER);
}

// ============================================================================
// THE TWO CELLS READ OFF PROGRAM_SETTINGS
// ============================================================================
//
// Room and Notify are the same kind of thing as Leader, one step further out:
// facts about a program that live on a tab of their own, shown on the row that
// IS that program because that is where somebody is standing when they want
// them.
//
// READ-ONLY, BOTH OF THEM, and that is not a limitation to work around later.
// Program_Settings' right half is the staff's, and the tick boxes there are
// only honest because an unticked box means off (see 81's banner). A second
// place to tick them would be a second answer to "does this program email its
// people", discovered by somebody being emailed. Leader is writable because a
// leader's row can only be ADDED and the writer refuses everything else;
// there is no equivalent shape for six booleans and a sentence about a room.
//
// ONE READ, and not a new one. readNotificationPolicyRows() already memoizes
// the whole tab per execution for the invitation pass and the reminder pass;
// this is a third caller of the same memo, so the tab is not opened again and
// the three cannot disagree about what it says.
// ============================================================================

/** The joiner between a Notify summary's parts — tighter than the cell joiner, because it is a list of tokens. */
const PROGRAM_MONTH_NOTIFY_JOINER = ' · ';

/** What a Notify cell says when the row exists and every box on it is clear. */
const PROGRAM_MONTH_NOTIFY_SILENT = 'Silent';

/**
 * "Cal · 7d · AM · Confirm" — six tick boxes as one phrase.
 *
 * A DAY COUNT IS PRINTED AS A DAY COUNT ("7d"), except the morning of, which
 * is "AM": "0d" is arithmetic, and nobody says a reminder goes out zero days
 * before. Soonest LAST, the order they actually send in, which is the order
 * policyFromNotificationRow() already puts them in.
 *
 * BLANK AND "Silent" ARE DIFFERENT ANSWERS, and the difference is the whole
 * reason this is worth a column. Blank means Program_Settings has no row for
 * this program yet — a new program, notified the way its kind is until the
 * next refresh writes it one. "Silent" means the row is there and somebody
 * has cleared every box on it. One is a gap and one is a decision, and a cell
 * that showed them the same way would hide the only one worth acting on.
 */
function describeProgramMonthNotify(policy) {
  if (!policy) return '';
  const parts = [];
  if (policy.invite) parts.push('Cal');
  (policy.days || []).forEach(day => parts.push(day === 0 ? 'AM' : `${day}d`));
  if (policy.confirmTime) parts.push('Confirm');
  return parts.length > 0 ? parts.join(PROGRAM_MONTH_NOTIFY_JOINER) : PROGRAM_MONTH_NOTIFY_SILENT;
}

/** The note under a Notify cell: the phrase spelled out, and where it is changed. */
function describeProgramMonthNotifyNote(policy) {
  const lines = [];
  if (!policy) {
    lines.push(`${SHEET_NAMES.PROGRAM_SETTINGS} has no row for this program yet.`);
    lines.push('Until it does, its registrants are notified the way a program of its kind ' +
      'normally is. The next sync writes the row.');
  } else {
    lines.push(policy.invite
      ? 'Registrants are added to the real calendar event\'s guest list.'
      : 'Registrants are NOT added to the calendar event.');
    const days = policy.days || [];
    if (days.length === 0) {
      lines.push('No reminder emails are sent.');
    } else {
      lines.push('Reminder emails:\n' + days.map(day => day === 0
        ? '• on the morning of the session'
        : `• ${day} day${day === 1 ? '' : 's'} before`).join('\n'));
    }
    if (policy.confirmTime) {
      lines.push('A confirmation is emailed the moment somebody registers — which is the only ' +
        'place an appointment\'s own time can be stated.');
    }
  }
  lines.push(`READ-ONLY here. Tick the boxes on ${SHEET_NAMES.PROGRAM_SETTINGS} — that tab owns ` +
    `the answer, and a second place to tick them would be a second answer.`);
  return lines.join('\n\n');
}

/**
 * The Program_Settings row(s) behind one program, resolved into
 * { room, notify, note }.
 *
 * A [Shared] program is TWO rows on that tab — one per building, because that
 * is the grain it is keyed at — so both are read and their rooms are both
 * printed: one form, two buildings, and quite possibly two different rooms,
 * which is exactly the thing somebody setting up needs to be told. The notify
 * summary takes the FIRST row that has one: the channels are a property of the
 * program rather than of the building, and printing "Cal · 7d / Cal · 7d"
 * would be a column of the same phrase twice.
 */
function programMonthSettingsCell(title, locations, index) {
  const empty = { room: '', notify: '', note: '' };
  if (!index || !title) return empty;
  const map = getIndexMap(HEADERS.Program_Settings);
  const rooms = [];
  let policy = null;
  let found = false;
  (locations || []).forEach(location => {
    const row = index[notificationProgramKey(title, location)];
    if (!row) return;
    found = true;
    const room = String(row[map['Room_Or_Setup']] || '').trim();
    if (room && rooms.indexOf(room) === -1) rooms.push(room);
    if (!policy) policy = policyFromNotificationRow(row, map, false);
  });
  return {
    room: rooms.join(PROGRAM_MONTH_JOINER),
    notify: found ? describeProgramMonthNotify(policy) : '',
    note: describeProgramMonthNotifyNote(found ? policy : null)
  };
}

/**
 * HOW FULL IS IT — the four counting columns as one phrase.
 *
 *   "12 / 20 · 60% · 2 waiting"     capped, and somebody is queueing
 *   "12 / 20 · 60%"                 capped
 *   "12 · unlimited"                no cap on anything in the group
 *   "—"                             nobody, and nothing to say about it
 *
 * FOUR COLUMNS THAT WERE ONE SENTENCE. Nobody reads a Registered without
 * looking at the capacity beside it, Fill was arithmetic on those two printed
 * in a column of its own, and Waitlist was blank or zero on almost every row.
 *
 * BLANK CAPACITY IS "unlimited", NEVER "0" AND NEVER "0%" — the same
 * discipline percentageOrNull() exists for on the metrics block. Most programs
 * here are uncapped, and "0% full" would be a bare-faced lie about a month of
 * open-door sessions.
 *
 * The note is where the sum is shown its working: which window the numbers
 * cover, and how many of the group's sessions actually carried a cap. A group
 * where three sessions are capped at 20 and a fourth is open has a real total
 * and a fill worked out over the three, and a reader who is not told that will
 * eventually find it out by being wrong in front of somebody.
 */
function describeProgramMonthSeats(counts) {
  const registered = counts.registered || 0;
  const waitlist = counts.waitlist || 0;
  const capped = counts.cappedSessions || 0;
  const parts = [];

  if (capped > 0) {
    const fill = percentageOrNull(counts.cappedRegistered || 0, counts.capacity || 0);
    // "45 / 10" WOULD BE A NONSENSE, so a partly-capped group does not print
    // one. Where every session has a cap, the pair reads as it should. Where
    // only some do, the total registered and the capped seats are two
    // different populations and the cell says which is which — the
    // alternative, printing only the capped sessions' registrations, would
    // silently lose forty people from the count.
    parts.push(capped < counts.sessions
      ? `${registered}${PROGRAM_MONTH_JOINER}${counts.capacity} capped seats`
      : `${registered} / ${counts.capacity}`);
    if (fill !== null) parts.push(`${fill}%`);
  } else if (registered > 0) {
    parts.push(`${registered}${PROGRAM_MONTH_JOINER}unlimited`);
  }
  if (waitlist > 0) parts.push(`${waitlist} waiting`);
  const text = parts.length > 0 ? parts.join(PROGRAM_MONTH_JOINER) : '';

  const lines = [`${registered} registered${counts.window ? ` ${counts.window}` : ''}.`];
  if (capped > 0) {
    lines.push(`${counts.capacity} seat(s) across ${capped} capped session(s)` +
      (capped < counts.sessions ? ` — the other ${counts.sessions - capped} are uncapped, and ` +
        `the percentage is worked out over the capped ones only.` : '.'));
  } else {
    lines.push('No session in this group has a capacity, so there is no percentage to give.');
  }
  if (waitlist > 0) lines.push(`${waitlist} on the waitlist.`);
  return { text, note: lines.join('\n\n') };
}

/**
 * THE THREE LINKS AS ONE CELL — [{ label, url }], in the order they are
 * wanted, skipping the ones this group has not got.
 *
 * A link cell that holds words rather than a link (NO_REGISTRATION_LINK_LABEL,
 * on a [No Registration] program) comes back as a part with no url, so the
 * words are still printed. Losing them would turn "this program deliberately
 * takes no registrations" into an empty cell, which reads as a broken one.
 */
function programMonthLinkParts(firstNonBlank) {
  const parts = [];
  PROGRAM_MONTH_LINK_PARTS.forEach(part => {
    const raw = firstNonBlank(part.header);
    const text = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!text) return;
    const url = hyperlinkFormulaUrl(text);
    // A formula the parser did not recognize is printed as its own label
    // rather than as a formula: a cell reading =HYPERLINK(...) in the middle
    // of a sentence is worse than the words it was standing for.
    parts.push(url ? { label: part.label, url } : { label: text, url: '' });
  });
  return parts;
}

/** The plain-text fallback the rich-text pass writes over — and what is left if it fails. */
function describeProgramMonthLinks(parts) {
  return parts.map(p => p.label).join(PROGRAM_MONTH_JOINER);
}

/** The group's worst status, or '' when no session on it says anything. */
function worstProgramMonthStatus(sessions, map) {
  let worst = '';
  let worstRank = PROGRAM_MONTH_STATUS_ORDER.length;
  sessions.forEach(s => {
    const status = String(s.row[map['Status']] || '').trim();
    if (!status) return;
    const at = PROGRAM_MONTH_STATUS_ORDER.indexOf(status);
    // A status this file has never heard of is treated as the WORST thing on
    // the group rather than ignored: a tab that quietly drops the one value it
    // did not recognize is how a group with something wrong with it reads
    // green.
    const rank = at === -1 ? -1 : at;
    if (rank < worstRank) { worstRank = rank; worst = status; }
  });
  return worst;
}

/**
 * THE WINDOW THE SEAT COUNTS ARE SUMMED OVER: this calendar month and the next
 * one, whole.
 *
 * WHY NOT THE PROGRAM'S WHOLE LIFE. At one row per program a lifetime
 * Registered is a number that only ever goes up, tells nobody whether there is
 * room next Tuesday, and — printed beside a capacity — reads as a total
 * somebody could book against. "Chair Yoga 412 / 480" is arithmetic about
 * 2019.
 *
 * WHY NOT JUST "FROM TODAY". A window that starts today makes a program read
 * emptier every week of the month, for no reason a person could see, and makes
 * the number disagree with the metrics block above it (which counts calendar
 * months). Whole months, starting with this one.
 *
 * WHY TWO AND NOT ONE. A month is not enough notice for the thing the number
 * is for. On the 28th, "this month" is a class that has already run; the next
 * month is the one somebody is deciding about, and a window that hides it
 * would make the tab useless in exactly the week people plan in.
 *
 * `today` is passed in rather than read here so that the whole row builder
 * stays a pure function of its inputs — which is what lets the tests pin these
 * rules without a spreadsheet or a clock.
 */
function programSeatWindow(today) {
  const now = today ? new Date(today.getTime()) : new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0); // last day of next month
  const fromKey = formatDateKey(from);
  const toKey = formatDateKey(to);
  return {
    today: now,
    from, to,
    label: `in ${Utilities.formatDate(from, TIMEZONE, MONTH_DISPLAY_FORMAT)} and ` +
      `${Utilities.formatDate(to, TIMEZONE, MONTH_DISPLAY_FORMAT)}`,
    covers: date => {
      if (!date) return false;
      const key = formatDateKey(date);
      return key >= fromKey && key <= toKey;
    }
  };
}

/** The next session from today, or null when the program is not currently running. */
function nextSessionDate(sessions, today) {
  const todayKey = formatDateKey(today || new Date());
  let found = null;
  sessions.forEach(s => {
    if (!s.date || formatDateKey(s.date) < todayKey) return;
    if (!found || s.date < found) found = s.date;
  });
  return found;
}

/**
 * The session a Sessions cell should drill through to: the next one, or the
 * last one for a program that is over.
 *
 * A row that spans a year cannot sensibly land somebody on its September block
 * in June. Never null — the caller only reaches this with at least one
 * session.
 */
function nextOrLastSession(sessions, today) {
  const todayKey = formatDateKey(today || new Date());
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].date && formatDateKey(sessions[i].date) >= todayKey) return sessions[i];
  }
  return sessions[sessions.length - 1];
}

/** A number out of a cell that may hold '', '--', or words. 0 for anything that is not one. */
function programMonthNumber(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/**
 * Session rows in, Master_Program_Dashboard rows out. Pure — no sheet, no cache, no
 * clock beyond the dates on the rows themselves — which is what lets the tests
 * pin the collapsing rules without a spreadsheet.
 *
 * `linkTarget` — { gid, rowNumbersByEventId } for the session tab, so the
 * Sessions cell can be a drill-through link. Omitted (by every test, and by
 * anything that has no sheet in hand) the cell is the plain count, which is
 * what it always was.
 *
 * `leaderIndex` — buildProgramLeaderIndex(), if the caller has it. Omitted,
 * the Leader column comes back blank: this function still writes nothing
 * anywhere, and the leader it would have printed is not a fact it holds.
 *
 * `settingsIndex` — readNotificationPolicyRows(), the memoized read of
 * Program_Settings the invitation and reminder passes already make. Omitted,
 * Room and Notify come back blank, for the same reason.
 *
 * Returns { rows, notes, links, matched }. All three side-channels are keyed
 * by the row ARRAY (not its index), because the rows are about to be split
 * into Upcoming and Past and sorted, and an index into the list handed back
 * here would be an index into a list that no longer exists by the time they
 * are applied:
 *
 *   notes    the cell notes — a schedule's outliers and skipped weeks, a
 *            seat count's working.
 *   links    [{ label, url }] per row, for the one cell of rich text the
 *            three link columns became. The row itself carries the plain
 *            words, so a workbook where the rich-text pass fails still reads.
 *   matched  the rows whose Leader came off an unconfirmed Title_Match
 *            proposal. This is what Leader_Source used to be a whole column
 *            for; it is a wash and a note now, so it travels beside the rows
 *            instead of on them.
 */
function buildProgramMonthRows(sessionRows, sessionMap, linkTarget, leaderIndex, settingsIndex, today) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const groups = {};
  const order = [];
  const formLocations = programFormLocations(sessionRows, sessionMap);
  const window = programSeatWindow(today);

  (sessionRows || []).forEach(row => {
    const date = coerceDate(row[sessionMap['Event_Date']]);
    // No date, no place on a tab whose row is a span. A dateless row keeps
    // living on the session table, where it is visible and fixable.
    if (!date) return;
    const key = programMonthGroupKey(row, sessionMap, formLocations);
    if (!groups[key]) {
      groups[key] = { key, sessions: [] };
      order.push(key);
    }
    groups[key].sessions.push({
      row,
      date,
      times: formatTimeRange(row[sessionMap['Event_Date']],
        sessionMap['Event_End'] === undefined ? '' : row[sessionMap['Event_End']])
    });
  });

  const rows = [];
  const notes = [];
  const links = [];
  const matched = [];
  order.forEach(key => {
    const group = groups[key];
    const sessions = group.sessions.slice().sort((a, b) => a.date - b.date);
    const first = sessions[0].row;
    const isLunch = key.indexOf('lunch::') === 0;

    const locations = [];
    sessions.forEach(s => {
      const location = String(s.row[sessionMap['Location']] || '').trim();
      if (location && locations.indexOf(location) === -1) locations.push(location);
    });

    // THIS MONTH AND NEXT, never the program's whole life. At one row per
    // program a lifetime Registered is a number that only goes up, says
    // nothing about whether there is room next Tuesday, and — beside a
    // capacity — reads as a total somebody could book against. The window is
    // named in the cell's note; the Sessions drill-through is where history
    // lives. See programSeatWindow().
    const counted = sessions.filter(s => window.covers(s.date));
    let registered = 0, waitlist = 0, capacity = 0, cappedRegistered = 0, cappedSessions = 0;
    counted.forEach(s => {
      registered += programMonthNumber(s.row[sessionMap['Active_Count']]);
      waitlist += programMonthNumber(s.row[sessionMap['Waitlist_Count']]);
      const cap = sessionCapacity(s.row, sessionMap);
      if (cap !== null) {
        cappedSessions++;
        capacity += cap;
        cappedRegistered += programMonthNumber(s.row[sessionMap['Active_Count']]);
      }
    });

    // THE MOST RECENT NON-BLANK WINS for each link, which is a change the
    // grain forced and an improvement anyway. A Regular program has a form per
    // MONTH, so its rows genuinely disagree about which link is current — and
    // the one worth handing out is this month's, not the one from last
    // September. Walked backwards from the newest session; a row written
    // before a form existed holds a blank and is skipped, rather than losing a
    // link the program plainly has.
    const firstNonBlank = header => {
      let found = '';
      for (let i = sessions.length - 1; i >= 0; i--) {
        const value = sessionMap[header] === undefined ? '' : sessions[i].row[sessionMap[header]];
        if (String(value || '').trim()) { found = value; break; }
      }
      return found;
    };

    const schedule = describeProgramMonthSchedule(sessions);
    // A MEAL IS NOT A PROGRAM, and this is the whole of what that costs here:
    // one row per location, saying what it is and how many days it has run,
    // instead of the ~250 rows a year the session table carries. Its Schedule
    // says the span rather than a weekday, because lunch is every weekday and
    // "Mon–Fri · 250 sessions" tells nobody anything. Everything downstream
    // that counts PROGRAMS still filters these out by Event_ID, exactly as it
    // does today — see renderProgramDashboard()'s filter.
    const sessionsLabel = isLunch
      ? `${sessions.length} ${sessions.length === 1 ? 'day' : 'days'}`
      : `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`;
    // LINKED AT THE NEXT SESSION, or at the last one for a program that is
    // over. A row that now spans a year cannot sensibly drop somebody at its
    // September rows in June: the block they want is the one that is about to
    // happen. This is also where the month detail went — the tab stopped
    // having a row per month, and this cell is the way through to the dates.
    const drillAt = nextOrLastSession(sessions, window.today);
    const sessionsCell = programMonthSessionsCell(sessionsLabel,
      String(drillAt.row[sessionMap['Event_ID']] || '').trim(), linkTarget);
    const scheduleCell = isLunch
      ? describeDateSpan(sessions[0].date, sessions[sessions.length - 1].date)
      : schedule.text;

    const seats = describeProgramMonthSeats({
      registered, waitlist, capacity, cappedRegistered, cappedSessions,
      sessions: counted.length,
      window: window.label
    });
    const linkParts = programMonthLinkParts(firstNonBlank);
    const nextDate = nextSessionDate(sessions, window.today);

    const out = new Array(headers.length).fill('');
    out[map['Next_Date']] = nextDate || '';
    out[map['Last_Date']] = sessions[sessions.length - 1].date;
    out[map['Location']] = describeLocations(locations);
    out[map['Program']] = isLunch
      ? `Lunch @ ${locations[0] || 'this location'}`
      : String(first[sessionMap['Clean_Title']] || '');
    out[map['Type_Tag']] = isLunch ? '' : describeProgramMonthKind(sessions, sessionMap);
    // A MEAL CARRIES NO PROGRAM FLAGS. It is not a program (see the note
    // above), so its boxes are left blank rather than drawn unticked: an
    // unticked box is an answer, and there is no question here to answer.
    if (!isLunch) {
      const flags = readProgramMonthFlags(sessions, sessionMap);
      programMonthFlagColumns().forEach(column => {
        if (map[column] !== undefined) out[map[column]] = !!flags[column];
      });
    }
    out[map['Schedule']] = scheduleCell;
    out[map['Sessions']] = sessionsCell;
    out[map['Seats']] = seats.text;
    out[map['Links']] = describeProgramMonthLinks(linkParts);
    out[map['Status']] = isLunch ? '' : worstProgramMonthStatus(sessions, sessionMap);
    // Lunch has no leader row and never will — it is not a program (see the
    // note above), and a blank here is the true answer rather than a gap.
    const leader = isLunch
      ? { name: '', source: '' }
      : programMonthLeaderCell(String(first[sessionMap['Clean_Title']] || ''), locations, leaderIndex);
    out[map['Leader']] = leader.name;
    // Lunch is not a program and has no Program_Settings row — there is
    // nothing to look up, and a blank is the true answer rather than a gap.
    const settings = isLunch
      ? { room: '', notify: '', note: '' }
      : programMonthSettingsCell(String(first[sessionMap['Clean_Title']] || ''), locations,
        settingsIndex);
    out[map['Room']] = settings.room;
    out[map['Notify']] = settings.notify;
    // THE CURRENT form, off the same session the links came from — a Regular
    // program has one per month, and last September's id is not the one
    // somebody troubleshooting this program wants in the formula bar.
    out[map['Form_ID']] = String(firstNonBlank('Form_ID') || '');
    out[map['Group_Key']] = key;

    rows.push(out);
    if (linkParts.length > 0) links.push({ row: out, parts: linkParts });
    if (leader.source === PROGRAM_MONTH_LEADER_SOURCE_MATCHED) matched.push(out);
    if (!isLunch && schedule.note) notes.push({ row: out, header: 'Schedule', text: schedule.note });
    if (!isLunch && seats.note) notes.push({ row: out, header: 'Seats', text: seats.note });
    if (!isLunch && settings.note) notes.push({ row: out, header: 'Notify', text: settings.note });
  });

  return { rows, notes, links, matched };
}



/**
 * options.sessionRows — the session rows the caller already has. Passed by
 * every render on the sync path; the menu item is the one caller that has to
 * go and read them, and it is the one caller nothing is waiting on.
 */
function renderProgramMonthDashboard(force, options) {
  options = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_MONTH);
  const sessionHeaders = HEADERS.All_Program_Sessions;
  const sessionMap = getIndexMap(sessionHeaders);

  const sessionSheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  let sessionRows = options.sessionRows;
  if (!sessionRows) {
    sessionRows = sessionSheet ? getSectionedRows(sessionSheet, sessionHeaders, 'Event_ID') : [];
  }

  // THE METRICS THE CALLER ALREADY COMPUTED, or — on the menu path, the one
  // caller nothing is waiting on — computed here from the same two inputs and
  // by the same function, so the numbers cannot depend on how the tab was
  // asked for. A failure to work them out costs the block, not the tab.
  let metrics = options.metrics;
  if (!metrics) {
    try {
      const programRows = sessionRows.filter(row => !isLunchOnlyEventId(row[sessionMap['Event_ID']]));
      const registrantsSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
      metrics = computeProgramMetrics(programRows, sessionMap, scanRegistrants(registrantsSheet));
    } catch (err) {
      log(`\u2139\ufe0f Master_Program_Dashboard: could not compute the metrics block (${err}) — the month table is drawn without it.`);
      metrics = null;
    }
  }

  // The SAME index the coverage line, the sharing paths and the mail paths
  // read, memoized per execution. Caught rather than thrown: a leader tab that
  // cannot be read costs two columns, not the tab.
  let leaderIndex = null;
  try {
    leaderIndex = buildProgramLeaderIndex();
  } catch (err) {
    log(`\u2139\ufe0f Could not read the leader index for ${SHEET_NAMES.PROGRAM_MONTH}'s Leader column (${err}).`);
  }

  // THE SAME memoized read of Program_Settings the invitation pass and the
  // reminder pass make — a third caller of one memo, not a third read of one
  // tab. Caught rather than thrown: a settings tab that cannot be read costs
  // two columns, not the tab.
  let settingsIndex = null;
  try {
    settingsIndex = readNotificationPolicyRows();
  } catch (err) {
    log(`\u2139\ufe0f Could not read ${SHEET_NAMES.PROGRAM_SETTINGS} for ` +
      `${SHEET_NAMES.PROGRAM_MONTH}'s Room and Notify columns (${err}).`);
  }

  const built = buildProgramMonthRows(sessionRows, sessionMap, {
    gid: sessionSheet ? sessionSheet.getSheetId() : null,
    rowNumbersByEventId: programMonthSessionRowNumbers(sessionSheet, sessionMap)
  }, leaderIndex, settingsIndex, new Date());
  writeProgramMonthSheet(sheet, built, force, metrics);
  log(`${SHEET_NAMES.PROGRAM_MONTH}: ${built.rows.length} program row(s) from ` +
    `${sessionRows.length} session row(s).`);
  return built;
}

function writeProgramMonthSheet(sheet, built, force, metrics) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const numCols = headers.length;

  invalidateSectionedRowsCache(sheet);
  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // hidden rows outlive clear() — see renderFlatDateSheet()
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  // Notes outlive clear() as well, and this tab writes them onto whichever row
  // a group lands on — a row that MOVES the moment a session is added. Last
  // render's notes go before this render's are written, or the tab
  // accumulates explanations attached to the wrong months.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearNote();

  // RUNNING FIRST, THEN THE REST. The split is a status, not a date — see
  // partitionRunningPrograms() — so it is worked out before the metrics block
  // is drawn, because the coverage line under that block counts the running
  // half.
  const { running, finished } = partitionRunningPrograms(built.rows, map);

  // --- The metrics block, on the tab whose grain it matches ---
  let row = 1;
  if (metrics) {
    row = writeProgramMetricsSection(sheet, row, numCols, metrics);
    row = writeProgramMonthCoverageLine(sheet, row, numCols,
      programMonthLeaderCoverage(running, map));
    row++; // spacer
  }

  const result = writeUpcomingPastSections(sheet, row, headers, running, finished, {
    upcomingLabel: '▶️ Running', pastLabel: '⏸️ Not Currently Running',
    // NOT COLLAPSED. Old-month hiding is defined against a tab of sessions,
    // where two months is hundreds of rows; here the whole history of the
    // place is a couple of dozen, and the point of the tab is that it fits on
    // a screen. Passed explicitly rather than left to the default, because the
    // default would silently hide half of what this tab exists to show — and
    // it would hide it by looking for an Event_Date column this tab has not
    // got, which is the quieter half of the same mistake.
    collapseOldMonths: false
  });

  const zones = [
    { start: result.upcomingDataStart, count: running.length },
    { start: result.pastDataStart, count: finished.length }
  ];

  const rules = [];
  const locationRanges = [];
  zones.forEach(z => {
    if (z.count < 1) return;
    // The month tint the sectioned writer applies for itself on every other
    // tab. It keys off a column literally named Event_Date, and this tab's
    // leading date is Next_Date — so it is applied here rather than by
    // changing what that shared writer is defined against.
    //
    // ON NEXT_DATE, WHERE IT USED TO BE ON MONTH_START, and it is doing more
    // work than it was: at one row per program the tint is what makes "these
    // four all start again in October" visible without reading a single date.
    // A program that is not currently running has no Next_Date and takes no
    // tint, which is the right answer rather than a missing one.
    applyMonthColorTint(sheet, map['Next_Date'] + 1, z.start, z.count);
    // Last_Date is a DAY, and the day is the point of it: the second section
    // is ordered by how recently a program stopped.
    sheet.getRange(z.start, map['Last_Date'] + 1, z.count, 1)
      .setNumberFormat(DATE_DISPLAY_FORMAT);
    Object.keys(EVENT_STATUS_COLORS).forEach(text => {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text)
        .setBackground(EVENT_STATUS_COLORS[text])
        .setRanges([sheet.getRange(z.start, map['Status'] + 1, z.count, 1)]).build());
    });
    locationRanges.push(sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  });
  rules.push(...buildLocationColorRules(locationRanges));
  sheet.setConditionalFormatRules(rules);

  writeProgramMonthNotes(sheet, map, built.notes, upcoming, past, result);
  writeProgramMonthLinkCells(sheet, map, built.links, upcoming, past, result);
  washMatchedProgramMonthLeaders(sheet, map, built.matched, upcoming, past, result);

  // EVERY column BUT THE FOUR A PERSON MAY TOUCH, because every other column
  // here is derived from the session rows and an edit to one would be
  // overwritten by the next sync without ever having changed anything — which
  // is precisely what the warning says.
  //
  // The four exceptions are windows, not drawers (see the banners below):
  // Leader is read off Program_Leaders and written back to it, and the three
  // program flags are read off the session rows and written back to them and
  // to the calendar. Every one of them is still derived; none of them is
  // stored here.
  const editable = [PROGRAM_MONTH_LEADER_COLUMN].concat(programMonthFlagColumns());
  protectDerivedColumns(sheet, headers, headers.filter(h => editable.indexOf(h) === -1), zones);
  applyProgramMonthLeaderValidation(sheet, map, zones,
    [result.upcomingHeaderRow, result.pastHeaderRow], programLeaderNames());
  applyProgramMonthFlagCheckboxes(sheet, map, zones,
    [result.upcomingHeaderRow, result.pastHeaderRow]);
  applyColumnVisibility(sheet, headers, PROGRAM_MONTH_HIDDEN_COLUMNS);
  freezeRowsSafely(sheet, result.upcomingHeaderRow);
  freezeColumnsSafely(sheet, 3); // next date, location, program name
  autosizeColumns(sheet, { force: !!force, minCols: numCols });
}

/**
 * WHICH SHEET ROW ONE OF THESE ROW ARRAYS LANDED ON, or 0.
 *
 * Every per-row pass after the write — the notes, the link cells, the
 * unconfirmed-leader wash — needs the same answer, and none of them can hold
 * an index: the rows were split into Upcoming and Past and sorted between
 * being built and being written. The row ARRAY is the identity that survives
 * that, so it is what the side-channels are keyed by.
 */
function programMonthRowPosition(row, upcoming, past, result) {
  let at = upcoming.indexOf(row);
  if (at !== -1) return result.upcomingDataStart + at;
  at = past.indexOf(row);
  if (at !== -1) return result.pastDataStart + at;
  return 0; // a row that was not written can't be annotated
}

/**
 * RUNNING / NOT CURRENTLY RUNNING — the split that replaced Upcoming / Past.
 *
 * WHY NOT partitionByDate(). Every other date-bearing tab in this workbook is
 * one row per DATE, so "has that date gone?" is the whole question and
 * partitionByDate() is the whole answer. A row here is a program, which has no
 * single date to be on one side or the other of: a weekly class that started
 * in September and runs to June is neither upcoming nor past, and filing it by
 * either end of its span is filing it by something nobody asked about.
 *
 * The question a person actually has is "is this a thing we run at the
 * moment?", and the honest answer is whether it has a session still to come.
 * Which is exactly Next_Date: set, and it is running; blank, and it is not.
 *
 * SO THIS IS 79_member_roll.gs's SHAPE, NOT 34's — a status section, the way
 * the roll files a retired member below a divider with their notes intact. A
 * program between terms is not deleted, is not stale, and is not wrong: it is
 * a true record of something this place runs, sitting under a heading that
 * says it is not running today. Two banner-and-header sections rather than the
 * roll's single divider row, because this tab's edit handler finds a row's
 * columns by walking up to the nearest header (handleProgramMonthEdit), and
 * one header for two differently-sorted halves would be one header too few.
 *
 * The second section is ordered by Last_Date, newest first: a class that
 * finished in June is the one somebody is looking for, and the 2019 one is
 * not. The first is ordered by Next_Date, soonest first, and then by name so a
 * day's worth of programs reads alphabetically rather than at random.
 */
function partitionRunningPrograms(rows, map) {
  const running = [];
  const finished = [];
  (rows || []).forEach(row => {
    if (coerceDate(row[map['Next_Date']])) running.push(row); else finished.push(row);
  });
  const name = row => String(row[map['Program']] || '');
  running.sort((a, b) => {
    const at = coerceDate(a[map['Next_Date']]).getTime();
    const bt = coerceDate(b[map['Next_Date']]).getTime();
    return at === bt ? name(a).localeCompare(name(b)) : at - bt;
  });
  finished.sort((a, b) => {
    const ad = coerceDate(a[map['Last_Date']]);
    const bd = coerceDate(b[map['Last_Date']]);
    const at = ad ? ad.getTime() : 0;
    const bt = bd ? bd.getTime() : 0;
    return at === bt ? name(a).localeCompare(name(b)) : bt - at;
  });
  return { running, finished };
}

/** The cell notes — a schedule's outliers and skipped weeks, a seat count's working. */
function writeProgramMonthNotes(sheet, map, notes, upcoming, past, result) {
  if (!notes || notes.length === 0) return;
  notes.forEach(note => {
    const row = programMonthRowPosition(note.row, upcoming, past, result);
    if (!row) return;
    sheet.getRange(row, map[note.header] + 1).setNote(note.text);
  });
}

/**
 * THE THREE LINKS AS ONE CELL YOU CAN CLICK THREE PLACES IN.
 *
 * A cell holds ONE =HYPERLINK() formula, which is why three links were three
 * columns. Rich text holds a link per RUN, so "Register · Edit form · Roster"
 * is one cell with three live words in it — and the two columns that bought
 * back go to Seats and Status, which people actually read.
 *
 * The plain words are already on the sheet (the row carries them), so this is
 * a pass that adds links to text rather than one that writes the text. A
 * workbook where it throws — an older Apps Script runtime, a protected range —
 * keeps a cell that says the right words and does not link them, which is a
 * cosmetic loss and not a broken tab. Caught per row for that reason, and
 * logged once rather than per row.
 */
function writeProgramMonthLinkCells(sheet, map, links, upcoming, past, result) {
  if (!links || links.length === 0) return;
  if (map['Links'] === undefined) return;
  let failed = 0;
  links.forEach(entry => {
    const row = programMonthRowPosition(entry.row, upcoming, past, result);
    if (!row) return;
    try {
      const text = describeProgramMonthLinks(entry.parts);
      const builder = SpreadsheetApp.newRichTextValue().setText(text);
      let at = 0;
      entry.parts.forEach((part, i) => {
        if (i > 0) at += PROGRAM_MONTH_JOINER.length;
        const end = at + part.label.length;
        if (part.url) builder.setLinkUrl(at, end, part.url);
        at = end;
      });
      sheet.getRange(row, map['Links'] + 1).setRichTextValue(builder.build());
    } catch (err) {
      failed++;
    }
  });
  if (failed > 0) {
    log(`\u2139\ufe0f ${failed} ${SHEET_NAMES.PROGRAM_MONTH} link cell(s) were left as plain words.`);
  }
}

// ============================================================================
// PHASE 2 — WHAT THE MONTH ROW MAKES POSSIBLE
// ============================================================================
//
// Three things land here, and all three are the same argument: this is the tab
// whose grain matches the question.
//
//   THE METRICS BLOCK, moved up off the session table (see the note in
//   renderProgramDashboard()). Its arithmetic and every one of its column
//   notes stay in 43_program_dashboard.gs, which is what makes "the numbers
//   must not move by a digit" true by construction rather than by inspection:
//   the same computeProgramMetrics() over the same rows, drawn one tab across.
//
//   LEADER COVERAGE — "Programs with no leader this month: 3". The number
//   Program_Leaders exists to drive to zero, and the honest measure of whether
//   attributing leaders to programs is working at all. It reads
//   buildProgramLeaderIndex() — the SAME index the sharing and mail paths read,
//   memoized per execution, so this is not a second read of that tab — and it
//   is a COUNT, never an action: nothing here shares a sheet or sends anything.
//
//   THE SESSIONS DRILL-THROUGH. "4 sessions" becomes a link into the session
//   tab at that group's own first day row, which is what makes two tabs read
//   as one view. It degrades to the plain count rather than to a wrong link —
//   a link to the wrong program's rows is worse than no link at all.
// ============================================================================

/**
 * { Event_ID: sheet row } for the session tab as it stands right now: one read
 * of one column, so a month row can point at its own block of day rows rather
 * than at the top of the tab.
 *
 * Caught, not thrown, and empty on failure — the Sessions cells then read as
 * plain counts. A drill-through link is not worth a render.
 */
function programMonthSessionRowNumbers(sessionSheet, sessionMap) {
  const out = {};
  if (!sessionSheet) return out;
  try {
    const lastRow = sessionSheet.getLastRow();
    if (lastRow < 1) return out;
    const values = sessionSheet.getRange(1, sessionMap['Event_ID'] + 1, lastRow, 1).getValues();
    values.forEach((cells, i) => {
      const eventId = String(cells[0] || '').trim();
      // FIRST wins. An Event_ID appears once, but a tab caught mid-repair can
      // hold a stray duplicate, and the earlier row is the one in Upcoming.
      if (eventId && out[eventId] === undefined) out[eventId] = i + 1;
    });
  } catch (err) {
    log(`\u2139\ufe0f Could not read the session tab's row numbers (${err}) — Master_Program_Dashboard's Sessions cells stay plain text.`);
  }
  return out;
}

/**
 * The Sessions cell, linked at the group's first session row when both the
 * tab's gid and that row are known, and the plain words otherwise.
 */
function programMonthSessionsCell(label, firstEventId, target) {
  target = target || {};
  const row = target.rowNumbersByEventId ? target.rowNumbersByEventId[firstEventId] : undefined;
  if (target.gid === null || target.gid === undefined || row === undefined) return label;
  return makeHyperlinkFormula(`#gid=${target.gid}&range=A${row}`, label);
}

/**
 * How many of the programs we are CURRENTLY RUNNING have nobody down as
 * leading them, and which ones — the count for the line, the names for its
 * note.
 *
 * IT USED TO SAY "THIS MONTH", because the tab used to have a month in it. At
 * one row per program the honest population is the one the section above the
 * line already names: everything with a session still to come. A program
 * between terms has no leader gap worth chasing, and counting it would make
 * the number one nobody could drive to zero.
 *
 * Lunch is not a program and is not counted. A row whose Location reads
 * "Narberth + Ashbridge" (one form, two buildings) counts as covered if EITHER
 * building's program has a leader row: a shared program is one thing to run,
 * and reporting it as unstaffed because only one of its two keys matched would
 * be a number nobody could act on.
 *
 * READ-ONLY, like everything else on this tab. It counts rows on
 * Program_Leaders; it never writes one, never shares a sheet and never sends
 * anything — see the NO WILDCARDS paragraph at the top of 65_program_leaders.gs.
 */
function programMonthLeaderCoverage(rows, map) {
  map = map || getIndexMap(HEADERS.Master_Program_Dashboard);
  const missing = [];
  let considered = 0;

  let index;
  try {
    index = buildProgramLeaderIndex();
  } catch (err) {
    log(`\u2139\ufe0f Could not read the leader index for ${SHEET_NAMES.PROGRAM_MONTH}'s coverage line (${err}).`);
    return null;
  }

  (rows || []).forEach(row => {
    if (String(row[map['Group_Key']] || '').indexOf('lunch::') === 0) return;
    const title = String(row[map['Program']] || '').trim();
    if (!title) return;
    considered++;
    const locations = String(row[map['Location']] || '').split(' + ').map(part => part.trim()).filter(Boolean);
    const covered = locations.some(location => {
      const leaders = index[leaderProgramKey(title, location)];
      return !!(leaders && leaders.length > 0);
    });
    if (!covered) missing.push(`${title} — ${row[map['Location']]}`);
  });

  return { considered, missing: missing.sort() };
}

/**
 * The coverage line, written under the metric tables and styled like them.
 * Returns the next free row.
 *
 * ONE LINE, not a table: it is a single number, and a number with a heading
 * row above it and a blank row below it would be three rows of frozen band
 * spent on one fact.
 */
function writeProgramMonthCoverageLine(sheet, row, numCols, coverage) {
  if (!coverage) return row;
  const label = 'Programs running now with no leader';
  sheet.getRange(row, 1, 1, 2).setValues([[label, coverage.missing.length]]);
  sheet.getRange(row, 1)
    .setFontSize(TYPO.HERO_LABEL.size)
    .setFontWeight(TYPO.HERO_LABEL.weight)
    .setFontColor(TYPO.HERO_LABEL.color)
    .setNote(coverage.missing.length > 0
      ? `Counted over the ${coverage.considered} program(s) with a session still to come.\n\n` +
        `Nobody on ${SHEET_NAMES.PROGRAM_LEADERS} is down as leading:\n${coverage.missing.join('\n')}\n\n` +
        `Add a row there naming the program and its location. This tab only COUNTS — ` +
        `nothing is shared and no mail is sent from here.`
      : `Every one of the ${coverage.considered} program(s) still running has a leader row on ` +
        `${SHEET_NAMES.PROGRAM_LEADERS}.`);
  sheet.getRange(row, 2)
    .setFontSize(TYPO.METRIC_VALUE.size)
    .setFontWeight(TYPO.METRIC_VALUE.weight)
    .setFontColor(TYPO.METRIC_VALUE.color)
    .setHorizontalAlignment('center')
    .setNumberFormat('0');
  try { sheet.setRowHeight(row, ROW_HEIGHTS.DATA); } catch (err) { /* row absent */ }
  return row + 1;
}

/** Menu: rebuild the program view on its own, from whatever the session tab currently says. */
function renderProgramMonthSheetNow() {
  renderProgramMonthDashboard(true);
  SpreadsheetApp.getActive().toast(`${SHEET_NAMES.PROGRAM_MONTH} rebuilt from the session table.`);
}

// ============================================================================
// PHASE 4 — THE LEADER COLUMN, WHICH IS A WINDOW AND NOT A DRAWER
// ============================================================================
//
// Everything else on this tab is derived from the session rows and read-only.
// Leader is derived from Program_Leaders and WRITABLE, and the two halves of
// that sentence are the whole design:
//
//   read:   the Program_Leaders row for (title | location)  ->  Leader cell
//   write:  edit the cell -> handleProgramMonthEdit() (18) writes that row
//                         -> invalidateProgramLeaderIndex()
//
// THE COLUMN IS NOT A SECOND PLACE WHO-LEADS-WHAT IS STORED. Nothing ever
// reads this cell back: the next render asks Program_Leaders again, so a cell
// somebody typed into and a leader tab that disagrees with it cannot both
// survive a sync. That matters more here than anywhere else on the tab,
// because "who leads this" is also "who may read this roster" — two records
// disagreeing about that is discovered the day somebody is emailed a class
// they do not teach.
//
// MONTHLY CARRY-FORWARD NEEDED NO CODE, and this is the file where that is
// worth saying out loud: leaderProgramKey(title, location) has no month in it.
// Attach a leader to Chair Yoga at Narberth once and every future month's row
// resolves to the same key and prints the same name, with nothing stored per
// month and nothing to carry anywhere. tests/program_month.test.js pins it.
// ============================================================================

/**
 * WHERE A LEADER'S NAME CAME FROM — a row proposed by a Title_Match phrase
 * that nobody has confirmed yet, or one somebody typed.
 *
 * This was a COLUMN on the tab, printing one of these two words beside every
 * name. It is a side-channel now (buildProgramMonthRows' `matched`) feeding
 * the yellow wash and a cell note, because 'typed' was a word spent on the
 * ordinary case and 'matched' was already being said twice — the pair of cells
 * took the wash as well. See washMatchedProgramMonthLeaders().
 *
 * The two values still have names because programMonthLeaderCell() is a pure
 * function the tests read, and "the leader came off an unconfirmed proposal"
 * deserves a word rather than a bare boolean.
 */
const PROGRAM_MONTH_LEADER_SOURCE_MATCHED = 'matched';
const PROGRAM_MONTH_LEADER_SOURCE_TYPED = 'typed';

/**
 * Who is down as leading this program, off the SAME per-execution index
 * the sharing and mail paths read — never a second read, and never a second
 * answer that could disagree with theirs.
 *
 * A program with two leaders prints both, because it has two: a class with a
 * lead and an assistant is ordinary (see buildProgramLeaderIndex()), and
 * printing one of them would make the tab quietly wrong about who holds the
 * roster.
 *
 * A shared program — one form, two buildings, Location reading "Narberth +
 * Ashbridge" — takes the leaders of BOTH keys, the same way the coverage line
 * counts it as covered if either building's row names somebody. It is one
 * thing to run.
 *
 * The source is 'matched' if ANY row behind the cell is still an unconfirmed
 * Title_Match proposal. Worst-first, like the status column: a name nobody has
 * checked is the fact worth surfacing, and averaging it away against a typed
 * row beside it would hide the one of the two that needs looking at.
 */
function programMonthLeaderCell(title, locations, index) {
  if (!index || !title) return { name: '', source: '' };
  const names = [];
  let matched = false;
  (locations || []).forEach(location => {
    (index[leaderProgramKey(title, location)] || []).forEach(leader => {
      const name = String(leader.name || '').trim();
      if (!name || names.indexOf(name) !== -1) return;
      names.push(name);
      if (leader.matched) matched = true;
    });
  });
  if (names.length === 0) return { name: '', source: '' };
  return {
    name: names.join(', '),
    source: matched ? PROGRAM_MONTH_LEADER_SOURCE_MATCHED : PROGRAM_MONTH_LEADER_SOURCE_TYPED
  };
}

/**
 * The dropdown, and the note above it.
 *
 * SUGGESTING, NOT RESTRICTING — the same rule the Program and Location lists
 * on the leader tab are applied under, and for a stronger reason here: a
 * leader who has never been typed anywhere has no row to be offered off, and a
 * closed list would refuse the very edit that would create their first one.
 *
 * The blank is the empty cell an open list already allows. Clearing the cell
 * is answered by the handler rather than obeyed — nothing on this tab deletes
 * a leader row, and the dialog says where one is deleted.
 */
function applyProgramMonthLeaderValidation(sheet, map, zones, headerRows, names) {
  const column = map[PROGRAM_MONTH_LEADER_COLUMN] + 1;
  zones.forEach(z => {
    if (z.count < 1) return;
    applyOpenValueListValidationBounded(sheet, column, names, z.start, z.count);
  });
  (headerRows || []).forEach(row => {
    if (!row) return;
    try {
      sheet.getRange(row, column).setNote(
        `Type or pick a name here and a row is ADDED on ${SHEET_NAMES.PROGRAM_LEADERS} — the tab ` +
        `that shares a roster and sends the mail. Emails stay off until you tick them there.\n\n` +
        `Nothing here removes a leader: clear the cell and the next render reads the same name ` +
        `back off ${SHEET_NAMES.PROGRAM_LEADERS}, which is where a row is deleted.\n\n` +
        `A YELLOW cell means a Title_Match phrase proposed that name and nobody has checked ` +
        `it yet.`);
    } catch (err) { /* the header row moved out from under us; the dropdown is the point */ }
  });
}

/**
 * The manual-entry wash on the cells whose leader was GUESSED — the same
 * yellow the other tabs use for "please look at this", used here for exactly
 * that and nowhere else on the tab.
 *
 * THIS IS WHAT LEADER_SOURCE USED TO BE A COLUMN FOR. That column held one of
 * two words, and the interesting one — 'matched', an unconfirmed Title_Match
 * proposal — was already being said twice, because the pair of cells took this
 * wash as well. A column that repeats what the colour beside it already says
 * is a column, and this tab had four too many. The wash carries it now, with a
 * cell note saying what the yellow means: the fact in the cell, the follow-up
 * in the note, the same rule as everywhere else here.
 *
 * One getRangeList() per render rather than a setBackground() per row: a year
 * of unconfirmed matches would otherwise be a hundred round trips on a tab
 * nobody asked to be slow.
 */
function washMatchedProgramMonthLeaders(sheet, map, matched, upcoming, past, result) {
  if (!matched || matched.length === 0) return;
  const column = map[PROGRAM_MONTH_LEADER_COLUMN] + 1;
  const a1 = [];
  matched.forEach(row => {
    const at = programMonthRowPosition(row, upcoming, past, result);
    if (at) a1.push(sheet.getRange(at, column, 1, 1).getA1Notation());
  });
  if (a1.length === 0) return;
  try {
    const list = sheet.getRangeList(a1);
    list.setBackground(MANUAL_ENTRY_CELL_TINT);
    list.setNote(`A ${SHEET_NAMES.PROGRAM_LEADERS} Title_Match phrase proposed this name and ` +
      `nobody has checked it yet.\n\nIt shares nothing and sends nothing on its own. Delete the ` +
      `note on that row there once you have confirmed it, and the yellow goes.`);
  } catch (err) {
    log(`\u2139\ufe0f Could not wash the matched leader cells on ${SHEET_NAMES.PROGRAM_MONTH} (${err}).`);
  }
}

// ============================================================================
// THE PROGRAM FLAGS, WHICH ARE WINDOWS FOR THE SAME REASON LEADER IS
// ============================================================================
//
// Club, No_Registration and Personalized_Assistance describe a PROGRAM. They
// lived on the session table, which meant they were ticked onto every one of
// that program's twelve rows — eleven identical checkboxes whose only job was
// to not disagree with the twelfth, kept in line by spreadFlagToSiblingRows()
// on the way in and reconcileProgramFlagColumns() on the way back. This is the
// row that IS the program, so this is where the question belongs.
//
// NOTHING IS STORED HERE. A tick is read off the session rows on every render
// (readProgramMonthFlags) and a tick typed here is written STRAIGHT BACK to
// them, and onto the calendar, by handleProgramMonthFlagEdit() in 18 — which
// reuses the same spread and the same pending-flag queue the session table's
// own handler has always used. Untick a box and re-render and the answer comes
// from the same place it did before: the calendar's tags, via the session
// rows. So the tab is still derived, and there is still exactly one record of
// whether a program is a club.
// ============================================================================

/** The one column on this tab a person types a name into. */
const PROGRAM_MONTH_LEADER_COLUMN = 'Leader';

/**
 * Real checkboxes on the three flag columns, and the note above each that says
 * what ticking one actually does.
 *
 * The note matters more here than on the session table it moved from: there,
 * a tick was visibly one of twelve identical boxes and plainly a property of
 * the program. Here it is one box on one row, and the thing it reaches — every
 * session of that program, and the calendar event behind each one — is not
 * visible from the cell.
 */
function applyProgramMonthFlagCheckboxes(sheet, map, zones, headerRows) {
  PROGRAM_FLAG_COLUMNS.forEach(flag => {
    if (map[flag.column] === undefined) return;
    const column = map[flag.column] + 1;
    zones.forEach(z => {
      if (z.count < 1) return;
      try {
        sheet.getRange(z.start, column, z.count, 1)
          .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
          .setHorizontalAlignment('center');
      } catch (err) {
        log(`\u2139\ufe0f Could not draw the ${flag.column} checkboxes on ` +
          `${SHEET_NAMES.PROGRAM_MONTH} (${err}).`);
      }
    });
    (headerRows || []).forEach(row => {
      if (!row) return;
      try {
        sheet.getRange(row, column).setNote(
          `${flag.onQuestion('This program')}\n\n${flag.onDetail('It')}\n\n` +
          `Ticking this box here changes the whole PROGRAM, not one date: every one of its ` +
          `session rows is ticked to match and [${flag.tag}] is written onto its calendar events.`);
      } catch (err) { /* the header row moved out from under us; the box is the point */ }
    });
  });
}
