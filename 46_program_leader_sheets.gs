// ============================================================================
// 9b. PROGRAM REGISTRANT SHEETS  (a live roster, shared out of the workbook)
// ============================================================================
//
// THE PROBLEM. Somebody wants to know who is coming to a class, and they want
// to know it now — not off a PDF printed on Monday. Sharing this workbook with
// them is not an answer: it holds every location's registrations, every phone
// number, the catering order and the tabs that break if you type in the wrong
// cell.
//
// THESE USED TO BE CALLED "PROGRAM LEADER SHEETS", and the name was wrong by
// the time it was written: the leader marks who confirmed, but the desk reads
// the same sheet to answer the phone, the office reads it to plan a room, and
// the person covering a class nobody planned to cover reads it because it is
// the only current list there is. A sheet named after ONE of its readers is a
// sheet the others hesitate to open. It is the REGISTRANTS' sheet — named for
// what is on it rather than for who was expected to look.
//
// The identifiers below still say "leader", deliberately and for the same
// reason LEADER_SHEET_REGISTRY_PROP_KEY still says "instructor": renaming a
// stored key or a tab name hands every live sheet to nobody. What changed is
// every word a person reads.
//
// So a program with a leader gets its OWN small spreadsheet in Drive, holding
// nothing but that program's roster, which the leader is added to as a VIEWER.
//
// ONE SHEET PER PROGRAM, NOT PER SESSION. A weekly class is one sheet with a
// band per date, so a link handed out in September is still the right link in
// March. It is refreshed by the hourly registration sync, so it costs no
// trigger of its own.
//
// A VIEW-ONLY LIST SINCE NOV 2026. The sheets used to carry five leader tick
// columns (Contacted, Confirmed, Waitlisted, Dropped, Attended) and
// Leader_Notes, read back every hour through a hidden per-row snapshot. Max
// cut that: the office keeps those ticks on All_Registrants, and the hourly
// read of every sheet in Drive was the costliest thing the sync did. Now the
// push writes, nothing reads back, the link is view-only and leaders are
// viewers (shareLeaderSheetWithLeadersAsViewers_). The staff roster link on a
// program's title points at its rows on All_Registrants instead.
//
// WHO GETS ONE. Only a program with a row on Program_Leaders (programHasLeader_),
// a week before its next session (ensureRegistrantSheetsForUpcomingPrograms),
// or whenever its leader asked to be notified. A sheet whose program has no
// leader any more is retired once (retireLeaderlessSheet_): its tab says to ask
// the office, and the push leaves it alone. Lunch never gets one.
//
// THE PRIVACY BOUNDARY is one program AT ONE LOCATION — the same grain as
// Program_Settings and Program_Leaders, and the reason the key carries both.
// Somebody teaching Chair Yoga at Narberth has no business reading Ashbridge's
// roster, and a per-title sheet would hand it to them.
// ============================================================================

/**
 * Drive folder the per-program sheets live in, so they don't litter My Drive.
 *
 * These sheets have been filed under two earlier names — "Instructor Sign-Up
 * Sheets", then "Program Leader Sign-Up Sheets".
 * getOrCreateProgramLeaderSheetFolder() RENAMES whichever it finds rather than
 * creating a second beside it: a folder per historical name, each holding the
 * sheets made while that name was current, is a filing system nobody asked for
 * and the kind of thing only noticed a year later. The list is in
 * most-recent-first order, which is the order a workbook is likeliest to have
 * them in.
 */
const LEADER_SHEET_FOLDER_NAME = 'Program Registrant Sheets';
const LEGACY_LEADER_SHEET_FOLDER_NAMES =
  ['Program Leader Sign-Up Sheets', 'Instructor Sign-Up Sheets'];

/**
 * programKey -> { fileId, title, location, createdAt }. See
 * getProgramLeaderSheetRegistry().
 *
 * THE VALUE IS DELIBERATELY STILL SPELLED "INSTRUCTOR". Script Property keys
 * are versioned here because a changed stored SHAPE needs a new key — and this
 * shape did not change, only the words this project uses for it. Renaming the
 * key would hand every existing workbook an empty registry: every live shared
 * sheet would look unregistered, the next menu press would build a second file
 * beside each one, and the marks sitting in the first would stop coming back.
 * A stale-looking constant value is a much smaller cost than that.
 */
const LEADER_SHEET_REGISTRY_PROP_KEY = 'INSTRUCTOR_SHEET_REGISTRY_V1';

/**
 * The one tab in a leader's spreadsheet. Named, not indexed, so a stray extra
 * tab can't be mistaken for it — and unchanged by the rename for the same
 * reason the registry key is: getOrCreateSheet() would make a second, empty
 * tab beside every existing roster and the marks on the first would be orphaned.
 */
const LEADER_SHEET_TAB_NAME = 'Sign_Up_Sheet';

/**
 * The window a shared sheet covers. Backward as well as forward because a
 * leader marking up last week's class is the normal case on a Monday, and
 * a roster that dropped a session the moment it started would be useless for
 * exactly the marking it exists to collect.
 */
const LEADER_SHEET_BACK_DAYS = 14;
const LEADER_SHEET_FORWARD_DAYS = 90;

/**
 * HOW LONG A CANCELLATION STAYS ON A LEADER'S ROSTER (November 2026).
 *
 * A cancelled row used to stay on the sheet for as long as its session was in
 * the window, struck through in orange. That is the right record for the
 * office and the wrong one for a leader: Heather Turner (Low Cost Wills) read
 * "11:00 — Maryrose Crowe (Cancelled), George Moosburner, Noreen Walsh" as
 * three people booked into one appointment, against an emailed list that
 * (correctly) left Maryrose out. Two days is long enough for a leader to see
 * that somebody dropped out, and short enough that the roster goes back to
 * being the list of who is coming. The Registrants tab keeps every row.
 *
 * Measured from the date in the `Cancelled … on <date>` stamp every
 * cancellation writer puts in Admin_Notes (`71`'s cancellationStamp). A
 * Cancelled row with no such stamp (typed by hand, or older than the stamp)
 * has no date to count from and is treated as long-cancelled.
 */
const LEADER_SHEET_CANCELLED_SHOW_DAYS = 2;

/** Backstop on one sheet's size — the window already bounds this; a runaway roster shouldn't blow the write. */
const LEADER_SHEET_MAX_ROWS = 3000;

/**
 * The sentence an empty roster is written with — a CONSTANT because two
 * separate pieces of code now depend on it meaning the same thing: the writer
 * below puts it on the tab, and leaderSheetTabReadsEmpty_() reads it back to
 * decide whether the tab holds what the registry claims it holds. A literal in
 * two places is a check that silently stops checking the day somebody improves
 * the wording.
 */
const LEADER_SHEET_EMPTY_ROSTER_TEXT =
  'Nobody has signed up yet — this fills in by itself as registrations come in.';

/**
 * Does this tab currently hold the "nobody has signed up yet" placeholder?
 *
 * ONE CELL, AND ONLY EVER ASKED ON THE SKIP PATH — see the fault below.
 *
 * THE FAULT THIS EXISTS FOR. The fingerprint (computeLeaderSheetFingerprint)
 * is a claim about what the tab holds, stored in Script Properties by the run
 * that wrote it; the tab itself is in somebody else's spreadsheet. Nothing ever
 * checked that the two agreed, so when they came apart the push did the one
 * thing that could not recover: it read a fingerprint saying "ten people",
 * matched it, and skipped the sheet — every hour, forever, over a tab reading
 * "Nobody has signed up yet." Both halves looked healthy on their own. The
 * workbook reported ten rows already written, the leader reported an empty
 * roster, and both were telling the truth about a different thing.
 *
 * The two can come apart for more than one reason (a write that threw after
 * sheet.clear(), a registry flushed by a run whose sheet write was lost, an
 * older createProgramLeaderSheet() that wrote the tab and stored no
 * fingerprint at all), which is exactly why the repair is stated over the
 * OBSERVED tab rather than over any one of those causes.
 *
 * Deliberately not a general "is the sheet right?" check. A fingerprint cannot
 * be verified cheaply — that would mean reading the whole roster back, which
 * is the round trip the fingerprint exists to avoid. This asks the one
 * question that is answerable in a single getValue() and is the only state
 * that is unrecoverable: the tab says nobody, the registry says somebody.
 */
function leaderSheetTabReadsEmpty_(sheet) {
  try {
    return String(sheet.getRange(MEMORY_TAB_DATA_ROW, 1).getValue() || '').trim() ===
      LEADER_SHEET_EMPTY_ROSTER_TEXT;
  } catch (err) {
    // A tab that will not answer is not evidence of anything. Reported as "not
    // empty" so the caller takes its ordinary path rather than rewriting every
    // sheet in the workbook on the strength of a failed read.
    log(`ℹ️ Could not read the first row of a program registrant sheet (${err}).`);
    return false;
  }
}

/**
 * The shared sheet's own columns. A SUBSET of All_Registrants plus two hidden
 * machine columns — deliberately not the whole row: Lunch_Type, the meal
 * counts, Admin_Notes and the internal keys are staff business, and every
 * column left out here is one a program leader cannot see.
 */
const LEADER_SHEET_HEADERS = [
  'Event_Date', 'Event_Time', 'Location', 'Name', 'Party_Size',
  'Phone', 'Email', 'Program_Status', 'Answers'
];

/**
 * THE ANSWERS TO THE PROGRAM'S OWN QUESTIONS (Program_Questions, `53`/`54`) —
 * "What was your computer issue?" is asked FOR the leader, and until this
 * column it stopped at the Registrants tab. Already stored there as one
 * `Form_Answers` string ("Title: answer | Title: answer", `28`), so nothing on
 * the import or the forms changed: this only carries it across, one question
 * per LINE, because a leader reads it down a cell rather than along one.
 *
 * ONE column rather than one per question: a program's question set moves
 * (a question added in October is not answered by September's registrants),
 * and a column per title would reshape the sheet every time it did.
 *
 * LAST on the list, like every column here written by the sync and never read
 * back: the sheet is a view-only list (Nov 2026).
 */
function leaderSheetAnswersText(formAnswers) {
  return String(formAnswers || '').split(' | ')
    .map(part => part.trim()).filter(Boolean).join('\n');
}

/**
 * Every column on the sheet is the sync's. Since Nov 2026 the sheet is a
 * view-only list — leaders are viewers, nothing on it is read back — so the
 * warning-only protection covers the whole row.
 */
const LEADER_SHEET_DERIVED_COLUMNS = LEADER_SHEET_HEADERS.slice();

/**
 * The background a session band is drawn in, and the ink on it.
 *
 * The TINT layer rather than the banner blue (see PALETTE): a band here is
 * separating one class from the next INSIDE a table, not announcing a section
 * of the workbook, and a full-strength blue strip every eight rows turns a
 * roster into a barcode. Slate ink on a pale wash reads as structure and
 * leaves the yellow hand-entry columns as the only saturated thing on the page,
 * which is the one place a leader's eye should be pulled.
 */
defineLazyGlobal_('LEADER_SHEET_BAND_BG', () => PALETTE.LOC_BLUE);
defineLazyGlobal_('LEADER_SHEET_BAND_INK', () => PALETTE.INK_STRONG);

/**
 * WHAT A WAITLISTED LINE LOOKS LIKE, which until now was: exactly like every
 * other line, with one word in a column a leader had no reason to read.
 *
 * A roster is scanned, not read. The one question a leader asks of it standing
 * in a doorway is "how many chairs do I need", and a person who is waiting is
 * the one line on the page where the answer is no. So the whole row is washed
 * — the pale peach of the TINT layer, not a signal colour, because it is a
 * state of a row rather than an alarm about it and half a class on the
 * waitlist must not turn the sheet orange.
 *
 * The Program_Status CELL itself takes the saturated SIGNAL_ORANGE that
 * 'Waitlisted' wears everywhere else in this workbook (see STATUS_COLORS): one
 * loud cell says which word to read, the wash says which rows to skip, and a
 * leader who has seen the dashboard recognizes both.
 *
 * The yellow hand-entry columns are re-tinted over this afterwards, on
 * purpose — "type here" outranks "this one is waiting" on a column the leader
 * is meant to tick.
 */
defineLazyGlobal_('LEADER_SHEET_WAITLIST_BG', () => PALETTE.LOC_PEACH);
defineLazyGlobal_('LEADER_SHEET_WAITLIST_INK', () => PALETTE.SIGNAL_ORANGE);


// --- the Waitlist tab ---------------------------------------------------------

/**
 * WHO IS WAITING, ON A TAB OF ITS OWN, ONE LINE PER PERSON.
 *
 * The class list is for counting chairs, and a waitlisted person is the one
 * line on it where the answer is no — so a row whose Program_Status is
 * 'Waitlisted' now leaves Sign_Up_Sheet altogether and is listed here instead,
 * once per PERSON with every date they are waiting for condensed into one
 * `Dates` cell ("Oct 6, 13, 20 · Nov 3"). Beside them, the people on the
 * workbook's Program_Waitlist tab (`99z`) — waiting for ANY date of this
 * program, which no per-session roster could show at all.
 *
 * READ-ONLY, AND NEVER READ BACK — like the whole sheet since Nov 2026,
 * so nothing typed here can move a registration; the whole tab is protected with a warning like the derived
 * columns next door. Taking somebody off the waitlist is the office's job
 * (Quick Mark ▸ Change this registration ▸ Put them back on), which is what
 * the banner note says.
 *
 * A PROJECTION, like the tab beside it: moving a waitlisted row here changes
 * nothing on All_Registrants, and a leader tick already on that row stays on
 * it exactly as it was.
 *
 * Only UPCOMING dates (today on): a date that has gone is not something
 * anybody is still waiting for.
 */
const LEADER_WAITLIST_TAB_NAME = 'Waitlist';
const LEADER_WAITLIST_HEADERS = ['Name', 'Phone', 'Email', 'Party_Size', 'Dates', 'Added', 'Notes'];
const LEADER_WAITLIST_EMPTY_TEXT = 'Nobody is on the waiting list.';

/** Is this built roster line WAITLISTED by the workbook? */
function isLeaderSheetStatusWaitlisted_(row, sheetMap) {
  return String(row[sheetMap['Program_Status']] || '').trim() === 'Waitlisted';
}

/**
 * Splits one program's built rows into the class list and the waiting list.
 *
 * On Program_Status ALONE, deliberately not on the Waitlisted tick too: a row
 * a leader has just ticked is read back off Sign_Up_Sheet by the next pull,
 * so it has to still BE on Sign_Up_Sheet until the sync has applied the tick
 * and the status says so.
 */
function splitLeaderSheetRows(rows) {
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const roster = [];
  const waitlisted = [];
  (rows || []).forEach(row => {
    (isLeaderSheetStatusWaitlisted_(row, sheetMap) ? waitlisted : roster).push(row);
  });
  return { roster, waitlisted };
}

/**
 * "Oct 6, 13, 20 · Nov 3" — a person's dates, one month per clause, the year
 * named only when the list crosses one. Duplicates (two sittings on one day)
 * are one date.
 */
function condenseLeaderWaitlistDates(dates) {
  const byKey = {};
  (dates || []).forEach(d => {
    const date = coerceDate(d);
    if (date) byKey[formatDateKey(date)] = date;
  });
  const sorted = Object.keys(byKey).sort().map(k => byKey[k]);
  if (sorted.length === 0) return '';
  const tz = Session.getScriptTimeZone();
  const years = {};
  sorted.forEach(d => { years[Utilities.formatDate(d, tz, 'yyyy')] = true; });
  const showYear = Object.keys(years).length > 1;
  const clauses = [];
  let currentMonth = null;
  sorted.forEach(d => {
    const month = Utilities.formatDate(d, tz, showYear ? 'MMM yyyy' : 'MMM');
    const day = Utilities.formatDate(d, tz, 'd');
    if (!currentMonth || currentMonth.month !== month) {
      currentMonth = { month, days: [] };
      clauses.push(currentMonth);
    }
    currentMonth.days.push(day);
  });
  return clauses.map(c => {
    const head = showYear ? c.month.split(' ')[0] : c.month;
    const tail = showYear ? ` ${c.month.split(' ')[1]}` : '';
    return `${head} ${c.days.join(', ')}${tail}`;
  }).join(' · ');
}

/**
 * The Waitlist tab's rows: one per PERSON, matched on the name alone (the
 * normalized), from this program's waitlisted
 * roster lines plus its any-date entries on Program_Waitlist.
 *
 * Order is the order a leader would ring round in: somebody waiting for the
 * soonest date first, then the any-date people in the order they asked.
 */
function buildLeaderWaitlistRows(waitlistedRows, anyDateEntries) {
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const outMap = getIndexMap(LEADER_WAITLIST_HEADERS);
  const todayKey = formatDateKey(new Date());
  const people = {};
  const order = [];
  const personFor = name => {
    const key = normalizeNameKey(name);
    if (!key) return null;
    if (!people[key]) {
      people[key] = { name: String(name).trim(), phone: '', email: '', size: 0,
        dates: [], anyDate: false, added: null, notes: [] };
      order.push(key);
    }
    return people[key];
  };

  (waitlistedRows || []).forEach(row => {
    const date = coerceDate(row[sheetMap['Event_Date']]);
    if (!date || formatDateKey(date) < todayKey) return;
    const p = personFor(row[sheetMap['Name']]);
    if (!p) return;
    p.phone = p.phone || String(row[sheetMap['Phone']] || '').trim();
    p.email = p.email || String(row[sheetMap['Email']] || '').trim();
    p.size = Math.max(p.size, parseInt(row[sheetMap['Party_Size']], 10) || 1);
    p.dates.push(date);
    const note = String(row[sheetMap['Leader_Notes']] || '').trim();
    if (note && p.notes.indexOf(note) === -1) p.notes.push(note);
  });

  (anyDateEntries || []).forEach(entry => {
    const p = personFor(entry.name);
    if (!p) return;
    p.anyDate = true;
    p.phone = p.phone || entry.phone || '';
    p.email = p.email || entry.email || '';
    p.size = Math.max(p.size, parseInt(entry.partySize, 10) || 1);
    const added = coerceDate(entry.addedOn);
    if (added && (!p.added || added < p.added)) p.added = added;
    if (entry.notes && p.notes.indexOf(entry.notes) === -1) p.notes.push(entry.notes);
  });

  const firstDate = p => p.dates.reduce((min, d) => (!min || d < min ? d : min), null);
  order.sort((a, b) => {
    const pa = people[a];
    const pb = people[b];
    const da = firstDate(pa);
    const db = firstDate(pb);
    if (da && db && da.getTime() !== db.getTime()) return da - db;
    if (da && !db) return -1;
    if (!da && db) return 1;
    const aa = pa.added ? pa.added.getTime() : Infinity;
    const ab = pb.added ? pb.added.getTime() : Infinity;
    if (aa !== ab) return aa - ab;
    return a.localeCompare(b);
  });

  return order.map(key => {
    const p = people[key];
    const dated = condenseLeaderWaitlistDates(p.dates);
    const out = new Array(LEADER_WAITLIST_HEADERS.length).fill('');
    out[outMap['Name']] = p.name;
    out[outMap['Phone']] = p.phone;
    out[outMap['Email']] = p.email;
    out[outMap['Party_Size']] = p.size || 1;
    out[outMap['Dates']] = p.anyDate
      ? (dated ? `${PROGRAM_WAITLIST_ANY_DATE_LABEL} (also: ${dated})` : PROGRAM_WAITLIST_ANY_DATE_LABEL)
      : dated;
    out[outMap['Added']] = p.added || '';
    out[outMap['Notes']] = p.notes.join(' | ');
    return out;
  });
}

/**
 * Draws the Waitlist tab of one program registrant sheet. Same rows as the
 * roster tab (banner 1, header 2, data 3), written before its formatting is
 * cleared for the same reason (99u), and protected whole with a warning.
 */
function writeProgramLeaderWaitlistTab(file, entry, waitRows) {
  const sheet = getOrCreateSheet(file, LEADER_WAITLIST_TAB_NAME);
  const headers = LEADER_WAITLIST_HEADERS;
  const numCols = headers.length;
  const map = getIndexMap(headers);
  const rows = waitRows || [];
  const bannerText = `⏳ Waiting list — ${entry.title || 'Program'} — ${entry.location || ''}`;

  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  writeTabValuesBeforeRender_(sheet, [
    { row: MEMORY_TAB_BANNER_ROW, values: [[bannerText]] },
    { row: MEMORY_TAB_HEADER_ROW, values: [headers.slice()] },
    { row: MEMORY_TAB_DATA_ROW, values: rows.length === 0 ? [[LEADER_WAITLIST_EMPTY_TEXT]] : rows }
  ]);
  sheet.clearFormats();

  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols, bannerText, {
    note: `Refreshed with the class list. One line per person; "Dates" lists every date they are ` +
      `waiting for, and "${PROGRAM_WAITLIST_ANY_DATE_LABEL}" means they will take whichever date comes ` +
      `free. Nobody here holds a seat or a meal.\n\nThis tab is filled in by itself — to put somebody ` +
      `on the class, ask the office.`
  });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);

  if (rows.length === 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1)
      .setValue(LEADER_WAITLIST_EMPTY_TEXT)
      .setFontStyle('italic')
      .setFontColor(TYPO.MUTED.color);
  } else {
    const data = sheet.getRange(MEMORY_TAB_DATA_ROW, 1, rows.length, numCols);
    data.setValues(rows);
    data.setBackgrounds(rows.map((r, i) =>
      new Array(numCols).fill(i % 2 === 0 ? PALETTE.PAPER : PALETTE.STRIPE)));
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Party_Size'] + 1, rows.length, 1).setNumberFormat('0');
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Added'] + 1, rows.length, 1).setNumberFormat(DATE_DISPLAY_FORMAT);
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Dates'] + 1, rows.length, 1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    protectDerivedColumns(sheet, headers, headers,
      [{ start: MEMORY_TAB_DATA_ROW, count: rows.length }]);
  }
  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  autosizeColumns(sheet, { minCols: numCols, force: true });
}

/**
 * Everything one program's sheet is drawn from: the class list, the waiting
 * list, and the rows the waiting list was folded from. The ONE place the
 * split happens, so the push, the menu's create and the fingerprint cannot
 * disagree about which rows went where.
 */
function leaderSheetContentFor(entry, rows) {
  const split = splitLeaderSheetRows(rows);
  const anyDate = programWaitlistEntriesFor(entry && entry.title, entry && entry.location);
  return {
    roster: split.roster,
    waitlist: buildLeaderWaitlistRows(split.waitlisted, anyDate),
    anyDate
  };
}


// --- the registry -----------------------------------------------------------

let __leaderSheetRegistryCache = null;
let __leaderSheetRegistryDirty = false;

/**
 * Which programs have a shared sheet, and where it lives. Read once per
 * execution and written back by flushPersistentRegistries(), like every other
 * persistent registry in this project.
 */
function getProgramLeaderSheetRegistry() {
  if (__leaderSheetRegistryCache) return __leaderSheetRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(LEADER_SHEET_REGISTRY_PROP_KEY);
  __leaderSheetRegistryCache = raw ? JSON.parse(raw) : {};
  return __leaderSheetRegistryCache;
}

function saveProgramLeaderSheetRegistryEntry(programKey, entry) {
  const registry = getProgramLeaderSheetRegistry();
  registry[programKey] = entry;
  __leaderSheetRegistryDirty = true;
}

/**
 * Writes the registry to Script Properties now, rather than waiting for
 * flushPersistentRegistries(). For the push loop, whose progress has to
 * survive an execution killed at its ceiling — which reaches no flush at all.
 * One property write, and only when something is actually owed.
 */
function flushProgramLeaderSheetRegistry_() {
  if (!__leaderSheetRegistryDirty || !__leaderSheetRegistryCache) return;
  try {
    PropertiesService.getScriptProperties().setProperty(LEADER_SHEET_REGISTRY_PROP_KEY,
      JSON.stringify(__leaderSheetRegistryCache));
    __leaderSheetRegistryDirty = false;
  } catch (err) {
    // Left dirty: flushPersistentRegistries() tries again at the end.
    log(`⚠️ Could not save the program registrant sheet registry mid-run (${err}).`);
  }
}

function removeProgramLeaderSheetRegistryEntry(programKey) {
  const registry = getProgramLeaderSheetRegistry();
  if (registry[programKey] === undefined) return;
  delete registry[programKey];
  __leaderSheetRegistryDirty = true;
}

/**
 * Program identity: title AND location, which is the privacy boundary — see the
 * section header. The title is the one the program is FILED under at that
 * building (canonicalProgramTitle, 99zzc): a title staff listed in the
 * program's Also_Known_As, or one carrying a "CANCELLED…:" status word, files
 * under the program's own name, so one program is one roster however many
 * ways the calendar spells it. A title with no alias keys exactly as before.
 */
function leaderProgramKey(title, location) {
  return `${normalizeNameKey(canonicalProgramTitle(title, location))}|${normalizeNameKey(location)}`;
}

/**
 * Minutes after midnight of the FIRST clock time in a label ("9:30 AM – 10:00
 * AM" → 570), or null. What the roster and the leader digest order a day by.
 */
function leaderTimeLabelMinutes(label) {
  const m = String(label || '').match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?/);
  if (!m) return null;
  let hour = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'P') hour += 12;
  return hour * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

/** Sort comparator on two time labels: by the clock, untimed last, text as a tiebreak. */
function compareLeaderTimeLabels(a, b) {
  const ta = String(a || '');
  const tb = String(b || '');
  if (ta === tb) return 0;
  const ma = leaderTimeLabelMinutes(ta);
  const mb = leaderTimeLabelMinutes(tb);
  if (ma !== null && mb !== null && ma !== mb) return ma - mb;
  if (ma !== null && mb === null) return -1;
  if (ma === null && mb !== null) return 1;
  return ta.localeCompare(tb);
}

/**
 * The date in the LAST `Cancelled … on <date>` stamp in Admin_Notes, or null.
 * The last, because a registration cancelled, put back and cancelled again
 * carries both stamps and the second is the one that counts.
 */
function leaderCancellationDate_(notes) {
  const re = /Cancelled\b[^|]*?\bon\s+(?:[A-Za-z]{3},\s*)?([A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4})/g;
  let found = null;
  let m;
  while ((m = re.exec(String(notes || ''))) !== null) found = m[1];
  if (!found) return null;
  const date = new Date(found.replace('.', ''));
  return isNaN(date.getTime()) ? null : date;
}

/** True for a Cancelled row whose cancellation is older than LEADER_SHEET_CANCELLED_SHOW_DAYS. */
function leaderSheetCancellationExpired_(row, map, now) {
  if (String(row[map['Program_Status']] || '').trim() !== 'Cancelled') return false;
  const when = map['Admin_Notes'] === undefined ? null : leaderCancellationDate_(row[map['Admin_Notes']]);
  if (!when) return true;
  const today = parseDateKey(formatDateKey(now || new Date()));
  const cancelled = parseDateKey(formatDateKey(when));
  return Math.round((today - cancelled) / 86400000) > LEADER_SHEET_CANCELLED_SHOW_DAYS;
}

/**
 * "John Pavloff & Mrs. Pavloff" / "Ann, Bob & Carl" — a party's names as one.
 * Whoever filled in the form first, then the rest in the order they came.
 */
function leaderPartyNames(names) {
  const list = [];
  (names || []).forEach(name => {
    const n = String(name || '').trim();
    if (n && !list.some(x => normalizeNameKey(x) === normalizeNameKey(n))) list.push(n);
  });
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

/**
 * ONE LINE PER PARTY (November 2026). A couple who book a Wills appointment
 * are one appointment, and the roster listing them as two people — each
 * "party of 2" — read as four people, or as two bookings in one slot. So the
 * rows one form response made for one session (same Event_ID, same Party_ID,
 * same Program_Status) are drawn as one line: the names together, the party's
 * size, and the first phone, email and answers any of them gave.
 *
 * A row with no Party_ID (added at the desk) is never folded: there is nothing
 * that says who it came with.
 */
function foldLeaderSheetParties_(rows, partyOf) {
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const groups = {};
  const out = [];
  (rows || []).forEach(row => {
    const meta = partyOf.get(row) || {};
    if (!meta.partyId) { out.push(row); return; }
    const key = `${meta.eventId}|${meta.partyId}|${String(row[sheetMap['Program_Status']] || '').trim()}`;
    if (!groups[key]) {
      groups[key] = { rows: [], meta };
      out.push(groups[key]);
    }
    groups[key].rows.push(row);
  });

  const isHead = (row, meta) => {
    const primary = normalizeNameKey(meta.primary);
    return !primary || primary === 'self' || primary === normalizeNameKey(row[sheetMap['Name']]);
  };

  return out.map(item => {
    if (Array.isArray(item)) return item;
    if (item.rows.length === 1) return item.rows[0];
    const members = item.rows.slice();
    const headIdx = members.findIndex(r => isHead(r, partyOf.get(r) || {}));
    if (headIdx > 0) members.unshift(members.splice(headIdx, 1)[0]);
    const folded = members[0].slice();
    folded[sheetMap['Name']] = leaderPartyNames(members.map(r => r[sheetMap['Name']]));
    folded[sheetMap['Party_Size']] = Math.max(members.length,
      ...members.map(r => parseInt(r[sheetMap['Party_Size']], 10) || 1));
    ['Phone', 'Email', 'Answers'].forEach(col => {
      if (!String(folded[sheetMap[col]] || '').trim()) {
        const other = members.find(r => String(r[sheetMap[col]] || '').trim());
        if (other) folded[sheetMap[col]] = other[sheetMap[col]];
      }
    });
    return folded;
  });
}

/** Is this built roster line somebody who is WAITING rather than booked? (Program_Status alone.) */
function isLeaderSheetWaitlistedRow(row, sheetMap) {
  return isLeaderSheetStatusWaitlisted_(row, sheetMap);
}

/**
 * DOES THIS PROGRAM HAVE A LEADER? A row on Program_Leaders for this title and
 * location with a name or an address on it. Only those programs get a roster
 * sheet (Nov 2026).
 */
function programHasLeader_(title, location) {
  const leaders = buildProgramLeaderIndex()[leaderProgramKey(title, location)] || [];
  return leaders.some(l => !!l.name || (l.emails || []).length > 0);
}

/** How many leaderless sheets one push may retire; the rest wait for the next run. */
const LEADER_SHEET_MAX_RETIRES_PER_RUN = 10;

/** What a retired sheet says instead of a roster. */
const LEADER_SHEET_RETIRED_TEXT =
  'This roster is no longer kept up to date. Ask the office for the current list.';

/**
 * RETIRES ONE SHEET whose program no longer has a leader: the roster tab is
 * replaced by one line saying so, the Waitlist tab is emptied, and the entry is
 * marked retired with its fingerprint cleared, so a program that gains a
 * leader later is pushed in full. Never throws; returns true when it wrote.
 */
function retireLeaderlessSheet_(programKey, entry) {
  try {
    const file = openSpreadsheetCached(entry.fileId);
    const tab = getOrCreateSheet(file, LEADER_SHEET_TAB_NAME);
    tab.clear();
    tab.getRange(1, 1).setValue(LEADER_SHEET_RETIRED_TEXT);
    const wait = file.getSheetByName(LEADER_WAITLIST_TAB_NAME);
    if (wait) wait.clear();
    saveProgramLeaderSheetRegistryEntry(programKey,
      Object.assign({}, getProgramLeaderSheetRegistry()[programKey] || entry,
        { retired: true, pushedFingerprint: '' }));
    flushProgramLeaderSheetRegistry_();
    log(`Program registrant sheet for "${entry.title}" (${entry.location}) retired — no leader on Program_Leaders.`);
    return true;
  } catch (err) {
    log(`⚠️ Could not retire the program registrant sheet for "${entry.title}" (${err}).`);
    return false;
  } finally {
    forgetSpreadsheetCached(entry.fileId);
  }
}

/**
 * What to say when a program registrant sheet cannot be opened — and, when the reason
 * is a permission, WHO has to do WHAT about it.
 *
 * "Sign_Up — Tai Chi (Narberth) — Exception: You do not have permission to
 * access the requested document" is a true sentence that leaves the reader
 * with no idea that the fix is thirty seconds of sharing, or that the account
 * needing access is the one running the triggers rather than the one reading
 * the email.
 */
function describeLeaderSheetAccessFailure(entry, programKey, err) {
  const name = (entry && entry.title) ? `${entry.title}${entry.location ? ` (${entry.location})` : ''}` : programKey;
  const text = String((err && err.message) || err || '');
  const fileRef = (entry && entry.fileId) ? `\nThe file is: https://docs.google.com/spreadsheets/d/${entry.fileId}/edit` : '';
  if (/permission|access|not found|forbidden/i.test(text)) {
    const runningAs = getCurrentUserEmail() || 'the account running the sync';
    return `${name} — this workbook cannot open its shared sheet: ${text}\n\n` +
      `This run is signed in as ${runningAs}, and that account is not on the file. Nothing is lost — the ` +
      `sheet and everything on it are fine — but the workbook's rows are not going out to the leader.\n\n` +
      `To fix it: open the file, press Share, and add ${runningAs} as an editor. Then run "Refresh Program Registrant Sheets Now" once. A sheet made from this menu now ` +
      `does both of those automatically.${fileRef}`;
  }
  return `${name} — ${text}${fileRef}`;
}


// --- writing the sheets back out --------------------------------------------

/**
 * Refreshes every registered program registrant sheet from the settled picture.
 *
 * Only sheets ALREADY in the registry are touched. Creating one is a
 * deliberate menu action (createProgramLeaderSheet()) — a sync that
 * conjured a spreadsheet per program would produce sixty files nobody asked
 * for and share none of them.
 */
/**
 * Bumped when the SHAPE this file draws changes — a new column, a different
 * band, a reworded banner note. Without it, a change to the drawing would
 * reach only the sheets whose rosters happened to move afterwards.
 */
// v2: the Answers column.
// v3: waitlisted people moved to the Waitlist tab. The bump is the migration —
// every existing sheet's fingerprint stops matching, so the next sync redraws
// each one once and gives it the new tab.
// v4: the Attended acknowledgement column. The bump makes every registered
// sheet a rewrite exactly once; the push is sliced and resumable precisely so
// that a template bump cannot cost a run (see pushProgramLeaderSheets' own
// deadline handling).
// v5 (Nov 2026): a view-only list. The tick columns, Leader_Notes and the two
// hidden machine columns are gone, and nothing is read back. Same migration:
// every registered sheet is redrawn once in the new shape.
const LEADER_SHEET_TEMPLATE_KEY = 'leader-sheet-v5';

/**
 * WHAT THIS SHEET WOULD BE WRITTEN WITH, as one short string.
 *
 * Fingerprinted like the form date labels (10) and the appointment times (55),
 * and for the same reason: this pass runs hourly on every registered sheet
 * whether or not anything on it has moved, and rewriting one is the better part
 * of two hundred round trips against somebody else's spreadsheet. The rows ARE
 * the answer, so hashing them decides the question without writing anything.
 *
 * The heading is in it because the banner is drawn from the entry, so a program
 * renamed or moved is a sheet that has to be redrawn. The refresh STAMP is not:
 * it changes every hour by definition, and a fingerprint that never matches is
 * not a fingerprint.
 *
 * LIKE EVERY FINGERPRINT HERE, it tracks what this script WRITES. A sheet a
 * leader has mangled is not noticed until its rows legitimately change — the
 * escape hatch is the menu item, which passes { force: true }.
 */
function computeLeaderSheetFingerprint(entry, rows) {
  // The any-date entries (`99z`) are in it too: somebody added on Quick Mark
  // is a Waitlist tab that has to be redrawn, with no registrant row moving.
  const anyDate = programWaitlistEntriesFor(entry && entry.title, entry && entry.location)
    .map(e => [e.name, e.phone, e.email, e.partySize, e.addedOn ? formatDateKey(e.addedOn) : '', e.notes]);
  return computeFormLabelFingerprint(rows || [],
    [String((entry && entry.title) || ''), String((entry && entry.location) || ''), anyDate],
    LEADER_SHEET_TEMPLATE_KEY);
}

// ============================================================================
// WHICH SHEET WAS THE PUSH ON WHEN THE EXECUTION DIED?
//
// 2026-09-30 11:39: the hourly sync ended in "We're sorry, the JavaScript
// engine reported an unexpected error. Error code INTERNAL." eight and a half
// minutes after its last log line. That error is not an exception: no catch in
// this project saw it (the per-sheet catch below, the sync's step guard and
// the sliced runner's catch would each have logged a ⚠️ line, and none did),
// so it is an abort of the execution itself — the same kind of death as the
// ceiling, only sooner. Nothing in the log said which sheet it was on, and the
// push would have walked straight back into the same sheet on the next run.
//
// So each sheet is named in Script Properties BEFORE the push touches it, and
// the name is overwritten by the next sheet's (one write a sheet, and one to
// clear it at the end). A marker still standing when a push begins is a sheet
// an execution died on. It is reported by name, counted, and sent to the back
// of the queue so every other sheet is served first; at
// LEADER_SHEET_PUSH_MAX_CRASHES in a row it is left out until the count is a
// day old, so one bad spreadsheet cannot take the whole hourly sync with it.
// A clean rewrite of that sheet wipes its count.
// ============================================================================
const LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY = 'LEADER_SHEET_PUSH_IN_FLIGHT_V1';
const LEADER_SHEET_PUSH_MAX_CRASHES = 2;
const LEADER_SHEET_PUSH_CRASH_MEMORY_MS = 24 * 60 * 60 * 1000;

/** `{ current, crashes: { programKey: { count, lastAt } } }` — never throws. */
function readLeaderSheetPushState_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return { current: parsed.current || null, crashes: parsed.crashes || {} };
    }
  } catch (err) {
    log(`ℹ️ The registrant sheet push's crash marker was unreadable (${err}) — starting clean.`);
  }
  return { current: null, crashes: {} };
}

/** Guarded: a marker that will not write costs the diagnosis, never the push. */
function writeLeaderSheetPushState_(state) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (!state.current && Object.keys(state.crashes || {}).length === 0) {
      props.deleteProperty(LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY);
    } else {
      props.setProperty(LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY, JSON.stringify(state));
    }
  } catch (err) {
    log(`ℹ️ Could not record which registrant sheet the push is on (${err}).`);
  }
}

/** How many runs in a row this sheet has killed; a count a day old is forgotten. */
function leaderSheetPushCrashCount_(state, programKey) {
  const c = state && state.crashes && state.crashes[programKey];
  if (!c) return 0;
  const age = Date.now() - new Date(c.lastAt || 0).getTime();
  return age > LEADER_SHEET_PUSH_CRASH_MEMORY_MS ? 0 : (c.count || 0);
}

/**
 * Read at the head of every push: turns a marker the last execution left
 * behind into a named, counted report. Returns the state the push carries on.
 */
function recoverLeaderSheetPushCrash_(registry) {
  const state = readLeaderSheetPushState_();
  // Counts a day old go, so a sheet left out yesterday is tried again today.
  Object.keys(state.crashes).forEach(key => {
    if (leaderSheetPushCrashCount_(state, key) === 0) delete state.crashes[key];
  });
  const dead = state.current;
  if (dead && dead.programKey) {
    const count = leaderSheetPushCrashCount_(state, dead.programKey) + 1;
    state.crashes[dead.programKey] = { count, lastAt: new Date().toISOString() };
    const name = `"${dead.title || dead.programKey}"${dead.location ? ` (${dead.location})` : ''}`;
    const link = dead.fileId ? ` https://docs.google.com/spreadsheets/d/${dead.fileId}/edit` : '';
    const next = count >= LEADER_SHEET_PUSH_MAX_CRASHES
      ? `That is ${count} in a row, so it is left out of the push until tomorrow and every other ` +
        `sheet is kept up to date without it.`
      : `It goes to the back of the queue this time, so the other sheets are written first.`;
    log(`⚠️ Program registrant sheets: an earlier run died while on the sheet for ${name} ` +
      `(started ${dead.at}). ${next}`);
    noteForAdmin('Program registrant sheets that stopped the sync',
      `${name} — a sync stopped outright while refreshing this program's shared sheet ` +
      `(Apps Script ended the run without an error this workbook could catch). ${next} ` +
      `If it keeps happening, open the file and look for something unusual — a very large tab, ` +
      `thousands of rows or columns typed far below the roster, or a tab added by hand.${link}`);
    // Only ever about a sheet still registered.
    if (registry && !registry[dead.programKey]) delete state.crashes[dead.programKey];
  }
  state.current = null;
  writeLeaderSheetPushState_(state);
  return state;
}

function pushProgramLeaderSheets(sessionRows, registrantRows, options) {
  const force = !!(options && options.force);
  // A DEADLINE, BECAUSE THIS IS THE ONE STEP OF THE SYNC THAT CAN OUTLAST A
  // WHOLE EXECUTION ON ITS OWN. Every sheet is a foreign spreadsheet and a
  // rewrite is ~180 round trips against it; a template bump (v3, the Waitlist
  // tab) makes EVERY sheet a rewrite at once. On 2026-09-30 this loop ran
  // from 9:01 to Apps Script's ceiling at 9:20 without a line in the log — and
  // because the fingerprints it had stored were only in memory, the kill lost
  // all of them, so the next hour started the same rewrite from the top and
  // would have died in the same place, every hour. So: stop between sheets
  // when the caller's budget is spent (the sync hands the rest to a follow-up
  // run), and write each sheet's fingerprint to Script Properties as soon as
  // it has landed rather than at the end. `options.progress.remaining` is how
  // the caller learns there is more to do.
  const deadline = (options && options.deadline) || Infinity;
  const progress = (options && options.progress) || {};
  progress.remaining = 0;
  const registry = getProgramLeaderSheetRegistry();
  const programKeys = Object.keys(registry);
  if (programKeys.length === 0) return 0;

  // NO SESSIONS, NO PUSH. Every roster is a join against the session table,
  // so an empty one makes every sheet "Nobody has signed up yet" at once —
  // which is what three runs did to ~33 sheets on 2026-09-25 after the table
  // was emptied under them (99w, 99x). An empty session table beside a
  // non-empty Registrants tab is never the truth about who is coming; leave
  // every sheet holding the last roster it was given.
  if ((!sessionRows || sessionRows.length === 0) && registrantRows && registrantRows.length > 0) {
    const why = `the session table came back empty while the Registrants tab holds ${registrantRows.length} ` +
      `row(s), so there was nothing to match a roster against. No program registrant sheet was rewritten; ` +
      `each still shows its last roster.`;
    log(`⛔ Program registrant sheets: ${why}`);
    noteForAdmin('Program registrant sheets that were left alone', why);
    return 0;
  }

  const byProgram = buildLeaderSheetRowsByProgram(sessionRows, registrantRows);

  // A SHEET THAT KILLED THE LAST RUN GOES LAST, AND ONE THAT KILLED TWO IS
  // LEFT OUT FOR THE DAY. See LEADER_SHEET_PUSH_IN_FLIGHT_PROP_KEY: the marker
  // written before each sheet is still there only if an execution died on it.
  const pushState = recoverLeaderSheetPushCrash_(registry);
  const suspect = key => leaderSheetPushCrashCount_(pushState, key) > 0;
  const order = programKeys.filter(k => !suspect(k)).concat(programKeys.filter(suspect));
  log(`Program registrant sheets: checking ${order.length} sheet(s).`);

  let pushed = 0;
  let unchanged = 0;
  let keptStranded = 0;
  let quarantined = 0;
  let mergedAway = 0;
  let lunchSkipped = 0;
  let leaderless = 0;
  let retiredThisRun = 0;
  const todayKey = formatDateKey(new Date());
  // An unreadable Program_Leaders tab reads as "nobody leads anything", and
  // that must not retire every roster in Drive. No leader rows at all is
  // treated as not knowing.
  const leadersKnown = Object.keys(buildProgramLeaderIndex()).length > 0;
  if (!leadersKnown) {
    log('⚠️ Program registrant sheets: Program_Leaders reads empty, so no sheet is retired this run.');
  }
  let visited = 0;
  for (let i = 0; i < order.length; i++) {
    // At least one sheet per call, so a follow-up run that starts late still
    // moves forward rather than handing on for ever.
    if (visited > 0 && Date.now() >= deadline) {
      progress.remaining = order.length - i;
      log(`Program registrant sheets: budget spent with ${progress.remaining} sheet(s) still to check — ` +
        `a follow-up run carries on from there.`);
      break;
    }
    const programKey = order[i];
    if (leaderSheetPushCrashCount_(pushState, programKey) >= LEADER_SHEET_PUSH_MAX_CRASHES) {
      quarantined++;
      continue;
    }
    visited++;
    pushOneProgramLeaderSheet_(programKey, i + 1, order.length);
  }
  // Every sheet reached came back: nothing is in flight any more.
  pushState.current = null;
  writeLeaderSheetPushState_(pushState);

  function pushOneProgramLeaderSheet_(programKey, position, total) {
    // Each sheet is a real stretch of work; keep the workbook lease alive
    // (99w — it lapses ten minutes after its holder goes quiet, and this loop
    // used to log nothing until it finished).
    renewWorkbookLease();
    const entry = registry[programKey] || {};
    if (!entry.fileId) return;
    // A SHEET WHOSE PROGRAM IS NOW FILED UNDER ANOTHER NAME (99zzc): its title
    // was listed in another program's Also_Known_As, or carries a status
    // prefix. Its sessions' rows now reach that program's sheet, so this one
    // would come out empty — and an empty write over the leader's last roster
    // is the worse answer. Left exactly as last written; the pull at the head
    // of the sync still reads any marks made on it.
    if (programTitleIsFiledElsewhere(entry.title, entry.location)) {
      mergedAway++;
      return;
    }
    // A LUNCH'S SHEET IS NOT PUSHED (see leaderSheetSkipsProgram_). Left as
    // last written, never opened; the pull still reads any mark made on it.
    if (leaderSheetSkipsProgram_(entry.title)) {
      lunchSkipped++;
      return;
    }
    // A ROSTER FOR A PROGRAM WITH A LEADER, and only those (Nov 2026). A sheet
    // whose program has nobody on Program_Leaders is retired once — its tab
    // says so — and left alone after that. One that gains a leader again is
    // pushed in full on the next run (its fingerprint was cleared).
    if (leadersKnown && !programHasLeader_(entry.title, entry.location)) {
      leaderless++;
      if (!entry.retired && retiredThisRun < LEADER_SHEET_MAX_RETIRES_PER_RUN) {
        if (retireLeaderlessSheet_(programKey, entry)) retiredThisRun++;
      }
      return;
    }
    try {
      const rows = byProgram[programKey] || [];
      // AN EMPTY ROSTER IS AN ANSWER, AND IT HAS TO BE THE RIGHT ONE. "Nobody
      // has signed up yet" is ordinary on a class nobody has booked and is a
      // fault on one with a dozen names on the Registrants tab — and the two
      // are indistinguishable on the sheet itself, which is why this went
      // unnoticed. Counted only when the roster came out empty, so the healthy
      // case pays nothing.
      if (rows.length === 0) {
        // CLASSIFIED, NOT JUST COUNTED. This used to report every stranded row
        // as "an Event_ID that has come apart from its session" and send the
        // office to Repair Dashboard Links. That is right for one of the two
        // cases and wrong for the other, which is the commoner one — and on a
        // program holding two forms the wrong advice repoints a live link at
        // the empty twin (see the fork warning in `32`). So the breakdown
        // decides the sentence.
        const stranded = describeStrandedRegistrantRows_(entry, registrantRows, sessionRows);
        if (stranded.total > 0) {
          log(`⚠️ Program registrant sheet for ${programKey}: ${stranded.total} registrant row(s) name ` +
            `this program but match no session (${stranded.withSession} with a session that day, ` +
            `${stranded.withoutSession} without), so the sheet is empty.`);
          noteForAdmin('Program registrant sheets that came out empty',
            `"${entry.title}" (${entry.location}) — the Registrants tab holds ${stranded.total} row(s) ` +
            `for this program, but none of them reached the leader's sheet, so it says nobody has ` +
            `signed up. ` + describeStrandedRepair_(stranded));
        }
        // NOT WRITTEN when EVERY one of those rows missed a session: that is
        // the program's sessions being absent from the table, not the program
        // having nobody on it, and an empty roster over the leader's last
        // good one is the worse of the two answers. The sheet keeps what it
        // had until the sessions are back. (A row that met a session that
        // day and still missed is `46`'s Event_ID drift, which the empty
        // write has always been right about reporting.)
        if (stranded.total > 0 && stranded.withSession === 0) {
          keptStranded++;
          return;
        }
      }
      const fingerprint = computeLeaderSheetFingerprint(entry, rows);
      // NOT OPENED AT ALL when the roster it would write is the one it already
      // holds, the file is already a view-only list, and it was opened once
      // today — which is most sheets, most hours. Leaders are viewers, so
      // nothing on the sheet moves unless this script moves it; the first run
      // of each day still opens it, so the contradiction check below reaches
      // every sheet daily, and the menu's forced refresh is the escape hatch.
      if (!force && entry.pushedFingerprint === fingerprint && entry.viewOnly &&
          entry.checkedOn === todayKey) {
        unchanged++;
        return;
      }
      // Written BEFORE the file is touched, and overwritten by the next sheet's:
      // one property write per sheet. Only an execution that died on this sheet
      // leaves it standing for the next run to find.
      pushState.current = { programKey, title: entry.title || '', location: entry.location || '',
        fileId: entry.fileId, at: new Date().toISOString() };
      writeLeaderSheetPushState_(pushState);
      const file = openSpreadsheetCached(entry.fileId);
      const tab = getOrCreateSheet(file, LEADER_SHEET_TAB_NAME);
      // THE FINGERPRINT IS A CLAIM, AND THIS IS WHERE IT IS CHECKED.
      //
      // Skipping is right when the tab already holds these rows and wrong in
      // exactly one way that never heals on its own: the tab holding the
      // "nobody has signed up yet" placeholder while the fingerprint claims a
      // roster. That pair was reached on a real workbook and cost a program
      // leader an empty sheet for weeks — the push matched the fingerprint,
      // skipped, restamped the banner (which is why the file's modified time
      // kept moving, making it look alive) and never looked at what was on it.
      //
      // One getValue(), on the skip path only, and only when there IS a roster
      // to contradict — so the healthy case pays one cell per sheet per hour
      // and the empty-and-truthfully-empty case pays nothing. Finding the
      // contradiction falls THROUGH to the write below, which is the repair:
      // this is the migration for every sheet already in that state, and it
      // runs itself on the next sync rather than waiting for somebody to press
      // something. See leaderSheetTabReadsEmpty_().
      const content = leaderSheetContentFor(entry, rows);
      const fingerprintAgrees = !force && entry.pushedFingerprint === fingerprint && entry.viewOnly;
      // Against the CLASS LIST, not every row: a program whose only people are
      // waiting shows the placeholder on Sign_Up_Sheet truthfully.
      const contradicted = fingerprintAgrees && content.roster.length > 0 && leaderSheetTabReadsEmpty_(tab);
      if (contradicted) {
        log(`⚠️ Program registrant sheet for ${programKey}: the stored fingerprint claims ` +
          `${rows.length} row(s) but the sheet reads "nobody has signed up yet" — rewriting it.`);
        noteForAdmin('Program registrant sheets that had come apart from their fingerprint',
          `"${entry.title}" (${entry.location}) — this workbook had recorded ${rows.length} roster row(s) ` +
          `as already written, and the shared sheet was showing the leader an empty roster instead. It has ` +
          `been rewritten. Nothing needs doing; the sheet is correct from now on.`);
      }
      // NO RESTAMP: the note says when the roster was last UPDATED, which an
      // unchanged hour leaves true.
      if (fingerprintAgrees && !contradicted) {
        if (entry.checkedOn !== todayKey) {
          saveProgramLeaderSheetRegistryEntry(programKey, Object.assign({}, entry, { checkedOn: todayKey }));
          flushProgramLeaderSheetRegistry_();
        }
        unchanged++;
        return;
      }
      // One line per REWRITE (the skip path stays quiet), so a silent gap in
      // the log is never again unattributable: the last of these names the
      // sheet the run was on.
      log(`Program registrant sheets: rewriting ${position}/${total} — "${entry.title}" ` +
        `(${entry.location}), ${content.roster.length} on the list, ${content.waitlist.length} waiting.`);
      writeProgramLeaderSheetTab(tab, entry, content.roster);
      // Its own guard: the class list has landed, and a Waitlist tab that will
      // not draw must not undo that. The fingerprint is then NOT stored, so the
      // next sync tries the whole sheet again.
      let waitlistWritten = true;
      try {
        writeProgramLeaderWaitlistTab(file, entry, content.waitlist);
      } catch (err) {
        waitlistWritten = false;
        log(`⚠️ Could not draw the Waitlist tab on the program registrant sheet for "${entry.title}" (${err}).`);
      }
      if (waitlistWritten && entry.pushedFingerprint !== fingerprint) {
        saveProgramLeaderSheetRegistryEntry(programKey,
          Object.assign({}, entry, { pushedFingerprint: fingerprint, retired: false, checkedOn: todayKey }));
        // NOW, not at the end of the sync: a run killed at its ceiling reaches
        // no flush, and a fingerprint lost is a sheet rewritten again next hour.
        flushProgramLeaderSheetRegistry_();
      }
      // No re-store on the repair path: the fingerprint it would write is the
      // one already stored — that agreement is what made this a repair. Said
      // here rather than left to be rediscovered from the condition above.
      pushed++;
      // A clean rewrite clears any count against this sheet; the write that
      // carries it is the next sheet's marker (or the one after the loop).
      if (pushState.crashes && pushState.crashes[programKey]) delete pushState.crashes[programKey];
      // ONCE PER SHEET, EVER — not once per hour. Any sheet made before
      // ensureProgramLeaderSheetAccess() existed was shared with its creator and
      // nobody else, which is what stopped this whole round trip working when
      // the syncs moved to another account. Repaired here because this is the
      // pass that proves we can still open it; the flag on the registry entry
      // is what keeps it from being three Drive calls every hour thereafter.
      // ONCE PER SHEET (Nov 2026): the link goes view-only and the program's
      // leaders become viewers — an older sheet had them as editors because
      // their ticks used to come back. Merged onto whatever the fingerprint
      // write above left, not onto the copy this loop started with — two
      // Object.assign()s from the same stale `entry` would each drop the
      // other's field.
      if (!entry.viewOnly) {
        const access = ensureProgramLeaderSheetAccess(file, `program registrant sheet for "${entry.title}"`);
        shareLeaderSheetWithLeadersAsViewers_(file, entry.title, entry.location);
        if (access.openedUp || access.editors.length > 0) {
          saveProgramLeaderSheetRegistryEntry(programKey,
            Object.assign({}, getProgramLeaderSheetRegistry()[programKey] || entry,
              { accessOpened: true, viewOnly: true }));
          flushProgramLeaderSheetRegistry_();
        }
      }
    } catch (err) {
      // NEVER RE-THROWN. The registration sync calls this at the very end, on
      // a settled picture, and a program leader's spreadsheet being unreachable
      // is not a reason to fail a run that has already imported every
      // registration correctly.
      log(`⚠️ Could not refresh the program registrant sheet for "${entry.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be refreshed',
        describeLeaderSheetAccessFailure(entry, programKey, err));
    } finally {
      // The push is the last reader of this file in the execution (the pull
      // ran at the head of the sync); holding ninety of them to the end is
      // memory this run has no use for. See forgetSpreadsheetCached() (08).
      forgetSpreadsheetCached(entry.fileId);
    }
  }
  if (pushed > 0 || unchanged > 0) {
    log(`Program registrant sheets: rewrote ${pushed} shared sheet(s)` +
      (unchanged > 0 ? `, left ${unchanged} unchanged.` : '.'));
  }
  if (quarantined > 0) {
    log(`⚠️ Program registrant sheets: left out ${quarantined} sheet(s) that stopped the sync ` +
      `${LEADER_SHEET_PUSH_MAX_CRASHES} time(s) in a row — they are tried again tomorrow.`);
  }
  if (keptStranded > 0) {
    log(`Program registrant sheets: kept the last roster on ${keptStranded} sheet(s) whose registrants ` +
      `matched no session on the table, rather than writing them empty.`);
  }
  if (mergedAway > 0) {
    log(`Program registrant sheets: left ${mergedAway} sheet(s) as last written — their program is now ` +
      `filed under another name (Program_Settings ▸ Also_Known_As), whose sheet carries its sessions.`);
  }
  if (leaderless > 0) {
    log(`Program registrant sheets: ${leaderless} sheet(s) belong to a program with no leader on ` +
      `Program_Leaders` + (retiredThisRun > 0 ? ` — retired ${retiredThisRun} this run.` : ' and are left retired.'));
  }
  if (lunchSkipped > 0) {
    log(`Program registrant sheets: left ${lunchSkipped} lunch sheet(s) as last written — lunch no ` +
      `longer gets a registrant sheet.`);
  }
  return pushed;
}

/**
 * { programKey: [registrant sheet row, ...] } for every program in the
 * registry's window, built ONCE from the rows the caller already has in hand
 * rather than re-reading either tab per program.
 *
 * A registrant row belongs to a program via its Event_ID, not its Event text:
 * the session table is what knows a session's title and location, and a
 * renamed program's older registrant rows still carry the old title.
 */
function buildLeaderSheetRowsByProgram(sessionRows, registrantRows) {
  const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - LEADER_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + LEADER_SHEET_FORWARD_DAYS * 86400000));

  const programByEventId = {};
  // THE SECOND WAY IN, and the failure it is for. A registrant row reaches its
  // program through its Event_ID and nothing else, which is right — the
  // session table is what knows a session's title and location, and a renamed
  // program's older rows still carry the old title (see the note above). But
  // an Event_ID is DERIVED from the event's clean title, so anything that
  // changes what "clean" means changes it: a title mark read one way today and
  // another way tomorrow ("*Tai Chi", "NO Tai Chi") re-keys every session of
  // that program, and the registrant rows written under the old key then match
  // no session at all. The rows are still on the tab, the sessions are still
  // on the dashboard, and the leader's sheet says "Nobody has signed up yet" —
  // a silent, complete wrong answer, on the one screen that is somebody else's
  // only view of their own class.
  //
  // So a row that cannot find its Event_ID is asked the other question before
  // it is dropped: is there a session of THIS program title, at THIS building,
  // on THIS date? That is the same identity the sheet is keyed on, narrowed by
  // the day, so it can only ever pull in a row that belongs to exactly the
  // program the sheet is about.
  const programByTitleDate = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessionMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessionMap['Event_Date']]);
    if (!date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    const programKey =
      leaderProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]);
    if (eventId) programByEventId[eventId] = programKey;
    programByTitleDate[`${programKey}|${dateKey}`] = programKey;
  });

  const map = getIndexMap(HEADERS.All_Registrants);
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const byProgram = {};
  const partyOf = new Map();

  (registrantRows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const programKey = programByEventId[eventId]
      || leaderProgramByTitleAndDate_(row, map, programByTitleDate);
    if (!programKey) return;
    // Superseded rows are bookkeeping — a registration that a later submission
    // replaced. Showing them would list the same person twice with no way for
    // a program leader to tell which one is real.
    if (String(row[map['Program_Status']] || '').trim() === 'Superseded') return;
    // A cancellation shows for LEADER_SHEET_CANCELLED_SHOW_DAYS, then leaves.
    if (leaderSheetCancellationExpired_(row, map)) return;

    const out = new Array(LEADER_SHEET_HEADERS.length).fill('');
    out[sheetMap['Event_Date']] = row[map['Event_Date']];
    out[sheetMap['Event_Time']] = eventTimeLabelOf(row[map['Event_Time']]);
    out[sheetMap['Location']] = row[map['Location']] || '';
    out[sheetMap['Name']] = row[map['Name']] || '';
    out[sheetMap['Party_Size']] = row[map['Party_Size']] || '';
    out[sheetMap['Phone']] = row[map['Phone']] || '';
    out[sheetMap['Email']] = row[map['Email']] || '';
    out[sheetMap['Program_Status']] = row[map['Program_Status']] || '';
    // In the row, so in the fingerprint: a changed answer redraws the sheet.
    out[sheetMap['Answers']] = map['Form_Answers'] === undefined
      ? '' : leaderSheetAnswersText(row[map['Form_Answers']]);

    if (!byProgram[programKey]) byProgram[programKey] = [];
    byProgram[programKey].push(out);
    partyOf.set(out, {
      eventId,
      partyId: String(row[map['Party_ID']] || '').trim(),
      primary: map['Primary_Registrant'] === undefined ? '' : String(row[map['Primary_Registrant']] || '').trim()
    });
  });

  // One line per PARTY, not per person — see foldLeaderSheetParties_().
  Object.keys(byProgram).forEach(programKey => {
    byProgram[programKey] = foldLeaderSheetParties_(byProgram[programKey], partyOf);
  });

  // Date, then TIME, then name: the order a program leader reads a class list
  // in, and — since writeProgramLeaderSheetTab() bands the sheet by session —
  // the order that makes grouping a single scan rather than a second pass.
  // Time is in the key because a program CAN run twice in a day (a morning and
  // an afternoon sitting of the same class), and sorting on the date alone
  // would interleave the two into one band that belonged to neither.
  Object.keys(byProgram).forEach(programKey => {
    byProgram[programKey].sort((a, b) => {
      // On the DATE KEY, not the Date's milliseconds: a row the desk or the
      // door wrote can carry a time of day on its Event_Date, and comparing
      // instants then sorted two rows of one day apart — which is how the
      // Wills roster for Nov 10 came out banded 10:30, 11:00, 9:30, 10:00,
      // 11:00, 11:30. And the time on the CLOCK, not as text, because
      // "9:30 AM" sorts after "11:00 AM" alphabetically.
      const da = coerceDate(a[sheetMap['Event_Date']]);
      const db = coerceDate(b[sheetMap['Event_Date']]);
      const ka = da ? formatDateKey(da) : '';
      const kb = db ? formatDateKey(db) : '';
      if (ka !== kb) return ka < kb ? -1 : 1;
      const byTime = compareLeaderTimeLabels(a[sheetMap['Event_Time']], b[sheetMap['Event_Time']]);
      if (byTime) return byTime;
      return normalizeNameKey(a[sheetMap['Name']]).localeCompare(normalizeNameKey(b[sheetMap['Name']]));
    });
    if (byProgram[programKey].length > LEADER_SHEET_MAX_ROWS) {
      log(`⚠️ Program registrant sheet for ${programKey} would hold ` +
        `${byProgram[programKey].length} rows — trimmed to ${LEADER_SHEET_MAX_ROWS}.`);
      byProgram[programKey] = byProgram[programKey].slice(0, LEADER_SHEET_MAX_ROWS);
    }
  });

  return byProgram;
}

/**
 * WHY a roster came out empty when the Registrants tab is not — broken down,
 * because the two answers need opposite repairs and were being reported as
 * one.
 *
 * A row that names this program and falls inside the sheet's own window is
 * still missing from the roster for one of two reasons, and the difference is
 * whether a SESSION of this program is on the calendar on that row's date:
 *
 *   • `withSession` — there IS a session that day, so the row should have
 *     joined and did not. That is the Event_ID drift this file's fallback
 *     exists to heal; reaching here means the fallback could not either, which
 *     happens when the SHEET REGISTRY's stored title no longer matches the
 *     session table's Clean_Title (a rename that moved the eight stores in
 *     `22` and not this registry, which is not one of them). Repairing links
 *     is the right advice only here.
 *
 *   • `withoutSession` — there is NO session of this program that day at all.
 *     The row is orphaned from the CALENDAR, not from its session's identity:
 *     the date moved or the event went. Telling somebody to repair dashboard
 *     links sends them to a screen that will find nothing wrong, and on a
 *     program holding two forms it is worse than nothing — see the fork
 *     warning in `32`.
 *
 * Only ever COUNTED, and only when the roster is empty: this decides what the
 * office is told, never what the sheet holds. A row is matched the way a
 * person would match it, on the program's name and building.
 *
 * `sessionRows` is optional. Without it every matching row is returned as
 * `unclassified` and the totals still add up, which is what keeps the old
 * count-only callers honest rather than silently reclassifying their rows.
 */
function describeStrandedRegistrantRows_(entry, registrantRows, sessionRows) {
  const out = { total: 0, withSession: 0, withoutSession: 0, unclassified: 0 };
  const map = getIndexMap(HEADERS.All_Registrants);
  if (map['Event'] === undefined || map['Event_Date'] === undefined) return out;
  const wanted = leaderProgramKey(entry && entry.title, entry && entry.location);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - LEADER_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + LEADER_SHEET_FORWARD_DAYS * 86400000));

  // The same title+building+date index the fallback joins on, so "there is a
  // session that day" cannot mean one thing here and another there.
  let sessionDates = null;
  if (sessionRows) {
    const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
    sessionDates = {};
    sessionRows.forEach(row => {
      const date = coerceDate(row[sessionMap['Event_Date']]);
      if (!date) return;
      const dateKey = formatDateKey(date);
      if (dateKey < from || dateKey > to) return;
      const key = leaderProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]);
      sessionDates[`${key}|${dateKey}`] = true;
    });
  }

  (registrantRows || []).forEach(row => {
    if (String(row[map['Program_Status']] || '').trim() === 'Superseded') return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    const rowKey = leaderProgramKey(row[map['Event']], row[map['Location']]);
    if (rowKey !== wanted) return;
    out.total++;
    if (!sessionDates) out.unclassified++;
    else if (sessionDates[`${rowKey}|${dateKey}`]) out.withSession++;
    else out.withoutSession++;
  });
  return out;
}

/**
 * The sentence the office reads, chosen by which fault actually happened.
 *
 * TWO FAULTS, TWO REPAIRS, and saying the wrong one costs more than saying
 * nothing: "repair the links" on a program whose sessions simply are not on
 * the calendar that day sends somebody to a screen that reports everything
 * healthy, which reads as "the workbook is fine" about a leader staring at an
 * empty roster.
 */
function describeStrandedRepair_(stranded) {
  if (stranded.withSession > 0 && stranded.withoutSession > 0) {
    return `${stranded.withSession} of them fall on a day this program IS running, and ` +
      `${stranded.withoutSession} fall on a day it is not. Do the first one first: ` +
      `run 🔧 Admin ▸ 🩺 Why Is A Roster Sheet Empty? — it names which, and a program holding two ` +
      `forms must NOT be sent through Repair Dashboard Links until the fork is settled.`;
  }
  if (stranded.withSession > 0) {
    return `They fall on days this program IS running, so their Event_ID has come apart from its ` +
      `session. Run 🔧 Admin ▸ 🩺 Why Is A Roster Sheet Empty? first — if it reports this program ` +
      `under a different name than the sessions carry, the sheet registry is stale and rebuilding ` +
      `the sheet fixes it; only otherwise is 🔗 Repair Dashboard Links the answer.`;
  }
  if (stranded.withoutSession > 0) {
    return `None of them falls on a day this program is running — the dates moved or the events ` +
      `went, so this is a CALENDAR question, not a broken link. Check the calendar for those dates ` +
      `before repairing anything; ${SHEET_NAMES.PROGRAM_DASHBOARD} has what the workbook can see.`;
  }
  return `Run 🔧 Admin ▸ 🩺 Why Is A Roster Sheet Empty? for which of the two it is.`;
}

/**
 * How many rows on the Registrants tab name this program and a date inside the
 * sheet's own window — whatever their Event_ID says.
 *
 * The total of the breakdown above, kept as its own name because two callers
 * only ever wanted the number.
 */
function countStrandedRegistrantRows_(entry, registrantRows) {
  return describeStrandedRegistrantRows_(entry, registrantRows, null).total;
}

/**
 * The fallback identity for a registrant row whose Event_ID names no session
 * this window holds — its own program title, building and date, and only when
 * a session answering to all three is on the table. See the banner in
 * buildLeaderSheetRowsByProgram() for the fault this exists for.
 *
 * A lunch-only row's Event is "Lunch @ Narberth — …" and a triaged row's date
 * is outside the window, so neither can be pulled into a program's roster by
 * accident: the key has to match a session that is actually running.
 */
function leaderProgramByTitleAndDate_(row, map, programByTitleDate) {
  const date = coerceDate(row[map['Event_Date']]);
  if (!date) return '';
  const key = `${leaderProgramKey(row[map['Event']], row[map['Location']])}|${formatDateKey(date)}`;
  return programByTitleDate[key] || '';
}

/**
 * Groups a program's rows into the sessions they belong to, in the order they
 * are already sorted into.
 *
 * A "session" is one date at one time — see the sort in
 * buildLeaderSheetRowsByProgram() for why the time is part of that and not
 * just the date. Rows arrive grouped already, so this is a single scan rather
 * than a bucket-and-re-sort: the grouping cannot disagree with the order the
 * rows are written in, which is the drift that would put a band above the
 * wrong people.
 *
 * Each group carries the counts its band reports. They are counted HERE, off
 * Program_Status, rather than being read back off the sheet: the numbers a
 * band states have to be the system's own answer, because the four tick
 * columns beside them are the leader's answer and a band mixing the two would
 * be telling them their own marks back as though the workbook had decided them.
 */
function groupLeaderSheetRowsBySession(rows, sheetMap) {
  const groups = [];
  let current = null;

  (rows || []).forEach(row => {
    const date = coerceDate(row[sheetMap['Event_Date']]);
    const dateKey = date ? formatDateKey(date) : '';
    const timeLabel = String(row[sheetMap['Event_Time']] || '');
    const sessionKey = `${dateKey}|${timeLabel}`;

    if (!current || current.sessionKey !== sessionKey) {
      current = {
        sessionKey, date, timeLabel,
        rows: [], active: 0, waitlisted: 0, cancelled: 0
      };
      groups.push(current);
    }
    current.rows.push(row);

    const status = String(row[sheetMap['Program_Status']] || '').trim();
    if (status === 'Waitlisted') current.waitlisted++;
    else if (status === 'Cancelled') current.cancelled++;
    else current.active++; // Active, and anything a hand-added desk row left blank
  });

  return groups;
}

/**
 * What one session's band says: when it is, and how it stands.
 *
 * Only the counts that are NOT zero are named. "6 signed up · 0 waitlisted ·
 * 0 cancelled" on every band of a twelve-week class is three facts of which
 * two are noise, repeated twelve times, and the one number that matters stops
 * standing out. A waitlist that exists is worth a word; one that does not is
 * worth nothing.
 */
function leaderSheetSessionBandLabel(group) {
  const when = group.date ? formatDateLabel(group.date) : 'Date not set';
  const parts = [group.timeLabel ? `${when} · ${group.timeLabel}` : when];
  parts.push(`${group.active} signed up`);
  if (group.waitlisted > 0) parts.push(`${group.waitlisted} waitlisted`);
  if (group.cancelled > 0) parts.push(`${group.cancelled} cancelled`);
  return parts.join('  ·  ');
}

/**
 * Draws one shared sheet: banner, header, and a band per session with its
 * roster under it. A view-only list since Nov 2026: nothing on it is read back.
 *
 * ONE setValues AND ONE setBackgrounds for the whole block, bands included.
 * The obvious shape — write each session, then style it — is a handful of API
 * calls per session, and a leader with a year of weekly classes has fifty of
 * them. That was slow enough on a real roster to push the hourly sync toward
 * its execution limit, which is a strange way to lose a registration import.
 */
/**
 * The banner note, and everything a program leader is told by it.
 *
 * Written by the full redraw only, so it says when the roster was last
 * UPDATED. The time is not in the fingerprint, or no two hours would match.
 */
function leaderSheetBannerNote() {
  const stamp = Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), "EEE d MMM 'at' h:mm a");
  return `Last updated ${stamp}. This list is checked every hour and rewritten whenever the roster changes.\n\n` +
    `Each class has its own blue band. Everybody waiting is on the Waitlist tab.\n\n` +
    `This sheet is view-only. To change a registration, contact the office.`;
}

/**
 * THE ONE WRITER, TWO WAYS OF PAINTING IT (`99zk`). The Sheets API path sends
 * this sheet's formatting as two batchUpdates instead of ~190 calls; it returns
 * false when it is switched off, unavailable or failed, and the sheet is then
 * painted exactly as it always was. Both paint the same sheet —
 * tests/sheets_batch_golden.test.js compares them cell for cell.
 */
function writeProgramLeaderSheetTab(sheet, entry, rows) {
  if (writeProgramLeaderSheetTabViaSheetsApi_(sheet, entry, rows)) return;
  writeProgramLeaderSheetTabLegacy_(sheet, entry, rows);
}

/**
 * The grid to write, and — built in the same pass — where the bands landed and
 * which stretches of it are registrants. Shared by both painters so the layout
 * is decided in exactly one place.
 */
function leaderSheetGridLayout_(rows, map, numCols) {
  const grid = [];
  const bandRowNumbers = [];
  const runs = [];
  groupLeaderSheetRowsBySession(rows, map).forEach(group => {
    const band = new Array(numCols).fill('');
    band[map['Event_Date']] = leaderSheetSessionBandLabel(group);
    bandRowNumbers.push(MEMORY_TAB_DATA_ROW + grid.length);
    grid.push(band);

    runs.push({ start: MEMORY_TAB_DATA_ROW + grid.length, count: group.rows.length });
    group.rows.forEach(row => grid.push(row));
  });
  return { grid, bandRowNumbers, runs };
}

/** The sheet's top line: the program and where it runs. */
function leaderSheetBannerText_(entry) {
  return `👩‍🏫 ${entry.title || 'Program'} — ${entry.location || ''}`;
}

function writeProgramLeaderSheetTabLegacy_(sheet, entry, rows) {
  const headers = LEADER_SHEET_HEADERS;
  const numCols = headers.length;
  const map = getIndexMap(headers);

  // Everything after this works off the layout, so it is decided exactly once
  // — and decided BEFORE the sheet is touched, because it is also what the
  // early write lands.
  const { grid, bandRowNumbers, runs } = leaderSheetGridLayout_(rows, map, numCols);

  const bannerText = leaderSheetBannerText_(entry);

  // WRITE BEFORE CLEARING. This is somebody else's live roster: a run killed
  // between a clear() and the rows' write left a leader holding a link to an
  // empty sheet — the "Nobody has signed up yet" this file's banner spends a
  // page on. The banner, the header and every row now land in one call first.
  // See 99u_write_before_clear.gs.
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  writeTabValuesBeforeRender_(sheet, [
    { row: MEMORY_TAB_BANNER_ROW, values: [[bannerText]] },
    { row: MEMORY_TAB_HEADER_ROW, values: [headers.slice()] },
    { row: MEMORY_TAB_DATA_ROW, values: rows.length === 0 ? [[LEADER_SHEET_EMPTY_ROSTER_TEXT]] : grid }
  ]);
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());

  // The program and where it runs. The refresh stamp and the "tick the
  // yellow columns" instruction are a note: this sheet goes to a program leader
  // who reads the top line to check they have opened the right one, and a
  // heading that is three facts joined by bullets is not a top line.
  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols, bannerText,
    { note: leaderSheetBannerNote() });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);
  if (rows.length === 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1)
      .setValue(LEADER_SHEET_EMPTY_ROSTER_TEXT)
      .setFontStyle('italic')
      .setFontColor(TYPO.MUTED.color);
    freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
    autosizeColumns(sheet, { minCols: numCols, force: true });
    freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, numCols));
    return;
  }

  // Before the values, never after — a bare "10:00 AM" that Sheets is
  // allowed to read as a time stops being those words. See stampTextColumns().
  stampTextColumns(sheet, [map['Event_Time'] + 1], MEMORY_TAB_DATA_ROW, grid.length);
  sheet.getRange(MEMORY_TAB_DATA_ROW, 1, grid.length, numCols).setValues(grid);

  // Zebra on the registrant rows, the band wash on the bands, in ONE write.
  // A band row is not part of the stripe sequence — striping straight through
  // them puts an arbitrary light/dark boundary on a row that is supposed to
  // BE the boundary.
  const bandRowSet = {};
  bandRowNumbers.forEach(r => { bandRowSet[r] = true; });
  const backgrounds = [];
  let stripe = 0;
  for (let i = 0; i < grid.length; i++) {
    const rowNumber = MEMORY_TAB_DATA_ROW + i;
    if (bandRowSet[rowNumber]) {
      backgrounds.push(new Array(numCols).fill(LEADER_SHEET_BAND_BG));
      stripe = 0; // each class starts its own stripe sequence, so week two looks like week one
    } else if (isLeaderSheetWaitlistedRow(grid[i], map)) {
      // The wash replaces the stripe rather than sitting under it — a row that
      // is half zebra and half peach reads as a rendering fault. It still
      // COUNTS as a stripe, so the rows either side of it keep alternating and
      // the band does not appear to skip a beat. See LEADER_SHEET_WAITLIST_BG.
      backgrounds.push(new Array(numCols).fill(LEADER_SHEET_WAITLIST_BG));
      stripe++;
    } else {
      backgrounds.push(new Array(numCols).fill(stripe % 2 === 0 ? PALETTE.PAPER : PALETTE.STRIPE));
      stripe++;
    }
  }
  sheet.getRange(MEMORY_TAB_DATA_ROW, 1, grid.length, numCols).setBackgrounds(backgrounds);

  // ============================================================================
  // EVERYTHING BELOW IS A RangeList, NOT A LOOP.
  //
  // This sheet is banded per SESSION, so a weekly class running a year is fifty
  // bands and fifty runs between them — and each of those used to cost four
  // calls for the band row and, per run, two number formats, a wash per
  // leader-owned column and two calls per tick box. Two hundred round trips
  // against SOMEBODY ELSE'S spreadsheet, hourly, per program.
  //
  // getRangeList() applies one setter to many ranges in a single call, which is
  // exactly the shape of every one of those loops: the same format, the same
  // rule, the same colour, on one column of every run. So the per-run loop is
  // gone and what is left is one call per ATTRIBUTE — a number that does not
  // grow with the number of sessions on the sheet.
  // ============================================================================
  const columnA1 = (column, list) => (list || runs)
    .map(run => sheet.getRange(run.start, column, run.count, 1).getA1Notation());
  const rangeListFor = (column, list) => {
    const a1 = columnA1(column, list);
    return a1.length > 0 ? sheet.getRangeList(a1) : null;
  };

  // The one loud cell on the row, written after the wash it sits on.
  const waitlistRows = [];
  for (let i = 0; i < grid.length; i++) {
    if (bandRowSet[MEMORY_TAB_DATA_ROW + i] || !isLeaderSheetWaitlistedRow(grid[i], map)) continue;
    waitlistRows.push({ start: MEMORY_TAB_DATA_ROW + i, count: 1 });
  }
  const waitlistInk = rangeListFor(map['Program_Status'] + 1, waitlistRows);
  if (waitlistInk) waitlistInk.setBackground(LEADER_SHEET_WAITLIST_INK).setFontWeight('bold');

  if (bandRowNumbers.length > 0) {
    const bandRows = bandRowNumbers.map(r => ({ start: r, count: 1 }));
    const wholeBand = sheet.getRangeList(bandRows.map(b =>
      sheet.getRange(b.start, 1, 1, numCols).getA1Notation()));
    wholeBand.setFontWeight('bold')
      .setFontColor(LEADER_SHEET_BAND_INK)
      .setVerticalAlignment('middle');
    // OVERFLOW, not wrap: the label is longer than the Event_Date column and
    // is meant to run across the blank cells beside it. Wrapping would fold it
    // into a three-line cell and push the band to triple height.
    const bandLabels = rangeListFor(1, bandRows);
    if (bandLabels) bandLabels.setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
    // Row heights are the one thing with no range-list form — a height belongs
    // to a row, not to a range — so the bands keep a call apiece.
    bandRowNumbers.forEach(rowNumber => {
      try { sheet.setRowHeight(rowNumber, ROW_HEIGHTS.BANNER); } catch (err) { /* row may not exist yet */ }
    });
  }

  if (runs.length > 0) {
    const dates = rangeListFor(map['Event_Date'] + 1);
    if (dates) dates.setNumberFormat(DATE_DISPLAY_FORMAT);
    const sizes = rangeListFor(map['Party_Size'] + 1);
    if (sizes) sizes.setNumberFormat('0');
    // One question per line — wrapped, or the lines collapse into one.
    const answers = rangeListFor(map['Answers'] + 1);
    if (answers) answers.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  }

  // Warning-only, like everywhere else in this project: a program leader who
  // really must correct a misspelled name should be told it will be
  // overwritten, not stopped and left with no way to say so.
  //
  // ONE ZONE covering the bands as well as the rows, rather than one per run.
  // protectDerivedColumns() creates a protection per column per zone, and a
  // year of weekly classes is fifty zones — four hundred protection objects on
  // a sheet holding one class list, built one API call at a time. The bands
  // being protected too costs nothing: their derived cells are blank and
  // nobody types in them.
  protectDerivedColumns(sheet, headers, LEADER_SHEET_DERIVED_COLUMNS,
    [{ start: MEMORY_TAB_DATA_ROW, count: grid.length }]);

  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  autosizeColumns(sheet, { minCols: numCols, force: true });
  freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, numCols));
}


// --- creating and sharing one ------------------------------------------------

/**
 * The Drive folder these sheets are filed in — inside the folder the workbook
 * lives in, renaming the one they used to live in rather than creating a
 * second beside it. Both halves are getOrCreateSystemFolder()'s (`82`): the
 * legacy name is passed to it, and it renames and adopts what it finds.
 *
 * Every existing sheet is reached by fileId out of the registry, so nothing
 * would BREAK if this made a new folder — the old files would just sit in a
 * folder named after a word this project no longer uses, with new ones
 * arriving somewhere else, and the only person who ever noticed would be
 * whoever went looking for a sheet a year from now. Renaming costs one Drive
 * call on the first pass after the rename and none afterwards.
 */
function getOrCreateProgramLeaderSheetFolder() {
  return getOrCreateSystemFolder(LEADER_SHEET_FOLDER_NAME, LEGACY_LEADER_SHEET_FOLDER_NAMES);
}

/**
 * OPENS THE SHEET UP so that everyone who has to touch it can.
 *
 * THE FAILURE THIS EXISTS FOR. A program registrant sheet is created by whoever
 * clicked the menu item — a real person, signed in as themselves — and it is
 * then read and written every hour by whoever owns the triggers, which is
 * routinely a DIFFERENT account. Drive shares a new file with its creator and
 * nobody else, so the hourly sync opens it, is refused, and the sheet silently
 * stops round-tripping: the leader's ticks never come back into the
 * workbook, and the workbook's rows never go out to the program leader. Both sides
 * carry on looking like they are working.
 *
 * Three things are done about it here, cheapest first:
 *
 *   THE ADMINS AND THE TRIGGER OWNER are added as editors by name, so the
 *     accounts that actually run this system can always open the file.
 *   ANYONE WITH THE LINK CAN EDIT. This is a roster of first names, times and
 *     ticks, handed to program leaders who are not in the organization's directory
 *     and who should not have to have accounts at all — and the alternative,
 *     in practice, is a sheet nobody can open and a feature nobody uses. Low
 *     security here is a deliberate trade, not an oversight. Anybody who wants
 *     it narrowed can change the sharing on the file itself; nothing below
 *     forces it open again except the run that creates it.
 *   EVERY PART OF IT IS GUARDED separately and none of it can throw. A sheet
 *     that cannot be shared is still a sheet — with a link somebody can share
 *     by hand — and losing the roster over a Drive permission error is a far
 *     worse outcome than an unshared file.
 *
 * Returns { openedUp, editors, problems } for the caller to report; never
 * throws.
 */
function ensureProgramLeaderSheetAccess(file, describe) {
  if (!file) return { openedUp: false, editors: [], problems: [] };
  // VIEW, not edit (Nov 2026): the sheet is a list nobody types in.
  return openUpFileToAnyoneWithLink(file.getId(), describe || 'program registrant sheet',
    { linkPermission: 'view' });
}

/**
 * The program's leaders as VIEWERS of its sheet. A leader who is an editor
 * (every sheet made before Nov 2026) is taken off the editors first; an
 * address that is also one of the accounts that run this system is left as it
 * is. Quiet unless opts.notify, like the editors. Never throws.
 */
function shareLeaderSheetWithLeadersAsViewers_(file, title, location, opts) {
  const shared = [];
  let driveFile;
  try {
    driveFile = DriveApp.getFileById(file.getId());
  } catch (err) {
    log(`ℹ️ Could not open the program registrant sheet for "${title}" in Drive to share it (${err}).`);
    return shared;
  }
  const system = systemEditorEmails_();
  let editors = [];
  try {
    editors = driveFile.getEditors().map(u => String(u.getEmail() || '').trim().toLowerCase());
  } catch (err) { /* unknown: add as viewers and let Drive sort it out */ }
  getProgramLeaderEmailsForProgram(title, location).forEach(email => {
    const lower = String(email || '').trim().toLowerCase();
    if (!lower || system.indexOf(lower) !== -1) return;
    try {
      if (editors.indexOf(lower) !== -1) driveFile.removeEditor(email);
      // A NEW sheet tells its leader (Drive's own "shared with you" mail is
      // how they learn the link); the one-off downgrade of an old one does not.
      if (opts && opts.notify) { driveFile.addViewer(email); shared.push(email); }
      else if (addViewerWithoutNotifying_(driveFile, email)) shared.push(email);
    } catch (err) {
      log(`⚠️ Could not share the program registrant sheet for "${title}" with ${email} (${err}).`);
      noteForAdmin('Program registrant sheets that could not be shared',
        `"${title}" (${location}) could not be shared with ${email} — ${err}. Anyone with its link can ` +
        `view it, so sending them the link by hand works.`);
    }
  });
  return shared;
}

/** Adds a viewer without Drive mailing them, falling back to DriveApp. See addEditorWithoutNotifying_(). */
function addViewerWithoutNotifying_(driveFile, email) {
  const address = String(email || '').trim();
  if (!address) return false;
  try {
    if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.insert) {
      Drive.Permissions.insert(
        { role: 'reader', type: 'user', value: address },
        driveFile.getId(),
        { sendNotificationEmails: false, supportsAllDrives: true });
      return true;
    }
  } catch (err) {
    log(`ℹ️ Drive would not add ${address} as a viewer quietly (${err}) — falling back to DriveApp.`);
  }
  try {
    driveFile.addViewer(address);
    return true;
  } catch (err) {
    return false;
  }
}

/** The accounts that run this system, lower-cased: named editors of everything it makes. */
function systemEditorEmails_() {
  return dedupePreservingOrder(listAuthorizedAdminEmails()
    .concat([getTriggerOwner(), getCurrentUserEmail()])
    .concat(getAllAdminNotificationEmails())
    .map(e => String(e || '').trim().toLowerCase())
    .filter(e => e.indexOf('@') > 0));
}

/**
 * Adds an editor WITHOUT Drive mailing them about it.
 *
 * THE FAILURE IT PREVENTS. DriveApp.addEditor() always sends a "X shared a
 * spreadsheet with you" notification, and this function runs on every sync
 * against every generated file. The office accounts that are named editors of
 * everything this workbook makes were getting one of those per file per run —
 * hundreds of mails saying nothing they did not already know.
 *
 * The Drive advanced service is the only way to say "share, but do not mail":
 * sendNotificationEmails is not exposed on DriveApp. If it is not enabled, or
 * the call fails for any reason other than the permission already existing, we
 * fall back to DriveApp so the SHARING still happens — a noisy share beats a
 * file the office cannot open.
 *
 * Returns true if the address ended up an editor, false if Drive refused.
 * Never throws.
 */
function addEditorWithoutNotifying_(driveFile, email) {
  const address = String(email || '').trim();
  if (!address) return false;
  try {
    if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.insert) {
      Drive.Permissions.insert(
        { role: 'writer', type: 'user', value: address },
        driveFile.getId(),
        { sendNotificationEmails: false, supportsAllDrives: true });
      return true;
    }
  } catch (err) {
    // Already an editor, the owner, or a Workspace policy saying no — all of
    // which DriveApp reports the same way. Fall through and let it try.
    log(`ℹ️ Drive would not add ${address} quietly (${err}) — falling back to DriveApp.`);
  }
  try {
    driveFile.addEditor(address);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * THE SHARING THIS SYSTEM NEEDS ON EVERY FILE IT OWNS AND LATER HAS TO READ
 * BACK: the accounts that run it as named editors, and anyone with the link
 * able to edit.
 *
 * WHY IT IS THE SAME ANSWER FOR A FORM AS FOR A PROGRAM REGISTRANT SHEET. Both are
 * created by whoever clicked the menu item — a real person, signed in as
 * themselves — and both are read and written every hour by whoever owns the
 * triggers, which is routinely a DIFFERENT account. Drive gives a new file to
 * its creator and nobody else, so the hourly run opens it, is refused, and the
 * work silently stops: a program leader's ticks never come back, or a form's
 * registrations are never imported. Nothing in either case looks broken.
 *
 * LOW SECURITY HERE IS A DELIBERATE TRADE. A registration form is a public
 * sign-up page and a program registrant sheet is a roster of first names and ticks;
 * the alternative, in practice, is a file nobody can open and a feature nobody
 * uses. Anybody who wants it narrowed can change the sharing on the file
 * itself — nothing re-opens it except a run that touches it again.
 *
 * NEVER THROWS. A file that cannot be shared is still a file, and losing a
 * form or a roster over a Drive permission error is far worse than an unshared
 * one. Returns { openedUp, editors, problems } for a caller that wants to say
 * what happened.
 */
function openUpFileToAnyoneWithLink(fileId, describe, opts) {
  const outcome = { openedUp: false, editors: [], problems: [] };
  if (!fileId) return outcome;
  const label = describe || `file ${fileId}`;
  // TWO INDEPENDENT OPTIONS, both used by `89`'s sweep.
  //
  // `folder: true` says how to FETCH: a folder id has to go through
  // getFolderById(), because getFileById() throws outright on one — which
  // would report every folder as unreachable rather than sharing it.
  //
  // `linkSharing` says how far to OPEN, and defaults to the file's own answer:
  // on for a file (the trade this function's banner argues), off for a folder,
  // because a link-editable folder hands over everything inside it, now and in
  // future. It is passed explicitly for the one file kind that must stay shut:
  // a form IMAGE (`55`), whose bytes are copied INTO the form rather than read
  // from Drive — "a photo put on a public form is not a Drive file made
  // public" is a promise that file makes, and the named editors are all the
  // syncing account needs to read its blob.
  const isFolder = !!(opts && opts.folder);
  const wantsLinkSharing = opts && opts.linkSharing !== undefined
    ? !!opts.linkSharing
    : !isFolder;

  let driveFile = null;
  try {
    driveFile = isFolder ? DriveApp.getFolderById(fileId) : DriveApp.getFileById(fileId);
  } catch (err) {
    // Almost always "you do not have permission" — i.e. we are already the
    // account that cannot reach it, and there is nothing to do from here. The
    // repair has to be run by an account that CAN, which is what the admin
    // menu item exists for (see openUpAllFormSharing()).
    outcome.problems.push(`could not be reached in Drive (${err})`);
    log(`ℹ️ Could not open the ${label} in Drive to check its sharing (${err}).`);
    return outcome;
  }

  // The people this system runs as. Named editors survive a link-sharing
  // setting later being tightened by hand, which is the point of doing both.
  // Every address on Config's Admin Notification Emails table joins the
  // accounts that run this system as a named editor, whatever it is ticked
  // for: the office asked to be on everything shared out of the workbook, this
  // is standing access to a file rather than mail, and a named editor survives
  // the link sharing below being tightened by hand later. An empty table means
  // nobody extra (see getAllAdminNotificationEmails).
  const wanted = systemEditorEmails_();
  // QUIETLY. These addresses are added again on every run, so a notification
  // per file per run is hundreds of mails telling the office nothing it does
  // not already know. See addEditorWithoutNotifying_().
  wanted.forEach(email => {
    if (addEditorWithoutNotifying_(driveFile, email)) {
      outcome.editors.push(email);
    } else {
      // Adding yourself, adding the owner, or a Workspace policy saying no.
      // None of those is worth a line in the admin digest.
      log(`ℹ️ Could not add ${email} as an editor of the ${label}.`);
    }
  });

  if (!wantsLinkSharing) return outcome;

  try {
    // `linkPermission: 'view'` for a file people only read (a program
    // registrant sheet, `46`); edit otherwise.
    const permission = opts && opts.linkPermission === 'view'
      ? DriveApp.Permission.VIEW : DriveApp.Permission.EDIT;
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, permission);
    outcome.openedUp = true;
  } catch (err) {
    outcome.problems.push(`link sharing could not be turned on (${err})`);
    log(`⚠️ Could not open the ${label} to anyone with the link (${err}).`);
  }
  return outcome;
}

/**
 * MENU ACTION: open every registration form (and the template behind them) to
 * anyone with the link, and add the accounts that run this system as editors.
 *
 * THE FAILURE IT REPAIRS. Forms are created by whoever pressed the menu item
 * and read every hour by whoever owns the triggers. When those are different
 * accounts — which is the normal state of this office — Drive refuses the
 * second one, and the symptom is not an error anybody sees: registrations for
 * that form simply stop arriving on the Registrants tab. Since the sync
 * guards each form separately (see syncRegistrationsInternal()), the rest of
 * the workbook carries on looking perfectly healthy.
 *
 * RUN IT AS THE ACCOUNT THAT OWNS THE FORMS — usually whoever set the system
 * up. An account that cannot reach a file cannot change its sharing either, so
 * running this from the account that is being refused reports the problem
 * rather than fixing it, and says so per form.
 *
 * New forms no longer need this: createRegistrationForm() and
 * createFormFromSpec() open a form up the moment they make it. This is for
 * every form that already exists.
 */
function openUpAllFormSharing() {
  if (!requireAuthorizedAdmin('Open Up Form Sharing')) return 0;
  if (!confirmConsequentialAction('Open up the registration forms?',
    'Every registration form this workbook knows about is set to "anyone with the link can edit", and ' +
    'the accounts that run this system are added as editors.\n\nThis is what lets an hourly sync run by ' +
    'one account import registrations from forms created by another. A registration form is a public ' +
    'sign-up page, so the link being open is not a change in who can see it.', true)) {
    return 0;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const map = getIndexMap(HEADERS.All_Program_Sessions);
  const rows = getSectionedRows(registrySheet, HEADERS.All_Program_Sessions, 'Event_ID');
  const formIds = dedupePreservingOrder(rows.map(row => String(row[map['Form_ID']] || '').trim())
    .filter(Boolean));

  // The template too: every form is a copy of it, and a template the syncing
  // account cannot open is a workbook that can never build another form.
  let templateId = '';
  try {
    templateId = getOrCreateTemplateForm().getId();
  } catch (err) {
    log(`ℹ️ Could not reach the form template to open it up (${err}).`);
  }

  const targets = dedupePreservingOrder(formIds.concat(templateId ? [templateId] : []));
  let opened = 0;
  const refused = [];
  targets.forEach(formId => {
    const outcome = openUpFileToAnyoneWithLink(formId,
      formId === templateId ? 'the form template' : `registration form ${formId}`);
    if (outcome.openedUp) opened++;
    else refused.push(formId);
  });

  refused.forEach(formId => {
    noteForAdmin('Forms whose sharing could not be changed',
      `${describeFormLink(formId)} — this account cannot change its sharing, which almost always means ` +
      `it does not own the form. Sign in as the account that created it and run this again.`);
  });
  flushAdminDigest('Form sharing');

  const message = refused.length === 0
    ? `Form sharing opened ✅ — ${opened} form(s) can now be read by every account that runs this system.`
    : `Form sharing opened for ${opened} form(s) ⚠️ — ${refused.length} refused this account. ` +
      `Run it again signed in as whoever created those forms.`;
  toastIfPossible(message);
  log(`openUpAllFormSharing: ${message}`);
  return opened;
}

/**
 * MENU ACTION (via the dialog): make a shared sheet for one program, fill it,
 * and add whoever Program_Leaders names as its leader.
 *
 * Idempotent by program key — pressing it again for a program that already has
 * one refreshes that sheet and returns the SAME link rather than building a
 * second copy nobody would know to share.
 */
function createProgramLeaderSheet(programValue) {
  const parts = String(programValue || '').split('|||');
  const location = String(parts[1] || '').trim();
  // The program's own name, not the one the earliest session happened to
  // carry: a sheet made from an alias's session is still that program's sheet
  // (99zzc), and its file name and heading should say so.
  const title = canonicalProgramTitle(String(parts[0] || '').trim(), location);
  if (!title || !location) throw new Error('Pick a program first.');
  if (!programHasLeader_(title, location)) {
    throw new Error(`"${title}" (${location}) has no leader on Program_Leaders, and only programs with a ` +
      `leader get a registrant sheet. Its registrants are on All_Registrants.`);
  }

  const programKey = leaderProgramKey(title, location);
  const registry = getProgramLeaderSheetRegistry();
  const existing = registry[programKey];

  let file = null;
  if (existing && existing.fileId) {
    try {
      file = SpreadsheetApp.openById(existing.fileId);
    } catch (err) {
      // Registered but gone — trashed by hand, most likely. Build a fresh one
      // rather than failing the action the person actually asked for.
      log(`ℹ️ Registered program registrant sheet for "${title}" could not be opened (${err}) — creating a new one.`);
      removeProgramLeaderSheetRegistryEntry(programKey);
      file = null;
    }
  }

  const isNew = !file;
  if (isNew) {
    file = SpreadsheetApp.create(registrantSheetFileName(title, location));
    // Moved rather than copied: create() drops it in My Drive root, and a
    // folder of these is what keeps them findable a year from now. Through
    // moveDriveFileInto() (`82`) rather than the addFile()/removeFile() pair
    // this used to do inline — that pair throws outright on a shared drive,
    // so on a Workspace setup EVERY new leader sheet stayed in My Drive.
    moveDriveFileInto(DriveApp.getFileById(file.getId()),
      getOrCreateProgramLeaderSheetFolder(),
      `the program leader sheet for "${title}"`);
  } else {
    // An existing file made under an older name. Renamed here — on the menu
    // press, once, rather than on the hourly push — so the folder does not end
    // up half "Sign-Up Sheet — …" and half "Registrant Sheet — …" forever. A
    // Drive that refuses is a cosmetic loss and never the reason this fails.
    const wanted = registrantSheetFileName(title, location);
    try {
      if (file.getName() !== wanted) file.rename(wanted);
    } catch (err) {
      log(`ℹ️ Could not rename the registrant sheet for "${title}" (${err}) — its contents are unaffected.`);
    }
  }

  const entry = {
    fileId: file.getId(),
    title,
    location,
    createdAt: (existing && existing.createdAt) || new Date().toISOString()
  };
  // DELIBERATELY WITHOUT pushedFingerprint, at this point. The entry is
  // registered BEFORE the fill so a timeout mid-write still leaves a findable
  // sheet — and a fingerprint stored before the write it describes is a claim
  // about a tab that may never be written, which is the exact pair
  // pushProgramLeaderSheets() now has to repair. It is stored below, after the
  // write, from the rows that write was given.
  saveProgramLeaderSheetRegistryEntry(programKey, entry);
  flushPersistentRegistries();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.All_Program_Sessions, 'Event_ID');
  const registrantRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID');
  const byProgram = buildLeaderSheetRowsByProgram(sessionRows, registrantRows);

  const tab = getOrCreateSheet(file, LEADER_SHEET_TAB_NAME);
  const writtenRows = byProgram[programKey] || [];
  const content = leaderSheetContentFor(entry, writtenRows);
  writeProgramLeaderSheetTab(tab, entry, content.roster);
  writeProgramLeaderWaitlistTab(file, entry, content.waitlist);
  // THE INVARIANT: NOBODY WRITES THIS TAB WITHOUT RECORDING WHAT THEY WROTE.
  //
  // This function is the project's second writer of the roster tab, and it
  // used to leave the registry entry with no fingerprint at all — so the push
  // an hour later rewrote a sheet that was already correct, and, worse, the
  // registry's fingerprint and the tab's contents were set by two code paths
  // with no stated relationship between them. That is the gap the push's
  // skip path reads as gospel. Stated as one rule instead: the fingerprint on
  // the entry always describes the last write this project made to the tab.
  saveProgramLeaderSheetRegistryEntry(programKey, Object.assign({}, entry, {
    pushedFingerprint: computeLeaderSheetFingerprint(entry, writtenRows)
  }));
  flushPersistentRegistries();
  // A brand-new spreadsheet arrives with an empty "Sheet1" beside ours.
  removeDefaultSheetIfIdle(file, LEADER_SHEET_TAB_NAME);

  // BEFORE the named program leaders, and on every run rather than only the first:
  // this is what keeps the file openable by the account that syncs it, and a
  // sheet created before this existed is repaired the next time somebody
  // presses the menu item. See ensureProgramLeaderSheetAccess().
  const access = ensureProgramLeaderSheetAccess(file, `program registrant sheet for "${title}"`);
  // Merged onto the CURRENT entry, not onto the `entry` this function built —
  // the fingerprint save above is on the registry now and a second assign from
  // the stale copy would drop it. Same trap the push's two saves document.
  const emails = getProgramLeaderEmailsForProgram(title, location);
  const shared = shareLeaderSheetWithLeadersAsViewers_(file, title, location, { notify: isNew });
  if (access.openedUp || access.editors.length > 0) {
    saveProgramLeaderSheetRegistryEntry(programKey,
      Object.assign({}, getProgramLeaderSheetRegistry()[programKey] || entry,
        { accessOpened: true, viewOnly: true, retired: false }));
  }

  log(`Program registrant sheet ${isNew ? 'created' : 'refreshed'} for "${title}" (${location}) — ` +
    `${(byProgram[programKey] || []).length} row(s), shared with ${shared.length} address(es), ` +
    `link sharing ${access.openedUp ? 'on' : 'NOT on'}.`);

  return {
    url: file.getUrl(),
    title,
    location,
    isNew,
    rowCount: (byProgram[programKey] || []).length,
    shared,
    unshared: emails.filter(e => shared.indexOf(e) === -1),
    // Told to the dialog, because "anyone with this link can view it" is
    // exactly what somebody about to paste that link into an email needs to
    // know, and so is the opposite.
    linkSharing: access.openedUp,
    accessProblems: access.problems
  };
}

/**
 * Drops the "Sheet1" a new spreadsheet is born with, once ours exists beside
 * it. Guarded: a sheet somebody has already typed into is left alone, and so
 * is the last remaining sheet in a file (Sheets refuses to delete it anyway).
 */
function removeDefaultSheetIfIdle(file, keepName) {
  file.getSheets().forEach(sheet => {
    if (sheet.getName() === keepName) return;
    if (!/^Sheet\d+$/.test(sheet.getName())) return;
    if (sheet.getLastRow() > 0 || sheet.getLastColumn() > 0) return;
    try { file.deleteSheet(sheet); } catch (err) { /* the only sheet, or in use */ }
  });
}

/**
 * Builds the shared sheet for every program whose leader has ticked
 * Notify_Roster_Changes but who does not have one yet.
 *
 * BEFORE THIS, the tick only turned on the email in section 9d — and that
 * email links to the sheet ("Your sign-up sheet: …") only when one already
 * exists, so a leader who ticked the box on a program nobody had shared yet
 * got a change list with nowhere to click. Somebody on staff still had to
 * notice and run "Program Registrant Sheets" by hand. The tick is the
 * only ask a leader gets to make here, so it is the one this reads.
 *
 * ONLY FOR PROGRAMS THIS WORKBOOK KNOWS (see knownProgramKeys()) — the same
 * guard refreshProgramLeadersTab() applies before trusting a row's Program
 * and Location. A typo'd pair would otherwise build an empty, useless
 * spreadsheet on every sync until somebody noticed and deleted it by hand.
 *
 * Reuses createProgramLeaderSheet() rather than a second way of building one:
 * that function is already idempotent by program key, already fills the
 * sheet from the settled picture, and already shares it with the program's
 * leaders — this only decides WHICH programs it should be called for.
 *
 * Called from syncRegistrationsInternal(), right before pushProgramLeaderSheets()
 * so a sheet created this run is refreshed and access-checked the same pass it
 * is born in rather than waiting an hour. Never throws: reaches outside the
 * workbook, on the same footing as the push and the alert pass either side of
 * it in that function.
 */
/** What one of these spreadsheets is called in Drive. Named for what is on it, not for who reads it. */
/**
 * NO REGISTRANT SHEET FOR A LUNCH (Nov 2026). A lunch-only session is named
 * for its dish ("Lunch @ Narberth — Cheese Lasagna"), so every dish was its
 * own program key and so its own spreadsheet: about 45 of them by November,
 * each built a week ahead and then pushed every hour, with nobody reading
 * them and the digest reporting them "came out empty" several times a day.
 * Lunch already has its own rosters (the lunch dashboard and the lunch
 * sign-in sheet, `45`), and a lunch has no leader to hand one to. So none is
 * built, offered or pushed. A sheet built before this is left exactly where
 * it is: its link still opens, and the pull still reads any mark made on it.
 */
function leaderSheetSkipsProgram_(title) {
  return isLunchOnlyProgramTitle(title);
}

function registrantSheetFileName(title, location) {
  return `Registrant Sheet — ${title} (${location})`;
}

/**
 * How far ahead of a session its program's sheet is built.
 *
 * A week, and the number is a compromise between two failures. Too short and
 * the sheet appears the morning somebody needed it yesterday. Too long — or no
 * horizon at all — and a workbook whose calendar runs eighteen months out
 * builds a spreadsheet for every program it has ever run, tonight, in one
 * execution, against a Drive quota.
 */
const REGISTRANT_SHEET_LEAD_DAYS = 7;

/**
 * How many sheets one sync may create. The hourly pass comes back, so a
 * backlog drains over a few hours instead of one run spending its whole
 * execution budget in SpreadsheetApp.create() — which is the slowest call this
 * project makes — and timing out before it writes the registrations it
 * actually ran to import.
 */
const REGISTRANT_SHEET_MAX_CREATES_PER_RUN = 5;

/**
 * Builds a registrant sheet for every program with a session inside the next
 * REGISTRANT_SHEET_LEAD_DAYS days that does not already have one.
 *
 * Called from the hourly registration sync (27) BEFORE the push, so a sheet
 * created here is filled in on the same run rather than sitting empty for an
 * hour.
 *
 * NEVER THROWS AND NEVER REBUILDS. A program already in the registry is left
 * exactly alone — this decides only whether a sheet EXISTS, and the push
 * beside it decides what is in it. That is what makes a sheet handed out in
 * September still the same file, with the same link and the same marks, in
 * March.
 *
 * Returns how many were created.
 */
function ensureRegistrantSheetsForUpcomingPrograms(ss, sessionRows) {
  const map = getIndexMap(HEADERS.All_Program_Sessions);
  const registry = getProgramLeaderSheetRegistry();

  const today = new Date();
  const todayKey = formatDateKey(today);
  const horizonKey = formatDateKey(
    new Date(today.getTime() + REGISTRANT_SHEET_LEAD_DAYS * 86400000));

  // Soonest session first, so a run that hits the cap builds the sheets that
  // are needed first rather than whichever program sorts earliest by name.
  const wanted = {};
  (sessionRows || []).forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title || !location) return;
    if (leaderSheetSkipsProgram_(title)) return; // a lunch: no registrant sheet (see above)
    if (!programHasLeader_(title, location)) return; // leaders only (Nov 2026)
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < todayKey || dateKey > horizonKey) return;
    const key = leaderProgramKey(title, location);
    if (registry[key] && registry[key].fileId) return; // already has one, for the life of the program
    if (!wanted[key] || dateKey < wanted[key].dateKey) {
      wanted[key] = { title, location, dateKey };
    }
  });

  const keys = Object.keys(wanted).sort((a, b) => wanted[a].dateKey.localeCompare(wanted[b].dateKey));
  let created = 0;
  keys.forEach(key => {
    if (created >= REGISTRANT_SHEET_MAX_CREATES_PER_RUN) return; // the next sync picks the rest up
    const program = wanted[key];
    try {
      createProgramLeaderSheet(`${program.title}|||${program.location}`);
      created++;
      log(`Registrant sheet auto-created for "${program.title}" (${program.location}) — ` +
        `its next session is ${program.dateKey}.`);
    } catch (err) {
      log(`⚠️ Could not auto-create the registrant sheet for "${program.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be auto-created',
        `"${program.title}" (${program.location}) — its next session is ${program.dateKey}, so this ` +
        `workbook tried to build a shared roster for it automatically and could not (${err}). Use ` +
        `"Program Registrant Sheets" on the Admin menu to build it by hand.`);
    }
  });

  if (created > 0 && keys.length > created) {
    log(`${keys.length - created} more registrant sheet(s) are due — the next sync builds them.`);
  }
  return created;
}

function ensureProgramLeaderSheetsForNotifyingLeaders(ss, sessionRows) {
  const leaders = getProgramLeadersWantingAlerts();
  if (leaders.length === 0) return 0;

  const registry = getProgramLeaderSheetRegistry();
  const known = knownProgramKeys(ss, sessionRows);

  const missing = {};
  leaders.forEach(leader => leader.programs.forEach(program => {
    if (registry[program.key] && registry[program.key].fileId) return; // already has one
    if (!known[program.key]) return; // not a program this workbook recognizes
    if (leaderSheetSkipsProgram_(program.title)) return; // a lunch: no registrant sheet
    missing[program.key] = program;
  }));

  const keys = Object.keys(missing);
  let created = 0;
  keys.forEach(key => {
    const program = missing[key];
    try {
      createProgramLeaderSheet(`${program.title}|||${program.location}`);
      created++;
      log(`Registrant sheet auto-created (leader notify) for "${program.title}" (${program.location}) — ` +
        `its leader asked to be notified of roster changes.`);
    } catch (err) {
      log(`⚠️ Could not auto-create the program registrant sheet for "${program.title}" (${err}).`);
      noteForAdmin('Program registrant sheets that could not be auto-created',
        `"${program.title}" (${program.location}) — its leader ticked Notify_Roster_Changes, so this ` +
        `workbook tried to build a shared sheet for it automatically and could not (${err}). Use ` +
        `"Program Registrant Sheets" on the Admin menu to build it by hand.`);
    }
  });

  return created;
}


// --- the menu -----------------------------------------------------------------

/** MENU ENTRY: pick a program, get a shareable live roster. */
function showProgramLeaderSheetDialog() {
  const options = listProgramLeaderProgramOptions();
  if (options.length === 0) {
    toastIfPossible('No programs to share yet — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildProgramLeaderSheetHtml(options))
    .setWidth(560)
    .setHeight(500);
  SpreadsheetApp.getUi().showModalDialog(html, 'Program Registrant Sheets');
}

/**
 * Every program (title x location) with a session in the window, marked with
 * whether it already has a shared sheet and whether Program_Leaders names a
 * leader for it.
 *
 * Both facts are on the option itself so the dialog can say "already shared"
 * and "no leader on file" without a round trip per selection.
 */
function listProgramLeaderProgramOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!dash) return [];

  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - LEADER_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + LEADER_SHEET_FORWARD_DAYS * 86400000));

  const byKey = {};
  getSectionedRows(dash, headers, 'Event_ID').forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!title || !location || !date) return;
    if (leaderSheetSkipsProgram_(title)) return; // a lunch: no registrant sheet
    if (!programHasLeader_(title, location)) return; // leaders only (Nov 2026)
    const dateKey = formatDateKey(date);
    if (dateKey < from || dateKey > to) return;
    const key = leaderProgramKey(title, location);
    if (!byKey[key]) {
      byKey[key] = { key, title: canonicalProgramTitle(title, location), location, sessions: 0, nextDate: null };
    }
    byKey[key].sessions++;
    if (!byKey[key].nextDate || date < byKey[key].nextDate) byKey[key].nextDate = date;
  });

  const registry = getProgramLeaderSheetRegistry();
  return Object.keys(byKey)
    .map(k => byKey[k])
    .sort((a, b) => a.location.localeCompare(b.location) || a.title.localeCompare(b.title))
    .map(entry => {
      const existing = registry[entry.key];
      const emails = getProgramLeaderEmailsForProgram(entry.title, entry.location);
      return {
        value: `${entry.title}|||${entry.location}`,
        title: entry.title,
        location: entry.location,
        label: `${entry.title}  •  ${entry.sessions} session(s), next ${formatDateLabel(entry.nextDate)}` +
          (existing ? '  •  already shared' : '') +
          (emails.length > 0 ? `  •  ${emails.join(', ')}` : '  •  no leader address on Program_Leaders'),
        alreadyShared: !!existing,
        url: existing && existing.fileId ? `https://docs.google.com/spreadsheets/d/${existing.fileId}/edit` : '',
        emails
      };
    });
}

/**
 * MENU ENTRY: read every shared sheet's marks back in, then send the current
 * rosters out again — the same two halves the hourly sync does, for when
 * somebody does not want to wait an hour for them.
 */
function refreshProgramLeaderSheetsNow() {
  // The same lock syncRegistrations() takes: this reads the whole Registrants
  // tab, changes rows in memory and writes it all back, which is exactly the
  // shape that loses data when two runs overlap.
  const lock = workbookLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try again in a moment.');
    return;
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sessionRows = getSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.All_Program_Sessions, 'Event_ID');
    const registrantRows = getSectionedRows(
      getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID');

    // BEFORE THE REGISTRY CHECK BELOW: somebody pressing this — because a
    // program starts on Monday, or because they have just ticked
    // Notify_Roster_Changes — should not have to wait for the hourly sync to
    // get a sheet. Both auto-create passes, in the same order the sync runs
    // them; either may find the other already did it.
    try {
      ensureRegistrantSheetsForUpcomingPrograms(ss, sessionRows);
    } catch (err) {
      log(`⚠️ Could not auto-create the upcoming programs' registrant sheets (${err}).`);
    }
    try {
      ensureProgramLeaderSheetsForNotifyingLeaders(ss, sessionRows);
    } catch (err) {
      log(`⚠️ Could not auto-create registrant sheets for the notifying leaders (${err}).`);
    }

    const registry = getProgramLeaderSheetRegistry();
    if (Object.keys(registry).length === 0) {
      toastIfPossible('No program registrant sheets have been created yet. One is built by itself a week before a ' +
        'program\'s next session — use "Share a Program Registrant Sheet…" to get one sooner.');
      return;
    }

    // Guarded, and not allowed to fail the action: one unreachable sheet used
    // to be able to take the whole refresh down with it. The push already
    // skips a sheet it cannot open; this is the outer guard for everything
    // else (a Drive outage, a quota, a registry entry that is no longer a
    // spreadsheet). Nothing is read back from the sheets since Nov 2026.
    let pushed = 0;
    const failures = [];
    try {
      // FORCED, because this is the escape hatch. The hourly pass skips a sheet
      // whose rows have not moved (see computeLeaderSheetFingerprint), and the
      // reason somebody presses a menu item called "refresh the rosters" is
      // usually that one of them looks wrong — which is the one case a
      // fingerprint cannot see.
      pushed = pushProgramLeaderSheets(sessionRows, registrantRows, { force: true });
    } catch (err) {
      log(`⚠️ Could not push the program registrant sheets out (${err}).`);
      failures.push(`the rosters could not be sent out (${err})`);
    }

    flushAdminDigest('Program registrant sheet refresh');
    const trouble = failures.length === 0 ? '' : ` ⚠️ ${failures.join('; ')}.`;
    toastIfPossible(`Program registrant sheets refreshed ${failures.length === 0 ? '✅' : '⚠️'} — ` +
      `${pushed} sheet(s) rewritten.${trouble}`);
  } finally {
    lock.releaseLock();
  }
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * Location first and then program, matching the sign-in sheet dialog — a flat
 * list of every program at every site reads as noise to somebody who runs one
 * building. The program list is filtered in the BROWSER from a JSON copy, so
 * changing location is instant rather than a round trip.
 */
function buildProgramLeaderSheetHtml(options) {
  const locations = [];
  options.forEach(o => { if (locations.indexOf(o.location) === -1) locations.push(o.location); });
  locations.sort();

  const locationTags = locations
    .map(loc => `<option value="${escapeHtmlForDialog(loc)}">${escapeHtmlForDialog(loc)}</option>`)
    .join('\n');

  // `<` is escaped so a program name containing one can never close the
  // script element early.
  const payload = JSON.stringify(options).replace(/</g, '\\u003c');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
  select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; }
  label { display: block; margin: 12px 0 4px 0; font-weight: bold; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  a { color: #1155CC; }
</style>
<h3>Share a live registrant sheet</h3>
<p class="hint">
  Makes a small view-only spreadsheet in Drive holding just this program's roster at this location,
  and shares it with whoever <b>Program_Leaders</b> names as its leader. Only programs with a leader
  are listed. One sheet per program, not per date — the same link stays right all season. It
  refreshes itself on the hourly registration sync, which also builds one by itself a week before a
  program's next session, so this is for when you want it sooner. Nothing typed on it comes back;
  ticks and changes belong on All_Registrants.
</p>
<label for="location">Location</label>
<select id="location" onchange="fillPrograms()">${locationTags}</select>
<label for="program">Program</label>
<select id="program"></select>
<button id="go" onclick="submit()">Create / refresh sheet</button>
<div id="status"></div>
<script>
  var OPTIONS = ${payload};

  function fillPrograms() {
    var loc = document.getElementById('location').value;
    var sel = document.getElementById('program');
    sel.innerHTML = '';
    var mine = OPTIONS.filter(function (o) { return o.location === loc; });
    mine.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    document.getElementById('go').disabled = mine.length === 0;
    if (mine.length === 0) say('Nothing scheduled at this location in the next few weeks.', 'err');
    else showExisting();
  }

  // A program that already has a sheet gets its link straight away, so
  // "where is that thing I made last month" is answered without pressing
  // anything and re-running the whole build.
  function showExisting() {
    var chosen = current();
    if (chosen && chosen.alreadyShared && chosen.url) {
      var el = document.getElementById('status');
      el.className = '';
      el.innerHTML = 'Already shared — <a href="' + chosen.url + '" target="_blank">open it</a>' +
        '. Pressing the button refreshes it now.';
    } else {
      say('', '');
    }
  }

  function current() {
    var value = document.getElementById('program').value;
    return OPTIONS.filter(function (o) { return o.value === value; })[0] || null;
  }

  function submit() {
    var chosen = current();
    if (!chosen) { say('Pick a program first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Building the sheet…', '');
    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('go').disabled = false;
        if (!res || !res.url) { say('Could not build the sheet.', 'err'); return; }
        var el = document.getElementById('status');
        el.className = 'ok';
        var shared = res.shared.length > 0
          ? 'Shared with ' + res.shared.join(', ') + '.'
          : 'No leader address on file — copy the link and share it yourself, or add a row on ' +
            'the Program_Leaders tab and press this again.';
        var failed = res.unshared.length > 0
          ? '<br>Could not share with ' + res.unshared.join(', ') + '.'
          : '';
        // SAID OUT LOUD: somebody about to paste the link into an email is
        // entitled to know who can open it.
        var link = res.linkSharing
          ? '<br>Anyone with the link can view it.'
          : '<br><b>Link sharing could not be turned on</b>, so only the people named above can open it.';
        el.innerHTML = (res.isNew ? 'Created' : 'Refreshed') + ' — ' + res.rowCount +
          ' row(s). ' + shared + failed + link +
          '<br><a href="' + res.url + '" target="_blank">Open the sheet</a>';
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .createProgramLeaderSheet(chosen.value);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  document.getElementById('program').onchange = showExisting;
  fillPrograms();
</script>`;
}

