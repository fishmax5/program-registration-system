// ============================================================================
// 6c. MEMORY TABS  (Member_Roll / Program_Settings)
// ============================================================================
//
// Everything else in this workbook is derived: wipe it, re-sync, and it comes
// back. These two tabs are the exception — they're where the ORGANIZATION'S
// OWN knowledge accumulates, the things no calendar event or form response can
// tell you. "Marion always brings her sister." "This program needs the big
// room." "Cold lunch only, no dairy."
//
// Each tab is therefore split down the middle:
//   LEFT  — recomputed from the registrant/session history every refresh.
//           Never hand-edit; it will be overwritten.
//   RIGHT — MEMBER_ROLL_STAFF_COLUMNS / PROGRAM_SETTINGS_STAFF_COLUMNS. Written
//           only by people, never by this script. Keyed by Name (or
//           Event+Location), so a row keeps its notes as long as the key is
//           stable — and normalizeNameKey() makes the key survive the casing
//           and spacing drift that "Jane Smith" vs "jane smith " produces
//           across separate form submissions.
//
// This is also what the Quick Mark lists are built from — the unique
// people and programs, deduplicated once here rather than re-derived on every
// keystroke.
// ============================================================================

/**
 * Rebuilds both memory tabs from current data, preserving every staff column.
 * Called at the end of a registration sync (where the source rows are already
 * in memory) and from initSheet().
 */
function refreshMemoryTabs(registrantRows, sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    refreshMemberRoll(ss, registrantRows);
    // Resolved ONCE for the two tabs that want it. Both used to fall back to
    // reading the session table themselves when handed null, which is the
    // whole tab read twice per sync for the same rows.
    const sessions = sessionRows ||
      getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD),
        HEADERS.All_Program_Sessions, 'Event_ID');
    // BEFORE refreshProgramSettings(), and that order is load-bearing on a
    // workbook that has not migrated yet: refreshProgramLeadersTab() carries
    // the old Instructor_Email column onto its own tab, reading it off the
    // live sheet — and the refresh below is the write that finally rewrites
    // that tab without the column. The other way round, every address a site
    // has been keeping is gone before anything reads it. See
    // migrateProgramLeaderAddresses().
    //
    // The two one-time carry-overs that USED to sit between these two lines —
    // Notify_Mode / Reminder_Days off the same sheet, and the whole of the
    // Registrant_Notifications tab — now run INSIDE refreshProgramSettings(),
    // because the tab they are carried onto is the tab they are carried off.
    // The order they need is still the same order, and it is now impossible to
    // get wrong by moving a line: the reads happen before the write, in one
    // function, with the marker set only once the write has landed.
    refreshProgramLeadersTab(ss, sessions);
    refreshProgramSettings(ss, sessions);
  } catch (err) {
    // Never let a memory-tab refresh take down a sync — these tabs are
    // reference material, not the system of record.
    log(`⚠️ Could not refresh the memory tabs (${err}) — the rest of the sync is unaffected.`);
  }
}

/**
 * THE ROLL WRITES BACK: what we know about how to reach somebody, onto the
 * rows that go out of this workbook.
 *
 * Member_Roll's Phone/Email are the newest contact details this person has
 * ever given on any form. A registrant row only ever carries what THAT
 * submission typed — and plenty of rows are made by something that never
 * asked: a club catch-up, an "every date" catch-up, a door sign-in, a guest
 * entered by name. Those rows reached the Registrants tab, the program leader
 * sheets and the sign-in sheets with two empty columns, for people the
 * workbook has had a phone number for all along.
 *
 * So before the Registrants tab is written, every row missing a phone or an
 * email is filled from the roll. Only BLANKS are filled: what somebody typed
 * on their own registration is the better answer for that session, and a
 * staff correction typed into the row is never overwritten by a stale one.
 * Idempotent — the roll is recomputed from these same rows afterwards, so a
 * filled-in row hands back the value it was just given.
 *
 * Mutates the rows in place (they are the array about to be written) and
 * returns how many cells it filled.
 */
function applyMemberRollContacts(registrantRows) {
  if (!registrantRows || registrantRows.length === 0) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rollHeaders = HEADERS.Member_Roll;
  const rollMap = getIndexMap(rollHeaders);
  const roll = readSimpleTableValues(getOrCreateSheet(ss, SHEET_NAMES.MEMBER_ROLL), rollHeaders);
  if (roll.length === 0) return 0;

  const byKey = {};
  roll.forEach(row => {
    const key = normalizeNameKey(row[rollMap['Name']]);
    if (!key) return;
    byKey[key] = {
      phone: String(row[rollMap['Phone']] || '').trim(),
      email: String(row[rollMap['Email']] || '').trim()
    };
  });

  const map = getIndexMap(HEADERS.All_Registrants);
  let filled = 0;
  registrantRows.forEach(row => {
    const known = byKey[normalizeNameKey(row[map['Name']])];
    if (!known) return;
    if (known.phone && !String(row[map['Phone']] || '').trim()) {
      row[map['Phone']] = known.phone;
      filled++;
    }
    if (known.email && !String(row[map['Email']] || '').trim()) {
      row[map['Email']] = known.email;
      filled++;
    }
  });
  if (filled > 0) log(`Member_Roll contact details filled in ${filled} blank registrant cell(s).`);
  return filled;
}

/**
 * One row per unique person, keyed on normalizeNameKey(Name). Recomputes the
 * history columns, carries the staff columns forward untouched, and keeps a
 * person on the roll even after their sessions age out — a member who came
 * once last year is still a member you might want notes on.
 */
function refreshMemberRoll(ss, registrantRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.MEMBER_ROLL);
  const headers = HEADERS.Member_Roll;
  const map = getIndexMap(headers);

  // What staff have already written, by person key.
  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = normalizeNameKey(row[map['Name']]);
    if (key) existingByKey[key] = row;
  });

  const lrHeaders = HEADERS.All_Registrants;
  const lrMap = getIndexMap(lrHeaders);
  const rows = registrantRows ||
    getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), lrHeaders, 'Event_ID');

  // ONE READ OF THE CORRECTIONS for the whole rebuild: a name staff have put
  // right is put right again here, whatever the form response still says.
  const corrections = readMemberNameCorrections();

  const people = {};
  rows.forEach(row => {
    const name = canonicalMemberName(row[lrMap['Name']], corrections);
    const key = normalizeNameKey(name);
    if (!key) return;
    const d = coerceDate(row[lrMap['Event_Date']]);
    if (!people[key]) {
      people[key] = { name, times: 0, first: d, last: d, locations: {}, phone: '', email: '', contactAt: null };
    }
    const p = people[key];
    p.name = name; // last spelling seen wins for DISPLAY; the key stays stable
    p.times++;
    if (d && (!p.first || d < p.first)) p.first = d;
    if (d && (!p.last || d > p.last)) p.last = d;
    // The MOST RECENT contact details they gave, not the first: a phone number
    // is the kind of thing that changes, and the newest one somebody typed on
    // a form is the best guess this tab can make. Rows with no date at all
    // still count, but never displace a dated one.
    const phone = String(row[lrMap['Phone']] || '').trim();
    const email = String(row[lrMap['Email']] || '').trim();
    if ((phone || email) && (!p.contactAt || (d && d >= p.contactAt))) {
      if (phone) p.phone = phone;
      if (email) p.email = email;
      if (d) p.contactAt = d;
    }
    const loc = String(row[lrMap['Location']] || '').trim();
    if (loc) p.locations[loc] = true;
  });

  // Anyone already on the roll but absent from the current history stays,
  // with their computed columns left as they were.
  const entries = [];
  const seen = {};
  Object.keys(people).sort((a, b) => people[a].name.localeCompare(people[b].name)).forEach(key => {
    const p = people[key];
    const row = new Array(headers.length).fill('');
    const prior = existingByKey[key];
    if (prior) MEMBER_ROLL_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
    row[map['Name']] = p.name;
    // Never blank out a number we already had just because the latest
    // submission omitted one — a known way to reach someone is not something
    // to lose to a skipped field.
    row[map['Phone']] = p.phone || (prior ? prior[map['Phone']] : '') || '';
    row[map['Email']] = p.email || (prior ? prior[map['Email']] : '') || '';
    // THE REFRESH DOES NOT RENAME ANYBODY. A correction typed into
    // Display_Name is carried out by handleMemberRollEdit() —> across every
    // tab at once, under a confirmation, with the old spelling remembered
    // (77_households_and_names.gs). Doing it here as well would let a rename
    // happen quietly on the next sync with none of that: the Name column is
    // what All_Registrants, Club_Members and Regular_Needs all match on, and
    // changing it on this tab alone is exactly how a person's history is left
    // behind under their old spelling.
    //
    // The nickname is read from whichever spelling is the fuller one, because
    // that is where a parenthetical usually survives.
    const display = prior ? String(prior[map['Display_Name']] || '').trim() : '';
    row[map['Nickname']] = parseMemberName(display || p.name).nickname ||
      parseMemberName(p.name).nickname;
    row[map['Times_Seen']] = p.times;
    row[map['First_Seen']] = p.first || '';
    row[map['Last_Seen']] = p.last || '';
    row[map['Locations']] = Object.keys(p.locations).sort().join(', ');
    // Merged_From is neither recomputed nor a staff column — it is the dedupe's
    // own receipt (section 77), and a refresh that dropped it would erase the
    // record of every merge the moment the next sync ran.
    if (prior) row[map['Merged_From']] = prior[map['Merged_From']];
    outRows.push(row);
    seen[key] = true;
  });
  Object.keys(existingByKey).forEach(key => {
    if (!seen[key]) outRows.push(existingByKey[key]);
  });

  // Through section 79's writer, not writeMemoryTab() directly: the name
  // split, the dedupe, the retired section and the Status dropdown are what
  // make this a roll of people rather than a list of strings, and every path
  // that writes this tab has to get all four. The household stamp happens
  // inside it, AFTER the dedupe — who shares a telephone number with whom is a
  // fact about the roll as it will be drawn, not as it was read.
  const written = writeMemberRollTab(sheet, outRows);
  log(`Member_Roll refreshed: ${written.active} active, ${written.retired} retired` +
    `${written.merges.length ? `, ${written.merges.length} duplicate row(s) merged` : ''}.`);
}

/**
 * THE HOUSEHOLD COLUMNS, WRITTEN ONTO ROWS THAT ARE ABOUT TO BE DRAWN.
 *
 * Kept apart from the loop above because it cannot be done a row at a time:
 * who shares a phone number with whom is a fact about the whole roll, and the
 * institutional-contact filter (HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN) needs to
 * have seen every row before it can say which details to ignore. Everything
 * about how the grouping is decided lives in 77_households_and_names.gs; this
 * is only where the answer meets the sheet.
 *
 * Rows carried over from a roll that predates these columns pass through with
 * their household cells blank, which reads correctly: not in one.
 */
function stampMemberHouseholds(rows, headers) {
  const map = getIndexMap(headers);
  if (map['Household_ID'] === undefined || map['Household'] === undefined) return;
  const entries = rows.map(row => ({
    key: normalizeNameKey(row[map['Name']]),
    name: String(row[map['Name']] || '').trim(),
    phone: row[map['Phone']],
    email: row[map['Email']],
    override: map['Household_Override'] === undefined ? '' : row[map['Household_Override']]
  }));
  const { byKey } = buildHouseholdAssignments(entries);
  rows.forEach((row, i) => {
    const found = byKey[entries[i].key];
    row[map['Household_ID']] = found ? found.id : '';
    // The OTHER people in it, not a list this row is already the first line
    // of: a cell that reads "Jane Smith, Ray Smith" on Jane's own row is a
    // cell staff have to read twice to learn one fact.
    row[map['Household']] = found
      ? found.members.filter(m => m.key !== entries[i].key).map(m => m.name).join(', ')
      : '';
  });
}

/**
 * The household columns recomputed from the tab AS IT STANDS, without going
 * back to the registrant history — what an edit to Household_Override wants.
 * Ticking a box should not cost a full roll rebuild, and the only input that
 * changed is on this tab already.
 */
function refreshMemberHouseholds(ss) {
  const sheet = getOrCreateSheet(ss || SpreadsheetApp.getActiveSpreadsheet(), SHEET_NAMES.MEMBER_ROLL);
  const headers = HEADERS.Member_Roll;
  const rows = readSimpleTable(sheet, headers);
  if (!rows.length) return 0;
  writeMemberRollTab(sheet, rows);
  return rows.length;
}

/**
 * How Member_Roll is drawn. One definition because it is written from two
 * places now — the refresh above and the door page's own writer
 * (recordWalkInMember()) — and a tab that comes back with a different banner
 * or a different set of tinted staff columns depending on which one touched it
 * last is a tab that looks broken.
 */
function memberRollTabOptions() {
  return {
    banner: '👤 Member Roll',
    bannerNote: 'Everyone who has ever registered for anything, whichever form they came in on. ' +
      'Sorted by last name; retired members are below the divider at the bottom, with their notes intact.',
    staffColumns: MEMBER_ROLL_STAFF_COLUMNS,
    dateColumns: ['First_Seen', 'Last_Seen', 'Retired_Date'],
    numberColumns: ['Times_Seen']
  };
}

/**
 * ONE ROW PER UNIQUE PROGRAM (Event x Location) — how it runs and what it
 * sends — with the same recomputed/staff split every memory tab has.
 *
 * This is two refreshes that used to sit one after the other in
 * refreshMemoryTabs(), over the same session rows, building the same key, for
 * two tabs of the same shape (see HEADERS.Program_Settings). One pass now,
 * which is also the only way the seeding rules below can be stated once.
 *
 * THE ORDER INSIDE HERE IS THE MIGRATION, and it is why the reads are all up
 * front: every one of them looks at a sheet this write is about to overwrite.
 */
function refreshProgramSettings(ss, sessionRows) {
  // Renames an existing workbook's Program_Options tab in place — rows,
  // formatting and Staff_Notes intact. See LEGACY_SHEET_RENAMES.
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_SETTINGS);
  const headers = HEADERS.Program_Settings;
  const map = getIndexMap(headers);

  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = notificationProgramKey(row[map['Event']], row[map['Location']]);
    if (key !== '|') existingByKey[key] = row;
  });

  // --- the three reads that must happen before the write, newest first ------
  //
  // A row's SIX NOTIFICATION ANSWERS come from the first of these that has
  // something to say, and "the row above already has them" is only true once
  // the merge has run: on the very first merged write, `existingByKey` is the
  // old Program_Options tab, whose rows are real and whose tick columns did
  // not exist. Carrying those blanks forward as decisions would silence every
  // program in the workbook on one sync — which is exactly the failure the
  // "a row is never born blank" rule in HEADERS.Program_Settings exists to
  // prevent, arriving through the back door.
  const mergePending = !programSettingsMergeDone();
  const legacyTicks = mergePending ? readLegacyRegistrantNotificationRows(ss) : {};
  const legacyModes = readLegacyNotifyModeRows(ss);

  const regHeaders = HEADERS.All_Program_Sessions;
  const regMap = getIndexMap(regHeaders);
  const rows = sessionRows ||
    getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), regHeaders, 'Event_ID');

  const todayKey = formatDateKey(new Date());
  const programs = {};
  rows.forEach(row => {
    const title = String(row[regMap['Clean_Title']] || '').trim();
    const location = String(row[regMap['Location']] || '').trim();
    if (!title) return;
    const key = notificationProgramKey(title, location);
    const d = coerceDate(row[regMap['Event_Date']]);
    if (!programs[key]) {
      programs[key] = { title, location, sessions: 0, next: null, last: null,
        typeTag: '', caps: {}, isAssistance: false, isClub: false, noRegistration: false };
    }
    const p = programs[key];
    p.sessions++;
    p.typeTag = normalizeTypeTag(row[regMap['Type_Tag']]);
    // ANY assistance session makes the program an assistance program for this
    // purpose: the default that matters is the one that states somebody's
    // appointment time, and it must not depend on which session was read last.
    if (isAssistanceColumnValue(row[regMap['Personalized_Assistance']])) p.isAssistance = true;
    // The other two program flags, read the same way and for the same reason —
    // they are what turn a Type_Tag into one of the six KINDS this tab is now
    // grouped by (see programSettingsGroupOf()). A flag is ticked onto every
    // session row of a program, so any one row saying so is the program saying
    // so; a half-applied tick that has not reached every row yet must not put
    // the program under two headings on consecutive renders.
    if (regMap['Club'] !== undefined && isClubColumnValue(row[regMap['Club']])) p.isClub = true;
    if (regMap['No_Registration'] !== undefined &&
        isNoRegistrationColumnValue(row[regMap['No_Registration']])) {
      p.noRegistration = true;
    }
    if (d) {
      const dk = formatDateKey(d);
      if (dk >= todayKey && (!p.next || d < p.next)) p.next = d;
      if (!p.last || d > p.last) p.last = d;
    }
    const cap = Number(row[regMap['Max_Capacity']]);
    if (cap > 0) p.caps[cap] = (p.caps[cap] || 0) + 1;
  });

  const entries = [];
  const seen = {};
  let seeded = 0;
  let mergedTicks = 0;
  Object.keys(programs)
    .sort((a, b) => programs[a].title.localeCompare(programs[b].title))
    .forEach(key => {
      const p = programs[key];
      const row = new Array(headers.length).fill('');
      const prior = existingByKey[key];
      if (prior) PROGRAM_SETTINGS_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
      if (!prior || mergePending) {
        const from = seedNotificationHalf(row, map, key, legacyTicks, legacyModes, p.isAssistance,
          prior);
        if (from === 'ticks') mergedTicks++;
        if (!prior) seeded++;
      }
      row[map['Event']] = p.title;
      row[map['Location']] = p.location;
      row[map['Type_Tag']] = p.typeTag;
      row[map['Sessions_Tracked']] = p.sessions;
      row[map['Next_Date']] = p.next || '';
      row[map['Last_Date']] = p.last || '';
      // Only SUGGEST a capacity where the calendar is consistent about it —
      // the staff column is theirs to set, so this never overwrites it.
      if (!row[map['Usual_Capacity']]) row[map['Usual_Capacity']] = pickMostFrequent(p.caps);
      entries.push({ row, group: programSettingsGroupOf(p) });
      seen[key] = true;
    });
  // A program the calendar has stopped mentioning keeps its row, its notes and
  // its ticks: it is nearly always a series between terms, and coming back to
  // find the decision gone is worse than a stale row.
  Object.keys(existingByKey).forEach(key => {
    if (seen[key]) return;
    const row = existingByKey[key];
    if (mergePending) {
      if (seedNotificationHalf(row, map, key, legacyTicks, legacyModes, false, null) === 'ticks') {
        mergedTicks++;
      }
    }
    // NO SESSIONS THIS PASS, SO NO KIND TO FILE IT UNDER. What the row's
    // Type_Tag says is what the calendar said when it last ran, and a program
    // between terms is exactly the case where that is out of date — so it goes
    // under one honest heading rather than a guessed one.
    entries.push({ row, group: PROGRAM_SETTINGS_INACTIVE_GROUP });
    seen[key] = true;
  });
  // AND A PROGRAM THAT ONLY THE RETIRED NOTIFICATIONS TAB HAD. The two tabs
  // were built from the same rows and kept their own strays, so they had
  // drifted: a row on one and not the other is precisely the state nothing
  // reported while there were two. Nobody loses a tick box to this merge.
  Object.keys(legacyTicks).forEach(key => {
    if (seen[key]) return;
    const legacy = legacyTicks[key];
    const row = new Array(headers.length).fill('');
    row[map['Event']] = legacy.title;
    row[map['Location']] = legacy.location;
    seedNotificationHalf(row, map, key, legacyTicks, legacyModes, false, null);
    mergedTicks++;
    entries.push({ row, group: PROGRAM_SETTINGS_INACTIVE_GROUP });
    seen[key] = true;
  });

  const grouped = groupProgramSettingsRows(entries, headers);
  const outRows = grouped.rows;

  writeMemoryTab(sheet, headers, outRows, programSettingsTabOptions());

  // The tick boxes and the list run past the last row so the blank line under
  // it has them too (see MEMORY_TAB_SPARE_ROWS). Other_Reminders is an OPEN
  // list — the suggestions are the cadences people ask for, and "21, 10" is
  // still a legal answer.
  applyMemoryTabValidation(sheet, headers, outRows.length, {
    checkboxes: NOTIFICATION_CHECKBOX_COLUMNS,
    openLists: { Other_Reminders: OTHER_REMINDER_SUGGESTIONS }
  });
  // AFTER the validation, never before: applyMemoryTabValidation() puts a
  // checkbox on every row in the band, headings included, and this is what
  // takes them back off. See styleMemoryTabDividers().
  styleMemoryTabDividers(sheet, headers, grouped.dividerOffsets);
  // The tab those settings are read from has just been rewritten; anything
  // asking again in this execution must see the rows as they now stand.
  invalidateNotificationPolicyCache();

  // Both markers, and only now: a marker set before the write would strand
  // every carried-over answer on a sheet that then failed to be written.
  markLegacyNotifyModeMigrationDone(legacyModes, seeded);
  if (mergePending) markProgramSettingsMergeDone(ss, legacyTicks, mergedTicks);

  log(`${SHEET_NAMES.PROGRAM_SETTINGS} refreshed: ${grouped.programCount} program(s) ` +
    `in ${grouped.dividerOffsets.length} group(s).`);
}

/**
 * THE TAB IS GROUPED BY WHAT KIND OF THING THE PROGRAM IS.
 *
 * One row per program, sorted by title, is the right shape for a list and the
 * wrong one for a tab of DECISIONS: a drop-in with no form has no notification
 * to make and no capacity to suggest, an appointment program's confirmation is
 * the only place its time can be stated, and a club's roster carries across
 * months. Alphabetical order interleaves all four, so somebody setting the
 * reminders for the classes has to re-ask, on every row, which kind of thing
 * they are looking at.
 *
 * The six kinds are section 13's (PROGRAM_FORM_TYPES), read off the same four
 * controls everything else resolves them from — so a program is under the same
 * heading here as the review dialog gives it, and there is no seventh
 * vocabulary to keep in step. The seventh heading is not a kind: it is for the
 * programs the calendar has stopped mentioning, whose rows are kept on purpose
 * (see the loop above) and whose Type_Tag is the last thing that was true
 * rather than something that is.
 *
 * The headings are REAL ROWS, so a person scrolling sees them; every reader of
 * a memory tab skips them (isMemoryTabDividerValue), and a group with nothing
 * in it is not drawn.
 */
const PROGRAM_SETTINGS_INACTIVE_GROUP = 'INACTIVE';

/** The heading each group is drawn with, and the order the groups come in. */
function programSettingsGroupLabel(group) {
  if (group === PROGRAM_SETTINGS_INACTIVE_GROUP) {
    return 'Not currently on the calendar (settings kept for when it comes back)';
  }
  const type = getProgramFormType(group);
  return type ? type.label : group;
}

/** Which of section 13's six kinds a program's four controls resolve to. */
function programSettingsGroupOf(program) {
  const type = resolveProgramFormType({
    typeTag: program.typeTag,
    isClub: !!program.isClub,
    noRegistration: !!program.noRegistration,
    isAssistance: !!program.isAssistance
  });
  return type ? type.key : PROGRAM_SETTINGS_INACTIVE_GROUP;
}

/**
 * Entries in, { rows, dividerOffsets, programCount } out — the rows with a
 * heading in front of each non-empty group, and where those headings landed so
 * they can be styled and un-checkboxed afterwards.
 *
 * Within a group the order is the one the tab has always had: by title.
 */
function groupProgramSettingsRows(entries, headers) {
  const map = getIndexMap(headers);
  const order = PROGRAM_FORM_TYPES.map(t => t.key).concat([PROGRAM_SETTINGS_INACTIVE_GROUP]);
  const byGroup = {};
  entries.forEach(entry => {
    const group = order.indexOf(entry.group) === -1 ? PROGRAM_SETTINGS_INACTIVE_GROUP : entry.group;
    if (!byGroup[group]) byGroup[group] = [];
    byGroup[group].push(entry.row);
  });

  const rows = [];
  const dividerOffsets = [];
  let programCount = 0;
  order.forEach(group => {
    const groupRows = byGroup[group];
    if (!groupRows || groupRows.length === 0) return;
    groupRows.sort((a, b) => String(a[map['Event']] || '').localeCompare(String(b[map['Event']] || '')));
    dividerOffsets.push(rows.length);
    rows.push(memoryTabDividerRow(headers, `${programSettingsGroupLabel(group)} (${groupRows.length})`));
    groupRows.forEach(row => { rows.push(row); programCount++; });
  });
  return { rows, dividerOffsets, programCount };
}

/**
 * Fills one row's six notification answers from the first source that has
 * any, and returns which one it was.
 *
 * The order is newest-first, which is also most-deliberate-first: what
 * somebody ticked on the retired notifications tab beats what the dropdown
 * before it said, which beats the program's kind. `prior` is only consulted
 * for its Staff_Notes — see below — because a prior row that HAD ticks would
 * not have reached here (refreshProgramSettings only calls this while the
 * merge is pending or the row is brand new).
 *
 * STAFF_NOTES IS JOINED, NEVER PICKED. Both retired tabs had one, both were
 * typed by hand, and there is no reading of "which of these two sentences did
 * they mean" that is safe to make on somebody's behalf.
 */
function seedNotificationHalf(row, map, key, legacyTicks, legacyModes, isAssistance, prior) {
  const ticks = legacyTicks ? legacyTicks[key] : null;
  if (ticks) {
    NOTIFICATION_CHECKBOX_COLUMNS.forEach(h => { row[map[h]] = !!ticks.values[h]; });
    row[map['Other_Reminders']] = ticks.values['Other_Reminders'] || '';
    const priorNotes = String((prior ? prior[map['Staff_Notes']] : row[map['Staff_Notes']]) || '').trim();
    const theirs = String(ticks.values['Staff_Notes'] || '').trim();
    if (theirs && theirs !== priorNotes) {
      row[map['Staff_Notes']] = priorNotes ? `${priorNotes}\n${theirs}` : theirs;
    }
    return 'ticks';
  }
  if (legacyModes && legacyModes[key]) {
    writeNotificationTicks(row, map, policyFromLegacyCells(legacyModes[key], isAssistance));
    return 'mode';
  }
  writeNotificationTicks(row, map, defaultNotificationPolicy(isAssistance));
  return 'default';
}

/**
 * Is this cell value a ticked checkbox? A Sheets checkbox reads back as a real
 * boolean, but the same column filled in by hand, pasted, or read back through
 * a formula can arrive as "TRUE"/"true"/"Yes"/1 — all of which a human plainly
 * meant as yes, and none of which `=== true` catches.
 */
function isTruthyCheckbox(value) {
  if (value === true) return true;
  if (value === 1) return true;
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === '✓';
}

/**
 * Reads one registrant row's five meal counts and maps them onto the lunch
 * dashboard columns they feed. Returns { total, byDashboardColumn }.
 *
 * THE LEGACY CASE, and why it needs handling rather than ignoring: before this
 * split, a row carried Dine_In_Count/Subs_Count plus a Meals_In_Fridge
 * CHECKBOX that meant "those meals were taken away, not eaten here." Those old
 * columns are read into Day1_Dined_In/Subs_Dined_In by LEGACY_HEADER_ALIASES,
 * which is the right reading for every row where the box was clear. Where it
 * was TICKED, the same numbers meant the opposite, so they are re-routed to
 * the takeaway columns here. Detection is deliberately narrow — an actual
 * boolean, which is what a Sheets checkbox reads back as, and never a number
 * someone has since typed into the same cell as a fridge COUNT.
 */
function readRegistrantMealCounts(row, map) {
  const out = { total: 0, byDashboardColumn: {} };
  const add = (column, amount) => {
    if (!(amount > 0)) return;
    out.byDashboardColumn[column] = (out.byDashboardColumn[column] || 0) + amount;
    out.total += amount;
  };

  const legacyTakeaway = isLegacyFridgeCheckbox(row[map['Meals_In_Fridge']]);
  REGISTRANT_MEAL_COUNT_COLUMNS.forEach(name => {
    if (map[name] === undefined) return;
    const raw = row[map[name]];
    if (name === 'Meals_In_Fridge' && legacyTakeaway) return; // a ticked box is not a count of one
    const amount = Number(raw) || 0;
    if (!(amount > 0)) return;
    let column = MEAL_COUNT_TO_DASHBOARD_COLUMN[name];
    if (legacyTakeaway && name === 'Day1_Dined_In') column = MEAL_COUNT_TO_DASHBOARD_COLUMN.Day1_Taken_Out;
    if (legacyTakeaway && name === 'Subs_Dined_In') column = MEAL_COUNT_TO_DASHBOARD_COLUMN.Subs_Taken_Out;
    add(column, amount);
  });
  return out;
}

/**
 * How many meals ONE registrant row is ordering.
 *
 * BLANK IS ONE. Every row written before Meals_Ordered existed is blank, and
 * every ordinary registration still is — so this reads the workbook's original
 * "one row, one meal" rule out of an empty cell rather than needing a
 * migration to write 1 into a hundred thousand of them.
 *
 * FLOORED AT ONE for a row that is having lunch, because a 0 here would be a
 * second way to say "no meal" and the workbook already has one that everything
 * else reads: Lunch_Status. A row that says Needed and 0 is somebody's typo,
 * and resolving a typo towards a missing meal is the one direction the lunch
 * numbers must never round (see lunchPersonEntry()).
 *
 * Non-numeric text ("four", "2 subs") reads as one for the same reason: the
 * row plainly wants feeding, and the alternative is dropping it.
 */
function readRegistrantMealsOrdered(row, map) {
  if (map['Meals_Ordered'] === undefined) return 1;
  const raw = row[map['Meals_Ordered']];
  const amount = Math.floor(Number(raw) || 0);
  return amount > 1 ? amount : 1;
}

/**
 * Where one registrant row's meals should be counted: { dateKey, location,
 * carried }.
 *
 * Three outcomes, and the third is the one worth being careful about:
 *
 *   BLANK Meal_Source — the row's own date and location, which is what this
 *   workbook has always assumed and what every row written before this column
 *   existed means. `carried` is false.
 *
 *   A Meal_ID that resolves — that batch's date and location. `carried` is
 *   true only when the batch's date differs from the handover's, so naming
 *   today's meal explicitly (which the dropdown makes easy) is not reported as
 *   a carry-over.
 *
 *   AN ORPHAN — a Meal_ID nothing on Lunch_Schedule answers to, because the
 *   menu row was re-dated, retyped or closed after someone pointed at it. The
 *   meals fall back to the row's own day, exactly as if the cell were blank,
 *   and a human is told. They must never be dropped: an unreadable reference
 *   is a reason to ask someone, not to lose a meal that demonstrably happened.
 */
function resolveMealSource(rawSource, meta, row, lrMap) {
  const fallback = { dateKey: meta.dateKey, location: meta.location, carried: false };
  const mealId = String(rawSource || '').trim();
  if (!mealId) return fallback;

  const batch = getMealBatchById(mealId);
  if (!batch) {
    noteForAdmin('Meal_Source points at a meal that no longer exists',
      `${String(row[lrMap['Name']] || '').trim() || '(unnamed)'} on ` +
      `${formatDateLabel(parseDateKey(meta.dateKey))} at ${meta.location} has Meal_Source "${mealId}", ` +
      `which is not on Lunch_Schedule. Their meals are counted under their own date until the ` +
      `reference is corrected — check that menu row's date and type.`);
    return fallback;
  }
  return {
    dateKey: batch.dateKey,
    location: batch.location,
    carried: batch.dateKey !== meta.dateKey
  };
}

/** True only for a real ticked CHECKBOX — the pre-split meaning of Meals_In_Fridge. See readRegistrantMealCounts(). */
function isLegacyFridgeCheckbox(value) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

/** The key with the highest count, or '' for an empty tally. */
function pickMostFrequent(counts) {
  const keys = Object.keys(counts || {});
  if (keys.length === 0) return '';
  return keys.sort((a, b) => counts[b] - counts[a])[0];
}

/**
 * Reads a plain (single header row at row 2, banner at row 1) tab into rows,
 * projected into `headers` order by NAME — so these tabs survive a layout
 * change the same way the sectioned ones do (see buildHeaderProjection()).
 */
function readSimpleTable(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < MEMORY_TAB_DATA_ROW) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const projection = buildHeaderProjection(sheet, MEMORY_TAB_HEADER_ROW, headers, lastCol);
  const numCols = projection ? lastCol : headers.length;
  let rows = getRowsPreservingFormulas(sheet, MEMORY_TAB_DATA_ROW, 1, lastRow - MEMORY_TAB_DATA_ROW + 1, numCols);
  if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));
  // Blank trailing rows are not members. Neither is a divider — Member_Roll's
  // retired line, Program_Settings' kind headings — which is a real row on the
  // sheet so a person can see where one half of the tab stops and the next
  // begins, and which every reader has to skip. See isMemoryTabDividerValue().
  return rows.filter(row => String(row[0] || '').trim() !== '' && !isMemoryTabDividerValue(row[0]));
}

/**
 * readSimpleTable() for a reader that only wants the data: one whole-grid
 * getValues() instead of a header read, a values read and a formulas read.
 * Same reasoning as readAllSectionedRowValues() — see there.
 */
function readSimpleTableValues(sheet, headers) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < MEMORY_TAB_DATA_ROW) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const projection = buildHeaderProjectionFromRow(grid[MEMORY_TAB_HEADER_ROW - 1], headers,
    `"${sheet.getName()}" row ${MEMORY_TAB_HEADER_ROW}`);
  return grid.slice(MEMORY_TAB_DATA_ROW - 1)
    .map(row => (projection ? projection.map(src => (src === -1 ? '' : row[src])) : row.slice(0, headers.length)))
    .filter(row => String(row[0] || '').trim() !== '' && !isMemoryTabDividerValue(row[0]));
}

/**
 * True for a row that is a HEADING rather than a record.
 *
 * Two tabs draw them now — Member_Roll's retired line and Program_Settings'
 * one-per-kind groupings — and a third will want one, so the shape is a
 * convention rather than a constant: a first cell that opens with three
 * hyphens and a space. Nothing a person is called and no program title starts
 * that way, and every reader of a memory tab filters on this, so a divider can
 * never be mistaken for a row with a blank everything.
 */
function isMemoryTabDividerValue(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return false;
  return text.indexOf('--- ') === 0 || isMemberRollDividerValue(text);
}

/**
 * A divider row for `headers`, its words in the first column.
 *
 * Written through here rather than by hand so the marker stays one decision:
 * see isMemoryTabDividerValue() for what makes it recognizable.
 */
function memoryTabDividerRow(headers, label) {
  const row = new Array(headers.length).fill('');
  row[0] = `--- ${String(label || '').trim()} ---`;
  return row;
}

/**
 * Greys and bolds every divider row on a freshly written memory tab, and takes
 * the validation back off it: a heading with a checkbox in it invites somebody
 * to tick a line that is not a program.
 *
 * `offsets` are 0-based positions within the data block.
 */
function styleMemoryTabDividers(sheet, headers, offsets) {
  (offsets || []).forEach(offset => {
    const row = MEMORY_TAB_DATA_ROW + offset;
    if (row > sheet.getMaxRows()) return;
    try {
      const range = sheet.getRange(row, 1, 1, headers.length);
      range.clearDataValidations();
      range.setBackground(PALETTE.DISABLED)
        .setFontWeight('bold')
        .setFontColor(PALETTE.INK_MUTED);
    } catch (err) {
      log(`ℹ️ Could not style a "${sheet.getName()}" divider (${err}) — the tab is otherwise fine.`);
    }
  });
}

const MEMORY_TAB_BANNER_ROW = 1;
const MEMORY_TAB_HEADER_ROW = 2;
const MEMORY_TAB_DATA_ROW = 3;

/**
 * HOW FAR A MEMORY TAB'S DROPDOWNS REACH BELOW THE LAST ROW.
 *
 * THE BUG THIS FIXES, and it is the one people actually hit: every one of
 * these tabs applied its dropdowns and checkboxes to `rows.length` rows —
 * exactly the rows that already existed. writeMemoryTab() clears every data
 * validation on the sheet first, so the row a person types their NEXT question
 * into had no dropdown on it, no checkbox in Required or Active, and no
 * warning when the Type was spelled "dropdown " with a trailing space. An
 * EMPTY tab was worse still: `rows.length` is 0, so the whole block was
 * skipped and the tab a person met on their first visit had nothing to pick
 * from anywhere on it.
 *
 * A tab is a form somebody fills in, so the blank line under the last row is
 * part of it. The dropdowns now run a band of spare rows past the data, and
 * ensureMemoryTabSpareRows() makes sure the sheet is long enough to hold them.
 *
 * Fifty because it is more rows than anyone adds between renders and few
 * enough that the validation write stays one call.
 */
const MEMORY_TAB_SPARE_ROWS = 50;

/**
 * How many rows a memory tab's validation should cover: the data, plus the
 * blank band under it. Always at least one, so an empty tab still gets its
 * dropdowns.
 */
function memoryTabValidationRows(rowCount) {
  return Math.max(Number(rowCount) || 0, 0) + MEMORY_TAB_SPARE_ROWS;
}

/**
 * Grows the sheet so the spare band exists to put validation on. A sheet that
 * is already long enough is left alone — insertRowsAfter() on a full-height
 * sheet is a write nobody needs.
 */
function ensureMemoryTabSpareRows(sheet, rowCount) {
  const needed = MEMORY_TAB_DATA_ROW + memoryTabValidationRows(rowCount) - 1;
  const have = sheet.getMaxRows();
  if (have >= needed) return;
  sheet.insertRowsAfter(have, needed - have);
}

/**
 * The two things every memory tab wants on its spare band as well as its data:
 * a real checkbox in each boolean column, and a dropdown on each column with a
 * fixed vocabulary.
 *
 * `spec.checkboxes` is a list of header names; `spec.lists` is
 * { header: [options] } for a restricted dropdown and `spec.openLists` the
 * same for a suggesting one (see applyOpenValueListValidationBounded).
 * Anything naming a column this tab hasn't got is skipped rather than
 * throwing, so a workbook on an older layout renders instead of failing.
 */
function applyMemoryTabValidation(sheet, headers, rowCount, spec) {
  const map = getIndexMap(headers);
  const span = memoryTabValidationRows(rowCount);
  ensureMemoryTabSpareRows(sheet, rowCount);

  (spec.checkboxes || []).forEach(header => {
    if (map[header] === undefined) return;
    sheet.getRange(MEMORY_TAB_DATA_ROW, map[header] + 1, span, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
      .setHorizontalAlignment('center');
  });
  Object.keys(spec.lists || {}).forEach(header => {
    if (map[header] === undefined) return;
    applyValueListValidationBounded(sheet, map[header] + 1, spec.lists[header],
      MEMORY_TAB_DATA_ROW, span);
  });
  Object.keys(spec.openLists || {}).forEach(header => {
    if (map[header] === undefined) return;
    applyOpenValueListValidationBounded(sheet, map[header] + 1, spec.openLists[header],
      MEMORY_TAB_DATA_ROW, span);
  });
  return span;
}

/** Writes a memory tab: banner, header row, data, and the yellow staff-column wash. */
function writeMemoryTab(sheet, headers, rows, options) {
  const numCols = headers.length;
  // A layout that has grown a column since this tab was last drawn — the
  // household and name columns did exactly that — must not meet a sheet that
  // is still the old width halfway through a setValues().
  ensureSheetColumns(sheet, numCols);
  // Member_Roll and Program_Settings are read with the same sectioned readers
  // as the date-bearing tabs, and this is the only thing that rewrites them.
  invalidateSectionedRowsCache(sheet);
  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols, options.banner, { note: options.bannerNote });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);
  labelManualEntryColumns(sheet, MEMORY_TAB_HEADER_ROW, headers, options.staffColumns);

  if (rows.length > 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1, rows.length, numCols).setValues(rows);
    const map = getIndexMap(headers);
    (options.dateColumns || []).forEach(h => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[h] + 1, rows.length, 1).setNumberFormat(DATE_DISPLAY_FORMAT);
    });
    (options.numberColumns || []).forEach(h => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[h] + 1, rows.length, 1).setNumberFormat('0');
    });
    applyZebraStripingManualBounded(sheet, MEMORY_TAB_DATA_ROW, rows.length, numCols);
    tintManualEntryColumns(sheet, MEMORY_TAB_DATA_ROW, rows.length, headers, options.staffColumns);
  }

  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  freezeColumnsSafely(sheet, 1); // the name/program is the row's identity — keep it visible
  autosizeColumns(sheet, { minCols: numCols, force: true });
}


