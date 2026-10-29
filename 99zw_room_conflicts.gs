// ============================================================================
// 99zw. ROOMS, AND WHEN TWO SESSIONS WANT THE SAME ONE  (warn only, never block)
// ============================================================================
//
// Numbered `99zw` for the usual reason — never renumber, and this landed last.
// Safe there: behavior plus two self-contained constants. Everything it reaches
// for (`CONFIG_LAYOUT`, `HEADERS`, `readNotificationPolicyRows`,
// `spoolOfficeNote`, `presentReport_`) it reads at CALL time or through a
// hoisted function declaration, and the tab layout it reads
// (`ROOM_MANAGEMENT_LAYOUT`, `99zx`) is named inside functions, never at load.
//
// THE QUESTION. Nothing in this workbook said which room a program was in, so
// two programs booked into the Social Hall at the same time were found out by
// the people standing in the doorway. This answers "is any room wanted twice at
// once?" and says so; it decides nothing and blocks nothing — a registration is
// never refused because of a room, and a conflict is a thing for a person to
// resolve on the calendar.
//
// WHERE A ROOM COMES FROM.
//   * The Rooms table on the Room_Management tab (`99zx`; it began life as a
//     section of Config and is carried across once) is the canonical list:
//     a building and a room name. A room is identified by BOTH — "Activity
//     Room" at Narberth and at Ashbridge are two rooms — so everything here
//     speaks in labels of the form `Building: Room` (`roomLabel_`).
//   * Keyword rules (also on that tab) fill a program that has no listed room of
//     its own: the first rule whose keyword the title contains. A room chosen
//     on the program's own row always beats a rule (`effectiveDefaultRoom_`).
//   * A program's DEFAULT room is `Program_Settings`' `Room_Or_Setup`, a
//     suggesting dropdown fed from that list (`40`). Suggesting rather than
//     strict, because that column has always allowed free text ("chairs in
//     rows, projector") and a strict list would make every existing note an
//     invalid cell.
//   * A date's OVERRIDE is `Room_Override`, the last column of the session
//     table (`03`) — the first column on that table a person types into that
//     no calendar read can regenerate. It survives the hourly sync for the same
//     reason `Event_Description` does: the render writes back every column of
//     the rows it read, by header, and `writeEventRegistryRows` only ever
//     APPENDS rows for dates the table has never seen. It is deliberately NOT
//     written back to the calendar event's Location: a room move is a
//     workbook fact, and the event's location is the building.
//   * The effective room is the override if there is one, else the default.
//
// A VALUE THAT IS NOT ON THE LIST IS NOT A ROOM. Free text typed into either
// cell cannot be compared with anything, so it is left out of the check and
// NAMED in the report (`unrecognized`) — "no conflicts" beside a room nobody
// could match would be exactly the false bill of health `32` and `51` refuse to
// print. Matching is forgiving only about case and spacing (`roomKey_`).
//
// WHAT OVERLAPS. Two sessions in one room conflict when each starts before the
// other ends — a session ending at 10:30 and another starting at 10:30 do not.
// A session with no end time cannot be judged and is counted as such rather
// than assumed to last an hour. Only today and later are looked at: history
// would only ever be noise in a digest.
//
// HOW IT SURFACES, and the rule that keeps it quiet. The hourly sync's tail
// runs `checkRoomConflictsForDigest()`, which files ONE LINE PER CONFLICT for
// the office's 10am digest (`88`). `spoolOfficeNote` coalesces an identical
// line into a count, but a count of 24 beside a conflict that merely persisted
// all day is noise, so a line is filed once per conflict per day
// (`ROOM_CONFLICTS_SPOOLED_PROP_KEY`, the day and a short hash per line): a
// conflict that is still there tomorrow is told again tomorrow, and a new one
// is told the hour it appears. The Health panel row runs the same analysis on
// demand and also lists what it could not judge.
//
// `tests/room_conflicts.test.js`.

/** Which conflicts have already gone to today's digest — the day, and a short hash each. */
const ROOM_CONFLICTS_SPOOLED_PROP_KEY = 'ROOM_CONFLICTS_SPOOLED_V1';

/** Digest heading the lines are filed under. */
const ROOM_CONFLICTS_DIGEST_SECTION = 'Room conflicts';

/** The ceiling on remembered lines: a day with more than this is a calendar problem, not a digest. */
const ROOM_CONFLICTS_MAX_REMEMBERED = 300;

let __roomsListCache = null;

// ---------------------------------------------------------------------------
// The rooms list
// ---------------------------------------------------------------------------

/** `Building: Room` — the one spelling of a room everything here uses. */
function roomLabel_(building, room) {
  const b = String(building == null ? '' : building).trim();
  const r = String(room == null ? '' : room).trim();
  if (!r) return '';
  return b ? `${b}: ${r}` : r;
}

/** A Date from any realm — `instanceof` is false for one read out of another script's sheet. */
function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

/** A label worn down to what two spellings of one room have in common: case and spacing. */
function roomKey_(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The Rooms list, as `[{ building, room, label }]`, first spelling of a
 * label wins. Memoized for the execution (`forgetRoomsList()` drops it); never
 * throws — a tab that will not read is an empty list, which the check
 * reports as "no rooms listed" rather than failing a sync.
 */
function readRoomsList() {
  if (__roomsListCache) return __roomsListCache;
  const out = [];
  const seen = {};
  const take = (building, room) => {
    const label = roomLabel_(building, room);
    if (!label || seen[roomKey_(label)]) return;
    seen[roomKey_(label)] = true;
    out.push({ building: String(building || '').trim(), room: String(room || '').trim(), label });
  };
  try {
    const sec = ROOM_MANAGEMENT_LAYOUT.ROOMS;
    readTwoColumnsFromTab_(SHEET_NAMES.ROOM_MANAGEMENT, sec.startCol, 2)
      .forEach(([building, room]) => take(building, room));
    // Until the tab's own list has anything in it, Config's old Rooms section
    // (where this list first lived) still counts, so nothing stops working in
    // the gap before the first refresh carries it across.
    if (out.length === 0) readLegacyConfigRooms_().forEach(r => take(r.building, r.room));
  } catch (err) {
    log(`ℹ️ Could not read the Rooms list (${err}) — room conflicts are not checked this run.`);
  }
  __roomsListCache = out;
  return out;
}

/** `[[a, b], ...]` from `width` columns of a tab from the data row down; [] for no tab. */
function readTwoColumnsFromTab_(tabName, startCol, width) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(tabName) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (!sheet || lastRow < ROOM_MANAGEMENT_DATA_ROW) return [];
  return sheet.getRange(ROOM_MANAGEMENT_DATA_ROW, startCol, lastRow - ROOM_MANAGEMENT_DATA_ROW + 1, width).getValues();
}

/** What Config's retired Rooms section still holds: `[{ building, room }]`. */
function readLegacyConfigRooms_() {
  try {
    return readTwoColumnsFromTab_(SHEET_NAMES.CONFIG, LEGACY_CONFIG_ROOMS_START_COL, 2)
      .map(([building, room]) => ({ building: String(building || '').trim(), room: String(room || '').trim() }))
      .filter(r => r.room);
  } catch (err) {
    return [];
  }
}

function forgetRoomsList() {
  __roomsListCache = null;
}

/** The labels, in the order the list has them — what the dropdowns offer. */
function roomOptionLabels() {
  return readRoomsList().map(r => r.label);
}

/** Resolves typed text to a listed room's canonical label, or '' when it is not one. */
function resolveRoomLabel_(raw, rooms) {
  const key = roomKey_(raw);
  if (!key) return '';
  const hit = (rooms || []).filter(r => roomKey_(r.label) === key)[0];
  return hit ? hit.label : '';
}

let __roomRulesCache = null;

/**
 * The keyword rules on the Room Management tab, top to bottom, as
 * `[{ keyword, building, room }]` with `room` already a listed room's label.
 * A rule whose room is blank or no longer on the list is left out of the list
 * and named in `readRoomKeywordRulesUnresolved()`. Memoized for the execution.
 */
function readRoomKeywordRules() {
  if (__roomRulesCache) return __roomRulesCache.rules;
  const rules = [];
  const unresolved = [];
  try {
    const rooms = readRoomsList();
    const sec = ROOM_MANAGEMENT_LAYOUT.RULES;
    readTwoColumnsFromTab_(SHEET_NAMES.ROOM_MANAGEMENT, sec.startCol, 3).forEach(([keyword, building, room]) => {
      const kw = String(keyword || '').trim();
      if (!kw) return;
      const label = resolveRoomLabel_(room, rooms);
      if (!label) { unresolved.push(kw); return; }
      rules.push({ keyword: kw, building: String(building || '').trim(), room: label });
    });
  } catch (err) {
    log(`ℹ️ Could not read the room keyword rules (${err}) — none are applied this run.`);
  }
  __roomRulesCache = { rules, unresolved };
  return rules;
}

/** Keywords whose rule names a room that is blank or not on the list, so is not applied. */
function readRoomKeywordRulesUnresolved() {
  readRoomKeywordRules();
  return __roomRulesCache.unresolved;
}

function forgetRoomKeywordRules() {
  __roomRulesCache = null;
}

/**
 * What a program's default room IS, given what is typed on its own row:
 * `{ text, label, source, rule, raw }`.
 *   source 'program'  its own room, and it is on the list — it beats any rule;
 *   source 'keyword'  it has no listed room and a rule applies (`label` is the rule's room);
 *   source 'unlisted' it has text that is not a room and no rule applies — not checked;
 *   source ''         nothing at all.
 * Text that is not on the list does NOT block a rule: it is a note, not a room.
 */
function effectiveDefaultRoom_(title, location, explicitRaw, rooms, rules) {
  const raw = String(explicitRaw == null ? '' : explicitRaw).trim();
  const label = resolveRoomLabel_(raw, rooms || readRoomsList());
  if (label) return { text: label, label, source: 'program', rule: null, raw };
  const rule = keywordRuleFor_(title, location, rules || readRoomKeywordRules());
  if (rule) return { text: rule.room, label: rule.room, source: 'keyword', rule, raw };
  return { text: raw, label: '', source: raw ? 'unlisted' : '', rule: null, raw };
}

// ---------------------------------------------------------------------------
// The conflict check — pure
// ---------------------------------------------------------------------------

/**
 * Which sessions want one room at once.
 *
 * `sessions` is `[{ room, start, end, title, location, eventId }]` with `room`
 * already a canonical label, and `start` / `end` Dates. Sessions without a
 * usable span (no end, or an end that is not after the start) are not judged
 * and are counted in `unjudged`. Returns `{ conflicts, unjudged }`; each
 * conflict is `{ key, room, first, second }` with `first` the earlier start.
 * Pairs, not clusters: three sessions all overlapping are three conflicts, which
 * is also what three phone calls would be.
 */
function findRoomConflicts(sessions) {
  const byRoom = {};
  let unjudged = 0;
  (sessions || []).forEach(s => {
    if (!s || !s.room) return;
    const start = isDateValue_(s.start) ? s.start.getTime() : NaN;
    const end = isDateValue_(s.end) ? s.end.getTime() : NaN;
    if (isNaN(start) || isNaN(end) || end <= start) { unjudged++; return; }
    (byRoom[roomKey_(s.room)] = byRoom[roomKey_(s.room)] || []).push(
      { s, start, end });
  });

  const conflicts = [];
  Object.keys(byRoom).sort().forEach(roomKey => {
    const list = byRoom[roomKey].sort((a, b) =>
      a.start - b.start || a.end - b.end || String(a.s.eventId).localeCompare(String(b.s.eventId)));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        // Sorted by start, so once one begins at or after this one ends none
        // that follow can overlap it either.
        if (list[j].start >= list[i].end) break;
        const ids = [String(list[i].s.eventId || ''), String(list[j].s.eventId || '')].sort();
        conflicts.push({
          key: `${roomKey}|${ids[0]}|${ids[1]}`,
          room: list[i].s.room,
          first: list[i].s,
          second: list[j].s
        });
      }
    }
  });
  return { conflicts, unjudged };
}

// ---------------------------------------------------------------------------
// Reading the workbook
// ---------------------------------------------------------------------------

/**
 * The upcoming sessions that have a listed room, plus what could not be placed.
 * `unrecognized` is `[{ raw, count, source }]` — text typed as a room that is
 * not on the Rooms list, source `override` or `default`.
 */
function collectRoomSessions_(todayKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  const result = { sessions: [], unrecognized: [], checked: 0 };
  if (!sheet) return result;

  const rooms = readRoomsList();
  const rules = readRoomKeywordRules();
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const defaults = readNotificationPolicyRows();
  const settingsMap = getIndexMap(HEADERS.Program_Settings);
  const stray = {};

  getSectionedRowValues(sheet, headers, 'Event_ID').forEach(row => {
    const start = coerceDate(row[map['Event_Date']]);
    if (!start || formatDateKey(start) < todayKey) return;
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const override = String(row[map['Room_Override']] || '').trim();
    const settings = defaults[notificationProgramKey(title, location)];
    const standing = settings ? String(settings[settingsMap['Room_Or_Setup']] || '').trim() : '';

    // A date's override beats everything; otherwise the program's own listed
    // room, otherwise a keyword rule (effectiveDefaultRoom_).
    let label = '';
    if (override) {
      label = resolveRoomLabel_(override, rooms);
    } else {
      label = effectiveDefaultRoom_(title, location, standing, rooms, rules).label;
    }
    const raw = override || standing;
    if (!label) {
      if (raw) {
        const k = `${override ? 'override' : 'default'}|${raw}`;
        stray[k] = stray[k] || { raw, count: 0, source: override ? 'override' : 'default' };
        stray[k].count++;
      }
      return;
    }
    result.checked++;
    result.sessions.push({
      room: label,
      start,
      end: coerceDate(row[map['Event_End']]),
      title,
      location,
      eventId: String(row[map['Event_ID']] || '')
    });
  });
  result.unrecognized = Object.keys(stray).sort().map(k => stray[k]);
  return result;
}

/** The whole analysis: collect, then find. Never throws. */
function analyzeRoomConflicts() {
  const out = { roomsListed: 0, checked: 0, conflicts: [], unjudged: 0, unrecognized: [], unresolvedRules: [], error: '' };
  try {
    out.roomsListed = readRoomsList().length;
    if (out.roomsListed === 0) return out;
    const collected = collectRoomSessions_(formatDateKey(new Date()));
    const found = findRoomConflicts(collected.sessions);
    out.checked = collected.checked;
    out.conflicts = found.conflicts;
    out.unjudged = found.unjudged;
    out.unrecognized = collected.unrecognized;
    out.unresolvedRules = readRoomKeywordRulesUnresolved();
  } catch (err) {
    out.error = String(err);
    log(`ℹ️ Room conflict check could not run (${err}).`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saying it
// ---------------------------------------------------------------------------

function roomSpanLabel_(session) {
  const f = d => Utilities.formatDate(d, TIMEZONE, 'h:mm a');
  return `${f(session.start)}–${f(session.end)}`;
}

/** One conflict as one line — the exact text the digest files, so it coalesces. */
function describeRoomConflictLine(conflict) {
  return `${conflict.room}, ${formatDateLabel(conflict.first.start)}: ` +
    `"${conflict.first.title}" (${roomSpanLabel_(conflict.first)}, ${conflict.first.location}) overlaps ` +
    `"${conflict.second.title}" (${roomSpanLabel_(conflict.second)}, ${conflict.second.location})`;
}

/** The report the Health panel shows. */
function describeRoomConflicts(analysis) {
  if (analysis.error) {
    return `The room check could not run: ${analysis.error}\n\nNothing was changed.`;
  }
  if (analysis.roomsListed === 0) {
    return 'No rooms are listed yet, so nothing can be checked.\n\n' +
      'Add them on the ' + SHEET_NAMES.ROOM_MANAGEMENT + ' tab under "' + ROOM_MANAGEMENT_LAYOUT.ROOMS.title +
      '" (a building and a room name each), then pick a room for each program there, or for a single date in ' +
      'the session table\'s Room_Override column.';
  }
  const lines = [];
  if (analysis.conflicts.length === 0) {
    lines.push(`No room is double-booked from today on (${analysis.checked} session(s) with a listed room checked).`);
  } else {
    lines.push(`${analysis.conflicts.length} double-booked room(s) from today on:`);
    analysis.conflicts.forEach(c => lines.push(`• ${describeRoomConflictLine(c)}`));
    lines.push('', 'Nothing is blocked: registrations are unaffected. Move one of the two on the calendar, or ' +
      'give that date a different room in the session table\'s Room_Override column.');
  }
  if (analysis.unrecognized.length > 0) {
    lines.push('', 'Left out, because the text is not a room on the Rooms list (so it cannot be compared):');
    analysis.unrecognized.slice(0, 20).forEach(u =>
      lines.push(`• "${u.raw}" — ${u.count} session(s), from ${u.source === 'override' ? 'Room_Override' : 'Room_Or_Setup'}`));
    if (analysis.unrecognized.length > 20) lines.push(`…and ${analysis.unrecognized.length - 20} more.`);
  }
  if ((analysis.unresolvedRules || []).length > 0) {
    lines.push('', 'Keyword rules not applied, because their room is blank or no longer on the Rooms list: ' +
      analysis.unresolvedRules.map(k => `"${k}"`).join(', ') + '.');
  }
  if (analysis.unjudged > 0) {
    lines.push('', `${analysis.unjudged} session(s) with a room have no usable end time and could not be checked.`);
  }
  return lines.join('\n');
}

/** READ-ONLY, ungated. Health panel row `roomConflicts`. */
function reportRoomConflicts() {
  const analysis = analyzeRoomConflicts();
  const text = describeRoomConflicts(analysis);
  log(text);
  presentReport_('Room Conflicts', text,
    `${analysis.conflicts.length} double-booked room(s) — see the log.`);
  return analysis;
}

/**
 * Files each NEW conflict for tomorrow's digest — once per conflict per day.
 * Returns how many lines were filed. Never throws and never blocks its caller.
 */
function checkRoomConflictsForDigest() {
  try {
    const analysis = analyzeRoomConflicts();
    if (analysis.conflicts.length === 0) return 0;
    const today = formatDateKey(new Date());
    const stored = readJsonProperty_(ROOM_CONFLICTS_SPOOLED_PROP_KEY);
    const seen = stored.day === today && Array.isArray(stored.keys) ? stored.keys.slice() : [];
    let filed = 0;
    analysis.conflicts.forEach(c => {
      const hash = fingerprintOf_([c.key]).slice(0, 10);
      if (seen.indexOf(hash) !== -1) return;
      if (spoolOfficeNote(ROOM_CONFLICTS_DIGEST_SECTION, describeRoomConflictLine(c))) {
        seen.push(hash);
        filed++;
      }
    });
    if (filed > 0) {
      writeJsonProperty_(ROOM_CONFLICTS_SPOOLED_PROP_KEY,
        { day: today, keys: seen.slice(-ROOM_CONFLICTS_MAX_REMEMBERED) });
    }
    return filed;
  } catch (err) {
    log(`ℹ️ Room conflict digest step failed (${err}) — the next run tries again.`);
    return 0;
  }
}
