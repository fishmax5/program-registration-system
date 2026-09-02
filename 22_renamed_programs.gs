// ============================================================================
// 4e. RENAMED PROGRAMS  (why a title change no longer costs you the roster)
// ============================================================================
//
// Event_ID is md5(calendarId | cleanTitle | dateKey). The title is IN the key,
// so renaming a program on the calendar re-keys every one of its sessions —
// and to the rest of this system that is indistinguishable from "twelve
// sessions were deleted and twelve unrelated ones appeared". What follows is
// four separate losses, only the first of which is loud:
//
//   1. triageDeletedSessions() sweeps the old rows and their registrants into
//      Deleted_Event_Triage. Visible, recoverable by hand.
//   2. The group key (`scope::title::span`) is orphaned, so the program's FORM
//      is only saved by recovering its ID from the registration link in the
//      calendar descriptions — which does not exist at all if Config's
//      Link_Display is set to Hide.
//   3. computeClubKey() is built from the title, so a renamed CLUB's standing
//      roster stops matching any session and silently stops booking anybody.
//   4. Program_Options is keyed by Event + Location, so the staff's own notes
//      (Room_Or_Setup, Typical_Attendance...) are orphaned and a blank row
//      appears under the new name. Also silent.
//
// WHY NOT JUST RE-KEY EVENT_ID OFF SOMETHING STABLER. The obvious fix is to
// key off the calendar's own event UID instead of the title. It was rejected:
// the current hash is deliberately IDENTICAL across an event being deleted and
// re-created at the same title and date (see computeEventId()), staff here
// delete-and-recreate events regularly, and a UID would turn every one of
// those into exactly the triage sweep this section exists to prevent. It would
// also fix only (1) — the other three key off the title directly.
//
// SO THE RENAME IS DETECTED AND THE ROWS ARE MOVED. A rename is only
// distinguishable from "one program ended, another began" by evidence, and
// this insists on all four pieces before it touches anything:
//
//   a. The group is unknown — nothing on the sheet or in the form registry
//      already maps its key to a form.
//   b. It nonetheless resolves to an EXISTING form, either from the
//      registration link still sitting in its calendar descriptions, or from a
//      form-registry entry with the same scope and span under another title
//      (which is what covers Link_Display = Hide).
//   c. Every row of that form carries exactly ONE other title. Two titles
//      means several programs share the form — "Move Sessions to Another
//      Form…" does that — and which one was renamed is not answerable.
//   d. That other title is no longer live on any calendar we could read. If
//      it is, both names exist and this is a split, not a rename.
//
// Anything short of all four is left alone and behaves exactly as before. Two
// groups resolving to the SAME form disqualify each other, since at most one
// of them can be its rename.
//
// IT DOES NOT ASK FIRST, deliberately. This runs inside syncs that fire on a
// trigger with nobody watching, and a prompt that defaults to "no" when
// unattended would simply never fire — by the time a human ran a sync by hand,
// triage would already have happened. It is also strictly the LESS destructive
// branch: without it these rows are triaged; with it they are retitled. Every
// rename is logged and goes in the admin digest.
//
// PAST SESSIONS ARE RENAMED TOO. A form spans months, and renaming only the
// rows inside the sync window would leave the older dashboard rows pointing at
// Event_IDs their own registrant rows no longer carry — a broken join is worse
// than a history that reads under the program's current name.
// ============================================================================

/**
 * Finds programs that have been renamed on the calendar rather than replaced.
 *
 * Returns [{ formId, oldTitle, newTitle, idMap, rowCount }], where idMap is
 * { oldEventId: newEventId } across every session table row of that program.
 * Returns [] — the overwhelmingly common case — without writing anything.
 */
function detectRenamedPrograms(registrySheet, groups, existingState, eventsByCalendar) {
  // CHEAPEST QUESTION FIRST. This runs on every sync, and the answer on almost
  // all of them is "nothing was renamed" — so the groups that could possibly
  // BE a rename are counted before a single sheet row is read. A sync where
  // every group is already known costs one filter over an in-memory array.
  const unknown = groups.filter(group =>
    !group.noRegistration && !existingState.groupFormMap[group.groupKey]);
  if (unknown.length === 0) return [];

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return []; // a first import — nothing to rename FROM

  const liveTitles = collectLiveTitlesByCalendar(eventsByCalendar);
  if (Object.keys(liveTitles).length === 0) return []; // nothing readable — assume nothing

  // Form_ID -> { titles, rows }. The form is the thread a renamed program is
  // still holding on to: it survives the title change untouched.
  const byForm = {};
  rows.forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    const title = String(row[map['Clean_Title']] || '').trim();
    if (!formId || !title) return;
    if (!byForm[formId]) byForm[formId] = { titles: new Set(), rows: [] };
    byForm[formId].titles.add(title);
    byForm[formId].rows.push(row);
  });

  const candidates = [];
  const seenForms = {};
  unknown.forEach(group => {
    // (b) Does it resolve to a form that already exists? (Conditions (a) —
    // unknown group, and a program with a form at all — are what `unknown`
    // already selected for.)
    const formId = resolveFormIdForUnknownGroup(group, existingState);
    if (!formId || !byForm[formId]) return;

    // (c) Exactly one other title on that form.
    const info = byForm[formId];
    if (info.titles.size !== 1) return;
    const oldTitle = Array.from(info.titles)[0];
    if (normalizeNameKey(oldTitle) === normalizeNameKey(group.cleanTitle)) return;

    // (d) The old name must be gone from every calendar we could read.
    if (isTitleStillLive(liveTitles, info.rows, map, oldTitle)) {
      log(`"${group.cleanTitle}" resolves to the form of "${oldTitle}", but "${oldTitle}" is still on the ` +
        `calendar — treating them as two programs, not a rename.`);
      return;
    }

    seenForms[formId] = (seenForms[formId] || 0) + 1;
    candidates.push({ formId, oldTitle, newTitle: group.cleanTitle, groupKey: group.groupKey, rows: info.rows });
  });

  // Two new groups pointing at one form: at most one can be its rename, and
  // nothing here can say which. Both stand down.
  const renames = [];
  candidates.forEach(candidate => {
    if (seenForms[candidate.formId] > 1) {
      log(`⚠️ More than one new program resolves to form ${candidate.formId} — not treating any of them as a rename.`);
      return;
    }
    const idMap = buildRenameIdMap(candidate, map);
    if (!idMap) return;
    renames.push({
      formId: candidate.formId,
      oldTitle: candidate.oldTitle,
      newTitle: candidate.newTitle,
      // Carried so collectCalendarWork() can force this group through the
      // import even though the remap has left it with no new dates — that
      // pass is what renames the FORM. See collectCalendarWork().
      groupKey: candidate.groupKey,
      idMap,
      rowCount: Object.keys(idMap).length
    });
  });
  return renames;
}

/** { calendarId: Set(cleanTitle) } for every calendar that could actually be read this run. */
function collectLiveTitlesByCalendar(eventsByCalendar) {
  const live = {};
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) return; // unreadable — deliberately absent, not empty
    const titles = new Set();
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (parsed) titles.add(normalizeNameKey(parsed.cleanTitle));
    });
    live[calendarId] = titles;
  });
  return live;
}

/** True if `oldTitle` still appears on any calendar these rows came from. */
function isTitleStillLive(liveTitles, rows, map, oldTitle) {
  const wanted = normalizeNameKey(oldTitle);
  const sources = new Set(rows.map(row => String(row[map['Calendar_Source']] || '').trim()).filter(Boolean));
  for (const source of sources) {
    const titles = liveTitles[source];
    // An unreadable calendar is not evidence of absence — the safest reading
    // is "it might still be there", which stands the rename down.
    if (!titles) return true;
    if (titles.has(wanted)) return true;
  }
  return false;
}

/**
 * The form an unknown group belongs to, if it already has one.
 *
 * TWO INDEPENDENT SOURCES, because each covers a case the other misses:
 *   - the registration link still in the calendar event descriptions, which is
 *     the same recovery processCalendarGroup() relies on. Strongest evidence
 *     there is, and absent entirely when Config's Link_Display is Hide;
 *   - a form-registry entry with the same SCOPE and SPAN but a different
 *     title. `scope` is the calendar (or ALL_LOCATIONS) and `span` is FIXED or
 *     the month, so a match means "the same calendar's form, for the same
 *     stretch of time, under some other name" — exactly a rename, and it needs
 *     no description at all. Ambiguity (two such entries) returns nothing.
 */
function resolveFormIdForUnknownGroup(group, existingState) {
  const fromEvents = recoverFormIdFromGroupEvents(group);
  if (fromEvents) return fromEvents;

  const parts = splitGroupKey(group.groupKey);
  if (!parts) return '';
  const matches = [];
  Object.keys(existingState.groupFormMap).forEach(key => {
    const other = splitGroupKey(key);
    if (!other) return;
    if (other.scope !== parts.scope || other.span !== parts.span) return;
    if (normalizeNameKey(other.title) === normalizeNameKey(parts.title)) return;
    const formId = existingState.groupFormMap[key];
    if (formId && matches.indexOf(formId) === -1) matches.push(formId);
  });
  return matches.length === 1 ? matches[0] : '';
}

/**
 * findExistingFormIdFromEvents() for a group, memoized for the execution.
 *
 * That function opens each candidate form to prove it is real, so it is a
 * Forms API call per group — and both this section AND processCalendarGroup()
 * ask the same question about the same groups on the same run. On a re-import
 * of a calendar whose events already carry links, that doubled every recovery
 * call in the sync. The memo is per-execution and the descriptions it reads
 * are not changed by anything running between the two calls.
 */
let __recoveredFormIdByGroupKey = {};

function invalidateRecoveredFormIds() {
  __recoveredFormIdByGroupKey = {};
}

function recoverFormIdFromGroupEvents(group) {
  const key = group.groupKey;
  if (Object.prototype.hasOwnProperty.call(__recoveredFormIdByGroupKey, key)) {
    return __recoveredFormIdByGroupKey[key];
  }
  const found = findExistingFormIdFromEvents(group.events) || '';
  __recoveredFormIdByGroupKey[key] = found;
  return found;
}

/**
 * Splits `scope::title::span` back apart. Taken from the OUTSIDE in — first
 * separator and last separator — so a program whose own name contains "::"
 * still yields the right scope and span.
 */
function splitGroupKey(groupKey) {
  const key = String(groupKey || '');
  const first = key.indexOf('::');
  const last = key.lastIndexOf('::');
  if (first < 0 || last <= first) return null;
  return {
    scope: key.substring(0, first),
    title: key.substring(first + 2, last),
    span: key.substring(last + 2)
  };
}

/**
 * { oldEventId: newEventId } for every row of a renamed program.
 *
 * Keyed off each row's OWN stored Event_ID rather than a recomputed one, so a
 * row whose ID was written by some earlier path still maps. Returns null if
 * the rename would collide two sessions onto one ID, which nothing downstream
 * could tell apart afterwards.
 */
function buildRenameIdMap(candidate, map) {
  const idMap = {};
  const taken = new Set();
  for (const row of candidate.rows) {
    const oldId = String(row[map['Event_ID']] || '').trim();
    const source = String(row[map['Calendar_Source']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!oldId || !source || !date) continue;
    const newId = computeEventId(source, candidate.newTitle, formatDateKey(date));
    if (taken.has(newId) && idMap[oldId] !== newId) {
      log(`⚠️ Renaming "${candidate.oldTitle}" to "${candidate.newTitle}" would give two sessions the same ` +
        `Event_ID — leaving it alone.`);
      return null;
    }
    taken.add(newId);
    idMap[oldId] = newId;
  }
  return Object.keys(idMap).length > 0 ? idMap : null;
}

/**
 * Moves every trace of a renamed program onto its new name.
 *
 * SEVEN STORES, and missing any one of them is its own quiet bug:
 *   the session table (Event_ID + Clean_Title), the registrant rows and the
 *   triage rows (both join on Event_ID and display the title), the calendar
 *   invite ledger and the deletion tombstones (both keyed by Event_ID), the
 *   club roster (keyed by a hash of the title) and Program_Options (keyed by
 *   title + location, and holding the staff's own notes).
 */
function applyProgramRenames(registrySheet, renames) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const combined = {};
  renames.forEach(rename => Object.keys(rename.idMap).forEach(oldId => {
    combined[oldId] = rename.idMap[oldId];
  }));

  renameSessionTableRows(registrySheet, renames);
  renameRegistrantRows(ss, renames, combined);
  renameTriageRows(ss, renames, combined);
  renameInviteLedgerKeys(combined);
  renameTombstoneKeys(combined);
  renameClubRosterKeys(ss, renames);
  renameProgramOptionRows(ss, renames);
  renameProgramLeaderRows(ss, renames);

  renames.forEach(rename => {
    const message = `"${rename.oldTitle}" was renamed to "${rename.newTitle}" on the calendar — moved ` +
      `${rename.rowCount} session(s), their registrants, and their club/staff records onto the new name ` +
      `instead of triaging them.`;
    log(message);
    noteForAdmin('Programs renamed on the calendar', message);
  });
}

/** The session table itself: new Event_ID and new Clean_Title, written in place. */
function renameSessionTableRows(registrySheet, renames) {
  const headers = HEADERS.Master_Program_Dashboard;
  const titleByOldId = {};
  const idMap = {};
  renames.forEach(rename => Object.keys(rename.idMap).forEach(oldId => {
    idMap[oldId] = rename.idMap[oldId];
    titleByOldId[oldId] = rename.newTitle;
  }));

  // Written cell-range by cell-range rather than by re-rendering the tab:
  // this runs mid-import, and renderProgramDashboard() would trigger a triage
  // sweep against a session table that is halfway through being corrected.
  getSectionZones(registrySheet, 'Event_ID').forEach(zone => {
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;
    // COLUMN POSITIONS COME FROM THE SHEET, not from the headers array. Rows
    // read through readAllSectionedRows() are re-projected into canonical
    // order (see buildHeaderProjection()), but a direct cell write has no such
    // help — and on a workbook whose header row is still an older layout,
    // canonical positions would put the new Event_IDs in the wrong columns.
    const live = getLiveHeaderMap(registrySheet, zone.headerRow, headers);
    if (live['Event_ID'] === undefined || live['Clean_Title'] === undefined) return;
    const idRange = registrySheet.getRange(zone.dataStart, live['Event_ID'] + 1, count, 1);
    const titleRange = registrySheet.getRange(zone.dataStart, live['Clean_Title'] + 1, count, 1);
    const ids = idRange.getValues();
    const titles = titleRange.getValues();
    let touched = false;
    ids.forEach((cell, i) => {
      const oldId = String(cell[0] || '').trim();
      if (!idMap[oldId]) return;
      titles[i][0] = titleByOldId[oldId];
      ids[i][0] = idMap[oldId];
      touched = true;
    });
    if (!touched) return;
    idRange.setValues(ids);
    titleRange.setValues(titles);
    invalidateEventTimeIndex(); // those Event_IDs are the index's keys
  });
}

/** Registrant rows: the Event_ID they join on, and the Event name they display. */
function renameRegistrantRows(ss, renames, idMap) {
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return;
  const headers = HEADERS.Registrant_Dash;
  const map = getIndexMap(headers);
  const rows = readAllSectionedRows(sheet, headers, 'Event_ID');
  const titleByOldId = buildTitleByOldId(renames);

  let changed = 0;
  rows.forEach(row => {
    const oldId = String(row[map['Event_ID']] || '').trim();
    if (!idMap[oldId]) return;
    row[map['Event_ID']] = idMap[oldId];
    row[map['Event']] = titleByOldId[oldId];
    changed++;
  });
  if (changed > 0) {
    renderRegistrantsSheet(false, rows);
    log(`Renamed program(s): moved ${changed} registrant row(s) onto the new name.`);
  }
}

/** Triage rows carry the same two fields, plus their own copy of the deleted title. */
function renameTriageRows(ss, renames, idMap) {
  const sheet = ss.getSheetByName(SHEET_NAMES.TRIAGE);
  if (!sheet) return;
  const headers = HEADERS.Deleted_Event_Triage;
  const map = getIndexMap(headers);
  const rows = readAllSectionedRows(sheet, headers, 'Event_ID');
  const titleByOldId = buildTitleByOldId(renames);

  let changed = 0;
  rows.forEach(row => {
    const oldId = String(row[map['Event_ID']] || '').trim();
    if (!idMap[oldId]) return;
    row[map['Event_ID']] = idMap[oldId];
    row[map['Event']] = titleByOldId[oldId];
    if (map['Deleted_Event_Title'] !== undefined) row[map['Deleted_Event_Title']] = titleByOldId[oldId];
    changed++;
  });
  if (changed > 0) {
    renderTriageSheet(false, rows);
    log(`Renamed program(s): moved ${changed} triaged row(s) onto the new name.`);
  }
}

/** { oldEventId: newTitle } across every rename in one pass. */
function buildTitleByOldId(renames) {
  const out = {};
  renames.forEach(rename => Object.keys(rename.idMap).forEach(oldId => { out[oldId] = rename.newTitle; }));
  return out;
}

/**
 * The invite ledger is keyed by Event_ID, and it is what stops Google emailing
 * everybody a second invitation. Left un-remapped, every renamed session would
 * read as "nobody has been invited yet".
 */
function renameInviteLedgerKeys(idMap) {
  const ledger = getCalendarInviteLedger();
  let moved = 0;
  Object.keys(idMap).forEach(oldId => {
    if (!ledger[oldId]) return;
    const newId = idMap[oldId];
    // Union, not overwrite: a new ID that somehow already has entries keeps
    // them. Sending one invitation too few is worse than one too many.
    const merged = new Set((ledger[newId] || []).concat(ledger[oldId]));
    ledger[newId] = Array.from(merged);
    delete ledger[oldId];
    moved++;
  });
  if (moved > 0) {
    __calendarInviteLedgerDirty = true;
    saveCalendarInviteLedger();
    log(`Renamed program(s): moved ${moved} calendar-invite ledger entr(ies) onto the new Event_IDs.`);
  }
}

/**
 * Tombstones are keyed `Event_ID|name|Person_Type` (section 5c). A rename that
 * left them behind would quietly resurrect every registration somebody had
 * deliberately deleted.
 */
function renameTombstoneKeys(idMap) {
  const store = getRegistrantTombstones();
  let moved = 0;
  Object.keys(store).forEach(key => {
    const sep = key.indexOf('|');
    if (sep < 0) return;
    const oldId = key.substring(0, sep);
    if (!idMap[oldId]) return;
    const newKey = `${idMap[oldId]}${key.substring(sep)}`;
    if (!store[newKey]) store[newKey] = store[key];
    delete store[key];
    moved++;
  });
  if (moved > 0) {
    __tombstoneDirty = true;
    saveRegistrantTombstones();
    log(`Renamed program(s): moved ${moved} deletion tombstone(s) onto the new Event_IDs.`);
  }
}

/**
 * THE SILENT ONE. Club_Key is computeClubKey(title, location) — so a renamed
 * club's standing roster matches no session, and applyClubRosterCatchup()
 * stops booking every one of its members with nothing said anywhere.
 *
 * Both spellings of the key are rewritten: a club may be per-location or
 * shared ([All Locations]), and which one this roster used is not recorded on
 * the row, so both candidates are tried against what is actually stored.
 */
function renameClubRosterKeys(ss, renames) {
  const sheet = ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  if (!sheet) return;
  const map = getIndexMap(HEADERS.Club_Members);
  const rows = readClubMemberRows(sheet);
  if (rows.length === 0) return;

  let changed = 0;
  rows.forEach(row => {
    const stored = String(row[map['Club_Key']] || '').trim();
    if (!stored) return;
    const location = String(row[map['Location']] || '').trim();
    for (const rename of renames) {
      // isShared decides whether the key is scoped to the location or to
      // ALL_LOCATIONS, and the row does not record which it was — so the row's
      // OWN stored key is the test. Whichever spelling matches is the one that
      // built it.
      for (const isShared of [false, true]) {
        if (computeClubKey(rename.oldTitle, location, isShared) !== stored) continue;
        row[map['Club_Key']] = computeClubKey(rename.newTitle, location, isShared);
        row[map['Club']] = rename.newTitle;
        changed++;
        return;
      }
    }
  });
  if (changed > 0) {
    renderClubMembersSheet(rows);
    log(`Renamed program(s): moved ${changed} club roster row(s) onto the new club key.`);
  }
}

/**
 * How Program_Options is written, in one place — refreshProgramOptions() is
 * not the only thing that rewrites the tab any more (see
 * renameProgramOptionRows()), and a second copy of these options is a second
 * chance for the tab to come back missing its banner or its date formats.
 */
function programOptionsTabOptions() {
  return {
    banner: '📋 Program Options',
    bannerNote: 'Every program this workbook has ever run, with your standing notes against each one.',
    staffColumns: PROGRAM_OPTIONS_STAFF_COLUMNS,
    dateColumns: ['Next_Date', 'Last_Date'],
    numberColumns: ['Sessions_Tracked']
  };
}

/**
 * THE OTHER SILENT ONE. Program_Options is keyed by Event + Location and holds
 * columns nothing else can regenerate — Room_Or_Setup, Typical_Attendance and
 * the staff's own notes. Without this the notes stay stranded under the old
 * name and the program reappears with an empty row.
 */
function renameProgramOptionRows(ss, renames) {
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_OPTIONS);
  if (!sheet) return;
  const headers = HEADERS.Program_Options;
  const map = getIndexMap(headers);
  const rows = readSimpleTable(sheet, headers);
  if (rows.length === 0) return;

  const titleMap = {};
  renames.forEach(rename => { titleMap[normalizeNameKey(rename.oldTitle)] = rename.newTitle; });

  const identityOf = row =>
    `${normalizeNameKey(row[map['Event']])}|${normalizeNameKey(row[map['Location']])}`;

  const renamed = [];
  const untouched = [];
  rows.forEach(row => {
    const replacement = titleMap[normalizeNameKey(row[map['Event']])];
    if (replacement) {
      row[map['Event']] = replacement;
      renamed.push(row);
    } else {
      untouched.push(row);
    }
  });
  if (renamed.length === 0) return;

  // A row may already exist under the NEW name at the same location — a blank
  // one written by an earlier sync that saw the renamed program before this
  // pass existed. The carried-over row holds the actual notes, so it wins:
  // renamed rows claim their identity first and a later duplicate is dropped.
  const kept = [];
  const claimed = new Set();
  renamed.concat(untouched).forEach(row => {
    const identity = identityOf(row);
    if (claimed.has(identity)) return;
    claimed.add(identity);
    kept.push(row);
  });

  writeMemoryTab(sheet, headers, kept, programOptionsTabOptions());
  log(`Renamed program(s): moved ${renamed.length} Program_Options row(s) onto the new name` +
    (kept.length < rows.length ? `, dropping ${rows.length - kept.length} blank duplicate(s)` : '') + '.');
}


/**
 * Brings the session table's flag checkboxes (Club, No_Registration) into line
 * with what the calendar currently says, for every program seen in this sync's
 * window.
 *
 * Needed because writeEventRegistryRows() only ever writes NEW rows: adding
 * [Club] to a program whose twelve dates are already imported would otherwise
 * change nothing until its thirteenth date appeared. Only programs actually
 * present in `groups` are touched, so a program outside the sync window keeps
 * whatever it has.
 *
 * This is also the half of "live" that runs the other way round. A tick on the
 * sheet is pushed to the calendar by handleProgramFlagEdit(); this pulls the
 * calendar's answer back onto every row of the program, so the two can never
 * sit disagreeing for longer than one sync.
 *
 * Returns how many cells changed.
 */
function reconcileProgramFlagColumns(registrySheet, groups) {
  if (!groups || groups.length === 0) return 0;

  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  if (!sheetMap['Calendar_Source'] || !sheetMap['Clean_Title']) return 0;

  let changed = 0;
  // Per PROGRAM and per DIRECTION, so the log can say what happened rather
  // than how many cells it took. "37 flag cell(s) updated" is the line this
  // used to write, and it is the same line whether the sync has just delivered
  // somebody's tick to twelve dates or just wiped [Personalized Assistance]
  // off every program in the building. Those are opposite events.
  const ticked = {};
  const unticked = {};
  const note = (bucket, column, title) => {
    const list = bucket[column] = bucket[column] || [];
    if (list.indexOf(title) === -1) list.push(title);
  };

  PROGRAM_FLAG_COLUMNS.forEach(flag => {
    if (!sheetMap[flag.column]) return; // a workbook still on the old layout

    // Programs whose tick has not reached the calendar yet are LEFT ALONE.
    // Without this the calendar — which has not been told about the tick —
    // would win, and the box would untick itself between the click and the
    // write. That is the whole bug the pending queue exists to close.
    const pendingKeys = pendingProgramKeysFor(flag.column);

    // Keyed per calendar + title, matching how a session row identifies itself.
    const expected = {};
    groups.forEach(group => {
      const value = !!group[flag.groupKey];
      group.sessions.forEach(session => {
        expected[`${session.calendarId}|${group.cleanTitle}`] = value;
      });
    });

    headerRows.forEach((hRow, i) => {
      const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
      const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
      if (!zone) return;

      const sources = registrySheet.getRange(zone.start, sheetMap['Calendar_Source'], zone.count, 1).getValues();
      const titles = registrySheet.getRange(zone.start, sheetMap['Clean_Title'], zone.count, 1).getValues();
      const flagRange = registrySheet.getRange(zone.start, sheetMap[flag.column], zone.count, 1);
      const current = flagRange.getValues();

      let touched = false;
      for (let r = 0; r < zone.count; r++) {
        const key = `${String(sources[r][0] || '').trim()}|${String(titles[r][0] || '').trim()}`;
        if (!Object.prototype.hasOwnProperty.call(expected, key)) continue;
        if (pendingKeys.has(key)) continue; // waiting to be written TO the calendar
        const want = expected[key];
        // Compared through isFlagColumnValue(), so a row still carrying the
        // word "Club" from an older version counts as already ticked in
        // MEANING — but not in TYPE, hence the second test: it is rewritten as
        // a real boolean so the checkbox renders, once, and never again.
        if (isFlagColumnValue(current[r][0], flag.regex) === want && typeof current[r][0] === 'boolean') continue;
        // Only a real change of ANSWER is worth reporting; rewriting the word
        // "Club" as a boolean is the same answer in a different type, and
        // saying so once per program per sync would drown the lines that
        // matter.
        if (isFlagColumnValue(current[r][0], flag.regex) !== want) {
          note(want ? ticked : unticked, flag.column, String(titles[r][0] || '').trim());
        }
        current[r] = [want];
        touched = true;
        changed++;
      }
      if (touched) flagRange.setValues(current);
    });
  });

  Object.keys(ticked).forEach(column => log(
    `Ticked ${column} on the session table for: ${ticked[column].join(', ')} — the calendar says so.`));
  // UNTICKING IS THE LOUD ONE. It is how this feature fails, and it is
  // indistinguishable from "nobody ever ticked it" by the time anyone looks.
  // The line says which programs, and what would put the tick back, because
  // the sync is not wrong to do this — the calendar IS the source of truth,
  // and the interesting question is always why the calendar stopped saying it.
  Object.keys(unticked).forEach(column => {
    const flag = getProgramFlagByColumn(column);
    log(`⚠️ Cleared ${column} on the session table for: ${unticked[column].join(', ')}. ` +
      `No calendar event of those programs reads as [${flag ? flag.tag : column}] any more, and the ` +
      `calendar is the source of truth. If the tag IS typed on the event, this script is not reading ` +
      `it — check the exact bracket with 🔧 Admin ▸ Read an Event's Tags…. To put it back, tick the ` +
      `box and let it reach the calendar (Programs & Forms ▸ Push Dashboard Ticks to the Calendar).`);
  });
  if (changed > 0 && Object.keys(ticked).length === 0 && Object.keys(unticked).length === 0) {
    log(`Rewrote ${changed} flag cell(s) as real checkboxes — same answers, tidier types.`);
  }
  return changed;
}

