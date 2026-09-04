// ============================================================================
// 22. LIVE LINKS TO THE FILES THIS SYSTEM PRODUCES
//     (program leader sheets, printed sign-in PDFs)
// ============================================================================
//
// Two of this project's outputs live OUTSIDE the workbook: the spreadsheet a
// program leader marks up (46_program_leader_sheets.gs) and the landscape PDF
// the desk prints and writes on (45_sign_in_sheet.gs). Both were findable only
// by the dialog that made them — close it and the file is somewhere in Drive,
// under a name you have to remember, for a date you have to remember.
//
// So every tab that already has a row for a session now carries the links to
// that session's files, rebuilt on each render:
//
//   Master_Program_Dashboard   Leader_Sheet_Link + Sign_In_Sheet_Link
//   Registrant_Dash            Leader_Sheet_Link + Sign_In_Sheet_Link
//   Master_Lunch_Dashboard     Sign_In_Sheet_Link   (a meal has no leader)
//
// THE COLUMNS ARE DERIVED, NOT STORED. Nothing here reads back what is in the
// cell; each render recomputes it from the registries below and overwrites.
// That is what keeps a link from outliving the file it points at: delete the
// PDF and the next render simply writes nothing there.
//
// WHY A REGISTRY FOR THE PDFs AND NOT A DRIVE SEARCH. A render touches every
// row on three tabs; a Drive lookup per row is hundreds of round trips for a
// column nobody may even look at. The registry is one Script Property read per
// execution, like every other registry in this project (06). PDFs built before
// this existed are picked up by the one-time folder scan on the Admin menu —
// see backfillSignInSheetRegistry().
//
// LOAD ORDER: numbered last, and it may stay there. Everything in this file is
// a function declaration (hoisted across the whole project), and the only
// top-level constants are its own — nothing earlier reads them at load time.
// ============================================================================


// --- the sign-in PDF registry -----------------------------------------------

/**
 * { "yyyy-MM-dd|location key": { fileId, url, name, builtAt } } — one entry per
 * date x location, the same key the printed sheet is built against.
 *
 * Versioned _V1 like every other stored shape here (see the note in 06 and on
 * LEADER_SHEET_REGISTRY_PROP_KEY): a later change to what an entry holds is a
 * new key, never a quiet reinterpretation of this one.
 */
const SIGN_IN_SHEET_REGISTRY_PROP_KEY = 'SIGN_IN_SHEET_REGISTRY_V1';

/** How many entries the registry keeps. Oldest built go first — see pruneSignInSheetRegistry(). */
const SIGN_IN_SHEET_REGISTRY_MAX_ENTRIES = 800;

/** The label a sign-in link reads as. Short: the column is narrow and the date is already on the row. */
const SIGN_IN_SHEET_LINK_LABEL = '🖨️ Sign-In PDF';

/** The label a program leader sheet link reads as. */
const LEADER_SHEET_LINK_LABEL = '📋 Leader Sheet';

let __signInSheetRegistryCache = null;
let __signInSheetRegistryDirty = false;

/** Read once per execution, written back by flushPersistentRegistries(). */
function getSignInSheetRegistry() {
  if (__signInSheetRegistryCache) return __signInSheetRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(SIGN_IN_SHEET_REGISTRY_PROP_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    // A registry that cannot be parsed is a registry that is gone. Losing it
    // costs the link column until the next backfill; throwing here would cost
    // the render.
    log(`⚠️ The sign-in sheet registry could not be read (${err}) — starting a fresh one.`);
  }
  __signInSheetRegistryCache = parsed && typeof parsed === 'object' ? parsed : {};
  return __signInSheetRegistryCache;
}

/** The identity of one printed sheet: the day and the building, nothing else. */
function signInSheetKey(dateKey, location) {
  return `${String(dateKey || '').trim()}|${normalizeNameKey(location)}`;
}

/**
 * Remembers the PDF just built for one date x location, REPLACING whatever was
 * there. Reprinting a day is the normal case — a name arrives after the first
 * copy came off the printer — and the newest copy is the one the desk wants.
 */
function recordSignInSheetPdf(dateKey, location, file) {
  if (!dateKey || !location || !file) return;
  const registry = getSignInSheetRegistry();
  registry[signInSheetKey(dateKey, location)] = {
    fileId: file.getId(),
    url: file.getUrl(),
    name: file.getName(),
    builtAt: new Date().toISOString()
  };
  __signInSheetRegistryDirty = true;
  pruneSignInSheetRegistry();
}

/**
 * Keeps the stored property bounded. A Script Property has a hard size limit
 * and this one grows by an entry per printed day forever; the sheets that fall
 * off are years old and their PDFs are long since irrelevant. The FILES are
 * untouched — only the memory of them.
 */
function pruneSignInSheetRegistry() {
  const registry = getSignInSheetRegistry();
  const keys = Object.keys(registry);
  if (keys.length <= SIGN_IN_SHEET_REGISTRY_MAX_ENTRIES) return;
  keys
    .sort((a, b) => String(registry[a].builtAt || '').localeCompare(String(registry[b].builtAt || '')))
    .slice(0, keys.length - SIGN_IN_SHEET_REGISTRY_MAX_ENTRIES)
    .forEach(key => { delete registry[key]; });
  __signInSheetRegistryDirty = true;
}

/** What a sign-in PDF is named on disk — the one shape backfillSignInSheetRegistry() can read back. */
const SIGN_IN_SHEET_FILENAME_RE = /^Sign-In (\d{4}-\d{2}-\d{2}) (.+?)(?:\.pdf)?$/i;

/**
 * ADMIN MENU: teaches the registry about every PDF already sitting in the
 * folder, so a workbook that has been printing sheets for a year does not have
 * to wait for the next reprint to show a link. Also opens each one up to
 * anyone with the link (see openUpFileToAnyoneWithLink()) — sign-in PDFs made
 * before that existed were left shared with their printer alone, same as a
 * form or leader sheet made before the equivalent fix for those.
 *
 * One scan, by hand, rather than anything automatic: it is a full folder
 * listing, it only ever has work to do once, and getting it wrong is a link
 * column that stays empty rather than anything lost. Names are parsed back
 * with SIGN_IN_SHEET_FILENAME_RE — a file somebody renamed is skipped for the
 * registry, since the date and location cannot be recovered from a name that
 * no longer carries them, but it is still opened up like every other file in
 * the folder. The newest file wins a tie, on the same reasoning as a reprint.
 */
function backfillSignInSheetRegistry() {
  if (!requireAuthorizedAdmin('Rebuild Sign-In Sheet Links')) return { matched: 0, skipped: 0, opened: 0 };
  if (!confirmConsequentialAction('Rebuild sign-in sheet links?',
    'Every PDF already sitting in the sign-in sheet folder is set to "anyone with the link can edit" ' +
    '(the same fix already applied to registration forms and program leader sheets), so a printed sheet ' +
    'opens for whoever clicks its dashboard link, not only whoever printed it.', true)) {
    return { matched: 0, skipped: 0, opened: 0 };
  }
  const locationByKey = {};
  Object.values(CALENDAR_MAP).forEach(loc => { locationByKey[normalizeNameKey(loc)] = loc; });

  const folder = getOrCreateSignInSheetFolder();
  const files = folder.getFiles();
  const registry = getSignInSheetRegistry();
  let matched = 0;
  let skipped = 0;
  let opened = 0;

  while (files.hasNext()) {
    const file = files.next();
    if (openUpFileToAnyoneWithLink(file.getId(), `sign-in sheet "${file.getName()}"`).openedUp) opened++;
    const parts = SIGN_IN_SHEET_FILENAME_RE.exec(String(file.getName() || '').trim());
    if (!parts) { skipped++; continue; }
    const dateKey = parts[1];
    const location = locationByKey[normalizeNameKey(parts[2])] || parts[2];
    const key = signInSheetKey(dateKey, location);
    const builtAt = file.getDateCreated();
    const existing = registry[key];
    if (existing && String(existing.builtAt || '') >= builtAt.toISOString()) continue;
    registry[key] = {
      fileId: file.getId(),
      url: file.getUrl(),
      name: file.getName(),
      builtAt: builtAt.toISOString()
    };
    __signInSheetRegistryDirty = true;
    matched++;
  }

  pruneSignInSheetRegistry();
  flushPersistentRegistries();
  const message = `Sign-in sheet links: ${matched} PDF(s) picked up, ${opened} opened to anyone with the link` +
    (skipped > 0 ? `, ${skipped} file(s) skipped for the registry (name no longer says which date and location)` : '') +
    '. The links appear on the next render.';
  log(message);
  toastIfPossible(message);
  return { matched, skipped, opened };
}


// --- what a render asks for -------------------------------------------------

/**
 * The HYPERLINK formula for one session's printed sheet, or '' when no PDF has
 * been built for that day and building yet. '' rather than a placeholder: an
 * empty cell reads as "there isn't one", which is true, and a column of "none"
 * on a tab this wide is noise.
 */
function signInSheetLinkFormula(dateValue, location) {
  const date = coerceDate(dateValue);
  if (!date || !location) return '';
  const entry = getSignInSheetRegistry()[signInSheetKey(formatDateKey(date), location)];
  return entry && entry.url ? makeHyperlinkFormula(entry.url, SIGN_IN_SHEET_LINK_LABEL) : '';
}

/**
 * The HYPERLINK formula for the spreadsheet a program's leader marks up, or ''
 * when that program has never been shared.
 *
 * Keyed by leaderProgramKey(title, location) — title AND location, which is
 * the privacy boundary the leader sheets are built around (see 46). A program
 * running in two buildings has two sheets, and this hands each row its own.
 */
function leaderSheetLinkFormula(title, location) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle || !location) return '';
  const entry = getProgramLeaderSheetRegistry()[leaderProgramKey(cleanTitle, location)];
  if (!entry || !entry.fileId) return '';
  return makeHyperlinkFormula(
    `https://docs.google.com/spreadsheets/d/${entry.fileId}/edit`, LEADER_SHEET_LINK_LABEL);
}

/**
 * Fills the file-link columns in on rows about to be written to a tab.
 *
 * `columns` names which of the two this tab carries and where each one's
 * inputs live, so one function serves all three tabs:
 *   { titleColumn: 'Clean_Title' }  — omit for a tab with no program on the row
 *
 * A tab whose header row predates these columns simply has no index for them,
 * and this does nothing rather than writing off the end of the row.
 */
function stampGeneratedFileLinks(rows, map, options) {
  options = options || {};
  const signInIdx = map['Sign_In_Sheet_Link'];
  const leaderIdx = map['Leader_Sheet_Link'];
  const titleIdx = options.titleColumn === undefined ? undefined : map[options.titleColumn];
  if (signInIdx === undefined && leaderIdx === undefined) return rows;
  if (map['Event_Date'] === undefined || map['Location'] === undefined) return rows;

  rows.forEach(row => {
    const location = String(row[map['Location']] || '').trim();
    if (signInIdx !== undefined) {
      row[signInIdx] = signInSheetLinkFormula(row[map['Event_Date']], location);
    }
    if (leaderIdx !== undefined) {
      row[leaderIdx] = titleIdx === undefined
        ? '' : leaderSheetLinkFormula(row[titleIdx], location);
    }
  });
  return rows;
}
