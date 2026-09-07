// ============================================================================
// 6f. CLUB ROSTERS  (Club_Members)
// ============================================================================
//
// A club (see CLUB_TAG) is a program you join rather than register for. This
// tab is the membership list — the durable half of that promise, and the only
// place a membership can be ENDED.
//
// THE ASYMMETRY THIS EXISTS TO FIX. Joining is easy: it's a choice on a form,
// and a form submission is a thing a member can do for themselves. Leaving is
// not — nobody re-opens a registration form to un-sign-up, and a form has no
// way to express "and stop booking me from now on" anyway. So a "sign up once,
// forever" feature without a visible, staff-operable OFF switch is a one-way
// door: the only remedy for a member who moves away is deleting rows out of
// the Registrants tab every month, forever, and nobody will.
//
// So membership is a ROW, with an Active checkbox on it:
//
//   ticked    applyClubRosterCatchup() books this person into every upcoming
//             session of the club, on whatever form currently covers it.
//   unticked  they stop being booked — and handleClubMembersEdit() offers, on
//             the spot, to cancel the upcoming rows already created for them,
//             because "stop booking me" almost always means "and not next
//             Thursday either."
//
// Re-ticking re-books them from the next sync. Nothing here is destructive:
// cancelling sets a status, it never deletes a row.
// ============================================================================

/** Reads the roster tab (banner + header + rows, like the memory tabs). */
function readClubMemberRows(sheet) {
  if (!sheet) return [];
  try {
    return readSimpleTable(sheet, HEADERS.Club_Members);
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.CLUB_MEMBERS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/** The identity of one membership: which club, which person, in what role. */
function clubMemberKey(clubKey, name, personType) {
  return `${clubKey}|${normalizeNameKey(name)}|${String(personType || 'Attendee').trim()}`;
}

/** { clubMemberKey: row } for a batch of roster rows. */
function indexClubMemberRows(rows) {
  const map = getIndexMap(HEADERS.Club_Members);
  const index = {};
  rows.forEach(row => {
    const clubKey = String(row[map['Club_Key']] || '').trim();
    if (!clubKey) return;
    index[clubMemberKey(clubKey, row[map['Name']], row[map['Person_Type']])] = row;
  });
  return index;
}

/**
 * Folds new/updated memberships into the roster tab and rewrites it.
 *
 * `entries` are joins as they come off a form: { clubKey, club, location,
 * name, personType, primaryRegistrant, phone, email, lunchType, source }.
 *
 * An entry for somebody already on the roster REFRESHES their contact details
 * and leaves the staff columns alone — with one deliberate exception: if they
 * had been made inactive and have now personally chosen the club option on a
 * form again, they are put back on. That is a member asking, in the only way a
 * member can ask, and quietly ignoring it would be worse than the surprise —
 * so it is also reported to the admin digest rather than done silently.
 *
 * Returns { added, reactivated, unchanged, lunchChanged } — the last of these
 * counting members who were already on the list and whose standing lunch a desk
 * tick has just changed.
 */
function upsertClubMembers(entries) {
  const result = { added: 0, reactivated: 0, unchanged: 0, lunchChanged: 0 };
  if (!entries || entries.length === 0) return result;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.CLUB_MEMBERS);
  const headers = HEADERS.Club_Members;
  const map = getIndexMap(headers);
  const rows = readClubMemberRows(sheet);
  const index = indexClubMemberRows(rows);
  const now = new Date();

  entries.forEach(entry => {
    const clubKey = String(entry.clubKey || '').trim();
    const name = String(entry.name || '').trim();
    if (!clubKey || !name) return;
    const personType = String(entry.personType || 'Attendee').trim();
    const key = clubMemberKey(clubKey, name, personType);
    const existing = index[key];

    if (existing) {
      existing[map['Club']] = entry.club || existing[map['Club']];
      existing[map['Location']] = entry.location || existing[map['Location']];
      existing[map['Primary_Registrant']] = entry.primaryRegistrant || existing[map['Primary_Registrant']];
      if (entry.phone) existing[map['Phone']] = entry.phone;
      if (entry.email) existing[map['Email']] = entry.email;
      if (entry.source) existing[map['Source']] = entry.source;
      if (!isTruthyCheckbox(existing[map['Active']])) {
        existing[map['Active']] = true;
        existing[map['Joined_On']] = now;
        // The staff Lunch preference is theirs, but a re-join is a fresh
        // statement of it — take the one they just gave us.
        if (entry.lunchType) existing[map['Lunch']] = entry.lunchType;
        result.reactivated++;
        noteForAdmin('Club members who re-joined',
          `${name} was marked inactive on "${entry.club || clubKey}" but has just been put back on it ` +
          `(${entry.source || 'a registration form'}), so they are on the list again. Untick Active on ` +
          `"${SHEET_NAMES.CLUB_MEMBERS}" if that is wrong.`);
      } else {
        // AN ACTIVE MEMBER'S LUNCH IS STAFF'S TO SET, and a form arriving again
        // must not quietly overwrite what somebody typed on the tab. A DESK
        // TICK IS DIFFERENT: it is a person at the counter saying what this
        // arrangement is now, which is the same kind of statement the column
        // holds — and refusing it would mean "she's on the list already" was
        // the one case where "…and a lunch every time" did nothing at all.
        if (entry.lunchTypeFromDesk && entry.lunchType &&
          String(existing[map['Lunch']] || '') !== entry.lunchType) {
          existing[map['Lunch']] = entry.lunchType;
          result.lunchChanged++;
        } else {
          result.unchanged++;
        }
      }
      return;
    }

    const row = new Array(headers.length).fill('');
    row[map['Club']] = entry.club || '';
    row[map['Location']] = entry.location || '';
    row[map['Name']] = name;
    row[map['Person_Type']] = personType;
    row[map['Primary_Registrant']] = entry.primaryRegistrant || '';
    row[map['Phone']] = entry.phone || '';
    row[map['Email']] = entry.email || '';
    row[map['Lunch']] = entry.lunchType || 'No Lunch';
    row[map['Joined_On']] = now;
    row[map['Active']] = true;
    row[map['Source']] = entry.source || 'Registration form';
    row[map['Club_Key']] = clubKey;
    rows.push(row);
    index[key] = row;
    result.added++;
  });

  if (result.added > 0 || result.reactivated > 0 || result.lunchChanged > 0) {
    renderClubMembersSheet(rows);
    // applyClubRosterCatchup() reads this tab back moments from now, in the
    // same execution — make sure what it reads is what was just written.
    SpreadsheetApp.flush();
    log(`Club_Members: ${result.added} new member(s), ${result.reactivated} re-activated, ` +
      `${result.lunchChanged} standing lunch(es) changed.`);
  }
  return result;
}

/** Writes the roster tab: sorted by club then name, Active as a real checkbox, the machine key hidden. */
function renderClubMembersSheet(allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.CLUB_MEMBERS);
  const headers = HEADERS.Club_Members;
  const map = getIndexMap(headers);
  const rows = (allRows || readClubMemberRows(sheet)).slice();

  rows.sort((a, b) => {
    const clubA = String(a[map['Club']] || '');
    const clubB = String(b[map['Club']] || '');
    if (clubA !== clubB) return clubA.localeCompare(clubB);
    return String(a[map['Name']] || '').localeCompare(String(b[map['Name']] || ''));
  });

  writeMemoryTab(sheet, headers, rows, {
    banner: '🎟️ Club Members',
    bannerNote: 'Who is on each club\'s standing list.\n\nUntick Active to take somebody off it.',
    staffColumns: CLUB_MEMBERS_STAFF_COLUMNS,
    dateColumns: ['Joined_On']
  });

  // Down the blank band too, so a member added by hand at the bottom of the
  // list gets the same Active checkbox as one the roster wrote. See
  // MEMORY_TAB_SPARE_ROWS.
  applyMemoryTabValidation(sheet, headers, rows.length, {
    checkboxes: ['Active'],
    lists: { Lunch: CLUB_LUNCH_OPTIONS },
    openLists: { Location: Object.values(CALENDAR_MAP) }
  });
  // Club_Key is the join key, not something to read. Everything else stays.
  applyColumnVisibility(sheet, headers, ['Club_Key']);
  return rows.length;
}

/**
 * Books every ACTIVE club member into every UPCOMING session of their club
 * that they don't already have a row for. This is what makes "sign up once"
 * survive a month rolling over onto a brand-new form.
 *
 * DELIBERATELY GAP-FILLING ONLY: a session the person already has a row for is
 * left completely alone, whatever that row says. They may have registered
 * through the form normally, been hand-added as a walk-in, or been cancelled
 * for that one date — and a roster that re-asserted itself over any of those
 * would make individual dates unmanageable, which is the opposite of what a
 * standing membership is for.
 *
 * PAST sessions are never filled in either. A membership says where someone is
 * expected, not where they were; back-filling would invent attendance history.
 */
function applyClubRosterCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  if (!sheet) return 0;

  const map = getIndexMap(HEADERS.Club_Members);
  const members = readClubMemberRows(sheet).filter(row => isTruthyCheckbox(row[map['Active']]));
  if (members.length === 0) return 0;

  // Every session, grouped by the program it belongs to — not clubs only.
  // A roster row is a standing place on a PROGRAM, and one added at the desk
  // (addStandingListMember()) is attached to programs the public form never
  // offered to join. Nothing widens as a result: a person is still booked only
  // into programs somebody deliberately put them on.
  const sessionsByClub = {};
  Object.keys(registryIndex).forEach(k => {
    const entry = registryIndex[k];
    // NEVER AN APPOINTMENT SESSION. A standing place means "book me into every
    // one of these"; on a [Personalized Assistance] program that would hand
    // one person a slot in every Wills afternoon for the rest of the year and
    // take those chairs off the form. An appointment is booked one at a time,
    // by whoever wants it — from the form, or from Quick Mark.
    if (entry.isAssistance) return;
    const key = entry.programKey || entry.clubKey;
    if (!key) return;
    if (!sessionsByClub[key]) sessionsByClub[key] = [];
    sessionsByClub[key].push(entry);
  });
  if (Object.keys(sessionsByClub).length === 0) return 0;

  const todayKey = formatDateKey(new Date());
  let booked = 0;

  members.forEach(member => {
    const clubKey = String(member[map['Club_Key']] || '').trim();
    const sessions = sessionsByClub[clubKey];
    if (!sessions) return;

    const name = String(member[map['Name']] || '').trim();
    const personType = String(member[map['Person_Type']] || 'Attendee').trim();
    if (!name) return;
    const joinedOn = coerceDate(member[map['Joined_On']]) || new Date();

    sessions.forEach(registryEntry => {
      if (formatDateKey(registryEntry.eventDate) < todayKey) return;
      const rowKey = `${registryEntry.eventId}|${normalizeNameKey(name)}|${personType}`;
      if (existingRowIndex.has(rowKey)) return; // already has a row for this session — never overwritten

      const row = buildRegistrantRow({
        registryEntry,
        name,
        personType,
        lunchType: String(member[map['Lunch']] || 'No Lunch'),
        primaryRegistrant: String(member[map['Primary_Registrant']] || 'Self'),
        adminNotes: `Booked automatically from the ${SHEET_NAMES.CLUB_MEMBERS} list.`,
        phone: String(member[map['Phone']] || ''),
        email: String(member[map['Email']] || ''),
        formEditUrl: '',
        formSourceText: 'Standing list',
        protectedKeys,
        existingRowIndex,
        submittedAt: joinedOn,
        orderAheadDays,
        // A stable synthetic Party_ID, so a re-run recognizes its own earlier
        // rows as the same submission and patches them instead of superseding
        // them into a growing pile of history.
        partyId: `CLUB:${clubMemberKey(clubKey, name, personType)}`,
        partySize: ''
      });
      if (row) { newRows.push(row); booked++; }
    });
  });

  if (booked > 0) log(`applyClubRosterCatchup: booked ${booked} club registration(s) from the standing lists.`);
  return booked;
}

/**
 * The Club_Members tab's own edits. Only Active matters: unticking it is the
 * documented way to take somebody off a club, and the useful moment to ask
 * about the bookings that membership has already produced.
 */
function handleClubMembersEdit(e, sheet) {
  if (typeof e.value === 'undefined') return; // multi-cell paste — nothing single to act on
  // getIndexMap rather than getLiveHeaderMap: this tab is rewritten whole by
  // renderClubMembersSheet() on every refresh, so its header row is always
  // exactly HEADERS.Club_Members.
  const headerMap = getIndexMap(HEADERS.Club_Members);
  const activeCol = headerMap['Active'];
  if (activeCol === undefined || e.range.getColumn() !== activeCol + 1) return;
  const row = e.range.getRow();
  if (row < MEMORY_TAB_DATA_ROW) return;

  const read = name => (headerMap[name] === undefined ? '' : sheet.getRange(row, headerMap[name] + 1).getValue());
  const name = String(read('Name') || '').trim();
  const club = String(read('Club') || '').trim();
  const clubKey = String(read('Club_Key') || '').trim();
  const personType = String(read('Person_Type') || 'Attendee').trim();
  if (!name || !clubKey) return;

  if (isTruthyCheckbox(e.value)) {
    toastIfPossible(`${name} is back on "${club}". They'll be booked into its upcoming sessions on the next sync.`);
    return;
  }

  const cancelled = cancelUpcomingClubRegistrations({ clubKey, club, name, personType });
  if (cancelled === 0) {
    toastIfPossible(`${name} taken off "${club}". They had no upcoming bookings to cancel.`);
    return;
  }
  toastIfPossible(`${name} taken off "${club}" — ${cancelled} upcoming booking(s) cancelled.`);
}

/**
 * Cancels (never deletes) a former club member's UPCOMING registrant rows for
 * that club, and recomputes the catering numbers those rows were feeding.
 *
 * Asks first, and says how many rows and which club. Declining leaves the
 * membership off but the bookings in place, which is a real and reasonable
 * answer — "stop booking her from January, but she is still coming to the two
 * we've already told the kitchen about."
 *
 * Matching is by program name + location rather than by Event_ID, because the
 * membership outlives any particular form or session: it has to find rows on
 * next month's form, which did not exist when she joined. A club tagged
 * [All Locations] matches at every location, since it is one club.
 */
function cancelUpcomingClubRegistrations(args) {
  const { clubKey, club, name, personType } = args;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return 0;

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');
  const todayKey = formatDateKey(new Date());
  const nameKey = normalizeNameKey(name);
  const isSharedClub = clubKey.indexOf(`${SHARED_LOCATION_SCOPE}::`) === 0;

  const targets = rows.filter(row => {
    if (normalizeNameKey(row[map['Name']]) !== nameKey) return false;
    if (String(row[map['Person_Type']] || 'Attendee').trim() !== personType) return false;
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) < todayKey) return false;
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return false;
    const rowKey = computeClubKey(row[map['Event']], row[map['Location']], isSharedClub);
    return rowKey === clubKey;
  });

  if (targets.length === 0) return 0;

  if (!confirmConsequentialAction(`Cancel ${name}'s upcoming ${club || 'club'} bookings?`,
    `${name} has ${targets.length} upcoming registration(s) that came from their ${club || 'club'} membership.\n\n` +
    `They will be marked Cancelled (not deleted) and taken out of the catering counts. ` +
    `Answer No to leave those bookings alone — they will simply stop being renewed.`, false)) {
    return 0;
  }

  const stamp = `Cancelled on ${formatDateLabel(new Date())}: taken off the ${club || 'club'} list.`;
  targets.forEach(row => {
    row[map['Program_Status']] = 'Cancelled';
    row[map['Lunch_Status']] = 'Cancelled';
    row[map['Manual_Override']] = 'Manually Edited';
    const notes = String(row[map['Admin_Notes']] || '').trim();
    row[map['Admin_Notes']] = notes ? `${notes} | ${stamp}` : stamp;
  });

  renderRegistrantsSheet(false, rows);
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, rows);
    updateMasterLunchDashboard(rows);
  } catch (err) {
    log(`⚠️ Cancelled ${targets.length} club booking(s) for ${name}, but could not recalculate the counts (${err}).`);
  }
  log(`cancelUpcomingClubRegistrations: cancelled ${targets.length} row(s) for ${name} on "${club}".`);
  return targets.length;
}

/**
 * Refreshes the roster's human-readable Club and Location cells from the
 * session table, and returns the rows.
 *
 * Club_Key is the identity and never changes; Club and Location are labels for
 * a person to read, and a program renamed on the calendar (or a club that
 * starts also meeting at Ashbridge) would otherwise leave the roster naming
 * something that no longer exists. Rows whose club is not currently on the
 * dashboard are left exactly as they are — a club with no scheduled sessions
 * right now is dormant, not gone, and its members must survive the gap.
 */
function refreshClubMemberLabels(sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  const rows = readClubMemberRows(sheet);
  if (rows.length === 0) return rows;

  const map = getIndexMap(HEADERS.Club_Members);
  const clubs = collectKnownClubs(sessionRows);
  rows.forEach(row => {
    const club = clubs[String(row[map['Club_Key']] || '').trim()];
    if (!club) return;
    row[map['Club']] = club.title;
    row[map['Location']] = club.isShared ? SHARED_LOCATION_TAG : (club.locations[0] || row[map['Location']]);
  });
  return rows;
}

/**
 * Every club the workbook currently knows about, from the session table:
 * { clubKey: { clubKey, title, locations[], isShared } }. Used by the roster
 * refresh to keep the human-readable Club/Location columns current when a
 * program is renamed or gains a location.
 */
function collectKnownClubs(sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const rows = sessionRows || (sheet ? getSectionedRows(sheet, headers, 'Event_ID') : []);
  const sharedFormIds = getSharedFormIdSet();

  const clubs = {};
  rows.forEach(row => {
    if (!isClubColumnValue(row[map['Club']])) return;
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title) return;
    const isShared = sharedFormIds.has(row[map['Form_ID']]);
    const key = computeClubKey(title, location, isShared);
    if (!key) return;
    if (!clubs[key]) clubs[key] = { clubKey: key, title, locations: [], isShared };
    if (location && clubs[key].locations.indexOf(location) === -1) clubs[key].locations.push(location);
  });
  return clubs;
}


