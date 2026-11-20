// ============================================================================
// 99zn. THE LEADER'S WEB ROSTER PAGE — RETIRED (November 2026)
// ============================================================================
//
// WHAT THIS WAS. Item #5 of the restructuring served a program's roster as a
// page (`?mode=roster&t=<token>`) instead of a shared spreadsheet, switched
// per program by a `Roster_Delivery` column on Program_Settings (Sheet / Both
// / Web), with a cutover that froze the sheet, tokens in Script Properties, a
// staff dialog to hand the links out, its own queued write kind (`99b`) and a
// note in the sheet doctor (`99h`). About 1,250 lines across this file and
// `99zna`.
//
// WHY IT IS GONE. Nobody used it: on 2026-11-20 every Program_Settings row's
// Roster_Delivery was blank (= Sheet), so no program was ever on the page,
// and every cutover, token and branch here was cost with no reader. The
// office asked for it to be turned off as unused and overly complicated. The
// sheet (`46`) is the one roster again, with no second door onto its columns.
//
// WHAT IS LEFT, AND WHY. Only the route word and a page that says the link is
// no longer used. A leader who bookmarked a roster link should not land on
// the STAFF roster (a bare `?mode=roster` is still that, `60`), and should
// not see an error either. The page carries no data and no token.
//
// WHAT WAS DELIBERATELY NOT TOUCHED.
// - `LEDGER_SOURCES.LEADER_PAGE` (`99k`) stays: ledger history may name it.
// - Script Properties `LEADER_ROSTER_TOKENS_V1` and `LEADER_ROSTER_CUTOVER_V1`
//   are no longer read. Nothing was ever cut over (no program was Web), and
//   the push rolled back any state whose program was not Web, so neither key
//   holds anything live.
// - The filename stays (never renumber): a sync tool that does not delete
//   files then overwrites the old body instead of leaving it behind.
//
// The design and rollback of the retired feature are in
// docs/transitions/R5_leader_web_roster.md and the git history.
// ============================================================================

/** The `?mode=` word the retired page used. A bare `?mode=roster` is the staff roster (`60`). */
const LEADER_ROSTER_MODE = 'roster';

/**
 * What an old leader roster link opens now: a plain notice, no data, no token
 * echoed back. Self-contained HTML with nothing interpolated.
 */
function buildRetiredLeaderRosterPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Class Roster</title>
<style>body{font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#202124;line-height:1.5}
h1{font-size:22px;font-weight:600}</style></head>
<body><h1>This roster link is no longer used</h1>
<p>Your program's roster is the sign-up sheet linked in your program emails.</p>
<p>If you cannot find it, please contact the office.</p></body></html>`;
}
