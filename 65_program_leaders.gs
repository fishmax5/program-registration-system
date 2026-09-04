// ============================================================================
// 9c. PROGRAM LEADERS  (who leads what, and how they hear about it)
// ============================================================================
//
// THE PROBLEM THIS TAB REPLACES. Who leads a program used to be one column on
// Program_Options — Instructor_Email, a bare address on a program row. It
// answered exactly one question ("who do I share this program's sheet with?")
// and could not be asked any of the others:
//
//   - Which programs does Jane lead? Three cells on three rows, found by eye.
//   - Does Jane want to be emailed when her roster moves? Nowhere to say so.
//   - Jane moved from Narberth to Ashbridge. Edit every row that mentions her,
//     and hope none was missed.
//
// A leader is a PERSON. A program row can hold an address but it cannot hold a
// person, and every question worth asking about a leader is a question about
// the person rather than about one of their classes.
//
// THE SHAPE. One row per leader AND program AND location — the normalized
// form, and the only one that answers the question in both directions. A
// leader with three classes has three rows; the tab sorts by name, so their
// three rows sit together and reading "what does Jane lead" is reading three
// consecutive lines. A program's leaders are the rows naming it.
//
// NO WILDCARDS. A blank Program meaning "everything at this site" is a
// tempting row to type and a quiet way to hand somebody every roster in a
// building. The privacy boundary for a shared sign-up sheet is one program at
// one location (section 9b), and this tab is held to exactly the same grain so
// the two can never disagree about who may read what. A row with a blank
// Program or Location is reported as unmatched rather than resolved
// generously.
//
// STAFF OWN EVERY COLUMN BUT TWO. Nothing in this workbook knows who leads a
// class and nothing ever will, so the refresh never invents a row and never
// deletes one. It fills in Sheet_Link and Last_Notified — the tab reporting
// back on what the rest of the system did with each row — and otherwise leaves
// the tab exactly as it was typed.
//
// WHAT READS IT. Section 9b takes the addresses for a program off it when it
// shares a sign-up sheet, and section 9d takes the notify ticks off it when it
// decides whose roster changes are worth an email. Both go through
// buildProgramLeaderIndex(), which reads the tab ONCE per execution: the
// sign-up-sheet dialog asks per program, and a tab read apiece turned listing
// sixty programs into sixty full-tab round trips.
// ============================================================================

/**
 * One-time migration marker: has Program_Options' old Instructor_Email column
 * been carried onto this tab yet?
 *
 * Versioned like every other stored key here. It records that a MIGRATION ran,
 * not what it found — re-running it after somebody has curated this tab would
 * resurrect addresses they deliberately removed, which is exactly the kind of
 * "helpful" write that is impossible to argue with after the fact.
 */
const PROGRAM_LEADERS_MIGRATED_PROP_KEY = 'PROGRAM_LEADERS_MIGRATED_FROM_OPTIONS_V1';

/** The old column the addresses are carried across from. Gone from HEADERS.Program_Options; still on older sheets. */
const LEGACY_INSTRUCTOR_EMAIL_COLUMN = 'Instructor_Email';


// --- Notify_Timing: WHEN a ticked leader actually hears about it -------------

/**
 * Notify_Roster_Changes stays the on/off switch (see the tab's own header
 * comment in 03). Notify_Timing is the closed dropdown that decides which of
 * three channels a leader who has it ticked is on:
 *
 *   "At each registration"     the diff pass in 66 — mid-hour, whenever
 *                               something on the roster actually moves.
 *   "N days before each date"  the countdown digest beside it — one email per
 *                               session, N days ahead of it, listing who is
 *                               on the roster that morning.
 *   "The Thursday before
 *    each date"                the same digest, due on a fixed WEEKDAY rather
 *                               than a fixed count — see
 *                               leaderNotifyTimingWeekdayLabel() below.
 *
 * BLANK OR UNRECOGNIZED READS AS "At each registration" — a typo, or a
 * workbook upgrading from before this column existed, must keep doing exactly
 * what a ticked Notify_Roster_Changes has always done rather than going
 * silent. The same reasoning as an unrecognized Notify_Mode in section 9e.
 */
const LEADER_NOTIFY_TIMING_EACH_CHANGE = 'At each registration';

/**
 * How far ahead a countdown digest can be asked to reach. A week is long
 * enough for a leader to actually plan around and short enough that the
 * digest pass never has to look further out than that — the day count IS the
 * window, so there is no separate forward-horizon constant the way the
 * reminder and diff passes beside it each need one.
 */
const LEADER_NOTIFY_TIMING_MAX_DAYS = 7;

/** "3 days before each date" — the label a day count is spelled as, both in the dropdown and read back out of it. */
function leaderNotifyTimingDaysBeforeLabel(days) {
  return `${days} day${days === 1 ? '' : 's'} before each date`;
}

/**
 * The weekday names a "The Thursday before each date" answer is spelled with,
 * indexed the way `Date.getDay()` is so the index IS the parsed value.
 */
const LEADER_NOTIFY_TIMING_WEEKDAY_NAMES =
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * "The Thursday before each date" — the third channel, and the one a leader
 * who plans their week on a fixed day actually wants.
 *
 * A day COUNT is the wrong shape for "tell me every Thursday": a Tuesday class
 * and a Saturday class need 5 days and 2 days respectively to land on the same
 * morning, so a leader with both has to either keep two rows in their head or
 * hear about one of them on the wrong day. A weekday says the thing they mean
 * once, and each session works out its own count from it.
 *
 * ALWAYS THE WEEK BEFORE, never the same day: a session ON Thursday resolves
 * to the PREVIOUS Thursday (7 days), not to nothing and not to zero days.
 * "Before" is what the label promises, and a digest that arrives the morning
 * of the class is a different feature.
 */
function leaderNotifyTimingWeekdayLabel(weekday) {
  return `The ${LEADER_NOTIFY_TIMING_WEEKDAY_NAMES[weekday]} before each date`;
}

/** The dropdown's full, closed vocabulary — what Notify_Timing is validated against. */
const LEADER_NOTIFY_TIMING_LIST = [LEADER_NOTIFY_TIMING_EACH_CHANGE]
  .concat([1, 2, 3, 4, 5, 6, 7].map(leaderNotifyTimingDaysBeforeLabel))
  .concat([0, 1, 2, 3, 4, 5, 6].map(leaderNotifyTimingWeekdayLabel));

/**
 * One Notify_Timing cell, resolved into
 * { mode: 'each_change' | 'days_before' | 'weekday', days, weekday }.
 *
 * Matched by a leading "N day(s) before" rather than the exact label string,
 * so a cell that still reads a slightly older spelling of the same idea (or
 * one somebody typed by hand instead of picking from the list) still resolves
 * the way it obviously means, rather than silently falling back to the
 * default. A day count outside LEADER_NOTIFY_TIMING_MAX_DAYS falls back the
 * same way a nonsense one would.
 */
function parseLeaderNotifyTiming(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  const match = /^(\d+)\s+days?\s+before/i.exec(text);
  if (match) {
    const days = Math.floor(Number(match[1]));
    if (days >= 1 && days <= LEADER_NOTIFY_TIMING_MAX_DAYS) {
      return { mode: 'days_before', days, weekday: -1 };
    }
  }
  // Matched on the weekday NAME rather than the whole label, for the same
  // reason the day count above is: "Thursday before" and "the Thursday before
  // each date" mean the same thing to the person who typed either.
  const weekday = LEADER_NOTIFY_TIMING_WEEKDAY_NAMES.findIndex(
    name => new RegExp(`(^|\\b)${name}\\b`, 'i').test(text));
  if (weekday >= 0 && /before/i.test(text)) {
    return { mode: 'weekday', days: LEADER_NOTIFY_TIMING_MAX_DAYS, weekday };
  }
  return { mode: 'each_change', days: 0, weekday: -1 };
}

/**
 * How many days before ONE session this timing is due, or 0 if it never is.
 *
 * The countdown channel answers with the day count it was typed with. The
 * weekday channel works it out per session: the most recent occurrence of that
 * weekday STRICTLY before the session's own date, so a Tuesday class on a
 * "Thursday" row is due 5 days ahead and a Thursday class is due 7.
 *
 * Both are then read the same way by the digest pass — "due once the session
 * is this close" — which is what makes a pass that missed its morning (a
 * quiet workbook, a failed run) still send on the next one rather than
 * skipping the session entirely.
 */
function leaderNotifyTimingDaysBefore(timing, sessionDate) {
  if (!timing) return 0;
  if (timing.mode === 'days_before') return timing.days;
  // Duck-typed rather than `instanceof Date`: a date read back out of a sheet
  // in one context and compared in another is a real Date that fails that
  // test, and a digest silently never coming due is the worst way to find out.
  if (timing.mode !== 'weekday' || !sessionDate || typeof sessionDate.getDay !== 'function') return 0;
  const gap = (sessionDate.getDay() - timing.weekday + 7) % 7;
  return gap === 0 ? 7 : gap;
}

/** The furthest ahead this timing can ever be due — what bounds the digest pass's session scan. */
function leaderNotifyTimingMaxDays(timing) {
  if (!timing) return 0;
  if (timing.mode === 'days_before') return timing.days;
  if (timing.mode === 'weekday') return LEADER_NOTIFY_TIMING_MAX_DAYS;
  return 0;
}


// --- TITLE MATCHING: how a program finds its leader --------------------------

/**
 * THE GAP THIS FILLS. This tab is good at catching a new program — but only
 * once somebody notices the new program and types a row. Nothing attributes an
 * incoming calendar event to a person on its own, so a class can run for a
 * month with its roster shared with nobody and no sign that anything is
 * missing.
 *
 * Title_Match is the leader saying it once instead: comma-separated phrases
 * ("yoga, chair yoga") meaning "a program whose title contains one of these is
 * mine". A program the workbook knows about and nobody has typed a row for is
 * PROPOSED to the matching leader.
 *
 * THE RULE THAT KEEPS THE PRIVACY BOUNDARY INTACT. A phrase is a wildcard
 * wearing a different hat, and the section header above says why this tab has
 * no wildcards. So:
 *
 *   A phrase match never shares anything and never sends anything. It writes a
 *   concrete title | location row, with the notification tick CLEAR, and every
 *   sharing and mailing path keeps reading concrete rows only.
 *
 * buildProgramLeaderIndex() is therefore untouched by any of this: it still
 * skips a row with a blank Program or Location, so a phrase-only row — a
 * leader with phrases and no class typed yet — shares nothing and is on no
 * mailing list. There is still exactly ONE path from "who leads what" to "who
 * may read a roster", and it runs through rows a person can see and delete.
 *
 * WRITTEN, NOT ACTED ON. The row arrives unticked with a note saying which
 * phrase found it, which is how the Instructor_Email migration below already
 * behaves: carry the information across, leave the notification off, and say
 * so out loud. Turning mail on for somebody a phrase guessed at would be the
 * one version of this feature that can email a roster to the wrong person.
 *
 * DELETING A PROPOSED ROW IS NOT HOW YOU REFUSE IT — the phrase that produced
 * it is still there, so the next sync proposes it again. Fix the phrase (or
 * retype the row naming whoever really leads it: rule 1 below means a typed
 * row always wins). The Staff_Notes text on every proposed row says this.
 */

/**
 * How many programs one phrase may claim before it is reported instead of
 * applied. `a` matches everything, and a one-character phrase is how one
 * person gets proposed for every class in the building. Ten is more classes
 * than a leader plausibly runs and few enough that a runaway phrase is caught
 * on the sync it is typed.
 */
const LEADER_TITLE_MATCH_MAX_PROGRAMS = 10;

/**
 * How a proposed row says it is one, and the whole of what "matched" means
 * anywhere else in this workbook.
 *
 * There is no Source column on this tab and there deliberately is not one: a
 * proposed row is an ORDINARY row the moment somebody looks at it and leaves
 * it alone, and a column saying otherwise would have to be cleared by hand to
 * stop saying it. The Staff_Notes stamp is already the thing a person deletes
 * when they have checked the row, so it is also the honest answer to "has
 * anybody checked this?" — which is exactly what Program_Month's
 * Leader_Source reports.
 */
const LEADER_TITLE_MATCH_NOTE_PREFIX = 'Matched on "';

/** True for a row still carrying the stamp proposeProgramLeaderRowsFromTitles() wrote. */
function isTitleMatchedLeaderRow(staffNotes) {
  return String(staffNotes === null || staffNotes === undefined ? '' : staffNotes)
    .trim().indexOf(LEADER_TITLE_MATCH_NOTE_PREFIX) === 0;
}

/**
 * One Title_Match cell into its phrases, normalized the way titles are
 * (`normalizeNameKey`: trimmed, inner whitespace collapsed, lowercased) so the
 * comparison is the same one Program/Location keys are built with.
 *
 * COMMA ONLY, unlike the Email cell's generous separators: a phrase is allowed
 * to contain spaces ("chair yoga") and splitting on whitespace would turn one
 * specific claim into two general ones.
 */
function parseLeaderTitleMatchPhrases(value) {
  const seen = [];
  String(value === null || value === undefined ? '' : value)
    .split(',')
    .map(part => normalizeNameKey(part))
    .forEach(phrase => { if (phrase !== '' && seen.indexOf(phrase) === -1) seen.push(phrase); });
  return seen;
}

/**
 * The matcher. Pure: rows in, proposed rows out — no sheet, no properties, no
 * network — which is what makes it testable and what keeps it honest about
 * writing nothing on its own.
 *
 * `rows` are the tab's rows as read, `known` is knownProgramKeys(). Returns
 * { rows, notes, reports }:
 *
 *   rows     new Program_Leaders rows to append, already filled in
 *   notes    [{ row, note }] for the Title_Match cell of a row whose phrase
 *            needs looking at — matched nothing, or claimed too much
 *   reports  lines for the admin digest: one per batch of proposals, one per
 *            refused tie, one per phrase too broad to apply
 *
 * PRECEDENCE, in the order an argument about it should be settled:
 *
 *   1. An explicit row wins. A program with ANY concrete row naming it is
 *      answered, full stop — including a row that deliberately assigns it to
 *      somebody other than the obvious phrase match. A guess never overrides
 *      a decision.
 *   2. Longest matching phrase wins among phrase rows. `chair yoga` beats
 *      `yoga`, which is how a specific claim overrides a general one without
 *      anybody needing a priority column.
 *   3. A tie proposes nothing and reports both candidates. Two leaders
 *      claiming `yoga` at the same length is a question for a human, and
 *      picking the alphabetically-first one is how the wrong person gets a
 *      roster.
 */
function proposeProgramLeaderRowsFromTitles(rows, map, known) {
  const headers = HEADERS.Program_Leaders;
  const covered = {};
  const claimants = [];

  rows.forEach(row => {
    const title = String(row[map['Program']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (title && location) covered[leaderProgramKey(title, location)] = true;
    const phrases = parseLeaderTitleMatchPhrases(row[map['Title_Match']]);
    if (phrases.length > 0) claimants.push({ row, phrases });
  });

  const keys = Object.keys(known);
  const titleKeys = {};
  keys.forEach(key => { titleKeys[key] = normalizeNameKey(known[key].title); });

  // How much of the building each phrase claims, counted across EVERY known
  // program rather than only the uncovered ones — a phrase that hits forty
  // classes is too broad whether or not they happen to have leaders today.
  const notes = [];
  const reports = [];
  claimants.forEach(claimant => {
    const tooBroad = [];
    const unmatched = [];
    claimant.live = [];
    claimant.phrases.forEach(phrase => {
      const hits = keys.filter(key => titleKeys[key].indexOf(phrase) !== -1).length;
      if (hits === 0) unmatched.push(phrase);
      else if (hits > LEADER_TITLE_MATCH_MAX_PROGRAMS) tooBroad.push({ phrase, hits });
      else claimant.live.push(phrase);
    });
    const name = String(claimant.row[map['Leader_Name']] || '').trim() || '(unnamed leader)';
    const lines = [];
    unmatched.forEach(phrase => lines.push(`No program title contains "${phrase}".`));
    tooBroad.forEach(found => {
      lines.push(`"${found.phrase}" matches ${found.hits} programs — too many to apply. ` +
        `Make it more specific.`);
      reports.push(`${name}'s phrase "${found.phrase}" matches ${found.hits} programs, more than ` +
        `the ${LEADER_TITLE_MATCH_MAX_PROGRAMS} one phrase may claim, so it was not applied.`);
    });
    if (lines.length > 0) notes.push({ row: claimant.row, note: lines.join('\n') });
  });

  const proposed = [];
  keys.sort().forEach(key => {
    if (covered[key]) return;                     // rule 1
    const titleKey = titleKeys[key];
    let best = 0;
    let winners = [];
    claimants.forEach(claimant => {
      let longest = '';
      claimant.live.forEach(phrase => {
        if (titleKey.indexOf(phrase) !== -1 && phrase.length > longest.length) longest = phrase;
      });
      if (longest === '') return;
      if (longest.length > best) { best = longest.length; winners = [{ claimant, phrase: longest }]; }
      else if (longest.length === best) winners.push({ claimant, phrase: longest });  // rule 2
    });
    if (winners.length === 0) return;
    if (winners.length > 1) {                     // rule 3
      const names = winners.map(w =>
        String(w.claimant.row[map['Leader_Name']] || '').trim() || '(unnamed leader)');
      reports.push(`${known[key].title} at ${known[key].location} is claimed by ${names.join(' and ')} ` +
        `with phrases of the same length — nothing was proposed. Type the row for whoever leads it.`);
      return;
    }

    const winner = winners[0];
    const row = new Array(headers.length).fill('');
    row[map['Leader_Name']] = String(winner.claimant.row[map['Leader_Name']] || '').trim();
    row[map['Email']] = String(winner.claimant.row[map['Email']] || '').trim();
    row[map['Program']] = known[key].title;
    row[map['Location']] = known[key].location;
    // The phrase stays on the row that claims things. Copying it here would
    // turn one claim into two and the proposal into a claimant of its own.
    row[map['Title_Match']] = '';
    // Not ticked, and the timing left blank with it. See the banner above.
    row[map['Notify_Roster_Changes']] = false;
    row[map['Staff_Notes']] = `${LEADER_TITLE_MATCH_NOTE_PREFIX}${winner.phrase}" — check this. Emails are off until ` +
      `you tick Notify_Roster_Changes. To refuse it, change the phrase (deleting this row alone ` +
      `brings it back next sync).`;
    proposed.push(row);
  });

  if (proposed.length > 0) {
    reports.push(`${proposed.length} program(s) with no leader row were matched to a leader by ` +
      `their Title_Match phrases and proposed on the ${SHEET_NAMES.PROGRAM_LEADERS} tab. Nothing ` +
      `was shared and no email was turned on.`);
  }
  return { rows: proposed, notes: notes, reports: reports };
}

/**
 * Puts the matcher's notes on the Title_Match cells, after the tab has been
 * written — writeMemoryTab() clears the sheet, so a note applied before it
 * would be part of what got cleared.
 *
 * A phrase that matches nothing is otherwise perfectly silent: the leader
 * simply never gets attributed, and nobody finds out until a roster goes
 * unshared. One cell note is the cheapest place to say so, because it is on
 * the cell the typo is in.
 */
function applyTitleMatchNotes(sheet, headers, rows, notes) {
  if (!notes || notes.length === 0) return 0;
  const map = getIndexMap(headers);
  if (map['Title_Match'] === undefined) return 0;
  let written = 0;
  notes.forEach(entry => {
    const index = rows.indexOf(entry.row);
    if (index === -1) return;
    try {
      sheet.getRange(MEMORY_TAB_DATA_ROW + index, map['Title_Match'] + 1).setNote(entry.note);
      written++;
    } catch (err) {
      log(`ℹ️ Could not note a Title_Match cell (${err}).`);
    }
  });
  return written;
}


// --- the tab ----------------------------------------------------------------

function programLeadersTabOptions() {
  return {
    banner: '👩‍🏫 Program Leaders',
    bannerNote: 'Who leads each program, where to write to them, and whether they want an email ' +
      'when that program\'s roster changes. Notify_Timing picks WHEN: at each change, a countdown ' +
      'of days before each date, or a fixed weekday before each date. One row per leader per program — a leader with three classes has ' +
      'three rows. Title_Match is optional: comma-separated phrases ("yoga, chair yoga") meaning ' +
      '"a program whose title contains this is mine" — a program nobody has typed a row for gets ' +
      'one proposed here, with the email tick left off until you turn it on. Sheet_Link and ' +
      'Last_Notified fill in by themselves.',
    staffColumns: PROGRAM_LEADERS_STAFF_COLUMNS,
    dateColumns: [],
    numberColumns: []
  };
}

/**
 * Rebuilds the tab: the staff's rows exactly as they typed them, with the two
 * derived columns brought up to date and the dropdowns re-applied.
 *
 * NEVER ADDS OR DROPS A ROW. A program with no leader row is not a problem
 * this tab can solve by inventing one — there is nobody to put in it — and a
 * row naming a program that has stopped running is still the record of who
 * used to lead it. Rows that match nothing get a note on the cell rather than
 * being removed; see the unmatched handling below.
 *
 * Called from refreshMemoryTabs(), BEFORE refreshProgramOptions(), which is
 * load-bearing on a workbook that has not migrated yet: the migration reads
 * Instructor_Email off the live Program_Options sheet, and the Program_Options
 * refresh is what finally rewrites that tab without the column.
 */
function refreshProgramLeadersTab(ss, sessionRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_LEADERS);
  const headers = HEADERS.Program_Leaders;
  const map = getIndexMap(headers);

  migrateProgramLeaderAddresses(ss, sheet);

  let rows;
  try {
    rows = readSimpleTable(sheet, headers);
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_LEADERS} (${err}) — leaving the tab alone.`);
    return;
  }

  const known = knownProgramKeys(ss, sessionRows);
  const registry = getProgramLeaderSheetRegistry();
  const notifiedAt = readProgramLeaderNotifyState().programs || {};

  let unmatched = 0;
  rows.forEach(row => {
    const title = String(row[map['Program']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title || !location || !known[leaderProgramKey(title, location)]) {
      // A typo, or a program that has not been synced yet, or one that stopped
      // running. All three look the same from here and none of them is this
      // tab's business to resolve, so the row keeps everything it holds and
      // simply reports nothing derived.
      row[map['Sheet_Link']] = '';
      row[map['Last_Notified']] = '';
      if (title || location) unmatched++;
      return;
    }
    const key = leaderProgramKey(title, location);
    const entry = registry[key];
    row[map['Sheet_Link']] = entry && entry.fileId
      ? `https://docs.google.com/spreadsheets/d/${entry.fileId}/edit`
      : '';
    const state = notifiedAt[key];
    row[map['Last_Notified']] = state && state.at
      ? Utilities.formatDate(new Date(state.at), Session.getScriptTimeZone(), "d MMM 'at' h:mm a")
      : '';
  });

  // A program nobody has typed a row for, matched to a leader by their
  // Title_Match phrases. Written, never acted on — see the TITLE MATCHING
  // banner above for why the tick starts clear.
  const matched = proposeProgramLeaderRowsFromTitles(rows, map, known);
  if (matched.rows.length > 0) rows = rows.concat(matched.rows);
  matched.reports.forEach(line => noteForAdmin('Program leaders matched by title', line));

  // Leader first, then their programs. Somebody opens this tab to answer
  // "what does Jane lead" or "who leads Chair Yoga", and only the first of
  // those is helped by an order — sorting by program would scatter Jane's
  // three rows down the tab with no way to gather them.
  rows.sort((a, b) =>
    normalizeNameKey(a[map['Leader_Name']]).localeCompare(normalizeNameKey(b[map['Leader_Name']])) ||
    String(a[map['Location']] || '').localeCompare(String(b[map['Location']] || '')) ||
    String(a[map['Program']] || '').localeCompare(String(b[map['Program']] || '')));

  writeMemoryTab(sheet, headers, rows, programLeadersTabOptions());
  // After the write, not before: writeMemoryTab() clears the sheet.
  applyTitleMatchNotes(sheet, headers, rows, matched.notes);
  // The tab this index was built from has just been rewritten. Anything that
  // asks again in this execution — the sign-up-sheet dialog, the alert pass —
  // must read the rows as they now stand, not as they stood before the sort.
  invalidateProgramLeaderIndex();

  // The dropdowns run past the last row, so the blank line under it — the one
  // a person actually types their next leader into — has them too. See
  // MEMORY_TAB_SPARE_ROWS for the bug that reasoning comes from.
  applyMemoryTabValidation(sheet, headers, rows.length, {
    checkboxes: ['Notify_Roster_Changes'],
    // Notify_Timing is a CLOSED list, unlike Program and Location below: every
    // legal answer is known, and a typo here would quietly change which
    // channel a leader hears from rather than just missing a suggestion.
    lists: { Notify_Timing: LEADER_NOTIFY_TIMING_LIST },
    // SUGGESTING, not restricting: a leader can legitimately be typed in
    // before the calendar has ever produced that program, and a hard list
    // would refuse the row outright and lose it.
    openLists: {
      Program: Object.keys(known).map(k => known[k].title).filter(uniqueStrings).sort(),
      Location: Object.keys(known).map(k => known[k].location).filter(uniqueStrings).sort()
    }
  });

  log(`Program_Leaders refreshed: ${rows.length} row(s)` +
    (matched.rows.length > 0 ? `, ${matched.rows.length} proposed from Title_Match phrases` : '') +
    (unmatched > 0 ? `, ${unmatched} naming a program this workbook does not know` : '') + '.');
}

/** Array filter that keeps the first of each string. Small enough to inline everywhere; named once instead. */
function uniqueStrings(value, index, all) {
  return value !== '' && all.indexOf(value) === index;
}

/** Called by everything that rewrites the Program_Leaders tab. */
function invalidateProgramLeaderIndex() {
  __programLeaderIndexCache = null;
}

/**
 * { programKey: { title, location } } for every program the session table has
 * seen — the vocabulary the Program and Location dropdowns offer, and what a
 * row is checked against before its derived columns are filled in.
 *
 * The WHOLE session table, not the shared-sheet window: a leader row for a
 * class that finished in March is still a true record of who led it, and
 * blanking its columns every winter would look like the tab losing data.
 */
function knownProgramKeys(ss, sessionRows) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = sessionRows ||
    getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), headers, 'Event_ID');

  const known = {};
  rows.forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title || !location) return;
    known[leaderProgramKey(title, location)] = { title, location };
  });
  return known;
}


// --- reading it -------------------------------------------------------------

/**
 * { programKey: [{ name, emails, notify }, ...] } for every program a leader
 * row names, read ONCE per execution.
 *
 * A program can have more than one leader — a class with a lead and an
 * assistant is ordinary — so this is a list per program rather than one entry,
 * and both of them get the sheet and (if ticked) the emails.
 */
let __programLeaderIndexCache = null;

function buildProgramLeaderIndex() {
  if (__programLeaderIndexCache) return __programLeaderIndexCache;
  const index = {};
  __programLeaderIndexCache = index;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return index;
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_LEADERS);
  if (!sheet) return index;

  const headers = HEADERS.Program_Leaders;
  const map = getIndexMap(headers);
  let rows;
  try {
    rows = readSimpleTable(sheet, headers);
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_LEADERS} for leader addresses (${err}).`);
    return index;
  }

  rows.forEach(row => {
    const title = String(row[map['Program']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title || !location) return; // see NO WILDCARDS in the section header
    const key = leaderProgramKey(title, location);
    if (!index[key]) index[key] = [];
    index[key].push({
      name: String(row[map['Leader_Name']] || '').trim(),
      emails: parseLeaderEmailList(row[map['Email']]),
      notify: isTruthyCheckbox(row[map['Notify_Roster_Changes']]),
      // Which channel, once notify is on — see parseLeaderNotifyTiming().
      // Read regardless of `notify`: a leader who has not ticked the box yet
      // still gets this resolved for free the moment they do, off the same
      // per-execution read, rather than needing a second pass over the tab.
      timing: parseLeaderNotifyTiming(row[map['Notify_Timing']]),
      // The program as somebody TYPED it, carried alongside the normalized
      // key. The key is lowercased and space-collapsed so it can match, which
      // makes it exactly the wrong thing to put in an email — and an alert for
      // a program with no shared sheet yet has nowhere else to read a title
      // from.
      programTitle: title,
      programLocation: location,
      // Whether this row is still a PROPOSAL nobody has confirmed. Read here
      // because this is already the one read of the tab per execution, and
      // Program_Month's Leader_Source is a report on the same rows the
      // sharing paths use — a second read to answer it would be a second
      // answer waiting to disagree with this one.
      matched: isTitleMatchedLeaderRow(row[map['Staff_Notes']])
    });
  });
  return index;
}

/**
 * The addresses in one Email cell. Comma, semicolon or whitespace: staff type
 * addresses however they type them, and rejecting a list over its separator
 * would be a silent no-share.
 */
function parseLeaderEmailList(value) {
  const seen = [];
  String(value === null || value === undefined ? '' : value)
    .split(/[,;\s]+/)
    .map(part => part.trim())
    .filter(part => part.indexOf('@') > 0)
    .forEach(email => { if (seen.indexOf(email) === -1) seen.push(email); });
  return seen;
}

/**
 * Every address recorded for one program, across all its leaders.
 *
 * Returns [] when nobody is named — createProgramLeaderSheet() then makes the
 * file and hands back a link to share by hand, rather than refusing to build
 * anything over a missing address.
 */
function getProgramLeaderEmailsForProgram(title, location) {
  const leaders = buildProgramLeaderIndex()[leaderProgramKey(title, location)] || [];
  const all = [];
  leaders.forEach(leader => {
    leader.emails.forEach(email => { if (all.indexOf(email) === -1) all.push(email); });
  });
  return all;
}

/**
 * The leaders who have asked to hear about their roster, grouped by the
 * address the mail would go to — EITHER channel, both switched on by the same
 * Notify_Roster_Changes tick. Which channel each program uses is carried on
 * the program entry (`timing`) rather than decided here: this function
 * answers "who gets told, about what", and 66 is where each of its two
 * passes filters this down to the programs its OWN channel owns.
 *
 * GROUPED BY ADDRESS rather than by program, because that is the unit an email
 * is sent in. A leader running three classes gets ONE message covering all
 * three (per channel), which is both kinder to read and — see
 * LEADER_ALERT_MAX_EMAILS_PER_RUN — the difference between one send and three
 * against a daily quota.
 *
 * Returns [{ email, name, programs: [{ key, title, location, timing }, ...] }, ...].
 */
function getProgramLeadersWantingAlerts() {
  const index = buildProgramLeaderIndex();
  const byEmail = {};

  Object.keys(index).forEach(programKey => {
    index[programKey].forEach(leader => {
      if (!leader.notify || leader.emails.length === 0) return;
      leader.emails.forEach(email => {
        const addressKey = email.toLowerCase();
        if (!byEmail[addressKey]) byEmail[addressKey] = { email, name: leader.name, programs: [] };
        // The first name seen for an address wins. Two rows spelling the same
        // person differently is a typo, not two people, and picking either is
        // better than addressing the mail to both.
        if (!byEmail[addressKey].name) byEmail[addressKey].name = leader.name;
        if (byEmail[addressKey].programs.every(p => p.key !== programKey)) {
          byEmail[addressKey].programs.push({
            key: programKey, title: leader.programTitle, location: leader.programLocation,
            timing: leader.timing
          });
        }
      });
    });
  });

  return Object.keys(byEmail).sort().map(k => byEmail[k]);
}


// --- the one write from somewhere else ---------------------------------------

/**
 * Every name typed on this tab, once each, in the order a dropdown should
 * offer them.
 *
 * Read off the TAB and not off buildProgramLeaderIndex(): that index is keyed
 * by program and skips a row with a blank Program or Location (see NO
 * WILDCARDS above), so a leader who has been typed in with only their
 * Title_Match phrases so far would be missing from the one list whose whole
 * job is to offer them.
 */
function programLeaderNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_LEADERS) : null;
  if (!sheet) return [];
  const headers = HEADERS.Program_Leaders;
  const map = getIndexMap(headers);
  const names = [];
  try {
    readSimpleTableValues(sheet, headers).forEach(row => {
      const name = String(row[map['Leader_Name']] || '').trim();
      if (name && names.indexOf(name) === -1) names.push(name);
    });
  } catch (err) {
    log(`\u2139\ufe0f Could not read ${SHEET_NAMES.PROGRAM_LEADERS} for the leader list (${err}).`);
    return [];
  }
  return names.sort((a, b) => normalizeNameKey(a).localeCompare(normalizeNameKey(b)));
}

/**
 * ATTACHES a leader to a program: the single write this tab accepts from
 * anywhere else in the workbook, and the whole of what editing Program_Month's
 * Leader cell does (see handleProgramMonthEdit() in 18_edit_handlers.gs).
 *
 * IT ONLY EVER ADDS. It never edits somebody else's row and never deletes one,
 * which is the same posture the rest of this file takes and for the same
 * reason: a row saying who led a class is a true record whether or not they
 * still lead it, and a dropdown that quietly unpicked one would be deleting
 * history from a tab nobody was looking at. A program that now has two leader
 * rows is a program with two leaders until a person removes one HERE, on the
 * tab where the consequence — who may read the roster — is written down.
 *
 * The tick starts CLEAR, exactly as a title match's proposal does: attaching
 * somebody is not the same as putting them on a mailing list, and the one
 * version of this feature that can email a roster to the wrong person is the
 * one that turns mail on for a name somebody picked out of a dropdown.
 *
 * Runs from a SIMPLE onEdit, so SpreadsheetApp is all it may touch: no
 * properties, no mail, no form. Everything here is a sheet read and a sheet
 * write.
 *
 * Returns { status, name, email, note } — 'exists' (nothing written), 'added',
 * or 'refused' with `note` saying why, so the caller can tell the person what
 * happened rather than leaving a dropdown looking like it did something.
 */
function attachProgramLeaderRow(name, title, location) {
  const leaderName = String(name || '').trim();
  const programTitle = String(title || '').trim();
  const programLocation = String(location || '').trim();
  if (!leaderName || !programTitle || !programLocation) {
    return { status: 'refused', name: leaderName, email: '', note: 'a leader row needs a name, a program and a location' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_LEADERS) : null;
  if (!sheet) {
    return { status: 'refused', name: leaderName, email: '',
      note: `there is no ${SHEET_NAMES.PROGRAM_LEADERS} tab yet — run a sync first` };
  }

  const headers = HEADERS.Program_Leaders;
  const map = getIndexMap(headers);
  let rows;
  try {
    rows = readSimpleTableValues(sheet, headers);
  } catch (err) {
    return { status: 'refused', name: leaderName, email: '', note: `${SHEET_NAMES.PROGRAM_LEADERS} could not be read (${err})` };
  }

  const wantedKey = leaderProgramKey(programTitle, programLocation);
  const wantedName = normalizeNameKey(leaderName);
  let email = '';
  let already = false;
  rows.forEach(row => {
    const rowName = normalizeNameKey(row[map['Leader_Name']]);
    if (rowName !== wantedName) return;
    // THE ADDRESS COMES OFF THEIR OTHER ROWS. A leader is a person, and the
    // person's address is the same one whichever class this is — retyping it
    // per row is how a leader ends up with two addresses and one of them
    // stale. Blank when this is their first row, which is a row somebody has
    // to finish on the leader tab, and the dialog says so.
    if (!email) email = String(row[map['Email']] || '').trim();
    const rowTitle = String(row[map['Program']] || '').trim();
    const rowLocation = String(row[map['Location']] || '').trim();
    if (rowTitle && rowLocation && leaderProgramKey(rowTitle, rowLocation) === wantedKey) already = true;
  });
  if (already) return { status: 'exists', name: leaderName, email: email, note: '' };

  // The first blank line in the data band — the same one a person typing on
  // this tab would use, spare rows and all (see MEMORY_TAB_SPARE_ROWS).
  const out = new Array(headers.length).fill('');
  out[map['Leader_Name']] = leaderName;
  out[map['Email']] = email;
  out[map['Program']] = programTitle;
  out[map['Location']] = programLocation;
  out[map['Notify_Roster_Changes']] = false;
  out[map['Staff_Notes']] = `Added from ${SHEET_NAMES.PROGRAM_MONTH}. Emails are off until you tick ` +
    `Notify_Roster_Changes` + (email ? '.' : `, and there is no address on this row yet — add one before ` +
    `the roster can be shared.`);
  try {
    const at = firstBlankProgramLeaderRow(sheet, map['Leader_Name'] + 1);
    sheet.getRange(at, 1, 1, headers.length).setValues([out]);
  } catch (err) {
    return { status: 'refused', name: leaderName, email: email, note: `the row could not be written (${err})` };
  }
  // The tab this index was built from has just gained a row; anything asking
  // again in this execution must see it.
  invalidateProgramLeaderIndex();
  invalidateSectionedRowsCache(sheet);
  return { status: 'added', name: leaderName, email: email, note: '' };
}

/**
 * The sheet row a new leader row goes on: the first one at or below the data
 * row whose name cell is empty, growing the sheet if the tab is full.
 *
 * NOT getLastRow() + 1. writeMemoryTab() leaves a spare band of validated
 * blank rows under the data (MEMORY_TAB_SPARE_ROWS), and those rows count
 * towards getLastRow() the moment anything on the sheet reaches them —
 * appending past them would leave a gap, and readSimpleTable() stops at the
 * first blank name.
 */
function firstBlankProgramLeaderRow(sheet, nameColumn) {
  const lastRow = sheet.getLastRow();
  if (lastRow >= MEMORY_TAB_DATA_ROW) {
    const values = sheet.getRange(MEMORY_TAB_DATA_ROW, nameColumn, lastRow - MEMORY_TAB_DATA_ROW + 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === '') return MEMORY_TAB_DATA_ROW + i;
    }
  }
  const at = Math.max(lastRow + 1, MEMORY_TAB_DATA_ROW);
  if (sheet.getMaxRows() < at) sheet.insertRowsAfter(sheet.getMaxRows(), at - sheet.getMaxRows());
  return at;
}


// --- carrying the old column across ------------------------------------------

/**
 * Moves Program_Options' old Instructor_Email addresses onto this tab, ONCE.
 *
 * THE FAILURE THIS PREVENTS is the quiet one. HEADERS.Program_Options no
 * longer lists Instructor_Email, so the next Program_Options render writes the
 * tab without it — and every address a site has been maintaining for a year
 * goes with it, with nothing on screen to say so. The sheets would keep
 * working (they are shared already) and the next one created would silently
 * share with nobody.
 *
 * So this runs BEFORE that render, reads the old column off the LIVE SHEET by
 * name rather than through HEADERS (which has already forgotten it), and
 * writes what it finds here.
 *
 * ADDITIVE AND ONCE. A program that already has a leader row is left alone —
 * the row somebody typed is better information than the column it replaced —
 * and the marker property means a second pass cannot resurrect addresses that
 * have since been deliberately deleted. Leader_Name is left blank on a
 * migrated row because the old column never held one; the address is what
 * there was to carry.
 */
function migrateProgramLeaderAddresses(ss, leaderSheet) {
  const props = tryGetScriptProperties();
  if (!props) return 0;
  if (props.getProperty(PROGRAM_LEADERS_MIGRATED_PROP_KEY)) return 0;

  const legacy = readLegacyInstructorEmails(ss);
  // Marked done either way. A workbook with nothing to carry (a fresh install,
  // or one where the column was always blank) has completed this migration
  // just as surely as one that moved forty addresses, and leaving the marker
  // unset would mean re-reading Program_Options on every sync forever.
  const existing = {};
  const headers = HEADERS.Program_Leaders;
  const map = getIndexMap(headers);
  let rows = [];
  try {
    rows = readSimpleTable(leaderSheet, headers);
  } catch (err) {
    // Unreadable is not "empty" — treating it as empty would duplicate every
    // row on the tab. Leave the marker unset and try again next sync.
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_LEADERS} before migrating addresses (${err}) — will retry.`);
    return 0;
  }
  rows.forEach(row => {
    const key = leaderProgramKey(row[map['Program']], row[map['Location']]);
    existing[key] = true;
  });

  const added = [];
  Object.keys(legacy).forEach(key => {
    if (existing[key]) return;
    const found = legacy[key];
    const row = new Array(headers.length).fill('');
    row[map['Leader_Name']] = '';
    row[map['Email']] = found.emails.join(', ');
    row[map['Program']] = found.title;
    row[map['Location']] = found.location;
    // NOT ticked. Turning notifications on for forty addresses nobody has been
    // asked about, as a side effect of an upgrade, is a mail-out — see
    // section 9d. Somebody chooses this per leader, on purpose.
    row[map['Notify_Roster_Changes']] = false;
    row[map['Staff_Notes']] = 'Carried over from Program_Options — add the leader\'s name.';
    added.push(row);
  });

  if (added.length > 0) {
    writeMemoryTab(leaderSheet, headers, rows.concat(added), programLeadersTabOptions());
    invalidateProgramLeaderIndex();
    log(`Program_Leaders: carried ${added.length} address(es) over from Program_Options' old ` +
      `${LEGACY_INSTRUCTOR_EMAIL_COLUMN} column.`);
    noteForAdmin('Program leader addresses moved to their own tab',
      `${added.length} address(es) that lived in Program_Options' ${LEGACY_INSTRUCTOR_EMAIL_COLUMN} ` +
      `column are now rows on the ${SHEET_NAMES.PROGRAM_LEADERS} tab, where a leader also has a name ` +
      `and can be sent roster-change emails. Nothing was lost and nothing was turned on — the ` +
      `notification tick starts clear on every carried-over row.`);
  }

  try {
    props.setProperty(PROGRAM_LEADERS_MIGRATED_PROP_KEY, new Date().toISOString());
  } catch (err) {
    // The write is done; only the marker failed. The additive guard above means
    // a second run adds nothing, so this costs a wasted read rather than data.
    log(`ℹ️ Could not record that the program leader migration ran (${err}).`);
  }
  return added.length;
}

/**
 * { programKey: { title, location, emails } } off Program_Options' old address
 * column, read straight from the sheet.
 *
 * By HEADER NAME on the live sheet, deliberately: HEADERS.Program_Options no
 * longer contains the column, so readSimpleTable() cannot return it. This is
 * the one place in the project that has to look at a sheet the layout has
 * already stopped describing.
 */
function readLegacyInstructorEmails(ss) {
  const found = {};
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_OPTIONS);
  if (!sheet) return found;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < MEMORY_TAB_DATA_ROW || lastCol < 1) return found;

  let grid;
  try {
    grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_OPTIONS} for its old address column (${err}).`);
    return found;
  }

  const headerRow = (grid[MEMORY_TAB_HEADER_ROW - 1] || []).map(normalizeHeaderText);
  const emailCol = headerRow.indexOf(LEGACY_INSTRUCTOR_EMAIL_COLUMN);
  const titleCol = headerRow.indexOf('Event');
  const locationCol = headerRow.indexOf('Location');
  if (emailCol === -1 || titleCol === -1 || locationCol === -1) return found;

  grid.slice(MEMORY_TAB_DATA_ROW - 1).forEach(row => {
    const title = String(row[titleCol] || '').trim();
    const location = String(row[locationCol] || '').trim();
    const emails = parseLeaderEmailList(row[emailCol]);
    if (!title || !location || emails.length === 0) return;
    found[leaderProgramKey(title, location)] = { title, location, emails };
  });
  return found;
}


// --- a renamed program -------------------------------------------------------

/**
 * A program renamed on the calendar takes its leader rows with it.
 *
 * The same reasoning as renameProgramOptionRows(): this tab is keyed by
 * Program + Location and holds something nothing can regenerate — who leads
 * the class. Without this the leader is stranded under the old name, the
 * renamed program looks like it has nobody, and the next sync would share its
 * sheet with no one at all.
 */
function renameProgramLeaderRows(ss, renames) {
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_LEADERS);
  if (!sheet) return;
  const headers = HEADERS.Program_Leaders;
  const map = getIndexMap(headers);

  let rows;
  try {
    rows = readSimpleTable(sheet, headers);
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_LEADERS} to follow a rename (${err}).`);
    return;
  }
  if (rows.length === 0) return;

  const titleMap = {};
  renames.forEach(rename => { titleMap[normalizeNameKey(rename.oldTitle)] = rename.newTitle; });

  let moved = 0;
  rows.forEach(row => {
    const replacement = titleMap[normalizeNameKey(row[map['Program']])];
    if (!replacement) return;
    row[map['Program']] = replacement;
    moved++;
  });
  if (moved === 0) return;

  // A leader may now have two identical rows — one already typed under the new
  // name, one just carried onto it. Same person, same class: keep the first.
  //
  // The one thing that is NOT interchangeable between them is Title_Match:
  // the phrases are how future programs find this leader, and dropping the
  // duplicate that happened to carry them would quietly un-attribute
  // everything they were going to catch. So the survivor takes the union.
  const kept = [];
  const claimed = {};
  rows.forEach(row => {
    const identity = `${normalizeNameKey(row[map['Leader_Name']])}|` +
      `${leaderProgramKey(row[map['Program']], row[map['Location']])}`;
    const already = claimed[identity];
    if (already) {
      const phrases = parseLeaderTitleMatchPhrases(already[map['Title_Match']])
        .concat(parseLeaderTitleMatchPhrases(row[map['Title_Match']]))
        .filter(uniqueStrings);
      if (phrases.length > 0) already[map['Title_Match']] = phrases.join(', ');
      return;
    }
    claimed[identity] = row;
    kept.push(row);
  });

  writeMemoryTab(sheet, headers, kept, programLeadersTabOptions());
  invalidateProgramLeaderIndex();
  log(`Renamed program(s): moved ${moved} ${SHEET_NAMES.PROGRAM_LEADERS} row(s) onto the new name` +
    (kept.length < rows.length ? `, dropping ${rows.length - kept.length} duplicate(s)` : '') + '.');
}
