// ============================================================================
// 99z. THE WAITING LIST FOR A PROGRAM, NOT FOR A DATE
// ============================================================================
//
// Numbered after `99y` for the usual reason — never renumber, and this landed
// last. Safe there: behavior only, its own constants stand alone, its schema
// (`SHEET_NAMES.PROGRAM_WAITLIST`, `HEADERS.Program_Waitlist`) lives in `03`
// like every other tab's, and everything it reaches for — `getOrCreateSheet`
// (`07`), `readSimpleTable` (`40`), `leaderProgramKey` (`46`),
// `readMemberRollRows` (`79`), `writeSectionBanner` / `writeSectionHeader`
// (`13`) — it reads at CALL time or through a hoisted function declaration.
// Two earlier files call into it the same way: `36` (Quick Mark's "any date"
// box) and `46` (the program registrant sheet's Waitlist tab).
//
// WHY A TAB OF ITS OWN. "Put me on the list for Chair Yoga — whenever there is
// room" names no date, and every row on All_Registrants hangs off ONE
// session's Event_ID. The two ways of forcing it in are both worse than a
// tab: one Waitlisted row per upcoming date invents a dozen registrations that
// the counts, the ledger (`99k`), the leader alerts (`66`) and the verifier
// (`99n`) would all then have to be taught to ignore; one row on an arbitrary
// date is a claim about a date nobody asked for. So nothing here touches
// All_Registrants, the ledger, capacity or catering — which is also what makes
// it safe to add to a workbook holding real registrations.
//
// STAFF-OWNED AND APPEND-ONLY FROM CODE. Quick Mark appends a row; nothing in
// this project rewrites, clears or re-sorts the tab, so a note typed on it
// stays. Taking somebody off is a Status change ('Placed' once they have a
// seat, 'Removed' otherwise) rather than a deleted row, which keeps the record
// of who asked and when — and a deleted row is fine too, it simply vanishes
// from the leader's Waitlist tab on the next sync.
// ============================================================================

/** The Status dropdown. Blank reads as the first — a hand-typed row is waiting. */
const PROGRAM_WAITLIST_STATUSES = ['Waiting', 'Placed', 'Removed'];

/** What the leader sheet's Dates column says for somebody on this tab. */
const PROGRAM_WAITLIST_ANY_DATE_LABEL = 'Any date';

let __programWaitlistMemo = null;

/** Dropped by every write here, so a Quick Mark add is on the next read. */
function invalidateProgramWaitlistMemo_() {
  __programWaitlistMemo = null;
}

/**
 * The tab, drawn once. A tab that already has its header row is LEFT ALONE —
 * no clear, no re-sort, no reformat — because it is staff-owned and the only
 * thing this file ever does to it afterwards is append.
 */
function ensureProgramWaitlistTab_(ss) {
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(book, SHEET_NAMES.PROGRAM_WAITLIST);
  const headers = HEADERS.Program_Waitlist;
  const existing = sheet.getLastRow() >= MEMORY_TAB_HEADER_ROW
    ? String(sheet.getRange(MEMORY_TAB_HEADER_ROW, 1).getValue() || '').trim() : '';
  if (existing) return sheet;
  // A tab with something in it but no header is somebody else's tab under our
  // name. Refuse rather than draw over it.
  if (sheet.getLastRow() > 0) {
    throw new Error(`"${SHEET_NAMES.PROGRAM_WAITLIST}" has content but no header row — ` +
      `nothing was written. Rename that tab and try again.`);
  }
  ensureSheetColumns(sheet, headers.length);
  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, headers.length,
    '⏳ Program Waiting List — any date', {
      note: 'People waiting for a place in a PROGRAM, whichever date comes free. Added from ' +
        'Quick Mark ("Waiting list for a program — any date"). Set Status to Placed once they have ' +
        'a seat, or Removed; only Waiting rows show on the leader\'s Waitlist tab. Nothing here ' +
        'changes a registration, a count or a meal.'
    });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, headers.length, headers);
  try {
    const statusCol = headers.indexOf('Status') + 1;
    sheet.getRange(MEMORY_TAB_DATA_ROW, statusCol, Math.max(1, sheet.getMaxRows() - MEMORY_TAB_HEADER_ROW), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(PROGRAM_WAITLIST_STATUSES, true).setAllowInvalid(true).build());
  } catch (err) {
    log(`ℹ️ Could not put the Status dropdown on ${SHEET_NAMES.PROGRAM_WAITLIST} (${err}).`);
  }
  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  return sheet;
}

/** Is this Status one that is still on the list? Blank and anything unrecognized are. */
function isProgramWaitlistWaiting(status) {
  const s = String(status || '').trim().toLowerCase();
  return s !== 'placed' && s !== 'removed';
}

/**
 * { programKey: [entry, ...] } for every WAITING row, keyed the way the leader
 * sheets are (`leaderProgramKey`, title × building). Memoized per execution.
 *
 * NEVER CREATES THE TAB AND NEVER THROWS: this is read by the hourly push for
 * every registrant sheet, and a workbook that has never used the feature — or
 * a tab somebody has mangled — must cost that push nothing but an empty list.
 */
function readProgramWaitlistEntries() {
  if (__programWaitlistMemo) return __programWaitlistMemo;
  const out = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_WAITLIST);
    if (sheet) {
      const headers = HEADERS.Program_Waitlist;
      const map = getIndexMap(headers);
      readSimpleTable(sheet, headers).forEach(row => {
        const title = String(row[map['Program']] || '').trim();
        const name = String(row[map['Name']] || '').trim();
        if (!title || !name || !isProgramWaitlistWaiting(row[map['Status']])) return;
        const key = leaderProgramKey(title, row[map['Location']]);
        if (!out[key]) out[key] = [];
        out[key].push({
          name,
          phone: String(row[map['Phone']] || '').trim(),
          email: String(row[map['Email']] || '').trim(),
          partySize: row[map['Party_Size']],
          addedOn: coerceDate(row[map['Added_On']]),
          notes: String(row[map['Notes']] || '').trim()
        });
      });
    }
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.PROGRAM_WAITLIST} (${err}) — no program waiting lists this run.`);
  }
  __programWaitlistMemo = out;
  return out;
}

/** The waiting entries for one program, or []. */
function programWaitlistEntriesFor(title, location) {
  return readProgramWaitlistEntries()[leaderProgramKey(title, location)] || [];
}

/**
 * The phone and email the roll already holds for this name, for a desk that
 * typed only the name. Best effort: a roll that will not read is no reason to
 * refuse somebody a place on a list.
 */
function programWaitlistContactFromRoll_(name) {
  try {
    const headers = HEADERS.Member_Roll;
    const map = getIndexMap(headers);
    const key = normalizeNameKey(name);
    const hit = readMemberRollRows().rows.find(row =>
      normalizeNameKey(row[map['Name']]) === key ||
      (map['Display_Name'] !== undefined && normalizeNameKey(row[map['Display_Name']]) === key));
    if (!hit) return { phone: '', email: '' };
    return {
      phone: map['Phone'] === undefined ? '' : String(hit[map['Phone']] || '').trim(),
      email: map['Email'] === undefined ? '' : String(hit[map['Email']] || '').trim()
    };
  } catch (err) {
    return { phone: '', email: '' };
  }
}

/**
 * Quick Mark's "any date" box. Appends ONE row to Program_Waitlist and nothing
 * else — see the banner for why that is the whole of it.
 *
 * Refuses a second WAITING row for the same person on the same program: the
 * list is a queue, and the same name twice is somebody asked twice, not two
 * people. A Placed or Removed row does not count, so somebody who got a seat
 * in the autumn can wait again in the spring.
 */
function addProgramWaitlistEntryFromDialog(args) {
  const a = args || {};
  const title = String(a.title || '').trim();
  const location = String(a.location || '').trim();
  const name = String(a.name || '').replace(/\s+/g, ' ').trim();
  if (!title || !location) {
    return { ok: false, message: '⚠️ Choose a location and a program first. Nothing was added.' };
  }
  if (!name) return { ok: false, message: '⚠️ Type their name. Nothing was added.' };
  if (isLunchOnlyProgramTitle(title)) {
    return { ok: false, message: '⚠️ Lunch has no waiting list — sign them up for lunch instead. Nothing was added.' };
  }

  const already = programWaitlistEntriesFor(title, location)
    .some(e => normalizeNameKey(e.name) === normalizeNameKey(name));
  if (already) {
    return {
      ok: false,
      message: `ℹ️ ${name} is already on the waiting list for ${title} at ${location}. Nothing was added.`
    };
  }

  let phone = String(a.phone || '').trim();
  let email = String(a.email || '').trim();
  if (!phone || !email) {
    const known = programWaitlistContactFromRoll_(name);
    phone = phone || known.phone;
    email = email || known.email;
  }
  const size = Math.max(1, Math.min(20, parseInt(a.partySize, 10) || 1));

  const headers = HEADERS.Program_Waitlist;
  const map = getIndexMap(headers);
  const row = new Array(headers.length).fill('');
  row[map['Program']] = title;
  row[map['Location']] = location;
  row[map['Name']] = name;
  row[map['Phone']] = phone;
  row[map['Email']] = email;
  row[map['Party_Size']] = size;
  row[map['Status']] = PROGRAM_WAITLIST_STATUSES[0];
  row[map['Added_On']] = new Date();
  row[map['Added_By']] = getCurrentUserEmail() || 'Quick Mark';
  row[map['Notes']] = String(a.note || '').replace(/\s+/g, ' ').trim().slice(0, 500);

  try {
    const sheet = ensureProgramWaitlistTab_();
    // Written in the tab's OWN column order, read off its header row, so a
    // tab somebody has rearranged by hand is appended to correctly.
    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    const onSheet = sheet.getRange(MEMORY_TAB_HEADER_ROW, 1, 1, lastCol).getValues()[0]
      .map(h => String(h || '').trim());
    const out = onSheet.map(h => (map[h] === undefined ? '' : row[map[h]]));
    headers.forEach((h, i) => { if (onSheet.indexOf(h) === -1) out.push(row[i]); });
    sheet.appendRow(out);
  } catch (err) {
    log(`⚠️ Could not add ${name} to the waiting list for ${title} (${err}).`);
    return { ok: false, message: `⚠️ Could not add ${name} to the waiting list: ${err}` };
  }
  invalidateProgramWaitlistMemo_();

  const message = `✅ ${name} is on the waiting list for ${title} at ${location} — any date. ` +
    `No seat is held and no meal is ordered; it shows on the program's registrant sheet (Waitlist tab) ` +
    `after the next sync, and on the ${SHEET_NAMES.PROGRAM_WAITLIST} tab now.`;
  log(`addProgramWaitlistEntryFromDialog: ${message}`);
  return { ok: true, message };
}
