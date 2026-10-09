# R5 — Program rosters served from the web app (transition plan)

Item #5 of `docs/RESTRUCTURING_PROPOSALS.md`. Written before the code, and kept
as the record of how a program moves from its spreadsheet to its web page
without losing a tick.

## What ships, in one paragraph

A new route on the existing deployment, `?mode=roster&t=<token>`, draws ONE
program's roster at view time from `All_Registrants` and `All_Program_Sessions`,
through the same join the spreadsheet push uses (`buildLeaderSheetRowsByProgram`,
`leaderSheetContentFor` in `46`), so the page and the sheet cannot disagree about
who is on it. Same columns, banded by session, the Waitlist section (`99z` +
`splitLeaderSheetRows`), the Answers column, Print and Download CSV. The five
leader-owned columns become buttons and a notes box. A new per-program setting,
`Roster_Delivery` on `Program_Settings` (appended LAST, staff-owned, a closed
dropdown of **Sheet / Both / Web**, blank = Sheet), decides which one is the
roster. **Deploying changes nothing**: every program reads blank, i.e. Sheet,
and the sheet machinery runs exactly as before until the office opts a program in.

Files: `99zn_leader_roster_page.gs` (server: delivery, tokens, roster read,
writes, cutover, staff dialog) and `99zna_leader_roster_page_html.gs` (the page
and the staff dialog, template literals).

## The three settings, and the one rule they enforce

**One source of truth for a program's ticks at any moment.**

| `Roster_Delivery` | Who may tick | Sheet push / pull | Leader emails link to | Page |
|---|---|---|---|---|
| blank / `Sheet` | the spreadsheet | unchanged | the sheet | read-only (if a link was made) |
| `Both` | the spreadsheet | unchanged | the sheet, plus the page as a second line | read-only — a preview for leader and office |
| `Web` | the page | pull stops and push stops **only after the cutover below has read the sheet one last time** | the page | live buttons, **after** cutover |

The page refuses every write unless the program is `Web` AND its sheet has been
cut over (or it never had one). So during `Both`, and during the gap between the
office choosing `Web` and the cutover completing, the page shows the roster with
the buttons disabled and a line saying why. There is no state in which a leader
can tick on both and have the two race.

## The leader-owned ticks, today

On the sheet (`46`): `Contacted`, `Confirmed`, `Waitlisted`, `Dropped`,
`Leader_Notes` (`LEADER_OWNED_COLUMNS`, `03`). `Attended` is NOT a leader column
— it is the desk's (Quick Mark, the door) and is not on the sheet or the page.
`Answers` is read-only, sync-owned (`Form_Answers`).

- Pull (`pullProgramLeaderSheetEdits`, head of the import in `27`): per cell,
  against the hidden `Pushed_Snapshot`; a changed cell wins. Skips a file Drive
  says nobody touched since it was last read (`99zf`,
  `LEADER_SHEET_PULL_BASELINE_V1`). One `corrected` ledger entry per row,
  source `leader-sheet`.
- Then, every sync, over every row of `All_Registrants` (not only pulled rows):
  `applyLeaderDropsAsCancellations` (Dropped → the four-cell cancellation, upcoming
  only, one-way) and `applyLeaderWaitlistTicks` (two-way, a promotion only for a
  by-hand waitlisting and only into a free, open seat).
- Push (`pushProgramLeaderSheets`, the sync tail in `98`): rewrites a sheet when
  its fingerprint moved, writes the new snapshot.

**The page writes the same columns on the same row of `All_Registrants`**, then
runs those same two functions on that one row (they gained an optional
`{ ledgerSource, note, only }` argument — default behaviour unchanged). So a
page tick and a sheet tick end in identical cells, identical stamps and the same
ledger kinds; only the ledger `Source` differs (`leader-page`, a new
`LEDGER_SOURCES` value). Because those two functions keep running hourly over
the whole tab, the page's write is also exactly what the next sync would have
concluded — nothing re-derives it differently.

## Cutover: Sheet/Both → Web, without losing the last hour

Done by the sync tail's push step (`pushProgramLeaderSheets` asks
`leaderRosterHandlesSheet_()` first), or at once by **Switch now** in the staff
dialog. For a `Web` program that has a registered sheet and no completed
cutover, in this order:

1. **Freeze first.** Protect the `Sign_Up_Sheet` tab (a real protection, not
   warning-only; every editor but the script owner removed; described
   `Moved to the web roster page`). From this instant no leader can type a tick
   the system would then fail to read. State `LEADER_ROSTER_CUTOVER_V1[program]
   = { frozenAt, fileId }` is written immediately.
2. **Final read, after the freeze.** The tab is read and diffed against its
   snapshot with the pull's own per-cell rule (factored out of the pull as
   `collectLeaderSheetEdits_`, so there is one copy of it). Every changed cell is
   written to `All_Registrants` through the page's own locked writer (ledger
   source `leader-sheet`, since the tick WAS made on the sheet), drops and
   waitlist ticks applied.
3. **Banner.** Row 1 of `Sign_Up_Sheet` and of `Waitlist` becomes "This roster
   has moved — open <link>". The file is never trashed, unshared or renamed; the
   link already handed out keeps opening and now tells the leader where to go.
4. **Settled.** `settledAt` recorded only after 2 and 3 landed. From then on the
   pull skips that sheet and the push leaves it alone, and the page goes live.

If anything fails after step 1, the sheet stays protected, the program stays
un-settled (page read-only, pull still reads it, push still skips it), the
office digest says so, and the next sync retries from step 2. Re-reading is
harmless: the writer no-ops on a cell that already holds the value.

A tick made on the old sheet in the last hour before cutover is therefore read
either by the ordinary pull (if it was before the freeze) or by step 2 (it
cannot be after the freeze — the tab is protected). Auto-creation of sheets
(`ensureRegistrantSheetsForUpcomingPrograms`, `…ForNotifyingLeaders`) skips a
`Web` program, so a program that never had a sheet is live on the page at once.

## Rollback: Web → Sheet or Both

Change the cell back. On the next push (or Switch now) for that program:
remove the protection this code added (only ours, matched by description),
delete the cutover state, clear the stored fingerprint so the push rewrites the
whole sheet — banner included — with today's values and a fresh snapshot.
Everything ticked on the page is on `All_Registrants`, so it arrives on the
sheet, and the three-way merge starts cleanly from there. Nothing to restore,
nothing lost. The token is not revoked by a rollback (the page goes read-only);
revoke it in the dialog if the link should stop working.

Whole-feature rollback: leave every `Roster_Delivery` blank. The code is then
inert apart from the extra route answering "link not valid" for an unknown token.

## Links already handed out

- Sheet URLs keep working forever; this change never trashes a sheet. Once
  cut over they show the banner and the last roster (frozen). Deleting them is
  the office's decision, later, by hand.
- `LEADER_SHEET_REGISTRY_PROP_KEY` (`INSTRUCTOR_SHEET_REGISTRY_V1`) is not
  touched in shape or key. Rollback clears one field (`pushedFingerprint`) of one
  entry, which is what the push does to force a rewrite anyway.
- Sharing sweep (`89`) still opens these files — harmless; a frozen tab is
  protected regardless of file sharing.
- Doctor (`99h`): adds a line per program delivered on the web, saying the sheet
  is frozen on purpose so its fingerprint/empty findings are not alarming. It
  prints no token.
- Leader emails (`66`): `leaderRosterEmailLink()` picks the link — sheet for
  Sheet; sheet plus "Also on the web" for Both; the page for Web (a token is
  created on demand). An undeployed web app falls back to the sheet.

## Who can see a roster

- **Token per program** (title × building — the same privacy boundary as the
  sheet and `Program_Leaders`). Two UUIDs, hex, ~244 bits; stored in Script
  Properties `LEADER_ROSTER_TOKENS_V1` `{ programKey: { token, title, location,
  createdAt } }`, which only script editors can read.
- **Never logged**: no `log()`, `noteForAdmin`, digest line or doctor line
  contains a token or a page URL. The banner on the frozen sheet and the email
  to the leader do — the same audience that already had the sheet.
- **Revocable and rotatable** from Rosters & Sharing ▸ *Leader Roster Pages…*:
  Make link / New link (the old one stops at once) / Turn off. Rotation is the
  answer to a forwarded email.
- **The web app runs as the owner**, so anything the page can ask for, anyone
  holding the URL can ask for. Every server call re-checks the token and the
  writes re-check that the row belongs to that token's program (a forged
  `rowKey` from another program is refused). The token is the only
  credential; there is deliberately no PIN (a leader at home has none).
- **google.script.run exposure**: any public server function can be called
  from any page this deployment serves. The staff dialog's functions therefore
  require a one-time staff key (a random nonce inlined into the dialog when it
  is opened from the menu, held 6h in the script cache) — an outsider on the
  door app cannot list tokens. The locked writer is `_`-suffixed (private).
- **What the page shows** is exactly the sheet's columns: name, party size,
  phone, email, status, the leader ticks, notes, answers. No meal, no admin
  notes, no other program. Served with the default X-Frame refusal (it writes).

## Writes, locks and the sync

`leaderRosterMark(token, rowKey, column, value)` →
- program `Web` and settled, column one of the five, row in the program;
- if another run holds the workbook (`workbookHeldElsewhere`, `99w`): queued on
  `99b` (kind `leaderRosterMark`, carrying the program key — never the token)
  exactly as Quick Mark does (`deferQuickMarkBehindSync_`), and the page says
  "saved — goes on when the sync finishes";
- else `withScriptLock(DESK_LOCK_WAIT_MS, …)` (→ `workbookLock()`), the row
  found on the tab, the changed cells patched with `writeRegistrantRowPatch_`
  (no whole-row write over formula columns), ledger `corrected`
  (`leader-page`), then the drop/waitlist writers on that row, then counts
  recomputed if a status moved. A busy lock queues the same way.

## Manual test checklist (live workbook)

1. Deploy (new version of the web app). Open the workbook; Program_Settings
   gains `Roster_Delivery` at the right after the next sync; all blank.
   Nothing else changes: next sync pushes/pulls sheets as before.
2. Rosters & Sharing ▸ Leader Roster Pages… — lists programs; **Make link** on a
   test program. Open it in a private window: roster matches the sheet row for
   row (dates, names, waitlist tab, answers). Buttons disabled, "ticks are on the
   spreadsheet".
3. Set that program to `Both`. Run Send Roster Change Alerts after a change:
   email has the sheet link and "Also on the web".
4. Tick `Contacted` on the SHEET; set `Web`; immediately press **Switch now**.
   Sheet tab is protected (try typing as the leader account: refused), banner
   reads "moved". `All_Registrants` shows Contacted ticked; ledger has a
   `corrected` with source `leader-sheet`.
5. On the page: tick Confirmed → refresh → still ticked; Registrants tab shows
   it; ledger source `leader-page`. Tick Dropped (confirm prompt) → status
   Cancelled, seat freed on the session table. Tick Waitlisted on another row →
   it turns peach in its band and appears in the Waitlist section; untick it
   and (seat free) it is Active again. A capacity waitlisting stays put when
   unticked, with a message saying why.
6. Start Update Everything Now, tick on the page while it runs → "saved — goes
   on when the sync finishes"; after it finishes the tick is on the tab.
7. **New link** → old URL says "not valid"; new URL works. **Turn off** → both fail.
8. Set back to `Sheet`; run Refresh Program Registrant Sheets Now → the sheet is
   unprotected, rewritten with every page tick on it, banner back to normal.
9. Doctor (Why is a roster sheet empty?) mentions the web-delivered program and
   prints no URL. Search the Apps Script log for the token: absent.
