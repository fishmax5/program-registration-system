// ============================================================================
// 7b. THE PROGRAM_MONTH TAB  (one row per program-month)
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
// This tab is the other half of that join, written out on its own: one row per
// program-month, with the schedule collapsed into a phrase a person reads
// instead of four rows they compare.
//
// TEN COLUMNS A PERSON READS, WHERE THERE WERE SEVENTEEN. A tab that exists so
// four rows read as one line is not doing its job at nineteen columns wide —
// that is not a line somebody reads, it is a line they scroll. So the rule
// describeProgramMonthSchedule() was written under became the rule for the
// whole tab: THE FACT GOES IN THE CELL, THE FOLLOW-UP QUESTION GOES IN A CELL
// NOTE. Type_Tag stands alone; Seats is the four counting columns as one
// sentence with its working in the note; Links is four link columns as one
// cell of rich text; Leader_Source is a yellow wash and a note. The three
// program FLAGS went the other way — from words in a joined cell to real tick
// boxes, because a person on this row is as likely to want to change one as to
// read it (see the flag banner further down).
//
// IT IS DERIVED, READ-ONLY, AND PURELY ADDITIVE — that is the whole design
// constraint, and everything below follows from it:
//
//   • Nothing reads this tab. Not the sync, not Quick Mark, not the door, not
//     the link doctor. Delete the tab and the workbook behaves exactly as it
//     did; the next render draws it again from the session rows.
//   • Nothing is STORED here that is not already on a session row. There is no
//     second record of a capacity, a leader or a link that could drift out of
//     agreement with the first one and be believed.
//   • It is rendered from the session rows the caller ALREADY HAS in memory
//     (renderProgramDashboard passes them). A derived view that cost a second
//     full read of a several-hundred-row tab on every sync would be paying,
//     every hour, for something nobody has looked at since Tuesday.
//
// WHY Form_ID IS THE GROUPING KEY. It is the groupKey's identity, it is
// already on the row, and it costs nothing to read. It also collapses the one
// case a (title, location, month) key gets wrong: a [Shared] program running
// at two locations has ONE form and is ONE thing to run, so it is one row here
// with Location reading "Narberth + Ashbridge" the way describeLocations()
// words it everywhere else. The fallback is only for rows that genuinely have
// no form — [No Registration] programs, and rows somebody typed in by hand.
//
// FIXED-SPAN GROUPS ARE FILED UNDER THEIR FIRST MONTH — the design doc's open
// question #2, answered. A [Grouped] series takes ONE form for its whole run
// (formSpanKey() gives it the literal 'FIXED' rather than a month label), so a
// ten-week course starting in September has no month of its own: it touches
// three. Grouping on Form_ID gives it ONE row, and monthStart is its earliest
// session's month.
//
// The alternative — repeating the group on every month it touches, with a
// "spans Sep–Nov" note — reads better on a tab somebody scrolls by month, and
// was refused anyway: every number on a month row is a SUM over that row's
// sessions, so a repeated row would either double-count them or have to divide
// them up, and a Registered figure that is a third of the truth in three
// places is worse than a row filed a month early. The Schedule cell states the
// real span, and its note names every session, so nothing about the run is
// hidden by where the row sits.
//
// Nothing downstream depends on the choice, because nothing downstream reads
// this tab: if it is ever revisited, this is the only place it lives.
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
 * The three links a program-month has, in the order they are wanted, with the
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
 * The key a session row is filed under.
 *
 * Form_ID first — see the banner. The fallback carries the month explicitly
 * because, without a form, nothing else in the key says which month this is:
 * two Septembers of the same drop-in coffee hour must not collapse into one
 * row claiming twelve sessions.
 */
function programMonthGroupKey(row, map, monthKey) {
  const eventId = String(row[map['Event_ID']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  // A meal is not a program and never had a form: it groups by where and when
  // it was served, and by nothing else. See the lunch note in buildProgramMonthRows().
  if (isLunchOnlyEventId(eventId)) return `lunch::${location}::${monthKey}`;

  const formId = String(row[map['Form_ID']] || '').trim();
  if (formId) return `form::${formId}`;

  const title = String(row[map['Clean_Title']] || '').trim();
  return `plain::${title}::${location}::${monthKey}`;
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
 * "Weekly · Tue 9:30 AM – 11:30 AM · 4 sessions", or "Tue 9:30 AM – 11:00 AM ·
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

  if (distinct.length === 1 && shapes.length > 0 && shapes[0].weekday) {
    const one = shapes[0];
    const phrase = one.times ? `${one.weekday} ${one.times}` : one.weekday;
    const repeat = detectProgramMonthRecurrence(sessions);
    if (!repeat) {
      return { text: `${phrase}${PROGRAM_MONTH_JOINER}${count} ${plural}`, note: '' };
    }
    const dates = sessions.map(s => Utilities.formatDate(s.date, TIMEZONE, 'EEE MMM d'));
    let text = `${repeat.word}${PROGRAM_MONTH_JOINER}${phrase}${PROGRAM_MONTH_JOINER}${count} ${plural}`;
    let note = `${repeat.word}, ${phrase}.\n\nOn:\n${dates.join('\n')}`;
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
    ? `Usually ${usualPhrase || 'the same time'}.\n\nNot these:\n${outliers.join('\n')}`
    : '';
  return { text: `${count} ${plural}${PROGRAM_MONTH_JOINER}times vary`, note };
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
 * The Program_Settings row(s) behind one program-month, resolved into
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
function buildProgramMonthRows(sessionRows, sessionMap, linkTarget, leaderIndex, settingsIndex) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const groups = {};
  const order = [];

  (sessionRows || []).forEach(row => {
    const date = coerceDate(row[sessionMap['Event_Date']]);
    // No date, no month, and this tab IS the month. A dateless row keeps
    // living on the session table, where it is visible and fixable.
    if (!date) return;
    const monthKey = formatMonthKey(date);
    const key = programMonthGroupKey(row, sessionMap, monthKey);
    if (!groups[key]) {
      groups[key] = { key, sessions: [], monthStart: null };
      order.push(key);
    }
    const group = groups[key];
    group.sessions.push({
      row,
      date,
      times: formatTimeRange(row[sessionMap['Event_Date']],
        sessionMap['Event_End'] === undefined ? '' : row[sessionMap['Event_End']])
    });
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    if (!group.monthStart || first < group.monthStart) group.monthStart = first;
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

    let registered = 0, waitlist = 0, capacity = 0, cappedRegistered = 0, cappedSessions = 0;
    sessions.forEach(s => {
      registered += programMonthNumber(s.row[sessionMap['Active_Count']]);
      waitlist += programMonthNumber(s.row[sessionMap['Waitlist_Count']]);
      const cap = sessionCapacity(s.row, sessionMap);
      if (cap !== null) {
        cappedSessions++;
        capacity += cap;
        cappedRegistered += programMonthNumber(s.row[sessionMap['Active_Count']]);
      }
    });

    // The first non-blank wins for each link. They are group facts printed on
    // every session row, so they agree — but a row written before a form
    // existed holds a blank, and taking the first row's blank would lose a
    // link the group plainly has.
    const firstNonBlank = header => {
      let found = '';
      sessions.some(s => {
        const value = sessionMap[header] === undefined ? '' : s.row[sessionMap[header]];
        if (String(value || '').trim()) { found = value; return true; }
        return false;
      });
      return found;
    };

    const schedule = describeProgramMonthSchedule(sessions);
    // A MEAL IS NOT A PROGRAM, and this is the whole of what that costs here:
    // one row per location per month, saying what it is and how many days it
    // ran, instead of the ~21 rows the session table carries. Its Schedule
    // says the span rather than a weekday, because lunch is every weekday and
    // "Mon–Fri · 21 sessions" tells nobody anything. Everything downstream
    // that counts PROGRAMS still filters these out by Event_ID, exactly as it
    // does today — see renderProgramDashboard()'s filter.
    const sessionsLabel = isLunch
      ? `${sessions.length} ${sessions.length === 1 ? 'day' : 'days'}`
      : `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`;
    // Linked at the group's FIRST session, which is the row somebody landing
    // on the session tab wants to be looking at — the top of this program's
    // block, not the middle of it.
    const sessionsCell = programMonthSessionsCell(sessionsLabel,
      String(sessions[0].row[sessionMap['Event_ID']] || '').trim(), linkTarget);
    const scheduleCell = isLunch
      ? describeDateSpan(sessions[0].date, sessions[sessions.length - 1].date)
      : schedule.text;

    const seats = describeProgramMonthSeats({
      registered, waitlist, capacity, cappedRegistered, cappedSessions,
      sessions: sessions.length,
      window: describeProgramMonthWindow(group.monthStart)
    });
    const linkParts = programMonthLinkParts(firstNonBlank);

    const out = new Array(headers.length).fill('');
    out[map['Month_Start']] = group.monthStart;
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
    out[map['Form_ID']] = String(first[sessionMap['Form_ID']] || '');
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

/** "in September 2026" — what the seat note's numbers are a sum over. */
function describeProgramMonthWindow(monthStart) {
  return monthStart ? `in ${Utilities.formatDate(monthStart, TIMEZONE, MONTH_DISPLAY_FORMAT)}` : '';
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
  }, leaderIndex, settingsIndex);
  writeProgramMonthSheet(sheet, built, force, metrics);
  log(`Master_Program_Dashboard: ${built.rows.length} program-month row(s) from ${sessionRows.length} session row(s).`);
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

  // --- The metrics block, on the tab whose grain it matches ---
  let row = 1;
  if (metrics) {
    row = writeProgramMetricsSection(sheet, row, numCols, metrics);
    row = writeProgramMonthCoverageLine(sheet, row, numCols,
      programMonthLeaderCoverage(built.rows, formatMonthKey(new Date())));
    row++; // spacer
  }

  // A MONTH ROW IS PAST WHEN ITS MONTH IS OVER, not when its first day has
  // gone: partitioning on today would file the whole of this month under
  // "Past" from the 2nd onwards. The 1st of the current month is the boundary.
  const now = new Date();
  const todayKey = formatDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const { upcoming, past } = partitionByDate(built.rows, map['Month_Start'], todayKey);
  const result = writeUpcomingPastSections(sheet, row, headers, upcoming, past, {
    upcomingLabel: '🗓️ This Month & Ahead', pastLabel: '🕓 Past Months',
    // NOT COLLAPSED. Old-month hiding is defined against a tab of sessions,
    // where two months is hundreds of rows; here a year of history is a couple
    // of dozen, and the whole point of the tab is that a year of it fits on a
    // screen. Passed explicitly rather than left to the default, because the
    // default would silently hide half of what this tab exists to show.
    collapseOldMonths: false
  });

  const zones = [
    { start: result.upcomingDataStart, count: upcoming.length },
    { start: result.pastDataStart, count: past.length }
  ];

  const rules = [];
  const locationRanges = [];
  zones.forEach(z => {
    if (z.count < 1) return;
    // The month tint the sectioned writer applies for itself on every other
    // tab. It keys off a column literally named Event_Date, and this tab's
    // date is Month_Start — so it is applied here rather than by changing what
    // that shared writer is defined against.
    // ...and reads as "September 2026", not "Tue 9/1/2026". The row IS the
    // month: the 1st of it is where the value has to sit for partitionByDate()
    // and the sectioned readers, and it is not a day anything happens on.
    applyMonthColorTint(sheet, map['Month_Start'] + 1, z.start, z.count, MONTH_DISPLAY_FORMAT);
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
  freezeColumnsSafely(sheet, 3); // month, location, program name
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
 * How many of THIS MONTH's programs have nobody down as leading them, and
 * which ones — the count for the line, the names for its note.
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
function programMonthLeaderCoverage(rows, monthKey) {
  const map = getIndexMap(HEADERS.Master_Program_Dashboard);
  const missing = [];
  let considered = 0;

  let index;
  try {
    index = buildProgramLeaderIndex();
  } catch (err) {
    log(`\u2139\ufe0f Could not read the leader index for Master_Program_Dashboard's coverage line (${err}).`);
    return null;
  }

  rows.forEach(row => {
    if (String(row[map['Group_Key']] || '').indexOf('lunch::') === 0) return;
    const monthStart = coerceDate(row[map['Month_Start']]);
    if (!monthStart || formatMonthKey(monthStart) !== monthKey) return;
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
  const label = 'Programs with no leader this month';
  sheet.getRange(row, 1, 1, 2).setValues([[label, coverage.missing.length]]);
  sheet.getRange(row, 1)
    .setFontSize(TYPO.HERO_LABEL.size)
    .setFontWeight(TYPO.HERO_LABEL.weight)
    .setFontColor(TYPO.HERO_LABEL.color)
    .setNote(coverage.missing.length > 0
      ? `Counted over the ${coverage.considered} program(s) running this month.\n\n` +
        `Nobody on ${SHEET_NAMES.PROGRAM_LEADERS} is down as leading:\n${coverage.missing.join('\n')}\n\n` +
        `Add a row there naming the program and its location. This tab only COUNTS — ` +
        `nothing is shared and no mail is sent from here.`
      : `Every one of the ${coverage.considered} program(s) running this month has a leader row on ` +
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

/** Menu: rebuild the month view on its own, from whatever the session tab currently says. */
function renderProgramMonthSheetNow() {
  renderProgramMonthDashboard(true);
  SpreadsheetApp.getActive().toast('Master_Program_Dashboard rebuilt from the session table.');
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
 * Who is down as leading this program-month, off the SAME per-execution index
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
