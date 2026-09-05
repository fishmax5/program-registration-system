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
 * two channels a leader who has it ticked is on:
 *
 *   "At each registration"     the diff pass in 66 — mid-hour, whenever
 *                               something on the roster actually moves.
 *   "N days before each date"  the countdown digest beside it — one email per
 *                               session, N days ahead of it, listing who is
 *                               on the roster that morning.
 *
 * BLANK OR UNRECOGNIZED READS AS "At each registration" — a typo, or a
 * workbook upgrading from before this column existed, must keep doing exactly
 * what a ticked Notify_Roster_Changes has always done rather than going
 * silent. The same reasoning as an unrecognized Notify_Timing's neighbour in
 * section 9e: a cell nobody typed correctly is not an instruction to stop.
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

/** The dropdown's full, closed vocabulary — what Notify_Timing is validated against. */
const LEADER_NOTIFY_TIMING_LIST = [LEADER_NOTIFY_TIMING_EACH_CHANGE].concat(
  [1, 2, 3, 4, 5, 6, 7].map(leaderNotifyTimingDaysBeforeLabel));

/**
 * One Notify_Timing cell, resolved into { mode: 'each_change' | 'days_before', days }.
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
    if (days >= 1 && days <= LEADER_NOTIFY_TIMING_MAX_DAYS) return { mode: 'days_before', days };
  }
  return { mode: 'each_change', days: 0 };
}


// --- the tab ----------------------------------------------------------------

function programLeadersTabOptions() {
  return {
    banner: '👩‍🏫 Program Leaders',
    bannerNote: 'Who leads each program, where to write to them, and whether they want an email ' +
      'when that program\'s roster changes. Notify_Timing picks WHEN: at each change, or a countdown ' +
      'of days before each date. One row per leader per program — a leader with three classes has ' +
      'three rows. Sheet_Link and Last_Notified fill in by themselves.',
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

  // Leader first, then their programs. Somebody opens this tab to answer
  // "what does Jane lead" or "who leads Chair Yoga", and only the first of
  // those is helped by an order — sorting by program would scatter Jane's
  // three rows down the tab with no way to gather them.
  rows.sort((a, b) =>
    normalizeNameKey(a[map['Leader_Name']]).localeCompare(normalizeNameKey(b[map['Leader_Name']])) ||
    String(a[map['Location']] || '').localeCompare(String(b[map['Location']] || '')) ||
    String(a[map['Program']] || '').localeCompare(String(b[map['Program']] || '')));

  writeMemoryTab(sheet, headers, rows, programLeadersTabOptions());
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
      programLocation: location
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
  const kept = [];
  const claimed = {};
  rows.forEach(row => {
    const identity = `${normalizeNameKey(row[map['Leader_Name']])}|` +
      `${leaderProgramKey(row[map['Program']], row[map['Location']])}`;
    if (claimed[identity]) return;
    claimed[identity] = true;
    kept.push(row);
  });

  writeMemoryTab(sheet, headers, kept, programLeadersTabOptions());
  invalidateProgramLeaderIndex();
  log(`Renamed program(s): moved ${moved} ${SHEET_NAMES.PROGRAM_LEADERS} row(s) onto the new name` +
    (kept.length < rows.length ? `, dropping ${rows.length - kept.length} duplicate(s)` : '') + '.');
}
