// ============================================================================
// 19. THE MEMBER ROLL ITSELF  (names, duplicates, retirement, pasting people in)
// ============================================================================
//
// Member_Roll is written in section 40 as one of the two "memory tabs", and
// that file is about what the two tabs SHARE: the recompute/staff split, the
// writer, the spare validation band. This file is about the one of them that
// is a roll of PEOPLE, and about the four things a roll of people needs that a
// roll of programs does not.
//
// A NAME IS TWO NAMES. Every form this workbook has ever generated asks for
// one string, so that is what the roll was: "Marion Delgado", sorted under M.
// A membership roll is sorted under D, addressed as "Marion", and merged into
// letters as two fields. First_Name/Last_Name are those fields, split out of
// Display_Name or Name (splitPersonName) wherever they are blank, and the
// staff's once written.
//
// THEY ARE NEVER COMPOSED BACK ONTO Name, and that is the one rule here worth
// stating twice. Name is the join key every other tab carries — what
// normalizeNameKey() is taken of, what a form response arrives under, what
// All_Registrants, Club_Members and Regular_Needs match on — and renaming
// somebody already has an owner: Display_Name, carried out across every tab by
// applyMemberNameCorrection() (section 77) under a confirmation, with the old
// spelling remembered for the responses still to come. A second rename path on
// this tab alone is exactly how a person's history is left behind under their
// old spelling.
//
// A DUPLICATE IS NOT A DELETION. "Bob Smith" and "bob smith " already collapse
// (normalizeNameKey), but "Robert Delgado" on one form and "R. Delgado" with
// the same telephone number on another are two rows with half a history each,
// and the half carrying the notes is usually the one nobody is looking at.
// mergeMemberRollRows() folds them together every time the tab is written —
// which is every sync, so "every so often" is "continuously" — and it is
// deliberately additive: counts add, dates widen to the earliest and the
// latest, locations union, notes concatenate, and every spelling that was
// absorbed is written into Merged_From so the merge can be read back. Nothing
// on this tab is ever dropped to make a merge tidy.
//
// RETIREMENT IS A SECTION, NOT A DELETE. Status says what happened (they
// retired, they moved, they died) and Retired_Date says when; the row keeps
// every note it has ever carried, sorts below the divider at the bottom of the
// tab, and stops being offered by the door's search box and Quick Mark's
// directory. Deleting the row would lose the history AND let the next form
// response recreate them as a stranger.
//
// PEOPLE ARRIVE ON PAPER. The office is handed a spreadsheet of new members
// several times a year, and the answer to that cannot be "type them in one at
// a time" or "paste them onto the tab and hope the columns line up". The
// import dialog at the bottom of this file is the same shape as the menu-item
// paste in section 11: paste or upload, see what was understood and which
// people are already on the roll, then commit.
//
// Behavior only, and numbered last for the usual reason: it defines its own
// constants and reads no other file's at load time, and everything it calls
// and everything that calls it is a hoisted function declaration.
// ============================================================================

/**
 * What a member's Status can say. A CLOSED list: the difference between
 * "Retired" and "Moved" is a note about a person, and a fifth spelling of one
 * of them is not a fifth status.
 *
 * Blank means Active, because that is what every row written before this
 * column existed means, and rewriting a thousand rows to say so is a migration
 * nobody needs. See memberRollIsRetired().
 */
const MEMBER_ROLL_STATUS_LIST = ['Active', 'Retired', 'Moved', 'Deceased'];

/**
 * The row that separates the two halves of the tab.
 *
 * It is a real row on the sheet, in the Name column, so that a person scrolling
 * the tab can see where the working roll stops — and it is therefore something
 * every reader of the tab must not mistake for a member, which is what
 * isMemberRollDividerValue() is for (readSimpleTable and readSimpleTableValues
 * both filter on it, and so does everything in this file).
 */
const MEMBER_ROLL_RETIRED_DIVIDER =
  '--- RETIRED --- (kept for their history, not offered at the door)';

/** True for the divider row's Name cell, and for nothing a person is called. */
function isMemberRollDividerValue(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return false;
  return text === MEMBER_ROLL_RETIRED_DIVIDER || text.indexOf('--- RETIRED ---') === 0;
}

// ---------------------------------------------------------------------------
// 19a. One name, two names
// ---------------------------------------------------------------------------

/**
 * Name suffixes that belong WITH the last name, not after it.
 *
 * "Delgado Jr" is a surname with a suffix on it: filed under D, addressed as
 * Marion, and printed on a sign-in sheet with the Jr still attached. Taking the
 * last word as the surname without this list files half a dozen people in this
 * roll under J.
 */
const NAME_SUFFIXES = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv',
  'md', 'm.d.', 'phd', 'ph.d.', 'rn', 'esq', 'esq.', 'dds', 'do'];

/**
 * Words that begin a MULTI-WORD surname. "Van Der Berg", "de la Cruz". The
 * rule is that once a particle is seen, everything from there on is the
 * surname — which is right for every one of these, and wrong only for a FIRST
 * name that is itself a particle, of which this roll has none.
 */
const NAME_PARTICLES = ['van', 'von', 'de', 'del', 'della', 'di', 'da', 'dos', 'du',
  'la', 'le', 'los', 'las', 'st', 'st.', 'saint', 'mac', 'ter', 'ten', 'op'];

/** Honorifics a form picks up and a roll does not want inside a first name. */
const NAME_PREFIXES = ['mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'dr', 'dr.', 'rev', 'rev.'];

/**
 * One string into { first, last }.
 *
 * Handles the three shapes a roll actually receives: "First Last", "Last,
 * First" (which is how most lists the office is handed arrive), and a single
 * word — which becomes the LAST name, because a roll sorted by surname has to
 * put a one-word name somewhere and under its own initial is where somebody
 * will look for it.
 *
 * A middle name or initial stays with the first name rather than being thrown
 * away: this workbook's job is to keep what it was told, and "Mary Ellen" is
 * one person's first name at least as often as it is two words.
 */
function splitPersonName(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!text) return { first: '', last: '' };

  // "Delgado, Marion" — the comma is unambiguous, so it wins outright.
  const comma = text.indexOf(',');
  if (comma > -1) {
    const last = text.slice(0, comma).trim();
    const first = text.slice(comma + 1).trim();
    // "Delgado, Jr" is a suffix, not a first name — fall through to the
    // word-by-word reading, which knows what to do with it.
    if (last && first && NAME_SUFFIXES.indexOf(first.toLowerCase()) === -1) {
      return { first: first, last: last };
    }
  }

  let words = text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  // A leading honorific is not part of anybody's first name.
  while (words.length > 1 && NAME_PREFIXES.indexOf(words[0].toLowerCase()) > -1) words = words.slice(1);
  if (words.length === 1) return { first: '', last: words[0] };

  // Peel the suffixes off the end; they go back on the end of the last name.
  // Down to ONE remaining word, because "Delgado Jr" with no first name is a
  // surname and a suffix, not a first name called Delgado.
  const suffixes = [];
  while (words.length > 1 && NAME_SUFFIXES.indexOf(words[words.length - 1].toLowerCase()) > -1) {
    suffixes.unshift(words.pop());
  }
  if (words.length === 1) return { first: '', last: words.concat(suffixes).join(' ') };

  // The surname starts at the first particle, or at the last word.
  let start = words.length - 1;
  for (let i = 1; i < words.length - 1; i++) {
    if (NAME_PARTICLES.indexOf(words[i].toLowerCase()) > -1) { start = i; break; }
  }
  const first = words.slice(0, start).join(' ');
  const last = words.slice(start).concat(suffixes).join(' ');
  return { first: first.trim(), last: last.trim() };
}

/**
 * { first, last } back into the one string this workbook keys on.
 *
 * "First Last" — the order a person is called, not the order the tab is sorted
 * in — because Name is what appears on a sign-in sheet, in a Quick Mark
 * dropdown and in the door's search box, and every one of those is read aloud.
 */
function composeMemberName(first, last) {
  const f = String(first || '').replace(/\s+/g, ' ').trim();
  const l = String(last || '').replace(/\s+/g, ' ').trim();
  return [f, l].filter(Boolean).join(' ');
}

/**
 * Fills in whichever half of a row's name is missing. Returns true when it
 * changed something.
 *
 * The parts are derived from Display_Name where the office has written one,
 * and from Name otherwise — Display_Name IS the corrected spelling, so
 * splitting the uncorrected one would file somebody under a surname the office
 * has already said is wrong.
 *
 * Nothing here writes Name. A split is a guess; Name is the key every other
 * tab in this workbook is matched on, and the one thing allowed to change it
 * is applyMemberNameCorrection() (section 77), which changes it everywhere at
 * once. A row whose parts a person has since corrected sorts and addresses by
 * those parts, and its Name follows only when somebody puts the correction
 * through Display_Name.
 */
function backfillMemberNameParts(row, map) {
  if (map['First_Name'] === undefined || map['Last_Name'] === undefined) return false;
  const first = String(row[map['First_Name']] || '').trim();
  const last = String(row[map['Last_Name']] || '').trim();
  if (first || last) {
    const changed = first !== row[map['First_Name']] || last !== row[map['Last_Name']];
    row[map['First_Name']] = first;
    row[map['Last_Name']] = last;
    return changed;
  }
  const display = map['Display_Name'] === undefined ? '' : String(row[map['Display_Name']] || '').trim();
  const source = display || String(row[map['Name']] || '').trim();
  if (!source) return false;
  const parts = splitPersonName(source);
  row[map['First_Name']] = parts.first;
  row[map['Last_Name']] = parts.last;
  return !!(parts.first || parts.last);
}

// ---------------------------------------------------------------------------
// 19b. Retired, and where retired rows go
// ---------------------------------------------------------------------------

/** A row's Status, normalized to one of MEMBER_ROLL_STATUS_LIST. Blank reads as Active. */
function memberRollStatus(row, map) {
  if (!map || map['Status'] === undefined) return 'Active';
  const text = String(row[map['Status']] || '').trim();
  if (!text) return 'Active';
  const match = MEMBER_ROLL_STATUS_LIST.filter(s => s.toLowerCase() === text.toLowerCase())[0];
  // An unrecognized word is KEPT as written rather than corrected to Active:
  // somebody typed it for a reason, and reading it as "still coming" is the one
  // wrong answer — they would be mailed, invited, and expected at the door.
  return match || text;
}

/** Is this person off the working roll? Anything that is not Active is. */
function memberRollIsRetired(row, map) {
  return memberRollStatus(row, map) !== 'Active';
}

/**
 * The two halves of the tab, each sorted by SURNAME then first name — which is
 * how a roll is read, and half the point of splitting the name at all.
 */
function orderMemberRollRows(rows, map) {
  const sortKey = row => {
    const last = String(row[map['Last_Name']] || '').trim().toLowerCase();
    const first = String(row[map['First_Name']] || '').trim().toLowerCase();
    // A row whose parts have not been filled in yet still has to sort
    // somewhere sensible, so fall back to the name as written.
    return `${last || String(row[map['Name']] || '').trim().toLowerCase()}${first}`;
  };
  const active = [];
  const retired = [];
  (rows || []).forEach(row => { (memberRollIsRetired(row, map) ? retired : active).push(row); });
  active.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  retired.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { active: active, retired: retired };
}

/**
 * Retires somebody: the status, the date, and nothing else touched.
 *
 * The date is stamped only where there is not one already, deliberately — this
 * runs from a pasted list that may name people who stopped coming last year,
 * and "retired on the day the office happened to re-import a list" is worse
 * than no date at all.
 */
function retireMemberRow(row, map, status, when) {
  row[map['Status']] = status || 'Retired';
  if (!String(row[map['Retired_Date']] || '').trim()) {
    row[map['Retired_Date']] = when || new Date();
  }
  return row;
}

// ---------------------------------------------------------------------------
// 19c. The dedupe
// ---------------------------------------------------------------------------

/**
 * The keys one row can be recognized by: its name, and its contact details
 * PAIRED with enough of a name to be safe.
 *
 * A shared telephone number is the reason for the pairing. Much of this roll
 * lives with somebody else on it, so "same number" alone merges a married
 * couple into one person and loses one of them. "Same number AND same surname
 * AND same first initial" is the narrow case that really is a duplicate:
 * R. Delgado and Robert Delgado, entered on two different mornings.
 */
function memberRollMatchKeys(row, map) {
  const name = String(row[map['Name']] || '').trim();
  const last = String(row[map['Last_Name']] || '').trim().toLowerCase();
  const first = String(row[map['First_Name']] || '').trim().toLowerCase();
  const keys = [];
  const nameKey = normalizeNameKey(name);
  if (nameKey) keys.push(`n:${nameKey}`);
  if (last && first) {
    const initial = `${last}|${first.charAt(0)}`;
    // The same two contact keys the household grouping is built on
    // (section 77), for the same reason: a number is an identity only as its
    // last ten digits, and an address only lowercased.
    const phone = householdPhoneKey(row[map['Phone']]);
    const email = householdEmailKey(row[map['Email']]);
    if (phone) keys.push(`p:${initial}|${phone}`);
    if (email) keys.push(`e:${initial}|${email}`);
  }
  return keys;
}

/** Joins two notes without losing either, and without repeating one. */
function mergeNoteText(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left) return right;
  if (!right || left.indexOf(right) > -1) return left;
  return `${left} | ${right}`;
}

/** Unions two comma-separated lists (Locations, Merged_From), sorted, no duplicates. */
function mergeListText(a, b) {
  const seen = {};
  `${a || ''},${b || ''}`.split(',').forEach(part => {
    const text = part.trim();
    if (text) seen[text] = true;
  });
  return Object.keys(seen).sort().join(', ');
}

/**
 * Folds `extra` into `target`, in place. ADDITIVE IN EVERY COLUMN — the rule
 * this whole file is written around is that a merge must never be a way to
 * lose something.
 *
 * Counts add. First_Seen takes the earliest and Last_Seen the latest, so the
 * merged row's history spans both. Locations union. A blank contact detail is
 * filled in from the other row and a non-blank one is kept (the row that
 * survives is the one with the longer history, so its number is the
 * better-attested one). Notes concatenate.
 *
 * Retirement survives a merge only when BOTH rows agree on it. One stale line
 * in a pasted list must not retire somebody who is still coming on Tuesdays,
 * and the workbook can always be told again.
 */
function mergeMemberRollRow(target, extra, map) {
  const targetTimes = Number(target[map['Times_Seen']]) || 0;
  const extraTimes = Number(extra[map['Times_Seen']]) || 0;
  target[map['Times_Seen']] = targetTimes + extraTimes;

  const first = [coerceDate(target[map['First_Seen']]), coerceDate(extra[map['First_Seen']])].filter(Boolean);
  const last = [coerceDate(target[map['Last_Seen']]), coerceDate(extra[map['Last_Seen']])].filter(Boolean);
  if (first.length) target[map['First_Seen']] = first.sort((a, b) => a - b)[0];
  if (last.length) target[map['Last_Seen']] = last.sort((a, b) => b - a)[0];

  target[map['Locations']] = mergeListText(target[map['Locations']], extra[map['Locations']]);

  // A blank one is filled in from the other row; a filled one is kept, because
  // the row that survives is the one with the longer history and its details
  // are the better-attested. Display_Name/Nickname/Household_Override are on
  // this list rather than the notes list below for the same reason: they are
  // single answers, not accumulating text.
  ['Phone', 'Email', 'Usual_Guests', 'First_Name', 'Last_Name',
   'Display_Name', 'Nickname', 'Household_Override'].forEach(header => {
    if (map[header] === undefined) return;
    if (String(target[map[header]] || '').trim()) return;
    target[map[header]] = extra[map[header]];
  });
  ['Dietary_Notes', 'Contact', 'Staff_Notes'].forEach(header => {
    target[map[header]] = mergeNoteText(target[map[header]], extra[map[header]]);
  });

  if (memberRollIsRetired(target, map) && memberRollIsRetired(extra, map)) {
    const dates = [coerceDate(target[map['Retired_Date']]), coerceDate(extra[map['Retired_Date']])]
      .filter(Boolean);
    if (dates.length) target[map['Retired_Date']] = dates.sort((a, b) => a - b)[0];
  } else {
    target[map['Status']] = 'Active';
    target[map['Retired_Date']] = '';
  }

  // The receipt. Every other spelling this row has absorbed, so that a merge is
  // something a person can read back and disagree with, rather than a row that
  // quietly stopped existing.
  const absorbed = String(extra[map['Name']] || '').trim();
  const keep = String(target[map['Name']] || '').trim();
  if (absorbed && absorbed !== keep) {
    target[map['Merged_From']] = mergeListText(target[map['Merged_From']], absorbed);
  }
  target[map['Merged_From']] = mergeListText(target[map['Merged_From']], extra[map['Merged_From']]);
  return target;
}

/**
 * The whole roll, deduplicated. Returns { rows, merges } — `merges` is one
 * entry per fold, { kept, absorbed }, which is what the log line and the
 * dialog's summary are built from.
 *
 * The row that SURVIVES a fold is the one with the longer history (Times_Seen),
 * because that is the row the rest of the workbook's registrant history has
 * been accumulating against.
 */
function mergeMemberRollRows(rows, map) {
  const groups = [];   // [{ row }], index-aligned with the values in byKey
  const byKey = {};
  const merges = [];

  (rows || []).forEach(row => {
    if (isMemberRollDividerValue(row[map['Name']])) return;
    backfillMemberNameParts(row, map);
    const keys = memberRollMatchKeys(row, map);
    if (!keys.length) return; // no name and no contact details is not a person

    let index = -1;
    for (let i = 0; i < keys.length && index === -1; i++) {
      if (byKey[keys[i]] !== undefined) index = byKey[keys[i]];
    }

    if (index === -1) {
      groups.push({ row: row });
      const at = groups.length - 1;
      keys.forEach(key => { if (byKey[key] === undefined) byKey[key] = at; });
      return;
    }

    // Which of the two rows stays.
    const group = groups[index];
    const groupTimes = Number(group.row[map['Times_Seen']]) || 0;
    const rowTimes = Number(row[map['Times_Seen']]) || 0;
    let kept = group.row;
    let absorbed = row;
    if (rowTimes > groupTimes) { kept = row; absorbed = group.row; }
    const keptName = String(kept[map['Name']] || '').trim();
    const absorbedName = String(absorbed[map['Name']] || '').trim();

    mergeMemberRollRow(kept, absorbed, map);
    group.row = kept;
    // The merged row answers to both rows' keys from here on, so a THIRD
    // spelling that matches either of them finds this group rather than
    // starting a second one.
    keys.concat(memberRollMatchKeys(kept, map)).forEach(key => {
      if (byKey[key] === undefined) byKey[key] = index;
    });
    if (absorbedName && absorbedName !== keptName) {
      merges.push({ kept: keptName, absorbed: absorbedName });
    }
  });

  return { rows: groups.map(g => g.row), merges: merges };
}

// ---------------------------------------------------------------------------
// 19d. Writing the tab
// ---------------------------------------------------------------------------

/**
 * THE ONE WRITER. Every path that puts rows on Member_Roll comes through here
 * — the sync's refresh (section 40), the door's recordWalkInMember()
 * (section 74), the paste dialog below, and the menu's dedupe — so that the tab
 * cannot come back sorted one way from one of them and another way from the
 * next, and so that a duplicate created by any of them is folded in by the same
 * rules within the same write.
 *
 * Returns { active, retired, merges } for the caller's log line.
 */
function writeMemberRollTab(sheet, rows) {
  const headers = HEADERS.Member_Roll;
  const map = getIndexMap(headers);

  const merged = mergeMemberRollRows(rows, map);
  const ordered = orderMemberRollRows(merged.rows, map);

  const out = ordered.active.slice();
  if (ordered.retired.length > 0) {
    const divider = new Array(headers.length).fill('');
    divider[map['Name']] = MEMBER_ROLL_RETIRED_DIVIDER;
    out.push(divider);
    ordered.retired.forEach(row => out.push(row));
  }

  // AFTER the dedupe, never before: who shares a telephone number with whom is
  // a fact about the roll as it will be drawn, and stamping households onto
  // rows that are about to be folded together puts a person in a household
  // with themselves. See stampMemberHouseholds() (section 40).
  stampMemberHouseholds(out, headers);

  writeMemoryTab(sheet, headers, out, memberRollTabOptions());
  applyMemoryTabValidation(sheet, headers, out.length, {
    lists: { Status: MEMBER_ROLL_STATUS_LIST }
  });
  styleMemberRollDivider(sheet, headers, ordered.active.length, ordered.retired.length);

  // WHAT MAKES A MERGE STICK. Folding two rows together on this tab does not
  // by itself change the registrant history both spellings are keyed to, so
  // the refresh would rebuild the absorbed row on the very next sync. The
  // correction map is what stops that: refreshMemberRoll() reads every
  // registrant name through canonicalMemberName(), and so does a form response
  // being turned into rows (section 29), so from here on both spellings arrive
  // as the one that was kept. Nothing else about the person is touched — the
  // rows on the other tabs keep the words they were written with, which is
  // what applyMemberNameCorrection() is for when somebody wants them rewritten.
  merged.merges.forEach(m => rememberMemberNameCorrection(m.absorbed, m.kept));

  // Every list built off this tab is now a spelling — or a household — out of date.
  invalidateWalkInMembersMemo();
  invalidateHouseholdIndexMemo();
  if (merged.merges.length) invalidateQuickMarkIndexCache();
  return { active: ordered.active.length, retired: ordered.retired.length, merges: merged.merges };
}

/**
 * Draws the divider as a divider. Without this it is a member whose name is a
 * row of dashes, which is exactly the sort of thing somebody deletes.
 */
function styleMemberRollDivider(sheet, headers, activeCount, retiredCount) {
  if (!(retiredCount > 0)) return;
  const row = MEMORY_TAB_DATA_ROW + activeCount;
  if (row > sheet.getMaxRows()) return;
  try {
    sheet.getRange(row, 1, 1, headers.length)
      .setBackground(PALETTE.DISABLED)
      .setFontWeight('bold')
      .setFontColor(PALETTE.INK_MUTED);
  } catch (err) {
    log(`ℹ️ Could not style the Member_Roll divider (${err}) — the tab is otherwise fine.`);
  }
}

/**
 * Reads the roll off the sheet as rows, divider excluded. The one read every
 * writer in this file starts from.
 */
function readMemberRollRows(ss) {
  const sheet = getOrCreateSheet(ss || SpreadsheetApp.getActiveSpreadsheet(), SHEET_NAMES.MEMBER_ROLL);
  return { sheet: sheet, rows: readSimpleTable(sheet, HEADERS.Member_Roll) };
}

/**
 * The menu's "merge duplicates now". The dedupe already runs on every write —
 * this is for the afternoon somebody has just pasted a list in and wants to see
 * the number before they trust it.
 */
function dedupeMemberRollNow() {
  const ui = SpreadsheetApp.getUi();
  const result = withScriptLock(DESK_LOCK_WAIT_MS, () => {
    const read = readMemberRollRows();
    return writeMemberRollTab(read.sheet, read.rows);
  }, null);
  if (!result) {
    ui.alert('The workbook is mid-update, so the member roll was left alone. Try again in a minute.');
    return;
  }
  const merges = result.merges;
  const detail = merges.length
    ? `\n\n${merges.slice(0, 12).map(m => `• ${m.absorbed} → ${m.kept}`).join('\n')}` +
      (merges.length > 12 ? `\n… and ${merges.length - 12} more.` : '') +
      '\n\nEvery merged row kept its notes, and the names it absorbed are in Merged_From.'
    : '';
  log(`dedupeMemberRollNow: ${merges.length} merged, ${result.active} active, ${result.retired} retired.`);
  ui.alert('Member Roll',
    `${merges.length} duplicate row(s) merged.\n` +
    `${result.active} active member(s), ${result.retired} retired.${detail}`,
    ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// 19e. Pasting people in
// ---------------------------------------------------------------------------

/**
 * The columns a pasted list can be mapped onto, and what each is called on the
 * dialog. Name is offered as well as the two parts because many of the lists
 * the office is handed have one column, and splitPersonName() is a better
 * answer than asking somebody to split three hundred rows by hand.
 */
const MEMBER_IMPORT_FIELDS = [
  { key: 'Ignore', label: '(ignore this column)' },
  { key: 'First_Name', label: 'First name' },
  { key: 'Last_Name', label: 'Last name' },
  { key: 'Name', label: 'Full name (split automatically)' },
  { key: 'Phone', label: 'Phone' },
  { key: 'Email', label: 'Email' },
  { key: 'Contact', label: 'Who to contact / how' },
  { key: 'Dietary_Notes', label: 'Dietary notes' },
  { key: 'Usual_Guests', label: 'Usual guests' },
  { key: 'Staff_Notes', label: 'Staff notes' },
  { key: 'Status', label: 'Status (Active / Retired / Moved / Deceased)' }
];

/** What a header cell has to say for a column to be mapped without being asked. */
const MEMBER_IMPORT_HEADER_HINTS = {
  First_Name: ['first', 'first name', 'firstname', 'given', 'given name', 'fname'],
  Last_Name: ['last', 'last name', 'lastname', 'surname', 'family', 'family name', 'lname'],
  Name: ['name', 'full name', 'member', 'member name', 'person'],
  Phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone number'],
  Email: ['email', 'e mail', 'email address'],
  Contact: ['contact', 'emergency contact', 'next of kin'],
  Dietary_Notes: ['diet', 'dietary', 'dietary notes', 'allergies', 'allergy'],
  Usual_Guests: ['guest', 'guests', 'usual guests'],
  Staff_Notes: ['notes', 'staff notes', 'comment', 'comments'],
  Status: ['status', 'membership status', 'active']
};

/** Guesses one column's field from its header cell. 'Ignore' when nothing is obvious. */
function guessMemberImportField(headerCell) {
  const text = String(headerCell || '').trim().toLowerCase()
    .replace(/[_.\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Ignore';
  const keys = Object.keys(MEMBER_IMPORT_HEADER_HINTS);
  for (let i = 0; i < keys.length; i++) {
    if (MEMBER_IMPORT_HEADER_HINTS[keys[i]].indexOf(text) > -1) return keys[i];
  }
  return 'Ignore';
}

/**
 * Does the first record look like a header line rather than a person?
 *
 * Two of its cells naming known fields is the test: a list whose first row is
 * "Jane, Smith, 610-555-0100" names none of them, and a list whose first row is
 * "First, Last, Phone" names three.
 */
function looksLikeMemberImportHeader(record) {
  const named = (record || []).filter(cell => guessMemberImportField(cell) !== 'Ignore').length;
  return named >= 2;
}

/** The columns a headerless paste is assumed to be, in order. */
const MEMBER_IMPORT_DEFAULT_MAPPING = ['Name', 'Phone', 'Email', 'Staff_Notes'];

/**
 * Parses pasted text into what the dialog shows BEFORE anything is written:
 * the columns, how each was understood, the first rows as they would land, and
 * which of them are people the roll already knows. Touches the sheet only to
 * read the roll it is matching against.
 */
function previewMemberRollPaste(text, mappingOverride) {
  const records = parseCsvText(text)
    .filter(record => record.filter(cell => String(cell || '').trim()).length > 0);
  if (records.length === 0) {
    return { ok: false, message: '⚠️ Nothing to add — no rows found in that text.' };
  }

  const hasHeader = looksLikeMemberImportHeader(records[0]);
  const headerRow = hasHeader ? records[0] : [];
  const body = hasHeader ? records.slice(1) : records;
  const width = records.reduce((n, record) => Math.max(n, record.length), 0);

  const mapping = [];
  for (let i = 0; i < width; i++) {
    if (mappingOverride && mappingOverride[i]) mapping.push(mappingOverride[i]);
    else if (hasHeader) mapping.push(guessMemberImportField(headerRow[i]));
    else mapping.push(MEMBER_IMPORT_DEFAULT_MAPPING[i] || 'Ignore');
  }

  const map = getIndexMap(HEADERS.Member_Roll);
  const existing = {};
  try {
    readMemberRollRows().rows.forEach(row => {
      backfillMemberNameParts(row, map);
      memberRollMatchKeys(row, map).forEach(key => {
        existing[key] = String(row[map['Name']] || '').trim();
      });
    });
  } catch (err) {
    log(`ℹ️ Member import preview could not read the roll (${err}) — everyone will show as new.`);
  }

  const rows = [];
  body.forEach(record => {
    const person = buildMemberImportRow(record, mapping, map);
    if (!person) return;
    const hit = memberRollMatchKeys(person, map).map(key => existing[key]).filter(Boolean)[0] || '';
    rows.push({
      first: String(person[map['First_Name']] || ''),
      last: String(person[map['Last_Name']] || ''),
      phone: String(person[map['Phone']] || ''),
      email: String(person[map['Email']] || ''),
      status: memberRollStatus(person, map),
      matches: hit
    });
  });

  const columns = [];
  for (let i = 0; i < width; i++) {
    columns.push(hasHeader ? String(headerRow[i] || `Column ${i + 1}`) : `Column ${i + 1}`);
  }

  return {
    ok: rows.length > 0,
    message: rows.length > 0 ? '' :
      '⚠️ No usable rows — at least one column has to be a name.',
    columns: columns,
    mapping: mapping,
    fields: MEMBER_IMPORT_FIELDS,
    rows: rows.slice(0, MEMBER_IMPORT_PREVIEW_ROWS),
    total: rows.length,
    matched: rows.filter(row => row.matches).length
  };
}

/** How many parsed people the dialog shows. Enough to spot a mis-mapped column. */
const MEMBER_IMPORT_PREVIEW_ROWS = 25;

/**
 * One pasted record into a Member_Roll row, or null when it names nobody.
 *
 * A record with contact details and no name is dropped rather than added as a
 * blank person: the roll is keyed on the name, and a nameless row is a row
 * nothing can ever find again.
 */
function buildMemberImportRow(record, mapping, map) {
  const headers = HEADERS.Member_Roll;
  const row = new Array(headers.length).fill('');
  let full = '';
  (mapping || []).forEach((field, i) => {
    if (!field || field === 'Ignore') return;
    const value = String(record[i] === undefined || record[i] === null ? '' : record[i]).trim();
    if (!value) return;
    if (field === 'Name') { full = value; return; }
    if (map[field] === undefined) return;
    row[map[field]] = row[map[field]] ? mergeNoteText(row[map[field]], value) : value;
  });

  const first = String(row[map['First_Name']] || '').trim();
  const last = String(row[map['Last_Name']] || '').trim();
  if (!first && !last && full) {
    const parts = splitPersonName(full);
    row[map['First_Name']] = parts.first;
    row[map['Last_Name']] = parts.last;
  }
  row[map['Name']] = composeMemberName(row[map['First_Name']], row[map['Last_Name']]) || full;
  if (!String(row[map['Name']] || '').trim()) return null;

  const status = memberRollStatus(row, map);
  row[map['Status']] = status;
  if (status !== 'Active' && !String(row[map['Retired_Date']] || '').trim()) {
    row[map['Retired_Date']] = new Date();
  }
  // Zero, not one: Times_Seen counts registrations on file, and a pasted person
  // has none yet. The next refresh counts their first.
  row[map['Times_Seen']] = 0;
  return row;
}

/**
 * Commits a previewed paste. Pasted people are folded into the roll by exactly
 * the dedupe every other write uses, so a list the office pastes twice adds
 * nobody the second time — and loses nothing either.
 */
function importMemberRollPaste(text, mapping) {
  const preview = previewMemberRollPaste(text, mapping);
  if (!preview.ok) return preview.message || '⚠️ Nothing was added.';

  const records = parseCsvText(text)
    .filter(record => record.filter(cell => String(cell || '').trim()).length > 0);
  const body = looksLikeMemberImportHeader(records[0]) ? records.slice(1) : records;
  const map = getIndexMap(HEADERS.Member_Roll);

  const result = withScriptLock(DESK_LOCK_WAIT_MS, () => {
    const read = readMemberRollRows();
    const rows = read.rows;
    const before = rows.length;
    body.forEach(record => {
      const person = buildMemberImportRow(record, preview.mapping, map);
      if (person) rows.push(person);
    });
    const written = writeMemberRollTab(read.sheet, rows);
    return { added: rows.length - before, written: written };
  }, null);

  if (!result) return '⚠️ The workbook is mid-update, so nobody was added. Try again in a minute.';

  const merged = result.written.merges.length;
  log(`importMemberRollPaste: ${result.added} pasted, ${merged} folded into existing rows.`);
  return `✅ ${result.added} row(s) read, ${merged} folded into people already on the roll. ` +
    `${result.written.active} active member(s), ${result.written.retired} retired. ` +
    `Nothing was overwritten — anything merged kept both sets of notes.`;
}

/** The dialog. Open to everyone: adding members deletes nothing. */
function showMemberRollImportDialog() {
  const html = HtmlService.createHtmlOutput(buildMemberRollImportHtml())
    .setWidth(720)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Members to the Roll');
}

/**
 * The dialog's markup. Inline, like every other dialog in this project.
 *
 * Nothing from the workbook is interpolated into this page — the preview is
 * fetched at runtime and written with textContent/escaped strings on the
 * client — so a member called O'Brien, or one whose notes contain a `</script>`,
 * cannot end the page mid-sentence. See tests/check_in_page.test.js for what
 * that rule is protecting.
 */
function buildMemberRollImportHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
  textarea { width: 100%; height: 140px; font-family: Consolas, Menlo, monospace; font-size: 12px;
             box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
  .row { margin: 10px 0; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-right: 6px; }
  button.secondary { background: #5f6368; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-bottom: 8px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f3f4; }
  .match { color: #b06000; }
  #preview { max-height: 250px; overflow: auto; margin-top: 8px; }
  #status { margin-top: 10px; min-height: 18px; font-weight: bold; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Paste your list, or choose a .csv file</h3>
<p class="hint">
  One line per person. A header line is read and used to line the columns up:
  <code>First, Last, Phone, Email</code> and <code>Name, Phone, Email</code> both work,
  and so does <code>Smith, Jane</code> in a single column.
  Check what was understood before you add it — you can change any column above the preview.
  Nobody already on the roll is duplicated, and nothing on their row is overwritten.
</p>
<div class="row"><input type="file" id="file" accept=".csv,.txt,text/csv"></div>
<textarea id="csv" placeholder="First,Last,Phone,Email
Jane,Smith,610-555-0100,jane@example.com
Robert,Delgado Jr,610-555-0182,"></textarea>
<div class="row">
  <button id="go" onclick="preview()">Check what this says</button>
  <button id="commit" class="secondary" onclick="commit()" disabled>Add to Member Roll</button>
</div>
<div id="preview"></div>
<div id="status"></div>
<script>
  var MAPPING = null;
  var FIELDS = [];

  document.getElementById('file').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { document.getElementById('csv').value = reader.result; };
    reader.readAsText(f);
  });

  function text() { return document.getElementById('csv').value; }

  function preview() {
    if (!text().trim()) { say('Nothing to add — paste some rows first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Reading…', '');
    google.script.run
      .withSuccessHandler(draw)
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .previewMemberRollPaste(text(), MAPPING);
  }

  function draw(result) {
    document.getElementById('go').disabled = false;
    if (!result.ok) {
      say(result.message, 'err');
      document.getElementById('commit').disabled = true;
      return;
    }
    MAPPING = result.mapping;
    FIELDS = result.fields;

    var html = '<table><tr>';
    result.columns.forEach(function (col, i) {
      html += '<th>' + esc(col) + '<br><select data-col="' + i + '" onchange="remap(this)">' +
        FIELDS.map(function (f) {
          return '<option value="' + esc(f.key) + '"' + (f.key === MAPPING[i] ? ' selected' : '') +
            '>' + esc(f.label) + '</option>';
        }).join('') + '</select></th>';
    });
    html += '</tr></table>';

    html += '<table><tr><th>First</th><th>Last</th><th>Phone</th><th>Email</th>' +
      '<th>Status</th><th>Already on the roll</th></tr>';
    result.rows.forEach(function (r) {
      html += '<tr><td>' + esc(r.first) + '</td><td>' + esc(r.last) + '</td><td>' + esc(r.phone) +
        '</td><td>' + esc(r.email) + '</td><td>' + esc(r.status) +
        '</td><td class="match">' + esc(r.matches || '') + '</td></tr>';
    });
    html += '</table>';

    document.getElementById('preview').innerHTML = html;
    document.getElementById('commit').disabled = false;
    say(result.total + ' person(s) read, ' + result.matched + ' already on the roll' +
      (result.total > result.rows.length ? ' (first ' + result.rows.length + ' shown)' : '') + '.', 'ok');
  }

  function remap(select) {
    MAPPING[Number(select.getAttribute('data-col'))] = select.value;
    preview();
  }

  function commit() {
    document.getElementById('commit').disabled = true;
    say('Adding…', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('commit').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .importMemberRollPaste(text(), MAPPING);
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}
