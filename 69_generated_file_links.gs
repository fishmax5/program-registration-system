// ============================================================================
// 22. LIVE LINKS TO THE FILES THIS SYSTEM PRODUCES  (program roster sheets)
// ============================================================================
//
// One of this project's outputs lives OUTSIDE the workbook: the view-only
// roster spreadsheet a program's leader reads (46_program_leader_sheets.gs).
// Every tab that already has a row for a session carries its link, rebuilt on
// each render:
//
//   All_Program_Sessions   Registrant_Sheet_Link (hidden)
//   All_Registrants        Registrant_Sheet_Link
//
// SIGN-IN SHEETS ARE GONE (Nov 25 2026, Max: "kill sign in sheets all
// together"). The registry, its backfill, the 6am job and the menu items went
// with them. Sign_In_Sheet_Link is still in HEADERS for All_Registrants and
// All_Program_Sessions, written blank and hidden, because both tabs are
// appended to in HEADERS order and taking a column out of the middle would
// misalign every append onto a tab drawn before the change. The old registry
// property is cleared by retireRetiredSignInSheetState_() (16).
//
// THE COLUMNS ARE DERIVED, NOT STORED. Nothing here reads back what is in the
// cell; each render recomputes it and overwrites.
//
// LOAD ORDER: numbered last, and it may stay there. Everything in this file is
// a function declaration (hoisted across the whole project), and the only
// top-level constants are its own — nothing earlier reads them at load time.
// ============================================================================

/** The retired sign-in sheet registry's Script Property, named only so it can be cleared. */
const RETIRED_SIGN_IN_SHEET_REGISTRY_PROP_KEY = 'SIGN_IN_SHEET_REGISTRY_V1';

/** The label a program registrant sheet link reads as. */
const LEADER_SHEET_LINK_LABEL = '📋 Registrant Sheet';


// --- what a render asks for -------------------------------------------------

/**
 * The HYPERLINK formula for the spreadsheet a program's leader marks up, or ''
 * when that program has never been shared.
 *
 * Keyed by leaderProgramKey(title, location) — title AND location, which is
 * the privacy boundary the registrant sheets are built around (see 46). A program
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
 * `options` says where the program title lives on this tab:
 *   { titleColumn: 'Clean_Title' }  — omit for a tab with no program on the row
 *
 * A tab whose header row predates these columns simply has no index for them,
 * and this does nothing rather than writing off the end of the row.
 */
function stampGeneratedFileLinks(rows, map, options) {
  options = options || {};
  const signInIdx = map['Sign_In_Sheet_Link'];
  const leaderIdx = map['Registrant_Sheet_Link'];
  const titleIdx = options.titleColumn === undefined ? undefined : map[options.titleColumn];
  if (signInIdx === undefined && leaderIdx === undefined) return rows;
  if (map['Event_Date'] === undefined || map['Location'] === undefined) return rows;

  rows.forEach(row => {
    const location = String(row[map['Location']] || '').trim();
    // Retired column: blank, so an old link to a sign-in Doc does not linger.
    if (signInIdx !== undefined) row[signInIdx] = '';
    if (leaderIdx !== undefined) {
      row[leaderIdx] = titleIdx === undefined
        ? '' : leaderSheetLinkFormula(row[titleIdx], location);
    }
  });
  return rows;
}
