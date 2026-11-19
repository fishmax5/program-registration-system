// ============================================================================
// 99zzc. ONE PROGRAM, MORE THAN ONE TITLE  (Also_Known_As — November 2026)
// ============================================================================
//
// THE FAULT. A program's roster, its leaders, its waiting list and its roster
// page are all filed under leaderProgramKey(title, location) (`46`), and the
// title in that key is whatever the calendar event says. Two live titles for
// one program are two programs to everything downstream:
//
//   Medicare Counseling at Ashbridge ran as "Medicare Counseling (by appt.)"
//   on Nov 17 and "Medicare Counseling" on Dec 1. One rolling appointment form
//   took both sign-ups, and the leader got TWO registrant sheets.
//
//   "CANCELLED DUE TO ILLNESS:T'ai Chi 1 - Open to All" — a status word typed
//   into one date's title — made that date a program of its own.
//
// `22`'s rename detection cannot help with either, by design: it acts only when
// the old title has gone from every calendar, and here both are live. Nor can
// the key be the form: a monthly program gets a new form every month and one
// lunch form covers twenty menus (see ROSTER_KEYING_PROPOSAL in the project
// notes for the numbers).
//
// SO STAFF SAY IT, ONCE, WHERE THE PROGRAM ALREADY LIVES. Program_Settings has
// one row per program at a building; its Also_Known_As cell (staff-owned,
// carried across every redraw) lists the other titles that mean this program,
// comma-separated. canonicalProgramTitle() turns any of them into the row's
// Event, at the same building only — the privacy boundary stays one program at
// one location — and leaderProgramKey() files by that. Every one of its call
// sites (rosters, Program_Leaders, notifications, waiting list, roster pages,
// the month dashboard, the doctor) follows at once.
//
// A STATUS WORD BEFORE A COLON is not part of the program's name either:
// "CANCELLED…: X" and "CANCELED - illness: X" file as X with nobody typing an
// alias. Only with a colon, and only when something is left after it.
//
// WHAT THIS DOES NOT TOUCH. Event_ID is still md5(calendar | title | date)
// (`07`): changing what a session's title means to the Event_ID would re-key
// its registrants and sweep them to triage, which is the opposite of the
// point. This is the PROGRAM layer only. Nor does it yet touch Program_Settings'
// own lookups, Program_Questions or club keys — the next change does.
//
// AMBIGUITY IS REFUSED, NOT GUESSED. A title listed under two different
// programs at one building is ignored (and said once per execution), because
// filing somebody's sign-up under the wrong leader's roster is the one mistake
// here that would show a person's name to somebody it should not.
//
// LOAD ORDER. Behavior plus self-contained constants; HEADERS, SHEET_NAMES and
// the readers it uses are reached at call time. The memo is a `var` without an
// initializer so a call before this file has evaluated finds it undefined.
// ============================================================================

/** "CANCELLED DUE TO ILLNESS: X", "Canceled - weather: X", "CANCELLED:X" → X. */
const PROGRAM_STATUS_PREFIX_REGEX = /^\s*cancel{1,2}ed\b[^:]{0,60}:\s*/i;

/** What separates two titles in one Also_Known_As cell. */
const PROGRAM_ALIAS_SEPARATOR_REGEX = /\s*[,;\n]\s*/;

// Per execution. See LOAD ORDER.
var __programAliasIndex;

/** Forgets the memo — after Program_Settings is rewritten, and between tests. */
function invalidateProgramAliasIndex() {
  __programAliasIndex = undefined;
}

function programAliasLookupKey_(title, location) {
  return `${normalizeNameKey(title)}|${normalizeNameKey(location)}`;
}

/**
 * Pure. Program_Settings rows (projected onto HEADERS.Program_Settings) →
 * { aliases: { 'alias|location': canonicalTitle }, ambiguous: ['alias|location'] }.
 */
function buildProgramAliasIndex(rows, headers) {
  const map = getIndexMap(headers || HEADERS.Program_Settings);
  const aliases = {};
  const ambiguous = {};
  if (map['Also_Known_As'] === undefined) return { aliases, ambiguous: [] };
  (rows || []).forEach(row => {
    const canonical = String(row[map['Event']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const cell = String(row[map['Also_Known_As']] || '').trim();
    if (!canonical || !location || !cell) return;
    const canonicalKey = programAliasLookupKey_(canonical, location);
    cell.split(PROGRAM_ALIAS_SEPARATOR_REGEX).forEach(raw => {
      const alias = String(raw || '').trim();
      if (!alias) return;
      const key = programAliasLookupKey_(alias, location);
      if (key === canonicalKey) return;              // a row listing its own name
      if (ambiguous[key]) return;
      if (aliases[key] !== undefined && normalizeNameKey(aliases[key]) !== normalizeNameKey(canonical)) {
        ambiguous[key] = true;
        delete aliases[key];
        return;
      }
      aliases[key] = canonical;
    });
  });
  return { aliases, ambiguous: Object.keys(ambiguous) };
}

/** The index for this execution, read off Program_Settings once. Never throws. */
function programAliasIndex_() {
  if (__programAliasIndex) return __programAliasIndex;
  let index = { aliases: {}, ambiguous: [] };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss && typeof ss.getSheetByName === 'function'
      ? ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS) : null;
    if (sheet) {
      const headers = HEADERS.Program_Settings;
      index = buildProgramAliasIndex(readSimpleTableValues(sheet, headers), headers);
      if (index.ambiguous.length) {
        log(`⚠️ ${SHEET_NAMES.PROGRAM_SETTINGS}: ${index.ambiguous.length} title(s) are listed in ` +
          `Also_Known_As under two different programs at one building, so they are ignored: ` +
          index.ambiguous.map(k => `"${k.split('|')[0]}"`).join(', ') + '.');
      }
    }
  } catch (err) {
    try { console.log(`Program aliases: could not read ${SHEET_NAMES.PROGRAM_SETTINGS} (${err}); none applied.`); } catch (e) { /* none */ }
  }
  __programAliasIndex = index;
  return index;
}

/** "CANCELLED DUE TO ILLNESS:T'ai Chi 1" → "T'ai Chi 1". Anything else unchanged. */
function stripProgramStatusPrefix(title) {
  const text = String(title === null || title === undefined ? '' : title).trim();
  const stripped = text.replace(PROGRAM_STATUS_PREFIX_REGEX, '').trim();
  return stripped || text;
}

/**
 * The title a program is FILED under at this building: the status word taken
 * off, then Also_Known_As applied. Pure apart from the memoized index, which
 * `index` overrides (tests, and callers holding one already).
 */
function canonicalProgramTitle(title, location, index) {
  const text = stripProgramStatusPrefix(title);
  if (!text) return text;
  const idx = index || programAliasIndex_();
  const target = idx.aliases[programAliasLookupKey_(text, location)];
  return target !== undefined ? target : text;
}

/** True when this title is filed under another program's name — an alias or a status prefix. */
function programTitleIsFiledElsewhere(title, location, index) {
  const text = String(title === null || title === undefined ? '' : title).trim();
  if (!text) return false;
  return normalizeNameKey(canonicalProgramTitle(text, location, index)) !== normalizeNameKey(text);
}
