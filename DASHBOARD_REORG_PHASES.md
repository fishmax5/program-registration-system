# Dashboard reorganization — the phase runbook

Working notes for the five-phase implementation of `DASHBOARD_REORG_DESIGN.md`.
Each phase is one Claude chat session. **This file is the hand-off**: the last
step of every phase is to print the next phase's prompt, so the next session
starts by pasting one line rather than by re-deriving the plan.

Delete this file in Phase 5 if you don't want it in the repo — nothing reads it.

---

## The kickoff line (paste this into every new session)

> Read `DASHBOARD_REORG_PHASES.md` and run **Phase N**. Follow the standing
> rules at the top of it and the phase's own section, then do the hand-off step.

---

## Standing rules (all phases)

- Branch `claude/merge-todays-chats-main-swbo6e`. Start each phase from a clean
  tree: `git status` clean, `git pull origin claude/merge-todays-chats-main-swbo6e`
  first — **other sessions push to this branch**, and Phase 1 hit exactly that
  (see the numbering note below).
- Read `CLAUDE.md` and `DASHBOARD_REORG_DESIGN.md` before writing anything.
- Never renumber, rename or merge an existing `.gs` file. New files are
  behavior-only: self-contained top-level constants, everything else reached
  through hoisted function calls or `defineLazyGlobal_` (`01a_lazy_globals.gs`).
  Schema lives in `03`.
- Comments carry the reasoning and name the failure they prevent. Read
  `43_program_dashboard.gs` and `40_memory_tabs.gs` for the voice.
- Reuse the existing table machinery rather than writing new.
- Before each commit: `for f in tests/*.test.js; do node "$f"; done`. Report the
  result honestly. A `tests/load_order.test.js` failure is a new eager
  cross-file read, never a broken test.
- After each phase: update `CLAUDE.md` and `00_overview.gs`, commit, and
  `git push -u origin claude/merge-todays-chats-main-swbo6e`.

**Numbering note from Phase 1.** The design doc says `77_program_month_dashboard.gs`.
While Phase 1 was in flight, another session landed `77_households_and_names.gs`
on this branch, so the month tab shipped as **`78_program_month_dashboard.gs`**.
Wherever the design doc says 77, read 78. Check for the same collision before
adding any new file.

---

## Phase 1 — the `Program_Month` tab ✅ done (`4bd285b`)

New `78_program_month_dashboard.gs`; `SHEET_NAMES.PROGRAM_MONTH` and
`HEADERS.Program_Month` in `03`; rendered from the session rows
`renderProgramDashboard()` already holds (inside a try/catch — a broken derived
view is a log line, not a failed sync); menu item in `16`;
`tests/program_month.test.js`. All test files pass.

---

## Phase 2 — metrics up, session tab thinner ✅ done

Move the metrics block (`43_program_dashboard.gs:403–823`) onto `Program_Month`.

- It still reads SESSION rows, so **the numbers must not move by a digit** —
  assert that before and after. Keep every column note verbatim.
- Add one line the month tab makes possible: *programs with no leader this
  month*, via `buildProgramLeaderIndex()` — read it, do not add a second read.
- Make `Sessions` a `=HYPERLINK("#gid=…&range=A<row>", "4 sessions")` into that
  group's first session row. Degrade to a plain count rather than a wrong link.

Shipped: `writeProgramMetricsSection()` / `computeProgramMetrics()` stay in
`43_program_dashboard.gs` — only the DRAWING moved, which is what makes "the
numbers must not move by a digit" true by construction; the block is passed
from `renderProgramDashboard()` with the rows it was computed from, and
recomputed identically on the menu path. `programMonthLeaderCoverage()` reads
the memoized `buildProgramLeaderIndex()` and only ever COUNTS — a shared
program counts as covered if either building's row names a leader, and lunch is
left out. `programMonthSessionsCell()` links at the group's first session row
and degrades to the plain count rather than to a wrong link. The
Upcoming/Past boundary is the 1st of the current month, not today: a month row
is past when its MONTH is over.

Also answered while here: the design's open question #2 — a `FIXED`-span group
is one row, filed under its first month (see the banner in `78`).

**Hand-off:** commit, push, then print the Phase 3 kickoff line and tell me to
open a new chat.

---

## Phase 3 — the title detector ✅ done

The rule this is built around: **a phrase match NEVER shares a roster and NEVER
sends mail.** It proposes a concrete `title | location` row; sharing and
notification keep reading only concrete rows. `buildProgramLeaderIndex()`
(`65_program_leaders.gs:216`) stays exactly as it is. Read the NO WILDCARDS
paragraph at the top of that file before writing anything.

- Add `Title_Match` to `HEADERS.Program_Leaders` and
  `PROGRAM_LEADERS_STAFF_COLUMNS` — comma-separated phrases, matched against
  `Clean_Title` (post-tag-strip, so `[Club]` can't land in a phrase), normalized
  like `normalizeNameKey()`.
- Precedence: a concrete row for that `title | location` wins outright,
  including one assigning the program to somebody else; then longest matching
  phrase (`chair yoga` beats `yoga`); a tie at equal length proposes nothing and
  reports both.
- Auto-write the proposed row with `Notify_Roster_Changes` unticked and a
  `Staff_Notes` stamp naming the phrase — same posture as
  `migrateProgramLeaderAddresses()` (`65_program_leaders.gs:350`); read its
  comment. Report the batch via `noteForAdmin()`.
- Runs inside `refreshProgramLeadersTab()`, which already has `sessionRows` and
  `knownProgramKeys()` — a loop over structures in hand, no new read or cache.
- Safeguards: a phrase matching nothing gets a cell note (a typo there is
  otherwise silent until a roster goes unshared); a phrase matching >10 programs
  is reported, not applied. Check `renameProgramLeaderRows()` carries
  `Title_Match` through a rename without dropping it.
- **Write this test first:** a leader row with a phrase and no concrete program
  row contributes nothing to `buildProgramLeaderIndex()`. It is what holds the
  whole design. Then precedence, the tie refusal, and both safeguards.

Shipped: `Title_Match` on `HEADERS.Program_Leaders` and
`PROGRAM_LEADERS_STAFF_COLUMNS`; `parseLeaderTitleMatchPhrases()` (comma only,
so a two-word phrase survives) and `proposeProgramLeaderRowsFromTitles()` — a
pure function, rows in and proposed rows out, so nothing about it can write by
itself; `applyTitleMatchNotes()` after the tab write, because `writeMemoryTab()`
clears the sheet. Called from `refreshProgramLeadersTab()` over the structures
it already holds. `buildProgramLeaderIndex()` is untouched, which is the whole
design. `renameProgramLeaderRows()` now takes the UNION of the two rows'
phrases when a rename makes a duplicate — dropping the row that held them
would have un-attributed everything they were going to catch. Tests in
`tests/program_leader_title_match.test.js`, boundary test first. All test files
pass.

**Hand-off:** commit, push, then print the Phase 4 kickoff line and tell me to
open a new chat.

---

## Phase 4 — the leader dropdown ✅ done

`Leader` and `Leader_Source` on `Program_Month`. The column must not become a
second place "who leads what" is stored — `Program_Leaders` is what shares a
roster and sends mail, and two records disagreeing gets found out the day
somebody is emailed a class they don't teach. So it reads and writes:

```
read:   Program_Leaders row (title|location)  →  Leader cell
write:  edit the cell → onEdit writes that row → invalidateProgramLeaderIndex()
```

- Dropdown offers the distinct `Leader_Name`s plus blank — suggesting, not
  restricting, same as the `Program`/`Location` lists at
  `65_program_leaders.gs:158`.
- Handler in `18_edit_handlers.gs` following `handleProgramFlagEdit()`, with its
  confirmation prompt — this edit changes who may read a roster.
- `Leader_Source` reads `typed` or `matched`; render `matched` in the
  manual-entry wash, `typed` plain.
- Decide what blanking the cell means and say it in the dialog's own words.
  Prefer the non-destructive reading — a row for a class somebody used to lead
  is still a true record.
- Carry-forward needs no code: `leaderProgramKey()` has no month in it. Prove it
  with a test; don't build a mechanism.

Shipped: `Leader` / `Leader_Source` on `HEADERS.Program_Month`, right after
`Program`. The read is `programMonthLeaderCell()` in `78`, off the memoized
`buildProgramLeaderIndex()` the caller already reads for the coverage line —
never a second read, so the two can never disagree. It prints BOTH leaders of a
two-leader program and both buildings of a `[Shared]` one. The write is
`handleProgramMonthEdit()` in `18` → `attachProgramLeaderRow()` in `65`, which
is where the posture lives: it ONLY ADDS — never edits or deletes somebody
else's row — takes the email off the leader's own other rows rather than
leaving it blank to retype, and leaves `Notify_Roster_Changes` clear, because
attaching somebody is not putting them on a mailing list.

Decided while here, in the dialog's own words: **blanking the cell removes
nothing.** It reverts and says a leader is removed on `Program_Leaders`, by
deleting the row whose deletion is visibly what stops the roster being shared.
Same reading for a replacement — the new name is added beside the old and the
cell prints both until somebody deletes one there. A fill-down is refused
outright (every row is a different roster going to the same person, and there
is no honest single question to ask), and so is a `[Shared]` row: that is two
leader rows, one per building, and resolving it generously here would invent a
grain `65`'s NO WILDCARDS paragraph refuses to have.

`Leader_Source` reads off the `Title_Match` stamp rather than a new column —
`LEADER_TITLE_MATCH_NOTE_PREFIX` / `isTitleMatchedLeaderRow()`, extracted from
the literal Phase 3 shipped — because deleting that note is already how a
person says they have checked the row. `matched` cells take the manual-entry
wash; `Leader` is the one column left out of `protectDerivedColumns()`. Tests:
the carry-forward proof (three months, one key, no mechanism) in
`tests/program_month.test.js`, and the writer's refusals in
`tests/program_leaders_tab.test.js`. All 62 test files pass.

**Hand-off:** commit, push, then print the Phase 5 kickoff line and tell me to
open a new chat.

---

## Phase 5 — the rename ✅ done

`Master_Program_Dashboard` → `Program_Sessions`. Two lines:
`SHEET_NAMES.PROGRAM_DASHBOARD`, plus a `LEGACY_SHEET_RENAMES` entry
(`03_sheets_and_headers.gs:57`) so `getOrCreateSheet()` renames the tab in
place, keeping rows and formatting. Read that constant's comment — a workbook
holding BOTH tabs must be left alone, and your change must not break that.

- Grep for the bare string first and stop if you find one — every file should
  reach the tab through the constant.
- Keep `HEADERS.Master_Program_Dashboard` as it is, with a comment saying why: a
  schema key is read by code, a tab name by people (same reasoning as
  `LEADER_SHEET_REGISTRY_PROP_KEY` still being spelled
  `INSTRUCTOR_SHEET_REGISTRY_V1`).
- The real work is documentation: account for every `Master_Program_Dashboard`
  hit across the repo — code, comment, doc, test.

Shipped: `SHEET_NAMES.PROGRAM_DASHBOARD` is `'Program_Sessions'`, with
`'Program_Sessions': 'Master_Program_Dashboard'` in `LEGACY_SHEET_RENAMES` so
`getOrCreateSheet()` renames an existing workbook's tab in place — the
both-tabs-present rule is untouched, and matters more now that the new name is
one somebody could plausibly have given a tab of their own. No bare string
existed in any `.gs` outside the constant, so nothing reached the tab except
through `SHEET_NAMES`. `HEADERS.Master_Program_Dashboard` keeps the old
spelling with a comment saying why. Documentation: every prose mention across
20 `.gs` banners, `USER_GUIDE.md` (plus a rename note in its tab section),
`SYSTEM_REVIEW.md` and `SIMPLIFICATION_REVIEW.md`; the two user-visible strings
that said the old name out loud (`29`, `55`) now say the new one;
`DASHBOARD_REORG_DESIGN.md` keeps both names because it is the record of the
change. Three test fixtures that keyed a stubbed sheet off the literal now read
`SHEET_NAMES.PROGRAM_DASHBOARD`. All 62 test files pass.

**Hand-off:** the five-phase run is finished. Nothing reads this file — delete
it if you don't want it in the repo.
